#!/usr/bin/env python3
"""
Experiment 3 agent-stage analysis (protocol Amendment C). Reads results/agent/<run>/runs.jsonl for one or more runs and
writes results/agent/<label>-report.md + .json.

Unit = task (repeats averaged within task, per arm). Paired task-level contrasts with a 10k bootstrap CI and a one-sided
sign-flip permutation p. Confirmatory family (Holm): H4 (A2 - A1 task_score), H4u (same on B-E tasks), H3 (log total
tokens A0 - A2 > 0, i.e. A2 uses fewer tokens), with the A2 - A0 task_score non-inferiority bound reported.

  python3 scripts/exp3/analyse-agent.py --runs main-L-haiku [--label L-haiku-test]
"""
import argparse, json, math, os, random, statistics
from collections import defaultdict

EXP = 'experiments/03-graph-scale/results/agent'
B = 10000
SEED = 20261114


def boot(xs):
    if not xs:
        return (None, None)
    r = random.Random(SEED); n = len(xs)
    ms = sorted(statistics.fmean(r.choices(xs, k=n)) for _ in range(B))
    return ms[int(0.025 * B)], ms[int(0.975 * B) - 1]


def boot_lower95(xs):
    r = random.Random(SEED + 1); n = len(xs)
    ms = sorted(statistics.fmean(r.choices(xs, k=n)) for _ in range(B))
    return ms[int(0.05 * B)]


def perm(d):
    n = len(d)
    if not n:
        return None
    obs = statistics.fmean(d)
    if n <= 16:
        c = sum(1 for m in range(1 << n) if sum(x if (m >> i) & 1 else -x for i, x in enumerate(d)) / n >= obs - 1e-12)
        return c / (1 << n)
    r = random.Random(SEED); c = 0
    for _ in range(20000):
        c += sum(x if r.random() < 0.5 else -x for x in d) / n >= obs - 1e-12
    return (c + 1) / 20001


def holm(ps):
    items = sorted((p, k) for k, p in ps.items() if p is not None)
    out, run, m = {}, 0.0, len(items)
    for i, (p, k) in enumerate(items):
        run = max(run, min(1.0, (m - i) * p)); out[k] = run
    return out


def fmt(x, d=3):
    return '—' if x is None else f'{x:.{d}f}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', required=True)
    ap.add_argument('--label')
    a = ap.parse_args()
    runs = []
    for r in a.runs.split(','):
        runs += [json.loads(l) for l in open(f'{EXP}/{r}/runs.jsonl') if l.strip()]
    label = a.label or a.runs.replace(',', '+')
    arms = sorted({r['arm'] for r in runs})
    by = defaultdict(lambda: defaultdict(list))  # task -> arm -> runs
    for r in runs:
        by[r['task_id']][r['arm']].append(r)
    ttype = {r['task_id']: r['task_type'] for r in runs}
    def tmean(task, arm, f):
        xs = [f(r) for r in by[task][arm] if f(r) is not None]
        return statistics.fmean(xs) if xs else None
    M = {
        'task_score': lambda r: r['score']['task_score'],
        'total_tokens': lambda r: r['total_tokens'],
        'cost_usd': lambda r: r['cost_ledger_usd'],
        'turns': lambda r: r['turns'],
        'tool_calls': lambda r: sum(v for k, v in (r['tool_calls'] or {}).items()),
        'retrieval_calls': lambda r: r['retrieval_calls'],
        'files_read': lambda r: r['files_read'],
        'wall_s': lambda r: r['wall_ms'] / 1000,
        'precision': lambda r: r['score']['precision'],
        'rc_at_1': lambda r: r['score']['rc_at_1'],
        'path_recall': lambda r: r['score']['path_recall'],
        'adopted': lambda r: 1.0 if r['retrieval_calls'] else 0.0,
        'mcp_result_chars': lambda r: r.get('mcp_result_chars'),
    }
    md = [f'# Experiment 3 agent stage: {label}\n', f'Runs: {len(runs)} from `{a.runs}`; tasks {len(by)}; arms {arms}; models {sorted({r["model"] for r in runs})}. Unit = task (repeats averaged). No LLM judge.\n']
    res = {'label': label, 'n_runs': len(runs), 'tasks': len(by), 'arms': {}, 'contrasts': {}}
    for group, sel in [('all tasks', lambda t: True), ('bug localisation (A)', lambda t: ttype[t] == 'bug_localisation'), ('understanding (B–E)', lambda t: ttype[t] != 'bug_localisation')]:
        tasks = [t for t in by if sel(t)]
        if not tasks:
            continue
        md.append(f'\n## {group}: {len(tasks)} tasks\n')
        md.append('| Arm | task score | total tokens | cost $ | turns | tool calls | retrieval calls | adoption | files read | wall s | precision |')
        md.append('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
        for arm in arms:
            vals = {k: [tmean(t, arm, f) for t in tasks if by[t][arm]] for k, f in M.items()}
            vals = {k: [x for x in v if x is not None] for k, v in vals.items()}
            mean = {k: (statistics.fmean(v) if v else None) for k, v in vals.items()}
            res['arms'][f'{group}|{arm}'] = mean
            md.append(f"| {arm} | {fmt(mean['task_score'], 3)} | {fmt(mean['total_tokens'], 0)} | {fmt(mean['cost_usd'], 4)} | {fmt(mean['turns'], 1)} | {fmt(mean['tool_calls'], 1)} | {fmt(mean['retrieval_calls'], 1)} | {fmt(mean['adopted'], 2)} | {fmt(mean['files_read'], 1)} | {fmt(mean['wall_s'], 0)} | {fmt(mean['precision'], 2)} |")
        md.append('\n| Contrast | metric | n | mean Δ | 95% CI | W/L/T | p (one-sided, Δ>0) |')
        md.append('|---|---|---:|---:|---|---|---:|')
        for x, y in [('A2', 'A1'), ('A2', 'A0'), ('A1', 'A0'), ('A2', 'A5'), ('A2', 'A6'), ('A5', 'A0'), ('A6', 'A0')]:
            if x not in arms or y not in arms:
                continue
            for metric in ['task_score', 'total_tokens', 'cost_usd']:
                d = []
                for t in tasks:
                    vx, vy = tmean(t, x, M[metric]), tmean(t, y, M[metric])
                    if vx is None or vy is None:
                        continue
                    d.append(vx - vy if metric == 'task_score' else math.log(vy / vx) if vx > 0 and vy > 0 else 0.0)
                if not d:
                    continue
                ci = boot(d); p = perm(d)
                w = sum(v > 1e-9 for v in d); l = sum(v < -1e-9 for v in d)
                name = f'{x} − {y}' if metric == 'task_score' else f'log({y}/{x}) {metric}'
                res['contrasts'][f'{group}|{x}-{y}|{metric}'] = {'n': len(d), 'mean': statistics.fmean(d), 'ci': ci, 'p': p, 'w': w, 'l': l, 'lower95_one_sided': boot_lower95(d) if metric == 'task_score' else None}
                md.append(f'| {name} | {metric} | {len(d)} | {statistics.fmean(d):+.3f} | [{ci[0]:+.3f}, {ci[1]:+.3f}] | {w}/{l}/{len(d) - w - l} | {fmt(p, 3)} |')
    c = res['contrasts']
    fam = {'H4': c.get('all tasks|A2-A1|task_score', {}).get('p'), 'H4u': c.get('understanding (B–E)|A2-A1|task_score', {}).get('p'), 'H3': c.get('all tasks|A2-A0|total_tokens', {}).get('p')}
    hp = holm(fam)
    res['confirmatory'] = {'p': fam, 'holm': hp}
    md.append('\n## Confirmatory family (Amendment C; Holm over H4, H4u, H3)\n')
    md.append('| ID | Contrast | mean | 95% CI | p | Holm |')
    md.append('|---|---|---:|---|---:|---:|')
    for k, key, desc in [('H4', 'all tasks|A2-A1|task_score', 'task score A2 − A1 (all)'), ('H4u', 'understanding (B–E)|A2-A1|task_score', 'task score A2 − A1 (B–E)'), ('H3', 'all tasks|A2-A0|total_tokens', 'log(tokens A0 / tokens A2)')]:
        e = c.get(key)
        if e:
            md.append(f"| {k} | {desc} | {e['mean']:+.3f} | [{e['ci'][0]:+.3f}, {e['ci'][1]:+.3f}] | {fmt(e['p'])} | {fmt(hp.get(k))} |")
    if {'A5', 'A6'} & set(arms):
        famD = {k: c.get(key, {}).get('p') for k, key in [('D-acc-G', 'all tasks|A2-A5|task_score'), ('D-acc-C', 'all tasks|A2-A6|task_score'), ('D-tok-G', 'all tasks|A2-A5|total_tokens'), ('D-tok-C', 'all tasks|A2-A6|total_tokens')]}
        hD = holm(famD)
        res['confirmatory_D'] = {'p': famD, 'holm': hD}
        md.append('\n## Head-to-head family (Amendment D4; Holm over four, one-sided, ours = A2)\n')
        md.append('| ID | Contrast | mean | 95% CI | W/L/T | p | Holm |')
        md.append('|---|---|---:|---|---|---:|---:|')
        for k, key, desc in [('D-acc-G', 'all tasks|A2-A5|task_score', 'task score ours − graphify'), ('D-acc-C', 'all tasks|A2-A6|task_score', 'task score ours − code-review-graph'), ('D-tok-G', 'all tasks|A2-A5|total_tokens', 'log(tokens graphify / ours)'), ('D-tok-C', 'all tasks|A2-A6|total_tokens', 'log(tokens code-review-graph / ours)')]:
            e = c.get(key)
            if e:
                md.append(f"| {k} | {desc} | {e['mean']:+.3f} | [{e['ci'][0]:+.3f}, {e['ci'][1]:+.3f}] | {e['w']}/{e['l']}/{e['n'] - e['w'] - e['l']} | {fmt(e['p'])} | {fmt(hD.get(k))} |")
    ni = c.get('all tasks|A2-A0|task_score')
    if ni:
        md.append(f"\nNon-inferiority (H3 companion): task score A2 − A0 one-sided 95% lower bound = {ni['lower95_one_sided']:+.3f} (margin −0.05: {'met' if ni['lower95_one_sided'] > -0.05 else 'NOT met'}).")
    os.makedirs(EXP, exist_ok=True)
    json.dump(res, open(f'{EXP}/{label}-report.json', 'w'), indent=1, default=str)
    open(f'{EXP}/{label}-report.md', 'w').write('\n'.join(md) + '\n')
    print('\n'.join(md))


if __name__ == '__main__':
    main()
