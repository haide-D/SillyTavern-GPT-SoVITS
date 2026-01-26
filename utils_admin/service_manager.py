import subprocess
import socket
import sys
import os
import requests
from typing import Dict, Any

class ServiceManager:
    """服务管理工具类"""
    
    @staticmethod
    def check_port(host: str, port: int, timeout: float = 1.0) -> bool:
        """检查端口是否可访问"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            sock.close()
            return result == 0
        except:
            return False
    
    @staticmethod
    def check_sovits_service(host: str) -> Dict[str, Any]:
        """检查 GPT-SoVITS 服务状态"""
        try:
            # 禁用代理,避免端口重定向
            response = requests.get(f"{host}/", timeout=2, proxies={'http': None, 'https': None})
            return {
                "status": "running",
                "accessible": True,
                "url": host
            }
        except requests.exceptions.ConnectionError:
            return {
                "status": "stopped",
                "accessible": False,
                "url": host,
                "error": "无法连接到服务"
            }
        except Exception as e:
            return {
                "status": "error",
                "accessible": False,
                "url": host,
                "error": str(e)
            }
    
    @staticmethod
    def check_python_env() -> Dict[str, Any]:
        """检查 Python 环境"""
        return {
            "version": sys.version,
            "executable": sys.executable,
            "platform": sys.platform
        }
    
    @staticmethod
    def check_dependencies() -> Dict[str, Any]:
        """检查依赖包状态"""
        required_packages = ["fastapi", "uvicorn", "requests", "pydantic"]
        results = {}
        
        for package in required_packages:
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "pip", "show", package],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0:
                    # 解析版本信息
                    for line in result.stdout.split('\n'):
                        if line.startswith('Version:'):
                            version = line.split(':', 1)[1].strip()
                            results[package] = {
                                "installed": True,
                                "version": version
                            }
                            break
                else:
                    results[package] = {
                        "installed": False,
                        "version": None
                    }
            except Exception as e:
                results[package] = {
                    "installed": False,
                    "version": None,
                    "error": str(e)
                }
        
        return results
    
    @staticmethod
    def install_dependencies(requirements_file: str = "requirements.txt") -> Dict[str, Any]:
        """安装依赖包"""
        try:
            if not os.path.exists(requirements_file):
                return {
                    "success": False,
                    "error": f"文件不存在: {requirements_file}"
                }
            
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", requirements_file],
                capture_output=True,
                text=True,
                timeout=300  # 5分钟超时
            )
            
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "安装超时(超过5分钟)"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    @staticmethod
    def get_system_status() -> Dict[str, Any]:
        """获取系统整体状态"""
        # 导入配置函数
        from config import get_sovits_host
        
        return {
            "sovits_service": ServiceManager.check_sovits_service(get_sovits_host()),
            "backend_port": ServiceManager.check_port("127.0.0.1", 3000),
        }
