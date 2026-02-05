import os
import random
from typing import List, Dict
from config import load_json, SETTINGS_FILE, get_current_dirs, get_sovits_host
from services.llm_service import LLMService
from services.emotion_service import EmotionService
from st_utils.data_extractor import DataExtractor
from phone_call_utils.prompt_builder import PromptBuilder
from phone_call_utils.response_parser import ResponseParser, EmotionSegment
from phone_call_utils.tts_service import TTSService
from phone_call_utils.audio_merger import AudioMerger
from utils import scan_audio_files


class PhoneCallService:
    """主动电话生成服务"""
    
    def __init__(self):
        self.llm_service = LLMService()
        self.emotion_service = EmotionService()
        self.data_extractor = DataExtractor()
        self.prompt_builder = PromptBuilder()
        self.response_parser = ResponseParser()
        self.tts_service = TTSService(get_sovits_host())
        self.audio_merger = AudioMerger()
    
    async def generate(self, chat_branch: str, speakers: List[str], context: List[Dict], generate_audio: bool = True, user_name: str = None, last_call_info: Dict = None, call_reason: str = "", call_tone: str = "") -> Dict:
        """
        生成主动电话内容
        
        ⚠️ 注意: 此方法不再直接调用LLM!
        流程已改为:
        1. 后端构建prompt → 返回给前端
        2. 前端调用LLM (使用 LLM_Client.callLLM)
        3. 前端将LLM响应发回后端
        4. 后端解析并生成音频
        
        Args:
            chat_branch: 对话分支ID
            speakers: 说话人列表
            context: 对话上下文
            generate_audio: 是否生成音频(默认True)
            user_name: 用户名，用于在prompt中区分用户身份
            last_call_info: 上次通话信息，用于二次电话差异化
            call_reason: 打电话的原因（由 LLM 分析得出）
            call_tone: 通话氛围（如轻松闲聊、深情倾诉等）
            
        Returns:
            包含prompt、llm_config的字典
        """
        print(f"\n[PhoneCallService] 开始准备主动电话: chat_branch={chat_branch}, speakers={speakers}, 上下文={len(context)}条消息")
        if last_call_info:
            print(f"[PhoneCallService] 📞 检测到上次通话，将生成二次电话内容")
        
        # 1. 加载配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        
        llm_config = phone_call_config.get("llm", {})
        extractors = phone_call_config.get("data_extractors", [])
        prompt_template = phone_call_config.get("prompt_template", "")
        tts_config = phone_call_config.get("tts_config", {})
        text_lang = tts_config.get("text_lang", "zh")  # 读取语言配置,默认中文
        
        # 读取消息提取和过滤配置（从共享的 message_processing 读取）
        msg_processing = settings.get("message_processing", {})
        extract_tag = msg_processing.get("extract_tag", "")  # 提取标签
        filter_tags = msg_processing.get("filter_tags", "")  # 过滤标签
        
        # 2. 提取上下文数据
        extracted_data = self.data_extractor.extract(context, extractors)
        
        # 3. 获取所有说话人的可用情绪 (跳过未绑定模型的角色)
        speakers_emotions = {}
        valid_speakers = []
        for speaker in speakers:
            try:
                emotions = self.emotion_service.get_available_emotions(speaker)
                speakers_emotions[speaker] = emotions
                valid_speakers.append(speaker)
                print(f"[PhoneCallService] {speaker} 可用情绪: {emotions}")
            except Exception as e:
                print(f"[PhoneCallService] ⚠️ 跳过角色 {speaker}: {e}")
        
        # 如果所有角色都未绑定，终止
        if not valid_speakers:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="所有角色都未绑定模型，无法生成电话")
        
        # 更新speakers为有效的说话人列表
        speakers = valid_speakers
        
        # 4. 构建提示词 (包含说话人和情绪信息，以及上次通话信息)
        prompt = self.prompt_builder.build(
            template=prompt_template,
            char_name=speakers[0] if speakers else "Unknown",
            context=context,
            extracted_data=extracted_data,
            emotions=speakers_emotions.get(speakers[0], []) if speakers else [],
            speakers=speakers,
            speakers_emotions=speakers_emotions,
            text_lang=text_lang,
            extract_tag=extract_tag,
            filter_tags=filter_tags,
            user_name=user_name,
            last_call_info=last_call_info,
            call_reason=call_reason,  # 新增: 电话原因
            call_tone=call_tone  # 新增: 通话氛围
        )
        
        print(f"[PhoneCallService] ✅ Prompt构建完成: {len(prompt)} 字符")
        print(f"[PhoneCallService] ⚠️ 不再调用LLM - 请前端使用 LLM_Client.callLLM()")
        
        # 打印完整的 LLM 请求体 (JSON 格式,方便测试)
        import json
        llm_request_body = {
            "model": llm_config.get("model"),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": llm_config.get("temperature", 0.8),
            "max_tokens": llm_config.get("max_tokens"),
            "stream": False
        }
        
        print(f"\n{'='*80}")
        print(f"[PhoneCallService] 完整 LLM 请求体 (JSON 格式):")
        print(f"{'='*80}")
        print(json.dumps(llm_request_body, indent=2, ensure_ascii=False))
        print(f"{'='*80}\n")
        
        # 返回prompt和配置,供前端调用LLM
        return {
            "prompt": prompt,
            "llm_config": llm_config,
            "speakers": speakers,
            "speakers_emotions": speakers_emotions,
            "message": "请使用前端 LLM_Client.callLLM() 调用LLM,然后将响应发送到 /api/phone_call/parse_and_generate"
        }
    
    def _select_ref_audio(self, char_name: str, emotion: str) -> Dict:
        """
        根据情绪选择参考音频
        
        Args:
            char_name: 角色名称
            emotion: 情绪名称
            
        Returns:
            参考音频信息 {path, text} 或 None
        """
        # 获取角色模型文件夹
        mappings = load_json(os.path.join(os.path.dirname(SETTINGS_FILE), "character_mappings.json"))
        
        if char_name not in mappings:
            print(f"[PhoneCallService] 错误: 角色 {char_name} 未绑定模型")
            return None
        
        model_folder = mappings[char_name]
        base_dir, _ = get_current_dirs()
        ref_dir = os.path.join(base_dir, model_folder, "reference_audios")
        
        if not os.path.exists(ref_dir):
            print(f"[PhoneCallService] 错误: 参考音频目录不存在: {ref_dir}")
            return None
        
        # 扫描音频文件
        audio_files = scan_audio_files(ref_dir)
        
        # 筛选匹配情绪的音频
        matching_audios = [a for a in audio_files if a["emotion"] == emotion]
        
        if not matching_audios:
            print(f"[PhoneCallService] 警告: 未找到情绪 '{emotion}' 的参考音频")
            return None
        
        # 随机选择一个
        selected = random.choice(matching_audios)
        
        return {
            "path": selected["path"],
            "text": selected["text"]
        }
