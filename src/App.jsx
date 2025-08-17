import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import './App.css';
import { getYouTubeId, lsGet, lsSet, clamp } from './utils';

/* -------------------- Tunables -------------------- */
const DEFAULT_PIP = { x: 24, y: 24, width: 480, height: 270 };
const DEFAULT_L2_CHAT = 360;      // Layout 2 chat width (px)
const DEFAULT_L3_S2H = 240;      // Layout 3 Stream 2 height (px)
const DEFAULT_L3_RIGHT_W = 360;   // Layout 3 right column width (px)
const METRICS_MS = 30000;         // 30s metrics polling
const DRIFT_MS = 500;             // drift/behind polling
const DEFAULT_BG =
  'https://media.discordapp.net/attachments/952501333179662338/1405875409681121280/background-stream.png?ex=68a06b01&is=689f1981&hm=854645e9229bf3a556a5be242c97c630eb27cfd8e81b8a205ee7099cd66b4bf6&=&format=webp&quality=lossless&width=1240&height=698';

/* Prefer the highest quality unless a user picks something else */
const PREFERRED_DEFAULT_QUALITY = 'highres';

/* Optional env key (user can override in Settings) */
const YT_API_KEY_DEFAULT = process.env.REACT_APP_YT_API_KEY || '';

/* -------------- YouTube IFrame API ---------------- */
function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(true);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    window.onYouTubeIframeAPIReady = () => resolve(true);
    document.head.appendChild(tag);
  });
}

/* --------- Free title/thumb (no API key) ---------- */
async function fetchTitleThumbNoKey(videoId) {
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(ytUrl)}`);
    if (res.ok) {
      const j = await res.json();
      const title = j?.title || 'YouTube Video';
      const thumb = j?.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      return { title, thumb };
    }
  } catch { }
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(ytUrl)}&format=json`;
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) {
      const j = await res.json();
      return {
        title: j?.title || 'YouTube Video',
        thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      };
    }
  } catch { }
  return {
    title: 'YouTube Video',
    thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };
}

/* -------- YouTube info (metrics + title) ---------- */
function useYouTubeInfo(videoId, { metricsEnabled, titleEnabled, apiKey }) {
  const [data, setData] = useState({ viewers: null, likes: null, title: '', loading: false, err: false });

  useEffect(() => {
    let timer;
    let cancelled = false;

    async function fetchOnce() {
      if (!videoId || (!metricsEnabled && !titleEnabled)) return;

      // Always try to populate title (even without API key)
      if (titleEnabled && !apiKey) {
        try {
          const { title } = await fetchTitleThumbNoKey(videoId);
          if (!cancelled) setData(prev => ({ ...prev, title: title || prev.title || '' }));
        } catch { }
      }

      if (!apiKey || (!metricsEnabled && !titleEnabled)) return;

      try {
        if (!cancelled) setData(prev => ({ ...prev, loading: true, err: false }));
        const parts = [];
        if (metricsEnabled) parts.push('liveStreamingDetails', 'statistics');
        if (titleEnabled) parts.push('snippet');
        const part = Array.from(new Set(parts)).join(',');
        const url = `https://www.googleapis.com/youtube/v3/videos?part=${part}&id=${videoId}&key=${apiKey}`;
        const res = await fetch(url);
        const j = await res.json();
        const it = j?.items?.[0];

        if (!cancelled) {
          setData(prev => ({
            viewers: metricsEnabled && it?.liveStreamingDetails?.concurrentViewers
              ? Number(it.liveStreamingDetails.concurrentViewers) : null,
            likes: metricsEnabled && it?.statistics?.likeCount
              ? Number(it.statistics.likeCount) : null,
            title: titleEnabled ? (it?.snippet?.title || prev.title || '') : prev.title,
            loading: false,
            err: false
          }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false, err: true }));
      }
    }

    setData({ viewers: null, likes: null, title: '', loading: false, err: false });
    fetchOnce();
    if (metricsEnabled) timer = setInterval(fetchOnce, METRICS_MS);

    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [videoId, metricsEnabled, titleEnabled, apiKey]);

  return data;
}

/* ------------------- Keymap (supports 2 keys/action) ------------------------ */
const DEFAULT_KEYMAP = {
  layout1: ['1', 'Numpad1'], layout2: ['2', 'Numpad2'], layout3: ['3', 'Numpad3'],
  layout4: ['4', 'Numpad4'], layout5: ['5', 'Numpad5'], layout6: ['6', 'Numpad6'],
  layout7: ['7', 'Numpad7'], layout8: ['8', 'Numpad8'], layout9: ['9', 'Numpad9'],
  swap: ['q', 'KeyQ'],
  toggleShortcuts: ['s', 'KeyS'],
  openSettings: ['o', 'KeyO'],
  focusAudio: ['a', 'KeyA'],
  muteAll: ['m', 'KeyM'],
  unmuteAll: ['u', 'KeyU'],
  nudgeBack: ['['],
  nudgeForward: [']'],
  toggleChat: ['c', 'KeyC'],
  toggleInfo: ['i', 'KeyI'],
  chatWidthDec: [','],
  chatWidthInc: ['.'],
  s2HeightDec: ['ArrowDown'],
  s2HeightInc: ['ArrowUp'],
  l3RightDec: ['-'],
  l3RightInc: ['='],
  borderDec: ['ArrowLeft'],
  borderInc: ['ArrowRight'],
  setMarkS1: ['9'],
  setMarkS2: ['0'],
  syncS2ToS1: ['(' /* Shift+9 */],
  syncS1ToS2: [')' /* Shift+0 */],
  syncNow: ['g', 'KeyG'],
  setSyncFromCurrent: ['`']
};

/* Quality helpers */
const QUALITY_LABELS = {
  default: 'Auto',
  small: '144p',
  medium: '240p',
  large: '480p',
  hd720: '720p',
  hd1080: '1080p',
  hd1440: '1440p',
  hd2160: '2160p (4K)',
  highres: 'Highest'
};
const QUALITY_ORDER = ['default', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres'];
const prettyQuality = (q) => QUALITY_LABELS[q] || q || 'Auto';

/* Cursor helper for PIP */
const cursorForDir = (dir) => ({
  top: 'n-resize', bottom: 's-resize', left: 'w-resize', right: 'e-resize',
  topRight: 'ne-resize', topLeft: 'nw-resize', bottomRight: 'se-resize', bottomLeft: 'sw-resize',
  n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize', ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize'
}[dir] || 'default');

/* ================================================== */
export default function App() {
  /* Streams */
  const [s1Input, setS1Input] = useState(() => lsGet('ms_stream1', ''));
  const [s2Input, setS2Input] = useState(() => lsGet('ms_stream2', ''));
  const [s3Input, setS3Input] = useState(() => lsGet('ms_stream3', '')); // NEW: third stream (optional)

  const [s1, setS1] = useState(() => getYouTubeId(lsGet('ms_stream1', '')));
  const [s2, setS2] = useState(() => getYouTubeId(lsGet('ms_stream2', '')));
  const [s3, setS3] = useState(() => getYouTubeId(lsGet('ms_stream3', ''))); // NEW

  /* Stream enabled flags (OFF destroys the player so it won’t run in bg) */
  const [s1Enabled, setS1Enabled] = useState(() => lsGet('ms_s1_enabled', true));
  const [s2Enabled, setS2Enabled] = useState(() => lsGet('ms_s2_enabled', true));
  const [s3Enabled, setS3Enabled] = useState(() => lsGet('ms_s3_enabled', true)); // NEW

  /* Chat */
  const [chatTab, setChatTab] = useState(() => lsGet('ms_chatTab', 1)); // 1 | 2
  const [chatVisibleL3, setChatVisibleL3] = useState(() => lsGet('ms_l3_chat_visible', true));

  /* Layout/UI */
  const [layout, setLayout] = useState(() => lsGet('ms_layout', 3)); // default to layout 3
  const [swap, setSwap] = useState(() => lsGet('ms_swap', false));
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => lsGet('ms_shortcuts_enabled', true));
  const [controlsEnabled, setControlsEnabled] = useState(() => lsGet('ms_controls_enabled', true));
  const [sidebarOpen, setSidebarOpen] = useState(false); // NEW: right-side menu

  // Draggable bars positions
  const [topBarPos, setTopBarPos] = useState(() => lsGet('ms_topbar_pos', { x: 0, y: 0 }));
  const [bottomBarPos, setBottomBarPos] = useState(() => lsGet('ms_bottombar_pos', { x: 0, y: 0 }));

  /* Sizes */
  const [l2ChatWidth, setL2ChatWidth] = useState(() => lsGet('ms_l2_chat', DEFAULT_L2_CHAT));
  const [l3S2Height, setL3S2Height] = useState(() => lsGet('ms_l3_s2h', DEFAULT_L3_S2H));
  const [l3RightWidth, setL3RightWidth] = useState(() => lsGet('ms_l3_right_w', DEFAULT_L3_RIGHT_W));

  /* PIP */
  const [pip, setPip] = useState(() => lsGet('ms_pip', DEFAULT_PIP));
  const [pipMoving, setPipMoving] = useState(false);
  const [pipLockAR, setPipLockAR] = useState(false);
  const [shield, setShield] = useState({ active: false, cursor: 'default' });

  /* Theme / Appearance */
  const [bgUrl, setBgUrl] = useState(() => lsGet('ms_bg', DEFAULT_BG));
  const [frameW, setFrameW] = useState(() => lsGet('ms_frame_w', 0));
  const [frameColor, setFrameColor] = useState(() => lsGet('ms_frame_c', '#ffffff'));
  const [themes, setThemes] = useState(() => lsGet('ms_theme_presets', []));

  /* Overlays */
  const [showMetrics, setShowMetrics] = useState(() => lsGet('ms_show_metrics', true));
  const [showTitles, setShowTitles] = useState(() => lsGet('ms_show_titles', true));

  /* Settings modal */
  const [showSettings, setShowSettings] = useState(false);

  /* API key override (per-user) */
  const [ytApiKeyOverride, setYtApiKeyOverride] = useState(() => lsGet('ms_yt_api_key', ''));
  const ytApiKey = ytApiKeyOverride || YT_API_KEY_DEFAULT;

  /* Geometry */
  const stageRef = useRef(null);
  const slotS1 = useRef(null);
  const slotS2 = useRef(null);
  const chatSlot = useRef(null);
  const [rectS1, setRectS1] = useState(null);
  const [rectS2, setRectS2] = useState(null);
  const [rectChat, setRectChat] = useState(null);
  const lastS1 = useRef(null);
  const lastS2 = useRef(null);
  const lastS3 = useRef(null);
  const lastChat = useRef(null);

  /* Player API */
  const origin = useMemo(() => window.location.origin, []);
  const domain = useMemo(() => window.location.hostname, []);
  const p1Ref = useRef(null);
  const p2Ref = useRef(null);
  const p3Ref = useRef(null);
  const yt1 = useRef(null);
  const yt2 = useRef(null);
  const yt3 = useRef(null);
  const [ytReady, setYtReady] = useState(false);

  /* Keymap (sanitize; migrate old string form to arrays) */
  const [keymap, setKeymap] = useState(() => {
    const stored = lsGet('ms_keymap', {});
    const merged = { ...DEFAULT_KEYMAP, ...(stored && typeof stored === 'object' ? stored : {}) };
    const norm = {};
    for (const [k, v] of Object.entries(merged)) {
      if (Array.isArray(v)) {
        norm[k] = v.filter(s => typeof s === 'string' && s.trim().length).slice(0, 2);
      } else if (typeof v === 'string' && v.trim().length) {
        norm[k] = [v.trim()];
      } else {
        norm[k] = [];
      }
    }
    return norm;
  });

  /* Audio */
  const [focus, setFocus] = useState('both'); // 's1' | 'both' | 's2'
  const [vol1, setVol1] = useState(() => lsGet('ms_vol1', 100));
  const [vol2, setVol2] = useState(() => lsGet('ms_vol2', 100));
  const [vol3, setVol3] = useState(() => lsGet('ms_vol3', 100));
  const [muted1, setMuted1] = useState(() => lsGet('ms_muted1', false));
  const [muted2, setMuted2] = useState(() => lsGet('ms_muted2', false));
  const [muted3, setMuted3] = useState(() => lsGet('ms_muted3', true));
  const [audioActive, setAudioActive] = useState(false);

  /* Playback quality */
  const [defaultQuality, setDefaultQuality] = useState(() => lsGet('ms_default_quality', PREFERRED_DEFAULT_QUALITY));
  const [q1, setQ1] = useState(() => lsGet('ms_q1', 'default'));
  const [q2, setQ2] = useState(() => lsGet('ms_q2', 'default'));
  const [q3, setQ3] = useState(() => lsGet('ms_q3', 'default'));

  /* Markers & drift & live behind */
  const [markS1, setMarkS1] = useState(null);
  const [markS2, setMarkS2] = useState(null);
  const [drift, setDrift] = useState(0); // S1 - S2
  const [syncTarget, setSyncTarget] = useState(0);
  const [syncMove, setSyncMove] = useState('auto'); // 'auto'|'s2'|'s1'
  const [behind1, setBehind1] = useState(0);
  const [behind2, setBehind2] = useState(0);
  const head1 = useRef(0);
  const head2 = useRef(0);
  const head3 = useRef(0);

  /* History (24h) */
  const [history, setHistory] = useState(() => lsGet('ms_hist', []));

  /* Info (metrics + title) */
  const info1 = useYouTubeInfo(s1, { metricsEnabled: showMetrics, titleEnabled: showTitles, apiKey: ytApiKey });
  const info2 = useYouTubeInfo(s2, { metricsEnabled: showMetrics, titleEnabled: showTitles, apiKey: ytApiKey });
  const info3 = useYouTubeInfo(s3, { metricsEnabled: showMetrics, titleEnabled: showTitles, apiKey: ytApiKey });

  /* ---- Boot: IFrame API ---- */
  useEffect(() => { let off = false; loadYouTubeAPI().then(() => !off && setYtReady(true)); return () => { off = true }; }, []);

  /* ---- First user gesture → allow unMute ---- */
  useEffect(() => {
    const activate = () => setAudioActive(true);
    window.addEventListener('mousedown', activate, { once: true });
    window.addEventListener('touchstart', activate, { once: true });
    return () => {
      window.removeEventListener('mousedown', activate);
      window.removeEventListener('touchstart', activate);
    };
  }, []);

  /* ---- ask YouTube to keep quality ---- */
  const assertQuality = useCallback((playerRef, want) => {
    const p = playerRef?.current; if (!p || !want || want === 'default') return;
    let tries = 0;
    const tick = () => {
      try { p.setPlaybackQuality(want); } catch { }
      if (++tries < 12) setTimeout(tick, 250);
    };
    tick();
  }, []);

  /* ---- Build/destroy players depending on enable flags ---- */
  useEffect(() => {
    if (!ytReady) return;

    // Stream 1
    if (s1Enabled && p1Ref.current && s1 && !yt1.current) {
      yt1.current = new window.YT.Player(p1Ref.current, {
        events: {
          onReady: (e) => {
            try {
              e.target.mute();
              e.target.setVolume(vol1);
              e.target.playVideo();
              assertQuality(yt1, defaultQuality);
            } catch { }
          }
        }
      });
    }
    if (!s1Enabled && yt1.current) { try { yt1.current.destroy(); } catch { } yt1.current = null; }

    // Stream 2
    if (s2Enabled && p2Ref.current && s2 && !yt2.current) {
      yt2.current = new window.YT.Player(p2Ref.current, {
        events: {
          onReady: (e) => {
            try {
              e.target.mute();
              e.target.setVolume(vol2);
              e.target.playVideo();
              assertQuality(yt2, defaultQuality);
            } catch { }
          }
        }
      });
    }
    if (!s2Enabled && yt2.current) { try { yt2.current.destroy(); } catch { } yt2.current = null; }

    // Stream 3
    if (s3Enabled && p3Ref.current && s3 && !yt3.current) {
      yt3.current = new window.YT.Player(p3Ref.current, {
        events: {
          onReady: (e) => {
            try {
              e.target.mute();
              e.target.setVolume(vol3);
              e.target.playVideo();
              assertQuality(yt3, defaultQuality);
            } catch { }
          }
        }
      });
    }
    if (!s3Enabled && yt3.current) { try { yt3.current.destroy(); } catch { } yt3.current = null; }
  }, [ytReady, s1Enabled, s2Enabled, s3Enabled, s1, s2, s3, assertQuality, vol1, vol2, vol3, defaultQuality]);

  /* ---- Re-assert quality if user changes the default ---- */
  useEffect(() => {
    assertQuality(yt1, defaultQuality);
    assertQuality(yt2, defaultQuality);
    assertQuality(yt3, defaultQuality);
  }, [defaultQuality, assertQuality]);

  /* ---- Force play when IDs change ---- */
  useEffect(() => {
    head1.current = 0;
    if (yt1.current && s1Enabled && s1) {
      try {
        yt1.current.loadVideoById(s1);
        yt1.current.setVolume(vol1);
        yt1.current.playVideo();
        assertQuality(yt1, defaultQuality);
      } catch { }
    }
  }, [s1, s1Enabled, defaultQuality, vol1, assertQuality]);

  useEffect(() => {
    head2.current = 0;
    if (yt2.current && s2Enabled && s2) {
      try {
        yt2.current.loadVideoById(s2);
        yt2.current.setVolume(vol2);
        yt2.current.playVideo();
        assertQuality(yt2, defaultQuality);
      } catch { }
    }
  }, [s2, s2Enabled, defaultQuality, vol2, assertQuality]);

  useEffect(() => {
    head3.current = 0;
    if (yt3.current && s3Enabled && s3) {
      try {
        yt3.current.loadVideoById(s3);
        yt3.current.setVolume(vol3);
        yt3.current.playVideo();
        assertQuality(yt3, defaultQuality);
      } catch { }
    }
  }, [s3, s3Enabled, defaultQuality, vol3, assertQuality]);

  /* ---- Persist ---- */
  useEffect(() => lsSet('ms_stream1', s1Input), [s1Input]);
  useEffect(() => lsSet('ms_stream2', s2Input), [s2Input]);
  useEffect(() => lsSet('ms_stream3', s3Input), [s3Input]);
  useEffect(() => lsSet('ms_layout', layout), [layout]);
  useEffect(() => lsSet('ms_controls_enabled', controlsEnabled), [controlsEnabled]);
  useEffect(() => lsSet('ms_swap', swap), [swap]);
  useEffect(() => lsSet('ms_shortcuts_enabled', shortcutsEnabled), [shortcutsEnabled]);
  useEffect(() => lsSet('ms_l2_chat', l2ChatWidth), [l2ChatWidth]);
  useEffect(() => lsSet('ms_l3_s2h', l3S2Height), [l3S2Height]);
  useEffect(() => lsSet('ms_l3_right_w', l3RightWidth), [l3RightWidth]);
  useEffect(() => lsSet('ms_pip', pip), [pip]);
  useEffect(() => lsSet('ms_bg', bgUrl), [bgUrl]);
  useEffect(() => lsSet('ms_theme_presets', themes), [themes]);
  useEffect(() => lsSet('ms_keymap', keymap), [keymap]);
  useEffect(() => lsSet('ms_frame_w', frameW), [frameW]);
  useEffect(() => lsSet('ms_frame_c', frameColor), [frameColor]);
  useEffect(() => lsSet('ms_show_metrics', showMetrics), [showMetrics]);
  useEffect(() => lsSet('ms_show_titles', showTitles), [showTitles]);
  useEffect(() => lsSet('ms_s1_enabled', s1Enabled), [s1Enabled]);
  useEffect(() => lsSet('ms_s2_enabled', s2Enabled), [s2Enabled]);
  useEffect(() => lsSet('ms_s3_enabled', s3Enabled), [s3Enabled]);
  useEffect(() => lsSet('ms_vol1', vol1), [vol1]);
  useEffect(() => lsSet('ms_vol2', vol2), [vol2]);
  useEffect(() => lsSet('ms_vol3', vol3), [vol3]);
  useEffect(() => lsSet('ms_muted1', muted1), [muted1]);
  useEffect(() => lsSet('ms_muted2', muted2), [muted2]);
  useEffect(() => lsSet('ms_muted3', muted3), [muted3]);
  useEffect(() => lsSet('ms_default_quality', defaultQuality), [defaultQuality]);
  useEffect(() => lsSet('ms_q1', q1), [q1]);
  useEffect(() => lsSet('ms_q2', q2), [q2]);
  useEffect(() => lsSet('ms_q3', q3), [q3]);
  useEffect(() => lsSet('ms_yt_api_key', ytApiKeyOverride), [ytApiKeyOverride]);
  useEffect(() => lsSet('ms_chatTab', chatTab), [chatTab]);
  useEffect(() => lsSet('ms_hist', history), [history]);
  useEffect(() => lsSet('ms_l3_chat_visible', chatVisibleL3), [chatVisibleL3]);
  useEffect(() => lsSet('ms_topbar_pos', topBarPos), [topBarPos]);
  useEffect(() => lsSet('ms_bottombar_pos', bottomBarPos), [bottomBarPos]);

  /* ---- Robust measurement ---- */
  const measureAll = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const base = stage.getBoundingClientRect();
    const toLocal = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w <= 2 || h <= 2) return null;
      return { left: Math.round(r.left - base.left), top: Math.round(r.top - base.top), width: w, height: h };
    };
    const r1 = toLocal(slotS1.current);
    const r2 = (layout === 4) ? null : toLocal(slotS2.current); // L4 uses PIP rect
    const rc = toLocal(chatSlot.current);

    setRectS1(r1); if (r1) lastS1.current = r1;
    setRectS2(r2); if (r2) lastS2.current = r2;
    setRectChat(rc); if (rc) lastChat.current = rc;
  }, [layout]);

  useLayoutEffect(() => {
    measureAll();
    let frames = 0;
    function raf() {
      measureAll();
      if (++frames < 8) requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }, [layout, l2ChatWidth, l3S2Height, l3RightWidth, chatVisibleL3, measureAll]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => requestAnimationFrame(measureAll));
    if (slotS1.current) ro.observe(slotS1.current);
    if (slotS2.current) ro.observe(slotS2.current);
    if (chatSlot.current) ro.observe(chatSlot.current);
    return () => ro.disconnect();
  }, [layout, measureAll]);

  /* ---- URL presets + sync params ---- */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s1q = getYouTubeId(p.get('s1'));
    const s2q = getYouTubeId(p.get('s2'));
    const s3q = getYouTubeId(p.get('s3'));
    if (s1q) { setS1(s1q); setS1Input(s1q); }
    if (s2q) { setS2(s2q); setS2Input(s2q); }
    if (s3q) { setS3(s3q); setS3Input(s3q); }
    const d = parseFloat(p.get('d'));
    if (!Number.isNaN(d)) setSyncTarget(d);
    const mv = p.get('move');
    if (['auto', 's1', 's2'].includes(mv)) setSyncMove(mv);
  }, []);
  useEffect(() => {
    const q = new URLSearchParams();
    if (s1) q.set('s1', s1);
    if (s2) q.set('s2', s2);
    if (s3) q.set('s3', s3);
    if (syncTarget) q.set('d', String(syncTarget));
    if (syncMove && syncMove !== 'auto') q.set('move', syncMove);
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = q.toString() ? `${base}?${q}` : base;
    window.history.replaceState(null, '', url);
  }, [s1, s2, s3, syncTarget, syncMove]);

  /* ---- Player & chat sources ---- */
  const baseParams = `autoplay=1&playsinline=1&mute=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
  const s1Src = (s1 && s1Enabled) ? `https://www.youtube.com/embed/${s1}?${baseParams}` : null;
  const s2Src = (s2 && s2Enabled) ? `https://www.youtube.com/embed/${s2}?${baseParams}` : null;
  const s3Src = (s3 && s3Enabled) ? `https://www.youtube.com/embed/${s3}?${baseParams}` : null;

  const chat1Src = s1 ? `https://www.youtube.com/live_chat?v=${s1}&embed_domain=${domain}` : null;
  const chat2Src = s2 ? `https://www.youtube.com/live_chat?v=${s2}&embed_domain=${domain}` : null;

  /* ---- Audio engine ---- */
  const applyAudioStates = useCallback(() => {
    const wantMute1 = (focus === 's2') || muted1;
    const wantMute2 = (focus === 's1') || muted2;

    try {
      if (yt1.current) {
        if (wantMute1) yt1.current.mute();
        else { if (audioActive) yt1.current.unMute(); yt1.current.setVolume(vol1); }
      }
    } catch { }
    try {
      if (yt2.current) {
        if (wantMute2) yt2.current.mute();
        else { if (audioActive) yt2.current.unMute(); yt2.current.setVolume(vol2); }
      }
    } catch { }
    try {
      if (yt3.current) {
        if (muted3) yt3.current.mute();
        else { if (audioActive) yt3.current.unMute(); yt3.current.setVolume(vol3); }
      }
    } catch { }
  }, [muted1, muted2, muted3, focus, vol1, vol2, vol3, audioActive]);
  useEffect(() => { applyAudioStates(); }, [applyAudioStates]);

  const focusS1 = useCallback(() => { setFocus('s1'); setMuted1(false); setMuted2(true); }, []);
  const focusBoth = useCallback(() => { setFocus('both'); setMuted1(false); setMuted2(false); }, []);
  const focusS2 = useCallback(() => { setFocus('s2'); setMuted1(true); setMuted2(false); }, []);
  const cycleFocus = useCallback(() => {
    setFocus(prev => (prev === 's1' ? 'both' : prev === 'both' ? 's2' : 's1'));
    setMuted1(false); setMuted2(false);
  }, []);

  const muteAll = useCallback(() => { setMuted1(true); setMuted2(true); setMuted3(true); }, []);
  const unmuteAll = useCallback(() => { setMuted1(false); setMuted2(false); setMuted3(false); setFocus('both'); }, []);

  const nudge = useCallback((delta) => {
    const list = focus === 's1' ? [yt1.current] : focus === 's2' ? [yt2.current] : [yt1.current, yt2.current];
    list.forEach((p) => {
      if (!p?.getCurrentTime || !p?.seekTo) return;
      const t = Number(p.getCurrentTime() || 0);
      p.seekTo(Math.max(0, t + delta), true);
    });
  }, [focus]);

  /* ---- Drift meter + behind live ---- */
  useEffect(() => {
    let t;
    function tick() {
      try {
        const t1 = yt1.current?.getCurrentTime?.();
        const t2 = yt2.current?.getCurrentTime?.();
        if (typeof t1 === 'number' && typeof t2 === 'number') setDrift((t1 - t2));

        if (typeof t1 === 'number') {
          head1.current = Math.max(head1.current, t1);
          setBehind1(Math.max(0, Math.min(600, head1.current - t1)));
        } else setBehind1(0);

        if (typeof t2 === 'number') {
          head2.current = Math.max(head2.current, t2);
          setBehind2(Math.max(0, Math.min(600, head2.current - t2)));
        } else setBehind2(0);

        const t3 = yt3.current?.getCurrentTime?.();
        if (typeof t3 === 'number') head3.current = Math.max(head3.current, t3);
      } catch { }
      t = setTimeout(tick, DRIFT_MS);
    }
    tick();
    return () => clearTimeout(t);
  }, []);

  /* ---- Markers + Sync ---- */
  const setMarkerS1 = useCallback(() => {
    const t = yt1.current?.getCurrentTime?.(); if (typeof t === 'number') setMarkS1(t);
  }, []);
  const setMarkerS2 = useCallback(() => {
    const t = yt2.current?.getCurrentTime?.(); if (typeof t === 'number') setMarkS2(t);
  }, []);

  const syncS2ToS1Mark = useCallback(() => {
    if (markS1 == null || !yt2.current?.seekTo) return;
    yt2.current.seekTo(Math.max(0, markS1), true);
  }, [markS1]);

  const syncS1ToS2Mark = useCallback(() => {
    if (markS2 == null || !yt1.current?.seekTo) return;
    yt1.current.seekTo(Math.max(0, markS2), true);
  }, [markS2]);

  const goLiveS1 = useCallback(() => { const p = yt1.current; if (!p) return; try { p.seekTo(1e9, true); head1.current = 0; } catch { } }, []);
  const goLiveS2 = useCallback(() => { const p = yt2.current; if (!p) return; try { p.seekTo(1e9, true); head2.current = 0; } catch { } }, []);
  const goLiveS3 = useCallback(() => { const p = yt3.current; if (!p) return; try { p.seekTo(1e9, true); head3.current = 0; } catch { } }, []);

  const setSyncFromCurrent = useCallback(() => {
    const t1 = Number(yt1.current?.getCurrentTime?.() || 0);
    const t2 = Number(yt2.current?.getCurrentTime?.() || 0);
    setSyncTarget(t1 - t2);
  }, []);

  const syncNow = useCallback(() => {
    const p1 = yt1.current, p2 = yt2.current; if (!p1 || !p2) return;
    const t1 = Number(p1.getCurrentTime?.() || 0);
    const t2 = Number(p2.getCurrentTime?.() || 0);
    const desired = Number(syncTarget || 0); // want t1 - t2 == desired
    const move = syncMove;

    const moveS2 = () => { try { p2.seekTo(Math.max(0, t1 - desired), true); } catch { } };
    const moveS1 = () => { try { p1.seekTo(Math.max(0, t2 + desired), true); } catch { } };

    if (move === 's2') moveS2();
    else if (move === 's1') moveS1();
    else {
      const cur = t1 - t2;
      if (cur < desired) moveS2(); else moveS1();
    }
  }, [syncMove, syncTarget]);

  /* ---- History helpers (24h) ---- */
  const pruneHistory = useCallback((arr) => {
    const now = Date.now();
    return (arr || []).filter(x => (now - (x.ts || 0)) < 24 * 3600 * 1000);
  }, []);
  useEffect(() => { setHistory(h => pruneHistory(h)); }, [pruneHistory]);

  const addToHistory = (id, title, thumb) => {
    if (!id) return;
    setHistory(h => {
      const base = pruneHistory(h || []);
      const rest = base.filter(x => x.id !== id);
      return [{ id, title: title || id, thumb: thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, ts: Date.now() }, ...rest].slice(0, 40);
    });
  };
  const removeHistItem = (id) => setHistory(h => (h || []).filter(x => x.id !== id));
  const clearHistory = () => setHistory([]);

  /* ---- Toasters & actions ---- */
  const [toastMsg, setToastMsg] = useState('');
  function toast(t) { setToastMsg(t); setTimeout(() => setToastMsg(''), 1800); }

  const play = async () => {
    const id1 = getYouTubeId(s1Input);
    if (!id1) { alert('Enter a valid YouTube link/ID for the primary stream.'); return; }
    setS1(id1); setS1Enabled(true);
    const id2 = getYouTubeId(s2Input);
    setS2(id2 || null); if (id2) setS2Enabled(true);
    const id3 = getYouTubeId(s3Input);
    setS3(id3 || null); if (id3) setS3Enabled(true);
    setLayout(3); // default to layout 3
    try {
      const meta = await fetchTitleThumbNoKey(id1);
      addToHistory(id1, meta.title, meta.thumb);
      if (id2) { const meta2 = await fetchTitleThumbNoKey(id2); addToHistory(id2, meta2.title, meta2.thumb); }
      if (id3) { const meta3 = await fetchTitleThumbNoKey(id3); addToHistory(id3, meta3.title, meta3.thumb); }
    } catch { }
  };

  const addStream2 = () => {
    const v = prompt('Enter Stream 2 URL or ID:'); if (!v) return;
    const id = getYouTubeId(v); if (id) { setS2(id); setS2Input(id); setS2Enabled(true); } else alert('Invalid link or ID.');
  };
  const addStream3 = () => {
    const v = prompt('Enter Stream 3 URL or ID:'); if (!v) return;
    const id = getYouTubeId(v); if (id) { setS3(id); setS3Input(id); setS3Enabled(true); } else alert('Invalid link or ID.');
  };
  const changeStream2 = () => addStream2();
  const changeStream3 = () => addStream3();
  const removeStream2 = () => { setS2(null); setS2Input(''); setS2Enabled(false); };
  const removeStream3 = () => { setS3(null); setS3Input(''); setS3Enabled(false); };

  const copyShare = async (withSync = false) => {
    try {
      const q = new URLSearchParams();
      if (s1) q.set('s1', s1);
      if (s2) q.set('s2', s2);
      if (s3) q.set('s3', s3);
      if (withSync) {
        if (syncTarget) q.set('d', String(syncTarget));
        if (syncMove && syncMove !== 'auto') q.set('move', syncMove);
      }
      const url = `${window.location.origin}${window.location.pathname}${q.toString() ? `?${q}` : ''}`;
      await navigator.clipboard.writeText(url);
      toast(withSync ? 'Share URL (with sync) copied!' : 'Share URL copied!');
    } catch { toast('Copy failed — copy from address bar.'); }
  };

  const clearToLanding = () => {
    setS1(null); setS2(null); setS3(null);
    setS1Input(''); setS2Input(''); setS3Input('');
    localStorage.removeItem('ms_stream1'); localStorage.removeItem('ms_stream2'); localStorage.removeItem('ms_stream3');
    window.history.replaceState(null, '', window.location.pathname);
    setShowSettings(false);
    setControlsEnabled(true);
  };

  const resetLayout = () => {
    setL2ChatWidth(DEFAULT_L2_CHAT);
    setL3S2Height(DEFAULT_L3_S2H);
    setL3RightWidth(DEFAULT_L3_RIGHT_W);
    setPip(DEFAULT_PIP);
    setSwap(false);
    setFocus('both');
    setMuted1(false); setMuted2(false); setMuted3(true);
    setChatVisibleL3(true);
    setTopBarPos({ x: 0, y: 0 });
    setBottomBarPos({ x: 0, y: 0 });
    requestAnimationFrame(measureAll);
    toast('Layout reset');
  };

  /* ---- Theme helpers ---- */
  const onUploadLocalBg = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBgUrl(reader.result);
    reader.readAsDataURL(file);
  };
  const saveThemePreset = () => {
    const name = prompt('Preset name:'); if (!name) return;
    const preset = { name, bgUrl, frameW, frameColor };
    const next = [...themes.filter(t => t.name !== name), preset];
    setThemes(next);
    toast('Theme saved');
  };
  const applyThemePreset = (name) => {
    const t = themes.find(x => x.name === name); if (!t) return;
    setBgUrl(t.bgUrl || DEFAULT_BG); setFrameW(t.frameW ?? 0); setFrameColor(t.frameColor || '#ffffff');
    toast(`Theme “${name}” applied`);
  };
  const deleteThemePreset = (name) => { setThemes(themes.filter(t => t.name !== name)); };

  /* ---- Drag handles (bars) ---- */
  const dragRef = useRef(null);
  const onBarHandleDown = (which) => (e) => {
    e.preventDefault();
    const pt = ('touches' in e) ? e.touches[0] : e;
    dragRef.current = { which, x: pt.clientX, y: pt.clientY };
    const onMove = (ev) => {
      const p = ('touches' in ev) ? ev.touches[0] : ev;
      const dx = p.clientX - dragRef.current.x;
      const dy = p.clientY - dragRef.current.y;
      if (dragRef.current.which === 'top') setTopBarPos(pos => ({ x: pos.x + dx, y: pos.y + dy }));
      else setBottomBarPos(pos => ({ x: pos.x + dx, y: pos.y + dy }));
      dragRef.current.x = p.clientX; dragRef.current.y = p.clientY;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };

  /* ---------- helpers used in JSX ---------- */
  function styleFromRect(rect, keepRef, allowFallback) {
    let rr = rect;
    if (!rr && allowFallback) rr = keepRef?.current;
    if (rr) {
      if (rect && keepRef) keepRef.current = rect;
      return { left: rr.left, top: rr.top, width: rr.width, height: rr.height, visibility: 'visible', transform: 'translateZ(0)' };
    }
    return { visibility: 'hidden', left: -9999, top: -9999, width: 1, height: 1 };
  }

  function computedTargetsForLayout() {
    const stage = stageRef.current?.getBoundingClientRect();
    const W = stage?.width || window.innerWidth || 1280;
    const H = stage?.height || window.innerHeight || 720;
    const P = 8, GAP = 8;

    const fit16x9 = (wMax, hMax) => {
      const w = Math.min(wMax, hMax * 16 / 9);
      const h = w * 9 / 16;
      return [w, h];
    };

    if (layout === 8) {
      // 3-stream L1 (strict): S1 left hero, right stack S2/S3, height(S1) = height(S2)+height(S3)
      const innerW = W - 2 * P;
      const innerH = H - 2 * P;
      const rightW = Math.min((innerW - GAP) / 3, innerH * 8 / 9);
      const leftW = innerW - rightW - GAP;

      const h2 = rightW * 9 / 16;
      const h1 = 2 * h2;
      const w1 = 2 * rightW;

      const yTop = P + (innerH - h1) / 2;
      const s1 = { left: P + (leftW - w1) / 2, top: yTop, width: w1, height: h1 };
      const s2 = { left: P + leftW + GAP, top: yTop, width: rightW, height: h2 };
      const s3 = { left: P + leftW + GAP, top: yTop + h2, width: rightW, height: h2 };
      return { s1, s2, s3 };
    }

    if (layout === 9) {
      // 3-stream L3: three equal columns
      const innerW = W - 2 * P;
      const innerH = H - 2 * P;
      const colW = (innerW - 2 * GAP) / 3;
      const [vw, vh] = fit16x9(colW, innerH);
      const y = P + (innerH - vh) / 2;
      const x1 = P + (colW - vw) / 2;
      const x2 = P + colW + GAP + (colW - vw) / 2;
      const x3 = P + 2 * (colW + GAP) + (colW - vw) / 2;
      return {
        s1: { left: x1, top: y, width: vw, height: vh },
        s2: { left: x2, top: y, width: vw, height: vh },
        s3: { left: x3, top: y, width: vw, height: vh },
      };
    }

    if (layout === 7) {
      // 2-stream L7: 65/35 side-by-side (S1 left emphasis)
      const innerW = W - 2 * P;
      const innerH = H - 2 * P;
      const leftW = Math.floor(innerW * 0.65) - GAP / 2;
      const rightW = innerW - leftW - GAP;

      const [w1, h1] = fit16x9(leftW, innerH);
      const [w2, h2] = fit16x9(rightW, innerH);
      const s1 = { left: P + (leftW - w1) / 2, top: P + (innerH - h1) / 2, width: w1, height: h1 };
      const s2 = { left: P + leftW + GAP + (rightW - w2) / 2, top: P + (innerH - h2) / 2, width: w2, height: h2 };
      return { s1, s2 };
    }

    return null;
  }

  function targets() {
    const rectPip = { left: pip.x, top: pip.y, width: pip.width, height: pip.height };
    let tgt1 = null, tgt2 = null, tgt3 = null;
    let vis1 = false, vis2 = false, vis3 = false;
    let pipIsP1 = false, pipIsP2 = false;

    switch (layout) {
      case 1: tgt1 = rectS1 || lastS1.current; vis1 = true; break;
      case 2: tgt1 = rectS1 || lastS1.current; vis1 = true; break;
      case 3: tgt1 = rectS1 || lastS1.current; vis1 = true; tgt2 = rectS2 || lastS2.current; vis2 = !!tgt2; break;
      case 4:
        if (!swap) { tgt1 = rectS1 || lastS1.current; vis1 = true; tgt2 = rectPip; vis2 = true; pipIsP2 = true; }
        else { tgt1 = rectPip; vis1 = true; pipIsP1 = true; tgt2 = rectS1 || lastS1.current; vis2 = true; }
        break;
      case 5: tgt1 = rectS1 || lastS1.current; vis1 = true; tgt2 = rectS2 || lastS2.current; vis2 = !!tgt2; break;
      case 6: tgt2 = rectS2 || lastS2.current; vis2 = !!tgt2; break;
      case 7: {
        const ct = computedTargetsForLayout();
        if (ct?.s1) { tgt1 = ct.s1; vis1 = true; }
        if (ct?.s2) { tgt2 = ct.s2; vis2 = true; }
      } break;
      case 8: {
        const ct = computedTargetsForLayout();
        if (ct?.s1) { tgt1 = ct.s1; vis1 = true; }
        if (ct?.s2) { tgt2 = ct.s2; vis2 = true; }
        if (ct?.s3) { tgt3 = ct.s3; vis3 = true; }
      } break;
      case 9: {
        const ct = computedTargetsForLayout();
        if (ct?.s1) { tgt1 = ct.s1; vis1 = true; }
        if (ct?.s2) { tgt2 = ct.s2; vis2 = true; }
        if (ct?.s3) { tgt3 = ct.s3; vis3 = true; }
      } break;
      default: break;
    }
    if (![4, 8, 9].includes(layout) && (layout === 3 || layout === 5 || layout === 7) && swap) {
      [tgt1, tgt2, vis1, vis2] = [tgt2, tgt1, vis2, vis1];
    }
    return { tgt1, tgt2, tgt3, vis1, vis2, vis3, pipIsP1, pipIsP2 };
  }
  function s1StyleFrom() { const { tgt1, vis1 } = targets(); return styleFromRect(tgt1, lastS1, vis1); }
  function s2StyleFrom() { const { tgt2, vis2 } = targets(); return styleFromRect(tgt2, lastS2, vis2); }
  function s3StyleFrom() { const { tgt3, vis3 } = targets(); return styleFromRect(tgt3, lastS3, vis3); }
  function isPipP1() { return targets().pipIsP1; }
  function isPipP2() { return targets().pipIsP2; }

  /* ---------- Keyboard shortcuts ---------- */
  const getKeys = useCallback((id) => {
    const v = keymap[id]; return Array.isArray(v) ? v : [];
  }, [keymap]);

  const matchesKey = useCallback((desired, key, code) => {
    if (!desired) return false;
    const d = desired.toLowerCase();
    const k = (key || '').toLowerCase();
    const c = (code || '').toLowerCase();
    if (d === k || d === c) return true;
    if (d.startsWith('numkey') && c === d.replace('numkey', 'numpad')) return true;
    return false;
  }, []);

  const pressed = useCallback((id, key, code) => {
    const list = getKeys(id);
    for (const m of list) if (matchesKey(m, key, code)) return true;
    return false;
  }, [getKeys, matchesKey]);

  // Always-on listener (so 'S' can toggle shortcuts back ON when disabled)
  useEffect(() => {
    const onGlobalKey = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const typing = e.target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
      if (typing) return;
      const k = e.key, code = e.code;
      if (pressed('toggleShortcuts', k, code)) {
        setShortcutsEnabled(v => !v);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, [pressed]);

  // Regular shortcuts (active only when enabled)
  useEffect(() => {
    if (!shortcutsEnabled) return;

    const isTypingTarget = (el) => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return el.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
    };

    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;

      const k = e.key, code = e.code;

      // Layouts 1–9
      for (let n = 1; n <= 9; n++) {
        if (pressed(`layout${n}`, k, code)) { setLayout(n); e.preventDefault(); return; }
      }
      if (pressed('swap', k, code)) { setSwap(v => !v); e.preventDefault(); return; }
      if (pressed('openSettings', k, code)) { setShowSettings(true); e.preventDefault(); return; }

      if (pressed('focusAudio', k, code)) { cycleFocus(); e.preventDefault(); return; }
      if (pressed('muteAll', k, code)) { muteAll(); e.preventDefault(); return; }
      if (pressed('unmuteAll', k, code)) { unmuteAll(); e.preventDefault(); return; }
      if (pressed('nudgeBack', k, code)) { nudge(-10); e.preventDefault(); return; }
      if (pressed('nudgeForward', k, code)) { nudge(10); e.preventDefault(); return; }

      if (pressed('toggleChat', k, code)) {
        if (layout === 3) {
          if (!chatVisibleL3) setChatVisibleL3(true);
          else setChatTab(t => (s2 ? (t === 1 ? 2 : 1) : 1));
        }
        e.preventDefault(); return;
      }
      if (pressed('toggleInfo', k, code)) {
        const next = !(showTitles || showMetrics);
        setShowTitles(next); setShowMetrics(next);
        e.preventDefault(); return;
      }

      if (pressed('chatWidthDec', k, code)) { if (layout === 2) setL2ChatWidth(v => clamp(v - 20, 260, 720)); e.preventDefault(); return; }
      if (pressed('chatWidthInc', k, code)) { if (layout === 2) setL2ChatWidth(v => clamp(v + 20, 260, 720)); e.preventDefault(); return; }
      if (pressed('s2HeightDec', k, code)) { if (layout === 3) setL3S2Height(v => clamp(v - 10, 120, 800)); e.preventDefault(); return; }
      if (pressed('s2HeightInc', k, code)) { if (layout === 3) setL3S2Height(v => clamp(v + 10, 120, 800)); e.preventDefault(); return; }
      if (pressed('l3RightDec', k, code)) { if (layout === 3) setL3RightWidth(v => clamp(v - 10, 260, 720)); e.preventDefault(); return; }
      if (pressed('l3RightInc', k, code)) { if (layout === 3) setL3RightWidth(v => clamp(v + 10, 260, 720)); e.preventDefault(); return; }
      if (pressed('borderDec', k, code)) { setFrameW(v => clamp(v - 1, 0, 12)); e.preventDefault(); return; }
      if (pressed('borderInc', k, code)) { setFrameW(v => clamp(v + 1, 0, 12)); e.preventDefault(); return; }

      if (pressed('setMarkS1', k, code)) { setMarkerS1(); e.preventDefault(); return; }
      if (pressed('setMarkS2', k, code)) { setMarkerS2(); e.preventDefault(); return; }
      if (pressed('syncS2ToS1', k, code)) { syncS2ToS1Mark(); e.preventDefault(); return; }
      if (pressed('syncS1ToS2', k, code)) { syncS1ToS2Mark(); e.preventDefault(); return; }
      if (pressed('setSyncFromCurrent', k, code)) { setSyncFromCurrent(); e.preventDefault(); return; }
      if (pressed('syncNow', k, code)) { syncNow(); e.preventDefault(); return; }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    shortcutsEnabled, pressed, s2, layout, chatVisibleL3,
    showTitles, showMetrics,
    setMarkerS1, setMarkerS2, syncS2ToS1Mark, syncS1ToS2Mark, syncNow, setSyncFromCurrent,
    cycleFocus, muteAll, unmuteAll, nudge
  ]);

  /* ---- Play/Pause helpers ---- */
  const togglePlayS1 = useCallback(() => {
    const p = yt1.current; if (!p?.getPlayerState) return;
    try {
      const st = p.getPlayerState();
      if (st === window.YT.PlayerState.PLAYING) p.pauseVideo(); else p.playVideo();
    } catch { }
  }, []);
  const togglePlayS2 = useCallback(() => {
    const p = yt2.current; if (!p?.getPlayerState) return;
    try {
      const st = p.getPlayerState();
      if (st === window.YT.PlayerState.PLAYING) p.pauseVideo(); else p.playVideo();
    } catch { }
  }, []);
  const togglePlayS3 = useCallback(() => {
    const p = yt3.current; if (!p?.getPlayerState) return;
    try {
      const st = p.getPlayerState();
      if (st === window.YT.PlayerState.PLAYING) p.pauseVideo(); else p.playVideo();
    } catch { }
  }, []);

  const resetKeybinds = () => setKeymap(DEFAULT_KEYMAP);

  /* ---- Render ---- */
  return (
    <div className={`App ${s1 ? 'is-playing' : 'is-landing'}`}>
      {!s1 && (
        <div className="landing">
          <div className="landing-hero">
            <h1 className="headline">Multi‑Stream Player <span className="headline-accent">Pro</span></h1>
            <p className="sub">Dual/Triple streams, clean layouts, precise sync, and elegant overlays — optimized for low‑end devices.</p>
          </div>

          <div className="landing-card">
            <div className="form">
              <label htmlFor="s1">Primary Stream (required)</label>
              <input id="s1" className="field primary" placeholder="YouTube link or video ID"
                value={s1Input} onChange={(e) => setS1Input(e.target.value)}
                onPaste={(e) => { e.preventDefault(); setS1Input((e.clipboardData || window.clipboardData).getData('text')); }} />
              <label htmlFor="s2">Secondary Stream (optional)</label>
              <input id="s2" className="field" placeholder="YouTube link or video ID"
                value={s2Input} onChange={(e) => setS2Input(e.target.value)} />
              <label htmlFor="s3">Tertiary Stream (optional)</label>
              <input id="s3" className="field" placeholder="YouTube link or video ID"
                value={s3Input} onChange={(e) => setS3Input(e.target.value)} />
              <button className="cta" onClick={play}>Play</button>
            </div>

            {!!history.length && (
              <>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
                  <h4 className="section-title" style={{ margin: 0 }}>Recent (24h)</h4>
                  <div className="row gap" style={{ margin: 0 }}>
                    <button className="btn" onClick={() => setHistory(pruneHistory(history))}>Prune expired</button>
                    <button className="btn" onClick={clearHistory}>Clear all</button>
                  </div>
                </div>
                <div className="history-grid">
                  {history.map(h => (
                    <div key={h.id} className="hist-card">
                      <img src={h.thumb} alt={h.title} className="hist-thumb" />
                      <div className="hist-meta">
                        <div className="hist-title" title={h.title}>{h.title}</div>
                        <div className="hist-actions">
                          <button className="btn" onClick={() => setS1Input(h.id)}>Use as S1</button>
                          <button className="btn" onClick={() => setS2Input(h.id)}>Use as S2</button>
                          <button className="btn" onClick={() => setS3Input(h.id)}>Use as S3</button>
                          <button className="btn" onClick={() => removeHistItem(h.id)} title="Remove">🗑️</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="guide">
            <h3>Quick Guide</h3>
            <ol>
              <li>Paste YouTube links/IDs and click <b>Play</b>.</li>
              <li>Use the top bar to switch layouts (1–9). Layout 4 gives PIP; Layout 7 is 65/35; 8–9 are 3‑stream.</li>
              <li>Bottom bar controls audio focus, volumes, markers, sync, overlays. Open <b>Sidebar ☰</b> for more.</li>
              <li><b>S</b> toggles shortcuts — press again to re‑enable.</li>
            </ol>

            <h3>Keyboard Shortcuts (default)</h3>
            <div className="kbd-grid">
              <div><b>1–9</b> / <b>Numpad1–9</b> Layouts</div>
              <div><b>Q</b> Swap Streams</div>
              <div><b>A</b> Focus: S1 → Both → S2</div>
              <div><b>[ / ]</b> Seek −10s / +10s</div>
              <div><b>M / U</b> Mute / Unmute</div>
              <div><b>C</b> Toggle chat / switch tab (L3)</div>
              <div><b>I</b> Toggle titles + metrics</div>
              <div><b>9 / 0</b> Set S1 / S2 marker</div>
              <div><b>Shift+9 / Shift+0</b> S2→S1 / S1→S2</div>
              <div><b>`</b> Set Sync target (S1−S2), <b>G</b> Sync now</div>
              <div><b>O</b> Settings, <b>S</b> Toggle shortcuts</div>
            </div>
          </div>

          <div className="made-by">Made by <b>Vat5aL</b></div>
        </div>
      )}

      {s1 && (
        <div
          className="stage"
          ref={stageRef}
          style={{
            '--frame-w': `${(layout === 1 || layout === 6) ? 0 : frameW}px`,
            '--frame-color': frameColor,
            backgroundImage: bgUrl ? `url(${bgUrl})` : undefined
          }}
        >
          {/* Players */}
          <div className="players-layer">
            {s1Src && (
              <iframe
                ref={p1Ref}
                className={`player p1 ${pipMoving ? 'no-anim' : ''}`}
                title="Stream 1"
                src={s1Src}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{
                  ...s1StyleFrom(), pointerEvents: shortcutsEnabled ? 'none' : 'auto',
                  ...(layout === 4 && isPipP1() ? { border: '1px solid rgba(255,255,255,0.85)' } : null)
                }}
              />
            )}
            {s2Src && (
              <iframe
                ref={p2Ref}
                className={`player p2 ${pipMoving ? 'no-anim' : ''}`}
                title="Stream 2"
                src={s2Src}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{
                  ...s2StyleFrom(), pointerEvents: shortcutsEnabled ? 'none' : 'auto',
                  ...(layout === 4 && isPipP2() ? { border: '1px solid rgba(255,255,255,0.85)' } : null)
                }}
              />
            )}
            {s3Src && (
              <iframe
                ref={p3Ref}
                className={`player p3 ${pipMoving ? 'no-anim' : ''}`}
                title="Stream 3"
                src={s3Src}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{
                  ...s3StyleFrom(), pointerEvents: shortcutsEnabled ? 'none' : 'auto'
                }}
              />
            )}
          </div>

          {/* PIP layer */}
          <div className="pip-layer">
            {layout === 4 && (
              <Rnd
                className="pip-overlay"
                size={{ width: pip.width, height: pip.height }}
                position={{ x: pip.x, y: pip.y }}
                bounds=".stage"
                minWidth={220}
                minHeight={124}
                dragHandleClassName="pip-drag-handle"
                enableResizing={{
                  top: true, right: true, bottom: true, left: true,
                  topRight: true, bottomRight: true, bottomLeft: true, topLeft: true
                }}
                resizeHandleComponent={{
                  top: <div className="pip-handle pip-h-n" />,
                  right: <div className="pip-handle pip-h-e" />,
                  bottom: <div className="pip-handle pip-h-s" />,
                  left: <div className="pip-handle pip-h-w" />,
                  topRight: <div className="pip-handle pip-h-ne" />,
                  bottomRight: <div className="pip-handle pip-h-se" />,
                  bottomLeft: <div className="pip-handle pip-h-sw" />,
                  topLeft: <div className="pip-handle pip-h-nw" />,
                }}
                lockAspectRatio={pipLockAR ? 16 / 9 : false}
                onDragStart={() => { setPipMoving(true); setShield({ active: true, cursor: 'grabbing' }); }}
                onResizeStart={(e, dir) => { setPipMoving(true); setPipLockAR(!!e?.shiftKey); setShield({ active: true, cursor: cursorForDir(dir) }); }}
                onDrag={(e, d) => setPip(p => ({ ...p, x: d.x, y: d.y }))}
                onResize={(e, dir, ref, delta, pos) =>
                  setPip({ x: pos.x, y: pos.y, width: parseFloat(ref.style.width), height: parseFloat(ref.style.height) })
                }
                onDragStop={(e, d) => { setPip(p => ({ ...p, x: d.x, y: d.y })); setPipMoving(false); setShield({ active: false, cursor: 'default' }); }}
                onResizeStop={(e, dir, ref, delta, pos) => { setPip({ x: pos.x, y: pos.y, width: parseFloat(ref.style.width), height: parseFloat(ref.style.height) }); setPipMoving(false); setShield({ active: false, cursor: 'default' }); }
                }
              >
                <div className="pip-box">
                  <div className="pip-drag-handle" title="Drag PIP">⋮⋮ Drag</div>
                </div>
              </Rnd>
            )}
          </div>

          {/* Overlays (titles/metrics) */}
          <div className="metrics-layer">
            {s1StyleFrom().visibility === 'visible' && (showTitles || showMetrics) && (
              <div className="info-card" style={{ left: (s1StyleFrom().left + 12), top: (s1StyleFrom().top + 12) }}>
                <div className="info-row">
                  {showTitles && (info1.title ? <span className="title">{info1.title}</span> : <span className="title skeleton" />)}
                </div>
                {showMetrics && (
                  <div className="metric-row">
                    {ytApiKey ? (
                      <>
                        {info1.viewers !== null && <span className="chip">👀 {info1.viewers.toLocaleString()}</span>}
                        {info1.likes !== null && <span className="chip">👍 {info1.likes.toLocaleString()}</span>}
                        {(info1.viewers === null && info1.likes === null) && <span className="chip">…</span>}
                      </>
                    ) : (
                      <span className="chip">🔑 Add API key in Settings for metrics</span>
                    )}
                  </div>
                )}
              </div>
            )}
            {s2StyleFrom().visibility === 'visible' && (showTitles || showMetrics) && (
              <div className="info-card" style={{ left: (s2StyleFrom().left + 12), top: (s2StyleFrom().top + 12) }}>
                <div className="info-row">
                  {showTitles && (info2.title ? <span className="title">{info2.title}</span> : <span className="title skeleton" />)}
                </div>
                {showMetrics && (
                  <div className="metric-row">
                    {ytApiKey ? (
                      <>
                        {info2.viewers !== null && <span className="chip">👀 {info2.viewers.toLocaleString()}</span>}
                        {info2.likes !== null && <span className="chip">👍 {info2.likes.toLocaleString()}</span>}
                        {(info2.viewers === null && info2.likes === null) && <span className="chip">…</span>}
                      </>
                    ) : (
                      <span className="chip">🔑 Add API key in Settings for metrics</span>
                    )}
                  </div>
                )}
              </div>
            )}
            {s3StyleFrom().visibility === 'visible' && (showTitles || showMetrics) && (
              <div className="info-card" style={{ left: (s3StyleFrom().left + 12), top: (s3StyleFrom().top + 12) }}>
                <div className="info-row">
                  {showTitles && (info3.title ? <span className="title">{info3.title}</span> : <span className="title skeleton" />)}
                </div>
                {showMetrics && (
                  <div className="metric-row">
                    {ytApiKey ? (
                      <>
                        {info3.viewers !== null && <span className="chip">👀 {info3.viewers.toLocaleString()}</span>}
                        {info3.likes !== null && <span className="chip">👍 {info3.likes.toLocaleString()}</span>}
                        {(info3.viewers === null && info3.likes === null) && <span className="chip">…</span>}
                      </>
                    ) : (
                      <span className="chip">🔑 Add API key in Settings for metrics</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* UI layer */}
          <div className="ui-layer">
            <div className="interaction-shield" style={{ cursor: shield.cursor, ...(shield.active ? { pointerEvents: 'auto' } : {}) }} />

            {/* Layout slots & chat (only where needed) */}
            {(() => {
              switch (layout) {
                case 1:
                  return (<div className="layout layout-1"><div className="slot slot-s1" ref={slotS1} /></div>);
                case 2:
                  return (
                    <div className="layout layout-2" style={{ gridTemplateColumns: `1fr 8px ${l2ChatWidth}px` }}>
                      <div className="slot slot-s1" ref={slotS1} />
                      <div />
                      <div className="chat-panel"><div className="chat-slot" ref={chatSlot} /></div>
                    </div>
                  );
                case 3:
                  return (
                    <div className="layout layout-3" style={{ gridTemplateColumns: `1fr ${l3RightWidth}px` }}>
                      <div className="slot slot-s1" ref={slotS1} />
                      <div
                        className="right-col"
                        style={chatVisibleL3
                          ? { gridTemplateRows: `${l3S2Height}px 8px 1fr` }
                          : { display: 'grid', gridTemplateRows: '1fr' }}
                      >
                        <div
                          className="slot-wrap"
                          style={chatVisibleL3 ? undefined : { display: 'flex', alignItems: 'center' }}
                        >
                          <div className={`slot slot-s2 fill ${s2 ? 'transparent' : ''}`} ref={slotS2} />
                          {!s2 && <button className="add-stream-tile" onClick={addStream2}>+</button>}
                        </div>
                        {chatVisibleL3 && <div />}
                        {chatVisibleL3 && (
                          <div className="chat-panel">
                            <div className="chat-toggle">
                              <button className={chatTab === 1 ? 'active' : ''} onClick={() => setChatTab(1)}>Stream 1 Chat</button>
                              <button className={chatTab === 2 ? 'active' : ''} onClick={() => setChatTab(2)} disabled={!s2}>Stream 2 Chat</button>
                            </div>
                            <div className="chat-slot" ref={chatSlot} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                case 4:
                  return (<div className="layout layout-4"><div className="slot slot-s1" ref={slotS1} /></div>);
                case 5:
                  return (
                    <div className="layout layout-5">
                      <div className="slot slot-s1" ref={slotS1} />
                      <div className="slot-wrap center-wrap">
                        <div className={`slot slot-s2 fill ${s2 ? 'transparent' : ''}`} ref={slotS2} />
                        {!s2 && <button className="add-stream-tile" onClick={addStream2}>+</button>}
                      </div>
                    </div>
                  );
                case 6:
                  return (
                    <div className="layout layout-6">
                      {(swap ? s1 : s2) ? <div className="slot slot-s2" ref={slotS2} /> : (
                        <div className="add-stream-fullscreen">
                          <div className="add-stream-content">
                            <span className="plus-icon">+</span>
                            <p>Add Stream 2 to view in fullscreen</p>
                            <button className="cta" onClick={addStream2}>Add Stream 2</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                case 7:
                  return (
                    <div className="layout layout-7">
                      <div className="slot slot-s1" ref={slotS1} />
                      <div className="slot slot-s2" ref={slotS2} />
                    </div>
                  );
                case 8:
                  return (<div className="layout layout-8" />);
                case 9:
                  return (<div className="layout layout-9" />);
                default: return null;
              }
            })()}

            {/* Chat frames */}
            <div className="chat-layer">
              {chat1Src && (
                <iframe
                  className={`chat-frame-abs ${(layout === 2 && !!s1) || (layout === 3 && chatVisibleL3 && chatTab === 1) ? 'show' : 'hide'}`}
                  title="Stream 1 Chat"
                  src={chat1Src}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="origin-when-cross-origin"
                  style={styleFromRect(rectChat, lastChat, true)}
                />
              )}
              {chat2Src && (
                <iframe
                  className={`chat-frame-abs ${(layout === 3 && chatVisibleL3 && chatTab === 2) ? 'show' : 'hide'}`}
                  title="Stream 2 Chat"
                  src={chat2Src}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="origin-when-cross-origin"
                  style={styleFromRect(rectChat, lastChat, true)}
                />
              )}
            </div>

            {/* ===== Top bar (3-row layout grid) – draggable ===== */}
            <div
              className="layout-menu visible"
              style={{
                top: 12 + topBarPos.y,
                left: `calc(50% + ${topBarPos.x}px)`,
                transform: 'translateX(-50%)',
                zIndex: 10
              }}
            >
              <div className="drag-handle" onMouseDown={onBarHandleDown('top')} onTouchStart={onBarHandleDown('top')} title="Drag">⋮⋮</div>

              <div className="layout-grid-3x3">
                {Array.from({ length: 9 }, (_, i) => i + 1).map(n => (
                  <button key={n} onClick={() => setLayout(n)} className={layout === n ? 'active' : ''}>{n}</button>
                ))}
              </div>

              <div className="top-actions-row">
                <button onClick={() => setSwap(v => !v)} title="Swap streams">Swap</button>
                {layout === 3 && (
                  <button onClick={() => setChatVisibleL3(v => !v)} title="Toggle chat">{chatVisibleL3 ? 'Hide chat' : 'Show chat'}</button>
                )}
                <button onClick={resetLayout} title="Reset splits, bars & PIP">Reset</button>
                <button onClick={() => setControlsEnabled(v => !v)} className={controlsEnabled ? 'active' : ''} title="Toggle bottom bar">Controls</button>
                <button onClick={() => setShortcutsEnabled(v => !v)} className={shortcutsEnabled ? 'active' : ''} title="Toggle shortcuts">Shortcuts</button>
                <button onClick={() => setShowSettings(true)} title="Open settings">⚙️</button>
                <button onClick={() => setSidebarOpen(true)} title="Open Sidebar Menu">☰</button>
              </div>
            </div>

            {/* ===== Bottom Quickbar (compact) – draggable ===== */}
            {controlsEnabled && (
              <div
                className="quickbar compact"
                style={{
                  bottom: 12 + bottomBarPos.y,
                  left: `calc(50% + ${bottomBarPos.x}px)`,
                  transform: 'translateX(-50%)'
                }}
              >
                <div className="drag-handle" onMouseDown={onBarHandleDown('bottom')} onTouchStart={onBarHandleDown('bottom')} title="Drag">⋮⋮</div>

                {/* Focus */}
                <div className="qb-group">
                  <span className="qb-label">Focus</span>
                  <button className={`btn ${focus === 's1' ? 'active' : ''}`} onClick={focusS1}>S1</button>
                  <button className={`btn ${focus === 'both' ? 'active' : ''}`} onClick={focusBoth}>Both</button>
                  <button className={`btn ${focus === 's2' ? 'active' : ''}`} onClick={focusS2}>S2</button>
                </div>

                {/* Audio quick */}
                <div className="qb-group">
                  <span className="qb-label">Audio</span>
                  <button className="btn" onClick={muteAll}>Mute</button>
                  <button className="btn" onClick={unmuteAll}>Unmute</button>
                  <button className="btn" onClick={() => nudge(-10)}>−10s</button>
                  <button className="btn" onClick={() => nudge(10)}>+10s</button>
                </div>

                {/* Levels */}
                <div className="qb-group slim">
                  <span className="qb-label">Levels</span>
                  <span className="mini">S1</span>
                  <input type="range" min="0" max="100" value={vol1} onChange={e => setVol1(Number(e.target.value))} disabled={!s1Enabled || !s1} />
                  <label className="switch"><input type="checkbox" checked={s1Enabled} onChange={(e) => setS1Enabled(e.target.checked)} /><span>On</span></label>
                  <span className="mini">S2</span>
                  <input type="range" min="0" max="100" value={vol2} onChange={e => setVol2(Number(e.target.value))} disabled={!s2Enabled || !s2} />
                  <label className="switch"><input type="checkbox" checked={s2Enabled} onChange={(e) => setS2Enabled(e.target.checked)} /><span>On</span></label>
                  {s3 && (
                    <>
                      <span className="mini">S3</span>
                      <input type="range" min="0" max="100" value={vol3} onChange={e => setVol3(Number(e.target.value))} disabled={!s3Enabled || !s3} />
                      <label className="switch"><input type="checkbox" checked={s3Enabled} onChange={(e) => setS3Enabled(e.target.checked)} /><span>On</span></label>
                    </>
                  )}
                </div>

                {/* Markers */}
                <div className="qb-group">
                  <span className="qb-label">Markers</span>
                  <button className="btn" onClick={setMarkerS1}>Set S1</button>
                  <button className="btn" onClick={setMarkerS2}>Set S2</button>
                  <button className="btn" onClick={syncS2ToS1Mark} disabled={markS1 == null}>S2 → S1</button>
                  <button className="btn" onClick={syncS1ToS2Mark} disabled={markS2 == null}>S1 → S2</button>
                </div>

                {/* Sync */}
                <div className="qb-group wide">
                  <span className="qb-label">Sync</span>
                  <span className="drift">Δ {(drift || 0).toFixed(2)}s</span>
                  <input className="num" style={{ width: 72 }} type="number" step="0.1" value={syncTarget} onChange={e => setSyncTarget(Number(e.target.value))} title="Target drift (S1 - S2)" />
                  <select className="field small" value={syncMove} onChange={e => setSyncMove(e.target.value)}>
                    <option value="auto">Auto</option>
                    <option value="s2">Move S2</option>
                    <option value="s1">Move S1</option>
                  </select>
                  <button className="btn" onClick={setSyncFromCurrent} title="Set target to current drift">Set Sync</button>
                  <button className="btn" onClick={syncNow}>Sync now</button>
                  <button className="btn" onClick={goLiveS1} disabled={!s1}>S1 {behind1 > 0 ? `-${behind1.toFixed(1)}s` : '0s'}</button>
                  <button className="btn" onClick={goLiveS2} disabled={!s2}>S2 {behind2 > 0 ? `-${behind2.toFixed(1)}s` : '0s'}</button>
                </div>

                {/* View toggles */}
                <div className="qb-group">
                  <span className="qb-label">View</span>
                  <button className={`btn ${showTitles ? 'active' : ''}`} onClick={() => setShowTitles(v => !v)}>Titles</button>
                  <button className={`btn ${showMetrics ? 'active' : ''}`} onClick={() => setShowMetrics(v => !v)}>Metrics</button>
                  {layout === 3 && (
                    <button className="btn" onClick={() => setChatVisibleL3(v => !v)}>{chatVisibleL3 ? 'Hide Chat' : 'Show Chat'}</button>
                  )}
                </div>

                {/* Stream toggles & actions */}
                <div className="qb-group">
                  <span className="qb-label">Streams</span>
                  <button className="btn" onClick={() => setS1Enabled(v => !v)}>{s1Enabled ? 'S1: On' : 'S1: Off'}</button>
                  <button className="btn" onClick={() => setS2Enabled(v => !v)}>{s2Enabled ? 'S2: On' : 'S2: Off'}</button>
                  <button className="btn" onClick={() => setChatVisibleL3(v => !v)}>{chatVisibleL3 ? 'Chat(L3): On' : 'Chat(L3): Off'}</button>
                  <button className="btn" onClick={resetKeybinds}>Reset Keybinds</button>
                  <button className="btn" onClick={togglePlayS1}>Play/Pause S1</button>
                  <button className="btn" onClick={togglePlayS2}>Play/Pause S2</button>
                </div>
              </div>
            )}
          </div>

          {!!toastMsg && <div className="toast">{toastMsg}</div>}
        </div>
      )}

      {/* Sidebar Menu (right drawer) */}
      {s1 && (
        <>
          <div className={`sidebar-backdrop ${sidebarOpen ? 'show' : ''}`} onClick={() => setSidebarOpen(false)} />
          <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-head">
              <h4>Menu</h4>
              <button className="btn" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>

            <div className="sidebar-section">
              <div className="row"><b>Layout</b></div>
              <div className="layout-grid-3x3">
                {Array.from({ length: 9 }, (_, i) => i + 1).map(n => (
                  <button key={`sb-${n}`} onClick={() => setLayout(n)} className={layout === n ? 'active' : ''}>{n}</button>
                ))}
              </div>
              <div className="row gap">
                <button className="btn" onClick={() => setSwap(v => !v)}>Swap</button>
                {layout === 3 && <button className="btn" onClick={() => setChatVisibleL3(v => !v)}>{chatVisibleL3 ? 'Hide Chat' : 'Show Chat'}</button>}
                <button className="btn" onClick={resetLayout}>Reset Layout</button>
              </div>
            </div>

            <div className="sidebar-section">
              <div className="row"><b>Focus & Audio</b></div>
              <div className="row gap">
                <button className={`btn ${focus === 's1' ? 'active' : ''}`} onClick={focusS1}>Focus S1</button>
                <button className={`btn ${focus === 'both' ? 'active' : ''}`} onClick={focusBoth}>Focus Both</button>
                <button className={`btn ${focus === 's2' ? 'active' : ''}`} onClick={focusS2}>Focus S2</button>
              </div>
              <div className="row gap">
                <button className="btn" onClick={muteAll}>Mute All</button>
                <button className="btn" onClick={unmuteAll}>Unmute All</button>
              </div>
              <div className="row"><b>Levels</b></div>
              <div className="row gap">
                <span className="mini">S1</span><input type="range" min="0" max="100" value={vol1} onChange={e => setVol1(Number(e.target.value))} disabled={!s1Enabled || !s1} />
                <span className="mini">S2</span><input type="range" min="0" max="100" value={vol2} onChange={e => setVol2(Number(e.target.value))} disabled={!s2Enabled || !s2} />
                {s3 && (<><span className="mini">S3</span><input type="range" min="0" max="100" value={vol3} onChange={e => setVol3(Number(e.target.value))} disabled={!s3Enabled || !s3} /></>)}
              </div>
            </div>

            <div className="sidebar-section">
              <div className="row"><b>Sync</b></div>
              <div className="row gap">
                <span className="drift">Δ {(drift || 0).toFixed(2)}s</span>
                <input className="num" style={{ width: 88 }} type="number" step="0.1" value={syncTarget} onChange={e => setSyncTarget(Number(e.target.value))} />
              </div>
              <div className="row gap">
                <select className="field small" value={syncMove} onChange={e => setSyncMove(e.target.value)}>
                  <option value="auto">Auto</option>
                  <option value="s2">Move S2</option>
                  <option value="s1">Move S1</option>
                </select>
                <button className="btn" onClick={setSyncFromCurrent}>Set Sync</button>
                <button className="btn" onClick={syncNow}>Sync now</button>
              </div>
              <div className="row gap">
                <button className="btn" onClick={goLiveS1} disabled={!s1}>Go Live S1</button>
                <button className="btn" onClick={goLiveS2} disabled={!s2}>Go Live S2</button>
                {s3 && <button className="btn" onClick={goLiveS3} disabled={!s3}>Go Live S3</button>}
              </div>
            </div>

            <div className="sidebar-section">
              <div className="row"><b>Toggles & Actions</b></div>
              <div className="row gap">
                <button className="btn" onClick={() => setS1Enabled(v => !v)}>{s1Enabled ? 'S1: On' : 'S1: Off'}</button>
                <button className="btn" onClick={() => setS2Enabled(v => !v)}>{s2Enabled ? 'S2: On' : 'S2: Off'}</button>
                {s3 && <button className="btn" onClick={() => setS3Enabled(v => !v)}>{s3Enabled ? 'S3: On' : 'S3: Off'}</button>}
                <button className="btn" onClick={() => setChatVisibleL3(v => !v)}>{chatVisibleL3 ? 'Chat(L3): On' : 'Chat(L3): Off'}</button>
              </div>
              <div className="row gap">
                <button className="btn" onClick={togglePlayS1}>Play/Pause S1</button>
                <button className="btn" onClick={togglePlayS2}>Play/Pause S2</button>
                {s3 && <button className="btn" onClick={togglePlayS3}>Play/Pause S3</button>}
              </div>
              <div className="row gap">
                <button className="btn" onClick={resetKeybinds}>Reset Keybinds</button>
                <button className="btn" onClick={() => setShortcutsEnabled(v => !v)}>{shortcutsEnabled ? 'Shortcuts: On' : 'Shortcuts: Off'}</button>
                <button className="btn" onClick={() => setShowSettings(true)}>Open Settings ⚙️</button>
              </div>
            </div>

            <div className="sidebar-foot">
              <button className="btn" onClick={() => copyShare(false)}>Copy Share URL</button>
              <button className="btn" onClick={() => copyShare(true)}>Copy Share + Sync</button>
            </div>
          </aside>
        </>
      )}

      {/* Settings */}
      {showSettings && (
        <SettingsModal
          close={() => setShowSettings(false)}
          // general
          shortcutsEnabled={shortcutsEnabled}
          setShortcutsEnabled={setShortcutsEnabled}
          share={() => copyShare(false)}
          shareWithSync={() => copyShare(true)}
          resetLayout={resetLayout}
          // streams
          s1Input={s1Input} setS1Input={setS1Input}
          s2Input={s2Input} setS2Input={setS2Input}
          s3Input={s3Input} setS3Input={setS3Input}
          hasS2={!!s2} hasS3={!!s3}
          applyStreams={async () => {
            const id1 = getYouTubeId(s1Input);
            const id2 = getYouTubeId(s2Input);
            const id3 = getYouTubeId(s3Input);
            if (!id1) { alert('Primary stream is invalid.'); return; }
            setS1(id1); setS2(id2 || null); setS3(id3 || null);
            setS1Enabled(true); if (id2) setS2Enabled(true); if (id3) setS3Enabled(true);
            setShowSettings(false);
            try {
              const m1 = await fetchTitleThumbNoKey(id1); addToHistory(id1, m1.title, m1.thumb);
              if (id2) { const m2 = await fetchTitleThumbNoKey(id2); addToHistory(id2, m2.title, m2.thumb); }
              if (id3) { const m3 = await fetchTitleThumbNoKey(id3); addToHistory(id3, m3.title, m3.thumb); }
            } catch { }
          }}
          clearToLanding={clearToLanding}
          // layout sizes
          l2ChatWidth={l2ChatWidth} setL2ChatWidth={(v) => { setL2ChatWidth(v); requestAnimationFrame(measureAll); }}
          l3S2Height={l3S2Height} setL3S2Height={(v) => { setL3S2Height(v); requestAnimationFrame(measureAll); }}
          l3RightWidth={l3RightWidth} setL3RightWidth={(v) => { setL3RightWidth(v); requestAnimationFrame(measureAll); }}
          chatVisibleL3={chatVisibleL3} setChatVisibleL3={setChatVisibleL3}
          // appearance
          frameW={frameW} setFrameW={setFrameW}
          frameColor={frameColor} setFrameColor={setFrameColor}
          bgUrl={bgUrl} setBgUrl={setBgUrl}
          onUploadLocalBg={onUploadLocalBg}
          themes={themes} saveThemePreset={saveThemePreset}
          applyThemePreset={applyThemePreset} deleteThemePreset={deleteThemePreset}
          // overlays
          showMetrics={showMetrics} setShowMetrics={setShowMetrics}
          showTitles={showTitles} setShowTitles={setShowTitles}
          // keymap
          keymap={keymap} setKeymap={setKeymap}
          resetKeybinds={resetKeybinds}
          // playback
          defaultQuality={defaultQuality} setDefaultQuality={setDefaultQuality}
          // API key
          ytApiKeyOverride={ytApiKeyOverride} setYtApiKeyOverride={setYtApiKeyOverride}
          // enable flags
          s1Enabled={s1Enabled} setS1Enabled={setS1Enabled}
          s2Enabled={s2Enabled} setS2Enabled={setS2Enabled}
          s3Enabled={s3Enabled} setS3Enabled={setS3Enabled}
          // S2/S3 change/remove in Settings
          changeStream2={changeStream2}
          removeStream2={removeStream2}
          changeStream3={changeStream3}
          removeStream3={removeStream3}
          // per-stream quality (in Settings only)
          q1={q1} setQ1={setQ1}
          q2={q2} setQ2={setQ2}
          q3={q3} setQ3={setQ3}
          assertQuality={assertQuality}
          yt1={yt1} yt2={yt2} yt3={yt3}
        />
      )}

    </div>
  );
}

/* ------------------- Settings Modal ------------------- */
function SettingsModal(props) {
  const {
    close,
    // general
    shortcutsEnabled, setShortcutsEnabled, share, shareWithSync, resetLayout,
    // streams
    s1Input, setS1Input, s2Input, setS2Input, s3Input, setS3Input, hasS2, hasS3, applyStreams, clearToLanding,
    // layout sizes
    l2ChatWidth, setL2ChatWidth, l3S2Height, setL3S2Height, l3RightWidth, setL3RightWidth,
    chatVisibleL3, setChatVisibleL3,
    // appearance
    frameW, setFrameW, frameColor, setFrameColor, bgUrl, setBgUrl, onUploadLocalBg,
    themes, saveThemePreset, applyThemePreset, deleteThemePreset,
    // overlays
    showMetrics, setShowMetrics, showTitles, setShowTitles,
    // keymap
    keymap, setKeymap, resetKeybinds,
    // playback
    defaultQuality, setDefaultQuality,
    // API key
    ytApiKeyOverride, setYtApiKeyOverride,
    // enable flags
    s1Enabled, setS1Enabled, s2Enabled, setS2Enabled, s3Enabled, setS3Enabled,
    // S2/S3 change/remove
    changeStream2, removeStream2, changeStream3, removeStream3,
    // per-stream quality (in settings only)
    q1, setQ1, q2, setQ2, q3, setQ3, assertQuality, yt1, yt2, yt3
  } = props;

  const allKeys = useMemo(() => {
    const list = [];
    Object.values(keymap).forEach(arr => (Array.isArray(arr) ? arr : []).forEach(k => { if (k) list.push(k.toLowerCase()); }));
    return list;
  }, [keymap]);

  const keyCount = useMemo(() => {
    const m = new Map();
    allKeys.forEach(k => m.set(k, (m.get(k) || 0) + 1));
    return m;
  }, [allKeys]);

  const setKeyAt = (id, idx, key) => {
    setKeymap(prev => {
      const cur = Array.isArray(prev[id]) ? [...prev[id]] : [];
      cur[idx] = key;
      const clean = cur.filter((v, i) => typeof v === 'string' && v.trim().length && cur.indexOf(v) === i).slice(0, 2);
      return { ...prev, [id]: clean };
    });
  };
  const addSecondKey = (id) => setKeymap(prev => ({ ...prev, [id]: (prev[id] || []).slice(0, 2).concat('').slice(0, 2) }));
  const removeKeyAt = (id, idx) => setKeymap(prev => {
    const cur = Array.isArray(prev[id]) ? [...prev[id]] : [];
    cur.splice(idx, 1);
    return { ...prev, [id]: cur };
  });

  const row = (children) => <div className="row">{children}</div>;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Close settings">✕</button>
        <h3>Settings</h3>
        <div className="settings-grid">

          {/* General */}
          <section className="settings-group">
            <h4>General</h4>
            {row(
              <>
                <div className="label">Keyboard shortcuts</div>
                <button
                  className={`toggle-btn ${shortcutsEnabled ? 'enabled' : 'disabled'}`}
                  onClick={() => setShortcutsEnabled(v => !v)}
                  title="Toggle hotkeys (when OFF you can use YouTube controls directly)"
                  style={{ pointerEvents: 'auto' }}
                >
                  {shortcutsEnabled ? 'ON' : 'OFF'}
                </button>
              </>
            )}
            <div className="row gap">
              <button className="cta" onClick={share}>Copy Share URL</button>
              <button className="btn" onClick={shareWithSync}>Copy Share + Sync</button>
              <button className="btn" onClick={resetLayout}>Reset Layout</button>
              <button className="btn" onClick={clearToLanding}>Clear & Go to Landing</button>
            </div>
          </section>

          {/* Streams */}
          <section className="settings-group">
            <h4>Streams</h4>
            <label>Primary stream</label>
            <input className="field primary" value={s1Input} onChange={(e) => setS1Input(e.target.value)} placeholder="YouTube link or video ID" />
            <label>Secondary stream</label>
            <input className="field" value={s2Input} onChange={(e) => setS2Input(e.target.value)} placeholder="YouTube link or video ID" />
            <label>Tertiary stream</label>
            <input className="field" value={s3Input} onChange={(e) => setS3Input(e.target.value)} placeholder="YouTube link or video ID" />
            {row(<><div className="label">Stream 1 enabled</div><button className={`toggle-btn ${s1Enabled ? 'enabled' : 'disabled'}`} onClick={() => setS1Enabled(v => !v)}>{s1Enabled ? 'ON' : 'OFF'}</button></>)}
            {row(<><div className="label">Stream 2 enabled</div><button className={`toggle-btn ${s2Enabled ? 'enabled' : 'disabled'}`} onClick={() => setS2Enabled(v => !v)}>{s2Enabled ? 'ON' : 'OFF'}</button></>)}
            {row(<><div className="label">Stream 3 enabled</div><button className={`toggle-btn ${s3Enabled ? 'enabled' : 'disabled'}`} onClick={() => setS3Enabled(v => !v)}>{s3Enabled ? 'ON' : 'OFF'}</button></>)}
            {row(<><div className="label">Layout 3 chat visible</div><button className={`toggle-btn ${chatVisibleL3 ? 'enabled' : 'disabled'}`} onClick={() => setChatVisibleL3(v => !v)}>{chatVisibleL3 ? 'ON' : 'OFF'}</button></>)}
            <div className="row gap">
              <button className="btn" onClick={changeStream2}>Change Stream 2</button>
              <button className="btn" onClick={removeStream2} disabled={!hasS2}>Remove Stream 2</button>
              <button className="btn" onClick={changeStream3}>Change Stream 3</button>
              <button className="btn" onClick={removeStream3} disabled={!hasS3}>Remove Stream 3</button>
            </div>
            <div className="row gap"><button className="cta" onClick={applyStreams}>Apply Streams</button></div>
          </section>

          {/* Layout */}
          <section className="settings-group">
            <h4>Layout</h4>
            {row(
              <>
                <div className="label">Layout 2 – Chat width</div>
                <input type="range" min="260" max="720" step="2" value={l2ChatWidth} onChange={(e) => setL2ChatWidth(Number(e.target.value))} />
                <input className="num" type="number" min="260" max="720" step="2" value={l2ChatWidth} onChange={(e) => setL2ChatWidth(clamp(Number(e.target.value), 260, 720))} />
                <span className="unit">px</span>
              </>
            )}
            {row(
              <>
                <div className="label">Layout 3 – Stream 2 height</div>
                <input type="range" min="120" max="800" step="2" value={l3S2Height} onChange={(e) => setL3S2Height(Number(e.target.value))} />
                <input className="num" type="number" min="120" max="800" step="2" value={l3S2Height} onChange={(e) => setL3S2Height(clamp(Number(e.target.value), 120, 800))} />
                <span className="unit">px</span>
              </>
            )}
            {row(
              <>
                <div className="label">Layout 3 – Right column width</div>
                <input type="range" min="260" max="720" step="2" value={l3RightWidth} onChange={(e) => setL3RightWidth(Number(e.target.value))} />
                <input className="num" type="number" min="260" max="720" step="2" value={l3RightWidth} onChange={(e) => setL3RightWidth(clamp(Number(e.target.value), 260, 720))} />
                <span className="unit">px</span>
              </>
            )}
          </section>

          {/* Appearance */}
          <section className="settings-group">
            <h4>Appearance</h4>
            {row(<><div className="label">Frame border width</div><input type="range" min="0" max="12" step="1" value={frameW} onChange={(e) => setFrameW(Number(e.target.value))} /><input className="num" type="number" min="0" max="12" step="1" value={frameW} onChange={(e) => setFrameW(clamp(Number(e.target.value), 0, 12))} /><span className="unit">px</span></>)}
            {row(<><div className="label">Frame border color</div><input type="color" value={frameColor} onChange={(e) => setFrameColor(e.target.value)} /><input className="field" value={frameColor} onChange={(e) => setFrameColor(e.target.value)} style={{ maxWidth: 160 }} /></>)}
            <label>Background image URL</label>
            <input className="field" value={bgUrl} onChange={(e) => setBgUrl(e.target.value)} placeholder="https://… (leave blank for gradient)" />
            <div className="row gap">
              <input type="file" accept="image/*" onChange={(e) => onUploadLocalBg(e.target.files?.[0])} />
              <button className="btn" onClick={() => setBgUrl(DEFAULT_BG)}>Use Default</button>
              <button className="btn" onClick={() => setBgUrl('')}>Use Gradient</button>
              <button className="btn" onClick={saveThemePreset}>Save Theme Preset</button>
            </div>
            {!!themes?.length && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {themes.map(t => (
                  <div key={t.name} className="theme-chip">
                    <span>{t.name}</span>
                    <button className="btn" onClick={() => applyThemePreset(t.name)}>Apply</button>
                    <button className="btn" onClick={() => deleteThemePreset(t.name)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Overlays */}
          <section className="settings-group">
            <h4>Overlays</h4>
            {row(<><div className="label">Show live metrics (viewers/likes)</div><button className={`toggle-btn ${showMetrics ? 'enabled' : 'disabled'}`} onClick={() => setShowMetrics(v => !v)}>{showMetrics ? 'ON' : 'OFF'}</button></>)}
            {row(<><div className="label">Show stream title</div><button className={`toggle-btn ${showTitles ? 'enabled' : 'disabled'}`} onClick={() => setShowTitles(v => !v)}>{showTitles ? 'ON' : 'OFF'}</button></>)}
          </section>

          {/* Playback */}
          <section className="settings-group">
            <h4>Playback</h4>
            {row(<><div className="label">Default quality</div><select className="field" value={defaultQuality} onChange={(e) => setDefaultQuality(e.target.value)} style={{ maxWidth: 200 }}>{['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'default'].map(q => (<option key={q} value={q}>{prettyQuality(q)}</option>))}</select></>)}
            <div className="row gap">
              <div className="label">Per‑stream (applies on next ready)</div>
              <select className="field small" value={q1} onChange={(e) => { const v = e.target.value; setQ1(v); try { assertQuality(yt1, v === 'default' ? defaultQuality : v); } catch { } }} title="S1 quality">
                {QUALITY_ORDER.map(q => <option key={`q1-${q}`} value={q}>{prettyQuality(q)}</option>)}
              </select>
              <select className="field small" value={q2} onChange={(e) => { const v = e.target.value; setQ2(v); try { assertQuality(yt2, v === 'default' ? defaultQuality : v); } catch { } }} title="S2 quality">
                {QUALITY_ORDER.map(q => <option key={`q2-${q}`} value={q}>{prettyQuality(q)}</option>)}
              </select>
              <select className="field small" value={q3} onChange={(e) => { const v = e.target.value; setQ3(v); try { assertQuality(yt3, v === 'default' ? defaultQuality : v); } catch { } }} title="S3 quality">
                {QUALITY_ORDER.map(q => <option key={`q3-${q}`} value={q}>{prettyQuality(q)}</option>)}
              </select>
            </div>
          </section>

          {/* API key (use the override) */}
          <section className="settings-group">
            <h4>YouTube API Key (optional)</h4>
            <div className="row">
              <div className="label">API key</div>
              <input
                className="field"
                placeholder="Paste your YouTube Data API v3 key"
                value={ytApiKeyOverride}
                onChange={(e) => setYtApiKeyOverride(e.target.value)}
              />
            </div>
            <p className="muted">Used to fetch live viewers/likes. Leave blank to disable metrics or rely on title-only fetch.</p>
          </section>

          {/* Keyboard Shortcuts (two bindings) */}
          <section className="settings-group">
            <h4>Keyboard Shortcuts</h4>
            <p className="muted">Click a field and press a key. Use “+” to add a second key. Duplicates highlight in red.</p>
            <div className="key-grid-2">
              {[
                ['layout1', 'Layout 1'], ['layout2', 'Layout 2'], ['layout3', 'Layout 3'],
                ['layout4', 'Layout 4'], ['layout5', 'Layout 5'], ['layout6', 'Layout 6'],
                ['layout7', 'Layout 7'], ['layout8', 'Layout 8'], ['layout9', 'Layout 9'],
                ['swap', 'Swap Streams'], ['toggleShortcuts', 'Toggle Shortcuts'], ['openSettings', 'Open Settings'],
                ['focusAudio', 'Focus Audio (cycle)'], ['muteAll', 'Mute All'], ['unmuteAll', 'Unmute All'],
                ['nudgeBack', 'Seek −10s'], ['nudgeForward', 'Seek +10s'],
                ['toggleChat', 'Toggle Chat (L3)/Tab'],
                ['toggleInfo', 'Toggle Titles + Metrics'],
                ['chatWidthDec', 'L2 Chat width −'], ['chatWidthInc', 'L2 Chat width +'],
                ['s2HeightDec', 'L3 S2 height −'], ['s2HeightInc', 'L3 S2 height +'],
                ['l3RightDec', 'L3 Right width −'], ['l3RightInc', 'L3 Right width +'],
                ['borderDec', 'Border −'], ['borderInc', 'Border +'],
                ['setMarkS1', 'Set S1 Mark (9)'], ['setMarkS2', 'Set S2 Mark (0)'],
                ['syncS2ToS1', 'S2 → S1 mark (Shift+9)'], ['syncS1ToS2', 'S1 → S2 mark (Shift+0)'],
                ['setSyncFromCurrent', 'Set Sync target (`)'],
                ['syncNow', 'Sync Now (G)'],
              ].map(([id, label]) => {
                const vals = Array.isArray(keymap[id]) ? keymap[id] : [];
                const [k1, k2] = [vals[0] || '', vals[1] || ''];
                const dup1 = k1 && (keyCount.get(k1.toLowerCase()) > 1);
                const dup2 = k2 && (keyCount.get(k2.toLowerCase()) > 1);
                return (
                  <div className="key-row-2" key={id}>
                    <label>{label}</label>
                    <div className="key-inputs">
                      <input
                        className={`key-input ${dup1 ? 'dup' : ''}`}
                        value={k1}
                        onKeyDown={(e) => { e.preventDefault(); setKeyAt(id, 0, e.key.length === 1 ? e.key : e.code); }}
                        onChange={() => { }}
                        placeholder="Press a key"
                      />
                      {vals.length > 1 ? (
                        <>
                          <input
                            className={`key-input ${dup2 ? 'dup' : ''}`}
                            value={k2}
                            onKeyDown={(e) => { e.preventDefault(); setKeyAt(id, 1, e.key.length === 1 ? e.key : e.code); }}
                            onChange={() => { }}
                            placeholder="2nd key"
                          />
                          <button className="btn sm" onClick={() => removeKeyAt(id, 1)}>×</button>
                        </>
                      ) : (
                        <button className="btn sm" onClick={() => addSecondKey(id)}>+</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="row gap">
              <button className="btn" onClick={resetKeybinds}>Reset to Defaults</button>
              <span className="muted">Duplicate keys in use: {Array.from(keyCount.values()).filter(n => n > 1).length}</span>
            </div>
          </section>

          <div className="settings-actions">
            <button className="cta" onClick={close}>Close</button>
          </div>

          <div className="made-by-foot">Made by <b>Vat5aL</b></div>
        </div>
      </div>
    </div>
  );
}
