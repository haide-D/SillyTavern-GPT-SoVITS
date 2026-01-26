# 实时对话路由 - FastAPI

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
import json

from .models import TTSRequest, WarmupRequest, SwitchRefAudioRequest, ChatStreamRequest
from .services import ConfigService, TTSService, WarmupService, get_llm_service
from .text_chunker import TextChunker

router = APIRouter(tags=["realtime"])

# 服务层依赖注入
_config = ConfigService()
_tts = TTSService(_config)
_warmup = WarmupService(_config)
_chunker = TextChunker(min_length=5, max_length=50)
_llm = get_llm_service()


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


# ===================== 流式对话接口 =====================

@router.post("/chat_stream")
async def chat_stream(request: ChatStreamRequest):
    """
    流式对话 - 后端处理 LLM + TTS
    
    接收用户输入，返回 SSE 事件流：
    - event: token - LLM 生成的文本片段
    - event: tts_start - TTS 开始生成（包含分段文本）
    - event: done - 对话完成
    
    Returns:
        text/event-stream SSE 响应
    """
    if not request.user_input.strip():
        raise HTTPException(status_code=400, detail="用户输入不能为空")
    
    print(f"[RealtimeRouter] 💬 收到对话请求: '{request.user_input[:50]}...'")
    
    async def generate_stream():
        """生成 SSE 事件流"""
        full_response = ""
        text_buffer = ""
        
        # 构建消息列表
        messages = request.messages or []
        if request.system_prompt:
            messages = [{"role": "system", "content": request.system_prompt}] + messages
        elif not any(m.get("role") == "system" for m in messages):
            messages = [{"role": "system", "content": "你是一个友好的对话助手。请保持回复简洁，适合语音朗读。"}] + messages
        
        messages.append({"role": "user", "content": request.user_input})
        
        try:
            # 流式调用 LLM
            async for token in _llm.call_stream(messages):
                full_response += token
                text_buffer += token
                
                # 发送 token 事件
                yield f"event: token\ndata: {json.dumps({'content': token}, ensure_ascii=False)}\n\n"
                
                # 尝试分段
                chunks = _chunker.feed(token)
                for chunk in chunks:
                    # 发送 TTS 开始事件
                    yield f"event: tts_start\ndata: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
            
            # 刷新剩余内容
            remaining = _chunker.flush()
            if remaining:
                yield f"event: tts_start\ndata: {json.dumps({'text': remaining}, ensure_ascii=False)}\n\n"
            
            # 发送完成事件
            yield f"event: done\ndata: {json.dumps({'full_response': full_response}, ensure_ascii=False)}\n\n"
            
            print(f"[RealtimeRouter] ✅ 对话完成，长度: {len(full_response)}")
            
        except Exception as e:
            print(f"[RealtimeRouter] ❌ 对话错误: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


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


# ===================== 通话记忆管理接口 =====================

from .models import CallStartRequest, CallMessageRequest, CallEndRequest
from .call_memory import call_memory


@router.post("/call/start")
async def call_start(request: CallStartRequest):
    """
    开始通话，收集初始上下文
    
    Args:
        request.context: 初始上下文（角色、历史等）
        request.filter_config: 过滤配置（可选）
        
    Returns:
        {success, call_id, character_name}
    """
    try:
        call_id = call_memory.start(
            initial_context=request.context,
            filter_config=request.filter_config
        )
        
        session = call_memory.get_session(call_id)
        
        return {
            "success": True,
            "call_id": call_id,
            "character_name": session.character_name if session else ""
        }
    except Exception as e:
        print(f"[RealtimeRouter] ❌ 开始通话失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/call/message")
async def call_message(request: CallMessageRequest):
    """
    添加通话消息
    
    Args:
        request.call_id: 通话ID
        request.role: "user" | "assistant"
        request.content: 消息内容
        
    Returns:
        {success, message_count}
    """
    success = call_memory.add_message(
        call_id=request.call_id,
        role=request.role,
        content=request.content
    )
    
    if not success:
        raise HTTPException(status_code=404, detail="通话不存在或已结束")
    
    messages = call_memory.get_messages(request.call_id)
    
    return {
        "success": True,
        "message_count": len(messages)
    }


@router.post("/call/end")
async def call_end(request: CallEndRequest):
    """
    结束通话，返回全部记录（用于注入酒馆）
    
    Args:
        request.call_id: 通话ID
        
    Returns:
        完整通话记录
    """
    result = call_memory.end(request.call_id)
    
    if not result:
        raise HTTPException(status_code=404, detail="通话不存在")
    
    return {
        "success": True,
        **result
    }


@router.get("/call/status/{call_id}")
async def call_status(call_id: str):
    """
    获取通话状态
    
    Args:
        call_id: 通话ID
        
    Returns:
        通话状态信息
    """
    session = call_memory.get_session(call_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="通话不存在")
    
    return session.to_dict()
