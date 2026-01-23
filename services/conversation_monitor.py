from typing import List, Dict, Optional
from config import load_json, SETTINGS_FILE


class ConversationMonitor:
    """对话监控服务 - 监控对话轮次变化,判断是否触发自动生成"""
    
    def __init__(self):
        self.settings = load_json(SETTINGS_FILE)
        self.auto_config = self.settings.get("phone_call", {}).get("auto_generation", {})
    
    def is_enabled(self) -> bool:
        """检查自动生成功能是否启用"""
        # 先检查电话功能总开关
        phone_call_enabled = self.settings.get("phone_call", {}).get("enabled", True)
        if not phone_call_enabled:
            print(f"[ConversationMonitor] 电话功能总开关已禁用 (phone_call.enabled = false)")
            return False
        
        # 再检查自动生成子功能开关
        auto_enabled = self.auto_config.get("enabled", False)
        if not auto_enabled:
            print(f"[ConversationMonitor] 自动生成功能未启用 (auto_generation.enabled = false)")
            return False
        
        return True
    
    def should_trigger(self, char_name: str, current_floor: int) -> bool:
        """
        判断是否应该触发自动生成
        
        Args:
            char_name: 角色名称
            current_floor: 当前对话楼层(轮次)
            
        Returns:
            True 表示应该触发, False 表示不触发
        """
        if not self.is_enabled():
            print(f"[ConversationMonitor] 自动生成功能未启用")
            return False
        
        # 获取触发策略配置
        strategy = self.auto_config.get("trigger_strategy", "floor_interval")
        
        if strategy == "floor_interval":
            return self._check_floor_interval(current_floor)
        else:
            print(f"[ConversationMonitor] 未知的触发策略: {strategy}")
            return False
    
    def _check_floor_interval(self, current_floor: int) -> bool:
        """
        检查楼层间隔触发条件
        
        Args:
            current_floor: 当前楼层
            
        Returns:
            True 表示满足触发条件
        """
        start_floor = self.auto_config.get("start_floor", 3)
        interval = self.auto_config.get("floor_interval", 3)
        
        # 楼层必须 >= 起始楼层
        if current_floor < start_floor:
            return False
        
        # 检查是否是间隔的倍数
        # 例如: start_floor=3, interval=3, 则触发楼层为 3, 6, 9, 12...
        if (current_floor - start_floor) % interval == 0 and current_floor >= start_floor:
            return True
        
        return False
    
    def extract_context(self, context: List[Dict], max_messages: Optional[int] = None) -> List[Dict]:
        """
        提取对话上下文
        
        Args:
            context: 完整对话上下文
            max_messages: 最大消息数量,默认从配置读取
            
        Returns:
            提取后的上下文
        """
        if max_messages is None:
            max_messages = self.auto_config.get("max_context_messages", 10)
        
        # 取最近的 N 条消息
        return context[-max_messages:] if len(context) > max_messages else context
    
    def get_trigger_floor(self, current_floor: int) -> int:
        """
        获取当前楼层对应的触发楼层
        
        用于数据库去重,例如第3轮触发,trigger_floor就是3
        
        Args:
            current_floor: 当前楼层
            
        Returns:
            触发楼层
        """
        return current_floor
