const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage, dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { uIOhook, UiohookKey } = require('uiohook-napi');

const APP_DISPLAY_NAME = 'LucidKeyboard';
const APP_AUTHOR = 'Night Master';
const APP_ABOUT_DESC = '这是一个透明的屏幕键盘';

app.setName(APP_DISPLAY_NAME);
// Windows: without this, the taskbar/toast notifications group the app under
// the generic "Electron" identity (especially in unpackaged dev mode).
if (process.platform === 'win32') {
  app.setAppUserModelId('com.bh4gxx.lucidkeyboard');
}

// --- Windows DPI fix: force "System" DPI scaling for this exe ---------------
// Root cause of the "keyboard grows disproportionately while being dragged"
// bug: Electron's per-monitor-v2 DPI awareness makes Windows live-rescale the
// window's pixel mapping as it moves. Confirmed fix: Properties > Compatibility
// > "Change high DPI settings" > Override, scaling performed by "System" - but
// that's a manual, per-machine, per-exe-path setting a user would have to
// apply themselves (and can't even reach if the exe is run off a network
// drive). An app manifest change alone does NOT override this, because
// Electron/Chromium explicitly requests per-monitor-v2 awareness via a WinAPI
// call at startup, which takes precedence over the static manifest.
//
// The Compatibility checkbox itself is just a per-user registry entry
// (HKCU\...\AppCompatFlags\Layers, keyed by the exe's own full path) that
// Windows' compatibility shim enforces *before* the process's own DPI
// awareness call ever runs - so we can set that same entry for ourselves.
// DPI awareness is decided at process creation, before any of our JS runs, so
// on first launch we write the entry and relaunch once; every launch after
// that, the entry is already there and we start straight up as normal.
function ensureWindowsDpiFix() {
  if (process.platform !== 'win32') return;
  const { execFileSync } = require('child_process');
  const exePath = process.execPath; // electron.exe in dev, LucidKeyboard.exe when packaged
  const keyPath = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';
  // The three "Override high DPI scaling behavior" options each map to a
  // different flag, and it's easy to get backwards:
  //   Application        -> ~ HIGHDPIAWARE
  //   System              -> ~ DPIUNAWARE          <- this is the one that
  //   System (Enhanced)   -> ~ GDIDPISCALING DPIUNAWARE   fixed it, confirmed
  // by testing "System" manually in Properties > Compatibility.
  const desired = '~ DPIUNAWARE';

  let current = null;
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', exePath], { encoding: 'utf8' });
    const m = out.match(/REG_SZ\s+(.+)/);
    current = m ? m[1].trim() : null;
  } catch (_) {
    current = null; // value doesn't exist yet
  }

  // Match "System" specifically, not "System (Enhanced)" (which also
  // contains the substring DPIUNAWARE but via GDIDPISCALING DPIUNAWARE).
  if (current && /(^|\s)DPIUNAWARE(\s|$)/.test(current) && !/GDIDPISCALING/.test(current)) return;

  try {
    execFileSync('reg', ['add', keyPath, '/v', exePath, '/t', 'REG_SZ', '/d', desired, '/f'], { stdio: 'ignore' });
  } catch (err) {
    console.warn('[dpi-fix] Could not write AppCompatFlags registry entry:', err.message);
    return; // proceed without the fix rather than block startup
  }

  // The entry only affects *new* process instances, so relaunch once now.
  app.relaunch();
  app.exit(0);
}

// --- Network-drive fix: AppCompatFlags is ignored for non-local exes --------
// Confirmed (and matches the "another machine, network drive" report): the
// HKCU\...\AppCompatFlags\Layers entry ensureWindowsDpiFix writes above is
// only honored by Windows when the target exe lives on a genuinely local,
// fixed drive. For an exe launched off a mapped network drive or a UNC path,
// Windows silently ignores the entry - it instead expects an undocumented
// "SIGN.MEDIA=<hash> <relative-path>" value name that only the Program
// Compatibility Assistant itself knows how to generate, which isn't something
// we can reliably reproduce from code. So on a network-hosted install, the
// drag-growth bug persists even with the exactly-correct "~ DPIUNAWARE" value
// sitting in the registry.
//
// Workaround: only the *launched executable's own path* needs to be local for
// the compat shim to kick in - the app code/assets it loads afterward
// (main.js, index.html, etc.) can stay wherever they are, network drive
// included. So if we detect we were launched from a network location, copy
// just the runtime folder containing the exe (electron.exe + its dlls/
// resources in dev, or the packaged app's install folder) to a local, fixed
// path once, and relaunch from there.
const LOCAL_RUNTIME_DIR = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  'LucidKeyboard', 'dpi-runtime',
);

function isNetworkPath(p) {
  if (!p) return false;
  if (p.startsWith('\\\\')) return true; // UNC path: \\server\share\...
  const m = /^([A-Za-z]):\\/.exec(p);
  if (!m) return false;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('fsutil', ['fsinfo', 'drivetype', `${m[1]}:`], { encoding: 'utf8' });
    return /Remote Drive/i.test(out);
  } catch (_) {
    return false; // can't tell - assume local rather than needlessly copy
  }
}

function ensureLocalRuntime() {
  if (process.platform !== 'win32') return false;
  if (!isNetworkPath(process.execPath)) return false;
  if (process.execPath.startsWith(LOCAL_RUNTIME_DIR)) return false; // already the local copy

  const srcDir = path.dirname(process.execPath);
  const exeName = path.basename(process.execPath);
  const destExe = path.join(LOCAL_RUNTIME_DIR, exeName);
  const stampPath = path.join(LOCAL_RUNTIME_DIR, '.source-stamp.json');

  let needsCopy = true;
  try {
    const srcStat = fs.statSync(process.execPath);
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    if (fs.existsSync(destExe) && stamp.size === srcStat.size && stamp.mtimeMs === srcStat.mtimeMs) {
      needsCopy = false;
    }
  } catch (_) { /* no valid stamp yet: (re)copy */ }

  if (needsCopy) {
    try {
      fs.rmSync(LOCAL_RUNTIME_DIR, { recursive: true, force: true });
      fs.mkdirSync(LOCAL_RUNTIME_DIR, { recursive: true });
      fs.cpSync(srcDir, LOCAL_RUNTIME_DIR, { recursive: true });
      const srcStat = fs.statSync(process.execPath);
      fs.writeFileSync(stampPath, JSON.stringify({ size: srcStat.size, mtimeMs: srcStat.mtimeMs }));
    } catch (err) {
      console.warn('[dpi-fix] Could not copy runtime locally, staying on network path:', err.message);
      return false; // give up gracefully - growth bug persists, but app still runs
    }
  }

  if (!fs.existsSync(destExe)) return false;

  app.relaunch({ execPath: destExe, args: process.argv.slice(1) });
  app.exit(0);
  return true;
}

if (!ensureLocalRuntime()) {
  ensureWindowsDpiFix();
}

const BASE_W = 940;
const BASE_H = 300;
const THEME_NAMES = ['dark', 'light', 'neon', 'contrast', 'mono'];
const LOCK_POSITIONS = ['left', 'center', 'right'];
const SCALE_MIN = 0.5;
const SCALE_MAX = 1.8;

let win = null;
let tray = null;
let saveTimer = null;
let programmatic = false;   // guards programmatic setBounds from being saved as a user move
let quitting = false;       // true once we've genuinely decided to quit (vs. close-to-tray)

let settings = {
  x: null,                  // desired top-left (global/virtual screen coords)
  y: null,
  scale: 1,
  theme: 'dark',
  lockPos: 'right',         // lock button preset corner: left | center | right (used when lockCustom is null)
  lockCustom: null,         // { xPct, yPct } free position set by dragging the lock button while locked
  locked: false,
  autoHide: true,
  displayOpacity: 0.9,
};

// Drag bookkeeping (JS-driven; we don't rely on -webkit-app-region since it
// unreliably swallowed clicks on buttons that overlapped a drag region).
// Position updates are applied as incremental deltas (from the renderer's
// MouseEvent.movementX/Y) on top of the window's *current* live position,
// rather than re-deriving an absolute position from a captured start point +
// total delta — mixing an old absolute reference with new absolute screen
// coordinates is what caused the runaway/disproportionate growth and the
// window snapping back on release.
let winDragActive = false;
let lockDragActive = false;

const LOCK_BTN_SIZE = 30;
const LOCK_BTN_MARGIN = 6;
function lockPresetPixel(pos, w, h) {
  if (pos === 'left') return { x: LOCK_BTN_MARGIN, y: LOCK_BTN_MARGIN };
  if (pos === 'center') return { x: (w - LOCK_BTN_SIZE) / 2, y: LOCK_BTN_MARGIN };
  return { x: w - LOCK_BTN_SIZE - LOCK_BTN_MARGIN, y: LOCK_BTN_MARGIN }; // right (default)
}

// --- Persistence -------------------------------------------------------------
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = { ...settings, ...raw };
    settings.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, settings.scale || 1));
    if (!THEME_NAMES.includes(settings.theme)) settings.theme = 'dark';
    if (!LOCK_POSITIONS.includes(settings.lockPos)) settings.lockPos = 'right';
    if (!settings.lockCustom || typeof settings.lockCustom.xPct !== 'number'
        || typeof settings.lockCustom.yPct !== 'number') settings.lockCustom = null;
  } catch (_) { /* first run: defaults */ }
}

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch (_) {}
  }, 250);
}

// --- uiohook keycode -> renderer key id --------------------------------------
function buildCodeMap() {
  const m = {};
  const K = UiohookKey || {};
  const add = (code, id) => { if (code !== undefined && code !== null) m[code] = id; };

  add(K.Backquote, 'Backquote');
  ['1','2','3','4','5','6','7','8','9','0'].forEach((d) => add(K[d], 'Digit' + d));
  add(K.Minus, 'Minus'); add(K.Equal, 'Equal'); add(K.Backspace, 'Backspace');

  add(K.Tab, 'Tab');
  for (const c of 'QWERTYUIOP') add(K[c], 'Key' + c);
  add(K.BracketLeft, 'BracketLeft'); add(K.BracketRight, 'BracketRight'); add(K.Backslash, 'Backslash');

  add(K.CapsLock, 'CapsLock');
  for (const c of 'ASDFGHJKL') add(K[c], 'Key' + c);
  add(K.Semicolon, 'Semicolon'); add(K.Quote, 'Quote'); add(K.Enter, 'Enter');

  add(K.Shift, 'ShiftLeft');
  for (const c of 'ZXCVBNM') add(K[c], 'Key' + c);
  add(K.Comma, 'Comma'); add(K.Period, 'Period'); add(K.Slash, 'Slash'); add(K.ShiftRight, 'ShiftRight');

  add(K.Ctrl, 'ControlLeft'); add(K.Meta, 'MetaLeft'); add(K.Alt, 'AltLeft');
  add(K.Space, 'Space');
  add(K.AltRight, 'AltRight'); add(K.CtrlRight, 'ControlRight'); add(K.MetaRight, 'MetaLeft');

  add(K.ArrowLeft, 'ArrowLeft'); add(K.ArrowUp, 'ArrowUp');
  add(K.ArrowDown, 'ArrowDown'); add(K.ArrowRight, 'ArrowRight');
  add(K.Escape, 'Escape');
  return m;
}
const CODE_TO_ID = buildCodeMap();

// --- Placement (multi-monitor aware) -----------------------------------------
function winSize() {
  return { w: Math.round(BASE_W * settings.scale), h: Math.round(BASE_H * settings.scale) };
}

// Is a rect visibly on any connected display's work area?
function rectVisible(x, y, w, h) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const iw = Math.min(x + w, a.x + a.width) - Math.max(x, a.x);
    const ih = Math.min(y + h, a.y + a.height) - Math.max(y, a.y);
    return iw > 60 && ih > 40;   // require a usable sliver on-screen
  });
}

// Resolve where to actually place the window given the *desired* coords.
function computePlacement(desiredX, desiredY) {
  const { w, h } = winSize();
  if (desiredX != null && desiredY != null && rectVisible(desiredX, desiredY, w, h)) {
    return { x: desiredX, y: desiredY, w, h };
  }
  const a = screen.getPrimaryDisplay().workArea;               // fallback: primary, bottom-centre
  return { x: Math.round(a.x + (a.width - w) / 2), y: a.y + a.height - h - 40, w, h };
}

function setBoundsSafe(bounds) {
  if (!win || win.isDestroyed()) return;
  // Never fight an active JS-driven drag. On Windows, dragging the overlay
  // near an auto-hide taskbar can fire 'display-metrics-changed' repeatedly
  // as the taskbar reveals/retracts; if that reaches placeWindow() mid-drag,
  // the resizable-toggle dance below collides with our own setPosition calls
  // and the window's real size runs away (reported as runaway, disproportionate
  // growth that continues even while the mouse is held still).
  if (winDragActive || lockDragActive) return;
  programmatic = true;
  // Electron/Windows: when a BrowserWindow is created with resizable:false,
  // setBounds()/setSize() can silently no-op. Toggling resizable around the
  // call is the standard workaround; the window is still not user-resizable
  // since we flip it straight back off. setPosition/setSize are called as a
  // belt-and-suspenders fallback in case setBounds alone doesn't take on a
  // transparent frameless window.
  win.setResizable(true);
  win.setBounds(bounds);
  win.setPosition(Math.round(bounds.x), Math.round(bounds.y));
  win.setSize(Math.round(bounds.width), Math.round(bounds.height));
  win.setResizable(false);
  setTimeout(() => { programmatic = false; }, 80);
}

// Re-apply desired coords, clamped to what's currently visible. Used on startup
// and whenever the display arrangement changes (monitor plugged/unplugged).
function placeWindow() {
  if (winDragActive || lockDragActive) return; // let the active drag finish undisturbed
  const p = computePlacement(settings.x, settings.y);
  setBoundsSafe({ x: p.x, y: p.y, width: p.w, height: p.h });
}

// --- Window ------------------------------------------------------------------
function createWindow() {
  const p = computePlacement(settings.x, settings.y);

  win = new BrowserWindow({
    width: p.w, height: p.h, x: p.x, y: p.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    // Belt-and-suspenders for icon visibility beyond the tray: this covers
    // Alt-Tab and any other place Windows shows a per-window icon. The
    // packaged exe's own icon (Start Menu, shortcuts, taskbar program list)
    // comes from electron-builder's build.win.icon in package.json instead -
    // that's baked into the exe resource itself, not something this option
    // controls, which is why a bad/missing exe icon needed fixing separately.
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setSkipTaskbar(true); // redundant with the constructor option, belt-and-suspenders on Windows
  win.setTitle(APP_DISPLAY_NAME); // belt-and-suspenders: index.html's <title> also sets this on load
  applyInteractivity();

  // Only genuine user drags (unlocked, non-programmatic) update the remembered spot.
  win.on('moved', () => {
    if (settings.locked || programmatic) return;
    const [nx, ny] = win.getPosition();
    settings.x = nx; settings.y = ny;
    saveSettings();
  });

  // Closing the window (Alt+F4, etc.) hides it instead of destroying it, so the
  // tray icon can always bring it back. Only an explicit Quit really exits.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });

  // Self-healing guard against unwanted resizes. Confirmed cause: on displays
  // with non-100% Windows scaling, per-monitor DPI virtualization rescales the
  // window's physical<->logical pixel mapping live as it's repositioned —
  // this is native OS behavior, not something our own code is doing, and it
  // tracks mouse movement exactly (grows while moving, stops when still).
  // We deliberately do NOT fight it mid-drag (racing our own setSize against
  // whatever Windows is doing produced worse results: rounding noise from one
  // correction retriggered another 'resize', which could itself drift instead
  // of converge). Instead we let the drag be visually whatever it is, then
  // snap firmly back to the correct size once the drag actually ends.
  win.on('resize', () => {
    if (programmatic || winDragActive || lockDragActive || !win || win.isDestroyed()) return;
    const { w, h } = winSize();
    const b = win.getBounds();
    // A couple of pixels of slack: at non-100% scale, logical<->physical
    // pixel round-tripping can legitimately be off by ~1px with nothing wrong.
    if (Math.abs(b.width - w) > 2 || Math.abs(b.height - h) > 2) {
      programmatic = true;
      win.setSize(w, h);
      setTimeout(() => { programmatic = false; }, 80);
    }
  });

  win.loadFile('index.html');
  win.webContents.on('did-finish-load', pushState);
}

function toggleWindowVisibility() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    if (!settings.locked) win.focus();
  }
  refreshTrayMenu();
}

function applyInteractivity() {
  if (!win || win.isDestroyed()) return;
  if (settings.locked) {
    // No {forward:true} - the lock button's hover/hot state is now
    // hit-tested directly in the uiohook mousemove handler (see
    // isOverLockButton above), which toggles this flag itself as needed.
    win.setIgnoreMouseEvents(true);
    win.setFocusable(false);
  } else {
    win.setIgnoreMouseEvents(false);
    win.setFocusable(true);
  }
}

function applyScale() {
  if (!win || win.isDestroyed()) return;
  const { w, h } = winSize();
  const b = win.getBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const p = computePlacement(Math.round(cx - w / 2), Math.round(cy - h / 2));
  setBoundsSafe({ x: p.x, y: p.y, width: w, height: h });
  settings.x = p.x; settings.y = p.y;
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', { ...settings });
}

// --- Auto-launch -------------------------------------------------------------
function linuxAutostartPath() {
  return path.join(app.getPath('home'), '.config', 'autostart', 'lucidkeyboard.desktop');
}

function getAutoLaunch() {
  if (process.platform === 'linux') {
    try { return fs.existsSync(linuxAutostartPath()); } catch (_) { return false; }
  }
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoLaunch(enable) {
  if (process.platform === 'linux') {
    const p = linuxAutostartPath();
    try {
      if (enable) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const exec = process.env.APPIMAGE || process.execPath;
        fs.writeFileSync(p,
          `[Desktop Entry]\nType=Application\nName=${APP_DISPLAY_NAME}\n` +
          `Exec=${exec}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`);
      } else if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch (_) {}
  } else {
    app.setLoginItemSettings({ openAtLogin: enable, openAsHidden: true });
  }
  refreshTrayMenu();
}

// --- Mutators ----------------------------------------------------------------
function setScale(s) {
  if (settings.locked) return;
  settings.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(s * 100) / 100));
  applyScale();
  saveSettings(); pushState(); refreshTrayMenu();
}
function setTheme(name) {
  if (!THEME_NAMES.includes(name)) return;
  settings.theme = name;
  saveSettings(); pushState(); refreshTrayMenu();
}
function setLocked(v) {
  settings.locked = v;
  applyInteractivity();
  if (!v && win) win.focus();
  saveSettings(); pushState(); refreshTrayMenu();
}
function setAutoHide(v) { settings.autoHide = v; saveSettings(); pushState(); refreshTrayMenu(); }
function setOpacity(v) { settings.displayOpacity = v; saveSettings(); pushState(); refreshTrayMenu(); }

// --- Tray --------------------------------------------------------------------
function trayImage() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function buildTray() {
  tray = new Tray(trayImage());
  tray.setToolTip(`${APP_DISPLAY_NAME} — keystroke visualizer`);
  tray.on('click', () => toggleWindowVisibility());
  refreshTrayMenu();
}

function showAbout() {
  dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'info',
    title: `About ${APP_DISPLAY_NAME}`,
    message: APP_DISPLAY_NAME,
    detail: `${APP_ABOUT_DESC}\n\nAuthor: ${APP_AUTHOR}`,
    buttons: ['OK'],
    noLink: true,
  });
}

function refreshTrayMenu() {
  const themeItems = THEME_NAMES.map((name) => ({
    label: name[0].toUpperCase() + name.slice(1),
    type: 'radio',
    checked: settings.theme === name,
    click: () => setTheme(name),
  }));

  const opacityItems = [0.2, 0.35, 0.5, 0.7, 0.9].map((v) => ({
    label: `${Math.round(v * 100)}%`,
    type: 'radio',
    checked: Math.abs(settings.displayOpacity - v) < 0.001,
    click: () => setOpacity(v),
  }));

  const isVisible = !!(win && !win.isDestroyed() && win.isVisible());

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: APP_DISPLAY_NAME, enabled: false },
    { type: 'separator' },
    {
      label: isVisible ? 'Hide keyboard' : 'Show keyboard',
      click: () => toggleWindowVisibility(),
    },
    {
      label: settings.locked ? 'Unlock (move / resize)' : 'Lock (click-through)',
      accelerator: 'CmdOrCtrl+Alt+K',
      click: () => setLocked(!settings.locked),
    },
    {
      label: 'Auto-hide on mouse move',
      type: 'checkbox',
      checked: settings.autoHide,
      click: () => setAutoHide(!settings.autoHide),
    },
    { label: 'Theme', submenu: themeItems },
    { label: 'Display opacity', submenu: opacityItems },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: getAutoLaunch(),
      click: () => setAutoLaunch(!getAutoLaunch()),
    },
    { type: 'separator' },
    { label: `About ${APP_DISPLAY_NAME}`, click: () => showAbout() },
    { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
  ]));
}

// --- IPC from renderer -------------------------------------------------------
ipcMain.on('command', (_e, { name, value }) => {
  if (name === 'zoom-in') setScale(settings.scale + 0.1);
  else if (name === 'zoom-out') setScale(settings.scale - 0.1);
  else if (name === 'set-theme') setTheme(value);
  else if (name === 'toggle-lock') setLocked(!settings.locked);
});

ipcMain.on('set-ignore', (_e, ignore) => {
  if (!win || win.isDestroyed() || !settings.locked) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});

// --- JS-driven whole-window drag (unlocked only) -----------------------------
// We don't use -webkit-app-region:drag for this: on Windows it unreliably
// swallowed clicks on buttons/lockBtn that overlapped the drag region. Instead
// the renderer tracks the mouse itself and sends us each step's incremental
// movementX/Y, which we add on top of the window's current live position.
// (An earlier version re-derived an absolute target from a captured start
// point + total on-screen delta; mixing that stale reference with fresh
// screen coordinates is what caused runaway growth and a snap-back on release.)
ipcMain.on('drag-start', () => {
  if (!win || win.isDestroyed() || settings.locked) return;
  winDragActive = true;
});
ipcMain.on('drag-move', (_e, { dx, dy }) => {
  if (!win || win.isDestroyed() || settings.locked || !winDragActive) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + Math.round(dx), y + Math.round(dy));
});
ipcMain.on('drag-end', () => {
  winDragActive = false;
  if (win && !win.isDestroyed()) {
    // Snap firmly back to the correct size in case Windows' per-monitor DPI
    // rescaling nudged our real size while dragging (see the 'resize' handler
    // above — we deliberately don't fight it mid-drag, so clean up here).
    const { w, h } = winSize();
    const b = win.getBounds();
    if (b.width !== w || b.height !== h) {
      programmatic = true;
      win.setSize(w, h);
      setTimeout(() => { programmatic = false; }, 80);
    }
    const [x, y] = win.getPosition();
    settings.x = x; settings.y = y;
    saveSettings();
  }
});

// --- Lock-button free drag (locked only) -------------------------------------
// Lets you drag just the lock button to reposition it while everything else
// stays click-through. A plain click (no movement) still toggles lock, same
// as before; this only kicks in once real movement is detected. Same
// incremental-delta approach as the whole-window drag above.
ipcMain.on('lock-drag-move', (_e, { dx, dy }) => {
  if (!win || win.isDestroyed() || !settings.locked) return;
  lockDragActive = true;
  const b = win.getBounds();
  const cur = settings.lockCustom
    ? { x: settings.lockCustom.xPct * b.width, y: settings.lockCustom.yPct * b.height }
    : lockPresetPixel(settings.lockPos, b.width, b.height);
  const nx = Math.max(0, Math.min(b.width - LOCK_BTN_SIZE, cur.x + dx));
  const ny = Math.max(0, Math.min(b.height - LOCK_BTN_SIZE, cur.y + dy));
  settings.lockCustom = { xPct: nx / b.width, yPct: ny / b.height };
  pushState();
});
ipcMain.on('lock-drag-end', () => {
  if (lockDragActive) saveSettings();
  lockDragActive = false;
});

// --- Runtime DPI detection ----------------------------------------------------
// Debug logging (LK_DEBUG_LOCK=1) nailed the actual bug with real numbers:
// at 125%, cursor=(1337,802) with the lock button rect at x:1057-1087,
// y:625-655, and dpiAwareness correctly read as 0 (DPI_UNAWARE, matching the
// no-more-growth confirmation). Dividing the cursor coordinate by 1 (what
// screen.getPrimaryDisplay().scaleFactor reports) lands nowhere near the
// button; dividing by the monitor's *true* 1.25 scale lands it exactly inside
// the button rect (1069.6, 641.6). So the real mismatch was never about
// whether to divide based on aware-vs-unaware - it's that uiohook's global
// low-level mouse hook always reports true physical-pixel coordinates,
// completely independent of our own process's DPI-awareness declaration,
// while Electron's win.getBounds() (and, once we're forced DPI-unaware,
// screen.getPrimaryDisplay().scaleFactor too) get virtualized/misreported
// relative to that same true monitor scale. We always need to convert by the
// monitor's *real* scale factor - not Electron's self-reported one, which
// Windows quietly lies about (reports 1) once our process is DPI-unaware.
// Getting the true value means asking outside our own (deliberately
// DPI-unaware) process: a one-off PowerShell/P-Invoke call to
// GetDpiForMonitor, run as its own process, isn't subject to our process's
// DPI-awareness override and reports the monitor's actual DPI. We still also
// read GetProcessDpiAwareness in the same call, purely for diagnostics/log
// visibility (see dpiAwareness in the LK_DEBUG_LOCK log) - it no longer gates
// any hit-test math itself.
let dpiAwareness = null; // 0 = DPI_UNAWARE, 1 = SYSTEM_AWARE, 2 = PER_MONITOR_AWARE, null = unknown
let realScaleFactor = null; // the monitor's true DPI scale (e.g. 1.25 at 125%), independent of our own process's awareness
function detectDpiInfo() {
  if (process.platform !== 'win32') return;
  // Write the script to a real .ps1 file and invoke it with -File: passing a
  // multi-quote, multi-statement script inline as a single -Command argument
  // (an earlier version) is fragile, since Node's own argv->command-line
  // quoting for CreateProcess on Windows doesn't understand PowerShell's own
  // quoting rules, and that silent mis-parse is what caused the lock button
  // to regress on the very machine this was meant to help. -File sidesteps
  // command-line quoting entirely - only a plain numeric PID crosses that boundary.
  const scriptPath = path.join(os.tmpdir(), 'lucidkeyboard-dpi-check.ps1');
  const psScript = [
    'param([int]$ProcId)',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public struct LkPoint { public int X; public int Y; }',
    'public class LkDpi {',
    '  [DllImport("shcore.dll")] public static extern int GetProcessDpiAwareness(IntPtr hprocess, out int value);',
    '  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
    '  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(LkPoint pt, uint flags);',
    '  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);',
    '  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);',
    '}',
    '"@',
    // realScaleFactor came back as 1 on a machine actually running 125%: plain
    // powershell.exe doesn't declare DPI awareness in its own manifest either,
    // so it defaults to DPI-unaware just like our own Electron process did -
    // and GetDpiForMonitor silently returns a flat 96 DPI to callers that
    // aren't themselves per-monitor aware, regardless of the monitor's real
    // DPI. We hit the exact same virtualization bug one process over. Fix:
    // make *this* short-lived helper process per-monitor aware before asking
    // it anything DPI-related - it's a fresh process that hasn't touched any
    // window/GDI APIs yet, so this is safe to call unconditionally here.
    '[LkDpi]::SetProcessDpiAwareness(2) | Out-Null', // PROCESS_PER_MONITOR_DPI_AWARE = 2
    '$h = [LkDpi]::OpenProcess(0x0400, $false, $ProcId)',
    '$awareVal = 0',
    '[LkDpi]::GetProcessDpiAwareness($h, [ref]$awareVal) | Out-Null',
    '$pt = New-Object LkPoint',
    '$pt.X = 0; $pt.Y = 0',
    '$hMon = [LkDpi]::MonitorFromPoint($pt, 1)', // MONITOR_DEFAULTTOPRIMARY = 1
    '$dpiX = 0; $dpiY = 0',
    '[LkDpi]::GetDpiForMonitor($hMon, 0, [ref]$dpiX, [ref]$dpiY) | Out-Null', // MDT_EFFECTIVE_DPI = 0
    'Write-Output "$awareVal,$dpiX"',
  ].join('\n');

  try {
    fs.writeFileSync(scriptPath, psScript, 'utf8');
    const { execFileSync } = require('child_process');
    const out = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, String(process.pid),
    ], { encoding: 'utf8', timeout: 5000 });
    const [awareStr, dpiStr] = out.trim().split(',');
    const awareVal = parseInt(awareStr, 10);
    const dpiVal = parseInt(dpiStr, 10);
    if (!Number.isNaN(awareVal)) dpiAwareness = awareVal;
    if (!Number.isNaN(dpiVal) && dpiVal > 0) realScaleFactor = dpiVal / 96;
    if (Number.isNaN(awareVal) || Number.isNaN(dpiVal)) {
      console.warn('[dpi-fix] DPI query returned unexpected output:', JSON.stringify(out));
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    console.warn('[dpi-fix] Could not query DPI info:', err.message, stderr);
  }
}

// --- Lock-button hit-testing (locked mode only) ------------------------------
// Electron's own forwarded-mouse-while-ignoring mechanism (setIgnoreMouseEvents
// (true, {forward:true}) + the renderer's own hover detection) assumes it's
// per-monitor DPI aware, so at non-100% scale its internal coordinate
// translation can drift from the window's real on-screen position - the lock
// button becomes impossible to hover/click while locked. We don't rely on
// that mechanism at all: we already have a global mouse hook (uiohook)
// reporting the cursor position, and we do the hit-test ourselves and toggle
// setIgnoreMouseEvents(!hot) directly - no forwarding needed, since once
// mouse events aren't ignored, normal Windows message delivery handles clicks
// correctly (confirmed working - it's the same path the whole-window drag
// already relies on).
function isOverLockButton(realX, realY) {
  if (!win || win.isDestroyed()) return false;
  const b = win.getBounds();
  const btnPx = settings.lockCustom
    ? { x: settings.lockCustom.xPct * b.width, y: settings.lockCustom.yPct * b.height }
    : lockPresetPixel(settings.lockPos, b.width, b.height);
  // uiohook always reports true physical-pixel coordinates, so we always
  // convert with the monitor's *real* scale factor (from detectDpiInfo,
  // queried out-of-process) rather than screen.getPrimaryDisplay().scaleFactor
  // - which, once we've forced this process DPI-unaware, Windows virtualizes
  // right along with everything else and misreports as 1 regardless of the
  // monitor's actual scale (confirmed with real numbers: at 125%, dividing by
  // the reported "1" missed the button entirely; dividing by the true 1.25
  // landed exactly inside it).
  const sf = (realScaleFactor && realScaleFactor > 0)
    ? realScaleFactor
    : (screen.getPrimaryDisplay().scaleFactor || 1);
  const vx = realX / sf;
  const vy = realY / sf;
  return vx >= b.x + btnPx.x && vx <= b.x + btnPx.x + LOCK_BTN_SIZE
    && vy >= b.y + btnPx.y && vy <= b.y + btnPx.y + LOCK_BTN_SIZE;
}

// --- Global input hook -------------------------------------------------------
function startHook() {
  let lastX = null;
  let lastY = null;
  let lockBtnHot = false;

  uIOhook.on('keydown', (e) => {
    if (win && !win.isDestroyed()) win.webContents.send('key-down', CODE_TO_ID[e.keycode] || null);
  });
  uIOhook.on('keyup', (e) => {
    if (win && !win.isDestroyed()) win.webContents.send('key-up', CODE_TO_ID[e.keycode] || null);
  });
  uIOhook.on('mousemove', (e) => {
    if (!win || win.isDestroyed()) return;
    if (lastX !== null && Math.abs(e.x - lastX) + Math.abs(e.y - lastY) >= 4) {
      win.webContents.send('mouse-move');
    }
    lastX = e.x; lastY = e.y;

    if (settings.locked) {
      const hot = isOverLockButton(e.x, e.y);
      // Diagnostic-only: set LK_DEBUG_LOCK=1 in the environment before
      // launching to print the raw numbers behind every hit-test decision -
      // both the "divide by scaleFactor" and "don't divide" versions of
      // isOverLockButton have failed to fix 125% click/drag, so rather than
      // guess a third time, log the actual mismatch and read it off directly.
      if (process.env.LK_DEBUG_LOCK) {
        const b = win.getBounds();
        const btnPx = settings.lockCustom
          ? { x: settings.lockCustom.xPct * b.width, y: settings.lockCustom.yPct * b.height }
          : lockPresetPixel(settings.lockPos, b.width, b.height);
        const sf = screen.getPrimaryDisplay().scaleFactor;
        console.log(
          `[lock-hit] cursor=(${e.x},${e.y}) bounds=(${b.x},${b.y},${b.width}x${b.height}) `
          + `btnRect=(${Math.round(b.x + btnPx.x)},${Math.round(b.y + btnPx.y)} size=${LOCK_BTN_SIZE}) `
          + `hot=${hot} scaleFactor=${sf} dpiAwareness=${dpiAwareness} realScaleFactor=${realScaleFactor}`,
        );
      }
      if (hot !== lockBtnHot) {
        lockBtnHot = hot;
        win.setIgnoreMouseEvents(!hot);
        win.webContents.send('lock-hot', hot);
      }
    }
  });

  uIOhook.start();
}

// --- Lifecycle ---------------------------------------------------------------
app.whenReady().then(() => {
  loadSettings();
  detectDpiInfo();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  buildTray();
  startHook();

  // Keep the window on a real display when monitors are added/removed/resized.
  screen.on('display-added', placeWindow);
  screen.on('display-removed', placeWindow);
  screen.on('display-metrics-changed', placeWindow);

  globalShortcut.register('CommandOrControl+Alt+K', () => setLocked(!settings.locked));
  globalShortcut.register('CommandOrControl+Alt+=', () => setScale(settings.scale + 0.1));
  globalShortcut.register('CommandOrControl+Alt+-', () => setScale(settings.scale - 0.1));
  globalShortcut.register('CommandOrControl+Alt+H', () => {
    if (win && !win.isDestroyed()) win.webContents.send('toggle-hide');
  });
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  try { uIOhook.stop(); } catch (_) {}
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => {});
// macOS dock icon click: only show if hidden/missing, never toggle-hide a visible window.
app.on('activate', () => {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (!win.isVisible()) { win.show(); if (!settings.locked) win.focus(); }
});
