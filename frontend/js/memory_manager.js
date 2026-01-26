/**
 * 记忆管理器 - 顶层扩展接口
 * 
 * 提供统一的记忆数据访问接口，支持扩展
 */

import { ContextCollector } from './context_collector.js';

export const MemoryManager = {
    // 上下文收集器
    context: ContextCollector,

    // ==================== 预留扩展 ====================
    // history: HistoryManager,       // 历史记录管理
    // worldInfo: WorldInfoManager,   // 世界信息管理
    // character: CharacterManager,   // 角色信息管理

    /**
     * 初始化记忆管理器
     */
    init() {
        console.log('[MemoryManager] 🧠 记忆管理器已初始化');
        // 初始化子模块
        if (this.context && this.context.init) {
            this.context.init();
        }
    },

    /**
     * 快捷方法：收集上下文
     */
    collectContext(options = {}) {
        return this.context.collect(options);
    }
};

// 暴露到全局
if (typeof window !== 'undefined') {
    window.MemoryManager = MemoryManager;
}

export default MemoryManager;
