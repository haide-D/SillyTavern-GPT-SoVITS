from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ImportWorldbookEntry(BaseModel):
    uid: str = ""
    comment: str = ""
    content: str = ""
    constant: bool = False
    source: str = ""


class ImportExampleMessage(BaseModel):
    name: str = ""
    is_user: bool = False
    mes: str = ""


class ImportCardData(BaseModel):
    name: str = ""
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""


class TelegramImportSource(BaseModel):
    char_name: str = ""
    chat_branch: str = ""


class TelegramImportMaterials(BaseModel):
    card_data: Optional[ImportCardData] = None
    worldbook_entries: List[ImportWorldbookEntry] = Field(default_factory=list)
    example_messages: List[ImportExampleMessage] = Field(default_factory=list)
    context_notes: str = ""


class TelegramImportOptions(BaseModel):
    pack_id: str = ""
    pack_name: str = ""
    target_mode: str = "free_chat"
    generation_goal: str = ""
    include_story: bool = False
    include_director_rules: bool = True
    output_style: str = "standard"


class TelegramImportRequest(BaseModel):
    source: TelegramImportSource = Field(default_factory=TelegramImportSource)
    materials: TelegramImportMaterials = Field(default_factory=TelegramImportMaterials)
    options: TelegramImportOptions = Field(default_factory=TelegramImportOptions)


class TelegramCommitRequest(BaseModel):
    pack: Dict[str, Any]
