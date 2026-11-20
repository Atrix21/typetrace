# Experiment 12: working on one codebase across many sessions (DRAFT, not frozen)

Status: draft. Nothing here runs until experiment 11 has finished, the owner has decided the open questions at the
end, the harness passes its checks, the protocol is frozen and the owner gives the go.

## Why

Experiments 2, 3, 10 and 11 each measure one task in one brand-new session. That is the cold start: the tool's index
exists, but the agent remembers nothing. On SWE-bench issues no tool beat grep there (experiment 10).

Developers do not work that way. They come back to the same repository day after day. Each new session re-learns the
codebase, and long sessions are compacted, after which the agent often re-reads code it had already seen. Code-graph
tools are sold partly on this. graphify keeps a persistent graph and a written report, and has a hook for compaction.
code-review-graph has an architecture overview and change detection. If a persistent index pays off, the place to look
is the cost of re-learning, summed over many sessions. A single session cannot show it.

Claude Code has its own answer: project memory (CLAUDE.md and notes the agent writes for itself). Any tool has to beat
that free baseline, not only grep.

**What TypeTrace can and cannot do here (at 0.3.x).**
- **Can:** its index persists on disk and keeps itself current after edits, a `git pull` or a branch switch. Every
  session gets a fast, fresh search.
- **Cannot:** it keeps no memory of past sessions, has no codebase overview, cannot answer "what changed since my last
  session", and does nothing after a compaction.
- So as shipped, it can only repeat its per-session effect. Open decision 1 is whether to test it as is, or after
  adding continuity features.

## Questions

1. **Separate sessions.** Over a sequence of related tasks in one repository, each in a new session, does a tool (with
   its vendor's setup) lower the total tokens of the sequence compared with grep alone? Does it lower them compared
   with grep plus Claude Code's own project memory?
2. **One long session.** In one session that works through the whole sequence and is compacted along the way, does a
   tool lower the total tokens, or the re-reading after compaction?
3. **Accuracy.** Does any of this change how often the agent finds the code to change, task by task?
4. **Learning curve.** Does the cost of task k fall faster with k under a tool than under grep or memory?

## Data: chains of related issues

- **Source:** the multi-file pool of experiment 11 (SWE-bench full test split outside Lite, SWE-PolyBench), plus the
  single-file instances of the same repositories, minus every instance used in experiments 5, 8, 10 and 11.
- **A chain** is 5 to 6 issues of one repository in time order (`created_at`). Each issue's gold patch changes at
  least one file that an earlier issue in the chain changed, so later tasks can profit from earlier exploration. A
  first count on the pools found 428 such chains, most from django (101), svelte (62), material-ui (45), serverless
  (38), sympy (33) and sphinx (21).
- **The repository evolves.** Each task runs at its own issue's base commit. Between tasks the workspace is moved to
  the next base commit (`git checkout`), as a developer's checkout moves between sessions. Each tool must keep up in its
  own way: TypeTrace's server rescans, graphify's and code-review-graph's hooks rebuild, Claude Code's memory may be
  stale. That is part of what is measured.
- **Ground truth:** per task, the functions its gold patch changes (experiment 8's rule, unchanged).
- **Sampling:** chains stratified by language and capped per repository (at most 15% of chains from one repository),
  seeded and frozen before any run. *n* comes from a pilot, as in experiment 11.

## Conditions

Two factors: the tool, each with its vendor's setup as captured in experiment 11, and the session mode.

| Tool | Setup |
|---|---|
| G0 | Claude Code's base tools only (Read, Grep, Glob, Skill, sandboxed Bash) |
| TS | TypeTrace with its Claude Code setup (version per open decision 1) |
| GF | graphify, as in experiment 11 |
| CR | code-review-graph, as in experiment 11 |

| Session mode | What happens between tasks |
|---|---|
| **Fresh** | Every task is a new session. Nothing carries over except the tool's own index. |
| **Memory** | Every task is a new session, and Claude Code's project memory is on: the agent may write notes into the project (CLAUDE.md or its memory file) at the end of a task, and they are loaded in the next session. |
| **Continued** | One session works through the chain: after each answer, the next issue is given in the same session. Claude Code compacts the context when it fills, as for a user. |

Primary comparisons are within each session mode: each tool against G0. In addition, G0-Memory and G0-Continued are
compared against G0-Fresh (what Claude Code's own mechanisms are worth). If the full design is too large, the minimum
is the Fresh and Memory modes with G0 and TS (open decision 2).

The harness, isolation, sandbox, prompts, answer schema and scoring are experiment 11's, unchanged except for what the
session modes require.

## Outcomes

- **Primary:** total tokens over the chain (input, output and cache), per chain.
- **Per task:**
  - a changed function among the first three;
  - recall of the changed functions;
  - tokens;
  - turns.
- **Re-reading:** in tasks 2 to *k*, the share of Read calls on files already read earlier in the chain, and their
  tokens.
- **Learning curve:** the slope of log tokens over task position within the chain.
- **Secondary:** session time; tool use; how often compaction happened (Continued mode); the size of the memory the
  agent wrote (Memory mode).

## Tests

The unit is the chain. Tests are paired sign-flip permutation tests, two-sided, with bootstrap CIs and Holm within
each family, as in experiment 11.
- **Family C1 (tokens, Fresh mode):** each tool against G0 (3 tests).
- **Family C2 (tokens, Memory mode):** each tool against G0-Memory (3 tests).
- **Family C3 (Claude Code's own mechanisms, tokens):** G0-Memory against G0-Fresh, and G0-Continued against G0-Fresh
  (2 tests).
- **Family A (accuracy, mean over the chain's tasks, Fresh and Memory modes):** each tool against G0 (6 tests).

Everything else is exploratory: Continued mode between tools, re-reading, the learning curve and splits by language.

## Fairness rules

The fairness rules of experiment 11 apply unchanged, and three more are added:
1. **Feature rules.** If TypeTrace gets continuity features (open decision 1), they follow the rules of experiment
   11's TS setup:
   - generic product features for any repository;
   - written and released publicly before the pilot;
   - never tuned on this experiment's data.

   The competitors' existing continuity features (graphify's report and compaction hook, code-review-graph's overview
   and change detection) are used as their setups install them.
2. **Same memory for everyone.** Claude Code's project memory is the same mechanism, with the same wording to enable
   it, in every tool's Memory arm.
3. **Same sequence for everyone.** Every condition sees the same chains, in the same order, at the same commits.

## Risks to the design, stated up front

- **Continued mode is hard to control.** Compaction depends on context length, which differs between tools. That is
  why it is exploratory only.
- **Ordering effects.** A tool whose index update lags behind a checkout could answer about the previous commit. Index
  freshness is logged per task (which commit the index reflects when the session starts).
- **Cost.** At 5 to 6 tasks per chain, 4 tools, 3 modes and 2 repeats, each chain costs about 130 runs. The pilot sets
  *n*, and the minimum design (open decision 2) costs about a third of that.

## Open decisions for the owner

1. **TypeTrace version.**
   - **Option A: test 0.3.x as is.** This answers whether a persistent search index alone helps across sessions.
   - **Option B: first build and release continuity features**, under the feature rules above:
     - a working set (what the agent searched and then read, offered to the next session);
     - an overview of the codebase from the call graph;
     - "changed since your last session";
     - a post-compaction hook.

     Option B tests TypeTrace at its best. It takes product work first.
   - **Option C:** both, as two TypeTrace arms (like TT and TS in experiment 11).
2. **Size.** The full design (4 tools × 3 modes) or the minimum (G0 and TS × Fresh and Memory) first.
3. **Model.** Claude Haiku 5.5 as in experiments 10 and 11, or also a Sonnet subset (more likely to use memory well,
   at a higher cost to the usage limits).
