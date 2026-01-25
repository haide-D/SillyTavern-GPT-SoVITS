# 场景管理器 - 单例模式

from typing import Dict, Optional, List
from .base import BasePromptBuilder


class SceneManager:
    """
    场景管理器 - 单例模式
    
    职责:
    1. 注册场景构建器
    2. 获取场景构建器
    3. 列出所有可用场景
    """
    
    _instance = None
    _scenes: Dict[str, BasePromptBuilder] = {}
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def register(cls, builder: BasePromptBuilder) -> None:
        """
        注册场景构建器
        
        Args:
            builder: 场景构建器实例
        """
        cls._scenes[builder.scene_id] = builder
        print(f"[SceneManager] ✅ 注册场景: {builder.scene_id} ({builder.scene_name})")
    
    @classmethod
    def unregister(cls, scene_id: str) -> bool:
        """
        注销场景
        
        Args:
            scene_id: 场景ID
            
        Returns:
            是否成功注销
        """
        if scene_id in cls._scenes:
            del cls._scenes[scene_id]
            print(f"[SceneManager] 🗑️ 注销场景: {scene_id}")
            return True
        return False
    
    @classmethod
    def get(cls, scene_id: str) -> Optional[BasePromptBuilder]:
        """
        获取场景构建器
        
        Args:
            scene_id: 场景ID
            
        Returns:
            场景构建器实例，如果不存在返回 None
        """
        return cls._scenes.get(scene_id)
    
    @classmethod
    def get_or_default(cls, scene_id: str, default_id: str = "casual_chat") -> BasePromptBuilder:
        """
        获取场景构建器，如果不存在返回默认场景
        
        Args:
            scene_id: 场景ID
            default_id: 默认场景ID
            
        Returns:
            场景构建器实例
        """
        builder = cls._scenes.get(scene_id)
        if builder is None:
            print(f"[SceneManager] ⚠️ 场景 {scene_id} 不存在，使用默认场景 {default_id}")
            builder = cls._scenes.get(default_id)
        return builder
    
    @classmethod
    def list_scenes(cls) -> List[Dict]:
        """
        列出所有已注册场景
        
        Returns:
            场景列表 [{"id": str, "name": str}, ...]
        """
        return [
            {"id": builder.scene_id, "name": builder.scene_name}
            for builder in cls._scenes.values()
        ]
    
    @classmethod
    def has(cls, scene_id: str) -> bool:
        """
        检查场景是否存在
        
        Args:
            scene_id: 场景ID
            
        Returns:
            是否存在
        """
        return scene_id in cls._scenes
    
    @classmethod
    def count(cls) -> int:
        """返回已注册场景数量"""
        return len(cls._scenes)
