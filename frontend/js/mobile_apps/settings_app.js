/**
 * 系统设置 App 模块
 * 加载并渲染 TTS 配置 Dashboard
 */

/**
 * 渲染设置 App
 * @param {jQuery} container - App 容器
 * @param {Function} createNavbar - 创建导航栏函数
 */
export async function render(container, createNavbar) {
    container.html(`
        <div style="display:flex; flex-direction:column; height:100%; align-items:center; justify-content:center; color:#888;">
            <div style="font-size:24px; margin-bottom:10px;">⚙️</div>
            <div>正在同步配置...</div>
        </div>
    `);

    // === 调试日志 ===
    console.log("[Mobile Settings] 开始渲染设置页面");
    console.log("[Mobile Settings] window.TTS_UI 存在?", !!window.TTS_UI);
    console.log("[Mobile Settings] window.TTS_UI.Templates 存在?", !!(window.TTS_UI && window.TTS_UI.Templates));
    console.log("[Mobile Settings] window.TTS_UI.CTX 存在?", !!(window.TTS_UI && window.TTS_UI.CTX));

    if (window.TTS_UI) {
        console.log("[Mobile Settings] window.TTS_UI 内容:", window.TTS_UI);
        if (window.TTS_UI.CTX) {
            console.log("[Mobile Settings] window.TTS_UI.CTX 内容:", window.TTS_UI.CTX);
            console.log("[Mobile Settings] window.TTS_UI.CTX.CACHE 存在?", !!window.TTS_UI.CTX.CACHE);
        }
    }

    try {
        if (window.refreshTTS) await window.refreshTTS();
        else if (window.TTS_UI && window.TTS_UI.CTX && window.TTS_UI.CTX.Callbacks.refreshData) {
            await window.TTS_UI.CTX.Callbacks.refreshData();
        }
    } catch (e) { console.error("刷新数据失败", e); }

    if (!window.TTS_UI || !window.TTS_UI.Templates || !window.TTS_UI.CTX) {
        container.html('<div style="padding:20px; text-align:center;">⚠️ 核心UI模块未就绪</div>');
        return;
    }

    const CTX = window.TTS_UI.CTX;

    // 安全检查: 确保 CACHE 已初始化
    if (!CTX.CACHE) {
        container.html('<div style="padding:20px; text-align:center;">⚠️ 数据缓存未初始化</div>');
        return;
    }

    const settings = CTX.CACHE.settings || {};
    let config = { useRemote: false, ip: "" };
    try {
        const saved = localStorage.getItem('tts_plugin_remote_config');
        if (saved) config = JSON.parse(saved);
    } catch (e) { }

    const templateData = {
        isEnabled: settings.enabled !== false,
        settings: settings,
        isRemote: config.useRemote,
        remoteIP: config.ip,
        currentBase: settings.base_dir || "",
        currentCache: settings.cache_dir || "",
        currentLang: settings.default_lang || "default"
    };

    const fullHtml = window.TTS_UI.Templates.getDashboardHTML(templateData);
    const $tempContent = $('<div>').append(fullHtml);
    const $panel = $tempContent.find('#tts-dashboard');

    $panel.find('.tts-header').remove();
    $panel.find('.tts-close').remove();
    $panel.addClass('mobile-settings-content');
    $panel.removeAttr('id');

    const $navBar = createNavbar("系统配置");

    container.empty();
    container.append($navBar);
    container.append($panel);

    if (window.TTS_UI.renderDashboardList) window.TTS_UI.renderDashboardList();
    if (window.TTS_UI.renderModelOptions) window.TTS_UI.renderModelOptions();
    if (window.TTS_UI.bindDashboardEvents) window.TTS_UI.bindDashboardEvents();
}

export default { render };
