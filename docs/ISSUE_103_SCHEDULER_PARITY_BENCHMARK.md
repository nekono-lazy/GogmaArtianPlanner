# Issue #103 Phase B: Beam Search / 決定的scheduler parity と実Browser Worker計測

実施日: 2026-09-25（JST。計測時刻の記録はUTC 2026-09-24T16:25Z〜）。
基準main: `555947f4f2d9182b6e2c32f74d0ac20f97460e73`（PR #113 merge後）。
branch: `test/planner-scheduler-parity-benchmark`（計測はこのbranchの作業ツリーをbuildしたbundle）。

この文書は [ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md](./ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md)
17章 Phase B の記録である。**仕様authorityではない**。Production Plannerは引き続き Beam Search であり、
本Phaseで Production routing、Worker protocol、UI、schema / version は変更していない。

> **履歴の読み方。** 1〜10章はPhase B初回（PR #114）の記録で、そのまま残している。初回はacceptance
> fixture `deadlock` のcompletion regressionを発見し、Phase C readinessを NOT READY とした（3.2 / 8章）。
> その後のsemantic fix（pin-blockedのskip可能unitをholdingとして扱わない）と再検証・readiness再判定は
> **11章** に記録した。現在の結論は11章である。

---

## 1. 結論（Phase B初回、PR #114。現在の結論は11章）

| 問い | 答え |
| --- | --- |
| scheduler traceは既存Trace Replayを通るか | **通る**。acceptance catalogue 33件、`sanity-3`、`representative-12`（Node）、`sanity-3` / `representative-12` / `representative-35`（実Browser Worker）の全scheduler traceが `replayPlannerSearchTrace()` で有効、Production projectionも成立 |
| Beamより完成Target数が減るfixtureはあるか | **ある（1件）**。acceptance fixture `deadlock`（設計7.8の例）: Beam 2/2、scheduler 1/2 |
| その差の分類 | **C（deadlock / stall heuristic）かつ unexpected regression**。Beamは同じ入力で両Targetを完成させ、Trace Replayも有効。schedulerが「deadlock」とした待ちは真のdeadlockではない（3.2節） |
| representative-35 | Beam: 874,299 ms、`incomplete`（`max_expanded_states`）、完成13 / 35、expandedStates 200,000、trace 138、conflict 12、rejection record 0。scheduler: median約0.85 s（instrumented / plainとも）、`exhausted`、完成25 / 35（Beamの13件を全て含む）、expandedStates / trace 398、conflict 4（すべてBeamと共通）、rejection record 10（`resource_conflict`）。両者ともTrace Replay / projection有効（5節） |
| B8 constrained adoptionはschedulerでも成立するか | **成立する**。Beam版testと同じCandidate（4番目）を同じtrial数で採用。bounds 3種の意味も同じ（6節） |
| B9 what-if feasibilityはschedulerでも成立するか | **成立する**。Beam版testと同じfixture・同じ期待outcome（found / 各bound / checkpoint blocked）で一致（6節） |
| Phase CへProduction切替してよいか | **NOT READY**（8節） |

---

## 2. 追加したもの

### 2.1 parity harness（`src/benchmarks/plannerSchedulerParity.ts`）

同じ `PlannerInput`、同じ `RngEngine`、戦略ごとに新しい決定的 `PlannerDependencies` から
`runPlannerBeamSearch()` と `runPlannerDeterministicSchedule()` を1回ずつ実行し、
`summarizePlannerStrategyRun()` で各結果をplain dataの要約にし、`comparePlannerStrategyRuns()` で比較する。
結果全体の一致は比較しない。

| 分類 | 内容 | 扱い |
| --- | --- | --- |
| 必ず一致（mandatory） | Trace Replay有効（`replayPlannerSearchTrace()`）、Production projection成立（`createProductionPlanWithSearchRunner()` の共有後段: Trace Replay → `projectProductionPlanExecution()` → snapshot → checkpoint defence → rejected / materials）、全Stepの `executionEffects`、expected state chain（After = 次のBefore）、planning Target集合、`termination.completedTargetCount` = `isPlannerTargetComplete()` の数、statusの意味（cancelled / completed / incomplete / exhausted）、required checkpoint Entryなしの完成が無いこと、両者が選んだEntryのmilestoneが同一、fail-closed入力validation（validation issue / warning / status）が同一 | 1件でも違反なら `mandatory_violation` |
| completion regression | `scheduler completed < beam completed`（完成判定は `isPlannerTargetComplete()`。`selectedBuildListEntryIds.length` で代用しない） | 失ったTargetごとに、Beam / schedulerの完成ID、scheduler rejection、scheduler drop（instrumentationの原因つき）、関連Conflict ID、暫定winner、Target priorityを記録し分類する |
| 許容差 | Step順、skip可能位置のexecutor、`weaponSwitchCount`、`improvementPreferenceViolationCount`、`expandedStates`、`evaluationScore`、`preferredSourceProgressCount`、Beam側だけのConflict、`rejectedBuildListEntries` のmapping | 値を記録するだけ |
| review | scheduler側だけに出たConflict | 自動では許容しない（`needs_review`） |

completion regressionの分類（`PlannerCompletionLoss`）:

| suspectedCategory | 条件 |
| --- | --- |
| `beam_branch_combination`（A） | 暫定帰結で落ち、その暫定winnerのTargetもBeamが完成させた |
| `provisional_priority_outcome`（B） | 暫定帰結で落ち、暫定winnerのTargetをBeamは完成させていない |
| `deadlock_or_stall`（C） | 7.8のdeadlock / stall dropで落ちた |
| `fixture_cardinality`（E） | 入力が1 Target = 1 Entryでない |
| `unexplained`（Dの候補） | 上記のどれでもない |

評価（`assessment`）は、Bでかつ「Beamの完成集合がschedulerの完成集合を含まない」ときだけ
`expected_semantic_difference`（設計6.5の意図したpriority選択）。Beamの完成集合がschedulerの完成集合を
含む（schedulerは何も得ずに失った）ときは、分類（Eを除く）にかかわらず `unexpected_regression`。
Aは、Beamの完成集合がschedulerの完成集合を含まないときだけ `known_limitation`（19.2）。
それ以外は `undetermined`。判断できないものを許容扱いにしない。
（semantic fix PRで、実装どおりのこの規則にコメントとtest名を揃えた。分類の意味は変えていない。）

### 2.2 scheduler instrumentation（`src/domain/planner/plannerSchedulerInstrumentation.ts`）

`PlannerExecutionOptions.schedulerInstrumentation`（`now?`、`onScheduleEnd`）。`undefined` なら
collectorを作らない。Beamの `PlannerSearchInstrumentation` と同じ契約（読むだけ、stateを変えない、
RNGを呼ばない、`expandedStates` / 停止条件を変えない、Worker DTO / `PlannerResult` / 永続化に載らない）で、
Beamのdepth / trim / dedup modelは流用しない。Route commitmentへは読み取り専用の
`PlannerRouteCommitmentObserver` を渡す。

`PlannerSchedulerRunMetrics.counts`:

```text
commitmentRuns / commitmentIterations
initialCandidates / initialCommitted / initialDropped / initialSecured / initialNotNeeded
collisionDetectionCount / detectedCollisionCount
provisionalWinnerCount / provisionalLoserCount
dynamicCommitCount / releaseCount / recommitCount
deadlockDropCount / stallDropCount / preconditionDropCount
schedulerIterationCount / appliedRouteActionCount / appliedReserveActionCount
safeActionCandidateCountTotal / safeActionCandidateCountMax
waitingIterationCount / waitingStreamCountTotal
physicalSharedActionCount / sharedProgressedEntryCount
fastForwardedUnitCount (bonus / skill)
finalCommitted / finalSecured / finalReleased / finalDropped / finalNotNeeded
```

ほかに `provisionalOutcomes`（winnerと押し出したEntry）、`drops`（Entryごとの原因
`initial_resolution` / `initial_precondition` / `provisional_outcome` / `deadlock` / `stall` / `precondition` /
`action_rejected` / `reserve_rejected`、reason、iteration、winner、conflict kind）、`phaseMs`
（`initialize` / `refreshCommitment` / `safeActions` / `applyAction` / `reserve` / `finish`。
`preparePlannerInitialContext()` による入力validation・Route unit計画・初期conflict検出はscheduler run作成前なので
どのphaseにも入らない。elapsedとphase合計の差の大半はこれである）。

testで固定したこと: acceptance catalogue全33件と `sanity-3` / `representative-12` でinstrumentation on / off の
scheduler結果（trace、conflicts、rejections、termination、bestState全体）が完全一致、cancelも一致、同じ入力の
2回実行でmetrics（clockなし）とresultが完全一致、countsが結果と整合（applied route + reserve = `expandedStates` 等）、
structured clone / JSON往復で不変。

### 2.3 test専用の戦略注入（`createProductionPlanWithSearchRunner()`）

`createProductionPlanWithObserver()` の本体を `createProductionPlanWithSearchRunner(searchRunner, ...)` へ移し、
`createProductionPlanWithObserver()` は `runPlannerBeamSearch` を渡すだけにした。差し替わるのはfull searchだけで、
observer（`beforeBeamSearch` / `afterBeamSearch`、B8 / B9のrerun budget authority）、runtime-unsupported retry、
Trace Replay、projection、`PlanningInputSnapshot`、checkpoint defence、rejected / materialsは同じ実装を通る。
observer名はPhase Cまで変えていない。

- Production API / Worker protocol / `PlannerInput` / DTO / DB / UI / 設定 / 環境変数に戦略は無い
- B8 / B9のscheduler testは、そのtest moduleの中で `vi.mock` により
  `createProductionPlanWithObserver` を「scheduler runner + 共有後段」へ差し替えるだけ
- guard test（`productionPlanGeneration.searchRunner.test.ts`）: Productionの
  `createProductionPlanWithObserver()` がBeam Searchを1回だけ呼ぶこと、scheduler / seam /
  `schedulerInstrumentation` の名前がtest・benchmark・定義moduleの外（`app` / `components` / `db` /
  `pages` / `services` / `stores` / `workers` / `domain`）に現れないことをsource scanで確認

### 2.4 Browser Worker benchmark（既存Issue #103 benchmarkの拡張）

- benchmark Worker（`plannerSearchInstrumentation.worker.benchmark.ts`）のrequestに benchmark専用の
  `strategy?: 'beam' | 'scheduler'`（省略時Beam）と `summarize?: boolean`（省略時true）を追加。
  Production Planner Worker protocolは変更していない
- 結果は `PlannerBenchmarkRunResult`（`{ strategy: 'beam', result, summary }` |
  `{ strategy: 'scheduler', scheduler, summary }`）。Beamは既存の `result` field（depths / run / digest）を
  そのまま保持する。schedulerはBeamのdepth等を偽装せず、自身のmetricsを持つ。`summary` は計測したsearchの後に
  Worker内で作るparity要約（elapsedに含まない）
- Worker内のEngineは既存どおり `ProductionRngEngine`（`plannerSearchInstrumentation.worker.benchmark.entry.ts`）
- schedulerのcancelは既存の `issue103_cancel` → `shouldCancel` → `termination.cancelled` → Worker responseで
  成立（Node / jsdomのcontroller testでschedulerとBeamの両方を確認）
- 進捗はBeamが既存の `issue103_depth`、schedulerが256 action毎の `issue103_progress`
- ページ（`PlannerSearchInstrumentationBenchmarkPage`）: Strategy選択（Beam / Scheduler / Compare both）、
  Export JSON貼り付けはどのstrategyでも既存の `createPlannerInputFromExportJson()` → `createPlannerInput()` →
  Workerで動く。Raw result JSONは `{ environment, run }` / `{ environment, beam, scheduler, parity }`
- console API: `issue103Benchmark.run({ workloadId, options, instrumented, projections, strategy, summarize })`
  （`strategy` 省略で従来のBeam）、`issue103Benchmark.compare({ workloadId, options, instrumented })`
  （Beam → schedulerを別Workerで順番に実行。同時実行しない）

---

## 3. acceptance fixtureのparity（Node / Vitest、Fake Engine fixture）

`src/test/fixtures/plannerSchedulerScenarios.ts` に設計16.1 A〜M と16.3の入力をcatalogue（33件）として置き、
全件をparity harnessに通した（`plannerSchedulerParity.test.ts` / `.acceptance.test.ts` /
`.conflicts.test.ts`）。Beam側は各fixtureの既定 `PlannerOptions`（`300 / 10000 / 50`、bounds系は指定値）。
Phase A testはそのまま残し、step単位のassertionはそちらが持つ。

### 3.1 結果

| scenario | Beam完成 | scheduler完成 | Beam status | scheduler status | verdict |
| --- | ---: | ---: | --- | --- | --- |
| A independent lanes | 2/2 | 2/2 | completed | completed | parity |
| B one Gogma stream | 1/3 | 3/3 | incomplete | completed | parity |
| C required + skippable | 2/2 | 2/2 | completed | completed | parity |
| D unresolved conflict（priority 2 / 4） | 1/2 | 1/2 | exhausted | exhausted | parity |
| D equal priority | 1/2 | 1/2 | exhausted | exhausted | parity |
| E shared physical action | 2/2 | 2/2 | completed | completed | parity |
| F transient collision | 1/2 | 1/2 | exhausted | exhausted | parity |
| F transient executor | 2/2 | 2/2 | completed | completed | parity |
| G bonus_first / skill_first / planner | 1/1 | 1/1 | completed | completed | parity |
| G preferred lane waits | 2/2 | 2/2 | completed | completed | parity |
| H checkpoint pin / both lanes | 2/2, 1/1 | 2/2, 1/1 | completed | completed | parity（milestone一致） |
| I not preferred source | 1/1 | 1/1 | completed | completed | parity |
| J same owned weapon | 1/2 | 1/2 | exhausted | exhausted | parity |
| K predicted forge / blind waits / blind unconfirmed | 1/1, 2/2, 1/1 | 1/1, 2/2, 1/1 | completed | completed | parity |
| L explicit resolution | 2/4 | 2/4 | exhausted | exhausted | parity（両者とも選択Entryを実行、非選択を不採用） |
| M temporary replacement | 2/2 | 2/2 | completed | completed | parity（置換元Entryを記録しない） |
| zero-operation | 1/2 | 1/2 | exhausted | exhausted | parity |
| **deadlock（7.8の例）** | **2/2** | **1/2** | completed | exhausted | **completion_regression** |
| cross satisfaction | 2/2 | 2/2 | completed | completed | parity |
| dynamic commitment | 2/2 | 2/2 | completed | completed | parity |
| committed-only sharing | 1/2 | 1/2 | exhausted | exhausted | parity |
| pinned past | 1/2 | 1/2 | exhausted | exhausted | parity |
| exact bounds（expanded 154） | 0/2 | 2/2 | incomplete | completed | parity |
| exact bounds（steps 154） | 2/2 | 2/2 | completed | completed | parity |
| bounded（steps 20 / expanded 20） | 0/3 | 0/3 | incomplete | incomplete | parity |
| malformed legacy duplicate | 0/1 | 0/1 | exhausted（fail closed） | exhausted（fail closed） | parity（同じvalidation issue / warning） |
| empty Build List | 0/0 | 0/0 | exhausted | exhausted | parity |

全件でmandatory違反なし、scheduler側だけのConflictなし、scheduler Trace Replay有効、Production projection成立。

### 3.2 completion regression: `deadlock`（初回。semantic fixで解消、11章）

| 項目 | 値 |
| --- | --- |
| fixture | 設計7.8の例。X: 所持Normalを Skill S0でconversion → Gogma C0〜C5をReset（C5がrequired）。Y: 所持Gogma、Bonus C0〜C7 Reset、Skill S0〜S2 Reset Skills、Skill lane開始状態（lane position 0）を選択checkpoint。Y priority 2、X priority 3 |
| Beam completed | `target.x`、`target.y` |
| scheduler completed | `target.x` |
| lost | `target.y`（priority 2） |
| scheduler drop | `entry.y`: `deadlock` / `conflict_not_committed`（iteration > 0） |
| 関連Conflict / 暫定winner | なし（Conflictは0件。暫定帰結ではない） |
| suspectedCategory / assessment | `deadlock_or_stall`（C） / **`unexpected_regression`**（Beamの完成集合がschedulerの完成集合を含む） |

Beamの最良trace（Trace Replay有効、milestone検証済み）:

```text
0      convert_normal_to_gogma  entry.x  Skill 7 -> 8   (Yのpin-blocked Reset Skills S7の位置を消費)
1..6   reset_bonuses            entry.x  Gogma 10 -> 16
7      reserve                  entry.x
8..9   reset_bonuses            entry.y  Gogma 16 -> 18 (Y Bonus laneのIdeal終端でpin解除)
10..11 reset_skills             entry.y  Skill 8 -> 10 (S7 unitはpin解除後にfast-forward)
12     reserve                  entry.y
```

schedulerは、Yのpin-blockedなskip可能Reset Skills（S7）を設計5章どおりholdingとして扱うため、S7ではXの
conversion（required）とYのunitが同じ位置を保持し、Xのconversionを実行できない。XのGogma C15 required unitは
conversion待ちでready でなく、Y側はC15を通過できないので待つ。safe actionが尽きて7.8のdeadlockと判定し、
順位関数 `R` 最下位のYを落とす。

Beamが示したとおり、pin-blockedのskip可能unitは他Entryにその位置を消費されても失われない。
`fastForwardPlannerRouteProgress()` はpinで止まるが、pin解除後の次の適用で `current > counterBefore` かつ
passableとして通過する。Routeが失われるのは、その後ろのrequired unitの位置まで通過された場合だけで、
それはrequired unit自身がholdingとして守っている。したがって設計5章の根拠（「次回
`counter_before_current` でRouteが失われる」）と7.8の「どの順でも両方は成立しない」は、この例では成り立たない。
schedulerがYを落とす直接の実装箇所は、holding判定（`isPlannerLaneUnitHolding()`）、6.8のlane-head判定
（`laneHeadRejection()`）、commitment判定（`plannerRouteCommitmentRejection()`）の3つである。

これはschedulerのsemantics変更を要するため、Phase Bでは修正していない（指示どおり、scheduler algorithm /
deadlock heuristicを変更しない）。Phase A test（`plannerDeterministicScheduler.test.ts` 16.3 deadlock）は
現行設計の期待どおりYのdropを検証しており変えていない。Phase B test
（`plannerSchedulerParity.test.ts`）はこの差を「発見した差」として固定している（許容とはしていない）。

---

## 4. 小規模workloadのparity（Node / Vitest、ProductionRngEngine）

| workload | Beam | scheduler | verdict |
| --- | --- | --- | --- |
| `sanity-3`（`300 / 10000 / 50`） | completed 3/3、expanded 604、trace 10 | completed 3/3、expanded 10、trace 10 | parity（Step順だけ異なる。weapon switch 2 / 2、conflict 0） |
| `representative-12`（`1000 / 20000 / 50`） | incomplete（`max_expanded_states`）2/12、trace 30 | exhausted 10/12、trace 330 | parity。Beam-only完成なし。Conflict 2件は両者同一ID。schedulerの未完成2件はどちらも暫定帰結の敗者（`resource_conflict`） |

Node CIには `sanity-3`、`representative-12`、catalogue全件を入れた。`representative-35` のBeam full runは
Nodeの通常testに入れていない（25分級）。

---

## 5. representative-35（実Browser Worker）

### 5.1 環境

| 項目 | 値 |
| --- | --- |
| Browser | 実Chrome 153（`Chrome/153.0.8010.49`、`--headless=new`、専用profile、window 1280×900）。CDPはページ起動・「Issue 103 Planner Search」選択・`issue103Benchmark.run()` / `compare()` 呼出しだけに使用 |
| userAgent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36` |
| `document.visibilityState` | `visible`（全run） |
| `navigator.hardwareConcurrency` | 16 |
| OS / CPU / RAM | Windows 11 Pro、AMD Ryzen 7 9700X（8C/16T）、31.1 GB |
| build | `vite.benchmark.config.ts` のproduction bundle（`import.meta.env.MODE = production`）を `vite preview` で配信 |
| Worker / Engine | benchmark専用Worker（`plannerSearchInstrumentation.worker.benchmark.entry.ts`）、unmodified `ProductionRngEngine`（`production-rng:c5-e7`） |
| fixture | `representative-35`（35 Target / 35 Entry、1 Target = 1 Entry、conflict式任せ。実ユーザーデータではない） |
| PlannerOptions | `maxPlanSteps 1000 / maxExpandedStates 200000 / beamWidth 50`（PR #107 baselineと同じ） |
| 実施順 | `sanity-3` compare → `representative-12` compare → scheduler plain ×3 → scheduler instrumented ×3 → `representative-35` compare（Beam → scheduler） → scheduler plain / instrumented 交互 ×3。どのrunも1つの新しいWorkerで単独実行（同時実行なし）。Beam計測中はNode test等を走らせていない |

### 5.2 結果

| 項目 | Beam Search | deterministic scheduler |
| --- | --- | --- |
| Worker elapsed | **874,299 ms**（約14.6分、instrumentation ON） | **830.0 ms**（compare内、instrumentation ON） |
| round-trip elapsed | 875,430 ms | 2,250 ms（parity summaryの作成を含む） |
| termination | `incomplete`（`max_expanded_states`） | `exhausted`（boundなし） |
| completed Targets | **13 / 35** | **25 / 35** |
| expandedStates | 200,000 | 398（= 適用action数） |
| trace長 | 138（route 125 + reserve 13） | 398（route 373 + reserve 25） |
| conflicts | 12件（`same_gogma_counter` 6 / `same_skill_counter` 6） | 4件（`same_skill_counter` 1 / `same_gogma_counter` 3） |
| selected Entries | 13 | 25 |
| runtime rejections | `counter_before_current` 385 | `conflict_not_committed` 10 |
| rejected Build List record | 0件（incompleteのため `requires_protected_weapon` / `resource_conflict` 以外を出さない既存規則） | 10件（すべて `resource_conflict`） |
| weaponSwitchCount | 30 | 40 |
| improvementPreferenceViolationCount | 0 | 0 |
| Trace Replay | 有効（138 drafts） | 有効（398 drafts） |
| Production projection | 有効（125 Step、全Step `executionEffects`、chain閉じる） | 有効（373 Step、全Step `executionEffects`、chain閉じる） |

Beamの構造値はPR #107記録と一致した（depth 159、successor 200,000、successor / expanded state 25.52、
semantic dedup 0.0%、beam trim 96.0%、`counter_before_current` 試行38,488回、unique conflict 12、
完成13 / 35）。時間内訳は `dedupAndTrim` 71.2%、`applyAction` 25.1%、`successorEvaluation` 3.5%、
`beamStateSetup` 0.2%。PR #107の1,510,468 msとの差は、当時Browser full runとNode full runを同時に
走らせていたこと（PR #107記録5章）による負荷差と考えられる（本計測は単独実行）。

### 5.3 parity

| 項目 | 結果 |
| --- | --- |
| verdict | `parity` |
| mandatory | 違反なし |
| completion regression | **なし**。Beamの完成13件はすべてschedulerも完成（Beam-only 0件）。scheduler-only完成12件（t07、t12、t14、t15、t16、t19、t27、t30〜t34） |
| conflicts | Beam 12 / scheduler 4 / 共通 4 / Beam-only 8 / scheduler-only **0**。Beam-only 8件は破棄branch上で見つかった競合（設計8.5の想定どおり） |
| rejection mapping | schedulerの `conflict_not_committed` 10件 → `resource_conflict` 10件（8.4） |

scheduler未完成の10 Targetはすべて初期commitmentの暫定帰結の敗者で、deadlock / stall / 前提崩れのdropは0件。
全35 Targetのpriorityは3で、暫定winnerは順位関数 `R` の `estimatedOperationCount` 昇順で決まった。

| Conflict | participant | winner | 敗者 |
| --- | ---: | --- | --- |
| `0540797b`（`same_skill_counter`） | 8 | t13 | t04、t05、t06、t11、t17、t23、t29 |
| `24b2d17e`（`same_gogma_counter`） | 3 | t01 | t00、t18 |
| `5d71efec`（`same_gogma_counter`） | 2（t00と `7b80d6e3`） | ― | t00は上で敗者のため、相手は残る |
| `f1c0a7ab`（`same_gogma_counter`） | 2 | t21 | t03 |

各Conflictは1つのCounter位置のrequired unit同士であり、1つのConflictから完成できるTargetは高々1件である。
したがってこの入力で完成可能な最大数は 35 − 7 − 2 − 1 = 25 で、schedulerは最大値に達している
（greedyの暫定帰結による損失はこのfixtureでは無い）。

### 5.4 scheduler metrics（representative-35、instrumented）

| metric | 値 |
| --- | ---: |
| commitmentRuns / commitmentIterations | 1 / 3 |
| initialCandidates → committed / dropped | 35 → 25 / 10 |
| collisionDetectionCount / detectedCollisionCount | 4 / 8 |
| provisional winners / losers | 3 / 10 |
| dynamicCommit / release / recommit | 0 / 0 / 0 |
| deadlock / stall / precondition drops | 0 / 0 / 0 |
| schedulerIterationCount | 374 |
| applied route actions / reserves | 373 / 25 |
| safe action candidates total / max | 4,421 / 36（1 iterationあたり平均11.8） |
| waiting iterations | 0 |
| physical shared actions | 0（全Entryが別の所持Gogma。PR #107と同じ） |
| fast-forwarded units | 3,098（bonus 2,213 / skill 885） |
| final committed / secured / released / dropped | 0 / 25 / 0 / 10 |
| phaseMs（compare内run） | initialize 3.7、refreshCommitment 48.7、safeActions 55.7、applyAction 36.3、reserve 8.9、finish 0.5 |

elapsedとphase合計（約154 ms）の差（約680 ms）は、scheduler run作成前の `preparePlannerInitialContext()`
（入力validation、Route unit / lane計画、初期conflict検出）とWorker yieldである。これはBeam Searchも同じ処理を行う。
metricsは3回のinstrumented runで完全一致（`phaseMs` を除く）、digestは全9回のscheduler runで完全一致した。

### 5.5 scheduler elapsedとinstrumentation overhead

| 系列 | run（Worker elapsed ms） | median | min / max |
| --- | --- | ---: | --- |
| A. 連続: plain ×3 | 1,461.9 / 1,421.2 / 1,451.4 | 1,451.4 | 1,421.2 / 1,461.9 |
| A. 連続: instrumented ×3 | 1,361.3 / 1,313.6 / 1,369.8 | 1,361.3 | 1,313.6 / 1,369.8 |
| B. 交互: plain ×3 | 900.6 / 849.9 / 839.9 | 849.9 | 839.9 / 900.6 |
| B. 交互: instrumented ×3 | 839.6 / 846.8 / 858.8 | 846.8 | 839.6 / 858.8 |

- overhead比（instrumented median / plain median）: A 0.938、B 0.996。instrumentationの費用は計測誤差の範囲で、
  区別できない
- 系列AはBeam `representative-12` runの直後、系列BはBeam `representative-35` runの後に実施した。
  AとBの水準差（約1.45 s → 約0.85 s）は同じWorker codeの実行順・browser状態による差であり、scheduler自体の
  差ではない（digestは全runで同一）。比較にはBの交互系列を使う
- Beam 874,299 ms に対しscheduler約0.85 s（約1,000倍）

---

## 6. B8 / B9 schedulerの注入

### 6.1 B8 constrained re-search（`plannerConstrainedOrchestration.scheduler.test.ts`）

既存B8 testの代表fixture（Target A / BがGogma Counterの同じ位置でReset、ユーザーがAを固定）を、
full searchをschedulerへ差し替えて `createProductionPlanWithConstrainedSearch()` で実行した。
Beam Searchの呼び出しは0回であることも確認している。

| 項目 | 結果 |
| --- | --- |
| resolutionなし | constrained enumerationを始めず、scheduler単独の `createProductionPlanWithSearchRunner()` と同じPlan / conflicts。暫定帰結はresolutionにならない（`selectedBuildListEntryId = null`） |
| initial full run → Conflict → fixed resolution → Candidate trial → replacement preflight → scheduler full rerun → adoption | 成立。generated Entryは1件（Target B）、Route形は `reset_bonuses ×3 → reset_skills`（Beam版testと同じCandidate） |
| adoption条件 | 既存の `isConstrainedTrialAdoptable()` のまま（trial / fixed / 採用済みgenerated Entryがselected）。`selectedBuildListEntryIds = [generated, entry A]` |
| replacement metadata | `{ targetWeaponId: B, replacedBuildListEntryId: entry B, generatedBuildListEntryId: generated }`。Planは置換後集合で計算・記録され、entry Bを含まない |
| termination | completed 2/2、warningなし |
| rerun bounds | 採用に必要なfull run数をNとすると、`maxPlannerReruns = N - 1` は採用なし + `max_planner_reruns_reached`、`= N` は採用しwarningなし |
| trial bounds | 採用に必要なtrial数は **4**（Beam版testと同じ）。3で `max_candidate_trials_per_conflict_reached`、4で採用 |
| `maxGeneratedBuildListEntries = 1` | 採用1件で十分、warningなし |
| 決定性 | 同一入力の2回実行でgenerated Entry / selected / run数が一致 |

bounds（`2 / 1 / 4` のProduction default、fixtureの `8 / 4 / 16`）は変更していない。

### 6.2 B9 what-if（`plannerWhatIfCalculation.scheduler.test.ts`）

既存B9 testのfixtureと期待値をそのまま使い、full searchをschedulerへ差し替えた（Beam呼び出し0回）。

| 項目 | 結果（Beam版testと同じ期待値） |
| --- | --- |
| found | Target B: `found`、distance `{ estimatedOperationCount: 1, estimatedGogmaAdvance: 1, estimatedSkillAdvance: 0, estimatedNormalAdvance: null }` |
| not found | 全Candidateが不成立なら `stopped_by_enumeration_bound` |
| candidate trial bound | 1 trialで `found` にならない。2 trialで `stopped_by_candidate_trial_bound`、3 trialで `stopped_by_enumeration_bound` |
| 両cap同時 | trial boundを優先（`1 / 1` → `stopped_by_candidate_trial_bound`） |
| rerun bound | `99 / 1` → `stopped_by_planner_rerun_bound`、Production Plan generationに2回入り、full searchは1回だけ実行 |
| 共有budget | Target Cが `stopped_by_planner_rerun_bound`（B found後にbudget切れ） |
| checkpoint blocked | `blocked_by_selected_checkpoint`、そのTargetには何も実行しない |
| replacement set | trialのfull runは `temporary_replacement` で、置換元entry Bを含まない |
| feasibility | 既存の `isPlannerWhatIfCandidateFeasible(plan.selectedBuildListEntryIds, ...)` のまま |

---

## 7. 再現手順

```bash
npx vite build --config vite.benchmark.config.ts
```

```bash
npx vite preview --config vite.benchmark.config.ts
```

1. `http://localhost:4173/GogmaArtianPlanner/benchmark.html` を開き（portはpreviewの表示に従う）、
   「Issue 103 Planner Search」を選ぶ
2. **計測中はタブを前面・表示状態に保つ**（`document.visibilityState = visible`。Claude desktopの内蔵
   browser paneは非表示時に凍結されるため使わない）
3. 画面から: Source `B-35`、Strategy（Beam / Deterministic scheduler / Compare both）、`1000 / 200000 / 50`
4. consoleから（CDP `Runtime.evaluate` でも同じ）:

```js
// scheduler（instrumentationなし / あり）
await issue103Benchmark.run({
  workloadId: 'representative-35',
  strategy: 'scheduler',
  options: { maxPlanSteps: 1000, maxExpandedStates: 200000, beamWidth: 50 },
  instrumented: false,
  summarize: false,
})
await issue103Benchmark.run({
  workloadId: 'representative-35',
  strategy: 'scheduler',
  options: { maxPlanSteps: 1000, maxExpandedStates: 200000, beamWidth: 50 },
  instrumented: true,
})
// Beam → schedulerを順番に実行し、parity reportを返す（Beamは約25分）
await issue103Benchmark.compare({
  workloadId: 'representative-35',
  options: { maxPlanSteps: 1000, maxExpandedStates: 200000, beamWidth: 50 },
  instrumented: true,
})
```

`run()` / `compare()` の戻り値は `{ visibilityState, environment, report, run }` /
`{ visibilityState, environment, report, beam, scheduler, parity }`。`strategy` を省略した `run()` は
PR #107と同じBeam runである（`run.result` の形も同じ）。raw JSONはRepositoryへcommitしない
（`.gitignore` の `*_BROWSER_RAW_RESULTS.json`）。

---

## 8. Phase C readiness（初回判定。11.6で再判定）

**Phase C readiness（PR #114時点）: NOT READY**

| READY条件 | 状態 |
| --- | --- |
| scheduler Trace Replay valid | 満たす（全fixture、`representative-35` 実Browser含む） |
| Production projection valid | 満たす |
| B8 scheduler injection成立 | 満たす（6.1） |
| B9 scheduler injection成立 | 満たす（6.2） |
| 代表fixtureで未説明のcompletion regressionなし | **満たさない**。acceptance fixture `deadlock` で `unexpected_regression`（3.2）。原因は特定済みだが、設計5章 / 7.4 / 7.8の規則そのものがBeamに反証されており、「意図した差」として受け入れられる根拠が無い |
| representative-35で重大な正当性問題なし | 満たす（mandatory違反なし、Beam-only完成なし、scheduler 25 / 35は本fixtureの上限） |

NOT READYの理由は性能ではなく意味論である。Phase Cへ進む前に次のどちらかを決める必要がある
（本PRではどちらも行っていない）。

1. pin-blockedのskip可能unitをholdingとして扱わない（passableとして他Entryに位置を消費させ、後続のrequired unit
   だけがholdする）。変わるのはholding判定・6.8 lane-head判定・commitment判定・7.8の例で、Phase A test
   （16.3 deadlock、Route commitmentのpin-blocked test）の期待も変わる。Trace Replay / checkpoint milestoneの
   契約は変えない見込みだが、変更後に本harnessで再計測する
2. 現行規則を維持し、この差を「schedulerは選択checkpointのpinを越える位置消費を保守的に待つ」という意図した差として
   設計書に明記して受け入れる（Beamより完成数が減るケースが残ることを受容する）

性能面の根拠（`representative-35` でBeam約14.6分 / 13件に対しscheduler約0.85秒 / 25件）はPhase Cを支持するが、
それだけでREADYにはしない。

---

## 9. 残課題

- 上記8の仕様判断（Phase C blocker）: **解決済み**（11章）
- 実ユーザーの35件Export（Issue #103コメント、Beam 8 / 35）では未計測。ページのExport JSON貼り付け
  （Strategy: Compare both）で同じ手順を実行できる
- 暫定帰結の厳密最適化（19.2）: 本計測では劣化の実例なし（`representative-35` は上限25に到達）。
  実データでConflictが複合する場合は再評価
- deadlock / stallのユーザー向け表示（19.2）: Phase Bでは扱っていない
- weapon switch数はschedulerの方が多いことがある（`representative-35` 40 vs 30、`representative-12` 13 vs 4。
  ただしBeamは完成数が少ない）。7.7のkey順の見直しは19.2の「Phase Bの実データ計測後」の判断事項
- `maxPlanSteps` 既定値（300）: `representative-35` のschedulerはtrace 398でboundに達していない（1000設定）。
  既定300では足りない入力があり得るため、Phase Dの見直しの根拠にする
- Node CIのparity testはBeam側の実行で合計約100秒（CPU時間）を要する（catalogueの長いscenarioと
  `representative-12`）。3 fileに分けてworker並列に載せた

---

## 10. 変更していないもの

- Production routing: `createProductionPlanWithObserver()`、Planner Worker、B8 / B9、再計画PreviewはBeam Search
- Production Worker protocol、`PlannerInput`、DTO、UI、Persistence、DB / Export schema
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 13、`DATABASE_SCHEMA_VERSION` 8、`ExportRoot.schemaVersion` 11、
  `RngState.schemaVersion` 2、`AppSettings.schemaVersion` 1、`PRODUCTION_RNG_ENGINE_VERSION`
  `production-rng:c5-e7`、Master `dataVersion`
- scheduler algorithm、canonical ordering、暫定帰結、deadlock heuristic（計測hookと、計測専用の待機数の集計だけを追加）
- Beam Search、PR #107 instrumentation、Candidate Search、constrained enumeration、orchestration / what-if bounds
- 正式仕様（REQUIREMENTS / PLANNER_SPEC / UI_FLOW / DATA_MODEL / AGENTS）

---

## 11. semantic fix後の再検証（pin-blockedのskip可能unit）

実施日: 2026-09-25（JST。Browser計測はUTC 2026-09-24T22:16Z〜22:34Z）。
基準main: `6ad4f742291aa7ee5f1ed486cf68f799656f881b`（PR #114 merge後）。
branch: `fix/planner-pin-blocked-skippable`（計測はこのbranchの作業ツリーをbuildしたbundle）。

### 11.1 修正した契約

3.2で見つかった差の原因（schedulerがpin-blockedのskip可能unitをholdingとして扱っていたこと）を、
既存Beam / Trace Replayの意味に合わせて修正した。仕様は設計書5章 / 6.2 / 6.8 / 7.2〜7.4 / 7.7 / 7.8と
PLANNER_SPEC 7.5.2に記載した。

| 概念 | 定義 | helper |
| --- | --- | --- |
| holding | `canSkipWhenCounterPassed === false`。pinの現在状態は使わない。選択checkpoint終端は常にholding | `isPlannerLaneUnitHolding(unit)` |
| skippable（position-passable） | `canSkipWhenCounterPassed === true`。他EntryがそのCounter位置を消費してよい | （holdingの否定） |
| pin gating | Entry自身のlane progressを止める（実行もfast-forwardもpinを越えない） | `isPlannerLaneUnitBlockedByPin()`（不変） |
| fast-forwardable now | skippableかつ現在pinにblockされない | `isPlannerLaneUnitFastForwardable()`（旧 `isPlannerLaneUnitPassable()`。意味は同じ） |

- `fastForwardPlannerRouteProgress()` / `nextPlannerLaneUnits()` / Trace Replay / Beam Searchの意味は変えていない
- Route commitment: 判定対象はholding unitだけ。pin-blockedのskip可能unitが通過済みでも、それだけでは
  `counter_before_current` / `conflict_resolution_not_selected` にしない
- scheduler: frontier・6.8のlane判定は各laneのfrontier unit（通過済みのskip可能unitを飛ばした最初のunit）で
  行う。pin-blockedのskip可能unitは `holding = false` / `ready = false`。後ろに隠れたholding unitは
  frontierで位置を保持し、通過済みなら従来どおり `counter_before_current`
- canonical順のnext-holding距離はholding（skip不可）だけを数える。key順は不変
- deadlock / stallの判定規則・順位・drop規則は不変

### 11.2 acceptance catalogue（Node / Vitest、Fake Engine fixture、35件）

catalogueに2件を追加した（計35件）。

- `true-deadlock`: 7.8の新しい説明例。holding unit同士が循環して待つ真のdeadlock（設計7.8）
- `pinned-past-lost-holding`: `pinned-past` のSkill Counterを1つ先へ進め、pin-blockedのskip可能unitの後ろの
  holding unitまで通過済みにした入力

初回（3.1）から変わった行と追加した行:

| scenario | Beam完成 | scheduler完成 | Beam status | scheduler status | verdict | 初回との差 |
| --- | ---: | ---: | --- | --- | --- | --- |
| **deadlock（旧7.8の例）** | 2/2 | **2/2** | completed | **completed** | **parity** | 初回はscheduler 1/2（`completion_regression`）。drop 0件、trace 13（Beamと同じ長さ）、Trace Replay / projection有効 |
| true-deadlock（新） | 2/3 | 2/3 | exhausted | exhausted | parity | 両者とも `target.x` / `target.z` を完成。schedulerは `entry.y` をdeadlockとしてdrop（`R` 最下位、priority 1） |
| pinned-past | 1/2 | 1/2 | exhausted | exhausted | parity | 完成数は同じだが、選んだEntryが変わった。初回のschedulerは `entry.p` を `counter_before_current` で落として `entry.q` を完成させ、Beamは `entry.p` を完成させていた。修正後は両者とも `entry.p`（schedulerは `entry.q` を暫定帰結で落とす） |
| pinned-past-lost-holding（新） | 1/2 | 1/2 | exhausted | exhausted | parity | 両者とも `entry.q`。schedulerは `entry.p` を初期commitmentで `counter_before_current` |

それ以外の31件は初回と同じ結果（完成数・status・verdict）。全35件でmandatory違反0、completion regression 0、
scheduler側だけのConflict 0、scheduler Trace Replay有効、Production projection成立（fail-closedの2件はno_plan）。

`deadlock` のscheduler trace（testで固定した意味上の順序。Step indexは固定しない）:

```text
X conversion（Skill S0 -> S1）         YのSkill S0はskippableでpin-blocked。holdingではないのでXが消費できる
  直後: Skill Counter S1、YのSkill progress 0（pinを越えない）、Y checkpoint未到達
X / Y Bonus Reset                     Xのholding（C5）を守り、Yのskip可能unitはexecutor / fast-forward
Y Bonus C7（Bonus laneのIdeal終端）    pin解除、milestone。同じactionの中でYのSkill S0をfast-forward
Y Reset Skills S1、S2                  後続Skill unitを実行
X / Y reserve
```

### 11.3 小規模workload（Node / Vitest、ProductionRngEngine）

| workload | Beam | scheduler | verdict |
| --- | --- | --- | --- |
| `sanity-3`（`300 / 10000 / 50`） | completed 3/3、expanded 604、trace 10 | completed 3/3、expanded 10、trace 10 | parity（初回と同じ） |
| `representative-12`（`1000 / 20000 / 50`） | incomplete 2/12、trace 30 | exhausted 10/12、trace 330 | parity（初回と同じ。Conflict 2件同一、未完成2件は暫定帰結の敗者） |

どちらも選択checkpointを持たないため、今回の修正は結果に影響しない（完成数・trace・conflict・rejectionが初回と一致）。

### 11.4 representative-35（実Browser Worker）

環境は5.1と同じ（実Chrome 153 `--headless=new`、専用profile、`visibilityState = visible`、
`hardwareConcurrency` 16、`vite.benchmark.config.ts` のproduction bundle、unmodified `ProductionRngEngine`
`production-rng:c5-e7`、`1000 / 200000 / 50`）。実施順は `sanity-3` compare → scheduler plain / instrumented
交互 ×3 → `representative-35` compare（Beam → scheduler）。どのrunも1つの新しいWorkerで単独実行し、
Beam計測中はNode test等を走らせていない。

| 項目 | Beam Search | deterministic scheduler | PR #114との比較 |
| --- | --- | --- | --- |
| Worker elapsed | 1,010,700 ms（約16.8分、instrumentation ON） | 764.2 ms（compare内、instrumentation ON） | 初回はBeam 874,299 ms、scheduler 830.0 ms。Beamの構造値は同一なので差は実行時の負荷差 |
| termination | `incomplete`（`max_expanded_states`） | `exhausted`（boundなし） | 同じ |
| completed Targets | 13 / 35 | 25 / 35 | 同じ |
| Beam-only / scheduler-only完成 | 0件 / 12件（t07、t12、t14〜t16、t19、t27、t30〜t34） | | 同じ |
| expandedStates | 200,000 | 398 | 同じ |
| trace長 | 138 | 398 | 同じ |
| conflicts | 12 | 4（すべてBeamと共通） | 同じ（conflict ID同一） |
| rejection | runtime `counter_before_current` 385、rejected Build List record 0 | runtime `conflict_not_committed` 10、record 10（`resource_conflict`） | 同じ |
| deadlock / stall drop | ― | 0 / 0 | 同じ |
| weaponSwitchCount | 30 | 40 | 同じ |
| Trace Replay | 有効 | 有効 | 同じ |
| Production projection | 有効（125 Step、chain閉じる） | 有効（373 Step、chain閉じる） | 同じ |
| parity | verdict `parity`、mandatory違反なし、completion regressionなし | | 同じ |

Beamの時間内訳は `dedupAndTrim` 70.9%、`applyAction` 25.0%、`successorEvaluation` 3.9%、`beamStateSetup` 0.2%で、
depth 159、successor / expanded state 25.52、beam trim 96.0%、`counter_before_current` 試行38,488回も初回と同一。

scheduler単独run（Worker elapsed）:

| 系列 | run | median |
| --- | --- | ---: |
| plain | 1,303.2 / 1,391.8 / 1,434.0 ms | 1,391.8 ms |
| instrumented | 1,360.2 / 1,359.3 / 1,490.9 ms | 1,360.2 ms |

digest（`bestStateSemanticKeyHash` `fnv1a32:bbdb0e4f`）は全7回のscheduler runで同一。instrumented metricsは3回とも
初回（5.4）と同じ値（commitment runs 1 / iterations 3、35 → committed 25 / dropped 10、provisional winners 3 /
losers 10、iterations 374、route actions 373 / reserves 25、safe candidates 4,421 / max 36、waiting 0、
fast-forwarded 3,098（bonus 2,213 / skill 885）、deadlock / stall / precondition drop 0）。
本系列はBeam runの前に実施したため、水準は5.5の系列A（約1.4 s）に近い。

`representative-35` は選択checkpointを持たない（`requiredCheckpointEntryIds = []`）ため、pin-blockedのunitが
存在せず、今回の修正でscheduler結果が変わらないのは想定どおりである。完成数25 / 35は5.3で示したこの入力の上限のまま。

### 11.5 B8 / B9

`plannerConstrainedOrchestration.scheduler.test.ts` / `plannerWhatIfCalculation.scheduler.test.ts` を再実行し、
6.1 / 6.2と同じ期待値（adoption、trial数4、rerun / trial / generated boundsの意味、what-ifの各outcome）で
すべて通過した。bounds・adoption条件・feasibility判定は変更していない。

### 11.6 Phase C readiness（再判定）

**Phase C readiness: READY**

| READY条件 | 状態 |
| --- | --- |
| scheduler Trace Replay valid | 満たす（catalogue 35件、`sanity-3`、`representative-12`、`representative-35` 実Browser） |
| Production projection valid | 満たす |
| B8 scheduler injection成立 | 満たす（11.5） |
| B9 scheduler injection成立 | 満たす（11.5） |
| 代表fixtureで未説明のcompletion regressionなし | 満たす。completion regressionは0件（初回の `deadlock` は解消） |
| representative-35で重大な正当性問題なし | 満たす（mandatory違反なし、Beam-only完成なし、25 / 35は上限） |

9章の「上記8の仕様判断（Phase C blocker）」は本章で解決した。9章のその他の残課題（実ユーザーExportでの計測、
暫定帰結の厳密最適化、deadlock / stallの表示、weapon switch数、`maxPlanSteps` 既定値）は引き続きPhase C / D以降の
判断事項である。

### 11.7 変更していないもの

- Production routing（`createProductionPlanWithObserver()` は `runPlannerBeamSearch` のまま）、Production Worker
  protocol、UI、Persistence、Calculation Context schema
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 13、`DATABASE_SCHEMA_VERSION` 8、`ExportRoot.schemaVersion` 11、
  `RngState.schemaVersion` 2、`AppSettings.schemaVersion` 1、`PRODUCTION_RNG_ENGINE_VERSION`
  `production-rng:c5-e7`、Master `dataVersion`
- Beam Search、`fastForwardPlannerRouteProgress()` / `nextPlannerLaneUnits()` / Trace Replayの意味、canonical orderingの
  key順、weapon switch key、暫定帰結、deadlock / stall heuristic、`PlannerOptions` 既定値、Candidate Search、RNG

## 12. Phase C: Production routing切替（追記）

本章は追記であり、1〜11章の計測値・判定は当時の記録としてそのまま保持する。

Phase C（2026-09-25）で `createProductionPlanWithObserver()` のfull Planner runを
`runPlannerDeterministicSchedule()` へ切り替え、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を14へ更新した
（[ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md](./ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md) 17章 Phase C）。
scheduler semanticsは11章の計測時点から変更していないため、representative-35の実Browser計測は再実施していない。
parity harness、scheduler instrumentation、Browser benchmark（`strategy = beam` / `scheduler`）は維持しており、
Beam Searchはbenchmark / parity / oracleとして引き続き直接実行できる。11.7の「変更していないもの」のうち
Production routingとCalculation Context schemaはPhase Cで変更された。
