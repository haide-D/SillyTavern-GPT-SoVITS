import re
from typing import List, Dict, Optional
from pydantic import BaseModel


class EmotionSegment(BaseModel):
    """情绪片段"""
    emotion: str
    text: str
    pause_after: Optional[float] = None  # 此片段后的停顿时长(秒),None表示使用默认值
    speed: Optional[float] = None  # 语速倍率(1.0=正常,>1.0=加快,<1.0=减慢),None表示使用默认值
    filler_word: Optional[str] = None  # 此片段后的语气词(如"嗯"、"啊"),None表示不添加
    
    # 双语支持字段
    translation: Optional[str] = None  # 中文翻译(用于UI显示),None表示无翻译
    
    # 音轨同步字段
    audio_duration: Optional[float] = None  # 该segment的音频时长(秒)
    start_time: Optional[float] = None  # 在合并音频中的起始时间(秒)


class ResponseParser:
    """响应解析工具"""
    
    @staticmethod
    def parse_emotion_segments(
        response: str, 
        parser_config: Dict,
        available_emotions: Optional[List[str]] = None
    ) -> List[EmotionSegment]:
        """
        解析LLM响应,提取情绪片段
        
        Args:
            response: LLM响应文本
            parser_config: 解析器配置
                - pattern: 正则表达式模式
                - emotion_group: 情绪捕获组索引(默认1)
                - text_group: 文本捕获组索引(默认2)
                - fallback_emotion: 回退情绪(默认"neutral")
                - validate_emotion: 是否验证情绪(默认True)
                - clean_text: 是否清理文本(默认True)
            available_emotions: 可用情绪列表(用于验证)
            
        Returns:
            情绪片段列表
        """
        pattern = parser_config.get("pattern", r'\[情绪:([^\]]+)\]([^\[]+)')
        emotion_group = parser_config.get("emotion_group", 1)
        text_group = parser_config.get("text_group", 2)
        fallback_emotion = parser_config.get("fallback_emotion", "neutral")
        validate_emotion = parser_config.get("validate_emotion", True)
        clean_text = parser_config.get("clean_text", True)
        
        segments = []
        matches = re.findall(pattern, response, re.DOTALL)
        
        print(f"[ResponseParser] 找到 {len(matches)} 个匹配项")
        
        for i, match in enumerate(matches):
            if len(match) < max(emotion_group, text_group):
                print(f"[ResponseParser] 警告: 匹配项 {i} 捕获组不足,跳过")
                continue
            
            emotion = match[emotion_group - 1].strip()
            text = match[text_group - 1].strip()
            
            # 清理文本
            if clean_text:
                text = ResponseParser._clean_text(text)
            
            if not text:
                print(f"[ResponseParser] 警告: 匹配项 {i} 文本为空,跳过")
                continue
            
            # 验证情绪
            if validate_emotion and available_emotions:
                if emotion not in available_emotions:
                    print(f"[ResponseParser] 警告: 情绪 '{emotion}' 不在可用列表中,使用回退情绪 '{fallback_emotion}'")
                    emotion = fallback_emotion
            
            segments.append(EmotionSegment(
                emotion=emotion,
                text=text
            ))
            print(f"[ResponseParser] 片段 {i}: [{emotion}] {text[:50]}...")
        
        if not segments:
            print(f"[ResponseParser] 警告: 未解析到任何片段,使用回退策略")
            # 回退策略:将整个响应作为单个片段
            cleaned_response = ResponseParser._clean_text(response) if clean_text else response
            if cleaned_response:
                segments.append(EmotionSegment(
                    emotion=fallback_emotion,
                    text=cleaned_response
                ))
        
        return segments
    
    @staticmethod
    def parse_json_response(
        response: str,
        parser_config: Optional[Dict] = None,
        available_emotions: Optional[List[str]] = None
    ) -> List[EmotionSegment]:
        """
        解析 JSON 格式的 LLM 响应
        
        支持:
        - 纯 JSON
        - Markdown 代码块包裹的 JSON (```json ... ```)
        - 参数验证和容错处理
        
        Args:
            response: LLM 响应文本
            parser_config: 解析器配置
                - fallback_emotion: 回退情绪(默认"neutral")
                - validate_speed_range: 语速范围验证 [min, max] (默认[0.5, 2.0])
                - validate_pause_range: 停顿范围验证 [min, max] (默认[0.1, 3.0])
            available_emotions: 可用情绪列表(用于验证)
            
        Returns:
            情绪片段列表
        """
        import json
        
        if parser_config is None:
            parser_config = {}
        
        fallback_emotion = parser_config.get("fallback_emotion", "neutral")
        speed_range = parser_config.get("validate_speed_range", [0.5, 2.0])
        pause_range = parser_config.get("validate_pause_range", [0.1, 3.0])
        
        # 尝试提取 JSON (支持 Markdown 代码块)
        json_str = ResponseParser._extract_json(response)
        
        if not json_str:
            print(f"[ResponseParser] ❌ 未找到有效 JSON,使用回退解析")
            # 回退到正则解析
            return ResponseParser.parse_emotion_segments(response, parser_config or {}, available_emotions)
        
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            print(f"[ResponseParser] ❌ JSON 解析失败: {e}")
            return ResponseParser.parse_emotion_segments(response, parser_config or {}, available_emotions)
        
        # 提取 segments
        if "segments" not in data or not isinstance(data["segments"], list):
            print(f"[ResponseParser] ❌ JSON 格式错误: 缺少 'segments' 数组")
            return []
        
        segments = []
        for i, seg_data in enumerate(data["segments"]):
            try:
                # 必需字段
                emotion = seg_data.get("emotion", fallback_emotion)
                text = seg_data.get("text", "")
                
                if not text:
                    print(f"[ResponseParser] 警告: 片段 {i} 文本为空,跳过")
                    continue
                
                # 验证情绪
                if available_emotions and emotion not in available_emotions:
                    print(f"[ResponseParser] 警告: 情绪 '{emotion}' 不在可用列表中,使用 '{fallback_emotion}'")
                    emotion = fallback_emotion
                
                # 可选字段
                pause_after = seg_data.get("pause_after")
                speed = seg_data.get("speed")
                filler_word = seg_data.get("filler_word")
                translation = seg_data.get("translation")  # 新增: 提取翻译字段
                
                # 验证数值范围
                if pause_after is not None:
                    if not (pause_range[0] <= pause_after <= pause_range[1]):
                        print(f"[ResponseParser] 警告: pause_after={pause_after} 超出范围,重置为 None")
                        pause_after = None
                
                if speed is not None:
                    if not (speed_range[0] <= speed <= speed_range[1]):
                        print(f"[ResponseParser] 警告: speed={speed} 超出范围,重置为 None")
                        speed = None
                
                segment = EmotionSegment(
                    emotion=emotion,
                    text=text,
                    pause_after=pause_after,
                    speed=speed,
                    filler_word=filler_word,
                    translation=translation  # 新增: 传递翻译字段
                )
                segments.append(segment)
                
                # 日志中显示翻译信息
                trans_info = f" (翻译: {translation[:30]}...)" if translation else ""
                print(f"[ResponseParser] 片段 {i}: [{emotion}] {text[:50]}...{trans_info} (pause={pause_after}, speed={speed})")
                
                
            except Exception as e:
                print(f"[ResponseParser] 警告: 解析片段 {i} 失败 - {e}")
                continue
        
        if not segments:
            print(f"[ResponseParser] 警告: 未解析到任何有效片段")
        
        return segments
    
    @staticmethod
    def _extract_json(text: str) -> Optional[str]:
        """
        从文本中提取 JSON
        
        支持:
        - 纯 JSON
        - Markdown 代码块: ```json ... ```
        - Markdown 代码块: ``` ... ```
        
        Args:
            text: 原始文本
            
        Returns:
            JSON 字符串或 None
        """
        # 尝试提取 Markdown 代码块
        import re
        
        # 匹配 ```json ... ```
        json_block_pattern = r'```json\s*\n(.*?)\n```'
        match = re.search(json_block_pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()
        
        # 匹配 ``` ... ```
        code_block_pattern = r'```\s*\n(.*?)\n```'
        match = re.search(code_block_pattern, text, re.DOTALL)
        if match:
            content = match.group(1).strip()
            # 检查是否是 JSON
            if content.startswith('{') or content.startswith('['):
                return content
        
        # 尝试直接查找 JSON 对象
        # 查找第一个 { 到最后一个 }
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1 and end > start:
            return text[start:end+1]
        
        return None
    
    @staticmethod
    def _clean_text(text: str) -> str:
        """
        清理文本
        
        Args:
            text: 原始文本
            
        Returns:
            清理后的文本
        """
        # 去除多余空白
        text = re.sub(r'\s+', ' ', text)
        
        # 去除首尾空白
        text = text.strip()
        
        # 去除多余的标点符号
        text = re.sub(r'([。!?])\1+', r'\1', text)
        
        return text
