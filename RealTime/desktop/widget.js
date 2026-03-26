/**
 * 桌面小组件 - 核心逻辑
 *
 * 复用 RealtimeClient 的核心能力：
 * - TextChunker (文本分段)
 * - AudioQueue (音频队列播放)
 * - SSE 流式对话 (chat_stream)
 * - TTS 流式合成 (tts_stream)
 */

// ==================== 配置 ====================

const API_BASE = 'http://localhost:3000';

// ==================== TextChunker ====================

class TextChunker {
    constructor(opts = {}) {
        this.min = opts.minLength || 5;
        this.max = opts.maxLength || 50;
        this.buf = '';
        this.sentRe = /[。！？!?]/;
        this.clauseRe = /[，,；;：:]/;
    }
    feed(text) {
        this.buf += text;
        const out = [];
        let c;
        while ((c = this._try())) out.push(c);
        return out;
    }
    flush() {
        if (this.buf.trim()) { const r = this.buf.trim(); this.buf = ''; return r; }
        return null;
    }
    clear() { this.buf = ''; }
    _try() {
        if (this.buf.length < this.min) return null;
        const m = this.buf.match(this.sentRe);
        if (m && m.index >= this.min - 1) {
            const e = m.index + 1;
            const c = this.buf.slice(0, e);
            this.buf = this.buf.slice(e);
            return c.trim();
        }
        if (this.buf.length >= this.max) {
            const cm = this.buf.slice(0, this.max).match(this.clauseRe);
            if (cm && cm.index >= this.min - 1) {
                const e = cm.index + 1;
                const c = this.buf.slice(0, e);
                this.buf = this.buf.slice(e);
                return c.trim();
            }
            const c = this.buf.slice(0, this.max);
            this.buf = this.buf.slice(this.max);
            return c.trim();
        }
        return null;
    }
}

// ==================== StreamingAudioPlayer ====================
// 边下边播：解析 WAV 头后，攒满 minBufferBytes 的 PCM 就立即播放，后续数据无缝追加

class StreamingAudioPlayer {
    constructor() {
        this.audioCtx = null;
        // WAV 解析状态
        this._headerParsed = false;
        this._sampleRate = 0;
        this._numChannels = 0;
        this._bitsPerSample = 0;
        this._dataOffset = 0;
        this._headerBuf = null;
        // PCM 缓冲
        this._pcmPending = [];
        this._pcmPendingBytes = 0;
        this._playing = false;
        this._stopped = false;
        // Web Audio 调度
        this._nextTime = 0;
        this._sources = [];
        // 配置
        this.minBufferBytes = 4096;
    }

    async init() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
        return this;
    }

    /** 开始新的播放会话（完全重置） */
    startSession() {
        this.stop();
        this._reset();
    }

    _reset() {
        this._headerParsed = false;
        this._headerBuf = null;
        this._pcmPending = [];
        this._pcmPendingBytes = 0;
        this._playing = false;
        this._stopped = false;
    }

    /** 开始新音频段（保持播放时间轴连续） */
    startNewSegment() {
        this._reset();
    }

    /** 喂入流式数据块，返回是否触发了首次播放 */
    feedChunk(chunk) {
        if (this._stopped) return false;
        let firstPlay = false;

        if (!this._headerParsed) {
            // 收集头部
            if (!this._headerBuf) {
                this._headerBuf = chunk;
            } else {
                const merged = new Uint8Array(this._headerBuf.length + chunk.length);
                merged.set(this._headerBuf);
                merged.set(chunk, this._headerBuf.length);
                this._headerBuf = merged;
            }
            if (this._headerBuf.length >= 44) {
                this._parseWavHeader(this._headerBuf);
                if (this._headerParsed && this._headerBuf.length > this._dataOffset) {
                    firstPlay = this._addPCM(this._headerBuf.slice(this._dataOffset));
                }
            }
        } else {
            firstPlay = this._addPCM(chunk);
        }
        return firstPlay;
    }

    _parseWavHeader(buf) {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        // 简单 WAV 解析
        if (buf.length < 44) return;
        this._numChannels = view.getUint16(22, true);
        this._sampleRate = view.getUint32(24, true);
        this._bitsPerSample = view.getUint16(34, true);
        // 寻找 'data' 子块
        let offset = 12;
        while (offset + 8 < buf.length) {
            const id = String.fromCharCode(buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]);
            const size = view.getUint32(offset + 4, true);
            if (id === 'data') {
                this._dataOffset = offset + 8;
                this._headerParsed = true;
                return;
            }
            offset += 8 + size;
        }
        // fallback
        this._dataOffset = 44;
        this._headerParsed = true;
    }

    /** 添加 PCM 数据，够了就开始播放，返回是否首次播放 */
    _addPCM(data) {
        this._pcmPending.push(data);
        this._pcmPendingBytes += data.length;
        let firstPlay = false;

        if (!this._playing) {
            if (this._pcmPendingBytes >= this.minBufferBytes) {
                firstPlay = true;
                this._playing = true;
                if (this._nextTime < this.audioCtx.currentTime) {
                    this._nextTime = this.audioCtx.currentTime;
                }
                this._flushPCM();
            }
        } else {
            this._flushPCM();
        }
        return firstPlay;
    }

    _flushPCM() {
        if (this._pcmPendingBytes === 0) return;
        const combined = new Uint8Array(this._pcmPendingBytes);
        let off = 0;
        for (const buf of this._pcmPending) { combined.set(buf, off); off += buf.length; }
        this._pcmPending = [];
        this._pcmPendingBytes = 0;

        const samples = this._toFloat32(combined);
        if (samples.length > 0) this._play(samples);
    }

    _toFloat32(pcm) {
        if (this._bitsPerSample === 16) {
            const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
            const count = Math.floor(pcm.length / 2);
            const out = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                out[i] = view.getInt16(i * 2, true) / 32768;
            }
            return out;
        }
        // 8-bit fallback
        const out = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] - 128) / 128;
        return out;
    }

    _play(samples) {
        if (!this.audioCtx || samples.length === 0 || this._stopped) return;
        const ch = this._numChannels || 1;
        const sr = this._sampleRate || 32000;
        const perCh = Math.floor(samples.length / ch);
        const buf = this.audioCtx.createBuffer(ch, perCh, sr);
        for (let c = 0; c < ch; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < perCh; i++) d[i] = samples[i * ch + c];
        }
        const src = this.audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(this.audioCtx.destination);
        const t = Math.max(this._nextTime, this.audioCtx.currentTime);
        src.start(t);
        this._nextTime = t + buf.duration;
        this._sources.push(src);
        src.onended = () => {
            const idx = this._sources.indexOf(src);
            if (idx > -1) this._sources.splice(idx, 1);
        };
    }

    /** 冲刷剩余数据 */
    endSegment() {
        if (this._pcmPendingBytes > 0 && this._headerParsed) {
            if (!this._playing) {
                this._playing = true;
                if (this._nextTime < this.audioCtx.currentTime) {
                    this._nextTime = this.audioCtx.currentTime;
                }
            }
            this._flushPCM();
        }
    }

    stop() {
        this._stopped = true;
        for (const s of this._sources) { try { s.stop(); } catch(e) {} }
        this._sources = [];
        this._playing = false;
    }

    clear() {
        this.stop();
        this._reset();
        this._nextTime = 0;
    }
}

// ==================== Widget 核心 ====================

class Widget {
    constructor() {
        this.history = [];
        this.chunker = new TextChunker({ minLength: 5, maxLength: 50 });
        this.player = new StreamingAudioPlayer();
        this._abort = null;
        this._ttsChain = Promise.resolve();
        this._isFirstTTS = true;

        // TTS 配置 (从后端加载)
        this.ttsConfig = { refAudioPath: '', promptText: '', textLang: 'zh' };
        // LLM 配置 (从后端加载)
        this.llmReady = false;
        // 角色列表
        this._characters = [];
        // 默认角色名 (从 system_settings.json 的 desktop_widget.default_character 读取)
        this._defaultCharacter = '';
        this._startupCharacterLoaded = false;

        // STT
        this.sttManager = null;
        this._sttWasListening = false;
    }

    // ---- 初始化 ----

    async init() {
        this._bindUI();
        this._setStatus('offline', '等待后端...');
        this._addSystem('⏳ 正在等待后端就绪...');
        const ready = await this._waitForBackendReady();
        if (!ready) {
            this._setStatus('offline', '后端未连接');
            this._addSystem('❌ 后端未就绪，请先确认主程序窗口已完全启动');
            return;
        }
        await this._loadConfig();
        this._initSTT();
        this._setStatus('online', '就绪');
        this._addSystem('🟢 小组件已连接后端');
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async _waitForBackendReady(maxAttempts = 20, delayMs = 1000) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const res = await fetch(`${API_BASE}/api/realtime/health`, { cache: 'no-store' });
                if (res.ok) return true;
            } catch (e) {
                console.warn(`[Widget] 后端健康检查失败(${attempt}/${maxAttempts}):`, e.message);
            }

            this._setStatus('offline', `等待后端... (${attempt}/${maxAttempts})`);
            await this._sleep(delayMs);
        }
        return false;
    }

    _bindUI() {
        this.$chat = document.getElementById('chat');
        this.$input = document.getElementById('input');
        this.$btnSend = document.getElementById('btn-send');
        this.$btnMic = document.getElementById('btn-mic');
        this.$btnInterrupt = document.getElementById('btn-interrupt');
        this.$dot = document.getElementById('status-dot');
        this.$statusText = document.getElementById('status-text');
        this.$latFirst = document.getElementById('lat-first');
        this.$latAudio = document.getElementById('lat-audio');
        this.$sttBar = document.getElementById('stt-bar');

        this.$btnSend.addEventListener('click', () => this.send());
        this.$input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
        });
        this.$btnMic.addEventListener('click', () => this._toggleSTT());
        this.$btnInterrupt.addEventListener('click', () => this.interrupt());

        // 设置面板
        document.getElementById('btn-settings')?.addEventListener('click', () => {
            document.getElementById('settings')?.classList.toggle('open');
        });
        document.getElementById('btn-warmup')?.addEventListener('click', () => this._warmup());
        document.getElementById('btn-clear')?.addEventListener('click', () => {
            this.history = [];
            this.$chat.innerHTML = '';
            this._addSystem('对话已清空');
        });

        // 角色切换
        this.$charSelect = document.getElementById('cfg-character');
        this.$charSelect?.addEventListener('change', () => this._switchCharacter());
        document.getElementById('btn-refresh-chars')?.addEventListener('click', () => this._loadCharacters());
    }

    async _loadConfig() {
        console.log('[Widget] === _loadConfig 开始 ===');
        this._setStatus('offline', '加载配置...');

        try {
            // 加载 LLM 配置 + 默认角色
            console.log('[Widget] 1/3 请求 /api/admin/settings ...');
            const res = await fetch(`${API_BASE}/api/admin/settings`);
            console.log('[Widget] 1/3 响应状态:', res.status);
            if (res.ok) {
                const s = await res.json();
                const llm = s.phone_call?.llm || {};
                if (llm.api_url && llm.api_key && llm.model) {
                    this.llmReady = true;
                }
                // 读取默认角色配置
                this._defaultCharacter = (s.desktop_widget?.default_character || '').trim();
                console.log('[Widget] 默认角色配置:', this._defaultCharacter || '(未配置)');
            }
        } catch (e) {
            console.error('[Widget] 1/3 settings 请求失败:', e.message);
            this._addSystem('⚠️ 读取桌面挂件配置失败: ' + e.message);
        }

        try {
            // 加载 TTS 配置
            console.log('[Widget] 2/3 请求 /api/realtime/ref_audio ...');
            const res = await fetch(`${API_BASE}/api/realtime/ref_audio`);
            console.log('[Widget] 2/3 响应状态:', res.status);
            if (res.ok) {
                const d = await res.json();
                this.ttsConfig.refAudioPath = d.path || '';
                this.ttsConfig.promptText = d.text || '';
                this.ttsConfig.textLang = d.lang || 'zh';
                console.log('[Widget] TTS 配置:', this.ttsConfig.refAudioPath || '(空)');
            }
        } catch (e) {
            console.error('[Widget] 2/3 ref_audio 请求失败:', e.message);
            this._addSystem('⚠️ 读取默认参考音频失败: ' + e.message);
        }

        // 加载角色列表
        console.log('[Widget] 3/3 加载角色列表...');
        await this._loadCharacters();

        // 自动预热（兜底，角色切换已包含预热）
        if (this.ttsConfig.refAudioPath) {
            this._warmup(true);
        }
        console.log('[Widget] === _loadConfig 完成 ===');
    }

    // ---- 角色切换 ----

    async _loadCharacters() {
        try {
            this._setStatus('offline', '加载角色...');
            const res = await fetch(`${API_BASE}/api/realtime/characters`);
            if (!res.ok) {
                this._addSystem(`⚠️ 加载角色列表失败: HTTP ${res.status}`);
                return;
            }
            const data = await res.json();
            this._characters = data.characters || [];

            // 填充下拉框
            const sel = this.$charSelect;
            if (!sel) return;
            sel.innerHTML = '';

            if (this._characters.length === 0) {
                sel.innerHTML = '<option value="">无可用角色</option>';
                this._addSystem('⚠️ 未扫描到可用角色');
                return;
            }

            // 匹配配置文件中的默认角色
            let matchedIdx = -1;

            this._characters.forEach((ch, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = ch.name;
                // 优先匹配配置文件中的默认角色
                const normalizedName = (ch.name || '').trim();
                if (this._defaultCharacter && normalizedName === this._defaultCharacter) {
                    opt.selected = true;
                    matchedIdx = i;
                } else if (matchedIdx < 0 && this.ttsConfig.refAudioPath && ch.ref_audio_path === this.ttsConfig.refAudioPath) {
                    opt.selected = true;
                    matchedIdx = i;
                }
                sel.appendChild(opt);
            });

            // 同步参考音频输入框
            const cfgInput = document.getElementById('cfg-ref-audio');
            if (cfgInput) cfgInput.value = this.ttsConfig.refAudioPath;

            console.log(`[Widget] 角色匹配结果: matchedIdx=${matchedIdx}, defaultChar='${this._defaultCharacter}', characters=${this._characters.map(c => c.name).join(',')}`);
            if (matchedIdx >= 0) {
                sel.value = String(matchedIdx);
                await this._autoLoadStartupCharacter(matchedIdx);
            } else if (!this.ttsConfig.refAudioPath && this._characters.length > 0) {
                sel.value = "0";
                this._addSystem('⚠️ 未匹配到默认角色，回退到第一个角色');
                await this._autoLoadStartupCharacter(0);
            } else if (this._defaultCharacter) {
                this._addSystem(`⚠️ 未找到默认角色: ${this._defaultCharacter}`);
            }
        } catch (e) { console.error('[Widget] _loadCharacters error:', e); }
    }

    async _autoLoadStartupCharacter(idx, maxAttempts = 5) {
        const ch = this._characters[idx];
        if (!ch) return false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            this.$charSelect.value = String(idx);
            this._setStatus('offline', `加载角色 ${attempt}/${maxAttempts}...`);
            this._addSystem(`⏳ 自动加载角色: ${ch.name} (${attempt}/${maxAttempts})`);
            const ok = await this._switchCharacter({ startup: true, attempt, maxAttempts });
            if (ok) {
                this._startupCharacterLoaded = true;
                return true;
            }

            if (attempt < maxAttempts) {
                this._addSystem(`⚠️ ${ch.name} 启动加载失败，${attempt + 1}/${maxAttempts} 次重试中...`);
                await this._sleep(1500);
            }
        }

        this._setStatus('offline', '默认角色加载失败');
        this._addSystem(`❌ 默认角色自动加载失败: ${ch.name}`);
        return false;
    }

    async _switchCharacter(options = {}) {
        const { startup = false, attempt = 1, maxAttempts = 1 } = options;
        const idx = parseInt(this.$charSelect?.value);
        if (isNaN(idx) || !this._characters[idx]) return false;

        const ch = this._characters[idx];
        this.ttsConfig.refAudioPath = ch.ref_audio_path;
        this.ttsConfig.promptText = ch.prompt_text;
        this.ttsConfig.textLang = ch.lang;

        // 同步 UI
        const cfgInput = document.getElementById('cfg-ref-audio');
        if (cfgInput) cfgInput.value = ch.ref_audio_path;
        const cfgLang = document.getElementById('cfg-lang');
        if (cfgLang) cfgLang.value = ch.lang;

        this._addSystem(startup ? `🔄 启动加载角色: ${ch.name}` : `🔄 切换到: ${ch.name}`);
        this._setStatus('offline', startup ? `启动加载角色 ${attempt}/${maxAttempts}...` : '切换模型中...');

        // 带超时的 fetch 封装
        const fetchWithTimeout = (url, opts = {}, timeoutMs = 30000) => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            return fetch(url, { ...opts, signal: ctrl.signal })
                .finally(() => clearTimeout(timer));
        };

        try {
            // 1. 切换 GPT 权重 (.ckpt)
            if (ch.gpt_path) {
                this._addSystem('⏳ 切换 GPT 权重...');
                console.log('[Widget] → proxy_set_gpt_weights:', ch.gpt_path);
                const r1 = await fetchWithTimeout(
                    `${API_BASE}/proxy_set_gpt_weights?weights_path=${encodeURIComponent(ch.gpt_path)}`
                );
                if (!r1.ok) {
                    const err = await r1.json().catch(() => ({}));
                    throw new Error('GPT 权重切换失败: ' + (err.detail || r1.status));
                }
                console.log('[Widget] ✅ GPT 权重已切换');
            }

            // 2. 切换 SoVITS 权重 (.pth)
            if (ch.sovits_path) {
                this._addSystem('⏳ 切换 SoVITS 权重...');
                console.log('[Widget] → proxy_set_sovits_weights:', ch.sovits_path);
                const r2 = await fetchWithTimeout(
                    `${API_BASE}/proxy_set_sovits_weights?weights_path=${encodeURIComponent(ch.sovits_path)}`
                );
                if (!r2.ok) {
                    const err = await r2.json().catch(() => ({}));
                    throw new Error('SoVITS 权重切换失败: ' + (err.detail || r2.status));
                }
                console.log('[Widget] ✅ SoVITS 权重已切换');
            }

            // 3. 切换参考音频 + 预热
            console.log('[Widget] → switch_ref_audio + warmup');
            const res = await fetchWithTimeout(`${API_BASE}/api/realtime/switch_ref_audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ref_audio_path: ch.ref_audio_path,
                    prompt_text: ch.prompt_text,
                    prompt_lang: ch.lang,
                    auto_warmup: true
                })
            });
            const r = await res.json();
            if (r.success) {
                const ms = r.warmup_result?.elapsed_ms || 0;
                this._addSystem(`✅ ${ch.name} 已就绪${ms ? ` (预热 ${ms}ms)` : ''}`);
                this._setStatus('online', '就绪');
                return true;
            } else {
                this._addSystem('⚠️ 预热失败: ' + r.message);
                return false;
            }
        } catch (e) {
            this._addSystem('❌ 切换异常: ' + e.message);
            return false;
        }
    }

    // ---- 对话 ----

    async send() {
        const text = this.$input.value.trim();
        if (!text) return;

        // 暂停 STT
        if (this.sttManager && this.sttManager.isListening()) {
            this._sttWasListening = true;
            await this.sttManager.stop();
        }

        this._addMsg('user', text);
        this.$input.value = '';
        this._setStatus('streaming', '生成中...');
        this.$btnSend.style.display = 'none';
        this.$btnInterrupt.classList.add('visible');

        this.history.push({ role: 'user', content: text });

        const t0 = performance.now();
        let firstToken = false, firstAudio = false;
        this._abort = new AbortController();
        this._ttsChain = Promise.resolve();
        this._isFirstTTS = true;
        // 确保 AudioContext 已初始化（首次需要用户手势）
        await this.player.init();
        this.player.startSession();

        try {
            const el = this._addMsg('assistant', '', true);

            const resp = await fetch(`${API_BASE}/api/realtime/chat_stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_input: text,
                    messages: this.history.slice(0, -1),
                    system_prompt: null
                }),
                signal: this._abort.signal
            });

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const reader = resp.body.getReader();
            const dec = new TextDecoder();
            let buf = '', full = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buf += dec.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const d = JSON.parse(line.slice(6));

                        if (d.content) {
                            full += d.content;
                            el.textContent += d.content;
                            this.$chat.scrollTop = this.$chat.scrollHeight;
                            if (!firstToken) {
                                firstToken = true;
                                this.$latFirst.textContent = Math.round(performance.now() - t0) + 'ms';
                            }
                        }

                        if (d.text) {
                            const chunk = d.text;
                            const isFirst = this._isFirstTTS;
                            this._isFirstTTS = false;
                            this._ttsChain = this._ttsChain.then(() =>
                                this._tts(chunk, isFirst, () => {
                                    if (!firstAudio) {
                                        firstAudio = true;
                                        this.$latAudio.textContent = Math.round(performance.now() - t0) + 'ms';
                                    }
                                })
                            );
                        }

                        if (d.full_response) full = d.full_response;
                        if (d.error) throw new Error(d.error);
                    } catch (pe) {
                        if (pe.message && !pe.message.includes('JSON')) throw pe;
                    }
                }
            }

            await this._ttsChain;
            el.classList.remove('streaming');
            this.history.push({ role: 'assistant', content: full });
        } catch (e) {
            if (e.name !== 'AbortError') {
                this._addSystem('❌ ' + e.message);
            }
        } finally {
            this._setStatus('online', '就绪');
            this.$btnSend.style.display = '';
            this.$btnInterrupt.classList.remove('visible');
        }
    }

    interrupt() {
        if (this._abort) { this._abort.abort(); this._abort = null; }
        this.chunker.clear();
        this.player.clear();
        fetch(`${API_BASE}/api/realtime/interrupt`, { method: 'POST' }).catch(() => {});
        this._addSystem('⏹ 已打断');
    }

    // ---- TTS ----

    async _tts(text, isFirst, onAudio) {
        try {
            this.player.startNewSegment();

            const resp = await fetch(`${API_BASE}/api/realtime/tts_stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    ref_audio_path: this.ttsConfig.refAudioPath,
                    prompt_text: this.ttsConfig.promptText,
                    text_lang: this.ttsConfig.textLang,
                    is_first_chunk: isFirst
                }),
                signal: this._abort?.signal
            });

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(`TTS 请求失败 (${resp.status}): ${errData.detail || '未知错误'}`);
            }

            // 边下边播：每收到一块就喂给 StreamingAudioPlayer
            const reader = resp.body.getReader();
            let audioFired = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const triggered = this.player.feedChunk(value);
                if (triggered && !audioFired) {
                    audioFired = true;
                    if (onAudio) onAudio();
                }
            }

            this.player.endSegment();
        } catch (e) {
            if (e.name !== 'AbortError') console.error('[TTS]', e);
        }
    }

    async _warmup(silent = false) {
        if (!this.ttsConfig.refAudioPath) {
            if (!silent) this._addSystem('⚠️ 请先配置参考音频');
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/realtime/warmup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ref_audio_path: this.ttsConfig.refAudioPath,
                    prompt_text: this.ttsConfig.promptText,
                    prompt_lang: this.ttsConfig.textLang,
                    force: !silent
                })
            });
            const r = await res.json();
            if (!silent) {
                this._addSystem(r.success
                    ? (r.skipped ? '✅ 模型已预热（缓存命中）' : `✅ 预热完成 (${r.elapsed_ms}ms)`)
                    : '❌ 预热失败: ' + r.message
                );
            }
        } catch (e) {
            if (!silent) this._addSystem('❌ 预热异常: ' + e.message);
        }
    }

    // ---- STT 语音识别 ----

    _initSTT() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            this.$btnMic.style.display = 'none';
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this._recognition = new SpeechRecognition();
        this._recognition.continuous = true;
        this._recognition.interimResults = true;
        this._recognition.lang = 'zh-CN';

        this._recognition.onresult = (e) => {
            let final = '', interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) {
                    final += e.results[i][0].transcript;
                } else {
                    interim += e.results[i][0].transcript;
                }
            }
            this.$input.value = final || interim;
            if (final.trim()) {
                this.send();
            }
        };

        this._recognition.onerror = (e) => {
            this._addSystem(`❌ 麦克风错误: ${e.error}`);
            this._setMicUI(false);
            this._sttActive = false;
        };

        this._recognition.onend = () => {
            if (this._sttActive) {
                // 自动重启
                try { this._recognition.start(); } catch (e) { 
                    this._addSystem(`⚠️ 重启麦克风失败: ${e.message}`);
                    this._setMicUI(false); 
                    this._sttActive = false;
                }
            }
        };
    }

    async _toggleSTT() {
        if (this._sttActive) {
            this._sttActive = false;
            this._recognition?.stop();
            this._setMicUI(false);
        } else {
            this._sttActive = true;
            try {
                this._recognition.start();
                this._setMicUI(true);
            } catch (e) {
                this._sttActive = false;
                this._addSystem(`❌ 语音识别启动失败: ${e.message}`);
            }
        }
    }

    _setMicUI(active) {
        this.$btnMic.classList.toggle('active', active);
        this.$sttBar.classList.toggle('visible', active);
    }

    // ---- UI 辅助 ----

    _addMsg(role, content, streaming = false) {
        const div = document.createElement('div');
        div.className = `msg ${role}${streaming ? ' streaming' : ''}`;
        div.textContent = content;
        this.$chat.appendChild(div);
        this.$chat.scrollTop = this.$chat.scrollHeight;
        return div;
    }

    _addSystem(text) {
        const div = document.createElement('div');
        div.className = 'msg system';
        div.textContent = text;
        this.$chat.appendChild(div);
        this.$chat.scrollTop = this.$chat.scrollHeight;
    }

    _setStatus(state, text) {
        this.$dot.className = 'dot' + (state === 'online' ? ' online' : state === 'streaming' ? ' streaming' : '');
        this.$statusText.textContent = text;
    }
}

// ==================== 启动 ====================

window.addEventListener('DOMContentLoaded', () => {
    const w = new Widget();
    w.init();
});
