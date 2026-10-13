# Global Planner Global Assignment Phase D-1A（Production Planner統合検証と非formal確認）

Refs #154。Research-only・**非formal**（事前登録・formal runなし）。基準main: PR #252 merged `65c1d5c6291ef1267641d4de40faf709b63497cd`
（作業開始時に `main` / `origin/main` / HEADの一致、Working Tree clean、stash / 追加worktreeなしを確認）。branch: `research/global-assignment-phase-d1a`。
**非formal実ExportのHEAD**: `933546e7a278f2bed12a840db2ac48ce46a18a97`（実装commit。clean、未commitの計算関連コードなし）。

**結果: 記録用分類 `nonformal_planner_verified`。** D-0Cの登録条件でmaterializationを再実行し、semantic SHA-256（`6f790d33…`）とEntry fingerprint
（`fnv1a32:ed959cc4`）がD-0Cと一致したことを確認してから、43 Entryで通常のProduction Planner・独立Trace Replay・別processのfresh ordinary Plannerを実行した。
両processとも設計 §9.5の全条件（43 / 43 completed、全Entry selected、Conflict / rejected / resource_conflict / warning 0、Trace Replay valid、
Plan steps = 物理操作数 = structural objective = **1,766**）を満たし、2 processのverification semantic recordは同一だった。
これは **D-1Aの非formal条件での確認** であり、正式に登録・計測した統合acceptance（D-1C）でも、正式な `VerifiedPlanRecord` / `bestVerified` でも、
`proven_minimum` でもない。

## 1. 目的・authority

正式仕様の順位は `AGENTS.md` のとおり `docs/REQUIREMENTS.md` → `docs/PLANNER_SPEC.md` / `docs/SEARCH_SPEC.md` → その他の正式仕様 → 最新mainの実装 → test →
過去の記録である。本書はResearch記録であり、正式仕様でもDomain仕様でもない。[Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）
§3.1 / §3.2 / §4.1 / §4.3 / §4.6 / §9.5 / §9.6 / §10.2 / §10.4 / §13.1 / §13.2 / §14 / §16、[D-0C記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md)（以下「D-0C」）§12 / §15 / §16.3に従う。

| やること | やらないこと |
| --- | --- |
| D-0Cでmaterializationが成立した候補を、通常のProduction Planner・独立Trace Replay・fresh ordinary Plannerで検証するResearch専用経路の実装 | Production RNG / Search / Planner / scheduler / Trace Replayの意味論、Domain schema / Persistence / UI / Workerの変更 |
| materializationのEntry本体をprocess内でPhase D'へ渡すseam（execution-only） | materializationの二重実行、期待形からのEntry手動生成、Entryの永続化 |
| synthetic test、実Exportでの非formal確認と本記録 | D-1Bの正式条件登録、D-1Cのformal run、Phase Eの最適化、2件目以降の候補 |

### この結果が意味すること・しないこと

| 本書の語 | 意味 | 意味しないこと |
| --- | --- | --- |
| `nonformal_planner_verified` | D-1Aの非formal条件で、最初のstructural candidateの43 Entryが設計 §9.5の全条件を2 process（同一process内のmaterialization + Phase D'、別processのfresh ordinary Planner）で満たし、両者が一致した | 事前登録したformal measurementの結果、正式な `VerifiedPlanRecord` / `bestVerified`、統合acceptance（§13.2）の合格、最短性 |
| 物理操作数 1,766 | このPlanのPhysical operation数（`summarizePlanPhysical()`、Plan steps・Σ stream前進・structural objectiveと一致） | 証明済みの最小値（`proven_minimum` は主張しない。§7.11） |

## 2. 実装範囲

| file | 内容 |
| --- | --- |
| `src/benchmarks/globalAssignment/materializationRunner.ts` | `MaterializationRunExecution.onMaterializedEntries`（execution-only callback）と `MaterializedEntriesHandoff`。materializationが返った候補ごとに、record済みTargetのEntry本体（structured clone）・Phase 0 planning Target ID・objective・stream終端・origin・stage outcomeを渡す。fail closedでは呼ばない。semantic / observed recordは不変 |
| `src/benchmarks/globalAssignment/verify.ts`（新規） | Phase D'の1 process分。handoff検査 → final input（Production replacement authority）→ planning Target集合 → `createProductionPlanWithObserver()` → `summarizePlanPhysical()` → 独立 `replayPlannerSearchTrace()` → 条件1〜12の判定と型付きoutcome |
| `src/benchmarks/globalAssignment/verificationProtocol.ts`（新規） | D-1Aの非formal条件（basis付き、`registered: false`、`oracleInformed: false`）、D-0C同一性照合、fresh用Entry集合（作成・照合・handoff化）、2 processの判定 `judgeD1aRun()`（条件13）、post-hocの操作数読み、journal読取り |
| `scripts/run-planner-global-assignment-d1a.mjs`（新規） | 親（gate・provenance・2子processの逐次実行・判定・RESULT）、`--role first`（materialization再実行 → D-0C照合 → Entry集合書出し → Phase D'）、`--role fresh`（Exportから再構築・自身のPhase 0・Entry集合の照合 → Phase D'） |
| test | `verify.test.ts`、`verificationProtocol.test.ts`、`verificationTestFixture.ts`、`scripts/run-planner-global-assignment-d1a.test.ts`（新規）、`isolation.test.ts`（D-1A moduleの規則を追加） |
| docs | 本書、設計 §9.14 / §14（D-1A / D-1B / D-1Cの行） |

### 2.1 Phase D'（`verify.ts`）の規則

1. **handoff**: stageが `all_materialized` でなければPlannerを実行せず、materializationのoutcome（`materialization_failed` / `materialization_unconfirmed` /
   `materialization_unsupported`）とする。`all_materialized` でも、同一Targetの重複Entry、Entry IDの重複、planning Target外のEntry、Entryの無いplanning Target、
   `validateBuildListEntry()` の不合格は `planning_target_set_changed` としてfail closedする
2. **final input**（設計 §9.5）: 生成Entryごとに `resolveBuildListEntryReplacement()` でそのTargetの唯一の元Entryを特定し（0件・複数件・ID衝突はfail closed）、
   `applyBuildListEntryReplacements()` で `-O + G` を作り、`validateBuildListEntryReplacements(…, 'replaced')` で確認する。`map()` による置換はしない
   （同一Targetの元Entryが複数あると生成Entryを重複登録し得るため）。非planning Targetの元Entryはそのまま残す。`conflictResolutions = []`、
   `options.maxPlanSteps` = Research条件。Target定義・OwnedWeapon・RNG状態・Normal Counter・CalculationContext・Masterは元入力と `hashStableValue` で一致を確認する
3. **planning Target集合**: `validatePlannerInput()` → `derivePlannerPlanningTargets()` の集合がPhase 0の集合と一致すること。増加（`planning_target_added`）、
   減少（`planning_target_removed`）、生成Entryの除外（`generated_entry_excluded`、除外理由はProduction validationのもの）、入力のissue（`final_input_invalid`）、
   final inputでの重複（`duplicate_target_entries`）を区別する。固定値（43）は判定に使わない
4. **Planner**: `createProductionPlanWithObserver()`（Productionの決定的scheduler）。`beforePlannerRun()` でfull run数を数え、runtime-unsupported retryがあれば
   その回数を記録して不成立理由 `runtime_unsupported_retry` にする。Beam Search oracleや独自schedulerは使わない
5. **独立Trace Replay**: 最後のfull runの `bestState` を `replayPlannerSearchTrace()` で再生し、validity・issue code・unsupported input、Plan stepとの対応
   （physical draftとPlan stepの件数、各stepの操作種別・Entry・進行Target・RNG advance・Counter位置）、再生後のCounterとPlanのstream終端の一致を見る
6. **物理操作数**: `summarizePlanPhysical()` のPlan step数・物理操作数・非物理step・Σ stream前進・共有物理step、stream別のstructural前進との対照（診断）
7. **成立条件**（すべて必須）: (1) plan有り (2) termination completed (3) completed = planning Target数 (4) total = planning Target数 (5) planning Targetの全Entryがselected
   (6) Conflict 0 (7) rejected 0 (8) resource_conflict 0 (9) warning 0 (10) Trace Replay valid（対応・最終Counterを含む）(11) 物理操作数 = Plan steps（恒等式を含む）
   (12) 物理操作数 = structural objective。1〜10のどれかが不成立なら `planner_rejected`（理由を全て列挙）、11 / 12だけが不成立なら `objective_mismatch`。
   許容誤差は無い。Planner自身のcancelは `unmeasured(cancelled)`
8. 条件 (13) fresh ordinary Plannerは `judgeD1aRun()` が2 processのrecordから判定する（§2.2）

### 2.2 2 processの判定（`judgeD1aRun()`）

- first processが完走しない（timeout / OOM / process failure / cancel）→ `unmeasured(first)`。D-0C同一性が不一致 → `stopped_d0c_identity_mismatch`（Planner未実行。候補outcomeを主張しない）
- firstのoutcomeが成立以外なら、freshの結果にかかわらずそれが最終（片方だけの成立を `verified` にしない）
- freshが完走しない → `unmeasured(fresh)`、fresh自身のPhase 0がfirstのPhase 0と違う → `planning_target_set_changed(fresh)`、freshのoutcomeが成立以外 → そのoutcome（`run: fresh`）
- 両方成立でもverification semantic record（SHA-256と項目別の一致）が異なる → `planner_rejected(cross_process, fresh_planner_mismatch)`
- それ以外だけが `verified`（記録用分類 `nonformal_planner_verified`）

**正式な `VerifiedPlanRecord`（設計 §4.3）との関係**: `verified` は設計の候補別status（§4.6）と同じ判定内容（§9.5の全条件 + fresh）を、D-1Aの非formal条件で
満たしたことを表す。D-1Aのrecordは `VerifiedPlanRecord` が持つ根拠（43 Entry、物理操作数、両processのPlanner要約）を `.local` のraw recordに持つが、
条件が事前登録されていない（Research maxPlanSteps・envelopeは暫定値）ので `VerifiedPlanRecord` / `bestVerified` にはしない。正式なものはD-1B登録 → D-1C formal runで作る。

### 2.3 Research runner

- **first子process**: `registeredD0cConditions()` の条件（D-0Cと同一、子process自身がregistrationを読み直してtaskと照合）で `runMaterializationSmoke()` を1回だけ実行し、
  `onMaterializedEntries` でEntry本体を受け取る。再計算が確定した後でだけ、semantic SHA-256（`JSON.stringify(semantic)` のSHA-256）と、
  record・受け取ったEntry本体それぞれから求めたEntry fingerprint（D-0C公開RESULTの `materializedEntries.fingerprint` と同じ式。parity testで固定）を、
  CLIで渡したD-0Cの値と照合する。不一致ならPlannerへ進まない。一致すれば、Entry集合をrun dir（git-ignored）へ排他書込みし、同じprocessで、新しいEngine・
  新しいPlanner依存（ID・Clock）でPhase D'を実行する
- **fresh子process**: 元Exportから入力を再構築し、自身でPhase 0を導出し、Entry集合fileのSHA-256（first recordの値）・kind・protocol・HEAD・Export・CalculationContext・
  Engine version・Entry fingerprintを照合してから、Entryを置換してPhase D'を実行する。Entry集合はResearch入力専用（Import / Persistenceへは流さない）
- **親**: CLIは `--export`、`--expected-export-sha256`、`--expected-d0c-semantic-sha256`、`--expected-d0c-entry-fingerprint`、`--run-dir`、`--output`（いずれも必須）と
  envelopeの非formal上書き・`--allow-uncommitted` だけ。run dir / outputは新規かつgit-ignoredに限る（Entry本体を書くため）。Exportは `--expected-export-sha256` と、
  `git show HEAD:docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B2.md` の登録identityの両方と一致すること。子processは逐次（concurrency 1）、自動retryなし、
  process別のwall-clock / heap、timeout / OOM / cancel / process failureはD-0Bの `runChildProcess()` で独立に分類する。progressと各stageの時刻・memoryはjournal（同期追記）と
  recordに残す。出力・Entry集合・recordは排他書込みで、既存のraw record / RESULTを上書きしない
- runnerはoracle（manifest / verifier / RESULT）・過去のRESULT・`--optimum` を読まず、64桁hex・UUIDのliteralを持たず、conflict resolutionを合成しない（isolation testで固定）

## 3. D-0Cとの関係

- D-0Cのsemantic recordはEntry ID / 本体hashだけを持ち、Entry本体を持たない（D-0C §16.3）。D-1Aは同じ条件でmaterializationを再実行してEntry本体を得て、
  再計算が確定した後に同一性を照合した。過去のraw record・公開RESULTは探索・materializationの入力にしていない（照合値はCLIで渡し、比較は再計算後だけ）
- D-1Aは計算関連file（`materializationRunner.ts` のexecution-only seam、新規module・script・test）を追加したので、D-0Cのformal modeは計算コード監査
  （`MATERIALIZATION_D0C_FORMAL_INFRASTRUCTURE_FILES` の外の変更）で拒否する。D-1A実装commitで実際にformal startを試み、
  `A formal run cannot start: Calculation-related files changed since the registration HEAD outside the D-0C formal infrastructure: …` で、run dir / outputを作らずに
  拒否されることを確認した（D-0C §16.3の3のとおりの挙動。D-0Cの記録・公開RESULTは変更していない）
- seamがsemantic recordを変えないことは、`d0a-v1` golden（4 runner case）とd0a2-v2 recordの「callback有無で同一」testと、実ExportでのD-0C semantic SHA-256の一致で確認した

## 4. 条件（すべて非formal・未登録）

| 項目 | 値 | basis |
| --- | --- | --- |
| materialization条件 | `registeredD0cConditions()`（W0、node 2,000、MRV 8、ordering true、候補1、`a2`、`d0a2-v2`、gate / budgetはD-0C登録値） | D-0B-2登録・D-0C formal計測の条件をそのまま使用（D-0Cのformal modeは使わない） |
| materialization入力の `PlannerInput.options.maxPlanSteps` | 1,000（validationのみ） | D-0Cの入力構築と同一（Phase D'はResearch maxPlanStepsを書く） |
| Research `maxPlanSteps`（Phase D'） | **20,000** | 設計 §10.4 / G12のResearch値。Production default 1,000は使わない。**D-1Aの非formal条件**（D-1Bで登録） |
| first子process envelope | wall 1,800,000 ms（30分）/ heap 8,192 MB | 暫定: D-0C materialization 34 s、P0R fresh Planner（8,534 step）28.6 s / maxRSS 2.98 GiB。Planner検証のenvelopeとしては未登録 |
| fresh子process envelope | wall 1,800,000 ms / heap 8,192 MB | 同上 |
| concurrency / retry | 1 / なし | 設計 §12、G6 / G7 |
| envelopeの上書き | なし（記録runはすべて既定値） | — |

`oracleInformed` はすべて false（1,657や過去runのRoute・位置を値の根拠にしていない）。

## 5. 実行環境・コマンド

| 項目 | 値 |
| --- | --- |
| machine | AMD Ryzen 7 9700X（16 logical CPU）、物理memory 31.1 GiB（起動時free 11.6 GiB）、Windows 10.0.26200 x64 |
| Node / V8 | v24.19.0 / 13.6.233.17-node.51 |
| HEAD / tree | `933546e`、clean、未commitの計算関連コードなし、benchmark code SHA-256 `7d38f6738a653b939f8a27464b95e17aaee30daf1641377dd37d961ed865165b` |
| CalculationContext | `unknown-initial` / Master 4 / `production-rng:c5-e7` / 計算版数 17 |

```bash
node scripts/run-planner-global-assignment-d1a.mjs --export "<local path>/gogma-artian-planner-backup_20260927015837.json" --expected-export-sha256 cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b --expected-d0c-semantic-sha256 6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f --expected-d0c-entry-fingerprint fnv1a32:ed959cc4 --run-dir .local/ga-d1a-nonformal.run --output .local/ga-d1a-nonformal.result.json
```

親のexit code 0。`START d1a head=933546e7a278 clean=true uncommittedCode=false …`。first 39.7 s、fresh 7.9 s（いずれも `completed`、`close` でsettle）。親の合計47.7 s。

## 6. 実Exportのidentity

| | file名 | bytes | SHA-256 |
| --- | --- | ---: | --- |
| CLI指定 / `HEAD:` のD-0B-2登録identity | `gogma-artian-planner-backup_20260927015837.json` | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| 実Export（親・各子processがhash） | 同上 | 同上 | 同上（`cliMatched` / `registeredMatched` true） |

ExportはコピーもGit追加もしていない。

## 7. 結果

### 7.1 D-0Cとの同一性（Planner実行前に照合）

| 項目 | 再計算値 | D-0C | 一致 |
| --- | --- | --- | --- |
| materialization semantic SHA-256 | `6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f` | 同左 | ✓ |
| Entry fingerprint（semantic recordから） | `fnv1a32:ed959cc4` | `fnv1a32:ed959cc4` | ✓ |
| Entry fingerprint（受け取ったEntry本体から） | `fnv1a32:ed959cc4` | （recordと一致すること） | ✓ |
| handoff数 / 候補数 / semantic integrity issue | 1 / 1 / 0 | — | ✓ |

### 7.2 Phase Dの再materialization

semantic recordがD-0Cと同一なので、Phase 0〜Dの全出力（43 planning Target、ReachTable、structural candidate ordinal 0・objective 1,766、Target別outcome、Entry ID、
Search計数、独立Route検証）はD-0C §11 / §12と同一である。**43 / 43 `materialized`**（射影起点21、形状制約22）。所要: Phase 0 1.72 s、ReachTable 11.64 s、
structural search 18.23 s、materialization 1.82 s（Target合計1.80 s / 最大0.44 s）、materialization全体33.4 s（D-0Cの34 sと同程度）。

### 7.3 final input

| 項目 | first / fresh |
| --- | --- |
| replacement（Production authority） | 43件（各planning Targetの元Entry 1件 → 生成Entry 1件。unresolved 0） |
| 元Entry / final Entry / 残した元Entry | 43 / 43 / 0（このExportでは非planning TargetのEntryは無い） |
| Target定義・OwnedWeapon・RNG状態・Normal Counter・CalculationContext・Master | すべて元入力と一致 |
| `conflictResolutions` / `options.maxPlanSteps` | 0件 / 20,000 |
| `validatePlannerInput()` | valid、issue 0、warning 0、除外Entry 0（生成Entryの除外0） |

### 7.4 planning Target集合

Phase 0（first）43、final input 43（同一ID集合、増減0）、fresh process自身のPhase 0 43（firstと同一ID集合）。分母はPhase 0の集合で、固定値は使っていない。

### 7.5 Production Planner（first / fresh同一）

| 項目 | 値 |
| --- | --- |
| termination | **completed**（reachedLimits なし、limits.maxPlanSteps 20,000） |
| completed / total / planning Target | **43 / 43 / 43** |
| selected Entry | 43 / 43（生成Entryの集合と一致） |
| Conflict / rejected / resource_conflict / warning | **0 / 0 / 0 / 0** |
| full Planner run | 1（runtime-unsupported retryなし） |
| expandedStates（適用action数） | 1,809（物理1,766 + reserve 43） |
| Plan steps | **1,766** |

### 7.6 独立Trace Replay（first / fresh同一）

valid、issue 0、unsupported inputなし。draft 1,809（physical 1,766、reserve 43）。PlanのPhysical step 1,766とphysical draft 1,766を1対1で照合し、
操作種別・Entry・進行Target・RNG advance・Counter位置の不一致0、Counter位置不一致0。再生後のCounter（Skill 1,424、Gogma 503、Normal 14 stream）がPlanのstream終端と一致。

### 7.7 物理操作数

| 項目 | 値 |
| --- | --- |
| Plan steps / 物理操作数 / 非物理step | **1,766 / 1,766 / 0** |
| Σ stream前進 / 恒等式（物理 = Σ前進） | 1,766 / 成立 |
| 共有物理step | 0 |
| 操作種別 | create_normal_artian 235、convert_normal_to_gogma 5、reset_skills 1,078、reset_bonuses 77、keep_bonuses 371 |
| structural objective | **1,766（物理操作数と一致）** |

| stream | origin → 終端 | Planの前進 | structuralの前進 |
| --- | --- | ---: | ---: |
| Skill | 341 → 1,424 | 1,083 | 1,083 |
| Gogma | 55 → 503 | 448 | 448 |
| Normal（前進した4 stream、合計） | — | 235（207 / 22 / 5 / 1） | 235 |

stream別にもstructural candidateの前進とPlanの前進がすべて一致した（前進0のNormal streamを含む）。

### 7.8 fresh ordinary Planner（条件13）

別のNode process（pid・Vite loader・Engine・Planner依存がすべて別）で、Exportから入力を再構築し、自身のPhase 0（43）を導出し、Entry集合file（SHA-256
`79af681f0d4189a329927a376473f2510873915eccaf0f8e0db30ed231d52dd8`、Entry fingerprint `fnv1a32:ed959cc4`、照合issue 0）で置換してPhase D'を実行した。
条件1〜12をすべて満たし、**verification semantic SHA-256はfirstと同一**（`86b1b2544d8ff851933161eb18fbef84c0ccb5a2a22c00985da469824dccd580`、項目別の差0）。
Plan全体のhash `fnv1a32:903e4274`、Step semantic hash `fnv1a32:8d28811e` も同一。

### 7.9 判定

| 項目 | 値 |
| --- | --- |
| first / fresh のin-process outcome | `conditions_met` / `conditions_met` |
| 条件1〜12（first / fresh） | すべてtrue / すべてtrue |
| 条件13（cross process） | compared、identical、differing fields なし |
| 候補outcome（型付き） | `verified`（physicalOperations 1,766、planSteps 1,766、objective 1,766、planning Target 43、full run 1 / 1） |
| 記録用分類 | **`nonformal_planner_verified`**（§2.2のとおり正式なVerifiedPlanRecordではない） |

### 7.10 runtime / memory

| stage | first | fresh |
| --- | ---: | ---: |
| child setup（Vite loader、module・Export読込） | 0.84 s | 0.85 s |
| materialization（Phase 0〜D） | 33.4 s | — |
| fresh Phase 0 + Entry集合照合 | — | 約1.8 s |
| Phase D' handoff / final input | 1 ms / 308 ms | 1 ms / 308 ms |
| Production Planner（Plan生成内のTrace Replay・projectionを含む） | 4.31 s | 4.31 s |
| 物理操作数 / 独立Trace Replay | 3 ms / 410 ms | 4 ms / 412 ms |
| Phase D'合計 | 5.09 s | 5.10 s |
| child wall（record）/ 親の観測wall | 39.5 s / 39.7 s | 7.7 s / 7.9 s |
| heapUsed最大 / RSS最大（250 ms標本）/ maxRSS | 1.43 GB / 1.65 GB / 1,615,844 KiB | 0.41 GB / 0.84 GB / 834,644 KiB |

firstのheapUsedはmaterialization終了時0.74 GB、Planner終了時1.36 GB、Trace Replay終了時1.43 GB（stage境界の観測値）。heap size limit 8.79 GB
（`--max-old-space-size=8192`）。両processとも暫定envelope（30分 / 8,192 MB）の数%以内で終わった。

### 7.11 post-hocの比較（実行入力には使っていない）

- **incumbent 8,534（設計 §13.2、Phase 1-E / 2-A / P0R）**: 1,766は8,534未満で、§13.2の表では「操作数改善」に当たる。ただしこれはD-1Aの非formal条件での読みであり、
  正式な判定はD-1C（登録条件での統合acceptance）で行う。計算時間・memoryは別の指標で、ここでは主張しない
- **最小性**: D-1Aはroot下界を計算していない。B-2Bの正式記録のroot下界（`found` 1,657）とは109の差があり一致しないので、`proven_minimum` は主張しない
  （`d1aOperationCountReading()` の `proof: not_claimed`）。1,657 oracleとの比較（設計 §13.2の3）はpost-hoc analyzerの仕事で、D-1Aでは行っていない

## 8. 決定性

実装を未commitのまま実行した開発用run（HEAD `65c1d5c` + 同じコードの未commit状態、`--allow-uncommitted`、`.local/ga-d1a-dev1.*`）でも、materialization semantic SHA-256
`6f790d33…`、Entry fingerprint、verification semantic SHA-256 `86b1b254…`、判定 `nonformal_planner_verified` が記録runと同一だった（first 40.0 s / fresh 8.0 s）。
記録runのfirst / freshも同一である（§7.8）。開発用runは記録の根拠にしていない（本書の値はすべてclean HEAD `933546e` の記録runのもの）。

## 9. raw record（`.local/`、git-ignored、公開しない）

Target ID・OwnedWeapon ID・Entry ID / 本体・Target別Counter位置・Plan全Stepを含むので公開Repositoryへは入れていない。

| file | bytes | SHA-256 |
| --- | ---: | --- |
| `ga-d1a-nonformal.result.json`（親の集約RESULT） | 182,486 | `9bc4c48f9314a68882407d95bb49afcf321272a1927262837a2442dc70ec5dbd` |
| `ga-d1a-nonformal.run/start.json` | 4,833 | `56a6574fbe95a1039e518ed4ff1f7c4377993fd99b96fcb7a13546165d92fb4e` |
| `ga-d1a-nonformal.run/first.task.json` | 1,838 | `1fe235349d49842022b86749c632ad45b19145164f69e0a50371b989de5a9bfc` |
| `ga-d1a-nonformal.run/first.record.json` | 646,907 | `b45c0922c9d7581bb9734e074d689ac25458962adf14102db23e5dece63171ab` |
| `ga-d1a-nonformal.run/first.journal.jsonl` | 22,378 | `0c9c3567d0c0b584c8615c0a013942cfafbf5f2d4df6b8b7aa5c0ddd81b66dd3` |
| `ga-d1a-nonformal.run/first.entry-set.json` | 768,648 | `79af681f0d4189a329927a376473f2510873915eccaf0f8e0db30ed231d52dd8` |
| `ga-d1a-nonformal.run/fresh.task.json` | 781 | `8d13540a8e7d6ee6713494679ba125ca1a84c1ebd9c43b7cdf990a358b854227` |
| `ga-d1a-nonformal.run/fresh.record.json` | 31,773 | `49e6dc51278dff83ed0c309a56ae973ecd20e67a601d8562f474332e905bc79b` |
| `ga-d1a-nonformal.run/fresh.journal.jsonl` | 1,219 | `c7f1db7dd0f049a7375b5dd67c52c59656395aad8f5ad08ec01900c03f56adff` |

## 10. synthetic test・検証

| file | 内容 |
| --- | --- |
| `verify.test.ts`（新規、14 test） | 成功: 3つのsyntheticシナリオの実materializationで条件1〜12がすべて成立（physical = Plan steps = objective、stream別一致、stage順）、元入力不変、replacementの内容、非planning TargetのEntryの保持、同じhandoffからの決定性。失敗: stage `materialization_unconfirmed`（Planner未実行）、handoffの重複Target / Entry ID / planning Target外 / Entry欠落 / invalid Entry、planning Targetの増加、生成Entryの除外（stale）による減少、元Entry 2件のTarget（`replaced_entry_ambiguous`）、2つの実materializationの組合せによる実Plannerの `same_gogma_counter` Conflict（plan null、completed 0 / 2）、同一Idealの相互充足による `already_satisfied` rejected（completed 2 / 2でも不成立）、`maxPlanSteps` 1での `incomplete`、plan null・warning・runtime-unsupported retry・Plan生成error、Trace Replay invalid・対応不一致、objective不一致（許容誤差なし）・恒等式違反、cancelの `unmeasured(cancelled)`。いずれも成立にならない |
| `verificationProtocol.test.ts`（新規、11 test） | seam: `d0a-v1` golden 4 runner caseがcallback有りでも完全一致、d0a2-v2のsemantic / observed recordとSearch入力がcallback有無で同一（二重materializationなし）、handoffのEntryがrecordのID / hashと一致、clone。fingerprintがD-0C公開RESULTの導出と一致。D-0C同一性照合（一致・semantic不一致・fingerprint不一致・Entry本体改変・handoff数・integrity issue）。Entry集合（JSON往復、kind・HEAD・Export・CalculationContext・Engine・fingerprint・改ざん・不正形の拒否、freshのPhase 0の採用）。child processなしの全工程が `verified`。判定（片側成立は不可、fresh不一致・fresh rejected・Phase 0差・timeout / OOM / process failure / cancel・identity不一致・各outcomeの写像、操作数読みは `verified` だけ）。非formal条件・envelope検査・journal |
| `scripts/run-planner-global-assignment-d1a.test.ts`（新規、3 test） | 親のgate（usage、未知 / 重複 / 値なしoption、`--mode` 拒否、期待値の欠落・形式誤り、ignore外の出力、既存output / run dir、Export hash不一致、D-0C登録Exportでない、envelope不正。いずれも何も作らない）、手書きtaskの子process拒否（role・protocol・Research maxPlanSteps・HEAD・Export。recordなし、journalはstartedだけ） |
| `isolation.test.ts`（更新） | D-1A moduleの登録・import許可（`verify.ts` だけ `../plannerGlobalPhase2BPlan`）、Search / 予測 / materialization / 別scheduler / Beam oracle / resolution / lineage / Persistence / formal claimなし、Production authority呼出しの固定、runnerのoracle・hash・UUID・Planner port・resolutionなし、Production非依存 |

既存test（D-0C formal / RESULT、`d0a-v1` golden、PR #248 Production Search golden、a1 / a2、G1〜G4、property / parity、独立Route検証、Planner scheduler・Trace Replay）は
削除・skip・緩和していない（`isolation.test.ts` は新moduleの規則を追加しただけ）。

| コマンド（実装commit `933546e` の内容で実行） | 結果 |
| --- | --- |
| `git diff --check` / `npm run check:nul`（1,495 files） | pass |
| `npm run lint` | pass |
| `npm test` | pass（420 files / 6,875 tests、1 file・3 tests skipped（既存）、約144 s） |
| `npm run build` | pass（既存の500 kB chunk warningのみ。`dist` にD-1Aの識別子なし） |

最終PR headでの再検証とGitHub ActionsはPR本文に記録する。

## 11. D-1Bで登録すべき条件（提案。D-1Aでは決めない）

| 項目 | D-1Aの観測 | 登録時の論点 |
| --- | --- | --- |
| Research `maxPlanSteps` | 20,000で1,766 step・`completed`（上限の8.8%） | 設計 §10.4の20,000をそのまま登録するか。1,657 / 1,766 / 8,534を根拠に値を決めない（G12） |
| verification budget | 候補1件で `verified` | D-1Cの候補数（最初の候補1件か、Phase E向けに複数か）。structural candidate limitとの関係 |
| first子process envelope | 39.7 s、heapUsed最大1.43 GB、maxRSS 1.54 GiB | 30分 / 4,096 MB（D-0Cと同じheap）で足りるか、8,192 MBを維持するか。Plannerは長いPlanでmemoryが増える（P0R 8,534 stepで2.98 GiB） |
| fresh子process envelope | 7.9 s、heapUsed最大0.41 GB、maxRSS 0.80 GiB | 同上 |
| repeat / determinism | first / freshの2 processで一致、開発用runとも一致 | D-0Cと同じく2 run（各run = first + fresh）にするか |
| D-0C同一性の照合値 | CLIで渡したsemantic SHA-256 / fingerprint | 登録文書のblockから `git show HEAD:` で読む方式（B-2B / D-0Cの登録Export identityと同じ）にするか |
| 計算コード監査 | D-1Aで計算関連fileが増え、D-0Cのformal gateは拒否する | D-1Bの登録HEADと、D-1Cのformal基盤fileの一覧を新たに定める |

## 12. 未確認事項・注意

- **正式計測は未実施**: 本書の条件はすべて暫定・未登録。D-1B（登録）→ D-1C（formal run）まで、統合acceptance（§13.2）の合格とは言わない
- **2件目以降のstructural candidate、W0以外のwindow、別Export**: 未確認。最初の候補が成立したので、D-1Aでは後続候補を試していない
- **非物理stepと条件11**: 設計 §9.5の `physical.total === plan.steps.length` は、`confirm_owned_ideal`（Counterを進めない）Stepを含むPlanでは成り立たない。
  このExportの候補はゼロ操作Targetを含まない（非物理step 0）ので影響しないが、zero-operation optionを含む候補では設計の条件をそのまま適用すると不成立になる。
  D-1Aは設計どおりに判定し（`physical_steps_mismatch` を区別して記録）、緩和していない。D-1Bの前に設計で扱いを決める必要がある
- **warning 0の厳格さ**: 非planning Targetのstale Entryを元のまま残すとProductionのvalidation warning（`build_list_entry_stale`）が出て条件9で不成立になる
  （synthetic testで確認）。このExportにはそのようなEntryは無い。設計どおり緩和していない
- **他のmachine・Node version・Browser Worker**: 未確認（Node測定はProduction runtimeの根拠にしない）
- **G1 / G2継続形、射影起点→形状制約fallback、G4-i / ii / iii**: このExportの候補では対象0件（D-0C §16.2のまま）
- **Plannerの処理時間内訳**: `createProductionPlanWithObserver()` の4.3 sはscheduler・内部Trace Replay・execution projection等の合計で、内訳は計測していない
