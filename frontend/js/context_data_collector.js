/**
 * 上下文数据采集器
 * 
 * 职责:
 * - 采集和处理上下文数据
 * - 计算当前楼层
 * - 提取上下文消息
 * - 生成上下文指纹
 * - 获取说话人列表
 */

import { SpeakerManager } from './speaker_manager.js';
import { PhoneCallAPIClient } from './phone_call_api_client.js';

export class ContextDataCollector {
    // 防重复：记录最后发送的指纹和时间
    static _lastSentFingerprint = null;
    static _lastSentTime = 0;
    static _DEBOUNCE_MS = 500;  // 500ms 内相同指纹不重复发送

    /**
     * 获取当前对话分支ID
     */
    static getCurrentChatBranch() {
        try {
            if (window.TTS_Utils && window.TTS_Utils.getCurrentChatBranch) {
                return window.TTS_Utils.getCurrentChatBranch();
            }

            // 回退方案
            const context = window.SillyTavern?.getContext?.();
            if (context && context.chatId) {
                return context.chatId.replace(/\.(jsonl|json)$/i, "");
            }
        } catch (e) {
            console.error('[ContextDataCollector] 获取 chat_branch 失败:', e);
        }
        return "default";
    }

    /**
     * 获取角色信息
     * 
     * @returns {Object|null} - { charName, userName, characterId }
     */
    static getCharacterInfo() {
        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) {
                console.warn('[ContextDataCollector] ⚠️ 无法获取 SillyTavern 上下文');
                return null;
            }

            const { characters, characterId, name1, name2 } = context;

            // 获取当前角色
            const currentChar = characters?.find(c => c.avatar === characterId);
            const charName = currentChar?.name || name2;

            return {
                charName,
                userName: name1,
                characterId
            };

        } catch (error) {
            console.error('[ContextDataCollector] ❌ 获取角色信息失败:', error);
            return null;
        }
    }

    /**
     * 计算当前楼层 (轮次)
     * 
     * @param {Array} chat - 聊天记录
     * @returns {number} - 当前楼层
     */
    static calculateCurrentFloor(chat) {
        if (!chat || !Array.isArray(chat)) {
            return 0;
        }
        return Math.floor(chat.length / 2);
    }

    /**
     * 提取上下文消息
     * 
     * @param {Array} chat - 聊天记录
     * @param {number} limit - 最多提取多少条消息
     * @returns {Array} - 上下文消息列表
     */
    static extractContextMessages(chat, limit = 10) {
        if (!chat || !Array.isArray(chat)) {
            return [];
        }

        const charInfo = this.getCharacterInfo();
        if (!charInfo) {
            return [];
        }

        const { charName, userName } = charInfo;

        // 获取消息过滤配置
        const CACHE = window.TTS_State?.CACHE;
        const settings = CACHE?.settings || {};
        const msgProcessing = settings.message_processing || {};
        const extractTag = msgProcessing.extract_tag || '';
        const filterTags = msgProcessing.filter_tags || '';

        // 获取过滤函数
        const extractAndFilter = window.TTS_Utils?.extractAndFilter;

        return chat.slice(-limit).map(msg => {
            let content = msg.mes || "";

            // 应用消息过滤（如果配置了且函数可用）
            if ((extractTag || filterTags) && extractAndFilter) {
                content = extractAndFilter(content, extractTag, filterTags);
            }

            return {
                name: msg.name || (msg.is_user ? userName : charName),
                is_user: msg.is_user || false,
                mes: content
            };
        });
    }

    /**
     * 生成上下文指纹
     * 
     * @param {number} floor - 当前楼层
     * @returns {string} - 上下文指纹
     */
    static generateContextFingerprint(floor) {
        try {
            if (window.TTS_Utils && window.TTS_Utils.getCurrentContextFingerprints) {
                const fingerprints = window.TTS_Utils.getCurrentContextFingerprints();

                // 使用最后一条消息的指纹作为触发指纹
                if (fingerprints.length > 0) {
                    const fingerprint = fingerprints[fingerprints.length - 1];
                    console.log(`[ContextDataCollector] 🔐 触发消息指纹: ${fingerprint}`);
                    return fingerprint;
                }
            }

            // 回退:使用楼层作为标识
            const fingerprint = `floor_${floor}`;
            console.log(`[ContextDataCollector] 🔐 使用楼层指纹: ${fingerprint}`);
            return fingerprint;

        } catch (error) {
            console.error('[ContextDataCollector] ❌ 计算指纹失败:', error);
            return `floor_${floor}`;
        }
    }

    /**
     * 获取说话人列表
     * 
     * @param {string} chatBranch - 聊天分支ID
     * @returns {Promise<Array>} - 说话人列表
     */
    static async getSpeakers(chatBranch) {
        try {
            const result = await window.TTS_API.getSpeakers(chatBranch);
            const speakers = result.speakers || [];
            console.log(`[ContextDataCollector] 📋 查询到 ${speakers.length} 个说话人:`, speakers);
            return speakers;
        } catch (error) {
            console.warn('[ContextDataCollector] ⚠️ 查询说话人失败,将使用空列表:', error);
            return [];
        }
    }

    /**
     * 更新说话人列表
     * 
     * @param {Object} context - SillyTavern 上下文
     * @param {string} chatBranch - 聊天分支ID
     */
    static async updateSpeakers(context, chatBranch) {
        try {
            await SpeakerManager.updateSpeakers(context, chatBranch);
        } catch (error) {
            console.warn('[ContextDataCollector] ⚠️ 说话人更新失败:', error);
        }
    }

    /**
     * 采集完整的上下文数据
     * 
     * @returns {Promise<Object|null>} - 上下文数据
     */
    static async collectContextData() {
        try {
            // 获取 SillyTavern 上下文
            const context = window.SillyTavern?.getContext?.();
            if (!context) {
                console.warn('[ContextDataCollector] ⚠️ 无法获取 SillyTavern 上下文');
                return null;
            }

            const { chat } = context;
            const chatBranch = this.getCurrentChatBranch();
            const charInfo = this.getCharacterInfo();

            if (!charInfo) {
                return null;
            }

            // 更新说话人列表 (异步,不阻塞)
            this.updateSpeakers(context, chatBranch).catch(err => {
                console.warn('[ContextDataCollector] ⚠️ 说话人更新失败:', err);
            });

            // 获取说话人
            const speakers = await this.getSpeakers(chatBranch);

            // 计算楼层
            const currentFloor = this.calculateCurrentFloor(chat);

            // 提取上下文消息
            const contextMessages = this.extractContextMessages(chat, 10);

            // 生成指纹
            const contextFingerprint = this.generateContextFingerprint(currentFloor);

            console.log('[ContextDataCollector] 📊 数据采集完成:');
            console.log('  - chat_branch:', chatBranch);
            console.log('  - current_floor:', currentFloor);
            console.log('  - speakers:', speakers);
            console.log('  - context_messages:', contextMessages.length);
            console.log('  - fingerprint:', contextFingerprint);

            return {
                chat_branch: chatBranch,
                speakers: speakers,
                current_floor: currentFloor,
                context: contextMessages,
                context_fingerprint: contextFingerprint,
                user_name: charInfo.userName,
                char_name: charInfo.charName
            };

        } catch (error) {
            console.error('[ContextDataCollector] ❌ 采集上下文数据失败:', error);
            return null;
        }
    }

    /**
     * 采集数据并发送 webhook
     */
    static async collectAndSendWebhook() {
        try {
            const data = await this.collectContextData();
            if (!data) {
                console.warn('[ContextDataCollector] ⚠️ 数据采集失败,跳过 webhook');
                return;
            }

            // 防重复检查：相同指纹在 500ms 内不重复发送
            const now = Date.now();
            if (data.context_fingerprint === this._lastSentFingerprint &&
                (now - this._lastSentTime) < this._DEBOUNCE_MS) {
                console.log(`[ContextDataCollector] ⏭️ 跳过重复 webhook: ${data.context_fingerprint}`);
                return;
            }

            this._lastSentFingerprint = data.context_fingerprint;
            this._lastSentTime = now;

            await PhoneCallAPIClient.sendWebhook(data);

        } catch (error) {
            console.error('[ContextDataCollector] ❌ 发送 webhook 失败:', error);
        }
    }
}

export default ContextDataCollector;
