# Global Planner Research Phase 2-C2.5-D2-c（Ideal-only publication後のshallow型OOMのheap profile / heap snapshot）

Issue #154 Global Planner Researchの一部。Research only。Production source（`bonusStream.ts`、`skillStream.ts`、
`targetSearchScheduler.ts`、`lazyIdealCross.ts` を含む）、Search semantics、Planner、RNG、Worker、defaults、schema / version、
Persistence、UIは変更していない。memory optimizationは実装していない。

## 1. 結論

D2-a Ideal-only publication後もOOM（Node）/ renderer loss（Chrome D2-b）が残るshallow型2 context（c12-p0#0 / c2-p1#0）について、
C2.5-Cと同じNode sampling heap profile（8 GB、jit_default + no_inlining）と512 MB near-limit heap snapshotを、D2-a後のcodeで
formalに再取得した（measured HEAD `dddbfaa`、context parity 5 / 5、profiler contamination 0 / 5 run）。

| | c12-p0#0 | c2-p1#0 |
| --- | --- | --- |
| jit_default（Production-like）最大attributed site（6,144 MiB） | `ensureReserved` 63.6%、`reservedGeneratedState` 34.5% | `ensureReserved` 65.9%、`reservedGeneratedState` 33.6% |
| jit_default `ensureReserved` inclusive | 100.0% | 100.0% |
| no_inlining diagnostic（7,168 MiB） | `reservedBonusSteps` 45.5%、`reservedGeneratedState` 33.8%、`ensureReserved` 20.4% | 46.7% / 33.5% / 19.5% |
| snapshot（512 MB）persistent / in-flight | 68.8% / 31.2% | 86.5% / 13.5% |
| `set.depths` edge-cut（H1） | **64.5%（strong）** | **69.4%（strong）** |
| `steps[]` edge-cut（H2） | **38.3%（strong）** | **38.8%（strong）** |
| `channel.retained`（H4） | 0.0%（not_supported） | 0.0%（not_supported） |

- **Q1**: D2-a後のlive allocationは、Production-like JITで100%が held-aware Bonus stream の `ensureReserved()` 上にある。
  scheduler `settle`（旧C2.5-Cの最大site）は0.0%。
- **Q2（D2-a effect validation）**: 旧major / contributingだった `channel.retained`・`bonusAmendmentOperations`・
  `bonusAmendmentResults`・Candidate semantic keyは、post-D2で両contextとも **not_observed**（snapshot・両variantとも0.0%）。
  同じ規則で旧C2.5-C raw artifactを再解析すると major / major / contributing / major だった。
- **Q3**: `set.depths` が現在の主要persistent retentionである（H1 strong）。snapshot時点のdepth配列の要素数は累積generated state数と
  完全一致し、全past depthの全raw stateがpublished raw solutionとして保持されている。
- **Q4**: solutionごとのfull `steps[]` は主要保持要因の1つ（H2 strong、published raw solution 1件約400 Bのうち約192 B）。
  ただし `set.depths` のedge-cutにほぼ含まれる。
- **Q5**: `ReservedBonusResultNode` history（results / previous）はcontributing（21.1% / 24.7%）。
- **Q6**: current `frontier` は主要因ではない（minor、1.2% / 1.2%）。
- **Q7**: 1回の `ensureReserved()`（1 stream・1 depth）のburstは最大246,039 / 157,070 state。512 MB snapshotでは
  in-flight generated[] がedge-cut 12.4% / 12.0%（H6 contributing）。「depth 3で約100万〜200万」はD2-a計測の同depth・
  8 stream合算（1,964,741 / 1,256,560）で、1回のburstではない。8 GB近くでは長期保持の方がはるかに大きい（§9.5）。
- **Q8**: c12とc2の残存原因は同じ（最大site・最大category・H7 / H9以外の判定が一致。H7 / H9の差はsnapshot取得瞬間の違い）。
- **Q9**: 次のoptimization候補は1つに絞れる。事前登録した機械的規則で **H1（`set.depths` のpast depth raw solution長期保持）** が
  primary、H2はsecondary（§17）。**実装は次Phase。**

## 2. 目的とauthority

目的は、Ideal-only publicationで旧major要因が消えた後のheapを改めて測り、現在のshallow型OOMを支配している構造を
（推測ではなく）正式に特定することである。「D2-a後もOOMするから `set.depths` が悪いはず」とは仮定せず、H1〜H9を
formal run前に登録して判定した。

参照順: `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md`（5.6.8）、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2A.md`、
`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2B.md`、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25C.md`、
current implementation、tests。Search semanticsは変更していない。

## 3. D2-a後のcode（再監査）

main `1fe2a48` の `createTargetBonusStream().ensureReserved()` は、1 stream・1 depthごとに次を行う（D2-aで変わったのは
scheduler側のpublicationだけで、ここは変わっていない）。

```text
generated: ReservedBonusState[] に、そのdepthの全raw stateを生成
  （stateごとに familyLayoutKey 文字列、ReservedBonusResultNode {depth, result, step, previous}、result {restorationBonuses, scope}、step {gogmaCounterBefore/After}）
set.depths.push(generated.map(state => ({ depth, lastResetDepth, bonuses, restorationBonusScope, results,
                                           steps: reservedBonusSteps(state.results) })))
generated を (position, familyLayoutKey) で frontier reduction（compareReservedRepresentative）
set.frontier = reduced states
```

`readReservedDepth()` のProduction consumerは `TargetSearchScheduler.bonusChannel`（planner_alternative）だけで、stream keyごとに
1 channelが各depthを昇順に1回だけ読む。D2-a以後、schedulerはraw solutionを `satisfiesIdealBonuses()` で判定し、Ideal positionだけを
RouteOperation化・評価・`channel.retained` へ保持する。

## 4. workload（D2-a RESULTから機械的に導出）

sourceにorientation ID / Target IDを書かず、committed `docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json` から次の規則で導出した
（`selectPhase2C25D2CWorkload()`、全項目fail-closed）。

| 役割 | 規則 | 結果 |
| --- | --- | --- |
| primary OOM | role `oom_representative` かつD2-a after minimal / instrumentedの両方が `out_of_memory` | c12-p0#0（same_skill_counter）、c2-p1#0（same_owned_weapon_consumed） |
| cleared reference | role `oom_representative` かつD2-a after両modeが同じ正常終了 | c0-p0#0（stopped_by_extent_before_candidate） |
| controls | D2-a `workloadSelection.controls`。runnerがcommitted C2.5-A evidenceへC2.5-Cのcontrol rule（`selectPhase2C25CWorkload()`）を再適用した結果と完全一致、D2-a control semantic parityが全modeで一致 | c8-p1#0（first Candidate）、c13-p4#0（extent stop） |

unselected OOM representativeは0件。

## 5. 条件

| 項目 | 値 |
| --- | --- |
| Search | `runPhase2C25CSearch()`（C2.5-A Search-only入力、consumer stop 1 Candidate）。Normal 4 / Gogma 235 / Skill 4（Production defaultは変更なし） |
| sampling child | 1 run = 1 fresh Node child、`--max-old-space-size=8192`、concurrency 1、setImmediate yield |
| sampling profiler | `node:inspector` `HeapProfiler.startSampling`、samplingInterval 262,144 B、stackDepth 64、includeObjectsCollectedByMajorGC / MinorGC false（live-object profile、probeで有効性を確認: live 8,808 B vs collected込み118,636,120 B） |
| thresholds | 512 / 1,024 / 2,048 / 4,096 / 6,144 / 7,168 MiB（yield間のheapUsedが初めて超えた時点で取得） |
| variants | primary: jit_default（Production-like JIT、主要formal evidence）+ no_inlining（`--no-turbo-inlining --no-maglev-inlining`、関数単位attributionのdiagnostic）、cleared reference: jit_defaultのみ、controls: 両variant |
| snapshot child | primaryのみ。fresh child、`--max-old-space-size=512`、`--heapsnapshot-near-heap-limit=1`、sampling profilerなし、Search直前baseline snapshot |
| progress | held-aware depth hookをcountへ縮約（C2.5-C counter + per-depth generated / frontier count。state objectはobserverへ渡らない） |
| 環境 | Node v24.19.0、V8 13.6.233.17-node.51、Windows 11（10.0.26200）、AMD Ryzen 7 9700X 16 logical CPU、31.1 GiB |

cleared referenceのno_inliningを実行しない理由（formal run前に決定、`PHASE2C25D2C_VARIANTS_BY_ROLE`）: cleared referenceは
Production-like条件での旧major allocation / retentionの変化を見るreferenceで、仮説判定の入力ではないため。controlsは、primaryで
no_inliningをformal diagnosticとして使うので、両variantでsemantic contaminationを確認した。

no_inliningはallocation attributionを関数単位で見やすくするdiagnostic conditionであり、semantic output parityが同じでも
allocation量・escape analysis・lifetime・heap構成が同一とは限らない。no_inliningの割合をProduction-like heapの割合として書かない。

## 6. 事前登録（formal run前に固定）

`src/benchmarks/plannerGlobalPhase2C25D2CAnalysis.ts` の `PHASE2C25D2C_RULES`（仮説、判定規則、D2-a effect規則、recommendation
規則、sampling category規則、holder signature、persistent root）をmeasured HEADにcommitし、runnerが
`sha256(stableStringify(PHASE2C25D2C_RULES))` = `c06ac7d4…35d4` をprofiling前に記録、analyzerが一致をfail-closedで検証した。
analysis layer自体もpost-hoc変更を許可していない（許可はanalyzerのreporting、解釈module、testのみ）。

### 6.1 hypotheses

| id | 対象 | retention | snapshot measure | sampling categories（jit_default） |
| --- | --- | --- | --- | --- |
| H1 | `ReservedSet.depths` | persistent | `depths` property edge（ReservedSet holder）のedge-cut | reserved_generation, reserved_steps |
| H2 | per-solution `steps[]` | persistent | `steps` edge（published solution holder） | reserved_generation, reserved_steps |
| H3 | results / previous history | persistent | `results` / `previous` edge（solution / state / result node） | reserved_generation |
| H4 | scheduler `channel.retained` | persistent | `retained` edge | scheduler_publication, publication_evaluation, publication_materialization, publication_keys |
| H5 | current `frontier` | persistent | `frontier` edge（ReservedSet holder） | reserved_generation |
| H6 | one-depth `generated[]` burst | in-flight | 要素の過半がReservedBonusStateのin-flight arrayへの全incoming edgeのedge-cut | reserved_generation, family_layout_key |
| H7 | publication intermediate（map中の結果store） | in-flight | 要素の過半がpublished solutionのin-flight array（FixedArray含む）のedge-cut | reserved_generation, reserved_steps |
| H8 | windows / prediction memo | persistent | `windows` / `resetPredictions` / `keepPredictions` / `predictions` | rng_prediction, reservation_window |
| H9 | layout / key generation | persistent | `familyLayoutKey` edge（state holder） | family_layout_key, reserved_key_generation |

sampling categoryはstack-awareに決める。innermostのnamed Repository frameで分類し、key helper（`hashing.ts` / `semanticKeys.ts`）は
呼び出し元のnon-helper Repository frameで分ける（`bonusStream.ts` なら held-aware key、scheduler / `streamSolutions.ts` なら旧Candidate
semantic key）。H9のlayout keyはD2-aで消えたCandidate semantic keyとは別に数える。

### 6.2 判定規則

- snap = hypothesisのsnapshot measure ÷ synthetic rootから到達する新規bytes（512 MB near-limit snapshot）
- samp = jit_defaultの最高到達thresholdでのhypothesis sampling category share（no_inliningは併記のみ、判定に使わない）
- context: **strong** snap ≥ 25% かつ samp ≥ 10% / **contributing** strongでなく snap ≥ 5% / **not_supported** snap < 0.5% かつ
  samp < 1% / **minor** それ以外 / **inconclusive** measure欠落（0%として読まない）
- 全体: いずれかinconclusiveならinconclusive、それ以外はcontextの最弱level
- D2-a effect: snapshot・jit_default・no_inliningの最大share ≥ 25% major / ≥ 5% contributing / ≥ 0.1% minor / 未満 not_observed。
  全contextの最強level
- recommendation: 全体strongの仮説（なければcontributing）を、contextの最小snap、最小samp、id順で並べた先頭をprimary

sampling categoryは複数仮説で共有される（Production-like JITはhelperを `ensureReserved` へinlineする）。sampはその構造を作る
allocation pathが最大heapでliveであることの確認で、構造の区別はsnapが担う。

### 6.3 非formal smokeでの監査（開示）

閾値とrecommendation規則を固定した後、c12の512 MB snapshotを1枚だけnon-formalに取得し、holder signatureをD2-a後のcodeへ再監査した。
その結果、(1) `Array.prototype.map` はmap中の結果をJSArrayではなく内部のgrowable FixedArrayに保持するため、H7のarray censusを
JSArrayのbacking store以外のFixedArrayへ広げた、(2) V8はstring node名のNUL区切りを空白で書くため、layout key判定をNUL / 空白の
両方に対応させた。閾値・規則はsmoke前後で変えていない（smokeとformalの規則digestは同一）。

## 7. context parity / profiler contamination

- context parity 5 / 5: 各childのSearch開始前に、この実行のbaselineから再導出したpre-search context（orientation、workIndex、
  Target、invalidated Entry / Route、fixed Routes、reservation、exclusions、extent、originDigest、contextDigest）を
  C2.5-A evidenceとfield単位で照合し、contextDigestをD2-a workloadと照合した
- semantic parity（contamination 0 / 5 run）: c8-p1#0・c13-p4#0 × jit_default / no_inlining、c0-p0#0 × jit_default で、
  status・Search summary・first Candidate key（SHA-256）・extent / exhaustedがD2-aと一致した
- profiling failure 0、未通知profile 0

## 8. sampling結果

### 8.1 jit_default（Production-like、formal）

| threshold | c12 heapUsed / Gogma depth / 累積generated | c2 heapUsed / depth / 累積generated |
| --- | --- | --- |
| 512 MiB | 0.54 GB / 3 / 545,126 | 0.54 GB / 3 / 677,486 |
| 1,024 MiB | 1.07 GB / 4 / 1,538,941 | 1.07 GB / 5 / 1,628,465 |
| 2,048 MiB | 2.15 GB / 5 / 3,536,414 | 2.15 GB / 7 / 3,682,805 |
| 4,096 MiB | 4.32 GB / 7 / 7,699,195 | 4.30 GB / 10 / 7,727,032 |
| 6,144 MiB | 6.44 GB / 11 / 15,232,473 | 6.44 GB / 16 / 15,486,318 |
| 7,168 MiB | **yield点で未到達のままOOM**（`out_of_memory_before_threshold`） | 同左 |

- 6,144 MiBの内訳（attributed）: c12 `ensureReserved` 63.6%、`reservedGeneratedState` 34.5%、`reservedBonusSteps` 1.8%。
  c2 65.9% / 33.6% / 0.4%。category: reserved_generation 98.1% / 99.5%、reserved_steps 1.8% / 0.4%。
  `ensureReserved` のraw self（anonymous = `generated.map` callback）が61.5% / 63.8%で、`reservedBonusSteps` はそこにinlineされている
- 512〜6,144 MiBの全thresholdでreserved_generation shareは95.7%以上（c12）/ 97.2%以上（c2）で、heapの成長はこのpath自体
- OOM: 最後のheartbeatでc12 heapUsed 7.13 GB（Gogma depth 12、累積generated 17,403,169、累積frontier 546,316）、c2 7.09 GB
  （depth 18、17,267,064、652,568）。D2-aと同一の進行。V8最後のMark-Compact 6,916.2 → 6,864.4 MB（committed 8,317.1 MB）/
  6,818.3 → 6,734.9 MB（8,248.9 MB）

### 8.2 no_inlining（diagnostic attribution、7,168 MiB）

| | c12 | c2 |
| --- | --- | --- |
| `reservedBonusSteps` | 45.5% | 46.7% |
| `reservedGeneratedState` | 33.8% | 33.5% |
| `ensureReserved` | 20.4% | 19.5% |
| `keepFamilyLayoutKey` | 0.1% | 0.3% |

no_inliningは7,168 MiBに到達した（c12 Gogma depth 13、c2 depth 18）。これは関数単位のattributionであり、Production-like heapの
関数別割合ではない。

## 9. snapshot結果（512 MB near-limit）

両snapshotともJSON完全、meta解決、node / edge数がheaderと一致（c12 7,117,771 / 38,608,678、c2 7,259,637 / 39,793,014）、
baseline / near-limitともSHA-256一致、Search開始後に書かれ、書き込み後にOOM（`snapshot_written_then_oom`）。
取得時点はc12がGogma depth 3付近（累積generated 791,165）、c2がdepth 4付近（991,242）。

### 9.1 persistent / in-flight

persistent = `TargetSearchScheduler` から到達する新規node、in-flight = synthetic rootから到達しSearch long-lived rootから到達しない
新規node（D2-a後のcodeで再監査。held-aware streamの `reservedSets` はscheduler context経由で到達する）。

| | c12 | c2 |
| --- | --- | --- |
| 新規bytes（root到達） | 456.0 MiB | 449.0 MiB |
| persistent | 68.8% | 86.5% |
| in-flight | 31.2% | 13.5% |

### 9.2 edge-cut（新規bytes比、persistent / in-flightの内訳）

| 仮説 | c12 | c2 |
| --- | --- | --- |
| H1 depths | **64.5%**（P 294.1 / F 0.0 MiB） | **69.4%**（P 311.7 / F 0.0） |
| H2 steps | **38.3%**（P 138.8 / F 36.0） | **38.8%**（P 173.9 / F 0.4） |
| H3 results / previous | 21.1%（P 72.4 / F 23.6） | 24.7%（P 90.7 / F 20.3） |
| H4 retained | 0.0% | 0.0% |
| H5 frontier | 1.2% | 1.2% |
| H6 generated[]（in-flight） | 12.4%（F 56.7） | 12.0%（F 53.8） |
| H7 map結果store（in-flight） | 11.4%（F 51.9） | 0.4%（F 1.7） |
| H6 + H7合算（記述） | 29.6% | 12.4% |
| H8 windows / memo | 0.4% | 0.3% |
| H9 familyLayoutKey | 7.2%（P 3.2 / F 29.5） | 4.9%（P 3.0 / F 19.2） |

edge-cutはdominator treeのretained sizeではない。H1はH2・H3の大部分を含み、値は合算しない。

### 9.3 published raw solutionの保持（Q3 / Q4）

- persistentなdepth配列: c12 12配列・791,165要素、c2 17配列・991,242要素。snapshot時点の累積generated state数（791,165 / 991,242）と
  **完全一致**。全past depthの全raw stateが、ideal / non-idealに関係なくpublished raw solutionとして保持されている
- steps[]: persistentなJSArray 791,165 / 991,242件（c12 138.8 MiB、c2 173.9 MiB）。要素は3〜4件だが、backing storeは約160 B
- 1 published raw solutionあたり（c12 shallow）: solution 72 B + steps[] 約192 B + result node 56 B + result 40 B + step 40 B ≈ 400 B

### 9.4 in-flight（Q7）

- c12: `generated` JSArray（242,468 state、Stack roots経由）と、`generated.map()` の結果store（FixedArray、204,895 solution）が同時にin-flight。
  in-flight familyLayoutKey文字列242,468件（29.5 MiB）
- c2: `generated`（156,878 state）がin-flight、map結果storeは2,095 solutionのみ（map開始直後）
- retaining path（両context）: synthetic root → (GC roots) → (Stack roots) → generated / map store

### 9.5 burstの大きさと8 GB近くでの比重

- 1回の `ensureReserved()`（1 stream・1 depth）で生成されるraw stateは最大 **246,039 / 157,070**（depth 3）
- D2-aの「depth 3で1,964,741 / 1,256,560」は同じdepthの **8本** のheld-aware Bonus stream（Route baseごと）の合算
- OOM時点の累積generated（17,403,169 / 17,267,064）はすべてpublished raw solutionとして残るので、長期保持がburst 1回分（24.6万 /
  15.7万 state）より約70倍 / 110倍大きい。8 GB近くのheapの支配要因は長期保持（H1）であり、H6 burstは512 MB snapshotで
  contributingだが8 GB近くでは比重が小さい（件数比からの読み。8 GB snapshotではない）

## 10. H1〜H9判定（事前登録規則）

| id | c12 snap / samp（jit） | c2 snap / samp（jit） | 判定 |
| --- | --- | --- | --- |
| H1 `set.depths` | 64.5% / 99.9% strong | 69.4% / 99.8% strong | **strong** |
| H2 `steps[]` | 38.3% / 99.9% strong | 38.8% / 99.8% strong | **strong** |
| H3 result history | 21.1% / 98.1% contributing | 24.7% / 99.5% contributing | contributing |
| H4 `channel.retained` | 0.0% / 0.0% not_supported | 0.0% / 0.0% not_supported | not_supported |
| H5 `frontier` | 1.2% / 98.1% minor | 1.2% / 99.5% minor | minor |
| H6 generated burst | 12.4% / 98.1% contributing | 12.0% / 99.5% contributing | contributing |
| H7 publication intermediate | 11.4% / 99.9% contributing | 0.4% / 99.8% minor | minor |
| H8 windows / memo | 0.4% / 0.1% not_supported | 0.3% / 0.1% not_supported | not_supported |
| H9 layout / key | 7.2% / 0.0% contributing | 4.9% / 0.0% minor | minor |

no_inlining diagnosticのshareはRESULTに併記した（判定入力ではない）。

## 11. 旧C2.5-C → post-D2比較 / D2-a effect validation

旧C2.5-C raw artifact（profile 30件・snapshot 2件）をcommitted C2.5-C RESULTのmanifestとSHA-256照合したうえで、D2-cの同じ規則で
再解析した。absolute heap bytesの差分で「何GB削減」とは言わない（到達depthが変わるため）。

| | 旧C2.5-C c12 / c2 | post-D2 c12 / c2 |
| --- | --- | --- |
| jit_default最大attributed | `settle` 29.2% / 30.8% | `ensureReserved` 63.6% / 65.9% |
| jit_default category上位 | scheduler_publication 29.2 / 30.8%、publication_evaluation 24.7 / 24.6%、publication_keys 23.1 / 22.2%、reserved_generation 22.0 / 21.1% | reserved_generation 98.1 / 99.5% |
| no_inlining最大attributed | `serializeStable` 22.8% / 22.0% | `reservedBonusSteps` 45.5% / 46.7% |
| snapshot persistent / in-flight | 41.8 / 58.2%、87.0 / 13.0% | 68.8 / 31.2%、86.5 / 13.5% |
| H4 retained edge-cut | 14.3% / 55.5% | 0.0% / 0.0% |
| H1 depths edge-cut | 3.4% / 14.3% | 64.5% / 69.4% |
| H2 steps edge-cut | 11.4% / 13.6% | 38.3% / 38.8% |
| H3 history edge-cut | 3.5% / 4.4% | 21.1% / 24.7% |
| raw state signatures（snapshot） | published solution 29.9万 / 35.3万、評価済みsolution・key文字列が大量 | published solution 79.1万 / 99.1万、評価済みsolution・keyなし |
| OOM時Gogma depth | 5 / 7 | 12 / 18 |
| 規則による判定 | H4 contributing、H2 contributing、H1 minor | H1 strong、H2 strong、H4 not_supported |

D2-a effect validation（post-D2、両context）:

| 旧major構造 | 旧C2.5-C（同規則） | post-D2 |
| --- | --- | --- |
| `channel.retained` | major | **not_observed** |
| `bonusAmendmentOperations` | major | **not_observed** |
| `bonusAmendmentResults` | contributing | **not_observed** |
| Candidate semantic key | major | **not_observed** |

旧snapshotはscheduler publication途中（評価済みsolution・key文字列がin-flight）で、post-D2はheld-aware generation / map途中と取得瞬間が
異なる。

## 12. c12とc2の比較 / stream構成（Q8）

- jit_defaultの最大attributed関数（`ensureReserved`）・最大category（reserved_generation）が一致、H1 / H2 / H3 / H4 / H5 / H6 / H8の
  判定が一致。H7（c12 contributing / c2 minor）とH9（同）の差はsnapshot取得瞬間（c12はmap途中、c2は生成直後）による。
  **残存原因は同じ**と判断する
- stream構成（observerのper-depth countから）: 両contextとも8本のheld-aware Bonus stream。共通depthでの
  generated数の列は、c12で8本中7本、c2で8本すべてが一致した。Reset由来のstateはbase layoutに依存しないので、同じstate群が
  streamごとに重複生成・重複保持されている可能性がある。**これは観察であり、事前登録した判定ではない**（state内容の同一性、
  stream間共有のsemantic妥当性は未検証）

## 13. cleared reference（c0-p0#0、referenceのみ）

| | 旧C2.5-C | post-D2 |
| --- | --- | --- |
| final status | out_of_memory | stopped_by_extent_before_candidate（D2-aとsemantic parity） |
| Gogma max depth | 134 | 233 |
| thresholds | 512〜7,168 MiB | 512〜4,096 MiB（それ以上はSearch終了） |
| jit_default最大attributed | `settle` 67.0% | `ensureReserved` 99.5% |

c0では旧 `settle` / Route materialization / `channel.retained` 支配が消え、残りはheld-aware generation / 保持だけになった。正常終了した
contextなので、post-D2 shallow問題の直接証拠には使わない。

## 14. formalに言えること

1. D2-a Ideal-only publicationにより、旧major / contributingの `channel.retained`・`bonusAmendmentOperations`・`bonusAmendmentResults`・
   Candidate semantic keyは、shallow 2 contextで主要因から外れ、not_observedになった
2. post-D2のshallow型OOMは、Production-like JITでlive heapの100%がheld-aware Bonus streamの `ensureReserved()` 上にある
3. 主要persistent retentionは `set.depths`（H1 strong）で、全past depthの全raw state（累積generatedと同数）をpublished raw solution
   として保持している。per-solution `steps[]`（H2 strong）はその約半分を占める
4. `channel.retained`、windows / prediction memoは主要因ではない（not_supported）。frontierはminor
5. 1回のgeneration burstはin-flight working setとしてcontributing（512 MB snapshotで約12%）だが、1 stream・1 depth 最大約24.6万 / 15.7万
   stateに留まる
6. c12とc2は同じ残存原因である
7. 事前登録した機械的規則のnext optimization候補はH1（primary）、H2（secondary）
8. profilerはSearchのsemantic outputを変えていない（contamination 0 / 5）

## 15. まだ言えないこと

- 8 GB到達時点の保持構造そのもの（snapshotは512 MB）。8 GB近くの構成は、jit_defaultでensureReserved由来100%と、累積generated =
  published raw solution数から読んだもの
- `set.depths` の長期保持をやめるだけでc12 / c2がOOMせずに終わるか（より深いdepthで8 streamの生成・frontier・burstが次の上限に
  なり得る）
- memory改善後のruntime（OOMまで約90秒で累積約1,740万state。extent 235までの計算量は未測定）
- 8本のstreamでReset由来stateが重複しているか、stream間共有がsemantic-preservingか
- Chrome Dedicated Worker内での同じ内訳
- no_inliningとjit_defaultのheap-allocation parity

## 16. limitations

- sampling bytesはV8の統計的推定値（256 KiB間隔）。jit_defaultではinlineされたcallee（`reservedBonusSteps`、`keepFamilyLayoutKey`
  等）の割り当てが呼び出し元に計上される
- jit_defaultの最高profileは6,144 MiB（7,168 MiBはyield点で未到達のままOOM）。仮説判定のsampは6,144 MiBの値
- snapshotは512 MB heapでの1枚で、取得瞬間でin-flightの内訳が変わる（H6 / H7はその瞬間の値）
- edge-cutはretained sizeではない。共有object（bonuses配列、result history）はどの単独edge-cutにも入らない
- 判定閾値とrecommendation規則はD2-c計測前に固定したが、holder signature等はnon-formal smoke 1枚で監査した（§6.3）
- 旧C2.5-C比較は旧raw artifactのD2-c規則による再解析で、旧snapshotの取得瞬間はpost-D2と異なる
- stream構成はprogress countからの観察
- 各条件1 run。profiling runのwall timeは性能指標ではない

## 17. 次のoptimization候補（1件、未実装）

**primary recommendation: H1 — held-aware Bonus streamの `set.depths` に、全past depthの全raw solutionを保持し続ける表現をやめる。**

- **何を減らすか**: past depthのpublished raw solution（solution object、`steps[]`、そのsolutionだけが参照するresult history）。
  512 MB snapshotで新規bytesの64.5% / 69.4%、published raw solution 1件約400 B（うち `steps[]` 約192 B）。OOM近くでは累積約1,740万件
- **どう変えるか（方向のみ）**: Production consumer（scheduler bonusChannelの1 channel）はstream keyごとに各depthを昇順に1回だけ
  読み、読んだ配列を再読しない。depthを読み手へ渡した後にraw solutionを保持せず、生成済みdepth数・frontier・windows・
  unsupported・done・cutByExtentだけを保持する表現へ変える
- **維持する必要があるもの**: `readReservedDepth()` が返すraw solutionの集合・順序・内容、各depthの全raw solutionからのnotice、
  frontierとそのresult history chain、reservation window memo / prediction memo、extent / exhausted判定、schedulerのIdeal-only
  publicationと `channel.retained`、Lazy Ideal Cross

| 観点 | 影響 |
| --- | --- |
| late depth read | Productionでは後から登録されるRoute baseは `channel.retained`（Ideal positionのみ）を受け取り、depthを再読しない。同じdepthの再読・順不同の読み出しは、黙って空配列を返さず、契約として禁止（fail closed）するか再生成で同じ結果を返す。既存testの再読パターンの確認が必要 |
| same-result later position | 各absolute positionは引き続き独立したraw solutionとして読み出し時に1回ずつ提示される。生成とfrontier reductionは不変 |
| absolute position | `steps` のabsolute positionはresult historyから読み出し時に導出し、値は不変 |
| amendment history | frontier stateとIdeal solution（publication時にmaterializeされ `channel.retained` に残る）のresult chainは保持。非Ideal raw solutionだけが参照するnodeはGC対象になるが、どのCandidateの履歴にも使われない |
| Candidate composition | Lazy Ideal Crossは `channel.retained` だけを読むので不変 |
| notice | route_kind / unsupported noticeは各depthの全raw solutionを読み出し時に1回見て作るので不変 |
| extent / exhausted | 生成済みdepth数・frontier window・cutByExtentで決まり、保持配列に依存させなければ不変 |
| prediction | memoとfrontierから行い、過去depthを再生成しないのでprediction回数・順序は不変 |

secondary（同時に実装しない）: H2（`steps[]` を非Ideal raw solutionに作らない）。H1のedge-cutにほぼ含まれるため、H1を採る場合は不要。
後続の検討候補（未判定）: H6 generation burst（1 stream・1 depth最大約24.6万state）と、8 streamで一致したgenerated列（§12）。

**このPhaseでは実装していない。**

## 18. 変更境界

変更したのはResearch source / test / scriptと文書・evidenceだけである。

- 追加: `src/benchmarks/plannerGlobalPhase2C25D2C.ts`、`plannerGlobalPhase2C25D2CAnalysis.ts`、`plannerGlobalPhase2C25D2CInterpretation.ts`、
  `plannerGlobalPhase2C25D2C.test.ts`、`scripts/run-planner-global-phase2c25d2c.mjs`、`scripts/analyze-planner-global-phase2c25d2c.mjs`、
  `docs/PLANNER_GLOBAL_PHASE2C25D2C_RESULT.json`、本文書
- C2.5-Cのparser / graph / edge-cut / retaining path / profile aggregationはimportして再利用し、変更していない（C2.5-C testsは不変で通過）
- Production code、Search semantics、Planner、RNG、Worker、defaults、schema / version、Persistence、UI、research instrumentation hookの意味は
  変更していない

## 19. provenance / 証跡

| 項目 | 値 |
| --- | --- |
| measured HEAD | `dddbfaa5afe235e323ae1cf730fcd143a41ccbe8`（formal、uncommittedBenchmarkCode false） |
| analysis HEAD | `2e8fa8f30f11cc8d5a1dea63f4ae11cf1e1d0679`（measured HEAD以後の変更はanalyzer・解釈moduleのみ、calculationCodeChangedSinceMeasuredHead 空） |
| benchmarkCodeSha256 | RESULT `provenance.benchmarkCodeSha256` |
| rules SHA-256 | `c06ac7d4c581920fba14fcb58192f8b3189946fc1957f3dcf04cf14ee85935d4` |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`（D2-a provenanceと一致） |
| D2-a RESULT | SHA-256 `51918edeb7b8b4b08953847125295f6bddab5f4f89c2a759daa37d7d1bc7e914` |
| D2-b RESULT | SHA-256 `ce73520dce6b0ddaa94ec0d8bc8f565a49984f1aa1e42ccf1ad6c321cd3c4402` |
| C2.5-C RESULT（旧） | SHA-256 `e882cb7f6523be0c01cb5e7eedf60ddf4f18ad5b07ee236500eaf9dc70a6b6fc` |
| C2.5-A evidence | SHA-256 `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd` |
| raw artifact検証 | post-D2 profile 28 / 28、snapshot 4 / 4（baseline 2 + near-limit 2）SHA-256一致。旧C2.5-C profile 5 run・snapshot 2件をC2.5-C RESULT manifestと一致確認 |
| run wall time | 563.9 s（sampling 9 run + snapshot 2 run） |

raw run（`docs/PLANNER_GLOBAL_PHASE2C25D2C_RUN.json.local`）、`.heapprofile`、`.heapsnapshot`、analyzer中間物は `.local` でcommitしていない。
各profileのmanifest（context、role、variant、threshold、heapUsed、elapsed、progress、Node / V8、profiler options、V8 flags、bytes、SHA-256）は
RESULTの `profileManifest` に記録した。

## 20. テスト・検証

- `src/benchmarks/plannerGlobalPhase2C25D2C.test.ts`（21件）: D2-a RESULTからのworkload導出（ID非依存、modes差分のunselected、C2.5-C
  control ruleとの不一致・control parity欠落・primary不在のfail closed）、non-formal / malformed RESULTのfail closed、role別variant計画、
  progress observerがSearch結果を変えずcountだけを記録すること、semantic parity、threshold未到達理由、stack-aware category、profile集計、
  合成snapshotでのpersistent / in-flight split・各edge-cut・in-flight array cut（JSArray / FixedArray）・string分類、判定規則の境界値、
  effect規則、recommendation規則、規則のdigest可能性、isolation（hard-code ID / hash / file read / Production参照なし、child分離、
  analyzerの規則digest・code変更検証）、Production defaults / versions不変
- 実行: `npm run lint`、`npx tsc -b --force`、`npm test`（315 files / 5081 tests passed。formal run前と文書作成後の両方）、`npm run build`、
  `git diff --check`
