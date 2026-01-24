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
     * 开始流式对话
     * @param {string} userMessage - 用户消息
     * @param {Object} callbacks - 回调函数
     * @param {Function} callbacks.onToken - 收到token时回调
     * @param {Function} callbacks.onAudio - 收到音频时回调
     * @param {Function} callbacks.onError - 错误回调
     * @param {Function} callbacks.onComplete - 完成回调
     */
    async chat(userMessage, callbacks = {}) {
        const { onToken, onAudio, onError, onComplete } = callbacks;

        // 检查 LLM 配置
        if (!this.llmConfig || !this.llmConfig.api_url || !this.llmConfig.api_key) {
            const error = 'LLM 配置未设置，请先调用 init() 或 setLLMConfig()';
            console.error('[RealtimeClient]', error);
            if (onError) onError(error);
            return;
        }

        this._abortController = new AbortController();
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

                    // 分段并发送 TTS
                    const chunks = this.chunker.feed(chunk);
                    for (const textChunk of chunks) {
                        this._sendToTTS(textChunk, onAudio, onError);
                    }
                },
                this._abortController.signal
            );

            // 刷新剩余内容
            const remaining = this.chunker.flush();
            if (remaining) {
                await this._sendToTTS(remaining, onAudio, onError);
            }

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

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`TTS API错误: ${response.status} - ${errorText}`);
            }

            // 获取完整音频 (流式返回，但前端收集完整)
            const audioData = await response.arrayBuffer();
            const audioBlob = new Blob([audioData], { type: 'audio/wav' });

            if (onAudio) onAudio(audioBlob);

            // 加入播放队列
            this.audioQueue.add(audioBlob);

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

        this.audio.onended = () => {
            this.isPlaying = false;
            this._playNext();
        };

        this.audio.onerror = (e) => {
            console.error('[AudioQueue] 播放错误:', e);
            this.isPlaying = false;
            this._playNext();
        };
    }

    add(audioBlob) {
        this.queue.push(audioBlob);
        if (!this.isPlaying) {
            this._playNext();
        }
    }

    clear() {
        this.queue = [];
        this.audio.pause();
        this.audio.src = '';
        this.isPlaying = false;
    }

    _playNext() {
        if (this.queue.length === 0) {
            return;
        }

        const blob = this.queue.shift();
        const url = URL.createObjectURL(blob);

        this.audio.src = url;
        this.isPlaying = true;

        this.audio.play().catch(e => {
            console.error('[AudioQueue] 播放失败:', e);
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
