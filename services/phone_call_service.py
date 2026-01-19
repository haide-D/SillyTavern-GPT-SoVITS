from typing import List, Dict
from config import load_json, SETTINGS_FILE
from services.llm_service import LLMService
from services.emotion_service import EmotionService
from phone_call_utils.data_extractor import DataExtractor
from phone_call_utils.prompt_builder import PromptBuilder
from phone_call_utils.response_parser import ResponseParser, EmotionSegment


class PhoneCallService:
    """主动电话生成服务"""
    
    def __init__(self):
        self.llm_service = LLMService()
        self.emotion_service = EmotionService()
        self.data_extractor = DataExtractor()
        self.prompt_builder = PromptBuilder()
        self.response_parser = ResponseParser()
    
    async def generate(self, char_name: str, context: List[Dict]) -> List[EmotionSegment]:
        """
        生成主动电话内容
        
        流程:
        1. 加载配置
        2. 提取上下文数据
        3. 获取可用情绪
        4. 构建提示词
        5. 调用LLM
        6. 解析响应
        7. 返回情绪片段列表
        
        Args:
            char_name: 角色名称
            context: 对话上下文
            
        Returns:
            情绪片段列表
        """
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        
        llm_config = phone_call_config.get("llm", {})
        extractors = phone_call_config.get("data_extractors", [])
        prompt_template = phone_call_config.get("prompt_template", "")
        parser_config = phone_call_config.get("response_parser", {})
        
        extracted_data = self.data_extractor.extract(context, extractors)
        
        emotions = self.emotion_service.get_available_emotions(char_name)
        
        prompt = self.prompt_builder.build(
            template=prompt_template,
            char_name=char_name,
            context=context,
            extracted_data=extracted_data,
            emotions=emotions
        )
        
        llm_response = await self.llm_service.call(llm_config, prompt)
        
        segments = self.response_parser.parse_emotion_segments(llm_response, parser_config)
        
        return segments
