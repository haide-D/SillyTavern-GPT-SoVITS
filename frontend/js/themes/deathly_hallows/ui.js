import { ThemeState, DRAG_THRESHOLD } from './state.js';

// ==================== CSS 及 DOM 注入 ====================
export function ensureCSS() {
    if ($('#dh-custom-call-css').length === 0) {
        const style = document.createElement('style');
        style.id = 'dh-custom-call-css';
        style.innerHTML = `
/* ========================================
   DH FULLSCREEN UI - THEMES
   ======================================== */
:root {
    --dh-gold-accent: 196, 155, 79;
    --dh-gold-bg: rgba(22, 16, 4, 0.88);
    
    --dh-purple-accent: 167, 110, 255;
    --dh-purple-bg: rgba(14, 8, 22, 0.88);
}

.dh-theme-gold {
    --dh-accent: var(--dh-gold-accent);
    --dh-bg-center: var(--dh-gold-bg);
}

.dh-theme-purple {
    --dh-accent: var(--dh-purple-accent);
    --dh-bg-center: var(--dh-purple-bg);
}

/* ========================================
   DH FULLSCREEN CALL UI - PREMIUM REDESIGN
   ======================================== */

#dh-true-fullscreen-call {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    min-height: 100%;
    inset: 0;
    z-index: 100000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    overflow-x: hidden;
    overflow-y: auto;
    box-sizing: border-box;
    /* Semi-transparent overlay based on theme */
    background: radial-gradient(ellipse 60% 50% at 50% 50%, var(--dh-bg-center) 0%, rgba(0, 0, 0, 0.94) 100%);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    animation: dh-screen-fadein 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes dh-screen-fadein {
    from { opacity: 0; }
    to   { opacity: 1; }
}

/* ---- Background Hallows Watermark ---- */
.dh-bg-hallows {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    color: rgba(var(--dh-accent), 0.9);
}
.dh-bg-hallows svg {
    width: min(70vw, 70vh);
    height: min(70vw, 70vh);
    opacity: 0.06;
    animation: dh-hallows-breathe 8s ease-in-out infinite;
}
@keyframes dh-hallows-breathe {
    0%, 100% { opacity: 0.05; transform: scale(1) rotate(0deg); }
    50%       { opacity: 0.09; transform: scale(1.03) rotate(1.5deg); }
}

/* ---- Content Stack ---- */
.dh-call-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding: 0 24px;
    text-align: center;
}

/* ---- Avatar ---- */
.dh-call-avatar-wrap {
    position: relative;
    width: 120px;
    height: 120px;
    margin-bottom: 32px;
}
.dh-call-avatar-ring {
    position: absolute;
    inset: -5px;
    border-radius: 50%;
    border: 1px solid rgba(var(--dh-accent), 0.55);
    animation: dh-ring-pulse 2.8s ease-in-out infinite;
}
@keyframes dh-ring-pulse {
    0%, 100% { transform: scale(1);    opacity: 0.55; }
    50%       { transform: scale(1.08); opacity: 0.9; }
}
.dh-call-avatar-ring.outer {
    inset: -12px;
    border-color: rgba(var(--dh-accent), 0.2);
    animation-delay: 0.6s;
}
.dh-call-avatar-img {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(var(--dh-accent), 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
}
.dh-call-avatar-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.dh-call-avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(var(--dh-accent), 0.6);
}
.dh-call-avatar-placeholder svg {
    width: 52px;
    height: 52px;
    opacity: 0.5;
}

/* ---- Typography ---- */
.dh-call-name {
    font-size: clamp(26px, 5vw, 36px);
    font-weight: 200;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.92);
    margin: 0 0 10px 0;
    line-height: 1.1;
}
.dh-call-status {
    font-size: 13px;
    font-weight: 300;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(var(--dh-accent), 0.75);
    animation: dh-status-pulse 2.5s ease-in-out infinite;
    margin-bottom: 64px;
}
@keyframes dh-status-pulse {
    0%, 100% { opacity: 0.6; }
    50%       { opacity: 1; }
}

/* ---- Action Buttons ---- */
.dh-call-actions {
    display: flex;
    align-items: center;
    gap: 52px;
    z-index: 2;
}
.dh-action-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
}
.dh-action-label {
    font-size: 11px;
    font-weight: 300;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.35);
}
.dh-action-btn {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
                filter 0.25s ease,
                opacity 0.2s ease;
    -webkit-tap-highlight-color: transparent;
    outline: none;
}
.dh-action-btn:active {
    transform: scale(0.9);
    opacity: 0.8;
}
.dh-action-btn.reject, .dh-action-btn.hangup {
    background: rgba(220, 53, 53, 0.18);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(220, 53, 53, 0.3);
}
.dh-action-btn.reject:hover, .dh-action-btn.hangup:hover {
    background: rgba(220, 53, 53, 0.32);
    transform: scale(1.06);
    filter: brightness(1.15);
}
.dh-action-btn.answer {
    background: rgba(34, 197, 94, 0.22);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(34, 197, 94, 0.35);
}
.dh-action-btn.answer:hover {
    background: rgba(34, 197, 94, 0.36);
    transform: scale(1.06);
    filter: brightness(1.15);
}

/* ---- Eavesdrop Play/Stop Buttons ---- */
.dh-action-btn.play {
    background: rgba(var(--dh-accent), 0.18);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(var(--dh-accent), 0.3);
}
.dh-action-btn.play:hover {
    background: rgba(var(--dh-accent), 0.32);
    transform: scale(1.06);
    filter: brightness(1.15);
}

/* ---- In-call Waveform ---- */
.dh-waveform {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    margin: 0 0 44px 0;
}
.dh-waveform-bar {
    width: 3px;
    border-radius: 2px;
    background: rgba(var(--dh-accent), 0.7);
    animation: dh-wave 1.2s ease-in-out infinite alternate;
}
.dh-waveform-bar:nth-child(1)  { height: 8px;  animation-delay: 0.00s; }
.dh-waveform-bar:nth-child(2)  { height: 16px; animation-delay: 0.10s; }
.dh-waveform-bar:nth-child(3)  { height: 28px; animation-delay: 0.05s; }
.dh-waveform-bar:nth-child(4)  { height: 38px; animation-delay: 0.15s; }
.dh-waveform-bar:nth-child(5)  { height: 44px; animation-delay: 0.08s; }
.dh-waveform-bar:nth-child(6)  { height: 38px; animation-delay: 0.20s; }
.dh-waveform-bar:nth-child(7)  { height: 28px; animation-delay: 0.04s; }
.dh-waveform-bar:nth-child(8)  { height: 16px; animation-delay: 0.12s; }
.dh-waveform-bar:nth-child(9)  { height: 8px;  animation-delay: 0.02s; }
@keyframes dh-wave {
    0%   { transform: scaleY(0.3); opacity: 0.4; }
    100% { transform: scaleY(1.1); opacity: 0.9; }
}

/* ---- Subtitle ---- */
.dh-subtitle {
    font-size: 15px;
    font-weight: 300;
    color: rgba(255, 255, 255, 0.55);
    letter-spacing: 0.04em;
    min-height: 24px;
    margin-bottom: 40px;
    padding: 0 32px;
    max-width: 480px;
    line-height: 1.5;
}
.dh-subtitle .subtitle-line {
    transition: opacity 0.3s ease;
    opacity: 0;
}
.dh-subtitle .subtitle-line.visible {
    opacity: 1;
}
.dh-subtitle .subtitle-char {
    color: rgba(255, 255, 255, 0.3);
    transition: color 0.15s ease, text-shadow 0.15s ease;
}
.dh-subtitle .subtitle-char.passed,
.dh-subtitle .subtitle-char.active {
    color: rgba(255, 255, 255, 0.95);
    text-shadow: 0 0 10px rgba(var(--dh-accent), 0.8);
}
.dh-subtitle .subtitle-speaker {
    display: block;
    font-size: 12px;
    color: rgba(var(--dh-accent), 0.8);
    margin-bottom: 6px;
    letter-spacing: 0.1em;
}

/* Mobile tweaks - 全面适配手机竖屏与小屏 */
@media (max-width: 768px), (max-height: 720px) {
    .dh-call-content { padding: 0 16px; width: 100%; max-width: 100%; box-sizing: border-box; }
    .dh-call-avatar-wrap { width: 90px; height: 90px; margin-bottom: 16px; }
    .dh-call-avatar-img  { width: 90px; height: 90px; }
    .dh-call-name { font-size: clamp(20px, 6vw, 26px); margin: 0 0 6px 0; }
    .dh-call-status { font-size: 12px; margin-bottom: 24px; letter-spacing: 0.15em; }
    .dh-waveform { margin-bottom: 20px; height: 32px; gap: 4px; }
    .dh-subtitle { font-size: 13px; min-height: 20px; margin-bottom: 20px; padding: 0 16px; max-width: 100%; }
    .dh-action-btn { width: 62px; height: 62px; }
    .dh-call-actions { gap: 36px; }
}

/* ========================================
   DH MAGIC APP OVERRIDES (For generic apps)
   ======================================== */

#tts-dh-modal .dh-magic-app-container {
    padding-bottom: 20px;
}

/* Settings Override (法阵修正/系统配置) */
#tts-dh-modal .mobile-settings-content {
    background: transparent !important;
    color: rgba(220, 200, 150, 0.9) !important;
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    padding-bottom: 40px;
}
/* 魔法风格滚动条 */
#tts-dh-modal .mobile-settings-content::-webkit-scrollbar,
#tts-dh-modal .call-history-content::-webkit-scrollbar,
#tts-dh-modal .eavesdrop-history-content::-webkit-scrollbar,
#tts-dh-modal .tts-compact-mapping-list::-webkit-scrollbar {
    width: 4px;
}
#tts-dh-modal .mobile-settings-content::-webkit-scrollbar-track,
#tts-dh-modal .call-history-content::-webkit-scrollbar-track,
#tts-dh-modal .eavesdrop-history-content::-webkit-scrollbar-track,
#tts-dh-modal .tts-compact-mapping-list::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
}
#tts-dh-modal .mobile-settings-content::-webkit-scrollbar-thumb,
#tts-dh-modal .call-history-content::-webkit-scrollbar-thumb,
#tts-dh-modal .eavesdrop-history-content::-webkit-scrollbar-thumb,
#tts-dh-modal .tts-compact-mapping-list::-webkit-scrollbar-thumb {
    background: rgba(196, 155, 79, 0.4);
    border-radius: 4px;
}
#tts-dh-modal .mobile-settings-content::-webkit-scrollbar-thumb:hover,
#tts-dh-modal .call-history-content::-webkit-scrollbar-thumb:hover,
#tts-dh-modal .eavesdrop-history-content::-webkit-scrollbar-thumb:hover,
#tts-dh-modal .tts-compact-mapping-list::-webkit-scrollbar-thumb:hover {
    background: rgba(196, 155, 79, 0.7);
}

/* 卡片容器：暗金半透明磨砂黑金质感 */
#tts-dh-modal .mobile-settings-content .tts-card {
    background: rgba(14, 10, 20, 0.78) !important;
    border: 1px solid rgba(196, 155, 79, 0.28) !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
    backdrop-filter: blur(8px);
    margin-bottom: 14px !important;
    padding: 14px !important;
    transition: all 0.3s ease;
}
#tts-dh-modal .mobile-settings-content .tts-card:hover {
    border-color: rgba(196, 155, 79, 0.55) !important;
    box-shadow: 0 0 14px rgba(196, 155, 79, 0.25) !important;
}

/* 卡片标题：金色发光字，告别任何突兀亮蓝色 */
#tts-dh-modal .mobile-settings-content .tts-card-title {
    color: rgba(196, 155, 79, 1) !important;
    text-shadow: 0 0 8px rgba(196, 155, 79, 0.45) !important;
    font-weight: 300 !important;
    font-size: 15px !important;
    letter-spacing: 1px !important;
    border-bottom: 1px solid rgba(196, 155, 79, 0.25) !important;
    padding-bottom: 8px !important;
    margin-bottom: 12px !important;
}

/* 开关行与文本 */
#tts-dh-modal .mobile-settings-content .tts-switch-row {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    margin-bottom: 8px !important;
    cursor: pointer;
}
#tts-dh-modal .mobile-settings-content .tts-switch-label,
#tts-dh-modal .mobile-settings-content .tts-input-label {
    color: rgba(220, 200, 150, 0.9) !important;
    font-size: 13px !important;
    font-weight: 300 !important;
    letter-spacing: 0.5px !important;
}

/* 魔法金光 Toggle 开关 */
#tts-dh-modal .mobile-settings-content .tts-toggle {
    appearance: none;
    -webkit-appearance: none;
    width: 36px;
    height: 20px;
    background: rgba(255, 255, 255, 0.1) !important;
    border: 1px solid rgba(196, 155, 79, 0.4) !important;
    border-radius: 20px;
    position: relative;
    outline: none;
    cursor: pointer;
    transition: all 0.3s ease;
}
#tts-dh-modal .mobile-settings-content .tts-toggle:before {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    top: 2px;
    left: 2px;
    background: rgba(196, 155, 79, 0.7);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
#tts-dh-modal .mobile-settings-content .tts-toggle:checked {
    background: rgba(196, 155, 79, 0.3) !important;
    border-color: rgba(196, 155, 79, 0.9) !important;
    box-shadow: 0 0 10px rgba(196, 155, 79, 0.4) !important;
}
#tts-dh-modal .mobile-settings-content .tts-toggle:checked:before {
    left: 18px;
    background: rgba(255, 230, 160, 1);
    box-shadow: 0 0 8px rgba(196, 155, 79, 0.8);
}

/* 输入框与原生选择框 */
#tts-dh-modal .mobile-settings-content input[type="text"],
#tts-dh-modal .mobile-settings-content input[type="number"],
#tts-dh-modal .mobile-settings-content select,
#tts-dh-modal .mobile-settings-content .tts-modern-input {
    background: rgba(8, 5, 12, 0.85) !important;
    color: rgba(220, 200, 150, 0.95) !important;
    border: 1px solid rgba(196, 155, 79, 0.35) !important;
    border-radius: 5px !important;
    padding: 7px 10px !important;
    font-size: 13px !important;
    outline: none !important;
    transition: all 0.25s ease;
    box-sizing: border-box !important;
}
#tts-dh-modal .mobile-settings-content select {
    background-image: url("data:image/svg+xml;utf8,<svg fill='%23c49b4f' height='16' viewBox='0 0 24 24' width='16' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/></svg>") !important;
    background-repeat: no-repeat !important;
    background-position: right 8px center !important;
    padding-right: 26px !important;
    cursor: pointer;
}
#tts-dh-modal .mobile-settings-content select option {
    background: rgba(14, 10, 20, 0.98) !important;
    color: rgba(220, 200, 150, 0.95) !important;
    padding: 6px 10px;
}
#tts-dh-modal .mobile-settings-content select option:disabled {
    color: rgba(196, 155, 79, 0.6) !important;
}
#tts-dh-modal .mobile-settings-content input:focus,
#tts-dh-modal .mobile-settings-content select:focus,
#tts-dh-modal .mobile-settings-content .tts-modern-input:focus {
    border-color: rgba(196, 155, 79, 0.85) !important;
    box-shadow: 0 0 10px rgba(196, 155, 79, 0.35) !important;
}

/* 按钮样式 */
#tts-dh-modal .mobile-settings-content .btn-primary,
#tts-dh-modal .mobile-settings-content #tts-btn-bind-new {
    background: rgba(196, 155, 79, 0.22) !important;
    border: 1px solid rgba(196, 155, 79, 0.65) !important;
    color: rgba(255, 240, 200, 1) !important;
    font-weight: 300 !important;
    letter-spacing: 1px !important;
    border-radius: 6px !important;
    padding: 8px 12px !important;
    transition: all 0.25s ease !important;
    cursor: pointer;
}
#tts-dh-modal .mobile-settings-content .btn-primary:hover,
#tts-dh-modal .mobile-settings-content #tts-btn-bind-new:hover {
    background: rgba(196, 155, 79, 0.45) !important;
    box-shadow: 0 0 14px rgba(196, 155, 79, 0.45) !important;
    transform: translateY(-1px);
}
#tts-dh-modal .mobile-settings-content .btn-secondary,
#tts-dh-modal .mobile-settings-content #tts-btn-fill-current-char,
#tts-dh-modal .mobile-settings-content #tts-btn-select-all {
    background: rgba(255, 255, 255, 0.06) !important;
    border: 1px solid rgba(196, 155, 79, 0.3) !important;
    color: rgba(220, 200, 150, 0.85) !important;
    border-radius: 5px !important;
    cursor: pointer;
    transition: all 0.2s ease;
}
#tts-dh-modal .mobile-settings-content .btn-secondary:hover,
#tts-dh-modal .mobile-settings-content #tts-btn-fill-current-char:hover,
#tts-dh-modal .mobile-settings-content #tts-btn-select-all:hover {
    background: rgba(196, 155, 79, 0.2) !important;
    border-color: rgba(196, 155, 79, 0.6) !important;
    color: rgba(255, 240, 200, 1) !important;
}

/* 紧凑/双行角色绑定卡片流 */
#tts-dh-modal .mobile-settings-content .tts-mapping-card,
#tts-dh-modal .mobile-settings-content .tts-compact-item {
    background: rgba(14, 10, 20, 0.85) !important;
    border: 1px solid rgba(196, 155, 79, 0.22) !important;
    transition: all 0.2s ease;
}
#tts-dh-modal .mobile-settings-content .tts-mapping-card:hover,
#tts-dh-modal .mobile-settings-content .tts-compact-item:hover {
    border-color: rgba(196, 155, 79, 0.55) !important;
    box-shadow: 0 0 8px rgba(196, 155, 79, 0.2) !important;
}
#tts-dh-modal .mobile-settings-content .tts-char-name {
    color: #fef08a !important;
    font-weight: 600 !important;
    font-size: 13px !important;
}
#tts-dh-modal .mobile-settings-content .tts-voice-badge {
    background: rgba(8, 6, 14, 0.85) !important;
    border: 0.8px solid rgba(196, 155, 79, 0.2) !important;
}
#tts-dh-modal .mobile-settings-content .tts-voice-badge .voice-badge-name {
    color: rgba(220, 200, 160, 0.9) !important;
}
#tts-dh-modal .mobile-settings-content .tts-mapping-check {
    accent-color: rgba(196, 155, 79, 1);
}
#tts-dh-modal .mobile-settings-content .tts-btn-subtle {
    background: rgba(20, 15, 30, 0.85) !important;
    border: 1px solid rgba(196, 155, 79, 0.35) !important;
    color: #fef08a !important;
}
#tts-dh-modal .mobile-settings-content .tts-drawer-inner {
    background: rgba(12, 9, 18, 0.9) !important;
    border: 1px dashed rgba(196, 155, 79, 0.35) !important;
}

/* Custom Select Dropdowns */
#tts-dh-modal .mobile-settings-content .tts-custom-select {
    position: relative;
    z-index: 10;
}
#tts-dh-modal .mobile-settings-content .select-trigger {
    background: rgba(8, 5, 12, 0.85);
    border: 1px solid rgba(196, 155, 79, 0.4);
    color: rgba(220, 200, 150, 0.95);
    padding: 8px 12px;
    border-radius: 5px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
#tts-dh-modal .mobile-settings-content .select-options {
    position: relative;
    top: 0;
    left: 0;
    width: 100%;
    max-height: 200px;
    overflow-y: auto;
    background: rgba(14, 10, 20, 0.95);
    border: 1px solid rgba(196, 155, 79, 0.6);
    border-radius: 4px;
    z-index: 999;
    display: none;
}
#tts-dh-modal .mobile-settings-content .tts-custom-select.open .select-options {
    display: block;
}
#tts-dh-modal .mobile-settings-content .option-item {
    padding: 10px 12px;
    cursor: pointer;
    color: rgba(220, 200, 150, 0.9);
    transition: background 0.2s;
}
#tts-dh-modal .mobile-settings-content .option-item:hover {
    background: rgba(196, 155, 79, 0.2);
}

/* Favorites Override */
#tts-dh-modal .fav-tab {
    background: rgba(14, 10, 20, 0.6) !important;
    border: 1px solid rgba(196, 155, 79, 0.2) !important;
    color: rgba(196, 155, 79, 0.5) !important;
    transition: all 0.3s;
}
#tts-dh-modal .fav-tab.active {
    background: rgba(196, 155, 79, 0.15) !important;
    border: 1px solid rgba(196, 155, 79, 0.7) !important;
    color: rgba(196, 155, 79, 1) !important;
    text-shadow: 0 0 8px rgba(196, 155, 79, 0.4);
}
#tts-dh-modal .fav-item {
    background: rgba(14, 10, 20, 0.7) !important;
    border: 1px solid rgba(196, 155, 79, 0.25) !important;
    border-radius: 8px !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    margin-bottom: 12px;
}
#tts-dh-modal .fav-item-name {
    color: rgba(196, 155, 79, 1) !important;
    font-weight: normal;
    letter-spacing: 1px;
}
#tts-dh-modal .fav-item-date {
    color: rgba(196, 155, 79, 0.5) !important;
}
#tts-dh-modal .fav-context-box {
    color: rgba(220, 200, 150, 0.6) !important;
    border-left: 2px solid rgba(196, 155, 79, 0.5) !important;
    background: rgba(0, 0, 0, 0.2);
}
#tts-dh-modal .fav-text-content {
    color: rgba(220, 200, 150, 0.95) !important;
    font-size: 15px;
    line-height: 1.5;
}
#tts-dh-modal .voice-bubble {
    background: rgba(196, 155, 79, 0.1) !important;
    border: 1px solid rgba(196, 155, 79, 0.3) !important;
    color: rgba(196, 155, 79, 1) !important;
}

/* Call & Eavesdrop History Override */
#tts-dh-modal .call-history-content,
#tts-dh-modal .eavesdrop-history-content {
    padding: 10px;
    background: transparent !important;
    flex: 1;
    overflow-y: auto;
}
#tts-dh-modal .call-history-empty,
#tts-dh-modal .eavesdrop-history-empty {
    color: rgba(196, 155, 79, 0.6) !important;
    text-shadow: 0 0 5px rgba(196, 155, 79, 0.2);
    font-size: 15px;
    letter-spacing: 1px;
}
#tts-dh-modal .call-history-empty-icon,
#tts-dh-modal .eavesdrop-history-empty-icon {
    font-size: 32px;
    margin-bottom: 15px;
    opacity: 0.5;
    filter: sepia(1) hue-rotate(5deg) saturate(2);
}
#tts-dh-modal .call-history-item {
    background: rgba(14, 10, 20, 0.7) !important;
    border: 1px solid rgba(196, 155, 79, 0.25) !important;
    border-radius: 8px;
    margin-bottom: 12px;
}
#tts-dh-modal .call-history-name {
    color: rgba(196, 155, 79, 1) !important;
    font-weight: normal;
    letter-spacing: 1px;
}
#tts-dh-modal .call-history-date {
    color: rgba(196, 155, 79, 0.5) !important;
}
#tts-dh-modal .call-history-avatar {
    background: rgba(196, 155, 79, 0.1) !important;
    border: 1px solid rgba(196, 155, 79, 0.3) !important;
    color: rgba(196, 155, 79, 0.8) !important;
}
#tts-dh-modal .call-history-play-area {
    background: rgba(196, 155, 79, 0.1) !important;
    border: 1px solid rgba(196, 155, 79, 0.4) !important;
    color: rgba(196, 155, 79, 1) !important;
}
#tts-dh-modal .call-history-play-icon {
    filter: sepia(1) hue-rotate(5deg) saturate(2);
}

/* Eavesdrop history override */
#tts-dh-modal .eavesdrop-history-item {
    background: rgba(14, 10, 20, 0.7) !important;
    border: 1px solid rgba(167, 110, 255, 0.25) !important;
    border-radius: 8px;
    margin-bottom: 12px;
}
#tts-dh-modal .eavesdrop-history-name {
    color: rgba(167, 110, 255, 1) !important;
    font-weight: normal;
    letter-spacing: 1px;
}
#tts-dh-modal .eavesdrop-history-date {
    color: rgba(167, 110, 255, 0.5) !important;
}
#tts-dh-modal .eavesdrop-history-avatar {
    background: rgba(167, 110, 255, 0.1) !important;
    border: 1px solid rgba(167, 110, 255, 0.3) !important;
    color: rgba(167, 110, 255, 0.8) !important;
}
#tts-dh-modal .eavesdrop-history-play-area {
    background: rgba(167, 110, 255, 0.1) !important;
    border: 1px solid rgba(167, 110, 255, 0.4) !important;
    color: rgba(167, 110, 255, 1) !important;
}

/* ========================================
   DH THEME STORE (变幻工坊) OVERRIDES
   ======================================== */
#tts-dh-modal .theme-store-container {
    background: transparent !important;
    color: rgba(220, 200, 150, 0.9) !important;
    padding: 14px;
    flex: 1;
    overflow-y: auto;
    padding-bottom: 30px;
}
#tts-dh-modal .theme-store-container::-webkit-scrollbar {
    width: 4px;
}
#tts-dh-modal .theme-store-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
}
#tts-dh-modal .theme-store-container::-webkit-scrollbar-thumb {
    background: rgba(196, 155, 79, 0.4);
    border-radius: 4px;
}
#tts-dh-modal .theme-store-container::-webkit-scrollbar-thumb:hover {
    background: rgba(196, 155, 79, 0.7);
}

/* 顶部操作按钮（暗金微光魔法风格） */
#tts-dh-modal .ts-header-actions {
    gap: 8px;
    margin-bottom: 18px;
}
#tts-dh-modal .ts-btn {
    background: rgba(14, 10, 20, 0.7) !important;
    border: 1px solid rgba(196, 155, 79, 0.4) !important;
    color: rgba(220, 200, 150, 0.95) !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4) !important;
    font-weight: 300 !important;
    font-size: 13px !important;
    letter-spacing: 0.5px !important;
    border-radius: 6px !important;
    transition: all 0.25s ease !important;
    padding: 10px 6px !important;
}
#tts-dh-modal .ts-btn:hover {
    background: rgba(196, 155, 79, 0.25) !important;
    border-color: rgba(196, 155, 79, 0.85) !important;
    color: rgba(255, 240, 200, 1) !important;
    box-shadow: 0 0 12px rgba(196, 155, 79, 0.4) !important;
    transform: translateY(-2px);
}
#tts-dh-modal .ts-btn-upload {
    background: rgba(196, 155, 79, 0.18) !important;
    border-color: rgba(196, 155, 79, 0.55) !important;
}
#tts-dh-modal .ts-btn-import {
    background: rgba(167, 110, 255, 0.18) !important;
    border-color: rgba(167, 110, 255, 0.5) !important;
    color: rgba(220, 190, 255, 0.95) !important;
}
#tts-dh-modal .ts-btn-import:hover {
    background: rgba(167, 110, 255, 0.3) !important;
    border-color: rgba(167, 110, 255, 0.9) !important;
    box-shadow: 0 0 14px rgba(167, 110, 255, 0.4) !important;
}
#tts-dh-modal .ts-btn-prompt {
    background: rgba(196, 155, 79, 0.12) !important;
    border-color: rgba(196, 155, 79, 0.4) !important;
}

/* 主题网格与卡片 */
#tts-dh-modal .ts-grid {
    gap: 14px;
    padding-bottom: 20px;
}
#tts-dh-modal .ts-card {
    background: rgba(14, 10, 20, 0.78) !important;
    border: 1px solid rgba(196, 155, 79, 0.28) !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
    backdrop-filter: blur(8px);
    transition: all 0.3s ease;
}
#tts-dh-modal .ts-card:hover {
    border-color: rgba(196, 155, 79, 0.65) !important;
    box-shadow: 0 0 16px rgba(196, 155, 79, 0.35) !important;
    transform: translateY(-3px);
}
#tts-dh-modal .ts-card.active-theme {
    border-color: rgba(196, 155, 79, 0.95) !important;
    box-shadow: 0 0 18px rgba(196, 155, 79, 0.4), inset 0 0 14px rgba(196, 155, 79, 0.15) !important;
}
#tts-dh-modal .ts-card-cover {
    background: radial-gradient(circle at center, rgba(196, 155, 79, 0.2) 0%, rgba(14, 10, 20, 0.85) 100%) !important;
    border-bottom: 1px solid rgba(196, 155, 79, 0.2);
    height: 85px;
}
#tts-dh-modal .ts-cover-icon {
    color: rgba(196, 155, 79, 0.95);
    filter: drop-shadow(0 0 10px rgba(196, 155, 79, 0.6));
    display: flex;
    align-items: center;
    justify-content: center;
}
#tts-dh-modal .ts-active-badge {
    background: rgba(196, 155, 79, 0.25) !important;
    border: 1px solid rgba(196, 155, 79, 0.85) !important;
    color: rgba(255, 230, 160, 1) !important;
    text-shadow: 0 0 6px rgba(196, 155, 79, 0.6);
    font-weight: 300;
    font-size: 10px;
    letter-spacing: 1px;
    border-radius: 4px;
    padding: 3px 6px;
}
#tts-dh-modal .ts-builtin-badge {
    background: rgba(0, 0, 0, 0.55) !important;
    border: 1px solid rgba(196, 155, 79, 0.25) !important;
    color: rgba(220, 200, 150, 0.75) !important;
    font-size: 10px;
    border-radius: 4px;
}
#tts-dh-modal .ts-card-title {
    color: rgba(220, 200, 150, 1) !important;
    font-weight: 300;
    font-size: 16px;
    letter-spacing: 1px;
}
#tts-dh-modal .ts-card-version {
    color: rgba(196, 155, 79, 0.6) !important;
    font-size: 11px;
}
#tts-dh-modal .ts-card-desc {
    color: rgba(220, 200, 150, 0.65) !important;
    font-size: 12px;
}
#tts-dh-modal .ts-action-use {
    background: rgba(196, 155, 79, 0.2) !important;
    border: 1px solid rgba(196, 155, 79, 0.6) !important;
    color: rgba(220, 200, 150, 1) !important;
    font-weight: 300;
    letter-spacing: 1px;
    transition: all 0.2s ease;
}
#tts-dh-modal .ts-action-use:hover {
    background: rgba(196, 155, 79, 0.45) !important;
    box-shadow: 0 0 10px rgba(196, 155, 79, 0.4);
}
#tts-dh-modal .ts-action-export {
    background: rgba(255, 255, 255, 0.06) !important;
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
    color: rgba(220, 200, 150, 0.8) !important;
}
#tts-dh-modal .ts-action-export:hover {
    background: rgba(255, 255, 255, 0.12) !important;
    border-color: rgba(196, 155, 79, 0.4) !important;
}
#tts-dh-modal .ts-action-delete {
    background: rgba(220, 53, 53, 0.15) !important;
    border: 1px solid rgba(220, 53, 53, 0.3) !important;
    color: rgba(255, 160, 160, 0.85) !important;
}
#tts-dh-modal .ts-action-delete:hover {
    background: rgba(220, 53, 53, 0.35) !important;
    color: #fff !important;
    box-shadow: 0 0 10px rgba(220, 53, 53, 0.4);
}

/* 导入 AI 代码弹窗（羊皮纸黑金魔法弹窗） */
.ts-modal {
    background: rgba(14, 10, 20, 0.96) !important;
    border: 1px solid rgba(196, 155, 79, 0.65) !important;
    box-shadow: 0 0 35px rgba(0, 0, 0, 0.85), 0 0 15px rgba(196, 155, 79, 0.3) !important;
    color: rgba(220, 200, 150, 0.95) !important;
    border-radius: 12px !important;
}
.ts-modal-header {
    border-bottom: 1px solid rgba(196, 155, 79, 0.3) !important;
    padding: 14px 18px !important;
}
.ts-modal-title {
    color: rgba(196, 155, 79, 1) !important;
    text-shadow: 0 0 8px rgba(196, 155, 79, 0.4);
    font-weight: 300;
    letter-spacing: 1px;
}
.ts-modal-close {
    color: rgba(196, 155, 79, 0.6) !important;
}
.ts-modal-close:hover {
    color: rgba(196, 155, 79, 1) !important;
}
.ts-textarea {
    background: rgba(8, 5, 12, 0.85) !important;
    border: 1px solid rgba(196, 155, 79, 0.35) !important;
    color: rgba(220, 200, 150, 0.9) !important;
    border-radius: 6px !important;
}
.ts-textarea:focus {
    border-color: rgba(196, 155, 79, 0.85) !important;
    box-shadow: 0 0 10px rgba(196, 155, 79, 0.35) !important;
}
.ts-modal-footer {
    border-top: 1px solid rgba(196, 155, 79, 0.25) !important;
    padding: 14px 18px !important;
}
.ts-btn-cancel {
    background: rgba(255, 255, 255, 0.05) !important;
    border: 1px solid rgba(196, 155, 79, 0.35) !important;
    color: rgba(220, 200, 150, 0.75) !important;
    border-radius: 6px !important;
}
.ts-btn-confirm {
    background: rgba(196, 155, 79, 0.25) !important;
    border: 1px solid rgba(196, 155, 79, 0.75) !important;
    color: rgba(255, 240, 200, 1) !important;
    box-shadow: 0 0 10px rgba(196, 155, 79, 0.3);
    border-radius: 6px !important;
}
.ts-btn-confirm:hover {
    background: rgba(196, 155, 79, 0.5) !important;
    box-shadow: 0 0 16px rgba(196, 155, 79, 0.6) !important;
}

        `;
        document.head.appendChild(style);
    }
}

export function renderTriggerDOM() {
    // 防止重复
    if ($('#tts-dh-trigger').length > 0) return;

    // 渲染法阵和 canvas
    // Canvas 需要置底且充满全屏，但不会遮挡鼠标事件
    const canvasHtml = `<canvas id="dhParticleCanvas" style="position:fixed; top:0; left:0; width:100%; height:100%; z-index:9998; pointer-events:none;"></canvas>`;
    
    // 渲染法阵 Trigger 节点
    const triggerHtml = `
    <div id="tts-dh-trigger" class="dh-container" style="position:fixed; z-index:9999; cursor:pointer; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;" title="Patronus">
        <div class="dh-inner" id="dhInner">
            <div class="dh-glow"></div>
            <div class="dh-aura"></div>
            <svg class="dh-svg" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle class="dh-orbit-outer" cx="28" cy="28" r="26" />
                <circle class="dh-orbit-mid" cx="28" cy="28" r="23" />
                <g class="dh-rune-ring">
                    <circle cx="28" cy="28" r="27" fill="none" stroke="rgba(var(--dh-gold-rgb), 0.12)" stroke-width="0.3" />
                    <path class="rune-glyph" d="M28,1 L28,5 M26,2.5 L28,1 L30,2.5" />
                    <path class="rune-glyph" d="M46,8 L48,10 L46,12 L44,10 Z" />
                    <path class="rune-glyph" d="M53,27 L55,29 M55,27 L53,29" />
                    <circle class="rune-dot" cx="54" cy="28" r="0.6" />
                    <path class="rune-glyph" d="M46,46 L48,43 L50,46" />
                    <path class="rune-glyph" d="M27,51 L27,55 M29,51 L29,55" />
                    <circle class="rune-dot" cx="28" cy="53" r="0.6" />
                    <path class="rune-glyph" d="M10,46 L8,43 L10,43 M8,46 L8,43" />
                    <path class="rune-glyph" d="M1,27 L4,27 L1,29 L4,29" />
                    <circle class="rune-dot" cx="2.5" cy="28" r="0.6" />
                    <path class="rune-glyph" d="M8,12 L10,9 L12,12" />
                    <circle class="rune-dot" cx="10" cy="10" r="0.6" />
                </g>
                <path class="dh-triangle" d="M28,10 L42,44 L14,44 Z" />
                <path class="dh-triangle-flow" d="M28,10 L42,44 L14,44 Z" />
                <circle class="dh-circle" cx="28" cy="32" r="10.5" />
                <circle class="dh-circle-flow" cx="28" cy="32" r="10.5" />
                <line class="dh-line" x1="28" y1="10" x2="28" y2="44" />
                <line class="dh-line-flow" x1="28" y1="10" x2="28" y2="44" />
                <circle class="dh-core" cx="28" cy="28" r="2" />
                <circle class="dh-node" cx="28" cy="10" r="1.2">
                    <animate attributeName="opacity" values="0.4;0.8;0.4" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle class="dh-node" cx="42" cy="44" r="1">
                    <animate attributeName="opacity" values="0.3;0.7;0.3" dur="3.5s" repeatCount="indefinite" />
                </circle>
                <circle class="dh-node" cx="14" cy="44" r="1">
                    <animate attributeName="opacity" values="0.3;0.7;0.3" dur="4s" repeatCount="indefinite" />
                </circle>
                <circle class="dh-node" cx="21.5" cy="40" r="0.8" opacity="0.4">
                    <animate attributeName="opacity" values="0.2;0.5;0.2" dur="2.5s" repeatCount="indefinite" />
                </circle>
                <circle class="dh-node" cx="34.5" cy="40" r="0.8" opacity="0.4">
                    <animate attributeName="opacity" values="0.2;0.5;0.2" dur="3.2s" repeatCount="indefinite" />
                </circle>
            </svg>
            <div class="dh-shadow"></div>
        </div>
    </div>
    
    <!-- 内部的场景路由容器，复用 mobile 设计或者悬浮弹窗 -->
    <div id="tts-dh-modal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:360px; max-width:92vw; height:600px; background:transparent; z-index:10000; overflow:visible;">
        <!-- 神秘侧的SVG背景边框 -->
        <svg style="position:absolute; inset: -20px; width: calc(100% + 40px); height: calc(100% + 40px); z-index: -1; pointer-events: none;" viewBox="0 0 400 640" preserveAspectRatio="none">
            <defs>
                <linearGradient id="dhFrameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="rgba(196,155,79,0.9)" />
                    <stop offset="30%" stop-color="rgba(196,155,79,0.3)" />
                    <stop offset="70%" stop-color="rgba(196,155,79,0.3)" />
                    <stop offset="100%" stop-color="rgba(196,155,79,0.9)" />
                </linearGradient>
                <filter id="dhGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>
            
            <!-- 半透明神秘背景 -->
            <path d="M40,20 L360,20 L380,40 L380,600 L360,620 L40,620 L20,600 L20,40 Z" fill="rgba(14, 10, 20, 0.92)" stroke="url(#dhFrameGrad)" stroke-width="1.5" filter="url(#dhGlow)"/>
            
            <!-- 边角金线与装饰节点 -->
            <path d="M40,20 L60,20 M20,40 L20,60 M340,20 L360,20 M380,40 L380,60 M360,620 L340,620 M380,600 L380,580 M40,620 L60,620 M20,600 L20,580" stroke="rgba(196,155,79,0.9)" stroke-width="2" fill="none"/>
            <circle cx="30" cy="30" r="3" fill="rgba(196,155,79,0.9)"/>
            <circle cx="370" cy="30" r="3" fill="rgba(196,155,79,0.9)"/>
            <circle cx="30" cy="610" r="3" fill="rgba(196,155,79,0.9)"/>
            <circle cx="370" cy="610" r="3" fill="rgba(196,155,79,0.9)"/>
            
            <!-- 顶部与底部符文几何线 -->
            <path d="M160,30 L200,42 L240,30" fill="none" stroke="rgba(196,155,79,0.6)" stroke-width="1.2"/>
            <path d="M160,610 L200,598 L240,610" fill="none" stroke="rgba(196,155,79,0.6)" stroke-width="1.2"/>
            <circle cx="200" cy="42" r="1.5" fill="rgba(196,155,79,0.8)"/>
            <circle cx="200" cy="598" r="1.5" fill="rgba(196,155,79,0.8)"/>
        </svg>

        <div id="tts-dh-scene-content" style="width:100%; height:100%; position:relative; z-index:1; display:flex; flex-direction:column;"></div>
        
        <!-- 悬浮魔法关闭按钮 -->
        <div class="dh-close-btn" style="position:absolute; top:-12px; right:-12px; width: 34px; height: 34px; cursor:pointer; color:rgba(196,155,79,1); z-index:10001; display:flex; align-items:center; justify-content:center; background: rgba(14, 10, 20, 1); border: 1px solid rgba(196,155,79,0.6); border-radius: 50%; box-shadow: 0 0 12px rgba(196,155,79,0.4);" title="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
    </div>
    `;
    $('body').append(canvasHtml + triggerHtml);
    
    // 设置触发器初始显示位置
    const $trigger = $('#tts-dh-trigger');
    const winW = window.innerWidth || $(window).width();
    const winH = window.innerHeight || $(window).height();
    
    let initialLeft, initialTop;
    if (winW < 768) {
        // 手机端：水平居中靠下
        initialLeft = (winW - 72) / 2;
        initialTop = winH - 72 - 80;
    } else {
        // 桌面端：垂直居中靠右
        initialLeft = winW - 72 - 24;
        initialTop = (winH - 72) / 2;
    }
    
    // 安全边界
    initialLeft = Math.max(0, Math.min(winW - 72, initialLeft));
    initialTop = Math.max(0, Math.min(winH - 72, initialTop));

    $trigger.css({
        left: initialLeft + 'px',
        top: initialTop + 'px',
        display: 'flex'
    });
}

export function destroyDOM() {
    $('#tts-dh-trigger, #dhParticleCanvas, #tts-dh-modal, #dh-custom-call-css').remove();
}

export function bindDragAndClick() {
    const $trigger = $('#tts-dh-trigger');
    if (!$trigger.length) return;

    $trigger.off('pointerdown pointermove pointerup pointercancel click');

    let suppressNativeClick = false;
    const triggerClick = function () {
        const now = Date.now();
        if (now - (ThemeState.dragState.lastTapTime || 0) < 350) return;
        ThemeState.dragState.lastTapTime = now;
        if (ThemeState.engine) {
            ThemeState.engine.toggle();
        }
    };

    $trigger.on('pointerdown', function (e) {
        e = e.originalEvent || e;
        if (e.button !== undefined && e.button !== 0) return;
        suppressNativeClick = false;
        // 忽略多点触控非主要触点
        if (e.isPrimary === false) return;

        ThemeState.dragState.isDragging = true;
        ThemeState.dragState.hasMoved = false;
        ThemeState.dragState.startX = e.clientX;
        ThemeState.dragState.startY = e.clientY;
        ThemeState.dragState.startTime = Date.now();

        const offset = $trigger.offset();
        ThemeState.dragState.initialLeft = offset ? offset.left : 0;
        ThemeState.dragState.initialTop = offset ? offset.top : 0;
        ThemeState.dragState.winW = window.innerWidth || $(window).width();
        ThemeState.dragState.winH = window.innerHeight || $(window).height();

        if ($trigger[0].setPointerCapture && e.pointerId) {
            try { $trigger[0].setPointerCapture(e.pointerId); } catch (_) {}
        }
    });

    $trigger.on('pointermove', function (e) {
        e = e.originalEvent || e;
        if (!ThemeState.dragState.isDragging) return;
        const dx = e.clientX - ThemeState.dragState.startX;
        const dy = e.clientY - ThemeState.dragState.startY;
        const moveDist = Math.hypot(dx, dy);

        if (!ThemeState.dragState.hasMoved) {
            if (moveDist < DRAG_THRESHOLD) {
                return; // 未达到真正拖拽阈值前保持静止，防手指微抖
            }
            ThemeState.dragState.hasMoved = true;

            // 拖拽时取消粒子引擎的悬浮微动
            if (ThemeState.particleEngine) {
                ThemeState.particleEngine.config.floatAmplitudeX = 0;
                ThemeState.particleEngine.config.floatAmplitudeY = 0;
                ThemeState.particleEngine.config.floatSecondaryAmpX = 0;
                ThemeState.particleEngine.config.floatSecondaryAmpY = 0;
            }
        }

        let newLeft = ThemeState.dragState.initialLeft + dx;
        let newTop = ThemeState.dragState.initialTop + dy;

        newLeft = Math.max(0, Math.min(ThemeState.dragState.winW - 72, newLeft));
        newTop = Math.max(0, Math.min(ThemeState.dragState.winH - 72, newTop));

        $trigger.css({ left: newLeft + 'px', top: newTop + 'px' });

        if (ThemeState.particleEngine) {
            ThemeState.particleEngine.elX = newLeft + 36;
            ThemeState.particleEngine.elY = newTop + 36;
            ThemeState.particleEngine.config.baseX = (newLeft + 36) / ThemeState.dragState.winW;
            ThemeState.particleEngine.config.baseY = (newTop + 36) / ThemeState.dragState.winH;
        }
    });

    const endDrag = function (e) {
        e = e.originalEvent || e;
        if (!ThemeState.dragState.isDragging) return;
        ThemeState.dragState.isDragging = false;
        suppressNativeClick = true;

        const dx = (e.clientX !== undefined ? e.clientX : ThemeState.dragState.startX) - ThemeState.dragState.startX;
        const dy = (e.clientY !== undefined ? e.clientY : ThemeState.dragState.startY) - ThemeState.dragState.startY;
        const moveDist = Math.hypot(dx, dy);

        if ($trigger[0].releasePointerCapture && e.pointerId) {
            try { $trigger[0].releasePointerCapture(e.pointerId); } catch (_) {}
        }

        // 只有正常抬起且未拖动才算轻触；取消事件不打开面板
        if (e.type !== 'pointercancel' && !ThemeState.dragState.hasMoved && moveDist < DRAG_THRESHOLD) {
            triggerClick();
        } else {
            // 恢复悬浮粒子动画
            if (ThemeState.particleEngine) {
                ThemeState.particleEngine.config.floatAmplitudeX = 6;
                ThemeState.particleEngine.config.floatAmplitudeY = 5;
                ThemeState.particleEngine.config.floatSecondaryAmpX = 2.5;
                ThemeState.particleEngine.config.floatSecondaryAmpY = 2;
            }
        }
    };

    $trigger.on('pointerup pointercancel', endDrag);

    // 针对部分浏览器原生 click 事件兜底
    $trigger.on('click', function (e) {
        if (suppressNativeClick) { suppressNativeClick = false; return; }
        if (!ThemeState.dragState.hasMoved) {
            triggerClick();
        }
    });

    // 模态框关闭按钮
    $('.dh-close-btn').off('click').on('click', () => {
        if (ThemeState.engine) ThemeState.engine.close();
    });
}
