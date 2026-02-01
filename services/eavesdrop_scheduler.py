"""
对话追踪调度器
管理对话追踪任务的调度、防重复和异步执行
"""

import asyncio
from typing import List, Dict, Optional
from datetime import datetime
from database import DatabaseManager
from services.eavesdrop_service import EavesdropService
from config import load_json, SETTINGS_FILE


class EavesdropScheduler:
    """
    对话追踪调度器 - 管理对话追踪任务,防重复,异步执行
    """
    
    def __init__(self):
        self.db = DatabaseManager()
        self.eavesdrop_service = EavesdropService()
        self._running_tasks = set()  # 正在执行的任务 (task_key)
    
    async def schedule_eavesdrop(
        self, 
        chat_branch: str, 
        speakers: List[str], 
        trigger_floor: int, 
        context: List[Dict], 
        context_fingerprint: str,
        user_name: str = None,
        char_name: str = None,
        scene_description: str = None,
        eavesdrop_config: Dict = None  # 分析 LLM 提供的对话主题和框架
    ) -> Optional[int]:
        """
        调度对话追踪任务
        
        Args:
            chat_branch: 对话分支ID
            speakers: 说话人列表
            trigger_floor: 触发楼层
            context: 对话上下文
            context_fingerprint: 上下文指纹
            user_name: 用户名
            char_name: 主角色卡名称，用于 WebSocket 推送路由
            scene_description: 场景描述
            eavesdrop_config: 分析 LLM 提供的对话主题、框架等配置
            
        Returns:
            记录ID,如果已存在或正在执行则返回 None
        """
        # 使用指纹作为任务标识
        task_key = f"eavesdrop#{chat_branch}#{context_fingerprint}"
        
        # 检查是否正在执行
        if task_key in self._running_tasks:
            print(f"[EavesdropScheduler] 任务已在执行中: {task_key[:50]}")
            return None
        
        # 检查数据库是否已生成
        if self.db.is_eavesdrop_generated(chat_branch, context_fingerprint):
            print(f"[EavesdropScheduler] 该上下文已生成过: {chat_branch}#{context_fingerprint[:8]}")
            return None
        
        # 检查是否存在卡住的记录
        conn = self.db._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT id, status FROM eavesdrop_records WHERE chat_branch = ? AND context_fingerprint = ?",
                (chat_branch, context_fingerprint)
            )
            existing = cursor.fetchone()
            
            if existing:
                existing_id, existing_status = existing
                if existing_status in ['generating', 'pending']:
                    print(f"[EavesdropScheduler] 检测到卡住的记录: ID={existing_id}, status={existing_status}, 删除后重试")
                    cursor.execute("DELETE FROM eavesdrop_records WHERE id = ?", (existing_id,))
                    conn.commit()
                elif existing_status == 'failed':
                    print(f"[EavesdropScheduler] 检测到失败的记录: ID={existing_id}, 删除后重试")
                    cursor.execute("DELETE FROM eavesdrop_records WHERE id = ?", (existing_id,))
                    conn.commit()
        finally:
            conn.close()
        
        # 创建数据库记录
        record_id = self.db.add_eavesdrop_record(
            chat_branch=chat_branch,
            context_fingerprint=context_fingerprint,
            trigger_floor=trigger_floor,
            speakers=speakers,
            segments=[],  # 初始为空
            scene_description=scene_description,
            status="pending"
        )
        
        if record_id is None:
            print(f"[EavesdropScheduler] 创建记录失败(可能已存在): {chat_branch}#{context_fingerprint[:8]}")
            return None
        
        print(f"[EavesdropScheduler] ✅ 创建任务: ID={record_id}, speakers={speakers} @ 楼层{trigger_floor}")
        
        # 异步执行生成任务
        asyncio.create_task(self._execute_generation(
            record_id, chat_branch, speakers, trigger_floor, context, 
            context_fingerprint, user_name, char_name, scene_description,
            eavesdrop_config
        ))
        
        return record_id
    
    async def _execute_generation(
        self, 
        record_id: int, 
        chat_branch: str, 
        speakers: List[str], 
        trigger_floor: int, 
        context: List[Dict],
        context_fingerprint: str,
        user_name: str = None, 
        char_name: str = None,
        scene_description: str = None,
        eavesdrop_config: Dict = None
    ):
        """
        执行生成任务(异步)
        
        流程:
        1. 构建prompt
        2. 通过WebSocket通知前端调用LLM
        3. 前端调用LLM后,通过API将结果发回
        4. 解析并生成音频
        """
        task_key = f"eavesdrop#{chat_branch}#{context_fingerprint}"
        self._running_tasks.add(task_key)
        
        try:
            print(f"[EavesdropScheduler] 开始生成: ID={record_id}, speakers={speakers}")
            
            # 更新状态为 generating
            self.db.update_eavesdrop_status(record_id, "generating")
            
            # 第一阶段: 构建prompt（使用分析 LLM 提供的对话主题和框架）
            result = await self.eavesdrop_service.build_prompt(
                context=context,
                speakers=speakers,
                user_name=user_name,
                scene_description=scene_description,
                eavesdrop_config=eavesdrop_config  # ✅ 传递对话主题和框架
            )
            
            prompt = result.get("prompt")
            llm_config = result.get("llm_config")
            
            print(f"[EavesdropScheduler] ✅ Prompt构建完成: {len(prompt)} 字符")
            
            # WebSocket 路由目标
            ws_target = char_name if char_name else (speakers[0] if speakers else "Unknown")
            print(f"[EavesdropScheduler] WebSocket 推送目标: {ws_target}")
            
            # 第二阶段: 通过WebSocket通知前端调用LLM
            from services.notification_service import NotificationService
            notification_service = NotificationService()
            
            await notification_service.notify_eavesdrop_llm_request(
                record_id=record_id,
                char_name=ws_target,
                prompt=prompt,
                llm_config=llm_config,
                speakers=speakers,
                chat_branch=chat_branch,
                scene_description=scene_description
            )
            
            print(f"[EavesdropScheduler] ✅ 已通知前端调用LLM: record_id={record_id}")
            print(f"[EavesdropScheduler] ⏳ 等待前端通过 /api/eavesdrop/complete_generation 返回LLM响应...")
            
        except Exception as e:
            print(f"[EavesdropScheduler] ❌ 生成失败: ID={record_id}, 错误={str(e)}")
            
            # 更新状态为 failed
            self.db.update_eavesdrop_status(
                record_id=record_id,
                status="failed",
                error_message=str(e)
            )
            # 移除运行中标记
            self._running_tasks.discard(task_key)
    
    def get_running_tasks(self) -> List[str]:
        """获取正在执行的任务列表"""
        return list(self._running_tasks)
