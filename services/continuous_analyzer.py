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
        
        # 加载配置 - 从 analysis_engine 读取
        settings = load_json(SETTINGS_FILE)
        self.config = settings.get("analysis_engine", {})
        
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
            
            # 从 context 中提取历史消息指纹列表
            fingerprints = []
            for msg in context:
                fp = msg.get("fingerprint") or msg.get("fp")
                if fp:
                    fingerprints.append(fp)
            
            # 查询历史通话记录（优先用指纹，支持跨分支匹配）
            call_history = []
            if fingerprints:
                call_history = self.db.get_auto_call_history_by_fingerprints(fingerprints, limit=5)
                if call_history:
                    print(f"[ContinuousAnalyzer] 📞 根据指纹查询到 {len(call_history)} 条通话历史")
            
            if not call_history:
                # 回退：用 chat_branch 查询
                call_history = self.db.get_auto_call_history_by_chat_branch(chat_branch, limit=5)
                if call_history:
                    print(f"[ContinuousAnalyzer] 📞 根据分支查询到 {len(call_history)} 条通话历史")
            
            # 查询历史分析记录（获取离场角色等信息）
            last_analysis = self.db.get_latest_analysis(chat_branch)
            if last_analysis:
                print(f"[ContinuousAnalyzer] 📊 查询到最近分析记录: 楼层={last_analysis.get('floor')}")
            
            # 使用LiveCharacterEngine构建Prompt（传入通话历史和分支ID）
            prompt = self.live_engine.build_analysis_prompt(context, speakers, call_history, chat_branch)
            
            print(f"[ContinuousAnalyzer] 活人感分析Prompt已构建,等待 LLM 响应...")
            
            # 返回数据供前端调用 LLM
            # 从 analysis_engine.llm 配置读取 LLM 设置
            from config import load_json, SETTINGS_FILE
            settings = load_json(SETTINGS_FILE)
            analysis_llm = settings.get("analysis_engine", {}).get("llm", {})
            
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
            
            # ✅ 解析失败时的错误处理和重试机制
            if not parsed_result:
                print(f"[ContinuousAnalyzer] ⚠️ LLM响应首次解析失败，打印完整响应：")
                print("=" * 60)
                print(llm_response)
                print("=" * 60)
                
                # 尝试预处理后重试
                print(f"[ContinuousAnalyzer] 🔄 尝试重试解析...")
                
                # 尝试提取 JSON 部分后重试
                import re
                json_match = re.search(r'\{[\s\S]*\}', llm_response)
                if json_match:
                    retry_response = json_match.group(0)
                    parsed_result = self.live_engine.parse_llm_response(retry_response)
                
                if not parsed_result:
                    error_msg = "LLM响应解析失败（已重试）"
                    print(f"[ContinuousAnalyzer] ❌ {error_msg}")
                    # 截取响应前500字符用于前端显示
                    preview = llm_response[:500] if len(llm_response) > 500 else llm_response
                    return {
                        "success": False, 
                        "error": error_msg,
                        "error_type": "parse_error",
                        "llm_response_preview": preview,
                        "llm_response_length": len(llm_response)
                    }
                else:
                    print(f"[ContinuousAnalyzer] ✅ 重试解析成功")
            
            # 提取角色状态和触发建议
            character_states = parsed_result.get("character_states", {})
            scene_trigger = parsed_result.get("scene_trigger", {})
            
            # 提取触发信息
            suggested_action = scene_trigger.get("suggested_action", "none")
            trigger_reason = scene_trigger.get("reason", "")
            character_left = scene_trigger.get("character_left")  # 保持向后兼容
            
            # 提取电话触发详情（新格式）
            phone_call_details = scene_trigger.get("phone_call_details") or {}  # ✅ 修复: 处理 null 值
            # 新格式优先，兼容旧格式 character_left
            caller = phone_call_details.get("caller") or character_left
            call_reason = phone_call_details.get("call_reason") or trigger_reason
            call_tone = phone_call_details.get("call_tone", "")
            
            print(f"[ContinuousAnalyzer] 📊 分析结果: action={suggested_action}")
            if suggested_action == "phone_call" and caller:
                print(f"[ContinuousAnalyzer] 📞 电话详情: caller={caller}, reason={call_reason}, tone={call_tone}")
            
            # ✅ 新增: 评分系统二次验证
            score_result = None
            original_action = suggested_action
            
            if suggested_action != "none":
                # 查询触发历史用于评分
                trigger_history = self.db.get_recent_trigger_history(
                    chat_branch=chat_branch, 
                    limit=5
                )
                
                # 调用评分系统
                score_result = self.live_engine.calculate_scene_trigger_score(
                    suggested_action=suggested_action,
                    character_states=character_states,
                    trigger_history=trigger_history,
                    scene_trigger=scene_trigger
                )
                
                print(f"[ContinuousAnalyzer] 🎯 评分验证: {score_result.get('reason')}")
                
                # 如果评分不足，降级为 none
                if not score_result.get("should_trigger", False):
                    suggested_action = "none"
                    trigger_reason = f"[降级] {score_result.get('reason')}"
                    print(f"[ContinuousAnalyzer] ⚠️ 评分 {score_result.get('score')} 不足，{original_action} → none")
            
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
                    "original_action": original_action,  # LLM 原始建议
                    "score_result": score_result,  # 评分详情
                    "caller": caller,  # 打电话的角色（新格式或兼容旧格式）
                    "call_reason": call_reason,  # 打电话原因
                    "call_tone": call_tone,  # 通话氛围
                    "trigger_reason": trigger_reason,
                    "present_characters": characters_present,
                    "character_left": character_left,  # ✅ 修复: 添加离场角色
                    "eavesdrop_config": eavesdrop_config
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

    
    def get_character_trajectory(self, character_name: str, limit: int = None, 
                                    chat_branch: str = None, fingerprints: List[str] = None) -> List[Dict]:
        """
        获取角色的历史轨迹 (智能筛选,用于LLM)
        
        Args:
            character_name: 角色名称
            limit: 返回记录数量限制(None使用llm_context_limit)
            chat_branch: 对话分支ID (已弃用，仅作后备)
            fingerprints: 上下文指纹列表 (优先使用)
            
        Returns:
            角色历史轨迹列表(压缩版,只包含关键信息)
        """
        if limit is None:
            limit = self.llm_context_limit
        
        # 获取原始历史 - 优先使用指纹
        history = self.db.get_character_history(
            character_name=character_name, 
            limit=limit, 
            chat_branch=chat_branch, 
            fingerprints=fingerprints
        )
        
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
