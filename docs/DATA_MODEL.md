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

---

## 4. Enum

```ts
export type RngStateSource =
  | "gogma_seed_finder_import"
  | "manual"
  | "observation";

export type NormalArtianRarity = "rare6" | "rare7" | "rare8";

export type OwnedWeaponStatus =
  | "material"
  | "practical"
  | "ideal";

export type CandidateCategory =
  | "ideal"
  | "practical";

export type RouteKind =
  | "normal_artian_to_gogma"
  | "existing_gogma_reset_bonuses"
  | "existing_gogma_keep_bonuses"
  | "existing_gogma_reset_skills"
  | "existing_gogma_mixed";

export type SkillMatchMode =
  | "all"
  | "any";

export type ProductionPlanStatus =
  | "draft"
  | "active"
  | "completed"
  | "stale"
  | "abandoned";

export type PlanStepOperationType =
  | "create_normal_artian"
  | "convert_normal_to_gogma"
  | "create_material_gogma"
  | "reset_bonuses"
  | "keep_bonuses"
  | "reset_skills"
  | "reserve_weapon"
  | "use_weapon_as_material"
  | "change_owned_weapon_status"
  | "confirm_result"
  | "recalculate_plan";

export type ExecutionAction =
  | "confirmed_expected"
  | "secured_weapon"
  | "confirmed_weapon_status_change"
  | "declined_weapon_status_change"
  | "actual_result_different"
  | "skipped_candidate";

export type RecalculationReason =
  | "rng_state_changed"
  | "normal_counter_changed"
  | "target_changed"
  | "build_list_changed"
  | "owned_weapon_changed"
  | "calculation_context_changed"
  | "unexpected_result"
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
- 復元ボーナス5枠は順不同として比較する
- 保存時の配列順はUI表示用として保持するが、同一性判定はmultisetとして行う

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
- 比較時は `bonusTypeId + bonusRankId` の個数で判定する

---

## 6. RNG状態

## 6.1 RngState

アプリ全体で1件のみ保存する。

```ts
export interface RngState {
  id: "current";
  schemaVersion: 1;
  baseSeed: KnownValue<string>;
  gogmaCounter: KnownValue<number>;
  skillCounter: KnownValue<number>;
  counterGate: KnownValue<number>;
  notes: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

制約。

- `id` は常に `"current"`
- `baseSeed.value` はUI入力では10進文字列または16進文字列を受け付けてもよいが、内部保存形式はRNG実装で定める正規化文字列に統一する
- Counterの確定値は0以上の整数
- 各項目の確定状態と取得元は独立して保持する
- RngState全体の `isConfirmed` は持たない

Capabilityは保存せず、現在値と実行対象から純粋関数で導出する。

```ts
export interface RngCapabilities {
  canPredictGogma: boolean;
  canPredictSkills: boolean;
  canSearchSeed: boolean;
  canSearchNormalArtian: boolean;
  normalArtianSearchableCounterIds: string[];
  canRunPlanner: boolean;
  missingRequirements: string[];
}

deriveRngCapabilities(
  rngState: RngState,
  normalCounters: NormalArtianCounter[],
  requiredOperations: RouteOperation[]
): RngCapabilities;
```

基本依存関係。

- Gogma予測は確定済みBase Seed、Gogma Counter、Counter Gateを要求する
- Skill予測は確定済みBase Seed、Skill Counter、Counter Gateを要求する
- 通常アーティア予測は確定済みBase Seedと対象武器種・レア度のNormalArtianCounterを要求する
- PlannerはBuildListEntry内の全RouteOperationを実行できるCapabilityがある場合のみ実行可能
- 不足値に依存するRouteだけを無効化し、他Routeは利用可能なままにする

## 6.2 NormalArtianCounter

通常アーティアの現在位置を、武器種・レア度ごとに保存する。

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
- `isConfirmed = true` の場合、`counter` は0以上の整数
- `isConfirmed = false` の場合、通常アーティア経由の候補検索には使わない
- `candidateCount` は観測検索時の残候補数。未検索なら `null`

---

## 7. 所持巨戟アーティア

## 7.1 OwnedWeapon

```ts
export interface OwnedWeapon {
  id: OwnedWeaponId;
  name: string;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  restorationBonuses: RestorationBonusSet;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  status: OwnedWeaponStatus;
  isProtected: boolean;
  relatedTargetWeaponIds: TargetWeaponId[];
  memo: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

不変条件。

- 所持武器は巨戟アーティアのみを表す
- 素材用でも `restorationBonuses` は必ず5枠保持する
- `status = "ideal"` の場合、初期値として `isProtected = true`
- `status = "practical"` の場合、初期値として `isProtected = true`
- `status = "material"` の場合、初期値として `isProtected = false`
- `isProtected = true` はPlannerによる破壊的操作から武器を保護する
- `isProtected = true` の武器を、素材消費、Reset Bonuses、Keep Bonusesの対象にしない
- Plannerが素材として消費できるのは `status = "material" AND isProtected = false` の武器だけ
- Plannerに保護武器の消費を許可するoverride設定は持たない
- 旧実用品の素材化は確認必須の `change_owned_weapon_status` PlanStepとして予定できる
- ユーザーが素材化を確認した場合だけ、`status = "material"` と `isProtected = false` を同一トランザクションで適用する
- ユーザーが「保管」を選択した場合は状態と保護を変更しない
- `relatedTargetWeaponIds` は存在するTargetWeaponのみ参照する

---

## 8. 目標武器

## 8.1 TargetWeapon

```ts
export interface TargetWeapon {
  id: TargetWeaponId;
  name: string;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  priority: 1 | 2 | 3 | 4 | 5;
  isEnabled: boolean;
  idealBonuses: RestorationBonusSet;
  practicalBonusConditions: BonusCondition[];
  practicalAlternativeGroups: AlternativeBonusConditionGroup[];
  idealSkillCondition: SkillCondition;
  practicalSkillCondition: SkillCondition;
  memo: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

不変条件。

- 1つの欲しい構成につき1件作成する
- 同じ武器種・属性でも構成違いは別TargetWeapon
- `priority` のデフォルトは3
- `isEnabled = false` の目標は候補検索・Plannerの対象外
- `idealBonuses` は必ず5枠完全指定

## 8.2 BonusCondition

通常の実用ライン条件。

```ts
export interface BonusCondition {
  id: string;
  bonusTypeId: BonusTypeId;
  minimumRankId: BonusRankId;
  requiredCount: number;
  requiredExCount: number;
}
```

意味。

```text
対象BonusTypeについて、minimumRank以上をrequiredCount個以上含み、
そのうちEXランクをrequiredExCount個以上含む。
```

制約。

- `requiredCount` は1以上5以下
- `requiredExCount` は0以上 `requiredCount` 以下
- `minimumRankId` は対象武器種で利用可能なRank

## 8.3 AlternativeBonusConditionGroup

OR条件グループ。

```ts
export interface AlternativeBonusConditionGroup {
  id: string;
  requiredCount: number;
  options: AlternativeBonusOption[];
}

export interface AlternativeBonusOption {
  bonusTypeId: BonusTypeId;
  minimumRankId: BonusRankId;
}
```

意味。

```text
optionsのいずれかを満たす復元ボーナスをrequiredCount個以上含む。
```

制約。

- `requiredCount` は1以上5以下
- `options` は1件以上
- 複雑な任意論理式は初期版では扱わない
- 判定は「すべてのBonusConditionを満たす」AND「すべてのAlternativeBonusConditionGroupを満たす」

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
- 両方 `null` の場合は常に条件を満たす

---

## 9. 検索候補

## 9.1 BuildCandidate

検索結果として見つかった完成候補。作成リストの選択状態は持たない。

```ts
export interface BuildCandidate {
  id: BuildCandidateId;
  targetWeaponId: TargetWeaponId;
  category: CandidateCategory;
  finalBonuses: RestorationBonusSet;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  route: BuildRoute;
  estimatedOperationCount: number;
  estimatedGogmaAdvance: number;
  estimatedSkillAdvance: number;
  estimatedNormalAdvance: number | null;
  requiredMaterials: MaterialRequirement[];
  idealDifference: IdealDifference;
  isSimilarToIdeal: boolean;
  similarityScore: number | null;
  searchStateHash: string;
  referencedOwnedWeaponsHash: string | null;
  calculationContext: CalculationContext;
  searchRunId: string;
  createdAt: ISODateTimeString;
}
```

不変条件。

- `targetWeaponId` は存在するTargetWeaponを参照する
- `category = "ideal"` の候補は対象TargetWeaponの理想条件を満たす
- `category = "practical"` の候補は実用条件を満たす
- `isSimilarToIdeal = true` は `category = "practical"` の候補にのみ設定できる
- 近似判定は `idealDifference` と、定義済みの類似度基準から導出する
- `similarityScore` を使用する場合は同一SearchRun内で同じ算出方法を用い、値域を0以上1以下とする
- 初期版では実用ラインを満たさない候補を原則保存しない
- `calculationContext` は候補生成時の値を保存し、互換性が失われた候補はstaleとして扱う
- `searchStateHash` は候補検索開始時のRoute依存RNG状態から生成する
- `referencedOwnedWeaponsHash` はRouteが参照するOwnedWeaponだけから生成し、参照がないRouteでは `null` とする

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
  | ResetSkillsOperation
  | UseWeaponAsMaterialOperation;

export interface CreateNormalArtianOperation {
  type: "create_normal_artian";
  weaponTypeId: WeaponTypeId;
  rarity: NormalArtianRarity;
  count: number;
  normalCounterBefore: number;
  normalCounterAfter: number;
}

export interface ConvertToGogmaOperation {
  type: "convert_normal_to_gogma";
  weaponTypeId: WeaponTypeId;
  gogmaCounterBefore: number;
  gogmaCounterAfter: number;
}

export interface ResetBonusesOperation {
  type: "reset_bonuses";
  sourceOwnedWeaponId: OwnedWeaponId;
  gogmaCounterBefore: number;
  gogmaCounterAfter: number;
}

export type KeepBonusSelection =
  | {
      mode: "slot_indices";
      keptSlotIndices: number[];
      engineParameters: Readonly<
        Record<string, string | number | boolean>
      >;
    }
  | {
      mode: "bonus_types";
      keptBonusTypeIds: BonusTypeId[];
      engineParameters: Readonly<
        Record<string, string | number | boolean>
      >;
    }
  | {
      mode: "engine_defined";
      engineParameters: Readonly<
        Record<string, string | number | boolean>
      >;
    };

export interface KeepBonusesOperation {
  type: "keep_bonuses";
  sourceOwnedWeaponId: OwnedWeaponId;
  selection: KeepBonusSelection;
  gogmaCounterBefore: number;
  gogmaCounterAfter: number;
}

export interface ResetSkillsOperation {
  type: "reset_skills";
  sourceOwnedWeaponId: OwnedWeaponId | null;
  skillCounterBefore: number;
  skillCounterAfter: number;
}

export interface UseWeaponAsMaterialOperation {
  type: "use_weapon_as_material";
  ownedWeaponId: OwnedWeaponId;
}
```

制約。

- `operations` は実行順に並べ、空配列を許可しない
- `normal_artian_to_gogma` は該当NormalArtianCounterが確定している場合のみ生成する
- v1の `normal_artian_to_gogma` はCreateNormalArtianOperation、ConvertToGogmaOperation、必要なResetSkillsOperationだけを持ち、KeepBonusesOperationを含めない
- `normal_artian_to_gogma` の `BuildRoute.sourceOwnedWeaponId` は `null` とする
- `normal_artian_to_gogma` のResetSkillsOperationは巨戟化直後のRoute出力を対象とするため `sourceOwnedWeaponId = null` とし、未登録武器用のOwnedWeaponIdを生成しない
- `existing_gogma_reset_skills` は非nullの `sourceOwnedWeaponId` を持つResetSkillsOperationだけでスキルを再付与し、復元ボーナスを変更するOperationを含めない
- `existing_gogma_reset_skills` のBuildRoute.sourceOwnedWeaponIdと各ResetSkillsOperation.sourceOwnedWeaponIdは同じ起点武器を参照する
- `existing_gogma_reset_skills` から生成するBuildCandidateの `finalBonuses` は起点OwnedWeaponの `restorationBonuses` と一致し、seriesSkillId / groupSkillIdだけをRNG EngineのSkill Prediction結果から設定する
- Keep操作は保持するslot、Bonus Type、Engine固有入力だけを保持し、保持対象を最終ボーナスとみなさない
- `mode = "slot_indices"` のindexは0始まりで0から4、重複不可
- `mode = "bonus_types"` のBonus Typeは保持対象の種類を表すだけで、Rank維持または完成結果を保証しない
- `mode = "engine_defined"` は解析で別の入力単位が判明した場合にのみRNG Engineが生成する
- `engineParameters` の意味はRNG Engine versionに従い、Domain Modelでゲーム仕様を推測しない
- Keep後を含む最終 `RestorationBonusSet` は必ずRNG EngineのPrediction結果からBuildCandidateへ設定する
- `UseWeaponAsMaterialOperation.ownedWeaponId` が検索時点で保護中の場合、SearchはそのRouteを生成しない
- ResetBonusesOperationまたはKeepBonusesOperationの起点OwnedWeaponが保護中の場合、SearchはそのRouteを生成しない
- ResetSkillsOperationは非破壊操作として扱い、`isProtected = true` の起点OwnedWeaponにも使用できる
- Route生成後に起点武器がprotectedへ変わった場合、素材消費・Reset Bonuses・Keep Bonusesを含むBuildListEntryだけをPlanner validationで実行不能とする。Reset SkillsのみのRouteは実行可能とする
- v1ではRoute内で新規生成した武器を参照する専用型を持たず、巨戟化直後のRoute出力をKeepBonusesOperationの `sourceOwnedWeaponId` へ設定しない
- Plannerは `operations` を順にPlanStepへ変換し、endpointのCounter差分から操作を推測復元しない

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
}

export type BuildListEntryStaleReason =
  | "target_definition_changed"
  | "rng_state_changed"
  | "owned_weapon_changed"
  | "calculation_context_changed";
```

不変条件。

- 作成リスト追加時にBuildCandidate全体を `candidateSnapshot` へ複製する
- `targetDefinitionHash` はTargetWeaponの意味を持つ項目を安定serializeして生成する
- `searchStateHash` は `candidateSnapshot.searchStateHash` を複製する
- `referencedOwnedWeaponsHash` は `candidateSnapshot.referencedOwnedWeaponsHash` を複製する
- `calculationContext` は `candidateSnapshot.calculationContext` と一致する
- 再検索でBuildCandidateが削除または置換されてもSnapshotは保持する
- `candidateId` は作成元の追跡用であり、作成元BuildCandidate削除後もSnapshotが有効ならEntryはstaleにならない
- TargetWeapon変更、検索に使用したRNG状態変更、Route参照OwnedWeapon変更、CalculationContext非互換時は `isStale = true` とし、Planner入力から除外する
- 初期版では `searchStateHash` が現在値から再計算したHashと異なる場合、安全側に倒して `rng_state_changed` とする
- Route成立性に影響しない変更を明示的かつテスト可能に証明できる場合だけ、将来 `rng_state_changed` を回避してよい
- Active Plan開始後、PlanどおりのRNG進行またはOwnedWeapon変更でEntry自体が再利用不可になっても、進行中Planのstale判定はPlanStepの期待状態を優先する
- 同じCandidateを重複追加しない

`searchStateHash` の正規化対象。

- Base SeedのvalueとisConfirmed
- RouteがGogma予測を使う場合はGogma CounterとCounter GateのvalueとisConfirmed
- RouteがSkill予測を使う場合はSkill CounterとCounter GateのvalueとisConfirmed
- Routeが通常アーティアを使う場合は対象武器種・レア度のNormalArtianCounterのcounterとisConfirmed
- source、notes、観測日時、表示用フィールドは除外する

`referencedOwnedWeaponsHash` の正規化対象。

- 参照IDは `BuildRoute.sourceOwnedWeaponId`、`ResetBonusesOperation.sourceOwnedWeaponId`、`KeepBonusesOperation.sourceOwnedWeaponId`、非nullの `ResetSkillsOperation.sourceOwnedWeaponId`、`UseWeaponAsMaterialOperation.ownedWeaponId` から収集する
- 同じIDを重複排除し、ID順に安定ソートする
- 各参照武器について `id`、`weaponTypeId`、`elementId`、`restorationBonuses`、`seriesSkillId`、`groupSkillId`、`status`、`isProtected` を含める
- `restorationBonuses` は保存中の5枠配列順を保持する。Keepのslot意味が確定するまでHash生成時に並べ替えない
- `name`、`memo`、`createdAt`、`updatedAt` は除外する
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

---

## 10. 素材要求

```ts
export interface MaterialRequirement {
  materialId: MaterialId;
  quantity: number;
}
```

初期版では素材アイテムの厳密な所持数制約は扱わない。

不変条件。

- `quantity` は1以上の整数
- Plannerは必要数を表示するが、不足による作成不能判定は巨戟アーティア武器在庫だけを対象にする

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
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

不変条件。

- `status = "active"` のPlanは同時に1件まで
- `currentStepId` は `steps` 内の未完了Stepを参照する
- 現在Stepの期待状態またはPlanの不変前提と実態に差分が出た場合、既存Planは `stale` にする
- `baseSnapshot` はPlanner開始状態の監査、再現、Target・Build List前提の検証に使用する
- 正常なStep進行後の可変状態を `baseSnapshot` の開始状態と比較してstaleにしない
- `calculationContext` が現在環境と非互換なら `stale` にする

## 11.2 PlanningInputSnapshot

```ts
export interface PlanningInputSnapshot {
  initialExecutionState: ExpectedPlanState;
  targetWeaponsHash: string;
  buildListEntriesHash: string;
  calculationContext: CalculationContext;
  createdAt: ISODateTimeString;
}
```

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
}
```

各hashは、Plan実行に影響する項目だけを安定ソートした正規化JSONから生成する。`updatedAt`、表示名、メモなど計算に影響しない項目を含めない。

- `rngStateHash`: 各KnownValueの正規化valueとisConfirmedを含み、source、notes、日時を除外する
- `normalCountersHash`: id、counter、isConfirmedを含み、観測日時を除外する
- `ownedWeaponsHash`: ID、武器種、属性、ボーナス、スキル、status、isProtected、計画に関係するTarget参照を含み、名称、memo、日時を除外する
- `buildListEntriesHash`: Entry ID、Candidate Snapshot、Target定義Hash、searchStateHash、CalculationContextを含み、派生値のisStale、staleReasons、日時を除外する

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
  candidateId: BuildCandidateId | null;
  ownedWeaponId: OwnedWeaponId | null;
  expectedResult: ExpectedResult | null;
  expectedStateBefore: ExpectedPlanState;
  expectedStateAfter: ExpectedPlanState;
  inventoryChange: InventoryChange | null;
  rngAdvance: RngAdvance;
  requiresUserConfirmation: boolean;
  isCompleted: boolean;
  completedAt: ISODateTimeString | null;
  debug: PlanStepDebugInfo | null;
}
```

不変条件。

- `order` は1始まりの連番
- `isCompleted = true` の場合、`completedAt` は `null` ではない
- `requiresUserConfirmation = true` のStepは実行ナビで明示確認する
- 初期版ではPlanStepをまとめて完了する高速操作を提供しない
- Step実行前の実状態は `expectedStateBefore` と一致しなければならない
- 期待どおりの操作と更新を適用した後の実状態は `expectedStateAfter` と一致しなければならない
- 両方が一致して次Stepへ進む場合、Planをstaleにしない
- `operationType = "change_owned_weapon_status"` で旧実用品を素材化するStepは `requiresUserConfirmation = true`
- 素材化Stepの `expectedStateBefore` は対象武器がPracticalかつprotectedである状態を含む
- 素材化Stepの `expectedStateAfter` は対象武器がMaterialかつunprotectedである状態を含む
- ユーザーが予定どおり素材化した場合は `expectedStateAfter` と一致するためstaleにしない
- ユーザーが「保管」を選択した場合は状態を変更せず、`expectedStateAfter` 不一致としてstaleにする
- Candidate由来のStepは `buildListEntryId` を判断記録の主参照とし、`candidateId` はSnapshot内の追跡情報としてのみ使用する

## 11.4 ExpectedResult

```ts
export interface ExpectedResult {
  restorationBonuses: RestorationBonusSet | null;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  candidateCategory: CandidateCategory | null;
  isSimilarToIdeal: boolean;
  shouldSecure: boolean;
}
```

## 11.5 InventoryChange

```ts
export interface InventoryChange {
  addOwnedWeapon: OwnedWeapon | null;
  removeOwnedWeaponIds: OwnedWeaponId[];
  updateOwnedWeapons: OwnedWeapon[];
  materialRequirements: MaterialRequirement[];
}
```

## 11.6 RngAdvance

```ts
export interface RngAdvance {
  gogmaCounterDelta: number;
  skillCounterDelta: number;
  normalCounterDelta: number | null;
  affectedNormalCounterId: string | null;
}
```

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
export interface PlanConflict {
  id: string;
  kind: ConflictKind;
  buildListEntryIds: BuildListEntryId[];
  reason: string;
  recommendedBuildListEntryId: BuildListEntryId | null;
  selectedBuildListEntryId: BuildListEntryId | null;
  resolutionNote: string | null;
}
```

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
  restorationBonuses: RestorationBonusSet | null;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  securedOwnedWeaponId: OwnedWeaponId | null;
  note: string | null;
}

export interface ExecutionUndoSnapshot {
  rngStateBefore: RngState;
  normalCountersBefore: NormalArtianCounter[];
  affectedOwnedWeaponsBefore: OwnedWeapon[];
  addedOwnedWeaponIds: OwnedWeaponId[];
  removedOwnedWeaponsBefore: OwnedWeapon[];
  productionPlanBefore: ProductionPlan;
}
```

不変条件。

- ExecutionHistoryはPlanとは別に保存する
- Step確定前に `ExecutionUndoSnapshot` を生成し、同じTransactionでExecutionHistoryへ保存する
- `normalCountersBefore` は実装を単純化するため全NormalArtianCounterを保存する
- `affectedOwnedWeaponsBefore` は更新対象としてStep開始前に存在した武器、`addedOwnedWeaponIds` はStepで新規追加した武器ID、`removedOwnedWeaponsBefore` はStepで削除した武器本体を保持する
- 3つのOwnedWeapon集合は役割を重複させず、最後のExecutionHistoryだけでStepによる在庫変更を正確に取り消せること
- `productionPlanBefore` はStep完了、currentStepId、status、recalculationReasonsを含む更新前Plan全体を保持する
- Undoは最後のExecutionHistoryのSnapshotを適用し、そのExecutionHistoryを削除する。Undo自体のExecutionHistoryは追加しない
- Undoはツール上の誤操作修正であり、ゲーム内操作を巻き戻すものではない
- `wasExpected = false` の場合、Planを `stale` にして再計算導線を出す

---

## 13. 設定

```ts
export interface AppSettings {
  id: "settings";
  schemaVersion: 1;
  debugMode: boolean;
  resultPageSize: number;
  defaultSearchLimit: number;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}
```

初期値。

```ts
const defaultSettings: AppSettings = {
  id: "settings",
  schemaVersion: 1,
  debugMode: false,
  resultPageSize: 50,
  defaultSearchLimit: 5000,
  createdAt: now,
  updatedAt: now,
};
```

---

## 14. Dexie保存設計

## 14.1 DB名

```text
mh-wilds-gogma-artian-planner
```

## 14.2 DB schemaVersion

初期版はDexie schema version 1。

```ts
db.version(1).stores({
  rngState: "id",
  normalArtianCounters: "id, [weaponTypeId+rarity], isConfirmed",
  ownedWeapons: "id, weaponTypeId, elementId, status, isProtected, updatedAt",
  targetWeapons: "id, weaponTypeId, elementId, priority, isEnabled, updatedAt",
  buildCandidates: "id, targetWeaponId, category, searchStateHash, searchRunId, createdAt",
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

## 14.4 Execution Transaction

Execution Navigatorの1Step確定処理は、次の更新を1つのDexie read-write transactionで原子的に行う。

- Step実行前状態からExecutionUndoSnapshotを作成する
- RngStateを更新する
- NormalArtianCounterを更新する
- OwnedWeaponを追加、更新、削除する
- ExecutionHistoryを追加する
- PlanStepを完了またはstaleとして更新する
- ProductionPlanのcurrentStepId、status、recalculationReasons、updatedAtを更新する

対象操作は、結果一致、武器確保、予定された旧実用品の素材化確認、想定外結果記録とする。Transaction内のいずれかが失敗した場合は全更新をrollbackし、Step確定前の状態を維持する。

UndoもRngState、全NormalArtianCounter、対象OwnedWeapon、ProductionPlan、ExecutionHistoryを1つのDexie transactionで復元する。復元途中に失敗した場合はUndoを適用せず、元の状態と履歴を維持する。

---

## 15. Export / Import

## 15.1 ExportRoot

```ts
export interface ExportRoot {
  schemaVersion: 1;
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
  settings: AppSettings;
}
```

## 15.2 Import方針

Import時は以下の順序で検証する。

1. JSONとしてparseできる
2. `schemaVersion` が対応範囲内
3. すべてのID参照が存在する
4. マスターIDが現在のMaster Dataに存在する
5. RestorationBonusSetがすべて5枠
6. Counterが0以上の整数
7. BuildListEntryのTarget参照とPlanの参照整合性が保たれている。作成元BuildCandidateの削除はSnapshotがあるため許可する
8. CalculationContextの形式が正しい

Import方式。

- 初期版は全置換Importのみ
- merge importは実装しない
- Import前に現在データのExportを促す

## 15.3 Migration

初期版では `schemaVersion = 1` のみ対応する。

将来のmigration関数は以下の形を想定する。

```ts
type Migration = (input: unknown) => unknown;
```

制約。

- migrationは純粋関数にする
- migration前後のfixture testを必ず作成する
- 破壊的変更では旧データを読み捨てず、可能な限り変換する

---

## 16. 不変条件まとめ

- RngStateは1件のみ
- AppSettingsは1件のみ
- NormalArtianCounterは `weaponTypeId + rarity` ごとに1件のみ
- OwnedWeaponはすべて巨戟アーティア
- TargetWeaponは1構成につき1件
- RestorationBonusSetは必ず5枠
- 復元ボーナス比較は順不同
- 検索候補はTargetWeaponに紐づく
- BuildCandidateとBuildListEntryは別Entity
- Planner対象はstaleでないBuildListEntryのみ
- Active Planは同時に1件まで
- PlanとExecutionHistoryは分離する
- 保護武器をPlannerは素材消費・Reset Bonuses・Keep Bonusesへ使用しない
- protected武器でもReset SkillsのみのRouteには使用できる
- `normal_artian_to_gogma` Route内ではKeep Bonusesを実行しない
- 旧実用品の素材化予定は確認必須PlanStepとしてのみ表現する
- v1でPlannerが旧Practicalの素材化を予定できるのは、同一TargetのIdealを先に確保済み、または同一Plan内の先行Stepで確保する場合だけ
- Practical同士の優劣を理由とする自動素材化は行わない
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
- OwnedWeapon status変更時の保護初期値が正しい
- 保護武器を素材消費・Reset Bonuses・Keep Bonusesの対象にできない
- protectedなPractical / Ideal武器をReset SkillsのみのRoute起点にできる
- `existing_gogma_reset_skills` のfinalBonusesが起点OwnedWeaponと一致し、Skill Prediction結果だけがスキルへ反映される
- Reset Skills Routeの起点OwnedWeapon状態変更で `referencedOwnedWeaponsHash` が変わる
- Skill Capability不足時は `existing_gogma_reset_skills` を生成しない
- `normal_artian_to_gogma` のRouteOperation列にKeepBonusesOperationを含めない
- 巨戟化直後の未登録武器用OwnedWeaponIdを生成しない
- TargetWeapon priority未指定時に3になる
- NormalArtianCounter未確定時に通常経由検索から除外される
- RngStateの4項目を独立して確定・未確定にできる
- 不足Capabilityに依存するRouteだけが無効になる
- BuildCandidateを選択してもCandidate本体は変更されずBuildListEntryが作成される
- Target定義変更でBuildListEntryがstaleになる
- 検索に使用したRNG状態変更でBuildListEntryが `rng_state_changed` になる
- Routeに影響しない表示項目変更では `searchStateHash` が変わらない
- Route参照OwnedWeaponのボーナス、スキル、status、isProtected変更でBuildListEntryが `owned_weapon_changed` になる
- Routeに無関係なOwnedWeapon変更、または参照武器のname、memo、日時変更では `referencedOwnedWeaponsHash` が変わらない
- OwnedWeaponを参照しないRouteの `referencedOwnedWeaponsHash` は `null` になる
- ProductionPlanのactive単一制約が守られる
- Step実行前後が期待Hashと一致する正常進行ではPlanがstaleにならない
- Step実行前または実行後の期待Hashが不一致ならPlanがstaleになる
- ExecutionHistoryで想定外結果が入った場合にPlanがstaleになる
- 予定された素材化を確認した場合はPlanがstaleにならない
- 予定された素材化に対して「保管」を選んだ場合はPlanがstaleになる
- 同一TargetのIdeal確保後は旧Practicalの確認付き素材化Stepを予定できる
- より良いPracticalの取得だけを理由に旧Practicalの素材化Stepを予定しない
- PlanConflictとRejectedBuildListEntryがBuildListEntry IDだけを判断基準として保持する

## 17.2 Repository / Persistence Test

- Dexieへ各エンティティを保存・取得できる
- ExportしたJSONをImportすると同一データに戻る
- 作成元BuildCandidateが存在しないBuildListEntryでも、有効なSnapshotとTarget参照があればImportできる
- 不正な参照IDを含むImportを拒否する
- 存在しないMaster IDを含むImportを拒否する
- schemaVersion不一致を検出する
- Step確定中の任意の書き込み失敗でRNG、Normal Counter、OwnedWeapon、ExecutionHistory、ProductionPlanがすべて更新前にrollbackされる
- Undoの任意の書き込み失敗で部分復元が残らない
- 最後のExecutionHistoryのundoSnapshotだけからStep前のアプリ状態へ完全に戻せる

## 17.3 Snapshot / Hash Test

- 同じ入力から同じPlanningInputSnapshot hashが生成される
- 配列順が意味を持たない項目は安定ソートされる
- `updatedAt` やmemoの変更だけではExpectedPlanState hashが変わらない
- Route参照OwnedWeapon IDの入力順に依存せず、ID安定ソートと保存中のボーナス5枠順から決定的なHashが生成される
- CalculationContextのいずれかが変わると互換性判定が失敗する
- OwnedWeapon変更で `ownedWeaponsHash` が変わる
- TargetWeapon変更で `targetWeaponsHash` が変わる
- BuildListEntry変更で `buildListEntriesHash` が変わる
- 同じRoute依存RNG状態から同じ `searchStateHash` が生成される
- Route依存RNG状態が変わると `searchStateHash` が変わる
