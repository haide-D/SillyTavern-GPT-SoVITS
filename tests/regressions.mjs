import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const theme of ['deathly_hallows', 'immortal_sword', 'sakura_elegance', 'cyberpunk_edgerunners']) {
    const handlers = {};
    let toggles = 0;
    let captured = null;
    const drag = {};
    const trigger = {
        length: 1,
        0: { setPointerCapture: id => captured = id, releasePointerCapture() {} },
        off() { return this; },
        on(events, fn) { for (const e of events.split(' ')) handlers[e] = fn; return this; },
        offset: () => ({ left: 50, top: 50 }),
        css: () => '50px', width: () => 1000, height: () => 800,
    };
    let source = fs.readFileSync(`frontend/js/themes/${theme}/ui.js`, 'utf8');
    source = source.slice(source.indexOf('export function bindDragAndClick()'));
    source = source.split('export function destroy')[0].replace('export function', 'function');
    let now = 1000;
    vm.runInNewContext(source + '\nbindDragAndClick();', {
        $: selector => selector === '.dh-close-btn' ? { off() { return this; }, on() { return this; } } : trigger, ThemeState: { drag, dragState: drag, engine: { toggle: () => toggles++ } },
        DRAG_THRESHOLD: 15, fixTriggerPosition() {},
        window: { innerWidth: 1000, innerHeight: 800 }, localStorage: { setItem() {} },
        Date: { now: () => now },
    });
    const event = (type, x = 0) => ({ originalEvent: { type, pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: 0 } });
    handlers.pointerdown(event('pointerdown'));
    handlers.pointerup(event('pointerup'));
    assert.equal(captured, 7, `${theme}: native pointer captured through jQuery`);
    assert.equal(toggles, 1);
    now += 500;
    handlers.click({});
    assert.equal(toggles, 1, `${theme}: delayed native click does not close panel`);
    handlers.pointerdown(event('pointerdown'));
    handlers.pointercancel(event('pointercancel'));
    handlers.click({});
    assert.equal(toggles, 1, `${theme}: cancellation does not open panel`);
    handlers.pointerdown(event('pointerdown'));
    handlers.pointermove(event('pointermove', 30));
    handlers.pointerup(event('pointerup', 30));
    handlers.click({});
    assert.equal(toggles, 1, `${theme}: drag does not open panel`);
}

globalThis.window = {};
globalThis.$ = () => ({ length: 0 });
const { CallQueueManager: Queue } = await import('../frontend/js/call_queue_manager.js');
Queue.enqueue({ call_id: 1, char_name: 'Alice', avatar_url: 'alice.png' });
Queue.enqueue({ call_id: 2, selected_speaker: 'Bob', avatar_url: 'bob.png', target: 'User' });
const next = Queue.next();
assert.equal(next.char_name, 'Bob');
assert.equal(next.avatar_url, 'bob.png');
assert.equal(next.target, 'User');
assert.equal(window.TTS_IncomingCall, next);

const { ChatInjector } = await import('../frontend/js/chat_injector.js');
const events = [];
await ChatInjector._refreshMessage({
    updateMessageBlock: async (id) => events.push(['render', id]),
    eventTypes: { MESSAGE_UPDATED: 'updated', CHARACTER_MESSAGE_RENDERED: 'rendered' },
    eventSource: { emit: async (...args) => events.push(args) },
}, 3, {});
assert.deepEqual(events, [['render', 3], ['updated', 3], ['rendered', 3]]);

const { AudioPlayer } = await import('../frontend/js/mobile_apps/shared/audio_player.js');
let frame;
globalThis.requestAnimationFrame = fn => { frame = fn; return 1; };
globalThis.cancelAnimationFrame = () => { frame = null; };
const seen = [];
const player = Object.create(AudioPlayer.prototype);
player.audio = { currentTime: 1.25, paused: false, ended: false };
player._syncSubtitle = time => seen.push(time);
player._startSubtitleClock();
player.audio.currentTime = 1.30;
frame();
assert.deepEqual(seen, [1.25, 1.30]);
player._stopSubtitleClock();
assert.equal(frame, null);
console.log('Frontend regressions passed: four themes, queue, rendering lifecycle, subtitle clock.');

const { WorldInfoExtractor } = await import('../frontend/js/world_info_extractor.js');
let scanArgs;
let ctx = { chatId: 'chat-a', characterId: 0, name1: 'User', maxContext: 12000,
    characters: [{ description: 'persona' }], chat: [{ mes: 'older' }, { mes: 'newer' }],
    getWorldInfoPrompt: async (...args) => {
        scanArgs = args;
        return { worldInfoBefore: 'nickname rule', worldInfoAfter: '', worldInfoDepth: [{ content: 'depth lore' }], outletEntries: { extra: ['outlet lore'] } };
    }
};
window.SillyTavern = { getContext: () => ctx };
assert.equal(await WorldInfoExtractor.refreshWorldInfo(), 'nickname rule\n---\ndepth lore\n---\noutlet lore');
assert.deepEqual(scanArgs.slice(0, 3), [['newer', 'older'], 12000, true]);
assert.equal(scanArgs[3].characterDescription, 'persona');
ctx = { ...ctx, chatId: 'chat-b' };
assert.equal(WorldInfoExtractor.getWorldInfo(), '', 'world info cannot leak across chats');
ctx.getWorldInfoPrompt = async () => ({ worldInfoBefore: '', worldInfoAfter: '' });
assert.equal(await WorldInfoExtractor.refreshWorldInfo(), '', 'empty activation clears old lore');

let dismiss;
const dialog = { style: { display: 'flex' } };
vm.runInNewContext(fs.readFileSync('admin/js/dialog-controls.js', 'utf8'), {
    document: { addEventListener: (_, fn) => dismiss = fn, getElementById: id => id === 'notice-dialog' ? dialog : null }
});
dismiss({ target: { closest: () => ({ dataset: { closeDialog: 'notice-dialog' } }) } });
assert.equal(dialog.style.display, 'none');
console.log('World info scan and standalone dialog dismissal regressions passed.');
