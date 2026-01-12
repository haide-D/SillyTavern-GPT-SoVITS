(function () {
    const BARS_HTML = `<span class='sovits-voice-waves'><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span><span class='sovits-voice-bar'></span></span>`;

    // 防抖计时器
    let scanTimer = null;

    window.TTS_Parser = {
        init() {
            console.log("✅ [Parser] DOM 解析器已加载 (Debounce Enabled)");
        },

        // 外部调用的入口：带防抖
        scan() {
            if (scanTimer) clearTimeout(scanTimer);
            // 延迟 500ms 执行，如果 AI 还在打字，这个计时器会被不断重置
            scanTimer = setTimeout(() => {
                this._executeScan();
            }, 500);
        },

        // 真正的执行逻辑 (原 processMessageContent)
        _executeScan() {
            const CACHE = window.TTS_State.CACHE;
            const TTS_Utils = window.TTS_Utils;
            const Scheduler = window.TTS_Scheduler;

            if (CACHE.settings.enabled === false) return;

            const isIframeMode = CACHE.settings.iframe_mode === true;
            const currentCSS = TTS_Utils.getStyleContent();

            if (isIframeMode) {
                $('iframe').each(function() {
                    try {
                        const $iframe = $(this);
                        const doc = $iframe.contents();
                        const head = doc.find('head');
                        const body = doc.find('body');

                        if (currentCSS && head.length > 0 && head.find('#sovits-iframe-style').length === 0) {
                            head.append(`<style id='sovits-iframe-style'>${currentCSS}</style>`);
                        }

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

                        const targets = body.find('*').filter(function() {
                            if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(this.tagName)) return false;
                            if ($(this).find('.voice-bubble').length > 0) return false;
                            let hasTargetText = false;
                            $(this).contents().each(function() {
                                if (this.nodeType === 3 && this.nodeValue && this.nodeValue.indexOf("[TTSVoice") !== -1) {
                                    hasTargetText = true;
                                    return false;
                                }
                            });
                            return hasTargetText;
                        });

                        targets.each(function() {
                            const $p = $(this);
                            if ($p.html().indexOf("voice-bubble") !== -1) return;
                            if (TTS_Utils.VOICE_TAG_REGEX.test($p.html())) {
                                const newHtml = $p.html().replace(TTS_Utils.VOICE_TAG_REGEX, (match, spaceChars, name, emotion, text) => {
                                    const cleanName = name.trim();
                                    const cleanText = text.replace(/<[^>]+>|&lt;[^&]+&gt;/g, '').trim();
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
                                    const bubbleWidth = Math.min(220, 75 + d * 10);
                                    return `${spaceChars}<span class='voice-bubble ${loadingClass}'
                                    style='width: ${bubbleWidth}px; justify-content: space-between;'
                                    data-key='${key}'
                                    data-status='${status}' ${dataUrlAttr} data-text='${cleanText}'
                                    data-voice-name='${cleanName}' data-voice-emotion='${emotion.trim()}'>
                                    ${BARS_HTML}
                                    <span class='sovits-voice-duration'>${d}"</span>
                                </span>`;
                                });
                                $p.html(newHtml);
                                if (CACHE.settings.auto_generate) setTimeout(() => Scheduler.scanAndSchedule(), 100);
                            }
                        });
                    } catch (e) { }
                });
            } else {
                // 普通模式
                if (currentCSS && $('#sovits-iframe-style-main').length === 0) {
                    $('head').append(`<style id='sovits-iframe-style-main'>${currentCSS}</style>`);
                }
                $('.mes_text').each(function() {
                    const $this = $(this);
                    if ($this.find('iframe').length > 0) return;
                    if ($this.attr('data-voice-processed') === 'true' || $this.find('.voice-bubble').length > 0) return;
                    const html = $this.html();
                    if (TTS_Utils.VOICE_TAG_REGEX.test(html)) {
                        TTS_Utils.VOICE_TAG_REGEX.lastIndex = 0;
                        const newHtml = html.replace(TTS_Utils.VOICE_TAG_REGEX, (match, spaceChars, name, emotion, text) => {
                            const cleanName = name.trim();
                            const cleanText = text.replace(/<[^>]+>|&lt;[^&]+&gt;/g, '').trim();
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
                            return `${spaceChars}<span class="voice-bubble ${loadingClass}"
                            style="width: ${bubbleWidth}px"
                            data-status="${status}" ${dataUrlAttr} data-text="${cleanText}"
                            data-voice-name="${cleanName}" data-voice-emotion="${emotion.trim()}">
                            ${BARS_HTML}
                            <span class="sovits-voice-duration">${d}"</span>
                        </span>`;
                        });
                        $this.html(newHtml);
                        $this.attr('data-voice-processed', 'true');
                        if (CACHE.settings.auto_generate) setTimeout(() => Scheduler.scanAndSchedule(), 100);
                    }
                });
            }
        }
    };
})();
