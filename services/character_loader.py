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

    # ==================== 世界书提炼 ====================

    async def init_worldbook_profiles(self, char_name: str, card_data: dict, worldbook_entries: list) -> bool:
        """
        从前端拿到的角色卡数据和世界书条目中，使用 LLM 提炼结构化人设并保存
        """
        from database import DatabaseManager
        import httpx
        import json
        import re

        # 获取 LLM 配置
        settings = load_json(SETTINGS_FILE)
        tg_config = settings.get("telegram", {})
        llm_config = tg_config.get("llm", {})

        api_url = llm_config.get("api_url", "")
        api_key = llm_config.get("api_key", "")
        model = llm_config.get("model", "")

        if not api_url or not api_key:
            print("[CharacterLoader] LLM 未配置，无法提炼世界书")
            return False

        api_url = api_url.strip()
        if '/chat/completions' not in api_url:
            api_url = api_url.rstrip('/') + '/chat/completions'

        # 1. 拼接文本
        text_parts = []
        
        # 1.1 角色卡数据
        if card_data:
            text_parts.append("### 基础设定")
            if "description" in card_data and card_data["description"]:
                text_parts.append(f"描述:\n{card_data['description']}")
            if "personality" in card_data and card_data["personality"]:
                text_parts.append(f"性格:\n{card_data['personality']}")
            if "scenario" in card_data and card_data["scenario"]:
                text_parts.append(f"场景/世界观:\n{card_data['scenario']}")
        
        # 1.2 世界书数据
        if worldbook_entries:
            text_parts.append("### 补充设定 (世界书)")
            for i, entry in enumerate(worldbook_entries):
                comment = entry.get("comment", f"条目{i+1}")
                content = entry.get("content", "")
                if content.strip():
                    text_parts.append(f"[{comment}]\n{content}")
                    
        source_text = "\n\n".join(text_parts)
        
        if len(source_text) < 20:
            print(f"[CharacterLoader] {char_name} 的提炼源文本太短，无法提取")
            return False
            
        print(f"[CharacterLoader] 准备提炼 {char_name} 画像，提供文本长度 {len(source_text)} 字")

        # 2. 构建 Prompt
        prompt = f"""你是一个专业的小说角色和世界观人设提炼助手。
请仔细阅读以下关于角色「{char_name}」的原始设定资料（包含角色基础设定和世界书扩展设定），从中提取并总结出结构化的人物画像和世界观。

## 原始设定资料：
{source_text}

## 输出要求：
请输出严格的 JSON 格式（不要包含 markdown 代码块标识），包含以下字段：
{{
  "人物画像": {{
    "外貌特征": "角色的外表、穿着等客观描述（如没有则填空字符串）",
    "性格特点": "角色的内在性格、脾气（如果资料中有，尽量详细）",
    "语言风格": "角色说话的口吻、惯用语（如没有则填空字符串）",
    "身份背景": "角色的身世、职业、过往经历等",
    "核心关系": "与其他人物或派系的关键关系"
  }},
  "世界观": "角色所处的时代背景、特殊规则、势力分布等（综合提取，如没有则填空字符串）"
}}

注意：
- JSON 必须可被工具解析，不要有语法错误。
- 提取的内容应尽量客观准确，没有在资料中提及的内容宁可留空，也不要自行编造。
"""

        # 3. 调用 LLM
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是一个人设提炼助手，只输出符合格式的 JSON。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3, # 降低随机性
                    "max_tokens": 1500,
                    "stream": False
                }

                resp = await client.post(api_url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                
            content = ""
            if data.get("choices") and len(data["choices"]) > 0:
                content = data["choices"][0].get("message", {}).get("content", "")
                
            if not content:
                print("[CharacterLoader] LLM 返回内容为空")
                return False
                
            # 4. 解析 JSON
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r'^```(?:json)?\s*', '', content)
                content = re.sub(r'\s*```$', '', content)
                
            try:
                result = json.loads(content)
            except json.JSONDecodeError:
                # 尝试用正则找
                match = re.search(r'\{[\s\S]*\}', content)
                if match:
                    try:
                        result = json.loads(match.group(0))
                    except json.JSONDecodeError:
                        print(f"[CharacterLoader] JSON 格式解析严重错误: {content[:200]}")
                        return False
                else:
                    print(f"[CharacterLoader] 未找到 JSON 结构: {content[:200]}")
                    return False
                    
            print(f"[CharacterLoader] 成功提炼结构化画像")
            
            # 5. 写入数据库
            db = DatabaseManager()
            
            # 5.1 人物画像部分
            profile_dict = result.get("人物画像", {})
            key_mapping = {
                "外貌特征": "worldbook_appearance",
                "性格特点": "worldbook_personality",
                "语言风格": "worldbook_speech_style",
                "身份背景": "worldbook_background",
                "核心关系": "worldbook_relationships"
            }
            
            save_count = 0
            for zh_key, db_key in key_mapping.items():
                val = profile_dict.get(zh_key, "")
                if val and isinstance(val, str) and val.strip():
                    db.upsert_memory_profile(char_name, db_key, val.strip(), source="worldbook")
                    save_count += 1
                    
            # 5.2 世界观部分
            world_setting = result.get("世界观", "")
            if world_setting and isinstance(world_setting, str) and world_setting.strip():
                db.upsert_memory_profile(char_name, "worldbook_world_setting", world_setting.strip(), source="worldbook")
                save_count += 1
                
            print(f"[CharacterLoader] ✅ 写入 {save_count} 条条目到 memory_profiles")
            return save_count > 0
            
        except Exception as e:
            print(f"[CharacterLoader] 世界书提炼过程出错: {e}")
            import traceback
            traceback.print_exc()
            return False
