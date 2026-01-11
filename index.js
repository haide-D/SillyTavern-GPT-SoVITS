(function () {
    // ================= 配置区域 =================
    // 1. 读取本地存储配置 (这是开关的核心，存了 IP 和 开关状态)
    const lsConfig = localStorage.getItem('tts_plugin_remote_config');
    let remoteConfig = lsConfig ? JSON.parse(lsConfig) : { useRemote: false, ip: "" };

    // 2. 动态决定 API 地址逻辑
    let apiHost = "127.0.0.1";

    if (remoteConfig.useRemote && remoteConfig.ip) {
        // A. 如果用户手动开了开关并填了 IP (针对 Termux 情况)
        apiHost = remoteConfig.ip;
    } else {
        // B. 智能自动模式 (针对 电脑本地 或 手机直接访问电脑网页 情况)
        // 如果当前浏览器地址栏是 localhost 或 127.0.0.1，就用本地
        // 如果当前地址栏是 192.168.x.x，就自动沿用这个 IP
        const current = window.location.hostname;
        apiHost = (current === 'localhost' || current === '127.0.0.1') ? '127.0.0.1' : current;
    }

    // 最终生成的 API 地址
    const MANAGER_API = `http://${apiHost}:3000`;


    // ===========================================

    let CACHE = {
        models: {}, mappings: {}, settings: { auto_generate: true, enabled: true },
        audioMemory: {}, pendingTasks: new Set()
    };

    let CURRENT_LOADED = { gpt_path: null, sovits_path: null };
    // === 新增：Iframe 样式配置 (修复闪烁版) ===
    // === 新增：Iframe 样式配置 (新UI容器 + 旧版波动条) ===
    const IFRAME_CSS = `
        .voice-bubble {
            display: inline-flex !important; align-items: center; vertical-align: middle; margin-left: 6px;
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 16px; padding: 4px 12px; cursor: pointer;
            height: 28px; box-sizing: border-box;
            transition: all 0.2s ease;
            font-family: sans-serif; user-select: none;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            backdrop-filter: blur(2px);

            min-width: 85px;
            justify-content: space-between;
            white-space: nowrap;
        }


        .sovits-voice-waves { display: flex; align-items: center; height: 16px; margin-right: 6px; gap: 2px; }
        .sovits-voice-bar {
            width: 3px; border-radius: 2px;
            height: 6px; /* 默认静止高度 */
            transition: background 0.3s, height 0.2s;
        }

        /* 3. 时间文字 */
        .sovits-voice-duration { font-size: 12px; font-weight: 600; line-height: 1; color: #666; }

        /* === 状态 A: 未生成 (Waiting) - 灰色条 === */
        .voice-bubble[data-status="waiting"] { background: #f3f4f6; border-color: #e5e7eb; color: #888; }
        .voice-bubble[data-status="waiting"] .sovits-voice-bar { background: #bdbdbd; height: 4px; }
        .voice-bubble[data-status="waiting"]:hover { background: #e0e0e0; }

        /* === 状态 B: 加载中 (Loading) - 呼吸灯 === */
        .voice-bubble.loading {
            background: #fff8e1; border-color: #ffe0b2; cursor: wait;
            animation: tts-pulse 1.5s infinite;
        }
        .voice-bubble.loading .sovits-voice-bar { background: #ffb74d; height: 6px; }
        @keyframes tts-pulse { 0% {opacity:0.6;} 50% {opacity:1;} 100% {opacity:0.6;} }

        /* === 状态 C: 生成完毕 (Ready) - 绿色静止条 === */
        .voice-bubble[data-status="ready"] {
            background: #e8f5e9 !important;
            border-color: #81c784 !important;
            color: #2e7d32 !important;
            box-shadow: 0 2px 5px rgba(76, 175, 80, 0.15);
            animation: none !important; cursor: pointer !important; opacity: 1 !important;
        }
        /* 关键：把条变成绿色 */
        .voice-bubble[data-status="ready"] .sovits-voice-bar { background: #4caf50; height: 8px; }
        .voice-bubble[data-status="ready"]:hover {
            transform: translateY(-1px); background: #c8e6c9 !important;
        }

        /* === 状态 D: 播放中 (Playing) - 粉色律动条 === */
        .voice-bubble.playing {
            background: #fff0f5 !important; border-color: #ff80ab !important;
            color: #c2185b !important;
            box-shadow: 0 0 12px rgba(255, 64, 129, 0.4) !important;
            transform: scale(1.05); cursor: default;
        }
        /* 条变粉色，并开始跳动 */
        .voice-bubble.playing .sovits-voice-bar {
            background: #e91e63;
            animation: sovits-wave-anim 1s infinite ease-in-out;
        }
        /* 错开动画时间，更灵动 */
        .voice-bubble.playing .sovits-voice-bar:nth-child(1) { animation-delay: 0.0s; }
        .voice-bubble.playing .sovits-voice-bar:nth-child(2) { animation-delay: 0.15s; }
        .voice-bubble.playing .sovits-voice-bar:nth-child(3) { animation-delay: 0.3s; }

        /* 定义波动动画 */
        @keyframes sovits-wave-anim {
            0%, 100% { height: 6px; opacity: 0.6; }
            50% { height: 16px; opacity: 1; }
        }
    `;
    // ===========================
    function injectStyles() {
        if ($('#tts-style-injection').length > 0) return;
        const css = `
        /* === 1. 悬浮球按钮 === */
        #tts-manager-btn {
            position: fixed; top: 10px; right: 100px; z-index: 20000;
            background: rgba(0,0,0,0.7); color: #fff; padding: 6px 12px;
            border-radius: 4px; cursor: pointer; border: 1px solid rgba(255,255,255,0.3);
            font-size: 13px;
            touch-action: none; user-select: none; /* 防止拖拽滚动 */
        }

        /* === 2. 气泡与动画 === */
        #tts-notification-bar {
            position: fixed; top: -50px; left: 50%; transform: translateX(-50%);
            z-index: 20005; background: #d32f2f; color: white;
            padding: 8px 20px; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            font-size: 14px; transition: top 0.5s ease; pointer-events: none;
            display: flex; align-items: center; gap: 8px; width: 90%; justify-content: center;
        }
        #tts-notification-bar.show { top: 20px; }

        .voice-bubble {
            display: inline-flex; vertical-align: text-bottom; align-items: center; gap: 6px;
            padding: 1px 6px; background: #c6e2b8; border-radius: 4px; cursor: pointer;
            user-select: none; min-width: 40px; max-width: 250px; height: 24px;
            box-sizing: border-box; margin: 0 1px 0 3px; position: relative;
            box-shadow: 0 1px 1px rgba(0,0,0,0.1); white-space: nowrap; font-size: 13px;
        }
        .voice-bubble:hover { filter: brightness(0.95); }
        .voice-bubble.playing .sovits-voice-bar { animation: sovits-wave-anim 1.2s infinite ease-in-out; }
        .sovits-voice-waves { display: flex; align-items: center; justify-content: flex-end; gap: 2px; width: 18px; height: 16px; }
        .sovits-voice-bar { width: 3px; background: #333; border-radius: 1.5px; opacity: 0.8; height: 6px; }
        @keyframes sovits-wave-anim {
            0%, 100% { height: 6px; opacity: 0.5; }
            50% { height: 14px; opacity: 1; }
        }
        .voice-bubble.error { background: #ffcccc !important; border: 1px solid #ffaaaa; }
        .voice-bubble.loading { opacity: 0.6; filter: grayscale(0.5); cursor: wait; }

        /* === 3. 控制面板样式 (修复手机显示不全) === */
        .tts-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.6); z-index: 20001;
            /* 关键修改1：父容器只负责铺满，不负责强制对齐 */
            display: flex;
            /* 允许点击遮罩层关闭时的触摸穿透处理（可选） */
        }
        .tts-panel {
            background: #2b2b2b; color: #eee;

            /* 关键修改2：使用 margin: auto 实现“智能居中” */
            /* 空间够时它会居中；空间不够(如下半部分被键盘顶住)时，它会优先显示顶部 */
            margin: auto;

            width: 95%;
            max-width: 500px;

            /* 关键修改3：降低最大高度，给手机浏览器地址栏和底部工具栏留余地 */
            max-height: 75vh;

            border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);

            /* 关键修改4：确保伸缩布局正确，让中间内容区能滚动 */
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid #444; font-family: sans-serif;
        }
        .tts-header {
            padding: 12px 15px; background: #222; border-bottom: 1px solid #444;
            display: flex; justify-content: space-between; align-items: center;
            flex-shrink: 0; /* 防止头部被压缩 */
        }
        .tts-header h3 { margin: 0; font-size: 16px; }
        .tts-close {
            background: none; border: none; color: #aaa; font-size: 24px;
            cursor: pointer; line-height: 1; padding: 0 5px;
        }
        .tts-content {
            padding: 15px;
            /* 关键修改5：flex: 1 让这个区域自动填满剩余空间，并负责滚动 */
            flex: 1;
            overflow-y: auto;
            min-height: 0; /* 防止 flex 子项无法滚动的兼容性 bug */
            -webkit-overflow-scrolling: touch;
        }

        .tts-settings-zone input[type="text"] {
            background: #1a1a1a; border: 1px solid #444; color: #fff;
            padding: 4px; border-radius: 3px; margin-top: 2px;
        }
        .tts-add-zone, .tts-list-zone { margin-top: 15px; }

        /* 让输入框在手机上自动换行，避免挤压 */
        .tts-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; flex-wrap: wrap; }
        .tts-sub-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; flex-wrap: wrap; }

        .tts-row input, .tts-row select {
            flex: 1; background: #333; color: white; border: 1px solid #555; padding: 8px 5px; /* 手机上增加点点击区域 */
            min-width: 100px; /* 防止缩得太小 */
        }
        .tts-list-container {
            border: 1px solid #444; background: #1f1f1f; max-height: 200px; overflow-y: auto;
            border-radius: 4px;
        }
        .tts-list-item {
            display: flex; justify-content: space-between; padding: 8px;
            border-bottom: 1px solid #333; align-items: center; font-size: 13px;
        }
        .tts-list-item:last-child { border-bottom: none; }
        .col-name { font-weight: bold; color: #81c784; }
        .col-model { color: #aaa; margin-left: 10px; flex: 1; word-break: break-all; /* 防止长路径撑开 */ }
        .btn-blue { background: #1976d2; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 6px 12px;}
        .btn-red { background: #d32f2f; color: white; border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; }
    `;
        $('head').append(`<style id="tts-style-injection">${css}</style>`);
    }
    // 新增：显示顶部提示
    function showNotification(msg, type = 'error') {
        let $bar = $('#tts-notification-bar');
        if ($bar.length === 0) {
            $('body').append(`<div id="tts-notification-bar"></div>`);
            $bar = $('#tts-notification-bar');
        }

        const bgColor = type === 'error' ? '#d32f2f' : '#43a047';
        $bar.text(msg).css('background', bgColor).addClass('show');

        // 3秒后自动消失
        setTimeout(() => { $bar.removeClass('show'); }, 4000);
    }

    async function refreshData() {
        try {
            injectStyles();
            // 尝试连接后端
            const res = await fetch(`${MANAGER_API}/get_data`);
            // === 读取本地存储的美化卡开关 ===
            const localIframeMode = localStorage.getItem('tts_plugin_iframe_mode');
            // 如果本地有记录，则覆盖；否则默认 false (普通模式)
            CACHE.settings.iframe_mode = localIframeMode === 'true';
            // 如果连接成功，恢复按钮样式（如果是红色的话）
            $('#tts-manager-btn').css({ 'border-color': 'rgba(255,255,255,0.3)', 'color': '#fff' }).text('🔊 TTS配置');

            const data = await res.json();
            CACHE.models = data.models; CACHE.mappings = data.mappings;
            if (data.settings) CACHE.settings = { ...CACHE.settings, ...data.settings };
            CACHE.pendingTasks.clear();

            // 只有开启总开关时，才进行自动扫描
            if (CACHE.settings.enabled !== false && CACHE.settings.auto_generate) BatchScheduler.scanAndSchedule();

            // 连接成功提示 (可选，为了不打扰用户通常只提示错误，这里可以注释掉)
            // showNotification("TTS 后端连接成功", "success");

        } catch (e) {
            console.error("TTS Backend Error:", e);

            // === 这里是新增的错误处理 ===
            // 1. 弹出顶部提示
            showNotification("❌ 连接失败：未检测到 TTS 后端服务！请检查是否已运行 main.py", "error");

            // 2. 将右上角按钮标红，警示用户
            $('#tts-manager-btn').css({ 'border-color': '#ff5252', 'color': '#ff5252' }).text('⚠️ TTS断开');
        }
    }

    // 切换总开关
    async function toggleMasterSwitch(checked) {
        CACHE.settings.enabled = checked;
        // 如果开启，立即扫描一次页面
        if (checked) processMessageContent();

        try {
            await fetch(`${MANAGER_API}/update_settings`, {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ enabled: checked })
            });
        } catch(e) {}
    }

    async function toggleAutoGenerate(checked) {
        CACHE.settings.auto_generate = checked;
        try {
            await fetch(`${MANAGER_API}/update_settings`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ auto_generate: checked }) });
            if (checked && CACHE.settings.enabled !== false) BatchScheduler.scanAndSchedule();
        } catch(e) {}
    }

    const BatchScheduler = {
        queue: [], isRunning: false,
        updateStatus($btn, status) {
            $btn.attr('data-status', status).removeClass('playing loading error');
            if (status === 'queued' || status === 'generating') $btn.addClass('loading');
            else if (status === 'error') $btn.addClass('error');
        },
        getTaskKey(charName, text) { return `${charName}_${text}`; },
        // === 新增：模型完整性校验函数 ===
        validateModel(modelName, config) {
            let missing = [];
            if (!config.gpt_path) missing.push("GPT权重");
            if (!config.sovits_path) missing.push("SoVITS权重");

            // 检查是否有任意一种语言的音频
            const langs = config.languages || {};
            if (Object.keys(langs).length === 0) {
                missing.push("参考音频(reference_audios)");
            }

            if (missing.length > 0) {
                showNotification(`❌ 模型 "${modelName}" 缺失: ${missing.join(', ')}`, 'error');
                return false;
            }
            return true;
        },
        scanAndSchedule() {
            // 如果总开关关闭，不执行扫描
            if (CACHE.settings.enabled === false) return;

            const $lastMessage = $('.mes_text').last();
            $lastMessage.find('.voice-bubble[data-status="waiting"]').each((_, btn) => {
                const charName = $(btn).data('voice-name');
                if (CACHE.mappings[charName]) {
                    this.addToQueue($(btn));
                }
            });
            if (!this.isRunning && this.queue.length > 0) this.run();
        },
        addToQueue($btn) {
            if ($btn.attr('data-status') !== 'waiting') return;
            const charName = $btn.data('voice-name');
            const text = $btn.data('text');
            const key = this.getTaskKey(charName, text);
            if (CACHE.audioMemory[key]) { $btn.data('audio-url', CACHE.audioMemory[key]); this.updateStatus($btn, 'ready'); return; }
            if (CACHE.pendingTasks.has(key)) { this.updateStatus($btn, 'queued'); return; }
            this.updateStatus($btn, 'queued'); CACHE.pendingTasks.add(key);
            this.queue.push({ charName, emotion: $btn.data('voice-emotion'), text, key, $btn });
        },
        async run() {
            if (CACHE.settings.enabled === false) { this.isRunning = false; this.queue = []; return; }

            this.isRunning = true;
            let groups = {}; let unboundTasks = [];
            while(this.queue.length > 0) {
                const task = this.queue.shift();
                if (CACHE.audioMemory[task.key]) { this.finishTask(task.key, CACHE.audioMemory[task.key]); continue; }
                const mName = CACHE.mappings[task.charName];
                if (!mName) { unboundTasks.push(task); continue; }
                if (!groups[mName]) groups[mName] = [];
                groups[mName].push(task);
            }
            unboundTasks.forEach(t => { this.updateStatus(t.$btn, 'error'); CACHE.pendingTasks.delete(t.key); });

            for (const modelName of Object.keys(groups)) {
                const tasks = groups[modelName];
                const modelConfig = CACHE.models[modelName];
                // 如果模型配置不存在，或者 校验缺失文件
                if (!modelConfig || !this.validateModel(modelName, modelConfig)) {
                    console.warn(`[TTS] Model ${modelName} is missing files. Skipping generation.`);
                    // 将该组所有任务标记为 Error，并不发送请求
                    tasks.forEach(t => {
                        this.updateStatus(t.$btn, 'error');
                        CACHE.pendingTasks.delete(t.key);
                    });
                    continue; // 直接跳过，不执行后面的 switchModel 和 processSingleTask
                }
                const checkPromises = tasks.map(async (task) => {
                    if (CACHE.audioMemory[task.key]) return { task, cached: true };
                    const cached = await this.checkCache(task, modelConfig);
                    return { task, cached };
                });
                const results = await Promise.all(checkPromises);
                const tasksToGenerate = [];
                for (const res of results) {
                    if (res.cached) await this.processSingleTask(res.task, modelConfig);
                    else tasksToGenerate.push(res.task);
                }
                if (tasksToGenerate.length > 0) {
                    try {
                        await this.switchModel(modelConfig);
                        for (const task of tasksToGenerate) await this.processSingleTask(task, modelConfig);
                    } catch (e) { tasksToGenerate.forEach(t => { this.updateStatus(t.$btn, 'error'); CACHE.pendingTasks.delete(t.key); }); }
                }
            }
            this.isRunning = false;
            if (this.queue.length > 0) this.run();
        },
        finishTask(key, audioUrl) {
            CACHE.audioMemory[key] = audioUrl;
            CACHE.pendingTasks.delete(key);

            // 定义通用的更新逻辑
            const applyUpdate = ($el) => {
                // 1. 尝试获取 key
                let elKey = $el.attr('data-key');
                // 2. 如果是普通卡没有 data-key，则通过内容计算
                if (!elKey) {
                    elKey = this.getTaskKey($el.data('voice-name'), $el.data('text'));
                }

                // 3. 如果 Key 匹配，且状态不是 ready，则进行更新
                if (elKey === key && $el.attr('data-status') !== 'ready') {
                    // 写入音频 URL
                    $el.attr('data-audio-url', audioUrl);

                    // 【关键】：更新状态，这会自动移除 .loading 类（参见 updateStatus 函数）
                    this.updateStatus($el, 'ready');

                    // 如果是自动播放触发的，点击它
                    if ($el.data('auto-play-after-gen')) {
                        $el.click();
                        $el.removeData('auto-play-after-gen');
                    }
                }
            };

            // 范围 A: 更新主界面 (普通卡)
            $('.voice-bubble').each((_, el) => applyUpdate($(el)));

            // 范围 B: 更新 Iframe 内部 (美化卡修复核心)
            $('iframe').each(function() {
                try {
                    $(this).contents().find('.voice-bubble').each((_, el) => applyUpdate($(el)));
                } catch(e) {}
            });
        },
        async checkCache(task, modelConfig) {
            try {
                // === 修改：获取当前设置的语言 ===
                const currentLang = CACHE.settings.default_lang || 'default';

                // 从 models[name].languages 中尝试获取
                // 如果找不到选定的语言，回退到 'default'，如果还没有，取第一个可用的语言
                let availableLangs = modelConfig.languages || {};
                let targetRefs = availableLangs[currentLang];

                if (!targetRefs) {
                    if (availableLangs['default']) targetRefs = availableLangs['default'];
                    else {
                        const keys = Object.keys(availableLangs);
                        if (keys.length > 0) targetRefs = availableLangs[keys[0]];
                    }
                }

                if (!targetRefs || targetRefs.length === 0) return false;

                // 在目标语言列表中查找情感
                let ref = targetRefs.find(r => r.emotion === task.emotion);
                // 如果找不到对应情感，找该语言下的 default
                if (!ref) ref = targetRefs.find(r => r.emotion === 'default');
                // 如果还找不到，取该语言下的第一个
                if (!ref) ref = targetRefs[0];

                if (!ref) return false;
                // === 修改结束 ===

                const params = new URLSearchParams({ text: task.text, text_lang: "zh", ref_audio_path: ref.path, prompt_text: ref.text, prompt_lang: "zh", streaming_mode: "true", check_only: "true" });
                const res = await fetch(`${MANAGER_API}/tts_proxy?${params}`);
                return (await res.json()).cached === true;
            } catch { return false; }
        },
        async  switchModel(config) {
            if (CURRENT_LOADED.gpt_path === config.gpt_path && CURRENT_LOADED.sovits_path === config.sovits_path) return;

            // 修改：不再请求 SOVITS_API，而是请求 MANAGER_API 的代理接口
            const safeSwitch = async (endpoint, path) => {
                // 注意这里使用的是 MANAGER_API
                await fetch(`${MANAGER_API}/${endpoint}?weights_path=${path}`);
            };

            if (CURRENT_LOADED.gpt_path !== config.gpt_path) {
                await safeSwitch('proxy_set_gpt_weights', config.gpt_path);
                CURRENT_LOADED.gpt_path = config.gpt_path;
            }
            if (CURRENT_LOADED.sovits_path !== config.sovits_path) {
                await safeSwitch('proxy_set_sovits_weights', config.sovits_path);
                CURRENT_LOADED.sovits_path = config.sovits_path;
            }
        },
        async processSingleTask(task, modelConfig) {
            const { text, emotion, key, $btn } = task;

            // === 修改：同样的逻辑获取 ref ===
            const currentLang = CACHE.settings.default_lang || 'default';
            let availableLangs = modelConfig.languages || {};
            let targetRefs = availableLangs[currentLang];

            if (!targetRefs) {
                // 找不到指定语言，尝试回退
                if (availableLangs['default']) targetRefs = availableLangs['default'];
                else {
                    const keys = Object.keys(availableLangs);
                    if (keys.length > 0) targetRefs = availableLangs[keys[0]];
                }
            }

            if (!targetRefs) throw new Error("No ref audios found in any language");

            let ref = targetRefs.find(r => r.emotion === emotion);
            if (!ref) ref = targetRefs.find(r => r.emotion === 'default');
            if (!ref) ref = targetRefs[0];

            if (!ref) throw new Error("No ref audio");
            // === 修改结束 ===

            try {
                // 注意：prompt_lang 这里暂时写死 zh，如果你想更高级，
                // 可以根据 currentLang 来决定 prompt_lang (例如: Japanese -> ja, Chinese -> zh)
                // 简单的映射逻辑：
                let promptLangCode = "zh";
                if (currentLang === "Japanese" || currentLang === "日语") promptLangCode = "ja";
                if (currentLang === "English" || currentLang === "英语") promptLangCode = "en";

                const params = new URLSearchParams({
                    text: text,
                    text_lang: "zh", // 目标生成的文本语言，通常保持 zh 或根据实际情况
                    ref_audio_path: ref.path,
                    prompt_text: ref.text,
                    prompt_lang: promptLangCode, // 参考音频的语言
                    streaming_mode: "true"
                });
                const response = await fetch(`${MANAGER_API}/tts_proxy?${params}`);
                if (!response.ok) throw new Error("Err");
                const blob = await response.blob();
                this.finishTask(key, URL.createObjectURL(blob));
            } catch (e) { this.updateStatus($btn, 'error'); CACHE.pendingTasks.delete(key); }
        }
    };

    // === 新增：通用的拖拽函数 ===
    function makeDraggable($el, onClick) {
        let isDragging = false;
        let hasMoved = false; // 用于区分是“点击”还是“拖拽”
        let startX, startY, startLeft, startTop;

        const el = $el[0]; // 获取原生 DOM 元素

        // 开始拖拽 (兼容鼠标和触摸)
        const start = (clientX, clientY) => {
            isDragging = true;
            hasMoved = false;
            startX = clientX;
            startY = clientY;

            const rect = el.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            // 拖拽开始时，将 right 属性清除，改用 left/top 定位，否则拖不动
            el.style.right = 'auto';
            el.style.left = startLeft + 'px';
            el.style.top = startTop + 'px';

            $el.css('opacity', '0.8'); // 拖拽时稍微变透明
        };

        // 移动中
        const move = (clientX, clientY) => {
            if (!isDragging) return;

            const dx = clientX - startX;
            const dy = clientY - startY;

            // 只有移动超过一定距离才算拖拽，防止手抖误判
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                hasMoved = true;
            }

            el.style.left = (startLeft + dx) + 'px';
            el.style.top = (startTop + dy) + 'px';
        };

        // 结束拖拽
        const end = () => {
            isDragging = false;
            $el.css('opacity', '1');
            // 如果没有发生明显的移动，则视为点击
            if (!hasMoved && onClick) {
                onClick();
            }
        };

        // --- 鼠标事件监听 ---
        $el.on('mousedown', e => { start(e.clientX, e.clientY); });
        $(document).on('mousemove', e => { if(isDragging) { e.preventDefault(); move(e.clientX, e.clientY); }});
        $(document).on('mouseup', () => { if(isDragging) end(); });

        // --- 触摸事件监听 (手机端) ---
        $el.on('touchstart', e => {
            const touch = e.originalEvent.touches[0];
            start(touch.clientX, touch.clientY);
        });
        // 手机端需要在 document 上监听 move 以防止拖出按钮范围失效，但 touchmove 默认是 passive 的
        // 这里直接绑定在元素上通常够用，或者用 passive: false
        $el.on('touchmove', e => {
            if(isDragging) {
                // 阻止浏览器默认滚动
                if(e.cancelable) e.preventDefault();
                const touch = e.originalEvent.touches[0];
                move(touch.clientX, touch.clientY);
            }
        });
        $el.on('touchend', () => { if(isDragging) end(); });
    }

    // === 修改后的 initUI ===
    function initUI() {
        if ($('#tts-manager-btn').length === 0) {
            $('body').append(`<div id="tts-manager-btn">🔊 TTS配置</div>`);

            // 使用新的拖拽绑定，传入原来的点击回调 showDashboard
            makeDraggable($('#tts-manager-btn'), showDashboard);
        }
    }

    function showDashboard() {
        $('#tts-dashboard-overlay').remove();
        const currentBase = CACHE.settings.base_dir || "";
        const currentCache = CACHE.settings.cache_dir || "";
        // 获取开关状态
        const isEnabled = CACHE.settings.enabled !== false;

        // 获取当前的配置用于回显
        const savedConfig = localStorage.getItem('tts_plugin_remote_config');
        const config = savedConfig ? JSON.parse(savedConfig) : { useRemote: false, ip: "" };
        const isRemote = config.useRemote;
        const remoteIP = config.ip;

        const html = `
        <div id="tts-dashboard-overlay" class="tts-overlay">
            <div id="tts-dashboard" class="tts-panel">
                <div class="tts-header">
                    <h3>🎧 TTS 角色语音配置</h3>
                    <button class="tts-close" onclick="$('#tts-dashboard-overlay').remove()">×</button>
                </div>
                <div class="tts-content">
                <div class="tts-settings-zone" style="background:rgba(0, 0, 0, 0.15); padding:10px; border-radius:5px; margin-bottom:10px;">
                    <h4 style="margin:0 0 10px 0;">⚙️ 连接与系统设置</h4>

                    <div style="background:rgba(0,0,0,0.2); padding:8px; border-radius:4px; margin-bottom:8px; border:1px solid #555;">
                        <div style="margin-bottom:5px; font-weight:bold; color:#64b5f6;">📡 手机酒馆</div>

                        <label style="cursor:pointer; display:block; margin-bottom:5px;">
                            <input type="checkbox" id="tts-remote-switch" ${isRemote ? 'checked' : ''}>
                            开启远程连接 (手机酒馆连接到电脑Soviets模型,非手机酒馆勿开)
                        </label>

                        <div id="tts-remote-input-area" style="display:${isRemote ? 'block' : 'none'}; margin-top:5px;">
                            <small>电脑局域网 IP:</small>
                            <div style="display:flex; gap:5px;">
                                <input type="text" id="tts-remote-ip" value="${remoteIP}" placeholder="例如 192.168.1.10" style="flex:1;">
                                <button id="tts-save-remote" class="btn-blue" style="padding:4px 8px;">保存并刷新</button>
                            </div>
                            <div style="font-size:11px; color:#aaa; margin-top:3px;">
                                当前连接地址: <strong>${MANAGER_API}</strong>
                            </div>
                        </div>
                    </div>
                    <div class="tts-settings-zone" style="background:rgba(0, 0, 0, 0.15); padding:10px; border-radius:5px; margin-bottom:10px;">
                        <h4 style="margin:0 0 10px 0;">⚙️ 系统设置</h4>

                        <div style="margin-bottom:8px;">
                            <label style="cursor:pointer; user-select:none;">
                                <input type="checkbox" id="tts-master-switch" ${isEnabled ? 'checked' : ''}>
                                启用插件 (TTS总开关)
                            </label>
                        </div>

                        <div style="margin-bottom:8px;">
                            <label><input type="checkbox" id="tts-toggle-auto" ${CACHE.settings.auto_generate?'checked':''}> 收到消息时自动预加载语音</label>
                        </div>
                        <div style="margin-bottom:8px;">
                            <label style="cursor:pointer; color:#ffb74d;">
                                <input type="checkbox" id="tts-iframe-switch" ${CACHE.settings.iframe_mode ? 'checked' : ''}>
                                启用美化卡/Iframe模式 (普通卡请关闭此项)
                            </label>
                        </div>
                        <div class="tts-row-input">
                            <small>模型文件夹 (绝对路径):</small>
                            <input type="text" id="tts-base-path" value="${currentBase}" style="width:100%; font-family:monospace; font-size:12px;">
                        </div>
                        <div class="tts-row-input" style="margin-top:5px;">
                            <small>缓存文件夹 (绝对路径):</small>
                            <input type="text" id="tts-cache-path" value="${currentCache}" style="width:100%; font-family:monospace; font-size:12px;">
                        </div>
                        <div style="text-align:right; margin-top:5px;">
                            <button id="tts-btn-save-paths" class="btn-blue" style="padding:2px 8px; font-size:12px;">保存路径设置</button>
                        </div>
                    </div>

                    <div class="tts-row-input" style="margin-top:10px; border-top:1px solid #444; padding-top:10px;">
                        <small>🗣️ 参考音频语言 (对应 reference_audios 下的文件夹):</small>
                        <select id="tts-lang-select" style="width:100%; margin-top:5px; background:#333; color:white; border:1px solid #555;">
                            <option value="default">Default (根目录)</option>
                            <option value="Chinese">Chinese (中文)</option>
                            <option value="Japanese">Japanese (日语)</option>
                            <option value="English">English (英语)</option>
                            </select>
                    </div>

                    <div class="tts-add-zone">
                        <h4>➕ 新增绑定 / 创建资源</h4>
                        <div class="tts-row">
                            <input type="text" id="tts-new-char" placeholder="SillyTavern 角色名">
                            <span class="arrow">🔗</span>
                            <select id="tts-new-model"><option disabled selected>加载模型列表...</option></select>
                            <button id="tts-btn-bind-new">绑定</button>
                        </div>
                        <div class="tts-sub-row">
                            <small>新建资源包：</small>
                            <input type="text" id="tts-create-folder-name" placeholder="文件夹名">
                            <button id="tts-btn-create-folder" class="btn-blue">创建</button>
                        </div>
                    </div>
                    <hr class="tts-divider">
                    <div class="tts-list-zone">
                        <h4>📋 已绑定列表</h4>
                        <div id="tts-mapping-list" class="tts-list-container"></div>
                    </div>
                </div>
            </div>
        </div>
        `;

        $('body').append(html);
        renderDashboardList();
        renderModelOptions();
        // === 绑定美化卡开关事件 ===
        $('#tts-iframe-switch').change(function() {
            const isChecked = $(this).is(':checked');
            CACHE.settings.iframe_mode = isChecked;
            localStorage.setItem('tts_plugin_iframe_mode', isChecked);
            alert(`已${isChecked ? '开启' : '关闭'}美化卡模式。\n页面即将刷新以应用更改...`);
            location.reload(); // 必须刷新以清除残留的 DOM 状态
        });
        // 绑定事件
        $('#tts-master-switch').change(function() { toggleMasterSwitch($(this).is(':checked')); });
        $('#tts-toggle-auto').change(function() { toggleAutoGenerate($(this).is(':checked')); });
        // 设置当前选中的语言
        $('#tts-lang-select').val(CACHE.settings.default_lang || 'default');
        // === 新增：远程开关切换事件 ===
        $('#tts-remote-switch').change(function() {
            const checked = $(this).is(':checked');
            if(checked) {
                $('#tts-remote-input-area').slideDown();
            } else {
                $('#tts-remote-input-area').slideUp();
                // 如果关闭开关，直接保存并刷新回 localhost
                const ip = $('#tts-remote-ip').val().trim(); // 保留IP不清除
                localStorage.setItem('tts_plugin_remote_config', JSON.stringify({ useRemote: false, ip: ip }));
                location.reload(); // 刷新页面以应用新的 API 地址
            }
        });

        // === 新增：保存 IP 并刷新 ===
        $('#tts-save-remote').click(function() {
            const ip = $('#tts-remote-ip').val().trim();
            if(!ip) { alert("请输入 IP 地址"); return; }

            localStorage.setItem('tts_plugin_remote_config', JSON.stringify({ useRemote: true, ip: ip }));
            alert("设置已保存，页面将刷新以连接新地址。");
            location.reload(); // 必须刷新才能让顶部的 const MANAGER_API 生效
        });
        // 绑定变更事件，保存设置
        $('#tts-lang-select').change(async function() {
            const lang = $(this).val();
            CACHE.settings.default_lang = lang; // 临时更新本地
            await fetch(`${MANAGER_API}/update_settings`, {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ default_lang: lang })
            });
            // 语言改变后，可能需要刷新一下数据或者清空某些状态，这里简单处理
            console.log("Language changed to:", lang);
        });

        $('#tts-btn-save-paths').click(async function() {
            const btn = $(this);
            const oldText = btn.text();
            btn.text('保存中...').prop('disabled', true);
            const success = await saveSettings();
            if(success) {
                alert('设置已保存！');
                refreshData().then(() => renderModelOptions());
            } else {
                alert('保存失败，请检查控制台。');
            }
            btn.text(oldText).prop('disabled', false);
        });

        $('#tts-btn-bind-new').click(async function() {
            const charName = $('#tts-new-char').val().trim();
            const modelName = $('#tts-new-model').val();
            if(!charName || !modelName) { alert('请填写角色名并选择模型'); return; }
            await fetch(`${MANAGER_API}/bind_character`, {
                method: 'POST', body: JSON.stringify({ char_name: charName, model_folder: modelName }),
                headers: {'Content-Type':'application/json'}
            });
            await refreshData(); renderDashboardList(); $('#tts-new-char').val('');
        });

        $('#tts-btn-create-folder').click(async function() {
            const fName = $('#tts-create-folder-name').val().trim();
            if(!fName) return;
            const res = await fetch(`${MANAGER_API}/create_model_folder`, {
                method: 'POST', body: JSON.stringify({ folder_name: fName }),
                headers: {'Content-Type':'application/json'}
            });
            if(res.ok) { alert('创建成功！'); refreshData().then(renderModelOptions); $('#tts-create-folder-name').val(''); }
            else alert('创建失败，可能文件夹已存在。');
        });
    }

    async function saveSettings() {
        const base = $('#tts-base-path').val().trim();
        const cache = $('#tts-cache-path').val().trim();
        try {
            await fetch(`${MANAGER_API}/update_settings`, {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ base_dir: base, cache_dir: cache })
            });
            return true;
        } catch(e) { console.error(e); return false; }
    }

    function renderModelOptions() {
        const $select = $('#tts-new-model');
        const currentVal = $select.val();
        $select.empty().append('<option disabled value="">选择模型...</option>');
        if (Object.keys(CACHE.models).length === 0) { $select.append('<option disabled>暂无模型文件夹</option>'); return; }
        Object.keys(CACHE.models).forEach(k => { $select.append(`<option value="${k}">${k}</option>`); });
        if(currentVal) $select.val(currentVal);
        else $select.find('option:first').next().prop('selected', true);
    }

    function renderDashboardList() {
        const c = $('#tts-mapping-list').empty();
        if (Object.keys(CACHE.mappings).length === 0) { c.append('<div class="tts-empty">暂无绑定记录</div>'); return; }
        Object.keys(CACHE.mappings).forEach(k => {
            c.append(`
                <div class="tts-list-item">
                    <span class="col-name">${k}</span>
                    <span class="col-model">➡ ${CACHE.mappings[k]}</span>
                    <div class="col-action"><button class="btn-red" onclick="window.handleUnbind('${k}')">解绑</button></div>
                </div>
            `);
        });
    }

    window.handleUnbind = async (c) => {
        await fetch(`${MANAGER_API}/unbind_character`, {
            method: 'POST', body: JSON.stringify({ char_name: c }), headers: {'Content-Type':'application/json'}
        });
        await refreshData(); renderDashboardList();
        $(`.voice-bubble[data-voice-name="${c}"]`).attr('data-status', 'waiting').removeClass('error playing ready');
    };

    $(document).on('click', '.voice-bubble', function() {
        const btn = $(this);
        const charName = btn.data('voice-name');

        if (btn.attr('data-status') === 'ready') {
            if (window.currentAudio) { window.currentAudio.pause(); window.currentAudio = null; $('.voice-bubble').removeClass('playing'); }

            // 优先读取属性，读取不到再读内存
            const audioUrl = btn.attr('data-audio-url') || btn.data('audio-url');

            if (!audioUrl) {
                // 如果 URL 真的丢了（极少数情况），回退到错误状态让用户可以重试
                btn.attr('data-status', 'error').removeClass('playing');
                alert("音频丢失，请刷新页面或点击重试");
                return;
            }
            const a = new Audio(audioUrl);
            window.currentAudio = a;
            btn.addClass('playing'); a.onended = () => { btn.removeClass('playing'); window.currentAudio = null; }; a.play();

        }
        else if (btn.attr('data-status') === 'waiting' || btn.attr('data-status') === 'error') {
            // 总开关拦截
            if (CACHE.settings.enabled === false) {
                alert('TTS 插件总开关已关闭，请在配置面板中开启。');
                return;
            }

            if (!CACHE.mappings[charName]) {
                showDashboard(); $('#tts-new-char').val(charName); $('#tts-new-model').focus();
                alert(`⚠️ 角色 "${charName}" 尚未绑定 TTS 模型，已自动为您填入角色名。\n请在右侧选择模型并点击“绑定”！`);
            } else {
                btn.removeClass('error'); btn.data('auto-play-after-gen', true);
                BatchScheduler.addToQueue(btn); BatchScheduler.run();
            }
        }
    });

    // ===========================================
    // 最终修复版：事件代理 + 跨域通讯 + 状态同步
    // ===========================================

    // 定义正则（删除之前的重复定义，只保留这一次）
    const VOICE_TAG_REGEX = /(\s*)\[TTSVoice[:：]\s*([^:：]+)\s*[:：]\s*([^:：]*)\s*[:：]\s*(.*?)\]/gi;

    // ===========================================
    // 最终完整版：新UI容器 + 旧版波动条 + 双端统一样式
    // ===========================================
    function processMessageContent() {
        // 1. 总开关拦截
        if (CACHE.settings.enabled === false) return;

        // 定义旧版波动条的 HTML 结构 (三个 span)
        const BARS_HTML = `<span class='sovits-voice-waves'><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span></span>`;

        // 2. 获取当前模式
        const isIframeMode = CACHE.settings.iframe_mode === true;

        if (isIframeMode) {
            // ========================================
            // 模式 A: 美化卡 (Iframe)
            // ========================================
            $('iframe').each(function() {
                try {
                    const $iframe = $(this);
                    const doc = $iframe.contents();
                    const head = doc.find('head');
                    const body = doc.find('body');

                    // [A] 注入新版 CSS
                    if (head.length > 0 && head.find('#sovits-iframe-style').length === 0) {
                        head.append(`<style id='sovits-iframe-style'>${IFRAME_CSS}</style>`);
                    }

                    // [B] 绑定事件
                    if (!body.data('tts-event-bound')) {
                        body.on('click', '.voice-bubble', function(e) {
                            e.stopPropagation();
                            const $this = $(this);
                            const payload = {
                                type: 'play_tts',
                                key: $this.attr('data-key'),
                                text: $this.attr('data-text'),
                                charName: $this.attr('data-voice-name'),
                                emotion: $this.attr('data-voice-emotion')
                            };
                            window.top.postMessage(payload, '*');
                        });
                        body.data('tts-event-bound', true);
                    }

                    const targets = body.find('*').filter(function() {
                        if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(this.tagName)) return false;
                        if ($(this).find('.voice-bubble').length > 0) return false;

                        let hasTargetText = false;
                        $(this).contents().each(function() {
                            // nodeType 3 代表文本节点
                            if (this.nodeType === 3 && this.nodeValue && this.nodeValue.indexOf("[TTSVoice") !== -1) {
                                hasTargetText = true;
                                return false; // 找到就停止遍历子节点
                            }
                        });
                        return hasTargetText;
                    });
                    targets.each(function() {
                        const $p = $(this);
                        if ($p.html().indexOf("voice-bubble") !== -1) return;

                        if (VOICE_TAG_REGEX.test($p.html())) {
                            const newHtml = $p.html().replace(VOICE_TAG_REGEX, (match, spaceChars, name, emotion, text) => {
                                const cleanName = name.trim();
                                const cleanText = text.replace(/<[^>]+>|&lt;[^&]+&gt;/g, '').trim();
                                const key = BatchScheduler.getTaskKey(cleanName, cleanText);

                                let status = 'waiting';
                                let dataUrlAttr = '';
                                let loadingClass = '';
                                if (CACHE.audioMemory[key]) {
                                    status = 'ready';
                                    dataUrlAttr = `data-audio-url='${CACHE.audioMemory[key]}'`;
                                } else if (CACHE.pendingTasks.has(key)) {
                                    status = 'queued';
                                    loadingClass = 'loading';
                                }

                                const d = Math.max(1, Math.ceil(cleanText.length * 0.25));
                                const bubbleWidth = Math.min(220, 75 + d * 10);

                                return `${spaceChars}<span class='voice-bubble ${loadingClass}'
                                    style='width: ${bubbleWidth}px; justify-content: space-between;'
                                    data-key='${key}'
                                    data-status='${status}' ${dataUrlAttr} data-text='${cleanText}'
                                    data-voice-name='${cleanName}' data-voice-emotion='${emotion.trim()}'>
                                    ${BARS_HTML}
                                    <span class='sovits-voice-duration'>${d}"</span>
                                </span>`;
                            });
                            $p.html(newHtml);
                            if (CACHE.settings.auto_generate) setTimeout(() => BatchScheduler.scanAndSchedule(), 100);
                        }
                    });
                } catch (e) { }
            });

        } else {
            // ========================================
            // 模式 B: 普通卡 (mes_text)
            // ========================================

            // [A] 确保普通界面也拥有新版 CSS (统一 UI)
            if ($('#sovits-iframe-style-main').length === 0) {
                $('head').append(`<style id='sovits-iframe-style-main'>${IFRAME_CSS}</style>`);
            }

            $('.mes_text').each(function() {
                const $this = $(this);
                if ($this.find('iframe').length > 0) return;
                if ($this.attr('data-voice-processed') === 'true' || $this.find('.voice-bubble').length > 0) return;

                const html = $this.html();
                if (VOICE_TAG_REGEX.test(html)) {
                    VOICE_TAG_REGEX.lastIndex = 0;
                    const newHtml = html.replace(VOICE_TAG_REGEX, (match, spaceChars, name, emotion, text) => {
                        const cleanName = name.trim();
                        const cleanText = text.replace(/<[^>]+>|&lt;[^&]+&gt;/g, '').trim();
                        const key = BatchScheduler.getTaskKey(cleanName, cleanText);

                        let status = 'waiting';
                        let dataUrlAttr = '';
                        let loadingClass = '';
                        if (CACHE.audioMemory[key]) {
                            status = 'ready';
                            dataUrlAttr = `data-audio-url='${CACHE.audioMemory[key]}'`;
                        } else if (CACHE.pendingTasks.has(key)) {
                            status = 'queued';
                            loadingClass = 'loading';
                        }

                        const d = Math.max(1, Math.ceil(cleanText.length * 0.25));
                        const bubbleWidth = Math.min(220, 60 + d * 10);

                        return `${spaceChars}<span class="voice-bubble ${loadingClass}"
                            style="width: ${bubbleWidth}px"
                            data-status="${status}" ${dataUrlAttr} data-text="${cleanText}"
                            data-voice-name="${cleanName}" data-voice-emotion="${emotion.trim()}">
                            ${BARS_HTML}
                            <span class="sovits-voice-duration">${d}"</span>
                        </span>`;
                    });

                    $this.html(newHtml);
                    $this.attr('data-voice-processed', 'true');
                    if (CACHE.settings.auto_generate) setTimeout(() => BatchScheduler.scanAndSchedule(), 100);
                }
            });
        }
    }
    initUI();

    // ===========================================
    // 核心监听器：处理播放 + 跨窗口生成 (最终修复版)
    // ===========================================
    // ===========================================
    // 核心监听器：处理播放 + 跨窗口生成 (修复动画重置版)
    // ===========================================
    window.addEventListener('message', function(event) {
        // 1. 安全校验
        if (!event.data || event.data.type !== 'play_tts') return;

        const { key, text, charName, emotion } = event.data;

        // 检查绑定状态
        if (!CACHE.mappings[charName]) {
            showDashboard();
            $('#tts-new-char').val(charName);
            $('#tts-new-model').focus();
            setTimeout(() => {
                alert(`⚠️ 角色 "${charName}" 尚未绑定 TTS 模型。\n已为您自动填好角色名，请在右侧选择模型并点击“绑定”！`);
            }, 100);
            return;
        }

        // === 【核心修复点】 ===
        // 在做任何事情之前，先停止当前音频，并强制重置所有气泡的动画
        if (window.currentAudio) {
            window.currentAudio.pause();
            window.currentAudio = null;
        }

        // 暴力重置所有气泡样式：移除 playing 类
        $('.voice-bubble').removeClass('playing'); // 主界面
        $('iframe').each(function() { // 所有 Iframe 内部
            try { $(this).contents().find('.voice-bubble').removeClass('playing'); } catch(e){}
        });
        // ===================

        // 2. 检查缓存播放
        if (CACHE.audioMemory[key]) {
            const audio = new Audio(CACHE.audioMemory[key]);
            window.currentAudio = audio;

            // 定义动画控制函数
            const setAnim = (active) => {
                const func = active ? 'addClass' : 'removeClass';
                // 更新主界面
                $(`.voice-bubble[data-key='${key}']`)[func]('playing');
                // 更新 Iframe
                $('iframe').each(function(){
                    try { $(this).contents().find(`.voice-bubble[data-key='${key}']`)[func]('playing'); } catch(e){}
                });
            };

            // 开始播放动画
            setAnim(true);

            audio.onended = () => {
                window.currentAudio = null;
                setAnim(false); // 播放结束自动重置
            };
            audio.play();
            return;
        }

        // 3. 缓存没有，准备生成
        if (CACHE.settings.enabled === false) { alert('TTS 插件已关闭'); return; }

        // 尝试定位按钮 DOM
        let $realBtn = null;
        $('iframe').each(function() {
            try {
                const b = $(this).contents().find(`.voice-bubble[data-key='${key}']`);
                if(b.length) $realBtn = b;
            } catch(e){}
        });
        if(!$realBtn || !$realBtn.length) $realBtn = $(`.voice-bubble[data-key='${key}']`);

        // 4. 构建虚拟按钮对象 (如果找不到真实DOM)
        const taskBtn = ($realBtn && $realBtn.length) ? $realBtn : {
            attr: (k) => (k==='data-status' ? 'waiting' : ''),
            data: (k) => {
                if(k==='voice-name') return charName;
                if(k==='voice-emotion') return emotion;
                if(k==='text') return text;
                return '';
            },
            addClass: () => {},
            removeClass: () => {},
        };

        if ($realBtn && $realBtn.length) {
            $realBtn.removeClass('error').attr('data-status', 'waiting');
        }

        // 5. 加入队列
        if ($realBtn && $realBtn.length) {
            BatchScheduler.addToQueue($realBtn);
            BatchScheduler.run();
        } else {
            console.warn("[TTS] 按钮DOM丢失，等待DOM刷新后重试...");
            setTimeout(() => { window.postMessage(event.data, '*'); }, 200);
        }
    });



    // 初始运行
    setTimeout(processMessageContent, 5000);


    setInterval(processMessageContent, 1000);
    if (typeof refreshData !== 'undefined') {
        window.refreshTTS = refreshData;
    }
    const observer = new MutationObserver(() => processMessageContent());
    const chatContainer = document.querySelector('#chat') || document.body;
    if (chatContainer) observer.observe(chatContainer, { childList: true, subtree: true });
    refreshData();
    window.refreshTTS = refreshData;
})();
