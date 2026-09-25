# Issue #101 Constrained Re-search 現行main再現・再ベンチマーク

実施日: 2026-09-25（計測セッション2回、JST 23:47〜翌0:55）

Refs #101

## Status

```text
Issue #101 実ケースの現行main再現:            完了（再現した。ただし追加の阻害要因を確認: 3.5）
constrained enumeration Gogma sweep:           完了（実Browser Worker）
Production orchestration経路の計測:            完了（実Browser Worker、Production calculation）
no-Ideal / bound到達 worst-case:               完了
cancel / responsiveness:                       完了
Production仕様・default変更:                   行っていない
```

この文書は計測記録であり、仕様authorityではない。Standard / Extended等の段階探索方式、
Production defaultの変更、constrained enumerationの最適化はいずれも**このPRでは決めていない**。

このPRが変更していないもの:

```text
defaultConstrainedEnumerationBounds     40 / 30 / 100 / 500
defaultCandidateSearchSettings          （recommendedCandidateSearchDefaults 350 / 500 / 1500）
defaultPlannerOrchestrationBounds       2 / 1 / 4
defaultPlannerWhatIfBounds
Production Worker protocol / Planner / Candidate ranking / constrained enumeration semantics
Build List UI / Production Plan UI / Persistence / CalculationContext semantics

CURRENT_CALCULATION_APP_SCHEMA_VERSION  15
DATABASE_SCHEMA_VERSION                 9
ExportRoot.schemaVersion                12
AppSettings.schemaVersion               2
RngState.schemaVersion                  2
PRODUCTION_RNG_ENGINE_VERSION           production-rng:c5-e7
Master dataVersion                      4
```

---

## 0. 結論の要約

1. **現行mainでIssue #101の実ケースは再現する。** 火・龍チャージアックスの単体Candidate Searchは
   Issue記載どおり「Normal 207本目（Counter 206）→巨戟化（Skill 341）→Gogma 55でKeep ×1」を返し、
   Issue #129後のNormal競合は `same_normal_counter` 1件に減っている（中間forge由来の大量Normal
   競合は発生しない）。
2. 現行default `40 / 30 / 100 / 500` では火側の代替Ideal Candidateは**1件も列挙されない**
   （`stoppedByBound = true`、`exhausted = false`、Planner warning
   `constrained_enumeration_bound_reached`）。
3. 代替Candidateが初めて列挙されるのは**Gogma 235**（G=234で0件、G=235で最初の1件）。
   Route: Normal 1本→巨戟化（Skill 341）→Reset Bonuses ×235（Gogma 55〜289）。Issue記載の
   「約235」と一致する。Normal / Skill / off-axisの拡大は不要（Normal offset 0のbaseで届く）。
4. **しかし実ケースでは、G=235以上で列挙された代替Candidateも採用されない。**
   代替Routeも龍側と同じ **Skill Counter 341で巨戟化**するため、Planner rerunで
   `same_skill_counter` 競合が残り、火側のEntryが選ばれない。trial数を20、rerun数を30に
   広げても、全conflictを龍へ解決しても結果は同じ。constrained enumeratorの巨戟化は常に
   origin Skill Counterで行われる（`constrainedRouteBases.ts` の `conversionSkill()`）ため、
   新規Normal / 所持Normal系の代替Routeは例外なくこの競合を持つ。
   **Issue #101はenumeration boundの拡大だけでは解決しない。**（3.5）
5. 龍側が巨戟化しない近似Production fixture（龍＝所持Gogma）では、G≥235で1件目のtrialが採用され、
   競合0件・`completed` のPlanになる。この場合でも採用までの時間は
   **G=235で約22秒、G=250で約27秒、G=350で78〜138秒**（Browser Worker実測）。
6. 時間構造: constrained enumerationは全Route base（Normal 40 offset）のBonus / Skill streamを
   **最初にまとめてsolveしてから** Candidateを配信する。そのため time to first Candidate は
   full enumeration時間とほぼ同じ（G=250で35.4秒 / 35.5秒、G=350で88.9秒 / 89.8秒）で、
   early-stopは traversal部分（全体の1〜2%）しか節約しない。コストはGogma boundに対して
   ほぼ2乗で増える（G=30: 0.42秒、G=100: 4.0秒、G=200: 19.7秒、G=350: 86〜157秒）。
7. したがって現行実装での判定は**パターンC**（単純なbound拡大は実用困難。拡大前に
   constrained enumeration自体の最適化が必要）であり、パターンB（早期発見に頼る拡大）は
   upfront solveのため成立しない。加えて実ケースにはbound以外の阻害要因（4）がある。
   パターンDを前提にはしていない。

---

## 1. 目的と範囲

Issue #101（Plannerの競合再検索で探索上限外の代替Ideal Routeを扱えるようにする）について、
Production仕様を決める前に現行mainの事実を測る。

- Issue #101実ケースを現行Production authority（Master / `ProductionRngEngine` /
  Candidate Search / Candidate factory / BuildListEntry / Planner conflict detection）で再構築する
- Planner constrained re-searchがどこで止まるかを確認する
- Gogma軸を広げたときのconstrained enumerationとProduction orchestrationの実時間を測る
- no-Ideal / bound到達時のworst-caseとcancel / responsivenessを確認する

Issue本文の過去結果は期待値として固定していない。fixtureは現在mainのCandidate Searchの
出力から作り、その結果がIssue記載と一致したことを記録する（3章）。

---

## 2. 実施環境

| 項目 | 値 |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 |
| Browser | Chromium 152.0.7977.130（Claude Desktop内蔵Browser pane、UA `Claude/2.9939.2`） |
| `navigator.hardwareConcurrency` | 16 |
| `document.visibilityState` | 全94 recordで `visible` |
| benchmark基準commit | `e3427acd12e51e88448c6ad2c74d33b7e56dc480`（main） + 本PRのbenchmark専用コード |
| Production RNG version | `production-rng:c5-e7` |
| Calculation schema version | 15 |
| build | `npx vite build --config vite.benchmark.config.ts`（production build） |
| serve | `npx vite preview --config vite.benchmark.config.ts --port 4175` |
| URL | `http://localhost:4175/GogmaArtianPlanner/benchmark.html` → 「Issue 101 Constrained Re-search」 |
| warm-up | 各G / 各workloadの最初に1回（`phase: 'warm-up'`、集計外） |
| measurement | enumeration 3回（real）/ 2回（no-Ideal）、orchestration 2回。G=350は追加あり（6.7） |
| watchdog | benchmark側のwatchdog timeoutは設けていない（Production Workerと同じくcancelのみ）。ping timeoutは120秒 |
| Worker error | 全runでnative Worker `error` / `messageerror` / benchmark `error` responseなし |
| memory | 計測していない（10章） |

Node / Vitestはfixture correctnessとsemantic結果の確認にだけ使った。本書の性能値は
すべて実Browser Worker経路の値である。

---

## 3. Issue #101実ケースの再現（現行main）

### 3.1 入力

| 項目 | 値 |
| --- | --- |
| Base Seed | `51231782`（confirmed、`observation`） |
| Skill Counter | 341 |
| Gogma Counter | 55 |
| Normal Counter | `weapon.charge_blade:8` = 0 |
| Target | `weapon.charge_blade` × `element.fire` / `element.dragon`、priority 3 |
| Ideal Bonus | 斬れ味・装填強化EX ×1、属性強化EX ×2、属性強化II ×2（Issue本文） |
| Skill条件 | なし（Ideal / Practicalとも未設定）。妥協条件なし |
| 所持武器 | なし |
| Candidate Search設定 | Normal 350 / 復元ボーナス 500 / Skill 1500（`recommendedCandidateSearchDefaults`） |

### 3.2 Candidate Searchの結果

現行mainの `searchCandidates()` は火・龍とも同じRouteを返した（Issue記載と一致）。

```text
normal_artian_to_gogma
  create_normal_artian  count 207  Normal 0 -> 207（production target = Counter 206）
  convert_normal_to_gogma        Skill 341 -> 342
  keep_bonuses                   Gogma 55 -> 56
  operation 3（unit 209）、Normal advance 207 / Skill 1 / Gogma 1
```

### 3.3 Build Listへ2件入れた場合の初期競合（Issue #129後）

`preparePlannerInitialContext()` の初期conflictは次の3件。

| kind | 位置 |
| --- | --- |
| `same_normal_counter` | `weapon.charge_blade:8` position 206 |
| `same_skill_counter` | Skill Counter 341（両方の巨戟化） |
| `same_gogma_counter` | Gogma Counter 55（両方のKeep） |

- **Normal conflictは1件だけ**。Counter-advance forge（0〜205）はIssue #129により競合せず、
  production target（206）同士だけが `same_normal_counter` として残っている
- Issue本文はNormal競合だけを挙げているが、現行Plannerでは同じ2 Entryの間に
  Skill 341 / Gogma 55の競合も同時に検出される

### 3.4 代替Routeの存在とbound閾値

火Targetのconstrained enumeration（origin = Planner開始時snapshot）の結果:

| bounds N/G/S/O | 列挙Candidate | summary |
| --- | ---: | --- |
| 40/30/100/500（現行default） | 0 | `stoppedByBound`、非exhausted |
| 40/200/100/500 | 0 | 同上 |
| 40/225/100/500 | 0 | 同上 |
| 1/234/100/500 | 0 | 同上（Vitestで確認） |
| 1/235/100/500 | 1 | 同上 |
| 40/235/100/500 | 40 | 同上（Normal offset 0〜39の各baseから1件ずつ） |
| 40/250/100/500 | 320 | 同上 |
| 40/350/100/500 | 2,480 | 同上 |

最初に列挙されるCandidate（G=235でもG=350でも同じ）:

```text
normal_artian_to_gogma
  create_normal_artian  count 1   Normal 0 -> 1
  convert_normal_to_gogma         Skill 341 -> 342
  reset_bonuses ×235              Gogma 55 -> 290（最後のResetは Gogma 289）
  operation 237、Gogma advance 235
```

- 必要なのは**Gogma軸だけ**。Normal offset 0のbaseで届くため、Normal / Skill / off-axisを
  広げる必要はない（Skill条件がないのでSkill streamはsolveされない）
- `examinedCandidates` は代替Candidate数と一致し、`evaluatedOffAxisPairs` は常に0
  （Skill軸がないためoff-axis pairが存在しない）

### 3.5 実ケースでは代替Candidateが採用されない（追加の阻害要因）

龍Entryを固定側にした `createProductionPlanWithConstrainedSearch()`（Production orchestration）
では、G≥235で代替Candidateが列挙されても**採用されない**。

直接確認（Vitest、`issue101ConstrainedResearchFixtures.test.ts`）:

```text
input: 龍Entry（Normal 206 route） + 火の代替Entry（Normal 1本 + Reset ×235）
ordinary Production Plan:
  selectedBuildListEntryIds = [龍Entry]
  conflicts = [ same_skill_counter（Skill 341）, selectedBuildListEntryId = null ]
```

- 代替Routeも巨戟化を含み、その巨戟化は**origin Skill Counter 341**に固定されている
- 龍側も341で巨戟化するため、2つの巨戟化（必須unit、非shareable）が同じSkill位置を要求し、
  Route commitmentの暫定outcomeで火のEntryが外れる
- `isConstrainedTrialAdoptable()` は「trial Entryが選ばれていること」を要求するので不採用
- 解決範囲を `primary`（Normal競合だけ龍を優先: Issueの例）にしても、`all`（3競合すべて
  龍を優先）にしても、orchestration boundsを `20 / 1 / 30` に広げても結果は同じ（6.3）

原因はenumeratorの構造にある。`constrainedRouteBases.ts` の `conversionSkill()` は巨戟化を
常に `origin.rngState.skillCounter` の位置で組み立てる。所持Gogmaがない限り、火側の全代替Route
（`normal_artian_to_gogma` / `owned_normal_artian_to_gogma`）は巨戟化を含むので、どのboundを
広げても龍側の巨戟化と同じSkill 341を要求する。

ゲーム上は「龍を341で巨戟化 → 火を342で巨戟化」（火はSkill条件なし）で成立する可能性があるが、
現行のCandidate / PlannerはCandidateごとの絶対Counter位置を要求し、constrained enumerationには
「他Entryの巨戟化の後ろのSkill位置で巨戟化する」Routeを表す仕組みがない。これは
**enumeration boundではなくRoute表現 / Planner契約の問題**であり、このPRでは仕様判断をしない。
後続でIssue #101を扱う場合、この点を別の論点として判断する必要がある（11章）。

---

## 4. Harness

### 4.1 ファイル

| ファイル | 役割 |
| --- | --- |
| `src/benchmarks/issue101ConstrainedResearchFixtures.ts` | 実ケース / 近似 / no-Ideal fixture、bounds helper、fail-closed validation |
| `src/benchmarks/issue101ConstrainedResearchProtocol.ts` | benchmark専用Worker protocol（全type `i101_benchmark_` 前置） |
| `src/benchmarks/issue101ConstrainedResearchBrowserBenchmark.ts` | 主スレッドharness（run / cancel / ping / fail closed） |
| `src/benchmarks/issue101RouteSummary.ts` | Route要約（記録用、Domain authorityではない） |
| `src/workers/issue101ConstrainedResearch.worker.benchmark.ts` | benchmark専用Worker controller |
| `src/workers/issue101ConstrainedResearch.worker.benchmark.entry.ts` | benchmark専用Worker entry |
| `src/pages/Issue101ConstrainedResearchBenchmarkPage.tsx` | 計測page、`globalThis.i101Benchmark` |
| `src/pages/BenchmarkApp.tsx` | 6つ目のharnessとして追加（既存5つは不変） |

通常アプリからは到達できない（`benchmark.html` のみ）。Production moduleからの参照が
ないことはテストで固定している（9章）。

### 4.2 Worker経路

Production Planner Workerのadapter（`planner.worker.production.ts`）は
`defaultConstrainedEnumerationBounds` をWorker内で固定するため、Gogma sweepはProduction
Worker経由では測れない。benchmark Workerは次を**同じ部品で**合成する。

```text
enumeration:    visitConstrainedCandidates(input, ProductionRngEngine, visitor, { shouldCancel, yieldControl })
orchestration:  createProductionPlanWithConstrainedSearch(
                  plannerInput,
                  createProductionPlannerWorkerDependencies(),   // Production adapterと同一
                  { enumerationBounds: <request>, orchestrationBounds: <request>,
                    executionOptions: { shouldCancel, yieldControl } })
```

違いはenumeration boundsをrequestから受け取ることだけである。Production Worker、
`planner.worker.production.ts`、`defaultConstrainedEnumerationBounds` は変更していない。
yieldはB8-B2 benchmark Workerの `benchmarkWorkerYield()`（MessageChannel macrotask）を再利用した。

### 4.3 Timing boundary

- fixture（実ケースは2回の実Candidate Search）は主スレッドで1回だけ作り、cacheする。計測外
- boundsは主スレッドでWorker生成前にvalidateする（不正ならWorkerを作らずthrow）
- 1 run = 1 fresh Worker（B8-B2 / B8-E1と同じ）。`new Worker()` は計測外
- `roundTripMs`: request `postMessage()` 直前 → settle。PlannerInputのstructured clone、
  未完了のWorker初期化、計算、結果のcloneを含む
- `workerElapsedMs`: Worker内で `visitConstrainedCandidates()` /
  `createProductionPlanWithConstrainedSearch()` 呼出し直前 → 終了
- 補正値は使っていない。round tripとWorker時間の差は全runで10〜40 ms程度だった

### 4.4 orchestrationのtimeline観測

Production orchestrationには観測hookがないため、**Production Planner dependenciesをwrapして**
呼出し時刻だけを記録した（返す値はProductionのもの）。

- `PlannerClock.now()` は materializer がCandidate trialごとに1回、Plan生成が1回呼ぶ
- Plan生成は `clock.now()` の直後に `idFactory.productionPlanId()` を呼ぶ
- よって「直後にProductionPlan IDが続くclock read」= Plan生成、それ以外 = Candidate trial

これから次を導出した。

| 値 | 定義 |
| --- | --- |
| initial Planner run | 最初のPlan生成時刻 |
| time to first Candidate | 最初のCandidate trial（materialization）時刻 |
| Candidate trial数 | materialization回数 |
| Plan生成数 | Plan付きfull Planner run数（initial runを含む） |
| time to adopted Candidate | 採用trialのPlan生成時刻（採用なしは `—`） |
| usable Candidate | 本fixtureでは採用可能 = 最初の採用Candidate |

Planが返らなかったfull Planner runはeventを残さない。本計測の全runで
`Plan生成数 = 1 + Candidate trial数` が成立しており、Plan無しrunは発生していない。

### 4.5 cancel観測

- `cancelAfterMs`: 主スレッドtimerでcancelをpost
- `cancelOnFirstCandidate`: Workerが最初のCandidate delivery（enumeration）/最初のtrial
  （orchestration）で1通だけ `i101_benchmark_first_candidate` を送り、主スレッドが即cancelをpost。
  traversal中 / Planner trial中へcancelを当てるためのbenchmark専用message
- `pingIntervalMs: 0`: pongを受けたら次のpingを送る（Worker event loopの停止時間の観測）

---

## 5. Workload

**Issue #101実ケースと、Production benchmark fixtureを区別する。**

| workload | 種別 | 内容 |
| --- | --- | --- |
| `issue101_real_fire`（enumeration） | Issue #101実ケース | 3.1の入力で火Targetをconstrained enumeration |
| `issue101_real_primary`（orchestration） | Issue #101実ケース | 火・龍Entry + Normal競合だけ龍を優先するresolution |
| `issue101_real_all`（orchestration） | Issue #101実ケース | 火・龍Entry + 初期3競合すべて龍を優先 |
| `issue101_approx_owned_dragon_primary` | Production benchmark fixture | 龍側がNormal 206を巨戟化済みの所持Gogma（slotは現行Productionの Normal 206予測、`normal_artian` scope）。龍Candidate = `existing_gogma_keep_bonuses`（Gogma 55でKeep ×1、巨戟化なし）。初期競合は `same_gogma_counter` 1件で、それを龍優先で解決 |
| `issue101_no_ideal`（enumeration） | Production benchmark fixture | 同じRNG stateで、Ideal = 斬れ味・装填EX ×1 + 属性EX ×3 + 属性II ×1。EXの同一ID repeat penaltyが100 → 20 → 0なので、ResetでもKeepでも3本目の属性EXは重み0で生成されない |

近似fixtureはIssue #101そのものではない。3.5の阻害要因がない場合にorchestrationが
採用まで何秒かかるかを測るためだけにある。

---

## 6. 結果（current main、実Browser Worker）

表の値はWorker時間の中央値（秒）、括弧内は範囲。round tripは全runでWorker時間 + 0.01〜0.04秒。

### 6.1 constrained enumeration Gogma sweep（実ケース、火、N/S/O = 40/100/500固定）

| G | Worker時間 | time to first Candidate | 列挙数 | examined | off-axis | stoppedByBound | exhausted |
| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 30 | 0.42 (0.41–0.43) | — | 0 | 0 | 0 | true | false |
| 50 | 1.02 (1.00–1.06) | — | 0 | 0 | 0 | true | false |
| 100 | 3.98 (3.96–4.04) | — | 0 | 0 | 0 | true | false |
| 150 | 9.80 (9.78–9.96) | — | 0 | 0 | 0 | true | false |
| 200 | 19.72 (19.14–20.35) | — | 0 | 0 | 0 | true | false |
| 225 | 26.38 (25.23–26.50) | — | 0 | 0 | 0 | true | false |
| **235** | **30.92 (29.79–31.52)** | **30.90** | 40 | 40 | 0 | true | false |
| 250 | 35.51 (35.17–36.10) | 35.40 | 320 | 320 | 0 | true | false |
| 350 | 89.81 (85.96–90.97) | 88.87 | 2,480 | 2,480 | 0 | true | false |

セッション1、各3 measurement。G=225 / 235は閾値確認のための追加測定点。

- time to first CandidateはWorker時間の99%以上を占める（upfront stream solve）。
  G=350でも最初の1件からtraversal終了までは約1秒
- 全boundで `stoppedByBound = true`（Gogma stream / Normal offsetのどちらかが常にboundに達する）。
  `exhausted` は一度も `true` にならない
- 増加はほぼG²（G=100 → 200で約5.0倍、200 → 350で約4.6倍）

### 6.2 Production orchestration（実ケース、`primary`、orchestration default 2/1/4）

| G | Worker時間 | initial run | first trial | trial | Plan生成 | 採用 | 最終conflict | warning |
| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 30 | 0.48 (0.46–0.49) | 0.04 | — | 0 | 1 | なし | 3 | `constrained_enumeration_bound_reached` |
| 100 | 4.15 (4.09–4.21) | 0.04 | — | 0 | 1 | なし | 3 | 同上 |
| 200 | 19.80 (19.75–19.86) | 0.04 | — | 0 | 1 | なし | 3 | 同上 |
| 235 | 29.99 (29.68–30.31) | 0.04 | 29.13 | 2 | 3 | なし | 3 | `max_candidate_trials_per_conflict_reached` |
| 250 | 34.49 (34.05–34.93) | 0.04 | 33.63 | 2 | 3 | なし | 3 | 同上 |
| 350 | 67.15 (56.06–78.23) | 0.03 | 66.49 | 2 | 3 | なし | 3 | 同上 |

- 全runで最終Planは龍Entryのみ・209 step・`termination.status = exhausted`、
  generated BuildListEntry 0件、最終conflict 3件（Normal競合だけ `selectedBuildListEntryId = 龍`）
- 1 trial（materialization → preflight → full Planner rerun）は約0.30〜0.42秒
- G≥235では、enumerationでは代替Candidateが得られているが、default `2` trialで打ち切られる。
  ただし次節のとおり、trialを増やしても採用されない

### 6.3 Enumeration bound問題とOrchestration bound問題の分離（実ケース）

| run | G | orchestration bounds | Worker時間 | first trial | trial | Plan生成 | 採用 | warning |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |
| trial拡大 | 250 | 20 / 1 / 30 | 29.65 | 23.28 | 20 | 21 | なし | `max_candidate_trials_per_conflict_reached` |
| trial拡大 | 350 | 20 / 1 / 30 | 60.82 | 54.33 | 20 | 21 | なし | 同上 |
| `all` scope | 250 | 2 / 1 / 4 | 53.68 (50.88–56.48) | 25.74 | 3 | 4 | なし | `max_candidate_trials_per_conflict_reached`, `max_planner_reruns_reached` |

（trial拡大は各1 run、`phase: 'probe'`）

- 20 trialはすべて不採用（1 trialあたり約0.32秒、20 trialで約6.4秒）。3.5のSkill 341競合のため
  **orchestration boundを広げても実ケースは解決しない**
- `all` scopeでは固定constraintが3件になり、work（競合ごと）ごとに**enumerationを最初から
  やり直す**。1回目のwork: solve 約25秒 + 2 trial、2回目のwork: 再solve 約26秒 + 1 trial で
  `maxPlannerReruns = 4` に達する。全体で約1回分のenumerationが余計にかかる
- 20 trialのrunのtime to first Candidateが23〜54秒と6.1 / 6.2より短いのはセッション内の変動で
  ある（6.7）。enumerationの内容は同じ

### 6.4 採用までの時間（Production benchmark fixture: 龍＝所持Gogma、`primary`、2/1/4）

| G | Worker時間 | first trial | adopted | 採用ordinal | trial | Plan生成 | 最終Plan |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 30 | 0.35 (0.34–0.36) | — | — | — | 0 | 1 | 龍のみ1 step、conflict 1、`constrained_enumeration_bound_reached` |
| 200 | 15.56 (15.15–15.97) | — | — | — | 0 | 1 | 同上 |
| **235** | **21.90 (20.61–23.19)** | 21.45 | **21.86** | 1 | 1 | 2 | 火（代替）+ 龍、237 step、conflict 0、`completed`、warningなし |
| 250 | 27.49 (27.24–27.75) | 27.02 | 27.46 | 1 | 1 | 2 | 同上 |
| 350 | S1: 108.30 (78.21–138.40) / S2: 103.82 (88.50–119.14) | 107.37 / 103.18 | 108.24 / 103.77 | 1 | 1 | 2 | 同上 |

- 採用されるのは常に1件目のCandidate（Normal 1本 + Reset ×235）で、default `2 / 1 / 4` で足りる
  （orchestration boundは律速していない）
- 採用Planは237 step: 龍のKeep（Gogma 55）を先に実行し、火のGogma 55のResetは次がResetなので
  silent fast-forwardされる（1 + 237 − 1）
- first trial → adoptedは約0.4〜1.1秒。**時間のほぼすべてはfirst Candidateまでのenumeration solve**
- この近似fixtureのG=200〜250の値は実ケース（6.1 / 6.2）より2〜3割短い。enumeration対象（火）と
  originの内容はRNG / Target / Normal Counterとも同じで、差の原因は特定していない
  （計測時刻の違いによる変動の可能性がある）。workload間の絶対値比較には使わない

### 6.5 No-Ideal worst-case（Production benchmark fixture、enumeration）

| G | Worker時間 | 列挙 | examined | stoppedByBound | exhausted |
| ---: | ---: | ---: | ---: | --- | --- |
| 30 | 0.43 (0.43–0.44) | 0 | 0 | true | false |
| 100 | 4.31 (4.28–4.35) | 0 | 0 | true | false |
| 250 | 36.49 (36.28–36.70) | 0 | 0 | true | false |
| 350 | 87.70 (86.42–88.98) | 0 | 0 | true | false |

- Idealに届かない場合でも時間は実ケースとほぼ同じ。**コストは列挙数ではなくstream solveで決まる**
- 実ケースのG<235も同じ意味のno-Ideal worst-caseである（Candidate 0件、全solveを払って
  `constrained_enumeration_bound_reached`）
- 既存semanticsのとおり、bound到達は `exhausted` として報告されない。B9 what-ifの
  `not_found_within_search_extent` / `stopped_by_enumeration_bound` は本PRでは計測していない
  （what-ifは対象外）が、同じ `ConstrainedEnumerationSummary` から導出される

### 6.6 Cancel / responsiveness（セッション2）

| run | cancel時点 | cancel → Worker ack | cancel → settle | 結果 | 最長ping |
| --- | --- | ---: | ---: | --- | ---: |
| enumeration G=350 | 50 ms（early） | 5.5 ms | 5.6 ms | cancelled、delivered 0 | 26.5 ms |
| enumeration G=350 | 30 s（stream solve中） | **2,310 ms** | 2,311 ms | cancelled、delivered 0 | 2,998 ms |
| enumeration G=350 | 最初のCandidate受信時（traversal中） | 12.3 ms | 12.5 ms | cancelled、delivered 26 | 3,493 ms |
| orchestration 実ケース G=250 | 10 s（enumeration solve中） | 579 ms | 582 ms | cancelled（`CandidateSearchError`） | 1,019 ms |
| orchestration 実ケース G=250 | 最初のtrial受信時（Planner rerun中） | 538 ms | 539 ms | 通常の `plan: null` 結果としてsettle | 1,364 ms |
| orchestration 近似 G=250 | 最初のtrial受信時 | 518 ms | 518 ms | 同上 | 1,480 ms |

responsivenessのみのrun（enumeration G=350、cancelなし、pingを連続送信）:
39,274 ping、**最長3,892 ms**、Worker時間163.2秒。

- cancel後にCandidate / 結果が流れ続けることはなかった（cancelledは1回だけsettle）
- **stream solve中はWorker event loopが最大約3〜3.9秒応答しない**。cancelの反映もその分遅れる
  （2.3秒）。traversal中とearly cancelは即時
- orchestrationのPlanner trial中のcancelは約0.5秒後に、orchestrationの通常のcancelled結果
  （`plan: null`、throwではない）として終わる
- 連続pingを受けたrunはWorker時間が163秒で、ping無しのG=350（86〜157秒）より長い。
  pingの処理自体が計測を重くするため、このrunは時間の計測値には使っていない

### 6.7 変動

- G≤250のenumerationはセッション1内で±3%程度、セッション2で+5〜7%（G=100: 3.98 → 4.18秒、
  G=250: 35.51 → 37.86秒）
- **G=350だけ変動が大きい**: enumerationはセッション1で85.96〜90.97秒、セッション2で
  131.90〜157.03秒（中央値151.27秒）。orchestrationは56.06〜138.40秒
- 原因は特定していない。stream solveの保持量が大きいG=350でのみ起きることから
  heap / GC圧の可能性はあるが、Worker内メモリを計測していないため未検証（10章）
- このためG=350の値は「約1.5分、条件によって2.5分超」と幅で読む

---

## 7. 分析

### 7.1 時間構造

```text
visitConstrainedCandidates()
  1. createConstrainedRouteBases()      Normal offset 0..N-1（+ blind / 所持）の全base生成
  2. for base of bases: solveBase()     各baseのBonus stream（G深さ）/ Skill streamをsolve  ← ほぼ全時間
  3. lattice traversal                  (i, j) cellを評価し、Candidateを逐次deliver
```

- 2が最初のCandidateより前に全baseぶん走るため、**time to first Candidate ≈ full enumeration**
- consumer early-stop（orchestrationの採用 / trial上限）は3しか節約しない。G=350で約1秒、全体の1〜2%
- Bonus stream solveは各Normal base（40個）ごとにG深さまで進む。実測のコストはGに対して
  ほぼ2乗で増える（内部のどの処理が支配的かはprofileしておらず、未確認）
- Issue #104のNormal Route base reductionはconstrained enumerationへは適用されていない
  （仕様どおり）。40 baseそれぞれがfull streamを持つ

### 7.2 パターン判定

| パターン | 判定 | 根拠 |
| --- | --- | --- |
| A: 現行でもG 250〜350が十分速い | **該当しない** | G=250で35秒、G=350で86〜157秒。B8-B2の判断基準（full 約2秒 / first 約1秒、8章）の15〜70倍 |
| B: fullは重いが目的Candidateは早く見つかる | **該当しない** | upfront solveのためfirst Candidate = ほぼfull。Issue #101の代替Candidateは最初に列挙される1件だが、それでもG=235で約22〜31秒 |
| C: 範囲拡大は実用困難 → constrained enumeration最適化を先に | **該当する** | 7.1。コストの主因がbase × Gogma深さのupfront solveにある |
| D: 最適化しても重い → 段階探索 | 未判断 | 最適化を試していないため判断できない |

さらに実ケースには、boundやパフォーマンスとは独立に3.5の阻害要因がある。Cの最適化を行って
G=235以上を実用時間で探索できたとしても、現行の巨戟化Skill位置の扱いのままでは
Issue #101の火・龍ケースは解決しない。

### 7.3 後続判断の材料

- Gogma 235が必要なケースを救うには、少なくとも30 → 235以上への拡大が要る。現行実装では
  それだけで約20〜30秒以上（worst-caseはno-Idealでも同じ）
- 1 trialのコストは約0.3〜0.4秒で、orchestration boundの影響は小さい。default `2 / 1 / 4` は
  近似fixtureで十分だった
- 固定constraintが複数あると、workごとにenumerationを再solveする（`all` scopeで約2倍）。
  同一Target・同一originのsolve結果の共有は最適化候補になり得る（本PRでは実装・評価していない）
- stream solve中のevent loop停止（最大約3〜3.9秒）はcancel応答性の問題になる。範囲を広げるなら
  solve内部のyield粒度も論点になる
- Candidate Searchの500 / 350 / 1500が実用的であることから、constrained enumerationも同じ範囲で
  実用的だとは言えない（Issue #104の最適化が適用されていない）。これは今回の実測で確認された

---

## 8. Historical B8 measurement（参考、現在値ではない）

以下は過去文書の値であり、本PRで書き換えていない。現在のProduction性能authorityとしては
使わない。

| 項目 | 値 | 出典 |
| --- | --- | --- |
| 計測日 / RNG version | 2026-09-07 / `production-rng:c5-e2` | `docs/B8_CONSTRAINED_ENUMERATION_BROWSER_WORKER_BENCHMARK.md` |
| fixture | Bow / Fire、Gogma Counter 200（B5由来）、Issue #101とは別 | 同上 |
| 採用tuple `40/30/100/500` | full 1,782.0 ms、first Candidate 331.6 ms、20,306 Candidate | 同上 |
| 判断基準 | full おおむね2秒以内、first おおむね1秒以内 | 同上 |
| orchestration default `2/1/4` | B8-E2aの実測で決定 | `docs/B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md` |

B8当時のfixture・RNG version・Calculation schemaは現在と異なる。今回のG=30の実ケース値
（0.42秒）とB8のfull 1.78秒は、workloadが違うため直接比較しない。

---

## 9. テスト

性能時間はassertしていない。

`src/benchmarks/issue101ConstrainedResearchFixtures.test.ts`（Node / Vitest、現行Production RNG）:

- baseline boundsが `defaultConstrainedEnumerationBounds`（40/30/100/500）と一致、Gogma sweep定義
- Gogma軸だけのbounds override、不正bounds（0 / 負 / 小数 / NaN）のfail closed
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION = 15` / `production-rng:c5-e7` の不変
- 実ケースfixtureのCandidate Route（火・龍とも 207 forge / Skill 341 / Gogma 55 Keep）と決定性
- Issue #129後の初期conflict: Normal 1件（position 206）+ Skill 341 + Gogma 55
- baseline boundsで代替Candidate 0件・bound stop
- G=234で0件、G=235で最初の代替Candidate（Route summary固定）
- 代替Candidateが龍と並ぶと `same_skill_counter` が残り採用されないこと
- `primary` / `all` 両scopeのorchestrationで採用なし、baseline orchestrationはtrial 0で
  `constrained_enumeration_bound_reached`
- 近似fixture: 龍が巨戟化なしのKeep、初期conflictはGogma 1件、G=234で不採用・G=235で1件目採用
  （237 step、conflict 0、`completed`）
- no-Ideal fixture: examined 0、bound stop、非exhausted

`src/benchmarks/issue101ConstrainedResearchBrowserBenchmark.test.ts`:

- protocol prefixの判定、harnessのrequest / 結果 / cancel / first-Candidate cancel / Worker errorの
  fail closed、不正boundsではWorkerへ何もpostしないこと
- Worker controller: ping、実enumeration、不正boundsのerror response、cancelのsettle
- orchestration timeline観測: clock / ProductionPlan IDの分類、trial・Plan生成・採用ordinalの導出
- 分離: Production module（app / components / db / domain / services / stores / workers /
  pages、benchmark専用ファイルを除く）がIssue #101 benchmarkを参照しないこと、
  Production Planner Worker adapterが `defaultConstrainedEnumerationBounds` を渡し続けていること

`src/pages/BenchmarkApp.test.tsx`: 6つ目のharnessボタンを追加。

---

## 10. 未検証・制約

- **memory**: Worker内のheap使用量は計測していない（`performance.memory` は主スレッドのみ、
  `measureUserAgentSpecificMemory()` はcross-origin isolationが必要）。G=350の大きな変動が
  GC由来かどうかは未確認
- 計測は1台・1 Browser（Claude Desktop内蔵Chromium）のみ。他環境・スマートフォンでは未計測
- G=350の値は変動が大きく（6.7）、中央値は参考値である
- orchestrationのtimelineはdependency観測による導出（4.4）。Plan無しのfull Planner runは
  観測できないが、本計測では発生していない（`Plan生成数 = 1 + trial数`）
- 近似fixtureとno-Ideal fixtureはProduction-validな合成入力であり、Issue #101実ケースではない
- 3.5の「ゲーム上は341 / 342の順で巨戟化すれば成立する可能性」はPlanner表現の観点での指摘で
  あり、ゲーム挙動として新たに検証したものではない
- B9 what-ifの経路は計測していない
- RNG挙動について新たな主張はしていない。すべて現行 `production-rng:c5-e7` の出力をそのまま使った

---

## 11. 後続Phaseへの論点（仕様判断はしていない）

1. **巨戟化Skill位置の扱い**: 複数Targetが同じorigin Skill Counterで巨戟化するRouteを持つ場合、
   constrained enumerationでは解消できない。Issue #101の火・龍ケースを解決するには、Route表現、
   constrained enumeration、またはPlanner契約のどこでこれを扱うかを決める必要がある
   （Skill条件のないTargetに限るかも含めて）
2. **constrained enumerationの最適化**（パターンC）: upfront solveのbase × G²コスト、
   work間の再solve、solve中のyield粒度。Issue #104のpruningはcanonical 1件向けであり、代替Route
   列挙へそのまま流用できるとは限らない
3. 上記の後で、boundのProduction default・段階探索・UI露出の要否を判断する

---

## 12. Raw measurement artifact

```text
ISSUE_101_BROWSER_RAW_RESULTS.json   （repo root、.gitignoreの *_BROWSER_RAW_RESULTS.json）
records: session 1 = 75、session 2 = 19（計94、うちsession 2の最初の1件はwarm-up）
SHA256 cacdd56fc04c29ac1265532999978c886e8478f60cbd5f709a1eb220c8ddb264
```

レビュー用の一時artifactであり、commit対象ではない。各recordはbounds、phase、round trip、
Worker時間、typed summary / orchestration timeline、cancel観測、ping、visibilityStateを持つ。
