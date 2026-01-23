// 文件: ui_main.js
console.log("🔵 [UI] TTS_UI.js (Refactored) 开始加载...");

if (!window.TTS_UI) {
    window.TTS_UI = {};
}

export const TTS_UI = window.TTS_UI;

(function (scope) {
    scope.CTX = {
        CACHE: null,
        API_URL: "",
        Utils: null,
        Callbacks: {}
    };

    scope.init = function (context, renderButton = true) {
        // 更新内部引用
        scope.CTX = context;

        // 只有 renderButton 为 true 时才创建悬浮窗
        if (renderButton && $('#tts-manager-btn').length === 0) {
            console.log("[UI] UI模块挂载/重置");
            scope.initFloatingButton();
        }
        if ($('#tts-bubble-menu').length === 0) {
            $('body').append(window.TTS_UI.Templates.getBubbleMenuHTML());
        }
    };

    scope.initFloatingButton = function () {
        if ($('#tts-manager-btn').length > 0) return;

        $('body').append(window.TTS_UI.Templates.getFloatingButtonHTML());

        // 修改点击事件:优先检查来电
        const handleClick = function () {
            // 检查是否有来电
            if (window.TTS_IncomingCall) {
                console.log('[UI] 检测到来电,显示来电界面');
                scope.showIncomingCallUI();
            } else {
                scope.showDashboard();
            }
        };

        if (scope.CTX.Utils && scope.CTX.Utils.makeDraggable) {
            scope.CTX.Utils.makeDraggable($('#tts-manager-btn'), handleClick);
        } else {
            $('#tts-manager-btn').click(handleClick);
        }
    };

    scope.showDashboard = function () {
        // 清理旧面板
        $('#tts-dashboard-overlay').remove();

        const settings = scope.CTX.CACHE.settings || {};
        const savedConfig = localStorage.getItem('tts_plugin_remote_config');
        const config = savedConfig ? JSON.parse(savedConfig) : { useRemote: false, ip: "" };

        const templateData = {
            isEnabled: settings.enabled !== false,
            settings: settings,
            isRemote: config.useRemote,
            remoteIP: config.ip,
            currentBase: settings.base_dir || "",
            currentCache: settings.cache_dir || "",
            currentLang: settings.default_lang || "default"
        };

        const html = window.TTS_UI.Templates.getDashboardHTML(templateData);
        $('body').append(html);

        scope.renderDashboardList();
        scope.renderModelOptions();
        scope.bindDashboardEvents();
    };

    scope.showIncomingCallUI = function () {
        const callData = window.TTS_IncomingCall;
        if (!callData) return;

        // 移除震动效果 (同时支持桌面版和移动版)
        $('#tts-manager-btn').removeClass('incoming-call');
        $('#tts-mobile-trigger').removeClass('incoming-call');

        // 如果移动端界面可用,使用移动端来电界面
        if (window.TTS_Mobile && window.TTS_Mobile.openApp) {
            console.log('[UI] 使用移动端来电界面');
            // 打开小手机(如果未打开)
            const $mobileRoot = $('#tts-mobile-root');
            if ($mobileRoot.length > 0 && $mobileRoot.hasClass('minimized')) {
                $mobileRoot.removeClass('minimized');
                $('#tts-mobile-trigger').fadeOut();
            }
            // 打开来电应用
            window.TTS_Mobile.openApp('incoming_call');
            return;
        }

        // 创建来电界面
        const $overlay = $(`
            <div class="tts-overlay" id="incoming-call-overlay" style="z-index: 20003;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                            border-radius: 30px; 
                            padding: 40px 30px; 
                            text-align: center; 
                            color: white; 
                            max-width: 350px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                    
                    <div style="font-size: 48px; margin-bottom: 20px;">📞</div>
                    <div style="font-size: 24px; font-weight: bold; margin-bottom: 10px;">${callData.char_name}</div>
                    <div style="font-size: 14px; opacity: 0.9; margin-bottom: 30px;">来电中...</div>
                    
                    <div style="display: flex; gap: 20px; justify-content: center; margin-top: 40px;">
                        <button id="reject-call-btn" style="
                            width: 70px; 
                            height: 70px; 
                            border-radius: 50%; 
                            border: none; 
                            background: #ef4444; 
                            color: white; 
                            font-size: 32px; 
                            cursor: pointer;
                            box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);
                            transition: all 0.2s;">
                            ✕
                        </button>
                        <button id="answer-call-btn" style="
                            width: 70px; 
                            height: 70px; 
                            border-radius: 50%; 
                            border: none; 
                            background: #10b981; 
                            color: white; 
                            font-size: 32px; 
                            cursor: pointer;
                            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
                            transition: all 0.2s;">
                            ✓
                        </button>
                    </div>
                </div>
            </div>
        `);

        $('body').append($overlay);

        // 按钮悬停效果
        $overlay.find('button').hover(
            function () { $(this).css('transform', 'scale(1.1)'); },
            function () { $(this).css('transform', 'scale(1)'); }
        );

        // 拒绝来电
        $overlay.find('#reject-call-btn').click(function () {
            console.log('[UI] 用户拒绝来电');
            $overlay.fadeOut(200, function () { $(this).remove(); });
            delete window.TTS_IncomingCall;
            $('#tts-manager-btn').attr('title', '🔊 TTS配置');
        });

        // 接听来电
        $overlay.find('#answer-call-btn').click(function () {
            console.log('[UI] 用户接听来电');
            $overlay.fadeOut(200, function () { $(this).remove(); });

            // 显示通话界面
            scope.showInCallUI(callData);
        });
    };

    scope.showInCallUI = function (callData) {
        // 创建通话界面
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

        const $callOverlay = $(`
            <div class="tts-overlay" id="in-call-overlay" style="z-index: 20003;">
                <div style="
                    background: #f5f5f7;
                    border-radius: 20px;
                    padding: 0;
                    max-width: 450px;
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    overflow: hidden;
                ">
                    <!-- 头部 -->
                    <div style="
                        background: white;
                        padding: 20px;
                        display: flex;
                        align-items: center;
                        gap: 15px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                    ">
                        <div style="
                            width: 50px;
                            height: 50px;
                            border-radius: 50%;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            color: white;
                            font-size: 24px;
                        ">📞</div>
                        <div style="flex: 1;">
                            <div style="font-size: 18px; font-weight: 600; color: #1d1d1f; margin-bottom: 4px;">${callData.char_name}</div>
                            <div id="call-duration" style="font-size: 14px; color: #86868b;">00:00</div>
                        </div>
                    </div>

                    <!-- 对话内容 -->
                    <div class="call-segments-container">
                        ${segmentsHTML}
                    </div>

                    <!-- 底部控制 -->
                    <div style="
                        background: white;
                        padding: 20px;
                        display: flex;
                        justify-content: center;
                    ">
                        <button id="hangup-btn" style="
                            width: 70px;
                            height: 70px;
                            border-radius: 50%;
                            border: none;
                            background: #ff3b30;
                            color: white;
                            font-size: 32px;
                            cursor: pointer;
                            box-shadow: 0 4px 15px rgba(255, 59, 48, 0.3);
                            transition: all 0.2s;
                        ">✕</button>
                    </div>

                    <!-- 隐藏的音频播放器 -->
                    <audio id="call-audio" style="display: none;"></audio>
                </div>
            </div>
        `);

        $('body').append($callOverlay);


        // 按钮悬停效果
        $callOverlay.find('#hangup-btn').hover(
            function () { $(this).css('transform', 'scale(1.1)'); },
            function () { $(this).css('transform', 'scale(1)'); }
        );

        // 挂断按钮
        $callOverlay.find('#hangup-btn').click(function () {
            console.log('[UI] 用户挂断电话');
            const audio = document.getElementById('call-audio');
            if (audio) audio.pause();
            $callOverlay.fadeOut(200, function () { $(this).remove(); });
            delete window.TTS_IncomingCall;
            $('#tts-manager-btn').attr('title', '🔊 TTS配置');
        });

        // 播放音频并实现音轨同步
        const audio = document.getElementById('call-audio');
        if (audio && callData.audio_url) {
            audio.src = callData.audio_url;

            // 音频播放监听 - 实现音轨同步高亮
            audio.addEventListener('timeupdate', function () {
                const currentTime = audio.currentTime;
                const $segments = $callOverlay.find('.call-segment');

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

                // 更新高亮状态 - 使用CSS类名
                $segments.each(function (index) {
                    const $seg = $(this);
                    if (index === activeIndex) {
                        $seg.addClass('active');
                        // 自动滚动
                        $seg[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        $seg.removeClass('active');
                    }
                });
            });

            // 通话时长计时
            let callStartTime = Date.now();
            const durationInterval = setInterval(function () {
                const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                $('#call-duration').text(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
            }, 1000);

            // 音频结束
            audio.onended = function () {
                console.log('[UI] 音频播放完成');
                clearInterval(durationInterval);
                setTimeout(function () {
                    $callOverlay.fadeOut(200, function () { $(this).remove(); });
                    delete window.TTS_IncomingCall;
                    $('#tts-manager-btn').attr('title', '🔊 TTS配置');
                }, 1000);
            };

            // 开始播放
            audio.play().catch(err => {
                console.error('[UI] 音频播放失败:', err);
                alert('音频播放失败,请检查 URL: ' + callData.audio_url);
            });
        } else {
            console.warn('[UI] 没有音频 URL');
        }
    };
    scope.handleUnbind = async function (c) {
        if (!confirm(`确定要解绑角色 "${c}" 吗？`)) return;

        try {
            await window.TTS_API.unbindCharacter(c);
            await scope.CTX.Callbacks.refreshData();
            scope.renderDashboardList();
            // 重置状态
            $(`.voice-bubble[data-voice-name="${c}"]`).attr('data-status', 'waiting').removeClass('error playing ready');
        } catch (e) {
            console.error(e);
            alert("解绑失败");
        }
    };

})(window.TTS_UI);
