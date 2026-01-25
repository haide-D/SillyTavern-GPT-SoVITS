/**
 * 语音识别模块
 * 
 * 提供实时语音转文字（STT）功能。
 * 
 * 导出：
 * - STTManager: 统一管理器（推荐使用）
 * - BaseSTTAdapter: 适配器基类（用于扩展）
 * - WebSpeechAdapter: Web Speech API 适配器
 * 
 * 快速开始：
 * ```javascript
 * import { STTManager } from './speech_recognition/index.js';
 * 
 * const stt = new STTManager({ lang: 'zh-CN' });
 * 
 * stt.onResult((text, isFinal) => {
 *     if (isFinal) {
 *         sendMessage(text);
 *     } else {
 *         inputBox.value = text;
 *     }
 * });
 * 
 * stt.start();
 * ```
 */

// 管理器
export { STTManager } from './stt_manager.js';

// 适配器
export { BaseSTTAdapter } from './adapters/base_adapter.js';
export { WebSpeechAdapter } from './adapters/web_speech_adapter.js';
