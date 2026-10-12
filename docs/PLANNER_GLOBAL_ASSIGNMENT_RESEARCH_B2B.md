# Global Planner Global Assignment Phase B-2B（事前登録条件によるassignment-only formal measurement）

Refs #154。Research-only。基準main: PR #240 merged `baf74b2f9958870db445b23b89805a7d3f2fb220`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / worktreeなし、実行中のNode processなしを確認）。
branch: `research/global-assignment-b2b-formal`。

本書は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§14 Phase B-2 のうち **B-2B**（[B-2A記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md)
§6 で事前登録した条件と clean HEAD による formal measurement）を記録する。正式RESULTは [`PLANNER_GLOBAL_ASSIGNMENT_B2B_RESULT.json`](PLANNER_GLOBAL_ASSIGNMENT_B2B_RESULT.json)。

**結果: `formalValidity.status = valid`。** W0（350 / 500 / 1500）で43 planning Target全部の resource assignment を見つけ、最良structural objectiveは **1,766**、
root下界は **1,657**（`found`、gap 109、`consistent`）。ただし探索は candidate limit（1,000件）で止まっており、探索木は使い切っていない（§4.4）。

## 0. 位置づけ・この結果が意味しないこと

正式仕様の順位は `AGENTS.md` のとおりであり、本書はResearch記録（正式仕様でもDomain仕様でもない）。設計 §10.2 / §10.3 / §10.4 / §11 / §12 / §14 と
B-2A記録 §2 / §3 / §6 に従う。

B-2Bの出力は設計 §4.3 の **resource assignment**（planning Target 1件につき1つの `ReachOption`。C1 source排他とC2 required位置排他を満たす必要条件の割当）である。

- Phase CのCounter被覆は未検証、Phase DのRoute materializationは未実施、Production Planner / Trace Replayは未実施
- 完成した43 / 43 Planではない。`verified` ではない。`proven_minimum` ではない
- objective 1,766 は「C1 / C2を満たす割当のstream終端の和」であり、物理操作数として成立するかはPhase C / D / D'まで分からない

## 1. 実施手順と3つのHEAD

| 区分 | commit | 内容 |
| --- | --- | --- |
| formal実行有効化commit = **measurement HEAD** | `6125a8db49a8f805e8af368f773a1846b431cc40` | `ASSIGNMENT_B2B_PREREGISTRATION.formalRun.enabled = true`（`enabledBy` の説明だけ更新）、登録値を固定するtest、formal gateのtest整合、runner scriptのコメント更新。登録値・計測ロジックは不変 |
| formal run | measurement HEADで実行（2026-10-12 08:33:20Z〜08:38:38Z） | 登録条件どおり。CLI overrideなし |
| 計測後commit（本書・RESULT追加） | 本PRの後続commit | `docs/` の追加と設計 §14 のリンクだけ。`src/` / `scripts/` / `package*.json` / TypeScript・Vite・Vitest設定に変更なし（§7） |

measurement HEADとPR最終headが異なるのは、RESULT・本書を計測後に追加したためである。計測は measurement HEAD で行っており、別HEADで行ったことにはしない。

### 1.1 有効化前の監査

- 登録値（`assignmentProtocol.ts`）とB-2A記録 §6.1 の一致を目視とtestで確認（W0のみ 350 / 500 / 1500、node budget 2,000、MRV lookahead 8、candidate limit 1,000、
  snapshot limit 5、required-only replayあり、root下界budget 2,000、assignment child 60 min / 4,096 MB、root-bound child 20 min / 4,096 MB、再現性run 2、concurrency 1、retryなし）。
  有効化で値を1つも変えていない。新しいtestが全値と `oracleInformed = false` を固定する
- 登録Export識別子はB-2A記録 §2 の `registered-export-*` block（runnerが `git show HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2A.md` で読む）。コード・scriptにhashを置いていない
- ローカルの `gogma-artian-planner-backup_20260927015837.json` が 19,424,064 bytes・SHA-256 `cc35fb5b…e1e6b` で登録値と一致することを計測前に確認。Exportはコピー・改変・Git追加していない
- 出力先 `.local/ga-b2b-formal.run` / `.local/ga-b2b-formal.result.json` が未使用かつgit-ignored（`*.local`）であることを確認

### 1.2 テストの整合（B-2A → B-2B）

| test | B-2A | B-2B |
| --- | --- | --- |
| 実登録 | `formalRun.enabled === false` | 登録項目の未解決0件・`enabled === true`、全登録値と `oracleInformed = false` を固定、`registeredFormalConditions()` が必ず完全 |
| 登録gate | 実登録は常に「not enabled」で拒否 | 実登録はgate通過・start条件成立。**disabledなsynthetic登録・登録不足のsynthetic登録は引き続き拒否**。enabledな実登録でもdirty tree・override・Export不一致は拒否 |
| child gate | 実登録で拒否 | 実登録で許可、disabled / 不完全な登録は拒否、enabledでもdirty treeは拒否 |
| runner script | formalは登録gateで拒否 | formalは start gate で拒否されることを実spawnで確認: 登録外Export（名前・bytes・hash）、CLI hashの不一致、CLI hashの欠落、override、`--allow-uncommitted`、ignore外の出力先。いずれもrun dir / outputを作らない |
| `judgeFormalValidity()` | 全条件 | 変更なし（全条件を維持） |

削除したtestは無い（B-2A専用の「実登録が無効」assertをB-2Bの「実登録が有効かつ完全」assertに置き換え、無効・不完全はsynthetic登録で引き続き検証）。

## 2. 入力・条件・provenance

| 項目 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（`registeredMatched = true`、`cliMatched = true`、親・各childで同一） |
| PlannerInput | `globalResearchInputFromExport(json, 1000)`。validation issue 0、planning Target **43**（eligible 43）、BuildListEntry 43（valid 43 / excluded 0）、OwnedWeapon 40、Normal Counter 14（全件confirmed） |
| Engine / Context | `production-rng:c5-e7`、`{ unknown-initial, 4, production-rng:c5-e7, 17 }` |
| 条件 | §1.1 の登録値（`conditionBasis` はすべて `registered condition (ASSIGNMENT_B2B_PREREGISTRATION)`） |
| provenance | `mode = formal`、`workingTreeClean = true`、`uncommittedBenchmarkCode = false`、`registration.unresolvedItems = []`、`formalRunEnabled = true`、`smokeOverrides = []`、`oracleFreeExecution = true`、`oracleInformedDesign = true`、`benchmarkCodeSha256 = 30404688…e06047`、B-2A記録SHA-256 `78218a4a…292c57d` |
| 環境 | Windows 11 x64（10.0.26200）、Node v24.19.0、AMD Ryzen 7 9700X（16 logical CPU）、物理memory 31.1 GiB（起動時free 15.1 GiB）。test / build / 他のNode processと並行させていない |

command（Exportのpathだけローカル）:

```bash
node scripts/run-planner-global-assignment-b2a.mjs --mode formal --export "<local path>/gogma-artian-planner-backup_20260927015837.json" --expected-export-sha256 cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b --run-dir .local/ga-b2b-formal.run --output .local/ga-b2b-formal.result.json
```

## 3. formal validity

`formalValidity.status = valid`、`issues = []`。

| check | 値 |
| --- | --- |
| registrationGate / committedCleanTree / noOverrides / exportRegisteredMatched | true / true / true / true |
| reproducibility | requiredRuns 2、runs 2、measuredRuns 2、allMeasured、noIntegrityIssues、recordsConsistent、semanticHashesEqual、identical すべてtrue |
| rootLowerBoundStage | requested、executed、status `found`、provenBound `exact_minimum`（relaxation minimumの証明）、recordConsistent true |
| comparisonConsistent | true（gap 109） |
| aggregateIntegrityIssueCount | 0 |

process: assignment-1 / assignment-2 / root-bound の3 childはすべて `completed`（exit 0、timeoutなし、`close` でsettle）。自動retry・fallbackは行っていない。runner exit code 0。

## 4. Assignment結果

### 4.1 再現性

| run | status | semantic SHA-256 | node trace hash | outcome |
| --- | --- | --- | --- | --- |
| assignment-1 | measured（record整合） | `28077de18264e0cf0dd00b13c23466aa4957d023154b0ec0d799fb819f09162d` | `fnv1a32:0fffabb4` | `assignments_found / candidate_limit_reached` |
| assignment-2 | measured（record整合） | 同上（一致） | 同上（一致） | 同上 |

`determinism.identical = true`。required-only replay（snapshot 5候補 × 43 option = 215 option）は2 runとも `passed`、invariant違反0件
（prediction skill 111 / Reset 120 / Keep 210 / Normal 26）。snapshotは登録上限5件。

### 4.2 ReachTable（Phase A、W0）

| 項目 | 値 |
| --- | --- |
| 実window | Skill 341→1841（origin 341）、Gogma 55→554（origin 55）、Normal 7 Counterで各350位置（SnS 7 / DB 349 / HBG 4 / GS 156 / SA 0 / CB 0 / Hammer 24 から） |
| prediction（memo hit） | skill 30,020（34,523）、Gogma Reset 10,000（11,500）、Gogma Keep 299,500（5,500）、Normal 7,000（8,050）。support query 15,842、group 20 |
| source | owned_gogma 148 / owned_normal 0 / new_normal 15,050（計15,198）。unsupported 0、除外武器なし、optionの無いTarget 0 |
| Target別option数（上限1,000で飽和） | 42 Targetが1,000、1 Targetが525。root MRV計数は全Targetで8（k = 8で飽和） |

### 4.3 Solver（Phase B-1）

| 項目 | 値 |
| --- | --- |
| expandedNodes / maxDepth | **1,043** / 43 |
| candidates | 1,000（candidate limit到達） |
| resource conflict棄却 | source 63、skill_position 93,155、gogma_position 513,665、normal_position 0 |
| deadEnds / pruned | 0 / 0（UB未供給 `upperBoundSupplied: false`） |
| completeness | solverは `running`（limitで停止）、outcome `assignments_found / candidate_limit_reached` |
| 窓内 `LB(empty)` | 1,255（設計 §10.1のwindow内緩和下界。§10.2のroot下界ではない） |
| 先頭候補 | ordinal 0、node 43、objective **1,766** |
| 最良候補 | ordinal 0、objective **1,766** |
| distinct objective | **1**（1,000件すべて1,766） |
| 最良のstream終端 | Skill 1,424（+1,083）、Gogma 503（+448）、Normal CB 207（+207）/ DB 371（+22）/ SnS 12（+5）/ SA 1（+1）/ GS・Hammer・HBG +0（Normal計 +235） |
| snapshot 0の内訳 | source owned_gogma 38 / new_normal 5、Skill要件 none 21 / reset_skills 17 / conversion 5、Bonus要件 reset 1 / keep_from_source 19 / reset_then_keep 23、required位置 Skill 22 / Gogma 66 / Normal 5 |
| window移行判定 | `hold`（`assignments_found_remainder_unconfirmed`）、`concludesInfeasibility: false`、`ladderExhausted: false` |

### 4.4 completenessの解釈

- `candidate_limit_reached` は探索木の完全な終了ではない。**未探索の枝が残っている**（node budget 2,000には達していない: 1,043 node）
- 取得した1,000件はすべて同objective 1,766 の兄弟葉（最後のTargetの同じstream終端を与える別のrequired位置・source。snapshot 4ではsource構成が
  owned_gogma 37 / new_normal 6 に変わるが終端は同じ）。W0内に1,766より小さいobjectiveの割当が存在するかは**未確認**
- node budget到達（`search_incomplete`）でも exhausted でもない。「W0に完全割当が無い」「1,766がW0の最小」のどちらも主張しない
- 登録ladderはW0の1段だけで、判定は `hold`。W1以降は実施しておらず、window拡大の効果は未計測

## 5. Root Lower Bound

| 項目 | 値 |
| --- | --- |
| status | **`found`**、`provenLowerBound = 1,657`（budget 2,000） |
| 対象集合 | 下限moduleのeligible 43 = planning Target 43（eligibleでvalid Entryの無いTarget 0、planningでeligibleでないTarget 0）→ 一致 |
| cross satisfaction監査 | 同weapon type・同elementのTargetペア54件、可能ペア **0件**（Skill state候補 Series 26 / Group 18。Master Series 25 / Group 17）→ distinct source前提成立 |
| relaxation minimum | 1,657 = Skill +1,083（閾値1,424）+ Gogma +235（閾値290）+ Normal +339（CB 207 / DB 126 / SnS 5 / SA 1、他0） |
| 次点（`nearMinimum`） | 1,669、1,672、1,674、1,676、1,682 … |
| box内optionの無いTarget | 0。Target別option数は42件が2,000〜2,006、1件が4 |
| objectiveとの比較 | best 1,766 − 1,657 = **gap 109**、`consistent`（`lowerBoundKind = proven_minimum_of_relaxation`） |

1,657 は実Exportと `production-rng:c5-e7` から計算した緩和下界で、下限moduleの前提（`LOWER_BOUND_ASSUMPTIONS`）のもとで「全planning Targetを完成させるどのPlanも
1,657操作以上」を意味する。緩和は位置排他・stream間順序・被覆を捨てているので、1,657のassignmentがC1 / C2で成立するか、Productionで到達可能かは分からない。
gap 109 は主にGogma終端（割当 +448 vs 緩和 +235）とNormal DB（割当 +22 vs 緩和 +126）の配分差として現れている。

## 6. 時間・メモリ

| stage | assignment-1 | assignment-2 |
| --- | --- | --- |
| child setup（Vite SSR loader、module読込、Export読込・照合・formal child gate） | 1.49 s | 0.85 s |
| Phase 0 context | 1.71 s | 1.73 s |
| Phase A ReachTable | 11.83 s | 11.88 s |
| solver構築 | 2.41 s | 2.32 s |
| 診断: option数え上げ / root MRV計数 | 17.20 s / 5.24 s | 16.82 s / 5.19 s |
| 窓内 `LB(empty)` | 12 ms | 12 ms |
| solver（先頭候補まで / 合計） | 42.94 s / 43.03 s | 40.94 s / 41.02 s |
| required-only replay | 15 ms | 15 ms |
| 計算合計 / child wall | 81.44 s / 82.98 s | 78.99 s / 79.88 s |
| peak RSS / heapUsed（250 ms sampling） | 1.29 GB / 842 MB | 1.06 GB / 559 MB |
| maxRSS / heap limit | 1,260,708 KiB / 4.50 GB | 1,038,520 KiB / 4.50 GB |

| root-bound child | 値 |
| --- | --- |
| LB stage / child wall / setup | 151.8 s / 154.3 s / 0.81 s |
| peak RSS / heapUsed / maxRSS | 586 MB / 314 MB / 574,412 KiB |

親の合計wall（3 child逐次）: **317.8 s**。どのchildも登録envelope（60 min / 20 min、4,096 MB）の数%以内で終了した。solverの先頭候補まで約41〜43 s（43 node、
dead end 0）で、B-2A smoke同様、下降1 nodeあたり約1 sのMRV計数が支配的である。

## 7. measurement HEADから最終PR headまでの変更

計測後に追加・変更したのは次だけである。

- `docs/PLANNER_GLOBAL_ASSIGNMENT_B2B_RESULT.json`（新規。§8の公開用派生成果物）
- `docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_B2B.md`（本書）
- `docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md` §14（B-2B記録へのリンク1文）

`git diff <measurement HEAD>..<PR head> -- src scripts package.json package-lock.json vite.config.ts vitest.config.ts tsconfig*.json` は空であり、計算関連コード・登録条件・
登録文書（B-2A記録）は計測後に変わっていない。登録Export識別子のauthorityであるB-2A記録も変更していない。

## 8. 公開RESULTの作り方

Repositoryは公開されているため、正式RESULT JSONは **formal出力からの機械的な派生成果物** とした。元のformal record（`start.json`、各child record、集約RESULT）は
変更せず `.local/`（git-ignored）に保管し、RESULTの `derivation.sources` にfile名・bytes・SHA-256を記録した。

| 元file（`.local/`） | bytes | SHA-256 |
| --- | --- | --- |
| `ga-b2b-formal.result.json`（集約RESULT） | 30,784 | `59075bfd05ac4f5f3fe7ca39087d2359d48a82ebe1a7e64ec8c09f51089cd7c2` |
| `ga-b2b-formal.run/start.json` | 3,211 | `22226795ec7714b0a0a7835f0f8498cc3cf46450dc2dcfd7d21e7fb0d85d0a08` |
| `ga-b2b-formal.run/assignment-1.record.json` | 430,543 | `c122b8b491eaf4befa634d48d29b54033a93022af5e94007ff8c744b581cc986` |
| `ga-b2b-formal.run/assignment-2.record.json` | 429,018 | `fda6ba52568255eb9a8f48ff68739d58ed47fac1f01e0dc725a9019497fc96a9` |
| `ga-b2b-formal.run/root-bound.record.json` | 21,853 | `29aaf236ee40b323176dd259fce43c6798c926e9cff453a0d3e95d9fa71fd9f7` |

- 派生の内容: provenance・条件・formal validity・再現性・走査 / solver / 候補 / replay / root下界の診断summary、Target別診断、node trace先頭256件、objective列（run-length）、
  snapshot 5件のsummaryとsnapshot 0の43 option、stage時間・メモリ、process一覧
- 匿名化: ユーザー固有のUUIDを機械的に置換した。planning Target ID → `T01`〜`T43`（走査のplanning Target順）、それ以外のUUID（OwnedWeapon ID、38件）→ `W01`〜（assignment-1 recordでの初出順）。
  Master ID、Normal Counter ID、RNG Counter位置、objectiveは変えていない。置換後にUUID形式の文字列が残らないことを検査した
- 含めないもの: Export本体、ReachTable本体、候補snapshotのfull 5件（summaryのみ。full recordは `.local/`）、process stderr
- `formalValidity`、`integrityIssues`、比較結果などの監査情報は省略・変更していない

## 9. Oracle isolationとpost-hoc注記

runnerは oracle manifest / verifier / RESULT JSON を読まず、post-hoc引数も取らない（`oracleFreeExecution = true`）。設計は1,657 oracleの構造にinformedである
（`oracleInformedDesign = true`）。登録値はB-2A smoke由来で、項目ごとに `oracleInformed = false`。

post-hoc（計測終了後、本書だけで行う。runnerへ戻さない）: root下界1,657はPhase 2-A.5の下限監査・1,657-step oracleの操作数と同じ値になった。本計測はそれを入力にも
上限にも使っていない。structural objective 1,766 は1,657より109大きく、Production検証も行っていないので、どちらの値についても最短性・到達可能性を主張しない。

## 10. Phase Cへの引き継ぎ

- W0でC1 / C2を満たす43 Target全体の割当は存在する（1,000件確認、すべてobjective 1,766）。Phase CはこのW0の `ResourceAssignmentCandidate` を入力にCounter被覆
  （設計 §8）を確かめる。被覆不成立なら `coverage_infeasible` として §10.3 の移行規則に従う
- 値順序は同objectiveの兄弟葉を先に列挙するので、candidate limitを増やしてもobjectiveの多様性は増えない。別objectiveの割当を見るには、node budgetを使った
  探索の継続、Phase Cでの被覆駆動の値順序、またはPhase Eの探索順序変更が必要（本Phaseでは判断しない）
- 下降1 nodeあたり約1 sのMRV計数（C2不適合option、特にGogma位置の棄却51万件）がsolver時間の大半を占める。Phase E（incremental pruning等）の性能課題として残る
- backtrack（dead end後の再下降）は本計測でも0件で、そのnode当たりコストは未観測
- 1,766と下界1,657の差109は、Gogma終端とNormal DBの配分差。1,657を実現する割当がC1 / C2・被覆で成立するかは未確認
- W1以降のladderは未登録。登録する場合は別PRで、W0 formal結果（`hold`）を踏まえた事前登録として行う

未確認事項: W0内の最小objective、W1以降の効果、Counter被覆、materialization、Production Planner検証、Trace Replay、Browser Worker / スマートフォンでの実行。

## 11. validation

（計測前・measurement HEADのコード）2026-10-12、計測と並行させずに実行。

| コマンド | 結果 |
| --- | --- |
| `git diff --check` / `npm run check:nul`（1,406 files）/ `npm run lint` / `npx tsc --noEmit -p tsconfig.app.json` | pass |
| `npm test` | pass（384 files / 6,447 tests、3 skipped、約139 s。timeoutなし） |
| `npm run build` | pass（既存の500 kB chunk warningのみ。`dist/` にResearch識別子なし） |

最終PR headでの再検証結果はPR本文に記録する。

## 12. 変更していないもの

Production RNG Engine（`production-rng:c5-e7`）、Production Search / Planner / Planner Alternative、UI / Worker / Persistence、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17 / `DATABASE_SCHEMA_VERSION` 10 / `ExportRoot.schemaVersion` 13 / `AppSettings.schemaVersion` 2 /
`RngState.schemaVersion` 2 / Master `dataVersion` 4、Phase AのReachTable・到達判定、Phase B-1 solver・MRV順序・Reset→Keep列挙、Root Lower Boundの計算ロジック、
事前登録値（window / budget / envelope / 再現性run数）、B-2A記録（登録Export識別子のauthority）、既存formal RESULT JSON、runnerの計測ロジック。
