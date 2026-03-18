"""
统一记忆管理服务

提供跨渠道（酒馆/TG）的记忆读写能力。
每次分析产出一条 memory_snapshot，包含：
- plot_summary: 剧情总结
- character_profiles: 每个说话人的性格/状态 (JSON)
- key_events: 关键事件列表 (JSON)
"""
import json
import time
import httpx
from typing import Dict, List, Optional
from database import DatabaseManager
from config import load_json, SETTINGS_FILE


class MemoryService:
    """统一记忆管理服务 — 单例"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.db = DatabaseManager()
        self._initialized = True
        print("[MemoryService] ✅ 初始化完成")

    # ==================== 读取接口 ====================

    def get_context_for_prompt(
        self,
        char_name: str,
        fingerprints: List[str] = None,
        tg_chat_id: str = None,
        max_snapshots: int = 5
    ) -> str:
        """
        为 LLM Prompt 组装记忆上下文字符串。

        Args:
            char_name: 目标角色名（用于查 profiles）
            fingerprints: 酒馆指纹列表（酒馆侧查询用）
            tg_chat_id: TG chat_id（TG 侧查询用）
            max_snapshots: 最大快照条数

        Returns:
            格式化的记忆上下文文本
        """
        sections = []

        # 1. 角色卡静态画像 (memory_profiles)
        profiles = self.db.get_memory_profiles(char_name)
        if profiles:
            profile_lines = []
            if "world_setting" in profiles:
                profile_lines.append(f"世界观设定: {profiles['world_setting']}")
            if "description" in profiles:
                profile_lines.append(f"角色描述: {profiles['description']}")
            if "personality" in profiles:
                profile_lines.append(f"性格: {profiles['personality']}")

            skip_keys = {"world_setting", "description", "personality",
                         "first_message", "dialogue_examples", "system_prompt"}
            for key, val in profiles.items():
                if key not in skip_keys:
                    display = self._profile_key_display(key)
                    profile_lines.append(f"{display}: {val}")

            if profile_lines:
                sections.append("## 角色画像\n" + "\n".join(profile_lines))

        # 2. 记忆快照 (memory_snapshots)
        snapshots = []
        if fingerprints:
            # 酒馆侧：按指纹查（也会匹配 parent_fingerprint，即 TG 记忆）
            snapshots = self.db.get_memory_snapshots_by_fingerprints(
                fingerprints, limit=max_snapshots
            )
        elif tg_chat_id:
            # TG 侧：按最新时间取，严格隔离 chat_id
            snapshots = self.db.get_memory_snapshots_latest(
                source="telegram", 
                source_id=str(tg_chat_id),
                limit=max_snapshots
            )

        if snapshots:
            # 剧情摘要
            summary_lines = []
            for i, snap in enumerate(snapshots, 1):
                summary_lines.append(f"{i}. {snap.get('plot_summary', '')}")
            sections.append("## 近期剧情\n" + "\n".join(summary_lines))

            # 从最新快照中提取角色状态
            latest = snapshots[0]
            char_profiles = latest.get("character_profiles", {})
            if char_profiles:
                char_lines = []
                for name, info in char_profiles.items():
                    if isinstance(info, dict):
                        desc_parts = [f"{k}: {v}" for k, v in info.items()]
                        char_lines.append(f"- {name}: {', '.join(desc_parts)}")
                    else:
                        char_lines.append(f"- {name}: {info}")
                if char_lines:
                    sections.append("## 角色当前状态\n" + "\n".join(char_lines))

            # 汇总所有快照的关键事件
            all_events = []
            for snap in snapshots:
                for evt in snap.get("key_events", []):
                    desc = evt.get("description", "")
                    tag = evt.get("event_type", evt.get("type", "event"))
                    if desc and desc not in [e.get("description") for e in all_events]:
                        all_events.append({"tag": tag, "description": desc})
            if all_events:
                event_lines = [f"- [{e['tag']}] {e['description']}" for e in all_events[:10]]
                sections.append("## 关键记忆\n" + "\n".join(event_lines))

        if not sections:
            return ""

        return "\n\n".join(sections)

    # ==================== 写入接口 ====================

    async def process_conversation(
        self,
        source: str,
        source_id: str,
        context_fingerprint: str,
        messages: List[Dict],
        speakers: List[str] = None,
        parent_fingerprint: str = None,
        floor: int = None
    ) -> Dict:
        """
        核心方法：对一段对话执行 LLM 分析，产出一条记忆快照。

        Args:
            source: 'tavern' | 'telegram'
            source_id: chat_branch / tg_chat_id
            context_fingerprint: 唯一标识此次记忆的指纹
            messages: 最近 N 条消息 [{role, content}]
            speakers: 说话人列表
            parent_fingerprint: TG 写入时基于的酒馆指纹
            floor: 楼层 (酒馆用)

        Returns:
            {"success": bool, ...}
        """
        if not messages:
            return {"success": False, "error": "无消息"}

        # 获取 LLM 配置
        settings = load_json(SETTINGS_FILE)
        tg_config = settings.get("telegram", {})
        llm_config = tg_config.get("llm", {})

        api_url = llm_config.get("api_url", "")
        api_key = llm_config.get("api_key", "")
        model = llm_config.get("model", "")

        if not api_url or not api_key:
            print("[MemoryService] LLM 未配置，跳过记忆处理")
            return {"success": False, "error": "LLM 未配置"}

        api_url = api_url.strip()
        if '/chat/completions' not in api_url:
            api_url = api_url.rstrip('/') + '/chat/completions'

        # 格式化对话
        conversation_text = self._format_messages(messages)
        speakers_text = "、".join(speakers) if speakers else "未知"

        # 合并 Prompt — 一次 LLM 调用出三个结果
        prompt = f"""你是一个记忆管理助手。请分析以下对话并输出 JSON。

## 对话内容
{conversation_text}

## 说话人列表
{speakers_text}

## 请输出以下内容（严格 JSON，不要包含 markdown 代码块）：
{{
  "plot_summary": "2~3 句话总结对话的剧情发展。只说事实和进展，不描述情绪。",
  "character_profiles": {{
    "角色名1": {{
      "性格": "该角色在对话中表现出的性格特点",
      "态度": "对其他角色的态度",
      "状态": "当前状态或心境"
    }},
    "角色名2": {{...}}
  }},
  "key_events": [
    {{"event_type": "promise|conflict|revelation|milestone|preference|memory",
     "description": "事件描述",
     "characters": ["涉及的角色"]}}
  ]
}}

规则：
- plot_summary 必须有
- character_profiles 为每个说话人都写一条
- key_events 数组 0~3 个，没有就空数组 []
- 别附加任何其他文字，必须确保包含最外阶完整的闭合大括号 }} 以保证这是一个合法合规的严格 JSON。"""

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "你是一个记忆提取助手，只输出 JSON。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": llm_config.get("max_tokens", 5000),
                    "stream": False
                }

                resp = await client.post(api_url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            content = ""
            if data.get("choices") and len(data["choices"]) > 0:
                content = data["choices"][0].get("message", {}).get("content", "")

            if not content:
                return {"success": False, "error": "LLM 返回为空"}

            result = self._parse_memory_json(content)
            if not result:
                return {"success": False, "error": "JSON 解析失败"}

            # 写入数据库
            snapshot_id = self.db.add_memory_snapshot(
                context_fingerprint=context_fingerprint,
                parent_fingerprint=parent_fingerprint,
                source=source,
                source_id=source_id,
                floor=floor,
                plot_summary=result.get("plot_summary", ""),
                character_profiles=result.get("character_profiles", {}),
                key_events=result.get("key_events", []),
                speakers=speakers
            )

            if snapshot_id:
                print(f"[MemoryService] ✅ 快照已保存 (id={snapshot_id}, fp={context_fingerprint[:20]}...)")
            else:
                print(f"[MemoryService] ⚠️ 指纹已存在，跳过: {context_fingerprint[:20]}...")

            return {"success": True, "snapshot_id": snapshot_id, **result}

        except Exception as e:
            print(f"[MemoryService] ❌ 记忆处理失败: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(e)}

    # ==================== 内部工具 ====================

    def _format_messages(self, messages: List[Dict]) -> str:
        lines = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if role == "user":
                lines.append(f"用户: {content}")
            elif role == "assistant":
                lines.append(f"角色: {content}")
            else:
                lines.append(f"{role}: {content}")
        return "\n".join(lines)

    def _parse_memory_json(self, text: str) -> Optional[Dict]:
        import re
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r'^```(?:json)?\s*', '', text)
            text = re.sub(r'\s*```$', '', text)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r'\{[\s\S]*\}', text)
            if match:
                try:
                    return json.loads(match.group(0))
                except json.JSONDecodeError:
                    pass
        print(f"[MemoryService] JSON 解析失败，内容: {text[:200]}")
        return None

    @staticmethod
    def _profile_key_display(key: str) -> str:
        mapping = {
            "likes": "喜欢的事物",
            "dislikes": "讨厌的事物",
            "speech_style": "说话风格",
            "relationship_stage": "关系阶段",
            "trust_level": "信任程度",
            "user_personality": "对用户的印象",
            "shared_memories": "共同回忆",
            "world_setting": "世界观设定",
        }
        return mapping.get(key, key)
