"""
模型权重管理服务

统一管理 GPT/SoVITS 模型权重的切换和状态追踪。
被 routers/tts.py 和 routers/phone_call.py 共同使用。

特性:
- 单例模式，确保全局状态一致
- 异步锁机制，防止并发切换导致声音错乱
- 上下文管理器，方便锁定模型使用期间
"""

import os
import glob
import asyncio
import httpx
from typing import Optional, Dict
from contextlib import asynccontextmanager

from config import load_json, SETTINGS_FILE, get_current_dirs, get_sovits_host


class ModelWeightService:
    """模型权重管理服务 - 单例模式"""
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        # 当前加载的模型权重状态
        self._current_loaded = {
            "gpt_path": None,
            "sovits_path": None
        }
        
        # 全局模型锁 - 防止并发切换
        self._model_lock = asyncio.Lock()
        
        # 当前持有锁的任务信息（用于调试）
        self._lock_holder = None
        
        # 等待队列计数（用于监控）
        self._waiting_count = 0
        
        self._initialized = True
        print("[ModelWeightService] ✅ 服务初始化完成 (含全局锁)")
    
    @property
    def current_gpt_path(self) -> Optional[str]:
        """获取当前加载的 GPT 权重路径"""
        return self._current_loaded["gpt_path"]
    
    @property
    def current_sovits_path(self) -> Optional[str]:
        """获取当前加载的 SoVITS 权重路径"""
        return self._current_loaded["sovits_path"]
    
    @property
    def is_locked(self) -> bool:
        """检查模型是否被锁定"""
        return self._model_lock.locked()
    
    @property
    def waiting_count(self) -> int:
        """获取等待队列中的任务数"""
        return self._waiting_count
    
    @asynccontextmanager
    async def use_model(self, char_name: str, task_name: str = "unknown"):
        """
        锁定并切换到指定角色的模型（上下文管理器）
        
        使用方式:
            async with model_weight_service.use_model("角色名", "phone_call"):
                # 在此期间模型被锁定，其他请求会排队等待
                await generate_audio(...)
        
        Args:
            char_name: 角色名称
            task_name: 任务名称（用于日志）
            
        Yields:
            bool: 切换是否成功
        """
        self._waiting_count += 1
        
        if self._model_lock.locked():
            print(f"[ModelWeightService] ⏳ 任务 [{task_name}] 等待模型锁... (当前持有者: {self._lock_holder}, 队列: {self._waiting_count})")
        
        try:
            async with self._model_lock:
                self._waiting_count -= 1
                self._lock_holder = task_name
                print(f"[ModelWeightService] 🔒 任务 [{task_name}] 获取模型锁")
                
                # 切换到指定角色的模型
                success = await self.switch_to_character(char_name)
                if success:
                    print(f"[ModelWeightService] ✅ 任务 [{task_name}] 模型已就绪: {char_name}")
                else:
                    print(f"[ModelWeightService] ❌ 任务 [{task_name}] 模型切换失败: {char_name}")
                
                try:
                    yield success
                finally:
                    print(f"[ModelWeightService] 🔓 任务 [{task_name}] 释放模型锁")
                    self._lock_holder = None
        except Exception as e:
            self._waiting_count -= 1
            print(f"[ModelWeightService] ❌ 任务 [{task_name}] 异常: {e}")
            raise
    
    @asynccontextmanager
    async def acquire_lock(self, task_name: str = "unknown"):
        """
        仅获取锁，不切换模型（用于需要手动控制切换的场景）
        
        使用方式:
            async with model_weight_service.acquire_lock("tts_proxy"):
                # 手动切换权重
                service.set_gpt_weights(...)
                service.set_sovits_weights(...)
                # 生成音频
                ...
        
        Args:
            task_name: 任务名称（用于日志）
        """
        self._waiting_count += 1
        
        if self._model_lock.locked():
            print(f"[ModelWeightService] ⏳ 任务 [{task_name}] 等待模型锁... (当前持有者: {self._lock_holder}, 队列: {self._waiting_count})")
        
        try:
            async with self._model_lock:
                self._waiting_count -= 1
                self._lock_holder = task_name
                print(f"[ModelWeightService] 🔒 任务 [{task_name}] 获取模型锁")
                
                try:
                    yield
                finally:
                    print(f"[ModelWeightService] 🔓 任务 [{task_name}] 释放模型锁")
                    self._lock_holder = None
        except Exception as e:
            self._waiting_count -= 1
            print(f"[ModelWeightService] ❌ 任务 [{task_name}] 异常: {e}")
            raise
    
    def get_model_config(self, char_name: str) -> Optional[Dict]:
        """
        获取角色对应的模型配置（GPT/SoVITS 权重路径）
        
        Args:
            char_name: 角色名称
            
        Returns:
            模型配置 {gpt_path, sovits_path, model_folder} 或 None
        """
        # 获取角色到模型文件夹的映射
        mappings = load_json(os.path.join(os.path.dirname(SETTINGS_FILE), "character_mappings.json"))
        
        if char_name not in mappings:
            print(f"[ModelWeightService] 错误: 角色 {char_name} 未绑定模型")
            return None
        
        model_folder = mappings[char_name]
        base_dir, _ = get_current_dirs()
        model_path = os.path.join(base_dir, model_folder)
        
        if not os.path.exists(model_path):
            print(f"[ModelWeightService] 错误: 模型目录不存在: {model_path}")
            return None
        
        # 查找权重文件
        gpt_files = glob.glob(os.path.join(model_path, "*.ckpt"))
        sovits_files = glob.glob(os.path.join(model_path, "*.pth"))
        
        gpt_path = gpt_files[0] if gpt_files else None
        sovits_path = sovits_files[0] if sovits_files else None
        
        if not gpt_path or not sovits_path:
            print(f"[ModelWeightService] 警告: 模型 {model_folder} 权重文件不完整 (GPT: {bool(gpt_path)}, SoVITS: {bool(sovits_path)})")
            return None
        
        return {
            "gpt_path": gpt_path,
            "sovits_path": sovits_path,
            "model_folder": model_folder
        }
    
    async def set_gpt_weights(self, weights_path: str, skip_if_same: bool = True) -> Dict:
        """
        切换 GPT 权重（注意：此方法不获取锁，调用方需自行管理锁）
        
        Args:
            weights_path: 权重文件路径
            skip_if_same: 如果相同则跳过切换
            
        Returns:
            {"success": bool, "message": str, "skipped": bool}
        """
        # 检查是否需要切换
        if skip_if_same and self._current_loaded["gpt_path"] == weights_path:
            print(f"[ModelWeightService] ⏭️ GPT 权重相同，跳过切换")
            return {"success": True, "message": "权重相同，已跳过", "skipped": True}
        
        # 检查文件是否存在
        if not os.path.exists(weights_path):
            return {"success": False, "message": f"GPT 权重文件不存在: {weights_path}", "skipped": False}
        
        try:
            sovits_host = get_sovits_host()
            url = f"{sovits_host}/set_gpt_weights"
            print(f"[ModelWeightService] 🔄 切换 GPT 权重: {weights_path}")
            
            async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
                resp = await client.get(
                    url,
                    params={"weights_path": weights_path}
                )
            
            if resp.status_code != 200:
                print(f"[ModelWeightService] ❌ GPT 权重切换失败: {resp.status_code} - {resp.text}")
                return {"success": False, "message": f"服务返回错误: {resp.status_code}", "skipped": False}
            
            # 更新状态
            self._current_loaded["gpt_path"] = weights_path
            print(f"[ModelWeightService] ✅ GPT 权重已切换")
            return {"success": True, "message": resp.text, "skipped": False}
            
        except httpx.ConnectError:
            print(f"[ModelWeightService] ❌ 无法连接到 GPT-SoVITS 服务")
            return {"success": False, "message": "无法连接到 GPT-SoVITS 服务", "skipped": False}
        except httpx.TimeoutException:
            print(f"[ModelWeightService] ❌ 连接超时")
            return {"success": False, "message": "连接超时", "skipped": False}
        except Exception as e:
            print(f"[ModelWeightService] ❌ 异常: {e}")
            return {"success": False, "message": str(e), "skipped": False}
    
    async def set_sovits_weights(self, weights_path: str, skip_if_same: bool = True) -> Dict:
        """
        切换 SoVITS 权重（注意：此方法不获取锁，调用方需自行管理锁）
        
        Args:
            weights_path: 权重文件路径
            skip_if_same: 如果相同则跳过切换
            
        Returns:
            {"success": bool, "message": str, "skipped": bool}
        """
        # 检查是否需要切换
        if skip_if_same and self._current_loaded["sovits_path"] == weights_path:
            print(f"[ModelWeightService] ⏭️ SoVITS 权重相同，跳过切换")
            return {"success": True, "message": "权重相同，已跳过", "skipped": True}
        
        # 检查文件是否存在
        if not os.path.exists(weights_path):
            return {"success": False, "message": f"SoVITS 权重文件不存在: {weights_path}", "skipped": False}
        
        try:
            sovits_host = get_sovits_host()
            url = f"{sovits_host}/set_sovits_weights"
            print(f"[ModelWeightService] 🔄 切换 SoVITS 权重: {weights_path}")
            
            async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
                resp = await client.get(
                    url,
                    params={"weights_path": weights_path}
                )
            
            if resp.status_code != 200:
                print(f"[ModelWeightService] ❌ SoVITS 权重切换失败: {resp.status_code} - {resp.text}")
                return {"success": False, "message": f"服务返回错误: {resp.status_code}", "skipped": False}
            
            # 更新状态
            self._current_loaded["sovits_path"] = weights_path
            print(f"[ModelWeightService] ✅ SoVITS 权重已切换")
            return {"success": True, "message": resp.text, "skipped": False}
            
        except httpx.ConnectError:
            print(f"[ModelWeightService] ❌ 无法连接到 GPT-SoVITS 服务")
            return {"success": False, "message": "无法连接到 GPT-SoVITS 服务", "skipped": False}
        except httpx.TimeoutException:
            print(f"[ModelWeightService] ❌ 连接超时")
            return {"success": False, "message": "连接超时", "skipped": False}
        except Exception as e:
            print(f"[ModelWeightService] ❌ 异常: {e}")
            return {"success": False, "message": str(e), "skipped": False}
    
    async def switch_to_character(self, char_name: str) -> bool:
        """
        切换到指定角色的模型权重（同时切换 GPT 和 SoVITS）
        注意：此方法不获取锁，建议使用 use_model() 上下文管理器
        
        Args:
            char_name: 角色名称
            
        Returns:
            是否切换成功
        """
        model_config = self.get_model_config(char_name)
        if not model_config:
            return False
        
        gpt_path = model_config["gpt_path"]
        sovits_path = model_config["sovits_path"]
        
        # 切换 GPT 权重
        gpt_result = await self.set_gpt_weights(gpt_path)
        if not gpt_result["success"]:
            return False
        
        # 切换 SoVITS 权重
        sovits_result = await self.set_sovits_weights(sovits_path)
        if not sovits_result["success"]:
            return False
        
        return True
    
    def reset_state(self):
        """重置状态（用于调试或服务重启后同步）"""
        self._current_loaded = {
            "gpt_path": None,
            "sovits_path": None
        }
        self._lock_holder = None
        self._waiting_count = 0
        print("[ModelWeightService] 🔄 状态已重置")
    
    def get_status(self) -> Dict:
        """获取服务状态（用于调试和监控）"""
        return {
            "current_gpt_path": self._current_loaded["gpt_path"],
            "current_sovits_path": self._current_loaded["sovits_path"],
            "is_locked": self._model_lock.locked(),
            "lock_holder": self._lock_holder,
            "waiting_count": self._waiting_count
        }


# 全局单例实例
model_weight_service = ModelWeightService()
