/**
 * 对话追踪 App 模块
 * 处理对话监听界面、监听播放、历史记录
 */

/**
 * 渲染对话追踪 App
 * @param {jQuery} container - App 容器
 * @param {Function} createNavbar - 创建导航栏函数
 */
export async function render(container, createNavbar) {
    const eavesdropData = window.TTS_EavesdropData;

    // ========== 状态1: 有对话追踪数据 - 显示监听界面 ==========
    if (eavesdropData) {
        container.empty();

        const speakersText = eavesdropData.speakers?.join(' & ') || '角色私聊';

        const $content = $(`
            <div class="eavesdrop-container">
                <div class="eavesdrop-icon">🎧</div>
                <div class="eavesdrop-title">${speakersText}</div>
                <div class="eavesdrop-status">${eavesdropData.scene_description || '正在私下对话...'}</div>
                
                <div class="eavesdrop-buttons">
                    <button id="eavesdrop-ignore-btn" class="eavesdrop-btn ignore-btn">忽略</button>
                    <button id="eavesdrop-listen-btn" class="eavesdrop-btn listen-btn">🎧 监听</button>
                </div>
            </div>
        `);

        container.append($content);

        // 忽略
        $content.find('#eavesdrop-ignore-btn').click(function () {
            console.log('[Eavesdrop] 用户忽略对话追踪');
            delete window.TTS_EavesdropData;
            $('#tts-manager-btn').removeClass('eavesdrop-available');
            $('#tts-mobile-trigger').removeClass('eavesdrop-available');
            $('#mobile-home-btn').click();
        });

        // 监听
        $content.find('#eavesdrop-listen-btn').click(function () {
            console.log('[Eavesdrop] 用户开始监听');
            showListeningUI(container, eavesdropData);
        });

        return;
    }

    // ========== 状态2: 无数据 - 显示历史记录 ==========
    container.empty();
    container.append(createNavbar("对话追踪记录"));

    const $content = $(`
        <div style="padding:15px; flex:1; overflow-y:auto; background:#f2f2f7;">
            <div style="text-align:center; padding:40px 20px; color:#888;">
                <div style="font-size:24px; margin-bottom:10px;">🎧</div>
                <div>正在加载对话追踪记录...</div>
            </div>
        </div>
    `);
    container.append($content);

    // 获取历史记录
    try {
        const chatBranch = getChatBranch();
        if (!chatBranch) {
            $content.html(`
                <div style="text-align:center; padding:40px 20px; color:#888;">
                    <div style="font-size:24px; margin-bottom:10px;">⚠️</div>
                    <div>未检测到对话</div>
                </div>
            `);
            return;
        }

        const apiHost = getApiHost();
        const response = await fetch(`${apiHost}/api/eavesdrop/history/${encodeURIComponent(chatBranch)}?limit=50`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.records || result.records.length === 0) {
            $content.html(`
                <div style="text-align:center; padding:40px 20px; color:#888;">
                    <div style="font-size:24px; margin-bottom:10px;">🎧</div>
                    <div>暂无对话追踪记录</div>
                </div>
            `);
            return;
        }

        // 渲染历史记录列表
        const historyHtml = result.records.map(record => {
            const date = record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '未知时间';
            const speakers = record.speakers?.join(' & ') || '未知角色';

            return `
                <div class="eavesdrop-history-item" data-record-id="${record.id}" style="
                    background:#fff; 
                    border-radius:12px; 
                    padding:15px; 
                    margin-bottom:12px;
                    cursor:pointer;
                    transition:all 0.2s;
                    border-left: 3px solid #22c55e;">
                    
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <strong style="font-size:16px; color:#333;">🎧 ${speakers}</strong>
                    </div>
                    
                    <div style="font-size:13px; color:#666; margin-bottom:8px;">
                        📅 ${date}
                    </div>
                    
                    ${record.audio_url ? `
                        <div class="play-area">
                            <div style="display:flex; align-items:center; gap:10px; padding:8px; background:#f0fdf4; border-radius:8px;">
                                <span style="font-size:20px;">🎵</span>
                                <span style="flex:1; font-size:13px; color:#166534;">点击重听</span>
                                <span style="font-size:12px; color:#999;">→</span>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        $content.html(historyHtml);

        // 全局音频管理器
        let currentAudio = null;
        let currentRecordId = null;

        // 绑定点击事件
        $content.find('.eavesdrop-history-item').click(function () {
            const recordId = $(this).data('record-id');
            const record = result.records.find(r => r.id === recordId);

            if (!record || !record.audio_url) {
                alert('该记录无法播放');
                return;
            }

            // 如果点击的是正在播放的项,则停止播放
            if (currentRecordId === recordId && currentAudio) {
                currentAudio.pause();
                currentAudio = null;
                currentRecordId = null;
                updatePlayUI(recordId, 'stopped');
                return;
            }

            // 停止当前正在播放的音频
            if (currentAudio) {
                currentAudio.pause();
                updatePlayUI(currentRecordId, 'stopped');
            }

            // 转换为完整URL
            let fullUrl = record.audio_url;
            const apiHost = getApiHost();
            if (fullUrl && fullUrl.startsWith('/')) {
                fullUrl = apiHost + fullUrl;
            }

            const audio = new Audio(fullUrl);
            currentAudio = audio;
            currentRecordId = recordId;

            updatePlayUI(recordId, 'loading');

            audio.addEventListener('loadedmetadata', () => {
                updatePlayUI(recordId, 'playing', audio.duration);
            });

            audio.addEventListener('timeupdate', () => {
                const progress = (audio.currentTime / audio.duration) * 100;
                updateProgress(recordId, progress, audio.currentTime);
            });

            audio.addEventListener('ended', () => {
                currentAudio = null;
                currentRecordId = null;
                updatePlayUI(recordId, 'stopped');
            });

            audio.play().catch(err => {
                console.error('[Eavesdrop] 播放失败:', err);
                alert('音频播放失败: ' + err.message);
                currentAudio = null;
                currentRecordId = null;
                updatePlayUI(recordId, 'stopped');
            });
        });

        // 更新播放UI
        function updatePlayUI(recordId, status, duration = 0) {
            const $item = $content.find(`.eavesdrop-history-item[data-record-id="${recordId}"]`);
            const $playArea = $item.find('.play-area');

            if (status === 'loading') {
                $playArea.html(`
                    <div style="text-align:center; padding:10px; color:#666;">
                        <div style="font-size:14px;">⏳ 加载中...</div>
                    </div>
                `);
            } else if (status === 'playing') {
                const durationText = formatTime(duration);
                $playArea.html(`
                    <div style="padding:10px; background:#f0fdf4; border-radius:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <span style="font-size:13px; color:#166534;">🎵 监听中</span>
                            <button class="stop-btn" style="background:#dc2626; color:white; border:none; border-radius:6px; padding:4px 12px; font-size:12px; cursor:pointer;">⏹ 停止</button>
                        </div>
                        <div style="background:#bbf7d0; height:4px; border-radius:2px; overflow:hidden; margin-bottom:5px;">
                            <div class="progress-bar" style="background:#16a34a; height:100%; width:0%; transition:width 0.1s;"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:11px; color:#166534;">
                            <span class="current-time">0:00</span>
                            <span class="total-time">${durationText}</span>
                        </div>
                    </div>
                `);

                $playArea.find('.stop-btn').click(function (e) {
                    e.stopPropagation();
                    if (currentAudio) {
                        currentAudio.pause();
                        currentAudio = null;
                        currentRecordId = null;
                        updatePlayUI(recordId, 'stopped');
                    }
                });
            } else if (status === 'stopped') {
                $playArea.html(`
                    <div style="display:flex; align-items:center; gap:10px; padding:8px; background:#f0fdf4; border-radius:8px;">
                        <span style="font-size:20px;">🎵</span>
                        <span style="flex:1; font-size:13px; color:#166534;">点击重听</span>
                        <span style="font-size:12px; color:#999;">→</span>
                    </div>
                `);
            }
        }

        function updateProgress(recordId, progress, currentTime) {
            const $item = $content.find(`.eavesdrop-history-item[data-record-id="${recordId}"]`);
            $item.find('.progress-bar').css('width', progress + '%');
            $item.find('.current-time').text(formatTime(currentTime));
        }

        function formatTime(seconds) {
            if (!seconds || isNaN(seconds)) return '0:00';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        // 悬停效果
        $content.find('.eavesdrop-history-item').hover(
            function () { $(this).css('box-shadow', '0 4px 12px rgba(0,0,0,0.1)'); },
            function () { $(this).css('box-shadow', 'none'); }
        );

    } catch (error) {
        console.error('[Eavesdrop] 获取历史记录失败:', error);
        $content.html(`
            <div style="text-align:center; padding:40px 20px; color:#ef4444;">
                <div style="font-size:24px; margin-bottom:10px;">❌</div>
                <div>加载失败: ${error.message}</div>
            </div>
        `);
    }
}

/**
 * 显示监听中界面
 * @param {jQuery} container - App 容器
 * @param {Object} eavesdropData - 对话追踪数据
 */
function showListeningUI(container, eavesdropData) {
    container.empty();

    const speakersText = eavesdropData.speakers?.join(' & ') || '私聊';

    const $listeningContent = $(`
        <div class="listening-container">
            <div class="listening-header">
                <div class="listening-avatar">🎧</div>
                <div class="listening-title">${speakersText}</div>
                <div class="listening-duration">00:00</div>
            </div>
            
            <!-- 音频可视化 -->
            <div class="audio-visualizer listening-visualizer">
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
            </div>

            <!-- 字幕区域 - 多说话人支持 -->
            <div class="listening-subtitle-area">
                <div class="subtitle-speaker"></div>
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

            <button id="listening-stop-btn" class="listening-stop-btn">⏹ 停止监听</button>
        </div>
    `);

    container.append($listeningContent);

    // 字幕相关变量
    const $subtitleSpeaker = $listeningContent.find('.subtitle-speaker');
    const $subtitleLine = $listeningContent.find('.subtitle-line');
    const $subtitleText = $listeningContent.find('.subtitle-text');
    let currentSegmentIndex = -1;

    /**
     * 更新字幕显示 - 支持多说话人
     */
    function updateSubtitle(segmentIndex, charProgress) {
        const segments = eavesdropData.segments || [];
        if (segmentIndex < 0 || segmentIndex >= segments.length) {
            $subtitleLine.removeClass('visible');
            $subtitleSpeaker.hide();
            return;
        }

        const seg = segments[segmentIndex];
        const text = seg.translation || seg.text || '';
        const speaker = seg.speaker || '';

        // 切换到新句子
        if (segmentIndex !== currentSegmentIndex) {
            currentSegmentIndex = segmentIndex;

            // 显示说话人
            if (speaker) {
                $subtitleSpeaker.text(speaker).show();
            } else {
                $subtitleSpeaker.hide();
            }

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
    if (eavesdropData.audio_url) {
        let fullUrl = eavesdropData.audio_url;
        const apiHost = getApiHost();
        if (fullUrl && fullUrl.startsWith('/')) {
            fullUrl = apiHost + fullUrl;
        }

        console.log('[Eavesdrop] 播放音频:', fullUrl);
        const audio = new Audio(fullUrl);
        let startTime = Date.now();
        let durationInterval = null;

        // 更新监听时长
        durationInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            $listeningContent.find('.listening-duration').text(
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            );
        }, 1000);

        // 音频加载完成
        audio.addEventListener('loadedmetadata', function () {
            const duration = audio.duration;
            const mins = Math.floor(duration / 60);
            const secs = Math.floor(duration % 60);
            $listeningContent.find('.total-time').text(`${mins}:${secs.toString().padStart(2, '0')}`);
        });

        // 更新进度 + 字幕同步
        audio.addEventListener('timeupdate', function () {
            const currentTime = audio.currentTime;
            const duration = audio.duration;

            // 更新进度条
            const progress = (currentTime / duration) * 100;
            $listeningContent.find('.progress-bar-fill').css('width', progress + '%');

            const currentMins = Math.floor(currentTime / 60);
            const currentSecs = Math.floor(currentTime % 60);
            $listeningContent.find('.current-time').text(
                `${currentMins}:${currentSecs.toString().padStart(2, '0')}`
            );

            // 字幕同步
            const segments = eavesdropData.segments || [];
            let activeIndex = -1;
            let charProgress = 0;

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const segStart = seg.start_time || 0;
                const segDuration = seg.audio_duration || 0;
                const segEnd = segStart + segDuration;

                if (currentTime >= segStart && currentTime < segEnd) {
                    activeIndex = i;
                    const compensatedTime = currentTime + 0.5;
                    const adjustedProgress = (compensatedTime - segStart) / segDuration;
                    charProgress = segDuration > 0 ? Math.min(1, Math.max(0, adjustedProgress)) : 0;
                    break;
                }
            }

            updateSubtitle(activeIndex, charProgress);
        });

        // 播放音频
        audio.play().catch(err => {
            console.error('[Eavesdrop] 音频播放失败:', err);
            alert('音频播放失败: ' + err.message);
            clearInterval(durationInterval);
            endListening();
        });

        // 音频播放结束
        audio.onended = function () {
            console.log('[Eavesdrop] 监听结束');
            clearInterval(durationInterval);
            endListening();
        };

        // 停止按钮
        $listeningContent.find('#listening-stop-btn').click(function () {
            console.log('[Eavesdrop] 用户停止监听');
            audio.pause();
            clearInterval(durationInterval);
            endListening();
        });

        function endListening() {
            delete window.TTS_EavesdropData;
            $('#tts-manager-btn').removeClass('eavesdrop-available');
            $('#tts-mobile-trigger').removeClass('eavesdrop-available');
            $('#mobile-home-btn').click();
        }
    } else {
        console.warn('[Eavesdrop] 没有音频 URL');
        delete window.TTS_EavesdropData;
        $('#tts-manager-btn').removeClass('eavesdrop-available');
        $('#tts-mobile-trigger').removeClass('eavesdrop-available');
        $('#mobile-home-btn').click();
    }
}

// 辅助函数
function getChatBranch() {
    try {
        if (window.TTS_Utils && window.TTS_Utils.getCurrentChatBranch) {
            return window.TTS_Utils.getCurrentChatBranch();
        }
        const context = window.SillyTavern?.getContext?.();
        if (context && context.chatId) {
            return context.chatId.replace(/\.(jsonl|json)$/i, "");
        }
    } catch (e) {
        console.error('[Eavesdrop] 获取 chat_branch 失败:', e);
    }
    return null;
}

function getApiHost() {
    if (window.TTS_State && window.TTS_State.CACHE && window.TTS_State.CACHE.API_URL) {
        return window.TTS_State.CACHE.API_URL;
    }
    const apiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? '127.0.0.1'
        : window.location.hostname;
    return `http://${apiHost}:3000`;
}

export default { render };
