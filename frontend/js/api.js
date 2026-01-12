// static/js/api.js
(function () {
    window.TTS_API = {
        baseUrl: "",

        /**
         * 初始化 API 地址
         * @param {string} url - 后端地址 (e.g. "http://127.0.0.1:3000")
         */
        init: function(url) {
            this.baseUrl = url;
            console.log("🔵 [API] 服务地址已设定:", this.baseUrl);
        },

        // 内部辅助：拼接 URL
        _url: function(endpoint) {
            return `${this.baseUrl}${endpoint}`;
        },

        /**
         * 获取初始化数据 (模型列表、映射表、设置)
         */
        async getData() {
            const res = await fetch(this._url('/get_data'));
            if (!res.ok) throw new Error("API Connection Failed");
            return await res.json();
        },

        /**
         * 更新设置 (通用)
         * @param {object} payload - 需要更新的设置对象 e.g. { enabled: true }
         */
        async updateSettings(payload) {
            await fetch(this._url('/update_settings'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        },

        /**
         * 检查音频缓存是否存在
         * @param {object} params - 包含 text, text_lang, ref_audio_path 等
         * @returns {Promise<boolean>}
         */
        async checkCache(params) {
            // 强制追加 check_only 参数
            const queryParams = { ...params, check_only: "true" };
            const query = new URLSearchParams(queryParams).toString();

            const res = await fetch(this._url(`/tts_proxy?${query}`));
            const data = await res.json();
            return data.cached === true;
        },

        /**
         * 生成音频
         * @param {object} params - 生成参数
         * @returns {Promise<Blob>} - 返回音频 Blob 对象
         */
        async generateAudio(params) {
            // 确保 streaming_mode 开启
            const queryParams = { ...params, streaming_mode: "true" };
            const query = new URLSearchParams(queryParams).toString();

            const res = await fetch(this._url(`/tts_proxy?${query}`));
            if (!res.ok) throw new Error("Generation Error");
            return await res.blob();
        },

        /**
         * 切换模型权重 (GPT 或 SoVITS)
         * @param {string} endpoint - 'proxy_set_gpt_weights' 或 'proxy_set_sovits_weights'
         * @param {string} path - 权重文件路径
         */
        async switchWeights(endpoint, path) {
            await fetch(this._url(`/${endpoint}?weights_path=${path}`));
        }
    };
})();
