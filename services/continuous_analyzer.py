"""
持续性分析服务

职责:
- 每 N 楼层自动触发分析
- 调用 LLM 分析场景变化
- 存储分析结果到数据库
- 追踪角色轨迹
- 集成活人感引擎
"""
import json
from typing import List, Dict, Optional
from database import DatabaseManager
from services.scene_analyzer import SceneAnalyzer
from services.live_character_engine import LiveCharacterEngine
from phone_call_utils.models import SceneAnalysisResult
from config import load_json, SETTINGS_FILE


class ContinuousAnalyzer:
    """持续性分析器 - 每楼层分析并记录角色状态"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.scene_analyzer = SceneAnalyzer()
        self.live_engine = LiveCharacterEngine()
        
        # 加载配置
        settings = load_json(SETTINGS_FILE)
        self.config = settings.get("continuous_analysis", {})
        
        # 默认配置
        self.enabled = self.config.get("enabled", True)
        self.analysis_interval = self.config.get("analysis_interval", 3)  # 每3楼层分析一次
        self.max_history_records = self.config.get("max_history_records", 100)
        self.llm_context_limit = self.config.get("llm_context_limit", 10)  # 发给LLM的历史记录数量
        
        print(f"[ContinuousAnalyzer] 初始化完成 - 启用: {self.enabled}, 间隔: {self.analysis_interval}")
    
    def should_analyze(self, floor: int) -> bool:
        """
        判断是否应该在当前楼层触发分析
        
        Args:
            floor: 当前楼层数
            
        Returns:
            True 表示应该分析
        """
        if not self.enabled:
            return False
        
        # 第1楼层总是分析
        if floor == 1:
            return True
        
        # 检查是否是间隔的倍数
        return floor % self.analysis_interval == 0
    
    async def analyze_and_record(
        self,
        chat_branch: str,
        floor: int,
        context: List[Dict],
        speakers: List[str],
        context_fingerprint: str,
        user_name: str = None,
        char_name: str = None  # 主角色卡名称，用于 WebSocket 路由
    ) -> Optional[Dict]:
        """
        执行分析并记录到数据库 (新版 - 使用LiveCharacterEngine)
        
        Args:
            chat_branch: 对话分支ID
            floor: 当前楼层
            context: 对话上下文
            speakers: 说话人列表
            context_fingerprint: 上下文指纹
            user_name: 用户名称
            
        Returns:
            分析结果或 None
        """
        try:
            print(f"[ContinuousAnalyzer] 开始分析楼层 {floor}: {chat_branch}")
            
            # 使用LiveCharacterEngine构建Prompt
            prompt = self.live_engine.build_analysis_prompt(context, speakers)
            
            print(f"[ContinuousAnalyzer] 活人感分析Prompt已构建,等待 LLM 响应...")
            
            # 返回数据供前端调用 LLM
            # 从 analysis_llm 配置读取 LLM 设置
            from config import load_json, SETTINGS_FILE
            settings = load_json(SETTINGS_FILE)
            analysis_llm = settings.get("analysis_llm", {})
            
            return {
                "type": "continuous_analysis_request",
                "chat_branch": chat_branch,
                "floor": floor,
                "context_fingerprint": context_fingerprint,
                "speakers": speakers,
                "user_name": user_name,  # 添加用户名用于 Prompt 构建
                "char_name": char_name,  # 主角色卡名称用于 WebSocket 路由
                "prompt": prompt,
                "llm_config": {
                    "api_url": analysis_llm.get("api_url", ""),
                    "api_key": analysis_llm.get("api_key", ""),
                    "model": analysis_llm.get("model", ""),
                    "temperature": analysis_llm.get("temperature", 0.8),
                    "max_tokens": analysis_llm.get("max_tokens", 2000)
                }
            }

            
        except Exception as e:
            print(f"[ContinuousAnalyzer] 分析失败: {e}")
            return None
    
    def save_analysis_result(
        self,
        chat_branch: str,
        floor: int,
        context_fingerprint: str,
        llm_response: str,
        speakers: List[str]
    ) -> Dict:
        """
        保存 LLM 分析结果到数据库 (统一版 - 含触发判断)
        
        Args:
            chat_branch: 对话分支ID
            floor: 楼层数
            context_fingerprint: 上下文指纹
            llm_response: LLM 原始响应
            speakers: 说话人列表
            
        Returns:
            保存结果，包含 success, record_id, scene_trigger 等
        """
        try:
            # 使用LiveCharacterEngine解析LLM响应 (新格式含 character_states 和 scene_trigger)
            parsed_result = self.live_engine.parse_llm_response(llm_response)
            
            if not parsed_result:
                print(f"[ContinuousAnalyzer] ⚠️ LLM响应解析失败")
                return {"success": False, "error": "LLM响应解析失败"}
            
            # 提取角色状态和触发建议
            character_states = parsed_result.get("character_states", {})
            scene_trigger = parsed_result.get("scene_trigger", {})
            
            # 提取触发信息
            suggested_action = scene_trigger.get("suggested_action", "none")
            trigger_reason = scene_trigger.get("reason", "")
            character_left = scene_trigger.get("character_left")
            
            print(f"[ContinuousAnalyzer] 📊 分析结果: action={suggested_action}, reason={trigger_reason}")
            
            # 向后兼容:构建旧格式的characters_data
            characters_data = {}
            for speaker, state in character_states.items():
                physical = state.get("physical", {})
                emotional = state.get("emotional", {})
                cognitive = state.get("cognitive", {})
                
                char_data = {
                    "present": physical.get("location") != "离场",
                    "location": physical.get("location", "未知"),
                    "emotion": emotional.get("current", "未知"),
                    "intent": None
                }
                
                # 提取意图
                desires = cognitive.get("desires", [])
                if desires:
                    char_data["intent"] = desires[0] if isinstance(desires, list) else desires
                
                characters_data[speaker] = char_data
            
            # 生成简短摘要(专门给LLM用)
            summary = self.live_engine.generate_summary(character_states)
            
            # 构建场景摘要
            scene_summary = self._build_scene_summary(character_states)
            
            # 保存到数据库 (包含触发字段)
            record_id = self.db.add_analysis_record(
                chat_branch=chat_branch,
                context_fingerprint=context_fingerprint,
                floor=floor,
                characters_data=characters_data,
                scene_summary=scene_summary,
                raw_llm_response=llm_response,
                summary=summary,
                character_states=character_states,
                suggested_action=suggested_action,
                trigger_reason=trigger_reason,
                character_left=character_left
            )
            
            if record_id:
                print(f"[ContinuousAnalyzer] ✅ 分析记录已保存: ID={record_id}, 楼层={floor}")
                
                # 优先使用分析 LLM 返回的 characters_present（而非二次提取）
                characters_present = scene_trigger.get("characters_present", [])
                if not characters_present:
                    # 后备：从 characters_data 中提取
                    characters_present = [
                        char_name for char_name, char_data in characters_data.items()
                        if char_data.get("present", False)
                    ]
                
                # 提取 eavesdrop 配置（由分析 LLM 提供的对话主题和框架）
                eavesdrop_config = scene_trigger.get("eavesdrop_config", {})
                
                print(f"[ContinuousAnalyzer] 📍 在场角色: {characters_present}")
                if eavesdrop_config:
                    print(f"[ContinuousAnalyzer] 🎭 对话主题: {eavesdrop_config.get('conversation_theme', '未指定')}")
                
                # 状态已保存，触发逻辑由上层 (routers/continuous_analysis.py) 根据 scene_trigger 处理
                # 不在这里遍历触发每个角色的 potential_actions
                
                return {
                    "success": True,
                    "record_id": record_id,
                    "scene_trigger": scene_trigger,
                    "suggested_action": suggested_action,
                    "character_left": character_left,
                    "trigger_reason": trigger_reason,
                    "present_characters": characters_present,  # ✅ 来自分析 LLM
                    "eavesdrop_config": eavesdrop_config  # ✅ 对话主题和框架
                }
            else:
                print(f"[ContinuousAnalyzer] ⚠️ 记录已存在或保存失败: 楼层={floor}")
                return {"success": False, "error": "记录已存在或保存失败"}
                
        except Exception as e:
            print(f"[ContinuousAnalyzer] ❌ 保存失败: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(e)}
    

    def _build_scene_summary(self, character_states: Dict) -> str:
        """构建场景摘要"""
        present_chars = []
        absent_chars = []
        
        for char_name, state in character_states.items():
            physical = state.get("physical", {})
            location = physical.get("location", "")
            
            if "离场" in location or location == "":
                absent_chars.append(char_name)
            else:
                present_chars.append(char_name)
        
        summary_parts = []
        if present_chars:
            summary_parts.append(f"在场: {', '.join(present_chars)}")
        if absent_chars:
            summary_parts.append(f"离场: {', '.join(absent_chars)}")
        
        return "; ".join(summary_parts)
    
    def _evaluate_and_trigger_actions(
        self,
        character_states: Dict,
        chat_branch: str,
        floor: int
    ):
        """评估并触发角色行动"""
        from services.action_handlers import ActionHandlerRegistry
        
        handler_registry = ActionHandlerRegistry()
        
        for char_name, state in character_states.items():
            triggered_actions = self.live_engine.evaluate_character_actions(
                character_name=char_name,
                character_state=state,
                chat_branch=chat_branch,
                current_floor=floor
            )
            
            for action in triggered_actions:
                action_type = action.get("type")
                print(f"[ContinuousAnalyzer] 🎯 触发行动: {char_name} - {action_type}")
                
                # 调用对应的处理器
                result = handler_registry.handle(action_type, action, state)
                
                if result.get("success"):
                    print(f"[ContinuousAnalyzer] ✅ 行动处理成功: {action_type}")
                else:
                    print(f"[ContinuousAnalyzer] ❌ 行动处理失败: {action_type}")

    
    def get_character_trajectory(self, chat_branch: str, character_name: str, limit: int = None) -> List[Dict]:
        """
        获取角色的历史轨迹 (智能筛选,用于LLM)
        
        Args:
            chat_branch: 对话分支ID
            character_name: 角色名称
            limit: 返回记录数量限制(None使用llm_context_limit)
            
        Returns:
            角色历史轨迹列表(压缩版,只包含关键信息)
        """
        if limit is None:
            limit = self.llm_context_limit
        
        # 获取原始历史
        history = self.db.get_character_history(chat_branch, character_name, limit)
        
        # 压缩数据(只保留关键信息)
        compressed = []
        for record in history:
            compressed.append({
                "floor": record.get("floor"),
                "location": record.get("location", "未知"),
                "emotion": record.get("emotion", "未知"),
                "intent": record.get("intent")
            })
        
        return compressed
    
    def get_latest_states(self, chat_branch: str) -> Optional[Dict]:
        """
        获取最新的角色状态
        
        Args:
            chat_branch: 对话分支ID
            
        Returns:
            最新的分析记录或 None
        """
        return self.db.get_latest_analysis(chat_branch)
