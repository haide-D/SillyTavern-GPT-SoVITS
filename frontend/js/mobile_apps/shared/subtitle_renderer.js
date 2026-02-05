/**
 * 字幕渲染器模块
 * 提供 Apple Music 风格的逐字高亮字幕显示
 */

/**
 * 字幕渲染器类
 */
export class SubtitleRenderer {
    /**
     * @param {Object} options - 配置选项
     * @param {jQuery} options.$container - 字幕容器（包含 .subtitle-line 和 .subtitle-text）
     * @param {boolean} options.showSpeaker - 是否显示说话人（用于多人对话）
     */
    constructor(options = {}) {
        this.$container = options.$container;
        this.showSpeaker = options.showSpeaker || false;

        // 缓存 DOM 元素
        this.$subtitleLine = this.$container.find('.subtitle-line');
        this.$subtitleText = this.$container.find('.subtitle-text');
        this.$subtitleSpeaker = this.$container.find('.subtitle-speaker');

        // 状态
        this.currentSegmentIndex = -1;
    }

    /**
     * 更新字幕显示
     * @param {Object} segment - 当前句段数据 { text, translation, speaker }
     * @param {number} segmentIndex - 句段索引
     * @param {number} charProgress - 字符进度 (0-1)
     */
    update(segment, segmentIndex, charProgress) {
        if (!segment) {
            this.clear();
            return;
        }

        const text = segment.translation || segment.text || '';
        const speaker = segment.speaker || '';

        // 切换到新句子
        if (segmentIndex !== this.currentSegmentIndex) {
            this.currentSegmentIndex = segmentIndex;

            // 显示说话人（如果启用）
            if (this.showSpeaker && this.$subtitleSpeaker.length) {
                if (speaker) {
                    this.$subtitleSpeaker.text(speaker).show();
                } else {
                    this.$subtitleSpeaker.hide();
                }
            }

            // 将句子拆分为单个字符
            const chars = text.split('').map((char, i) =>
                `<span class="subtitle-char" data-index="${i}">${char}</span>`
            ).join('');

            this.$subtitleText.html(chars);

            // 触发显示动画
            this.$subtitleLine.removeClass('visible');
            setTimeout(() => this.$subtitleLine.addClass('visible'), 50);
        }

        // 更新逐字高亮
        this._updateCharHighlight(text.length, charProgress);
    }

    /**
     * 更新字符高亮状态
     * @private
     */
    _updateCharHighlight(totalChars, charProgress) {
        const activeCharIndex = Math.floor(charProgress * totalChars);
        let $activeChar = null;

        this.$subtitleText.find('.subtitle-char').each(function (index) {
            const $char = $(this);
            $char.removeClass('passed active');

            if (index < activeCharIndex) {
                $char.addClass('passed');
            } else if (index === activeCharIndex) {
                $char.addClass('active');
                $activeChar = $char;
            }
        });

        // 自动滚动到当前高亮字符
        if ($activeChar && $activeChar.length) {
            this._scrollToActiveChar($activeChar[0]);
        }
    }

    /**
     * 滚动到当前高亮字符
     * @private
     */
    _scrollToActiveChar(charElement) {
        // $container 本身就是滚动容器 (.call-subtitle-area 或 .listening-subtitle-area)
        const scrollContainer = this.$container[0];
        if (!scrollContainer || !charElement) return;

        // 计算字符相对于滚动容器的位置
        const containerRect = scrollContainer.getBoundingClientRect();
        const charRect = charElement.getBoundingClientRect();

        // 如果字符在容器可视区域外，滚动到字符位置
        const charTop = charRect.top - containerRect.top + scrollContainer.scrollTop;
        const charBottom = charTop + charRect.height;
        const visibleTop = scrollContainer.scrollTop;
        const visibleBottom = visibleTop + scrollContainer.clientHeight;

        if (charTop < visibleTop || charBottom > visibleBottom) {
            // 平滑滚动到字符位置（居中显示）
            scrollContainer.scrollTo({
                top: charTop - (scrollContainer.clientHeight / 2) + (charRect.height / 2),
                behavior: 'smooth'
            });
        }
    }

    /**
     * 清除字幕显示
     */
    clear() {
        this.$subtitleLine.removeClass('visible');
        if (this.$subtitleSpeaker.length) {
            this.$subtitleSpeaker.hide();
        }
        this.currentSegmentIndex = -1;
    }

    /**
     * 销毁渲染器
     */
    destroy() {
        this.clear();
        this.$container = null;
        this.$subtitleLine = null;
        this.$subtitleText = null;
        this.$subtitleSpeaker = null;
    }
}
