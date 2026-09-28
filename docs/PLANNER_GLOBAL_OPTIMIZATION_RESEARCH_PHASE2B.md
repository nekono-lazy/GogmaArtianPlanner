# Global Planner Research Phase 2-B（Plan品質差と final Planner 性能の分解）

Refs #154。Researchであり、最適化・Production仕様変更はしていない。

## 結論

**(A) 8,534 と 1,657 の差 6,877 physical operations は、機械的に完全に説明できた。**

- 差は操作種別で create_normal_artian +1,069 / convert +1 / reset_skills +2,932 / reset_bonuses +891 / keep_bonuses +1,984
  （合計 **6,877**）、streamで Skill +2,933 / Gogma +2,875 / Normal +1,069（チャアク +643、スラアク +241、大剣 +121、双剣 +51、
  片手剣 +13）（合計 **6,877**）。両方の和が6,877になることを分析コードがassertしている。
- 差の **主要な構造要因は逐次射影（sequential projection）** である。retained 20 Entry（originからのCandidate Search Route）の後、
  残り23 Targetは1件ずつ「直前までのPlanを適用した後の射影状態」から探索され、**generated Routeの全37 stream区間（Gogma 23 / Skill 14）が、
  それ以前の全Routeの終端以降から始まる（37/37）**。physical operationで見ると、retained Route由来の実行は **1,465**
  （= baseline / retained prefixのPlan長そのもの）、generated Route由来は **7,069**（base Search 6,173 + extent fallback 896）。
- 逐次射影だけが原因ではない。1,657と比べると、**source選択**（17 Targetでsourceが異なる: 所持→新規Normal 5、新規Normal→所持 6、
  別の所持武器 3、別のNormal位置 3）、**新規Normal位置**（Normal超過1,069はほぼ新規Normal位置の選択で決まる）、
  **held位置を跨ぐRoute**（1,657の18 Route、Planner Alternative Search）、**stream被覆の共有**（1,657では42 Gogma Route / 23 Skill Routeが
  stream originより後から始まり他Routeの被覆に依存）も差に関係している。これらはTargetごとに1 Candidateを逐次に決めるautonomous
  Researchでは表現されない（Candidate portfolio・global assignmentの不足）。
- 1,657では、Gogmaで35 Target・Skillで12 TargetのRouteが、Phase 2-A.5 lower-boundの **streamごとの最早threshold**（per-stream earliest
  threshold）より後で終わる。すなわち global optimumは、各Targetについて個別に到達可能な Gogma / Skill streamの最早thresholdを
  必ずしも採用しない。ただしこのthresholdはstreamごとに独立な値で、最早Gogma thresholdと最早Skill thresholdを実現するoptionが
  同じsource / Routeである保証はないため、「Target単体として最短のRouteが存在し、それより長いRouteが選ばれた」ことはこの証跡だけでは示せない。
- 「最大寄与Target」だけでは説明できない: Skillの超過2,933は14 Target、Gogmaの超過2,875は24 Targetのrequired unitが押し上げており、
  静的peel（遠い順にoptimum Routeへ置換）では1件目の置換でSkillは10位置、Gogmaは10位置しか縮まない。Normalの超過は
  種別ごとにほぼ1 Targetで決まる（チャアク643はextent fallbackのN849、スラアク241はN241）。

**(B) final Planner の性能は execution projection が支配する。**

- Phase 2-Aの「Planner 約36秒」は **26回のfull Planner call合計**（baseline 1、retained prefix 1、単体Candidate適用 23、final 1）であり、
  final callそのものは約18.5秒。Browser Worker（measurement 3回の中央値）で26 call合計36.0秒のうち **execution projection 21.9秒（61%）**、
  scheduler loop 5.5秒、Trace Replay 4.5秒、scheduler prepare 4.0秒、PlanningInputSnapshot 52 ms、その他のtailは合計数ms。
- final call 18.5秒の内訳: scheduler prepare 1.44秒 / scheduler loop 4.20秒 / **Trace Replay 2.15秒** / **execution projection 10.71秒** /
  PlanningInputSnapshot 15 ms / checkpoint defence 0.28 ms / rejected Build List 1.2 ms / required materials・Plan assembly各0.02 ms以下。
- **最大ping遅延 13.34秒** はfinal callの **Trace Replay（2.13秒）+ execution projection（10.81秒）** と、その直後のWorker側evidence計算（0.34秒）に
  重なっていた。scheduler loopは64 action毎にyieldするので含まれない。1〜3.5秒級の遅延も、各full callのscheduler prepareと
  Trace Replay + projectionに対応した。
- Worker heap（CDP、sampled）はfinal callのprojection中に **約259 MiB → 1,750 MiB**（+約1.46 GiB）へ増え、他のphaseでは269 MiB以下。
  Node（GC後のlive heap）ではprojection前後の保持増は約30 MiBで、projectionは大量の一時allocationを行う（GCなしのused heapは2.5 GiBまで増える）。

Plan品質差は「探索が悪い」ではなく、**Candidate生成の起点（射影frontier）**、**Targetごとに1 Candidateを逐次に決めるRoute選択**
（source / Normal位置 / held Routeの選択肢と全体割当の欠如）に帰着し、性能は **projectionの計算構造** に帰着する。
Phase 2-Cへ渡す必要能力は11章。

## 1. 開始状態・authority・変更境界

- 開始時: branch `main`、`main` = `origin/main` = `a584b577d42544431dc766e6afa6f5aafd06dc12`（PR #166 / Phase 2-A.5 merge済み）、
  Working Tree clean。Issue #154 Open。作業branch `research/global-planner-phase2b-decomposition`。
- 参照authority: REQUIREMENTS、PLANNER_SPEC、SEARCH_SPEC、RNG_SPEC、ISSUE_103_DETERMINISTIC_PLANNER_DESIGN、Phase 1-E / 2-A / 2-A.5文書、
  `PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、Phase 2-A Browser benchmark実装、Phase 2-A.5 verifier / lower-bound実装、
  `productionPlanGeneration.ts`、`plannerDeterministicScheduler.ts`、`plannerTraceReplay.ts`、`productionPlanExecutionProjection.ts`、
  AGENTS.md、AI_DEVELOPMENT_WORKFLOW。
- **Production behavior変更なし**: Planner / Candidate Search / RNG / Planner Alternative / Conflict / Route選択semantics、Production Worker protocol、
  schema・version（CalculationContext 17、DB 10、Export 13、`production-rng:c5-e7`）、default値（`maxPlanSteps` 1000、Search defaults）、
  UI、Persistence / Dexie、Export schema、Research algorithmのCandidate選択方針は変えていない。
- Production sourceへの変更は1点だけ: `ProductionPlanGenerationObserver` に任意の `onPlanGenerationPhase?(phase)` を追加し、
  共有Plan生成tail（`productionPlanGeneration.ts`）の各phase開始で呼ぶ。phase名だけを渡し、何もその有無で分岐しない。
  Plan field（calculationContext / conflicts / rejected / materials）の評価順は元のobject literalと同じ順に保った。
  Production callerは渡さない。**observer有無で `PlannerResult` が完全一致する**ことをテストで固定した（通常run・runtime-unsupported retry・
  plan null・例外伝播）。PLANNER_SPEC 9.2.16の観測observer記述に1段落追記した。
- scheduler内部（prepare / loop / finish）は **既存の `PlannerExecutionOptions` hook** だけで測った: `shouldCancel()` は1 loop iterationに1回、
  `yieldControl()` は64 applied action毎に呼ばれるので、Research側でこれらを包む。
  - `shouldCancel` の包みは元の戻り値をそのまま返す。
  - `yieldControl` の包みは **async関数ではなく、元の `yieldControl()` が返したPromiseそのものを返す**（Promise identityをテストで固定）。
    yield完了時刻の観測は、そのPromiseへcallerのawaitより先に登録したreactionで行う。reactionのrejection handlerは観測側の派生Promiseだけを
    処理し、callerには元のrejectionがそのまま届く。したがって観測wrapperはscheduler側のawaitに余分なPromise境界・microtask hopを加えない。
    （PR #167初版はasync wrapperで元Promiseをawaitしていた。semantic結果は同じだったが、review指摘により修正し、正式測定を取り直した。）
  - `undefined` のhookは `undefined` のまま（propertyを追加しない）。
  - `PlannerSchedulerInstrumentation`（Issue #103 parity test observer）は使っていない・変えていない。
- shared tailをResearch側へコピーした別実装は作っていない。

## 2. 実装（Research only）

| 役割 | ファイル |
| --- | --- |
| Production: 任意tail phase observer | `src/domain/planner/plannerTypes.ts`（`ProductionPlanGenerationPhase`）、`productionPlanGeneration.ts` |
| full Planner call timeline（clockだけ読む） | `src/benchmarks/plannerGlobalPhase2BTimeline.ts` |
| 完了Planのphysical operation / Counter advance / Target別Route要約（post-hoc） | `src/benchmarks/plannerGlobalPhase2BPlan.ts` |
| 6,877差のreconciliation（証跡を引数で受け取る） | `src/benchmarks/plannerGlobalPhase2BGapAnalysis.ts` |
| timing / ping / heap sampleの集計 | `src/benchmarks/plannerGlobalPhase2BPerformance.ts` |
| Research接続（任意option `plannerTimeline`、無ければ従来どおり） | `plannerGlobalOptimizationResearch.ts` |
| Browser Worker / protocol / runner / page（任意 `phase2b` request、ping送信時刻、Phase 2-B workload） | Phase 2-A benchmark一式 |
| Node runner（Phase 2-A Worker controllerをNodeでそのまま実行） | `scripts/run-planner-global-phase2b.mjs` |
| post-hoc分析（provenance記録、BrowserとNodeのmeasured commit不一致でfail closed） | `scripts/analyze-planner-global-phase2b.mjs` |

- **oracle isolation**: Phase 2-B algorithm側（Research、Worker、timeline、Plan要約、runner）はoracle manifest / verifier / lower-boundも
  `PLANNER_GLOBAL_1657_ORACLE_RESULT.json` もimport・読込しない（source scan testで固定）。1,657との比較は、autonomous runが
  完全に終わった後に `analyze-planner-global-phase2b.mjs` が `--optimum` 引数の証跡JSONを読むだけで、Search / Planner / Route選択へは入らない。
- **per-stream earliest threshold**: Phase 2-A.5 lower-bound証跡の `minGogmaThreshold` / `minSkillThreshold` / `minNormalThreshold` は
  schemaを変えずに読み、Phase 2-B内部では `perStreamEarliestThresholds`（`gogma` / `skill` / `normal`）へmappingする。
  streamごとに独立に判定し、Target単体Routeの最小としては扱わない（型・コメント・カテゴリ名・テストで固定）。
- Worker requestの `phase2b` は任意fieldで、無いときPhase 2-A runは不変（validation testあり）。Worker DTOはbenchmark専用protocol
  （`pg2a_benchmark_`）だけで、Production Planner / Search Worker protocolは変更していない。
- Plan要約は完了後の読み取りで、計算時間（`calculationElapsedMs`）の外で行う（1 runあたり約31 ms）。

## 3. 測定環境・provenance（正式測定）

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-09-28（Node 18:34〜18:39 JST、Browser 18:39〜18:52 JST） |
| **measured commit** | `38b8d7ff245efa0556ebbf34054d383e88e7d897`（review修正後。Browser build埋め込み・Node runnerの両方で確認） |
| benchmark code SHA-256（Browser build） | `2e50390ef96fd438e343636cac2e97c085e8c75f4595c239b5ee96492f64693f`、`uncommittedBenchmarkCode = false` |
| benchmark code SHA-256（Node runner） | `a273700e74916d274cd2a6404ac2f27e94101171500af0936390a9565527c5ed`、`uncommittedBenchmarkCode = false`（hash対象pathがbuildと異なるため値が違う。どちらもcommit `38b8d7f`） |
| measured commitとPR headが異なる理由 | 測定後のcommitは `docs/` の文書・証跡（結果JSON、外部memory sample）だけで、benchmark-affecting code（`src`、`scripts` 等）は変えていない |
| 旧測定 | PR #167初版のmeasured HEAD `44194e2`（yield wrapperがasync）の値は、本書ではすべて新測定値へ置き換えた（証跡もこのcommitで置換。旧値はgit履歴の `d14f2fd` に残る） |
| build / preview | `BENCHMARK_CROSS_ORIGIN_ISOLATED=1 npx vite build --config vite.benchmark.config.ts` → `vite preview`（127.0.0.1:4173、production benchmark build） |
| Browser | Google Chrome 153.0.8010.49（一時プロファイル、`--disable-backgrounding-occluded-windows`、CDP driver）、crossOriginIsolated true、visibility visible |
| OS / CPU / memory | Windows 11 Pro 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 32 GB（`deviceMemory` 32、total 33,377,591,296 bytes） |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`、schemaVersion 13、Target 43、Entry 43（commitしない） |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17 |
| workload | Phase 2-A normal-2x fallback winnerと同一（base N350 / G500 / S1500、normal ×2 fallback、episode 3、fallback 180秒、attempt 900秒、raw cache per-search、yield message-channel）+ `phase2b: { timeline, planEvidence }` |
| `maxPlanSteps` | Research 20,000 / Production default 1,000（変更なし） |
| 回数 | timing: warm-up 1 + measurement 3（中央値）、responsiveness 1、memory 1（別run）、timelineなしPhase 2-A同等control 1 |
| 背景負荷 | 各step前後の `Win32_Processor.LoadPercentage` 2〜39%（timing開始時39%）。補正していない。測定中にtest / build等は並行実行していない |
| Node | v24.19.0、`--max-old-space-size=8192`（gc probeは `--expose-gc`）、Vite SSR loader、Node yieldは `setImmediate`（Browser Workerではない）。used / gc の2 run |

## 4. autonomous 8,534 の再現と semantic parity

| run | 結果 | steps | semantic SHA | Plan SHA |
| --- | --- | ---: | --- | --- |
| Browser timing（warm-up 1 + 3）、responsiveness、memory | 全6件 completed、43/43、selected 43、Conflict 0、rejected 0、resource_conflict 0、Trace Replay passed、expandedStates 8,577、normal-2x fallback 1回 | 8,534 | `b8ac8bdf…a9f8`（Phase 2-Aと一致） | `6c380cb3…`（従来と一致） |
| Browser Phase 2-A同等control（timelineなし） | 同上 | 8,534 | `b8ac8bdf…` | 同上 |
| Node used / gc probe | 同上 | 8,534 | `b8ac8bdf…` | 同上 |

- review修正後も全8 runで semantic SHAがPhase 2-A（= Phase 1-E reproduction）と一致し、Planは変わっていない。
- 自律Plan evidence（physical要約・Route要約）は全runで同一で、初版測定とも同一（SHA-256 `e10a49e3…f5ea`）。
- timeline付きround trip中央値85.7秒、timelineなしcontrol 83.3秒（1回）。差は1回測定・背景負荷を含む揺れの範囲で、観測overheadは
  plan evidence（約31 ms）とevidence計算（約0.32秒）程度と見ている（Phase 2-A中央値は86.9秒）。

## 5. 1,657 evidence（Phase 2-A.5、改変なし）

`docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json`（SHA-256 `be51e7cd…84a1`、verdict `proven_minimum`）を読み取り専用で比較に使った。
Plan steps 1,657（reset_skills 1,075、create 339、convert 8、reset_bonuses 193、keep 42）、Route operation単純和1,745、
stream Skill 341→1424 / Gogma 55→290 / Normal チャアク 0→207・双剣 349→475・片手剣 7→12・スラアク 0→1、
lower-bound監査のTarget別 per-stream earliest threshold。

## 6. 6,877 physical operation の reconciliation

authorityは両Planの **physical operation（Counterを1つだけ1進めるStep）とCounter advance**。`confirm_owned_ideal` はCounterを進めないので数えない
（autonomous 0件、1,657側 0件）。両Planとも physical operation = Σ stream advance（identity成立）。

### 6.1 操作種別

| operation | autonomous | 1,657 | 差 |
| --- | ---: | ---: | ---: |
| create_normal_artian | 1,408 | 339 | **+1,069** |
| convert_normal_to_gogma | 9 | 8 | **+1** |
| reset_skills | 4,007 | 1,075 | **+2,932** |
| reset_bonuses | 1,084 | 193 | **+891** |
| keep_bonuses | 2,026 | 42 | **+1,984** |
| **合計** | **8,534** | **1,657** | **+6,877** |

### 6.2 stream

| stream | origin | autonomous終端 | 1,657終端 | autonomous advance | 1,657 advance | 差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Skill | 341 | 4,357 | 1,424 | 4,016 | 1,083 | **+2,933** |
| Gogma | 55 | 3,165 | 290 | 3,110 | 235 | **+2,875** |
| Normal チャアク | 0 | 850 | 207 | 850 | 207 | **+643** |
| Normal スラアク | 0 | 242 | 1 | 242 | 1 | **+241** |
| Normal 大剣 | 156 | 277 | 156 | 121 | 0 | **+121** |
| Normal 双剣 | 349 | 526 | 475 | 177 | 126 | **+51** |
| Normal 片手剣 | 7 | 25 | 12 | 18 | 5 | **+13** |
| **合計** | | | | **8,534** | **1,657** | **+6,877** |

Skillの差（+2,933）と reset_skills + convert の差（+2,933）、Gogmaの差と reset / keep の差（+2,875）、Normalの差とcreateの差（+1,069）が一致する。

### 6.3 Route operation と physical operation（混同しない）

| | Route operation単純和 | physical operation | 共有 / silent fast-forward分 |
| --- | ---: | ---: | ---: |
| autonomous | 11,072 | 8,534 | 2,538 |
| 1,657 | 1,745 | 1,657 | 88 |

Target別のRoute operation差（合計 11,072 − 1,745 = 9,327）は6,877のphysical差ではない。6,877の帰属は下記の
**stream終端とphysical Step** に置く。

### 6.4 stream終端モデル

各streamの終端は、両Planとも **(そのRoute集合の最も遠いunit位置) + 1** に一致した（`staticEndModel` 両側成立）。Routeのstream上の
最後のunitは必ずrequired（fast-forward不可）なので、stream差 = 終端差であり、差は「どのTargetのrequired unitが1,657の終端より先にあるか」で決まる。

### 6.5 超過領域の帰属（physical）

各streamの超過領域 [1,657終端, autonomous終端) にあるphysical Step（ちょうど差の数）を、実行したStepの主Target（executor）と、
その領域にrequired unitを持つTarget（forcing）へ帰属した。

| stream | 領域 | 実行した操作 | forcing Target数 | 静的peel（遠い順にoptimum Routeへ置換したときの残り超過） |
| --- | --- | --- | ---: | --- |
| Skill | 1424〜4356（2,933） | reset_skills 2,925、convert 8 | 14 | 2,923 → 2,012 → 1,760 → … → 721 → 14 → 0 |
| Gogma | 290〜3164（2,875） | keep 1,900、reset 975 | 24 | 2,865 → 2,864 → 2,863 → … → 297 → 141 → 0 |
| チャアク | 207〜849（643） | create 643 | 1（813fb479、extent fallbackのN849） | 0 |
| スラアク | 1〜241（241） | create 241 | 1（6c65c924、N241） | 0 |
| 大剣 | 156〜276（121） | create 121 | 1（46bf2c78、新規N276） | 0 |
| 双剣 | 475〜525（51） | create 51 | 1（86439c85、新規N525） | 0 |
| 片手剣 | 12〜24（13） | create 13 | 2 | 1 → 0 |

- Skill / Gogmaの超過は多数のTargetに分散しており、**単一Targetの置換では縮まない**（Skill・Gogmaとも1件目の置換で10位置）。
  「最大寄与Target」は存在せず、終端は次々に別Targetのrequired位置で支えられている。
- peelは **Route集合上の静的counterfactual** であり、Planner実行・stream被覆（schedulerのstall条件）・source排他を検証したものではない
  （peelの各行に、置換先optimumのsourceを未置換のautonomous Routeが使っているかも記録した）。
- executor帰属（実行した主Target）はforcing帰属と一致しない: 例えばGogma超過をe96249b4 / c140578c等が多く実行しているのは、
  それらが逐次射影の途中でGogmaを長く進めたRouteだからで、終端を押し上げているのは後続のTargetである。

### 6.6 逐次射影による積み上げ（主要な構造要因）

| 区分 | physical operation |
| --- | ---: |
| retained original Entry（20）のRouteが実行 | 1,465（Gogma 376、Skill 1,083、片手剣 6） |
| generated（base Search 22）のRouteが実行 | 6,173 |
| generated（extent fallback 1）のRouteが実行 | 896 |

retained由来1,465はPhase 2-Aのbaseline / retained prefixのPlan長（1,465 steps）と同じである。generated Route 23件の
Gogma / Skill区間37件は **すべて、retained prefixと先行generated Routeの終端（frontier）以降から始まる（37/37）**。
各generated Searchが「前Targetまでを適用した射影状態」から最初のIdealを探すため、各Targetの完成位置が前Targetの終端の後ろへ
積み上がる。これが超過の主要な構造要因である。ただしgenerated Routeがどの位置で完成するかは、そのTargetのsource・新規Normal位置・
Route形（held Routeの有無）にも依存し、それらの選択肢を持たないこと（7・8章）も差に寄与している。

## 7. Target / Route 比較

全43 Targetのmachine-readable比較は `PLANNER_GLOBAL_PHASE2B_RESULTS.json` の `gap.targets`（source、RouteKind、Route ops、
estimated advance、stream別first / last / required / 連続性、entry種別、discovery順、1,657側のmaterialize種別、held位置、
per-stream earliest threshold）。IDは分析結果として記録したもので、algorithmへは入れていない。

### 7.1 generated 23 Target（discovery順）

CS = Candidate Search、PA = Planner Alternative Search（1,657側のmaterialize）。per-stream最早thresholdは、Phase 2-A.5 lower-bound監査の
値を **streamごとに独立に** 見たもの（最後の位置 + 1）で、GogmaとSkillの値が同じsource / Routeで同時に達成できるとは限らない。

| # | Target | 種別/属性 | source関係 | auto Route ops | auto Gogma | auto Skill | per-stream最早threshold G / S | 1,657 Route ops | 1,657 Gogma | 1,657 Skill | materialize |
| ---: | --- | --- | --- | ---: | --- | --- | --- | ---: | --- | --- | --- |
| 0 | be881717 | great_sword/dragon | 同一所持 | 156 | 431–586 | — | 114 / 341 | 2 | 67–269 | — | PA |
| 1 | e96249b4 | hammer/paralysis | 同一所持 | 343 | 587–929 | — | 90 / 341 | 2 | 94–211 | — | PA |
| 2 | 9733b090 | heavy_bowgun/water | 同一所持 | 216 | 930–1145 | — | 121 / 341 | 2 | 146–165 | — | PA |
| 3 | 2e26c0b1 | dual_blades/fire | 所持→新規N | 139 | 1146–1284 | — | 99 / 341 | 3 | 98 | 422 | CS |
| 4 | a6c17e25 | dual_blades/fire | 別所持 | 71 | 1285–1341 | 1424–1437 | 61 / 341 | 3 | 116–161 | 588 | PA |
| 5 | c140578c | dual_blades/thunder | 同一所持 | 330 | 1342–1671 | — | 153 / 341 | 2 | 70–168 | — | PA |
| 6 | 57126a5e | great_sword/paralysis | 同一所持 | 222 | 1672–1893 | — | 73 / 341 | 1 | 219 | — | CS |
| 7 | 27ac3237 | dual_blades/thunder | 同一所持 | 162 | 1894–2055 | — | 153 / 341 | 2 | 149–247 | — | PA |
| 8 | a830a376 | dual_blades/water | 所持→新規N | 783 | 2056–2131 | 1438–2144 | 59 / 397 | 3 | 130 | 396 | CS |
| 9 | 02876df4 | sword_and_shield/fire | 所持→新規N | 279 | 2132–2409 | 2145 | 174 / 364 | 7 | 173 | 363 | CS |
| 10 | 8d233d8b | sword_and_shield/thunder | 新規N→所持 | 98 | 2410–2492 | 2146–2148 | 181 / 342 | 2 | 210 | 341 | CS |
| 11 | 46bf2c78 | great_sword/fire | 新規N→所持 | 234 | 2493–2568 | 2149–2185 | 75 / 341 | 2 | 101–288 | — | PA |
| 12 | b27e57a7 | dual_blades/thunder | 同一所持 | 363 | 2569–2650 | 2186–2466 | 153 / 341 | 2 | 153 | 566 | CS |
| 13 | b6780f04 | dual_blades/fire | 新規N→所持 | 57 | 2651–2660 | 2467–2503 | 74 / 341 | 2 | 164 | 485 | CS |
| 14 | fea60316 | dual_blades/dragon | 同一所持 | 156 | 2661–2816 | — | 118 / 341 | 2 | 159–224 | — | PA |
| 15 | 2378d3e0 | dual_blades/water | 新規N→所持 | 593 | 2817–2889 | 2504–2954 | 100 / 397 | 2 | 287 | 892 | CS |
| 16 | 45b13c06 | dual_blades/ice | 別所持 | 138 | 2890–3027 | — | 72 / 341 | 3 | 235–277 | 708 | PA |
| 17 | 711f7d15 | charge_blade/fire | 新規N別位置 | 338 | 3028–3031 | 2955–3081 | 56 / 400 | 237 | 55–289 | 399 | CS |
| 18 | 6c65c924 | switch_axe/paralysis | 新規N別位置 | 271 | 3032–3033 | 3082–3108 | 76 / 411 | 4 | 72–267 | 410 | PA |
| 19 | 188571a7 | dual_blades/ice | 同一所持 | 194 | 3034–3152 | 3109–3183 | 72 / 649 | 2 | 71 | 786 | CS |
| 20 | 813fb479 | charge_blade/dragon | 新規N別位置（fallback） | 896 | 3153 | 3184–3435 | 56 / 479 | 209 | 230 | 478 | CS |
| 21 | 1efa01c6 | great_sword/paralysis | 同一所持 | 912 | 3154 | 3436–4346 | 78 / 758 | 2 | 137 | 757 | CS |
| 22 | 86439c85 | dual_blades/ice | 新規N→所持 | 118 | 3155–3164 | 4347–4356 | 156 / 649 | 3 | 133–193 | 740 | PA |

- 同一所持武器のまま（10件）でも、autonomousは射影frontier以降で長いReset / Keep連鎖を回して初めてIdealに届き、1,657は同じ武器を
  G67〜G247付近の1〜2操作で完成させる。このTarget群ではsource選択より **探索の起点と位置の割当** が差を決めている。
- 1,657のGogma完成位置は多くのTargetでそのTargetのGogma最早thresholdより後にある（例: be881717はGogma最早threshold 114に対し
  G269、711f7d15は56に対しG289）。これはGogma stream単独で見た最早位置を採らないことを示すだけで、Gogma・Skill両方で
  最早となる単一Routeの存在は示さない。

### 7.2 retained 20 Target

retained Route（originからのCandidate Search）は20件ともstream originから連続chainで始まり、完成位置（最後のrequired位置）は1,657と
多くが一致する（例: 0d98b225 G201、155a6831 G117、a367c177 S1423）。1,657との差は、所持→新規N（070a1222: 所持でG430 → 新規N474でG77、
cbdf9d8f: 所持G71 → 新規N413でG88）、新規N→所持（820831d0）、別の完成位置（a26f6bcf G153 → G216、b4f252cd G224 → G242）、
別の所持武器（1f121742、同じG144）で、Gogma終端を超えるのは070a1222（G430 > 289）だけである。

## 8. 差分カテゴリ（`gap.categories`、機械判定）

| カテゴリ | Target数 | 意味 |
| --- | ---: | --- |
| autonomous generated（base 22 + fallback 1） | 23 | 逐次射影で探索されたTarget。全37 stream区間がfrontier以降（6.6） |
| extends_beyond_optimum_end: Gogma / Skill | 24 / 14 | autonomous Routeのrequired unitが1,657終端より先にある（終端を押し上げる） |
| extends_beyond_optimum_end: Normal（チャアク / スラアク / 大剣 / 双剣 / 片手剣） | 1 / 1 / 1 / 1 / 2 | Normal超過を決めるTarget |
| within_every_optimum_stream_end | 18 | どのstreamでも1,657終端内に収まる |
| source: 同一所持 / 所持→新規N / 新規N→所持 / 別所持 / 新規N別位置 | 26 / 5 / 6 / 3 / 3 | source変更は17件 |
| route_kind_changed | 13 | RouteKindが異なる |
| optimum_crosses_held_positions | 18 | 1,657のRouteがheld位置を跨ぐ（Reset→保持→Keep。= Planner Alternative Search materialize 18件） |
| optimum_relies_on_shared_coverage: Gogma / Skill | 42 / 23 | 1,657のRouteがstream originより後から始まり、他Routeの被覆でCounterが届く |
| autonomous_starts_after_stream_origin: Gogma / Skill | 23 / 14 | autonomousで同様（ただしfrontier以降のため、終端を延ばす） |
| optimum_finishes_after_per_stream_earliest_threshold: Gogma / Skill | 35 / 12 | 1,657のRouteが、そのstreamの最早threshold（streamごとに独立）より後で終わる。global optimumが各streamの最早thresholdを必ずしも採用しないことを示す。Target単体Routeの最小との比較ではない |
| optimum_route_locally_longer | 0 | 1,657のRouteがautonomousより長いTargetは無い（autonomous Routeが積み上げで長いため） |

Phase 2-A.5で知られたチャアク火 / 龍の非対称（火 N0 → G55〜289 Reset連鎖、龍 N206 → G230 Keep）は、このカテゴリでは
「新規N別位置」「optimum_finishes_after_per_stream_earliest_threshold:gogma」「Normal超過 643 = 龍のextent fallback N849」として現れる。
generic algorithmとしては扱っていない（ID・位置はどこにもhard-codeしていない）。

## 9. 2,982 historical oracle

Repository内には2,982の集約値（「18件維持・25件置換、約33秒」、Phase 0 / 1文書）しかなく、machine-readableなRoute詳細は無い。
過去チャットからの再構成はしていない。比較は集約値に留める:

| | physical operation |
| --- | ---: |
| autonomous − historical | 8,534 − 2,982 = **5,552** |
| historical − proven minimum | 2,982 − 1,657 = **1,325** |

## 10. final Planner 性能の分解（measured commit `38b8d7f`）

### 10.1 timing（Browser Worker、measurement 3回の中央値）

| 区分 | 値 |
| --- | ---: |
| round trip | 85.7秒（86.8 / 85.7 / 85.5） |
| Research計算 | 85.4秒 |
| Search（fallback込み） | 44.0秒 |
| Planner（26 full call合計） | 36.0秒 |
| post-calculation evidence / plan evidence | 0.32秒 / 0.03秒 |

26 callのphase（中央値、ms）:

| call | 回数 | 合計 | scheduler prepare | scheduler loop | Trace Replay | execution projection | PlanningInputSnapshot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1 | 3,712 | 1,158 | 643 | 242 | 1,636 | 10 |
| retained prefix | 1 | 2,783 | 498 | 431 | 243 | 1,606 | 7 |
| 単体Candidate適用 | 23 | 10,960 | 938 | 192 | 1,878 | 7,933 | 20 |
| **final** | 1 | **18,538** | **1,441** | **4,205** | **2,152** | **10,712** | **15** |
| 合計 | 26 | 35,993 | 4,035 | 5,471 | 4,515 | **21,887** | 52 |

final callのその他: scheduler finish 0.05 ms、runtime-unsupported retry判定（Trace Replay内、全26 callでretry 0回）、post-processing 0.01 ms、
checkpoint defence 0.28 ms、rejected Build List 1.17 ms、required materials 0.01 ms、Plan assembly（structuredClone含む）0.02 ms。
final scheduler loopは8,535 iteration・133 yieldで、yield間の最長同期区間は1.49秒（中央値、scheduler prepare = 初回yield前の区間）。
final callのscheduler最終yield以降からcall終了までの同期区間は12.9秒（中央値）。

Node（Vite SSR、参考、used run）でも同じ順位: final call 24.6秒 = prepare 2.21 / loop 5.86 / Trace Replay 2.90 / **projection 13.58** 秒。

### 10.2 responsiveness（別run、chained ping）

| ping数 | lost | 中央値 | p95 | 最大 | 100 ms超 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 39,129 | 0 | 0.25 ms | 6.6 ms | **13,337 ms** | 36回 |

ping送信・受信時刻（main realm `timeOrigin + now()`）とWorker timeline（Worker realm `timeOrigin + now()`）を対応付けた。
`accepted` の時計差（main受信 − Worker送信）は0.07 msで、両realmの時計は揃っている。

| ping遅延 | 重なったWorker区間 |
| ---: | --- |
| **13,337 ms（最大）** | final Trace Replay 2,127 + **final execution projection 10,814** + Worker evidence 343 + 他 < 50 ms |
| 3,469 ms | baseline Trace Replay 240 + projection 1,623 + retained prefix scheduler prepare 491 + Research処理 1,045 |
| 2,587 ms | retained prefix Trace Replay 236 + projection 1,604 + Research処理 729 |
| 1,721 ms | 単体Candidate適用 Trace Replay 254 + projection 1,075 + Research処理 389 |
| 1,653 ms | final scheduler prepare 1,408 + 直前のprojection 133 |
| 1,176 ms | baseline scheduler prepare 1,075 |
| 1.0〜1.5秒級 | 各単体Candidate適用のTrace Replay + projection |

**Worker event loopの最大無応答はfinal callのTrace Replay + execution projection（連続した同期区間）であり、scheduler loopではない。**
2番目の原因はscheduler prepare（Route commitment等、初回yield前の同期区間、最大約1.4秒）。
「Research処理」はfull call後の射影・次Searchの準備などPlanner外のResearch側同期処理で、Phase 2-Bのtimelineでは区間を持たない（unattributed）。

### 10.3 memory（別run、scopeを区別）

memory runはtiming runと分けた。pageの `measureUserAgentSpecificMemory()` はrun外の固定点だけで取り（実行中の周期samplingはしない）、
Worker heapは外部CDP driverが取った。

| scope | 観測 |
| --- | --- |
| Worker isolate JS heap（CDP `Runtime.getHeapUsage` usedSize、約100 ms毎、未回収garbageを含む、sampled max） | run全体の最大 **1.733 GiB**（1,097 sample）。final call: prepare中 ≤205 MiB、loop 199〜248 MiB、Trace Replay ≤269 MiB、**projection 259 → 1,750 MiB**（97 sample）、以降 1,728〜1,774 MiB |
| page + Worker（`measureUserAgentSpecificMemory`、GC後のlive相当、固定点） | Worker作成前 12.0 MB（Worker 0）、ready後 13.5 MB（Worker 1.4 MB）、result直後 17.0 MB（Worker 4.4 MB）、dispose後 12.6 MB（Worker 0） |
| main realm（`performance.memory`） | 約11.1〜11.8 MB |
| Browser process（Windows、最大PrivateMemorySize64のChrome process、約1秒毎） | max sampled **4.257 GiB**（WorkingSet 4.298 GiB、222 sample） |
| Node参考: v8 used heap（GCなし、phase境界で同期取得） | final call開始 446 MiB → scheduler後 607 → Replay後 881 → **projection後 2,576 MiB** |
| Node参考: v8 used heap（phase境界で `gc()` 後 = live） | 開始 68 MiB → scheduler後 88 → **Replay後 198**（drafts保持）→ projection後 228 → call終了 117 MiB |

- CDP sampleの時刻はdriverの `Date.now()`（要求と応答の中点）で、Worker realmの `timeOrigin + now()` との差 +0.69 ms を補正した。
  連続peakではなくsampled maxである。
- **heap増加はほぼexecution projectionだけ** で起き、Trace Replayの保持（drafts）は約110 MiB、Planの保持増は約30 MiB（Node live）。
  projectionのused heap急増（Browser +約1.46 GiB、Node +約1.7 GiB）はGC後にはほとんど残らない一時allocationである。
- コード読解による構造的観測（計測値ではない）: `projectProductionPlanExecution()` は各Stepの前後で全RngState・全Normal Counter・
  全inventory・全Targetのsnapshotを `structuredClone` して保持し（2 × Step数）、全Step分を作り終えてから各snapshotをhash化する。
  したがって時間と一時memoryはStep数 × (所持武器 + Target) に比例し得る。8,534 stepsではこれが支配的になる。
  1,657 stepsのPlanでもprojectionは同じ構造だが、Step数が約1/5になる。

### 10.4 性能のまとめ

| 質問 | 答え |
| --- | --- |
| 「final Planner 36秒」は何か | 26 full call合計（36.0秒）。final callは18.5秒 |
| 最大の時間 | execution projection（26 call合計21.9秒、final 10.7秒） |
| 最大無応答13.3秒はどのphaseか | final Trace Replay + execution projection |
| memory増加はどのphaseか | final execution projection（+約1.46 GiB sampled、GC後はほぼ残らない） |
| schedulerは | loop 4.2秒は64 actionごとにyieldし応答性を壊さない。prepareは最大約1.4秒の同期区間 |

## 11. Phase 2-Cへ渡す必要能力（優先順位ではない）

観測に基づき、8,534から1,657へ近づくために必要な能力を整理する。Phase 2-Cのalgorithmはまだ実装していない。

1. **射影frontierではなくPlanner-start originから、他Targetの位置予約を考慮して候補を作る能力**。
   根拠: generated 37/37区間がfrontier以降、超過6,877の大部分がgenerated Routeの積み上げ（7,069 physical）（6.6、7.1）。
2. **held位置を跨ぐRoute（Reset → 保持 → Keep）を候補にする能力**。根拠: 1,657の18 Route（Planner Alternative Searchでmaterialize）。
   Candidate Searchの連続Routeだけでは同じ武器を早い位置で完成できない（Phase 2-A.5でも確認）。
3. **Targetごとに複数候補（所持 / 新規Normal、別の所持武器、別のNormal位置、held Routeを含む）を同時に持ち、全体で割り当てる能力**
   （Candidate portfolio + global assignment）。根拠: source変更17件、Normal超過の大半は新規Normal位置の選択
   （チャアク N849 vs N206 / N0、スラアク N241 vs N0、大剣 N276 vs 所持）、チャアク火 / 龍の非対称Route（火は新規N0 → Reset連鎖、
   龍は新規N206 → Keep）、Planner Alternative Search materialization 18件。Targetごとのlocally shortest Candidate 1件だけでは
   これらの組合せを表現できない、という仮説はこれらの証跡に基づく（per-stream earliest thresholdだけを根拠にしない）。
4. **全体の物理操作数（= stream終端の和）でRouteを選ぶ能力**。根拠: physical operation = Σ(stream終端 − origin) が両Planで恒等的に成立し（6.4）、
   目的関数をstream終端で評価できる。1,657ではGogma 35 / Skill 12 Targetが、そのstreamの最早thresholdより後で終わる
   （各streamの最早位置を必ずしも採らない）。
5. **stream被覆（shared coverage）を前提にした評価**。根拠: 1,657では42 Gogma Route / 23 Skill Routeが他Routeの被覆に依存し、
   Route operation単純和とphysicalの差（88）は小さい一方、autonomousでは各Routeが自前chainを持ち差2,538。
   schedulerのstall条件（streamの各位置にunitが要る）を満たす被覆Route（長いskip可能chain）の選び方も対象になる。
6. **多Targetに分散した終端の同時最適化**。根拠: Skill 14 / Gogma 24 Targetが終端を押し上げ、1件の置換では縮まない（6.5 peel）。
   1 Targetずつの改善（retry / release）では届きにくい。
7. **performance（Production化の前提）**: Plan長の短縮は時間・memory・`maxPlanSteps` を同時に改善する（projectionがStep数に比例する構造）。
   それとは別に、execution projectionのsnapshot保持とTrace Replay + projectionの長い同期区間（最大13.3秒）は、
   Plan長に関係なく長いPlanで問題になる。scheduler prepareの同期区間（最大約1.4秒）も同様。

## 12. テスト

- `src/domain/planner/productionPlanGenerationPhaseObserver.test.ts`: observer有無・observerなしで `PlannerResult` が完全一致（`toEqual` と
  `JSON.stringify` 一致）、phase順、runtime-unsupported retryでTrace Replayが各full runに1回、plan nullでtail phaseを出さない、
  observerの例外伝播。
- `src/benchmarks/plannerGlobalPhase2B.test.ts`:
  - timeline: **`yieldControl()` が元のPromiseそのもの（`toBe` でidentity一致）を返す**、resolve時にtimeline（segment開始）が更新される、
    reject時に元のrejectionがそのままcallerへ届き観測状態を壊さない、wrapperがasync関数でない、`shouldCancel` の戻り値不変、
    無いhookは無いまま、phase時間の合計が呼び出し時間と一致、ping / heap sampleの区間帰属（未帰属を捏造しない）。
    identityテストは旧async wrapperでは失敗することを確認した。
  - 実Production Engineのfixtureで、Worker controllerの `phase2b` 有無でsemantic SHA・evidence・semanticが完全一致、timelineが全full callを含む
  - physical要約: `confirm_owned_ideal` を数えない、streamごとのadvance、identity、2 Counter同時advance・advanceなしphysical・
    debug位置不一致でfail closed
  - gap分析: 操作種別差の和 = 全体差、stream差の和 = 全体差、Route operationとphysicalを分離、超過領域のexecutor / forcing、peel、
    Target IDをevidenceから導出（合成fixtureの任意文字列）、不整合でfail closed、未使用stream `{first: null, last: null, operations: 0}` を
    使用なしと扱う、**per-stream earliest thresholdをstreamごとに独立に判定しTarget単体Route最小と扱わない**（カテゴリ名にも
    single-Target / route minimum / locally shortestの意味を持たせない）
  - isolation: Phase 2-B algorithm側がoracle manifest / verifier / lower-bound / 1,657 JSONをimport・読込しない、UUID / 64桁hexを持たない、
    runnerが `--optimum` を持たず分析scriptだけが引数で受け取る、Productionから到達しない、Production側の変更は任意observerだけ
- 既存: Phase 2-A isolation（Production default・schema・version不変）、Phase 2-A.5 oracle isolation、Issue #103 seam boundary testは成功。

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 305 files / 4,863 tests passed |
| `npm run build` | passed（既存の500 kB超chunk warningのみ）。`dist` にPhase 2-B / Research識別子なし（`plannerGlobalPhase2B`、`pg2a_benchmark`、`research.global`、`runGlobalPlannerResearch`、`perStreamEarliest` をgrep）。Production bundleに入るのは任意observer呼び出し名 `onPlanGenerationPhase` だけ |
| benchmark build | passed（同warningのみ） |
| `git diff --check` | passed |

## 13. 証跡

- [PLANNER_GLOBAL_PHASE2B_RESULTS.json](PLANNER_GLOBAL_PHASE2B_RESULTS.json): post-hoc分析の出力。`provenance`（measured commit、benchmark code SHA、
  未commitなし、Export SHA、Browser / OS / CPU / memory、RNG Engine、Calculation schema、workload、Research / Production `maxPlanSteps`、run回数、
  Node runのcommit）、入力ファイル名・bytes・SHA-256、semantic parity（全run）、gap（操作種別・stream・Route vs physical・終端モデル・
  超過領域の帰属とpeel・entry種別帰属・stacking・43 Target比較・カテゴリ）、timing（各measurementの26 call phase、中央値）、
  responsiveness（遅いpingと重なった区間）、memory（CDP sampleのphase対応、page固定点、OS）、Node参考（used / gc heap）。
  Export全文・Plan全文は含まない。
- [PLANNER_GLOBAL_PHASE2B_EXTERNAL_MEMORY.json](PLANNER_GLOBAL_PHASE2B_EXTERNAL_MEMORY.json): memory runのCDP Worker heap sample（1,097件）、
  OS process sample（222件）、時計校正。
- raw（commitしない、`.local`）: Browser page export、Node used / gc run。ファイル名・bytes・SHA-256は結果JSONの `sources` に記録。
  CDP driverはscratchpadの計測toolingでcommitしていない。
- 再生成: `node scripts/analyze-planner-global-phase2b.mjs --browser <raw> --external-memory docs/PLANNER_GLOBAL_PHASE2B_EXTERNAL_MEMORY.json
  --node <node-used> --node-gc <node-gc> --optimum docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --output <new.json>`

## 14. 未確認事項

スマートフォン・他Browser、別Export、peelのPlanner実行による検証（被覆・source排他・scheduling）、Target単体Routeとしての最短（GogmaとSkillを
同時に満たす単一Routeの最小）の算出、execution projection内部の関数別内訳（CPU profile）、Research側のPlanner外同期処理の区間分解、
連続的なmemory peak、sampling間のpeak、timelineなしcontrolの複数回測定。既存のreference-verified / game-verified / unverifiedの境界は拡張しない。
