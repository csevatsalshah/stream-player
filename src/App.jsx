import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import './App.css';
import { getYouTubeId, lsGet, lsSet, clamp } from './utils';

/* -------------------- Tunables -------------------- */
const DEFAULT_PIP = { x: 24, y: 24, width: 480, height: 270 };
const DEFAULT_L2_CHAT = 360;   // Layout 2 chat width (px)
const DEFAULT_L3_S2H  = 240;   // Layout 3 Stream 2 height (px)
const DEFAULT_L3_RIGHT_W = 360; // Layout 3 right column width (px)
const METRICS_MS = 30000;      // 30s
const CUSTOM_START_NUM = 7;

// Default API key (optional) — can be overridden by user in Settings
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
const YT_STATE = { UNSTARTED:-1, ENDED:0, PLAYING:1, PAUSED:2, BUFFERING:3, CUED:5 };

/* Force quality with a few retries (YouTube sometimes overrides once playback starts) */
function applyQualityForce(player, q) {
  if (!player || !q) return;
  const trySet = () => { try { player.setPlaybackQuality(q); } catch {} };
  trySet();
  setTimeout(trySet, 400);
  setTimeout(trySet, 1200);
}

/* -------- YouTube info (metrics + title) ---------- */
function useYouTubeInfo(videoId, { metricsEnabled, titleEnabled, apiKey }) {
  const [data, setData] = useState({ viewers: null, likes: null, title: '' });

  useEffect(() => {
    if (!videoId || (!metricsEnabled && !titleEnabled) || !apiKey) return;
    let timer;

    async function fetchOnce() {
      try {
        const parts = [];
        if (metricsEnabled) parts.push('liveStreamingDetails', 'statistics');
        if (titleEnabled)   parts.push('snippet');
        const part = Array.from(new Set(parts)).join(',');
        const url = `https://www.googleapis.com/youtube/v3/videos?part=${part}&id=${videoId}&key=${apiKey}`;
        const res = await fetch(url);
        const j = await res.json();
        const it = j?.items?.[0];

        setData({
          viewers: metricsEnabled && it?.liveStreamingDetails?.concurrentViewers
            ? Number(it.liveStreamingDetails.concurrentViewers) : null,
          likes:   metricsEnabled && it?.statistics?.likeCount
            ? Number(it.statistics.likeCount) : null,
          title:   titleEnabled ? (it?.snippet?.title || '') : ''
        });
      } catch { /* ignore */ }
    }

    fetchOnce();
    if (metricsEnabled) timer = setInterval(fetchOnce, METRICS_MS);
    return () => { if (timer) clearInterval(timer); };
  }, [videoId, metricsEnabled, titleEnabled, apiKey]);

  return data;
}

/* ------------------- Keymap ------------------------ */
const DEFAULT_KEYMAP = {
  layout1:'1', layout2:'2', layout3:'3', layout4:'4', layout5:'5', layout6:'6',
  swap:'q',
  toggleShortcuts:'s',
  openSettings:'o',
  focusAudio:'a',            // cycles S1 -> Both -> S2
  muteAll:'m',
  unmuteAll:'u',
  nudgeBack:'[',
  nudgeForward:']',
  toggleChat:'c',            // Layout 3 chat tab toggle
  toggleInfo:'i',
  // Layout 2 chat width
  chatWidthDec:',',
  chatWidthInc:'.',
  // Layout 3 sizes
  s2HeightDec:'ArrowDown',
  s2HeightInc:'ArrowUp',
  l3RightDec:'-',
  l3RightInc:'=',
  // Frame border
  borderDec:'ArrowLeft',
  borderInc:'ArrowRight',
};
const norm = (k) => (k || '').toLowerCase();

/* Quality helpers */
const QUALITY_LABELS = {
  default: 'Use default',
  small: '144p',
  medium: '240p',
  large: '480p',
  hd720: '720p',
  hd1080: '1080p',
  hd1440: '1440p',
  hd2160: '2160p (4K)',
  highres: 'Highest'
};
const QUALITY_ORDER = ['default','small','medium','large','hd720','hd1080','hd1440','hd2160','highres'];
const PREFERRED_DEFAULT_QUALITY = 'hd1080';
const prettyQuality = (q) => QUALITY_LABELS[q] || q || 'Auto';

/* Cursor helper for PIP */
const cursorForDir = (dir) => ({
  top: 'n-resize', bottom:'s-resize', left:'w-resize', right:'e-resize',
  topRight:'ne-resize', topLeft:'nw-resize', bottomRight:'se-resize', bottomLeft:'sw-resize',
  n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize'
}[dir] || 'default');

/* ======= Helpers: landing history (24h TTL) ======= */
const HISTORY_KEY = 'ms_history';
function readHistory() {
  const now = Date.now();
  const day = 24*60*60*1000;
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch {}
  const filtered = arr.filter(it => now - (it.ts||0) < day);
  if (filtered.length !== arr.length) localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  return filtered;
}
function pushHistory(value) {
  if (!value) return;
  const now = Date.now();
  const list = readHistory();
  const dedup = list.filter(it => it.val !== value);
  dedup.unshift({ val:value, ts: now });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(dedup.slice(0,14)));
}

/* ================================================== */
export default function App() {
  /* Streams */
  const [s1Input, setS1Input] = useState(() => lsGet('ms_stream1',''));
  const [s2Input, setS2Input] = useState(() => lsGet('ms_stream2',''));
  const [s1, setS1] = useState(() => getYouTubeId(lsGet('ms_stream1','')));
  const [s2, setS2] = useState(() => getYouTubeId(lsGet('ms_stream2','')));

  /* Stream enabled flags (OFF destroys the player so it won’t run in bg) */
  const [s1Enabled, setS1Enabled] = useState(() => lsGet('ms_s1_enabled', true));
  const [s2Enabled, setS2Enabled] = useState(() => lsGet('ms_s2_enabled', true));

  /* Chat tab (only affects layout 3) */
  const [chatTab, setChatTab] = useState(() => lsGet('ms_chatTab', 1)); // 1 | 2

  /* Layout/UI */
  const [layout, setLayout] = useState(() => lsGet('ms_layout',1));
  const [swap, setSwap] = useState(() => lsGet('ms_swap',false));
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => lsGet('ms_shortcuts_enabled',true));
  const [menuVisible, setMenuVisible] = useState(true);                 // auto‑hide bars
  const [controlsEnabled, setControlsEnabled] = useState(() => lsGet('ms_controls_enabled', true)); // bottom controls toggle

  /* Sizes */
  const [l2ChatWidth, setL2ChatWidth] = useState(() => lsGet('ms_l2_chat', DEFAULT_L2_CHAT));
  const [l3S2Height, setL3S2Height] = useState(() => lsGet('ms_l3_s2h', DEFAULT_L3_S2H));
  const [l3RightWidth, setL3RightWidth] = useState(() => lsGet('ms_l3_right_w', DEFAULT_L3_RIGHT_W));

  /* PIP */
  const [pip, setPip] = useState(() => lsGet('ms_pip', DEFAULT_PIP));
  const [pipMoving, setPipMoving] = useState(false);
  const [pipLockAR, setPipLockAR] = useState(false);
  const [shield, setShield] = useState({ active:false, cursor:'default' });

  /* Theme / Appearance */
  const [bgUrl, setBgUrl] = useState(() => lsGet('ms_bg', ''));
  const [frameW, setFrameW] = useState(() => lsGet('ms_frame_w', 0));
  const [frameColor, setFrameColor] = useState(() => lsGet('ms_frame_c', '#ffffff'));
  const [themes, setThemes] = useState(() => lsGet('ms_theme_presets', []));

  /* Overlays */
  const [showMetrics, setShowMetrics] = useState(() => lsGet('ms_show_metrics', true));
  const [showTitles, setShowTitles]   = useState(() => lsGet('ms_show_titles', false));

  /* Settings modal */
  const [showSettings, setShowSettings] = useState(false);

  /* API key override (per‑user) */
  const [ytApiKeyOverride, setYtApiKeyOverride] = useState(() => lsGet('ms_yt_api_key', ''));
  const ytApiKey = ytApiKeyOverride || YT_API_KEY_DEFAULT;

  /* Custom Layouts */
  const [customLayouts, setCustomLayouts] = useState(() => lsGet('ms_custom_layouts', []));
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingCustomIndex, setEditingCustomIndex] = useState(null);

  /* Landing history */
  const [history, setHistory] = useState(() => readHistory());

  /* Geometry */
  const stageRef = useRef(null);
  const slotS1 = useRef(null);
  const slotS2 = useRef(null);
  // default chat slot (layouts 2 & 3)
  const chatSlot = useRef(null);
  // custom chat slots (custom layouts)
  const chat1Slot = useRef(null);
  const chat2Slot = useRef(null);

  const [rectS1, setRectS1] = useState(null);
  const [rectS2, setRectS2] = useState(null);
  const [rectChat, setRectChat] = useState(null);     // default one
  const [rectChat1, setRectChat1] = useState(null);   // custom chat1
  const [rectChat2, setRectChat2] = useState(null);   // custom chat2

  const lastS1 = useRef(null);
  const lastS2 = useRef(null);
  const lastChat = useRef(null);
  const lastChat1 = useRef(null);
  const lastChat2 = useRef(null);

  /* Player API */
  const origin = useMemo(() => window.location.origin, []);
  const domain = useMemo(() => window.location.hostname, []);
  const p1Ref = useRef(null);
  const p2Ref = useRef(null);
  const yt1 = useRef(null);
  const yt2 = useRef(null);
  const [ytReady, setYtReady] = useState(false);

  /* Keymap */
  const [keymap, setKeymap] = useState(() => ({ ...DEFAULT_KEYMAP, ...lsGet('ms_keymap', {}) }));

  /* Audio */
  const [focus, setFocus] = useState('both'); // 's1' | 'both' | 's2'
  const [vol1, setVol1] = useState(() => lsGet('ms_vol1', 100));
  const [vol2, setVol2] = useState(() => lsGet('ms_vol2', 100));
  const [muted1, setMuted1] = useState(() => lsGet('ms_muted1', false));
  const [muted2, setMuted2] = useState(() => lsGet('ms_muted2', false));

  /* Playback quality */
  const [defaultQuality, setDefaultQuality] = useState(() => lsGet('ms_default_quality', PREFERRED_DEFAULT_QUALITY));
  const [q1, setQ1] = useState(() => lsGet('ms_q1', 'default'));
  const [q2, setQ2] = useState(() => lsGet('ms_q2', 'default'));
  const effectiveQ1 = (q1 === 'default' ? defaultQuality : q1);
  const effectiveQ2 = (q2 === 'default' ? defaultQuality : q2);

  /* Info (metrics + title) */
  const info1 = useYouTubeInfo(s1, { metricsEnabled: showMetrics, titleEnabled: showTitles, apiKey: ytApiKey });
  const info2 = useYouTubeInfo(s2, { metricsEnabled: showMetrics, titleEnabled: showTitles, apiKey: ytApiKey });

  /* ---- Boot: IFrame API ---- */
  useEffect(() => { let off=false; loadYouTubeAPI().then(()=>!off&&setYtReady(true)); return ()=>{off=true}; }, []);

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
              applyQualityForce(e.target, effectiveQ1);
              e.target.setVolume(vol1);
              e.target.playVideo();
            } catch {}
          },
          onStateChange: (e) => {
            if (e.data === YT_STATE.PLAYING || e.data === YT_STATE.BUFFERING) {
              applyQualityForce(e.target, effectiveQ1);
            }
          }
        }
      });
    }
    if (!s1Enabled && yt1.current) {
      try { yt1.current.destroy(); } catch {}
      yt1.current = null;
    }

    // Stream 2
    if (s2Enabled && p2Ref.current && s2 && !yt2.current) {
      yt2.current = new window.YT.Player(p2Ref.current, {
        events: { 
          onReady: (e) => {
            try {
              e.target.mute();
              applyQualityForce(e.target, effectiveQ2);
              e.target.setVolume(vol2);
              e.target.playVideo();
            } catch {}
          },
          onStateChange: (e) => {
            if (e.data === YT_STATE.PLAYING || e.data === YT_STATE.BUFFERING) {
              applyQualityForce(e.target, effectiveQ2);
            }
          }
        }
      });
    }
    if (!s2Enabled && yt2.current) {
      try { yt2.current.destroy(); } catch {}
      yt2.current = null;
    }
  }, [ytReady, s1Enabled, s2Enabled, s1, s2, vol1, vol2, effectiveQ1, effectiveQ2]);

  /* ---- Force play / quality when IDs or prefs change ---- */
  useEffect(() => {
    if (yt1.current && s1Enabled && s1) { try {
      yt1.current.loadVideoById(s1);
      applyQualityForce(yt1.current, effectiveQ1);
      yt1.current.setVolume(vol1);
      yt1.current.playVideo();
    } catch {} }
  }, [s1, s1Enabled, vol1, effectiveQ1]);
  useEffect(() => {
    if (yt2.current && s2Enabled && s2) { try {
      yt2.current.loadVideoById(s2);
      applyQualityForce(yt2.current, effectiveQ2);
      yt2.current.setVolume(vol2);
      yt2.current.playVideo();
    } catch {} }
  }, [s2, s2Enabled, vol2, effectiveQ2]);

  /* ---- Persist ---- */
  useEffect(()=>lsSet('ms_stream1', s1Input),[s1Input]);
  useEffect(()=>lsSet('ms_stream2', s2Input),[s2Input]);
  useEffect(()=>lsSet('ms_layout', layout),[layout]);
  useEffect(()=>lsSet('ms_controls_enabled', controlsEnabled),[controlsEnabled]);
  useEffect(()=>lsSet('ms_swap', swap),[swap]);
  useEffect(()=>lsSet('ms_shortcuts_enabled', shortcutsEnabled),[shortcutsEnabled]);
  useEffect(()=>lsSet('ms_l2_chat', l2ChatWidth),[l2ChatWidth]);
  useEffect(()=>lsSet('ms_l3_s2h', l3S2Height),[l3S2Height]);
  useEffect(()=>lsSet('ms_l3_right_w', l3RightWidth),[l3RightWidth]);
  useEffect(()=>lsSet('ms_pip', pip),[pip]);
  useEffect(()=>lsSet('ms_bg', bgUrl),[bgUrl]);
  useEffect(()=>lsSet('ms_theme_presets', themes),[themes]);
  useEffect(()=>lsSet('ms_keymap', keymap),[keymap]);
  useEffect(()=>lsSet('ms_frame_w', frameW),[frameW]);
  useEffect(()=>lsSet('ms_frame_c', frameColor),[frameColor]);
  useEffect(()=>lsSet('ms_show_metrics', showMetrics),[showMetrics]);
  useEffect(()=>lsSet('ms_show_titles', showTitles),[showTitles]);
  useEffect(()=>lsSet('ms_s1_enabled', s1Enabled),[s1Enabled]);
  useEffect(()=>lsSet('ms_s2_enabled', s2Enabled),[s2Enabled]);
  useEffect(()=>lsSet('ms_vol1', vol1),[vol1]);
  useEffect(()=>lsSet('ms_vol2', vol2),[vol2]);
  useEffect(()=>lsSet('ms_muted1', muted1),[muted1]);
  useEffect(()=>lsSet('ms_muted2', muted2),[muted2]);
  useEffect(()=>lsSet('ms_default_quality', defaultQuality),[defaultQuality]);
  useEffect(()=>lsSet('ms_q1', q1),[q1]);
  useEffect(()=>lsSet('ms_q2', q2),[q2]);
  useEffect(()=>lsSet('ms_yt_api_key', ytApiKeyOverride),[ytApiKeyOverride]);
  useEffect(()=>lsSet('ms_chatTab', chatTab),[chatTab]);
  useEffect(()=>lsSet('ms_custom_layouts', customLayouts),[customLayouts]);

  /* ---- Auto-hide top/bottom controls ---- */
  useEffect(() => {
    const a = stageRef.current || document.body; let t;
    const onMove = () => { setMenuVisible(true); clearTimeout(t); t = setTimeout(()=>setMenuVisible(false), 1800); };
    a.addEventListener('mousemove', onMove);
    return () => { a.removeEventListener('mousemove', onMove); clearTimeout(t); };
  }, []);

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
    let rc = null, rc1 = null, rc2 = null;

    if (layout === 2 || layout === 3) {
      rc = toLocal(chatSlot.current);
    } else if (layout >= CUSTOM_START_NUM) {
      rc1 = toLocal(chat1Slot.current);
      rc2 = toLocal(chat2Slot.current);
    }

    setRectS1(r1); if (r1) lastS1.current = r1;
    setRectS2(r2); if (r2) lastS2.current = r2;
    setRectChat(rc); if (rc) lastChat.current = rc;
    setRectChat1(rc1); if (rc1) lastChat1.current = rc1;
    setRectChat2(rc2); if (rc2) lastChat2.current = rc2;
  }, [layout]);

  const settleTick = useRef(0);
  useLayoutEffect(() => {
    measureAll();
    settleTick.current++;
    const my = settleTick.current;
    let frames = 0;
    function raf() {
      if (my !== settleTick.current) return;
      measureAll();
      if (++frames < 8) requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }, [layout, l2ChatWidth, l3S2Height, l3RightWidth, measureAll, customLayouts]);

  useEffect(() => {
    const ro = new ResizeObserver(() => requestAnimationFrame(measureAll));
    if (slotS1.current) ro.observe(slotS1.current);
    if (slotS2.current) ro.observe(slotS2.current);
    if (chatSlot.current) ro.observe(chatSlot.current);
    if (chat1Slot.current) ro.observe(chat1Slot.current);
    if (chat2Slot.current) ro.observe(chat2Slot.current);
    return () => ro.disconnect();
  }, [layout, measureAll]);

  /* ---- URL presets (streams only) ---- */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s1q = getYouTubeId(p.get('s1'));
    const s2q = getYouTubeId(p.get('s2'));
    if (s1q) { setS1(s1q); setS1Input(s1q); }
    if (s2q) { setS2(s2q); setS2Input(s2q); }
  }, []);
  useEffect(() => {
    const q = new URLSearchParams();
    if (s1) q.set('s1', s1);
    if (s2) q.set('s2', s2);
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = q.toString() ? `${base}?${q}` : base;
    window.history.replaceState(null, '', url);
  }, [s1, s2]);

  /* ---- Player & chat sources ---- */
  const baseParams = `autoplay=1&playsinline=1&mute=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
  const s1Src = (s1 && s1Enabled) ? `https://www.youtube.com/embed/${s1}?${baseParams}` : null;
  const s2Src = (s2 && s2Enabled) ? `https://www.youtube.com/embed/${s2}?${baseParams}` : null;

  const chat1Src = s1 ? `https://www.youtube.com/live_chat?v=${s1}&embed_domain=${domain}` : null;
  const chat2Src = s2 ? `https://www.youtube.com/live_chat?v=${s2}&embed_domain=${domain}` : null;

  /* ---- Unified audio apply (hotkeys + UI in sync) ---- */
  const applyAudioStates = useCallback(() => {
    const effMute1 = muted1 || focus === 's2';
    const effMute2 = muted2 || focus === 's1';
    try {
      if (yt1.current) {
        if (effMute1) yt1.current.mute();
        else { yt1.current.unMute(); yt1.current.setVolume(vol1); }
      }
    } catch {}
    try {
      if (yt2.current) {
        if (effMute2) yt2.current.mute();
        else { yt2.current.unMute(); yt2.current.setVolume(vol2); }
      }
    } catch {}
  }, [muted1, muted2, focus, vol1, vol2]);
  useEffect(() => { applyAudioStates(); }, [applyAudioStates]);

  const muteAll = useCallback(() => { setMuted1(true); setMuted2(true); }, []);
  const unmuteAll = useCallback(() => { setFocus('both'); setMuted1(false); setMuted2(false); }, []);

  const nudge = useCallback((delta) => {
    const list = focus === 's1' ? [yt1.current] : focus === 's2' ? [yt2.current] : [yt1.current, yt2.current];
    list.forEach((p) => {
      if (!p?.getCurrentTime || !p?.seekTo) return;
      const t = Number(p.getCurrentTime() || 0);
      p.seekTo(Math.max(0, t + delta), true);
    });
  }, [focus]);
  const nudgeS1 = (delta) => {
    try { if (yt1.current) { const t = Number(yt1.current.getCurrentTime()||0); yt1.current.seekTo(Math.max(0,t+delta), true); } } catch {}
  };
  const nudgeS2 = (delta) => {
    try { if (yt2.current) { const t = Number(yt2.current.getCurrentTime()||0); yt2.current.seekTo(Math.max(0,t+delta), true); } } catch {}
  };
  const getTimes = () => {
    const t1 = yt1.current?.getCurrentTime ? Number(yt1.current.getCurrentTime()) : null;
    const t2 = yt2.current?.getCurrentTime ? Number(yt2.current.getCurrentTime()) : null;
    return { t1: isNaN(t1) ? null : t1, t2: isNaN(t2) ? null : t2 };
  };

  /* ---- Key handling ---- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const type = (e.target?.type || '').toLowerCase();
      const isKeybindField = e.target?.classList?.contains('key-input');
      const isTypingContext =
        tag === 'textarea' ||
        (tag === 'input' && !['range','checkbox','color','button','submit','number'].includes(type)) ||
        isKeybindField;
      if (isTypingContext) return;

      const k = e.key;

      // Always allow toggling shortcuts
      if (norm(k) === norm(keymap.toggleShortcuts)) { e.preventDefault(); setShortcutsEnabled(v=>!v); return; }
      if (!shortcutsEnabled) return;

      const stop = () => { e.preventDefault(); e.stopPropagation(); };

      if (norm(k) === norm(keymap.openSettings)) { stop(); setShowSettings(true); }
      else if (norm(k) === norm(keymap.swap)) { stop(); setSwap(v=>!v); }
      else if (norm(k) === norm(keymap.focusAudio)) { stop(); setFocus(f => (f==='s1' ? 'both' : f==='both' ? 's2' : 's1')); }
      else if (norm(k) === norm(keymap.muteAll)) { stop(); muteAll(); }
      else if (norm(k) === norm(keymap.unmuteAll)) { stop(); unmuteAll(); }
      else if (norm(k) === norm(keymap.nudgeBack)) { stop(); nudge(-10); }
      else if (norm(k) === norm(keymap.nudgeForward)) { stop(); nudge(10); }
      else if (norm(k) === norm(keymap.toggleChat) && layout === 3) { stop(); setChatTab(t => (t === 1 ? 2 : 1)); }
      else if (norm(k) === norm(keymap.toggleInfo)) {
        stop(); const anyOn = showMetrics || showTitles; setShowMetrics(!anyOn); setShowTitles(!anyOn);
      }
      // Layout 2 chat width +/- (min 260, max 720)
      else if (norm(k) === norm(keymap.chatWidthDec)) { stop(); setL2ChatWidth(v=>clamp(v-12,260,720)); requestAnimationFrame(measureAll); }
      else if (norm(k) === norm(keymap.chatWidthInc)) { stop(); setL2ChatWidth(v=>clamp(v+12,260,720)); requestAnimationFrame(measureAll); }
      // Layout 3 adjustments
      else if (k === keymap.s2HeightDec) { stop(); setL3S2Height(v=>clamp(v-12,120,800)); requestAnimationFrame(measureAll); }
      else if (k === keymap.s2HeightInc) { stop(); setL3S2Height(v=>clamp(v+12,120,800)); requestAnimationFrame(measureAll); }
      else if (norm(k) === norm(keymap.l3RightDec)) { stop(); if (layout===3) { setL3RightWidth(v=>clamp(v-12,260,720)); requestAnimationFrame(measureAll); } }
      else if (norm(k) === norm(keymap.l3RightInc)) { stop(); if (layout===3) { setL3RightWidth(v=>clamp(v+12,260,720)); requestAnimationFrame(measureAll); } }
      // Frame border
      else if (k === keymap.borderDec) { stop(); setFrameW(v=>clamp(v-1,0,12)); }
      else if (k === keymap.borderInc) { stop(); setFrameW(v=>clamp(v+1,0,12)); }
      // Layouts
      else if (norm(k) === norm(keymap.layout1)) setLayout(1);
      else if (norm(k) === norm(keymap.layout2)) setLayout(2);
      else if (norm(k) === norm(keymap.layout3)) setLayout(3);
      else if (norm(k) === norm(keymap.layout4)) setLayout(4);
      else if (norm(k) === norm(keymap.layout5)) setLayout(5);
      else if (norm(k) === norm(keymap.layout6)) setLayout(6);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keymap, shortcutsEnabled, muteAll, unmuteAll, nudge, layout, showMetrics, showTitles, measureAll]);

  /* ---- Clickability ---- */
  const playerPointer = shortcutsEnabled ? 'none' : 'auto';

  /* ---- Pick targets & visibility flags ---- */
  const rectPip = { left: pip.x, top: pip.y, width: pip.width, height: pip.height };
  let tgt1 = null, tgt2 = null;
  let vis1 = false, vis2 = false;
  let pipIsP1 = false, pipIsP2 = false;

  switch (layout) {
    case 1: tgt1 = rectS1 || lastS1.current;  vis1 = true;  tgt2 = null;           vis2 = false; break;
    case 2: tgt1 = rectS1 || lastS1.current;  vis1 = true;  tgt2 = null;           vis2 = false; break;
    case 3: tgt1 = rectS1 || lastS1.current;  vis1 = true;  tgt2 = rectS2 || lastS2.current; vis2 = !!tgt2; break;
    case 4:
      if (!swap) { tgt1 = rectS1 || lastS1.current; vis1 = true; tgt2 = rectPip; vis2 = true; pipIsP2 = true; }
      else       { tgt1 = rectPip; vis1 = true; pipIsP1 = true; tgt2 = rectS1 || lastS1.current; vis2 = true; }
      break;
    case 5: tgt1 = rectS1 || lastS1.current;  vis1 = true;  tgt2 = rectS2 || lastS2.current; vis2 = !!tgt2; break;
    case 6: tgt1 = null;                      vis1 = false; tgt2 = rectS2 || lastS2.current; vis2 = !!tgt2; break;
    default:
      if (layout >= CUSTOM_START_NUM) {
        tgt1 = rectS1 || lastS1.current;  vis1 = !!tgt1;
        tgt2 = rectS2 || lastS2.current;  vis2 = !!tgt2;
      }
      break;
  }
  if (layout !== 4 && (layout === 3 || layout === 5) && swap) [tgt1, tgt2, vis1, vis2] = [tgt2, tgt1, vis2, vis1];

  const styleFromRect = (rect, keepRef, allowFallback) => {
    let rr = rect;
    if (!rr && allowFallback) rr = keepRef?.current;
    if (rr) {
      if (rect && keepRef) keepRef.current = rect;
      return { left: rr.left, top: rr.top, width: rr.width, height: rr.height, visibility:'visible', transform:'translateZ(0)' };
    }
    return { visibility:'hidden', left:-9999, top:-9999, width:1, height:1 };
  };

  const s1Style = styleFromRect(tgt1, lastS1, vis1);
  const s2Style = styleFromRect(tgt2, lastS2, vis2);

  /* ---- Actions ---- */
  const play = () => {
    const id1 = getYouTubeId(s1Input);
    if (!id1) { alert('Enter a valid YouTube link/ID for the primary stream.'); return; }
    setS1(id1); setS2(getYouTubeId(s2Input)); setS1Enabled(true);
    pushHistory(id1); if (getYouTubeId(s2Input)) pushHistory(getYouTubeId(s2Input));
    setHistory(readHistory());
  };
  const addStream2 = () => {
    const v = prompt('Enter Stream 2 URL or ID:'); if (!v) return;
    const id = getYouTubeId(v); if (id) { setS2(id); setS2Input(id); setS2Enabled(true); pushHistory(id); setHistory(readHistory()); } else alert('Invalid link or ID.');
  };
  const changeStream2 = () => addStream2();
  const removeStream2 = () => { setS2(null); setS2Input(''); setS2Enabled(false); };

  const [toastMsg, setToastMsg] = useState('');
  function toast(t){ setToastMsg(t); setTimeout(()=>setToastMsg(''),1800); }
  const copyShare = async () => {
    try {
      const q = new URLSearchParams(); if (s1) q.set('s1', s1); if (s2) q.set('s2', s2);
      const url = `${window.location.origin}${window.location.pathname}${q.toString() ? `?${q}`:''}`;
      await navigator.clipboard.writeText(url); toast('Share URL copied!');
    } catch { toast('Copy failed — copy from address bar.'); }
  };
  const clearToLanding = () => {
    setS1(null); setS2(null); setS1Input(''); setS2Input('');
    localStorage.removeItem('ms_stream1'); localStorage.removeItem('ms_stream2');
    window.history.replaceState(null, '', window.location.pathname);
    setShowSettings(false);
  };
  const resetLayout = () => {
    setL2ChatWidth(DEFAULT_L2_CHAT);
    setL3S2Height(DEFAULT_L3_S2H);
    setL3RightWidth(DEFAULT_L3_RIGHT_W);
    setPip(DEFAULT_PIP);
    setSwap(false);
    setFocus('both');
    requestAnimationFrame(measureAll);
    toast('Layout reset');
  };
  const resetKeymap = () => { setKeymap({ ...DEFAULT_KEYMAP }); toast('Keybinds reset'); };

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
    setBgUrl(t.bgUrl || ''); setFrameW(t.frameW ?? 0); setFrameColor(t.frameColor || '#ffffff');
    toast(`Theme “${name}” applied`);
  };
  const deleteThemePreset = (name) => { setThemes(themes.filter(t => t.name !== name)); };

  /* ---- Custom layout helpers ---- */
  const openBuilderNew = () => { setEditingCustomIndex(null); setShowBuilder(true); };
  const openBuilderEdit = (index) => { setEditingCustomIndex(index); setShowBuilder(true); };
  const upsertCustomLayout = (payload, index=null) => {
    const next = [...customLayouts];
    if (index === null || index === undefined) next.push(payload);
    else next[index] = payload;
    setCustomLayouts(next);
    // select it
    const idx = (index === null || index === undefined) ? next.length - 1 : index;
    setLayout(CUSTOM_START_NUM + idx);
  };
  const deleteCustom = (index) => {
    const next = customLayouts.slice();
    next.splice(index,1);
    setCustomLayouts(next);
    if (layout >= CUSTOM_START_NUM) setLayout(1);
  };
  const renameCustom = (index) => {
    const name = prompt('Layout name:', customLayouts[index]?.name || `Custom ${index+1}`); if (!name) return;
    const next = customLayouts.slice(); next[index] = { ...next[index], name }; setCustomLayouts(next);
  };

  /* ---- Render ---- */
  const numbersDefault = [1,2,3,4,5,6];
  const numbersCustom = Array.from({length: customLayouts.length}, (_,i)=>CUSTOM_START_NUM+i);

  const renderCustomView = () => {
    const idx = layout - CUSTOM_START_NUM;
    const cl = customLayouts[idx];
    if (!cl) return (<div className="layout layout-1"><div className="slot slot-s1" ref={slotS1} /></div>);
    return (
      <div className="layout layout-custom">
        <div className="custom-grid" style={{
          gridTemplateColumns: `repeat(${cl.grid.cols}, 1fr)`,
          gridTemplateRows:   `repeat(${cl.grid.rows}, minmax(0,1fr))`,
          gap: `${cl.grid.gap}px`
        }}>
          {cl.items.map(it => (
            <div key={it.id} className={`cg-item kind-${it.kind}`} style={{
              gridColumn: `${it.x} / span ${it.w}`,
              gridRow: `${it.y} / span ${it.h}`
            }}>
              <div className="ratio-wrap">
                <div className="ratio-inner">
                  {it.kind === 's1' && <div className="slot" ref={slotS1} />}
                  {it.kind === 's2' && <div className="slot" ref={slotS2} />}
                  {it.kind === 'chat1' && <div className="slot chat-slot" ref={chat1Slot} />}
                  {it.kind === 'chat2' && <div className="slot chat-slot" ref={chat2Slot} />}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="App">
      {!s1 && (
        <div className="landing">
          <div className="landing-card">
            <h1 className="headline">Multi‑Stream Player <span className="headline-accent">Pro</span></h1>
            <p className="sub">Seamless layouts, accurate sizing, smooth PIP, hotkeys & controls.</p>

            <div className="form">
              <label htmlFor="s1">Primary Stream (required)</label>
              <input id="s1" className="field primary" placeholder="YouTube link or video ID"
                     value={s1Input} onChange={(e)=>setS1Input(e.target.value)}
                     onPaste={(e)=>{e.preventDefault(); setS1Input((e.clipboardData||window.clipboardData).getData('text'));}}/>
              <label htmlFor="s2">Secondary Stream (optional)</label>
              <input id="s2" className="field" placeholder="YouTube link or video ID"
                     value={s2Input} onChange={(e)=>setS2Input(e.target.value)} />
              <div className="history">
                <div className="hist-label">Recent (24h):</div>
                <div className="hist-list">
                  {history.length === 0 && <span className="muted">No recent items yet</span>}
                  {history.map((h,i)=>(
                    <div key={h.val+i} className="hist-chip">
                      <span className="id">{h.val}</span>
                      <button className="chip-btn" onClick={()=>setS1Input(h.val)}>S1</button>
                      <button className="chip-btn" onClick={()=>setS2Input(h.val)}>S2</button>
                    </div>
                  ))}
                  {history.length>0 && (
                    <button className="btn tiny" onClick={()=>{ localStorage.removeItem(HISTORY_KEY); setHistory([]); }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <button className="cta" onClick={play}>Play</button>
              <div className="madeby">Made by <strong>Vat5aL</strong></div>
            </div>
          </div>
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
                  ...s1Style,
                  pointerEvents: playerPointer,
                  ...(layout === 4 && pipIsP1 ? { border: '1px solid rgba(255,255,255,0.85)' } : null)
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
                  ...s2Style,
                  pointerEvents: playerPointer,
                  ...(layout === 4 && pipIsP2 ? { border: '1px solid rgba(255,255,255,0.85)' } : null)
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
                  top:true, right:true, bottom:true, left:true,
                  topRight:true, bottomRight:true, bottomLeft:true, topLeft:true
                }}
                resizeHandleComponent={{
                  top:<div className="pip-handle pip-h-n" />,
                  right:<div className="pip-handle pip-h-e" />,
                  bottom:<div className="pip-handle pip-h-s" />,
                  left:<div className="pip-handle pip-h-w" />,
                  topRight:<div className="pip-handle pip-h-ne" />,
                  bottomRight:<div className="pip-handle pip-h-se" />,
                  bottomLeft:<div className="pip-handle pip-h-sw" />,
                  topLeft:<div className="pip-handle pip-h-nw" />,
                }}
                lockAspectRatio={pipLockAR ? 16/9 : false}
                onDragStart={() => { setPipMoving(true); setShield({active:true, cursor:'grabbing'}); }}
                onResizeStart={(e, dir) => { setPipMoving(true); setPipLockAR(!!e?.shiftKey); setShield({active:true, cursor:cursorForDir(dir)}); }}
                onDrag={(e, d) => setPip(p=>({ ...p, x:d.x, y:d.y }))}
                onResize={(e, dir, ref, delta, pos) =>
                  setPip({ x:pos.x, y:pos.y, width:parseFloat(ref.style.width), height:parseFloat(ref.style.height) })
                }
                onDragStop={(e, d) => { setPip(p=>({ ...p, x:d.x, y:d.y })); setPipMoving(false); setShield({active:false, cursor:'default'}); }}
                onResizeStop={(e, dir, ref, delta, pos) =>
                  { setPip({ x:pos.x, y:pos.y, width:parseFloat(ref.style.width), height:parseFloat(ref.style.height) }); setPipMoving(false); setShield({active:false, cursor:'default'}); }
                }
              >
                <div className="pip-box">
                  <div className="pip-drag-handle" title="Drag PIP">⋮⋮ Drag</div>
                </div>
              </Rnd>
            )}
          </div>

          {/* Overlays */}
          <div className="metrics-layer">
            {s1Style.visibility==='visible' && showTitles && info1.title && (
              <div className="title-badge" style={{ left: s1Style.left + 10, top: s1Style.top + 10 }}>{info1.title}</div>
            )}
            {s1Style.visibility==='visible' && showMetrics && (info1.viewers !== null || info1.likes !== null) && (
              <div className="metric-badge" style={{ left: s1Style.left + 10, top: s1Style.top + (showTitles && info1.title ? 44 : 10) }}>
                {info1.viewers !== null && <span>👀 {info1.viewers.toLocaleString()}</span>}
                {info1.likes !== null && <span>👍 {info1.likes.toLocaleString()}</span>}
              </div>
            )}
            {s2Style.visibility==='visible' && showTitles && info2.title && (
              <div className="title-badge" style={{ left: s2Style.left + 10, top: s2Style.top + 10 }}>{info2.title}</div>
            )}
            {s2Style.visibility==='visible' && showMetrics && (info2.viewers !== null || info2.likes !== null) && (
              <div className="metric-badge" style={{ left: s2Style.left + 10, top: s2Style.top + (showTitles && info2.title ? 44 : 10) }}>
                {info2.viewers !== null && <span>👀 {info2.viewers.toLocaleString()}</span>}
                {info2.likes !== null && <span>👍 {info2.likes.toLocaleString()}</span>}
              </div>
            )}
          </div>

          {/* UI layer: slots, chat, controls */}
          <div className="ui-layer">
            <div className={`interaction-shield ${shield.active ? 'show' : ''}`} style={{ cursor: shield.cursor }} />

            {/* Layout content (slots & chat holders) */}
            {(() => {
              switch (layout) {
                case 1:
                  return (<div className="layout layout-1"><div className="slot slot-s1" ref={slotS1} /></div>);
                case 2:
                  return (
                    <div className="layout layout-2" style={{ gridTemplateColumns:`1fr 8px ${l2ChatWidth}px` }}>
                      <div className="slot slot-s1" ref={slotS1} />
                      <div /> {/* spacer */}
                      <div className="chat-panel"><div className="chat-slot" ref={chatSlot} /></div>
                    </div>
                  );
                case 3:
                  return (
                    <div className="layout layout-3" style={{ gridTemplateColumns: `1fr ${l3RightWidth}px` }}>
                      <div className="slot slot-s1" ref={slotS1} />
                      <div className="right-col" style={{ gridTemplateRows: `${l3S2Height}px 8px 1fr` }}>
                        <div className="slot-wrap">
                          <div className={`slot slot-s2 fill ${s2 ? 'transparent' : ''}`} ref={slotS2} />
                          {!s2 && <button className="add-stream-tile" onClick={addStream2}>+</button>}
                        </div>
                        <div />
                        <div className="chat-panel">
                          <div className="chat-toggle">
                            <button className={chatTab===1?'active':''} onClick={()=>setChatTab(1)}>Stream 1 Chat</button>
                            <button className={chatTab===2?'active':''} onClick={()=>setChatTab(2)} disabled={!s2}>Stream 2 Chat</button>
                          </div>
                          <div className="chat-slot" ref={chatSlot} />
                        </div>
                      </div>
                    </div>
                  );
                case 4:
                  return (
                    <div className="layout layout-4">
                      <div className="slot slot-s1" ref={slotS1} />
                    </div>
                  );
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
                default:
                  if (layout >= CUSTOM_START_NUM) return renderCustomView();
                  return null;
              }
            })()}

            {/* Chat (mounted once per chat, positioned over chat slots) */}
            <div className="chat-layer">
              {/* Chat 1 */}
              {chat1Src && (
                <iframe
                  className={`chat-frame-abs ${
                    (layout===2 && !!s1) || (layout===3 && chatTab===1) || (layout>=CUSTOM_START_NUM && !!(rectChat1 || lastChat1.current))
                      ? 'show' : 'hide'
                  }`}
                  title="Stream 1 Chat"
                  src={chat1Src}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="origin-when-cross-origin"
                  style={layout>=CUSTOM_START_NUM
                    ? styleFromRect(rectChat1, lastChat1, true)
                    : styleFromRect(rectChat, lastChat, true)}
                />
              )}
              {/* Chat 2 */}
              {chat2Src && (
                <iframe
                  className={`chat-frame-abs ${
                    (layout===3 && chatTab===2) || (layout>=CUSTOM_START_NUM && !!(rectChat2 || lastChat2.current))
                      ? 'show' : 'hide'
                  }`}
                  title="Stream 2 Chat"
                  src={chat2Src}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="origin-when-cross-origin"
                  style={styleFromRect(rectChat2, lastChat2, true)}
                />
              )}
            </div>

            {/* Top center: layout buttons */}
            <div className={`layout-menu ${menuVisible ? 'visible' : ''}`}>
              {numbersDefault.map(n=>(
                <button key={n} onClick={()=>setLayout(n)} className={layout===n?'active':''}>{n}</button>
              ))}
              {numbersCustom.map(n=>(
                <button key={n} onClick={()=>setLayout(n)} className={layout===n?'active':''}>{n}</button>
              ))}
              <button onClick={openBuilderNew} title="New custom layout">＋ New</button>
              <button onClick={()=>setSwap(v=>!v)} title="Swap streams">Swap</button>
              <button onClick={resetLayout} title="Reset splits & PIP">Reset</button>
              <button onClick={()=>setControlsEnabled(v=>!v)} className={controlsEnabled?'active':''} title="Toggle bottom controls">Controls</button>
              <button onClick={()=>setShowSettings(true)} title="Open settings">⚙️</button>
            </div>

            {/* Bottom Controls Bar (auto-hide on idle) */}
            {(controlsEnabled && menuVisible) && (
              <div className="bottom-controls">
                <div className="bc-group">
                  <div className="bc-label">Audio</div>
                  <div className="bc-row">
                    <span className="tag">S1</span>
                    <input className="range" type="range" min="0" max="100" value={vol1} onChange={e=>setVol1(Number(e.target.value))} disabled={!s1Enabled || !s1}/>
                    <button className="btn pill" onClick={()=>setMuted1(true)} disabled={!s1Enabled || !s1}>Mute</button>
                    <button className="btn pill" onClick={()=>setMuted1(false)} disabled={!s1Enabled || !s1}>Unmute</button>
                    <label className="switch">
                      <input type="checkbox" checked={s1Enabled} onChange={(e)=>setS1Enabled(e.target.checked)} />
                      <span>On</span>
                    </label>
                  </div>
                  <div className="bc-row">
                    <span className="tag">S2</span>
                    <input className="range" type="range" min="0" max="100" value={vol2} onChange={e=>setVol2(Number(e.target.value))} disabled={!s2Enabled || !s2}/>
                    <button className="btn pill" onClick={()=>setMuted2(true)} disabled={!s2Enabled || !s2}>Mute</button>
                    <button className="btn pill" onClick={()=>setMuted2(false)} disabled={!s2Enabled || !s2}>Unmute</button>
                    <label className="switch">
                      <input type="checkbox" checked={s2Enabled} onChange={(e)=>setS2Enabled(e.target.checked)} />
                      <span>On</span>
                    </label>
                  </div>
                  <div className="bc-row">
                    <span className="tag">Focus</span>
                    <button className={`btn ghost ${focus==='s1'?'active':''}`} onClick={()=>setFocus('s1')}>S1</button>
                    <button className={`btn ghost ${focus==='both'?'active':''}`} onClick={()=>setFocus('both')}>Both</button>
                    <button className={`btn ghost ${focus==='s2'?'active':''}`} onClick={()=>setFocus('s2')}>S2</button>
                  </div>
                </div>

                <div className="bc-group">
                  <div className="bc-label">Quality</div>
                  <div className="bc-row">
                    <span className="tag">S1</span>
                    <select
                      className="select"
                      value={q1}
                      onChange={(e)=>{ const v=e.target.value; setQ1(v); try{ applyQualityForce(yt1.current, v==='default'? defaultQuality: v);}catch{} }}
                      disabled={!s1Enabled || !s1}
                    >
                      {QUALITY_ORDER.map(q => <option key={`q1-${q}`} value={q}>{prettyQuality(q)}</option>)}
                    </select>
                  </div>
                  <div className="bc-row">
                    <span className="tag">S2</span>
                    <select
                      className="select"
                      value={q2}
                      onChange={(e)=>{ const v=e.target.value; setQ2(v); try{ applyQualityForce(yt2.current, v==='default'? defaultQuality: v);}catch{} }}
                      disabled={!s2Enabled || !s2}
                    >
                      {QUALITY_ORDER.map(q => <option key={`q2-${q}`} value={q}>{prettyQuality(q)}</option>)}
                    </select>
                  </div>
                </div>

                <div className="bc-group">
                  <div className="bc-label">Stream 2</div>
                  <div className="bc-row">
                    <button className="btn" onClick={changeStream2}>Change</button>
                    <button className="btn" onClick={removeStream2} disabled={!s2}>Remove</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {!!toastMsg && <div className="toast">{toastMsg}</div>}
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <SettingsModal
          close={() => setShowSettings(false)}
          // general
          shortcutsEnabled={shortcutsEnabled}
          setShortcutsEnabled={setShortcutsEnabled}
          share={() => copyShare()}
          resetLayout={resetLayout}
          // streams
          s1Input={s1Input} setS1Input={setS1Input}
          s2Input={s2Input} setS2Input={setS2Input}
          applyStreams={()=>{
            const id1 = getYouTubeId(s1Input);
            const id2 = getYouTubeId(s2Input);
            if (!id1) { alert('Primary stream is invalid.'); return; }
            setS1(id1); setS2(id2 || null); setS1Enabled(true); if(id2) setS2Enabled(true);
            pushHistory(id1); if (id2) pushHistory(id2); setHistory(readHistory());
            setShowSettings(false);
          }}
          clearToLanding={clearToLanding}
          // layout sizes
          l2ChatWidth={l2ChatWidth} setL2ChatWidth={(v)=>{ setL2ChatWidth(v); requestAnimationFrame(measureAll); }}
          l3S2Height={l3S2Height} setL3S2Height={(v)=>{ setL3S2Height(v); requestAnimationFrame(measureAll); }}
          l3RightWidth={l3RightWidth} setL3RightWidth={(v)=>{ setL3RightWidth(v); requestAnimationFrame(measureAll); }}
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
          keymap={keymap} setKeymap={setKeymap} resetKeymap={resetKeymap}
          // playback
          defaultQuality={defaultQuality} setDefaultQuality={setDefaultQuality}
          // API key (now visible & used)
          ytApiKeyOverride={ytApiKeyOverride} setYtApiKeyOverride={setYtApiKeyOverride}
          // enable flags
          s1Enabled={s1Enabled} setS1Enabled={setS1Enabled}
          s2Enabled={s2Enabled} setS2Enabled={setS2Enabled}
          // custom layouts
          customLayouts={customLayouts}
          useCustom={(i)=>setLayout(CUSTOM_START_NUM + i)}
          openBuilderNew={openBuilderNew}
          openBuilderEdit={openBuilderEdit}
          deleteCustom={deleteCustom}
          renameCustom={renameCustom}
          // sync meter
          getTimes={getTimes}
          nudgeS1={nudgeS1}
          nudgeS2={nudgeS2}
        />
      )}

      {/* Custom layout builder */}
      {showBuilder && (
        <CustomLayoutBuilder
          close={() => setShowBuilder(false)}
          initial={editingCustomIndex!=null ? customLayouts[editingCustomIndex] : null}
          onSave={(payload)=>{ upsertCustomLayout(payload, editingCustomIndex); setShowBuilder(false); }}
        />
      )}
    </div>
  );
}

/* ------------------- Settings Modal ------------------- */
function SettingsModal(props){
  const {
    close,
    // general
    shortcutsEnabled, setShortcutsEnabled, share, resetLayout,
    // streams
    s1Input, setS1Input, s2Input, setS2Input, applyStreams, clearToLanding,
    // layout sizes
    l2ChatWidth, setL2ChatWidth, l3S2Height, setL3S2Height, l3RightWidth, setL3RightWidth,
    // appearance
    frameW, setFrameW, frameColor, setFrameColor, bgUrl, setBgUrl, onUploadLocalBg,
    themes, saveThemePreset, applyThemePreset, deleteThemePreset,
    // overlays
    showMetrics, setShowMetrics, showTitles, setShowTitles,
    // keymap
    keymap, setKeymap, resetKeymap,
    // playback
    defaultQuality, setDefaultQuality,
    // API key
    ytApiKeyOverride, setYtApiKeyOverride,
    // enable flags
    s1Enabled, setS1Enabled, s2Enabled, setS2Enabled,
    // custom layouts
    customLayouts, useCustom, openBuilderNew, openBuilderEdit, deleteCustom, renameCustom,
    // sync meter
    getTimes, nudgeS1, nudgeS2,
  } = props;

  const keyCount = useMemo(() => {
    const m = new Map();
    Object.values(keymap).forEach(v => { const k = (v||'').toLowerCase(); if (!k) return; m.set(k,(m.get(k)||0)+1); });
    return m;
  }, [keymap]);

  // Sync meter state
  const [diff, setDiff] = useState(null);
  const [liveSync, setLiveSync] = useState(false);
  useEffect(() => {
    if (!liveSync) return;
    const t = setInterval(() => {
      const { t1, t2 } = getTimes();
      if (t1!=null && t2!=null) setDiff(t1 - t2);
    }, 1000);
    return () => clearInterval(t);
  }, [liveSync, getTimes]);

  const compareOnce = () => {
    const { t1, t2 } = getTimes();
    if (t1==null || t2==null) { setDiff(null); return; }
    setDiff(t1 - t2);
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal modal-wide" onClick={(e)=>e.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Close settings">✕</button>
        <h3>Settings</h3>
        <div className="settings-grid">

          {/* General */}
          <section className="settings-group">
            <h4>General</h4>
            <div className="row">
              <div className="label">Shortcuts</div>
              <button
                className={`toggle-btn ${shortcutsEnabled ? 'enabled' : 'disabled'}`}
                onClick={()=>setShortcutsEnabled(v=>!v)}
                title="Toggle hotkeys (when OFF you can use YouTube controls directly)"
                style={{ pointerEvents:'auto' }}
              >
                {shortcutsEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="row gap">
              <button className="cta" onClick={share}>Copy Share URL</button>
              <button className="btn" onClick={resetLayout}>Reset Layout</button>
              <button className="btn" onClick={clearToLanding}>Clear & Go to Landing</button>
            </div>
          </section>

          {/* Streams */}
          <section className="settings-group">
            <h4>Streams</h4>
            <label>Primary stream</label>
            <input className="field primary" value={s1Input} onChange={(e)=>setS1Input(e.target.value)} placeholder="YouTube link or video ID" />
            <label>Secondary stream</label>
            <input className="field" value={s2Input} onChange={(e)=>setS2Input(e.target.value)} placeholder="YouTube link or video ID" />
            <div className="row">
              <div className="label">Stream 1 enabled</div>
              <button className={`toggle-btn ${s1Enabled?'enabled':'disabled'}`} onClick={()=>setS1Enabled(v=>!v)}>{s1Enabled?'ON':'OFF'}</button>
            </div>
            <div className="row">
              <div className="label">Stream 2 enabled</div>
              <button className={`toggle-btn ${s2Enabled?'enabled':'disabled'}`} onClick={()=>setS2Enabled(v=>!v)}>{s2Enabled?'ON':'OFF'}</button>
            </div>
            <div className="row gap">
              <button className="cta" onClick={applyStreams}>Apply Streams</button>
            </div>
          </section>

          {/* Layout sizes */}
          <section className="settings-group">
            <h4>Layout</h4>
            <div className="row">
              <div className="label">Layout 2 – Chat width</div>
              <input type="range" min="260" max="720" step="2"
                     value={l2ChatWidth}
                     onChange={(e)=>setL2ChatWidth(Number(e.target.value))}
              />
              <input className="num" type="number" min="260" max="720" step="2"
                     value={l2ChatWidth}
                     onChange={(e)=>setL2ChatWidth(clamp(Number(e.target.value),260,720))}
              />
              <span className="unit">px</span>
            </div>
            <div className="row">
              <div className="label">Layout 3 – Stream 2 height</div>
              <input type="range" min="120" max="800" step="2"
                     value={l3S2Height}
                     onChange={(e)=>setL3S2Height(Number(e.target.value))}
              />
              <input className="num" type="number" min="120" max="800" step="2"
                     value={l3S2Height}
                     onChange={(e)=>setL3S2Height(clamp(Number(e.target.value),120,800))}
              />
              <span className="unit">px</span>
            </div>
            <div className="row">
              <div className="label">Layout 3 – Right column width</div>
              <input type="range" min="260" max="720" step="2"
                     value={l3RightWidth}
                     onChange={(e)=>setL3RightWidth(Number(e.target.value))}
              />
              <input className="num" type="number" min="260" max="720" step="2"
                     value={l3RightWidth}
                     onChange={(e)=>setL3RightWidth(clamp(Number(e.target.value),260,720))}
              />
              <span className="unit">px</span>
            </div>
          </section>

          {/* Appearance */}
          <section className="settings-group">
            <h4>Appearance</h4>
            <div className="row">
              <div className="label">Frame border width</div>
              <input type="range" min="0" max="12" step="1" value={frameW} onChange={(e)=>setFrameW(Number(e.target.value))}/>
              <input className="num" type="number" min="0" max="12" step="1" value={frameW} onChange={(e)=>setFrameW(clamp(Number(e.target.value),0,12))}/>
              <span className="unit">px</span>
            </div>
            <div className="row">
              <div className="label">Frame border color</div>
              <input type="color" value={frameColor} onChange={(e)=>setFrameColor(e.target.value)} />
              <input className="field" value={frameColor} onChange={(e)=>setFrameColor(e.target.value)} style={{maxWidth:160}}/>
            </div>
            <label>Background image URL</label>
            <input className="field" value={bgUrl} onChange={(e)=>setBgUrl(e.target.value)} placeholder="https://… (leave blank for gradient)" />
            <div className="row gap">
              <input type="file" accept="image/*" onChange={(e)=>onUploadLocalBg(e.target.files?.[0])}/>
              <button className="btn" onClick={()=>setBgUrl('')}>Use Gradient</button>
              <button className="btn" onClick={saveThemePreset}>Save Theme Preset</button>
            </div>
            {!!themes?.length && (
              <div className="row" style={{flexWrap:'wrap', gap:8}}>
                {themes.map(t=>(
                  <div key={t.name} className="theme-chip">
                    <span>{t.name}</span>
                    <button className="btn" onClick={()=>applyThemePreset(t.name)}>Apply</button>
                    <button className="btn" onClick={()=>deleteThemePreset(t.name)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Overlays */}
          <section className="settings-group">
            <h4>Overlays</h4>
            <div className="row">
              <div className="label">Show live metrics (viewers/likes)</div>
              <button className={`toggle-btn ${showMetrics ? 'enabled' : 'disabled'}`} onClick={()=>setShowMetrics(v=>!v)}>{showMetrics?'ON':'OFF'}</button>
            </div>
            <div className="row">
              <div className="label">Show stream title</div>
              <button className={`toggle-btn ${showTitles ? 'enabled' : 'disabled'}`} onClick={()=>setShowTitles(v=>!v)}>{showTitles?'ON':'OFF'}</button>
            </div>
          </section>

          {/* Playback */}
          <section className="settings-group">
            <h4>Playback</h4>
            <div className="row">
              <div className="label">Default quality</div>
              <select className="field" value={defaultQuality} onChange={(e)=>setDefaultQuality(e.target.value)} style={{maxWidth:200}}>
                {['default','hd720','hd1080','hd1440','hd2160','highres','large','medium','small']
                  .map(q=>(<option key={q} value={q}>{prettyQuality(q)}</option>))}
              </select>
            </div>
            <p className="muted">We re‑request the selected quality on ready/play/buffer so 1080p sticks if available.</p>
          </section>

          {/* Custom Layouts */}
          <section className="settings-group">
            <h4>Custom Layouts</h4>
            <div className="row gap">
              <button className="cta" onClick={openBuilderNew}>＋ New custom layout</button>
            </div>
            {customLayouts.length===0 && <p className="muted">No custom layouts yet.</p>}
            {!!customLayouts.length && (
              <div className="custom-list">
                {customLayouts.map((cl, i) => (
                  <div className="custom-item" key={cl.id || i}>
                    <div className="ci-name">{cl.name || `Custom ${i+1}`}</div>
                    <div className="ci-actions">
                      <button className="btn" onClick={()=>useCustom(i)}>Use</button>
                      <button className="btn" onClick={()=>openBuilderEdit(i)}>Edit</button>
                      <button className="btn" onClick={()=>renameCustom(i)}>Rename</button>
                      <button className="btn danger" onClick={()=>deleteCustom(i)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Sync meter */}
          <section className="settings-group">
            <h4>Stream Sync</h4>
            <p className="muted">Compares current playback time of S1 vs S2. Positive means S1 is ahead.</p>
            <div className="row gap">
              <button className="btn" onClick={compareOnce}>Compare once</button>
              <button className={`btn ${liveSync?'active':''}`} onClick={()=>setLiveSync(v=>!v)}>{liveSync?'Stop live':'Start live'}</button>
              <span className="sync-readout">{diff==null ? '–' : `${(diff).toFixed(2)} s (S1 - S2)`}</span>
            </div>
            <div className="row gap">
              <span className="label">Nudge</span>
              <button className="btn" onClick={()=>nudgeS1(-0.5)}>S1 −0.5s</button>
              <button className="btn" onClick={()=>nudgeS1(0.5)}>S1 +0.5s</button>
              <button className="btn" onClick={()=>nudgeS2(-0.5)}>S2 −0.5s</button>
              <button className="btn" onClick={()=>nudgeS2(0.5)}>S2 +0.5s</button>
            </div>
          </section>

          {/* YouTube Data API key */}
          <section className="settings-group">
            <h4>YouTube Data API Key</h4>
            <p className="muted">Optional—used for titles and live metrics. Stored locally in your browser (localStorage).</p>
            <div className="row">
              <input
                className="field"
                placeholder="AIza... (your API key)"
                value={ytApiKeyOverride}
                onChange={(e)=>setYtApiKeyOverride(e.target.value.trim())}
              />
              <button className="btn" onClick={()=>setYtApiKeyOverride('')}>Clear</button>
            </div>
          </section>

          {/* Keybinds */}
          <section className="settings-group">
            <h4>Keybinds</h4>
            <p className="muted">Click a field and press a key. Duplicates highlight in red.</p>
            <div className="key-grid">
              {[
                ['layout1','Layout 1'],['layout2','Layout 2'],['layout3','Layout 3'],
                ['layout4','Layout 4'],['layout5','Layout 5'],['layout6','Layout 6'],
                ['swap','Swap Streams'],['toggleShortcuts','Toggle Shortcuts'],['openSettings','Open Settings'],
                ['focusAudio','Focus Audio'],['muteAll','Mute All'],['unmuteAll','Unmute All'],
                ['nudgeBack','Seek −10s'],['nudgeForward','Seek +10s'],
                ['toggleChat','Toggle Chat (Layout 3)'],
                ['toggleInfo','Toggle Titles + Metrics'],
                ['chatWidthDec','L2 Chat width −'],['chatWidthInc','L2 Chat width +'],
                ['s2HeightDec','L3 S2 height −'],['s2HeightInc','L3 S2 height +'],
                ['l3RightDec','L3 Right width −'],['l3RightInc','L3 Right width +'],
                ['borderDec','Border −'],['borderInc','Border +'],
              ].map(([id,label])=>{
                const val = keymap[id] || '';
                const dup = val && (Array.from(Object.values(keymap)).filter(v => (v||'').toLowerCase() === val.toLowerCase()).length > 1);
                return (
                  <div className="key-row" key={id}>
                    <label>{label}</label>
                    <input
                      className={`key-input ${dup?'dup':''}`}
                      value={val}
                      onKeyDown={(e)=>{ e.preventDefault(); setKeymap({ ...keymap, [id]: e.key }); }}
                      onChange={()=>{}}
                      placeholder="Press a key"
                    />
                  </div>
                );
              })}
            </div>
            <div className="row gap">
              <button className="btn" onClick={resetKeymap}>Reset Keybinds</button>
              <span className="muted">Duplicates in use: {Array.from(keyCount.values()).filter(n=>n>1).length}</span>
            </div>
          </section>

          <div className="settings-actions">
            <div className="madeby">Made by <strong>Vat5aL</strong></div>
            <button className="cta" onClick={close}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------ Custom Layout Builder ------------------ */
/* items: [{id,kind:'s1'|'s2'|'chat1'|'chat2', x:1..cols, y:1..rows, w:1.., h:1..}] */
function CustomLayoutBuilder({ initial, onSave, close }) {
  const [name, setName] = useState(initial?.name || '');
  const [cols, setCols] = useState(initial?.grid?.cols || 5);
  const [rows, setRows] = useState(initial?.grid?.rows || 5);
  const [gap, setGap]   = useState(initial?.grid?.gap  || 8);
  const [items, setItems] = useState(()=> initial?.items || []);
  const canvasRef = useRef(null);
  const [cell, setCell] = useState({ cw: 120, ch: 68, W: 900, H: 540 });

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      const el = canvasRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const cw = (r.width - gap*(cols-1)) / cols;
      const ch = (r.height - gap*(rows-1)) / rows;
      setCell({ cw, ch, W: r.width, H: r.height });
    });
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [cols, rows, gap]);

  const usedKinds = new Set(items.map(i=>i.kind));
  const addKind = (kind) => {
    if (usedKinds.has(kind)) return;
    const id = `it-${Math.random().toString(36).slice(2,8)}`;
    // default 3 cols wide if possible
    const w = Math.min(3, cols);
    const pxW = w*cell.cw + (w-1)*gap;
    const pxH = Math.round(pxW * (9/16));
    const h = Math.max(1, Math.round(pxH / cell.ch));
    setItems([...items, { id, kind, x:1, y:1, w, h }]);
  };
  const removeItem = (id) => setItems(items.filter(it => it.id !== id));

  const toPxRect = (it) => {
    const x = (it.x-1)*(cell.cw + gap);
    const y = (it.y-1)*(cell.ch + gap);
    const width  = it.w*cell.cw + (it.w-1)*gap;
    const height = Math.round(width * 9/16);
    return { x, y, width, height };
  };

  const toCellRect = (x, y, width) => {
    const gx = clamp(Math.round(x / (cell.cw + gap)) + 1, 1, cols);
    const gy = clamp(Math.round(y / (cell.ch + gap)) + 1, 1, rows);
    let w = clamp(Math.round((width + gap) / (cell.cw + gap)), 1, cols - gx + 1);
    // compute h to keep 16:9
    const pxW = w*cell.cw + (w-1)*gap;
    const pxH = pxW * 9/16;
    let h = clamp(Math.max(1, Math.round(pxH / cell.ch)), 1, rows - gy + 1);
    return { x:gx, y:gy, w, h };
  };

  const onDragStop = (it, d) => {
    const c = toCellRect(d.x, d.y, toPxRect(it).width);
    setItems(items.map(x => x.id===it.id ? { ...it, ...c } : x));
  };

  const onResizeStop = (it, dir, ref, delta, pos) => {
    const c = toCellRect(pos.x, pos.y, parseFloat(ref.style.width));
    setItems(items.map(x => x.id===it.id ? { ...it, ...c } : x));
  };

  // Basic overlap prevention during save
  const rectOf = (a) => ({ x:a.x, y:a.y, w:a.w, h:a.h });
  const overlap = (A,B) => !(A.x+A.w<=B.x || B.x+B.w<=A.x || A.y+A.h<=B.y || B.y+B.h<=A.y);

  const doSave = () => {
    // snap inside grid bounds
    let fixed = items.map(it => ({
      ...it,
      x: clamp(it.x, 1, cols),
      y: clamp(it.y, 1, rows),
      w: clamp(it.w, 1, cols - it.x + 1),
      h: clamp(it.h, 1, rows - it.y + 1)
    }));
    // check overlaps
    for (let i=0;i<fixed.length;i++){
      for (let j=i+1;j<fixed.length;j++){
        if (overlap(rectOf(fixed[i]), rectOf(fixed[j]))) {
          alert('Tiles overlap. Please separate them.'); return;
        }
      }
    }
    const payload = {
      id: initial?.id || `cl-${Math.random().toString(36).slice(2,8)}`,
      name: name || (initial?.name || 'Custom layout'),
      grid: { cols, rows, gap },
      items: fixed
    };
    onSave(payload);
  };

  return (
    <div className="builder-backdrop" onClick={close}>
      <div className="builder" onClick={(e)=>e.stopPropagation()}>
        <div className="builder-top">
          <div className="builder-title">{initial ? 'Edit Custom Layout' : 'New Custom Layout'}</div>
          <div className="builder-controls">
            <label>Columns</label><input className="num" type="number" min="2" max="12" value={cols} onChange={(e)=>setCols(clamp(Number(e.target.value),2,12))}/>
            <label>Rows</label><input className="num" type="number" min="2" max="12" value={rows} onChange={(e)=>setRows(clamp(Number(e.target.value),2,12))}/>
            <label>Gap(px)</label><input className="num" type="number" min="0" max="24" value={gap} onChange={(e)=>setGap(clamp(Number(e.target.value),0,24))}/>
            <label>Name</label><input className="field" value={name} onChange={(e)=>setName(e.target.value)} placeholder="Layout name"/>
            <div className="sep" />
            <button className={`btn ${!usedKinds.has('s1')?'':'disabled'}`} onClick={()=>addKind('s1')}>+ Stream‑1</button>
            <button className={`btn ${!usedKinds.has('s2')?'':'disabled'}`} onClick={()=>addKind('s2')}>+ Stream‑2</button>
            <button className={`btn ${!usedKinds.has('chat1')?'':'disabled'}`} onClick={()=>addKind('chat1')}>+ Chat‑1</button>
            <button className={`btn ${!usedKinds.has('chat2')?'':'disabled'}`} onClick={()=>addKind('chat2')}>+ Chat‑2</button>
          </div>
        </div>
        <div className="canvas-wrap">
          <div className="cl-canvas" ref={canvasRef} style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap: `${gap}px`,
            backgroundSize: `calc((100% - ${(cols-1)*gap}px)/${cols}) calc((100% - ${(rows-1)*gap}px)/${rows})`,
          }}>
            {/* background grid is done with repeating gradients in CSS */}
            {items.map(it => {
              const px = toPxRect(it);
              return (
                <Rnd
                  key={it.id}
                  className="cl-item"
                  size={{ width: px.width, height: px.height }}
                  position={{ x: px.x, y: px.y }}
                  bounds=".cl-canvas"
                  lockAspectRatio={16/9}
                  onDragStop={(e, d)=>onDragStop(it, d)}
                  onResizeStop={(e, dir, ref, delta, pos)=>onResizeStop(it, dir, ref, pos)}
                >
                  <div className="cl-box">
                    <div className="cl-kind">{labelForKind(it.kind)}</div>
                    <button className="cl-close" onClick={()=>removeItem(it.id)}>×</button>
                  </div>
                </Rnd>
              );
            })}
          </div>
        </div>
        <div className="builder-actions">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="cta" onClick={doSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
function labelForKind(k){ return ({s1:'1', s2:'2', chat1:'Chat‑1', chat2:'Chat‑2'})[k] || k; }
