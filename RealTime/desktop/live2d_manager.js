/**
 * Live2D manager backed by local Pixi + pixi-live2d-display bundles.
 *
 * Goals:
 * 1. Render into an explicit container instead of letting a wrapper own the page.
 * 2. Auto-fit every model to the current viewport.
 * 3. Re-fit after resize and model switching.
 * 4. Keep a small API surface for the existing window code.
 */

const LIVE2D_MODELS = [
    {
        name: 'Senko',
        path: 'models/Senko_Normals/senko.model3.json',
        lipSyncParam: 'ParamMouthOpenY',
        fit: { scaleMultiplier: 0.92, offsetY: 4 },
    },
    {
        name: 'Shizuku',
        path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models/models/shizuku/shizuku.model.json',
        lipSyncParam: 'PARAM_MOUTH_OPEN_Y',
        fit: { scaleMultiplier: 0.9 },
    },
    {
        name: 'HK416',
        path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models/models/HK416-1-normal/model.json',
        lipSyncParam: 'PARAM_MOUTH_OPEN_Y',
        fit: { scaleMultiplier: 0.9, offsetX: 8 },
    },
    {
        name: 'Pio',
        path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models/models/Pio/model.json',
        lipSyncParam: 'PARAM_MOUTH_OPEN_Y',
        fit: { scaleMultiplier: 0.86 },
    },
    {
        name: 'Koharu',
        path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models/models/koharu/koharu.model.json',
        lipSyncParam: 'PARAM_MOUTH_OPEN_Y',
        fit: { scaleMultiplier: 0.9 },
    },
    {
        name: 'Haruto',
        path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models/models/haruto/haruto.model.json',
        lipSyncParam: 'PARAM_MOUTH_OPEN_Y',
        fit: { scaleMultiplier: 0.9 },
    },
    {
        name: 'Bilibili-22',
        path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models/models/bilibili-22/index.json',
        lipSyncParam: 'PARAM_MOUTH_OPEN_Y',
        fit: { scaleMultiplier: 0.88 },
    },
    {
        name: 'Bilibili-33',
        path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models/models/bilibili-33/index.json',
        lipSyncParam: 'PARAM_MOUTH_OPEN_Y',
        fit: { scaleMultiplier: 0.88 },
    },
];

class Live2DManager {
    constructor() {
        this._app = null;
        this._containerEl = null;
        this._statusEl = null;
        this._currentModelInstance = null;
        this._currentIndex = 0;
        this._lipSyncRAF = null;
        this._lipSyncActive = false;
        this._lipSyncIdleTimer = null;
        this._pendingLoadId = 0;
        this._resizeObserver = null;
        this._resizeBound = this._onResize.bind(this);
    }

    get models() {
        return LIVE2D_MODELS;
    }

    get currentIndex() {
        return this._currentIndex;
    }

    get currentModel() {
        return LIVE2D_MODELS[this._currentIndex] || null;
    }

    async init(containerEl, modelIndex = 0) {
        if (!window.PIXI?.Application) {
            console.warn('[Live2D] PIXI 未加载，跳过初始化');
            return false;
        }

        if (!window.PIXI?.live2d?.Live2DModel) {
            console.warn('[Live2D] pixi-live2d-display 未加载，跳过初始化');
            return false;
        }

        this._containerEl = containerEl || document.getElementById('live2d-stage');
        this._statusEl = document.getElementById('live2d-status');

        if (!this._containerEl) {
            console.error('[Live2D] 缺少渲染容器');
            return false;
        }

        const model = LIVE2D_MODELS[modelIndex];
        if (!model) {
            console.error('[Live2D] 无效的模型索引:', modelIndex);
            return false;
        }

        this._currentIndex = modelIndex;

        try {
            this._app = new window.PIXI.Application({
                autoStart: true,
                autoDensity: true,
                antialias: true,
                transparent: true,
                backgroundAlpha: 0,
                resizeTo: this._containerEl,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
            });

            this._app.view.classList.add('live2d-canvas');
            this._containerEl.appendChild(this._app.view);

            window.addEventListener('resize', this._resizeBound);
            if ('ResizeObserver' in window) {
                this._resizeObserver = new ResizeObserver(() => this._onResize());
                this._resizeObserver.observe(this._containerEl);
            }

            const ok = await this._loadModel(modelIndex);
            if (ok) {
                console.log(`[Live2D] init ok - ${model.name}`);
            }
            return ok;
        } catch (error) {
            console.error('[Live2D] 初始化失败:', error);
            this._showStatus('初始化失败');
            return false;
        }
    }

    async switchModel(index) {
        if (!this._app) return false;
        if (index < 0 || index >= LIVE2D_MODELS.length) return false;
        return this._loadModel(index);
    }

    startLipSync(analyserNode) {
        this._lipSyncActive = true;
        this._refreshLipSyncTimeout();
        if (this._lipSyncRAF || !analyserNode) return;

        const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        const update = () => {
            this._lipSyncRAF = requestAnimationFrame(update);
            if (!this._currentModelInstance) return;

            analyserNode.getByteFrequencyData(dataArray);

            let sum = 0;
            const count = Math.min(16, dataArray.length);
            for (let i = 0; i < count; i++) sum += dataArray[i];

            const volume = Math.min(1, (sum / count) / 180);
            this._setMouthOpen(volume * 1.4);
        };

        update();
    }

    stopLipSync() {
        this._lipSyncActive = false;
        if (this._lipSyncRAF) {
            cancelAnimationFrame(this._lipSyncRAF);
            this._lipSyncRAF = null;
        }
        if (this._lipSyncIdleTimer) {
            clearTimeout(this._lipSyncIdleTimer);
            this._lipSyncIdleTimer = null;
        }
        this._setMouthOpen(0);
    }

    beginRemoteLipSync() {
        this._lipSyncActive = true;
        this._refreshLipSyncTimeout();
    }

    applyLipSyncValue(value) {
        this._lipSyncActive = true;
        this._refreshLipSyncTimeout();
        this._setMouthOpen(value);
    }

    destroy() {
        this.stopLipSync();
        window.removeEventListener('resize', this._resizeBound);
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._disposeCurrentModel();

        if (this._app) {
            this._app.destroy(true, {
                children: true,
                texture: false,
                baseTexture: false,
            });
            this._app = null;
        }
    }

    async _loadModel(index) {
        const profile = LIVE2D_MODELS[index];
        if (!profile || !this._app) return false;

        const loadId = ++this._pendingLoadId;
        this._currentIndex = index;
        this.stopLipSync();
        this._showStatus(`加载 ${profile.name}...`);

        try {
            const Live2DModel = window.PIXI.live2d.Live2DModel;
            const model = await Live2DModel.from(profile.path, {
                autoInteract: false,
                motionPreload: 'IDLE',
            });

            if (loadId !== this._pendingLoadId) {
                model.destroy();
                return false;
            }

            this._disposeCurrentModel();
            this._currentModelInstance = model;
            model.eventMode = 'none';
            model.interactive = false;
            this._app.stage.addChild(model);
            this._fitModel(model, profile.fit);

            requestAnimationFrame(() => {
                if (this._currentModelInstance === model) {
                    this._fitModel(model, profile.fit);
                }
            });

            this._hideStatus();
            console.log(`[Live2D] switched to ${profile.name}`);
            return true;
        } catch (error) {
            console.error(`[Live2D] 加载模型失败: ${profile.name}`, error);
            if (loadId === this._pendingLoadId) {
                this._showStatus(`加载失败: ${profile.name}`);
            }
            return false;
        }
    }

    _fitModel(model, fitOptions = {}) {
        if (!this._containerEl || !model) return;

        const rect = this._containerEl.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const bounds = model.getLocalBounds();
        if (!bounds.width || !bounds.height) return;

        const sidePadding = fitOptions.sidePadding ?? 18;
        const topPadding = fitOptions.topPadding ?? 18;
        const bottomPadding = fitOptions.bottomPadding ?? 8;
        const usableWidth = Math.max(1, rect.width - sidePadding * 2);
        const usableHeight = Math.max(1, rect.height - topPadding - bottomPadding);
        const fitScale = Math.min(usableWidth / bounds.width, usableHeight / bounds.height);
        const scaleMultiplier = fitOptions.scaleMultiplier ?? 0.9;
        const scale = fitScale * scaleMultiplier;

        model.scale.set(scale);
        model.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height);
        model.position.set(
            rect.width / 2 + (fitOptions.offsetX || 0),
            rect.height - bottomPadding + (fitOptions.offsetY || 0)
        );
    }

    _onResize() {
        if (!this._app || !this._containerEl) return;
        const width = Math.max(1, Math.round(this._containerEl.clientWidth));
        const height = Math.max(1, Math.round(this._containerEl.clientHeight));
        this._app.renderer.resize(width, height);

        if (this._currentModelInstance) {
            this._fitModel(this._currentModelInstance, this.currentModel?.fit);
        }
    }

    _disposeCurrentModel() {
        if (!this._currentModelInstance) return;
        if (this._currentModelInstance.parent) {
            this._currentModelInstance.parent.removeChild(this._currentModelInstance);
        }
        this._currentModelInstance.destroy();
        this._currentModelInstance = null;
    }

    _setMouthOpen(value) {
        try {
            const core = this._currentModelInstance?.internalModel?.coreModel;
            if (!core) return;

            const param = this.currentModel?.lipSyncParam || 'ParamMouthOpenY';
            if (typeof core.setParameterValueById === 'function') {
                core.setParameterValueById(param, value);
            } else if (typeof core.setParamFloat === 'function') {
                core.setParamFloat(param, value);
            }
        } catch (error) {
            // model may still be switching
        }
    }

    _refreshLipSyncTimeout() {
        if (this._lipSyncIdleTimer) {
            clearTimeout(this._lipSyncIdleTimer);
        }

        this._lipSyncIdleTimer = setTimeout(() => {
            this._lipSyncIdleTimer = null;
            if (!this._lipSyncActive) return;
            this._lipSyncActive = false;
            this._setMouthOpen(0);
        }, 180);
    }

    _showStatus(text) {
        if (!this._statusEl) return;
        this._statusEl.textContent = text;
        this._statusEl.classList.add('visible');
    }

    _hideStatus() {
        this._statusEl?.classList.remove('visible');
    }
}
