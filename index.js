(function () {
    const SOVITS_API = "http://127.0.0.1:9880";
    const MANAGER_API = "http://127.0.0.1:3000";

    let CACHE = {
        // 默认 enabled: true
        models: {}, mappings: {}, settings: { auto_generate: true, enabled: true },
        audioMemory: {}, pendingTasks: new Set()
    };
    let CURRENT_LOADED = { gpt_path: null, sovits_path: null };

    function injectStyles() {
        if ($('#tts-style-injection').length > 0) return;
        const css = `
        /* === 1. 设置按钮样式 === */
        #tts-manager-btn {
            position: fixed; top: 10px; right: 100px; z-index: 20000;
            background: rgba(0,0,0,0.7); color: #fff; padding: 6px 12px;
            border-radius: 4px; cursor: pointer; border: 1px solid rgba(255,255,255,0.3);
            font-size: 13px;
        }
        #tts-manager-btn:hover { background: rgba(0,0,0,0.9); }

        /* === 新增：顶部错误提示条样式 === */
        #tts-notification-bar {
            position: fixed; top: -50px; left: 50%; transform: translateX(-50%);
            z-index: 20005; background: #d32f2f; color: white;
            padding: 8px 20px; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            font-size: 14px; transition: top 0.5s ease; pointer-events: none;
            display: flex; align-items: center; gap: 8px;
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

        /* === 3. 控制面板样式 (完全保持原样) === */
        .tts-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.6); z-index: 20001;
            display: flex; align-items: center; justify-content: center;
        }
        .tts-panel {
            background: #2b2b2b; color: #eee; width: 500px; max-height: 85vh;
            border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            display: flex; flex-direction: column; overflow: hidden;
            border: 1px solid #444; font-family: sans-serif;
        }
        .tts-header {
            padding: 15px; background: #222; border-bottom: 1px solid #444;
            display: flex; justify-content: space-between; align-items: center;
        }
        .tts-header h3 { margin: 0; font-size: 16px; }
        .tts-close {
            background: none; border: none; color: #aaa; font-size: 24px;
            cursor: pointer; line-height: 1;
        }
        .tts-content { padding: 15px; overflow-y: auto; }
        .tts-settings-zone input[type="text"] {
            background: #1a1a1a; border: 1px solid #444; color: #fff;
            padding: 4px; border-radius: 3px; margin-top: 2px;
        }
        .tts-add-zone, .tts-list-zone { margin-top: 15px; }
        .tts-row, .tts-sub-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .tts-row input, .tts-row select {
            flex: 1; background: #333; color: white; border: 1px solid #555; padding: 5px;
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
        .col-model { color: #aaa; margin-left: 10px; flex: 1; }
        .btn-blue { background: #1976d2; color: white; border: none; border-radius: 3px; cursor: pointer; }
        .btn-red { background: #d32f2f; color: white; border: none; padding: 2px 8px; border-radius: 3px; cursor: pointer; }
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
                if (!modelConfig) continue;
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
            CACHE.audioMemory[key] = audioUrl; CACHE.pendingTasks.delete(key);
            $('.voice-bubble').each((_, el) => {
                const $el = $(el);
                if (this.getTaskKey($el.data('voice-name'), $el.data('text')) === key && $el.attr('data-status') !== 'ready') {
                    $el.data('audio-url', audioUrl); this.updateStatus($el, 'ready');
                    if ($el.data('auto-play-after-gen')) { $el.click(); $el.removeData('auto-play-after-gen'); }
                }
            });
        },
        async checkCache(task, modelConfig) {
            try {
                let ref = modelConfig.emotion_refs.find(r => r.emotion === task.emotion) || modelConfig.default_ref;
                if (!ref) return false;
                const params = new URLSearchParams({ text: task.text, text_lang: "zh", ref_audio_path: ref.path, prompt_text: ref.text, prompt_lang: "zh", streaming_mode: "true", check_only: "true" });
                const res = await fetch(`${MANAGER_API}/tts_proxy?${params}`);
                return (await res.json()).cached === true;
            } catch { return false; }
        },
        async switchModel(config) {
            if (CURRENT_LOADED.gpt_path === config.gpt_path && CURRENT_LOADED.sovits_path === config.sovits_path) return;
            const safeSwitch = async (url) => { await fetch(url, { method: 'GET', mode: 'no-cors' }); };
            if (CURRENT_LOADED.gpt_path !== config.gpt_path) { await safeSwitch(`${SOVITS_API}/set_gpt_weights?weights_path=${config.gpt_path}`); CURRENT_LOADED.gpt_path = config.gpt_path; }
            if (CURRENT_LOADED.sovits_path !== config.sovits_path) { await safeSwitch(`${SOVITS_API}/set_sovits_weights?weights_path=${config.sovits_path}`); CURRENT_LOADED.sovits_path = config.sovits_path; }
        },
        async processSingleTask(task, modelConfig) {
            const { text, emotion, key, $btn } = task;
            let ref = modelConfig.emotion_refs.find(r => r.emotion === emotion) || modelConfig.default_ref;
            if (!ref) throw new Error("No ref audio");
            try {
                const params = new URLSearchParams({ text: text, text_lang: "zh", ref_audio_path: ref.path, prompt_text: ref.text, prompt_lang: "zh", streaming_mode: "true" });
                const response = await fetch(`${MANAGER_API}/tts_proxy?${params}`);
                if (!response.ok) throw new Error("Err");
                const blob = await response.blob();
                this.finishTask(key, URL.createObjectURL(blob));
            } catch (e) { this.updateStatus($btn, 'error'); CACHE.pendingTasks.delete(key); }
        }
    };

    function initUI() { if ($('#tts-manager-btn').length === 0) { $('body').append(`<div id="tts-manager-btn">🔊 TTS配置</div>`); $('#tts-manager-btn').on('click', showDashboard); } }

    function showDashboard() {
        $('#tts-dashboard-overlay').remove();
        const currentBase = CACHE.settings.base_dir || "";
        const currentCache = CACHE.settings.cache_dir || "";
        // 获取开关状态
        const isEnabled = CACHE.settings.enabled !== false;

        const html = `
        <div id="tts-dashboard-overlay" class="tts-overlay">
            <div id="tts-dashboard" class="tts-panel">
                <div class="tts-header">
                    <h3>🎧 TTS 角色语音配置</h3>
                    <button class="tts-close" onclick="$('#tts-dashboard-overlay').remove()">×</button>
                </div>
                <div class="tts-content">

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
                            <input type="text" id="tts-create-folder-name" placeholder="文件夹名 (英文)">
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

        // 绑定事件
        $('#tts-master-switch').change(function() { toggleMasterSwitch($(this).is(':checked')); });
        $('#tts-toggle-auto').change(function() { toggleAutoGenerate($(this).is(':checked')); });

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
            const a = new Audio(btn.data('audio-url')); window.currentAudio = a; btn.addClass('playing'); a.onended = () => { btn.removeClass('playing'); window.currentAudio = null; }; a.play();
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

    const VOICE_TAG_REGEX = /(\s*)\[TTSVoice[:：]\s*([^:：]+)\s*[:：]\s*([^:：]*)\s*[:：]\s*(.*?)\]/gi;

    function processMessageContent() {
        // 总开关拦截：如果关闭，不解析页面
        if (CACHE.settings.enabled === false) return;

        $('.mes_text').each(function() {
            const $this = $(this);
            if ($this.find('.voice-bubble').length > 0) return;
            const html = $this.html();

            if (VOICE_TAG_REGEX.test(html)) {
                VOICE_TAG_REGEX.lastIndex = 0;
                const newHtml = html.replace(VOICE_TAG_REGEX, (match, spaceChars, name, emotion, text) => {
                    const cleanName = name.trim();
                    const cleanText = text.trim();
                    const key = BatchScheduler.getTaskKey(cleanName, cleanText);

                    let status = 'waiting';
                    let dataUrl = '';
                    let loadingClass = '';

                    if (CACHE.audioMemory[key]) {
                        status = 'ready';
                        dataUrl = `data-audio-url="${CACHE.audioMemory[key]}"`;
                    } else if (CACHE.pendingTasks.has(key)) {
                        status = 'queued';
                        loadingClass = 'loading';
                    }

                    const d = Math.max(1, Math.ceil(cleanText.length * 0.25));
                    const prefix = spaceChars ? '&nbsp;' : '';

                    return `${prefix}<span class="voice-bubble ${loadingClass}" style="width: ${Math.min(220, 60+d*10)}px" data-status="${status}" ${dataUrl} data-text="${cleanText}" data-voice-name="${cleanName}" data-voice-emotion="${emotion.trim()}"><span class="sovits-voice-waves"><span class="sovits-voice-bar"></span><span class="sovits-voice-bar"></span><span class="sovits-voice-bar"></span></span><span class="sovits-voice-duration">${d}"</span></span>`;
                });

                $this.html(newHtml);
                $this.attr('data-voice-processed', 'true');
                if (CACHE.settings.auto_generate) setTimeout(() => BatchScheduler.scanAndSchedule(), 100);
            }
        });
    }

    initUI();
    const observer = new MutationObserver(() => processMessageContent());
    const chatContainer = document.querySelector('#chat') || document.body;
    if (chatContainer) observer.observe(chatContainer, { childList: true, subtree: true });
    refreshData();
    window.refreshTTS = refreshData;
})();
