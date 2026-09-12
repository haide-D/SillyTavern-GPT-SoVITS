/**
 * CallQueueManager - 前端通话与密谈待听队列管理器
 * 
 * 职责:
 * 1. 管理连续生成或被动接收的多个通话/密谈任务
 * 2. 维护未听待播队列 (Pending Queue)
 * 3. 驱动 UI 悬浮球的未听数量角标与动效
 * 4. 支持连续收听 (Sequential Listening - 播完自动/手动切下一条)
 */

export class CallQueueManager {
    static _queue = [];
    static _currentActiveItem = null;
    static _listeners = [];

    /**
     * 将新的通话或密谈放入待听队列
     * @param {Object} item 
     * @param {'phone_call' | 'eavesdrop'} item.type
     * @param {string|number} item.id
     * @param {string} item.title
     * @param {Array} item.speakers
     * @param {string} item.audio_url
     * @param {Array} item.segments
     */
    static enqueue(item) {
        if (!item || (!item.id && !item.call_id && !item.record_id)) return;
        const itemId = item.id || item.call_id || item.record_id;
        const itemType = item.type || (item.record_id ? 'eavesdrop' : 'phone_call');

        // 去重判断
        const exists = this._queue.find(q => q.id === itemId && q.type === itemType);
        if (exists) {
            console.log(`[CallQueueManager] ⚠️ 任务已在待听队列中: [${itemType}] ${itemId}`);
            return;
        }

        const caller = item.selected_speaker || item.char_name || item.caller || item.callerName
            || item.speakers?.filter(Boolean).join(' & ') || item.segments?.find(seg => seg.speaker)?.speaker || '未知角色';
        const queueItem = {
            ...item,
            char_name: caller,
            selected_speaker: item.selected_speaker || caller,
            call_id: item.call_id || (itemType === 'phone_call' ? itemId : undefined),
            id: itemId,
            type: itemType,
            caller,
            speakers: item.speakers?.filter(Boolean).length ? item.speakers.filter(Boolean) : [caller],
            avatar_url: item.avatar_url || null,
            audio_url: item.audio_url,
            audio_path: item.audio_path,
            segments: item.segments || [],
            scene_description: item.scene_description || '',
            notification_text: item.notification_text || '',
            call_reason: item.call_reason || '',
            preset_id: item.preset_id || '',
            target_user: item.target_user || '',
            timestamp: Date.now(),
            rawData: item
        };

        this._queue.push(queueItem);
        console.log(`[CallQueueManager] 📥 新增待听任务: [${queueItem.type}] ${queueItem.caller}, 当前队列深度: ${this._queue.length}`);

        // 同步挂载到全局变量供各主题与场景向下兼容读取
        if (!this._currentActiveItem) {
            this._currentActiveItem = queueItem;
            this._syncLegacyGlobals(queueItem);
        }

        this._updateBadgeUI();
        this._emit('enqueue', queueItem);
        this._emit('change', { queue: this._queue, current: this._currentActiveItem });
    }

    /**
     * 获取当前活动（正在收听或即将接听）的条目
     */
    static getCurrent() {
        if (!this._currentActiveItem && this._queue.length > 0) {
            this._currentActiveItem = this._queue[0];
            this._syncLegacyGlobals(this._currentActiveItem);
        }
        return this._currentActiveItem;
    }

    /**
     * 获取队列中剩余的未听条目数
     */
    static getPendingCount() {
        return this._queue.length;
    }

    /**
     * 是否还有下一条待听内容
     */
    static hasNext() {
        return this._queue.length > 1;
    }

    /**
     * 标记当前任务完成/收听完毕，并出队切换到下一条
     * @returns {Object|null} 下一个条目
     */
    static next() {
        if (this._queue.length === 0) {
            this._currentActiveItem = null;
            this._clearLegacyGlobals();
            this._updateBadgeUI();
            return null;
        }

        // 移除队首已完成项
        const finished = this._queue.shift();
        console.log(`[CallQueueManager] ⏭️ 已听完/跳过任务: [${finished.type}] ${finished.caller}, 剩余待听: ${this._queue.length}`);

        if (this._queue.length > 0) {
            this._currentActiveItem = this._queue[0];
            this._syncLegacyGlobals(this._currentActiveItem);
        } else {
            this._currentActiveItem = null;
            this._clearLegacyGlobals();
        }

        this._updateBadgeUI();
        this._emit('next', { finished, nextItem: this._currentActiveItem, remaining: this._queue.length });
        this._emit('change', { queue: this._queue, current: this._currentActiveItem });

        return this._currentActiveItem;
    }

    /**
     * 获取完整待听列表
     */
    static getQueue() {
        return [...this._queue];
    }

    /**
     * 移除指定 ID 的条目
     */
    static removeById(id, type) {
        this._queue = this._queue.filter(q => !(q.id === id && (!type || q.type === type)));
        if (this._currentActiveItem && this._currentActiveItem.id === id) {
            this._currentActiveItem = this._queue.length > 0 ? this._queue[0] : null;
            if (this._currentActiveItem) {
                this._syncLegacyGlobals(this._currentActiveItem);
            } else {
                this._clearLegacyGlobals();
            }
        }
        this._updateBadgeUI();
        this._emit('change', { queue: this._queue, current: this._currentActiveItem });
    }

    /**
     * 清空所有待听任务
     */
    static clear() {
        this._queue = [];
        this._currentActiveItem = null;
        this._clearLegacyGlobals();
        this._updateBadgeUI();
        this._emit('clear', null);
        this._emit('change', { queue: [], current: null });
    }

    /**
     * 订阅队列事件
     */
    static on(event, callback) {
        if (typeof callback === 'function') {
            this._listeners.push({ event, callback });
        }
    }

    static _emit(event, data) {
        for (const listener of this._listeners) {
            if (listener.event === event || listener.event === '*') {
                try {
                    listener.callback(data);
                } catch (e) {
                    console.error('[CallQueueManager] 回调执行异常:', e);
                }
            }
        }
    }

    /**
     * 向下兼容挂载到原有全局对象
     */
    static _syncLegacyGlobals(item) {
        if (!item) {
            this._clearLegacyGlobals();
            return;
        }

        if (item.type === 'phone_call') {
            window.TTS_IncomingCall = item;
            window.TTS_EavesdropData = null;
            window.TTS_EavesdropReady = null;
        } else if (item.type === 'eavesdrop') {
            window.TTS_EavesdropData = item;
            window.TTS_EavesdropReady = window.TTS_EavesdropData;
            window.TTS_IncomingCall = null;
        }
    }

    static _clearLegacyGlobals() {
        window.TTS_IncomingCall = null;
        window.TTS_EavesdropData = null;
        window.TTS_EavesdropReady = null;
    }

    /**
     * 刷新悬浮球上的角标徽章
     */
    static _updateBadgeUI() {
        const count = this._queue.length;
        const targets = ['#tts-manager-btn', '#tts-mobile-trigger'];

        targets.forEach(selector => {
            const $btn = $(selector);
            if (!$btn.length) return;

            let $badge = $btn.find('.tts-call-queue-badge');
            if (count > 0) {
                if (!$badge.length) {
                    $badge = $(`<span class="tts-call-queue-badge"></span>`);
                    $btn.append($badge);
                }
                $badge.text(count > 9 ? '9+' : count).show();
            } else {
                $badge.remove();
            }
        });
    }
}

// 自动向页面注入队列角标 CSS
(function injectQueueBadgeCSS() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('tts-queue-badge-style')) return;
    const style = document.createElement('style');
    style.id = 'tts-queue-badge-style';
    style.textContent = `
        .tts-call-queue-badge {
            position: absolute;
            top: -4px;
            right: -4px;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: #ffffff;
            font-size: 10px;
            font-weight: 700;
            min-width: 16px;
            height: 16px;
            line-height: 16px;
            text-align: center;
            border-radius: 8px;
            padding: 0 4px;
            box-shadow: 0 2px 5px rgba(220, 38, 38, 0.5);
            pointer-events: none;
            z-index: 10001;
            animation: tts-badge-pulse 2s infinite ease-in-out;
        }
        @keyframes tts-badge-pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.18); }
        }
    `;
    document.head.appendChild(style);
})();

// 暴露给全局方便调试与调用
if (typeof window !== 'undefined') {
    window.TTS_CallQueueManager = CallQueueManager;
}
