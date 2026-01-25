# 实时对话路由 - FastAPI

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional

from .models import TTSRequest, WarmupRequest, SwitchRefAudioRequest
from .services import ConfigService, TTSService, WarmupService
from .text_chunker import TextChunker

router = APIRouter(tags=["realtime"])

# 服务层依赖注入
_config = ConfigService()
_tts = TTSService(_config)
_warmup = WarmupService(_config)
_chunker = TextChunker(min_length=5, max_length=50)


# ===================== TTS 核心接口 =====================

@router.post("/tts_stream")
async def tts_stream(request: TTSRequest):
    """
    流式 TTS 生成
    
    接收文本片段，返回流式音频
    
    Returns:
        audio/wav 流式响应
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")
    
    if not request.ref_audio_path:
        raise HTTPException(status_code=400, detail="参考音频路径不能为空")
    
    print(f"[RealtimeRouter] 收到TTS请求: '{request.text[:30]}...'")
    
    async def generate():
        async for chunk in _tts.stream_tts(
            text=request.text,
            ref_audio_path=request.ref_audio_path,
            prompt_text=request.prompt_text,
            text_lang=request.text_lang,
            prompt_lang=request.prompt_lang,
            is_first_chunk=request.is_first_chunk
        ):
            yield chunk
    
    return StreamingResponse(
        generate(),
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff"
        }
    )


@router.post("/interrupt")
async def interrupt():
    """
    打断当前对话
    
    取消正在进行的 TTS 请求，清空文本缓冲区
    
    Returns:
        {success: bool, message: str}
    """
    # 清空分段器缓冲区
    _chunker.clear()
    
    # 取消 TTS 请求
    cancelled = _tts.cancel()
    
    print(f"[RealtimeRouter] 打断请求: cancelled={cancelled}")
    
    return {
        "success": True,
        "message": "已打断" if cancelled else "无进行中的请求"
    }


@router.get("/ref_audio")
async def get_ref_audio(char_name: Optional[str] = Query(None)):
    """
    获取参考音频信息
    
    Args:
        char_name: 角色名称 (可选)
        
    Returns:
        {path, text, lang} 参考音频信息
    """
    ref = _config.get_default_ref_audio(char_name)
    
    if not ref.get("path"):
        raise HTTPException(status_code=404, detail="未找到参考音频配置")
    
    return ref


@router.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "service": "realtime",
        "sovits_host": _config.sovits_host
    }


# ===================== 预热相关接口 =====================

@router.post("/warmup")
async def warmup(request: WarmupRequest = None):
    """
    预热 GPT-SoVITS 模型
    
    通过发送一个短文本请求，让 GPT-SoVITS 提前缓存参考音频特征。
    预热后，后续请求的延迟将从 ~3s 降至 ~0.3s。
    
    如果不传参数，将使用配置文件中的默认参考音频。
    
    Returns:
        {success, message, ref_audio_path, elapsed_ms, skipped}
    """
    if request is None:
        request = WarmupRequest()
    
    result = _warmup.warmup(
        ref_audio_path=request.ref_audio_path,
        prompt_text=request.prompt_text,
        prompt_lang=request.prompt_lang,
        force=request.force
    )
    
    return result


@router.post("/switch_ref_audio")
async def switch_ref_audio(request: SwitchRefAudioRequest):
    """
    切换参考音频（用于角色切换）
    
    切换到新的参考音频，并可选择自动预热。
    
    Returns:
        {success, message, old_path, new_path, warmup_result}
    """
    result = _warmup.switch_ref_audio(
        ref_audio_path=request.ref_audio_path,
        prompt_text=request.prompt_text,
        prompt_lang=request.prompt_lang,
        auto_warmup=request.auto_warmup
    )
    
    return result


@router.get("/warmup_status")
async def warmup_status():
    """
    获取当前预热状态
    
    Returns:
        {is_warmed_up, ref_audio_path, prompt_text, prompt_lang}
    """
    return _warmup.get_warmup_status()


# ===================== 会话管理接口 =====================

from .models import UpdateContextRequest, SwitchSceneRequest, BuildPromptRequest
from .session_manager import session_manager
from .prompt import SceneManager

@router.post("/session/update_context")
async def update_context(request: UpdateContextRequest):
    """
    更新上下文（接收酒馆数据）
    
    支持两种方式:
    1. 传入完整的酒馆上下文 (context 字段)
    2. 分别传入角色和消息 (character, messages 字段)
    
    Returns:
        {success, message, status}
    """
    data = {}
    
    # 优先使用完整上下文
    if request.context:
        data = request.context
    else:
        if request.character:
            data["character"] = request.character
        if request.messages:
            data["messages"] = request.messages
        if request.chat_id:
            data["chatId"] = request.chat_id
    
    if not data:
        raise HTTPException(status_code=400, detail="没有提供有效数据")
    
    success = session_manager.update_from_sillytavern(data)
    
    return {
        "success": success,
        "message": "上下文已更新" if success else "更新失败",
        "status": session_manager.get_status()
    }


@router.post("/session/switch_scene")
async def switch_scene(request: SwitchSceneRequest):
    """
    切换场景
    
    Returns:
        {success, current_scene, available_scenes}
    """
    success = session_manager.switch_scene(request.scene_id)
    
    return {
        "success": success,
        "current_scene": session_manager.get_current_scene(),
        "available_scenes": SceneManager.list_scenes()
    }


@router.get("/session/scenes")
async def list_scenes():
    """
    获取所有可用场景
    
    Returns:
        {scenes: [{id, name}, ...], current: {id, name}}
    """
    return {
        "scenes": SceneManager.list_scenes(),
        "current": session_manager.get_current_scene()
    }


@router.post("/session/build_prompt")
async def build_prompt(request: BuildPromptRequest):
    """
    构建 LLM 提示词（测试用）
    
    Returns:
        {messages: [...], scene_id, character_name}
    """
    messages = session_manager.build_messages(
        user_input=request.user_input,
        event_type=request.event_type
    )
    
    return {
        "messages": messages,
        "scene_id": session_manager.context.scene_id,
        "character_name": session_manager.context.character_name
    }


@router.get("/session/status")
async def session_status():
    """
    获取会话状态
    
    Returns:
        {active, scene, history_count, character_name, ...}
    """
    return session_manager.get_status()


@router.post("/session/reset")
async def session_reset():
    """
    重置会话
    
    清空历史和状态
    
    Returns:
        {success, message}
    """
    session_manager.reset()
    return {
        "success": True,
        "message": "会话已重置"
    }


@router.post("/session/check_silence")
async def check_silence():
    """
    检查沉默事件
    
    Returns:
        {triggered, event} 或 {triggered: false}
    """
    event = session_manager.check_silence()
    
    if event:
        return {
            "triggered": True,
            "event": event
        }
    return {
        "triggered": False
    }

