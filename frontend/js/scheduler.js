// static/js/scheduler.js
(function () {
    window.TTS_Scheduler = {
        queue: [],
        isRunning: false,

        // 更新按钮状态 UI
        updateStatus($btn, status) {
            $btn.attr('data-status', status).removeClass('playing loading error');

            if (status === 'queued' || status === 'generating') {
                $btn.addClass('loading');
            }
            else if (status === 'error') {
                $btn.addClass('error');
                $btn.css('opacity', ''); // 💡 修复1: 出错也恢复亮度
            }

            // 💡 修复2: 成功后，必须把手动设置的灰色滤镜去掉！
            if (status === 'ready') {
                $btn.css('opacity', '');
            }
        },

        getTaskKey(charName, text) {
            return `${charName}_${text}`;
        },

        // 模型完整性校验
        validateModel(modelName, config) {
            let missing = [];
            if (!config.gpt_path) missing.push("GPT权重");
            if (!config.sovits_path) missing.push("SoVITS权重");

            const langs = config.languages || {};
            if (Object.keys(langs).length === 0) {
                missing.push("参考音频(reference_audios)");
            }

            if (missing.length > 0) {
                window.TTS_Utils.showNotification(`❌ 模型 "${modelName}" 缺失: ${missing.join(', ')}`, 'error');
                return false;
            }
            return true;
        },

        // 扫描页面并加入队列
        scanAndSchedule() {
            // 引用全局 State
            const settings = window.TTS_State.CACHE.settings;
            const mappings = window.TTS_State.CACHE.mappings;

            if (settings.enabled === false) return;

            const $lastMessage = $('.mes_text').last();
            $lastMessage.find('.voice-bubble[data-status="waiting"]').each((_, btn) => {
                const charName = $(btn).data('voice-name');
                if (mappings[charName]) {
                    this.addToQueue($(btn));
                }
            });
            if (!this.isRunning && this.queue.length > 0) this.run();
        },

        addToQueue($btn) {
            if ($btn.attr('data-status') !== 'waiting') return;

            const CACHE = window.TTS_State.CACHE; // 引用快捷方式
            const charName = $btn.data('voice-name');
            const text = $btn.data('text');
            const key = this.getTaskKey(charName, text);
            // 一级缓存
            if (CACHE.audioMemory[key]) {
                $btn.data('audio-url', CACHE.audioMemory[key]);
                this.updateStatus($btn, 'ready');
                return;
            }
            if (CACHE.pendingTasks.has(key)) {
                this.updateStatus($btn, 'queued');
                return;
            }

            this.updateStatus($btn, 'queued');
            CACHE.pendingTasks.add(key);
            this.queue.push({ charName, emotion: $btn.data('voice-emotion'), text, key, $btn });
        },

        async run() {
            const CACHE = window.TTS_State.CACHE;

            if (CACHE.settings.enabled === false) {
                this.isRunning = false;
                this.queue = [];
                return;
            }

            this.isRunning = true;
            let groups = {};
            let unboundTasks = [];

            while (this.queue.length > 0) {
                const task = this.queue.shift();
                if (CACHE.audioMemory[task.key]) {
                    this.finishTask(task.key, CACHE.audioMemory[task.key]);
                    continue;
                }
                const mName = CACHE.mappings[task.charName];
                if (!mName) { unboundTasks.push(task); continue; }
                if (!groups[mName]) groups[mName] = [];
                groups[mName].push(task);
            }

            unboundTasks.forEach(t => {
                this.updateStatus(t.$btn, 'error');
                CACHE.pendingTasks.delete(t.key);
            });

            for (const modelName of Object.keys(groups)) {
                const tasks = groups[modelName];
                const modelConfig = CACHE.models[modelName];

                if (!modelConfig || !this.validateModel(modelName, modelConfig)) {
                    console.warn(`[TTS] Model ${modelName} is missing files. Skipping generation.`);
                    tasks.forEach(t => {
                        this.updateStatus(t.$btn, 'error');
                        CACHE.pendingTasks.delete(t.key);
                    });
                    continue;
                }

                const checkPromises = tasks.map(async (task) => {
                    if (CACHE.audioMemory[task.key]) return { task, cached: true };
                    const result = await this.checkCache(task, modelConfig);
                    return { task, cached: result && result.cached === true };
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
                    } catch (e) {
                        tasksToGenerate.forEach(t => {
                            this.updateStatus(t.$btn, 'error');
                            CACHE.pendingTasks.delete(t.key);
                        });
                    }
                }
            }
            this.isRunning = false;
            if (this.queue.length > 0) this.run();
        },

        finishTask(key, audioUrl) {
            const CACHE = window.TTS_State.CACHE;
            CACHE.audioMemory[key] = audioUrl;
            CACHE.pendingTasks.delete(key);

            if (window.TTS_Parser && window.TTS_Parser.updateState) {
                window.TTS_Parser.updateState();
            }
        },

        async checkCache(task, modelConfig) {
            try {
                const settings = window.TTS_State.CACHE.settings;
                const currentLang = settings.default_lang || 'default';
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

                // 随机选择相同情绪的参考音频
                let matchedRefs = targetRefs.filter(r => r.emotion === task.emotion);
                if (matchedRefs.length === 0) matchedRefs = targetRefs.filter(r => r.emotion === 'default');
                if (matchedRefs.length === 0) matchedRefs = targetRefs;
                let ref = matchedRefs[Math.floor(Math.random() * matchedRefs.length)];

                if (!ref) return false;

                const params = {
                    text: task.text,
                    text_lang: "zh",
                    ref_audio_path: ref.path,
                    prompt_text: ref.text,
                    prompt_lang: "zh"
                };
                return await window.TTS_API.checkCache(params);
            } catch { return false; }
        },

        async switchModel(config) {
            const CURRENT_LOADED = window.TTS_State.CURRENT_LOADED;

            if (CURRENT_LOADED.gpt_path === config.gpt_path && CURRENT_LOADED.sovits_path === config.sovits_path) return;

            if (CURRENT_LOADED.gpt_path !== config.gpt_path) {
                await window.TTS_API.switchWeights('proxy_set_gpt_weights', config.gpt_path);
                CURRENT_LOADED.gpt_path = config.gpt_path;
            }
            if (CURRENT_LOADED.sovits_path !== config.sovits_path) {
                await window.TTS_API.switchWeights('proxy_set_sovits_weights', config.sovits_path);
                CURRENT_LOADED.sovits_path = config.sovits_path;
            }
        },

        async processSingleTask(task, modelConfig) {
            const { text, emotion, key, $btn } = task;
            const settings = window.TTS_State.CACHE.settings;
            const CACHE = window.TTS_State.CACHE;

            const currentLang = settings.default_lang || 'default';
            let availableLangs = modelConfig.languages || {};
            let targetRefs = availableLangs[currentLang];

            if (!targetRefs) {
                if (availableLangs['default']) targetRefs = availableLangs['default'];
                else {
                    const keys = Object.keys(availableLangs);
                    if (keys.length > 0) targetRefs = availableLangs[keys[0]];
                }
            }

            if (!targetRefs) {
                this.updateStatus($btn, 'error');
                CACHE.pendingTasks.delete(key);
                return;
            }

            // 随机选择相同情绪的参考音频
            let matchedRefs = targetRefs.filter(r => r.emotion === emotion);
            if (matchedRefs.length === 0) matchedRefs = targetRefs.filter(r => r.emotion === 'default');
            if (matchedRefs.length === 0) matchedRefs = targetRefs;
            let ref = matchedRefs[Math.floor(Math.random() * matchedRefs.length)];

            try {
                let promptLangCode = "zh";
                if (currentLang === "Japanese" || currentLang === "日语") promptLangCode = "ja";
                if (currentLang === "English" || currentLang === "英语") promptLangCode = "en";

                const params = {
                    text: text,
                    text_lang: promptLangCode,
                    ref_audio_path: ref.path,
                    prompt_text: ref.text,
                    prompt_lang: promptLangCode
                };

                const { blob, filename } = await window.TTS_API.generateAudio(params);
                if (filename) {
                    $btn.attr('data-server-filename', filename);
                    console.log(`[TTS] 文件名已记录: ${filename}`);
                }
                this.finishTask(key, URL.createObjectURL(blob));
                this.updateStatus($btn, 'ready');

            } catch (e) {
                console.error("生成失败:", e);
                this.updateStatus($btn, 'error');
                CACHE.pendingTasks.delete(key);
            }
        },

        // 初始化方法（目前留空，可用于以后设置监听器）
        init() {
            console.log("✅ [Scheduler] 调度器已加载");
        }
    };
})();
