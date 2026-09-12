/**
 * 对话追踪数据与生成全链路 API 客户端 (Eavesdrop API Client)
 */

import { getApiHost, getChatBranch, getAuthHeaders } from '../shared/utils.js';
import { getEavesdropStatusTexts } from '../../themes/theme_status_helper.js';
import { WorldInfoExtractor } from '../../world_info_extractor.js';
import { NotificationHandler } from '../../notification_handler.js';

let _boundSpeakersCache = [];
let _presetsCache = [];

export function getCachedSpeakers() {
    return _boundSpeakersCache;
}

export function getCachedPresets() {
    return _presetsCache;
}

/**
 * 初始化 Speakers 与剧本工坊预设池 (带超时保护与优雅回退)
 */
export async function initPresetsAndSpeakers() {
    const apiHost = getApiHost();
    try {
        const fetchWithTimeout = (url, ms = 3000) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), ms);
            return fetch(url, { signal: controller.signal, headers: getAuthHeaders() })
                .then(r => r.json())
                .catch(() => null)
                .finally(() => clearTimeout(timeoutId));
        };

        const [dataRes, presetsRes] = await Promise.all([
            fetchWithTimeout(`${apiHost}/api/get_data`),
            fetchWithTimeout(`${apiHost}/api/presets?category=eavesdrop`)
        ]);

        if (dataRes && dataRes.mappings) {
            _boundSpeakersCache = Object.keys(dataRes.mappings);
        }
        if (presetsRes && presetsRes.presets) {
            _presetsCache = presetsRes.presets;
        }
        return { speakers: _boundSpeakersCache, presets: _presetsCache };
    } catch (e) {
        console.warn('[EavesdropAPI] 初始化预设与 Speakers 失败 (使用内存缓存):', e);
        return { speakers: _boundSpeakersCache, presets: _presetsCache };
    }
}

/**
 * 获取密谈历史记录 (支持按分支过滤及智能兜底)
 */
export async function fetchCurrentBranchHistory(limit = 40) {
    const chatBranch = getChatBranch();
    const apiHost = getApiHost();
    const url = chatBranch 
        ? `${apiHost}/api/eavesdrop/history?chat_branch=${encodeURIComponent(chatBranch)}&limit=${limit}`
        : `${apiHost}/api/eavesdrop/history?limit=${limit}`;
    
    const res = await fetch(url, { headers: getAuthHeaders() }).then(r => r.json());
    let list = (res && (res.history || res.records)) || [];

    if (list.length === 0 && chatBranch) {
        // 如果指定分支暂无记录，尝试读取总历史中未绑定分支的记录作为智能兜底
        const fallbackRes = await fetch(`${apiHost}/api/eavesdrop/history?limit=20`, { headers: getAuthHeaders() }).then(r => r.json()).catch(() => null);
        const allList = (fallbackRes && (fallbackRes.history || fallbackRes.records)) || [];
        if (allList.length > 0) {
            const unbranched = allList.filter(r => !r.chat_branch || r.chat_branch === 'default' || r.chat_branch === '');
            if (unbranched.length > 0) {
                list = unbranched;
            }
        }
    }
    return list;
}

/**
 * 获取全量密谈历史记录
 */
export async function fetchAllHistory(limit = 80) {
    const apiHost = getApiHost();
    const res = await fetch(`${apiHost}/api/eavesdrop/history?limit=${limit}`, { headers: getAuthHeaders() }).then(r => r.json());
    return (res && (res.history || res.records)) || [];
}

/**
 * 执行主动开启密谈生成全链路 (Prompt 构建 -> LLM 创作 -> 多音轨 TTS 合成 -> 通知分发)
 */
export async function generateAndLaunchEavesdrop({ speakers, presetId, reason, tone, language, enriched, onProgress }) {
    const apiHost = getApiHost();
    const statusTexts = getEavesdropStatusTexts();

    if (!window.LLM_Client || typeof window.LLM_Client.callLLM !== 'function') {
        throw new Error('LLM_Client 未就绪，无法开启密谈');
    }

    const setStatus = (html) => {
        if (typeof onProgress === 'function') onProgress(html);
    };

    setStatus(statusTexts.btnLoading(statusTexts.step1Prompt));

    // 1. 构建 Prompt (直接对接工坊预设)
    const buildPayload = {
        context: enriched.context,
        speakers: speakers,
        user_name: enriched.userName,
        chat_branch: enriched.chatBranch,
        text_lang: language || 'zh',
        preset_id: presetId,
        theme: reason,
        call_reason: reason,
        call_tone: tone,
        character_persona: enriched.characterPersona,
        world_info: await WorldInfoExtractor.refreshWorldInfo()
    };

    const buildRes = await fetch(`${apiHost}/api/eavesdrop/build_prompt`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(buildPayload)
    });

    if (!buildRes.ok) {
        const err = await buildRes.text();
        throw new Error(`连接失败: ${err}`);
    }
    const buildData = await buildRes.json();

    // 2. 调用 LLM
    setStatus(statusTexts.btnLoading(statusTexts.step2LLM(speakers)));
    const llmConfig = {
        api_url: buildData.llm_config.api_url,
        api_key: buildData.llm_config.api_key,
        model: buildData.llm_config.model,
        temperature: buildData.llm_config.temperature || 0.8,
        max_tokens: buildData.llm_config.max_tokens || 4000,
        prompt: buildData.prompt
    };

    const llmResponse = await window.LLM_Client.callLLM(llmConfig);

    // 3. TTS 合成 (多角色分别合成并按音轨对齐合并)
    setStatus(statusTexts.btnLoading(statusTexts.step3TTS));
    const parseRes = await fetch(`${apiHost}/api/eavesdrop/parse_and_generate`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            llm_response: llmResponse,
            speakers: speakers,
            text_lang: language || 'zh',
            chat_branch: enriched.chatBranch,
            context_fingerprint: enriched.contextFingerprint,
            scene_description: reason
        })
    });

    if (!parseRes.ok) {
        const err = await parseRes.text();
        throw new Error(`音频链路生成失败: ${err}`);
    }
    const parseData = await parseRes.json();

    // 组装生成结果对象
    const eavesdropData = {
        record_id: parseData.record_id || `manual_eavesdrop_${Date.now()}`,
        speakers: speakers,
        scene_description: reason,
        preset_id: presetId,
        segments: parseData.segments || [],
        audio_url: parseData.audio_url || (parseData.audio ? `data:audio/wav;base64,${parseData.audio}` : null),
        notification_text: `检测到 ${speakers.join(' 与 ')} 的密谈`,
        created_at: new Date().toISOString()
    };

    // 1. 自动收起/最小化当前面板
    if (window.TTS_ThemeEngine) {
        window.TTS_ThemeEngine.close();
    }

    // 2. 通过 NotificationHandler 分发密谈通知（触发悬浮球动效/粒子/法阵及Toast提示）
    await NotificationHandler.handleEavesdropReady(eavesdropData);

    return eavesdropData;
}
