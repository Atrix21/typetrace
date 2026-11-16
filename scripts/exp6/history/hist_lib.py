"""Experiment 6, direction 1 (change history): replay of the first-parent log, file-level change statistics as of a cut.

Logs are produced once per repository from the full-history clones (no blobs needed, no network):
  GIT_NO_LAZY_FETCH=1 git -C targets/exp3/immich-history log --first-parent --reverse --no-renames --name-status \\
      --format='@@%H|%P|%ct|%s' a203e288c212f1bd89fc81256dddb792ad3247cd -- server/src > .cache/exp6/history/immich-log.txt
  GIT_NO_LAZY_FETCH=1 git -C targets/exp3/twenty-history log --first-parent --reverse --no-renames --name-status \\
      --format='@@%H|%P|%ct|%s' bde4ff135765e8590d64874cebd5404c0919528d -- packages/twenty-server/src > .cache/exp6/history/twenty-log.txt
(Do not add -M: rename detection needs file contents, which a blobless clone fetches from the network commit by commit.)"""
import re, math, json, glob, os, bisect
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
S = os.path.join(ROOT, '.cache', 'exp6', 'history')
REPOS = {
    'immich': {'log': f'{S}/immich-log.txt', 'prefix': 'server/', 'tasks': f'{ROOT}/experiments/03-graph-scale/dataset/v2/immich', 'stage1': f'{ROOT}/experiments/03-graph-scale/results/stage1-M'},
    'twenty': {'log': f'{S}/twenty-log.txt', 'prefix': 'packages/twenty-server/', 'tasks': f'{ROOT}/experiments/03-graph-scale/dataset/v2/twenty', 'stage1': f'{ROOT}/experiments/03-graph-scale/results/stage1-L'},
}
TEST = re.compile(r'(\.spec\.ts|\.test\.ts|__tests__/|/test/|__mocks__/|\.e2e-|integration-spec)')
FIX = re.compile(r'\b(fix|fixes|fixed|bug|regression|hotfix)\b', re.I)
TAUS = [7, 30, 90, 365]
DAY = 86400

def load_log(repo):
    R = REPOS[repo]
    commits, cur = [], None
    for line in open(R['log'], encoding='utf8', errors='replace'):
        line = line.rstrip('\n')
        if line.startswith('@@'):
            h, p, ct, s = line[2:].split('|', 3)
            cur = {'h': h, 't': int(ct), 's': s, 'files': []}
            commits.append(cur)
        elif line and cur is not None:
            st, path = line.split('\t', 1)
            if path.startswith(R['prefix']) and path.endswith('.ts') and not path.endswith('.d.ts'):
                cur['files'].append((st[0], path[len(R['prefix']):]))
    return commits

class State:
    def __init__(self):
        self.last = {}; self.dect = {}; self.count = defaultdict(int)
        self.dec = {tau: defaultdict(float) for tau in TAUS}
        self.fix90 = defaultdict(float)
        self.msgs = defaultdict(list)
    def apply(self, c):
        now, is_fix = c['t'], bool(FIX.search(c['s']))
        for st, p in c['files']:
            if st == 'D':
                for d in (self.last, self.dect, self.count, self.fix90, self.msgs, *self.dec.values()): d.pop(p, None)
                continue
            if p in self.dect:
                dt = now - self.dect[p]
                for tau in TAUS: self.dec[tau][p] *= math.exp(-dt / (tau * DAY))
                self.fix90[p] *= math.exp(-dt / (90 * DAY))
            for tau in TAUS: self.dec[tau][p] += 1
            if is_fix: self.fix90[p] += 1
            self.dect[p] = now; self.last[p] = now; self.count[p] += 1
            self.msgs[p].append(c['s'])
    def feature(self, name, now):
        """file -> value (higher = more active) as of time `now`."""
        if name == 'recency': return dict(self.last)
        if name == 'count': return dict(self.count)
        if name == 'fixfreq90': return {f: self.fix90[f] * math.exp(-(now - self.dect[f]) / (90 * DAY)) for f in self.last}
        tau = int(name[4:])
        return {f: self.dec[tau][f] * math.exp(-(now - self.dect[f]) / (tau * DAY)) for f in self.last}

def percentiles(values):
    """file -> mid-rank percentile in (0,1], 0 = most active."""
    neg = sorted(-v for v in values.values()); n = len(neg)
    out = {}
    for f, v in values.items():
        lo = bisect.bisect_left(neg, -v); hi = bisect.bisect_right(neg, -v)
        out[f] = ((lo + hi) / 2) / n
    return out

BINS = [0.01, 0.02, 0.05, 0.10, 0.20, 0.35, 0.50, 0.75, 1.0001]
def bin_of(p):
    for i, b in enumerate(BINS):
        if p < b: return i
    return len(BINS) - 1

def lr_table(commits, feature, t_lo, t_hi, max_files=5):
    """Likelihood ratio P(bin | file modified by a fix) / P(bin) from fix commits with t_lo <= t < t_hi, replayed causally."""
    st = State(); hist = [0] * len(BINS); n = 0
    for c in commits:
        if c['t'] >= t_hi: break
        mods = [p for s_, p in c['files'] if s_ == 'M' and not TEST.search(p) and p in st.last]
        if c['t'] >= t_lo and FIX.search(c['s']) and 1 <= len(mods) <= max_files:
            pct = percentiles(st.feature(feature, c['t']))
            for m in mods: hist[bin_of(pct[m])] += 1; n += 1
        st.apply(c)
    widths = [BINS[0]] + [min(1, BINS[i]) - BINS[i - 1] for i in range(1, len(BINS))]
    # add-one smoothing toward LR = 1
    return [((hist[i] + widths[i] * 10) / (n + 10)) / widths[i] for i in range(len(BINS))], n

def load_tasks(repo):
    out = []
    for f in sorted(glob.glob(REPOS[repo]['tasks'] + '/*.json')):
        t = json.load(open(f))
        if 'task_id' in t: out.append(t)
    return out

def states_at_cuts(commits, tasks):
    """task_id -> (State as of the cut, cut time). Bug tasks: strictly before the fix merge commit; others: whole log."""
    idx = {c['h']: i for i, c in enumerate(commits)}
    cuts = {}
    for t in tasks:
        snap = t.get('snapshot', {})
        if snap.get('kind') == 'revert_fix':
            m = t['source']['merge_commit']
            if m not in idx: raise SystemExit(f"{t['task_id']}: merge commit {m} not on the first-parent path log")
            cuts[t['task_id']] = idx[m]            # commits[0:idx] are strictly earlier
        else:
            cuts[t['task_id']] = len(commits)
    import copy
    out = {}; st = State(); pos = 0
    for tid, cut in sorted(cuts.items(), key=lambda kv: kv[1]):
        while pos < cut: st.apply(commits[pos]); pos += 1
        now = commits[cut]['t'] if cut < len(commits) else commits[-1]['t']
        out[tid] = (copy.deepcopy(st), now)
    return out
