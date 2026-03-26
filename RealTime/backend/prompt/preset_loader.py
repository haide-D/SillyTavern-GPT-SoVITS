# 预设加载与组装引擎
#
# 核心职责:
# - PresetLoader: 从 YAML 文件加载预设
# - PromptAssembler: 变量替换 + 条件判断 + 按位置组装
#
# 设计理念:
# - 借鉴酒馆预设的「有序区块 + 变量注入 + 条件控制」
# - 每次调用时从文件读取，修改预设后无需重启

import re
import json
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime

import yaml


# 预设目录（与本文件同级的 presets/ 文件夹）
_PRESETS_DIR = Path(__file__).parent / "presets"

# 激活预设状态文件
_ACTIVE_FILE = _PRESETS_DIR / "_active.json"

# 变量匹配：{{variable_name}}
_VAR_PATTERN = re.compile(r"\{\{(\w+)\}\}")


@dataclass
class PromptBlock:
    """一个提示词区块"""
    id: str                                  # 区块 ID
    role: str = "system"                     # 消息角色
    content: str = ""                        # 模板内容
    condition: str = ""                      # 条件表达式（为空=无条件注入）
    position: str = "system"                 # 注入位置: system | after_history


@dataclass
class AssembledPrompt:
    """组装后的提示词结果"""
    system_parts: List[str] = field(default_factory=list)     # system 位置的区块
    after_history_parts: List[str] = field(default_factory=list)  # after_history 位置的区块
    injected_blocks: List[str] = field(default_factory=list)  # 实际注入的区块 ID 列表

    @property
    def system_prompt(self) -> str:
        """拼接后的完整 system prompt"""
        return "\n\n".join(part for part in self.system_parts if part.strip())

    @property
    def after_history_prompt(self) -> Optional[str]:
        """拼接后的 after_history 内容"""
        if not self.after_history_parts:
            return None
        return "\n\n".join(part for part in self.after_history_parts if part.strip())


class PresetLoader:
    """
    预设加载器

    从 YAML 文件加载预设，解析为 PromptBlock 列表
    """

    @staticmethod
    def load(preset_name: str) -> Dict:
        """
        加载预设文件

        Args:
            preset_name: 预设名称（不含扩展名），如 "roleplay"

        Returns:
            预设字典（包含 name, description, blocks）

        Raises:
            FileNotFoundError: 预设文件不存在
        """
        preset_path = _PRESETS_DIR / f"{preset_name}.yaml"

        if not preset_path.exists():
            raise FileNotFoundError(f"预设文件不存在: {preset_path}")

        raw = preset_path.read_text(encoding="utf-8")
        data = yaml.safe_load(raw)

        # 解析 blocks 为 PromptBlock 对象
        blocks = []
        for block_data in data.get("blocks", []):
            blocks.append(PromptBlock(
                id=block_data.get("id", "unnamed"),
                role=block_data.get("role", "system"),
                content=block_data.get("content", ""),
                condition=block_data.get("condition", ""),
                position=block_data.get("position", "system"),
            ))

        return {
            "name": data.get("name", preset_name),
            "description": data.get("description", ""),
            "blocks": blocks,
        }

    @staticmethod
    def list_presets() -> List[Dict]:
        """
        列出所有可用预设

        Returns:
            [{"name": str, "file": str, "description": str}, ...]
        """
        if not _PRESETS_DIR.exists():
            return []

        presets = []
        for f in sorted(_PRESETS_DIR.glob("*.yaml")):
            try:
                raw = f.read_text(encoding="utf-8")
                data = yaml.safe_load(raw)
                presets.append({
                    "name": data.get("name", f.stem),
                    "file": f.stem,
                    "description": data.get("description", ""),
                })
            except Exception:
                # 跳过解析失败的文件
                pass

        return presets

    @staticmethod
    def get_active() -> str:
        """
        获取当前激活的预设名称

        Returns:
            预设名称（不含扩展名），默认 "roleplay"
        """
        if _ACTIVE_FILE.exists():
            try:
                data = json.loads(_ACTIVE_FILE.read_text(encoding="utf-8"))
                name = data.get("active", "roleplay")
                # 验证对应文件存在
                if (_PRESETS_DIR / f"{name}.yaml").exists():
                    return name
            except Exception:
                pass
        return "roleplay"

    @staticmethod
    def set_active(preset_name: str) -> bool:
        """
        设置当前激活的预设

        Args:
            preset_name: 预设名称（不含扩展名）

        Returns:
            是否成功
        """
        preset_path = _PRESETS_DIR / f"{preset_name}.yaml"
        if not preset_path.exists():
            return False

        _PRESETS_DIR.mkdir(parents=True, exist_ok=True)
        _ACTIVE_FILE.write_text(
            json.dumps({"active": preset_name}, ensure_ascii=False),
            encoding="utf-8"
        )
        return True


class PromptAssembler:
    """
    提示词组装器

    将预设区块 + 运行时变量 → 最终可用的 AssembledPrompt
    """

    def __init__(self, blocks: List[PromptBlock]):
        self.blocks = blocks

    def assemble(self, variables: Dict[str, str]) -> AssembledPrompt:
        """
        组装提示词

        Args:
            variables: 运行时变量，如 {"char": "小明", "persona": "...", ...}

        Returns:
            AssembledPrompt 实例
        """
        result = AssembledPrompt()

        for block in self.blocks:
            # 1. 条件判断
            if block.condition and not self._check_condition(block.condition, variables):
                continue

            # 2. 变量替换
            rendered = self._resolve_variables(block.content, variables)

            # 跳过渲染后为空的区块
            if not rendered.strip():
                continue

            # 3. 按位置分组
            if block.position == "after_history":
                result.after_history_parts.append(rendered)
            else:
                result.system_parts.append(rendered)

            result.injected_blocks.append(block.id)

        return result

    def _resolve_variables(self, text: str, variables: Dict[str, str]) -> str:
        """
        替换 {{var}} 变量

        未知变量替换为空字符串
        """
        def replacer(match):
            var_name = match.group(1)
            return str(variables.get(var_name, ""))

        return _VAR_PATTERN.sub(replacer, text)

    def _check_condition(self, condition: str, variables: Dict[str, str]) -> bool:
        """
        检查条件是否满足

        条件格式: "{{var_name}}" — 当该变量的值非空时条件为真
        """
        resolved = self._resolve_variables(condition, variables)
        return bool(resolved.strip())


def build_variables_from_context(ctx) -> Dict[str, str]:
    """
    从 PromptContext 构建变量字典

    这是 PromptContext → 变量字典 的适配器函数

    Args:
        ctx: PromptContext 实例

    Returns:
        变量字典
    """
    now = datetime.now()

    variables = {
        "char": ctx.character_name or "助手",
        "user": getattr(ctx, "user_name", "用户"),
        "persona": ctx.character_persona or "",
        "scenario": ctx.scenario or "",
        "first_message": ctx.first_message or "",
        "examples": getattr(ctx, "examples", ""),
        "author_note": getattr(ctx, "author_note", ""),
        "time": now.strftime("%Y-%m-%d %H:%M"),
        "turns": str(len(ctx.conversation_history)),
        "idle_duration": str(int(ctx.extra_data.get("idle_duration", 0))),
    }

    return variables
