(function () {
    const BARS_HTML = `<span class='sovits-voice-waves'><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span></span>`;

    // 【新增】本地兜底正则，防止 Utils 加载失败导致无法识别
    // 匹配格式：[TTSVoice:角色名:情感] 文本内容
    const FALLBACK_REGEX = /\[TTSVoice\s*:\s*([^:]+)\s*:\s*([^\]]+)\]\s*([^[\n<]+)/gi;

    let scanTimer = null;

    window.TTS_Parser = {
        init() {
            console.log("✅ [Parser] DOM 解析器已加载 (修复版)");
        },

        scan() {
            if (scanTimer) clearTimeout(scanTimer);
            scanTimer = setTimeout(() => {
                this._executeScan();
            }, 300); // 稍微缩短防抖时间，提高响应速度
        },

        _executeScan() {
            const CACHE = window.TTS_State.CACHE;
            const TTS_Utils = window.TTS_Utils;
            const Scheduler = window.TTS_Scheduler;

            // 确保正则可用
            const REGEX = TTS_Utils && TTS_Utils.VOICE_TAG_REGEX ? TTS_Utils.VOICE_TAG_REGEX : FALLBACK_REGEX;

            if (CACHE.settings.enabled === false) return;

            const isIframeMode = CACHE.settings.iframe_mode === true;
            const currentCSS = TTS_Utils.getStyleContent();
            const activeStyle = CACHE.settings.bubble_style || localStorage.getItem('tts_bubble_style') || 'default';

            // ================= IFRAME 模式逻辑 =================
            if (isIframeMode) {
                $('iframe').each(function() {
                    try {
                        const $iframe = $(this);
                        const doc = $iframe.contents();
                        const head = doc.find('head');
                        const body = doc.find('body');

                        // 注入 CSS
                        if (currentCSS && head.length > 0 && head.find('#sovits-iframe-style').length === 0) {
                            head.append(`<style id='sovits-iframe-style'>${currentCSS}</style>`);
                        }
                        if (body.attr('data-bubble-style') !== activeStyle) {
                            body.attr('data-bubble-style', activeStyle);
                        }

                        // 绑定事件
                        if (!body.data('tts-event-bound')) {
                            body.on('click', '.voice-bubble', function(e) {
                                e.stopPropagation();
                                const $this = $(this);
                                window.top.postMessage({
                                    type: 'play_tts',
                                    key: $this.attr('data-key'),
                                    text: $this.attr('data-text'),
                                    charName: $this.attr('data-voice-name'),
                                    emotion: $this.attr('data-voice-emotion')
                                }, '*');
                            });
                            body.data('tts-event-bound', true);
                        }

                        // 查找目标节点
                        const targets = body.find('*').filter(function() {
                            if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'BUTTON'].includes(this.tagName)) return false;
                            // 【修复】不再因为包含 .voice-bubble 就跳过整个节点，只检查是否包含原始文本
                            let hasTargetText = false;
                            $(this).contents().each(function() {
                                // 必须是文本节点，且包含标签头
                                if (this.nodeType === 3 && this.nodeValue && this.nodeValue.indexOf("[TTSVoice") !== -1) {
                                    hasTargetText = true;
                                    return false;
                                }
                            });
                            return hasTargetText;
                        });

                        targets.each(function() {
                            const $p = $(this);
                            const html = $p.html();

                            // 【修复】移除了 if ($p.html().indexOf("voice-bubble") !== -1) return;
                            // 改为直接检测是否匹配正则
                            if (REGEX.test(html)) {
                                REGEX.lastIndex = 0; // 重置正则游标
                                const newHtml = html.replace(REGEX, (match, spaceChars, name, emotion, text) => {
                                    // 容错处理：如果 text 没抓到（比如被切断），使用空字符串
                                    if (!text) return match;

                                    const cleanName = name.trim();
                                    const cleanText = text.replace(/<[^>]+>|&lt;[^&]+&gt;/g, '').trim();
                                    if(!cleanText) return match; // 空文本不转

                                    const key = Scheduler.getTaskKey(cleanName, cleanText);
                                    let status = 'waiting';
                                    let dataUrlAttr = '';
                                    let loadingClass = '';

                                    if (CACHE.audioMemory[key]) {
                                        status = 'ready';
                                        dataUrlAttr = `data-audio-url='${CACHE.audioMemory[key]}'`;
                                    } else if (CACHE.pendingTasks.has(key)) {
                                        status = 'queued';
                                        loadingClass = 'loading';
                                    }

                                    const d = Math.max(1, Math.ceil(cleanText.length * 0.25));
                                    const bubbleWidth = Math.min(220, 60 + d * 10);

                                    // 确保 spaceChars 存在
                                    const prefix = spaceChars || '';

                                    return `${prefix}<span class='voice-bubble ${loadingClass}'
                                    style='width: ${bubbleWidth}px;'
                                    data-key='${key}'
                                    data-status='${status}' ${dataUrlAttr} data-text='${cleanText}'
                                    data-voice-name='${cleanName}' data-voice-emotion='${emotion.trim()}'>
                                    ${BARS_HTML}
                                    <span class='sovits-voice-duration'>${d}"</span>
                                </span>`;
                                });

                                // 只有当 HTML 确实改变时才更新，避免光标跳动或重绘
                                if (newHtml !== html) {
                                    $p.html(newHtml);
                                    if (CACHE.settings.auto_generate) setTimeout(() => Scheduler.scanAndSchedule(), 100);
                                }
                            }
                        });
                    } catch (e) { console.error(e); }
                });

            } else {
                // ================= 普通模式逻辑 =================
                if (currentCSS && $('#sovits-iframe-style-main').length === 0) {
                    $('head').append(`<style id='sovits-iframe-style-main'>${currentCSS}</style>`);
                }
                if (document.body.getAttribute('data-bubble-style') !== activeStyle) {
                    document.body.setAttribute('data-bubble-style', activeStyle);
                }

                // 扩大搜索范围，防止 .mes_text 类名不匹配
                $('.mes_text, .message-body, .markdown-content').each(function() {
                    const $this = $(this);
                    if ($this.find('iframe').length > 0) return;

                    // 【修复】移除了 data-voice-processed 和 find('.voice-bubble') 的阻断性检查
                    // 只要正则能匹配到新的标签，就允许替换

                    const html = $this.html();
                    if (REGEX.test(html)) {
                        REGEX.lastIndex = 0;
                        const newHtml = html.replace(REGEX, (match, spaceChars, name, emotion, text) => {
                            if (!text) return match;

                            const cleanName = name.trim();
                            const cleanText = text.replace(/<[^>]+>|&lt;[^&]+&gt;/g, '').trim();
                            if(!cleanText) return match;

                            const key = Scheduler.getTaskKey(cleanName, cleanText);
                            let status = 'waiting';
                            let dataUrlAttr = '';
                            let loadingClass = '';
                            if (CACHE.audioMemory[key]) {
                                status = 'ready';
                                dataUrlAttr = `data-audio-url='${CACHE.audioMemory[key]}'`;
                            } else if (CACHE.pendingTasks.has(key)) {
                                status = 'queued';
                                loadingClass = 'loading';
                            }
                            const d = Math.max(1, Math.ceil(cleanText.length * 0.25));
                            const bubbleWidth = Math.min(220, 60 + d * 10);
                            const prefix = spaceChars || '';

                            return `${prefix}<span class="voice-bubble ${loadingClass}"
                            style="width: ${bubbleWidth}px"
                            data-status="${status}" ${dataUrlAttr} data-text="${cleanText}"
                            data-voice-name="${cleanName}" data-voice-emotion="${emotion.trim()}">
                            ${BARS_HTML}
                            <span class="sovits-voice-duration">${d}"</span>
                        </span>`;
                        });

                        if (newHtml !== html) {
                            $this.html(newHtml);
                            // 不再设置 data-voice-processed，允许后续再次扫描
                            if (CACHE.settings.auto_generate) setTimeout(() => Scheduler.scanAndSchedule(), 100);
                        }
                    }
                });
            }
        }
    };
})();
