# B9 Planner What-if Browser Worker Benchmark

作成日: 2026-09-09

## Status

```text
Harness implementation: complete (B9-B2a)
Real Browser measurements: complete (B9-B2b)
Production PlannerWhatIfBounds default: DECIDED = 2 / 8 (B9-B2c)
```

本書はmeasurement harness、fixture、B9-B2b実測とB9-B2c default選定根拠の記録である。
測定・選定の詳細authorityは本書、正式なDomain契約はPLANNER_SPECとする。
Authorityは [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.4.1〜9.2.4.13、
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7、[DATA_MODEL.md](./DATA_MODEL.md) 8.1。
B8の手法は [B8 benchmark](./B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md)
を参照した。B8の実測値・orchestration defaultはB9の判断材料として流用していない。

B9-B2aでharnessを実装し、B9-B2bでreal Browser測定を完了した。B9-B2cではその結果に
基づく決定を `defaultPlannerWhatIfBounds = 2 / 8` としてDomainへ実装した。
caller-required契約は維持し、hidden fallbackやProduction UI callerの配線は追加しない。
実測の再実行はB9-B2cの作業に含めず、既存raw evidenceを読み取り照合して記録する。

## 1. 目的と計測経路

caller必須の2 boundを分離して評価できる基盤を作る。

- `maxCandidateTrialsPerCategoryPerTarget`（以下T）
- request-global `maxPlannerReruns`（以下R）

計測は次の実Production経路だけを使用する。

```text
Browser main thread
  → createProductionPlannerWorkerClient()
  → PlannerWorkerClient.createWhatIfComparison(requestId, request, callbacks)
  → planner.worker.entry.ts
  → planner.worker.ts
  → createProductionPlannerWorkerCalculations()
  → createProductionPlannerWhatIfComparison()
  → defaultConstrainedEnumerationBounds (Worker内部のauthority)
  → createPlannerWhatIfComparison()
  → constrained enumeration (compareConstrainedCandidates final order)
  → materialization
  → augmented preflight (all explicit fixed constraints)
  → full Production Planner / Beam Search / Trace Replay
  → PlannerWhatIfCalculationResult structured clone
  → Browser main thread
```

requestのfieldは `plannerInput` / `scenarioResolution` / `bounds` のみ。
`ConstrainedEnumerationBounds` は送信しない。現在のProduction値
40 / 30 / 100 / 500はadapterがSearch Domainのauthorityから渡す。
benchmarkはenvironment metadataにauthorityを参照して記録するだけで、値を複写・変更しない。

FakeRngEngine、Fake Planner/Worker、main-thread直接計算、Node/Vitest/jsdom所要時間、
推定Beam時間、B8実測からの外挿をperformance evidenceにしない。
テストのFake Clientはharnessの引数・計測境界・dispose・error処理の検証専用。
fixture意味テストで呼ぶProduction adapterは、性能経路ではなく意味の検証専用である。

## 2. Timing boundary / fresh Worker policy

1 runの順序。

```text
bounds validation / workload lookup    計測外
fixture / PlannerInput生成             計測外
Production Client生成                  計測外（new Worker constructor含む）
request / diagnostic callback準備       計測外
performance.now()                      start
client.createWhatIfComparison(...)
Promise settle
performance.now()                      end
client.dispose()                       計測外
benchmark outcome normalization        計測外
record追加・表示                        計測外
```

`roundTripMs = end - start` を補正せず記録する。call、postMessage、request structured
clone、request処理時に残っているWorker async initialization待ち、Production計算、
result structured cloneとmain-thread deliveryを含む。constructorを除外することは
「Worker startupを一切含まない」という意味ではない。残存する非同期初期化待ちは計測内。
fixture生成、validation、constructor、dispose、outcomeKey生成、表示は計測外。
Worker rejectionや同期throwでも同じ終端でclockを読み、Clientを1回disposeする。
normalizationの例外をWorker failureとして再計時しない。

```text
1 run = 1 fresh Production Planner Worker Client / Worker
```

warm-upとmeasurementの全runでClientを生成・破棄する。同一Workerを使い回さない。
warm-upはBrowser、module cache、JIT、周辺環境の安定化が目的であり、Worker stateの
持ち越しではない。batchと単発の重複実行を拒否し、warm-upを含むbatch全体で直列実行を
保つ。pageを離れた場合、現在runはsettle後disposeされ、次runは開始しない。

## 3. Production-valid fixture構築

`plannerWhatIfBenchmarkFixtures.ts` は既存の
`createPlannerOrchestrationBenchmarkInput()` を読み取り利用する。B8 workload builderの
意味・出力・実装は変更していない。B8のvalidated Master loading、RNG起点、Normal Counter、
Production predictionで作られた所持Gogmaの5slotとSkillsを再利用する。

```text
Base Seed      51231782
Skill Counter  341
Gogma Counter  200
Normal Counter 0 (weapon.bow、combinedではweapon.long_swordも)
Counter Gate   null / unconfirmed（Production authorityではない）
Engine         production-rng:c5-e2
CalculationContext.appSchemaVersion 2
```

これらはB8/B5の共有benchmark定数をimportしており、B9で別の値を複写していない。
MasterはB8 builderが `loadMasterData()` で読み込み検証する。

B8のunreachable IdealだけではB9を検証できないため、B9専用Targetを新しく構築する。
Practical条件はB8のままで、変更するのはfixture TargetのID/nameとIdeal条件である。

- Bonus型Target: Production Reset予測を順に調べ、その5slotが元のPractical bonus条件を
  満たす最初の結果をIdealにする。Skillはunconstrained。通常はG+1からG+100のfixture
  構築scan、conversion scenarioではGからG+100。これはSearch extentの変更ではない。
- combinedのSkill型Target: 所持sourceのProduction予測済みBonusをIdealとし、S+1から
  S+100のProduction Skill予測で元のPractical条件と包含が成立する最初のpairをIdealにする。
- `validateTargetIdealImpliesPractical()` が通るproposalだけを使う。見つからなければthrowする。
  選択したcounterは `idealPredictionCounters` に記録し、現在のProduction enumeration
  extent内であることをテストする。
- Gogma/Skill型EntryはB8が構築した具体的routeを再利用し、最終結果をProduction engineで
  改めて予測する。conversion型EntryはNormal Counter 0で1本forgeしてSkill Counter 341で
  convertする具体的routeと予測を作り、Normal scopeの5slotを順序どおり継承する。

全Entryは次のauthorityを通す。

```text
ProductionRngEngine prediction
  → createCandidateFromPrediction()
  → createBuildListEntry()
  → preparePlannerInitialContext()
```

Candidate category、distance、hashを手書きしない。Candidateがnull、Planner not-ready、
Entry exclusion、route rejection、scenario conflict非一意、participant数不一致ならfixture
生成を失敗させる。Conflict IDは初期Planner conflict detectionが生成する。各Conflictの
lexicographically smallest participating Entry IDを固定する再現可能なfixture choiceを使う。
推薦Entry、score、priority、bestStateは選択authorityにしない。

scenario以外のexplicit resolutionもすべて `plannerInput.conflictResolutions` に保持する。
データはtransientなfixtureのみで、Candidate/Entry/Plan/what-ifを永続化しない。

Production-validとは、現行Production RNGとDomain/Plannerが受け入れる意味のデータという
意味である。新しいgame-verified fixtureを取得したという意味ではない。Bow Sharpness/Ammo
familyなど既存のunverified領域をgame-verifiedへ昇格させない。

## 4. Workloadと意味検証

以下の数値は**非性能のProduction意味テストで確認するoutcomeとdistance**。
Browser latencyとdefault決定は9〜11章に分けて記録する。ここでのtupleは意味検証条件であり、
Production defaultを定義するものではない。

| ID | scenario / 構成 | 検証する点 |
| --- | --- | --- |
| `what_if_two_targets` | Bow fire/water、Gogma conflict 2 participant、fixed 1 / alternative 1 | A sanity、B trial pressure。R=32固定でT=1のPracticalがtrial bound、T=2でfound。距離はoperations=2 / Gogma=0 / Skill=1 / Normal=1 |
| `what_if_dual_category` | Bow fire/waterのconversion、Skill scenario 2 participant。Normal conflictのexplicit resolutionも保持 | C 排他Practical/Ideal。T=2,R=32でPracticalは2 / 2 / 0 / null、Idealは1 / 1 / 0 / null（operations/Gogma/Skill/Normal）。T=1,R=32ではPracticalがtrial boundでもIdealはfound。T=2,R=2ではPracticalだけfound、Idealはrerun bound |
| `what_if_three_targets` | Bow fire/water/thunderのconversion、Skill scenario 3 participant。Normal resolutionも保持 | D request-global R。非固定Target順はthunder→water。T=2で両categoryのtrial上限は足りる。R=2では最初のPracticalだけfound、R=4では最初の両categoryまでfound、R=6では全4slot found。R=32とR=6のoutcomeKeyは一致 |
| `what_if_combined` | Bow fire/water/thunderのGogma conflict + LS ice/dragonのSkill conflict、5 Targets、2 explicit resolutions | E all fixed constraints / preflight remapping。T=2,R=32では4slotすべてtrial bound。T=16,R=32の調査でもfoundは観測せず、後続slotにrerun boundが現れた |

3 participant fixtureは全Targetを同じoriginとfixed constraintsから独立に評価する。
先のwhat-ifを採用した入力に後のwhat-ifを積み重ねない。Practical/Idealがともにfoundの
意味テストと、同一categoryのenumerator Candidateの存在・estimate一致を確認する。
IdealをPractical枠へ代入していないことは、排他category別の列挙結果で検証する。

### 調査で残ったcoverage gap

- 最初に調べたGogma競合の2/3 participant型では、未来Reset由来のIdeal Candidateは存在
  するが、T=16内ではIdealのPlanner feasibilityを確認できなかった。固定Gogma操作との
  共存を、単純なcounter後方化やfixture専用semanticsで成立させていない。そこでCとDは
  conversionのSkill scenarioに切り替え、独立Gogma streamによる両categoryのfeasibilityを
  現行Production Plannerで確認した。A/Bとcombinedは元の競合コストを残す。
- combinedはreal Browser測定でもfixed制約下でfound 0だった。T=2 / R=8で全4slotが
  `stopped_by_candidate_trial_bound` まで到達したが、これはCandidate不存在の証明ではない。
  （後日更新：共有Counter prefixのsilent fast-forward修正（PLANNER_SPEC 7.0.2）後、
  同じcombined workloadのT=2 / R=32では両alternativeのIdealが `found`（距離2）となり、
  `candidateTrialBound` は4から2へ減った。ここのfound 0はB9時点の観測として残す。
  ms実測値は再測定していない。）
  重い複合reject workloadとしての評価機会とcostを測ったもので、combinedの
  「全categoryがfeasibleになるthreshold」のdecision evidenceは依然不足している。
- `not_found_within_search_extent` / `stopped_by_enumeration_bound` を返す専用Production
  scenarioは今回のdecision workloadでは固定していない。normalizationの全statusテストは
  あるが、これらのBrowserコスト、enumeration extentの十分性を証明するものではない。
- runtime unsupported retryがRを消費する専用fixtureは追加していない。3参加者の通常
  Candidate trialによる共有budgetを測る。RNG/Keep未検証領域、route-history diversityの
  canonical representative縮約、beam width等の既存限界もこのbenchmarkでは解消しない。

## 5. Outcome normalizationとraw record

`createPlannerWhatIfBenchmarkOutcome()` はallowlist方式で次を正規化する。

- calculation status
- completed: fixed Target/Entry IDs、alternativesのDomain stable order
- 各Targetのpractical/idealそれぞれのtyped statusと、found時のdistance 4値
- typed failure: failure status、reasonが存在する場合はreasonと固定resolution識別情報

`outcomeKey` はこの明示field順のsemantic objectのJSON文字列。alternativesをsortせず、
Practical/Idealも入れ替えない。`estimatedNormalAdvance: null` と0を区別する。
message/detail、warning text、progress、timing、request IDはkeyへ含めない。
ハッシュ圧縮せず完全なsemantic JSONなので、key自体もレビュー可能。

診断countは `found` / `candidateTrialBound` / `plannerRerunBound` / `enumerationBound` /
`notFound`。各bound flagは `PlannerWhatIfOutcome.status` から直接求める。
B8 `PlannerWarningKind` は一切B9 bound authorityへ読み替えない。

run recordはphase、request/workload ID、caller bounds、roundTripMs、outcome（semantic / key /
counts / flags）、progress event数、engineVersion、error、environmentを保持する。
environmentにはUA、hardwareConcurrency、開始時visibility、実行後visibility、Production
Engine versionとenumeration metadataを記録する。progress traceは保持しない。
Worker errorのrecordとtyped failureのsemantic resultは区別する。normalizationなどharness
自体の例外はAPI rejectionとなり、measurement成功として記録しない。

## 6. Benchmark-only sweepとglobal API

```text
T: 1, 2, 4, 8, 16
R: 1, 2, 4, 8, 16, 32
```

**measurement grid only。Production defaultではない。** 初期gridは依頼の値を維持した。
3 participantの意味テストで確認したR=6はthreshold確認用の追加手入力値として使用できる。
Cartesian全自動sweepはない。pageの初期T/Rはgrid先頭の1/1、measurement countは3。
入力はDomain validatorへ渡し、repair/clamp/欠損補完をしない。

```js
b9WhatIfBenchmark.workloads()
b9WhatIfBenchmark.fixture('what_if_three_targets')
b9WhatIfBenchmark.run({
  workloadId: 'what_if_two_targets', phase: 'single',
  bounds: { maxCandidateTrialsPerCategoryPerTarget: 2, maxPlannerReruns: 32 }
})
b9WhatIfBenchmark.runMeasurements('what_if_three_targets', {
  maxCandidateTrialsPerCategoryPerTarget: 2, maxPlannerReruns: 8
}, 3)
b9WhatIfBenchmark.records()
b9WhatIfBenchmark.clear()
b9WhatIfBenchmark.sweep
b9WhatIfBenchmark.environment
```

fixture()は計測外の完全なfixtureを返すので、実際のinitial conflicts、scenarioResolution、
他のexplicit resolutions、Target、Entry、Ideal prediction counterを監査できる。
records()はsnapshotを返す。clear()はメモリ内recordだけを消し、永続データには触れない。
page mount中だけglobal APIを登録し、unmount時に解除する。

## 7. B9-B2bの測定手順 / 再現経路

B9-B2bはbuild commit `5368b3b` のreal Browser Workerで完了した。以下はharnessの
測定手順と再現経路である。実際の測定環境・主要集計・finalist結果は9〜11章に記録する。

```powershell
npx vite build --config vite.benchmark.config.ts
npx vite preview --config vite.benchmark.config.ts --host 127.0.0.1
```

previewが表示するportの `/GogmaArtianPlanner/benchmark.html` を開き、B9 What-ifタブを選ぶ。
既定選択はC5のまま。通常application routeからB9へは配線しない。Dev server、Node、jsdom
では測定しない。consoleはB9 pageが開いているtabで操作する。

1. **Sanity:** 全4 workloadを余裕を持たせた明示tupleでwarm-up 1 + measurement 3。
   Engine/version、errorなし、typed result、同一tupleのoutcomeKey一致を確認する。
   例えばT=16,R=32から始められるが、combinedでは上限到達があり得るので全slot foundを
   sanity条件にしない。これは計測開始点であって推奨defaultではない。
2. **Trial sweep:** A/BとCでR=32固定、T=1→2→4→8→16。
   trial threshold、semantic outcome変化、threshold後の追加costを見る。
   `plannerRerunBoundReached` が出たrunをtrial単独の証拠にしない。
3. **Rerun sweep:** DでT=2以上を明示固定し、R=1→2→4→8→16→32。
   必要ならR=6を手入力して意味テストのthresholdをBrowserで確認する。
   全4slotを別々に確認し、`candidateTrialBoundReached` がないことも確認する。
   Cも併用し、Practical→Ideal schedulingを比較する。
4. **Combined:** tuple候補をA/B/C/D/Eに適用し、全fixed constraint下の複合コストと
   coverage gapを残したまま比較する。未foundを「存在しない」と解釈しない。
5. **Finalists:** 2〜3 tupleに絞り、各workloadでwarm-up 1 + measurement 5を再実行する。
   warm-up recordをmeasurement集計へ混ぜない。同一workload/tupleでoutcomeKeyが
   不一致、Worker error、visibility変化があるrunは環境とともに調査する。

runMeasurements()はwarm-upを含め毎回fresh Workerを使う。失敗したWorker runを記録して
batchを停止し、invalid bounds/count/workloadは計測前にrejectする。C5/B5/B8のAPI、
workload、既定選択、測定手順は変更していない。

### Raw result保存

B9-B2bのbrowser recordsはユーザーが `B9_B2_BROWSER_RAW_RESULTS.json` に保存済みである。
再取得時のbrowser console操作は次のとおり。

```js
JSON.stringify(b9WhatIfBenchmark.records(), null, 2)
```

使用Browser/version、OS、hardware、build commit、実施日、visibilityの異常などを測定報告に
併記する。recordはpage内メモリだけなのでreloadや別benchmarkタブへの移動前にexportする。
raw artifactをProduction codeから読まない。B9-B2cではローカルのB9 raw artifactを読み取り
照合しただけで、raw内容を本書へ貼り付けない。`B8_E2_BROWSER_RAW_RESULTS.json` と
`B9_B2_BROWSER_RAW_RESULTS.json` は証拠としてローカルに保持し、変更・削除・stage・commitしない。

## 8. 検証範囲と引き継ぎ

fixture testsはProduction engine/version、Planner validation ready、実Conflictのparticipant、
fixed Target、non-fixed Target数、staleness、Ideal⇒Practical、trial sensitivity、排他2category、
request-global rerun、複数explicit resolutionを検証する。
harness testsはwhat-ifのみの呼出し、caller bounds、enumeration bounds不在、Promise計時、
fixture/client/dispose/normalizationの計測外、fresh Client、progress count、error、invalid
input、fallback不在を検証する。page testsはglobal API、直列batch、error、unmount、既定C5
維持を検証する。これらのテスト所要時間はperformance evidenceではない。

B9-B2aはDomain/Worker/Production adapter/client、Persistence、B10 UI、schema/Engine version、
Search/Planner各defaultを変更しなかった。B9-B2cは9.2.4.9にProduction defaultの確定契約を
追加し、既存barrelから公開した。default値・validation通過・non-default caller値の保持・
invalid値のfail closed・欠損fieldを補完しないことをbounds testで固定した。
Workerとrerun budgetの古いコメントは同期したが、validationと計算の挙動は変更していない。
`PlannerWhatIfRequest.bounds` は必須のまま、Worker adapterはrequestをそのまま渡して
`defaultConstrainedEnumerationBounds` だけを内部供給し、Clientもfallbackを追加しない。
B10 Application callerのdefault選択・UI配線は後続作業である。

## 9. B9-B2b実測環境とevidence

| 項目 | 値 |
| --- | --- |
| Build commit | `5368b3b` |
| OS | Windows 11 |
| Browser | Chrome 152 |
| hardwareConcurrency | 16 |
| Engine | `production-rng:c5-e2` |
| `maxNormalForgeCount` | 40 |
| `maxGogmaAdvance` | 30 |
| `maxSkillResetCount` | 100 |
| `maxOffAxisPairEvaluations` | 500 |
| Raw evidence | `B9_B2_BROWSER_RAW_RESULTS.json`（401,316 bytes / 140 records） |

OSは測定報告による。Browser UAのWindows NT 10.0表記からOSを再解釈しない。
1〜2章のreal Production Browser Worker / fresh Worker / round-trip境界で測定した。
Node、Vitest、jsdomの実行時間やB8実測からの外挿ではない。

| Workload | Raw record数（warm-upを含む） |
| --- | ---: |
| `what_if_two_targets` | 32 |
| `what_if_dual_category` | 32 |
| `what_if_three_targets` | 44 |
| `what_if_combined` | 32 |
| 合計 | 140 |

以下の中央値はmeasurementだけを集計し、warm-upを含めない。sweepは各3 measurement、
finalistは各5 measurementの別batchである。同一tupleのsweepとfinalistをまとめて
8 measurementの中央値にしない。rawの同一workload / tupleのoutcomeKeyは一致した。

## 10. T / R sweepの実測と選定根拠

### T = maxCandidateTrialsPerCategoryPerTarget

R=32固定。T-boundは `stopped_by_candidate_trial_bound` を示す。

| T | two_targets median (ms) | Practical / Ideal | dual_category median (ms) | Practical / Ideal |
| ---: | ---: | --- | ---: | --- |
| 1 | 2835.4 | T-bound / T-bound | 2855.6 | T-bound / found |
| 2 | 2889.7 | found / T-bound | 2900.7 | found / found |
| 4 | 2979.0 | T=2と同一semantic | 2895.8 | T=2と同一semantic |
| 8 | 3281.0 | T=2と同一semantic | 2892.7 | T=2と同一semantic |
| 16 | 4682.2 | T=2と同一semantic | 2919.3 | T=2と同一semantic |

T=1は両workloadで必要なPracticalを取り逃す。T=2でPracticalがfoundになり、
dual_categoryではPractical / Ideal両枠を満たす最小測定値となる。T>2でsemantic改善は
観測されなかったため、T=2を採用する。two_targetsのIdealは引き続きT-boundであり、
全workloadの両categoryをfoundにする値という意味ではない。

### R = maxPlannerReruns

three_targets、T=2固定。found数は2非固定Target × 2排他categoryの全4slotを数える。

| R | median (ms) | found |
| ---: | ---: | ---: |
| 1 | 2687.9 | 0 / 4 |
| 2 | 2772.0 | 1 / 4 |
| 4 | 5656.0 | 2 / 4 |
| 6 | 5672.5 | 4 / 4 |
| 8 | 5663.5 | 4 / 4 |
| 16 | 5674.7 | 4 / 4 |
| 32 | 5753.0 | 4 / 4 |

このreachable workloadだけならR=6が最小完全値である。しかしcombinedでは次の差がある。

| T / R | found | stopped_by_candidate_trial_bound | stopped_by_planner_rerun_bound |
| --- | ---: | ---: | ---: |
| 2 / 6 | 0 | 3 | 1 |
| 2 / 8 | 0 | 4 | 0 |

R=8では全4slotが各categoryのT=2試行まで到達できる。各非固定Targetを同じoriginから
独立評価するB9の目的に対し、最後のTarget / categoryだけがglobal rerun budgetで評価機会を
失うR=6より、測定した全slotへT=2を配れるR=8を採用する。これはこのworkloadでの評価機会の
根拠であり、任意のTarget数・runtime unsupported retry数に対する保証ではない。
combinedでfoundは0のままである。trial bound到達は探索の打ち切りであり、Candidate不存在や
enumeration extentの十分性を証明しない。4章のcoverage gapは継続する。

## 11. Finalist比較とB9-B2c Production default

各workload / tupleについてwarm-up 1 + measurement 5。表は5 measurementの中央値。

| Workload | T=2 / R=6 median (ms) | T=2 / R=8 median (ms) |
| --- | ---: | ---: |
| `what_if_two_targets` | 2920.6 | 2919.0 |
| `what_if_dual_category` | 2906.5 | 2903.9 |
| `what_if_three_targets` | 5758.1 | 5729.1 |
| `what_if_combined` | 5827.1 | 5934.7 |

PracticalまたはIdealのfoundを確認できた3 workload（two_targets / dual_category /
three_targets）のsemantic outcomeは2 / 6と2 / 8で同じ。combinedでは2 / 8だけが
Planner rerun boundを排除した。combinedの追加costは5827.1 → 5934.7 ms、
+107.6 ms（約+1.8%）。この追加costを許容してTarget / category間の評価機会を優先する。

```ts
export const defaultPlannerWhatIfBounds: PlannerWhatIfBounds = {
  maxCandidateTrialsPerCategoryPerTarget: 2,
  maxPlannerReruns: 8,
}
```

定義位置は `src/domain/planner/constrained/plannerWhatIfBounds.ts`。
B9専用の実測から独立して決めた値であり、B8 defaultの2 / 1 / 4を流用したものではない。
`ConstrainedEnumerationBounds = 40 / 30 / 100 / 500`、Candidate Search / Planner Options、
各schema / Engine versionは変更しない。

defaultはcallerが明示選択して渡す値である。`PlannerWhatIfRequest.bounds` は必須で、
Domain内部fallback、invalid値のrepair、field-wise completion、Worker adapter / Clientの
暗黙注入には使わない。Worker requestのshape・wire schemaは変えず、enumeration boundsは
引き続きWorker内部から供給する。B10 UI・Persistence・Planner algorithm・Candidate enumeration・
RNGの変更は本決定に含まない。
