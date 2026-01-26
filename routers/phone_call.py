from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional, Union

from services.phone_call_service import PhoneCallService
from services.llm_service import LLMService
from services.emotion_service import EmotionService
from st_utils.data_extractor import DataExtractor
from phone_call_utils.prompt_builder import PromptBuilder
from phone_call_utils.response_parser import ResponseParser
from config import load_json, SETTINGS_FILE

router = APIRouter()


def check_phone_call_enabled():
    """检查电话功能是否启用,如果禁用则抛出 403 错误"""
    settings = load_json(SETTINGS_FILE)
    phone_call_config = settings.get("phone_call", {})
    enabled = phone_call_config.get("enabled", True)

    if not enabled:
        raise HTTPException(
            status_code=403,
            detail="电话功能已被禁用 (phone_call.enabled = false)"
        )



class ContextMessage(BaseModel):
    """对话上下文消息"""
    name: str
    is_user: bool  # 布尔值,不是字符串
    mes: str


class PhoneCallRequest(BaseModel):
    """主动电话生成请求"""
    char_name: str
    context: List[Dict[str, str]]


class BuildPromptRequest(BaseModel):
    """构建提示词请求"""
    char_name: str
    context: List[Dict[str, str]]
    user_name: Optional[str] = None  # 用户名，用于在prompt中区分用户身份


class ParseAndGenerateRequest(BaseModel):
    """解析并生成音频请求"""
    char_name: str
    llm_response: str
    generate_audio: Optional[bool] = True  # 默认生成音频


class CompleteGenerationRequest(BaseModel):
    """完成生成请求 (前端返回LLM响应)"""
    call_id: int
    llm_response: str
    chat_branch: str
    speakers: List[str]
    char_name: Optional[str] = None  # 主角色卡名称，用于 WebSocket 推送路由


class LLMTestRequest(BaseModel):
    """LLM测试请求"""
    api_url: str
    api_key: str
    model: str
    temperature: Optional[float] = 0.8
    max_tokens: Optional[int] = 500
    test_prompt: Optional[str] = "你好,请回复'测试成功'"


class MessageWebhookRequest(BaseModel):
    """消息 Webhook 请求"""
    chat_branch: str  # 对话分支ID
    speakers: List[str]  # 说话人列表
    current_floor: int  # 当前对话楼层
    context: List[ContextMessage]  # 完整对话上下文,使用 ContextMessage 模型
    context_fingerprint: str  # 上下文指纹
    user_name: Optional[str] = None  # 用户名，用于在prompt中区分用户身份
    char_name: Optional[str] = None  # 主角色卡名称，用于 WebSocket 推送路由



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
        check_phone_call_enabled()
        print(f"\n[BuildPrompt] 开始构建提示词: 角色={req.char_name}, 上下文={len(req.context)}条消息")

        # 加载配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})

        llm_config = phone_call_config.get("llm", {})
        extractors = phone_call_config.get("data_extractors", [])
        prompt_template = phone_call_config.get("prompt_template", "")
        tts_config = phone_call_config.get("tts_config", {})
        text_lang = tts_config.get("text_lang", "zh")  # 读取语言配置,默认中文

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
            emotions=emotions,
            text_lang=text_lang,  # 传递语言配置
            user_name=req.user_name  # 传递用户名
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
                "max_tokens": llm_config.get("max_tokens", 5000)
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
        check_phone_call_enabled()
        print(f"\n[ParseAndGenerate] 开始解析: 角色={req.char_name}, 响应长度={len(req.llm_response)} 字符")

        # 加载配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})

        parser_config = phone_call_config.get("response_parser", {})

        # 获取可用情绪
        emotions = EmotionService.get_available_emotions(req.char_name)

        # 解析响应 - 优先使用 JSON 格式,带超时保护
        import asyncio

        response_parser = ResponseParser()
        parse_format = parser_config.get("format", "json")  # 默认使用 JSON

        # 定义异步包装器以支持超时控制
        async def parse_with_timeout():
            if parse_format == "json":
                print(f"[ParseAndGenerate] 使用 JSON 格式解析")
                return response_parser.parse_json_response(
                    req.llm_response,
                    parser_config,
                    available_emotions=emotions
                )
            else:
                print(f"[ParseAndGenerate] 使用正则格式解析")
                return response_parser.parse_emotion_segments(
                    req.llm_response,
                    parser_config,
                    available_emotions=emotions
                )

        # 带超时和重试的解析
        max_retries = 1
        timeout_seconds = 90
        segments = None

        for attempt in range(max_retries + 1):
            try:
                print(f"[ParseAndGenerate] 开始解析 (尝试 {attempt + 1}/{max_retries + 1}, 超时限制: {timeout_seconds}秒)")
                segments = await asyncio.wait_for(parse_with_timeout(), timeout=timeout_seconds)
                print(f"[ParseAndGenerate] ✅ 解析成功")
                break
            except asyncio.TimeoutError:
                if attempt < max_retries:
                    print(f"[ParseAndGenerate] ⚠️ 解析超时 ({timeout_seconds}秒),正在重试...")
                else:
                    print(f"[ParseAndGenerate] ❌ 解析超时且重试失败")
                    raise HTTPException(status_code=504, detail=f"解析响应超时 (>{timeout_seconds}秒)")
            except Exception as e:
                print(f"[ParseAndGenerate] ❌ 解析失败: {str(e)}")
                raise

        if segments is None:
            raise HTTPException(status_code=500, detail="解析失败,未获取到有效片段")

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

            # 追踪上一个情绪和参考音频,用于情绪变化时的音色融合
            previous_emotion = None
            previous_ref_audio = None

            for i, segment in enumerate(segments):
                print(f"[ParseAndGenerate] 生成片段 {i+1}/{len(segments)}: [{segment.emotion}] {segment.text[:30]}...")

                # 选择参考音频
                ref_audio = _select_ref_audio(req.char_name, segment.emotion)

                if not ref_audio:
                    print(f"[ParseAndGenerate] 警告: 未找到情绪 '{segment.emotion}' 的参考音频,跳过")
                    continue

                # 检测情绪变化
                emotion_changed = previous_emotion is not None and previous_emotion != segment.emotion
                if emotion_changed:
                    print(f"[ParseAndGenerate] 检测到情绪变化: {previous_emotion} -> {segment.emotion}")

                # 生成音频 - 如果情绪变化,传入上一个情绪的参考音频进行音色融合
                try:
                    audio_bytes = await tts_service.generate_audio(
                        segment=segment,
                        ref_audio=ref_audio,
                        tts_config=tts_config,
                        previous_ref_audio=previous_ref_audio if emotion_changed else None
                    )
                    audio_bytes_list.append(audio_bytes)
                    print(f"[ParseAndGenerate] ✅ 片段 {i+1} 生成成功: {len(audio_bytes)} 字节")

                    # 更新上一个情绪和参考音频
                    previous_emotion = segment.emotion
                    previous_ref_audio = ref_audio

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


@router.post("/phone_call/complete_generation")
async def complete_generation(req: CompleteGenerationRequest):
    """
    完成自动电话生成 (新架构 - 第二阶段)

    前端调用LLM后,将响应发送到此端点完成音频生成

    流程:
    1. 接收前端的LLM响应
    2. 解析响应并验证说话人
    3. 生成音频
    4. 更新数据库
    5. 通过WebSocket通知前端完成

    Args:
        req: 包含call_id、LLM响应、说话人列表等

    Returns:
        生成结果
    """
    try:
        check_phone_call_enabled()
        from database import DatabaseManager
        from services.auto_call_scheduler import AutoCallScheduler
        import json

        print(f"\n[CompleteGeneration] 收到LLM响应: call_id={req.call_id}")
        print(f"[CompleteGeneration] LLM响应长度: {len(req.llm_response)} 字符")
        print(f"[CompleteGeneration] LLM响应内容 (前500字符): {req.llm_response[:500]}")

        db = DatabaseManager()
        scheduler = AutoCallScheduler()

        # 清理 markdown 代码块 (如果存在)
        llm_response_cleaned = req.llm_response.strip()

        # 检测并移除 markdown 代码块标记
        import re
        # 匹配 ```json ... ``` 或 ``` ... ```
        markdown_pattern = r'^```(?:json)?\s*\n(.*?)\n```$'
        match = re.match(markdown_pattern, llm_response_cleaned, re.DOTALL)

        if match:
            llm_response_cleaned = match.group(1).strip()
            print(f"[CompleteGeneration] 检测到 markdown 代码块,已清理")
            print(f"[CompleteGeneration] 清理后内容 (前500字符): {llm_response_cleaned[:500]}")

        # 解析LLM响应
        try:
            response_data = json.loads(llm_response_cleaned)
            print(f"[CompleteGeneration] ✅ JSON解析成功")
        except json.JSONDecodeError as e:
            print(f"[CompleteGeneration] ❌ JSON解析失败: {str(e)}")
            print(f"[CompleteGeneration] 完整响应内容: {llm_response_cleaned}")
            raise ValueError(f"LLM响应不是有效的JSON格式: {str(e)}")
        selected_speaker = response_data.get("speaker")

        # 验证说话人
        if not selected_speaker or selected_speaker not in req.speakers:
            raise ValueError(f"LLM返回的说话人 '{selected_speaker}' 无效,可用说话人: {req.speakers}")

        print(f"[CompleteGeneration] LLM选择的说话人: {selected_speaker}")

        # 获取该说话人的可用情绪
        emotion_service = EmotionService()
        available_emotions = emotion_service.get_available_emotions(selected_speaker)

        # 解析情绪片段 - 使用 JSON 解析器
        parser = ResponseParser()
        settings = load_json(SETTINGS_FILE)
        parser_config = settings.get("phone_call", {}).get("response_parser", {})

        # 使用 parse_json_response 而不是 parse_emotion_segments
        # 因为 LLM 返回的是 JSON 格式
        segments = parser.parse_json_response(
            llm_response_cleaned,  # 使用清理后的响应
            parser_config,
            available_emotions=available_emotions
        )

        print(f"[CompleteGeneration] 解析到 {len(segments)} 个情绪片段")

        # 生成音频
        from phone_call_utils.tts_service import TTSService
        from phone_call_utils.audio_merger import AudioMerger
        from config import get_sovits_host

        tts_service = TTSService(get_sovits_host())
        audio_merger = AudioMerger()

        tts_config = settings.get("phone_call", {}).get("tts_config", {})
        audio_merge_config = settings.get("phone_call", {}).get("audio_merge", {})

        audio_bytes_list = []
        previous_emotion = None
        previous_ref_audio = None

        for i, segment in enumerate(segments):
            print(f"[CompleteGeneration] 生成片段 {i+1}/{len(segments)}: [{segment.emotion}] {segment.text[:30]}...")

            # 选择参考音频
            ref_audio = _select_ref_audio(selected_speaker, segment.emotion)

            if not ref_audio:
                print(f"[CompleteGeneration] 警告: 未找到情绪 '{segment.emotion}' 的参考音频,跳过")
                continue

            # 检测情绪变化
            emotion_changed = previous_emotion is not None and previous_emotion != segment.emotion

            # 生成音频
            try:
                audio_bytes = await tts_service.generate_audio(
                    segment=segment,
                    ref_audio=ref_audio,
                    tts_config=tts_config,
                    previous_ref_audio=previous_ref_audio if emotion_changed else None
                )

                # 获取音频时长(用于音轨同步)
                from pydub import AudioSegment as PydubSegment
                from io import BytesIO
                audio_seg = PydubSegment.from_file(BytesIO(audio_bytes), format="wav")
                duration_seconds = len(audio_seg) / 1000.0  # 毫秒转秒
                segment.audio_duration = duration_seconds
                print(f"[CompleteGeneration] 音频时长: {duration_seconds:.2f}秒")

                audio_bytes_list.append(audio_bytes)

                previous_emotion = segment.emotion
                previous_ref_audio = ref_audio

            except Exception as e:
                print(f"[CompleteGeneration] 错误: 生成音频失败 - {e}")
                continue

        # 合并音频
        audio_path = None
        audio_url = None
        if audio_bytes_list:
            print(f"[CompleteGeneration] 合并 {len(audio_bytes_list)} 段音频...")
            merged_audio = audio_merger.merge_segments(audio_bytes_list, audio_merge_config)

            # 保存音频并获取 URL
            audio_path, audio_url = await scheduler._save_audio(
                req.call_id,
                selected_speaker,
                merged_audio,
                audio_merge_config.get("output_format", "wav")
            )

            # 计算每个segment的起始时间(用于音轨同步)
            current_time = 0.0
            default_pause = audio_merge_config.get("silence_between_segments", 0.3)
            for i, segment in enumerate(segments):
                segment.start_time = current_time

                # 累加时间: 音频时长 + 停顿时长
                if segment.audio_duration:
                    current_time += segment.audio_duration

                # 添加停顿时长(最后一个segment不添加)
                if i < len(segments) - 1:
                    pause = segment.pause_after if segment.pause_after is not None else default_pause
                    current_time += pause

            print(f"[CompleteGeneration] ✅ 音轨同步信息已计算: {len(segments)}个片段")


        # 更新数据库(同时更新 char_name 为 LLM 选择的说话人)
        conn = db._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE auto_phone_calls SET status = ?, char_name = ?, audio_path = ?, audio_url = ?, segments = ? WHERE id = ?",
                ("completed", selected_speaker, audio_path, audio_url, json.dumps([seg.dict() for seg in segments], ensure_ascii=False), req.call_id)
            )
            conn.commit()
        finally:
            conn.close()

        print(f"[CompleteGeneration] ✅ 生成完成: call_id={req.call_id}, speaker={selected_speaker}, audio={audio_path}, url={audio_url}")

        # 通知前端完成
        # WebSocket 推送目标: 优先使用前端传递的主角色名,回退到 selected_speaker
        ws_target = req.char_name if req.char_name else selected_speaker
        print(f"[CompleteGeneration] WebSocket 推送目标: {ws_target}")

        from services.notification_service import NotificationService
        notification_service = NotificationService()
        await notification_service.notify_phone_call_ready(
            char_name=ws_target,  # 使用主角色卡名称进行 WebSocket 路由
            call_id=req.call_id,
            segments=[seg.dict() for seg in segments],
            audio_path=audio_path,
            audio_url=audio_url
        )

        # 移除运行中标记(使用 trigger_floor)
        # 需要从 call_id 获取 trigger_floor
        conn = db._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT trigger_floor FROM auto_phone_calls WHERE id = ?", (req.call_id,))
            row = cursor.fetchone()
            if row and hasattr(scheduler, '_running_tasks'):
                trigger_floor = row[0]
                scheduler._running_tasks.discard(trigger_floor)
                print(f"[CompleteGeneration] 移除运行中任务: 楼层{trigger_floor}")
        finally:
            conn.close()

        return {
            "status": "success",
            "message": "生成完成",
            "call_id": req.call_id,
            "selected_speaker": selected_speaker,
            "segments": [seg.dict() for seg in segments],
            "audio_path": audio_path,
            "audio_url": audio_url
        }

    except Exception as e:
        print(f"[CompleteGeneration] ❌ 失败: {str(e)}")

        # 更新状态为 failed
        try:
            db.update_auto_call_status(
                call_id=req.call_id,
                status="failed",
                error_message=str(e)
            )
            print(f"[CompleteGeneration] 已更新状态为 failed")
        except Exception as update_error:
            print(f"[CompleteGeneration] 更新状态失败: {str(update_error)}")

        # 移除运行中标记
        try:
            conn = db._get_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT trigger_floor FROM auto_phone_calls WHERE id = ?", (req.call_id,))
                row = cursor.fetchone()
                if row and hasattr(scheduler, '_running_tasks'):
                    trigger_floor = row[0]
                    scheduler._running_tasks.discard(trigger_floor)
                    print(f"[CompleteGeneration] 已移除运行中任务: 楼层{trigger_floor}")
            finally:
                conn.close()
        except Exception as cleanup_error:
            print(f"[CompleteGeneration] 清理运行中标记失败: {str(cleanup_error)}")

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

    # 从 tts_config.prompt_lang 读取语言设置并转换为目录名
    settings = load_json(SETTINGS_FILE)
    prompt_lang = settings.get("phone_call", {}).get("tts_config", {}).get("prompt_lang", "zh")

    # 语言代码转目录名映射
    lang_map = {
        "zh": "Chinese",
        "en": "English",
        "ja": "Japanese",
        "all_zh": "Chinese",
        "all_ja": "Japanese"
    }
    lang_dir = lang_map.get(prompt_lang, "Chinese")

    # 使用配置的语言目录
    ref_dir = os.path.join(base_dir, model_folder, "reference_audios", lang_dir, "emotions")

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
        check_phone_call_enabled()
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
        check_phone_call_enabled()
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
    check_phone_call_enabled()
    return await LLMService.test_connection(req.dict())


# ==================== 自动生成相关接口 ====================

@router.post("/phone_call/webhook/message")
async def message_webhook(req: MessageWebhookRequest):
    """
    接收 SillyTavern 消息 webhook

    当用户发送消息时,SillyTavern 调用此接口,触发自动生成检测

    Args:
        req: 包含对话分支、说话人列表、当前楼层和对话上下文

    Returns:
        处理结果
    """
    try:
        check_phone_call_enabled()
        from services.conversation_monitor import ConversationMonitor
        from services.auto_call_scheduler import AutoCallScheduler

        # 添加详细的请求日志
        print(f"\n[Webhook] 收到请求:")
        print(f"  - chat_branch: {req.chat_branch}")
        print(f"  - speakers: {req.speakers}")
        print(f"  - current_floor: {req.current_floor}")
        print(f"  - context 条数: {len(req.context)}")
        if req.context:
            print(f"  - context 示例 (前2条): {req.context[:2]}")

        print(f"\n[Webhook] 收到消息: chat_branch={req.chat_branch}, 说话人={req.speakers}, 楼层={req.current_floor}")

        # 如果没有说话人,跳过
        if not req.speakers or len(req.speakers) == 0:
            return {
                "status": "skipped",
                "message": "没有可用的说话人"
            }

        # 使用第一个说话人作为主要角色 (用于触发检测)
        # TODO: 未来可以改进为根据上下文选择最相关的说话人
        primary_speaker = req.speakers[0]

        # 检查是否应该触发
        monitor = ConversationMonitor()

        if not monitor.should_trigger(primary_speaker, req.current_floor):
            return {
                "status": "skipped",
                "message": "未达到触发条件"
            }

        # 提取上下文
        context = monitor.extract_context(req.context)
        trigger_floor = monitor.get_trigger_floor(req.current_floor)

        # 调度生成任务 (传递所有说话人和上下文指纹)
        scheduler = AutoCallScheduler()
        call_id = await scheduler.schedule_auto_call(
            chat_branch=req.chat_branch,
            speakers=req.speakers,
            trigger_floor=trigger_floor,
            context=context,
            context_fingerprint=req.context_fingerprint,
            user_name=req.user_name,  # 传递用户名
            char_name=req.char_name   # 传递主角色卡名称，用于 WebSocket 推送
        )

        if call_id is None:
            return {
                "status": "duplicate",
                "message": "该楼层已生成或正在生成中"
            }

        return {
            "status": "scheduled",
            "call_id": call_id,
            "message": f"已调度自动生成任务: {req.speakers} @ 楼层{trigger_floor}"
        }

    except Exception as e:
        print(f"[Webhook] ❌ 错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/phone_call/auto/history/{char_name}")
async def get_auto_call_history(char_name: str, limit: int = 50):
    """
    获取角色的自动生成历史记录

    Args:
        char_name: 角色名称
        limit: 返回记录数量限制

    Returns:
        历史记录列表
    """
    try:
        check_phone_call_enabled()
        from database import DatabaseManager

        db = DatabaseManager()
        history = db.get_auto_call_history(char_name, limit)

        return {
            "status": "success",
            "char_name": char_name,
            "history": history,
            "total": len(history)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/phone_call/auto/history_by_branch/{chat_branch:path}")
async def get_auto_call_history_by_branch(chat_branch: str, limit: int = 50):
    """
    根据对话分支获取自动生成历史记录
    
    Args:
        chat_branch: 对话分支ID
        limit: 返回记录数量限制
        
    Returns:
        历史记录列表
    """
    try:
        check_phone_call_enabled()
        from database import DatabaseManager
        
        db = DatabaseManager()
        history = db.get_auto_call_history_by_chat_branch(chat_branch, limit)
        
        return {
            "status": "success",
            "chat_branch": chat_branch,
            "history": history,
            "total": len(history)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class FingerprintHistoryRequest(BaseModel):
    """按指纹查询历史请求"""
    fingerprints: List[str]
    limit: Optional[int] = 50


@router.post("/phone_call/auto/history_by_fingerprints")
async def get_auto_call_history_by_fingerprints(req: FingerprintHistoryRequest):
    """
    根据指纹列表获取自动生成历史记录（支持跨分支匹配）
    
    Args:
        req: 包含指纹列表和限制数量
        
    Returns:
        历史记录列表
    """
    try:
        check_phone_call_enabled()
        from database import DatabaseManager
        
        db = DatabaseManager()
        history = db.get_auto_call_history_by_fingerprints(req.fingerprints, req.limit)
        
        return {
            "status": "success",
            "fingerprints_count": len(req.fingerprints),
            "history": history,
            "total": len(history)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/phone_call/auto/latest/{char_name}")
async def get_latest_auto_call(char_name: str):
    """
    获取角色最新的自动生成记录

    Args:
        char_name: 角色名称

    Returns:
        最新记录或 null
    """
    try:
        check_phone_call_enabled()
        from database import DatabaseManager

        db = DatabaseManager()
        latest = db.get_latest_auto_call(char_name)

        if latest is None:
            return {
                "status": "success",
                "char_name": char_name,
                "latest": None
            }

        return {
            "status": "success",
            "char_name": char_name,
            "latest": latest
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


from fastapi import WebSocket, WebSocketDisconnect

@router.websocket("/ws/phone_call/{char_name}")
async def websocket_phone_call(websocket: WebSocket, char_name: str):
    """
    WebSocket 实时推送连接

    前端建立连接后,当有新的自动生成完成时会收到推送

    Args:
        websocket: WebSocket 连接
        char_name: 角色名称
    """
    from services.notification_service import NotificationService

    await websocket.accept()
    await NotificationService.register_connection(char_name, websocket)

    try:
        print(f"[WebSocket] 连接已建立: {char_name}")

        # 发送欢迎消息
        await websocket.send_json({
            "type": "connected",
            "char_name": char_name,
            "message": "WebSocket 连接已建立"
        })

        # 保持连接,接收心跳
        while True:
            data = await websocket.receive_text()

            # 处理心跳
            if data == "ping":
                await websocket.send_text("pong")

    except WebSocketDisconnect:
        print(f"[WebSocket] 连接已断开: {char_name}")
    except Exception as e:
        print(f"[WebSocket] 错误: {char_name}, {str(e)}")
    finally:
        await NotificationService.unregister_connection(char_name, websocket)


# ==================== 测试接口 ====================

class TestTriggerRequest(BaseModel):
    """测试触发请求"""
    speakers: List[str]  # 说话人列表
    trigger_floor: int  # 触发楼层
    chat_branch: Optional[str] = "test_branch"  # 对话分支ID,默认为测试分支
    context_count: Optional[int] = 30  # 从当前对话中提取的上下文数量


@router.post("/phone_call/test/trigger_auto_call")
async def test_trigger_auto_call(req: TestTriggerRequest):
    """
    测试接口: 手动触发自动电话生成

    用于开发测试,直接触发自动调度,无需等待 webhook

    Args:
        req: 包含说话人列表、触发楼层等信息

    Returns:
        调度结果
    """
    try:
        check_phone_call_enabled()
        from services.auto_call_scheduler import AutoCallScheduler
        from services.conversation_monitor import ConversationMonitor

        print(f"\n[TestTrigger] 手动触发测试:")
        print(f"  - speakers: {req.speakers}")
        print(f"  - trigger_floor: {req.trigger_floor}")
        print(f"  - chat_branch: {req.chat_branch}")
        print(f"  - context_count: {req.context_count}")

        # 从 SillyTavern 获取当前对话上下文
        # 注意: 这里需要前端传递上下文,因为后端无法直接访问 SillyTavern 的对话数据
        # 所以我们使用一个简单的模拟上下文
        monitor = ConversationMonitor()

        # 模拟上下文 (实际使用时,前端应该传递真实的对话上下文)
        context = [
            {"name": "User", "is_user": True, "mes": "你好"},
            {"name": req.speakers[0] if req.speakers else "角色", "is_user": False, "mes": "你好!有什么可以帮你的吗?"}
        ]

        # 调度生成任务
        scheduler = AutoCallScheduler()
        call_id = await scheduler.schedule_auto_call(
            chat_branch=req.chat_branch,
            speakers=req.speakers,
            trigger_floor=req.trigger_floor,
            context=context
        )

        if call_id is None:
            return {
                "status": "duplicate",
                "message": f"该楼层已生成或正在生成中: 楼层{req.trigger_floor}"
            }

        return {
            "status": "success",
            "call_id": call_id,
            "message": f"✅ 测试触发成功: call_id={call_id}, speakers={req.speakers} @ 楼层{req.trigger_floor}"
        }

    except Exception as e:
        print(f"[TestTrigger] ❌ 错误: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class ErrorLogRequest(BaseModel):
    """前端错误日志请求"""
    error_type: str
    error_message: str
    error_stack: Optional[str] = None
    call_id: Optional[int] = None
    char_name: Optional[str] = None
    llm_config: Optional[Dict] = None
    raw_llm_response: Optional[Dict] = None  # 原始LLM响应数据
    timestamp: str


@router.post("/phone_call/log_error")
async def log_error(req: ErrorLogRequest):
    """
    接收前端错误日志并输出到后端控制台

    Args:
        req: 错误日志信息

    Returns:
        确认信息
    """
    print(f"\n{'='*80}")
    print(f"[前端错误报告] {req.timestamp}")
    print(f"{'='*80}")
    print(f"错误类型: {req.error_type}")
    print(f"错误消息: {req.error_message}")

    if req.call_id:
        print(f"Call ID: {req.call_id}")

    if req.char_name:
        print(f"角色名称: {req.char_name}")

    if req.llm_config:
        print(f"\nLLM 配置:")
        print(f"  - API URL: {req.llm_config.get('api_url', 'N/A')}")
        print(f"  - Model: {req.llm_config.get('model', 'N/A')}")
        print(f"  - Temperature: {req.llm_config.get('temperature', 'N/A')}")
        print(f"  - Max Tokens: {req.llm_config.get('max_tokens', 'N/A')}")

    if req.raw_llm_response:
        import json
        print(f"\n原始 LLM 响应数据:")
        print(f"  - 数据类型: {type(req.raw_llm_response).__name__}")
        if isinstance(req.raw_llm_response, dict):
            print(f"  - 响应键: {list(req.raw_llm_response.keys())}")
        print(f"\n完整响应 (JSON格式):")
        print(json.dumps(req.raw_llm_response, indent=2, ensure_ascii=False))

    if req.error_stack:
        print(f"\n错误堆栈:")
        print(req.error_stack)

    print(f"{'='*80}\n")

    return {
        "status": "logged",
        "message": "错误已记录到后端控制台"
    }
