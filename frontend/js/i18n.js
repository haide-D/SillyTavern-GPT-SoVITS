// frontend/js/i18n.js

const translations = {
    'zh': {
        // mobile_ui.js
        'app_incoming_call': '来电',
        'app_settings': '系统设置',
        'app_favorites': '收藏夹',
        'app_eavesdrop': '对话追踪',
        'app_realtime': '实时对话',
        'app_llm_test': 'LLM测试',
        'app_phone_call': '主动电话',
        'nav_back': '返回',
        
        // settings_app.js
        'settings_syncing': '正在同步配置...',
        'settings_core_ui_error': '⚠️ 核心UI模块未就绪',
        'settings_cache_error': '⚠️ 数据缓存未初始化',

        // ui_templates.js
        'tts_config_btn': '🔊 TTS配置',
        'dashboard_title': '🎧 语音配置中心',
        'sys_status': '🔌 系统状态',
        'enable_tts': '启用 TTS 插件',
        'preload_model': '预加载模型(自动生成,建议开启)',
        'conn_mode': '📡 连接模式',
        'remote_mode': '远程模式 (局域网部署用)',
        'pc_ip': '电脑 IP',
        'btn_save': '保存',
        'visual_exp': '🎨 视觉体验',
        'iframe_mode': '美化卡专用模式，非前端美化卡请勿勾选',
        'bubble_style': '气泡风格',
        
        // styles
        'style_default': '🌿 森野·极简',
        'style_cyberpunk': '⚡赛博·霓虹',
        'style_ink': '✒️ 水墨·烟雨',
        'style_kawaii': '💎 幻彩·琉璃',
        'style_bloom': '🌸 花信·初绽',
        'style_rouge': '💋 魅影·微醺',
        'style_holo': '🛸 星舰·光环',
        'style_scroll': '📜 羊皮·史诗',
        'style_steampunk': '⚙️ 蒸汽·机械',
        'style_tactical': '🎯 战术·指令',
        'style_obsidian': '🌑 黑曜石·极夜',
        'style_classic': '📼 旧日·回溯',

        'path_lang_config': '📂 路径与语言配置',
        'ref_audio_lang': '🗣 参考音频语言 (文件夹)',
        'ref_audio_subfolder_tip': '对应 reference_audios 下的子文件夹',
        'save_config': '保存配置',
        'char_binding': '🔗 角色绑定',
        'char_name': '角色名',
        'bind_btn': '+ 绑定',
        
        'tg_asset_import': '🤖 Telegram 资产导入',
        'import_tg_from_tavern': '从酒馆导入 Telegram 资产',
        'refresh_asset_binding': '刷新资产/绑定',
        'tg_import_tip': '先导入角色/世界/剧本资产，再单独把 Telegram bot 绑定到生成的角色引用。',
        'loading_tg_assets': '正在加载 Telegram 资产...',

        'bubble_download': '⬇️ 下载语音 (Download)',
        'bubble_reroll': '🔄 重绘 (Re-Roll)',
        'bubble_fav': '❤️ 收藏 (Favorite)',
        'click_outside_close': '点击外部关闭',

        'lang_label': '🌐 语言 / Language'
    },
    'en': {
        // mobile_ui.js
        'app_incoming_call': 'Incoming Call',
        'app_settings': 'Settings',
        'app_favorites': 'Favorites',
        'app_eavesdrop': 'Tracker',
        'app_realtime': 'Realtime Chat',
        'app_llm_test': 'LLM Test',
        'app_phone_call': 'Phone Call',
        'nav_back': 'Back',
        
        // settings_app.js
        'settings_syncing': 'Syncing config...',
        'settings_core_ui_error': '⚠️ Core UI module not ready',
        'settings_cache_error': '⚠️ Data cache not initialized',

        // ui_templates.js
        'tts_config_btn': '🔊 TTS Config',
        'dashboard_title': '🎧 Voice Config Center',
        'sys_status': '🔌 System Status',
        'enable_tts': 'Enable TTS Plugin',
        'preload_model': 'Preload Model (Auto-generate, recommended)',
        'conn_mode': '📡 Connection Mode',
        'remote_mode': 'Remote Mode (For LAN Deployment)',
        'pc_ip': 'PC IP',
        'btn_save': 'Save',
        'visual_exp': '🎨 Visual Experience',
        'iframe_mode': 'Beautified Card Mode (Do not check if not using beautified UI)',
        'bubble_style': 'Bubble Style',
        
        // styles
        'style_default': '🌿 Forest·Minimal',
        'style_cyberpunk': '⚡ Cyber·Neon',
        'style_ink': '✒️ Ink·Misty',
        'style_kawaii': '💎 Phantom·Glaze',
        'style_bloom': '🌸 Bloom·Bud',
        'style_rouge': '💋 Phantom·Tipsy',
        'style_holo': '🛸 Starship·Halo',
        'style_scroll': '📜 Parchment·Epic',
        'style_steampunk': '⚙️ Steam·Mech',
        'style_tactical': '🎯 Tactical·Cmd',
        'style_obsidian': '🌑 Obsidian·Night',
        'style_classic': '📼 Classic·Retro',

        'path_lang_config': '📂 Path & Lang Config',
        'ref_audio_lang': '🗣 Ref Audio Lang (Folder)',
        'ref_audio_subfolder_tip': 'Corresponds to subfolders under reference_audios',
        'save_config': 'Save Config',
        'char_binding': '🔗 Character Binding',
        'char_name': 'Character Name',
        'bind_btn': '+ Bind',
        
        'tg_asset_import': '🤖 Telegram Asset Import',
        'import_tg_from_tavern': 'Import Telegram Assets from Tavern',
        'refresh_asset_binding': 'Refresh Assets/Bindings',
        'tg_import_tip': 'Import Character/World/Lore assets first, then bind the Telegram bot to the generated character reference.',
        'loading_tg_assets': 'Loading Telegram Assets...',

        'bubble_download': '⬇️ Download Voice',
        'bubble_reroll': '🔄 Re-Roll',
        'bubble_fav': '❤️ Favorite',
        'click_outside_close': 'Click outside to close',

        'lang_label': '🌐 语言 / Language'
    }
};

let currentLang = 'zh';

export function initI18n() {
    const savedLang = localStorage.getItem('tts_plugin_lang');
    if (savedLang && (savedLang === 'zh' || savedLang === 'en')) {
        currentLang = savedLang;
    } else {
        // Auto detect based on browser lang, default to zh
        const browserLang = navigator.language || navigator.userLanguage;
        if (browserLang && browserLang.startsWith('en')) {
            currentLang = 'en';
        } else {
            currentLang = 'zh';
        }
    }
}

export function setLang(lang) {
    if (lang === 'zh' || lang === 'en') {
        currentLang = lang;
        localStorage.setItem('tts_plugin_lang', lang);
    }
}

export function getLang() {
    return currentLang;
}

export function t(key) {
    if (translations[currentLang] && translations[currentLang][key]) {
        return translations[currentLang][key];
    }
    // Fallback to zh if key missing in en
    if (translations['zh'] && translations['zh'][key]) {
        return translations['zh'][key];
    }
    return key; // return key itself if not found
}

// Initialize on script load
initI18n();
