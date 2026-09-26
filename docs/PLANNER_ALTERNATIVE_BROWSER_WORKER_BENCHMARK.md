# Planner Alternative Search Browser Worker Benchmark（Phase 3）

## Status

```text
Phase 3-A  harness implemented
Phase 3-B  real Browser measurement pending
Phase 3-C  Production default pending
```

この文書はIssue #136 / #101（Planner競合repair）Phase 3の計測記録である。Phase 3-Aでは計測基盤だけを実装し、
**実測値は1つも記録していない**。extent（`maxNormalAdvance` / `maxGogmaAdvance` / `maxSkillAdvance`）と試行上限
（`maxCandidateTrialsPerTarget` / `maxPlannerReruns`）のProduction defaultは未決であり、Phase 3-Bの実Browser Worker
実測を見てPhase 3-Cで決める。

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
