# Global Planner Research D1-B（Phase B `found_R` 11 Candidate共存診断の実装と正式計測）

Refs #154。Research文書であり、正式仕様ではない。事前登録（authority）は [D1-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md)、
正式RESULTは [`PLANNER_GLOBAL_D1_RESULT.json`](PLANNER_GLOBAL_D1_RESULT.json) である。本書はRESULTの要約だけを記し、判定条件・意味論を追加しない。

変更していないもの: Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default、
Phase A / Phase B / follow-up / D1-A文書、既存formal RESULT。oracleは実行・診断・分析のいずれでも読んでいない。

## 1. 実装と計測条件

| 項目 | 内容 |
| --- | --- |
| 実装 | `src/benchmarks/plannerGlobalD1.ts`（V / R / 評価child / R5 / registry）、`src/benchmarks/plannerGlobalD1Analysis.ts`（独立R5再判定・decision）、`scripts/run-planner-global-d1.mjs`、`scripts/analyze-planner-global-d1.mjs` |
| measurement HEAD | `74886ef596ef774b6540b6516913a27074781d00`（Working Tree clean、start attestation verified、Production changed files `[]`） |
| 条件 | D1-A §6.1のとおり（R 60分 / 評価30分、heap 12,288 MB、concurrency 1、retry / fallbackなし、`researchMaxPlanSteps = 20000`、評価ごとfull run上限8） |
| 実行順 | V → R（t00〜t10）→ B0 → S → P（55組）→ A-a → A-b → A-c-01〜11。中止なし |
| 所要 | 全体約20.7分（R 295.7 s、評価944.5 s）、child heap最大約2.04 GB |

最初の正式計測（measurement HEAD `6f97e42`）は、計算コードにCRLFが混入して `git diff --check` に違反していたため、改行のみをLFへ正規化した
`74886ef` を新しいmeasurement HEADとして最初から再計測した（D1-A §9.2、旧runのrecordは流用・継ぎ足ししていない）。RESULTは再計測分だけから生成した。

実装上の注記（意味論の追加ではない）:

- Export SHA-256は既存のoracle isolation規則（Export digestはoracle以外のResearch sourceに書かない）に合わせ、sourceへ直書きせず、
  登録digestで検証されるPhase B start attestationの `exportSha256` から連鎖で得る。Phase B RESULT `sources.export` とD1-A文書の記載値とも照合する
- runtime-unsupportedで除外されたEntry IDは、結果の `rng_prediction_unsupported` warningのうち実行入力のvalidationが出さないものから導出し、
  件数が `fullRunsStarted - 1` と一致しなければfail closedとする。正式計測では全80評価で `fullRunsStarted = 1`、除外0件だった

## 2. 結果

decision: **`D1_FOUND_R_SET_PARTIAL`**（invalid 0、unmeasured 0、bound-limited 0、決定性cross-check 9組すべて一致）

| 段階 | 結果 |
| --- | --- |
| V | passed（登録入力、Phase B RESULT allowlist、record / task / raw、D1-A §1.3登録表） |
| R | 11 / 11 redelivered（§3.3の全一致条件成立、G store 11件） |
| B0 | Phase 2-C2 baselineとparity一致（completed 20 / 43、steps 1465、Conflict 21） |
| S | 11 / 11 Phase B trialとparity一致 |
| 評価 | 80 / 80 measured（すべて `evaluated`）、full Planner起動合計80 |
| R5成立（大きさ2以上） | P 6組（t01 / t07 / t08 / t09の全ペア）、A-b `{t01, t07, t08, t09}`、A-c-08 / 09 / 10 |
| 最大共存件数 | 4（`{t01, t07, t08, t09}`、t09のsupport Entryを含めS1〜S5成立） |
| A-a（11件） | R5不成立: 7件の `G` がselectedされず、集合内Conflict（`same_gogma_counter` 1、`same_skill_counter` 1）あり。completed 19 / 43、steps 723、Conflict 22 |
| A-b / A-c-10 | R5成立。completed 22 / 43（B0比 +2）、steps 1465、Conflict 21 |
| A-c最終受理集合 | `{t01, t07, t08, t09}` |

観察（RESULTの範囲内）:

- Phase B単体trialで `G` がselectedだった4件（t01 / t07 / t08 / t09）は、どのP / Aでも `G` がselectedで、4件の全組合せでR5が成立した
- Phase Bで `dropped` だった7件（t00 / t02 / t03 / t04 / t05 / t06 / t10）は、Pのどの組でも `G` がselectedにならなかった（R5不成立の主因は
  `generated_not_selected` 57件、`conflict_within_set` 12件）。このうちt02 / t04 / t10は、元Route `O_t` がB0でselectedだったため、
  それぞれ13評価で `target_regressed_R` となった
- Pの `conflict_within_set` は10組で、すべてt00 / t02 / t03 / t09 / t10の間の組である

## 3. 言えること・言えないこと（D1-A §7.1）

- 言えること: 登録した評価集合のうち、`{t01, t07, t08, t09}` とその部分集合（大きさ2以上）がR5を満たした。最大の観測共存集合は4件である
- 言えないこと: 11件の共存不能、未評価の部分集合（大きさ3以上の大半）の非共存、他のCandidate・support context・extent・Exportでの結果、
  43 / 43、Conflict 0、Issue #154 acceptance（R6）。D1の結果はPhase Bのformal RESULTやdecision inputへ戻さない

## 4. D2へ引き継ぐ知見

- `found_R` で止めた11 Candidateのうち、単体で `G` がselectedされなかった7件は、集合評価でも一度もselectedにならなかった。
  Target単体の `found_R` 停止は、Global共存のCandidate選択として不十分であることを示す下限evidenceである（oracle-free policyの非存在は示さない）
- 共存した4件の置換は、他32 Targetを元Routeのままにしてcompleted 20 → 22へ改善した。D2では、dropped側のTargetについて
  P / A-aで勝ったparticipant（provisional outcomeの勝者・集合内Conflictの相手）をsupport候補の導出に使う規則（D1-A §12-3）を事前登録する必要がある
