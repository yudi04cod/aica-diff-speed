# Aica Diff Speed

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/yudi04cod/aica-diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/yudi04cod/aica-diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

Referral code: 38m33ybw

A fast drop-in for makefun-diff 1.0.0, built for the make.fun competition
"Diff two texts faster, 27 November 2026". `solve.js` returns exactly
makefun-diff's patch of `{ old, new }` — same Myers search, same
deletion-preferred tie-break, same hunks — but much faster: lines are
interned to small integers once, the common prefix and suffix are trimmed
on those integers, and the search runs on typed arrays, keeping one integer
per diagonal per edit distance instead of a linked path object per cell.
The edit script is rebuilt afterwards by walking the stored diagonals
backwards with the same choice rule the forward search used. `main.ts`
reads every case from `/input/cases.json`, answers each with `run`, and
writes `/output/answers.json`.

## Practice result

4 of 4 practice cases identical to the reference, byte-for-byte
reproducible over two runs. Locally about 2.7x faster than the house
baseline on CPU time net of a do-nothing control (~520 ms vs ~1,420 ms
for the 4 practice cases).

## Running

```sh
MAKEFUN_INPUT_DIR=<input dir> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts
```

Node 22 or later, no dependencies. `solve.js` is a dependency-free ES
module exporting `run(input)`.

## Files

- `solve.js` — the fast diff (the entry)
- `main.ts` — the program the harness runs
- `LICENSE` — MIT

## License

MIT — see `LICENSE`.
