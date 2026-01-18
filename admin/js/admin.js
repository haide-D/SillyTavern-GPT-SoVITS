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
                statusEl.textContent = '运行中';
                statusEl.className = 'status-badge status-success';
                document.getElementById('sovits-state').textContent = '可访问';
            } else {
                statusEl.textContent = '未运行';
                statusEl.className = 'status-badge status-error';
                document.getElementById('sovits-state').textContent = sovits.error || '无法连接';
            }
            document.getElementById('sovits-url').textContent = sovits.url;
        }
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
                <button class="btn btn-secondary" onclick="toggleModelAudios('${model.name}')" id="toggle-btn-${model.name}">
                    🎵 查看音频 (${model.audio_stats.total || 0})
                </button>
                <button class="btn btn-primary" onclick="showBatchEmotionDialog('${model.name}')">
                    🏷️ 批量修改情感
                </button>
            </div>
            <div id="model-audios-${model.name}" class="model-audios-list" style="display: none; margin-top: 1rem;">
                <p class="loading">加载中...</p>
            </div>
        </div>
    `).join('');
}

function showCreateModelDialog() {
    document.getElementById('create-model-dialog').style.display = 'flex';
    document.getElementById('new-model-name').value = '';
}

async function createModel() {
    const name = document.getElementById('new-model-name').value.trim();

    if (!name) {
        showNotification('请输入模型名称', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/models/create?model_name=${encodeURIComponent(name)}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok) {
            showNotification(`模型 "${name}" 创建成功`, 'success');
            closeDialog('create-model-dialog');
            loadModels();
        } else {
            showNotification(data.detail || '创建失败', 'error');
        }
    } catch (error) {
        console.error('创建模型失败:', error);
        showNotification('创建失败,请检查后端服务', 'error');
    }
}

// ==================== 音频管理 ====================
function populateModelSelect() {
    const select = document.getElementById('audio-model-select');
    select.innerHTML = '<option value="">选择模型...</option>' +
        currentModels.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
}

async function loadAudios() {
    const modelName = document.getElementById('audio-model-select').value;
    const uploadBtn = document.getElementById('upload-btn');
    const container = document.getElementById('audios-list');

    if (!modelName) {
        container.innerHTML = '<p class="placeholder">请先选择一个模型</p>';
        uploadBtn.disabled = true;
        return;
    }

    currentSelectedModel = modelName;
    uploadBtn.disabled = false;

    try {
        const response = await fetch(`${API_BASE}/models/${encodeURIComponent(modelName)}/audios`);
        const data = await response.json();

        renderAudios(data.audios || []);
    } catch (error) {
        console.error('加载音频失败:', error);
        container.innerHTML = '<p class="placeholder">加载失败</p>';
    }
}

function renderAudios(audios) {
    const container = document.getElementById('audios-list');

    if (audios.length === 0) {
        container.innerHTML = '<p class="placeholder">该模型暂无参考音频</p>';
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
                <source src="file:///${audio.path}" type="audio/wav">
            </audio>
            <div class="audio-controls">
                <button class="btn btn-danger" onclick="deleteAudio('${audio.relative_path}')">🗑️ 删除</button>
            </div>
        </div>
    `).join('');
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
    if (!confirm('确定要删除这个音频文件吗?')) {
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

// ==================== 模型音频展开/收起 ====================
const expandedModels = new Set();

async function toggleModelAudios(modelName) {
    const container = document.getElementById(`model-audios-${modelName}`);
    const toggleBtn = document.getElementById(`toggle-btn-${modelName}`);

    if (expandedModels.has(modelName)) {
        // 收起
        container.style.display = 'none';
        expandedModels.delete(modelName);
        toggleBtn.textContent = `🎵 查看音频 (${toggleBtn.textContent.match(/\d+/)[0]})`;
    } else {
        // 展开并加载
        container.style.display = 'block';
        expandedModels.add(modelName);
        toggleBtn.textContent = `🔽 收起音频`;

        await loadModelAudios(modelName);
    }
}

async function loadModelAudios(modelName) {
    const container = document.getElementById(`model-audios-${modelName}`);
    container.innerHTML = '<p class="loading">加载中...</p>';

    try {
        const response = await fetch(`${API_BASE}/models/${encodeURIComponent(modelName)}/audios`);
        const data = await response.json();

        renderModelAudios(modelName, data.audios || []);
    } catch (error) {
        console.error('加载音频失败:', error);
        container.innerHTML = '<p class="placeholder">加载失败</p>';
    }
}

function renderModelAudios(modelName, audios) {
    const container = document.getElementById(`model-audios-${modelName}`);

    if (audios.length === 0) {
        container.innerHTML = '<p class="placeholder">该模型暂无参考音频</p>';
        return;
    }

    container.innerHTML = `
        <div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 0.5rem;">
            ${audios.map(audio => `
                <div class="audio-card" style="margin-bottom: 0.75rem; background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 0.375rem;">
                    <div class="filename" style="font-weight: bold; margin-bottom: 0.5rem;">${audio.filename}</div>
                    <div class="audio-tags" style="margin-bottom: 0.5rem;">
                        <span class="tag">🌐 ${audio.language}</span>
                        <span class="tag">😊 ${audio.emotion}</span>
                        <span class="tag">📦 ${formatFileSize(audio.size)}</span>
                    </div>
                    <div class="audio-controls" style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-secondary" onclick="showRenameDialog('${modelName}', '${audio.relative_path.replace(/\\/g, '\\\\')}', '${audio.filename}')">
                            ✏️ 重命名
                        </button>
                        <button class="btn btn-danger" onclick="deleteModelAudio('${modelName}', '${audio.relative_path.replace(/\\/g, '\\\\')}')">
                            🗑️ 删除
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

async function deleteModelAudio(modelName, relativePath) {
    if (!confirm('确定要删除这个音频文件吗?')) {
        return;
    }

    try {
        const response = await fetch(
            `${API_BASE}/models/${encodeURIComponent(modelName)}/audios?relative_path=${encodeURIComponent(relativePath)}`,
            { method: 'DELETE' }
        );

        if (response.ok) {
            showNotification('删除成功', 'success');
            await loadModelAudios(modelName);
            await loadModels(); // 刷新模型列表以更新统计
        } else {
            const data = await response.json();
            showNotification(data.detail || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除失败:', error);
        showNotification('删除失败', 'error');
    }
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
            await loadModelAudios(currentRenameContext.modelName);
            await loadModels(); // 刷新模型列表
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

            // 如果该模型已展开,刷新音频列表
            if (expandedModels.has(currentBatchEmotionModel)) {
                await loadModelAudios(currentBatchEmotionModel);
            }
            await loadModels(); // 刷新模型列表
        } else {
            showNotification(data.detail || '批量修改失败', 'error');
        }
    } catch (error) {
        console.error('批量修改失败:', error);
        showNotification('批量修改失败', 'error');
    }
}

// ==================== 配置管理 ====================
async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE}/settings`);
        const settings = await response.json();

        document.getElementById('setting-base-dir').value = settings.base_dir || '';
        document.getElementById('setting-cache-dir').value = settings.cache_dir || '';
        document.getElementById('setting-sovits-host').value = settings.sovits_host || 'http://127.0.0.1:9880';
        document.getElementById('setting-default-lang').value = settings.default_lang || 'Chinese';
        document.getElementById('setting-bubble-style').value = settings.bubble_style || 'default';
        document.getElementById('setting-auto-generate').checked = settings.auto_generate || false;
        document.getElementById('setting-iframe-mode').checked = settings.iframe_mode || false;
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
        bubble_style: document.getElementById('setting-bubble-style').value,
        auto_generate: document.getElementById('setting-auto-generate').checked,
        iframe_mode: document.getElementById('setting-iframe-mode').checked
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
