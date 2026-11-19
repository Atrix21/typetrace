#!/usr/bin/env python3
"""
Experiment 10: the pre-registered sample-size rule, applied to the pilot (protocol.md, "Pilot and sample size").

  python3 scripts/swebench/agent_power.py experiments/10-swebench-agents/results/<pilot-run>

s = the larger pilot SD of per-issue differences in the primary outcome (A2-A0, A2-A1); inflated to its 80% upper
confidence bound; n = ceil(((z_{1-0.05/4} + z_{0.80}) * s / 0.05)^2), capped at 570 (the main pool).
The chi-square quantile uses the Wilson-Hilferty approximation (no SciPy needed); it is within 1% for k >= 10.
"""
import collections, json, math, statistics, sys
from statistics import NormalDist

D = sys.argv[1]
runs = [json.loads(l) for l in open(f'{D}/runs.jsonl') if l.strip()]
per = collections.defaultdict(lambda: collections.defaultdict(list))
for r in runs:
    per[r['issue']][r['arm']].append(r['score']['task_score'])
mean = {i: {a: statistics.fmean(v) for a, v in arms.items()} for i, arms in per.items()}

def diffs(a, b):
    return [m[a] - m[b] for m in mean.values() if a in m and b in m]

z = NormalDist().inv_cdf
out = {'pilot_issues': len(mean), 'runs': len(runs)}
sds = {}
for a, b in [('A2', 'A0'), ('A2', 'A1')]:
    d = diffs(a, b)
    sds[f'{a}-{b}'] = {'n': len(d), 'mean': statistics.fmean(d) if d else None, 'sd': statistics.stdev(d) if len(d) > 1 else None}
s = max(v['sd'] for v in sds.values() if v['sd'] is not None)
k = min(v['n'] for v in sds.values())
nu = k - 1
chi2_20 = nu * (1 - 2 / (9 * nu) + z(0.20) * math.sqrt(2 / (9 * nu))) ** 3  # lower 20% quantile, Wilson-Hilferty
s_up = s * math.sqrt(nu / chi2_20)
if s_up == 0:  # only a degenerate pilot (e.g. a mock run with scripted answers) has no variance at all
    print(json.dumps({**out, 'sd': sds, 'error': 'pilot SD of the paired differences is 0; the sample-size rule is undefined'}, indent=1))
    sys.exit(2)
n = math.ceil(((z(1 - 0.05 / 4) + z(0.80)) * s_up / 0.05) ** 2)
n_used = min(n, 570)
achieved = NormalDist().cdf(0.05 * math.sqrt(n_used) / s_up - z(1 - 0.05 / 4))
out.update({'sd': sds, 's': s, 's_upper80': s_up, 'n_required': n, 'n_main': n_used, 'power_at_n_main': achieved,
            'by_arm_mean_score': {a: statistics.fmean(m[a] for m in mean.values() if a in m) for a in ['A0', 'A1', 'A2', 'A5', 'A6']},
            'wall_s_mean': statistics.fmean(r['wall_ms'] / 1000 for r in runs if r.get('wall_ms')),
            'tokens_mean': statistics.fmean(r['total_tokens'] for r in runs if r.get('total_tokens'))})
print(json.dumps(out, indent=1))
