/**
 * 角色状态管理器
 * 
 * 职责:
 * - 存储和管理角色状态
 * - 状态更新和查询
 * - 状态持久化 (localStorage)
 * - 状态变化事件通知
 */

export class CharacterStateManager {
    constructor() {
        // 状态存储: { 角色名: { present, location, lastSeen, canCall, customState } }
        this.states = {};

        // 事件监听器
        this.listeners = new Map();

        console.log('[CharacterStateManager] 💾 初始化状态管理器');

        // 从 localStorage 加载状态
        this.loadFromStorage();
    }

    /**
     * 获取角色状态
     * 
     * @param {string} charName - 角色名
     * @returns {Object|null} - 角色状态
     */
    getState(charName) {
        return this.states[charName] || null;
    }

    /**
     * 获取所有状态
     * 
     * @returns {Object} - 所有角色状态
     */
    getAllStates() {
        return { ...this.states };
    }

    /**
     * 更新角色状态
     * 
     * @param {string} charName - 角色名
     * @param {Object} updates - 状态更新
     * @param {boolean} updates.present - 是否在场
     * @param {string} updates.location - 当前位置
     * @param {number} updates.lastSeen - 最后出现时间
     * @param {boolean} updates.canCall - 是否可以打电话
     * @param {Object} updates.customState - 自定义状态
     */
    updateState(charName, updates) {
        // 初始化角色状态
        if (!this.states[charName]) {
            this.states[charName] = {
                present: true,
                location: '未知',
                lastSeen: Date.now(),
                canCall: false,
                customState: {}
            };
        }

        // 记录旧状态
        const oldState = { ...this.states[charName] };

        // 更新状态
        Object.assign(this.states[charName], updates);

        console.log(`[CharacterStateManager] 🔄 更新状态: ${charName}`, {
            from: oldState,
            to: this.states[charName]
        });

        // 保存到 localStorage
        this.saveToStorage();

        // 触发状态变化事件
        this.emit('state_changed', this.states, charName, oldState, this.states[charName]);
    }

    /**
     * 批量更新多个角色状态
     * 
     * @param {Object} statesUpdates - { 角色名: 状态更新 }
     */
    batchUpdate(statesUpdates) {
        Object.entries(statesUpdates).forEach(([charName, updates]) => {
            this.updateState(charName, updates);
        });
    }

    /**
     * 查询符合条件的角色
     * 
     * @param {Function} filter - 过滤函数 (state) => boolean
     * @returns {Array<Object>} - 符合条件的角色列表 [{ name, state }, ...]
     */
    query(filter) {
        return Object.entries(this.states)
            .filter(([name, state]) => filter(state))
            .map(([name, state]) => ({ name, state }));
    }

    /**
     * 清除角色状态
     * 
     * @param {string} charName - 角色名
     */
    clearState(charName) {
        if (this.states[charName]) {
            delete this.states[charName];
            this.saveToStorage();
            console.log(`[CharacterStateManager] 🗑️ 已清除状态: ${charName}`);
        }
    }

    /**
     * 清除所有状态
     */
    clearAllStates() {
        this.states = {};
        this.saveToStorage();
        console.log('[CharacterStateManager] 🗑️ 已清除所有状态');
    }

    /**
     * 注册事件监听器
     * 
     * @param {string} event - 事件名 (state_changed)
     * @param {Function} callback - 回调函数
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    /**
     * 移除事件监听器
     * 
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     */
    off(event, callback) {
        if (!this.listeners.has(event)) {
            return;
        }
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }

    /**
     * 触发事件
     * 
     * @param {string} event - 事件名
     * @param {...any} args - 事件参数
     */
    emit(event, ...args) {
        if (!this.listeners.has(event)) {
            return;
        }
        this.listeners.get(event).forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                console.error(`[CharacterStateManager] ❌ 事件回调错误 (${event}):`, error);
            }
        });
    }

    /**
     * 从 localStorage 加载状态
     */
    loadFromStorage() {
        try {
            const saved = localStorage.getItem('character_states');
            if (saved) {
                this.states = JSON.parse(saved);
                console.log('[CharacterStateManager] ✅ 从 localStorage 加载状态:', Object.keys(this.states).length, '个角色');
            }
        } catch (error) {
            console.warn('[CharacterStateManager] ⚠️ 加载状态失败:', error);
        }
    }

    /**
     * 保存状态到 localStorage
     */
    saveToStorage() {
        try {
            localStorage.setItem('character_states', JSON.stringify(this.states));
        } catch (error) {
            console.warn('[CharacterStateManager] ⚠️ 保存状态失败:', error);
        }
    }
}

export default CharacterStateManager;
