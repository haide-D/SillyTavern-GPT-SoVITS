from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import SETTINGS_FILE, load_json, save_json
from services.telegram_import_service import TelegramImportService
from services.telegram_service import telegram_service
from telegram_app.assets.repository import TelegramAssetRepository

router = APIRouter(prefix="/api/telegram", tags=["Telegram Bot"])
asset_repo = TelegramAssetRepository()
import_service = TelegramImportService(asset_repo=asset_repo)


class TelegramConfigUpdate(BaseModel):
    enabled: bool = False
    config: Dict[str, Any] = Field(default_factory=dict)


class TelegramBotBindingUpdate(BaseModel):
    character_ref: str = Field(..., description="Imported pack character_ref")


def _load_telegram_config() -> Dict[str, Any]:
    settings = load_json(SETTINGS_FILE)
    config = settings.get("telegram", {})
    if not isinstance(config, dict):
        config = {}
    return config


def _save_telegram_config(config: Dict[str, Any]):
    settings = load_json(SETTINGS_FILE)
    settings["telegram"] = config
    save_json(SETTINGS_FILE, settings)


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
    config = _load_telegram_config()
    return {"enabled": bool(config.get("enabled", False)), "config": config}


@router.put("/config")
async def update_config(data: TelegramConfigUpdate):
    telegram_cfg = dict(data.config)
    telegram_cfg["enabled"] = data.enabled
    _save_telegram_config(telegram_cfg)
    return {"status": "success", "message": "Telegram 配置更新成功"}


@router.get("/packs")
async def list_packs():
    return {"packs": asset_repo.list_packs()}


@router.get("/packs/{pack_id}")
async def get_pack(pack_id: str):
    pack = asset_repo.get_pack(pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail=f"未找到资产包: {pack_id}")
    from telegram_app.assets.import_tools import asset_pack_to_dict

    return {"pack": asset_pack_to_dict(pack)}


@router.get("/packs/{pack_id}/characters")
async def get_pack_characters(pack_id: str):
    pack = asset_repo.get_pack(pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail=f"未找到资产包: {pack_id}")
    return {
        "pack_id": pack.pack_id,
        "characters": [
            {
                "character_ref": character.character_ref,
                "name": character.name,
                "description": character.description,
                "personality": character.personality,
            }
            for character in pack.characters
        ],
    }


@router.post("/import/preview")
async def preview_import(req: Dict[str, Any]):
    try:
        return await import_service.preview_import(req)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {str(exc)}")


@router.post("/import/commit")
async def commit_import(req: Dict[str, Any]):
    try:
        pack = req.get("pack") if isinstance(req.get("pack"), dict) else req
        if not isinstance(pack, dict):
            raise ValueError("导入保存失败：pack 必须是对象")
        return import_service.commit_import(pack)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/bots")
async def list_bots():
    config = _load_telegram_config()
    bots = config.get("bots", []) if isinstance(config.get("bots"), list) else []
    return {"bots": bots}


@router.put("/bots/{bot_id}/binding")
async def update_bot_binding(bot_id: str, data: TelegramBotBindingUpdate):
    config = _load_telegram_config()
    bots = config.get("bots", []) if isinstance(config.get("bots"), list) else []
    updated = False
    for bot in bots:
        if str(bot.get("bot_id") or "").strip() == bot_id:
            bot["character_ref"] = data.character_ref.strip()
            updated = True
            break
    if not updated:
        raise HTTPException(status_code=404, detail=f"未找到 bot: {bot_id}")
    config["bots"] = bots
    _save_telegram_config(config)
    return {
        "success": True,
        "bot_id": bot_id,
        "character_ref": data.character_ref.strip(),
    }
