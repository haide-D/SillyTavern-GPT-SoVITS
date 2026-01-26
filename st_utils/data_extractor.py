import re
from typing import List, Dict, Optional
from dataclasses import dataclass, field
from st_utils.context_converter import ContextConverter


@dataclass
class ExtractorConfig:
    """单个提取器配置"""
    name: str                           # 提取器名称
    pattern: str                        # 正则表达式模式
    scope: str = "all"                  # 过滤范围: "character_only" | "user_only" | "all"
    limit: Optional[int] = None         # 限制提取数量
    recent_only: Optional[int] = None   # 仅从最近N条消息提取
    deduplicate: bool = True            # 是否去重


class DataExtractor:
    """数据提取工具"""
    
    @staticmethod
    def extract(context: List[Dict], extractors: List[ExtractorConfig] = None) -> Dict[str, List[str]]:
        """
        使用配置的提取器从上下文中提取数据
        
        Args:
            context: 对话上下文列表
            extractors: 提取器配置列表 (ExtractorConfig 或 Dict)
            
        Returns:
            提取结果字典 {extractor_name: [matched_values]}
        """
        # 转换上下文为标准格式
        context = ContextConverter.convert_to_standard_format(context)
        
        if not extractors:
            return {}
        
        results = {}
        
        for extractor in extractors:
            # 支持 Dict 和 ExtractorConfig
            if isinstance(extractor, dict):
                name = extractor["name"]
                pattern = extractor["pattern"]
                scope = extractor.get("scope", "all")
                limit = extractor.get("limit")
                recent_only = extractor.get("recent_only")
                deduplicate = extractor.get("deduplicate", True)
            else:
                name = extractor.name
                pattern = extractor.pattern
                scope = extractor.scope
                limit = extractor.limit
                recent_only = extractor.recent_only
                deduplicate = extractor.deduplicate
            
            results[name] = []
            
            # 过滤消息
            filtered_messages = DataExtractor._filter_by_scope(context, scope)
            
            # 限制最近消息
            if recent_only and recent_only > 0:
                filtered_messages = filtered_messages[-recent_only:]
            
            # 提取数据
            for msg in filtered_messages:
                content = msg.get('content', '')
                matches = re.findall(pattern, content)
                results[name].extend(matches)
            
            # 去重
            if deduplicate:
                results[name] = list(dict.fromkeys(results[name]))
            
            # 限制数量
            if limit and limit > 0:
                results[name] = results[name][:limit]
            
            print(f"[DataExtractor] {name}: 提取到 {len(results[name])} 项数据")
        
        return results
    
    @staticmethod
    def _filter_by_scope(context: List[Dict], scope: str) -> List[Dict]:
        """按scope过滤消息"""
        if scope == "character_only":
            return [msg for msg in context if msg.get('role') == 'assistant']
        elif scope == "user_only":
            return [msg for msg in context if msg.get('role') == 'user']
        else:
            return context
