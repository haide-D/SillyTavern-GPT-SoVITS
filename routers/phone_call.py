from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional

from services.phone_call_service import PhoneCallService
from services.llm_service import LLMService
from services.emotion_service import EmotionService
from phone_call_utils.data_extractor import DataExtractor
from phone_call_utils.prompt_builder import PromptBuilder
from phone_call_utils.response_parser import ResponseParser
from config import load_json, SETTINGS_FILE

router = APIRouter()


class PhoneCallRequest(BaseModel):
    """主动电话生成请求"""
    char_name: str
    context: List[Dict[str, str]]


class BuildPromptRequest(BaseModel):
    """构建提示词请求"""
    char_name: str
    context: List[Dict[str, str]]


class ParseAndGenerateRequest(BaseModel):
    """解析并生成音频请求"""
    char_name: str
    llm_response: str
    generate_audio: Optional[bool] = True  # 默认生成音频


class LLMTestRequest(BaseModel):
    """LLM测试请求"""
    api_url: str
    api_key: str
    model: str
    temperature: Optional[float] = 0.8
    max_tokens: Optional[int] = 500
    test_prompt: Optional[str] = "你好,请回复'测试成功'"


@router.post("/phone_call/build_prompt")
async def build_prompt(req: BuildPromptRequest):
    """
    构建LLM提示词
    
    前端调用此接口获取提示词,然后直接用LLM_Client调用外部LLM
    
    Args:
        req: 包含角色名和对话上下文的请求
        
    Returns:
        包含prompt和llm_config的字典
    """
    try:
        print(f"\n[BuildPrompt] 开始构建提示词: 角色={req.char_name}, 上下文={len(req.context)}条消息")
        
        # 加载配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        
        llm_config = phone_call_config.get("llm", {})
        extractors = phone_call_config.get("data_extractors", [])
        prompt_template = phone_call_config.get("prompt_template", "")
        
        # 提取上下文数据
        data_extractor = DataExtractor()
        extracted_data = data_extractor.extract(req.context, extractors)
        
        # 获取可用情绪
        emotions = EmotionService.get_available_emotions(req.char_name)
        
        # 构建提示词
        prompt_builder = PromptBuilder()
        prompt = prompt_builder.build(
            template=prompt_template,
            char_name=req.char_name,
            context=req.context,
            extracted_data=extracted_data,
            emotions=emotions
        )
        
        print(f"[BuildPrompt] ✅ 提示词构建完成: {len(prompt)} 字符")
        
        return {
            "status": "success",
            "prompt": prompt,
            "llm_config": {
                "api_url": llm_config.get("api_url"),
                "api_key": llm_config.get("api_key"),
                "model": llm_config.get("model"),
                "temperature": llm_config.get("temperature", 0.8),
                "max_tokens": llm_config.get("max_tokens", 500)
            },
            "emotions": emotions
        }
    except Exception as e:
        print(f"[BuildPrompt] ❌ 错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/phone_call/parse_and_generate")
async def parse_and_generate(req: ParseAndGenerateRequest):
    """
    解析LLM响应并生成音频
    
    前端调用LLM后,将响应发送到此接口进行解析和音频生成
    
    Args:
        req: 包含角色名、LLM响应和是否生成音频的请求
        
    Returns:
        包含segments和audio(可选)的字典
    """
    try:
        print(f"\n[ParseAndGenerate] 开始解析: 角色={req.char_name}, 响应长度={len(req.llm_response)} 字符")
        
        # 加载配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        
        parser_config = phone_call_config.get("response_parser", {})
        
        # 获取可用情绪
        emotions = EmotionService.get_available_emotions(req.char_name)
        
        # 解析响应 - 优先使用 JSON 格式
        response_parser = ResponseParser()
        parse_format = parser_config.get("format", "json")  # 默认使用 JSON
        
        if parse_format == "json":
            print(f"[ParseAndGenerate] 使用 JSON 格式解析")
            segments = response_parser.parse_json_response(
                req.llm_response,
                parser_config,
                available_emotions=emotions
            )
        else:
            print(f"[ParseAndGenerate] 使用正则格式解析")
            segments = response_parser.parse_emotion_segments(
                req.llm_response,
                parser_config,
                available_emotions=emotions
            )
        
        print(f"[ParseAndGenerate] 解析到 {len(segments)} 个情绪片段")
        
        result = {
            "status": "success",
            "segments": [seg.dict() for seg in segments],
            "total_segments": len(segments)
        }
        
        # 调试日志
        print(f"[ParseAndGenerate] generate_audio={req.generate_audio}, segments={len(segments)}")
        
        # 如果需要生成音频,调用TTS服务
        if req.generate_audio and segments:
            print(f"[ParseAndGenerate] 开始生成音频...")
            
            # 加载TTS和音频合并配置
            tts_config = phone_call_config.get("tts_config", {})
            audio_merge_config = phone_call_config.get("audio_merge", {})
            
            # 导入TTS相关模块
            from phone_call_utils.tts_service import TTSService
            from phone_call_utils.audio_merger import AudioMerger
            from config import get_sovits_host
            
            tts_service = TTSService(get_sovits_host())
            audio_merger = AudioMerger()
            audio_bytes_list = []
            
            for i, segment in enumerate(segments):
                print(f"[ParseAndGenerate] 生成片段 {i+1}/{len(segments)}: [{segment.emotion}] {segment.text[:30]}...")
                
                # 选择参考音频
                ref_audio = _select_ref_audio(req.char_name, segment.emotion)
                
                if not ref_audio:
                    print(f"[ParseAndGenerate] 警告: 未找到情绪 '{segment.emotion}' 的参考音频,跳过")
                    continue
                
                # 生成音频 - 直接调用 TTSService
                try:
                    audio_bytes = await tts_service.generate_audio(
                        segment=segment,
                        ref_audio=ref_audio,
                        tts_config=tts_config
                    )
                    audio_bytes_list.append(audio_bytes)
                    print(f"[ParseAndGenerate] ✅ 片段 {i+1} 生成成功: {len(audio_bytes)} 字节")
                except Exception as e:
                    print(f"[ParseAndGenerate] ❌ 生成音频失败 - {e}")
                    continue
            
            
            # 合并音频
            if audio_bytes_list:
                print(f"[ParseAndGenerate] 合并 {len(audio_bytes_list)} 段音频...")
                try:
                    # 直接使用 segments 中的停顿配置(由 LLM 智能决定)
                    pause_durations = [seg.pause_after for seg in segments[:len(audio_bytes_list)]]
                    
                    # 提取语气词配置并生成对应音频
                    # 注意: 这里只是占位逻辑,实际语气词音频需要通过TTS生成
                    # 你可以在这里调用 tts_service 为语气词生成音频
                    filler_word_audios = []
                    for i, segment in enumerate(segments[:len(audio_bytes_list)]):
                        if segment.filler_word:
                            # TODO: 调用TTS生成语气词音频
                            # filler_audio = await tts_service.generate_audio(...)
                            # filler_word_audios.append(filler_audio)
                            print(f"[ParseAndGenerate] 片段 {i+1} 需要语气词: '{segment.filler_word}'")
                            filler_word_audios.append(None)  # 暂时占位
                        else:
                            filler_word_audios.append(None)
                    
                    # 合并音频,传入动态停顿和语气词配置
                    merged_audio = audio_merger.merge_segments(
                        audio_bytes_list,
                        audio_merge_config,
                        pause_durations=pause_durations,
                        filler_word_audios=filler_word_audios
                    )
                    
                    # 将音频字节数据转换为 base64 编码,以便 JSON 序列化
                    import base64
                    audio_base64 = base64.b64encode(merged_audio).decode('utf-8')
                    
                    result["audio"] = audio_base64
                    result["audio_format"] = audio_merge_config.get("output_format", "wav")
                    print(f"[ParseAndGenerate] ✅ 音频合并完成: {len(merged_audio)} 字节 (base64: {len(audio_base64)} 字符)")
                except Exception as e:
                    print(f"[ParseAndGenerate] ❌ 合并音频失败 - {e}")
            else:
                print(f"[ParseAndGenerate] ⚠️ 没有成功生成任何音频片段")
        
        return result
        
    except Exception as e:
        print(f"[ParseAndGenerate] ❌ 错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))




def _select_ref_audio(char_name: str, emotion: str) -> Optional[Dict]:
    """
    根据情绪选择参考音频
    
    Args:
        char_name: 角色名称
        emotion: 情绪名称
        
    Returns:
        参考音频信息 {path, text} 或 None
    """
    import os
    import random
    from config import get_current_dirs
    from utils import scan_audio_files
    
    # 获取角色模型文件夹
    mappings = load_json(os.path.join(os.path.dirname(SETTINGS_FILE), "character_mappings.json"))
    
    if char_name not in mappings:
        print(f"[_select_ref_audio] 错误: 角色 {char_name} 未绑定模型")
        return None
    
    model_folder = mappings[char_name]
    base_dir, _ = get_current_dirs()
    ref_dir = os.path.join(base_dir, model_folder, "reference_audios", "English", "emotions")
    
    if not os.path.exists(ref_dir):
        print(f"[_select_ref_audio] 错误: 参考音频目录不存在: {ref_dir}")
        return None
    
    # 扫描音频文件
    audio_files = scan_audio_files(ref_dir)
    
    # 筛选匹配情绪的音频
    matching_audios = [a for a in audio_files if a["emotion"] == emotion]
    
    if not matching_audios:
        print(f"[_select_ref_audio] 警告: 未找到情绪 '{emotion}' 的参考音频")
        return None
    
    # 随机选择一个
    selected = random.choice(matching_audios)
    
    return {
        "path": selected["path"],
        "text": selected["text"]
    }


@router.post("/phone_call/generate")
async def generate_phone_call(req: PhoneCallRequest):
    """
    生成主动电话内容 (保留原接口作为兼容,但不推荐使用)
    
    Args:
        req: 包含角色名和对话上下文的请求
        
    Returns:
        包含segments、audio(可选)等信息的字典
    """
    try:
        service = PhoneCallService()
        result = await service.generate(req.char_name, req.context)
        
        return {
            "status": "success",
            **result  # 展开result中的所有字段
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/phone_call/emotions/{char_name}")
def get_emotions(char_name: str):
    """
    获取角色可用情绪列表
    
    Args:
        char_name: 角色名称
        
    Returns:
        情绪列表
    """
    try:
        emotions = EmotionService.get_available_emotions(char_name)
        return {
            "status": "success",
            "char_name": char_name,
            "emotions": emotions
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/phone_call/test_llm")
async def test_llm(req: LLMTestRequest):
    """
    测试LLM连接
    
    Args:
        req: LLM测试配置
        
    Returns:
        测试结果
    """
    return await LLMService.test_connection(req.dict())
