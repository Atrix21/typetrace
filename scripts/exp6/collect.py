#!/usr/bin/env python3
"""Experiment 6: collect the aggregated numbers of every run under .cache/exp6 into
experiments/06-next-direction/results/summary.json (task ids and metrics only; no source code)."""
import json, os, random, statistics as st
R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
C = R + '/.cache/exp6/'
def rows(d): return [json.loads(l) for l in open(C + d + '/rows.jsonl')] if os.path.exists(C + d + '/rows.jsonl') else []
def paired(rs, ref='frozen', metric='sym_recall_10', seed=7):
    by = {}
    for r in rs: by.setdefault(r['variant'], {})[r['task_id']] = r
    out = {}; rng = random.Random(seed)
    for v, m in by.items():
        ids = sorted(set(m) & set(by[ref])); d = [(m[t][metric] or 0) - (by[ref][t][metric] or 0) for t in ids]; md = sum(d) / len(d)
        p = sum(abs(sum(x if rng.random() < .5 else -x for x in d) / len(d)) >= abs(md) - 1e-12 for _ in range(10000)) / 10000
        out[v] = {'n': len(ids), 'mean': round(sum(m[t][metric] or 0 for t in ids) / len(ids), 4), 'diff_vs_frozen': round(md, 4), 'wins': sum(x > 1e-9 for x in d), 'losses': sum(x < -1e-9 for x in d), 'p_two_sided': p}
    return out
S = {}
# 1. lean engine vs stored stage-1 hybrid output
S['lean_reproduction'] = {}
for repo, stored_ms in (('S', 84), ('M', 589), ('L', 11959)):
    fr = [r for r in rows('check-' + repo) if r['variant'] == 'frozen']
    S['lean_reproduction'][repo] = {'tasks': len(fr), 'ranking_identical_to_stored': sum(r['same_prefix'] == r['stored_n'] for r in fr), 'recall10_equal': sum(bool(r['r10_equal']) for r in fr),
                                    'median_query_ms': st.median(r['query_ms'] for r in fr), 'stored_hybrid_median_ms_h2h_report': stored_ms}
# 2. product path before / after
S['product_path'] = {}
for name in ('bench-M-before', 'bench-M-after1', 'bench-L-after-compact_graph', 'bench-L-after-hybrid'):
    f = C + name + '.json'
    if os.path.exists(f):
        d = json.load(open(f))
        S['product_path'][name] = {m: {k: v[k] for k in ('prepare_ms', 'median_ms', 'max_ms', 'stored_median_ms', 'identical')} | {'tasks': len(v['rows'])} for m, v in d['methods'].items()} | {'rss_mb': d['rss_mb']}
# 3. ranking variants
dev = rows('dev1-S') + rows('dev1-M') + rows('dev1-L'); silver = rows('silver1-M') + rows('silver1-L')
S['variants_dev23'] = {m: paired(dev, metric=m) for m in ('sym_recall_10', 'rc_mrr')}
S['variants_silver127'] = {m: paired(silver, metric=m) for m in ('sym_recall_10', 'rc_mrr')}
S['graph_context_embeddings_silver_M67'] = {m: paired(rows('silver2-M'), metric=m) for m in ('sym_recall_10', 'rc_mrr')}
json.dump(S, open(R + '/experiments/06-next-direction/results/summary.json', 'w'), indent=1)
print(json.dumps(S['lean_reproduction'], indent=1)); print(json.dumps(S['product_path'], indent=1))
