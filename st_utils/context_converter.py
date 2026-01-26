from typing import List, Dict, Any


class ContextConverter:
    """上下文数据格式转换工具"""
    
    @staticmethod
    def _has_field(obj: Any, field: str) -> bool:
        """
        检查对象是否有指定字段 (兼容字典和 Pydantic 模型)
        
        Args:
            obj: 要检查的对象
            field: 字段名
            
        Returns:
            是否有该字段
        """
        if isinstance(obj, dict):
            return field in obj
        else:
            # Pydantic 模型或其他对象,使用 hasattr
            return hasattr(obj, field)
    
    @staticmethod
    def _get_field(obj: Any, field: str, default: Any = None) -> Any:
        """
        获取对象的字段值 (兼容字典和 Pydantic 模型)
        
        Args:
            obj: 要获取字段的对象
            field: 字段名
            default: 默认值
            
        Returns:
            字段值
        """
        if isinstance(obj, dict):
            return obj.get(field, default)
        else:
            # Pydantic 模型或其他对象,使用 getattr
            return getattr(obj, field, default)
    
    @staticmethod
    def convert_to_standard_format(context: List[Any]) -> List[Dict]:
        """
        将上下文转换为标准格式 {role, content}
        
        支持两种输入格式:
        1. 旧格式: {name, is_user, mes} (字典或 Pydantic 模型)
        2. 新格式: {role, content} (直接返回)
        
        Args:
            context: 对话上下文列表 (可以是字典或 Pydantic 模型)
            
        Returns:
            标准格式的上下文列表 [{role, content}, ...]
        """
        if not context:
            return []
        
        result = []
        for msg in context:
            # 使用兼容方法检测格式
            has_role = ContextConverter._has_field(msg, 'role')
            has_content = ContextConverter._has_field(msg, 'content')
            has_is_user = ContextConverter._has_field(msg, 'is_user')
            has_mes = ContextConverter._has_field(msg, 'mes')
            
            # 检测格式
            if has_role and has_content:
                # 已经是标准格式,直接使用
                role = ContextConverter._get_field(msg, 'role')
                content = ContextConverter._get_field(msg, 'content')
                result.append({
                    'role': role,
                    'content': content
                })
            elif has_is_user and has_mes:
                # 旧格式,需要转换
                is_user = ContextConverter._get_field(msg, 'is_user')
                mes = ContextConverter._get_field(msg, 'mes', '')
                role = 'user' if is_user else 'assistant'
                result.append({
                    'role': role,
                    'content': mes
                })
            else:
                # 未知格式,跳过
                print(f"[ContextConverter] 警告: 未知的消息格式,跳过: {msg}")
                continue
        
        return result
    
    @staticmethod
    def is_standard_format(msg: Dict) -> bool:
        """
        检测消息是否为标准格式
        
        Args:
            msg: 消息对象
            
        Returns:
            是否为标准格式
        """
        return 'role' in msg and 'content' in msg
