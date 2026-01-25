# 通用聊天场景

from typing import Optional
from ..base import BasePromptBuilder, PromptContext


class CasualChatBuilder(BasePromptBuilder):
    """
    通用聊天场景
    
    特点:
    - 简洁自然的对话风格
    - 适合日常闲聊
    - 支持基础的事件触发
    """
    
    @property
    def scene_id(self) -> str:
        return "casual_chat"
    
    @property
    def scene_name(self) -> str:
        return "通用聊天"
    
    def build_system_prompt(self, ctx: PromptContext) -> str:
        """构建系统提示词"""
        
        # 基础人设
        char_name = ctx.character_name or "助手"
        persona = ctx.character_persona or "亲切、自然、像真人一样说话"
        
        prompt = f"""你是 {char_name}。

【人设】
{persona}

【对话规则】
1. 回复简短自然，像真人聊天一样
2. 只输出对话内容，不要输出动作描写、旁白或括号内容
3. 根据对话氛围适当使用语气词
4. 每次回复控制在1-3句话"""
        
        # 如果有场景描述，添加进去
        if ctx.scenario:
            prompt += f"\n\n【场景】\n{ctx.scenario}"
        
        return prompt
    
    def build_user_prompt(self, ctx: PromptContext) -> str:
        """构建用户提示词"""
        return ctx.user_input
    
    def build_event_prompt(self, ctx: PromptContext, event_type: str) -> Optional[str]:
        """事件触发提示"""
        
        if event_type == "silence_detected":
            return "（对话安静了一会儿，你想说点什么活跃气氛）"
        
        if event_type == "greeting_trigger":
            return "（你想主动打个招呼）"
        
        return None
