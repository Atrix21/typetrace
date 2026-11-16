#!/usr/bin/env python3
"""Summarise experiment-6 rows: per repository and task family, mean metric per variant and paired difference vs a reference."""
import json, sys, random
from collections import defaultdict
dirs = sys.argv[1].split(','); split = sys.argv[2]; ref = sys.argv[3] if len(sys.argv) > 3 else 'frozen'; metric = sys.argv[4] if len(sys.argv) > 4 else 'sym_recall_10'
rows = []
for d in dirs:
    for l in open(d + '/rows.jsonl'):
        r = json.loads(l)
        if split == 'all' or r['split'] == split: rows.append(r)
by = defaultdict(dict)
for r in rows: by[r['variant']][r['task_id']] = r
variants = list(by)
def grp(sel):
    ids = sorted(t for t, r in by[ref].items() if sel(r))
    return ids
groups = {'S': lambda r: r['repo'] == 'S', 'M bug': lambda r: r['repo'] == 'M' and r['task_type'] == 'bug_localisation', 'M und': lambda r: r['repo'] == 'M' and r['task_type'] != 'bug_localisation',
          'L bug': lambda r: r['repo'] == 'L' and r['task_type'] == 'bug_localisation', 'L und': lambda r: r['repo'] == 'L' and r['task_type'] != 'bug_localisation',
          'M': lambda r: r['repo'] == 'M', 'L': lambda r: r['repo'] == 'L', 'M+L': lambda r: r['repo'] in 'ML', 'ALL': lambda r: True}
G = {g: grp(s) for g, s in groups.items()}; G = {g: ids for g, ids in G.items() if ids}
print(f'metric={metric} split={split} ref={ref}   n: ' + '  '.join(f'{g}={len(i)}' for g, i in G.items()))
print(f'{"variant":26s}' + ''.join(f'{g:>8s}' for g in G) + '   | ALL: d vs ref  W/L/T   p(sign-flip, two-sided)')
rng = random.Random(7)
for v in variants:
    cells = []
    for g, ids in G.items():
        ok = [t for t in ids if t in by[v]]
        cells.append(sum(by[v][t][metric] or 0 for t in ok) / len(ok) if len(ok) == len(ids) else float('nan'))
    ids = [t for t in G['ALL'] if t in by[v]]
    d = [(by[v][t][metric] or 0) - (by[ref][t][metric] or 0) for t in ids]
    w = sum(x > 1e-9 for x in d); l = sum(x < -1e-9 for x in d); md = sum(d) / len(d) if d else 0
    cnt = 0; N = 4000
    for _ in range(N):
        s = sum(x if rng.random() < .5 else -x for x in d) / len(d)
        if abs(s) >= abs(md) - 1e-12: cnt += 1
    print(f'{v:26s}' + ''.join(f'{c:8.3f}' for c in cells) + f'   | {md:+.3f}  {w}/{l}/{len(d)-w-l}  p={cnt/N:.3f}')
