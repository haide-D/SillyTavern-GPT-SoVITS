"""
场景分析服务

用于分析对话上下文，判断是否应该触发电话或对话追踪
"""
import json
from typing import List, Dict, Optional
from config import load_json, SETTINGS_FILE
from phone_call_utils.prompt_builder import PromptBuilder
from phone_call_utils.models import SceneAnalysisResult


class SceneAnalyzer:
    """场景分析器 - 判断当前场景状态"""
    
    def __init__(self):
        self.prompt_builder = PromptBuilder()
    
    def build_prompt(
        self,
        context: List[Dict],
        speakers: List[str],
        max_context_messages: int = 10,
        user_name: str = None,
        call_history: List[Dict] = None
    ) -> Dict:
        """
        构建场景分析 Prompt
        
        Args:
            context: 对话上下文
            speakers: 可用角色列表
            max_context_messages: 最大上下文消息数
            user_name: 用户名称
            call_history: 近期通话历史记录
            
        Returns:
            包含 prompt、llm_config 的字典
        """
        print(f"[SceneAnalyzer] 构建场景分析 Prompt: {len(context)}条上下文, {len(speakers)}个角色")
        if call_history:
            print(f"[SceneAnalyzer] 检测到 {len(call_history)} 条通话历史记录")
        
        # 构建场景分析 Prompt
        prompt = self.prompt_builder.build_scene_analysis_prompt(
            context=context,
            speakers=speakers,
            max_context_messages=max_context_messages,
            user_name=user_name,
            call_history=call_history
        )
        
        # 读取 LLM 配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        llm_config = phone_call_config.get("llm", {})
        
        print(f"[SceneAnalyzer] ✅ Prompt 构建完成: {len(prompt)} 字符")
        
        return {
            "prompt": prompt,
            "llm_config": {
                "api_url": llm_config.get("api_url"),
                "api_key": llm_config.get("api_key"),
                "model": llm_config.get("model"),
                "temperature": 0.3,  # 场景分析使用低温度
                "max_tokens": 500    # 分析结果不需要太长
            }
        }
    
    async def analyze(
        self,
        context: List[Dict],
        speakers: List[str],
        max_context_messages: int = 10,
        char_name: str = None,
        user_name: str = None,
        call_history: List[Dict] = None
    ) -> Dict:
        """
        构建场景分析请求（异步版）
        
        由于 LLM 需要通过前端调用，此方法只构建 prompt 和配置，
        实际分析需要前端调用 LLM 后通过 /api/scene_analysis/complete 返回结果
        
        Args:
            context: 对话上下文
            speakers: 可用角色列表
            max_context_messages: 用于分析的最大上下文消息数
            char_name: 主角色名称
            user_name: 用户名称
            call_history: 近期通话历史记录
            
        Returns:
            包含 prompt、llm_config 的字典，供 NotificationService 使用
        """
        print(f"[SceneAnalyzer] 构建场景分析请求: {len(context)}条上下文, {len(speakers)}个角色")
        if call_history:
            print(f"[SceneAnalyzer] 检测到 {len(call_history)} 条通话历史记录")
        
        # 构建场景分析 Prompt
        prompt = self.prompt_builder.build_scene_analysis_prompt(
            context=context,
            speakers=speakers,
            max_context_messages=max_context_messages,
            user_name=user_name,
            call_history=call_history
        )
        
        # 读取 LLM 配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        llm_config = phone_call_config.get("llm", {})
        
        print(f"[SceneAnalyzer] ✅ 场景分析 Prompt 构建完成: {len(prompt)} 字符")
        
        return {
            "prompt": prompt,
            "llm_config": {
                "api_url": llm_config.get("api_url"),
                "api_key": llm_config.get("api_key"),
                "model": llm_config.get("model"),
                "temperature": 0.3,  # 场景分析使用低温度确保稳定性
                "max_tokens": 500    # 分析结果不需要太长
            },
            "speakers": speakers
        }
    
    def parse_llm_response(self, response: str, speakers: List[str]) -> SceneAnalysisResult:
        """
        解析 LLM 响应（供前端调用 LLM 后使用）
        
        Args:
            response: LLM 响应文本
            speakers: 可用角色列表
            
        Returns:
            SceneAnalysisResult
        """
        try:
            # 尝试提取 JSON
            json_str = self._extract_json(response)
            if json_str:
                data = json.loads(json_str)
                
                # 验证 characters_present
                chars_present = data.get("characters_present", [])
                valid_chars = [c for c in chars_present if c in speakers]
                
                # 验证 character_left
                char_left = data.get("character_left")
                if char_left and char_left not in speakers:
                    char_left = None
                
                return SceneAnalysisResult(
                    characters_present=valid_chars if valid_chars else speakers,
                    character_left=char_left,
                    private_conversation_likely=data.get("private_conversation_likely", False),
                    suggested_action=data.get("suggested_action", "none"),
                    reason=data.get("reason", "未提供原因")
                )
        except json.JSONDecodeError as e:
            print(f"[SceneAnalyzer] JSON解析失败: {e}")
        
        # 解析失败时返回默认值
        return SceneAnalysisResult(
            characters_present=speakers,
            character_left=None,
            private_conversation_likely=False,
            suggested_action="none",
            reason="响应解析失败"
        )
    
    def _extract_json(self, text: str) -> Optional[str]:
        """从文本中提取 JSON"""
        import re
        
        # 匹配 ```json ... ```
        json_block_pattern = r'```json\s*\n(.*?)\n```'
        match = re.search(json_block_pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()
        
        # 匹配 ``` ... ```
        code_block_pattern = r'```\s*\n(.*?)\n```'
        match = re.search(code_block_pattern, text, re.DOTALL)
        if match:
            content = match.group(1).strip()
            if content.startswith('{'):
                return content
        
        # 直接查找 JSON 对象
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1 and end > start:
            return text[start:end+1]
        
        return None
