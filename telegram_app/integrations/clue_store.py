"""
极简线索存储 — 按 namespace_key 区分不同故事/会话

每个 namespace_key 对应一个独立的 .txt 文件。
线索以自然语言追加写入，构建 Prompt 时整体读入注入给 LLM。
"""

import os
from datetime import datetime

from config import PLUGIN_ROOT

CLUE_DIR = os.path.join(PLUGIN_ROOT, "assets", "clues")


def _clue_path(namespace_key: str) -> str:
    safe_name = namespace_key.replace(":", "_").replace("/", "_")
    return os.path.join(CLUE_DIR, f"{safe_name}.txt")


def append_clue(
    namespace_key: str,
    clue_text: str,
    visibility: str = "public",
    related_character: str = "",
):
    """追加一条线索到对应会话的 .txt 文件"""
    os.makedirs(CLUE_DIR, exist_ok=True)
    path = _clue_path(namespace_key)
    timestamp = datetime.now().strftime("%H:%M")
    tag = f"[{visibility}]"
    char_tag = f"[{related_character}]" if related_character else ""
    line = f"{timestamp} {tag}{char_tag} {clue_text}"
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(f"[ClueStore] 线索已保存: {line}")


def read_all_clues(namespace_key: str) -> str:
    """读取全部线索文本，直接塞进 Prompt"""
    path = _clue_path(namespace_key)
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def clear_clues(namespace_key: str):
    """清空线索（对应 /clear 命令）"""
    path = _clue_path(namespace_key)
    if os.path.exists(path):
        os.remove(path)
        print(f"[ClueStore] 已清空线索: {namespace_key}")
