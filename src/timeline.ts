import type { Caption, Project, Zoom } from './types';
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const timecode = (n: number) => `${Math.floor(Math.max(0, n) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60).toString().padStart(2, '0')}`;
export function visibleSegments(p: Project) {
  const cuts = [...p.cuts].sort((a, b) => a.start - b.start);
  const segments: { start: number; end: number }[] = [];
  let cursor = p.trimStart;
  for (const c of cuts) {
    if (c.end <= cursor || c.start >= p.trimEnd) continue;
    if (c.start > cursor) segments.push({ start: cursor, end: Math.min(c.start, p.trimEnd) });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < p.trimEnd) segments.push({ start: cursor, end: p.trimEnd });
  return segments;
}
export function outputDuration(p: Project) { return visibleSegments(p).reduce((n, s) => n + s.end - s.start, 0) / p.settings.speed; }
export function sourceTime(p: Project, outputTime: number) {
  let remaining = Math.max(0, outputTime) * p.settings.speed;
  for (const s of visibleSegments(p)) {
    if (remaining < s.end - s.start) return s.start + remaining;
    remaining -= s.end - s.start;
  }
  return p.trimEnd;
}
export function zoomAt(zooms: Zoom[], t: number) {
  const z = zooms.find(z => t >= z.start && t <= z.end);
  if (!z) return { scale: 1, x: .5, y: .5 };
  const edge = Math.min(.65, (z.end - z.start) / 3);
  const v = clamp(Math.min((t - z.start) / edge, (z.end - t) / edge), 0, 1);
  const smooth = v * v * (3 - 2 * v);
  return { scale: 1 + (z.scale - 1) * smooth, x: z.x, y: z.y };
}
export function autoZooms(p: Project): Zoom[] {
  if (!p.settings.autoZoom) return p.zooms;
  const generated: Zoom[] = [];
  const clicks = p.demo ? [{ t: 5, x: .66, y: .4 }, { t: 14, x: .4, y: .6 }] : p.points.filter(pt => pt.click);
  for (const pt of clicks) {
    if (generated.some(z => pt.t < z.end + .6) || p.zooms.some(z => pt.t >= z.start - 1 && pt.t <= z.end + 1)) continue;
    generated.push({ id: `auto-${pt.t}`, start: Math.max(0, pt.t - .7), end: Math.min(p.duration, pt.t + 3.5), x: pt.x, y: pt.y, scale: p.settings.zoomStrength });
  }
  return [...p.zooms, ...generated].sort((a, b) => a.start - b.start);
}
export function parseSrt(text: string): Caption[] {
  const stamp = (s: string) => { const parts = s.trim().replace(',', '.').split(':').map(Number); return parts.reduce((a, b) => a * 60 + b, 0); };
  return text.replace(/\r/g, '').split(/\n\s*\n/).flatMap((block, i) => {
    const lines = block.trim().split('\n');
    const index = lines.findIndex(l => l.includes('-->'));
    if (index < 0) return [];
    const [a, b] = lines[index].split('-->');
    const start = stamp(a), end = stamp(b.trim().split(/\s/)[0]);
    const value = lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '');
    return Number.isFinite(start) && Number.isFinite(end) && end > start && value ? [{ id: `caption-${i}-${Date.now()}`, start, end, text: value }] : [];
  });
}
