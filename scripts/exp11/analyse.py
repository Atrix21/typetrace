#!/usr/bin/env python3
"""
Experiment 11: the pre-registered analysis and the sample-size rule (protocol.md).

  python3 scripts/exp11/analyse.py report --t1 <run dir> --t2 <run dir> --t3 <run dir>   -> report.md / report.json next to --out
  python3 scripts/exp11/analyse.py power  --t1 <pilot dir> --t2 <pilot dir> --t3 <pilot dir>

Unit = item (issue or question), repeats averaged. Primary score: T1 function recall, T2 file recall, T3 key-fact
coverage (judged.jsonl, pass 1). Accuracy: T1 a changed function in the top three, T2 another changed file in the top
three. Two-sided paired sign-flip permutation tests (exact up to 2^16 sign patterns, else 20,000 seeded flips), 95%
bootstrap CIs, Holm within each family:
  R1 (Holm over 6): TT vs GF, TT vs CR on T1, T2, T3      R2 (Holm over 6): TS vs GF, TS vs CR on T1, T2, T3
  A1 (Holm over 4): TT vs GF, TT vs CR on T1, T2           A2 (Holm over 4): TS vs GF, TS vs CR on T1, T2
Everything else is exploratory. Sample size (power): per task, s = the largest pilot SD of the paired primary-score
differences of that task's confirmatory comparisons, inflated to its 80% upper bound; n = ceil(((z_{1-0.05/12} +
z_0.80) * s / 0.05)^2) (two-sided, the family's first Holm level), capped at 250 per task.
"""
import argparse, collections, itertools, json, math, os, random, statistics
from statistics import NormalDist

SEED, B, NPERM, CAP = 20261120, 10000, 20000, 250
ap = argparse.ArgumentParser()
ap.add_argument('mode', choices=['report', 'power'])
for t in ('t1', 't2', 't3'): ap.add_argument(f'--{t}')
ap.add_argument('--out', default='experiments/11-vendor-setups/results/report')
A = ap.parse_args()
z = NormalDist().inv_cdf

def jl(f): return [json.loads(l) for l in open(f) if l.strip()] if os.path.exists(f) else []

def load(task, d):
    """item -> arm -> list of per-run dicts with primary, accuracy and the secondary measures."""
    if not d: return {}
    runs = jl(f'{d}/runs.jsonl')
    judged = {r['run_id']: r for r in jl(f'{d}/judged.jsonl') if r.get('pass') == 1 and not r.get('mock')} if task == 'T3' else {}
    per = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in runs:
        s = r['score']
        if task == 'T3':
            j = judged.get(r['run_id'])
            if j is None: continue  # not judged yet
            row = {'primary': j['coverage'], 'rubric': j['rubric_total']}
        else:
            row = {'primary': s['primary'], 'accuracy': s['accuracy'], 'top1': s['top1'], 'file_recall': s['file_recall'], 'function_recall': s['function_recall']}
        row.update(tokens=r.get('total_tokens'), turns=r.get('turns'), wall=(r.get('wall_ms') or 0) / 1000, used=r.get('used_tool'), cost=r.get('cost_list_usd') or 0,
                   skill=bool(r.get('skills_invoked')), language=r.get('language'), repo=r.get('repo'))
        per[r['item']][r['arm']].append(row)
    return per

def mean_of(rows, k):
    v = [x[k] for x in rows if x.get(k) is not None]
    return statistics.fmean(v) if v else None

def perm2(d):
    """Two-sided: P(|mean of sign-flipped d| >= |observed mean|)."""
    obs = abs(statistics.fmean(d)); n = len(d)
    if n <= 16:
        c = sum(abs(statistics.fmean([s * x for s, x in zip(sg, d)])) >= obs - 1e-12 for sg in itertools.product([1, -1], repeat=n))
        return c / 2 ** n
    r = random.Random(SEED); c = 0
    for _ in range(NPERM):
        c += abs(sum(x if r.random() < .5 else -x for x in d) / n) >= obs - 1e-12
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

DATA = {t: load(t, getattr(A, t.lower())) for t in ('T1', 'T2', 'T3')}

def paired(task, a, b, k='primary'):
    per = DATA[task]
    return [mean_of(per[i][a], k) - mean_of(per[i][b], k) for i in per if per[i].get(a) and per[i].get(b) and mean_of(per[i][a], k) is not None and mean_of(per[i][b], k) is not None]

if A.mode == 'power':
    out = {}
    for t in ('T1', 'T2', 'T3'):
        if not DATA[t]: continue
        sds = {}
        for a, b in [('TT', 'GF'), ('TT', 'CR'), ('TS', 'GF'), ('TS', 'CR')]:
            d = paired(t, a, b)
            if len(d) > 1: sds[f'{a}-{b}'] = {'n': len(d), 'mean': statistics.fmean(d), 'sd': statistics.stdev(d)}
        if not sds: continue
        s = max(v['sd'] for v in sds.values()); k = min(v['n'] for v in sds.values()); nu = k - 1
        chi2_20 = nu * (1 - 2 / (9 * nu) + z(0.20) * math.sqrt(2 / (9 * nu))) ** 3
        s_up = s * math.sqrt(nu / chi2_20)
        n = math.ceil(((z(1 - 0.05 / 12) + z(0.80)) * s_up / 0.05) ** 2) if s_up > 0 else None
        arms = sorted({a for i in DATA[t] for a in DATA[t][i]})
        out[t] = {'items': len(DATA[t]), 'sd': sds, 's': s, 's_upper80': s_up, 'n_required': n, 'n_main': min(n, CAP) if n else None,
                  'power_at_cap': NormalDist().cdf(0.05 * math.sqrt(CAP) / s_up - z(1 - 0.05 / 12)) if s_up > 0 else None,
                  'mean_primary': {a: statistics.fmean(mean_of(DATA[t][i][a], 'primary') for i in DATA[t] if DATA[t][i].get(a)) for a in arms},
                  'mean_tokens': {a: statistics.fmean(x['tokens'] for i in DATA[t] for x in DATA[t][i].get(a, []) if x['tokens']) for a in arms},
                  'tool_use': {a: statistics.fmean(1 if x['used'] else 0 for i in DATA[t] for x in DATA[t][i].get(a, [])) for a in arms if a != 'G0'}}
    print(json.dumps(out, indent=1)); raise SystemExit

md, out = ['# Experiment 11 report: each tool with its vendor\'s setup, on each tool\'s own task\n'], {'families': {}, 'means': {}}
for t in ('T1', 'T2', 'T3'):
    per = DATA[t]
    if not per: continue
    arms = [a for a in ['G0', 'TT', 'TS', 'GF', 'CR'] if any(a in per[i] for i in per)]
    full = [i for i in per if all(a in per[i] for a in arms)]
    md += [f'\n## {t}: {len(full)} items with every arm\n',
           '| Arm | Primary | ' + ('Accuracy (top 3) | Top 1 | File recall | ' if t != 'T3' else 'SWE-QA rubric (of 100) | ') + 'Tokens / run (mean) | Median | Turns | Wall s | Used the tool | Used a skill | Cost |',
           '|---|' + '---:|' * (11 if t != 'T3' else 9)]
    out['means'][t] = {}
    for a in arms:
        rows = [x for i in full for x in per[i][a]]
        im = lambda k: statistics.fmean(mean_of(per[i][a], k) for i in full)
        toks = [x['tokens'] for x in rows if x['tokens']]
        used = None if a == 'G0' else statistics.fmean(1 if x['used'] else 0 for x in rows)
        rec = {'primary': im('primary'), 'tokens_mean': statistics.fmean(toks), 'tokens_median': statistics.median(toks), 'turns': statistics.fmean(x['turns'] for x in rows if x['turns'] is not None),
               'wall': statistics.fmean(x['wall'] for x in rows), 'used': used, 'skill': statistics.fmean(1 if x['skill'] else 0 for x in rows), 'cost': sum(x['cost'] for x in rows)}
        if t != 'T3': rec.update(accuracy=im('accuracy'), top1=im('top1'), file_recall=im('file_recall'))
        else: rec.update(rubric=im('rubric'))
        out['means'][t][a] = rec
        mid = f"{rec['accuracy']:.3f} | {rec['top1']:.3f} | {rec['file_recall']:.3f} | " if t != 'T3' else f"{rec['rubric']:.1f} | "
        md.append(f"| {a} | {rec['primary']:.3f} | {mid}{rec['tokens_mean']:,.0f} | {rec['tokens_median']:,.0f} | {rec['turns']:.1f} | {rec['wall']:.0f} | {'—' if used is None else f'{used:.0%}'} | {rec['skill']:.0%} | ${rec['cost']:.2f} |")

def family(name, tests, k):
    res = []
    for t, a, b in tests:
        if not DATA[t]: continue
        d = paired(t, a, b, k)
        if len(d) < 2: continue
        res.append((t, a, b, d, statistics.fmean(d), boot(d), perm2(d)))
    adj = holm([x[6] for x in res])
    md.extend([f'\n## {name}\n', '| Task | Test | Mean Δ | 95% CI | W/L/T | p (two-sided) | Holm p |', '|---|---|---:|---|---|---:|---:|'])
    out['families'][name] = {}
    for (t, a, b, d, mu, ci, p), h in zip(res, adj):
        w, l = sum(x > 1e-9 for x in d), sum(x < -1e-9 for x in d)
        md.append(f'| {t} | {a} vs {b} | {mu:+.3f} | [{ci[0]:+.3f}, {ci[1]:+.3f}] | {w}/{l}/{len(d) - w - l} | {p:.4f} | {h:.4f} |')
        out['families'][name][f'{t} {a} vs {b}'] = {'mean': mu, 'ci': ci, 'p': p, 'holm': h, 'w': w, 'l': l, 'n': len(d)}

family('R1: primary score, as shipped (Holm over 6)', [(t, 'TT', b) for t in ('T1', 'T2', 'T3') for b in ('GF', 'CR')], 'primary')
family('R2: primary score, like for like (Holm over 6)', [(t, 'TS', b) for t in ('T1', 'T2', 'T3') for b in ('GF', 'CR')], 'primary')
family('A1: accuracy, as shipped (Holm over 4)', [(t, 'TT', b) for t in ('T1', 'T2') for b in ('GF', 'CR')], 'accuracy')
family('A2: accuracy, like for like (Holm over 4)', [(t, 'TS', b) for t in ('T1', 'T2') for b in ('GF', 'CR')], 'accuracy')

# Exploratory (no correction): TS vs TT, each arm vs G0, tokens (log ratio), by language.
md.append('\n## Exploratory (uncorrected)\n')
md.extend(['| Task | Comparison | Measure | Mean Δ | 95% CI |', '|---|---|---|---:|---|'])
for t in ('T1', 'T2', 'T3'):
    if not DATA[t]: continue
    for a, b in [('TS', 'TT'), ('TT', 'G0'), ('TS', 'G0'), ('GF', 'G0'), ('CR', 'G0')]:
        for k in (['primary', 'accuracy', 'top1'] if t != 'T3' else ['primary', 'rubric']):
            d = paired(t, a, b, k)
            if len(d) > 1: ci = boot(d); md.append(f'| {t} | {a} vs {b} | {k} | {statistics.fmean(d):+.3f} | [{ci[0]:+.3f}, {ci[1]:+.3f}] |')
        per = DATA[t]
        d = [math.log(statistics.fmean(x['tokens'] for x in per[i][a] if x['tokens']) / statistics.fmean(x['tokens'] for x in per[i][b] if x['tokens'])) for i in per if per[i].get(a) and per[i].get(b) and all(x['tokens'] for x in per[i][a] + per[i][b])]
        if len(d) > 1: ci = boot(d); md.append(f'| {t} | {a} vs {b} | tokens (log ratio) | {statistics.fmean(d):+.3f} ({(math.exp(statistics.fmean(d)) - 1) * 100:+.0f}%) | [{ci[0]:+.3f}, {ci[1]:+.3f}] |')
for t in ('T1', 'T2'):
    per = DATA[t]
    if not per: continue
    md.extend([f'\n### {t} by language (primary score)\n', '| Language | n | G0 | TT | TS | GF | CR |', '|---|---:|---:|---:|---:|---:|---:|'])
    langs = collections.defaultdict(list)
    for i in per:
        lg = next(iter(per[i].values()))[0]['language']; langs[lg].append(i)
    for lg, ii in sorted(langs.items()):
        md.append(f'| {lg} | {len(ii)} | ' + ' | '.join(f"{statistics.fmean(mean_of(per[i][a], 'primary') for i in ii if per[i].get(a)):.3f}" if any(per[i].get(a) for i in ii) else '—' for a in ['G0', 'TT', 'TS', 'GF', 'CR']) + ' |')
os.makedirs(A.out, exist_ok=True)
json.dump(out, open(f'{A.out}/report.json', 'w'), indent=1)
open(f'{A.out}/report.md', 'w').write('\n'.join(md) + '\n')
print('\n'.join(md))
