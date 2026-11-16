#!/usr/bin/env python3
"""Query-independent check: how well does change history (as of just before a fix) predict which files a fix touches?
Replays the first-parent log chronologically. At each fix commit, ranks all existing corpus files by several priors
computed from strictly earlier commits, then records the rank of the files the fix modifies."""
import re, sys, math, json, random
from collections import defaultdict

log, prefix, window_days = sys.argv[1], sys.argv[2], int(sys.argv[3])   # e.g. .cache/exp6/history/twenty-log.txt packages/twenty-server/src/ 365
TEST = re.compile(r'(\.spec\.ts|\.test\.ts|__tests__/|/test/|__mocks__/|\.e2e-|integration-spec)')
FIX = re.compile(r'\b(fix|fixes|fixed|bug|regression|hotfix)\b', re.I)
commits = []
cur = None
for line in open(log, encoding='utf8', errors='replace'):
    line = line.rstrip('\n')
    if line.startswith('@@'):
        h, p, ct, s = line[2:].split('|', 3)
        cur = {'h': h, 't': int(ct), 's': s, 'files': []}
        commits.append(cur)
    elif line and cur is not None:
        st, path = line.split('\t', 1)
        if path.startswith(prefix) and path.endswith('.ts') and not path.endswith('.d.ts'):
            cur['files'].append((st[0], path))
t_end = commits[-1]['t']
t_eval = t_end - window_days * 86400
TAUS = [7, 30, 90, 365]
last = {}                                   # path -> last modification time
dec = {tau: defaultdict(float) for tau in TAUS}   # decayed counts, stored with their reference time
dect = {}
nfix = defaultdict(float)                   # decayed (90 d) count of earlier fix commits
count = defaultdict(int)
created = {}
rng = random.Random(0)
rows = []
def decayed(path, tau, now):
    return dec[tau][path] * math.exp(-(now - dect[path]) / (tau * 86400)) if path in dect else 0.0
for c in commits:
    mods = [p for st, p in c['files'] if st == 'M' and not TEST.search(p) and p in last]
    is_fix = bool(FIX.search(c['s']))
    if c['t'] >= t_eval and is_fix and 1 <= len(mods) <= 5:
        now = c['t']
        files = list(last.keys())
        n = len(files)
        scores = {
            'recency': {f: last[f] for f in files},
            **{f'freq{tau}': {f: decayed(f, tau, now) for f in files} for tau in TAUS},
            'fixfreq90': {f: nfix[f] * math.exp(-(now - dect[f]) / (90 * 86400)) for f in files},
            'count': {f: count[f] for f in files},
            'random': {f: rng.random() for f in files},
        }
        row = {'h': c['h'][:10], 'n_files': n, 'n_mod': len(mods)}
        for name, sc in scores.items():
            vals = sorted(sc.values(), reverse=True)
            import bisect
            neg = [-v for v in vals]
            ranks = []
            for m in mods:
                v = sc[m]
                lo = bisect.bisect_left(neg, -v); hi = bisect.bisect_right(neg, -v)
                ranks.append((lo + hi + 1) / 2)          # mid-rank among ties, 1-based
            row[name] = [r / n for r in ranks]
            row[name + '_rank'] = ranks
        rows.append(row)
    for st, p in c['files']:
        if st == 'D':
            for d in (last, dect, created): d.pop(p, None)
            for tau in TAUS: dec[tau].pop(p, None)
            nfix.pop(p, None); count.pop(p, None)
            continue
        now = c['t']
        if p in dect:
            for tau in TAUS: dec[tau][p] = dec[tau][p] * math.exp(-(now - dect[p]) / (tau * 86400))
            nfix[p] = nfix[p] * math.exp(-(now - dect[p]) / (90 * 86400))
        else:
            created[p] = now
        for tau in TAUS: dec[tau][p] += 1
        if is_fix: nfix[p] += 1
        dect[p] = now; last[p] = now; count[p] += 1
print(f'{log}: {len(commits)} commits, {len(last)} files at end, {len(rows)} evaluated fix commits (<=5 non-test files, last {window_days} d)')
names = ['recency'] + [f'freq{t}' for t in TAUS] + ['fixfreq90', 'count', 'random']
print(f'{"prior":10s} {"meanPct":>8s} {"medPct":>8s} {"top1%":>6s} {"top5%":>6s} {"top10%":>7s} {"hit@20":>7s} {"hit@100":>8s}   (best fixed file per commit)')
for nm in names:
    best = [min(r[nm]) for r in rows]; bestr = [min(r[nm + '_rank']) for r in rows]
    allp = [x for r in rows for x in r[nm]]
    best.sort()
    f = lambda th: sum(1 for b in best if b <= th) / len(best)
    print(f'{nm:10s} {sum(allp)/len(allp):8.3f} {best[len(best)//2]:8.3f} {f(.01):6.2f} {f(.05):6.2f} {f(.10):7.2f} {sum(1 for b in bestr if b<=20)/len(bestr):7.2f} {sum(1 for b in bestr if b<=100)/len(bestr):8.2f}')
json.dump(rows, open(log.replace('-log.txt', '-prior-rows.json'), 'w'))
