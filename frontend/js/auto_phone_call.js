// static/js/auto_phone_call.js
// 自动电话功能的前端集成模块

import { TTS_State } from './state.js';
import { eventSource, event_types } from '../../../../../../script.js';

export const TTS_AutoPhoneCall = {
    // WebSocket 连接实例
    ws: null,
    // 当前角色名称
    currentCharName: null,
    // 是否已初始化
    initialized: false,

    /**
     * 初始化自动电话功能
     */
    init() {
        if (this.initialized) {
            console.log("⚠️ [AutoPhoneCall] 已经初始化过,跳过");
            return;
        }

        console.log("🚀 [AutoPhoneCall] 开始初始化自动电话功能...");

        // 绑定 SillyTavern 事件监听
        this.bindSillyTavernEvents();

        this.initialized = true;
        console.log("✅ [AutoPhoneCall] 自动电话功能初始化完成");
    },

    /**
     * 绑定 SillyTavern 的消息事件
     */
    bindSillyTavernEvents(retryCount = 0) {
        const MAX_RETRIES = 30; // 最多重试 30 次 (30 秒)

        // 详细的调试信息
        console.log(`🔍 [AutoPhoneCall] 检查 SillyTavern 状态 (重试: ${retryCount}/${MAX_RETRIES})`);
        console.log(`   - window.SillyTavern 存在: ${!!window.SillyTavern}`);
        console.log(`   - eventSource 存在: ${!!eventSource}`);
        console.log(`   - event_types 存在: ${!!event_types}`);

        if (window.SillyTavern) {
            console.log(`   - SillyTavern.getContext 存在: ${!!window.SillyTavern.getContext}`);
        }

        // 检查 SillyTavern 是否已加载
        if (!window.SillyTavern || !window.SillyTavern.getContext || !eventSource || !event_types) {
            if (retryCount >= MAX_RETRIES) {
                console.error("❌ [AutoPhoneCall] SillyTavern 加载超时,已达到最大重试次数");
                console.error("   请检查:");
                console.error("   1. SillyTavern 是否正常启动");
                console.error("   2. 浏览器控制台是否有其他错误");
                console.error("   3. 尝试刷新页面");
                return;
            }

            console.warn(`⚠️ [AutoPhoneCall] SillyTavern 尚未加载,1秒后重试 (${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => this.bindSillyTavernEvents(retryCount + 1), 1000);
            return;
        }

        // ✅ 使用 eventSource.on() 监听事件 (SillyTavern 标准方式)

        // 监听角色消息渲染完成事件 (AI 回复完成)
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            console.log(`📨 [AutoPhoneCall] 检测到角色消息渲染: messageId=${messageId}`);
            this.onCharacterMessageRendered(messageId);
        });

        // 监听聊天切换事件
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log("🔄 [AutoPhoneCall] 聊天已切换");
            this.onChatChanged();
        });

        console.log("✅ [AutoPhoneCall] SillyTavern 事件监听已绑定 (使用 eventSource.on)");
    },

    /**
     * 当角色消息渲染完成时触发
     * @param {number} messageId - 消息 ID
     */
    async onCharacterMessageRendered(messageId) {
        try {
            // 获取 SillyTavern 上下文
            const context = window.SillyTavern.getContext();
            if (!context) {
                console.warn("⚠️ [AutoPhoneCall] 无法获取 SillyTavern 上下文");
                return;
            }

            const { chat, characters, this_chid } = context;

            // 获取当前角色名称
            const charName = characters[this_chid]?.name;
            if (!charName) {
                console.warn("⚠️ [AutoPhoneCall] 无法获取角色名称");
                return;
            }

            // 更新当前角色名称
            if (this.currentCharName !== charName) {
                this.currentCharName = charName;
                // 角色切换时,重新建立 WebSocket 连接
                this.connectWebSocket(charName);
            }

            // 获取 chat_branch
            const chatBranch = this.getCurrentChatBranch();

            // 查询当前对话的所有说话人
            let speakers = [];
            try {
                const result = await window.TTS_API.getSpeakers(chatBranch);
                speakers = result.speakers || [];
                console.log(`📋 [AutoPhoneCall] 查询到 ${speakers.length} 个说话人:`, speakers);
            } catch (error) {
                console.warn("⚠️ [AutoPhoneCall] 查询说话人失败,将使用空列表:", error);
            }

            // 计算当前楼层 (轮次)
            // 楼层 = 消息总数 / 2 (向下取整)
            const currentFloor = Math.floor(chat.length / 2);

            // 提取最近的上下文消息 (最多10条)
            const contextMessages = chat.slice(-10).map(msg => ({
                name: msg.name || (msg.is_user ? context.name1 : charName),
                is_user: msg.is_user || false,
                mes: msg.mes || ""
            }));

            console.log(`📊 [AutoPhoneCall] 当前楼层: ${currentFloor}, 上下文消息数: ${contextMessages.length}, 说话人数: ${speakers.length}`);

            // 发送 webhook 到后端
            await this.sendWebhook(chatBranch, speakers, currentFloor, contextMessages);

        } catch (error) {
            console.error("❌ [AutoPhoneCall] 处理角色消息时出错:", error);
        }
    },

    /**
     * 获取当前对话分支ID
     * @returns {string} chat_branch
     */
    getCurrentChatBranch() {
        try {
            if (window.TTS_Utils && window.TTS_Utils.getCurrentChatBranch) {
                return window.TTS_Utils.getCurrentChatBranch();
            }

            // 回退方案
            const context = window.SillyTavern.getContext();
            if (context && context.chatId) {
                return context.chatId.replace(/\.(jsonl|json)$/i, "");
            }
        } catch (e) {
            console.error("[AutoPhoneCall] 获取 chat_branch 失败:", e);
        }
        return "default";
    },

    /**
     * 当聊天切换时触发
     */
    onChatChanged() {
        // 断开旧的 WebSocket 连接
        this.disconnectWebSocket();

        // 重置当前角色名称
        this.currentCharName = null;
    },


    /**
     * 发送 webhook 到后端
     * @param {string} chatBranch - 对话分支ID
     * @param {Array<string>} speakers - 说话人列表
     * @param {number} floor - 当前楼层
     * @param {Array} context - 上下文消息
     */
    async sendWebhook(chatBranch, speakers, floor, context) {
        try {
            const apiHost = this.getApiHost();
            const response = await fetch(`${apiHost}/api/phone_call/webhook/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_branch: chatBranch,
                    speakers: speakers,
                    current_floor: floor,
                    context: context
                })
            });

            if (response.ok) {
                const data = await response.json();
                console.log("✅ [AutoPhoneCall] Webhook 发送成功:", data);
            } else {
                const error = await response.text();
                console.warn(`⚠️ [AutoPhoneCall] Webhook 发送失败 (${response.status}):`, error);
            }
        } catch (error) {
            console.error("❌ [AutoPhoneCall] 发送 webhook 时出错:", error);
        }
    },

    /**
     * 建立 WebSocket 连接
     * @param {string} charName - 角色名称
     */
    connectWebSocket(charName) {
        // 如果已有连接,先断开
        this.disconnectWebSocket();

        try {
            const apiHost = this.getApiHost();
            // 将 http:// 替换为 ws://
            const wsHost = apiHost.replace(/^http/, 'ws');
            const wsUrl = `${wsHost}/ws/phone_call/${encodeURIComponent(charName)}`;

            console.log(`🔌 [AutoPhoneCall] 正在连接 WebSocket: ${wsUrl}`);

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log(`✅ [AutoPhoneCall] WebSocket 连接成功: ${charName}`);
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log("📬 [AutoPhoneCall] 收到 WebSocket 消息:", data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error("❌ [AutoPhoneCall] 解析 WebSocket 消息失败:", error);
                }
            };

            this.ws.onerror = (error) => {
                console.error("❌ [AutoPhoneCall] WebSocket 错误:", error);
            };

            this.ws.onclose = () => {
                console.log("🔌 [AutoPhoneCall] WebSocket 连接已关闭");
                this.ws = null;
            };

        } catch (error) {
            console.error("❌ [AutoPhoneCall] 建立 WebSocket 连接失败:", error);
        }
    },

    /**
     * 断开 WebSocket 连接
     */
    disconnectWebSocket() {
        if (this.ws) {
            console.log("🔌 [AutoPhoneCall] 正在断开 WebSocket 连接");
            this.ws.close();
            this.ws = null;
        }
    },

    /**
     * 处理 WebSocket 消息
     * @param {Object} data - 消息数据
     */
    handleWebSocketMessage(data) {
        if (data.type === 'phone_call_ready') {
            console.log("📞 [AutoPhoneCall] 自动电话生成完成:", data);
            this.showPhoneCallNotification(data);
        }
    },

    /**
     * 显示电话通知
     * @param {Object} data - 电话数据
     */
    showPhoneCallNotification(data) {
        const { char_name, trigger_floor, audio_path, segments } = data;

        // 使用 TTS_Utils 显示通知
        if (window.TTS_Utils && window.TTS_Utils.showNotification) {
            window.TTS_Utils.showNotification(
                `📞 ${char_name} 在第 ${trigger_floor} 轮给你打电话了!`,
                "success"
            );
        } else {
            // 回退到原生通知
            if (Notification.permission === "granted") {
                new Notification("📞 新电话", {
                    body: `${char_name} 在第 ${trigger_floor} 轮给你打电话了!`,
                    icon: "/img/favicon.png"
                });
            }
        }

        // TODO: 在 UI 中显示电话内容和播放按钮
        // 可以集成到手机端 UI 或者创建一个新的弹窗
        console.log("📞 [AutoPhoneCall] 电话详情:", {
            char_name,
            trigger_floor,
            audio_path,
            segments: JSON.parse(segments || "[]")
        });
    },

    /**
     * 获取 API Host
     * @returns {string} API Host URL
     */
    getApiHost() {
        // 从 TTS_API 获取配置的 API Host
        if (window.TTS_State && window.TTS_State.CACHE && window.TTS_State.CACHE.API_URL) {
            return window.TTS_State.CACHE.API_URL;
        }

        // 回退到默认值
        const apiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? '127.0.0.1'
            : window.location.hostname;

        return `http://${apiHost}:5100`;
    }
};
