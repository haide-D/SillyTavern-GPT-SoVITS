(function () {
    // ================= 1. 配置区域 =================
    const lsConfig = localStorage.getItem('tts_plugin_remote_config');
    let remoteConfig = lsConfig ? JSON.parse(lsConfig) : { useRemote: false, ip: "" };
    let apiHost = "127.0.0.1";

    if (remoteConfig.useRemote && remoteConfig.ip) {
        apiHost = remoteConfig.ip;
    } else {
        const current = window.location.hostname;
        apiHost = (current === 'localhost' || current === '127.0.0.1') ? '127.0.0.1' : current;
    }

    const MANAGER_API = `http://${apiHost}:3000`;

    // ================= 2. 模块加载器 =================
    const loadModule = (name) => {
        return new Promise((resolve, reject) => {
            const url = `${MANAGER_API}/static/js/${name}.js`;
            $.getScript(url)
                .done(() => {
                resolve();
            })
                .fail((jqxhr, settings, exception) => {
                console.error(`[TTS] 加载模块 ${name} 失败:`, exception);
                reject(exception);
            });
        });
    };

    // ================= 3. 主逻辑函数 =================
    function initPlugin() {
        console.log("✅ [TTS] 开始初始化插件核心...");

        // 1. 模块初始化 (确保所有子模块的 init 方法都被调用)
        if (window.TTS_API) window.TTS_API.init(MANAGER_API);
        if (window.TTS_State) window.TTS_State.init();
        if (window.TTS_Parser) window.TTS_Parser.init();
        if (window.TTS_Events) window.TTS_Events.init();
        if (window.TTS_Scheduler) window.TTS_Scheduler.init();

        // 2. 建立局部引用 (快捷方式)
        const TTS_Utils = window.TTS_Utils;
        const CACHE = window.TTS_State.CACHE;
        const Scheduler = window.TTS_Scheduler;

        // 3. 加载全局 CSS
        TTS_Utils.loadGlobalCSS(`${MANAGER_API}/static/css/style.css`, (cssContent) => {
            // CSS加载完毕后，手动扫描一次
            if (window.TTS_Parser) window.TTS_Parser.scan();

            // 修复 Iframe 样式
            $('iframe').each(function() {
                try {
                    const head = $(this).contents().find('head');
                    if (head.length > 0 && head.find('#sovits-iframe-style').length === 0) {
                        head.append(`<style id='sovits-iframe-style'>${cssContent}</style>`);
                    }
                } catch(e) {}
            });
        });

        // 4. 定义核心回调函数 (传给 UI 模块使用)
        async function refreshData() {
            try {
                TTS_Utils.injectStyles();
                $('#tts-manager-btn').css({ 'border-color': 'rgba(255,255,255,0.3)', 'color': '#fff' }).text('🔊 TTS配置');

                const data = await window.TTS_API.getData();

                // 更新 State
                CACHE.models = data.models;
                CACHE.mappings = data.mappings;
                if (data.settings) CACHE.settings = { ...CACHE.settings, ...data.settings };

                // 强制覆盖 iframe_mode
                const localIframeMode = localStorage.getItem('tts_plugin_iframe_mode');
                if (localIframeMode !== null) CACHE.settings.iframe_mode = (localIframeMode === 'true');

                CACHE.pendingTasks.clear();

                // 刷新 UI
                if (window.TTS_UI) {
                    window.TTS_UI.renderModelOptions();
                    window.TTS_UI.renderDashboardList();
                }

                // 自动生成检查
                if (CACHE.settings.enabled !== false && CACHE.settings.auto_generate) {
                    Scheduler.scanAndSchedule();
                }
            } catch (e) {
                console.error("TTS Backend Error:", e);
                TTS_Utils.showNotification("❌ 未检测到 TTS 后端服务", "error");
                $('#tts-manager-btn').css({ 'border-color': '#ff5252', 'color': '#ff5252' }).text('⚠️ TTS断开');
            }
        }

        async function toggleMasterSwitch(checked) {
            CACHE.settings.enabled = checked;
            if (checked && window.TTS_Parser) window.TTS_Parser.scan();
            try { await window.TTS_API.updateSettings({ enabled: checked }); } catch(e) {}
        }

        async function toggleAutoGenerate(checked) {
            CACHE.settings.auto_generate = checked;
            try {
                await window.TTS_API.updateSettings({ auto_generate: checked });
                if (checked && CACHE.settings.enabled !== false) Scheduler.scanAndSchedule();
            } catch(e) {}
        }

        async function saveSettings(base, cache) {
            const b = base !== undefined ? base : $('#tts-base-path').val().trim();
            const c = cache !== undefined ? cache : $('#tts-cache-path').val().trim();
            try {
                await window.TTS_API.updateSettings({ base_dir: b, cache_dir: c });
                return true;
            } catch(e) { return false; }
        }

        // 5. 初始化 UI 模块
        if (window.TTS_UI) {
            window.TTS_UI.init({
                CACHE: CACHE,
                API_URL: MANAGER_API,
                Utils: TTS_Utils,
                Callbacks: { refreshData, saveSettings, toggleMasterSwitch, toggleAutoGenerate }
            });
        }

        // 6. 启动心跳看门狗
        function runWatchdog() {
            if (document.hidden) return; // 页面不可见时不执行

            // 检查 UI 按钮
            if (window.TTS_UI && $('#tts-manager-btn').length === 0) {
                window.TTS_UI.init({
                    CACHE: CACHE,
                    API_URL: MANAGER_API,
                    Utils: TTS_Utils,
                    Callbacks: { refreshData, saveSettings, toggleMasterSwitch, toggleAutoGenerate }
                });
            }

            // 检查 CSS
            if (TTS_Utils && TTS_Utils.getStyleContent) {
                const currentCSS = TTS_Utils.getStyleContent();
                if ($('#sovits-iframe-style-main').length === 0 && currentCSS) {
                    $('head').append(`<style id='sovits-iframe-style-main'>${currentCSS}</style>`);
                }
            }

            // 检查气泡
            if (CACHE.settings.enabled && window.TTS_Parser) {
                window.TTS_Parser.scan();
            }
        }

        // 立即执行一次
        refreshData();

        // 启动循环
        setInterval(runWatchdog, 1500);

        // 启动 DOM 监听
        const observer = new MutationObserver((mutations) => {
            let shouldScan = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldScan = true;
                    break;
                }
            }
            if (shouldScan && CACHE.settings.enabled && window.TTS_Parser) {
                window.TTS_Parser.scan();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // 暴露全局刷新
        window.refreshTTS = refreshData;
        setTimeout(runWatchdog, 500);
    }

    // ================= 4. 启动引导流程 =================
    async function bootstrap() {
        try {
            console.log("🚀 [TTS] 正在加载模块...");

            // 按顺序加载依赖
            // 1. 工具与API
            await loadModule('utils');
            await loadModule('api');
            await loadModule('state');

            // 2. 核心组件
            await loadModule('dom_parser'); // 【修复点】之前写错了名字
            await loadModule('scheduler');
            await loadModule('events');

            // 3. 界面
            await loadModule('ui');

            console.log("✅ [Loader] 所有模块加载完毕，启动插件");
            initPlugin();

        } catch (error) {
            console.error("❌ TTS插件启动失败:", error);
            // 备用：如果 Promise 失败，尝试传统的 alert 提示
            if (window.TTS_Utils) window.TTS_Utils.showNotification("TTS插件加载失败，请按F12检查日志", "error");
        }
    }
    bootstrap();
})();
