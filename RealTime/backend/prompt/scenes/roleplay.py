# 角色扮演场景

from typing import Optional
from ..base import BasePromptBuilder, PromptContext


class RoleplayBuilder(BasePromptBuilder):
    """
    角色扮演场景
    
    特点:
    - 完整支持角色人设
    - 保持角色身份一致性
    - 支持情境触发
    - 更丰富的情感表达
    """
    
    @property
    def scene_id(self) -> str:
        return "roleplay"
    
    @property
    def scene_name(self) -> str:
        return "角色扮演"
    
    def build_system_prompt(self, ctx: PromptContext) -> str:
        """构建系统提示词"""
        
        char_name = ctx.character_name or "角色"
        persona = ctx.character_persona or "一个有趣的角色"
        
        prompt = f"""你正在扮演 {char_name}。

【人设】
{persona}

【对话规则】
1. 始终保持 {char_name} 的身份，用第一人称说话
2. 回复简短自然，符合口语习惯，像真人说话
3. 只输出对话内容，不要输出动作描写、旁白或任何括号内容
4. 根据情境自然使用语气词和情绪表达
5. 每次回复控制在1-3句话，保持对话节奏"""
        
        # 场景描述
        if ctx.scenario:
            prompt += f"\n\n【当前情境】\n{ctx.scenario}"
        
        # 开场白参考（如果有）
        if ctx.first_message:
            prompt += f"\n\n【开场白参考】\n{ctx.first_message}"
        
        return prompt
    
    def build_user_prompt(self, ctx: PromptContext) -> str:
        """构建用户提示词"""
        return ctx.user_input
    
    def build_event_prompt(self, ctx: PromptContext, event_type: str) -> Optional[str]:
        """事件触发提示"""
        
        char_name = ctx.character_name or "你"
        
        if event_type == "silence_detected":
            return f"（沉默了一会儿，{char_name}想主动说点什么打破沉默）"
        
        if event_type == "greeting_trigger":
            return f"（{char_name}想主动和对方打个招呼或者说点什么）"
        
        if event_type == "mood_change":
            mood = ctx.extra_data.get("mood", "普通")
            return f"（{char_name}的心情变成了{mood}）"
        
        return None
    
    def format_history(self, history, max_turns: int = 10):
        """自定义历史格式化 - 使用角色名"""
        if not history:
            return ""
        
        lines = []
        for msg in history[-max_turns:]:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            
            # 角色扮演场景使用更自然的称呼
            if role == "user":
                lines.append(f"对方: {content}")
            elif role == "assistant":
                lines.append(f"你: {content}")
        
        return "\n".join(lines)
