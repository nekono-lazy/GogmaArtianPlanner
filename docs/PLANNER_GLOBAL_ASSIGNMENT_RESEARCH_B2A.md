# Global Planner Global Assignment Phase B-2A（assignment-only runner・探索条件の事前登録・非formal smoke）

Refs #154。Research-only・**非formal**。基準main: PR #239 merged `cfa0488ca776542cb2595227df460ffd35b3f068`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / worktreeなしを確認）。
branch: `research/global-assignment-phase-b2a`。

本書は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§14 Phase B-2 のうち **B-2A**（assignment-only
runnerの実装、root下界stageとwindow移行判定の接続、実Exportでの非formal smoke、Phase B-2Bのformal条件の事前登録）を記録する。
**formal measurementは行っていない。** formal runと正式RESULTの確定はPhase B-2Bで、本書 §6 の登録条件とclean HEADのもとで行う。

Production RNG Engine / Search / Planner、UI / Worker / Persistence、schema / version、Phase Aの到達判定、Phase B-1のC1 / C2 semantics・
option生成順序・solverの正当性、既存formal RESULT JSONは変更していない（§9）。

## 0. 位置づけとauthority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → `docs/PLANNER_SPEC.md` → `docs/SEARCH_SPEC.md` → `docs/RNG_SPEC.md` →
`docs/DATA_MODEL.md` → その他正式仕様 → 最新mainの実装・test → Research設計である。本書はResearch記録であり、正式仕様でもDomain仕様でもない。
設計の中では §4.1〜4.3（Context / ReachTable / Assignment）、§6（solver）、§10.2（root下界と適用条件）、§10.3（window ladderと拡大判定）、
§10.4（budgetの分離）、§11（oracle isolation）、§12（determinism / incomplete）、§13（test）、§14（Phase B-2）に従う。
[Phase 2-C2.7-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md) のguardrail G1〜G12（特にG5 budget概念の分離、G6 / G7 timeout / OOMを
not-foundへ読み替えない、G9 run前の条件確定、G12 `maxPlanSteps` の区別）を守る。

### B-2Aの結果が意味すること・しないこと

B-2Aのrunnerが返すのは、設計 §4.3 の **resource assignment**（planning Target 1件につき1つの `ReachOption`。C1 source排他とC2 required位置排他を
満たす必要条件の割当）である。それは Production で成立済みの Plan ではなく、`StructuralCandidate`（Phase Cの被覆pre-check後）でも
`VerifiedPlanRecord`（Phase D'）でもない。本書・RESULT・コードのどこでも `verified` / `proven_minimum` / 「43 / 43完成」を結果分類として使わない。

## 1. 目的・範囲

目的: 実Exportから Production RNG の ReachTable を生成し、C1 / C2 の全Target資源割当を探索して、候補・下界・探索量・実行時間・メモリを
再現可能な形式で記録できるようにする。

| やること | やらないこと |
| --- | --- |
| assignment-only runner（Phase 0 → A → B-1）をResearch専用moduleとscriptとして接続 | Production Planner / Planner Alternative Search / Trace Replay の呼び出し |
| 設計 §10.2 のroot下界stage（既存下限moduleの接続と適用条件判定） | root下界を枝刈り上界に使うこと（`readVerifiedUpperBound` は渡さない） |
| 設計 §10.3 のwindow移行判定（Research専用policy） | Phase C被覆（`coverage_infeasible` は返さない）、Phase D materialization、Production Planner検証 |
| 実Exportでの非formal smokeと、Phase B-2B formal条件の事前登録 | formal run、正式RESULTの確定、Production変更、version / schema変更 |
| formal計測の成立契約（§6.4: `mode` と `formalValidity` の区別、登録Export識別子との必須照合、再現性run全成功・一致、root下界stageの実施、invalid時の保存と非0 exit）と、child起動失敗の安全な処理（§3.6） | `formalRun.enabled` の有効化（B-2B PR） |

## 2. 入力

| 入力 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`（19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`）。Issue #154 の既存Research（Phase 0 / 1-E / P0R / 2-A.5 / D系列）と同一。ローカルの `C:\Users\<user>\Downloads\` に置かれた元ファイルを `--export` で明示指定し、コピー・改変・Gitへの追加をしない。runnerはSHA-256とbytesを記録する。**登録Export識別子**は下のblockがauthorityで、runner（親・各child）は commit済みHEADの本書（`git show HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md`）からこれを読む（コード・scriptにhashをhard-codeしない。設計 §11.3）。formal runでは必須照合（§6.4）、smokeでは任意の `--expected-export-sha256` と実Exportの一致を確認し、登録値との一致を記録する |

登録Export識別子（runnerが `parseRegisteredExportIdentity()` で読む。各keyはこのblockの1行だけ。値を変える場合は新しい事前登録として扱う）:

```text
registered-export-file: gogma-artian-planner-backup_20260927015837.json
registered-export-bytes: 19424064
registered-export-sha256: cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b
```
| PlannerInput | 既存 `globalResearchInputFromExport(json, 1000)`（`src/benchmarks/plannerGlobalOptimizationResearch.ts`）。Export validation（`prepareExportRootForImport()` + `validateExportRootForFullReplacement()`）を通過した値だけを使う。`options.maxPlanSteps = 1000` は `validatePlannerInput()` を通すためだけの値で、Plannerは走らない（G12。RESULTに `plannerInputMaxPlanStepsForValidationOnly` として記録） |
| Production RNG | `ProductionRngEngine`（`production-rng:c5-e7`）。CalculationContext `{ unknown-initial, 4, production-rng:c5-e7, 17 }` |
| planning Target | `createGlobalAssignmentContext()`（Phase 0: `validatePlannerInput().validBuildListEntries` → `derivePlannerPlanningTargets()`）。最新mainでの入力validation結果（valid / excluded Entry件数、issue件数）をRESULTへ記録する。43件と異なれば理由を調べ、強制補正しない |
| window | W0 = `reachWindowW0()` = `recommendedCandidateSearchDefaults`（Normal 350 / Gogma 500 / Skill 1500、Issue #125、REQUIREMENTS 14.1。非oracle起源） |

## 3. Runnerの構成

### 3.1 module（すべてResearch専用。Productionからimportされない）

| file | 責務 |
| --- | --- |
| `src/benchmarks/globalAssignment/assignmentProtocol.ts` | protocol version、Research条件型 `AssignmentResearchConditions` と検証、window ladder検証、`ResourceAssignmentCandidate` のplain JSON snapshot（Mapを配列へ）、Map / Set / undefined / 非有限数の検出 `findNonPlainJsonPaths()`、Phase B-2B事前登録 `ASSIGNMENT_B2B_PREREGISTRATION` と未登録項目 `assignmentB2bRegistrationIssues()` |
| `src/benchmarks/globalAssignment/assignmentWindowPolicy.ts` | 設計 §10.3 の移行判定 `decideWindowTransition(outcome, rungIndex, ladder)`。outcomeの種類だけで決め、`concludesInfeasibility` は常にfalse |
| `src/benchmarks/globalAssignment/assignmentRootBound.ts` | 設計 §10.2 のroot下界stage `measureRootLowerBound()`。既存 `plannerGlobalLowerBound.ts` の `auditCrossSatisfaction()` / `collectLowerBoundProblem()` / `solveLowerBoundRelaxation()` / `provenLowerBoundTotal()` を変更せずに呼ぶ。対象集合比較 `compareLowerBoundTargetSet()`、objectiveとの比較 `compareObjectiveWithRootLowerBound()` |
| `src/benchmarks/globalAssignment/assignmentRunner.ts` | `runAssignmentOnly(plannerInput, dependencies, request, execution)`: Phase 0 → A → B-1 を1つの純計算として実行し、semantic（決定的）/ observed（時間・yield・timeline）に分けたplain data recordを返す |
| `scripts/run-planner-global-assignment-b2a.mjs` | 親: 引数・HEAD・Export・条件・provenanceを確定し `start.json` を書き、assignment child（`--repeat` 回）と root-bound child（`--root-bound-budget` 指定時）を **順に1本ずつ**（concurrency 1）spawnし、wall-clock / heap envelopeで監視して集約RESULTを書く。子: Export読込 → PlannerInput復元 → `runAssignmentOnly()` または `measureRootLowerBound()` → record |
| test | `assignmentProtocol.test.ts` / `assignmentWindowPolicy.test.ts` / `assignmentRootBound.test.ts` / `assignmentRunner.test.ts`（synthetic fixture）、`scripts/run-planner-global-assignment-b2a.test.ts`（scriptの拒否経路・source scan）、`isolation.test.ts`（更新） |

### 3.2 処理（assignment child）

1. Exportを読み、SHA-256が親の記録と一致することを確認する
2. `globalResearchInputFromExport()` で PlannerInput を復元する
3. `createGlobalAssignmentContext()` で planning Target 集合を確定する（invalid input / planning Target 0件は `unsupported_input` で止める）
4. `buildReachTable()` で指定window（ladderの現rung）を走査する（`unconfirmed_rng_state` / `unconfirmed_counter` / `blind_route_required` / `checkpoint_selection` は `unsupported_input`、cancelは `scan_cancelled`）
5. `createResourceAssignmentSearch()` を node budget / MRV lookahead で作る。**`readVerifiedUpperBound` は渡さない**（`upperBoundSupplied: false` のliteral）
6. `next(1)` で1 nodeずつ進め（yield seam）、`candidateLimit` 件の `ResourceAssignmentCandidate` を取得するか探索が終わるまで続ける
7. 走査診断（stream別origin / 走査範囲、prediction回数・memo hit、support query、group、unsupported、source種別、Target別のoption数（上限1,000で飽和）/ root MRV計数 / Ideal位置数 / 除外武器）、solver診断（B-1 diagnostics、node trace先頭256件と全node folded hash、窓内 `LB(empty)`）、候補診断（全取得候補のobjective列、最良・先頭・distinct数・objective別件数、`snapshotLimit` 件のplain snapshot）を記録する
8. snapshot候補の全 chosen option を `replayReachOptionRequiredOnly()` で required-only 再生する（設計 §5.3。invariant違反は `integrityIssues` としてfail closed）
9. 設計 §10.3 の移行判定を付与する

### 3.3 結果分類とwindow移行判定

Phase B-1の `ResourceAssignmentSearchResult` の分類をそのまま使い、stage・processの終わり方を加えた `AssignmentStageOutcome` で表す。
`coverage_infeasible` は型に含めない（Phase C未実装）。

| outcome | 意味 | §10.3 の判定（`decideWindowTransition()`） |
| --- | --- | --- |
| `no_resource_assignment` / `target_without_option`（探索木を使い切った） | windowにoptionの無いTargetがある | **expand**（次rungがあれば `nextRungIndex`、無ければ `ladderExhausted = true`） |
| `no_resource_assignment` / `resource_exclusivity`（探索木を使い切った） | 各Targetにoptionはあるが C1 / C2 で完全割当が無い | **expand**（同上） |
| `no_resource_assignment` / `upper_bound_pruning` | B-2AではUBを渡さないので起き得ない | hold（`anomalous_outcome`、要調査） |
| `assignments_found` / `exhausted` | windowの完全割当を列挙し切った | hold（`assignments_enumerated`。Phase Bとして候補あり） |
| `assignments_found` / `candidate_limit_reached` | 候補発見、残りの探索木は未確認 | hold（`assignments_found_remainder_unconfirmed`） |
| `search_incomplete` / `node_budget_reached` | 未探索枝が残る | hold（`search_incomplete`。budget見直しが先） |
| `search_incomplete` / `cancelled`、`scan_cancelled` | 中断 | hold（`interrupted`） |
| `unmeasured`（timeout / out_of_memory / process_failure。親が判定） | 未計測 | hold（`unmeasured`。envelope見直しが先） |
| `unsupported_input` / `invalid_input` | 入力前提不成立 / solver入力不整合 | hold |

どの判定も `concludesInfeasibility: false` を持ち、「実行可能解が存在しない」とは書かない。最上位rungで `expand` が求められた場合の結論は
「事前登録したladderの範囲では完全割当が無い」である（設計 §10.3）。budget到達や candidate limit 到達は探索木の完全な終了ではないので expand しない。

### 3.4 Root Lower Bound stage（設計 §10.2）

- 既存authority `auditCrossSatisfaction()` → 対象集合比較 → `collectLowerBoundProblem()` → `solveLowerBoundRelaxation()` → `provenLowerBoundTotal()`
- **対象集合の一致**: 下限moduleの対象（`isTargetWeaponPlanningEligible()` なTarget全体）とPhase 0のplanning Target集合（valid Entryを持つTarget）を比較し、
  不一致なら `not_applicable`（reason `planning_target_set_mismatch`）として下界を主張しない（設計 §10.2 の選択 (a)。入力射影は追加しない）
- **cross satisfaction**: 可能ペアが1件以上なら `not_applicable`（reason `cross_satisfaction_possible`）。閾値走査は払わない
- 下限moduleが入力を拒否（未確定RNG state / Normal Counter）すれば `not_applicable`（reason `unsupported_input`）
- `found` は relaxation minimum を `provenLowerBound` として、`none_below_budget` は `provenAtLeast = budget`（「どのPlanも budget 以上」であり、
  「実行可能Planが無い」ではない）として記録する。envelope到達は親が `unmeasured`、未指定は `not_requested`
- report型は `physicalOperations` / `provenance` fieldを持たず、`VerifiedUpperBound` へ代入できない（型test）。runnerは `readVerifiedUpperBound` を渡さない
- runner本体から独立した child（`--root-bound-budget` で起動、独自のwall / heap envelope）として実行し、未計測でもassignment結果を失わない
- RESULTには対象集合比較、cross satisfaction監査、budget、status、下界値、所要時間、solverの最良objectiveとの差（`gap`、負なら `inconsistent`）を記録する

### 3.5 Provenance / RESULT

`start.json`（run開始時、読み取り専用）と集約RESULTに次を記録する: protocol version / phase、`mode`（`smoke` = 非formal / `formal` = formal条件での実行を試みた）、
Repository HEAD SHA、基準main、Working Tree clean、計算関連コードの未commit有無（`src` / `scripts` / 設定file）、benchmark code SHA-256
（`git ls-files` の内容hash）、本書のSHA-256、runner script、Node / V8、`exportVerification`（実Exportのfile名・bytes・SHA-256、登録識別子の読取元
`HEAD:<本書>` とその値、`--expected-export-sha256` の値、CLI値との一致、登録値との一致）、Production RNG Engine version、
CalculationContext、条件（window / ladder / rung / node budget / MRV lookahead / candidate limit / snapshot limit）、envelope（wall / heap / repeat /
concurrency 1 / retry none）、条件ごとの根拠（登録値 / command line / runner default / W0非oracle起源）、`oracleFreeExecution: true` と
`oracleInformedDesign: true`（設計 §11.2）、登録状態（formal run有効化フラグ・未登録項目・再現性run数）、smoke override一覧、起動時刻、machine。

`formal: true / false` という属性は置かない。「formal条件で起動した」事実は `mode`、「正式計測として成立した」判定は集約RESULTの **`formalValidity`**
（`status: not_applicable | valid | invalid`、`issues[]`、`checks`。§6.4）であり、両者を混同しない。child recordは親の検証済みtaskから `mode` を受け取り
そのまま記録し、親は各recordの `mode` / protocol version / Export SHA-256・bytesが自分の値と一致することを確認する（不一致は `integrityIssues`）。

assignment runごとに semantic SHA-256 を取り、`--repeat ≥ 2` のとき一致を `determinism.identical` として記録する（observedの時間・メモリは含めない）。
候補の保存は `candidateLimit`（objective列）と `snapshotLimit`（full snapshot）で明示的に上限を設け、ReachTable本体はRESULTへ展開しない。
snapshotは `snapshotResourceAssignment()` でMapを配列化し、`findNonPlainJsonPaths()` で非plain値が無いことを書き出し前に確認する。

### 3.6 実行制御と安全性

- child processごとの wall-clock 上限（超過は SIGKILL → `timed_out` → `unmeasured(timeout)`）と Node heap 上限（`--max-old-space-size`。stderr の
  `heap out of memory` 等は `unmeasured(out_of_memory)`）、concurrency 1、自動リトライなし、fallbackなし
- 出力（`start.json` / task / record / RESULT）は `wx` で排他作成し、既存outputや既存run dirは開始前に拒否する。`--output` が Export と同じpathなら拒否
- node budget到達は `search_incomplete`、timeout / OOM / process failure は `unmeasured`。どちらも `no_resource_assignment` に変換しない
- 未commitコードでの実行は `--allow-uncommitted` を要し、非formal smokeとして記録される。`--mode formal` の開始条件は §6.4（純関数 `formalStartIssues()`）。
  B-2Aでは `formalRun.enabled = false` のため、登録gate（`formalRunGateIssues()`）がExportを読む前に拒否する
- childは親の検証済みtask（`mode` / 測定HEAD / 条件 / ladder / envelope / 登録Export識別子 / 実Export識別子）だけを入力にし、formal taskでは自分でも同じgate
  （`formalChildGateIssues()`: 登録gate、HEADから読んだ登録Export識別子とtask・実Exportの一致、登録条件との一致、そして **child自身が観測した**
  Repository状態 = Working Tree clean・計算関連コードに未commit変更なし・現在HEADがtaskの測定HEADと一致）を計算開始前に適用する。親の自己申告値
  （`workingTreeClean: true` 等）は信用せず、`git status` / `git diff` / `git rev-parse` を自分で実行する。手書きのformal taskで親の拒否を迂回することはできない。
  childの拒否は `unmeasured(process_failure)` として親が記録し、formal validityは `invalid` になる。childは `formalValidity` を判定しない（集約RESULTを書くのは親だけ）
- childがclean判定を行うため、formal runの `--run-dir` / `--output` はgit-ignoredなpath（例: `.local/` 配下。登録出力先 §6.1 はそう置いている）でなければならず、
  親は `git check-ignore` で確認して違えば開始前に拒否する。smoke childにはこれらの制約を加えない
- child processは共通module `scripts/planner-global-assignment-b2a-child-process.mjs` の `runChildProcess()` で起動する。promiseは `close`（exit code・signal）/
  `error`（spawn ENOENT等のOSレベル起動失敗）/ `spawn` 自体のthrowのどれかで**必ず1回だけ**settleし、timerをすべての経路で解放する。起動失敗は
  `failed` → `unmeasured(process_failure)` として記録され、親はそのまま集約RESULTを書く（親が落ちてRESULTを失うことはない）。timeout → SIGKILL → `timed_out`、
  stderrのV8 OOM署名 → `out_of_memory`、exit 0かつrecordあり → `completed`。task fileの書込失敗・recordの読取不能も `unmeasured(process_failure)`
- runnerは `--optimum` 等の post-hoc 比較引数を持たず（unknown optionとして拒否）、oracle manifest / verifier / RESULT JSON / 下限moduleをscriptから読まない
- 観測されたpeak memory（`process.memoryUsage()` 250 ms sampling の最大値、`maxRSS`、heap size limit）を child record に記録する

## 4. 非formal smoke

2026-10-12、Windows 11 x64、Node v24.19.0、AMD Ryzen 7 9700X（16 logical CPU）、物理memory約31.1 GiB。各runは逐次・単独実行（testやbuildと並行させない）。
smokeの値は正式値ではなく、§6 の登録値の根拠としてだけ使う。実Export・RESULT・run dirは `.local/` 配下にのみ置き、Gitへ追加しない。

### 4.1 path確認（s1: window 20 / 20 / 20、node budget 200、candidate limit 3、snapshot 3、repeat 2）

| 項目 | 値 |
| --- | --- |
| 入力validation | valid、issue 0件。planning Target **43**（eligible 43）、BuildListEntry 43（valid 43 / excluded 0）、OwnedWeapon 40、Normal Counter 14（全件confirmed）、Engine `production-rng:c5-e7` |
| ReachTable | prediction skill 420 / Reset 400 / Keep 1,880 / Normal 400、memo hit 483 / 460 / 100 / 460、group 20、source owned_gogma 148 / owned_normal 0 / new_normal 860、unsupported 0 |
| solver | window 20では43 Target中**41 Targetにoptionなし** → 1 node（root）でdead end → `no_resource_assignment / target_without_option` → 判定 `expand`（ladderはW0 1段なので `ladderExhausted = true`、`concludesInfeasibility = false`） |
| 時間（run 1） | context 1.68 s、ReachTable 0.05 s、solver構築 9 ms、solver 4 ms、合計 1.76 s、child wall 3.0 s（setup 1.17 s） |
| メモリ | peak RSS 807 MB、heapUsed 336 MB（Export 19 MBのparseとMaster読込が主） |
| 決定性 | 2 runのsemantic SHA-256一致（`c26f9705…`） |

この走行で `solver.windowLocalRootBound` が `Infinity` になり plain JSON検査（`findNonPlainJsonPaths()`）が `integrityIssues` に記録した。optionの無いTargetが
あると `LB(empty)` は +∞ になるので、runnerはこれを `null`（有限な下界なし）として記録するよう修正し、synthetic testで固定した。

### 4.2 W0 smoke（w0a: 350 / 500 / 1500、node budget 3,000、candidate limit 1,000、snapshot 5、repeat 2、required-only replayあり）

| 項目 | run 1 | run 2 |
| --- | --- | --- |
| outcome / 判定 | `assignments_found / candidate_limit_reached` → `hold`（`assignments_found_remainder_unconfirmed`） | 同一 |
| ReachTable prediction（memo hit） | skill 30,020（34,523）/ Reset 10,000（11,500）/ Keep 299,500（5,500）/ Normal 7,000（8,050）、support query 15,842、group 20 | 同一 |
| source | owned_gogma 148 / owned_normal 0 / new_normal 15,050（43 Target × 350位置）。Keep関心layout Σ610（最大41 / Target）、Keep-Ideal位置 Σ1,729、Reset-IdealがあるTarget 1件（位置289）、unsupported 0、optionなしTarget 0 | 同一 |
| option数（上限1,000で飽和） | 42 Targetが1,000で飽和、1 Targetが525。root MRV計数は全Targetで8（k = 8で飽和） | 同一 |
| solver | expandedNodes **1,043**、maxDepth 43、candidates 1,000、dead end 0、pruned 0、棄却 skill_position 93,155 / gogma_position 513,665 / source 63 / normal_position 0、completeness `running`（candidate limitで停止） | 同一 |
| 窓内 `LB(empty)` | **1,255** | 同一 |
| 候補 | 先頭候補（node 43、depth 43）objective **1,766**。取得1,000件すべて1,766（distinct 1）。最良のstream終端: Skill 1424（origin 341、+1,083）、Gogma 503（origin 55、+448）、Normal CB 0→207 / DB 349→371 / SA 0→1 / SnS 7→12 / GS・Hammer・HBG 進行0（Normal計 +235）。snapshot 0のsource: owned_gogma 38 / new_normal 5、Skill要件 none 21 / reset_skills 17 / conversion 5、Bonus要件 reset 1 / keep_from_source 19 / reset_then_keep 23 | 同一 |
| required-only replay | 5候補 × 43 option = 215 option、prediction skill 111 / Reset 120 / Keep 210 / Normal 26、`passed`、20 ms | 同一 |
| 時間 | context 1.67 s、ReachTable **11.9 s**、solver構築 2.85 s、診断walk（option数え上げ + root MRV計数、このrunでは未分離）25.0 s、窓内LB 11 ms、先頭候補まで **50.3 s**、solver合計 50.4 s、replay 19 ms、計算合計 91.8 s、child wall 92.5 s（setup 0.67 s、yield 6,542） | context 1.61 s、ReachTable 12.4 s、構築 2.91 s、診断 27.4 s、先頭候補まで 50.9 s、solver 51.0 s、合計 95.4 s、wall 96.1 s |
| メモリ | peak RSS **1.06 GB**、heapUsed 845 MB、heapTotal 935 MB、maxRSS 1,037,880 KiB、heap limit 4.5 GB（`--max-old-space-size=4096`） | peak RSS 1.11 GB |
| 決定性 | 2 runのsemantic SHA-256一致（`8dbe1e2d…`）、node trace hash一致 | |

観察（診断。結論ではない）:

- 先頭候補までの50 sは、深さ43までの下降1 nodeあたり約1.17 s。各nodeのMRVは未割当Target全部について `countUpTo(8)` を歩き、C2不適合optionの
  連続棄却（Gogma位置 51万件、Skill位置 9万件）が支配的である（設計 §15.2 の懸念と一致）。dead endは0件で、backtrackは起きていない
- depth 43到達後の1,000候補は0.1 sで生成され、すべて同じobjective 1,766である。値順序は最後のTargetの同objective variant（同じstream終端を与える
  別の必須位置・source）を先に列挙するため、candidate limitを増やしてもobjectiveの多様性は得られない。別objectiveの候補を見るには探索木をもっと
  使い切る（node budgetを増やす）か、Phase C以降でcandidate順序を変える必要がある（本Phaseでは判断しない）
- 窓内 `LB(empty)` 1,255 と先頭候補 1,766 の差は 511。これはwindow内・緩和下界であり、§10.2 のroot下界ではない（§4.3）
- 診断walk 25 sのうち、option数え上げ（43 × 最大1,000 option）とroot MRV計数（43 × 8 option）は未分離だった。修正後のrunner（§4.3以降のsmoke）は
  `observed.elapsedMs.optionCount` / `rootMrvCount` を別に記録する

### 4.3 Root Lower Bound smoke（`--repeat 0`、root-bound childのみ）

適用条件（§3.4）は実Exportで成立する: 下限moduleの対象（eligible 43）とPhase 0のplanning Target（43）が一致し、同weapon type・同elementの
Targetペア54件のうちcross satisfaction可能ペアは0件（Skill state候補: Series 26 / Group 18。Master Series 25 / Group 17 + 条件の指定ID + null）。

| 項目 | budget 300（lb300） | budget 2,000（lb2000） |
| --- | --- | --- |
| status | `none_below_budget`（`provenAtLeast = 300`。box内にoptionの無いTargetが7件） | **`found`**（`provenLowerBound = 1,657`） |
| LB stage時間 | 5.9 s | 147.9 s |
| child wall / setup | 9.0 s / 1.2 s | 150.2 s / 0.65 s |
| peak RSS / heapUsed | 812 MB / 316 MB | 584 MB / 302 MB |
| objectiveとの比較 | assignment child無しのため `not_comparable` | assignment child無しのため `not_comparable`。W0 smokeの先頭候補 1,766 と手計算で比較すると gap = 109（整合） |

budget 300はコスト見積りのためのprobeである。`none_below_budget` は「どのPlanも300操作以上」であり、「実行可能Planが無い」ではない。

#### 4.3.1 budget 2,000

relaxation minimum **1,657** = Skill +1,083（閾値1424）+ Gogma +235（閾値290）+ Normal +339（CB 207 / DB 126 / SnS 5 / SA 1、他0）。
box内にoptionの無いTargetは0件、Target別option数は43件中42件が2,000〜2,006（1件は4）。`nearMinimum`（budget超えを30まで記録）の次点は1,669、1,672、…。
この値は実Exportと `production-rng:c5-e7` から計算した緩和下界であり、下限moduleの前提（`LOWER_BOUND_ASSUMPTIONS`）のもとで「全planning Targetを完成させる
どのPlanも1,657操作以上」を意味する。Phase 2-A.5の下限監査（budget 1,658、同じExport）と同じ値になったが、本runはoracle manifest / RESULTを読んでおらず、
budget 2,000はW0 smokeの先頭候補objective 1,766を含むように選んだ（§6）。1,657を入力や上限にはしていない。

W0 smokeの先頭候補（1,766）との差 109 は、Gogma終端（候補 +448 vs 緩和 +235）とNormal DB（候補 +22 vs 緩和 +126）の配分差として現れている。
緩和は位置排他・stream間順序・被覆を捨てているので、1,657のassignmentがC1 / C2で成立するかは本Phaseでは分からない（§5）。

### 4.4 決定性

s1（2 run）とw0a（2 run）のいずれも、assignment childのsemantic record（outcome、走査診断、solver診断、node trace hash、objective列、snapshot、replay、
移行判定）のSHA-256が一致した（`determinism.identical = true`）。observed（時間・yield・timeline・メモリ）はsemanticに含めない。
同じ入力・Research条件・Engine versionに対する決定性は、synthetic test（2回実行のsemantic一致）でも固定している。

### 4.5 stage別時間・メモリ（W0、run 1 / run 2）

| stage | 時間 | 備考 |
| --- | --- | --- |
| child setup（Vite SSR loader、module読込） | 0.67 s | child wallに含まれ、計算合計には含まれない |
| Export読込・validation・PlannerInput復元 | child wall − 計算合計 ≈ 0.0 s（setupに含む） | `globalResearchInputFromExport()` |
| Phase 0 context（`validatePlannerInput()`） | 1.67 / 1.61 s | 43 Entryのstaleness・capability検証 |
| Phase A ReachTable（W0） | 11.9 / 12.4 s | prediction 346,520件（Keep 299,500が大半）、memo hit 59,573件 |
| solver構築（lattice / menu / `targetsWithoutOption`） | 2.85 / 2.91 s | |
| 診断walk（option数え上げ + root MRV計数） | 25.0 / 27.4 s | このrunでは未分離（修正後は `optionCount` / `rootMrvCount` を別記録）。solverの探索時間ではない |
| 窓内 `LB(empty)` | 11 / 14 ms | |
| solver（先頭候補まで / 合計） | 50.3 / 50.4 s、50.9 / 51.0 s | 1,043 node。先頭候補までの43 nodeが支配的（約1.17 s / node） |
| required-only replay（5候補、215 option） | 19 / 20 ms | |
| 計算合計 / child wall | 91.8 / 92.5 s、95.4 / 96.1 s | 2 child逐次で親の合計wall 189.0 s |
| メモリ | peak RSS 1.06 / 1.11 GB、heapUsed 845 MB、heapTotal 935 MB | heap limit 4.5 GB（`--max-old-space-size=4096`）。Export 19 MBのparseとMasterを含む |
| Root Lower Bound child（budget 300） | LB stage 5.9 s、wall 9.0 s、RSS 812 MB | §4.3 |

ReachTable構築（12 s）とsolverのMRV計数（先頭候補まで50 s）は別stageとして計測できた。solver時間のうちMRV計数が占める比率は、B-1 solver内部に
計測点を置かない方針（B-1不変）のため直接は分離していないが、node間隔（`observed.nodeTimeline`）とdead end 0件から、下降1 nodeあたり約1.17 sの
ほぼ全部が各nodeのMRV計数（未割当Target全部の `countUpTo(8)` と、その歩行で棄却されるC2不適合option）であると読める。

## 5. smokeから言えること・言えないこと

言えること（非formal、§6の登録値の根拠として）:

1. 実Export（43 planning Target / 43 valid Entry）を最新mainで正しく読み込み、Phase 0の集合を確定できる（§4.1）
2. W0のReachTableを約12 sで生成できる（§4.2）
3. B-1 solverを起動し、node budget（s1はdead end、w0aはcandidate limit）で終了できる（§4.1 / §4.2）
4. 各stageの時間とメモリを別々に計測できる（§4.5）。ReachTable構築とsolverは分離されており、solverのMRV計数は下降1 nodeあたり約1.17 sと読める
5. Root Lower Boundは実Exportで適用可能であり（対象集合一致、可能ペア0件）、budget 2,000で `found`（1,657）を148 sで得られる（§4.3）
6. 同じ入力・条件での再実行はsemantic recordが一致する（§4.4）
7. W0で先頭候補のobjectiveは1,766で、これは緩和下界1,657より109大きい（整合）

言えないこと（本Phaseでは主張しない）:

- 1,766のresource assignmentがProductionで成立するか（Phase C被覆・Phase D materialization・Phase D' Planner検証は未実施。`verified` ではない）
- 1,657が到達可能か（緩和は位置排他・stream間順序・被覆を捨てている。`proven_minimum` はProduction検証済みPlanが下界と一致したときだけ）
- W0内に1,766より良いresource assignmentが無いこと（candidate limit到達は探索木の完全な終了ではない。取得した1,000候補は同objectiveの兄弟葉だった）
- window拡大（W1以降）の効果（未計測。§6ではW0だけを登録する）
- 43 / 43 Planの完成（B-2はassignment-onlyであり、完成数を報告しない）
- deeper backtrack（dead end後の再下降）のnode当たりコスト（w0aはdead end 0件。§6のnode budget / wallは下降時の観測値から見積もった）
- Browser Worker / スマートフォンでの実行可能性（Node測定だけ）

## 6. Phase B-2B formal条件の事前登録

値はコードの `ASSIGNMENT_B2B_PREREGISTRATION`（`src/benchmarks/globalAssignment/assignmentProtocol.ts`）と一致させ、formal run後に変えない（G9）。
`assignmentB2bRegistrationIssues()` が空で、かつ `formalRun.enabled` がtrueのときだけ `--mode formal` が受け付けられる。B-2Aでは `formalRun.enabled = false`
のまま（formal runを開始しない）。有効化はB-2BのPRが、本節のレビュー後に行う。

### 6.1 登録値と根拠

| 項目 | 値 | 根拠（§4のsmoke。oracle非由来） |
| --- | --- | --- |
| 対象Exportの識別 | file名 `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`。formal runは `--expected-export-sha256` にこの値を渡し、runnerが照合する（コードにhashを置かない） | Issue #154の既存Researchと同一の実Export |
| window ladder | **W0のみ** `[{ normal: 350, gogma: 500, skill: 1500 }]` | W0は非oracle起源の正式仕様定数（Issue #125、REQUIREMENTS 14.1）。W1の値に客観的根拠が無いため1段とする。**window拡大の効果は未確認**（W0での限定的計測）。§10.3の移行判定は適用され、W0で `expand` が求められれば「登録ladderの範囲では完全割当なし」として記録する（解不存在ではない） |
| node budget | **2,000** | w0a: 先頭候補はnode 43（dead end 0）、1,000候補で1,043 node。下降1 nodeあたり約1.17 s。2,000は観測必要量の約2倍で、全nodeが浅いnodeだったとしても 2,000 × 1.2 s = 40 min < child wall 60 min |
| MRV lookahead | **8** | 設計 §6.4 の k はTarget選択順のための先読み上限で、option列挙を減らさない。w0aは8で全Target飽和。別の値を正当化する観測なし |
| candidate limit | **1,000** | w0a: 先頭候補後の1,000兄弟葉を約0.1 sで生成、全部同objective。1,000件はRESULTサイズ（objective 1件/候補）を抑えつつ、先頭1,000件に別objectiveが現れるかを記録できる |
| snapshot limit | **5** | 5件のfull snapshot（43 option、約20 KB / 件）とそのrequired-only replay（約20 ms） |
| required-only replay | あり（snapshot候補の全option） | 設計 §5.3。w0aで215 option / 20 ms |
| Root Lower Bound budget | **2,000** | 緩和は「total < budget」の閾値boxを走査するので、比較対象の構造的objective（w0a 1,766）を含む必要がある。300は `none_below_budget`、2,000は `found`。コストは300で5.9 s、2,000で148 s。1,657は根拠にしない |
| Root Lower Bound child wall / heap | **20 min / 4,096 MB** | 2,000で150 s / RSS 584 MB。8倍 / 約7倍の余裕 |
| assignment child wall / heap | **60 min / 4,096 MB** | w0a: 92.5 s / 96.1 s、RSS 1.06 / 1.11 GB、heapUsed 845 MB。60 minはnode budget 2,000 × 最悪1.2 s / nodeを覆う。到達は `unmeasured` |
| concurrency / retry / fallback | **1 / なし / なし** | 既存Research運用（G6 / G7） |
| 再現性run数 | **2**（assignment child 2本、semantic SHA-256一致を要求） | §4.4 |
| 未完了の結果分類 | node budget到達 = `search_incomplete`、candidate limit到達 = `assignments_found / candidate_limit_reached`（残り未確認）、wall / heap到達・process failure = `unmeasured`。どれも `no_resource_assignment` に変換しない | §3.3 / §3.6 |
| RESULT出力先 | run dir `.local/ga-b2b-formal.run/`（commitしない）、集約RESULTは `docs/PLANNER_GLOBAL_ASSIGNMENT_B2B_RESULT.json`（B-2B PRで追加。候補snapshotは5件まで、ReachTable本体は含めない） | 既存formal RESULTの配置に合わせる |
| 計測環境 | Windows 11 x64、Node v24.19.0、AMD Ryzen 7 9700X（16 logical CPU）、物理memory約31.1 GiB、testやbuildと並行させない | §4 |
| provenance確認 | measurement HEADがcleanでcommit済み（`workingTreeClean = true`、`uncommittedBenchmarkCode = false`）、`benchmarkCodeSha256` と本書のSHA-256を記録、Export SHA-256一致、`oracleFreeExecution = true` / `oracleInformedDesign = true`、`registration.unresolvedItems = []`、`smokeOverrides = []`、2 runのsemantic SHA-256一致、`integrityIssues = []` | §3.5 |

formal runのcommand（B-2Bで、clean HEADから実行する。`--mode formal` は条件をコードの登録値から取り、command line overrideを拒否する）:

```bash
node scripts/run-planner-global-assignment-b2a.mjs --mode formal --export "<Export path>" --expected-export-sha256 cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b --run-dir .local/ga-b2b-formal.run --output .local/ga-b2b-formal.result.json
```

### 6.2 事前登録未完了の項目（推測で確定しない）

- **W1以降のrung**: 客観的根拠が無いため登録しない。W0 formal runの結果（§10.3の判定）を見てから、別PRで事前登録する
- **deeper backtrackのnode当たりコスト**: w0aはdead end 0件で、backtrack後の再下降コストは未観測。node budget 2,000 / wall 60 minは下降時の観測値からの見積りであり、
  formal runで `unmeasured` になった場合はenvelopeの見直しを先に行う（windowの問題と断定しない）
- **別objectiveの候補が現れる条件**: 同objectiveの兄弟葉が続くことが分かったが、どのnode数で別objectiveに到達するかは未観測。B-2Bの `candidateLimit = 1,000` では
  「先頭1,000件が同objectiveかどうか」までしか言えない
- **`formalRun.enabled` の有効化**: B-2B PRの作業（本PRでは `false`）

### 6.3 formal run前の確認手順

1. `main` / `origin/main` / HEADの一致、Working Tree clean、stash / worktreeなし、実行中のnode processなし
2. `npm run lint` / `npm test` / `npm run build` が通ること（計測と並行させない）
3. 本書 §6.1 / §2 の登録値とコードの `ASSIGNMENT_B2B_PREREGISTRATION` の一致（`assignmentProtocol.test.ts` と目視）。`formalRun.enabled` の有効化はB-2B PRで、
   この確認の後にcommitする（有効化commit自体がmeasurement HEADに含まれる）
4. `--mode formal --expected-export-sha256 <§2の登録値>` で起動し、`start.json` の `registration.unresolvedItems = []`、`smokeOverrides = []`、
   `exportVerification.registeredMatched = true` / `cliMatched = true` を確認してから結果を待つ
5. 集約RESULTの `formalValidity.status` が `valid` のときだけ正式計測として扱う。`invalid` なら `formalValidity.issues` を読み、envelope・条件の見直しが要る場合は
   新しい事前登録として記録してから再実行する（結果を見て登録値を変えない。G9）

### 6.4 formal計測の成立条件（`formalValidity`）

formal条件で起動したこと（`mode = formal`）と、正式計測として成立したこと（`formalValidity.status = valid`）は別の判定である。判定は純関数
`judgeFormalValidity()`（`assignmentProtocol.ts`）が集約時に行い、親だけが書く。`formal: true` のような属性は存在しない。

| `formalValidity.status` | 意味 |
| --- | --- |
| `not_applicable` | `mode = smoke`。非formalであり、正式計測の主張をしない |
| `valid` | `mode = formal` で、下の条件がすべて成立した。正式計測として扱える |
| `invalid` | `mode = formal` で起動したが、条件のいずれかが成立しなかった。`issues[]` に理由を残し、取得済みの診断RESULTは保存するが、正式計測としては表示・報告しない。process exit codeは非0 |

開始条件（`formalStartIssues()`。1つでも満たさなければ何も書かずに拒否する）:

1. 登録gate: `formalRun.enabled = true` かつ `assignmentB2bRegistrationIssues() = []`（B-2Aでは `enabled = false` なので常に拒否される）
2. Working Tree clean かつ計算関連コードがcommit済み、`--allow-uncommitted` なし
3. 条件のcommand line override（`--window` / `--node-budget` / … / `--no-replay`）なし。条件・ladder・envelopeは `registeredFormalConditions()` から取る
4. 登録Export識別子（§2のblock）がcommit済みHEADの本書から読める
5. `--expected-export-sha256` が与えられ、その値が登録SHA-256と一致する（CLI値は登録値の独立した2回目の入力であり、任意の別Exportのhashを渡しても
   登録Exportとの同一性には代わらない）
6. 実Exportのfile名・bytes・SHA-256が登録識別子と一致する
7. `--run-dir` / `--output` がgit-ignored（childのclean判定を自壊させないため。§3.6）

child側gate（`formalChildGateIssues()`。formal taskを受けた各childが計算開始前に自分で適用し、失敗すればfail closed）:

- 登録gate（開始条件1と同じ）、HEADから自分で読んだ登録Export識別子とtaskの識別子・実Exportの一致、taskの条件 / ladder / envelopeと登録値の一致
- child自身が観測したRepository状態: Working Tree clean、計算関連コードに未commit変更なし、現在HEAD = taskの測定HEAD（`repositoryHeadSha`）。親の自己申告値は読まない
- 拒否されたchildは親から `unmeasured(process_failure)` として記録され、formal validityは `invalid` になる

成立条件（`judgeFormalValidity()`。集約時に判定）:

1. 開始条件1〜3・5〜6が成立している（`exportVerification.registeredMatched = true` かつ `cliMatched = true`）
2. 規定数（`reproducibilityRuns = 2`）のassignment childがすべて実行され、すべて `completed` でrecordが読め（`measured`）、各recordの `mode` / protocol version /
   Export SHA-256・bytesが親と一致する
3. すべてのsemantic recordに `integrityIssues` がない
4. すべてのsemantic SHA-256が一致し、`determinism.identical === true`（`null` = 未確認であり成立ではない）
5. root下界stageが測定として実施された: root-bound childが `completed` でrecordが読め、recordの `mode` / protocol version / Export SHA-256・bytesが親と一致し
   （`checks.rootLowerBoundStage.recordConsistent = true`）、`report.status` が `found`（relaxation minimumを下界として証明）または `none_below_budget`
   （「budget以上」を証明。exact minimumではない）である。**recordが親と不整合なら `found` であっても成立しない**（その下界はこの計測のものではない）。
   `not_applicable`（適用条件不成立。本Exportでは事前登録上成立が見込まれるため期待外として理由を残しinvalid）/ `unmeasured`（timeout / OOM / process failure /
   record欠落・読取不能）/ `not_requested` は成立しない。`checks.rootLowerBoundStage` は「stageが実施されたか（`executed`）」「何を証明したか（`provenBound`:
   `exact_minimum` / `at_least_budget` / `none`）」「recordが整合しているか（`recordConsistent`）」を分けて記録する
6. `compareObjectiveWithRootLowerBound()` が `inconsistent` でない（`not_comparable`、例えばwindow内に割当が無く候補objectiveが無い場合は、成立条件の違反ではない）
7. 集約RESULTの `integrityIssues` が空である（record不整合、replayのinvariant違反、run間の不一致、`inconsistent` な下界など、集約が記録した異常はすべて
   `judgeFormalValidity()` に渡され、1件でも残れば `invalid`。`checks.aggregateIntegrityIssueCount` / `noAggregateIntegrityIssues` に残る）。
   したがって **`formalValidity.status = valid` のとき集約 `integrityIssues` は必ず空** であり、process exit codeが非0なのに `valid` という状態は存在しない。
   異常情報を除外・隠蔽して `valid` にすることはない

次はすべて `invalid` である: 1回目成功・2回目timeout / OOM / process failure、2回成功だがsemantic SHA-256不一致、2回成功だがintegrity issueあり、
recordの欠落・読取不能、`determinism.identical = null`、root下界 `unmeasured` / `not_requested` / `not_applicable`、root-bound recordの親との不整合
（`found` / `none_below_budget` でも）、`inconsistent`、集約 `integrityIssues` の残存、未commitコード、override、Export照合の省略・不一致、childのRepository検証失敗。
`invalid` のRESULTも `.local/` に保存し、理由（`formalValidity.issues`）を残すが、B-2Bの正式RESULT（`docs/…_B2B_RESULT.json`）には採用しない。

B-2Aでは `ASSIGNMENT_B2B_PREREGISTRATION.formalRun.enabled = false` を維持し、formal runを開始していない。本節の判定はsynthetic fixtureと純関数のtestで
固定した（§7）。

## 7. テスト

synthetic fixture（Fake Engine、小window、oracle非依存）で次を固定した。

- Runner: Context → ReachTable → Solver の順に進む、valid Entryだけからplanning Targetを確定（Entryの無いeligible Targetは走査しない）、
  B-1 `collectResourceAssignments()` との outcome / objective列 / streamEnd / node数 / 棄却件数の一致、candidate limit は hold（残探索を不在扱いしない）、
  node budget は `search_incomplete`、solver内cancelと走査中cancelの区別、invalid conditions は予測前に拒否、invalid PlannerInput と未確定Normal Counter の fail closed、
  `target_without_option` / `resource_exclusivity` で expand（最上位rungでは `ladderExhausted`、常に `concludesInfeasibility: false`）、
  2回実行のsemantic record一致、record全体がplain JSON、snapshot上限、`upperBoundSupplied: false`・`pruned 0`
- Root Lower Bound: 対象集合一致かつ可能ペア0件で `found`（既存moduleの直接計算と一致）、planning Target集合不一致で `not_applicable`、cross satisfaction
  可能ペアで `not_applicable`（閾値走査を払わない）、`none_below_budget`、下限moduleの入力拒否で `not_applicable / unsupported_input`、
  objective比較（gap、`inconsistent`、`not_comparable`）、`VerifiedUpperBound` へ代入不能（`@ts-expect-error`）
- Window policy: §3.3 の全行、最上位rung、不正rung / ladderの拒否、`coverage_infeasible` が型に無いこと
- Protocol: 条件・ladderの検証、snapshotのplain化、Map / Set / undefined / 非有限数の検出、登録recordの整合（`null` 項目だけが未登録、formal run無効）
- Script: Usage、unknown option（`--optimum` を含む）、重複 / 値なしoption、既存output / run dir、Export上書き、formal mode拒否（登録gateがExportを読む前に拒否）、
  hash形式、source scan（oracle / 下限module / RESULT / 64桁hex / UUID なし、`new ProductionRngEngine()`、`wx`、`formal: true / false` 属性なし、登録gate → start gate →
  child gate → `judgeFormalValidity()` の呼び出し、`git show HEAD:` による登録識別子の読取、child process helperの利用）、helper moduleのResearch識別子なし
- formal契約（純関数、synthetic fixture）: 登録Export識別子のparse（各key 1行、欠落 / 重複 / 不正値の拒否、hashを含む散文は登録行ではない）、識別子比較（file名 / bytes / hash）、
  登録gate（無効・未登録）、開始条件（clean / commit済み / override なし / CLI hash必須 / CLI値 = 登録値 / 実Export = 登録値 / 登録識別子の読取不能。B-2Aの実登録では常に
  「not enabled」で拒否）、child gate（smoke taskの拒否、登録条件・ladder・envelopeとの一致、taskの登録識別子とHEADの一致、実Exportの一致、HEAD読取不能）、
  child gateのRepository検証（clean HEADで一致するtask → 許可、Working Tree dirty / 未commit code / 測定HEADなし・不正 / 現在HEAD不一致 → 拒否、親の自己申告値は読まない）、
  `registeredFormalConditions()` と登録値の一致、`judgeFormalValidity()`（smokeは `not_applicable`、全条件成立で `valid`、run数不足・2回目のtimeout / OOM / process
  failure・semantic SHA-256不一致・integrity issue・record不整合・`determinism.identical = null`・root下界 `unmeasured` / `not_requested` / `not_applicable`・
  root-bound recordの親との不整合（`found` / `none_below_budget` でも、`recordConsistent` が `false` / `null` なら）・`inconsistent`・集約 `integrityIssues` の残存
  （1件でも `invalid`、`valid` なら必ず0件、smokeは件数を記録するだけ）・gate / tree / override / Export照合の不成立はすべて `invalid`、`none_below_budget` は
  `at_least_budget` として `valid`、`not_comparable` は違反ではない）
- child process envelope（fake spawn、実childなし）: `completed` / 非0 exitの `failed` / timeout（SIGKILL、OOM署名より優先）/ OOM署名 / spawn `error`（ENOENT）→ `failed` と
  後続 `close` の無視（二重settleなし）/ `close` 後の `error` の無視 / `spawn` throw（timer未設定）/ kill失敗、すべての経路でtimer解放
- Isolation: Production module・他scriptからのimportなし、runtime moduleのimport制限（下限moduleは `assignmentRootBound.ts` だけ）、clock / random /
  file / `.json` literal / hash / UUID なし、B-2A moduleが Planner / Search / Trace Replay / `readVerifiedUpperBound` / `'verified'` / `'proven_minimum'` を持たないこと

## 8. validation

2026-10-12、本PRの最終コードで実行（smokeと並行させない）。

| コマンド | 結果 |
| --- | --- |
| `git diff --check` | pass |
| `npm run check:nul` | pass（1,404 text files） |
| `npm run lint` | pass |
| `npm test` | pass（383 files / 6,419 tests、3 skipped、約128 s）。初回の全suite実行では `scripts/run-planner-global-assignment-b2a.test.ts` の `--mode formal` 拒否ケースがvitest既定の5 s timeoutで1件failした（Vite module loaderを起こすspawnが全suite負荷下で5.6 s）。spawnする4 testに60 sの明示timeoutを与えて再実行し、全件pass |
| `npm run build` | pass（既存の500 kB chunk warningのみ）。`dist/` にResearch識別子（`globalAssignment` / `runAssignmentOnly` / `measureRootLowerBound` / `decideWindowTransition`）なし |
| `npx tsc --noEmit -p tsconfig.app.json` | pass |

synthetic test: `src/benchmarks/globalAssignment/`（Phase A / B-1の既存test含む）14 files 142 tests + script test 5 tests（§7）。

レビュー対応（formal成立契約・child起動失敗処理。§3.5 / §3.6 / §6.4）後の再検証、2026-10-12:

| コマンド | 結果 |
| --- | --- |
| `git diff --check` / `npm run check:nul` / `npm run lint` / `npx tsc --noEmit -p tsconfig.app.json` | pass |
| `npm test` | pass（384 files / 6,443 tests、3 skipped、約128 s。timeoutなし） |
| `npm run build` | pass（既存chunk warningのみ。`dist/` にResearch識別子なし） |

synthetic test: `src/benchmarks/globalAssignment/` 14 files 155 tests + script test 7 tests + child process envelope test 9 tests。新しいsmoke / formal runは行っていない。

再レビュー対応（root-bound record整合性と集約 `integrityIssues` のformal validity反映、formal childのclean HEAD自己検証。§3.6 / §6.4）後の再検証、2026-10-12:

| コマンド | 結果 |
| --- | --- |
| `git diff --check` / `npm run check:nul` / `npm run lint` / `npx tsc --noEmit -p tsconfig.app.json` | pass |
| `npm test` | pass（384 files / 6,445 tests、3 skipped、約130 s。timeoutなし） |
| `npm run build` | pass（既存chunk warningのみ。`dist/` にResearch識別子なし） |

synthetic test: `src/benchmarks/globalAssignment/` 14 files 157 tests + script test 7 tests + child process envelope test 9 tests。新しいsmoke / formal runは行っていない。

## 9. 変更していないもの

Production RNG Engine（`production-rng:c5-e7`）、Production Search / Planner / Planner Alternative、UI / Worker / Persistence、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17 / `DATABASE_SCHEMA_VERSION` 10 / `ExportRoot.schemaVersion` 13 / `AppSettings.schemaVersion` 2 /
`RngState.schemaVersion` 2 / Master `dataVersion` 4、Phase Aの到達判定（`reachTable.ts` / `reachOptions.ts` / `requiredOnlyReplay.ts`）、
Phase B-1のC1 / C2 semantics・option生成順序・solver（`assignmentFeasibility.ts` / `assignmentLowerBound.ts` / `assignmentOrdering.ts` / `assignmentSolver.ts`）、
下限module `plannerGlobalLowerBound.ts`、既存formal RESULT JSON、既存Research runner。

## 10. 作業開始時の観察（引き継ぎ）

作業開始時のWorking Treeはclean（stash / worktreeなし、local main = origin/main = HEAD `cfa0488`）だった。reflogには同名branch
`research/global-assignment-phase-b2a` の作成と `main` への復帰が残り、branch自体は削除済みで、ignored directory `.local/` に前回試行の非formal smoke出力
（`b2a-smoke-*`、同日13:01〜13:16、`uncommittedCode = true`）だけが残っていた。そのコードは存在しないため引き継がず、本PRの実装・smoke・事前登録は
すべて本PRのコードで行い、前回試行の数値を §6 の根拠にしていない。残っていた出力は内容を確認して引き継ぎ対象でないことを判断しただけで、
変更していない（`.local/` はGit管理外）。
