if (!window.TTS_Mobile) {
    window.TTS_Mobile = {};
}

export const TTS_Mobile = window.TTS_Mobile;

(function (scope) {
    let STATE = {
        isOpen: false,
        currentApp: null
    };

    function createNavbar(title) {
        const $nav = $(`
            <div class="mobile-app-navbar">
                <div class="nav-left" style="display:flex; align-items:center;">
                    <span style="font-size:20px; margin-right:5px;">←</span> 返回
                </div>
                <div class="nav-title">${title}</div>
                <div class="nav-right" style="width:40px;"></div>
            </div>
        `);
        $nav.find('.nav-left').click(() => {
            $('#mobile-home-btn').click();
        });
        return $nav;
    }

    const APPS = {
        'incoming_call': {
            name: '来电',
            icon: '📞',
            bg: '#667eea',
            render: async (container) => {
                const callData = window.TTS_IncomingCall;

                // ========== 状态1: 有来电 - 显示接听/拒绝界面 ==========
                if (callData) {
                    container.empty();

                    const $content = $(`
                        <div class="incoming-call-container">
                            <div class="call-icon">📞</div>
                            <div class="caller-name">${callData.char_name}</div>
                            <div class="call-status">来电中...</div>
                            
                            <div class="call-buttons">
                                <button id="mobile-reject-call-btn" class="call-btn reject-btn">✕</button>
                                <button id="mobile-answer-call-btn" class="call-btn answer-btn">✓</button>
                            </div>
                        </div>
                    `);

                    container.append($content);

                    // 拒绝来电
                    $content.find('#mobile-reject-call-btn').click(function () {
                        console.log('[Mobile] 用户拒绝来电');
                        delete window.TTS_IncomingCall;
                        $('#tts-manager-btn').removeClass('incoming-call').attr('title', '🔊 TTS配置');
                        $('#tts-mobile-trigger').removeClass('incoming-call');
                        // 返回主屏幕
                        $('#mobile-home-btn').click();
                    });

                    // 接听来电
                    $content.find('#mobile-answer-call-btn').click(function () {
                        console.log('[Mobile] 用户接听来电');

                        // 显示通话中界面
                        showInCallUI(container, callData);
                    });

                    return;
                }

                // ========== 显示通话中界面的函数 ==========
                function showInCallUI(container, callData) {
                    container.empty();

                    // 生成segments HTML
                    const segmentsHTML = (callData.segments || []).map((seg, index) => {
                        const displayText = seg.translation || seg.text || '';
                        const startTime = seg.start_time || 0;

                        return `
                            <div class="call-segment" data-index="${index}" data-start-time="${startTime}">
                                <div class="segment-emotion-tag">${seg.emotion || '默认'}</div>
                                <div class="segment-text-content">${displayText}</div>
                            </div>
                        `;
                    }).join('');

                    // 创建通话中界面
                    const $inCallContent = $(`
                        <div class="in-call-container">
                            <div class="call-header">
                                <div class="call-avatar">👤</div>
                                <div class="call-name">${callData.char_name}</div>
                                <div class="call-duration">00:00</div>
                            </div>
                            
                            <!-- 对话内容区域 -->
                            <div class="call-segments-container">
                                ${segmentsHTML}
                            </div>

                            <div class="audio-visualizer">
                                <div class="audio-bar"></div>
                                <div class="audio-bar"></div>
                                <div class="audio-bar"></div>
                                <div class="audio-bar"></div>
                                <div class="audio-bar"></div>
                            </div>

                            <div class="audio-progress">
                                <div class="progress-bar-container">
                                    <div class="progress-bar-fill" style="width: 0%;"></div>
                                </div>
                                <div class="progress-time">
                                    <span class="current-time">0:00</span>
                                    <span class="total-time">0:00</span>
                                </div>
                            </div>

                            <button id="mobile-hangup-btn" class="hangup-btn">✕</button>
                        </div>
                    `);

                    container.append($inCallContent);

                    // 播放音频
                    if (callData.audio_url) {
                        // 转换为完整URL
                        let fullUrl = callData.audio_url;
                        if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
                            fullUrl = window.TTS_API.baseUrl + fullUrl;
                        }

                        console.log('[Mobile] 完整音频URL:', fullUrl);
                        const audio = new Audio(fullUrl);
                        let startTime = Date.now();
                        let durationInterval = null;

                        // 更新通话时长
                        durationInterval = setInterval(() => {
                            const elapsed = Math.floor((Date.now() - startTime) / 1000);
                            const minutes = Math.floor(elapsed / 60);
                            const seconds = elapsed % 60;
                            $inCallContent.find('.call-duration').text(
                                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                            );
                        }, 1000);

                        // 音频加载完成
                        audio.addEventListener('loadedmetadata', function () {
                            const duration = audio.duration;
                            const mins = Math.floor(duration / 60);
                            const secs = Math.floor(duration % 60);
                            $inCallContent.find('.total-time').text(`${mins}:${secs.toString().padStart(2, '0')}`);
                        });

                        // 更新进度
                        audio.addEventListener('timeupdate', function () {
                            const progress = (audio.currentTime / audio.duration) * 100;
                            $inCallContent.find('.progress-bar-fill').css('width', progress + '%');

                            const currentMins = Math.floor(audio.currentTime / 60);
                            const currentSecs = Math.floor(audio.currentTime % 60);
                            $inCallContent.find('.current-time').text(
                                `${currentMins}:${currentSecs.toString().padStart(2, '0')}`
                            );

                            // 🎯 音轨同步 - 高亮当前segment
                            const currentTime = audio.currentTime;
                            const $segments = $inCallContent.find('.call-segment');

                            // 找到当前时间对应的segment
                            let activeIndex = -1;
                            for (let i = 0; i < (callData.segments || []).length; i++) {
                                const seg = callData.segments[i];
                                const startTime = seg.start_time || 0;
                                const duration = seg.audio_duration || 0;
                                const endTime = startTime + duration;

                                if (currentTime >= startTime && currentTime < endTime) {
                                    activeIndex = i;
                                    break;
                                }
                            }

                            // 更新高亮状态
                            $segments.each(function (index) {
                                const $seg = $(this);
                                if (index === activeIndex) {
                                    $seg.addClass('active');
                                    // 自动滚动到当前segment
                                    this.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                } else {
                                    $seg.removeClass('active');
                                }
                            });
                        });

                        // 播放音频
                        audio.play().catch(err => {
                            console.error('[Mobile] 音频播放失败:', err);
                            alert('音频播放失败: ' + err.message);
                            clearInterval(durationInterval);
                            endCall();
                        });

                        // 音频播放结束
                        audio.onended = function () {
                            console.log('[Mobile] 音频播放完成');
                            clearInterval(durationInterval);
                            endCall();
                        };

                        // 挂断按钮
                        $inCallContent.find('#mobile-hangup-btn').click(function () {
                            console.log('[Mobile] 用户挂断电话');
                            audio.pause();
                            clearInterval(durationInterval);
                            endCall();
                        });

                        function endCall() {
                            delete window.TTS_IncomingCall;
                            $('#tts-manager-btn').removeClass('incoming-call').attr('title', '🔊 TTS配置');
                            $('#tts-mobile-trigger').removeClass('incoming-call');
                            // 返回主屏幕
                            $('#mobile-home-btn').click();
                        }
                    } else {
                        console.warn('[Mobile] 没有音频 URL');
                        delete window.TTS_IncomingCall;
                        $('#tts-manager-btn').removeClass('incoming-call').attr('title', '🔊 TTS配置');
                        $('#tts-mobile-trigger').removeClass('incoming-call');
                        // 返回主屏幕
                        $('#mobile-home-btn').click();
                    }
                }

                // ========== 状态2: 无来电 - 显示历史记录列表 ==========
                container.empty();
                container.append(createNavbar("来电记录"));

                const $content = $(`
                    <div style="padding:15px; flex:1; overflow-y:auto; background:#f2f2f7;">
                        <div style="text-align:center; padding:40px 20px; color:#888;">
                            <div style="font-size:24px; margin-bottom:10px;">📞</div>
                            <div>正在加载来电记录...</div>
                        </div>
                    </div>
                `);
                container.append($content);

                // 获取当前角色名
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
                    console.error('[Mobile] 获取角色名失败:', e);
                }

                if (!charName) {
                    $content.html(`
                        <div style="text-align:center; padding:40px 20px; color:#888;">
                            <div style="font-size:24px; margin-bottom:10px;">⚠️</div>
                            <div>未检测到角色</div>
                        </div>
                    `);
                    return;
                }

                // 获取历史记录
                try {
                    console.log('[Mobile] 获取来电历史:', charName);
                    const result = await window.TTS_API.getAutoCallHistory(charName, 20);

                    if (result.status !== 'success' || !result.history || result.history.length === 0) {
                        $content.html(`
                            <div style="text-align:center; padding:40px 20px; color:#888;">
                                <div style="font-size:24px; margin-bottom:10px;">📞</div>
                                <div>暂无来电记录</div>
                            </div>
                        `);
                        return;
                    }

                    // 渲染历史记录列表
                    const historyHtml = result.history.map(call => {
                        const date = call.created_at ? new Date(call.created_at).toLocaleString('zh-CN') : '未知时间';
                        const statusText = call.status === 'completed' ? '已完成' : call.status === 'failed' ? '失败' : '处理中';
                        const statusColor = call.status === 'completed' ? '#10b981' : call.status === 'failed' ? '#ef4444' : '#f59e0b';

                        return `
                            <div class="call-history-item" data-call-id="${call.id}" style="
                                background:#fff; 
                                border-radius:12px; 
                                padding:15px; 
                                margin-bottom:12px;
                                cursor:pointer;
                                transition:all 0.2s;">
                                
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                    <strong style="font-size:16px; color:#333;">${call.char_name || '未知角色'}</strong>
                                    <span style="font-size:12px; color:${statusColor};">● ${statusText}</span>
                                </div>
                                
                                <div style="font-size:13px; color:#666; margin-bottom:8px;">
                                    📅 ${date}
                                </div>
                                
                                ${call.status === 'completed' && call.audio_url ? `
                                    <div class="play-area">
                                        <div style="display:flex; align-items:center; gap:10px; padding:8px; background:#f9fafb; border-radius:8px;">
                                            <span style="font-size:20px;">🎵</span>
                                            <span style="flex:1; font-size:13px; color:#666;">点击播放</span>
                                            <span style="font-size:12px; color:#999;">→</span>
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('');

                    $content.html(historyHtml);

                    // 全局音频管理器
                    let currentAudio = null;
                    let currentCallId = null;

                    // 绑定点击事件
                    $content.find('.call-history-item').click(function () {
                        const callId = $(this).data('call-id');
                        const call = result.history.find(c => c.id === callId);

                        if (!call || call.status !== 'completed' || !call.audio_url) {
                            alert('该来电记录无法播放');
                            return;
                        }

                        // 如果点击的是正在播放的项,则停止播放
                        if (currentCallId === callId && currentAudio) {
                            currentAudio.pause();
                            currentAudio = null;
                            currentCallId = null;
                            updatePlayUI(callId, 'stopped');
                            return;
                        }

                        // 停止当前正在播放的音频
                        if (currentAudio) {
                            currentAudio.pause();
                            updatePlayUI(currentCallId, 'stopped');
                        }

                        console.log('[Mobile] 播放历史来电:', call);

                        // 转换为完整URL
                        let fullUrl = call.audio_url;
                        if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
                            fullUrl = window.TTS_API.baseUrl + fullUrl;
                        }

                        console.log('[Mobile] 完整音频URL:', fullUrl);
                        const audio = new Audio(fullUrl);
                        currentAudio = audio;
                        currentCallId = callId;

                        // 显示加载状态
                        updatePlayUI(callId, 'loading');

                        // 音频加载完成,获取时长
                        audio.addEventListener('loadedmetadata', function () {
                            const duration = audio.duration;
                            console.log('[Mobile] 音频时长:', duration);
                            updatePlayUI(callId, 'playing', duration);
                        });

                        // 更新进度
                        audio.addEventListener('timeupdate', function () {
                            const progress = (audio.currentTime / audio.duration) * 100;
                            updateProgress(callId, progress, audio.currentTime, audio.duration);
                        });

                        // 播放结束
                        audio.addEventListener('ended', function () {
                            currentAudio = null;
                            currentCallId = null;
                            updatePlayUI(callId, 'stopped');
                        });

                        // 开始播放
                        audio.play().catch(err => {
                            console.error('[Mobile] 播放失败:', err);
                            alert('音频播放失败: ' + err.message);
                            currentAudio = null;
                            currentCallId = null;
                            updatePlayUI(callId, 'stopped');
                        });
                    });

                    // 更新播放UI
                    function updatePlayUI(callId, status, duration = 0) {
                        const $item = $content.find(`.call-history-item[data-call-id="${callId}"]`);
                        const $playArea = $item.find('.play-area');

                        if (status === 'loading') {
                            $playArea.html(`
                                <div style="text-align:center; padding:10px; color:#666;">
                                    <div style="font-size:14px;">⏳ 加载中...</div>
                                </div>
                            `);
                        } else if (status === 'playing') {
                            const durationText = formatTime(duration);
                            $playArea.html(`
                                <div style="padding:10px; background:#f9fafb; border-radius:8px;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                        <span style="font-size:13px; color:#666;">🎵 播放中</span>
                                        <button class="stop-btn" style="background:#ef4444; color:white; border:none; border-radius:6px; padding:4px 12px; font-size:12px; cursor:pointer;">⏹ 停止</button>
                                    </div>
                                    <div style="background:#e5e7eb; height:4px; border-radius:2px; overflow:hidden; margin-bottom:5px;">
                                        <div class="progress-bar" style="background:#3b82f6; height:100%; width:0%; transition:width 0.1s;"></div>
                                    </div>
                                    <div style="display:flex; justify-content:space-between; font-size:11px; color:#999;">
                                        <span class="current-time">0:00</span>
                                        <span class="total-time">${durationText}</span>
                                    </div>
                                </div>
                            `);

                            // 绑定停止按钮
                            $playArea.find('.stop-btn').click(function (e) {
                                e.stopPropagation();
                                if (currentAudio) {
                                    currentAudio.pause();
                                    currentAudio = null;
                                    currentCallId = null;
                                    updatePlayUI(callId, 'stopped');
                                }
                            });
                        } else if (status === 'stopped') {
                            $playArea.html(`
                                <div style="display:flex; align-items:center; gap:10px; padding:8px; background:#f9fafb; border-radius:8px;">
                                    <span style="font-size:20px;">🎵</span>
                                    <span style="flex:1; font-size:13px; color:#666;">点击播放</span>
                                    <span style="font-size:12px; color:#999;">→</span>
                                </div>
                            `);
                        }
                    }

                    // 更新进度
                    function updateProgress(callId, progress, currentTime, duration) {
                        const $item = $content.find(`.call-history-item[data-call-id="${callId}"]`);
                        $item.find('.progress-bar').css('width', progress + '%');
                        $item.find('.current-time').text(formatTime(currentTime));
                    }

                    // 格式化时间
                    function formatTime(seconds) {
                        if (!seconds || isNaN(seconds)) return '0:00';
                        const mins = Math.floor(seconds / 60);
                        const secs = Math.floor(seconds % 60);
                        return `${mins}:${secs.toString().padStart(2, '0')}`;
                    }

                    // 悬停效果
                    $content.find('.call-history-item').hover(
                        function () { $(this).css('box-shadow', '0 4px 12px rgba(0,0,0,0.1)'); },
                        function () { $(this).css('box-shadow', 'none'); }
                    );

                } catch (error) {
                    console.error('[Mobile] 获取历史记录失败:', error);
                    $content.html(`
                        <div style="text-align:center; padding:40px 20px; color:#ef4444;">
                            <div style="font-size:24px; margin-bottom:10px;">❌</div>
                            <div>加载失败: ${error.message}</div>
                        </div>
                    `);
                }
            }
        },
        'settings': {
            name: '系统设置',
            icon: '⚙️',
            bg: '#333',
            render: async (container) => {
                container.html(`
                    <div style="display:flex; flex-direction:column; height:100%; align-items:center; justify-content:center; color:#888;">
                        <div style="font-size:24px; margin-bottom:10px;">⚙️</div>
                        <div>正在同步配置...</div>
                    </div>
                `);

                // === 调试日志开始 ===
                console.log("[Mobile Settings] 开始渲染设置页面");
                console.log("[Mobile Settings] window.TTS_UI 存在?", !!window.TTS_UI);
                console.log("[Mobile Settings] window.TTS_UI.Templates 存在?", !!(window.TTS_UI && window.TTS_UI.Templates));
                console.log("[Mobile Settings] window.TTS_UI.CTX 存在?", !!(window.TTS_UI && window.TTS_UI.CTX));

                if (window.TTS_UI) {
                    console.log("[Mobile Settings] window.TTS_UI 内容:", window.TTS_UI);
                    if (window.TTS_UI.CTX) {
                        console.log("[Mobile Settings] window.TTS_UI.CTX 内容:", window.TTS_UI.CTX);
                        console.log("[Mobile Settings] window.TTS_UI.CTX.CACHE 存在?", !!window.TTS_UI.CTX.CACHE);
                    }
                }
                // === 调试日志结束 ===

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

                // 安全检查: 确保 CACHE 已初始化
                if (!CTX.CACHE) {
                    container.html('<div style="padding:20px; text-align:center;">⚠️ 数据缓存未初始化</div>');
                    return;
                }

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
                    console.warn("获取角色名失败", e);
                }

                console.log("🔍 [手机收藏] 正在查询角色:", charName || "所有角色");

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
                            let contextHtml = '';
                            if (item.context && item.context.length) {
                                contextHtml = `<div class="fav-context-box" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    📝 ${item.context[item.context.length - 1]}
                                </div>`;
                            }


                            let fullUrl = item.audio_url;

                            if (fullUrl && fullUrl.startsWith('/favorites/')) {
                                const filename = fullUrl.replace('/favorites/', '');
                                fullUrl = window.TTS_API.baseUrl + `/download_favorite/${filename}`;
                            } else if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
                                fullUrl = window.TTS_API.baseUrl + fullUrl;
                            }
                            const cleanText = item.text || "";
                            const d = Math.max(1, Math.ceil(cleanText.length * 0.25));
                            const bubbleWidth = Math.min(220, 60 + d * 10);

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

                    $content.html(renderList(data.current, "当前对话没有收藏记录<br>试着去其他收藏里找找吧"));

                    $tabs.find('.fav-tab').click(function () {
                        const $t = $(this);
                        $tabs.find('.fav-tab').removeClass('active');
                        $t.addClass('active');

                        const tabType = $t.data('tab');
                        if (tabType === 'current') {
                            $content.html(renderList(data.current, "当前对话没有收藏记录"));
                        } else {
                            $content.html(renderList(data.others, "暂无其他收藏"));
                        }
                        bindListEvents();
                    });

                    function bindListEvents() {
                        let currentAudio = null;
                        let $currentBubble = null;

                        $content.find('.fav-play-bubble').off().click(async function (e) {
                            e.stopPropagation();
                            const $bubble = $(this);
                            let url = $bubble.data('url');


                            if ($bubble.hasClass('playing') && currentAudio) {
                                currentAudio.pause();
                                resetBubble($bubble);
                                currentAudio = null;
                                return;
                            }

                            if (currentAudio) {
                                currentAudio.pause();
                                if ($currentBubble) resetBubble($currentBubble);
                            }


                            if (!url.startsWith('blob:')) {
                                try {
                                    console.log("🔄 转换服务器路径为 Blob URL:", url);
                                    const response = await fetch(url);
                                    if (!response.ok) throw new Error('获取音频失败');
                                    const blob = await response.blob();
                                    const blobUrl = URL.createObjectURL(blob);

                                    $bubble.attr('data-audio-url', blobUrl);
                                    url = blobUrl;
                                    console.log("✅ Blob URL 已缓存", blobUrl);
                                } catch (err) {
                                    console.error("转换 Blob URL 失败:", err);
                                    alert("音频加载失败,请重试");
                                    return;
                                }
                            }

                            console.log("▶️ 气泡播放:", url);


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
                                $b.removeClass('playing').addClass('ready');
                                $b.attr('data-status', 'ready');
                            }
                        });

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

                        $content.find('.fav-download-btn').off().click(async function (e) {
                            e.stopPropagation();
                            const $item = $(this).closest('.fav-item');
                            const $bubble = $item.find('.fav-play-bubble');

                            const audioUrl = $bubble.data('url');
                            const speaker = $bubble.data('voice-name') || 'Unknown';
                            const text = $bubble.data('text') || $item.find('.fav-text-content').text().replace(/^\"|\"$/g, '').trim();

                            console.log("📥 下载收藏音频");
                            console.log("  - audioUrl:", audioUrl);
                            console.log("  - speaker:", speaker);
                            console.log("  - text:", text);


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

                            if (window.TTS_Events && window.TTS_Events.downloadAudio) {
                                await window.TTS_Events.downloadAudio(finalUrl, speaker, text);
                            } else {
                                alert("下载功能未就绪,请刷新页面");
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
        'llm_test': {
            name: 'LLM测试',
            icon: '🤖',
            bg: '#8b5cf6',
            render: async (container) => {
                container.empty();
                container.append(createNavbar("LLM连接测试"));

                // 从配置文件读取默认值
                let defaultConfig = {
                    api_url: 'http://127.0.0.1:7861/v1',
                    api_key: 'pwd',
                    model: 'gemini-2.5-flash',
                    temperature: 0.8,
                    max_tokens: 500
                };

                try {
                    // 从后端API加载配置
                    const settingsRes = await fetch('/api/settings');
                    if (settingsRes.ok) {
                        const settings = await settingsRes.json();
                        console.log('[LLM测试] 加载的配置', settings);

                        if (settings.phone_call && settings.phone_call.llm) {
                            const llmConfig = settings.phone_call.llm;
                            defaultConfig = {
                                api_url: llmConfig.api_url || defaultConfig.api_url,
                                api_key: llmConfig.api_key || defaultConfig.api_key,
                                model: llmConfig.model || defaultConfig.model,
                                temperature: llmConfig.temperature !== undefined ? llmConfig.temperature : defaultConfig.temperature,
                                max_tokens: llmConfig.max_tokens || defaultConfig.max_tokens
                            };
                            console.log('[LLM测试] 成功加载配置');
                        }
                    } else {
                        console.warn('[LLM测试] 配置API返回错误:', settingsRes.status);
                    }
                } catch (e) {
                    console.warn('[LLM测试] 无法加载配置,使用默认值', e.message);
                }

                const $content = $(`
                    <div style="padding:15px; flex:1; overflow-y:auto; background:#f2f2f7;">
                        <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                            <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">📡 API配置</h3>
                            
                            <div style="margin-bottom:12px;">
                                <label style="display:block; margin-bottom:5px; font-size:13px; color:#666;">API地址</label>
                                <input type="text" id="llm-api-url" value="${defaultConfig.api_url}" 
                                    style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:14px;">
                            </div>
                            
                            <div style="margin-bottom:12px;">
                                <label style="display:block; margin-bottom:5px; font-size:13px; color:#666;">API密钥</label>
                                <input type="password" id="llm-api-key" value="${defaultConfig.api_key}" 
                                    style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:14px;">
                            </div>
                            
                            <div style="margin-bottom:12px;">
                                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
                                    <label style="font-size:13px; color:#666;">模型名称</label>
                                    <button id="llm-fetch-models" style="padding:4px 10px; background:#8b5cf6; color:#fff; border:none; border-radius:6px; font-size:12px; cursor:pointer;">
                                        🔄 获取模型列表
                                    </button>
                                </div>
                                <select id="llm-model" 
                                    style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:14px; background:#fff;">
                                    <option value="${defaultConfig.model}">${defaultConfig.model}</option>
                                </select>
                            </div>
                            
                            <div style="display:flex; gap:10px; margin-bottom:12px;">
                                <div style="flex:1;">
                                    <label style="display:block; margin-bottom:5px; font-size:13px; color:#666;">温度</label>
                                    <input type="number" id="llm-temperature" value="${defaultConfig.temperature}" 
                                        step="0.1" min="0" max="2"
                                        style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:14px;">
                                </div>
                                <div style="flex:1;">
                                    <label style="display:block; margin-bottom:5px; font-size:13px; color:#666;">最大Token</label>
                                    <input type="number" id="llm-max-tokens" value="${defaultConfig.max_tokens}" 
                                        style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:14px;">
                                </div>
                            </div>
                        </div>
                        
                        <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                            <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">💬 测试提示词</h3>
                            <textarea id="llm-test-prompt" 
                                style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:14px; min-height:80px; resize:vertical;"
                                placeholder="输入测试提示词...">你好,请回复'测试成功'</textarea>
                        </div>
                        
                        <button id="llm-test-btn" 
                            style="width:100%; padding:15px; background:#8b5cf6; color:#fff; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer; margin-bottom:15px;">
                            🚀 开始测试
                        </button>
                        
                        <div id="llm-test-result" style="display:none; background:#fff; border-radius:12px; padding:15px;">
                            <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">📊 测试结果</h3>
                            <div id="llm-result-content"></div>
                        </div>
                    </div>
                `);

                container.append($content);


                // 使用事件委托确保元素存在
                $content.on('click', '#llm-fetch-models', async function () {
                    const $btn = $(this);
                    const $select = $('#llm-model');
                    const apiUrl = $('#llm-api-url').val().trim();
                    const apiKey = $('#llm-api-key').val().trim();

                    if (!apiUrl || !apiKey) {
                        alert('请先填写API地址和密钥');
                        return;
                    }

                    $btn.prop('disabled', true).text('获取中...');

                    try {
                        console.log('[LLM测试] 开始获取模型列表...');
                        const models = await window.LLM_Client.fetchModels(apiUrl, apiKey);
                        console.log('[LLM测试] 成功获取模型:', models);

                        const currentValue = $select.val();
                        $select.empty();
                        models.forEach(model => {
                            $select.append(`<option value="${model}">${model}</option>`);
                        });

                        if (models.includes(currentValue)) {
                            $select.val(currentValue);
                        }

                        alert(`成功获取 ${models.length} 个模型`);
                    } catch (error) {
                        console.error('[LLM测试] 获取模型失败:', error);
                        alert(`获取模型失败: ${error.message}`);
                    } finally {
                        $btn.prop('disabled', false).text('🔄 获取模型列表');
                    }
                });

                $content.on('click', '#llm-test-btn', async function () {
                    const $btn = $(this);
                    const $result = $('#llm-test-result');
                    const $resultContent = $('#llm-result-content');

                    const config = {
                        api_url: $('#llm-api-url').val().trim(),
                        api_key: $('#llm-api-key').val().trim(),
                        model: $('#llm-model').val().trim(),
                        temperature: parseFloat($('#llm-temperature').val()),
                        max_tokens: parseInt($('#llm-max-tokens').val()),
                        prompt: $('#llm-test-prompt').val().trim()
                    };

                    if (!config.api_url || !config.api_key || !config.model) {
                        alert('请填写完整的API配置');
                        return;
                    }

                    $btn.prop('disabled', true).text('测试中...');
                    $result.show();
                    $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在连接LLM...</div>');

                    try {
                        console.log('[LLM测试] 开始调用LLM...', config);
                        const content = await window.LLM_Client.callLLM(config);
                        console.log('[LLM测试] LLM响应成功:', content);

                        // 显示成功结果
                        $resultContent.html(`
                            <div style="padding:15px; background:#d1fae5; border-radius:8px; margin-bottom:10px;">
                                <div style="font-size:18px; margin-bottom:5px;">✅ 连接成功</div>
                                <div style="font-size:13px; color:#065f46;">LLM响应正常</div>
                            </div>
                            
                            <div style="margin-bottom:10px;">
                                <strong style="color:#666; font-size:13px;">📤 测试提示词</strong>
                                <div style="background:#f9fafb; padding:10px; border-radius:6px; margin-top:5px; font-size:13px; color:#333;">
                                    ${config.prompt}
                                </div>
                            </div>
                            
                            <div style="margin-bottom:10px;">
                                <strong style="color:#666; font-size:13px;">📥 LLM响应 (${content.length}字符):</strong>
                                <div style="background:#f9fafb; padding:10px; border-radius:6px; margin-top:5px; font-size:13px; color:#333; max-height:200px; overflow-y:auto;">
                                    ${content}
                                </div>
                            </div>
                            
                            <div style="font-size:12px; color:#999; padding:10px; background:#f9fafb; border-radius:6px;">
                                <div>🔧 模型: ${config.model}</div>
                                <div>🌡️ 温度: ${config.temperature}</div>
                                <div>📊 最大Token: ${config.max_tokens}</div>
                                <div>🌐 API: ${config.api_url}</div>
                            </div>
                        `);

                    } catch (error) {
                        console.error('[LLM测试] 失败:', error);

                        $resultContent.html(`
                            <div style="padding:15px; background:#fee2e2; border-radius:8px; margin-bottom:10px;">
                                <div style="font-size:18px; margin-bottom:5px;">❌ 连接失败</div>
                                <div style="font-size:13px; color:#991b1b;">${error.message}</div>
                            </div>
                            
                            <div style="background:#f9fafb; padding:10px; border-radius:6px; font-size:12px; color:#666;">
                                <strong>错误详情:</strong><br>
                                ${error.message}
                            </div>
                            
                            <div style="margin-top:10px; padding:10px; background:#fef3c7; border-radius:6px; font-size:12px; color:#92400e;">
                                💡 <strong>排查建议:</strong><br>
                                1. 检查API地址是否正确 (当前: ${config.api_url})<br>
                                2. 确认API密钥有效<br>
                                3. 验证模型名称是否存在 (当前: ${config.model})<br>
                                4. 打开浏览器控制台查看详细日志<br>
                                5. 检查是否有CORS跨域问题
                            </div>
                        `);
                    } finally {
                        $btn.prop('disabled', false).text('🚀 开始测试');
                    }
                });
            }
        },
        'phone_call': {
            name: '主动电话',
            icon: '📞',
            bg: '#10b981',
            render: async (container) => {
                container.empty();
                container.append(createNavbar("主动电话测试"));

                const $content = $(`
                    <div style="padding:15px; flex:1; overflow-y:auto; background:#f2f2f7;">
                        <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                            <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">📋 测试说明</h3>
                            <div style="font-size:13px; color:#666; line-height:1.6;">
                                这是一个简单的主动电话功能测试界面。<br>
                                点击"生成电话"按钮,系统将:<br>
                                1. 读取当前对话上下文<br>
                                2. 调用LLM生成电话内容<br>
                                3. 生成带情绪的TTS音频<br>
                                4. 返回完整的音频文件
                            </div>
                        </div>

                        <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                            <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">🎭 当前角色</h3>
                            <div id="phone-char-name" style="font-size:14px; color:#666; padding:10px; background:#f9fafb; border-radius:8px;">
                                正在获取...
                            </div>
                        </div>

                        <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                            <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">💬 对话上下文</h3>
                            <div id="phone-context-info" style="font-size:13px; color:#666; padding:10px; background:#f9fafb; border-radius:8px;">
                                正在获取...
                            </div>
                        </div>

                        <button id="phone-generate-btn" 
                            style="width:100%; padding:15px; background:#10b981; color:#fff; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer; margin-bottom:15px;">
                            📞 生成主动电话
                        </button>

                        <div id="phone-result" style="display:none; background:#fff; border-radius:12px; padding:15px;">
                            <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">📊 生成结果</h3>
                            <div id="phone-result-content"></div>
                        </div>
                    </div>
                `);

                container.append($content);


                // 获取当前角色信息
                let charName = "";
                let context = [];

                try {
                    console.log('[主动电话] 开始获取角色和上下文...');

                    if (window.SillyTavern && window.SillyTavern.getContext) {
                        const ctx = window.SillyTavern.getContext();
                        console.log('[主动电话] SillyTavern上下文', ctx);

                        // 获取角色名
                        if (ctx.characters && ctx.characterId !== undefined) {
                            const charObj = ctx.characters[ctx.characterId];
                            if (charObj && charObj.name) {
                                charName = charObj.name;
                                $('#phone-char-name').html(`<strong>${charName}</strong>`);
                                console.log('[主动电话] 角色名', charName);
                            }
                        }

                        // 获取对话上下文
                        if (ctx.chat && Array.isArray(ctx.chat)) {
                            context = ctx.chat.map(msg => ({
                                role: msg.is_user ? "user" : "assistant",
                                content: msg.mes || ""
                            }));

                            $('#phone-context-info').html(`
                                共 <strong>${context.length}</strong> 条消息<br>
                                <span style="font-size:12px; color:#999;">最近10条将用于生成</span>
                            `);
                            console.log('[主动电话] 上下文消息数:', context.length);
                        }
                    } else {
                        console.warn('[主动电话] window.SillyTavern 未就绪');
                    }
                } catch (e) {
                    console.error("获取上下文失败", e);
                    $('#phone-char-name').html('<span style="color:#dc2626;">❌ 获取失败</span>');
                    $('#phone-context-info').html('<span style="color:#dc2626;">❌ 获取失败</span>');
                }


                // 生成按钮点击事件
                $content.on('click', '#phone-generate-btn', async function () {
                    const $btn = $(this);
                    const $result = $('#phone-result');
                    const $resultContent = $('#phone-result-content');

                    if (!charName) {
                        alert('未检测到角色,请先打开一个对话');
                        return;
                    }

                    if (context.length === 0) {
                        alert('对话上下文为空,请先进行一些对话');
                        return;
                    }

                    $btn.prop('disabled', true).text('生成中...');
                    $result.show();
                    $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在生成主动电话内容...</div>');

                    try {
                        console.log('[主动电话] 开始生成...', { charName, contextLength: context.length });

                        // 全新流程: 三步走
                        // 步骤1: 调用后端构建提示词
                        const apiBaseUrl = `${window.location.protocol}//${window.location.hostname}:3000`;
                        const buildPromptUrl = `${apiBaseUrl}/api/phone_call/build_prompt`;

                        console.log('[主动电话] 步骤1: 构建提示词...', buildPromptUrl);
                        $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在构建提示词...</div>');

                        const buildResponse = await fetch(buildPromptUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                char_name: charName,
                                context: context
                            })
                        });

                        if (!buildResponse.ok) {
                            const errorText = await buildResponse.text();
                            throw new Error(`构建提示词失败(${buildResponse.status}): ${errorText}`);
                        }

                        const buildResult = await buildResponse.json();
                        console.log('[主动电话] ✅ 提示词构建完成', buildResult);

                        // 步骤2: 使用LLM_Client直接调用外部LLM (就像LLM测试那样)
                        console.log('[主动电话] 步骤2: 调用LLM...');
                        $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在调用LLM生成内容...</div>');

                        const llmConfig = {
                            api_url: buildResult.llm_config.api_url,
                            api_key: buildResult.llm_config.api_key,
                            model: buildResult.llm_config.model,
                            temperature: buildResult.llm_config.temperature,
                            max_tokens: buildResult.llm_config.max_tokens,
                            prompt: buildResult.prompt
                        };
                        const llmResponse = await window.LLM_Client.callLLM(llmConfig);
                        $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在解析LLM响应...</div>');
                        const parseUrl = `${apiBaseUrl}/api/phone_call/parse_and_generate`;
                        const parseResponse = await fetch(parseUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                char_name: charName,
                                llm_response: llmResponse,
                                generate_audio: true
                            })
                        });

                        if (!parseResponse.ok) {
                            const errorText = await parseResponse.text();
                            throw new Error(`解析响应失败 (${parseResponse.status}): ${errorText}`);
                        }

                        const result = await parseResponse.json();
                        if (result.status !== 'success') {
                            throw new Error(result.message || '生成失败');
                        }

                        let html = `
                            <div style="padding:15px; background:#d1fae5; border-radius:8px; margin-bottom:15px;">
                                <div style="font-size:18px; margin-bottom:5px;">✅ 生成成功</div>
                                <div style="font-size:13px; color:#065f46;">共 ${result.total_segments} 个情绪片段</div>
                            </div>
                        `;

                        if (result.segments && result.segments.length > 0) {
                            html += '<div style="margin-bottom:15px;"><strong style="color:#666; font-size:13px;">📝 生成的内容</strong></div>';

                            result.segments.forEach((seg, i) => {
                                html += `
                                    <div style="background:#f9fafb; padding:12px; border-radius:8px; margin-bottom:10px; border-left:3px solid #10b981;">
                                        <div style="font-size:12px; color:#10b981; margin-bottom:5px;">
                                            <strong>片段 ${i + 1}</strong> · 情绪: ${seg.emotion}
                                        </div>
                                        <div style="font-size:14px; color:#333;">
                                            "${seg.text}"
                                        </div>
                                    </div>
                                `;
                            });
                        }

                        if (result.audio) {
                            const binaryString = atob(result.audio);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }

                            const audioBlob = new Blob([bytes], { type: 'audio/wav' });
                            const audioUrl = URL.createObjectURL(audioBlob);

                            html += `
                                <div style="margin-top:15px; padding:15px; background:#f0f9ff; border-radius:8px;">
                                    <div style="font-size:13px; color:#0369a1; margin-bottom:10px;">
                                        🎵 <strong>合成音频</strong>
                                    </div>
                                    <audio controls style="width:100%; margin-bottom:10px;" src="${audioUrl}"></audio>
                                    <button class="phone-download-audio" data-url="${audioUrl}" data-charname="${charName}"
                                        style="width:100%; padding:10px; background:#0ea5e9; color:#fff; border:none; border-radius:8px; cursor:pointer;">
                                        ⬇️ 下载音频
                                    </button>
                                </div>
                            `;
                        }

                        $resultContent.html(html);

                        $('.phone-download-audio').click(function () {
                            const url = $(this).data('url');
                            const charname = $(this).data('charname');
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${charname}_主动电话_${new Date().getTime()}.wav`;
                            a.click();
                        });

                    } catch (error) {
                        console.error('[主动电话] 生成失败:', error);

                        $resultContent.html(`
                            <div style="padding:15px; background:#fee2e2; border-radius:8px; margin-bottom:10px;">
                                <div style="font-size:18px; margin-bottom:5px;">❌ 生成失败</div>
                                <div style="font-size:13px; color:#991b1b;">${error.message}</div>
                            </div>
                            
                            <div style="background:#f9fafb; padding:10px; border-radius:6px; font-size:12px; color:#666;">
                                <strong>错误详情:</strong><br>
                                ${error.message}
                            </div>
                            
                            <div style="margin-top:10px; padding:10px; background:#fef3c7; border-radius:6px; font-size:12px; color:#92400e;">
                                💡 <strong>排查建议:</strong><br>
                                1. 检查LLM配置是否正确<br>
                                2. 确认角色有可用的参考音频<br>
                                3. 查看浏览器控制台的详细日志<br>
                                4. 检查后端服务是否正常运行
                        `);
                    } finally {
                        $btn.prop('disabled', false).text('📞 生成主动电话');
                    }
                });
            }
        }
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

        let isDragging = false;
        let hasMoved = false;

        let startX, startY;
        let shiftX, shiftY;
        let winW, winH;

        const DRAG_THRESHOLD = 10;


        $trigger.on('mousedown touchstart', function (e) {
            if (e.type === 'touchstart' && e.touches.length > 1) return;

            if (e.cancelable) e.preventDefault();

            const point = e.type === 'touchstart' ? e.touches[0] : e;
            const rect = $trigger[0].getBoundingClientRect();

            // 记录初始状态
            startX = point.clientX;
            startY = point.clientY;

            // 计算手指在小球内的偏移量，保证拖拽时不跳动
            shiftX = startX - rect.left;
            shiftY = startY - rect.top;

            winW = $(window).width();
            winH = $(window).height();

            isDragging = true;
            hasMoved = false;


            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchend', onUp);
        });

        function onMove(e) {
            if (!isDragging) return;
            if (e.cancelable) e.preventDefault();

            const point = e.type === 'touchmove' ? e.touches[0] : e;
            const currentX = point.clientX;
            const currentY = point.clientY;

            // 🔥 [核心逻辑] 计算移动距离
            // 如果还未标记为“移动中”，先计算距离是否超过阈值
            if (!hasMoved) {
                const moveDis = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));

                if (moveDis < DRAG_THRESHOLD) {
                    return;
                }

                hasMoved = true;


                const rect = $trigger[0].getBoundingClientRect();
                $trigger.css({
                    position: 'fixed',
                    right: 'auto',
                    bottom: 'auto',
                    transform: 'none'
                });
            }



            let newLeft = currentX - shiftX;
            let newTop = currentY - shiftY;


            newLeft = Math.max(0, Math.min(winW - 60, newLeft));
            newTop = Math.max(0, Math.min(winH - 60, newTop));

            $trigger.css({
                left: newLeft + 'px',
                top: newTop + 'px'
            });
        }

        function onUp(e) {
            isDragging = false;


            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchend', onUp);

            // 🔥 判决时刻:
            // 如果 hasMoved 依然是false，说明手指移动没超过 10px
            // 这就是一次完美的“点击”！
            if (!hasMoved) {
                togglePhone();
            } else {
                // 如果是拖拽结束，可以加个吸附效果（可选）
                snapToEdge();
            }
        }

        function snapToEdge() {
            const rect = $trigger[0].getBoundingClientRect();
            const midX = winW / 2;
            const targetLeft = (rect.left + 30 < midX) ? 10 : (winW - 70);

            $trigger.animate({ left: targetLeft }, 200);
        }

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
        // 优先检查是否有来电
        if (window.TTS_IncomingCall) {
            console.log('[Mobile] 检测到来电,打开小手机并显示来电界面');
            // 移除震动效果
            $('#tts-mobile-trigger').removeClass('incoming-call');
            $('#tts-manager-btn').removeClass('incoming-call');

            // 打开小手机
            if (!STATE.isOpen) {
                openPhone();
            }

            // 打开来电应用
            scope.openApp('incoming_call');
            return;
        }

        // 正常的打开/关闭手机逻辑
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
