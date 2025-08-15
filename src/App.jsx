import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import './App.css';
import { getYouTubeId, lsGet, lsSet, clamp } from './utils';

/* -------------------- Tunables -------------------- */
const DEFAULT_PIP = { x: 24, y: 24, width: 480, height: 270 };
const DEFAULT_L3_S2H  = 240;         // px (Layout 3 top stream height)
const DEFAULT_L3_RIGHT_W = 360;      // px (Layout 3 right column width for S2)
const METRICS_MS = 30000;            // 30s

// Default YouTube Data API key comes from env, but can be overridden per-user in settings
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

/* -------- YouTube info (metrics + title) ---------- */
function useYouTubeInfo(videoId, { metricsEnabled, titleEnabled, apiKey }) {
  const [data, setData] = useState({ viewers: null, likes: null, title: '' });

  useEffect(() => {
    if (!videoId || (!metricsEnabled && !titleEnabled)) return;
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
  toggleInfo:'i',
  s2HeightDec:'ArrowDown',   // Layout 3 S2 height -
  s2HeightInc:'ArrowUp',     // Layout 3 S2 height +
  l3RightDec:'-',            // Layout 3 – right column width -
  l3RightInc:'=',            // Layout 3 – right column width +
  borderDec:'ArrowLeft',
  borderInc:'ArrowRight',
};
const norm = (k) => (k || '').toLowerCase();

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
const QUALITY_ORDER = ['default','small','medium','large','hd720','hd1080','hd1440','hd2160','highres'];
const PREFERRED_DEFAULT_QUALITY = 'hd1080';
const prettyQuality = (q) => QUALITY_LABELS[q] || q || 'Auto';

/* Cursor helper for PIP */
const cursorForDir = (dir) => ({
  top: 'n-resize', bottom:'s-resize', left:'w-resize', right:'e-resize',
  topRight:'ne-resize', topLeft:'nw-resize', bottomRight:'se-resize', bottomLeft:'sw-resize',
  n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize'
}[dir] || 'default');

/* ================================================== */
export default function App() {
  /* Streams */
  const [s1Input, setS1Input] = useState(() => lsGet('ms_stream1',''));
  const [s2Input, setS2Input] = useState(() => lsGet('ms_stream2',''));
  const [s1, setS1] = useState(() => getYouTubeId(lsGet('ms_stream1','')));
  const [s2, setS2] = useState(() => getYouTubeId(lsGet('ms_stream2','')));

  /* Stream enabled flags (turning OFF destroys the player) */
  const [s1Enabled, setS1Enabled] = useState(() => lsGet('ms_s1_enabled', true));
  const [s2Enabled, setS2Enabled] = useState(() => lsGet('ms_s2_enabled', true));

  /* Layout/UI */
  const [layout, setLayout] = useState(() => lsGet('ms_layout',1));
  const [swap, setSwap] = useState(() => lsGet('ms_swap',false));
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => lsGet('ms_shortcuts_enabled',true));
  const [menuVisible, setMenuVisible] = useState(true);                 // auto‑hide bars
  const [controlsEnabled, setControlsEnabled] = useState(() => lsGet('ms_controls_enabled', true)); // toggle bottom controls

  /* Sizes */
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

  /* Geometry */
  const stageRef = useRef(null);
  const slotS1 = useRef(null);
  const slotS2 = useRef(null);
  const [rectS1, setRectS1] = useState(null);
  const [rectS2, setRectS2] = useState(null);
  const lastS1 = useRef(null);
  const lastS2 = useRef(null);

  /* Player API */
  const origin = useMemo(() => window.location.origin, []);
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
        events: { onReady: (e) => {
          try {
            e.target.mute();
            e.target.setPlaybackQuality(defaultQuality);
            e.target.setVolume(vol1);
            e.target.playVideo();
          } catch {}
        } }
      });
    }
    if (!s1Enabled && yt1.current) {
      try { yt1.current.destroy(); } catch {}
      yt1.current = null;
    }

    // Stream 2
    if (s2Enabled && p2Ref.current && s2 && !yt2.current) {
      yt2.current = new window.YT.Player(p2Ref.current, {
        events: { onReady: (e) => {
          try {
            e.target.mute();
            e.target.setPlaybackQuality(defaultQuality);
            e.target.setVolume(vol2);
            e.target.playVideo();
          } catch {}
        } }
      });
    }
    if (!s2Enabled && yt2.current) {
      try { yt2.current.destroy(); } catch {}
      yt2.current = null;
    }
  }, [ytReady, s1Enabled, s2Enabled, s1, s2, defaultQuality, vol1, vol2]);

  /* ---- Force play when IDs change ---- */
  useEffect(() => {
    if (yt1.current && s1Enabled && s1) { try {
      yt1.current.loadVideoById(s1);
      yt1.current.setPlaybackQuality(defaultQuality);
      yt1.current.setVolume(vol1);
      yt1.current.playVideo();
    } catch {} }
  }, [s1, s1Enabled, defaultQuality, vol1]);
  useEffect(() => {
    if (yt2.current && s2Enabled && s2) { try {
      yt2.current.loadVideoById(s2);
      yt2.current.setPlaybackQuality(defaultQuality);
      yt2.current.setVolume(vol2);
      yt2.current.playVideo();
    } catch {} }
  }, [s2, s2Enabled, defaultQuality, vol2]);

  /* ---- Persist ---- */
  useEffect(()=>lsSet('ms_stream1', s1Input),[s1Input]);
  useEffect(()=>lsSet('ms_stream2', s2Input),[s2Input]);
  useEffect(()=>lsSet('ms_layout', layout),[layout]);
  useEffect(()=>lsSet('ms_controls_enabled', controlsEnabled),[controlsEnabled]);
  useEffect(()=>lsSet('ms_swap', swap),[swap]);
  useEffect(()=>lsSet('ms_shortcuts_enabled', shortcutsEnabled),[shortcutsEnabled]);
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
    const r2 = layout === 4 ? null : toLocal(slotS2.current); // L4 uses PIP rect
    setRectS1(r1); if (r1) lastS1.current = r1;
    setRectS2(r2); if (r2) lastS2.current = r2;
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
  }, [layout, l3S2Height, l3RightWidth, measureAll]);

  useEffect(() => {
    const ro = new ResizeObserver(() => requestAnimationFrame(measureAll));
    if (slotS1.current) ro.observe(slotS1.current);
    if (slotS2.current) ro.observe(slotS2.current);
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

  /* ---- Sources ---- */
  const baseParams = `autoplay=1&playsinline=1&mute=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
  const s1Src = (s1 && s1Enabled) ? `https://www.youtube.com/embed/${s1}?${baseParams}` : null;
  const s2Src = (s2 && s2Enabled) ? `https://www.youtube.com/embed/${s2}?${baseParams}` : null;

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

  /* ---- Key handling ---- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const type = (e.target?.type || '').toLowerCase();
      const isKeybindField = e.target?.classList?.contains('key-input');
      const isTypingContext =
        tag === 'textarea' ||
        (tag === 'input' && !['range','checkbox','color','button','submit'].includes(type)) ||
        isKeybindField;
      if (isTypingContext) return; // sliders/buttons won't block shortcuts

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
      else if (norm(k) === norm(keymap.toggleInfo)) {
        stop(); const anyOn = showMetrics || showTitles; setShowMetrics(!anyOn); setShowTitles(!anyOn);
      }
      else if (k === keymap.s2HeightDec) { stop(); setL3S2Height(v=>clamp(v-12,120,800)); requestAnimationFrame(measureAll); }
      else if (k === keymap.s2HeightInc) { stop(); setL3S2Height(v=>clamp(v+12,120,800)); requestAnimationFrame(measureAll); }
      else if (norm(k) === norm(keymap.l3RightDec)) { stop(); if (layout===3) { setL3RightWidth(v=>clamp(v-12,260,720)); requestAnimationFrame(measureAll); } }
      else if (norm(k) === norm(keymap.l3RightInc)) { stop(); if (layout===3) { setL3RightWidth(v=>clamp(v+12,260,720)); requestAnimationFrame(measureAll); } }
      else if (k === keymap.borderDec) { stop(); setFrameW(v=>clamp(v-1,0,12)); }
      else if (k === keymap.borderInc) { stop(); setFrameW(v=>clamp(v+1,0,12)); }
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
    default: break;
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
  };
  const addStream2 = () => {
    const v = prompt('Enter Stream 2 URL or ID:'); if (!v) return;
    const id = getYouTubeId(v); if (id) { setS2(id); setS2Input(id); setS2Enabled(true); } else alert('Invalid link or ID.');
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

  /* ---- Render ---- */
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
              <button className="cta" onClick={play}>Play</button>
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

          {/* UI layer: slots & controls */}
          <div className="ui-layer">
            {/* Interaction shield to block iframes during drag/resize */}
            <div className={`interaction-shield ${shield.active ? 'show' : ''}`} style={{ cursor: shield.cursor }} />

            {/* Layout content (slots) */}
            {(() => {
              switch (layout) {
                case 1:
                  return (<div className="layout layout-1"><div className="slot slot-s1" ref={slotS1} /></div>);
                case 2:
                  return (
                    <div className="layout layout-2">
                      <div className="slot slot-s1" ref={slotS1} />
                    </div>
                  );
                case 3:
                  return (
                    <div className="layout layout-3" style={{ gridTemplateColumns: `1fr ${l3RightWidth}px` }}>
                      <div className="slot slot-s1" ref={slotS1} />
                      <div className="right-col" style={{ gridTemplateRows: `${l3S2Height}px 1fr` }}>
                        <div className="slot-wrap">
                          <div className={`slot slot-s2 fill ${s2 ? 'transparent' : ''}`} ref={slotS2} />
                          {!s2 && <button className="add-stream-tile" onClick={addStream2}>+</button>}
                        </div>
                        <div /> {/* filler area (no chat) */}
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
                default: return null;
              }
            })()}

            {/* Top center: layout buttons */}
            <div className={`layout-menu ${menuVisible ? 'visible' : ''}`}>
              {[1,2,3,4,5,6].map(n=>(
                <button key={n} onClick={()=>setLayout(n)} className={layout===n?'active':''}>{n}</button>
              ))}
              <button onClick={()=>setSwap(v=>!v)} title="Swap streams">Swap (Q)</button>
              <button onClick={resetLayout} title="Reset splits & PIP">Reset</button>
              <button onClick={()=>setControlsEnabled(v=>!v)} className={controlsEnabled?'active':''} title="Toggle bottom controls">Controls</button>
              <button onClick={()=>setShowSettings(true)} title="Open settings">⚙️</button>
            </div>

            {/* Bottom Controls Bar */}
            {(controlsEnabled && menuVisible) && (
              <div className="bottom-controls">
                <div className="bc-group">
                  <div className="bc-label">Audio</div>
                  <div className="bc-row">
                    <span>S1</span>
                    <input type="range" min="0" max="100" value={vol1} onChange={e=>setVol1(Number(e.target.value))} disabled={!s1Enabled || !s1}/>
                    <button className="btn" onClick={()=>setMuted1(true)} disabled={!s1Enabled || !s1}>Mute</button>
                    <button className="btn" onClick={()=>setMuted1(false)} disabled={!s1Enabled || !s1}>Unmute</button>
                    <label className="switch">
                      <input type="checkbox" checked={s1Enabled} onChange={(e)=>setS1Enabled(e.target.checked)} />
                      <span>On</span>
                    </label>
                  </div>
                  <div className="bc-row">
                    <span>S2</span>
                    <input type="range" min="0" max="100" value={vol2} onChange={e=>setVol2(Number(e.target.value))} disabled={!s2Enabled || !s2}/>
                    <button className="btn" onClick={()=>setMuted2(true)} disabled={!s2Enabled || !s2}>Mute</button>
                    <button className="btn" onClick={()=>setMuted2(false)} disabled={!s2Enabled || !s2}>Unmute</button>
                    <label className="switch">
                      <input type="checkbox" checked={s2Enabled} onChange={(e)=>setS2Enabled(e.target.checked)} />
                      <span>On</span>
                    </label>
                  </div>
                  <div className="bc-row">
                    <span>Focus</span>
                    <button className={`btn ${focus==='s1'?'active':''}`} onClick={()=>setFocus('s1')}>S1</button>
                    <button className={`btn ${focus==='both'?'active':''}`} onClick={()=>setFocus('both')}>Both</button>
                    <button className={`btn ${focus==='s2'?'active':''}`} onClick={()=>setFocus('s2')}>S2</button>
                  </div>
                </div>

                <div className="bc-group">
                  <div className="bc-label">Quality</div>
                  <div className="bc-row">
                    <span>S1</span>
                    <select
                      value={q1}
                      onChange={(e)=>{ const v=e.target.value; setQ1(v); try{ yt1.current?.setPlaybackQuality(v);}catch{} }}
                      disabled={!s1Enabled || !s1}
                    >
                      {QUALITY_ORDER.map(q => <option key={`q1-${q}`} value={q}>{prettyQuality(q)}</option>)}
                    </select>
                  </div>
                  <div className="bc-row">
                    <span>S2</span>
                    <select
                      value={q2}
                      onChange={(e)=>{ const v=e.target.value; setQ2(v); try{ yt2.current?.setPlaybackQuality(v);}catch{} }}
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
            setShowSettings(false);
          }}
          clearToLanding={clearToLanding}
          // layout sizes
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
          // API key
          ytApiKeyOverride={ytApiKeyOverride} setYtApiKeyOverride={setYtApiKeyOverride}
          // enable flags
          s1Enabled={s1Enabled} setS1Enabled={setS1Enabled}
          s2Enabled={s2Enabled} setS2Enabled={setS2Enabled}
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
    l3S2Height, setL3S2Height, l3RightWidth, setL3RightWidth,
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
  } = props;

  const keyCount = useMemo(() => {
    const m = new Map();
    Object.values(keymap).forEach(v => { const k = (v||'').toLowerCase(); if (!k) return; m.set(k,(m.get(k)||0)+1); });
    return m;
  }, [keymap]);

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
            <p className="muted">We request the selected quality from YouTube. If that rendition isn’t available, YouTube may pick the closest available.</p>
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
                ['toggleInfo','Toggle Titles + Metrics'],
                ['s2HeightDec','S2 height −'],['s2HeightInc','S2 height +'],
                ['l3RightDec','Layout 3 Right width −'],['l3RightInc','Layout 3 Right width +'],
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
            <button className="cta" onClick={close}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
