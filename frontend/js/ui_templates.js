import { t, getLang } from './i18n.js';

export function getFloatingButtonHTML() {
    return `<div id="tts-manager-btn">${t('tts_config_btn')}</div>`;
}

export function getDashboardHTML(data) {
    const { isEnabled, settings, isRemote, remoteIP, currentBase, currentCache, currentLang } = data;
    const lang = getLang();

    return `
        <div id="tts-dashboard-overlay" class="tts-overlay">
            <div id="tts-dashboard" class="tts-panel">
                <div class="tts-header">
                    <h3 class="tts-header-title">${t('dashboard_title')}</h3>
                    <button class="tts-close" onclick="$('#tts-dashboard-overlay').remove()"
                            style="background:transparent; border:none; color:inherit; font-size:24px; padding:0 10px;">×</button>
                </div>

                <div class="tts-content">
                    <div class="tts-card">
                        <div class="tts-card-title">${t('sys_status')}</div>
                        
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">${t('lang_label')}</span>
                            <select id="tts-lang-switch" class="tts-modern-input" style="width:100px;">
                                <option value="zh" ${lang === 'zh' ? 'selected' : ''}>中文</option>
                                <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
                            </select>
                        </label>

                        <label class="tts-switch-row">
                            <span class="tts-switch-label">${t('enable_tts')}</span>
                            <input type="checkbox" id="tts-master-switch" class="tts-toggle" ${isEnabled ? 'checked' : ''}>
                        </label>
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">${t('preload_model')}</span>
                            <input type="checkbox" id="tts-toggle-auto" class="tts-toggle" ${settings.auto_generate ? 'checked' : ''}>
                        </label>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">${t('conn_mode')}</div>
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">${t('remote_mode')}</span>
                            <input type="checkbox" id="tts-remote-switch" class="tts-toggle" ${isRemote ? 'checked' : ''}>
                        </label>
                        <div id="tts-remote-input-area" style="display:${isRemote ? 'block' : 'none'}; margin-top:10px; padding-top:10px; border-top:1px dashed #444;">
                            <div class="tts-input-label">${t('pc_ip')}</div>
                            <div style="display:flex; gap:8px;">
                                <input type="text" id="tts-remote-ip" class="tts-modern-input" value="${remoteIP}" placeholder="192.168.x.x">
                                <button id="tts-save-remote" class="btn-primary">${t('btn_save')}</button>
                            </div>
                        </div>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">${t('visual_exp')}</div>
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">${t('iframe_mode')}</span>
                            <input type="checkbox" id="tts-iframe-switch" class="tts-toggle" ${settings.iframe_mode ? 'checked' : ''}>
                        </label>

                        <div class="tts-input-row">
                            <span class="tts-input-label">${t('bubble_style')}</span>
                            <div class="tts-custom-select" id="style-dropdown" style="margin-top:5px;">
                                <div class="select-trigger" data-value="default">
                                    <span>${t('style_default')}</span>
                                    <i class="arrow-icon">▼</i>
                                </div>
                                <div class="select-options">
                                    <div class="option-item" data-value="default">${t('style_default')}</div>
                                    <div class="option-item" data-value="cyberpunk">${t('style_cyberpunk')}</div>
                                    <div class="option-item" data-value="ink">${t('style_ink')}</div>
                                    <div class="option-item" data-value="kawaii">${t('style_kawaii')}</div>
                                    <div class="option-item" data-value="bloom">${t('style_bloom')}</div>
                                    <div class="option-item" data-value="rouge">${t('style_rouge')}</div>
                                    <div class="option-item" data-value="holo">${t('style_holo')}</div>
                                    <div class="option-item" data-value="scroll">${t('style_scroll')}</div>
                                    <div class="option-item" data-value="steampunk">${t('style_steampunk')}</div>
                                    <div class="option-item" data-value="tactical">${t('style_tactical')}</div>
                                    <div class="option-item" data-value="obsidian">${t('style_obsidian')}</div>
                                    <div class="option-item" data-value="classic">${t('style_classic')}</div>
                                </div>
                            </div>
                            <input type="hidden" id="style-selector" value="default">
                        </div>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">${t('path_lang_config')}</div>

                        <div class="tts-input-row">
                            <span class="tts-input-label">${t('ref_audio_lang')}</span>
                            <select id="tts-lang-select" class="tts-modern-input">
                                <option value="default" ${currentLang === 'default' ? 'selected' : ''}>Default (根目录)</option>
                                <option value="Chinese" ${currentLang === 'Chinese' ? 'selected' : ''}>Chinese (中文)</option>
                                <option value="Japanese" ${currentLang === 'Japanese' ? 'selected' : ''}>Japanese (日语)</option>
                                <option value="English" ${currentLang === 'English' ? 'selected' : ''}>English (英语)</option>
                            </select>
                            <div style="font-size:11px; color:#888; margin-top:4px;">${t('ref_audio_subfolder_tip')}</div>
                        </div>

                        <div style="text-align:right; margin-top:12px;">
                            <button id="tts-btn-save-paths" class="btn-primary">${t('save_config')}</button>
                        </div>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">${t('char_binding')}</div>
                         <div style="display:flex; gap:8px; margin-bottom:12px;">
                            <input type="text" id="tts-new-char" class="tts-modern-input" style="flex: 1; min-width: 0;" placeholder="${t('char_name')}">

                            <select id="tts-new-model" class="tts-modern-input" style="flex: 2; min-width: 0;">
                                <option>...</option>
                            </select>
                        </div>

                        <button id="tts-btn-bind-new" class="btn-primary" style="width:100%">${t('bind_btn')}</button>
                        <div class="tts-list-zone" style="margin-top:15px;">
                            <div id="tts-mapping-list" class="tts-list-container" style="border:none; background:transparent;"></div>
                        </div>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">${t('tg_asset_import')}</div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
                            <button id="tts-open-telegram-import" class="btn-primary">${t('import_tg_from_tavern')}</button>
                            <button id="tts-refresh-telegram-assets" class="btn-secondary">${t('refresh_asset_binding')}</button>
                        </div>
                        <div style="font-size:12px; color:#aaa; margin-bottom:10px; line-height:1.5;">
                            ${t('tg_import_tip')}
                        </div>
                        <div id="tts-telegram-pack-summary" class="tts-empty" style="margin-bottom:12px;">${t('loading_tg_assets')}</div>
                        <div id="tts-telegram-bot-bindings"></div>
                    </div>
                </div>
            </div>
        </div>`;
}
export function getBubbleMenuHTML() {
    return `
    <div id="tts-bubble-menu" class="tts-context-menu" style="display:none;">
        <div class="menu-item" id="tts-action-download">
            ${t('bubble_download')}
        </div>
        <div class="divider"></div>
        <div class="menu-item" id="tts-action-reroll">
            ${t('bubble_reroll')}
        </div>
        <div class="menu-item" id="tts-action-fav">
            ${t('bubble_fav')}
        </div>
        <div class="divider"></div>
        <div class="menu-item close-item" style="color:#999; justify-content:center; font-size:12px;">
            ${t('click_outside_close')}
        </div>
    </div>
    `;
}
