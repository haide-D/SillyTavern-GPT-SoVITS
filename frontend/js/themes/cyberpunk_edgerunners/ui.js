/**
 * 夜之城·边缘行者 (cyberpunk_edgerunners) - UI 与 DOM 管理器
 */

import { ThemeState, DRAG_THRESHOLD } from './state.js';
import { CYBERPUNK_TRIGGER_SVG, CYBERPUNK_HUD_FRAME_SVG, CYBER_ICONS } from './assets.js';

const THEME_ID = 'cyberpunk_edgerunners';
const CSS_ID = 'tts-theme-css-cyberpunk_edgerunners';

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
    if ($('#tts-cyber-trigger').length > 0) return;

    // 1. 注入纯粹赛博朋克字母 V 悬浮入口
    const triggerHtml = `
        <div id="tts-cyber-trigger" class="cyber-edgerunners-trigger" style="position:fixed; z-index:9999; cursor:pointer;" title="夜之城 · 边缘行者 (V)">
            <div class="cyber-inner" id="cyberInner">
                <div class="cyber-status-ring" id="cyberStatusRing"></div>
                ${CYBERPUNK_TRIGGER_SVG}
            </div>
        </div>
    `;
    $('body').append(triggerHtml);

    // 2. 注入全屏赛博黑客终端模态层 (Full-Screen Cyber Terminal - 纯净无模糊)
    if ($('#tts-cyber-modal').length === 0) {
        const modalHtml = `
            <div id="tts-cyber-modal" class="cyber-terminal-modal" style="display:none;">
                <div id="tts-cyber-scene-content"></div>
            </div>
        `;
        $('body').append(modalHtml);
    }

    // 初始位置设置与视口安全校准
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const rawLeft = localStorage.getItem('tts_cyber_trigger_left') || localStorage.getItem('tts_common_trigger_left') || localStorage.getItem('tts_immortal_trigger_left') || localStorage.getItem('tts_sakura_trigger_left');
    const rawTop = localStorage.getItem('tts_cyber_trigger_top') || localStorage.getItem('tts_common_trigger_top') || localStorage.getItem('tts_immortal_trigger_top') || localStorage.getItem('tts_sakura_trigger_top');

    let left = parseFloat(rawLeft);
    let top = parseFloat(rawTop);
    if (isNaN(left) || left < 5 || left > vw - 70) left = Math.max(5, vw - 75);
    if (isNaN(top) || top < 5 || top > vh - 70) top = Math.max(5, vh - 140);

    $('#tts-cyber-trigger').css({ top: `${top}px`, left: `${left}px` });
}

export function fixModalPosition() {
    const $modal = $('#tts-cyber-modal');
    if (!$modal.length) return;

    $modal.css({
        top: '0px',
        left: '0px',
        width: '100vw',
        height: '100vh',
        transform: 'none'
    });
}

export function bindDragAndClick() {
    const $trigger = $('#tts-cyber-trigger');
    if (!$trigger.length) return;

    $trigger.off('pointerdown pointermove pointerup pointercancel click');

    let suppressNativeClick = false;
    const triggerClick = function () {
        const now = Date.now();
        if (now - (ThemeState.drag.lastTapTime || 0) < 350) return;
        ThemeState.drag.lastTapTime = now;

        if (ThemeState.particleEngine) {
            ThemeState.particleEngine.burst();
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

        newLeft = Math.max(5, Math.min(window.innerWidth - 48, newLeft));
        newTop = Math.max(5, Math.min(window.innerHeight - 105, newTop));

        $trigger.css({ left: newLeft + 'px', top: newTop + 'px' });
    });

    $trigger.on('pointerup pointercancel', function (e) {
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
            // 自由停放：持久化保存当前拖拽停止的坐标
            const currentLeft = $trigger.css('left');
            const currentTop = $trigger.css('top');
            localStorage.setItem('tts_cyber_trigger_top', currentTop);
            localStorage.setItem('tts_cyber_trigger_left', currentLeft);
            localStorage.setItem('tts_common_trigger_top', currentTop);
            localStorage.setItem('tts_common_trigger_left', currentLeft);
        }
    });

    $trigger.on('click', function () {
        if (suppressNativeClick) { suppressNativeClick = false; return; }
        if (!ThemeState.drag.hasMoved) {
            triggerClick();
        }
    });
}

export function destroyTriggerDOM() {
    $('#tts-cyber-trigger').remove();
    $('#tts-cyber-modal').remove();
    $(`#${CSS_ID}`).remove();
}
