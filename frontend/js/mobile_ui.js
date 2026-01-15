window.TTS_Mobile = window.TTS_Mobile || {};

(function(scope) {
    // 状态管理
    let STATE = {
        isOpen: false,
        currentApp: null // null = 桌面
    };

    // App 注册表：以后加功能就在这里加
    const APPS = {
        'settings': {
            name: '系统设置',
            icon: '⚙️',
            bg: '#333',
            // 🟢 改为 async 函数，以便等待数据刷新
            render: async (container) => {
                // 1. 显示加载状态 (提升体验)
                container.html(`
                    <div style="display:flex; flex-direction:column; height:100%; align-items:center; justify-content:center; color:#888;">
                        <div style="font-size:24px; margin-bottom:10px;">⏳</div>
                        <div>正在同步配置...</div>
                    </div>
                `);

                // 2. 🟢 强制刷新数据 (解决下拉框空白、角色列表不显示的问题)
                try {
                    if (window.refreshTTS) {
                        await window.refreshTTS();
                    } else if (window.TTS_UI && window.TTS_UI.CTX && window.TTS_UI.CTX.Callbacks.refreshData) {
                        await window.TTS_UI.CTX.Callbacks.refreshData();
                    }
                } catch (e) {
                    console.error("刷新数据失败", e);
                }

                // 3. 安全检查：确保核心 UI 模块已加载
                if (!window.TTS_UI || !window.TTS_UI.Templates || !window.TTS_UI.CTX) {
                    container.html('<div style="padding:20px; text-align:center;">⚠️ 核心UI模块未就绪</div>');
                    return;
                }

                // 4. 准备数据 (获取最新配置)
                const CTX = window.TTS_UI.CTX;
                const settings = CTX.CACHE.settings || {};

                let config = { useRemote: false, ip: "" };
                try {
                    const saved = localStorage.getItem('tts_plugin_remote_config');
                    if(saved) config = JSON.parse(saved);
                } catch(e) {}

                const templateData = {
                    isEnabled: settings.enabled !== false,
                    settings: settings,
                    isRemote: config.useRemote,
                    remoteIP: config.ip,
                    currentBase: settings.base_dir || "",
                    currentCache: settings.cache_dir || "",
                    currentLang: settings.default_lang || "default"
                };

                // 5. 生成 HTML (复用 Templates 模块)
                const fullHtml = window.TTS_UI.Templates.getDashboardHTML(templateData);
                // 包装一下方便 jQuery 查找
                const $tempContent = $('<div>').append(fullHtml);
                // 提取核心面板部分 (class="tts-panel" 或 id="tts-dashboard")
                const $panel = $tempContent.find('#tts-dashboard');

                // 6. 清理与适配
                // 移除 PC 端专用的标题栏和关闭按钮
                $panel.find('.tts-header').remove();
                $panel.find('.tts-close').remove();

                // 添加手机专用类 (用于 CSS 修正 overflow 和 padding)
                $panel.addClass('mobile-settings-content');

                // 🟢 移除 ID，防止样式冲突，但保留内部子元素的 ID (如 #tts-new-model) 以便逻辑绑定
                $panel.removeAttr('id');

                // 7. 构建手机顶部导航栏
                const $navBar = $(`
                    <div class="mobile-app-navbar">
                        <div class="nav-left" style="display:flex; align-items:center;">
                            <span style="font-size:20px; margin-right:5px;">‹</span> 设置
                        </div>
                        <div class="nav-title">系统配置</div>
                        <div class="nav-right" style="width:40px;"></div>
                    </div>
                `);

                // 绑定返回事件 (点击返回 -> 触发 Home 键逻辑)
                $navBar.find('.nav-left').click(() => {
                    $('#mobile-home-btn').click();
                });

                // 8. 渲染到手机屏幕容器
                container.empty();
                container.append($navBar);
                container.append($panel);

                // 9. 🟢 重新激活逻辑 (关键步骤)
                // 因为 HTML 是新生成的，必须重新运行渲染列表和绑定事件的函数
                // 这些函数会寻找页面上 ID 为 #tts-new-model, #tts-mapping-list 的元素
                if (window.TTS_UI.renderDashboardList) window.TTS_UI.renderDashboardList();
                if (window.TTS_UI.renderModelOptions) window.TTS_UI.renderModelOptions();
                if (window.TTS_UI.bindDashboardEvents) window.TTS_UI.bindDashboardEvents();
            }
        },
        'favorites': {
            name: '收藏夹',
            icon: '❤️',
            bg: '#e11d48',
            render: (container) => {
                container.innerHTML = `<div style="padding:20px; text-align:center; margin-top:50%">功能开发中...<br>这里将显示收藏的语音</div>`;
            }
        },
        'history': {
            name: '历史记录',
            icon: '🕒',
            bg: '#2563eb',
            render: (container) => {
                container.innerHTML = `<div style="padding:20px;">这里显示最近生成的50条语音</div>`;
            }
        },
        'phone': {
            name: '电话',
            icon: '📞',
            bg: '#10b981', // 绿色
            render: (container) => {
                container.innerHTML = `<div style="padding:20px; text-align:center;">拨号盘界面<br>(未来扩展)</div>`;
            }
        }
    };

    scope.init = function() {
        if($('#tts-mobile-root').length === 0) {
            injectStyles();
            renderShell();
            bindEvents();
            console.log("📱 [Mobile] 手机界面已初始化");
        }
    };

    // 1. 注入 CSS
    function injectStyles() {
        // ✅ 既然 index.js 已经加载了外部 mobile.css文件，这里什么都不用做！
        console.log("📱 [Mobile] CSS 应由 Loader 加载，跳过 JS 注入");
    }

    // 2. 渲染手机外壳 (更新版：增加了侧边电源键)
    function renderShell() {
        const html = `
        <div id="tts-mobile-trigger">📱</div>

        <div id="tts-mobile-root" class="minimized">
            <div id="tts-mobile-power-btn" title="关闭手机"></div>
            <div class="side-btn volume-up"></div>
            <div class="side-btn volume-down"></div>

            <div class="mobile-notch"></div>

            <div class="status-bar">
                <span>10:24</span>
                <span>📶 5G 🔋 100%</span>
            </div>

            <div class="mobile-screen" id="mobile-screen-content">
                </div>

            <div class="mobile-home-bar" id="mobile-home-btn"></div>
        </div>
        `;
        $('body').append(html);
        renderHomeScreen();
    }

    // 3. 渲染桌面 (Grid)
    function renderHomeScreen() {
        const $screen = $('#mobile-screen-content');
        $screen.empty(); // 清空内容

        // 渲染壁纸背景容器
        const $grid = $(`<div class="app-grid"></div>`);

        Object.keys(APPS).forEach(key => {
            const app = APPS[key];
            const item = `
            <div class="app-icon-wrapper" data-app="${key}">
                <div class="app-icon" style="background:${app.bg || 'rgba(255,255,255,0.2)'}">
                    ${app.icon}
                </div>
                <span class="app-name">${app.name}</span>
            </div>
            `;
            $grid.append(item);
        });

        $screen.append($grid);
        STATE.currentApp = null;
    }

    // 4. 打开某个 App
    scope.openApp = function(appKey) {
        const app = APPS[appKey];
        if(!app) return;

        // 如果配置了直接 action（比如设置），则执行并返回，不切换屏幕
        if(app.action) {
            app.action();
            return;
        }

        // 切换屏幕内容
        const $screen = $('#mobile-screen-content');
        $screen.empty();

        // 创建 App 容器
        const $appContainer = $(`<div class="app-container" style="width:100%; height:100%; background:#fff; color:#000; overflow-y:auto; padding-top:30px;"></div>`);

        // 渲染 App 内容
        if(app.render) {
            app.render($appContainer);
        }

        $screen.append($appContainer);
        STATE.currentApp = appKey;
    };

    // 5. 事件绑定 (更新版：包含点击外部关闭)
    // 5. 事件绑定 (修正版)
    function bindEvents() {
        const $phone = $('#tts-mobile-root');

        // A. 点击悬浮球 -> 切换开关
        $('#tts-mobile-trigger').click(function(e) {
            e.stopPropagation();
            togglePhone();
        });

        // B. 点击侧边电源键 -> 关闭
        $('#tts-mobile-power-btn').click(function(e) {
            e.stopPropagation();
            closePhone();
        });

        // C. 点击屏幕外部 -> 关闭
        $(document).on('click', function(e) {
            if (STATE.isOpen) {
                if ($(e.target).closest('#tts-mobile-root, #tts-mobile-trigger').length === 0) {
                    closePhone();
                }
            }
        });

        // D. 阻止手机内部点击冒泡 (必须保留，但要注意它会拦截 document 的监听)
        $phone.on('click', function(e) {
            e.stopPropagation();
        });

        // ==========================================
        // ❌ 错误写法：事件传不到 document
        // $(document).on('click', '.app-icon-wrapper', function() { ... });
        // ==========================================

        // ✅ 修正写法：直接在手机容器上监听委托事件
        // 这样点击图标冒泡到 $phone 时，会先触发这个处理函数，然后才被上面的 stopPropagation 截断
        $phone.on('click', '.app-icon-wrapper', function() {
            const key = $(this).data('app');
            scope.openApp(key);
        });

        // F. 底部 Home 条
        $('#mobile-home-btn').click(function() {
            renderHomeScreen();
        });
    }

    // 辅助函数：开关逻辑
    function togglePhone() {
        const $phone = $('#tts-mobile-root');
        if (STATE.isOpen) closePhone();
        else openPhone();
    }

    function openPhone() {
        $('#tts-mobile-root').removeClass('minimized');
        $('#tts-mobile-trigger').fadeOut(); // 打开时隐藏悬浮球，看着更干净
        STATE.isOpen = true;
    }

    function closePhone() {
        $('#tts-mobile-root').addClass('minimized');
        $('#tts-mobile-trigger').fadeIn();
        STATE.isOpen = false;
    }

})(window.TTS_Mobile);
