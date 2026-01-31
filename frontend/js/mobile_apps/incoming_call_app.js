/**
 * 来电 App 模块
 * 处理来电界面、通话中界面、来电历史记录
 */

import { ChatInjector } from '../chat_injector.js';

// ==================== 全局音频状态管理 ====================
let currentPlayingAudio = null; // 当前正在播放的音频对象
let currentDurationInterval = null; // 当前播放时长的定时器

/**
 * 渲染来电 App
 * @param {jQuery} container - App 容器
 * @param {Function} createNavbar - 创建导航栏函数
 */
export async function render(container, createNavbar) {
    const callData = window.TTS_IncomingCall;

    // ========== 状态1: 有来电 - 显示接听/拒绝界面 ==========
    if (callData) {
        container.empty();

        // 生成头像 HTML
        const avatarHtml = callData.avatar_url
            ? `<img src="${callData.avatar_url}" alt="${callData.char_name}">`
            : '📞';

        const $content = $(`
            <div class="incoming-call-container">
                <div class="call-icon">${avatarHtml}</div>
                <div class="caller-name">${callData.char_name}</div>
                <div class="call-status">来电中...</div>

                <div class="call-buttons">
                    <button id="mobile-reject-call-btn" class="call-btn reject-btn">✕</button>
                    <button id="mobile-answer-call-btn" class="call-btn answer-btn">✓</button>
                </div>
            </div>
        `);

        container.append($content);

        // 拒绝来电
        $content.find('#mobile-reject-call-btn').click(function () {
            console.log('[Mobile] 用户拒绝来电');
            delete window.TTS_IncomingCall;
            $('#tts-manager-btn').removeClass('incoming-call').attr('title', '🔊 TTS配置');
            $('#tts-mobile-trigger').removeClass('incoming-call');
            // 返回主屏幕
            $('#mobile-home-btn').click();
        });

        // 接听来电
        $content.find('#mobile-answer-call-btn').click(async function () {
            console.log('[Mobile] 用户接听来电');

            // 🆕 注入通话内容到聊天
            try {
                await ChatInjector.injectAsMessage({
                    type: 'phone_call',
                    segments: callData.segments || [],
                    callerName: callData.char_name,
                    callId: callData.call_id,
                    audioUrl: callData.audio_url
                });
                console.log('[Mobile] ✅ 通话内容已注入聊天');
            } catch (error) {
                console.error('[Mobile] ❌ 注入聊天失败:', error);
            }

            // 显示通话中界面
            showInCallUI(container, callData);
        });

        return;
    }

    // ========== 状态2: 无来电 - 显示历史记录列表 ==========
    container.empty();
    container.append(createNavbar("来电记录"));

    const $content = $(`
        <div class="call-history-content">
            <div class="call-history-empty">
                <div class="call-history-empty-icon">📞</div>
                <div>正在加载来电记录...</div>
            </div>
        </div>
    `);
    container.append($content);

    // 获取当前对话的所有指纹
    let fingerprints = [];
    try {
        if (window.TTS_Utils && window.TTS_Utils.getCurrentContextFingerprints) {
            fingerprints = window.TTS_Utils.getCurrentContextFingerprints();
            console.log('[Mobile] 获取到指纹数量:', fingerprints.length);
        }
    } catch (e) {
        console.error('[Mobile] 获取指纹失败:', e);
    }

    if (!fingerprints || fingerprints.length === 0) {
        $content.html(`
            <div class="call-history-empty">
                <div class="call-history-empty-icon">⚠️</div>
                <div>未检测到对话</div>
            </div>
        `);
        return;
    }

    // 获取历史记录 (按指纹列表查询，支持跨分支匹配)
    try {
        console.log('[Mobile] 获取来电历史 (by fingerprints):', fingerprints.length, '条指纹');
        const result = await window.TTS_API.getAutoCallHistoryByFingerprints(fingerprints, 500);

        if (result.status !== 'success' || !result.history || result.history.length === 0) {
            $content.html(`
                <div class="call-history-empty">
                    <div class="call-history-empty-icon">📞</div>
                    <div>暂无来电记录</div>
                </div>
            `);
            return;
        }

        // 渲染历史记录列表
        const historyHtml = result.history.map(call => {
            const date = call.created_at ? new Date(call.created_at).toLocaleString('zh-CN') : '未知时间';
            const statusText = call.status === 'completed' ? '已完成' : call.status === 'failed' ? '失败' : '处理中';
            const statusClass = call.status === 'completed' ? 'completed' : call.status === 'failed' ? 'failed' : 'processing';



            // 🖼️ 获取角色卡头像 (说话人共享同一张角色卡)
            let avatarUrl = call.avatar_url; // 优先使用数据库中的头像(如果有)
            if (!avatarUrl) {
                try {
                    const context = window.SillyTavern?.getContext?.();
                    console.log('[Mobile] 🔍 调试信息:', {
                        has_getThumbnailUrl: !!context?.getThumbnailUrl,
                        has_characters: !!context?.characters,
                        characters_count: context?.characters?.length || 0,
                        characterId: context?.characterId,
                        characterId_type: typeof context?.characterId
                    });

                    if (context?.getThumbnailUrl && context?.characters && context?.characterId !== undefined) {
                        // characterId 是数组索引,直接访问
                        const currentChar = context.characters[context.characterId];

                        if (currentChar?.avatar) {
                            // 使用 SillyTavern 官方 API,传入 avatar 文件名
                            avatarUrl = context.getThumbnailUrl('avatar', currentChar.avatar);
                            console.log('[Mobile] ✅ 获取头像成功:', currentChar.name, avatarUrl);
                        } else {
                            console.warn('[Mobile] ❌ 角色没有头像:', context.characterId);
                        }
                    } else {
                        console.warn('[Mobile] ❌ 必要的上下文数据不可用');
                    }
                } catch (e) {
                    console.error('[Mobile] ❌ 获取角色卡头像失败:', e);
                }
            }




            // 头像 HTML
            const avatarHtml = avatarUrl
                ? `<img src="${avatarUrl}" alt="${call.char_name}">`
                : `<div class="call-history-avatar-placeholder">👤</div>`;

            return `
                <div class="call-history-item" data-call-id="${call.id}" data-audio-url="${call.audio_url || ''}" data-char-name="${call.char_name || ''}" data-created-at="${call.created_at || ''}">
                    <div class="call-history-layout">
                        <!-- 头像 -->
                        <div class="call-history-avatar">
                            ${avatarHtml}
                        </div>

                        <!-- 内容区域 -->
                        <div class="call-history-content-area">
                            <div class="call-history-header">
                                <strong class="call-history-name">${call.char_name || '未知角色'}</strong>
                                <span class="call-history-status ${statusClass}">● ${statusText}</span>
                            </div>

                            <div class="call-history-date">
                                📅 ${date}
                            </div>

                            ${call.status === 'completed' && call.audio_url ? `
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <div class="play-area" style="flex:1;">
                                        <div class="call-history-play-area">
                                            <span class="call-history-play-icon">🎵</span>
                                            <span class="call-history-play-text">点击播放</span>
                                            <span class="call-history-play-arrow">→</span>
                                        </div>
                                    </div>
                                    <button class="call-history-download-btn" style="background:transparent; border:none; color:#3b82f6; font-size:20px; padding:5px; cursor:pointer;">📥</button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        $content.html(historyHtml);

        // 绑定点击事件 - 全屏播放
        $content.find('.call-history-item').click(function (e) {
            // 如果点击的是下载按钮,不触发播放
            if ($(e.target).closest('.call-history-download-btn').length > 0) {
                return;
            }

            const callId = $(this).data('call-id');
            const call = result.history.find(c => c.id === callId);

            if (!call || call.status !== 'completed' || !call.audio_url) {
                alert('该来电记录无法播放');
                return;
            }

            console.log('[Mobile] 播放历史来电(全屏):', call);

            // 进入全屏播放界面
            showHistoryPlaybackUI(container, call, createNavbar);
        });

        // 📥 绑定下载按钮点击事件
        $content.find('.call-history-download-btn').click(async function (e) {
            e.stopPropagation(); // 阻止事件冒泡,避免触发播放

            const $item = $(this).closest('.call-history-item');
            const callId = $item.data('call-id');
            const call = result.history.find(c => c.id === callId);

            if (!call || !call.audio_url) {
                alert('该记录没有音频文件');
                return;
            }

            console.log('[Mobile] 用户点击下载历史通话');

            let fullUrl = call.audio_url;
            if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
                fullUrl = window.TTS_API.baseUrl + fullUrl;
            }

            const speaker = call.char_name || 'Unknown';
            const text = call.segments && call.segments.length > 0
                ? call.segments.map(seg => seg.translation || seg.text || '').join(' ')
                : '历史通话';

            console.log('📥 下载历史通话音频');
            console.log('  - audioUrl:', fullUrl);
            console.log('  - speaker:', speaker);
            console.log('  - text:', text);

            // 使用 TTS_Events.downloadAudio 下载
            if (window.TTS_Events && window.TTS_Events.downloadAudio) {
                try {
                    await window.TTS_Events.downloadAudio(fullUrl, speaker, text);
                    console.log('✅ 下载请求已发送');
                } catch (err) {
                    console.error('❌ 下载失败:', err);
                    alert('下载失败: ' + err.message);
                }
            } else {
                alert('下载功能未就绪,请刷新页面');
            }
        });

    } catch (error) {
        console.error('[Mobile] 获取历史记录失败:', error);
        $content.html(`
            <div class="call-history-empty" style="color:#ef4444;">
                <div class="call-history-empty-icon">❌</div>
                <div>加载失败: ${error.message}</div>
            </div>
        `);
    }
}

/**
 * 显示通话中界面 (新版 - Apple Music 风格字幕)
 * @param {jQuery} container - App 容器
 * @param {Object} callData - 来电数据
 */
function showInCallUI(container, callData) {
    container.empty();

    // 创建通话中界面 (新版布局)
    const $inCallContent = $(`
        <div class="in-call-container">
            <div class="call-header">
                <div class="call-avatar">${callData.avatar_url ? `<img src="${callData.avatar_url}" alt="${callData.char_name}">` : '👤'}</div>
                <div class="call-name">${callData.char_name}</div>
                <div class="call-duration">00:00</div>
            </div>

            <!-- 音频可视化 -->
            <div class="audio-visualizer">
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
            </div>

            <!-- 新版字幕区域 - 底部固定 -->
            <div class="call-subtitle-area">
                <div class="subtitle-line">
                    <span class="subtitle-text"></span>
                </div>
            </div>

            <div class="audio-progress">
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: 0%;"></div>
                </div>
                <div class="progress-time">
                    <span class="current-time">0:00</span>
                    <span class="total-time">0:00</span>
                </div>
            </div>

            <button id="mobile-hangup-btn" class="hangup-btn">✕</button>
        </div>
    `);

    container.append($inCallContent);

    // 字幕相关变量
    const $subtitleLine = $inCallContent.find('.subtitle-line');
    const $subtitleText = $inCallContent.find('.subtitle-text');
    let currentSegmentIndex = -1;

    /**
     * 更新字幕显示 - 逐字高亮
     * @param {number} segmentIndex - 当前句子索引
     * @param {number} charProgress - 字符进度 (0-1)
     */
    function updateSubtitle(segmentIndex, charProgress) {
        const segments = callData.segments || [];
        if (segmentIndex < 0 || segmentIndex >= segments.length) {
            $subtitleLine.removeClass('visible');
            return;
        }

        const seg = segments[segmentIndex];
        const text = seg.translation || seg.text || '';

        // 切换到新句子
        if (segmentIndex !== currentSegmentIndex) {
            currentSegmentIndex = segmentIndex;

            // 将句子拆分为单个字符
            const chars = text.split('').map((char, i) =>
                `<span class="subtitle-char" data-index="${i}">${char}</span>`
            ).join('');

            $subtitleText.html(chars);

            // 触发显示动画
            $subtitleLine.removeClass('visible');
            setTimeout(() => $subtitleLine.addClass('visible'), 50);
        }

        // 更新逐字高亮
        const totalChars = text.length;
        const activeCharIndex = Math.floor(charProgress * totalChars);

        $subtitleText.find('.subtitle-char').each(function (index) {
            const $char = $(this);
            $char.removeClass('passed active');

            if (index < activeCharIndex) {
                $char.addClass('passed');
            } else if (index === activeCharIndex) {
                $char.addClass('active');
            }
        });
    }

    // 播放音频
    if (callData.audio_url) {
        let fullUrl = callData.audio_url;
        if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
            fullUrl = window.TTS_API.baseUrl + fullUrl;
        }

        console.log('[Mobile] 完整音频URL:', fullUrl);
        const audio = new Audio(fullUrl);
        let startTime = Date.now();
        let durationInterval = null;

        // 更新通话时长
        durationInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            $inCallContent.find('.call-duration').text(
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            );
        }, 1000);

        // 音频加载完成
        audio.addEventListener('loadedmetadata', function () {
            const duration = audio.duration;
            const mins = Math.floor(duration / 60);
            const secs = Math.floor(duration % 60);
            $inCallContent.find('.total-time').text(`${mins}:${secs.toString().padStart(2, '0')}`);
        });

        // 更新进度 + 字幕同步
        audio.addEventListener('timeupdate', function () {
            const currentTime = audio.currentTime;
            const duration = audio.duration;

            // 更新进度条
            const progress = (currentTime / duration) * 100;
            $inCallContent.find('.progress-bar-fill').css('width', progress + '%');

            const currentMins = Math.floor(currentTime / 60);
            const currentSecs = Math.floor(currentTime % 60);
            $inCallContent.find('.current-time').text(
                `${currentMins}:${currentSecs.toString().padStart(2, '0')}`
            );

            // 🎯 字幕同步 - 找到当前 segment 并计算字符进度
            const segments = callData.segments || [];
            let activeIndex = -1;
            let charProgress = 0;

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const segStart = seg.start_time || 0;
                const segDuration = seg.audio_duration || 0;
                const segEnd = segStart + segDuration;

                if (currentTime >= segStart && currentTime < segEnd) {
                    activeIndex = i;
                    // 计算当前句子内的进度 (0-1)，添加0.5秒补偿让字幕提前
                    const compensatedTime = currentTime + 0.5;
                    const adjustedProgress = (compensatedTime - segStart) / segDuration;
                    charProgress = segDuration > 0 ? Math.min(1, Math.max(0, adjustedProgress)) : 0;
                    break;
                }
            }

            // 更新字幕
            updateSubtitle(activeIndex, charProgress);
        });

        // 播放音频
        audio.play().catch(err => {
            console.error('[Mobile] 音频播放失败:', err);
            alert('音频播放失败: ' + err.message);
            clearInterval(durationInterval);
            endCall();
        });

        // 音频播放结束
        audio.onended = function () {
            console.log('[Mobile] 音频播放完成');
            clearInterval(durationInterval);
            endCall();
        };

        // 挂断按钮
        $inCallContent.find('#mobile-hangup-btn').click(function () {
            console.log('[Mobile] 用户挂断电话');
            audio.pause();
            clearInterval(durationInterval);
            endCall();
        });

        function endCall() {
            delete window.TTS_IncomingCall;
            $('#tts-manager-btn').removeClass('incoming-call').attr('title', '🔊 TTS配置');
            $('#tts-mobile-trigger').removeClass('incoming-call');
            // 返回主屏幕
            $('#mobile-home-btn').click();
        }
    } else {
        console.warn('[Mobile] 没有音频 URL');
        delete window.TTS_IncomingCall;
        $('#tts-manager-btn').removeClass('incoming-call').attr('title', '🔊 TTS配置');
        $('#tts-mobile-trigger').removeClass('incoming-call');
        // 返回主屏幕
        $('#mobile-home-btn').click();
    }
}

/**
 * 显示历史记录播放界面 (全屏,带字幕)
 * @param {jQuery} container - App 容器
 * @param {Object} call - 历史来电数据
 * @param {Function} createNavbar - 创建导航栏函数
 */
function showHistoryPlaybackUI(container, call, createNavbar) {
    container.empty();

    // 添加导航栏(带返回按钮)
    const $navbar = createNavbar("播放历史通话");
    container.append($navbar);

    // 🎯 监听返回按钮点击 - 停止音频播放
    $navbar.find('.nav-left').off('click').on('click', function () {
        console.log('[Mobile] 用户点击返回,停止音频播放');
        stopCurrentAudio();
        $('#mobile-home-btn').click();
    });

    // 🖼️ 获取角色卡头像 (说话人共享同一张角色卡)
    let avatarUrl = call.avatar_url; // 优先使用数据库中的头像(如果有)
    if (!avatarUrl) {
        try {
            const context = window.SillyTavern?.getContext?.();
            if (context?.getThumbnailUrl && context?.characters && context?.characterId !== undefined) {
                // characterId 是数组索引,直接访问
                const currentChar = context.characters[context.characterId];
                if (currentChar?.avatar) {
                    // 使用 SillyTavern 官方 API,传入 avatar 文件名
                    avatarUrl = context.getThumbnailUrl('avatar', currentChar.avatar);
                    console.log('[Mobile播放] ✅ 获取头像成功:', currentChar.name, avatarUrl);
                } else {
                    console.warn('[Mobile播放] ❌ 角色没有头像:', context.characterId);
                }
            } else {
                console.warn('[Mobile播放] ❌ 必要的上下文数据不可用');
            }
        } catch (e) {
            console.error('[Mobile播放] ❌ 获取角色卡头像失败:', e);
        }
    }



    // 生成头像 HTML
    const avatarHtml = avatarUrl
        ? `<img src="${avatarUrl}" alt="${call.char_name}">`
        : '👤';

    // 创建播放界面 (复用通话中样式)
    const $playbackContent = $(`
        <div class="in-call-container">
            <div class="call-header">
                <div class="call-avatar">${avatarHtml}</div>
                <div class="call-name">${call.char_name || '未知角色'}</div>
                <div class="call-duration">00:00</div>
            </div>

            <!-- 音频可视化 -->
            <div class="audio-visualizer">
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
            </div>

            <!-- 字幕区域 - 逐字高亮 -->
            <div class="call-subtitle-area">
                <div class="subtitle-line">
                    <span class="subtitle-text"></span>
                </div>
            </div>

            <div class="audio-progress">
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: 0%;"></div>
                </div>
                <div class="progress-time">
                    <span class="current-time">0:00</span>
                    <span class="total-time">0:00</span>
                </div>
            </div>

            <button id="history-stop-btn" class="hangup-btn">⏹</button>
        </div>
    `);

    container.append($playbackContent);

    // 字幕相关变量
    const $subtitleLine = $playbackContent.find('.subtitle-line');
    const $subtitleText = $playbackContent.find('.subtitle-text');
    let currentSegmentIndex = -1;

    /**
     * 更新字幕显示 - 逐字高亮
     * @param {number} segmentIndex - 当前句子索引
     * @param {number} charProgress - 字符进度 (0-1)
     */
    function updateSubtitle(segmentIndex, charProgress) {
        const segments = call.segments || [];
        if (segmentIndex < 0 || segmentIndex >= segments.length) {
            $subtitleLine.removeClass('visible');
            return;
        }

        const seg = segments[segmentIndex];
        const text = seg.translation || seg.text || '';

        // 切换到新句子
        if (segmentIndex !== currentSegmentIndex) {
            currentSegmentIndex = segmentIndex;

            // 将句子拆分为单个字符
            const chars = text.split('').map((char, i) =>
                `<span class="subtitle-char" data-index="${i}">${char}</span>`
            ).join('');

            $subtitleText.html(chars);

            // 触发显示动画
            $subtitleLine.removeClass('visible');
            setTimeout(() => $subtitleLine.addClass('visible'), 50);
        }

        // 更新逐字高亮
        const totalChars = text.length;
        const activeCharIndex = Math.floor(charProgress * totalChars);

        $subtitleText.find('.subtitle-char').each(function (index) {
            const $char = $(this);
            $char.removeClass('passed active');

            if (index < activeCharIndex) {
                $char.addClass('passed');
            } else if (index === activeCharIndex) {
                $char.addClass('active');
            }
        });
    }

    // 播放音频
    if (call.audio_url) {
        let fullUrl = call.audio_url;
        if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
            fullUrl = window.TTS_API.baseUrl + fullUrl;
        }

        console.log('[Mobile] 历史播放音频URL:', fullUrl);
        const audio = new Audio(fullUrl);
        let startTime = Date.now();
        let durationInterval = null;

        // 🎯 保存到全局状态,以便外部控制
        currentPlayingAudio = audio;

        // 更新播放时长
        durationInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            $playbackContent.find('.call-duration').text(
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            );
        }, 1000);

        // 🎯 更新全局引用(在 setInterval 创建后)
        currentDurationInterval = durationInterval;

        // 音频加载完成
        audio.addEventListener('loadedmetadata', function () {
            const duration = audio.duration;
            const mins = Math.floor(duration / 60);
            const secs = Math.floor(duration % 60);
            $playbackContent.find('.total-time').text(`${mins}:${secs.toString().padStart(2, '0')}`);
        });

        // 更新进度 + 字幕同步
        audio.addEventListener('timeupdate', function () {
            const currentTime = audio.currentTime;
            const duration = audio.duration;

            // 更新进度条
            const progress = (currentTime / duration) * 100;
            $playbackContent.find('.progress-bar-fill').css('width', progress + '%');

            const currentMins = Math.floor(currentTime / 60);
            const currentSecs = Math.floor(currentTime % 60);
            $playbackContent.find('.current-time').text(
                `${currentMins}:${currentSecs.toString().padStart(2, '0')}`
            );

            // 🎯 字幕同步 - 找到当前 segment 并计算字符进度
            const segments = call.segments || [];
            let activeIndex = -1;
            let charProgress = 0;

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const segStart = seg.start_time || 0;
                const segDuration = seg.audio_duration || 0;
                const segEnd = segStart + segDuration;

                if (currentTime >= segStart && currentTime < segEnd) {
                    activeIndex = i;
                    // 计算当前句子内的进度 (0-1)，添加0.5秒补偿让字幕提前
                    const compensatedTime = currentTime + 0.5;
                    const adjustedProgress = (compensatedTime - segStart) / segDuration;
                    charProgress = segDuration > 0 ? Math.min(1, Math.max(0, adjustedProgress)) : 0;
                    break;
                }
            }

            // 更新字幕
            updateSubtitle(activeIndex, charProgress);
        });

        // 播放音频
        audio.play().catch(err => {
            console.error('[Mobile] 历史播放失败:', err);
            alert('音频播放失败: ' + err.message);
            clearInterval(durationInterval);
            endPlayback();
        });

        // 音频播放结束
        audio.onended = function () {
            console.log('[Mobile] 历史播放完成');
            clearInterval(durationInterval);
            endPlayback();
        };

        // 停止按钮
        $playbackContent.find('#history-stop-btn').click(function () {
            console.log('[Mobile] 用户停止播放');
            audio.pause();
            clearInterval(durationInterval);
            endPlayback();
        });

        // 📥 下载按钮
        $playbackContent.find('#history-download-btn').click(async function () {
            console.log('[Mobile] 用户点击下载历史通话');

            const speaker = call.char_name || 'Unknown';
            const text = call.segments && call.segments.length > 0
                ? call.segments.map(seg => seg.translation || seg.text || '').join(' ')
                : '历史通话';

            console.log('📥 下载历史通话音频');
            console.log('  - audioUrl:', fullUrl);
            console.log('  - speaker:', speaker);
            console.log('  - text:', text);

            // 生成自定义文件名
            const cleanText = text.substring(0, 50).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
            const timestamp = new Date(call.created_at || Date.now()).toISOString().split('T')[0];
            const customFilename = `${speaker}_${timestamp}_${cleanText}.wav`;

            console.log('  - customFilename:', customFilename);

            // 使用 TTS_Events.downloadAudio 下载
            if (window.TTS_Events && window.TTS_Events.downloadAudio) {
                try {
                    await window.TTS_Events.downloadAudio(fullUrl, speaker, text);
                    console.log('✅ 下载请求已发送');
                } catch (err) {
                    console.error('❌ 下载失败:', err);
                    alert('下载失败: ' + err.message);
                }
            } else {
                alert('下载功能未就绪,请刷新页面');
            }
        });

        console.log('[Mobile] ✅ 下载按钮事件已绑定,按钮数量:', $playbackContent.find('#history-download-btn').length);

        function endPlayback() {
            // 🎯 清理全局引用
            if (currentDurationInterval) {
                clearInterval(currentDurationInterval);
                currentDurationInterval = null;
            }
            currentPlayingAudio = null;

            // 返回历史列表
            render(container, createNavbar);
        }
    } else {
        console.warn('[Mobile] 历史记录没有音频 URL');
        alert('该记录没有音频文件');
        render(container, createNavbar);
    }
}

/**
 * 停止当前正在播放的音频
 * 用于在退出 App 或点击返回时清理资源
 */
export function cleanup() {
    console.log('[Mobile] 清理来电记录 App 资源');
    stopCurrentAudio();
}

/**
 * 内部辅助函数 - 停止当前音频播放
 */
function stopCurrentAudio() {
    if (currentPlayingAudio) {
        console.log('[Mobile] 停止音频播放');
        currentPlayingAudio.pause();
        currentPlayingAudio.currentTime = 0;
        currentPlayingAudio = null;
    }

    if (currentDurationInterval) {
        clearInterval(currentDurationInterval);
        currentDurationInterval = null;
    }
}

export default { render, cleanup };

