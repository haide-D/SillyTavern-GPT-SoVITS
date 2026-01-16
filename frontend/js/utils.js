console.log("🔵 [1] TTS_Utils.js 开始加载...");
window.TTS_Utils = window.TTS_Utils || {};

(function (scope) {
    // 1. 正则表达式
    scope.VOICE_TAG_REGEX = /(\s*)\[TTSVoice[:：]\s*([^:：]+)\s*[:：]\s*([^:：]*)\s*[:：]\s*(.*?)\]/gi;

    // 2. CSS 状态管理
    let globalStyleContent = "";

    scope.getStyleContent = function () {
        return globalStyleContent;
    };

    // 注入主页面样式
    scope.injectStyles = function () {
        if (!globalStyleContent || $('#tts-style-injection').length > 0) return;
        $('head').append(`<style id="tts-style-injection">${globalStyleContent}</style>`);
    };

    // 加载 CSS (包含回调机制)
    scope.loadGlobalCSS = async function (url, afterLoadCallback) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                globalStyleContent = await res.text();
                console.log("[TTS] Style loaded successfully.");

                // 立即注入主界面
                scope.injectStyles();

                // 执行回调 (通常用于处理 Iframe 穿透)
                if (afterLoadCallback) afterLoadCallback(globalStyleContent);
            } else {
                console.error("[TTS] Failed to load style.css. Status:", res.status);
            }
        } catch (e) {
            console.error("[TTS] CSS Load Error:", e);
        }
    };

    // 3. 通知提示
    scope.showNotification = function (msg, type = 'error') {
        let $bar = $('#tts-notification-bar');
        if ($bar.length === 0) {
            $('body').append(`<div id="tts-notification-bar"></div>`);
            $bar = $('#tts-notification-bar');
        }
        const bgColor = type === 'error' ? '#d32f2f' : '#43a047';
        $bar.text(msg).css('background', bgColor).addClass('show');
        setTimeout(() => { $bar.removeClass('show'); }, 4000);
    };

    // 4. 拖拽逻辑
    scope.makeDraggable = function ($el, onClick) {
        let isDragging = false;
        let hasMoved = false;
        let startX, startY, startLeft, startTop;
        const el = $el[0];

        const start = (clientX, clientY) => {
            isDragging = true; hasMoved = false;
            startX = clientX; startY = clientY;
            const rect = el.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            el.style.right = 'auto';
            el.style.left = startLeft + 'px';
            el.style.top = startTop + 'px';
            $el.css('opacity', '0.8');
        };

        const move = (clientX, clientY) => {
            if (!isDragging) return;
            const dx = clientX - startX;
            const dy = clientY - startY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved = true;
            el.style.left = (startLeft + dx) + 'px';
            el.style.top = (startTop + dy) + 'px';
        };

        const end = () => {
            isDragging = false;
            $el.css('opacity', '1');
            if (!hasMoved && onClick) onClick();
        };

        $el.on('mousedown', e => { start(e.clientX, e.clientY); });
        $(document).on('mousemove', e => { if (isDragging) { e.preventDefault(); move(e.clientX, e.clientY); } });
        $(document).on('mouseup', () => { if (isDragging) end(); });
        $el.on('touchstart', e => { const touch = e.originalEvent.touches[0]; start(touch.clientX, touch.clientY); });
        $el.on('touchmove', e => { if (isDragging) { if (e.cancelable) e.preventDefault(); const touch = e.originalEvent.touches[0]; move(touch.clientX, touch.clientY); } });
        $el.on('touchend', () => { if (isDragging) end(); });
    };

    scope.generateFingerprint = function (text) {
        const cleanText = cleanContent(text);
        const len = cleanText.length;
        if (len === 0) return "empty";
        if (len <= 30) {
            return `short_${len}_${cleanText}`;
        }
        const start = cleanText.substring(0, 10);
        const end = cleanText.substring(len - 10);
        const midIndex = Math.floor(len / 2) - 5;
        const mid = cleanText.substring(midIndex, midIndex + 10);
        return `v3_${len}_${start}_${mid}_${end}`;
    };

    scope.extractTextFromNode = function ($node) {
        // 1. 优先使用 data-text (如果存在且不为空) - 修复指纹获取问题
        if ($node.attr('data-text')) {
            return $node.attr('data-text');
        }

        // 2. 查找容器 (兼容 .mes和 .message-body)
        const $mes = $node.is('.mes, .message-body') ? $node : $node.closest('.mes, .message-body');

        if ($mes.length) {
            const $textDiv = $mes.find('.mes_text, .markdown-content');
            if ($textDiv.length) {
                return $textDiv.text();
            }
            return $mes.text();
        }

        return $node.text() || "";
    };
    function cleanContent(text) {
        if (!text) return "";
        let str = String(text);
        str = str.replace(/<think>[\s\S]*?<\/think>/gi, "");
        str = str.replace(/\s+/g, "");
        return str;
    }

    scope.getFingerprint = function ($element) {
        const text = scope.extractTextFromNode($element);
        return scope.generateFingerprint(text);
    };

    /**
     * 生成增强型消息指纹,支持分支共享
     * 策略: mesid + 角色名 + 内容哈希
     * 
     * 优势:
     * - 相同位置、相同内容 → 相同指纹 (跨分支共享)
     * - 相同位置、不同内容 → 不同指纹 (区分分支差异)
     * - 不依赖 chatId,避免分支切换丢失收藏
     */
    scope.getEnhancedFingerprint = function ($element) {
        try {
            // ✅ 新方案:使用 SillyTavern API 而不是 DOM
            if (window.SillyTavern && window.SillyTavern.getContext) {
                const stContext = window.SillyTavern.getContext();
                const chatMessages = stContext.chat;

                // 1. 从 bubble 的 data-text 获取文本
                let bubbleText = $element.attr('data-text') || $element.data('text');
                if (!bubbleText) {
                    bubbleText = scope.extractTextFromNode($element);
                }

                // 2. 在 chat 数组中查找匹配的消息
                // 遍历消息,找到包含这段文本的消息
                let foundMesid = null;
                for (let i = chatMessages.length - 1; i >= 0; i--) {
                    const msg = chatMessages[i];
                    const msgText = msg.mes || '';

                    // 检查消息是否包含这段文本
                    if (msgText.includes(bubbleText)) {
                        foundMesid = i;
                        break;
                    }
                }

                if (foundMesid === null) {
                    foundMesid = 'unknown';
                }

                // 3. 生成指纹
                const textHash = scope.generateSimpleHash(bubbleText);
                const fingerprint = `m${foundMesid}_${textHash}`;

                return fingerprint;
            }

            // ❌ 回退:如果 API 不可用,使用 DOM 方式
            const $msgContainer = $element.closest('.mes, .message-body');
            let messageIndex = 'unknown';
            if ($msgContainer.length) {
                messageIndex = $msgContainer.attr('mesid') || 'unknown';
            }

            let text = $element.attr('data-text') || $element.data('text');
            if (!text) {
                text = scope.extractTextFromNode($element);
            }

            const textHash = scope.generateSimpleHash(text);
            const fingerprint = `m${messageIndex}_${textHash}`;

            return fingerprint;
        } catch (e) {
            return scope.getFingerprint($element);
        }
    };

    /**
     * 生成简单的文本哈希 (用于指纹)
     * 使用快速哈希算法,确保相同文本产生相同哈希
     */
    scope.generateSimpleHash = function (text) {
        const cleanText = cleanContent(text);
        if (!cleanText) return 'empty';

        // 使用简单但有效的哈希算法
        let hash = 0;
        for (let i = 0; i < cleanText.length; i++) {
            const char = cleanText.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }

        // 转换为正数并转为36进制(更短)
        return Math.abs(hash).toString(36);
    };



    /**
     * 获取当前聊天上下文中所有消息的增强指纹
     * 用于收藏匹配功能
     * 
     * ✅ 使用 SillyTavern API,不依赖 DOM
     */
    scope.getCurrentContextFingerprints = function () {
        const fps = [];

        try {
            // ✅ 使用 SillyTavern API
            if (window.SillyTavern && window.SillyTavern.getContext) {
                const stContext = window.SillyTavern.getContext();
                const chatMessages = stContext.chat;

                // 遍历所有消息
                for (let i = 0; i < chatMessages.length; i++) {
                    const msg = chatMessages[i];

                    // 跳过系统消息
                    if (msg.is_system) continue;

                    const msgText = msg.mes || '';
                    if (!msgText) continue;

                    // 🔥 性能优化:只处理包含 [TTSVoice 标签的消息
                    if (!msgText.includes('[TTSVoice')) continue;

                    // 提取所有 TTS 文本片段
                    const REGEX = /\[TTSVoice[:\uff1a]\s*([^:\uff1a]+)\s*[:\uff1a]\s*([^:\uff1a]*)\s*[:\uff1a]\s*(.*?)\]/gi;
                    let match;

                    while ((match = REGEX.exec(msgText)) !== null) {
                        const ttsText = match[3];
                        if (!ttsText || !ttsText.trim()) continue;

                        // 清理文本 (移除 HTML 标签)
                        const cleanText = ttsText.replace(/<[^>]+>|&lt;[^&]+&gt;/g, '').trim();
                        if (!cleanText) continue;

                        // 生成指纹
                        const textHash = scope.generateSimpleHash(cleanText);
                        const fp = `m${i}_${textHash}`;

                        fps.push(fp);
                    }
                }

                return fps;
            }

        } catch (e) {
            // API 失败,使用 DOM 回退
        }

        // DOM 回退方案
        let bubbleCount = 0;
        $('.voice-bubble').each(function () {
            const $bubble = $(this);
            bubbleCount++;

            const $mes = $bubble.closest('.mes, .message-body');
            if (!$mes.length) return;

            const mesid = $mes.attr('mesid');
            if (!mesid) return;

            if ($mes.attr('is_system') === 'true') return;

            let text = $bubble.attr('data-text') || $bubble.data('text');
            if (!text) {
                text = scope.extractTextFromNode($bubble);
            }
            if (!text || text.trim() === '') return;

            const textHash = scope.generateSimpleHash(text);
            const fp = `m${mesid}_${textHash}`;

            if (fp && fp !== 'empty') {
                fps.push(fp);
            }
        });

        return fps;
    };
    scope.getCurrentChatBranch = function () {
        try {
            if (window.SillyTavern && window.SillyTavern.getContext) {
                const ctx = window.SillyTavern.getContext();
                if (ctx.chatId) return ctx.chatId.replace(/\.(jsonl|json)$/i, "");
            }
        } catch (e) { console.error(e); }
        return "default";
    };
    console.log("🟢 [2] TTS_Utils.js 执行完毕，对象已挂载:", window.TTS_Utils);
})(window.TTS_Utils);
