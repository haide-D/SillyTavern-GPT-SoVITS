import asyncio
from typing import List, Dict, Optional
from datetime import datetime
from database import DatabaseManager
from services.phone_call_service import PhoneCallService
from config import load_json, SETTINGS_FILE


class AutoCallScheduler:
    """自动调用调度器 - 管理自动生成任务,防重复,异步执行"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.phone_call_service = PhoneCallService()
        self.settings = load_json(SETTINGS_FILE)
        
        # 正在执行的任务集合 (char_name, floor)
        self._running_tasks = set()
    
    async def schedule_auto_call(self, chat_branch: str, speakers: List[str], trigger_floor: int, context: List[Dict], context_fingerprint: str, user_name: str = None, char_name: str = None) -> Optional[int]:
        """
        调度自动电话生成任务
        
        Args:
            chat_branch: 对话分支ID
            speakers: 说话人列表
            trigger_floor: 触发楼层
            context: 对话上下文
            context_fingerprint: 上下文指纹
            user_name: 用户名，用于在prompt中区分用户身份
            char_name: 主角色卡名称，用于 WebSocket 推送路由
            
        Returns:
            任务ID,如果已存在或正在执行则返回 None
        """
        # 使用指纹作为任务标识
        task_key = f"{chat_branch}#{context_fingerprint}"
        
        # 检查是否正在执行
        if task_key in self._running_tasks:
            print(f"[AutoCallScheduler] 任务已在执行中: {chat_branch}#{context_fingerprint[:8]}")
            return None
        
        # 检查数据库是否已生成
        if self.db.is_auto_call_generated(chat_branch, context_fingerprint):
            print(f"[AutoCallScheduler] 该上下文已生成过: {chat_branch}#{context_fingerprint[:8]}")
            return None
        
        # 检查是否存在卡住的记录 (generating/pending 状态)
        # 如果存在,删除后重新创建,允许重试
        conn = self.db._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT id, status FROM auto_phone_calls WHERE chat_branch = ? AND context_fingerprint = ?",
                (chat_branch, context_fingerprint)
            )
            existing = cursor.fetchone()
            
            if existing:
                existing_id, existing_status = existing
                if existing_status in ['generating', 'pending']:
                    print(f"[AutoCallScheduler] 检测到卡住的记录: ID={existing_id}, status={existing_status}, 删除后重试")
                    cursor.execute("DELETE FROM auto_phone_calls WHERE id = ?", (existing_id,))
                    conn.commit()
                elif existing_status == 'failed':
                    print(f"[AutoCallScheduler] 检测到失败的记录: ID={existing_id}, 删除后重试")
                    cursor.execute("DELETE FROM auto_phone_calls WHERE id = ?", (existing_id,))
                    conn.commit()
        finally:
            conn.close()
        
        # 创建数据库记录(使用指纹系统)
        call_id = self.db.add_auto_phone_call(
            chat_branch=chat_branch,
            context_fingerprint=context_fingerprint,
            trigger_floor=trigger_floor,
            segments=[],  # 初始为空
            char_name=None,  # 初始为 None,LLM 选择后更新
            status="pending"
        )
        
        if call_id is None:
            print(f"[AutoCallScheduler] 创建记录失败(可能已存在): {chat_branch}#{context_fingerprint[:8]}")
            return None
        
        print(f"[AutoCallScheduler] ✅ 创建任务: ID={call_id}, speakers={speakers} @ 楼层{trigger_floor}, 指纹={context_fingerprint[:8]}")
        
        # 异步执行生成任务 (传递所有说话人、用户名和主角色名)
        asyncio.create_task(self._execute_generation(call_id, chat_branch, speakers, trigger_floor, context, user_name, char_name))
        
        return call_id
    
    async def _execute_generation(self, call_id: int, chat_branch: str, speakers: List[str], trigger_floor: int, context: List[Dict], user_name: str = None, char_name: str = None):
        """
        执行生成任务(异步) - 新架构
        
        流程:
        1. 构建prompt
        2. 通过WebSocket通知前端调用LLM
        3. 前端调用LLM后,通过API将结果发回
        4. 解析并生成音频
        
        Args:
            call_id: 任务ID
            chat_branch: 对话分支ID
            speakers: 说话人列表
            trigger_floor: 触发楼层
            context: 对话上下文
            user_name: 用户名，用于在prompt中区分用户身份
            char_name: 主角色卡名称，用于 WebSocket 推送路由
        """
        task_key = trigger_floor
        self._running_tasks.add(task_key)
        
        try:
            print(f"[AutoCallScheduler] 开始生成: ID={call_id}, speakers={speakers} @ 楼层{trigger_floor}")
            
            # 更新状态为 generating
            self.db.update_auto_call_status(call_id, "generating")
            
            # 第一阶段: 构建prompt
            result = await self.phone_call_service.generate(
                chat_branch=chat_branch,
                speakers=speakers,
                context=context,
                generate_audio=False,  # 暂时不生成音频
                user_name=user_name  # 传递用户名
            )
            
            prompt = result.get("prompt")
            llm_config = result.get("llm_config")
            
            print(f"[AutoCallScheduler] ✅ Prompt构建完成: {len(prompt)} 字符")
            
            # WebSocket 路由目标: 优先使用前端传递的主角色名,回退到第一个 speaker
            ws_target = char_name if char_name else (speakers[0] if speakers else "Unknown")
            print(f"[AutoCallScheduler] WebSocket 推送目标: {ws_target}")
            
            # 第二阶段: 通过WebSocket通知前端调用LLM
            from services.notification_service import NotificationService
            notification_service = NotificationService()
            
            await notification_service.notify_llm_request(
                call_id=call_id,
                char_name=ws_target,  # 使用主角色卡名称进行 WebSocket 路由
                prompt=prompt,
                llm_config=llm_config,
                speakers=speakers,  # 完整的 speakers 列表,供 LLM 选择
                chat_branch=chat_branch
            )
            
            print(f"[AutoCallScheduler] ✅ 已通知前端调用LLM: call_id={call_id}")
            print(f"[AutoCallScheduler] ⏳ 等待前端通过 /api/phone_call/complete_generation 返回LLM响应...")
            
            # 注意: 实际的音频生成将在 complete_generation API 中完成
            # 这里任务状态保持为 "generating",等待前端响应
            
        except Exception as e:
            print(f"[AutoCallScheduler] ❌ 生成失败: ID={call_id}, 错误={str(e)}")
            
            # 更新状态为 failed
            self.db.update_auto_call_status(
                call_id=call_id,
                status="failed",
                error_message=str(e)
            )
            # 移除运行中标记
            self._running_tasks.discard(task_key)
    
    async def _save_audio(self, call_id: int, char_name: str, audio_data: bytes, audio_format: str) -> tuple:
        """
        保存音频文件并返回路径和 URL
        
        Args:
            call_id: 任务ID
            char_name: 角色名称
            audio_data: 音频数据(base64或bytes)
            audio_format: 音频格式
            
        Returns:
            tuple: (音频文件路径, HTTP URL)
        """
        import os
        import base64
        from config import SETTINGS_FILE
        
        # 获取缓存目录
        settings = load_json(SETTINGS_FILE)
        cache_dir = settings.get("cache_dir", "Cache")
        
        # 创建自动电话音频目录
        auto_call_dir = os.path.join(cache_dir, "auto_phone_calls", char_name)
        os.makedirs(auto_call_dir, exist_ok=True)
        
        # 生成文件名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"auto_call_{call_id}_{timestamp}.{audio_format}"
        audio_path = os.path.join(auto_call_dir, filename)
        
        # 如果是 base64,先解码
        if isinstance(audio_data, str):
            audio_data = base64.b64decode(audio_data)
        
        # 保存文件
        with open(audio_path, "wb") as f:
            f.write(audio_data)
        
        # 生成 HTTP URL (相对路径)
        relative_path = f"{char_name}/{filename}"
        audio_url = f"/auto_call_audio/{relative_path}"
        
        print(f"[AutoCallScheduler] 音频已保存: {audio_path}")
        print(f"[AutoCallScheduler] 音频 URL: {audio_url}")
        return audio_path, audio_url
    
    def get_running_tasks(self) -> List[tuple]:
        """获取正在执行的任务列表"""
        return list(self._running_tasks)
