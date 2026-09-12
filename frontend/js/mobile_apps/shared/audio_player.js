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
     * @param {Object|string} options - 配置选项或音频 URL
     * @param {jQuery} [options.$container] - 播放器容器
     * @param {string} [options.audioUrl] - 音频 URL
     * @param {Array} [options.segments] - 音频句段数据
     * @param {boolean} [options.showSpeaker] - 是否显示说话人
     * @param {Function} [options.onEnd] - 播放结束回调
     * @param {Function} [options.onError] - 错误回调
     */
    constructor(options = {}) {
        if (typeof options === 'string') {
            options = { audioUrl: options };
        }

        this.audioUrl = options.audioUrl || null;
        this.$container = options.$container || null;
        this.segments = options.segments || [];
        this.showSpeaker = options.showSpeaker || false;
        this.onEnd = options.onEnd || (() => { });
        this.onError = options.onError || ((err) => console.error('[AudioPlayer] 错误:', err));
        this._eventListeners = {};

        // 内部状态
        this.audio = null;
        this.durationInterval = null;
        this.startTime = null;
        this.subtitleRenderer = null;
        this._isPlaying = false;

        // 安全缓存 DOM 元素（仅在 $container 有效时）
        if (this.$container && typeof this.$container.find === 'function') {
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
        } else {
            this.$progressFill = null;
            this.$currentTime = null;
            this.$totalTime = null;
            this.$duration = null;
        }
    }

    /**
     * 判断当前是否处于播放中
     * @returns {boolean}
     */
    isPlaying() {
        return !!(this.audio && !this.audio.paused && !this.audio.ended && this.audio.readyState > 2);
    }

    /**
     * 事件监听注册
     * @param {string} event - 事件名 (ended, play, pause, timeupdate 等)
     * @param {Function} callback
     */
    on(event, callback) {
        if (typeof callback !== 'function') return this;
        if (!this._eventListeners[event]) {
            this._eventListeners[event] = [];
        }
        this._eventListeners[event].push(callback);
        return this;
    }

    /**
     * 触发内部事件
     * @param {string} event
     * @param  {...any} args
     */
    emit(event, ...args) {
        if (this._eventListeners[event]) {
            this._eventListeners[event].forEach(cb => {
                try {
                    cb(...args);
                } catch (e) {
                    console.error(`[AudioPlayer] 事件 ${event} 回调异常:`, e);
                }
            });
        }
    }

    /**
     * 播放音频
     * @param {string} [audioUrl] - 可选的音频 URL，缺省时使用构造时传入的 audioUrl
     */
    play(audioUrl) {
        const targetUrl = audioUrl || this.audioUrl;
        const fullUrl = resolveAudioUrl(targetUrl);
        if (!fullUrl) {
            this.onError(new Error('无效的音频 URL'));
            this.emit('ended');
            this.onEnd();
            return;
        }

        console.log('[AudioPlayer] 播放音频:', fullUrl);

        // 如果已有 audio 且 url 相同且仅是暂停，则直接继续播放
        if (this.audio && this.audio.src === fullUrl && this.audio.paused) {
            this.audio.play().then(() => {
                this._isPlaying = true;
                this.emit('play');
            }).catch(err => {
                console.error('[AudioPlayer] 恢复播放失败:', err);
                this.onError(err);
            });
            return;
        }

        this.cleanup();
        this.audio = new Audio(fullUrl);
        this.startTime = Date.now();

        // 开始计时
        this._startDurationTimer();

        // 绑定事件
        this.audio.addEventListener('loadedmetadata', () => this._onLoadedMetadata());
        this.audio.addEventListener('timeupdate', () => this._onTimeUpdate());
        this.audio.addEventListener('playing', () => this._startSubtitleClock());
        this.audio.addEventListener('pause', () => this._stopSubtitleClock());
        this.audio.addEventListener('waiting', () => this._stopSubtitleClock());
        this.audio.addEventListener('seeked', () => this._onTimeUpdate());
        this.audio.addEventListener('ended', () => this._onEnded());
        this.audio.addEventListener('error', (e) => this._onAudioError(e));

        // 播放
        this.audio.play().then(() => {
            this._isPlaying = true;
            this.emit('play');
        }).catch(err => {
            console.error('[AudioPlayer] 播放失败:', err);
            if (window.toastr && typeof window.toastr.error === 'function') {
                window.toastr.error(`音频播放失败: ${err.message || '资源无法访问'}`);
            }
            this.onError(err);
            this.cleanup();
            this.emit('ended');
            this.onEnd();
        });
    }

    /**
     * 暂停播放
     */
    pause() {
        if (this.audio) {
            this.audio.pause();
            this._isPlaying = false;
            this.emit('pause');
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
        this._stopSubtitleClock();
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
        if (!this.$duration || !this.$duration.length) return;
        this.durationInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            if (this.$duration && this.$duration.length) {
                this.$duration.text(formatDuration(elapsed));
            }
        }, 1000);
    }

    /**
     * 音频元数据加载完成
     * @private
     */
    _onLoadedMetadata() {
        if (!this.audio) return;
        const duration = this.audio.duration;
        if (this.$totalTime && this.$totalTime.length) {
            this.$totalTime.text(formatTime(duration));
        }
    }

    /**
     * 音频播放进度更新
     * @private
     */
    _onTimeUpdate() {
        if (!this.audio) return;
        const currentTime = this.audio.currentTime;
        const duration = this.audio.duration;

        // 更新进度条
        if (this.$progressFill && this.$progressFill.length && duration) {
            const progress = (currentTime / duration) * 100;
            this.$progressFill.css('width', progress + '%');
        }

        // 更新当前时间
        if (this.$currentTime && this.$currentTime.length) {
            this.$currentTime.text(formatTime(currentTime));
        }

        // 触发外部进度更新事件
        this.emit('timeupdate', currentTime, duration);

        // 字幕同步
        this._syncSubtitle(currentTime);
    }

    /**
     * 同步字幕与说话人切换
     * @private
     */
    _startSubtitleClock() {
        this._stopSubtitleClock();
        const tick = () => {
            if (!this.audio || this.audio.paused || this.audio.ended) return;
            this._syncSubtitle(this.audio.currentTime);
            this._subtitleFrame = requestAnimationFrame(tick);
        };
        tick();
    }

    _stopSubtitleClock() {
        if (this._subtitleFrame != null) cancelAnimationFrame(this._subtitleFrame);
        this._subtitleFrame = null;
    }

    _syncSubtitle(currentTime) {
        if (!this.segments || !this.segments.length) return;

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
            const currentSeg = this.segments[activeIndex];
            if (this.subtitleRenderer) {
                this.subtitleRenderer.update(currentSeg, activeIndex, charProgress);
            }

            if (this._lastSegmentIndex !== activeIndex) {
                this._lastSegmentIndex = activeIndex;
                const speaker = currentSeg.speaker || '';
                this.emit('segment_change', { segment: currentSeg, index: activeIndex });
                if (this._lastSpeaker !== speaker) {
                    this._lastSpeaker = speaker;
                    this.emit('speaker_change', { speaker, segment: currentSeg, index: activeIndex });
                }
            }
        } else {
            if (this.subtitleRenderer) {
                this.subtitleRenderer.clear();
            }
        }
    }

    /**
     * 音频播放结束
     * @private
     */
    _onEnded() {
        console.log('[AudioPlayer] 播放结束');
        this._isPlaying = false;
        this.emit('ended');
        this.cleanup();
        this.onEnd();
    }

    /**
     * 音频错误处理
     * @private
     */
    _onAudioError(e) {
        console.error('[AudioPlayer] 音频加载/播放错误:', e);
        if (window.toastr && typeof window.toastr.error === 'function') {
            window.toastr.error('音频文件加载失败 (资源 404 或格式不支持)');
        }
        this._isPlaying = false;
        this.onError(e);
        this.emit('error', e);
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

// 挂载到全局，供外部动态加载的主题使用，避免相对路径导入导致的 404 错误
if (typeof window !== 'undefined') {
    window.TTS_Audio = {
        AudioPlayer,
        setGlobalPlayer,
        getGlobalPlayer,
        cleanupGlobalPlayer
    };
}
