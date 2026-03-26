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

@router.get("/characters")
async def list_characters():
    """
    列出所有可用角色及其参考音频
    
    扫描 MyCharacters 目录，返回每个角色的 default 情感参考音频。
    
    Returns:
        {characters: [{name, ref_audio_path, prompt_text, lang}, ...]}
    """
    import os
    from config import load_json, SETTINGS_FILE
    
    settings = load_json(SETTINGS_FILE)
    base_dir = settings.get("base_dir", "")
    
    if not base_dir or not os.path.isdir(base_dir):
        return {"characters": []}
    
    characters = []
    
    for name in sorted(os.listdir(base_dir)):
        char_dir = os.path.join(base_dir, name)
        if not os.path.isdir(char_dir):
            continue
        
        # 跳过隐藏目录
        if name.startswith('.'):
            continue
        
        # 查找模型权重文件 (.ckpt = GPT, .pth = SoVITS)
        gpt_path = None
        sovits_path = None
        for f in os.listdir(char_dir):
            if f.endswith('.ckpt') and gpt_path is None:
                gpt_path = os.path.join(char_dir, f)
            elif f.endswith('.pth') and sovits_path is None:
                sovits_path = os.path.join(char_dir, f)
        
        # 查找参考音频: Chinese/emotions 优先
        for lang_dir, lang_code in [("Chinese", "zh"), ("Japanese", "ja"), ("English", "en")]:
            emotions_dir = os.path.join(char_dir, "reference_audios", lang_dir, "emotions")
            if not os.path.isdir(emotions_dir):
                continue
            
            # 优先找 default 情感的音频
            default_audio = None
            any_audio = None
            for f in os.listdir(emotions_dir):
                if not f.endswith('.wav'):
                    continue
                if any_audio is None:
                    any_audio = f
                if f.startswith('default_'):
                    default_audio = f
                    break
            
            audio_file = default_audio or any_audio
            if audio_file:
                audio_path = os.path.join(emotions_dir, audio_file)
                # 从文件名提取 prompt_text: "emotion_文本内容.wav" -> "文本内容"
                base_name = os.path.splitext(audio_file)[0]
                prompt_text = base_name.split('_', 1)[1] if '_' in base_name else base_name
                
                characters.append({
                    "name": name,
                    "ref_audio_path": audio_path,
                    "prompt_text": prompt_text,
                    "lang": lang_code,
                    "gpt_path": gpt_path,
                    "sovits_path": sovits_path
                })
                break  # 只取第一个可用语言
    
    return {"characters": characters}


@router.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "service": "realtime",
        "sovits_host": _config.sovits_host
    }


# ===================== 流式对话接口 =====================

from .session_manager import session_manager


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
        
        # 使用 session_manager 构建消息（集成 prompt 模块和酒馆历史上下文）
        messages = session_manager.build_messages(
            user_input=request.user_input,
            event_type=None
        )
        
        # 如果独立的小组件前端传来了自己的聊天记录，则使用前端的历史记录覆盖后端的陈旧历史
        if request.messages is not None:
            # 保留 session_manager 精心构造的系统人设 prompt
            systems = [m for m in messages if m.get("role") == "system"]
            # 重组：系统人设 + 前端发来的历史上下文 + 当前的最新提问
            messages = systems + request.messages + [{"role": "user", "content": request.user_input}]
        
        print(f"[RealtimeRouter] 📝 使用 prompt 模块构建消息: {len(messages)} 条")

        
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


# ===================== 上下文提供者接口 =====================

from .context_provider import context_provider, ContextConfig
from .models import SyncContextRequest, GetContextRequest

@router.post("/context/sync")
async def sync_context(request: SyncContextRequest):
    """
    同步上下文数据（前端推送）
    
    Args:
        request.context: 酒馆上下文数据
        
    Returns:
        {success, message, character_name, message_count}
    """
    success = context_provider.update_context(request.context)
    
    if success:
        provider = context_provider.get()
        return {
            "success": True,
            "message": "上下文已同步",
            "character_name": provider.get_character_name() if provider else "",
            "message_count": len(provider._messages) if provider else 0
        }
    else:
        raise HTTPException(status_code=500, detail="同步失败")


@router.post("/context/get")
async def get_context(request: GetContextRequest = None):
    """
    获取历史上下文
    
    Args:
        request.max_messages: 最大消息数（可选）
        request.filter_config: 过滤配置（可选）
        request.extractors: 数据提取器配置（可选）
        
    Returns:
        HistoryContext 数据
    """
    config = None
    if request:
        from st_utils.message_filter import FilterConfig
        
        filter_cfg = None
        if request.filter_config:
            filter_cfg = FilterConfig(
                extract_tag=request.filter_config.get("extract_tag"),
                filter_tags=request.filter_config.get("filter_tags", [])
            )
        
        config = ContextConfig(
            max_messages=request.max_messages or 20,
            filter_config=filter_cfg,
            extractors=request.extractors or []
        )
    
    ctx = context_provider.get_context(config)
    return ctx.to_dict()


@router.get("/context/status")
async def context_status():
    """
    获取上下文状态
    
    Returns:
        {available, character_name, message_count, source}
    """
    provider = context_provider.get()
    
    if provider:
        return {
            "available": provider.is_available(),
            "character_name": provider.get_character_name(),
            "message_count": len(provider._messages),
            "source": provider.source_name
        }
    
    return {
        "available": False,
        "character_name": "",
        "message_count": 0,
        "source": ""
    }


# ===================== 预设管理接口 =====================

from .prompt.preset_loader import PresetLoader
from pydantic import BaseModel as PydanticBaseModel
from fastapi.responses import HTMLResponse
import os

_PRESETS_DIR = os.path.join(os.path.dirname(__file__), "prompt", "presets")


class SavePresetRequest(PydanticBaseModel):
    content: str  # YAML 内容


@router.get("/presets")
async def list_presets():
    """列出所有可用预设"""
    presets = PresetLoader.list_presets()
    return {"presets": presets}


@router.get("/presets/{name}")
async def get_preset(name: str):
    """获取预设内容（原始 YAML 文本）"""
    preset_path = os.path.join(_PRESETS_DIR, f"{name}.yaml")
    if not os.path.exists(preset_path):
        raise HTTPException(status_code=404, detail=f"预设不存在: {name}")

    with open(preset_path, "r", encoding="utf-8") as f:
        content = f.read()

    return {"name": name, "content": content}


@router.put("/presets/{name}")
async def save_preset(name: str, request: SavePresetRequest):
    """保存预设内容"""
    import yaml

    # 校验 YAML 语法
    try:
        yaml.safe_load(request.content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"YAML 语法错误: {e}")

    os.makedirs(_PRESETS_DIR, exist_ok=True)
    preset_path = os.path.join(_PRESETS_DIR, f"{name}.yaml")

    with open(preset_path, "w", encoding="utf-8") as f:
        f.write(request.content)

    return {"success": True, "message": f"预设 {name} 已保存"}


@router.delete("/presets/{name}")
async def delete_preset(name: str):
    """删除预设"""
    preset_path = os.path.join(_PRESETS_DIR, f"{name}.yaml")
    if not os.path.exists(preset_path):
        raise HTTPException(status_code=404, detail=f"预设不存在: {name}")

    os.remove(preset_path)
    return {"success": True, "message": f"预设 {name} 已删除"}


@router.get("/preset_editor", response_class=HTMLResponse)
async def preset_editor_page():
    """预设编辑器 HTML 页面"""
    html_path = os.path.join(os.path.dirname(__file__), "prompt", "preset_editor.html")
    if not os.path.exists(html_path):
        return HTMLResponse("<h1>编辑器页面不存在</h1>", status_code=404)

    with open(html_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())
