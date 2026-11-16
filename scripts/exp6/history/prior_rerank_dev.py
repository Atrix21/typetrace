#!/usr/bin/env python3
"""Offline check on the DEV split: re-score the stored top-50 of a method with a file-level history prior.
final = score * LR(percentile(file))**beta. No retrieval is re-run."""
import sys, json, datetime
from hist_lib import *

split = sys.argv[1] if len(sys.argv) > 1 else 'dev'
methods = ['hybrid', 'hybrid_nograph', 'embeddings', 'bm25']
T0 = int(datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc).timestamp())   # tasks are fixes merged after this date

def metrics(keys, t):
    rel, rc = set(t['relevant_symbols']), set(t['root_cause_symbols'])
    uniq = list(dict.fromkeys(keys))
    r10 = len(rel & set(uniq[:10])) / len(rel)
    rank = next((i + 1 for i, k in enumerate(uniq) if k in rc), None)
    files = list(dict.fromkeys(k.split('::')[0] for k in uniq))
    relf = set(t['relevant_files'])
    return {'r10': r10, 'mrr': 1 / rank if rank else 0, 'f10': len(relf & set(files[:10])) / len(relf), 'rall': len(rel & set(uniq)) / len(rel)}

for repo in ['immich', 'twenty']:
    commits = load_log(repo)
    tasks = [t for t in load_tasks(repo) if t['split'] == split]
    states = states_at_cuts(commits, tasks)
    feats = ['freq90', 'freq30', 'fixfreq90', 'recency']
    tables = {f: lr_table(commits, f, T0 - 365 * DAY, T0) for f in feats}
    print(f'\n=== {repo} {split}: {len(tasks)} tasks; LR tables from {tables["freq90"][1]} fixed files before 2026-06-01')
    print('bins <', BINS); [print(f'  {f:10s}', ' '.join(f'{x:5.2f}' for x in tables[f][0])) for f in feats]
    official = {}
    for l in open(REPOS[repo]['stage1'] + '/metrics.jsonl'):
        d = json.loads(l)
        if d['corpus'] == 'full': official[(d['task_id'], d['method'])] = d
    for m in methods:
        raw = {}
        for l in open(REPOS[repo]['stage1'] + f'/raw/{m}.jsonl'):
            d = json.loads(l)
            if d['corpus'] == 'full': raw[d['task_id']] = d
        rows = []
        for t in tasks:
            st, now = states[t['task_id']]
            res = raw[t['task_id']]['results']
            keys = [f"{r['file']}::{r['symbol']}" for r in res]
            base = metrics(keys, t)
            off = official[(t['task_id'], m)]
            row = {'task': t['task_id'], 'type': t['task_type'], 'base': base, 'official_r10': off['sym_recall_10']}
            for f in feats:
                pct = percentiles(st.feature(f, now)); tab = tables[f][0]
                for beta in (0.25, 0.5, 1.0):
                    sc = [(r['score'] * (tab[bin_of(pct[r['file']])] if r['file'] in pct else 1.0) ** beta, -i) for i, r in enumerate(res)]
                    order = sorted(range(len(res)), key=lambda i: sc[i], reverse=True)
                    row[f'{f}@{beta}'] = metrics([keys[i] for i in order], t)
            rows.append(row)
        def agg(sel, key, met):
            xs = [r[key][met] for r in rows if sel(r)]
            return sum(xs) / len(xs) if xs else float('nan')
        bug = lambda r: r['type'] == 'bug_localisation'; oth = lambda r: not bug(r); al = lambda r: True
        nb = sum(1 for r in rows if bug(r))
        print(f'\n-- {m}: bug n={nb}, other n={len(rows)-nb}; recomputed base R@10 {agg(al,"base","r10"):.3f} vs official {sum(r["official_r10"] for r in rows)/len(rows):.3f}; ceiling (in top-50) bug {agg(bug,"base","rall"):.3f} other {agg(oth,"base","rall"):.3f}')
        print(f'{"variant":16s} {"bugR@10":>8s} {"bugMRR":>7s} {"bugF@10":>8s} {"othR@10":>8s} {"allR@10":>8s}')
        for key in ['base'] + [f'{f}@{b}' for f in feats for b in (0.25, 0.5, 1.0)]:
            print(f'{key:16s} {agg(bug,key,"r10"):8.3f} {agg(bug,key,"mrr"):7.3f} {agg(bug,key,"f10"):8.3f} {agg(oth,key,"r10"):8.3f} {agg(al,key,"r10"):8.3f}')
        if m == 'hybrid':
            for r in rows: print('   ', r['task'][:22].ljust(22), r['type'][:12].ljust(12), f"base {r['base']['r10']:.2f}/{r['base']['mrr']:.2f}  freq90@0.5 {r['freq90@0.5']['r10']:.2f}/{r['freq90@0.5']['mrr']:.2f}  @1 {r['freq90@1.0']['r10']:.2f}/{r['freq90@1.0']['mrr']:.2f}  top50 {r['base']['rall']:.2f}")
