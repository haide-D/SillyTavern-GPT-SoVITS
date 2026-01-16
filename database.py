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
                relative_path TEXT
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
                    filename, chat_branch, fingerprint, created_at, relative_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                data.get("relative_path")
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
