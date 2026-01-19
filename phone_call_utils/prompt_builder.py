from typing import List, Dict


class PromptBuilder:
    """提示词构建工具"""
    
    @staticmethod
    def build(template: str, char_name: str, context: List[Dict], 
              extracted_data: Dict, emotions: List[str]) -> str:
        """
        构建LLM提示词
        
        Args:
            template: 提示词模板
            char_name: 角色名称
            context: 对话上下文
            extracted_data: 提取的数据
            emotions: 可用情绪列表
            
        Returns:
            完整提示词
        """
        formatted_context = PromptBuilder._format_context(context)
        formatted_data = PromptBuilder._format_extracted_data(extracted_data)
        formatted_emotions = ", ".join(emotions)
        
        prompt = template.replace("{{char_name}}", char_name)
        prompt = prompt.replace("{{context}}", formatted_context)
        prompt = prompt.replace("{{extracted_data}}", formatted_data)
        prompt = prompt.replace("{{emotions}}", formatted_emotions)
        
        return prompt
    
    @staticmethod
    def _format_context(context: List[Dict]) -> str:
        """
        格式化上下文为文本
        
        Args:
            context: 对话上下文
            
        Returns:
            格式化的文本
        """
        lines = []
        for msg in context:
            role = "用户" if msg["role"] == "user" else "角色"
            lines.append(f"{role}: {msg['content']}")
        return "\n".join(lines)
    
    @staticmethod
    def _format_extracted_data(data: Dict) -> str:
        """
        格式化提取的数据
        
        Args:
            data: 提取的数据字典
            
        Returns:
            格式化的文本
        """
        if not data:
            return "无"
        
        lines = []
        for key, values in data.items():
            if values:
                lines.append(f"{key}: {', '.join(values)}")
        
        return "\n".join(lines) if lines else "无"
