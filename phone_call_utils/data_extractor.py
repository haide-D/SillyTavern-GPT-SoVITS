import re
from typing import List, Dict


class DataExtractor:
    """数据提取工具"""
    
    @staticmethod
    def extract(context: List[Dict], extractors: List[Dict]) -> Dict[str, List[str]]:
        """
        使用配置的提取器从上下文中提取数据
        
        Args:
            context: 对话上下文列表 [{role, content}, ...]
            extractors: 提取器配置列表 [{name, pattern, scope}, ...]
            
        Returns:
            提取结果字典 {extractor_name: [matched_values]}
        """
        results = {}
        
        for extractor in extractors:
            name = extractor["name"]
            pattern = extractor["pattern"]
            scope = extractor["scope"]
            
            results[name] = []
            
            filtered_messages = DataExtractor._filter_by_scope(context, scope)
            
            for msg in filtered_messages:
                content = msg["content"]
                matches = re.findall(pattern, content)
                results[name].extend(matches)
        
        return results
    
    @staticmethod
    def _filter_by_scope(context: List[Dict], scope: str) -> List[Dict]:
        """
        按scope过滤消息
        
        Args:
            context: 对话上下文
            scope: 过滤范围 ("character_only" | "user_only" | "all")
            
        Returns:
            过滤后的消息列表
        """
        if scope == "character_only":
            return [msg for msg in context if msg["role"] == "assistant"]
        elif scope == "user_only":
            return [msg for msg in context if msg["role"] == "user"]
        else:
            return context
