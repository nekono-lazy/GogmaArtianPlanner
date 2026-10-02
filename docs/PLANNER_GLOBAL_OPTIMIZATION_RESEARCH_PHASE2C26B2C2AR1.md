# Global Planner Research Phase 2-C2.6-B2-C2A-R1（B2-C2A timeout subsetの再測定とcompletion overlay）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Search algorithm /
ordering / comparator、Production default extent、Production Candidate capture、P1 policy、context ordering、context budget 16、
validation Target 20、reservation、cost cohort数、safety cap、oracle matching contractは変更していない。B2-C2Aで計測済みの318 taskも
再実行していない。変えたのは **B2-C2Aで未計測だったtimeout taskの execution budget（10分 → 30分）と concurrency（3 → 1）だけ**。

- measured HEAD: `62524dedbd89263014eadafcadce2f82e83410d6`（B2-C2A authority parser・retry manifest rule・320 task再構築・retry task選択・
  30分 / concurrency 1条件・既存B2-C2A child再利用・analyzer・completion overlay・decision rule・testsを含むclean HEAD）
- analysis HEAD: `62524dedbd89263014eadafcadce2f82e83410d6`（measured HEAD以後の変更なし、`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json)（`provenance.formal = true`、invalid reason 0）
- B2-C2A RESULT（`docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json`）は書き換えていない（`b2c2aResultRewritten = false`、`originalEvidenceRerun = false`）

## 0. 最重要limitation

> **P1 policyとdefaultExtent populationの選択自体は、過去のoracle post-hoc evidence（B2-C1）に基づく。**
> **ただし各Target内のcontext orderingとretry Searchには、oracle compatibility / firstCompatibleを使用していない。**

| provenance flag | 値 |
| --- | --- |
| `oracleGuidedPolicySelection` | `true` |
| `oracleGuidedTargetPopulation` | `true` |
| `contextOrderingUsesOracle` | `false` |
| `retrySelectionUsesOracle` | `false`（retry対象はB2-C2A RESULTの `process = timeout` かつ `record = null` の行だけで機械的に抽出） |
| `oracleReadBySearchChild` | `false` |
| `oracleMatchUsedForEarlyStop` | `false` |

retry対象の2 taskは、B2-C2Aのpost-hoc解析でreservation-incompatibleと判定されていたが、**incompatibleだからskipすることはせず、
2件とも実Searchした**（本Phaseの目的は未計測Search taskを実際に計測すること）。

## 1. 結論（`B2C2AR1_INCOMPLETE`）

事前登録ruleにより **`B2C2AR1_INCOMPLETE`**。retry 2 taskのうち1 task（t02-r12）は30分budget内で完走したが、もう1 task（t09-r09）は
**30分でもtimeout**した。semantic failure 0、invalid reason 0。

| | 件数 |
| --- | ---: |
| original measured（B2-C2A RESULT） | 318 / 320 |
| retry measured | **1 / 2** |
| combined measured | **319 / 320** |
| combined unmeasured | 1（t09-r09） |

combined（original + retry）のscheduler結果はB2-C2Aと同一:

| capture policy | top1 | top2 | top4 | top8 | top12 | top16 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C8 | 0 | 6 | 6 | 14 | 18 | 18 |
| C32 | 0 | 6 | 6 | 14 | 18 | 18 |
| C4C | 0 | 7 | 7 | 15 | **20** | **20** |

C8 18 / C32 18 / C4C 20（20 / 20 Targetのexactはoriginal B2-C2A evidence由来。retryで新たなexactは観測されていない）。
ただし「all 320 task measured」を満たさないため、ALL_C4Cとは判定しない。

## 2. retry対象と条件

- retry manifest: B2-C2A RESULT `taskRows` から `process = timeout` かつ `record = null` の行だけを抽出（2件）。抽出関数は
  `compatible` / `coverage` / exact / firstCompatible / operation cost / route kind を読まない（testで固定）。manifestはtask IDとsource hashだけ
  （`.local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RETRY.json.local`、SHA-256 `fadc1d7f4c35ac3f2e3dbfabf324d84654b96f5bf1f9dde62b35dc182844e253`）。
- Target manifest: 既存 `prepare-planner-global-phase2c26b2c2a-targets.mjs` で再生成し、B2-C2A記録値 `1634163d…` と完全一致（バイト一致）。
- runner: Export・Target manifest・retry manifestだけを読む。childは **B2-C2Aの既存runner（`scripts/run-planner-global-phase2c26b2c2a.mjs`）を
  `--role tasks` / `--role search` でそのまま起動**するので、`derivePhase2C26B2C1Schedule()` → `buildPhase2C26B2C2ATasks()`（320 task）と
  `runPhase2C26B2C2ATask()` → `runPhase2C26B2C2ASearch()` → `visitPlannerAlternativeCandidates()` はB2-C2Aと同一コード。
  320 taskの再構築からretry ID 2件だけを `selectPhase2C26B2C2AR1Tasks()` で選ぶ（2 / 320、違えばSearchしない）。

| 条件 | B2-C2A Stage 1 | R1 retry |
| --- | --- | --- |
| execution budget | 10分 | **30分** |
| concurrency | 3 | **1** |
| child heap / fresh child / yield / memory sampling | 8192 MB / task毎 / setImmediate / 250 ms | 同一 |
| extent | Normal 4 / Gogma 235 / Skill 4（Production default） | 同一 |
| capture | 4 distinct cost cohort drain、5番目costはsentinel、safety cap 1024 | 同一 |
| retry / fallback | none / none | none / none |

concurrencyの変更は未計測taskの完走のためであり、Search semanticsの比較が目的ではない。Search入力・algorithm・capture semanticsは同一。
oracle exactでSearchを止める処理は無い（visitorの `'stop'` はsentinelとsafety capだけ）。

## 3. retry task

| task | Target | P1 rank | B2-C2A（10分） | R1 outcome | termination | Search elapsed | wall | peak heap | peak RSS | Candidate | cost cohort | safety cap |
| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| t02-r12 | 15829bfe | 12 | timeout 600 s、heap 3.85 GB | **completed** | `stopped_by_extent` | 1,253 s | 1,259 s | 4.57 GB | 5.16 GB | 0 | 0 | no |
| t09-r09 | 8d233d8b | 9 | timeout 600 s、heap 4.74 GB | **timeout** | — | — | 1,800 s | 5.16 GB | 5.57 GB | — | — | — |

- t02-r12: 約21分で自然終了（default extentを走り切り、Candidate 0、`captureComplete = true`、sentinelなし）。schedule再導出 4.2 s、
  yield 823万回。
- t09-r09: heapは約4.8 GBで頭打ち、yield数は30分間ほぼ線形に増加（約13分 683万 → 30分 1,359万）しており、OOMやstallではなく
  Searchが30分で終わらなかった。B2-C2Aのtimeout（10分）とR1のtimeout（30分）は同じruntime分布に混ぜていない。
  timeout childのstderr tailにViteの `WebSocket server error: Port 24678 is already in use` があるが、parentとchildがともにVite loaderを
  立てるために出る警告で、childは30分間yieldを続けており計測には影響していない（B2-C2Aと同じchild）。

## 4. semantics（post-hoc）

| 項目 | 値 |
| --- | --- |
| compatibility再計算（既存 `phase2c26b2c2aReach()` → `phase2c26b2c1TargetReach()`） | 320 context全件でB2-C2A記録値と一致（mismatch 0）。retry 2件とも **reservation-incompatible**（記録値もincompatible） |
| P1 first compatible rank | 20 / 20 TargetでB2-C1と一致 |
| t02-r12 Candidate比較（既存 `phase2c26b2c2aCompareContext()` → `phase2c26b2b2aCompare()` → `phase2c2OracleCoverage()`） | `uncovered`（Candidate 0）、exact 0、partial 0、sentinel無し |
| reservation violation（`respectsPhase2C2Reservation()`、sentinel含む） | 0 |
| incompatible contextからのexact / partial | 0 / 0 |

## 5. completion overlay

```text
original:  tasks 320 / measured 318 / timeout 2      （B2-C2A RESULT、再実行・書き換えなし）
retry:     selected 2 / measured 1 / timeout 1 / OOM 0 / failure 0 / context mismatch 0
combined:  tasks 320 / measured 319 / unmeasured 1  （resolvedByRetry 1、unresolved 1）
```

- retry manifest外のtaskはoverlayしない、同一taskの二重計上なし（analyzerで検査）。
- original rowsだけからTarget集計を再計算すると、B2-C2A RESULTの exactTargets / budgetCoverage / cascade / 20 Target行と完全一致
  （raw / result整合のガード）。
- combined Target: 16 / 16 measuredは19 Target（8d233d8bだけ15 / 16）。8d233d8bは別rank（11）でC8 exactを既に持つため
  scheduler Target outcome（C4C 20 / 20）は変わらないが、登録ruleは「all 320 measured」を要求するのでINCOMPLETE。

## 6. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2A RESULT | `9b2736cc0a58c039837207d4caa41a6360715e7dd72e26237a6366b80d1bd74f`（R1登録値）。formal、calc変更なし、`B2C2A_INCOMPLETE`、invalidReasons []、320 task / completed 318 / timeout 2 / OOM 0 / failure 0 / context mismatch 0、C8 18 / C32 18 / C4C 20、provenance flag 5項目をfail-close確認 |
| B2-C1 RESULT | `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac` |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d` |
| B2-B2A RESULT | `b1ae4e8112772ebc75cba14de3fdead48a55ce34c6871ec03ca6f628c73fa9cb` |
| B2-B2A2 RESULT | `d3a81b8f65033d8d05d72971e621ae8f4c3bc336a8a9b3f6edcc95c34880285b` |
| oracle RESULT | `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1` |
| oracle manifest | file `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、Routes `ffb6db5a39e248b950a75f9094ae641a4a35f256a035e37564227bdc6e0e73cc` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| Target manifest | `1634163db4e749bef9346f5f24b39fb6478493a7d478aae869538474f5d48a30` |
| retry manifest | `fadc1d7f4c35ac3f2e3dbfabf324d84654b96f5bf1f9dde62b35dc182844e253` |
| benchmark code | `1673c41c9d19fcdf4584ec88325b3daa0c542bcc92596683c309a9f59b78515d` |

hashChain 26項目すべてtrue。各authority（B2-C2A / B2-C1 / B2-B1 / B2-B2A / B2-B2A2 / oracle）は既存parserで再検証。
schedule parity（320 task・retry selection・contexts digest・origin digest・extent・policies・CalculationContext・RNG Engine）、
population parity（B2-C1 defaultExtent = B2-C2A Targets = runner Targets）、320 taskのtask identity（taskId / Target / P1 rank / groupIndex /
reservationDigest / cardinality / representative / searchInputDigest）とB2-C2A rowの一致、retry record SHA-256一致をすべて確認。

## 7. decision rule（formal前に登録）

1. `B2C2AR1_INVALID`: B2-C2A RESULT authority不一致、retry manifestがtimeout行と不一致（件数・ID・source hash）、Target manifest / Export /
   oracle / hash chain不一致、320 task / retry task再構築不一致、schedule parity、extent / capture / budget条件drift、manifest外のretry run・二重実行、
   context mismatch、raw / record不整合、reservation violation、incompatible contextからのexact / partial（sentinel含む）、compatibility parity不一致、
   first compatible rank不一致、first exact < first compatible、original rowsがB2-C2A集計を再現しない、combined exactがoriginal未満、provenance不備
2. `B2C2AR1_INCOMPLETE`: invalid無しで、retry taskにtimeout / OOM / process failureがある
3. `B2C2AR1_ALL_C8` / `ALL_C32` / `ALL_C4C`: retry 2 / 2 measured、combined 320 / 320、B2-C2A decision semantics（`phase2c26b2c2aDecision()`）を
   combined rowsへ再適用した結果（ALL_C4CはC4C 20 / 20かつC32 < 20）
4. combinedが `B2C2A_PARTIAL` になる場合はoriginal C4C 20 / 20 authorityと矛盾するので `B2C2AR1_INVALID`

今回は2のため `B2C2AR1_INCOMPLETE`。

## 8. 解釈

- P1 policyとdefaultExtent populationの選択自体は過去のoracle post-hoc evidenceに基づく。ただし各Target内のcontext orderingとretry Searchには
  oracle compatibility / firstCompatibleを使用していない。
- 計測できた319 taskの範囲では、default extent層20 TargetはC4Cで20 / 20 exactに到達しており（B2-C2Aと同じ）、retryで計測できた1 task
  （incompatible context）はCandidate 0でexact / partialを出さなかった。これはB2-C2Aで検証した契約（incompatible contextからexactが出ない）と整合する。
- 残る1 task（t09-r09）もincompatible contextだが、「incompatibleだからexactを出さない」とみなして計測済み扱いにはしない。
  320 / 320 measuredは未確定。

## 9. 次の推奨

`B2C2AR1_INCOMPLETE` のため、**未完走task（t09-r09）だけについてruntime completionを継続する**。本PRでは60分retry・extent変更・capture縮小・
concurrency変更・Search最適化を追加していない。

- 候補: 同じSearch / context / capture条件のまま、t09-r09だけをより長いbudget（例: 60〜120分）で別Phaseとして再測定する。
  30分時点でheapは約4.8 GBで頭打ち、yieldは線形に増えていたので8192 MB heapのままでも完走の可能性はあるが、所要時間は未知。
- default extent 20件が320 / 320で確定した後に、extent不足20件のscheduler-selected context extent requirement / Search probeへ進む
  （K2-minimal 9件はP1 rank 50〜306のため、top16 brute-forceの前にTarget-relative K2 feature / grouping改善を検討）。
- residual unreached 3件は引き続き別系統（alternative-to-alternative support）。

## 10. 実装・検証上の記録

- 非formal smoke（`--allow-uncommitted --smoke-budget-ms 60000`）で2 taskとも意図的にtimeoutさせ、runner → analyzerの配線、hash chain 26項目、
  compatibility parity、original rowsからの集計再現、INCOMPLETE判定を確認した（formalには使っていない）。
- 追加ファイル: `src/benchmarks/plannerGlobalPhase2C26B2C2AR1.ts`（Search側: retry manifest parser・retry task選択・実行条件）、
  `plannerGlobalPhase2C26B2C2AR1Authority.ts`（B2-C2A RESULT authority・timeout抽出・retry manifest生成）、
  `plannerGlobalPhase2C26B2C2AR1Analysis.ts`（overlay・decision）、同test、
  `scripts/prepare-planner-global-phase2c26b2c2ar1-retry.mjs`、`run-planner-global-phase2c26b2c2ar1.mjs`、`analyze-planner-global-phase2c26b2c2ar1.mjs`。

再現コマンド（Exportは外部ファイル）:

```text
node scripts/prepare-planner-global-phase2c26b2c2a-targets.mjs --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_TARGETS.json.local --export <Export>
node scripts/prepare-planner-global-phase2c26b2c2ar1-retry.mjs --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RETRY.json.local --export <Export> --targets .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_TARGETS.json.local
node scripts/run-planner-global-phase2c26b2c2ar1.mjs --export <Export> --targets .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_TARGETS.json.local --retry .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RETRY.json.local --run-dir .local/c2ar1-formal.run --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RAW.json.local
node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2ar1.mjs --run .local/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RAW.json.local --run-dir .local/c2ar1-formal.run --retry <retry manifest> --targets <targets manifest> --export <Export> --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json --b2b2a2-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --output docs/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json
```
