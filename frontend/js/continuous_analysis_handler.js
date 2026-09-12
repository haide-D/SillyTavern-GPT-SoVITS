/**
 * 持续性分析处理器
 * 
 * 职责:
 * - 接收后端的continuous_analysis_request消息
 * - 调用LLM进行角色状态分析
 * - 将LLM响应回传给后端
 */

import { LLMRequestCoordinator } from './llm_request_coordinator.js';
import { LLM_Client } from './llm_client.js';
import { getAuthHeaders } from './mobile_apps/shared/utils.js';

export class ContinuousAnalysisHandler {
    constructor() {
        console.log('[ContinuousAnalysisHandler] 初始化完成');
    }

    /**
     * 处理持续性分析请求
     * 
     * @param {Object} message - WebSocket消息
     * @param {string} message.type - 'continuous_analysis_request'
     * @param {string} message.chat_branch - 对话分支ID
     * @param {number} message.floor - 楼层数
     * @param {string} message.context_fingerprint - 上下文指纹
     * @param {Array} message.speakers - 说话人
     * @param {string} message.prompt - LLM Prompt
     */
    async handle(message) {
        const {
            chat_branch,
            floor,
            context_fingerprint,
            speakers,
            user_name,
            char_name,
            prompt,
            llm_config
        } = message;

        console.log(`[ContinuousAnalysisHandler] 📊 开始分析楼层 ${floor}`);

        // 检查 LLM 配置是否完整
        if (!llm_config?.api_url || !llm_config?.api_key || !llm_config?.model) {
            console.error('[ContinuousAnalysisHandler] ❌ 分析 LLM 配置不完整！');
            console.error('请在 system_settings.json 的 analysis_llm 中配置 api_url, api_key, model');
            return;
        }

        // ✅ 采集当前对话上下文（用于 eavesdrop prompt 构建）
        let context = Array.isArray(message.context) ? message.context : [];
        try {
            const stContext = window.SillyTavern?.getContext?.();
            if (!Array.isArray(message.context) && stContext?.chat) {
                const charInfo = {
                    charName: stContext.characters?.find(c => c.avatar === stContext.characterId)?.name || stContext.name2,
                    userName: stContext.name1
                };
                // 提取最近的对话消息
                context = stContext.chat.slice(-20).map(msg => ({
                    name: msg.name || (msg.is_user ? charInfo.userName : charInfo.charName),
                    is_user: msg.is_user || false,
                    mes: msg.mes || ""
                }));
                console.log(`[ContinuousAnalysisHandler] 📜 采集到 ${context.length} 条对话上下文`);
            }
        } catch (e) {
            console.warn('[ContinuousAnalysisHandler] ⚠️ 采集对话上下文失败:', e);
        }

        try {
            // 调用LLM分析 - 使用LLM_Client而不是LLMRequestCoordinator
            const llmResponse = await LLM_Client.callLLM({
                api_url: llm_config.api_url,
                api_key: llm_config.api_key,
                model: llm_config.model,
                prompt: prompt,
                temperature: llm_config.temperature || 0.8,
                max_tokens: llm_config.max_tokens || 2000,
                max_retries: llm_config.max_retries || 5
            });

            console.log('[ContinuousAnalysisHandler] ✅ LLM分析完成');

            // 回传结果到后端（包含对话上下文）
            await this.sendResultToBackend({
                chat_branch,
                floor,
                context_fingerprint,
                speakers,
                user_name,
                char_name,
                character_persona: message.character_persona || "",
                world_info: message.world_info || "",
                context,  // ✅ 新增: 传递对话上下文给后端
                llm_response: llmResponse
            });

        } catch (error) {
            console.error('[ContinuousAnalysisHandler] ❌ 分析失败:', error);

            const retries = llm_config?.max_retries || 5;
            const notifyMsg = error.message?.includes('已重试') || error.message?.includes('均失败')
                ? `📊 分析模型调用失败: ${error.message}`
                : `📊 分析模型调用失败: API 已重试 ${retries} 次均失败 (${error.message})`;

            // 弹出用户可见的 Toastr 错误通知
            if (window.toastr && typeof window.toastr.error === 'function') {
                window.toastr.error(notifyMsg, '分析模型异常', { timeOut: 8000 });
            }

            // ✅ 通知后端失败，并附带原始响应数据
            await this.sendResultToBackend({
                chat_branch,
                floor,
                context_fingerprint,
                speakers,
                user_name,
                char_name,
                character_persona: message.character_persona || "",
                world_info: message.world_info || "",
                context,  // ✅ 即使失败也传递上下文
                llm_response: null,
                error: error.message,
                raw_response: error.rawResponse ? JSON.stringify(error.rawResponse) : null  // ✅ 发送原始响应
            });
        }
    }

    /**
     * 将LLM分析结果发送回后端
     */
    async sendResultToBackend(data) {
        try {
            // 从全局配置获取后端地址
            const apiUrl = window.TTS_State?.CACHE?.API_URL || 'http://127.0.0.1:3000';
            const backendUrl = `${apiUrl}/api/continuous_analysis/complete`;


            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: getAuthHeaders({
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`后端响应错误: ${response.status}`);
            }

            const result = await response.json();
            console.log('[ContinuousAnalysisHandler] ✅ 结果已发送到后端:', result);

        } catch (error) {
            console.error('[ContinuousAnalysisHandler] ❌ 发送结果失败:', error);
        }
    }
}


export default ContinuousAnalysisHandler;
