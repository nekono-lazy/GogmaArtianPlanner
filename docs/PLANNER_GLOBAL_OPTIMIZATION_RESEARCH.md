# Global Planner Research Phase 0

Refs #154。基準 main: `ede57c81e2d59afdf44351c4e9aff70e9692ed79`（Phase 6-B2b完了）。

## 目的と境界

元のBuild Listから、ユーザーが個別Conflictを選択せず全planning Targetを共存させるRoute集合を
自動構成できるかを調べる。優先順位は全Target完成、Conflict 0、resource conflictによる脱落0、
Trace Replay成功、計算時間。その後に手数を評価する。global optimumを探索・証明しない。

これはResearch / benchmark専用コードである。Production routing、UI、Worker protocol、通常Candidate
Search、永続化、Target条件、preferredOwnedWeaponId、RNG semantics、全versionを変更しない。
REQUIREMENTS 19 / 23の「明示的選択なしに自動再検索しない」というProduction契約は維持する。
Phase 6で削除された `src/domain/planner/constrained/`、B8 / B9 orchestration / what-ifを復活させない。

対象Exportは `gogma-artian-planner-backup_20260927015837.json`。ファイルの所在はrunnerへ明示する。
19 MBのExport、生成Candidate、生成Planをrepositoryへ保存しない。元の43 Target / 43 Entry、
同一OwnedWeaponへの複数Route、21 Conflict、Candidate Search時のRouteをそのままbaselineへ渡す。
Issue #157の事前整理は行わない。Exportの保存済みPlanやoracle Routeは探索入力に含めない。

Issueの2,982 steps（18件維持・25件置換、約33秒）は比較用の既知oracleであり、今回の保持集合、
Target順序、Counter位置、RouteKind、Candidate IDの決定には使わない。2,982以下は成功条件ではない。

### Planner boundとBaselineの意味

Phase 0は探索成立性とSearch / Plannerの性能切り分けのため、Research専用に
**`maxPlanSteps = 20000` を明示指定**している。本書のBaselineはProduction Domain / ordinary Plannerと
同じ計算経路を使うが、**Production default boundそのものではなく、Research用20000で実行したbaseline**である。

現在のProduction defaultは `defaultPlannerOptions.maxPlanSteps = 1000`
（`src/domain/planner/plannerTypes.ts`、PLANNER_SPEC 7.2.1）。20000はこの既定値を表さず、変更もしない。
Applicationにはruntime上限の導出・ユーザー設定があるため、1000は全画面に共通する固定上限でもない。
今回のbaseline **1,465 steps**、prototype **7,330 steps**、比較用の既知oracle **2,982 steps**は
いずれも1000を超え、この測定はProduction default bound内での成立を示していない。

Production化にはGlobal Planner用のstep bound policy、Application側の上限設定、
またはPlan生成方式を別途設計する必要がある。このPRではそのProduction policyを決定しない。

## 現行authorityの調査

| 用途 | 再利用するauthority |
| --- | --- |
| ordinary Planner、unsupported retry、Trace Replay、execution projection | `createProductionPlanWithObserver()` |
| 入力・Entryの可否 | `validatePlannerInput()`、`validateBuildCandidate()`、`validateBuildListEntry()` |
| 元の起点と意味正規化 | `replacement/plannerSearchOrigin.ts` |
| 安定ID、intermediate groups、collision / reuse | `replacement/plannerDeterministicMaterializer.ts` |
| Ideal確認、Route、estimate、素材、両hashの構築 | `search/constrained/constrainedCandidateFactory.ts` の `createConstrainedCandidate(..., 'origin_reach')` |
| canonical Ideal発見 | 変更しない通常の `searchCandidates()`、ProductionRngEngine |
| Planの仮想適用 | Plan start effects、`applyExpectedStepTransition()`、`createActualExecutionState()` |
| 順序 | `comparePlannerEntryPriority()` |

`search/constrained/` のtransient Candidate factoryは現行Planner Alternativeも使用している共有primitive。
削除された `planner/constrained/` の制御経路ではない。Planner Alternative自体を呼ばないのは、今回の
仮説が「先頭のRoute集合を完成してから検索する」という、reservation内の空きを探さない最小構成だからである。

PLANNER_CONFLICT_REPAIR_DESIGN 3.1は、Productionの競合repairとして単一の将来状態から検索すると
前段の空き位置を失うことを指摘している。本実験もその制限を持つ。既存Alternativeの置換として
Productionへ導入したものではなく、Search discoveryとschedulerの所要時間を分離するための実験である。

## アルゴリズム

1. Exportのpure schema / collection / Master validationを通す。Import serviceやIndexedDBを呼ばない。
   元のRNG、Normal Counter、OwnedWeapon、Target、Build Listを複製し、現行CalculationContextと
   明示的なResearch用 `maxPlanSteps`、空のConflict resolutionsを付ける。
2. 元Build Listをordinary Plannerへ渡してbaselineを測定する。observerはrun結果を読むだけ。
3. baselineのselected Entryと、実際のtraceのprimary / progressed Entryの和集合を保持候補とする。
   当初の競合から数やIDを決めない。非進行Entryを除くとschedulingが変わり得るため、この集合だけで
   ordinary Plannerを再実行する。全保持Target完成・Conflict 0・rejected 0でなければ
   `blocked` とし、このPhaseでは保持集合を最適化して救済しない。
4. Replay済みPlanのstart effectsと各Stepを純粋に仮想適用する。各Stepの前後を既存expected-state
   authorityで照合する。既存武器は同じID、Targetリンクと完成・保護は既存transitionどおり。
   blind観測を必要とするStepには値を捏造せず拒否する。
5. 残りの有効Entryを既存 `comparePlannerEntryPriority()` で一度だけ並べる。
   priority降順 → 次候補距離降順 → 元CandidateのestimatedOperationCount昇順 → Entry ID安定順。
   1 Target = 1 Entryの通常入力では次候補距離は0。乱数やoracle順序は使わない。
6. 各Targetをその時点の投影状態から `routeFilter = all` で通常Searchする。extentは明示的に
   **Normal 350 / Gogma 500 / Skill 1500**。自動拡大しない。既存のcanonical Ideal、RNG、factory、
   Route validation、素材計算を使う。選択済みcheckpointのある未保持Entryは `checkpoint_blocked` とし、
   pinを解除・移植しない。改善優先も既存Entryへ書き戻さない。
7. Candidateを検証し、originに対してtransient Candidateとgenerated Entryを再構築する（下記）。
   さらに投影状態でそのCandidateを単体ordinary Planner + Trace Replayに通し、同じStep transitionで
   次の投影状態へ進める。失敗時には状態を採用しない。次Targetへ進み、同じTargetの第2候補は探さない。
8. 元の全Entry集合で、成功したTargetだけをgenerated Entryへ置換した一時入力を作る。
   失敗・未発見Targetの元Entryは残す。対象を削ってConflictや完成率を良く見せない。
9. 元のPlanner-start状態から全Entryをordinary Plannerへ一括で再実行する。
   最終Planは既存のTrace Replayとexecution projectionを通過したものだけ。

full Planner回数にはbaseline、保持集合確認、各Candidate単体適用、最終一括run、内部unsupported retryを
すべて数える。最小構成として速度より既存authorityの再利用を優先しており、単体適用も独自schedulerで
省略していない。Search elapsed、各単体Planner elapsed、最終Planner elapsedを別々に報告する。

## Research専用materialization adapter

将来状態のCandidateの `searchStateHash` だけを書き換える方式は採用しない。

- 元Candidateの構造、投影状態に対するfreshness、元Targetと投影Targetの性能定義の一致を検証する。
- Routeが参照する武器は元のOwnedWeapon集合に存在し、参照hashも元状態と一致する必要がある。
  前段で作られた武器への参照や、前段で性能・保護が変わった武器の再利用はmaterialization不能として報告する。
- 予測済みの絶対Counter位置と結果をtransient predictionとして既存factoryへ渡す。
  元Planner起点からのadvance（origin reach）、素材、Ideal判定、Route validation、両hashを再構築する。
  Search時の相対advanceと、materialize後の元起点からのadvanceは同じ値とは限らない。
- deterministic materializerが新しいCandidate ID / Entry ID / search identityとintermediate groupsを構築する。
  Search identityには元起点・投影起点の正規化、extent、route filter、CalculationContextを含める。
  Prediction traceは再抽選せず引き継ぎ、元Candidateをmutateしない。
- 組み直したEntryをoriginに対するPlanner validationへ通す。これは共存証明ではない。
  必要なCounter進行が本当に前段で供給されること、全Routeの共存は最終full Planner + Trace Replayで確認する。

adapterと仮想状態は `src/benchmarks/` に閉じる。通常アプリからimportされず、保存APIを持たない。
途中のCandidateはProductionへ採用できる結果として公開しない。

## 実行方法と計測定義

```powershell
node scripts/run-planner-global-research.mjs --export "<外部Exportの絶対path>" --output "phase0-results.local" --max-plan-steps 20000
node scripts/run-planner-global-research.mjs --export "<外部Exportの絶対path>" --output "phase0-cancel.local" --max-plan-steps 20000 --cancel-after-ms 100
```

Node runnerはVite SSR loaderで既存TypeScriptを読み、同じDomainのasync関数を直接実行する。
**Browser Worker benchmarkではない**。Browser Workerの時間・メモリ・UI応答性は未測定。
`yieldControl` は既存seamに `setTimeout(0)` を渡し、SIGINT / `--cancel-after-ms` は
`shouldCancel` で扱う。synchronousなReplay / projection中は即時cancelを保証しない。
outputは新規作成専用で、入力Exportや既存reportを上書きしない。
既存outputはResearch開始前に明示エラーで拒否する。既存 `.progress.local` もexclusive creationで拒否し、
input / output同一pathの拒否を維持する。実行中に他processがoutputを作る場合に備え、最終writeも `wx` を維持する。

- `totalElapsedMs`: 検証済みPlannerInputを受け取ってから結果まで。baseline、保持集合確認、Search、
  materialization、単体Planner、投影、最終Plannerを含む。Vite起動・Export読込とschema / Master validationは含まない。
- `plannerElapsedMs`: すべてのPlan generation（scheduler + Replay + execution projection）の合計。
  `final.elapsedMs` は最終一括generationだけ。scheduler単独の時間ではない。
- `searchElapsedMs`: 通常Candidate Searchの合計。各Targetも個別記録する。
- `observedPredictionReach`: Search中に実Engineへ渡った最大Counter位置 + 1をSearch開始Counterから測る。
  軸をまったく予測しなければ0。instrumentationは引数と戻り値を変更せず、追加予測もしない。
- `predictionBoundaryReached`: Normal / GogmaはM番目の予測を観測したか。Skillは既存巨戟のReset窓
  （origin + M - 1）と巨戟化後のReset窓（origin + M）を区別して記録する。
  これは指定窓の端のCounterを予測した事実であり、そのRoute種別を全探索した証明や、内部の枝刈り理由ではない。
  canonical Idealが先に決まればfalseのまま終わる。通常Searchは内部のtyped extent-stopを返さないため、
  その停止理由自体は未測定。候補なしは `not_found_within_extent`、全経路利用不可は `unavailable`、
  例外は `search_error` と分け、「Idealが存在しない」と解釈しない。
- memoryはNode process全体のmaxRSS。Vite loader、Export parse、入力cloneを含み、Domain単体のpeakではない。
- raw reportは外部ファイルのSHA-256、環境、元入力fingerprint、保持ID、生成ID、各Targetのroute kind・操作量・
  advance・予測到達量・skip理由・失敗を持つ。Exportの状態・Seed・全Routeをreportへ埋め込まない。

## 測定結果

2026-09-27、実Exportを読み込んで最終コードを単独実行した結果。
Windows x64、Node v24.19.0、Ryzen 7 9700X（16 logical CPU）、物理memory約31.1 GiB。
`maxPlanSteps = 20000`、Search extentは350 / 500 / 1500。正式な性能測定は1回で、分布は未測定。
開発中にtestと並行した試行値は性能評価へ使わない。

入力は19,424,064 bytes、SHA-256:
`cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`。
数値・完全なTarget ID・保持ID・generated ID・各探索の証跡は
[NODE_RESULTS](PLANNER_GLOBAL_OPTIMIZATION_NODE_RESULTS.json) に保存した。Export自体は含めない。

| 項目 | Research baseline（bound 20000） | Global prototype（bound 20000） |
| --- | --- | --- |
| 入力Target / Entry | 43 / 43 | 43 / 43 |
| 完成Target / 全planning Target | 20 / 43 | **42 / 43** |
| selected | 20 | 42 |
| Conflict | 21 | **2** |
| rejected / resource conflict | 23 / 23 | **1 / 1** |
| steps / expandedStates | 1,465 / 1,485 | **7,330 / 7,372** |
| Planner elapsed | 6.745秒 | 最終一括run **30.577秒** |
| Trace Replay | passed | **passed** |
| reached Planner limits | なし | なし |

BaselineのConflict内訳はGogma 15、Skill 3、OwnedWeapon 2、Normal 1。
最終はNormal 1、Skill 1。いずれもPlanner terminationは `exhausted` であり、
maxPlanStepsで切られた `incomplete` ではない。

- 元Entryの保持: **20**。保持集合だけの再実行は20 / 20、Conflict / rejected 0、1,465 steps、5.807秒。
- 再検索Target: **23**。発見・materialize・単体Planner検証成功: **22**。generated replacement: **22**。
  内訳は `existing_gogma_mixed` 14、`existing_gogma_keep_bonuses` 1、`normal_artian_to_gogma` 7。
- 未発見: **1**。Search例外、materialization失敗、projection失敗: 0。
- Search合計: **586.839秒**。最終Planner: **30.577秒**。全Planner合計: **60.590秒**。
- full Planner run: **25**（Baseline 1、保持集合 1、単体適用 22、最終一括 1）。
- 全体: **657.467秒（約10分57秒）**。Searchは約89.3%を占めた。
- process peak maxRSS: **2,521,128 KiB（約2.404 GiB）**。loader / Export parseを含む。

この最小構成は**途中成功**であり、43件すべての共存・Conflict 0は未達。
現在の実験ではfinal schedulerを含むgenerationよりRoute discoveryが主な時間を占める。
約11分とprocess peak約2.4 GiBを通常操作として実用的とする根拠は得られていない。
2,982 oracleより4,348 steps多いが、最適性の比較ではない。IssueのBrowser等の既知時間と
今回のNode時間も同一条件の速度比較に使わない。

### Target別Search

順序は実際の探索順。Target IDは先頭8文字（完全IDはraw report）。`mixed` = `existing_gogma_mixed`、
`keep` = `existing_gogma_keep_bonuses`、`normal` = `normal_artian_to_gogma`。
操作数・advanceはSearch時点の値。`—` は該当なし。boundary欄は観測した指定窓の端で、
N / G / SはNormal / Gogma / Skill。未発見のSはconversion窓の1501予測到達を含む。

| Target ID先頭 | Search秒 | Route | estimated operations | advance N / G / S | boundary |
| --- | ---: | --- | ---: | --- | --- |
| be881717 | 6.418 | mixed | 156 | — / 156 / 0 | なし |
| e96249b4 | 28.735 | mixed | 343 | — / 343 / 0 | なし |
| 9733b090 | 9.668 | mixed | 216 | — / 216 / 0 | なし |
| 2e26c0b1 | 11.339 | mixed | 139 | — / 139 / 0 | なし |
| a6c17e25 | 2.398 | mixed | 71 | — / 57 / 14 | なし |
| c140578c | 57.045 | mixed | 330 | — / 330 / 0 | なし |
| 57126a5e | 21.127 | keep | 222 | — / 222 / 0 | なし |
| 27ac3237 | 11.052 | mixed | 162 | — / 162 / 0 | なし |
| a830a376 | 102.469 | mixed | 783 | — / 76 / 707 | N, G |
| 02876df4 | 22.232 | mixed | 279 | — / 278 / 1 | なし |
| 8d233d8b | 2.889 | normal | 98 | 12 / 83 / 3 | なし |
| 46bf2c78 | 15.593 | normal | 234 | 121 / 76 / 37 | なし |
| b27e57a7 | 38.395 | mixed | 363 | — / 82 / 281 | N |
| b6780f04 | 1.079 | normal | 57 | 10 / 10 / 37 | なし |
| fea60316 | 7.161 | mixed | 156 | — / 156 / 0 | なし |
| 2378d3e0 | 70.417 | normal | 593 | 69 / 73 / 451 | N, G |
| 45b13c06 | 11.447 | mixed | 138 | — / 138 / 0 | なし |
| 711f7d15 | 19.234 | normal | 338 | 207 / 4 / 127 | なし |
| 6c65c924 | 11.517 | normal | 271 | 242 / 2 / 27 | なし |
| 188571a7 | 16.304 | mixed | 194 | — / 119 / 75 | なし |
| 813fb479 | 39.553 | extent内未発見 | — | — | N, G, S |
| 1efa01c6 | 6.080 | mixed | 141 | — / 1 / 140 | なし |
| 86439c85 | 74.687 | normal | 581 | 98 / 11 / 472 | N, G |

未発見は `813fb479-accd-454d-8fcd-fed51d4e891d`
（チャアク・龍・斬属属属属EX・巨魂）。投影状態では利用可能な同種の既存Normal / Gogmaがなく、
`normal_artian_to_gogma` を探索した。予測到達量はNormal 350 / Gogma 500 / Skill 1501
（巨戟化後のReset窓1500に対応）。元Entryを最終入力へ残した結果が上記の2 Conflict / 1 rejectedである。
この有限extent・保持集合・順序で未発見だったという結果であり、Idealや全43件共存解の不存在を意味しない。

### cancelと検証

同じ実Exportで `--cancel-after-ms 15000` を別に実行した。Search中のcancelで終了し、
要求受信から結果まで **15.54 ms**、全体 **15.016秒**。generated 0、最終Planなし。
記録は [NODE_CANCEL](PLANNER_GLOBAL_OPTIMIZATION_NODE_CANCEL.json)。この1回の結果から、
synchronousなTrace Replay / projection中やBrowser Workerの応答性は保証しない。

- `npm run lint`: pass。
- `npm test`: レビュー修正後 **291 files / 4,737 tests pass**。
- `npm run build`: pass。既存の500 kB超chunk warningあり。
- `npx tsc -b --force`: pass。
- 追加したResearch test 8件: deterministicな完全結果、元入力とBaseline維持、Conflictの自動置換、
  Candidate / Entry / Planner validation、origin reach再構築、未発見とSearch例外の区別、cancel、
  変更済み・新規生成武器参照と偽hashの拒否、破損予測のReplay拒否、Production import分離を検証。
- 通常buildのJSにResearchの識別子がないことを確認した。
- レビュー修正でrunnerのCLI test 3件を追加。既存outputをResearch開始前に拒否し、既存progressの
  exclusive creationとinput / output同一path拒否を維持し、既存ファイルを変更しないことを確認した。
  lint / test / buildを再実行した。実Export benchmarkは再実行せず、実測JSONは変更していない。

最初の全testは開発中の実Export試行と同時実行し、既存IdentificationWizardDialogの1件が
15秒timeoutになった。試行終了後の単独再実行は全件pass。最終性能測定はtest / buildを並行させず実施した。

## Production化に向けた課題

- 性能・成立性の結果が良くても、無選択の自動再検索は別docs-only PRでの契約変更が先。
- 今回のbaseline / prototype / 既知oracleはすべてProduction defaultの1000 stepsを超える。
  Global Plannerのstep bound policy、Application側の上限設定、またはPlan生成方式の設計は別途必要で、
  このPRでは決定しない。
- 投影後検索は前段内の空きCounterを使えず、保持集合と順序の局所最適化も行わない。
  保持集合の再実行が成立しない、有限extentで未発見、変化したOwnedWeaponを起点に選ぶ、blind観測、
  checkpoint pinがある場合は今回の最小構成では救済しない。
- 通常Searchのcanonical候補がmaterialize不能なとき、第二候補や他Routeへ切り替える仕組みはない。
  固定Routeのreservationを使う現行Planner Alternativeとの統合は別の設計課題。
- Browser Workerによる実端末測定、同一環境での複数回分布、メモリ内訳、長時間処理とcancelのUXが必要。
- Inputに元から存在する `research.global.*` IDとのcollision対応はProduction ID設計に含める必要がある。
  現在の固定ID Factory / Clockは再現性のためのResearch依存である。
- ゲーム実機での正当性の確認範囲を広げていない。既存RNGのgame-verified / reference-verified / unverifiedの
  境界はそのまま。Synthetic fixture成功は実ゲームの証明ではない。

## 現在地（Phase 2-C2.7-A以降）

Phase 2-C2.6-B2-C2B2K（`B2C2B2K_RECOVERED`）までで、E1 11 Targetはoracle-guided diagnostic上11 / 11となった。
oracleなしでcontext / extent / budgetを選ぶResearch execution policy、Phase 2-C2.7-Bの事前登録acceptance、
本Phase 0 prototypeとreservation探索の関係、Production復帰境界は
[Phase 2-C2.7-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md)（docs-only）で整理した。
その事前登録のformal executionは [Phase 2-C2.7-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B.md)（`B2C27B_INCOMPLETE`）、
結果を受けたCandidate発見とGlobal採用の分離方針は [Phase 2-C2.7-B follow-up](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27B_FOLLOWUP.md)（docs-only）にある。
