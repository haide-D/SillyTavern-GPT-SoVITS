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
    
    # 默认 JSON 格式 Prompt 模板
    DEFAULT_JSON_TEMPLATE = """You are an AI assistant helping to determine which character should make a phone call based on the conversation context.必须模仿电话的这种形式，电话内容必须合理且贴切，必须要有一件或者多个电话主题，围绕这个主题展开电话内容。不可以脱离当前的场景。

**Available Speakers and Their Emotions:**
{{speakers_emotions}}

**Conversation History:**
{{context}}

**Your Task:**
1. Analyze the conversation context
2. Determine which speaker should make the phone call
3. Generate appropriate phone call content with emotional segments

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
        user_name: str = None  # 新增: 用户名，用于区分用户身份
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
        
        print(f"[PromptBuilder] 构建提示词: {len(prompt)} 字符, {message_count} 条消息, {len(speakers)} 个说话人")
        
        return prompt
    
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
    def _format_context(context: List[Dict], extract_tag: str = "", filter_tags: str = "", user_name: str = None) -> str:
        """
        格式化上下文为文本
        
        Args:
            context: 对话上下文,标准格式 [{"role": "user"|"assistant"|"system", "content": "..."}]
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
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            
            # 应用提取和过滤
            if content:
                content = MessageFilter.extract_and_filter(content, extract_tag, filter_tags)
            
            # 使用英文标签和 emoji，如果有用户名则使用用户名
            if role == 'user':
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
