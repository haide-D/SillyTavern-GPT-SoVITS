// 文件: ui_templates.js

export function getFloatingButtonHTML() {
    return `<div id="tts-manager-btn">🔊 TTS配置</div>`;
}

export function getDashboardHTML(data) {
    const { isEnabled, settings, isRemote, remoteIP, currentBase, currentCache, currentLang } = data;

    return `
        <div id="tts-dashboard-overlay" class="tts-overlay">
            <div id="tts-dashboard" class="tts-panel">
                <div class="tts-header">
                    <h3 class="tts-header-title">🎧 语音配置中心</h3>
                    <button class="tts-close" onclick="$('#tts-dashboard-overlay').remove()"
                            style="background:transparent; border:none; color:inherit; font-size:24px; padding:0 10px;">×</button>
                </div>

                <div class="tts-content">
                    <div class="tts-card">
                        <div class="tts-card-title">🔌 系统状态</div>
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">启用 TTS 插件</span>
                            <input type="checkbox" id="tts-master-switch" class="tts-toggle" ${isEnabled ? 'checked' : ''}>
                        </label>
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">预加载模型(自动生成,建议开启)</span>
                            <input type="checkbox" id="tts-toggle-auto" class="tts-toggle" ${settings.auto_generate ? 'checked' : ''}>
                        </label>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">📡 连接模式</div>
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">远程模式 (局域网部署用)</span>
                            <input type="checkbox" id="tts-remote-switch" class="tts-toggle" ${isRemote ? 'checked' : ''}>
                        </label>
                        <div id="tts-remote-input-area" style="display:${isRemote ? 'block' : 'none'}; margin-top:10px; padding-top:10px; border-top:1px dashed #444;">
                            <div class="tts-input-label">电脑 IP</div>
                            <div style="display:flex; gap:8px;">
                                <input type="text" id="tts-remote-ip" class="tts-modern-input" value="${remoteIP}" placeholder="192.168.x.x">
                                <button id="tts-save-remote" class="btn-primary">保存</button>
                            </div>
                        </div>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">🎨 视觉体验</div>
                        <label class="tts-switch-row">
                            <span class="tts-switch-label">美化卡专用模式，非前端美化卡请勿勾选</span>
                            <input type="checkbox" id="tts-iframe-switch" class="tts-toggle" ${settings.iframe_mode ? 'checked' : ''}>
                        </label>

                        <div class="tts-input-row">
                            <span class="tts-input-label">气泡风格</span>
                            <div class="tts-custom-select" id="style-dropdown" style="margin-top:5px;">
                                <div class="select-trigger" data-value="default">
                                    <span>🌿 森野·极简</span>
                                    <i class="arrow-icon">▼</i>
                                </div>
                                <div class="select-options">
                                    <div class="option-item" data-value="default">🌿 森野·极简</div>
                                    <div class="option-item" data-value="cyberpunk">⚡赛博·霓虹</div>
                                    <div class="option-item" data-value="ink">✒️ 水墨·烟雨</div>
                                    <div class="option-item" data-value="kawaii">💎 幻彩·琉璃</div>
                                    <div class="option-item" data-value="bloom">🌸 花信·初绽</div>
                                    <div class="option-item" data-value="rouge">💋 魅影·微醺</div>
                                    <div class="option-item" data-value="holo">🛸 星舰·光环</div>
                                    <div class="option-item" data-value="scroll">📜 羊皮·史诗</div>
                                    <div class="option-item" data-value="steampunk">⚙️ 蒸汽·机械</div>
                                    <div class="option-item" data-value="tactical">🎯 战术·指令</div>
                                    <div class="option-item" data-value="obsidian">🌑 黑曜石·极夜</div>
                                    <div class="option-item" data-value="classic">📼 旧日·回溯</div>
                                </div>
                            </div>
                            <input type="hidden" id="style-selector" value="default">
                        </div>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">📂 路径与语言配置</div>

                        <div class="tts-input-row">
                            <span class="tts-input-label">🗣 参考音频语言 (文件夹)</span>
                            <select id="tts-lang-select" class="tts-modern-input">
                                <option value="default" ${currentLang === 'default' ? 'selected' : ''}>Default (根目录)</option>
                                <option value="Chinese" ${currentLang === 'Chinese' ? 'selected' : ''}>Chinese (中文)</option>
                                <option value="Japanese" ${currentLang === 'Japanese' ? 'selected' : ''}>Japanese (日语)</option>
                                <option value="English" ${currentLang === 'English' ? 'selected' : ''}>English (英语)</option>
                            </select>
                            <div style="font-size:11px; color:#888; margin-top:4px;">对应 reference_audios 下的子文件夹</div>
                        </div>

                        <div style="text-align:right; margin-top:12px;">
                            <button id="tts-btn-save-paths" class="btn-primary">保存配置</button>
                        </div>
                    </div>

                    <div class="tts-card">
                        <div class="tts-card-title">🔗 角色绑定</div>
                         <div style="display:flex; gap:8px; margin-bottom:12px;">
                            <input type="text" id="tts-new-char" class="tts-modern-input" style="flex: 1; min-width: 0;" placeholder="角色名">

                            <select id="tts-new-model" class="tts-modern-input" style="flex: 2; min-width: 0;">
                                <option>...</option>
                            </select>
                        </div>

                        <button id="tts-btn-bind-new" class="btn-primary" style="width:100%">+ 绑定</button>
                        <div class="tts-list-zone" style="margin-top:15px;">
                            <div id="tts-mapping-list" class="tts-list-container" style="border:none; background:transparent;"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}
export function getBubbleMenuHTML() {
    return `
    <div id="tts-bubble-menu" class="tts-context-menu" style="display:none;">
        <div class="menu-item" id="tts-action-download">
            <span class="icon">⬇️</span> 下载语音 (Download)
        </div>
        <div class="divider"></div>
        <div class="menu-item" id="tts-action-reroll">
            <span class="icon">🔄</span> 重绘 (Re-Roll)
        </div>
        <div class="menu-item" id="tts-action-fav">
            <span class="icon">❤️</span> 收藏 (Favorite)
        </div>
        <div class="divider"></div>
        <div class="menu-item close-item" style="color:#999; justify-content:center; font-size:12px;">
            点击外部关闭
        </div>
    </div>
    `;
}
