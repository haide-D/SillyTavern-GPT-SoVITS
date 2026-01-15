// 文件: ui_dashboard.js
window.TTS_UI = window.TTS_UI || {};

(function(scope) {
    // 渲染下拉框选项
    scope.renderModelOptions = function() {
        const CTX = scope.CTX; // 从主模块获取上下文
        const $select = $('#tts-new-model');
        const currentVal = $select.val();
        $select.empty().append('<option disabled value="">选择模型...</option>');
        const models = CTX.CACHE.models || {};
        if (Object.keys(models).length === 0) { $select.append('<option disabled>暂无模型文件夹</option>'); return; }
        Object.keys(models).forEach(k => { $select.append(`<option value="${k}">${k}</option>`); });
        if(currentVal) $select.val(currentVal);
        else $select.find('option:first').next().prop('selected', true);
    };

    // 渲染绑定列表
    scope.renderDashboardList = function() {
        const CTX = scope.CTX;
        const c = $('#tts-mapping-list').empty();
        const mappings = CTX.CACHE.mappings || {};
        if (Object.keys(mappings).length === 0) { c.append('<div class="tts-empty">暂无绑定记录</div>'); return; }
        Object.keys(mappings).forEach(k => {
            // 注意：这里引用了 window.TTS_UI.handleUnbind，确保主入口暴露了这个方法
            c.append(`
                <div class="tts-list-item">
                    <span class="col-name">${k}</span>
                    <span class="col-model">➡ ${mappings[k]}</span>
                    <div class="col-action"><button class="btn-red" onclick="window.TTS_UI.handleUnbind('${k}')">解绑</button></div>
                </div>
            `);
        });
    };

    // 绑定面板内的所有事件
    scope.bindDashboardEvents = function() {
        const CTX = scope.CTX;

        // Iframe 模式切换
        $('#tts-iframe-switch').change(async function() {
            const isChecked = $(this).is(':checked');
            const $label = $(this).parent();
            const originalText = $label.text();
            $label.text("正在保存设置...");

            try {
                await window.TTS_API.updateSettings({ iframe_mode: isChecked });
                CTX.CACHE.settings.iframe_mode = isChecked;
                localStorage.setItem('tts_plugin_iframe_mode', isChecked);
                alert(`已${isChecked ? '开启' : '关闭'}美化卡模式。\n页面即将刷新...`);
                location.reload();
            } catch(e) {
                console.error("保存失败", e);
                alert("保存失败");
                $label.text(originalText);
                $(this).prop('checked', !isChecked);
            }
        });

        // 下拉菜单回显逻辑
        const currentStyle = (CTX.CACHE.settings && CTX.CACHE.settings.bubble_style)
        || document.body.getAttribute('data-bubble-style')
        || 'default';
        const $targetOption = $(`.option-item[data-value="${currentStyle}"]`);
        if ($targetOption.length > 0) {
            $('#style-dropdown .select-trigger span').text($targetOption.text());
            $('#style-dropdown .select-trigger').attr('data-value', currentStyle);
            $('#style-selector').val(currentStyle);
        }

        // 远程连接开关
        $('#tts-remote-switch').change(function() {
            const checked = $(this).is(':checked');
            if(checked) $('#tts-remote-input-area').slideDown();
            else {
                $('#tts-remote-input-area').slideUp();
                const ip = $('#tts-remote-ip').val().trim();
                localStorage.setItem('tts_plugin_remote_config', JSON.stringify({ useRemote: false, ip: ip }));
                location.reload();
            }
        });

        $('#tts-save-remote').click(function() {
            const ip = $('#tts-remote-ip').val().trim();
            if(!ip) { alert("请输入 IP 地址"); return; }
            localStorage.setItem('tts_plugin_remote_config', JSON.stringify({ useRemote: true, ip: ip }));
            alert("设置已保存，即将刷新。");
            location.reload();
        });

        $('#tts-master-switch').change(function() { CTX.Callbacks.toggleMasterSwitch($(this).is(':checked')); });
        $('#tts-toggle-auto').change(function() { CTX.Callbacks.toggleAutoGenerate($(this).is(':checked')); });

        $('#tts-lang-select').val(CTX.CACHE.settings.default_lang || 'default');
        $('#tts-lang-select').change(async function() {
            const lang = $(this).val();
            CTX.CACHE.settings.default_lang = lang;
            await window.TTS_API.updateSettings({ default_lang: lang });
        });

        $('#tts-btn-save-paths').click(async function() {
            const btn = $(this);
            const oldText = btn.text();
            btn.text('保存中...').prop('disabled', true);
            const base = $('#tts-base-path').val().trim();
            const cache = $('#tts-cache-path').val().trim();

            const success = await CTX.Callbacks.saveSettings(base, cache);
            if(success) {
                alert('设置已保存！');
                CTX.Callbacks.refreshData().then(() => scope.renderModelOptions());
            } else {
                alert('保存失败，请检查控制台。');
            }
            btn.text(oldText).prop('disabled', false);
        });

        // 绑定新角色
        $('#tts-btn-bind-new').click(async function() {
            const charName = $('#tts-new-char').val().trim();
            const modelName = $('#tts-new-model').val();
            if(!charName || !modelName) { alert('请填写角色名并选择模型'); return; }

            try {
                await window.TTS_API.bindCharacter(charName, modelName);
                await CTX.Callbacks.refreshData();
                scope.renderDashboardList();
                $('#tts-new-char').val('');
            } catch(e) {
                console.error(e);
                alert("绑定失败，请检查后端日志");
            }
        });

        // 创建新文件夹 (原代码中有逻辑但HTML中好像没这个按钮，保留逻辑以防万一)
        $('#tts-btn-create-folder').click(async function() {
            const fName = $('#tts-create-folder-name').val().trim();
            if(!fName) return;
            try {
                await window.TTS_API.createModelFolder(fName);
                alert('创建成功！');
                CTX.Callbacks.refreshData().then(scope.renderModelOptions);
                $('#tts-create-folder-name').val('');
            } catch(e) {
                console.error(e);
                alert('创建失败，可能文件夹已存在。');
            }
        });

        // 下拉菜单交互逻辑
        $('#style-dropdown .select-trigger').off('click').on('click', function(e) {
            e.stopPropagation();
            $(this).parent().toggleClass('open');
        });

        $('.option-item').off('click').on('click', async function(e) {
            e.stopPropagation();
            const val = $(this).attr('data-value');
            const txt = $(this).text();
            const $container = $(this).closest('.tts-custom-select');

            $container.find('.select-trigger span').text(txt);
            $container.find('.select-trigger').attr('data-value', val);
            $('#style-selector').val(val);
            $container.removeClass('open');

            try {
                if(window.TTS_API && window.TTS_API.updateSettings) {
                    await window.TTS_API.updateSettings({ bubble_style: val });
                }
                if(CTX.CACHE && CTX.CACHE.settings) {
                    CTX.CACHE.settings.bubble_style = val;
                }
                console.log("样式已切换为:", val);
            } catch(err) {
                console.error("样式保存失败", err);
            }
        });

        $(document).off('click.closeDropdown').on('click.closeDropdown', function() {
            $('.tts-custom-select').removeClass('open');
        });
    };
    // ===========================================
    // ⬇️ 渲染模型下拉菜单 (适配后)
    // ===========================================
    scope.renderModelOptions = function() {
        // 关键点：从 scope 中获取全局上下文
        const CTX = scope.CTX;

        const $select = $('#tts-new-model');
        const currentVal = $select.val();

        // 重置下拉框
        $select.empty().append('<option disabled value="">选择模型...</option>');

        // 获取模型数据
        const models = (CTX && CTX.CACHE && CTX.CACHE.models) ? CTX.CACHE.models : {};

        if (Object.keys(models).length === 0) {
            $select.append('<option disabled>暂无模型文件夹</option>');
            return;
        }

        // 填充选项
        Object.keys(models).forEach(k => {
            $select.append(`<option value="${k}">${k}</option>`);
        });

        // 保持选中状态或默认选中第一个
        if(currentVal) {
            $select.val(currentVal);
        } else {
            $select.find('option:first').next().prop('selected', true);
        }
    };

    // ===========================================
    // ⬇️ 渲染绑定列表 (适配后)
    // ===========================================
    scope.renderDashboardList = function() {
        const CTX = scope.CTX;
        const c = $('#tts-mapping-list').empty();

        const mappings = (CTX && CTX.CACHE && CTX.CACHE.mappings) ? CTX.CACHE.mappings : {};

        if (Object.keys(mappings).length === 0) {
            c.append('<div class="tts-empty">暂无绑定记录</div>');
            return;
        }

        Object.keys(mappings).forEach(k => {
            // 注意：HTML 里的 onclick 必须指向全局的 window.TTS_UI.handleUnbind
            // 确保 ui_main.js 已经暴露了这个方法
            c.append(`
                <div class="tts-list-item">
                    <span class="col-name">${k}</span>
                    <span class="col-model">➡ ${mappings[k]}</span>
                    <div class="col-action">
                        <button class="btn-red" onclick="window.TTS_UI.handleUnbind('${k}')">解绑</button>
                    </div>
                </div>
            `);
        });
    };

})(window.TTS_UI);
