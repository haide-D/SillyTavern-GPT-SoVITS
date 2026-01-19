window.LLM_Client = (function () {
    'use strict';

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
        let content = null;

        if (data.choices?.[0]?.message?.content) {
            content = data.choices[0].message.content.trim();
        }
        else if (data.choices?.[0]?.message?.reasoning_content) {
            content = data.choices[0].message.reasoning_content.trim();
        }
        else if (data.choices?.[0]?.text) {
            content = data.choices[0].text.trim();
        }
        else if (data.content) {
            content = data.content.trim();
        }
        else if (data.output) {
            content = data.output.trim();
        }
        else if (data.response) {
            content = data.response.trim();
        }
        else if (data.result) {
            content = typeof data.result === 'string' ? data.result.trim() : JSON.stringify(data.result);
        }

        if (!content) {
            throw new Error('无法解析LLM响应 (响应格式不兼容)');
        }

        return content;
    }

    return {
        fetchModels,
        callLLM,
        parseResponse
    };
})();
