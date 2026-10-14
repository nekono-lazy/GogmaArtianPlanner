# Global Assignment Production統合の詳細仕様設計（Production準備 P-3）

Refs #154。**docs-only**。基準main: PR #258 merged `4ab8e07654241c27df5e0a07dec73a12e9a2e877`
（作業開始時に `main` = `origin/main` = HEAD、Working Tree clean、stash / 追加worktreeなしを確認）。

本書は、Issue #154のGlobal Assignment Research（D-1C正式acceptance）とProduction準備P-2（実ExportのBrowser実測）を踏まえ、
Global AssignmentをGogmaArtianPlannerの通常機能として導入するためのProduction統合仕様を **設計案** として示す。
実装、正式仕様の書き換え、Production code・Research code・test・version定数の変更、実Exportの再計測は行っていない。

## 1. 位置づけとauthority

### 1.1 本書の性格

- 本書は **正式仕様ではない**。authorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md` → タスク固有の詳細仕様
  （`PLANNER_SPEC.md` / `SEARCH_SPEC.md` / `DATA_MODEL.md` / `UI_FLOW.md`）→ その他正式文書 → 実装 → test → 議論である
- Global Assignment ResearchのResearch文書（[設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)、[D-0A-2設計](PLANNER_GLOBAL_ASSIGNMENT_D0A2_DESIGN.md)、
  [Browser readiness（P-0）](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md)、[P-2記録](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2.md)）より下位であり、
  それらのResearch契約（G1〜G12、oracle isolation、formal記録）を変更しない
- 現在の正式仕様は初期版v1として固定されている（REQUIREMENTS 39）。全体最適化の追加はv1仕様への **機能追加** であり、
  本書の推奨案はOwnerの承認と正式仕様PR（§20 PR-1）を経るまで確定事項ではない
- 正式仕様と衝突する推奨案は §22 に「対応が必要な節」と「修正文案」を示す。本PRでは正式仕様の本文を変更しない

### 1.2 決定事項の区別（tag）

本書の各決定事項には、次のtagで根拠の種類を示す。**［推奨］と［Owner］は確定事項ではない。**

| tag | 意味 |
| --- | --- |
| ［仕様］ | 既存の正式仕様（REQUIREMENTS / PLANNER_SPEC / SEARCH_SPEC / DATA_MODEL / UI_FLOW）で確定済み |
| ［実装］ | 基準main `4ab8e07` の実装で存在・挙動を確認済み（関数・型・module名を含む） |
| ［Research］ | Global Assignment Researchの文書（設計・D-0A-2設計・P-0ほか）で定めたResearch契約・記録済みの事実（正式仕様ではない） |
| ［D-1C］ | Research D-1C formal measurement（[記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md)、[RESULT](PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json)）で確認済み |
| ［P-2］ | P-2 Browser実測（非formal、[記録](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2.md)、[RESULT](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_RESULT.json)）で確認済み |
| ［推奨］ | 本書のProduction向け推奨案（未確定。正式仕様PRで確定する） |
| ［Owner］ | Ownerの判断が必要（§21に一覧） |

### 1.3 用語

| 用語 | 意味 |
| --- | --- |
| Global Assignment（GA） | Issue #154のResearch algorithm（Phase 0 → A → B / C → D → D'）。Research codeは `src/benchmarks/globalAssignment/` と `src/domain/search/research/` |
| 作成リストの全体最適化（全体最適化） | 本書が提案するProduction機能名［推奨］。UIの操作名は「全体最適化を試す」。内部識別子の提案は `buildListOptimization`（§7.8） |
| 計画対象Target（planning Target） | PLANNER_SPEC 4.1の規則で決まるTarget［仕様］ |
| structural candidate / verified | GA設計 §3.1の区別。Production Planner検証を通ったものだけがverified［Research］ |
| 最適化結果（artifact） | 全体最適化の計算が返す、保存前のruntime-onlyな結果（§9.2）［推奨］ |
| Preview | 最適化結果を保存せずに表示する画面状態（§10）［推奨］ |
| 物理操作数 | Counterを1つちょうど1進めるPlanStepの数。`confirm_owned_ideal` を含まない（GA設計 §9.5、REQUIREMENTS 22.1） |
| 計画ステップ数 | `ProductionPlan.steps.length`（`confirm_owned_ideal` を含む） |

## 2. D-1C / P-2の確認済み成果

### 2.1 D-1C（Research formal、Node）

［D-1C］同じ実Export（`gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5b…e1e6b`、43 planning Target / 43 Entry / 40 OwnedWeapon）、
登録条件（window W0 = Normal 350 / Gogma 500 / Skill 1500、option集合 `a2`、方式選択規則 `d0a2-v2`、structural candidate 1件、verification budget 1、
Research maxPlanSteps 20,000、node budget 2,000、MRV lookahead 8）で次を確認した。

| 項目 | 値 |
| --- | --- |
| formalValidity / 候補outcome / acceptance | `valid` / `verified` / `accepted` |
| completed / planning Target、selected | 43 / 43、43 |
| Conflict / rejected / resource_conflict / warning | 0 / 0 / 0 / 0 |
| Trace Replay | valid（draft 1,809） |
| Plan steps = 物理操作数 = Σ stream前進 = structural objective | **1,766**（非物理Step 0） |
| expandedStates（scheduler action数） | 1,809（= 1,766 + 43 reserve） |
| full Planner run | 1 |
| materialization | 43 / 43（射影起点21、形状制約22） |
| 最小性 | `best_found`（root下界1,657、差109。`proven_minimum` ではない） |
| Node時間 | first子process 約38 s、fresh 約7.7 s、heapUsed ≤ 1.42 GB |

### 2.2 P-2（非formal、PC Browser）

［P-2］Windows 11 / Chrome 154 headed / Ryzen 7 9700X、locale `ja`、Research専用benchmark build（Production buildではない）。

| 項目 | 値 |
| --- | --- |
| semantic parity | `parity_confirmed`（必須比較run 3 / 3、比較Worker 10、Node reference・D-1C RESULTと完全一致） |
| logical run（first + fresh） | min 34.6 s / median 約34.75 s / max 35.1 s |
| first Worker総計算（median） | 約27.7 s（Phase 0 1.06 s、Phase A 9.1 s、Phase B / C 12.3 s、Phase D 1.2 s、Phase D' 3.8 s（Planner 3.3 s、Trace Replay 0.29 s）） |
| fresh Worker総計算（median） | 約5.0 s |
| 最大同期slice | Phase B / C 3,106 ms、Phase D' Planner 2,403 ms（fresh 2,441 ms）、Phase 0 1,063 ms |
| Worker isolate used heap（max sampled） | first 430,659,028 bytes（約431 MB）、fresh 373,307,116 bytes |
| renderer process private memory（max sampled） | 1,243,992,064 bytes |
| cancel試験 | 6 / 6 `cancel_passed`。うちPhase D'中の3件はWorkerがcancelをdispatchできず、main threadがcancel受付後に届いた結果を捨てた（C2経路） |
| storage | IndexedDB / localStorage / sessionStorage / Cache / Service Worker の変化なし |
| Android / iPhone | **未確認**（端末・安全な接続経路なし） |

### 2.3 一般化しない範囲

次は **確認していない**。本書はこれらを前提にした性能・成否を保証しない。

- 他のExport、W0以外のwindow、2件目以降のstructural candidate、verification budget 2以上
- Build Listに除外Entry（stale / completed / disabled Target）を含む入力（D-1CのExportは43件すべてvalidで、Phase D'は warning 0 を要求した。§4.3）
- 途中採用状態の選択、改善優先 `planner` 以外、部分的なRNG未確定状態を含む入力
- Android / iPhone、Edge / Firefox / Safari、Chrome以外のlocale、他のmachine
- Production build・Production ID factory・Production identity tokenでの実行（P-2はResearch harnessとResearch tokenで実行した）
- 最短性（1,766は `best_found`）

## 3. 通常Planner・Planner Alternativeとの責務分担

### 3.1 分担

| 機能 | 入力 | Routeの扱い | 競合 | 出力・保存 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| 通常Planner（「生産計画を作成」） | current stateの `createPlannerInput()`、`conflictResolutions = []` | 作成リストに登録済みのRouteをそのまま実行順へ並べる | 暫定帰結 + ユーザー判断待ちの競合を返す | `savePlannerResult()` でDraft保存。Build Listを書かない | ［仕様］REQUIREMENTS 19、PLANNER_SPEC 7 / 9.2.15 |
| Planner Alternative（「比較する」「この候補を優先」） | 表示中Draft + 明示決定 + lineage | 決定した競合の相手側Targetだけ代替Routeを探す（1段） | ユーザーの明示選択が起点 | repair artifactを `savePlannerAlternativeRepair()` で保存（Entry置換 + Draft + lineage） | ［仕様］REQUIREMENTS 23.1、PLANNER_SPEC 9.2.19 |
| 全体最適化（新規） | current stateの `createPlannerInput()`（§6） | 全planning TargetのRoute集合を、既存EntryのRoute内容を使わずに再構成し、Production Plannerで検証する | 競合解決ではない。検証済み結果は競合0 | Preview → 明示採用で「Entry一括置換 + Draft保存」（§12） | ［推奨］ |

［推奨］全体最適化は従来の「生産計画を作成」を **置き換えない**。ユーザーが作成リスト画面から明示的に起動する別操作とする。
Planner Alternativeは既存機能としてそのまま維持し、変更しない。

### 3.2 全体最適化が守る境界

- ［推奨］全体最適化の最終Planは、通常Plannerと同じ `createProductionPlanWithObserver()`（決定的scheduler）で、全体最適化が生成したEntry集合
  （§11）に対して1回生成する。Plannerの計算方式は通常Plannerと同じであり、全体最適化はRoute集合を作る層（Search / 割当）だけが異なる。
  したがって保存されるPlanは「採用後の作成リストに対する通常Planner Plan」と同じ意味を持つ（§18）
- ［Research］Research上の仮割当（structural candidate、reservation、形状条件）をユーザーの明示的な競合選択として扱わない。
  `PlannerConflictResolution`、`ProductionPlan.conflictRepairLineage`、PlanConflictの `selectedBuildListEntryId` へ書かない（GA設計 §16、Phase 2-C2.7-A G1）
- ［推奨］全体最適化の入力は `conflictResolutions = []` とし、保存済みDraftの明示解決・lineageを読まない。採用したDraftの `conflictRepairLineage` は `null`
  （新しいchain。通常Plannerと同じ）
- ［推奨］全体最適化は「明示選択の無い競合を自動で再検索する」機能ではない。ユーザーが作成リスト全体の再構成を明示的に起動し、Previewを見て採用する
  操作である（REQUIREMENTS 23との関係は §22.1）

### 3.3 他機能との関係

- **一括検索・追加**［仕様］UI_FLOW 9.1: 作成リストにEntryの無いTargetは全体最適化の対象外（§4）。全体最適化の対象を増やしたい場合は、先に一括検索・追加で
  Entryを作る導線を案内する［推奨］
- **再計画Preview / 採用**［仕様］PLANNER_SPEC 16.8: 実行中Planがある間は全体最適化を提供しない［推奨］（§13）
- **Candidate Search**: 全体最適化はCandidate Searchの結果・BuildCandidate tableを変更しない。生成したCandidateはEntryの `candidateSnapshot` としてだけ保存する
  （Planner-generated Entryと同じ規則、［仕様］DATA_MODEL 9.4「Planner-generated BuildListEntry」）

## 4. Production対象Target

### 4.1 基本

［仕様］planning Targetは `validatePlannerInput().validBuildListEntries` → `entry.targetWeaponId` → unique → `isEnabled = true` かつ `lifecycleStatus = "active"`
→ Target ID安定順である（PLANNER_SPEC 4.1、`derivePlannerPlanningTargets()`）。［実装］Research Phase 0（`createGlobalAssignmentContext()`）は同じauthorityで集合を固定し、
以後のPhaseで増減させない。

［推奨］初期Productionも **同じplanning Target集合を対象** とし、範囲を広げない。根拠なしにEntryの無いTargetを追加しない。

### 4.2 ケース別の扱い

| 入力 | 扱い | 根拠 |
| --- | --- | --- |
| Entryの無い有効・未完了Target | 対象外。完成数の分母に入れない。Previewで「作成リストに有効な候補が無い目標武器 N件は対象外です」と事実として示し、一括検索・追加を案内する | ［仕様］4.1 / ［推奨］表示 |
| stale Entryだけを持つTarget | 対象外（planning Targetにならない）。stale Entryは作成リストに残し、置換しない | ［仕様］4.1 / ［推奨］§4.3 |
| disabled Target / completed Target のEntry | 対象外。Entryは残す | ［仕様］4.1 |
| legacy duplicate（同じTargetのEntryが2件以上） | 通常Plannerと同じく入力が不正（`duplicate_build_list_entries_for_target`）。全体最適化を開始せず、既存の「要整理」案内で整理を求める | ［仕様］4.1、DATA_MODEL 9.4.1 / ［実装］Research `invalid_planner_input` |
| 一部のTargetだけ有効 | 有効なplanning Targetだけを最適化する。対象外TargetのEntryは変更しない | ［仕様］4.1 / ［推奨］ |
| valid Entry 0件 | 全体最適化を開始しない（通常Plannerと同じく計画対象なし） | ［仕様］4.1 / ［実装］Research `no_planning_target` |
| 途中採用状態を選択したEntry | §5.1 | ［Owner］ |
| 改善優先が `planner` 以外のEntry | §5.2 | ［Owner］ |
| 部分的なRNG未確定 | §5.3 | ［推奨］ |
| Planner開始時に理想品の所持巨戟を持つTarget（G4） | option集合 `a2` の規則（両軸Ideal sourceは操作0）に従う | ［実装］`sourceLaneAdmission()` |
| 1本の武器で2 Targetを満たし得る入力（cross satisfaction） | distinct sourceで探し、最小性を主張しない | ［Research］GA設計 §10.2 |

### 4.3 除外Entryがある入力でのPlanner検証（Production固有の判定規則）

［実装］Research Phase D'（`verify.ts`）は成立条件に **warning 0** を含む。一方、通常のBuild Listには完了済みTargetのEntry
（`completed_target_excluded`）、stale Entry（`build_list_entry_stale`）などが普通に残り、最終Plannerの入力validationはそれらを除外warningとして返す
（［実装］`plannerValidation.ts` の `currentEntryEligibility()`）。Research条件をそのまま使うと、完了済みTargetが1件でもある作成リストでは全体最適化が
常に不成立になる。D-1CのExportには除外Entryが無かったので、この規則は未検証である（§2.3）。

［推奨］Productionの成立条件では warning 0 の代わりに次を要求する。

- 最終入力の除外Entry集合（Entry IDと除外理由のwarning kind）が、全体最適化の入力validation（Phase 0）の除外Entry集合と **完全一致** する
- それ以外のwarningが1件も無い（`rng_prediction_unsupported`、`invalid_conflict_resolution`、`max_steps_reached` ほかを含む）
- 生成・再利用したEntryは1件も除外されていない（GA設計 §9.5と同じ）

この規則はResearchの成立判定（D-1C）を変更しない。Production実装PR（§20 PR-3）で仕様化し、除外Entryを含むsynthetic fixtureで固定する。

注記（本PRで見つけた既存の仕様と実装の差。本PRでは直さない）: PLANNER_SPEC 5は `PlannerWarningKind` の列挙を `plannerTypes.ts` と一致させると定めるが、
［実装］`plannerWarningKinds` が持つ `duplicate_build_list_entries_for_target` と `completed_target_excluded` が同節の列挙に無い。§4.3の規則はこの2 kindを
除外warningとして扱う前提なので、PR-1でPLANNER_SPEC 5の列挙を実装に合わせる（意味の変更ではなく記載漏れの補正）。

## 5. 途中採用状態などの制約

### 5.1 途中採用状態（checkpoint selection）

［仕様］`intermediateStateSelection` の選択はhard constraintであり、Plannerは無視・解除・別opportunityへの読み替えをしない（PLANNER_SPEC 7.5）。
選択を持つEntryはそのTargetのrequired Entryである（7.5.6）。［実装］Researchは、planning TargetのEntryのどれかが選択を持つ入力を
`unsupported_input(checkpoint_selection)` で全体fail closedする（`buildReachTable()`、GA設計 §15.1）。

| 案 | 内容 | 利点 | 欠点 |
| --- | --- | --- | --- |
| A: 全体fail closed（Researchのまま） | 選択を持つEntryが1件でもあれば全体最適化を開始しない。対象Targetを列挙し、作成リストで選択を解除するよう案内する（自動解除しない） | Research検証済みの範囲だけ。選択を黙って消さない | 選択を1件でも使うユーザーは全体最適化を使えない |
| B: 固定Routeとして共存 | 選択を持つEntryのRouteを固定し、その資源（required位置、排他OwnedWeapon、pinで止まるlane progress）を予約して、他Targetだけを再割当する | 選択と全体最適化を両立 | Phase A〜Cに固定Route・pin gating（PLANNER_SPEC 7.5.2）・pin-blocked skippable unitの被覆への影響を入れる新しいResearch設計と検証が要る。現行Researchで未検証 |
| C: 対象から除外して残す | 選択を持つTargetを最適化対象から外し、Entryを残す | 単純に見える | 除外TargetのRouteもCounter位置を使うので、実質はBと同じ設計が要る。「除外」だけでは成立しない |

［推奨］初期ProductionはA。選択の無いEntryの集合でだけ全体最適化を提供する。選択を持つTargetは「途中採用状態を選択している目標武器がある
ため、全体最適化を使えません」と対象Target名を示し、作成リストの該当グループへの導線を出す。Plannerにもpreviewにも選択の読み替え・解除を
持ち込まない。Bは別Issue・新しいResearch Phaseの対象とする［Owner］。

### 5.2 改善優先（improvement preference）

［仕様］改善優先はsoft preferenceであり、Entry置換では旧Entryの途中採用状態と改善優先を引き継がない（DATA_MODEL 9.4.1、PLANNER_SPEC 9.2.18）。
［実装］Researchは改善優先を入力条件にしていない（`buildReachTable()` は選択だけを検査する）。生成Entryの改善優先はmaterializerの既定値 `planner` である。

| 案 | 内容 |
| --- | --- |
| 1: 開示して既定へ戻す | 改善優先が `planner` 以外のEntryも対象にする。置換されるTargetの改善優先は「生産計画に任せる」になることをPreviewと採用確認で一覧表示する。置換されない（同一意味の既存Entryを再利用した）Targetは元のEntryと改善優先をそのまま保つ |
| 2: 全体fail closed | 改善優先が `planner` 以外のEntryが1件でもあれば開始しない |
| 3: 引き継ぐ | 生成Entryへ旧Entryの改善優先を移す |

［推奨］案1。Search画面の候補置換（9.4.1）と同じ「引き継がず、確認で明示する」規則に揃える。案3は既存の置換規則と矛盾し、かつPhase D'の検証は
生成Entryの既定値（`planner`）で行うので、引き継いだ値で保存すると検証していないPlanになる。soft preferenceの性質上、hard constraintの扱い（§5.1）とは
区別する。［Owner］案1と案2の選択。

### 5.3 部分的なRNG未確定状態

［実装］Researchは次を全体fail closedにする（`buildReachTable()`）。

- Base Seed / Skill Counter / Gogma Counterのいずれかが確定値でない（`unconfirmed_rng_state`）
- あるplanning Targetについて、使える所持sourceが無く、確定レア8 Normal Counterも無い（`unconfirmed_counter`。blind variantはoptionにしない）
- あるplanning Targetについて、所持sourceが無く、Normal予測がunsupportedでblind Routeしか無い（`blind_route_required`）

［仕様］AGENTS.md「Partial RNG State and Capabilities」は、capability不足が依存Routeだけを無効化し、無関係なRouteを無効化しないことを求める。
全体最適化を使えない場合も通常Planner・Candidate Searchは従来どおり使えるので、この原則と衝突しない。

［推奨］初期ProductionはResearchと同じく全体fail closedとし、理由と該当Target（RNG状態ならRNG Setup、Normal CounterならNormal Counter Setup）への導線を示す。
該当Targetだけ既存Entryを固定して他を最適化する拡張は §5.1 案Bと同じ設計を要するので、同じ後続Issueで扱う［Owner］。

### 5.4 その他のunsupported条件と分類

［推奨］Productionのunsupported reason（§9.1）は次とする。Researchの `unsupported_input` のreasonに対応させ、「実行可能解が存在しない」とは書かない。

| Production reason（提案） | Research reason | 表示の趣旨 |
| --- | --- | --- |
| `invalid_planner_input` | `invalid_planner_input` | 作成リストに整理が必要な項目がある（legacy duplicate、壊れた選択など）。既存のPlanner warningの案内を流用 |
| `no_planning_target` | `no_planning_target` | 作成リストに有効な候補が無い |
| `checkpoint_selection` | `checkpoint_selection` | §5.1 |
| `unconfirmed_rng_state` | `unconfirmed_rng_state` | RNG状態が未確定 |
| `target_without_source` | `unconfirmed_counter` | 所持武器が無く通常アーティアカウンターも未確定の目標武器がある |
| `blind_route_required` | `blind_route_required` | 予測できない作成経路しか無い目標武器がある |
| `running_plan_exists` | （Productionのみ） | 実行中の生産計画がある（§13）。main threadで開始前に判定する |

Engineの個別予測unsupportedは、そのTargetのoption不在として探索結果側（`not_found`）に現れる（GA設計 §5.5）。

## 6. 計算開始時の入力取得

- ［推奨］入力は通常Plannerと同じ `createPlannerInput()`（［実装］`src/services/planner/createPlannerInput.ts`）で、current persisted stateから作る。
  Researchの `globalResearchInputFromExport()`（Export → pure validation）は使わない（P-0 §4.3のDexieへの推移的依存もこれで切れる。§7.7）
- ［推奨］`conflictResolutions = []`。保存済みDraftの `baseSnapshot`、明示解決、lineage、実行中Planの情報を入力にしない（16.8のPreview入力と同じ規則）
- ［推奨］`PlannerInput.options` はmain threadが通常どおり作った値を渡すが、全体最適化はPhase D'の `maxPlanSteps` を §14.1 の規則で導出し、
  最終入力に設定する。Build List画面の詳細設定（「最大計画ステップ数」）は全体最適化に使わない（§14.1、§22.2）
- ［推奨］探索範囲（window）と探索上限はWorker境界内のProduction adapterが定数として渡す（Planner Alternativeの `defaultPlannerAlternativeSearchExtent` と同じ責務分離。§14.2）。
  Application caller・Worker request・UIは持たない
- ［推奨］採用時の再検証に使う **入力token** を、計算開始時に次の値で確定する（§12.2）

  | token項目 | 内容 | 作る場所 |
  | --- | --- | --- |
  | `initialExecutionState` | RngState / Normal Counter / OwnedWeaponのsemantic hash（`createExpectedPlanState()` と同じ正規化） | Worker（最終Planの `baseSnapshot.initialExecutionState` と同じ値） |
  | `targetWeaponsHash` | `createPlanningTargetWeaponsHash()` | Worker（最終Planと同じ値） |
  | `inputBuildListEntriesHash` | **入力時点** の作成リストの `createPlanningBuildListEntriesHash()`（最終Planのhashは置換後集合なので別に持つ） | Worker |
  | `calculationContext` | 入力のCalculationContext | Worker |
  | `observedDraftPlanId` | 計算開始時の現在Draft ID（無ければ `null`） | main thread（Application） |
  | `runningPlanAbsent` | 計算開始時に実行中Plan（active / stale）が無いこと | main thread（Application） |

## 7. Solver / Search / Planner構成

### 7.1 Productionの計算列

［推奨］Productionの計算列は、D-1Cで受理された組み合わせ（option集合 `a2`、方式選択規則 `d0a2-v2`）だけを持つ。`a1` と `d0a-v1` はResearch専用に残す。

```text
[Stage 0] 入力確認      validatePlannerInput() → derivePlannerPlanningTargets()、§5の前提条件、§4.3用に除外Entry集合を記録
[Stage A] 到達表        ReachTable（Production window。§14.2）
[Stage B/C] 割当探索    coverage-gated structural candidate generator（node budget、MRV lookahead。§14.2）
[Stage D] ルート生成    Phase Cの順序でTargetを1件ずつ:
                          連続形 → 射影起点Candidate Search → 不一致なら形状制約付きRoute探索
                          継続形・非連続形 → 形状制約付きRoute探索
                          形状制約付きRouteは独立Route検証（全operationの再予測）を通してから採用
[Stage D'] 計画検証     置換authorityで最終入力を作り、createProductionPlanWithObserver() を1回実行（maxPlanStepsは§14.1）
                          成立条件（§7.5）を満たせば最適化結果。満たさなければ次のstructural candidateへ（verification budgetまで）
```

### 7.2 Domain配置と責務移管

［Research］ResearchコードをProductionから直接importすることは禁止する（GA設計 §11.3 / §16、[`isolation.test.ts`](../src/benchmarks/globalAssignment/isolation.test.ts)）。
Production化は、Phase 6-B2a（PLANNER_SPEC 9.2.19.16。共有primitiveを `src/domain/planner/replacement/` へ中立化）と同じく、**中立なProduction Domain moduleへの責務移管** で行う［推奨］。

| 区分 | 移管先（提案） | 内容 | 移管しないもの |
| --- | --- | --- | --- |
| Search Domain | `src/domain/search/shapeConstrained/`（Production API。`src/domain/search/index.ts` から公開） | `visitShapeConstrainedRouteCandidates()` とその型・validation・base到達診断（seam fieldを持つ既存の7 Production fileは無指定時不変のまま残す） | — |
| Planner Domain | `src/domain/planner/buildListOptimization/` | Phase 0 context、ReachTable / option列挙（`a2` だけ）、割当solver（feasibility / LB / ordering / generator）、coverage・materialization順序・ExpectedRouteShape、materialization（射影起点 + 形状制約、`d0a2-v2` の順序）、形状制約Routeの独立検証、最終入力・物理操作数の恒等式・§4.3の成立判定、結果型 | root下界（`plannerGlobalLowerBound.ts`。Productionは最小性を主張しない）、formal gate・事前登録・protocol・runner・RESULT導出、G1 / G3 / G4診断、option集合 `a1`、規則 `d0a-v1`、counting engine、Browser harness、oracle関係 |
| Research（残る） | `src/benchmarks/globalAssignment/` | 上記Production moduleをimportするthin consumer（Phase 6-B2aと同じ依存方向）。Research固有部分はそのまま | — |

- ［推奨］移管は「移動 + Research側からの再利用」とし、同じ計算の二重実装を作らない（AGENTS.mdの二重実装禁止の趣旨、PLANNER_SPEC 9.2.3.1）
- ［推奨］Research上の識別子（algorithm token `global-assignment-d0a-materialization-v1` / `global-assignment-d0a2-shape-constrained-materialization-v1`、
  route policy `research-shape-constrained-route-policy:v1`、Candidate ID prefix `candidate.research.global-assignment.`）はResearch adapterに残し、
  Production adapterは別のtokenを持つ（§11.2）。これによりResearchの記録（D-0C / D-1C / P-2）のsemanticを変えずに移管できる
- ［推奨］移管PRの回帰条件: 移管後のHEADで、Researchの非formal D-1A runner（Node reference）が実Exportに対してD-1Cと同じmaterialization semantic SHA-256
  `6f790d33…cb18f`・verification semantic SHA-256 `0a56da0f…33dd4`・Entry fingerprint `fnv1a32:ed959cc4` を再現する（非formal確認。D-1C formal記録は再計測しない。
  D-1C formal runnerは計算コード監査で拒否されるのが意図どおり）

### 7.3 Search semanticsの維持

［仕様］SEARCH_SPEC 5.6.9は形状制約付きRoute探索をResearch専用とし、無指定時のProduction Search挙動・search identity・計算版数を変えないことを定める。

［推奨］Production API化では次を維持する。

- 無指定時（Candidate Search、Planner Alternative Search）の起動primitive、列挙、support問合せ、stream生成、予測内容と回数、Candidateの内容と順序、summary、
  search identityを変えない。既存golden（［実装］`src/test/fixtures/shapeConstrainedSeamProductionGoldenPreD0A2A.json`）とPlanner Alternativeの既存testをそのまま通す
- lane開始Idealでの継続（SEARCH_SPEC 5.6.1の例外）は、形状制約付きAPIを形が明示的に要求した場合だけに限る。通常Candidate Searchのlane開始Ideal規則は変えない
- 形状制約はreservationへ流用・追加・改変しない（SEARCH_SPEC 5.6.9、GA設計 §9.0）
- 形状制約付きRouteは通常のCandidate Search・Planner Alternative Searchが返さない形（lane開始Ideal継続、形が固定したsource・巨戟化位置・最終位置を持つRoute。
  held位置を跨ぐRoute自体はPlanner Alternative Searchがversion 16から生成している）を含むので、Candidate採用前の独立Route検証
  （［実装］Research `verifyShapeConstrainedRoute()` 相当）をProductionにも残す。失敗はfail closed

### 7.4 Phase Dの方式と、Production Searchに無い能力

［D-1C］43 Entryのうち22件は形状制約付き方式でだけ得られた（射影起点21）。D-0B（`d0a-v1`）では正当なreservation + 形状照合だけでは7 / 43で止まった
（[D-0B記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0B.md)）。したがって形状制約付きRoute探索のProduction API化（§7.2）は全体最適化の **必要条件** であり、
これを除いたProduction化はD-1Cの成果を再現しない［推奨・前提］。

### 7.5 Plannerによる最終検証（Production）

［推奨］Productionの成立条件（すべて必須）:

1. `termination.status === "completed"`、`completedTargetCount === totalTargetCount === planningTargets.length`（Stage 0で固定した集合）
2. selected = 全planning TargetのEntry、Conflict 0、`rejectedBuildListEntries` 0
3. warningは §4.3 の除外warningだけ
4. Plan生成内のTrace Replayが成立する（Plan生成が成功すること。PLANNER_SPEC 7「Trace Replayを省略しない」）
5. 物理操作数の恒等式（GA設計 §9.5、D-1Bで確定）: 物理操作数 = `steps.length` − `confirm_owned_ideal` 数 = Σ stream前進 = structural objective
6. 最終入力から再導出したplanning Target集合がStage 0と同じ（`planning_target_set_changed` はfail closed）

- ［推奨］Researchの「別processのfresh検証」と「独立Trace Replayのevidence記録」はProductionに残さない。理由: (1) 採用時の保存境界がcurrent stateの
  再読込・hash再検証・Plan参照検証を行う（§12）、(2) 最終Planは通常Plan生成（内部でTrace Replayを実行）で作られる、(3) Workerは1 runごとに新しく作る（§8）。
  fresh検証はResearchとCIの回帰（§19）とBrowser受入（§20 PR-8）に残す［Owner］
- ［推奨］恒等式の不一致（`objective_mismatch`）は「成立しない候補」ではなく前提違反としてfail closed（error）にし、採用可能な結果にしない（GA設計 §9.6）

### 7.6 決定性

- ［推奨］同じPlannerInputからは同じReachTable、structural candidate列、materialization順序、Candidateの意味、Entry ID、Planのsemantic（Step列・物理操作数）を返す。
  ProductionのPlan ID / Step ID / 予約OwnedWeapon IDはProduction ID factory（UUID）で決まり、run間で一致しない（PLANNER_SPEC 15.9.1と同じ「semantic determinism」）
- ［実装・未検証］Domainの一部の順序付けは `String.prototype.localeCompare()` を使う（P-0 §4.6）。［P-2］`ja` locale・Chromeでは差が観測されなかったが、
  他locale・他engineは未確認である。［推奨］Production Domain foundation PR（§20 PR-2）で、全体最適化の計算結果に影響する `localeCompare` を監査し、
  Node（複数locale）とBrowser受入（§20 PR-8）で確認する。置換が必要な場合、その関数を通常Candidate Searchも使うなら計算版数の判断を伴う（§18.3）

### 7.7 WorkerからDexieをimportしない構造

［実装］Research Workerのbundleには `materialize.ts` → `plannerGlobalOptimizationResearch.ts` → `importExportValidation.ts` → `productionPlanRepository.ts` →
`AppDatabase.ts`（module評価時に `new AppDatabase()`）の推移的importが入る（P-0 §4.3）。［仕様］Planner WorkerからDexieへ直接アクセスしない（AGENTS.md）。

［推奨］Productionでは入力をmain threadの `createPlannerInput()` で作り（§6）、Workerは `src/domain/**` だけをimportする。射影起点materializationの
origin再構築（Researchの `materializeGlobalResearchCandidate()`）は、Domainの `createConstrainedCandidate(..., 'origin_reach')` と
`createPlannerStartSearchOrigin()` だけで構成するProduction版にする。Worker bundleに `src/db/**` が含まれないことをisolation testと `dist` 検査で固定する。

### 7.8 isolation testの改訂

［実装］既存のisolation testはProduction scope（`src/{app,components,db,domain,services,stores,workers,pages,presentation,data}/**`）に
`globalAssignment|GlobalAssignment|ReachTable|StructuralCandidate|ExpectedRouteShape|...` などのtokenが現れないこと、Production moduleが `/research` を
importしないこと、seam fieldが7 fileに限られること、`SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION` の値と現行versionを固定している
（`src/benchmarks/globalAssignment/isolation.test.ts`、`src/domain/search/research/shapeConstrainedIsolation.test.ts`、`browserIsolation.test.ts`、
`src/benchmarks/plannerGlobalBrowserBenchmarkIsolation.test.ts` ほか）。

［推奨］Production移管PRでは、これらを **意図的に** 改訂する。

- 維持: Production moduleが `src/benchmarks/**` と（Researchに残る）`src/domain/search/research/**` をimportしないこと、Research専用symbol
  （formal gate、事前登録、runner、RESULT導出、`verifyPlannerCandidate`、`runMaterializationSmoke`、oracle関係）がProductionに現れないこと、
  Production Planner Worker protocol（`plannerWorkerContracts.ts` ほか）を変えないこと
- 変更: Productionへ移管した概念名の部分文字列禁止は、import方向の禁止とResearch専用symbolの禁止へ置き換える。Production側の識別子は
  Researchと区別できる名前（例: `buildListOptimization`）にし、`plannerGlobal` / `GlobalResearch` / `plannerGlobalOptimization` 等の既存Research tokenと衝突させない
- seam field・route policy定数の固定値は、Production APIの定義に合わせて同じPRで更新し、Research tokenは別定数として固定し続ける

## 8. Production Worker protocol

### 8.1 Workerの分離

［推奨］既存Planner Workerへrequest kindを追加せず、全体最適化専用のDedicated Worker（例: `buildListOptimization.worker.ts`）を新設する。

| 理由 | 根拠 |
| --- | --- |
| 1 runごとにWorkerを作り、settle後にterminateしてWorker heap（P-2で最大約431 MB）を解放するため。Planner Workerは長寿命で、generationによるcancelを使う | ［P-2］、［実装］`PlannerWorkerClient` |
| 計算中の段階表示（§15.4）が要る。Production Planner Workerはprogress responseを持たない設計である | ［仕様］PLANNER_SPEC 14 / Issue #103 Phase D-2a |
| Production Planner Worker protocol・Client・yieldの不変がisolation testで固定されている | ［実装］`browserIsolation.test.ts`、`plannerGlobalBrowserBenchmarkIsolation.test.ts` |
| cancelを即時terminateで実現できる（Workerは状態を持たず、何も書かない） | §15.2 |

### 8.2 message（提案）

```ts
// main -> Worker
type BloRequest =
  | { type: 'blo_run'; protocolVersion: 'build-list-optimization:1'; requestId: string; input: PlannerInput }
// Worker -> main
type BloResponse =
  | { type: 'blo_progress'; requestId: string; stage: BloStage }          // 段階名だけ。数値・割合・残り時間を持たない
  | { type: 'blo_result'; requestId: string; result: BuildListOptimizationResult }
  | { type: 'blo_error'; requestId: string; stage: BloStage; code: BloErrorCode; message: string }
type BloStage = 'input' | 'reach_table' | 'assignment' | 'materialization' | 'verification'
```

- ［推奨］requestはPlannerInputだけを運ぶ。window・探索上限・Phase D'の `maxPlanSteps` 規則はProduction adapterがWorker内で渡す（§14）。期待hash・token・Research条件のfieldを持たない
- ［仕様］Worker通信データは型とversionを持つ（REQUIREMENTS 35）。structured-clone可能なplain dataだけを運ぶ（RngEngine instanceを運ばない。AGENTS.md）
- ［推奨］1 requestにつき終了message（`blo_result` / `blo_error`）は1件

### 8.3 main threadのrequest lifecycle

［推奨］P-0 §7.8のC1〜C10（Research harnessで実Browser確認済み［P-2］）をProduction向けに単純化して使う。

```text
idle ──run──▶ running ──blo_result（検査に合格）──▶ completed（Preview表示）
                │  ├──blo_result（検査に不合格）／blo_error／error／messageerror──▶ failed
                │  └──cancel操作／route変更／unmount／pagehide──▶ cancelled（同期に遷移し、直ちにterminate）
全経路: settleは1回だけ。settle直後にterminate。settle後・未知requestIdのmessageは適用しない
```

- cancel受付で同期的に `cancelled` へ遷移し、`worker.terminate()` を直ちに呼ぶ（grace無し。§15.2）。その後に届くmessageは適用しない
- 新しいrunは新しいWorker・新しいrequestIdで始め、前のPreview・結果・progressを持ち越さない
- `blo_result` は採用前にmain threadで構造検査する（P-1の `gabWorkerResultIssues()` と同じ考え方）。不合格はfail closed
- Worker `error` / `messageerror` は `failed`（worker_error）とし、out of memoryと推測しない（P-0 §7.11）

## 9. 結果型・失敗分類

### 9.1 結果型（提案）

```ts
type BuildListOptimizationResult =
  | { status: 'optimized'; artifact: BuildListOptimizationArtifact; diagnostics: BuildListOptimizationDiagnostics }
  /** 探索を上限内で終え、成立する候補が無かった（「この範囲では見つからない」。存在しないとは言わない） */
  | { status: 'not_found'; reason: 'no_structural_candidate' | 'candidates_rejected'; diagnostics: BuildListOptimizationDiagnostics }
  /** 上限・未確認で止まった（候補が無いとは結論しない） */
  | { status: 'search_bound_reached'; bounds: BuildListOptimizationBound[]; diagnostics: BuildListOptimizationDiagnostics }
  | { status: 'unsupported'; reasons: BuildListOptimizationUnsupportedReason[] }   // §5.4
// cancelled / worker_error / protocol_error / worker_reported_error はmain thread側の状態（Worker resultではない）
```

### 9.2 最適化結果（artifact、runtime-only）

```ts
interface BuildListOptimizationArtifact {
  /** 最終Planner result。plan !== null、status 'draft'、conflictRepairLineage === null、termination 'completed' */
  plannerResult: PlannerResult
  /** 置換するTargetの新Entryだけ（同一意味の既存Entryを再利用したTargetは含めない） */
  generatedBuildListEntries: BuildListEntry[]
  /** generatedBuildListEntriesと同じ順序。既存の BuildListEntryReplacement（targetWeaponId / replacedBuildListEntryId / generatedBuildListEntryId） */
  replacements: BuildListEntryReplacement[]
  unchangedTargetWeaponIds: TargetWeaponId[]
  planningTargetWeaponIds: TargetWeaponId[]
  /** §6の入力token（Worker側の4項目） */
  inputToken: BuildListOptimizationInputToken
  summary: {
    physicalOperationCount: number      // steps.length − confirm_owned_ideal数
    planStepCount: number               // steps.length
    nonPhysicalStepCount: number
    structuralObjective: number         // 物理操作数と一致（§7.5の5）
    completedTargetCount: number
    totalTargetCount: number
    maxPlanSteps: number                // §14.1で導出した値（診断・表示用）
  }
}
```

- ［推奨］artifactは永続化しない。Dexie・Export・AppSettings・URLへ入れない（再計画Previewと同じ。PLANNER_SPEC 16.8）
- ［推奨］diagnostics（stage別時間、node数、予測回数、候補outcome）はDebug Modeの表示だけに使い、判定に使わない

### 9.3 Research statusとの対応

| Research（GA設計 §4.6） | Production（提案） | 補足 |
| --- | --- | --- |
| `verified` | `optimized` | Production成立条件（§7.5）で判定 |
| `structural_only`、completeness `exhausted`、不成立がすべて `materialization_failed` / `planner_rejected` | `not_found(candidates_rejected)` | |
| `no_structural_candidate`（各reason） | `not_found(no_structural_candidate)` | 「この探索範囲では…」と表示 |
| `structural_only` で `materialization_unconfirmed` を含む、または `verification_budget_reached` | `search_bound_reached` | 未確認・上限。候補不在と読み替えない（GA設計 §9.6 / G6） |
| `search_incomplete(node_budget_reached)` | `search_bound_reached` | |
| `search_incomplete(cancelled)` | main threadの `cancelled` | Worker resultは捨てる |
| `unsupported_input` | `unsupported` | §5.4 |
| `unmeasured`（timeout / OOM / process failure） | main threadの `failed` | Productionはwall-clock timeoutを置かない（§15.1） |
| `objective_mismatch`、契約違反（`GlobalAssignmentMaterializationError` 相当） | `blo_error`（fail closed） | 採用可能にしない |

## 10. Preview仕様

### 10.1 原則

- ［推奨］計算完了だけで保存・採用しない。Previewは永続状態を一切変更しない（作成リスト、Draft、実行中Plan、所持武器、RNG状態）
- ［推奨］Previewを閉じる・画面を離れる・新しい計算を始める・同じ画面で作成リストを変更すると、Previewを破棄する。元の作成リストと保存済みPlanはそのまま
- ［推奨］Previewは「全体最適化の試算（未採用）」と明示し、「まだ作成リストと生産計画は変更されていません」と示す（再計画Previewの文言規則に揃える。UI_FLOW 16.4）

### 10.2 表示項目

| 項目 | authority | 規則 |
| --- | --- | --- |
| 完成予定の目標武器数 | 最終Planの `steps[].executionEffects.targetCompletions` のdistinct Target数 | ［仕様］UI_FLOW 11.0と同じ。分母は `termination.totalTargetCount`（計画対象Target数） |
| 物理操作数（ゲーム内操作の回数） | `summary.physicalOperationCount` | 計画ステップ数と別の行で示し、混同しない |
| 計画ステップ数（確認ステップを含む） | `summary.planStepCount` | `confirm_owned_ideal` を含むことを注記 |
| 置換される作成リスト項目数 | `replacements.length` | 「変更なし」の目標武器数（`unchangedTargetWeaponIds.length`）も示す。0件なら「作成リストの候補は変わりません（計画だけを作成します）」 |
| 起点武器の変化 | 置換前Entryと新EntryのRoute base（`BuildRoute.sourceOwnedWeaponId` の所持武器名、または「新規の通常アーティア（武器種）」） | 名称で示し、IDを通常UIに出さない。優先起点（`preferredOwnedWeaponId`）と異なる起点になるTargetを示す（§21 O17） |
| 改善優先が既定へ戻る目標武器 | 置換されるTargetのうち旧Entryの改善優先が `planner` 以外のもの | §5.2案1を採る場合だけ |
| 競合・未成立Target | 最終Planの `conflicts` と未完成Target | 成立条件により0件。「競合なし」「すべての目標武器が完成予定」を文字で示す |
| 対象外の目標武器 | 有効・未完了TargetのうちEntryが無い／除外されたもの | §4.2。件数と理由を示す |
| 変更されるRouteの概要 | 新EntryのRoute（操作の種類と回数、作成・巨戟化・Reset / Keep / スキル再付与の区間） | Planner Alternativeのpresentation-neutralなRoute要約（［実装］`PlannerAlternativeRouteSummary`）と同じ考え方で、Counter数値を出さない。折りたたみ |
| 計画全体の内容 | 最終Plan | 既存の `ProductionPlanContent`（UI_FLOW 11.0）を読み取り専用で表示。長いPlan対応（折りたたみ・unmount）を流用 |
| 必要素材・費用の目安 | 最終Planの物理Step列 | ［仕様］REQUIREMENTS 22.1 / UI_FLOW 11.0と同じ導出 |

### 10.3 現在の計画との比較

［推奨］比較対象は、**現在のDraftが全体最適化の入力と同じ状態から作られている場合だけ** とする。

- 条件: 現在Draftが存在し、CalculationContextが互換で、その `baseSnapshot` の `initialExecutionState`・`targetWeaponsHash`・`buildListEntriesHash` が
  全体最適化の入力token（§6、`inputBuildListEntriesHash`）と一致する
- 条件を満たす場合: 「現在の下書き」と「全体最適化」の2列で、完成予定の目標武器数、物理操作数、計画ステップ数、競合件数（記録件数）を並べる
- 満たさない場合: 比較値を推測で作らず、「比較できる現在の生産計画がありません（下書きが無いか、作成後に作成リストまたは状態が変わっています）」と示し、
  全体最適化側の値だけを表示する
- 全体最適化と同じrunで通常Plannerを比較用に追加実行する案（baseline run）は、時間・memoryの追加費用が未計測なので初期版では行わない［Owner］

### 10.4 表示しないもの

- 推定完了率、残り時間、最短性（「最短」「最適解」とは表示しない。`best_found` であり、探索範囲内の結果である）
- Seed / Counter数値（通常UI）。Debug Modeでだけdiagnosticsを表示する［仕様］REQUIREMENTS 33

## 11. Entry置換・identity

### 11.1 置換の単位

［仕様］永続Build Listは1 Targetにつき最大1 Entryであり、置換は1つの操作として旧Entry削除と新Entry追加を同一transactionで行う（DATA_MODEL 9.4.1）。

| 案 | 内容 | 評価 |
| --- | --- | --- |
| 一括採用 | 成立した最適化結果を、置換対象の全Targetで一度に採用する | 検証済みのEntry集合そのものを保存できる |
| Targetごとの部分採用 | ユーザーが一部Targetだけを選んで置換する | 全体最適化のRoute集合は、held位置を跨ぐ非連続Route・他Targetのchainに依存する被覆（GA設計 §8、§9.1）で成り立つ。一部だけを置換すると、残した旧Routeとの組み合わせはPhase D'で検証していない別の集合になり、stall・競合・未完成が起こり得る。単純なEntry置換では実現できず、部分集合ごとに再検証する別操作になる |

［推奨］初期Productionは **一括採用だけ** とする。部分採用は提供しない（必要なら「部分集合を固定して再最適化する」別機能として、§5.1案Bと同じ後続Issueで設計する）。

### 11.2 identity（Production規約の提案）

| 対象 | Production規約（提案） | 根拠・注意 |
| --- | --- | --- |
| 生成Entry ID | 既存のdeterministic materializer規則のまま（`build-list.constrained.<hash>`。Candidateの意味・targetDefinitionHash・searchStateHash・referencedOwnedWeaponsHash・CalculationContextから導出し、探索kernelに依存しない） | ［実装］`plannerDeterministicMaterializer.ts` の `deterministicEntryId()`。prefixはID値の一部であり、変えると全generated Entry IDが変わる（同ファイルの注記）。Planner Alternativeと同じEntry ID空間を共有する |
| 同一意味の既存Entry | 現在のsemanticがすべて一致する既存Entryは再利用し（`reusedExisting`）、そのTargetは「変更なし」にする。同ID・異内容はfail closed（`generated_entry_id_collision`） | ［実装］`materializeBuildListEntry()` の既存規則 |
| Candidate ID | Production専用prefix（例: 射影起点 `candidate.build-list-optimization.`、形状制約 `candidate.build-list-optimization.shape.`）+ search identityとCandidate meaningのhash | Research prefix `candidate.research.global-assignment.` を永続化しない（GA設計 §16） |
| searchRunId（search identity） | Production専用の決定的identity（例: `build-list-optimization-search.<hash>`）。正規化Planner-start origin、Target ID、CalculationContext、window・探索上限（Production定数）、方式と（形状制約なら）正規化した正式reservationと形状、Production algorithm token / route policy tokenから作る | random UUID・Clock・request ID・enumeration ordinalを含めない（PLANNER_SPEC 9.2.13） |
| algorithm token / route policy | 例: `build-list-optimization-materialization:v1`、`shape-constrained-route-policy:v1`（Production API） | Research token（`global-assignment-*`、`research-shape-constrained-route-policy:v1`）はResearch adapterに残す |
| Plan ID / Step ID / 予約OwnedWeapon ID | 通常PlannerのProduction ID factory（UUID）と現在UTC時刻 | Researchの `globalResearchDependencies()`（`research.global.plan.*`、固定Clock）を使わない |
| `createdAt` | Production clock | 表示用。ID・semantic orderingに使わない（DATA_MODEL 9.4） |
| 生成Entryの途中採用状態・改善優先 | materializerの既定値（両lane未選択、`planner`） | ［仕様］9.2.18と同じ。旧Entryから引き継がない（§5.2） |
| provenance | 生成主体を表す永続fieldを追加しない | ［仕様］DATA_MODEL 9.4.1。追加する場合はschema変更（§18、§21 O13） |

## 12. 明示採用・永続化

### 12.1 保存API（提案）

［推奨］既存の `PlannerResultPersistenceService`（［実装］`savePlannerResult()` / `inspectPlannerAlternativeRepairSave()` / `savePlannerAlternativeRepair()`）に、
全体最適化専用の保存APIを追加する。artifactを既存のrepair artifactやordinary resultへ変換しない（Phase 5-B / 6-Aの方針と同じ）。

```ts
inspectBuildListOptimizationSave(artifact, currentContext, observed: { draftPlanId: ProductionPlanId | null })
saveBuildListOptimization(artifact, currentContext, observed, approval?)  // → { outcome: 'saved'; plan }
```

### 12.2 保存transaction

［推奨］次を1つのDexie read-write transaction（既存 `PlanBreakingChangeGuard` を通る1つのguarded mutation）で行う。

```text
再読込・再検証
  実行中Plan（active / stale）が無い                                  （違えば planner_state_changed）
  現在Draftがちょうど0件または1件で、そのIDが observed.draftPlanId と一致   （違えば planner_state_changed、2件以上は draft_plan_conflict）
  current stateが入力tokenと一致:
    initialExecutionState、targetWeaponsHash、inputBuildListEntriesHash、CalculationContext   （違えば planner_state_changed）
  各replacementの O が今もそのTargetのちょうど1件のEntry            （prepareFinalReplacementBuildList()、違えば planner_state_changed）
  generated IDが未永続（衝突は fail closed）、置換後のcardinality（validateBuildListCardinality()）
  Planが置換後Build Listだけを参照（checkProductionPlanBuildListEntryReferences()）
  Planの baseSnapshot（initialExecutionState、targetWeaponsHash、置換後Build Listの buildListEntriesHash）が現在値・置換後集合と一致（9.2.15の確認項目）
  artifact検査: plan !== null、status draft、lineage null、termination completed、Conflict 0、rejected 0、
               warningは§4.3の除外warningだけ、物理操作数の恒等式、generated Entryのentity validation、replacementの対応
書込み
  各replacement: O削除 + G追加 → 旧Draft削除 → 新Draft追加
```

- ［推奨］入力tokenは **作成リスト全体** のhashで照合する（Planner Alternative repairの「Oだけ」より厳しい）。全体最適化は全planning Targetを同時に割り当てるので、
  別Targetの追加・Entry変更・優先度変更でもplanning Target集合や割当の前提が変わるためである。所持武器のstatus・名称・memoだけの変更はsemantic hashに入らず、
  採用を妨げない（［仕様］DATA_MODEL 9.4）
- ［推奨］既存の保存境界（transaction内のcurrent state再読込、CalculationContext、Draftのatomic replacement、partial save禁止、cascade deleteしない）は
  ［仕様］PLANNER_SPEC 9.2.15 / DATA_MODEL 14.5をそのまま共有する。Planner再実行はしない
- ［推奨］拒否は既存のtyped code（`planner_state_changed`、`planner_result_invalid`、`draft_plan_conflict`、`transaction_failed`）を再利用し、
  UIは「試算後に作成リストまたは状態が変わりました。もう一度全体最適化を試してください。」等を示す。自動再実行しない
- ［推奨］失敗時はtransaction rollbackにより何も残さない（旧Draft・旧Entryは維持）
- ［推奨］成功時はPersistenceが返したPlanの `id` で `/plans/:planId` へ遷移する（UI_FLOW 10.2と同じauthority）
- ［推奨］保存したDraftの開始は既存の「作成開始」（`prepareProductionPlanStart()`）で行い、全体最適化専用の開始処理を持たない

### 12.3 保存しないもの

artifact全体、diagnostics、探索上限、入力token、Previewの比較値、全体最適化で作られたことを示すprovenance（§11.2）。

## 13. Active Plan / Plan-breaking

［仕様］実行中Plan（active / stale）は最大1件。実行中Planがある間、作成リスト画面のPlanner操作は再計画の試算だけであり、通常の下書き作成ボタンを追加しない（UI_FLOW 10.3）。
Planを壊す変更は事前警告と承認を要する（PLANNER_SPEC 16.6）。

| 案 | 内容 | 評価 |
| --- | --- | --- |
| A: 実行中Planが無いときだけ提供 | 実行中Plan（active / stale）があれば「全体最適化を試す」を無効化し、理由と導線（再計画の試算、生産計画の破棄・完了）を示す。採用時も再確認する | UI_FLOW 10.3と整合。Plan-breaking承認・セーブ地点選択が発生しない |
| B: Draftとして保存し、壊す場合はPlan-breaking承認 | 実行中Planがあっても計算・Draft保存を許し、置換が実行中PlanのPlan依存Entryに触れる場合は既存guardで承認を求める | 既存のrepair保存と同じ経路だが、「実行中Plan中に通常の下書き作成ボタンを追加しない」と衝突する |
| C: 再計画としての全体最適化 | 現在地点から全体最適化を試算し、採用で旧Planを `replan_adopted`、新Planを `active` にする | 16.8の再計画採用にEntry置換（Phase 6-Aで除去した）を戻すことになり、正式仕様の変更が大きい |

［推奨］初期ProductionはA。保存は §12 のとおり既存guardを通すが、実行中Planが無いことを前提条件にするので承認は発生しない
（承認を渡した場合は既存の `plan_breaking_change_approval_not_required`）。B・Cは後続の判断とする［Owner］。

- ［推奨］stale Planも実行中Planとして扱う（invariantどおり）。staleの解消（再計画・破棄）後に全体最適化を使う
- ［推奨］既存Draftは採用時に通常どおり置き換える。Previewと採用確認で「現在の未開始の生産計画は置き換えられます」と示す（UI_FLOW 10.3と同じ文言規則）

## 14. step bound / search bound

### 14.1 Phase D'の最大計画ステップ数

［実装］決定的schedulerは、Route action（物理Step）に加えて、Entry完成時の確保action（`reserve_candidate`）と開始時の `confirm_owned_ideal` を
`maxPlanSteps` の対象として数える（`canApplyAction()` は `state.trace.length >= maxPlanSteps` で止める。操作0 Entryの確認は確保actionそのものであり、
Targetごとに1 actionである。［実装］`applyPlannerZeroOperationConfirms()`）。［D-1C］1,766 + 43 = 1,809 = expandedStates。

成立条件（§7.5の5）は物理操作数 = structural objective を要求し、各planning Targetの確保（確保action または `confirm_owned_ideal`）は高々1回なので、
成立するPlanが使うscheduler action数は

```text
requiredActions = structuralObjective + planningTargetCount
```

以下である（D-1Cのように全Targetを各自のEntryで確保する場合は一致する）。

［推奨］Phase D'の `maxPlanSteps` は候補ごとに次で導出する。

```text
optimizationMaxPlanSteps = roundUpPlannerMaxPlanSteps(requiredActions) + 500
```

- 500刻みの切り上げは既存の `roundUpPlannerMaxPlanSteps()`、`+ 500` は競合解決再計算の余裕（`CONFLICT_RESOLUTION_MAX_PLAN_STEPS_MARGIN`）と同じ考え方
  （［実装］`src/services/planner/plannerRuntimeOptions.ts`）。余裕は成立判定のためではなく、恒等式が破れた場合に `incomplete` ではなく
  `objective_mismatch`（前提違反）として診断できるようにするためである。D-1Cの候補では 2,000 + 500 = 2,500
- 有限性: structural objectiveはwindowで上から抑えられる（Skill終端 ≤ origin + W.skill + 1、Gogma ≤ origin + W.gogma、Normalは使うCounterごとに ≤ W.normal）。
  W0なら objective ≤ 1,501 + 500 + 350 × 14 = 6,901 であり、上限値をユーザーに委ねなくても計算量は有界である（設計上の上界。実測ではない）
- Research maxPlanSteps 20,000はResearch条件（GA設計 G12）であり、Production defaultにしない
- ユーザー編集の対象にしない。Build List画面の「最大計画ステップ数」（通常Planner用、REQUIREMENTS 19 / Issue #130）とは別の、全体最適化Domainの導出規則として
  仕様化する。永続化しない（PLANNER_SPEC 7.2.1の「Worker / Domainは既定値を補わない」との関係は §22.2）
- 未完了時: 成立条件を満たさない候補は `planner_rejected` として次候補へ進み、最終的に `not_found` / `search_bound_reached` になる。`maxPlanSteps` を自動で増やして再実行しない

**採用後の通常Plannerとの相互作用**［Owner O14］: 作成リスト画面の推奨値（`recommendedBuildListMaxPlanSteps()`）は「最大の単体Candidate操作数 + 1」に基づく
（Issue #130）。採用後の作成リストで通常の「生産計画を作成」をやり直すと、推奨値が `requiredActions` より小さく `incomplete` になり得る。
［推奨］初期版はIssue #130の規則を変えず、採用時にDraftを保存済みであることと、作り直す場合は最大計画ステップ数を増やす必要があり得ることを案内する。

### 14.2 探索範囲・探索上限

| 上限 | Research登録値（D-0C / D-1C、候補値） | Production（推奨） |
| --- | --- | --- |
| 到達表window | W0 = Normal 350 / Gogma 500 / Skill 1500 | Production専用定数として持ち、`recommendedCandidateSearchDefaults` やユーザー保存値（`AppSettings.candidateSearchDefaults`）をauthorityにしない（候補検索の既定値変更で全体最適化が黙って変わらないため。PLANNER_SPEC 9.2.19.12と同じ考え方）［Owner O10］ |
| node budget / MRV lookahead | 2,000 / 8 | Production定数。値は計測PR（§20 PR-5）で決める |
| structural candidate数 / verification budget | 1 / 1 | 同上。2以上は成立機会を増やすが、1候補あたりPhase D + D'（PCで約5 s）を追加する。P-2は1だけを測った |
| 射影起点Search規模gate | conversion位置32、Gogma幅500、Skill幅1,501、Normal forge 350 | 同上 |
| 形状制約Search規模gate / 実行budget | gate: 各W0最大値（拒否しない値）、budget: Gogma生成state 50,000,000、Skill state 2,250,000、settled work 100,000、予測回数 350 / 1,501 / 500 / 500 | 同上。budgetの50 MはNodeのheap 4 GB下で完了を観測した範囲に基づく値であり（D-0B-2で登録した根拠、［実装］`MATERIALIZATION_D0C_PREREGISTRATION`）、Browser・スマートフォンでは未検証 |
| Phase D'の `maxPlanSteps` | 20,000 | §14.1の導出 |

- ［推奨］Research値をそのままProduction defaultにしない。Planner Alternative（Phase 3-A / 3-B / 3-C）と同じく、Production計算（Production token・Production adapter）の
  Browser Worker計測を経て、根拠付きのProduction定数を別PR（§20 PR-5）で確定する。値の根拠にResearchの観測を使う場合は、その観測範囲と未確認範囲を記録する
- ［推奨］Domain APIは上限をcaller必須で受け取り、fallback・補完・clampをしない（PLANNER_SPEC 9.2.19.12と同じ）。Production adapterがWorker内で定数を渡す
- ［推奨］初期版ではユーザーに探索上限を公開しない。REQUIREMENTS 19の「ユーザーが変更できるPlannerの設定は最大計画ステップ数だけ」を通常Plannerについて維持する
  （全体最適化にユーザー設定を足す場合は正式仕様の変更になる）［Owner O9］
- ［推奨］探索上限はdevice非依存の決定的なwork boundとし、wall-clock・heapを意味論的判定に使わない（GA設計 G6 / G7）

## 15. 性能・キャンセル

### 15.1 Worker実行上限

［推奨］自動のwall-clock timeoutによる強制終了は置かない。理由: (1) 通常Plannerも「推測による固定最大値は設けない。長時間化はWorker実行と既存Cancelで扱う」
（［仕様］PLANNER_SPEC 7.2.1）、(2) 端末性能で結果が「失敗」に変わる非決定性を持ち込まない、(3) 計算量は §14.2 の決定的上限で有界である。
長時間化した場合に「時間がかかっています。キャンセルして後で試すこともできます」を示す閾値は、端末計測（§20 PR-5 / PR-8）の後にOwnerが決める［Owner O11］。
P-2のPC実測値から機械的に決めない。

### 15.2 cancel

- ［P-2］Workerは同期区間（Phase B / C 約3.1 s、Phase D' Planner 約2.4 s）の間cancel messageをdispatchできない。Phase D'中のcancelはackされず、
  main threadが後から届いた結果を捨てた
- ［推奨］Productionのcancelは **main threadで同期的に `cancelled` へ遷移し、直ちに `worker.terminate()`** する（cancel grace・cooperative cancelを使わない）。
  全体最適化Workerは状態を持たず何も書かないので、terminateは常に安全であり、CPUとWorker heapをすぐ解放できる
- ［推奨］cancel後・settle後に届いたmessageは適用しない（P-0 C2 / C7と同じ）。cancelしたrequestから採用された結果は0件でなければならない（test）

### 15.3 古いrequestの結果不採用・再実行

- ［推奨］requestIdとrunごとの新しいWorkerで分離する。前runのWorkerはterminate済みで、そのmessageは新runへ適用されない（P-0 C9）
- ［推奨］再実行は新しいWorkerで最初から計算する。前runの結果・ReachTable・候補をrun間で再利用しない（キャッシュを永続化しない）

### 15.4 段階表示

［仕様］計画の計算中は正確に求められない完了率を推定して表示しない（REQUIREMENTS 19、UI_FLOW 3 / 10.0）。

［推奨］`blo_progress` の段階名（入力確認 / 到達条件の計算 / 割当の探索 / ルートの生成 / 計画の検証）だけを表示する。件数（「12 / 43目標武器」）は事実だが、
段ごとの所要時間が大きく異なり（P-2でルート生成は約1.2 s、到達表は約9.1 s）割合として読まれやすいので表示しない。経過時間の表示は推定ではないので許容するが、
残り時間は表示しない［推奨］。同期区間では段階表示が数秒更新されないことがある（main threadは止まらない）。

### 15.5 OOM / page loss

- ［推奨］Workerの `error` / `messageerror` は「計算を完了できませんでした」とし、メモリ不足と断定しない。renderer crash・tab破棄はページ自身が観測できない
- ［推奨］run中であることの印をstorageへ保存しない（再読込後の「前回中断」通知は行わない）。行う場合は正式仕様の追加が要る［Owner O18］

### 15.6 Worker起動・停止時のメモリ解放

- ［推奨］settle直後（結果受信・cancel・error）にWorkerをterminateする。結果はstructured cloneでmain threadへ渡り、Previewとしてmemoryに保持される
- ［推奨］Previewを閉じたらartifactを参照から外す。Previewの大きさ（Plan 1,766 Step + 43 Entry規模）のmain thread memoryと結果cloneの時間は未計測であり、PR-5で測る

### 15.7 first / fresh二重実行

［推奨］Productionでは行わない（§7.5）。Research harnessのfirst / freshはparity検証用であり、Production runの成立条件ではない。CIの回帰と実Browser受入では
「同じ入力を2回計算してsemanticが一致する」ことを確認する（§19）。

### 15.8 Browser間の決定性

［推奨］run内の決定性はDomainで保証する。Browser間・locale間の一致は §7.6 の監査と §20 PR-8 の受入（Chrome / Edge / Firefox / Safariのうち、Ownerが決めた環境）で確認し、
一致しない環境が見つかった場合は原因を切り分けてから公開を判断する。

### 15.9 必要な性能・メモリ検証

［推奨］P-2と同じ「計測前に測定計画をcommitし、結果を見て変えない」方式で、Production計算（Production adapter・Production token・Production build）について次を測る（§20 PR-5 / PR-8）。

- PC Chrome、Android Chrome、iPhone Safari（§16）: 各段の時間、最大同期slice、Worker heap（取れる範囲）、結果clone時間、Preview表示時のmain thread long task、cancelの応答、再実行
- 合格基準（許容時間・memory）は計測の **前に** Ownerが決める。P-2の値から機械的に決めない

## 16. PC / スマートフォン

［仕様］PCブラウザとスマートフォンブラウザの双方を主要利用環境とし、全主要機能を双方で実用レベルで利用可能にする。端末によって機能を減らさない（REQUIREMENTS 3.2、UI_FLOW 3.1）。
［P-2］スマートフォンは未測定である。

- ［推奨］全体最適化をPC限定の機能にしない（正式仕様と衝突する）。端末（user agent）による提供可否の分岐を置かない
- ［推奨］未測定の端末での性能・成否を保証する表示をしない。「端末によっては時間がかかります」「計算中は画面を表示したままにしてください」を示す
  （iOS等でbackgroundへ移ったtabのJS実行が止まり得ることは一般的な挙動であり、本Repositoryで観測した事実ではない。P-0 §11.4）
- ［推奨］**Production公開（UIの入口を出すPRのmerge）前に、実機での受入を必須とする**。GitHub Pagesはmainのmergeで公開されるので、受入はmerge前に行う（§20）

実機検証の手段:

| 環境 | 手段 | 備考 |
| --- | --- | --- |
| Android Chrome | `adb reverse` で端末の `http://localhost` からPCのpreviewへ接続（secure context）、CDPは `adb forward` | P-0 §11.2。端末の用意はOwner |
| iPhone Safari | (a) 端末が信頼するローカル証明書でHTTPS配信（Ownerの操作）、(b) Production buildをGitHub Pagesへ公開した後に端末でImportして確認（UI入口の公開前に確認するには、事前公開の仕組み（例: Debug Modeだけの入口）が要り、正式仕様の判断を伴う） | 外部hosting・tunnelへbuildやExportを公開しない（P-0 §11.2） |
| 代替（参考） | Chrome DevToolsのCPU throttling / device emulation | 実機の代替にしない（sanity checkだけ） |

性能不足の場合の対応候補（いずれも［Owner O12］）:

1. 探索上限・windowを下げる（成立機会と操作数のtrade-off。Production定数の再決定）
2. 同期区間の分割・memory削減（Production codeの最適化。Phase Eとは別のProduction PR）
3. 端末差の扱いを正式仕様で定める（REQUIREMENTS 3.2の変更が必要。Owner判断なしに行わない）
4. 公開を見送る

## 17. UI / UX

UI / UXの具体設計は `ui-ux-pro-max` の指針（Accessibility / Touch & Interaction / Layout & Responsive / Feedbackの優先項目）と、既存のMUI theme
（［実装］`src/app/theme.ts`）、共通component（`ProductionPlanContent`、`PlanBreakingChangeDialog`、`ExecutionSavePointRestoreDialog`、再計画Previewの
`ProductionPlanReplanPreviewPanel` の構成）、UI_FLOW 3 / 3.1の方針に従う［推奨］。実際のUI componentは本PRでは実装しない。

### 17.1 入口（作成リスト画面）

```text
作成リスト  ─ Planner操作（実行中の生産計画が無い場合）
  [生産計画を作成]（主操作・contained）
  [全体最適化を試す]（副操作・outlined）
  全体最適化は、作成リストの全目標武器のルートを組み直して操作数が少なくなる組み合わせを探します。
  結果は確認してから採用でき、採用するまで作成リストと生産計画は変更されません。最短であることは保証しません。
```

- 1画面1主操作（`primary-action`）を守り、既存の「生産計画を作成」を主操作のままにする
- PCでは横並び、375px幅では縦に全幅で並べ、各ボタンは高さ44px以上・間隔8px以上（`touch-target-size` / `touch-spacing`）
- 使えない場合はボタンを無効化し、理由をボタン近くの本文（`aria-describedby`）で示す。tooltipだけにしない（実行中Plan、valid Entry 0件、途中採用状態の選択、
  legacy duplicateなど、開始前に分かる理由）。Workerの `unsupported` 結果は計算後に同じ形式で示す
- 開始前の判定は、WorkerのStage 0と同じ判定を行うDomainの共有pure helper（提案）だけで行い、UIが独自の規則で判定しない
  （Plan-breaking判定をUIで行わない既存方針と同じ。UI_FLOW 16.3）。実行中Planの有無だけはApplication（`getRunningProductionPlan()`）が判定する
- Debug ModeのON / OFFで入口の有無を変えない（REQUIREMENTS 33）

### 17.2 計算中

- `role="status"` の領域に見出し「全体最適化を計算しています…」、indeterminateな進捗バー、現在の段階名（文字）、経過時間（任意）、「キャンセル」（44px以上）を表示する
- 段階の変化は1つのstatus領域で文として通知し、focusを移さない（`contextual-live-badge-updates`）。進捗バーは `prefers-reduced-motion` で動きを抑える
- 計算中と結果表示中は、同じ画面のPlanner操作（生産計画を作成・全体最適化）と作成リストの変更操作（途中採用状態・改善優先の変更、削除）を一時無効化する
  （Plan-breaking警告待ちの間に別のguarded変更を積まない既存規則と同じ考え方。UI_FLOW 16.3）。他画面での変更は採用時の再検証が検出する
- スマートフォンでは「計算中は画面を表示したままにしてください」を添える

### 17.3 Preview

- 計算完了時、focusをPreviewの見出し「全体最適化の試算（未採用）」へ移す（`focus-management`）。失敗時はエラー見出しへ移す
- 構成（上から）: 未採用である旨 → 比較サマリー → 変更の内訳（置換される候補、起点武器の変化、改善優先の変更、対象外の目標武器）→ 計画全体の内容（折りたたみ）→ 操作
- 比較サマリーはPCでは「現在の下書き / 全体最適化」の2列表、375px幅ではラベルと値の縦積みcard（横スクロールの表にしない。UI_FLOW 3.1、`horizontal-scroll`）。
  数値は桁揃え（`number-tabular`）
- 状態は色だけで示さず文字を併記する（「競合なし」「変更なし」「置換」など。`color-not-only`）
- 長い目標武器名・武器名は折り返し、横overflowを作らない（`long-token-wrapping`）
- 内訳と計画全体はAccordionで折りたたみ、閉じている間はunmountしてよい（UI_FLOW 11.0「長いPlanへの対応」）

### 17.4 操作と採用確認

```text
[戻る]（試算を破棄。何も保存しない）   [この計画を採用]（主操作）
```

採用確認Dialog（提案文言）:

```text
全体最適化の結果を採用しますか？
・作成リストの候補 N件を置き換えます（M件は変更なし）
・置き換える候補の途中採用状態と改善優先は引き継がれません（改善優先が「生産計画に任せる」に戻る目標武器: K件）
・現在の未開始の生産計画は置き換えられます
・置き換えた候補は自動では元に戻せません
[キャンセル]  [置き換えて採用]
```

- Dialogはキーボード操作・Escでキャンセルでき、主要操作が375px幅でも見失われない（UI_FLOW 3.1、`escape-routes`）
- 採用成功時は「全体最適化の結果を採用し、生産計画の下書きを保存しました。」とともに `/plans/:planId` へ遷移する
- 採用拒否（§12.2）はDialog内または作成リスト画面に理由と再試行の導線を示し、Previewを破棄して再計算を求める（自動再実行しない）

### 17.5 結果別の表示（提案文言）

| 結果 | 表示 |
| --- | --- |
| `not_found` | 「現在の探索範囲では、すべての目標武器が完成する組み合わせを見つけられませんでした。」（存在しないとは表示しない。REQUIREMENTS 15と同じ考え方） |
| `search_bound_reached` | 「探索の上限に達したため、全体最適化の結果を確定できませんでした。」 |
| `unsupported` | 理由ごとの案内と該当画面への導線（§5.4） |
| `cancelled` | 「全体最適化をキャンセルしました。」（notice。エラーにしない） |
| `failed` | 「全体最適化の計算を完了できませんでした。もう一度試してください。」（retry） |

いずれの場合も作成リストと保存済み生産計画は変更されていないことを示す。

## 18. versioning / compatibility

### 18.1 判定

| 対象 | 推奨判断 | 理由 |
| --- | --- | --- |
| `CURRENT_CALCULATION_APP_SCHEMA_VERSION`（17） | **変更不要**（下記の前提が守られる限り） | 同じPlannerInputに対する通常Planner・Candidate Search・Planner Alternativeの出力を変えない。全体最適化は新しい操作の追加であり、既存artifactの読み方を変えない。採用したDraftは採用後の作成リストに対する通常Planner Planと同じ意味を持つ。既存Route capabilityを追加しても既存artifactの解釈を変えなかったforced Reset Normal Artian routeの先例（AGENTS.md）と同じ扱い |
| `DATABASE_SCHEMA_VERSION`（10） | 変更不要 | table / index / 永続shapeを変えない（provenance fieldを足さない場合） |
| `ExportRoot.schemaVersion`（13） | 変更不要 | 生成Entry・Draftは既存shapeのまま。Export / Importの検証も変えない |
| CalculationContext | 変更なし | 生成Candidate / Entry / Planは現在のCalculationContextを持つ |
| BuildCandidate | shape不変 | 生成Candidateは既存shape。ただし通常のCandidate Searchが返さない形（lane開始Ideal継続。held位置を跨ぐRouteはPlanner Alternativeがversion 16から生成済み）を含む（§18.2） |
| BuildListEntry | shape不変 | 既存shape。staleness・cardinality規則も不変 |
| ProductionPlan | shape不変 | lineage `null` の通常Draft |
| 保存済みDraft | 影響なし | 採用時に通常どおり置換される。採用しなければ変わらない |
| Active Plan | 影響なし | 実行中Planがある間は提供しない（§13） |
| Export / Import | 影響なし | 採用後のEntry・Draftは通常データとして往復する |
| 既存Planの互換性 | 影響なし | 4 field完全一致の判定を変えない |
| `PRODUCTION_RNG_ENGINE_VERSION`、Master `dataVersion`、`AppSettings.schemaVersion`、`RngState.schemaVersion` | 変更なし | RNG・Master・設定を変えない |

### 18.2 前提と、確認が必要な点

「変更不要」は次が成り立つ場合に限る［推奨］。各実装PRでversion判断を記録する。

1. 形状制約付きRoute探索のProduction API化が、無指定時のSearch出力・search identityを変えない（golden test）
2. 通常Planner・Planner Alternativeの計算・保存の意味を変えない（§4.3の成立規則は全体最適化の判定だけに使う）
3. 永続shapeを増やさない
4. **lane開始Ideal継続を持つ生成Candidateの、既存consumerでの意味が変わらないこと**: ［実装］中間状態抽出（`extractIntermediateStateGroups()`）はlane位置0〜終端手前で
   Ideal / Practical条件を満たす状態を候補にするので、継続Routeでは `match = ideal` の中間状態が現れ得る。通常Searchのcanonical Idealでこれが現れるかは
   本書では監査していない。現れないなら、作成リストでその状態を途中採用として選ぶと「理想条件を満たす状態で妥協品として終了できる」という、通常の候補には
   無い組み合わせが生じる。扱い（そのまま / 作成リストで選択不可 / 抽出から除く）は正式仕様PRで決める［Owner O15］。抽出規則を変える場合は通常Candidateの出力も
   変わり得るので、その時点で計算版数を判断する

### 18.3 version変更が必要になる条件と担当PR

| 条件 | 必要な変更 | 担当 |
| --- | --- | --- |
| 形状制約API化が無指定時のSearch出力を変える | 許容しない（設計を見直す）。やむを得ない場合は計算版数 + build-result互換例外を仕様で判断 | PR-2 |
| `localeCompare` の置換が通常Candidate Searchの出力を変える | 計算版数の判断（build result / Planとも影響し得る） | PR-2 |
| 中間状態抽出・途中採用の規則を変える（O15） | Candidate出力の意味が変われば計算版数 | PR-1（仕様）/ 実装PR |
| 全体最適化で作られたことを示す永続field（O13） | `DATABASE_SCHEMA_VERSION` + `ExportRoot.schemaVersion` + migration（既存Planは推測せず `null`） | 別PR |
| Build List画面の `maxPlanSteps` 推奨規則の変更（O14） | versionなし（runtime-only、PLANNER_SPEC 7.2.1） | 別PR |
| 通常Plannerへ全体最適化を組み込み「生産計画を作成」の結果を変える | 計算版数（同じ入力のPlanが変わる）。本書は推奨しない | — |

isolation test等が固定している現行version（`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`EXPORT_SCHEMA_VERSION` 13、
`production-rng:c5-e7`）は、versionを動かすPRだけが更新する。

## 19. 必須テスト

### 19.1 Domain / Search（PR-2・PR-3）

- 移管: 無指定時のSearch不変（既存golden、Candidate Search / Planner Alternative Searchの既存test、search identity）。Production APIの形状制約契約（SEARCH_SPEC 5.6.9の各項目）
- Research回帰: 移管後のResearch moduleがProduction moduleを使って同じ結果を返す（既存のResearch synthetic test・`d0a-v1` golden）。実Exportでは非formalのD-1A runnerで
  §7.2の3値を再現する（PR記録）
- planning Target: §4.2の各ケース（Entry無し、stale、disabled、completed、legacy duplicate、一部有効、0件）、`targetWeapons.length` を分母に使わないこと
- 前提条件: §5.4の各unsupported reason、途中採用状態のfail closed（選択を解除・読み替えしない）、改善優先の扱い（O3の決定どおり）
- 除外Entry: 完了済みTarget・stale Entryを含むsynthetic fixtureで `optimized` になり、除外Entry集合の不一致・追加warningで不成立になる（§4.3）
- 成立条件: §7.5の各条件の違反で採用不可、恒等式違反がfail closed、`maxPlanSteps` 導出（`confirm_owned_ideal` を含むfixtureで `requiredActions` が一致、bound到達時に自動増加しない）
- identity: 生成Entry IDが既存規則と一致、同一意味の既存Entryの再利用（「変更なし」）、同ID異内容の拒否、Candidate ID / searchRunId / tokenにResearch文字列が無い、
  Plan / Step IDがProduction ID factory由来
- 決定性: 同じ入力の2回計算でsemantic一致（ID・時刻を除く）。localeを変えたNode実行で一致（PR-2の監査結果に応じて）
- 結果分類: §9.3の対応表の各行
- isolation: Productionが `src/benchmarks/**`・`src/domain/search/research/**` をimportしない、Worker bundleが `src/db/**` を含まない、Research専用symbolがProductionに無い

### 19.2 Worker / Application（PR-4）

- protocol: guard、version、requestの形（条件・期待hashのfieldが無い）、1 requestにつき終了message 1件
- progress: 段階名だけで、数値・割合・残り時間を持たない
- lifecycle: cancelで同期的に `cancelled` + 即時terminate、cancel後・settle後のmessageを適用しない（採用結果0件、settle 1回）、runごとの新Worker、
  前runのmessageが新runへ適用されない、route変更・unmount・pagehideでterminate、`error` / `messageerror` のfail closed、結果検査の不合格
- 入力: `createPlannerInput()` 由来、`conflictResolutions = []`、入力tokenのmain thread側項目（observed Draft ID、実行中Planなし）

### 19.3 Persistence（PR-6）

- 一括置換 + Draft置換の原子性（成功時の状態、各write失敗でのrollback）
- 拒否: 実行中Planの出現、Draft IDの不一致、Draft 2件以上、tokenの各項目（RNG / Counter / 所持武器のsemantic変更、Target変更、作成リストの追加・削除・変更、CalculationContext）、
  `O` の不一致、generated ID衝突、cardinality違反、Plan参照違反、artifactの各検査違反
- status / 名称 / memoだけの変更では拒否しない
- 置換0件（全Target変更なし）の採用がDraftだけを保存する
- 既存guardを通ること（approval不要、承認を渡すと `plan_breaking_change_approval_not_required`）
- 採用後のDraftが `prepareProductionPlanStart()` で開始でき、Export / Importで往復する

### 19.4 UI（PR-7）

- 入口の有効 / 無効と理由表示、計算中のstatus領域とcancel、Previewの各表示項目（物理操作数と計画ステップ数の区別、比較対象の有無、置換0件）、
  採用確認Dialog、結果別表示、focus移動、375px幅で横overflowが無いこと、44px以上、色だけに依存しないこと、Debug Modeでだけdiagnostics

### 19.5 Browser受入（PR-5・PR-8）

- 計測前にcommitした測定計画に従い、PC Chrome・Android Chrome・iPhone Safari（Ownerが決めた環境）で、Production計算のsemanticが同じHEADのNode referenceと一致すること、
  cancel試験、再実行、時間・memoryの記録。未実施の環境は「未確認」と記録する
- `npm run build` 後の `dist/` にResearch token（`research.global`、`global-assignment-d0a`、`research-shape-constrained-route-policy` 等）が無いこと

## 20. 実装PR分割案

Production統合はResearch Issue #154とは別の機能開発として、**新しいIssue**（例: 「作成リストの全体最適化（Global Assignment）のProduction統合」）で管理することを推奨する［推奨・O20］。
#154はResearch（Phase Eを含む）のまま残し、両Issueを相互に参照する。本PRではIssueを登録しない。

GitHub Pagesはmainへのmergeで公開されるので、利用者に見える入口を出すPR（PR-7）は最後に置き、そのmerge前に実機受入（PR-8）を終える。

| PR | 目的 | 変更するmodule | 変更しないmodule | 依存 | テスト | 受入条件 | version境界 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **PR-1 正式仕様への反映**（docs-only） | §21のOwner判断を反映し、§22の修正文案を正式仕様へ入れる | REQUIREMENTS 18 / 19 / 23、PLANNER_SPEC（新節、5 / 7.2.1 / 9.2.15 / 9.2.18）、SEARCH_SPEC 5.6.9、DATA_MODEL 9.4 / 9.4.1 / 14.5、UI_FLOW 10、AGENTS.md（要約） | code一式 | 本PR、Owner判断 | — | 正式仕様間の整合、Research契約との整合 | なし（判断を記録） |
| **PR-2 Production Domain / Search基盤** | 形状制約付きRoute探索のProduction API化と、Phase 0〜Cの中立Production Domain moduleへの責務移管 | `src/domain/search/shapeConstrained/`（新）、`src/domain/search/research/`（Research adapterへ縮小）、`src/domain/planner/buildListOptimization/`（Phase 0〜C）、Research moduleのimport先、isolation test | Production Planner / Candidate Search / Planner Alternativeの挙動、Worker、UI、Persistence、D-1C / P-2記録 | PR-1 | §19.1（移管・Search不変・Research回帰・isolation）、localeCompare監査 | golden不変、Research D-1A runnerが§7.2の3値を再現（非formal記録）、lint / test / build | なし（変える場合は停止して仕様へ戻る） |
| **PR-3 Production全体最適化計算** | Phase D / D'（射影起点 + 形状制約、独立Route検証、最終入力、§4.3 / §7.5の成立条件、§14.1の導出、結果型、Production identity） | `src/domain/planner/buildListOptimization/`、Production materializer adapter | Planner本体、Search API、Worker、UI、Persistence | PR-2 | §19.1（成立条件・除外Entry・identity・決定性・結果分類） | synthetic全ケース、実ExportでのNode非formal確認（43 / 43、物理操作数1,766の再現と、Production tokenでのsemantic一致） | なし |
| **PR-4 Worker / Application接続** | 専用Worker、protocol、Client lifecycle、Production adapter（上限定数の受け渡し口）、入力とtokenの作成 | `src/workers/buildListOptimization.worker*.ts`（新）、`src/services/planner/` の新Client・Application service | Planner Worker protocol / Client、UI、Persistence | PR-3 | §19.2 | lifecycle・cancel・isolation（Worker bundleに `src/db/**` が無い） | なし |
| **PR-5 Production上限の計測と確定** | Production計算のBrowser Worker計測（PC / Android / iPhone）で §14.2の定数を根拠付きで確定 | benchmark-only harness（`src/benchmarks/**`）、計測記録docs、Production定数 | UI、Persistence | PR-4 | 計測計画のcommit、analyzer | 測定計画どおりの記録、定数の根拠と未確認範囲の記録 | なし |
| **PR-6 採用・Persistence** | 保存API（inspect / save）と保存transaction | `PlannerResultPersistenceService`、`src/domain/planner/plannerResultPersistenceValidation.ts`（必要な検査の追加） | UI、既存の保存APIの意味 | PR-3（PR-4と並行可） | §19.3 | 原子性・各拒否・Export往復 | なし |
| **PR-7 Preview / 採用UI**（初の利用者向け公開） | 入口、計算中、Preview、採用確認、結果別表示 | `src/pages/BuildListPage.tsx`、新しいPreview component | Domain、Worker protocol、Persistenceの意味 | PR-4、PR-5、PR-6 | §19.4 | PC / 375pxの確認、a11y、Debug Mode。**merge前にPR-8の受入をOwnerが確認** | なし |
| **PR-8 回帰・性能・実Browser受入** | Production build（PR-7のhead）での実機受入と回帰記録 | 受入記録docs（必要ならbenchmark harnessの追加） | Production code | PR-7（merge前） | §19.5 | Ownerが事前に決めた合格基準、未確認環境の明記 | なし |

- 各PRは1 PR = 1責務とし、main向けDraft PR、mergeはOwner判断（docs/AI_DEVELOPMENT_WORKFLOW.md）
- PR-2とPR-3はProduction source（Search Domain・Planner Domain）を変更するので、開始前にOwner承認を要する（D-0A-2aと同じ扱い）

## 21. Ownerの判断が必要な事項

| # | 事項 | 本書の推奨 |
| --- | --- | --- |
| O1 | 全体最適化をv1仕様への機能追加として採用するか（REQUIREMENTS 39の固定との関係）、機能名・UI名 | 採用する場合、PR-1で正式仕様化。名称「作成リストの全体最適化」/ 操作名「全体最適化を試す」 |
| O2 | 途中採用状態の選択を持つ入力（§5.1） | 案A（全体fail closed、自動解除しない）。案Bは後続Issue |
| O3 | 改善優先が `planner` 以外の入力（§5.2） | 案1（開示して既定へ戻す） |
| O4 | 部分的なRNG未確定・sourceの無いTarget（§5.3） | 全体fail closed。固定Route拡張は後続Issue |
| O5 | 採用の単位（§11.1） | 一括採用だけ |
| O6 | 実行中Planがある場合（§13） | 案A（提供しない） |
| O7 | Previewの比較対象（§10.3） | 同じ入力から作られた現在Draftだけ。baseline runは行わない |
| O8 | Phase D'の `maxPlanSteps` 導出（§14.1） | `roundUpPlannerMaxPlanSteps(objective + planningTargetCount) + 500`、ユーザー編集不可 |
| O9 | 探索上限の値と公開範囲（§14.2） | PR-5の計測で定数を確定。ユーザーには公開しない |
| O10 | 到達表window（§14.2） | Production専用定数（候補検索の既定値・ユーザー保存値をauthorityにしない） |
| O11 | wall-clock上限・長時間化の案内閾値（§15.1） | 自動timeoutなし。案内閾値は端末計測後に決める |
| O12 | スマートフォンの公開条件、iPhoneの検証経路、性能不足時の対応（§16） | 公開前に実機受入必須。経路と合格基準はOwnerが計測前に決める |
| O13 | 全体最適化で作られたことを示す永続表示（`/plans` 等） | 追加しない（schema変更を避ける） |
| O14 | 採用後に通常Plannerを作り直す場合の最大計画ステップ数（§14.1） | Issue #130の規則は変えず、案内だけ |
| O15 | 継続Routeの `match = ideal` 中間状態の扱い（§18.2の4） | 正式仕様PRで決める（監査を先に行う） |
| O16 | Browser間・locale間の決定性の確認範囲（§7.6、§15.8） | PR-2で監査、PR-8でOwnerが決めた環境を確認 |
| O17 | 割当で優先起点（`preferredOwnedWeaponId`）を使うか | 使わない（Researchと同じ）。Previewで優先起点と異なる起点を示す |
| O18 | page loss後の「前回中断」通知（§15.5） | 行わない（storageへ保存しない） |
| O19 | iPhone検証のための事前公開の仕組み（§16） | 必要になった場合だけ検討（正式仕様の判断を伴う） |
| O20 | Production統合用の新Issue（§20） | #154とは別Issueで管理 |
| O21 | Researchのfresh検証をProductionの成立条件に残すか（§7.5） | 残さない（CI・受入に残す） |

## 22. 正式仕様への修正文案（付録A。本PRでは適用しない）

以下は **提案** であり、Owner判断（§21）の後にPR-1で正式仕様へ反映する。採否・文言は変わり得る。

### 22.1 REQUIREMENTS

**18章（作成リスト）** 「作成リスト項目の生成主体は次の2つとする」に追加:

```text
- ユーザーが作成リスト画面で明示的に実行した「全体最適化」の結果を、Previewで確認して採用した場合
  （採用は計画対象の目標武器の項目を一括で置き換え、生成された作成プランと同じ1つの操作で保存する。
  採用しなかった結果は保存しない）
```

**19章（Planner）** 新しい段落の追加:

```text
作成リスト画面では、通常の「生産計画を作成」とは別に、ユーザーが明示的に起動する「全体最適化」を提供する。
全体最適化は、作成リストに有効な候補がある目標武器（計画対象）について、既存候補のルート内容を使わずに
全目標武器のルート集合を組み直し、通常Plannerと同じ計算方式で計画全体を検証する。成立した結果は保存せずに
試算として表示し、ユーザーが採用した場合だけ作成リストの候補を一括で置き換えて生産計画の下書きを保存する。
全体最適化は最短の計画を保証しない。通常の「生産計画を作成」、競合repair（23.1）の意味は変更しない。
全体最適化の探索範囲・探索上限・最大計画ステップ数はユーザー設定ではなく、仕様で定める規則で決める。
```

「ユーザーが変更できるPlannerの設定は「最大計画ステップ数」…だけとする」の直後に、全体最適化はこの設定を使わないことを1文加える。

**23章（競合）** 「明示的な選択が無い競合については自動で再検索を行わず」の後に追加:

```text
作成リスト全体を組み直す「全体最適化」（19章）は、競合解決のための再検索ではなく、ユーザーが明示的に起動し、
試算を確認して採用する別の操作である。全体最適化は競合選択・競合repair履歴を作らず、読み込まない。
```

**3.2章** 変更しない（PC限定にしない）。§16の性能不足時に端末差の扱いを変える場合だけ、別途Owner判断で改訂する。

### 22.2 PLANNER_SPEC

- **新節**（例: 9.3「作成リストの全体最適化」）: 位置づけ（§3）、対象Target（§4）、前提条件とunsupported（§5）、入力（§6）、計算列と成立条件（§7.1 / §7.5、§4.3）、
  結果型（§9）、置換とidentity（§11）、保存（§12）、実行中Plan（§13）、上限（§14）、cancel（§15）、version（§18）
- **7.2.1**: 「Worker Client、Worker controller、Domain moduleは既定値を補わない」に、全体最適化のPhase D' `maxPlanSteps` は新節の導出規則（Domain authority）で決まり、
  通常Plannerの `PlannerInput.options` authorityとは別であることを追記
- **9.2.18**: 置換契約を使う操作にPlanner Alternativeに加えて全体最適化の採用を加える（置換の共通authorityは同じ）
- **9.2.15**: 保存APIとして全体最適化の採用（inspect / save）を加え、共有する保存境界と固有の検査（§12.2）を記述
- **5**: `PlannerWarningKind` の列挙に、実装済みの `duplicate_build_list_entries_for_target` と `completed_target_excluded` を加える（§4.3注記。記載漏れの補正で意味は変えない）

### 22.3 SEARCH_SPEC

**5.6.9** を「Research専用」から、全体最適化だけが使うProduction API（形状指定Route探索）へ改める。無指定時不変性・reservation非流用・lane開始Ideal継続の限定・
独立Route検証を契約として残し、Research adapter（Research token）はResearchの範囲として区別して記述する。

### 22.4 DATA_MODEL

- **9.4「Planner-generated BuildListEntry」**: 生成主体に全体最適化の採用を加える（永続provenance fieldは追加しない）。9.4.1「collection invariant」の
  「生成主体（ユーザー追加 / Planner constrained re-searchの採用）を区別する永続provenance fieldは追加しない」にも全体最適化の採用を加える
- **14.5**: 全体最適化の採用をPlanner Save Transactionの一種として加える

### 22.5 UI_FLOW

- **10章**: 操作に「全体最適化を試す（実行中の生産計画が無い場合）」を追加し、新節（例: 10.4「全体最適化」）に入口・計算中・Preview・採用確認・結果別表示（§17）を記述
- **10.0「計算中の表示」**: 全体最適化は段階名だけを表示し、完了率・残り時間・件数を表示しないことを追記

## 23. 本PRの検証

- 変更file: 本書（新規）と、[設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md) §16末尾への参照1段落だけ。正式仕様（REQUIREMENTS / PLANNER_SPEC / SEARCH_SPEC / DATA_MODEL / UI_FLOW）・
  `AGENTS.md`・Production code・Research code・test・D-1C / P-2の記録とRESULT・version定数は変更していない
- 本書で［実装］とした関数・型・module・定数の存在を基準main `4ab8e07` で確認した（`createGlobalAssignmentContext()`、`buildReachTable()`、`sourceLaneAdmission()`、
  `createStructuralCandidateSearch()`、`materializeStructuralCandidate()`、`verifyPlannerCandidate()`、`visitShapeConstrainedRouteCandidates()`、
  `SHAPE_CONSTRAINED_ROUTE_POLICY_VERSION`、`globalResearchInputFromExport()`、`globalResearchDependencies()`、`derivePlannerPlanningTargets()`、`createPlannerInput()`、
  `createDeterministicMaterializer()`、`createPlannerAlternativeSearchIdentity()`、`createProductionPlanWithObserver()`、`applyPlannerZeroOperationConfirms()`、
  `roundUpPlannerMaxPlanSteps()`、`CONFLICT_RESOLUTION_MAX_PLAN_STEPS_MARGIN`、`recommendedBuildListMaxPlanSteps()`、`resolveBuildListEntryReplacement()` /
  `applyBuildListEntryReplacements()` / `validateBuildListEntryReplacements()`、`validateBuildListCardinality()`、`prepareFinalReplacementBuildList()`、
  `checkPersistableOrdinaryPlannerResultShape()`、`checkProductionPlanBuildListEntryReferences()`、`createPlanningTargetWeaponsHash()`、`createPlanningBuildListEntriesHash()`、
  `createExpectedPlanState()`、`PlannerResultPersistenceService` の3 API、`PlanBreakingChangeGuard`、`prepareProductionPlanStart()`、`getRunningProductionPlan()` /
  `getDraftProductionPlan()`、`PlannerAlternativeRouteSummary`、`extractIntermediateStateGroups()`、`currentEntryEligibility()` の除外warning、各isolation testの禁止token）
- 整合を確認した項目: 正式仕様との衝突点・記載漏れ（REQUIREMENTS 18 / 19 / 23 / 39、PLANNER_SPEC 5 / 7.2.1、SEARCH_SPEC 5.6.9、DATA_MODEL 9.4、UI_FLOW 10.3）を §22 に列挙、
  Research結果をProduction defaultとして流用していないこと（§14）、Build List cardinality（§11）、checkpoint hard constraint（§5.1）、Plan-breaking guard（§12 / §13）、
  PC / スマートフォン両対応（§16）、推奨案と確定事項のtag区別（§1.2）
- 実行したcommandと結果はPR本文に記載する（`git diff --check`、`npm run check:nul`）。docs-onlyのため挙動変化は無い。lint / test / buildを省略した場合はPR本文に明記する
