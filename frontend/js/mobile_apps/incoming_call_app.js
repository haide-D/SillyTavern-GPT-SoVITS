/**
 * 来电 App 模块
 * 处理来电界面、通话中界面、来电历史记录
 */

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

        const $content = $(`
            <div class="incoming-call-container">
                <div class="call-icon">📞</div>
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
        $content.find('#mobile-answer-call-btn').click(function () {
            console.log('[Mobile] 用户接听来电');
            // 显示通话中界面
            showInCallUI(container, callData);
        });

        return;
    }

    // ========== 状态2: 无来电 - 显示历史记录列表 ==========
    container.empty();
    container.append(createNavbar("来电记录"));

    const $content = $(`
        <div style="padding:15px; flex:1; overflow-y:auto; background:#f2f2f7;">
            <div style="text-align:center; padding:40px 20px; color:#888;">
                <div style="font-size:24px; margin-bottom:10px;">📞</div>
                <div>正在加载来电记录...</div>
            </div>
        </div>
    `);
    container.append($content);

    // 获取当前角色名
    let charName = "";
    try {
        if (window.SillyTavern && window.SillyTavern.getContext) {
            const ctx = window.SillyTavern.getContext();
            if (ctx.characters && ctx.characterId !== undefined) {
                const charObj = ctx.characters[ctx.characterId];
                if (charObj && charObj.name) {
                    charName = charObj.name;
                }
            }
        }
    } catch (e) {
        console.error('[Mobile] 获取角色名失败:', e);
    }

    if (!charName) {
        $content.html(`
            <div style="text-align:center; padding:40px 20px; color:#888;">
                <div style="font-size:24px; margin-bottom:10px;">⚠️</div>
                <div>未检测到角色</div>
            </div>
        `);
        return;
    }

    // 获取历史记录
    try {
        console.log('[Mobile] 获取来电历史:', charName);
        const result = await window.TTS_API.getAutoCallHistory(charName, 20);

        if (result.status !== 'success' || !result.history || result.history.length === 0) {
            $content.html(`
                <div style="text-align:center; padding:40px 20px; color:#888;">
                    <div style="font-size:24px; margin-bottom:10px;">📞</div>
                    <div>暂无来电记录</div>
                </div>
            `);
            return;
        }

        // 渲染历史记录列表
        const historyHtml = result.history.map(call => {
            const date = call.created_at ? new Date(call.created_at).toLocaleString('zh-CN') : '未知时间';
            const statusText = call.status === 'completed' ? '已完成' : call.status === 'failed' ? '失败' : '处理中';
            const statusColor = call.status === 'completed' ? '#10b981' : call.status === 'failed' ? '#ef4444' : '#f59e0b';

            return `
                <div class="call-history-item" data-call-id="${call.id}" style="
                    background:#fff; 
                    border-radius:12px; 
                    padding:15px; 
                    margin-bottom:12px;
                    cursor:pointer;
                    transition:all 0.2s;">
                    
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <strong style="font-size:16px; color:#333;">${call.char_name || '未知角色'}</strong>
                        <span style="font-size:12px; color:${statusColor};">● ${statusText}</span>
                    </div>
                    
                    <div style="font-size:13px; color:#666; margin-bottom:8px;">
                        📅 ${date}
                    </div>
                    
                    ${call.status === 'completed' && call.audio_url ? `
                        <div class="play-area">
                            <div style="display:flex; align-items:center; gap:10px; padding:8px; background:#f9fafb; border-radius:8px;">
                                <span style="font-size:20px;">🎵</span>
                                <span style="flex:1; font-size:13px; color:#666;">点击播放</span>
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
        let currentCallId = null;

        // 绑定点击事件
        $content.find('.call-history-item').click(function () {
            const callId = $(this).data('call-id');
            const call = result.history.find(c => c.id === callId);

            if (!call || call.status !== 'completed' || !call.audio_url) {
                alert('该来电记录无法播放');
                return;
            }

            // 如果点击的是正在播放的项,则停止播放
            if (currentCallId === callId && currentAudio) {
                currentAudio.pause();
                currentAudio = null;
                currentCallId = null;
                updatePlayUI(callId, 'stopped');
                return;
            }

            // 停止当前正在播放的音频
            if (currentAudio) {
                currentAudio.pause();
                updatePlayUI(currentCallId, 'stopped');
            }

            console.log('[Mobile] 播放历史来电:', call);

            // 转换为完整URL
            let fullUrl = call.audio_url;
            if (fullUrl && fullUrl.startsWith('/') && window.TTS_API && window.TTS_API.baseUrl) {
                fullUrl = window.TTS_API.baseUrl + fullUrl;
            }

            console.log('[Mobile] 完整音频URL:', fullUrl);
            const audio = new Audio(fullUrl);
            currentAudio = audio;
            currentCallId = callId;

            // 显示加载状态
            updatePlayUI(callId, 'loading');

            // 音频加载完成,获取时长
            audio.addEventListener('loadedmetadata', function () {
                const duration = audio.duration;
                console.log('[Mobile] 音频时长:', duration);
                updatePlayUI(callId, 'playing', duration);
            });

            // 更新进度
            audio.addEventListener('timeupdate', function () {
                const progress = (audio.currentTime / audio.duration) * 100;
                updateProgress(callId, progress, audio.currentTime, audio.duration);
            });

            // 播放结束
            audio.addEventListener('ended', function () {
                currentAudio = null;
                currentCallId = null;
                updatePlayUI(callId, 'stopped');
            });

            // 开始播放
            audio.play().catch(err => {
                console.error('[Mobile] 播放失败:', err);
                alert('音频播放失败: ' + err.message);
                currentAudio = null;
                currentCallId = null;
                updatePlayUI(callId, 'stopped');
            });
        });

        // 更新播放UI
        function updatePlayUI(callId, status, duration = 0) {
            const $item = $content.find(`.call-history-item[data-call-id="${callId}"]`);
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
                    <div style="padding:10px; background:#f9fafb; border-radius:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <span style="font-size:13px; color:#666;">🎵 播放中</span>
                            <button class="stop-btn" style="background:#ef4444; color:white; border:none; border-radius:6px; padding:4px 12px; font-size:12px; cursor:pointer;">⏹ 停止</button>
                        </div>
                        <div style="background:#e5e7eb; height:4px; border-radius:2px; overflow:hidden; margin-bottom:5px;">
                            <div class="progress-bar" style="background:#3b82f6; height:100%; width:0%; transition:width 0.1s;"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:11px; color:#999;">
                            <span class="current-time">0:00</span>
                            <span class="total-time">${durationText}</span>
                        </div>
                    </div>
                `);

                // 绑定停止按钮
                $playArea.find('.stop-btn').click(function (e) {
                    e.stopPropagation();
                    if (currentAudio) {
                        currentAudio.pause();
                        currentAudio = null;
                        currentCallId = null;
                        updatePlayUI(callId, 'stopped');
                    }
                });
            } else if (status === 'stopped') {
                $playArea.html(`
                    <div style="display:flex; align-items:center; gap:10px; padding:8px; background:#f9fafb; border-radius:8px;">
                        <span style="font-size:20px;">🎵</span>
                        <span style="flex:1; font-size:13px; color:#666;">点击播放</span>
                        <span style="font-size:12px; color:#999;">→</span>
                    </div>
                `);
            }
        }

        // 更新进度
        function updateProgress(callId, progress, currentTime, duration) {
            const $item = $content.find(`.call-history-item[data-call-id="${callId}"]`);
            $item.find('.progress-bar').css('width', progress + '%');
            $item.find('.current-time').text(formatTime(currentTime));
        }

        // 格式化时间
        function formatTime(seconds) {
            if (!seconds || isNaN(seconds)) return '0:00';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        // 悬停效果
        $content.find('.call-history-item').hover(
            function () { $(this).css('box-shadow', '0 4px 12px rgba(0,0,0,0.1)'); },
            function () { $(this).css('box-shadow', 'none'); }
        );

    } catch (error) {
        console.error('[Mobile] 获取历史记录失败:', error);
        $content.html(`
            <div style="text-align:center; padding:40px 20px; color:#ef4444;">
                <div style="font-size:24px; margin-bottom:10px;">❌</div>
                <div>加载失败: ${error.message}</div>
            </div>
        `);
    }
}

/**
 * 显示通话中界面
 * @param {jQuery} container - App 容器
 * @param {Object} callData - 来电数据
 */
function showInCallUI(container, callData) {
    container.empty();

    // 生成segments HTML
    const segmentsHTML = (callData.segments || []).map((seg, index) => {
        const displayText = seg.translation || seg.text || '';
        const startTime = seg.start_time || 0;

        return `
            <div class="call-segment" data-index="${index}" data-start-time="${startTime}">
                <div class="segment-emotion-tag">${seg.emotion || '默认'}</div>
                <div class="segment-text-content">${displayText}</div>
            </div>
        `;
    }).join('');

    // 创建通话中界面
    const $inCallContent = $(`
        <div class="in-call-container">
            <div class="call-header">
                <div class="call-avatar">👤</div>
                <div class="call-name">${callData.char_name}</div>
                <div class="call-duration">00:00</div>
            </div>
            
            <!-- 对话内容区域 -->
            <div class="call-segments-container">
                ${segmentsHTML}
            </div>

            <div class="audio-visualizer">
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
                <div class="audio-bar"></div>
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

    // 播放音频
    if (callData.audio_url) {
        // 转换为完整URL
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

        // 更新进度
        audio.addEventListener('timeupdate', function () {
            const progress = (audio.currentTime / audio.duration) * 100;
            $inCallContent.find('.progress-bar-fill').css('width', progress + '%');

            const currentMins = Math.floor(audio.currentTime / 60);
            const currentSecs = Math.floor(audio.currentTime % 60);
            $inCallContent.find('.current-time').text(
                `${currentMins}:${currentSecs.toString().padStart(2, '0')}`
            );

            // 🎯 音轨同步 - 高亮当前segment
            const currentTime = audio.currentTime;
            const $segments = $inCallContent.find('.call-segment');

            // 找到当前时间对应的segment
            let activeIndex = -1;
            for (let i = 0; i < (callData.segments || []).length; i++) {
                const seg = callData.segments[i];
                const segStartTime = seg.start_time || 0;
                const duration = seg.audio_duration || 0;
                const endTime = segStartTime + duration;

                if (currentTime >= segStartTime && currentTime < endTime) {
                    activeIndex = i;
                    break;
                }
            }

            // 更新高亮状态
            $segments.each(function (index) {
                const $seg = $(this);
                if (index === activeIndex) {
                    $seg.addClass('active');
                    // 自动滚动到当前segment
                    this.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    $seg.removeClass('active');
                }
            });
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

export default { render };
