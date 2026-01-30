from typing import List, Dict
from datetime import datetime
from st_utils.context_converter import ContextConverter
from st_utils.message_filter import MessageFilter


class PromptBuilder:
    """提示词构建工具"""
    
    # 语言映射
    LANG_MAP = {
        "zh": {"name": "Chinese", "display": "中文"},
        "ja": {"name": "Japanese", "display": "日文"},
        "en": {"name": "English", "display": "英文"}
    }
    
    # 场景分析模板 - 用于判断当前场景状态
    SCENE_ANALYSIS_TEMPLATE = """你是一个场景分析助手。根据对话上下文，判断当前场景状态。

**对话历史**:
{{context}}

**当前角色列表**:
{{speakers}}

**该角色近期通话记录**:
{{call_history}}

**分析任务**:
1. 识别当前**在场的角色**（正在对话或被提及在场的）
2. 识别是否有角色**刚刚离开**（离场、告别、走了）
3. 判断是否可能存在**私下对话**（多个角色在场，可能在私聊）
4. 如果有通话记录，判断是否有**强烈的再次打电话意图**

**输出格式 (严格 JSON)**:
```json
{
  "characters_present": ["角色A", "角色B"],
  "character_left": "角色C",
  "private_conversation_likely": true,
  "suggested_action": "phone_call",
  "reason": "简短解释判断原因"
}
```

**判断规则**:
- 如果有角色刚离开 → 检查是否已有近期通话:
  - 无通话记录 → suggested_action: "phone_call"  
  - 有通话记录且无强烈意图 → suggested_action: "none" (避免重复)
  - 有通话记录但有强烈意图（非常想念、有急事、明确表示想打电话等） → suggested_action: "phone_call"
- 如果 2+ 角色在场且可能私聊 → suggested_action: "eavesdrop"
- 其他情况 → suggested_action: "none"
- character_left: 离场角色名，如果没有则为 null"""

    # 对话追踪模板 - 用于生成多人私下对话
    EAVESDROP_TEMPLATE = """你是一个创意编剧，正在编写一段角色之间的私下对话。

**场景背景**:
{{user_name}} 不在场，但可以"偷听"到以下角色的对话。

**参与角色及其可用情绪**:
{{speakers_emotions}}

**对话历史参考**:
{{context}}

**创作要求**:
1. 生成自然的多人对话，角色之间互相交流
2. 对话内容可以是：
   - 讨论 {{user_name}} 的行为或心思
   - 角色之间的私人话题（关系、秘密、日常）
   - 透露一些 {{user_name}} 不知道的信息
3. 每个角色的说话风格要符合其性格
4. 情绪要自然过渡
5. 使用 {{lang_display}} 进行对话

**输出格式 (严格 JSON)**:
```json
{
  "scene_description": "场景描述",
  "segments": [
    {
      "speaker": "角色名",
      "emotion": "情绪标签",
      "text": "说话内容 ({{lang_display}})",
      "translation": "中文翻译 (必须)",
      "pause_after": 0.5
    }
  ]
}
```

**规则**:
- speaker 必须是上述角色之一
- emotion 必须是该角色的可用情绪
- 生成 15-25 个对话片段
- 让对话自然流畅，角色交替说话"""

    
    # 默认 JSON 格式 Prompt 模板
    DEFAULT_JSON_TEMPLATE = """You are an AI assistant helping to determine which character should make a phone call based on the conversation context.必须模仿电话的这种形式，电话内容必须合理且贴切，必须要有一件或者多个电话主题，围绕这个主题展开电话内容。不可以脱离当前的场景。

**Available Speakers and Their Emotions:**
{{speakers_emotions}}

**Conversation History:**
{{context}}

**上次通话摘要** (如果有):
{{last_call_summary}}

**Your Task:**
1. Analyze the conversation context
2. Determine which speaker should make the phone call
3. Generate appropriate phone call content with emotional segments
{{followup_call_instructions}}

**IMPORTANT**: Respond ONLY with valid JSON in this exact format:

```json
{
  "speaker": "speaker_name",
  "segments": [
    {
      "emotion": "emotion_tag",
      "text": "what to say in {{lang_display}}",
      "translation": "中文翻译 (必须写上，如果已经是中文，就写上中文)",
      "pause_after": 0.8,
      "speed": 1.0,
      "filler_word": null
    }
  ]
}
```

**Field Requirements**:
- **speaker**: MUST be one of the available speakers listed above ({{speakers}})可以优先选择跟{{user_name}}关系最接近来作为speaker,或者当前刚离场的人物，注意区分当前说话人知道哪些事情，不知道哪些事情。
- **emotion**: must be one of the emotions available for the selected speaker，注意情绪要符合这次的电话主题，可以使用一种情绪，或者几种情绪的组合。但是千万不能为了符合情绪而改变说话内容。情绪是为内容服务的，宁愿情绪少，也不能硬凑情绪。
- **text**: what to say in {{lang_display}},必须{{lang_display}}说话内容, make it natural and emotional，开头用符合角色身份跟主角关系的问候语，要像真实打电话一样。电话内容必须是当前场景下的事情，不能让打电话人突然脱离场景。
  * Use multiple short segments instead of one long segment
- **pause_after**: pause duration after this segment (0.2-0.8 seconds, null for default 0.3s)
  * Use longer pauses (0.7-0.8s) for major emotion transitions
  * Use medium pauses (0.4-0.6s) for minor transitions
  * Use short pauses (0.2-0.3s) for same emotion
- **speed**: speech speed multiplier (0.9-1.1, null for default 1.0)
  * Use faster (1.0-1.1) for excited/happy emotions
  * Use slower (0.9-1.0) for sad/thoughtful emotions
  * **CRITICAL - Speed Transition Rule**: When speed changes significantly (≥0.3 difference), 
    insert a transition segment with speed=1.0 between them to make the change smooth.
    Example: If going from speed 0.8 → 1.2, insert a 1.0 speed segment in between.
- **filler_word**: optional filler word

**Generate 10-15 segments** that sound natural and emotionally expressive.
**Remember**: Use NATURAL phrases. When changing speed dramatically, add a neutral-speed transition segment."""
    
    # 二次电话专用指令
    FOLLOWUP_CALL_INSTRUCTIONS = """
**重要：这是一次二次/后续来电**
- 请让角色回忆起上次通话的内容
- 开场要体现出这是再次联系（如"刚才挂掉电话后我又想了想..."、"不好意思又打给你..."、"还是忍不住想再跟你说..."）
- 解释为什么再次打电话（有新想法、担心的事、忘记说的话、想念等）
- 情绪和话题可以与上次通话有延续性
- 不要简单重复上次通话的内容，要有新的内容或情感发展
"""
    
    @staticmethod
    def build(
        template: str = None,  # 如果为 None,使用默认模板
        char_name: str = "", 
        context: List[Dict] = None, 
        extracted_data: Dict = None, 
        emotions: List[str] = None,
        max_context_messages: int = 20,
        speakers: List[str] = None,  # 新增: 说话人列表
        speakers_emotions: Dict[str, List[str]] = None,  # 新增: 说话人情绪映射
        text_lang: str = "zh",  # 新增: 文本语言配置
        extract_tag: str = "",  # 新增: 消息提取标签
        filter_tags: str = "",  # 新增: 消息过滤标签
        user_name: str = None,  # 新增: 用户名，用于区分用户身份
        last_call_info: Dict = None  # 新增: 上次通话信息，用于二次电话
    ) -> str:
        """
        构建LLM提示词
        
        Args:
            template: 提示词模板
            char_name: 角色名称 (保持兼容性)
            context: 对话上下文
            extracted_data: 提取的数据
            emotions: 可用情绪列表 (保持兼容性)
            max_context_messages: 最大上下文消息数(默认20)
            speakers: 说话人列表
            speakers_emotions: 说话人情绪映射 {说话人: [情绪列表]}
            text_lang: 文本语言配置 (zh/ja/en)
            extract_tag: 消息提取标签(如 "conxt"),留空则不提取
            filter_tags: 消息过滤标签(逗号分隔),如 "<small>, [statbar]"
            last_call_info: 上次通话信息，用于二次电话差异化
            
        Returns:
            完整提示词
        """
        # 使用默认值
        if context is None:
            context = []
        if extracted_data is None:
            extracted_data = {}
        if emotions is None:
            emotions = []
        if speakers is None:
            speakers = [char_name] if char_name else []
        if speakers_emotions is None:
            speakers_emotions = {char_name: emotions} if char_name else {}
        
        # 转换上下文为标准格式 {role, content}
        context = ContextConverter.convert_to_standard_format(context)
        
        # 如果没有提供模板,使用默认 JSON 模板
        if template is None or template == "":
            template = PromptBuilder.DEFAULT_JSON_TEMPLATE
            print(f"[PromptBuilder] 使用默认 JSON 模板")
        
        # 限制上下文长度
        limited_context = context[-max_context_messages:] if len(context) > max_context_messages else context
        
        # 格式化各部分数据
        formatted_context = PromptBuilder._format_context(
            limited_context, 
            extract_tag=extract_tag, 
            filter_tags=filter_tags,
            user_name=user_name  # 传递用户名用于替换 "User"
        )
        formatted_data = PromptBuilder._format_extracted_data(extracted_data)
        formatted_emotions = ", ".join(emotions)
        
        # 新增: 格式化说话人和情绪信息（排除用户）
        formatted_speakers = PromptBuilder._format_speakers_emotions(speakers, speakers_emotions, user_name)
        speakers_list = ", ".join([s for s in speakers if s != user_name])  # 说话人列表中排除用户
        
        # 内置变量
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M")
        message_count = len(context)
        recent_message_count = len(limited_context)
        
        # 获取语言配置
        lang_info = PromptBuilder.LANG_MAP.get(text_lang, PromptBuilder.LANG_MAP["zh"])
        lang_name = lang_info["name"]
        lang_display = lang_info["display"]
        
        # 处理上次通话摘要和二次电话指令
        last_call_summary = "无上次通话记录"
        followup_call_instructions = ""
        if last_call_info:
            last_call_summary = PromptBuilder._format_last_call_summary(last_call_info)
            followup_call_instructions = PromptBuilder.FOLLOWUP_CALL_INSTRUCTIONS
            print(f"[PromptBuilder] 检测到上次通话，添加二次电话指令")
        
        # 替换模板变量
        prompt = template
        prompt = prompt.replace("{{char_name}}", char_name)
        prompt = prompt.replace("{{context}}", formatted_context)
        prompt = prompt.replace("{{extracted_data}}", formatted_data)
        prompt = prompt.replace("{{emotions}}", formatted_emotions)
        prompt = prompt.replace("{{current_time}}", current_time)
        prompt = prompt.replace("{{message_count}}", str(message_count))
        prompt = prompt.replace("{{recent_message_count}}", str(recent_message_count))
        
        # 新增: 替换说话人相关变量
        prompt = prompt.replace("{{speakers}}", speakers_list)
        prompt = prompt.replace("{{speakers_emotions}}", formatted_speakers)
        
        # 新增: 替换语言相关变量
        prompt = prompt.replace("{{lang_name}}", lang_name)
        prompt = prompt.replace("{{lang_display}}", lang_display)
        
        # 新增: 替换上次通话和二次电话相关变量
        prompt = prompt.replace("{{last_call_summary}}", last_call_summary)
        prompt = prompt.replace("{{followup_call_instructions}}", followup_call_instructions)
        
        print(f"[PromptBuilder] 构建提示词: {len(prompt)} 字符, {message_count} 条消息, {len(speakers)} 个说话人")
        
        return prompt
    
    @staticmethod
    def _format_last_call_summary(last_call_info: Dict) -> str:
        """
        格式化上次通话摘要
        
        Args:
            last_call_info: 上次通话信息
            
        Returns:
            格式化的摘要字符串
        """
        if not last_call_info:
            return "无上次通话记录"
        
        speaker = last_call_info.get("char_name", "未知")
        created_at = last_call_info.get("created_at", "未知时间")
        
        # 提取通话内容
        segments = last_call_info.get("segments", [])
        if isinstance(segments, str):
            import json
            try:
                segments = json.loads(segments)
            except:
                segments = []
        
        # 提取所有片段的内容
        content_parts = []
        for seg in segments:
            if isinstance(seg, dict):
                text = seg.get("translation") or seg.get("text", "")
                if text:
                    content_parts.append(text)
        
        content = " ".join(content_parts) if content_parts else "无内容"
        
        return f"上次由 {speaker} 打来电话，时间: {created_at}\n内容摘要: {content[:200]}..."
    
    @staticmethod
    def _format_speakers_emotions(speakers: List[str], speakers_emotions: Dict[str, List[str]], user_name: str = None) -> str:
        """
        格式化说话人和情绪信息
        
        Args:
            speakers: 说话人列表
            speakers_emotions: 说话人情绪映射
            user_name: 用户名，用于排除
            
        Returns:
            格式化的字符串
        """
        lines = []
        for speaker in speakers:
            # 排除用户，用户不需要打电话
            if user_name and speaker == user_name:
                continue
            emotions = speakers_emotions.get(speaker, [])
            emotions_str = ", ".join(emotions) if emotions else "无可用情绪"
            lines.append(f"- {speaker}: [{emotions_str}]")
        
        return "\n".join(lines)
    
    
    @staticmethod
    def _format_context(context: List, extract_tag: str = "", filter_tags: str = "", user_name: str = None) -> str:
        """
        格式化上下文为文本
        
        Args:
            context: 对话上下文,支持两种格式:
                - 标准格式 [{"role": "user"|"assistant"|"system", "content": "..."}]
                - ContextMessage 格式 [{name, is_user, mes}]
            extract_tag: 消息提取标签
            filter_tags: 消息过滤标签
            user_name: 用户名，用于替换 "User" 显示
            
        Returns:
            格式化的文本
        """
        if not context:
            return "暂无对话历史"
        
        lines = []
        for msg in context:
            # 兼容两种格式: 字典和 Pydantic 模型
            if hasattr(msg, 'is_user'):
                # ContextMessage 格式: {name, is_user, mes}
                is_user = msg.is_user if hasattr(msg, 'is_user') else getattr(msg, 'is_user', False)
                name = msg.name if hasattr(msg, 'name') else getattr(msg, 'name', 'unknown')
                content = msg.mes if hasattr(msg, 'mes') else getattr(msg, 'mes', '')
                role = 'user' if is_user else 'assistant'
            elif isinstance(msg, dict):
                # 检查是否是 ContextMessage 风格的字典
                if 'is_user' in msg:
                    is_user = msg.get('is_user', False)
                    name = msg.get('name', 'unknown')
                    content = msg.get('mes', '')
                    role = 'user' if is_user else 'assistant'
                else:
                    # 标准格式: {role, content}
                    role = msg.get('role', 'unknown')
                    content = msg.get('content', '')
                    name = None
            else:
                role = 'unknown'
                content = str(msg)
                name = None
            
            # 应用提取和过滤
            if content:
                content = MessageFilter.extract_and_filter(content, extract_tag, filter_tags)
            
            # 确定显示名称
            # 优先使用 ContextMessage 的 name 字段（真实角色名）
            if name:
                if role == 'user':
                    role_display = f"👤 {name}"
                else:
                    role_display = f"🎭 {name}"
            elif role == 'user':
                role_display = f"👤 {user_name}" if user_name else "👤 User"
            elif role == 'assistant':
                role_display = "🤖 Assistant"
            elif role == 'system':
                role_display = "⚙️ System"
            else:
                role_display = f"❓ {role}"
            
            lines.append(f"{role_display}: {content}")
        
        # 使用双换行分隔每条消息,使其更清晰
        return "\n\n".join(lines)
    
    @staticmethod
    def _format_extracted_data(data: Dict) -> str:
        """
        格式化提取的数据
        
        Args:
            data: 提取的数据字典
            
        Returns:
            格式化的文本
        """
        if not data:
            return "无"
        
        lines = []
        for key, values in data.items():
            if values:
                # 去重并限制数量
                unique_values = list(dict.fromkeys(values))[:5]
                lines.append(f"- {key}: {', '.join(unique_values)}")
        
        return "\n".join(lines) if lines else "无"
    
    @staticmethod
    def build_scene_analysis_prompt(
        context: List[Dict],
        speakers: List[str],
        max_context_messages: int = 10,
        user_name: str = None,
        call_history: List[Dict] = None
    ) -> str:
        """
        构建场景分析 Prompt
        
        Args:
            context: 对话上下文
            speakers: 可用角色列表
            max_context_messages: 最大上下文消息数
            user_name: 用户名称
            call_history: 近期通话历史记录
            
        Returns:
            格式化的场景分析 Prompt
        """
        # 限制上下文长度
        limited_context = context[-max_context_messages:] if context else []
        
        # 格式化上下文
        context_text = PromptBuilder._format_context(limited_context, user_name=user_name)
        
        # 格式化通话历史
        call_history_text = PromptBuilder._format_call_history(call_history)
        
        # 构建 prompt
        prompt = PromptBuilder.SCENE_ANALYSIS_TEMPLATE
        prompt = prompt.replace("{{context}}", context_text)
        prompt = prompt.replace("{{speakers}}", ", ".join(speakers))
        prompt = prompt.replace("{{call_history}}", call_history_text)
        
        return prompt
    
    @staticmethod
    def _format_call_history(call_history: List[Dict]) -> str:
        """
        格式化通话历史为可读文本
        
        Args:
            call_history: 通话历史记录列表
            
        Returns:
            格式化的字符串
        """
        if not call_history:
            return "无近期通话记录"
        
        lines = []
        for i, call in enumerate(call_history[:3], 1):  # 最多显示3条
            speaker = call.get("char_name", "未知")
            created_at = call.get("created_at", "未知时间")
            
            # 提取通话摘要（从 segments 中获取前几句）
            segments = call.get("segments", [])
            if isinstance(segments, str):
                import json
                try:
                    segments = json.loads(segments)
                except:
                    segments = []
            
            summary_parts = []
            for seg in segments:
                if isinstance(seg, dict):
                    text = seg.get("translation") or seg.get("text", "")
                    if text:
                        summary_parts.append(text)
            
            summary = "..." + "...".join(summary_parts) + "..." if summary_parts else "无内容"
            lines.append(f"- 第{i}次通话 ({speaker}): {summary}")
        
        return "\n".join(lines)
    
    @staticmethod
    def build_eavesdrop_prompt(
        context: List[Dict],
        speakers_emotions: Dict[str, List[str]],
        user_name: str = "用户",
        text_lang: str = "zh",
        max_context_messages: int = 20
    ) -> str:
        """
        构建对话追踪 Prompt
        
        Args:
            context: 对话上下文
            speakers_emotions: 说话人情绪映射 {speaker: [emotions]}
            user_name: 用户名
            text_lang: 文本语言
            max_context_messages: 最大上下文消息数
            
        Returns:
            格式化的对话追踪 Prompt
        """
        # 限制上下文长度
        limited_context = context[-max_context_messages:] if context else []
        
        # 格式化上下文
        context_text = PromptBuilder._format_context(limited_context, user_name=user_name)
        
        # 格式化说话人情绪
        speakers_emotions_text = ""
        for speaker, emotions in speakers_emotions.items():
            emotions_str = ", ".join(emotions) if emotions else "neutral"
            speakers_emotions_text += f"- {speaker}: [{emotions_str}]\n"
        
        # 获取语言显示
        lang_info = PromptBuilder.LANG_MAP.get(text_lang, PromptBuilder.LANG_MAP["zh"])
        lang_display = lang_info["display"]
        
        # 构建 prompt
        prompt = PromptBuilder.EAVESDROP_TEMPLATE
        prompt = prompt.replace("{{context}}", context_text)
        prompt = prompt.replace("{{speakers_emotions}}", speakers_emotions_text.strip())
        prompt = prompt.replace("{{user_name}}", user_name)
        prompt = prompt.replace("{{lang_display}}", lang_display)
        
        return prompt

