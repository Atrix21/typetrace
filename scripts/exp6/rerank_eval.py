#!/usr/bin/env python3
"""Experiment 6: metrics for reranked candidate lists (no model). Candidate keys are canonical symbol keys.

  python3 scripts/exp6/rerank_eval.py --cands a.jsonl,b.jsonl --scores scores.jsonl [--top 50]
Orders compared: base (the variant's own order), ce (cross-encoder score only), rrf (reciprocal-rank fusion of both)."""
import argparse, json, random
from collections import defaultdict
ap = argparse.ArgumentParser(); ap.add_argument('--cands', required=True); ap.add_argument('--scores', required=True); ap.add_argument('--top', type=int, default=50); ap.add_argument('--k', type=int, default=10)
ap.add_argument('--confirm', action='store_true', help='pre-registered primary test (protocol.md): rrf10 vs base, Recall@10, one-sided')
ap.add_argument('--json')
a = ap.parse_args()
scores = {}
for l in open(a.scores): d = json.loads(l); scores[d['task_id']] = d
tasks = []
for f in a.cands.split(','):
    for l in open(f):
        t = json.loads(l)
        if t['task_id'] in scores: tasks.append(t)
def metrics(keys, t):
    u = list(dict.fromkeys(keys)); rel = set(t['relevant']); rc = set(t['root_cause']); relf = set(t['relevant_files'])
    rank = next((i + 1 for i, k in enumerate(u) if k in rc), None)
    files = list(dict.fromkeys(k.split('::')[0] for k in u))
    return {'r10': len(rel & set(u[:10])) / len(rel), 'r5': len(rel & set(u[:5])) / len(rel), 'mrr': 1 / rank if rank else 0, 'hit10': 1 if rank and rank <= 10 else 0, 'f10': len(relf & set(files[:10])) / len(relf)}
orders = defaultdict(dict)
for t in tasks:
    c = t['cands']; n = min(len(c), a.top); s = scores[t['task_id']]['scores']
    keys = [x['key'] for x in c]
    base = list(range(len(c)))
    ce = sorted(range(n), key=lambda i: (-s[i], i)) + list(range(n, len(c)))
    cer = {i: r for r, i in enumerate(ce)}
    for kk in (10, 60):
        rrf = sorted(range(len(c)), key=lambda i: (-(1 / (kk + i + 1) + 1 / (kk + cer[i] + 1)), i))
        orders[f'rrf{kk}'][t['task_id']] = metrics([keys[i] for i in rrf], t)
    orders['base'][t['task_id']] = metrics([keys[i] for i in base], t)
    orders['ce'][t['task_id']] = metrics([keys[i] for i in ce], t)
groups = {'S': lambda t: t['repo'] == 'S', 'M bug': lambda t: t['repo'] == 'M' and t['task_type'] == 'bug_localisation', 'M und': lambda t: t['repo'] == 'M' and t['task_type'] != 'bug_localisation',
          'L bug': lambda t: t['repo'] == 'L' and t['task_type'] == 'bug_localisation', 'L und': lambda t: t['repo'] == 'L' and t['task_type'] != 'bug_localisation', 'ALL': lambda t: True}
G = {g: [t['task_id'] for t in tasks if s(t)] for g, s in groups.items()}; G = {g: i for g, i in G.items() if i}
rng = random.Random(3)
for met in ('r10', 'mrr', 'f10'):
    print(f'-- {met} (top {a.top} reranked)   n: ' + ' '.join(f'{g}={len(i)}' for g, i in G.items()))
    for o in orders:
        cells = ''.join(f'{sum(orders[o][t][met] for t in ids)/len(ids):8.3f}' for ids in G.values())
        d = [orders[o][t][met] - orders['base'][t][met] for t in G['ALL']]; md = sum(d) / len(d)
        w = sum(x > 1e-9 for x in d); l = sum(x < -1e-9 for x in d)
        cnt = sum(abs(sum(x if rng.random() < .5 else -x for x in d) / len(d)) >= abs(md) - 1e-12 for _ in range(4000))
        print(f'  {o:6s}' + cells + f'   d={md:+.3f} W/L {w}/{l} p={cnt/4000:.3f}')
print('   columns: ' + ' | '.join(G)); print('median seconds per query:', sorted(scores[t['task_id']]['seconds'] for t in tasks)[len(tasks) // 2])

if a.confirm:
    ids = G['ALL']; d = [orders['rrf10'][t]['r10'] - orders['base'][t]['r10'] for t in ids]; n = len(d); md = sum(d) / n
    r = random.Random(20261117)
    ge = sum(sum(x if r.random() < .5 else -x for x in d) / n >= md - 1e-12 for _ in range(20000))
    bs = sorted(sum(d[r.randrange(n)] for _ in range(n)) / n for _ in range(10000))
    res = {'n': n, 'base_r10': sum(orders['base'][t]['r10'] for t in ids) / n, 'rrf10_r10': sum(orders['rrf10'][t]['r10'] for t in ids) / n, 'mean_diff': md, 'ci95': [bs[250], bs[9749]],
           'wins': sum(x > 1e-9 for x in d), 'losses': sum(x < -1e-9 for x in d), 'p_one_sided': ge / 20000}
    print('PRIMARY (pre-registered): ' + json.dumps(res))
    if a.json:
        per = {o: {t: orders[o][t] for t in ids} for o in orders}
        json.dump({'primary': res, 'groups': {g: i for g, i in G.items()}, 'per_task': per, 'seconds': {t: scores[t]['seconds'] for t in ids}}, open(a.json, 'w'), indent=1)
