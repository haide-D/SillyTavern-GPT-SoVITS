/**
 * 主动电话 App 模块
 * 生成并播放主动电话
 */

/**
 * 渲染主动电话 App
 * @param {jQuery} container - App 容器
 * @param {Function} createNavbar - 创建导航栏函数
 */
export async function render(container, createNavbar) {
    container.empty();
    container.append(createNavbar("主动电话测试"));

    const $content = $(`
        <div style="padding:15px; flex:1; overflow-y:auto; background:#f2f2f7;">
            <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">📋 测试说明</h3>
                <div style="font-size:13px; color:#666; line-height:1.6;">
                    这是一个简单的主动电话功能测试界面。<br>
                    点击"生成电话"按钮,系统将:<br>
                    1. 读取当前对话上下文<br>
                    2. 调用LLM生成电话内容<br>
                    3. 生成带情绪的TTS音频<br>
                    4. 返回完整的音频文件
                </div>
            </div>

            <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">🎭 当前角色</h3>
                <div id="phone-char-name" style="font-size:14px; color:#666; padding:10px; background:#f9fafb; border-radius:8px;">
                    正在获取...
                </div>
            </div>

            <div style="background:#fff; border-radius:12px; padding:15px; margin-bottom:15px;">
                <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">💬 对话上下文</h3>
                <div id="phone-context-info" style="font-size:13px; color:#666; padding:10px; background:#f9fafb; border-radius:8px;">
                    正在获取...
                </div>
            </div>

            <button id="phone-generate-btn" 
                style="width:100%; padding:15px; background:#10b981; color:#fff; border:none; border-radius:12px; font-size:16px; font-weight:bold; cursor:pointer; margin-bottom:15px;">
                📞 生成主动电话
            </button>

            <div id="phone-result" style="display:none; background:#fff; border-radius:12px; padding:15px;">
                <h3 style="margin:0 0 15px 0; font-size:16px; color:#333;">📊 生成结果</h3>
                <div id="phone-result-content"></div>
            </div>
        </div>
    `);

    container.append($content);

    // 获取当前角色信息
    let charName = "";
    let context = [];

    try {
        console.log('[主动电话] 开始获取角色和上下文...');

        if (window.SillyTavern && window.SillyTavern.getContext) {
            const ctx = window.SillyTavern.getContext();
            console.log('[主动电话] SillyTavern上下文', ctx);

            // 获取角色名
            if (ctx.characters && ctx.characterId !== undefined) {
                const charObj = ctx.characters[ctx.characterId];
                if (charObj && charObj.name) {
                    charName = charObj.name;
                    $('#phone-char-name').html(`<strong>${charName}</strong>`);
                    console.log('[主动电话] 角色名', charName);
                }
            }

            // 获取对话上下文
            if (ctx.chat && Array.isArray(ctx.chat)) {
                context = ctx.chat.map(msg => ({
                    role: msg.is_user ? "user" : "assistant",
                    content: msg.mes || ""
                }));

                $('#phone-context-info').html(`
                    共 <strong>${context.length}</strong> 条消息<br>
                    <span style="font-size:12px; color:#999;">最近10条将用于生成</span>
                `);
                console.log('[主动电话] 上下文消息数:', context.length);
            }
        } else {
            console.warn('[主动电话] window.SillyTavern 未就绪');
        }
    } catch (e) {
        console.error("获取上下文失败", e);
        $('#phone-char-name').html('<span style="color:#dc2626;">❌ 获取失败</span>');
        $('#phone-context-info').html('<span style="color:#dc2626;">❌ 获取失败</span>');
    }

    // 生成按钮点击事件
    $content.on('click', '#phone-generate-btn', async function () {
        const $btn = $(this);
        const $result = $('#phone-result');
        const $resultContent = $('#phone-result-content');

        if (!charName) {
            alert('未检测到角色,请先打开一个对话');
            return;
        }

        if (context.length === 0) {
            alert('对话上下文为空,请先进行一些对话');
            return;
        }

        $btn.prop('disabled', true).text('生成中...');
        $result.show();
        $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在生成主动电话内容...</div>');

        try {
            console.log('[主动电话] 开始生成...', { charName, contextLength: context.length });

            // 全新流程: 三步走
            // 步骤1: 调用后端构建提示词
            const apiBaseUrl = window.TTS_API.baseUrl;
            const buildPromptUrl = `${apiBaseUrl}/api/phone_call/build_prompt`;

            console.log('[主动电话] 步骤1: 构建提示词...', buildPromptUrl);
            $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在构建提示词...</div>');

            const buildResponse = await fetch(buildPromptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    char_name: charName,
                    context: context
                })
            });

            if (!buildResponse.ok) {
                const errorText = await buildResponse.text();
                throw new Error(`构建提示词失败(${buildResponse.status}): ${errorText}`);
            }

            const buildResult = await buildResponse.json();
            console.log('[主动电话] ✅ 提示词构建完成', buildResult);

            // 步骤2: 使用LLM_Client直接调用外部LLM (就像LLM测试那样)
            console.log('[主动电话] 步骤2: 调用LLM...');
            $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在调用LLM生成内容...</div>');

            const llmConfig = {
                api_url: buildResult.llm_config.api_url,
                api_key: buildResult.llm_config.api_key,
                model: buildResult.llm_config.model,
                temperature: buildResult.llm_config.temperature,
                max_tokens: buildResult.llm_config.max_tokens,
                prompt: buildResult.prompt
            };
            const llmResponse = await window.LLM_Client.callLLM(llmConfig);
            $resultContent.html('<div style="text-align:center; padding:20px; color:#666;">正在解析LLM响应...</div>');
            const parseUrl = `${apiBaseUrl}/api/phone_call/parse_and_generate`;
            const parseResponse = await fetch(parseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    char_name: charName,
                    llm_response: llmResponse,
                    generate_audio: true
                })
            });

            if (!parseResponse.ok) {
                const errorText = await parseResponse.text();
                throw new Error(`解析响应失败 (${parseResponse.status}): ${errorText}`);
            }

            const result = await parseResponse.json();
            if (result.status !== 'success') {
                throw new Error(result.message || '生成失败');
            }

            let html = `
                <div style="padding:15px; background:#d1fae5; border-radius:8px; margin-bottom:15px;">
                    <div style="font-size:18px; margin-bottom:5px;">✅ 生成成功</div>
                    <div style="font-size:13px; color:#065f46;">共 ${result.total_segments} 个情绪片段</div>
                </div>
            `;

            if (result.segments && result.segments.length > 0) {
                html += '<div style="margin-bottom:15px;"><strong style="color:#666; font-size:13px;">📝 生成的内容</strong></div>';

                result.segments.forEach((seg, i) => {
                    html += `
                        <div style="background:#f9fafb; padding:12px; border-radius:8px; margin-bottom:10px; border-left:3px solid #10b981;">
                            <div style="font-size:12px; color:#10b981; margin-bottom:5px;">
                                <strong>片段 ${i + 1}</strong> · 情绪: ${seg.emotion}
                            </div>
                            <div style="font-size:14px; color:#333;">
                                "${seg.text}"
                            </div>
                        </div>
                    `;
                });
            }

            if (result.audio) {
                const binaryString = atob(result.audio);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                const audioBlob = new Blob([bytes], { type: 'audio/wav' });
                const audioUrl = URL.createObjectURL(audioBlob);

                html += `
                    <div style="margin-top:15px; padding:15px; background:#f0f9ff; border-radius:8px;">
                        <div style="font-size:13px; color:#0369a1; margin-bottom:10px;">
                            🎵 <strong>合成音频</strong>
                        </div>
                        <audio controls style="width:100%; margin-bottom:10px;" src="${audioUrl}"></audio>
                        <button class="phone-download-audio" data-url="${audioUrl}" data-charname="${charName}"
                            style="width:100%; padding:10px; background:#0ea5e9; color:#fff; border:none; border-radius:8px; cursor:pointer;">
                            ⬇️ 下载音频
                        </button>
                    </div>
                `;
            }

            $resultContent.html(html);

            $('.phone-download-audio').click(function () {
                const url = $(this).data('url');
                const charname = $(this).data('charname');
                const a = document.createElement('a');
                a.href = url;
                a.download = `${charname}_主动电话_${new Date().getTime()}.wav`;
                a.click();
            });

        } catch (error) {
            console.error('[主动电话] 生成失败:', error);

            $resultContent.html(`
                <div style="padding:15px; background:#fee2e2; border-radius:8px; margin-bottom:10px;">
                    <div style="font-size:18px; margin-bottom:5px;">❌ 生成失败</div>
                    <div style="font-size:13px; color:#991b1b;">${error.message}</div>
                </div>
                
                <div style="background:#f9fafb; padding:10px; border-radius:6px; font-size:12px; color:#666;">
                    <strong>错误详情:</strong><br>
                    ${error.message}
                </div>
                
                <div style="margin-top:10px; padding:10px; background:#fef3c7; border-radius:6px; font-size:12px; color:#92400e;">
                    💡 <strong>排查建议:</strong><br>
                    1. 检查LLM配置是否正确<br>
                    2. 确认角色有可用的参考音频<br>
                    3. 查看浏览器控制台的详细日志<br>
                    4. 检查后端服务是否正常运行
            `);
        } finally {
            $btn.prop('disabled', false).text('📞 生成主动电话');
        }
    });
}

export default { render };
