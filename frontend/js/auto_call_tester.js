/**
 * 自动电话调度测试工具
 * 
 * 在浏览器控制台中使用:
 * 
 * 1. 简单触发 (使用当前对话上下文):
 *    await TTS_AutoCallTester.trigger(['角色名1', '角色名2'], 100)
 * 
 * 2. 自定义上下文触发:
 *    await TTS_AutoCallTester.triggerWithContext(['角色名'], 100, customContext)
 * 
 * 3. 查看正在运行的任务:
 *    TTS_AutoCallTester.getRunningTasks()
 */

export const TTS_AutoCallTester = {
    /**
     * 获取当前对话上下文
     * @param {number} count - 要提取的消息数量
     * @returns {Array} 对话上下文
     */
    getCurrentContext(count = 30) {
        try {
            const ctx = window.SillyTavern?.getContext();
            if (!ctx || !ctx.chat) {
                console.warn('[AutoCallTester] 无法获取 SillyTavern 上下文');
                return [];
            }

            const chat = ctx.chat;
            const recentMessages = chat.slice(-count);

            return recentMessages.map(msg => ({
                name: msg.name || 'Unknown',
                is_user: msg.is_user || false,
                mes: msg.mes || ''
            }));
        } catch (error) {
            console.error('[AutoCallTester] 获取上下文失败:', error);
            return [];
        }
    },

    /**
     * 获取当前对话分支ID
     * @returns {string} 对话分支ID
     */
    getChatBranch() {
        try {
            const ctx = window.SillyTavern?.getContext();
            if (!ctx) {
                return 'test_branch';
            }

            // 使用聊天ID作为分支标识
            return ctx.chatId || ctx.chat_id || 'test_branch';
        } catch (error) {
            console.warn('[AutoCallTester] 获取对话分支失败,使用默认值:', error);
            return 'test_branch';
        }
    },

    /**
     * 触发自动电话生成 (使用当前对话上下文)
     * @param {Array<string>} speakers - 说话人列表,例如 ['角色名1', '角色名2']
     * @param {number} triggerFloor - 触发楼层,例如 100
     * @param {number} contextCount - 提取的上下文消息数量,默认 30
     * @returns {Promise<Object>} 调度结果
     */
    async trigger(speakers, triggerFloor, contextCount = 30) {
        console.log(`\n[AutoCallTester] 🚀 触发自动电话生成:`);
        console.log(`  - 说话人: ${speakers.join(', ')}`);
        console.log(`  - 触发楼层: ${triggerFloor}`);
        console.log(`  - 上下文数量: ${contextCount}`);

        const context = this.getCurrentContext(contextCount);
        const chatBranch = this.getChatBranch();

        console.log(`  - 对话分支: ${chatBranch}`);
        console.log(`  - 提取到 ${context.length} 条消息`);

        return await this.triggerWithContext(speakers, triggerFloor, context, chatBranch);
    },

    /**
     * 使用自定义上下文触发
     * @param {Array<string>} speakers - 说话人列表
     * @param {number} triggerFloor - 触发楼层
     * @param {Array<Object>} context - 自定义对话上下文
     * @param {string} chatBranch - 对话分支ID
     * @returns {Promise<Object>} 调度结果
     */
    async triggerWithContext(speakers, triggerFloor, context = [], chatBranch = 'test_branch') {
        try {
            const API_BASE = window.TTS_State?.API_BASE || '/api';

            const response = await fetch(`${API_BASE}/phone_call/test/trigger_auto_call`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    speakers: speakers,
                    trigger_floor: triggerFloor,
                    chat_branch: chatBranch,
                    context_count: context.length
                })
            });

            const result = await response.json();

            if (response.ok) {
                console.log(`\n✅ [AutoCallTester] 触发成功!`);
                console.log(`  - Call ID: ${result.call_id}`);
                console.log(`  - 消息: ${result.message}`);
                console.log(`\n💡 提示: 后端会通过 WebSocket 通知前端调用 LLM`);
                console.log(`   请确保 WebSocket 连接正常,并关注控制台日志`);
            } else {
                console.error(`\n❌ [AutoCallTester] 触发失败:`, result);
            }

            return result;
        } catch (error) {
            console.error(`\n❌ [AutoCallTester] 请求失败:`, error);
            throw error;
        }
    },

    /**
     * 快速测试 - 使用模拟数据
     * @param {string} speakerName - 说话人名称,默认使用当前角色
     * @returns {Promise<Object>} 调度结果
     */
    async quickTest(speakerName = null) {
        // 如果没有指定说话人,尝试从当前上下文获取
        if (!speakerName) {
            try {
                const ctx = window.SillyTavern?.getContext();
                const characters = ctx?.characters;
                const thisChid = ctx?.this_chid;

                if (characters && thisChid !== undefined && characters[thisChid]) {
                    speakerName = characters[thisChid].name;
                    console.log(`[AutoCallTester] 使用当前角色: ${speakerName}`);
                } else {
                    console.error('[AutoCallTester] 无法获取当前角色,请手动指定说话人');
                    return;
                }
            } catch (error) {
                console.error('[AutoCallTester] 获取角色失败:', error);
                return;
            }
        }

        const testFloor = Math.floor(Math.random() * 10000);
        console.log(`\n[AutoCallTester] 🧪 快速测试模式`);
        console.log(`  - 随机楼层: ${testFloor}`);

        return await this.trigger([speakerName], testFloor, 10);
    },

    /**
     * 显示使用帮助
     */
    help() {
        console.log(`
╔════════════════════════════════════════════════════════════════╗
║           自动电话调度测试工具 - 使用指南                      ║
╚════════════════════════════════════════════════════════════════╝

📌 基本用法:

1️⃣  快速测试 (使用当前角色和对话):
   await TTS_AutoCallTester.quickTest()

2️⃣  指定说话人和楼层:
   await TTS_AutoCallTester.trigger(['角色名'], 100)

3️⃣  多个说话人:
   await TTS_AutoCallTester.trigger(['角色1', '角色2'], 200)

4️⃣  自定义上下文数量:
   await TTS_AutoCallTester.trigger(['角色名'], 100, 50)

5️⃣  使用自定义上下文:
   const context = [
       {name: 'User', is_user: true, mes: '你好'},
       {name: '角色', is_user: false, mes: '你好!'}
   ]
   await TTS_AutoCallTester.triggerWithContext(['角色'], 100, context)

📋 辅助功能:

- 获取当前上下文: TTS_AutoCallTester.getCurrentContext(30)
- 获取对话分支:   TTS_AutoCallTester.getChatBranch()
- 显示帮助:       TTS_AutoCallTester.help()

⚠️  注意事项:

1. 确保 WebSocket 连接正常
2. 确保说话人名称与角色映射一致
3. 每个楼层只能触发一次,重复触发会返回 "duplicate"
4. 生成过程是异步的,需要等待 LLM 响应

💡 调试技巧:

- 打开浏览器控制台查看详细日志
- 检查后端终端输出
- 使用 Network 标签查看 WebSocket 消息
        `);
    }
};

// 初始化时显示提示
console.log(`
✅ [AutoCallTester] 测试工具已加载
💡 输入 TTS_AutoCallTester.help() 查看使用指南
🚀 快速开始: await TTS_AutoCallTester.quickTest()
`);
