import re
from typing import Any, Dict, Optional, Union

from telegram_app.assets.import_models import TelegramImportRequest
from telegram_app.assets.import_tools import (
    asset_pack_from_dict,
    asset_pack_to_dict,
    get_import_tools,
    parse_import_tool_response,
)
from telegram_app.assets.repository import TelegramAssetRepository
from telegram_app.integrations.llm_client import TelegramLlmClient
from telegram_app.settings import get_telegram_settings


class TelegramImportService:
    def __init__(
        self,
        llm_client: Optional[TelegramLlmClient] = None,
        asset_repo: Optional[TelegramAssetRepository] = None,
    ):
        self._llm = llm_client or TelegramLlmClient()
        self._assets = asset_repo or TelegramAssetRepository()

    async def preview_import(
        self, request: Union[TelegramImportRequest, Dict[str, Any]]
    ) -> Dict[str, Any]:
        request = self._normalize_request(request)
        settings = get_telegram_settings()
        llm = settings.shared_llm
        if not llm.api_url or not llm.api_key:
            raise ValueError("Telegram 共享 LLM 未配置，无法执行导入")

        pack_id = self._sanitize_pack_id(
            request.options.pack_id
            or request.options.pack_name
            or request.source.char_name
            or "telegram-pack"
        )
        pack_name = (
            request.options.pack_name or request.source.char_name or pack_id
        ).strip() or pack_id

        payload = {
            "model": llm.model,
            "messages": [
                {"role": "system", "content": self._build_system_prompt()},
                {
                    "role": "user",
                    "content": self._build_user_prompt(request, pack_id, pack_name),
                },
            ],
            "temperature": 0.3,
            "max_tokens": max(llm.max_tokens, 2500),
            "stream": False,
            "tools": get_import_tools(),
            "tool_choice": {
                "type": "function",
                "function": {"name": "build_telegram_asset_pack"},
            },
        }

        data = await self._llm.chat_completions(llm.api_url, llm.api_key, payload)
        parsed = parse_import_tool_response(data)
        if not parsed:
            print("========== LLM 返回数据 ==========\n", data)
            raise ValueError(f"导入 LLM 未返回有效 asset pack 结构。完整回复已打印到控制台。")

        parsed["pack_id"] = self._sanitize_pack_id(parsed.get("pack_id") or pack_id)
        parsed["name"] = (parsed.get("name") or pack_name).strip() or pack_name
        if not parsed["pack_id"]:
            raise ValueError("导入结果缺少有效 pack_id")

        pack = asset_pack_from_dict(parsed)
        if not pack.characters:
            raise ValueError("导入结果没有生成任何角色")

        return {
            "success": True,
            "pack": asset_pack_to_dict(pack),
            "warnings": self._build_warnings(pack, request),
        }

    def commit_import(self, pack_payload: Dict[str, Any]) -> Dict[str, Any]:
        pack = asset_pack_from_dict(pack_payload)
        if not pack.pack_id or not pack.name:
            raise ValueError("保存失败：pack_id 或 name 为空")
        if not pack.characters:
            raise ValueError("保存失败：pack 中没有角色")
        path = self._assets.save_pack(pack)
        return {
            "success": True,
            "saved": {
                "pack_id": pack.pack_id,
                "path": path,
                "characters": [item.character_ref for item in pack.characters],
            },
        }

    @staticmethod
    def _sanitize_pack_id(text: str) -> str:
        value = re.sub(r"[^a-zA-Z0-9_-]+", "_", (text or "").strip())
        value = re.sub(r"_+", "_", value).strip("_")
        return value.lower() or "telegram_pack"

    @staticmethod
    def _normalize_request(
        request: Union[TelegramImportRequest, Dict[str, Any]],
    ) -> TelegramImportRequest:
        if isinstance(request, TelegramImportRequest):
            return request
        if not isinstance(request, dict):
            return TelegramImportRequest()

        source = (
            request.get("source") if isinstance(request.get("source"), dict) else {}
        )
        materials = (
            request.get("materials")
            if isinstance(request.get("materials"), dict)
            else {}
        )
        options = (
            request.get("options") if isinstance(request.get("options"), dict) else {}
        )

        normalized = {
            "source": {
                "char_name": str(
                    source.get("char_name") or source.get("charName") or ""
                ),
                "chat_branch": str(
                    source.get("chat_branch") or source.get("chatBranch") or ""
                ),
            },
            "materials": {
                "card_data": materials.get("card_data")
                if isinstance(materials.get("card_data"), dict)
                else None,
                "worldbook_entries": materials.get("worldbook_entries")
                if isinstance(materials.get("worldbook_entries"), list)
                else [],
                "example_messages": materials.get("example_messages")
                if isinstance(materials.get("example_messages"), list)
                else [],
                "context_notes": str(
                    materials.get("context_notes")
                    or materials.get("contextNotes")
                    or ""
                ),
            },
            "options": {
                "pack_id": str(options.get("pack_id") or options.get("packId") or ""),
                "pack_name": str(
                    options.get("pack_name") or options.get("packName") or ""
                ),
                "target_mode": str(
                    options.get("target_mode")
                    or options.get("targetMode")
                    or "free_chat"
                ),
                "generation_goal": str(
                    options.get("generation_goal")
                    or options.get("generationGoal")
                    or ""
                ),
                "include_story": bool(
                    options.get("include_story")
                    if options.get("include_story") is not None
                    else options.get("includeStory", False)
                ),
                "include_director_rules": bool(
                    options.get("include_director_rules")
                    if options.get("include_director_rules") is not None
                    else options.get("includeDirectorRules", True)
                ),
                "output_style": str(
                    options.get("output_style")
                    or options.get("outputStyle")
                    or "standard"
                ),
            },
        }
        return TelegramImportRequest(**normalized)

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "你是 Telegram 多角色资产编译助手。"
            "你的任务是根据 SillyTavern 提供的原始素材，生成一个可供 Telegram 多 bot 导演模式使用的 asset pack。"
            "不要输出解释，不要编写 markdown，只能通过工具 build_telegram_asset_pack 返回结构化结果。"
            "保留素材中的角色特征和世界观，但要压缩成适合运行时使用的短结构。"
            "如果信息不足，可以留空，但不要胡编。"
        )

    def _build_user_prompt(
        self, request: TelegramImportRequest, pack_id: str, pack_name: str
    ) -> str:
        card = (
            request.materials.card_data.model_dump()
            if request.materials.card_data
            else {}
        )
        worldbook = [item.model_dump() for item in request.materials.worldbook_entries]
        examples = [item.model_dump() for item in request.materials.example_messages]

        return (
            f"请基于以下素材生成 Telegram asset pack。\n"
            f"建议 pack_id: {pack_id}\n"
            f"建议 pack_name: {pack_name}\n"
            f"目标模式: {request.options.target_mode}\n"
            f"生成目标: {request.options.generation_goal or '生成可供 Telegram 多 bot 使用的角色/世界/故事资产'}\n"
            f"输出风格: {request.options.output_style}\n"
            f"是否生成 story: {request.options.include_story}\n"
            f"是否生成导演规则: {request.options.include_director_rules}\n"
            f"来源角色: {request.source.char_name}\n"
            f"聊天分支: {request.source.chat_branch}\n\n"
            f"角色卡数据:\n{card}\n\n"
            f"世界书条目:\n{worldbook}\n\n"
            f"聊天样例:\n{examples}\n\n"
            f"补充说明:\n{request.materials.context_notes or ''}\n\n"
            "要求：\n"
            "1. characters 至少生成 1 个角色。\n"
            "2. character_ref 使用稳定英文/拼音/蛇形命名。\n"
            "3. world.summary 尽量精炼。\n"
            "4. 如果 include_story=false，可以返回空 stories。\n"
            "5. 如果 include_story=true，至少生成 1 个 story。\n"
        )

    @staticmethod
    def _build_warnings(pack, request: TelegramImportRequest) -> list[str]:
        warnings: list[str] = []
        if request.options.include_story and not pack.stories:
            warnings.append("请求包含剧本，但结果未生成 stories。")
        if len(pack.characters) == 1:
            warnings.append("当前 pack 仅生成了 1 个角色。")
        return warnings
