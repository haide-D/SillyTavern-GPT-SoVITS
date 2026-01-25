/**
 * 音频队列管理器 - 管理音频播放队列
 * 
 * 功能：
 * 1. 维护音频播放队列
 * 2. 顺序播放音频
 * 3. 支持清空队列（打断）
 */

export class AudioQueue {
    constructor() {
        this.queue = [];
        this.isPlaying = false;
        this.audio = new Audio();
        this._currentUrl = null;

        this.audio.onended = () => {
            console.log('[AudioQueue] 播放结束');
            this._cleanup();
            this._playNext();
        };

        this.audio.onerror = (e) => {
            console.error('[AudioQueue] 播放错误:', e);
            this._cleanup();
            this._playNext();
        };

        // 添加更多事件监听用于调试
        this.audio.onloadstart = () => {
            console.log('[AudioQueue] 开始加载');
        };

        this.audio.onloadedmetadata = () => {
            console.log('[AudioQueue] 元数据已加载, duration:', this.audio.duration);
        };

        this.audio.oncanplay = () => {
            console.log('[AudioQueue] 可以播放');
        };
    }

    /**
     * 清理当前 URL
     * @private
     */
    _cleanup() {
        if (this._currentUrl) {
            URL.revokeObjectURL(this._currentUrl);
            this._currentUrl = null;
        }
    }

    /**
     * 添加音频到队列
     * @param {Blob} audioBlob - 音频 Blob 数据
     */
    add(audioBlob) {
        console.log('[AudioQueue] 添加音频到队列, size:', audioBlob.size, 'bytes');
        this.queue.push(audioBlob);

        if (!this.isPlaying) {
            this._playNext();
        }
    }

    /**
     * 清空队列
     */
    clear() {
        this.queue = [];
        this.audio.pause();
        this._cleanup();
        this.isPlaying = false;
        console.log('[AudioQueue] 队列已清空');
    }

    /**
     * 播放下一个音频
     * @private
     */
    _playNext() {
        if (this.queue.length === 0) {
            this.isPlaying = false;
            console.log('[AudioQueue] 队列空，停止播放');
            return;
        }

        const blob = this.queue.shift();
        console.log('[AudioQueue] 开始播放, 剩余队列:', this.queue.length);

        this._cleanup();
        this._currentUrl = URL.createObjectURL(blob);
        this.audio.src = this._currentUrl;
        this.isPlaying = true;

        this.audio.play().catch(e => {
            console.error('[AudioQueue] 播放失败:', e);
            this._playNext();
        });
    }
}
