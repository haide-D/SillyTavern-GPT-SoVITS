/**
 * 共享工具函数模块
 * 提供时间格式化、URL 解析等公共功能
 */

/**
 * 格式化时间为 m:ss 格式
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
export function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 格式化时间为 mm:ss 格式（带前导零）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
export function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 解析音频 URL，将相对路径转为完整 URL
 * @param {string} url - 原始 URL
 * @returns {string} 完整 URL
 */
export function resolveAudioUrl(url) {
    if (!url) return '';

    // 已经是完整 URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    // 相对路径，添加 API Host
    if (url.startsWith('/')) {
        const apiHost = getApiHost();
        return apiHost + url;
    }

    return url;
}

/**
 * 获取当前对话分支 ID
 * @returns {string|null} 对话分支 ID
 */
export function getChatBranch() {
    try {
        // 优先使用 TTS_Utils
        if (window.TTS_Utils && window.TTS_Utils.getCurrentChatBranch) {
            return window.TTS_Utils.getCurrentChatBranch();
        }

        // 回退到 SillyTavern API
        const context = window.SillyTavern?.getContext?.();
        if (context && context.chatId) {
            return context.chatId.replace(/\.(jsonl|json)$/i, "");
        }
    } catch (e) {
        console.error('[SharedUtils] 获取 chat_branch 失败:', e);
    }
    return null;
}

/**
 * 获取 API Host 地址
 * @returns {string} API Host URL
 */
export function getApiHost() {
    // 优先使用 TTS_API
    if (window.TTS_API && window.TTS_API.baseUrl) {
        return window.TTS_API.baseUrl;
    }

    // 优先使用 TTS_State 缓存
    if (window.TTS_State && window.TTS_State.CACHE && window.TTS_State.CACHE.API_URL) {
        return window.TTS_State.CACHE.API_URL;
    }

    // 回退到默认地址
    const apiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? '127.0.0.1'
        : window.location.hostname;
    return `http://${apiHost}:3000`;
}

/**
 * 获取角色头像 URL
 * @param {string} charName - 角色名称（可选，用于日志）
 * @returns {string|null} 头像 URL
 */
export function getCharacterAvatar(charName = '') {
    try {
        const context = window.SillyTavern?.getContext?.();
        if (context?.getThumbnailUrl && context?.characters && context?.characterId !== undefined) {
            const currentChar = context.characters[context.characterId];
            if (currentChar?.avatar) {
                const url = context.getThumbnailUrl('avatar', currentChar.avatar);
                console.log(`[SharedUtils] ✅ 获取头像成功: ${charName || currentChar.name}`);
                return url;
            }
        }
    } catch (e) {
        console.error('[SharedUtils] ❌ 获取角色头像失败:', e);
    }
    return null;
}
