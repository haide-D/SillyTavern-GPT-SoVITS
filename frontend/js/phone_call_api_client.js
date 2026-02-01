/**
 * 电话功能 API 客户端
 * 
 * 职责:
 * - 封装所有后端 API 调用
 * - 统一错误处理
 * - 自动获取 API Host
 */

export class PhoneCallAPIClient {
    /**
     * 获取 API Host
     */
    static getApiHost() {
        // 从 TTS_State 获取配置的 API Host
        if (window.TTS_State && window.TTS_State.CACHE && window.TTS_State.CACHE.API_URL) {
            return window.TTS_State.CACHE.API_URL;
        }

        // 回退到默认值
        const apiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? '127.0.0.1'
            : window.location.hostname;

        return `http://${apiHost}:3000`;
    }

    /**
     * 发送 webhook 到后端
     * 
     * @param {Object} data - Webhook 数据
     * @param {string} data.chat_branch - 聊天分支ID
     * @param {Array} data.speakers - 说话人列表
     * @param {number} data.current_floor - 当前楼层
     * @param {Array} data.context - 上下文消息
     * @param {string} data.context_fingerprint - 上下文指纹
     * @param {string} data.user_name - 用户名
     * @param {string} data.char_name - 主角色名
     */
    static async sendWebhook(data) {
        try {
            const apiHost = this.getApiHost();

            console.log('[PhoneCallAPIClient] 📤 发送 Webhook:');
            console.log('  - URL:', `${apiHost}/api/phone_call/webhook/message`);
            console.log('  - 数据:', data);

            const response = await fetch(`${apiHost}/api/phone_call/webhook/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const result = await response.json();
            console.log('[PhoneCallAPIClient] ✅ Webhook 发送成功:', result);
            return result;

        } catch (error) {
            console.error('[PhoneCallAPIClient] ❌ 发送 webhook 失败:', error);
            throw error;
        }
    }

    /**
     * 完成 LLM 生成
     * 
     * @param {Object} data - 生成数据
     * @param {string} data.call_id - 来电ID
     * @param {string} data.llm_response - LLM响应
     * @param {string} data.chat_branch - 聊天分支ID
     * @param {Array} data.speakers - 说话人列表
     * @param {string} data.char_name - 主角色名
     */
    static async completeGeneration(data) {
        try {
            const apiHost = this.getApiHost();

            console.log('[PhoneCallAPIClient] 📤 发送生成结果到后端...');
            console.log('  - call_id:', data.call_id);
            console.log('  - llm_response 长度:', data.llm_response?.length || 0);

            const response = await fetch(`${apiHost}/api/phone_call/complete_generation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const result = await response.json();
            console.log('[PhoneCallAPIClient] ✅ 生成完成:', result);
            return result;

        } catch (error) {
            console.error('[PhoneCallAPIClient] ❌ 完成生成失败:', error);
            throw error;
        }
    }

    /**
     * 完成场景分析
     * 
     * @param {Object} data - 场景分析数据
     * @param {string} data.request_id - 请求ID
     * @param {string} data.llm_response - LLM响应
     * @param {string} data.chat_branch - 聊天分支ID
     * @param {Array} data.speakers - 说话人列表
     * @param {number} data.trigger_floor - 触发楼层
     * @param {string} data.context_fingerprint - 上下文指纹
     * @param {Array} data.context - 上下文消息
     * @param {string} data.char_name - 主角色名
     * @param {string} data.user_name - 用户名
     */
    static async completeSceneAnalysis(data) {
        try {
            const apiHost = this.getApiHost();

            console.log('[PhoneCallAPIClient] 📤 发送场景分析结果到后端...');

            const response = await fetch(`${apiHost}/api/scene_analysis/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const result = await response.json();
            console.log('[PhoneCallAPIClient] ✅ 场景分析完成:', result);
            return result;

        } catch (error) {
            console.error('[PhoneCallAPIClient] ❌ 场景分析失败:', error);
            throw error;
        }
    }

    /**
     * 完成对话追踪生成
     * 
     * @param {Object} data - 对话追踪数据
     * @param {string} data.record_id - 记录ID
     * @param {string} data.llm_response - LLM响应
     * @param {string} data.chat_branch - 聊天分支ID
     * @param {Array} data.speakers - 说话人列表
     * @param {string} data.char_name - 主角色名
     */
    static async completeEavesdrop(data) {
        try {
            const apiHost = this.getApiHost();

            console.log('[PhoneCallAPIClient] 📤 发送对话追踪结果到后端...');

            const response = await fetch(`${apiHost}/api/eavesdrop/complete_generation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const result = await response.json();
            console.log('[PhoneCallAPIClient] ✅ 对话追踪生成完成:', result);
            return result;

        } catch (error) {
            console.error('[PhoneCallAPIClient] ❌ 对话追踪生成失败:', error);
            throw error;
        }
    }

    /**
     * 上报错误到后端
     * 
     * @param {Object} errorReport - 错误报告
     * @param {string} errorReport.error_type - 错误类型
     * @param {string} errorReport.error_message - 错误消息
     * @param {string} errorReport.error_stack - 错误堆栈
     * @param {string} errorReport.call_id - 来电ID (可选)
     * @param {string} errorReport.char_name - 角色名 (可选)
     * @param {Object} errorReport.llm_config - LLM配置 (可选)
     * @param {string} errorReport.raw_llm_response - 原始LLM响应 (可选)
     */
    static async logError(errorReport) {
        try {
            const apiHost = this.getApiHost();

            // 添加时间戳
            const report = {
                ...errorReport,
                timestamp: new Date().toISOString()
            };

            console.log('[PhoneCallAPIClient] 📤 发送错误报告到后端...');

            // 异步发送,不阻塞主流程,也不抛出错误
            fetch(`${apiHost}/api/phone_call/log_error`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(report)
            }).catch(err => {
                console.warn('[PhoneCallAPIClient] ⚠️ 发送错误报告失败:', err);
            });

        } catch (error) {
            console.warn('[PhoneCallAPIClient] ⚠️ 生成错误报告失败:', error);
        }
    }

    /**
     * 触发主动来电 (用于触发器系统)
     * 
     * @param {string} charName - 角色名
     * @param {Object} options - 可选参数
     * @param {string} options.reason - 来电理由
     */
    static async triggerAutoCall(charName, options = {}) {
        try {
            const apiHost = this.getApiHost();

            console.log('[PhoneCallAPIClient] 📞 触发主动来电:', charName, options);

            const response = await fetch(`${apiHost}/api/phone_call/trigger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    char_name: charName,
                    ...options
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const result = await response.json();
            console.log('[PhoneCallAPIClient] ✅ 主动来电已触发:', result);
            return result;

        } catch (error) {
            console.error('[PhoneCallAPIClient] ❌ 触发主动来电失败:', error);
            throw error;
        }
    }
}

export default PhoneCallAPIClient;
