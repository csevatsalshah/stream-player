import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import './App.css';
import { getYouTubeId, lsGet, lsSet, clamp } from './utils';

/* -------------------- Tunables -------------------- */
const DEFAULT_PIP = { x: 24, y: 24, width: 480, height: 270 };
const DEFAULT_L2_CHAT = 360;   // px
const DEFAULT_L3_S2H  = 240;   // px
const METRICS_MS = 30000;      // 30s
const YT_API_KEY = 'AIzaSyA_WWfYxtFqm680Yqzoa0_uUg3iq3T3tIY';

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
/** Only fetches when the corresponding toggles are ON (saves API calls). */
function useYouTubeInfo(videoId, { metricsEnabled, titleEnabled }) {
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
        const url =
          `https://www.googleapis.com/youtube/v3/videos?part=${part}&id=${videoId}&key=${YT_API_KEY}`;
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
    // poll only if metrics are enabled (titles usually don't need frequent refresh)
    if (metricsEnabled) timer = setInterval(fetchOnce, METRICS_MS);
    return () => { if (timer) clearInterval(timer); };
  }, [videoId, metricsEnabled, titleEnabled]);

  return data;
}

/* ------------------- Keymap ------------------------ */
const DEFAULT_KEYMAP = {
  layout1:'1', layout2:'2', layout3:'3', layout4:'4', layout5:'5', layout6:'6',
  swap:'q',
  toggleShortcuts:'s',
  openSettings:'o',
  focusAudio:'a',
  muteAll:'m',
  unmuteAll:'u',
  // Seeking kept via hotkeys (UI buttons removed)
  nudgeBack:'[',
  nudgeForward:']',
  toggleChat:'c',              // layout 3
  toggleInfo:'i',              // toggles Titles + Metrics together
  chatWidthDec:',',            // Layout 2 chat width -
  chatWidthInc:'.',            // Layout 2 chat width +
  s2HeightDec:'ArrowDown',     // Layout 3 S2 height -
  s2HeightInc:'ArrowUp',       // Layout 3 S2 height +
  borderDec:'ArrowLeft',       // Border width -
  borderInc:'ArrowRight',      // Border width +
};
const norm = (k) => (k || '').toLowerCase();

/* Small helper for PIP cursors */
const cursorForDir = (dir) => {
  switch (dir) {
    case 'n': return 'n-resize';
    case 's': return 's-resize';
    case 'e': return 'e-resize';
    case 'w': return 'w-resize';
    case 'ne': return 'ne-resize';
    case 'nw': return 'nw-resize';
    case 'se': return 'se-resize';
    case 'sw': return 'sw-resize';
    default: return 'default';
  }
};

/* ================================================== */
export default function App() {
  /* Streams */
  const [s1Input, setS1Input] = useState(() => lsGet('ms_stream1',''));
  const [s2Input, setS2Input] = useState(() => lsGet('ms_stream2',''));
  const [s1, setS1] = useState(() => getYouTubeId(lsGet('ms_stream1','')));
  const [s2, setS2] = useState(() => getYouTubeId(lsGet('ms_stream2','')));

  /* Layout/UI */
  const [layout, setLayout] = useState(() => lsGet('ms_layout',1));
  const [swap, setSwap] = useState(() => lsGet('ms_swap',false));
  const [chatTab, setChatTab] = useState(() => lsGet('ms_chatTab',1));
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => lsGet('ms_shortcuts_enabled',true));
  const [menuVisible, setMenuVisible] = useState(true);

  /* Sizes (Settings sliders) */
  const [l2ChatWidth, setL2ChatWidth] = useState(() => lsGet('ms_l2_chat', DEFAULT_L2_CHAT));
  const [l3S2Height, setL3S2Height] = useState(() => lsGet('ms_l3_s2h', DEFAULT_L3_S2H));

  /* PIP */
  const [pip, setPip] = useState(() => lsGet('ms_pip', DEFAULT_PIP));
  const [pipMoving, setPipMoving] = useState(false); // disables transitions while dragging/resizing
  const [pipLockAR, setPipLockAR] = useState(false); // hold Shift to lock 16:9
  // Stage‑wide interaction shield while dragging/resizing (prevents iframes from eating events)
  const [shield, setShield] = useState({ active:false, cursor:'default' });

  /* Theme / Appearance */
  const [bgUrl, setBgUrl] = useState(() => lsGet('ms_bg', ''));
  const [frameW, setFrameW] = useState(() => lsGet('ms_frame_w', 0)); // px
  const [frameColor, setFrameColor] = useState(() => lsGet('ms_frame_c', '#ffffff'));

  /* Overlays */
  const [showMetrics, setShowMetrics] = useState(() => lsGet('ms_show_metrics', true));
  const [showTitles, setShowTitles]   = useState(() => lsGet('ms_show_titles', false));

  /* Settings modal */
  const [showSettings, setShowSettings] = useState(false);

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
  const lastChat = useRef(null);

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

  /* Audio focus */
  const [focus, setFocus] = useState('both'); // 's1' | 's2' | 'both'

  /* Info (metrics + title) */
  const info1 = useYouTubeInfo(s1, { metricsEnabled: showMetrics, titleEnabled: showTitles });
  const info2 = useYouTubeInfo(s2, { metricsEnabled: showMetrics, titleEnabled: showTitles });

  /* ---- Boot: IFrame API ---- */
  useEffect(() => { let off=false; loadYouTubeAPI().then(()=>!off&&setYtReady(true)); return ()=>{off=true}; }, []);
  useEffect(() => {
    if (!ytReady) return;

    if (p1Ref.current && !yt1.current) {
      yt1.current = new window.YT.Player(p1Ref.current, {
        events: { onReady: (e) => { try { e.target.mute(); e.target.playVideo(); } catch {} } }
      });
    }
    if (p2Ref.current && !yt2.current && s2) {
      yt2.current = new window.YT.Player(p2Ref.current, {
        events: { onReady: (e) => { try { e.target.mute(); e.target.playVideo(); } catch {} } }
      });
    }
  }, [ytReady, s2]);

  /* ---- Force play when IDs change (fixes red button) ---- */
  useEffect(() => {
    if (yt1.current && s1) { try { yt1.current.loadVideoById(s1); yt1.current.mute(); yt1.current.playVideo(); } catch {} }
  }, [s1]);
  useEffect(() => {
    if (yt2.current && s2) { try { yt2.current.loadVideoById(s2); yt2.current.mute(); yt2.current.playVideo(); } catch {} }
  }, [s2]);

  /* ---- Persist ---- */
  useEffect(()=>lsSet('ms_stream1', s1Input),[s1Input]);
  useEffect(()=>lsSet('ms_stream2', s2Input),[s2Input]);
  useEffect(()=>lsSet('ms_layout', layout),[layout]);
  useEffect(()=>lsSet('ms_swap', swap),[swap]);
  useEffect(()=>lsSet('ms_chatTab', chatTab),[chatTab]);
  useEffect(()=>lsSet('ms_shortcuts_enabled', shortcutsEnabled),[shortcutsEnabled]);
  useEffect(()=>lsSet('ms_l2_chat', l2ChatWidth),[l2ChatWidth]);
  useEffect(()=>lsSet('ms_l3_s2h', l3S2Height),[l3S2Height]);
  useEffect(()=>lsSet('ms_pip', pip),[pip]);
  useEffect(()=>lsSet('ms_bg', bgUrl),[bgUrl]);
  useEffect(()=>lsSet('ms_keymap', keymap),[keymap]);
  useEffect(()=>lsSet('ms_frame_w', frameW),[frameW]);
  useEffect(()=>lsSet('ms_frame_c', frameColor),[frameColor]);
  useEffect(()=>lsSet('ms_show_metrics', showMetrics),[showMetrics]);
  useEffect(()=>lsSet('ms_show_titles', showTitles),[showTitles]);

  /* ---- Auto-hide menu & settings btn ---- */
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
    const rc = toLocal(chatSlot.current);

    setRectS1(r1); if (r1) lastS1.current = r1;
    setRectS2(r2); if (r2) lastS2.current = r2;
    setRectChat(rc); if (rc) lastChat.current = rc;
  }, [layout]);

  // settle across a few frames (prevents “missing rect” while grid settles)
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
  }, [layout, l2ChatWidth, l3S2Height, measureAll]);

  useEffect(() => {
    const ro = new ResizeObserver(() => requestAnimationFrame(measureAll));
    if (slotS1.current) ro.observe(slotS1.current);
    if (slotS2.current) ro.observe(slotS2.current);
    if (chatSlot.current) ro.observe(chatSlot.current);
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
  const s1Src = s1 ? `https://www.youtube.com/embed/${s1}?${baseParams}` : null;
  const s2Src = s2 ? `https://www.youtube.com/embed/${s2}?${baseParams}` : null;
  const chat1Src = s1 ? `https://www.youtube.com/live_chat?v=${s1}&embed_domain=${domain}` : null;
  const chat2Src = s2 ? `https://www.youtube.com/live_chat?v=${s2}&embed_domain=${domain}` : null;

  /* ---- Audio focus & seek ---- */
  const applyFocus = useCallback((f) => {
    const a = yt1.current, b = yt2.current;
    if (f === 's1') { a?.unMute(); a?.setVolume?.(100); b?.mute(); }
    else if (f === 's2') { b?.unMute(); b?.setVolume?.(100); a?.mute(); }
    else { a?.unMute(); b?.unMute(); }
  }, []);
  useEffect(() => { applyFocus(focus); }, [focus, applyFocus]);

  const muteAll = useCallback(() => { yt1.current?.mute(); yt2.current?.mute(); }, []);
  const unmuteAll = useCallback(() => { yt1.current?.unMute(); yt2.current?.unMute(); }, []);
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
      if (tag === 'input' || tag === 'textarea') return;
      const k = e.key;

      // Always allow toggling shortcuts
      if (norm(k) === norm(keymap.toggleShortcuts)) { e.preventDefault(); setShortcutsEnabled(v=>!v); return; }
      if (!shortcutsEnabled) return;

      // Prevent page scroll for handled keys
      const stop = () => { e.preventDefault(); e.stopPropagation(); };

      if (norm(k) === norm(keymap.openSettings)) { stop(); setShowSettings(true); }
      else if (norm(k) === norm(keymap.swap)) { stop(); setSwap(v=>!v); }
      else if (norm(k) === norm(keymap.focusAudio)) { stop(); setFocus(f=>f==='s1'?'s2':'s1'); }
      else if (norm(k) === norm(keymap.muteAll)) { stop(); muteAll(); }
      else if (norm(k) === norm(keymap.unmuteAll)) { stop(); unmuteAll(); }
      else if (norm(k) === norm(keymap.nudgeBack)) { stop(); nudge(-10); }
      else if (norm(k) === norm(keymap.nudgeForward)) { stop(); nudge(10); }
      else if (norm(k) === norm(keymap.toggleChat) && layout === 3) { stop(); setChatTab(t => (t === 1 ? 2 : 1)); }
      else if (norm(k) === norm(keymap.toggleInfo)) { // Titles & Metrics together
        stop();
        const anyOn = showMetrics || showTitles;
        setShowMetrics(!anyOn); setShowTitles(!anyOn);
      }
      // L2 chat width +/- (min 260, max 720)
      else if (norm(k) === norm(keymap.chatWidthDec)) { stop(); setL2ChatWidth(v=>clamp(v-12,260,720)); requestAnimationFrame(measureAll); }
      else if (norm(k) === norm(keymap.chatWidthInc)) { stop(); setL2ChatWidth(v=>clamp(v+12,260,720)); requestAnimationFrame(measureAll); }
      // L3 S2 height +/- (min 120, max 800)
      else if (k === keymap.s2HeightDec) { stop(); setL3S2Height(v=>clamp(v-12,120,800)); requestAnimationFrame(measureAll); }
      else if (k === keymap.s2HeightInc) { stop(); setL3S2Height(v=>clamp(v+12,120,800)); requestAnimationFrame(measureAll); }
      // Border width +/- (min 0, max 12)
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
    setS1(id1); setS2(getYouTubeId(s2Input));
  };
  const addStream2 = () => {
    const v = prompt('Enter Stream 2 URL or ID:'); if (!v) return;
    const id = getYouTubeId(v); if (id) { setS2(id); setS2Input(id); } else alert('Invalid link or ID.');
  };
  const [toastMsg, setToastMsg] = useState('');
  function toast(t){ setToastMsg(t); setTimeout(()=>setToastMsg(''),1600); }
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
    setPip(DEFAULT_PIP);
    setSwap(false);
    setFocus('both');
    requestAnimationFrame(measureAll);
    toast('Layout reset');
  };
  const resetKeymap = () => {
    setKeymap({ ...DEFAULT_KEYMAP });
    toast('Keybinds reset');
  };

  /* ---- Chat visibility ---- */
  let showChat1 = false, showChat2 = false;
  if (layout === 2) {
    const leftId = swap ? s2 : s1;
    showChat1 = !!(leftId && leftId === s1);
    showChat2 = !!(leftId && leftId === s2);
  } else if (layout === 3) {
    showChat1 = chatTab === 1;
    showChat2 = chatTab === 2;
  }

  /* ---- Global border width: disabled on L1 and L6 ---- */
  const globalBorderW = (layout === 1 || layout === 6) ? 0 : frameW;

  /* ---- Helpers for chat pop-out ---- */
  const chatPopoutUrl = (id) => id ? `https://www.youtube.com/live_chat?v=${id}&is_popout=1` : null;

  /* ---- Render ---- */
  return (
    <div className="App">
      {!s1 && (
        <div className="landing">
          <div className="landing-card">
            <h1 className="headline">Multi‑Stream Player <span className="headline-accent">Pro</span></h1>
            <p className="sub">Seamless layouts, accurate sizing, smooth PIP, and hotkeys.</p>

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
            '--frame-w': `${globalBorderW}px`,
            '--frame-color': frameColor,
            backgroundImage: bgUrl ? `url(${bgUrl})` : undefined
          }}
        >
          {/* Players (never remount) */}
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

          {/* Overlays: title (first), then metrics */}
          <div className="metrics-layer">
            {vis1 && tgt1 && showTitles && info1.title && (
              <div className="title-badge" style={{ left: tgt1.left + 10, top: tgt1.top + 10 }}>
                {info1.title}
              </div>
            )}
            {vis1 && tgt1 && showMetrics && (info1.viewers !== null || info1.likes !== null) && (
              <div className="metric-badge" style={{ left: tgt1.left + 10, top: tgt1.top + (showTitles && info1.title ? 44 : 10) }}>
                {info1.viewers !== null && <span>👀 {info1.viewers.toLocaleString()}</span>}
                {info1.likes !== null && <span>👍 {info1.likes.toLocaleString()}</span>}
              </div>
            )}

            {vis2 && tgt2 && showTitles && info2.title && (
              <div className="title-badge" style={{ left: tgt2.left + 10, top: tgt2.top + 10 }}>
                {info2.title}
              </div>
            )}
            {vis2 && tgt2 && showMetrics && (info2.viewers !== null || info2.likes !== null) && (
              <div className="metric-badge" style={{ left: tgt2.left + 10, top: tgt2.top + (showTitles && info2.title ? 44 : 10) }}>
                {info2.viewers !== null && <span>👀 {info2.viewers.toLocaleString()}</span>}
                {info2.likes !== null && <span>👍 {info2.likes.toLocaleString()}</span>}
              </div>
            )}
          </div>

          {/* UI slots + chat + controls */}
          <div className="ui-layer">
            {/* Interaction shield during PIP drag/resize */}
            <div className={`interaction-shield ${shield.active ? 'show' : ''}`} style={{ cursor: shield.cursor }} />

            {/* --- Layout content (slots) --- */}
            {(() => {
              switch (layout) {
                case 1:
                  return (<div className="layout layout-1"><div className="slot slot-s1" ref={slotS1} /></div>);
                case 2: {
                  const leftId = swap ? s2 : s1;
                  const leftPopout = chatPopoutUrl(leftId);
                  return (
                    <div className="layout layout-2" style={{ gridTemplateColumns:`1fr 8px ${l2ChatWidth}px` }}>
                      <div className="slot slot-s1" ref={slotS1} />
                      <div /> {/* spacer */}
                      <div className="chat-panel">
                        <div className="chat-toolbar">
                          <button
                            className="btn"
                            onClick={() => leftPopout && window.open(leftPopout, '_blank', 'noopener,noreferrer')}
                            disabled={!leftPopout}
                            title="Open YouTube Pop‑out Chat (sign‑in & chat)"
                            style={{ pointerEvents:'auto' }}
                          >Pop‑out Chat</button>
                        </div>
                        <div className="chat-slot" ref={chatSlot} />
                      </div>
                    </div>
                  );
                }
                case 3: {
                  const activeId = (chatTab === 1 ? s1 : s2);
                  const activePopout = chatPopoutUrl(activeId);
                  return (
                    <div className="layout layout-3">
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
                          <div className="chat-toolbar">
                            <button
                              className="btn"
                              onClick={() => activePopout && window.open(activePopout, '_blank', 'noopener,noreferrer')}
                              disabled={!activePopout}
                              title="Open YouTube Pop‑out Chat (sign‑in & chat)"
                              style={{ pointerEvents:'auto' }}
                            >Pop‑out Chat</button>
                          </div>
                          <div className="chat-slot" ref={chatSlot} />
                        </div>
                      </div>
                    </div>
                  );
                }
                case 4:
                  return (
                    <div className="layout layout-4">
                      <div className="slot slot-s1" ref={slotS1} />
                      <Rnd
                        size={{ width: pip.width, height: pip.height }}
                        position={{ x: pip.x, y: pip.y }}
                        bounds=".stage"
                        minWidth={220}
                        minHeight={124}
                        dragHandleClassName="pip-drag-handle"
                        enableResizing={{ top:true, right:true, bottom:true, left:true, topRight:true, bottomRight:true, bottomLeft:true, topLeft:true }}
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
                        className="pip-overlay"
                      >
                        <div className="pip-box">
                          <div className="pip-drag-handle" title="Drag PIP">⋮⋮ Drag</div>
                          {/* note: box ignores pointer events; handle & resize grips work; clicks go to iframe */}
                        </div>
                      </Rnd>
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

            {/* Chat (mounted once) */}
            <div className="chat-layer">
              {chat1Src && (
                <iframe
                  className={`chat-frame-abs ${showChat1?'show':'hide'}`}
                  title="Stream 1 Chat"
                  src={chat1Src}
                  allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
                  style={styleFromRect(rectChat, lastChat, true)}
                />
              )}
              {chat2Src && (
                <iframe
                  className={`chat-frame-abs ${showChat2?'show':'hide'}`}
                  title="Stream 2 Chat"
                  src={chat2Src}
                  allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
                  style={styleFromRect(rectChat, lastChat, true)}
                />
              )}
            </div>

            {/* Top center: layout buttons (auto-hide) */}
            <div className={`layout-menu ${menuVisible ? 'visible' : ''}`}>
              {[1,2,3,4,5,6].map(n=>(
                <button key={n} onClick={()=>setLayout(n)} className={layout===n?'active':''}>{n}</button>
              ))}
              <button onClick={()=>setSwap(v=>!v)} title="Swap streams">Swap (Q)</button>
              <button onClick={resetLayout} title="Reset splits & PIP">Reset</button>
            </div>

            {/* Top-right: Settings (auto-hide like layout menu) */}
            <div className={`top-right-actions ${menuVisible ? 'visible' : ''}`}>
              <button className="action-btn" onClick={()=>setShowSettings(true)}>Settings ⚙️</button>
            </div>
          </div>

          {!!toastMsg && <div className="toast">{toastMsg}</div>}
        </div>
      )}

      {/* Settings (all‑in‑one) */}
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
            setS1(id1); setS2(id2 || null); setShowSettings(false);
          }}
          clearToLanding={clearToLanding}
          // layout sizes
          l2ChatWidth={l2ChatWidth} setL2ChatWidth={(v)=>{ setL2ChatWidth(v); requestAnimationFrame(measureAll); }}
          l3S2Height={l3S2Height} setL3S2Height={(v)=>{ setL3S2Height(v); requestAnimationFrame(measureAll); }}
          // appearance
          frameW={frameW} setFrameW={setFrameW}
          frameColor={frameColor} setFrameColor={setFrameColor}
          bgUrl={bgUrl} setBgUrl={setBgUrl}
          // overlays
          showMetrics={showMetrics} setShowMetrics={setShowMetrics}
          showTitles={showTitles} setShowTitles={setShowTitles}
          // keymap
          keymap={keymap} setKeymap={setKeymap} resetKeymap={resetKeymap}
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
    l2ChatWidth, setL2ChatWidth, l3S2Height, setL3S2Height,
    // appearance
    frameW, setFrameW, frameColor, setFrameColor, bgUrl, setBgUrl,
    // overlays
    showMetrics, setShowMetrics, showTitles, setShowTitles,
    // keymap
    keymap, setKeymap, resetKeymap,
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
              <button className="btn" onClick={()=>setBgUrl('')}>Use Gradient</button>
            </div>
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
                ['nudgeBack','Seek −10s'],['nudgeForward','Seek +10s'],['toggleChat','Toggle Chat (Layout 3)'],
                ['toggleInfo','Toggle Titles + Metrics'],['chatWidthDec','Chat width −'],['chatWidthInc','Chat width +'],
                ['s2HeightDec','S2 height −'],['s2HeightInc','S2 height +'],['borderDec','Border −'],['borderInc','Border +'],
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
