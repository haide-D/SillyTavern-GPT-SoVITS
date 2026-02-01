/**
 * 场景分析器
 * 
 * 职责:
 * - 分析场景变化
 * - 检测角色离场/位置变化
 * - 调用 LLM 进行场景理解
 * - 更新角色状态
 */

import { LLM_Client } from './llm_client.js';
import { CharacterStateManager } from './character_state_manager.js';
import { ContextDataCollector } from './context_data_collector.js';

export class SceneAnalyzer {
    constructor(stateManager) {
        this.stateManager = stateManager;

        // 分析配置
        this.config = {
            enabled: true,
            frequency: 'every_message',  // 'every_message' | 'on_state_change'
            llm_config: null  // 从配置中获取
        };

        console.log('[SceneAnalyzer] 🔍 初始化场景分析器');
    }

    /**
     * 启用/禁用分析器
     * 
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.config.enabled = enabled;
        console.log(`[SceneAnalyzer] ${enabled ? '✅ 启用' : '⏸️ 禁用'}分析器`);
    }

    /**
     * 设置分析频率
     * 
     * @param {string} frequency - 'every_message' | 'on_state_change'
     */
    setFrequency(frequency) {
        this.config.frequency = frequency;
        console.log(`[SceneAnalyzer] 📊 设置分析频率: ${frequency}`);
    }

    /**
     * 分析最新消息
     * 
     * 自动检测场景变化并更新状态
     */
    async analyzeLatestMessage() {
        if (!this.config.enabled) {
            console.log('[SceneAnalyzer] ⏭️ 分析器已禁用,跳过');
            return;
        }

        try {
            console.log('[SceneAnalyzer] 🔍 开始分析最新消息...');

            // 获取上下文数据
            const contextData = await ContextDataCollector.collectContextData();
            if (!contextData) {
                console.warn('[SceneAnalyzer] ⚠️ 无法获取上下文数据,跳过分析');
                return;
            }

            const { context, char_name, speakers } = contextData;

            // 构建分析提示词
            const prompt = this.buildAnalysisPrompt(context, speakers);

            // 调用 LLM 分析
            const llmResponse = await this.callLLMForAnalysis(prompt);

            // 解析 LLM 响应
            const analysisResult = this.parseLLMResponse(llmResponse);

            // 更新状态
            this.updateStatesFromAnalysis(analysisResult);

            console.log('[SceneAnalyzer] ✅ 场景分析完成:', analysisResult);

        } catch (error) {
            console.error('[SceneAnalyzer] ❌ 场景分析失败:', error);
        }
    }

    /**
     * 构建分析提示词
     * 
     * @param {Array} context - 上下文消息
     * @param {Array} speakers - 说话人列表
     * @returns {string} - LLM 提示词
     */
    buildAnalysisPrompt(context, speakers) {
        // 提取最近3条消息
        const recentMessages = context.slice(-3);

        const conversationText = recentMessages
            .map(msg => `${msg.name}: ${msg.mes}`)
            .join('\n');

        const prompt = `
分析以下对话,判断各角色的状态变化:

对话:
${conversationText}

已知角色: ${speakers.join(', ')}

请分析:
1. 哪些角色离开了现场? (离场)
2. 哪些角色来到了现场? (到场)
3. 角色们现在在哪里? (位置)

以 JSON 格式回复:
{
  "角色名": {
    "present": true/false,
    "location": "位置描述",
    "changed": true/false
  }
}
`.trim();

        return prompt;
    }

    /**
     * 调用 LLM 进行分析
     * 
     * @param {string} prompt - 提示词
     * @returns {Promise<string>} - LLM 响应
     */
    async callLLMForAnalysis(prompt) {
        // 获取 LLM 配置
        const llmConfig = this.getLLMConfig();

        console.log('[SceneAnalyzer] 🤖 调用 LLM 进行场景分析...');

        const llmResponse = await LLM_Client.callLLM({
            api_url: llmConfig.api_url,
            api_key: llmConfig.api_key,
            model: llmConfig.model,
            temperature: 0.3,  // 使用较低温度,提高准确性
            max_tokens: 500,
            prompt: prompt
        });

        return llmResponse;
    }

    /**
     * 解析 LLM 响应
     * 
     * @param {string} llmResponse - LLM 响应
     * @returns {Object} - 解析结果
     */
    parseLLMResponse(llmResponse) {
        try {
            // 尝试提取 JSON
            const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[SceneAnalyzer] ⚠️ LLM 响应中未找到 JSON,使用空对象');
                return {};
            }

            const json = JSON.parse(jsonMatch[0]);
            return json;

        } catch (error) {
            console.error('[SceneAnalyzer] ❌ 解析 LLM 响应失败:', error);
            console.error('[SceneAnalyzer] LLM 原始响应:', llmResponse);
            return {};
        }
    }

    /**
     * 根据分析结果更新状态
     * 
     * @param {Object} analysisResult - 分析结果
     */
    updateStatesFromAnalysis(analysisResult) {
        Object.entries(analysisResult).forEach(([charName, state]) => {
            if (!state.changed) {
                // 状态未变化,跳过
                return;
            }

            const updates = {
                present: state.present,
                location: state.location || '未知',
                lastSeen: state.present ? Date.now() : (this.stateManager.getState(charName)?.lastSeen || Date.now()),
                canCall: !state.present && state.location !== '未知'  // 离场且位置已知时可以打电话
            };

            this.stateManager.updateState(charName, updates);

            console.log(`[SceneAnalyzer] 🔄 更新状态: ${charName}`, updates);
        });
    }

    /**
     * 获取 LLM 配置
     * 
     * @returns {Object} - LLM 配置
     */
    getLLMConfig() {
        // 从 TTS_State.CACHE.settings.phone_call.llm 获取配置
        if (window.TTS_State?.CACHE?.settings?.phone_call?.llm) {
            const llmConfig = window.TTS_State.CACHE.settings.phone_call.llm;
            console.log('[SceneAnalyzer] 📝 使用配置的 LLM 设置:', llmConfig);
            return llmConfig;
        }

        // 没有配置时报错，提示用户去配置
        const errorMsg = '❌ 未找到 LLM 配置，请在 TTS 管理面板中配置 LLM API';
        console.error('[SceneAnalyzer]', errorMsg);

        // 使用 toastr 显示错误提示
        if (window.toastr) {
            window.toastr.error(errorMsg, 'LLM 配置缺失', {
                timeOut: 10000,
                extendedTimeOut: 5000,
                closeButton: true
            });
        }

        throw new Error(errorMsg);
    }
}

export default SceneAnalyzer;
