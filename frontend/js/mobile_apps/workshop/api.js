/**
 * 剧本工坊数据访问层与上下文提取器
 */
import { PhoneCallAPIClient } from '../../phone_call_api_client.js';
import { WorldInfoExtractor } from '../../world_info_extractor.js';
import { getAuthHeaders } from '../shared/utils.js';

let _boundSpeakersCache = [];

/**
 * 获取 API 地址
 */
export function getApiHost() {
    if (window.TTS_ThemeEngine && typeof window.TTS_ThemeEngine.getApiHost === 'function' && window.TTS_ThemeEngine.getApiHost()) {
        return window.TTS_ThemeEngine.getApiHost();
    }
    if (typeof PhoneCallAPIClient !== 'undefined' && PhoneCallAPIClient.getApiHost) {
        return PhoneCallAPIClient.getApiHost();
    }
    if (window.TTS_API && window.TTS_API.baseUrl) {
        return window.TTS_API.baseUrl;
    }
    return 'http://127.0.0.1:3000';
}

/**
 * 获取当前系统配置的 LLM 参数 (来自设置 phone_call.llm)
 */
export async function getLlmConfig() {
    try {
        const apiHost = getApiHost();
        const dataRes = await fetch(`${apiHost}/api/get_data`, { headers: getAuthHeaders() }).then(r => r.json());
        const phoneCallConfig = (dataRes && dataRes.settings && dataRes.settings.phone_call) || {};
        const llmConfig = phoneCallConfig.llm || {};
        return {
            api_url: (llmConfig.api_url || '').trim(),
            api_key: (llmConfig.api_key || '').trim(),
            model: (llmConfig.model || '').trim(),
            temperature: llmConfig.temperature !== undefined ? llmConfig.temperature : 0.8,
            max_tokens: llmConfig.max_tokens || 4000
        };
    } catch (e) {
        console.warn('[Workshop] 获取 LLM 配置失败:', e);
        return {
            api_url: '',
            api_key: '',
            model: '',
            temperature: 0.8,
            max_tokens: 4000
        };
    }
}

/**
 * 提取当前角色、已绑定 Speakers、SillyTavern 角色人设与世界书
 */
export async function getContextInfo() {
    // 1. 获取后端已绑定 TTS 模型的 Speaker 列表
    try {
        const apiHost = getApiHost();
        const dataRes = await fetch(`${apiHost}/api/get_data`, { headers: getAuthHeaders() }).then(r => r.json());
        if (dataRes && dataRes.mappings) {
            _boundSpeakersCache = Object.keys(dataRes.mappings);
        }
    } catch (e) {
        console.warn('[Workshop] 获取已绑定 Speaker 失败:', e);
    }

    // 2. 通过标准提取器获取 SillyTavern 角色卡、世界书与轻量化上下文
    await WorldInfoExtractor.refreshWorldInfo();
    const enriched = WorldInfoExtractor.getEnrichedContext({ maxMessages: 12 });

    // 过滤出真正已绑定 TTS 模型的有效 Speakers
    let validBoundSpeakers = _boundSpeakersCache;
    if (validBoundSpeakers.length === 0 && enriched.charName) {
        validBoundSpeakers = [enriched.charName];
    }

    return { 
        charName: enriched.charName, 
        context: enriched.context, 
        activeSpeakers: enriched.speakers, 
        boundSpeakers: validBoundSpeakers, 
        userName: enriched.userName, 
        characterPersona: enriched.characterPersona, 
        worldInfo: enriched.worldInfo,
        chatBranch: enriched.chatBranch,
        contextFingerprint: enriched.contextFingerprint
    };
}

export function getSpeakerLanguageHint(speakerName) {
    if (!speakerName) return { recommended: 'zh', hint: '默认' };
    const cache = (window.TTS_State && window.TTS_State.CACHE) || {};
    const mappings = cache.mappings || {};
    const models = cache.models || {};
    const modelName = mappings[speakerName] || speakerName;
    const speakerModel = models[modelName];
    if (!speakerModel || !speakerModel.languages) {
        return { recommended: 'zh', hint: '默认' };
    }
    const langs = Object.keys(speakerModel.languages).filter(k => Array.isArray(speakerModel.languages[k]) && speakerModel.languages[k].length > 0);
    if (langs.includes('English') && !langs.includes('Chinese') && !langs.includes('default')) {
        return { recommended: 'en', hint: '💡 模型含英文音频，推荐英文' };
    }
    if (langs.includes('Japanese') && !langs.includes('Chinese') && !langs.includes('default')) {
        return { recommended: 'ja', hint: '💡 模型含纯日语音频，推荐日文' };
    }
    if (langs.includes('Japanese') && langs.includes('English')) {
        return { recommended: 'zh', hint: '✨ 支持中/英/日多语' };
    }
    if (langs.includes('English')) {
        return { recommended: 'zh', hint: '✨ 支持中/英双语' };
    }
    if (langs.includes('Japanese')) {
        return { recommended: 'ja', hint: '✨ 支持中/日双语' };
    }
    return { recommended: 'zh', hint: '🇨🇳 中文' };
}

/**
 * 校验指定角色在指定语言下是否存在可用的参考音频
 * @param {string} speakerName 说话人/角色名
 * @param {string} langCode 语言代码 (zh/en/ja/auto)
 * @returns {{ valid: boolean, message?: string, modelName?: string }}
 */
export function validateSpeakerLanguageAudio(speakerName, langCode) {
    if (!speakerName) return { valid: false, message: "未指定有效的说话人角色" };
    
    const cache = (window.TTS_State && window.TTS_State.CACHE) || {};
    const mappings = cache.mappings || {};
    const models = cache.models || {};
    const modelName = mappings[speakerName] || speakerName;

    // MiniMax 云端模型跳过本地音频校验
    if (typeof modelName === 'string' && (modelName.startsWith('minimax:') || modelName.startsWith('minimax_'))) {
        return { valid: true, modelName };
    }

    const speakerModel = models[modelName];
    if (!speakerModel || !speakerModel.languages) {
        // 如果缓存未就绪，放行由后端接口做精准校验
        return { valid: true, modelName };
    }

    const languages = speakerModel.languages || {};
    
    const langKeyMap = {
        'zh': ['Chinese', 'default', '中文'],
        'en': ['English', '英文'],
        'ja': ['Japanese', '日文']
    };
    const langNameMap = {
        'zh': '中文 (Chinese)',
        'en': '英文 (English)',
        'ja': '日文 (Japanese)'
    };

    let targetLang = langCode;
    if (targetLang === 'auto') {
        const hint = getSpeakerLanguageHint(speakerName);
        targetLang = hint.recommended || 'zh';
    }

    const expectedKeys = langKeyMap[targetLang] || [targetLang];
    const hasAudio = expectedKeys.some(k => Array.isArray(languages[k]) && languages[k].length > 0);

    if (!hasAudio) {
        const langDisplay = langNameMap[targetLang] || targetLang;
        const availableLangs = Object.keys(languages).filter(k => Array.isArray(languages[k]) && languages[k].length > 0).join(', ') || '无';
        return {
            valid: false,
            modelName,
            message: `⚠️ 角色【${speakerName}】绑定的模型【${modelName}】在【${langDisplay}】路径下没有可用的参考音频！\n\n该模型当前可用语言路径: [${availableLangs}]\n请先在模型管理中为该模型添加对应语言参考音频，或将对话语言切换为支持的语言。`
        };
    }

    return { valid: true, modelName };
}

/**
 * 加载预设列表
 */
export async function fetchPresets(category) {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/presets?category=${category}`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`加载预设列表失败 (${res.status})`);
    const data = await res.json();
    return data.presets || [];
}

/**
 * 加载激活的预设
 */
export async function fetchActivePresets() {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/presets/active`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`加载激活状态失败 (${res.status})`);
    const data = await res.json();
    return data.active_presets || { phone_call: ['standard_call'], eavesdrop: ['standard_eavesdrop'] };
}

/**
 * 切换单预设激活
 */
export async function togglePresetActive(category, presetId) {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/presets/active`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            category: category,
            toggle_preset_id: presetId
        })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || '切换生效状态失败');
    }
    return await res.json();
}

/**
 * 批量设置激活预设
 */
export async function setBatchActivePresets(category, presetIds) {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/presets/active`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            category: category,
            preset_ids: presetIds
        })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || '批量设置失败');
    }
    return await res.json();
}

/**
 * 保存预设
 */
export async function savePreset(category, payload) {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/presets/${category}`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || '保存剧本失败');
    }
    return await res.json();
}

/**
 * 删除预设
 */
export async function deletePreset(category, presetId) {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/presets/${category}/${presetId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || '删除剧本失败');
    }
    return await res.json();
}

/**
 * 导入预设
 */
export async function importPreset(category, rawJson) {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/presets/import`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            category: category,
            raw_json: rawJson
        })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || '导入剧本失败');
    }
    return await res.json();
}
