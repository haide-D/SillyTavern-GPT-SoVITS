from typing import List, Dict
from datetime import datetime


class PromptBuilder:
    """提示词构建工具"""
    
    # 默认 JSON 格式 Prompt 模板
    DEFAULT_JSON_TEMPLATE = """You are {{char_name}}, making a phone call to the user.可以完全忽略历史记录,现在只是测试,你扮演一个有魅力,说话很骚气的男角色。说的话要符合你的身份,要那种高高在上的命令式口吻。你是主动打电话的那一方，对当前的场景对用户进行询问或者是有事情。

Conversation history:
{{context}}

Available emotions: {{emotions}}

**IMPORTANT**: Respond ONLY with valid JSON in this exact format:

```json
{
  "segments": [
    {
      "emotion": "emotion_tag",
      "text": "what to say,必须英文回复txt",
      "pause_after": 0.8,
      "speed": 1.0,
      "filler_word": null
    }
  ]
}
```

**Field requirements**:
- emotion: must be one of {{emotions}},但是不一定要全部使用,按照当前场景选择合适的。
- text: what to say in English, make it natural and emotional
  * Keep each segment SHORT and NATURAL - don't force long sentences
  * Use multiple short segments instead of one long segment
- pause_after: pause duration after this segment (0.2-1.2 seconds, null for default 0.3s)
  * Use longer pauses (0.7-1.2s) for major emotion transitions
  * Use medium pauses (0.4-0.6s) for minor transitions
  * Use short pauses (0.2-0.3s) for same emotion
- speed: speech speed multiplier (0.9-1.2, null for default 1.0)
  * Use faster (1.1-1.2) for excited/happy emotions
  * Use slower (0.9-1.0) for sad/thoughtful emotions
  * **CRITICAL - Speed Transition Rule**: When speed changes significantly (≥0.3 difference), 
    insert a transition segment with speed=1.0 between them to make the change smooth.
    Example: If going from speed 0.8 → 1.2, insert a 1.0 speed segment in between.
- filler_word: 

**Generate 6-7 segments** that sound natural and emotionally expressive. You are a charismatic male character. Make the conversation engaging!
**Remember**: Use NATURAL phrases. When changing speed dramatically, add a neutral-speed transition segment."""
    
    @staticmethod
    def build(
        template: str = None,  # 如果为 None,使用默认模板
        char_name: str = "", 
        context: List[Dict] = None, 
        extracted_data: Dict = None, 
        emotions: List[str] = None,
        max_context_messages: int = 20
    ) -> str:
        """
        构建LLM提示词
        
        Args:
            template: 提示词模板
            char_name: 角色名称
            context: 对话上下文
            extracted_data: 提取的数据
            emotions: 可用情绪列表
            max_context_messages: 最大上下文消息数(默认10)
            
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
        
        # 如果没有提供模板,使用默认 JSON 模板
        if template is None or template == "":
            template = PromptBuilder.DEFAULT_JSON_TEMPLATE
            print(f"[PromptBuilder] 使用默认 JSON 模板")
        
        # 限制上下文长度
        limited_context = context[-max_context_messages:] if len(context) > max_context_messages else context
        
        # 格式化各部分数据
        formatted_context = PromptBuilder._format_context(limited_context)
        formatted_data = PromptBuilder._format_extracted_data(extracted_data)
        formatted_emotions = ", ".join(emotions)
        
        # 内置变量
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M")
        message_count = len(context)
        recent_message_count = len(limited_context)
        
        # 替换模板变量
        prompt = template
        prompt = prompt.replace("{{char_name}}", char_name)
        prompt = prompt.replace("{{context}}", formatted_context)
        prompt = prompt.replace("{{extracted_data}}", formatted_data)
        prompt = prompt.replace("{{emotions}}", formatted_emotions)
        prompt = prompt.replace("{{current_time}}", current_time)
        prompt = prompt.replace("{{message_count}}", str(message_count))
        prompt = prompt.replace("{{recent_message_count}}", str(recent_message_count))
        
        print(f"[PromptBuilder] 构建提示词: {len(prompt)} 字符, {message_count} 条消息, {len(emotions)} 个情绪")
        
        return prompt
    
    @staticmethod
    def _format_context(context: List[Dict]) -> str:
        """
        格式化上下文为文本
        
        Args:
            context: 对话上下文
            
        Returns:
            格式化的文本
        """
        if not context:
            return "暂无对话历史"
        
        lines = []
        for i, msg in enumerate(context, 1):
            role = "用户" if msg["role"] == "user" else "角色"
            content = msg["content"]
            lines.append(f"{i}. {role}: {content}")
        
        return "\n".join(lines)
    
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
