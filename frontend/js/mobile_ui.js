window.TTS_Mobile = window.TTS_Mobile || {};

(function (scope) {
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
                    if (saved) config = JSON.parse(saved);
                } catch (e) { }

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
            bg: 'var(--s-ready-bg, #e11d48)',
            render: async (container) => {
                container.empty();
                container.append(createNavbar("我的收藏"));
                const CTX = window.TTS_UI.CTX;
                const activeStyle = (CTX && CTX.CACHE.settings && CTX.CACHE.settings.bubble_style) || 'default';
                const $tabs = $(`
                    <div style="display:flex; padding:10px 15px; gap:10px;">
                        <div class="fav-tab active" data-tab="current" style="flex:1; text-align:center; padding:8px; border-radius:8px; font-weight:bold; cursor:pointer;">当前对话</div>
                        <div class="fav-tab" data-tab="others" style="flex:1; text-align:center; padding:8px; border-radius:8px; cursor:pointer;">其他收藏</div>
                    </div>
                `);
                container.append($tabs);

                const $content = $(`<div style="padding:0 15px 15px 15px; flex:1; overflow-y:auto;" data-bubble-style="${activeStyle}"></div>`);
                $content.html('<div style="text-align:center; padding-top:20px; opacity:0.6;">正在智能匹配...</div>');
                container.append($content);

                // 2. 准备数据
                const fingerprints = window.TTS_Utils ? window.TTS_Utils.getCurrentContextFingerprints() : [];
                let charName = "";
                try {
                    if (window.SillyTavern && window.SillyTavern.getContext) {
                        const ctx = window.SillyTavern.getContext();
                        if (ctx.characters && ctx.characterId !== undefined) {
                            const charObj = ctx.characters[ctx.characterId];
                            if (charObj && charObj.name) {
                                charName = charObj.name;
                            }
                        }
                    }
                } catch (e) {
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

                    const renderList = (list, emptyMsg) => {
                        if (!list || list.length === 0) {
                            return `<div style="padding:40px 20px; text-align:center; opacity:0.6; font-size:14px;">${emptyMsg}</div>`;
                        }
                        const BARS_HTML = `<span class='sovits-voice-waves'><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span></span>`;

                        return list.map(item => {
                            // 🔥 修改3：Context 不再写死颜色，使用 class="fav-context-box"
                            let contextHtml = '';
                            if (item.context && item.context.length) {
                                contextHtml = `<div class="fav-context-box" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    📝 ${item.context[item.context.length - 1]}
                                </div>`;
                            }


                            let fullUrl = item.audio_url;

                            // 🔧 关键修复:将静态文件路径转换为下载 API 端点
                            if (fullUrl && fullUrl.startsWith('/favorites/')) {
                                // 提取文件名
                                const filename = fullUrl.replace('/favorites/', '');
                                // 使用下载 API 端点 (带有正确的 CORS 头)
                                fullUrl = window.TTS_API.baseUrl + `/download_favorite/${filename}`;
                            } else if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
                                fullUrl = window.TTS_API.baseUrl + fullUrl;
                            }
                            const cleanText = item.text || "";
                            const d = Math.max(1, Math.ceil(cleanText.length * 0.25));
                            const bubbleWidth = Math.min(220, 60 + d * 10);

                            // 🔥 修改4：彻底移除 cardStyle 变量，改用 class 控制样式
                            // 增加 current-item 类来控制左边的竖条颜色
                            const itemClass = item.is_current ? 'fav-item current-item' : 'fav-item';

                            return `
                                <div class="${itemClass}" data-id="${item.id}">

                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                        <strong class="fav-item-name">${item.char_name || '未知角色'}</strong>
                                        <span class="fav-item-date">${item.created_at ? item.created_at.split(' ')[0] : ''}</span>
                                    </div>
                                    ${contextHtml}
                                    <div class="fav-text-content">“${item.text}”</div>

                                    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px;">
                                        <div class="voice-bubble ready fav-play-bubble"
                                             data-url="${fullUrl}"
                                             data-voice-name="${item.char_name}"
                                             data-text="${item.text}"
                                             data-status="ready"
                                             style="width: ${bubbleWidth}px; cursor:pointer; display:flex; align-items:center; justify-content:space-between;">

                                             ${BARS_HTML}

                                             <span class="sovits-voice-duration" style="margin-left:auto;">${d}"</span>
                                        </div>

                                        <button class="fav-download-btn" style="background:transparent; border:none; color:#3b82f6; opacity:0.6; padding:5px 10px;">⬇️</button>
                                        <button class="fav-del-btn" style="background:transparent; border:none; color:#dc2626; opacity:0.6; padding:5px 10px;">🗑️</button>
                                    </div>
                                </div>`;
                        }).join('');
                    };

                    $content.html(renderList(data.current, "当前对话没有收藏记录<br>试着去其他收藏里找找？"));

                    // 5. 绑定 Tab 切换
                    $tabs.find('.fav-tab').click(function () {
                        const $t = $(this);
                        // 🔥 修改5：不再手动改 CSS background，而是只切换 active 类
                        $tabs.find('.fav-tab').removeClass('active');
                        $t.addClass('active');

                        const tabType = $t.data('tab');
                        if (tabType === 'current') {
                            $content.html(renderList(data.current, "当前对话没有收藏记录"));
                        } else {
                            $content.html(renderList(data.others, "暂无其他收藏"));
                        }
                        bindListEvents(); // 记得重新绑定事件
                    });

                    $content.html(renderList(data.current, "当前对话没有收藏记录<br>试着去其他收藏里找找？"));

                    // 5. 绑定 Tab 切换
                    $tabs.find('.fav-tab').click(function () {
                        const $t = $(this);
                        $tabs.find('.fav-tab').removeClass('active').css({ background: 'rgba(255,255,255,0.5)', color: '#666', boxShadow: 'none' });
                        $t.addClass('active').css({ background: '#fff', color: '#e11d48', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' });

                        const tabType = $t.data('tab');
                        if (tabType === 'current') {
                            $content.html(renderList(data.current, "当前对话没有收藏记录"));
                        } else {
                            $content.html(renderList(data.others, "暂无其他收藏"));
                        }
                        bindListEvents();
                    });

                    // 🟢 [修改] bindListEvents
                    function bindListEvents() {
                        let currentAudio = null;
                        let $currentBubble = null;

                        $content.find('.fav-play-bubble').off().click(async function (e) {
                            e.stopPropagation();
                            const $bubble = $(this);
                            let url = $bubble.data('url');

                            // 停止当前
                            if ($bubble.hasClass('playing') && currentAudio) {
                                currentAudio.pause();
                                resetBubble($bubble);
                                currentAudio = null;
                                return;
                            }

                            // 停止其他
                            if (currentAudio) {
                                currentAudio.pause();
                                if ($currentBubble) resetBubble($currentBubble);
                            }

                            // 🔧 关键修复:如果是服务器路径,转换为 Blob URL 并缓存
                            if (!url.startsWith('blob:')) {
                                try {
                                    console.log("🔄 转换服务器路径为 Blob URL:", url);
                                    const response = await fetch(url);
                                    if (!response.ok) throw new Error('获取音频失败');
                                    const blob = await response.blob();
                                    const blobUrl = URL.createObjectURL(blob);

                                    // 缓存到 data-audio-url 属性,供下载使用
                                    $bubble.attr('data-audio-url', blobUrl);
                                    url = blobUrl;
                                    console.log("✅ Blob URL 已缓存:", blobUrl);
                                } catch (err) {
                                    console.error("转换 Blob URL 失败:", err);
                                    alert("❌ 音频加载失败,请重试");
                                    return;
                                }
                            }

                            console.log("▶️ 气泡播放:", url);

                            // 播放状态：变为 playing (通常会有呼吸灯效果)
                            $bubble.addClass('playing');

                            const audio = new Audio(url);
                            currentAudio = audio;
                            $currentBubble = $bubble;

                            audio.play().catch(err => {
                                console.error("播放失败", err);
                                resetBubble($bubble);
                            });

                            audio.onended = function () {
                                resetBubble($bubble);
                                currentAudio = null;
                            };

                            function resetBubble($b) {
                                // 🌟 重点：移除 playing，强制加回 ready，并确保 data-status 正确
                                $b.removeClass('playing').addClass('ready');
                                $b.attr('data-status', 'ready'); // 双重保险，防止变灰
                            }
                        });

                        // ... 删除按钮逻辑保持不变 ...
                        $content.find('.fav-del-btn').off().click(async function (e) {
                            e.stopPropagation();
                            if (!confirm("确定删除这条收藏吗？")) return;
                            const $item = $(this).closest('.fav-item');
                            const id = $item.data('id');
                            try {
                                await window.TTS_API.deleteFavorite(id);
                                $item.fadeOut(300, function () { $(this).remove(); });
                            } catch (err) { alert("删除失败: " + err.message); }
                        });

                        // 下载按钮逻辑
                        $content.find('.fav-download-btn').off().click(async function (e) {
                            e.stopPropagation();
                            const $item = $(this).closest('.fav-item');
                            const $bubble = $item.find('.fav-play-bubble');

                            // 🔧 直接使用下载 API URL (已经包含正确的 CORS 头)
                            // data-url 已经在上面被转换为 /download_favorite/xxx.wav 格式
                            const audioUrl = $bubble.data('url');
                            const speaker = $bubble.data('voice-name') || 'Unknown';
                            const text = $bubble.data('text') || $item.find('.fav-text-content').text().replace(/^"|"$/g, '').trim();

                            // 🔍 调试日志
                            console.log("📥 下载收藏项:");
                            console.log("  - audioUrl:", audioUrl);
                            console.log("  - speaker:", speaker);
                            console.log("  - text:", text);

                            // 🔧 构建自定义文件名并添加到 URL
                            const cleanText = text.substring(0, 50).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
                            const customFilename = `${speaker}:${cleanText}.wav`;

                            // 将自定义文件名作为查询参数添加到 URL
                            let finalUrl = audioUrl;
                            if (audioUrl.includes('/download_favorite/')) {
                                const url = new URL(audioUrl);
                                url.searchParams.set('custom_filename', customFilename);
                                finalUrl = url.toString();
                            }

                            console.log("  - customFilename:", customFilename);
                            console.log("  - final URL:", finalUrl);

                            // 调用共用下载函数 (下载 API 返回的是可下载的文件,不会有 CORS 问题)
                            if (window.TTS_Events && window.TTS_Events.downloadAudio) {
                                // 注意:这里传递的 text 参数不会被使用,因为文件名已经在 URL 中了
                                await window.TTS_Events.downloadAudio(finalUrl, speaker, text);
                            } else {
                                alert("❌ 下载功能未就绪,请刷新页面");
                            }
                        });
                    }

                    bindListEvents();

                } catch (e) {
                    console.error(e);
                    $content.html(`<div style="padding:20px; text-align:center; color:red;">加载失败: ${e.message}</div>`);
                }
            }
        },
        // 🔴 [临时注释] 后续再处理
        // 'history': {
        //     name: '历史记录',
        //     icon: '🕒',
        //     bg: '#2563eb',
        //     render: (container) => {
        //         container.empty();
        //         // 🟢 [修复] 加上导航栏
        //         container.append(createNavbar("生成记录"));

        //         const $content = $('<div style="padding:20px; flex:1; overflow-y:auto;"></div>');
        //         $content.html(`
        //             <div style="text-align:center; color:#888; margin-top:50px;">
        //                 🚧 开发中<br>这里将显示最近生成的50条语音
        //             </div>
        //         `);
        //         container.append($content);
        //     }
        // },
        // 'phone': {
        //     name: '电话',
        //     icon: '📞',
        //     bg: '#10b981',
        //     render: (container) => {
        //         container.empty();
        //         container.append(createNavbar("拨号键盘"));
        //         container.append(`<div style="padding:20px; text-align:center; flex:1; display:flex; align-items:center; justify-content:center;">拨号盘界面<br>(未来扩展)</div>`);
        //     }
        // }
    };

    scope.init = function () {
        if ($('meta[name="viewport"]').length === 0) {
            $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">');
            console.log("📱 [Mobile] 已注入 Viewport 标签以适配手机屏幕");
        }

        if ($('#tts-mobile-root').length === 0) {
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
        <div id="tts-mobile-trigger">
            <div class="trigger-bubble-inner">
                <div class="trigger-waves">
                    <span class="trigger-bar"></span>
                    <span class="trigger-bar"></span>
                    <span class="trigger-bar"></span>
                </div>
            </div>
        </div>
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

    scope.openApp = function (appKey) {
        const app = APPS[appKey];
        if (!app) return;

        if (app.action) {
            app.action();
            return;
        }

        const $screen = $('#mobile-screen-content');
        $screen.empty();
        const $appContainer = $(`<div class="app-container" style="width:100%; height:100%; display:flex; flex-direction:column; background:#f2f2f7; color:#000;"></div>`);

        if (app.render) {
            app.render($appContainer);
        }
        $screen.append($appContainer);
        STATE.currentApp = appKey;
    };

    function bindEvents() {
        const $phone = $('#tts-mobile-root');
        const $trigger = $('#tts-mobile-trigger');

        // ============================================================
        // 🟢 [终极修复版] 悬浮球拖拽逻辑 (带防抖死区)
        // ============================================================
        let isDragging = false;
        let hasMoved = false; // 标记是否发生了实质性拖拽

        // 记录起始数据
        let startX, startY;   // 手指刚按下时的屏幕坐标
        let shiftX, shiftY;   // 手指在小球内部的偏移量
        let winW, winH;       // 屏幕宽高缓存

        // 防抖阈值 (像素)：小于这个距离视为点击，大于视为拖拽
        // 如果觉得还是太灵敏，可以把 10 改成 15
        const DRAG_THRESHOLD = 10;

        // 1. 按下 (鼠标或手指)
        $trigger.on('mousedown touchstart', function (e) {
            // 多指触控忽略
            if (e.type === 'touchstart' && e.touches.length > 1) return;

            // 阻止默认行为 (防止选中文本等)
            if (e.cancelable) e.preventDefault();

            const point = e.type === 'touchstart' ? e.touches[0] : e;
            const rect = $trigger[0].getBoundingClientRect();

            // 记录初始状态
            startX = point.clientX;
            startY = point.clientY;

            // 计算手指在小球内的偏移量，保证拖拽时不跳变
            shiftX = startX - rect.left;
            shiftY = startY - rect.top;

            winW = $(window).width();
            winH = $(window).height();

            isDragging = true;
            hasMoved = false; // 重置标记

            // 绑定全局事件
            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchend', onUp);
        });

        // 2. 移动
        function onMove(e) {
            if (!isDragging) return;
            if (e.cancelable) e.preventDefault(); // 防止屏幕随手指滚动

            const point = e.type === 'touchmove' ? e.touches[0] : e;
            const currentX = point.clientX;
            const currentY = point.clientY;

            // 🔥 [核心逻辑] 计算移动距离
            // 如果还未标记为“移动中”，先计算距离是否超过阈值
            if (!hasMoved) {
                const moveDis = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));

                // 如果移动距离太小（手抖），直接退出，不改变小球位置！
                if (moveDis < DRAG_THRESHOLD) {
                    return;
                }

                // 超过阈值了！正式确认为拖拽模式
                hasMoved = true;

                // ⚡️ 此时才把 CSS 锁死为绝对定位，防止跳变
                const rect = $trigger[0].getBoundingClientRect();
                $trigger.css({
                    position: 'fixed',
                    right: 'auto',
                    bottom: 'auto',
                    transform: 'none' // 去掉 CSS 的居中变换
                });
            }

            // --- 下面是正式的拖拽逻辑 ---

            let newLeft = currentX - shiftX;
            let newTop = currentY - shiftY;

            // 边界限制
            newLeft = Math.max(0, Math.min(winW - 60, newLeft));
            newTop = Math.max(0, Math.min(winH - 60, newTop));

            $trigger.css({
                left: newLeft + 'px',
                top: newTop + 'px'
            });
        }

        // 3. 抬起
        function onUp(e) {
            isDragging = false;

            // 解绑
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchend', onUp);

            // 🔥 判决时刻：
            // 如果 hasMoved 依然是 false，说明手指移动没超过 10px
            // 这就是一次完美的“点击”！
            if (!hasMoved) {
                togglePhone();
            } else {
                // 如果是拖拽结束，可以加个吸附效果（可选）
                snapToEdge();
            }
        }

        // 自动贴边 (可选，不喜欢可以删掉)
        function snapToEdge() {
            const rect = $trigger[0].getBoundingClientRect();
            const midX = winW / 2;
            const targetLeft = (rect.left + 30 < midX) ? 10 : (winW - 70);

            // 使用 jQuery 动画平滑吸附
            $trigger.animate({ left: targetLeft }, 200);
        }

        // ============================================================
        // 其他原有事件
        // ============================================================

        $('#tts-mobile-power-btn').click(function (e) {
            e.stopPropagation();
            closePhone();
        });

        $(document).on('click', function (e) {
            if (STATE.isOpen) {
                if ($(e.target).closest('#tts-mobile-root, #tts-mobile-trigger').length === 0) {
                    closePhone();
                }
            }
        });

        $phone.on('click', function (e) {
            e.stopPropagation();
        });

        $phone.on('click', '.app-icon-wrapper', function () {
            const key = $(this).data('app');
            scope.openApp(key);
        });

        $('#mobile-home-btn').click(function () {
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
