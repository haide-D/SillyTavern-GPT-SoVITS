/**
 * SillyTavern 世界书与角色卡提取服务 (World Info & Persona Extractor)
 * 
 * 职责:
 * 1. 自动从 SillyTavern 原生角色卡提取 Persona (Description, Personality, Scenario)
 * 2. 提取当前聊天激活的世界书 (World Info / Lorebook)
 * 3. 对历史上下文进行轻量化智能截取 (默认最近 10-12 条)，防止 Token 爆炸与焦点分散
 * 4. 聚合输出结构化的场景富上下文 (Enriched Scene Context)
 */

export class WorldInfoExtractor {

    static _worldInfoCache = null;

    static _chatKey(ctx) {
        return JSON.stringify([ctx?.characterId, ctx?.groupId, ctx?.chatId, ctx?.name1]);
    }

    static async refreshWorldInfo() {
        const ctx = this.getSTContext();
        if (!ctx?.getWorldInfoPrompt) return this.getWorldInfo();
        const key = this._chatKey(ctx);
        const character = ctx.characters?.[ctx.characterId] || {};
        try {
            // Dry run: respect the host activation rules without modifying timed effects.
            const result = await ctx.getWorldInfoPrompt(
                (ctx.chat || []).map(msg => msg.mes || '').reverse(),
                Number(ctx.maxContext) || 8192, true,
                { trigger: 'normal', personaDescription: ctx.powerUserSettings?.persona_description || '',
                  characterDescription: character.description || '', characterPersonality: character.personality || '',
                  characterDepthPrompt: character.data?.extensions?.depth_prompt?.prompt || '',
                  scenario: character.scenario || '', creatorNotes: character.data?.creator_notes || '' }
            );
            const parts = [result.worldInfoBefore, result.worldInfoAfter];
            for (const list of [result.worldInfoExamples, result.worldInfoDepth, result.anBefore, result.anAfter, ...Object.values(result.outletEntries || {})]) {
                for (const entry of (Array.isArray(list) ? list : [list])) {
                    parts.push(typeof entry === 'string' ? entry : entry?.content);
                }
            }
            const text = [...new Set(parts.filter(part => typeof part === 'string' && part.trim()))].join('\n---\n');
            if (this._chatKey(this.getSTContext()) !== key) return '';
            this._worldInfoCache = { key, text };
            return text;
        } catch (error) {
            this._worldInfoCache = null;
            console.warn('[WorldInfoExtractor] 原生世界书扫描失败:', error);
            return '';
        }
    }

    /**
     * 获取 SillyTavern 原生 Context 对象
     */
    static getSTContext() {
        try {
            if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
                return window.SillyTavern.getContext();
            }
        } catch (e) {
            console.warn('[WorldInfoExtractor] 获取 SillyTavern 上下文失败:', e);
        }
        return null;
    }

    /**
     * 提取指定角色（或当前活跃角色）的完整人设档案
     * @param {string|number|null} targetCharNameOrId 角色名称或 ID
     * @returns {string} 格式化的人设摘要字符串
     */
    static getCharacterPersona(targetCharNameOrId = null) {
        const ctx = this.getSTContext();
        if (!ctx || !ctx.characters) return "";

        let charObj = null;

        if (typeof targetCharNameOrId === 'number' && ctx.characters[targetCharNameOrId]) {
            charObj = ctx.characters[targetCharNameOrId];
        } else if (typeof targetCharNameOrId === 'string' && targetCharNameOrId) {
            charObj = ctx.characters.find(c => c && c.name === targetCharNameOrId);
        }

        // 如果未找到指定角色，默认取当前主角色
        if (!charObj && ctx.characterId !== undefined && ctx.characters[ctx.characterId]) {
            charObj = ctx.characters[ctx.characterId];
        }

        if (!charObj) return "";

        const parts = [];
        if (charObj.name) parts.push(`【角色名称】${charObj.name}`);
        if (charObj.description) parts.push(`【身份描述】${charObj.description.trim()}`);
        if (charObj.personality) parts.push(`【性格特征】${charObj.personality.trim()}`);
        if (charObj.scenario) parts.push(`【场景背景】${charObj.scenario.trim()}`);

        return parts.join('\n');
    }

    /**
     * 提取多角色群聊下所有在场角色的合集人设
     * @param {Array<string>} speakerNames 角色名数组
     * @returns {string} 格式化的多人人设
     */
    static getMultiCharacterPersonas(speakerNames = []) {
        if (!Array.isArray(speakerNames) || speakerNames.length === 0) {
            return this.getCharacterPersona();
        }

        const list = [];
        for (const name of speakerNames) {
            const p = this.getCharacterPersona(name);
            if (p) list.push(p);
        }

        return list.join('\n\n');
    }

    /**
     * 提取当前激活的世界书 / Lorebook 设定
     * @param {number} maxEntries 最大条目数 (防止过长)
     * @returns {string} 世界书背景设定文本
     */
    static getWorldInfo(maxEntries = 6) {
        const ctx = this.getSTContext();
        if (!ctx) return "";

        if (this._worldInfoCache?.key === this._chatKey(ctx)) return this._worldInfoCache.text;
        const entries = [];

        try {
            // 1. 尝试从 ctx.world_info 提取
            if (ctx.world_info) {
                if (typeof ctx.world_info === 'string') {
                    entries.push(ctx.world_info);
                } else if (Array.isArray(ctx.world_info)) {
                    ctx.world_info.slice(0, maxEntries).forEach(item => {
                        const content = item.content || item.entry || (typeof item === 'string' ? item : '');
                        if (content) entries.push(content.trim());
                    });
                } else if (typeof ctx.world_info === 'object') {
                    Object.values(ctx.world_info).slice(0, maxEntries).forEach(item => {
                        const content = (item && (item.content || item.entry)) || (typeof item === 'string' ? item : '');
                        if (content) entries.push(content.trim());
                    });
                }
            }

            // 2. 尝试从全局 window.world_info 或 world_info_data 补充
            if (entries.length === 0 && window.world_info) {
                if (typeof window.world_info === 'string') {
                    entries.push(window.world_info);
                }
            }
        } catch (e) {
            console.warn('[WorldInfoExtractor] 提取世界书异常:', e);
        }

        return entries.filter(Boolean).join('\n---\n');
    }

    /**
     * 轻量化提取最近的聊天上下文 (默认 10-12 条)
     * @param {number} maxMessages 截取条数
     * @returns {{ context: Array, speakers: Array, fingerprints: Array, userName: string, charName: string }}
     */
    static getTrimmedContext(maxMessages = 12) {
        const ctx = this.getSTContext();
        let userName = "用户";
        let charName = "未知角色";
        let chatBranch = "default_branch";
        let context = [];
        let speakers = [];
        let fingerprints = [];

        if (ctx) {
            if (ctx.name1) userName = ctx.name1;
            if (ctx.name2) charName = ctx.name2;
            else if (ctx.characterId !== undefined && ctx.characters && ctx.characters[ctx.characterId]) {
                charName = ctx.characters[ctx.characterId].name || charName;
            }

            if (ctx.chatId) {
                chatBranch = ctx.chatId;
            }

            if (ctx.chat && Array.isArray(ctx.chat)) {
                // 截取最近消息并保留指纹
                const recent = ctx.chat.slice(-maxMessages);
                context = recent.map(msg => {
                    let text = msg.mes || "";
                    // 自动清洗插件自身注入的电话卡片与大模型思考标签，避免上下文递归污染
                    text = text.replace(/<st-tts-call[\s\S]*?<\/st-tts-call>/gi, '');
                    text = text.replace(/<think[\s\S]*?<\/think>/gi, '');
                    text = text.replace(/<think_nya~[\s\S]*?<\/think_nya~>/gi, '');
                    return {
                        name: msg.name || (msg.is_user ? userName : charName),
                        is_user: !!msg.is_user,
                        mes: text.trim(),
                        fingerprint: msg.fingerprint || msg.extra?.fingerprint || ""
                    };
                });

                const speakerSet = new Set();
                ctx.chat.forEach(msg => {
                    if (!msg.is_user && msg.name) {
                        speakerSet.add(msg.name);
                    }
                    const fp = msg.fingerprint || msg.extra?.fingerprint;
                    if (fp) {
                        fingerprints.push(fp);
                    }
                });
                speakers = Array.from(speakerSet);
            }
        }

        if (speakers.length === 0 && charName) {
            speakers = [charName];
        }

        return { context, speakers, fingerprints, userName, charName, chatBranch };
    }

    /**
     * 聚合提取完整的场景富上下文 (Enriched Context)
     * 涵盖：角色卡人设、世界书、轻量化最近上下文与说话人
     * @param {Object} options 配置选项 { charName, speakerNames, maxMessages }
     */
    static getEnrichedContext(options = {}) {
        const maxMessages = options.maxMessages || 12;
        const base = this.getTrimmedContext(maxMessages);

        const targetChar = options.charName || base.charName;
        const speakerList = options.speakerNames || base.speakers;

        // 提取人设
        const persona = (speakerList.length > 1) 
            ? this.getMultiCharacterPersonas(speakerList) 
            : this.getCharacterPersona(targetChar);

        // 提取世界书
        const worldInfo = this.getWorldInfo();

        return {
            charName: targetChar,
            userName: base.userName,
            chatBranch: base.chatBranch,
            context: base.context,
            speakers: speakerList,
            fingerprints: base.fingerprints,
            characterPersona: persona,
            worldInfo: worldInfo
        };
    }
}
