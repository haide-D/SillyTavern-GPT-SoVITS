import uvicorn
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 导入配置和路由
from config import FRONTEND_DIR
from routers import data, tts, system

app = FastAPI()

# 1. CORS 配置
app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"], 
    allow_methods=["*"], 
    allow_headers=["*"],
    allow_credentials=True,  # 允许携带凭证
    expose_headers=["*"]  # 暴露所有响应头
)

# 2. 挂载静态文件 (前端界面)
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
else:
    print(f"Warning: 'frontend' folder not found at {FRONTEND_DIR}")

os.makedirs("data/favorites_audio", exist_ok=True)
app.mount("/favorites", StaticFiles(directory="data/favorites_audio"), name="favorites")
# 3. 注册路由
app.include_router(data.router, tags=["Data Management"])
app.include_router(tts.router, tags=["TTS Core"])
app.include_router(system.router, tags=["System Settings"])

if __name__ == "__main__":
    # 必须是 0.0.0.0，否则局域网无法访问
    uvicorn.run(app, host="0.0.0.0", port=3000)
