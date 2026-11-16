#!/usr/bin/env python3
"""Large-sample FILE-level check (pure Python, small memory): does change history add to lexical code retrieval?

Query sets:
  cand   : mined bug-fix candidates (real issue / PR text), excluding every task of the frozen TEST split
  commits: historical fix commits of the last year, commit subject as the query (leaky text; paired comparison only)
Arms (file score, each normalised by its per-query max):
  code            BM25 over file contents of the pinned tree (files existing at the cut)
  code*prior      code x LR(freq90 percentile)^beta
  code+hist       code + w * hist, hist = sum over the K most similar EARLIER commit subjects of sim / |files|^0.5
  hist only, code+hist*prior
History is cut strictly before the fix's merge commit."""
import sys, os, re, json, math, datetime
from array import array
from collections import defaultdict, Counter
from hist_lib import *

STOP = set('''a an and are as at be been being but by can could did do does doing done for from had has have having he her his how i if in into is it its
just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this
those through to too under until up very was we were what when where which while who whom why will with would you your also after again against all am any because
before below between both down during each few further here let may might must us one two get got even still instead though however always never
see look issue issues bug bugs problem problems expected expect actually really already yet ever without within across via etc fix fixes fixed
const var function return async await new class extends implements interface type import export from default public private protected readonly static void null
undefined true false string number boolean any unknown typeof instanceof in of as is promise ts js'''.split())
def stem(w):
    for suf in ('ations', 'ation', 'ings', 'ing', 'ies', 'ed', 'es', 's'):
        if w.endswith(suf) and len(w) - len(suf) >= 3: return w[:-len(suf)]
    return w
SPLIT = re.compile(r'([a-z0-9])([A-Z])')
def tokenize(text):
    out = []
    for w in re.findall(r'[A-Za-z_$][A-Za-z0-9_$]*', text):
        for p in re.sub(r'[_\-$]+', ' ', SPLIT.sub(r'\1 \2', w)).split():
            lw = p.lower()
            if len(lw) < 2 or lw in STOP: continue
            out.append(stem(lw))
    return out

class BM25:
    def __init__(self, docs_tokens, k1=1.2, b=0.75):
        self.n = len(docs_tokens); self.len = [len(t) for t in docs_tokens]
        self.avg = sum(self.len) / max(1, self.n); self.k1, self.b = k1, b
        self.post = {}
        for i, toks in enumerate(docs_tokens):
            for t, f in Counter(toks).items():
                p = self.post.get(t)
                if p is None: p = self.post[t] = (array('i'), array('H'))
                p[0].append(i); p[1].append(min(f, 65535))
    def scores(self, qtoks, allowed=None):
        sc = defaultdict(float)
        for t, qf in Counter(qtoks).items():
            p = self.post.get(t)
            if not p: continue
            idf = math.log(1 + (self.n - len(p[0]) + 0.5) / (len(p[0]) + 0.5))
            for i, f in zip(p[0], p[1]):
                if allowed is not None and i not in allowed: continue
                sc[i] += qf * idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
        return sc

def run(repo, mode):
    R = REPOS[repo]
    src_root = f"{ROOT}/targets/exp3/{'immich/server' if repo == 'immich' else 'twenty/packages/twenty-server'}"
    files = []
    for dp, dn, fn in os.walk(src_root + '/src'):
        for f in fn:
            if f.endswith('.ts') and not f.endswith('.d.ts'): files.append(os.path.relpath(os.path.join(dp, f), src_root))
    files.sort(); fid = {f: i for i, f in enumerate(files)}
    code = BM25([tokenize(f + ' ' + open(os.path.join(src_root, f), encoding='utf8', errors='replace').read()) for f in files])
    commits = load_log(repo); cidx = {c['h']: i for i, c in enumerate(commits)}
    subj = BM25([tokenize(c['s']) for c in commits])
    cfiles = [[fid[p] for st, p in c['files'] if st != 'D' and p in fid] for c in commits]
    T0 = int(datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc).timestamp())
    lr, _ = lr_table(commits, 'freq90', T0 - 365 * DAY, T0)
    test_ids = {t['task_id'] for t in load_tasks(repo) if t['split'] == 'test'}
    queries = []   # (id, text, cut index, gt file ids)
    if mode == 'cand':
        for l in open(f'{ROOT}/experiments/03-graph-scale/dataset/candidates/{repo}.jsonl'):
            d = json.loads(l)
            if f"{repo}_pr{d['pr']}" in test_ids: continue
            cut = cidx.get(d['merge_commit'])
            if cut is None: continue
            gt = {fid[f[len(R['prefix']):]] for f in d['fixed_files'] if f[len(R['prefix']):] in fid}
            text = (d.get('issue_title') or '') + '\n' + (d.get('symptom_report') or '')
            if gt: queries.append((f"pr{d['pr']}", text, cut, gt, d.get('report_source')))
    else:
        t_lo = commits[-1]['t'] - 365 * DAY
        test_merges = {t['source']['merge_commit'] for t in load_tasks(repo) if t['split'] == 'test' and t.get('snapshot', {}).get('kind') == 'revert_fix'}
        for i, c in enumerate(commits):
            if c['t'] < t_lo or not FIX.search(c['s']) or c['h'] in test_merges: continue
            mods = {fid[p] for st, p in c['files'] if st == 'M' and not TEST.search(p) and p in fid}
            if 1 <= len(mods) <= 5: queries.append((c['h'][:8], re.sub(r'\(#\d+\)', '', c['s']), i, mods, 'subject'))
    queries.sort(key=lambda q: q[2])
    st = State(); pos = 0
    arms = defaultdict(list)
    K = 50
    for qid, text, cut, gt, src in queries:
        while pos < cut: st.apply(commits[pos]); pos += 1
        now = commits[cut]['t']
        existing = {fid[f] for f in st.last if f in fid}
        if not (gt & existing): continue
        gt = gt & existing
        q = tokenize(text)
        cs = code.scores(q, existing)
        ss = subj.scores(q)
        sims = sorted(((s, i) for i, s in ss.items() if i < cut), reverse=True)[:K]
        hs = defaultdict(float)
        for s, i in sims:
            fl = [f for f in cfiles[i] if f in existing]
            for f in fl: hs[f] += s / math.sqrt(len(fl))
        pct = percentiles(st.feature('freq90', now))
        prior = {fid[f]: lr[bin_of(p)] for f, p in pct.items() if f in fid}
        mc = max(cs.values(), default=1) or 1; mh = max(hs.values(), default=1) or 1
        def rank(score):
            order = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))
            r = next((j + 1 for j, (f, _) in enumerate(order) if f in gt), None)
            top10 = {f for f, _ in order[:10]}
            return (1 / r if r else 0, 1 if r and r <= 1 else 0, 1 if r and r <= 5 else 0, 1 if r and r <= 10 else 0, len(gt & top10) / len(gt))
        allf = set(cs) | set(hs)
        variants = {
            'code': {f: cs[f] / mc for f in cs},
            'hist': {f: hs[f] / mh for f in hs},
            'code*prior^.25': {f: cs[f] / mc * prior.get(f, 1) ** .25 for f in cs},
            'code*prior^.5': {f: cs[f] / mc * prior.get(f, 1) ** .5 for f in cs},
            'code+0.5hist': {f: cs.get(f, 0) / mc + 0.5 * hs.get(f, 0) / mh for f in allf},
            'code+1hist': {f: cs.get(f, 0) / mc + 1.0 * hs.get(f, 0) / mh for f in allf},
            'code+2hist': {f: cs.get(f, 0) / mc + 2.0 * hs.get(f, 0) / mh for f in allf},
            '(code+1hist)*prior^.25': {f: (cs.get(f, 0) / mc + hs.get(f, 0) / mh) * prior.get(f, 1) ** .25 for f in allf},
        }
        for name, sc in variants.items(): arms[name].append(rank(sc))
        arms['_src'].append(src)
    n = len(arms['code'])
    print(f'\n=== {repo} / {mode}: {n} queries, {len(files)} files, {len(commits)} commits')
    print(f'{"arm":24s} {"MRR":>6s} {"hit@1":>6s} {"hit@5":>6s} {"hit@10":>7s} {"fileR@10":>9s}   paired vs code: dMRR  W/L')
    base = arms['code']
    for name, rows in arms.items():
        if name.startswith('_'): continue
        m = [sum(r[k] for r in rows) / n for k in range(5)]
        d = [rows[i][0] - base[i][0] for i in range(n)]
        w = sum(1 for x in d if x > 1e-9); l = sum(1 for x in d if x < -1e-9)
        print(f'{name:24s} {m[0]:6.3f} {m[1]:6.2f} {m[2]:6.2f} {m[3]:7.2f} {m[4]:9.3f}   {sum(d)/n:+.3f}  {w}/{l}')
    if mode == 'cand':
        for s in sorted(set(arms['_src'])):
            ix = [i for i in range(n) if arms['_src'][i] == s]
            print(f'  report_source={s} n={len(ix)}: ' + '  '.join(f"{nm} MRR {sum(arms[nm][i][0] for i in ix)/len(ix):.3f} R@10 {sum(arms[nm][i][4] for i in ix)/len(ix):.3f}" for nm in ('code', 'code+1hist', '(code+1hist)*prior^.25')))
    json.dump({k: v for k, v in arms.items()}, open(f'{S}/silver-{repo}-{mode}.json', 'w'))

if __name__ == "__main__":
  for repo in sys.argv[2].split(','): run(repo, sys.argv[1])
