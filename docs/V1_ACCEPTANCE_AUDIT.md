# v1受入シナリオ監査

監査基準: `af4320883f1f23a843986972c580604289efd4cc`（main、PR #63）。2026-09-22。
REQUIREMENTS 36 / 37 / 38を現行コードへ照合した記録であり、製品仕様を変更する文書ではない。
判定順は REQUIREMENTS > 今回の監査指示 > 関連正式仕様 > 実装 > tests > historical docs とした。

## 判定方法と結果

- `covered`: 要求する状態遷移・副作用を既存assertionで確認できる。UIの委譲テストと同じServiceの統合テストを組み合わせてよい。
- `covered_after_this_pr`: 足りない境界を今回追加・補強したassertionで確認する。
- `partially_covered`: 証明済みの部分と、未実装または未検証の部分がある。
- `not_implemented`: 必要な実装経路が存在しない。テスト追加だけで完成扱いにしない。
- `out_of_scope`: 本監査で実装・検証を拡張しない対象。
- `historical_note_only`: 過去時点の記録であり現在の未実装根拠にしない。

38章の36項目（38.1の7項目、38.2の6項目、38.3の9項目、A〜J、38.4の4項目）は、
**covered 29 / covered_after_this_pr 6 / partially_covered 1（J）**。
Jの登録・検索時の既所持Ideal通知は `not_implemented`。よって本監査はv1全体の完了宣言ではない。
36 / 37の実ブラウザでの375px操作・Pages配信smoke、および33のDebug表示は別表の残課題とする。

### テスト証拠の読み方

以下のパスはrepository root相対。`src/pages` の通常testは依存Service / Worker clientを注入する
component testであり、ブラウザE2Eではない。`withDatabase` を使うExecution / dataTransfer testは
実Dexie transaction + fake-indexeddbを通す。Execution fixtureのPlanは本物のPlannerで生成するが、
RNGは固定Fakeで、`validateResultingWeapon`を差し替えるケースがある。これは実行契約の検証であり、
Production RNGの全武器・実ゲーム一致を追加検証したという意味ではない。
Production接続は既存 `src/workers/search.worker.production.test.ts` /
`planner.worker.production.test.ts` / `planner.worker.production.constrained.test.ts` が担う。

G/HのStep 12 / 20は、同じ「途中実行」「セーブ地点より後の履歴」という条件を短いfixtureで検証する。
12や20に固有の分岐はない。20-Stepの画面通し操作を実施したとは主張しない。

## 38.1 状態設定から候補検索

| 要件 | 実装authority | 既存testと具体的な証拠 | coverage | 不足 | 今回の対応 |
| --- | --- | --- | --- | --- | --- |
| 1 RNG状態Import / 直接入力 | `src/pages/RngSetupPage.tsx`、`src/services/rngState/rngStatePersistenceService.ts`、`src/services/dataTransfer/importExportService.ts` | `src/pages/RngSetupPage.test.tsx`: `normalizes a decimal Base Seed, marks it manual, and preserves untouched KnownValues`、Counter単独編集・負値拒否。`src/services/dataTransfer/importExportService.test.ts`: 全table置換、JSON round-trip。Settingsのfile選択→検証→確認→applyは `src/pages/SettingsPage.test.tsx` | covered | なし（入力とImportは仕様上の選択肢） | 再利用 |
| 2 必要なレア8 Normal Counterを観測確定 | `src/domain/rng/identification/normalArtianCounterIdentification.ts`、`src/pages/NormalCountersPage.tsx`、`RngStatePersistenceService.adoptNormalArtianCounterIdentification()` | `src/pages/NormalCountersPage.test.tsx`: `saves the unique start Counter C itself with the observation count, never C + N`、Switch Axe混在観測、未保存Counter新規作成。`src/components/rng/NormalCounterIdentificationDialog.test.tsx` はunique / multiple / truncatedとゲーム復帰確認。`src/domain/rng/identification/normalArtianCounterIdentification.test.ts`、同Worker testはordered照合を担当 | covered | なし。UI client stubを同定アルゴリズムの証明には使わない | 再利用 |
| 3 所持通常・巨戟を個別登録 | `src/services/crud/entityCrudServices.ts`、`src/pages/OwnedWeaponsPage.tsx` | `src/pages/OwnedWeaponsPage.test.tsx` の登録・kind別フォーム・編集・保存拒否、`src/services/crud/entityCrudServices.test.ts` のID保持・Master availability拒否、`src/db/repositories/repositories.integration.test.ts` の保存／参照保護 | covered | なし | 再利用 |
| 4 理想／実用条件付きTargetを複数登録 | `TargetWeaponCrudService`、`src/components/forms/TargetCompromiseEditor.tsx` | `src/pages/TargetWeaponsPage.test.tsx`: `creates priority-3 Target with five Ideal slots and condition editors`、複数Target追加・編集順序。`src/services/crud/entityCrudServices.test.ts`: `saves Practical/Alternative/Skill conditions and validates count ranges`、Ideal包含違反拒否 | covered | なし | 再利用 |
| 5 利用可能な経路を検索 | `src/services/search/createCandidateSearchInput.ts`、`src/domain/search/candidateSearch.ts`、Search Worker | `src/services/crud/crudIntegration.test.ts`: RNG / Counter / Owned / TargetがSearch Inputへ渡る。`src/domain/search/candidateSearch.integration.test.ts`: Normal、所持Normal、巨戟、blindの具体Routeと不足streamだけのskip。`src/pages/SearchPage.test.tsx`: `searches exactly one Target and renders its canonical Ideal Candidate` | covered | 全フォームを一本につなぐ巨大E2Eはない。各保存／読出境界と同じtyped Inputを照合 | 再利用。Fの新規統合testもcurrent DB→Searchを補強 |
| 6 理想候補・lane別途中状態・距離確認 | `src/domain/search/intermediateStateExtraction.ts`、`src/components/search/CandidateCard.tsx`、`IntermediateStateSelector.tsx` | `src/domain/search/intermediateStateExtraction.test.ts` はtraceからの状態／距離。`src/components/search/IntermediateStateSelector.test.tsx` はlane別選択・表示。`src/pages/SearchPage.test.tsx`: `keeps at most one selected state per lane and passes the preference on`。`src/services/buildList/buildListService.test.ts`: `L: stores the intermediate state selection and preference, and never overwrites them on a re-add` | covered | なし。practical status単独testを根拠にしない | 再利用 |
| 7 Bonus維持のSkill-only検索 | `src/domain/search/existingGogmaRouteSearch.ts`、`skillStream.ts` | `src/domain/search/skillStreamIndependence.test.ts`: `keeps a Reset Skills only route Bonus-preserving` は元5枠／scope／ID維持、Ideal Skill、Gogma進行0、Skill操作をassert。`candidateComposition.test.ts`: `uses existing_gogma_reset_skills for d = 0 with k > 0` | covered | なし | 再利用 |

Build List追加の連結は `SearchPage.test.tsx` の `adds a displayed Candidate to Build List through the service boundary` と
`buildListService.test.ts` の `adds a Candidate snapshot once and rejects a semantic duplicate from a new search` が証明する。

## 38.2 複数目標の計画生成

| 要件 | 実装authority | 既存testと具体的な証拠 | coverage | 不足 | 今回の対応 |
| --- | --- | --- | --- | --- | --- |
| 1 複数目標の候補をBuild Listへ追加 | `BuildListService`、`src/pages/BuildListPage.tsx` | 上記追加境界＋`src/pages/BuildListPage.test.tsx` のTarget別group、`src/domain/planner/productionPlanExecutionContract.test.ts`: `projects both Targets of a two-Target Plan into its dependent execution state` は両Entry採用・両Target completion effectを確認 | covered | なし | 再利用 |
| 2 shared RNG / 在庫 / priority | `src/domain/planner/plannerBeamSearch.ts`、`plannerScoring.ts`、`plannerInitialState.ts` | `src/domain/planner/plannerBeamSearch.test.ts`: `shares one Gogma action only for the same physical source`、`shares Skill progress for the same unprotected Reset Skills source`、`keeps Normal counters independent by weapon type`、`prunes the Beam by Target priority, never by Practical-first`、所持Normal二重利用拒否 | covered | なし。異なる資源を同じCounterだから共有可とはしない | 再利用 |
| 3 競合なし時系列Plan | `src/domain/planner/productionPlanGeneration.ts`、execution projection | `src/domain/planner/productionPlanGeneration.test.ts`: `replays a new Normal route into ordered PlanSteps without regenerating its reserved weapon ID`。`productionPlanExecutionContract.test.ts` の二目標expected-state chain。`src/pages/BuildListPage.test.tsx`: `hands the whole PlannerOrchestrationResult to the atomic Persistence boundary`、保存済IDへの遷移 | covered | なし | 再利用 |
| 4 競合理由・選択肢・明示選択後再計算 | `src/pages/ProductionPlanPage.tsx`、`src/domain/planner/constrained/plannerConstrainedOrchestration.ts` | `src/pages/ProductionPlanPage.test.tsx`: `selects without comparison, prepares fresh input before immutable merge, and explicitly passes 2/1/4` は明示resolutionと最新inputをWorkerへ渡す。`src/domain/planner/plannerBeamSearch.test.ts`: `detects incompatible counter operations and applies a stable resolution`。`src/domain/planner/constrained/plannerConstrainedOrchestration.test.ts` は制約再検索結果採用。`src/services/planner/plannerResultPersistenceService.test.ts` はPlanとgenerated Entriesの同時保存 | covered | なし。UIはWorker stub、計算・保存は下層実装を別途検証 | 再利用 |
| 5 protectedをReset / Keep / Skill変更へ使わない | `plannerInitialState.ts`、Search route eligibility | `src/domain/planner/plannerFoundation.test.ts`: `rejects protected %s and Skill amendment routes` はReset / Keep / Skillsの入力排除。`plannerBeamSearch.test.ts`: `rejects protected Bonus and Skill mutations` はtraceなし。`src/domain/search/candidateSearch.integration.test.ts`: `excludes protected sources from destructive routes`、`does not search Reset Skills from a protected source or call prediction` | covered_after_this_pr | Planner側の既存caseはReset / SkillsだけでKeepを直接assertしていなかった | 既存Domain caseをReset / Keepでparameterize |
| 6 conflict / rejectedをEntry単位で追跡 | `src/domain/planner/productionPlanGeneration.ts`、PlanConflict / RejectedBuildListEntry | `src/domain/planner/plannerBeamSearch.test.ts`: `detects incompatible Skill and Normal counter positions by Entry ID`。`src/domain/planner/productionPlanGeneration.test.ts` のrejected projection、`src/pages/ProductionPlanPage.test.tsx`: `shows the Planner exclusion reason before a missing current Conflict reason` | covered | なし | 再利用 |

## 38.3 実行と再同期

この表の `runtime test` は [productionPlanExecutionService.test.ts](../src/services/execution/productionPlanExecutionService.test.ts)、
`Navigator test` は [ExecutionNavigatorPage.test.tsx](../src/pages/ExecutionNavigatorPage.test.tsx) を指す。
実装共通authorityは [ProductionPlanExecutionService](../src/services/execution/productionPlanExecutionService.ts) と
[src/domain/execution](../src/domain/execution) のpure prepare / transitionである。

| 要件 | 実装authority | 既存testと具体的な証拠 | coverage | 不足 | 今回の対応 |
| --- | --- | --- | --- | --- | --- |
| 1 StepごとのCounter保存 | `stepExecution.ts`、Service.confirmExpectedPlanStep | runtime test: `advances only the Normal Counter for a Counter-advance Normal and persists nothing of later Steps`。Navigator test: `walks a new Normal Route to completion one confirmed Step at a time` | covered | なし。未確認Stepは不変とassert | 再利用 |
| 2 一致時の状態・履歴・次Step | 同上 | runtime test: `runs a new Normal Route to completion Step by Step across service instances` は登録・同一ID巨戟化・Counter・Target/Plan完了・履歴数。Navigator ordinary Stepsは実Dexieで進む | covered | なし | 再利用（Aで追加補強） |
| 3 実結果記録→stale→同定導線 | `unexpectedStepResult.ts`、ExecutionDivergenceRecovery、reminder | runtime testのactual_result_different群は実結果／Counter／History／stale。Navigator divergence群と `src/pages/DashboardPage.reidentification.integration.test.tsx` は記録から誘導・正式同定での解消 | covered | なし。operation_uncertainは通常同定に直送せず別recovery | 再利用 |
| 4 理由表示・現在地点再試算／採用 | `productionPlanReplanPreviewService.ts`、`replanAdoption.ts`、Preview panel | `src/pages/ProductionPlanPage.replan.integration.test.tsx`: current persisted stateからのPreview不変、採用時旧abandoned／新active／画面遷移、採用前進行時拒否。`ProductionPlanPage.test.tsx` はtyped理由表示 | covered | なし | 再利用 |
| 5 アプリ操作Undo | `executionUndo.ts`、Service.undoLatestExecution | runtime testのUndo群＋`src/pages/ExecutionNavigatorPage.stateControls.test.tsx`: `undoes the latest confirmed Step only after the confirmation, and says the game is not reversed` | covered | なし | 再利用 |
| 6 status変更のみでstaleにしない | `planBreakingChange.ts`、semantic hashes、CRUD guard | `src/services/execution/planBreakingChangeGuard.test.ts`: `saves status, name and memo of a tracked weapon and non-semantic Target edits without approval` は全Plan等不変。`src/domain/planner/plannerSemanticInventory.test.ts`: `ignores the status label: relabelling never splits a branch` | covered | なし | 再利用 |
| 7 所持Normal二重利用禁止／永続同一ID巨戟化 | inventory、`stepExecution.ts` | `plannerBeamSearch.test.ts`: `never reuses one owned Normal conversion source in a branch` / `consumes one owned Normal conversion source and never reuses it`。runtime test: `converts an owned Normal under its own OwnedWeapon ID` は同一ID・新規／削除集合空 | covered | なし | 再利用 |
| 8 最新SnapshotからTargetを含め完全Undo | `executionUndo.ts`、ExecutionUndoSnapshot | runtime testのUndo群は登録武器削除、Normal復帰、完了／preferred復帰、save point復帰、最新History ID拒否。`ExecutionNavigatorPage.stateControls.test.tsx`: `refuses an Undo whose record is no longer the latest, and undoes nothing else` | covered | なし | 再利用 |
| 9 保存失敗の非部分更新 | Service transaction＋DB hooks | 下のatomicity表。書込前validation拒否だけでなく、途中／末尾write失敗後に全関係tableのdumpをbeforeと比較する | covered | 指定5種類すべて既存testあり | 重複testは追加しない |

### 保存失敗 / atomicityの証拠

| 操作 | 具体test | 故障点と確認 |
| --- | --- | --- |
| Step確定 | `src/services/execution/productionPlanExecutionService.test.ts` / `atomic Step confirmation` / `rolls back every earlier write when the last write of the transaction fails` | 最終History作成hookを失敗。先行RNG／武器／Target／Plan／save point更新を含むdumpが元どおり |
| Undo | 同file / `rolls back every restore write when the ExecutionHistory delete fails` | 最後のHistory削除hookを失敗。全Counter置換、武器、Target、Plan、save pointの復元もrollback |
| Replan adoption | `src/services/execution/productionPlanReplanAdoption.test.ts` / `replan adoption atomicity` | generated Entry作成、旧Plan更新、新Plan追加、作成中付替え、save point削除、restore分岐のHistory削除を個別に失敗させdump一致。`ProductionPlanPage.replan.integration.test.tsx` も生成Entry保存失敗をUI→実Runtimeで検証 |
| SavePoint restore | `src/services/execution/productionPlanExecutionSavePoint.test.ts` / `rolls back every restore write when the ExecutionHistory delete fails` | Stepを進め登録武器ができた後、History削除を失敗。戻す前の状態・履歴・save pointが維持 |
| Plan-breaking approved save | `src/services/execution/planBreakingChangeGuard.test.ts` / `rolls everything back when %s fails` | ユーザー変更、Plan put、作成中解除、restore分岐のHistory削除、save point削除の5ケース。`RepositoryError(transaction_failed)`、全dump一致 |

## 38.5 A〜J

| 要件 | 実装authority | 既存test / 連結する証拠 | coverage | 不足（監査前） | 今回の対応 |
| --- | --- | --- | --- | --- | --- |
| A 新規NormalからIdeal完成 | `productionPlanExecutionProjection`、`stepExecution.ts`、Service | runtime test `runs a new Normal Route to completion Step by Step across service instances` はCounter進行2本を非登録、3本目登録、巨戟化、Reset完成。Navigator `walks a new Normal Route...` はUI確定→実DB | covered_after_this_pr | conversionだけでIdeal Skillが付くfixtureで、conversion後のReset Skillsまでの連続実行が弱い | runtime test `38.5-A: completes new Normal production only after both bonus and post-conversion skill operations`。6物理Step、同一ID、Normal+3／Skill+2／Gogma+1、Bonus後はTarget active、Skill後にTarget/Plan completedをassert |
| B blind Normal | Search blind variant、observation binding、BlindObservationForm | `src/domain/blindNormalRoute.endToEnd.test.ts`、`candidateSearch.integration.test.ts` の `predictNormalArtian` 未呼出assert。runtime test `requires and records the observed five slots of a blind production-target Normal` は未入力拒否→観測登録→同一ID巨戟化→Reset→Ideal。Navigator `asks for the observed five slots instead of offering a match confirmation` は入力経路 | covered | なし。Fakeの5枠を「予測済み」とみなしていない | 再利用 |
| C 既存巨戟 | `src/domain/planner/productionPlanStartEffects.ts`、Service.inspect/startProductionPlan、同一ID更新 | `src/services/execution/productionPlanStart.test.ts`: `moves an existing weapon from Target A to Target B only when the Plan starts` はdraft不変→inspect不変→startリンク。`src/pages/ProductionPlanPage.test.tsx`: `previews the Target links the start will make, by name, before 作成開始`。runtime test `links an existing Gogma to its Target at Plan start, releases another Target, and protects it at completion` | covered | なし。画面previewとtransactionのauthorityを混同しない | 再利用 |
| D 妥協終了 | `compromiseFinish.ts`、CompromiseCheckpointPanel、Navigator | Navigator `shows the checkpoint panel right after its Step until the same weapon moves on` / `finishes as a compromise only after the confirmation dialog` は到達→panel→cancel→確認→実Runtime。`src/services/execution/productionPlanCompromiseFinish.test.ts` はactive Target／preferred保持、practical／作成中解除／abandoned／Undoまで確認 | covered_after_this_pr | 既存の組合せで意味は証明済みだが、UIの終了ケースはTargetと武器の最終状態assertが薄い | 同UIケース末尾にTarget active／preferred保持、weapon practical／作成中解除を追加 |
| E A→B→A切替2回 | `executionStepPresentation.weaponSwitchTarget()`、WeaponSwitchPrompt、Navigator local state | `src/domain/planner/plannerWeaponSwitchPreference.test.ts` はreturn switch count 2。Navigator既存testは1回の切替でPlan/History不変と再mount時の再表示 | covered_after_this_pr | 2回目のA復帰をUI→実Runtimeで確認していない | `38.5-E: guides A to B to A twice without adding a Step, history or Undo action`。本物のPlannerが作ったA→B→A、両ack前後の全dump不変、confirm回数不変、Undo未呼出、最終3Step／3History。48px・xs全幅のCSS契約も確認 |
| F active中Target追加→現在位置検索 | TargetWeaponCrudService、PlanBreakingChangeGuard、createCandidateSearchInput、searchCandidates | `productionPlanExecutionContract.test.ts` は非依存Target追加でexpected hash不変。`planBreakingChangeGuard.test.ts` の非breaking編集群 | covered_after_this_pr | Target新規CRUDからcurrent DB検索への連結が弱い | `38.5-F: adds a Target during execution and searches it from the persisted current position`。一Step実行→inspect承認不要→Target保存→DBからInput→実Searchで候補あり→Plan含む他table不変→旧Planの次Step確定可能 |
| G 再計画Preview／採用 | `productionPlanReplanPreviewService.ts`、`replanAdoption.ts`、Preview hook/dialog | `src/services/execution/productionPlanReplanAdoption.test.ts`: current state Preview全dump不変、新Entryはメモリだけ、adoption再検証、旧History保持、新active。`src/pages/ProductionPlanPage.replan.integration.test.tsx`: `shows the Preview from the current persisted state and writes nothing` / `adopts in one transaction...`、途中進行拒否、非依存Target追加許可、作成中付替え | covered | なし。SavePointなし／現在位置と同じ／先へ進行してkeep／restore時は採用せず再Previewの分岐をService・Pageが検証 | 再利用 |
| H SavePoint→進行→破棄3択 | `executionSavePoint.ts`、`planAbandonment.ts`、ExecutionStateControls | `src/pages/ExecutionNavigatorPage.stateControls.test.tsx`: 記録／上書き確認、ゲーム側確認後restore、`abandons without a save point choice, and cancel changes nothing`、`keeps the current state when chosen past the save point`、`returns to the save point and abandons in one runtime call...`。`productionPlanAbandonment.test.ts` は境界判定とrollback | covered | なし。cancelはmutationを送らない。restore失敗原子性は前表 | 再利用 |
| I 想定外→記録→stale→予測停止→継続同定案内 | `unexpectedStepResult.ts`、Navigator、`persistentReidentificationReminderService.ts` | runtime unexpected群＋Navigator divergence群。`src/pages/ProductionPlanPage.test.tsx`: `creates no Worker Client for a stale Plan`。`src/pages/DashboardPage.reidentification.integration.test.tsx`: 実結果記録→破棄後も警告→手入力で消えず→正式adoptionで解消。`RngSetupPage.reidentification.test.tsx` / `SearchPage.reidentification.test.tsx` は導線・再読出・検索後も警告 | covered | なし。「以降の予測停止」はstale Plan実行停止。独立Searchまで禁止する意味ではなくSearchは警告付きで利用可（PLANNER 16.15、PR #59） | 再利用 |
| J 操作0 Ideal | `existingGogmaRouteSearch.ts`、`productionPlanExecutionProjection`、confirm_owned_ideal、Target/Search UI | `candidateSearch.integration.test.ts`: `returns a protected Gogma that already satisfies the Target as a zero-operation candidate` は予測未呼出。runtime test `confirms an owned Ideal without advancing any Counter`、Navigator `asks for no game operation and confirms through the ordinary Step confirmation` は完成処理 | partially_covered | Target登録・Searchの既所持Ideal通知／通常の完了導線は未実装（下表）。候補生成だけでは通知を証明しない | 意味変更せずfollow-upへ分離 |

## 38.4 保存と復元

| 要件 | 実装authority | 既存test / 具体的証拠 | coverage | 不足 | 今回の対応 |
| --- | --- | --- | --- | --- | --- |
| 1 reload後の復元 | `src/db/AppDatabase.ts`、repositories、各page load / settings hydration | `src/db/repositories/repositories.integration.test.ts` は永続保存読出、runtimeはService再生成、Navigatorはunmount / remount再開。Settings storeは `src/stores/settingsStore.test.ts` | covered_after_this_pr | 同じDB handleの再利用だけではDB再接続を直接確認できない | `src/services/dataTransfer/importExportService.test.ts` / `38.4-1: reopens the database and restores every user table without an Import`。全table入りrootを保存→close→同名の別AppDatabaseをopen→同一clockでserialized Export完全一致。ブラウザプロセス終了／OS eviction耐性は対象外 |
| 2 全データJSON Export | `ImportExportService.serializeExport()`、SettingsPage | `importExportService.test.ts`: `builds the schema 11 root from every table with the service-owned version, app name and clock` / `serializes the root as indented JSON that parses back to the same root`。SettingsPage.testはBlob download / object URL revoke / 失敗表示 | covered | なし | 再利用 |
| 3 Clear後対応JSON Import | 同Service.clearAllData / prepareImportJson / applyImport | `importExportService.test.ts`: `survives export, clear and import on one database` は全dump一致。`round-trips a Plan the real Planner produced and the Execution runtime advanced` はactive／作成中／History／SavePoint付きの復元。SettingsPage.testは確認・cancel・hydrate・二重submit防止 | covered | なし。6..10→11移行も同Serviceのmigration群で検証 | 再利用 |
| 4 invalid / 未対応Importが非破壊 | `src/services/dataTransfer/importExportValidation.ts`、Service transaction | `importExportService.test.ts` のunsupported schema、invalid JSON／root、ID重複、準備後改変拒否は全dump不変。`rolls the whole replacement back when a write fails midway`。`src/services/dataTransfer/importExportValidation.test.ts` の参照／5枠／version検証、SettingsPage.testのprepare失敗時apply未呼出 | covered | なし | 再利用 |

## REQUIREMENTS 36 / 37: responsive監査

全11画面にcomponent testがあり、以下の小画面用 `sx` をコードで確認した。
`src/test/setup.ts` のmatchMediaはfalse固定で、AppLayoutはmobile Drawerの分岐になる。
これは375pxの実layout engineではない。`getComputedStyle` は単純なmin-height、
`src/test/cssRuleAssertions.ts` はemitted CSS ruleだけを検証し、幅計測やcascade全体の正しさは主張しない。
本表の各画面は **partially_covered（操作・CSS契約あり、実375px geometry未確認）** とする。

| 画面 | 実装authority / 確認したsmall-screen契約 | 既存test証拠 | 不足 / 今回の対応 |
| --- | --- | --- | --- |
| Dashboard | `src/pages/DashboardPage.tsx`: xs列配置、minmax(0,1fr)、主導線44px | `src/pages/DashboardPage.test.tsx` の状態別次操作・リンク、reidentification integration | 実幅smokeを残す。追加なし |
| RNG Setup | `src/pages/RngSetupPage.tsx`: xs一列、保存44px、入力minWidth 0 | `RngSetupPage.test.tsx` の手入力保存、Wizard開始、保存失敗表示。`RngSetupPage.identificationLifecycle.test.tsx` | 同上 |
| Normal Counter | `src/pages/NormalCountersPage.tsx`: xs grid areas、mdだけheader、操作wrap | `NormalCountersPage.test.tsx`: 全14武器種の観測開始、unique確定、Debug編集 | 同上 |
| Owned Weapons | `src/components/ManagementListItem.tsx`、OwnedWeaponsPage: xs card配置、DialogContent scroll、DialogActions flexShrink 0 | `OwnedWeaponsPage.test.tsx`: 登録／編集／削除、長文errorのbounded scrollでも保存／cancel到達 | 同上 |
| Target Weapons | 同ManagementListItem、TargetWeaponsPage: xs一列form、DialogActionsを分離 | `TargetWeaponsPage.test.tsx`: condition editors、`edits priority and keeps every dialog section reachable`、長文error／保存／cancel | 同上 |
| Candidate Search | `SearchPage.tsx`: xs条件一列、長名Select wrap、検索／cancel44px、Candidate accordion | `SearchPage.test.tsx`: lane選択→追加、検索progress/cancel。CandidateCard / IntermediateStateSelector tests | 長い第2Targetへ切替→そのIDで開始→cancel、およびwrap／44px CSS契約を今回追加。実幅smokeは残る |
| Build List | `BuildListPage.tsx`: xs縦配置、Target group、折畳詳細、操作wrap | `BuildListPage.test.tsx`: 選択変更・削除・Planner詳細／progress/cancel、`BuildListPage.draft.test.tsx` | 実幅smoke。追加なし |
| ProductionPlan一覧 | `ProductionPlansPage.tsx`: xs操作縦並び、長ID wrap、delete dialog actions wrap | `ProductionPlansPage.test.tsx`: state別導線、draft削除／cancel／失敗、フィルタとhistory表示 | 同上 |
| ProductionPlan詳細 | `ProductionPlanContent` / `ProductionPlanStepList`、Pageのxs縦配置・長文wrap・accordion | `ProductionPlanPage.test.tsx`: 内容展開／競合選択／開始preview、`ProductionPlanStepList.test.tsx`、replan integration | 同上 |
| Execution Navigator | `ExecutionNavigatorPage.tsx`、WeaponSwitchPrompt: primary / switch48px、xs全幅、状態管理を分離 | Navigator real runtimeとstateControls tests | A→B→A testにprimary / switchのxs全幅・48pxを追加。片手操作位置、長いStepのscroll、keyboardは実幅smoke |
| Settings | `SettingsPage.tsx`: xs配置、actions wrap、validation issue bounded scroll | `SettingsPage.test.tsx`: Export／Import／Clear確認／cancel、store同期、二重実行禁止、`hasMaxHeightRule` | 実幅smoke。追加なし |

共通: `src/components/AppLayout.test.tsx` の `opens the mobile Drawer from the hamburger button, reaching every primary screen in the same order` と
`navigates from the mobile Drawer and closes it` が全主要画面への入口を担保する。
実375pxでは上表の登録・編集・検索・比較・保存・cancelを、長い名称とvalidation errorを含めて手動確認する。
横scroll、主要buttonの欠落、Dialog footer / focusの隠れがないことを確認してから36の実表示条件を完了とする。
新規E2E frameworkは不要で、導入していない。

## GitHub Pages契約

**設定・route契約: covered。配信先の実smoke: partially_covered（未実施）。**

- `vite.config.ts`: `base: '/GogmaArtianPlanner/'`。
- `src/App.tsx`: HashRouter。hash内routeのためPages serverに `/plans/:id` のrewriteを要求しない。
- `src/App.test.tsx`: `#/rng` / Normal / Owned / Target / Search / Build List / plans / detail / run / Settingsのrouteを実Appで確認。unknown routeの安全な戻り先も検証。
- `.github/workflows/deploy.yml`: main push / workflow_dispatch、npm ci→lint→test→build→`dist` upload→Pages deploy。PRは `.github/workflows/ci.yml` のverifyで配信しない。
- build済み `dist/index.html` のJS/CSSが `/GogmaArtianPlanner/assets/` を参照し、Worker bundleも `dist/assets` に出力されることを確認した。テストはローカルのアプリ契約であり、GitHub Pages上でのHTTP asset取得・Worker起動の証明とは区別する。

manual smoke: `/GogmaArtianPlanner/` を開く→Dashboard→各主要画面→
`/GogmaArtianPlanner/#/plans/<保存済ID>`→`#/plans/<保存済ID>/run`を再読込。
JS/CSS/Worker assetの404がなく、検索／Plannerの開始・cancelが動くこと。
375px確認と同時実施できる。今回deploy操作は行わない。

## 未実装・残課題（Production変更なし）

| 要件 | 実装／test evidence | coverage | 必要なfollow-up |
| --- | --- | --- | --- |
| 38.5-J 登録・検索時の既所持Ideal通知、通常完了導線 | `TargetWeaponsPage.tsx` は登録保存・preferred管理、`SearchPage.tsx` は検索とCandidate表示・追加。`existing_gogma_current` はDomainに存在するが、その存在だけで登録時通知を証明できない。両PageにUI_FLOW 8.2の既所持Ideal通知／確認完了経路がない。既存testが証明するのはCandidate生成とPlanのconfirm_owned_idealまで | not_implemented | REQUIREMENTS 25.4 / 38.5-J、UI_FLOW 8.2、SEARCH 5.5.5に沿う別実装PR。登録・Search両画面の通知→確認→Target完了のtestを追加 |
| REQUIREMENTS 33 Debug必須情報 | `DebugPage.tsx` のBase Seed／Gogma／Skill／Gate／Normal Counter／Planner内部情報はfuture list。NormalCountersのDebug editor、PlanStepListのdebug情報とPlan context表示は別途存在。`App.test.tsx` はEngine provenance / capability表示だけを確認し、保存済Counter値の表示は確認していない。NavigatorにはdebugMode表示分岐がなくStep before/after閲覧は未接続 | partially_covered | Gateを含む保存済内部状態とNavigator before/afterの確認導線を小さな別PRで監査・接続。future list全体を独断で実装しない |
| 36 / 37 375px実表示、Pages実配信 | 上記component / sx / router / build / workflow契約 | partially_covered | 手動smokeと結果の記録。jsdomのテスト成功だけで合格にしない |
| Production RNGの追加実機検証、性能、専用E2E、将来Debug領域 | REQUIREMENTS 34、既存reference audit / benchmark | out_of_scope | 本PRで拡張しない。既存のreference-verified / game-verified / unverified境界を維持 |

## 古い現在状態の記述とhistorical記録

| 文書 | 判定 | 今回の対応 |
| --- | --- | --- |
| DATA_MODEL 14.4「警告・確認ダイアログのUIは未実装」 | 現在状態の説明が古い | `PlanBreakingChangeDialog` / `usePlanBreakingChangeApproval`、inspect→承認保存、必要時だけsave point選択という接続済authorityへ修正 |
| TARGET_COMPROMISE_SEMANTICS 永続化と互換性 | Settings UI未接続は現在状態の説明が古い | `SettingsPage.tsx` のService接続済を記載。隣接する「現行11」calculation／「現行10」Exportも現行13／11とbuild-result 12例外へ整合。導入時5→6、Dexie1→2、執筆時Export6という履歴は維持 |
| PLANNER_SPEC 16.0 | warning UI／persistent reminderを後続扱いする現在状態が古い | PR #58 / #59相当の実装authorityを記載。章のdomain meaningは不変 |
| RNG_REFERENCE_AUDIT、CANDIDATE_SEARCH_REDESIGN、B/C phase・benchmark文書、REQUIREMENTS 39等の仕様改訂時記録 | historical_note_only | 「当時は未実装／後続」の履歴を現状の欠落根拠にせず変更しない。受入項目は現行sourceとtestsで判定 |

## PR #65 follow-up（38.5-J）

PR #64時点の判定（38.5-J `partially_covered`、登録・検索時の既所持Ideal通知 `not_implemented`）は上表のとおり
歴史として残す。PR #65（`feat/owned-ideal-target-completion`）で未接続部分を実装し、同じ判定基準で再判定した。

| 要件 | 実装authority | test evidence | coverage（PR #65後） |
| --- | --- | --- | --- |
| 38.5-J 全体 | 既存 `existingGogmaRouteSearch.ts` / `productionPlanExecutionProjection` / `confirm_owned_ideal` に加え、`src/domain/target/ownedIdealTarget.ts`（`isOwnedIdealForTarget` / `findOwnedIdealWeaponsForTarget`）、`src/services/crud/targetWeaponLifecycleService.ts`、`src/components/target/` | 下記 | partially_covered → covered_after_followup |
| Target登録・一覧時の既所持Ideal通知 + direct completion | `TargetWeaponsPage.tsx` + `OwnedIdealWeaponNotice` / `OwnedIdealCompletionDialog` / `useOwnedIdealCompletion` | `src/pages/TargetWeaponsPage.ownedIdeal.test.tsx`: 通知（複数Ideal、非Ideal無通知、status / 保護状態の表示）、cancelでService未呼出、確認→完了→active一覧から完了済みsectionへ移動、他Target名の表示とpreferred解除の反映、Plan-breaking Dialog接続、Service拒否の表示、新規保存直後のreloadなし通知。`src/domain/target/ownedIdealTarget.test.ts` は判定authority | covered |
| Search時の既所持Ideal通知 + direct completion | `SearchPage.tsx` + 同component | `src/pages/SearchPage.ownedIdeal.test.tsx`: 通知、検索は禁止しない、cancelで不変、完了後にcompleted TargetをSelectから除外・result clear・次Target選択 / Select空、進行中Searchのcancel、Plan-breaking Dialog接続 | covered |
| 直接完了の永続契約（同一IDでideal / protected、Target completed、`completedByProductionPlanId = null`、他Target preferred解除、Counter / artifact不変、stale read raceの拒否、rollback） | `TargetWeaponLifecycleService` + `PlanBreakingChangeGuard` | `src/services/crud/targetWeaponLifecycleService.test.ts`、`src/services/crud/targetWeaponLifecyclePlanBreaking.test.ts`（実Dexie: Plan非依存は承認不要、Plan依存Targetは承認必須でatomic abandon、execution scope武器の検出、write失敗のrollback） | covered |
| 完了済みTargetの分離・「未完了に戻す」（UI_FLOW 8.3） | `TargetWeaponsPage.tsx`（activeのみの通常一覧、「完了済みの目標武器」section、`ReopenTargetDialog`）、`reopenTargetWeaponMutation` | `TargetWeaponsPage.ownedIdeal.test.tsx`: activeのみ表示、完了日時、`completedByProductionPlanId` がある場合だけ `/plans/:id`、通常編集 / 削除なし、reopenのcancel / confirm / OwnedWeapon不変 / Plan-breaking接続。Service testはreopenの正常 / 異常 | covered |
| confirm_owned_ideal | 既存 | 既存coverage継続（runtime test / Navigator test） | covered（継続） |

375px相当の実表示は、Vite dev + Browser paneのJS計測（`scrollWidth === 375`、主要button 44px、直接完了Dialogと
完了済みsectionのoverflowなし、本番Serviceを通した完了の永続化）で確認した。REQUIREMENTS 36 / 37の他画面の
手動smoke判定は変更しない。バージョン（`DATABASE_SCHEMA_VERSION = 8`、`EXPORT_SCHEMA_VERSION = 11`、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13`、`RngState.schemaVersion = 2`、`AppSettings.schemaVersion = 1`、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7`）とProduction RNG / Search / Planner semanticsは不変。

## バージョンと検証

バージョン不変: `DATABASE_SCHEMA_VERSION = 8`、`EXPORT_SCHEMA_VERSION = 11`、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13`、`RngState.schemaVersion = 2`、
`AppSettings.schemaVersion = 1`、`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7`。
本PRはtest / test helper / docsだけを変更し、Production semanticsとdependencyを変更しない。

追加・補強したtestの個別実行:

```sh
npx vitest run src/pages/SearchPage.test.tsx src/pages/ExecutionNavigatorPage.test.tsx src/services/execution/productionPlanExecutionService.test.ts src/services/execution/planBreakingChangeGuard.test.ts src/services/dataTransfer/importExportService.test.ts
npx vitest run src/domain/planner/plannerFoundation.test.ts
```

個別実行は5 files / 221 testsとPlanner 1 file / 27 testsが成功。
最終全体検証は `npm run lint`、`npx tsc -b`、`npm test`（218 files / 3,535 tests）、
`npm run build`、`npm run check:nul`、`git diff --check` がすべて成功した。
Buildは既存の500kB超chunk警告あり。性能調整は今回対象外。
`git status --short --untracked-files=all`で変更がdocs / tests / test helperの11ファイルだけであることを確認した。

## PR #66 follow-up（REQUIREMENTS 33）

PR #64時点の判定（REQUIREMENTS 33 Debug必須情報 `partially_covered`）は上表のとおり歴史として残す。
PR #66（`feat/debug-details-v1`）で未接続だった保存済み内部状態とStep before/after導線を接続し、
同じ判定基準で再判定した。Debug Modeは観測機能であり、ON/OFFでRNG計算、Candidate Search、Planner、
Prediction support、Persistence semantics、Validation、Execution semantics、Counter advance、
Production Engine selectionのいずれも変更しない。

| 要件 | 実装authority | test evidence | coverage（PR #66後） |
| --- | --- | --- | --- |
| Base Seed / Gogma Counter / Skill Counter / Counter Gate | `DebugPage.tsx` の「現在のRNG状態」section（`DebugPageDependencies.getRngState()` の保存済 `RngState` をそのまま表示。`value` / `isConfirmed` / `source` / `lastIdentifiedAt` / `updatedAt` / `schemaVersion`。Counter Gateには診断・互換用でありProduction Prediction authorityではない旨を併記） | `src/pages/DebugPage.test.tsx`、`src/components/debug/debugStatePresentation.test.ts` | covered |
| 通常アーティアCounter | `DebugPage.tsx` の「通常アーティアCounter」section（保存済み全件を Master `sortOrder` → rarity → id の安定順で表示。`counter` / `isConfirmed` / `observationCount` / `candidateCount` / `lastObservedAt` / `lastIdentifiedAt` / `id`） | 同上（複数件の安定順、0件empty、read failureとemptyの区別） | covered |
| PlanStep内部情報 / RNG予測情報 | 共有component `src/components/debug/PlanStepDebugDetails.tsx` と純関数 `planStepDebugPresentation.ts`。`PlanStep.debug` / `rngAdvance` / `expectedResult` / `expectedStateBefore` / `expectedStateAfter` を保存値のまま表示し、UI側で再計算・再予測しない。`debug === null` は「記録なし」 | `src/components/debug/PlanStepDebugDetails.test.tsx`、`planStepDebugPresentation.test.ts`、`src/components/planner/ProductionPlanStepList.test.tsx`、`src/pages/ProductionPlanPage.test.tsx`、`src/pages/ExecutionNavigatorPage.test.tsx` | covered |
| 各StepのNormal / Skill / Gogma Counter before-after（conversionはSkill +1 / Gogma +0） | 同上（`開始 N → 終了 M（delta D）` をstreamごとに表示。`affectedNormalCounterId` を併記。`0` と `null` を混同せず、未記録は「記録なし」） | `PlanStepDebugDetails.test.tsx`（conversion、確定Normal creation、blind、legacy null）、`ExecutionNavigatorPage.test.tsx`（実fixtureのconversion Step） | covered |
| Planner判定理由 | `PlanStep.debug.plannerReason` を内部文字列のまま表示。新しいPlanner traceは作らず、既存の `RejectedBuildListEntry` / `PlanConflict` 表示も変更しない | `PlanStepDebugDetails.test.tsx`、`ProductionPlanPage.test.tsx` | covered |
| 再計算理由 | `DebugPage.tsx` の実行中Plan section（`recalculationReasons` 全件を `productionPlanRecalculationReasonLabels` + raw enum併記で表示。message parsingなし） | `DebugPage.test.tsx`（stale Planの全reason） | covered |
| 使用中RngEngine名 / capability / Identification availability | 既存 `RNG Engine information` section（変更なし） | `src/App.test.tsx`、`DebugPage.test.tsx` | covered（継続） |
| Master Data version | `DebugPage.tsx` の `Master data / calculation versions` section（Master `gameVersion` / `dataVersion` と `CURRENT_CALCULATION_APP_SCHEMA_VERSION`。Settingsの「アプリスキーマバージョン」= `AppSettings.schemaVersion` とは別概念として内部識別子で表示） | `DebugPage.test.tsx`、`App.test.tsx` | covered |
| 実行ナビのStep before/after | `ExecutionNavigatorPage.tsx` が `useSettingsStore` からDebug Modeを読み、現在Stepだけに同じ共有componentをゲーム操作の下へ折りたたみで表示。stale Planでは現在状態と一致しない可能性を明示 | `ExecutionNavigatorPage.test.tsx`（OFFで内部値なし、ON表示、conversion +1 / +0、stale注記、Step確定後に次Stepへ切り替わる） | partially_covered → covered |
| Debug Mode OFFの非表示 | `DebugPage` はOFF時に読み取りcomponentをmountせずIndexedDB readを開始しない。`ProductionPlanStepCard` / Navigatorも `debugMode` falseでDebug blockを描画しない | `DebugPage.test.tsx`（read未呼出とDOM文字列のleakage）、`App.test.tsx`、`ProductionPlanStepList.test.tsx`、`ProductionPlanPage.test.tsx`、`ExecutionNavigatorPage.test.tsx` | covered |

`docs/REQUIREMENTS.md` 34の「全Planner探索trace viewer」「全Candidate履歴viewer」「PRNG内部10-step dump」
「DebugからのRNG再実行 / Counter編集 / Plan編集 / Execution state編集」「専用E2E」は引き続き
`out_of_scope` であり、本PRでも追加しない。`/debug` はread-onlyで、新しい保存・編集操作を持たない。

375px実表示は開発サーバーのBrowser pane（375x812）で確認した。Debug Details全体および
PlanStep Debugを展開した状態で `document.documentElement.scrollWidth === clientWidth === 375`、
横スクロールする子要素は0件、104文字のhash行は `overflow-wrap: anywhere` で折り返した。
巨大なraw JSONの `pre` 表示は追加していない。

バージョン不変: `DATABASE_SCHEMA_VERSION = 8`、`EXPORT_SCHEMA_VERSION = 11`、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13`、`RngState.schemaVersion = 2`、
`AppSettings.schemaVersion = 1`、`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7`、
Master `dataVersion` 不変。persisted shapeの変更なし。

## PR #67 follow-up（REQUIREMENTS 36 / 37）

PR #64時点の判定（「36 / 37 375px実表示、Pages実配信」`partially_covered`、
「手動smokeと結果の記録。jsdomのテスト成功だけで合格にしない」）は上表のとおり歴史として残す。
PR #67（`test/v1-browser-pages-smoke`）で、実GitHub Pages配信URL
（`https://nekono-lazy.github.io/GogmaArtianPlanner/`、対象main SHA
`9ac5bafc42e800d03feff8c1aa336fa73f64f5b7`、deployment run `35713314968` success）と
実ブラウザ375x812 viewportによる手動smokeを実施し、同じ判定基準で再判定した。
詳細な実施記録・画面別結果・発見事項は `docs/V1_BROWSER_SMOKE.md` を参照。

| 要件 | 実施内容 | coverage（PR #67後） |
| --- | --- | --- |
| 36 スマートフォン幅で主要操作が行える | 実375x812 viewportで全11画面 + Execution Navigator + Debug Detailsの登録・編集・検索・比較・保存・cancel・Dialog操作を、長い名称を含めて手動確認。横scrollなし、主要button・Dialog footerの欠落なし | partially_covered → covered |
| 37 GitHub Pages配信パスでの起動・画面遷移、レスポンシブ表示 | 実Pages URLでのDashboard起動、JS/CSS/Worker asset取得（404なし）、Hash route（`#/rng` 等9画面）とProductionPlan動的route（`#/plans/<id>`、`#/plans/<id>/run`）の直接reload、Search Worker / Planner Worker起動、Export/Import往復、IndexedDB永続化をすべて確認 | partially_covered → covered |

PR #64監査（38.4節の元の監査基準・上表）はREQUIREMENTS 36 / 37の受入条件として
「検索／Plannerの開始・cancelが動くこと」を挙げていたが、当初のPR #67 smokeはSearch Worker /
Planner Workerの起動・結果取得までを確認し、cancel実施の記録が不足していた。PR #67のレビュー
指摘を受け、**ユーザーが実際のGitHub Pages環境で追加のmanual smokeを実施し**、Candidate Search
（開始→処理中Cancel→停止→キャンセル済みrequestの旧結果が後から表示されない→再検索成功）と
Planner（「生産計画を作成」→処理中Cancel→停止→再度「生産計画を作成」→正常実行）の両方で
問題がないことを確認した（Claude Code自身による確認ではない）。詳細は `docs/V1_BROWSER_SMOKE.md`
の「Worker cancel / retry」節を参照。これにより、PR #64監査が挙げていた検索／Plannerの
開始・cancel条件を実Pages環境で満たしたことを確認し、上表の36 / 37 covered判定を維持する。

本follow-upはブラウザ操作記録の追加のみであり、Production code・Domain semantics・
persisted shapeは変更していない。バージョンは不変（`DATABASE_SCHEMA_VERSION = 8`、
`EXPORT_SCHEMA_VERSION = 11`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13`、
`RngState.schemaVersion = 2`、`AppSettings.schemaVersion = 1`、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7`）。
