/**
 * 实时对话 App
 * 
 * Mobile UI 中的独立 App，提供实时语音对话功能。
 * 
 * 功能：
 * 1. 文字输入对话
 * 2. 语音输入对话
 * 3. 流式 TTS 播放
 * 4. 打断功能
 */

import { RealtimeController, RealtimeUI } from '../realtime/index.js';

// App 状态
let controller = null;
let ui = null;

/**
 * 渲染 App
 * @param {jQuery} container - App 容器
 * @param {Function} createNavbar - 创建导航栏函数
 */
export async function render(container, createNavbar) {
    console.log('[RealtimeApp] 🚀 开始渲染...');

    // 渲染加载状态
    container.html(`
        <div class="realtime-loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">正在初始化...</div>
        </div>
    `);

    try {
        // 创建控制器
        controller = new RealtimeController();

        // 初始化控制器
        const success = await controller.init();
        if (!success) {
            throw new Error('控制器初始化失败');
        }

        // 构建 UI
        const $navbar = createNavbar('实时对话');
        const $content = $('<div class="realtime-app-content"></div>');

        container.empty();
        container.append($navbar);
        container.append($content);

        // 创建 UI 实例
        ui = new RealtimeUI($content);
        ui.render(controller.character);

        // 绑定 UI 回调
        bindUICallbacks();

        // 绑定控制器回调
        bindControllerCallbacks();

        // 检查 STT 可用性
        if (!controller.isSttAvailable()) {
            ui.disableVoice();
            console.log('[RealtimeApp] ⚠️ 语音输入不可用');
        }

        console.log('[RealtimeApp] ✅ 渲染完成');

    } catch (error) {
        console.error('[RealtimeApp] ❌ 初始化失败:', error);
        container.html(`
            <div class="realtime-error">
                <div class="error-icon">❌</div>
                <div class="error-text">初始化失败</div>
                <div class="error-detail">${error.message}</div>
            </div>
        `);
    }
}

/**
 * 绑定 UI 回调
 */
function bindUICallbacks() {
    // 发送消息
    ui.onSend(async (text) => {
        ui.addUserMessage(text);
        ui.startAssistantMessage();
        ui.setSpeakingMode(true);
        ui.setStatus('AI 思考中...');

        await controller.send(text);
    });

    // 语音切换
    ui.onVoiceToggle(async () => {
        await controller.toggleListening();
    });

    // 打断
    ui.onInterrupt(() => {
        controller.interrupt();
    });
}

/**
 * 绑定控制器回调
 */
function bindControllerCallbacks() {
    // 状态变化
    controller.onStateChange((state) => {
        // 更新语音按钮
        ui.setVoiceActive(state.isListening);

        // 更新说话模式
        ui.setSpeakingMode(state.isSpeaking);

        // 更新波形动画
        ui.setWaveActive(state.isSpeaking);

        // 更新状态文本
        if (state.isListening) {
            ui.setStatus('正在聆听...');
        } else if (state.isSpeaking) {
            ui.setStatus('AI 正在说话...');
        } else {
            ui.setStatus('准备就绪');
        }
    });

    // Token 流
    controller.onToken((token) => {
        ui.appendToken(token);
    });

    // 音频开始
    controller.onAudioStart(() => {
        ui.setStatus('正在播放...');
        ui.setWaveActive(true);
    });

    // 音频结束
    controller.onAudioEnd(() => {
        ui.finishAssistantMessage();
        ui.setWaveActive(false);
        ui.setStatus('准备就绪');
    });

    // 错误
    controller.onError((error) => {
        ui.setStatus(`错误: ${error.message}`);
        ui.setSpeakingMode(false);
        ui.finishAssistantMessage();

        // 显示错误提示
        if (window.toastr) {
            window.toastr.error(error.message);
        }
    });

    // STT 结果
    controller.onSttResult((text, isFinal) => {
        ui.setInterimText(text);

        if (isFinal && text.trim()) {
            // 自动发送最终结果
            ui.addUserMessage(text);
            ui.startAssistantMessage();
            ui.setSpeakingMode(true);
            ui.setStatus('AI 思考中...');
            controller.send(text);
        }
    });
}

/**
 * 清理资源（App 关闭时调用）
 */
export function cleanup() {
    if (controller) {
        controller.interrupt();
        controller = null;
    }
    ui = null;
}

export default { render, cleanup };
