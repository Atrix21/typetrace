#!/usr/bin/env python3
"""Experiment 3: check that stage-1 S reproduces experiment 1's frozen per-task metrics exactly (same tasks, methods,
budget), and that hybrid_nograph equals experiment 1's `no_graph_at_all` ablation. Writes manifests/s-reproduction.json."""
import json
EXP = 'experiments/03-graph-scale'
new = {}
for l in open(f'{EXP}/results/stage1-S/metrics.jsonl'):
    r = json.loads(l)
    new[(r['task_id'], r['method'])] = r
def frozen(path):
    d = json.load(open(path))
    rows = d if isinstance(d, list) else d.get('metrics') or [m for run in d.get('runs', []) for m in run.get('metrics', [])]
    return rows
keys = ['sym_recall_5', 'sym_recall_10', 'sym_precision_5', 'sym_precision_10', 'rc_mrr', 'file_recall_10', 'native_context_tokens', 'tokens_to_root_cause']
out = {'checks': {}}
for src, mapping in [('evaluation/results/final-test/metrics.json', {m: m for m in ['ripgrep', 'bm25', 'embeddings', 'custom_graph', 'hybrid']}),
                     ('evaluation/results/ablation-test/metrics.json', {'no_graph_at_all': 'hybrid_nograph'})]:
    d = json.load(open(src))
    by = {}
    for fm in d['per_task']:
        by.setdefault(fm['method'], []).append(fm)
    for m, fms in by.items():
        if m not in mapping:
            continue
        same = diff = 0; mism = []
        for fm in fms:
            r = new.get((fm['task_id'], mapping[m]))
            if not r:
                continue
            ok = all((fm.get(k) == r.get(k)) or (isinstance(fm.get(k), float) and isinstance(r.get(k), float) and abs(fm[k] - r[k]) < 1e-9) for k in keys)
            same += ok; diff += not ok
            if not ok: mism.append({'task': fm['task_id'], **{k: [fm.get(k), r.get(k)] for k in keys if fm.get(k) != r.get(k)}})
        out['checks'][f'{m} -> {mapping[m]}'] = {'identical_tasks': same, 'different_tasks': diff, 'mismatches': mism[:5]}
json.dump(out, open(f'{EXP}/manifests/s-reproduction.json', 'w'), indent=1)
for k, v in out['checks'].items(): print(k, v['identical_tasks'], 'identical,', v['different_tasks'], 'different', v['mismatches'][:1])
