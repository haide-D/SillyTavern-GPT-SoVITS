"""
自定义日志中间件
美化 FastAPI 请求日志输出,解码 URL 参数并格式化显示
"""
import time
from urllib.parse import unquote, parse_qs
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from datetime import datetime


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    自定义日志中间件,美化请求日志输出
    """
    
    async def dispatch(self, request: Request, call_next):
        # 记录开始时间
        start_time = time.time()
        
        # 处理请求
        response = await call_next(request)
        
        # 计算耗时
        duration = time.time() - start_time
        
        # 格式化并打印日志
        self._log_request(request, response.status_code, duration)
        
        return response
    
    def _log_request(self, request: Request, status_code: int, duration: float):
        """
        格式化并打印请求日志
        """
        # 获取时间戳
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # 获取客户端 IP
        client_ip = request.client.host if request.client else "unknown"
        
        # 解码 URL 路径
        path = unquote(request.url.path)
        
        # 解析查询参数
        query_string = str(request.url.query)
        
        # 状态码颜色
        if status_code < 300:
            status_color = "\033[92m"  # 绿色
        elif status_code < 400:
            status_color = "\033[93m"  # 黄色
        else:
            status_color = "\033[91m"  # 红色
        reset_color = "\033[0m"
        
        # 打印主请求行
        print(f"\n[{timestamp}] {client_ip} - {request.method} {path}")
        
        # 解析并打印查询参数
        if query_string:
            params = parse_qs(query_string)
            for key, values in params.items():
                # 解码键和值
                decoded_key = unquote(key)
                decoded_value = unquote(values[0]) if values else ""
                
                # 路径截断(超过80字符)
                if len(decoded_value) > 80:
                    # 智能截断:保留文件名
                    if "\\" in decoded_value or "/" in decoded_value:
                        parts = decoded_value.replace("\\", "/").split("/")
                        filename = parts[-1]
                        prefix = "/".join(parts[:-1])
                        if len(prefix) > 50:
                            decoded_value = f"{prefix[:25]}...{prefix[-20:]}/{filename}"
                    else:
                        decoded_value = f"{decoded_value[:60]}...{decoded_value[-15:]}"
                
                print(f"  ├─ {decoded_key}: {decoded_value}")
        
        # 打印响应状态和耗时
        print(f"  └─ {status_color}{status_code}{reset_color} ({duration:.2f}s)")
    
    def _should_log(self, path: str) -> bool:
        """
        判断是否应该记录日志(可以过滤某些路径)
        """
        # 可以在这里添加过滤逻辑,例如忽略静态文件请求
        ignore_paths = ["/static/", "/favicon.ico"]
        return not any(path.startswith(p) for p in ignore_paths)
