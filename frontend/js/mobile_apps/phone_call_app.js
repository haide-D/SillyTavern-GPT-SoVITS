/**
 * 主动电话 App 模块 (Phone Call App)
 * 
 * 核心功能 (三子列表架构):
 * 1. 💬 当前对话: 查看当前聊天分支 (chat_branch) 下的专属来电记录
 * 2. 📜 总的历史对话: 查看所有角色与历史通话记录 (支持搜索与回放)
 * 3. 🚀 主动呼出控制台: 内嵌式直接选择 Speaker、Target、联动剧本工坊 Presets、动机快捷池并一键拨号
 */

import { ChatInjector } from '../chat_injector.js';
import { WorldInfoExtractor } from '../world_info_extractor.js';
import { NotificationHandler } from '../notification_handler.js';
import { AudioPlayer, setGlobalPlayer, cleanupGlobalPlayer } from './shared/audio_player.js';
import { getApiHost, getChatBranch, formatTime, renderAvatarHtml, getCharacterAvatar, getAuthHeaders } from './shared/utils.js';
import { STATUS_SVGS, getCallStatusTexts, isHarryPotterTheme } from '../themes/theme_status_helper.js';
import { showHistoryPlaybackUI } from './incoming_call_app.js';
import { getSpeakerLanguageHint, validateSpeakerLanguageAudio } from './workshop/api.js';

export const id = 'phone_call';
export const defaultName = '主动电话';
export const defaultIcon = STATUS_SVGS.phone;
export const sceneId = 'phone_call';
export const hidden = false;

// 视图状态与缓存
let _activeTab = 'current'; // 'current' | 'all' | 'dial'
let _lastGeneratedCall = null;
let _currentAudioPlayer = null;
let _playingCardElement = null; // 当前正在内联播放的卡片
let _currentAppContainer = null;
let _currentCreateNavbar = null;
let _allCallsCache = [];
let _currentCallsCache = [];
let _searchQuery = '';
let _presetsCache = [];
let _boundSpeakersCache = [];

const SVG = STATUS_SVGS;
const SVG_FULLSCREEN = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

/**
 * 注入样式
 */
const injectCSS = () => {
    if ($('#phone-call-app-css').length) return;
    const css = `
        .pc-app-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            background: transparent;
            color: #e5e7eb;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow-x: hidden;
            overflow-y: hidden;
            box-sizing: border-box;
            position: relative;
        }

        /* 顶部/子导航选项卡栏 (三子列表) */
        .pc-nav-tabs {
            display: flex !important;
            flex-direction: row !important;
            background: rgba(255, 255, 255, 0.03);
            border-bottom: 1px solid rgba(196, 155, 79, 0.2);
            padding: 8px 10px;
            gap: 6px;
            flex-shrink: 0;
            box-sizing: border-box;
            width: 100% !important;
        }
        .pc-nav-tab-btn {
            flex: 1;
            padding: 7px 6px;
            border-radius: 8px;
            border: 1px solid transparent;
            background: transparent;
            color: rgba(220, 200, 150, 0.7);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            white-space: nowrap;
        }
        .pc-nav-tab-btn:hover {
            color: rgba(220, 200, 150, 0.95);
            background: rgba(255, 255, 255, 0.04);
        }
        .pc-nav-tab-btn.active {
            background: rgba(16, 185, 129, 0.15);
            border-color: rgba(16, 185, 129, 0.4);
            color: #6ee7b7;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.15);
        }

        /* 历史列表视图容器 */
        .pc-history-scroll {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            box-sizing: border-box;
            width: 100%;
        }

        /* 搜索框 */
        .pc-search-row {
            display: flex;
            align-items: center;
            position: relative;
            margin-bottom: 4px;
            width: 100%;
            box-sizing: border-box;
        }
        .pc-search-input {
            width: 100%;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(196, 155, 79, 0.2);
            border-radius: 8px;
            padding: 7px 10px 7px 30px;
            font-size: 12px;
            color: #fff;
            outline: none;
            box-sizing: border-box;
            transition: all 0.2s;
        }
        .pc-search-input:focus {
            border-color: #10b981;
            background: rgba(255, 255, 255, 0.08);
        }
        .pc-search-icon {
            position: absolute;
            left: 10px;
            color: rgba(196, 155, 79, 0.6);
            pointer-events: none;
            display: flex;
        }

        /* 通话记录卡片 */
        .pc-card {
            background: rgba(28, 22, 40, 0.75);
            border: 1px solid rgba(196, 155, 79, 0.2);
            border-radius: 10px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 7px;
            backdrop-filter: blur(8px);
            transition: all 0.25s ease;
            box-sizing: border-box;
            width: 100%;
            position: relative;
        }
        .pc-card:hover {
            border-color: rgba(196, 155, 79, 0.45);
            background: rgba(34, 27, 48, 0.85);
        }
        .pc-card.highlight {
            border-color: #10b981;
            box-shadow: 0 0 16px rgba(16, 185, 129, 0.2);
            background: linear-gradient(135deg, rgba(30, 45, 40, 0.8), rgba(20, 28, 26, 0.9));
        }
        .pc-card.is-playing {
            border-color: #10b981 !important;
            box-shadow: 0 0 18px rgba(16, 185, 129, 0.28) !important;
            background: linear-gradient(135deg, rgba(20, 38, 32, 0.92), rgba(16, 26, 30, 0.95)) !important;
        }
        .pc-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .pc-caller-name {
            font-size: 13px;
            font-weight: 600;
            color: #fef08a;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .pc-avatar-playing {
            animation: pc-avatar-pulse 1.6s infinite ease-in-out;
        }
        @keyframes pc-avatar-pulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .pc-time-wrap {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .pc-time {
            font-size: 11px;
            color: rgba(220, 200, 160, 0.6);
        }
        .pc-time-playback {
            font-size: 11px;
            color: #6ee7b7;
            font-family: monospace, -apple-system, sans-serif;
            font-weight: 600;
        }
        .pc-reason {
            font-size: 11.5px;
            color: rgba(220, 200, 160, 0.85);
            background: rgba(0, 0, 0, 0.25);
            padding: 4px 8px;
            border-radius: 5px;
            border-left: 2px solid #eab308;
        }
        .pc-dialog-preview {
            font-size: 11.5px;
            color: #d1d5db;
            line-height: 1.45;
            max-height: 85px;
            overflow-y: auto;
            background: rgba(0, 0, 0, 0.2);
            padding: 5px 8px;
            border-radius: 5px;
        }
        .pc-dialog-preview div.pc-segment-line {
            transition: all 0.2s ease;
            padding: 1px 0;
            border-radius: 3px;
        }
        .pc-dialog-preview div.pc-segment-line.active-segment {
            color: #6ee7b7 !important;
            font-weight: 600;
            text-shadow: 0 0 8px rgba(16, 185, 129, 0.35);
            padding-left: 5px;
            border-left: 2px solid #10b981;
            background: rgba(16, 185, 129, 0.08);
        }
        .pc-audio-progress-wrap {
            width: 100%;
            height: 3px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 2px;
            overflow: hidden;
            margin: 2px 0;
            display: none;
            position: relative;
        }
        .pc-audio-progress-bar {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #10b981, #34d399);
            box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
            transition: width 0.1s linear;
        }
        .pc-card-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 3px;
            flex-wrap: wrap;
        }
        .pc-action-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: #e5e7eb;
            border-radius: 5px;
            padding: 4px 8px;
            font-size: 11px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
        }
        .pc-action-btn:hover {
            background: rgba(255, 255, 255, 0.15);
            color: #fff;
        }
        .pc-action-btn.play {
            background: rgba(16, 185, 129, 0.2);
            border-color: rgba(16, 185, 129, 0.4);
            color: #6ee7b7;
        }
        .pc-action-btn.play:hover {
            background: rgba(16, 185, 129, 0.35);
        }
        .pc-action-btn.inject {
            background: rgba(234, 179, 8, 0.15);
            border-color: rgba(234, 179, 8, 0.35);
            color: #fde047;
        }
        .pc-action-btn.inject:hover {
            background: rgba(234, 179, 8, 0.3);
        }
        .pc-action-btn.immersive {
            background: rgba(139, 92, 246, 0.15);
            border-color: rgba(139, 92, 246, 0.35);
            color: #c4b5fd;
            margin-left: auto;
        }
        .pc-action-btn.immersive:hover {
            background: rgba(139, 92, 246, 0.3);
            border-color: rgba(139, 92, 246, 0.6);
            color: #ede9fe;
        }

        /* 内嵌式主动呼出控制台面板 */
        .pc-dial-panel {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            box-sizing: border-box;
            width: 100%;
        }
        .pc-system-hint {
            background: rgba(196, 155, 79, 0.08);
            border: 1px solid rgba(196, 155, 79, 0.2);
            padding: 7px 10px;
            border-radius: 7px;
            font-size: 11px;
            color: rgba(220, 200, 160, 0.85);
            line-height: 1.4;
            display: flex;
            align-items: center;
            gap: 6px;
            box-sizing: border-box;
            width: 100%;
        }
        .pc-form-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 100%;
            box-sizing: border-box;
        }
        .pc-form-label {
            font-size: 11.5px;
            color: rgba(220, 200, 160, 0.9);
            font-weight: 500;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .pc-form-input, .pc-form-select {
            width: 100%;
            max-width: 100%;
            background: rgba(0, 0, 0, 0.45);
            border: 1px solid rgba(196, 155, 79, 0.25);
            border-radius: 7px;
            padding: 7px 10px;
            color: #fff;
            font-size: 12px;
            outline: none;
            box-sizing: border-box;
            transition: all 0.2s;
        }
        .pc-form-input:focus, .pc-form-select:focus {
            border-color: #10b981;
            box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
            background: rgba(0, 0, 0, 0.65);
        }
        .pc-form-select option {
            background: #181524;
            color: #fff;
        }
        .pc-preset-hint {
            font-size: 10.5px;
            color: rgba(220, 200, 160, 0.6);
            margin-top: 2px;
            line-height: 1.35;
        }
        .pc-quick-tag {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(196, 155, 79, 0.2);
            color: rgba(220, 200, 160, 0.85);
            padding: 3px 7px;
            border-radius: 10px;
            font-size: 10.5px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .pc-quick-tag:hover {
            background: rgba(16, 185, 129, 0.18);
            border-color: rgba(16, 185, 129, 0.45);
            color: #6ee7b7;
        }
        .pc-main-btn {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #fff;
            border: 1px solid rgba(16, 185, 129, 0.4);
            border-radius: 8px;
            padding: 9px 14px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            box-shadow: 0 3px 10px rgba(16, 185, 129, 0.25);
            transition: all 0.2s ease;
            width: 100%;
            box-sizing: border-box;
            margin-top: 4px;
        }
        .pc-main-btn:hover {
            filter: brightness(1.15);
            transform: translateY(-1px);
        }
        .pc-main-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
    `;
    $('head').append(`<style id="phone-call-app-css">${css}</style>`);
};



/**
 * 渲染主动电话 App 主体
 */
export async function render(container, createNavbar) {
    injectCSS();
    cleanupGlobalPlayer();
    if (_playingCardElement && _playingCardElement._resetUI) {
        _playingCardElement._resetUI();
        _playingCardElement = null;
    }
    _currentAppContainer = container;
    const navFunc = (typeof createNavbar === 'function') 
        ? createNavbar 
        : (createNavbar && typeof createNavbar.createNavbar === 'function' ? createNavbar.createNavbar : () => $('<div></div>'));
    _currentCreateNavbar = navFunc;
    container.empty();
    container.append(navFunc("主动电话"));

    const statusTexts = getCallStatusTexts();

    const $root = $(`
        <div class="pc-app-container">
            <!-- 顶部三子列表导航切换栏 -->
            <div class="pc-nav-tabs">
                <button class="pc-nav-tab-btn ${_activeTab === 'current' ? 'active' : ''}" data-tab="current">
                    ${statusTexts.tabCurrent}
                </button>
                <button class="pc-nav-tab-btn ${_activeTab === 'all' ? 'active' : ''}" data-tab="all">
                    ${statusTexts.tabAll}
                </button>
                <button class="pc-nav-tab-btn ${_activeTab === 'dial' ? 'active' : ''}" data-tab="dial">
                    ${statusTexts.tabDial}
                </button>
            </div>

            <!-- 主视图容器 -->
            <div id="pc-tab-content" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
                <div style="text-align:center; padding:30px; color:#9ca3af;">正在加载...</div>
            </div>
        </div>
    `);

    container.append($root);

    // 绑定 Tab 切换
    $root.find('.pc-nav-tab-btn').on('click', function () {
        const tab = $(this).data('tab');
        if (_activeTab === tab) return;
        _activeTab = tab;
        $root.find('.pc-nav-tab-btn').removeClass('active');
        $(this).addClass('active');
        renderActiveTabContent($root);
    });

    // 优先立即在当前 $root 容器中渲染子视图，0毫秒秒级出画面，不受全局挂载时钟影响
    renderActiveTabContent($root);

    // 后台静默刷新预设与 Speakers
    initPresetsAndSpeakers().then(() => {
        if (_activeTab === 'dial') {
            renderActiveTabContent($root);
        }
    }).catch(() => {});
}

/**
 * 初始化 Speakers 与剧本工坊预设池 (带超时保护与优雅回退)
 */
async function initPresetsAndSpeakers() {
    const apiHost = getApiHost();
    try {
        const fetchWithTimeout = (url, ms = 3000) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), ms);
            return fetch(url, { signal: controller.signal, headers: getAuthHeaders() })
                .then(r => r.ok ? r.json() : null)
                .catch(() => null)
                .finally(() => clearTimeout(timeoutId));
        };

        const [dataRes, presetsRes] = await Promise.all([
            fetchWithTimeout(`${apiHost}/api/get_data`),
            fetchWithTimeout(`${apiHost}/api/presets?category=phone_call`)
        ]);

        if (dataRes && dataRes.mappings) {
            _boundSpeakersCache = Object.keys(dataRes.mappings);
        }
        if (presetsRes && presetsRes.presets) {
            _presetsCache = presetsRes.presets;
        }
    } catch (e) {
        console.warn('[PhoneCallApp] 初始化预设与 Speakers 失败 (使用内存缓存):', e);
    }
}

/**
 * 渲染当前激活的子视图内容 (支持上下文 DOM 容器)
 */
async function renderActiveTabContent($parentRoot) {
    const $container = ($parentRoot && $parentRoot.find('#pc-tab-content').length)
        ? $parentRoot.find('#pc-tab-content')
        : $('#pc-tab-content');
    if (!$container.length) return;

    if (_activeTab === 'current') {
        await renderCurrentBranchCalls($container, $parentRoot);
    } else if (_activeTab === 'all') {
        await renderAllHistoryCalls($container, $parentRoot);
    } else if (_activeTab === 'dial') {
        renderDialConsole($container, $parentRoot);
    }
}

/**
 * 子视图 1: 渲染当前对话分支的通话记录
 */
async function renderCurrentBranchCalls($container, $parentRoot) {
    const pendingCount = window.TTS_CallQueueManager ? window.TTS_CallQueueManager.getPendingCount() : 0;
    const queueBannerHtml = pendingCount > 0 ? `
        <div style="background:linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15)); border:1px solid rgba(16,185,129,0.4); border-radius:10px; padding:10px 14px; margin:10px 14px 4px 14px; display:flex; align-items:center; justify-content:space-between;">
            <div style="font-size:12px; font-weight:600; color:#34d399;">
                📬 待听队列中存有 ${pendingCount} 条传讯
            </div>
            <button id="pc-play-all-queue-btn" style="background:#10b981; color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer;">
                连续收听 🎧
            </button>
        </div>
    ` : '';

    $container.html(`
        ${queueBannerHtml}
        <div class="pc-history-scroll" id="pc-current-list">
            <div style="text-align:center; padding:30px; color:#9ca3af;">正在读取通话记录...</div>
        </div>
    `);

    $container.find('#pc-play-all-queue-btn').on('click', function() {
        if (window.TTS_ThemeEngine) {
            window.TTS_ThemeEngine.showScene('incoming_call');
        }
    });
    const $list = $container.find('#pc-current-list');

    const chatBranch = getChatBranch();
    const apiHost = getApiHost();

    try {
        const url = chatBranch 
            ? `${apiHost}/api/phone_call/history?chat_branch=${encodeURIComponent(chatBranch)}&limit=40`
            : `${apiHost}/api/phone_call/history?limit=40`;
        
        const res = await fetch(url, { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : null).catch(() => null);
        _currentCallsCache = (res && (res.history || res.records)) || [];

        if (_currentCallsCache.length === 0 && chatBranch) {
            // 如果指定分支暂无记录，尝试读取总历史作为智能兜底
            const fallbackRes = await fetch(`${apiHost}/api/phone_call/history?limit=20`, { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : null).catch(() => null);
            const allList = (fallbackRes && (fallbackRes.history || fallbackRes.records)) || [];
            if (allList.length > 0) {
                const unbranched = allList.filter(r => !r.chat_branch || r.chat_branch === 'default' || r.chat_branch === '');
                if (unbranched.length > 0) {
                    _currentCallsCache = unbranched;
                }
            }
        }

        renderCallsToContainer($list, _currentCallsCache, true, $parentRoot);
    } catch (e) {
        console.error('[PhoneCallApp] 加载当前对话历史失败:', e);
        $list.html(`<div style="text-align:center; padding:30px; color:#ef4444;">加载失败: ${e.message}</div>`);
    }
}

/**
 * 子视图 2: 渲染全量总历史
 */
async function renderAllHistoryCalls($container, $parentRoot = null) {
    $container.html(`
        <div style="padding:10px 14px 0 14px;">
            <div class="pc-search-row">
                <span class="pc-search-icon">${SVG.search}</span>
                <input type="text" class="pc-search-input" id="pc-all-search" placeholder="搜索所有历史来电角色或事由..." value="${_searchQuery}">
            </div>
        </div>
        <div class="pc-history-scroll" id="pc-all-list">
            <div style="text-align:center; padding:30px; color:#9ca3af;">正在加载全量历史...</div>
        </div>
    `);

    const $list = $container.find('#pc-all-list');
    const apiHost = getApiHost();

    try {
        const res = await fetch(`${apiHost}/api/phone_call/history?limit=80`, { headers: getAuthHeaders() }).then(r => r.ok ? r.json() : null).catch(() => null);
        _allCallsCache = (res && (res.history || res.records)) || [];

        const applyFilterAndRender = () => {
            const filtered = _allCallsCache.filter(c => {
                if (!_searchQuery) return true;
                const charMatch = (c.char_name || '').toLowerCase().includes(_searchQuery);
                const reasonMatch = (c.call_reason || '').toLowerCase().includes(_searchQuery);
                return charMatch || reasonMatch;
            });
            renderCallsToContainer($list, filtered, false, $parentRoot);
        };

        $container.find('#pc-all-search').on('input', function () {
            _searchQuery = $(this).val().trim().toLowerCase();
            applyFilterAndRender();
        });

        applyFilterAndRender();
    } catch (e) {
        console.error('[PhoneCallApp] 加载全量历史失败:', e);
        $list.html(`<div style="text-align:center; padding:30px; color:#ef4444;">加载失败: ${e.message}</div>`);
    }
}

/**
 * 渲染通话列表卡片通用方法
 */
function renderCallsToContainer($list, calls, isCurrentTab = false, $parentRoot = null) {
    $list.empty();
    const statusTexts = getCallStatusTexts();

    if (_lastGeneratedCall && isCurrentTab) {
        const $latestCard = createCallCard(_lastGeneratedCall, true);
        $list.append($latestCard);
    }

    if (calls.length === 0 && (!_lastGeneratedCall || !isCurrentTab)) {
        $list.html(`
            <div class="pc-empty-state">
                <div class="pc-empty-icon" style="font-size:28px; margin-bottom:10px; opacity:0.9;">${statusTexts.emptyIcon || SVG.phone}</div>
                <div class="pc-empty-title">${isCurrentTab ? statusTexts.emptyCurrentTitle : statusTexts.emptyAllTitle}</div>
                <div class="pc-empty-desc">
                    ${statusTexts.emptySub}
                </div>
                ${isCurrentTab ? `
                <div>
                    <button class="pc-empty-btn pc-go-all-btn">
                        ${statusTexts.emptyBtnText || '📜 查看总历史记录'}
                    </button>
                </div>
                ` : ''}
            </div>
        `);

        $list.find('.pc-go-all-btn').on('click', function () {
            _activeTab = 'all';
            const $root = $parentRoot || $('.pc-app-container');
            $root.find('.pc-nav-tab-btn').removeClass('active');
            $root.find('.pc-nav-tab-btn[data-tab="all"]').addClass('active');
            renderActiveTabContent($parentRoot);
        });
        return;
    }

    calls.forEach(call => {
        const $card = createCallCard(call, false);
        $list.append($card);
    });
}

/**
 * 子视图 3: 内嵌式主动呼出控制台 (直接联动剧本工坊)
 */
function renderDialConsole($container) {
    const statusTexts = getCallStatusTexts();
    const enriched = WorldInfoExtractor.getEnrichedContext({ maxMessages: 12 });
    const boundSpeakers = _boundSpeakersCache.length > 0 ? _boundSpeakersCache : (enriched.speakers.length > 0 ? enriched.speakers : [enriched.charName]);
    const defaultSpeaker = boundSpeakers.includes(enriched.charName) ? enriched.charName : boundSpeakers[0];

    const callerOptions = boundSpeakers.map(s => `<option value="${s}" ${s === defaultSpeaker ? 'selected' : ''}>${s}</option>`).join('');

    // 联动剧本工坊的预设列表
    const presets = _presetsCache.length > 0 ? _presetsCache : [{ id: 'standard_call', name: '日常电话问候', description: '日常问候与闲聊' }];
    const presetOptions = presets.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    const defaultLangInfo = getSpeakerLanguageHint(defaultSpeaker);

    const quickMotivations = ["深夜想念与挂念", "突发险情与紧急求助", "日常分享与问候", "吃醋质问与试探", "秘密商量与约定", "生病探望与关心"];
    const quickTagsHtml = quickMotivations.map(m => `<span class="pc-quick-tag" data-val="${m}">${m}</span>`).join('');

    const html = `
        <div class="pc-dial-panel">
            <!-- 沉浸式设定感应提示 -->
            <div class="pc-system-hint">
                ${statusTexts.systemHint}
            </div>

            <!-- 发起角色 -->
            <div class="pc-form-group">
                <label class="pc-form-label">发起角色</label>
                <select class="pc-form-select" id="pc-form-caller">
                    ${callerOptions}
                </select>
            </div>

            <!-- 接听目标 -->
            <div class="pc-form-group">
                <label class="pc-form-label">接听目标</label>
                <input type="text" class="pc-form-input" id="pc-form-target" value="${enriched.userName}" placeholder="${statusTexts.targetPlaceholder}">
            </div>

            <!-- 剧本工坊预设选择 -->
            <div class="pc-form-group">
                <div class="pc-form-label">
                    <span>剧本预设</span>
                    <span style="font-size:11px; color:rgba(196,155,79,0.85);">已同步工坊</span>
                </div>
                <select class="pc-form-select" id="pc-form-preset">
                    ${presetOptions}
                </select>
                <div class="pc-preset-hint" id="pc-preset-desc">
                    ${presets[0] ? presets[0].description : ''}
                </div>
            </div>

            <!-- 对话语言选择器 -->
            <div class="pc-form-group">
                <div class="pc-form-label">
                    <span>对话语言</span>
                    <span id="pc-form-lang-hint" style="font-size:11px; color:rgba(196,155,79,0.85);">${defaultLangInfo.hint}</span>
                </div>
                <select class="pc-form-select" id="pc-form-language">
                    <option value="auto" selected>智能自适应 (根据角色模型与语境)</option>
                    <option value="zh">中文 (Chinese)</option>
                    <option value="ja">日文 (Japanese)</option>
                    <option value="en">英文 (English)</option>
                </select>
            </div>

            <!-- 通话事由 / 传讯契机 -->
            <div class="pc-form-group">
                <label class="pc-form-label">${statusTexts.reasonLabel}</label>
                <input type="text" class="pc-form-input" id="pc-form-reason" value="${statusTexts.reasonDefault}">
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:2px;">
                    ${quickTagsHtml}
                </div>
            </div>

            <!-- 语气基调 (可选) -->
            <div class="pc-form-group">
                <label class="pc-form-label">语气基调 (可选)</label>
                <input type="text" class="pc-form-input" id="pc-form-tone" placeholder="${statusTexts.tonePlaceholder}">
            </div>

            <!-- 拨出大按钮 -->
            <button class="pc-main-btn" id="pc-form-submit-btn">
                ${statusTexts.btnIdle}
            </button>
        </div>
    `;

    $container.html(html);

    // 发起人改变联动语言提示
    $container.find('#pc-form-caller').on('change', function () {
        const langInfo = getSpeakerLanguageHint($(this).val());
        $container.find('#pc-form-lang-hint').text(langInfo.hint);
    });

    // 预设改变联动描述
    $container.find('#pc-form-preset').on('change', function () {
        const pid = $(this).val();
        const found = _presetsCache.find(p => p.id === pid);
        if (found) {
            $container.find('#pc-preset-desc').text(found.description || '');
        }
    });

    // 快捷动机点选
    $container.find('.pc-quick-tag').on('click', function () {
        $container.find('#pc-form-reason').val($(this).data('val'));
    });

    // 点击提交发起呼出
    $container.find('#pc-form-submit-btn').on('click', async function () {
        const caller = $container.find('#pc-form-caller').val();
        const presetId = $container.find('#pc-form-preset').val();
        const reason = $container.find('#pc-form-reason').val().trim();
        const tone = $container.find('#pc-form-tone').val().trim();
        const selectedLang = $container.find('#pc-form-language').val();

        let effectiveLang = selectedLang;
        if (selectedLang === 'auto') {
            const langInfo = getSpeakerLanguageHint(caller);
            effectiveLang = langInfo.recommended || 'zh';
        }

        // 前置音频缺失校验
        const check = validateSpeakerLanguageAudio(caller, effectiveLang);
        if (!check.valid) {
            alert(check.message);
            return;
        }

        // 🌟 核心修复：在点击发起瞬间实时提取酒馆最新的当前分支上下文，避免受旧分支/旧聊天闭包缓存影响
        await WorldInfoExtractor.refreshWorldInfo();
        const currentEnriched = WorldInfoExtractor.getEnrichedContext({ maxMessages: 12, charName: caller });
        const target = $container.find('#pc-form-target').val().trim() || currentEnriched.userName || enriched.userName;

        await generateAndLaunchPhoneCall({
            caller,
            target,
            presetId,
            reason,
            tone,
            language: effectiveLang,
            enriched: currentEnriched
        });
    });
}

/**
 * 创建单条通话卡片 (支持内联精致播放、逐句高亮、沉浸重温、重新生成与注入聊天)
 */
function createCallCard(call, isLatest = false) {
    const caller = call.char_name || call.selected_speaker || "神秘角色";
    const target = call.target_user || "你";
    const timeStr = call.created_at ? formatTime(call.created_at) : "刚刚";
    const reason = call.call_reason || "主动致电";
    const audioUrl = call.audio_url || (call.audio ? `data:audio/wav;base64,${call.audio}` : null);

    let segments = call.segments || [];
    if (typeof segments === 'string') {
        try { segments = JSON.parse(segments); } catch (e) { segments = []; }
    }

    const previewTexts = segments.map((s, idx) => {
        const t = s.translation || s.text || '';
        return `<div class="pc-segment-line" data-idx="${idx}">${t}</div>`;
    }).join('');

    const avatarHtml = renderAvatarHtml(caller, 'pc-card-avatar-img', 'width:28px; height:28px; border-radius:50%; object-fit:cover; border:1px solid rgba(196,155,79,0.4); flex-shrink:0; transition:all 0.3s;');

    const $card = $(`
        <div class="pc-card ${isLatest ? 'highlight' : ''}">
            <div class="pc-card-header">
                <div style="display:flex; align-items:center; gap:8px;">
                    ${avatarHtml}
                    <div class="pc-caller-name">
                        ${caller} → ${target}
                        ${isLatest ? '<span style="font-size:10px; background:#10b981; color:#fff; padding:1px 6px; border-radius:10px;">最新通话</span>' : ''}
                    </div>
                </div>
                <div class="pc-time-wrap">
                    <span class="pc-time-playback" style="display:none;">0:00 / 0:00</span>
                    <span class="pc-time">${timeStr}</span>
                </div>
            </div>

            <div class="pc-reason">
                <strong>通话事由:</strong> ${reason}
            </div>

            ${previewTexts ? `<div class="pc-dialog-preview">${previewTexts}</div>` : ''}

            <div class="pc-audio-progress-wrap">
                <div class="pc-audio-progress-bar"></div>
            </div>

            <div class="pc-card-actions">
                ${audioUrl ? `
                    <button class="pc-action-btn play ws-btn-play" title="播放/暂停录音">
                        ${SVG.play} 播放录音
                    </button>
                ` : ''}
                <button class="pc-action-btn ws-btn-regen" title="以相同参数重新生成">
                    ${SVG.refresh} 重新生成
                </button>
                <button class="pc-action-btn inject ws-btn-inject" title="将通话内容追加到 SillyTavern 聊天消息中">
                    ${SVG.inject} 注入当前聊天
                </button>
                ${audioUrl ? `
                    <button class="pc-action-btn immersive ws-btn-fullscreen" title="进入全屏沉浸重温模式 (大立绘、实时声波与滚动字幕)">
                        ${SVG_FULLSCREEN} 沉浸重温
                    </button>
                ` : ''}
            </div>
        </div>
    `);

    // 卡片 UI 状态重置
    const resetCardUI = () => {
        $card.removeClass('is-playing');
        $card.find('.pc-card-avatar-img').removeClass('pc-avatar-playing');
        $card.find('.pc-segment-line').removeClass('active-segment');
        $card.find('.pc-audio-progress-wrap').hide();
        $card.find('.pc-audio-progress-bar').css('width', '0%');
        $card.find('.pc-time-playback').hide();
        $card.find('.pc-time').show();
        $card.find('.ws-btn-play').html(`${SVG.play} 播放录音`);
    };

    // 播放/暂停控制
    $card.find('.ws-btn-play').on('click', function () {
        if (!audioUrl) return;
        const $btn = $(this);

        // 如果本卡片正在播放，点击则暂停
        if (_playingCardElement && _playingCardElement[0] === $card[0] && _currentAudioPlayer && _currentAudioPlayer.isPlaying()) {
            _currentAudioPlayer.pause();
            $btn.html(`${SVG.play} 继续播放`);
            $card.removeClass('is-playing');
            $card.find('.pc-card-avatar-img').removeClass('pc-avatar-playing');
            return;
        }

        // 如果本卡片处于暂停状态，恢复播放
        if (_playingCardElement && _playingCardElement[0] === $card[0] && _currentAudioPlayer) {
            _currentAudioPlayer.play();
            $btn.html(`${SVG.pause} 暂停`);
            $card.addClass('is-playing');
            $card.find('.pc-card-avatar-img').addClass('pc-avatar-playing');
            return;
        }

        // 停止并清理前一个播放器
        cleanupGlobalPlayer();
        if (_playingCardElement && _playingCardElement._resetUI) {
            _playingCardElement._resetUI();
        }

        _playingCardElement = $card;
        $card._resetUI = resetCardUI;

        // 初始化播放器并绑定事件
        _currentAudioPlayer = new AudioPlayer({ audioUrl, segments });
        setGlobalPlayer(_currentAudioPlayer);

        const $progressBar = $card.find('.pc-audio-progress-bar');
        const $progressWrap = $card.find('.pc-audio-progress-wrap');
        const $timePlayback = $card.find('.pc-time-playback');
        const $timeOriginal = $card.find('.pc-time');
        const $lines = $card.find('.pc-segment-line');

        $progressWrap.show();
        $timeOriginal.hide();
        $timePlayback.show().text('0:00 / 0:00');
        $card.addClass('is-playing');
        $card.find('.pc-card-avatar-img').addClass('pc-avatar-playing');
        $btn.html(`${SVG.pause} 暂停`);

        _currentAudioPlayer.on('timeupdate', (currentTime, duration) => {
            if (duration && duration > 0) {
                const percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
                $progressBar.css('width', `${percent}%`);
                $timePlayback.text(`${formatTime(currentTime)} / ${formatTime(duration)}`);
            } else {
                $timePlayback.text(`${formatTime(currentTime)}`);
            }
        });

        _currentAudioPlayer.on('segment_change', ({ index }) => {
            $lines.removeClass('active-segment');
            const $active = $lines.filter(`[data-idx="${index}"]`).addClass('active-segment');
            if ($active.length) {
                const previewEl = $card.find('.pc-dialog-preview')[0];
                if (previewEl) {
                    const activeEl = $active[0];
                    previewEl.scrollTop = activeEl.offsetTop - previewEl.offsetTop - 10;
                }
            }
        });

        _currentAudioPlayer.on('play', () => {
            $btn.html(`${SVG.pause} 暂停`);
            $card.addClass('is-playing');
            $card.find('.pc-card-avatar-img').addClass('pc-avatar-playing');
        });

        _currentAudioPlayer.on('pause', () => {
            $btn.html(`${SVG.play} 继续播放`);
            $card.removeClass('is-playing');
            $card.find('.pc-card-avatar-img').removeClass('pc-avatar-playing');
        });

        _currentAudioPlayer.on('ended', () => {
            resetCardUI();
            _playingCardElement = null;
        });

        _currentAudioPlayer.on('error', () => {
            resetCardUI();
            _playingCardElement = null;
        });

        _currentAudioPlayer.play();
    });

    // 沉浸重温 (调用当前激活主题的专属特殊全屏播放页面)
    $card.find('.ws-btn-fullscreen').on('click', function () {
        if (!audioUrl) return;
        cleanupGlobalPlayer();
        if (_playingCardElement && _playingCardElement._resetUI) {
            _playingCardElement._resetUI();
            _playingCardElement = null;
        }

        const replayData = {
            char_name: caller,
            selected_speaker: caller,
            created_at: call.created_at,
            audio_url: audioUrl,
            segments: segments,
            call_id: call.call_id || call.id || Date.now(),
            id: call.call_id || call.id || Date.now(),
            isReplay: true,
            onReturn: () => {
                // 退出沉浸模式时无缝回退到主动电话列表
                if (window.TTS_ThemeEngine) {
                    window.TTS_ThemeEngine.showScene('phone_call');
                } else if (_currentAppContainer && _currentCreateNavbar) {
                    render(_currentAppContainer, _currentCreateNavbar);
                } else {
                    renderActiveTabContent();
                }
            }
        };

        if (window.TTS_ThemeEngine) {
            console.log('[PhoneCallApp] 唤起当前主题专属全屏沉浸重温:', replayData);
            window.TTS_ThemeEngine.showScene('incoming_call', replayData);
        } else {
            const $targetContainer = _currentAppContainer || $('#pc-tab-content').closest('.theme-content, .mobile-screen, .pc-app-container').parent();
            showHistoryPlaybackUI(
                $targetContainer.length ? $targetContainer : $('#pc-tab-content'),
                replayData,
                _currentCreateNavbar,
                replayData.onReturn
            );
        }
    });

    // 重新生成
    $card.find('.ws-btn-regen').on('click', async () => {
        _activeTab = 'dial';
        $('.pc-nav-tab-btn').removeClass('active');
        $(`.pc-nav-tab-btn[data-tab="dial"]`).addClass('active');
        renderDialConsole($('#pc-tab-content'));
        $('#pc-form-caller').val(caller).trigger('change');
        $('#pc-form-target').val(target);
        if (call.preset_id) $('#pc-form-preset').val(call.preset_id).trigger('change');
        $('#pc-form-reason').val(reason);
    });

    // 注入当前聊天
    $card.find('.ws-btn-inject').on('click', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true).text('注入中...');
        try {
            await ChatInjector.appendToLastAIMessage({
                type: 'phone_call',
                callerName: caller,
                caller: caller,
                target: target,
                userName: target,
                callReason: reason,
                sceneDescription: reason,
                segments: segments,
                callId: call.call_id || call.id || Date.now(),
                audioUrl: audioUrl
            });
            $btn.html(`${SVG.inject} 已注入`);
            setTimeout(() => $btn.html(`${SVG.inject} 注入当前聊天`), 2000);
        } catch (e) {
            console.error('[PhoneCallApp] 注入失败:', e);
            alert(`注入失败: ${e.message}`);
            $btn.html(`${SVG.inject} 注入当前聊天`);
        } finally {
            $btn.prop('disabled', false);
        }
    });

    return $card;
}

/**
 * 执行主动电话生成全链路
 */
async function generateAndLaunchPhoneCall({ caller, target, presetId, reason, tone, language, enriched }) {
    const apiHost = getApiHost();
    const statusTexts = getCallStatusTexts();

    if (!window.LLM_Client || typeof window.LLM_Client.callLLM !== 'function') {
        alert('LLM_Client 未就绪，无法建立通讯');
        return;
    }

    const $btn = $('#pc-form-submit-btn');
    $btn.prop('disabled', true).html(statusTexts.btnLoading(statusTexts.step1Prompt));

    try {
        // 1. 构建 Prompt (直接对接工坊预设)
        const buildPayload = {
            char_name: caller,
            context: enriched.context,
            user_name: enriched.userName,
            chat_branch: enriched.chatBranch,
            preset_id: presetId,
            caller: caller,
            target: target,
            receiver: target,
            call_reason: reason,
            call_tone: tone,
            character_persona: enriched.characterPersona,
            world_info: enriched.worldInfo,
            text_lang: language || 'zh'
        };

        const buildRes = await fetch(`${apiHost}/api/phone_call/build_prompt`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(buildPayload)
        });

        if (!buildRes.ok) {
            let errMsg = '连接失败';
            try {
                const errJson = await buildRes.json();
                errMsg = errJson.detail || errMsg;
            } catch (_) {
                errMsg = await buildRes.text();
            }
            throw new Error(errMsg);
        }
        const buildData = await buildRes.json();

        // 2. 调用 LLM
        $btn.html(statusTexts.btnLoading(statusTexts.step2LLM));
        const llmConfig = {
            api_url: buildData.llm_config.api_url,
            api_key: buildData.llm_config.api_key,
            model: buildData.llm_config.model,
            temperature: buildData.llm_config.temperature || 0.8,
            max_tokens: Math.min(parseInt(buildData.llm_config.max_tokens || 4000, 10), 8192),
            prompt: buildData.prompt
        };

        const llmResponse = await window.LLM_Client.callLLM(llmConfig);

        // 3. TTS 合成 (携带 text_lang 动态语言参数)
        $btn.html(statusTexts.btnLoading(statusTexts.step3TTS));
        const parseRes = await fetch(`${apiHost}/api/phone_call/parse_and_generate`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                char_name: caller,
                llm_response: llmResponse,
                generate_audio: true,
                chat_branch: enriched.chatBranch,
                context_fingerprint: enriched.contextFingerprint,
                target_user: target,
                text_lang: language || 'zh'
            })
        });

        if (!parseRes.ok) {
            let errMsg = '语音通道建立失败';
            try {
                const errJson = await parseRes.json();
                errMsg = errJson.detail || errMsg;
            } catch (_) {
                errMsg = await parseRes.text();
            }
            throw new Error(errMsg);
        }
        const parseData = await parseRes.json();

        // 组装生成结果对象
        const callData = {
            call_id: parseData.call_id || `manual_${Date.now()}`,
            char_name: caller,
            selected_speaker: caller,
            target_user: target,
            call_reason: reason,
            preset_id: presetId,
            segments: parseData.segments || [],
            audio_url: parseData.audio_url || (parseData.audio ? `data:audio/wav;base64,${parseData.audio}` : null),
            created_at: new Date().toISOString()
        };
        _lastGeneratedCall = callData;

        // 预设 Tab 为当前对话，以便接听或进入 App 时直接呈现
        _activeTab = 'current';

        // 1. 自动收起/最小化当前面板，退回待机主界面
        if (window.TTS_ThemeEngine) {
            window.TTS_ThemeEngine.close();
        }

        // 2. 通过 NotificationHandler 分发来电通知（触发悬浮球动效/粒子/法阵及Toast提示）
        await NotificationHandler.handlePhoneCallReady(callData);

    } catch (e) {
        console.error('[PhoneCallApp] 通话呼叫异常:', e);
        alert(`呼叫失败: ${e.message}`);
    } finally {
        $btn.prop('disabled', false).html(statusTexts.btnIdle);
    }
}

/**
 * 清理函数
 */
export function cleanup() {
    cleanupGlobalPlayer();
}
