# Multi‑Stream Player Pro

Dual YouTube streams, clean layouts, precise sync, resilient overlays, and keyboard‑driven control — **optimized for low‑end devices**.

---

## What’s New

- **No refresh on volume changes** – player iframes aren’t re‑created when you adjust audio.
- **Always‑working shortcuts** – plus a **top‑bar toggle** (⌨︎) so you can re‑enable even when hotkeys are OFF.
- **Reliable titles + live metrics** – titles fetched without an API key; metrics (viewers/likes) with an optional key.
- **Behind‑Live meter fixed** – accurate seconds behind live for each stream (no more stuck at `-600s`).
- **“Sync Now” improved** + **Set Sync** – capture current `Δ (S1 − S2)` with one click, then apply.
- **Per‑stream Play/Pause** in the bottom menu.
- **Change/Remove Stream 2 & per‑stream quality** moved to **Settings** (cleaner quickbar).
- **Bottom menu is a “Menu”** – open/close from top bar (☰). Draggable behavior improved.
- **Layout 3 center alignment when chat hidden** – video and frame borders align visually.
- **Two keybinds per action** with a **“+”**. Added **Reset Keybinds** (Settings + quickbar).

---

## Highlights

- **Two independent streams** with six flexible layouts
  - **Layout 4: Picture‑in‑Picture** — drag & resize; hold **Shift** to lock 16:9
  - **Layout 2/3:** built‑in YouTube chat (switchable Stream 1/2)
- **Audio focus** controls (S1 / Both / S2), per‑stream volume, instant mute/unmute
- **Markers & Sync**: set markers on either stream and jump/sync instantly
- **Accurate drift & “Behind live”** meter
- **Titles & live metrics** overlays  
  - Titles work **without** an API key  
  - Add a YouTube Data API key in **Settings** to see viewers/likes
- **Quality control** with persistent **Highest** default (override per‑stream in Settings)
- **Keyboard shortcuts** (global, robust) — **two bindings per action**, resettable
- **Theme & appearance**: background image or gradient, frame border width/color, theme presets
- **Shareable URLs**, optionally including sync target/direction
- **Low‑end friendly**: minimal layout thrash, guarded observers, lightweight polling

---

## Getting Started

1. Paste a **primary** YouTube link/ID (required) and an optional **secondary** one on the landing page.
2. Click **Play**.
3. Use the **top bar** to switch layouts (**1–6**), toggle chat (L3), toggle shortcuts (⌨︎), open the **Menu** (☰), or open **Settings** (⚙️).
4. Use the **Menu** (bottom quickbar) for focus, volumes, markers, sync (`Set Sync` + `Sync now`), per‑stream play/pause, overlays, and more.
5. In **Settings**, change layout sizes, theme, **quality per stream**, Stream 2 change/remove, keybinds, and the optional API key.
6. Click **Copy Share URL** to share your current setup (plus sync if you choose).

---

## Keyboard Shortcuts (default)

> Every action supports **two** bindings — edit them in **Settings → Keyboard Shortcuts**.

- **1–6:** Switch layouts
- **Q:** Swap streams
- **A:** Focus audio (S1 → Both → S2)
- **[ / ]:** Seek −10s / +10s (focused streams)
- **M / U:** Mute / Unmute
- **C:** Toggle chat or switch chat tab (Layout 3)
- **I:** Toggle titles + metrics overlays
- **9 / 0:** Set S1 / S2 marker
- **Shift+9 / Shift+0:** Sync **S2 → S1** / **S1 → S2**
- **G:** Sync now (you can first **Set Sync** from the bottom menu)
- **O:** Open Settings
- **S:** Toggle shortcuts on/off (you can also use ⌨︎ in the top bar)

> Shortcuts are automatically disabled while typing in inputs/selects.

---

## Sync & Behind‑Live

- **Drift (`Δ`)** shows `S1 − S2` in seconds.
- **Set Sync** captures the current drift into the **Target** box.
- **Sync now** applies the target using **Auto** or your selected move (move S1/S2).
- **Behind‑live** (S1/S2 buttons) shows how many seconds that stream is behind the observed live head. Use those buttons to jump to live.

---

## Titles & Metrics

- **Titles**: fetched with public oEmbed/noembed (no key required).
- **Metrics**: viewer/like counts use the **YouTube Data API** (paste a key in Settings). Your key is stored only in your browser.

---

## Performance Notes

- Player iframes are **not rebuilt** for audio/quality UI changes.
- Guarded `ResizeObserver`, measured updates, and small timers keep the app smooth on low‑end devices.
- Pointer‑event layering ensures you can either use **hotkeys** or interact directly with YouTube UI when hotkeys are disabled.

---

## Privacy

- All data (streams, theme, keybinds, positions, optional API key) is stored **locally** in your browser.
- No backend, no tracking.

---

## Development

- React + YouTube IFrame API  
- Environment variable: `REACT_APP_YT_API_KEY` to provide a default API key (overridable in Settings).

### Scripts

- `npm start` – run locally
- `npm run build` – production build

---

## Credits

- Made by **Vat5aL**  
- Background & UX inspired by modern broadcast dashboards.
