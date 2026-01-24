/**
 * 流式音频播放器
 * 
 * 使用 Web Audio API 实现边下载边播放：
 * 1. 解析 WAV 头部获取格式信息
 * 2. 收到足够的 PCM 数据后立即开始播放
 * 3. 持续接收新数据并追加到播放队列
 */

import { WavParser } from './wav_parser.js';

export class StreamingPlayer {
    constructor() {
        this.audioContext = null;
        this.wavParser = new WavParser();

        // 播放状态
        this.isPlaying = false;
        this.isStopped = false;

        // 音频缓冲区
        this.pendingChunks = [];
        this.headerBuffer = null;
        this.totalPCMData = [];

        // 播放队列
        this.playQueue = [];
        this.currentSource = null;
        this.nextStartTime = 0;

        // 配置
        this.minBufferSize = 4096; // 最小缓冲区大小（字节）
        this.chunkDuration = 0.1;  // 每个播放块的时长（秒）
    }

    /**
     * 初始化 AudioContext
     */
    async init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // 确保 AudioContext 处于运行状态
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        console.log(`[StreamingPlayer] ✅ AudioContext 初始化完成, 状态: ${this.audioContext.state}`);
        return this;
    }

    /**
     * 开始新的流式播放会话（完全重置，清空队列）
     */
    startSession() {
        this.stop();
        this._resetSegment();
        this.playQueue = [];
        this.nextStartTime = 0;
        console.log('[StreamingPlayer] 🎬 新会话开始');
    }

    /**
     * 开始新的音频段（保留播放队列，用于多段语音顺序播放）
     */
    startNewSegment() {
        this._resetSegment();
        console.log('[StreamingPlayer] ▶️ 新音频段开始');
    }

    /**
     * 重置当前段的状态（不清空播放队列）
     */
    _resetSegment() {
        this.wavParser.reset();
        this.pendingChunks = [];
        this.headerBuffer = null;
        this.totalPCMData = [];
        this.isPlaying = false;
        this.isStopped = false;
    }

    /**
     * 接收流式数据块
     * @param {Uint8Array} chunk - 音频数据块
     * @param {Function} onFirstPlay - 首次播放回调
     */
    async feedChunk(chunk, onFirstPlay = null) {
        if (this.isStopped) return;

        // 如果头部还没解析，先收集头部数据
        if (!this.wavParser.isHeaderParsed) {
            if (!this.headerBuffer) {
                this.headerBuffer = chunk;
            } else {
                // 合并数据
                const newBuffer = new Uint8Array(this.headerBuffer.length + chunk.length);
                newBuffer.set(this.headerBuffer);
                newBuffer.set(chunk, this.headerBuffer.length);
                this.headerBuffer = newBuffer;
            }

            // 尝试解析头部（至少需要 44 字节）
            if (this.headerBuffer.length >= 44) {
                const header = this.wavParser.parseHeader(this.headerBuffer);
                if (header) {
                    console.log(`[StreamingPlayer] 📋 WAV 头部解析成功: ${header.sampleRate}Hz, ${header.bitsPerSample}bit, ${header.numChannels}ch`);

                    // 提取已有的 PCM 数据
                    if (this.headerBuffer.length > this.wavParser.dataOffset) {
                        const pcmChunk = this.headerBuffer.slice(this.wavParser.dataOffset);
                        this._processPCM(pcmChunk, onFirstPlay);
                    }
                }
            }
        } else {
            // 头部已解析，直接处理 PCM 数据
            this._processPCM(chunk, onFirstPlay);
        }
    }

    /**
     * 处理 PCM 数据
     */
    _processPCM(pcmData, onFirstPlay) {
        if (this.isStopped) return;

        // 如果还没开始播放，先累积数据
        if (!this.isPlaying) {
            this.totalPCMData.push(pcmData);

            // 计算总缓冲区大小
            const totalSize = this.totalPCMData.reduce((sum, arr) => sum + arr.length, 0);

            // 达到最小缓冲区大小，开始播放
            if (totalSize >= this.minBufferSize) {
                this._startPlayback(onFirstPlay);
            }
        } else {
            // 已经在播放，直接调度播放（不累积）
            this._scheduleChunk(pcmData);
        }
    }

    /**
     * 开始播放
     */
    _startPlayback(onFirstPlay) {
        if (!this.audioContext || !this.wavParser.isHeaderParsed) return;

        this.isPlaying = true;
        // 只有当 nextStartTime 已过期时才更新，否则保持原值让新音频排队
        if (this.nextStartTime < this.audioContext.currentTime) {
            this.nextStartTime = this.audioContext.currentTime;
        }

        console.log('[StreamingPlayer] 🎵 开始播放');

        // 合并所有待播放数据
        const totalSize = this.totalPCMData.reduce((sum, arr) => sum + arr.length, 0);
        const combined = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of this.totalPCMData) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        this.totalPCMData = [];

        // 转换为 Float32Array 并播放
        const samples = this.wavParser.extractPCM(combined, true);
        this._playBuffer(samples);

        if (onFirstPlay) {
            onFirstPlay();
        }
    }

    /**
     * 调度新的音频块
     */
    _scheduleChunk(pcmData) {
        const samples = this.wavParser.extractPCM(pcmData, true);
        if (samples.length > 0) {
            this._playBuffer(samples);
        }
    }

    /**
     * 播放 Float32Array 音频数据
     */
    _playBuffer(samples) {
        if (!this.audioContext || samples.length === 0 || this.isStopped) return;

        const header = this.wavParser.getHeader();
        const sampleRate = header.sampleRate;
        const numChannels = header.numChannels;
        const samplesPerChannel = Math.floor(samples.length / numChannels);

        // 创建 AudioBuffer
        const buffer = this.audioContext.createBuffer(numChannels, samplesPerChannel, sampleRate);

        // 填充各声道数据
        for (let channel = 0; channel < numChannels; channel++) {
            const channelData = buffer.getChannelData(channel);
            for (let i = 0; i < samplesPerChannel; i++) {
                channelData[i] = samples[i * numChannels + channel];
            }
        }

        // 创建 BufferSource 并播放
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);

        // 计算开始时间，确保连续播放
        const startTime = Math.max(this.nextStartTime, this.audioContext.currentTime);
        source.start(startTime);

        // 更新下一个块的开始时间
        this.nextStartTime = startTime + buffer.duration;

        // 保存当前 source 引用用于停止
        this.currentSource = source;
        this.playQueue.push(source);

        // 清理已播放完成的 source
        source.onended = () => {
            const index = this.playQueue.indexOf(source);
            if (index > -1) {
                this.playQueue.splice(index, 1);
            }
        };
    }

    /**
     * 结束流式会话（刷新剩余数据）
     */
    endSession() {
        // 播放剩余的缓冲数据
        if (this.totalPCMData.length > 0 && this.wavParser.isHeaderParsed) {
            const totalSize = this.totalPCMData.reduce((sum, arr) => sum + arr.length, 0);
            const combined = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of this.totalPCMData) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }
            const samples = this.wavParser.extractPCM(combined, true);
            this._playBuffer(samples);
            this.totalPCMData = [];
        }

        console.log('[StreamingPlayer] 🏁 会话结束');
    }

    /**
     * 停止播放
     */
    stop() {
        this.isStopped = true;

        // 停止所有正在播放的 source
        for (const source of this.playQueue) {
            try {
                source.stop();
            } catch (e) {
                // 忽略已停止的 source
            }
        }
        this.playQueue = [];
        this.isPlaying = false;

        console.log('[StreamingPlayer] ⏹️ 已停止');
    }

    /**
     * 获取当前播放状态
     */
    getState() {
        return {
            isPlaying: this.isPlaying,
            isStopped: this.isStopped,
            queueLength: this.playQueue.length,
            audioContextState: this.audioContext?.state
        };
    }
}
