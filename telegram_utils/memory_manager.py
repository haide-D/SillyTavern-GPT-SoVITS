from typing import Dict, List
from config import load_json, SETTINGS_FILE

class MemoryManager:
    """管理 Telegram 会话历史和记忆注入 (预留 P2/P3 接口)"""
    def __init__(self):
        # 简单内存历史 (chat_id -> messages)
        self.history: Dict[str, List[Dict[str, str]]] = {}
    
    def _get_config(self) -> dict:
        settings = load_json(SETTINGS_FILE)
        return settings.get("telegram", {})
        
    def clear_history(self, chat_id: str):
        self.history[chat_id] = []
        
    def add_message(self, chat_id: str, role: str, content: str):
        if chat_id not in self.history:
            self.history[chat_id] = []
        self.history[chat_id].append({"role": role, "content": content})
        
        # 截断历史
        max_history = self._get_config().get("max_history", 20)
        if len(self.history[chat_id]) > max_history:
            self.history[chat_id] = self.history[chat_id][-max_history:]
            
    def get_messages(self, chat_id: str) -> List[Dict[str, str]]:
        return self.history.get(chat_id, [])
        
    async def inject_worldbook(self, chat_id: str, text: str) -> str:
        """[P2 预留] 根据当前文本检索世界书词条，组装进 Prompt"""
        return ""
        
    async def recall_memory(self, chat_id: str, text: str) -> str:
        """[P3 预留] 向量数据库检索历史记忆"""
        return ""
