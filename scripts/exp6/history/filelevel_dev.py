#!/usr/bin/env python3
"""DEV split only. (1) File recall of whole-file BM25 vs the stored methods. (2) Re-score each stored top-50 list with
file-level BM25 evidence: final = score/max + lam * fileBM25/max. Pinned tree (bug tasks: the fix is present; quick look only)."""
import sys, os, json
from hist_lib import *
from silver_eval import BM25, tokenize

split = sys.argv[1] if len(sys.argv) > 1 else 'dev'
for repo in ['immich', 'twenty']:
    R = REPOS[repo]
    src_root = f"{ROOT}/targets/exp3/{'immich/server' if repo == 'immich' else 'twenty/packages/twenty-server'}"
    files = []
    for dp, dn, fn in os.walk(src_root + '/src'):
        for f in fn:
            if f.endswith('.ts') and not f.endswith('.d.ts'): files.append(os.path.relpath(os.path.join(dp, f), src_root))
    files.sort()
    bm = BM25([tokenize(f + ' ' + open(os.path.join(src_root, f), encoding='utf8', errors='replace').read()) for f in files])
    tasks = [t for t in load_tasks(repo) if t['split'] == split]
    official = {}
    for l in open(R['stage1'] + '/metrics.jsonl'):
        d = json.loads(l)
        if d['corpus'] == 'full': official[(d['task_id'], d['method'])] = d
    fs = {}
    for t in tasks:
        sc = bm.scores(tokenize(t['description']))
        mx = max(sc.values(), default=1) or 1
        fs[t['task_id']] = {files[i]: s / mx for i, s in sc.items()}
    def frec(t, k):
        order = sorted(fs[t['task_id']].items(), key=lambda kv: (-kv[1], kv[0]))[:k]
        rel = set(t['relevant_files']); return len(rel & {f for f, _ in order}) / len(rel)
    bug = [t for t in tasks if t['task_type'] == 'bug_localisation']; oth = [t for t in tasks if t['task_type'] != 'bug_localisation']
    mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
    print(f'\n=== {repo} {split}: {len(bug)} bug, {len(oth)} other tasks, {len(files)} files')
    print('file recall@10   whole-file BM25: bug %.3f other %.3f all %.3f | @50: all %.3f' % (mean([frec(t, 10) for t in bug]), mean([frec(t, 10) for t in oth]), mean([frec(t, 10) for t in tasks]), mean([frec(t, 50) for t in tasks])))
    for m in ['bm25', 'embeddings', 'hybrid_nograph', 'hybrid', 'compact_graph']:
        print(f'file recall@10   stored {m:15s}: bug %.3f other %.3f all %.3f' % tuple(mean([official[(t['task_id'], m)]['file_recall_10'] for t in g]) for g in (bug, oth, tasks)))
    def metrics(keys, t):
        rel, rc = set(t['relevant_symbols']), set(t['root_cause_symbols'])
        uniq = list(dict.fromkeys(keys))
        rank = next((i + 1 for i, k in enumerate(uniq) if k in rc), None)
        fl = list(dict.fromkeys(k.split('::')[0] for k in uniq)); relf = set(t['relevant_files'])
        return (len(rel & set(uniq[:10])) / len(rel), 1 / rank if rank else 0, len(relf & set(fl[:10])) / len(relf))
    for m in ['hybrid', 'hybrid_nograph', 'embeddings', 'bm25']:
        raw = {}
        for l in open(R['stage1'] + f'/raw/{m}.jsonl'):
            d = json.loads(l)
            if d['corpus'] == 'full': raw[d['task_id']] = d['results']
        print(f'-- rerank stored top-50 of {m}:  lam: symR@10 (bug/other/all)  rcMRR(bug)  fileR@10(all)')
        for lam in (0, 0.25, 0.5, 1.0, 2.0):
            rows = {}
            for t in tasks:
                res = raw[t['task_id']]; n = len(res)
                sc = [r['score'] if r.get('score') is not None else (n - i) / n for i, r in enumerate(res)]
                mx = max(sc) or 1
                f = fs[t['task_id']]
                order = sorted(range(n), key=lambda i: (-(sc[i] / mx + lam * f.get(res[i]['file'], 0)), i))
                rows[t['task_id']] = metrics([f"{res[i]['file']}::{res[i]['symbol']}" for i in order], t)
            g = lambda ts, k: mean([rows[t['task_id']][k] for t in ts])
            print(f'   lam {lam:4.2f}: {g(bug,0):.3f} / {g(oth,0):.3f} / {g(tasks,0):.3f}   {g(bug,1):.3f}   {g(tasks,2):.3f}')
