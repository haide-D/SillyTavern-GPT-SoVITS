# 文本分段器 - 用于实时对话的流式文本处理

import re
from typing import Optional, Tuple


class TextChunker:
    """
    文本分段器 - 将流式输入的文本分割成适合TTS的片段
    
    支持两种策略:
    1. 按标点分段 (句号、问号、感叹号、逗号)
    2. 按字数分段 (达到最大长度强制分段)
    """
    
    # 分段标点 (优先级从高到低)
    SENTENCE_ENDINGS = r'[。！？!?]'
    CLAUSE_ENDINGS = r'[，,；;：:]'
    
    def __init__(
        self,
        min_length: int = 5,
        max_length: int = 50,
        prefer_sentence: bool = True
    ):
        """
        Args:
            min_length: 最小分段长度 (避免太短的片段)
            max_length: 最大分段长度 (强制分段)
            prefer_sentence: 是否优先按句子分段
        """
        self.min_length = min_length
        self.max_length = max_length
        self.prefer_sentence = prefer_sentence
        self._buffer = ""
    
    def feed(self, text: str) -> list[str]:
        """
        喂入流式文本，返回可发送的片段列表
        
        Args:
            text: 新收到的文本片段
            
        Returns:
            可发送给TTS的片段列表 (可能为空)
        """
        self._buffer += text
        chunks = []
        
        while True:
            chunk = self._try_extract()
            if chunk:
                chunks.append(chunk)
            else:
                break
        
        return chunks
    
    def flush(self) -> Optional[str]:
        """
        强制输出缓冲区剩余内容 (用于对话结束时)
        
        Returns:
            剩余的文本片段，如果为空则返回None
        """
        if self._buffer.strip():
            result = self._buffer.strip()
            self._buffer = ""
            return result
        return None
    
    def clear(self) -> None:
        """清空缓冲区 (用于打断对话时)"""
        self._buffer = ""
    
    def _try_extract(self) -> Optional[str]:
        """尝试从缓冲区提取一个片段"""
        if len(self._buffer) < self.min_length:
            return None
        
        # 策略1: 寻找句子结束符
        if self.prefer_sentence:
            match = re.search(self.SENTENCE_ENDINGS, self._buffer)
            if match and match.end() >= self.min_length:
                chunk = self._buffer[:match.end()]
                self._buffer = self._buffer[match.end():]
                return chunk.strip()
        
        # 策略2: 达到最大长度，寻找最近的分隔点
        if len(self._buffer) >= self.max_length:
            # 先尝试句子结束符
            match = re.search(self.SENTENCE_ENDINGS, self._buffer[:self.max_length])
            if match:
                chunk = self._buffer[:match.end()]
                self._buffer = self._buffer[match.end():]
                return chunk.strip()
            
            # 再尝试子句结束符
            match = re.search(self.CLAUSE_ENDINGS, self._buffer[:self.max_length])
            if match and match.end() >= self.min_length:
                chunk = self._buffer[:match.end()]
                self._buffer = self._buffer[match.end():]
                return chunk.strip()
            
            # 最后强制分段
            chunk = self._buffer[:self.max_length]
            self._buffer = self._buffer[self.max_length:]
            return chunk.strip()
        
        return None


# 简单测试
if __name__ == "__main__":
    chunker = TextChunker(min_length=5, max_length=30)
    
    # 模拟流式输入
    stream = ["你", "好", "，", "今天", "天气", "怎么样？", "我想", "出去", "散步。"]
    
    print("=== 流式分段测试 ===")
    for token in stream:
        print(f"输入: '{token}'")
        chunks = chunker.feed(token)
        for chunk in chunks:
            print(f"  → 输出片段: '{chunk}'")
    
    # 刷新剩余
    remaining = chunker.flush()
    if remaining:
        print(f"  → 剩余: '{remaining}'")
