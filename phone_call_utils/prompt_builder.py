from typing import List, Dict
from datetime import datetime
from phone_call_utils.context_converter import ContextConverter
from phone_call_utils.message_filter import MessageFilter


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

    # 对话追踪模板 - 用于生成多人私下对话（基础版）
    EAVESDROP_TEMPLATE = """你是一个创意编剧，正在编写一段角色之间的私下对话。

**场景背景**:
{{user_name}} 不在场，但可以"偷听"到以下角色的对话。

**参与角色及其可用情绪**:
{{speakers_emotions}}

**对话历史参考**:
{{context}}

**剧本创作核心要求与铁律**:
1. 【深度剧情锚定 (严禁割裂)】: 必须仔细阅读【对话历史参考】！角色私下谈话必须紧密结合刚才发生的剧情、主角刚才的举动或当前共同面临的环境，紧扣事件展开，严禁脱节闲聊。
2. 【多人交替互动】: 参与角色自然交替说话，展现角色私底下对彼此的真实看法、心声或不为人知的秘密。
3. 【情绪标签严格闭环】: 每个 segment 的 emotion 字段值**必须 100% 严格从上述【参与角色及其可用情绪】列表中选取**，严禁自行编造或臆造列表中不存在的情绪词。
4. 每个角色的说话风格要符合其性格人设。
5. **text 字段必须使用{{lang_display}}进行对话，这是强制要求，不可使用其他语言**
6. **【translation 字段铁律】: 无论 text 字段是日文、英文还是其他任何语言，translation 字段必须且只能填写流畅地道的简体中文！严禁在 translation 字段输出英文或非中文内容！若 text 本身是中文，则将中文原句复制到 translation。**

**⚠️ 重要：纯语音内容规范**:
这是一个 TTS 语音合成系统，text 字段只能包含**可朗读的纯对话文本**。
严禁在 text 字段中包含：
- ❌ 括号内的动作描述，如 `（轻微吸气）`、`（看向窗外）`
- ❌ 括号内的心理活动，如 `（心想这个人真讨厌）`
- ❌ 括号内的场景描述，如 `（伤口隐痛）`、`（身体僵硬）`
- ❌ 任何非语音的标注，如 `*叹气*`、`[停顿]`

**正确示例**: `"你懂什么？这叫禁忌的诱惑，是男人骨子里的本能。"`
**错误示例**: `"（轻微吸气）你...你懂什么？（由于伤口隐痛身体有些僵硬）"`

**输出格式 (严格 JSON)**:
```json
{
  "scene_description": "场景描述",
  "segments": [
    {
      "speaker": "角色名",
      "emotion": "情绪标签",
      "text": "纯对话内容，无任何括号或动作描述，**必须使用{{lang_display}}**",
      "translation": "简体中文翻译 (【铁律】：必须是中文！严禁输出英文或日文！若text是中文就复制相同中文)",
      "pause_after": 0.5
    }
  ]
}
```

**规则**:
- speaker 必须是上述角色之一
- emotion 必须是该角色的可用情绪
- **text 字段只能是纯对话，禁止任何括号或动作描述**
- **translation 字段必填，必须且只能是简体中文，严禁省略或输出非中文**
- 生成 10-25 个对话片段
- 让对话自然流畅，角色交替说话"""

    # 增强版对话追踪模板 - 使用分析 LLM 提供的主题和框架
    EAVESDROP_TEMPLATE_ENHANCED = """你是一个创意编剧，正在按照编剧大纲编写一段角色之间的私下对话。

**场景背景**:
{{user_name}} 不在场，但可以"偷听"到以下角色的对话。

**参与角色及其可用情绪**:
{{speakers_emotions}}

**对话历史参考**:
{{context}}

{{eavesdrop_guidance}}

**剧本创作核心要求与铁律**:
1. **严格按照上述对话大纲和主题进行创作**，并深度结合【对话历史参考】中的最新剧情进展。
2. 【情绪标签严格闭环】: 每个 segment 的 emotion 字段值**必须 100% 严格从上述【参与角色及其可用情绪】列表中选取**，严禁自行编造或臆造列表中不存在的情绪词。
3. 每个角色的说话风格要符合其性格人设，情绪要自然过渡。
4. **text 字段必须使用{{lang_display}}进行对话，这是强制要求，不可使用其他语言**
5. **【translation 字段铁律】: 无论 text 字段是日文、英文还是其他任何语言，translation 字段必须且只能填写流畅地道的简体中文！严禁在 translation 字段输出英文或非中文内容！若 text 本身是中文，则将中文原句复制到 translation。**

**⚠️ 重要：纯语音内容规范**:
这是一个 TTS 语音合成系统，text 字段只能包含**可朗读的纯对话文本**。
严禁在 text 字段中包含：
- ❌ 括号内的动作描述，如 `（轻微吸气）`、`（看向窗外）`
- ❌ 括号内的心理活动，如 `（心想这个人真讨厌）`
- ❌ 括号内的场景描述，如 `（伤口隐痛）`、`（身体僵硬）`
- ❌ 任何非语音的标注，如 `*叹气*`、`[停顿]`

**正确示例**: `"你懂什么？这叫禁忌的诱惑，是男人骨子里的本能。"`
**错误示例**: `"（轻微吸气）你...你懂什么？（由于伤口隐痛身体有些僵硬）"`

**输出格式 (严格 JSON)**:
```json
{
  "scene_description": "场景描述",
  "segments": [
    {
      "speaker": "角色名",
      "emotion": "情绪标签",
      "text": "纯对话内容，无任何括号或动作描述，**必须使用{{lang_display}}**",
      "translation": "简体中文翻译 (【铁律】：必须是中文！严禁输出英文或日文！若text是中文就复制相同中文)",
      "pause_after": 0.5
    }
  ]
}
```

**规则**:
- speaker 必须是上述角色之一
- emotion 必须是该角色的可用情绪
- **text 字段只能是纯对话，禁止任何括号或动作描述**
- **translation 字段必填，必须且只能是简体中文，严禁输出非中文**
- 生成 15-25 个对话片段
- 让对话自然流畅，角色交替说话
- **对话内容必须紧扣主题，不能偏离大纲"""


    
    # 默认 JSON 格式 Prompt 模板
    DEFAULT_JSON_TEMPLATE = """You are an AI assistant helping to determine which character should make a phone call based on the conversation context. 必须高度拟真电话/传讯的形式，内容必须贴切真实，严禁脱离当前故事主线。

**Available Speakers and Their Emotions:**
{{speakers_emotions}}

**Conversation History:**
{{context}}

**上次通话摘要** (如果有):
{{last_call_summary}}

**Your Task & Core Rules**:
1. 【深度剧情锚定】: 仔细分析对话历史 (Conversation History)，通话内容必须深度结合两人刚刚经历的事件、刚分别的场景或未尽的话题，绝不可生成脱离故事背景的孤立闲聊。
2. 【单向通话/独角戏】: 这是一个单向来电/独白，接听方 {{user_name}} 在此阶段**不会有任何语音回应**。绝对禁止自导自演假装听到对方说话并自我回应（严禁出现“啊？你说什么？……哦，这样啊”等虚假互动），必须保持单向倾诉、询问或叙述的连贯口语表达。
3. 【情绪标签严格闭环】: 每个片段的 emotion 字段值**必须 100% 严格从上述【Available Speakers and Their Emotions】列表中选择**，严禁自行臆造列表中不存在的情绪标签！
4. 确定由哪位角色发起呼叫，围绕动机生成 10-15 个具有真实生活感的情感片段。
5. **【translation 字段铁律】: 无论 text 字段是英文、日文还是其他任何语言，translation 字段必须且只能输出地道流畅的简体中文翻译！严禁在 translation 中输出英文！如果 text 已经是中文，则 translation 输出相同中文。**
{{followup_call_instructions}}

**IMPORTANT**: Respond ONLY with valid JSON in this exact format:

```json
{
  "speaker": "speaker_name",
  "segments": [
    {
      "emotion": "must_be_from_available_emotions_list",
      "text": "对话内容，**必须使用{{lang_display}}**",
      "translation": "简体中文翻译 (【铁律】：必须是中文！严禁输出英文或日文！如果text已经是中文则填入相同中文)",
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
- **text**: **必须使用{{lang_display}}**，这是强制要求！对话内容必须自然有情感，开头用符合角色身份跟主角关系的问候语，要像真实打电话一样。电话内容必须是当前场景下的事情，不能让打电话人突然脱离场景。
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

**⚠️ 重要：纯语音内容规范**:
这是一个 TTS 语音合成系统，text 字段只能包含**可朗读的纯对话文本**。
**严禁**在 text 字段中包含：
- ❌ 括号内的动作描述，如 `（轻微吸气）`、`（看向窗外）`
- ❌ 括号内的心理活动，如 `（心想这个人真讨厌）`
- ❌ 括号内的场景描述，如 `（伤口隐痛）`、`（身体僵硬）`
- ❌ 任何非语音的标注，如 `*叹气*`、`[停顿]`

**正确示例**: `"喂？是我，我有点想你了..."`
**错误示例**: `"（深呼吸）喂？是我...（声音有些颤抖）"`

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
        template: str = None,
        char_name: str = "", 
        context: List[Dict] = None, 
        extracted_data: Dict = None, 
        emotions: List[str] = None,
        max_context_messages: int = 20,
        speakers: List[str] = None,
        speakers_emotions: Dict[str, List[str]] = None,
        text_lang: str = "zh",
        extract_tag: str = "",
        filter_tags: str = "",
        user_name: str = None,
        last_call_info: Dict = None,
        call_reason: str = "",  # 呼叫动机/事由
        call_tone: str = "",  # 通话氛围/语气
        caller: str = "",  # 明确指定的呼叫发起人
        target: str = "",  # 接听对象 (用户或另一角色)
        receiver: str = "",  # 接听对象 (同 target)
        character_persona: str = "",  # 角色卡人设/性格特征 (从SillyTavern角色卡自动读取)
        world_info: str = "",  # 世界书/世界观设定 (从SillyTavern自动读取)
        story_summary: str = ""  # 历史剧情总结/场景摘要 (从数据库或分析记录自动注入)
    ) -> str:
        """
        构建LLM提示词
        
        Args:
            template: 提示词模板
            char_name: 角色名称
            context: 对话上下文
            extracted_data: 提取的数据
            emotions: 可用情绪列表
            max_context_messages: 最大上下文消息数
            speakers: 说话人列表
            speakers_emotions: 说话人情绪映射
            text_lang: 文本语言配置
            extract_tag: 消息提取标签
            filter_tags: 消息过滤标签
            user_name: 用户名
            last_call_info: 上次通话信息
            call_reason: 打电话的原因（由 LLM 分析或定向指定）
            call_tone: 通话氛围（如轻松闲聊、深情倾诉等）
            caller: 明确指定的呼叫发起人 (如为空则默认 char_name)
            target: 接听对象 (如为空则默认 user_name 或 "用户")
            receiver: 接听对象别名
            character_persona: 角色人设或性格补充 (从角色卡自动注入)
            world_info: 世界书/设定条目 (从SillyTavern自动注入)
            
        Returns:
            完整提示词
        """
        # 使用默认值
        effective_caller = (caller or char_name or "").strip()
        effective_target = (target or receiver or user_name or "用户").strip()
        
        if context is None:
            context = []
        if extracted_data is None:
            extracted_data = {}
        if emotions is None:
            emotions = []
        if speakers is None:
            speakers = [effective_caller] if effective_caller else ([char_name] if char_name else [])
        if speakers_emotions is None:
            speakers_emotions = {effective_caller: emotions} if effective_caller else ({char_name: emotions} if char_name else {})
        
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
            user_name=effective_target  # 传递目标名称用于替换 "User"
        )
        formatted_data = PromptBuilder._format_extracted_data(extracted_data)
        formatted_emotions = ", ".join(emotions)
        
        # 格式化说话人和情绪信息（排除接听者）
        formatted_speakers = PromptBuilder._format_speakers_emotions(speakers, speakers_emotions, effective_target)
        speakers_list = ", ".join([s for s in speakers if s != effective_target])  # 说话人列表中排除接听人
        if not speakers_list and effective_caller:
            speakers_list = effective_caller
        
        # 内置变量
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M")
        message_count = len(context)
        recent_message_count = len(limited_context)
        
        # 获取语言配置
        lang_info = PromptBuilder.LANG_MAP.get(text_lang, PromptBuilder.LANG_MAP["zh"])
        lang_name = lang_info["name"]
        lang_display = lang_info["display"]
        print(f"[PromptBuilder] [Lang] build: text_lang={text_lang} -> lang_name={lang_name}, lang_display={lang_display}")
        
        # 处理上次通话摘要和二次电话指令
        last_call_summary = "无上次通话记录"
        followup_call_instructions = ""
        if last_call_info:
            last_call_summary = PromptBuilder._format_last_call_summary(last_call_info)
            followup_call_instructions = PromptBuilder.FOLLOWUP_CALL_INSTRUCTIONS
            print(f"[PromptBuilder] 检测到上次通话，添加二次电话指令")
        
        # 替换模板变量
        prompt = template
        # 角色与呼叫身份插槽
        prompt = prompt.replace("{{caller}}", effective_caller or char_name or "角色")
        prompt = prompt.replace("{{char_name}}", char_name or effective_caller or "角色")
        prompt = prompt.replace("{{speaker}}", effective_caller or char_name or "角色")
        prompt = prompt.replace("{{target}}", effective_target)
        prompt = prompt.replace("{{receiver}}", effective_target)
        prompt = prompt.replace("{{user_name}}", effective_target)
        prompt = prompt.replace("{{user}}", effective_target)
        
        # 剧情动机、人设与世界书插槽
        prompt = prompt.replace("{{call_reason}}", call_reason or "日常问候与交流")
        prompt = prompt.replace("{{call_tone}}", call_tone or "自然生动")
        prompt = prompt.replace("{{character_persona}}", character_persona or "符合人物性格设定")
        prompt = prompt.replace("{{world_info}}", world_info or "无特殊世界书设定")
        prompt = prompt.replace("{{story_summary}}", story_summary or "")
        
        # 上下文与数据插槽
        prompt = prompt.replace("{{context}}", formatted_context)
        prompt = prompt.replace("{{extracted_data}}", formatted_data)
        prompt = prompt.replace("{{emotions}}", formatted_emotions)
        prompt = prompt.replace("{{current_time}}", current_time)
        prompt = prompt.replace("{{message_count}}", str(message_count))
        prompt = prompt.replace("{{recent_message_count}}", str(recent_message_count))
        
        # 说话人与情绪插槽
        prompt = prompt.replace("{{speakers}}", speakers_list)
        prompt = prompt.replace("{{speakers_emotions}}", formatted_speakers)
        
        # 语言插槽
        prompt = prompt.replace("{{lang_name}}", lang_name)
        prompt = prompt.replace("{{lang_display}}", lang_display)
        
        # 上次通话和二次电话插槽
        prompt = prompt.replace("{{last_call_summary}}", last_call_summary)
        prompt = prompt.replace("{{followup_call_instructions}}", followup_call_instructions)
        
        # 构建电话背景信息与世界书/人设补充
        call_context_section = ""
        if call_reason or call_tone or character_persona or world_info or story_summary:
            call_context_parts = ["\n**电话背景、人设与世界观**:"]
            if effective_caller:
                call_context_parts.append(f"- 发起人 (Caller): {effective_caller}")
            if effective_target:
                call_context_parts.append(f"- 通话对象 (Target): {effective_target}")
            if call_reason:
                call_context_parts.append(f"- 通话事由/动机: {call_reason}")
            if call_tone:
                call_context_parts.append(f"- 通话氛围/基调: {call_tone}")
            if character_persona:
                call_context_parts.append(f"- 角色设定 (Persona): {character_persona}")
            if world_info:
                call_context_parts.append(f"- 世界书/场景设定 (World Info): {world_info}")
            if story_summary:
                call_context_parts.append(f"- 前情剧情总结 (Story Summary): {story_summary}")
            call_context_parts.append("【核心铁律】: 1. 深度剧情锚定：通话内容必须深度结合【近期对话上下文】最新剧情展开，绝不可脱节闲聊；2. 单向独白：接听方不会回应，禁止自导自演虚假互动；3. 情绪闭环：emotion 必须严格从列表选取。\n")
            call_context_section = "\n".join(call_context_parts)
            print(f"[PromptBuilder] [CallContext] caller={effective_caller}, target={effective_target}, reason={call_reason}, tone={call_tone}")
        
        prompt = prompt.replace("{{call_context}}", call_context_section)
        # 如果模板中没有 {{call_context}} 占位符且包含背景内容，在 **Conversation History:** 前后插入补充
        if call_context_section and "{{call_context}}" not in template:
            if "**Conversation History:**" in prompt:
                prompt = prompt.replace("**Conversation History:**", f"**Conversation History:**\n{call_context_section}")
            elif "**近期对话上下文:**" in prompt:
                prompt = prompt.replace("**近期对话上下文:**", f"{call_context_section}\n**近期对话上下文:**")
        
        if call_context_section and "{{call_context}}" not in template and "**Conversation History:**" not in template and "**近期对话上下文:**" not in template:
            prompt += "\n" + call_context_section
        if "{{context}}" not in template:
            prompt += "\n**近期对话上下文:**\n" + formatted_context
        if last_call_info and "{{last_call_summary}}" not in template:
            prompt += "\n**上次已完成的通话（避免复述）:**\n" + last_call_summary + "\n" + followup_call_instructions
        prompt += "\n【称呼连续性】通话对象名称用于识别身份，不代表必须直呼其名。优先沿用近期对话中该角色对接听者实际使用的昵称、爱称或敬称，并遵循角色卡与世界书的关系设定；不要把 User、用户名或身份标签机械地念出来。若没有明确称呼依据，使用自然的第二人称，不要凭空编造昵称。\n"

        print(f"[PromptBuilder] 构建提示词: {len(prompt)} 字符, {message_count} 条消息, 发起人={effective_caller}, 接听人={effective_target}")
        
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
        max_context_messages: int = 20,
        eavesdrop_config: Dict = None,  # 分析 LLM 提供的对话主题和框架
        template: str = None,  # 支持传入自定义预设模板
        target: str = None,  # 目标/被讨论对象 (默认 user_name)
        theme: str = None,  # 对话主题
        call_reason: str = None,  # 剧情起因/动机
        call_tone: str = None,  # 氛围/张力
        character_persona: str = None,  # 人设补充
        world_info: str = None,  # 世界书/世界观补充
        story_summary: str = ""
    ) -> str:
        """
        构建对话追踪 Prompt
        
        Args:
            context: 对话上下文
            speakers_emotions: 说话人情绪映射 {speaker: [emotions]}
            user_name: 用户名
            text_lang: 文本语言
            max_context_messages: 最大上下文消息数
            eavesdrop_config: 分析 LLM 提供的对话主题、框架等配置
            template: 自定义 Prompt 模板 (工坊预设)
            target: 目标/被议论人名称 (默认 user_name)
            theme: 对话主题
            call_reason: 动机起因
            call_tone: 氛围张力
            character_persona: 人设补充 (从SillyTavern自动注入)
            world_info: 世界书/世界观设定 (从SillyTavern自动注入)
            
        Returns:
            格式化的对话追踪 Prompt
        """
        effective_target = (target or user_name or "用户").strip()
        
        # 限制上下文长度
        limited_context = context[-max_context_messages:] if context else []
        
        # 格式化上下文
        context_text = PromptBuilder._format_context(limited_context, user_name=effective_target)
        
        # 格式化说话人情绪
        speakers_emotions_text = ""
        speakers_list = []
        for speaker, emotions in speakers_emotions.items():
            speakers_list.append(speaker)
            emotions_str = ", ".join(emotions) if emotions else "neutral"
            speakers_emotions_text += f"- {speaker}: [{emotions_str}]\n"
        
        # 获取语言显示
        lang_info = PromptBuilder.LANG_MAP.get(text_lang, PromptBuilder.LANG_MAP["zh"])
        lang_name = lang_info["name"]
        lang_display = lang_info["display"]
        print(f"[PromptBuilder] [Lang] build_eavesdrop_prompt: text_lang={text_lang} -> lang_display={lang_display}")
        
        # 模板选择优先级：自定义传入 template > eavesdrop_config 增强版 > 基础版
        if template:
            prompt = template
            print(f"[PromptBuilder] 使用工坊自定义 eavesdrop 预设模板")
        elif eavesdrop_config:
            # 使用增强版模板（由分析 LLM 提供主题和框架）
            prompt = PromptBuilder.EAVESDROP_TEMPLATE_ENHANCED
            
            # 构建对话指导信息
            guidance_parts = []
            
            # 对话主题
            cfg_theme = theme or eavesdrop_config.get("conversation_theme")
            if cfg_theme:
                guidance_parts.append(f"**对话主题**: {cfg_theme}")
            
            # 对话大纲
            outline = eavesdrop_config.get("conversation_outline", [])
            if outline:
                outline_text = "\n".join([f"  {i+1}. {step}" for i, step in enumerate(outline)])
                guidance_parts.append(f"**对话大纲**:\n{outline_text}")
            
            # 戏剧张力
            tension = call_tone or eavesdrop_config.get("dramatic_tension")
            if tension:
                guidance_parts.append(f"**戏剧张力**: {tension}")
            
            # 隐藏信息（用户不知道的）
            hidden_info = eavesdrop_config.get("hidden_information")
            if hidden_info:
                guidance_parts.append(f"**可揭示的隐藏信息**: {hidden_info}")
            
            # 情绪弧线
            emotional_arc = eavesdrop_config.get("emotional_arc")
            if emotional_arc:
                guidance_parts.append(f"**情绪弧线**: {emotional_arc}")
            
            # 世界书与人设
            if character_persona:
                guidance_parts.append(f"**角色设定**: {character_persona}")
            if world_info:
                guidance_parts.append(f"**世界书背景**: {world_info}")
            
            eavesdrop_guidance = "\n\n".join(guidance_parts) if guidance_parts else ""
            prompt = prompt.replace("{{eavesdrop_guidance}}", eavesdrop_guidance)
            
            print(f"[PromptBuilder] 使用增强版 eavesdrop 模板，主题: {cfg_theme}")
        else:
            # 使用基础版模板
            prompt = PromptBuilder.EAVESDROP_TEMPLATE
            print(f"[PromptBuilder] 使用基础版 eavesdrop 模板")
        
        # 替换通用与扩展变量
        prompt = prompt.replace("{{context}}", context_text)
        prompt = prompt.replace("{{speakers}}", ", ".join(speakers_list))
        prompt = prompt.replace("{{speakers_emotions}}", speakers_emotions_text.strip())
        prompt = prompt.replace("{{user_name}}", effective_target)
        prompt = prompt.replace("{{user}}", effective_target)
        prompt = prompt.replace("{{target}}", effective_target)
        prompt = prompt.replace("{{receiver}}", effective_target)
        prompt = prompt.replace("{{theme}}", theme or (eavesdrop_config.get("conversation_theme") if eavesdrop_config else "私下密谈"))
        prompt = prompt.replace("{{call_reason}}", call_reason or theme or "私下交流")
        prompt = prompt.replace("{{call_tone}}", call_tone or "真实生动")
        prompt = prompt.replace("{{character_persona}}", character_persona or "符合角色个性")
        prompt = prompt.replace("{{world_info}}", world_info or "无特殊世界书设定")
        prompt = prompt.replace("{{story_summary}}", story_summary or "")
        prompt = prompt.replace("{{lang_name}}", lang_name)
        prompt = prompt.replace("{{lang_display}}", lang_display)
        prompt = prompt.replace("{{max_context_messages}}", str(max_context_messages))
        
        # 如果自定义模板中没有显式写 {{character_persona}}、{{world_info}} 或 {{story_summary}}，且传入了这些设定，则自动追加
        eavesdrop_extra_parts = []
        if character_persona and "{{character_persona}}" not in (template or ""):
            eavesdrop_extra_parts.append(f"- 角色卡人设: {character_persona}")
        if world_info and "{{world_info}}" not in (template or ""):
            eavesdrop_extra_parts.append(f"- 世界书/场景背景: {world_info}")
        if story_summary and "{{story_summary}}" not in (template or ""):
            eavesdrop_extra_parts.append(f"- 前情剧情总结: {story_summary}")
        
        if eavesdrop_extra_parts:
            extra_section = "\n**角色设定与世界书背景**:\n" + "\n".join(eavesdrop_extra_parts) + "\n"
            if "**对话历史参考**:" in prompt:
                prompt = prompt.replace("**对话历史参考**:", f"{extra_section}\n**对话历史参考**:")
            elif "**近期对话上下文:**" in prompt:
                prompt = prompt.replace("**近期对话上下文:**", f"{extra_section}\n**近期对话上下文:**")
            elif "**机密背景**:" in prompt:
                prompt = prompt.replace("**机密背景**:", f"**机密背景**:\n{extra_section}")
        
        # Apply to basic, automatic/enhanced and workshop templates alike.
        prompt += f"""

**配音原文与中文字幕逐段一致（输出前必须核对）**：
- 每个 segment 的 text 是唯一会送去配音的完整台词，必须使用{lang_display}；translation 仅用于显示简体中文字幕，不会被朗读。
- 先写完整 text，再只翻译这一段 text。两者的语义、信息量、分句顺序必须一一对应，不得摘要、扩写、补剧情、漏译或只翻译前半句。
- text 中每个分句（尤其最后一个分句）、否定、条件、转折、人物、称呼、数字与情绪语气，都必须在本段 translation 中有对应；translation 的任何信息也必须能在本段 text 中找到依据。
- 一段只放一个完整短句或紧密相连的短分句。长台词请拆成多个 segment，每段分别填写 speaker、emotion、text、translation；不得把多段的中文合并到某一段，也不得把其他说话人的台词或舞台动作写进译文。
- 如果 text 是中文，translation 必须与 text 完全相同。跨语言不要求字数相等，不要为了凑字数增加或删除意思。
- 例如 text 为「先に帰って。私はここで待つ。」时，translation 应为“你先回去。我在这里等。”；不得只配音「先に帰って。」却保留这两句中文字幕。
- 输出前逐段双向核对 text 与 translation，包括句尾；发现不一致时修正对应字段，再输出规定的 JSON。不要输出核对过程。
"""

        return prompt

