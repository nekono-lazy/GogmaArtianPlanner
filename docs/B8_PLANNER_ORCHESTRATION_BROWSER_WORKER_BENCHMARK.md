# B8-E Planner Orchestration Browser Worker Benchmark

作成日: 2026-09-08

## Status

```text
Harness implementation:                    complete   (B8-E1)
Real Browser measurements:                 pending    (B8-E2)
Production PlannerOrchestrationBounds default: NOT DECIDED
```

- B8-E1 harness / Production-valid workload実装: 完了
- 実Browser計測: 未実施
- `PlannerOrchestrationBounds` のProduction default: **未決定**
- `generatedBuildListEntries.length >= 2` のworkload:
  **not observed in B8-E1 Production-valid investigation / not a blocker for B8-E2**（7.5）

B8-E1は次を変更していない。

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings
defaultPlannerOptions
```

Production側のファイル変更は**ゼロ**である。B8-E1が追加したのは
`src/benchmarks/` の3ファイル、`src/pages/PlannerOrchestrationBenchmarkPage.tsx`、
そのテスト、および `src/pages/BenchmarkApp.tsx` への4つ目のタブだけである。
`plannerOrchestrationBounds.ts` へdefaultを追加しておらず、
`planner.worker.production.ts` も変更していない。
`PlannerOrchestrationBounds` はcaller必須指定のままである。

この文書は計測手順とworkload定義の記録であり、仕様authorityではない。
仕様authorityは [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.6-9.2.16 / 15.9.1 と
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7 である。

> **B8-E1の時点で性能値は1つも存在しない。**
> 開発中のNode/Vitest実行時間はfixture correctnessの副産物であり、
> Production default判断の根拠にしない。数値はB8-E2で実Browserから取得する。

---

## 1. 目的

`PlannerOrchestrationBounds` の3つのboundsについて、Production defaultを決めるための
実測基盤を用意する。

```ts
interface PlannerOrchestrationBounds {
  maxCandidateTrialsPerConflict: number
  maxGeneratedBuildListEntries: number
  maxPlannerReruns: number
}
```

PLANNER_SPEC 9.2.16のとおり、これらのコストはB8-C / B8-Dのorchestration実装が
存在しなければ測定できない。したがってB8-B2のenumerator benchmarkではdefaultを
決めず、B8-Eで別途決定する。B8-E1はその測定基盤とworkloadだけを実装し、
**測定値からdefaultを決めることは行わない**。

---

## 2. 計測対象のProduction経路

benchmark専用のPlanner Workerやbenchmark専用のPlanner algorithmは作っていない。
timing pathは実Productionの経路そのものである。

```text
Browser main thread
  → createProductionPlannerWorkerClient()        src/services/planner/plannerWorkerClient.ts
  → client.createConstrainedPlan(requestId, plannerInput, orchestrationBounds)
  → 実Worker                                     src/workers/planner.worker.entry.ts
  → Production Worker controller                 src/workers/planner.worker.ts
  → Production adapter                           src/workers/planner.worker.production.ts
      ├ createProductionPlannerWorkerDependencies()  → ProductionRngEngine
      └ createProductionConstrainedPlan()
          └ defaultConstrainedEnumerationBounds      (40 / 30 / 100 / 500)
  → createProductionPlanWithConstrainedSearch()  B8-C4b orchestration
      → visitConstrainedCandidates()             B8-B1 enumerator
      → createConstrainedMaterializer()          B8-C2
      → preparePlannerAugmentedConflictPreflight() B8-C3
      → createProductionPlanWithObserver()       Beam Search / Trace Replay
  → PlannerOrchestrationResult の structured clone
  → Browser main thread
```

意図的に行っていないこと。

- FakeRngEngineでの性能測定
- Fake Planner計算での性能測定
- `createProductionPlanWithConstrainedSearch()` をmain threadから直接呼ぶ測定
- benchmark専用の簡易Planner algorithm
- Planner / Beam / Searchの複製

### ConstrainedEnumerationBounds を渡さない

benchmark requestは `ConstrainedEnumerationBounds` を含まない。B8-B2で決まった
`defaultConstrainedEnumerationBounds`（40 / 30 / 100 / 500）は、Production adapterが
Worker境界の内側で供給する。benchmarkからこれを渡すとProduction adapterを迂回した
経路を測ることになるため、渡さない。B8-B2の値をbenchmark側へ複写もしていない。

---

## 3. Harness構成

C5-E2C8の `benchmark.html` / `src/benchmark.tsx` / `vite.benchmark.config.ts` を
そのまま再利用し、`src/pages/BenchmarkApp.tsx` へ4つ目のbenchmarkとして追加した。
既定選択はC5-E2C8のままで、既存3 benchmarkの入力・手順・Worker policy・
global APIは変更していない。通常アプリケーションからはどれにも到達できない。

| ファイル | 役割 |
| --- | --- |
| `src/benchmarks/plannerOrchestrationBenchmarkFixtures.ts` | Production-valid workloadと `PlannerInput` 生成、benchmark専用sweep定数 |
| `src/benchmarks/plannerOrchestrationBenchmarkOutcome.ts` | benchmark専用のoutcome正規化とdigest |
| `src/benchmarks/plannerOrchestrationBrowserBenchmark.ts` | 1 runのharness（fresh Client生成 → 計測 → dispose → digest） |
| `src/pages/PlannerOrchestrationBenchmarkPage.tsx` | 計測UIと `globalThis.b8PlannerBenchmark` |

`globalThis.b8Benchmark`（B8-B2 constrained enumeration用）は変更していない。
B8-E用は別名 `globalThis.b8PlannerBenchmark` である。

### global benchmark API

```text
b8PlannerBenchmark.workloads()
b8PlannerBenchmark.fixture(workloadId)
b8PlannerBenchmark.run({ workloadId, phase, orchestrationBounds })
b8PlannerBenchmark.runMeasurements(workloadId, orchestrationBounds, count)
b8PlannerBenchmark.records()
b8PlannerBenchmark.clear()
b8PlannerBenchmark.sweep
b8PlannerBenchmark.environment
```

`runMeasurements()` は **warm-up 1回 + measurement N回** を明示的に実行する。
UIの既定Nは3である。B8-E2でdefault finalist tupleだけ5 measurementを行う。

Cartesianの全自動実行は用意していない。ユーザーがworkloadとbounds tupleを選ぶか、
`runMeasurements()` を明示的に呼ぶ。

---

## 4. Timing boundary

1 runの手順は次で固定する。

```text
1. PlannerInput fixture生成                       計測外
2. PlannerOrchestrationBounds validation           計測外
3. Production Planner Worker Client生成            計測外
4. performance.now()                               ← 計測開始
5. client.createConstrainedPlan(...)
6. Promise settle
7. performance.now()                               ← 計測終了
8. Client dispose                                  計測外
9. benchmark-only outcome digest生成               計測外
```

`roundTripMs` に**含まない**もの。

```text
fixture生成
bounds validation
Worker Client生成（new Worker(...) constructorを含む）
dispose
outcome digest生成（instrumentation）
```

`roundTripMs` に**含む**もの。

```text
createConstrainedPlan() call
request postMessage と PlannerInput の structured clone
最初のrequestを処理できるようになるまで残っている Worker async initialization 待ち
Production Planner orchestration計算
PlannerOrchestrationResult の structured clone と delivery
```

`new Worker(...)` constructorは計測開始前に実行されるため、これは
**「Worker startup全体を含む」ではない**。計測に入るのは、requestをpostした時点で
まだ完了していないWorker初期化の残り、すなわち呼び出し側が実際に待つ部分だけである。

B8-D2bの `BuildListPage` も、Planning開始前からWorker Clientを保持する設計である。
したがってこの境界がProductionの越える境界と一致する。

### 性能値を補正しない

Production default判断の主値は `roundTripMs` の実測値そのものとする。次を行わない。

```text
ordinary baseline を差し引いた推定Planner時間を主根拠にする
Worker startup推定値を引く
structured clone推定値を引く
instrumentation overheadを推定して引く
```

workload A（ordinary baseline）は相対比較のためのものであり、
他workloadから差し引くための補正値ではない。B8-E2の記録には必ずraw measured
latencyを残す。

---

## 5. Fresh Worker policy

B8-B2と同様、次を守る。

```text
1 run = 1 fresh Production Planner Worker Client / Worker
```

harnessは `run()` の内側でClientを生成し、計測終了後に `dispose()` する。
warm-upもmeasurementも毎回新しいWorkerで実行する。

warm-upの目的はBrowser / JIT / module cache側の安定化であり、
同一Workerの状態をmeasurementへ持ち越すためではない。したがって、requestをpostした
時点でまだ完了していないWorker初期化の残りはrun間で償却されず、常に
`roundTripMs` に含まれる（`new Worker(...)` constructor自体は4章のとおり計測外）。

---

## 6. benchmark-only result normalization

Production runtimeの `PlannerIdFactory` と `PlannerClock` はrunごとに異なる値を返す。
PLANNER_SPEC 15.9.1のとおり、次はrun間の一致を要求しない。

```text
ProductionPlan.id
PlanStep.id
runtime生成 OwnedWeapon ID（reserve_weapon / create_material_gogma）
createdAt / updatedAt
ExpectedPlanState の hash 値
```

そこで `createPlannerOrchestrationOutcome()` がbenchmark専用のoutcome digestを作る。
含めるのは次の意味的な結果である。

```text
plan === null
planStepCount
selectedBuildListEntryIds       （sorted）
generated BuildListEntry IDs    （sorted）
warning kinds                   （sorted）
PlanStep:
  order / operationType / buildListEntryId / candidateId
  ownedWeaponId（入力在庫のIDはそのまま、runtime生成IDは <runtime-owned-weapon>）
  rngAdvance / expectedResult / requiresUserConfirmation
Conflict:
  kind / participant BuildListEntry IDs / selectedBuildListEntryId
rejectedBuildListEntries
requiredMaterials
```

PlanStep列は順序を保持する（PLANNER_SPEC 15.9.1が順序の一致を要求するため）。
順序を持たない集合はsortしてから畳み込み、偶発的な並び差を意味差として扱わない。

このnormalizerは**benchmark parity専用**である。`src/domain` からは参照されず、
Domain semantic authorityとしてexportしない。digest生成はtiming終了後に行うため、
`roundTripMs` には含まれない。

同一workload・同一 `PlannerOrchestrationBounds` のmeasurement間で
`outcomeKey` が一致することを確認できる。

---

## 7. Production-valid workload

`src/benchmarks/plannerOrchestrationBenchmarkFixtures.ts` が生成する。

### 7.1 共通のProduction入力

B8-B2 / B5と同じ定数を再利用する（`constrainedEnumerationBenchmarkFixtures.ts` から
import。B8-B2 workloadの意味は変更していない）。

| 項目 | 値 |
| --- | --- |
| Base Seed | 51231782（C5-E2C9 live read、source `observation`） |
| Skill Counter | 341（source `observation`） |
| Gogma Counter | 200（source `manual`、実ゲーム観測ではない） |
| Normal Artian counter | 0（weapon typeごと、rarity 8） |
| Counter Gate | null / unconfirmed |

Engineは常に無改造の `ProductionRngEngine` である。**FakeRngEngineは使用していない。**

### 7.2 fixture構築の順序

Candidate結果を手で推測していない。次のDomain authorityだけで構築する。

1. `ProductionRngEngine.predictGogmaBonus` / `predictSkills` / `predictNormalArtian`
   がsource weaponの5枠・Skillと、各BuildListEntryのRoute結果を与える
2. `createCandidateFromPrediction()`（通常Search DomainのCandidate authority）が
   category判定・estimate・material・`searchStateHash` /
   `referencedOwnedWeaponsHash` 生成・`validateBuildCandidate()` を行う。
   Ideal/Practicalのどちらも満たさない結果は `null` になり、fixture生成が
   例外で失敗する（結果に合わせてsnapshotを後からpatchすることはしない）
3. `createBuildListEntry()` が通常の永続Entry形状を作る。したがって全Entryは
   Plannerが受け取るstateに対してnon-staleである
4. `preparePlannerInitialContext()`（既存Planner initial conflict authority）が
   実際の初期 `PlanConflict` を返し、その安定keyから
   `PlannerConflictResolution` を作る

`conflictKey` を人手で推測していない。`recommendedBuildListEntryId` や
Beam bestStateのparticipantを固定側のauthorityにしていない。

固定側の選び方は「そのConflictのparticipantのうちBuildListEntry IDが
辞書順最小のもの」である。これはworkloadを再現可能にするためのfixture上の選択であり、
Planner authorityではなく、Productionでユーザー選択の代わりになるものでもない。

### 7.3 Target flavor

| flavor | Practical条件 | source weaponの状態 | 必要な操作 |
| --- | --- | --- | --- |
| `bonus` | `bonus_type.attack` を1枠以上（最低rank `base`）、Skill無制約 | 5枠に `bonus_type.attack` を含まない遠方Reset結果 | Bonus amendment、または conversion（Normal scopeの5枠がattackを含む） |
| `skill` | 上記に加えて、開始Skill Counterで出るSeries Skill | 5枠は `bonus_type.attack` を含み、Series Skillは異なる | Skill操作 |

Idealは全workloadで到達不能に固定する。

- `idealBonuses` = `bonus_type.attack` / `bonus_rank.i` ×5
  （reference Gogma Reset候補プールに存在せず、Normal枠は常に `bonus_rank.base`）
- `idealSkillCondition` の Group Skill = `group_skill.verified_14`
  （Masterでは有効だがreference Group Skill poolに無く、`predictSkills` が返さない）

これはB8-B2 fixtureが使っているのと同じreference上の事実である。到達不能なIdealに
することで、どのTargetもplanningから脱落せず、SEARCH_SPEC 5.6.1のstream無効化も
起きない。

Ideal ⇒ Practical containmentは構造上成立し、`validateTargetIdealImpliesPractical()`
をfixture生成時に必ず通す。

source weaponがそのTargetのPractical条件を既に満たさないことも、
`satisfiesPracticalTarget()` でテスト側から検証している（満たしてしまうと
Targetがplanningから外れ、conflictも再検索も起きなくなるため）。

### 7.4 workload一覧

| id | group | Target数 | 構造 |
| --- | --- | ---: | --- |
| `orchestration_ordinary_baseline` | A. baseline | 2 | 互いに素なstreamの2 Route。conflictなし、explicit resolutionなし |
| `orchestration_single_conflict_early_adoption` | B. early adoption | 2 | `same_gogma_counter` 1件（participant 2）。固定側以外がconversionで解消 |
| `orchestration_trial_and_rerun_pressure` | C. trial pressure | 3 | `same_gogma_counter` 1件（participant 3）。work 2件が1つのtrial budgetを共有 |
| `orchestration_generated_entry_cap` | D. generated cap | 4 | `same_gogma_counter` 1件（participant 4）。work 3件 |
| `orchestration_combined_multi_target` | E. combined | 5 | `same_gogma_counter`（participant 3）と `same_skill_counter`（participant 2）。weapon type 2種、explicit resolution 2件 |

#### A. ordinary baseline

bow/fire は開始Gogma CounterでReset Bonuses、bow/water はNormal 1本鍛造 +
conversion。触るstreamが互いに素なのでconflictが1件も検出されず、explicit
resolutionも無い。PLANNER_SPEC 9.2.7のとおり、明示resolutionが無ければconstrained
re-searchは実行されないため、`createConstrainedPlan()` は初回のordinary Planner
runだけを行って終了する。enumeration / materialization / preflight / rerunは発生せず、
B8 orchestration warningも出ない。Planner 1回のend-to-end baselineである。

#### B. one counter conflict / early adoption

2つのTargetがそれぞれ自分のsourceで開始Gogma CounterのReset Bonusesを要求するため、
`same_gogma_counter` にparticipant 2件のconflictが1件だけできる。固定側がその位置を
保持し、譲る側のconstrained re-searchが conversion Candidate に到達する。conversionの
Normal scope 5枠は `bonus_type.attack` を含むのでPracticalを満たし、Normal / Skill
位置は固定側が触っていない。最終Planは固定Entryとgenerated Entryの両方をselectする。

#### C. trial / rerun pressure

1つのconflictにparticipantが3件あるため、固定側を除くと2つのworkが1つの
`maxCandidateTrialsPerConflict` budgetを共有する（PLANNER_SPEC 9.2.16）。
1つ目のworkは却下trialを挟んでCandidateをadoptし、2つ目のworkは空いている共有stream
が残っていないためtrialを消費し続ける。preflightだけで落ちるtrialではなく、
実際にfull Beam Searchを走らせるtrialが含まれる。

#### D. generated-entry cap

participant 4件、work 3件。adoptできるgenerated Entryより多くのworkが残るため、
`maxGeneratedBuildListEntries = 1` で
`max_generated_build_list_entries_reached` を観測できる。

#### E. combined multi-target

Target 5件、weapon type 2種、conflict resource shape 2種
（`same_gogma_counter` と `same_skill_counter`）、explicit resolution 2件。
augmented preflightが「今回のworkの元になったconflictだけでなく、全explicit
resolutionを再対応付けする」経路（PLANNER_SPEC 9.2.3.1）を通る。
Production default判断の代表workloadである。

### 7.5 `generatedBuildListEntries.length >= 2` は未成立（B8-E1で確認できず）

workload要件「generous boundsで `generatedBuildListEntries.length >= 2`」は
**B8-E1のProduction-valid調査では確認できなかった**。Domain / Planner semanticsは
変更していない。

owner decisionにより、B8-E1のこの必須要件は免除され、**B8-E2をブロックしない**。

**「最大1件」をDomain invariantとして断定しない。** 以下はB8-E1で実際に試した
Production-valid構成と、実装authorityから観測した却下理由の調査記録である。
上限の一般証明ではなく、「現行のProduction-valid workloadでは2件adoptを確認できなかった」
という観測事実である。

#### 誤っていた初期記述の撤回

B8-E1の初版はここに「1 Counter位置 → 1 Route」を前提とした証明を書いていた。
これは現行Planner実装と一致しないため撤回する。
`plannerRouteProgress.ts` の `actionIdentity()` は次を **shareable** として扱う。

```text
reset_bonuses
keep_bonuses
sourceOwnedWeaponId != null の reset_skills
```

同一 `physicalActionKey` を持つunit同士は
`plannerConflictDetection.ts` の `allOneShareablePhysicalAction()` により
counter conflictにならない。したがって

```text
1 Counter position != 1 BuildListEntry
```

であり、初版の前提は誤りだった。

#### 試行1: 共有 `reset_skills` physical action

reviewer提案の構成を実Production予測だけで構築した（FakeRngEngine不使用、
predicted結果の手書きなし）。

```text
Target F  : bow / water、Practical = attack bonus、skill無制約
            source S_F（attack無し）→ reset_bonuses @ G0 で Practical
Target A  : bow / fire、Practical = attack bonus + S0 Series Skill
Target B  : bow / fire、Practical = 同上（A と同一条件、別Target）
            source S_A / S_B（attack無し、S0 Series Skillは所持）
            → それぞれ reset_bonuses @ G0 で Practical
共通source X: bow / fire、attack bonusを所持、Series Skillは S0 と異なる
            → reset_skills @ S0 で Practical
```

初期conflictは `same_gogma_counter`（participant 3件）1件。F を固定し、
work は A と B の2件。両方のconstrained enumerationが同一Routeを提示した。

```text
generated A: existing_gogma_reset_skills(owned.probe.x, 341 -> 342)
generated B: existing_gogma_reset_skills(owned.probe.x, 341 -> 342)
```

`createPlannerRouteUnitPlans()` による実測。

```text
unit A: shareable = true
        physicalActionKey = {"after":342,"before":341,
                             "sourceOwnedWeaponId":"owned.probe.x",
                             "type":"reset_skills"}
unit B: 同一key、shareable = true
両者の physicalActionKey は一致
```

`detectPlannerConflicts()` は両者間に `same_skill_counter` conflictを
**検出しなかった**（`allOneShareablePhysicalAction()` により正しく共有と判定）。
augmented preflightも `ready` になった。

つまり **counter conflictでもshareabilityでも却下されていない**。
実際、Beam Search traceでは1回の物理操作が両Entryを同時に進めている。

```text
reset_bonuses  primary=F            progressed=[F]
reserve_weapon primary=F            progressed=[F]
reset_skills   primary=generated-A  progressed=[generated-A, generated-B]
reserve_weapon primary=generated-A  progressed=[generated-A]
```

#### 2件目がselectedされない理由（authority上の位置）

`reserve_weapon` が `existing_gogma_*` に対して行うのは
「同一source Gogma IDのin-place更新」であり、共有physical actionから得られる
**物理武器は1本だけ**である。その1本を reserve した直後に
`refreshTargetSatisfaction()` が走り、同一 weaponType / element の Target は
すべて評価し直される。

```text
BEAM satisfaction:
  target.probe.a_fire  hasPractical = true
  target.probe.b_fire  hasPractical = true
```

その結果、2件目のEntryは `plannerEntryRelevance.ts` の
`entryIsRelevantForState()` で

```text
!satisfaction.hasIdeal && (!satisfaction.hasPractical || category === 'ideal')
```

を満たさなくなり（`hasPractical = true` かつ category は `practical`）、
Beam Searchの `targetCanUseEntry()` で除外されて `selectedBuildListEntryIds`
へ入らない。`rejections` にも現れない。単に relevance が消える。

```text
BEAM selected = [generated-A, F]
PLAN selected = [generated-A, F]
orchestration generatedBuildListEntries = 1
```

この経路は循環している。2件目が選択されるには、共有結果の武器が
2件目のTargetを満たしてはならない。しかし2件目のCandidateの結果は
その武器の内容そのものなので、満たさなければそもそもIdeal/Practicalの
どちらでもなく、enumeratorがyieldしない。

#### 試行2: 独立した2本のchain

共有ではなく物理武器2本を作る方向も検討した。起点から新しい巨戟武器を得る
chainは次のいずれかで、いずれも先頭操作が開始Counter位置に固定される。

```text
Gogma stream : 既存sourceへの reset_bonuses / keep_bonuses   → G0
Skill stream : 既存sourceへの reset_skills                    → S0
               conversion（create_normal_artian + convert）    → N0 と S0
```

異なるsourceのunitは `physicalActionKey` が異なるため共有されず、
同一Counter位置では counter precondition により1本しか実行できない。
`same_owned_weapon_consumed` conflictを固定側に使う案も検討したが、
Search / constrained enumeratorのどのroute emitterも
`use_weapon_as_material` を生成しないため、Production-validなfixtureでは作れない。

この方向はB8-E1では2件目のadoptに到達しなかった。ただし、上に書いたとおり
これを一般的な上限として断定はしない。

#### 行っていないこと

```text
Domain / Planner / conflict semanticsの変更
FakeRngEngineの使用
predicted bonus / skill結果の手書き
element違いconversionのshareable化
use_weapon_as_material の推測
```

#### 現状の workload D

`orchestration_generated_entry_cap` は、adoptできたgenerated Entryより多くのwork
を残す構成のままとし、`maxGeneratedBuildListEntries = 1` で
`max_generated_build_list_entries_reached` を観測できる形にしている。

#### B8-E2での扱い

これは「最大1件」の一般証明ではない。
`maxGeneratedBuildListEntries` の値を上げてもadopt成功件数が増えることは、
今回のworkloadでは期待しない。B8-E2では

```text
cap = 1 と larger cap のあいだで
  追加のCandidate trial / Planner rerunコスト
  warning kinds
  outcomeKey
がどう変わるか
```

を測定事実として記録する。`maxGeneratedBuildListEntries = 1 / 2 / 4` のうち
2以上が有用であるケースは今回未確認であり、この未確認事項はB8-E2をブロックしない。

---

## 8. benchmark-only bounds sweep

`BENCHMARK_ONLY_ORCHESTRATION_BOUNDS_SWEEP` は**measurement grid**であり、
Production defaultでもfallbackでもない。

```text
maxCandidateTrialsPerConflict : 1 / 2 / 4 / 8 / 16
maxGeneratedBuildListEntries  : 1 / 2 / 4
maxPlannerReruns              : 1 / 2 / 4 / 8 / 16 / 32
```

`BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS`（8 / 4 / 16）はUIの初期表示値にすぎない。
既存のtest fixtureが使っている `8 / 4 / 16` も同様にtest値であり、
どちらもProduction値への昇格候補ではない。

Production defaultへ昇格させないために、次を行っていない。

```text
defaultPlannerOrchestrationBounds の追加
Production fallback / clamp
CandidateSearchSettings からの導出
defaultConstrainedEnumerationBounds からの導出
```

危険な全Cartesian auto-runも用意していない。

---

## 9. 計測手順（B8-E2で実施する）

```bash
npx vite build --config vite.benchmark.config.ts
npx vite preview --config vite.benchmark.config.ts
```

1. `http://localhost:<port>/GogmaArtianPlanner/benchmark.html` を開く
2. `B8 Planner Orchestration` タブを選ぶ
3. workloadとbounds tupleを選び、`Warm-up + measurements` を実行する
4. `document.visibilityState` を記録する（B8-B2と同じ制約）
5. 同一workload・同一tupleのmeasurement間で `outcomeKey` が一致することを確認する
6. default finalist tupleだけ measurement 5回を実行する

記録する項目。

```text
workloadId
phase
orchestrationBounds
status
roundTripMs
planPresent / planStepCount
selectedBuildListEntryCount / generatedBuildListEntryCount
conflictCount
warningKinds
trialBoundReached / generatedBoundReached / rerunBoundReached / enumerationBoundReached
outcomeKey
engineVersion / hardwareConcurrency / userAgent / visibilityState
error
```

---

## 10. 測定結果

**pending。** B8-E1では実Browser計測を行っていない。

| workload | bounds T/G/R | roundTripMs | plan | generated | warnings | outcomeKey |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | pending | pending | pending | pending | pending |

---

## 11. Production default

**NOT DECIDED。**

`maxCandidateTrialsPerConflict` / `maxGeneratedBuildListEntries` /
`maxPlannerReruns` のProduction defaultはB8-E2で、10章の実測記録を根拠に決定する。
B8-E1の時点で根拠のある数値は存在しないため、いかなる値もdefaultとして採用しない。

---

## 12. 次Phase

```text
B8-E2   実Browser計測 → 測定記録 → PlannerOrchestrationBounds Production default決定
B8-D2b  BuildListPage → createConstrainedPlan() → B8-D2a atomic save
```

7.5の未確認事項はB8-E2をブロックしない。B8-E2へ直接進む。

B9 what-if、B10 Conflict UI、B11 normal-scope Keepは従来どおり別Phaseである。
