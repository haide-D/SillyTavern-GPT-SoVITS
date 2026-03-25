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
    llm_response: Optional[str] = None  # ✅ 改为可选，允许前端在 LLM 失败时传 null
    speakers: List[str]
    context: Optional[List[Dict]] = None  # ✅ 新增: 对话上下文，用于 eavesdrop prompt 构建
    user_name: Optional[str] = None  # 用户名，用于 Prompt 构建
    char_card_name: Optional[str] = None  # 主角色卡名称，用于 WebSocket 推送路由
    error: Optional[str] = None  # ✅ 新增: 前端 LLM 调用错误信息
    raw_response: Optional[str] = None  # ✅ 新增: 前端 LLM 原始响应（用于调试）


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
        print(f"  - 用户名: {req.user_name}")
        print(f"  - 角色名: {req.char_card_name}")
        print(f"  - 上下文指纹: {req.context_fingerprint}")
        print(f"  - LLM 响应长度: {len(req.llm_response) if req.llm_response else 0}")
        
        # ✅ 如果前端 LLM 调用失败，打印完整错误信息
        if req.error or not req.llm_response:
            print(f"\n{'!'*60}")
            print(f"[ContinuousAnalysis] ⚠️ 前端 LLM 调用失败!")
            print(f"  - 错误信息: {req.error}")
            print(f"  - 完整请求体:")
            print(f"    chat_branch: {req.chat_branch}")
            print(f"    floor: {req.floor}")
            print(f"    context_fingerprint: {req.context_fingerprint}")
            print(f"    speakers: {req.speakers}")
            print(f"    user_name: {req.user_name}")
            print(f"    char_name: {req.char_card_name}")
            print(f"    llm_response: {req.llm_response}")
            print(f"    error: {req.error}")
            # ✅ 打印 LLM 原始响应
            if req.raw_response:
                print(f"\n  📦 LLM 原始响应:")
                print(f"{req.raw_response}")
            print(f"{'!'*60}\n")
            
            return {
                "success": False,
                "message": f"前端 LLM 调用失败: {req.error or '响应为空'}"
            }
        
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
        
        # ✅ 异步写入统一记忆层（打通酒馆 ↔ TG 记忆）
        if req.context and req.speakers:
            try:
                from services.memory_service import MemoryService
                import asyncio
                mem_svc = MemoryService()
                # 将酒馆对话上下文转为 MemoryService 格式
                messages = []
                for msg in req.context[-10:]:
                    name = msg.get("name", "")
                    content = msg.get("mes", "")
                    is_user = msg.get("is_user", False)
                    messages.append({
                        "role": "user" if is_user else "assistant",
                        "content": f"{name}: {content}" if not is_user else content
                    })
                
                if messages:
                    # 一次调用，一条快照，所有说话人信息打包在 character_profiles 里
                    non_user_speakers = [s for s in req.speakers if s != req.user_name]
                    asyncio.create_task(mem_svc.process_conversation(
                        source="tavern",
                        source_id=req.chat_branch,
                        context_fingerprint=req.context_fingerprint,
                        messages=messages,
                        speakers=non_user_speakers,
                        floor=req.floor
                    ))
                    print(f"[ContinuousAnalysis] 🧠 已触发记忆处理 (fp={req.context_fingerprint[:16]}...)")
            except Exception as e:
                print(f"[ContinuousAnalysis] ⚠️ 记忆处理触发失败: {e}")
        
        # 提取触发信息
        suggested_action = result.get("suggested_action", "none")
        caller = result.get("caller")  # 新格式：打电话的角色
        call_reason = result.get("call_reason", "")  # 打电话原因
        call_tone = result.get("call_tone", "")  # 通话氛围
        trigger_reason = result.get("trigger_reason", "")
        
        print(f"[ContinuousAnalysis] 📊 触发建议: {suggested_action}, reason: {trigger_reason}")
        if suggested_action == "phone_call" and caller:
            print(f"[ContinuousAnalysis] 📞 电话详情: caller={caller}, reason={call_reason}, tone={call_tone}")
        
        # ==================== 根据分析结果分流 ====================
        trigger_result = None
        
        if suggested_action == "phone_call" and caller:
                # 触发主动电话
                print(f"[ContinuousAnalysis] 📞 触发主动电话: caller={caller}, ws_target={req.char_card_name}")
                scheduler = AutoCallScheduler()
                call_id = await scheduler.schedule_auto_call(
                    chat_branch=req.chat_branch,
                    speakers=[caller],  # 打电话的角色
                    trigger_floor=req.floor,
                    context=[],  # 上下文由 PhoneCallService 根据 chat_branch 提取
                    context_fingerprint=req.context_fingerprint,
                    user_name=req.user_name,
                    char_name=req.char_card_name,  # ✅ 修复: 使用主角色卡名称进行 WebSocket 路由
                    call_reason=call_reason,  # 传递电话原因
                    call_tone=call_tone  # 传递通话氛围
                )
                trigger_result = {
                    "action": "phone_call",
                    "call_id": call_id,
                    "character": caller,
                    "call_reason": call_reason,
                    "call_tone": call_tone
                }
            
        elif suggested_action == "eavesdrop":
            # 触发对话追踪
            print(f"[ContinuousAnalysis] 🎧 触发对话追踪")
            
            # 提取离场角色
            character_left = result.get("character_left")
            
            # 从分析结果中提取在场角色（而不是使用原始 speakers 列表）
            present_characters = result.get("present_characters", [])
            if not present_characters:
                # 后备：如果没有在场角色信息，使用原始 speakers 但排除离场角色
                present_characters = [s for s in req.speakers if s != character_left] if character_left else req.speakers
            
            # ✅ 过滤出有语音功能的角色
            from config import filter_bound_speakers
            valid_speakers = filter_bound_speakers(present_characters)
            
            if len(valid_speakers) < 2:
                # 对话追踪至少需要2个角色有语音
                print(f"[ContinuousAnalysis] ⚠️ 跳过对话追踪: 有语音功能的角色少于2个 (valid_speakers={valid_speakers})")
                trigger_result = {
                    "action": "skipped",
                    "reason": f"有语音功能的角色少于2个"
                }
            else:
                # 提取 eavesdrop 配置（分析 LLM 提供的对话主题和框架）
                eavesdrop_config = result.get("eavesdrop_config", {})
                
                print(f"[ContinuousAnalysis] 📍 在场角色: {present_characters} -> 有效角色: {valid_speakers}")
                if eavesdrop_config:
                    print(f"[ContinuousAnalysis] 🎭 对话主题: {eavesdrop_config.get('conversation_theme', '未指定')}")
                
                eavesdrop_scheduler = EavesdropScheduler()
                record_id = await eavesdrop_scheduler.schedule_eavesdrop(
                    chat_branch=req.chat_branch,
                    speakers=valid_speakers,  # ✅ 使用过滤后的角色列表
                    trigger_floor=req.floor,
                    context=req.context or [],  # ✅ 修复: 使用前端传递的对话上下文
                    context_fingerprint=req.context_fingerprint,
                    user_name=req.user_name,
                    char_name=req.char_card_name,  # 使用主角色卡名称进行 WebSocket 路由
                    scene_description=trigger_reason,
                    eavesdrop_config=eavesdrop_config  # ✅ 传递对话主题和框架
                )
                trigger_result = {
                    "action": "eavesdrop",
                    "record_id": record_id
                }
        
        # 通知前端分析完成 (使用主角色卡名称作为 WebSocket 路由目标)
        ws_target = req.char_card_name if req.char_card_name else (req.speakers[0] if req.speakers else "unknown")
        await NotificationService.broadcast_to_char(
            char_name=ws_target,
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
