// static/js/events.js
(function () {
    // 模块内部变量，不再污染全局 window
    let currentAudio = null;

    window.TTS_Events = {
        init() {
            this.bindClickEvents();
            this.bindMessageEvents();
            console.log("✅ [Events] 事件监听器已加载");
        },

        // --- 统一播放控制器 ---
        playAudio(key, audioUrl) {
            // 1. 停止当前正在播放的
            if (currentAudio) {
                currentAudio.pause();
                currentAudio = null;
            }

            // 2. 暴力重置所有动画 UI
            const resetAnim = () => {
                $('.voice-bubble').removeClass('playing');
                $('iframe').each(function() {
                    try { $(this).contents().find('.voice-bubble').removeClass('playing'); } catch(e){}
                });
            };
            resetAnim();

            // 3. 播放新音频
            if (!audioUrl) return;
            const audio = new Audio(audioUrl);
            currentAudio = audio;

            // 4. 定义动画同步函数
            const setAnim = (active) => {
                const func = active ? 'addClass' : 'removeClass';
                $(`.voice-bubble[data-key='${key}']`)[func]('playing');
                $('iframe').each(function(){
                    try { $(this).contents().find(`.voice-bubble[data-key='${key}']`)[func]('playing'); } catch(e){}
                });
            };

            setAnim(true); // 开始动画

            audio.onended = () => {
                currentAudio = null;
                setAnim(false); // 结束动画
            };

            // 错误处理
            audio.onerror = () => {
                console.error("音频播放出错");
                setAnim(false);
                currentAudio = null;
            };

            audio.play();
        },

        // --- 点击事件 ---
        bindClickEvents() {
            $(document).on('click', '.voice-bubble', (e) => {
                const $btn = $(e.currentTarget); // 使用 currentTarget 确保点到的是按钮本身
                const charName = $btn.data('voice-name');
                const CACHE = window.TTS_State.CACHE;
                const Scheduler = window.TTS_Scheduler;

                // 状态 A: 已生成，直接播放
                if ($btn.attr('data-status') === 'ready') {
                    const audioUrl = $btn.attr('data-audio-url') || $btn.data('audio-url');

                    if (!audioUrl) {
                        $btn.attr('data-status', 'error').removeClass('playing');
                        alert("音频丢失，请刷新页面或点击重试");
                        return;
                    }

                    // 获取 key (如果没有 data-key，尝试用 Scheduler 生成一个，兼容旧版)
                    const key = $btn.data('key') || Scheduler.getTaskKey(charName, $btn.data('text'));
                    this.playAudio(key, audioUrl);
                }
                // 状态 B: 未生成或失败，尝试生成
                else if ($btn.attr('data-status') === 'waiting' || $btn.attr('data-status') === 'error') {
                    if (CACHE.settings.enabled === false) {
                        alert('TTS 插件总开关已关闭，请在配置面板中开启。');
                        return;
                    }

                    if (!CACHE.mappings[charName]) {
                        // 调用 UI 模块显示面板
                        if(window.TTS_UI) {
                            window.TTS_UI.showDashboard();
                            $('#tts-new-char').val(charName);
                            $('#tts-new-model').focus();
                        }
                        alert(`⚠️ 角色 "${charName}" 尚未绑定 TTS 模型，已自动为您填入角色名。\n请在右侧选择模型并点击“绑定”！`);
                    } else {
                        $btn.removeClass('error');
                        $btn.data('auto-play-after-gen', true); // 标记生成后自动播放
                        Scheduler.addToQueue($btn);
                        Scheduler.run();
                    }
                }
            });
        },

        // --- 跨窗口消息监听 (Iframe -> Main) ---
        bindMessageEvents() {
            window.addEventListener('message', (event) => {
                if (!event.data || event.data.type !== 'play_tts') return;

                const { key, text, charName, emotion } = event.data;
                const CACHE = window.TTS_State.CACHE;
                const Scheduler = window.TTS_Scheduler;

                // 1. 检查绑定
                if (!CACHE.mappings[charName]) {
                    if(window.TTS_UI) {
                        window.TTS_UI.showDashboard();
                        $('#tts-new-char').val(charName);
                        $('#tts-new-model').focus();
                    }
                    // 稍微延迟一下 alert，避免阻塞 UI 渲染
                    setTimeout(() => {
                        alert(`⚠️ 角色 "${charName}" 尚未绑定 TTS 模型。\n已为您自动填好角色名，请在右侧选择模型并点击“绑定”！`);
                    }, 100);
                    return;
                }

                // 2. 无论是否缓存，先停止当前播放 (在 playAudio 内部处理，但这里为了逻辑清晰先处理缓存播放)
                if (CACHE.audioMemory[key]) {
                    this.playAudio(key, CACHE.audioMemory[key]);
                    return;
                }

                // 3. 准备生成
                if (CACHE.settings.enabled === false) { alert('TTS 插件已关闭'); return; }

                // 尝试定位真实 DOM 按钮
                let $realBtn = null;
                $('iframe').each(function() {
                    try {
                        const b = $(this).contents().find(`.voice-bubble[data-key='${key}']`);
                        if(b.length) $realBtn = b;
                    } catch(e){}
                });
                if(!$realBtn || !$realBtn.length) $realBtn = $(`.voice-bubble[data-key='${key}']`);

                // 4. 执行调度
                if ($realBtn && $realBtn.length) {
                    $realBtn.removeClass('error').attr('data-status', 'waiting');
                    Scheduler.addToQueue($realBtn);
                    Scheduler.run();
                } else {
                    console.warn("[TTS] 按钮DOM丢失，等待DOM刷新后重试...");
                    // 没找到 DOM 可能是页面还在渲染，延迟重试
                    setTimeout(() => { window.postMessage(event.data, '*'); }, 200);
                }
            });
        }
    };
})();
