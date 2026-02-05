/**
 * 共享音频播放器模块
 * 提供带字幕同步的音频播放功能
 */

import { SubtitleRenderer } from './subtitle_renderer.js';
import { formatTime, formatDuration, resolveAudioUrl } from './utils.js';

/**
 * 音频播放器类
 * 封装音频播放、进度更新、字幕同步等功能
 */
export class AudioPlayer {
    /**
     * @param {Object} options - 配置选项
     * @param {jQuery} options.$container - 播放器容器
     * @param {Array} options.segments - 音频句段数据
     * @param {boolean} options.showSpeaker - 是否显示说话人
     * @param {Function} options.onEnd - 播放结束回调
     * @param {Function} options.onError - 错误回调
     */
    constructor(options = {}) {
        this.$container = options.$container;
        this.segments = options.segments || [];
        this.showSpeaker = options.showSpeaker || false;
        this.onEnd = options.onEnd || (() => { });
        this.onError = options.onError || ((err) => console.error('[AudioPlayer] 错误:', err));

        // 内部状态
        this.audio = null;
        this.durationInterval = null;
        this.startTime = null;
        this.subtitleRenderer = null;

        // 缓存 DOM 元素
        this.$progressFill = this.$container.find('.progress-bar-fill');
        this.$currentTime = this.$container.find('.current-time');
        this.$totalTime = this.$container.find('.total-time');
        this.$duration = this.$container.find('.call-duration, .listening-duration');

        // 初始化字幕渲染器
        const $subtitleArea = this.$container.find('.call-subtitle-area, .listening-subtitle-area');
        if ($subtitleArea.length) {
            this.subtitleRenderer = new SubtitleRenderer({
                $container: $subtitleArea,
                showSpeaker: this.showSpeaker
            });
        }
    }

    /**
     * 播放音频
     * @param {string} audioUrl - 音频 URL
     */
    play(audioUrl) {
        const fullUrl = resolveAudioUrl(audioUrl);
        if (!fullUrl) {
            this.onError(new Error('无效的音频 URL'));
            this.onEnd();
            return;
        }

        console.log('[AudioPlayer] 播放音频:', fullUrl);

        this.audio = new Audio(fullUrl);
        this.startTime = Date.now();

        // 开始计时
        this._startDurationTimer();

        // 绑定事件
        this.audio.addEventListener('loadedmetadata', () => this._onLoadedMetadata());
        this.audio.addEventListener('timeupdate', () => this._onTimeUpdate());
        this.audio.addEventListener('ended', () => this._onEnded());
        this.audio.addEventListener('error', (e) => this._onAudioError(e));

        // 播放
        this.audio.play().catch(err => {
            console.error('[AudioPlayer] 播放失败:', err);
            alert('音频播放失败: ' + err.message);
            this.cleanup();
            this.onEnd();
        });
    }

    /**
     * 暂停播放
     */
    pause() {
        if (this.audio) {
            this.audio.pause();
        }
    }

    /**
     * 停止播放
     */
    stop() {
        this.cleanup();
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.audio) {
            this.audio.pause();
            this.audio.currentTime = 0;
            this.audio = null;
        }

        if (this.durationInterval) {
            clearInterval(this.durationInterval);
            this.durationInterval = null;
        }

        if (this.subtitleRenderer) {
            this.subtitleRenderer.clear();
        }
    }

    /**
     * 销毁播放器
     */
    destroy() {
        this.cleanup();
        if (this.subtitleRenderer) {
            this.subtitleRenderer.destroy();
            this.subtitleRenderer = null;
        }
        this.$container = null;
    }

    // ==================== 私有方法 ====================

    /**
     * 开始播放时长计时器
     * @private
     */
    _startDurationTimer() {
        this.durationInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            this.$duration.text(formatDuration(elapsed));
        }, 1000);
    }

    /**
     * 音频元数据加载完成
     * @private
     */
    _onLoadedMetadata() {
        const duration = this.audio.duration;
        this.$totalTime.text(formatTime(duration));
    }

    /**
     * 音频播放进度更新
     * @private
     */
    _onTimeUpdate() {
        const currentTime = this.audio.currentTime;
        const duration = this.audio.duration;

        // 更新进度条
        const progress = (currentTime / duration) * 100;
        this.$progressFill.css('width', progress + '%');

        // 更新当前时间
        this.$currentTime.text(formatTime(currentTime));

        // 字幕同步
        this._syncSubtitle(currentTime);
    }

    /**
     * 同步字幕
     * @private
     */
    _syncSubtitle(currentTime) {
        if (!this.subtitleRenderer || !this.segments.length) return;

        let activeIndex = -1;
        let charProgress = 0;

        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const segStart = seg.start_time || 0;
            const segDuration = seg.audio_duration || 0;
            const segEnd = segStart + segDuration;

            if (currentTime >= segStart && currentTime < segEnd) {
                activeIndex = i;
                // 添加0.5秒补偿让字幕提前
                const compensatedTime = currentTime + 0.5;
                const adjustedProgress = (compensatedTime - segStart) / segDuration;
                charProgress = segDuration > 0 ? Math.min(1, Math.max(0, adjustedProgress)) : 0;
                break;
            }
        }

        if (activeIndex >= 0) {
            this.subtitleRenderer.update(this.segments[activeIndex], activeIndex, charProgress);
        } else {
            this.subtitleRenderer.clear();
        }
    }

    /**
     * 音频播放结束
     * @private
     */
    _onEnded() {
        console.log('[AudioPlayer] 播放结束');
        this.cleanup();
        this.onEnd();
    }

    /**
     * 音频错误处理
     * @private
     */
    _onAudioError(e) {
        console.error('[AudioPlayer] 音频错误:', e);
        this.onError(e);
        this.cleanup();
        this.onEnd();
    }
}

// 导出全局音频管理器（用于外部控制）
let globalAudioPlayer = null;

/**
 * 设置全局播放器实例
 * @param {AudioPlayer} player - 播放器实例
 */
export function setGlobalPlayer(player) {
    // 先清理之前的播放器
    if (globalAudioPlayer) {
        globalAudioPlayer.cleanup();
    }
    globalAudioPlayer = player;
}

/**
 * 获取全局播放器实例
 * @returns {AudioPlayer|null}
 */
export function getGlobalPlayer() {
    return globalAudioPlayer;
}

/**
 * 清理全局播放器
 */
export function cleanupGlobalPlayer() {
    if (globalAudioPlayer) {
        globalAudioPlayer.cleanup();
        globalAudioPlayer = null;
    }
}
