import sqlite3
import json
import os
from threading import Lock
from typing import List, Optional, Dict, Any

DB_FILE = "data/favorites.db"


class DatabaseManager:
    _instance = None
    _lock = Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(DatabaseManager, cls).__new__(cls)
                cls._instance._init_db()
            return cls._instance

    def _get_connection(self):
        return sqlite3.connect(DB_FILE, check_same_thread=False)

    def _init_db(self):
        """初始化数据库表结构"""
        os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
        conn = self._get_connection()
        cursor = conn.cursor()

        # 创建 favorites 表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS favorites (
                id TEXT PRIMARY KEY,
                text TEXT,
                audio_url TEXT,
                char_name TEXT,
                context TEXT,
                tags TEXT,
                filename TEXT,
                chat_branch TEXT,
                fingerprint TEXT,
                created_at TEXT,
                relative_path TEXT,
                emotion TEXT
            )
        """)

        # 创建 auto_phone_calls 表 - 自动生成电话记录
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auto_phone_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_branch TEXT NOT NULL,
                context_fingerprint TEXT NOT NULL,
                char_name TEXT,
                trigger_floor INTEGER NOT NULL,
                segments TEXT NOT NULL,
                audio_path TEXT,
                audio_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                UNIQUE(chat_branch, context_fingerprint)
            )
        """)

        # 创建 context_fingerprint 索引以提高查询效率
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_auto_calls_fingerprint 
            ON auto_phone_calls(context_fingerprint)
        """)

        # 数据库迁移:为现有表添加 audio_url 字段(如果不存在)
        try:
            cursor.execute("SELECT audio_url FROM auto_phone_calls LIMIT 1")
        except sqlite3.OperationalError:
            # 字段不存在,添加它
            print("[Database] 迁移: 添加 audio_url 字段到 auto_phone_calls 表")
            cursor.execute("ALTER TABLE auto_phone_calls ADD COLUMN audio_url TEXT")
            conn.commit()

        # 数据库迁移:添加 chat_branch 和 context_fingerprint 字段
        try:
            cursor.execute("SELECT chat_branch FROM auto_phone_calls LIMIT 1")
        except sqlite3.OperationalError:
            print("[Database] 迁移: 添加 chat_branch 和 context_fingerprint 字段")
            cursor.execute(
                "ALTER TABLE auto_phone_calls ADD COLUMN chat_branch TEXT DEFAULT 'legacy'"
            )
            cursor.execute(
                "ALTER TABLE auto_phone_calls ADD COLUMN context_fingerprint TEXT DEFAULT ''"
            )

            # 为现有记录生成唯一的指纹(基于trigger_floor)
            cursor.execute(
                "UPDATE auto_phone_calls SET context_fingerprint = 'legacy_' || trigger_floor WHERE context_fingerprint = ''"
            )

            # 删除旧的唯一约束并创建新的(SQLite需要重建表)
            print("[Database] 迁移: 重建表以更新唯一约束")
            cursor.execute("""
                CREATE TABLE auto_phone_calls_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_branch TEXT NOT NULL,
                    context_fingerprint TEXT NOT NULL,
                    char_name TEXT,
                    trigger_floor INTEGER NOT NULL,
                    segments TEXT NOT NULL,
                    audio_path TEXT,
                    audio_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'pending',
                    error_message TEXT,
                    UNIQUE(chat_branch, context_fingerprint)
                )
            """)

            # 复制数据
            cursor.execute("""
                INSERT INTO auto_phone_calls_new 
                (id, chat_branch, context_fingerprint, char_name, trigger_floor, segments, audio_path, audio_url, created_at, status, error_message)
                SELECT id, chat_branch, context_fingerprint, char_name, trigger_floor, segments, audio_path, audio_url, created_at, status, error_message
                FROM auto_phone_calls
            """)

            # 删除旧表,重命名新表
            cursor.execute("DROP TABLE auto_phone_calls")
            cursor.execute(
                "ALTER TABLE auto_phone_calls_new RENAME TO auto_phone_calls"
            )

            conn.commit()
            print("[Database] 迁移完成: 表结构已更新")

        # 创建 conversation_speakers 表 - 对话说话人记录
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversation_speakers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_branch TEXT NOT NULL,
                speakers TEXT NOT NULL,
                last_updated_mesid INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(chat_branch)
            )
        """)

        # 创建 eavesdrop_records 表 - 对话追踪记录
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS eavesdrop_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_branch TEXT NOT NULL,
                context_fingerprint TEXT NOT NULL,
                speakers TEXT NOT NULL,
                scene_description TEXT,
                segments TEXT NOT NULL,
                audio_path TEXT,
                audio_url TEXT,
                trigger_floor INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                UNIQUE(chat_branch, context_fingerprint)
            )
        """)

        # 创建 eavesdrop 索引
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_eavesdrop_fingerprint 
            ON eavesdrop_records(context_fingerprint)
        """)

        # 创建 continuous_analysis 表 - 持续性分析记录
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS continuous_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_branch TEXT NOT NULL,
                context_fingerprint TEXT NOT NULL,
                floor INTEGER NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                characters_data TEXT NOT NULL,
                scene_summary TEXT,
                summary TEXT,
                character_states TEXT,
                raw_llm_response TEXT,
                UNIQUE(chat_branch, context_fingerprint)
            )
        """)

        # 创建 continuous_analysis 索引
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_analysis_floor 
            ON continuous_analysis(chat_branch, floor)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_analysis_fingerprint 
            ON continuous_analysis(context_fingerprint)
        """)

        # 数据库迁移: 为 continuous_analysis 表添加触发相关字段
        try:
            cursor.execute("SELECT suggested_action FROM continuous_analysis LIMIT 1")
        except sqlite3.OperationalError:
            print(
                "[Database] 迁移: 添加 suggested_action, trigger_reason, character_left 字段到 continuous_analysis 表"
            )
            cursor.execute(
                "ALTER TABLE continuous_analysis ADD COLUMN suggested_action TEXT DEFAULT 'none'"
            )
            cursor.execute(
                "ALTER TABLE continuous_analysis ADD COLUMN trigger_reason TEXT"
            )
            cursor.execute(
                "ALTER TABLE continuous_analysis ADD COLUMN character_left TEXT"
            )

        # ==================== 记忆系统表 ====================

        # 记忆快照表 - 每次分析产出一条完整快照
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_snapshots (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                context_fingerprint  TEXT NOT NULL UNIQUE,
                parent_fingerprint   TEXT,
                source               TEXT NOT NULL,
                source_id            TEXT NOT NULL,
                namespace_key        TEXT,
                mode                 TEXT,
                story_id             TEXT,
                floor                INTEGER,
                plot_summary         TEXT NOT NULL,
                character_profiles   TEXT,
                key_events           TEXT,
                speakers             TEXT,
                created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshot_fingerprint
            ON memory_snapshots(context_fingerprint)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshot_parent
            ON memory_snapshots(parent_fingerprint)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshot_source
            ON memory_snapshots(source, source_id)
        """)
        for column_sql in (
            "ALTER TABLE memory_snapshots ADD COLUMN namespace_key TEXT",
            "ALTER TABLE memory_snapshots ADD COLUMN mode TEXT",
            "ALTER TABLE memory_snapshots ADD COLUMN story_id TEXT",
        ):
            try:
                cursor.execute(column_sql)
                conn.commit()
            except sqlite3.OperationalError:
                pass

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshot_namespace
            ON memory_snapshots(namespace_key, created_at)
        """)

        # 人物画像表 - KV 结构存储角色卡初始人设 (静态)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS memory_profiles (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                char_name   TEXT NOT NULL,
                profile_key TEXT NOT NULL,
                profile_val TEXT NOT NULL,
                source      TEXT DEFAULT 'auto',
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(char_name, profile_key)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_profile_char 
            ON memory_profiles(char_name)
        """)

        # Telegram 群组多用户系统表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telegram_users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     TEXT NOT NULL,
                chat_id     TEXT,
                username    TEXT,
                first_name  TEXT,
                persona     TEXT,
                updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_tg_users_id
            ON telegram_users(user_id)
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telegram_bots (
                bot_id         TEXT PRIMARY KEY,
                character_id   TEXT NOT NULL,
                character_name TEXT NOT NULL,
                username       TEXT,
                bot_token      TEXT NOT NULL,
                tts_character  TEXT,
                voice_enabled  INTEGER DEFAULT 0,
                allowed_chat_ids TEXT,
                enabled        INTEGER DEFAULT 1,
                updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telegram_sessions (
                namespace_key   TEXT PRIMARY KEY,
                chat_id         TEXT NOT NULL,
                mode            TEXT NOT NULL,
                story_id        TEXT,
                is_active       INTEGER DEFAULT 1,
                title           TEXT,
                summary         TEXT,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_tg_sessions_chat
            ON telegram_sessions(chat_id, is_active)
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telegram_messages (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace_key       TEXT NOT NULL,
                chat_id             TEXT NOT NULL,
                speaker_type        TEXT NOT NULL,
                source_bot_id       TEXT,
                source_bot_username TEXT,
                sender_user_id      TEXT,
                sender_display_name TEXT,
                character_id        TEXT,
                character_name      TEXT,
                role                TEXT NOT NULL,
                content             TEXT NOT NULL,
                delivery            TEXT DEFAULT 'text',
                emotion             TEXT,
                telegram_message_id INTEGER,
                reply_to_message_id INTEGER,
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_tg_messages_namespace
            ON telegram_messages(namespace_key, id)
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telegram_story_states (
                namespace_key   TEXT PRIMARY KEY,
                mode            TEXT NOT NULL,
                story_id        TEXT,
                chapter_id      TEXT,
                current_goal    TEXT,
                summary         TEXT,
                state_json      TEXT,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()
        conn.close()

    def add_favorite(self, data: Dict[str, Any]):
        """添加新的收藏记录"""
        conn = self._get_connection()
        cursor = conn.cursor()

        # 处理 list 类型的字段，转换为 JSON 字符串存储
        context_json = json.dumps(data.get("context", []))

        try:
            cursor.execute(
                """
                INSERT INTO favorites (
                    id, text, audio_url, char_name, context, tags, 
                    filename, chat_branch, fingerprint, created_at, relative_path, emotion
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    data.get("id"),
                    data.get("text"),
                    data.get("audio_url"),
                    data.get("char_name"),
                    context_json,
                    data.get("tags"),
                    data.get("filename"),
                    data.get("chat_branch", "Unknown"),
                    data.get("fingerprint", ""),
                    data.get("created_at"),
                    data.get("relative_path"),
                    data.get("emotion", ""),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_favorite(self, fav_id: str) -> Optional[Dict[str, Any]]:
        """根据 ID 获取单个收藏记录"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT * FROM favorites WHERE id = ?", (fav_id,))
            row = cursor.fetchone()
            if row:
                return self._row_to_dict(row)
            return None
        finally:
            conn.close()

    def delete_favorite(self, fav_id: str):
        """删除指定 ID 的收藏记录"""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM favorites WHERE id = ?", (fav_id,))
            conn.commit()
        finally:
            conn.close()

    def get_all_favorites(self) -> List[Dict[str, Any]]:
        """获取所有收藏记录，按创建时间倒序排列"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            # 假设新插入的记录 id 不一定按顺序，但这里没有自增 ID，依靠插入顺序或者 created_at
            # 为了保持原有的 "insert(0)" 行为 (最新的在最前)，我们需要按 created_at 降序
            cursor.execute("SELECT * FROM favorites ORDER BY created_at DESC")
            rows = cursor.fetchall()
            return [self._row_to_dict(row) for row in rows]
        finally:
            conn.close()

    def get_matched_favorites(
        self, fingerprints: List[str], chat_branch: Optional[str] = None
    ) -> Dict[str, List[Dict[str, Any]]]:
        """获取匹配的收藏记录"""
        all_favs = self.get_all_favorites()
        current_fp_set = set(fingerprints)

        result_current = []
        result_others = []

        for fav in all_favs:
            is_match = False
            fav_fp = fav.get("fingerprint")

            if fav_fp and fav_fp in current_fp_set:
                is_match = True
            elif chat_branch and fav.get("chat_branch") == chat_branch:
                is_match = True

            fav["is_current"] = is_match
            if is_match:
                result_current.append(fav)
            else:
                result_others.append(fav)

        return {
            "current": result_current,
            "others": result_others,
            "total_count": len(all_favs),
        }

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        """将数据库行转换为字典，并处理特殊字段"""
        d = dict(row)
        # 反序列化 context
        if d.get("context"):
            try:
                d["context"] = json.loads(d["context"])
            except:
                d["context"] = []
        return d

    # ==================== 自动电话生成记录相关方法 ====================

    def add_auto_phone_call(
        self,
        chat_branch: str,
        context_fingerprint: str,
        trigger_floor: int,
        segments: List[Dict],
        char_name: Optional[str] = None,
        audio_path: Optional[str] = None,
        status: str = "pending",
    ) -> Optional[int]:
        """
        添加自动电话生成记录

        Args:
            chat_branch: 对话分支ID
            context_fingerprint: 上下文指纹
            trigger_floor: 触发楼层
            segments: 情绪片段列表
            char_name: 角色名称(可选,初始为 None,LLM 选择后更新)
            audio_path: 音频文件路径
            status: 状态 (pending/generating/completed/failed)

        Returns:
            记录ID,如果已存在则返回 None
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        segments_json = json.dumps(segments, ensure_ascii=False)

        try:
            cursor.execute(
                """
                INSERT INTO auto_phone_calls (
                    chat_branch, context_fingerprint, trigger_floor, char_name, segments, audio_path, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    chat_branch,
                    context_fingerprint,
                    trigger_floor,
                    char_name,
                    segments_json,
                    audio_path,
                    status,
                ),
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            # 违反唯一约束,已存在相同记录
            return None
        finally:
            conn.close()

    def is_auto_call_generated(
        self, chat_branch: str, context_fingerprint: str
    ) -> bool:
        """
        检查指定分支和上下文指纹是否已成功生成过自动电话

        Args:
            chat_branch: 对话分支ID
            context_fingerprint: 上下文指纹

        Returns:
            True 表示已成功生成, False 表示未生成或生成失败
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            # 只检查状态为 'completed' 的记录,允许 'failed' 状态的记录重试
            cursor.execute(
                """
                SELECT COUNT(*) FROM auto_phone_calls 
                WHERE chat_branch = ? AND context_fingerprint = ? AND status = 'completed'
            """,
                (chat_branch, context_fingerprint),
            )
            count = cursor.fetchone()[0]
            return count > 0
        finally:
            conn.close()

    def update_auto_call_status(
        self,
        call_id: int,
        status: str,
        audio_path: Optional[str] = None,
        error_message: Optional[str] = None,
    ):
        """
        更新自动电话记录状态

        Args:
            call_id: 记录ID
            status: 新状态
            audio_path: 音频路径(可选)
            error_message: 错误信息(可选)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            if audio_path:
                cursor.execute(
                    """
                    UPDATE auto_phone_calls 
                    SET status = ?, audio_path = ?, error_message = ?
                    WHERE id = ?
                """,
                    (status, audio_path, error_message, call_id),
                )
            else:
                cursor.execute(
                    """
                    UPDATE auto_phone_calls 
                    SET status = ?, error_message = ?
                    WHERE id = ?
                """,
                    (status, error_message, call_id),
                )
            conn.commit()
        finally:
            conn.close()

    def get_auto_call_history(
        self, char_name: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        获取角色的自动电话历史记录

        Args:
            char_name: 角色名称
            limit: 返回记录数量限制

        Returns:
            记录列表,按创建时间倒序
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                SELECT * FROM auto_phone_calls 
                WHERE char_name = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            """,
                (char_name, limit),
            )
            rows = cursor.fetchall()
            return [self._auto_call_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    def get_latest_auto_call(self, char_name: str) -> Optional[Dict[str, Any]]:
        """
        获取角色最新的自动电话记录

        Args:
            char_name: 角色名称

        Returns:
            最新记录或 None
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                SELECT * FROM auto_phone_calls 
                WHERE char_name = ? 
                ORDER BY created_at DESC 
                LIMIT 1
            """,
                (char_name,),
            )
            row = cursor.fetchone()
            if row:
                return self._auto_call_row_to_dict(row)
            return None
        finally:
            conn.close()

    def _auto_call_row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        """将自动电话记录行转换为字典"""
        d = dict(row)
        # 反序列化 segments
        if d.get("segments"):
            try:
                d["segments"] = json.loads(d["segments"])
            except:
                d["segments"] = []
        return d

    def get_auto_call_history_by_chat_branch(
        self, chat_branch: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        根据对话分支获取自动电话历史记录

        Args:
            chat_branch: 对话分支ID
            limit: 返回记录数量限制

        Returns:
            记录列表,按创建时间倒序
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                SELECT * FROM auto_phone_calls 
                WHERE chat_branch = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            """,
                (chat_branch, limit),
            )
            rows = cursor.fetchall()
            return [self._auto_call_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    def get_auto_call_history_by_fingerprints(
        self, fingerprints: List[str], limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        根据指纹列表获取自动电话历史记录（支持跨分支匹配）

        Args:
            fingerprints: 上下文指纹列表
            limit: 返回记录数量限制

        Returns:
            记录列表,按创建时间倒序
        """
        if not fingerprints:
            return []

        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            # 使用 IN 查询，利用索引
            placeholders = ",".join("?" * len(fingerprints))
            query = f"""
                SELECT * FROM auto_phone_calls 
                WHERE context_fingerprint IN ({placeholders})
                AND status = 'completed'
                ORDER BY created_at DESC 
                LIMIT ?
            """
            cursor.execute(query, fingerprints + [limit])
            rows = cursor.fetchall()
            return [self._auto_call_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    # ==================== 对话说话人管理相关方法 ====================

    def get_speakers_for_chat(self, chat_branch: str) -> List[str]:
        """
        获取指定对话的所有说话人

        Args:
            chat_branch: 对话分支ID

        Returns:
            说话人列表,如果不存在则返回空列表
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "SELECT speakers FROM conversation_speakers WHERE chat_branch = ?",
                (chat_branch,),
            )
            row = cursor.fetchone()

            if row and row[0]:
                try:
                    return json.loads(row[0])
                except:
                    return []
            return []
        finally:
            conn.close()

    def update_speakers_for_chat(
        self, chat_branch: str, speakers: List[str], mesid: Optional[int] = None
    ):
        """
        更新或插入对话的说话人列表

        Args:
            chat_branch: 对话分支ID
            speakers: 说话人列表
            mesid: 最后更新的消息ID (可选)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        speakers_json = json.dumps(speakers, ensure_ascii=False)

        try:
            cursor.execute(
                """
                INSERT INTO conversation_speakers (chat_branch, speakers, last_updated_mesid)
                VALUES (?, ?, ?)
                ON CONFLICT(chat_branch) DO UPDATE SET
                    speakers = excluded.speakers,
                    last_updated_mesid = excluded.last_updated_mesid,
                    updated_at = CURRENT_TIMESTAMP
            """,
                (chat_branch, speakers_json, mesid),
            )
            conn.commit()
        finally:
            conn.close()

    def batch_init_speakers(self, speakers_data: List[Dict[str, Any]]):
        """
        批量初始化说话人记录 (用于旧对话扫描)

        Args:
            speakers_data: 说话人数据列表,每项包含 chat_branch, speakers, mesid
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            for data in speakers_data:
                speakers_json = json.dumps(data["speakers"], ensure_ascii=False)
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO conversation_speakers (chat_branch, speakers, last_updated_mesid)
                    VALUES (?, ?, ?)
                """,
                    (data["chat_branch"], speakers_json, data.get("mesid")),
                )

            conn.commit()
        finally:
            conn.close()

    # ==================== 对话追踪记录相关方法 ====================

    def add_eavesdrop_record(
        self,
        chat_branch: str,
        context_fingerprint: str,
        speakers: List[str],
        segments: List[Dict],
        scene_description: str = None,
        audio_path: str = None,
        audio_url: str = None,
        trigger_floor: int = None,
        status: str = "pending",
    ) -> Optional[int]:
        """
        添加对话追踪记录

        Returns:
            记录ID,如果已存在则返回 None
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        speakers_json = json.dumps(speakers, ensure_ascii=False)
        segments_json = json.dumps(segments, ensure_ascii=False)

        try:
            cursor.execute(
                """
                INSERT INTO eavesdrop_records (
                    chat_branch, context_fingerprint, speakers, segments,
                    scene_description, audio_path, audio_url, trigger_floor, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    chat_branch,
                    context_fingerprint,
                    speakers_json,
                    segments_json,
                    scene_description,
                    audio_path,
                    audio_url,
                    trigger_floor,
                    status,
                ),
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            return None
        finally:
            conn.close()

    def is_eavesdrop_generated(
        self, chat_branch: str, context_fingerprint: str
    ) -> bool:
        """
        检查指定上下文指纹是否已成功生成过对话追踪

        Args:
            chat_branch: 对话分支ID (保留参数兼容性，但查询时仅用指纹)
            context_fingerprint: 上下文指纹

        Returns:
            True 表示已成功生成, False 表示未生成或生成失败
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            # 只检查状态为 'completed' 的记录,允许 'failed' 状态的记录重试
            # ✅ 仅使用指纹查询，因为指纹才是唯一标准
            cursor.execute(
                """
                SELECT COUNT(*) FROM eavesdrop_records 
                WHERE context_fingerprint = ? AND status = 'completed'
            """,
                (context_fingerprint,),
            )
            count = cursor.fetchone()[0]
            return count > 0
        finally:
            conn.close()

    def update_eavesdrop_status(
        self,
        record_id: int,
        status: str,
        audio_path: str = None,
        audio_url: str = None,
        segments: List[Dict] = None,
        error_message: str = None,
    ):
        """更新对话追踪记录状态"""
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            if audio_path or segments:
                # 需要更新音频路径或 segments
                segments_json = (
                    json.dumps(segments, ensure_ascii=False) if segments else None
                )
                if segments_json:
                    cursor.execute(
                        """
                        UPDATE eavesdrop_records 
                        SET status = ?, audio_path = ?, audio_url = ?, segments = ?, error_message = ?
                        WHERE id = ?
                    """,
                        (
                            status,
                            audio_path,
                            audio_url,
                            segments_json,
                            error_message,
                            record_id,
                        ),
                    )
                else:
                    cursor.execute(
                        """
                        UPDATE eavesdrop_records 
                        SET status = ?, audio_path = ?, audio_url = ?, error_message = ?
                        WHERE id = ?
                    """,
                        (status, audio_path, audio_url, error_message, record_id),
                    )
            else:
                cursor.execute(
                    """
                    UPDATE eavesdrop_records 
                    SET status = ?, error_message = ?
                    WHERE id = ?
                """,
                    (status, error_message, record_id),
                )
            conn.commit()
        finally:
            conn.close()

    def get_eavesdrop_history(
        self, chat_branch: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """获取对话追踪历史记录"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                SELECT * FROM eavesdrop_records 
                WHERE chat_branch = ? AND status = 'completed'
                ORDER BY created_at DESC 
                LIMIT ?
            """,
                (chat_branch, limit),
            )
            rows = cursor.fetchall()
            return [self._eavesdrop_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    def get_eavesdrop_record(self, record_id: int) -> Optional[Dict[str, Any]]:
        """根据 ID 获取单个对话追踪记录"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            cursor.execute("SELECT * FROM eavesdrop_records WHERE id = ?", (record_id,))
            row = cursor.fetchone()
            if row:
                return self._eavesdrop_row_to_dict(row)
            return None
        finally:
            conn.close()

    def _eavesdrop_row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        """将对话追踪记录行转换为字典"""
        d = dict(row)
        if d.get("speakers"):
            try:
                d["speakers"] = json.loads(d["speakers"])
            except:
                d["speakers"] = []
        if d.get("segments"):
            try:
                d["segments"] = json.loads(d["segments"])
            except:
                d["segments"] = []
        return d

    # ==================== 持续性分析记录相关方法 ====================

    def add_analysis_record(
        self,
        chat_branch: str,
        context_fingerprint: str,
        floor: int,
        characters_data: Dict,
        scene_summary: str = None,
        raw_llm_response: str = None,
        summary: str = None,
        character_states: Dict = None,
        suggested_action: str = "none",
        trigger_reason: str = None,
        character_left: str = None,
    ) -> Optional[int]:
        """
        添加持续性分析记录

        Args:
            chat_branch: 对话分支ID
            context_fingerprint: 上下文指纹
            floor: 楼层数
            characters_data: 角色数据字典 {角色名: {present, location, emotion, intent, ...}}
            scene_summary: 场景摘要
            raw_llm_response: LLM 原始响应
            summary: 简短摘要(专门给LLM用,压缩版)
            character_states: 开放式角色状态(物理、情绪、认知、社交四维度)
            suggested_action: 触发建议 (phone_call, eavesdrop, none)
            trigger_reason: 触发原因
            character_left: 离场角色名

        Returns:
            记录ID,如果已存在则返回 None
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        characters_json = json.dumps(characters_data, ensure_ascii=False)
        character_states_json = (
            json.dumps(character_states, ensure_ascii=False)
            if character_states
            else None
        )

        try:
            cursor.execute(
                """
                INSERT INTO continuous_analysis (
                    chat_branch, context_fingerprint, floor, characters_data,
                    scene_summary, raw_llm_response, summary, character_states,
                    suggested_action, trigger_reason, character_left
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    chat_branch,
                    context_fingerprint,
                    floor,
                    characters_json,
                    scene_summary,
                    raw_llm_response,
                    summary,
                    character_states_json,
                    suggested_action,
                    trigger_reason,
                    character_left,
                ),
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            return None
        finally:
            conn.close()

    def get_analysis_history(
        self, chat_branch: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        获取分析历史记录

        Args:
            chat_branch: 对话分支ID
            limit: 返回记录数量限制

        Returns:
            记录列表,按楼层倒序
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                SELECT * FROM continuous_analysis 
                WHERE chat_branch = ? 
                ORDER BY floor DESC 
                LIMIT ?
            """,
                (chat_branch, limit),
            )
            rows = cursor.fetchall()
            return [self._analysis_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    def get_latest_analysis(
        self, chat_branch: str = None, fingerprints: List[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        获取最新的分析记录

        Args:
            chat_branch: 对话分支ID (已弃用，仅作后备)
            fingerprints: 上下文指纹列表 (优先使用)

        Returns:
            最新记录或 None
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            if fingerprints:
                # ✅ 优先使用指纹查询
                placeholders = ",".join("?" * len(fingerprints))
                cursor.execute(
                    f"""
                    SELECT * FROM continuous_analysis 
                    WHERE context_fingerprint IN ({placeholders})
                    ORDER BY floor DESC 
                    LIMIT 1
                """,
                    fingerprints,
                )
            elif chat_branch:
                # 后备：使用分支查询
                cursor.execute(
                    """
                    SELECT * FROM continuous_analysis 
                    WHERE chat_branch = ? 
                    ORDER BY floor DESC 
                    LIMIT 1
                """,
                    (chat_branch,),
                )
            else:
                return None

            row = cursor.fetchone()
            if row:
                return self._analysis_row_to_dict(row)
            return None
        finally:
            conn.close()

    def get_character_history(
        self,
        character_name: str,
        limit: int = 20,
        chat_branch: str = None,
        fingerprints: List[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        获取特定角色的历史轨迹

        Args:
            character_name: 角色名称
            limit: 返回记录数量限制
            chat_branch: 对话分支ID (已弃用，仅作后备)
            fingerprints: 上下文指纹列表 (优先使用)

        Returns:
            该角色的历史状态记录列表
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            if fingerprints:
                # ✅ 优先使用指纹查询
                placeholders = ",".join("?" * len(fingerprints))
                cursor.execute(
                    f"""
                    SELECT * FROM continuous_analysis 
                    WHERE context_fingerprint IN ({placeholders})
                    ORDER BY floor DESC 
                    LIMIT ?
                """,
                    fingerprints + [limit * 2],
                )
            elif chat_branch:
                # 后备：使用分支查询
                cursor.execute(
                    """
                    SELECT * FROM continuous_analysis 
                    WHERE chat_branch = ? 
                    ORDER BY floor DESC 
                    LIMIT ?
                """,
                    (chat_branch, limit * 2),
                )
            else:
                return []

            rows = cursor.fetchall()
            results = []

            for row in rows:
                record = self._analysis_row_to_dict(row)
                if character_name in record.get("characters_data", {}):
                    char_data = record["characters_data"][character_name]
                    results.append(
                        {
                            "floor": record["floor"],
                            "timestamp": record["timestamp"],
                            **char_data,
                        }
                    )
                    if len(results) >= limit:
                        break

            return results
        finally:
            conn.close()

    def _analysis_row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        """将持续性分析记录行转换为字典"""
        d = dict(row)
        if d.get("characters_data"):
            try:
                d["characters_data"] = json.loads(d["characters_data"])
            except:
                d["characters_data"] = {}
        if d.get("character_states"):
            try:
                d["character_states"] = json.loads(d["character_states"])
            except:
                d["character_states"] = {}
        return d

    def get_recent_trigger_history(
        self, fingerprints: List[str] = None, limit: int = 5, chat_branch: str = None
    ) -> List[Dict[str, Any]]:
        """
        获取最近的触发历史（用于多样性判断）

        Args:
            fingerprints: 上下文指纹列表 (优先使用)
            limit: 返回记录数量限制
            chat_branch: 对话分支ID (已弃用，仅作后备)

        Returns:
            列表，每项包含 floor, suggested_action, character_left 等
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            if fingerprints:
                # ✅ 优先使用指纹查询
                placeholders = ",".join("?" * len(fingerprints))
                cursor.execute(
                    f"""
                    SELECT floor, suggested_action, character_left, trigger_reason, timestamp
                    FROM continuous_analysis 
                    WHERE context_fingerprint IN ({placeholders})
                    ORDER BY floor DESC 
                    LIMIT ?
                """,
                    fingerprints + [limit],
                )
            elif chat_branch:
                # 后备：使用分支查询
                cursor.execute(
                    """
                    SELECT floor, suggested_action, character_left, trigger_reason, timestamp
                    FROM continuous_analysis 
                    WHERE chat_branch = ? 
                    ORDER BY floor DESC 
                    LIMIT ?
                """,
                    (chat_branch, limit),
                )
            else:
                return []

            rows = cursor.fetchall()

            results = []
            for row in rows:
                results.append(
                    {
                        "floor": row["floor"],
                        "action": row["suggested_action"] or "none",
                        "character": row["character_left"],
                        "reason": row["trigger_reason"],
                        "timestamp": row["timestamp"],
                    }
                )
            return results
        finally:
            conn.close()

    # ==================== 记忆快照相关方法 ====================

    def add_memory_snapshot(
        self,
        context_fingerprint: str,
        source: str,
        source_id: str,
        plot_summary: str,
        character_profiles: Optional[Dict] = None,
        key_events: Optional[List] = None,
        speakers: Optional[List[str]] = None,
        parent_fingerprint: Optional[str] = None,
        floor: Optional[int] = None,
        namespace_key: Optional[str] = None,
        mode: Optional[str] = None,
        story_id: Optional[str] = None,
    ) -> Optional[int]:
        """添加记忆快照"""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            profiles_json = json.dumps(character_profiles or {}, ensure_ascii=False)
            events_json = json.dumps(key_events or [], ensure_ascii=False)
            speakers_json = json.dumps(speakers or [], ensure_ascii=False)

            cursor.execute(
                """
                INSERT INTO memory_snapshots (
                    context_fingerprint, parent_fingerprint, source, source_id,
                    namespace_key, mode, story_id, floor, plot_summary, character_profiles, key_events, speakers
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    context_fingerprint,
                    parent_fingerprint,
                    source,
                    source_id,
                    namespace_key,
                    mode,
                    story_id,
                    floor,
                    plot_summary,
                    profiles_json,
                    events_json,
                    speakers_json,
                ),
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            # 指纹已存在，跳过
            return None
        finally:
            conn.close()

    def get_memory_snapshots_by_fingerprints(
        self, fingerprints: List[str], limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        酒馆侧查询：按指纹列表查找记忆快照
        同时匹配 context_fingerprint 和 parent_fingerprint
        """
        if not fingerprints:
            return []
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            placeholders = ",".join("?" * len(fingerprints))
            cursor.execute(
                f"""
                SELECT * FROM memory_snapshots
                WHERE context_fingerprint IN ({placeholders})
                   OR parent_fingerprint IN ({placeholders})
                ORDER BY created_at DESC LIMIT ?
            """,
                fingerprints + fingerprints + [limit],
            )
            return [self._snapshot_row_to_dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_memory_snapshots_latest(
        self,
        source: str = None,
        source_id: str = None,
        limit: int = 5,
        namespace_key: str = None,
    ) -> List[Dict[str, Any]]:
        """
        TG 侧查询：按最新时间获取记忆快照
        """
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            if namespace_key:
                cursor.execute(
                    """
                    SELECT * FROM memory_snapshots
                    WHERE namespace_key = ?
                    ORDER BY created_at DESC LIMIT ?
                """,
                    (namespace_key, limit),
                )
            elif source and source_id:
                cursor.execute(
                    """
                    SELECT * FROM memory_snapshots
                    WHERE source = ? AND source_id = ?
                    ORDER BY created_at DESC LIMIT ?
                """,
                    (source, source_id, limit),
                )
            else:
                cursor.execute(
                    """
                    SELECT * FROM memory_snapshots
                    ORDER BY created_at DESC LIMIT ?
                """,
                    (limit,),
                )
            return [self._snapshot_row_to_dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_latest_tavern_fingerprint(self) -> Optional[str]:
        """获取最新的酒馆记忆指纹（供 TG 写入时做 parent_fingerprint）"""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT context_fingerprint FROM memory_snapshots
                WHERE source = 'tavern'
                ORDER BY created_at DESC LIMIT 1
            """)
            row = cursor.fetchone()
            return row[0] if row else None
        finally:
            conn.close()

    def upsert_telegram_bot(
        self,
        bot_id: str,
        character_id: str,
        character_name: str,
        bot_token: str,
        username: str = None,
        tts_character: str = None,
        voice_enabled: bool = False,
        allowed_chat_ids: List[str] = None,
        enabled: bool = True,
    ):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            allowed_chat_ids_json = json.dumps(
                allowed_chat_ids or [], ensure_ascii=False
            )
            cursor.execute(
                """
                INSERT INTO telegram_bots (
                    bot_id, character_id, character_name, username, bot_token,
                    tts_character, voice_enabled, allowed_chat_ids, enabled
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bot_id) DO UPDATE SET
                    character_id = excluded.character_id,
                    character_name = excluded.character_name,
                    username = excluded.username,
                    bot_token = excluded.bot_token,
                    tts_character = excluded.tts_character,
                    voice_enabled = excluded.voice_enabled,
                    allowed_chat_ids = excluded.allowed_chat_ids,
                    enabled = excluded.enabled,
                    updated_at = CURRENT_TIMESTAMP
            """,
                (
                    bot_id,
                    character_id,
                    character_name,
                    username,
                    bot_token,
                    tts_character,
                    int(bool(voice_enabled)),
                    allowed_chat_ids_json,
                    int(bool(enabled)),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def set_active_telegram_session(
        self,
        chat_id: str,
        namespace_key: str,
        mode: str,
        story_id: str = None,
        title: str = None,
        summary: str = None,
    ):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE telegram_sessions SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?",
                (chat_id,),
            )
            cursor.execute(
                """
                INSERT INTO telegram_sessions (
                    namespace_key, chat_id, mode, story_id, is_active, title, summary
                ) VALUES (?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(namespace_key) DO UPDATE SET
                    chat_id = excluded.chat_id,
                    mode = excluded.mode,
                    story_id = excluded.story_id,
                    is_active = 1,
                    title = COALESCE(excluded.title, telegram_sessions.title),
                    summary = COALESCE(excluded.summary, telegram_sessions.summary),
                    updated_at = CURRENT_TIMESTAMP
            """,
                (namespace_key, chat_id, mode, story_id, title, summary),
            )
            conn.commit()
        finally:
            conn.close()

    def get_active_telegram_session(self, chat_id: str) -> Optional[Dict[str, Any]]:
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT * FROM telegram_sessions
                WHERE chat_id = ? AND is_active = 1
                ORDER BY updated_at DESC
                LIMIT 1
            """,
                (chat_id,),
            )
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_telegram_sessions(self, chat_id: str) -> List[Dict[str, Any]]:
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT * FROM telegram_sessions
                WHERE chat_id = ?
                ORDER BY updated_at DESC
            """,
                (chat_id,),
            )
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def add_telegram_message(
        self,
        namespace_key: str,
        chat_id: str,
        speaker_type: str,
        role: str,
        content: str,
        source_bot_id: Optional[str] = None,
        source_bot_username: Optional[str] = None,
        sender_user_id: Optional[str] = None,
        sender_display_name: Optional[str] = None,
        character_id: Optional[str] = None,
        character_name: Optional[str] = None,
        delivery: str = "text",
        emotion: Optional[str] = None,
        telegram_message_id: Optional[int] = None,
        reply_to_message_id: Optional[int] = None,
    ) -> int:
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                INSERT INTO telegram_messages (
                    namespace_key, chat_id, speaker_type, source_bot_id, source_bot_username,
                    sender_user_id, sender_display_name, character_id, character_name,
                    role, content, delivery, emotion, telegram_message_id, reply_to_message_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    namespace_key,
                    chat_id,
                    speaker_type,
                    source_bot_id,
                    source_bot_username,
                    sender_user_id,
                    sender_display_name,
                    character_id,
                    character_name,
                    role,
                    content,
                    delivery,
                    emotion,
                    telegram_message_id,
                    reply_to_message_id,
                ),
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_telegram_messages(
        self, namespace_key: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT * FROM telegram_messages
                WHERE namespace_key = ?
                ORDER BY id DESC
                LIMIT ?
            """,
                (namespace_key, limit),
            )
            rows = cursor.fetchall()
            return [dict(row) for row in reversed(rows)]
        finally:
            conn.close()

    def clear_telegram_messages(self, namespace_key: str):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM telegram_messages WHERE namespace_key = ?",
                (namespace_key,),
            )
            conn.commit()
        finally:
            conn.close()

    def upsert_telegram_story_state(
        self,
        namespace_key: str,
        mode: str,
        story_id: Optional[str] = None,
        chapter_id: Optional[str] = None,
        current_goal: Optional[str] = None,
        summary: Optional[str] = None,
        state_json: Optional[Dict[str, Any]] = None,
    ):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            state_text = json.dumps(state_json or {}, ensure_ascii=False)
            cursor.execute(
                """
                INSERT INTO telegram_story_states (
                    namespace_key, mode, story_id, chapter_id, current_goal, summary, state_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(namespace_key) DO UPDATE SET
                    mode = excluded.mode,
                    story_id = excluded.story_id,
                    chapter_id = COALESCE(excluded.chapter_id, telegram_story_states.chapter_id),
                    current_goal = COALESCE(excluded.current_goal, telegram_story_states.current_goal),
                    summary = COALESCE(excluded.summary, telegram_story_states.summary),
                    state_json = excluded.state_json,
                    updated_at = CURRENT_TIMESTAMP
            """,
                (
                    namespace_key,
                    mode,
                    story_id,
                    chapter_id,
                    current_goal,
                    summary,
                    state_text,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_telegram_story_state(self, namespace_key: str) -> Optional[Dict[str, Any]]:
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT * FROM telegram_story_states WHERE namespace_key = ?",
                (namespace_key,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            data = dict(row)
            if data.get("state_json"):
                try:
                    data["state_json"] = json.loads(data["state_json"])
                except Exception:
                    data["state_json"] = {}
            return data
        finally:
            conn.close()

    def _snapshot_row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        """将快照记录行转换为字典"""
        d = dict(row)
        for field in ("character_profiles", "key_events", "speakers"):
            if d.get(field):
                try:
                    d[field] = json.loads(d[field])
                except:
                    d[field] = {} if field == "character_profiles" else []
        return d

    # ==================== 人物画像 (角色卡静态数据) ====================

    def upsert_memory_profile(
        self, char_name: str, profile_key: str, profile_val: str, source: str = "auto"
    ):
        """插入或更新人物画像"""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                INSERT INTO memory_profiles (char_name, profile_key, profile_val, source)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(char_name, profile_key) DO UPDATE SET
                    profile_val = excluded.profile_val,
                    source = excluded.source,
                    updated_at = CURRENT_TIMESTAMP
            """,
                (char_name, profile_key, profile_val, source),
            )
            conn.commit()
        finally:
            conn.close()

    def get_memory_profiles(self, char_name: str) -> Dict[str, str]:
        """获取角色的全部画像 KV"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                SELECT profile_key, profile_val FROM memory_profiles
                WHERE char_name = ?
                ORDER BY updated_at DESC
            """,
                (char_name,),
            )
            return {row["profile_key"]: row["profile_val"] for row in cursor.fetchall()}
        finally:
            conn.close()

    # ==================== Telegram 多用户系统表 ====================

    def upsert_telegram_user(
        self,
        user_id: str,
        chat_id: str = None,
        username: str = None,
        first_name: str = None,
        persona: str = None,
    ):
        """插入或更新Telegram用户信息（如果有任何一个字段非空，则更新对应字段）"""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            # 先检查是否存在
            cursor.execute("SELECT * FROM telegram_users WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            if row:
                # 动态更新提供的非空字段
                updates = []
                params = []
                if chat_id is not None:
                    updates.append("chat_id = ?")
                    params.append(chat_id)
                if username is not None:
                    updates.append("username = ?")
                    params.append(username)
                if first_name is not None:
                    updates.append("first_name = ?")
                    params.append(first_name)
                if persona is not None:
                    updates.append("persona = ?")
                    params.append(persona)

                if updates:
                    updates.append("updated_at = CURRENT_TIMESTAMP")
                    query = f"UPDATE telegram_users SET {', '.join(updates)} WHERE user_id = ?"
                    params.append(user_id)
                    cursor.execute(query, tuple(params))
            else:
                cursor.execute(
                    """
                    INSERT INTO telegram_users (user_id, chat_id, username, first_name, persona)
                    VALUES (?, ?, ?, ?, ?)
                """,
                    (user_id, chat_id, username, first_name, persona),
                )
            conn.commit()
        finally:
            conn.close()

    def get_telegram_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """获取单个Telegram用户信息"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT * FROM telegram_users WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
        finally:
            conn.close()

    def get_telegram_users_in_chat(self, chat_id: str) -> List[Dict[str, Any]]:
        """获取在某个群组下记录过活动的所有用户"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT * FROM telegram_users WHERE chat_id = ? OR chat_id IS NULL",
                (chat_id,),
            )
            # 这里简化逻辑，只要是在该系统的所有 user 都可以返回，因为可能是跨群组的同一用户
            # 但实际上如果只需要近期活跃的用户，可以在 LLM Handler 里直接过滤。这里提供全集备用。
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()
