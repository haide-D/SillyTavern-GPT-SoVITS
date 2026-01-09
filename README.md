# SillyTavern-GPT-SoVITS Middleware

![License](https://img.shields.io/badge/license-MIT-blue) ![Python](https://img.shields.io/badge/python-3.8+-yellow) ![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-purple)

这是一个为 **SillyTavern** 设计的 **GPT-SoVITS** 深度集成插件。

它不仅仅是一个简单的 TTS 连接器，它包含一个 Python 后端管理器和一个前端 JS 插件，提供了模型自动切换、音频缓存、以及类似微信/Messenger 的语音气泡交互体验。

## ✨ 主要功能

* **🎧 沉浸式 UI**：在对话消息旁生成类似微信/即时通讯软件的语音条（Voice Bubble），支持播放动画和时长显示。
* **🤖 多模型自动切换**：根据说话的角色，自动向 GPT-SoVITS 切换对应的 GPT 权重和 SoVITS 权重。
* **⚡ 本地缓存系统**：后端自动缓存已生成的音频（MD5哈希校验），避免重复生成，大幅降低 GPU 负载并提高响应速度。
* **🎭 情感语音支持**：支持解析 `[TTSVoice:角色:情感:文本]` 格式，根据情感自动匹配参考音频（Ref Audio）。
* **🔄 队列管理**：内置任务调度器，防止并发请求导致显存溢出，按顺序逐个处理语音生成任务。
* **⚙️ 可视化配置面板**：直接在酒馆界面内绑定角色模型、设置路径、开关自动生成等。

## 💡 技术原理 (How it Works)

为了保证极致的响应速度并保护你的显卡，本插件采用了多层优化策略：

### 1. 智能哈希缓存 (Smart MD5 Caching)
插件不会盲目重复生成音频。每当需要生成语音时，后端会根据以下参数计算唯一的 **MD5 哈希值**：
* 📝 文本内容 (Text)
* 🎭 情感标签 (Emotion)
* 🗣️ 参考音频路径 (Reference Audio)
* 🔡 提示词文本 (Prompt Text)

**逻辑流程**：
1.  **内存检查**：先检查浏览器内存中是否已有该音频（极致速度）。
2.  **磁盘检查**：检查 `Cache/` 文件夹下是否存在对应 Hash 的 `.wav` 文件。
3.  **命中缓存**：如果存在，直接返回音频文件（0延迟，不占用 GPU）。
4.  **未命中**：仅在完全匹配不到时，才向 GPT-SoVITS 发送生成请求。

### 2. 自动预生成与队列调度 (Auto Pre-generation & Queue)
开启“自动预生成”后，体验将接近无感：

* **监听消息**：当酒馆收到 AI 的新回复时，插件会静默解析其中的 `[TTSVoice]` 标签。
* **任务队列**：解析出的语音任务**不会同时并发**（防止爆显存），而是进入一个 **FIFO (先进先出) 队列**。
* **后台生成**：调度器会在后台逐个处理队列任务。
    * 当你还在阅读文字时，音频往往已经生成完毕。
    * 当你点击绿色气泡时，音频是直接从本地加载的，无需等待。

---

## 🛠️ 前置要求

1.  **SillyTavern**: 已安装并运行。
2.  **GPT-SoVITS**: 需要部署并启动 API 服务（默认端口 `9880`）。
3.  **Python 环境**: 用于运行本插件的后端管理器。

## 🚀 安装与运行

本插件分为**前端 (SillyTavern 扩展)** 和 **后端 (Python 服务)** 两部分，需同时运行。

### 第一步：在 SillyTavern 中安装扩展

1.  启动 SillyTavern。
2.  点击顶部菜单栏的 **Extensions (扩展)** 图标（积木块形状）。
3.  点击 **Install Extension (安装扩展)**。
4.  在 URL 栏中粘贴本仓库的 GitHub 地址：
    ```text
    https://github.com/haide-D/SillyTavern-GPT-SoVITS
    ```
5.  点击 **Install**。安装完成后，刷新页面或重启 SillyTavern。
6.  *此时你应该能看到界面上出现了 "🔊 TTS配置" 按钮，但点击会报错，因为后端还没启动。*

### 第二步：启动后端服务 (Windows 一键启动)

1.  进入插件目录：`SillyTavern/public/scripts/extensions/你的仓库名/`
2.  双击运行 **`start.bat`**。
    * *脚本会自动安装所需的 Python 依赖并启动服务。*
3.  保持该黑色窗口开启即可。

### 第三步：启动 GPT-SoVITS

确保你的 GPT-SoVITS 推理服务已开启（默认端口 9880）。

---

## 📂 模型文件结构

为了让插件识别模型，请在插件目录下的 `MyCharacters` 文件夹中按以下结构组织文件（或者在设置面板中指定你的模型库绝对路径）。

**⚠️ 注意：参考音频文件夹必须命名为 `reference_audios`，或者你直接用TTS设置生成文件格式的就行**

## 📝 音频命名规则
为了让插件自动识别“情感”和“参考文本”，请严格按照以下格式命名音频文件：

格式：情感_提示词内容.wav

示例：

happy_你好我是测试.wav 👉 情感识别为 happy，提示词为 你好我是测试

sad_我好难过.mp3 👉 情感识别为 sad，提示词为 我好难过

普通对话.wav 👉 (无下划线) 情感识别为 default，提示词为文件名本身

```text
MyCharacters/
├── 你的角色名/
│   ├── gpt_weights.ckpt           (GPT 权重文件)
│   ├── sovits_weights.pth         (SoVITS 权重文件)
│   └── reference_audios/          (必须叫这个名字!)
│       │
│       ├── (方式A：简单模式 - 直接放在根目录)
│       ├── default_提示词文本.wav
│       ├── happy_提示词文本.wav
│       │
│       └── (方式B：多语言模式 - 推荐)
│           ├── Chinese/
│           │   └── emotions/      (代码会自动创建 emotions 子目录)
│           │       ├── happy_中文提示词.wav
│           │       └── sad_中文提示词.wav
│           ├── Japanese/
│           │   └── emotions/
│           │       └── default_日语提示词.wav
│           └── English/
│               └── ...

