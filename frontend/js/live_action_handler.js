/**
 * 活人感行动处理器
 * 
 * 职责:
 * - 接收后端触发的live_action_triggered消息
 * - 根据行动类型(phone_call, side_conversation, leave_scene, self_talk)执行相应的前端操作
 */

export class LiveActionHandler {
    constructor() {
        console.log('[LiveActionHandler] 初始化完成');

        // 行动类型处理器映射
        this.actionHandlers = {
            'phone_call': this.handlePhoneCall.bind(this),
            'side_conversation': this.handleSideConversation.bind(this),
            'leave_scene': this.handleLeaveScene.bind(this),
            'self_talk': this.handleSelfTalk.bind(this)
        };
    }

    /**
     * 处理活人感行动触发
     * 
     * @param {Object} message - WebSocket消息
     * @param {string} message.action_type - 行动类型
     * @param {Object} message.data - 行动数据
     */
    async handle(message) {
        const { action_type, data } = message;

        console.log(`[LiveActionHandler] 🎯 收到行动触发: ${action_type}`);

        const handler = this.actionHandlers[action_type];

        if (!handler) {
            console.warn(`[LiveActionHandler] ⚠️ 未知行动类型: ${action_type}`);
            return;
        }

        try {
            await handler(data);
        } catch (error) {
            console.error(`[LiveActionHandler] ❌ 处理失败 (${action_type}):`, error);
        }
    }

    /**
     * 处理电话行动
     */
    async handlePhoneCall(data) {
        const { character_name, target, reason, urgency, emotional_state } = data;

        console.log(`[LiveActionHandler] 📞 触发电话: ${character_name} -> ${target}`);

        // TODO: 调用电话生成逻辑
        // 1. 构建电话场景prompt
        // 2. 生成电话音频
        // 3. 显示来电UI

        // 临时:显示通知
        this.showNotification('phone_call', {
            title: `${character_name}的电话`,
            message: reason,
            urgency: urgency
        });
    }

    /**
     * 处理私下对话
     */
    async handleSideConversation(data) {
        const { speakers, topic, urgency } = data;

        console.log(`[LiveActionHandler] 💬 私下对话: ${speakers.join(' 和 ')}`);

        // TODO: 生成私下对话音频或文本
        // 可能需要:
        // 1. 生成对话内容
        // 2. 显示提示"XX和XX在窃窃私语..."
        // 3. 生成音频(可选)

        this.showNotification('side_conversation', {
            title: '私下交流',
            message: `${speakers.join(' 和 ')} 在私下讨论 ${topic}`,
            urgency: urgency
        });
    }

    /**
     * 处理离场行动
     */
    async handleLeaveScene(data) {
        const { character_name, reason, urgency } = data;

        console.log(`[LiveActionHandler] 🚪 ${character_name} 想要离开`);

        // 显示离场提示
        this.showNotification('leave_scene', {
            title: `${character_name}想要离开`,
            message: reason,
            urgency: urgency
        });
    }

    /**
     * 处理内心独白
     */
    async handleSelfTalk(data) {
        const { character_name, content, hidden_thoughts } = data;

        console.log(`[LiveActionHandler] 💭 ${character_name} 内心独白`);

        // 显示内心独白
        this.showNotification('self_talk', {
            title: `${character_name}的想法`,
            message: content || hidden_thoughts,
            urgency: 0
        });
    }

    /**
     * 显示通知
     */
    showNotification(type, { title, message, urgency }) {
        console.log(`[LiveActionHandler] 📢 通知: ${title} - ${message}`);

        // 使用SillyTavern的toastr通知系统
        if (typeof toastr !== 'undefined') {
            const urgencyLevel = urgency > 7 ? 'warning' : 'info';
            toastr[urgencyLevel](`${message}`, title, {
                timeOut: 5000,
                progressBar: true
            });
        }

        // TODO: 可选择使用更丰富的UI显示
        // 例如:弹出卡片、插入到聊天历史等
    }
}

export default LiveActionHandler;
