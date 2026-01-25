/**
 * 实时对话客户端 (重构版)
 * 
 * 功能:
 * 1. 复用 LLM_Client.callLLMStream 进行流式调用
 * 2. 文本分段器 (逐句发送TTS)
 * 3. 音频队列管理
 * 4. 打断支持
 * 5. 对话历史缓存
 * 
 * 依赖模块：
 * - ./js/text_chunker.js
 * - ./js/audio_queue.js
 * - LLM_Client (从父级目录)
 * - StreamingPlayer (可选，用于边下边播)
 */

// 在 ES Module 环境中导入
// import { TextChunker } from './js/text_chunker.js';
// import { AudioQueue } from './js/audio_queue.js';

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

        // 文本分段器（使用全局或导入的 TextChunker）
        const ChunkerClass = window.TextChunker || TextChunker;
        this.chunker = new ChunkerClass({
            minLength: 5,
            maxLength: 50
        });

        // 音频队列（使用全局或导入的 AudioQueue）
        const QueueClass = window.AudioQueue || AudioQueue;
        this.audioQueue = new QueueClass();

        // 取消控制器
        this._abortController = null;

        // TTS 请求链（保证顺序执行）
        this._ttsPromiseChain = Promise.resolve();

        // 是否是第一个TTS分段（用于首包优化）
        this._isFirstTTSChunk = true;
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
     * 开始流式对话 (使用后端 LLM 服务)
     */
    async chat(userMessage, callbacks = {}) {
        const { onToken, onAudio, onFirstTTSCall, onError, onComplete } = callbacks;

        this._abortController = new AbortController();
        this._ttsPromiseChain = Promise.resolve();
        this._firstTTSCallTime = null;
        this._isFirstTTSChunk = true;

        // 添加用户消息到历史
        this.conversationHistory.push({
            role: 'user',
            content: userMessage
        });

        try {
            console.log('[RealtimeClient] 开始流式对话，历史消息数:', this.conversationHistory.length);
            let fullResponse = '';

            // 调用后端 /chat_stream SSE 端点
            const response = await fetch(`${this.config.apiBaseUrl}/api/realtime/chat_stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_input: userMessage,
                    messages: this.conversationHistory.slice(0, -1),  // 不包含刚添加的用户消息
                    system_prompt: this.systemPrompt || null
                }),
                signal: this._abortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            // 解析 SSE 事件流
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';  // 保留未完成的行

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        const eventType = line.slice(7).trim();
                        continue;
                    }

                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.content) {
                                // token 事件
                                fullResponse += data.content;
                                if (onToken) onToken(data.content);
                            }

                            if (data.text) {
                                // tts_start 事件 - 分段文本到达
                                const textChunk = data.text;

                                // 记录首次TTS调用时间
                                if (!this._firstTTSCallTime) {
                                    this._firstTTSCallTime = performance.now();
                                    console.log(`[RealtimeClient] 🎤 首次TTS文本分段产生，文本: "${textChunk}"`);
                                    if (onFirstTTSCall) onFirstTTSCall(textChunk);
                                }

                                // 链式执行 TTS，保证顺序
                                const isFirst = this._isFirstTTSChunk;
                                this._isFirstTTSChunk = false;
                                this._ttsPromiseChain = this._ttsPromiseChain.then(() => {
                                    return this._sendToTTS(textChunk, onAudio, onError, isFirst);
                                });
                            }

                            if (data.full_response) {
                                // done 事件
                                fullResponse = data.full_response;
                            }

                            if (data.error) {
                                throw new Error(data.error);
                            }
                        } catch (parseError) {
                            if (parseError.message !== 'Unexpected end of JSON input') {
                                console.warn('[RealtimeClient] SSE 解析警告:', parseError);
                            }
                        }
                    }
                }
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

        messages.push({
            role: 'system',
            content: '你是一个友好的对话助手。请保持回复简洁，适合语音朗读。'
        });

        // 添加历史消息（最多保留 10 轮）
        const maxHistory = 20;
        const history = this.conversationHistory.slice(-maxHistory);
        messages.push(...history);

        return messages;
    }

    /**
     * 发送文本到TTS并流式播放
     */
    async _sendToTTS(text, onAudio, onError, isFirstChunk = false) {
        console.log(`[RealtimeClient] 发送TTS: "${text}" (isFirstChunk: ${isFirstChunk})`);

        if (!this.config.refAudioPath) {
            const error = '❌ ref_audio_path 为空！请先配置参考音频路径';
            console.error(`[RealtimeClient] ${error}`);
            if (onError) onError(error);
            return;
        }

        const startTime = performance.now();
        let firstChunkTime = null;
        let firstPlayTime = null;

        try {
            const response = await fetch(`${this.config.apiBaseUrl}/api/realtime/tts_stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    ref_audio_path: this.config.refAudioPath,
                    prompt_text: this.config.promptText,
                    text_lang: this.config.textLang,
                    is_first_chunk: isFirstChunk
                }),
                signal: this._abortController?.signal
            });

            console.log(`[RealtimeClient] TTS响应状态: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`TTS API错误: ${response.status} - ${errorText}`);
            }

            // 检查是否有流式播放器可用
            const useStreamingPlayer = !!this._streamingPlayer;

            if (useStreamingPlayer) {
                // 边下边播模式
                console.log('[RealtimeClient] 🚀 使用流式播放器');
                this._streamingPlayer.startNewSegment();
                const reader = response.body.getReader();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    if (!firstChunkTime && value.length > 0) {
                        firstChunkTime = performance.now() - startTime;
                        console.log(`[RealtimeClient] 🎵 首个 chunk: ${Math.round(firstChunkTime)}ms, ${value.length} 字节`);
                    }

                    await this._streamingPlayer.feedChunk(value, () => {
                        if (!firstPlayTime) {
                            firstPlayTime = performance.now() - startTime;
                            console.log(`[RealtimeClient] 🔊 开始播放: ${Math.round(firstPlayTime)}ms`);
                            if (onAudio) onAudio(null, firstChunkTime, firstPlayTime);
                        }
                    });
                }

                this._streamingPlayer.endSession();
                console.log(`[RealtimeClient] ✅ 流式播放完成`);

            } else {
                // 传统模式（等待完整下载后播放）
                console.log('[RealtimeClient] 📦 使用传统播放模式');

                const reader = response.body.getReader();
                const chunks = [];
                let totalBytes = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    if (!firstChunkTime && value.length > 0) {
                        firstChunkTime = performance.now() - startTime;
                        console.log(`[RealtimeClient] 🎵 首个 chunk: ${Math.round(firstChunkTime)}ms`);
                    }

                    chunks.push(value);
                    totalBytes += value.length;
                }

                // 合并所有 chunks
                const audioData = new Uint8Array(totalBytes);
                let offset = 0;
                for (const chunk of chunks) {
                    audioData.set(chunk, offset);
                    offset += chunk.length;
                }

                const audioBlob = new Blob([audioData], { type: 'audio/wav' });
                console.log(`[RealtimeClient] 创建Blob: size=${audioBlob.size}`);

                // 加入播放队列
                this.audioQueue.add(audioBlob);

                if (onAudio) onAudio(audioBlob, firstChunkTime);
            }

        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error('[RealtimeClient] TTS错误:', e);
                if (onError) onError(e.message);
            }
        }
    }

    /**
     * 设置流式播放器
     */
    setStreamingPlayer(player) {
        this._streamingPlayer = player;
        if (this.audioQueue) {
            this.audioQueue.clear();
        }
        console.log('[RealtimeClient] 已设置流式播放器（AudioQueue 已禁用）');
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
 * 内联 TextChunker (向后兼容)
 * 如果模块环境可用，优先使用导入的版本
 */
class TextChunker {
    constructor(options = {}) {
        this.minLength = options.minLength || 5;
        this.maxLength = options.maxLength || 50;
        this.buffer = '';
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
        if (this.buffer.length < this.minLength) return null;

        const match = this.buffer.match(this.sentenceEndings);
        if (match && match.index >= this.minLength - 1) {
            const end = match.index + 1;
            const chunk = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end);
            return chunk.trim();
        }

        if (this.buffer.length >= this.maxLength) {
            const clauseMatch = this.buffer.slice(0, this.maxLength).match(this.clauseEndings);
            if (clauseMatch && clauseMatch.index >= this.minLength - 1) {
                const end = clauseMatch.index + 1;
                const chunk = this.buffer.slice(0, end);
                this.buffer = this.buffer.slice(end);
                return chunk.trim();
            }
            const chunk = this.buffer.slice(0, this.maxLength);
            this.buffer = this.buffer.slice(this.maxLength);
            return chunk.trim();
        }

        return null;
    }
}


/**
 * 内联 AudioQueue (向后兼容)
 * 如果模块环境可用，优先使用导入的版本
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
            }
            console.error(`[AudioQueue] ❌ 播放错误: ${errorMsg}`);
            this._cleanup();
            this.isPlaying = false;
            this._playNext();
        };
    }

    _cleanup() {
        if (this._currentUrl) {
            URL.revokeObjectURL(this._currentUrl);
            this._currentUrl = null;
        }
    }

    add(audioBlob) {
        console.log(`[AudioQueue] 添加到队列: size=${audioBlob.size}`);
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
        if (this.queue.length === 0) return;

        const blob = this.queue.shift();
        this._cleanup();
        this._currentUrl = URL.createObjectURL(blob);
        this.audio.src = this._currentUrl;
        this.isPlaying = true;

        this.audio.play().then(() => {
            console.log('[AudioQueue] 🎵 开始播放');
        }).catch(e => {
            console.error('[AudioQueue] 播放失败:', e.message);
            this._cleanup();
            this.isPlaying = false;
            setTimeout(() => this._playNext(), 100);
        });
    }
}


// 导出 (如果在模块环境中)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RealtimeClient, TextChunker, AudioQueue };
}
