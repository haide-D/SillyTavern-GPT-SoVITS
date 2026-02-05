// static/js/events.js
let currentAudio = null;

export const TTS_Events = {
    // 事件监听器存储
    _listeners: {},

    /**
     * 注册事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     */
    on(eventName, callback) {
        if (!this._listeners[eventName]) {
            this._listeners[eventName] = [];
        }
        this._listeners[eventName].push(callback);
        console.log(`[TTS_Events] ✅ 已注册事件监听: ${eventName}`);
    },

    /**
     * 移除事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     */
    off(eventName, callback) {
        if (!this._listeners[eventName]) return;

        const index = this._listeners[eventName].indexOf(callback);
        if (index > -1) {
            this._listeners[eventName].splice(index, 1);
            console.log(`[TTS_Events] ✅ 已移除事件监听: ${eventName}`);
        }
    },

    /**
     * 触发事件
     * @param {string} eventName - 事件名称
     * @param {*} data - 事件数据
     */
    emit(eventName, data) {
        if (!this._listeners[eventName]) return;

        console.log(`[TTS_Events] 📤 触发事件: ${eventName}`, data);
        this._listeners[eventName].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[TTS_Events] ❌ 事件回调执行失败 (${eventName}):`, error);
            }
        });
    },

    init() {
        this.bindClickEvents();
        this.bindMessageEvents();
        this.bindMenuEvents();
        console.log("✅[Events] 事件监听器已加载");
    },

    playAudio(key, audioUrl) {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }

        // 定义动画同步函数 (使用 filter 方法避免特殊字符导致选择器语法错误)
        const setAnim = (active) => {
            const func = active ? 'addClass' : 'removeClass';
            // 使用 filter + 属性比较，避免 key 中的特殊字符破坏选择器
            $('.voice-bubble').filter(function () {
                return $(this).attr('data-key') === key;
            })[func]('playing');
            $('iframe').each(function () {
                try {
                    $(this).contents().find('.voice-bubble').filter(function () {
                        return $(this).attr('data-key') === key;
                    })[func]('playing');
                } catch (e) { }
            });
        };

        if (!audioUrl) return;
        const audio = new Audio(audioUrl);
        currentAudio = audio;

        setAnim(true);

        audio.onended = () => {
            currentAudio = null;
            setAnim(false);
        };

        audio.onerror = () => {
            console.error("音频播放出错");
            setAnim(false);
            currentAudio = null;
        };

        audio.play();
    },

    handleContextMenu(e, $btn) {
        e.preventDefault();

        if ($btn.attr('data-status') !== 'ready') return;

        const $menu = $('#tts-bubble-menu');
        $menu.data('target', $btn);

        let clientX = e.clientX;
        let clientY = e.clientY;

        if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 0) {
            clientX = e.originalEvent.touches[0].clientX;
            clientY = e.originalEvent.touches[0].clientY;
        }

        let left = clientX + 10;
        let top = clientY + 10;
        if (left + 150 > $(window).width()) left = $(window).width() - 160;
        if (top + 160 > $(window).height()) top = $(window).height() - 170;

        $menu.css({ top: top + 'px', left: left + 'px' }).fadeIn(150);
    },

    bindClickEvents() {
        $(document).on('click', '.voice-bubble', (e) => {
            const $btn = $(e.currentTarget);
            const charName = $btn.data('voice-name');
            const CACHE = window.TTS_State.CACHE;
            const Scheduler = window.TTS_Scheduler;

            if ($btn.attr('data-status') === 'ready') {
                const audioUrl = $btn.attr('data-audio-url') || $btn.data('audio-url');

                if (!audioUrl) {
                    $btn.attr('data-status', 'error').removeClass('playing');
                    alert("音频加载失败,请刷新页面重试");
                    return;
                }

                if ($btn.hasClass('playing')) {
                    if (currentAudio) {
                        currentAudio.pause();
                        currentAudio = null;
                    }
                    $('.voice-bubble').removeClass('playing');
                    $('iframe').each(function () {
                        try { $(this).contents().find('.voice-bubble').removeClass('playing'); } catch (e) { }
                    });
                    return;
                }

                const key = $btn.data('key') || Scheduler.getTaskKey(charName, $btn.data('text'));
                $btn.attr('data-key', key);

                this.playAudio(key, audioUrl);
            }
            else if ($btn.attr('data-status') === 'waiting' || $btn.attr('data-status') === 'error') {
                if (CACHE.settings.enabled === false) {
                    alert('TTS 功能可能已关闭,请检查设置后重试');
                    return;
                }

                if (!CACHE.mappings[charName]) {
                    if (window.TTS_UI) {
                        // 修复竞态条件：先刷新数据，确保模型列表已加载，再弹出面板
                        const showPanelAndFill = () => {
                            window.TTS_UI.showDashboard();
                            $('#tts-new-char').val(charName);
                            $('#tts-new-model').focus();
                            setTimeout(() => {
                                alert(`⚠️ 角色 "${charName}" 尚未绑定 TTS 模型。\n已为您自动填好角色名，请在右侧选择模型并点击"绑定"！`);
                            }, 100);
                        };

                        if (window.TTS_UI.CTX && window.TTS_UI.CTX.Callbacks && window.TTS_UI.CTX.Callbacks.refreshData) {
                            // 先刷新数据，完成后再弹出面板（确保模型列表已加载）
                            window.TTS_UI.CTX.Callbacks.refreshData()
                                .then(showPanelAndFill)
                                .catch((err) => {
                                    console.warn('[TTS] 刷新数据失败，仍弹出面板:', err);
                                    showPanelAndFill(); // 即使失败也弹出面板
                                });
                        } else {
                            // 降级处理：直接弹出
                            showPanelAndFill();
                        }
                    }
                    return;
                }

                // 获取或生成 key
                const key = $btn.data('key') || Scheduler.getTaskKey(charName, $btn.data('text'));
                $btn.attr('data-key', key);

                // 无论是否缓存,先停止当前播放
                if (CACHE.audioMemory[key]) {
                    this.playAudio(key, CACHE.audioMemory[key]);
                    return;
                }

                // 准备生成
                if (CACHE.settings.enabled === false) { alert('TTS 插件已关闭'); return; }

                // 尝试定位真实 DOM 按钮 (使用 filter 方法避免特殊字符导致选择器语法错误)
                let $realBtn = null;
                $('iframe').each(function () {
                    try {
                        const b = $(this).contents().find('.voice-bubble').filter(function () {
                            return $(this).attr('data-key') === key;
                        });
                        if (b.length) $realBtn = b;
                    } catch (e) { }
                });
                if (!$realBtn || !$realBtn.length) {
                    $realBtn = $('.voice-bubble').filter(function () {
                        return $(this).attr('data-key') === key;
                    });
                }

                // 执行调度
                if ($realBtn && $realBtn.length) {
                    $realBtn.attr('data-key', key);
                    $realBtn.removeClass('error').attr('data-status', 'waiting');
                    Scheduler.addToQueue($realBtn);
                    Scheduler.run();
                } else {
                    $btn.removeClass('error');
                    $btn.data('auto-play-after-gen', true);
                    Scheduler.addToQueue($btn);
                    Scheduler.run();
                }
            }
        });

        $(document).on('contextmenu', '.voice-bubble', (e) => {
            this.handleContextMenu(e, $(e.currentTarget));
        });

        $(document).on('click', (e) => {
            if (!$(e.target).closest('#tts-bubble-menu').length) {
                $('#tts-bubble-menu').fadeOut(100);
            }
        });
    },

    bindMessageEvents() {
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.type !== 'play_tts') return;

            const { key, text, charName, emotion } = event.data;
            const CACHE = window.TTS_State.CACHE;
            const Scheduler = window.TTS_Scheduler;

            if (!CACHE.mappings[charName]) {
                if (window.TTS_UI) {
                    // 修复竞态条件：先刷新数据，确保模型列表已加载，再弹出面板
                    const showPanelAndFill = () => {
                        window.TTS_UI.showDashboard();
                        $('#tts-new-char').val(charName);
                        $('#tts-new-model').focus();
                        setTimeout(() => {
                            alert(`⚠ 角色 "${charName}" 尚未绑定 TTS 模型。\n请为该角色配置后重试,面板已自动打开,请选择模型并点击绑定。`);
                        }, 100);
                    };

                    if (window.TTS_UI.CTX && window.TTS_UI.CTX.Callbacks && window.TTS_UI.CTX.Callbacks.refreshData) {
                        // 先刷新数据，完成后再弹出面板（确保模型列表已加载）
                        window.TTS_UI.CTX.Callbacks.refreshData()
                            .then(showPanelAndFill)
                            .catch((err) => {
                                console.warn('[TTS] 刷新数据失败，仍弹出面板:', err);
                                showPanelAndFill(); // 即使失败也弹出面板
                            });
                    } else {
                        // 降级处理：直接弹出
                        showPanelAndFill();
                    }
                }
                return;
            }

            if (CACHE.audioMemory[key]) {
                this.playAudio(key, CACHE.audioMemory[key]);
                return;
            }

            if (CACHE.settings.enabled === false) { alert('TTS 功能已关闭'); return; }

            let $realBtn = null;
            $('iframe').each(function () {
                try {
                    const b = $(this).contents().find(`.voice-bubble[data-key='${key}']`);
                    if (b.length) $realBtn = b;
                } catch (e) { }
            });
            if (!$realBtn || !$realBtn.length) $realBtn = $(`.voice-bubble[data-key='${key}']`);

            if ($realBtn && $realBtn.length) {
                $realBtn.attr('data-key', key);
                $realBtn.removeClass('error').attr('data-status', 'waiting');
                Scheduler.addToQueue($realBtn);
                Scheduler.run();
            } else {
                console.warn("[TTS] 按钮DOM丢失,等待DOM刷新后重试...");
                setTimeout(() => { window.postMessage(event.data, '*'); }, 200);
            }
        });
    },

    async downloadAudio(audioUrl, speaker, text) {
        if (!audioUrl) {
            alert("无法下载:音频文件不存在");
            return;
        }

        const cleanText = text.substring(0, 50).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        const filename = `${speaker}:${cleanText}.wav`;

        try {
            // 🎯 统一下载逻辑:先 fetch 再下载,避免浏览器直接打开文件
            console.log('[Download] 开始下载:', audioUrl);

            const response = await fetch(audioUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(downloadUrl);
            }, 100);

            console.log('[Download] ✅ 下载成功:', filename);
            window.TTS_Utils.showNotification("✅ 下载成功: " + filename, "success");
        } catch (e) {
            console.error("[Download] ❌ 下载失败:", e);
            alert("❌下载失败: " + e.message);
        }
    },

    bindMenuEvents() {
        $(document).on('click', '#tts-action-download', async () => {
            const $btn = $('#tts-bubble-menu').data('target');
            $('#tts-bubble-menu').fadeOut(100);

            if (!$btn || !$btn.length) return;

            const audioUrl = $btn.attr('data-audio-url') || $btn.data('audio-url');
            const speaker = $btn.data('voice-name') || 'Unknown';
            const text = $btn.data('text') || '';

            await window.TTS_Events.downloadAudio(audioUrl, speaker, text);
        });

        $(document).on('click', '#tts-action-reroll', async () => {
            const $btn = $('#tts-bubble-menu').data('target');
            $('#tts-bubble-menu').fadeOut(100);

            if (!$btn || !$btn.length) return;

            const serverFilename = $btn.attr('data-server-filename');

            if (!serverFilename) {
                console.warn("未找到服务器文件名记录,跳过删除缓存,直接重新生成");
                resetAndRegen($btn);
                return;
            }

            if (!confirm("确定要清除缓存并重新生成吗?")) return;

            try {
                console.log(`准备删除服务器缓存: ${serverFilename}`);
                await window.TTS_API.deleteCache(serverFilename);
                console.log(`[Re-roll] 服务器缓存 ${serverFilename} 已删除`);
            } catch (e) {
                console.warn("删除服务器缓存失败,可能文件已不存在,继续执行重新生成", e);
            }

            $btn.removeAttr('data-server-filename');
            resetAndRegen($btn);
        });

        function resetAndRegen($btn) {
            const key = $btn.data('key');
            const CACHE = window.TTS_State.CACHE;
            const Scheduler = window.TTS_Scheduler;

            if (key && CACHE.audioMemory[key]) {
                URL.revokeObjectURL(CACHE.audioMemory[key]);
                delete CACHE.audioMemory[key];
            }

            if ($btn.hasClass('playing')) {
                if (window.TTS_Events.playAudio) window.TTS_Events.playAudio(null, null);
            }

            $btn.attr('data-status', 'waiting')
                .removeClass('ready error playing')
                .css('opacity', '0.6');

            Scheduler.addToQueue($btn);
            Scheduler.run();
        }


        $(document).on('click', '#tts-action-fav', async () => {
            const $btn = $('#tts-bubble-menu').data('target');
            $('#tts-bubble-menu').fadeOut(100);
            if (!$btn) return;

            const serverFilename = $btn.attr('data-server-filename');
            if (!serverFilename) {
                alert("无法收藏:未找到源文件(可能是旧缓存)");
                return;
            }

            const msgFingerprint = window.TTS_Utils.getEnhancedFingerprint($btn);
            const branchId = window.TTS_Utils.getCurrentChatBranch();

            let context = [];
            try {
                if (window.SillyTavern && window.SillyTavern.getContext) {
                    const stContext = window.SillyTavern.getContext();
                    const chatMessages = stContext.chat;

                    const recentMessages = chatMessages.slice(-4, -1);
                    context = recentMessages.map(msg => {
                        const text = msg.mes || '';
                        return text.substring(0, 100) + (text.length > 100 ? "..." : "");
                    });
                } else {
                    throw new Error('API not available');
                }
            } catch (e) {
                let $msgContainer = $btn.closest('.mes, .message-body');
                if ($msgContainer.length) {
                    let $prev = $msgContainer.prevAll('.mes, .message-body').slice(0, 3);
                    $($prev.get().reverse()).each((i, el) => {
                        let text = $(el).find('.mes_text, .markdown-content').text() || $(el).text();
                        context.push(text.substring(0, 100) + "...");
                    });
                }
            }

            const favItem = {
                char_name: $btn.data('voice-name') || "Unknown",
                text: $btn.data('text'),
                filename: serverFilename,
                audio_url: $btn.attr('data-audio-url'),
                fingerprint: msgFingerprint,
                chat_branch: branchId,
                context: context,
                emotion: $btn.data('voice-emotion') || $btn.attr('data-voice-emotion') || ""
            };

            try {
                await window.TTS_API.addFavorite(favItem);
                window.TTS_Utils.showNotification("✅ 已收藏到分支: " + branchId, "success");
            } catch (e) {
                console.error(e);
                alert("收藏失败: " + e.message);
            }
        });
    }
};
