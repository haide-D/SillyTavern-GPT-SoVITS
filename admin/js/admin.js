// API 基础路径
const API_BASE = '/api/admin';

// 当前状态
let currentModels = [];
let currentSelectedModel = '';

// ==================== 页面导航 ====================
document.addEventListener('DOMContentLoaded', () => {
    // 导航切换
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            switchPage(page);
        });
    });

    // 初始化加载
    loadDashboard();
    loadModels();
    loadSettings();

    // 绑定获取 LLM 模型列表按钮
    bindFetchModelsButton();
    // 绑定测试 LLM 连接按钮
    bindTestConnectionButton();
    // 绑定分析引擎 LLM 按钮
    bindAnalysisLLMButtons();
    // 绑定设置页 Tab 切换
    bindSettingsTabs();

    // 显示通告弹窗
    document.getElementById('notice-dialog').style.display = 'flex';
});

function switchPage(pageName) {
    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');

    // 更新页面显示
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageName).classList.add('active');

    // 页面特定加载
    if (pageName === 'audios') {
        populateModelSelect();
    }
}

// ==================== 仪表盘 ====================
async function loadDashboard() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();

        // GPT-SoVITS 服务
        if (data.sovits_service) {
            const sovits = data.sovits_service;
            const statusEl = document.getElementById('sovits-status');

            if (sovits.accessible) {
                statusEl.textContent = window.t('运行中');
                statusEl.className = 'status-badge status-success';
                document.getElementById('sovits-state').textContent = '可访问';
            } else {
                statusEl.textContent = window.t('未运行');
                statusEl.className = 'status-badge status-error';
                document.getElementById('sovits-state').textContent = sovits.error || '无法连接';
            }
            document.getElementById('sovits-url').textContent = sovits.url;
        }

        // 检查版本更新
        checkVersion();
    } catch (error) {
        console.error('加载仪表盘失败:', error);
        showNotification('加载仪表盘失败', 'error');
    }
}

function refreshStatus() {
    showNotification('正在刷新...', 'info');
    loadDashboard();
}

// ==================== 模型管理 ====================
async function loadModels() {
    try {
        const response = await fetch(`${API_BASE}/models`);
        const data = await response.json();

        currentModels = data.models || [];
        renderModels(currentModels);
    } catch (error) {
        console.error('加载模型失败:', error);
        document.getElementById('models-list').innerHTML =
            '<p class="placeholder">加载失败,请检查后端服务</p>';
    }
}

function renderModels(models) {
    const container = document.getElementById('models-list');

    if (models.length === 0) {
        container.innerHTML = '<p class="placeholder">暂无模型,点击右上角创建新模型</p>';
        if (window.translateDOM) window.translateDOM(container);
        return;
    }

    container.innerHTML = models.map(model => `
        <div class="model-card ${model.valid ? '' : 'invalid'}">
            <h3>${model.name}</h3>
            <div class="model-files">
                <div class="file-status ${model.files.gpt_weights ? 'valid' : 'invalid'}">
                    GPT 权重 (*.ckpt)
                </div>
                <div class="file-status ${model.files.sovits_weights ? 'valid' : 'invalid'}">
                    SoVITS 权重 (*.pth)
                </div>
                <div class="file-status ${model.files.reference_audios ? 'valid' : 'invalid'}">
                    参考音频目录
                </div>
            </div>
            <div class="model-stats">
                <div class="stat-item">
                    <div class="stat-value">${model.audio_stats.total || 0}</div>
                    <div class="stat-label">音频总数</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${Object.keys(model.audio_stats.by_emotion || {}).length}</div>
                    <div class="stat-label">情感类型</div>
                </div>
            </div>
            <div class="model-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" onclick="goToAudioManagement('${model.name}')">
                    🎵 管理音频 (${model.audio_stats.total || 0})
                </button>
                <button class="btn btn-primary" onclick="showBatchEmotionDialog('${model.name}')">
                    🏷️ 批量修改情感
                </button>
            </div>
        </div>
    `).join('');
    if (window.translateDOM) window.translateDOM(container);
}


function showCreateModelDialog() {
    document.getElementById('create-model-dialog').style.display = 'flex';
    document.getElementById('new-model-name').value = '';
    // 清空文件选择
    clearModelFile('gpt');
    clearModelFile('sovits');
    // 隐藏进度条
    document.getElementById('upload-progress-container').style.display = 'none';
}

// 文件预览功能
function previewModelFile(type) {
    const fileInput = document.getElementById(`${type}-model-file`);
    const preview = document.getElementById(`${type}-file-preview`);
    const fileInfo = preview.querySelector('.file-info');

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

        // 验证文件大小 (限制2GB)
        if (file.size > 2 * 1024 * 1024 * 1024) {
            showNotification('文件大小超过2GB限制', 'error');
            fileInput.value = '';
            return;
        }

        // 验证文件扩展名
        const expectedExt = type === 'gpt' ? '.ckpt' : '.pth';
        if (!file.name.toLowerCase().endsWith(expectedExt)) {
            showNotification(`请选择${expectedExt}文件`, 'error');
            fileInput.value = '';
            return;
        }

        fileInfo.textContent = `📁 ${file.name} (${sizeMB} MB)`;
        preview.style.display = 'flex';
    } else {
        preview.style.display = 'none';
    }
}

// 清除文件选择
function clearModelFile(type) {
    const fileInput = document.getElementById(`${type}-model-file`);
    const preview = document.getElementById(`${type}-file-preview`);

    fileInput.value = '';
    preview.style.display = 'none';
}

async function createModel() {
    const name = document.getElementById('new-model-name').value.trim();
    const gptFileInput = document.getElementById('gpt-model-file');
    const sovitsFileInput = document.getElementById('sovits-model-file');
    const createBtn = document.getElementById('create-model-btn');
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressText = document.getElementById('upload-progress-text');
    const progressPercent = document.getElementById('upload-progress-percent');

    if (!name) {
        showNotification('请输入模型名称', 'warning');
        return;
    }

    // 准备FormData
    const formData = new FormData();
    formData.append('model_name', name);

    // 添加文件(如果有)
    if (gptFileInput.files.length > 0) {
        formData.append('gpt_file', gptFileInput.files[0]);
    }
    if (sovitsFileInput.files.length > 0) {
        formData.append('sovits_file', sovitsFileInput.files[0]);
    }

    try {
        // 禁用创建按钮
        createBtn.disabled = true;

        // 显示进度条
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';
        progressText.textContent = window.t('正在创建模型...');

        // 使用XMLHttpRequest以支持进度监控
        const xhr = new XMLHttpRequest();

        // 进度监听
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percentComplete + '%';
                progressPercent.textContent = percentComplete + '%';

                if (percentComplete < 100) {
                    progressText.textContent = window.t('正在上传文件...');
                } else {
                    progressText.textContent = window.t('处理中...');
                }
            }
        });

        // 完成监听
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const data = JSON.parse(xhr.responseText);
                showNotification(`模型 "${name}" 创建成功`, 'success');
                closeDialog('create-model-dialog');
                loadModels();
            } else {
                const data = JSON.parse(xhr.responseText);
                showNotification(data.detail || '创建失败', 'error');
            }

            // 重置UI
            createBtn.disabled = false;
            progressContainer.style.display = 'none';
        });

        // 错误监听
        xhr.addEventListener('error', () => {
            showNotification('创建失败,请检查后端服务', 'error');
            createBtn.disabled = false;
            progressContainer.style.display = 'none';
        });

        // 发送请求
        xhr.open('POST', `${API_BASE}/models/create`);
        xhr.send(formData);

    } catch (error) {
        console.error('创建模型失败:', error);
        showNotification('创建失败,请检查后端服务', 'error');
        createBtn.disabled = false;
        progressContainer.style.display = 'none';
    }
}

// ==================== 音频管理 ====================
function populateModelSelect() {
    const select = document.getElementById('audio-model-select');
    select.innerHTML = '<option value="">' + window.t('选择模型...') + '</option>' +
        currentModels.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
}

async function loadAudios() {
    const modelName = document.getElementById('audio-model-select').value;
    const uploadBtn = document.getElementById('upload-btn');
    const batchEmotionBtn = document.getElementById('batch-emotion-btn');
    const container = document.getElementById('audios-list');

    if (!modelName) {
        container.innerHTML = '<p class="placeholder">请先选择一个模型</p>';
        if (window.translateDOM) window.translateDOM(container);
        uploadBtn.disabled = true;
        batchEmotionBtn.disabled = true;
        return;
    }

    currentSelectedModel = modelName;
    uploadBtn.disabled = false;
    batchEmotionBtn.disabled = false;

    try {
        const response = await fetch(`${API_BASE}/models/${encodeURIComponent(modelName)}/audios`);
        const data = await response.json();

        renderAudios(data.audios || []);
    } catch (error) {
        console.error('加载音频失败:', error);
        container.innerHTML = '<p class="placeholder">加载失败</p>';
        if (window.translateDOM) window.translateDOM(container);
    }
}

function renderAudios(audios) {
    const container = document.getElementById('audios-list');

    if (audios.length === 0) {
        container.innerHTML = '<p class="placeholder">该模型暂无参考音频</p>';
        if (window.translateDOM) window.translateDOM(container);
        return;
    }

    container.innerHTML = audios.map(audio => `
        <div class="audio-card">
            <div class="filename">${audio.filename}</div>
            <div class="audio-tags">
                <span class="tag">🌐 ${audio.language}</span>
                <span class="tag">😊 ${audio.emotion}</span>
                <span class="tag">📦 ${formatFileSize(audio.size)}</span>
            </div>
            <audio controls style="width: 100%; margin-top: 0.5rem;">
                <source src="${API_BASE}/models/${encodeURIComponent(currentSelectedModel)}/audios/stream?relative_path=${encodeURIComponent(audio.relative_path)}" type="audio/wav">
            </audio>
            <div class="audio-controls">
                <button class="btn btn-secondary" onclick="showRenameDialog('${currentSelectedModel}', '${audio.relative_path.replace(/\\/g, '\\\\')}', '${audio.filename}')">
                    ✏️ 重命名
                </button>
                <button class="btn btn-danger" onclick="deleteAudio('${audio.relative_path}')">
                    🗑️ 删除
                </button>
            </div>
        </div>
    `).join('');
    if (window.translateDOM) window.translateDOM(container);
}

function showUploadDialog() {
    if (!currentSelectedModel) {
        showNotification('请先选择模型', 'warning');
        return;
    }
    document.getElementById('upload-dialog').style.display = 'flex';
}

async function uploadAudio() {
    const language = document.getElementById('upload-language').value;
    const emotion = document.getElementById('upload-emotion').value.trim() || 'default';
    const fileInput = document.getElementById('upload-file');
    const file = fileInput.files[0];

    if (!file) {
        showNotification('请选择音频文件', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(
            `${API_BASE}/models/${encodeURIComponent(currentSelectedModel)}/audios/upload?language=${language}&emotion=${emotion}`,
            {
                method: 'POST',
                body: formData
            }
        );

        const data = await response.json();

        if (response.ok) {
            showNotification('上传成功', 'success');
            closeDialog('upload-dialog');
            loadAudios();
        } else {
            showNotification(data.detail || '上传失败', 'error');
        }
    } catch (error) {
        console.error('上传失败:', error);
        showNotification('上传失败,请检查后端服务', 'error');
    }
}

async function deleteAudio(relativePath) {
    if (!confirm('确定要删除这个音频文件吗?\n\n⚠️ 注意:删除后无法恢复!!')) {
        return;
    }

    try {
        const response = await fetch(
            `${API_BASE}/models/${encodeURIComponent(currentSelectedModel)}/audios?relative_path=${encodeURIComponent(relativePath)}`,
            { method: 'DELETE' }
        );

        if (response.ok) {
            showNotification('删除成功', 'success');
            loadAudios();
        } else {
            const data = await response.json();
            showNotification(data.detail || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除失败:', error);
        showNotification('删除失败', 'error');
    }
}

// ==================== 页面跳转辅助函数 ====================
function goToAudioManagement(modelName) {
    switchPage('audios');
    document.getElementById('audio-model-select').value = modelName;
    loadAudios();
}


// ==================== 重命名音频 ====================
let currentRenameContext = null;

function showRenameDialog(modelName, relativePath, currentFilename) {
    currentRenameContext = { modelName, relativePath };
    document.getElementById('rename-new-filename').value = currentFilename;
    document.getElementById('rename-audio-dialog').style.display = 'flex';
}

async function confirmRename() {
    if (!currentRenameContext) return;

    const newFilename = document.getElementById('rename-new-filename').value.trim();

    if (!newFilename) {
        showNotification('请输入新文件名', 'warning');
        return;
    }

    try {
        const response = await fetch(
            `${API_BASE}/models/${encodeURIComponent(currentRenameContext.modelName)}/audios/rename?relative_path=${encodeURIComponent(currentRenameContext.relativePath)}&new_filename=${encodeURIComponent(newFilename)}`,
            { method: 'PUT' }
        );

        const data = await response.json();

        if (response.ok) {
            showNotification('重命名成功', 'success');
            closeDialog('rename-audio-dialog');
            // 刷新音频列表
            await loadAudios();
            await loadModels(); // 刷新模型列表统计
        } else {
            showNotification(data.detail || '重命名失败', 'error');
        }
    } catch (error) {
        console.error('重命名失败:', error);
        showNotification('重命名失败', 'error');
    }
}

// ==================== 批量修改情感 ====================
let currentBatchEmotionModel = null;

function showBatchEmotionDialog(modelName) {
    currentBatchEmotionModel = modelName;
    document.getElementById('batch-old-emotion').value = '';
    document.getElementById('batch-new-emotion').value = '';
    document.getElementById('batch-emotion-dialog').style.display = 'flex';
}

// 从音频管理页面调用的辅助函数
function showBatchEmotionDialogFromAudios() {
    if (!currentSelectedModel) {
        showNotification('请先选择模型', 'warning');
        return;
    }
    showBatchEmotionDialog(currentSelectedModel);
}

async function confirmBatchEmotion() {
    if (!currentBatchEmotionModel) return;

    const oldEmotion = document.getElementById('batch-old-emotion').value.trim();
    const newEmotion = document.getElementById('batch-new-emotion').value.trim();

    if (!oldEmotion || !newEmotion) {
        showNotification('请输入旧情感和新情感标签', 'warning');
        return;
    }

    try {
        const response = await fetch(
            `${API_BASE}/models/${encodeURIComponent(currentBatchEmotionModel)}/audios/batch-emotion?old_emotion=${encodeURIComponent(oldEmotion)}&new_emotion=${encodeURIComponent(newEmotion)}`,
            { method: 'POST' }
        );

        const data = await response.json();

        if (response.ok) {
            const message = `成功修改 ${data.updated_count} 个文件`;
            showNotification(message, 'success');
            closeDialog('batch-emotion-dialog');

            // 如果当前在音频管理页面且选中的是该模型,刷新音频列表
            if (currentSelectedModel === currentBatchEmotionModel) {
                await loadAudios();
            }
            await loadModels(); // 刷新模型列表统计
        } else {
            showNotification(data.detail || '批量修改失败', 'error');
        }
    } catch (error) {
        console.error('批量修改失败:', error);
        showNotification('批量修改失败', 'error');
    }
}

// ==================== 设置页 Tab 切换 ====================
function bindSettingsTabs() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // 移除所有 active
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));

            // 激活当前
            tab.classList.add('active');
            const tabId = 'settings-tab-' + tab.dataset.tab;
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// ==================== 配置管理 ====================
async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE}/settings`);
        const settings = await response.json();

        // 基础配置
        document.getElementById('setting-base-dir').value = settings.base_dir || '';
        document.getElementById('setting-cache-dir').value = settings.cache_dir || '';
        document.getElementById('setting-sovits-host').value = settings.sovits_host || 'http://127.0.0.1:9880';
        document.getElementById('setting-default-lang').value = settings.default_lang || 'Chinese';

        // ========== 分析引擎配置 ==========
        const analysis = settings.analysis_engine || {};
        document.getElementById('setting-analysis-enabled').value = String(analysis.enabled !== false);
        document.getElementById('setting-analysis-interval').value = analysis.analysis_interval || 3;
        document.getElementById('setting-analysis-threshold').value = analysis.trigger_threshold || 60;

        // 分析 LLM 配置
        const analysisLlm = analysis.llm || {};
        document.getElementById('setting-analysis-llm-api-url').value = analysisLlm.api_url || '';
        document.getElementById('setting-analysis-llm-api-key').value = analysisLlm.api_key || '';

        // 处理分析引擎模型下拉框
        const analysisModelSelect = document.getElementById('setting-analysis-llm-model');
        const savedAnalysisModel = analysisLlm.model || '';
        if (savedAnalysisModel) {
            let hasOpt = false;
            for (let i = 0; i < analysisModelSelect.options.length; i++) {
                if (analysisModelSelect.options[i].value === savedAnalysisModel) {
                    hasOpt = true;
                    break;
                }
            }
            if (!hasOpt) {
                const opt = document.createElement('option');
                opt.value = savedAnalysisModel;
                opt.textContent = savedAnalysisModel;
                analysisModelSelect.appendChild(opt);
            }
            analysisModelSelect.value = savedAnalysisModel;
        }
        document.getElementById('setting-analysis-llm-temperature').value = analysisLlm.temperature || 0.8;
        document.getElementById('setting-analysis-llm-max-tokens').value = analysisLlm.max_tokens || 5000;

        // ========== 电话功能配置 ==========
        const phoneCallEnabled = settings.phone_call?.enabled !== false;
        document.getElementById('setting-phone-call-enabled').value = String(phoneCallEnabled);

        // 电话 LLM 配置
        const llm = settings.phone_call?.llm || {};
        document.getElementById('setting-llm-api-url').value = llm.api_url || 'http://127.0.0.1:7861/v1';
        document.getElementById('setting-llm-api-key').value = llm.api_key || '';

        // 处理模型下拉框
        const modelSelect = document.getElementById('setting-llm-model');
        const savedModel = llm.model || 'gemini-2.5-flash';

        // 如果下拉框中没有这个选项,添加它
        let hasOption = false;
        for (let i = 0; i < modelSelect.options.length; i++) {
            if (modelSelect.options[i].value === savedModel) {
                hasOption = true;
                break;
            }
        }

        if (!hasOption && savedModel) {
            const option = document.createElement('option');
            option.value = savedModel;
            option.textContent = savedModel;
            modelSelect.appendChild(option);
        }

        modelSelect.value = savedModel;
        document.getElementById('setting-llm-temperature').value = llm.temperature || 0.8;
        document.getElementById('setting-llm-max-tokens').value = llm.max_tokens || 5000;

        // TTS 配置
        const tts = settings.phone_call?.tts_config || {};
        document.getElementById('setting-tts-text-lang').value = tts.text_lang || 'zh';
        document.getElementById('setting-tts-prompt-lang').value = tts.prompt_lang || 'zh';
        document.getElementById('setting-tts-text-split-method').value = tts.text_split_method || 'cut0';
        document.getElementById('setting-tts-use-aux-ref-audio').value = String(tts.use_aux_ref_audio || false);

        // 消息处理配置（共享）
        const msgProcessing = settings.message_processing || {};
        document.getElementById('setting-extract-tag').value = msgProcessing.extract_tag || '';
        document.getElementById('setting-filter-tags').value = msgProcessing.filter_tags || '';

        // 自动生成配置 - 已废弃，现由分析引擎控制
        // const autoGen = settings.phone_call?.auto_generation || {};
        // document.getElementById('setting-auto-floor-interval').value = autoGen.floor_interval || 3;
        // document.getElementById('setting-auto-start-floor').value = autoGen.start_floor || 3;
        // document.getElementById('setting-auto-max-context-messages').value = autoGen.max_context_messages || 10;
    } catch (error) {
        console.error('加载配置失败:', error);
    }
}

async function saveSettings() {
    const settings = {
        base_dir: document.getElementById('setting-base-dir').value.trim(),
        cache_dir: document.getElementById('setting-cache-dir').value.trim(),
        sovits_host: document.getElementById('setting-sovits-host').value.trim(),
        default_lang: document.getElementById('setting-default-lang').value,

        // 分析引擎配置
        analysis_engine: {
            enabled: document.getElementById('setting-analysis-enabled').value === 'true',
            analysis_interval: parseInt(document.getElementById('setting-analysis-interval').value) || 3,
            trigger_threshold: parseInt(document.getElementById('setting-analysis-threshold').value) || 60,
            llm: {
                api_url: document.getElementById('setting-analysis-llm-api-url').value.trim(),
                api_key: document.getElementById('setting-analysis-llm-api-key').value.trim(),
                model: document.getElementById('setting-analysis-llm-model').value.trim(),
                temperature: parseFloat(document.getElementById('setting-analysis-llm-temperature').value) || 0.8,
                max_tokens: parseInt(document.getElementById('setting-analysis-llm-max-tokens').value) || 5000
            }
        },

        // 消息处理配置（共享）
        message_processing: {
            extract_tag: document.getElementById('setting-extract-tag').value.trim(),
            filter_tags: document.getElementById('setting-filter-tags').value.trim()
        },

        // 电话功能配置
        phone_call: {
            enabled: document.getElementById('setting-phone-call-enabled').value === 'true',
            llm: {
                api_url: document.getElementById('setting-llm-api-url').value.trim(),
                api_key: document.getElementById('setting-llm-api-key').value.trim(),
                model: document.getElementById('setting-llm-model').value.trim(),
                temperature: parseFloat(document.getElementById('setting-llm-temperature').value) || 0.8,
                max_tokens: parseInt(document.getElementById('setting-llm-max-tokens').value) || 5000
            },
            tts_config: {
                text_lang: document.getElementById('setting-tts-text-lang').value,
                prompt_lang: document.getElementById('setting-tts-prompt-lang').value,
                text_split_method: document.getElementById('setting-tts-text-split-method').value,
                use_aux_ref_audio: document.getElementById('setting-tts-use-aux-ref-audio').value === 'true'
            }
            // auto_generation - 已废弃，现由分析引擎控制
            // auto_generation: {
            //     floor_interval: parseInt(document.getElementById('setting-auto-floor-interval').value) || 3,
            //     start_floor: parseInt(document.getElementById('setting-auto-start-floor').value) || 3,
            //     max_context_messages: parseInt(document.getElementById('setting-auto-max-context-messages').value) || 10
            // }
        }
    };

    try {
        const response = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        const data = await response.json();

        if (response.ok) {
            showNotification('配置保存成功', 'success');
        } else {
            showNotification(data.detail || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存配置失败:', error);
        showNotification('保存失败', 'error');
    }
}

// 获取 LLM 模型列表
async function fetchLLMModels(apiUrl, apiKey) {
    // 从 API URL 中提取基础 URL
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

    // 解析模型列表,兼容不同的响应格式
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

// 绑定获取模型列表按钮
function bindFetchModelsButton() {
    const btn = document.getElementById('fetch-llm-models-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const apiUrl = document.getElementById('setting-llm-api-url').value.trim();
        const apiKey = document.getElementById('setting-llm-api-key').value.trim();
        const modelSelect = document.getElementById('setting-llm-model');

        if (!apiUrl || !apiKey) {
            showNotification('请先填写 LLM API 地址和密钥', 'warning');
            return;
        }

        // 保存当前选中的值
        const currentValue = modelSelect.value;

        // 禁用按钮并显示加载状态
        btn.disabled = true;
        btn.textContent = window.t('获取中...');

        try {
            console.log('[管理面板] 开始获取模型列表...', { apiUrl, apiKey: '***' });
            const models = await fetchLLMModels(apiUrl, apiKey);
            console.log('[管理面板] 成功获取模型:', models);

            // 对模型列表进行排序
            models.sort((a, b) => a.localeCompare(b));

            // 清空并重新填充下拉框
            modelSelect.innerHTML = '<option value="">' + window.t('请选择模型...') + '</option>';
        if (window.translateDOM) window.translateDOM(modelSelect);
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });

            // 如果之前的值在新列表中,恢复选中
            if (currentValue && models.includes(currentValue)) {
                modelSelect.value = currentValue;
            } else if (models.length > 0) {
                // 否则选择第一个模型
                modelSelect.value = models[0];
            }

            showNotification(`成功获取 ${models.length} 个模型`, 'success');
        } catch (error) {
            console.error('[管理面板] 获取模型失败:', error);
            showNotification(`获取模型失败: ${error.message}`, 'error');
        } finally {
            // 恢复按钮状态
            btn.disabled = false;
            btn.textContent = window.t('🔄 获取模型列表');
        }
    });
}

// 绑定测试连接按钮
function bindTestConnectionButton() {
    const btn = document.getElementById('test-llm-connection-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const apiUrl = document.getElementById('setting-llm-api-url').value.trim();
        const apiKey = document.getElementById('setting-llm-api-key').value.trim();
        const model = document.getElementById('setting-llm-model').value.trim();
        const temperature = parseFloat(document.getElementById('setting-llm-temperature').value) || 0.8;

        if (!apiUrl || !apiKey) {
            showNotification('请先填写 LLM API 地址和密钥', 'warning');
            return;
        }

        if (!model) {
            showNotification('请先选择或输入模型名称', 'warning');
            return;
        }

        // 禁用按钮并显示加载状态
        btn.disabled = true;
        btn.textContent = window.t('测试中...');

        try {
            console.log('[管理面板] 开始测试 LLM 连接...', { apiUrl, model, apiKey: '***' });

            // 调用 LLM
            const content = await testLLMConnection(apiUrl, apiKey, model, temperature);
            console.log('[管理面板] LLM 测试成功:', content);

            showNotification(`✅ 连接成功! LLM 响应: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`, 'success');
        } catch (error) {
            console.error('[管理面板] LLM 测试失败:', error);
            showNotification(`❌ 连接失败: ${error.message}`, 'error');
        } finally {
            // 恢复按钮状态
            btn.disabled = false;
            btn.textContent = window.t('🧪 测试连接');
        }
    });
}

// 绑定分析引擎 LLM 按钮
function bindAnalysisLLMButtons() {
    // 获取模型列表按钮
    const fetchBtn = document.getElementById('fetch-analysis-models-btn');
    if (fetchBtn) {
        fetchBtn.addEventListener('click', async () => {
            const apiUrl = document.getElementById('setting-analysis-llm-api-url').value.trim();
            const apiKey = document.getElementById('setting-analysis-llm-api-key').value.trim();
            const modelSelect = document.getElementById('setting-analysis-llm-model');

            if (!apiUrl || !apiKey) {
                showNotification('请先填写分析引擎 LLM API 地址和密钥', 'warning');
                return;
            }

            const currentValue = modelSelect.value;
            fetchBtn.disabled = true;
            fetchBtn.textContent = window.t('获取中...');

            try {
                const models = await fetchLLMModels(apiUrl, apiKey);
                models.sort((a, b) => a.localeCompare(b));

                modelSelect.innerHTML = '<option value="">' + window.t('请选择模型...') + '</option>';
        if (window.translateDOM) window.translateDOM(modelSelect);
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    modelSelect.appendChild(option);
                });

                if (currentValue && models.includes(currentValue)) {
                    modelSelect.value = currentValue;
                } else if (models.length > 0) {
                    modelSelect.value = models[0];
                }

                showNotification(`成功获取 ${models.length} 个模型`, 'success');
            } catch (error) {
                showNotification(`获取模型失败: ${error.message}`, 'error');
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.textContent = window.t('🔄 获取模型列表');
            }
        });
    }

    // 测试连接按钮
    const testBtn = document.getElementById('test-analysis-llm-btn');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            const apiUrl = document.getElementById('setting-analysis-llm-api-url').value.trim();
            const apiKey = document.getElementById('setting-analysis-llm-api-key').value.trim();
            const model = document.getElementById('setting-analysis-llm-model').value.trim();
            const temperature = parseFloat(document.getElementById('setting-analysis-llm-temperature').value) || 0.8;

            if (!apiUrl || !apiKey) {
                showNotification('请先填写分析引擎 LLM API 地址和密钥', 'warning');
                return;
            }

            if (!model) {
                showNotification('请先选择分析引擎模型', 'warning');
                return;
            }

            testBtn.disabled = true;
            testBtn.textContent = window.t('测试中...');

            try {
                const content = await testLLMConnection(apiUrl, apiKey, model, temperature);
                showNotification(`✅ 连接成功! LLM 响应: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`, 'success');
            } catch (error) {
                showNotification(`❌ 连接失败: ${error.message}`, 'error');
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = window.t('🧪 测试连接');
            }
        });
    }
}

// 测试 LLM 连接
async function testLLMConnection(apiUrl, apiKey, model, temperature) {
    // 构建完整的 API URL
    let llmUrl = apiUrl.trim();
    if (!llmUrl.includes('/chat/completions')) {
        llmUrl = llmUrl.replace(/\/$/, '') + '/chat/completions';
    }

    const requestBody = {
        model: model,
        messages: [{ role: "user", content: "你好,请回复'测试成功'" }],
        temperature: temperature,
        max_tokens: 50,
        stream: false
    };

    const response = await fetch(llmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    return parseLLMResponse(data);
}

// 解析 LLM 响应
function parseLLMResponse(data) {
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


// ==================== 工具函数 ====================
function closeDialog(dialogId) {
    document.getElementById(dialogId).style.display = 'none';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function showNotification(message, type = 'info') {
    if (window.t) message = window.t(message);
    // 简单的通知实现
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#00d9ff'
    };

    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type]};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 0.5rem;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: slideIn 0.3s;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);

// ==================== 版本管理 ====================
async function checkVersion() {
    const statusEl = document.getElementById('version-status');
    const currentVersionEl = document.getElementById('current-version');
    const latestVersionEl = document.getElementById('latest-version');
    const latestVersionInfo = document.getElementById('latest-version-info');
    const updateBadge = document.getElementById('update-badge');
    const navUpdateBadge = document.getElementById('nav-update-badge');
    const updateActions = document.getElementById('update-actions');
    const gitRepoNotice = document.getElementById('git-repo-notice');

    try {
        const response = await fetch(`${API_BASE}/version/check`);
        const data = await response.json();

        if (!data.success) {
            statusEl.textContent = window.t('检测失败');
            statusEl.className = 'status-badge status-error';
            currentVersionEl.textContent = data.error || '未知错误';
            return;
        }

        // 显示当前版本
        currentVersionEl.textContent = data.current_version || '-';

        // 显示最新版本(Git 仓库和 ZIP 用户都显示)
        if (data.latest_version) {
            latestVersionEl.textContent = data.latest_version;
            latestVersionInfo.style.display = 'flex';
        }

        // 如果是 Git 仓库
        if (data.is_git_repo) {
            // 显示 Git 仓库提示
            gitRepoNotice.textContent = window.t('💡 检测到 Git 仓库,点击更新将自动执行 git pull');
            gitRepoNotice.style.display = 'block';

            // 根据是否有更新来显示状态和按钮
            if (data.has_update) {
                statusEl.textContent = window.t('有新版本');
                statusEl.className = 'status-badge status-warning';
                updateBadge.style.display = 'inline-block';
                navUpdateBadge.style.display = 'inline-block';
                updateActions.style.display = 'block';
            } else {
                statusEl.textContent = window.t('已是最新');
                statusEl.className = 'status-badge status-success';
                updateBadge.style.display = 'none';
                navUpdateBadge.style.display = 'none';
                updateActions.style.display = 'none';
            }
            return;
        }

        // ZIP 用户的显示逻辑
        // 检查是否有更新
        if (data.has_update) {
            statusEl.textContent = window.t('有新版本');
            statusEl.className = 'status-badge status-warning';
            updateBadge.style.display = 'inline-block';
            navUpdateBadge.style.display = 'inline-block';
            updateActions.style.display = 'block';
        } else {
            statusEl.textContent = window.t('已是最新');
            statusEl.className = 'status-badge status-success';
            updateBadge.style.display = 'none';
            navUpdateBadge.style.display = 'none';
            updateActions.style.display = 'none';
        }

    } catch (error) {
        console.error('检查版本失败:', error);
        statusEl.textContent = window.t('检测失败');
        statusEl.className = 'status-badge status-error';
        currentVersionEl.textContent = window.t('网络错误');
    }
}

async function performUpdate() {
    const updateBtn = document.getElementById('update-btn');
    const updateProgress = document.getElementById('update-progress');
    const progressBar = document.getElementById('version-progress-bar');
    const progressText = document.getElementById('version-progress-text');
    const updateActions = document.getElementById('update-actions');

    if (!confirm('确定要更新到最新版本吗?\n\n更新过程中请勿关闭浏览器或服务器。\n您的配置和数据将被保留。')) {
        return;
    }

    try {
        // 禁用按钮,显示进度
        updateBtn.disabled = true;
        updateActions.style.display = 'none';
        updateProgress.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = window.t('正在准备更新...');

        // 模拟进度(因为后端更新是同步的)
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 5;
            if (progress <= 90) {
                progressBar.style.width = progress + '%';
            }
        }, 500);

        // 调用更新 API
        const response = await fetch(`${API_BASE}/version/update`, {
            method: 'POST'
        });

        clearInterval(progressInterval);

        const data = await response.json();

        if (response.ok && data.success) {
            progressBar.style.width = '100%';
            progressText.textContent = window.t('更新完成!');

            // 检查是否需要重启
            if (data.should_restart) {
                showNotification('更新成功!即将自动重启服务...', 'success');

                // 倒计时重启
                let countdown = 3;
                const countdownInterval = setInterval(() => {
                    progressText.textContent = window.t(`${countdown} 秒后自动重启服务...`);
                    countdown--;

                    if (countdown < 0) {
                        clearInterval(countdownInterval);
                        progressText.textContent = window.t('正在重启服务...');

                        // 调用重启 API
                        fetch(`${API_BASE}/restart`, { method: 'POST' })
                            .then(() => {
                                progressText.textContent = window.t('服务正在重启,5秒后刷新页面...');
                                // 等待服务重启,然后刷新页面
                                setTimeout(() => {
                                    window.location.reload();
                                }, 5000);
                            })
                            .catch(err => {
                                console.error('重启请求失败:', err);
                                // 即使重启请求失败,也尝试刷新页面
                                setTimeout(() => {
                                    window.location.reload();
                                }, 3000);
                            });
                    }
                }, 1000);
            } else {
                // 不需要重启(例如已经是最新版本)
                showNotification(data.message || '更新完成!', 'success');
                setTimeout(() => {
                    updateBtn.disabled = false;
                    updateProgress.style.display = 'none';
                    updateActions.style.display = 'block';
                    checkVersion(); // 重新检查版本
                }, 2000);
            }

        } else {
            throw new Error(data.error || data.detail || '更新失败');
        }

    } catch (error) {
        console.error('更新失败:', error);
        showNotification(`更新失败: ${error.message}`, 'error');

        // 重置UI
        updateBtn.disabled = false;
        updateProgress.style.display = 'none';
        updateActions.style.display = 'block';
    }
}


// ==================== GPT-SoVITS 配置管理 ====================


// 加载 GPT-SoVITS 配置
async function loadSovitsConfig() {
    try {
        const response = await fetch('/api/sovits/config');
        if (!response.ok) return;

        const data = await response.json();
        const config = data.config;

        if (config.install_path) {
            document.getElementById('sovits-install-path').value = config.install_path;
        }

        if (config.version_type) {
            const radio = document.querySelector(`input[name="gpu-type"][value="${config.version_type}"]`);
            if (radio) radio.checked = true;
        }

        document.getElementById('sovits-auto-start').checked = config.auto_start !== false;

        // 更新状态徽章
        const statusBadge = document.getElementById('sovits-install-status');
        if (config.installed && config.install_path) {
            statusBadge.textContent = window.t('已配置');
            statusBadge.className = 'status-badge status-success';
        } else {
            statusBadge.textContent = window.t('未配置');
            statusBadge.className = 'status-badge status-warning';
        }
    } catch (error) {
        console.error('加载 GPT-SoVITS 配置失败:', error);
    }
}

// 保存 GPT-SoVITS 配置
async function saveSovitsConfig() {
    const config = {
        installed: true,
        version_type: document.querySelector('input[name="gpu-type"]:checked').value,
        install_path: document.getElementById('sovits-install-path').value.trim(),
        auto_start: document.getElementById('sovits-auto-start').checked,
        api_port: 9880
    };

    if (!config.install_path) {
        showNotification('请填写 GPT-SoVITS 安装路径', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/sovits/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const data = await response.json();

        if (response.ok) {
            showNotification('GPT-SoVITS 配置已保存', 'success');
            loadSovitsConfig(); // 刷新状态
        } else {
            showNotification(data.detail || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存配置失败:', error);
        showNotification('保存配置失败', 'error');
    }
}

// 解压 GPT-SoVITS 压缩包
async function extractSovitsPackage() {
    const archivePath = document.getElementById('sovits-archive-path').value.trim();
    const extractTo = document.getElementById('sovits-extract-to').value.trim();

    if (!archivePath) {
        showNotification('请填写压缩包路径', 'warning');
        return;
    }

    if (!extractTo) {
        showNotification('请填写解压目标目录', 'warning');
        return;
    }

    const progressDiv = document.getElementById('extract-progress');
    const progressBar = document.getElementById('extract-progress-bar');
    const progressText = document.getElementById('extract-progress-text');

    progressDiv.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = window.t('正在解压，请稍候（文件较大，可能需要几分钟）...');

    try {
        const response = await fetch('/api/sovits/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                archive_path: archivePath,
                extract_to: extractTo,
                delete_after: true
            })
        });

        const data = await response.json();

        if (response.ok) {
            progressBar.style.width = '100%';
            progressText.textContent = window.t(`解压完成！路径: ${data.extracted_path}`);

            // 自动填充安装路径
            document.getElementById('sovits-install-path').value = data.extracted_path;

            showNotification('解压完成！已自动填充安装路径', 'success');

            // 切换到手动模式显示路径
            document.querySelector('input[name="install-mode"][value="manual"]').checked = true;
            toggleInstallMode();
        } else {
            progressText.textContent = window.t('解压失败');
            showNotification(data.detail || '解压失败', 'error');
        }
    } catch (error) {
        console.error('解压失败:', error);
        progressText.textContent = window.t('解压失败');
        showNotification('解压失败，请检查路径是否正确', 'error');
    }
}

// 启动 GPT-SoVITS 服务
async function startSovitsService() {
    showNotification('正在启动 GPT-SoVITS 服务...', 'info');

    try {
        const response = await fetch('/api/sovits/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showNotification(`GPT-SoVITS 服务已启动 (PID: ${data.pid})`, 'success');
            // 刷新仪表盘状态
            loadDashboard();
            loadSovitsStatus();
        } else {
            showNotification(data.detail || data.message || '启动失败', 'error');
        }
    } catch (error) {
        console.error('启动服务失败:', error);
        showNotification('启动服务失败', 'error');
    }
}

// 停止 GPT-SoVITS 服务
async function stopSovitsService() {
    showNotification('正在停止 GPT-SoVITS 服务...', 'info');

    try {
        const response = await fetch('/api/sovits/stop', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('GPT-SoVITS 服务已停止', 'success');
            // 刷新状态
            loadDashboard();
            loadSovitsStatus();
        } else {
            showNotification(data.message || '停止失败', 'warning');
        }
    } catch (error) {
        console.error('停止服务失败:', error);
        showNotification('停止服务失败', 'error');
    }
}

// 测试 GPT-SoVITS 连接
async function testSovitsConnection() {
    showNotification('正在测试连接...', 'info');

    try {
        const response = await fetch('/api/sovits/test', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`连接成功！端口: ${data.port}`, 'success');
        } else {
            showNotification(data.message || '连接失败', 'error');
        }
    } catch (error) {
        console.error('测试连接失败:', error);
        showNotification('测试连接失败', 'error');
    }
}

// 加载 GPT-SoVITS 服务状态
async function loadSovitsStatus() {
    try {
        const response = await fetch('/api/sovits/status');
        if (!response.ok) return;

        const status = await response.json();

        // 更新安装状态徽章
        const statusBadge = document.getElementById('sovits-install-status');
        if (status.api_reachable) {
            statusBadge.textContent = window.t('运行中');
            statusBadge.className = 'status-badge status-success';
        } else if (status.installed && status.install_path) {
            statusBadge.textContent = window.t('已配置');
            statusBadge.className = 'status-badge status-warning';
        } else {
            statusBadge.textContent = window.t('未配置');
            statusBadge.className = 'status-badge';
        }
    } catch (error) {
        console.error('加载 GPT-SoVITS 状态失败:', error);
    }
}

// 页面加载时也加载 GPT-SoVITS 配置
document.addEventListener('DOMContentLoaded', () => {
    // 延迟加载，确保其他初始化完成
    setTimeout(() => {
        loadSovitsConfig();
        loadSovitsStatus();
    }, 500);
});
