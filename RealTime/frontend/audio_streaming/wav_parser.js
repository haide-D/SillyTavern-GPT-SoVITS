/**
 * WAV 格式解析器
 * 
 * 解析 WAV 文件头部，提取采样率、位深、声道数等信息。
 * 用于流式音频播放时动态解码 PCM 数据。
 */

export class WavParser {
    constructor() {
        this.header = null;
        this.headerSize = 0;
        this.dataOffset = 0;
        this.isHeaderParsed = false;
    }

    /**
     * 解析 WAV 文件头部
     * @param {Uint8Array} data - 包含 WAV 头部的数据
     * @returns {Object|null} 解析结果，失败返回 null
     */
    parseHeader(data) {
        if (data.length < 44) {
            console.warn('[WavParser] 数据太短，无法解析 WAV 头部');
            return null;
        }

        // 检查 RIFF 标识
        const riff = this._readString(data, 0, 4);
        if (riff !== 'RIFF') {
            console.error('[WavParser] 不是有效的 RIFF 文件');
            return null;
        }

        // 检查 WAVE 标识
        const wave = this._readString(data, 8, 4);
        if (wave !== 'WAVE') {
            console.error('[WavParser] 不是有效的 WAVE 文件');
            return null;
        }

        // 查找 fmt chunk
        let offset = 12;
        let fmtChunk = null;
        let dataChunkOffset = 0;

        while (offset < data.length - 8) {
            const chunkId = this._readString(data, offset, 4);
            const chunkSize = this._readUint32LE(data, offset + 4);

            if (chunkId === 'fmt ') {
                fmtChunk = {
                    audioFormat: this._readUint16LE(data, offset + 8),
                    numChannels: this._readUint16LE(data, offset + 10),
                    sampleRate: this._readUint32LE(data, offset + 12),
                    byteRate: this._readUint32LE(data, offset + 16),
                    blockAlign: this._readUint16LE(data, offset + 20),
                    bitsPerSample: this._readUint16LE(data, offset + 22)
                };
            } else if (chunkId === 'data') {
                dataChunkOffset = offset + 8;
                break;
            }

            offset += 8 + chunkSize;
            // 确保偶数对齐
            if (chunkSize % 2 !== 0) offset++;
        }

        if (!fmtChunk) {
            console.error('[WavParser] 未找到 fmt chunk');
            return null;
        }

        if (dataChunkOffset === 0) {
            console.error('[WavParser] 未找到 data chunk');
            return null;
        }

        this.header = {
            ...fmtChunk,
            dataOffset: dataChunkOffset
        };
        this.dataOffset = dataChunkOffset;
        this.headerSize = dataChunkOffset;
        this.isHeaderParsed = true;

        console.log('[WavParser] ✅ 解析成功:', this.header);
        return this.header;
    }

    /**
     * 从 WAV 数据中提取 PCM 样本
     * @param {Uint8Array} data - 完整的 WAV 数据或仅 PCM 数据
     * @param {boolean} rawPCM - 是否是原始 PCM 数据（已去除头部）
     * @returns {Float32Array} 归一化的音频样本（-1 到 1）
     */
    extractPCM(data, rawPCM = false) {
        if (!this.isHeaderParsed) {
            console.error('[WavParser] 请先调用 parseHeader()');
            return new Float32Array(0);
        }

        const pcmData = rawPCM ? data : data.slice(this.dataOffset);
        const bitsPerSample = this.header.bitsPerSample;
        const numChannels = this.header.numChannels;

        // 目前只支持 16 位 PCM
        if (bitsPerSample !== 16) {
            console.warn(`[WavParser] 暂不支持 ${bitsPerSample} 位音频，仅支持 16 位`);
            return new Float32Array(0);
        }

        const numSamples = Math.floor(pcmData.length / 2);
        const samples = new Float32Array(numSamples);

        for (let i = 0; i < numSamples; i++) {
            // 读取 16 位有符号整数（小端序）
            const sample = (pcmData[i * 2 + 1] << 8) | pcmData[i * 2];
            // 转换为有符号数
            const signedSample = sample > 32767 ? sample - 65536 : sample;
            // 归一化到 -1 到 1
            samples[i] = signedSample / 32768;
        }

        return samples;
    }

    /**
     * 获取头部信息
     */
    getHeader() {
        return this.header;
    }

    /**
     * 重置解析器状态
     */
    reset() {
        this.header = null;
        this.headerSize = 0;
        this.dataOffset = 0;
        this.isHeaderParsed = false;
    }

    // ========== 私有方法 ==========

    _readString(data, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(data[offset + i]);
        }
        return str;
    }

    _readUint16LE(data, offset) {
        return data[offset] | (data[offset + 1] << 8);
    }

    _readUint32LE(data, offset) {
        return data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24);
    }
}
