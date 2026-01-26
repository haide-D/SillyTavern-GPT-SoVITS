import re
from typing import Optional, List
from dataclasses import dataclass, field


@dataclass
class FilterConfig:
    """过滤配置"""
    extract_tag: Optional[str] = None  # 提取标签 (如 "conxt")
    filter_tags: List[str] = field(default_factory=list)  # 过滤标签列表


class MessageFilter:
    """
    消息内容过滤工具
    
    支持:
    1. 提取指定标签内的内容
    2. 过滤指定标签包裹的内容
    """
    
    @staticmethod
    def filter(text: str, config: FilterConfig = None) -> str:
        """
        根据配置过滤文本
        
        Args:
            text: 原始文本
            config: 过滤配置
            
        Returns:
            处理后的文本
        """
        if not text or not isinstance(text, str):
            return text
        
        if config is None:
            return text
        
        processed = text
        
        # 步骤1: 提取标签内容
        if config.extract_tag:
            processed = MessageFilter._extract_content(processed, config.extract_tag)
        
        # 步骤2: 过滤标签
        if config.filter_tags:
            for tag in config.filter_tags:
                processed = MessageFilter._filter_tag(processed, tag)
        
        return processed
    
    @staticmethod
    def extract_and_filter(text: str, extract_tag: str = "", filter_tags: str = "") -> str:
        """
        兼容旧接口: 两步处理消息内容
        
        Args:
            text: 原始文本
            extract_tag: 提取标签名称(如 "conxt"),留空则跳过
            filter_tags: 过滤标签(逗号分隔),如 "<small>, [statbar]"
            
        Returns:
            处理后的文本
        """
        # 构建配置
        tags_list = [t.strip() for t in filter_tags.split(',') if t.strip()] if filter_tags else []
        config = FilterConfig(
            extract_tag=extract_tag.strip() if extract_tag else None,
            filter_tags=tags_list
        )
        return MessageFilter.filter(text, config)
    
    @staticmethod
    def _extract_content(text: str, tag_name: str) -> str:
        """提取指定标签内的内容"""
        pattern = f"<{re.escape(tag_name)}>(.*?)</{re.escape(tag_name)}>"
        match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        
        if match:
            return match.group(1)
        return text
    
    @staticmethod
    def _filter_tag(text: str, tag: str) -> str:
        """过滤单个标签"""
        filtered = text
        
        # 格式: 前缀|后缀
        if '|' in tag:
            parts = tag.split('|')
            if len(parts) == 2 and parts[0] and parts[1]:
                prefix, suffix = parts[0], parts[1]
                pattern = f"{re.escape(prefix)}[\\s\\S]*?{re.escape(suffix)}"
                filtered = re.sub(pattern, '', filtered, flags=re.IGNORECASE)
        
        # 格式: <tag>
        elif tag.startswith('<') and tag.endswith('>'):
            tag_name = tag[1:-1]
            pattern = f"<{tag_name}[^>]*>[\\s\\S]*?</{tag_name}>"
            filtered = re.sub(pattern, '', filtered, flags=re.IGNORECASE)
        
        # 格式: [tag]
        elif tag.startswith('[') and tag.endswith(']'):
            tag_name = tag[1:-1]
            escaped_tag = re.escape(tag_name)
            pattern = f"\\[{escaped_tag}\\][\\s\\S]*?\\[/{escaped_tag}\\]"
            filtered = re.sub(pattern, '', filtered, flags=re.IGNORECASE)
        
        return filtered
    
    @staticmethod
    def apply_filter_tags(text: str, filter_tags: str) -> str:
        """兼容旧接口"""
        return MessageFilter.extract_and_filter(text, "", filter_tags)
