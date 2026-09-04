# C5-E2C8 Real Browser Worker Benchmark

実施日: 2026-09-03

## Status

- C8 Browser Worker benchmark: completed
- Skill live-game verification (C9): completed（[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）
- Production Identification activation: pending

この結果は `production-rng:c5-e2`、`supportsSeedSearch = false`、既存の
Worker chunk / merge / fail-closed contractを変更していない。

## Method and environment

- Isolated Production entry: `benchmark.html` → `src/benchmark.tsx`
- Build command: `vite build --config vite.benchmark.config.ts`
- Browser: HeadlessChrome 152.0.0.0, Windows 10 x64
- `navigator.hardwareConcurrency`: 16
- Input: Insect Glaive / Thunder; four ordered Skill observations from indices
  `275, 255, 245, 243`; Skill Counter `180..190`
- The C8-only seam passes `1`, `2`, or `4` as the parallel client's injected
  `hardwareConcurrency`. The normal Production factory remains unchanged.
- Chrome DevTools listed four child `worker` targets with the benchmark page as
  their parent during the active 4-Worker representative search. No Worker
  failure occurred.

## Golden bounded comparison

Range: `8,500,000..8,550,000` inclusive (50,001 Seeds). One warm-up preceded
three measurements for each primary comparison. Every completed run returned
one match: `(baseSeed: 8,524,433, startSkillCounter: 186)`, complete searched
range, and `isTruncated: false`.

| Workers | Measurement elapsed (ms) | Approx. Seeds/sec | Classification / matches | Parity |
| ---: | ---: | ---: | --- | --- |
| 1 | 301.9 / 296.9 / 306.0 | 165,621 / 168,410 / 163,402 | unique / 1 | pass |
| 2 | 107.8 / 109.1 / 110.5 | 463,831 / 458,304 / 452,498 | unique / 1 | pass |
| 4 | 92.3 / 94.0 / 98.2 | 541,723 / 531,926 / 509,175 | unique / 1 | pass |

The result comparison covers classification, complete match list and order,
`searchedSeedRange`, and `isTruncated`.

## Staged range checks

The benchmark did not execute the 100M canonical domain. It expanded from a
small bounded range to the known golden range, then a representative bounded
range.

| Range | Workers | Measurement elapsed (ms) | Seeds/sec | Result |
| --- | ---: | ---: | ---: | --- |
| 8,520,000..8,525,000 (5,001) | 4 | 49.0 / 42.2 / 42.9 | 102,061 / 118,507 / 116,573 | unique / 1 |
| 8,500,000..8,550,000 (50,001) | 4 | 92.3 / 94.0 / 98.2 | 541,723 / 531,926 / 509,175 | unique / 1 |
| 8,300,000..8,800,000 (500,001) | 4 | 742.8 / 746.5 / 739.8 | 673,130 / 669,794 / 675,860 | unique / 1 |

The small range is dominated by Worker startup overhead, so it is not useful
for selecting a Production default. The 500,001-seed result is a bounded
representative measurement only; it is not evidence for a 100M default.

## Responsiveness, cancellation, and memory

- Progress continued to update: golden runs recorded 7 (1 Worker), 8 (2), or
  12 (4) progress events; the representative 4-Worker run recorded 56.
- The request-animation-frame monitor continued throughout; longest sampled
  frame interval was 7.6 ms. The main thread did not show a sustained freeze.
- Representative 4-Worker cancellation after 200 ms had already received 13
  progress events. The logical request reached `cancelled` in 0.0 ms at the
  timer's displayed precision; no later progress or result changed the table
  during the subsequent one-second observation. A 50 ms cancellation before
  first progress also returned to `cancelled` (0.4 ms terminal latency).
- Chromium `performance.memory` was available. Golden runs stayed roughly in
  the 5–12 MiB sampled JS heap range. Representative runs peaked at 17.5,
  21.5, and 20.8 MiB; post-run values varied with garbage collection. This is
  an observed tendency, not a cross-browser memory limit.

## C10 review inputs

- Retain the existing maximum of four Workers. On this 16-logical-core PC,
  four Workers were fastest, but C10 should decide any UX wording after mobile
  and lower-core review.
- Do not set a canonical 100M Seed range as the Wizard default from this C8
  run. The 500,001-seed bounded result is practical here, but extrapolation is
  not a default-range decision.
- Production activation was blocked by independent C9 Skill live-game
  verification, which completed afterwards. Neither C8 nor C9 activates
  Identification; C10 does.
- C9 may proceed: the real Browser Worker performance, progress, cancellation,
  and deterministic-result checks did not reveal a C8 blocker.
