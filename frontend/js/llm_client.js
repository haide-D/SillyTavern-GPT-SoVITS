async function fetchModels(apiUrl, apiKey) {
    const baseUrl = apiUrl.replace(/\/chat\/completions.*$/, '');
    const modelsUrl = baseUrl + '/models';

    const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    let models = [];
    if (data.data && Array.isArray(data.data)) {
        models = data.data.map(m => m.id || m.name || m);
    } else if (Array.isArray(data)) {
        models = data.map(m => typeof m === 'string' ? m : (m.id || m.name));
    }

    if (models.length === 0) {
        throw new Error('未找到可用模型');
    }

    return models;
}

async function callLLM(config) {
    let llmUrl = config.api_url.trim();

    if (!llmUrl.includes('/chat/completions')) {
        llmUrl = llmUrl.replace(/\/$/, '') + '/chat/completions';
    }

    const requestBody = {
        model: config.model,
        messages: [{ role: "user", content: config.prompt }],
        temperature: config.temperature || 0.8,
        stream: false
    };

    if (config.max_tokens) {
        requestBody.max_tokens = config.max_tokens;
    }

    const response = await fetch(llmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.api_key}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    return parseResponse(data);
}

function parseResponse(data) {
    // 添加详细的调试日志
    console.log('[LLM_Client] 🔍 开始解析LLM响应');
    console.log('[LLM_Client] 响应数据类型:', typeof data);
    console.log('[LLM_Client] 响应是否为对象:', data !== null && typeof data === 'object');

    if (data !== null && typeof data === 'object') {
        console.log('[LLM_Client] 响应对象的键:', Object.keys(data));
        console.log('[LLM_Client] 完整响应数据:', JSON.stringify(data, null, 2));
    } else {
        console.log('[LLM_Client] 响应数据 (非对象):', data);
    }

    let content = null;

    if (data.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content.trim();
        console.log('[LLM_Client] ✅ 使用 data.choices[0].message.content');
    }
    else if (data.choices?.[0]?.message?.reasoning_content) {
        content = data.choices[0].message.reasoning_content.trim();
        console.log('[LLM_Client] ✅ 使用 data.choices[0].message.reasoning_content');
    }
    else if (data.choices?.[0]?.text) {
        content = data.choices[0].text.trim();
        console.log('[LLM_Client] ✅ 使用 data.choices[0].text');
    }
    else if (data.content) {
        content = data.content.trim();
        console.log('[LLM_Client] ✅ 使用 data.content');
    }
    else if (data.output) {
        content = data.output.trim();
        console.log('[LLM_Client] ✅ 使用 data.output');
    }
    else if (data.response) {
        content = data.response.trim();
        console.log('[LLM_Client] ✅ 使用 data.response');
    }
    else if (data.result) {
        content = typeof data.result === 'string' ? data.result.trim() : JSON.stringify(data.result);
        console.log('[LLM_Client] ✅ 使用 data.result');
    }

    if (!content) {
        console.error('[LLM_Client] ❌ 无法从响应中提取内容');
        console.error('[LLM_Client] 已尝试的路径:');
        console.error('  - data.choices[0].message.content');
        console.error('  - data.choices[0].message.reasoning_content');
        console.error('  - data.choices[0].text');
        console.error('  - data.content');
        console.error('  - data.output');
        console.error('  - data.response');
        console.error('  - data.result');

        // 创建错误对象并附加原始响应数据
        const error = new Error('无法解析LLM响应 (响应格式不兼容)');
        error.rawResponse = data;  // 附加原始响应数据
        throw error;
    }

    console.log('[LLM_Client] ✅ 成功解析,内容长度:', content.length);
    return content;
}

/**
 * 流式调用 LLM (SSE)
 * 
 * @param {Object} config - LLM 配置
 * @param {string} config.api_url - API 地址
 * @param {string} config.api_key - API 密钥
 * @param {string} config.model - 模型名称
 * @param {string} config.prompt - 用户提示词
 * @param {Array} config.messages - 消息列表（可选，优先于 prompt）
 * @param {number} config.temperature - 温度（默认 0.8）
 * @param {number} config.max_tokens - 最大 token 数
 * @param {Function} onChunk - 收到文本块时的回调 (chunk: string) => void
 * @param {AbortSignal} signal - 可选的 AbortSignal 用于取消请求
 * @returns {Promise<string>} - 完整响应文本
 */
async function callLLMStream(config, onChunk, signal = null) {
    let llmUrl = config.api_url.trim();

    if (!llmUrl.includes('/chat/completions')) {
        llmUrl = llmUrl.replace(/\/$/, '') + '/chat/completions';
    }

    // 构建 messages
    let messages = config.messages;
    if (!messages && config.prompt) {
        messages = [{ role: "user", content: config.prompt }];
    }

    const requestBody = {
        model: config.model,
        messages: messages,
        temperature: config.temperature || 0.8,
        stream: true  // 启用流式
    };

    if (config.max_tokens) {
        requestBody.max_tokens = config.max_tokens;
    }

    console.log('[LLM_Client] 🚀 开始流式调用:', llmUrl);

    const response = await fetch(llmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.api_key}`
        },
        body: JSON.stringify(requestBody),
        signal: signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按行分割处理 SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // 保留不完整的行

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();

                if (data === '[DONE]') {
                    console.log('[LLM_Client] ✅ 流式完成');
                    continue;
                }

                try {
                    const event = JSON.parse(data);

                    // OpenAI 格式: choices[0].delta.content
                    let chunk = null;

                    if (event.choices?.[0]?.delta?.content) {
                        chunk = event.choices[0].delta.content;
                    }
                    // 兼容其他格式
                    else if (event.delta?.text) {
                        chunk = event.delta.text;
                    }
                    else if (event.content) {
                        chunk = event.content;
                    }

                    if (chunk) {
                        fullContent += chunk;
                        if (onChunk) {
                            onChunk(chunk);
                        }
                    }
                } catch (e) {
                    // 忽略 JSON 解析错误（可能是空行或其他非 JSON 数据）
                }
            }
        }
    }

    console.log('[LLM_Client] ✅ 流式调用完成,总长度:', fullContent.length);
    return fullContent;
}

export const LLM_Client = {
    fetchModels,
    callLLM,
    callLLMStream,
    parseResponse
};
