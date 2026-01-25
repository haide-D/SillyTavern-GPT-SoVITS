/**
 * STT 适配器基类
 * 
 * 定义所有语音识别引擎必须实现的接口规范。
 * 采用适配器模式，便于扩展不同的 STT 引擎。
 * 
 * @abstract
 */
export class BaseSTTAdapter {
    constructor(options = {}) {
        if (new.target === BaseSTTAdapter) {
            throw new Error('BaseSTTAdapter 是抽象类，不能直接实例化');
        }

        this.options = {
            lang: 'zh-CN',          // 识别语言
            continuous: true,        // 持续识别模式
            interimResults: true,    // 是否返回中间结果
            ...options
        };

        // 状态
        this._isListening = false;

        // 回调函数
        this._onResult = null;
        this._onFinalResult = null;
        this._onError = null;
        this._onStateChange = null;
    }

    // ==================== 抽象方法（子类必须实现）====================

    /**
     * 检查当前环境是否支持此 STT 引擎
     * @returns {boolean}
     */
    isSupported() {
        throw new Error('子类必须实现 isSupported()');
    }

    /**
     * 开始语音识别
     * @returns {Promise<void>}
     */
    async start() {
        throw new Error('子类必须实现 start()');
    }

    /**
     * 停止语音识别（等待最终结果）
     * @returns {Promise<void>}
     */
    async stop() {
        throw new Error('子类必须实现 stop()');
    }

    /**
     * 中断语音识别（立即停止，不等待结果）
     * @returns {Promise<void>}
     */
    async abort() {
        throw new Error('子类必须实现 abort()');
    }

    /**
     * 获取引擎名称
     * @returns {string}
     */
    getName() {
        throw new Error('子类必须实现 getName()');
    }

    // ==================== 公共方法 ====================

    /**
     * 是否正在监听
     * @returns {boolean}
     */
    isListening() {
        return this._isListening;
    }

    /**
     * 设置识别语言
     * @param {string} lang - 语言代码，如 'zh-CN', 'en-US', 'ja-JP'
     */
    setLanguage(lang) {
        this.options.lang = lang;
    }

    // ==================== 事件注册 ====================

    /**
     * 注册识别结果回调
     * @param {Function} callback - (text: string, isFinal: boolean) => void
     */
    onResult(callback) {
        this._onResult = callback;
        return this;
    }

    /**
     * 注册最终结果回调（仅在识别完成时触发）
     * @param {Function} callback - (text: string) => void
     */
    onFinalResult(callback) {
        this._onFinalResult = callback;
        return this;
    }

    /**
     * 注册错误回调
     * @param {Function} callback - (error: Error) => void
     */
    onError(callback) {
        this._onError = callback;
        return this;
    }

    /**
     * 注册状态变化回调
     * @param {Function} callback - (state: 'listening' | 'stopped' | 'error') => void
     */
    onStateChange(callback) {
        this._onStateChange = callback;
        return this;
    }

    // ==================== 受保护方法（供子类调用）====================

    /**
     * 触发识别结果事件
     * @protected
     */
    _emitResult(text, isFinal) {
        if (this._onResult) {
            this._onResult(text, isFinal);
        }
        if (isFinal && this._onFinalResult) {
            this._onFinalResult(text);
        }
    }

    /**
     * 触发错误事件
     * @protected
     */
    _emitError(error) {
        console.error(`[${this.getName()}] 错误:`, error);
        if (this._onError) {
            this._onError(error);
        }
    }

    /**
     * 触发状态变化事件
     * @protected
     */
    _emitStateChange(state) {
        this._isListening = (state === 'listening');
        if (this._onStateChange) {
            this._onStateChange(state);
        }
    }
}
