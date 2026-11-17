# Contributing

Thanks for looking. TypeTrace is two things in one repository: the tool (`src/`, published to npm as `typetrace-cli`)
and the research behind it (`experiments/`, `paper/`). The rules differ a little between them.

## The tool

```bash
npm ci
npm run typecheck
npx vitest run          # about a minute; the full suite runs in CI on main and on every pull request
npm run build           # dist/, what npm ships
node bin/typetrace.js query <repo> "where is X handled?"
```

- **Language front-ends** live in `src/languages/`. Python has its own front-end; the other tree-sitter languages
  share `syntactic.ts`, with one adapter per language. A new adapter needs a test in `tests/languages/`. Links
  resolved only by name must stay labelled `inferred`, never `verified`.
- **The TypeScript graph** (`src/graph/`, `src/parser/`) must stay deterministic: building twice must give the same
  SHA-256.
- **Ranking changes** (`src/retrieval/`) change benchmark numbers. A change that is meant to keep outputs identical
  needs a byte-for-byte check against stored outputs, as in experiment 6. Any other change needs a new experiment,
  described below. The ranking is not re-tuned on benchmark test data.

## The research

Each experiment follows the same procedure:

1. **Protocol first.** `experiments/NN-name/protocol.md` states the question, the data, the methods, the primary
   metric and the confirmatory tests. Commit it before any method runs on the data.
2. **Decision log.** Every change to code or procedure after the protocol is committed goes into `decision-log.md`,
   with the reason and what was checked. Earlier numbers are kept.
3. **Findings report losses.** Null and negative results get the same space as wins.
4. **No raw benchmark code in git.** Retrieval outputs, agent transcripts and fix patches can contain code from the
   benchmark repositories, some of them AGPL. They stay git-ignored, and results reference them by commit and hash.
5. **One heavy job at a time.** Long runs go through `experiments/run-queue.sh`, which waits for free memory.

Paired tests are one-sided sign-flip permutation tests with bootstrap CIs, and Holm correction within each
pre-registered family. The existing analysis scripts (`scripts/exp3/analyse*.py`, `scripts/swebench/analyse.py`)
are the reference implementations.

## Competitors

graphify and code-review-graph are vendored at pinned commits (`vendor/manifest.json`, `scripts/setup-competitors.sh`)
and run as shipped. If you think a competitor is configured unfairly, please open an issue with the setting and its
documentation. Fixes to the harness are logged in the decision log, whichever way they cut.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence of this repository.
