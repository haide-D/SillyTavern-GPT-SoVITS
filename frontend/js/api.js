// static/js/api.js
export const TTS_API = {
    baseUrl: "",

    init: function (url) {
        this.baseUrl = url;
        console.log("🔵 [API] 服务地址已设定:", this.baseUrl);
    },

    _url: function (endpoint) {
        return `${this.baseUrl}${endpoint}`;
    },

    async getData() {
        const res = await fetch(this._url('/get_data'));
        if (!res.ok) throw new Error("API Connection Failed");
        return await res.json();
    },

    async updateSettings(payload) {
        await fetch(this._url('/update_settings'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    },
    //TODO 修改为V2端口
    async checkCache(params) {
        const queryParams = { ...params, check_only: "true" };
        const query = new URLSearchParams(queryParams).toString();
        const res = await fetch(this._url(`/tts_proxy?${query}`), {
            cache: 'no-store'
        });
        const data = await res.json();
        return {
            cached: data.cached === true,
            filename: data.filename
        };
    },
    //TODO 修改为V2端口
    async generateAudio(params) {
        const queryParams = { ...params, streaming_mode: "false" };
        const query = new URLSearchParams(queryParams).toString();
        const res = await fetch(this._url(`/tts_proxy?${query}`), {
            cache: 'no-store'
        });
        const filename = res.headers.get("X-Audio-Filename");
        if (!res.ok) throw new Error("Generation Error");
        return {
            blob: await res.blob(),
            filename: filename
        };
    },

    async switchWeights(endpoint, path) {
        await fetch(this._url(`/${endpoint}?weights_path=${path}`));
    },

    // === 缓存管理 ===
    async deleteCache(filename) {
        // 构造查询参数 ?filename=xxx
        const query = new URLSearchParams({ filename: filename }).toString();

        // 发送请求
        const res = await fetch(this._url(`/delete_cache?${query}`));
        return await res.json();
    },

    // === 收藏夹管理 ===
    async getFavorites() {
        const res = await fetch(this._url('/get_favorites'));
        return await res.json();
    },

    async addFavorite(payload) {
        // payload 格式: { text, audio_url, char_name, context: [...] }
        const res = await fetch(this._url('/add_favorite'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    },

    async deleteFavorite(id) {
        await fetch(this._url('/delete_favorite'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        });
    },

    async getMatchedFavorites(payload) {
        const res = await fetch(this._url('/get_matched_favorites'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    },
    // ===========================================
    // 【新增】管理类 API (原本散落在 ui_legacy.js 里)
    // ===========================================

    /**
     * 绑定角色到模型文件夹
     */
    async bindCharacter(charName, modelFolder) {
        const res = await fetch(this._url('/bind_character'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ char_name: charName, model_folder: modelFolder })
        });
        if (!res.ok) throw new Error("Bind failed");
    },

    /**
     * 解绑角色
     */
    async unbindCharacter(charName) {
        const res = await fetch(this._url('/unbind_character'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ char_name: charName })
        });
        if (!res.ok) throw new Error("Unbind failed");
    },

    /**
     * 创建新的模型文件夹
     */
    async createModelFolder(folderName) {
        const res = await fetch(this._url('/create_model_folder'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_name: folderName })
        });
        if (!res.ok) throw new Error("Create folder failed");
    },

    // ===========================================
    // 【新增】说话人管理 API
    // ===========================================

    /**
     * 获取指定对话的所有说话人
     */
    async getSpeakers(chatBranch) {
        const res = await fetch(this._url(`/api/speakers/${encodeURIComponent(chatBranch)}`));
        if (!res.ok) throw new Error("Get speakers failed");
        return await res.json();
    },

    /**
     * 更新对话的说话人列表
     */
    async updateSpeakers(payload) {
        // payload 格式: { chat_branch, speakers, mesid }
        const res = await fetch(this._url('/api/speakers/update'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("Update speakers failed");
        return await res.json();
    },

    /**
     * 批量初始化说话人记录 (用于旧对话扫描)
     */
    async batchInitSpeakers(speakersData) {
        // speakersData 格式: [{ chat_branch, speakers, mesid }, ...]
        const res = await fetch(this._url('/api/speakers/batch_init'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ speakers_data: speakersData })
        });
        if (!res.ok) throw new Error("Batch init speakers failed");
        return await res.json();
    }
};
