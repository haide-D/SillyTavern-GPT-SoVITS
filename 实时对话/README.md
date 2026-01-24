# 实时对话测试框架

本模块用于测试本地实时对话的可行性：LLM流式输出 → 逐段TTS推理 → 流式音频播放。

## 快速开始

1. **确保GPT-SoVITS已启动**
   ```bash
   # 假设在默认端口 9880
   ```

2. **启动后端**
   ```bash
   cd g:\Ai\SillyTavern\data\default-user\extensions\st-direct-tts
   python manager.py
   ```

3. **打开测试页面**
   浏览器访问: `http://localhost:3000/extensions/st-direct-tts/实时对话/frontend/realtime_demo.html`

4. **配置参数**
   - 输入 Claude API Key
   - 配置参考音频路径
   - 开始对话测试

## 技术栈

- **后端**: FastAPI + httpx (异步流式请求)
- **前端**: 原生JS + SSE (流式接收)
- **TTS**: GPT-SoVITS streaming_mode=2

## 文件结构

```
实时对话/
├── README.md
├── backend/
│   ├── __init__.py
│   ├── realtime_router.py   # FastAPI路由
│   ├── realtime_service.py  # 流式TTS服务
│   └── text_chunker.py      # 文本分段器
└── frontend/
    ├── realtime_demo.html   # 测试页面
    └── realtime_client.js   # 流式客户端
```

## API接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/realtime/tts_stream` | POST | 流式TTS生成 |
| `/api/realtime/interrupt` | POST | 打断当前对话 |
| `/api/realtime/ref_audio` | GET | 获取参考音频配置 |
| `/api/realtime/health` | GET | 健康检查 |

## 打断功能

- 点击"打断"按钮会:
  1. 取消正在进行的LLM请求
  2. 清空文本分段缓冲区
  3. 取消正在进行的TTS请求
  4. 清空音频播放队列

## 延迟指标

- **首Token延迟**: 用户发送消息到收到第一个LLM token的时间
- **首音频延迟**: 用户发送消息到第一个音频开始播放的时间
- **总耗时**: 完整对话回合的总时间
