// static/js/api.js
(function () {
    window.TTS_API = {
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

        async checkCache(params) {
            const queryParams = { ...params, check_only: "true" };
            const query = new URLSearchParams(queryParams).toString();
            const res = await fetch(this._url(`/tts_proxy?${query}`), {
                cache: 'no-store'
            });

            if (!res.ok) {
                // 尝试解析后端返回的详细错误信息
                let errorMsg = `缓存检查失败 (${res.status})`;
                try {
                    const errorData = await res.json();
                    if (errorData.detail) {
                        errorMsg = errorData.detail;
                    }
                } catch (parseError) {
                    // JSON 解析失败,使用默认错误信息
                    console.warn("无法解析错误响应:", parseError);
                }
                throw new Error(errorMsg);
            }

            const data = await res.json();
            return {
                cached: data.cached === true,
                filename: data.filename
            };
        },

        async generateAudio(params) {
            const queryParams = { ...params, streaming_mode: "false" };
            const query = new URLSearchParams(queryParams).toString();
            const res = await fetch(this._url(`/tts_proxy?${query}`), {
                cache: 'no-store'
            });

            if (!res.ok) {
                // 尝试解析后端返回的详细错误信息
                let errorMsg = `TTS 生成失败 (${res.status})`;
                try {
                    const errorData = await res.json();
                    if (errorData.detail) {
                        errorMsg = errorData.detail;
                    }
                } catch (parseError) {
                    // JSON 解析失败,使用默认错误信息
                    console.warn("无法解析错误响应:", parseError);
                }
                throw new Error(errorMsg);
            }

            const filename = res.headers.get("X-Audio-Filename");
            return {
                blob: await res.blob(),
                filename: filename
            };
        },

        async switchWeights(endpoint, path) {
            const res = await fetch(this._url(`/${endpoint}?weights_path=${path}`));

            if (!res.ok) {
                // 尝试解析后端返回的详细错误信息
                let errorMsg = `权重切换失败 (${res.status})`;
                try {
                    const errorData = await res.json();
                    if (errorData.detail) {
                        errorMsg = errorData.detail;
                    }
                } catch (parseError) {
                    // JSON 解析失败,使用默认错误信息
                    console.warn("无法解析错误响应:", parseError);
                }
                throw new Error(errorMsg);
            }
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
        }
    };
})();
