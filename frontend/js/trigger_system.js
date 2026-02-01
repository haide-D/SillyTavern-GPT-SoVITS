/**
 * 触发器系统
 * 
 * 职责:
 * - 注册和管理触发器
 * - 评估触发条件
 * - 执行触发动作
 * - 支持优先级和单次触发
 */

import { CharacterStateManager } from './character_state_manager.js';
import { PhoneCallAPIClient } from './phone_call_api_client.js';

export class TriggerSystem {
    constructor(stateManager) {
        this.stateManager = stateManager;

        // 触发器存储: Map<triggerName, triggerConfig>
        this.triggers = new Map();

        // 已触发记录 (用于 once 模式)
        this.triggeredOnce = new Set();

        console.log('[TriggerSystem] ⚡ 初始化触发器系统');
    }

    /**
     * 注册触发器
     * 
     * @param {Object} trigger - 触发器配置
     * @param {string} trigger.name - 触发器名称
     * @param {Function} trigger.condition - 触发条件 (state) => boolean
     * @param {Function} trigger.action - 触发动作 async (state) => {}
     * @param {number} trigger.priority - 优先级 (数字越大优先级越高)
     * @param {boolean} trigger.once - 是否只触发一次
     * @param {boolean} trigger.enabled - 是否启用
     */
    register(trigger) {
        const {
            name,
            condition,
            action,
            priority = 0,
            once = false,
            enabled = true
        } = trigger;

        // 验证必填字段
        if (!name || typeof condition !== 'function' || typeof action !== 'function') {
            console.error('[TriggerSystem] ❌ 触发器配置无效:', trigger);
            return;
        }

        // 存储触发器
        this.triggers.set(name, {
            name,
            condition,
            action,
            priority,
            once,
            enabled
        });

        console.log(`[TriggerSystem] ✅ 注册触发器: ${name} (优先级: ${priority}, 单次: ${once})`);
    }

    /**
     * 移除触发器
     * 
     * @param {string} name - 触发器名称
     */
    unregister(name) {
        if (this.triggers.has(name)) {
            this.triggers.delete(name);
            this.triggeredOnce.delete(name);
            console.log(`[TriggerSystem] 🗑️ 移除触发器: ${name}`);
        }
    }

    /**
     * 启用触发器
     * 
     * @param {string} name - 触发器名称
     */
    enable(name) {
        const trigger = this.triggers.get(name);
        if (trigger) {
            trigger.enabled = true;
            console.log(`[TriggerSystem] ✅ 启用触发器: ${name}`);
        }
    }

    /**
     * 禁用触发器
     * 
     * @param {string} name - 触发器名称
     */
    disable(name) {
        const trigger = this.triggers.get(name);
        if (trigger) {
            trigger.enabled = false;
            console.log(`[TriggerSystem] ⏸️ 禁用触发器: ${name}`);
        }
    }

    /**
     * 评估所有触发器
     * 
     * @param {Object} state - 当前状态 (可选,不传则从 stateManager 获取)
     */
    async evaluate(state = null) {
        const currentState = state || this.stateManager.getAllStates();

        console.log('[TriggerSystem] 🔍 开始评估触发器...');

        // 获取所有启用的触发器并按优先级排序
        const enabledTriggers = Array.from(this.triggers.values())
            .filter(t => t.enabled)
            .sort((a, b) => b.priority - a.priority);  // 优先级高的在前

        let triggeredCount = 0;

        for (const trigger of enabledTriggers) {
            // 如果是 once 模式且已触发过,跳过
            if (trigger.once && this.triggeredOnce.has(trigger.name)) {
                continue;
            }

            try {
                // 评估条件
                const shouldTrigger = trigger.condition(currentState);

                if (shouldTrigger) {
                    console.log(`[TriggerSystem] ⚡ 触发器满足条件: ${trigger.name}`);

                    // 执行动作
                    await trigger.action(currentState);

                    // 标记为已触发
                    if (trigger.once) {
                        this.triggeredOnce.add(trigger.name);
                    }

                    triggeredCount++;
                }

            } catch (error) {
                console.error(`[TriggerSystem] ❌ 触发器执行失败 (${trigger.name}):`, error);
            }
        }

        console.log(`[TriggerSystem] ✅ 评估完成, ${triggeredCount} 个触发器被触发`);
    }

    /**
     * 重置单次触发记录
     * 
     * @param {string} name - 触发器名称 (不传则重置所有)
     */
    resetOnce(name = null) {
        if (name) {
            this.triggeredOnce.delete(name);
            console.log(`[TriggerSystem] 🔄 重置单次触发: ${name}`);
        } else {
            this.triggeredOnce.clear();
            console.log('[TriggerSystem] 🔄 重置所有单次触发');
        }
    }

    /**
     * 获取所有触发器列表
     * 
     * @returns {Array<Object>} - 触发器列表
     */
    getAllTriggers() {
        return Array.from(this.triggers.values());
    }

    /**
     * 获取触发器状态
     * 
     * @param {string} name - 触发器名称
     * @returns {Object|null} - 触发器状态
     */
    getTriggerStatus(name) {
        const trigger = this.triggers.get(name);
        if (!trigger) {
            return null;
        }

        return {
            name: trigger.name,
            enabled: trigger.enabled,
            priority: trigger.priority,
            once: trigger.once,
            hasTriggered: this.triggeredOnce.has(name)
        };
    }
}

// 导出辅助函数,用于创建常用触发器
export class TriggerHelpers {
    /**
     * 创建离场延迟触发器
     * 
     * @param {string} charName - 角色名
     * @param {number} delayMs - 延迟时间 (毫秒)
     * @param {string} location - 目标位置 (可选)
     * @param {Function} action - 触发动作
     */
    static createAbsenceDelayTrigger(charName, delayMs, location = null, action) {
        return {
            name: `${charName}_absence_${delayMs}ms`,
            condition: (state) => {
                const char = state[charName];
                if (!char) return false;

                const absent = !char.present;
                const locationMatch = !location || char.location === location;
                const delayPassed = (Date.now() - char.lastSeen) > delayMs;

                return absent && locationMatch && delayPassed;
            },
            action: action,
            priority: 10
        };
    }

    /**
     * 创建多角色离场触发器
     * 
     * @param {Array<string>} charNames - 角色名列表
     * @param {Function} action - 触发动作
     */
    static createMultiAbsenceTrigger(charNames, action) {
        return {
            name: `multi_absence_${charNames.join('_')}`,
            condition: (state) => {
                const absentChars = charNames.filter(name => {
                    const char = state[name];
                    return char && !char.present && char.canCall;
                });

                return absentChars.length === charNames.length;
            },
            action: action,
            priority: 5
        };
    }
}

export default TriggerSystem;
