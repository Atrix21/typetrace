#!/usr/bin/env python3
"""
Experiment 10: the pre-registered analysis (protocol.md). Unit = issue (repeats averaged).

  python3 scripts/swebench/analyse_agents.py experiments/10-swebench-agents/results/<run>  -> <run>/report.md, report.json

Family A (accuracy, Holm over 4): A2>A0, A2>A1, A2>A5, A2>A6.  Family T (tokens, Holm over 3): A2<A0, A2<A5, A2<A6
(per-issue log ratio of mean total tokens). Non-inferiority of A2 vs A0 (one-sided 95% lower bound vs -0.05).
One-sided paired sign-flip permutation (exact up to 2^16 patterns, else 20,000 seeded flips); 95% bootstrap CIs.
"""
import collections, itertools, json, math, random, statistics, sys

D = sys.argv[1]
SEED, B, NPERM = 20261118, 10000, 20000
runs = [json.loads(l) for l in open(f'{D}/runs.jsonl') if l.strip()]
# E10-D08 / E11-D07: --apply <rescore file> replaces the scores of re-scored runs (the file names old and new values).
if '--apply' in sys.argv:
    fix = {x['run_id']: x['after'] for x in map(json.loads, open(sys.argv[sys.argv.index('--apply') + 1])) if x.get('changed')}
    for r in runs:
        if r['run_id'] in fix: r['score'].update(fix[r['run_id']])
OUTNAME = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else 'report'
acc = collections.defaultdict(lambda: collections.defaultdict(list))
tok = collections.defaultdict(lambda: collections.defaultdict(list))
meta = {}
for r in runs:
    acc[r['issue']][r['arm']].append(r['score']['task_score'])
    if r.get('total_tokens'): tok[r['issue']][r['arm']].append(r['total_tokens'])
    meta[r['issue']] = (r['bench'], r['repo'])
ARMS = sorted({r['arm'] for r in runs})
full = [i for i in acc if all(a in acc[i] for a in ARMS)]

def m(d, i, a): return statistics.fmean(d[i][a])

def perm(d):
    obs = statistics.fmean(d); n = len(d)
    if n <= 16:
        c = sum(statistics.fmean([s * x for s, x in zip(sg, d)]) >= obs - 1e-12 for sg in itertools.product([1, -1], repeat=n))
        return c / 2 ** n
    r = random.Random(SEED); c = 0
    for _ in range(NPERM):
        c += sum(x if r.random() < .5 else -x for x in d) / n >= obs - 1e-12
    return (c + 1) / (NPERM + 1)

def boot(d, lo=.025, hi=.975):
    r = random.Random(SEED); n = len(d)
    ms = sorted(statistics.fmean(r.choices(d, k=n)) for _ in range(B))
    return ms[int(lo * B)], ms[int(hi * B) - 1]

def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i]); adj = [0.0] * len(ps); run = 0.0
    for k, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - k) * ps[i])); adj[i] = run
    return adj

out = {'issues': len(full), 'runs': len(runs), 'arms': ARMS, 'means': {}, 'family_A': {}, 'family_T': {}, 'exploratory': {}}
md = [f'# Experiment 10 report: agents on SWE-bench issues\n', f'{len(full)} issues with every arm ({len(runs)} runs). Unit = issue, repeats averaged.\n',
      '| Arm | Score (changed fn in top 3) | Tokens / run (mean) | Turns | Used the tool |', '|---|---:|---:|---:|---:|']
for a in ARMS:
    rs = [r for r in runs if r['arm'] == a and r['issue'] in full]
    sc = statistics.fmean(m(acc, i, a) for i in full)
    tk = statistics.fmean(r['total_tokens'] for r in rs if r.get('total_tokens'))
    tu = statistics.fmean(r['turns'] for r in rs if r.get('turns') is not None)
    use = statistics.fmean(1 if (r.get('retrieval_calls') or 0) > 0 or r.get('mcp_calls') else 0 for r in rs) if a != 'A0' else None
    out['means'][a] = {'score': sc, 'tokens': tk, 'turns': tu, 'tool_use': use}
    md.append(f'| {a} | {sc:.3f} | {tk:,.0f} | {tu:.1f} | {"—" if use is None else f"{use:.0%}"} |')

def family(name, tests, kind):
    res = []
    for a, b in tests:
        if a not in ARMS or b not in ARMS: continue
        if kind == 'acc': d = [m(acc, i, a) - m(acc, i, b) for i in full]
        else: d = [math.log(m(tok, i, b) / m(tok, i, a)) for i in full if tok[i].get(a) and tok[i].get(b)]
        res.append((a, b, d, statistics.fmean(d), boot(d), perm(d)))
    adj = holm([x[5] for x in res])
    md.append(f'\n## {name}\n')
    md.append('| Test | Mean Δ | 95% CI | W/L/T | p | Holm p |' if kind == 'acc' else '| Test | Mean log(other ÷ A2) (A2\'s tokens vs the other arm, typical issue) | 95% CI | W/L/T (W = A2 fewer) | p | Holm p |')
    md.append('|---|---:|---|---|---:|---:|')
    for (a, b, d, mu, ci, p), h in zip(res, adj):
        w, l = sum(x > 1e-9 for x in d), sum(x < -1e-9 for x in d)
        lab = f'{a} > {b}' if kind == 'acc' else f'{a} < {b}'
        val = f'{mu:+.3f}' if kind == 'acc' else f'{mu:+.3f} ({-(1 - math.exp(-mu)) * 100:+.0f}%)'
        md.append(f'| {lab} | {val} | [{ci[0]:+.3f}, {ci[1]:+.3f}] | {w}/{l}/{len(d) - w - l} | {p:.4f} | {h:.4f} |')
        (out['family_A'] if kind == 'acc' else out['family_T'])[lab] = {'mean': mu, 'ci': ci, 'p': p, 'holm': h, 'w': w, 'l': l, 'n': len(d)}

family('Family A: accuracy (Holm over 4)', [('A2', 'A0'), ('A2', 'A1'), ('A2', 'A5'), ('A2', 'A6')], 'acc')
family('Family T: tokens (Holm over 3)', [('A2', 'A0'), ('A2', 'A5'), ('A2', 'A6')], 'tok')
if 'A2' in ARMS and 'A0' in ARMS:
    d = [m(acc, i, 'A2') - m(acc, i, 'A0') for i in full]
    lb = boot(d, .05, .95)[0]
    out['non_inferiority_A2_A0'] = {'lower_bound_95': lb, 'margin': -0.05, 'met': lb > -0.05}
    md.append(f'\nNon-inferiority (A2 − A0): one-sided 95% lower bound {lb:+.3f} against −0.05: {"met" if lb > -0.05 else "NOT met"}.\n')
md.append('\n## Exploratory: by benchmark (score)\n')
md.append('| Benchmark | n | ' + ' | '.join(ARMS) + ' |'); md.append('|---|---:|' + '---:|' * len(ARMS))
for bn in ['lite', 'ml']:
    ii = [i for i in full if meta[i][0] == bn]
    if ii:
        md.append(f'| {bn} | {len(ii)} | ' + ' | '.join(f'{statistics.fmean(m(acc, i, a) for i in ii):.3f}' for a in ARMS) + ' |')
accs = collections.defaultdict(list)
for r in runs: accs[r['account']['name']].append(r['score']['task_score'])
md.append('\nRuns by account (exploratory check that switching accounts changes nothing): ' + ', '.join(f'{k} {len(v)} runs, mean score {statistics.fmean(v):.3f}' for k, v in accs.items()) + '.\n')
json.dump(out, open(f'{D}/{OUTNAME}.json', 'w'), indent=1)
open(f'{D}/{OUTNAME}.md', 'w').write('\n'.join(md) + '\n')
print('\n'.join(md))
