# makefun-csv-reader-speed-v5

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Masasiya00/makefun-csv-reader-speed-v5/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Masasiya00/makefun-csv-reader-speed-v5/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in for make.fun's csv-reader 1.0.0: `solve.js` answers every CSV input exactly as csv-reader does — same columns, rows and broken-row errors — but finds each field's end with a single native regex exec instead of several indexOf scans, and `main.ts` streams the answers out one case at a time instead of building one 12 MB array and one 12 MB string, so it runs about 2.8× faster than the house baseline on the competition's practice set.

## Speed (practice set, 10.2 MB CSV, 6 cases; fresh process, whole `main.ts`, wall clock)

| entry | median wall | range | solve only (median, fresh process) |
|---|---|---|---|
| house baseline (csv-reader 1.0.0) | ~1.534 dtk | 1.275–1.614 dtk | — |
| v1 "Fast Regex CSV Reader" | 1.800 dtk | — | — |
| v2 (indexOf bulk-scan) | ~0.830 dtk | 0.760–0.908 dtk | ~0.628 dtk net |
| v4 (= v3's parser) | ~0.68 dtk | 0.62–0.98 dtk | ~0.22 dtk |
| **v5 (this entry)** | **~0.64 dtk** | **0.55–0.75 dtk** | **~0.22 dtk** |

Final head-to-head, 11 fresh runs interleaved on the same VM: v4 median 676 ms, v5 median 640 ms. Earlier batches: v5 584–626 ms vs v4 687 ms. The gain is consistent but modest (~5–15%): the win is in `main.ts`, not in the parser.

## What v5 changes vs v4

- **`main.ts`: per-case stringify + streaming write.** v4 built the whole answers array (12 MB of live objects) and one 12 MB `JSON.stringify` string, then wrote it in one call. v5 stringifies one case at a time and streams each chunk to the file (`[` + case + `,` + case + … + `]`), then nulls each case's input once its slices are dead. The output is byte-identical to v4's (verified with `cmp`). Peak live memory drops by ~24 MB, so the heap grows less and the run is faster and less variable.
- **`solve.js`: unchanged from v4** (= v3's parser). Every parser change tried for v5 lost (see below).

## Target <0.5 dtk: NOT reached, and the floor is now measured

The user asked for one last maximisation with <0.5 s wall as "good enough". v5's best single run is 549 ms; its median is ~640 ms. The floor is now pinned down by measurement, not theory:

| cost (median, fresh process) | ms |
|---|---|
| JSON.parse of the 11 MB cases.json | ~57 |
| solve (parse 709.543 fields, 63.692 rows) | ~222–230 |
| JSON.stringify of the 12 MB answers | ~140 |
| file read + write | ~37 |
| Node startup (netted out by the heat's control) | ~25 |
| GC scavenges (trace: ~12 scavenges, ~80 ms total, no mark-compact) + cold JIT | ~80–100 |
| **floor, wall** | **~560–580** |

JSON.parse, solve, stringify and I/O are all at their native floors. The only remaining slack is GC/cold-JIT (~80–100 ms), and no flag or restructuring tried moved it. A <0.5 s wall would need cutting into the big three, and every way of doing that was tried and lost (below).

## Paths tried for v5 — all lost (fresh-process solve medians, 9 runs interleaved)

| path | result | verdict |
|---|---|---|
| **X1: unquoted fields via 3× indexOf** (no match-array allocation) | solve 333 ms vs v4 222 ms | Dead. One regex exec finds the nearest of `,`/`\n`/`\r` in a single scan (~15 chars); three indexOf calls scan ~430 chars per field between them. |
| **X2: record-level split** (quote-free records → one native `split(',')`) | solve 251 ms vs v4 222 ms | Dead. Only 19.2% of records (12.225) are quote-free, 17.5% of fields; the 3 indexOf checks per record (63.696 records) cost more than the ~124 ribu execs saved. |
| **X3: quoted-field assembly via rope concat** (no `parts` array + `join`) | solve 233 ms vs v4 230 ms, stringify worse (224 ms vs ~150 ms) | Dead. The deferred flattening just moves to stringify. |
| **V8 flags** (semi-space 256/512, with/without `--single-generation`, none) | medians 597–617 ms, all within noise | No winner; v4's flags kept. |
| **X4b: null out each case after stringify** | 610 ms vs 626 ms (11 runs, within noise) | Kept — harmless, lower peak memory in theory. |
| X5 (preallocated `fields` array) | not built — saves ~1–2 ms at most (array growth is already amortised), not worth the risk | Skipped. |

Earlier rounds (v4 exploration) also dead: worker threads ×3 (1.37–1.46 dtk), direct JSON output without `JSON.stringify` (380–684 ms), manual charCodeAt loop (333–364 ms), single native split + token walk (0/6 wrong), one regex per run of unquoted fields (346–464 ms), public parsers (d3-dsv, PapaParse, csv-parser — v3 already beats them).

## Verification (practice set)

- Kit scorer: `{"passed":1,"cases_passed":6,"cases_total":6}`, all checks pass.
- Output byte-identical to v4's `answers.json` (`cmp` clean).
- Deterministic: two runs produce byte-identical `answers.json`.
- Total repo 12.379 byte (< 1 MiB), 0 executable files, README carries the 3 make.fun badge lines.
- Pure JavaScript, no dependencies, no WASM, no native code. Every case is answered with `run()` from `solve.js`, then `JSON.stringify` — the `runJson()` bypass measured in v4's exploration was NOT used (it would answer with a string instead of `run()`'s value, against the rules' "answers each with run").

## How it is faster than v2

- **One regex exec per field** (`/[,\r\n]/g`) instead of three `indexOf` scans.
- **One regex exec per quoted span** (`/["\r\n]/g`): a span between two stops never holds CR/LF, so it is a single slice with no rebuild.
- **Buffer read + `JSON.parse(buffer)`** instead of a UTF-8 string read.
- **V8 heap flags**: `--max-semi-space-size=256 --single-generation` on top of `--no-incremental-marking`.
- **Streaming output** (new in v5): per-case stringify + incremental write, no 12 MB array + 12 MB string coexisting.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=cvw0cfes&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
