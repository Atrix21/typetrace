#!/usr/bin/env python3
"""
Amendment D2: retrieval-only head-to-head. Merges competitor rows (results/h2h-<repo>/metrics.jsonl) with our stage-1 rows
(results/stage1-<repo>/metrics.jsonl) on the FULL corpus, restricted to tasks present for every method, and reports per repo:
mean metrics, paired differences of ours vs each competitor (task-level bootstrap CI, one-sided sign-flip p).

  python3 scripts/exp3/analyse-h2h.py            -> experiments/03-graph-scale/results/h2h-report.md / .json
"""
import json, os, random, statistics
from collections import defaultdict

R = 'experiments/03-graph-scale/results'
OURS = ['hybrid', 'compact_graph', 'custom_graph', 'hybrid_nograph', 'bm25', 'embeddings', 'ripgrep']
COMP = ['graphify', 'code_review_graph', 'code_review_graph_emb', 'code_review_graph_qwen']
LABEL = {'hybrid': 'ours: hybrid (BM25 + embeddings + graph)', 'compact_graph': 'ours: compact_graph (the agent tool)', 'custom_graph': 'ours: graph only',
         'hybrid_nograph': 'ours: hybrid without graph', 'bm25': 'BM25', 'embeddings': 'embeddings (Qwen3-0.6B)', 'ripgrep': 'ripgrep',
         'graphify': 'graphify 0.9.108', 'code_review_graph': 'code-review-graph 2.4.0 (default, FTS)', 'code_review_graph_emb': 'code-review-graph 2.4.0 + embeddings', 'code_review_graph_qwen': 'code-review-graph 2.4.0 + OUR embedder (Qwen3)'}
METRICS = [('sym_recall_10', 'Recall@10'), ('sym_recall_5', 'Recall@5'), ('rc_mrr', 'RC MRR'), ('rc_hit_10', 'RC hit@10'), ('file_recall_10', 'File R@10'),
           ('natural_recall', 'Recall (own output)'), ('native_context_tokens', 'own output tokens'), ('latency_ms', 'latency ms')]
B, SEED = 10000, 20261114
SPLIT = {'S': None, 'M': 'test', 'L': 'test'}


def boot(d):
    r = random.Random(SEED); n = len(d)
    ms = sorted(statistics.fmean(r.choices(d, k=n)) for _ in range(B))
    return ms[int(.025 * B)], ms[int(.975 * B) - 1]


def perm(d):
    obs = statistics.fmean(d); r = random.Random(SEED); c = 0
    for _ in range(20000):
        c += statistics.fmean([x if r.random() < .5 else -x for x in d]) >= obs - 1e-12
    return (c + 1) / 20001


def load(path):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path) if l.strip()]


def main():
    md = ['# Retrieval head-to-head (Amendment D2): ours vs graphify vs code-review-graph\n',
          'Same tasks, snapshots, budget (50 results / 8k tokens) and scoring for every method; no model calls. Symbol-level metrics against frozen ground truth. '
          'Paired differences are ours − competitor over tasks (95% bootstrap CI; one-sided sign-flip p for ours > competitor).\n']
    out = {}
    for repo in ['S', 'M', 'L']:
        rows = [r for r in load(f'{R}/stage1-{repo}/metrics.jsonl') + load(f'{R}/h2h-{repo}/metrics.jsonl') if r.get('corpus', 'full') == 'full']
        if SPLIT[repo]:
            rows = [r for r in rows if r.get('split') == SPLIT[repo]]
        by = defaultdict(dict)
        for r in rows:
            by[r['method']][r['task_id']] = r
        comps = [m for m in COMP if by.get(m)]
        if not comps:
            continue
        methods = [m for m in OURS + COMP if by.get(m) and (m != 'code_review_graph_qwen' or len(by[m]) >= len(by['hybrid']))]
        tasks = sorted(set.intersection(*(set(by[m]) for m in methods)))
        if not tasks:
            continue
        md.append(f'\n## {repo}: {len(tasks)} tasks{" (" + SPLIT[repo] + " split)" if SPLIT[repo] else ""}\n')
        md.append('| Method | ' + ' | '.join(h for _, h in METRICS) + ' |')
        md.append('|---|' + '---:|' * len(METRICS))
        res = {'tasks': len(tasks), 'means': {}, 'paired': {}}
        for m in methods:
            means = {}
            for k, _ in METRICS:
                xs = [by[m][t].get(k) for t in tasks if by[m][t].get(k) is not None]
                means[k] = statistics.fmean(xs) if xs else None
            res['means'][m] = means
            f = lambda k, d=2: '—' if means[k] is None else (f'{means[k]:,.0f}' if k in ('native_context_tokens', 'latency_ms') else f'{means[k]:.{d}f}')
            md.append(f'| {LABEL[m]} | ' + ' | '.join(f(k) for k, _ in METRICS) + ' |')
        md.append('\n| Ours | vs | metric | mean Δ | 95% CI | W/L/T | p |')
        md.append('|---|---|---|---:|---|---|---:|')
        for o in ['hybrid', 'compact_graph']:
            if o not in by:
                continue
            for c in [c for c in comps if c in methods]:
                for k in ['sym_recall_10', 'rc_mrr']:
                    d = [(by[o][t][k] or 0) - (by[c][t][k] or 0) for t in tasks]
                    ci, p = boot(d), perm(d)
                    w, l = sum(x > 1e-9 for x in d), sum(x < -1e-9 for x in d)
                    res['paired'][f'{o}-{c}|{k}'] = {'mean': statistics.fmean(d), 'ci': ci, 'p': p, 'w': w, 'l': l}
                    md.append(f'| {o} | {LABEL[c]} | {k} | {statistics.fmean(d):+.3f} | [{ci[0]:+.3f}, {ci[1]:+.3f}] | {w}/{l}/{len(d) - w - l} | {p:.4f} |')
        out[repo] = res
    json.dump(out, open(f'{R}/h2h-report.json', 'w'), indent=1)
    open(f'{R}/h2h-report.md', 'w').write('\n'.join(md) + '\n')
    print('\n'.join(md))


if __name__ == '__main__':
    main()
