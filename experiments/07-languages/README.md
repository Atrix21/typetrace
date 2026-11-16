# Experiment 07: language support (graph quality on real repositories)

**Question.** TypeTrace started as TypeScript-only (later Python). Do the new front-ends build a graph that is
correct enough to be useful in the languages the compared tools support?

**What this is and is not.** It is an engineering validation of the call graph: does each edge point at the right
code? It is **not** a retrieval or agent benchmark. There are no ground-truth tasks for these languages, so nothing
here says search gets better in Go or Java; only the TypeScript and Python benchmarks (experiments 3 and 5) say
anything about retrieval. It was not pre-registered: the sample was judged, and the guessing policy was then set from
those judgements (see Limitations).

## What was built

| Language | Front-end | How calls are resolved |
|---|---|---|
| TypeScript, JavaScript | TypeScript compiler (`allowJs` for JavaScript) | compiler symbols and types; CommonJS and ES modules |
| Python | tree-sitter, scope resolution (`src/languages/python.ts`, unchanged) | scopes, imports, MRO, `self.x = X()` |
| Go, Java, Kotlin, Scala, C#, Rust, C, C++, Ruby, PHP, Swift | tree-sitter, one engine with one adapter per language (`src/languages/syntactic.ts`) | `this`/`self`; declared types of fields, parameters and locals; constructor initialisers; static calls; imports and packages; chained calls through declared return types; Java, Kotlin and Scala resolve across each other |

An edge is `static_verified` when the target follows from the syntax and declared types, and `semantic_inferred`
(confidence 0.1 to 0.5) when only a name matched (at most 3 candidates). Name-only guesses are kept only for the kinds
and languages where they measured at least 50% precise below. A receiver whose declared type is outside the repository
(standard library, dependency) gets no edge.

Grammars: tree-sitter-wasms, except Scala and Kotlin, which are newer builds vendored in `grammars/`. On the
repositories below, the old Scala grammar failed on 19 of 29 files and the new one on 0; Kotlin went from 11 of 86 to
2 of 86. Newer C, C++ and C# grammars were tried and not adopted (C and C++: identical error counts; C#: fewer files
with errors but 18× more error nodes).

## Evidence

**1. Fixtures** (`tests/languages/syntactic.test.ts`, 13 tests). There is one multi-file project per language, plus JavaScript. Each one
asserts the edges a reader would draw: `this`/`self`, declared-type receivers, constructors, static calls, imports
across files, inherited methods and return-type chains. It also asserts that standard-library calls produce no edge.

**2. Real repositories** (`scripts/languages/report.ts`; `results/final/`). These are the project's own file
selection and graph build, without embeddings, on a 15 GB laptop. Build time is the graph only.

| Repository | Source | Files | Graph build | Verified calls | Name-guessed calls | Files the grammar did not fully parse |
|---|---|---|---|---|---|---|
| Alamofire | Alamofire/Alamofire `dea4bab` | 101 Swift, 6 JavaScript | 7.0 s | 5,816 | 421 | swift 10/101 |
| cobra | spf13/cobra `adbc881` | 36 Go | 0.5 s | 2,075 | 146 | 0 |
| express | expressjs/express `43fca52` | 142 JavaScript | 1.6 s | 2,202 | 0 | 0 |
| gin | gin-gonic/gin `0f09c3a` | 98 Go | 0.8 s | 3,377 | 331 | 0 |
| gson | google/gson `e67037d` | 268 Java | 1.6 s | 17,809 | 0 | 0 |
| jq | jqlang/jq `5c001b1` | 27 C, 24 C++, 5 Python, 1 JavaScript | 1.5 s | 4,065 | 1,296 | c 16/27, cpp 7/24 |
| moshi | square/moshi `889013e` | 86 Kotlin, 57 Java | 1.2 s | 6,382 | 419 | kotlin 2/86 |
| ripgrep | BurntSushi/ripgrep `178cc02` | 102 Rust, 1 Ruby | 1.4 s | 4,775 | 549 | rust 1/102 |
| scopt | scopt/scopt `270222e` | 29 Scala | 0.9 s | 773 | 789 | 0 |
| serilog | serilog/serilog `43105b3` | 217 C# | 0.7 s | 3,229 | 706 | csharp 26/217 |
| sinatra | sinatra/sinatra `cb22afd` | 147 Ruby | 0.8 s | 2,087 | 0 | 0 |
| Slim | slimphp/Slim `8d872ae` | 125 PHP | 0.5 s | 1,469 | 0 | 0 |
| spdlog | gabime/spdlog `6d9805d` | 153 C++, 1 Python | 1.6 s | 2,441 | 802 | cpp 125/153 |

Most calls in every repository stay unresolved: standard library, dependencies, and receivers of unknown type. Each
report's `notes` give the exact split.

**3. Hand-checked precision** (`results/hand-checked-run/hand-check.json`). Per repository, a sample was drawn,
seeded by a hash of the edge id: 12 verified and 12 name-guessed CALLS edges into repository code. Each was judged
against the call site, and against the source when the call text was not enough. 300 edges were judged, before the
guessing policy was set.

| Language | Verified edges correct | Name guesses on unknown receivers | Bare-name guesses |
|---|---|---|---|
| Go | 24/24 | 17/24 (71%), kept | |
| Java | 20/20 | 2/17 (12%), dropped | |
| Kotlin | 4/4 | 4/7 (57%), kept | |
| Scala | 12/12 | 7/12 (58%), kept | |
| C# | 10/12 | 7/12 (58%), kept | |
| Rust | 12/12 | 2/9 (22%), dropped | 3/3, kept |
| C | 11/11 | | 12/12, kept |
| C++ | 9/12 | 2/2, kept | 7/7, kept; namespace-qualified 0/3, dropped |
| Ruby | 12/12 | 2/11 (18%), dropped | 0/1, dropped |
| PHP | 12/12 | 1/12 (8%), dropped | |
| Swift | 12/12 | 10/12 (83%), kept | |
| JavaScript (compiler) | 12/12 | | |
| Python (jq's docs script) | 1/1 | | |

Verified edges were 151 of 156 correct (97%). All 5 errors are declarations mis-nested after a grammar parse error
(C++ macros in spdlog's bundled fmt; one C# file in serilog). In each case the edge still points at the right
function body, under a wrong qualified name. Overloads are not told apart: a call links to every overload of the
right method on the right class, and this was counted as correct.

**4. No regression in the benchmarked languages.** The graph and symbol index hashes are identical before and after this work
for TypeScript (`targets/bench`: 2,442 nodes, 7,441 edges) and for Python (psf/requests and pallets/flask). So the
published experiment 3 and 5 numbers describe this code.

## Limitations

- **Precision, not recall.** Missing edges were not measured.
- **One judge, small samples.** I (Claude, the author of the code) judged every edge. With 12 per class, the 95% confidence
  interval on 7/12 is about 32% to 81% (Wilson). The keep-or-drop line was drawn on the same sample it was measured
  on, so the kept guess classes are slightly flattered.
- **Grammars.** C and C++ code with heavy macro use, and some C#, still parse with errors. Declarations after an error can
  be mis-nested.
- **Dynamic languages.** For Ruby and PHP, calls on receivers of unknown type now get no edge at all. Only `self`/`$this`,
  constructors, typed parameters and properties, and static calls resolve.
- **No retrieval benchmark** in these languages. TypeTrace's search ranking was tuned and benchmarked on TypeScript and
  Python only.

## Reproduce

```bash
for r in spf13/cobra gin-gonic/gin google/gson square/moshi scopt/scopt serilog/serilog BurntSushi/ripgrep \
         jqlang/jq gabime/spdlog sinatra/sinatra slimphp/Slim Alamofire/Alamofire expressjs/express; do
  git clone -q https://github.com/$r.git repos/$(basename $r)   # then check out the commit in the table
done
npx tsx scripts/languages/report.ts --out /tmp/lang repos/*
npx vitest run tests/languages
```
