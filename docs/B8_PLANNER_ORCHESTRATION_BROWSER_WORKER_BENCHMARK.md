# B8-E Planner Orchestration Browser Worker Benchmark

作成日: 2026-09-08

## Status

```text
Harness implementation:                        complete   (B8-E1)
Real Browser measurements:                     complete   (B8-E2a)
Production PlannerOrchestrationBounds default: DECIDED    (B8-E2b) = 2 / 1 / 4
```

- B8-E1 harness / Production-valid workload実装: 完了
- 実Browser計測: **完了（B8-E2a、10章）**
- `PlannerOrchestrationBounds` のProduction default: **決定済み（B8-E2b、11章）**

```text
maxCandidateTrialsPerConflict = 2
maxGeneratedBuildListEntries  = 1
maxPlannerReruns              = 4
```

- 実装位置: `defaultPlannerOrchestrationBounds`
  （`src/domain/planner/constrained/plannerOrchestrationBounds.ts`）
- 採用値は10.9のfinalist `2/1/4`。finalist 3件のうちownerが選定した1件である
- `maxGeneratedBuildListEntries = 1` は
  **Domain上の最大generated Entry数ではない**（11.3）
- `generatedBuildListEntries.length >= 2` のworkload:
  **not observed in B8-E1 Production-valid investigation**（7.5）。
  B8-E2aの実測でも `maxGeneratedBuildListEntries` を1から2/4へ上げた際に
  adopt件数は増えていない（10.6）。将来Production-validな2件adoptが確認された場合は
  再benchmark対象である

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

> **10章の性能値はすべて実Browser / 実Production Planner Workerの直接計測である。**
> Node/Vitest実行時間、jsdom、Fake Worker、FakeRngEngine、main-thread直接呼出し、
> 推定値、B8-B2値からの外挿は一切使っていない。
> `roundTripMs` はraw実測値で、baselineやWorker起動時間を差し引いていない。

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

> **後日更新（共有Counter prefix fast-forward修正後）**
> 本節の観測はB8-E1時点のPlanner semanticsに対する記録である。その後の
> 「別Entryの実操作で通過した不要Route prefixをsilent fast-forwardする」修正
> （PLANNER_SPEC 7.0.2）により、workload C
> (`orchestration_trial_and_rerun_pressure`) とworkload D
> (`orchestration_generated_entry_cap`) はいずれもgenerous boundsで
> **2件adopt** するようになった。workload Cはbound warningも出さない。
> 本節冒頭の「2件adoptを確認できなかった」は当時の観測として残す。
> `docs/B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md` のms実測値は
> 再測定していないため、Planner costの現行値としては扱わない。

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

このgridの値がそのままProduction defaultになることはない。B8-E1では次を行っておらず、
そのうちfallback / clamp / 導出はB8-E2b以降も行っていない。

```text
Production fallback / clamp             追加していない（11.5）
CandidateSearchSettings からの導出       行っていない
defaultConstrainedEnumerationBounds からの導出  行っていない
```

`defaultPlannerOrchestrationBounds` はB8-E2bで追加されたが、その値 `2 / 1 / 4` は
10章の実測から決めたものであり、このsweep gridや
`BENCHMARK_ONLY_DEFAULT_SWEEP_BOUNDS`（8 / 4 / 16）を昇格させたものではない。
benchmark-only定数をProductionからimportしない方針も変わっていない。

危険な全Cartesian auto-runも用意していない。

---

## 9. 計測手順（B8-E2aで実施済み）

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

B8-E2aは上記をそのまま実施した。実行は `globalThis.b8PlannerBenchmark.runMeasurements()`
を逐次呼ぶだけで、benchmark harnessもProduction経路も変更していない。

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

## 10. 測定結果（B8-E2a 実Browser計測）

### 10.1 実施環境

| 項目 | 値 |
| --- | --- |
| 実施日時 | 2026-09-08（UTC `2026-09-08T06:25:40.923Z` にraw exportを取得） |
| 基準commit | `a6486e3 B8-E1 Planner orchestration benchmark基盤を実装` |
| Browser | Chromium 148.0.7778.280（Claude Desktop内蔵Browser pane、`Claude/1.46388.4`） |
| OS | Windows 11 Pro 10.0.26200 |
| `navigator.hardwareConcurrency` | 16 |
| `navigator.userAgent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.46388.4 Chrome/148.0.7778.280 Safari/537.36 MSIX` |
| `document.visibilityState` | **`hidden`**（全174 runで一定。10.2） |
| Production RNG version | `production-rng:c5-e2` |
| Worker内 `ConstrainedEnumerationBounds` | 40 / 30 / 100 / 500（Production adapterが供給） |
| build | `npx vite build --config vite.benchmark.config.ts` |
| serve | `npx vite preview --config vite.benchmark.config.ts`（port 4175が使用中のためpreviewが4176を選択） |
| URL | `http://localhost:4176/GogmaArtianPlanner/benchmark.html` |

実Chromiumページで `benchmark.html` と実Worker bundle
（`dist-benchmark/assets/planner.worker.entry-*.js`）を動かした計測である。
Vitest実行時間、Node直接実行、jsdom、Fake Worker、FakeRngEngine、
main-thread直接呼出し、推定・外挿は使用していない。

### 10.2 visibilityState の扱い

Browser paneのページは前面に出しても `document.visibilityState === 'hidden'` のままで、
B5 / B8-B2と同じ制約を受ける。全174 runで `hidden` 一定であり、
途中でvisibilityが変化したrunは無い。したがって採用しなかったrunも再測定したrunも無い。

この環境ではmain thread `setTimeout` が約1回/秒へthrottleされるが、
`roundTripMs` はWorkerからの `message` event で settle するPromiseを
`performance.now()` で挟んだ値であり、timer throttleを経由しない。
ただし絶対値は同一セッション内の相対比較にのみ使用し、
他セッション・他環境の数値と直接比較しない。

### 10.3 計測原則（実施内容）

```text
全tuple          warm-up 1回 + measurement 3回
Step 1 baseline  warm-up 1回 + measurement 5回
Step 7 finalist  warm-up 1回 + measurement 5回
```

min / median / max はmeasurement phaseのraw `roundTripMs` から直接算出した。
補正値は作っていない。総run数は174（warm-up含む）で、`status` は全件 `completed`、
`error` は全件 `null` である。

### 10.4 parity / outcome 確認

同一 workload かつ 同一 `PlannerOrchestrationBounds` の measurement 間で
`outcomeKey` が一致することを、37 個すべての (step, workload, bounds) グループで確認した。
**parity違反は0件**であり、性能比較を中止した箇所は無い。

boundsが異なるグループ間の `outcomeKey` 差は parity 違反ではなく測定結果そのものである。
その差の読み方は10.8に記す。

### 10.5 Step 1 — baseline（workload A、bounds 16/4/32）

conflictが検出されずexplicit resolutionも無いため、constrained re-searchは走らず、
ordinary Planner 1回のend-to-end基準になる。

| phase | roundTripMs |
| --- | --- |
| warm-up | 75.9 |
| measurement ×5 | 52.2 / 60.7 / 70.9 / 76.2 / 96.4 |

```text
median 70.9 ms   min 52.2 ms   max 96.4 ms
planPresent true / planStepCount 5 / selected 2 / generated 0 / conflicts 0
warnings なし / bound reached T,G,R,E = false,false,false,false
outcomeKey fnv1a32:aa40f6fd（5 run一致）
```

このbaselineは他workloadから差し引いていない。

### 10.6 Step 2〜6 実測表

`bound reached` 列は `T`=trial / `G`=generated / `R`=rerun / `E`=enumeration の順。
`gen` は `generatedBuildListEntries.length`、`sel` は `selectedBuildListEntryIds.length`。
`outcomeKey` は `fnv1a32:` prefixを省略して記載する。

#### Step 2 — early adoption sanity（workload B、measurement 3回）

| bounds T/G/R | roundTripMs (3 run) | median | plan/steps | sel | gen | conflicts | bound reached | warnings | outcomeKey |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 1/1/2 | 988.5 / 1061.7 / 1131.0 | **1061.7** | true / 2 | 1 | 0 | 1 | T | `max_candidate_trials_per_conflict_reached` | `43b17e5a` |
| 2/1/4 | 1048.4 / 1184.5 / 1187.5 | **1184.5** | true / 5 | 2 | 1 | 1 | — | なし | `64fb6844` |
| 4/1/8 | 1021.8 / 1152.5 / 1252.7 | **1152.5** | true / 5 | 2 | 1 | 1 | — | なし | `64fb6844` |
| 8/1/16 | 1051.5 / 1154.4 / 1157.3 | **1154.4** | true / 5 | 2 | 1 | 1 | — | なし | `64fb6844` |

T1(1/1/2) と T2(2/1/4) は trial と rerun を同時に変えているため、
どちらが adoption 失敗の原因かを切り分ける目的で隣接tupleを2件追加した
（追加理由の記録）。

| 追加tuple | roundTripMs (3 run) | median | plan/steps | gen | bound reached | outcomeKey |
| --- | --- | ---: | --- | ---: | --- | --- |
| 1/1/4（trial=1のままrerunを4へ） | 966.0 / 981.5 / 1056.6 | **981.5** | true / 2 | 0 | T | `43b17e5a` |
| 2/1/2（trial=2のままrerunを2へ） | 1037.0 / 1104.7 / 1118.4 | **1104.7** | true / 5 | 1 | — | `64fb6844` |

観測事実。

```text
trial=1 は rerun を 2 でも 4 でも adopt しない（outcomeKey 43b17e5a、gen 0、steps 2）
trial=2 は rerun が 2 でも adopt する（outcomeKey 64fb6844、gen 1、steps 5）
=> workload B の adoption 閾値は maxCandidateTrialsPerConflict >= 2
   maxPlannerReruns は 2 で足りている
trial>=2 の 3 tuple は outcomeKey が同一で、latency もこの範囲では単調増加しない
```

#### Step 3 — `maxCandidateTrialsPerConflict` sweep（workload C、generated=4 / rerun=32 固定）

| bounds T/G/R | roundTripMs (3 run) | median | plan/steps | sel | gen | conflicts | bound reached | warnings | outcomeKey |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 1/4/32 | 961.7 / 1007.5 / 1079.0 | **1007.5** | true / 2 | 1 | 0 | 2 | T | trial | `c4cb744e` |
| 2/4/32 | 2120.5 / 2244.2 / 2294.9 | **2244.2** | true / 5 | 2 | 1 | 3 | T | trial | `27308679` |
| 4/4/32 | 2265.0 / 2282.9 / 2341.6 | **2282.9** | true / 5 | 2 | 1 | 3 | T | trial | `27308679` |
| 8/4/32 | 2722.1 / 2737.9 / 2759.9 | **2737.9** | true / 5 | 2 | 1 | 3 | T | trial | `27308679` |
| 16/4/32 | 3435.5 / 3504.3 / 3619.3 | **3504.3** | true / 5 | 2 | 1 | 3 | T | trial | `27308679` |

観測事実。

```text
outcomeが変化するのは trial=1 -> 2 の1箇所だけ（c4cb744e -> 27308679）
trial>=2 は outcome が変わらず latency だけが増える
  2244.2 -> 2282.9 -> 2737.9 -> 3504.3 ms（trial 2 -> 16 で約1.56倍）
trial は全域で bound reached のまま（2件目のworkがtrialを消費し続ける）
conflict件数は trial=1 で2件、trial>=2 で3件
  （generated Entryが参加することで検出conflictが1件増える）
```

#### Step 4 — `maxPlannerReruns` sweep（workload C、trial=16 / generated=4 固定）

| bounds T/G/R | roundTripMs (3 run) | median | plan/steps | sel | gen | conflicts | bound reached | warnings | outcomeKey |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 16/4/1 | 48.3 / 70.1 / 83.0 | **70.1** | true / 2 | 1 | 0 | 2 | R | rerun | `cc286d7c` |
| 16/4/2 | 1062.7 / 1166.7 / 1181.6 | **1166.7** | true / 5 | 2 | 1 | 3 | R | rerun | `a13db419` |
| 16/4/4 | 2225.0 / 2240.7 / 2368.2 | **2240.7** | true / 5 | 2 | 1 | 3 | R | rerun | `a13db419` |
| 16/4/8 | 2692.1 / 2734.5 / 2771.6 | **2734.5** | true / 5 | 2 | 1 | 3 | R | rerun | `a13db419` |
| 16/4/16 | 3157.6 / 3463.5 / 3579.3 | **3463.5** | true / 5 | 2 | 1 | 3 | T | trial | `27308679` |
| 16/4/32 | 3486.8 / 3616.3 / 3765.4 | **3616.3** | true / 5 | 2 | 1 | 3 | T | trial | `27308679` |

観測事実。

```text
rerun=1 は 70.1 ms で終わり、gen 0 / steps 2 / warning max_planner_reruns_reached。
  これは10.5の ordinary baseline median 70.9 ms と実質同値であり、
  maxPlannerReruns に initial ordinary Beam が含まれることを実測が裏付けている。
  したがって rerun == trial を同等budgetとみなしてはならない。
rerun=2 で既に adopt する（gen 1 / steps 5）
rerun 2 -> 8 は outcomeKey a13db419 のまま latency だけが増える
rerun=16 で拘束するboundが rerun から trial へ移り、warning とともに
  outcomeKey が 27308679 になる。rerun=32 も同じ。
```

#### Step 5 — `maxGeneratedBuildListEntries` observation（workload D、trial=16 / rerun=32 固定）

| bounds T/G/R | roundTripMs (3 run) | median | plan/steps | sel | gen | conflicts | bound reached | warnings | outcomeKey |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 16/1/32 | 1978.8 / 2088.4 / 2121.2 | **2088.4** | true / 5 | 2 | 1 | 6 | G | `max_generated_build_list_entries_reached` | `a7b1dec9` |
| 16/2/32 | 3781.0 / 3841.7 / 4043.1 | **3841.7** | true / 5 | 2 | 1 | 6 | T | trial | `32ddb24f` |
| 16/4/32 | 3793.6 / 3852.4 / 3910.9 | **3852.4** | true / 5 | 2 | 1 | 6 | T | trial | `32ddb24f` |

観測事実。

```text
cap 1 -> 2 で adopt件数は増えない（gen 1 のまま）が、
  median は 2088.4 -> 3841.7 ms（約 +1753 ms、約1.84倍）になる。
  capを外した結果、追加のCandidate trial / Planner rerun が実際に走っている。
cap 2 -> 4 は飽和しており、outcomeKey も latency も実質変わらない
  （32ddb24f / 3841.7 -> 3852.4 ms）。
cap=1 のときだけ max_generated_build_list_entries_reached が出る。
cap>=2 では拘束するboundが trial へ移る。
```

これは7.5の記録（Production-validな2件adoptは未観測）と整合する実測であり、
**「Domain上の最大が1件」を断定するものではない**。
現行workloadでは cap を上げても adopt件数は増えず、コストだけが増えた、という観測事実である。

#### Step 6 — combined workload（workload E、Target 5件・conflict 2形状・explicit resolution 2件）

候補tupleは Step 2〜5 の結果から選び、選定理由を実行前に記録した。

```text
trial=1  : B でも C でも adopt しない              => 候補から除外
trial=2  : B / C の adoption 閾値                  => small tuple の trial に採用
rerun=1  : initial ordinary Beam のみで再検索しない => 候補から除外
rerun>=2 : C で adopt 済み
cap>=2   : D で adopt件数を増やさずコストだけ増える => 大きい側の tuple にのみ含める
```

これにより small / 中間 / 十分大きい を満たす4 tupleを、置換せずそのまま採用した。

| bounds T/G/R | roundTripMs (3 run) | median | plan/steps | sel | gen | conflicts | bound reached | warnings | outcomeKey |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 2/1/4 | 2140.3 / 2252.6 / 2525.7 | **2252.6** | true / 4 | 2 | 0 | 3 | T | trial ×2 | `a27eebfc` |
| 4/1/8 | 3146.1 / 3254.5 / 3278.7 | **3254.5** | true / 4 | 2 | 0 | 3 | T | trial ×2 | `a27eebfc` |
| 8/2/16 | 4605.9 / 4647.3 / 5028.0 | **4647.3** | true / 4 | 2 | 0 | 3 | T | trial ×2 | `a27eebfc` |
| 16/4/32 | 6978.2 / 7393.5 / 8291.2 | **7393.5** | true / 4 | 2 | 0 | 3 | T | trial ×2 | `a27eebfc` |

観測事実。

```text
4 tuple すべてで outcomeKey が同一（a27eebfc）であり、
  plan / steps 4 / selected 2 / generated 0 / conflicts 3 も同一。
つまり workload E では bounds を上げても semantic outcome は改善せず、
  待ち時間だけが 2252.6 -> 7393.5 ms（約3.28倍）に増える。
explicit resolution 2件の両方が max_candidate_trials_per_conflict_reached になる。
```

**未測定事項。** workload E が trial=16 を超える値なら adopt するかどうかは測定していない。
trial を 2 から 16 へ8倍にしても outcome が変わらなかったという事実だけを記録し、
それ以上大きい trial での挙動は推測しない。

### 10.7 warning / outcome 変化のまとめ

```text
adoption を決めるのは maxCandidateTrialsPerConflict と maxPlannerReruns である
  trial=1  : B / C で adopt 0
  rerun=1  : 再検索そのものが走らない（initial ordinary Beam だけ）
  trial>=2 かつ rerun>=2 : 測定した workload のうち B / C / D で adopt が成立した
     （E は測定した全tupleで adopt 0）

maxGeneratedBuildListEntries は、測定した範囲では adopt件数を増やさない
  D: cap 1 -> 2 -> 4 で gen は 1 のまま

adoption 閾値を超えた後に bounds を上げても、
  semantic outcome は改善せず latency だけが増える
    C  trial 2 -> 16 :  2244.2 -> 3504.3 ms（outcome同一）
    C  rerun 2 -> 8  :  1166.7 -> 2734.5 ms（outcome同一）
    D  cap   1 -> 2  :  2088.4 -> 3841.7 ms（adopt件数同一、warningのみ変化）
    E  2/1/4 -> 16/4/32 : 2252.6 -> 7393.5 ms（outcomeKey同一）
```

### 10.8 outcomeKey 差の読み方

boundsが異なるグループ間で `outcomeKey` が異なるケースのうち、次は
記録項目上 `planPresent` / `planStepCount` / `selected` / `generated` / `conflicts`
がすべて一致し、`warningKinds` だけが違っている。

```text
workload C : 27308679（trial警告） / a13db419（rerun警告） / b869305f（generated cap警告）
             いずれも plan true / steps 5 / selected 2 / generated 1 / conflicts 3
workload D : 32ddb24f（trial警告） / a7b1dec9（generated cap警告）
             いずれも plan true / steps 5 / selected 2 / generated 1 / conflicts 6
```

`outcomeKey` は `warningKinds` を畳み込むため、警告の差だけでkeyは変わる。
ただしdigestにはPlanStep列・conflict詳細・rejection・requiredMaterialsも含まれ、
benchmark recordはそれらを個別に保持していない。したがって
**「拘束するboundが変わっただけでPlan本体は同一」とまでは、この記録では証明されない**。
判明しているのは、上記の記録項目が一致し、`warningKinds` が異なる、という事実だけである。

### 10.9 finalist（2〜3 tuple、**default ではない**）

Step 2〜6から、Production候補になり得るtupleを3個へ絞った。

| finalist | 選定理由 |
| --- | --- |
| `2/1/4` | 測定した最小のadoption成立tuple。trial=2はB/Cの閾値、rerun=4は閾値2に余裕1段、cap=1はDで増分効果が無かった値 |
| `4/1/8` | 中間。trial / rerun を1段ずつ上げた場合のコストと拘束boundの移動を見るため |
| `8/2/16` | 十分大きい側。cap>1を含む唯一のfinalistで、7.5の「最大1件をDomain不変条件として断定しない」姿勢に対応する |

各finalistを workload B / C / D / E で warm-up 1回 + measurement 5回 再測定した
（workload A は10.5で5 measurement済みのため再測定不要）。

#### finalist `2/1/4`

| workload | roundTripMs (5 run) | median | min | max | gen | sel | steps | warnings | outcomeKey |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| B | 1148.8 / 1165.4 / 1219.1 / 1223.8 / 1269.9 | **1219.1** | 1148.8 | 1269.9 | 1 | 2 | 5 | なし | `64fb6844` |
| C | 1914.7 / 2031.8 / 2085.4 / 2219.9 / 2241.7 | **2085.4** | 1914.7 | 2241.7 | 1 | 2 | 5 | trial | `27308679` |
| D | 1784.8 / 1898.4 / 2078.4 / 2104.7 / 2154.9 | **2078.4** | 1784.8 | 2154.9 | 1 | 2 | 5 | trial | `32ddb24f` |
| E | 2112.2 / 2316.1 / 2333.5 / 2382.3 / 2611.3 | **2333.5** | 2112.2 | 2611.3 | 0 | 2 | 4 | trial ×2 | `a27eebfc` |

#### finalist `4/1/8`

| workload | roundTripMs (5 run) | median | min | max | gen | sel | steps | warnings | outcomeKey |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| B | 1116.9 / 1123.7 / 1131.4 / 1174.5 / 1240.8 | **1131.4** | 1116.9 | 1240.8 | 1 | 2 | 5 | なし | `64fb6844` |
| C | 1810.3 / 2025.5 / 2032.5 / 2081.6 / 2125.5 | **2032.5** | 1810.3 | 2125.5 | 1 | 2 | 5 | generated cap | `b869305f` |
| D | 1990.4 / 2072.3 / 2098.4 / 2156.1 / 2208.3 | **2098.4** | 1990.4 | 2208.3 | 1 | 2 | 5 | generated cap | `a7b1dec9` |
| E | 3071.6 / 3255.4 / 3262.3 / 3285.0 / 3421.0 | **3262.3** | 3071.6 | 3421.0 | 0 | 2 | 4 | trial ×2 | `a27eebfc` |

#### finalist `8/2/16`

| workload | roundTripMs (5 run) | median | min | max | gen | sel | steps | warnings | outcomeKey |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| B | 1119.8 / 1142.8 / 1171.9 / 1189.4 / 1267.6 | **1171.9** | 1119.8 | 1267.6 | 1 | 2 | 5 | なし | `64fb6844` |
| C | 2450.0 / 2450.2 / 2558.4 / 2652.4 / 2926.3 | **2558.4** | 2450.0 | 2926.3 | 1 | 2 | 5 | trial | `27308679` |
| D | 2733.5 / 2780.6 / 2878.6 / 2897.7 / 2956.9 | **2878.6** | 2733.5 | 2956.9 | 1 | 2 | 5 | trial | `32ddb24f` |
| E | 4771.1 / 4990.2 / 5102.0 / 5216.4 / 5216.8 | **5102.0** | 4771.1 | 5216.8 | 0 | 2 | 4 | trial ×2 | `a27eebfc` |

#### finalist の B/C/D/E outcomeKey parity

| workload | `2/1/4` | `4/1/8` | `8/2/16` | tuple間の一致 |
| --- | --- | --- | --- | --- |
| B | `64fb6844` | `64fb6844` | `64fb6844` | 3 tuple一致 |
| C | `27308679` | `b869305f` | `27308679` | `4/1/8` のみ別（警告がgenerated capへ移動） |
| D | `32ddb24f` | `a7b1dec9` | `32ddb24f` | `4/1/8` のみ別（同上） |
| E | `a27eebfc` | `a27eebfc` | `a27eebfc` | 3 tuple一致 |

各セルは同一tuple・同一workloadの5 measurement間で `outcomeKey` が一致している
（parity違反0件）。tuple間の差は10.8のとおり `warningKinds` の差を含む。

3 finalist すべてで `planPresent` / `planStepCount` / `selected` / `generated` は
workloadごとに同一であり、median latency だけが次のように変わる。

```text
B  1219.1 / 1131.4 / 1171.9 ms   （tuple間の差は小さい）
C  2085.4 / 2032.5 / 2558.4 ms
D  2078.4 / 2098.4 / 2878.6 ms
E  2333.5 / 3262.3 / 5102.0 ms   （最も差が大きい）
```

これはB8-E2a時点のfinalist実測記録であり、この節自体は推奨defaultを述べていない。

> このあとowner reviewを経て、B8-E2bがこの3件のうち `2/1/4` をProduction defaultとして
> 採用した（11章）。上の測定値はB8-E2a時点の記録のまま保持している。

### 10.10 省略 / 中止したrun

```text
中止したrun           : なし（174 run すべて完了、status completed、error null）
採用しなかったrun     : なし（visibilityStateは全run hidden で一定）
省略したrun           : workload E の trial>16 領域（10.6の未測定事項）
                        Step 6の4 tuple上限を守り、finalist再測定はStep 7で行ったため
異常に長時間化したrun : なし（最長は workload E 16/4/32 の 8291.2 ms）
```

### 10.11 raw measurement artifact

```text
B8_E2_BROWSER_RAW_RESULTS.json   （repo root、レビュー用一時artifact）
```

`b8PlannerBenchmark.records()` の戻り値をそのままexportしたもので、
174 recordすべてを人手転記なしで保存している。`environment` / `procedure` /
`benchmarkOnlySweepGrid` / `stepLabels`（recordsと同順の並行配列、
実行計画との突き合わせでmismatch 0件）を含む。

これは測定レビュー用のartifactであり、commit対象ではない。

---

## 11. Production default（B8-E2b decision record）

**DECIDED。**

```ts
export const defaultPlannerOrchestrationBounds: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 2,
  maxGeneratedBuildListEntries: 1,
  maxPlannerReruns: 4,
}
```

```text
Production tuple  2 / 1 / 4
実装位置          src/domain/planner/constrained/plannerOrchestrationBounds.ts
public export     src/domain/planner（constrained/index.ts 経由の既存経路）
決定者            project owner
決定日            2026-09-08
決定根拠          10章 B8-E2a real Browser measurement
```

根拠となったraw artifactは次で固定する。

```text
B8_E2_BROWSER_RAW_RESULTS.json
SHA256 19B92FB9D5D4E8540DF86B245DDC875414E2FB4BFBBD2FDFC7595C42DF504CBF
```

このartifactはレビュー用の一時ファイルであり、commit対象ではない。

### 11.1 `maxCandidateTrialsPerConflict = 2`

`2` は測定した中でgenerated Candidateがadoptされる最小のtrial数である。

```text
workload B
  trial=1  generated 0、max_candidate_trials_per_conflict_reached
  trial=2  generated 1、warningなし
  （trial=1は rerun 2 / 4 のどちらでも失敗する。10.6の追加tuple 1/1/4）

workload C
  trial=1        gen 0、outcome c4cb744e
  trial=2        gen 1、outcome 27308679
  trial=4/8/16   gen 1、outcome 27308679（同一）、latencyのみ増加
```

したがって現行の代表Production workloadでは `2` が意味のある最小閾値である。

`trial > 2` でsemantic outcomeの改善は観測されなかった。一方でlatencyの振る舞いは
workloadによって異なるため、「trialを増やすと必ずコストが増える」とは書けない。

```text
workload C の trial-only sweep（generated=4 / rerun=32 固定、10.6 Step 3）
  trial 2 -> 4 -> 8 -> 16
  2244.2 -> 2282.9 -> 2737.9 -> 3504.3 ms
  trial増加に伴ってlatencyが増加した

workload B の trial>=2（10.6 Step 2）
  2/1/4    1184.5 ms
  4/1/8    1152.5 ms
  8/1/16   1154.4 ms
  非単調であり、測定ばらつきの範囲内で増加していない。
  なおBのsweepはtrialとrerunを同時に上げているため、
  trial単独の効果を分離していない
```

したがって `2` を採用するdecisionの根拠は
**「追加trial budgetによるsemantic改善が観測されなかったこと」だけ**である。
latency増加はworkload Cで観測された挙動であり、全workload共通の根拠ではない。

### 11.2 `maxPlannerReruns = 4`

`maxPlannerReruns` は次のfull Beam Searchを**共有して**数える。

```text
initial ordinary full Beam
Candidate trial full Beam
runtime-unsupported retry full Beam
```

そのため他の2 boundsと同じ単位で比較できない。実測でも rerun=1 は
initial ordinary Beam だけで終了し（10.6 Step 4、70.1 ms、
ordinary baseline median 70.9 ms と実質同値）、再検索が一切走らない。

workload B は rerun=2 でもadoptできるが、Production defaultは
**独立した最低値2ではなく、実測finalist `2/1/4` 全体**をauthorityとする。
`2/1/4` は workload B / C / D / E のすべてで、
large-bounds側と同じsemantic outcomeへ到達している（10.9）。

### 11.3 `maxGeneratedBuildListEntries = 1`

**この値はDomain上の最大generated Entry数を意味しない。**

```text
maxGeneratedBuildListEntries = 1
  !=
Domain上の最大generated Entry数
```

B8-E1 / B8-E2aでは Production-valid な
`generatedBuildListEntries.length >= 2` のadoptionを確認できていない（7.5）。
これは「最大1件」というDomain不変条件の証明ではなく、
現行のProduction-valid workloadでの観測事実である。

実測（10.6 Step 5、workload D、trial=16 / rerun=32）。

```text
cap=1  generated 1
cap=2  generated 1（adopt件数は増えず、median 2088.4 -> 3841.7 ms と大幅増）
cap=4  generated 1（cap=2から飽和）
```

capを上げてもadopt件数は増えず、追加のCandidate trial / Planner rerunの
コストだけが増えた。よって現行Production defaultは `1` とする。

**将来 Production-valid な2-entry adoptionが確認された場合は再benchmark対象**であり、
そのときこの値を見直す。`1` をDomain規則として防衛しない。

### 11.4 finalist比較（10.9のmedian roundTripMs）

```text
        B         C         D         E
2/1/4   1219.1    2085.4    2078.4    2333.5 ms
4/1/8   1131.4    2032.5    2098.4    3262.3 ms
8/2/16  1171.9    2558.4    2878.6    5102.0 ms
```

B / C / D / E の `planPresent` / `planStepCount` / `selected` / `generated` は
finalist 3件で同一である。

4 workloadのmedian合計は次のとおり。

```text
2/1/4     7716.4 ms
4/1/8     8524.6 ms
8/2/16   11710.9 ms
```

したがって `2/1/4` は、finalist 3件のうち
**選択されたsemantic outcomeを保ったまま B/C/D/E 全体のmedian合計が最小**である。
ownerはこれを採用した。

ただし**workload単独では `2/1/4` が常に最速ではない**。

```text
workload B  4/1/8 が 1131.4 ms で、2/1/4 の 1219.1 ms より小さい
workload C  4/1/8 が 2032.5 ms で、2/1/4 の 2085.4 ms より小さい
workload D  2/1/4 が最小
workload E  2/1/4 が最小（差が最も大きい: 2333.5 vs 3262.3 vs 5102.0 ms）
```

`2/1/4` の優位は主にworkload E由来である。ここでは統計的有意差を主張しない。
run数は各セル5 measurementであり、有意性検定は行っていない。

### 11.5 default適用範囲（何を変えていないか）

```text
validatePlannerOrchestrationBounds()  caller supplied値の純粋validationのまま
assertPlannerOrchestrationBounds()    invalid値はfail closedのまま
```

次は**追加していない**。

```text
clamp
invalid valueのrepair / field-wise completion
fallback mutation
CandidateSearchSettings からの導出
ConstrainedEnumerationBounds からの導出
```

invalid caller valueをdefaultへ置換しない。Production Planner Worker adapter
（`planner.worker.production.ts`）は従来どおり caller supplied bounds を
そのままforwardし、Worker内でdefaultへ置換しない。
`PlannerWorkerClient` も default を適用しない。
defaultを使うかどうかを決めるのはApplication caller側であり、
その配線は次PhaseのB8-D2bで行う。

---

## 12. 次Phase

```text
B8-D2b  BuildListPage → createConstrainedPlan() → B8-D2a atomic save
```

B8-Eは完了である。7.5 / 11.3の未確認事項はB8-D2bをブロックしない。

B9 what-if、B10 Conflict UI、B11 normal-scope Keepは従来どおり別Phaseである。
