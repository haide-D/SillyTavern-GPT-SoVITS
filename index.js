(function () {
    // ================= 1. 配置区域 =================
    const lsConfig = localStorage.getItem('tts_plugin_remote_config');
    let remoteConfig = lsConfig ? JSON.parse(lsConfig) : { useRemote: false, ip: "" };
    let apiHost = "127.0.0.1";

    if (remoteConfig.useRemote && remoteConfig.ip) {
        apiHost = remoteConfig.ip;
    } else {
        const current = window.location.hostname;
        // 正则匹配：192.168.x.x / 10.x.x.x / 172.16-31.x.x / IPv6
        const isLanOrIPv6 = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\.|:/.test(current);

        if (current === 'localhost' || current === '127.0.0.1') {
            apiHost = '127.0.0.1';
        } else if (isLanOrIPv6) {
            apiHost = current; // 软路由/局域网环境：直接使用当前 IP
        } else {
            apiHost = '127.0.0.1'; // 公网域名/其他环境：安全回退到本地
        }
    }

    // IPv6 格式修正
    if (apiHost.includes(':') && !apiHost.startsWith('[')) {
        apiHost = `[${apiHost}]`;
    }

    const MANAGER_API = `http://${apiHost}:3000`;

    // ================= 2. 模块加载器 (优化版：带3秒超时) =================
    const loadModule = (name) => {
        return new Promise((resolve, reject) => {
            const url = `${MANAGER_API}/static/js/${name}.js?t=${new Date().getTime()}`;

            // 使用 $.ajax 代替 $.getScript，只为了能设置 timeout
            $.ajax({
                url: url,
                dataType: "script",
                cache: true,
                timeout: 3000, // 【关键修改】设置3秒超时。手机连不上时，3秒后立刻触发报错弹窗
                success: function () {
                    resolve();
                },
                error: function (jqxhr, settings, exception) {
                    console.warn(`[TTS] 模块 ${name} 连接超时或失败，准备进入救援模式`);
                    // 拒绝 Promise，触发 bootstrap 的 catch 流程
                    reject(exception);
                }
            });
        });
    };

    // ================= 3. 主逻辑函数 =================
    function initPlugin() {
        console.log("✅ [TTS] 开始初始化插件核心...");

        const cachedStyle = localStorage.getItem('tts_bubble_style');
        const styleToApply = cachedStyle || 'default';

        document.body.setAttribute('data-bubble-style', styleToApply);
        console.log(`🎨 [Init] 皮肤已加载: ${styleToApply}`);

        // 2. 模块初始化
        if (window.TTS_API) window.TTS_API.init(MANAGER_API);
        if (window.TTS_State) window.TTS_State.init();
        if (window.TTS_Parser) window.TTS_Parser.init();
        if (window.TTS_Events) window.TTS_Events.init();
        if (window.TTS_Scheduler) window.TTS_Scheduler.init();

        // 3. 建立局部引用
        const TTS_Utils = window.TTS_Utils;
        const CACHE = window.TTS_State.CACHE;
        const Scheduler = window.TTS_Scheduler;

        // 3. 加载全局 CSS
        TTS_Utils.loadGlobalCSS(`${MANAGER_API}/static/css/style.css?t=${new Date().getTime()}`, (cssContent) => {
            // CSS加载完毕后，手动扫描一次
            if (window.TTS_Parser) window.TTS_Parser.scan();

            // 修复 Iframe 样式
            $('iframe').each(function () {
                try {
                    const head = $(this).contents().find('head');
                    if (head.length > 0 && head.find('#sovits-iframe-style').length === 0) {
                        head.append(`<style id='sovits-iframe-style'>${cssContent}</style>`);
                    }
                } catch (e) { }
            });
        });
        // ============================================================
        // 🚀 强制加载 CSS (修复版)
        // 使用 fetch 获取文本直接注入，绕过 <link> 标签可能遇到的加载失效问题
        // ============================================================
        const mobileCssUrl = `${MANAGER_API}/static/css/mobile.css?t=${new Date().getTime()}`;

        fetch(mobileCssUrl)
            .then(response => response.text())
            .then(cssText => {
                // 1. 创建 style 标签
                const style = document.createElement('style');
                style.id = 'tts-mobile-force-style';

                // 2. 可以在这里顺便补一个 z-index 保底，防止被遮挡
                // 如果原来的 CSS 里 z-index 不够大，这行会救命
                const extraCss = `
                    #tts-mobile-trigger { z-index: 2147483647 !important; }
                    #tts-mobile-root { z-index: 2147483647 !important; }
                `;

                // 3. 填入内容
                style.textContent = cssText + extraCss;

                // 4. 插入页面头部
                document.head.appendChild(style);
                console.log("✅ [TTS] 手机端 CSS 已强制注入成功！");
            })
            .catch(err => {
                console.error("❌ [TTS] 手机端 CSS 加载失败:", err);
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

                if (CACHE.settings.bubble_style) {
                    // 1. 应用到 body 标签，让页面气泡立刻变色
                    document.body.setAttribute('data-bubble-style', CACHE.settings.bubble_style);

                    // 2. 存入本地缓存
                    localStorage.setItem('tts_bubble_style', CACHE.settings.bubble_style);

                    // ============================================================
                    // ✨ 【核心修改】适配自定义下拉菜单的回显逻辑
                    // ============================================================
                    const currentStyle = CACHE.settings.bubble_style || 'default';
                    const $trigger = $('.select-trigger'); // 获取下拉框的显示条
                    const $targetOption = $(`.option-item[data-value="${currentStyle}"]`); // 找到对应的选项

                    if ($targetOption.length > 0) {
                        // (1) 把显示条的文字变成对应的名字（例如 "💎 幻彩·琉璃"）
                        $trigger.find('span').text($targetOption.text());
                        // (2) 修改 data-value，触发 CSS 变色（变绿/变粉）
                        $trigger.attr('data-value', currentStyle);
                    }
                }

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
        // 【新增】: 切换气泡风格的回调函数
        async function toggleBubbleStyle(checked) {
            if (checked) {
                document.body.classList.add('use-classic-style');
                localStorage.setItem('tts_style_classic', 'true');
            } else {
                document.body.classList.remove('use-classic-style');
                localStorage.setItem('tts_style_classic', 'false');
            }
            // 触发一次扫描，确保样式更新（有时需要重绘）
            if (window.TTS_Parser) window.TTS_Parser.scan();
        }

        async function toggleMasterSwitch(checked) {
            CACHE.settings.enabled = checked;
            if (checked && window.TTS_Parser) window.TTS_Parser.scan();
            try { await window.TTS_API.updateSettings({ enabled: checked }); } catch (e) { }
        }

        async function toggleAutoGenerate(checked) {
            CACHE.settings.auto_generate = checked;
            try {
                await window.TTS_API.updateSettings({ auto_generate: checked });
                if (checked && CACHE.settings.enabled !== false) Scheduler.scanAndSchedule();
            } catch (e) { }
        }
        async function changeBubbleStyle(styleName) {
            console.log("🎨 正在切换风格为:", styleName);

            // 1. 立即在前端生效 (无延迟体验)
            document.body.setAttribute('data-bubble-style', styleName);
            localStorage.setItem('tts_bubble_style', styleName);

            // 2. 发送到后端保存 (统一使用 update_settings 接口)
            try {
                // ⚠️ 修改了 endpoint：从 /save_style 变为 /update_settings
                const response = await fetch(`${MANAGER_API}/update_settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // ⚠️ 修改了键名：确保发送的是 bubble_style，对应 Python 里的定义
                    body: JSON.stringify({ bubble_style: styleName })
                });

                const res = await response.json();
                if (res.status === 'success') {
                    console.log("✅ 风格已永久保存:", styleName);

                    // 更新本地缓存
                    if (window.TTS_State && window.TTS_State.CACHE.settings) {
                        window.TTS_State.CACHE.settings.bubble_style = styleName;
                    }
                }
            } catch (e) {
                console.error("❌ 保存风格失败:", e);
            }
        }
        async function saveSettings(base, cache) {
            const b = base !== undefined ? base : $('#tts-base-path').val().trim();
            const c = cache !== undefined ? cache : $('#tts-cache-path').val().trim();
            try {
                await window.TTS_API.updateSettings({ base_dir: b, cache_dir: c });
                return true;
            } catch (e) { return false; }
        }

        // 5. 初始化 UI 模块
        if (window.TTS_UI) {
            window.TTS_UI.init({
                CACHE: CACHE,
                API_URL: MANAGER_API,
                Utils: TTS_Utils,
                Callbacks: { refreshData, saveSettings, toggleMasterSwitch, toggleAutoGenerate, changeBubbleStyle }
            }, false);
        }
        // ============================================================
        // 【新增】自定义下拉菜单交互逻辑
        // ============================================================

        // 1. 点击触发器：切换菜单展开/收起
        $('body').on('click', '.select-trigger', function (e) {
            e.stopPropagation(); // 阻止冒泡
            $(this).parent('.tts-custom-select').toggleClass('open');
        });

        // 2. 点击选项：选中并关闭
        $('body').on('click', '.option-item', function () {
            const val = $(this).attr('data-value');
            const text = $(this).text();
            const $wrapper = $(this).closest('.tts-custom-select');

            // 更新触发器的文字和 data-value (触发 CSS 变色)
            const $trigger = $wrapper.find('.select-trigger');
            $trigger.find('span').text(text);
            $trigger.attr('data-value', val); // 这一步会让 Trigger 变成对应的颜色

            // 关闭菜单
            $wrapper.removeClass('open');

            // 执行核心切换逻辑
            changeBubbleStyle(val);
        });

        // 3. 点击页面其他地方：自动关闭菜单
        $(document).on('click', function () {
            $('.tts-custom-select').removeClass('open');
        });

        // 6. 启动心跳看门狗
        function runWatchdog() {
            if (document.hidden) return; // 页面不可见时不执行

            /*
            // 检查 UI 按钮
            if (window.TTS_UI && $('#tts-manager-btn').length === 0) {
                window.TTS_UI.init({
                    CACHE: CACHE,
                    API_URL: MANAGER_API,
                    Utils: TTS_Utils,
                    Callbacks: { refreshData, saveSettings, toggleMasterSwitch, toggleAutoGenerate }
                });
            }
            */

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
    // ================= [新增] 救援模式 UI (手动 IP 配置) =================
    function showEmergencyConfig(currentApi) {
        // 防止重复添加
        if ($('#tts-emergency-box').length > 0) return;

        const html = `
            <div id="tts-emergency-box" style="
                position: fixed; top: 10px; right: 10px; z-index: 999999;
                background: #2d3436; color: #fff; padding: 15px;
                border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                font-family: sans-serif; font-size: 14px; border: 1px solid #ff7675;
                max-width: 250px;
            ">
                <div style="font-weight:bold; color:#ff7675; margin-bottom:8px;">⚠️ 无法连接插件后端，请检查是否开启插件后端</div>
                <div style="font-size:12px; color:#aaa; margin-bottom:8px;">尝试连接: ${currentApi} 失败。<br>请手动输入电脑 IP：</div>

                <input type="text" id="tts-emergency-ip" placeholder="例如: 192.168.1.5"
                    style="width:100%; box-sizing:border-box; padding:5px; margin-bottom:8px; border-radius:4px; border:none;">

                <button id="tts-emergency-save" style="
                    width:100%; padding:6px; background:#0984e3; color:white;
                    border:none; border-radius:4px; cursor:pointer;
                ">保存并重连</button>

                <div style="margin-top:8px; text-align:center;">
                    <button id="tts-emergency-close" style="background:none; border:none; color:#aaa; font-size:12px; text-decoration:underline; cursor:pointer;">关闭</button>
                </div>
            </div>
        `;

        $('body').append(html);

        // 自动填入之前可能存过的 IP
        const saved = localStorage.getItem('tts_plugin_remote_config');
        if (saved) {
            try {
                const p = JSON.parse(saved);
                if (p.ip) $('#tts-emergency-ip').val(p.ip);
            } catch (e) { }
        }

        // 绑定关闭事件
        $('#tts-emergency-close').on('click', function () {
            $('#tts-emergency-box').remove();
        });

        // 绑定保存事件
        $('#tts-emergency-save').on('click', function () {
            const ip = $('#tts-emergency-ip').val().trim();
            if (!ip) return alert("请输入 IP");

            // 保存到标准 LocalStorage (与 index.js 顶部的读取逻辑对应)
            localStorage.setItem('tts_plugin_remote_config', JSON.stringify({
                useRemote: true,
                ip: ip
            }));

            alert(`设置已保存: ${ip}\n页面即将刷新...`);
            location.reload();
        });
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
            await loadModule('dom_parser');
            await loadModule('scheduler');
            await loadModule('events');

            console.log("🎨 [Loader] 加载UI分层模块...");
            await loadModule('ui_templates');
            await loadModule('ui_dashboard');
            await loadModule('ui_main');
            console.log("📱 [Loader] 加载手机端模块...");
            await loadModule('llm_client');
            await loadModule('mobile_ui');

            console.log("✅ [Loader] 所有模块加载完毕，启动插件");
            initPlugin();
            if (window.TTS_Mobile && window.TTS_Mobile.init) {
                window.TTS_Mobile.init();
            }

        } catch (error) {
            console.error("❌ TTS插件启动失败:", error);
            showEmergencyConfig(MANAGER_API);
        }
    }
    bootstrap();
})();
