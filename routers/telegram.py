from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from services.telegram_service import telegram_service
from config import load_json, save_json, SETTINGS_FILE

router = APIRouter(prefix="/api/telegram", tags=["Telegram Bot"])

class TelegramConfigUpdate(BaseModel):
    enabled: bool
    bot_token: str
    allowed_chat_ids: List[str]
    proxy_enabled: bool
    proxy_url: str
    llm_api_url: str
    llm_api_key: str
    llm_model: str
    system_prompt: str
    voice_reply: bool

@router.get("/status")
async def get_status():
    """获取 Bot 运行状态"""
    return {
        "is_running": telegram_service.is_running
    }

@router.post("/start")
async def start_bot():
    """手动启动 Bot"""
    if telegram_service.is_running:
        return {"status": "success", "message": "Bot 已经在运行中"}
        
    success = await telegram_service.start()
    if success:
        return {"status": "success", "message": "Bot 启动成功"}
    else:
        raise HTTPException(status_code=500, detail="Bot 启动失败，请检查配置或终端日志")

@router.post("/stop")
async def stop_bot():
    """手动停止 Bot"""
    if not telegram_service.is_running:
        return {"status": "success", "message": "Bot 已经停止"}
        
    await telegram_service.stop()
    return {"status": "success", "message": "Bot 停止成功"}

@router.get("/config")
async def get_config():
    """获取 TG Bot 配置"""
    settings = load_json(SETTINGS_FILE)
    config = settings.get("telegram", {})
    proxy = config.get("proxy", {})
    llm = config.get("llm", {})
    
    return {
        "enabled": config.get("enabled", False),
        "bot_token": config.get("bot_token", ""),
        "allowed_chat_ids": config.get("allowed_chat_ids", []),
        "proxy_enabled": proxy.get("enabled", True),
        "proxy_url": proxy.get("http", "http://127.0.0.1:7890"),
        "llm_api_url": llm.get("api_url", ""),
        "llm_api_key": llm.get("api_key", ""),
        "llm_model": llm.get("model", "gemini-2.5-flash"),
        "system_prompt": llm.get("system_prompt", "你是一个可以通过Telegram与用户聊天的角色扮演AI。请保持简短口语化的回复。"),
        "voice_reply": config.get("voice_reply", True)
    }

@router.put("/config")
async def update_config(data: TelegramConfigUpdate):
    """更新 TG Bot 配置"""
    settings = load_json(SETTINGS_FILE)
    if "telegram" not in settings:
        settings["telegram"] = {}
        
    tg = settings["telegram"]
    tg["enabled"] = data.enabled
    tg["bot_token"] = data.bot_token
    tg["allowed_chat_ids"] = data.allowed_chat_ids
    tg["voice_reply"] = data.voice_reply
    
    if "proxy" not in tg:
        tg["proxy"] = {}
    tg["proxy"]["enabled"] = data.proxy_enabled
    tg["proxy"]["http"] = data.proxy_url
    tg["proxy"]["https"] = data.proxy_url
    
    if "llm" not in tg:
        tg["llm"] = {}
    tg["llm"]["api_url"] = data.llm_api_url
    tg["llm"]["api_key"] = data.llm_api_key
    tg["llm"]["model"] = data.llm_model
    tg["llm"]["system_prompt"] = data.system_prompt
    
    save_json(SETTINGS_FILE, settings)
    
    # 如果状态是启用且 bot 没运行，如果原本在运行并更新了配置，也可以做判断重启，当前简单处理
    if data.enabled and not telegram_service.is_running:
        # 可以尝试自动启动，也可以留给前端或重启生效
        pass
        
    return {"status": "success", "message": "配置更新成功"}
