#!/usr/bin/env python3
"""
Experiment 5, exploratory (not pre-registered): does the Python graph's effect on Recall@10 (hybrid - hybrid_nograph)
depend on how its call edges were resolved? Uses the per-snapshot resolution counts in graphs.jsonl.
  python3 scripts/swebench/explore_graph_precision.py [results-dir]
"""
import collections, json, re, statistics, sys

D = sys.argv[1] if len(sys.argv) > 1 else 'experiments/05-swebench-python/results'
g = {}
for l in open(f'{D}/graphs.jsonl'):
    r = json.loads(l)
    m = re.search(r'(\d+) resolved syntactically, (\d+) name-inferred.*?, (\d+) unresolved', ' '.join(r['notes']))
    if m and r['task_id'] not in g:
        a, b, c = map(int, m.groups())
        g[r['task_id']] = (b / (a + b), (a + b) / (a + b + c))  # inferred share of linked calls; linked share of all calls
by = collections.defaultdict(dict)
for l in open(f'{D}/metrics.jsonl'):
    r = json.loads(l)
    by[r['method']].setdefault(r['task_id'], r)
rows = [(by['hybrid'][t]['repo'], inf, res, by['hybrid'][t]['sym_recall_10'] - by['hybrid_nograph'][t]['sym_recall_10']) for t, (inf, res) in g.items()]


def spearman(x, y):
    rank = lambda a: [sorted(a).index(v) for v in a]
    rx, ry = rank(x), rank(y)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    return num / (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** .5


print(f"{'repository':28s}   n  name-inferred share  resolved share  graph effect")
rep = collections.defaultdict(list)
for r in rows:
    rep[r[0]].append(r)
for k, v in sorted(rep.items(), key=lambda kv: -len(kv[1])):
    print(f'{k:28s} {len(v):3d}  {statistics.fmean(x[1] for x in v):19.2f}  {statistics.fmean(x[2] for x in v):14.2f}  {statistics.fmean(x[3] for x in v):+12.3f}')
nz = [r for r in rows if abs(r[3]) > 1e-9]
print(f'\ninstances where the graph changed Recall@10: {len(nz)}')
print(f'Spearman(name-inferred share, effect) = {spearman([r[1] for r in nz], [r[3] for r in nz]):+.2f}')
print(f'Spearman(resolved share, effect)      = {spearman([r[2] for r in nz], [r[3] for r in nz]):+.2f}')
