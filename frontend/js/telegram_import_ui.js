import { ContextDataCollector } from './context_data_collector.js';

if (!window.TTS_UI) {
    window.TTS_UI = {};
}

export const TTS_UI = window.TTS_UI;

(function (scope) {
    function ensureTelegramCache() {
        if (!window.TTS_State.CACHE.telegram) {
            window.TTS_State.CACHE.telegram = {
                packs: [],
                charactersByPack: {},
                bots: []
            };
        }
        return window.TTS_State.CACHE.telegram;
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    scope.loadTelegramAssets = async function () {
        const cache = ensureTelegramCache();
        const [packsResult, botsResult] = await Promise.all([
            window.TTS_API.listTelegramPacks(),
            window.TTS_API.listTelegramBots()
        ]);

        cache.packs = packsResult.packs || [];
        cache.bots = botsResult.bots || [];
        cache.charactersByPack = {};

        await Promise.all(cache.packs.map(async (pack) => {
            try {
                const result = await window.TTS_API.listTelegramPackCharacters(pack.pack_id);
                cache.charactersByPack[pack.pack_id] = result.characters || [];
            } catch (error) {
                console.warn('[TelegramImportUI] 读取资产包角色失败:', pack.pack_id, error);
                cache.charactersByPack[pack.pack_id] = [];
            }
        }));

        return cache;
    };

    scope.renderTelegramManager = async function () {
        const $summary = $('#tts-telegram-pack-summary');
        const $bindings = $('#tts-telegram-bot-bindings');
        if (!$summary.length || !$bindings.length) return;

        $summary.text('正在加载 Telegram 资产...');
        $bindings.empty();

        try {
            const cache = await scope.loadTelegramAssets();
            const allCharacters = cache.packs.flatMap(pack => {
                const chars = cache.charactersByPack[pack.pack_id] || [];
                return chars.map(char => ({ ...char, pack_id: pack.pack_id, pack_name: pack.name }));
            });

            $summary.html(`
                <div class="tts-list-item" style="margin-bottom:8px;">
                    <span class="col-name">资产包</span>
                    <span class="col-model">${cache.packs.length}</span>
                </div>
                <div class="tts-list-item" style="margin-bottom:8px;">
                    <span class="col-name">已导入角色</span>
                    <span class="col-model">${allCharacters.length}</span>
                </div>
                <div class="tts-list-item">
                    <span class="col-name">Telegram Bots</span>
                    <span class="col-model">${cache.bots.length}</span>
                </div>
            `);

            if (!cache.bots.length) {
                $bindings.html('<div class="tts-empty">当前没有配置 Telegram bots。</div>');
                return;
            }

            const optionsHtml = ['<option value="">未绑定</option>']
                .concat(allCharacters.map(char => `
                    <option value="${escapeHtml(char.character_ref)}">${escapeHtml(char.pack_name || char.pack_id)} / ${escapeHtml(char.name)} (${escapeHtml(char.character_ref)})</option>
                `))
                .join('');

            const rows = cache.bots.map(bot => `
                <div class="tts-list-item" style="display:block; margin-bottom:10px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:8px; align-items:center;">
                        <div>
                            <div style="font-weight:600;">${escapeHtml(bot.bot_id || '')}</div>
                            <div style="font-size:12px; color:#aaa;">当前 character_ref: ${escapeHtml(bot.character_ref || '-')}</div>
                        </div>
                        <div style="font-size:12px; color:#888;">${bot.enabled === false ? '已禁用' : '启用中'}</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <select class="tts-modern-input tts-telegram-bot-character" data-bot-id="${escapeHtml(bot.bot_id || '')}" style="flex:1; min-width:0;">
                            ${optionsHtml}
                        </select>
                        <button class="btn-primary tts-save-telegram-binding" data-bot-id="${escapeHtml(bot.bot_id || '')}">保存绑定</button>
                    </div>
                </div>
            `).join('');

            $bindings.html(rows);
            cache.bots.forEach(bot => {
                $bindings.find(`.tts-telegram-bot-character[data-bot-id="${bot.bot_id}"]`).val(bot.character_ref || '');
            });
            
            // 强制重新挂载事件（以避免由于缓存导致的主题事件绑定失效）
            $bindings.find('.tts-save-telegram-binding').off('click').on('click', async function() {
                const botId = $(this).attr('data-bot-id');
                const handler = window.TTS_UI.saveTelegramBotBinding || scope.saveTelegramBotBinding;
                if (botId && handler) {
                    await handler(botId);
                } else {
                    alert(`绑定错误: botId=${botId}, handler=${!!handler}`);
                }
            });
        } catch (error) {
            console.error('[TelegramImportUI] 加载 Telegram 资产失败:', error);
            $summary.text('加载 Telegram 资产失败');
            $bindings.html(`<div class="tts-empty">${escapeHtml(error.message || error)}</div>`);
        }
    };

    scope.openTelegramImportWizard = async function () {
        const stContext = window.SillyTavern?.getContext?.();
        if (!stContext || !stContext.callGenericPopup) {
            alert('当前无法打开酒馆导入向导：SillyTavern popup API 不可用。');
            return;
        }

        const charInfo = ContextDataCollector.getCharacterInfo();
        const cardData = ContextDataCollector.collectCharacterCardData();
        const worldbookEntries = ContextDataCollector.collectWorldBookEntries();
        const context = window.SillyTavern?.getContext?.();
        const chatMessages = ContextDataCollector.extractContextMessages(context?.chat || [], 12);

        window.__ttsTelegramImportState = {
            includeCard: true,
            includeWorldbook: true,
            includeChat: false,
            includeStory: false,
            targetMode: 'free_chat',
            outputStyle: 'standard',
            packName: (charInfo?.charName || 'telegram_pack'),
            generationGoal: '',
            contextNotes: '',
            selectedWorldbookIndexes: new Set(worldbookEntries.filter(entry => entry.constant).map((_, idx) => idx))
        };

        const worldbookHtml = worldbookEntries.length
            ? worldbookEntries.map((entry, index) => {
                const checked = entry.constant ? 'checked' : '';
                return `
                    <div style="margin-bottom:8px; padding:8px; border:1px solid rgba(255,255,255,0.08); border-radius:6px;">
                        <label style="display:flex; gap:8px; align-items:flex-start; cursor:pointer;">
                            <input type="checkbox" ${checked}
                                onchange="if(this.checked) window.__ttsTelegramImportState.selectedWorldbookIndexes.add(${index}); else window.__ttsTelegramImportState.selectedWorldbookIndexes.delete(${index});"
                                style="margin-top:4px;">
                            <div>
                                <div style="font-weight:600;">${escapeHtml(entry.comment || `条目${index + 1}`)}</div>
                                <div style="font-size:12px; color:#aaa; max-height:72px; overflow:auto;">${escapeHtml(entry.content || '')}</div>
                            </div>
                        </label>
                    </div>
                `;
            }).join('')
            : '<div style="font-size:12px; color:#888;">当前没有可导入的世界书条目。</div>';

        const html = `
            <div style="display:flex; flex-direction:column; gap:12px; max-height:70vh; overflow:auto; padding-right:8px;">
                <div>
                    <h3 style="margin:0 0 8px 0;">导入 Telegram 资产</h3>
                    <div style="font-size:12px; color:#aaa; line-height:1.5;">素材来自当前酒馆上下文，后端会调用一次 LLM 生成 asset pack 预览。</div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div>
                        <div style="font-size:12px; margin-bottom:4px;">Pack 名称</div>
                        <input type="text" value="${escapeHtml(window.__ttsTelegramImportState.packName)}" style="width:100%;" oninput="window.__ttsTelegramImportState.packName=this.value;">
                    </div>
                    <div>
                        <div style="font-size:12px; margin-bottom:4px;">目标模式</div>
                        <select style="width:100%;" onchange="window.__ttsTelegramImportState.targetMode=this.value; window.__ttsTelegramImportState.includeStory=(this.value!=='free_chat');">
                            <option value="free_chat">free_chat</option>
                            <option value="scripted_story">scripted_story</option>
                            <option value="murder_mystery">murder_mystery</option>
                        </select>
                    </div>
                </div>
                <div>
                    <div style="font-size:12px; margin-bottom:4px;">生成目标说明</div>
                    <textarea rows="3" style="width:100%;" oninput="window.__ttsTelegramImportState.generationGoal=this.value;" placeholder="例如：生成一个适合 Telegram 多 bot 扮演的悬疑群像剧情包"></textarea>
                </div>
                <div>
                    <div style="font-size:12px; margin-bottom:6px;">导入素材</div>
                    <label style="display:block; margin-bottom:6px;"><input type="checkbox" checked onchange="window.__ttsTelegramImportState.includeCard=this.checked;"> 角色卡基础数据</label>
                    <label style="display:block; margin-bottom:6px;"><input type="checkbox" checked onchange="window.__ttsTelegramImportState.includeWorldbook=this.checked;"> 世界书条目</label>
                    <label style="display:block; margin-bottom:6px;"><input type="checkbox" onchange="window.__ttsTelegramImportState.includeChat=this.checked;"> 最近聊天样例 (${chatMessages.length} 条可用)</label>
                </div>
                <div>
                    <div style="font-size:12px; margin-bottom:6px;">世界书条目选择</div>
                    ${worldbookHtml}
                </div>
                <div>
                    <div style="font-size:12px; margin-bottom:4px;">补充说明</div>
                    <textarea rows="3" style="width:100%;" oninput="window.__ttsTelegramImportState.contextNotes=this.value;" placeholder="可补充说明生成风格、约束或玩法"></textarea>
                </div>
            </div>
        `;

        const confirmed = await stContext.callGenericPopup(html, stContext.POPUP_TYPE.CONFIRM, '', {
            okButton: '生成预览',
            cancelButton: '取消',
            wider: true
        });

        if (!confirmed) {
            return;
        }

        const state = window.__ttsTelegramImportState;
        const selectedWorldbookEntries = state.includeWorldbook
            ? worldbookEntries.filter((_, index) => state.selectedWorldbookIndexes.has(index))
            : [];

        const payload = {
            source: {
                char_name: charInfo?.charName || '',
                chat_branch: ContextDataCollector.getCurrentChatBranch()
            },
            materials: {
                card_data: state.includeCard ? (cardData || null) : null,
                worldbook_entries: selectedWorldbookEntries,
                example_messages: state.includeChat ? chatMessages : [],
                context_notes: state.contextNotes || ''
            },
            options: {
                pack_id: state.packName || '',
                pack_name: state.packName || '',
                target_mode: state.targetMode || 'free_chat',
                generation_goal: state.generationGoal || '',
                include_story: state.targetMode !== 'free_chat',
                include_director_rules: true,
                output_style: state.outputStyle || 'standard'
            }
        };

        try {
            if (typeof toastr !== 'undefined') {
                toastr.info('正在生成 Telegram 资产预览...', '请稍候', { timeOut: 0 });
            }
            const preview = await window.TTS_API.previewTelegramImport(payload);
            if (typeof toastr !== 'undefined') toastr.clear();
            await scope.showTelegramImportPreview(preview);
        } catch (error) {
            if (typeof toastr !== 'undefined') toastr.clear();
            console.error('[TelegramImportUI] 生成导入预览失败:', error);
            alert(`Telegram 导入预览失败: ${error.message || error}`);
        }
    };

    scope.showTelegramImportPreview = async function (preview) {
        const stContext = window.SillyTavern?.getContext?.();
        if (!stContext || !stContext.callGenericPopup) {
            alert('无法显示导入预览。');
            return;
        }

        const pack = preview.pack || {};
        const characters = pack.characters || [];
        const stories = pack.stories || [];
        const warnings = preview.warnings || [];

        const html = `
            <div style="display:flex; flex-direction:column; gap:12px; max-height:70vh; overflow:auto; padding-right:8px;">
                <div>
                    <h3 style="margin:0 0 8px 0;">Telegram 资产预览</h3>
                    <div style="font-size:12px; color:#aaa;">pack_id=${escapeHtml(pack.pack_id || '')}</div>
                </div>
                <div style="padding:10px; border:1px solid rgba(255,255,255,0.08); border-radius:6px;">
                    <div><strong>名称:</strong> ${escapeHtml(pack.name || '')}</div>
                    <div style="margin-top:6px;"><strong>世界摘要:</strong> ${escapeHtml(pack.world?.summary || '')}</div>
                    <div style="margin-top:6px;"><strong>角色数:</strong> ${characters.length} | <strong>故事数:</strong> ${stories.length}</div>
                </div>
                <div>
                    <div style="font-weight:600; margin-bottom:6px;">角色</div>
                    ${characters.map(character => `
                        <div style="margin-bottom:8px; padding:8px; border:1px solid rgba(255,255,255,0.08); border-radius:6px;">
                            <div><strong>${escapeHtml(character.name || '')}</strong> (${escapeHtml(character.character_ref || '')})</div>
                            <div style="font-size:12px; color:#aaa; margin-top:4px;">${escapeHtml(character.personality || character.description || '')}</div>
                        </div>
                    `).join('') || '<div style="color:#888;">没有生成角色</div>'}
                </div>
                <div>
                    <div style="font-weight:600; margin-bottom:6px;">故事</div>
                    ${stories.map(story => `
                        <div style="margin-bottom:8px; padding:8px; border:1px solid rgba(255,255,255,0.08); border-radius:6px;">
                            <div><strong>${escapeHtml(story.title || story.story_id || '')}</strong> (${escapeHtml(story.mode || '')})</div>
                            <div style="font-size:12px; color:#aaa; margin-top:4px;">${escapeHtml(story.opening || '')}</div>
                        </div>
                    `).join('') || '<div style="color:#888;">没有生成故事</div>'}
                </div>
                ${warnings.length ? `<div><div style="font-weight:600; margin-bottom:6px; color:#ffb86c;">提示</div>${warnings.map(item => `<div style="font-size:12px; color:#ffb86c;">- ${escapeHtml(item)}</div>`).join('')}</div>` : ''}
            </div>
        `;

        const confirmed = await stContext.callGenericPopup(html, stContext.POPUP_TYPE.CONFIRM, '', {
            okButton: '保存资产包',
            cancelButton: '取消',
            wider: true
        });

        if (!confirmed) {
            return;
        }

        try {
            const result = await window.TTS_API.commitTelegramImport(pack);
            if (typeof toastr !== 'undefined') {
                toastr.success(`Telegram 资产已保存: ${result.saved?.pack_id || pack.pack_id}`);
            }
            await scope.renderTelegramManager();
        } catch (error) {
            console.error('[TelegramImportUI] 保存 Telegram 资产失败:', error);
            alert(`保存 Telegram 资产失败: ${error.message || error}`);
        }
    };

    scope.saveTelegramBotBinding = async function (botId) {
        const $select = $(`.tts-telegram-bot-character[data-bot-id="${botId}"]`);
        const characterRef = $select.val() || '';
        try {
            await window.TTS_API.bindTelegramBot(botId, characterRef);
            if (typeof toastr !== 'undefined') {
                toastr.success(`已更新 ${botId} 的角色绑定`);
            }
            await scope.renderTelegramManager();
        } catch (error) {
            console.error('[TelegramImportUI] 保存 Telegram bot 绑定失败:', error);
            alert(`保存 Telegram bot 绑定失败: ${error.message || error}`);
        }
    };

})(window.TTS_UI);
