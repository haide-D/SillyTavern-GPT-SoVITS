from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CharacterAsset:
    character_ref: str
    name: str
    description: str = ""
    personality: str = ""
    system_prompt_fragment: str = ""
    first_message: str = ""
    dialogue_examples: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class WorldAsset:
    title: str = ""
    summary: str = ""
    rules: List[str] = field(default_factory=list)
    lore: List[str] = field(default_factory=list)


@dataclass
class StoryAsset:
    story_id: str
    mode: str = "scripted_story"
    title: str = ""
    opening: str = ""
    story_rules: List[str] = field(default_factory=list)
    initial_state: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AssetPack:
    pack_id: str
    name: str
    source: str = "local"
    source_ref: str = ""
    version: str = "1"
    director_prompt: str = ""
    world: WorldAsset = field(default_factory=WorldAsset)
    characters: List[CharacterAsset] = field(default_factory=list)
    stories: List[StoryAsset] = field(default_factory=list)

    def get_character(self, character_ref: str) -> Optional[CharacterAsset]:
        for character in self.characters:
            if character.character_ref == character_ref:
                return character
        return None

    def get_story(self, story_id: Optional[str]) -> Optional[StoryAsset]:
        if not story_id:
            return None
        for story in self.stories:
            if story.story_id == story_id:
                return story
        return None


@dataclass
class ResolvedTelegramCharacter:
    bot_id: str
    bot_token: str
    character_ref: str
    character_id: str
    character_name: str
    tts_character: str
    voice_enabled: bool
    allowed_chat_ids: List[str]
    enabled: bool
    description: str = ""
    personality: str = ""
    system_prompt_fragment: str = ""
    first_message: str = ""
    dialogue_examples: List[str] = field(default_factory=list)
