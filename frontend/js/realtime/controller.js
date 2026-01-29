/**
 * 实时对话控制器
 * 
 * 职责：
 * 1. 管理 RealtimeClient（LLM + TTS）
 * 2. 管理 STTManager（语音识别）
 * 3. 管理 StreamingPlayer（流式音频播放）
 * 4. 处理用户输入和对话流程
 * 5. 与 UI 层通信
 */

// 动态导入 RealtimeClient（避免循环依赖）
let RealtimeClient = null;
let STTManager = null;
let StreamingPlayer = null;

/**
 * 生成带时间戳的日志前缀
 */
function timeLog(tag) {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', { hour12: false });
    const ms = now.getMilliseconds().toString().padStart(3, '0');
    return `[${time}.${ms}] [${tag}]`;
}

export class RealtimeController {
    constructor(options = {}) {
        this.options = {
            apiBaseUrl: options.apiBaseUrl || window.TTS_State?.CACHE?.API_URL || 'http://127.0.0.1:3000',
            ...options
        };

        // 核心模块
        this._client = null;
        this._stt = null;
        this._streamingPlayer = null;

        // 状态
        this._state = {
            isReady: false,
            isConnected: false,
            isSpeaking: false,
            isListening: false,
            currentCharacter: null
        };

        // 回调
        this._callbacks = {
            onStateChange: null,
            onToken: null,
            onAudioStart: null,
            onAudioEnd: null,
            onError: null,
            onSttResult: null
        };

        // 消息历史（本地缓存）
        this._messages = [];

        // 时间统计
        this._timing = {
            sendStart: null,
            firstToken: null,
            firstTTS: null,
            firstAudio: null
        };
    }

    /**
     * 初始化控制器
     */
    async init() {
        console.log(timeLog('RealtimeController'), '🚀 开始初始化...');
        const initStart = performance.now();

        try {
            // 动态导入 RealtimeClient
            if (!RealtimeClient) {
                console.log(timeLog('RealtimeController'), '📦 加载 RealtimeClient 模块...');
                const module = await import('../../../RealTime/frontend/realtime_client.js');
                RealtimeClient = module.RealtimeClient || window.RealtimeClient;
                console.log(timeLog('RealtimeController'), '✅ RealtimeClient 模块已加载');
            }

            // 创建客户端实例
            this._client = new RealtimeClient({
                apiBaseUrl: this.options.apiBaseUrl
            });

            // 初始化客户端（加载配置）
            console.log(timeLog('RealtimeController'), '⚙️ 初始化 RealtimeClient...');
            await this._client.init();

            // 初始化流式播放器
            await this._initStreamingPlayer();

            // 尝试初始化 STT
            await this._initSTT();

            // 获取当前角色信息
            await this._loadCharacterContext();

            // 预加载 TTS 模型（切换权重 + 预热）
            await this.preloadModel();

            this._state.isReady = true;
            this._emitStateChange();

            const initTime = Math.round(performance.now() - initStart);
            console.log(timeLog('RealtimeController'), `✅ 初始化完成，耗时: ${initTime}ms`);
            return true;

        } catch (error) {
            console.error(timeLog('RealtimeController'), '❌ 初始化失败:', error);
            this._emitError(error);
            return false;
        }
    }

    /**
     * 初始化流式播放器
     */
    async _initStreamingPlayer() {
        try {
            console.log(timeLog('RealtimeController'), '🔊 初始化 StreamingPlayer...');

            // 动态导入 StreamingPlayer
            if (!StreamingPlayer) {
                const module = await import('../../../RealTime/frontend/audio_streaming/index.js');
                StreamingPlayer = module.StreamingPlayer;
            }

            if (!StreamingPlayer) {
                console.warn(timeLog('RealtimeController'), '⚠️ StreamingPlayer 模块不可用，将使用传统播放模式');
                return;
            }

            // 创建并初始化播放器
            this._streamingPlayer = new StreamingPlayer();
            await this._streamingPlayer.init();

            // 设置到 RealtimeClient
            if (this._client) {
                this._client.setStreamingPlayer(this._streamingPlayer);
                console.log(timeLog('RealtimeController'), '✅ StreamingPlayer 已启用（边下边播模式）');
            }

        } catch (error) {
            console.warn(timeLog('RealtimeController'), '⚠️ StreamingPlayer 初始化失败，将使用传统播放模式:', error);
            this._streamingPlayer = null;
        }
    }

    /**
     * 初始化语音识别
     */
    async _initSTT() {
        try {
            console.log(timeLog('RealtimeController'), '🎤 初始化 STTManager...');

            // 动态导入 STTManager
            if (!STTManager) {
                const module = await import('../../../RealTime/frontend/speech_recognition/stt_manager.js');
                STTManager = module.STTManager;
            }

            this._stt = new STTManager({
                lang: 'zh-CN',
                continuous: false,  // 单次识别模式
                interimResults: true
            });

            // 绑定回调
            this._stt
                .onResult((text, isFinal) => {
                    console.log(timeLog('RealtimeController'), `🗣️ STT 结果: "${text}" (final=${isFinal})`);
                    if (this._callbacks.onSttResult) {
                        this._callbacks.onSttResult(text, isFinal);
                    }
                })
                .onError((error) => {
                    console.warn(timeLog('RealtimeController'), 'STT 错误:', error);
                });

            console.log(timeLog('RealtimeController'), `✅ STT 引擎: ${this._stt.getEngineName()}`);

        } catch (error) {
            console.warn(timeLog('RealtimeController'), '⚠️ STT 初始化失败，语音输入不可用:', error);
            this._stt = null;
        }
    }

    /**
     * 加载角色上下文
     */
    async _loadCharacterContext() {
        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) {
                console.warn(timeLog('RealtimeController'), '⚠️ SillyTavern 上下文不可用');
                return;
            }

            const { characters, characterId, name2 } = context;
            const currentChar = characters?.find(c => c.avatar === characterId);

            this._state.currentCharacter = {
                name: currentChar?.name || name2 || '角色',
                avatar: currentChar?.avatar ? `/characters/${currentChar.avatar}` : null
            };

            // ★ 同步完整上下文到后端（包括历史消息和角色人设）
            if (this._client) {
                console.log(timeLog('RealtimeController'), '📚 同步酒馆上下文到后端...');
                const syncResult = await this._client.syncContext({ maxMessages: 20 });
                if (syncResult?.success) {
                    console.log(timeLog('RealtimeController'), '✅ 上下文同步完成');
                } else {
                    console.warn(timeLog('RealtimeController'), '⚠️ 上下文同步失败:', syncResult?.message);
                }
            }

            // 获取参考音频（如果有绑定）
            await this._loadRefAudio();

        } catch (error) {
            console.warn(timeLog('RealtimeController'), '⚠️ 加载角色上下文失败:', error);
        }
    }


    /**
     * 加载参考音频配置
     */
    async _loadRefAudio() {
        try {
            const charName = this._state.currentCharacter?.name;
            if (!charName) return;

            const response = await fetch(`${this.options.apiBaseUrl}/api/realtime/ref_audio?char_name=${encodeURIComponent(charName)}`);

            if (response.ok) {
                const ref = await response.json();
                if (ref.path) {
                    this._client.config.refAudioPath = ref.path;
                    this._client.config.promptText = ref.text || '';
                    this._client.config.textLang = ref.lang || 'zh';
                    console.log(timeLog('RealtimeController'), `🔊 已加载参考音频: ${ref.path}`);
                }
            }
        } catch (error) {
            console.warn(timeLog('RealtimeController'), '⚠️ 加载参考音频失败:', error);
        }
    }

    // ==================== 模型预加载 ====================

    /**
     * 预加载角色的 TTS 模型
     * 
     * 执行顺序：
     * 1. 获取角色绑定的模型名称
     * 2. 获取模型配置（gpt_path, sovits_path）
     * 3. 切换 GPT 权重（如果不同）
     * 4. 切换 SoVITS 权重（如果不同）
     * 5. 加载参考音频配置
     * 6. 预热模型
     * 
     * @param {string} charName - 角色名称（可选，默认使用当前角色）
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async preloadModel(charName = null) {
        const targetChar = charName || this._state.currentCharacter?.name;
        if (!targetChar) {
            console.warn(timeLog('RealtimeController'), '⚠️ 无法预加载：未指定角色');
            return { success: false, message: '未指定角色' };
        }

        console.log(timeLog('RealtimeController'), `📦 开始预加载模型: ${targetChar}`);
        const preloadStart = performance.now();

        try {
            // 1. 获取角色绑定的模型名称
            const CACHE = window.TTS_State?.CACHE;
            if (!CACHE) {
                console.warn(timeLog('RealtimeController'), '⚠️ TTS_State.CACHE 不可用');
                return { success: false, message: 'TTS 缓存不可用' };
            }

            const modelName = CACHE.mappings?.[targetChar];
            if (!modelName) {
                console.warn(timeLog('RealtimeController'), `⚠️ 角色 "${targetChar}" 未绑定模型`);
                return { success: false, message: `角色 "${targetChar}" 未绑定模型` };
            }

            // 2. 获取模型配置
            const modelConfig = CACHE.models?.[modelName];
            if (!modelConfig) {
                console.warn(timeLog('RealtimeController'), `⚠️ 模型 "${modelName}" 配置不存在`);
                return { success: false, message: `模型 "${modelName}" 配置不存在` };
            }

            console.log(timeLog('RealtimeController'), `🎯 使用模型: ${modelName}`);

            // 3. 切换模型权重
            await this._switchModel(modelConfig);

            // 4. 加载参考音频
            await this._loadRefAudio();

            // 5. 预热模型
            if (this._client) {
                console.log(timeLog('RealtimeController'), '🔥 开始预热模型...');
                const warmupResult = await this._client.warmup({
                    refAudioPath: this._client.config.refAudioPath,
                    promptText: this._client.config.promptText,
                    promptLang: this._client.config.textLang
                });

                if (warmupResult?.success) {
                    if (warmupResult.skipped) {
                        console.log(timeLog('RealtimeController'), '⏩ 跳过预热（已缓存）');
                    } else {
                        console.log(timeLog('RealtimeController'), `✅ 预热完成: ${warmupResult.elapsed_ms}ms`);
                    }
                } else {
                    console.warn(timeLog('RealtimeController'), '⚠️ 预热失败:', warmupResult?.message);
                }
            }

            const totalTime = Math.round(performance.now() - preloadStart);
            console.log(timeLog('RealtimeController'), `✅ 模型预加载完成，总耗时: ${totalTime}ms`);

            return { success: true, message: `预加载完成 (${totalTime}ms)` };

        } catch (error) {
            console.error(timeLog('RealtimeController'), '❌ 模型预加载失败:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * 切换 GPT/SoVITS 模型权重
     * 
     * @param {object} modelConfig - 模型配置 {gpt_path, sovits_path}
     */
    async _switchModel(modelConfig) {
        const TTS_API = window.TTS_API;
        if (!TTS_API) {
            console.warn(timeLog('RealtimeController'), '⚠️ TTS_API 不可用，跳过模型切换');
            return;
        }

        // 获取当前已加载的模型状态
        const CURRENT_LOADED = window.TTS_State?.CURRENT_LOADED || {};

        // 切换 GPT 权重
        if (modelConfig.gpt_path && CURRENT_LOADED.gpt_path !== modelConfig.gpt_path) {
            console.log(timeLog('RealtimeController'), `🔄 切换 GPT 权重: ${modelConfig.gpt_path}`);
            const switchStart = performance.now();
            await TTS_API.switchWeights('proxy_set_gpt_weights', modelConfig.gpt_path);
            CURRENT_LOADED.gpt_path = modelConfig.gpt_path;
            console.log(timeLog('RealtimeController'), `✅ GPT 权重切换完成: ${Math.round(performance.now() - switchStart)}ms`);
        }

        // 切换 SoVITS 权重
        if (modelConfig.sovits_path && CURRENT_LOADED.sovits_path !== modelConfig.sovits_path) {
            console.log(timeLog('RealtimeController'), `🔄 切换 SoVITS 权重: ${modelConfig.sovits_path}`);
            const switchStart = performance.now();
            await TTS_API.switchWeights('proxy_set_sovits_weights', modelConfig.sovits_path);
            CURRENT_LOADED.sovits_path = modelConfig.sovits_path;
            console.log(timeLog('RealtimeController'), `✅ SoVITS 权重切换完成: ${Math.round(performance.now() - switchStart)}ms`);
        }

        // 更新全局状态
        if (window.TTS_State) {
            window.TTS_State.CURRENT_LOADED = CURRENT_LOADED;
        }
    }

    // ==================== 对话控制 ====================

    /**
     * 发送消息
     */
    async send(text) {
        if (!text?.trim()) return;
        if (!this._client) {
            this._emitError(new Error('客户端未初始化'));
            return;
        }

        // 重置时间统计
        this._timing = {
            sendStart: performance.now(),
            firstToken: null,
            firstTTS: null,
            firstAudio: null
        };

        console.log(timeLog('RealtimeController'), `💬 发送消息: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        // 添加到本地历史
        this._messages.push({
            role: 'user',
            content: text,
            timestamp: Date.now()
        });

        // 更新状态
        this._state.isSpeaking = true;
        this._emitStateChange();

        // 调用流式对话
        await this._client.chat(text, {
            onToken: (token) => {
                // 记录首 Token 时间
                if (!this._timing.firstToken) {
                    this._timing.firstToken = performance.now();
                    const latency = Math.round(this._timing.firstToken - this._timing.sendStart);
                    console.log(timeLog('RealtimeController'), `⚡ 首Token延迟: ${latency}ms`);
                }
                if (this._callbacks.onToken) {
                    this._callbacks.onToken(token);
                }
            },
            onFirstTTSCall: (textChunk) => {
                // 记录首次 TTS 调用时间
                if (!this._timing.firstTTS) {
                    this._timing.firstTTS = performance.now();
                    const latency = Math.round(this._timing.firstTTS - this._timing.sendStart);
                    console.log(timeLog('RealtimeController'), `🎤 首TTS调用延迟: ${latency}ms, 文本: "${textChunk}"`);
                }
            },
            onAudio: (blob, firstChunkTime, firstPlayTime) => {
                // 记录首音频时间
                if (!this._timing.firstAudio) {
                    this._timing.firstAudio = performance.now();
                    const latency = Math.round(this._timing.firstAudio - this._timing.sendStart);
                    console.log(timeLog('RealtimeController'), `🔊 首音频延迟: ${latency}ms`);
                }
                if (this._callbacks.onAudioStart && !this._audioStarted) {
                    this._audioStarted = true;
                    this._callbacks.onAudioStart();
                }
            },
            onComplete: (fullResponse) => {
                // 输出完整时间统计
                const totalTime = Math.round(performance.now() - this._timing.sendStart);
                console.log(timeLog('RealtimeController'), `✅ 对话完成，总耗时: ${totalTime}ms`);
                console.log(timeLog('RealtimeController'), `📊 时间统计: 首Token=${this._timing.firstToken ? Math.round(this._timing.firstToken - this._timing.sendStart) : '-'}ms, 首TTS=${this._timing.firstTTS ? Math.round(this._timing.firstTTS - this._timing.sendStart) : '-'}ms, 首音频=${this._timing.firstAudio ? Math.round(this._timing.firstAudio - this._timing.sendStart) : '-'}ms`);

                // 添加到本地历史
                this._messages.push({
                    role: 'assistant',
                    content: fullResponse,
                    timestamp: Date.now()
                });

                this._state.isSpeaking = false;
                this._audioStarted = false;
                this._emitStateChange();

                if (this._callbacks.onAudioEnd) {
                    this._callbacks.onAudioEnd();
                }
            },
            onError: (error) => {
                this._state.isSpeaking = false;
                this._emitStateChange();
                this._emitError(new Error(error));
            }
        });
    }

    /**
     * 打断当前对话
     */
    interrupt() {
        console.log(timeLog('RealtimeController'), '⏹️ 打断');

        if (this._client) {
            this._client.interrupt();
        }

        this._state.isSpeaking = false;
        this._emitStateChange();
    }

    /**
     * 清空对话历史
     */
    clear() {
        this._messages = [];
        if (this._client) {
            this._client.clearHistory();
        }
        console.log(timeLog('RealtimeController'), '🗑️ 历史已清空');
    }

    // ==================== 语音输入控制 ====================

    /**
     * 开始语音识别
     */
    async startListening() {
        if (!this._stt) {
            this._emitError(new Error('语音识别不可用'));
            return false;
        }

        try {
            await this._stt.start();
            this._state.isListening = true;
            this._emitStateChange();
            return true;
        } catch (error) {
            this._emitError(error);
            return false;
        }
    }

    /**
     * 停止语音识别
     */
    async stopListening() {
        if (!this._stt) return;

        await this._stt.stop();
        this._state.isListening = false;
        this._emitStateChange();
    }

    /**
     * 切换语音识别状态
     */
    async toggleListening() {
        if (this._state.isListening) {
            await this.stopListening();
        } else {
            await this.startListening();
        }
    }

    /**
     * 检查 STT 是否可用
     */
    isSttAvailable() {
        return this._stt?.isAvailable() || false;
    }

    // ==================== 事件回调 ====================

    onStateChange(callback) {
        this._callbacks.onStateChange = callback;
        return this;
    }

    onToken(callback) {
        this._callbacks.onToken = callback;
        return this;
    }

    onAudioStart(callback) {
        this._callbacks.onAudioStart = callback;
        return this;
    }

    onAudioEnd(callback) {
        this._callbacks.onAudioEnd = callback;
        return this;
    }

    onError(callback) {
        this._callbacks.onError = callback;
        return this;
    }

    onSttResult(callback) {
        this._callbacks.onSttResult = callback;
        return this;
    }

    // ==================== 内部方法 ====================

    _emitStateChange() {
        if (this._callbacks.onStateChange) {
            this._callbacks.onStateChange({ ...this._state });
        }
    }

    _emitError(error) {
        console.error('[RealtimeController] ❌', error);
        if (this._callbacks.onError) {
            this._callbacks.onError(error);
        }
    }

    // ==================== Getter ====================

    get state() {
        return { ...this._state };
    }

    get messages() {
        return [...this._messages];
    }

    get character() {
        return this._state.currentCharacter;
    }
}

export default RealtimeController;
