# Vendored tree-sitter grammars

Most grammars come from the `tree-sitter-wasms` package. These two are newer builds, vendored because the older
ones failed to parse much modern code (measured on real repositories: Scala 19 of 29 files with syntax errors before,
0 after; Kotlin 11 of 86 before, 2 after; `experiments/07-languages/`).

| File | Source | Version | Licence | SHA-256 |
|---|---|---|---|---|
| `tree-sitter-scala.wasm` | npm `tree-sitter-scala` ([tree-sitter/tree-sitter-scala](https://github.com/tree-sitter/tree-sitter-scala)) | 0.24.0 | MIT, Copyright (c) 2018 Max Brunsfeld and GitHub | `b7ec2bb29c19827abcefd18ed5cb5a43596009f96a5d53c5b9d1f9676d7521c3` |
| `tree-sitter-kotlin.wasm` | npm `@tree-sitter-grammars/tree-sitter-kotlin` ([tree-sitter-grammars/tree-sitter-kotlin](https://github.com/tree-sitter-grammars/tree-sitter-kotlin)) | 1.1.0 | MIT, Copyright (c) 2024 Amaan Qureshi | `7009d69453bc8735e438b2818a633efb21c88f99782769abba60dffedfab73f7` |

Both licences permit redistribution with the copyright notice, which this file carries.
