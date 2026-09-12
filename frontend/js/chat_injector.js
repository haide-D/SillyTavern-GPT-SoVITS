/**
 * 聊天注入工具模块
 * 将通话内容注入到 SillyTavern 聊天中
 * 支持 swipe 后自动恢复追加的电话内容
 */

// 模块级状态
let _initialized = false;
let _initializing = false;  // 防止并发初始化

export const ChatInjector = {
    /**
     * 初始化 ChatInjector，注册事件监听器
     * 应在扩展加载时调用一次
     */
    init() {
        if (_initialized || _initializing) {
            console.log('[ChatInjector] 已初始化或正在初始化，跳过');
            return;
        }

        const context = window.SillyTavern?.getContext?.();
        if (!context) {
            console.warn('[ChatInjector] ⚠️ SillyTavern 上下文未就绪，延迟初始化');
            _initializing = true;  // 标记为正在初始化，阻止并发
            setTimeout(() => {
                _initializing = false;  // 重试前清除
                this.init();
            }, 1000);
            return;
        }

        const { eventSource, eventTypes } = context;

        // 监听 swipe 事件 - 当用户 swipe 消息时触发
        eventSource.on(eventTypes.MESSAGE_SWIPED, (messageIndex) => {
            this._handleSwipe(messageIndex);
        });

        // 监听消息接收事件 - swipe 后新消息生成完成时触发
        eventSource.on(eventTypes.MESSAGE_RECEIVED, (messageIndex) => {
            this._checkAndRestoreAppendedContent(messageIndex);
        });

        _initialized = true;
        console.log('[ChatInjector] ✅ 初始化完成，已注册 swipe 监听器');
    },

    /**
     * 将通话片段作为一条 assistant 消息注入聊天
     * 格式: 「某某给 user 打了电话，内容是：...」
     * 
     * @param {Object} options - 配置选项
     * @param {Array} options.segments - 对话片段数组 [{speaker, text, emotion}, ...]
     * @param {string} options.type - 类型: 'phone_call' | 'eavesdrop'
     * @param {string} options.callerName - 主叫人名称（电话场景）
     * @param {Array} options.speakers - 说话人列表（对话追踪场景）
     * @param {string} options.callId - 通话ID（可选）
     * @param {string} options.audioUrl - 音频URL（可选）
     * @param {string} options.sceneDescription - 场景描述（对话追踪场景，可选）
     * @returns {Promise<boolean>} 是否成功注入
     */
    async injectAsMessage(options) {
        const {
            type = 'phone_call',
            callId = options.callId || options.call_id || options.id || '',
            audioUrl = options.audioUrl || options.audio_url || '',
            sceneDescription = options.sceneDescription || options.scene_description || options.callReason || options.reason || ''
        } = options;

        const segments = options.segments || [];

        if (!segments || segments.length === 0) {
            console.warn('[ChatInjector] ⚠️ 没有可注入的对话片段');
            return false;
        }

        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) {
                console.error('[ChatInjector] ❌ 无法获取 SillyTavern 上下文');
                return false;
            }

            const { addOneMessage, chat, name1 } = context;
            const saveChat = context.saveChat;
            const userName = options.target || options.userName || options.user_name || name1 || '用户';

            // 智能解析 callerName，多层兜底
            let callerName = options.callerName || options.caller || options.char_name || options.selected_speaker || '';
            if (!callerName && context.characters && context.characterId !== undefined && context.characters[context.characterId]) {
                callerName = context.characters[context.characterId].name || '';
            } else if (!callerName && context.name2) {
                callerName = context.name2;
            }
            if (!callerName) {
                callerName = '神秘角色';
            }

            let speakers = options.speakers || (options.speaker ? [options.speaker] : []);
            if (speakers.length === 0 && type === 'eavesdrop') {
                const foundInSegs = new Set();
                for (const seg of segments) {
                    if (seg.speaker && seg.speaker.trim()) foundInSegs.add(seg.speaker.trim());
                }
                if (foundInSegs.size > 0) {
                    speakers = Array.from(foundInSegs);
                } else {
                    speakers = [callerName];
                }
            }

            // 构建消息内容
            let messageContent = '';

            if (type === 'phone_call') {
                // 主动电话格式
                messageContent = this._formatPhoneCallMessage(callerName, userName, segments, sceneDescription);
            } else if (type === 'eavesdrop') {
                // 对话追踪格式
                messageContent = this._formatEavesdropMessage(speakers, segments, sceneDescription);
            }

            // 构造消息对象
            const message = {
                name: type === 'phone_call' ? callerName : (speakers[0] || '旁白'),
                is_user: false,
                mes: messageContent,
                send_date: Date.now(),
                extra: {
                    // 标记为特殊消息类型
                    injected_type: type,
                    call_id: callId,
                    audio_url: audioUrl,
                    speakers: type === 'eavesdrop' ? speakers : [callerName]
                }
            };

            console.log('[ChatInjector] 📝 注入消息:', message);

            // 🔑 关键：先将消息 push 到 chat 数组，再调用 addOneMessage 渲染
            // 参考 SillyTavern 源码: "Callers push the new message to chat before calling addOneMessage"
            chat.push(message);
            addOneMessage(message);

            // 保存聊天记录
            if (saveChat) {
                await saveChat();
            }

            console.log('[ChatInjector] ✅ 通话内容已成功注入聊天');
            return true;

        } catch (error) {
            console.error('[ChatInjector] ❌ 注入失败:', error);
            return false;
        }
    },

    /**
     * 格式化主动电话消息
     * @private
     */
    _formatPhoneCallMessage(callerName, userName, segments, sceneDescription) {
        const effectiveCaller = (callerName && String(callerName).trim()) ? String(callerName).trim() : '神秘角色';
        const effectiveUser = (userName && String(userName).trim()) ? String(userName).trim() : '你';

        // 构建对话内容
        const dialogueContent = segments.map(seg => {
            // 对于多人通话，使用 segment 中的 speaker；单人电话使用 callerName
            const speaker = (seg.speaker && String(seg.speaker).trim()) ? String(seg.speaker).trim() : effectiveCaller;
            const text = seg.text || seg.content || '';
            const emotion = seg.emotion ? ` [${seg.emotion}]` : '';
            return `**${speaker}**${emotion}: "${text}"`;
        }).join('\n\n');

        // 组装可折叠的消息，防止剧透
        let sceneDesc = sceneDescription ? `\n*${sceneDescription}*` : '';

        const message = `<st-tts-call>
<details>
<summary>📞 <strong>${effectiveCaller}</strong> 给 <strong>${effectiveUser}</strong> 打了一个电话 <em>(点击展开)</em></summary>
${sceneDesc}

---

${dialogueContent}

---

*通话结束*
</details>
</st-tts-call>`;

        return message;
    },

    /**
     * 格式化对话追踪消息
     * @private
     */
    _formatEavesdropMessage(speakers, segments, sceneDescription) {
        let validSpeakers = Array.isArray(speakers) ? speakers.filter(s => s && String(s).trim()).map(s => String(s).trim()) : [];
        if (validSpeakers.length === 0) {
            const foundInSegs = new Set();
            for (const seg of segments) {
                if (seg.speaker && String(seg.speaker).trim()) foundInSegs.add(String(seg.speaker).trim());
            }
            if (foundInSegs.size > 0) {
                validSpeakers = Array.from(foundInSegs);
            }
        }
        const speakersText = validSpeakers.length > 0 ? validSpeakers.join(' 和 ') : '角色们';
        const defaultSpeaker = validSpeakers[0] || '角色';

        // 构建对话内容
        const dialogueContent = segments.map(seg => {
            const speaker = (seg.speaker && String(seg.speaker).trim()) ? String(seg.speaker).trim() : defaultSpeaker;
            const text = seg.text || seg.content || '';
            const emotion = seg.emotion ? ` [${seg.emotion}]` : '';
            return `**${speaker}**${emotion}: "${text}"`;
        }).join('\n\n');

        // 组装可折叠的消息，防止剧透
        let sceneDesc = sceneDescription ? `\n*${sceneDescription}*` : '';

        const message = `<st-tts-eavesdrop>
<details>
<summary>🎧 <strong>${speakersText}</strong> 正在私下交谈 <em>(点击展开)</em></summary>
${sceneDesc}

---

${dialogueContent}

---

*对话结束*
</details>
</st-tts-eavesdrop>`;

        return message;
    },

    /**
     * 将通话/窃听内容追加到最后一条 AI 消息中（不新增楼层）
     * 这样不会影响依赖楼层的触发逻辑，同时 LLM 下次对话能读到电话内容
     * 
     * @param {Object} options - 配置选项（同 injectAsMessage）
     * @returns {Promise<boolean>} 是否成功追加
     */
    async appendToLastAIMessage(options) {
        const context = window.SillyTavern?.getContext?.();
        if (!context) {
            console.error('[ChatInjector] ❌ 无法获取 SillyTavern 上下文');
            return false;
        }

        const { streamingProcessor, eventSource, eventTypes } = context;

        // 检测是否正在生成中
        const isGenerating = streamingProcessor?.isProcessing || streamingProcessor?.isFinished === false;

        if (isGenerating) {
            console.log('[ChatInjector] ⏳ 检测到正在生成中，等待生成完成后追加...');
            // 等待生成结束后再追加
            return new Promise((resolve) => {
                const handler = async () => {
                    eventSource.removeListener(eventTypes.GENERATION_ENDED, handler);
                    // 稍微延迟一下，确保消息已完全写入
                    await new Promise(r => setTimeout(r, 100));
                    const result = await this._doAppend(options);
                    resolve(result);
                };
                eventSource.on(eventTypes.GENERATION_ENDED, handler);
            });
        } else {
            return this._doAppend(options);
        }
    },

    /**
     * 执行追加操作
     * @private
     */
    async _doAppend(options) {
        const type = options.type || 'phone_call';
        const segments = options.segments || [];
        const sceneDescription = options.sceneDescription || options.scene_description || options.callReason || options.reason || '';

        if (!segments || segments.length === 0) {
            console.warn('[ChatInjector] ⚠️ 没有可追加的对话片段');
            return false;
        }

        try {
            const context = window.SillyTavern?.getContext?.();
            if (!context) {
                console.error('[ChatInjector] ❌ 无法获取 SillyTavern 上下文');
                return false;
            }

            const { chat, chatMetadata, updateMessageBlock, name1, saveMetadata } = context;
            const saveChat = context.saveChat;
            const userName = options.target || options.userName || options.user_name || name1 || '用户';

            // 智能解析 callerName，多层兜底
            let callerName = options.callerName || options.caller || options.char_name || options.selected_speaker || '';
            if (!callerName && context.characters && context.characterId !== undefined && context.characters[context.characterId]) {
                callerName = context.characters[context.characterId].name || '';
            } else if (!callerName && context.name2) {
                callerName = context.name2;
            }
            if (!callerName) {
                callerName = '神秘角色';
            }

            let speakers = options.speakers || (options.speaker ? [options.speaker] : []);
            if (speakers.length === 0 && type === 'eavesdrop') {
                const foundInSegs = new Set();
                for (const seg of segments) {
                    if (seg.speaker && seg.speaker.trim()) foundInSegs.add(seg.speaker.trim());
                }
                if (foundInSegs.size > 0) {
                    speakers = Array.from(foundInSegs);
                } else {
                    speakers = [callerName];
                }
            }

            // 找到最后一条 AI 消息的索引
            const lastAIIndex = this._findLastAIMessageIndex(chat);
            if (lastAIIndex === -1) {
                console.warn('[ChatInjector] ⚠️ 未找到可追加的 AI 消息，回退到创建新消息');
                return this.injectAsMessage({
                    ...options,
                    callerName,
                    speakers,
                    userName,
                    sceneDescription
                });
            }

            // 格式化电话/窃听内容
            let appendContent = '';
            if (type === 'phone_call') {
                appendContent = this._formatPhoneCallMessage(callerName, userName, segments, sceneDescription);
            } else if (type === 'eavesdrop') {
                appendContent = this._formatEavesdropMessage(speakers, segments, sceneDescription);
            }

            // 追加到消息末尾
            const targetMessage = chat[lastAIIndex];
            targetMessage.mes += '\n\n' + appendContent;

            // 如果消息有 extra 字段，添加追加记录
            if (!targetMessage.extra) {
                targetMessage.extra = {};
            }
            if (!targetMessage.extra.appended_content) {
                targetMessage.extra.appended_content = [];
            }
            targetMessage.extra.appended_content.push({
                type: type,
                timestamp: Date.now(),
                speakers: type === 'eavesdrop' ? speakers : [callerName]
            });

            // 🔑 关键：将追加信息保存到 chatMetadata，用于 swipe 后恢复
            if (!chatMetadata.pendingPhoneContents) {
                chatMetadata.pendingPhoneContents = {};
            }
            // 以消息索引为键保存追加信息
            if (!chatMetadata.pendingPhoneContents[lastAIIndex]) {
                chatMetadata.pendingPhoneContents[lastAIIndex] = [];
            }
            chatMetadata.pendingPhoneContents[lastAIIndex].push({
                options: options,
                formattedContent: appendContent,
                timestamp: Date.now()
            });

            console.log(`[ChatInjector] 📝 追加内容到消息 #${lastAIIndex}:`, appendContent.substring(0, 100) + '...');

            // 刷新 DOM 显示
            if (updateMessageBlock) {
                await this._refreshMessage(context, lastAIIndex, targetMessage);
            }

            // 保存聊天记录和元数据
            if (saveChat) {
                await saveChat();
            }
            if (saveMetadata) {
                await saveMetadata();
            }

            console.log('[ChatInjector] ✅ 内容已成功追加到最后一条 AI 消息');
            return true;

        } catch (error) {
            console.error('[ChatInjector] ❌ 追加失败:', error);
            return false;
        }
    },

    /**
     * 处理 swipe 事件
     * 当用户 swipe 一条消息时，记录该消息索引，等待新消息生成后恢复
     * @private
     */
    _handleSwipe(messageIndex) {
        const context = window.SillyTavern?.getContext?.();
        if (!context) return;

        const { chatMetadata } = context;
        const pendingContents = chatMetadata.pendingPhoneContents?.[messageIndex];

        if (pendingContents && pendingContents.length > 0) {
            console.log(`[ChatInjector] 🔄 检测到消息 #${messageIndex} 被 swipe，该消息有 ${pendingContents.length} 条待恢复的电话内容`);

            // 标记需要恢复
            if (!chatMetadata._swipePendingRestore) {
                chatMetadata._swipePendingRestore = {};
            }
            chatMetadata._swipePendingRestore[messageIndex] = pendingContents;
        }
    },

    /**
     * 检查并恢复追加的内容
     * 在新消息接收后调用，检查是否有需要恢复的电话内容
     * @private
     */
    async _checkAndRestoreAppendedContent(messageIndex) {
        const context = window.SillyTavern?.getContext?.();
        if (!context) return;

        const { chatMetadata, chat, updateMessageBlock, saveMetadata } = context;
        const saveChat = context.saveChat;

        // 检查是否有待恢复的内容
        const pendingRestore = chatMetadata._swipePendingRestore;
        if (!pendingRestore) return;

        // 遍历所有待恢复的消息
        for (const [originalIndex, contents] of Object.entries(pendingRestore)) {
            const idx = parseInt(originalIndex);

            // 如果新消息的索引与原消息索引匹配（swipe 不改变索引）
            if (idx === messageIndex && contents && contents.length > 0) {
                console.log(`[ChatInjector] 🔄 恢复消息 #${idx} 的 ${contents.length} 条电话内容`);

                const targetMessage = chat[idx];
                if (!targetMessage) continue;

                // 重新追加所有电话内容
                for (const content of contents) {
                    targetMessage.mes += '\n\n' + content.formattedContent;

                    // 更新 extra 记录
                    if (!targetMessage.extra) {
                        targetMessage.extra = {};
                    }
                    if (!targetMessage.extra.appended_content) {
                        targetMessage.extra.appended_content = [];
                    }
                    targetMessage.extra.appended_content.push({
                        type: content.options.type,
                        timestamp: Date.now(),
                        restored: true,
                        originalTimestamp: content.timestamp
                    });
                }

                // 刷新 DOM
                if (updateMessageBlock) {
                    await this._refreshMessage(context, idx, targetMessage);
                }

                // 更新 pendingPhoneContents（保持最新）
                chatMetadata.pendingPhoneContents[idx] = contents;

                console.log(`[ChatInjector] ✅ 已恢复消息 #${idx} 的电话内容`);
            }
        }

        // 清除待恢复标记
        delete chatMetadata._swipePendingRestore;

        // 保存
        if (saveChat) {
            await saveChat();
        }
        if (saveMetadata) {
            await saveMetadata();
        }
    },

    /**
     * 查找最后一条 AI 消息的索引
     * @private
     * @param {Array} chat - 聊天记录数组
     * @returns {number} 消息索引，未找到返回 -1
     */
    async _refreshMessage(context, index, message) {
        await context.updateMessageBlock(index, message);
        // Follow the host edit lifecycle to restore regex and HTML extension rendering.
        for (const type of ['MESSAGE_UPDATED', 'CHARACTER_MESSAGE_RENDERED']) {
            if (context.eventSource && context.eventTypes?.[type]) {
                await context.eventSource.emit(context.eventTypes[type], index);
            }
        }
    },

    _findLastAIMessageIndex(chat) {
        if (!chat || chat.length === 0) {
            return -1;
        }
        // 从后往前找第一条非用户消息
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && chat[i].mes) {
                return i;
            }
        }
        return -1;
    }
};

export default ChatInjector;

