# モンハンワイルズ 巨戟アーティア厳選Planner
## DATA_MODEL.md

## 1. この文書の目的

この文書は、初期版アプリで扱う永続データ、TypeScript型、ID、enum、関係、不変条件、Dexie保存設計、Export / Import形式、テスト観点を定義する。

実装時はこの文書をDomain Modelの正本とし、UI、RNG、Search、Plannerはここで定義した型を参照する。

対象技術は以下。

- React
- TypeScript
- Vite
- IndexedDB
- Dexie.js
- Web Worker
- GitHub Pages

初期版では以下を実装しない。

- OCR
- REFramework直接連携
- 高速モード
- 複数キャラクター切替
- クラウド同期
- 手動作成順固定

---

## 2. 基本方針

## 2.1 Domain ModelとDB Model

Domain Modelはアプリ内の判定・検索・Plannerで使用する正規化された型である。

DB ModelはIndexedDBへ保存する型であり、原則としてDomain Modelと同じ構造にする。ただし、以下はDB保存向けに制限する。

- `Date` はISO 8601文字列として保存する
- `Map` / `Set` は使用しない
- class instanceは保存しない
- 関数は保存しない
- undefinedは保存せず、nullableな値は `null` を使う

## 2.2 IDの基本規則

ユーザー生成データのIDは、クライアント内で生成する不透明文字列とする。

推奨形式。

```ts
type EntityId = string;
```

実装では `crypto.randomUUID()` を使用する。

ID prefixはデバッグしやすさのため許可するが、ロジックはprefixに依存してはならない。

例。

```text
owned_550e8400-e29b-41d4-a716-446655440000
target_550e8400-e29b-41d4-a716-446655440000
candidate_550e8400-e29b-41d4-a716-446655440000
plan_550e8400-e29b-41d4-a716-446655440000
step_550e8400-e29b-41d4-a716-446655440000
```

マスターデータIDは安定した文字列IDとする。

例。

```text
weapon.dual_blades
element.thunder
bonus_type.attack
bonus_rank.ex
series_skill.gore_magala
group_skill.apex
```

---

## 3. 共通型

## 3.1 Branded ID

実装では取り違え防止のため、branded typeを使用してよい。

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };

export type OwnedWeaponId = Brand<string, "OwnedWeaponId">;
export type TargetWeaponId = Brand<string, "TargetWeaponId">;
export type BuildCandidateId = Brand<string, "BuildCandidateId">;
export type BuildListEntryId = Brand<string, "BuildListEntryId">;
export type ProductionPlanId = Brand<string, "ProductionPlanId">;
export type PlanStepId = Brand<string, "PlanStepId">;
export type ExecutionHistoryId = Brand<string, "ExecutionHistoryId">;
export type IntermediateStateGroupId =
  Brand<string, "IntermediateStateGroupId">;
export type IntermediateStateOpportunityId =
  Brand<string, "IntermediateStateOpportunityId">;
```

DB保存時は通常のstringとして保存してよい。

## 3.2 ISO Date

```ts
export type ISODateTimeString = string;
```

不変条件。

- `createdAt` は作成時に設定し、更新しない
- `updatedAt` はユーザー操作または再計算で内容が変わったときに更新する
- 時刻はローカル時刻ではなくUTC ISO文字列で保存する

## 3.3 Master ID

```ts
export type WeaponTypeId = string;
export type ElementId = string;
export type BonusTypeId = string;
export type BonusRankId = string;
export type SeriesSkillId = string;
export type GroupSkillId = string;
export type MaterialId = string;
```

マスターIDは必ず `MASTER_DATA.md` に定義された存在するIDを参照する。

## 3.4 KnownValue

RNG状態は項目ごとの部分確定を許可する。

```ts
export interface KnownValue<T> {
  value: T | null;
  isConfirmed: boolean;
  source: RngStateSource | null;
}
```

不変条件。

- `isConfirmed = true` の場合、`value` は `null` ではない
- `value = null` の場合、`isConfirmed` は `false`
- 未確定の候補値を保持する場合でも、確定値として予測へ渡さない

## 3.5 CalculationContext

計算結果を生成した環境を追跡する共通型。

```ts
export interface CalculationContext {
  gameVersion: string;
  masterDataVersion: number;
  rngEngineVersion: string;
  appSchemaVersion: number;
}
```

同一性比較は4項目すべてで行う。変更後の互換性が明示的に保証されない限り、以前のBuildCandidate、BuildListEntry、ProductionPlanはstaleとして扱う。

B5-F1はCandidate classification / Search calculation semanticsを変更したため、
`CalculationContext.appSchemaVersion` を1から **2** へ更新した。その後、Plannerの
physical action sharing semantics修正によりversionを **3** へ、共有Counter通過時の
Route prefix silent fast-forward修正によりversionを **4** へ、探索上限で打ち切られた
partial resultを実行可能ProductionPlanとして受け入れないartifact validity境界により
versionを **5** へ更新した。
Target妥協条件改訂でversionは **6** になり、保護武器の全性能変更禁止と操作0候補の導入で
versionは **7** になった。`OwnedWeapon.relatedTargetWeaponIds` を廃止しTarget側の
`preferredOwnedWeaponId` へ置き換えた改訂でversionは **8** になった。所持武器を素材として
消費するモデルの廃止と、`OwnedWeapon.status` の管理ラベル化は、active RouteOperation set、
Planner inventory semantics、Planner scoring、PlanStep operation set、OwnedWeapon semantic
hash契約を変更するため、versionは **9** になった。
独立したPractical Candidateを廃止し、canonical Ideal Route上のselectable compromise
checkpointへ再設計した改訂は、Candidate出力形状、Candidate分類、Build Listの計画入力、
Planner fast-forward / conflict semanticsをすべて変更するため、versionは **10** になった。
1本の固定操作列のstrict prefix checkpointを、Skill lane / Bonus laneごとのintermediate state
（`BuildCandidate.intermediateStateGroups`）と、laneごとの選択＋改善優先
（`BuildListEntry.intermediateStateSelection`）へ置き換え、PlannerがRouteをlane単位で
interleaveする改訂は、Candidate出力形状、Build Listの計画入力、Planner Route実行semantics、
PlanStep milestone / PlanConflict participantの形状をすべて変更するため、versionは
**11** になった。Execution lifecycle改訂の計算意味（下記）を切り替えた実装PRで現行versionは
**12** である。version 10の `checkpointGroups` / `selectedCheckpointOpportunityIds` は
1本の操作列のindexで表現されており、lane pinへ変換できない。選択を「なし」と読めばhard
constraintを黙って捨てることになるため、旧1..10の全計算artifactは非互換とする。
以下の2..5互換例外は歴史的契約でありversion 6以降には適用しない。Plan開始effect（version 13）は
ProductionPlanの実行意味だけを変えたため、build結果に限りversion 12 -> 13の明示的互換例外を持つ。
Production Plannerの決定的scheduler切替（version 14）もProductionPlanの計算意味だけを変えたため、
build結果に限りversion 12 / 13 -> 14の明示的互換例外を持つ。予測Normal creationのCounter進行用forgeの
silent fast-forward（version 15、Issue #129）もProductionPlanの計算意味だけを変えたため、build結果に限り
version 12 / 13 / 14 -> 15の明示的互換例外を持つ（本節末尾、いずれもProductionPlanには適用しない）。
現行versionの単一authorityは `src/domain/models/common.ts` の
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 15` とし、Search、BuildList、Plannerと
benchmark入力のruntime creatorで共用する。永続モデル移行は独立してDexie
`DATABASE_SCHEMA_VERSION`（現行9。14.2）で管理し、AppSettingsは独立した `schemaVersion`（現行2。13）を持つ。Calculation semantics / artifact
validity境界とDexie schemaは別の概念であり、片方の更新はもう片方の更新を意味しない。
gameVersion、Master Data versionは維持する。
`PRODUCTION_RNG_ENGINE_VERSION` はこのcheckpoint境界では `production-rng:c5-e2` のまま維持し、
その後の通常アーティア抽選上限修正（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1）で `production-rng:c5-e3` へ、
さらに近接武器Melee support拡張（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.14）で
`production-rng:c5-e4` へ、弓のNormal Table A / B分類修正（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.15）で
`production-rng:c5-e5` へ、スラッシュアックスのNormal Production activation（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）で
`production-rng:c5-e6` へ、巨戟Reset Bonusesのfamily availability / 斬れ味・装填family上限2（[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1）の
実装（PR-B）で現在の `production-rng:c5-e7` へ更新した。いずれの修正もappSchemaVersionを上げず、`rngEngineVersion` の差だけで
旧BuildCandidate / BuildListEntry / ProductionPlanを `calculation_context_changed` にする。
Table A / BはNormal Counterを分けない: `NormalArtianCounter` のID、persisted shape、Counter semanticsは変更していない。
スラッシュアックスのsupport activationでも `weapon.switch_axe:8` の1本のCounterのままであり、
`NormalArtianCounter` persisted shape / DB schemaは変更していない。

version 1の既存BuildCandidate / BuildListEntry / ProductionPlanはversion 2以降とCalculationContext
非互換であり、現行計算結果として再利用しない。BuildListEntryは既存のstale再判定で
`calculation_context_changed` を付け、Planner入力から除外する。旧Candidateのcategoryや
Snapshotを自動変換せず、削除migrationも追加しない。必要なCandidateは再検索して取得する。
歴史データの形式検証・Export/Import契約は変更しない。

version 3は、version 2で生成されたProductionPlanが別々のEntry-local transient Gogmaに対する
Reset / Keepを同一physical actionとして共有し得たことを失効させるPlanner-onlyの境界である。
version 2 ProductionPlanはversion 3以降のruntimeで `calculation_context_changed` として扱い、
Worker preparation、what-if、実行へ進めず再計算を要求する。保存済みPlanのStepやstatusを
読取時に書き換えず、exact persisted表示は維持する。

version 4は、共有Counter位置を通過したRoute prefixのsilent fast-forwardを失効境界とする
Planner-onlyの境界である（`docs/PLANNER_SPEC.md` 7.0.2）。version 3 ProductionPlanは、
共有Counter位置を競合として保存し、通過済みprefixを持つEntryを `counter_before_current`
としてPlanから除外している可能性がある。保存済みStepは物理的に実行可能なままだが、その
`conflicts` と `rejectedBuildListEntries` はcurrent calculationが生成しない判断であるため、
version 4で互換とみなしてはならない。version 3 ProductionPlanもversion 4 runtimeで
`calculation_context_changed` として扱い、同じfail-closed比較とexact persisted表示の
ルールを適用する。

version 5は、`PlannerOptions` boundで打ち切られたpartial search resultを実行可能な
ProductionPlanとしてPersistenceしないartifact validity境界である
（`docs/PLANNER_SPEC.md` 7.2.1）。version 4以前のruntimeでは、Beam Searchが
`maxExpandedStates` などで打ち切られても `bestComplete ?? bestPartial` から
partial ProductionPlanが通常のDraftとして保存され得た。実ユーザーケースでも、
2 Targetのうち1 Targetだけを確保する24 step Planがversion 4で保存可能だった。

永続化された `ProductionPlan` は `PlannerSearchTermination` を保持しないため、
保存済みversion 4 Planがcomplete search由来かpartial search由来かを後から判別できない。
ProductionPlanの互換判定はCalculationContextの完全一致であり、判別できない以上
current runtimeで安全に互換保証できない。したがってversion 4 ProductionPlanは
個別判定せず一括でstaleとする。version 4 ProductionPlanもversion 5 runtimeで
`calculation_context_changed` として扱い、Worker preparation、conflict interaction、
what-if、実行準備、実行へ進めず再計算を要求する。保存済みStep、status、conflicts、
rejectedBuildListEntriesをread migrationで書き換えず、exact persisted表示は維持する。

version 5時点ではCandidate Search semanticsとBuildListEntry snapshot semanticsはversion 2から変更していなかったため、
version 2、3、4のBuildCandidate / BuildListEntryは、gameVersion、masterDataVersion、
rngEngineVersionがすべて同じversion 5 runtimeに限り明示的に互換とする。BuildListEntryの
stale再判定はこのartifact-specific例外を適用し、`calculation_context_changed` を付けない。
これはversion 2 / 3 / 4 ProductionPlanへ適用せず、version 1へも適用せず、
将来versionへの一般的な前方互換も意味しない。

Planner Plan quality preference（7.3のweapon switch最小化）は、実行可能なPlanの意味を
変えず、同等にcorrectな複数Planのうちどれを優先するかだけを変える。既存version 4
ProductionPlanは現行Plannerより武器切替が多くても物理的・意味的に実行可能なままなので、
これはCalculationContext境界ではなく、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を
更新しない。

version 5はartifact validity境界であって、Beam Searchの展開、評価、Conflict検出、
Trace Replay、PlanStep生成、`ProductionPlan` 永続形状のいずれも変更していない。
同じ `PlannerInput` から生成されるPlanの内容は従来と同一であり、変わったのは
その結果を実行可能artifactとして受け入れるかどうかだけである。それでもversionを
上げるのは、判別できない旧artifactをfail closedにする手段が他にないためである。

旧artifactへのfail closedと、新しく計算されたresultへのfail closedは別々に必要であり、
両方を維持する。

```text
version 5                     旧schema 4 ProductionPlanへのfail closed
termination.status incomplete 新規計算resultへのfail closed
```

`PlannerResultPersistenceService` の `termination.status === "incomplete"` 拒否は
schema versionを上げても削除しない。

version 5への更新時にはDATABASE_SCHEMA_VERSION = 1、AppSettings.schemaVersion = 1、
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2を変更しなかった。
今回のTarget移行ではDBだけ独立して2へ上げ、RNG結果は変更しない。

`PlannerSearchTermination` はruntime result metadataであり、
`ProductionPlan`、`PlanStep`、`BuildListEntry`、Dexie schemaへ永続化しない。

Execution lifecycle改訂（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16章）は、Target lifecycle、
OwnedWeapon execution lifecycle、`preferredOwnedWeaponId` のstaleness semantics
（`createTargetDefinitionHash()` の正規化対象）、PlanStep / reserve semantics、Expected execution
state、Undo対象範囲を変更する。本改訂は仕様確定だけであり、実コードの
`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`ExportRoot.schemaVersion` は
変更していない。後続実装PRで現行schemaとImport互換を監査し、必要なversion境界を確定する。
既存データを推測migrationして意味を変えてはならない。

この改訂の最初の実装PR（Execution lifecycle永続Entity基盤）では、TargetWeapon lifecycle、OwnedWeapon `executionInProgress`、`ExecutionSavePoint` の永続形状を追加し、Dexie `DATABASE_SCHEMA_VERSION` を5へ、`ExportRoot.schemaVersion` を7へ更新した（14.2 / 15）。このPRはCandidate / Planner / PlanStep / expected stateの計算意味と `createTargetDefinitionHash()` の正規化をまだ切り替えないため、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` は11のまま維持する。計算artifactのversion境界は、hash正規化、planning-input hash、ExpectedPlanStateのTarget追跡、PlanStep `executionEffects`、reserve semanticsを実装する後続PRでまとめて切る。

2番目の実装PR（Execution Plan契約）で `CURRENT_CALCULATION_APP_SCHEMA_VERSION` を **12** へ更新した。version 12の意味は次のとおりである。

- `createTargetDefinitionHash()` をTarget性能定義だけの正規化へ切り替えた（`priority`、`isEnabled`、`preferredOwnedWeaponId`、lifecycleを除外。PLANNER_SPEC 16.11）
- `PlanningInputSnapshot.targetWeaponsHash` をplanning-input専用正規化へ切り替え、`dependentTargetDefinitionsHash` / `dependentBuildListEntriesHash` を追加した（11.2）
- `ExpectedPlanState.targetExecutionStateHash` とobservation binding tokenを追加した（11.2）
- `PlanStep.executionEffects` を追加し、current ProductionPlanから独立 `reserve_weapon` Stepを除き、操作0 Idealを `confirm_owned_ideal` とした（11.3）
- execution projectionで追跡OwnedWeaponのIDを維持し（所持Normalの巨戟化も同一ID）、Counter進行用Normalと作成対象Normalを区別し、blind作成対象を観測値でbindし、完成時に既存武器も保護する（PLANNER_SPEC 16.3 / 16.13）

version 11以前のBuildCandidate / BuildListEntry / ProductionPlanは内容を保持したまま `calculation_context_changed` でfail closedにする。旧Planへ `executionEffects` を推測付与する、`reserve_weapon` を物理Stepへ合成する、追跡武器やobservation bindingを推測する変換は行わない。Dexieのtable / indexは変更しないため `DATABASE_SCHEMA_VERSION` は5のまま、ProductionPlanの永続形状が変わるため `ExportRoot.schemaVersion` は8へ更新した（15）。Production RNG semanticsと `PRODUCTION_RNG_ENGINE_VERSION` は変更していない。ProductionPlanの `abandonmentReason` / `abandonedAt` / `completedAt`（11.1）は、それを遷移させるExecution runtimeのPRで導入する。

`CURRENT_CALCULATION_APP_SCHEMA_VERSION` **13** は、既存OwnedWeaponを起点にするEntryのTarget紐付けを、
Entryの最初の物理Step確定からPlan開始effect（`draft -> active` と同じtransaction、PLANNER_SPEC 16.2 /
16.11）へ移した。Draftの生成・保存・表示では永続状態を変更せず、`PlanningInputSnapshot.initialExecutionState`
はPlan開始前の前提、先頭Stepの `expectedStateBefore` はPlan開始effect適用後の状態になる（11.2）。
PlanStepの `executionEffects.targetLinks` はPlan内で新規登録する作成対象Normalの登録Stepだけが持つ。
version 12のPlanはStepでの紐付けを前提とした期待状態を持ち、新しい開始処理で実行すると自身の期待状態と
食い違うため、version 1..12のProductionPlanは互換扱いせず `calculation_context_changed` でfail closedに
する（Planの互換判定は従来どおり4 fieldの完全一致）。一方、version 13の変更はProductionPlanの実行意味だけで
あり、Candidate Search、BuildCandidate、BuildListEntry snapshot、途中採用状態の選択、改善優先の意味は
変えていないため、build-result互換判定（`isBuildResultCalculationContextCompatible()`）に明示的な
`13 -> [12]` 例外を追加し、version 12のBuildCandidate / BuildListEntryはversion 13でそのまま利用できる
（gameVersion、masterDataVersion、rngEngineVersionの一致と通常のstaleness判定は引き続き必要）。
version 1..11のbuild結果は従来どおり非互換である。Plan開始effectは選択Entryから導出し永続fieldを追加しないため、Dexie
`DATABASE_SCHEMA_VERSION` は6、`ExportRoot.schemaVersion` は9のままである。

`CURRENT_CALCULATION_APP_SCHEMA_VERSION` **14** は、通常Plannerの計算方式を上限付きBeam Searchから
Route commitment + 決定的schedulerへ切り替えた（Issue #103 Phase C、
[ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md](./ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md) 15.2 / 15.3、
PLANNER_SPEC 7）。同じPlannerInputに対して、未解決競合の暫定帰結、返す `conflicts`、
`rejectedBuildListEntries`、Step順、共有physical actionで進むEntry、Planner側の優先起点preference（撤去）が
変わり得る。永続ProductionPlanは生成方式を記録しないため、version 13のPlanの内容がBeam Search由来か
scheduler由来かを判別できない。

| artifact | version 14 runtimeでの扱い |
| --- | --- |
| ProductionPlan version 1..13（draft / activeを問わない） | 非互換。`calculation_context_changed` でfail closedし、Worker準備、競合操作、what-if、作成開始、実行準備、実行へ進めない。exact persisted内容の表示は維持し、read migrationやversion書き換えはしない。実行中（`active`）のPlanは現在地点からの再計画（PLANNER_SPEC 16.8）が必要。Planの互換判定は従来どおり4 field完全一致で、Plan向けの例外は無い |
| BuildCandidate / BuildListEntry version 12 / 13 | 明示的なbuild-result例外 `14 -> [12, 13]` により互換。gameVersion、masterDataVersion、rngEngineVersionの一致と通常のstaleness判定は引き続き必要 |
| BuildCandidate / BuildListEntry version 1..11 | 従来どおり非互換 |

例外は明示mapだけで表し、「12以上なら互換」のような範囲判定や将来versionへの推移的適用はしない。
永続形状は変えないため、Dexie `DATABASE_SCHEMA_VERSION` は8、`ExportRoot.schemaVersion` は11、
`RngState.schemaVersion` は2、`AppSettings.schemaVersion` は1、`PRODUCTION_RNG_ENGINE_VERSION`
（`production-rng:c5-e7`）とMaster dataVersionも変更しない（いずれも当時）。migrationは追加しない。

現行の `CURRENT_CALCULATION_APP_SCHEMA_VERSION` **15** は、予測 `create_normal_artian(count = N)` の
先頭N - 1本（Counter進行用forge）を `canSkipWhenCounterPassed` にし、同じNormal Counter位置を別Entryの
実forgeが通過したときsilent fast-forwardする（Issue #129、PLANNER_SPEC 7.0.2）。作成対象forge
（最終unit）とblind createは引き続き必須であり、Normal creationはphysical action sharingにしない。
同じPlannerInputに対して、`conflicts`（中間forgeを含む `same_normal_counter` が生成されなくなる）、選択・
不採用Entry、Step列、Route progress、完成結果が変わり得る。

| artifact | version 15 runtimeでの扱い |
| --- | --- |
| ProductionPlan version 1..14（draft / activeを問わない） | 非互換。`calculation_context_changed` でfail closedし、Worker準備、競合操作、what-if、作成開始、実行準備、実行へ進めない。exact persisted内容の表示は維持し、read migrationやversion書き換えはしない。実行中（`active`）のPlanは現在地点からの再計画（PLANNER_SPEC 16.8）が必要。Planの互換判定は従来どおり4 field完全一致で、Plan向けの例外は無い |
| BuildCandidate / BuildListEntry version 12 / 13 / 14 | 明示的なbuild-result例外 `15 -> [12, 13, 14]` により互換。gameVersion、masterDataVersion、rngEngineVersionの一致と通常のstaleness判定は引き続き必要 |
| BuildCandidate / BuildListEntry version 1..11 | 従来どおり非互換 |

永続形状は変えないため、Dexie `DATABASE_SCHEMA_VERSION`（9）、`ExportRoot.schemaVersion`（12）、
`AppSettings.schemaVersion`（2）、`RngState.schemaVersion`（2）、`PRODUCTION_RNG_ENGINE_VERSION`
（`production-rng:c5-e7`）、Master dataVersionは変更しない。migrationは追加しない。

---

## 4. Enum

```ts
export type RngStateSource =
  | "manual"
  | "observation";

export const V1_NORMAL_ARTIAN_RARITY = 8 as const;
export type NormalArtianRarity = typeof V1_NORMAL_ARTIAN_RARITY;

export type ArtianWeaponKind =
  | "normal"
  | "gogma";

export type OwnedWeaponStatus =
  | "unclassified"
  | "practical"
  | "ideal";

export type RouteKind =
  | "normal_artian_to_gogma"
  | "owned_normal_artian_to_gogma"
  | "existing_gogma_current"
  | "existing_gogma_reset_bonuses"
  | "existing_gogma_keep_bonuses"
  | "existing_gogma_reset_skills"
  | "existing_gogma_mixed";

export type SkillMatchMode =
  | "all"
  | "any";

export type TargetWeaponLifecycleStatus =
  | "active"
  | "completed";

export type ProductionPlanStatus =
  | "draft"
  | "active"
  | "completed"
  | "stale"
  | "abandoned";

export type ProductionPlanAbandonmentReason =
  | "user_abandoned"
  | "replan_adopted"
  | "finished_as_compromise"
  | "breaking_change_approved";

export type PlanStepOperationType =
  | "create_normal_artian"
  | "convert_normal_to_gogma"
  | "reset_bonuses"
  | "keep_bonuses"
  | "reset_skills"
  | "confirm_owned_ideal"
  // legacy: current Plannerは生成しない（PLANNER_SPEC 16.3）
  | "reserve_weapon"
  | "confirm_result";

export type ExecutionAction =
  | "confirmed_expected"
  | "actual_result_different"
  | "operation_uncertain"
  | "operation_count_recovered"
  | "finished_as_compromise"
  // legacy: 独立した確保Stepを持つ旧Planだけに現れる
  | "secured_weapon"
  | "skipped_candidate";

export type RecalculationReason =
  | "rng_state_changed"
  | "normal_counter_changed"
  | "target_changed"
  | "build_list_changed"
  | "owned_weapon_changed"
  | "calculation_context_changed"
  | "unexpected_result"
  | "execution_operation_uncertain"
  // legacy: 独立した確保Stepを持つ旧Planだけに現れる
  | "planned_candidate_not_secured"
  | "different_candidate_secured"
  | "planned_status_change_declined"
  | "manual_recalculate";

export type ConflictKind =
  | "same_gogma_counter"
  | "same_skill_counter"
  | "same_normal_counter"
  | "same_owned_weapon_consumed";
```

`TargetWeaponLifecycleStatus`、`ProductionPlanAbandonmentReason`、`confirm_owned_ideal`、
`operation_uncertain`、`finished_as_compromise`、`execution_operation_uncertain` はExecution
lifecycle改訂（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16章）で追加する仕様上の値である。
`TargetWeaponLifecycleStatus` は永続Entity基盤PR、`confirm_owned_ideal` はcalculation schema 12の
Execution Plan契約PRでコードへ反映した。`ProductionPlanAbandonmentReason`、`operation_uncertain`、
`finished_as_compromise`、`execution_operation_uncertain` のliteralはExecution runtime core PRでコードへ反映し、
`actual_result_different` / `operation_uncertain` の記録Runtimeは想定外結果Runtime PRで実装した。
最新ExecutionHistoryのUndo RuntimeはUndo Runtime PRで、ゲーム内セーブ地点（12.1）の記録 / 復元Runtimeはセーブ地点Runtime PRで実装した。`finished_as_compromise` のRuntimeは妥協品終了Runtime PRで、`user_abandoned` のPlan破棄と破棄時のゲーム内セーブ地点選択（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.10）のRuntimeはPlan破棄Runtime PRで実装した。`operation_count_recovered`（操作内容不明後に同じ操作の連続区間内で現在位置を一意に特定して追従した記録、
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15）はExecution Recovery PRで追加した。既存fieldだけを使う
literal追加であり、Dexie / Export / calculation schemaのversionは変えない（PLANNER_SPEC 16.17）。
legacy値は保存済みartifactの読み取り互換のためだけに残し、current Executionは
生成しない。

---

## 5. 復元ボーナス型

## 5.1 RestorationBonus

```ts
export interface RestorationBonus {
  bonusTypeId: BonusTypeId;
  bonusRankId: BonusRankId;
}
```

不変条件。

- `bonusTypeId` は対象武器種で利用可能なBonusTypeである
- `bonusRankId` は対象武器種とBonusTypeで利用可能なRankである
- Target条件、Candidate completion、semantic identityなど、完成5枠を比較する契約では
  `bonusTypeId + bonusRankId` のmultisetとして順不同で比較する
- 一方、保存された `RestorationBonusSet` のslot順は保持する。Gogma Keepは各slot位置の
  familyを保持してtierを再抽選するため、slot順は将来のKeep prediction入力として意味を持つ
- したがって保存データをmultiset順へsort / normalizeしてはならない。正規化は比較処理の
  内部に閉じ、永続化された配列順へ書き戻さない

## 5.2 RestorationBonusSet

```ts
export type RestorationBonusSet = [
  RestorationBonus,
  RestorationBonus,
  RestorationBonus,
  RestorationBonus,
  RestorationBonus
];
```

不変条件。

- 必ず5要素
- `null` 要素を含めない
- 完成5枠の同一性比較は `bonusTypeId + bonusRankId` の個数で判定する
- slot順自体が意味を持つ契約（Keep prediction入力、およびその予測結果を説明する
  `BuildCandidate.bonusAmendmentTrace`）では、slot 1 - 5をそれぞれ
  `bonusTypeId` / `bonusRankId` まで一致確認する。multiset比較で代用しない

---

## 6. RNG状態

## 6.1 RngState

アプリ全体で1件のみ保存する。

```ts
export interface RngState {
  id: "current";
  schemaVersion: 2;
  baseSeed: KnownValue<string>;
  gogmaCounter: KnownValue<number>;
  skillCounter: KnownValue<number>;
  counterGate: KnownValue<number>;
  notes: string | null;
  lastIdentifiedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

制約。

- `id` は常に `"current"`
- `schemaVersion` は2。version 2は `lastIdentifiedAt`（Identification provenance）を追加した形状である
- `lastIdentifiedAt` は、現在のBase Seed / Skill Counter / Gogma Counterを正式なIdentification結果として採用した
  時刻（[RNG_SPEC.md](./RNG_SPEC.md) 9.9のadoption）であり、採用が記録されていなければ `null`。
  Identification Adoption Serviceだけが書き、RNG Setupの通常保存（値の編集、確定変更、notes、Counter Gate）、
  Debug編集、ゲーム内セーブ地点の記録、Execution Stepは書き換えない。手動編集後の値は `source = manual` になる
  ため、「Identification結果のまま」かどうかは `lastIdentifiedAt` と3値の `source` / `isConfirmed` の組で判定する
  （[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15）
- `lastIdentifiedAt` はreminder / recovery用のprovenance metadataであり、Calculation semanticsではない。
  `searchStateHash`、`ExpectedPlanState.rngStateHash`、Candidate / BuildListEntry identity、CalculationContextに
  含めない
- `baseSeed.value` はUI入力では10進文字列または16進文字列を受け付けてもよいが、内部保存形式はRNG実装で定める正規化文字列に統一する
- Counterの確定値は0以上の整数
- 各項目の確定状態と取得元は独立して保持する
- RngState全体の `isConfirmed` は持たない
- `gogmaCounter` / `skillCounter` はDomainが追跡するCounterであり、Counter Gate適用後のeffective PRNG blockを保存しない。Gate未満の保存Counter内部挙動は未確認のため推測migrationしない
- `counterGate` はlegacy / manual compatibility、将来のExport / Import round-trip、diagnostic / reference情報のために保持する。v1でschema migrationまたはfield削除を行わない
- `counterGate.value` と `counterGate.isConfirmed` はProduction Skill / Gogma Prediction、Candidate Search、Planner、Trace Replayのavailabilityまたは結果のsemantic authorityにしない
- Identification adoptionはBase Seed、Skill Counter、Gogma Counterのsourceを既存の `observation` とし、`counterGate`を変更しない。新しい `identified` sourceはv1必須ではない

Capabilityは保存せず、現在値と実行対象から純粋関数で導出する。

```ts
export interface RngCapabilities {
  canPredictGogma: boolean;
  canPredictSkills: boolean;
  canSearchNormalArtian: boolean;
  normalArtianSearchableCounterIds: string[];
  canRunPlanner: boolean;
  missingRequirements: string[];
}

deriveRngCapabilities(
  rngState: RngState,
  normalCounters: NormalArtianCounter[],
  requiredOperations: RouteOperation[],
  engineCapabilities: RngEngineCapabilities
): RngCapabilities;
```

基本依存関係。

- Gogma予測は確定済みBase Seed、Gogma Counter、EngineのGogma Prediction support、concrete semantic input / Master supportを要求する。persisted Counter Gateは要求しない
- Skill予測は確定済みBase Seed、Skill Counter、EngineのSkill Prediction support、concrete semantic input supportを要求する。persisted Counter Gateは要求しない
- 通常アーティア予測は確定済みBase Seed、対象武器種のレア8 NormalArtianCounter、EngineのNormal Artian Prediction supportを要求する
- conversionはSkill予測の依存だけを要求し、Gogma予測またはGogma Counterを要求しない
- Reset BonusesはGogma予測、Keep BonusesはGogma予測とKeep supportを要求する
- conversion後のReset / Keepを含むRouteではOperationごとの依存を合成し、Route全体を実行できる場合だけ有効にする
- PlannerはBuildListEntry内の全RouteOperationを実行できるCapabilityがある場合のみ実行可能
- 不足値に依存するRouteだけを無効化し、他Routeは利用可能なままにする
- `missingRequirements` は未確定RNG値、Engine support不足、source不足を同じ曖昧な文字列へ潰さず、呼び出し側が別reasonへ変換できる識別子を保持する

## 6.2 NormalArtianCounter

v1で管理するレア8通常アーティアの現在位置を、武器種ごとに1件保存する。レア6・7は管理・検索対象外とする。`counter` は「次にforgeされる結果の0-based block index」であり、消費済みforge数や最後に消費したindexではない。

```ts
export interface NormalArtianCounter {
  id: string;
  weaponTypeId: WeaponTypeId;
  rarity: NormalArtianRarity;
  counter: number | null;
  isConfirmed: boolean;
  observationCount: number;
  lastObservedAt: ISODateTimeString | null;
  candidateCount: number | null;
  lastIdentifiedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

ID規則。

```ts
id = `${weaponTypeId}:${rarity}`;
```

不変条件。

- 同じ `weaponTypeId + rarity` は1件のみ
- v1の `rarity` は必ず8。IDは `${weaponTypeId}:8` とし、有効武器種14件について最大14件を管理する
- `isConfirmed = true` の場合、`counter` は0以上の整数
- `isConfirmed = false` の場合、通常アーティア経由の候補検索には使わない
- `candidateCount` は観測検索時の残候補数。未検索なら `null`
- `lastIdentifiedAt` は、現在の `counter` 値をunique Normal Counter Identification結果として正式確定した時刻
  （[UI_FLOW.md](./UI_FLOW.md) 6）であり、そうでなければ `null`。Identification確定の保存経路だけが書く。
  手動 / Debug保存で `counter` 値を変更した場合は `null` へ戻し、値を変えない保存（確定 / 確定解除、観測数の編集）
  では保持する。`lastObservedAt` / `candidateCount` / `isConfirmed` はDebug編集で任意に書けるためprovenanceの
  証明にはならない。reminder / recovery用のprovenanceであり、`normalCountersHash` / `searchStateHash` /
  Calculation semanticsに含めない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15）

候補位置の正式な関係は次のとおり。

```text
candidateOffset = 0:
  candidateCounter = normalCounterBefore
  forgeCount = 1

candidateOffset = k:
  candidateCounter = normalCounterBefore + k
  forgeCount = k + 1

candidateCounter = normalCounterBefore + forgeCount - 1
```

---

## 7. 所持アーティア

## 7.1 OwnedWeapon

```ts
export interface OwnedWeaponBase {
  id: OwnedWeaponId;
  kind: ArtianWeaponKind;
  name: string;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  restorationBonusScope: ArtianBonusScope;
  restorationBonuses: RestorationBonusSet;
  isProtected: boolean;
  /**
   * Execution lifecycle改訂で追加する作成中状態（PLANNER_SPEC 16.10.1）。
   * null = 作成中ではない。ユーザーは直接編集できない。
   */
  executionInProgress: OwnedWeaponExecutionInProgress | null;
  memo: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

// OwnedWeaponはTargetWeaponを参照しない（8.5）ため、Target IDは持たない。
// 表示用の目標武器名はPlanの追跡情報またはTarget側の preferredOwnedWeaponId から導出する。
export interface OwnedWeaponExecutionInProgress {
  productionPlanId: ProductionPlanId;
  startedAt: ISODateTimeString;
}

export interface OwnedNormalArtianWeapon extends OwnedWeaponBase {
  kind: "normal";
  rarity: 8;
  seriesSkillId: null;
  groupSkillId: null;
  status: null;
}

export interface OwnedGogmaArtianWeapon extends OwnedWeaponBase {
  kind: "gogma";
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  status: OwnedWeaponStatus;
}

export type OwnedWeapon =
  | OwnedNormalArtianWeapon
  | OwnedGogmaArtianWeapon;
```

不変条件。

- `kind` で通常アーティアと巨戟アーティアを明示的に区別する
- 通常アーティアはレア8に限定し、`restorationBonusScope = "normal_artian"` の復元ボーナスだけを5枠保持し、シリーズスキル、グループスキル、statusは持たない
- 巨戟アーティアは `restorationBonusScope = "normal_artian" | "gogma_artian"` を許可し、scopeに対応する復元ボーナス5枠とSeries Skill / Group Skill / statusを保持する
- 通常→巨戟化直後は通常アーティアの5枠とslot順を変更せず、`restorationBonusScope = "normal_artian"` の巨戟アーティアになる。巨戟Rank I等への暗黙変換は行わない
- `normal_artian` scopeを持つ巨戟アーティアへの最初のBonus amendmentは、実ゲームでもDomainモデルでもReset / Keepのどちらも許可する。所持巨戟の5枠は既知であり、Keep familyは各slotの `bonusTypeId`（通常側はArtianBonusTypeMappingで巨戟側へ正規化）から解決する([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.9参照)。Reset / Keepのどちらの結果も5枠全体とscopeを `gogma_artian` へ置き換え、以後もReset / Keepの両方を許可する
- 1本の武器の5枠はすべて `restorationBonusScope` と一致させ、normal / gogma scopeを混在させない
- 属性強化を保持できるかは、`ElementMaster.allowsElementBonus` 単独ではなく、Masterの武器種・scope定義と、武器種 × 抽選テーブル区分のProduction family availability（[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1 / 6.3.1）の積で決める（PR-Cで実装済み。[MASTER_DATA.md](./MASTER_DATA.md) 15.1）。スラッシュアックスの無属性構成（`element.none`）は属性強化を保持でき、弓の毒・麻痺・睡眠とライト／ヘビィボウガンは属性強化を保持しない。Entity Validation（`validateOwnedWeaponMasterReferences()` / `validateTargetWeaponMasterReferences()`）は、所持武器の復元ボーナス5枠と、目標武器の理想5枠・実用条件・代替候補をこのavailabilityで検証する
- 旧UI / Validationで保存できた、Production availability外の復元ボーナス（例: 弓 / 毒の属性強化）を持つ既存データは **non-destructive load + fail-closed save** で扱う。schema migrationを行わず、load / Import時に自動削除・別bonusへの自動置換・silent normalizeをせず、既存entityを読み込み・表示できる状態を保つ。編集UIはその値を「現在値・Production抽選対象外」として認識できるように表示するが、通常の選択肢として提示せず新規に選択できない。保存しようとした場合はEntity Validationが明示的に拒否し、ユーザーに修正を促す。この扱いはSearch / Planner algorithmとKeep RNG semanticsを変更しない
- statusにかかわらず `restorationBonuses` は必ず5枠保持する
- `status` はユーザーが所持武器を整理するための管理ラベルだけを意味する。Plannerの操作可否、
  Search Route eligibility、Target Satisfactionをstatusから決定しない
- 手動で新規登録する巨戟アーティアの初期値は `status = "unclassified"`、`isProtected = false`
- Executionが作成対象Normalを登録する場合は `status = null`、`isProtected = false`、巨戟化Stepの確定で
  `status = "unclassified"` とする（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.3）
- Executionで選択済み妥協checkpointへ到達した場合は `status = "practical"` とし、保護は変更しない。
  理想品が完成した場合は、新規生成武器でも既存武器でも `status = "ideal"`、`isProtected = true` とする
  （同 16.12 / 16.13）
- `isProtected = true` はPlanner / Candidate Searchによる武器性能の変更から武器を保護する
- `isProtected = true` の武器を、Reset Bonuses、Keep Bonuses、Reset Skillsの対象にしない
- statusと保護は独立したユーザー設定であり、既存保存値をmigrationまたはstatus変更だけで暗黙変更しない
- 通常アーティアの新規保護初期値はfalseとし、ユーザーが手動で保護できる
- 保護中の通常アーティアは巨戟化Routeの変換元にしない
- Plannerに保護武器の消費を許可するoverride設定は持たない
- statusを書き換える経路は、Owned Weapons画面の通常CRUDと、Execution Step確定（巨戟化時の
  `unclassified`、選択済み妥協checkpoint到達時の `practical`、理想品完成時の `ideal`）だけとする。
  Planner計算はstatusを永続化しない。性能が条件を満たしただけでは自動でPractical / Idealにしない。
  Material化のためのstatus変更と `change_owned_weapon_status` PlanStepは廃止した
- `executionInProgress` はstatusと直交したExecution内部状態であり、`status` に `in_progress` 等を
  追加しない。ONはExecutionが作成対象Normalを登録したStep、または既存武器へのそのEntryの最初の
  実ゲーム操作を確定したStep、OFFは理想品完成、妥協品として終了、Planの `completed` /
  `abandoned` 遷移とする。再計画採用では新Planが同じ武器を追跡する場合だけ新Plan IDへ
  付け替える（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.8 / 16.10.1）。ユーザーは直接編集できない
- `executionInProgress` はCandidate Searchの武器性能判断、Search route eligibility、Planner入力、
  `referencedOwnedWeaponsHash`、`ExpectedPlanState.ownedWeaponsHash` に使わない。Undoとゲーム内
  セーブ地点の復元では正確に戻す
- `status` は `name` / `memo` / timestampと同じく非semanticであり、`referencedOwnedWeaponsHash`、
  `ExpectedPlanState.ownedWeaponsHash`、constrained search identity、Planner search
  semantic inventoryのいずれにも含めない。status変更だけではBuildCandidate、
  BuildListEntry、ProductionPlanをstaleにしない。`isProtected`、`kind`、`weaponTypeId`、
  `elementId`、`restorationBonusScope`、復元ボーナス5枠、Series Skill、Group Skillは
  従来どおりsemanticである
- OwnedWeaponはTargetWeaponを参照しない。目標武器との紐づけはTarget側の
  `preferredOwnedWeaponId` が唯一のauthorityであり、向きはTarget → OwnedWeaponの一方向とする
  (8.5参照)

---

## 8. 目標武器

## 8.1 TargetWeapon

TargetWeaponは既存ID・名称・武器種・属性・priority(1..5、default 3)・isEnabled・
`preferredOwnedWeaponId`(8.5)・Ideal5枠・Skill条件・memo・日時を保持する。

Execution lifecycle改訂（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.13）で次のlifecycleを追加する。

```ts
// TargetWeaponの該当fields:
// lifecycleStatus: TargetWeaponLifecycleStatus;       // "active" | "completed"
// completedAt: ISODateTimeString | null;
// completedByProductionPlanId: ProductionPlanId | null;
```

- `active`: 未完了。検索対象ON/OFF（`isEnabled`）はactive Targetにだけ意味を持つ
- `completed`: 理想品が完成し目標武器が手に入った。通常の目標武器一覧、Candidate Search、Planner入力から
  除外する。履歴とProductionPlan参照のためレコードは保持し、物理削除しない
- `completed` にするのは、Executionの理想品完成Step確定（`completedByProductionPlanId` にPlan ID）と、
  所持武器で理想品を満たすTargetをユーザーが明示操作で完了にする場合（`completedByProductionPlanId = null`、
  [UI_FLOW.md](./UI_FLOW.md) 8.2）だけである。妥協品での終了では `completed` にしない
- `completed` Targetの `preferredOwnedWeaponId` は `null` とする
- 理想品完成で武器Xをprotectedにする場合、完成対象Targetに加えて、Xを `preferredOwnedWeaponId` に持つ
  他のすべてのTargetの `preferredOwnedWeaponId` も同一transactionで `null` にする（8.5）。他Targetの
  性能条件、`priority`、`isEnabled`、lifecycleは変更しない
- `completed` から `active` へ戻すのは、Undo / ゲーム内セーブ地点復元と、ユーザーの明示操作
  「未完了に戻す」（[UI_FLOW.md](./UI_FLOW.md) 8.2）だけである。戻しても所持武器は変更しない
- `lifecycleStatus`、`completedAt`、`completedByProductionPlanId` は性能定義ではないため
  `createTargetDefinitionHash()` の対象外とする（9.4）
- 既存データのmigrationで、所持Ideal武器の存在などからTargetを `completed` と推測しない

妥協条件の正式型は次のとおり。

```ts
interface PracticalBonusCondition {
  id: string;
  bonusTypeId: BonusTypeId;
  minimumRankId: BonusRankId;
  requiredExCount: number;
}
interface AlternativeBonusRule {
  id: string;
  sourceBonusTypeId: BonusTypeId;
  maxReplacementCount: number;
  options: AlternativeBonusOption[];
}
interface AlternativeBonusOption {
  alternativeBonusTypeId: BonusTypeId;
  minimumRankId: BonusRankId;
  requiredExCount: number;
}
// TargetWeaponの該当fields:
// practicalBonusConditions: PracticalBonusCondition[];
// alternativeBonusRules: AlternativeBonusRule[];
// compromiseNeedsReview?: boolean; // 旧条件解除の案内。明示save後false
```

### Ideal包含と未設定

Ideal5枠の種類・個数を変えず、Practicalを設定した種類だけRankを妥協する。
未設定種類はRank multiset完全一致。全枠minimum以上かつEX最低数を満たす必要があり、
Ideal自身がこのPractical条件を満たさないTargetは無効である。
AlternativeはIdealを拒否するAND条件ではなく、1 Rule / 1 Optionによる別の受理経路である。
0置換のIdealを常に先に判定するため、IdealがAlternative Optionを満たす必要はない。
明示Practical Skillの既存論理包含validationは保持する。両ID=nullは未設定であり
Practical Skillのwildcardを意味しない。妥協なしTargetではIdealだけを受理する。
すべてのBonus判定はgogma_artian scopeを要求する。

## 8.2 PracticalBonusCondition

種類はIdeal内、同一種類は1件まで。必要個数はIdeal内個数から導出し永続化しない。
minimumRankは対象武器種・属性のMasterで有効、requiredExCountは整数0..Ideal内個数。
未設定種類はRank構成を含めて完全一致。Master order / isExだけをRank / EX判定に使用する。

## 8.3 AlternativeBonusRule

sourceはIdeal内、同じsourceのRuleは1件まで。maxReplacementCountは整数1..Ideal内source個数。
optionsは1件以上、sourceとalternativeは異なり、代替先の重複は禁止。
OptionのRankはMaster上有効、requiredExCountは整数0..maxReplacementCount。
Candidateは1 Rule内の1 Optionだけで1..最大数を置換する。未置換枠はIdealの部分multisetと
完全一致し、Practical Bonusと併用しない。実際に追加された代替枠だけでRank / EXを評価する。
Idealに既存の代替先種類がある場合、その元の枠は完全一致で維持しEX数に流用しない。
詳細・監査・移行契約は[TARGET_COMPROMISE_SEMANTICS.md](./TARGET_COMPROMISE_SEMANTICS.md)。

## 8.4 SkillCondition

```ts
export interface SkillCondition {
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  matchMode: SkillMatchMode;
}
```

意味。

- `seriesSkillId = null` はシリーズスキル指定なし
- `groupSkillId = null` はグループスキル指定なし
- `matchMode = "all"` は指定された条件をすべて満たす
- `matchMode = "any"` は指定された条件のいずれかを満たす

制約。

- 理想ラインは原則 `matchMode = "all"`
- 実用ラインのみ `matchMode = "any"` を許可する
- predicate単体では両方nullは制約なし。TargetのPractical Skillとして両方nullの場合は未設定であり、Ideal Skillだけを許可する

## 8.5 preferredOwnedWeaponId

```ts
// TargetWeaponの該当field:
// preferredOwnedWeaponId: OwnedWeaponId | null;
```

このTargetを作成する際に、Candidate Search / Plannerが起点として優先したい所持武器を示す
計画入力である。

関係。

```text
TargetWeapon 0..1 -> OwnedWeapon
OwnedWeapon  0..1 <- TargetWeapon
```

- Targetは所持武器を指定しなくてよい
- 1 Targetにつき最大1 OwnedWeapon
- 1 OwnedWeaponを複数Targetへ同時に割り当ててはいけない
- 参照の向きはTarget → OwnedWeaponの一方向であり、OwnedWeapon側は相手を保持しない

選択可能条件。

- Targetと `weaponTypeId` が一致する
- Targetと `elementId` が一致する
- `isProtected = false`
- `kind` はNormal / Gogmaのどちらでもよい
- `status` は選択可否の条件にしない。非保護で互換なら `unclassified` / `practical` / `ideal` の
  いずれも選択可能であり、statusと優先起点は独立したユーザー設定とする

soft preferenceである。

- 必須Route指定ではない。Searchは従来どおり新規Normal / 所持Normal / 所持Gogmaの実行可能Route
  をすべて探索し、preferred以外のRouteを除外しない
- より短い、より低コスト、または既存評価で明確に優れたRouteがある場合はそちらを優先する
- Search / constrained enumerationでの位置づけは[SEARCH_SPEC.md](./SEARCH_SPEC.md) 8.1に従う。
  通常Planner（決定的scheduler）は優先起点を判断に使わない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7.4、
  Issue #103 Phase C）
- Target Satisfactionを制限しない。あるTargetがWeapon Xを優先起点にしていても、性能を満たす
  別のWeapon YがそのTargetを満たしてよい。1対1制約は優先起点の関係にだけ適用する
- Planner計算（Beam Search、Trace Replay、constrained re-search、what-if）、Candidate Search、
  探索内部の `reserve_weapon` がこの値を自動設定・自動付け替えしてはいけない。通常の設定は
  Target Weapons画面からのユーザー操作で行う
- 例外はExecutionだけである。Planが既存Normal / Gogmaを起点に使うEntryは、Plan開始（`draft -> active`）の
  transactionでそのTargetへ既存武器を自動設定する（Plan開始effect。Planの選択Entryから導出し、永続field
  を持たない）。新規Normal Routeの作成対象Normalは、その登録Stepの確定transactionで自動設定する
  （`executionEffects.targetLinks`）。どちらも別Targetが同じ武器を優先起点にしていればそのTargetを
  `null` にし、両方を同じtransactionで保存する。Draftの生成・保存・表示では変更しない。Plan破棄後も
  紐付けは残す（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11）
- 理想品完成（Executionのtarget completion、`confirm_owned_ideal`、Target Weapons画面の
  「この武器で目標を完了にする」）で武器Xが `isProtected = true` になる場合は、完成対象Targetと、
  Xを優先起点にしている他のすべてのTargetの `preferredOwnedWeaponId` を同一transactionで `null` にする。
  解除するのは `preferredOwnedWeaponId` だけである。完成後にXを優先起点に持つTargetが残れば
  collection validation違反としてtransaction全体をrollbackする（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.13）

staleness semanticsの分離（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11）。

```text
BuildCandidate / BuildListEntry validity
  Target性能定義として扱わない。createTargetDefinitionHash() の対象外であり、
  変更してもBuildListEntryを target_definition_changed にしない

Planner / Draft Planのplanning input
  planning inputとして扱う。PlannerInput.targetWeapons と
  PlanningInputSnapshot.targetWeaponsHash に含める

Active Plan Execution
  Execution自身による設定・付け替え・解除は正常進行であり、
  ExpectedPlanState.targetExecutionStateHash（11.2）で期待どおりか検証する
```

TargetWeapon fieldごとのhash / validation / planning inputの責務表は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11「TargetWeapon fieldの責務」を正本とする。

collection validation。TargetWeapon単体validationは構造だけを検証できるため、以下は
OwnedWeapon collectionと他Targetを参照する専用のvalidation authorityでfail closedにする。
保存Service、Candidate Search入力、Planner入力の各境界で同じ契約を再利用し、UIだけを
authorityにしない。Planner入力では、そのrunの計画対象Target（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 4.1）
だけでなく `PlannerInput.targetWeapons` 全体へ適用する。

- `preferredOwnedWeaponId` の参照先OwnedWeaponが存在しない
- 参照先の武器種がTargetと一致しない
- 参照先の属性がTargetと一致しない
- 参照先が `isProtected = true`
- 同一OwnedWeaponを2つ以上のTargetが優先起点にしている

atomic persistence。以下は途中状態を永続化してはいけない。

- 別Targetからの付け替え。承認後、旧Target `preferredOwnedWeaponId = null` と
  新Target `preferredOwnedWeaponId = Weapon X` を同一トランザクションで保存する
- 紐づけ中OwnedWeaponの保護ONまたは武器種 / 属性変更。承認後、武器の変更とTarget側の
  紐づけ解除を同一トランザクションで保存する

削除保護。`preferredOwnedWeaponId` から参照されているOwnedWeaponは、通常の参照中Entity削除
保護の対象とし、`PersistenceReferenceKind = "target_weapon"` として報告する。旧
`OwnedWeapon.relatedTargetWeaponIds` によるTarget削除時の参照は廃止する。

---

## 9. 検索候補

## 9.1 BuildCandidate

検索結果として見つかった完成候補。作成リストの選択状態は持たない。

```ts
export interface BuildCandidate {
  id: BuildCandidateId;
  targetWeaponId: TargetWeaponId;
  finalBonusScope: ArtianBonusScope;
  finalBonuses: RestorationBonusSet;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  route: BuildRoute;
  estimatedOperationCount: number;
  estimatedGogmaAdvance: number;
  estimatedSkillAdvance: number;
  // null は「このRouteのNormal Counter進行量をabsolute route dependencyとして
  // 表現しない」。通常アーティア作成を含まないRouteに加えて、blind creationだけ
  // を含むRoute(SEARCH_SPEC 6.1.1)もここが null になる。0 は「進行量0」であり、
  // null とは別の意味である。Plan実行時に確定Normal Counterが1進むかどうかは
  // 実行時stateの問題であり、この推定値とは別概念である(PLANNER_SPEC 7.0.3)
  estimatedNormalAdvance: number | null;
  requiredMaterials: MaterialRequirement[];
  idealDifference: IdealDifference;
  searchStateHash: string;
  referencedOwnedWeaponsHash: string | null;
  calculationContext: CalculationContext;
  searchRunId: string;
  createdAt: ISODateTimeString;
  bonusAmendmentTrace?: CandidateBonusAmendmentStep[];
  skillAmendmentTrace?: CandidateSkillAmendmentStep[];
  conversionSkillTrace?: CandidateConversionSkillStep;
  /**
   * このCandidate自身のRouteのSkill lane / Bonus laneに現れる受理済み途中状態。
   * 現行calculation schemaのCandidateでは必須であり、field自体が存在しない
   * 旧artifactはそのまま保持する（SEARCH_SPEC 5.8）。
   */
  intermediateStateGroups?: IntermediateStateGroup[];
}

/** Plannerが到達した妥協checkpointの両軸判定。説明情報であり判定authorityではない。 */
export interface CompromiseConditionMatch {
  bonus: "ideal" | "practical" | "alternative";
  skill: "ideal" | "practical";
}

export type IntermediateStateAxis = "skill" | "bonus";
export type IntermediateSkillMatch = "practical" | "ideal";
export type IntermediateBonusMatch = "practical" | "alternative" | "ideal";

interface IntermediateStateOpportunityBase {
  id: IntermediateStateOpportunityId;
  /**
   * そのlaneの操作を何回実行した直後の状態か。0はlane開始状態（conversionが付与した
   * 初回Skill、既存巨戟の現在Skill / 現在5枠）。常にlaneの操作数より小さい:
   * laneの終点は理想品でありintermediate stateではない。
   */
  lanePosition: number;
  /** この状態を生む `route.operations` のindex。操作を持たないlane開始状態は null。 */
  operationIndex: number | null;
}

export interface IntermediateSkillOpportunity extends IntermediateStateOpportunityBase {
  axis: "skill";
}

export interface IntermediateBonusOpportunity extends IntermediateStateOpportunityBase {
  axis: "bonus";
  /** exactなslot順。groupの代表5枠とはslot順が異なりうる。 */
  restorationBonuses: RestorationBonusSet;
  restorationBonusScope: ArtianBonusScope;
}

export type IntermediateStateOpportunity =
  | IntermediateSkillOpportunity
  | IntermediateBonusOpportunity;

/** ユーザーから見て同一のSkill状態。 */
export interface IntermediateSkillStateGroup {
  axis: "skill";
  id: IntermediateStateGroupId;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  match: IntermediateSkillMatch;
  /** lane位置の昇順。1件以上。 */
  opportunities: IntermediateSkillOpportunity[];
}

/** ユーザーから見て同一の復元ボーナス品。slot順はidentityに含めない。 */
export interface IntermediateBonusStateGroup {
  axis: "bonus";
  id: IntermediateStateGroupId;
  restorationBonusScope: ArtianBonusScope;
  /** 代表として表示する5枠。最早opportunityのslot順をそのまま使う。 */
  restorationBonuses: RestorationBonusSet;
  match: IntermediateBonusMatch;
  /** lane位置の昇順。1件以上。 */
  opportunities: IntermediateBonusOpportunity[];
  /** 表示専用のdominance。Domainからは何も削除しない。 */
  isDisplaySecondary: boolean;
  dominatingGroupId: IntermediateStateGroupId | null;
}

export type IntermediateStateGroup =
  | IntermediateSkillStateGroup
  | IntermediateBonusStateGroup;

/** 妥協checkpoint到達後にどちらのlaneを先に理想へ近づけるかの希望。soft preference。 */
export type ImprovementPreference = "planner" | "skill_first" | "bonus_first";

/** BuildListEntryのlane別途中採用選択と改善優先。 */
export interface IntermediateStateSelection {
  skillOpportunityId: IntermediateStateOpportunityId | null;
  bonusOpportunityId: IntermediateStateOpportunityId | null;
  improvementPreference: ImprovementPreference;
}

export interface BonusAmendmentResult {
  restorationBonuses: RestorationBonusSet;
  restorationBonusScope: RestorationBonusScope;
}

export interface CandidateBonusAmendmentStep extends BonusAmendmentResult {
  operationIndex: number;
  operationType: "reset_bonuses" | "keep_bonuses";
}

export interface SkillAmendmentResult {
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
}

export interface CandidateSkillAmendmentStep extends SkillAmendmentResult {
  operationIndex: number;
  operationType: "reset_skills";
}

export interface CandidateConversionSkillStep extends SkillAmendmentResult {
  operationIndex: number;
  operationType: "convert_normal_to_gogma";
}
```

不変条件。

- `targetWeaponId` は存在するTargetWeaponを参照する
- BuildCandidateは常に対象TargetWeaponの理想条件を満たす。妥協状態はCandidateにならない
- `category` / `isSimilarToIdeal` / `similarityScore` は存在しない
- `intermediateStateGroups` は現行calculation schemaのCandidateでは必須である。field自体が
  無い旧artifactは互換対象として保持し、補完も再分類もしない
- 各Bonus groupは `restorationBonusScope = "gogma_artian"` である
- 各opportunityの `lanePosition` はそのlaneの操作数未満であり、group内で昇順に並ぶ。
  `operationIndex` はlane位置 `n >= 1` ではlaneの `n` 番目の操作、位置0ではconversion操作
  （無ければ `null`）と一致する
- 各Bonus opportunityはgroupと同じscope / 5枠multisetへ到達する
- `dominatingGroupId` は同じCandidateの別のBonus groupのIDだけを参照する。自分自身や
  存在しないgroupを参照せず、`isDisplaySecondary` は `dominatingGroupId !== null`
  と一致する
- group IDとopportunity IDは `candidateStableKey`、lane、group identity、lanePositionから決まる
  deterministicな値であり、`searchRunId`・Clock・列挙順に依存しない。group IDは
  `intermediate-group:`、opportunity IDは `intermediate-opportunity:` で始まる
- 現行calculation schemaのCandidate validationは上記をすべて検証する。
  `intermediateStateGroups` を持たないschema 10以前のartifactは互換対象として読めるまま
  保持し、補完しない
- `intermediateStateGroups` はCandidate semantic identityに含めない。Candidate ID
  （`semanticHash`）、`candidateStableKey`、重複排除key、`BuildCandidateMeaning`
  fingerprint、`searchStateHash`、`referencedOwnedWeaponsHash` はいずれも参照しない
- `calculationContext` は候補生成時の値を保存し、互換性が失われた候補はstaleとして扱う
- `searchStateHash` は候補検索開始時のRoute依存RNG状態から生成する
- `referencedOwnedWeaponsHash` はRouteが参照するOwnedWeaponだけから生成し、参照がないRouteでは `null` とする
- `finalBonusScope` はRoute完了時に実際に保持する5枠のscopeであり、巨戟化だけなら `normal_artian`、Reset / Keep後は `gogma_artian` とする
- Production RNGが生成するCandidateのSeries Skill / Group SkillはconversionまたはReset Skillsの予測結果を保持し、conversion直後を `null / null` にしない
- `bonusAmendmentTrace` は決定済みRouteを説明する観測情報であり、Candidate semantic identityに含めない。Candidate ID（`semanticHash`）、`candidateStableKey`、Candidate重複排除key、`searchStateHash`、`referencedOwnedWeaponsHash`、`BuildCandidateMeaning` fingerprintはいずれも参照しない
- `bonusAmendmentTrace` を持つ場合、`route.operations` 内の `reset_bonuses` / `keep_bonuses` と1対1で実行順に対応し、`operationIndex` は該当Operationの位置、`operationType` はそのOperationの種別と一致する
- 各entryの `restorationBonuses` はRNG Engineが返した5枠をslot順のまま保持し、multiset正規化・並べ替えを行わない。`restorationBonusScope` は明示し、既定値で補わない
- 最後のBonus amendmentのentryは `finalBonuses` / `restorationBonusScope` と一致する。Route末尾がReset Skills等でも比較対象は最後のBonus amendmentとする
- この一致判定はslot順を含む完全一致であり、multiset比較（`areRestorationBonusSetsEqual()`）で代用しない。slot 1 - 5をそれぞれ `bonusTypeId` / `bonusRankId` まで比較し、不一致はDomain validation issueとする
- 中間結果を `finalBonuses` から逆算せず、同一depthの別branch結果を代用しない。採用されたcanonical operation historyの結果だけを保持する
- `bonusAmendmentTrace` はoptionalであり、この項目が存在しなかった時点のCandidateも有効とする。additiveな観測情報であって計算意味を変えないため、欠落を理由にstale化しない
- `skillAmendmentTrace` は `bonusAmendmentTrace` のSkill側対応物であり、同じ観測情報契約に従う。Candidate semantic identityに含めず、Candidate ID（`semanticHash`）、`candidateStableKey`、Candidate重複排除key、`searchStateHash`、`referencedOwnedWeaponsHash`、`BuildCandidateMeaning` fingerprint、retention、ordering、dominance、Ideal / Practical判定、stalenessのいずれの入力にもならない
- `skillAmendmentTrace` を持つ場合、`route.operations` 内の `reset_skills` と1対1で実行順に対応し、`operationIndex` は該当Operationの位置、`operationType` は `"reset_skills"` と一致する。連続する同一Operationでも「何番目の `reset_skills` か」ではなく `operationIndex` で束縛する
- 各entryの `seriesSkillId` / `groupSkillId` はSkill streamがそのCounter位置で実際に使用した予測結果を保持する。`finalBonuses` 相当の逆算、最終Skillの全stepへの複製、別Counter位置の結果の流用を行わない
- 最後のSkill amendmentのentryはCandidateの `seriesSkillId` / `groupSkillId` と一致する。Routeの末尾がBonus amendment等でも比較対象は最後の `reset_skills` とする
- Skill結果のauthorityは引き続きCandidateの `seriesSkillId` / `groupSkillId` であり、`skillAmendmentTrace` は説明用である
- Route内の `reset_skills` 件数と予測結果件数が一致しない場合はinternal inconsistencyとしてCandidate生成をfail loudlyし、短い方へ黙って合わせない
- `reset_skills` を1回も含まないSearch生成Candidateは `skillAmendmentTrace = []` とする。`undefined` はこの項目が存在しなかった時点のCandidateを意味し、`[]` とは区別してよい。どちらもUIでは予測結果を表示しない
- `skillAmendmentTrace` はoptionalであり、この項目が存在しなかった時点のCandidateも有効とする。欠落を理由にstale化せず、read migrationも行わない
- `conversionSkillTrace` は `convert_normal_to_gogma` が付与する初回Series Skill / Group Skillの観測情報であり、`skillAmendmentTrace` とは別の契約とする。`skillAmendmentTrace` は引き続き `reset_skills` 専用であり、`operationType` へconversionを追加して兼用しない
- `conversionSkillTrace` はCandidate semantic identityに含めず、Candidate ID（`semanticHash`）、`candidateStableKey`、Candidate重複排除key、`searchStateHash`、`referencedOwnedWeaponsHash`、`BuildCandidateMeaning` fingerprint、retention、ordering、dominance、Ideal / Practical判定、staleness、Planner route identityのいずれの入力にもならない
- `conversionSkillTrace` は単数とする。Routeが持つ `convert_normal_to_gogma` は最大1件であり（SEARCH_SPEC 6.1 / 6.1.1 / 6.2）、conversionを含まないRouteはこの項目を持たない
- `conversionSkillTrace` を持つ場合、`operationIndex` はRoute内の `convert_normal_to_gogma` の位置と一致し、`operationType` は `"convert_normal_to_gogma"` と一致する。conversion件数が1件でないRouteがこの項目を持つ場合はinternal inconsistencyとする
- `conversionSkillTrace` の `seriesSkillId` / `groupSkillId` は、Search時にconversion位置のSkill Counterで実際に使用した予測結果を保持する。UI・presentation層でRNGを再実行せず、同じCounter位置を再予測しない
- `conversionSkillTrace` はCandidateの `seriesSkillId` / `groupSkillId` との一致を要求しない。conversion後に `reset_skills` が続く場合、最終Skillはconversion直後Skillと異なるためである。Skill結果のauthorityは引き続きCandidateの `seriesSkillId` / `groupSkillId` である
- `conversionSkillTrace` はoptionalであり、この項目が存在しなかった時点のCandidateも有効とする。欠落を理由にstale化せず、read migrationも行わない

## 9.2 BuildRoute

Routeはendpointだけでなく、PlanStepへ変換可能な具体的操作列を保持する。

```ts
export interface BuildRoute {
  kind: RouteKind;
  operations: RouteOperation[];
  sourceOwnedWeaponId: OwnedWeaponId | null;
}

export type RouteOperation =
  | CreateNormalArtianOperation
  | ConvertToGogmaOperation
  | ResetBonusesOperation
  | KeepBonusesOperation
  | ResetSkillsOperation;

export interface PredictedCreateNormalArtianOperation {
  type: "create_normal_artian";
  weaponTypeId: WeaponTypeId;
  rarity: NormalArtianRarity;
  count: number;
  normalCounterBefore: number;
  normalCounterAfter: number;
}

export interface BlindCreateNormalArtianOperation {
  type: "create_normal_artian";
  weaponTypeId: WeaponTypeId;
  rarity: NormalArtianRarity;
  count: 1;
  normalCounterBefore: null;
  normalCounterAfter: null;
}

export type CreateNormalArtianOperation =
  | PredictedCreateNormalArtianOperation
  | BlindCreateNormalArtianOperation;

export interface ConvertToGogmaOperation {
  type: "convert_normal_to_gogma";
  weaponTypeId: WeaponTypeId;
  skillCounterBefore: number;
  skillCounterAfter: number;
}

export interface ResetBonusesOperation {
  type: "reset_bonuses";
  sourceOwnedWeaponId: OwnedWeaponId | null;
  gogmaCounterBefore: number;
  gogmaCounterAfter: number;
}

export interface KeepBonusesOperation {
  type: "keep_bonuses";
  sourceOwnedWeaponId: OwnedWeaponId | null;
  gogmaCounterBefore: number;
  gogmaCounterAfter: number;
}

export interface ResetSkillsOperation {
  type: "reset_skills";
  sourceOwnedWeaponId: OwnedWeaponId | null;
  skillCounterBefore: number;
  skillCounterAfter: number;
}
```

制約。

- `operations` は実行順に並べ、空配列を許可しない
- CreateNormalArtianOperationは2 variantを持つ。両方を `normalCounterBefore` / `normalCounterAfter` のnull性だけで判別し、追加のdiscriminant fieldを永続化しない。既存の永続CreateNormalArtianOperationはすべてpredicted variantであり、その意味は変わらない
- predicted variantの `count` は `forgeCount` で1以上、`normalCounterAfter = normalCounterBefore + count`
- blind variant(`docs/SEARCH_SPEC.md` 6.1.1)は `count = 1`、`normalCounterBefore = normalCounterAfter = null` とする。`null` は「このRouteのCandidate semanticsが特定のabsolute Normal Counter位置へ依存しない」を意味し、「Normal Counterが未確定である」でも「Normal Counterが進行しない」でもない。Route operationがCounter位置を持たないことと、Plan実行時に現在の確定Counterを進めることは別概念である(`docs/PLANNER_SPEC.md` 7.0.3)
- 片方だけがnullのCreateNormalArtianOperationはどちらのvariantでもなく、Domain validationで拒否する
- predicted variantの `normal_artian_to_gogma` は該当NormalArtianCounterが確定している場合のみ生成する
- blind variantの `normal_artian_to_gogma` はNormalArtianCounterもNormal Artian Predictionも要求しない。ただしRouteは変換後に必ず1回以上のResetBonusesOperationを含まなければならない。作成した通常アーティアの5枠が未予測であり、Resetだけがそれを読まずに5枠全体を書き換えられるためである
- blind variantを含むRouteはCreateNormalArtianOperationをちょうど1件だけ持つ
- `normal_artian_to_gogma` は1回以上のforgeを表すCreateNormalArtianOperation、最後の1本だけに対するConvertToGogmaOperation、その後の必要なResetBonusesOperation / KeepBonusesOperation / ResetSkillsOperationを実行順に持てる
- `normal_artian_to_gogma` の `BuildRoute.sourceOwnedWeaponId` は `null` とする
- `candidateOffset = k` の通常候補Routeは `forgeCount = k + 1`、`candidateCounter = normalCounterBefore + k = normalCounterBefore + forgeCount - 1` とする。Normal Counterを `forgeCount` 進め、先行するk本は通常アーティアのまま破棄／不採用とし、最後の1本だけを巨戟化する
- `owned_normal_artian_to_gogma` はレア8、非保護、かつTargetと武器種・属性が一致する所持通常アーティアを変換元とする
- `owned_normal_artian_to_gogma` の `BuildRoute.sourceOwnedWeaponId` は変換元の通常アーティアIDとする
- `owned_normal_artian_to_gogma` はConvertToGogmaOperation、その後の必要なResetBonusesOperation / KeepBonusesOperation / ResetSkillsOperationを実行順に持てるが、CreateNormalArtianOperationを含めない
- ConvertToGogmaOperationは通常ボーナス5枠をslot順のまま継承し、現在Skill位置のSeries / Groupを付与してSkill Counterを1進める。Normal / Gogma Counterは進めない
- 変換時のSkillがTarget条件を満たす場合はResetSkillsOperationを追加しない。満たさない場合、変換後の次Skill位置からReset Skillsを探索する
- 同一Route内で変換後の未登録Gogmaを対象にするResetBonusesOperation、KeepBonusesOperation、ResetSkillsOperationは `sourceOwnedWeaponId = null` とし、fake IDまたはRoute-local IDを生成しない
- `sourceOwnedWeaponId = null` のReset / Keep / Reset Skillsは同じBuildRouteで直前に生成されたtransient Gogmaだけを対象とし、既存OwnedWeaponを表さない
- このnull sourceのidentity scopeはBuildListEntryごとのRoute runtimeである。別BuildListEntryのnull sourceは別physical weaponを表し、同じCounter位置・同じoperation typeでも1回の物理操作として共有しない。Planner内部ではBuildListEntry IDで区別し、永続OwnedWeapon IDまたは新しいschema fieldを追加しない
- transientまたはOwned Gogmaの `restorationBonusScope = "normal_artian"` でも、5枠が既知なら最初のBonus amendmentとしてResetBonusesOperation / KeepBonusesOperationのどちらも許可する。blind Normal（`CreateNormalArtianOperation` のCounter位置がnull）から変換したtransient Gogmaだけは5枠が未知なので、最初のResetBonusesOperation前のKeepBonusesOperationを不正とする。これはunknown入力の検証であり、prediction supportの制限でもゲームルールでもない
- ResetBonusesOperationはGogma Counterを1進め、結果を `gogma_artian` scopeへ置き換える。KeepBonusesOperationもGogma Counterを1進める
- KeepBonusesOperationはユーザーselectionを持たない。現在5slotのfamilyをslotごとに保持し、同family内tierを再抽選する一意の操作である
- `existing_gogma_reset_skills` は非nullの `sourceOwnedWeaponId` を持つResetSkillsOperationだけでスキルを再付与し、復元ボーナスを変更するOperationを含めない
- `existing_gogma_current` は非nullの `sourceOwnedWeaponId` と空の `operations` を持ち、現在性能がTarget条件を満たす操作0 Candidateだけを表す
- `existing_gogma_reset_skills` のBuildRoute.sourceOwnedWeaponIdと各ResetSkillsOperation.sourceOwnedWeaponIdは同じ起点武器を参照する
- `existing_gogma_reset_skills` から生成するBuildCandidateの `finalBonusScope` / `finalBonuses` は起点OwnedWeaponの `restorationBonusScope` / `restorationBonuses` と一致し、seriesSkillId / groupSkillIdだけをRNG EngineのSkill Prediction結果から設定する
- Keep後を含む最終 `RestorationBonusSet` は必ずRNG EngineのPrediction結果からBuildCandidateへ設定する
- ResetBonusesOperation、KeepBonusesOperation、ResetSkillsOperationの起点OwnedWeaponが保護中の場合、SearchはそのRouteを生成しない
- 保護中でも現在性能の `existing_gogma_current` Candidate評価からは除外しない
- Route生成後に起点武器がprotectedへ変わった場合、Bonus / Skill amendmentを含むBuildListEntryをPlanner validationで実行不能とする
- Route内で新規生成した武器を参照する専用型は持たず、巨戟化直後のtransient Gogmaは後続Reset / Keep / Reset Skillsの `sourceOwnedWeaponId = null` で表す
- Plannerは `operations` を順にPlanStepへ変換し、endpointのCounter差分から操作を推測復元しない
- 各RouteOperationは自分のCounter位置（`*CounterBefore` / `*CounterAfter`）を絶対値で持つ。同じstream内で
  前のoperationの `counterAfter` と次のoperationの `counterBefore` が連続している必要はない（現行の
  `validateBuildRoute()` も連続性を要求しない）。通常Candidate Searchとconstrained enumerationが生成するRouteは
  streamごとに起点から連続するが、Planner Alternative Search（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.8）は
  fixed Routeの操作でCounterが進む位置（held位置）を跨ぐRouteを生成し得る。そのような間の位置では、
  このRouteの武器状態は変わらず、Counterは他Entryの操作で進むことを前提にする
  （[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.4）。この表現のために永続fieldを追加しない。Plannerは
  未到達の位置を待機し、誰も進めない位置では既存のstall dropになる
- そのようなRouteのpredicted `create_normal_artian` も既存shapeのまま、連続forge範囲1つで表す。
  production targetより前にある、originから先頭連続したheld位置（prefix）だけを飛ばし、
  `normalCounterBefore` = prefixの直後（prefixが空ならorigin）、`normalCounterAfter` = production target + 1、
  `count = normalCounterAfter - normalCounterBefore` とする（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.4）。
  例: origin = 0でproduction target = 0なら、fixed Routeが0..206をheldにしていても `0 / 1 / count 1`。
  held = 0..4、production target = 10なら `5 / 11 / count 6`。`normalCounterAfter = normalCounterBefore + count` は
  従来どおり成り立つ。blind variantは対象外である

## 9.3 IdealDifference

```ts
export interface IdealDifference {
  missingBonuses: RestorationBonus[];
  extraBonuses: RestorationBonus[];
  matchedBonusCount: number;
  seriesSkillMatches: boolean;
  groupSkillMatches: boolean;
  summary: string;
}
```

## 9.4 BuildListEntry

BuildCandidateをPlannerへ渡すためにユーザーが選択した作成リスト項目。Candidate本体とは独立して保存する。

```ts
export interface BuildListEntry {
  id: BuildListEntryId;
  candidateId: BuildCandidateId;
  targetWeaponId: TargetWeaponId;
  candidateSnapshot: BuildCandidate;
  targetDefinitionHash: string;
  searchStateHash: string;
  referencedOwnedWeaponsHash: string | null;
  calculationContext: CalculationContext;
  isStale: boolean;
  staleReasons: BuildListEntryStaleReason[];
  createdAt: ISODateTimeString;
  /**
   * ユーザーがlaneごとに選択した途中採用状態のopportunity IDと、理想品までの改善優先。
   * 初期値は両laneとも null、改善優先は "planner" であり、1 laneにつき最大1件だけ選択できる。
   * 選択はCandidateの意味ではなくユーザーの計画入力なので、Candidate Snapshot、
   * 両hash、CalculationContextのいずれも変更せず、Entryをstaleにしない。
   * 一方でPlanの `buildListEntriesHash` には入るため、変えると既存Planは
   * 再計算対象になる（PLANNER_SPEC 7.5.5）。改善優先はTargetWeaponへ保存しない。
   */
  intermediateStateSelection?: IntermediateStateSelection;
}

export type BuildListEntryStaleReason =
  | "target_definition_changed"
  | "rng_state_changed"
  | "owned_weapon_changed"
  | "calculation_context_changed";
```

不変条件。

- 作成リスト追加時にBuildCandidate全体を `candidateSnapshot` へ複製する
- `targetDefinitionHash` は `createTargetDefinitionHash()` でTargetWeaponの性能定義（Candidateの成否と意味を
  決める項目）だけを安定serializeして生成する。対象fieldは次に固定する
  （[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11）

  ```text
  含める:   weaponTypeId, elementId, idealBonuses, practicalBonusConditions,
            alternativeBonusRules, idealSkillCondition, practicalSkillCondition
  含めない: priority, isEnabled, preferredOwnedWeaponId, lifecycleStatus, completedAt,
            completedByProductionPlanId, name, memo, timestamps
  ```

- `priority`、`isEnabled`、`preferredOwnedWeaponId`、lifecycleを変更しても既存Entryを
  `target_definition_changed` にしない。`priority` と `preferredOwnedWeaponId` はPlannerのplanning input、
  `isEnabled = false` と `completed` はSearch / Planner入力からの除外条件として扱う。preferredはCandidate
  stable key、Candidate ID、Candidate dedup key、BuildCandidate meaning fingerprintへも混ぜない
- calculation schema 11以前は `priority`、`isEnabled`、`preferredOwnedWeaponId` を `targetDefinitionHash` に
  含めていた。この正規化変更はcalculation schema 12のversion境界とともに適用した（3.5）
- `completed` TargetのEntryはstaleではなく、Planner入力validationで「完了済み目標武器」として除外する
- `searchStateHash` は `candidateSnapshot.searchStateHash` を複製する
- `referencedOwnedWeaponsHash` は `candidateSnapshot.referencedOwnedWeaponsHash` を複製する
- `calculationContext` は `candidateSnapshot.calculationContext` と一致する
- 再検索でBuildCandidateが削除または置換されてもSnapshotは保持する
- `candidateId` は作成元の追跡用であり、作成元BuildCandidate削除後もSnapshotが有効ならEntryはstaleにならない
- TargetWeapon性能定義の変更、検索に使用したRNG状態変更、Route参照OwnedWeapon変更、CalculationContext非互換時は `isStale = true` とし、Planner入力から除外する
- 初期版では `searchStateHash` が現在値から再計算したHashと異なる場合、安全側に倒して `rng_state_changed` とする
- Route成立性に影響しない変更を明示的かつテスト可能に証明できる場合だけ、将来 `rng_state_changed` を回避してよい
- Active Plan開始後、PlanどおりのRNG進行またはOwnedWeapon変更でEntry自体が再利用不可になっても、進行中Planのstale判定はPlanStepの期待状態を優先する
- 同じCandidateを重複追加しない。既に同一semanticのCandidateが存在する場合は既存Entryを
  返し、`intermediateStateSelection` を上書きしない
- `skillOpportunityId` は `candidateSnapshot.intermediateStateGroups` のSkill group、
  `bonusOpportunityId` はBonus groupのopportunityに存在しなければならない。存在しないID、
  別laneのIDはfail closedで拒否する
- `improvementPreference` は `planner | skill_first | bonus_first` のいずれかである
- 両laneの開始状態（lane位置0）の同時選択は有効である。既存巨戟ではユーザーが既に持っている
  武器を妥協checkpointとして採用することになり、PlannerはPlanner開始時点で到達済みとして扱う
  （SEARCH_SPEC 5.8.5、PLANNER_SPEC 7.5.2）
- 選択・改善優先の変更は `isStale` / `staleReasons` に影響しない
- どちらかのlaneを選択したEntryは、そのPlanner runにおける当該Targetのrequired Entryである。
  同じTargetの別Entryの理想品完成で迂回できない
  ([PLANNER_SPEC.md](./PLANNER_SPEC.md) 7.5.6)
- Planner入力のcollection-level invariantとして、1 Targetにつき選択を持つvalid Entryは
  最大1件とする。2件以上はPlanner入力をfail closedし、Build Listで片方の選択解除を求める。
  永続Build List自体が1 Targetにつき最大1 Entryであり(9.4.1)、通常のPlanner入力では
  legacy duplicateのfail closedが先に働くため、この規則は自明に満たされる(同 7.5.7)。
  この規則はtemporary augmented inputとlegacy / malformed入力への防御として残る
- 上記の選択構造validationは `validateBuildListEntryIntermediateStateSelection()`
  として共有され、`validateBuildListEntry()` とPlanner入力validationの両方が呼ぶ。
  Plannerは壊れた選択を「選択なし」と解釈せず、入力をfail closedする(同 7.5.9)

`searchStateHash` の正規化対象。

- Base SeedのvalueとisConfirmed
- RouteがGogma予測を使う場合はGogma CounterのvalueとisConfirmed
- RouteがSkill予測を使う場合はSkill CounterのvalueとisConfirmed
- Routeがpredicted variantのCreateNormalArtianOperationを使う場合は対象武器種のレア8 NormalArtianCounterのcounterとisConfirmed
- blind variantのCreateNormalArtianOperationはNormal Counterを読まないため、NormalArtianCounterを正規化対象へ含めない。後からNormal Counterを確定してもblind Route Candidateのsemanticsは変わらないので、`rng_state_changed` にしない
- legacy `counterGate` のvalue、isConfirmed、sourceは除外する。Production active Prediction結果へ影響しないGate変更だけで `rng_state_changed` を発生させない
- source、notes、観測日時、表示用フィールドは除外する

`referencedOwnedWeaponsHash` の正規化対象。

- 参照IDは `BuildRoute.sourceOwnedWeaponId`、非nullの `ResetBonusesOperation.sourceOwnedWeaponId`、非nullの `KeepBonusesOperation.sourceOwnedWeaponId`、非nullの `ResetSkillsOperation.sourceOwnedWeaponId` から収集する。`null` transient sourceはOwnedWeapon参照に含めない
- 同じIDを重複排除し、ID順に安定ソートする
- 各参照武器について `id`、`kind`、`weaponTypeId`、`elementId`、`restorationBonusScope`、`restorationBonuses`、`isProtected` を含める
- 巨戟アーティアについてはさらに `seriesSkillId`、`groupSkillId` を含める
- `restorationBonuses` は保存中の5枠配列順を保持する。Keepがslotごとのfamilyを保持するため、Hash生成時に並べ替えない
- `name`、`memo`、`createdAt`、`updatedAt`、`status` は除外する。`status` はユーザー管理ラベルであり
  計算に影響しないため、名称やmemoと同じくnon-semanticとして扱う(3.2)
- Routeが参照しないOwnedWeaponの追加、更新、削除はHashへ影響させない
- 参照武器が存在しない、または参照武器IDが現在在庫から消失した場合は、元Hashと一致しない値を生成して `owned_weapon_changed` とする
- RouteがOwnedWeaponを参照しない場合は `null` とし、在庫変更によってstaleにしない

```ts
deriveBuildListEntryStaleReasons(
  entry: BuildListEntry,
  currentTarget: TargetWeapon,
  currentRngState: RngState,
  currentNormalCounters: NormalArtianCounter[],
  currentOwnedWeapons: OwnedWeapon[],
  currentContext: CalculationContext
): BuildListEntryStaleReason[];
```

`isStale` はこの戻り値が1件以上かどうかと一致させる。

### 9.4.1 Build List cardinality（1 Target = 最大1 Entry）

実装状態: **実装済み**。Issue #103のPhase 0（Build List cardinalityの実装PR群、
[ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md](./ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md) 17章）で
0-1 / 0-2 / 0-3の順に実装した。

- 実装済み（Phase 0-1、Domain / Service基盤）: collection invariantの判定authority
  （`findBuildListTargetDuplicates()` / `validateBuildListCardinality()` /
  `classifyBuildListCandidateAddition()`、`src/domain/buildList/buildListCardinality.ts`）、
  通常Planner入力のlegacy duplicate fail closed（warning `duplicate_build_list_entries_for_target`、
  [PLANNER_SPEC.md](./PLANNER_SPEC.md) 4.1）、Search追加Serviceの結果型
  （`BuildListService.addCandidate()` の `added` / `duplicate` / `replacement_required` /
  `legacy_duplicate`。判定と追加は1つのtransaction）、`replace BuildListEntry for Target` の
  guarded mutationと事前inspect（`BuildListService.replaceCandidate()` /
  `inspectCandidateReplacement()`）、Import / Exportのlegacy duplicate保持
- 実装済み（Phase 0-2、UI）: Search画面は `AddBuildListCandidateResult` を直接扱い、
  `replacement_required` で置換確認Dialogを出し、承認後に `inspectCandidateReplacement()` →
  （必要なら既存のPlan-breaking警告）→ `replaceCandidate()` を1つのguarded操作として実行する。
  `legacy_duplicate` では追加も置換もせず作成リストでの整理を案内する。Build Listは
  `findBuildListTargetDuplicates()` の結果でlegacy duplicateのTargetに案内を出し、既存のEntry削除で
  整理させる（[UI_FLOW.md](./UI_FLOW.md) 9 / 10）。Phase 0-1の暫定adapter `toSearchScreenAddition()` は削除した
- 実装済み（Phase 0-3、Planner / Persistence）: constrained re-search / what-if / 再計画採用と
  cardinalityの接続（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.18）。置換の共通authorityは
  `src/domain/buildList/buildListEntryReplacement.ts`（`BuildListEntryReplacement`、
  `resolveBuildListEntryReplacement()` / `applyBuildListEntryReplacements()` /
  `validateBuildListEntryReplacements()` / `validateGeneratedBuildListEntryReplacements()` /
  `validateReplacedBuildListCardinality()`）。正式採用したgenerated Entryは失う側Targetの元Entryを置換し、
  `PlannerOrchestrationResult.generatedBuildListEntryReplacements`（runtime-only、永続化しない）が
  「generated Entry → 置換対象の元Entry」の対応をWorkerから保存transactionまで運ぶ。保存は
  `PlannerResultPersistenceService` / 再計画採用のいずれも、transaction内で元Entryが今もそのTargetの
  唯一の永続Entryであることを確認してから置換する。Phase 0-3以前の採用で元Entryの横に保存された
  generated Entryは、下記のlegacy duplicateとして扱う（自動整理しない）

#### collection invariant

```text
同一 targetWeaponId を持つ永続BuildListEntryは最大1件
```

- これはBuild List自体の契約である。Plannerの都合ではなく、「作成リストは目標武器ごとに、
  ユーザーが現在採用した作成ルートを1件だけ持つ」ことを表す
- staleなEntryも数える。stale Entryは同じTargetの新しいEntryと並べて残さず、置換で入れ替える
- 生成主体（ユーザー追加 / Planner constrained re-searchの採用）を区別する永続provenance fieldは
  追加しない。正式採用後はどちらも「そのTargetの現在のBuildListEntry」である
- 通常のPlannerInputはこのinvariantをそのまま継承する。constrained re-search / what-ifの
  temporary augmented inputだけが、元Entryとtemporary generated Entryの一時的な共存を許される
  例外であり、永続化されない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.18）

#### Candidate Searchからの追加と置換

ユーザーがCandidate Search結果を作成リストへ追加するときの意味論は次のとおりとする
（画面上の流れは[SEARCH_SPEC.md](./SEARCH_SPEC.md) 10.1 / [UI_FLOW.md](./UI_FLOW.md) 9）。

| 永続Build Listの状態 | 結果 |
| --- | --- |
| 同じTargetのEntryが無い | 従来どおり新Entryを追加する |
| 同一semanticのCandidateのEntryが既にある | duplicate。何も書かず、既存Entryの途中採用状態・改善優先を上書きしない（9.4の既存規則） |
| 同じTargetに別CandidateのEntryが1件ある | ユーザーの確認を経て、承認時だけ既存Entryを新CandidateのEntryで **置換** する。キャンセル時は何も変更しない |
| 同じTargetにEntryが2件以上ある（legacy duplicate） | どれを置換するか推測できないため追加も置換も拒否し、先に1件へ整理するよう案内する |

置換の規則。

- 置換は `replace BuildListEntry for Target` という1つの意味的操作であり、UIから「旧Entry削除」と
  「新Entry追加」を別々に実行しない。旧Entryの削除と新Entryの追加は1つのDexie read-write
  transactionで行い、「旧Entryだけ消えた」「新Entryだけ増えた」中間状態を作らない
- 要求はユーザーが確認画面で見た置換対象の旧Entry IDを持つ。transaction内で永続状態を読み直し、
  そのTargetのEntryがその旧Entry 1件でない場合（別タブで変更された等）は何も書かずに拒否する
- 新Entryは新Candidateと、今回のSearch画面でユーザーが指定した途中採用状態・改善優先だけから
  `createBuildListEntry()` で作る。旧Entryの `intermediateStateSelection`（Skill / Bonusの途中採用状態、
  改善優先）は旧Route固有の入力であり、引き継がない。旧Routeのcheckpointを新Routeの似た位置へ
  自動変換することを禁止する
- 新EntryのIDは既存どおり新Candidateから生成し、旧Entry IDを再利用しない。旧IDのレコードを別内容で
  上書きしない
- 置換後の状態に対してcollection invariantと新Entryのentity validationを検証し、失敗したら
  何も書かない
- 置換対象の旧Entryを参照するBuildCandidate / TargetWeapon / OwnedWeaponをcascade deleteしない

#### 実行中PlanとDraft Planとの関係

置換は旧Entryの削除を伴うため、「新規追加だけだから安全」とは扱わない。

- 置換全体を1つのguarded mutation（`PlanGuardedMutation`）として既存 `PlanBreakingChangeGuard` で
  判定する（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.6）。旧Entryが `active` PlanのPlan依存Entry
  （`selectedBuildListEntryIds`）であれば `build_list_changed` の警告になり、16.10のセーブ地点選択を
  経て承認された場合だけ、置換とPlanの `abandoned`（`breaking_change_approved`）を同一transactionで
  行う。承認が無ければ何も変更しない
- 旧Entryを参照するのが `draft` / `stale` / `completed` / `abandoned` Planだけの場合は、既存の
  Build List Entry削除と同じくguardの警告対象にしない。Draftの開始可否は
  `prepareProductionPlanStart()` の既存検証が判断する
- 同じTargetにEntryが無い場合の新規追加は、従来どおりPlanを壊さないためguardを通さない

#### legacy duplicate（既存データ）

本契約の導入前のユーザーデータには同一Targetの複数Entryが存在し得る（導入前の通常操作と、
Phase 0-3より前のconstrained re-searchの採用で生じた。Phase 0-3以後の採用は置換なので新たには生じない）。

- 自動で残すEntryを選ばない。最短Route、最新 `createdAt`、ID順、stale状態などで推測して削除・
  選択しない。Dexie migrationで整理しない
- 読込は非破壊とする。Build Listは該当Targetに「複数の候補が登録されています。使用する候補を
  1件にしてください。」相当の案内を表示し、ユーザーが既存のEntry削除（guarded）で整理する
- ordinary Planner入力は、同一planning TargetのEntryが2件以上あればfail closedする
  （[PLANNER_SPEC.md](./PLANNER_SPEC.md) 4.1）。staleなどで除外されたEntryも数え、除外されていない方を
  暗黙に採用しない。Planner実行、再計画Preview、B10の再計算、what-ifの元入力も同じ
- Search画面からの追加 / 置換は上表のとおり拒否し、作成リストで1件に整理するよう案内する（Phase 0-2で実装済み）
- Export / Importはlegacy duplicateを含むrootをそのまま保存・復元する。Importはこれを理由に
  拒否しない（backupを復元できなくしない）。Import後も上記のfail closedと案内が働く

#### version

`DATABASE_SCHEMA_VERSION`、`ExportRoot.schemaVersion`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、
`RngState.schemaVersion`、`AppSettings.schemaVersion` のいずれも変更しない。永続shapeとExport shapeは
変わらず、legacy duplicateを整理するmigrationも持たない。有効な入力に対する計算semanticsも変わらず、
既存のBuildCandidate / BuildListEntry / ProductionPlanは自身の記録のまま有効である
（[ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md](./ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md) 15.1）。

### Planner-generated BuildListEntry

B8-Aで、BuildListEntryの生成主体を次の2つへ拡張した。契約本文は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.8 / 9.2.12 / 9.2.13 / 9.2.15にある。

```text
1. ユーザーがCandidate Search結果から選択して追加する
2. Planner constrained re-searchがPlan生成に必要としてmaterializeする
```

永続モデルの規則。

- Planner-generated Entryも本節の `BuildListEntry` 形状をそのまま使う
- 生成主体を表す永続provenance fieldを追加しない
- `ProductionPlan` へembedded Candidate Snapshotを追加しない
- Candidate table等の新しい永続entityを追加しない
- constrained enumerationで発見した全Candidateを保存しない。最終augmented
  PlannerInputへ正式採用したEntryだけを、生成された `ProductionPlan` と同一
  Dexie transactionで保存する
- ProductionPlanが生成されない場合、generated Entryを永続化しない
- 正式採用したgenerated Entryは、失う側Targetの元Entryに追加せず、元Entryを **置換** して同一
  transactionで保存する。永続Build Listは採用後も1 Targetにつき1件である
  （9.4.1、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.18、Phase 0-3で実装済み）。どの元Entryを置換するかは
  runtime-onlyの `PlannerOrchestrationResult.generatedBuildListEntryReplacements` が表し、
  BuildListEntryへprovenance fieldを追加しない

generated BuildListEntry IDは、少なくとも次から安定生成する。

```text
Candidate semantic meaning
targetDefinitionHash
searchStateHash
referencedOwnedWeaponsHash
CalculationContext
```

`random UUID`、Clock、enumeration ordinal、request UUIDをEntry IDまたはsemantic
tie-breakへ使用しない。`createdAt` は表示用としてClockから生成してよいが、ID、
semantic ordering、Planning input hashの意味へ使わない。

既存Entryの再利用は、current semantic contentがすべて一致する場合だけとする。
ID一致で内容が異なる場合はfail closedとし、上書きしない。Target定義、Search状態、
OwnedWeapon参照状態、CalculationContextのいずれかが現在値と異なるstale Entryは、
再利用も上書きもせず履歴としてそのまま残し、現在のCandidateには新しいEntryを作成する。
過去のProductionPlanが旧Entry IDとSnapshotを参照しているためである。
Build List cardinality（9.4.1）の下でも「既存IDを別内容で上書きしない」規則は変わらない。ただし同じTargetの
Entryを2件並べて残すことはせず、置換（新IDの追加と旧IDの削除を1 transaction）で入れ替える。
generated IDがすでに永続化されていれば、置換ではなくID collisionとしてfail closedする。
旧IDを参照する終了済みPlanは履歴であり、current foreign keyとして扱わない（15.2）。

Candidate semantic identityにはrestoration bonus scopeを含める。現行の
`createBuildCandidateMeaningFingerprint()` はscopeを含まないため、B8実装時に
scopeを含むauthorityへ修正または統合する。

Planner-generated Entryの `candidateSnapshot` も本節9.1の `BuildCandidate` 形状で
ある。ただしconstrained enumeratorが返すのはtransientな `ConstrainedCandidate` で
あり、`BuildCandidate` 形状への変換はB8-Cのdeterministic materializerが行う。
materialize時、`searchRunId` はdeterministic constrained search identity、`id` は
そのidentityとCandidate semantic meaningから安定生成した値、`createdAt` は
`PlannerClock` 由来の値、`intermediateStateGroups` はそのCandidateへintermediate state抽出を
適用した結果とする([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.13、
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。通常Candidate Searchの
`BuildCandidate` ID生成規則と `searchRunId` 契約は変更しない。

---

## 10. アイテム素材要求

ゲーム内で消費するアイテム素材の必要量。所持しているアーティア武器そのものの消費とは
別概念であり、v1に武器を素材として消費するモデルは存在しない(7章、
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 8参照)。

```ts
export interface MaterialRequirement {
  materialId: MaterialId;
  quantity: number;
}
```

初期版ではアイテム素材の厳密な所持数制約は扱わない。

不変条件。

- `quantity` は1以上の整数
- Plannerは必要数を表示するだけで、アイテム素材の不足による作成不能判定は行わない

ユーザー向けの「必要素材・費用の目安」（[REQUIREMENTS.md](./REQUIREMENTS.md) 22.1、
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 4.3）は `MaterialRequirement` ではなく、persisted entityでもない。
`BuildCandidate.route` またはProductionPlanの物理Step列から表示時に導出し、`BuildCandidate`、
`BuildListEntry`、`ProductionPlan`、`PlanStep`、Worker protocol、Export / Import、DB schemaの
いずれにも追加しない。したがってこの目安の導入は `DATABASE_SCHEMA_VERSION`、
`ExportRoot.schemaVersion`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` のいずれも動かさない。

---

## 11. ProductionPlan

## 11.1 ProductionPlan

Plannerが生成した作成計画。

```ts
export interface ProductionPlan {
  id: ProductionPlanId;
  status: ProductionPlanStatus;
  baseSnapshot: PlanningInputSnapshot;
  selectedBuildListEntryIds: BuildListEntryId[];
  calculationContext: CalculationContext;
  steps: PlanStep[];
  conflicts: PlanConflict[];
  rejectedBuildListEntries: RejectedBuildListEntry[];
  requiredMaterials: MaterialRequirement[];
  currentStepId: PlanStepId | null;
  recalculationReasons: RecalculationReason[];
  // Execution lifecycle改訂で追加（PLANNER_SPEC 16.2）
  abandonmentReason: ProductionPlanAbandonmentReason | null;
  abandonedAt: ISODateTimeString | null;
  completedAt: ISODateTimeString | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

statusの意味（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.2）。

| status | 意味 |
| --- | --- |
| `draft` | まだ実行を開始していない |
| `active` | 実行中。中断してブラウザやゲームを終了しても `active` のまま。一時中断用statusは持たない |
| `completed` | Plan対象の必要な処理が正常完了した |
| `stale` | 想定外結果や外部状態不一致などで予測を信用できず続行不可 |
| `abandoned` | ユーザー意思で破棄、再計画採用、妥協品で終了、Plan前提を壊す手動変更の承認 |

不変条件。

- `status = "active"` または `"stale"` の実行中Planは同時に1件まで
- `status = "draft"` の未開始Plan（現在の下書き）はtop-level collectionに同時に1件まで。これは実行中Plan
  の件数制約とは独立した不変条件であり、Draftと実行中Plan（active / stale）の同時存在は禁止しない。
  新しいDraftの保存は、Planner保存transaction（14.5、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.15）の
  中で旧Draftをatomicに置換する: 保存が完全に成功した場合だけ旧Draftが消えて新Draftだけが残り、
  保存が失敗した場合はrollbackで旧Draftを維持する。`ProductionPlanRepository` は別IDのDraftが既に
  ある状態でDraftを `add` / `put` することを `draft_plan_conflict` で拒否する（同じIDのDraft更新は
  別Draftと数えない）。旧Draftの削除で、そのDraftが参照していたBuildListEntry / BuildCandidate /
  TargetWeaponをcascade deleteしない（「このEntryは特定Draftだけが所有する」というauthorityが
  persisted shapeに無いため）。`active` / `stale` / `completed` / `abandoned` のPlanは新Draft保存で
  削除しない
- ユーザーによる現在Draftの削除（[UI_FLOW.md](./UI_FLOW.md) 11.5）は
  `ProductionPlanRepository.deleteDraftProductionPlan(id)` のguarded deleteだけが行う。同一Dexie
  transaction内でexact persisted Planを読み直し、Planが無ければ `not_found`、storedの `status` が
  `draft` 以外なら `draft_plan_delete_not_allowed` で拒否して何も書かない（表示後にDraftが開始されていた
  race対策）。Draftが2件以上あるinvariant violationは `draft_plan_conflict` でfail closedする。削除する
  のはそのProductionPlan recordだけであり、BuildListEntry / BuildCandidate / TargetWeapon / OwnedWeapon /
  ExecutionHistory / ExecutionSavePointへcascadeしない。汎用の `deleteProductionPlan(id)` はUIから
  直接呼ばない。Persisted shapeもschema versionも変えない
- `abandonmentReason` / `abandonedAt` は `status = "abandoned"` のときだけ非null。`completedAt` は
  `status = "completed"` のときだけ非null
- `stale` はPlanが壊れたことの検出、`abandoned` はユーザーの意図した終了であり、互いに読み替えない。
  `stale` から `abandoned` へ遷移しても `recalculationReasons` を保持する
- `currentStepId` は `steps` 内の未完了Stepを参照する
- 現在Stepの期待状態またはPlanの不変前提（Plan依存Target / Plan依存Entry / CalculationContext）と
  実態に差分が出た場合、既存Planは `stale` にする。Plan非依存Targetの追加・変更、Build Listへの
  新規Entry追加ではstaleにしない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.6）
- `baseSnapshot` はPlanner開始状態の監査、再現、Plan依存Target・Plan依存Entry前提の検証に使用する
- 正常なStep進行後の可変状態を `baseSnapshot` の開始状態と比較してstaleにしない
- `calculationContext` が現在環境と非互換なら `stale` にする
- `selectedBuildListEntryIds` はPlanner-generated BuildListEntryを参照してよい。
  その場合、参照するgenerated Entryは同一Dexie transactionで保存する。
  Planだけ、またはEntryだけが残るpartial saveを禁止する
- Candidate SnapshotをProductionPlanへ埋め込まない。Snapshotの保持場所は
  BuildListEntryのままとする

### 11.1.1 conflictRepairLineage（仕様確定・永続field未実装、Phase 5-Bで追加）

競合repair chain（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.11）の履歴。Issue #136 / #101の正式仕様で
field名とshapeを確定した。**現行schemaにはまだ存在しない。** Phase 5-Aで下記の `PlannerConflictRepairLineage`
以下の型をDomain型（`src/domain/models/planning.ts`）として追加し、lineageのPure Domain計算（有効なlineageの導出と
次のlineageの生成）を実装したが、`ProductionPlan` の永続shape、validator、migrationには接続していない。
`ProductionPlan.conflictRepairLineage` の追加はPhase 5-Bで行い、そのとき `DATABASE_SCHEMA_VERSION` 9 → 10、`ExportRoot.schemaVersion` 12 → 13、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 15 → 16とする（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.15）。

```ts
export interface ProductionPlan {
  // ...11.1の既存field...
  conflictRepairLineage: PlannerConflictRepairLineage | null;
}

export interface PlannerConflictRepairLineage {
  /** 決定順。最初の「この候補を優先」が先頭 */
  decisions: PlannerConflictRepairDecision[];
}

export interface PlannerConflictRepairDecision {
  conflictKind: ConflictKind;                   // 決定したConflictの種別（監査・表示用）
  fixedBuildListEntryId: BuildListEntryId;      // ユーザーが優先したEntry
  fixedTargetWeaponId: TargetWeaponId;
  invalidatedRoutes: PlannerConflictRepairInvalidatedRoute[]; // 直接participant Targetごと（stable order）
}

export interface PlannerConflictRepairInvalidatedRoute {
  targetWeaponId: TargetWeaponId;
  invalidatedBuildListEntryId: BuildListEntryId;  // 決定で現在Routeを失ったEntry
  invalidatedRouteKey: string;                    // そのRouteの candidateStableKey
  replacementBuildListEntryId: BuildListEntryId | null; // 採用したreplacement（無ければnull）
  outcome: PlannerConflictRepairOutcomeStatus;
}

export type PlannerConflictRepairOutcomeStatus =
  | "replaced"
  | "rejected_by_scenario_composition"
  | "not_found_within_search_extent"
  | "stopped_by_search_extent_bound"
  | "stopped_by_candidate_trial_bound"
  | "stopped_by_planner_rerun_bound"
  | "blocked_by_selected_checkpoint";
```

`outcome` は、そのTargetのindividual trialのoutcomeとscenario composition（[PLANNER_SPEC.md](./PLANNER_SPEC.md)
9.2.19.8.1）での採否（`adoptedInScenario`、9.2.19.13）から次の表だけで決める。

| individual trialのoutcome / scenarioでの採否 | `outcome` | `replacementBuildListEntryId` |
| --- | --- | --- |
| `found` かつ `adoptedInScenario = true` | `replaced` | accepted replacementのgenerated Entry ID |
| `found` かつ `adoptedInScenario = false` | `rejected_by_scenario_composition` | `null` |
| `not_found_within_search_extent` | 同じstatus | `null` |
| `stopped_by_search_extent_bound` | 同じstatus | `null` |
| `stopped_by_candidate_trial_bound` | 同じstatus | `null` |
| `stopped_by_planner_rerun_bound` | 同じstatus | `null` |
| `blocked_by_selected_checkpoint` | 同じstatus | `null` |

- `rejected_by_scenario_composition` は、individual trialではfoundになったreplacementが存在したが、他のaccepted
  replacementとのscenario compositionで評価した結果、最終accepted replacement集合へ採用しなかったことを表す。
  adoption runのreplacement preflight・explicit resolution再対応付けの失敗によるrejectと、adoption runを行ったが
  accepted判定を満たさなかったrejectの両方を含み、これ以上細分化したstatusを持たない。trialで不採用になった
  replacementのgenerated Entry IDは保存しない
- `replaced` の条件はscenario compositionのaccepted replacement集合だけである。そのgenerated Entryがfinal
  scenario Planで `selectedBuildListEntryIds` に含まれるかは問わない（fixed Route集合外Entryとの未解決競合の
  暫定帰結で非採用のままacceptedになり得る。[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19.6）
- `adoptedInScenario = null`（未評価）はlineageへ写さない。未評価のfound replacementが残るのは `scenario` が
  `stopped_by_planner_rerun_bound` のときだけであり、そのときfinal scenario resultが無いのでactual repairは何も
  保存せず、lineageも保存対象として確定しない

不変条件。

- `null` は「このPlanはrepair chainに属さない」を意味する。通常Planner、再計画Preview / 採用で作るPlanは `null`
  であり、「この候補を優先」のactual repairで保存するDraftだけが、表示中Draftのlineageを引き継いで決定を
  追記したものを持つ。what-ifは読むだけで書かない
- `outcome = "replaced"` のときだけ `replacementBuildListEntryId` は非null
- Targetの記録は、そのTargetの現在Build List Entryが最後に記録したEntry（`replacementBuildListEntryId`、
  nullなら `invalidatedBuildListEntryId`）と同じIDである間だけ有効であり、そうでなくなった記録は次のrepair保存で
  落とす（手動置換でのreset）。記録を落とした結果、有効なTarget記録が1件も残らず、かつfixed Entryも有効でない
  （現在のBuild Listに無い、または後の決定で無効化された）決定は、fixed Route集合にも除外集合にも寄与しないので
  次のrepair保存で決定ごと落とす。どちらかが残る決定は、残った記録だけを元の順序で保持する
- 除外に使うのは `invalidatedRouteKey` だけであり、trialで不採用になったCandidateは記録しない
- Entry IDはどのstatusのPlanでもcurrent foreign keyとして検証しない（Draft本体と同じ。15.2）。構造、literal、
  ID形式、`decisions` の配列形状だけを検証する
- Candidate identity、hash、`PlanningInputSnapshot`、`ExpectedPlanState`、staleness、Execution semantics、
  Plan-breaking判定へ入れない
- Phase 5-Bのmigrationは既存の全ProductionPlan本体（ゲーム内セーブ地点snapshotとUndo snapshot内のPlan本体を含む）
  へ `conflictRepairLineage = null` だけを補い、過去の決定を推測しない

## 11.2 PlanningInputSnapshot

```ts
export interface PlanningInputSnapshot {
  /** Plan開始前の永続状態の前提。calculation schema 13以降、先頭Stepの前はPlan開始effect適用後の状態 */
  initialExecutionState: ExpectedPlanState;
  targetWeaponsHash: string;
  buildListEntriesHash: string;
  // Execution lifecycle改訂で追加（PLANNER_SPEC 16.6）
  dependentTargetDefinitionsHash: string;
  dependentBuildListEntriesHash: string;
  calculationContext: CalculationContext;
  createdAt: ISODateTimeString;
}
```

- `targetWeaponsHash` / `buildListEntriesHash` はPlanner入力全体の監査用hashである。
  `targetWeaponsHash` はPlanner runの計画対象Target（valid BuildListEntryが属するTarget、
  [PLANNER_SPEC.md](./PLANNER_SPEC.md) 4.1）ではなく、`PlannerInput.targetWeapons` の全Targetを対象とする
- `targetWeaponsHash` は `createTargetDefinitionHash()` の単純再利用ではないplanning-input用の独立契約である。
  `PlannerInput.targetWeapons` の全TargetをID順に、次の構造へ正規化してhash化する
  （[PLANNER_SPEC.md](./PLANNER_SPEC.md) 11.0-B）

  ```ts
  {
    id: TargetWeaponId;
    definitionHash: string;                      // createTargetDefinitionHash(target)。preferredを含まない
    priority: number;
    isEnabled: boolean;
    preferredOwnedWeaponId: OwnedWeaponId | null;
    lifecycleStatus: TargetWeaponLifecycleStatus;
  }
  ```

  `name`、`memo`、`completedAt`、`completedByProductionPlanId`、timestampsは含めない
- `dependentTargetDefinitionsHash` はPlan依存Target（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.5）ごとに
  `{ id, definitionHash: createTargetDefinitionHash(target), priority, isEnabled }` をID順にhash化する。
  `preferredOwnedWeaponId` と `lifecycleStatus` はExecution自身が正常進行として変更するため含めず、
  `ExpectedPlanState.targetExecutionStateHash` で検証する
- `dependentBuildListEntriesHash` は `selectedBuildListEntryIds` のEntryだけについて、
  `buildListEntriesHash` と同じ不変項目をID順にhash化する
- Active / draft Planの不変前提検証（`detectPlanInvalidation()`）は依存hashだけを使う。
  全体hashの差分はDebug表示と「この生産計画に含まれない目標武器・候補がある」案内だけに使う

Planner計算へ渡す非永続入力と実行時dependencyは次の契約とする。

```ts
export interface PlannerInput {
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
  targetWeapons: TargetWeapon[];
  buildListEntries: BuildListEntry[];
  calculationContext: CalculationContext;
  options: PlannerOptions;
  master: PlannerMasterSubset;
  conflictResolutions: PlannerConflictResolution[];
}

// Issue #103 Phase D-2a: Production Plannerのboundは maxPlanSteps だけ
export interface PlannerOptions {
  maxPlanSteps: number;
}

export interface PlannerConflictResolution {
  conflictKey: string;
  selectedBuildListEntryId: BuildListEntryId;
}

export interface PlannerDependencies {
  rngEngine: RngEngine;
  idFactory: PlannerIdFactory;
  clock: PlannerClock;
}
```

`PlannerInput.targetWeapons` はplanning inputのTarget集合（validation、`targetWeaponsHash`）であり、
Planner runの完成対象はそのうちvalid BuildListEntryが属するTargetだけである
（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 4.1）。計画対象Targetはruntime導出であり永続化しない。

`PlannerInput` はstructured clone可能なデータだけを持ち、Engine instance、
engineCapabilities、existingActivePlanを含めない。`PlannerDependencies` は永続Domainではなく、
WorkerまたはApplication moduleからPlanner pure calculationへ注入するruntime境界である。
ID FactoryはProductionPlan / PlanStep / future OwnedWeapon IDを、ClockはISO UTC時刻を供給する。
Active Plan単一制約はApplication / Persistence層で扱う。

v1のProduction `PlannerOptions` は1以上の整数 `maxPlanSteps` だけとする（Issue #103 Phase D-2a）。
Production Planner（決定的scheduler、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7）が読むboundは
`maxPlanSteps` だけであり、型もそれに一致させる。初期値は `defaultPlannerOptions = { maxPlanSteps: 1000 }`。
これはDomain / Applicationのfallback既定値であり、BuildList画面の初期表示（登録Candidateの最大
`estimatedOperationCount` にCandidate確保action `reserve_candidate` の1を加えて500刻みで切り上げ、
最低1000）と競合解決再計算の上限（表示中Planの
Step数を500刻みで切り上げて+500、最低1000）はApplication callerがruntimeに導出する
（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7.2.1、Issue #130）。導出値も含め `PlannerOptions` は
永続化しない。
実用品優先を切り替える `preferPracticalBeforeIdeal` は持たず、渡された場合はvalidation issueとして拒否する。
通常Worker request、B8 constrained re-search、B9 what-if、再計画Previewのいずれの `PlannerInput` も
`beamWidth` / `maxExpandedStates` を持たない。

Beam Search oracle（test / parity regression専用、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7.2.2）の
`beamWidth` / `maxExpandedStates` は、Production persisted / runtime modelではない別のtest / parity
contract `PlannerBeamSearchOptions`（`PlannerOptions` + 2 field、既定値
`defaultPlannerBeamSearchOptions = { maxPlanSteps: 1000, beamWidth: 50, maxExpandedStates: 10000 }`、
専用validation `validatePlannerBeamSearchOptions()`）と `PlannerBeamSearchInput` だけが持つ。
Production codeはこれらをimportしない。

`PlannerOptions` は `PlanningInputSnapshot` にも他のpersisted entityにも保存されたことがない
runtime入力である。そのためD-2aは `ProductionPlan` / `PlanStep` / `PlanningInputSnapshot` /
`CalculationContext` / DB / Exportのshapeを変えず、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` は14のまま。

Plannerは所持武器を消耗品として扱わないため、素材用武器需要を表すPlanner-only DTO
(`PlannerMaterialRequirement` / `PlannerMaterialAssignment`)を持たない。

各hashは、該当データを安定ソートしたJSONから生成する。

目的。

- Plan作成時の開始状態と不変前提を固定する
- TargetWeapon、BuildListEntry、CalculationContextの計画外変更を検出する
- Debug Modeで差分理由を表示する

```ts
export interface ExpectedPlanState {
  rngStateHash: string;
  normalCountersHash: string;
  ownedWeaponsHash: string;
  // Execution lifecycle改訂で追加（PLANNER_SPEC 16.5）
  targetExecutionStateHash: string;
}
```

各hashは、Plan実行に影響する項目だけを安定ソートした正規化JSONから生成する。`updatedAt`、表示名、メモなど計算に影響しない項目を含めない。

- `rngStateHash`: Base Seed、Gogma Counter、Skill Counterの各KnownValueについて正規化valueとisConfirmedを含み、legacy `counterGate`、source、notes、日時を除外する
- `normalCountersHash`: id、counter、isConfirmedを含み、観測日時を除外する
- `ownedWeaponsHash`: 共通項目としてID、kind、武器種、属性、restorationBonusScope、保存中のボーナス5枠順、isProtectedを含む。OwnedWeaponはTargetWeaponを参照しないため、Target関連情報は含めない。巨戟だけseriesSkillId、groupSkillIdを加える。`status` と `executionInProgress` は計算に影響しないため、名称、memo、日時と同じく除外する。通常に存在しないSkillへ仮値を設定しない。execution projection（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.3）で登録される作成対象Normalは登録Stepの `expectedStateAfter` から含まれ、Counter進行用Normalは含まれない。observation bindingを持つ武器の5枠は、Plan生成時のexpected stateではbinding token `{ observationBinding: <binding StepのPlanStep ID> }` として正規化し、実状態側は5枠とscopeがbinding Stepの `ExecutionHistory.actualResult` とslot順まで完全一致する場合だけtokenへ置き換える（同 16.5）
- `targetExecutionStateHash`: Plan依存Target（`selectedBuildListEntryIds` のEntryのTarget、全PlanStepの `targetWeaponId` / `progressedTargetWeaponIds` / `executionEffects` が参照するTarget）ごとに `id`、`lifecycleStatus`、`preferredOwnedWeaponId` をID順にhash化する。全Targetをhashしない。日時は含めない。Plan開始effectと登録Stepのtarget linkによる紐付けはPlan依存Targetについてhashへ反映し、Plan非依存Targetの紐付け解除はhashではなく開始 / Step確定時のcollection validation（とStepではUndo Snapshot）で扱う
- `buildListEntriesHash`: Entry ID、Candidate Snapshot、途中採用状態を持つEntryのcheckpoint pin pair（選択laneは opportunity ID / lane位置 / 終端操作index / Skill または exact ordered 5枠 / scope / match、未選択laneはCandidateのIdeal終点の Skill または exact ordered `finalBonuses` / scope）と改善優先、Target定義Hash、searchStateHash、CalculationContextを含み、派生値のisStale、staleReasons、日時を除外する（PLANNER_SPEC 7.5.5）

`ExpectedPlanState` の各hashは1つのPlan内で意味を持つ検証値である。`ownedWeaponsHash`
はOwnedWeapon IDを含み、新規Normal Routeで登録する武器の予約IDは
`PlannerIdFactory` 由来であるため、同じsemantic outcomeでもPlanner実行ごとに値が変わる。
したがってPlanner実行間でhash文字列の完全一致を要求しない。要求するのは1つのPlan内の
chain validity、すなわち先頭Stepの `expectedStateBefore` が
`PlanningInputSnapshot.initialExecutionState` にPlan開始effect（既存武器のTarget紐付け、
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11）を適用した状態と一致し（calculation schema 13以降。
開始effectはTargetの紐付けだけを変えるため、`targetExecutionStateHash` 以外の3 hashは
`initialExecutionState` と一致する。schema 12以前は完全一致）、Step Nの `expectedStateAfter`
が Step N+1 の `expectedStateBefore` と一致することである
([PLANNER_SPEC.md](./PLANNER_SPEC.md) 15.9.1)。12章の再計算不変条件と14.4の
Execution Transactionはこのchain validityに依存しており、B8で変更しない。

Planner constrained re-searchを経たPlanでは、`buildListEntriesHash` は最終
augmented PlannerInput全体を表す。したがって最終inputへ含めたPlanner-generated
BuildListEntryは、例外なくPlanと同一transaction内で保存する
([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.15)。

## 11.3 PlanStep

```ts
export interface PlanStep {
  id: PlanStepId;
  order: number;
  operationType: PlanStepOperationType;
  title: string;
  instruction: string;
  targetWeaponId: TargetWeaponId | null;
  buildListEntryId: BuildListEntryId | null;
  progressedTargetWeaponIds?: TargetWeaponId[];
  candidateId: BuildCandidateId | null;
  ownedWeaponId: OwnedWeaponId | null;
  expectedResult: ExpectedResult | null;
  expectedStateBefore: ExpectedPlanState;
  expectedStateAfter: ExpectedPlanState;
  inventoryChange: InventoryChange | null;
  rngAdvance: RngAdvance;
  // Execution lifecycle改訂で追加（PLANNER_SPEC 16.3）
  executionEffects: PlanStepExecutionEffects;
  requiresUserConfirmation: boolean;
  isCompleted: boolean;
  completedAt: ISODateTimeString | null;
  debug: PlanStepDebugInfo | null;
}
```

`executionEffects` の概念型。calculation schema 12の実装は下記と同じfield名で確定した
（`src/domain/models/planning.ts` の `PlanStepExecutionEffects`）。

TypeScript型では `PlanStep.executionEffects`、`ExpectedPlanState.targetExecutionStateHash`、
`PlanningInputSnapshot.dependentTargetDefinitionsHash` / `dependentBuildListEntriesHash` をoptionalとする。
`undefined` はcalculation schema 11以前に保存されたlegacy Planを表し、推測値で補完しない。
`CalculationContext.appSchemaVersion >= 12` のPlanではDomain validationがすべてを必須とし、
`reserve_weapon` / `confirm_result` Stepを拒否し、expected-state chainを検証する。

```ts
export interface PlanStepExecutionEffects {
  /** このStepが操作・登録する追跡武器。Counter進行用Normal作成Stepは null */
  trackedOwnedWeaponId: OwnedWeaponId | null;
  /** create_normal_artian Stepだけ非null */
  normalCreationRole: "counter_advance" | "production_target" | null;
  /** 作成対象Normalの登録。blindでは5枠をobservation bindingで受け取る */
  registersTrackedWeapon: boolean;
  observationBinding: { kind: "normal_restoration_bonuses" } | null;
  /**
   * このStepの確定時にTargetへ追跡武器を紐付ける（16.11）。calculation schema 13以降は、Plan内で
   * 新規登録する作成対象Normalの登録Stepだけが持つ。既存武器の紐付けはStepではなくPlan開始effect
   */
  targetLinks: { buildListEntryId: BuildListEntryId; targetWeaponId: TargetWeaponId }[];
  /** 選択済み妥協checkpoint到達で追跡武器をpracticalにする（16.12） */
  compromiseLabels: { buildListEntryId: BuildListEntryId; ownedWeaponId: OwnedWeaponId }[];
  /** 理想品完成とTarget完了（16.13） */
  targetCompletions: {
    buildListEntryId: BuildListEntryId;
    targetWeaponId: TargetWeaponId;
    ownedWeaponId: OwnedWeaponId;
  }[];
}
```

「Counter進行用」「この後巨戟化する作成対象」のUI区別は `normalCreationRole` だけをauthorityとする。
完成予定の目標武器数は `targetCompletions` だけをauthorityとする（[UI_FLOW.md](./UI_FLOW.md) 11.0）。

不変条件。

- `order` は1始まりの連番
- `isCompleted = true` の場合、`completedAt` は `null` ではない
- `requiresUserConfirmation = true` のStepは実行ナビで明示確認する
- 初期版ではPlanStepをまとめて完了する高速操作を提供しない
- Step実行前の実状態は `expectedStateBefore` と一致しなければならない
- 期待どおりの操作と更新を適用した後の実状態は `expectedStateAfter` と一致しなければならない
- 両方が一致して次Stepへ進む場合、Planをstaleにしない
- statusだけを変更する専用PlanStepは持たない。statusは物理Step（または `confirm_owned_ideal`）の
  execution effectとして、巨戟化時の `unclassified`、選択済み妥協checkpoint到達時の `practical`、
  理想品完成時の `ideal` だけが書き換わる。statusは非semanticであるため、ユーザーがOwned Weapons
  画面でラベルを変更しても実行中PlanのExpectedPlanState不一致にならない
- Candidate由来のStepは `buildListEntryId` を判断記録の主参照とし、`candidateId` はSnapshot内の追跡情報としてのみ使用する
- `progressedTargetWeaponIds` は、この1回の物理PlanStepでRoute進行が発生したTargetWeaponを記録するobservational metadataである
- `progressedTargetWeaponIds` は `targetWeaponId` / `buildListEntryId` を置き換えない。primary presentationとprimary Entry権威は従来どおりこの2 fieldが持つ
- 1つの物理操作が複数BuildListEntryを同時に進めた場合、`progressedTargetWeaponIds` はそれら全EntryのTargetWeaponを重複なく安定順で保持する。共有StepをEntry数だけ複製しない
- `targetWeaponId` が必ず `progressedTargetWeaponIds` に含まれるという契約は持たない。Planner-only Stepなど、Route進行を伴わないStepは空配列になり得る
- `progressedTargetWeaponIds` はoptionalである。`undefined` はこのfield導入前に保存されたlegacy Planを意味し、共有Route帰属は復元不能とする
- `undefined` から `[targetWeaponId]` を補完するなど、読み取り時のmigration / normalizationで共有Targetを推測してはならない
- `progressedTargetWeaponIds` はPlanStep identity、CalculationContext semantics、Planner / Search / RNG semanticsを変更しない。embedded dataの後方互換追加であり、Dexie indexed schemaもversionも変更しない
- TargetWeapon削除の参照保護は `targetWeaponId` と `progressedTargetWeaponIds` の双方を参照として扱い、それぞれ独立したpathとして報告する
- 素材用巨戟を登録する `create_material_gogma`、武器を素材として消費する
  `use_weapon_as_material`、旧PracticalをMaterialへ変える `change_owned_weapon_status` は
  current `PlanStepOperationType` に存在しない。保存済みlegacy artifactがこれらを含んでいても
  current Domain operationとして再実行せず、CalculationContext境界でfail closeする(14.2)
- current ProductionPlanは独立した `reserve_weapon` PlanStepを持たない。探索内部のreserve actionは、
  Entryの最後の物理Stepの `executionEffects.targetCompletions` へ統合する。操作0 Candidateの完成は
  RNGを進めない `confirm_owned_ideal` Stepで表す（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.3）。
  独立 `reserve_weapon` / `confirm_result` Stepを持つ保存済みlegacy Planは表示できても、current
  Execution operationとして実行しない
- `normal_artian_to_gogma` では、`count = forgeCount` を分割した作成Stepのうち最後の1本
  （`normalCreationRole = "production_target"`）だけが予約IDでNormalを登録する。先行Step
  （`counter_advance`）は登録しない。巨戟化Stepは同じIDを `kind = "gogma"`、`status = "unclassified"` へ
  更新し、以後のReset / Keep / Reset Skillsも同じIDを更新する
- blind variantの作成対象Stepは `observationBinding` を持ち、Step確定時にユーザーが入力した
  観測5枠で登録する。架空の5枠を生成しない
- `owned_normal_artian_to_gogma` のconvert Stepは元Normalと同じIDを `kind = "gogma"` へ更新する。
  元IDを削除して別のGogma IDを作らない。探索上の排他source semantics（同じNormalを別Routeで
  使わない）は維持する
- `existing_gogma_*` の各物理Stepは新規追加せず、Route sourceと同じGogma IDを逐次更新し、
  createdAtを失わない
- 妥協checkpointへ到達したStepは `compromiseLabels` で追跡武器を `practical` にする。保護と作成中状態は
  変更せず、Planは続く
- 理想品完成は、新規生成武器でも既存武器でも `status = "ideal"`、`isProtected = true`、作成中OFF、
  Target `completed`、`preferredOwnedWeaponId = null` とする。旧契約の「既存Gogmaは保存済みの保護状態を
  維持する」は廃止した
- OwnedWeaponへTarget IDを追加する処理は存在しない。`TargetWeapon.preferredOwnedWeaponId` はPlanner
  計算では変更せず、Plan開始effect（既存武器）と `targetLinks` / `targetCompletions` のExecution effect
  だけが変更する
- すべてのExecution effectはexpectedStateBefore / expectedStateAfterへ反映する（statusと作成中状態は
  hash対象外、11.2）
- 再計算はstale Planに対するUI / Planner操作であり、`recalculate_plan` PlanStepを旧Planへ追加しない

## 11.4 ExpectedResult

```ts
export interface ExpectedResult {
  restorationBonusScope: ArtianBonusScope | null;
  restorationBonuses: RestorationBonusSet | null;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  shouldSecure: boolean;
}
```

`shouldSecure` は独立した確保Stepを持つ旧契約のfieldである。current ProductionPlanでは、
そのStepで目標武器が完成するかどうかのauthorityを `PlanStep.executionEffects.targetCompletions` とし、
`shouldSecure` から完成予定を推測しない。calculation schema 12の実装では互換表示用にfieldを残し、
current Planでは `executionEffects.targetCompletions` が空でないStepだけ `true` とする（authorityにはしない）。

`candidateCategory` と `isSimilarToIdeal` は存在しない。PlanStepが表示するのは
予測結果そのものであり、category分類ではない。妥協checkpointへ到達したStepは
`PlanStep.checkpointMilestones` でそれを示す（11.3）。

Counter deltaの正式契約はcreate normalがNormal +1 / forge、conversionがSkill +1、Reset SkillsがSkill +1、Reset Bonuses / Keep BonusesがGogma +1である。conversionのGogma deltaは0とする。PRNG内部10 stepをDomain Counter deltaへ入れない。

`convert_normal_to_gogma` のExpectedResultは、変換元Normalからslot順のまま継承した `restorationBonusScope = "normal_artian"` の5枠と、変換時のSkill Predictionで付与された初回Series Skill / Group Skillを同時に保持する。Reset Bonuses結果は `restorationBonusScope = "gogma_artian"`、Keep Bonuses結果も `gogma_artian` とする。

`restorationBonuses = null` かつ `restorationBonusScope = null` は「このStepは復元ボーナス結果を予測しない」を表し、「復元ボーナスが存在しない」ではない。blind creation(`docs/SEARCH_SPEC.md` 6.1.1)の `create_normal_artian` Stepと、その直後の `convert_normal_to_gogma` Stepがこれに該当する。架空の5枠を表示しないために `null` を用い、Reset Bonuses以降は通常どおりknown resultを保存する。

## 11.5 InventoryChange

```ts
export interface InventoryChange {
  addOwnedWeapon: OwnedWeapon | null;
  removeOwnedWeaponIds: OwnedWeaponId[];
  updateOwnedWeapons: OwnedWeapon[];
  materialRequirements: MaterialRequirement[];
}
```

current ProductionPlanでは、`addOwnedWeapon` は作成対象Normalの登録、`updateOwnedWeapons` は追跡武器の
同一ID更新（巨戟化のkind変更を含む）と完成時のstatus / 保護を表す。所持Normalの巨戟化で
`removeOwnedWeaponIds` を使わない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.3）。blind作成対象の
`addOwnedWeapon` の5枠はStep確定時の観測値でbindする。

calculation schema 12の実装では、架空の5枠を作らないため、observation bindingがまだ有効な武器の
InventoryChangeにはOwnedWeapon本体を載せない（blind作成対象Stepは `addOwnedWeapon = null`、binding中の
巨戟化Stepは `updateOwnedWeapons = []`）。Execution serviceは `executionEffects` と観測値から登録・更新する。
InventoryChangeのOwnedWeaponはsemantic状態とstatus / 保護の予定値を表し、作成中状態、名称、日時は
16.10.1 / 16.3の規則に従いExecution serviceが確定する。Counter進行用Normal作成Stepの `inventoryChange` は `null` である。

## 11.6 RngAdvance

```ts
export interface RngAdvance {
  gogmaCounterDelta: number;
  skillCounterDelta: number;
  normalCounterDelta: number | null;
  affectedNormalCounterId: string | null;
}
```

`normalCounterDelta = null` は「このStepではNormal Counterの進行量を表現しない」を表し、「Normal Counterが進行しない」ではない。

blind creation(`docs/SEARCH_SPEC.md` 6.1.1)の `create_normal_artian` Stepは、実行時の現在stateによって次の2通りになる。

| 現在のNormalArtianCounter | `normalCounterDelta` | `affectedNormalCounterId` | `PlanStepDebugInfo.startNormalCounter` / `endNormalCounter` |
| --- | --- | --- | --- |
| `isConfirmed = true` かつ `counter !== null` | `1` | 対象Counter ID | 進行前値 / 進行後値 |
| unconfirmed、`counter = null`、またはrecordなし | `null` | `null` | `null` / `null` |

確定Counterが存在する場合は、Route operationの `normalCounterBefore` / `normalCounterAfter` が `null` であっても、物理的に通常アーティアを1本作成した事実としてCounterを1進める。進行には既存 `advanceNormalCounter()` authorityを使い、`counter + 1` を直接書かない。確定Counterが存在しない場合は `0` を記録せず、架空のCounter recordも作らない。Stepのtitle / instructionが通常アーティアを1本作成する物理操作であることを明示するので、どちらの場合も「Normal Counterは進行していない」とは表示しない。

## 11.7 PlanStepDebugInfo

```ts
export interface PlanStepDebugInfo {
  startBaseSeed: string | null;
  startGogmaCounter: number | null;
  endGogmaCounter: number | null;
  startSkillCounter: number | null;
  endSkillCounter: number | null;
  startNormalCounter: number | null;
  endNormalCounter: number | null;
  plannerReason: string;
}
```

通常画面では表示しない。設定でDebug ModeがONの場合のみ表示する。

## 11.8 PlanConflict

```ts
export interface PlanConflictCheckpointParticipant {
  buildListEntryId: BuildListEntryId;
  axis: IntermediateStateAxis;
  opportunityId: IntermediateStateOpportunityId;
}

export interface PlanConflict {
  id: string;
  kind: ConflictKind;
  buildListEntryIds: BuildListEntryId[];
  reason: string;
  recommendedBuildListEntryId: BuildListEntryId | null;
  selectedBuildListEntryId: BuildListEntryId | null;
  resolutionNote: string | null;
  /**
   * 選択済み途中採用状態の終端unitとしてこの競合に参加するEntryとそのlane。
   * schema 10で追加したoptional fieldであり、省略は空と同義である
   * (PLANNER_SPEC 9.5)。
   */
  checkpointParticipants?: PlanConflictCheckpointParticipant[];
}
```

競合選択は `PlannerConflictResolution` として次回PlannerInputへ渡す。
`conflictKey` は安定したPlanConflict IDに対応し、選択はその局所競合だけを解決する。
削除済み、stale、Target無効、Capability不足、保護状態変更で実行不能なEntry選択は適用せずwarningとする。

`checkpointParticipants` が1件以上ある競合は、汎用の `PlannerConflictResolution` で
解決できない。どちらを優先してももう一方の選択済みcheckpointを落とすためであり、
Domainは `selectedBuildListEntryId` を `null` のままにして
`invalid_conflict_resolution` を返す。constrained re-searchの固定制約準備と
preflight再対応付けも `checkpoint_conflict` で失敗する。解決は作成リストでの
checkpoint変更または解除だけである([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.5.1)。
また、選択済みcheckpointを持つTargetのRouteはconstrained re-searchで置き換えない
(同 9.5.2)。

`PlanConflict.id` はPlannerIdFactoryで生成せず、次のsemantic dataをstable serialize / hashして
決定的に生成する。BuildListEntry IDは重複排除してsortし、Candidate IDは使用しない。

- same_gogma_counter: kind、Gogma Counter位置、BuildListEntry IDs
- same_skill_counter: kind、Skill Counter位置、BuildListEntry IDs
- same_normal_counter: kind、NormalArtianCounter ID、Normal Counter位置、BuildListEntry IDs
- same_owned_weapon_consumed: kind、OwnedWeapon ID、BuildListEntry IDs

`convert_normal_to_gogma` はsame_skill_counterの位置を使用し、same_gogma_counterへ分類しない。same_gogma_counterはReset Bonuses / Keep Bonusesが同じGogma位置を排他的に必要とする場合に使用する。

`recommendedBuildListEntryId` はユーザー提示用の推奨であり、Planner constrained
re-searchの固定制約authorityではない。固定authorityは
`PlannerConflictResolution.selectedBuildListEntryId` だけとする
([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.7)。
B8 orchestrationのconflict context DTOは非永続transientであり、`PlanConflict` を
置き換えず、`ProductionPlan` へも埋め込まない(同 9.2.3)。

`PlanConflict.id` はsort済みBuildListEntry IDsを含むため、Planner-generated Entryを
加えたaugmented PlannerInputでは、同じ物理競合でもIDが変わり得る。
このID生成規則自体はB8で変更しない。代わりにorchestrationが、ConflictKindと
kind別競合位置だけからなる非永続の競合資源identityを保持し、full Beam Searchの前の
initial conflict preflightで `PlannerConflictResolution.conflictKey` を現在の
`PlanConflict.id` へ対応付け直す(同 9.2.3.1)。`same_owned_weapon_consumed` の
競合資源identityは排他消費されるOwnedWeapon IDであり、participantの
`sourceOwnedWeaponId` とは別物である。

再対応付けの対象は、元のvalidated PlannerInputが持つ**全ての**valid
`PlannerConflictResolution` とする。generated Entry追加で参加者集合が変われば、
今回の再検索対象ではない別Conflictの `PlanConflict.id` も変わり得るためである。
全fixed constraintが一意に対応できた場合だけ完全な `PlannerConflictResolution[]` を
再構築し、1件でも対応付けできない場合はfail closedとする。他のユーザー明示
resolutionを黙って捨ててはならない。

Issue #136 / #101の正式仕様（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.19。Search Domain APIだけPhase 1まで
実装済みで、本段落のConflict保存規則は未実装）では、
「この候補を優先」はRoute単位の決定になる。保存するPlanの `conflicts` は最終full runが最新状態から検出したもの
だけであり、旧Planの一覧から解決済みを消す方式をauthorityにしない。代替を採用できなかった無効化Entryが残る場合、
participantがfixed Entryと今回の無効化Entryだけからなる全Conflictに `selectedBuildListEntryId = fixed Entry` を
記録する（決定の展開）。`PlanConflict` の型と `id` の生成規則は変えない。

同じ論理競合は再Plannerでも同じID、位置・参加Entry・対象資源が変われば別IDになる。
第9の競合適用時はconflictKeyが再検出した競合と一致し、selectedBuildListEntryIdがその
競合のbuildListEntryIdsに含まれる場合だけresolutionを適用する。

Planner warningの上限到達は次の2種を区別する。

```text
max_steps_reached
```

maxPlanSteps到達時だけ使用し、途中のbest Planとwarningを同時に返してよい。Beam Search oracleの
`maxExpandedStates` 到達はwarning kindを持たず、`PlannerBeamSearchTermination.reachedLimits` の
`max_expanded_states` だけで表す（Issue #103 Phase D-2bで `max_expanded_states_reached` を削除した）。

## 11.9 RejectedBuildListEntry

```ts
export interface RejectedBuildListEntry {
  buildListEntryId: BuildListEntryId;
  reason:
    | "lower_priority"
    | "resource_conflict"
    | "longer_route"
    | "already_satisfied"
    | "requires_protected_weapon"
    | "dominated_by_better_candidate";
  detail: string;
}
```

---

## 12. 実行履歴

```ts
export interface ExecutionHistory {
  id: ExecutionHistoryId;
  planId: ProductionPlanId;
  planStepId: PlanStepId;
  action: ExecutionAction;
  actualResult: ActualResult | null;
  wasExpected: boolean;
  recalculationReason: RecalculationReason | null;
  undoSnapshot: ExecutionUndoSnapshot;
  createdAt: ISODateTimeString;
}

export interface ActualResult {
  // Execution lifecycle改訂で追加。restorationBonusesと同時にnull / 非null
  restorationBonusScope: ArtianBonusScope | null;
  restorationBonuses: RestorationBonusSet | null;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  // legacy: 独立した確保Stepを持つ旧Planの記録
  securedOwnedWeaponId: OwnedWeaponId | null;
  note: string | null;
}

export interface ExecutionUndoSnapshot {
  rngStateBefore: RngState;
  normalCountersBefore: NormalArtianCounter[];
  affectedOwnedWeaponsBefore: OwnedWeapon[];
  addedOwnedWeaponIds: OwnedWeaponId[];
  removedOwnedWeaponsBefore: OwnedWeapon[];
  // Execution lifecycle改訂で追加（PLANNER_SPEC 16.16）
  affectedTargetWeaponsBefore: TargetWeapon[];
  productionPlanBefore: ProductionPlan;
  // Execution lifecycle改訂で追加。このStepの確定前に存在したそのPlanのゲーム内セーブ地点
  executionSavePointBefore: ExecutionSavePoint | null;
}
```

ExecutionActionの意味（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.4）。

| action | 内容 |
| --- | --- |
| `confirmed_expected` | 結果一致・次へ、blind作成対象の観測値入力（`actualResult` に観測値）、操作0 Idealの確認 |
| `actual_result_different` | 操作は明確だが結果が予測と違う。Counter消費と実結果を保存しPlan stale |
| `operation_uncertain` | 何を何回操作したか不明。Counterと武器を変更せずPlan stale |
| `operation_count_recovered` | `operation_uncertain` 後、現在のゲーム結果とPlanの `expectedResult` 列からRecovery Window内の現在位置を一意に特定し、区間内StepをPlanどおりreplayしてアプリ状態を追従させた。Plan active / completed |
| `finished_as_compromise` | 妥協checkpoint到達後に妥協品として確定して終了。Plan abandoned |

不変条件。

- ExecutionHistoryはPlanとは別に保存する
- `affectedTargetWeaponsBefore` は、そのStepのExecution effectで変更したTargetWeapon（紐付けを設定した
  Target、紐付けを解除された別Target、完了にしたTarget、理想品完成で完成武器の優先起点を解除された
  他のすべてのTarget）のStep前の本体を保持する
- `executionSavePointBefore` は、Step確定または `finished_as_compromise` のtransactionでゲーム内セーブ地点を
  削除した場合にUndoで復元するために保持する
- `operation_uncertain` ではRngState、NormalArtianCounter、OwnedWeapon、TargetWeaponを変更しないが、
  Planの `stale` 化を戻せるようにSnapshotは保存する
- `operation_count_recovered` は中間Stepごとの `confirmed_expected` を捏造せず1件だけ記録する。
  `planStepId` は追従で到達した最後のStep（位置0の追従では `operation_uncertain` 記録のStep）、
  `productionPlanBefore` は追従直前の `stale` Planである
- Step確定前に `ExecutionUndoSnapshot` を生成し、同じTransactionでExecutionHistoryへ保存する
- `normalCountersBefore` は実装を単純化するため全NormalArtianCounterを保存する
- `affectedOwnedWeaponsBefore` は更新対象としてStep開始前に存在した武器、`addedOwnedWeaponIds` はStepで新規追加した武器ID、`removedOwnedWeaponsBefore` はStepで削除した武器本体を保持する
- 3つのOwnedWeapon集合は役割を重複させず、最後のExecutionHistoryだけでStepによる在庫変更を正確に取り消せること
- `productionPlanBefore` はStep完了、currentStepId、status、recalculationReasonsを含む更新前Plan全体を保持する
- Undoは表示中の実行Planの最後のExecutionHistoryのSnapshotを適用し、そのExecutionHistoryを削除する。Undo自体のExecutionHistoryは追加しない
- Undoできるのは、Planが `active` / `stale` の場合と、`completed` / `abandoned` への遷移を起こしたのがそのExecutionHistory自身（最終Step確定、Planを完了させた `operation_count_recovered`、`finished_as_compromise`）の場合だけである。再計画採用、ユーザー破棄、Planを壊す変更の承認で `abandoned` になったPlanのExecutionHistoryはUndoできない
- Undoは少なくともRngState、全NormalArtianCounter、OwnedWeapon（status・`executionInProgress` を含む）、Executionが変更したTargetWeapon、ProductionPlan（status、abandonment理由、`currentStepId`）、ゲーム内セーブ地点を正確に戻す。取り消すExecutionHistoryがゲーム内セーブ地点の `lastExecutionHistoryId` なら、そのセーブ地点を削除する
- Undoはツール上の誤操作修正であり、ゲーム内操作を巻き戻すものではない
- `wasExpected = false` の場合、Planを `stale` にして再計算導線を出す
- action別の記録形状: `confirmed_expected` は `wasExpected = true`、`recalculationReason = null`。
  `actual_result_different` は `wasExpected = false`、`recalculationReason = "unexpected_result"`、`actualResult` 非null
  （`securedOwnedWeaponId = null`）。`operation_uncertain` は `wasExpected = false`、
  `recalculationReason = "execution_operation_uncertain"`、`actualResult = null` で、Undo Snapshotの
  OwnedWeapon / TargetWeapon集合（`affectedOwnedWeaponsBefore`、`addedOwnedWeaponIds`、`removedOwnedWeaponsBefore`、
  `affectedTargetWeaponsBefore`）はすべて空とする。`operation_count_recovered` は `wasExpected = true`、
  `recalculationReason = null`、`actualResult` 非null（`securedOwnedWeaponId = null`。最後の観測であり、5枠と
  scopeを持つならSeries / Group Skillは `null`、5枠が `null` ならSkill観測）、`removedOwnedWeaponsBefore` は空とする。
  legacy actionと `finished_as_compromise` は汎用検証だけを行う
- `ActualResult.seriesSkillId` / `groupSkillId` は非nullなら空でないIDとする。`note` はnullまたは文字列で、
  Runtimeの判定には使わない

## 12.1 ExecutionSavePoint（ゲーム内セーブ地点）

Execution lifecycle改訂で追加する永続entity（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.9）。
妥協checkpoint（BuildListEntryの途中採用状態）とは別概念であり、名称にcheckpointを使わない。

```ts
export interface ExecutionSavePoint {
  id: string;                         // 1 Planにつき1件。productionPlanIdから決定してよい
  productionPlanId: ProductionPlanId;
  lastExecutionHistoryId: ExecutionHistoryId | null;
  rngState: RngState;
  normalCounters: NormalArtianCounter[];   // 全件
  ownedWeapons: OwnedWeapon[];             // execution scope
  targetWeapons: TargetWeapon[];           // execution scope
  productionPlan: ProductionPlan;
  recordedAt: ISODateTimeString;
}
```

不変条件。

- ユーザーの明示操作「ゲーム内セーブ済みとして記録」だけで作成・上書きする。アプリはゲーム側の
  セーブ発生を推測しない
- `productionPlanId` のPlanが `active` の場合だけ記録でき、1 Planにつき最新1件だけ保持する
- execution scopeのOwnedWeaponは、Plan依存EntryのRouteが参照する所持武器、このPlanのExecutionが
  登録した武器、このPlanを `executionInProgress` に持つ武器の和集合とする。execution scopeの
  TargetWeaponは、Plan依存Targetと、execution scopeの武器を `preferredOwnedWeaponId` に持つTargetの
  和集合とする
- 復元は `active` / `stale` のPlanについて1つのDexie transactionで行い、Executionに関係するゲーム対応
  状態だけを戻す。書き込み前に同じtransaction内で、復元後のProductionPlanが必要とするentity
  （snapshotの全OwnedWeapon、復元後PlanのPlan依存Target、
  `selectedBuildListEntryIds` のBuildListEntry）が現在すべて存在することを検証する。1つでも欠損して
  いれば復元を拒否し、RngState、NormalArtianCounter、OwnedWeapon、TargetWeapon、ProductionPlan、
  ExecutionHistory、ExecutionSavePointのいずれも変更しない（fail closed）。欠損entityを自動復活させない。
  snapshot内のPlan非依存Targetの欠損は拒否理由にせず、そのTargetは復元しない。セーブ地点より後に追加したPlan非依存Target、Build List Entry、execution scope外の
  所持武器、設定を巻き戻さず、ユーザーが削除したentityを復活させない。セーブ地点より後のそのPlanの
  ExecutionHistoryは削除する（手順は同 16.9）
- Planが `completed` / `abandoned` になったtransaction、および境界のExecutionHistoryをUndoした
  transactionで削除する。再計画採用で新Planへ引き継がない

---

## 13. 設定

```ts
export const APP_SETTINGS_SCHEMA_VERSION = 2;

export interface CandidateSearchDefaults {
  maxNormalAdvance: number; // 通常アーティア最大進行量
  maxGogmaAdvance: number;  // 復元ボーナス最大進行量
  maxSkillAdvance: number;  // スキル最大進行量
}

export interface AppSettings {
  id: "settings";
  schemaVersion: 2;
  debugMode: boolean;
  resultPageSize: number;
  defaultSearchLimit: number;
  candidateSearchDefaults: CandidateSearchDefaults;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

初期値。

```ts
const recommendedCandidateSearchDefaults = {
  maxNormalAdvance: 350,
  maxGogmaAdvance: 500,
  maxSkillAdvance: 1500,
};

const defaultSettings: AppSettings = {
  id: "settings",
  schemaVersion: 2,
  debugMode: false,
  resultPageSize: 50,
  defaultSearchLimit: 5000,
  candidateSearchDefaults: { ...recommendedCandidateSearchDefaults },
  createdAt: now,
  updatedAt: now,
};
```

`candidateSearchDefaults`（Issue #125、[REQUIREMENTS.md](./REQUIREMENTS.md) 14.1）は、候補検索画面を開いたときの
探索量の初期値としてユーザーが設定画面で保存する値である。

- 各値は1以上の整数とする（`validateCandidateSearchDefaults()`、`validateAppSettings()`）。3値の大小関係は
  検証しない。推奨値の「通常アーティア < 復元ボーナス」は、通常アーティアCounterが武器種ごとの固有Counter
  であるのに対し、Gogma Counterは複数の武器で共有され別の武器の生産工程でも進められる可能性があることに
  よる推奨であり、Validation上の制約ではない。上限値は設けない
- 推奨値の単一authorityは `recommendedCandidateSearchDefaults`（`src/domain/models/common.ts`）とし、
  新規record、全データ削除後のdefault record、AppSettings v1 -> v2 migration（Dexie v9、Export schema 12）、
  Search Domainの `defaultCandidateSearchSettings` が共有する。Search DomainはAppSettings / SettingsRepositoryへ
  依存しない
- 書き込むのは設定画面の保存だけであり（`SettingsRepository.setCandidateSearchDefaults()`）、候補検索画面は
  読み取るだけで、画面上の一時変更を書き戻さない
- Debug Mode保存と既定値保存は、record全体ではなく変更したfieldだけを原子的に更新する
  （Dexie `Table.update()`）。同時に保存しても、古い読み取り結果で他方のfieldを上書きしない。
  書き込み前に更新後のrecord全体を `validateAppSettings()` で検証し、不正値は書き込まない
- 計算意味を持たない。CalculationContext、`searchStateHash`、Candidate / Entry / Plan identity、stalenessに入らない
- `defaultSearchLimit` は通常アーティアCounter特定の初期検索範囲の終了値であり、`candidateSearchDefaults` とは
  別の設定である。相互に流用・再定義しない

AppSettings v1（`schemaVersion = 1`、`candidateSearchDefaults` なし）はDexie v8 -> v9 upgradeとExport
schema 11 -> 12 migrationで共通の `upgradeAppSettingsToV2()` によりv2へ変換する。旧候補検索画面の固定値
（500 / 350 / 1500）はユーザーが保存した値ではないため、`candidateSearchDefaults` には推奨値
350 / 500 / 1500 を設定し、`debugMode`、`resultPageSize`、`defaultSearchLimit`、日時はそのまま保持する。
v1でないrecord（既にfieldを持つ、別versionなど）は推測変換せず、validationに判断を委ねる。

---

## 14. Dexie保存設計

## 14.1 DB名

```text
mh-wilds-gogma-artian-planner
```

## 14.2 DB schemaVersion

初期作成schemaは1。現行DATABASE_SCHEMA_VERSIONは9。version(1)のstoresを保持し、
version(2) upgradeでTarget妥協条件だけを解除する。Idealと他entityを保持し、compromiseNeedsReview=trueとする。
旧Practical Skillも解除するため、移行直後はIdeal-onlyとなる。

version(3) upgradeで `OwnedWeapon.relatedTargetWeaponIds` をTarget側の
`preferredOwnedWeaponId` へ置き換える。v1 -> v2 -> v3は順番に適用できること。

- 全TargetWeaponを `preferredOwnedWeaponId = null` とする
- 全OwnedWeaponから `relatedTargetWeaponIds` を削除する
- 旧 `relatedTargetWeaponIds` から新しいpreferred関係を推測しない。旧fieldは「どのTargetに
  関連して記録されたか」というprovenance metadataであり、1対多・多対多になり得る。新しい
  「このTargetを作る際の優先起点」とは意味が異なるため変換しない
- BuildCandidate / BuildListEntry / ProductionPlan / ExecutionHistory等の過去artifactは
  migrationで内容を書き換えず、exact persisted historyを保持する。互換性はCalculationContext
  境界(3.5)でfail closedにする

version(4) upgradeで所持巨戟アーティアの `status = "material"` を `"unclassified"` へ
改名する。v1 -> v2 -> v3 -> v4は順番に適用できること。

- `status === "material"` の巨戟アーティアだけを `"unclassified"` へ変換する
- `"practical"` / `"ideal"` はそのまま維持し、通常アーティアの `status = null` も維持する
- `isProtected` を変更しない。旧Material武器がユーザー設定で保護されていた場合も保護を維持する
- `TargetWeapon.preferredOwnedWeaponId` を変更しない
- 保存済みartifact内の `use_weapon_as_material`、`create_material_gogma`、
  `change_owned_weapon_status`、`status = "material"` をcurrent operation / statusへ
  推測変換しない。過去artifactは保存内容を保持し、CalculationContext境界(3.5)で
  fail closedにする。UIで表示する場合も、legacy operationをcurrent Domain operationとして
  再実行可能にしない

version(5) upgradeでExecution lifecycleの永続状態を追加する。v1 -> v2 -> v3 -> v4 -> v5は
順番に適用できること。

- 全TargetWeaponを `lifecycleStatus = "active"`、`completedAt = null`、
  `completedByProductionPlanId = null` とする。所持Ideal武器の存在から `completed` と推測しない
- 全OwnedWeaponを `executionInProgress = null` とする。既存Planから作成中と推測しない
- `executionSavePoints` table（key: `id`、index: `&productionPlanId`、`recordedAt`）を空で追加する。
  ExecutionHistoryからゲーム内セーブ地点を推測しない。IDはPlan IDから決定し
  （`executionSavePointIdForPlan()`）、unique indexは1 Plan 1件の二重の防御である
- `targetWeapons` へ `lifecycleStatus` indexを追加する
- BuildCandidate / BuildListEntry / ProductionPlan / ExecutionHistoryの過去artifactは書き換えない
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` はこのupgradeでは変更しない（3.5）

version(6) upgradeでProductionPlanのlifecycle metadata（`abandonmentReason`、`abandonedAt`、
`completedAt`、11.1）を追加する。table / indexは変更しない。v1 -> ... -> v5 -> v6は順番に適用できること。

- version 6より前のruntimeはPlanを `draft` でしか保存せず、`completed` / `abandoned` への遷移も
  ExecutionHistoryの書き込みも行っていない
- lifecycle fieldを持たない `draft` / `active` / `stale` のPlanだけに3 fieldの `null` を補完する。
  statusが許す唯一の値であり推測ではない。ゲーム内セーブ地点snapshot内のPlanにも同じ規則を適用する
- `completed` / `abandoned` のPlanは完了日時・破棄理由が記録されていないため、`completedAt = updatedAt`、
  `user_abandoned` などを推測せず保存内容のまま残し、Domain validationでfail closedにする
- ExecutionHistoryは書き換えない。旧Undo Snapshotには `affectedTargetWeaponsBefore` /
  `executionSavePointBefore` が無く再構成できないため、保存内容のまま残しUndo対象にしない
- `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は変更しない（12のまま）

version(7) upgradeでIdentification provenance `lastIdentifiedAt` をRngState（record schemaVersion 2）と
NormalArtianCounterへ追加する（6.1 / 6.2）。table / indexは変更しない。v1 -> ... -> v6 -> v7は順番に適用できること。

- `rngState` / `normalArtianCounters` tableの全record、ゲーム内セーブ地点snapshot内の `rngState` / `normalCounters`、
  ExecutionHistory Undo Snapshot内の `rngStateBefore` / `normalCountersBefore`、およびUndo Snapshotが
  `executionSavePointBefore` として保持するセーブ地点内の `rngState` / `normalCounters` のすべてに
  `lastIdentifiedAt = null` を補完し、RngState bodyは `schemaVersion = 2` にする
- 値は常に `null`（「正式なIdentification採用が記録されていない」）である。旧runtimeは採用時刻を記録していない
  ため、`updatedAt`、`lastObservedAt`、`source = observation` から採用時刻を推測してbackfillしない
- 既にfieldを持つbodyは変更しない
- reminder / recovery用のprovenanceであり、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` は変更しない（13のまま）

version(8) upgradeで `status = "draft"` のProductionPlanを全件削除する（11.1のDraft最大1件契約）。
table / indexは変更しない。v1 -> ... -> v7 -> v8は順番に適用できること。

version(9) upgradeでAppSettingsをrecord schemaVersion 2へ更新する（13、Issue #125）。
table / indexは変更しない。v1 -> ... -> v8 -> v9は順番に適用できること。

- `settings` tableのAppSettings v1 recordに `candidateSearchDefaults = { maxNormalAdvance: 350,
  maxGogmaAdvance: 500, maxSkillAdvance: 1500 }` を補完し、`schemaVersion = 2` にする
- `debugMode`、`resultPageSize`、`defaultSearchLimit`、`createdAt`、`updatedAt` は変更しない。旧候補検索画面の
  固定値（500 / 350 / 1500）は保存されていなかったため引き継がず、`defaultSearchLimit` を流用しない
- settings recordが無いDBでは何も作成しない。v1でないrecordは変更しない
- 他のtableは変更しない。計算意味を変えないため `CURRENT_CALCULATION_APP_SCHEMA_VERSION`（14）と
  `PRODUCTION_RNG_ENGINE_VERSION` は変更しない

- 旧契約ではPlanner保存のたびにDraftが旧Draftの横へ追加され、一覧・削除UIも無かったため、Draftは
  何件でも蓄積し得た。どのDraftがユーザーの意図した「現在Draft」かを示すauthorityは永続データに
  無いため、`createdAt` / `updatedAt` / ID順などから残すDraftを推測せず、全Draftを削除する
- `active` / `stale` / `completed` / `abandoned` のPlan、BuildListEntry（Draftが参照していたEntryを
  含む。Draft削除はEntryへcascadeしない）、BuildCandidate、TargetWeapon、OwnedWeapon、ExecutionHistory、
  ExecutionSavePoint、RngState、NormalArtianCounter、Settingsは変更しない
- `TargetWeapon.completedByProductionPlanId` や `OwnedWeapon.executionInProgress` がDraftを指す
  データは正規lifecycle上存在しないため、Draft削除に合わせた推測修正を行わない
- Persistence lifecycle契約の変更であり、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` は変更しない（13のまま）

```ts
db.version(1).stores({
  rngState: "id",
  normalArtianCounters: "id, [weaponTypeId+rarity], isConfirmed",
  ownedWeapons: "id, weaponTypeId, elementId, status, isProtected, updatedAt",
  targetWeapons: "id, weaponTypeId, elementId, priority, isEnabled, updatedAt",
  buildCandidates: "id, targetWeaponId, searchStateHash, searchRunId, createdAt",
  buildListEntries: "id, candidateId, targetWeaponId, searchStateHash, isStale, createdAt",
  productionPlans: "id, status, createdAt, updatedAt",
  executionHistory: "id, planId, planStepId, createdAt",
  settings: "id"
});
```

## 14.3 Table方針

`ProductionPlan.steps` は初期版ではPlan内配列として保存する。

理由。

- PlanStepはPlan単位で読み書きする
- 初期版では巨大なPlanを想定しない
- 実装を単純化できる

将来PlanStepが大量化した場合のみ `planSteps` tableへ分離する。

Execution lifecycle改訂（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16章）では、ゲーム内セーブ地点を保存する
`executionSavePoints` table（key: `id`、index: `&productionPlanId`、`recordedAt`）と、TargetWeaponの
`lifecycleStatus` indexをDexie version(5)で追加した（14.2）。ProductionPlan / PlanStep /
ExecutionHistoryのembedded field追加に伴うversion境界は、それらを実装する後続PRで監査して確定する。
upgradeで既存Targetを `completed`、既存OwnedWeaponを作成中と推測しない。
calculation schema 12のPlanStep `executionEffects`、ExpectedPlanStateの `targetExecutionStateHash`、
PlanningInputSnapshotの依存hashはPlan内embedded fieldであり、table / indexを変えないため
Dexie versionを上げていない（`DATABASE_SCHEMA_VERSION = 5` のまま）。Execution runtimeの実装PRで
ProductionPlan lifecycle metadataのdata-only upgradeとしてversion(6)を追加した（14.2）。

## 14.4 Execution Transaction

Execution Navigatorの1Step確定処理は、次の更新を1つのDexie read-write transactionで原子的に行う。

- 同じtransaction内で現在状態を読み、`expectedStateBefore` を検証する
- Step実行前状態からExecutionUndoSnapshotを作成する
- RngStateを更新する
- NormalArtianCounterを更新する
- OwnedWeaponを追加、更新する（作成対象Normalの登録、同一ID更新、status、保護、作成中状態）
- TargetWeaponを更新する（紐付けの設定と別Targetの解除、完了、完成時のpreferred解除）
- 期待成功経路では `expectedStateAfter` を検証する
- ExecutionHistoryを追加する
- PlanStepを完了またはstaleとして更新する
- ProductionPlanのcurrentStepId、status、recalculationReasons、abandonment理由、updatedAtを更新する
- Planが `completed` / `abandoned` になる場合は、そのPlanのゲーム内セーブ地点を削除し、作成中状態を解除する

対象操作は、結果一致（観測値入力と操作0 Idealの確認を含む）、想定外結果記録、操作内容不明の記録、
妥協品として確定して終了とする（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.4）。Transaction内のいずれかが
失敗した場合は全更新をrollbackし、Step確定前の状態を維持する。

UndoもRngState、全NormalArtianCounter、対象OwnedWeapon、対象TargetWeapon、ProductionPlan、ゲーム内
セーブ地点、ExecutionHistoryを1つのDexie transactionで復元する。復元途中に失敗した場合はUndoを適用せず、
元の状態と履歴を維持する。

次も1つのDexie transactionで原子的に行い、失敗時は何も変更しない。

- 再計画採用: 状態再検証、旧実行中Planの `abandoned`（`replan_adopted`）、新Planの保存と `active` 化、
  generated BuildListEntryの保存、旧Planのセーブ地点削除、作成中状態の付け替え / 解除
- ゲーム内セーブ地点の復元（12.1）
- Planを壊す変更の承認: Planの `abandoned`（`breaking_change_approved`）と変更の保存
- Plan破棄: Planの `abandoned`（`user_abandoned`）、セーブ地点削除、作成中状態の解除
- 操作内容不明後の現在位置追従（`operation_count_recovered`、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15）:
  前提の再確認、Recovery Windowと候補の再導出、区間内Stepのreplay（RngState、NormalArtianCounter、OwnedWeapon、
  TargetWeapon、Step完了、Planの `active` / `completed` 化）、各Stepの `expectedStateAfter` と最後の観測の検証、
  ExecutionHistory追加。Planが完了した場合だけセーブ地点を削除する

Planを壊す変更の承認はRuntimeとして実装済みである（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.6の
実装上の確定事項）。RngState、NormalArtianCounter、OwnedWeapon、TargetWeapon、BuildListEntryを変更し得る
通常保存は、`active` Planの有無にかかわらず同じguard transactionを通り、永続状態との差分だけを書き込む。
「最後のゲーム内セーブ地点へ戻す」を選んだ場合は、セーブ地点の復元、変更の保存、Planの `abandoned` 化、
セーブ地点後のExecutionHistoryと登録武器の削除、セーブ地点の削除を同じtransactionで行う。新しい永続fieldは
追加しない。警告・確認ダイアログのUIは `PlanBreakingChangeDialog` /
`usePlanBreakingChangeApproval`（`src/components/execution/`）として接続済みである。
通常保存前のinspectionと承認付き再保存を同じApplication Serviceへ委譲し、
セーブ地点の選択が必要な場合だけ16.10の選択肢を表示する。

## 14.5 Planner Save Transaction

Planner constrained re-searchを経たPlan保存も原子的に行う。契約本文は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.15にある。

- Planner-generated BuildListEntry群と `ProductionPlan` を1つのDexie
  read-write transactionで保存する
- Planだけ、またはEntryだけが残るpartial saveを禁止する
- 保存直前にcurrent stateを再読込・再validationし、失敗時は何も書き込まない
- Planner Domain / WorkerはIndexedDBへ直接アクセスしない。この保存は
  Application / Persistence層の責務とする
- 同じtransactionで、既存の `draft` ProductionPlanを全件削除してから新Draftを追加する
  （旧Draftのatomic replacement、11.1）。transaction終了時のDraftは新Draft 1件だけになる
- current state再validation、CalculationContext validation、generated Entry validation /
  collision、Plan reference validation、generated Entryのadd、新Draftのadd、Dexie writeの
  いずれかが失敗した場合はtransaction全体をrollbackし、旧Draftは残り、新Draftもpartialな
  generated Entryも存在しない。旧Draftを先に別transactionで削除しない
- 削除するのはDraft recordだけであり、旧Draftが参照していたBuildListEntry / BuildCandidate /
  TargetWeaponをcascade deleteしない。`active` / `stale` / `completed` / `abandoned` のPlanも
  削除しない
- 同じtransactionで、正式採用したgenerated Entryが失う側Targetの元Entryを置換する（元Entryの削除 +
  generated Entryの追加、Phase 0-3で実装済み）。これはDraft置換に伴うcascade deleteではなく、Build List
  cardinalityの置換である。transaction内で各generated EntryのTargetの永続Entryが、計算時に置換対象とした
  元Entry 1件だけであることを確認し、異なれば `planner_state_changed` で何も書かない（現在のEntryを推測で
  削除しない）。置換後の永続予定集合は `validateBuildListCardinality()` で検証する。元Entryが `active` Planの
  Plan依存Entryなら、保存全体を1つのguarded mutationとして既存Plan-breaking guardで判定し、承認が無ければ
  `plan_breaking_change_approval_required` で何も保存しない（事前確認は
  `inspectPlannerOrchestrationResultSave()`）。承認時（「現在地点を維持」または選択なし）はEntry置換・旧Draft削除・
  新Draft追加・active Planの `abandoned`（`breaking_change_approved`）を同一transactionで行う。承認で
  「最後のゲーム内セーブ地点へ戻す」を選んだ場合はセーブ地点復元だけを行い、復元前に計算したPlanner resultは
  保存しない（Entry・Draft・Planを変更せず、復元後の状態からの再計算を求める。[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.10）。元Entryを参照するのがDraft / stale /
  終了済みPlanだけならguard対象にしない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.18）

新しいtableもDexie schema versionの変更も伴わない。`buildListEntries` と
`productionPlans` の既存tableをそのまま使う（Draft最大1件契約自体はDexie v8で既存Draftを
全削除して導入した、14.2）。

---

## 15. Export / Import

## 15.1 ExportRoot

```ts
export interface ExportRoot {
  schemaVersion: 12;
  appName: "mh-wilds-gogma-artian-planner";
  exportedAt: ISODateTimeString;
  rngState: RngState | null;
  normalArtianCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
  targetWeapons: TargetWeapon[];
  buildCandidates: BuildCandidate[];
  buildListEntries: BuildListEntry[];
  productionPlans: ProductionPlan[];
  executionHistory: ExecutionHistory[];
  executionSavePoints: ExecutionSavePoint[];
  settings: AppSettings;
}
```

Execution lifecycle改訂（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.17）で追加する永続状態
（TargetWeapon lifecycle、OwnedWeapon `executionInProgress`、ProductionPlan abandonment、PlanStep
`executionEffects`、ExpectedPlanState `targetExecutionStateHash`、ExecutionHistory / Undo Snapshotの拡張、
`executionSavePoints`）はExport / Importの対象である。ExportRootへ `executionSavePoints:
ExecutionSavePoint[]` を追加し、Import時は参照整合性（Plan、ExecutionHistory、OwnedWeapon、TargetWeapon）を
検証する。端末間同期は追加せず、既存の全置換Import / Exportで扱う。

永続Entity基盤の実装PRで `schemaVersion` を7へ更新し、`executionSavePoints` を追加した。
TargetWeapon lifecycleとOwnedWeapon `executionInProgress` もschema 7の形状に含まれる。
Import準備（`prepareExportRootForImport()`）はschema 7をそのまま、schema 6を純粋関数
`migrateExportRootV6ToV7()` で読み、それ以外のschemaVersionを拒否する。schema 6からの移行は
Targetを `active` / `completedAt = null` / `completedByProductionPlanId = null`、OwnedWeaponを
`executionInProgress = null`、`executionSavePoints = []` とするだけで、ゲーム状態を推測しない。
BuildCandidate / BuildListEntry / ProductionPlan / ExecutionHistoryは内容を変換しない。schema 6を
名乗りながらschema 7のfieldを持つrecordは拒否する。

calculation schema 12の実装PRで `schemaVersion` を8へ更新した。schema 8はProductionPlanの
calculation schema 12形状（PlanStep `executionEffects`、`confirm_owned_ideal`、ExpectedPlanStateの
`targetExecutionStateHash`、PlanningInputSnapshotの依存hash）を含む。Import準備はschema 8をそのまま、
schema 7を純粋関数 `migrateExportRootV7ToV8()`、schema 6を `migrateExportRootV6ToV7()` の後に
`migrateExportRootV7ToV8()` で読む。schema 7 -> 8はversion番号だけを変え、legacy Plan
（persisted Plan、ExecutionHistoryのUndo Snapshot、ゲーム内セーブ地点のPlan）へ `executionEffects` や
Target execution state hashを推測付与しない。schema 7を名乗りながらschema 8のPlan field、
`confirm_owned_ideal`、またはcalculation schema 12以上のPlanを持つrootは拒否する。Import validationは
ProductionPlanを `validateProductionPlan()` でも検証し、calculation schema 12以上のPlanにだけcurrent契約を要求する。ゲーム内セーブ地点は構造validationに加え、
Planの存在、`lastExecutionHistoryId` が同じPlanの既存履歴であること、1 Plan 1件であることを検証し、
いずれかに違反すればImport全体をfail closedにする。セーブ地点の深いexpected-state検証は復元を
行うExecution serviceの責務とする。

Execution runtimeの実装PRで `schemaVersion` を9へ更新した。schema 9はProductionPlanのlifecycle metadata
（`abandonmentReason`、`abandonedAt`、`completedAt`、11.1）と、ExecutionUndoSnapshotの
`affectedTargetWeaponsBefore` / `executionSavePointBefore`（12）を含む。Import準備はschema 9をそのまま、
schema 8を純粋関数 `migrateExportRootV8ToV9()`、schema 7 / 6を既存migrationの後に
`migrateExportRootV8ToV9()` で読む。schema 8 -> 9は次だけを行い、推測をしない。

- lifecycle fieldを持たない `draft` / `active` / `stale` のPlan（persistedとゲーム内セーブ地点のPlan）に
  3 fieldの `null` を補完する
- `completed` / `abandoned` のPlanは完了日時・破棄理由を推測できないため、root全体をfail closedにする
- ExecutionHistoryが1件でもあれば、Undo Snapshotの `affectedTargetWeaponsBefore` /
  `executionSavePointBefore` を再構成できない（空配列や `null` は「Targetを変更していない」
  「セーブ地点が無かった」という事実の主張になる）ため、root全体をfail closedにする
- schema 8を名乗りながらlifecycle fieldを持つPlanは拒否する

Import validationはExecutionHistoryを `validateExecutionHistory()` でも検証する。

Identification provenanceの実装PRで `schemaVersion` を10へ更新した。schema 10はRngState（record schemaVersion 2）と
NormalArtianCounterの `lastIdentifiedAt`（6.1 / 6.2）を、root直下、ゲーム内セーブ地点snapshot、ExecutionHistory
Undo Snapshot、およびUndo Snapshotが `executionSavePointBefore` として保持するセーブ地点のすべてのbodyに含む。
Import準備はschema 10をそのまま、schema 9を純粋関数
`migrateExportRootV9ToV10()`、schema 8 / 7 / 6を既存migrationの後に `migrateExportRootV9ToV10()` で読む。
schema 9 -> 10は該当bodyへ `lastIdentifiedAt = null`（RngStateは `schemaVersion = 2` も）を補完するだけであり、
`updatedAt` / `lastObservedAt` / `source = observation` から採用時刻を推測しない。schema 9を名乗りながら
`lastIdentifiedAt` を持つbody、またはrecord schemaVersion 2のRngStateを持つrootは拒否する。

Draft lifecycle整理の実装PRで `schemaVersion` を11へ更新した。schema 11はentityの形状を変えず、
`productionPlans` に `status = "draft"` のPlanを最大1件（現在の下書き）だけ含むというcollection契約
（11.1）の境界である。Import準備はschema 11をそのまま読み、そのDraftを削除しない。schema 10は旧契約
（Draftが蓄積し得た）のrootなので純粋関数 `migrateExportRootV10ToV11()` で読み、schema 9 / 8 / 7 / 6は
既存migrationの後に `migrateExportRootV10ToV11()` で読む。schema 10 -> 11は次だけを行い、推測をしない。

- `productionPlans` から `status = "draft"` のPlanを全件削除する。`createdAt` / `updatedAt` / ID順から
  残すDraftを1件選ばない
- `active` / `stale` / `completed` / `abandoned` のPlan、ExecutionHistory Undo Snapshotやゲーム内セーブ地点
  の中のPlan body、BuildListEntry（削除したDraftが参照していたEntryを含む）、その他すべてのcollectionは
  変更しない

候補検索の探索量の既定値を保存できるようにした実装PR（Issue #125）で `schemaVersion` を12へ更新した。
schema 12は `settings` がAppSettings v2（`candidateSearchDefaults` を持つ、13）である形状である。
Import準備はschema 12をそのまま読み、schema 11を純粋関数 `migrateExportRootV11ToV12()`、schema 10..6を
既存migrationの後に `migrateExportRootV11ToV12()` で読む。schema 11 -> 12は次だけを行い、推測をしない。

- `settings` へDexie v9と同じ `upgradeAppSettingsToV2()` を適用し、`candidateSearchDefaults` に推奨値
  350 / 500 / 1500 を補完して `settings.schemaVersion = 2` にする。その他の設定fieldは維持する
- その他すべてのcollectionは変更しない
- schema 11を名乗りながら `settings` がobjectでない、`candidateSearchDefaults` を既に持つ、または
  `schemaVersion` が1でないrootは拒否する（fail closed）

## 15.2 Import方針

Import時は以下の順序で検証する。

1. JSONとしてparseできる
2. `schemaVersion` が対応範囲内
3. すべてのID参照が存在する
4. マスターIDが現在のMaster Dataに存在する
5. RestorationBonusSetがすべて5枠
6. Counterが0以上の整数
7. BuildListEntryのTarget参照とPlanの参照整合性が保たれている。作成元BuildCandidateの削除はSnapshotがあるため許可する。
   Plan body内のBuildListEntry / Plan依存Target参照をcurrent collectionへのforeign keyとして要求するのは
   top-level `active` Planだけとする。`draft`（生成時点のartifactで未開始。開始可否は
   `prepareProductionPlanStart()` の既存validationが判断する）、`stale`（Plan-breaking guardは
   active Planだけを警告対象とするため、Build List等の変更を正規UI操作で合法に保存できる。replan /
   recovery / restore可否はそれぞれの既存runtime authorityが判断する）、`completed` / `abandoned`
   （履歴。Build ListやTargetを後から整理してもbackupを取れる必要がある）のPlan bodyはcurrent
   foreign keyとして扱わない。ProductionPlan自身のDomain structural validation、Master ID validation、
   CalculationContext shape validation、lifecycle metadata validationは全statusで行う。
   ExecutionSavePoint snapshotのrestore必須参照（12.1、15.3）はこの規則で緩めない
8. CalculationContextの形式が正しい

同一TargetWeaponに複数のBuildListEntryを持つroot（legacy duplicate、9.4.1）は、Build List cardinality
契約の下でもImportで拒否しない。自動整理もせずそのまま復元し、Planner入力のfail closedとBuild Listの案内に委ねる。

Import方式。

- 初期版は全置換Importのみ
- merge importは実装しない
- Import前に現在データのExportを促す

## 15.3 Migration

現行ExportRootはschemaVersion=12である（schemaVersion 8はcalculation schema 12のProductionPlan形状を加えた形状、schemaVersion 9はProductionPlan lifecycle metadataとExecution Undo Snapshotを加えた形状、schemaVersion 10はRngState / NormalArtianCounterのIdentification provenance `lastIdentifiedAt` を加えた形状、schemaVersion 11はentity形状を変えずDraft最大1件のcollection契約を導入した境界、schemaVersion 12はAppSettings v2の `candidateSearchDefaults` を加えた形状）。schemaVersion 6はBuildCandidateが `intermediateStateGroups` を、
BuildListEntryが `intermediateStateSelection` を持つ最初の形状であり（schemaVersion 5は
旧 `checkpointGroups` / `selectedCheckpointOpportunityIds` の形状）、schemaVersion 7はそれに
Execution lifecycleの永続状態を加えた形状である（15.1）。
Dexie `DATABASE_SCHEMA_VERSION = 9` とは独立して更新する。

全置換Import / Export / 全データクリアのPersistence / Application Service基盤は実装済みである
（`src/services/dataTransfer/importExportService.ts`、`importExportValidation.ts`）。Settings画面への接続
（`serializeExport()` の結果を表示しクリップボードへのコピーまたはJSONファイル保存を選べるExport Dialog、JSONの
貼り付けまたはJSONファイル選択を受け付けるImport Dialog、Import確認Dialog、全データクリア確認Dialog、
Settings Storeのrehydrate）も実装済みである（`src/pages/SettingsPage.tsx`、`src/components/settings/`、
[UI_FLOW.md](./UI_FLOW.md) 14）。UI側はvalidation / migration / writeを再実装せず、Exportでは
`serializeExport()` を1回だけ呼んでその文字列を表示・コピー・保存に共用し、Importでは貼り付けとファイルの
どちらの本文も同じく `prepareImportJson()` へそのまま渡してそのtyped resultだけをImport可否のauthorityとし、
確認後にだけ `applyImport()` を、確認後にだけ `clearAllData()` を呼ぶ。クリップボードへの書込みとファイル名の
timestampはPresentationの責務であり、ExportRootの形状、`exportedAt`、Import validation / migration、
`applyImport()` / `clearAllData()` のtransaction semanticsは変更しない。Import / Clear成功後はServiceが返した（Importでは `root.settings` の）AppSettingsをそのままSettings Storeへ
hydrateし、`getOrCreateDefault()` で上書きしない。

- Export（`exportRoot()` / `serializeExport()`）は全user tableを1つのread-only Dexie transactionで読み、
  `schemaVersion = 12` / `appName` をService自身が設定し、`exportedAt` は注入したclockの時刻とする。
  top-level entity collectionだけをprimary IDで安定sortし、復元ボーナス5枠順、PlanStep順、その他のnested
  arrayの順序は永続化どおり保つ。作成したrootを後述のImport full validationに通し、Settings recordの欠落や
  Domain不変条件違反があればDBを書き換えずに `export_state_invalid` でfail closedする。旧CalculationContextの
  計算artifactは拒否しない
- Import準備（`prepareImportJson()` / `prepareImportRoot()`）はJSON parse失敗を `invalid_json`、それ以外の
  拒否を `invalid_import` のtyped resultとして返し、untrusted inputに対してthrowしない。schema migrationは
  既存の `prepareExportRootForImport()`（schema 6..12。10 -> 11は旧契約で蓄積したDraftを全削除し、11 -> 12は
  AppSettingsへ推奨の探索量既定値を補完する）だけを
  使い、その成功後に全置換用のfull validation
  （`validateExportRootForFullReplacement()`）を追加で行う: BuildCandidate / BuildListEntry / AppSettingsの
  entity validation、Target Ideal ⇒ Practical containment、全top-level collectionのprimary ID一意性、
  実行中Plan（active / stale）がtop-level collectionで最大1件というcollection invariant（11.1 / 16。Undo
  SnapshotやセーブポイントのPlan bodyは数えず、terminalに件数制約を追加しない）とそれとは独立した
  未開始Plan（draft）がtop-level collectionで最大1件というcollection invariant（11.1。2件以上は
  `invalid_state` でfail closed。Draftと実行中Planの同時存在は拒否しない）、
  formalなpersisted reference（Candidate / Entry snapshotの `targetWeaponId` とRouteが参照する所持武器、
  `preferredOwnedWeaponId` のcollection契約、top-level `active` ProductionPlanが持つすべてのBuildListEntry参照
  （`selectedBuildListEntryIds`、PlanStepの `buildListEntryId`、checkpoint milestone、`executionEffects` の
  targetLinks / compromiseLabels / targetCompletions、conflictの参加者・推奨・選択・checkpointParticipants、
  `rejectedBuildListEntries`）と、`collectProductionPlanDependentTargetWeaponIds()` が定義するPlan依存Target
  およびmilestoneのTarget、Entryと組で名指しされるTargetがそのEntryの `targetWeaponId` と一致すること
  （Plan生成 / Plan開始効果と同じ導出。`draft` / `stale` / `completed` / `abandoned` のPlan bodyはこれらを
  current foreign keyとして要求しない、15.2）、ExecutionHistoryの `planId` / `planStepId`、
  `executionInProgress.productionPlanId` が実行中（active / stale）Planであること、
  `completedByProductionPlanId`、ゲーム内セーブ地点参照とそのPlanが実行中であること、セーブ地点のsnapshot Planが
  `active` であること（記録できるのはactive時だけ。current PlanはstaleでもよいのはRestoreと同じ）、
  `savePoint.ownedWeapons` の全IDが現在存在すること（Restoreは削除済み武器を復活させないため。bodyの一致は
  要求しない）、snapshot Planが必要とする `selectedBuildListEntryIds` のEntryとPlan依存Targetが現在存在すること）、
  現在Masterに存在するMaster ID。Plan / PlanStepが持つ将来登録されるOwnedWeapon ID、PlanStepの `candidateId`、
  Undo Snapshot内の過去body、セーブ地点snapshot内のPlan非依存TargetはcurrentFKとして扱わず、BuildListEntryの
  作成元BuildCandidate recordも要求しない。復元時固有の前提条件（CalculationContext、実行可能Step、
  expected state一致、scope完全性の再計算、ExecutionHistory boundary）はImportへ持ち込まない。実行中Planに
  作成中OwnedWeaponの存在を要求しない
- Master ID検証は存在確認だけであり、Production抽選availability（7.1）は判定しない。旧UIで保存できた
  availability外の復元ボーナスはImportで受理し内容を変えない（non-destructive load）。Candidate snapshotの
  Route起点OwnedWeaponはIDの存在だけを確認し、save時の起点適格性（Normal kind / 非保護）は要求しない。
  それらの乖離は既存の `owned_weapon_changed` stalenessが扱う
- Import適用（`applyImport()`）はrootを再validationしてから、全user tableのclearと `add` / `bulkAdd` による
  挿入を1つのread-write Dexie transactionで行う。通常CRUD serviceやPlan-breaking guardを通さず、
  `updatedAt` 等を書き換えず、`exportedAt` をどのtableにも保存しない。途中失敗時は全tableがImport前の状態へ
  rollbackする
- 全データクリア（`clearAllData()`）は全user tableのclearとdefault AppSettings 1件の作成を1つの
  transactionで行い、RngStateや目標武器を推測作成しない。失敗時は元データを維持する
- この基盤は `CURRENT_CALCULATION_APP_SCHEMA_VERSION`（13）、`DATABASE_SCHEMA_VERSION`（当時7）、
  `ExportRoot.schemaVersion`（当時10）、`RngState.schemaVersion`（2）を変更しなかった。後続のDraft
  lifecycle整理でDexieを8、Exportを11へ更新した（14.2 / 15.1）。`CURRENT_CALCULATION_APP_SCHEMA_VERSION`
  （13）、`RngState.schemaVersion`（2）、`AppSettings.schemaVersion`（1）、`PRODUCTION_RNG_ENGINE_VERSION`、
  Master dataVersionは変更していない
旧schema=1を新Targetとして直接受理しない。将来のimportも純粋Target移行関数を使用し、
旧Practical/OR/Practical Skillは解除、Ideal・ID・他entityは保持する。

将来のmigration関数は以下の形を想定する。

```ts
type Migration = (input: unknown) => unknown;
```

制約。

- migrationは純粋関数にする
- migration前後のfixture testを必ず作成する
- 破壊的変更では旧データを読み捨てず、可能な限り変換する

Production RNG契約切替時の互換性は次のとおりとする。

- conversionのGogma Counter進行、巨戟化時のbonus再抽選、Keep selectionのいずれかを含む旧契約のBuildCandidate / BuildListEntry Candidate Snapshotは、新契約へ推測変換または再利用しない
- 該当BuildCandidateはinvalid、該当BuildListEntryはstaleとして扱い、ユーザーへ再検索を要求する
- TargetWeapon、OwnedWeapon、RngState、NormalArtianCounterなど、新契約でも意味を維持できるユーザーデータは不用意に削除しない。OwnedWeaponのscopeを一意に決定できない場合は推測migrationせず、実装フェーズで明示的な確認／移行方針を決める
- ProductionPlanは本契約確定時点で永続化実装前のため、この変更のmigration対象外とする
- 具体的なDexie schemaVersionとmigration手順は次のコード実装フェーズで決定する

---

## 16. 不変条件まとめ

- RngStateは1件のみ
- AppSettingsは1件のみ
- NormalArtianCounterは各武器種のレア8について1件のみ。レア6・7を保存・検索しない
- OwnedWeaponは `kind` により通常アーティアまたは巨戟アーティアを表す
- TargetWeaponは1構成につき1件
- RestorationBonusSetは必ず5枠
- 復元ボーナス比較は順不同
- 検索候補はTargetWeaponに紐づく
- BuildCandidateとBuildListEntryは別Entity
- 同一TargetWeaponの永続BuildListEntryは最大1件（9.4.1、実装済み）。別Candidateの採用は
  確認付きのatomicな置換で行い、legacy duplicateは自動整理せずfail closedする
- Planner対象はstaleでないBuildListEntryのみ
- 実行中Plan（active / stale）は同時に1件まで。一時中断用statusは持たない
- 未開始Plan（draft）はtop-level collectionに同時に1件まで。新Draftの保存成功時だけ旧Draftを同一transactionで
  置換し、保存失敗時は旧Draftを維持する。Draftの置換・削除でBuildListEntryをcascade deleteしない
- PlanとExecutionHistoryは分離する
- Plan非依存Targetの追加・変更とBuild Listへの新規Entry追加ではPlanをstaleにしない
- ExecutionはStepごとにrngAdvanceを即時反映し、Plan完了時にまとめて更新しない
- Planで今後も使う物理武器だけをOwnedWeaponとして追跡し、Counter進行用Normalは登録しない
- 所持Normalの巨戟化は同じOwnedWeapon IDのkind更新であり、別IDを作らない
- `executionInProgress` はstatusと直交し、ユーザーが直接編集しない
- 理想品完成は新規・既存武器を問わず `ideal` / protected / Target completed / preferred解除とする
- `completed` TargetはSearch / Plannerの対象外だがレコードを保持する
- `createTargetDefinitionHash()` は性能定義だけを対象とし、`priority` / `isEnabled` / `preferredOwnedWeaponId` / lifecycleの変更でBuildListEntryをstaleにしない
- `targetWeaponsHash` はplanning-input用の独立契約で、`preferredOwnedWeaponId` を含む
- 理想品完成で武器をprotectedにする場合、その武器を優先起点にする全Targetのpreferredを同一transactionで解除する
- セーブ地点の復元は、復元後Planに必要なentityが欠損していれば何も変更せず拒否する
- ゲーム内セーブ地点は妥協checkpointと別概念で、1 Planにつき最新1件
- 保護武器をPlannerはReset Bonuses・Keep Bonuses・Reset Skillsへ使用しない
- protected武器でも現在性能を変更しない操作0 Candidateとしては利用できる
- 通常→巨戟化はNormal bonus 5枠をslot順のまま継承し、Skill Counterだけを1進め、Normal / Gogma Counterを進めない
- normal scopeの巨戟に対する最初のBonus amendmentはReset / Keepの両方を許可する。5枠未知のblind transient Gogmaだけ最初のReset前のKeepを許可しない
- Plannerは所持武器を素材として消費しない。statusはOwned Weapons画面の通常CRUDとExecution Step確定（巨戟化時の未分類、選択済み妥協checkpoint到達時の実用、理想品完成時の理想）以外で変更しない
- Plan進行中は現在Stepの期待状態と実態を比較する
- 期待状態Before / Afterと一致する正常進行ではPlanをstaleにしない
- CalculationContext非互換のCandidate、BuildListEntry、Planはstaleとし、Planには `calculation_context_changed` を記録する
- Debug Mode OFFではSeed / Counter / PlanStepDebugInfoを通常画面に表示しない

---

## 17. テスト観点

## 17.1 Unit Test

- ID生成が重複しない
- RestorationBonusSetが5枠以外の場合にvalidation error
- 復元ボーナス比較が順不同で一致する
- BonusCondition判定が正しい
- AlternativeBonusConditionGroup判定が正しい
- SkillConditionの `all` / `any` 判定が正しい
- 新規OwnedWeaponのstatus別保護初期値が正しく、既存保存値を勝手に変更しない
- 保護武器をReset Bonuses・Keep Bonuses・Reset Skillsの対象にできない
- protectedな武器でも、statusにかかわらず現在性能がTargetを満たせば操作0 Candidateにできる
- `existing_gogma_reset_skills` のfinalBonusesが起点OwnedWeaponと一致し、Skill Prediction結果だけがスキルへ反映される
- Reset Skills Routeの起点OwnedWeapon状態変更で `referencedOwnedWeaponsHash` が変わる
- Skill Capability不足時は `existing_gogma_reset_skills` を生成しない
- `candidateOffset = 0` の通常候補Routeが1本forgeし、一般のoffset kでは `forgeCount = k + 1` となり、最後の1本だけを巨戟化する
- CreateNormalArtianOperationの `normalCounterAfter = normalCounterBefore + count` と候補位置 `normalCounterBefore + count - 1` が一致する
- conversion直後のExpectedResultがnormal scope 5枠と初回Series / Groupを保持する
- 5枠既知のnormal scope transient GogmaへKeep Bonusesを直接適用でき、blind transient Gogmaだけ最初のReset後にKeepする。除外理由をunknown入力として扱い、ゲームルール由来として扱わない
- transient GogmaのReset / Keep / Reset Skillsが `sourceOwnedWeaponId = null` で表現され、fake OwnedWeaponIdを生成しない
- Candidate Route（BuildRoute / RouteOperation）へ巨戟化直後の未登録武器用OwnedWeaponIdを生成しない。ProductionPlanのexecution projectionだけが作成対象NormalへPlanner予約IDをbindする（PLANNER_SPEC 16.3）
- TargetWeapon priority未指定時に3になる
- NormalArtianCounter未確定時に通常経由検索から除外される
- RngStateの4項目を独立して確定・未確定にできる
- 不足Capabilityに依存するRouteだけが無効になる
- BuildCandidateを選択してもCandidate本体は変更されずBuildListEntryが作成される
- Target性能定義変更でBuildListEntryがstaleになり、`priority` / `isEnabled` / `preferredOwnedWeaponId` / lifecycleだけの変更ではstaleにならない
- 検索に使用したRNG状態変更でBuildListEntryが `rng_state_changed` になる
- Routeに影響しない表示項目変更では `searchStateHash` が変わらない
- Route参照OwnedWeaponのボーナス、スキル、isProtected変更でBuildListEntryが `owned_weapon_changed` になり、status / `executionInProgress` だけの変更ではならない
- Routeに無関係なOwnedWeapon変更、または参照武器のname、memo、日時変更では `referencedOwnedWeaponsHash` が変わらない
- OwnedWeaponを参照しないRouteの `referencedOwnedWeaponsHash` は `null` になる
- ProductionPlanのactive単一制約が守られる
- Step実行前後が期待Hashと一致する正常進行ではPlanがstaleにならない
- Step実行前または実行後の期待Hashが不一致ならPlanがstaleになる
- ExecutionHistoryで想定外結果が入った場合にPlanがstaleになる
- 所持武器のstatusだけを変更してもPlanがstaleにならない
- PlanConflictとRejectedBuildListEntryがBuildListEntry IDだけを判断基準として保持する

## 17.2 Repository / Persistence Test

- Dexieへ各エンティティを保存・取得できる
- ExportしたJSONをImportすると同一データに戻る
- 作成元BuildCandidateが存在しないBuildListEntryでも、有効なSnapshotとTarget参照があればImportできる
- 不正な参照IDを含むImportを拒否する
- 存在しないMaster IDを含むImportを拒否する
- schemaVersion不一致を検出する
- Step確定中の任意の書き込み失敗でRNG、Normal Counter、OwnedWeapon、TargetWeapon、ExecutionHistory、ProductionPlan、ゲーム内セーブ地点がすべて更新前にrollbackされる
- 再計画採用、ゲーム内セーブ地点の復元、Planを壊す変更の承認の途中失敗で部分更新が残らない
- ゲーム内セーブ地点の復元がexecution scopeだけを戻し、Plan非依存Target、Build List Entry、scope外の所持武器を巻き戻さない
- ExportしたExecutionSavePoint、TargetWeapon lifecycle、`executionInProgress` をImportで同一データに戻せる
- Undoの任意の書き込み失敗で部分復元が残らない
- 最後のExecutionHistoryのundoSnapshotだけからStep前のアプリ状態へ完全に戻せる

## 17.3 Snapshot / Hash Test

- 同じ入力から同じPlanningInputSnapshot hashが生成される
- 配列順が意味を持たない項目は安定ソートされる
- `updatedAt` やmemoの変更だけではExpectedPlanState hashが変わらない
- Route参照OwnedWeapon IDの入力順に依存せず、ID安定ソート、restorationBonusScope、保存中のボーナス5枠順から決定的なHashが生成される
- CalculationContextのいずれかが変わると互換性判定が失敗する
- OwnedWeapon変更で `ownedWeaponsHash` が変わる
- OwnedWeaponのkind変更で `ownedWeaponsHash` と `referencedOwnedWeaponsHash` が変わる
- OwnedWeaponのname、memo、日時変更だけでは両Hashが変わらない
- `create_material_gogma` / `use_weapon_as_material` / `change_owned_weapon_status` を
  含むPlanStepをDomain validationが拒否する
- `recalculate_plan` がPlanStepOperationTypeとして受理されない
- PlannerInputへRngEngine / engineCapabilities / existingActivePlanを含めずstructured cloneできる
- Production PlannerOptionsはmaxPlanStepsだけを持ち1以上の整数を要求する。Beam Search oracleの
  `PlannerBeamSearchOptions` はmaxPlanSteps、beamWidth、maxExpandedStatesの各1以上を専用validationで要求する
- normal新規では作成対象Stepだけがadd（Counter進行用Stepは登録なし）、所持Normalはconvert Stepで同一IDのkind更新、既存Gogmaは各Stepで同一ID更新になり、独立したreserve Stepを持たない
- `targetExecutionStateHash` がPlan依存Targetだけを対象にし、Plan非依存Targetの追加・変更で変わらない
- `targetWeaponsHash` が `preferredOwnedWeaponId` / `priority` / `isEnabled` / `lifecycleStatus` の変更で変わり、
  `createTargetDefinitionHash()` はそれらの変更で変わらない
- binding tokenが観測値と一致する実状態だけをtokenへ置き換え、観測値と異なる5枠を不一致として検出する
- `status` と `executionInProgress` の変更だけでは `ownedWeaponsHash` が変わらない
- Candidate BuildRouteを変更せず、Candidate Route内の具体的な起点OwnedWeapon IDを別武器へ差し替えない
- 有効な競合選択だけを適用し、削除済み・staleな選択をwarningにする
- max_steps_reachedを検証し、Beam oracle専用だったmax_expanded_states_reachedがwarning kindに無いことを検証する
- TargetWeapon変更で `targetWeaponsHash` が変わる
- BuildListEntry変更で `buildListEntriesHash` が変わる
- 同じRoute依存RNG状態から同じ `searchStateHash` が生成される
- Route依存RNG状態が変わると `searchStateHash` が変わる


### 妥協条件version 6の判定理由と監査記録

妥協判定はlaneごとの `match` としてCandidate本体ではなくintermediate state group / opportunityが
保持し、Build List snapshotへそのまま複写する。両軸の `conditionMatch` はPlannerが到達した
checkpoint milestoneが保持する。
これらはTarget定義と到達状態から導出した説明情報であり、Candidate ID / stable key / deduplication key / meaning fingerprint / searchStateHashには追加しない。
条件の意味はTarget definition hashとCalculationContext version 6で区別する。旧artifactではフィールドを省略でき、推測補完・再分類しない。
UIは保存された判定理由を「ボーナス判定: 実用 / 代替」「スキル判定: 理想 / 実用」と表示する。
両軸Idealは理想品そのものなのでcheckpointとしては存在しない。

Productionベンチマークの旧wildcard条件も明示的な理想構成基準へ変更するため、旧versionの測定記録と負荷が異なる。
過去のBrowser Worker測定値は当時のartifactとして保持する。今回のVitestは意味・不変条件の検証であり、新しいBrowser性能測定の代用ではない。

Build Listへの同一意味の候補の重複追加を防ぐ際はCalculationContext互換性も確認する。
旧version 1..5の項目を削除・上書きせず、version 6の再検索結果を別項目として追加できる。この歴史的境界とは別に、現行version 7では旧1..6をfail closedとする。
Candidate meaning fingerprint自体は変更しない。
