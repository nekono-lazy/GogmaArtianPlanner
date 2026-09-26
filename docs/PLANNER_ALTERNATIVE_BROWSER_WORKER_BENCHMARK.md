# Planner Alternative Search Browser Worker Benchmark（Phase 3）

## Status

```text
Phase 3-A  harness implemented
Phase 3-B  real Browser measurement completed
Phase 3-C  Production default pending
```

この文書はIssue #136 / #101（Planner競合repair）Phase 3の計測記録である。Phase 3-Aで計測基盤を実装し（1〜11章）、
Phase 3-Bでreal Browser Workerの実測を記録した（12章）。extent（`maxNormalAdvance` / `maxGogmaAdvance` /
`maxSkillAdvance`）と試行上限（`maxCandidateTrialsPerTarget` / `maxPlannerReruns`）のProduction defaultは **まだ決めていない**。
12章の実測をPhase 3-Cの判断材料として渡し、defaultはPhase 3-Cで決める。

この文書は計測記録であり、仕様権威ではない。

## 1. 目的

Planner Alternative Search（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8）とPlanner Alternative kernel
（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19）のProduction defaultを決める根拠として、
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.16が要求する次の値を実Browser Workerから測る。

- time-to-first Candidate
- same-cost closureまでにsettleしたSearch work数と、run全体のsettled work数
- held run長に対するコスト
- Skillのheld-aware state数、Gogmaのheld-aware state数とfamily layout数
- Production RNG prediction呼び出し数（`predictNormalArtian` / `predictSkills` / Reset Bonuses / Keep Bonuses）
- delivered Candidate数、Candidate trial数、full Planner rerun数
- Search終了（`exhausted` / `stoppedByExtent` / `stoppedByConsumer`）とKernel outcome
- cancel latencyとWorker responsiveness（ping）

## 2. Authority

- [REQUIREMENTS.md](./REQUIREMENTS.md)
- [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19、9.2.19.12（bounds / extent）、9.2.19.16（phase分割）
- [SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8（計測用instrumentationを含む）、13.2.6
- [PLANNER_CONFLICT_REPAIR_DESIGN.md](./PLANNER_CONFLICT_REPAIR_DESIGN.md) 11章 / 12章（設計記録）

Phase 2で確定したresource reservation、held / blocked、排他OwnedWeapon、Normal held-prefix、held-aware Skill / Gogma
traversal、origin基準advance、operation cost層単位のlazy性、same-cost closure、6キー順序、`candidateStableKey`、
full Planner trial、9.2.19.6のfound判定、Issue #101 acceptanceは変更しない。

## 3. benchmark-only境界

追加物は `benchmark.html`（`vite.benchmark.config.ts`）からだけ到達できる。

| 役割 | ファイル |
| --- | --- |
| Worker protocol（`pa3_benchmark_` prefix） | `src/benchmarks/plannerAlternativeBenchmarkProtocol.ts` |
| fixture / benchmark-only grid | `src/benchmarks/plannerAlternativeBenchmarkFixtures.ts` |
| rerun-pressure fixture（`kernel_multi_target`） | `src/benchmarks/plannerAlternativeRerunPressureFixtures.ts` |
| counting Engine / stream集計 / Kernel clock observer | `src/benchmarks/plannerAlternativeBenchmarkInstrumentation.ts` |
| main-thread harness（1 run = 1 Worker） | `src/benchmarks/plannerAlternativeBrowserBenchmark.ts` |
| warm-up / measurement series、records、JSON export | `src/benchmarks/plannerAlternativeBenchmarkRunner.ts` |
| Worker controller / entry | `src/workers/plannerAlternative.worker.benchmark(.entry).ts` |
| page（`BenchmarkApp` の「Planner Alternative Phase 3」タブ） | `src/pages/PlannerAlternativeBenchmarkPage.tsx` |

- Production Worker protocol、`PlannerWorkerClient`、Production UIへ何も追加しない。C5既定タブも変えない
- Production Domainへ入れたのはexecution-onlyの計測seamだけである（4章）。Production default定数
  （`defaultPlannerAlternativeSearchExtent` / `defaultPlannerAlternativeTrialBounds` 等）は作らない
- source scan test（`plannerAlternativeBenchmarkIsolation.test.ts`）が、Production moduleからのimportが無いこと、
  Production Planner Worker contractへ何も入っていないこと、instrumentationを渡すProduction callerが無いこと、
  default定数が無いことを固定する

## 4. 計測seam（execution-only）

settled work数とheld-aware state数は既存の公開情報からは正確に取れない（`SearchExecutionContext.onProgress` は
100 work毎の活動信号で、stream内部のstate数を出さない）。そのため
`PlannerAlternativeSearchExecutionOptions.instrumentation` を追加した（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8
「計測用instrumentation」）。

- `onWorkSettled`: `visitPlannerAlternativeCandidates()` のdelivery loopで `scheduler.step()` が `true` を返した直後に1回
- `onSkillReservedDepth`: held-aware Skill streamの1 depth生成後。`streamIndex`、`startSkillCounter`、`depth`、
  `transitions`（frontier state × 合法位置の組、重複込み）、`states`、`absolutePositions`（Skillはstate = 位置なので同値）
- `onGogmaReservedDepth`: held-aware Bonus streamの1 depth生成・公開・frontier縮約後。`generatedStates`（縮約前に
  公開したstate）、`frontierStates`（位置 × family layoutで縮約後）、`absolutePositions`、`familyLayouts`（公開state
  のKeep family layout種類数）

observerは `PlannerAlternativeSearchInput`、search identity、Candidate identity、順序、終了判定に入らず、Production
callerは渡さない。benchmark側の集計はdepth毎の加算だけで、state内容を保持しない。有無で `candidateStableKey` 列・
summary・prediction呼び出し回数が同一であること、Kernel結果が同一であることをtestで固定した
（`plannerAlternativeBenchmarkInstrumentation.test.ts`）。observer callback自体の時間は補正しない。

prediction呼び出し数は、benchmark Worker内で `ProductionRngEngine` を包むcounting Engineで数える。各呼び出しは
同じinputで1回だけ転送し、元の返り値をそのまま返す（追加・省略・cacheしない）。Kernel measurementの数値は
Search、full Planner run、Trace Replayの合計である。

## 5. fixture

fixture構築（Issue #101 fixtureは実Candidate Searchを2回行う）は計測外で、page / runnerがrun前に1回構築して
cacheする。Worker入力は毎回structured cloneされ、cache済みfixtureをmutateしない。

### 5.1 Issue #101 real

`createIssue101RealFixture()` をそのまま使う（Base Seed 51231782、Skill Counter 341、Gogma Counter 55、Charge Blade
rarity 8 Normal Counter 0、火 / 龍、Ideal = 斬れ味・装填強化EX ×1 + 属性強化EX ×2 + 属性強化II ×2）。

- **Search workload** `issue101_fire_dragon_fixed`: origin = `createConstrainedSearchOriginFromPlannerInput()`、
  reservation = `derivePlannerAlternativeReservation([Dragon Entry])`（Normal 0..206 held / 206 blocked、Skill 341
  held + blocked、Gogma 55 held + blocked）、`excludedRouteKeys` = Fire現在Routeの `candidateStableKey()`。
  Conflict DTOをSearch Domainへ渡さない
- **Kernel workload** `issue101_prefer_dragon_normal`: 実fixtureのinitial `same_normal_counter` conflict IDから
  「Dragonを優先」のdecisionを作る（ID hard-code禁止）。trialはPhase 2実装の `createProductionPlanWithObserver()` +
  Trace Replayそのもの
- regression（`production-rng:c5-e7`）: Fire代替 = Normal 0 / 1 / count 1、Skill 342で巨戟化、Gogma 56..289 Reset、
  operation 236、estimated Gogma 235 / Skill 2 / Normal 1、trial Plan 444 Steps。Production RNG等の変更で値が
  変わった場合は期待値を書き換えずに報告する

### 5.2 no-Ideal worst case

既存のIssue #101 Production benchmark fixture（属性強化EX ×3、exact-ID repeat penaltyによりProduction RNGでは
抽選不能）を `createIssue101NoIdealEnumerationInput()` のorigin / Targetのまま使う。`issue101_no_ideal`（空
reservation）と `issue101_no_ideal_dragon_fixed`（Dragon reservation）がある。Candidateは出ず、consumer stopも
無いので、extent終端までのtraversal cost、state growth、prediction growthを測る。

### 5.3 long Skill held / long Gogma held（synthetic Production benchmark fixture）

**game observationではない**。1本のunprotected owned Charge Blade（火）Gogmaと、1 streamだけが変化し得るTargetで
構成する。値はすべてfixture構築時の `ProductionRngEngine` predictionであり、手書きの予測結果は無い。

- `long_skill_held`: Gogmaの5 slot = Gogma 5000のReset prediction（= TargetのIdeal、Bonus workは無い）。Ideal Skill =
  固定anchor `BENCHMARK_ONLY_LONG_HELD_SKILL_IDEAL_POSITION`（Skill 853 = 341 + 512）のprediction。held run = Skill
  `341 .. 341 + heldLength - 1`。Gogma Counterは未確定
- `long_gogma_held`: GogmaのSkill = Skill 5000のprediction（= Ideal Skill）。Ideal 5 slot = 固定anchor
  `BENCHMARK_ONLY_LONG_HELD_GOGMA_IDEAL_POSITION`（Gogma 567 = 55 + 512）のReset prediction。held run = Gogma
  `55 .. 55 + heldLength - 1`。Skill Counterは未確定
- `heldMode`: `held`（held位置もown operation可能。state増加の最悪形）/ `held_blocked`（held位置は全てblocked。
  skipだけ。Issue #101のSkill / Gogma形を伸ばしたもの）
- **held-length scalingでは、Target / Target Ideal / OwnedWeapon / RNG origin（Base Seed、Counter）/ weapon type /
  element / Normal Counter / CalculationContext / `excludedRouteKeys` / 測定対象外streamの条件 / extentを固定し、
  reservationのheld / blocked位置だけを変える**。`heldLength` が変えるのは測定対象streamのheld位置、`heldMode` が
  変えるのはそのblocked位置だけである（anchorはgridの最大held長512の直後。Target表示名もheld長に依存しない）
- scaling seriesのextentは `BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT`（Normal 1 / Gogma 513 / Skill 513。window
  `origin .. origin + 512` がgridの全held runとanchorを含む）で、全held長で同じ値を使う。pageの「固定extentを入力」と
  consoleの `plannerAlternativeBenchmark.longHeld.fixedExtent` がこの値を入れる。extentは自動補完しない
- Idealが固定なので、held長によってCandidateへのown operation数や、Candidateが出るかどうかは変わり得る（held run外の
  位置はown operationで埋める必要がある。また同じSkill / 5 slotがanchorより前に出れば、そこが先に届く）。これは
  scaling seriesが測る差そのものであり、必要ならPhase 3-Bでは `stopAfterCandidates: null` でextent終端まで走らせる。
  time-to-firstの主要evidenceはIssue #101 realで取る
- 旧 `longHeldReachingExtent()`（held長に追従してextentを伸ばすhelper）は削除した。held長ごとにIdealやextentを
  動かす比較をPhase 3-Bのscaling authorityにしない。testは短いseries（`createLongHeldFixture()` の `series`
  引数で固定anchorを近くに置いたもの）を使うが、page / console / runnerは常に既定seriesを使う

### 5.4 multi-target rerun pressure（`kernel_multi_target`、synthetic Production benchmark fixture）

**game observationではない**。`maxPlannerReruns` のsweep用Kernel workloadである。値は `ProductionRngEngine`
prediction、Candidateは `searchCandidates()`、Entryは `createBuildListEntry()`、conflictは `preparePlannerInitialContext()`、
計算は `runPlannerAlternativeKernel()`（Production Search / materializer / preflight / full Planner run / Trace Replay）で、
mockは使わない。

- Charge Blade、Base Seed 51231782、Skill 341 / Gogma 55、Normal Counter無し（Skill / Gogma Counterは全weapon共通）
- Target A（Dragon、priority 5、decisionで固定）: 所持Dragon Gogma。Route = Reset Skills@341 + Reset@55
- Target B / C（Fire、priority 1）: それぞれ所持rarity-8 Fire Normal。Ideal = Fire Gogma 56のReset prediction（Skill条件なし）。
  Route = conversion@341 → Reset@55 → Reset@56。AのDragon GogmaはFire Targetのsourceにならない
- A / B / Cは1つの `same_skill_counter`（Skill 341）conflictを共有し、decisionは実conflict IDでAを優先する（ID hard-code無し）。
  Kernelのstable work orderでB、Cの順に評価される
- 確認済みの意味（Vitestで固定、`production-rng:c5-e7`）:

| `maxPlannerReruns` | B | C | `plannerRerunsUsed` |
| --- | --- | --- | --- |
| 1 | found（conversion@342、Reset@56） | `stopped_by_planner_rerun_bound`（search / trialなし） | 1 |
| 2以上 | found | found | 2 |

- sanity値: extent `BENCHMARK_ONLY_RERUN_PRESSURE_SANITY_EXTENT`（Normal 1 / Gogma 40 / Skill 1）、rerun sweep中に固定する
  trial上限 `BENCHMARK_ONLY_RERUN_PRESSURE_CANDIDATE_TRIALS = 8`。どちらもProduction defaultではない

### 5.5 Candidate trial boundについて確認できたこと（Phase 3-A）

現行Production semanticsでは、「Candidate 1がtrialでrejectされ、Candidate 2以降が同じ固定Route集合に対して
foundになる」実Browser benchmark workloadを確認できていない。そのためPhase 3-Bでは、`maxCandidateTrialsPerTarget`
について `stopped_by_candidate_trial_bound → found` というsemantic thresholdを実測から決定できない。
これは `maxCandidateTrialsPerTarget = 1` で十分であることの証明ではない。確認したのは、現在のProduction fixture /
semanticsでcandidate-dependentなreject → 後続foundを再現できなかった、という事実だけである。構造的に絶対不可能とは
断定しない。

reject経路ごとの調査結果:

- `conflicts_with_fixed_route`: 固定Routeのrequired位置はreservationでblockedになるため、Planner Alternative Searchが
  そこへown operationを置かない
- `not_selected`: 固定Routeのheld位置は待機可能で、schedulerはholding unitがreadyでない位置では待つ。試した
  timing由来stall fixture（固定Routeの上書きされるResetの位置を、巨戟化待ちの代替Routeが使う形）では、代替Routeが
  1 trialでfoundになった
- `reused_existing_entry`: invalidateされた現在Route Oは `excludedRouteKeys` に入るため、同じ意味の代替は届かない
- `preflight_refused`: Domain testでは強制mock（`forced.refusePreflights`）で作れるが、Candidate 1だけreject /
  Candidate 2 foundとなるProduction fixtureは今回確認できなかった

試作したmulti-trial fixtureはbenchmark workloadとして残していない（mock、fake Planner result、手書きRNG結果で
成立させることもしない）。全Candidateが一様にrejectされるworkloadは、trial単価は測れてもsemantic coverageの根拠に
ならないため、今回は追加していない。

## 6. Worker経路と計測境界

### 6.1 Search measurement

Worker内で `visitPlannerAlternativeCandidates()` を直接呼ぶ。

- anchor: 呼び出し直前の `performance.now()`。validation、Route base登録、stream solve、same-cost closureは全て内側
- `timeToFirstCandidateMs`: 最初のvisitor deliveryの時刻（same-cost closureと6キー順序の後）。composition発見時刻は使わない
- `settledWorkItemsAtFirstCandidate`: 最初のdelivery時点のsettled work数。`settledWorkItemsTotal`: run全体
- `predictionCountsAtFirstCandidate` / `predictionCounts`、Skill / Gogma depth集計、`firstCandidate`（Route summary）、
  Search summary、`stoppedByConsumer`
- `stopAfterCandidates`（必須、`null` = 最後まで）。`1` でtime-to-firstとsame-cost closureを測る
- `recording`: `timing`（visitorは数と時刻だけ）/ `parity`（全 `candidateStableKey` のdigestと先頭4件。性能証拠に混ぜない）
- `instrumented`: `false` はobserverもcounting Engineも付けないProductionと同じ呼び出し経路

### 6.2 Kernel measurement

Worker内で `runPlannerAlternativeKernel()` を直接呼ぶ（Production Planner Workerと同じ依存
`createProductionPlannerWorkerDependencies()`）。extent / trial bounds（`maxCandidateTrialsPerTarget` /
`maxPlannerReruns`）はrequest必須。結果は `plannerRerunsUsed`、Candidate trial数、Target毎のoutcome、trial結果、
Search summary、foundならRoute summary / `generatedSelected` / trial termination / trial Conflict数 / Plan Step数だけを
返す（ProductionPlanやCandidate配列は返さない）。

`timeToFirstTrialMs` は最初のCandidate trialのmaterialization（Production clockの最初の読み取り。Kernelは準備段階で
clockを読まず、materializationで1回、Plan生成で `productionPlanId()` 直前に1回読む）。clockとID factoryは包むだけで、
返す値はProductionのものである。

### 6.3 timing boundary / fresh Worker policy

- 記録measurementは **1 run = 1 fresh Browser Worker**（B5 / B8 / B9と同じ）。Worker constructorは計測外
- `roundTripMs`: main threadでrequestの `postMessage()` 直前からsettleまで。request structured clone、未完了のWorker
  module初期化、Worker計算、response structured cloneを含む
- `workerElapsedMs`: Worker内の計算本体。両者の差から推定CPU時間は作らない
- warm-up N回 → measurement N回を直列実行（page既定はwarm-up 1 / measurement 3）。recordは `phase` で区別し、
  `summarize()` の中央値はmeasurementだけから計算する（warm-up / probeを混ぜない）
- invalidなextent / bounds / stop値は、fixture構築とWorker作成より前にfail closedする。native Worker
  `error` / `messageerror` はpending runを全てerrorにし、そのharnessを再利用しない

### 6.4 cancel / ping

- protocol: `run`（`pa3_benchmark_search` / `pa3_benchmark_kernel`）、`cancel`、`cancel_ack`、`ping`、`pong`、
  `accepted`、`first_candidate`、`search_result` / `kernel_result`、`cancelled`、`error`
- cancelはProduction互換の `shouldCancel` / `yieldControl`。yieldはB8-B2のMessageChannel macrotask
  （`benchmarkWorkerYield`）を再利用する。microtaskは使わず、`setTimeout(0)` を主要yieldとして新規採用しない
- `cancelAfterMs`、`cancelOnFirstCandidate`（Search: 最初のdelivery通知で即cancel、Kernel: 最初のCandidate trial
  開始通知で即cancel）。通知はrequestが求めた時だけ送り、Production semanticsを変えない
- cancel観測: run開始→cancel post（`requestedAtMs`）、cancel post→`cancel_ack`（`ackMs`）、cancel post→settle（`settledMs`）
- `pingIntervalMs` でrun中にpingを連続送信し、pong件数と最大latencyをrecordに残す。fresh Workerへ最初に届くbenchmark
  messageは必ずrun request（`pa3_benchmark_search` / `pa3_benchmark_kernel`）で、ping loopはrun requestのpost直後
  （`accepted` は待たない）に始まる。run settle後にping loopを止めてharnessをdisposeし、未応答のpingは `null` で解決する

## 7. benchmark-only measurement grid

いずれも **Production defaultではない**（`BENCHMARK_ONLY_*`）。

| 項目 | grid |
| --- | --- |
| Normal extent | 1 / 4 / 16 / 40 / 80 |
| Gogma extent | 30 / 60 / 120 / 180 / 220 / **235** / 240 / 300 / 350（235はIssue #101 Fire代替の到達閾値。落とさない） |
| Skill extent | 1 / 2 / 4 / 8 / 16 / 32 / 64 |
| Candidate trials | 1 / 2 / 3 / 4 / 8（semantic thresholdはPhase 3-Bの実測対象外。5.5） |
| Planner reruns | 1 / 2 / 3 / 4 / 8 / 16 |
| held length | 1 / 8 / 32 / 128 / 512 |

sanity値としてPhase 2 acceptanceのextent `1 / 240 / 1` とtrial bounds `3 / 3`
（`BENCHMARK_ONLY_ISSUE_101_SANITY_*`）、rerun-pressureのextent `1 / 40 / 1` とtrial上限 `8`
（`BENCHMARK_ONLY_RERUN_PRESSURE_*`）を置く。これらも既定値ではない。Phase 3-Aでは「512が適切な上限」等の結論を
出さない。long-held scaling seriesでは held length grid と固定anchor・`BENCHMARK_ONLY_LONG_HELD_FIXED_EXTENT`
（Normal 1 / Gogma 513 / Skill 513）を1組として使う。`held` modeで長いheld runを最後まで（`stopAfterCandidates = null`）
走らせるとdepth毎にstateが増えるため、重すぎる場合は `stopAfterCandidates` で打ち切るか、series全体で同じ
（より小さい）extentとanchorに揃える。held長ごとにextentを変えない。

## 8. Phase 3-B手順

Node / jsdom / Vitestの時間はauthorityにしない。real Browser Workerの記録だけを使う。
Phase 3-Bの実施記録（実際の環境、手順からの逸脱、結果）は12章にある。

1. production benchmark build: `npx vite build --config vite.benchmark.config.ts`
2. preview: `npx vite preview --config vite.benchmark.config.ts`
3. `benchmark.html` を開く（`/GogmaArtianPlanner/benchmark.html`）
4. 「Planner Alternative Phase 3」タブを選ぶ（consoleに `plannerAlternativeBenchmark` が登録される）
5. sanity runs: Issue #101 Search（sanity extent、`stopAfterCandidates: 1`）とKernel（sanity bounds）でPhase 2の
   regression値（5.1）を確認する
6. Issue #101 extent sweep: Gogma gridを中心に、Normal / Skill gridを組み合わせる（Search、`stopAfterCandidates: 1`）
7. no-Ideal extent sweep: `issue101_no_ideal`（必要なら `_dragon_fixed`）を `stopAfterCandidates: null` で
8. long-held scaling sweep: `long_skill_held` / `long_gogma_held` × `held` / `held_blocked` × held length grid。
   extentは全held長で `longHeld.fixedExtent`、Target / Idealは固定（5.3）
9. Candidate trial: Issue #101等の実Production Kernel workload（`issue101_prefer_dragon_normal`）で、1 trialあたりの実コスト
   （`workerElapsedMs` / `roundTripMs` / `timeToFirstTrialMs` / prediction数）を測る。現行semanticsではlater-Candidate
   recoveryのProduction workloadを確認できていないため（5.5）、Tのsemantic thresholdはPhase 3-Bの実測対象外とする
10. rerun bound sweep: `kernel_multi_target`。`maxCandidateTrialsPerTarget` は各Targetの評価を妨げない十分な
    benchmark-only値（`sanity.rerunPressureCandidateTrials` = 8）で固定し、`maxPlannerReruns` を 1 / 2 / 3 / 4 / 8 / 16 で
    sweepする。観測: `stopped_by_planner_rerun_bound` の有無、`plannerRerunsUsed`、各Target outcome、`workerElapsedMs`、
    `roundTripMs`。`stopped_by_planner_rerun_bound → 全対象評価可能` の境界を見る
11. cancel / responsiveness: `cancelOnFirstCandidate`、`cancelAfterMs`、`pingIntervalMs`
12. finalist tuples: 候補extent × rerun boundをwarm-up 1 / measurement 3以上で再計測
13. raw JSON export: `plannerAlternativeBenchmark.exportJson()` またはpageの「JSON保存」

console例:

```js
const pa = plannerAlternativeBenchmark
await pa.runMeasurements({
  mode: 'search', workload: 'issue101_fire_dragon_fixed',
  extent: { maxNormalAdvance: 1, maxGogmaAdvance: 235, maxSkillAdvance: 1 },
  stopAfterCandidates: 1, warmUp: 1, measurements: 3,
})
await pa.runMeasurements({
  mode: 'kernel', workload: 'issue101_prefer_dragon_normal',
  extent: pa.sanity.issue101Extent, bounds: { maxCandidateTrialsPerTarget: 3, maxPlannerReruns: 3 },
  warmUp: 1, measurements: 3,
})
await pa.runMeasurements({
  mode: 'kernel', workload: 'kernel_multi_target',
  extent: pa.sanity.rerunPressureExtent,
  bounds: { maxCandidateTrialsPerTarget: pa.sanity.rerunPressureCandidateTrials, maxPlannerReruns: 1 },
  warmUp: 1, measurements: 3,
})
await pa.run({
  mode: 'search', workload: 'long_gogma_held', longHeld: { heldLength: 128, heldMode: 'held' },
  extent: pa.longHeld.fixedExtent, stopAfterCandidates: null,
  cancelOnFirstCandidate: false, pingIntervalMs: 0,
})
pa.summarize()
copy(pa.exportJson())
```

## 9. raw resultの保存

`exportJson()` は `{ protocolVersion, exportedAt, environment, records }` を返す。`environment` はuser agent、
`hardwareConcurrency`、visibility、`PRODUCTION_RNG_ENGINE_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、
protocol version。Phase 3-Bでは生JSONを作業記録として保存し、この文書へは集計表と測定条件だけを転記する。
中央値はmeasurement recordだけから計算する。

## 10. Phase 3-Cの選定原則（数値は未決）

extent:

- reachable fixtureで必要なCandidateを取り逃さない最小側を優先する
- extent拡大後にsemantic改善（found / 到達Route）が無い範囲を確認する
- no-Ideal worst caseのcostも考慮する
- Issue #101（Gogma到達235）を必ずcoverageする

candidate trials:

- 現行semanticsではlater-Candidate recoveryのProduction workloadを確認できていないため（5.5）、実測から
  semantic thresholdは決めない
- Production defaultはPhase 3-Cで、現行Kernel semantics、安全弁としての役割、Phase 3-Bで測る1 trialあたりの実コストを
  合わせて設計判断する（Phase 3-A / 3-Bでは値を決めない）

planner reruns:

- `kernel_multi_target` のように複数Targetが1つのglobal rerun budgetを共有する実ケースで、代表workloadの必要trialが
  budget不足で評価されない状態を避ける
- runtime-unsupported retryも1 runとして数える既存契約（9.2.19.12）を維持する

Issue #101（`issue101_prefer_dragon_normal`）はreal fixture sanity、found path、1 trialの実コスト、Issue #101 regressionの
authorityであり、trial defaultとrerun defaultをこの1ケースだけで決めない（1 trial / 1 rerunで完了するため）。

性能とcoverageのtrade-offは実測後に判断する。

## 11. 変更していないもの

Production default、Phase 4（B9 what-if新kernel接続、Worker production protocol、`PlannerWorkerClient` API、
`scenarioOperationCount`、`PlannerAlternativeRouteSummary`）、actual repair、`conflictRepairLineage`、Persistence、
migration、Production UI、#122 Presentation、legacy B8を変更していない。
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 15`、`DATABASE_SCHEMA_VERSION = 9`、`ExportRoot.schemaVersion = 12`、
`AppSettings.schemaVersion = 2`、`RngState.schemaVersion = 2`、`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7`、
Master `dataVersion = 4` は不変である。

Phase 3-B（12章）は計測だけを行い、harness、fixture、Production code、semantics、versionを一切変更していない。

## 12. Phase 3-B実測結果（real Browser Worker）

この章の数値はすべてreal Browser（Chrome）のreal Browser Workerで取ったものである。表の時間は特記が無い限り
**measurement recordだけの中央値**（warm-up、probe、cancel runは混ぜない）で、単位はms。Production defaultは
この章では決めない（12.15はPhase 3-Cへ渡す材料の整理であり、採用値ではない）。

### 12.1 実施環境

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-09-26（JST 15:47〜16:13） |
| build commit | `527d2affcf41b4409705273ff02d818dcfc43dde`（main、Phase 3-A #144） |
| build / preview | `npx vite build --config vite.benchmark.config.ts` → `npx vite preview --config vite.benchmark.config.ts --host 127.0.0.1 --port 4173 --strictPort` |
| URL | `http://127.0.0.1:4173/GogmaArtianPlanner/benchmark.html`（「Planner Alternative Phase 3」タブ） |
| Browser | Google Chrome 153.0.8010.49（desktop、一時プロファイル、`--remote-debugging-port` 以外の実行フラグなし） |
| userAgent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36` |
| OS | Windows 11 Pro 10.0.26200 |
| CPU / memory | AMD Ryzen 7 9700X 8-Core（16 logical）/ 32 GB |
| `navigator.hardwareConcurrency` | 16 |
| `document.visibilityState` | 全355 recordで `visible`（visibility変化なし。page側のvisibilitychange logも開始時の1件のみ） |
| Production RNG | `production-rng:c5-e7` |
| Calculation schema | `CURRENT_CALCULATION_APP_SCHEMA_VERSION = 15` |
| benchmark protocol | `planner-alternative-phase3-a` |
| 背景負荷 | 計測前に動いていた動画エンコード（x265、約7.5 core）はプロジェクトオーナーが停止した。計測中の `Win32_Processor.LoadPercentage` は中央値27% / p90 53%（Claude desktop、GPU process等）。補正はしていない |

- page操作はconsole APIだけをCDP `Runtime.evaluate` 経由で呼んだ（Debugger / Profilerは使っていない）。driverは
  `runMeasurements()` / `run()` を直列に呼び、step毎に `exportJson()` をローカルへ保存しただけで、recordを作り変えていない
- 全recordは `instrumented: true`（observerとcounting Engineあり。observer時間は補正しない）
- main thread heartbeat（100 ms tick）の最大gapは1.35 s / 1.39 sで、いずれもIssue #101 real fixtureの初回構築
  （計測外、Worker作成前）の時刻だった。run中のmain thread停止は観測していない

#### 手順からの逸脱（Browser pane → Chrome）

最初はClaude desktop内蔵のBrowser pane（Chromium 152.0.7977.130）で開始した。Stage 0 sanityは期待値どおりだったが、
Issue #101 extent `40 / 235 / 1` でpageが応答しなくなる現象が2回続き（12.3）、pane側では原因を観測できなかったため、
Chrome 153へ切り替えて **Stage 0から全て測り直した**。pane sessionのStage 0 record（8件）はraw artifactの
`supplementary.paneSession` に別枠で残し、本章の集計へは混ぜていない。

Chromeではrenderer crash（V8 OOM）が起き得る条件があり（12.3）、crash後はpageを再読み込みして次のsessionで
続けた。session `chrome-main-1`（237 record）と `chrome-main-2`（118 record）の2 sessionで、同じ条件を跨いだ比較でも
semantic結果は1通りだった。

### 12.2 raw evidence

| 項目 | 値 |
| --- | --- |
| file | `PLANNER_ALTERNATIVE_PHASE3B_BROWSER_RAW_RESULTS.json`（repository root、`.gitignore` の `*_BROWSER_RAW_RESULTS.json` でcommit対象外） |
| size | 18,567,632 bytes |
| SHA256 | `1C564AAE36620C0E83A98B95A3178A031387179AE767DC7477A115121EF3AF76` |
| record数 | 355（measurement 251 / warm-up 79 / probe 25） |

構成: `records` は2 sessionのharness recordを無加工で連結したもの（`sequence` はsession毎に1から、`id` は一意）。
`sessions[]` はsession毎のenvironment、`recordIds`、step log（`jobLog`）、visibility log、main thread heartbeat、
`crashes[]` はcrash / 応答停止の記録、`osMemorySamples` はChrome instanceの最大private memoryとCPU負荷のOS側
sample（約1.7 s間隔）、`supplementary.paneSession` は破棄したpane sessionのrecordである。

semantic決定性: cancel run以外の全68条件で、同一条件のrecord（warm-up、measurement、probe、session跨ぎを含む）の
semantic結果（delivered数、first Candidate、Search summary、settled work、prediction数、stream state数、Kernel
結果）は1通りだった。12章の条件でextentやTarget / anchorがheld長によって変わったrecordは無い（long-heldは全record
`1 / 513 / 513`）。

### 12.3 crash / 応答停止（not completed within observation window）

| Browser | 条件 | 観測 |
| --- | --- | --- |
| Browser pane | Search `issue101_fire_dragon_fixed` extent `40 / 235 / 1`、stop 1 | page応答停止（JS評価・screenshotとも応答なし、3分以上回復せず）。そのsessionの未保存recordは失われた |
| Browser pane | 同条件のprobe（ping 250 ms） | 10〜25 s以内に再び応答停止 |
| Chrome | 同条件のprobe（ping 250 ms） | renderer crash。crash dumpにV8 OOM（heap約4,049 MBでScavengeのallocation failure、約18.5 s） |
| Chrome | 同条件のprobe、`instrumented: false` | renderer private memoryが1,722 MB → 4,338 MB（約10 s、約350 MB/s）でcrash（V8 OOM） |
| Chrome | Search `long_gogma_held` `held` heldLength 1、extent `1 / 513 / 513`、stop `null` | renderer crash（V8 OOM、heap約3,951 MB、約16.3 s、private memory 4,361 MB） |

- `instrumented: false` でも同じOOMになるため、observer / counting Engineではなく、Planner Alternative Search本体の
  state保持量がWorker heap上限（約4 GB）を超えたと判断した。Phase 3-Bの停止条件としたharness不具合（同じ入力での
  semantic揺れ、record欠落、warm-up混入、fresh Worker違反、fixture構築の計測混入、run前のping、held長によるTarget /
  extent変化、Worker summaryとDomain結果の不一致）はどれも観測していない
- 外挿はしない。Issue #101 Normal `40` と、`long_gogma_held` `held` stop `null` heldLength 1は
  **not completed within observation window（Browser crash）** とする。それより大きい条件（Normal `80`、heldLength
  8 / 32 / 128 / 512のstop `null`）は実行していない

### 12.4 Stage 0: sanity（Phase 2 regression）

| workload | extent / bounds | 結果 | worker | round trip | first |
| --- | --- | --- | ---: | ---: | ---: |
| `issue101_fire_dragon_fixed` | 1 / 240 / 1、stop 1 | Candidateあり。Normal 0 / count 1、Skill 342で巨戟化、Gogma 56..289 Reset 234回、operation 236、estimated Gogma 235 / Skill 2 / Normal 1 | 1012.2 | 1023.2 | 1012.1 |
| `issue101_prefer_dragon_normal` | 1 / 240 / 1、T3 / R3 | Fire `found`、Candidate trial 1、`plannerRerunsUsed` 1、trial Plan 444 Steps（termination `completed`、trial Conflict 0） | 1362.4 | 1375.5 | 1011.5 |

5.1のregression値と一致した（pane sessionでも同じ値）。

### 12.5 Issue #101 Gogma extent sweep（Normal 1 / Skill 1、stop 1）

| Gogma | Candidate | 終了 | worker | round trip | first | settled work（first / total） | prediction（Normal / Skill / Reset / Keep） | Gogma states（generated / frontier）、最大family layout |
| ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 30 | なし | extent | 21.3 | 33.0 | — | — / 30 | 1 / 1 / 29 / 435 | 464 / 464、30 |
| 60 | なし | extent | 60.3 | 72.1 | — | — / 60 | 1 / 1 / 59 / 1,706 | 1,765 / 1,762、57 |
| 120 | なし | extent | 222.6 | 234.0 | — | — / 120 | 1 / 1 / 119 / 6,723 | 6,842 / 6,831、109 |
| 180 | なし | extent | 516.4 | 529.4 | — | — / 180 | 1 / 1 / 179 / 14,756 | 14,935 / 14,914、159 |
| 220 | なし | extent | 848.8 | 862.3 | — | — / 220 | 1 / 1 / 219 / 21,739 | 21,958 / 21,926、188 |
| **235** | **あり** | consumer | 1009.0 | 1023.3 | 1008.9 | 236 / 236 | 1 / 1 / 234 / 24,651 | 24,885 / 24,851、201 |
| 240 | あり | consumer | 1042.2 | 1054.9 | 1042.2 | 236 / 236 | 1 / 1 / 234 / 24,651 | 同上 |
| 300 | あり | consumer | 1001.4 | 1016.6 | 1001.2 | 236 / 236 | 1 / 1 / 234 / 24,651 | 同上 |
| 350 | あり | consumer | 1010.8 | 1025.2 | 1010.8 | 236 / 236 | 1 / 1 / 234 / 24,651 | 同上 |

finalist再計測（session 2、warm-up 1 / measurement 5）:

| Gogma | Candidate | worker | round trip | first |
| ---: | --- | ---: | ---: | ---: |
| 220 | なし（extent） | 855.8 | 874.1 | — |
| 235 | あり | 1001.2 | 1023.0 | 1001.1 |
| 240 | あり | 1006.4 | 1024.7 | 1006.4 |

- 閾値: 220ではCandidateが出ず（`stoppedByExtent`）、235以上では全て同じFire代替（Gogma 56..289）が最初のCandidate。
  Gogma windowは `origin 55 .. 55 + maxGogmaAdvance - 1` なので、289へ届く最小値は235である。221〜234は測っていない
- 235を超えるextentはsettled work、prediction数、state数、time-to-firstを変えなかった（cost層単位のlazy性とsame-cost
  closureで、最初のCandidateのcost層より先をsettleしない）。extent拡大による追加semantic benefitは、stop 1では観測されない
- 閾値までのcostはGogma位置に対して超線形（Keep prediction数がほぼ位置数の2乗で増える）

### 12.6 Issue #101 Normal extent sensitivity（Gogma 235 / Skill 1、stop 1）

| Normal | Candidate | worker | round trip | first | settled work | prediction（Normal / Skill / Reset / Keep） | Gogma streams / generated states、最大family layout | 最大renderer private memory（OS観測、参考） |
| ---: | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 12.5と同じFire代替 | 1015.9 | 1030.4 | 1015.8 | 236 | 1 / 1 / 234 / 24,651 | 1 / 24,885、201 | 約0.5 GB |
| 4 | 同じFire代替 | 2836.1 | 2851.3 | 2836.1 | 944 | 4 / 1 / 234 / 25,266 | 4 / 99,453、803 | 約1.2 GB |
| 16 | 同じFire代替 | 11068.2 | 11090.1 | 11068.1 | 3,776 | 16 / 1 / 234 / 27,739 | 16 / 397,738、3,210 | 約3.95〜4.0 GB |
| 40 | — | — | — | — | — | — | — | **Browser crash（V8 OOM、12.3）** |
| 80 | — | — | — | — | — | — | — | 未実行（40でcrash） |

- Normal extentは最初のCandidateの意味を変えなかった（全てNormal 0 / count 1、Gogma 56..289）
- same-cost closureが同じcost層のNormal base全てを閉じるため、settled workとGogma stateはNormal数にほぼ比例
  （base 1本あたりsettled work 236、Gogma state約24.9k）し、time-to-firstも比例して伸びた（約0.6〜0.7 s / base）
- Normal 16で既にrenderer memoryが約4 GBに達しており（`osMemorySamples`、harness値ではないOS側の参考値）、40でOOMになった

### 12.7 Issue #101 Skill extent sensitivity（Normal 1 / Gogma 235、stop 1）

| Skill | worker | round trip | first | 結果 |
| ---: | ---: | ---: | ---: | --- |
| 1 | 1005.4 | 1019.7 | 1005.3 | 同じFire代替、settled work 236、prediction 1 / 1 / 234 / 24,651 |
| 2 | 998.9 | 1013.8 | 998.8 | 同上 |
| 4 | 991.4 | 1007.7 | 991.3 | 同上 |
| 8 | 1005.9 | 1021.5 | 1005.8 | 同上 |
| 16 | 1007.8 | 1022.4 | 1007.7 | 同上 |
| 32 | 990.8 | 1006.9 | 990.6 | 同上 |
| 64 | 1000.7 | 1016.5 | 1000.6 | 同上 |

Skill extentはこのworkloadのsemanticsもcostも変えなかった（held-aware Skill streamのdepth集計は0 stream。
Skill 341はheld + blocked、conversionはSkill 342、Reset Skillsは不要）。

### 12.8 no-Ideal worst case（stop `null`、Candidateは0件で全てextent終端）

`issue101_no_ideal`（空reservation）:

| extent（N / G / S） | worker | round trip | settled work | prediction（Normal / Skill / Reset / Keep） | Gogma streams / generated states |
| --- | ---: | ---: | ---: | --- | --- |
| 1 / 30 / 1 | 29.8 | 63.5 | 31 | 1 / 1 / 30 / 465 | 1 / 495 |
| 1 / 60 / 1 | 62.0 | 82.1 | 61 | 1 / 1 / 60 / 1,766 | 1 / 1,826 |
| 1 / 120 / 1 | 215.7 | 236.0 | 121 | 1 / 1 / 120 / 6,843 | 1 / 6,963 |
| 1 / 180 / 1 | 527.5 | 548.1 | 181 | 1 / 1 / 180 / 14,936 | 1 / 15,116 |
| 1 / 235 / 1 | 1014.9 | 1038.4 | 236 | 1 / 1 / 235 / 24,886 | 1 / 25,121 |
| 4 / 30 / 1 | 49.3 | 75.9 | 124 | 4 / 1 / 30 / 555 | 4 / 1,980 |
| 16 / 30 / 1 | 120.8 | 143.6 | 496 | 16 / 1 / 30 / 915 | 16 / 7,920 |
| 40 / 30 / 1 | 263.5 | 285.7 | 1,240 | 40 / 1 / 30 / 1,634 | 40 / 19,799 |
| 80 / 30 / 1 | 484.7 | 510.1 | 2,450 | 80 / 1 / 30 / 2,748 | 79 / 39,048 |
| 1 / 30 / 2〜64 | 22.1〜22.6 | 42.9〜46.9 | 31 | 1 / 1 / 30 / 465 | 1 / 495 |

（`1 / 30 / 1` はGogma ladderの系列を載せた。Skill系列の先頭 `1 / 30 / 1` は23.7 / 48.9、Normal系列の先頭は21.7 / 44.9）

`issue101_no_ideal_dragon_fixed`（Dragon reservation）:

| extent | worker | round trip | settled work | prediction | Gogma generated states |
| --- | ---: | ---: | ---: | --- | ---: |
| 1 / 120 / 1 | 209.7 | 236.0 | 120 | 1 / 1 / 119 / 6,723 | 6,842 |
| 1 / 235 / 1 | 1000.1 | 1026.2 | 235 | 1 / 1 / 234 / 24,651 | 24,885 |

- 空reservationと比べ、Dragon reservationはGogma 55（held + blocked）の1位置を除くだけで、costはほぼ同じ
- Gogma方向のworst caseはIssue #101と同じ形（235で約1 s）。Gogma 30ではNormal 80でも0.5 s程度で、Normal方向のcostは
  Gogma extentが小さければ線形・小さい。Skill extentはこのworkloadでも無影響
- この範囲で未完走条件は無い

### 12.9 long Skill held scaling（`long_skill_held`、extent `1 / 513 / 513`、stop `null`）

| heldMode | heldLength | worker | round trip | first | delivered | settled work（first / total） | predictSkills | Skill states / transitions / 最大depth | 1 depthあたり最大states |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | ---: |
| held_blocked | 1 | 42.0 | 53.5 | 12.3 | 3 | 138 / 518 | 512 | 512 / 512 / 512 | 1 |
| held_blocked | 8 | 40.8 | 52.1 | 12.3 | 3 | 131 / 511 | 505 | 505 / 505 / 505 | 1 |
| held_blocked | 32 | 39.9 | 51.0 | 10.4 | 3 | 107 / 487 | 481 | 481 / 481 / 481 | 1 |
| held_blocked | 128 | 35.9 | 47.1 | 5.4 | 3 | 11 / 391 | 385 | 385 / 385 / 385 | 1 |
| held_blocked | 512 | 4.6 | 15.6 | 4.5 | 1 | 3 / 3 | 1 | 1 / 1 / 1 | 1 |
| held | 1 | 46.4 | 58.5 | 13.7 | 6 | 138 / 525 | 513 | 1,025 / 1,025 / 513 | 2 |
| held | 8 | 88.2 | 100.6 | 18.8 | 27 | 131 / 567 | 513 | 4,581 / 4,665 / 513 | 9 |
| held | 32 | 219.9 | 232.6 | 24.3 | 99 | 107 / 711 | 513 | 16,401 / 21,857 / 513 | 33 |
| held | 128 | 568.2 | 581.9 | 15.4 | 387 | 11 / 1,227 | 513 | 57,921 / 407,425 / 513 | 129 |
| held | 512 | 1085.4 | 1107.0 | 60.5 | 856 | 5 / 1,882 | 513 | 131,841 / 22,501,377 / 513 | 513 |

- `held_blocked` はheld位置を全てskipするので、held長が伸びるほど探索位置が減りcostは下がる（Issue #101の形）
- `held` は1 depthのstate数がheldLength + 1まで増え、states・transitions（heldLength 512で2,250万）・delivered数・
  costが増える。prediction数（`predictSkills` 513）はheld長に依存しない（Skill streamは位置毎に1回のprediction）
- time-to-firstは全条件で61 ms以下。512の `held` でも完走した（約1.1 s、OS観測のprivate memory約1.8 GB）
- first Candidateは `held_blocked` 512以外の全条件で、anchor（Skill 853）より前に同じIdeal Skillが出る位置
  （estimated Skill advance 137）へ届き、held長が伸びるほどown operation数が減る（136 → 9、`held` 512では1）。
  `held_blocked` 512ではheld run外の最初の位置であるanchorだけが届く（5.3の注意どおり、held長でown operation数は変わる）

### 12.10 long Gogma held scaling（`long_gogma_held`、extent `1 / 513 / 513`）

stop `null`（正式比較条件）:

| heldMode | heldLength | worker | round trip | first | delivered | settled work（first / total） | Reset / Keep prediction | Gogma generated / frontier states、最大depth、最大family layout |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| held_blocked | 1 | 8403.6 | 8419.7 | 9.8 | 257 | 12 / 769 | 512 / 105,398 | 105,910 / 105,773、512、376 |
| held_blocked | 8 | 8236.2 | 8256.6 | 9.6 | 240 | 12 / 745 | 505 / 102,501 | 103,006 / 102,872、505、372 |
| held_blocked | 32 | 7025.0 | 7039.9 | 23.3 | 208 | 30 / 689 | 481 / 94,801 | 95,282 / 95,165、481、365 |
| held_blocked | 128 | 4478.3 | 4500.2 | 15.6 | 155 | 19 / 540 | 385 / 63,494 | 63,879 / 63,803、385、310 |
| held_blocked | 512 | 5.2 | 22.7 | 5.2 | 1 | 2 / 2 | 1 / 1 | 2 / 2、1、2 |
| held | 1 | — | — | — | — | — | — | **Browser crash（V8 OOM、12.3）** |
| held | 8 / 32 / 128 / 512 | — | — | — | — | — | — | 未実行（1で既にcrash） |

`held_blocked` 1〜8のrunはOS観測のprivate memoryが約2.7 GBに達した。

補助系列 stop `1`（time-to-first。extent・Target・anchorは正式条件と同じ）:

| heldMode | heldLength | worker = first | round trip | settled work | Reset / Keep prediction | generated / frontier states、最大depth、最大family layout | first Candidate |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| held_blocked | 1 | 12.3 | 34.7 | 12 | 11 / 66 | 77 / 77、11、12 | mixed 11 ops（Gogma 56..66） |
| held_blocked | 8 | 9.2 | 24.7 | 12 | 11 / 66 | 77 / 77、11、12 | mixed 11 ops（63..73） |
| held_blocked | 32 | 22.7 | 36.8 | 30 | 29 / 421 | 450 / 449、29、29 | mixed 29 ops（87..115） |
| held_blocked | 128 | 16.0 | 31.0 | 19 | 18 / 171 | 189 / 189、18、19 | mixed 18 ops（183..200） |
| held_blocked | 512 | 5.2 | 18.6 | 2 | 1 / 1 | 2 / 2、1、2 | Reset 1 op（567 = anchor） |
| held | 1 | 11.1 | 25.5 | 12 | 12 / 77 | 154 / 154、11、13 | mixed 11 ops（56..66） |
| held | 8 | 15.9 | 32.1 | 6 | 13 / 83 | 558 / 292、5、14 | mixed 5 ops（61..66） |
| held | 32 | 31.2 | 47.8 | 6 | 34 / 562 | 1,157 / 659、2、34 | mixed 2 ops（61..66） |
| held | 128 | 286.3 | 303.5 | 27 | 130 / 7,871 | 16,901 / 8,245、2、119 | mixed 2 ops（61..66） |
| held | 512 | 63.2 | 80.6 | 3 | 513 / 513 | 1,026 / 1,026、1、377 | Reset 1 op（541） |

（stop 1のworkerはtime-to-firstとほぼ同じ値なので1列にまとめた）

- Gogmaの `held_blocked` はheld長が伸びるほどcostが下がる（free位置が減る）。ただしheld長が短いと、stop `null` で
  extent終端（513位置）まで走るcostは約8.4 sで、Keep prediction約10.5万、Gogma state約10.6万になる
- `held` はheld位置でもown operationが可能なため、同じextentを終端まで走るとheldLength 1でもWorker heap上限を超えた。
  最初のCandidateまで（stop 1）なら最大でも約0.3 s（heldLength 128）。`held` のgenerated statesはheld長とともに増え
  （1: 154 → 128: 16,901、1 depthで最大16,643）、generatedとfrontierの差（位置 × family layoutでの縮約）も広がる。
  512では最初のCandidateがheld run内のReset 1回（Gogma 541）で届くため、stateは1,026に下がる

### 12.11 Stage 4: Candidate 1 trialの実コスト（`issue101_prefer_dragon_normal`、extent `1 / 240 / 1`）

| bounds | runs | 結果 | worker | round trip | timeToFirstTrial | prediction（Normal / Skill / Reset / Keep） |
| --- | --- | --- | ---: | ---: | ---: | --- |
| T1 / R1 | warm-up 1 + measurement 5 | Fire `found`、trial 1、`plannerRerunsUsed` 1、Plan 444 Steps | 1370.9 | 1388.0 | 1007.4 | 214 / 3 / 468 / 24,652 |
| T3 / R3 | warm-up 1 + measurement 3 | 同上 | 1362.4 | 1375.5 | 1011.5 | 同上 |
| T8 / R8 | warm-up 1 + measurement 3 | 同上 | 1373.2 | 1393.8 | 1013.1 | 同上 |

- Kernel全体のうち約1.0 sがSearch（最初のCandidateのmaterializationまで）、残り約0.36 sが1回のtrial（full Planner run
  + Trace Replay）である。Normal prediction 214回のうちSearch側は1回で、残りはfull Planner run / Trace Replay側
- T / Rを8へ上げても最初のCandidateでfoundになるため、結果もcostも変わらない
- `maxCandidateTrialsPerTarget` のsemantic threshold（`stopped_by_candidate_trial_bound → found`）は、5.5のとおり
  このworkloadでは観測できない。**T = 1で十分であることは示していない**

### 12.12 Stage 5: Planner rerun sweep（`kernel_multi_target`、extent `1 / 40 / 1`、T = 8）

| `maxPlannerReruns` | Target B | Target C | trials | `plannerRerunsUsed` | worker | round trip | timeToFirstTrial | prediction（N / S / R / K） |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | found（4 Steps） | `stopped_by_planner_rerun_bound`（search / trialなし） | 1 | 1 | 27.6 | 44.3 | 11.9 | 0 / 3 / 3 / 2 |
| 2 | found | found | 2 | 2 | 43.8 | 65.9 | 12.7 | 0 / 6 / 6 / 4 |
| 3 | found | found | 2 | 2 | 40.8 | 57.5 | 11.4 | 0 / 6 / 6 / 4 |
| 4 | found | found | 2 | 2 | 40.4 | 56.9 | 11.9 | 0 / 6 / 6 / 4 |
| 8 | found | found | 2 | 2 | 40.4 | 58.2 | 11.8 | 0 / 6 / 6 / 4 |
| 16 | found | found | 2 | 2 | 40.1 | 57.9 | 11.3 | 0 / 6 / 6 / 4 |

finalist再計測（warm-up 1 / measurement 5）:

| `maxPlannerReruns` | 結果 | worker | round trip | timeToFirstTrial |
| ---: | --- | ---: | ---: | ---: |
| 2 | B / C found、reruns 2 | 39.4 | 57.5 | 11.7 |
| 4 | 同上 | 39.8 | 57.8 | 11.4 |
| 8 | 同上 | 40.8 | 58.9 | 11.6 |

- 5.4のsemantic（R = 1でCは `stopped_by_planner_rerun_bound`、R ≥ 2で全Target評価、reruns 2）がBrowserでも成立した
- R ≥ 2ではfixtureが必要とする2回で止まるため、R = 2 / 4 / 8 / 16のcostに差は無い（上限は使われない分だけ無料）
- found時のtrialはどちらも `trialConflictCount` 3（Aとの `same_skill_counter` 等がPlan上に残る）

### 12.13 Stage 6: cancel / responsiveness（probe、中央値に混ぜない）

`pingIntervalMs = 50`。`requestedAtMs` はrun開始からcancel postまで、`ack` / `settled` はcancel postからの時間で、
harnessの実測値そのものである（補正なし）。

| 条件 | 回数 | 実際のcancel post（requestedAtMs） | ack | settle | pong数 | 最大ping latency | 結果 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| Search Issue #101 1 / 240 / 1、`cancelOnFirstCandidate` | 3 | 1016〜1071 | なし | 0.2〜0.3 | 17〜18 | 23.7〜38.6 | 3回とも `search_completed`（stop 1で先に正常終了し、cancelは終了直後に届いた） |
| Kernel Issue #101 T3 / R3、`cancelOnFirstCandidate` | 3 | 1013〜1028（最初のtrial開始通知時） | 208.8〜224.3 | 209.7〜224.6 | 17〜18 | 173.6〜224.2 | 3回とも `cancelled`（trial = full Planner run中のcancel） |
| Search Issue #101 4 / 235 / 1、`cancelAfterMs 100` | 3 | 101.6〜115.6 | 0.3〜0.6 | 0.5〜0.8 | 2 | 26.9〜31.6 | `cancelled`（stream solve中） |
| 同、`cancelAfterMs 250` | 3 | 251.4〜256.2 | 0.1〜0.9 | 0.4〜1.2 | 4 | 23.8〜32.3 | `cancelled` |
| Search Issue #101 16 / 235 / 1、`cancelAfterMs 250` | 3 | 252.0〜264.5 | 0.4〜0.5 | 0.6 | 4〜5 | 26.8〜35.5 | `cancelled` |
| Kernel Issue #101 T3 / R3、`cancelAfterMs 100` | 3 | 101.0〜113.0 | 0.6〜1.1 | 0.9〜1.5 | 2 | 35.0〜36.2 | `cancelled`（Search中） |
| ping only: Search 4 / 235 / 1（cancelなし） | 3 | — | — | — | 45〜46 | 26.4〜30.6 | 完走（worker 2710〜2780） |
| ping only: Search 16 / 235 / 1（cancelなし） | 1 | — | — | — | 176 | 372.4 | 完走（worker 11,297.5） |

- Search中のcancelは1.5 ms以内にack / settleした。cancel postはmain-thread timerにより指定より最大15.6 ms遅れた
  （実測値をそのまま記録）
- Kernelのtrial（full Planner run）中はcancelの反映が約210〜225 ms遅れ、pingも最大約224 ms待たされた。Search中より
  yield間隔が長い区間がある
- Normal 16のSearchは完走までにping最大372 msの区間があった（memoryが約4 GBに達するrun。原因は切り分けていない）

### 12.14 未測定・未完走の条件

| 条件 | 状態 |
| --- | --- |
| Issue #101 Search Normal 40（Gogma 235 / Skill 1） | Chromeで2回Browser crash（V8 OOM、instrumentedあり / なし）。Browser paneでは2回page応答停止（原因は未観測） |
| Issue #101 Search Normal 80 | 未実行（40でcrash） |
| `long_gogma_held` `held` stop `null` heldLength 1 | Browser crash（V8 OOM） |
| `long_gogma_held` `held` stop `null` heldLength 8 / 32 / 128 / 512 | 未実行（1でcrash）。stop 1の補助系列だけ実測 |
| Issue #101 Gogma 221〜234 | gridに無いため未測定（閾値235は12.5のwindow計算とgrid両側の結果による） |
| `maxCandidateTrialsPerTarget` のsemantic threshold | 観測できるProduction workloadが無い（5.5） |

### 12.15 Phase 3-C candidate evidence（採用値ではない）

Phase 3-Bではdefaultを決めない。Phase 3-Cへ次を渡す。

extent:

- Issue #101 semantic threshold: `maxGogmaAdvance` 235（220では取り逃す）。Normal 1 / Skill 1で届く
- threshold前後のcost: 220で約0.85 s（Candidateなし）、235 / 240で約1.0 s（time-to-first）。235を超えるextent
  （240 / 300 / 350）はstop 1ではcostもsemanticも変えない（lazy性）
- extent拡大による追加semantic benefit: Issue #101ではNormal 4 / 16、Skill 2〜64、Gogma 240〜350のいずれも最初の
  Candidateを変えなかった
- `maxNormalAdvance` はsame-cost closureの幅を直接広げる: Issue #101ではNormal base 1本あたり約0.6〜0.7 sと約24.9k
  Gogma stateが加わり、16で約11 s・renderer memory約4 GB、40でWorker heap上限を超えてcrashした
- no-Ideal worst case: Gogma 235で約1.0 s、Gogma 30ならNormal 80でも約0.5 s。Skill extentは無影響
- held scaling: Skill held 512でも約1.1 s。Gogma `held_blocked` はstop `null` で約8.4 s（held長1〜8）、Gogma `held` の
  stop `null` はheldLength 1でcrash（Gogma extent 513で終端まで走る場合）。最初のCandidateまでなら全long-held条件で
  0.3 s以下

candidate trials:

- 1 trialの実コスト: Issue #101でtrial部分約0.36 s（Kernel全体約1.37 s、うちSearch約1.0 s）
- semantic thresholdは未観測。T = 1で十分であることは証明していない
- T = 8でも最初のCandidateでfoundになるworkloadではcostが増えない

planner reruns:

- R = 1では `kernel_multi_target` のTarget Cが評価されない（coverage不足）
- R ≥ 2で全Targetが評価され、使われるrerunは2回
- R = 2 / 4 / 8のcostは約39〜41 ms（worker）で差が無い（finalist measurement 5）

cancel / responsiveness:

- Search中のcancel ack / settleは約1.5 ms以内、Kernelのtrial中は約210〜225 ms
