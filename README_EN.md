# SillyTavern-GPT-SoVITS Middleware

[**English**](./README_EN.md) | [**简体中文**](./README.md)

![License](https://img.shields.io/badge/license-MIT-blue) ![Python](https://img.shields.io/badge/python-3.8+-yellow) ![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-purple)

This is a deep integration plugin tailored for **SillyTavern** with **GPT-SoVITS**.

It is far more than a simple TTS connector. It features a full-stack architecture with a Python Fast-API backend manager and a vanilla JS frontend extension, providing zero-latency audio caching, dynamic model switching, and **12 highly customizable immersive voice bubble UI themes**.

---

## 🚀 Architecture & Feature Branches

This project is built with a highly **modular and extensible** architecture. The core engine handles TTS stability and frontend visuals, while advanced, cutting-edge capabilities are developed in independent branches to ensure system scalability and decoupling:

* **`main` branch**: The stable core engine, including model management, UI bubble rendering, and smart hashing cache mechanisms.
* **`fe_RealTime` branch**: 🔥 **Ultra-low Latency Real-time Voice Chat**. Built with WebSockets and VAD (Voice Activity Detection), this branch brings real-time, interruptible streaming voice conversations designed for highly immersive AI interactions.
* **`fe_tg_bot` branch**: 🤖 **Telegram Bot Integration**. Seamlessly connects the core AI engine to the Telegram Bot API, allowing remote interactions, scheduling, and complex state machine management via a Telegram client.

---

## ✨ Core Features

### 🎛️ Admin Dashboard
* **📊 System Dashboard**: Access `http://localhost:3000/admin-ui` to monitor system status, memory cache, and version info.
* **🤖 Model Management**: Visually manage and upload GPT/SoVITS `.pth` and `.ckpt` weights directly from the browser.
* **🎵 Reference Audio Manager**: Play, rename, batch-modify emotion prefixes, and delete audio files online without manually touching the file system.
* **⚙️ System Settings**: Tweak config parameters seamlessly in the web UI.

### 🔄 Auto-Update System 
* **Version Detection**: Automatically checks GitHub for the latest releases.
* **One-Click Update**: Supports automatic `git pull` or ZIP downloads for smart user upgrades.
* **Smart Processing**: Automatically stashes local changes, cleans tracking files, and restarts services.

### 🎧 Ultimate Audiovisual Experience
* **Immersive Voice Bubbles**: Generates iMessage/Messenger-style voice bars next to chat messages, complete with dynamic waveforms and duration displays.
* **🎨 12 Built-in Themes**: From Cyberpunk and Steampunk to Kawaii and Minimalist. Switch themes instantly.
* **🖼️ CSS Iframe Injection**: Exclusive support for "Iframe Mode", perfectly injecting styles into heavily customized SillyTavern aesthetic cards.

### 🤖 Automation & Performance
* **Dynamic Model Switching**: Automatically switches GPT and SoVITS weights based on the speaking character.
* **⚡ Smart MD5 Caching**: Generates a unique hash (Text + Emotion + Reference + Prompt). Cache hits result in 0ms delay and ZERO GPU usage.
* **🔄 FIFO Task Queue**: Built-in queue scheduler prevents concurrent request VRAM overflow. Background silent generation, foreground smooth reading.

### 🧠 Live Character Engine (v2.0+)
* **4D Character Analysis**: Continuously analyzes chat context using LLMs, tracking characters across physical, emotional, cognitive, and social dimensions.
* **Dynamic Action Triggers**: The engine evaluates potential actions (e.g., initiating a phone call, whispering, leaving) based on urgency and emotional intensity.

### 📞 Smart Phone Call System (v2.0+)
* **LLM-Driven Incoming Calls**: The analysis engine dynamically decides when, who, and why to trigger an incoming phone call based on the plot.
* **Multi-Scenario Support**: Emergency SOS, casual greetings, emotional venting, etc.
* **Seamless UI Integration**: Call content is synthesized via GPT-SoVITS and displayed beautifully in the chat interface.

### 👂 Eavesdrop System (v2.0+)
* **Private Whispers**: Trigger the "Eavesdrop" function to generate private conversations between multiple characters in the scene.
* **Multi-Speaker Synthesis**: Automatically identifies each speaker and uses their respective TTS models.
* **Synchronized Subtitles**: Generates precise timeline subtitles with scrolling highlights.

### 📡 Remote & Cross-Device
* **📱 Mobile/Remote Mode**: Run the heavy backend on your PC while enjoying the SillyTavern UI smoothly on your smartphone browser.

---

## 🎨 Visual Styles

12 meticulously crafted CSS themes are built-in, ready to adapt to any Roleplay scenario:
* 🌿 **Minimalist Green** (Default)
* 💎 **Kawaii Glassmorphism**
* ⚡ **Cyberpunk Neon**
* ✒️ **Ink & Wash** (Wuxia/Ancient)
* 🌸 **Cherry Blossom** (Romance)
* 📜 **Epic Scroll** (D&D/Fantasy)
* 💋 **Rouge Velvet** (Vampire/Mature)
* 🛸 **Holographic Sci-Fi**
* ⚙️ **Steampunk Brass**
* 📼 **Retro Classic**
* 🌑 **Obsidian Dark**
* 🟢 **Tactical HUD**

---

## 💡 Architecture Details (How it Works)

To guarantee lightning-fast response times and protect GPU resources, this project employs multi-layer optimization:

### 1. Smart MD5 Caching
`Hash = MD5(Text Content + Emotion Tag + Reference Path + Prompt)`
* **Memory/Disk Dual Check**: RAM priority, Disk fallback.
* **0 GPU Footprint**: Cache hits completely bypass the GPU, reducing response time to < 10ms.

### 2. Auto Pre-generation & Queuing
* **Silent Parsing**: Parses `[TTSVoice]` tags from AI replies in the background.
* **FIFO Pipeline**: Tasks are processed sequentially to avoid CUDA Out-Of-Memory errors.
* **Seamless UX**: By the time the user finishes reading the text and clicks the bubble, the audio is already generated.

### 3. Database Persistence
* **SQLite Database**: Saved voice clips are persistently stored via SQLite.
* **Fingerprinting**: Uses Message ID and Content Hash `m{mesid}_{content_hash}` for precise data matching.

---

## 🚀 Installation & Usage

*(Please refer to the Chinese documentation or the standard SillyTavern extension installation process for detailed instructions).*
