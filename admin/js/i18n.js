const I18N_DICT = {
    "zh": {
        // This is a dummy key to prevent empty translation mapping when checking.
        // We will keep 'zh' as original text.
    },
    "en": {
        "SillyTavern GPT-SoVITS 管理面板": "SillyTavern GPT-SoVITS Admin Panel",
        "🎙️ TTS 管理": "🎙️ TTS Admin",
        "仪表盘": "Dashboard",
        "模型管理": "Models",
        "音频管理": "Audio",
        "系统配置": "Settings",
        "系统仪表盘": "System Dashboard",
        "🔄 刷新状态": "🔄 Refresh Status",
        "🎙️ GPT-SoVITS 服务": "🎙️ GPT-SoVITS Service",
        "检测中...": "Checking...",
        "地址:": "Address:",
        "状态:": "Status:",
        "⚡ 后端服务": "⚡ Backend Service",
        "运行中": "Running",
        "未运行": "Stopped",
        "端口:": "Port:",
        "API:": "API:",
        "🔄 版本更新": "🔄 Version Update",
        "当前版本:": "Current Ver:",
        "最新版本:": "Latest Ver:",
        "⚠️ 检测到 Git 仓库,请使用 git pull 更新": "⚠️ Git Repo detected, please update using git pull",
        "⬇️ 立即更新": "⬇️ Update Now",
        "更新中...": "Updating...",
        "🚀 推理后端": "🚀 Inference Backend",
        "📦 GPT-SoVITS 安装配置": "📦 GPT-SoVITS Config",
        "未配置": "Unconfigured",
        "已配置": "Configured",
        "GPU 类型": "GPU Type",
        "NVIDIA 通用版 (RTX 20/30/40)": "NVIDIA General (RTX 20/30/40)",
        "NVIDIA 50系列 (RTX 50)": "NVIDIA 50 Series (RTX 50)",
        "AMD 版 (暂未提供)": "AMD Version (WIP)",
        "GPT-SoVITS 安装路径": "GPT-SoVITS Install Path",
        "GPT-SoVITS 整合包的根目录（包含 api_v2.py 的目录）": "Root directory of GPT-SoVITS package (contains api_v2.py)",
        "启动插件时自动启动 GPT-SoVITS API": "Auto-start GPT-SoVITS API when plugin starts",
        "💾 保存配置": "💾 Save Config",
        "▶️ 启动服务": "▶️ Start Service",
        "⏹️ 停止服务": "⏹️ Stop Service",
        "🧪 测试连接": "🧪 Test Connection",
        "💡 下载整合包：原作者仓库：https://github.com/RVC-Boss/GPT-SoVITS": "💡 Download Package: Original Repo: https://github.com/RVC-Boss/GPT-SoVITS",
        "📥 NVIDIA 通用版": "📥 NVIDIA General",
        "📥 NVIDIA 50系列版": "📥 NVIDIA 50 Series",
        "➕ 创建新模型": "➕ Create Model",
        "加载中...": "Loading...",
        "参考音频管理": "Reference Audio Management",
        "选择模型...": "Select model...",
        "请选择模型...": "Please select model...",
        "🏷️ 批量修改情感": "🏷️ Batch Edit Emotions",
        "⬆️ 上传音频": "⬆️ Upload Audio",
        "请先选择一个模型": "Please select a model first",
        "📁 基础配置": "📁 Basic Config",
        "🧠 分析引擎": "🧠 Analysis Engine",
        "📞 电话功能": "📞 Phone Features",
        "模型目录路径": "Models Directory Path",
        "存放 GPT-SoVITS 模型的根目录": "Root directory for GPT-SoVITS models",
        "缓存目录路径": "Cache Directory Path",
        "存放生成音频缓存的目录": "Directory for storing generated audio cache",
        "GPT-SoVITS API 地址": "GPT-SoVITS API Address",
        "GPT-SoVITS 推理服务的 API 地址": "API address of GPT-SoVITS inference service",
        "默认语言": "Default Language",
        "中文": "Chinese",
        "日语": "Japanese",
        "英语": "English",
        "📄 消息处理（共享）": "📄 Message Processing (Shared)",
        "消息提取标签": "Message Extract Tag",
        "提取特定标签内的内容(如 <conxt>...</conxt>),留空则不提取": "Extract content within specific tags (e.g. <conxt>...</conxt>), leave empty to not extract",
        "消息过滤标签": "Message Filter Tags",
        "过滤 chat 消息中的标签内容,支持三种格式:\n1. <xxx> - 过滤 HTML 风格标签\n2. [xxx] - 过滤方括号风格标签\n3. 前缀|后缀 - 过滤自定义前后缀包裹的内容\n多个标签用逗号分隔": "Filter tags in chat messages, supports 3 formats:\n1. <xxx> - HTML style\n2. [xxx] - Bracket style\n3. prefix|suffix - Custom prefix/suffix\nSeparate multiple with commas",
        "🧠 分析引擎配置": "🧠 Analysis Engine Config",
        "启用分析引擎": "Enable Analysis Engine",
        "启用": "Enable",
        "禁用": "Disable",
        "是否启用持续分析功能": "Whether to enable continuous analysis feature",
        "分析间隔（楼层）": "Analysis Interval (Turns)",
        "每隔多少轮对话触发一次分析": "Trigger analysis every N dialogue turns",
        "触发阈值": "Trigger Threshold",
        "行动触发的评分阈值 (0-100)影响触发频率": "Score threshold (0-100) for triggering actions, affects frequency",
        "🤖 分析 LLM 配置": "🤖 Analysis LLM Config",
        "API 地址": "API Address",
        "用于角色状态分析的 LLM API 地址": "LLM API address for character state analysis",
        "API Key": "API Key",
        "模型": "Model",
        "🔄 获取模型列表": "🔄 Fetch Models",
        "用于角色状态分析的 LLM 模型": "LLM model for character state analysis",
        "温度": "Temperature",
        "最大 Token 数": "Max Tokens",
        "启用电话呼叫": "Enable Phone Call",
        "是否启用主动电话呼叫功能": "Whether to enable proactive phone call feature",
        "🤖 电话 LLM 配置": "🤖 Phone LLM Config",
        "LLM API 地址": "LLM API Address",
        "LLM 服务的 API 地址": "API address of LLM service",
        "LLM API Key": "LLM API Key",
        "LLM 服务的 API 密钥": "API key of LLM service",
        "LLM 模型": "LLM Model",
        "使用的 LLM 模型名称,点击上方按钮从 API 获取可用模型": "LLM model name to use, click button above to fetch from API",
        "LLM 温度": "LLM Temperature",
        "控制生成文本的随机性 (0.0-2.0)": "Controls randomness of generated text (0.0-2.0)",
        "LLM 最大 Token 数": "LLM Max Tokens",
        "LLM 生成的最大 Token 数量 (默认: 5000)": "Max tokens generated by LLM (Default: 5000)",
        "🎙️ TTS 配置": "🎙️ TTS Config",
        "文本语言": "Text Language",
        "中文 (zh)": "Chinese (zh)",
        "英语 (en)": "English (en)",
        "日语 (ja)": "Japanese (ja)",
        "生成语音的文本语言": "Text language for generated speech",
        "提示语言": "Prompt Language",
        "提示词的语言": "Language of the prompt",
        "文本分割方法": "Text Split Method",
        "cut0 - 不分割": "cut0 - No split",
        "cut1 - 按标点分割": "cut1 - Split by punctuation",
        "cut2 - 按句子分割": "cut2 - Split by sentence",
        "cut3 - 按段落分割": "cut3 - Split by paragraph",
        "cut4 - 按长度分割": "cut4 - Split by length",
        "cut5 - 智能分割": "cut5 - Smart split",
        "文本分割策略": "Text splitting strategy",
        "使用辅助参考音频": "Use Aux Reference Audio",
        "否": "No",
        "是": "Yes",
        "使用辅助音频，让情绪转换的时候更加自然，但偶尔也会失真": "Use aux audio to make emotion transition more natural, but may distort occasionally",
        "创建新模型": "Create New Model",
        "模型名称": "Model Name",
        "将自动创建标准目录结构": "Will automatically create standard directory structure",
        "GPT 模型文件 (可选)": "GPT Model File (Optional)",
        "选择 .ckpt 文件,将自动复制到模型文件夹": "Select .ckpt file, will be copied to model folder",
        "SoVITS 模型文件 (可选)": "SoVITS Model File (Optional)",
        "选择 .pth 文件,将自动复制到模型文件夹": "Select .pth file, will be copied to model folder",
        "上传中...": "Uploading...",
        "取消": "Cancel",
        "创建": "Create",
        "上传参考音频": "Upload Reference Audio",
        "语言": "Language",
        "情感标签": "Emotion Tag",
        "音频文件": "Audio File",
        "上传": "Upload",
        "重命名音频": "Rename Audio",
        "新文件名": "New Filename",
        "可以包含正常标点符号,文件名即为音频字幕内容": "Can contain normal punctuation, filename is the audio subtitle content",
        "确认": "Confirm",
        "批量修改情感前缀": "Batch Edit Emotion Prefix",
        "旧情感标签": "Old Emotion Tag",
        "将匹配所有以 \"旧情感_\" 开头的文件": "Will match all files starting with 'OldEmotion_'",
        "新情感标签": "New Emotion Tag",
        "将替换为 \"新情感_\" 前缀": "Will replace with 'NewEmotion_' prefix",
        "📢 重要通知": "📢 Important Notice",
        "欢迎使用 SillyTavern GPT-SoVITS 管理面板！": "Welcome to SillyTavern GPT-SoVITS Admin Panel!",
        "本插件永久免费，包括模型资源！如果你用到了需要收费的，请加群联系作者！": "This plugin is permanently free, including model resources! If you encounter paid versions, please contact the author!",
        "V2.0版本 情感引擎已上线！多人对话！": "V2.0 Emotion Engine is online! Multi-character chat!",
        "请前往系统配置完成设置后使用：": "Please go to Settings to configure before use:",
        "确认填好api与密钥": "Confirm API and Key are filled",
        "测试连接是否正常，保存设置": "Test connection and save settings",
        "🎉 欢迎加入作者大本营Q群：571745067": "🎉 Welcome to author's QQ group: 571745067",
        "免费模型分享 · 版本通知 · 日常交流": "Free model sharing · Update notices · Chat",
        "我知道了": "Got it",
        // js strings
        "正在刷新...": "Refreshing...",
        "无法连接": "Cannot connect",
        "可访问": "Accessible",
        "加载失败,请检查后端服务": "Failed to load, check backend service",
        "加载失败": "Failed to load",
        "暂无模型,点击右上角创建新模型": "No models yet, click top right to create",
        "GPT 权重 (*.ckpt)": "GPT Weights (*.ckpt)",
        "SoVITS 权重 (*.pth)": "SoVITS Weights (*.pth)",
        "参考音频目录": "Reference Audio Dir",
        "音频总数": "Total Audio",
        "情感类型": "Emotion Types",
        "文件大小超过2GB限制": "File size exceeds 2GB limit",
        "请输入模型名称": "Please enter model name",
        "正在创建模型...": "Creating model...",
        "正在上传文件...": "Uploading file...",
        "处理中...": "Processing...",
        "创建失败,请检查后端服务": "Creation failed, check backend service",
        "创建失败": "Creation failed",
        "该模型暂无参考音频": "No reference audio for this model",
        "请先选择模型": "Please select a model first",
        "请选择音频文件": "Please select an audio file",
        "上传成功": "Upload successful",
        "上传失败,请检查后端服务": "Upload failed, check backend service",
        "上传失败": "Upload failed",
        "确定要删除这个音频文件吗?\\n\\n⚠️ 注意:删除后无法恢复!!": "Are you sure you want to delete this audio file?\n\n⚠️ Warning: Cannot be restored after deletion!!",
        "确定要删除这个音频文件吗?\n\n⚠️ 注意:删除后无法恢复!!": "Are you sure you want to delete this audio file?\n\n⚠️ Warning: Cannot be restored after deletion!!",
        "删除成功": "Delete successful",
        "删除失败": "Delete failed",
        "请输入新文件名": "Please enter a new filename",
        "重命名成功": "Rename successful",
        "重命名失败": "Rename failed",
        "请输入旧情感和新情感标签": "Please enter old and new emotion tags",
        "批量修改失败": "Batch edit failed",
        "请先填写 LLM API 地址和密钥": "Please fill in LLM API address and key first",
        "请先填写分析引擎 LLM API 地址和密钥": "Please fill in Analysis LLM API address and key first",
        "请先选择或输入模型名称": "Please select or enter model name",
        "请先选择分析引擎模型": "Please select an analysis engine model first",
        "测试中...": "Testing...",
        "连接成功! LLM 响应:": "Connection successful! LLM Response:",
        "✅ 连接成功! LLM 响应: ": "✅ Connection successful! LLM Response: ",
        "连接失败:": "Connection failed:",
        "❌ 连接失败: ": "❌ Connection failed: ",
        "获取中...": "Fetching...",
        "未找到可用模型": "No available models found",
        "获取模型失败:": "Failed to fetch models:",
        "测试连接失败": "Test connection failed",
        "配置保存成功": "Configuration saved successfully",
        "保存失败": "Save failed",
        "请填写 GPT-SoVITS 安装路径": "Please fill in GPT-SoVITS install path",
        "GPT-SoVITS 配置已保存": "GPT-SoVITS config saved",
        "保存配置失败": "Failed to save config",
        "请填写压缩包路径": "Please fill in archive path",
        "请填写解压目标目录": "Please fill in extract target directory",
        "正在解压，请稍候（文件较大，可能需要几分钟）...": "Extracting, please wait (large file, may take a few minutes)...",
        "解压完成！路径:": "Extraction complete! Path:",
        "解压完成！已自动填充安装路径": "Extraction complete! Auto-filled install path",
        "解压失败": "Extract failed",
        "解压失败，请检查路径是否正确": "Extract failed, please check if path is correct",
        "正在启动 GPT-SoVITS 服务...": "Starting GPT-SoVITS service...",
        "GPT-SoVITS 服务已启动 (PID:": "GPT-SoVITS service started (PID:",
        "启动服务失败": "Failed to start service",
        "正在停止 GPT-SoVITS 服务...": "Stopping GPT-SoVITS service...",
        "GPT-SoVITS 服务已停止": "GPT-SoVITS service stopped",
        "停止服务失败": "Failed to stop service",
        "正在测试连接...": "Testing connection...",
        "连接成功！端口:": "Connection successful! Port:",
        "有新版本": "Update Available",
        "已是最新": "Up to Date",
        "检测失败": "Check Failed",
        "网络错误": "Network Error",
        "确定要更新到最新版本吗?\\n\\n更新过程中请勿关闭浏览器或服务器。\\n您的配置和数据将被保留。": "Are you sure you want to update to the latest version?\n\nPlease do not close your browser or server during the update.\nYour configuration and data will be preserved.",
        "确定要更新到最新版本吗?\n\n更新过程中请勿关闭浏览器或服务器。\n您的配置和数据将被保留。": "Are you sure you want to update to the latest version?\n\nPlease do not close your browser or server during the update.\nYour configuration and data will be preserved.",
        "正在准备更新...": "Preparing update...",
        "更新完成!": "Update complete!",
        "更新成功!即将自动重启服务...": "Update successful! Restarting service...",
        "正在重启服务...": "Restarting service...",
        "服务正在重启,5秒后刷新页面...": "Service restarting, will refresh in 5 seconds...",
        "更新失败": "Update failed",
        "请选择.ckpt文件": "Please select a .ckpt file",
        "请选择.pth文件": "Please select a .pth file"
    }
};

let currentLang = localStorage.getItem('admin_lang') || 'zh';

window.t = function(text) {
    if (!text) return text;
    const cleanText = text.trim();
    if (I18N_DICT[currentLang] && I18N_DICT[currentLang][cleanText]) {
        return text.replace(cleanText, I18N_DICT[currentLang][cleanText]);
    }
    return text;
};

window.tTemplate = function(text) {
    if (I18N_DICT[currentLang] && I18N_DICT[currentLang][text]) {
        return I18N_DICT[currentLang][text];
    }
    return text;
};

window.translateDOM = function(root = document.body) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while(node = walk.nextNode()) {
        const text = node.nodeValue.trim();
        if (text) {
            if (typeof node.originalText === 'undefined') {
                node.originalText = text;
                node.originalFullText = node.nodeValue;
            }
            if (I18N_DICT[currentLang] && I18N_DICT[currentLang][node.originalText]) {
                node.nodeValue = node.originalFullText.replace(node.originalText, I18N_DICT[currentLang][node.originalText]);
            } else if (currentLang === 'zh') {
                node.nodeValue = node.originalFullText;
            }
        }
    }

    const inputs = root.querySelectorAll('input[placeholder], textarea[placeholder]');
    inputs.forEach(input => {
        if (typeof input.originalPlaceholder === 'undefined') {
            input.originalPlaceholder = input.getAttribute('placeholder');
        }
        if (I18N_DICT[currentLang] && I18N_DICT[currentLang][input.originalPlaceholder]) {
            input.setAttribute('placeholder', I18N_DICT[currentLang][input.originalPlaceholder]);
        } else if (currentLang === 'zh') {
            input.setAttribute('placeholder', input.originalPlaceholder);
        }
    });
};

window.switchLanguage = function() {
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('admin_lang', currentLang);
    updateLanguageToggleBtn();
    translateDOM();
    
    // Some dynamic renders might need re-render
    if (typeof loadModels === 'function') loadModels();
    if (typeof populateModelSelect === 'function') populateModelSelect();
    if (typeof loadAudios === 'function') {
        const audioSelect = document.getElementById('audio-model-select');
        if(audioSelect && audioSelect.value) {
            loadAudios();
        }
    }
    if (typeof loadDashboard === 'function') loadDashboard();
    if (typeof loadSovitsConfig === 'function') loadSovitsConfig();
};

function updateLanguageToggleBtn() {
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) {
        btn.textContent = currentLang === 'zh' ? '🌐 English' : '🌐 中文';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Add language toggle button dynamically to header or sidebar
    const sidebarLogo = document.querySelector('.sidebar .logo');
    if (sidebarLogo) {
        const btn = document.createElement('button');
        btn.id = 'lang-toggle-btn';
        btn.className = 'btn btn-secondary';
        btn.style.marginTop = '10px';
        btn.onclick = window.switchLanguage;
        sidebarLogo.appendChild(btn);
        updateLanguageToggleBtn();
    }
    
    translateDOM();
});
