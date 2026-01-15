window.TTS_Mobile = window.TTS_Mobile || {};

(function(scope) {
    // 状态管理
    let STATE = {
        isOpen: false,
        currentApp: null // null = 桌面
    };

    // 🟢 [新增] 通用导航栏生成器 (大家都能用，不用复制粘贴了)
    function createNavbar(title) {
        const $nav = $(`
            <div class="mobile-app-navbar">
                <div class="nav-left" style="display:flex; align-items:center;">
                    <span style="font-size:20px; margin-right:5px;">‹</span> 返回
                </div>
                <div class="nav-title">${title}</div>
                <div class="nav-right" style="width:40px;"></div>
            </div>
        `);
        // 绑定返回逻辑：模拟点击 Home 条
        $nav.find('.nav-left').click(() => {
            $('#mobile-home-btn').click();
        });
        return $nav;
    }

    // App 注册表
    const APPS = {
        'settings': {
            name: '系统设置',
            icon: '⚙️',
            bg: '#333',
            render: async (container) => {
                // ... (这部分保持你原来的设置逻辑不变) ...
                container.html(`
                    <div style="display:flex; flex-direction:column; height:100%; align-items:center; justify-content:center; color:#888;">
                        <div style="font-size:24px; margin-bottom:10px;">⏳</div>
                        <div>正在同步配置...</div>
                    </div>
                `);

                try {
                    if (window.refreshTTS) await window.refreshTTS();
                    else if (window.TTS_UI && window.TTS_UI.CTX && window.TTS_UI.CTX.Callbacks.refreshData) {
                        await window.TTS_UI.CTX.Callbacks.refreshData();
                    }
                } catch (e) { console.error("刷新数据失败", e); }

                if (!window.TTS_UI || !window.TTS_UI.Templates || !window.TTS_UI.CTX) {
                    container.html('<div style="padding:20px; text-align:center;">⚠️ 核心UI模块未就绪</div>');
                    return;
                }

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

                const fullHtml = window.TTS_UI.Templates.getDashboardHTML(templateData);
                const $tempContent = $('<div>').append(fullHtml);
                const $panel = $tempContent.find('#tts-dashboard');

                $panel.find('.tts-header').remove();
                $panel.find('.tts-close').remove();
                $panel.addClass('mobile-settings-content');
                $panel.removeAttr('id');

                // 🟢 使用新的通用函数生成导航栏 (这里稍微改下 title)
                const $navBar = createNavbar("系统配置");
                // 设置里原来是写的 "‹ 设置"，如果你想保持一致可以用:
                // $navBar.find('.nav-left').html('<span style="font-size:20px; margin-right:5px;">‹</span> 设置');

                container.empty();
                container.append($navBar);
                container.append($panel);

                if (window.TTS_UI.renderDashboardList) window.TTS_UI.renderDashboardList();
                if (window.TTS_UI.renderModelOptions) window.TTS_UI.renderModelOptions();
                if (window.TTS_UI.bindDashboardEvents) window.TTS_UI.bindDashboardEvents();
            }
        },
        'favorites': {
            name: '收藏夹',
            icon: '❤️',
            bg: '#e11d48',
            render: async (container) => {
                // 1. 先清空并显示加载
                container.empty();

                // 🟢 [修复] 加上导航栏
                container.append(createNavbar("我的收藏"));

                // 创建一个滚动内容区
                const $content = $('<div style="padding:15px; flex:1; overflow-y:auto;"></div>');
                $content.html('<div style="text-align:center; padding-top:20px;">正在获取云端收藏...</div>');
                container.append($content);

                try {
                    const res = await window.TTS_API.getFavorites();
                    const list = res.favorites || [];

                    if (list.length === 0) {
                        $content.html('<div style="padding:20px; text-align:center; color:#888;">暂无收藏<br>请在对话气泡上右键/长按收藏</div>');
                        return;
                    }

                    let html = '<div class="fav-list">';
                    list.forEach(item => {
                        let contextHtml = '';
                        if(item.context && item.context.length) {
                            contextHtml = `<div style="font-size:12px; color:#666; background:rgba(0,0,0,0.05); padding:6px; border-radius:4px; margin-bottom:6px;">
                                📝 ${item.context[item.context.length-1]}
                            </div>`;
                        }

                        html += `
                        <div class="fav-item" data-id="${item.id}" data-url="${item.audio_url}" style="background:#fff; border-radius:12px; padding:12px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <strong style="color:#e11d48; font-size:14px;">${item.char_name}</strong>
                                <span style="font-size:11px; color:#999;">${item.created_at.split(' ')[0]}</span>
                            </div>
                            ${contextHtml}
                            <div style="font-size:14px; color:#333; margin-bottom:10px; line-height:1.4;">“${item.text}”</div>

                            <div style="display:flex; gap:10px;">
                                <button class="fav-play-btn" style="flex:1; background:#f3f4f6; border:none; padding:8px; border-radius:8px; font-weight:600; color:#374151;">▶ 播放</button>
                                <button class="fav-del-btn" style="width:40px; background:#fee2e2; border:none; color:#dc2626; border-radius:8px; display:flex; align-items:center; justify-content:center;">🗑️</button>
                            </div>
                        </div>
                        `;
                    });
                    html += '</div>';
                    $content.html(html);

                    // 绑定事件 (注意作用域变为 $content)
                    $content.find('.fav-play-btn').click(function(e) {
                        e.stopPropagation();
                        const $item = $(this).closest('.fav-item');
                        const url = $item.data('url');
                        const audio = new Audio(url);
                        audio.play();
                    });

                    $content.find('.fav-del-btn').click(async function(e) {
                        e.stopPropagation();
                        if(!confirm("确定删除这条收藏吗？")) return;
                        const $item = $(this).closest('.fav-item');
                        const id = $item.data('id');
                        try {
                            await window.TTS_API.deleteFavorite(id);
                            $item.fadeOut(300, function(){ $(this).remove(); });
                        } catch(err) { alert("删除失败"); }
                    });

                } catch (e) {
                    console.error(e);
                    $content.html('<div style="padding:20px; text-align:center; color:red;">加载失败</div>');
                }
            }
        },
        'history': {
            name: '历史记录',
            icon: '🕒',
            bg: '#2563eb',
            render: (container) => {
                container.empty();
                // 🟢 [修复] 加上导航栏
                container.append(createNavbar("生成记录"));

                const $content = $('<div style="padding:20px; flex:1; overflow-y:auto;"></div>');
                $content.html(`
                    <div style="text-align:center; color:#888; margin-top:50px;">
                        🚧 开发中<br>这里将显示最近生成的50条语音
                    </div>
                `);
                container.append($content);
            }
        },
        'phone': {
            name: '电话',
            icon: '📞',
            bg: '#10b981',
            render: (container) => {
                container.empty();
                // 🟢 [修复] 加上导航栏
                container.append(createNavbar("拨号键盘"));
                container.append(`<div style="padding:20px; text-align:center; flex:1; display:flex; align-items:center; justify-content:center;">拨号盘界面<br>(未来扩展)</div>`);
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

    function injectStyles() {
        console.log("📱 [Mobile] CSS 应由 Loader 加载，跳过 JS 注入");
    }

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
            <div class="mobile-screen" id="mobile-screen-content"></div>
            <div class="mobile-home-bar" id="mobile-home-btn"></div>
        </div>
        `;
        $('body').append(html);
        renderHomeScreen();
    }

    function renderHomeScreen() {
        const $screen = $('#mobile-screen-content');
        $screen.empty();

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

    scope.openApp = function(appKey) {
        const app = APPS[appKey];
        if(!app) return;

        if(app.action) {
            app.action();
            return;
        }

        const $screen = $('#mobile-screen-content');
        $screen.empty();
        // 注意：这里不需要手动加 navbar 了，由各个 App 的 render 函数内部加
        // 这样可以灵活控制有些全屏应用（比如游戏）不需要 navbar
        const $appContainer = $(`<div class="app-container" style="width:100%; height:100%; display:flex; flex-direction:column; background:#f2f2f7; color:#000;"></div>`);

        if(app.render) {
            app.render($appContainer);
        }
        $screen.append($appContainer);
        STATE.currentApp = appKey;
    };

    function bindEvents() {
        const $phone = $('#tts-mobile-root');

        $('#tts-mobile-trigger').click(function(e) {
            e.stopPropagation();
            togglePhone();
        });

        $('#tts-mobile-power-btn').click(function(e) {
            e.stopPropagation();
            closePhone();
        });

        $(document).on('click', function(e) {
            if (STATE.isOpen) {
                if ($(e.target).closest('#tts-mobile-root, #tts-mobile-trigger').length === 0) {
                    closePhone();
                }
            }
        });

        $phone.on('click', function(e) {
            e.stopPropagation();
        });

        $phone.on('click', '.app-icon-wrapper', function() {
            const key = $(this).data('app');
            scope.openApp(key);
        });

        $('#mobile-home-btn').click(function() {
            renderHomeScreen();
        });
    }

    function togglePhone() {
        if (STATE.isOpen) closePhone();
        else openPhone();
    }

    function openPhone() {
        $('#tts-mobile-root').removeClass('minimized');
        $('#tts-mobile-trigger').fadeOut();
        STATE.isOpen = true;

        // 🟢 [修复核心痛点]：每次打开手机，强制回到桌面！
        renderHomeScreen();
    }

    function closePhone() {
        $('#tts-mobile-root').addClass('minimized');
        $('#tts-mobile-trigger').fadeIn();
        STATE.isOpen = false;
        // 关闭时其实也可以不销毁内容，留给下次 reset
    }

})(window.TTS_Mobile);
