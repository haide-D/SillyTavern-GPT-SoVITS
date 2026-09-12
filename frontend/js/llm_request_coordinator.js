/**
 * LLM 请求协调器
 * 
 * 职责:
 * - 处理来自后端的 LLM 请求
 * - 调用 LLM 客户端
 * - 将结果返回后端
 * - 统一错误处理
 */

import { LLM_Client } from './llm_client.js';
import { PhoneCallAPIClient } from './phone_call_api_client.js';

// ✅ 用于去重的记录ID集合
const _processingCallIds = new Set();
const _processedCallIds = new Set();
const _processingEavesdropIds = new Set();
const _processedEavesdropIds = new Set();
const MAX_PROCESSED_IDS = 100;  // 最多保留的已处理ID数量

export class LLMRequestCoordinator {
    /**
     * 处理 LLM 生成请求
     * 
     * @param {Object} data - LLM 请求数据
     * @param {string} data.call_id - 来电ID
     * @param {string} data.char_name - 角色名
     * @param {string} data.prompt - 提示词
     * @param {Object} data.llm_config - LLM 配置
     * @param {Array} data.speakers - 说话人列表
     * @param {string} data.chat_branch - 聊天分支ID
     */
    static async handleLLMRequest(data) {
        console.log('[LLMRequestCoordinator] 📥 收到 LLM 请求:', data);

        const { call_id, char_name, caller, prompt, llm_config, speakers, chat_branch } = data;
        const requestKey = `${chat_branch}:${call_id}`;
        if (_processingCallIds.has(requestKey) || _processedCallIds.has(requestKey)) return;
        _processingCallIds.add(requestKey);

        try {
            // 显示通知: 使用 caller（实际打电话的人），回退到 speakers[0] 或 char_name
            const displayName = caller || (speakers && speakers[0]) || char_name;
            this.showNotification(`正在为 ${displayName} 生成主动电话...`);

            // 调用 LLM
            console.log('[LLMRequestCoordinator] 🤖 调用 LLM...');
            const llmResponse = await LLM_Client.callLLM({
                api_url: llm_config.api_url,
                api_key: llm_config.api_key,
                model: llm_config.model,
                temperature: llm_config.temperature,
                max_tokens: llm_config.max_tokens,
                max_retries: llm_config.max_retries || 5,
                prompt: prompt
            });

            console.log('[LLMRequestCoordinator] ✅ LLM 响应成功, 长度:', llmResponse.length);
            console.log('[LLMRequestCoordinator] LLM 响应内容 (前500字符):', llmResponse.substring(0, 500));

            // 将结果发送回后端
            await PhoneCallAPIClient.completeGeneration({
                call_id: call_id,
                llm_response: llmResponse,
                chat_branch: chat_branch,
                speakers: speakers,
                char_name: char_name
            });
            _processedCallIds.add(requestKey);
            if (_processedCallIds.size > MAX_PROCESSED_IDS) _processedCallIds.delete(_processedCallIds.values().next().value);

        } catch (error) {
            console.error('[LLMRequestCoordinator] ❌ 处理失败:', error);

            // 上报错误
            await PhoneCallAPIClient.logError({
                error_type: 'llm_request_error',
                error_message: error.message,
                error_stack: error.stack,
                call_id: call_id,
                char_name: char_name,
                llm_config: llm_config,
                raw_llm_response: error.rawResponse
            });

            const retries = llm_config?.max_retries || 5;
            const notifyMsg = error.message?.includes('已重试') || error.message?.includes('均失败')
                ? `📞 电话生成失败: ${error.message}`
                : `📞 电话生成失败: API 已重试 ${retries} 次均失败 (${error.message})`;

            this.showNotification(notifyMsg, 'error');
        } finally {
            _processingCallIds.delete(requestKey);
        }
    }

    /**
     * 处理场景分析 LLM 请求
     * 
     * @param {Object} data - 场景分析请求数据
     */
    static async handleSceneAnalysis(data) {
        console.log('[LLMRequestCoordinator] 🔍 收到场景分析 LLM 请求:', data);

        const { request_id, char_name, prompt, llm_config, speakers, chat_branch,
            trigger_floor, context_fingerprint, context, user_name } = data;

        try {
            console.log('[LLMRequestCoordinator] 🤖 调用 LLM 进行场景分析...');
            const llmResponse = await LLM_Client.callLLM({
                api_url: llm_config.api_url,
                api_key: llm_config.api_key,
                model: llm_config.model,
                temperature: llm_config.temperature,
                max_tokens: llm_config.max_tokens,
                max_retries: llm_config.max_retries || 5,
                prompt: prompt
            });

            console.log('[LLMRequestCoordinator] ✅ 场景分析 LLM 响应成功, 长度:', llmResponse.length);
            console.log('[LLMRequestCoordinator] 场景分析结果:', llmResponse.substring(0, 300));

            // 将结果发送回后端
            await PhoneCallAPIClient.completeSceneAnalysis({
                request_id: request_id,
                llm_response: llmResponse,
                chat_branch: chat_branch,
                speakers: speakers,
                trigger_floor: trigger_floor,
                context_fingerprint: context_fingerprint,
                context: context,
                char_name: char_name,
                user_name: user_name
            });

        } catch (error) {
            console.error('[LLMRequestCoordinator] ❌ 场景分析处理失败:', error);

            // 上报错误
            await PhoneCallAPIClient.logError({
                error_type: 'scene_analysis_error',
                error_message: error.message,
                error_stack: error.stack,
                request_id: request_id,
                char_name: char_name,
                llm_config: llm_config
            });

            const retries = llm_config?.max_retries || 5;
            const notifyMsg = error.message?.includes('已重试') || error.message?.includes('均失败')
                ? `🔍 场景分析失败: ${error.message}`
                : `🔍 场景分析失败: API 已重试 ${retries} 次均失败 (${error.message})`;

            this.showNotification(notifyMsg, 'error');
        }
    }

    /**
     * 处理对话追踪 LLM 请求
     * 
     * @param {Object} data - 对话追踪请求数据
     */
    static async handleEavesdrop(data) {
        console.log('[LLMRequestCoordinator] 🎧 收到对话追踪 LLM 请求:', data);

        const { record_id, char_name, prompt, llm_config, speakers, chat_branch, scene_description, text_lang } = data;

        // ✅ 去重检查：防止同一个 record_id 被处理多次
        if (_processingEavesdropIds.has(record_id) || _processedEavesdropIds.has(record_id)) {
            console.warn(`[LLMRequestCoordinator] ⚠️ record_id=${record_id} 已在处理中或已处理，跳过重复请求`);
            return;
        }

        // 标记为正在处理
        _processingEavesdropIds.add(record_id);

        try {
            // 显示通知
            this.showNotification(`正在生成 ${speakers.join(' 和 ')} 的私下对话...`);

            // 调用 LLM
            console.log('[LLMRequestCoordinator] 🤖 调用 LLM (对话追踪)...');
            const llmResponse = await LLM_Client.callLLM({
                api_url: llm_config.api_url,
                api_key: llm_config.api_key,
                model: llm_config.model,
                temperature: llm_config.temperature,
                max_tokens: llm_config.max_tokens,
                max_retries: llm_config.max_retries || 5,
                prompt: prompt
            });

            console.log('[LLMRequestCoordinator] ✅ LLM 响应成功 (对话追踪), 长度:', llmResponse.length);

            // 将结果发送回后端 (包含 text_lang 配置)
            await PhoneCallAPIClient.completeEavesdrop({
                record_id: record_id,
                llm_response: llmResponse,
                chat_branch: chat_branch,
                speakers: speakers,
                char_name: char_name,
                text_lang: text_lang || 'zh'
            });

        } catch (error) {
            console.error('[LLMRequestCoordinator] ❌ 对话追踪处理失败:', error);

            // 上报错误
            await PhoneCallAPIClient.logError({
                error_type: 'eavesdrop_error',
                error_message: error.message,
                error_stack: error.stack,
                record_id: record_id,
                char_name: char_name,
                llm_config: llm_config
            });

            const retries = llm_config?.max_retries || 5;
            const notifyMsg = error.message?.includes('已重试') || error.message?.includes('均失败')
                ? `🎧 对话追踪生成失败: ${error.message}`
                : `🎧 对话追踪生成失败: API 已重试 ${retries} 次均失败 (${error.message})`;

            this.showNotification(notifyMsg, 'error');
        } finally {
            // ✅ 清理处理中状态，标记为已处理
            _processingEavesdropIds.delete(record_id);
            _processedEavesdropIds.add(record_id);

            // 限制已处理ID集合大小
            if (_processedEavesdropIds.size > MAX_PROCESSED_IDS) {
                const firstId = _processedEavesdropIds.values().next().value;
                _processedEavesdropIds.delete(firstId);
            }
        }
    }

    /**
     * 显示通知
     * 
     * @param {string} message - 消息内容
     * @param {string} type - 消息类型 (info/success/error)
     */
    static showNotification(message, type = 'info') {
        console.log(`[LLMRequestCoordinator] [${type}] ${message}`);

        // 如果有 toastr,使用它
        if (window.toastr) {
            window.toastr[type](message);
        }

        // 触发自定义事件
        if (window.TTS_Events && window.TTS_Events.emit) {
            window.TTS_Events.emit('llm_coordinator_notification', {
                message: message,
                type: type
            });
        }
    }
}

export default LLMRequestCoordinator;
