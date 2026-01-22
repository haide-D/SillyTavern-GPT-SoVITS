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
        cursor.execute('''
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
        ''')
        
        # 创建 auto_phone_calls 表 - 自动生成电话记录
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS auto_phone_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                char_name TEXT,
                trigger_floor INTEGER NOT NULL,
                segments TEXT NOT NULL,
                audio_path TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                UNIQUE(trigger_floor)
            )
        ''')
        
        # 创建 conversation_speakers 表 - 对话说话人记录
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS conversation_speakers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_branch TEXT NOT NULL,
                speakers TEXT NOT NULL,
                last_updated_mesid INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(chat_branch)
            )
        ''')

        
        conn.commit()
        conn.close()

    def add_favorite(self, data: Dict[str, Any]):
        """添加新的收藏记录"""
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # 处理 list 类型的字段，转换为 JSON 字符串存储
        context_json = json.dumps(data.get("context", []))
        
        try:
            cursor.execute('''
                INSERT INTO favorites (
                    id, text, audio_url, char_name, context, tags, 
                    filename, chat_branch, fingerprint, created_at, relative_path, emotion
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
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
                data.get("emotion", "")
            ))
            conn.commit()
        finally:
            conn.close()

    def get_favorite(self, fav_id: str) -> Optional[Dict[str, Any]]:
        """根据 ID 获取单个收藏记录"""
        conn = self._get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute('SELECT * FROM favorites WHERE id = ?', (fav_id,))
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
            cursor.execute('DELETE FROM favorites WHERE id = ?', (fav_id,))
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
            cursor.execute('SELECT * FROM favorites ORDER BY created_at DESC')
            rows = cursor.fetchall()
            return [self._row_to_dict(row) for row in rows]
        finally:
            conn.close()

    def get_matched_favorites(self, fingerprints: List[str], chat_branch: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
        """获取匹配的收藏记录"""
        all_favs = self.get_all_favorites()
        current_fp_set = set(fingerprints)
        
        result_current = []
        result_others = []

        for fav in all_favs:
            is_match = False
            fav_fp = fav.get('fingerprint')
            
            if fav_fp and fav_fp in current_fp_set:
                is_match = True
            elif chat_branch and fav.get('chat_branch') == chat_branch:
                is_match = True
            
            fav['is_current'] = is_match
            if is_match:
                result_current.append(fav)
            else:
                result_others.append(fav)
                
        return {
            "current": result_current,
            "others": result_others,
            "total_count": len(all_favs)
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
    
    def add_auto_phone_call(self, trigger_floor: int, segments: List[Dict], 
                           char_name: Optional[str] = None,
                           audio_path: Optional[str] = None, status: str = "pending") -> Optional[int]:
        """
        添加自动电话生成记录
        
        Args:
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
            cursor.execute('''
                INSERT INTO auto_phone_calls (
                    trigger_floor, char_name, segments, audio_path, status
                ) VALUES (?, ?, ?, ?, ?)
            ''', (trigger_floor, char_name, segments_json, audio_path, status))
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            # 违反唯一约束,已存在相同记录
            return None
        finally:
            conn.close()
    
    def is_auto_call_generated(self, trigger_floor: int) -> bool:
        """
        检查指定楼层是否已成功生成过自动电话
        
        Args:
            trigger_floor: 触发楼层
            
        Returns:
            True 表示已成功生成, False 表示未生成或生成失败
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            # 只检查状态为 'completed' 的记录,允许 'failed' 状态的记录重试
            cursor.execute('''
                SELECT COUNT(*) FROM auto_phone_calls 
                WHERE trigger_floor = ? AND status = 'completed'
            ''', (trigger_floor,))
            count = cursor.fetchone()[0]
            return count > 0
        finally:
            conn.close()
    
    def update_auto_call_status(self, call_id: int, status: str, 
                               audio_path: Optional[str] = None, 
                               error_message: Optional[str] = None):
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
                cursor.execute('''
                    UPDATE auto_phone_calls 
                    SET status = ?, audio_path = ?, error_message = ?
                    WHERE id = ?
                ''', (status, audio_path, error_message, call_id))
            else:
                cursor.execute('''
                    UPDATE auto_phone_calls 
                    SET status = ?, error_message = ?
                    WHERE id = ?
                ''', (status, error_message, call_id))
            conn.commit()
        finally:
            conn.close()
    
    def get_auto_call_history(self, char_name: str, limit: int = 50) -> List[Dict[str, Any]]:
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
            cursor.execute('''
                SELECT * FROM auto_phone_calls 
                WHERE char_name = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            ''', (char_name, limit))
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
            cursor.execute('''
                SELECT * FROM auto_phone_calls 
                WHERE char_name = ? 
                ORDER BY created_at DESC 
                LIMIT 1
            ''', (char_name,))
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
                'SELECT speakers FROM conversation_speakers WHERE chat_branch = ?',
                (chat_branch,)
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
    
    def update_speakers_for_chat(self, chat_branch: str, speakers: List[str], mesid: Optional[int] = None):
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
            cursor.execute('''
                INSERT INTO conversation_speakers (chat_branch, speakers, last_updated_mesid)
                VALUES (?, ?, ?)
                ON CONFLICT(chat_branch) DO UPDATE SET
                    speakers = excluded.speakers,
                    last_updated_mesid = excluded.last_updated_mesid,
                    updated_at = CURRENT_TIMESTAMP
            ''', (chat_branch, speakers_json, mesid))
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
                speakers_json = json.dumps(data['speakers'], ensure_ascii=False)
                cursor.execute('''
                    INSERT OR REPLACE INTO conversation_speakers (chat_branch, speakers, last_updated_mesid)
                    VALUES (?, ?, ?)
                ''', (data['chat_branch'], speakers_json, data.get('mesid')))
            
            conn.commit()
        finally:
            conn.close()
