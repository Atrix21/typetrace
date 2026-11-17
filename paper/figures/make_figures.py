#!/usr/bin/env python3
"""
Paper figures as static SVG (no plotting library needed). Every value is copied from a committed result file,
named next to each data block.   python3 paper/figures/make_figures.py  -> paper/figures/*.svg

Colours follow the entity in every figure (palette validated for colour-vision deficiency; values are printed on
the bars because three of the five hues are below 3:1 contrast against the background).
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
INK, INK2, MUTED, GRID, SURF = '#1f1f1d', '#55554f', '#8a8a82', '#e4e3df', '#fcfcfb'
C = {'hybrid': '#2a78d6', 'compact': '#eb6834', 'crg_emb': '#1baf7a', 'graphify': '#eda100', 'crg': '#e87ba4', 'grep': '#9a9a93'}
NAME = {'hybrid': 'TypeTrace (hybrid)', 'compact': 'TypeTrace (agent tool, ≤800 tok)', 'crg_emb': 'code-review-graph + embeddings',
        'graphify': 'graphify', 'crg': 'code-review-graph (default)', 'grep': 'grep / read only'}
FONT = "font-family='Inter, Helvetica, Arial, sans-serif'"


def text(x, y, s, size=12, fill=INK, anchor='start', weight='normal'):
    return f"<text x='{x:.1f}' y='{y:.1f}' {FONT} font-size='{size}' fill='{fill}' text-anchor='{anchor}' font-weight='{weight}'>{s}</text>"


def bar(x, y0, w, h, fill):
    """Vertical bar anchored to the baseline y0, 4px rounded data end."""
    if h <= 0:
        return f"<rect x='{x:.1f}' y='{y0 - 1:.1f}' width='{w:.1f}' height='1' fill='{fill}'/>"
    r = min(4, h / 2, w / 2)
    y = y0 - h
    return (f"<path d='M{x:.1f},{y0:.1f} V{y + r:.1f} Q{x:.1f},{y:.1f} {x + r:.1f},{y:.1f} H{x + w - r:.1f} "
            f"Q{x + w:.1f},{y:.1f} {x + w:.1f},{y + r:.1f} V{y0:.1f} Z' fill='{fill}'/>")


def legend(keys, x, y, width):
    out, cx, cy = [], x, y
    for k in keys:
        w = 22 + len(NAME[k]) * 6.4
        if cx + w > x + width:
            cx, cy = x, cy + 20
        out.append(f"<rect x='{cx:.1f}' y='{cy - 9:.1f}' width='12' height='12' rx='3' fill='{C[k]}'/>")
        out.append(text(cx + 17, cy + 1, NAME[k], 12, INK2))
        cx += w + 14
    return out, cy


def grouped(fname, title, subtitle, groups, keys, data, ymax, fmt, yticks, ylabel):
    W, H = 900, 430
    L, R, T, B = 64, 16, 92, 64
    out = [f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {W} {H}' width='{W}' height='{H}'>",
           f"<rect width='{W}' height='{H}' fill='{SURF}'/>", text(L, 28, title, 16, INK, weight='600'), text(L, 48, subtitle, 12, INK2)]
    leg, ly = legend(keys, L, 72, W - L - R)
    out += leg
    T = ly + 22
    ph, pw = H - T - B, W - L - R
    y = lambda v: T + ph - v / ymax * ph
    for t in yticks:
        out.append(f"<line x1='{L}' x2='{W - R}' y1='{y(t):.1f}' y2='{y(t):.1f}' stroke='{GRID}' stroke-width='1'/>")
        out.append(text(L - 8, y(t) + 4, fmt(t, axis=True), 11, MUTED, 'end'))
    out.append(text(16, T + ph / 2, ylabel, 11, MUTED, 'middle').replace('<text', f"<text transform='rotate(-90 16 {T + ph / 2:.1f})'"))
    gw = pw / len(groups)
    bw = min(34, (gw - 36) / len(keys) - 2)
    for gi, (g, sub) in enumerate(groups):
        x0 = L + gi * gw + (gw - len(keys) * (bw + 2)) / 2
        for ki, k in enumerate(keys):
            v = data[g].get(k)
            if v is None:
                continue
            x = x0 + ki * (bw + 2)
            out.append(bar(x, y(0), bw, y(0) - y(v), C[k]))
            out.append(text(x + bw / 2, y(v) - 5, fmt(v), 10, INK2, 'middle'))
        out.append(text(L + gi * gw + gw / 2, y(0) + 20, g, 12, INK, 'middle', '600'))
        out.append(text(L + gi * gw + gw / 2, y(0) + 36, sub, 11, MUTED, 'middle'))
    out.append(f"<line x1='{L}' x2='{W - R}' y1='{y(0):.1f}' y2='{y(0):.1f}' stroke='{MUTED}' stroke-width='1'/>")
    out.append('</svg>')
    open(os.path.join(OUT, fname), 'w').write('\n'.join(out))


# Figure 1. Recall@10. Sources: experiments/03-graph-scale/results/h2h-report.md (S all 20, M test 26, L test 18);
# experiments/05-swebench-python/results/report.md (SWE-bench Lite, 300).
R = {
    'nestjs-boilerplate': {'hybrid': .69, 'compact': .65, 'crg_emb': .31, 'graphify': .12, 'crg': .18},
    'Immich server': {'hybrid': .48, 'compact': .39, 'crg_emb': .26, 'graphify': .04, 'crg': .03},
    'Twenty server': {'hybrid': .33, 'compact': .28, 'crg_emb': .10, 'graphify': .01, 'crg': .01},
    'SWE-bench Lite': {'hybrid': .469, 'compact': .454, 'crg_emb': .354, 'graphify': .151, 'crg': .127},
}
grouped('fig1-recall.svg', 'Finding the code a task needs: Recall@10',
        'Same tasks, files and budget for every tool; ground truth independent of all tools. Higher is better.',
        [('nestjs-boilerplate', 'TypeScript, 6k lines, 20 tasks'), ('Immich server', 'TypeScript, 63k, 26'),
         ('Twenty server', 'TypeScript, 763k, 18'), ('SWE-bench Lite', 'Python, 300 issues')],
        ['hybrid', 'compact', 'crg_emb', 'graphify', 'crg'], R, 0.8,
        lambda v, axis=False: f'{v:.1f}' if axis else f'{v:.2f}', [0, .2, .4, .6, .8], 'Recall@10')

# Figure 3. Agent tokens per task (thousands). Source: experiments/03-graph-scale/results/agent/h2h-{L,M}-haiku-test-report.md.
T3 = {'Twenty server': {'compact': 453, 'graphify': 521, 'crg_emb': 779, 'grep': 513},
      'Immich server': {'compact': 190, 'graphify': 248, 'crg_emb': 399, 'grep': 235}}
NAME_AGENT = dict(NAME); NAME['compact'] = 'TypeTrace (agent tool)'
grouped('fig3-agent-tokens.svg', 'Tokens per task with a coding agent (Claude Code, Haiku 5.5)',
        'Mean over tasks, 3 repeats each. Task scores: Twenty 0.90 / 0.87 / 0.85 / 0.84, Immich 0.86 / 0.83 / 0.86 / 0.82 (not significantly different).',
        [('Twenty server', '763k lines, 18 tasks'), ('Immich server', '63k lines, 26 tasks')],
        ['compact', 'graphify', 'crg_emb', 'grep'], T3, 800,
        lambda v, axis=False: f'{v:.0f}k', [0, 200, 400, 600, 800], 'tokens per task')
NAME.update(NAME_AGENT)


# Figure 2. The graph's own contribution: hybrid minus the identical search without graph propagation, Recall@10,
# with 95% CIs. Sources: research/findings.md (exp 1 ablation), experiments/03-graph-scale/README.md (S, M, L),
# experiments/06-next-direction/findings.md (127 mined fixes; CI not reported there, point only),
# experiments/05-swebench-python/results/report.md (P3).
D = [('nestjs-boilerplate (TS, type-checked graph)', .24, .09, .40),
     ('Immich server (TS, type-checked)', .05, .00, .12),
     ('Twenty server (TS, type-checked)', .16, .07, .25),
     ('127 mined fixes, Immich + Twenty (dev data)', .075, None, None),
     ('SWE-bench Lite (Python, syntactic graph)', -.018, -.055, .019)]
W, H, L, R2, T = 900, 330, 330, 30, 70
pw = W - L - R2
x = lambda v: L + (v + .1) / .55 * pw
out = [f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {W} {H}' width='{W}' height='{H}'>", f"<rect width='{W}' height='{H}' fill='{SURF}'/>",
       text(16, 28, 'What the call graph adds: Recall@10 with graph propagation minus without', 16, INK, weight='600'),
       text(16, 48, 'Same search otherwise identical. Lines: 95% bootstrap CI over tasks (none published for the mined fixes). Right of zero: the graph helps.', 12, INK2)]
for t in [-.1, 0, .1, .2, .3, .4]:
    out.append(f"<line x1='{x(t):.1f}' x2='{x(t):.1f}' y1='{T}' y2='{H - 40}' stroke='{MUTED if t == 0 else GRID}' stroke-width='1'/>")
    out.append(text(x(t), H - 22, f'{t:+.1f}' if t else '0', 11, MUTED, 'middle'))
rh = (H - 40 - T) / len(D)
for i, (lab, m, lo, hi) in enumerate(D):
    cy = T + rh * (i + .5)
    out.append(text(L - 14, cy + 4, lab, 12, INK, 'end'))
    if lo is not None:
        out.append(f"<line x1='{x(lo):.1f}' x2='{x(hi):.1f}' y1='{cy:.1f}' y2='{cy:.1f}' stroke='{C['hybrid']}' stroke-width='2'/>")
    out.append(f"<circle cx='{x(m):.1f}' cy='{cy:.1f}' r='5' fill='{C['hybrid']}' stroke='{SURF}' stroke-width='2'/>")
    out.append(text(x(hi if hi is not None else m) + 10, cy + 4, f'{m:+.3f}' if abs(m) < .1 and m != .05 else f'{m:+.2f}', 11, INK2))
out.append('</svg>')
open(os.path.join(OUT, 'fig2-graph-effect.svg'), 'w').write('\n'.join(out))
print('written:', sorted(f for f in os.listdir(OUT) if f.endswith('.svg')))
