// --- Themes ------------------------------------------------------------------
const THEMES = {
  dark: {
    '--panel': 'rgba(18,20,26,0.55)', '--key-bg': 'rgba(255,255,255,0.08)',
    '--key-border': 'rgba(255,255,255,0.16)', '--key-text': 'rgba(240,244,250,0.9)',
    '--active-bg': 'rgba(90,165,255,0.95)', '--active-glow': 'rgba(90,165,255,0.75)',
    '--active-text': '#ffffff', '--blur': '16px', '--radius': '9px',
  },
  light: {
    '--panel': 'rgba(245,247,250,0.78)', '--key-bg': 'rgba(0,0,0,0.05)',
    '--key-border': 'rgba(0,0,0,0.12)', '--key-text': 'rgba(20,24,30,0.85)',
    '--active-bg': 'rgba(30,120,240,0.95)', '--active-glow': 'rgba(30,120,240,0.5)',
    '--active-text': '#ffffff', '--blur': '14px', '--radius': '9px',
  },
  neon: {
    '--panel': 'rgba(10,10,18,0.6)', '--key-bg': 'rgba(180,80,255,0.10)',
    '--key-border': 'rgba(180,80,255,0.32)', '--key-text': 'rgba(230,220,255,0.92)',
    '--active-bg': 'rgba(255,60,180,0.95)', '--active-glow': 'rgba(255,60,180,0.85)',
    '--active-text': '#ffffff', '--blur': '14px', '--radius': '12px',
  },
  contrast: {
    '--panel': 'rgba(0,0,0,0.85)', '--key-bg': 'rgba(255,255,255,0.14)',
    '--key-border': 'rgba(255,255,255,0.5)', '--key-text': '#ffffff',
    '--active-bg': '#ffd400', '--active-glow': 'rgba(255,212,0,0.9)',
    '--active-text': '#000000', '--blur': '4px', '--radius': '6px',
  },
  mono: {
    '--panel': 'rgba(28,28,30,0.5)', '--key-bg': 'rgba(255,255,255,0.06)',
    '--key-border': 'rgba(255,255,255,0.14)', '--key-text': 'rgba(255,255,255,0.75)',
    '--active-bg': 'rgba(255,255,255,0.92)', '--active-glow': 'rgba(255,255,255,0.5)',
    '--active-text': '#111111', '--blur': '12px', '--radius': '8px',
  },
};

function applyTheme(name) {
  const t = THEMES[name] || THEMES.dark;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) root.setProperty(k, v);
}

// --- Layout (id = KeyboardEvent.code names, mapped from uiohook in main.js) ---
const k = (id, label, w = 1, small = false) => ({ id, label, w, small });

const LAYOUT = [
  [
    k('Backquote', '`'), k('Digit1', '1'), k('Digit2', '2'), k('Digit3', '3'),
    k('Digit4', '4'), k('Digit5', '5'), k('Digit6', '6'), k('Digit7', '7'),
    k('Digit8', '8'), k('Digit9', '9'), k('Digit0', '0'), k('Minus', '-'),
    k('Equal', '='), k('Backspace', '⌫', 2, true),
  ],
  [
    k('Tab', 'Tab', 1.5, true),
    k('KeyQ', 'Q'), k('KeyW', 'W'), k('KeyE', 'E'), k('KeyR', 'R'), k('KeyT', 'T'),
    k('KeyY', 'Y'), k('KeyU', 'U'), k('KeyI', 'I'), k('KeyO', 'O'), k('KeyP', 'P'),
    k('BracketLeft', '['), k('BracketRight', ']'), k('Backslash', '\\', 1.5),
  ],
  [
    k('CapsLock', 'Caps', 1.75, true),
    k('KeyA', 'A'), k('KeyS', 'S'), k('KeyD', 'D'), k('KeyF', 'F'), k('KeyG', 'G'),
    k('KeyH', 'H'), k('KeyJ', 'J'), k('KeyK', 'K'), k('KeyL', 'L'),
    k('Semicolon', ';'), k('Quote', "'"), k('Enter', '⏎', 2.25, true),
  ],
  [
    k('ShiftLeft', '⇧ Shift', 2.25, true),
    k('KeyZ', 'Z'), k('KeyX', 'X'), k('KeyC', 'C'), k('KeyV', 'V'), k('KeyB', 'B'),
    k('KeyN', 'N'), k('KeyM', 'M'), k('Comma', ','), k('Period', '.'),
    k('Slash', '/'), k('ShiftRight', '⇧ Shift', 2.25, true),
  ],
  [
    k('ControlLeft', 'Ctrl', 1.5, true),
    k('MetaLeft', '⌘/⊞', 1.25, true),
    k('AltLeft', 'Alt', 1.25, true),
    k('Space', '', 6),
    k('AltRight', 'Alt', 1.25, true),
    k('ControlRight', 'Ctrl', 1.5, true),
    k('ArrowLeft', '◀', 1, true), k('ArrowUp', '▲', 1, true),
    k('ArrowDown', '▼', 1, true), k('ArrowRight', '▶', 1, true),
  ],
];

const els = new Map();

function build() {
  const kb = document.getElementById('keyboard');
  for (const row of LAYOUT) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    for (const def of row) {
      const el = document.createElement('div');
      el.className = 'key' + (def.small ? ' small' : '');
      el.style.flexGrow = String(def.w);
      el.textContent = def.label;
      rowEl.appendChild(el);
      els.set(def.id, el);
    }
    kb.appendChild(rowEl);
  }
}

// --- State -------------------------------------------------------------------
let locked = false;
let autoHide = true;
let displayOpacity = 0.9;
let autoVisible = false;    // shown by recent typing (locked + autoHide)
let forceHidden = false;    // manual hide toggle
let overLockState = false;  // is cursor currently over the lock button

function apply() {
  const kb = document.getElementById('keyboard');
  let o;
  if (!locked) o = 1;
  else if (forceHidden) o = 0;
  else if (!autoHide) o = displayOpacity;
  else o = autoVisible ? displayOpacity : 0;
  kb.style.opacity = String(o);
}

// --- Build + wire ------------------------------------------------------------
build();

window.overlay.onKeyDown((id) => {
  if (locked && autoHide) { autoVisible = true; apply(); }
  if (id && els.has(id)) els.get(id).classList.add('active');
});
window.overlay.onKeyUp((id) => {
  if (id && els.has(id)) els.get(id).classList.remove('active');
});

// Global mouse move (from the OS hook) -> hide body in locked+autoHide mode.
window.overlay.onMouseMove(() => {
  if (locked && autoHide && autoVisible) { autoVisible = false; apply(); }
});

window.overlay.onToggleHide(() => { forceHidden = !forceHidden; apply(); });

// main.js hit-tests the lock button itself (see isOverLockButton there) and
// tells us the result just so we can mirror it in the CSS highlight.
window.overlay.onLockHot((hot) => {
  overLockState = hot;
  document.getElementById('lockBtn').classList.toggle('hot', hot);
});

// --- Dragging ------------------------------------------------------------
// Deliberately NOT using -webkit-app-region:drag here: on Windows it proved
// unreliable at excluding overlapping buttons (the +/- zoom buttons and the
// lock button) from the drag region, so their clicks silently got eaten.
// Instead we track the mouse ourselves and ask main.js to move the window
// (or, while locked, just the lock button) via IPC.

const DRAG_THRESHOLD = 4; // px of movement before a mousedown counts as a drag

function isControl(el) {
  return !!(el && (el.closest('button') || el.closest('select') || el.closest('#lockBtn')));
}

// Whole-window drag (unlocked only): mousedown anywhere that isn't a control.
// We send each mousemove's *incremental* movementX/Y rather than a total
// delta from a captured start point — the latter caused runaway growth and a
// snap-back on release when mixed with the window's live position in main.js.
// Sends are batched to once per animation frame (raw mousemove can fire far
// faster than the window can be repositioned/repainted, which seemed to be
// contributing to the growth).
let winDragActive = false;
let pendingDx = 0;
let pendingDy = 0;
let dragFlushScheduled = false;

function flushDragMove() {
  dragFlushScheduled = false;
  if (pendingDx === 0 && pendingDy === 0) return;
  window.overlay.dragMove(pendingDx, pendingDy);
  pendingDx = 0;
  pendingDy = 0;
}

function queueDragMove(dx, dy) {
  pendingDx += dx;
  pendingDy += dy;
  if (!dragFlushScheduled) {
    dragFlushScheduled = true;
    requestAnimationFrame(flushDragMove);
  }
}

document.addEventListener('mousedown', (e) => {
  if (locked) return;
  if (isControl(e.target)) return;
  winDragActive = true;
  pendingDx = 0;
  pendingDy = 0;
  window.overlay.dragStart();
  e.preventDefault();
});

// Lock-button free drag (locked only): mousedown on the lock button while it's
// the "hot" (click-through-disabled) spot. A plain click with no movement
// still toggles lock; real movement repositions the button instead.
let lockDragStart = null;   // { x, y } screen coords at mousedown
let lockDragConfirmed = false;
let suppressNextLockClick = false;

document.getElementById('lockBtn').addEventListener('mousedown', (e) => {
  if (!locked) return;
  lockDragStart = { x: e.screenX, y: e.screenY };
  lockDragConfirmed = false;
  suppressNextLockClick = false; // clear any stale flag from a prior incomplete gesture
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  // Lock-button drag tracking takes priority while it's underway; while
  // dragging we deliberately skip the normal hover/hot-tracking below so the
  // window doesn't get re-ignored mid-drag.
  if (locked && lockDragStart) {
    // lockDragStart (absolute screen coords at mousedown) is only used to
    // decide whether real dragging has started; the actual position update
    // uses movementX/Y, an incremental per-event delta, applied on top of
    // the button's current position in main.js.
    const totalDx = e.screenX - lockDragStart.x;
    const totalDy = e.screenY - lockDragStart.y;
    if (!lockDragConfirmed && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD) lockDragConfirmed = true;
    if (lockDragConfirmed) window.overlay.lockDragMove(e.movementX, e.movementY);
    return;
  }

  if (locked) {
    // Selective click-through while locked (only the lock button is
    // clickable) is now hit-tested and toggled entirely in main.js, using the
    // global mouse hook - see isOverLockButton() there. Doing it there
    // (rather than via Electron's forwarded-mouse-while-ignoring mechanism,
    // as before) avoids a coordinate mismatch that mechanism has under the
    // forced "System" DPI scaling fix (see ensureWindowsDpiFix in main.js).
    // window.overlay.onLockHot() below just mirrors that state for the CSS
    // highlight.
    return;
  }

  // Unlocked: dragging the whole window using each event's incremental delta,
  // batched to once per animation frame.
  if (winDragActive) {
    queueDragMove(e.movementX, e.movementY);
  }
});

document.addEventListener('mouseup', () => {
  if (winDragActive) {
    winDragActive = false;
    flushDragMove(); // don't drop any movement that hasn't been sent yet
    window.overlay.dragEnd();
  }
  if (lockDragStart) {
    if (lockDragConfirmed) {
      window.overlay.lockDragEnd();
      suppressNextLockClick = true; // don't also toggle lock from the click that follows
    }
    lockDragStart = null;
    lockDragConfirmed = false;
  }
});

// Lock button toggles lock/unlock (skipped if that mouseup was actually a drag).
document.getElementById('lockBtn').addEventListener('click', () => {
  if (suppressNextLockClick) { suppressNextLockClick = false; return; }
  window.overlay.command('toggle-lock');
});

// Unlocked toolbar
document.querySelectorAll('[data-cmd]').forEach((b) => {
  b.addEventListener('click', () => window.overlay.command(b.dataset.cmd));
});

// --- State from main ---------------------------------------------------------
let prevLocked = null;

window.overlay.onState((s) => {
  locked = s.locked;
  autoHide = s.autoHide;
  displayOpacity = s.displayOpacity;

  document.documentElement.style.setProperty('--scale', s.scale);
  applyTheme(s.theme);

  const label = document.getElementById('scaleLabel');
  if (label) label.textContent = Math.round(s.scale * 100) + '%';

  const root = document.getElementById('root');
  root.classList.toggle('locked', locked);
  root.classList.toggle('unlocked', !locked);
  root.setAttribute('data-lock', s.lockPos || 'right');
  document.getElementById('lockIcon').textContent = locked ? '🔒' : '🔓';
  document.getElementById('toolbar').classList.toggle('hidden', locked);

  // Free-dragged lock button position overrides the left/center/right preset.
  const lockBtnEl = document.getElementById('lockBtn');
  if (s.lockCustom) {
    lockBtnEl.style.left = (s.lockCustom.xPct * 100) + '%';
    lockBtnEl.style.top = (s.lockCustom.yPct * 100) + '%';
    lockBtnEl.style.right = 'auto';
    lockBtnEl.style.transform = 'none';
  } else {
    lockBtnEl.style.left = '';
    lockBtnEl.style.top = '';
    lockBtnEl.style.right = '';
    lockBtnEl.style.transform = '';
  }

  // reset click-through hit-test state on any mode change
  overLockState = false;
  document.getElementById('lockBtn').classList.remove('hot');

  // When entering locked mode, reveal once so it's clear it's live (then it
  // will hide on the next mouse move if auto-hide is on).
  if (prevLocked !== locked) {
    autoVisible = locked;   // show right after locking; irrelevant when unlocked
    prevLocked = locked;
  }

  apply();
});

apply();
