# LucidKeyboard — transparent keystroke visualizer

By Night Master. 这是一个透明的屏幕键盘 — a transparent on-screen keyboard overlay.

Built for people who don't touch-type: you watch the on-screen keyboard while
typing on your **physical** keyboard, and the key you actually pressed lights up
in real time. Cross-platform: Windows / macOS / Linux (X11).

It does **not** inject keys — it only *shows* what you pressed. Everything is
local; nothing is stored or sent. Your size / position / theme / lock state are
saved between runs.

## Run it

```bash
cd lucidkeyboard
npm install
npm start
```

Starts **unlocked** so you can place, size and style it. Then **lock** it to use.

## The lock button (top-right) is the whole model

A small lock icon sits in the top-right corner and is always reachable.

- **🔓 Unlocked:** the overlay is fully interactive. **Drag** anywhere to move it,
  use the toolbar to **resize** (− / +). Pick a **theme** from the tray menu. Not
  click-through.
- **🔒 Locked:** the overlay is **click-through everywhere except the lock button**,
  so you can click straight through the keyboard to whatever's underneath, but can
  still click the lock icon anytime to unlock. Moving and resizing are disabled.

Click the lock icon to toggle. (Also **Ctrl/Cmd + Alt + K**, or the tray menu, as
a fallback.) While locked, you can also **drag the lock icon itself** to reposition
it anywhere within the keyboard area — a plain click still toggles the lock;
dragging just moves the icon.

Technically the window ignores the mouse everywhere while locked except a small
hit-tested region around the lock icon, computed from the OS-level cursor
position rather than forwarded DOM events, so it stays accurate regardless of
Windows display scaling.

## Other behaviour

- **Highlights physical keystrokes** — press glows, release clears.
- **Auto-hide on mouse move** (tray toggle, default on): while locked, the keyboard
  body fades when you move the mouse and reappears when you type. The lock button
  stays visible so you can always unlock. Turn it off to keep the keyboard always
  visible while locked.
- **Display opacity** (tray): how visible the keyboard is when locked — set it low
  for an unobtrusive overlay.
- **Force show/hide:** **Ctrl/Cmd + Alt + H**.  **Quit:** **Ctrl/Cmd + Q**.
- **Resize:** toolbar − / + when unlocked, or **Ctrl/Cmd + Alt + +/−** (50 %–180 %,
  crisp — the whole layout scales, not a blurry zoom).

The **High-contrast** theme (yellow-on-black, bold keys) at a larger size is the
recommended combo for the "watch the keyboard while typing" use case.

## Startup & multi-monitor

- **Start at login** (tray checkbox): launches LucidKeyboard automatically when you
  log in. On Windows/macOS this uses the OS login-items API (macOS starts it
  hidden); on Linux it writes a `~/.config/autostart/keyoverlay.desktop` entry.
- **Multi-monitor memory:** the overlay remembers where you left it. If that spot
  is on a monitor that's currently unplugged, it falls back to the primary display
  so it never gets stranded off-screen — and when that monitor is reconnected it
  jumps back to the remembered position. It also re-checks itself whenever displays
  are added, removed, or rearranged.

## Why these pieces

- **`uiohook-napi`** — global keyboard + mouse hook, so the app sees your physical
  keys and mouse movement even when unfocused. N-API, so its prebuilt binary loads
  in Electron with no recompiling.
- **Electron** — transparent, always-on-top window; click-through via
  `setIgnoreMouseEvents(..., { forward: true })`, interactive when unlocked.

## Platform notes (a global hook needs OS permission)

- **macOS:** first run prompts for **Input Monitoring** (System Settings → Privacy
  & Security → Input Monitoring). Without it, no keys are detected. In dev the
  permission attaches to your terminal; in a build, to the app.
- **Windows:** works out of the box. To visualize keys pressed in an app running
  as administrator, run LucidKeyboard as administrator too.
- **Linux:** works under **X11**; native **Wayland** restricts global capture.

## Build installers

```bash
npm run build:win     # Windows (NSIS .exe)
npm run build:mac     # macOS (.dmg)
npm run build:linux   # Linux (AppImage)
```

If `npm install` can't fetch a prebuilt binary for your platform/arch, install
build tools (Xcode CLT on macOS; `build-essential` `libx11-dev` `libxtst-dev` on
Linux; VS Build Tools on Windows) and reinstall.

## Customise further

- **Layout / labels:** `LAYOUT` in `renderer.js` (ids are `KeyboardEvent.code`
  names, mapped from uiohook keycodes in `buildCodeMap()` in `main.js`).
- **Add a theme:** add to `THEMES` in `renderer.js` and `THEME_NAMES` in
  `main.js` — it shows up automatically in the tray's Theme submenu.
- **Lock button position:** `#lockBtn` in `styles.css` (currently `top/right`).
- **Scale range:** `SCALE_MIN` / `SCALE_MAX` in `main.js`.
- **Settings file:** `settings.json` in Electron's `userData` dir (delete to reset).

## File map

| File          | Role                                                            |
|---------------|-----------------------------------------------------------------|
| `main.js`     | Window, tray, global hook, lock/scale/move/persist, hotkeys     |
| `preload.js`  | Safe IPC bridge (`window.overlay`)                             |
| `index.html`  | Shell + lock button + unlocked toolbar                         |
| `renderer.js` | Layout, themes, highlight, lock + selective click-through logic |
| `styles.css`  | Theme variables, scale-driven sizing, lock button, toolbar     |
| `assets/`     | App + tray icons                                              |
