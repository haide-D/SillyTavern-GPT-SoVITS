"""
智能触发决策引擎

职责:
- 从数据库读取历史分析记录
- 基于多因素综合评分
- 决定是否触发电话
"""
from typing import List, Dict, Optional
from datetime import datetime
from database import DatabaseManager
from config import load_json, SETTINGS_FILE


class SmartTriggerEngine:
    """智能触发决策引擎 - 基于历史数据综合判断触发时机"""
    
    def __init__(self):
        self.db = DatabaseManager()
        
        # 加载配置
        settings = load_json(SETTINGS_FILE)
        self.config = settings.get("smart_trigger", {})
        
        # 默认配置
        self.enabled = self.config.get("enabled", True)
        self.scoring_weights = self.config.get("scoring", {
            "time_weight": 20,
            "emotion_weight": 30,
            "intent_weight": 40,
            "trajectory_weight": 10
        })
        self.threshold = self.config.get("threshold", 60)
        
        print(f"[SmartTriggerEngine] 初始化完成 - 阈值: {self.threshold}, 权重: {self.scoring_weights}")
    
    def should_trigger_call(
        self,
        chat_branch: str,
        character_name: str,
        current_floor: int
    ) -> tuple[bool, str, int]:
        """
        判断是否应该触发电话
        
        Args:
            chat_branch: 对话分支ID
            character_name: 角色名称
            current_floor: 当前楼层
            
        Returns:
            (是否触发, 触发原因, 评分)
        """
        if not self.enabled:
            return False, "智能触发功能未启用", 0
        
        try:
            # 获取角色历史轨迹 - 使用命名参数（兼容指纹查询）
            history = self.db.get_character_history(character_name=character_name, limit=10, chat_branch=chat_branch)
            
            if not history:
                return False, "无历史数据", 0
            
            # 获取最近一次状态
            latest_state = history[0]
            
            # 如果角色在场,不触发
            if latest_state.get("present", False):
                return False, "角色在场", 0
            
            # 综合评分
            score = self._calculate_score(latest_state, history, current_floor)
            
            # 判断是否达到阈值
            if score >= self.threshold:
                reason = self._build_trigger_reason(latest_state, score)
                return True, reason, score
            else:
                return False, f"评分不足 ({score}/{self.threshold})", score
                
        except Exception as e:
            print(f"[SmartTriggerEngine] 评估失败: {e}")
            return False, f"评估失败: {str(e)}", 0
    
    def _calculate_score(self, latest_state: Dict, history: List[Dict], current_floor: int) -> int:
        """
        综合评分算法
        
        评分因素:
        1. 离场时间 (time_weight)
        2. 情绪强度 (emotion_weight)
        3. 明确意图 (intent_weight)
        4. 轨迹合理性 (trajectory_weight)
        
        Args:
            latest_state: 最近一次状态
            history: 历史状态列表
            current_floor: 当前楼层
            
        Returns:
            总评分 (0-100)
        """
        total_score = 0
        
        # 1. 离场时间评分
        time_score = self._score_absence_time(latest_state, current_floor)
        total_score += time_score * self.scoring_weights.get("time_weight", 20) / 100
        
        # 2. 情绪强度评分
        emotion_score = self._score_emotion(latest_state)
        total_score += emotion_score * self.scoring_weights.get("emotion_weight", 30) / 100
        
        # 3. 意图评分
        intent_score = self._score_intent(latest_state)
        total_score += intent_score * self.scoring_weights.get("intent_weight", 40) / 100
        
        # 4. 轨迹合理性评分
        trajectory_score = self._score_trajectory(latest_state, history)
        total_score += trajectory_score * self.scoring_weights.get("trajectory_weight", 10) / 100
        
        return int(total_score)
    
    def _score_absence_time(self, state: Dict, current_floor: int) -> int:
        """
        离场时间评分 (0-100)
        
        基于离场楼层数:
        - 刚离场 (1-2楼层): 0分
        - 短时间离场 (3-5楼层): 50分
        - 较长时间离场 (6+楼层): 100分
        """
        floor = state.get("floor", 0)
        floors_since_left = current_floor - floor
        
        if floors_since_left <= 2:
            return 0
        elif floors_since_left <= 5:
            return 50
        else:
            return 100
    
    def _score_emotion(self, state: Dict) -> int:
        """
        情绪强度评分 (0-100)
        
        基于情绪关键词:
        - 强烈情绪 (委屈, 难过, 生气): 100分
        - 中等情绪 (担心, 疑惑): 50分
        - 平淡情绪 (平静, 未知): 0分
        """
        emotion = state.get("emotion", "未知")
        
        strong_emotions = ["委屈", "难过", "生气", "愤怒", "伤心", "痛苦"]
        medium_emotions = ["担心", "疑惑", "焦虑", "不安"]
        
        if any(e in emotion for e in strong_emotions):
            return 100
        elif any(e in emotion for e in medium_emotions):
            return 50
        else:
            return 0
    
    def _score_intent(self, state: Dict) -> int:
        """
        意图评分 (0-100)
        
        基于意图关键词:
        - 明确想打电话: 100分
        - 想联系/沟通: 80分
        - 其他: 0分
        """
        intent = state.get("intent", "")
        
        if not intent:
            return 0
        
        call_keywords = ["打电话", "联系", "通话", "拨打"]
        contact_keywords = ["想说", "想问", "沟通", "交流"]
        
        if any(keyword in intent for keyword in call_keywords):
            return 100
        elif any(keyword in intent for keyword in contact_keywords):
            return 80
        else:
            return 0
    
    def _score_trajectory(self, latest_state: Dict, history: List[Dict]) -> int:
        """
        轨迹合理性评分 (0-100)
        
        基于轨迹特征:
        - 位置明确 (不是"未知"): 100分
        - 位置未知: 0分
        """
        location = latest_state.get("location", "未知")
        
        if location and location != "未知" and location != "离场":
            return 100
        else:
            return 0
    
    def _build_trigger_reason(self, state: Dict, score: int) -> str:
        """
        构建触发原因说明
        
        Args:
            state: 角色状态
            score: 评分
            
        Returns:
            原因说明
        """
        reasons = []
        
        emotion = state.get("emotion", "未知")
        intent = state.get("intent")
        location = state.get("location", "未知")
        
        if emotion != "未知":
            reasons.append(f"情绪: {emotion}")
        
        if intent:
            reasons.append(f"意图: {intent}")
        
        if location and location != "未知":
            reasons.append(f"位置: {location}")
        
        reason_text = "、".join(reasons) if reasons else "综合评估"
        return f"[评分: {score}] {reason_text}"
