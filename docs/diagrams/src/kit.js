// Shared drawing kit for the README illustrations: hand-drawn shapes (rough.js) plus handwritten text in one SVG.
// Each diagram page calls draw(k) with this kit; render.sh screenshots the pages to PNG with headless Chrome.
/* global rough */
const C = {
  ink: '#1f2328', ink2: '#52514e', muted: '#898781', paper: '#fcfcfb',
  blue: '#2a78d6', blueFill: '#dbe9fb',
  green: '#1f8a4c', greenFill: '#dcf3e4',
  red: '#c9372c', redFill: '#fbe3e0',
  purple: '#6e56cf', purpleFill: '#ece8fb',
  orange: '#c8640a', orangeFill: '#fdebd3',
  gray: '#898781', grayFill: '#efeee9',
};
const FONT = "'Kalam', 'Comic Sans MS', cursive";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function kit(svg, W, H) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  const rc = rough.svg(svg);
  let seed = 7;
  const nextSeed = () => (seed = (seed * 48271) % 2147483647);
  const add = (n) => (svg.appendChild(n), n);
  const ns = 'http://www.w3.org/2000/svg';

  function text(x, y, str, o = {}) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('font-family', o.mono ? MONO : FONT);
    t.setAttribute('font-size', o.size ?? 22);
    t.setAttribute('font-weight', o.weight ?? 400);
    t.setAttribute('fill', o.color ?? C.ink);
    t.setAttribute('text-anchor', o.anchor ?? 'middle');
    t.setAttribute('dominant-baseline', 'middle');
    t.style.whiteSpace = 'pre';
    const lines = String(str).split('\n');
    lines.forEach((ln, i) => {
      const s = document.createElementNS(ns, 'tspan');
      s.setAttribute('x', x);
      s.setAttribute('dy', i === 0 ? `${-(lines.length - 1) * 0.6}em` : '1.2em');
      s.textContent = ln;
      t.appendChild(s);
    });
    return add(t);
  }
  function box(x, y, w, h, o = {}) {
    add(rc.rectangle(x, y, w, h, {
      stroke: o.stroke ?? C.ink, strokeWidth: o.strokeWidth ?? 2.2, roughness: o.roughness ?? 1.1, bowing: 1.2,
      fill: o.fill, fillStyle: o.fillStyle ?? 'solid', fillWeight: 1.4, hachureGap: 7, seed: nextSeed(),
      strokeLineDash: o.dash,
    }));
    // title in the upper part, subtitle block centred in the rest (multi-line safe)
    const subLines = o.sub ? String(o.sub).split('\n').length : 0;
    const ts = o.titleSize ?? 26, ss = o.subSize ?? 18;
    const block = ts + (subLines ? 10 + subLines * ss * 1.2 : 0);
    const top = y + (h - block) / 2;
    if (o.title) text(x + w / 2, subLines ? top + ts / 2 : y + h / 2, o.title, { size: ts, weight: 700, color: o.titleColor ?? o.stroke ?? C.ink });
    if (o.sub) text(x + w / 2, top + ts + 10 + (subLines * ss * 1.2) / 2, o.sub, { size: ss, color: o.subColor ?? C.ink2, mono: o.subMono });
  }
  function arrow(x1, y1, x2, y2, o = {}) {
    const color = o.color ?? C.ink;
    add(rc.line(x1, y1, x2, y2, { stroke: color, strokeWidth: o.width ?? 2.4, roughness: 0.9, seed: nextSeed(), strokeLineDash: o.dash }));
    const a = Math.atan2(y2 - y1, x2 - x1), L = 15, s = 0.5;
    add(rc.line(x2, y2, x2 - L * Math.cos(a - s), y2 - L * Math.sin(a - s), { stroke: color, strokeWidth: o.width ?? 2.4, roughness: 0.6, seed: nextSeed() }));
    add(rc.line(x2, y2, x2 - L * Math.cos(a + s), y2 - L * Math.sin(a + s), { stroke: color, strokeWidth: o.width ?? 2.4, roughness: 0.6, seed: nextSeed() }));
    if (o.label) text(o.lx ?? (x1 + x2) / 2, o.ly ?? (y1 + y2) / 2 - 16, o.label, { size: o.labelSize ?? 17, color: o.labelColor ?? color });
  }
  function line(x1, y1, x2, y2, o = {}) {
    add(rc.line(x1, y1, x2, y2, { stroke: o.color ?? C.muted, strokeWidth: o.width ?? 1.6, roughness: o.roughness ?? 0.8, seed: nextSeed(), strokeLineDash: o.dash }));
  }
  function ellipse(cx, cy, w, h, o = {}) {
    add(rc.ellipse(cx, cy, w, h, { stroke: o.stroke ?? C.ink, strokeWidth: o.strokeWidth ?? 2, roughness: 1, fill: o.fill, fillStyle: o.fillStyle ?? 'solid', seed: nextSeed() }));
    if (o.title) text(cx, cy, o.title, { size: o.size ?? 20, weight: 700, color: o.titleColor ?? o.stroke ?? C.ink });
  }
  // clean (non-rough) bar for charts: exact length matters more than charm
  function bar(x, y, w, h, color) {
    const r = document.createElementNS(ns, 'rect');
    Object.entries({ x, y, width: Math.max(w, 2), height: h, rx: 4, fill: color }).forEach(([k, v]) => r.setAttribute(k, v));
    return add(r);
  }
  return { rc, text, box, arrow, line, ellipse, bar, C };
}

window.C = C;
window.kit = kit;
