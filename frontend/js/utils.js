console.log("🔵 [1] TTS_Utils.js 开始加载...");

// 2. CSS 状态管理
let globalStyleContent = "";

// 1. 正则表达式
export const VOICE_TAG_REGEX = /(\s*)\[TTSVoice[:：]\s*([^:：]+)\s*[:：]\s*([^:：]*)\s*[:：]\s*(.*?)\]/gi;

export function getStyleContent() {
    return globalStyleContent;
}

// 注入主页面样式
export function injectStyles() {
    if (!globalStyleContent || $('#tts-style-injection').length > 0) return;
    $('head').append(`<style id="tts-style-injection">${globalStyleContent}</style>`);
}

// 加载 CSS (包含回调机制)
export async function loadGlobalCSS(url, afterLoadCallback) {
    try {
        const res = await fetch(url);
        if (res.ok) {
            globalStyleContent = await res.text();
            console.log("[TTS] Style loaded successfully.");

            // 立即注入主界面
            injectStyles();

            // 执行回调 (通常用于处理 Iframe 穿透)
            if (afterLoadCallback) afterLoadCallback(globalStyleContent);
        } else {
            console.error("[TTS] Failed to load style.css. Status:", res.status);
        }
    } catch (e) {
        console.error("[TTS] CSS Load Error:", e);
    }
}

// 3. 通知提示 (优化版：支持手机端可靠关闭)
let notificationTimer = null;

export function showNotification(msg, type = 'error') {
    // 清除之前的定时器，避免多个通知冲突
    if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
    }

    let $bar = $('#tts-notification-bar');
    if ($bar.length === 0) {
        $('body').append(`
            <div id="tts-notification-bar">
                <span class="tts-notif-msg"></span>
                <span class="tts-notif-close">✕</span>
            </div>
        `);
        $bar = $('#tts-notification-bar');

        // 添加样式（如果尚未添加）
        if ($('#tts-notif-style').length === 0) {
            $('head').append(`
                <style id="tts-notif-style">
                    #tts-notification-bar {
                        position: fixed;
                        top: 20px;
                        left: 50%;
                        transform: translateX(-50%) translateY(-100px);
                        padding: 12px 40px 12px 16px;
                        border-radius: 8px;
                        color: white;
                        font-size: 14px;
                        z-index: 99999;
                        opacity: 0;
                        transition: transform 0.3s ease, opacity 0.3s ease;
                        cursor: pointer;
                        max-width: 90%;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    #tts-notification-bar.show {
                        transform: translateX(-50%) translateY(0);
                        opacity: 1;
                    }
                    #tts-notification-bar .tts-notif-close {
                        position: absolute;
                        right: 12px;
                        top: 50%;
                        transform: translateY(-50%);
                        font-size: 16px;
                        opacity: 0.7;
                        cursor: pointer;
                        padding: 4px;
                    }
                    #tts-notification-bar .tts-notif-close:hover {
                        opacity: 1;
                    }
                </style>
            `);
        }

        // 点击通知栏任意位置关闭
        $bar.on('click', function () {
            hideNotification();
        });
    }

    const bgColor = type === 'error' ? '#d32f2f' : (type === 'success' ? '#43a047' : '#1976d2');
    $bar.find('.tts-notif-msg').text(msg);
    $bar.css('background', bgColor);

    // 使用 requestAnimationFrame 确保样式应用后再添加动画类
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            $bar.addClass('show');
        });
    });

    // 4秒后自动关闭
    notificationTimer = setTimeout(() => {
        hideNotification();
    }, 4000);
}

function hideNotification() {
    if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
    }
    const $bar = $('#tts-notification-bar');
    $bar.removeClass('show');
}

// 4. 拖拽逻辑
export function makeDraggable($el, onClick) {
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
}

export function generateFingerprint(text) {
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
}

export function extractTextFromNode($node) {
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
}

function cleanContent(text) {
    if (!text) return "";
    let str = String(text);
    str = str.replace(/<think>[\s\S]*?<\/think>/gi, "");
    str = str.replace(/\s+/g, "");
    return str;
}

export function getFingerprint($element) {
    const text = extractTextFromNode($element);
    return generateFingerprint(text);
}

/**
 * 生成增强型消息指纹,支持分支共享
 * 策略: mesid + 角色名 + 内容哈希
 * 
 * 优势:
 * - 相同位置、相同内容 → 相同指纹 (跨分支共享)
 * - 相同位置、不同内容 → 不同指纹 (区分分支差异)
 * - 不依赖 chatId,避免分支切换丢失收藏
 */
export function getEnhancedFingerprint($element) {
    try {
        // ✅ 新方案:使用 SillyTavern API 而不是 DOM
        if (window.SillyTavern && window.SillyTavern.getContext) {
            const stContext = window.SillyTavern.getContext();
            const chatMessages = stContext.chat;

            // 1. 从 bubble 的 data-text 获取文本
            let bubbleText = $element.attr('data-text') || $element.data('text');
            if (!bubbleText) {
                bubbleText = extractTextFromNode($element);
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
            const textHash = generateSimpleHash(bubbleText);
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
            text = extractTextFromNode($element);
        }

        const textHash = generateSimpleHash(text);
        const fingerprint = `m${messageIndex}_${textHash}`;

        return fingerprint;
    } catch (e) {
        return getFingerprint($element);
    }
}

/**
 * 生成简单的文本哈希 (用于指纹)
 * 使用快速哈希算法,确保相同文本产生相同哈希
 */
export function generateSimpleHash(text) {
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
}

/**
 * 获取当前聊天上下文中所有消息的增强指纹
 * 用于收藏匹配、电话历史功能
 * 
 * ✅ 使用 SillyTavern API,不依赖 DOM
 */
export function getCurrentContextFingerprints() {
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

                // 生成消息指纹（基于消息索引 + 内容哈希）
                const textHash = generateSimpleHash(msgText);
                const fp = `m${i}_${textHash}`;
                fps.push(fp);
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
            text = extractTextFromNode($bubble);
        }
        if (!text || text.trim() === '') return;

        const textHash = generateSimpleHash(text);
        const fp = `m${mesid}_${textHash}`;

        if (fp && fp !== 'empty') {
            fps.push(fp);
        }
    });

    return fps;
}

export function getCurrentChatBranch() {
    try {
        if (window.SillyTavern && window.SillyTavern.getContext) {
            const ctx = window.SillyTavern.getContext();
            if (ctx.chatId) return ctx.chatId.replace(/\.(jsonl|json)$/i, "");
        }
    } catch (e) { console.error(e); }
    return "default";
}

/**
 * 从消息文本中提取说话人名称
 * @param {string} messageText - 消息文本
 * @returns {string|null} 说话人名称,如果没有找到则返回 null
 */
export function extractSpeaker(messageText) {
    if (!messageText) return null;

    // 使用统一的正则表达式
    const match = VOICE_TAG_REGEX.exec(messageText);
    return match ? match[2] : null;  // match[2] 是说话人名称
}

/**
 * 从消息列表中提取所有说话人 (去重)
 * @param {Array} messages - 消息列表
 * @returns {Array<string>} 去重后的说话人列表
 */
export function extractAllSpeakers(messages) {
    const speakers = new Set();

    for (const msg of messages) {
        if (msg.is_system) continue;

        const msgText = msg.mes || '';
        if (!msgText) continue;

        // 重置正则表达式的 lastIndex
        VOICE_TAG_REGEX.lastIndex = 0;

        let match;
        while ((match = VOICE_TAG_REGEX.exec(msgText)) !== null) {
            const speaker = match[2];  // 说话人名称
            if (speaker) {
                speakers.add(speaker);
            }
        }
    }

    return Array.from(speakers);
}

console.log("🟢 [2] TTS_Utils.js 执行完毕");
