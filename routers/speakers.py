from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from database import DatabaseManager

router = APIRouter()


class UpdateSpeakersRequest(BaseModel):
    """更新说话人请求"""
    chat_branch: str
    speakers: List[str]
    mesid: Optional[int] = None


class BatchInitSpeakersRequest(BaseModel):
    """批量初始化说话人请求"""
    speakers_data: List[Dict[str, Any]]


@router.get("/speakers/{chat_branch}")
def get_speakers(chat_branch: str):
    """
    获取指定对话的所有说话人
    
    Args:
        chat_branch: 对话分支ID
        
    Returns:
        说话人列表
    """
    try:
        db = DatabaseManager()
        speakers = db.get_speakers_for_chat(chat_branch)
        
        return {
            "status": "success",
            "chat_branch": chat_branch,
            "speakers": speakers,
            "count": len(speakers)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/speakers/update")
def update_speakers(req: UpdateSpeakersRequest):
    """
    更新或插入对话的说话人列表
    
    Args:
        req: 包含 chat_branch, speakers, mesid 的请求
        
    Returns:
        操作结果
    """
    try:
        db = DatabaseManager()
        db.update_speakers_for_chat(req.chat_branch, req.speakers, req.mesid)
        
        return {
            "status": "success",
            "message": f"已更新对话 {req.chat_branch} 的说话人列表",
            "speakers": req.speakers,
            "count": len(req.speakers)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/speakers/batch_init")
def batch_init_speakers(req: BatchInitSpeakersRequest):
    """
    批量初始化说话人记录 (用于旧对话扫描)
    
    Args:
        req: 包含 speakers_data 列表的请求
        
    Returns:
        操作结果
    """
    try:
        db = DatabaseManager()
        db.batch_init_speakers(req.speakers_data)
        
        return {
            "status": "success",
            "message": f"已批量初始化 {len(req.speakers_data)} 条说话人记录",
            "count": len(req.speakers_data)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
