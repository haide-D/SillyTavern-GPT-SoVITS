/**
 * STT 管理器
 * 
 * 统一管理语音识别功能，自动选择最佳引擎。
 * 提供简洁的 API 供外部使用。
 * 
 * 使用示例：
 * ```javascript
 * const stt = new STTManager({ lang: 'zh-CN' });
 * 
 * stt.onResult((text, isFinal) => {
 *     console.log(isFinal ? '最终: ' : '中间: ', text);
 * });
 * 
 * await stt.start();
 * ```
 */

import { WebSpeechAdapter } from './adapters/web_speech_adapter.js';

// 可用的适配器列表（按优先级排序）
const ADAPTERS = [
    WebSpeechAdapter,
    // 后续可添加更多适配器：
    // WhisperAdapter,
    // FunASRAdapter,
];

export class STTManager {
    constructor(options = {}) {
        this.options = {
            lang: 'zh-CN',
            continuous: true,
            interimResults: true,
            preferredEngine: null,  // 指定首选引擎，null 则自动选择
            ...options
        };

        this._adapter = null;
        this._callbacks = {
            onResult: null,
            onFinalResult: null,
            onError: null,
            onStateChange: null
        };

        // 自动初始化
        this._initAdapter();
    }

    /**
     * 初始化适配器
     * @private
     */
    _initAdapter() {
        // 如果指定了首选引擎
        if (this.options.preferredEngine) {
            const AdapterClass = ADAPTERS.find(A =>
                new A().getName() === this.options.preferredEngine
            );
            if (AdapterClass) {
                const adapter = new AdapterClass(this.options);
                if (adapter.isSupported()) {
                    this._adapter = adapter;
                    this._bindCallbacks();
                    console.log(`[STTManager] ✅ 使用指定引擎: ${adapter.getName()}`);
                    return;
                }
            }
        }

        // 自动选择第一个可用的引擎
        for (const AdapterClass of ADAPTERS) {
            const adapter = new AdapterClass(this.options);
            if (adapter.isSupported()) {
                this._adapter = adapter;
                this._bindCallbacks();
                console.log(`[STTManager] ✅ 自动选择引擎: ${adapter.getName()}`);
                return;
            }
        }

        console.warn('[STTManager] ⚠️ 没有可用的 STT 引擎');
    }

    /**
     * 绑定回调到适配器
     * @private
     */
    _bindCallbacks() {
        if (!this._adapter) return;

        this._adapter
            .onResult((text, isFinal) => {
                if (this._callbacks.onResult) {
                    this._callbacks.onResult(text, isFinal);
                }
            })
            .onFinalResult((text) => {
                if (this._callbacks.onFinalResult) {
                    this._callbacks.onFinalResult(text);
                }
            })
            .onError((error) => {
                if (this._callbacks.onError) {
                    this._callbacks.onError(error);
                }
            })
            .onStateChange((state) => {
                if (this._callbacks.onStateChange) {
                    this._callbacks.onStateChange(state);
                }
            });
    }

    // ==================== 公共 API ====================

    /**
     * 检查是否有可用的 STT 引擎
     */
    isAvailable() {
        return this._adapter !== null;
    }

    /**
     * 获取当前使用的引擎名称
     */
    getEngineName() {
        return this._adapter?.getName() || 'None';
    }

    /**
     * 是否正在监听
     */
    isListening() {
        return this._adapter?.isListening() || false;
    }

    /**
     * 设置识别语言
     * @param {string} lang - 语言代码
     */
    setLanguage(lang) {
        this.options.lang = lang;
        this._adapter?.setLanguage(lang);
        return this;
    }

    /**
     * 开始语音识别
     */
    async start() {
        if (!this._adapter) {
            throw new Error('没有可用的 STT 引擎');
        }
        await this._adapter.start();
    }

    /**
     * 停止语音识别
     */
    async stop() {
        if (this._adapter) {
            await this._adapter.stop();
        }
    }

    /**
     * 中断语音识别
     */
    async abort() {
        if (this._adapter) {
            await this._adapter.abort();
        }
    }

    /**
     * 切换监听状态
     */
    async toggle() {
        if (this.isListening()) {
            await this.stop();
        } else {
            await this.start();
        }
    }

    // ==================== 事件注册 ====================

    /**
     * 注册识别结果回调
     * @param {Function} callback - (text: string, isFinal: boolean) => void
     */
    onResult(callback) {
        this._callbacks.onResult = callback;
        return this;
    }

    /**
     * 注册最终结果回调
     * @param {Function} callback - (text: string) => void
     */
    onFinalResult(callback) {
        this._callbacks.onFinalResult = callback;
        return this;
    }

    /**
     * 注册错误回调
     * @param {Function} callback - (error: Error) => void
     */
    onError(callback) {
        this._callbacks.onError = callback;
        return this;
    }

    /**
     * 注册状态变化回调
     * @param {Function} callback - (state: string) => void
     */
    onStateChange(callback) {
        this._callbacks.onStateChange = callback;
        return this;
    }

    // ==================== 静态方法 ====================

    /**
     * 获取所有可用的引擎列表
     */
    static getAvailableEngines() {
        return ADAPTERS
            .map(A => new A())
            .filter(a => a.isSupported())
            .map(a => a.getName());
    }

    /**
     * 获取支持的语言列表
     */
    static getSupportedLanguages() {
        return [
            { code: 'zh-CN', name: '中文（简体）' },
            { code: 'zh-TW', name: '中文（繁体）' },
            { code: 'en-US', name: 'English (US)' },
            { code: 'en-GB', name: 'English (UK)' },
            { code: 'ja-JP', name: '日本語' },
            { code: 'ko-KR', name: '한국어' },
        ];
    }
}
