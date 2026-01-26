/**
 * 上下文收集器
 * 
 * 从 SillyTavern 收集对话上下文、角色信息等数据
 */

export const ContextCollector = {
    /**
     * 收集酒馆上下文
     * 
     * @param {Object} options 配置选项
     * @param {number} options.maxMessages - 最大消息数 (默认20)
     * @param {boolean} options.includeCharacter - 包含角色信息 (默认true)
     * @param {boolean} options.includeMetadata - 包含聊天元数据 (默认false)
     * @param {boolean} options.includeRaw - 包含原始数据 (默认false)
     * 
     * @returns {Object} 收集的数据
     */
    collect(options = {}) {
        const {
            maxMessages = 20,
            includeCharacter = true,
            includeMetadata = false,
            includeRaw = false
        } = options;

        const result = {
            messages: [],
            character: null,
            metadata: null,
            chatId: null,
            timestamp: new Date().toISOString()
        };

        try {
            // 检查 SillyTavern 是否可用
            if (!window.SillyTavern || !window.SillyTavern.getContext) {
                console.warn('[ContextCollector] ⚠️ SillyTavern 不可用');
                return result;
            }

            const context = window.SillyTavern.getContext();
            if (!context) {
                console.warn('[ContextCollector] ⚠️ 无法获取上下文');
                return result;
            }

            const { chat, characters, characterId, chatId, name1, name2 } = context;

            // 收集消息
            if (chat && Array.isArray(chat)) {
                const messages = chat.slice(-maxMessages);
                result.messages = messages.map(msg => ({
                    name: msg.name || (msg.is_user ? name1 : name2),
                    is_user: msg.is_user || false,
                    mes: msg.mes || "",
                    // 标准格式字段
                    role: msg.is_user ? 'user' : 'assistant',
                    content: msg.mes || ""
                }));
            }

            // 收集角色信息
            if (includeCharacter && characters && characterId !== undefined) {
                const currentChar = characters.find(c => c.avatar === characterId);
                if (currentChar) {
                    result.character = {
                        name: currentChar.name,
                        persona: currentChar.description || currentChar.persona || "",
                        first_message: currentChar.first_mes || "",
                        scenario: currentChar.scenario || "",
                        avatar: currentChar.avatar
                    };

                    if (includeRaw) {
                        result.character.raw = currentChar;
                    }
                }
            }

            // 收集元数据
            if (includeMetadata) {
                result.metadata = context.chatMetadata || {};
            }

            // 聊天ID
            result.chatId = chatId || null;

            console.log(`[ContextCollector] ✅ 收集完成: ${result.messages.length} 条消息`);

        } catch (error) {
            console.error('[ContextCollector] ❌ 收集失败:', error);
        }

        return result;
    },

    /**
     * 获取当前聊天分支ID
     */
    getChatBranch() {
        try {
            const context = window.SillyTavern?.getContext();
            if (context && context.chatId) {
                return context.chatId.replace(/\.(jsonl|json)$/i, "");
            }
        } catch (e) {
            console.error('[ContextCollector] 获取 chatBranch 失败:', e);
        }
        return "default";
    },

    /**
     * 获取当前角色名称
     */
    getCharacterName() {
        try {
            const context = window.SillyTavern?.getContext();
            if (context) {
                const { characters, characterId, name2 } = context;
                const currentChar = characters?.find(c => c.avatar === characterId);
                return currentChar?.name || name2 || null;
            }
        } catch (e) {
            console.error('[ContextCollector] 获取角色名失败:', e);
        }
        return null;
    },

    /**
     * 初始化
     */
    init() {
        console.log('[ContextCollector] 📚 上下文收集器已初始化');
    }
};

// 暴露到全局
if (typeof window !== 'undefined') {
    window.ContextCollector = ContextCollector;
}

export default ContextCollector;
