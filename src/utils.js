// src/utils.js
export function getYouTubeId(input) {
  if (!input) return null;
  const url = String(input).trim();
  // If it's exactly 11 chars, probably an ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

  const m =
    url.match(/(?:youtu\.be\/|v=|\/embed\/|shorts\/)([a-zA-Z0-9_-]{11})/) ||
    url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
