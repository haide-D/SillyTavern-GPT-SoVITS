/**
 * Web Speech API 适配器
 * 
 * 使用浏览器原生的 SpeechRecognition API 实现实时语音识别。
 * 
 * 特点：
 * - 零依赖，浏览器原生支持
 * - 毫秒级延迟（~200ms）
 * - 支持中间结果（边说边显示）
 * - Chrome/Edge 支持最好
 * 
 * @extends BaseSTTAdapter
 */

import { BaseSTTAdapter } from './base_adapter.js';

export class WebSpeechAdapter extends BaseSTTAdapter {
    constructor(options = {}) {
        super(options);

        // Web Speech API 实例
        this._recognition = null;

        // 配置选项
        this.options = {
            ...this.options,
            maxAlternatives: 1,      // 最大备选结果数
            autoRestart: true,       // 静默后自动重启（持续监听模式）
            ...options
        };

        // 内部状态
        this._shouldRestart = false;
        this._lastResultIndex = 0;
        this._isFocused = true;      // 页面是否有焦点
        this._isPageVisible = true;  // 页面是否可见
        this._pendingRestart = false; // 是否有待恢复的识别任务

        // 绑定页面可见性和焦点事件
        this._bindPageEvents();
    }

    /**
     * 绑定页面可见性和焦点事件
     * @private
     */
    _bindPageEvents() {
        // 页面可见性变化
        document.addEventListener('visibilitychange', () => {
            this._isPageVisible = !document.hidden;
            console.log(`[WebSpeechAdapter] 📄 页面可见性: ${this._isPageVisible ? '可见' : '隐藏'}`);

            if (this._isPageVisible && this._pendingRestart) {
                this._tryRestartRecognition();
            }
        });

        // 窗口获得焦点
        window.addEventListener('focus', () => {
            this._isFocused = true;
            console.log('[WebSpeechAdapter] 🔍 窗口获得焦点');

            if (this._pendingRestart) {
                this._tryRestartRecognition();
            }
        });

        // 窗口失去焦点
        window.addEventListener('blur', () => {
            this._isFocused = false;
            console.log('[WebSpeechAdapter] 💤 窗口失去焦点');
        });
    }

    /**
     * 尝试重启语音识别
     * @private
     */
    _tryRestartRecognition() {
        if (!this._shouldRestart || !this._pendingRestart) {
            return;
        }

        // 检查页面状态
        if (!this._isPageVisible || !this._isFocused) {
            console.log('[WebSpeechAdapter] ⏳ 等待页面恢复焦点后重启...');
            return;
        }

        console.log('[WebSpeechAdapter] 🔄 恢复语音识别...');
        this._pendingRestart = false;

        setTimeout(() => {
            if (this._shouldRestart && this._recognition) {
                try {
                    this._recognition.start();
                } catch (e) {
                    console.warn('[WebSpeechAdapter] 恢复失败:', e.message);
                    // 标记为待恢复，下次焦点时再试
                    this._pendingRestart = true;
                }
            }
        }, 200);
    }

    /**
     * 获取引擎名称
     */
    getName() {
        return 'WebSpeechAPI';
    }

    /**
     * 检查浏览器是否支持
     */
    isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    /**
     * 初始化 SpeechRecognition 实例
     * @private
     */
    _initRecognition() {
        if (this._recognition) {
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            throw new Error('当前浏览器不支持 Web Speech API');
        }

        this._recognition = new SpeechRecognition();

        // 配置
        this._recognition.lang = this.options.lang;
        this._recognition.continuous = this.options.continuous;
        this._recognition.interimResults = this.options.interimResults;
        this._recognition.maxAlternatives = this.options.maxAlternatives;

        // 绑定事件
        this._recognition.onstart = () => this._handleStart();
        this._recognition.onend = () => this._handleEnd();
        this._recognition.onresult = (event) => this._handleResult(event);
        this._recognition.onerror = (event) => this._handleError(event);
        this._recognition.onspeechstart = () => this._handleSpeechStart();
        this._recognition.onspeechend = () => this._handleSpeechEnd();
    }

    /**
     * 开始语音识别
     */
    async start() {
        if (!this.isSupported()) {
            throw new Error('当前浏览器不支持 Web Speech API');
        }

        this._initRecognition();

        // 更新语言设置（可能在初始化后被修改）
        this._recognition.lang = this.options.lang;

        this._shouldRestart = true;
        this._lastResultIndex = 0;

        try {
            this._recognition.start();
            console.log(`[WebSpeechAdapter] 🎤 开始识别，语言: ${this.options.lang}`);
        } catch (e) {
            // 可能已经在运行
            if (e.name !== 'InvalidStateError') {
                throw e;
            }
        }
    }

    /**
     * 停止语音识别（等待最终结果）
     */
    async stop() {
        this._shouldRestart = false;
        if (this._recognition) {
            this._recognition.stop();
            console.log('[WebSpeechAdapter] ⏹️ 停止识别');
        }
    }

    /**
     * 中断语音识别（立即停止）
     */
    async abort() {
        this._shouldRestart = false;
        if (this._recognition) {
            this._recognition.abort();
            console.log('[WebSpeechAdapter] ⏹️ 中断识别');
        }
    }

    // ==================== 事件处理 ====================

    /**
     * 处理开始事件
     * @private
     */
    _handleStart() {
        console.log('[WebSpeechAdapter] 🎙️ 识别已开始');
        this._emitStateChange('listening');
    }

    /**
     * 处理结束事件
     * @private
     */
    _handleEnd() {
        console.log('[WebSpeechAdapter] 🔇 识别已结束');

        // 在持续模式下自动重启
        if (this._shouldRestart && this.options.autoRestart && this.options.continuous) {
            // 检查页面状态 - 如果失去焦点，标记为待恢复
            if (!this._isPageVisible || !this._isFocused) {
                console.log('[WebSpeechAdapter] ⏸️ 页面不在前台，标记待恢复...');
                this._pendingRestart = true;
                // 不改变状态，保持 listening 状态显示
                return;
            }

            console.log('[WebSpeechAdapter] 🔄 自动重启识别...');
            setTimeout(() => {
                if (this._shouldRestart) {
                    try {
                        this._recognition.start();
                    } catch (e) {
                        console.warn('[WebSpeechAdapter] 重启失败:', e.message);
                        // 可能是因为失去焦点导致的，标记待恢复
                        this._pendingRestart = true;
                    }
                }
            }, 100);
        } else {
            this._emitStateChange('stopped');
        }
    }

    /**
     * 处理识别结果
     * @private
     */
    _handleResult(event) {
        // 遍历新的结果
        for (let i = this._lastResultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            const isFinal = result.isFinal;

            // 更新索引
            if (isFinal) {
                this._lastResultIndex = i + 1;
            }

            // 触发事件
            this._emitResult(transcript, isFinal);

            if (isFinal) {
                console.log(`[WebSpeechAdapter] ✅ 最终结果: "${transcript}"`);
            } else {
                console.log(`[WebSpeechAdapter] 📝 中间结果: "${transcript}"`);
            }
        }
    }

    /**
     * 处理错误
     * @private
     */
    _handleError(event) {
        const errorMap = {
            'no-speech': '未检测到语音',
            'audio-capture': '无法捕获音频，请检查麦克风',
            'not-allowed': '麦克风权限被拒绝',
            'network': '网络错误',
            'aborted': '识别被中断',
            'language-not-supported': '不支持的语言'
        };

        const message = errorMap[event.error] || `识别错误: ${event.error}`;

        // no-speech 不算真正的错误，只是没检测到语音
        if (event.error === 'no-speech') {
            console.log('[WebSpeechAdapter] 😶 未检测到语音');
            return;
        }

        // aborted 是主动中断，不需要报错
        if (event.error === 'aborted') {
            return;
        }

        this._emitError(new Error(message));
        this._emitStateChange('error');
    }

    /**
     * 处理语音开始
     * @private
     */
    _handleSpeechStart() {
        console.log('[WebSpeechAdapter] 🗣️ 检测到语音');
    }

    /**
     * 处理语音结束
     * @private
     */
    _handleSpeechEnd() {
        console.log('[WebSpeechAdapter] 🤫 语音结束');
    }
}
