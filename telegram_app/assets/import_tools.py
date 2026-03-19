import json
from dataclasses import asdict
from typing import Any, Dict, Optional

from telegram_app.assets.models import AssetPack, CharacterAsset, StoryAsset, WorldAsset


def get_import_tools() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "build_telegram_asset_pack",
                "description": "根据输入素材生成一个 Telegram 可运行的结构化 asset pack。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pack_id": {"type": "string"},
                        "name": {"type": "string"},
                        "source": {"type": "string"},
                        "source_ref": {"type": "string"},
                        "version": {"type": "string"},
                        "director_prompt": {"type": "string"},
                        "world": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "summary": {"type": "string"},
                                "rules": {"type": "array", "items": {"type": "string"}},
                                "lore": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                        "characters": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "character_ref": {"type": "string"},
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "personality": {"type": "string"},
                                    "system_prompt_fragment": {"type": "string"},
                                    "first_message": {"type": "string"},
                                    "dialogue_examples": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "tags": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "metadata": {"type": "object"},
                                },
                                "required": ["character_ref", "name"],
                            },
                        },
                        "stories": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "story_id": {"type": "string"},
                                    "mode": {"type": "string"},
                                    "title": {"type": "string"},
                                    "opening": {"type": "string"},
                                    "story_rules": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "initial_state": {"type": "object"},
                                },
                                "required": ["story_id", "mode"],
                            },
                        },
                    },
                    "required": ["pack_id", "name", "characters"],
                },
            },
        }
    ]


def parse_import_tool_response(data: dict) -> Optional[dict]:
    if not data.get("choices"):
        return None
    message = data["choices"][0].get("message", {})
    for tc in message.get("tool_calls", []):
        if tc.get("function", {}).get("name") != "build_telegram_asset_pack":
            continue
        raw = tc.get("function", {}).get("arguments", "{}")
        try:
            return json.loads(raw)
        except Exception:
            return None
    content = message.get("content", "")
    if content:
        try:
            return json.loads(content)
        except Exception:
            return None
    return None


def asset_pack_from_dict(payload: Dict[str, Any]) -> AssetPack:
    world_payload = (
        payload.get("world") if isinstance(payload.get("world"), dict) else {}
    )
    characters_payload = (
        payload.get("characters") if isinstance(payload.get("characters"), list) else []
    )
    stories_payload = (
        payload.get("stories") if isinstance(payload.get("stories"), list) else []
    )

    return AssetPack(
        pack_id=str(payload.get("pack_id") or "").strip(),
        name=str(payload.get("name") or "").strip(),
        source=str(payload.get("source") or "sillytavern_import").strip()
        or "sillytavern_import",
        source_ref=str(payload.get("source_ref") or "").strip(),
        version=str(payload.get("version") or "1").strip() or "1",
        director_prompt=str(payload.get("director_prompt") or "").strip(),
        world=WorldAsset(
            title=str(world_payload.get("title") or "").strip(),
            summary=str(world_payload.get("summary") or "").strip(),
            rules=[
                str(v).strip() for v in world_payload.get("rules", []) if str(v).strip()
            ],
            lore=[
                str(v).strip() for v in world_payload.get("lore", []) if str(v).strip()
            ],
        ),
        characters=[
            CharacterAsset(
                character_ref=str(item.get("character_ref") or "").strip(),
                name=str(item.get("name") or "").strip(),
                description=str(item.get("description") or "").strip(),
                personality=str(item.get("personality") or "").strip(),
                system_prompt_fragment=str(
                    item.get("system_prompt_fragment") or ""
                ).strip(),
                first_message=str(item.get("first_message") or "").strip(),
                dialogue_examples=[
                    str(v).strip()
                    for v in item.get("dialogue_examples", [])
                    if str(v).strip()
                ],
                tags=[str(v).strip() for v in item.get("tags", []) if str(v).strip()],
                metadata=item.get("metadata", {})
                if isinstance(item.get("metadata"), dict)
                else {},
            )
            for item in characters_payload
            if isinstance(item, dict)
            and str(item.get("character_ref") or "").strip()
            and str(item.get("name") or "").strip()
        ],
        stories=[
            StoryAsset(
                story_id=str(item.get("story_id") or "").strip(),
                mode=str(item.get("mode") or "free_chat").strip() or "free_chat",
                title=str(item.get("title") or "").strip(),
                opening=str(item.get("opening") or "").strip(),
                story_rules=[
                    str(v).strip()
                    for v in item.get("story_rules", [])
                    if str(v).strip()
                ],
                initial_state=item.get("initial_state", {})
                if isinstance(item.get("initial_state"), dict)
                else {},
            )
            for item in stories_payload
            if isinstance(item, dict) and str(item.get("story_id") or "").strip()
        ],
    )


def asset_pack_to_dict(pack: AssetPack) -> Dict[str, Any]:
    return asdict(pack)
