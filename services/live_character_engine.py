"""
活人感引擎 - 多维度角色状态分析和动态触发

职责:
- 开放式角色状态分析(物理、情绪、认知、社交四维度)
- 动态评估角色潜在行动
- 灵活触发不同类型的行为
"""
from typing import List, Dict, Optional, Any
from datetime import datetime
from database import DatabaseManager
from config import load_json, SETTINGS_FILE


class LiveCharacterEngine:
    """活人感引擎 - 让每个角色都"活起来\""""
    
    def __init__(self):
        self.db = DatabaseManager()
        
        # 加载配置
        settings = load_json(SETTINGS_FILE)
        self.config = settings.get("phone_call", {}).get("live_character", {})
        
        # 默认配置
        self.enabled = self.config.get("enabled", True)
        self.threshold = self.config.get("threshold", 60)
        
        # 行动类型处理器注册表
        self.action_handlers = {
            "phone_call": self._handle_phone_call,
            "side_conversation": self._handle_side_conversation,
            "leave_scene": self._handle_leave_scene,
            "self_talk": self._handle_self_talk,
            # 可无限扩展
        }
        
        print(f"[LiveCharacterEngine] 初始化完成 - 阈值: {self.threshold}")
    
    def build_analysis_prompt(self, context: List[Dict], speakers: List[str]) -> str:
        """
        构建开放式角色状态分析的LLM Prompt (含触发建议)
        
        Args:
            context: 对话上下文
            speakers: 说话人列表
            
        Returns:
            LLM Prompt
        """
        context_text = "\n".join([
            f"{msg.get('name', '未知')}: {msg.get('mes', '')}"
            for msg in context[-10:]  # 只取最近10条
        ])
        
        speakers_list = "、".join(speakers)
        
        prompt = f"""
请以JSON格式分析当前场景中每个角色的状态，并判断是否应该触发特殊事件。

# 对话上下文
{context_text}

# 需分析的角色
{speakers_list}

# 分析要求
对每个角色,请提供以下维度的分析:

## 1. 物理状态 (physical)
- location: 在场/离场,具体位置
- action: 正在做什么
- posture: 姿态、表情

## 2. 情绪状态 (emotional)
- current: 当前情绪(自然语言描述)
- intensity: 情绪强度(1-10)
- trend: 情绪变化趋势

## 3. 认知状态 (cognitive)
- focus: 注意力焦点
- concerns: 担心的事情(列表)
- desires: 想做什么(列表)

## 4. 社交状态 (social)
- engagement: 对话投入度
- relationship_dynamics: 和其他角色的互动
- hidden_thoughts: 可能没说出口的想法

## 5. 潜在行动 (potential_actions)
列出角色可能采取的行动,每个行动包括:
- type: 行动类型(如phone_call, side_conversation, leave_scene等)
- target: 行动对象(如果有)
- reason: 原因
- urgency: 紧迫度(1-10)

# 场景触发建议
根据当前场景状态,判断是否应该触发以下事件:
- phone_call: 有角色离场且适合打电话给用户
- eavesdrop: 多个角色在场,可能有私下对话（用户可以偷听）
- none: 当前场景不适合触发任何事件

# 输出格式
{{
    "character_states": {{
        "角色名1": {{
            "physical": {{}},
            "emotional": {{}},
            "cognitive": {{}},
            "social": {{}},
            "potential_actions": []
        }},
        "角色名2": {{...}}
    }},
    "scene_trigger": {{
        "suggested_action": "phone_call|eavesdrop|none",
        "character_left": "离场角色名或null",
        "characters_present": ["在场角色列表"],
        "private_conversation_likely": true/false,
        "reason": "简短解释判断原因",
        
        // 以下字段仅在 suggested_action 为 "eavesdrop" 时需要填写:
        "eavesdrop_config": {{
            "conversation_theme": "对话的核心主题，如：讨论用户的行为、角色之间的秘密等",
            "conversation_outline": [
                "对话第一阶段：开场，引出话题",
                "对话第二阶段：深入讨论，揭示矛盾",
                "对话第三阶段：情感高潮或结论"
            ],
            "dramatic_tension": "戏剧张力描述，如：暗流涌动的嫉妒、表面平静的竞争",
            "hidden_information": "对话中可能透露的用户不知道的信息",
            "emotional_arc": "情绪弧线，如：平静→紧张→爆发→缓和"
        }}
    }}
}}

请保持分析的自然性和灵活性,不要受固定模式限制。
"""
        return prompt


    
    def _sanitize_json_string(self, json_str: str) -> str:
        """
        预处理 JSON 字符串，修复常见的 LLM 输出格式问题
        
        Args:
            json_str: 原始 JSON 字符串
            
        Returns:
            清理后的 JSON 字符串
        """
        import re
        
        # 1. 移除可能的 BOM 和特殊不可见字符
        json_str = json_str.strip()
        if json_str.startswith('\ufeff'):
            json_str = json_str[1:]
        
        # 2. 移除 JSON 对象/数组末尾的多余逗号
        json_str = re.sub(r',(\s*[}\]])', r'\1', json_str)
        
        # 3. 修复常见的布尔值问题 (True -> true, False -> false, None -> null)
        json_str = re.sub(r':\s*True\b', ': true', json_str)
        json_str = re.sub(r':\s*False\b', ': false', json_str)
        json_str = re.sub(r':\s*None\b', ': null', json_str)
        
        # 4. 修复未加引号的字符串值 - 这是 LLM 最常见的错误
        # 处理模式: "key": 中文或其他非JSON值的内容
        # 例如: "对杜先生": 绝对服从、崇拜 -> "对杜先生": "绝对服从、崇拜"
        lines = json_str.split('\n')
        fixed_lines = []
        
        for line in lines:
            fixed_line = self._fix_unquoted_string_values(line)
            fixed_lines.append(fixed_line)
        
        json_str = '\n'.join(fixed_lines)
        
        return json_str
    
    def _fix_unquoted_string_values(self, line: str) -> str:
        """
        修复单行中未加引号的字符串值
        
        例如:
        "key": 中文内容  ->  "key": "中文内容"
        "key": some text,  ->  "key": "some text",
        """
        import re
        
        # 匹配模式: "key": 后面跟着非 JSON 标准值的内容
        # JSON 标准值: "string", number, true, false, null, {, [
        # 我们要找的是冒号后面不是这些标准值开头的情况
        
        # 这个正则匹配: "key": 后面跟着不是 ", {, [, 数字, true, false, null 的内容
        pattern = r'("[\w\u4e00-\u9fff]+")\s*:\s*(?![\[\{"\d]|true|false|null)([^\n\r,}\]]+)'
        
        def fix_value(match):
            key = match.group(1)
            value = match.group(2).strip()
            
            # 如果值已经被引号包围或是空的，不处理
            if not value or value.startswith('"') or value.startswith("'"):
                return match.group(0)
            
            # 移除尾部的逗号（如果有的话）
            trailing = ''
            if value.endswith(','):
                value = value[:-1].strip()
                trailing = ','
            
            # 转义值中的引号
            value = value.replace('"', '\\"')
            
            return f'{key}: "{value}"{trailing}'
        
        return re.sub(pattern, fix_value, line)
    
    def _try_parse_json(self, json_str: str) -> Optional[Dict]:
        """
        尝试多种方式解析 JSON
        
        Args:
            json_str: JSON 字符串
            
        Returns:
            解析结果或 None
        """
        import json
        
        # 尝试 1: 直接解析
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            print(f"[LiveCharacterEngine] 直接解析失败: {e}")
        
        # 尝试 2: 预处理后解析
        try:
            sanitized = self._sanitize_json_string(json_str)
            return json.loads(sanitized)
        except json.JSONDecodeError as e:
            print(f"[LiveCharacterEngine] 预处理后解析失败: {e}")
        
        # 尝试 3: 使用更宽松的解析（如果安装了demjson3）
        try:
            import demjson3
            return demjson3.decode(json_str)
        except ImportError:
            pass  # demjson3 未安装，跳过
        except Exception as e:
            print(f"[LiveCharacterEngine] demjson3 解析失败: {e}")
        
        return None
    
    def parse_llm_response(self, llm_response: str) -> Dict[str, Any]:
        """
        解析LLM返回的角色状态和触发建议
        
        Args:
            llm_response: LLM响应
            
        Returns:
            解析后的结果，包含 character_states 和 scene_trigger
        """
        import json
        import re
        
        if not llm_response or not llm_response.strip():
            print(f"[LiveCharacterEngine] ❌ LLM 响应为空")
            return {}
        
        print(f"[LiveCharacterEngine] 开始解析 LLM 响应 (长度: {len(llm_response)})")
        
        # 尝试直接解析
        result = self._try_parse_json(llm_response)
        if result:
            print(f"[LiveCharacterEngine] ✅ 直接解析 JSON 成功")
        else:
            # 如果失败，尝试提取 JSON 块
            json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', llm_response, re.DOTALL)
            if json_match:
                json_str = json_match.group(1).strip()
                print(f"[LiveCharacterEngine] 提取到 JSON 块 (长度: {len(json_str)})")
                
                result = self._try_parse_json(json_str)
                if result:
                    print(f"[LiveCharacterEngine] ✅ JSON 块解析成功")
                else:
                    # 详细诊断输出
                    print(f"[LiveCharacterEngine] ❌ JSON 块解析失败")
                    self._diagnose_json_error(json_str)
                    return {}
            else:
                # 尝试找到任何看起来像 JSON 对象的内容
                brace_match = re.search(r'\{[\s\S]*\}', llm_response)
                if brace_match:
                    json_str = brace_match.group(0)
                    print(f"[LiveCharacterEngine] 提取到疑似 JSON 对象 (长度: {len(json_str)})")
                    
                    result = self._try_parse_json(json_str)
                    if result:
                        print(f"[LiveCharacterEngine] ✅ 疑似 JSON 解析成功")
                    else:
                        print(f"[LiveCharacterEngine] ❌ 疑似 JSON 解析失败")
                        self._diagnose_json_error(json_str)
                        return {}
                else:
                    print(f"[LiveCharacterEngine] ❌ 未找到 JSON 块或对象")
                    print(f"[LiveCharacterEngine] 响应内容前 500 字符:")
                    print(llm_response[:500] if len(llm_response) > 500 else llm_response)
                    return {}
        
        # 兼容新旧格式
        if "character_states" in result:
            # 新格式: {character_states: {...}, scene_trigger: {...}}
            return result
        else:
            # 旧格式: 直接是角色状态字典 {角色名: {...}}
            # 转换为新格式
            return {
                "character_states": result,
                "scene_trigger": {
                    "suggested_action": "none",
                    "character_left": None,
                    "characters_present": list(result.keys()),
                    "private_conversation_likely": False,
                    "reason": "旧格式响应,无触发建议"
                }
            }
    
    def _diagnose_json_error(self, json_str: str):
        """详细诊断 JSON 解析错误"""
        import json
        
        try:
            json.loads(json_str)
        except json.JSONDecodeError as e:
            error_line = e.lineno
            error_col = e.colno
            error_pos = e.pos
            
            print(f"[LiveCharacterEngine] 📍 错误位置: 行 {error_line}, 列 {error_col}, 字符位置 {error_pos}")
            
            # 显示错误附近的内容
            lines = json_str.split('\n')
            if 0 < error_line <= len(lines):
                # 显示错误行及前后各1行
                start = max(0, error_line - 2)
                end = min(len(lines), error_line + 1)
                print(f"[LiveCharacterEngine] 📝 错误附近内容:")
                for i in range(start, end):
                    marker = ">>> " if i == error_line - 1 else "    "
                    print(f"{marker}L{i+1}: {lines[i][:100]}{'...' if len(lines[i]) > 100 else ''}")

    
    def evaluate_character_actions(
        self,
        character_name: str,
        character_state: Dict,
        chat_branch: str,
        current_floor: int
    ) -> List[Dict]:
        """
        评估角色的潜在行动,决定是否触发
        
        Args:
            character_name: 角色名称
            character_state: 角色状态(完整的四维度数据)
            chat_branch: 对话分支ID
            current_floor: 当前楼层
            
        Returns:
            应该触发的行动列表
        """
        if not self.enabled:
            return []
        
        triggered_actions = []
        potential_actions = character_state.get("potential_actions", [])
        
        for action in potential_actions:
            score = self._calculate_action_score(action, character_state)
            
            print(f"[LiveCharacterEngine] 评估 {character_name} 的行动 '{action.get('type')}': 评分={score}")
            
            if score >= self.threshold:
                # 触发行动
                triggered_actions.append({
                    **action,
                    "character_name": character_name,
                    "score": score,
                    "floor": current_floor
                })
        
        return triggered_actions
    
    def _calculate_action_score(self, action: Dict, state: Dict) -> int:
        """
        动态评分算法
        
        综合考虑:
        1. 行动紧迫度 (urgency)
        2. 情绪强度 (emotional intensity)
        3. 认知需求数量 (cognitive desires)
        4. 社交动机 (hidden thoughts)
        
        Returns:
            总评分(0-100)
        """
        score = 0
        
        # 1. 紧迫度权重(40%)
        urgency = action.get("urgency", 0)
        score += urgency * 4
        
        # 2. 情绪强度权重(30%)
        emotional = state.get("emotional", {})
        intensity = emotional.get("intensity", 0)
        score += intensity * 3
        
        # 3. 认知需求权重(20%)
        cognitive = state.get("cognitive", {})
        desires = cognitive.get("desires", [])
        score += len(desires) * 5 if desires else 0
        
        # 4. 社交动机权重(10%)
        social = state.get("social", {})
        hidden_thoughts = social.get("hidden_thoughts", "")
        if hidden_thoughts:
            score += 10
        
        return min(int(score), 100)  # 限制最大100分
    
    def trigger_action(self, action: Dict, character_state: Dict) -> Dict:
        """
        触发行动
        
        Args:
            action: 行动信息
            character_state: 角色状态
            
        Returns:
            触发结果
        """
        action_type = action.get("type", "unknown")
        handler = self.action_handlers.get(action_type)
        
        if handler:
            return handler(action, character_state)
        else:
            # 未知类型,使用通用处理
            return self._handle_generic_action(action, character_state)
    
    def _handle_phone_call(self, action: Dict, state: Dict) -> Dict:
        """处理电话行动"""
        return {
            "action_type": "phone_call",
            "character_name": action.get("character_name"),
            "target": action.get("target"),
            "reason": action.get("reason"),
            "urgency": action.get("urgency"),
            "score": action.get("score"),
            "trigger_method": "live_character_engine"
        }
    
    def _handle_side_conversation(self, action: Dict, state: Dict) -> Dict:
        """处理私下对话"""
        return {
            "action_type": "side_conversation",
            "character_name": action.get("character_name"),
            "target": action.get("target"),
            "topic": action.get("topic", action.get("reason")),
            "urgency": action.get("urgency"),
            "score": action.get("score")
        }
    
    def _handle_leave_scene(self, action: Dict, state: Dict) -> Dict:
        """处理离场"""
        return {
            "action_type": "leave_scene",
            "character_name": action.get("character_name"),
            "reason": action.get("reason"),
            "urgency": action.get("urgency")
        }
    
    def _handle_self_talk(self, action: Dict, state: Dict) -> Dict:
        """处理内心独白"""
        return {
            "action_type": "self_talk",
            "character_name": action.get("character_name"),
            "content": action.get("reason"),
            "urgency": action.get("urgency")
        }
    
    def _handle_generic_action(self, action: Dict, state: Dict) -> Dict:
        """通用行动处理器"""
        print(f"[LiveCharacterEngine] 未知行动类型: {action.get('type')}, 使用通用处理")
        return {
            "action_type": action.get("type", "unknown"),
            "character_name": action.get("character_name"),
            "raw_action": action
        }
    
    def generate_summary(self, character_states: Dict) -> str:
        """
        生成简短摘要(专门给LLM用)
        
        压缩策略:
        - 只保留关键信息
        - 使用简洁的自然语言
        - 限制在200字以内
        
        Args:
            character_states: 完整的角色状态
            
        Returns:
            简短摘要文本
        """
        summaries = []
        
        for char_name, state in character_states.items():
            physical = state.get("physical", {})
            emotional = state.get("emotional", {})
            
            location = physical.get("location", "未知")
            emotion = emotional.get("current", "未知")
            intensity = emotional.get("intensity", 0)
            
            # 生成单行摘要
            char_summary = f"{char_name}({location}, {emotion}_{intensity})"
            summaries.append(char_summary)
        
        return "; ".join(summaries)
