import time
import uuid
import json
from typing import List, Dict, Optional, Any
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from config import load_json, SETTINGS_FILE
from database import DatabaseManager
from services.phone_call_service import PhoneCallService
from services.llm_service import LLMService
from services.emotion_service import EmotionService
from services.notification_service import NotificationService
from services.auto_call_scheduler import AutoCallScheduler
from services.eavesdrop_scheduler import EavesdropScheduler
from services.continuous_analyzer import ContinuousAnalyzer
from services.scene_analyzer import SceneAnalyzer

router = APIRouter()
phone_call_service = PhoneCallService()
db = DatabaseManager()
scheduler = AutoCallScheduler()
eavesdrop_scheduler = EavesdropScheduler()
analyzer = ContinuousAnalyzer()
scene_analyzer = SceneAnalyzer()
notification_service = NotificationService()

# 防重复：最近处理的指纹缓存
_recent_fingerprints: Dict[str, float] = {}
_FINGERPRINT_EXPIRE_SECONDS = 10


def check_phone_call_enabled():
    """检查电话功能是否启用，如果禁用则抛出 403 错误"""
    settings = load_json(SETTINGS_FILE)
    phone_call_config = settings.get("phone_call", {})
    if not phone_call_config.get("enabled", True):
        raise HTTPException(
            status_code=403,
            detail="电话功能已被禁用 (phone_call.enabled = false)"
        )


# ==================== Pydantic Schemas ====================

class ContextMessage(BaseModel):
    """对话上下文消息"""
    name: str
    is_user: bool
    mes: str


class PhoneCallRequest(BaseModel):
    """主动电话生成请求"""
    char_name: str
    context: List[Dict[str, Any]]


class BuildPromptRequest(BaseModel):
    """构建提示词请求 (支持定向呼叫)"""
    char_name: str
    context: List[Dict[str, Any]]
    user_name: Optional[str] = None
    preset_id: Optional[str] = None
    prompt_template: Optional[str] = None
    caller: Optional[str] = None
    target: Optional[str] = None
    receiver: Optional[str] = None
    call_reason: Optional[str] = None
    call_tone: Optional[str] = None
    character_persona: Optional[str] = None
    world_info: Optional[str] = None
    story_summary: Optional[str] = None
    chat_branch: Optional[str] = None
    text_lang: Optional[str] = None
    language: Optional[str] = None


class ParseAndGenerateRequest(BaseModel):
    """解析并生成音频请求"""
    char_name: str
    llm_response: str
    generate_audio: Optional[bool] = True
    chat_branch: Optional[str] = None
    context_fingerprint: Optional[str] = None
    trigger_floor: Optional[int] = None
    target_user: Optional[str] = None
    text_lang: Optional[str] = None
    language: Optional[str] = None


class CompleteGenerationRequest(BaseModel):
    """完成生成请求 (前端返回 LLM 响应)"""
    call_id: int
    llm_response: str
    chat_branch: str
    speakers: List[str]
    char_name: Optional[str] = None


class LLMTestRequest(BaseModel):
    """LLM 测试请求"""
    api_url: str
    api_key: str
    model: str
    temperature: Optional[float] = 0.8
    max_tokens: Optional[int] = 500
    test_prompt: Optional[str] = "你好,请回复'测试成功'"


class TestTriggerRequest(BaseModel):
    """手动测试触发请求"""
    chat_branch: str
    speakers: List[str]
    current_floor: Optional[int] = 1


class MessageWebhookRequest(BaseModel):
    """SillyTavern 消息 Webhook 请求"""
    chat_branch: str
    current_floor: int
    context: List[ContextMessage]
    speakers: List[str]
    context_fingerprint: str
    user_name: Optional[str] = "User"
    char_name: Optional[str] = None
    character_persona: Optional[str] = None
    world_info: Optional[str] = None


class SceneAnalysisCompleteRequest(BaseModel):
    """场景分析完成请求"""
    request_id: str
    llm_response: str
    chat_branch: str
    trigger_floor: int
    context: List[Dict[str, Any]]
    context_fingerprint: str
    speakers: List[str]
    user_name: Optional[str] = "User"
    char_name: Optional[str] = None


class FingerprintHistoryRequest(BaseModel):
    """按指纹查询历史请求"""
    fingerprints: List[str]
    limit: Optional[int] = 50


class TestTriggerRequest(BaseModel):
    """测试触发请求"""
    speakers: List[str]
    trigger_floor: int
    chat_branch: Optional[str] = "test_branch"
    context_count: Optional[int] = 30


class ErrorLogRequest(BaseModel):
    """前端错误日志请求"""
    error_type: str
    error_message: str
    error_stack: Optional[str] = None
    call_id: Optional[int] = None
    char_name: Optional[str] = None
    llm_config: Optional[Dict[str, Any]] = None
    raw_llm_response: Optional[Dict[str, Any]] = None
    timestamp: str


# ==================== 核心业务端点 ====================

@router.post("/phone_call/build_prompt")
async def build_prompt(req: BuildPromptRequest):
    """构建 LLM 提示词与调用配置"""
    check_phone_call_enabled()
    return await phone_call_service.build_prompt(
        char_name=req.char_name,
        context=req.context,
        user_name=req.user_name,
        preset_id=req.preset_id,
        prompt_template=req.prompt_template,
        caller=req.caller,
        target=req.target,
        receiver=req.receiver,
        call_reason=req.call_reason,
        call_tone=req.call_tone,
        character_persona=req.character_persona,
        world_info=req.world_info,
        story_summary=req.story_summary,
        chat_branch=req.chat_branch,
        text_lang=req.text_lang or req.language
    )


@router.post("/phone_call/complete_generation")
async def complete_generation(req: CompleteGenerationRequest):
    """完成自动电话生成 (前端返回 LLM 响应后合成音频并更新状态)"""
    check_phone_call_enabled()
    return await phone_call_service.complete_generation(
        call_id=req.call_id,
        llm_response=req.llm_response,
        chat_branch=req.chat_branch,
        speakers=req.speakers,
        char_name=req.char_name
    )


@router.post("/phone_call/parse_and_generate")
async def parse_and_generate(req: ParseAndGenerateRequest):
    """解析 LLM 响应并按需生成音频，同时自动保存音频与入库"""
    check_phone_call_enabled()
    return await phone_call_service.parse_and_generate(
        char_name=req.char_name,
        llm_response=req.llm_response,
        generate_audio=req.generate_audio,
        chat_branch=req.chat_branch,
        context_fingerprint=req.context_fingerprint,
        trigger_floor=req.trigger_floor,
        target_user=req.target_user,
        text_lang=req.text_lang or req.language
    )


@router.post("/phone_call/generate")
async def generate_phone_call(req: PhoneCallRequest):
    """生成主动电话内容 (兼容旧接口)"""
    check_phone_call_enabled()
    return await phone_call_service.generate(char_name=req.char_name, context=req.context)


@router.get("/phone_call/emotions/{char_name}")
def get_emotions(char_name: str):
    """获取指定角色可用情绪列表"""
    check_phone_call_enabled()
    emotions = EmotionService.get_available_emotions(char_name)
    return {
        "status": "success",
        "char_name": char_name,
        "emotions": emotions
    }


@router.post("/phone_call/test_llm")
async def test_llm(req: LLMTestRequest):
    """测试 LLM 接口连通性"""
    check_phone_call_enabled()
    return await LLMService.test_connection(req.dict())


# ==================== 统一分析与 Webhook ====================

@router.post("/phone_call/webhook/message")
async def message_webhook(req: MessageWebhookRequest):
    """接收 SillyTavern 消息 Webhook，触发统一分析检测"""
    check_phone_call_enabled()

    # 防重复指纹拦截
    now = time.time()
    expired = [fp for fp, ts in _recent_fingerprints.items() if now - ts > _FINGERPRINT_EXPIRE_SECONDS]
    for fp in expired:
        del _recent_fingerprints[fp]

    if req.context_fingerprint in _recent_fingerprints:
        return {"status": "skipped", "message": "重复请求已跳过"}
    _recent_fingerprints[req.context_fingerprint] = now

    if not req.speakers:
        return {"status": "skipped", "message": "没有可用的说话人"}

    primary_speaker = req.speakers[0]
    if not analyzer.should_analyze(req.current_floor):
        return {"status": "skipped", "message": f"未达到分析间隔（当前楼层 {req.current_floor}）"}

    context_serializable = [
        {"name": c.name, "is_user": c.is_user, "mes": c.mes} if hasattr(c, 'name') else c 
        for c in req.context
    ]

    analysis_data = await analyzer.analyze_and_record(
        chat_branch=req.chat_branch,
        floor=req.current_floor,
        context=context_serializable,
        speakers=req.speakers,
        context_fingerprint=req.context_fingerprint,
        user_name=req.user_name,
        char_name=req.char_name,
        character_persona=req.character_persona or "",
        world_info=req.world_info or ""
    )

    if not analysis_data:
        return {"status": "error", "message": "构建分析请求失败"}

    request_id = str(uuid.uuid4())
    ws_target = req.char_name if req.char_name else primary_speaker

    await notification_service.broadcast_to_char(
        char_name=ws_target,
        message={
            "type": "continuous_analysis_request",
            "context": analysis_data["context"],
            "character_persona": analysis_data["character_persona"],
            "world_info": analysis_data["world_info"],
            "request_id": request_id,
            "chat_branch": req.chat_branch,
            "floor": req.current_floor,
            "context_fingerprint": req.context_fingerprint,
            "speakers": req.speakers,
            "user_name": req.user_name,
            "char_name": req.char_name,
            "prompt": analysis_data["prompt"],
            "llm_config": analysis_data["llm_config"]
        }
    )

    return {
        "status": "pending_analysis",
        "request_id": request_id,
        "message": "统一分析请求已发送，等待 LLM 返回结果"
    }


@router.post("/scene_analysis/complete")
async def scene_analysis_complete(req: SceneAnalysisCompleteRequest):
    """[DEPRECATED] 兼容旧版场景分析结果分流"""
    check_phone_call_enabled()

    analysis = scene_analyzer.parse_llm_response(req.llm_response, req.speakers)
    suggested_action = analysis.suggested_action

    if suggested_action == "eavesdrop":
        record_id = await eavesdrop_scheduler.schedule_eavesdrop(
            chat_branch=req.chat_branch,
            speakers=req.speakers,
            trigger_floor=req.trigger_floor,
            context=req.context,
            context_fingerprint=req.context_fingerprint,
            user_name=req.user_name,
            char_name=req.char_name,
            scene_description=analysis.scene_description
        )
        if record_id is None:
            return {"status": "duplicate", "message": "该上下文已生成或正在生成中"}

        return {
            "status": "scheduled",
            "action": "eavesdrop",
            "record_id": record_id,
            "analysis": {"action": suggested_action, "reason": analysis.reason, "characters_present": analysis.characters_present},
            "message": f"已调度对话追踪任务: {req.speakers} @ 楼层{req.trigger_floor}"
        }

    elif suggested_action == "phone_call":
        call_id = await scheduler.schedule_auto_call(
            chat_branch=req.chat_branch,
            speakers=req.speakers,
            trigger_floor=req.trigger_floor,
            context=req.context,
            context_fingerprint=req.context_fingerprint,
            user_name=req.user_name,
            char_name=req.char_name
        )
        if call_id is None:
            return {"status": "duplicate", "message": "该楼层已生成或正在生成中"}

        return {
            "status": "scheduled",
            "action": "phone_call",
            "call_id": call_id,
            "analysis": {"action": suggested_action, "reason": analysis.reason, "character_left": analysis.character_left},
            "message": f"已调度自动生成任务: {req.speakers} @ 楼层{req.trigger_floor}"
        }

    return {
        "status": "skipped",
        "action": "none",
        "analysis": {"action": suggested_action, "reason": analysis.reason},
        "message": f"场景分析建议不触发: {analysis.reason}"
    }


# ==================== 历史记录与 WebSocket ====================

@router.get("/phone_call/history")
async def get_phone_call_general_history(
    chat_branch: Optional[str] = None,
    char_name: Optional[str] = None,
    limit: int = 50
):
    """获取主动电话通用历史记录 (支持分支过滤、角色过滤或全量历史)"""
    check_phone_call_enabled()
    if chat_branch:
        history = db.get_auto_call_history_by_chat_branch(chat_branch, limit)
    elif char_name:
        history = db.get_auto_call_history(char_name, limit)
    else:
        history = db.get_all_auto_phone_calls(limit)
    return {
        "status": "success",
        "chat_branch": chat_branch,
        "char_name": char_name,
        "history": history,
        "records": history,
        "total": len(history)
    }


@router.get("/phone_call/auto/history/{char_name}")
async def get_auto_call_history(char_name: str, limit: int = 50):
    """获取角色的自动生成历史记录"""
    check_phone_call_enabled()
    history = db.get_auto_call_history(char_name, limit)
    return {
        "status": "success",
        "char_name": char_name,
        "history": history,
        "total": len(history)
    }


@router.get("/phone_call/auto/history_by_branch/{chat_branch:path}")
async def get_auto_call_history_by_branch(chat_branch: str, limit: int = 50):
    """根据对话分支获取自动生成历史记录"""
    check_phone_call_enabled()
    history = db.get_auto_call_history_by_chat_branch(chat_branch, limit)
    return {
        "status": "success",
        "chat_branch": chat_branch,
        "history": history,
        "total": len(history)
    }


@router.post("/phone_call/auto/history_by_fingerprints")
async def get_auto_call_history_by_fingerprints(req: FingerprintHistoryRequest):
    """根据指纹列表获取自动生成历史记录（支持跨分支匹配）"""
    check_phone_call_enabled()
    history = db.get_auto_call_history_by_fingerprints(req.fingerprints, req.limit)
    return {
        "status": "success",
        "fingerprints_count": len(req.fingerprints),
        "history": history,
        "total": len(history)
    }


@router.get("/phone_call/auto/latest/{char_name}")
async def get_latest_auto_call(char_name: str):
    """获取角色最新的自动生成记录"""
    check_phone_call_enabled()
    latest = db.get_latest_auto_call(char_name)
    return {
        "status": "success",
        "char_name": char_name,
        "latest": latest
    }


@router.websocket("/ws/phone_call/{char_name}")
async def websocket_phone_call(websocket: WebSocket, char_name: str):
    """WebSocket 实时推送连接"""
    await websocket.accept()
    await NotificationService.register_connection(char_name, websocket)

    try:
        print(f"[WebSocket] 连接已建立: {char_name}")
        await websocket.send_json({
            "type": "connected",
            "char_name": char_name,
            "message": "WebSocket 连接已建立"
        })

        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")

    except WebSocketDisconnect:
        print(f"[WebSocket] 连接已断开: {char_name}")
    except Exception as e:
        print(f"[WebSocket] 错误: {char_name}, {str(e)}")
    finally:
        await NotificationService.unregister_connection(char_name, websocket)


# ==================== 测试与错误上报 ====================

@router.post("/phone_call/test/trigger_auto_call")
async def test_trigger_auto_call(req: TestTriggerRequest):
    """测试接口: 手动触发自动电话生成"""
    check_phone_call_enabled()
    context = [
        {"name": "User", "is_user": True, "mes": "你好"},
        {"name": req.speakers[0] if req.speakers else "角色", "is_user": False, "mes": "你好!有什么可以帮你的吗?"}
    ]

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


@router.post("/phone_call/log_error")
async def log_error(req: ErrorLogRequest):
    """接收前端错误日志并输出到后端控制台"""
    print(f"\n{'='*80}\n[前端错误报告] {req.timestamp}\n{'='*80}")
    print(f"错误类型: {req.error_type}\n错误消息: {req.error_message}")
    if req.call_id:
        print(f"Call ID: {req.call_id}")
    if req.char_name:
        print(f"角色名称: {req.char_name}")
    if req.llm_config:
        print(f"LLM 配置: {req.llm_config}")
    if req.raw_llm_response:
        print(f"原始响应: {json.dumps(req.raw_llm_response, ensure_ascii=False)}")
    if req.error_stack:
        print(f"堆栈: {req.error_stack}")
    print(f"{'='*80}\n")

    return {
        "status": "logged",
        "message": "错误已记录到后端控制台"
    }
