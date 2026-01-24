/**
 * 实时对话客户端 (重构版)
 * 
 * 功能:
 * 1. 复用 LLM_Client.callLLMStream 进行流式调用
 * 2. 文本分段器 (逐句发送TTS)
 * 3. 音频队列管理
 * 4. 打断支持
 * 5. 对话历史缓存
 */

// 导入 LLM_Client（需要在 HTML 中引入）
// import { LLM_Client } from '../../frontend/js/llm_client.js';

class RealtimeClient {
    constructor(config = {}) {
        this.config = {
            // TTS 配置
            refAudioPath: config.refAudioPath || '',
            promptText: config.promptText || '',
            textLang: config.textLang || 'zh',
            // API 基础路径（自动检测）
            apiBaseUrl: config.apiBaseUrl || window.location.origin
        };

        // LLM 配置（从后端加载）
        this.llmConfig = null;

        // 对话历史缓存
        this.conversationHistory = [];

        // 文本分段器
        this.chunker = new TextChunker({
            minLength: 5,
            maxLength: 50
        });

        // 音频队列
        this.audioQueue = new AudioQueue();

        // 取消控制器
        this._abortController = null;

        // TTS 请求链（保证顺序执行）
        this._ttsPromiseChain = Promise.resolve();
    }

    /**
     * 初始化 - 从后端加载 LLM 配置
     */
    async init() {
        try {
            const response = await fetch(`${this.config.apiBaseUrl}/api/admin/settings`);
            if (response.ok) {
                const settings = await response.json();
                const llmConfig = settings.phone_call?.llm || {};

                this.llmConfig = {
                    api_url: llmConfig.api_url || '',
                    api_key: llmConfig.api_key || '',
                    model: llmConfig.model || '',
                    temperature: llmConfig.temperature || 0.8,
                    max_tokens: llmConfig.max_tokens || 1024
                };

                console.log('[RealtimeClient] ✅ LLM 配置已加载:', this.llmConfig.model);
                return true;
            }
        } catch (e) {
            console.error('[RealtimeClient] ❌ 加载 LLM 配置失败:', e);
        }
        return false;
    }

    /**
     * 手动设置 LLM 配置（用于测试页面）
     */
    setLLMConfig(config) {
        this.llmConfig = {
            api_url: config.api_url || config.apiUrl || '',
            api_key: config.api_key || config.apiKey || '',
            model: config.model || '',
            temperature: config.temperature || 0.8,
            max_tokens: config.max_tokens || 1024
        };
        console.log('[RealtimeClient] LLM 配置已手动设置:', this.llmConfig.model);
    }

    /**
     * 预热 GPT-SoVITS 模型
     * 
     * 通过发送一个短文本请求，让 GPT-SoVITS 提前缓存参考音频特征。
     * 预热后，后续请求的延迟将从 ~3s 降至 ~0.3s。
     * 
     * @param {Object} options - 预热选项
     * @param {string} options.refAudioPath - 参考音频路径（可选，默认使用配置）
     * @param {string} options.promptText - 提示文本（可选）
     * @param {string} options.promptLang - 提示语言（可选）
     * @param {boolean} options.force - 是否强制预热（默认 false）
     * @returns {Promise<Object>} {success, message, elapsed_ms, skipped}
     */
    async warmup(options = {}) {
        console.log('[RealtimeClient] 🔥 开始预热...');

        try {
            const response = await fetch(`${this.config.apiBaseUrl}/api/realtime/warmup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ref_audio_path: options.refAudioPath || null,
                    prompt_text: options.promptText || null,
                    prompt_lang: options.promptLang || null,
                    force: options.force || false
                })
            });

            const result = await response.json();

            if (result.success) {
                if (result.skipped) {
                    console.log('[RealtimeClient] ⏩ 跳过预热（已缓存）');
                } else {
                    console.log(`[RealtimeClient] ✅ 预热完成！耗时: ${result.elapsed_ms}ms`);
                }
            } else {
                console.warn('[RealtimeClient] ⚠️ 预热失败:', result.message);
            }

            return result;
        } catch (e) {
            console.error('[RealtimeClient] ❌ 预热请求异常:', e);
            return {
                success: false,
                message: e.message,
                elapsed_ms: 0,
                skipped: false
            };
        }
    }

    /**
     * 切换参考音频（用于角色切换）
     * 
     * @param {Object} options - 切换选项
     * @param {string} options.refAudioPath - 新的参考音频路径
     * @param {string} options.promptText - 新的提示文本
     * @param {string} options.promptLang - 新的提示语言
     * @param {boolean} options.autoWarmup - 是否自动预热（默认 true）
     * @returns {Promise<Object>} {success, message, old_path, new_path, warmup_result}
     */
    async switchRefAudio(options) {
        console.log('[RealtimeClient] 🔄 切换参考音频...');

        if (!options.refAudioPath || !options.promptText) {
            return {
                success: false,
                message: 'refAudioPath 和 promptText 不能为空'
            };
        }

        try {
            const response = await fetch(`${this.config.apiBaseUrl}/api/realtime/switch_ref_audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ref_audio_path: options.refAudioPath,
                    prompt_text: options.promptText,
                    prompt_lang: options.promptLang || 'zh',
                    auto_warmup: options.autoWarmup !== false
                })
            });

            const result = await response.json();

            if (result.success) {
                // 更新本地配置
                this.config.refAudioPath = options.refAudioPath;
                this.config.promptText = options.promptText;
                if (options.promptLang) {
                    this.config.textLang = options.promptLang;
                }
                console.log(`[RealtimeClient] ✅ 参考音频已切换`);
            } else {
                console.warn('[RealtimeClient] ⚠️ 切换失败:', result.message);
            }

            return result;
        } catch (e) {
            console.error('[RealtimeClient] ❌ 切换请求异常:', e);
            return {
                success: false,
                message: e.message
            };
        }
    }

    /**
     * 获取当前预热状态
     * @returns {Promise<Object>} {is_warmed_up, ref_audio_path, prompt_text, prompt_lang}
     */
    async getWarmupStatus() {
        try {
            const response = await fetch(`${this.config.apiBaseUrl}/api/realtime/warmup_status`);
            return await response.json();
        } catch (e) {
            console.error('[RealtimeClient] ❌ 获取预热状态失败:', e);
            return {
                is_warmed_up: false,
                ref_audio_path: null,
                prompt_text: null,
                prompt_lang: null
            };
        }
    }

    /**
     * 开始流式对话
     * @param {string} userMessage - 用户消息
     * @param {Object} callbacks - 回调函数
     * @param {Function} callbacks.onToken - 收到token时回调
     * @param {Function} callbacks.onAudio - 收到音频时回调
     * @param {Function} callbacks.onFirstTTSCall - 首次调用TTS时回调（用于测量延迟）
     * @param {Function} callbacks.onError - 错误回调
     * @param {Function} callbacks.onComplete - 完成回调
     */
    async chat(userMessage, callbacks = {}) {
        const { onToken, onAudio, onFirstTTSCall, onError, onComplete } = callbacks;

        // 检查 LLM 配置
        if (!this.llmConfig || !this.llmConfig.api_url || !this.llmConfig.api_key) {
            const error = 'LLM 配置未设置，请先调用 init() 或 setLLMConfig()';
            console.error('[RealtimeClient]', error);
            if (onError) onError(error);
            return;
        }

        this._abortController = new AbortController();
        this._ttsPromiseChain = Promise.resolve(); // 重置TTS链
        this._firstTTSCallTime = null; // 重置首次TTS调用时间
        this.chunker.clear();

        // 添加用户消息到历史
        this.conversationHistory.push({
            role: 'user',
            content: userMessage
        });

        try {
            // 构建 messages（包含历史）
            const messages = this._buildMessages();

            console.log('[RealtimeClient] 开始流式对话，历史消息数:', this.conversationHistory.length);

            // 使用 LLM_Client.callLLMStream 进行流式调用
            const fullResponse = await window.LLM_Client.callLLMStream(
                {
                    api_url: this.llmConfig.api_url,
                    api_key: this.llmConfig.api_key,
                    model: this.llmConfig.model,
                    temperature: this.llmConfig.temperature,
                    max_tokens: this.llmConfig.max_tokens,
                    messages: messages
                },
                (chunk) => {
                    // 收到 token
                    if (onToken) onToken(chunk);

                    // 分段并发送 TTS（串行化，保证顺序）
                    const chunks = this.chunker.feed(chunk);
                    for (const textChunk of chunks) {
                        // 链式执行，保证顺序
                        this._ttsPromiseChain = this._ttsPromiseChain.then(() => {
                            // 记录首次TTS调用时间
                            if (!this._firstTTSCallTime) {
                                this._firstTTSCallTime = performance.now();
                                console.log(`[RealtimeClient] 🎤 首次TTS调用，文本: "${textChunk}"`);
                                if (onFirstTTSCall) onFirstTTSCall(textChunk);
                            }
                            return this._sendToTTS(textChunk, onAudio, onError);
                        });
                    }
                },
                this._abortController.signal
            );

            // 刷新剩余内容（等待之前的TTS完成后再发送）
            const remaining = this.chunker.flush();
            if (remaining) {
                this._ttsPromiseChain = this._ttsPromiseChain.then(() =>
                    this._sendToTTS(remaining, onAudio, onError)
                );
            }

            // 等待所有TTS请求完成
            await this._ttsPromiseChain;

            // 添加助手回复到历史
            this.conversationHistory.push({
                role: 'assistant',
                content: fullResponse
            });

            console.log('[RealtimeClient] ✅ 对话完成，总长度:', fullResponse.length);
            if (onComplete) onComplete(fullResponse);

        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('[RealtimeClient] 请求已取消');
            } else {
                console.error('[RealtimeClient] ❌ 对话失败:', e);
                if (onError) onError(e.message);
            }
        }
    }

    /**
     * 构建消息列表（包含简单系统提示和历史）
     */
    _buildMessages() {
        const messages = [];

        // 简单的系统提示
        messages.push({
            role: 'system',
            content: '你是一个友好的对话助手。请保持回复简洁，适合语音朗读。'
        });

        // 添加历史消息（最多保留 10 轮）
        const maxHistory = 20; // 10 轮 = 20 条消息
        const history = this.conversationHistory.slice(-maxHistory);
        messages.push(...history);

        return messages;
    }

    /**
     * 发送文本到TTS并获取流式音频
     */
    async _sendToTTS(text, onAudio, onError) {
        console.log(`[RealtimeClient] 发送TTS: "${text}"`);
        console.log(`[RealtimeClient] TTS配置:`, {
            apiBaseUrl: this.config.apiBaseUrl,
            refAudioPath: this.config.refAudioPath,
            promptText: this.config.promptText,
            textLang: this.config.textLang
        });

        // 验证必要参数
        if (!this.config.refAudioPath) {
            const error = '❌ ref_audio_path 为空！请先配置参考音频路径';
            console.error(`[RealtimeClient] ${error}`);
            if (onError) onError(error);
            return;
        }

        try {
            const response = await fetch(`${this.config.apiBaseUrl}/api/realtime/tts_stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    ref_audio_path: this.config.refAudioPath,
                    prompt_text: this.config.promptText,
                    text_lang: this.config.textLang
                }),
                signal: this._abortController?.signal
            });

            // 记录响应头信息
            console.log(`[RealtimeClient] TTS响应状态:`, response.status);
            console.log(`[RealtimeClient] Content-Type:`, response.headers.get('Content-Type'));
            console.log(`[RealtimeClient] Content-Length:`, response.headers.get('Content-Length'));

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`TTS API错误: ${response.status} - ${errorText}`);
            }

            // 获取完整音频 (流式返回，但前端收集完整)
            const audioData = await response.arrayBuffer();
            console.log(`[RealtimeClient] 收到音频数据: ${audioData.byteLength} 字节`);

            // 检查数据头部（用于诊断格式问题）
            if (audioData.byteLength > 0) {
                const header = new Uint8Array(audioData.slice(0, 16));
                const headerHex = Array.from(header).map(b => b.toString(16).padStart(2, '0')).join(' ');
                console.log(`[RealtimeClient] 音频数据头部(hex): ${headerHex}`);

                // 检查是否是WAV文件 (RIFF头)
                const headerStr = String.fromCharCode(...header.slice(0, 4));
                console.log(`[RealtimeClient] 音频格式标识: '${headerStr}' (期望: 'RIFF')`);

                if (headerStr !== 'RIFF') {
                    console.warn(`[RealtimeClient] ⚠️ 音频数据不是WAV格式！`);
                    // 尝试显示前100字节作为文本（可能是错误信息）
                    if (audioData.byteLength < 1000) {
                        try {
                            const textDecoder = new TextDecoder();
                            const text = textDecoder.decode(audioData);
                            console.error(`[RealtimeClient] 响应内容: ${text}`);
                        } catch (e) {
                            // 忽略解码错误
                        }
                    }
                }
            } else {
                console.error(`[RealtimeClient] ❌ 收到空的音频数据!`);
            }

            const audioBlob = new Blob([audioData], { type: 'audio/wav' });
            console.log(`[RealtimeClient] 创建Blob: size=${audioBlob.size}, type=${audioBlob.type}`);

            // 加入播放队列（由 audioQueue 统一管理播放）
            this.audioQueue.add(audioBlob);

            // 通知回调（仅用于 UI 更新，不要在回调中播放！）
            if (onAudio) onAudio(audioBlob);

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('[RealtimeClient] TTS错误:', e);
                if (onError) onError(e.message);
            }
        }
    }

    /**
     * 打断当前对话
     */
    interrupt() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        this.chunker.clear();
        this.audioQueue.clear();
        console.log('[RealtimeClient] 已打断');
    }

    /**
     * 清空对话历史
     */
    clearHistory() {
        this.conversationHistory = [];
        console.log('[RealtimeClient] 对话历史已清空');
    }
}


/**
 * 文本分段器 (前端版本)
 */
class TextChunker {
    constructor(options = {}) {
        this.minLength = options.minLength || 5;
        this.maxLength = options.maxLength || 50;
        this.buffer = '';

        // 分段标点
        this.sentenceEndings = /[。！？!?]/;
        this.clauseEndings = /[，,；;：:]/;
    }

    feed(text) {
        this.buffer += text;
        const chunks = [];

        while (true) {
            const chunk = this._tryExtract();
            if (chunk) {
                chunks.push(chunk);
            } else {
                break;
            }
        }

        return chunks;
    }

    flush() {
        if (this.buffer.trim()) {
            const result = this.buffer.trim();
            this.buffer = '';
            return result;
        }
        return null;
    }

    clear() {
        this.buffer = '';
    }

    _tryExtract() {
        if (this.buffer.length < this.minLength) {
            return null;
        }

        // 寻找句子结束符
        const match = this.buffer.match(this.sentenceEndings);
        if (match && match.index >= this.minLength - 1) {
            const end = match.index + 1;
            const chunk = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end);
            return chunk.trim();
        }

        // 达到最大长度，强制分段
        if (this.buffer.length >= this.maxLength) {
            // 尝试在子句处分段
            const clauseMatch = this.buffer.slice(0, this.maxLength).match(this.clauseEndings);
            if (clauseMatch && clauseMatch.index >= this.minLength - 1) {
                const end = clauseMatch.index + 1;
                const chunk = this.buffer.slice(0, end);
                this.buffer = this.buffer.slice(end);
                return chunk.trim();
            }

            // 强制分段
            const chunk = this.buffer.slice(0, this.maxLength);
            this.buffer = this.buffer.slice(this.maxLength);
            return chunk.trim();
        }

        return null;
    }
}


/**
 * 音频队列管理器
 */
class AudioQueue {
    constructor() {
        this.queue = [];
        this.isPlaying = false;
        this.audio = new Audio();
        this._currentUrl = null;

        this.audio.onended = () => {
            console.log('[AudioQueue] ✅ 播放完成');
            this._cleanup();
            this.isPlaying = false;
            this._playNext();
        };

        this.audio.onerror = (e) => {
            // 获取更详细的错误信息
            const mediaError = this.audio.error;
            let errorMsg = '未知错误';
            if (mediaError) {
                switch (mediaError.code) {
                    case MediaError.MEDIA_ERR_ABORTED:
                        errorMsg = 'MEDIA_ERR_ABORTED: 播放被中止';
                        break;
                    case MediaError.MEDIA_ERR_NETWORK:
                        errorMsg = 'MEDIA_ERR_NETWORK: 网络错误';
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errorMsg = 'MEDIA_ERR_DECODE: 解码错误';
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMsg = 'MEDIA_ERR_SRC_NOT_SUPPORTED: 不支持的音频格式';
                        break;
                }
                errorMsg += ` (message: ${mediaError.message || 'N/A'})`;
            }
            console.error(`[AudioQueue] ❌ 播放错误: ${errorMsg}`);
            console.error(`[AudioQueue] 当前src: ${this.audio.src}`);
            console.error(`[AudioQueue] 当前状态: readyState=${this.audio.readyState}, networkState=${this.audio.networkState}`);

            this._cleanup();
            this.isPlaying = false;
            this._playNext();
        };

        // 添加更多事件监听用于调试
        this.audio.onloadstart = () => {
            console.log('[AudioQueue] 开始加载音频...');
        };

        this.audio.onloadedmetadata = () => {
            console.log(`[AudioQueue] 元数据加载完成: duration=${this.audio.duration}s`);
        };

        this.audio.oncanplay = () => {
            console.log('[AudioQueue] 可以播放');
        };
    }

    _cleanup() {
        if (this._currentUrl) {
            URL.revokeObjectURL(this._currentUrl);
            this._currentUrl = null;
        }
    }

    add(audioBlob) {
        console.log(`[AudioQueue] 添加到队列: size=${audioBlob.size}, type=${audioBlob.type}, 队列长度=${this.queue.length + 1}`);
        this.queue.push(audioBlob);
        if (!this.isPlaying) {
            this._playNext();
        }
    }

    clear() {
        console.log('[AudioQueue] 清空队列');
        this.queue = [];
        this.audio.pause();
        this._cleanup();
        this.audio.src = '';
        this.isPlaying = false;
    }

    _playNext() {
        if (this.queue.length === 0) {
            console.log('[AudioQueue] 队列为空，等待新音频');
            return;
        }

        const blob = this.queue.shift();
        console.log(`[AudioQueue] 准备播放: size=${blob.size}, type=${blob.type}, 剩余=${this.queue.length}`);

        // 清理之前的URL
        this._cleanup();

        this._currentUrl = URL.createObjectURL(blob);
        console.log(`[AudioQueue] 创建ObjectURL: ${this._currentUrl}`);

        this.audio.src = this._currentUrl;
        this.isPlaying = true;

        this.audio.play().then(() => {
            console.log('[AudioQueue] 🎵 开始播放');
        }).catch(e => {
            console.error('[AudioQueue] 播放失败:', e.name, e.message);
            this._cleanup();
            this.isPlaying = false;
            // 继续尝试下一个
            setTimeout(() => this._playNext(), 100);
        });
    }
}


// 导出 (如果在模块环境中)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RealtimeClient, TextChunker, AudioQueue };
}
