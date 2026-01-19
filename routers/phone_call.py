from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional

from services.phone_call_service import PhoneCallService
from services.llm_service import LLMService
from services.emotion_service import EmotionService

router = APIRouter()


class PhoneCallRequest(BaseModel):
    """主动电话生成请求"""
    char_name: str
    context: List[Dict[str, str]]


class LLMTestRequest(BaseModel):
    """LLM测试请求"""
    api_url: str
    api_key: str
    model: str
    temperature: Optional[float] = 0.8
    max_tokens: Optional[int] = 500
    test_prompt: Optional[str] = "你好,请回复'测试成功'"


@router.post("/phone_call/generate")
async def generate_phone_call(req: PhoneCallRequest):
    """
    生成主动电话内容
    
    Args:
        req: 包含角色名和对话上下文的请求
        
    Returns:
        情绪片段列表
    """
    try:
        service = PhoneCallService()
        segments = await service.generate(req.char_name, req.context)
        
        return {
            "status": "success",
            "segments": [seg.dict() for seg in segments],
            "total": len(segments)
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
