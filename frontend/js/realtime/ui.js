/**
 * 实时对话 UI 组件
 * 
 * 职责：
 * 1. 渲染对话界面（消息列表、输入区域）
 * 2. 处理用户交互事件
 * 3. 更新 UI 状态（波形、字幕等）
 */

export class RealtimeUI {
    constructor(container, options = {}) {
        this.$container = $(container);
        this.options = {
            showAvatar: true,
            ...options
        };

        // DOM 引用
        this.$messages = null;
        this.$input = null;
        this.$sendBtn = null;
        this.$voiceBtn = null;
        this.$interruptBtn = null;
        this.$statusBar = null;

        // 回调
        this._callbacks = {
            onSend: null,
            onVoiceToggle: null,
            onInterrupt: null
        };

        // 当前状态
        this._currentResponse = '';
        this._isReceiving = false;
    }

    /**
     * 渲染完整 UI
     */
    render(characterInfo = {}) {
        const { name = '角色', avatar = null } = characterInfo;

        const html = `
            <div class="realtime-chat">
                <!-- 头部状态栏 -->
                <div class="realtime-header">
                    <div class="realtime-avatar">
                        ${avatar ? `<img src="${avatar}" alt="${name}" onerror="this.style.display='none'">` : ''}
                        <span class="avatar-fallback">${name.charAt(0)}</span>
                    </div>
                    <div class="realtime-info">
                        <div class="realtime-name">${name}</div>
                        <div class="realtime-status" id="realtime-status">准备就绪</div>
                    </div>
                    <div class="realtime-wave" id="realtime-wave" style="display:none;">
                        <span></span><span></span><span></span><span></span><span></span>
                    </div>
                </div>

                <!-- 消息列表 -->
                <div class="realtime-messages" id="realtime-messages"></div>

                <!-- 输入区域 -->
                <div class="realtime-input-area">
                    <button class="realtime-voice-btn" id="realtime-voice-btn" title="语音输入">
                        <span class="mic-icon">🎤</span>
                    </button>
                    <input type="text" 
                           class="realtime-input" 
                           id="realtime-input" 
                           placeholder="输入消息..." 
                           autocomplete="off">
                    <button class="realtime-send-btn" id="realtime-send-btn">发送</button>
                    <button class="realtime-interrupt-btn" id="realtime-interrupt-btn" style="display:none;">
                        ⏹️
                    </button>
                </div>
            </div>
        `;

        this.$container.html(html);
        this._bindElements();
        this._bindEvents();
    }

    /**
     * 绑定 DOM 元素引用
     */
    _bindElements() {
        this.$messages = this.$container.find('#realtime-messages');
        this.$input = this.$container.find('#realtime-input');
        this.$sendBtn = this.$container.find('#realtime-send-btn');
        this.$voiceBtn = this.$container.find('#realtime-voice-btn');
        this.$interruptBtn = this.$container.find('#realtime-interrupt-btn');
        this.$statusBar = this.$container.find('#realtime-status');
        this.$wave = this.$container.find('#realtime-wave');
    }

    /**
     * 绑定事件
     */
    _bindEvents() {
        // 发送按钮
        this.$sendBtn.on('click', () => this._handleSend());

        // 输入框回车
        this.$input.on('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._handleSend();
            }
        });

        // 语音按钮
        this.$voiceBtn.on('click', () => {
            if (this._callbacks.onVoiceToggle) {
                this._callbacks.onVoiceToggle();
            }
        });

        // 打断按钮
        this.$interruptBtn.on('click', () => {
            if (this._callbacks.onInterrupt) {
                this._callbacks.onInterrupt();
            }
        });
    }

    /**
     * 处理发送
     */
    _handleSend() {
        const text = this.$input.val()?.trim();
        if (!text) return;

        this.$input.val('');

        if (this._callbacks.onSend) {
            this._callbacks.onSend(text);
        }
    }

    // ==================== 消息操作 ====================

    /**
     * 添加用户消息
     */
    addUserMessage(text) {
        const $msg = $(`
            <div class="realtime-message user">
                <div class="message-bubble">${this._escapeHtml(text)}</div>
            </div>
        `);
        this.$messages.append($msg);
        this._scrollToBottom();
    }

    /**
     * 开始接收助手消息
     */
    startAssistantMessage() {
        this._currentResponse = '';
        this._isReceiving = true;

        const $msg = $(`
            <div class="realtime-message assistant" id="realtime-current-msg">
                <div class="message-bubble">
                    <span class="typing-indicator">●●●</span>
                </div>
            </div>
        `);
        this.$messages.append($msg);
        this._scrollToBottom();
    }

    /**
     * 追加 token 到当前消息
     */
    appendToken(token) {
        if (!this._isReceiving) {
            this.startAssistantMessage();
        }

        this._currentResponse += token;

        const $bubble = this.$messages.find('#realtime-current-msg .message-bubble');
        $bubble.html(this._formatText(this._currentResponse));
        this._scrollToBottom();
    }

    /**
     * 完成当前消息
     */
    finishAssistantMessage() {
        this._isReceiving = false;
        this.$messages.find('#realtime-current-msg').removeAttr('id');
    }

    /**
     * 加载历史消息
     */
    loadMessages(messages) {
        this.$messages.empty();
        messages.forEach(msg => {
            if (msg.role === 'user') {
                this.addUserMessage(msg.content);
            } else {
                this._currentResponse = msg.content;
                this._isReceiving = true;
                this.startAssistantMessage();
                this.appendToken('');  // 触发渲染
                this.finishAssistantMessage();
            }
        });
    }

    // ==================== 状态更新 ====================

    /**
     * 更新状态文本
     */
    setStatus(text) {
        this.$statusBar.text(text);
    }

    /**
     * 显示/隐藏波形动画
     */
    setWaveActive(active) {
        if (active) {
            this.$wave.show().addClass('active');
        } else {
            this.$wave.removeClass('active').hide();
        }
    }

    /**
     * 设置语音按钮状态
     */
    setVoiceActive(active) {
        this.$voiceBtn.toggleClass('active', active);
        this.$voiceBtn.find('.mic-icon').text(active ? '🔴' : '🎤');
    }

    /**
     * 设置发送/打断按钮状态
     */
    setSpeakingMode(speaking) {
        if (speaking) {
            this.$sendBtn.hide();
            this.$interruptBtn.show();
            this.$input.prop('disabled', true);
        } else {
            this.$sendBtn.show();
            this.$interruptBtn.hide();
            this.$input.prop('disabled', false);
        }
    }

    /**
     * 更新语音识别中间结果
     */
    setInterimText(text) {
        this.$input.val(text);
    }

    /**
     * 禁用语音按钮
     */
    disableVoice() {
        this.$voiceBtn.prop('disabled', true).css('opacity', '0.5');
        this.$voiceBtn.attr('title', '语音输入不可用');
    }

    // ==================== 回调注册 ====================

    onSend(callback) {
        this._callbacks.onSend = callback;
        return this;
    }

    onVoiceToggle(callback) {
        this._callbacks.onVoiceToggle = callback;
        return this;
    }

    onInterrupt(callback) {
        this._callbacks.onInterrupt = callback;
        return this;
    }

    // ==================== 工具方法 ====================

    _scrollToBottom() {
        const el = this.$messages[0];
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    _formatText(text) {
        // 简单的文本格式化（保留换行）
        return this._escapeHtml(text).replace(/\n/g, '<br>');
    }
}

export default RealtimeUI;
