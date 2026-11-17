# Changelog

## 0.2.0 (2026-11-18)

- **More languages.** JavaScript now goes through the TypeScript compiler, like TypeScript.
  Go, Java, Kotlin, Scala, C#, Rust, C, C++, Ruby, PHP and Swift share a new tree-sitter engine. It resolves calls
  through `this`/`self`, declared types, constructors, imports, packages and return types.
  - On 13 open-source repositories, 151 of 156 hand-checked verified call edges were correct ([experiment 7](experiments/07-languages/)).
  - Name-only guesses are kept only in the languages where they measured at least 50% correct.
  - Search and graph ranking are benchmarked on TypeScript and, for retrieval only, on Python.
  - **Python, SWE-bench Lite** (300 issues, [experiment 5](experiments/05-swebench-python/findings.md)): Recall@10 0.47,
    against 0.35 for code-review-graph with embeddings and 0.15 for graphify. The Python call graph itself adds nothing
    measurable there (−0.02, not significant).
- **Faster tool calls.** `find_relevant_code` answers 13× faster on a 63k-line repository (730 → 54 ms) and 46× faster on a
  763k-line one (13.3 s → 0.29 s), with byte-identical output ([experiment 6](experiments/06-next-direction/findings.md)).
- **Indexing skips** build output, dependency folders, generated code and files over 1 MB in every language.
- **CI** runs type-checking, the build and the test suite on every push.

## 0.1.0

- First release: TypeScript code search plus a typed call graph, served over MCP (`typetrace-cli`).
