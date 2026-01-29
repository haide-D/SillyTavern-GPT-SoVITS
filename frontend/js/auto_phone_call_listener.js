/**
 * 自动电话完整监听器
 * 
 * 功能:
 * 1. 监听SillyTavern的角色消息事件
 * 2. 计算当前楼层并发送webhook到后端
 * 3. 监听后端的llm_request消息
 * 4. 自动调用LLM并返回结果
 */

import { LLM_Client } from './llm_client.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { SpeakerManager } from './speaker_manager.js';
import { WebSocketManager } from './websocket_manager.js';

export const AutoPhoneCallListener = {
    // 当前角色名称
    currentCharName: null,
    // 是否已初始化
    initialized: false,
    // 是否有待处理的聊天切换(用于组合事件触发)
    pendingChatChange: false,

    /**
     * 初始化监听器
     */
    init() {
        if (this.initialized) {
            console.log('[AutoPhoneCallListener] ⚠️ 已经初始化过,跳过');
            return;
        }

        console.log('[AutoPhoneCallListener] 🚀 开始初始化自动电话功能...');

        // 1. 绑定 SillyTavern 事件监听 (监听聊天楼层)
        this.bindSillyTavernEvents();

        // 2. 监听WebSocket消息 (接收LLM请求)
        this.bindWebSocketListener();

        this.initialized = true;
        console.log('[AutoPhoneCallListener] ✅ 自动电话功能初始化完成');
    },

    /**
     * 绑定 SillyTavern 的消息事件
     */
    bindSillyTavernEvents(retryCount = 0) {
        const MAX_RETRIES = 30;

        console.log(`[AutoPhoneCallListener] 🔍 检查 SillyTavern 状态 (重试: ${retryCount}/${MAX_RETRIES})`);

        // 检查 SillyTavern 是否已加载
        if (!window.SillyTavern || !window.SillyTavern.getContext || !eventSource || !event_types) {
            if (retryCount >= MAX_RETRIES) {
                console.error('[AutoPhoneCallListener] ❌ SillyTavern 加载超时');
                return;
            }

            console.warn(`[AutoPhoneCallListener] ⚠️ SillyTavern 尚未加载,1秒后重试 (${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => this.bindSillyTavernEvents(retryCount + 1), 1000);
            return;
        }

        // 监听角色消息渲染完成事件 (AI 回复完成)
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
            console.log(`[AutoPhoneCallListener] 📨 检测到角色消息渲染: messageId=${messageId}`);
            this.onCharacterMessageRendered(messageId);
        });

        // 监听聊天切换事件 (设置标记)
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log('[AutoPhoneCallListener] 🔄 聊天切换开始,等待数据加载...');
            this.pendingChatChange = true;

            // 清除说话人缓存
            SpeakerManager.clearCache();
        });

        // 监听聊天加载完成事件 (检查标记后执行)
        eventSource.on('chatLoaded', () => {
            console.log('[AutoPhoneCallListener] 📄 聊天已加载');

            // 只有在聊天切换后才执行
            if (this.pendingChatChange) {
                console.log('[AutoPhoneCallListener] ✅ 聊天切换完成,开始处理');
                this.pendingChatChange = false;
                this.onCharacterPageLoaded();
            } else {
                console.log('[AutoPhoneCallListener] ⏭️ 非聊天切换场景,跳过');
            }
        });

        console.log('[AutoPhoneCallListener] ✅ SillyTavern 事件监听已绑定');
    },

    /**
     * 绑定 WebSocket 消息监听
     */
    bindWebSocketListener() {
        if (window.TTS_Events && window.TTS_Events.on) {
            window.TTS_Events.on('websocket_message', this.handleWebSocketMessage.bind(this));
            console.log('[AutoPhoneCallListener] ✅ 已注册WebSocket消息监听');
        } else {
            console.warn('[AutoPhoneCallListener] ⚠️ TTS_Events未就绪,稍后重试');
            setTimeout(() => this.bindWebSocketListener(), 1000);
        }
    },

    /**
     * 当角色页面加载完成时触发
     * 
     * 职责: 初始化 WebSocket 连接
     * 不发送 webhook,避免与 CHARACTER_MESSAGE_RENDERED 重复
     */
    async onCharacterPageLoaded() {
        try {
            // 获取 SillyTavern 上下文 (此时数据已就绪)
            const context = window.SillyTavern.getContext();
            if (!context) {
                console.warn('[AutoPhoneCallListener] ⚠️ 无法获取 SillyTavern 上下文');
                return;
            }

            const { chat, characters, characterId } = context;

            // 获取当前角色名称 (characterId 是字符串,需要在数组中查找)
            const currentChar = characters?.find(c => c.avatar === characterId);
            const charName = currentChar?.name || context.name2;
            if (!charName) {
                console.warn('[AutoPhoneCallListener] ⚠️ 无法获取角色名称');
                return;
            }

            // 更新当前角色名称
            this.currentCharName = charName;

            // 建立 WebSocket 连接
            WebSocketManager.connect(charName);

            // 获取 chat_branch
            const chatBranch = this.getCurrentChatBranch();

            // 更新说话人列表
            SpeakerManager.updateSpeakers(context, chatBranch).catch(err => {
                console.warn('[AutoPhoneCallListener] ⚠️ 说话人更新失败:', err);
            });

            console.log(`[AutoPhoneCallListener] ✅ 聊天切换完成 - 角色: ${charName}, 分支: ${chatBranch}`);
            console.log(`[AutoPhoneCallListener] ℹ️ WebSocket 已连接,等待 CHARACTER_MESSAGE_RENDERED 事件触发 webhook`);


        } catch (error) {
            console.error('[AutoPhoneCallListener] ❌ 处理聊天切换时出错:', error);
        }
    },

    /**
     * 当角色消息渲染完成时触发
     */
    async onCharacterMessageRendered(messageId) {
        try {
            // 获取 SillyTavern 上下文
            const context = window.SillyTavern.getContext();
            if (!context) {
                console.warn('[AutoPhoneCallListener] ⚠️ 无法获取 SillyTavern 上下文');
                return;
            }

            const { chat, characters, characterId } = context;

            // 获取当前角色名称 (characterId 是字符串,需要在数组中查找)
            const currentChar = characters?.find(c => c.avatar === characterId);
            const charName = currentChar?.name || context.name2;
            if (!charName) {
                console.warn('[AutoPhoneCallListener] ⚠️ 无法获取角色名称');
                return;
            }

            // 更新当前角色名称
            this.currentCharName = charName;

            // 建立 WebSocket 连接 (如果尚未连接)
            WebSocketManager.connect(charName);

            // 获取 chat_branch
            const chatBranch = this.getCurrentChatBranch();

            // 更新说话人列表 (异步,不阻塞)
            SpeakerManager.updateSpeakers(context, chatBranch).catch(err => {
                console.warn('[AutoPhoneCallListener] ⚠️ 说话人更新失败:', err);
            });

            // 查询当前对话的所有说话人
            let speakers = [];
            try {
                const result = await window.TTS_API.getSpeakers(chatBranch);
                speakers = result.speakers || [];
                console.log(`[AutoPhoneCallListener] 📋 查询到 ${speakers.length} 个说话人:`, speakers);
            } catch (error) {
                console.warn('[AutoPhoneCallListener] ⚠️ 查询说话人失败,将使用空列表:', error);
            }

            // 计算当前楼层 (轮次)
            const currentFloor = Math.floor(chat.length / 2);

            // 提取最近的上下文消息 (最多10条)
            const contextMessages = chat.slice(-10).map(msg => ({
                name: msg.name || (msg.is_user ? context.name1 : charName),
                is_user: msg.is_user || false,
                mes: msg.mes || ""
            }));

            console.log(`[AutoPhoneCallListener] 📊 当前楼层: ${currentFloor}, 上下文消息数: ${contextMessages.length}, 说话人数: ${speakers.length}`);

            // 发送 webhook 到后端
            await this.sendWebhook(chatBranch, speakers, currentFloor, contextMessages);

        } catch (error) {
            console.error('[AutoPhoneCallListener] ❌ 处理角色消息时出错:', error);
        }
    },

    /**
     * 获取当前对话分支ID
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
            console.error('[AutoPhoneCallListener] 获取 chat_branch 失败:', e);
        }
        return "default";
    },

    /**
     * 发送 webhook 到后端
     */
    async sendWebhook(chatBranch, speakers, floor, context) {
        try {
            const apiHost = this.getApiHost();

            // 获取用户名 (name1) 和主角色名 (name2)
            const stContext = window.SillyTavern.getContext();
            const userName = stContext?.name1 || null;
            const charName = stContext?.name2 || null;  // 主角色卡名称，用于 WebSocket 路由
            console.log('[AutoPhoneCallListener] 👤 用户名:', userName);
            console.log('[AutoPhoneCallListener] 🎭 主角色名:', charName);

            // 计算上下文指纹 - 使用最后一条消息的指纹，用于来电历史匹配
            let contextFingerprint = 'empty';
            try {
                if (window.TTS_Utils && window.TTS_Utils.getCurrentContextFingerprints) {
                    const fingerprints = window.TTS_Utils.getCurrentContextFingerprints();
                    // 使用最后一条消息的指纹作为触发指纹，而不是合并哈希
                    // 这样查询时可以用消息指纹列表直接匹配
                    if (fingerprints.length > 0) {
                        contextFingerprint = fingerprints[fingerprints.length - 1];
                        console.log(`[AutoPhoneCallListener] 🔐 触发消息指纹: ${contextFingerprint} (最后一条消息)`);
                    } else {
                        // 回退：如果没有 TTS 指纹，使用楼层作为标识
                        contextFingerprint = `floor_${floor}`;
                        console.log(`[AutoPhoneCallListener] 🔐 使用楼层指纹: ${contextFingerprint}`);
                    }
                } else {
                    console.warn('[AutoPhoneCallListener] ⚠️ TTS_Utils.getCurrentContextFingerprints 不可用,使用楼层指纹');
                    contextFingerprint = `floor_${floor}`;
                }
            } catch (error) {
                console.error('[AutoPhoneCallListener] ❌ 计算指纹失败:', error);
                contextFingerprint = `floor_${floor}`;
            }

            // 构建请求数据
            const requestData = {
                chat_branch: chatBranch,
                speakers: speakers,
                current_floor: floor,
                context: context,
                context_fingerprint: contextFingerprint,
                user_name: userName,  // 用户名，用于在prompt中区分用户身份
                char_name: charName   // 主角色卡名称，用于 WebSocket 路由
            };

            // 详细日志
            console.log('[AutoPhoneCallListener] 📤 发送 Webhook:');
            console.log('  - URL:', `${apiHost}/api/phone_call/webhook/message`);
            console.log('  - chat_branch:', chatBranch);
            console.log('  - speakers:', speakers);
            console.log('  - current_floor:', floor);
            console.log('  - context 条数:', context?.length || 0);
            console.log('  - context_fingerprint:', contextFingerprint);
            console.log('  - context 示例:', context?.slice(0, 2));
            console.log('  - 完整数据:', requestData);

            const response = await fetch(`${apiHost}/api/phone_call/webhook/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            if (response.ok) {
                const data = await response.json();
                console.log('[AutoPhoneCallListener] ✅ Webhook 发送成功:', data);
            } else {
                const error = await response.text();
                console.warn(`[AutoPhoneCallListener] ⚠️ Webhook 发送失败 (${response.status}):`, error);
            }
        } catch (error) {
            console.error('[AutoPhoneCallListener] ❌ 发送 webhook 时出错:', error);
        }
    },

    /**
     * 生成上下文指纹
     * 将所有消息指纹合并后生成唯一标识
     */
    generateContextFingerprint(fingerprints) {
        if (!fingerprints || fingerprints.length === 0) {
            return 'empty';
        }

        // 排序后合并,确保相同内容产生相同指纹
        const sorted = fingerprints.slice().sort();
        const combined = sorted.join('|');

        // 使用简单哈希
        if (window.TTS_Utils && window.TTS_Utils.generateSimpleHash) {
            return window.TTS_Utils.generateSimpleHash(combined);
        }

        // 回退:使用简单的字符串哈希
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    },

    /**
     * 处理WebSocket消息 (接收后端的LLM请求和来电通知)
     */
    async handleWebSocketMessage(data) {
        // 处理 LLM 请求
        if (data.type === 'llm_request') {
            console.log('[AutoPhoneCallListener] 📥 收到LLM请求:', data);

            const { call_id, char_name, prompt, llm_config, speakers, chat_branch } = data;

            try {
                // 显示通知
                this.showNotification(`正在为 ${char_name} 生成主动电话...`);

                // 调用LLM
                console.log('[AutoPhoneCallListener] 🤖 调用LLM...');
                const llmResponse = await LLM_Client.callLLM({
                    api_url: llm_config.api_url,
                    api_key: llm_config.api_key,
                    model: llm_config.model,
                    temperature: llm_config.temperature,
                    max_tokens: llm_config.max_tokens,
                    prompt: prompt
                });

                console.log('[AutoPhoneCallListener] ✅ LLM响应成功,长度:', llmResponse.length);
                console.log('[AutoPhoneCallListener] LLM响应内容 (前500字符):', llmResponse.substring(0, 500));

                // 将结果发送回后端
                console.log('[AutoPhoneCallListener] 📤 发送结果到后端...');
                const apiHost = this.getApiHost();

                const requestData = {
                    call_id: call_id,
                    llm_response: llmResponse,
                    chat_branch: chat_branch,
                    speakers: speakers,
                    char_name: char_name  // 主角色卡名称，用于 WebSocket 推送路由
                };

                console.log('[AutoPhoneCallListener] 发送数据:', {
                    call_id: call_id,
                    llm_response_length: llmResponse.length,
                    llm_response_preview: llmResponse.substring(0, 200),
                    chat_branch: chat_branch,
                    speakers: speakers
                });

                const response = await fetch(`${apiHost}/api/phone_call/complete_generation`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
                }

                const result = await response.json();
                console.log('[AutoPhoneCallListener] ✅ 生成完成:', result);

                // this.showNotification(`${result.selected_speaker} 的主动电话已生成!`, 'success');

            } catch (error) {
                console.error('[AutoPhoneCallListener] ❌ 处理失败:', error);

                // 将错误信息发送到后端控制台
                try {
                    const apiHost = this.getApiHost();
                    const errorReport = {
                        error_type: 'llm_parse_error',
                        error_message: error.message,
                        error_stack: error.stack,
                        call_id: call_id,
                        char_name: char_name,
                        llm_config: llm_config,
                        timestamp: new Date().toISOString()
                    };

                    // 如果错误对象包含原始响应数据,也一并发送
                    if (error.rawResponse) {
                        errorReport.raw_llm_response = error.rawResponse;
                        console.log('[AutoPhoneCallListener] 📋 包含原始LLM响应数据');
                    }

                    console.log('[AutoPhoneCallListener] 📤 发送错误报告到后端...');

                    // 异步发送,不阻塞主流程
                    fetch(`${apiHost}/api/phone_call/log_error`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(errorReport)
                    }).catch(err => {
                        console.warn('[AutoPhoneCallListener] ⚠️ 发送错误报告失败:', err);
                    });
                } catch (reportError) {
                    console.warn('[AutoPhoneCallListener] ⚠️ 生成错误报告失败:', reportError);
                }

                this.showNotification(`生成失败: ${error.message}`, 'error');
            }
            return;
        }

        // 处理对话追踪 LLM 请求
        if (data.type === 'eavesdrop_llm_request') {
            console.log('[AutoPhoneCallListener] 🎧 收到对话追踪LLM请求:', data);

            const { record_id, char_name, prompt, llm_config, speakers, chat_branch, scene_description } = data;

            try {
                // 显示通知
                this.showNotification(`正在生成 ${speakers.join(' 和 ')} 的私下对话...`);

                // 调用LLM
                console.log('[AutoPhoneCallListener] 🤖 调用LLM (对话追踪)...');
                const llmResponse = await LLM_Client.callLLM({
                    api_url: llm_config.api_url,
                    api_key: llm_config.api_key,
                    model: llm_config.model,
                    temperature: llm_config.temperature,
                    max_tokens: llm_config.max_tokens,
                    prompt: prompt
                });

                console.log('[AutoPhoneCallListener] ✅ LLM响应成功 (对话追踪),长度:', llmResponse.length);

                // 将结果发送回后端
                console.log('[AutoPhoneCallListener] 📤 发送对话追踪结果到后端...');
                const apiHost = this.getApiHost();

                const requestData = {
                    record_id: record_id,
                    llm_response: llmResponse,
                    chat_branch: chat_branch,
                    speakers: speakers,
                    char_name: char_name
                };

                const response = await fetch(`${apiHost}/api/eavesdrop/complete_generation`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
                }

                const result = await response.json();
                console.log('[AutoPhoneCallListener] ✅ 对话追踪生成完成:', result);

            } catch (error) {
                console.error('[AutoPhoneCallListener] ❌ 对话追踪处理失败:', error);
                this.showNotification(`对话追踪生成失败: ${error.message}`, 'error');
            }
            return;
        }

        // 处理来电通知
        if (data.type === 'phone_call_ready') {
            console.log('[AutoPhoneCallListener] 📞 收到来电通知:', data);

            const { call_id, char_name, segments, audio_path, audio_url } = data;

            // 将相对路径转换为完整 API URL
            const apiHost = this.getApiHost();
            const fullAudioUrl = audio_url ? `${apiHost}${audio_url}` : (audio_path ? `${apiHost}${audio_path}` : null);

            console.log('[AutoPhoneCallListener] 🎵 音频 URL 转换:');
            console.log('  - 原始 audio_url:', audio_url);
            console.log('  - 完整 URL:', fullAudioUrl);

            // 🖼️ 获取角色头像 URL
            let avatarUrl = null;
            try {
                const context = window.SillyTavern?.getContext?.();
                if (context) {
                    const { characters, characterId } = context;
                    // 优先按角色名查找，再按 characterId 查找
                    const char = characters?.find(c => c.name === char_name) ||
                        characters?.find(c => c.avatar === characterId);
                    if (char?.avatar) {
                        // SillyTavern 角色头像路径格式: /characters/{avatar}
                        avatarUrl = `/characters/${char.avatar}`;
                        console.log('[AutoPhoneCallListener] 🖼️ 头像 URL:', avatarUrl);
                    }
                }
            } catch (e) {
                console.warn('[AutoPhoneCallListener] ⚠️ 获取头像失败:', e);
            }

            // 存储来电数据
            window.TTS_IncomingCall = {
                call_id,
                char_name,
                segments,
                audio_path,
                audio_url: fullAudioUrl,  // 使用完整 URL
                avatar_url: avatarUrl     // 角色头像
            };

            console.log('[AutoPhoneCallListener] ✅ 来电数据已存储到 window.TTS_IncomingCall:', window.TTS_IncomingCall);

            // 触发悬浮球震动 (同时支持桌面版和移动版)
            const $managerBtn = $('#tts-manager-btn');  // 桌面版
            const $mobileTrigger = $('#tts-mobile-trigger');  // 移动版

            console.log('[AutoPhoneCallListener] 🔍 查找悬浮球元素:');
            console.log('  - 桌面版 (#tts-manager-btn):', $managerBtn.length);
            console.log('  - 移动版 (#tts-mobile-trigger):', $mobileTrigger.length);

            let triggered = false;

            // 桌面版悬浮球
            if ($managerBtn.length) {
                $managerBtn.addClass('incoming-call');
                $managerBtn.attr('title', `${char_name} 来电中...`);
                console.log('[AutoPhoneCallListener] ✅ 桌面版悬浮球震动已触发,当前class:', $managerBtn.attr('class'));
                triggered = true;
            }

            // 移动版悬浮球
            if ($mobileTrigger.length) {
                // 🔧 修复：移除拖动时可能残留的内联样式，确保来电动画正常
                // 来电震动动画使用 animation + transform，必须移除这两个内联样式
                $mobileTrigger[0].style.removeProperty('animation');
                $mobileTrigger[0].style.removeProperty('transform');
                $mobileTrigger.addClass('incoming-call');
                $mobileTrigger.attr('title', `${char_name} 来电中...`);
                console.log('[AutoPhoneCallListener] ✅ 移动版悬浮球震动已触发,当前class:', $mobileTrigger.attr('class'));
                triggered = true;
            }

            if (!triggered) {
                console.warn('[AutoPhoneCallListener] ⚠️ 悬浮球元素不存在,无法触发震动');
                console.warn('[AutoPhoneCallListener] 💡 提示:请确保 TTS_UI 已初始化并创建了悬浮球');
            }

            // 显示通知
            this.showNotification(`📞 ${char_name} 来电!`, 'info');
        }

        // 处理对话追踪通知
        if (data.type === 'eavesdrop_ready') {
            console.log('[AutoPhoneCallListener] 🎧 收到对话追踪通知:', data);

            const { record_id, speakers, segments, audio_url, scene_description, notification_text } = data;

            // 将相对路径转换为完整 API URL
            const apiHost = this.getApiHost();
            const fullAudioUrl = audio_url ? `${apiHost}${audio_url}` : null;

            // 存储对话追踪数据
            window.TTS_EavesdropData = {
                record_id,
                speakers,
                segments,
                audio_url: fullAudioUrl,
                scene_description
            };

            console.log('[AutoPhoneCallListener] ✅ 对话追踪数据已存储到 window.TTS_EavesdropData');

            // 触发悬浮球闪烁 (使用不同的样式)
            const $managerBtn = $('#tts-manager-btn');
            const $mobileTrigger = $('#tts-mobile-trigger');

            if ($managerBtn.length) {
                $managerBtn.addClass('eavesdrop-available');
                $managerBtn.attr('title', notification_text || `${speakers.join(' 和 ')} 正在私聊...`);
            }

            if ($mobileTrigger.length) {
                $mobileTrigger[0].style.removeProperty('animation');
                $mobileTrigger[0].style.removeProperty('transform');
                $mobileTrigger.addClass('eavesdrop-available');
                $mobileTrigger.attr('title', notification_text || `${speakers.join(' 和 ')} 正在私聊...`);
            }

            // 显示通知
            this.showNotification(notification_text || `🎧 检测到 ${speakers.join(' 和 ')} 正在私聊`, 'info');
        }
    },

    /**
     * 获取 API Host
     */
    getApiHost() {
        // 从 TTS_State 获取配置的 API Host
        if (window.TTS_State && window.TTS_State.CACHE && window.TTS_State.CACHE.API_URL) {
            return window.TTS_State.CACHE.API_URL;
        }

        // 回退到默认值
        const apiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? '127.0.0.1'
            : window.location.hostname;

        return `http://${apiHost}:3000`;
    },

    /**
     * 显示通知
     */
    showNotification(message, type = 'info') {
        console.log(`[AutoPhoneCallListener] [${type}] ${message}`);

        // 如果有toastr,使用它
        if (window.toastr) {
            window.toastr[type](message);
        }

        // 也可以触发自定义事件
        if (window.TTS_Events && window.TTS_Events.emit) {
            window.TTS_Events.emit('auto_phone_call_notification', {
                message: message,
                type: type
            });
        }
    }
};

// 自动初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        AutoPhoneCallListener.init();
    });
} else {
    AutoPhoneCallListener.init();
}

export default AutoPhoneCallListener;
