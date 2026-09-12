/**
 * 仙途凌霄 (immortal_sword) - UI 与 DOM 管理器
 */

import { ThemeState, DRAG_THRESHOLD } from './state.js';
import { IMMORTAL_SWORD_TRIGGER_SVG, IMMORTAL_SCROLL_FRAME_SVG } from './assets.js';

const THEME_ID = 'immortal_sword';
const CSS_ID = 'tts-theme-css-immortal_sword';

export function ensureCSS() {
    if ($(`#${CSS_ID}`).length === 0) {
        const link = document.createElement('link');
        link.id = CSS_ID;
        link.rel = 'stylesheet';
        link.href = `/scripts/extensions/third-party/st-direct-tts/frontend/css/themes/${THEME_ID}.css`;
        document.head.appendChild(link);
    }
}

export function renderTriggerDOM() {
    if ($('#tts-immortal-trigger').length > 0) return;

    // 1. 注入混元太极剑印3D悬浮球
    const triggerHtml = `
        <div id="tts-immortal-trigger" class="immortal-sword-trigger" style="position:fixed; z-index:9999; cursor:pointer;" title="混元道印 · 太极剑阵">
            <div class="immortal-inner" id="immortalInner">
                <div class="immortal-glow"></div>
                <div class="immortal-aura"></div>
                ${IMMORTAL_SWORD_TRIGGER_SVG}
                <div class="immortal-shadow"></div>
            </div>
        </div>
    `;
    $('body').append(triggerHtml);

    // 3. 注入古风天机卷轴长卷模态框
    if ($('#tts-immortal-modal').length === 0) {
        const modalHtml = `
            <div id="tts-immortal-modal" style="display:none;">
                ${IMMORTAL_SCROLL_FRAME_SVG}
                <div id="tts-immortal-scene-content"></div>
                <div class="immortal-close-btn" id="tts-immortal-close-btn" title="收起秘卷">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </div>
            </div>
        `;
        $('body').append(modalHtml);

        $('#tts-immortal-close-btn').on('click', () => {
            if (ThemeState.engine) ThemeState.engine.close();
        });
    }

    // 初始位置设置与视口安全校准
    fixTriggerPosition();
}

export function fixTriggerPosition() {
    const $trigger = $('#tts-immortal-trigger');
    if (!$trigger.length) return;

    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    // 优先读取当前主题或通用坐标，再回退到默认右下角
    const rawLeft = localStorage.getItem('tts_immortal_trigger_left') || localStorage.getItem('tts_common_trigger_left') || localStorage.getItem('tts_sakura_trigger_left') || localStorage.getItem('tts_cyber_trigger_left');
    const rawTop = localStorage.getItem('tts_immortal_trigger_top') || localStorage.getItem('tts_common_trigger_top') || localStorage.getItem('tts_sakura_trigger_top') || localStorage.getItem('tts_cyber_trigger_top');

    let left = parseFloat(rawLeft);
    let top = parseFloat(rawTop);

    // 严谨校验与视口越界修复 (防止缩放后溢出屏幕)
    if (isNaN(left) || left < 5 || left > vw - 70) {
        left = Math.max(5, vw - 75);
    }
    if (isNaN(top) || top < 5 || top > vh - 70) {
        top = Math.max(5, vh - 140);
    }

    $trigger.css({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 9999,
        display: 'flex'
    });
}

export function fixModalPosition() {
    const $modal = $('#tts-immortal-modal');
    if (!$modal.length) return;

    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    const modalW = Math.min(380, vw * 0.94);
    const modalH = Math.min(640, vh - 24);
    const top = (window.visualViewport ? window.visualViewport.pageTop : 0) + Math.max(12, (vh - modalH) / 2);
    const left = (window.visualViewport ? window.visualViewport.pageLeft : 0) + (vw - modalW) / 2;

    $modal.css({
        top: `${top}px`,
        left: `${left}px`,
        width: `${modalW}px`,
        height: `${modalH}px`,
        transform: 'none'
    });
}

export function bindDragAndClick() {
    const $trigger = $('#tts-immortal-trigger');
    if (!$trigger.length) return;

    // 确保定位正确
    fixTriggerPosition();

    $trigger.off('pointerdown pointermove pointerup pointercancel click');

    let suppressNativeClick = false;
    const triggerClick = function () {
        const now = Date.now();
        if (now - (ThemeState.drag.lastTapTime || 0) < 350) return;
        ThemeState.drag.lastTapTime = now;

        if (ThemeState.particleEngine) {
            ThemeState.particleEngine.burstParticles(8, 'jade');
        }
        if (ThemeState.engine) {
            ThemeState.engine.toggle();
        }
    };

    $trigger.on('pointerdown', function (e) {
        e = e.originalEvent || e;
        if (e.button !== undefined && e.button !== 0) return;
        suppressNativeClick = false;
        if (e.isPrimary === false) return;

        ThemeState.drag.isDragging = true;
        ThemeState.drag.hasMoved = false;
        ThemeState.drag.startX = e.clientX;
        ThemeState.drag.startY = e.clientY;
        ThemeState.drag.startTime = Date.now();

        const offset = $trigger.offset();
        ThemeState.drag.initialLeft = offset ? offset.left : 0;
        ThemeState.drag.initialTop = offset ? offset.top : 0;

        if ($trigger[0].setPointerCapture && e.pointerId) {
            try { $trigger[0].setPointerCapture(e.pointerId); } catch (_) {}
        }
    });

    $trigger.on('pointermove', function (e) {
        e = e.originalEvent || e;
        if (!ThemeState.drag.isDragging) return;
        const dx = e.clientX - ThemeState.drag.startX;
        const dy = e.clientY - ThemeState.drag.startY;
        const moveDist = Math.hypot(dx, dy);

        if (!ThemeState.drag.hasMoved) {
            if (moveDist < DRAG_THRESHOLD) return;
            ThemeState.drag.hasMoved = true;
        }

        let newLeft = ThemeState.drag.initialLeft + dx;
        let newTop = ThemeState.drag.initialTop + dy;

        const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;

        newLeft = Math.max(5, Math.min(vw - 75, newLeft));
        newTop = Math.max(5, Math.min(vh - 75, newTop));

        $trigger.css({ left: `${newLeft}px`, top: `${newTop}px` });
    });

    const endDrag = function (e) {
        e = e.originalEvent || e;
        if (!ThemeState.drag.isDragging) return;
        ThemeState.drag.isDragging = false;
        suppressNativeClick = true;

        const dx = (e.clientX !== undefined ? e.clientX : ThemeState.drag.startX) - ThemeState.drag.startX;
        const dy = (e.clientY !== undefined ? e.clientY : ThemeState.drag.startY) - ThemeState.drag.startY;
        const moveDist = Math.hypot(dx, dy);

        if ($trigger[0].releasePointerCapture && e.pointerId) {
            try { $trigger[0].releasePointerCapture(e.pointerId); } catch (_) {}
        }

        if (e.type !== 'pointercancel' && !ThemeState.drag.hasMoved && moveDist < DRAG_THRESHOLD) {
            triggerClick();
        } else {
            const currentLeft = parseFloat($trigger.css('left'));
            const currentTop = parseFloat($trigger.css('top'));
            if (!isNaN(currentLeft) && !isNaN(currentTop)) {
                localStorage.setItem('tts_immortal_trigger_left', `${currentLeft}px`);
                localStorage.setItem('tts_immortal_trigger_top', `${currentTop}px`);
                localStorage.setItem('tts_common_trigger_left', `${currentLeft}px`);
                localStorage.setItem('tts_common_trigger_top', `${currentTop}px`);
            }
        }
    };

    $trigger.on('pointerup pointercancel', endDrag);

    $trigger.on('click', function () {
        if (suppressNativeClick) { suppressNativeClick = false; return; }
        if (!ThemeState.drag.hasMoved) {
            triggerClick();
        }
    });
}

export function destroyDOM() {
    $('#tts-immortal-trigger, #immortalParticleCanvas, #tts-immortal-modal, #immortal-fullscreen-call, #immortal-fullscreen-eavesdrop').remove();
    $(`#${CSS_ID}`).remove();
}
