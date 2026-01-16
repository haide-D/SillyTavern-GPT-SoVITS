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

                const $navBar = createNavbar("系统配置");
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
                container.empty();
                container.append(createNavbar("我的收藏"));

                // 1. 创建 Tab 栏
                const $tabs = $(`
                    <div style="display:flex; padding:10px 15px; gap:10px;">
                        <div class="fav-tab active" data-tab="current" style="flex:1; text-align:center; padding:8px; background:#fff; border-radius:8px; font-weight:bold; color:#e11d48; box-shadow:0 1px 2px rgba(0,0,0,0.1); cursor:pointer;">当前对话</div>
                        <div class="fav-tab" data-tab="others" style="flex:1; text-align:center; padding:8px; background:rgba(255,255,255,0.5); border-radius:8px; color:#666; cursor:pointer;">其他收藏</div>
                    </div>
                `);
                container.append($tabs);

                const $content = $('<div style="padding:0 15px 15px 15px; flex:1; overflow-y:auto;"></div>');
                $content.html('<div style="text-align:center; padding-top:20px; color:#999;">正在智能匹配...</div>');
                container.append($content);

                // 2. 准备数据
                const fingerprints = window.TTS_Utils ? window.TTS_Utils.getCurrentContextFingerprints() : [];
                let charName = "";
                try {
                    if(window.SillyTavern && window.SillyTavern.getContext) {
                        const ctx = window.SillyTavern.getContext();
                        if (ctx.characters && ctx.characterId !== undefined) {
                            const charObj = ctx.characters[ctx.characterId];
                            if (charObj && charObj.name) {
                                charName = charObj.name;
                            }
                        }
                    }
                } catch(e) {
                    console.warn("获取角色名失败:", e);
                }

                console.log("🔍 [手机收藏] 正在查询角色:", charName || "所有角色");

                // 3. 发送智能请求
                try {
                    const res = await window.TTS_API.getMatchedFavorites({
                        char_name: charName,
                        fingerprints: fingerprints
                    });
                    if (res.status !== 'success') throw new Error(res.msg);
                    const data = res.data;
                    // 4. 渲染函数
                    const renderList = (list, emptyMsg) => {
                        if (!list || list.length === 0) {
                            return `<div style="padding:40px 20px; text-align:center; color:#888; font-size:14px;">${emptyMsg}</div>`;
                        }

                        return list.map(item => {
                            let contextHtml = '';
                            if(item.context && item.context.length) {
                                contextHtml = `<div style="font-size:12px; color:#666; background:rgba(0,0,0,0.05); padding:6px; border-radius:4px; margin-bottom:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    📝 ${item.context[item.context.length-1]}
                                </div>`;
                            }
                            const dateStr = item.created_at ? item.created_at.split(' ')[0] : '';
                            const borderStyle = item.is_current ? 'border-left: 4px solid #e11d48;' : '';

                            return `
                                <div class="fav-item" data-id="${item.id}" data-url="${item.audio_url}" style="background:#fff; border-radius:12px; padding:12px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,0.05); ${borderStyle}">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                        <strong style="color:#e11d48; font-size:14px;">${item.char_name || '未知角色'}</strong>
                                        <span style="font-size:11px; color:#999;">${dateStr}</span>
                                    </div>
                                    ${contextHtml}
                                    <div style="font-size:14px; color:#333; margin-bottom:10px; line-height:1.4;">“${item.text}”</div>
                                    <div style="display:flex; gap:10px;">
                                        <button class="fav-play-btn" style="flex:1; background:#f3f4f6; border:none; padding:8px; border-radius:8px; font-weight:600; color:#374151;">▶ 播放</button>
                                        <button class="fav-del-btn" style="width:40px; background:#fee2e2; border:none; color:#dc2626; border-radius:8px; display:flex; align-items:center; justify-content:center;">🗑️</button>
                                    </div>
                                </div>`;
                        }).join('');
                    };

                    $content.html(renderList(data.current, "当前对话没有收藏记录<br>试着去其他收藏里找找？"));

                    // 5. 绑定 Tab 切换
                    $tabs.find('.fav-tab').click(function() {
                        const $t = $(this);
                        $tabs.find('.fav-tab').removeClass('active').css({background:'rgba(255,255,255,0.5)', color:'#666', boxShadow:'none'});
                        $t.addClass('active').css({background:'#fff', color:'#e11d48', boxShadow:'0 1px 2px rgba(0,0,0,0.1)'});

                        const tabType = $t.data('tab');
                        if (tabType === 'current') {
                            $content.html(renderList(data.current, "当前对话没有收藏记录"));
                        } else {
                            $content.html(renderList(data.others, "暂无其他收藏"));
                        }
                        bindListEvents();
                    });

                    // 6. 绑定列表按钮
                    function bindListEvents() {
                        $content.find('.fav-play-btn').off().click(function(e) {
                            e.stopPropagation();
                            const $item = $(this).closest('.fav-item');
                            const url = $item.data('url');
                            if (window.TTS_Events && window.TTS_Events.playAudio) {
                                window.TTS_Events.playAudio("fav_play_" + Date.now(), url);
                            } else {
                                new Audio(url).play();
                            }
                        });

                        $content.find('.fav-del-btn').off().click(async function(e) {
                            e.stopPropagation();
                            if(!confirm("确定删除这条收藏吗？")) return;
                            const $item = $(this).closest('.fav-item');
                            const id = $item.data('id');
                            try {
                                await window.TTS_API.deleteFavorite(id);
                                $item.fadeOut(300, function(){ $(this).remove(); });
                                data.current = data.current.filter(i => i.id !== id);
                                data.others = data.others.filter(i => i.id !== id);
                            } catch(err) { alert("删除失败: " + err.message); }
                        });
                    }

                    bindListEvents();

                } catch (e) {
                    console.error(e);
                    $content.html(`<div style="padding:20px; text-align:center; color:red;">加载失败: ${e.message}</div>`);
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
        renderHomeScreen();
    }

    function closePhone() {
        $('#tts-mobile-root').addClass('minimized');
        $('#tts-mobile-trigger').fadeIn();
        STATE.isOpen = false;
    }

})(window.TTS_Mobile);
