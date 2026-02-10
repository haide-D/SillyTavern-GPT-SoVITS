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
                if existing_status in ['generating', 'waiting_for_llm', 'pending']:
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
            
            # 更新状态为 waiting_for_llm（注意：不能用 "generating"，
            # 因为 complete_generation API 的防重复逻辑会检查 "generating" 状态并跳过）
            self.db.update_eavesdrop_status(record_id, "waiting_for_llm")
            
            # 读取 TTS 配置中的语言设置（用于 Prompt 构建）
            settings = load_json(SETTINGS_FILE) or {}
            # ✅ 修复：正确路径是 settings["phone_call"]["tts_config"]，而不是 settings["tts"]
            phone_call_config = settings.get("phone_call", {})
            tts_config = phone_call_config.get("tts_config", {})
            text_lang = tts_config.get("text_lang", "zh")
            print(f"[EavesdropScheduler] 📋 TTS 语言配置 (from phone_call.tts_config): text_lang={text_lang}")
            
            # 第一阶段: 构建prompt（使用分析 LLM 提供的对话主题和框架）
            result = await self.eavesdrop_service.build_prompt(
                context=context,
                speakers=speakers,
                user_name=user_name,
                text_lang=text_lang,  # ✅ 传递语言配置
                scene_description=scene_description,
                eavesdrop_config=eavesdrop_config  # ✅ 传递对话主题和框架
            )
            
            prompt = result.get("prompt")
            llm_config = result.get("llm_config")
            
            print(f"[EavesdropScheduler] ✅ Prompt构建完成: {len(prompt)} 字符")
            print(f"[EavesdropScheduler] 📝 完整 LLM 请求内容:")
            print(f"========== PROMPT START ==========")
            print(prompt)
            print(f"========== PROMPT END ==========")
            print(f"[EavesdropScheduler] 🔧 LLM 配置: {llm_config}")
            
            # WebSocket 路由目标
            ws_target = char_name if char_name else (speakers[0] if speakers else "Unknown")
            print(f"[EavesdropScheduler] WebSocket 推送目标: {ws_target}")
            
            # 第二阶段: 通过WebSocket通知前端调用LLM
            from services.notification_service import NotificationService
            notification_service = NotificationService()
            
            # text_lang 已在上面读取，直接使用
            
            await notification_service.notify_eavesdrop_llm_request(
                record_id=record_id,
                char_name=ws_target,
                prompt=prompt,
                llm_config=llm_config,
                speakers=speakers,
                chat_branch=chat_branch,
                scene_description=scene_description,
                text_lang=text_lang
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
        finally:
            # 无论成功还是失败，都移除运行中标记
            # （调度器的工作在通知前端后就结束了，后续由 complete_generation API 接管）
            self._running_tasks.discard(task_key)
    
    def get_running_tasks(self) -> List[str]:
        """获取正在执行的任务列表"""
        return list(self._running_tasks)
