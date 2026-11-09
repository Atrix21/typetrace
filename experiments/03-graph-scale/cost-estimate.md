# Experiment 3: cost estimate for the agent stage (planning only, NOT approved, NOT run)

**Status (milestone 2).** This replaces the milestone-1 estimate, which was inconsistent: it quoted a 120-run pilot in `cost-estimate.md` and a "30-run pilot plus 270 runs" alternative in the README.
- **One source.** There is now a single model, `scripts/exp3/cost-model.py`. Its output is in `results/agent-cost-model.md` and `.json`.
- **Task counts.** The model reads the task counts from the frozen dataset (`dataset/v2/FROZEN.json`): M 11 dev / 26 test, L 6 dev / 18 test.
- **Nothing was run.** Milestone 2 made no model calls.

## 1. What a run is

A run is one Claude Code headless session on one task snapshot, with experiment 2's harness, isolation profile, account binding and limit handling. The agent returns a structured answer, which is scored automatically.

| Parameter | Value | Basis |
|---|---|---|
| Arms | A0 baseline (Read, Grep, Glob)<br>A1 + `find_relevant_code`, compact_nograph<br>A2 + `find_relevant_code`, compact_graph<br>A3/A4 = A2/A1 without Grep | protocol §5. A1 and A2 have byte-identical tool schemas and an 800-token cap |
| Models, effort | Haiku 5.5 at effort high; Sonnet 5.5 at effort high | experiment 2 used Sonnet at effort high |
| Repeats | Haiku 3 per task × arm; Sonnet 2 | single-run noise is 2–6 points (`notes/external-research.md` §4) |
| Caps | 40 turns per run; 800-token tool output | protocol §5 |

## 2. Per-run token and price assumptions (ASSUMPTIONS until a pilot measures them)

Experiment 2 measured about 5 turns, about 19.5k tokens and $0.022 per Sonnet run on easy tasks in a 6k-line repository. Tasks on M and L are expected to take 15–30 turns.

| Level | Input-side tokens processed per run (mostly cache reads) | 1-hour cache writes | Uncached input | Output |
|---|---:|---:|---:|---:|
| low | 300k | 30k | 5k | 4k |
| central | 600k | 50k | 8k | 8k |
| high | 1.5M | 80k | 12k | 15k |

Prices are list prices from the Claude API reference:
- **Sonnet 5.5:** $2 input / $10 output per MTok; cache read $0.20; 1-hour cache write 2× input.
- **Haiku 5.5:** $0.10 / $0.50, with prompts over 100K tokens billed at 5×; cache read $0.01; 1-hour write $0.20. The high level assumes 40% of Haiku's processed tokens fall in prompts over 100K tokens.

| Per run (list price) | low | central | high |
|---|---:|---:|---:|
| Sonnet 5.5 | $0.22 | $0.40 | $0.78 |
| Haiku 5.5 | $0.011 | $0.027 | $0.089 |

## 3. Plans

**Minimum viable** (tests H3/H4 where the effect should be largest): L only, Haiku 5.5, arms A0/A1/A2.

| Stage | Tasks | Arms | Repeats | Runs | List price (low / central / high) |
|---|---:|---:|---:|---:|---|
| pilot (dev) | 6 | 3 | 1 | 18 | $0.2 / $0.5 / $1.6 |
| main (test) | 18 | 3 | 3 | 162 | $1.8 / $4.4 / $14 |
| **total** | | | | **180** | **$2 / $5 / $16** |

About 108M input-side tokens (central, mostly cache reads) and 1.4M output tokens. Sequential wall clock 4–15 h.

**Full scale:** M + L; Haiku A0–A2 × 3; no-Grep A3/A4 on L × 3; Sonnet 5.5 A0/A2 on L × 2.

| Stage | Repo | Model | Tasks | Arms | Repeats | Runs | List price (low / central / high) |
|---|---|---|---:|---:|---:|---:|---|
| pilot (dev) | M+L | Haiku | 17 | 5 | 1 | 85 | $1 / $2 / $8 |
| pilot (dev) | L | Sonnet | 6 | 2 | 1 | 12 | $3 / $5 / $9 |
| main (test) | M+L | Haiku | 44 | 3 | 3 | 396 | $4 / $11 / $35 |
| main (test) | L | Haiku | 18 | 2 | 3 | 108 | $1 / $3 / $10 |
| main (test) | L | Sonnet | 18 | 2 | 2 | 72 | $16 / $29 / $56 |
| **total** | | | | | | **673** | **$25 / $50 / $117** |

About 404M input-side tokens and 5.4M output tokens (central). Sequential wall clock 17–56 h.

## 4. Subscription usage versus direct API expenditure

| | Subscription (Claude Code login, e.g. the personal Pro plan) | API key |
|---|---|---|
| Direct charge | none per call | the list price above is the actual bill |
| What is consumed | plan usage limits (5-hour windows, weekly cap), shared with the owner's own use | money only; plan limits untouched |
| Estimated usage | **Minimum viable: about 0.2–1.5 Pro windows. Full scale: about 2.3–10.7 windows** (ASSUMPTION: usage tracks list price, calibrated on experiment 2: $33.99 list ≈ three 5-hour windows) | $2–16 (minimum) / $25–117 (full) |
| Risk | the Sonnet portion of the full plan (about $16–56) dominates; the weekly cap may stop a run before it finishes | none beyond spend; caps enforced by the harness |

Supporting work also uses plan usage, even though it is not billed per call:
- **Sessions and sub-agents already used.** This session and its sub-agents consume the plan they run on. Milestone 2's sub-agents used about 1.6M Sonnet tokens in total: mining 0.26M, audits 0.23M + 0.04M + 0.34M, understanding-task conversion 0.05M, plus the edge audit.
- **Before an agent stage.** A further independent audit of agent prompts and arms would cost about 0.1–0.2M.

## 5. Controls (unchanged from experiment 2; all tested)

- **Approval:** `APPROVAL.json` names stage, account, billing mode, model, maximum runs, per-run cap and total cap.
- **Spend tracking:** an append-only spend ledger.
- **Execution:** strictly sequential runs on the named account.
- **Halts:** the run halts on a usage limit, and the limit is never counted as an attempt.
- **Zero-cost rehearsal:** every new arm is dry-run against a mock Messages API before any real call.
- **Calibration:** the per-run cap is set from the pilot's measured cost, not from these estimates. If the pilot's central cost per run exceeds this model's high estimate, the stage stops for re-approval.
