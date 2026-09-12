/**
 * 沉浸式主题引擎 (Immersive Theme Engine)
 *
 * 核心职责:
 * - 主题注册与切换
 * - 场景路由（Scene Routing）
 * - 通知分发（Notification Dispatch）
 * - 面板生命周期管理
 * - 主题设置后端持久化
 *
 * 设计原则:
 * - 场景驱动，而非方法驱动：主题按需注册场景，新功能不破坏旧主题
 * - Fallback 机制：主题未实现的场景自动降级到通用 UI
 */

import { createFallbackRenderer, createNavbar } from './themes/theme_utils.js';

// ==================== 全局单例 ====================

if (!window.TTS_ThemeEngine) {
    window.TTS_ThemeEngine = {};
}


(function (engine) {

    // ==================== 内部状态 ====================
    const _state = {
        themes: {},           // 主题注册表 { id: themeConfig }
        currentThemeId: null, // 当前激活主题 ID
        currentScene: null,   // 当前场景 ID
        isOpen: false,        // 面板是否打开
        initialized: false,   // 引擎是否已初始化
        apiHost: '',          // API 地址
        apps: [],             // 已注册的应用列表
    };

    // ==================== App 注册表 ====================

    /**
     * 注册一个新的应用到全局注册表
     * @param {Object} appConfig - { id, defaultName, defaultIcon, sceneId, page, order, category, hidden }
     */
    engine.registerApp = function (appConfig) {
        if (!appConfig || !appConfig.id) {
            console.error('[ThemeEngine] 注册 App 失败: 缺少 id');
            return;
        }
        
        const appEntry = {
            id: appConfig.id,
            defaultName: appConfig.defaultName || appConfig.id,
            defaultIcon: appConfig.defaultIcon || '⚙️',
            sceneId: appConfig.sceneId || appConfig.id,
            page: typeof appConfig.page === 'number' ? appConfig.page : 1, // 桌面页码 (1: 核心页, 2: 扩展页)
            order: typeof appConfig.order === 'number' ? appConfig.order : 100, // 排序权重 (越小越靠前)
            category: appConfig.category || 'tool',
            hidden: !!appConfig.hidden,
            ...appConfig
        };

        // 检查是否已存在
        const existingIndex = _state.apps.findIndex(a => a.id === appConfig.id);
        if (existingIndex >= 0) {
            _state.apps[existingIndex] = { ..._state.apps[existingIndex], ...appEntry };
        } else {
            _state.apps.push(appEntry);
        }

        // 保持全局应用按 page 升序，再按 order 升序排列
        _state.apps.sort((a, b) => {
            if (a.page !== b.page) return a.page - b.page;
            return a.order - b.order;
        });

        console.log(`[ThemeEngine] ✅ App 已注册: ${appConfig.id} (Page: ${appEntry.page}, Order: ${appEntry.order}, Hidden: ${appEntry.hidden})`);
    };

    /**
     * 获取所有已注册的应用列表
     * @param {Object} [filter] - { page?: number, includeHidden?: boolean }
     * @returns {Array} 
     */
    engine.getRegisteredApps = function (filter = {}) {
        let list = _state.apps;
        if (!filter.includeHidden) {
            list = list.filter(a => !a.hidden);
        }
        if (typeof filter.page === 'number') {
            list = list.filter(a => a.page === filter.page);
        }
        return list;
    };

    // ==================== 主题管理 ====================

    /**
     * 注册主题
     * @param {Object} themeConfig - 主题配置对象
     */
    engine.registerTheme = function (themeConfig) {
        if (!themeConfig || !themeConfig.id) {
            console.error('[ThemeEngine] 注册失败: 主题缺少 id');
            return;
        }

        // 校验核心字段
        const required = ['id', 'name', 'init', 'destroy', 'renderTrigger'];
        for (const field of required) {
            if (!themeConfig[field]) {
                console.warn(`[ThemeEngine] ⚠️ 主题 "${themeConfig.id}" 缺少字段: ${field}`);
            }
        }

        // 确保 scenes 存在
        if (!themeConfig.scenes) {
            themeConfig.scenes = {};
        }

        _state.themes[themeConfig.id] = themeConfig;
    };

    /**
     * 获取所有已注册的主题
     * @returns {Array} 主题配置对象数组
     */
    engine.getRegisteredThemes = function () {
        return Object.values(_state.themes);
    };

    /**
     * 切换主题
     * @param {string} themeId - 目标主题 ID
     * @param {boolean} persist - 是否持久化到后端（默认 true）
     */
    engine.switchTheme = async function (themeId, persist = true) {
        if (!_state.themes[themeId]) {
            console.error(`[ThemeEngine] 切换失败: 主题 "${themeId}" 未注册`);
            return false;
        }

        if (_state.currentThemeId === themeId) {
            console.log(`[ThemeEngine] 主题 "${themeId}" 已是当前主题，跳过`);
            return true;
        }

        console.log(`[ThemeEngine] 🔄 切换主题: ${_state.currentThemeId || '(无)'} → ${themeId}`);

        // 1. 销毁旧主题
        if (_state.currentThemeId) {
            const oldTheme = _state.themes[_state.currentThemeId];
            try {
                // 先关闭面板
                if (_state.isOpen) {
                    engine.close();
                }
                // 销毁触发器
                if (oldTheme.destroyTrigger) {
                    oldTheme.destroyTrigger();
                }
                // 销毁主题
                if (oldTheme.destroy) {
                    oldTheme.destroy();
                }
                // 移除旧主题的 CSS
                $('#tts-theme-css-inject').remove();

                console.log(`[ThemeEngine] 旧主题 "${_state.currentThemeId}" 已销毁`);
            } catch (e) {
                console.error(`[ThemeEngine] 销毁旧主题失败:`, e);
            }
        }

        // 2. 激活新主题
        _state.currentThemeId = themeId;
        _state.currentScene = null;
        const newTheme = _state.themes[themeId];

        try {
            // 注入新主题 CSS (如果提供)
            if (newTheme.cssUrl) {
                if ($('#tts-theme-css-inject').length === 0) {
                    const link = document.createElement('link');
                    link.id = 'tts-theme-css-inject';
                    link.rel = 'stylesheet';
                    link.type = 'text/css';
                    link.href = newTheme.cssUrl;
                    document.head.appendChild(link);
                } else {
                    $('#tts-theme-css-inject').attr('href', newTheme.cssUrl);
                }
            }

            // 初始化主题
            if (newTheme.init) {
                await newTheme.init(engine);
            }
            // 渲染触发器
            if (newTheme.renderTrigger) {
                newTheme.renderTrigger(engine);
            }
            console.log(`[ThemeEngine] ✅ 主题 "${themeId}" 已激活`);
        } catch (e) {
            console.error(`[ThemeEngine] 激活主题失败:`, e);
            return false;
        }

        // 3. 持久化到后端
        if (persist && _state.apiHost) {
            try {
                const headers = (window.TTS_API && typeof window.TTS_API._headers === 'function')
                    ? window.TTS_API._headers({ 'Content-Type': 'application/json' })
                    : { 'Content-Type': 'application/json' };
                await fetch(`${_state.apiHost}/theme`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ theme_id: themeId })
                });
                console.log(`[ThemeEngine] 主题设置已保存到后端`);
            } catch (e) {
                console.warn(`[ThemeEngine] 保存主题设置失败:`, e);
            }
        }

        return true;
    };

    /**
     * 获取当前主题配置
     */
    engine.getCurrentTheme = function () {
        return _state.currentThemeId ? _state.themes[_state.currentThemeId] : null;
    };

    /**
     * 获取当前主题 ID
     */
    engine.getCurrentThemeId = function () {
        return _state.currentThemeId;
    };

    /**
     * 获取所有已注册主题列表
     * @returns {Array} [{id, name, description}]
     */
    engine.getAvailableThemes = function () {
        return Object.values(_state.themes).map(t => ({
            id: t.id,
            name: t.name,
            version: t.version || '1.0.0',
            description: t.description || ''
        }));
    };

    // ==================== 场景路由 ====================

    /**
     * 显示指定场景
     * @param {string} sceneId - 场景 ID
     * @param {Object} data - 场景数据
     */
    engine.showScene = function (sceneId, data = {}) {
        const theme = engine.getCurrentTheme();
        if (!theme) {
            console.error('[ThemeEngine] 无当前主题，无法显示场景');
            return;
        }

        // 清理当前场景
        if (_state.currentScene) {
            const currentSceneHandler = theme.scenes[_state.currentScene];
            if (currentSceneHandler && currentSceneHandler.cleanup) {
                try {
                    currentSceneHandler.cleanup();
                } catch (e) {
                    console.warn(`[ThemeEngine] 场景 "${_state.currentScene}" 清理失败:`, e);
                }
            }
        }

        // 获取场景容器
        const $container = engine.getSceneContainer();
        if (!$container || !$container.length) {
            console.error('[ThemeEngine] 场景容器不存在');
            return;
        }
        $container.empty();

        // 构建场景上下文（优先使用主题自带的导航栏构造器，实现子 App 风格无缝统一）
        const activeCreateNavbar = (theme && typeof theme.createNavbar === 'function') 
            ? theme.createNavbar 
            : createNavbar;

        const ctx = function(...args) {
            return activeCreateNavbar(...args);
        };
        ctx.engine = engine;
        ctx.data = data;
        ctx.createNavbar = activeCreateNavbar;

        // 查找场景渲染器
        const sceneHandler = theme.scenes[sceneId];
        if (sceneHandler && sceneHandler.render) {
            console.log(`[ThemeEngine] 渲染场景: ${sceneId} (主题实现)`);
            _state.currentScene = sceneId;
            sceneHandler.render($container, ctx);
        } else if (window.TTS_Apps && window.TTS_Apps[sceneId] && window.TTS_Apps[sceneId].render) {
            console.log(`[ThemeEngine] 渲染场景: ${sceneId} (全局 App 实现)`);
            _state.currentScene = sceneId;
            window.TTS_Apps[sceneId].render($container, ctx);
        } else {
            // Fallback: 使用通用渲染器
            console.log(`[ThemeEngine] 渲染场景: ${sceneId} (Fallback)`);
            _state.currentScene = sceneId;
            const fallback = createFallbackRenderer(sceneId);
            fallback.render($container, ctx);
        }
    };

    /**
     * 获取当前场景 ID
     */
    engine.getCurrentScene = function () {
        return _state.currentScene;
    };

    /**
     * 回到主菜单
     */
    engine.goHome = function () {
        engine.showScene('home');
    };

    /**
     * 获取场景容器（由当前主题提供）
     * 主题应该在 init 时设置场景容器
     */
    engine.getSceneContainer = function () {
        const theme = engine.getCurrentTheme();
        if (theme && theme.getSceneContainer) {
            return theme.getSceneContainer();
        }
        // 默认容器
        return $('#tts-theme-scene-container');
    };

    // ==================== 通知分发 ====================

    /**
     * 分发通知给当前主题
     * @param {string} type - 通知类型
     * @param {Object} data - 通知数据
     */
    engine.notify = function (type, data = {}) {
        const theme = engine.getCurrentTheme();
        if (!theme) {
            console.warn(`[ThemeEngine] 无当前主题，通知 "${type}" 被忽略`);
            return;
        }

        console.log(`[ThemeEngine] 📢 通知分发: ${type}`);

        // 让主题自行处理
        if (theme && theme.onNotification) {
            const handled = theme.onNotification(type, data, engine);
            if (handled !== false) {
                return true; // 主题已处理
            }
        }

        // 默认行为（主题未处理时）
        _defaultNotificationHandler(type, data);
        return false;
    };

    /**
     * 默认通知处理器
     */
    function _defaultNotificationHandler(type, data) {
        switch (type) {
            case 'incoming_call':
                console.log('[ThemeEngine] 默认通知: 来电');
                if (window.toastr) {
                    window.toastr.info(`📞 ${data.char_name || '未知'} 来电!`);
                }
                break;
            case 'eavesdrop_ready':
                console.log('[ThemeEngine] 默认通知: 偷听就绪');
                if (window.toastr) {
                    window.toastr.info(`🎧 ${data.notification_text || '检测到对话'}`);
                }
                break;
            case 'call_ended':
                console.log('[ThemeEngine] 默认通知: 通话结束');
                break;
            default:
                console.log(`[ThemeEngine] 未知通知类型: ${type}`);
        }
    }

    // ==================== 面板控制 ====================

    /**
     * 打开主面板
     */
    engine.open = function () {
        if (_state.isOpen) return;

        const theme = engine.getCurrentTheme();
        if (!theme) return;

        _state.isOpen = true;

        if (theme.onOpen) {
            theme.onOpen(engine);
        }

        engine.showScene('home');
    };

    /**
     * 关闭主面板
     */
    engine.close = function () {
        if (!_state.isOpen) return;

        const theme = engine.getCurrentTheme();

        // 清理当前场景
        if (_state.currentScene && theme) {
            const sceneHandler = theme.scenes[_state.currentScene];
            if (sceneHandler && sceneHandler.cleanup) {
                try {
                    sceneHandler.cleanup();
                } catch (e) {
                    console.warn(`[ThemeEngine] 场景清理失败:`, e);
                }
            }
        }

        _state.isOpen = false;
        _state.currentScene = null;

        if (theme && theme.onClose) {
            theme.onClose(engine);
        }
    };

    /**
     * 切换面板开关
     */
    engine.toggle = function () {
        // Notifications may arrive while an earlier item is still waiting.
        const queue = window.TTS_CallQueueManager;
        const current = queue?.getCurrent();
        if (current) queue._syncLegacyGlobals(current);
        // 优先检查来电
        if (window.TTS_IncomingCall) {
            console.log('[ThemeEngine] 检测到来电，打开来电界面');

            if (!_state.isOpen) {
                _state.isOpen = true;
                const theme = engine.getCurrentTheme();
                if (theme && theme.onOpen) {
                    theme.onOpen(engine);
                }
            }
            engine.showScene('incoming_call', window.TTS_IncomingCall);
            return;
        }

        // 检查偷听
        if (window.TTS_EavesdropData) {
            console.log('[ThemeEngine] 检测到偷听数据，打开偷听界面');

            if (!_state.isOpen) {
                _state.isOpen = true;
                const theme = engine.getCurrentTheme();
                if (theme && theme.onOpen) {
                    theme.onOpen(engine);
                }
            }
            engine.showScene('eavesdrop', window.TTS_EavesdropData);
            return;
        }

        if (_state.isOpen) {
            engine.close();
        } else {
            engine.open();
        }
    };

    /**
     * 面板是否打开
     */
    engine.isOpen = function () {
        return _state.isOpen;
    };

    // ==================== 主题化工具方法 ====================

    /**
     * 获取当前主题的标签文案
     * @param {string} key - 标签 key
     * @param {string} fallback - 默认值
     */
    engine.getLabel = function (key, fallback) {
        const theme = engine.getCurrentTheme();
        if (theme && theme.getLabel) {
            const label = theme.getLabel(key);
            if (label) return label;
        }
        return fallback || key;
    };

    /**
     * 获取 API 地址
     */
    engine.getApiHost = function () {
        return _state.apiHost;
    };

    // ==================== 初始化 ====================

    /**
     * 初始化主题引擎
     * @param {string} apiHost - API 地址
     */
    engine.init = async function (apiHost) {
        if (_state.initialized) {
            console.log('[ThemeEngine] 已初始化，跳过');
            return;
        }

        _state.apiHost = apiHost;
        console.log('[ThemeEngine] 🚀 主题引擎初始化...');

        // 从后端加载主题设置
        let savedThemeId = 'default';
        const defaultHeaders = (window.TTS_API && typeof window.TTS_API._headers === 'function')
            ? window.TTS_API._headers()
            : {};
        try {
            const response = await fetch(`${apiHost}/theme`, { headers: defaultHeaders });
            const data = await response.json();
            savedThemeId = data.current || 'default';
            console.log(`[ThemeEngine] 后端主题设置: ${savedThemeId}`);
        } catch (e) {
            console.warn('[ThemeEngine] 加载主题设置失败，使用默认主题');
        }

        // 加载外部扩展主题
        try {
            console.log('[ThemeEngine] 正在加载外部主题列表...');
            const listRes = await fetch(`${apiHost}/api/themes/list`, { headers: defaultHeaders });
            const externalThemes = await listRes.json();
            
            for (const themeMeta of externalThemes) {
                try {
                    const themeBaseUrl = `${apiHost}/api/themes/assets/${themeMeta.id}`;
                    let cssUrl = null;
                    
                    if (themeMeta.entry_css) {
                        cssUrl = `${themeBaseUrl}/${themeMeta.entry_css}`;
                    }

                    if (themeMeta.entry_js) {
                        const moduleUrl = `${themeBaseUrl}/${themeMeta.entry_js}`;
                        const module = await import(moduleUrl);
                        
                        if (module.default) {
                            const config = { ...themeMeta, ...module.default };
                            config.type = 'external'; // 强制标记为外部主题
                            if (cssUrl) config.cssUrl = cssUrl; // 将 CSS 路径附加到配置上
                            engine.registerTheme(config);
                        }
                    }
                } catch (err) {
                    console.error(`[ThemeEngine] 动态加载主题 ${themeMeta.id} 失败:`, err);
                }
            }
        } catch (e) {
            console.warn('[ThemeEngine] 加载外部主题列表失败:', e);
        }

        // 激活保存的主题（不重复持久化）
        if (_state.themes[savedThemeId]) {
            await engine.switchTheme(savedThemeId, false);
        } else if (_state.themes['default']) {
            console.warn(`[ThemeEngine] 主题 "${savedThemeId}" 未注册，使用默认主题`);
            await engine.switchTheme('default', false);
        } else {
            console.error('[ThemeEngine] ❌ 没有任何已注册的主题！');
        }

        _state.initialized = true;
        console.log('[ThemeEngine] ✅ 主题引擎初始化完成');
    };

    /**
     * 检查引擎是否已初始化
     */
    engine.isInitialized = function () {
        return _state.initialized;
    };

})(window.TTS_ThemeEngine);

export const ThemeEngine = window.TTS_ThemeEngine;
