/**
 * 主动电话来电界面交互逻辑
 */

// 从 URL 参数获取数据
const urlParams = new URLSearchParams(window.location.search);
const callId = urlParams.get('call_id');
const charName = urlParams.get('char_name');
const audioPath = urlParams.get('audio_path');
let segments = [];

try {
    segments = JSON.parse(urlParams.get('segments') || '[]');
} catch (e) {
    console.error('[AutoPhoneCall] 解析segments失败:', e);
}

console.log('[AutoPhoneCall] 初始化:', { callId, charName, audioPath, segments });

// DOM 元素
const incomingState = document.getElementById('incomingState');
const activeCallState = document.getElementById('activeCallState');
const callerName = document.getElementById('callerName');
const activeName = document.getElementById('activeName');
const segmentsContainer = document.getElementById('segments');
const audioPlayer = document.getElementById('audioPlayer');
const callDuration = document.getElementById('callDuration');

const answerBtn = document.getElementById('answerBtn');
const rejectBtn = document.getElementById('rejectBtn');
const hangupBtn = document.getElementById('hangupBtn');

// 状态
let callStartTime = null;
let durationInterval = null;

/**
 * 初始化页面
 */
function init() {
    // 设置角色名称
    callerName.textContent = charName || '未知角色';
    activeName.textContent = charName || '未知角色';

    // 绑定事件
    answerBtn.addEventListener('click', onAnswer);
    rejectBtn.addEventListener('click', onReject);
    hangupBtn.addEventListener('click', onHangup);

    // 渲染情绪片段
    renderSegments();

    // 设置音频路径
    if (audioPath) {
        audioPlayer.src = audioPath;
    }
}

/**
 * 接听电话
 */
function onAnswer() {
    console.log('[AutoPhoneCall] 用户接听电话');

    // 通知父窗口停止铃声
    window.parent.postMessage({ type: 'answer_call' }, '*');

    // 切换到通话状态
    incomingState.style.display = 'none';
    activeCallState.style.display = 'flex';

    // 开始计时
    callStartTime = Date.now();
    updateDuration();
    durationInterval = setInterval(updateDuration, 1000);

    // 播放音频
    if (audioPath) {
        audioPlayer.play().catch(e => {
            console.error('[AutoPhoneCall] 音频播放失败:', e);
        });

        // 添加音频播放监听器,实现音轨同步
        audioPlayer.addEventListener('timeupdate', highlightCurrentSegment);
    }
}

/**
 * 拒绝电话
 */
function onReject() {
    console.log('[AutoPhoneCall] 用户拒绝电话');

    // 通知父窗口停止铃声并关闭
    window.parent.postMessage({ type: 'reject_call' }, '*');
}

/**
 * 挂断电话
 */
function onHangup() {
    console.log('[AutoPhoneCall] 用户挂断电话');

    // 停止音频
    audioPlayer.pause();

    // 停止计时
    if (durationInterval) {
        clearInterval(durationInterval);
    }

    // 通知父窗口关闭
    window.parent.postMessage({ type: 'reject_call' }, '*');
}

/**
 * 更新通话时长
 */
function updateDuration() {
    if (!callStartTime) return;

    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    callDuration.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 渲染情绪片段
 */
function renderSegments() {
    if (!segments || segments.length === 0) {
        segmentsContainer.innerHTML = '<p class="no-segments">暂无对话内容</p>';
        return;
    }

    segmentsContainer.innerHTML = segments.map((seg, index) => {
        // 优先显示翻译,无翻译则显示原文
        const displayText = seg.translation || seg.text || '';
        const startTime = seg.start_time || 0;

        return `
        <div class="segment" data-index="${index}" data-start-time="${startTime}">
            <span class="emotion-tag">${seg.emotion || '默认'}</span>
            <p class="segment-text">${escapeHtml(displayText)}</p>
        </div>
    `;
    }).join('');
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 根据音频播放进度高亮当前segment
 */
function highlightCurrentSegment() {
    const currentTime = audioPlayer.currentTime;
    const segmentElements = document.querySelectorAll('.segment');

    // 找到当前时间对应的segment
    let activeIndex = -1;
    for (let i = 0; i < segments.length; i++) {
        const startTime = segments[i].start_time || 0;
        const duration = segments[i].audio_duration || 0;
        const endTime = startTime + duration;

        if (currentTime >= startTime && currentTime < endTime) {
            activeIndex = i;
            break;
        }
    }

    // 更新高亮状态
    segmentElements.forEach((el, index) => {
        if (index === activeIndex) {
            el.classList.add('active');
            // 自动滚动到当前segment
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            el.classList.remove('active');
        }
    });
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
