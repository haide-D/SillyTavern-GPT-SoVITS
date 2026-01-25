/**
 * 文本分段器 - 将流式文本分割成适合 TTS 的片段
 * 
 * 支持两种策略：
 * 1. 按标点分段（句号、问号、感叹号、逗号）
 * 2. 按字数分段（达到最大长度强制分段）
 */

export class TextChunker {
    constructor(options = {}) {
        this.minLength = options.minLength || 5;
        this.maxLength = options.maxLength || 50;
        this.buffer = '';

        // 分段标点
        this.sentenceEndings = /[。！？!?]/;
        this.clauseEndings = /[，,；;：:]/;
    }

    /**
     * 喂入流式文本，返回可发送的片段列表
     * @param {string} text - 新收到的文本片段
     * @returns {string[]} 可发送给 TTS 的片段列表
     */
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

    /**
     * 强制输出缓冲区剩余内容（用于对话结束时）
     * @returns {string|null} 剩余的文本片段
     */
    flush() {
        if (this.buffer.trim()) {
            const result = this.buffer.trim();
            this.buffer = '';
            return result;
        }
        return null;
    }

    /**
     * 清空缓冲区（用于打断对话时）
     */
    clear() {
        this.buffer = '';
    }

    /**
     * 尝试从缓冲区提取一个片段
     * @private
     * @returns {string|null}
     */
    _tryExtract() {
        if (this.buffer.length < this.minLength) {
            return null;
        }

        // 策略1：寻找句子结束符
        const sentenceMatch = this.buffer.match(this.sentenceEndings);
        if (sentenceMatch && sentenceMatch.index >= this.minLength - 1) {
            const endIndex = sentenceMatch.index + 1;
            const chunk = this.buffer.substring(0, endIndex);
            this.buffer = this.buffer.substring(endIndex);
            return chunk.trim();
        }

        // 策略2：达到最大长度，寻找最近的分隔点
        if (this.buffer.length >= this.maxLength) {
            // 先尝试句子结束符
            const textToSearch = this.buffer.substring(0, this.maxLength);
            const sentenceMatch2 = textToSearch.match(this.sentenceEndings);
            if (sentenceMatch2) {
                const endIndex = sentenceMatch2.index + 1;
                const chunk = this.buffer.substring(0, endIndex);
                this.buffer = this.buffer.substring(endIndex);
                return chunk.trim();
            }

            // 再尝试子句结束符
            const clauseMatch = textToSearch.match(this.clauseEndings);
            if (clauseMatch && clauseMatch.index >= this.minLength - 1) {
                const endIndex = clauseMatch.index + 1;
                const chunk = this.buffer.substring(0, endIndex);
                this.buffer = this.buffer.substring(endIndex);
                return chunk.trim();
            }

            // 最后强制分段
            const chunk = this.buffer.substring(0, this.maxLength);
            this.buffer = this.buffer.substring(this.maxLength);
            return chunk.trim();
        }

        return null;
    }
}
