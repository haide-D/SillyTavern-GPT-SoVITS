import os
from dataclasses import asdict
from typing import Any, Dict, List, Optional

from config import TELEGRAM_PACKS_DIR, load_json
from telegram_app.assets.models import AssetPack, CharacterAsset, StoryAsset, WorldAsset


class TelegramAssetRepository:
    def __init__(self, base_dir: str = TELEGRAM_PACKS_DIR):
        self._base_dir = base_dir

    @property
    def base_dir(self) -> str:
        return self._base_dir

    def list_packs(self) -> List[Dict[str, str]]:
        if not os.path.exists(self._base_dir):
            return []

        packs: List[Dict[str, str]] = []
        for name in sorted(os.listdir(self._base_dir)):
            if not name.endswith(".json"):
                continue
            path = os.path.join(self._base_dir, name)
            data = load_json(path)
            if not data:
                continue
            pack_id = str(data.get("pack_id") or os.path.splitext(name)[0]).strip()
            packs.append(
                {
                    "pack_id": pack_id,
                    "name": str(data.get("name") or pack_id),
                    "source": str(data.get("source") or "local"),
                    "path": path,
                }
            )
        return packs

    def get_pack(self, pack_id: Optional[str]) -> Optional[AssetPack]:
        if not pack_id:
            return None
        filename = f"{pack_id}.json"
        file_path = os.path.join(self._base_dir, filename)
        if not os.path.exists(file_path):
            for meta in self.list_packs():
                if meta["pack_id"] == pack_id:
                    file_path = meta["path"]
                    break
            else:
                return None

        data = load_json(file_path)
        if not data:
            return None
        return self._normalize_pack(data, default_pack_id=pack_id)

    def save_pack(self, pack: AssetPack) -> str:
        os.makedirs(self._base_dir, exist_ok=True)
        file_path = os.path.join(self._base_dir, f"{pack.pack_id}.json")
        payload = asdict(pack)
        with open(file_path, "w", encoding="utf-8") as f:
            import json

            json.dump(payload, f, ensure_ascii=False, indent=2)
        return file_path

    def _normalize_pack(self, raw: Dict[str, Any], default_pack_id: str) -> AssetPack:
        world_raw = raw.get("world") if isinstance(raw.get("world"), dict) else {}
        characters_raw = (
            raw.get("characters") if isinstance(raw.get("characters"), list) else []
        )
        stories_raw = raw.get("stories") if isinstance(raw.get("stories"), list) else []

        world = WorldAsset(
            title=str(world_raw.get("title") or "").strip(),
            summary=str(world_raw.get("summary") or "").strip(),
            rules=[
                str(item).strip()
                for item in world_raw.get("rules", [])
                if str(item).strip()
            ],
            lore=[
                str(item).strip()
                for item in world_raw.get("lore", [])
                if str(item).strip()
            ],
        )

        characters: List[CharacterAsset] = []
        for idx, item in enumerate(characters_raw, start=1):
            if not isinstance(item, dict):
                continue
            character_ref = str(
                item.get("character_ref") or item.get("name") or f"character_{idx}"
            ).strip()
            name = str(item.get("name") or character_ref).strip()
            characters.append(
                CharacterAsset(
                    character_ref=character_ref,
                    name=name,
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
                    tags=[
                        str(v).strip() for v in item.get("tags", []) if str(v).strip()
                    ],
                    metadata=item.get("metadata", {})
                    if isinstance(item.get("metadata", {}), dict)
                    else {},
                )
            )

        stories: List[StoryAsset] = []
        for idx, item in enumerate(stories_raw, start=1):
            if not isinstance(item, dict):
                continue
            story_id = str(
                item.get("story_id") or item.get("id") or f"story_{idx}"
            ).strip()
            stories.append(
                StoryAsset(
                    story_id=story_id,
                    mode=str(item.get("mode") or "scripted_story").strip()
                    or "scripted_story",
                    title=str(item.get("title") or story_id).strip(),
                    opening=str(item.get("opening") or "").strip(),
                    story_rules=[
                        str(v).strip()
                        for v in item.get("story_rules", [])
                        if str(v).strip()
                    ],
                    initial_state=item.get("initial_state", {})
                    if isinstance(item.get("initial_state", {}), dict)
                    else {},
                )
            )

        return AssetPack(
            pack_id=str(raw.get("pack_id") or default_pack_id).strip()
            or default_pack_id,
            name=str(raw.get("name") or default_pack_id).strip() or default_pack_id,
            source=str(raw.get("source") or "local").strip() or "local",
            source_ref=str(raw.get("source_ref") or "").strip(),
            version=str(raw.get("version") or "1").strip() or "1",
            director_prompt=str(raw.get("director_prompt") or "").strip(),
            world=world,
            characters=characters,
            stories=stories,
        )
