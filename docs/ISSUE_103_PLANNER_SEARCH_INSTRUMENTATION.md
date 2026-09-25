# Issue #103 Planner search instrumentation / 計測記録

実施日: 2026-09-24。基準main: `8f37dbbc9b6a8c46de022201b32064de4bc94840`（PR #106 merge後）。
この文書は **計測フェーズの記録** であり、仕様ではない。Planner semanticsの正本は
`docs/PLANNER_SPEC.md`（7 / 7.2 / 7.0.2 / 9）で、本PRはそれを変更しない。

> **Issue #103 Phase D-2bでの扱い。** 本書が使った実行用のbenchmark harness（Issue #103 benchmark page、
> benchmark Worker、Browser controller、Node計測runner、PR #107 Beam instrumentation、scheduler benchmark
> wrapper）はPhase D-2bで削除済みである。本書は当時の測定記録として保持し、記載したファイル名・数値・手順は
> 当時のまま書き換えない（現在の構成は
> [ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md](./ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md) 14.6）。

## 1. 目的

Issue #103（大量Build List時のPlanner探索戦略）の本実装前に、通常PlannerのBeam Searchが
**どこで・なぜ** `maxExpandedStates` を使い切るのかを数値で答えられるようにする。
探索アルゴリズム、scoring、comparator、semantic key、beamWidth、停止条件、
PlannerOptions default、Candidate Route、#101 constrained searchは一切変更しない。

## 2. Baseline（post-#102）

Issue #103へ追記された実データ再計測（本Repositoryには含めない）:

```text
Build List登録候補: 35件
Planner設定: maxPlanSteps 1000 / maxExpandedStates 200000 / beamWidth 50
結果: 探索状態数 200000 / 200000、完成した目標武器 8 / 35
```

注: `expandedStates` はPLANNER_SPEC 7.2の定義どおり「構築・評価したsuccessor数」であり、
beamから取り出して展開したstate数ではない。本計測では両者を区別して記録した。

## 3. Instrumentation

### 3.1 境界

- `PlannerExecutionOptions.searchInstrumentation?: PlannerSearchInstrumentation`
  （`src/domain/planner/plannerSearchInstrumentation.ts`）を追加した。
  `undefined` の場合はcollectorを作らず、Beam Search内の各hookは `metrics?.x()` の
  no-op呼出しだけになる
- 指定時もcollectorはBeam Searchが既に構築したstateを **読むだけ** で、clone、mutation、
  並べ替え、filter、RNG Engine呼出し、comparator / semantic key / 停止条件 /
  `expandedStates` の変更を一切しない。trimは従来と同じ
  `[...deduplicated.values()].sort(comparePlannerSearchStates).slice(0, beamWidth)` で、
  collectorはsort済み配列とslice結果を後から読む
- `PlannerResult` / `PlannerBeamSearchResult` / `ProductionPlan` / Worker DTO /
  IndexedDB / Export / UIのいずれにも計測値を入れない。schema versionは不変。
  計測値は `onDepth` / `onSearchEnd` callbackへplain dataとして渡るだけである
- 時刻が必要なphase計測は、呼出側が `now` を注入した場合だけ行う。Domainは自前の時計を
  読まず、どの探索判断もその値を読まない
- Production Planner Worker protocolはinstrumentationを運ばない。B8 orchestration /
  what-ifの内部Beam Searchも従来どおり `shouldCancel` / `yieldControl` だけを渡す
- PLANNER_SPEC / REQUIREMENTS / DATA_MODELは変更していない（semantics不変で、製品挙動の
  契約ではないため）

### 3.2 depthごとの項目（`PlannerSearchDepthMetrics`）

| 項目 | 意味 |
|---|---|
| `beamInputStates` / `expandedBeamStates` | depth開始時のbeam数 / successor生成を実行したbeam state数 |
| `completeBeamStates` / `stepLimitBeamStates` / `unvisitedBeamStates` | 完了済み・`maxPlanSteps` 到達で展開しなかった数 / 停止で未訪問の数 |
| `attemptedActions` / `rejectedAttempts` | 構築したsuccessor試行数 / rejectionを返した試行（発生回数） |
| `prunedDominatedSkippableUnits` / `conflictBlockedUnits` | required unitに支配され生成しなかったskippable unit / conflict resolutionで生成しなかったunit |
| `generatedSuccessors`（lane別） | push数 = `expandedStates` 増分。base / bonus / skill / reserve 別 |
| `successorsBefore/AfterSemanticDedup`, `semanticDuplicatesRemoved` | 既存semantic keyによるdedup前後 |
| `statesBefore/AfterBeamTrim`, `beamTrimmedStates` | trim前後 |
| `best/worstCompletedTargetCount`, `completedTargetCountDistribution` | kept beamの完了planning Target数 |
| `maxCompletedTargetCountBeforeTrim`, `maxCompletedTargetCountAmongTrimmed`, `trimmedStatesAboveKeptBest` | trimで落ちたstateの完了数 |
| `bestEvaluationScore`, `lowestKeptEvaluationScore`, `bestTrimmedEvaluationScore` | trim境界のscore |
| `expandedStateConflicts`（kind別） | 展開したbeam stateで検出されたconflict数（`ConflictKind` そのまま） |
| `shareablePrimaryAttempts`, `sharedPhysicalActionSuccessors`, `sharedProgressedEntries` | shareable primary試行 / 2 Entry以上を進めたsuccessor / 追加でprogressしたEntry数 |
| `fastForwardedUnits`（bonus / skill）, `fastForwardedEntries` | successor内でsilent fast-forwardされたunit数 / (successor, Entry) 組数 |
| `diagnosticProjections`（opt-in） | 下記3.4 |
| `phaseMs`（`now` 注入時） | `beamStateSetup` / `applyAction` / `successorEvaluation` / `dedupAndTrim` |

fast-forwardは `fastForwardPlannerRouteProgress()` を複製せず、sourceとsuccessorのlane
progress差分から「各progressed Entryが実行した1 unit」を引いて数える。

### 3.3 run全体（`PlannerSearchRunMetrics`）

totals、`rejectionOccurrencesByReason`（**発生回数**。resultの `rejections` はunique保持なので
別物）、`uniqueConflictsByKind`（resultの `conflicts` と同じ集合）、
`expandedStateConflictsByKind`、`maxCompletedTargetCountEverObserved`、
`firstDepthByCompletedTargetCount`、Entryごとのlane別successor・shared secondary・
fast-forward・rejection・reserve件数。

### 3.4 Diagnostic projection（opt-in）

どちらも **有効なdedup keyではなく、探索には使わない**。successorがその射影の下で何件に
合流するかを数えるだけである。

- trace-free: 既存 `createPlannerSearchStateSemanticKey()` を trace を空にした浅いviewへ適用。
  source mutation version、route runtime、inventory等は残る
- progress: Counter値、Entryごとのlane progress、到達checkpoint、確保済みEntry、
  Target satisfactionだけ。どのEntryが共有Counter位置の操作を物理実行したかは区別しない

### 3.5 派生指標

- `successorsPerExpandedState = generatedSuccessors / Σ expandedBeamStates`
- `semanticDedupRatio = 1 - afterDedup / beforeDedup`
- `beamTrimRatio = 1 - afterTrim / beforeTrim`
- projection merge ratio = `1 - projectionUnique / beforeDedup`
- `completedTargetPlateau`: kept beamのbest completed数が最終最大値へ **初めて** 到達した
  depthを開始点とし、そこから最終depthまでのdepth数とsuccessor数
- 0除算は `null`（表示は `-`）

## 4. Fixture

`src/benchmarks/plannerSearchInstrumentationFixtures.ts`。全workloadがProduction-valid:
`ProductionRngEngine` でsourceの5枠 / Skill と各Routeの最終結果を予測し、Target Idealを
その結果に一致させ、`createCandidateFromPrediction()` → `createBuildListEntry()` で
通常のnon-stale Entryを作る。Fake Engine、手書き結果、実ユーザーデータは含まない。
RNG起点はB8 fixtureと同じ（Base Seed `51231782`、共通のGogma / Skill / Normal Counter）。

Route形はCandidate Searchが1つのRNG起点から返すcanonical Idealに合わせた:
Bonus laneは現在のGogma Counterから結果位置まで毎位置Reset（一部はKeepで終わる）、
Skill laneは現在のSkill Counterから毎位置Reset Skills。全Routeが同じCounterから始まり、
途中のResetは `canSkipWhenCounterPassed`。conflictは式に任せ、手置きしていない。

| workload | 内容 | 用途 |
|---|---|---|
| `sanity-3` | 3 Target、短いRoute、既定boundsで `completed` | parity / 整合性test |
| `representative-12` | 代表Route生成器で12 Target、`1000 / 20000 / 50` | overhead比較、短時間計測 |
| `representative-35` | 35 Target、`1000 / 200000 / 50`（#103 baselineと同じ設定） | 大規模代表計測 |

`representative-35` の内訳: 所持Gogma 30件（mixed / reset_bonuses / reset_skills）と
新規Normal 5件（forge 1〜3本）。Bonus lane長は0〜232、Skill lane長は0〜155、
短いRouteが多く一部が数百操作になる二乗分布。Planner初期conflictは12件
（`same_gogma_counter` 6 / `same_skill_counter` 6）。
**これは実ユーザーの35件ではない**。実データは第12節の手順でユーザー側の再実行が必要。

## 5. 実測環境

- Windows 11、AMD Ryzen 7 9700X（8C/16T）、RAM 31 GB
- **Browser**: 実Chrome **153**（`HeadlessChrome/153.0.0.0`、専用profile、
  `visibilityState = visible`）。`vite.benchmark.config.ts` のproduction bundleを
  `vite preview` で配信し、benchmark専用Worker（`plannerSearchInstrumentation.worker.benchmark.entry.ts`、
  unmodified `ProductionRngEngine`）で `runPlannerBeamSearch()` を実行。CDPは起動と
  `issue103Benchmark.run()` 呼出しだけに使用
- **Node**: v24.19.0 / Vitest（jsdom）。構造計測（diagnostic projection込み）と
  overhead比較の補助。**Nodeの時間はBrowser実測ではない**
- Claude desktopの内蔵browser paneは非表示時にpageとWorkerが凍結され、時間が不正確に
  なったため計測に使っていない
- 35件のBrowser full runとNode full runは同時に走らせたため、両者の時間は相互に負荷の
  影響を受けている。構造値（件数）はdeterministicで、両者のdigestは完全一致した

## 6. 結果: representative-35（`1000 / 200000 / 50`）

### 6.1 概要

| 項目 | 値 |
|---|---|
| termination | `incomplete`（`max_expanded_states`） |
| 完成Target | **13 / 35** |
| depth数 | 159（best stateのtrace長138、kept beamの最長trace 159） |
| Browser Worker elapsed | 1,510,468 ms（約25.2分、instrumentation ON、projection OFF） |
| Node elapsed（projection ON、並行負荷あり） | 2,679,474 ms |
| expanded beam states（Σ） | 7,837 |
| generated successors | 200,000（base 39,160 / bonus 90,387 / skill 69,860 / reserve 593） |
| successors per expanded state | **25.52** |
| 1 depthあたりsuccessor | 平均1,258、最大2,050、136 depthで900以上 |
| semantic dedup | **0.0%**（200,000 → 200,000） |
| beam trim | 96.0%（200,000 → 7,911） |
| trace-free projection merge | 69.0% |
| progress projection merge | **99.1%** |

### 6.2 代表depth（Browser）

| Depth | Beam In | Expanded | Generated (B/Bo/S/R) | Dedup After | Beam After | Best / Worst Complete | Max Complete pre-trim | Trimmed above kept | Conflicts on expanded | Shared | FF units (Bo/S) | Cum. expanded |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1 | 1 | 11 (5/3/3/0) | 11 | 11 | 0 / 0 | 0 | 0 | 4 | 0 | 84/60 | 11 |
| 1 | 11 | 11 | 113 (55/28/27/3) | 113 | 50 | 1 / 0 | 1 | 0 | 44 | 0 | 780/583 | 124 |
| 2 | 50 | 50 | 524 (250/149/110/15) | 524 | 50 | 1 / 0 | 1 | 0 | 196 | 0 | 3941/2440 | 648 |
| 3 | 50 | 50 | 619 (246/288/74/11) | 619 | 50 | 2 / 1 | 2 | 0 | 190 | 0 | 7592/1596 | 1267 |
| 7 | 50 | 50 | 1400 (250/1050/50/50) | 1400 | 50 | 3 / 3 | 3 | 0 | 150 | 0 | 26250/1050 | 4529 |
| 14 | 50 | 50 | 1250 (250/900/50/50) | 1250 | 50 | 4 / 4 | 4 | 0 | 100 | 0 | 19800/1050 | 9879 |
| 17（最大幅） | 50 | 50 | 2050 (250/900/900/0) | 2050 | 50 | 4 / 4 | 4 | 0 | 100 | 0 | 19800/17100 | 14329 |
| 42 | 50 | 50 | 1850 (250/900/650/50) | 1850 | 50 | 5 / 5 | 5 | 0 | 100 | 0 | 18000/9100 | 57629 |
| 58 | 50 | 50 | 1700 (250/800/600/50) | 1700 | 50 | 6 / 6 | 6 | 0 | 100 | 0 | 14400/7800 | 82629 |
| 70 | 50 | 50 | 1600 (250/700/600/50) | 1600 | 50 | 7 / 7 | 7 | 0 | 100 | 0 | 11200/7800 | 99879 |
| 76 | 50 | 50 | 1550 (250/650/600/50) | 1550 | 50 | 8 / 8 | 8 | 0 | 100 | 0 | 9750/7800 | 108529 |
| 80 | 50 | 50 | 1269 (250/650/340/29) | 1269 | 50 | 9 / 8 | 9 | 0 | 100 | 0 | 9750/4101 | 113979 |
| 94 | 50 | 50 | 1400 (250/550/550/50) | 1400 | 50 | 10 / 10 | 10 | 0 | 100 | 0 | 7150/6600 | 132750 |
| 99 | 50 | 50 | 1350 (250/550/500/50) | 1350 | 50 | 11 / 11 | 11 | 0 | 100 | 0 | 7150/5500 | 139000 |
| 121 | 50 | 50 | 1200 (250/450/450/50) | 1200 | 50 | 12 / 12 | 12 | 0 | 100 | 0 | 4950/4500 | 164600 |
| 137（plateau開始） | 50 | 50 | 1050 (250/400/350/50) | 1050 | 50 | 13 / 13 | 13 | 0 | 100 | 0 | 4000/2800 | 180850 |
| 158（停止） | 50 | 25 | 450 (125/200/125/0) | 450 | 50 | 13 / 13 | 13 | 0 | 50 | 0 | 2000/750 | 200000 |

最終depth 158は `max_expanded_states` で停止し、beam 50件中25件だけ展開された。

### 6.3 semantic dedupとprojection（Node、同一入力・同一digest）

| Depth | Before dedup | Semantic unique | Trace-free unique | Progress unique | Kept beam distinct progress |
|---|---|---|---|---|---|
| 0 | 11 | 11 | 11 | 11 | 11 |
| 1 | 113 | 113 | 64 | 64 | 29 |
| 2 | 524 | 524 | 244 | 160 | 31 |
| 3 | 619 | 619 | 261 | 156 | 19 |
| 7 | 1400 | 1400 | 356 | 8 | 1 |
| 14 | 1250 | 1250 | 369 | 8 | 1 |
| 17 | 2050 | 2050 | 617 | 7 | 1 |
| 42 | 1850 | 1850 | 629 | 8 | 1 |
| 58 | 1700 | 1700 | 566 | 8 | 1 |
| 70 | 1600 | 1600 | 511 | 8 | 1 |
| 76 | 1550 | 1550 | 526 | 8 | 1 |
| 80 | 1269 | 1269 | 372 | 14 | 2 |
| 94 | 1400 | 1400 | 420 | 8 | 1 |
| 99 | 1350 | 1350 | 459 | 8 | 1 |
| 121 | 1200 | 1200 | 366 | 8 | 1 |
| 137 | 1050 | 1050 | 303 | 8 | 1 |
| 158 | 450 | 450 | 156 | 7 | 1 |

### 6.4 completed Target推移

`firstDepthByCompletedTargetCount`: 1→depth 1、2→3、3→7、4→14、5→42、6→58、7→70、8→76、
9→80、10→94、11→99、12→121、13→137。以後depth 158まで（22 depth / 20,200 successor）13のまま
停止した。

- 全159 depthで `trimmedStatesAboveKeptBest = 0`（trimで落ちたstateがkept beamより多くの
  Targetを完成させていたdepthはない）。`maxCompletedTargetCountBeforeTrim` は常にkept bestと一致
- depth 7以降の152 depth中150でkept beam 50件のevaluationScoreが全て同値。
  全159 depth中116で、trimで落ちた最良scoreがkept最低scoreと同値だった。
  つまり多くのdepthでtrim境界はscoreではなく同点時のtie-break
  （preferred source → improvement preference → weapon switch → semantic key文字列）で決まっている
- kept beamの完了数分布は大半のdepthで単一値（例: depth 158は13が50件）

### 6.5 conflict

| Conflict kind | unique（resultの `conflicts`） | 展開state上の検出（Σ） |
|---|---|---|
| `same_gogma_counter` | 6 | 8,600 |
| `same_skill_counter` | 6 | 7,837 |
| `same_normal_counter` | 0 | 0 |
| `same_owned_weapon_consumed` | 0 | 0 |

展開した1 beam stateあたりの検出conflictは2〜4件（depth 1以降）。conflict resolutionは
未指定なので `conflictBlockedUnits = 0`。

### 6.6 Entry / lane上位（successor生成数）

| Entry | Route | Units (B/Bo/S) | Base | Bonus | Skill | Reserve | Total | Rejected |
|---|---|---|---|---|---|---|---|---|
| build-list.fnv1a32-b5852df8 | existing_gogma_mixed | 0/182/89 | 0 | 6778 | 6425 | 0 | 13203 | 0 |
| build-list.fnv1a32-1b6e3c59 | existing_gogma_mixed | 0/218/41 | 0 | 6778 | 5750 | 0 | 12528 | 0 |
| build-list.fnv1a32-751c1fd3 | existing_gogma_mixed | 0/169/36 | 0 | 6778 | 5150 | 0 | 11928 | 0 |
| build-list.fnv1a32-03bb452a | existing_gogma_mixed | 0/127/32 | 0 | 6778 | 5000 | 0 | 11778 | 0 |
| build-list.fnv1a32-279746e8 | existing_gogma_mixed | 0/73/137 | 0 | 4503 | 6425 | 0 | 10928 | 0 |
| build-list.fnv1a32-9cf49b83 | existing_gogma_mixed | 0/89/28 | 0 | 5753 | 4350 | 50 | 10153 | 0 |
| build-list.fnv1a32-a2fdedc9 | existing_gogma_mixed | 0/40/63 | 0 | 2503 | 6425 | 0 | 8928 | 0 |
| build-list.fnv1a32-5496975d | normal_artian_to_gogma | 3/106/0 | 7837 | 0 | 0 | 0 | 7837 | 0 |
| build-list.fnv1a32-99b3e4d2 | normal_artian_to_gogma | 3/97/75 | 7837 | 0 | 0 | 0 | 7837 | 0 |
| build-list.fnv1a32-a9ef4119 | normal_artian_to_gogma | 4/232/0 | 7837 | 0 | 0 | 0 | 7837 | 0 |

- 上位10 Entryで51.5%。Entryごとの合計は38〜13,203で、長いRouteを持つ未完了Entryの
  ほぼ全てが毎depth・全beam stateでsuccessorを出している（特定の1〜2 Entryへの集中ではない）
- base lane successor 39,160件（19.6%）は全て新規Normal 5 Entryのforge unit。
  新規Normal 5 EntryはいずれもTarget完成に至らず、うち3 Entryはrejection 0
  （conversionまで一度も到達しなかった）、2 Entryはconversion到達後に
  `counter_before_current` で拒否された（19件 / 6件）
- `counter_before_current` 38,488回（唯一のrejection reason）は主に5 Entryに集中
  （各約7,200〜7,800回）。初期位置のrequired unitが既に通過されたRouteが、以後の展開
  stateでも毎回試行されている

### 6.7 shared physical actionとfast-forward

- shareable primary試行 198,710件、しかし **2 Entry以上を同時に進めたsuccessorは0件**。
  本fixtureでは各Entryが別々の所持Gogmaを使うため、physical action keyが一致しない
- silent fast-forward: bonus 1,535,244 unit / skill 871,367 unit、(successor, Entry) 2,406,611組。
  1 successorあたり平均約12 unitが他Entryの実操作に伴い通過扱いになっている
- required unit支配によるskippable unit非生成: 38,224件（平均約240 / depth）

### 6.8 時間の内訳（Browser、`phaseMs` 合計）

| phase | ms | 比率 |
|---|---|---|
| `dedupAndTrim`（semantic key、comparator sort、slice） | 1,055,578 | 69.9% |
| `applyAction`（successor構築、state clone含む） | 384,579 | 25.5% |
| `successorEvaluation`（conflict検出、score） | 48,609 | 3.2% |
| `beamStateSetup` | 3,228 | 0.2% |

1 successorあたりの `dedupAndTrim` はdepth 10で約1.5 ms、depth 50以降約5.3〜5.8 ms、
`applyAction` はdepth 10の約0.5 msからdepth 150の約3.5 msへtrace長とともに増えた。

## 7. 結果: representative-12（`1000 / 20000 / 50`）

`termination incomplete`、completed 2 / 12、32 depth。semantic dedup 0.0%、trace-free merge 61.8%、
progress merge 98.7%。kept beamのdistinct progressは代表depthで 4 → 8 → 6 → 5 → 2（depth 0〜4）、
depth 29で1、depth 31で2。
Node phase合計: dedupAndTrim 38,871 ms / applyAction 12,417 ms / successorEvaluation 4,297 ms /
beamStateSetup 442 ms（計57.2秒中）。

## 8. Observer overhead

同一入力・同一boundsで結果digest（termination、expandedStates、completed、conflict ID列、
rejection hash、warning、best stateのtrace長・semantic key hash・score）は全モードで完全一致。

| 環境 | OFF | ON | ON + projection |
|---|---|---|---|
| Browser（representative-12、20k、各1回） | 39,724 ms | 40,554 ms（+2.1%） | 42,066 ms（+5.9%） |
| Node（representative-12、20k、各1回） | 57,203 ms | 57,400 ms（+0.3%） | 63,947 ms（+11.8%） |

各1回で、Browser計測時はNode full runが並行していたため誤差を含む。projectionは全successorを
追加で2回直列化するためopt-inにしている。

## 9. テスト

`src/benchmarks/plannerSearchInstrumentation.test.ts`:

- instrumentationなし / あり（projection・clock込み）で `runPlannerBeamSearch()` の結果全体
  （bestState、completed、termination、expandedStates、conflicts、rejections、warnings）が
  `toEqual` で一致: `completed` / `max_expanded_states` 打切り / `max_plan_steps` / cancel
- cancel: 同じ呼出回数でcancelし、両者とも `cancelled`、最終depthは `stoppedBy = cancelled`
- depth整合性: `semanticDuplicatesRemoved = before - after`、`statesAfterBeamTrim <= beamWidth`、
  lane合計 = generated、beam state内訳の合計 = beam input、完了数 ≤ planning Target数、
  projection unique数の単調性、Σ generated = `expandedStates`
- run totals とdepth / Entry / resultの一致、Beam Searchへ到達しないinput

`src/benchmarks/plannerSearchInstrumentationBrowserBenchmark.test.ts`: benchmark Worker
controllerのdepth streamと結果、未知workload、Export JSONからのin-memory PlannerInput構築。

## 10. 観測事実

1. **semantic dedupは何も除去していない**（200,000 → 200,000、全depthで0%）。既存semantic keyは
   trace projectionを含むため、実行順やどのEntryが実行したかが異なるsuccessorは常に別stateになる
2. **successorの大半は進捗として同じ状態に合流する**。progress projectionでは99.1%が合流し、
   depth 7以降のkept beam 50件は（depth 80の2を除き）distinct progressが1だった。
   trace以外のsemantic field（source mutation version等）まで含めたtrace-free projectionでも
   69.0%が合流する
3. **1 depthのsuccessor数は「未完了で実行可能なEntry-lane数 × beam 50」でほぼ決まる**。
   平均1,258、最大2,050 / depth、successors per expanded state 25.52。200,000は159 depthで
   尽き、各depthでtraceは1 action伸びる
4. **completed Target数はdepthにほぼ比例して増え、plateauは予算切れ直前**。13への到達はdepth 137で、
   以後22 depthは停止まで13。trimで完了数の多いstateが落ちたdepthは0
5. **trim境界はscore同点のtie-breakで決まることが多い**（depth 7以降の150 / 152 depthで
   kept beam全件が同score）
6. **conflictは少ない**（unique 12件、展開stateあたり2〜4件）。それでも毎depth約1,000〜2,000
   successorが生成されており、successor数はconflict数ではなく実行可能Entry-lane数に比例している
7. **branchは特定Entryに偏っていない**。長いRouteを持つ未完了Entryがほぼ均等に毎depth出す
8. **shared physical actionは0件、fast-forwardは大量**（1 successorあたり約12 unit）
9. **時間の約70%はdedup + sortの直列化、約26%はsuccessor構築**で、どちらもtrace長とともに
   1 successorあたりの費用が増える
10. 新規Normal 5 Entryのbase lane successorが毎depth 250件（19.6%）生成され続けたが、どれも
    Target完成に至らなかった

## 11. 次フェーズの設計候補（提案。未実装）

以下は計測値からの示唆であり、原因の断定ではない。いずれもPlanner semanticsの変更を伴うため、
仕様判断後に別PRで扱う。

| 優先 | 候補 | 根拠となるmetric | 注意点 |
|---|---|---|---|
| 1 | **A / E. 等価な順序branchの生成前抑制、またはdedup identityの見直し** | semantic dedup 0%、progress merge 99.1%、kept beam distinct progress 1 | progress projectionは有効なkeyではない。どのweaponを実際に操作したか（source mutation version、weapon switch、preferred source、improvement preference）が将来の実行可能性とPlan品質に影響しないことを証明してから採用する |
| 2 | **B. deterministic scheduling（conflictの無い部分）** | conflict unique 12、shared 0、完了数がdepthに比例、1 depthの予算消費が約1,258 | 本fixtureでは全Targetに少なくともGogma約232 + Skill約155の物理操作が必要で、beam 50のまま全depthを進めるには単純計算で数十万successorが要る（推定であり実測ではない） |
| 3 | **G. 1 stateあたりの費用削減** | `dedupAndTrim` 69.9%、`applyAction` 25.5%、trace長とともに増加 | semantic keyのtrace直列化・comparator内の再計算・state clone。探索構造とは独立に効くが、semantic keyを変えるならEと一体で扱う |
| 4 | C. conflict / dependency component分割 | conflictは一部Entryのみ、展開stateあたり2〜4件 | 1・2の後に、残る探索を局所化する手段として |
| 5 | D. scoring / beam trim改善 | trimで完了数の多いstateが落ちた例は0。ただしtrim境界は同点tie-breakが大半 | scoring変更単独の根拠は弱い。tie-breakが等価branchで埋まる問題はA/E側 |
| 6 | F. shared action / fast-forward強化 | shared 0は別weaponのため当然、fast-forwardは既に大量に効いている | 本計測からは優先度低 |
| - | G'. 到達不能になったRouteの試行抑制 | `counter_before_current` 38,488回が5 Entryに集中、新規Normal base lane 19.6% | 小さい改善候補。relevance判定の変更はsemanticsに触れる |

## 12. 実データでの再実行（ユーザー側で必要）

35件の実データは本Repositoryに含めていない。ユーザーの環境で以下を実行する。
Export JSONは貼り付けたページのメモリ上でだけ検証・変換され、IndexedDBへは保存されない。

```bash
npx vite build --config vite.benchmark.config.ts
npx vite preview --config vite.benchmark.config.ts
```

1. アプリの設定画面からExportしたJSONを用意する
2. `http://localhost:4173/GogmaArtianPlanner/benchmark.html` を開き（portはpreviewの表示に従う）、
   「Issue 103 Planner Search」を選ぶ
3. Sourceを「Export JSON（貼り付け）」にしてJSONを貼り付け、`1000 / 200000 / 50` でRun
4. **計測中はタブを前面・表示状態に保つ**（非表示のpageは凍結され時間が不正確になる）
5. 表示されたreportとRaw result JSONを保存する。diagnostic projectionを付けると約6%遅くなる

Node補助runner（Browser実測ではない）:

```bash
PLANNER_SEARCH_INSTRUMENTATION_WORKLOAD=representative-35 PLANNER_SEARCH_INSTRUMENTATION_PROJECTIONS=1 PLANNER_SEARCH_INSTRUMENTATION_OUT=report.txt npx vitest run src/benchmarks/plannerSearchInstrumentation.node.test.ts
```

## 13. 今回変更していないもの

Beam Searchの展開・scoring・comparator・semantic key・beamWidth・停止条件・
`expandedStates` の定義、PlannerOptions default、Candidate Search、Candidate / BuildListEntry /
checkpoint / conflict resolution / constrained search / what-if semantics、Execution、
Persistence、schema / migration、Production UI、RNG。
