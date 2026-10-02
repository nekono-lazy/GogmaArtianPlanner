# Global Planner Research Phase 2-C2.6-B2-C2A-R2（R1後の残存timeout taskの60分再測定とcompletion overlay）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Search algorithm /
ordering / comparator、Production default extent、Production Candidate capture、P1 policy、context ordering、context budget 16、
validation Target 20、reservation、cost cohort数、safety cap、heap、concurrency、oracle matching contractは変更していない。B2-C2Aで計測済みの
318 taskも、R1で計測済みの1 task（t02-r12）も再実行していない。R1から変えたのは **R1でなお未計測だったtaskの execution budget（30分 → 60分）だけ**。

- measured HEAD: `00794872bd70609920ab1054739244a8496ebf00`（R1 RESULT authority parser・retry manifest rule・320 task再構築・retry task選択・
  60分 / concurrency 1条件・既存B2-C2A child再利用・analyzer・R1 overlay再現ガード・completion overlay・decision rule・testsを含むclean HEAD）
- analysis HEAD: `00794872bd70609920ab1054739244a8496ebf00`（measured HEAD以後の変更なし、`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2AR2_RESULT.json)（`provenance.formal = true`、invalid reason 0）
- B2-C2A RESULT・R1 RESULTはいずれも書き換えていない（`b2c2aResultRewritten = false`、`r1ResultRewritten = false`、`originalEvidenceRerun = false`、
  `r1EvidenceRerun = false`）

## 0. 最重要limitation

> **P1 policyとdefaultExtent populationの選択自体は、過去のoracle post-hoc evidence（B2-C1）に基づく。**
> **ただし各Target内のcontext orderingと今回のretry Searchには、oracle compatibility / firstCompatibleを使用していない。**

| provenance flag | 値 |
| --- | --- |
| `oracleGuidedPolicySelection` | `true` |
| `oracleGuidedTargetPopulation` | `true` |
| `contextOrderingUsesOracle` | `false` |
| `retrySelectionUsesOracle` | `false`（retry対象はR1 RESULTのretry rowのうち `process = timeout` かつ `record = null` の行だけで機械的に抽出） |
| `oracleReadBySearchChild` | `false` |
| `oracleMatchUsedForEarlyStop` | `false` |

retry対象のt09-r09は、post-hoc解析上reservation-incompatibleであり、同じTarget（8d233d8b）は別rank（11）ですでにC8 exactを持っていた。
**それを理由にskip / measured扱いはせず、このtask自身のSearch completionを実測した。**

R2はこのExport / populationでのB2-C2A measurement completionのためのResearchであり、以下の根拠ではない。

- P1をProduction採用する証明
- context budget 16をProduction採用する証明
- C4CをProduction採用する証明
- 60分budgetをProduction default（timeout値）にする根拠
- 他Exportへの一般化

## 1. 結論（`B2C2AR2_ALL_C4C`）

事前登録ruleにより **`B2C2AR2_ALL_C4C`**。R1で唯一未完走だったt09-r09は、60分budget内（Search 約2,400秒）で `stopped_by_extent` により完走した。
Candidateは0件。semantic failure 0、invalid reason 0。

| | 件数 |
| --- | ---: |
| original measured（B2-C2A RESULT） | 318 / 320 |
| R1 overlay後 measured（R1 RESULT） | 319 / 320 |
| R2 retry measured | **1 / 1** |
| combined measured | **320 / 320** |
| combined unmeasured | 0 |

combined（B2-C2A + R1 + R2）のscheduler結果は、B2-C2A / R1と同一:

| capture policy | top1 | top2 | top4 | top8 | top12 | top16 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C8 | 0 | 6 | 6 | 14 | 18 | 18 |
| C32 | 0 | 6 | 6 | 14 | 18 | 18 |
| C4C | 0 | 7 | 7 | 15 | **20** | **20** |

- C8 18 / C32 18 / C4C 20、fully measured Targets 20 / 20、unresolved safety cap Targets 0
- 既存 `phase2c26b2c2aDecision()` をcombined 320 contextsへそのまま再適用した結果が `B2C2A_ALL_C4C`（C4C 20 / 20、C32 < 20）。
  R2独自の判定は加えていない
- 20 / 20 Targetのexactは、original B2-C2A evidence由来。R1・R2のretryで新たなexactは観測されていない

## 2. retry対象と条件

- **authority:** committed R1 RESULT（`docs/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json`、SHA-256
  `69c31d28f881c6c3d27a74453328f332d77ff81d84b0e08567cde0bdc8be0f1c`）を `parsePhase2C26B2C2AR2R1Authority()` でfail-close検証した。
  - 識別・provenance: formal、measured / analysis HEAD `62524ded…`、benchmark code `1673c41c…`、calc変更なし、uncommitted / smokeなし
  - decision: `B2C2AR1_INCOMPLETE` / `B2C2A_INCOMPLETE`、reasons 0、invalidReasons 0
  - source: 登録済みのB2-C2A RESULT / Target manifest / R1 retry manifest
  - R1実行条件: R1 retry条件（30分・concurrency 1・heap 8192 MB）、B2-C2A Stage 1、default extent、capture 4 cohort、safety cap 1024、child script
  - overlay: 318 + 1 = 319 / 320、unresolved 1
  - combined: C8 18 / C32 18 / C4C 20
  - hash chain: 26項目がすべてtrue
  - retry row: 2件、timeout行はrecord / Candidateなし
- **B2-C2A RESULT:** 既存R1 parser（`parsePhase2C26B2C2AR1Authority()`）で再検証した。2つのRESULTの関係は
  `phase2c26b2c2ar2ChainIssues()` で検証した（R1のsource hash 10項目がB2-C2Aと一致、R1 retry rowがB2-C2Aの未計測rowと一致、
  各retry rowのtask identityとcompatibilityがB2-C2A rowと一致）。
- **retry manifest:** R1 RESULT `retryRows` から `process = timeout` かつ `record = null` の行だけを `phase2c26b2c2ar2TimeoutTaskIds()` で抽出した（1件）。
  - 抽出関数は `compatible` / `coverage` / exact / firstCompatible / Candidate count / operation cost / route kind / 別rankのexactを読まない（testで固定）。
  - task IDはコードにhard-codeしていない（isolation testで固定）。
  - manifestにはtask IDとsource hashだけを含む（`.local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RETRY.json.local`、SHA-256
    `388ad551aa280e2a56202e72e0479de84159d97046eada2b7450e458ec9a3cf7`）。
- **Target manifest:** 既存の `prepare-planner-global-phase2c26b2c2a-targets.mjs` で再生成した。B2-C2A / R1の記録値 `1634163d…` とバイト一致した。
- **runner:** Export・Target manifest・retry manifestだけを読む。childは **B2-C2Aの既存runner（`scripts/run-planner-global-phase2c26b2c2a.mjs`）を
  `--role tasks` / `--role search` でそのまま起動**する。
  - Search pathはB2-C2A / R1と同一コード:
    `derivePhase2C26B2C1Schedule()` → `buildPhase2C26B2C2ATasks()`（320 task）と `runPhase2C26B2C2ATask()` → `runPhase2C26B2C2ASearch()` →
    `visitPlannerAlternativeCandidates()`。
  - 320 taskの再構築からretry IDだけを `selectPhase2C26B2C2AR2Tasks()` で選ぶ（1 / 320、違えばSearchしない）。

| 条件 | B2-C2A Stage 1 | R1 retry | R2 retry |
| --- | --- | --- | --- |
| execution budget | 10分 | 30分 | **60分（3,600,000 ms）** |
| concurrency | 3 | 1 | 1 |
| child heap / fresh child / yield / memory sampling | 8192 MB / task毎 / setImmediate / 250 ms | 同一 | 同一 |
| extent | Normal 4 / Gogma 235 / Skill 4（Production default） | 同一 | 同一 |
| capture | 4 distinct cost cohort drain、5番目costはsentinel（captureに含めない）、safety cap 1024 | 同一 | 同一 |
| retry / fallback | none / none | none / none | none / none |

analyzerは、R2 retry条件とR1 retry条件の差がbudget（30分 → 60分）とexecutionClassだけであることを検査する。
oracle exactでSearchを止める処理はない（visitorの `'stop'` はsentinelとsafety capだけ）。

## 3. retry task

| task | Target | P1 rank | B2-C2A（10分） | R1（30分） | R2 outcome | termination | Search elapsed | wall | peak heap | peak RSS | yields | Candidate | cost cohort | capture complete | safety cap |
| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| t09-r09 | 8d233d8b | 9 | timeout、heap 4.74 GB | timeout、heap 5.16 GB | **completed** | `stopped_by_extent` | 2,399.5 s | 2,404.7 s | 5.22 GB | 5.57 GB | 1,583.7万 | 0 | 0 | yes | no |

- 約40分で自然終了した。default extentを走り切り、Candidate 0、`captureComplete = true`、sentinelなし。schedule再導出は4.2 s。
- memory sample（最大heap / yield累計）:

  | 時点 | 最大heap | yield累計 |
  | --- | ---: | ---: |
  | 5分 | 4.43 GB | 257万 |
  | 15分 | 4.78 GB | 688万 |
  | 30分 | 4.86 GB | 1,266万 |
  | 40分 | 4.86 GB | 1,582万 |

  heapは約4.9 GBで頭打ちだった。yieldは終了までほぼ線形に増えた。R1（30分 timeout時点で1,362万）とほぼ同じ進行速度で、30分時点ではまだ
  終了の約10分前だったことになる。
- runtime分布について: B2-C2Aのtimeout（10分）、R1のtimeout（30分）、R2の完走（約40分）は、budgetの違う別測定なので同じruntime分布に混ぜない。
- formal計測中、同じマシンで他の計測・test・buildは実行していない。

## 4. semantics（post-hoc）

| 項目 | 値 |
| --- | --- |
| compatibility再計算（既存 `phase2c26b2c2aReach()` → `phase2c26b2c1TargetReach()`） | 320 context全件でB2-C2A記録値と一致（mismatch 0）。R1 retry rowの記録値とも一致。t09-r09は **reservation-incompatible** |
| P1 first compatible rank | 20 / 20 TargetでB2-C1と一致（8d233d8bは11） |
| t09-r09 Candidate比較（既存 `phase2c26b2c2aCompareContext()` → `phase2c26b2b2aCompare()` → `phase2c2OracleCoverage()`） | `uncovered`（Candidate 0）、exact 0、partial 0、sentinelなし、policy hit C8 / C32 / C4C すべてfalse |
| reservation violation（`respectsPhase2C2Reservation()`、sentinel含む） | 0 |
| incompatible contextからのexact / partial | 0 / 0 |

- 8d233d8bのTarget行: 16 / 16 measured。C8 / C32 / C4CともにP1 rank 11でfirst exact（index 0、operation cost 2、first compatibleとのdelta 0）。
- t09-r09がCandidate 0だったことでTarget行は変わらない。この結果はSearchの実測で得たもので、「incompatibleだからCandidate 0のはず」と前提したものではない。

## 5. completion overlay

```text
original:  tasks 320 / measured 318 / timeout 2       （B2-C2A RESULT、再実行・書き換えなし）
r1:        tasks 320 / measured 319 / unmeasured 1    （B2-C2A + R1 RESULTのR1 measured row、再実行・書き換えなし）
retry:     selected 1 / measured 1 / timeout 0 / OOM 0 / failure 0 / context mismatch 0 / not run 0
combined:  tasks 320 / measured 320 / unmeasured 0    （resolvedByR1 1、resolvedByR2 1、unresolved 0）
```

- R1 measured row（t02-r12）は、R1 RESULTの記録値のままoverlayした。R2 overlayはR2 retry manifestのtaskだけで、二重計上はない（analyzerで検査）。
- **再現ガード1:** original rowsだけからTarget集計を再計算すると、B2-C2A RESULTの exactTargets / budgetCoverage / cascade / 20 Target行と完全一致した。
- **再現ガード2:** R1 overlay（original + R1 measured row）からTarget集計を再計算すると、R1 RESULTの combined measured（319）/ exactTargets /
  budgetCoverage / cascade / unresolvedSafetyCapTargets / fullyMeasuredTargets（19）/ 20 Target行と完全一致した。
- combined Target: 20 / 20 Targetが16 / 16 measured。

## 6. authority / hash chain

| authority | 値 |
| --- | --- |
| R1 RESULT | `69c31d28f881c6c3d27a74453328f332d77ff81d84b0e08567cde0bdc8be0f1c`（R2登録値。§2の項目をfail-close確認） |
| R1 retry manifest | `fadc1d7f4c35ac3f2e3dbfabf324d84654b96f5bf1f9dde62b35dc182844e253`（R1 RESULT記録値 = R2登録値） |
| B2-C2A RESULT | `9b2736cc0a58c039837207d4caa41a6360715e7dd72e26237a6366b80d1bd74f` |
| B2-C1 RESULT | `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac` |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d` |
| B2-B2A RESULT | `b1ae4e8112772ebc75cba14de3fdead48a55ce34c6871ec03ca6f628c73fa9cb` |
| B2-B2A2 RESULT | `d3a81b8f65033d8d05d72971e621ae8f4c3bc336a8a9b3f6edcc95c34880285b` |
| oracle RESULT | `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1` |
| oracle manifest | file `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、Routes `ffb6db5a39e248b950a75f9094ae641a4a35f256a035e37564227bdc6e0e73cc` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| Target manifest | `1634163db4e749bef9346f5f24b39fb6478493a7d478aae869538474f5d48a30` |
| R2 retry manifest | `388ad551aa280e2a56202e72e0479de84159d97046eada2b7450e458ec9a3cf7` |
| R2 raw run | `3896b208a4b506e0f6877edea8afd435be098b4a51ef342e355150acf9f317b3` |
| benchmark code | `5aff7851b0ad0adb7821bfdfe36544b4993113cb786e3779f52ab289041262b1` |

- hashChainは35項目すべてtrue（R1由来の26項目に、R1 RESULT / R1 retry manifest / B2-C1・oracle・Export・Target manifestとR1の一致を追加）。
- 各authority（B2-C2A / R1 / B2-C1 / B2-B1 / B2-B2A / B2-B2A2 / oracle）は既存parserで再検証した。
- schedule parity（320 task・retry selection・contexts digest・origin digest・extent・policies・CalculationContext・RNG Engine）を確認した。
- population parity（B2-C1 defaultExtent = B2-C2A Targets = runner Targets）を確認した。
- 320 taskのtask identity（taskId / Target / P1 rank / groupIndex / reservationDigest / cardinality / representative / searchInputDigest）が
  B2-C2A rowと一致することを確認した。
- retry record SHA-256の一致を確認した。

## 7. decision rule（formal前に登録）

1. `B2C2AR2_INVALID`: 以下のいずれか。
   - authority: R1 RESULT authority不一致（SHA-256、formal、measured / analysis HEAD、benchmark code、calc変更、case、overlay、combined exact、
     hash chain、invalid reasons、R1条件）、B2-C2A RESULT authority不一致、R1 / B2-C2A chain不一致
   - selection / 再構築: retry manifestがR1 timeout行と不一致（件数・ID・source hash）、Target manifest / Export / oracle / hash chain不一致、
     320 task / retry task再構築不一致、schedule parity
   - 実行条件: extent / capture / heap / concurrency / budget条件drift、manifest外のretry run・二重実行
   - semantic: context mismatch、raw / record不整合、reservation violation、incompatible contextからのexact / partial（sentinel含む）、
     compatibility parity不一致、first compatible rank不一致、first exact < first compatible
   - 再現 / 退行: original rowsがB2-C2A集計を再現しない、R1 overlayがR1 combined集計を再現しない、combined exactがR1 combined未満
   - provenance不備
2. `B2C2AR2_INCOMPLETE`: invalidなしで、retry taskにtimeout / OOM / process failureがある（120分retry・second retryはしない）
3. `B2C2AR2_ALL_C8` / `ALL_C32` / `ALL_C4C`: retry 1 / 1 measured、combined 320 / 320で、B2-C2A decision semantics（`phase2c26b2c2aDecision()`）を
   combined rowsへ再適用した結果に従う
4. combinedが `B2C2A_PARTIAL` になる場合は、R1 combined C4C 20 / 20 authorityと矛盾するので `B2C2AR2_INVALID`

今回は3で、`B2C2AR2_ALL_C4C`。

## 8. 解釈

- P1 policyとdefaultExtent populationの選択自体は、過去のoracle post-hoc evidenceに基づく。ただし各Target内のcontext orderingとretry Searchには、
  oracle compatibility / firstCompatibleを使用していない。
- このExport・populationでは、default extent層20 TargetのB2-C2A measurementが **320 / 320 measured** で閉じた。
  C4Cで20 / 20 exact（C8 / C32は18 / 20）。
- retryで計測した2 task（t02-r12、t09-r09）は、どちらもincompatible contextでCandidate 0だった。B2-C2Aで検証した契約
  （incompatible contextからexactが出ない）と整合する。
- 1 contextのSearchに約40分（t09-r09）・約21分（t02-r12）かかることがある。これはresearch harness（Node、default extent、Candidate 0まで走り切る）
  上の観測であり、Productionのruntime / timeout設計の根拠ではない。

## 9. 次の推奨（このPRでは実施しない）

- extent不足20件について、scheduler-selected contextを使ったextent requirement / Search probe。
- K2-minimal 9件（P1 rank 50〜306）は、同じtop16 brute-forceへ進む前に、Target-relative K2 feature / grouping改善を検討する。
- residual unreached 3件は、引き続き別系統（alternative-to-alternative support）。
- P1 / budget 16 / C4C / 60分budgetのProduction採用ではない。次の判断は、本R2 formal evidenceのレビュー後に行う。

## 10. 実装・検証上の記録

- **中止した計測（formal evidenceではない）:** 最初の計測はHEAD `e1f6f71` で開始した。この時点のretry selection ruleは
  「B2-C2Aで未計測、かつR1 retryでもcompleted + searchedでない」で、指示されたrule（R1 retry rowの `timeout` かつ `record = null`）より広かった
  （結果のtaskは同じ1件）。
  - ruleを揃えるため、開始約3分で中止した（child processの残存なしを確認）。成果物は `.local/c2ar2-aborted1.*` に退避した。
  - 修正（`0079487`）後に、retry manifestを再生成してからformal計測した。この中止した計測は、RESULTにもdecisionにも使っていない。
- **非formal smoke:** `--allow-uncommitted --smoke-budget-ms 60000` / `30000` で意図的にtimeoutさせ、以下を確認した（formalには使っていない）。
  - runner → analyzerの配線
  - hash chain 35項目
  - original / R1の再現ガード
  - INCOMPLETE判定
- **追加ファイル:**
  - `src/benchmarks/plannerGlobalPhase2C26B2C2AR2.ts`（Search側: retry manifest parser・retry task選択・実行条件）
  - `src/benchmarks/plannerGlobalPhase2C26B2C2AR2Authority.ts`（R1 RESULT authority・chain検証・timeout抽出・retry manifest生成）
  - `src/benchmarks/plannerGlobalPhase2C26B2C2AR2Analysis.ts`（R1 overlay再現・R2 overlay・decision）
  - 上記のtest
  - `scripts/prepare-planner-global-phase2c26b2c2ar2-retry.mjs`、`scripts/run-planner-global-phase2c26b2c2ar2.mjs`、
    `scripts/analyze-planner-global-phase2c26b2c2ar2.mjs`
- **未変更:** R1 / B2-C2Aのコード・RESULTには変更なし。

再現コマンド（Exportは外部ファイル）:

```text
node scripts/prepare-planner-global-phase2c26b2c2a-targets.mjs --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_TARGETS.json.local --export <Export>
node scripts/prepare-planner-global-phase2c26b2c2ar2-retry.mjs --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --r1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RETRY.json.local --export <Export> --targets .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_TARGETS.json.local
node scripts/run-planner-global-phase2c26b2c2ar2.mjs --export <Export> --targets .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_TARGETS.json.local --retry .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RETRY.json.local --run-dir .local/c2ar2-formal.run --output .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RAW.json.local
node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2ar2.mjs --run .local/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RAW.json.local --run-dir .local/c2ar2-formal.run --retry <retry manifest> --targets <targets manifest> --export <Export> --b2c2a-result docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json --r1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2AR1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json --b2b2a2-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --output docs/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RESULT.json
```
