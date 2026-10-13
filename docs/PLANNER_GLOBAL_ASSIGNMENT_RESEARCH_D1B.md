# Global Planner Global Assignment Phase D-1B（Planner検証条件の整合と正式計測条件の事前登録）

Refs #154。Research-only・**非formal**（formal runなし）。基準main: PR #253 merged `982b29bd84f7e57827172aa6fa061fb1ef1b9705`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / 追加worktreeなしを確認）。branch: `research/global-assignment-phase-d1b`。

本書は [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）§14 の **D-1B** を記録する。Phase D'の成立判定に残っていた2つの不整合
（非物理Stepを含むPlanの物理操作数、runtime-unsupported retryの採否）を正式仕様に合わせて整理し、既存のD-1A検証器を最小限修正し、
D-1Cの正式統合acceptance条件を事前登録した。**D-1Cのformal runは行っていない**（`formalRun.enabled` は false）。D-1Cの正式計測結果も、成功値も、本書には書かない。

## 1. 目的

| やること | やらないこと |
| --- | --- |
| 非物理Step（`confirm_owned_ideal`）を含むPlanの物理操作数の判定を正式仕様に合わせる（§3） | Production RNG / Search / Planner / Trace Replay Domain / UI / Worker / Persistence / schemaの変更 |
| runtime-unsupported retryの採否規則を明確化する（§4） | Production Plannerのretry実装の変更 |
| `verify.ts` の必要最小限の修正とsynthetic test（§5 / §6） | Phase A / B / C、D-0A materialization、D-0Cの登録条件・正式RESULT、D-1Aのraw recordの変更 |
| D-1Aの実測を根拠にしたD-1Cの正式条件の事前登録（§8〜§13） | D-1Cのformal runner・formal RESULT導出・正式計測、Phase Eの最適化 |
| 修正済みclean HEADでの実Exportの非formal再確認（§7.2） | 2件目以降のstructural candidate、W0以外のwindow |

## 2. 仕様authority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → タスク固有の詳細仕様（`docs/PLANNER_SPEC.md` / `docs/SEARCH_SPEC.md`）→ その他の正式仕様 →
最新mainの実装 → test → 過去の記録である。本書はResearch記録であり、正式仕様でもDomain仕様でもない。

| 根拠 | 内容 |
| --- | --- |
| REQUIREMENTS 22.1 | 生産計画の総量はProductionPlanの物理Step列をauthorityとして集計し、共有Stepは1回だけ加算し、`confirm_owned_ideal` などゲーム内消費を伴わないものは加算しない |
| PLANNER_SPEC 16.3 | 操作0のEntry（`existing_gogma_current`）はCounterを進めない `confirm_owned_ideal` Stepで完成する。現行Planに独立の確保Stepは無い（`reserve_weapon` / `confirm_result` はlegacy） |
| 設計 §1.4 | physical operation = Counterをちょうど1進めるStep。`confirm_owned_ideal` を含まない |
| 設計 §9.5 / §9.6 / §10.4 | Phase D'の成立条件、outcome分類、full Planner run数は観測値・Research maxPlanSteps 20,000 |
| 設計 §11 / §12 / §13.1 / §13.2 / §14 / §16 | oracle isolation、決定性、synthetic / 統合acceptance、Phase分割、Production契約との境界 |
| [D-1A記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md) §7〜§12 | 実測値、D-1Bで登録すべき論点、未確認事項 |
| [D-0C記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md) / [公開RESULT](PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json) | formal materialization（正式計測2）、formal validityの先例 |
| [D-0B-2記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md) | D-0Cの登録条件・登録Export identity |

既存のProduction authority（変更していない）: `src/benchmarks/plannerGlobalPhase2BPlan.ts`（`summarizePlanPhysical()`）、`src/domain/planner/productionPlanGeneration.ts`、
`src/domain/planner/plannerTraceReplay.ts`、`src/domain/planner/plannerPlanningTargets.ts`。正式仕様と実装の矛盾は見つからなかった（§3 / §4の規則は既存の正式仕様の言い換えであり、
ゲーム仕様もProduction semanticsも変えていない）。

## 3. 非物理Stepと物理操作数

### 3.1 問題

設計 §9.5は `physical.total === plan.steps.length` を成立条件にしていたが、Production Planには、Counterを進めない `confirm_owned_ideal` Step（所持しているIdeal武器の完成確認）が
存在し得る。これは物理操作ではない（REQUIREMENTS 22.1、設計 §1.4）。したがって、操作0のTargetを含む候補では、正しいPlanでもこの等式が成り立たず、D-1Aの規則では
`objective_mismatch(physical_steps_mismatch)` になっていた（D-1Aの実Export候補は非物理Step 0件なので影響なし）。

### 3.2 確定した規則（設計 §9.5を改訂）

```text
physicalOperations = plan.steps.length − nonPhysicalStepCount     (11a)
physicalOperations = streamAdvanceSum                              (11b)
physicalOperations = structuralObjective                           (12)
```

- それぞれ完全一致を要求する。許容誤差は無い
- `nonPhysicalStepCount` は `confirm_owned_ideal` Stepの数（`PLANNER_VERIFICATION_NON_PHYSICAL_STEP_TYPES`）。物理操作数・非物理Step・Σ stream前進は `summarizePlanPhysical()` の値で、
  Research側で数え直さない
- 共有物理Stepは1 Plan Stepなので1回だけ加算される（`summarizePlanPhysical()` はPlan Stepごとに数える）
- 物理Stepは正しいCounterをちょうど1進める。2つのCounter・2以上・Counter無し・別streamの前進は `summarizePlanPhysical()` が拒否し、fail closedする
- 非物理StepはCounterを進めない。`confirm_owned_ideal` がCounterを進めると `summarizePlanPhysical()` が拒否する（`Unknown physical operation confirm_owned_ideal`）
- `confirm_owned_ideal` 以外のCounterを進めないStep（現行Planは生成しないlegacyの `reserve_weapon` 等）は非物理Stepに数えず、(11a) を破る（fail closed）
- 非物理Stepの数が増えてもstructural objectiveは増えない（操作0のoptionはstream終端を動かさない）。物理操作数とobjectiveの元々の意味は変えていない

### 3.3 改訂の前後（synthetic例。§6のtestと同じ実materialization・実Production Planner）

| 例 | Plan steps | 物理 | 非物理 | Σ前進 | objective | D-1Aの規則 | D-1Bの規則 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 非物理Stepなし（3つの既存シナリオ） | = 物理 | — | 0 | = 物理 | = 物理 | `conditions_met` | `conditions_met`（同じ） |
| 操作0のTarget 1件 + 新規Normal Route 1件（`zeroOperationHandoff(['a'])`） | 6 | 5 | 1 | 5 | 5 | `objective_mismatch`（`physical_steps_mismatch`: 5 ≠ 6） | `conditions_met` |
| 操作0のTarget 2件 + 新規Normal Route 1件（`zeroOperationHandoff(['a', 'c'])`） | 7 | 5 | 2 | 5 | 5 | `objective_mismatch`（5 ≠ 7） | `conditions_met` |
| 上の1件目でobjectiveを +1 / −1 にしたhandoff | 6 | 5 | 1 | 5 | 6 / 4 | `objective_mismatch` | `objective_mismatch`（`physical_objective_mismatch` だけ） |
| `confirm_owned_ideal` にGogma +1を与えたPlan（改変） | 6 | — | — | — | 5 | 不成立 | `objective_mismatch`（`physical_summary_error`） |
| `confirm_owned_ideal` をlegacy `reserve_weapon` に置き換えたPlan（改変） | 6 | 5 | 0（予期しない1） | 5 | 5 | 不成立 | 不成立（(11a)と対応検査） |

操作0のTargetだけで構成した候補（全planning Targetが開始時にIdeal）は、Productionのwarning `all_targets_already_satisfied` で条件9（warning 0）が不成立になる。これは
Productionの既存の挙動であり、緩めていない（synthetic fixtureは物理Routeを1件含めている）。

## 4. runtime-unsupported retry

### 4.1 問題

D-1Aの `verify.ts` は、full Planner run（`beforePlannerRun()`）が2回以上なら不成立理由 `runtime_unsupported_retry` を追加していた。しかし設計 §9.5 / §10.4では
full Planner run数は観測項目であり、回数だけで不成立とする条件は無い。

### 4.2 確定した規則

- full Planner run数は診断情報として必ず記録する（`PlannerRunRecord.fullPlannerRuns`、2 processの判定の `fullPlannerRuns: { first, fresh }`）
- retry発生自体を独立した不成立条件にしない。最終Planの `termination`、`completedTargetCount` / `totalTargetCount`、selected Entry集合、Conflict・rejected・resource_conflict、
  warnings 0、独立Trace Replay、物理操作数とobjectiveの一致、fresh Plannerとの一致で判定する
- **retry回数が多いから不成立なのではなく、正式成立条件が満たされない場合に不成立**である。Productionのretryは除外したEntryについて `rng_prediction_unsupported` warningを出し、
  そのEntryは選ばれず、そのTargetは完成しないので、通常は条件9（warning 0）・条件3 / 4 / 5で不成立になる。このwarning判定は緩めていない
- Production Plannerのretry実装は変えていない
- Production Planner内部のruntime-unsupported retryと、Research runnerの子process再試行は別概念である。後者はD-1Cでも行わない（自動retryなし、G6 / G7）

### 4.3 改訂の前後（synthetic例）

| 例 | full run | warning | D-1Aの規則 | D-1Bの規則 |
| --- | ---: | --- | --- | --- |
| retryなし（既存の成功シナリオ） | 1 | 0 | `conditions_met` | `conditions_met`（同じ） |
| 実Productionのretry（`runtimeUnsupportedRetryHandoff()`: 1回目のrunの後でbの巨戟化のSkill supportがunsupportedになるEngine。Plan生成内のTrace Replayがbを除外して再実行） | 2 | `rng_prediction_unsupported` 1 | `planner_rejected`（plan null、termination exhausted、completed 0 / planning 2、total 1 / 2、warnings、**runtime_unsupported_retry**） | `planner_rejected`（同じ理由から `runtime_unsupported_retry` を除いたもの） |
| 模擬retry（portが `beforePlannerRun()` を1回余分に呼ぶだけ。Production結果は通常どおり） | 2 | 0 | `planner_rejected`（`runtime_unsupported_retry` だけ） | `conditions_met`（full run 2を記録） |
| 模擬retry + warning注入 | 2 | 1 | `planner_rejected`（warnings、runtime_unsupported_retry） | `planner_rejected`（warningsだけ） |
| retryなし + warning注入 | 1 | 1 | `planner_rejected`（warnings） | `planner_rejected`（warnings。上と同じ理由） |

2 processの判定（条件13）では、full run数はverification semantic recordに含まれる。firstとfreshでrun数が違えばrecordが一致せず `planner_rejected(cross_process)` になる
（決定性の検査であり、回数による不成立ではない。両processとも同じ回数で他の条件をすべて満たせば `verified`）。

## 5. Research verifierの変更内容

| file | 変更 |
| --- | --- |
| `src/benchmarks/globalAssignment/verify.ts` | 条件11を (11a) / (11b) に分けた（`PlannerConditionChecks.physicalStepCountIdentity` / `physicalStreamAdvanceIdentity` / `physicalObjectiveIdentity`。旧 `physicalEqualsPlanSteps` / `physicalEqualsObjective` は削除）。`PhysicalRecord` に `nonPhysicalStepCount`（`confirm_owned_ideal` の数）、`unexpectedNonPhysicalSteps`、`identities`（3つの恒等式）を持たせた（旧 `identityHolds` は `identities.streamAdvance` に置換）。理由 `physical_steps_mismatch` は非物理Step数と予期しない非物理Stepを持つ。`runtime_unsupported_retry` を `PlannerRejectionReason` から削除（full run数は `PlannerRunRecord` に記録）。物理summaryと恒等式判定を純関数 `summarizeVerificationPhysical()` / `physicalIdentityReasons()` として公開し、Trace Replayの対応検査も同じ非物理Step集合を使う。`PLANNER_VERIFICATION_PROTOCOL_VERSION` を `global-assignment-d1b:1` に上げた |
| `src/benchmarks/globalAssignment/verificationRegistration.ts`（新規） | D-1Cの事前登録 `PLANNER_VERIFICATION_D1C_PREREGISTRATION`（§8）、網羅性・整合性検査 `plannerVerificationD1cRegistrationIssues()`、登録条件の取出し `registeredD1cConditions()`、runの条件との差分 `differencesFromD1cRegistration()`、fingerprint `d1cRegistrationFingerprint()`、本書のblockの読取り `readD1cRegisteredD0cIdentity()` / `readD1cRegisteredRegistrationFingerprint()`、formal runの拒否 `d1cFormalRunIssues()` |
| `src/benchmarks/globalAssignment/verificationTestFixture.ts` | `zeroOperationHandoff()`（`confirm_owned_ideal` を含む実Plan）、`runtimeUnsupportedRetryHandoff()`（実Productionのretry） |
| test | `verify.test.ts`、`verificationProtocol.test.ts`、`verificationRegistration.test.ts`（新規）、`isolation.test.ts`、`scripts/run-planner-global-assignment-d1a.test.ts`（protocol版数のliteral） |
| docs | 本書、設計 §4.3 / §9.5 / §9.14 / §9.15 / §10.4 / §13.2 / §14、D-1A記録（追記のみ） |

`verificationProtocol.ts`（`judgeD1aRun()` / `concludeD1aRun()`、D-0C同一性照合、Entry集合、integrity検査）・runner script・D-0C formal module・materialization moduleは変更していない。
protocol版数を上げたのは、判定規則とsemantic recordの形（checksの項目、`PhysicalRecord` の項目）が変わり、同じ入力でもD-1Aのrecordとhashが一致しなくなるためである。
D-1Aの記録（`global-assignment-d1a:1`）を新しい版数のrecordとして読み替えない。materialization protocol（`global-assignment-d0a2b:1`）とsemantic recordは変わらない。

## 6. synthetic test

| file | 内容 |
| --- | --- |
| `verify.test.ts`（D-1B: 9 test追加・既存3 testの期待値更新） | 非物理Step 0件の従来ケース（3シナリオで物理 = Plan steps = Σ前進）、`confirm_owned_ideal` 1件 / 2件での成立（物理 = steps − 非物理 = Σ前進 = objective、D-1Aの等式では不成立になること、Trace Replayの対応 5 / 5・reserve draft）、非物理Stepがobjectiveを増やさないこと、objective ±1の `objective_mismatch`（恒等式11は成立）、非物理StepのCounter前進・物理Stepの別stream前進・legacy型の非物理Stepのfail closed、共有物理Stepの1回加算とΣ前進の不一致（純関数、改変は明記）、Trace Replay対応検査の維持（draft欠落で不成立）、retryなし（full run 1）、実Productionのretry（full run 2・warning・完成数で不成立、retry理由なし）、模擬retryの成立と、warningがあれば回数に関係なく不成立。既存の「retry回数だけで拒否」の期待値は §4の規則に合わせて削除し、条件11のchecks名を更新した |
| `verificationProtocol.test.ts`（D-1B: 2 test追加・protocol literal更新） | `confirm_owned_ideal` を含む候補の2 process判定が `verified`（physicalOperations 5、planSteps 6、objective 5、post-hocは物理操作数を読む）、full run数がverdictに残り、両processが同じ回数で全条件成立なら `verified`、片方だけなら `planner_rejected(cross_process)`（`differingFields: ['planner']`） |
| `verificationRegistration.test.ts`（新規、9 test） | §11〜§13の登録内容: 全項目の網羅（value / unit / basis / evidence / oracleInformed false / observedRange / unconfirmedRange）、W0 / a2 / d0a2-v2 / 候補1・verification budget 1・maxPlanSteps 20,000・envelope・repeat 2（各run = first + fresh）、D-0Cの登録条件との一致と不変、D-1Aの非formal条件との差分0、不変性（deep freeze、代入でTypeError）とfingerprint（本書のblockと一致、formalRun以外の変更で変わる）、D-0C同一性blockとD-0C公開RESULTの一致と曖昧なblockの拒否、計算コード監査（runnerのcode pathsの固定、許可fileの範囲、計算fileを許可すると拒否、D-0Cのformal guardが引き続き拒否）、formal validity規則と期待結果を持たないこと、formal runが無効で不完全な登録を名前付きで拒否 |
| `isolation.test.ts` | `verificationRegistration.ts` を実行時moduleに追加。Planner / Search / Trace Replay / 予測の呼出し・import外・formal claim・registration HEADのSHA・fingerprint literalを持たないこと、どのrunnerもまだ登録moduleを読まないこと |

既存test（D-1Aの正常系・失敗系、D-0C semantic golden（formal / RESULT）、`d0a-v1` golden、PR #248 Production Search golden、a1 / a2、G1〜G4、property / parity、
独立Route検証、Planner scheduler・Trace Replay、timeout / OOM / integrity failureの分類）は削除・skip・緩和していない。

## 7. D-1A実測との関係

### 7.1 D-1Aの記録

D-1A（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1A.md)）は当時の成立条件で測定した非formal記録である。実Exportの最初のstructural candidate（43 Target）は、
Plan steps = 物理操作数 = objective = 1,766、非物理Step 0件、full Planner run 1回（first / freshとも）だった。したがってD-1Bの規則でも (11a) 1,766 = 1,766 − 0、(11b) Σ前進 1,766、
(12) objective 1,766 はすべて成立し、retry理由はもともと生じていない。D-1Aの値・判定は書き換えていない（D-1A記録には追記だけを加えた）。
D-1Aのverification semantic SHA-256（`86b1b254…`）は `global-assignment-d1a:1` のrecordの値であり、D-1Bの版数のrecordとは比較しない。

### 7.2 非formal再確認（D-1Bの規則、修正済みclean HEAD）

（計測後に記入する）

## 8. 事前登録条件一覧

`PLANNER_VERIFICATION_D1C_PREREGISTRATION`（`src/benchmarks/globalAssignment/verificationRegistration.ts`）。各項目は値・単位・根拠・根拠run（evidence）・
`oracleInformed`（すべてfalse）・観測範囲・未確認範囲を持つ。D-1Aの `D1A_NONFORMAL_CONDITIONS` は非formalの記録として残し、登録済みだったようには改変していない。

| 項目 | D-1C登録値 | 単位・意味 |
| --- | --- | --- |
| materialization | `MATERIALIZATION_D0C_PREREGISTRATION`（`registeredD0cConditions()`、D-0C登録条件をそのまま） | 再materializationの条件 |
| reachWindow | W0（Normal 350 / Gogma 500 / Skill 1,500） | D-0C登録値と一致を検査 |
| optionSetVersion | `global-assignment-reach-options:a2` | 同上 |
| methodSelectionRule | `d0a2-v2` | 同上 |
| structuralCandidateLimit | 1 | 同上 |
| verificationBudget | 1 | 1 complete runでPhase D'へ渡す候補数（§9.2） |
| researchMaxPlanSteps | 20,000 | final inputの `PlannerInput.options.maxPlanSteps` |
| firstChildWallMs | 1,800,000 ms | first子process（再materialization・同一性・Entry集合・Phase D'） |
| freshChildWallMs | 1,800,000 ms | fresh子process（入力再構築・自身のPhase 0・Entry集合照合・Phase D'） |
| childHeapMb | 8,192 MB | 全子processの `--max-old-space-size` |
| concurrency | 1 | 同時に動く子process数 |
| childProcessRetry | none | Research子processの自動再実行（Production Plannerのretryとは別） |
| repeat | 2 complete runs | 1 complete run = first + fresh（正常時は計4子process）。D-0Cの「materializationだけの2 run」とは別 |
| planner | `createProductionPlanWithObserver` | 通常のProduction Planner（決定的scheduler） |
| traceReplay | `replayPlannerSearchTrace_independent` | Productionの独立Replay（条件10） |
| freshValidation | `separate_node_process_required` | 条件13、別Node processで必須 |
| runIntegrity | `zero_issues_required` | run integrity issue 0件必須 |
| oracleFreeExecution | true | 設計 §11 |
| exportIdentity | D-0B-2記録の `registered-export-*` block | 登録Export（§11.3） |
| d0cIdentity | 本書の `registered-d0c-*` block | D-0C同一性（§11.2） |
| calculationContext | `unknown-initial` / Master 4 / `production-rng:c5-e7` / 計算版数 17 | D-0C登録値と一致を検査 |
| verificationProtocolVersion | `global-assignment-d1b:1` | Phase D'のrecord版数 |
| materializationProtocolVersion | `global-assignment-d0a2b:1` | D-0C登録のresearch protocol |
| registrationHead | `d1b-merge-commit`（D-1Bのmerge commit。D-1Cが記録） | §13 |
| calculationCodeAudit | code paths = D-1A runnerの `CODE_PATHS`、許可file 14件、登録の変更はformalRunの有効化だけ | §13 |
| formalValidity | provenance 15規則 / reproducibility 9規則 / candidate outcome 6規則 | §12 |
| acceptanceInterpretation | 合格 = formal validity valid かつ candidate `verified` | §12.4 |
| formalRun | `enabled: false`、`startsIn: 'D-1C'`、`enabledBy: null` | D-1B時点でformal未実施 |

登録の完全性は `plannerVerificationD1cRegistrationIssues()` が検査し（欠落・不正値・D-0Cとの不一致・protocol不一致・計算fileの許可・規則の重複を名前付きで返す）、
`d1cFormalRunIssues()` は無効または不完全な登録を拒否する。登録objectはdeep freezeしてある。

登録のfingerprint（`d1cRegistrationFingerprint()`: `formalRun` を除いた全項目の `hashStableValue`。D-1Cはこの値とcommit済みの本書のblockを照合する）:

```text
registered-d1c-registration-fingerprint: fnv1a32:2393847e
```

## 9. 各値の採用根拠

根拠run（evidence）の対応:

| id | 内容 | HEAD |
| --- | --- | --- |
| `d1a-nonformal-1` | D-1A非formal確認1（置き換え済み、内容不変） | `933546e7a278f2bed12a840db2ac48ce46a18a97` |
| `d1a-nonformal-2` | D-1A非formal確認2（現行） | `3fd5c144fa71ea00ffc01ef0b78905c448f97783` |
| `d1b-nonformal` | D-1Bの非formal再確認（§7.2） | §7.2に記入 |
| `d0c-formal-2` | D-0C正式計測2 | `8ff0e18968e6749e4e6b5e29dfc6232bdc35376c` |
| `design 10.4` | 設計 §10.4（Research maxPlanSteps 20,000） | — |
| `B-2B registration` | B-2Bの正式記録（root下界 `found` 1,657） | — |

### 9.1 materialization・window・option集合・方式・候補数

D-0Cの登録条件を変えずに使う。D-0Cのrecordは Entry ID / hashだけを持ちEntry本体を持たない（D-0C §16.3）ので、D-1CもD-1Aと同じく同じ条件で再materializationして
Entry本体を得る。D-0Cの正式計測は `formalValidity = valid`、2 runのsemantic一致で、D-1Aの2回の非formal確認もsemantic SHA-256 `6f790d33…` を再現した。
D-0Cのformal modeは使わない（D-1A以降の変更を計算コード監査で拒否する。その挙動は維持する）。

### 9.2 verification budget = 1

D-0Cでmaterializationが正式に成立し、D-1Aで非formalに成立を確認した**最初のstructural candidate 1件**を正式統合acceptanceの対象にする。
`verificationBudget = 1` は**候補1件の検証上限**であり、探索全体の最小性を証明するための設定ではない。

- 2件目以降の候補は `not_attempted(verification_budget)` であり、「存在しない」ではない
- D-1Cで最初の候補が不成立でも、後続候補が存在しないとは結論しない
- 最初の候補が `verified` でも、それより物理操作数の少ない候補が無いとは言わない
- verification budgetはstructural candidate limit（1）を超えられない（materializeしていない候補は検証できない。登録検査で拒否）

### 9.3 Research maxPlanSteps = 20,000

設計 §10.4 / G12のResearch値であり、Phase D'の計測より前に設計で定めた値である。Production default 1,000ではなく、1,766・1,657・8,534などの
既知Route・Planの長さから逆算した上限でもない。到達は `incomplete(max_plan_steps)` = `planner_rejected` で、自動で増やさない。
D-1Aでは1,766 step（上限の8.8%）で `completed` だった。

### 9.4 envelope（wall-clock / heap）

| 項目 | 登録値 | D-1A非formal確認1 | D-1A非formal確認2 | 余裕 |
| --- | ---: | ---: | ---: | --- |
| first wall | 30分 | 39.7 s | 45.1 s | 約40倍 |
| fresh wall | 30分 | 7.9 s | 9.0 s | 約200倍 |
| first heapUsed最大 | 8,192 MB | 1.43 GB | 1.03 GB | 約5.7倍 |
| fresh heapUsed最大 | 8,192 MB | 0.41 GB | 0.39 GB | 約20倍 |
| first maxRSS | — | 1.54 GiB | 1.19 GiB | — |

30分 / 8,192 MBは観測値に対して余裕があるが、その上限付近までの処理が検証済みという意味ではない（§10）。8,192 MBはD-0Cの子process heap（4,096 MB）の2倍で、
Phase D'をmaterializationの上限付近で測らないための値であり、P0Rのfresh Planner（8,534 step）のmaxRSS 2.98 GiBも下回る。timeout / OOMは `unmeasured` で、
不成立にも成立にも読み替えない。

### 9.5 concurrency / 子processのretry / repeat

- concurrency 1: firstの後にfresh、その後に次のcomplete run（設計 §12）
- 子processの自動retryなし: timeout / OOM / cancel / process failureは `unmeasured`（G6 / G7）。Production Plannerのruntime-unsupported retry（§4）とは別
- repeat 2 complete runs: 各runでfirst / freshのverification semantic recordが一致し（条件13）、2 run間でmaterialization semantic SHA-256・Entry fingerprint・
  verification semantic SHA-256が一致すること。D-1Aは2回の確認（別HEAD）で同じverification semantic recordを観測した

### 9.6 Planner / Trace Replay / fresh / integrity / oracle

通常のProduction Planner（`createProductionPlanWithObserver()`、`conflictResolutions = []`）、Productionの独立Trace Replay（最後のfull runの `bestState`、Step対応と最終Counter）、
別Node processのfresh ordinary Planner（入力再構築・自身のPhase 0・Entry集合照合・新しいEngineとPlanner依存）、run integrity issue 0（PR #253 Required fix）、
oracle-free execution（設計 §11。`oracleInformedDesign` はtrueのまま）。いずれもD-1Aの実装・確認と同じであり、D-1Bで新しい経路は作っていない。

## 10. 計測済み範囲と未確認範囲

| 項目 | 計測済み（observedRange） | 未確認（unconfirmedRange） |
| --- | --- | --- |
| materialization | 最初のstructural candidate（objective 1,766）が全runで43 / 43 materialized | 他のwindow・option集合・規則・候補、他のmachine / Node version |
| verification budget | 候補ordinal 0（非formal確認で `nonformal_planner_verified`） | 2件目以降の候補（materialize・検証とも未実施）、より少ない物理操作数の候補の有無 |
| Research maxPlanSteps | 1,766 Plan stepで `completed`（8.8%） | 20,000 stepを超えるPlan、上限付近のPlanner時間・memory |
| first / fresh wall | 39.7〜45.1 s / 7.9〜9.0 s | 観測値から30分までの区間（何も実行していない。安全envelopeであり計測された費用ではない） |
| heap | first 1.43 GB、fresh 0.41 GBまで | 観測peakを超えるheap、より長いPlanのmemory |
| repeat / 決定性 | 同一machine・同一Nodeで2回一致 | 他のmachine / Node version |
| 非物理Step | synthetic（`confirm_owned_ideal` 1 / 2件） | 実Exportの非物理Stepを含む候補（このExportの最初の候補は0件） |
| runtime-unsupported retry | synthetic（実Productionのretryと模擬） | 実Exportでのretry（観測されていない） |

## 11. D-0C条件・同一性の継承

### 11.1 条件

D-1Cの再materialization条件は `registeredD0cConditions()`（`MATERIALIZATION_D0C_PREREGISTRATION`）そのものであり、D-1Bはその値をcopyしていない。
登録項目のwindow / option集合 / 方式 / 候補数 / CalculationContext / research protocolは、検査関数がD-0Cの登録値と一致することを確認する。D-0Cの登録条件・
登録HEAD（`3f67179`）・formal infrastructure一覧・正式RESULTは変更していない。

### 11.2 同一性（D-0C公開RESULTから写した照合値）

D-1Cが照合する値（D-0C公開RESULT `docs/PLANNER_GLOBAL_ASSIGNMENT_D0C_RESULT.json` の `determinism.semanticSha256s`（2 runとも）と `materializedEntries.fingerprint`。
写した時点のfileは基準main `982b29b` のblob `12ab1e1514ef1bc2dbb819f9cd7552440819de54`、26,866 bytes、SHA-256 `d8a2da4dc363dc3b84648c4dc102c02fc0359dd65957960e0d7e1da0639bc959`）:

```text
registered-d0c-materialization-semantic-sha256: 6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f
registered-d0c-entry-fingerprint: fnv1a32:ed959cc4
```

- **取得元**: D-1Cはこのblockを、measured HEADのcommit済みの本書から読む（`git show HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1B.md`、`readD1cRegisteredD0cIdentity()`。
  各keyちょうど1行、形式違反は拒否）。CLIの値にはしない（D-1Aの非formal runnerはCLIで渡していた）
- **比較のタイミング**: 再materializationが確定した後、Phase D'の前（D-1Aと同じ `compareD0cMaterializationIdentity()`）。不一致ならPlannerへ進まない
- **比較の内容**: 再materializationのsemantic recordのSHA-256、semantic recordから求めたEntry fingerprint、受け取ったEntry本体から求めたEntry fingerprintが、いずれも登録値と一致
- **使わないもの**: 過去のraw RESULT・Entry集合・D-1Aのraw recordを実行入力にしない。D-0Cの公開RESULTも、探索条件を変えるヒントとしては使わない
  （Research runtime moduleはRESULT fileを読まない。設計 §11.3）
- 登録testは、このblockの値がD-0C公開RESULTの値と一致することを確認する（test fileがcommit済みのRESULTを読むだけで、実行入力ではない）
- D-1Bは照合値・取得元・比較タイミングを登録するだけで、D-1Cの測定結果を埋め込まない

### 11.3 登録Export

D-0Cと同じExport。identityは既存のcommit済み [D-0B-2記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md) §2 の `registered-export-*` blockを参照する
（`gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`）。実Export本体はRepositoryへ追加しない。

## 12. formal validityの登録規則

D-1Cは次をすべて確認する（`formalValidity` 項目のrule id。D-1Cがこの通りに実装する）。

### 12.1 Provenance（15規則）

`registration_complete`（登録が完全）、`formal_run_enabled`、`registration_fingerprint_equals_registered_block`（登録値が登録時から不変）、`run_conditions_equal_registration`（登録値と実行条件が一致）、
`no_command_line_override`（CLI overrideなし）、`clean_committed_head`、`registration_head_is_ancestor`（登録HEADが祖先commit）、`calculation_code_audit_passed`（登録HEADとの差分監査が成功、§13）、
`production_calculation_unchanged`（Production計算コード変更なし）、`export_identity_matched`、`calculation_context_matched`、`rng_engine_version_matched`、`master_data_version_matched`、
`oracle_not_read`（oracle未使用）、`child_gates_passed`（子process側でもHEAD・条件・入力を照合）。

### 12.2 Reproducibility（9規則）

`two_complete_runs`、`first_and_fresh_separate_processes`（各runでfirst / freshが別process）、`planner_conditions_evaluated_in_both_processes`、
`first_fresh_verification_semantic_equal`、`runs_verification_semantic_equal`（2 complete run間のsemantic一致）、`materialization_semantic_equals_registered_d0c`、
`entry_fingerprint_equals_registered_d0c`、`run_integrity_issues_zero`、`result_integrity_issues_zero`。

`planner_conditions_evaluated_in_both_processes` は、両processがPhase D'を完了し、§9.5の全条件を評価して記録したことを要求する（**条件が真であることではない**）。
条件が成立したかどうかは候補outcome（§12.3）であり、formal validityには混ぜない（「formal validityがvalidでも候補が不成立の可能性はある」と整合させるための解釈）。

### 12.3 Candidate outcome（6規則）

formal validityと候補の成否を分けて記録する。`recorded_apart_from_formal_validity`、`valid_measurement_may_reject_candidate`（validでも候補が不成立の可能性はある）、
`planner_rejection_is_a_measured_outcome`（Planner rejectionは計測そのものの失敗ではない）、`timeout_oom_cancel_process_failure_unmeasured`、
`integrity_failure_is_invalid_measurement`、`verified_without_valid_provenance_not_accepted`（`verified` でもformal provenance不成立なら正式acceptance合格ではない）。
候補outcomeはD-1Aの判定（`judgeD1aRun()` / `concludeD1aRun()`）で求め、2 runで一致することを要求する。

### 12.4 完了の解釈

| 語 | 意味 |
| --- | --- |
| 正式acceptance（設計 §13.2） | formal validityが `valid` かつ候補outcomeが `verified`。両方が成立した場合だけ |
| `verified` | 登録条件で、最初のstructural candidateが両processの両runでPlanner成立 |
| `best_found` | 検証した候補のうち最良。verification budget 1では検証した1件そのもので、他の候補についての主張ではない |
| `proven_minimum` | 適用可能で証明済みの下界（設計 §4.6 / §10.2）と一致し、必要な探索完全性条件が成立した場合だけ。D-1Cはpost-hocに比較する |

D-1Aの1,766はD-1Aで成立した候補の非formalな結果であり、D-1Cの期待値・成功条件ではない（登録にもその値を判定条件として置いていない）。
B-2Bのroot下界1,657とは差があるので、1,766の最小性を主張しない。

## 13. D-1Cの計算コード差分監査方針

- **登録HEAD**: D-1Bがmainへマージされた後のcommit（D-1BのPRのmerge commit）。D-1B作業中に未来のmerge SHAは推測せず固定しない。D-1Cはそれを40桁の定数として記録し
  （D-0CがD-0B-2のmerge commitを `MATERIALIZATION_D0C_REGISTRATION_HEAD` に記録したのと同じ）、formal gateは (1) それがmeasured HEADの祖先であること、
  (2) measured HEADの登録fingerprintが本書の `registered-d1c-registration-fingerprint` と一致すること、を確認できなければ拒否する
- **差分監査の対象**: D-1A runnerの `CODE_PATHS`（`src`、`scripts`、`package.json`、`package-lock.json`、`vite.config.ts`、`vitest.config.ts`、`tsconfig.json`、`tsconfig.app.json`、`tsconfig.node.json`）の、
  登録HEADからmeasured HEADまでのcommit済み変更（`git diff --name-only`）。Working Treeはclean必須
- **許可するfile（D-1Cのformal infrastructure、14件）**: `scripts/derive-planner-global-assignment-d1c-result.mjs` / `.test.ts`、`scripts/run-planner-global-assignment-d1a.mjs` / `.test.ts`、
  `scripts/run-planner-global-assignment-d1c.mjs` / `.test.ts`（runnerは既存の拡張か新規のどちらか）、`src/benchmarks/globalAssignment/isolation.test.ts`、
  `verificationFormal.ts` / `.test.ts`、`verificationFormalResult.ts` / `.test.ts`、`verificationFormalTestFixture.ts`、`verificationRegistration.ts` / `.test.ts`
- **許可しないもの**: Production RNG / Search / Planner / Trace Replay、Phase A〜D'の計算（`verify.ts`、`verificationProtocol.ts`、materialization module、Phase A〜Cのmodule）、
  D-0Bの子process envelope（`planner-global-assignment-d0b-child-process.mjs`）、既存のB-2A / D-0B runner・D-0C RESULT導出、build configuration。いずれかの変更はformal runを拒否し、
  再監査・再登録を要する。登録検査は許可fileに計算関連fileが入ることを拒否する
- **登録moduleの変更**: `verificationRegistration.ts` でD-1Cが変えてよいのは `formalRun` の有効化だけ（`formal_run_enablement_only`）。fingerprintは `formalRun` を除いて計算するので、
  それ以外の変更はfingerprintの不一致で検出される
- **gitが答えられない場合**（shallow checkoutで登録HEADが無い等）は「変更なし」と読まず拒否する（D-0Cの教訓。CIのdepth 1 checkoutではformal gateは常にfail closedになる）
- **D-0Cのformal guard**: PR #253以降の変更を拒否する挙動は維持する（D-0Cの登録HEAD・formal infrastructure一覧・正式RESULTは変更していない。登録testで確認）

## 14. Oracle isolation

- D-1Bのcode・testは、oracle manifest / verifier / RESULT、過去RESULTのTarget別Route・位置、1,657の構造を入力にしていない。登録値はどれも `oracleInformed: false`
- 登録moduleは実行時に何も読まない（file・Repository・clock・Export・RESULTなし）。D-0C同一性の照合値とfingerprintは本書のblockだけにあり、moduleは64桁hex・fnv1a32のliteralを持たない（isolation test）
- 非formal再確認（§7.2）はD-1Aのrunnerをそのまま使い、oracle・`--optimum`・過去RESULTを読まない
- 設計自体は1,657の構造にinformedである（`oracleInformedDesign: true`、設計 §11.2）

## 15. 未確認事項

- **D-1Cの正式計測**: 未実施。D-1Bの登録だけでは統合acceptance（§13.2）の合格とは言わない
- **実Exportでの非物理Step・retry**: 最初の候補は非物理Step 0件・retryなしなので、改訂した規則のうち実Exportで効いたのは「非物理Stepが0件のときの同値性」だけ。非物理Stepを含む候補・retryはsyntheticでのみ確認
- **2件目以降のstructural candidate、W0以外のwindow、別Export、他のmachine / Node version / Browser Worker**: 未確認
- **envelopeの観測値より上の区間**: 30分・8,192 MBまでの区間は実行していない
- **共有物理Step**: Global AssignmentはC1（distinct source）とEntry-localな新規Normalにより共有物理Stepを生じない（実Exportで0件）。1回加算はPlanを改変した純関数testで確認
- **`planner_conditions_evaluated_in_both_processes` の解釈**: §12.2のとおり「全条件を評価したこと」と解釈した（候補の成否をformal validityに混ぜないため）

## 16. D-1Cへの引き継ぎ

1. D-1Bがmainへマージされた後のcommitを登録HEADとして記録する（推測で固定しない）
2. formal guard・provenance・RESULT導出を §13の許可fileだけで実装し、登録 `formalRun` を有効化する（他の項目は変えない。fingerprintで確認）
3. start gate / 子processのgateで §12.1の全provenance規則を、集約で §12.2の全reproducibility規則を判定する。登録Export・D-0C同一性は本書・D-0B-2記録のcommit済みblockから読む
4. 1 complete run = first + fresh（D-1Aと同じ子process構成）を2回、concurrency 1、自動retryなしで実行する。D-0C同一性はPhase D'の前に照合する
5. formal validityと候補outcomeを分けて記録し、正式acceptanceは両方の成立だけとする。`verified` / `best_found` / `proven_minimum` を §12.4のとおり区別する
6. 最初の候補が不成立でも後続候補の不存在を結論しない。D-1Aの1,766を期待値として扱わない
