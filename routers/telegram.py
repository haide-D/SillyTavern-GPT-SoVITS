from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import SETTINGS_FILE, load_json, save_json
from services.telegram_service import telegram_service
from telegram_app.assets.repository import TelegramAssetRepository

router = APIRouter(prefix="/api/telegram", tags=["Telegram Bot"])
asset_repo = TelegramAssetRepository()


class TelegramConfigUpdate(BaseModel):
    enabled: bool = False
    config: Dict[str, Any] = Field(default_factory=dict)


@router.get("/status")
async def get_status():
    return {"is_running": telegram_service.is_running}


@router.post("/start")
async def start_bot():
    if telegram_service.is_running:
        return {"status": "success", "message": "Bot 集群已经在运行中"}
    success = await telegram_service.start()
    if success:
        return {"status": "success", "message": "Bot 集群启动成功"}
    raise HTTPException(
        status_code=500, detail="Bot 集群启动失败，请检查配置或终端日志"
    )


@router.post("/stop")
async def stop_bot():
    if not telegram_service.is_running:
        return {"status": "success", "message": "Bot 集群已经停止"}
    await telegram_service.stop()
    return {"status": "success", "message": "Bot 集群停止成功"}


@router.get("/config")
async def get_config():
    settings = load_json(SETTINGS_FILE)
    config = settings.get("telegram", {})
    return {
        "enabled": bool(config.get("enabled", False)),
        "config": config,
    }


@router.put("/config")
async def update_config(data: TelegramConfigUpdate):
    settings = load_json(SETTINGS_FILE)
    telegram_cfg = dict(data.config)
    telegram_cfg["enabled"] = data.enabled
    settings["telegram"] = telegram_cfg
    save_json(SETTINGS_FILE, settings)
    return {"status": "success", "message": "Telegram 配置更新成功"}


@router.get("/packs")
async def list_packs():
    return {"packs": asset_repo.list_packs()}
