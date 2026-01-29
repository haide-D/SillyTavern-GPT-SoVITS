/**
 * 模拟手机 UI 核心框架 (非真实移动端)
 * 
 * 注意: 这是在浏览器中渲染的一个"虚拟小手机"界面，
 *       并非针对移动设备的适配代码。该模块模拟手机外壳、
 *       内置 App 路由、来电/通话等功能，用于桌面端的沉浸式交互体验。
 * 
 * 负责: 渲染手机壳、处理拖拽交互、管理 App 路由
 */

// 导入 App 模块
import * as IncomingCallApp from './mobile_apps/incoming_call_app.js';
import * as SettingsApp from './mobile_apps/settings_app.js';
import * as FavoritesApp from './mobile_apps/favorites_app.js';
import * as LlmTestApp from './mobile_apps/llm_test_app.js';
import * as PhoneCallApp from './mobile_apps/phone_call_app.js';
import * as EavesdropApp from './mobile_apps/eavesdrop_app.js';

if (!window.TTS_Mobile) {
    window.TTS_Mobile = {};
}

export const TTS_Mobile = window.TTS_Mobile;

(function (scope) {
    // ==================== 状态管理 ====================
    let STATE = {
        isOpen: false,
        currentApp: null
    };

    // ==================== 导航栏组件 ====================
    function createNavbar(title) {
        const $nav = $(`
            <div class="mobile-app-navbar">
                <div class="nav-left" style="display:flex; align-items:center;">
                    <span style="font-size:20px; margin-right:5px;">←</span> 返回
                </div>
                <div class="nav-title">${title}</div>
                <div class="nav-right" style="width:40px;"></div>
            </div>
        `);
        $nav.find('.nav-left').click(() => {
            $('#mobile-home-btn').click();
        });
        return $nav;
    }

    // ==================== App 注册表 ====================
    const APPS = {
        'incoming_call': {
            name: '来电',
            icon: '📞',
            bg: '#667eea',
            render: async (container) => {
                await IncomingCallApp.render(container, createNavbar);
            }
        },
        'settings': {
            name: '系统设置',
            icon: '⚙️',
            bg: '#333',
            render: async (container) => {
                await SettingsApp.render(container, createNavbar);
            }
        },
        'favorites': {
            name: '收藏夹',
            icon: '❤️',
            bg: 'var(--s-ready-bg, #e11d48)',
            render: async (container) => {
                await FavoritesApp.render(container, createNavbar);
            }
        },
        'llm_test': {
            // name: 'LLM测试',  // 注释掉则不在主屏显示
            icon: '🤖',
            bg: '#8b5cf6',
            render: async (container) => {
                await LlmTestApp.render(container, createNavbar);
            }
        },
        'phone_call': {
            // name: '主动电话',  // 注释掉则不在主屏显示
            icon: '📞',
            bg: '#10b981',
            render: async (container) => {
                await PhoneCallApp.render(container, createNavbar);
            }
        },
        'eavesdrop': {
            name: '对话追踪',
            icon: '🎧',
            bg: '#22c55e',
            render: async (container) => {
                await EavesdropApp.render(container, createNavbar);
            }
        }
    };

    // ==================== 初始化 ====================
    scope.init = function () {
        if ($('meta[name="viewport"]').length === 0) {
            $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">');
            console.log("📱 [Mobile] 已注入 Viewport 标签以适配手机屏幕");
        }

        if ($('#tts-mobile-root').length === 0) {
            injectStyles();
            renderShell();
            bindEvents();
            console.log("📱 [Mobile] 手机界面已初始化");
        }
    };

    // ==================== CSS 注入 (占位，实际由 Loader 加载) ====================
    function injectStyles() {
        console.log("📱 [Mobile] CSS 应由 Loader 加载，跳过 JS 注入");
    }

    // ==================== 渲染手机壳 ====================
    function renderShell() {
        const html = `
        <div id="tts-mobile-trigger">
            <div class="trigger-bubble-inner">
                <div class="trigger-waves">
                    <span class="trigger-bar"></span>
                    <span class="trigger-bar"></span>
                    <span class="trigger-bar"></span>
                </div>
            </div>
        </div>
        <div id="tts-mobile-root" class="minimized">
            <div id="tts-mobile-power-btn" title="关闭手机"></div>
            <div class="side-btn volume-up"></div>
            <div class="side-btn volume-down"></div>
            <div class="mobile-notch"></div>
            <div class="status-bar">
                <span>10:24</span>
                <span>📶 5G 🔋 100%</span>
            </div>
            <div class="mobile-screen" id="mobile-screen-content"></div>
            <div class="mobile-home-bar" id="mobile-home-btn"></div>
        </div>
        `;
        $('body').append(html);
        renderHomeScreen();

        // 🔍 调试 + 修复：检查悬浮球位置，并在手机端强制居中
        setTimeout(() => {
            const $trigger = $('#tts-mobile-trigger');
            const el = $trigger[0];
            if (el) {
                const computed = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const isMobile = window.matchMedia('(max-width: 768px)').matches;

                console.log('🔍 [Debug] 悬浮球调试信息:');
                console.log('  - 屏幕尺寸:', window.innerWidth, 'x', window.innerHeight);
                console.log('  - 媒体查询 max-width:768px 匹配:', isMobile);
                console.log('  - 计算样式 top:', computed.top);
                console.log('  - 计算样式 right:', computed.right);
                console.log('  - 计算样式 transform:', computed.transform);
                console.log('  - 内联样式:', el.style.cssText || '(无)');
                console.log('  - getBoundingClientRect:', JSON.stringify(rect));
                console.log('  - 预期垂直中心位置:', window.innerHeight / 2);
                console.log('  - 实际垂直中心位置:', rect.top + rect.height / 2);

                // 🔧 修复：如果是手机端且位置不对，直接用JS设置
                if (isMobile) {
                    const expectedTop = (window.innerHeight - 40) / 2; // 40是悬浮球高度
                    const actualCenter = rect.top + rect.height / 2;
                    const expectedCenter = window.innerHeight / 2;

                    if (Math.abs(actualCenter - expectedCenter) > 50) {
                        console.log('🔧 [Fix] 检测到位置异常，强制修复！');
                        console.log('  - 设置 top:', expectedTop + 'px');
                        // 用原生 setProperty 才能覆盖 CSS 的 !important
                        el.style.setProperty('top', expectedTop + 'px', 'important');
                        el.style.setProperty('transform', 'none', 'important');
                        el.style.setProperty('animation', 'none', 'important');
                        console.log('  - 修复后内联样式:', el.style.cssText);
                    }
                }
            } else {
                console.log('🔍 [Debug] 悬浮球元素未找到!');
            }
        }, 500);
    }

    // ==================== 渲染主屏幕 ====================
    function renderHomeScreen() {
        const $screen = $('#mobile-screen-content');
        $screen.empty();

        const $grid = $(`<div class="app-grid"></div>`);
        Object.keys(APPS).forEach(key => {
            const app = APPS[key];
            if (!app.name) return; // 跳过没有 name 的应用
            const item = `
            <div class="app-icon-wrapper" data-app="${key}">
                <div class="app-icon" style="background:${app.bg || 'rgba(255,255,255,0.2)'}">
                    ${app.icon}
                </div>
                <span class="app-name">${app.name}</span>
            </div>
            `;
            $grid.append(item);
        });

        $screen.append($grid);
        STATE.currentApp = null;
    }

    // ==================== 打开 App ====================
    scope.openApp = function (appKey) {
        const app = APPS[appKey];
        if (!app) return;

        if (app.action) {
            app.action();
            return;
        }

        const $screen = $('#mobile-screen-content');
        $screen.empty();
        const $appContainer = $(`<div class="app-container" style="width:100%; height:100%; display:flex; flex-direction:column; background:#f2f2f7; color:#000;"></div>`);

        if (app.render) {
            app.render($appContainer);
        }
        $screen.append($appContainer);
        STATE.currentApp = appKey;
    };

    // ==================== 事件绑定 ====================
    function bindEvents() {
        const $phone = $('#tts-mobile-root');
        const $trigger = $('#tts-mobile-trigger');

        let isDragging = false;
        let hasMoved = false;

        let startX, startY;
        let shiftX, shiftY;
        let winW, winH;

        const DRAG_THRESHOLD = 10;

        // 拖拽开始
        $trigger.on('mousedown touchstart', function (e) {
            if (e.type === 'touchstart' && e.touches.length > 1) return;
            if (e.cancelable) e.preventDefault();

            const point = e.type === 'touchstart' ? e.touches[0] : e;
            const rect = $trigger[0].getBoundingClientRect();

            startX = point.clientX;
            startY = point.clientY;
            shiftX = startX - rect.left;
            shiftY = startY - rect.top;

            winW = $(window).width();
            winH = $(window).height();

            isDragging = true;
            hasMoved = false;

            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchend', onUp);
        });

        function onMove(e) {
            if (!isDragging) return;
            if (e.cancelable) e.preventDefault();

            const point = e.type === 'touchmove' ? e.touches[0] : e;
            const currentX = point.clientX;
            const currentY = point.clientY;
            const el = $trigger[0];

            if (!hasMoved) {
                const moveDis = Math.sqrt(Math.pow(currentX - startX, 2) + Math.pow(currentY - startY, 2));
                if (moveDis < DRAG_THRESHOLD) return;
                hasMoved = true;
                // 用 setProperty 覆盖 !important
                el.style.setProperty('position', 'fixed', 'important');
                el.style.setProperty('right', 'auto', 'important');
                el.style.setProperty('bottom', 'auto', 'important');
                el.style.setProperty('transform', 'none', 'important');
                el.style.setProperty('animation', 'none', 'important');
            }

            let newLeft = currentX - shiftX;
            let newTop = currentY - shiftY;

            newLeft = Math.max(0, Math.min(winW - 60, newLeft));
            newTop = Math.max(0, Math.min(winH - 60, newTop));

            // 用 setProperty 覆盖 !important
            el.style.setProperty('left', newLeft + 'px', 'important');
            el.style.setProperty('top', newTop + 'px', 'important');
        }

        function onUp(e) {
            isDragging = false;

            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchend', onUp);

            if (!hasMoved) {
                togglePhone();
            } else {
                snapToEdge();
            }
        }

        function snapToEdge() {
            const el = $trigger[0];
            const rect = el.getBoundingClientRect();
            const midX = winW / 2;
            const targetLeft = (rect.left + 30 < midX) ? 10 : (winW - 50);

            // 用 setProperty 覆盖 !important，并用 CSS transition 做动画
            el.style.setProperty('transition', 'left 0.2s ease', 'important');
            el.style.setProperty('left', targetLeft + 'px', 'important');

            // 动画结束后移除 transition、animation 和 transform 限制
            setTimeout(() => {
                el.style.removeProperty('transition');
                // 🔧 修复：移除拖动时强制设置的样式，恢复来电震动动画
                el.style.removeProperty('animation');
                el.style.removeProperty('transform');
            }, 200);
        }

        // 电源键关闭
        $('#tts-mobile-power-btn').click(function (e) {
            e.stopPropagation();
            closePhone();
        });

        // 点击外部关闭
        $(document).on('click', function (e) {
            if (STATE.isOpen) {
                if ($(e.target).closest('#tts-mobile-root, #tts-mobile-trigger').length === 0) {
                    closePhone();
                }
            }
        });

        // 阻止手机内部点击冒泡
        $phone.on('click', function (e) {
            e.stopPropagation();
        });

        // App 图标点击
        $phone.on('click', '.app-icon-wrapper', function () {
            const key = $(this).data('app');
            scope.openApp(key);
        });

        // Home 键
        $('#mobile-home-btn').click(function () {
            renderHomeScreen();
        });
    }

    // ==================== 手机状态切换 ====================
    function togglePhone() {
        // 优先检查来电
        if (window.TTS_IncomingCall) {
            console.log('[Mobile] 检测到来电,打开小手机并显示来电界面');
            $('#tts-mobile-trigger').removeClass('incoming-call');
            $('#tts-manager-btn').removeClass('incoming-call');

            if (!STATE.isOpen) {
                openPhone();
            }
            scope.openApp('incoming_call');
            return;
        }

        // 检查对话追踪通知
        if (window.TTS_EavesdropData) {
            console.log('[Mobile] 检测到对话追踪,打开小手机并显示监听界面');
            $('#tts-mobile-trigger').removeClass('eavesdrop-available');
            $('#tts-manager-btn').removeClass('eavesdrop-available');

            if (!STATE.isOpen) {
                openPhone();
            }
            scope.openApp('eavesdrop');
            return;
        }

        if (STATE.isOpen) closePhone();
        else openPhone();
    }

    function openPhone() {
        $('#tts-mobile-root').removeClass('minimized');
        $('#tts-mobile-trigger').fadeOut();
        STATE.isOpen = true;
        renderHomeScreen();
    }

    function closePhone() {
        $('#tts-mobile-root').addClass('minimized');
        $('#tts-mobile-trigger').fadeIn();
        STATE.isOpen = false;
    }

})(window.TTS_Mobile);
