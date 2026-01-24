# 实时对话路由 - FastAPI

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import sys
import os

# 添加父目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from .realtime_service import RealtimeService
from .text_chunker import TextChunker

router = APIRouter(tags=["realtime"])

# 全局服务实例
_service = RealtimeService()
_chunker = TextChunker(min_length=5, max_length=50)


class TTSRequest(BaseModel):
    """TTS请求模型"""
    text: str
    ref_audio_path: str
    prompt_text: str = ""
    text_lang: str = "zh"
    prompt_lang: str = "zh"


class InterruptRequest(BaseModel):
    """打断请求模型"""
    pass


@router.post("/tts_stream")
async def tts_stream(request: TTSRequest):
    """
    流式TTS生成
    
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
        async for chunk in _service.stream_tts(
            text=request.text,
            ref_audio_path=request.ref_audio_path,
            prompt_text=request.prompt_text,
            text_lang=request.text_lang,
            prompt_lang=request.prompt_lang
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
    
    取消正在进行的TTS请求，清空文本缓冲区
    
    Returns:
        {success: bool, message: str}
    """
    # 清空分段器缓冲区
    _chunker.clear()
    
    # 取消TTS请求
    cancelled = _service.cancel()
    
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
    ref = _service.get_default_ref_audio(char_name)
    
    if not ref.get("path"):
        raise HTTPException(status_code=404, detail="未找到参考音频配置")
    
    return ref


@router.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "service": "realtime",
        "sovits_host": _service.sovits_host
    }
