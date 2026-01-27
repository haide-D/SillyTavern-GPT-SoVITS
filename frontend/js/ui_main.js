// 文件: ui_main.js
console.log("🔵 [UI] TTS_UI.js (Refactored) 开始加载...");

if (!window.TTS_UI) {
    window.TTS_UI = {};
}

export const TTS_UI = window.TTS_UI;

(function (scope) {
    scope.CTX = {
        CACHE: null,
        API_URL: "",
        Utils: null,
        Callbacks: {}
    };

    scope.init = function (context, renderButton = true) {
        // 更新内部引用
        scope.CTX = context;

        // 只有 renderButton 为 true 时才创建悬浮窗
        if (renderButton && $('#tts-manager-btn').length === 0) {
            console.log("[UI] UI模块挂载/重置");
            scope.initFloatingButton();
        }
        if ($('#tts-bubble-menu').length === 0) {
            $('body').append(window.TTS_UI.Templates.getBubbleMenuHTML());
        }
    };

    scope.initFloatingButton = function () {
        if ($('#tts-manager-btn').length > 0) return;

        $('body').append(window.TTS_UI.Templates.getFloatingButtonHTML());

        // 修改点击事件:优先检查来电
        const handleClick = function () {
            // 检查是否有来电
            if (window.TTS_IncomingCall) {
                console.log('[UI] 检测到来电,显示来电界面');
                scope.showIncomingCallUI();
            } else {
                scope.showDashboard();
            }
        };

        if (scope.CTX.Utils && scope.CTX.Utils.makeDraggable) {
            scope.CTX.Utils.makeDraggable($('#tts-manager-btn'), handleClick);
        } else {
            $('#tts-manager-btn').click(handleClick);
        }
    };

    scope.showDashboard = function () {
        // 清理旧面板
        $('#tts-dashboard-overlay').remove();

        const settings = scope.CTX.CACHE.settings || {};
        const savedConfig = localStorage.getItem('tts_plugin_remote_config');
        const config = savedConfig ? JSON.parse(savedConfig) : { useRemote: false, ip: "" };

        const templateData = {
            isEnabled: settings.enabled !== false,
            settings: settings,
            isRemote: config.useRemote,
            remoteIP: config.ip,
            currentBase: settings.base_dir || "",
            currentCache: settings.cache_dir || "",
            currentLang: settings.default_lang || "default"
        };

        const html = window.TTS_UI.Templates.getDashboardHTML(templateData);
        $('body').append(html);

        scope.renderDashboardList();
        scope.renderModelOptions();
        scope.bindDashboardEvents();
    };

    /**
     * 显示来电界面
     * 注意: 来电/通话 UI 统一由模拟手机界面 (TTS_Mobile) 处理
     */
    scope.showIncomingCallUI = function () {
        const callData = window.TTS_IncomingCall;
        if (!callData) return;

        // 移除震动效果
        $('#tts-manager-btn').removeClass('incoming-call');
        $('#tts-mobile-trigger').removeClass('incoming-call');

        // 来电界面由模拟手机 UI 处理
        if (window.TTS_Mobile && window.TTS_Mobile.openApp) {
            console.log('[UI] 使用模拟手机来电界面');
            // 打开小手机(如果未打开)
            const $mobileRoot = $('#tts-mobile-root');
            if ($mobileRoot.length > 0 && $mobileRoot.hasClass('minimized')) {
                $mobileRoot.removeClass('minimized');
                $('#tts-mobile-trigger').fadeOut();
            }
            // 打开来电应用
            window.TTS_Mobile.openApp('incoming_call');
        } else {
            console.warn('[UI] 模拟手机界面不可用，无法显示来电');
        }
    };
    scope.handleUnbind = async function (c) {
        if (!confirm(`确定要解绑角色 "${c}" 吗？`)) return;

        try {
            await window.TTS_API.unbindCharacter(c);
            await scope.CTX.Callbacks.refreshData();
            scope.renderDashboardList();
            // 重置状态
            $(`.voice-bubble[data-voice-name="${c}"]`).attr('data-status', 'waiting').removeClass('error playing ready');
        } catch (e) {
            console.error(e);
            alert("解绑失败");
        }
    };

})(window.TTS_UI);
