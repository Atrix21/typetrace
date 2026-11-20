# Changelog

## 0.3.1 (2026-11-20)

- The MCP Registry name is `io.github.Atrix21/typetrace` (the registry matches the GitHub account's case). No code
  changes from 0.3.0.

## 0.3.0 (2026-11-20)

- **Claude Code setup.** For Claude Code, `init` and `install` now also write the kind of setup graphify and
  code-review-graph install, so the agent knows the tool is there: a short block in `CLAUDE.md` (between
  `<!-- typetrace -->` markers; the rest of the file is kept), a skill (`.claude/skills/typetrace/SKILL.md`) and a
  PreToolUse hook (`.claude/hooks/typetrace-nudge.mjs`, registered in `.claude/settings.json`). The hook never blocks a
  call. Before a search or a read it adds one sentence saying the repository is indexed, at most 5 times per session
  (`TYPETRACE_NUDGE_CAP`), and stays quiet while TypeTrace has been queried in the last 30 minutes. `--no-setup`
  registers the MCP server only; `uninstall` removes all of it.
- Experiment 10 (346 SWE-bench issues, 10 languages, 3,460 agent runs): no tool changed how often the agent found
  the code (all arms 0.81), and TypeTrace's tokens equalled grep's. The README's token claim is narrowed to tasks that
  span several files ([findings](experiments/10-swebench-agents/findings.md)).

## 0.2.0 (2026-11-19)

- **Usable in minutes, not hours.** `init` returns once the call graph and the keyword index are built (81 s on a
  763k-line repository). The embeddings follow in a background job at low priority, and the server switches over by
  itself. Up to about 60k lines this fast mode loses nothing measurable. On a 763k-line repository its answers are clearly
  worse (Recall@10 0.17 instead of 0.28) until the embeddings are done, and identical after
  ([experiment 9](experiments/09-fast-first-index/)).
  `--wait` keeps the old behaviour, and `--no-embed` skips the model altogether.
- **The index keeps itself current.** The server rescans the indexed files, rebuilds in the background when edits
  settle, embeds only the changed code, and reloads without making queries wait.
- **Nine AI coding tools.** `init`/`install` register TypeTrace with Claude Code, Cursor, VS Code (GitHub Copilot),
  Codex, Gemini CLI, OpenCode, Kiro, Windsurf and Zed. They merge into existing configuration and never rewrite a
  file they cannot parse. `uninstall` removes the entries.
- **`typetrace status`** shows what is indexed, what changed since, and the progress of background jobs.
- Fixed: a flag without a value (`--gpu`) no longer swallows the repository argument.
- **More languages.** JavaScript now goes through the TypeScript compiler, like TypeScript.
  Go, Java, Kotlin, Scala, C#, Rust, C, C++, Ruby, PHP and Swift share a new tree-sitter engine. It resolves calls
  through `this`/`self`, declared types, constructors, imports, packages and return types.
  - On 13 open-source repositories, 151 of 156 hand-checked verified call edges were correct ([experiment 7](experiments/07-languages/)).
  - Name-only guesses are kept only in the languages where they measured at least 50% correct.
  - Search and graph ranking are benchmarked on TypeScript; retrieval alone also on Python and nine more languages.
  - **Python, SWE-bench Lite** (300 issues, [experiment 5](experiments/05-swebench-python/findings.md)): Recall@10 0.47,
    against 0.35 for code-review-graph with embeddings and 0.15 for graphify. The Python call graph itself adds nothing
    measurable there (−0.02, not significant).
  - **Nine more languages, SWE-bench Multilingual** (300 issues, [experiment 8](experiments/08-swebench-multilingual/findings.md)):
    Recall@10 0.39, against 0.26 for code-review-graph with embeddings and 0.12 for graphify, ahead of both in every
    language. The call graph adds nothing measurable there either (−0.002).
- **Faster tool calls.** `find_relevant_code` answers 13× faster on a 63k-line repository (730 → 54 ms) and 46× faster on a
  763k-line one (13.3 s → 0.29 s), with byte-identical output ([experiment 6](experiments/06-next-direction/findings.md)).
- **Indexing skips** build output, dependency folders, generated code and files over 1 MB in every language.
- **CI** runs type-checking, the build and the test suite on every push to `main` and on every pull request.

## 0.1.0

- First release: TypeScript code search plus a typed call graph, served over MCP (`typetrace-cli`).
