"""
角色卡加载器

从 SillyTavern 角色卡 PNG（V2 tEXt chunk）中读取人设数据，
并将初始画像写入 memory_profiles 表。
"""
import os
import json
import struct
import zlib
from typing import Dict, Optional
from config import load_json, SETTINGS_FILE, get_current_dirs


class CharacterLoader:
    """从 SillyTavern 角色卡读取并初始化人物画像"""

    # SillyTavern 默认角色目录（相对于 SillyTavern 安装根目录）
    # 插件位于 data/default-user/extensions/st-direct-tts/
    # 角色卡位于 data/default-user/characters/
    CHAR_DIR_RELATIVE = os.path.join("..", "..", "..", "characters")

    def __init__(self):
        from config import PLUGIN_ROOT
        self.plugin_root = PLUGIN_ROOT
        self.char_dir = os.path.normpath(
            os.path.join(self.plugin_root, self.CHAR_DIR_RELATIVE)
        )
        print(f"[CharacterLoader] 角色卡目录: {self.char_dir}")

    def load_from_card(self, char_name: str) -> Optional[Dict]:
        """
        读取角色卡 PNG 中的 JSON 数据

        查找逻辑:
        1. 在 SillyTavern/data/default-user/characters/ 下找包含 char_name 的 .png
        2. 从 PNG 的 tEXt chunk 中提取 chara 字段 (base64 JSON)

        Returns:
            解析后的角色卡字典，或 None
        """
        if not os.path.exists(self.char_dir):
            print(f"[CharacterLoader] 角色卡目录不存在: {self.char_dir}")
            return None

        # 搜索匹配的 PNG 文件
        matched_file = None
        for f in os.listdir(self.char_dir):
            if f.endswith(".png") and char_name in f:
                matched_file = os.path.join(self.char_dir, f)
                break

        if not matched_file:
            print(f"[CharacterLoader] 未找到角色卡: {char_name}")
            return None

        print(f"[CharacterLoader] 找到角色卡文件: {matched_file}")
        return self._extract_from_png(matched_file)

    def _extract_from_png(self, png_path: str) -> Optional[Dict]:
        """从 PNG 文件的 tEXt chunk 中提取角色数据"""
        try:
            with open(png_path, "rb") as f:
                # 跳过 PNG 签名 (8 bytes)
                signature = f.read(8)
                if signature != b'\x89PNG\r\n\x1a\n':
                    print(f"[CharacterLoader] 不是有效的 PNG 文件")
                    return None

                while True:
                    # 读取 chunk: length(4) + type(4) + data(length) + crc(4)
                    length_bytes = f.read(4)
                    if len(length_bytes) < 4:
                        break

                    length = struct.unpack(">I", length_bytes)[0]
                    chunk_type = f.read(4)
                    chunk_data = f.read(length)
                    _crc = f.read(4)  # CRC

                    if chunk_type == b'tEXt':
                        # tEXt chunk: keyword\0text
                        null_pos = chunk_data.find(b'\x00')
                        if null_pos >= 0:
                            keyword = chunk_data[:null_pos].decode('latin-1')
                            text = chunk_data[null_pos + 1:].decode('latin-1')

                            if keyword == 'chara':
                                import base64
                                json_str = base64.b64decode(text).decode('utf-8')
                                return json.loads(json_str)

                    elif chunk_type == b'IEND':
                        break

        except Exception as e:
            print(f"[CharacterLoader] 读取 PNG 失败: {e}")
            import traceback
            traceback.print_exc()

        return None

    def init_profiles(self, char_name: str) -> bool:
        """
        从角色卡读取人设 → 写入 memory_profiles 表。
        仅在表中没有该角色数据时执行（不覆盖运行时积累）。

        Returns:
            是否成功初始化
        """
        from database import DatabaseManager
        db = DatabaseManager()

        # 检查是否已初始化
        existing = db.get_memory_profiles(char_name)
        if existing:
            print(f"[CharacterLoader] {char_name} 画像已存在 ({len(existing)} 条)，跳过初始化")
            return True

        # 读角色卡
        card_data = self.load_from_card(char_name)

        # 也尝试从 telegram 配置中读取兜底值
        settings = load_json(SETTINGS_FILE)
        tg_config = settings.get("telegram", {})

        profiles = {}

        if card_data:
            # 从角色卡提取
            description = card_data.get("description", "")
            personality = card_data.get("personality", "")
            scenario = card_data.get("scenario", "")
            first_mes = card_data.get("first_mes", "")
            mes_example = card_data.get("mes_example", "")

            if description:
                profiles["description"] = description
            if personality:
                profiles["personality"] = personality
            if scenario:
                profiles["world_setting"] = scenario
            if first_mes:
                profiles["first_message"] = first_mes
            if mes_example:
                # 对话示例可能很长，截取前500字
                profiles["dialogue_examples"] = mes_example[:500]

            print(f"[CharacterLoader] 从角色卡提取了 {len(profiles)} 个画像字段")
        else:
            print(f"[CharacterLoader] 未找到角色卡，使用配置文件兜底")

        # 世界观兜底: 配置文件 > 角色卡 scenario > 默认值
        if "world_setting" not in profiles:
            profiles["world_setting"] = tg_config.get("world_setting", "现代")

        # system_prompt 兜底写入
        system_prompt = tg_config.get("llm", {}).get("system_prompt", "")
        if system_prompt and "system_prompt" not in profiles:
            profiles["system_prompt"] = system_prompt

        if not profiles:
            print(f"[CharacterLoader] 无可用画像数据")
            return False

        # 写入数据库
        for key, val in profiles.items():
            if val and val.strip():
                db.upsert_memory_profile(char_name, key, val.strip(), source="card")

        print(f"[CharacterLoader] ✅ {char_name} 画像初始化完成，写入 {len(profiles)} 条")
        return True
