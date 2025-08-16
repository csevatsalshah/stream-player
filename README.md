# Multi‑Stream Player Pro

Two YouTube streams, clean layouts, precise sync, resilient overlays, and keyboard‑driven control — all optimized for low‑end devices.

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
- **Quality control** with persistent **Highest** default
- **Keyboard shortcuts** (global, robust) — **two bindings per action**
- **Theme & appearance**: background image or gradient, frame border width/color, theme presets
- **Shareable URLs**, optionally including sync target/direction
- **Low‑end friendly**: minimal layout thrash, guarded observers, lightweight polling

---

## Getting Started

1. Paste a **primary** YouTube link/ID (required) and an optional **secondary** one on the landing page.
2. Click **Play**. Use the top bar to switch layouts (**1–6**) or toggle chat (Layout 3).
3. Use the bottom **Quickbar** for audio focus, volumes, markers/sync, overlays, and quality.
4. Open **Settings** (⚙️) to customize layout sizes, theme, shortcuts, and more.
5. Click **Copy Share URL** to share your current stream setup (plus sync if you choose).

---

## Keyboard Shortcuts (default)

> All shortcuts can have **two** bindings — edit them in **Settings → Keyboard Shortcuts**.

- **1–6:** Switch layouts
- **Q:** Swap streams
- **A:** Focus audio (S1 → Both → S2)
- **[ / ]:** Seek −10s / +10s (focused streams)
- **M / U:** Mute / Unmute
- **C:** Toggle chat or switch chat tab (Layout 3)
- **I:** Toggle titles + metrics overlays
- **9 / 0:** Set S1 / S2 marker
- **Shift+9 / Shift+0:** Sync **S2 → S1** / **S1 → S2**
- **G:** Sync now
- **O:** Open Settings
- **S:** Toggle shortcuts on/off

> Shortcuts are disabled while typing in an input/select/textarea field.

---

## Quality Controls

- Default quality is **Highest** — requested repeatedly to overcome YouTube’s auto quality algorithm.
- Per‑stream quality can be set from the Quickbar. If a rendition isn’t available, YouTube chooses the closest.

---

## Titles & Metrics

- **Titles** are fetched without any API key (via public oEmbed/noembed).
- **Metrics** (viewers/likes) require a YouTube Data API key (paste in **Settings**). Your key is stored only in your browser.

---

## “Behind Live” Indicator

YouTube’s IFrame API doesn’t expose live latency.  
We approximate it by tracking the highest time we’ve seen (“live head”) and showing `head - current`.  
This removes the previous constant `-600s` issue and gives a stable, useful signal.

---

## Performance Notes

- Player iframes are **never rebuilt** for simple UI changes like volume or quality selection.
- Careful dependency reduction, guarded `ResizeObserver`, and lightweight timers keep the app smooth even on low‑end devices.
- The UI avoids layout thrashing with staged measurements and CSS‑driven transitions.

---

## Privacy

- Everything is stored **locally** in your browser (streams, settings, keybinds, theme presets, optionally your API key).
- No backend, no tracking.

---

## Development

- React + IFrame API.  
- Environment variable `REACT_APP_YT_API_KEY` can supply a default API key (user can override/reset in Settings).

### Scripts

- `npm start` – run locally
- `npm run build` – production build

---

## Credits

- Made by **Vat5aL**  
- Background visuals & UI polishing inspired by modern broadcast dashboards.

