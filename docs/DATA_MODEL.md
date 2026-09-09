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

B5-F1はCandidate classification / Search calculation semanticsを変更したため、
現行の `CalculationContext.appSchemaVersion` を1から **2** へ更新した。
単一authorityは `src/domain/models/common.ts` の
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2` とし、Search、BuildList、Plannerと
benchmark入力のruntime creatorで共用する。これはDexieの `DATABASE_SCHEMA_VERSION = 1`
や `AppSettings.schemaVersion = 1` の変更ではない。gameVersion、Master Data version、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`、`supportsSeedSearch = false` は維持する。

version 1の既存BuildCandidate / BuildListEntry / ProductionPlanはversion 2とCalculationContext
非互換であり、現行計算結果として再利用しない。BuildListEntryは既存のstale再判定で
`calculation_context_changed` を付け、Planner入力から除外する。旧Candidateのcategoryや
Snapshotを自動変換せず、削除migrationも追加しない。必要なCandidateは再検索して取得する。
歴史データの形式検証・Export/Import契約は変更しない。

---

## 4. Enum

```ts
export type RngStateSource =
  | "gogma_seed_finder_import"
  | "manual"
  | "observation";

export const V1_NORMAL_ARTIAN_RARITY = 8 as const;
export type NormalArtianRarity = typeof V1_NORMAL_ARTIAN_RARITY;

export type ArtianWeaponKind =
  | "normal"
  | "gogma";

export type OwnedWeaponStatus =
  | "material"
  | "practical"
  | "ideal";

export type CandidateCategory =
  | "ideal"
  | "practical";

export type RouteKind =
  | "normal_artian_to_gogma"
  | "owned_normal_artian_to_gogma"
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
  | "confirm_result";

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
- `gogmaCounter` / `skillCounter` はDomainが追跡するCounterであり、Counter Gate適用後のeffective PRNG blockを保存しない。Gate未満の保存Counter内部挙動は未確認のため推測migrationしない
- `counterGate` はlegacy/manual/import compatibility、将来のExport / Import round-trip、diagnostic / reference情報のために保持する。v1でschema migrationまたはfield削除を行わない
- `counterGate.value` と `counterGate.isConfirmed` はProduction Skill / Gogma Prediction、Candidate Search、Planner、Trace Replayのavailabilityまたは結果のsemantic authorityにしない
- Identification adoptionはBase Seed、Skill Counter、Gogma Counterのsourceを既存の `observation` とし、`counterGate`を変更しない。新しい `identified` sourceはv1必須ではない

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
  relatedTargetWeaponIds: TargetWeaponId[];
  memo: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
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
- `normal_artian` scopeを持つ巨戟アーティアへの最初のBonus amendmentは、実ゲームではReset / Keepのどちらも選択できる。ただしv1のDomainモデルはReset Bonusesだけを許可する。Production RNGがnormal-tier BonusからのKeepを予測できず期待結果を定義できないためであり、ゲームルール上の制限ではない([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.7参照)。Reset結果で5枠全体とscopeを `gogma_artian` へ置き換え、その後はReset / Keepの両方を許可する
- 1本の武器の5枠はすべて `restorationBonusScope` と一致させ、normal / gogma scopeを混在させない
- 無属性武器はscopeにかかわらず属性強化を保持できない
- 素材用でも `restorationBonuses` は必ず5枠保持する
- `status = "ideal"` の場合、初期値として `isProtected = true`
- `status = "practical"` の場合、初期値として `isProtected = true`
- `status = "material"` の場合、初期値として `isProtected = false`
- `isProtected = true` はPlannerによる破壊的操作から武器を保護する
- `isProtected = true` の武器を、素材消費、Reset Bonuses、Keep Bonusesの対象にしない
- Plannerが素材として消費できる巨戟アーティアは `status = "material" AND isProtected = false` の武器だけ
- 通常アーティアの新規保護初期値はfalseとし、ユーザーが手動で保護できる
- 保護中の通常アーティアは巨戟化Routeの変換元にしない
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
- v1のTarget bonus定義は `gogma_artian` scopeを基準とし、converted Gogmaのnormal-tier bonusへ暗黙に緩和しない

### Ideal ⇒ Practical 包含不変条件

本アプリにおける意味は次である。

```text
Ideal    = 本来ほしい完成形
Practical = Idealには届いていないが妥協して使用できるライン
```

したがってIdealはPracticalの完全上位であり、集合関係として次を不変条件とする。

```text
Ideal条件を満たす完成品の集合 ⊆ Practical条件を満たす完成品の集合
```

Bonus側。`idealBonuses` は必ず `practicalBonusConditions` のすべてと
`practicalAlternativeGroups` のすべてを満たさなければならない。

```text
有効な例
  Ideal     : 攻撃EX / 攻撃EX / ...
  Practical : 攻撃III以上 × 2

不正な例
  Ideal     : 攻撃EX × 2
  Practical : 属性III以上 × 3
```

Skill側。`idealSkillCondition` を満たす完成Skillは、必ず
`practicalSkillCondition` も満たさなければならない。
`seriesSkillId` / `groupSkillId` の `null`(指定しない)と
`matchMode` の `all` / `any` を考慮した論理包含として扱う。

```text
すべての (seriesSkillId, groupSkillId) について
  evaluateSkillCondition(idealSkillCondition, s, g)
    ⇒ evaluateSkillCondition(practicalSkillCondition, s, g)
```

この包含が成立しないTargetWeapon定義は不正である。

**B7で実装済み。** `validateTargetIdealImpliesPractical()` がこの包含を検証する。
Bonus側はTarget評価器 (`evaluateBonusCondition()` /
`evaluateAlternativeBonusConditionGroup()`) をそのまま再利用し、Rank比較は
Master Dataの `order` をauthorityとする。Skill側は `evaluateSkillCondition()`
に対する有限symbolic truth-tableとして論理包含を判定する。

Master Dataを必要とするため、`validateTargetWeapon()` のsignatureは変更せず、
Master-awareな別validatorとして次の境界で実行する。

- TargetWeapon保存時 (`TargetWeaponCrudService.save()`)
- Candidate Searchの対象Target選択時 (`selectedTargets()`)

保存済みの不正Targetは自動修正・自動削除・Practical条件の暗黙緩和を行わず、
Candidate Searchが `isEnabled = false` と同じ扱いでwarning付きに除外する。

この包含に依存する最適化を、validation有効化より先に実装してはならない。
Candidate SearchがIdeal既達成streamの探索を省略する最適化は、
validation有効化前に導入すると、包含を満たさない不正Targetに対して
Practical候補を取りこぼす。B7完了により前提は満たされている。

Search / Plannerがこの包含を暗黙に修正・緩和することは、
validation有効化の前後を問わず認めない。

この不変条件はCandidate Searchの早期終了規則の前提である
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6参照)。

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
  finalBonusScope: ArtianBonusScope;
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
  bonusAmendmentTrace?: CandidateBonusAmendmentStep[];
}

export interface BonusAmendmentResult {
  restorationBonuses: RestorationBonusSet;
  restorationBonusScope: RestorationBonusScope;
}

export interface CandidateBonusAmendmentStep extends BonusAmendmentResult {
  operationIndex: number;
  operationType: "reset_bonuses" | "keep_bonuses";
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
- `finalBonusScope` はRoute完了時に実際に保持する5枠のscopeであり、巨戟化だけなら `normal_artian`、Reset / Keep後は `gogma_artian` とする
- Production RNGが生成するCandidateのSeries Skill / Group SkillはconversionまたはReset Skillsの予測結果を保持し、conversion直後を `null / null` にしない
- `bonusAmendmentTrace` は決定済みRouteを説明する観測情報であり、Candidate semantic identityに含めない。Candidate ID（`semanticHash`）、`candidateStableKey`、Candidate重複排除key、`searchStateHash`、`referencedOwnedWeaponsHash`、`BuildCandidateMeaning` fingerprintはいずれも参照しない
- `bonusAmendmentTrace` を持つ場合、`route.operations` 内の `reset_bonuses` / `keep_bonuses` と1対1で実行順に対応し、`operationIndex` は該当Operationの位置、`operationType` はそのOperationの種別と一致する
- 各entryの `restorationBonuses` はRNG Engineが返した5枠をslot順のまま保持し、multiset正規化・並べ替えを行わない。`restorationBonusScope` は明示し、既定値で補わない
- 最後のBonus amendmentのentryは `finalBonuses` / `restorationBonusScope` と一致する。Route末尾がReset Skills等でも比較対象は最後のBonus amendmentとする
- この一致判定はslot順を含む完全一致であり、multiset比較（`areRestorationBonusSetsEqual()`）で代用しない。slot 1 - 5をそれぞれ `bonusTypeId` / `bonusRankId` まで比較し、不一致はDomain validation issueとする
- 中間結果を `finalBonuses` から逆算せず、同一depthの別branch結果を代用しない。採用されたcanonical operation historyの結果だけを保持する
- `bonusAmendmentTrace` はoptionalであり、この項目が存在しなかった時点のCandidateも有効とする。additiveな観測情報であって計算意味を変えないため、欠落を理由にstale化しない

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

export interface UseWeaponAsMaterialOperation {
  type: "use_weapon_as_material";
  ownedWeaponId: OwnedWeaponId;
}
```

制約。

- `operations` は実行順に並べ、空配列を許可しない
- CreateNormalArtianOperationの `count` は `forgeCount` で1以上、`normalCounterAfter = normalCounterBefore + count`
- `normal_artian_to_gogma` は該当NormalArtianCounterが確定している場合のみ生成する
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
- transientまたはOwned Gogmaの `restorationBonusScope = "normal_artian"` なら、v1の最初のBonus amendmentはResetBonusesOperationでなければならない。最初のReset後だけKeepBonusesOperationを許可する。この検証はProduction prediction supportの制限に由来し、normal-tier KeepのProduction prediction semanticsがgame-verifiedになった時点でSearch / Plannerの除外と同時に解除する。Keep操作自体のgame legalityは確定済みであり、再検証の対象ではない
- ResetBonusesOperationはGogma Counterを1進め、結果を `gogma_artian` scopeへ置き換える。KeepBonusesOperationもGogma Counterを1進める
- KeepBonusesOperationはユーザーselectionを持たない。現在5slotのfamilyをslotごとに保持し、同family内tierを再抽選する一意の操作である
- `existing_gogma_reset_skills` は非nullの `sourceOwnedWeaponId` を持つResetSkillsOperationだけでスキルを再付与し、復元ボーナスを変更するOperationを含めない
- `existing_gogma_reset_skills` のBuildRoute.sourceOwnedWeaponIdと各ResetSkillsOperation.sourceOwnedWeaponIdは同じ起点武器を参照する
- `existing_gogma_reset_skills` から生成するBuildCandidateの `finalBonusScope` / `finalBonuses` は起点OwnedWeaponの `restorationBonusScope` / `restorationBonuses` と一致し、seriesSkillId / groupSkillIdだけをRNG EngineのSkill Prediction結果から設定する
- Keep後を含む最終 `RestorationBonusSet` は必ずRNG EngineのPrediction結果からBuildCandidateへ設定する
- `UseWeaponAsMaterialOperation.ownedWeaponId` が検索時点で保護中の場合、SearchはそのRouteを生成しない
- ResetBonusesOperationまたはKeepBonusesOperationの起点OwnedWeaponが保護中の場合、SearchはそのRouteを生成しない
- ResetSkillsOperationは非破壊操作として扱い、`isProtected = true` の起点OwnedWeaponにも使用できる
- Route生成後に起点武器がprotectedへ変わった場合、素材消費・Reset Bonuses・Keep Bonusesを含むBuildListEntryだけをPlanner validationで実行不能とする。Reset SkillsのみのRouteは実行可能とする
- Route内で新規生成した武器を参照する専用型は持たず、巨戟化直後のtransient Gogmaは後続Reset / Keep / Reset Skillsの `sourceOwnedWeaponId = null` で表す
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
- RouteがGogma予測を使う場合はGogma CounterのvalueとisConfirmed
- RouteがSkill予測を使う場合はSkill CounterのvalueとisConfirmed
- Routeが新規通常アーティアを使う場合は対象武器種のレア8 NormalArtianCounterのcounterとisConfirmed
- legacy `counterGate` のvalue、isConfirmed、sourceは除外する。Production active Prediction結果へ影響しないGate変更だけで `rng_state_changed` を発生させない
- source、notes、観測日時、表示用フィールドは除外する

`referencedOwnedWeaponsHash` の正規化対象。

- 参照IDは `BuildRoute.sourceOwnedWeaponId`、非nullの `ResetBonusesOperation.sourceOwnedWeaponId`、非nullの `KeepBonusesOperation.sourceOwnedWeaponId`、非nullの `ResetSkillsOperation.sourceOwnedWeaponId`、`UseWeaponAsMaterialOperation.ownedWeaponId` から収集する。`null` transient sourceはOwnedWeapon参照に含めない
- 同じIDを重複排除し、ID順に安定ソートする
- 各参照武器について `id`、`kind`、`weaponTypeId`、`elementId`、`restorationBonusScope`、`restorationBonuses`、`isProtected` を含める
- 巨戟アーティアについてはさらに `seriesSkillId`、`groupSkillId`、`status` を含める
- `restorationBonuses` は保存中の5枠配列順を保持する。Keepがslotごとのfamilyを保持するため、Hash生成時に並べ替えない
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

Candidate semantic identityにはrestoration bonus scopeを含める。現行の
`createBuildCandidateMeaningFingerprint()` はscopeを含まないため、B8実装時に
scopeを含むauthorityへ修正または統合する。

Planner-generated Entryの `candidateSnapshot` も本節9.1の `BuildCandidate` 形状で
ある。ただしconstrained enumeratorが返すのはtransientな `ConstrainedCandidate` で
あり、`BuildCandidate` 形状への変換はB8-Cのdeterministic materializerが行う。
materialize時、`searchRunId` はdeterministic constrained search identity、`id` は
そのidentityとCandidate semantic meaningから安定生成した値、`createdAt` は
`PlannerClock` 由来の値、`isSimilarToIdeal` はB6既定similarity threshold 0.6で
算出した表示メタデータとする([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.13、
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。通常Candidate Searchの
`BuildCandidate` ID生成規則と `searchRunId` 契約は変更しない。

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
- `selectedBuildListEntryIds` はPlanner-generated BuildListEntryを参照してよい。
  その場合、参照するgenerated Entryは同一Dexie transactionで保存する。
  Planだけ、またはEntryだけが残るpartial saveを禁止する
- Candidate SnapshotをProductionPlanへ埋め込まない。Snapshotの保持場所は
  BuildListEntryのままとする

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

export interface PlannerOptions {
  maxPlanSteps: number;
  beamWidth: number;
  maxExpandedStates: number;
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

`PlannerInput` はstructured clone可能なデータだけを持ち、Engine instance、
engineCapabilities、existingActivePlanを含めない。`PlannerDependencies` は永続Domainではなく、
WorkerまたはApplication moduleからPlanner pure calculationへ注入するruntime境界である。
ID FactoryはProductionPlan / PlanStep / future OwnedWeapon IDを、ClockはISO UTC時刻を供給する。
Active Plan単一制約はApplication / Persistence層で扱う。

v1のPlannerOptionsは3つの1以上の整数だけとし、実用品優先を切り替える
`preferPracticalBeforeIdeal` は持たない。

```ts
export interface PlannerMaterialRequirement {
  id: string;
  sourceBuildListEntryId: BuildListEntryId | null;
  purpose: "route_material_requirement";
}
```

これはPlanner-onlyの一般素材武器需要であり、Candidate Routeの
UseWeaponAsMaterialOperationとは別契約である。未確認の武器種・属性・Bonus条件を追加しない。
また、`purpose` はRNG進行を意味しない。`use_weapon_as_material` のCounter効果がgame-verifiedになるまで、RngAdvanceへ0または+1を記録せず、その後の予測が素材使用時のRNG効果に依存するPlanをProduction対応とみなさない。

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

- `rngStateHash`: Base Seed、Gogma Counter、Skill Counterの各KnownValueについて正規化valueとisConfirmedを含み、legacy `counterGate`、source、notes、日時を除外する
- `normalCountersHash`: id、counter、isConfirmedを含み、観測日時を除外する
- `ownedWeaponsHash`: 共通項目としてID、kind、武器種、属性、restorationBonusScope、保存中のボーナス5枠順、isProtected、計画に関係するTarget参照を含む。巨戟だけseriesSkillId、groupSkillId、statusを加える。通常に存在しないSkill / statusへ仮値を設定しない。名称、memo、日時は除外する
- `buildListEntriesHash`: Entry ID、Candidate Snapshot、Target定義Hash、searchStateHash、CalculationContextを含み、派生値のisStale、staleReasons、日時を除外する

`ExpectedPlanState` の各hashは1つのPlan内で意味を持つ検証値である。`ownedWeaponsHash`
はOwnedWeapon IDを含み、`reserve_weapon` / `create_material_gogma` の予約IDは
`PlannerIdFactory` 由来であるため、同じsemantic outcomeでもPlanner実行ごとに値が変わる。
したがってPlanner実行間でhash文字列の完全一致を要求しない。要求するのは1つのPlan内の
chain validity、すなわち先頭Stepの `expectedStateBefore` が
`PlanningInputSnapshot.initialExecutionState` と一致し、Step Nの `expectedStateAfter`
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
- `operationType = "create_material_gogma"` は直前までの作成・巨戟化結果を素材用OwnedWeaponとして登録するPlanner-only Stepであり、RouteOperationまたは追加のRNG操作ではない
- `create_material_gogma` の `targetWeaponId`、`buildListEntryId`、`candidateId` は `null`、`ownedWeaponId` はPlanner生成時に予約した追加予定ID、`requiresUserConfirmation = true` とする
- `create_material_gogma.inventoryChange.addOwnedWeapon` は `ownedWeaponId` と同じIDの `kind = "gogma"`、`status = "material"`、`isProtected = false` の武器を保持し、直前の予測／実結果のrestorationBonusScope、ボーナス、Series Skill、Group Skillを失わない
- `create_material_gogma.rngAdvance` はGogma / Skill / Normalのいずれも進行させず、`expectedStateBefore` には予約武器が存在せず、`expectedStateAfter.ownedWeaponsHash` には追加後の在庫を反映する
- 予約IDは後続 `use_weapon_as_material` から同じ武器を参照するために使用してよいが、Step確定前にDBへ追加せず、BuildRouteへ未来OwnedWeapon IDを入れない
- `create_material_gogma` は既存PracticalをMaterial / unprotectedへ変える `change_owned_weapon_status`、Target候補を確保する `reserve_weapon` と役割を分ける
- `reserve_weapon` は結果確認だけの `confirm_result` と異なり、Target候補をInventoryへ正式確保してTargetSatisfactionを更新する
- `normal_artian_to_gogma` のreserveは予約した新IDでGogmaを追加し、Candidate categoryに対応するstatus、protected、CandidateのfinalBonusScopeを含む完成結果、Target参照を保持する
- `owned_normal_artian_to_gogma` のconvert Stepは元Normal IDをInventoryから削除し、変換後Gogmaをまだ登録しない。後続Reset / Keep / Reset SkillsはsourceOwnedWeaponId = nullを維持する
- `owned_normal_artian_to_gogma` のreserveは元Normalを再削除せず、別の予約IDでGogmaだけを追加する。元IDのkind変更では表現しない
- `existing_gogma_*` のreserveは新規追加せず、Route sourceと同じGogma IDをCandidate結果、status、protected、Target参照で更新する。既存Target参照とcreatedAtを失わない
- reserveによるInventoryChangeはexpectedStateBefore / expectedStateAfterへ反映し、relatedTargetWeaponIdsへTarget IDを重複なく追加する
- 再計算はstale Planに対するUI / Planner操作であり、`recalculate_plan` PlanStepを旧Planへ追加しない

## 11.4 ExpectedResult

```ts
export interface ExpectedResult {
  restorationBonusScope: ArtianBonusScope | null;
  restorationBonuses: RestorationBonusSet | null;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  candidateCategory: CandidateCategory | null;
  isSimilarToIdeal: boolean;
  shouldSecure: boolean;
}
```

Counter deltaの正式契約はcreate normalがNormal +1 / forge、conversionがSkill +1、Reset SkillsがSkill +1、Reset Bonuses / Keep BonusesがGogma +1である。conversionのGogma deltaは0とする。PRNG内部10 stepをDomain Counter deltaへ入れない。

`convert_normal_to_gogma` のExpectedResultは、変換元Normalからslot順のまま継承した `restorationBonusScope = "normal_artian"` の5枠と、変換時のSkill Predictionで付与された初回Series Skill / Group Skillを同時に保持する。Reset Bonuses結果は `restorationBonusScope = "gogma_artian"`、Keep Bonuses結果も `gogma_artian` とする。

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

競合選択は `PlannerConflictResolution` として次回PlannerInputへ渡す。
`conflictKey` は安定したPlanConflict IDに対応し、選択はその局所競合だけを解決する。
削除済み、stale、Target無効、Capability不足、保護状態変更で実行不能なEntry選択は適用せずwarningとする。

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

同じ論理競合は再Plannerでも同じID、位置・参加Entry・対象資源が変われば別IDになる。
第9の競合適用時はconflictKeyが再検出した競合と一致し、selectedBuildListEntryIdがその
競合のbuildListEntryIdsに含まれる場合だけresolutionを適用する。

Planner warningの探索上限は次の2種を区別する。

```text
max_steps_reached
max_expanded_states_reached
```

前者はmaxPlanSteps、後者はmaxExpandedStates到達時だけ使用し、途中のbest Planとwarningを同時に返してよい。

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

## 14.5 Planner Save Transaction

Planner constrained re-searchを経たPlan保存も原子的に行う。契約本文は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.15にある。

- Planner-generated BuildListEntry群と `ProductionPlan` を1つのDexie
  read-write transactionで保存する
- Planだけ、またはEntryだけが残るpartial saveを禁止する
- 保存直前にcurrent stateを再読込・再validationし、失敗時は何も書き込まない
- Planner Domain / WorkerはIndexedDBへ直接アクセスしない。この保存は
  Application / Persistence層の責務とする

新しいtableもDexie schema versionの変更も伴わない。`buildListEntries` と
`productionPlans` の既存tableをそのまま使う。

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
- Planner対象はstaleでないBuildListEntryのみ
- Active Planは同時に1件まで
- PlanとExecutionHistoryは分離する
- 保護武器をPlannerは素材消費・Reset Bonuses・Keep Bonusesへ使用しない
- protected武器でもReset SkillsのみのRouteには使用できる
- 通常→巨戟化はNormal bonus 5枠をslot順のまま継承し、Skill Counterだけを1進め、Normal / Gogma Counterを進めない
- normal scopeの巨戟に対する最初のBonus amendmentは、v1ではprediction support上の理由でReset Bonusesだけを許可し、その後は同一Route内でもReset / Keepを許可する
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
- `candidateOffset = 0` の通常候補Routeが1本forgeし、一般のoffset kでは `forgeCount = k + 1` となり、最後の1本だけを巨戟化する
- CreateNormalArtianOperationの `normalCounterAfter = normalCounterBefore + count` と候補位置 `normalCounterBefore + count - 1` が一致する
- conversion直後のExpectedResultがnormal scope 5枠と初回Series / Groupを保持する
- normal scopeのtransient GogmaへKeep Bonusesを直接適用せず、最初のReset後だけKeepする。除外理由をprediction support不足として扱い、ゲームルール由来として扱わない
- transient GogmaのReset / Keep / Reset Skillsが `sourceOwnedWeaponId = null` で表現され、fake OwnedWeaponIdを生成しない
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
- Route参照OwnedWeapon IDの入力順に依存せず、ID安定ソート、restorationBonusScope、保存中のボーナス5枠順から決定的なHashが生成される
- CalculationContextのいずれかが変わると互換性判定が失敗する
- OwnedWeapon変更で `ownedWeaponsHash` が変わる
- OwnedWeaponのkind変更で `ownedWeaponsHash` と `referencedOwnedWeaponsHash` が変わる
- OwnedWeaponのname、memo、日時変更だけでは両Hashが変わらない
- `create_material_gogma` Stepがunprotected Material Gogmaの追加、予約ID一致、RNG進行0、Target / BuildList / Candidate参照nullを満たす
- `recalculate_plan` がPlanStepOperationTypeとして受理されない
- PlannerInputへRngEngine / engineCapabilities / existingActivePlanを含めずstructured cloneできる
- PlannerOptionsはmaxPlanSteps、beamWidth、maxExpandedStatesだけを受け付け、各1以上を要求する
- normal新規、所持Normal、既存Gogmaのreserve InventoryChangeがそれぞれadd、add-only、same-ID updateになる。所持Normalのremoveはconvert Stepで検証する
- Candidate BuildRouteを変更せず、Planner-only future Material IDを登録後の消費Stepだけで使用する
- 有効な競合選択だけを適用し、削除済み・staleな選択をwarningにする
- max_steps_reachedとmax_expanded_states_reachedを別kindとして検証する
- TargetWeapon変更で `targetWeaponsHash` が変わる
- BuildListEntry変更で `buildListEntriesHash` が変わる
- 同じRoute依存RNG状態から同じ `searchStateHash` が生成される
- Route依存RNG状態が変わると `searchStateHash` が変わる
