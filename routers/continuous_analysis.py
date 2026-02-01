"""
持续性分析相关API路由
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional

from services.continuous_analyzer import ContinuousAnalyzer
from services.smart_trigger_engine import SmartTriggerEngine
from services.phone_reply_service import PhoneReplyService
from services.auto_call_scheduler import AutoCallScheduler
from services.notification_service import NotificationService

router = APIRouter()

# 初始化服务
continuous_analyzer = ContinuousAnalyzer()
smart_trigger = SmartTriggerEngine()
phone_reply = PhoneReplyService()


# ==================== 请求模型 ====================

class ContinuousAnalysisCompleteRequest(BaseModel):
    """持续性分析完成请求"""
    chat_branch: str
    floor: int
    context_fingerprint: str
    llm_response: str
    speakers: List[str]


class SmartTriggerEvaluateRequest(BaseModel):
    """智能触发评估请求"""
    chat_branch: str
    character_name: str
    current_floor: int


class PhoneReplyRequest(BaseModel):
    """电话回复请求"""
    char_name: str
    user_reply: str
    call_id: Optional[int] = None
    chat_branch: Optional[str] = None


# ==================== API 端点 ====================

@router.post("/continuous_analysis/complete")
async def complete_continuous_analysis(req: ContinuousAnalysisCompleteRequest):
    """
    完成持续性分析 (统一入口 - 含触发分流)
    
    流程:
    1. 接收前端的 LLM 响应
    2. 解析响应并提取角色状态 + 触发建议
    3. 保存到数据库
    4. 根据 suggested_action 分流触发 phone_call 或 eavesdrop
    5. 通知前端完成
    
    Args:
        req: 包含 chat_branch、floor、llm_response 等
        
    Returns:
        保存和触发结果
    """
    from services.auto_call_scheduler import AutoCallScheduler
    from services.eavesdrop_scheduler import EavesdropScheduler
    
    try:
        print(f"\n{'='*60}")
        print(f"[ContinuousAnalysis] 📥 收到分析完成请求")
        print(f"  - 楼层: {req.floor}")
        print(f"  - 分支: {req.chat_branch}")
        print(f"  - 说话人: {req.speakers}")
        print(f"  - LLM 响应长度: {len(req.llm_response) if req.llm_response else 0}")
        print(f"{'='*60}\n")
        
        # 保存分析结果 (返回包含 suggested_action 等信息)
        result = continuous_analyzer.save_analysis_result(
            chat_branch=req.chat_branch,
            floor=req.floor,
            context_fingerprint=req.context_fingerprint,
            llm_response=req.llm_response,
            speakers=req.speakers
        )
        
        if not result.get("success"):
            return {
                "success": False,
                "message": result.get("error", "分析记录保存失败")
            }
        
        # 提取触发信息
        suggested_action = result.get("suggested_action", "none")
        character_left = result.get("character_left")
        trigger_reason = result.get("trigger_reason", "")
        
        print(f"[ContinuousAnalysis] 📊 触发建议: {suggested_action}, 离场角色: {character_left}")
        
        # ==================== 根据分析结果分流 ====================
        trigger_result = None
        
        if suggested_action == "phone_call" and character_left:
            # 触发主动电话
            print(f"[ContinuousAnalysis] 📞 触发主动电话: {character_left}")
            scheduler = AutoCallScheduler()
            call_id = await scheduler.schedule_auto_call(
                chat_branch=req.chat_branch,
                speakers=req.speakers,
                trigger_floor=req.floor,
                context=[],  # 上下文由前端提供，此处简化
                context_fingerprint=req.context_fingerprint,
                user_name=None,
                char_name=character_left
            )
            trigger_result = {
                "action": "phone_call",
                "call_id": call_id,
                "character": character_left
            }
            
        elif suggested_action == "eavesdrop":
            # 触发对话追踪
            print(f"[ContinuousAnalysis] 🎧 触发对话追踪")
            eavesdrop_scheduler = EavesdropScheduler()
            record_id = await eavesdrop_scheduler.schedule_eavesdrop(
                chat_branch=req.chat_branch,
                speakers=req.speakers,
                trigger_floor=req.floor,
                context=[],
                context_fingerprint=req.context_fingerprint,
                user_name=None,
                char_name=req.speakers[0] if req.speakers else None,
                scene_description=trigger_reason
            )
            trigger_result = {
                "action": "eavesdrop",
                "record_id": record_id
            }
        
        # 通知前端分析完成
        await NotificationService.broadcast_to_char(
            char_name=req.speakers[0] if req.speakers else "unknown",
            message={
                "type": "continuous_analysis_complete",
                "floor": req.floor,
                "success": True,
                "suggested_action": suggested_action,
                "trigger_result": trigger_result
            }
        )
        
        return {
            "success": True,
            "message": f"楼层 {req.floor} 分析完成",
            "record_id": result.get("record_id"),
            "suggested_action": suggested_action,
            "trigger_result": trigger_result
        }
            
    except Exception as e:
        print(f"[ContinuousAnalysis] 错误: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/continuous_analysis/records")
async def get_analysis_records(chat_branch: str, limit: int = 20):
    """
    获取分析历史记录
    
    Args:
        chat_branch: 对话分支ID
        limit: 返回记录数量限制
        
    Returns:
        分析记录列表
    """
    try:
        from database import DatabaseManager
        db = DatabaseManager()
        
        records = db.get_analysis_history(chat_branch, limit)
        
        return {
            "success": True,
            "records": records,
            "total": len(records)
        }
        
    except Exception as e:
        print(f"[ContinuousAnalysis] 获取记录失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/smart_trigger/evaluate")
async def evaluate_smart_trigger(req: SmartTriggerEvaluateRequest):
    """
    评估智能触发条件
    
    Args:
        req: 包含 chat_branch、character_name、current_floor
        
    Returns:
        评估结果
    """
    try:
        should_trigger, reason, score = smart_trigger.should_trigger_call(
            chat_branch=req.chat_branch,
            character_name=req.character_name,
            current_floor=req.current_floor
        )
        
        return {
            "success": True,
            "should_trigger": should_trigger,
            "reason": reason,
            "score": score
        }
        
    except Exception as e:
        print(f"[SmartTrigger] 评估失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/phone_call/reply")
async def handle_phone_reply(req: PhoneReplyRequest):
    """
    处理用户电话回复
    
    Args:
        req: 包含 char_name、user_reply、call_id
        
    Returns:
        处理结果
    """
    try:
        print(f"[PhoneReply] 收到电话回复: {req.char_name} <- {req.user_reply[:30]}")
        
        # 处理回复
        message = phone_reply.process_reply(
            char_name=req.char_name,
            user_reply=req.user_reply,
            call_id=req.call_id
        )
        
        # 通过 WebSocket 发送给前端
        await NotificationService.broadcast_to_char(
            char_name=req.char_name,
            message=message
        )
        
        return {
            "success": True,
            "message": "回复已发送"
        }
        
    except Exception as e:
        print(f"[PhoneReply] 处理失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/character/trajectory/{chat_branch}/{character_name}")
async def get_character_trajectory(chat_branch: str, character_name: str, limit: int = 10):
    """
    获取角色历史轨迹
    
    Args:
        chat_branch: 对话分支ID
        character_name: 角色名称
        limit: 返回记录数量
        
    Returns:
        角色轨迹列表
    """
    try:
        trajectory = continuous_analyzer.get_character_trajectory(
            chat_branch=chat_branch,
            character_name=character_name,
            limit=limit
        )
        
        return {
            "success": True,
            "character": character_name,
            "trajectory": trajectory
        }
        
    except Exception as e:
        print(f"[Trajectory] 获取失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))
