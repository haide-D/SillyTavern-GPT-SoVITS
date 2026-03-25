/**
 * 聊天事件监听器
 * 
 * 职责:
 * - 监听 SillyTavern 聊天事件
 * - 整合所有模块 (数据采集、消息路由、状态追踪)
 * - 建立 WebSocket 连接
 * - 初始化触发器
 */

import { eventSource, event_types } from '../../../../../../script.js';
import { SpeakerManager } from './speaker_manager.js';
import { WebSocketManager } from './websocket_manager.js';
import { ContextDataCollector } from './context_data_collector.js';
import { WebSocketMessageRouter } from './websocket_message_router.js';
import { LLMRequestCoordinator } from './llm_request_coordinator.js';
import { NotificationHandler } from './notification_handler.js';
import { CharacterStateManager } from './character_state_manager.js';
import { SceneAnalyzer } from './scene_analyzer.js';
import { TriggerSystem, TriggerHelpers } from './trigger_system.js';
import { PhoneCallAPIClient } from './phone_call_api_client.js';
import { ContinuousAnalysisHandler } from './continuous_analysis_handler.js';
import { LiveActionHandler } from './live_action_handler.js';
import { ChatInjector } from './chat_injector.js';

export const ChatEventListener = {
    // 当前角色名称
    currentCharName: null,
    // 是否已初始化
    initialized: false,
    // 是否有待处理的聊天切换
    pendingChatChange: false,

    // 模块实例
    messageRouter: null,
    stateManager: null,
    sceneAnalyzer: null,
    triggerSystem: null,

    /**
     * 初始化监听器
     */
    init() {
        if (this.initialized) {
            console.log('[ChatEventListener] ⚠️ 已经初始化过,跳过');
            return;
        }

        console.log('[ChatEventListener] 🚀 开始初始化聊天事件监听器...');

        // 1. 初始化状态追踪系统
        this.initStateTrackingSystem();

        // 2. 初始化 WebSocket 消息路由
        this.initMessageRouter();

        // 3. 绑定 SillyTavern 事件监听
        this.bindSillyTavernEvents();

        // 4. 监听 WebSocket 消息
        this.bindWebSocketListener();

        // 5. 注册用户自定义触发器
        this.registerUserTriggers();

        // 6. 初始化聊天注入器 (注册 swipe 恢复监听)
        ChatInjector.init();

        this.initialized = true;
        console.log('[ChatEventListener] ✅ 聊天事件监听器初始化完成');
    },

    /**
     * 初始化状态追踪系统
     */
    initStateTrackingSystem() {
        console.log('[ChatEventListener] 💾 初始化状态追踪系统...');

        // 创建状态管理器
        this.stateManager = new CharacterStateManager();

        // 创建场景分析器
        this.sceneAnalyzer = new SceneAnalyzer(this.stateManager);

        // 创建触发器系统
        this.triggerSystem = new TriggerSystem(this.stateManager);

        // 监听状态变化,自动评估触发器
        this.stateManager.on('state_changed', async (states, charName, oldState, newState) => {
            console.log(`[ChatEventListener] 🔄 状态变化: ${charName}`, {
                from: oldState,
                to: newState
            });

            // 评估触发器
            await this.triggerSystem.evaluate(states);
        });

        console.log('[ChatEventListener] ✅ 状态追踪系统初始化完成');
    },

    /**
     * 初始化 WebSocket 消息路由
     */
    initMessageRouter() {
        console.log('[ChatEventListener] 📨 初始化消息路由...');

        // 创建路由器
        this.messageRouter = new WebSocketMessageRouter();

        // 注册LLM请求处理器
        this.messageRouter.registerHandler('llm_request', LLMRequestCoordinator.handleLLMRequest.bind(LLMRequestCoordinator));
        this.messageRouter.registerHandler('scene_analysis_request', LLMRequestCoordinator.handleSceneAnalysis.bind(LLMRequestCoordinator));
        this.messageRouter.registerHandler('eavesdrop_llm_request', LLMRequestCoordinator.handleEavesdrop.bind(LLMRequestCoordinator));

        // 注册通知处理器
        this.messageRouter.registerHandler('phone_call_ready', NotificationHandler.handlePhoneCallReady.bind(NotificationHandler));
        this.messageRouter.registerHandler('eavesdrop_ready', NotificationHandler.handleEavesdropReady.bind(NotificationHandler));

        // 注册持续性分析处理器
        const continuousAnalysisHandler = new ContinuousAnalysisHandler();
        this.messageRouter.registerHandler('continuous_analysis_request', (msg) => continuousAnalysisHandler.handle(msg));

        // 注册活人感行动处理器
        const liveActionHandler = new LiveActionHandler();
        this.messageRouter.registerHandler('live_action_triggered', (msg) => liveActionHandler.handle(msg));

        // 注册分析完成通知处理器（仅记录日志，实际触发逻辑由其他消息处理）
        this.messageRouter.registerHandler('continuous_analysis_complete', (msg) => {
            console.log(`[ChatEventListener] ✅ 分析完成: floor=${msg.floor}, action=${msg.suggested_action}`);
        });

        console.log('[ChatEventListener] ✅ 消息路由初始化完成');
    },

    /**
     * 绑定 SillyTavern 事件
     */
    bindSillyTavernEvents(retryCount = 0) {
        const MAX_RETRIES = 30;

        console.log(`[ChatEventListener] 🔍 检查 SillyTavern 状态 (重试: ${retryCount}/${MAX_RETRIES})`);

        // 检查 SillyTavern 是否已加载
        if (!window.SillyTavern || !window.SillyTavern.getContext || !eventSource || !event_types) {
            if (retryCount >= MAX_RETRIES) {
                console.error('[ChatEventListener] ❌ SillyTavern 加载超时');
                return;
            }

            console.warn(`[ChatEventListener] ⚠️ SillyTavern 尚未加载,1秒后重试 (${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => this.bindSillyTavernEvents(retryCount + 1), 1000);
            return;
        }

        // 监听角色消息渲染完成事件
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            console.log(`[ChatEventListener] 📨 检测到角色消息渲染: messageId=${messageId}`);
            this.onCharacterMessageRendered(messageId);
        });

        // 监听聊天切换事件
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log('[ChatEventListener] 🔄 聊天切换开始,等待数据加载...');
            this.pendingChatChange = true;
            SpeakerManager.clearCache();
        });

        // 监听聊天加载完成事件
        eventSource.on('chatLoaded', () => {
            console.log('[ChatEventListener] 📄 聊天已加载');

            if (this.pendingChatChange) {
                console.log('[ChatEventListener] ✅ 聊天切换完成,开始处理');
                this.pendingChatChange = false;
                this.onCharacterPageLoaded();
            } else {
                console.log('[ChatEventListener] ⏭️ 非聊天切换场景,跳过');
            }
        });

        console.log('[ChatEventListener] ✅ SillyTavern 事件监听已绑定');
    },

    /**
     * 绑定 WebSocket 消息监听
     */
    bindWebSocketListener() {
        // ✅ 防止重复注册
        if (this._wsListenerBound) {
            console.log('[ChatEventListener] ℹ️ WebSocket 监听已绑定，跳过');
            return;
        }

        if (window.TTS_Events && window.TTS_Events.on) {
            window.TTS_Events.on('websocket_message', (data) => {
                this.messageRouter.route(data);
            });
            this._wsListenerBound = true;  // ✅ 标记已绑定
            console.log('[ChatEventListener] ✅ 已注册 WebSocket 消息监听');
        } else {
            console.warn('[ChatEventListener] ⚠️ TTS_Events 未就绪,稍后重试');
            setTimeout(() => this.bindWebSocketListener(), 1000);
        }
    },

    /**
     * 注册用户自定义触发器
     * 
     * 用户可以在这里编写自己的触发逻辑
     */
    registerUserTriggers() {
        console.log('[ChatEventListener] ⚡ 注册用户自定义触发器...');

        // 示例 1: 角色离场 30 秒后触发电话
        // this.triggerSystem.register({
        //     name: "离场30秒触发电话",
        //     condition: (state) => {
        //         const char = state["角色A"];
        //         return char && !char.present &&
        //             char.location === "咖啡厅" &&
        //             (Date.now() - char.lastSeen) > 30000;
        //     },
        //     action: async (state) => {
        //         await PhoneCallAPIClient.triggerAutoCall("角色A");
        //     },
        //     priority: 10
        //     });

        // 示例 2: 使用辅助函数创建触发器
        // const trigger = TriggerHelpers.createAbsenceDelayTrigger(
        //     "角色A",
        //     30000,
        //     "咖啡厅",
        //     async (state) => {
        //         await PhoneCallAPIClient.triggerAutoCall("角色A");
        //     }
        // );
        // this.triggerSystem.register(trigger);

        console.log('[ChatEventListener] ✅ 触发器注册完成');
    },

    /**
     * 当角色页面加载完成时触发
     */
    async onCharacterPageLoaded() {
        try {
            const charInfo = ContextDataCollector.getCharacterInfo();
            if (!charInfo) {
                console.warn('[ChatEventListener] ⚠️ 无法获取角色信息');
                return;
            }

            const { charName } = charInfo;
            this.currentCharName = charName;

            // 建立 WebSocket 连接
            WebSocketManager.connect(charName);

            // 更新说话人列表
            const context = window.SillyTavern.getContext();
            const chatBranch = ContextDataCollector.getCurrentChatBranch();
            await ContextDataCollector.updateSpeakers(context, chatBranch);

            console.log(`[ChatEventListener] ✅ 聊天切换完成 - 角色: ${charName}, 分支: ${chatBranch}`);

            // 检查并触发世界书初始化
            await this.checkAndInitWorldBook(charName);

        } catch (error) {
            console.error('[ChatEventListener] ❌ 处理聊天切换时出错:', error);
        }
    },

    /**
     * 当角色消息渲染完成时触发
     */
    async onCharacterMessageRendered(messageId) {
        try {
            const charInfo = ContextDataCollector.getCharacterInfo();
            if (!charInfo) {
                console.warn('[ChatEventListener] ⚠️ 无法获取角色信息');
                return;
            }

            const { charName } = charInfo;
            this.currentCharName = charName;

            // 建立 WebSocket 连接 (如果尚未连接)
            WebSocketManager.connect(charName);

            // 采集数据并发送 webhook (后端统一分析系统会处理触发判断)
            await ContextDataCollector.collectAndSendWebhook();

            // 注意: 场景分析已整合到后端统一分析流程中
            // 不再在前端独立调用 sceneAnalyzer.analyzeLatestMessage()

        } catch (error) {
            console.error('[ChatEventListener] ❌ 处理角色消息时出错:', error);
        }
    },

    /**
     * 检查并提供世界书初始化 UI
     */
    async checkAndInitWorldBook(charName) {
        try {
            // 1. 检查是否已初始化
            const isInit = await window.TTS_API.checkWorldBookInit(charName);
            if (isInit) {
                console.log(`[ChatEventListener] ℹ️ 角色 ${charName} 已在后端初始化画像，跳过`);
                return;
            }

            // 2. 收集数据
            const worldBookEntries = ContextDataCollector.collectWorldBookEntries();
            const cardData = ContextDataCollector.collectCharacterCardData();

            if (!cardData && worldBookEntries.length === 0) {
                console.log(`[ChatEventListener] ℹ️ 角色 ${charName} 无角色卡和世界书数据，跳过`);
                return;
            }

            if (worldBookEntries.length === 0) {
                 // 只有角色卡数据，没有世界书，直接静默初始化（无需弹窗选条目）
                 console.log(`[ChatEventListener] ℹ️ 角色 ${charName} 无世界书，仅提交角色卡数据进行初始化`);
                 await window.TTS_API.initWorldBook({
                     char_name: charName,
                     card_data: cardData,
                     worldbook_entries: []
                 });
                 if (typeof toastr !== 'undefined') toastr.success(`角色 ${charName} 画像初始化完成`);
                 return;
            }

            // 3. 构建选择弹窗 UI
            // 使用全局变量来同步选取状态，因为 popup resovle 时 DOM 可能已经被销毁
            window.__st_dt_wbState = window.__st_dt_wbState || new Set();
            window.__st_dt_wbState.clear();

            const entriesHtml = worldBookEntries.map((entry, index) => {
                const checked = entry.constant ? 'checked' : '';
                if (entry.constant) {
                    window.__st_dt_wbState.add(index);
                }
                return `
                    <div style="margin-bottom: 10px; padding: 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 5px;">
                        <label style="display: flex; align-items: flex-start; cursor: pointer;">
                            <input type="checkbox" onchange="if(this.checked) window.__st_dt_wbState.add(${index}); else window.__st_dt_wbState.delete(${index});" class="wb_entry_checkbox" data-index="${index}" ${checked} style="margin-top: 4px; margin-right: 10px;">
                            <div style="flex: 1;">
                                <div style="font-weight: bold; margin-bottom: 5px;">
                                    ${entry.comment || '未命名'} ${entry.constant ? '<span style="color: #ffaa00; font-size: 0.8em;">(Constant)</span>' : ''}
                                </div>
                                <div style="font-size: 0.9em; opacity: 0.8; max-height: 80px; overflow-y: auto;">
                                    ${entry.content}
                                </div>
                            </div>
                        </label>
                    </div>
                `;
            }).join('');

            const contentHtml = `
                <div style="flex: 1; overflow-y: auto; overflow-x: hidden;">
                    <h3 style="margin-top: 0;">为 <strong>${charName}</strong> 提炼画像</h3>
                    <p style="opacity: 0.8; font-size: 0.9em;">选择要与角色卡一并发送给 LLM 进行结构化提炼的世界书条目。<br>已默认勾选 Constant 全局条目。</p>
                    <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 5px; max-height: 40vh; overflow-y: auto; padding-right: 10px;">
                        ${entriesHtml}
                    </div>
                </div>
            `;

            // 4. 弹窗
            const stContext = window.SillyTavern.getContext();
            const popupResult = await stContext.callGenericPopup(contentHtml, stContext.POPUP_TYPE.CONFIRM, '', { 
                okButton: "开始提炼画像", 
                cancelButton: "跳过",
                wider: true
            });

            if (!popupResult) {
                console.log(`[ChatEventListener] ℹ️ 用户跳过了世界书初始化`);
                return;
            }

            // 5. 收集勾选的条目 (从状态集里取, 避免 DOM 销毁后 querySelectorAll 返回空)
            const selectedEntries = [];
            window.__st_dt_wbState.forEach(idx => {
                selectedEntries.push(worldBookEntries[idx]);
            });

            if (typeof toastr !== 'undefined') toastr.info(`正在为 ${charName} 调用 LLM 提炼画像，请耐心等待...`, "进行中", { timeOut: 0 });

            // 6. 提交到后端
            try {
                const result = await window.TTS_API.initWorldBook({
                    char_name: charName,
                    card_data: cardData,
                    worldbook_entries: selectedEntries
                });
                
                if (typeof toastr !== 'undefined') {
                    toastr.clear();
                    toastr.success(`角色画像提取成功！`, "成功");
                }
                console.log(`[ChatEventListener] ✅ 画像提取成功:`, result);
            } catch (initErr) {
                if (typeof toastr !== 'undefined') {
                    toastr.clear();
                    toastr.error(`画像提取失败: ${initErr.message}`);
                }
                console.error(`[ChatEventListener] ❌ 画像提取出错:`, initErr);
            }

        } catch (error) {
            console.error('[ChatEventListener] ❌ 检查/初始化世界书时出错:', error);
        }
    }

};

// 自动初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        ChatEventListener.init();
    });
} else {
    ChatEventListener.init();
}

export default ChatEventListener;
