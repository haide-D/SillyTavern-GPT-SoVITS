// static/js/events.js
(function () {
    // 模块内部变量，不再污染全局 window
    let currentAudio = null;

    window.TTS_Events = {
        init() {
            this.bindClickEvents();
            this.bindMessageEvents();
            this.bindMenuEvents();
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
                $('iframe').each(function () {
                    try { $(this).contents().find('.voice-bubble').removeClass('playing'); } catch (e) { }
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
                $('iframe').each(function () {
                    try { $(this).contents().find(`.voice-bubble[data-key='${key}']`)[func]('playing'); } catch (e) { }
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
        // === 提取出的菜单显示逻辑 (供 Iframe 调用) ===
        handleContextMenu(e, $btn) {
            e.preventDefault();

            // 1. 只有已生成的语音才允许呼出菜单
            if ($btn.attr('data-status') !== 'ready') return;

            const $menu = $('#tts-bubble-menu');
            $menu.data('target', $btn);

            // 2. 计算坐标 (兼容 Iframe 传入的 e 可能是经过坐标修正的伪对象，也可能是原生事件)
            let clientX = e.clientX;
            let clientY = e.clientY;

            // 兼容触摸
            if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 0) {
                clientX = e.originalEvent.touches[0].clientX;
                clientY = e.originalEvent.touches[0].clientY;
            }

            // 3. 边界检测
            let left = clientX + 10;
            let top = clientY + 10;
            if (left + 150 > $(window).width()) left = $(window).width() - 160;
            if (top + 160 > $(window).height()) top = $(window).height() - 170;

            $menu.css({ top: top + 'px', left: left + 'px' }).fadeIn(150);
        },

        bindClickEvents() {
            $(document).on('click', '.voice-bubble', (e) => {
                const $btn = $(e.currentTarget); // 使用 currentTarget 确保点到的是按钮本身
                const charName = $btn.data('voice-name');
                const CACHE = window.TTS_State.CACHE;
                const Scheduler = window.TTS_Scheduler;

                // 状态 A: 已生成 (Ready)
                if ($btn.attr('data-status') === 'ready') {
                    const audioUrl = $btn.attr('data-audio-url') || $btn.data('audio-url');

                    if (!audioUrl) {
                        $btn.attr('data-status', 'error').removeClass('playing');
                        alert("音频丢失，请刷新页面或点击重试");
                        return;
                    }

                    // === 新增逻辑：如果当前正在播放，则停止 (Toggle Stop) ===
                    if ($btn.hasClass('playing')) {
                        // 1. 停止音频
                        if (currentAudio) {
                            currentAudio.pause();
                            currentAudio = null;
                        }
                        // 2. 清除主界面动画
                        $('.voice-bubble').removeClass('playing');
                        // 3. 清除 Iframe 内动画 (防止跨域报错用 try-catch)
                        $('iframe').each(function () {
                            try { $(this).contents().find('.voice-bubble').removeClass('playing'); } catch (e) { }
                        });
                        return; // 直接结束，不执行后续播放逻辑
                    }
                    // ========================================================

                    // 获取 key (如果没有 data-key，尝试用 Scheduler 生成一个，兼容旧版)
                    const key = $btn.data('key') || Scheduler.getTaskKey(charName, $btn.data('text'));

                    // 【重要修复】强制将 key 写入 DOM，确保 playAudio 能通过属性选择器找到它
                    $btn.attr('data-key', key);

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
                        if (window.TTS_UI) {
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
            // === 【新增】右键 (PC) 或 长按 (手机) 呼出菜单 ===
            $(document).on('contextmenu', '.voice-bubble', (e) => {
                this.handleContextMenu(e, $(e.currentTarget));
            });

            // === 【新增】点击页面空白处关闭菜单 ===
            $(document).on('click', (e) => {
                // 如果点击的不是菜单本身，也不是菜单里的按钮，就关闭
                if (!$(e.target).closest('#tts-bubble-menu').length) {
                    $('#tts-bubble-menu').fadeOut(100);
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
                    if (window.TTS_UI) {
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
                $('iframe').each(function () {
                    try {
                        const b = $(this).contents().find(`.voice-bubble[data-key='${key}']`);
                        if (b.length) $realBtn = b;
                    } catch (e) { }
                });
                if (!$realBtn || !$realBtn.length) $realBtn = $(`.voice-bubble[data-key='${key}']`);

                // 4. 执行调度
                if ($realBtn && $realBtn.length) {
                    $realBtn.attr('data-key', key);
                    $realBtn.removeClass('error').attr('data-status', 'waiting');
                    Scheduler.addToQueue($realBtn);
                    Scheduler.run();
                } else {
                    console.warn("[TTS] 按钮DOM丢失，等待DOM刷新后重试...");
                    // 没找到 DOM 可能是页面还在渲染，延迟重试
                    setTimeout(() => { window.postMessage(event.data, '*'); }, 200);
                }
            });
        },

        // === 共用下载函数 ===
        async downloadAudio(audioUrl, speaker, text) {
            if (!audioUrl) {
                alert("❌ 无法下载:音频文件不存在");
                return;
            }

            // 清理文本内容,移除特殊字符以适配文件名
            const cleanText = text.substring(0, 50).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

            // 构建文件名: 说话人:语音内容.wav
            const filename = `${speaker}:${cleanText}.wav`;

            // 🔧 关键优化:区分 Blob URL 和服务器路径
            const isBlobUrl = audioUrl.startsWith('blob:');

            // 对于 Blob URL,使用 fetch 方式(同源,无 CORS 问题)
            if (isBlobUrl) {
                try {
                    const response = await fetch(audioUrl);
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

                    if (window.TTS_Utils && window.TTS_Utils.showNotification) {
                        window.TTS_Utils.showNotification("⬇️ 下载成功: " + filename, "success");
                    }
                } catch (e) {
                    console.error("下载失败:", e);
                    alert("❌ 下载失败: " + e.message);
                }
            }
            // 对于服务器路径,直接使用简单下载方式(避免 CORS)
            else {
                try {
                    const a = document.createElement('a');
                    a.href = audioUrl;
                    a.download = filename;
                    // 不设置 target='_blank',让浏览器直接下载
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    if (window.TTS_Utils && window.TTS_Utils.showNotification) {
                        window.TTS_Utils.showNotification("⬇️ 下载成功: " + filename, "success");
                    }
                } catch (e) {
                    console.error("下载失败:", e);
                    alert("❌ 下载失败: " + e.message);
                }
            }
        },

        bindMenuEvents() {
            // 0. 下载语音 (Download)
            $(document).on('click', '#tts-action-download', async () => {
                const $btn = $('#tts-bubble-menu').data('target');
                $('#tts-bubble-menu').fadeOut(100);

                if (!$btn || !$btn.length) return;

                const audioUrl = $btn.attr('data-audio-url') || $btn.data('audio-url');
                const speaker = $btn.data('voice-name') || 'Unknown';
                const text = $btn.data('text') || '';

                // 调用共用下载函数
                await window.TTS_Events.downloadAudio(audioUrl, speaker, text);
            });

            // 1. 重绘 (Re-Roll) - 真正的服务端删除
            $(document).on('click', '#tts-action-reroll', async () => {
                const $btn = $('#tts-bubble-menu').data('target');
                $('#tts-bubble-menu').fadeOut(100);

                if (!$btn || !$btn.length) return;

                // 【关键修改 1】不再从 audioUrl 猜文件名，而是直接读取我们在 Scheduler 里存好的真实文件名
                const serverFilename = $btn.attr('data-server-filename');

                // 如果没有文件名，说明还没生成过、生成失败了，或者是旧版本缓存（还没存文件名）
                // 这种情况下，直接重置 UI 让它重新生成即可，不需要（也无法）删除服务端文件
                if (!serverFilename) {
                    console.warn("未找到服务端文件名记录，跳过删除步骤，直接重生成。");
                    resetAndRegen($btn);
                    return;
                }

                if (!confirm("确定要重新生成这段语音吗？")) return;

                // A. 调用 API 删除服务端文件
                try {
                    // 【关键修改 2】传入真实的 serverFilename
                    console.log(`🗑️ 准备删除服务端文件: ${serverFilename}`);
                    await window.TTS_API.deleteCache(serverFilename);
                    console.log(`✅ [Re-roll] 服务端缓存 ${serverFilename} 已删除`);
                } catch (e) {
                    console.warn("删除缓存请求失败（可能是文件已不存在），继续执行重生成", e);
                }

                // B. 执行重置和生成
                // 【建议】重置前把旧的文件名记录也清掉，避免逻辑混淆
                $btn.removeAttr('data-server-filename');
                resetAndRegen($btn);
            });

            // 封装一个重置并生成的辅助函数
            function resetAndRegen($btn) {
                const key = $btn.data('key');
                const CACHE = window.TTS_State.CACHE;
                const Scheduler = window.TTS_Scheduler;

                // 1. 清除前端内存缓存 (如果有)
                if (key && CACHE.audioMemory[key]) {
                    // 释放 Blob URL 内存
                    URL.revokeObjectURL(CACHE.audioMemory[key]);
                    delete CACHE.audioMemory[key];
                }

                // 2. 停止当前可能正在播放的这段音频
                if ($btn.hasClass('playing')) {
                    // 触发点击事件来停止，或者直接调用 API 停止
                    if (window.TTS_Events.playAudio) window.TTS_Events.playAudio(null, null);
                }

                // 3. 重置按钮状态
                $btn.attr('data-status', 'waiting')
                    .removeClass('ready error playing')
                    .css('opacity', '0.6'); // 视觉反馈

                // 4. 重新加入队列
                // Scheduler 会重新读取 global settings 和 character mapping
                // 自动生成新的请求，无需我们要旧的 params
                Scheduler.addToQueue($btn);
                Scheduler.run();
            }


            $(document).on('click', '#tts-action-fav', async () => {
                const $btn = $('#tts-bubble-menu').data('target');
                $('#tts-bubble-menu').fadeOut(100);
                if (!$btn) return;

                const serverFilename = $btn.attr('data-server-filename');
                if (!serverFilename) {
                    alert("❌ 无法收藏：未找到源文件名（可能是旧缓存）。");
                    return;
                }

                const msgFingerprint = window.TTS_Utils.getEnhancedFingerprint($btn);
                const branchId = window.TTS_Utils.getCurrentChatBranch();

                // 获取上下文
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
                    // 回退到 DOM 查询
                    let $msgContainer = $btn.closest('.mes, .message-body');
                    if ($msgContainer.length) {
                        let $prev = $msgContainer.prevAll('.mes, .message-body').slice(0, 3);
                        $($prev.get().reverse()).each((i, el) => {
                            let text = $(el).find('.mes_text, .markdown-content').text() || $(el).text();
                            context.push(text.substring(0, 100) + "...");
                        });
                    }
                }

                // --- 构建请求数据 ---
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
                    if (window.TTS_Utils && window.TTS_Utils.showNotification) {
                        window.TTS_Utils.showNotification("❤️ 已收藏到分支: " + branchId, "success");
                    } else {
                        alert("❤️ 收藏成功！");
                    }
                } catch (e) {
                    console.error(e);
                    alert("收藏失败: " + e.message);
                }
            });
        }
    };
})();


