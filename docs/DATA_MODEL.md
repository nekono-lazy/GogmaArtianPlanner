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
export type CompromiseCheckpointGroupId =
  Brand<string, "CompromiseCheckpointGroupId">;
export type CompromiseCheckpointOpportunityId =
  Brand<string, "CompromiseCheckpointOpportunityId">;
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
Planner fast-forward / conflict semanticsをすべて変更するため、現行versionは **10** である。
旧1..9の全計算artifactは非互換とする。
以下の2..5互換例外は歴史的契約でありversion 6以降には適用しない。
現行versionの単一authorityは `src/domain/models/common.ts` の
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 10` とし、Search、BuildList、Plannerと
benchmark入力のruntime creatorで共用する。永続モデル移行は独立してDexie
`DATABASE_SCHEMA_VERSION = 4`、AppSettingsは `schemaVersion = 1` のままとする。Calculation semantics / artifact
validity境界とDexie schemaは別の概念であり、片方の更新はもう片方の更新を意味しない。
gameVersion、Master Data version、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`、`supportsSeedSearch = false` は維持する。

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

export type ProductionPlanStatus =
  | "draft"
  | "active"
  | "completed"
  | "stale"
  | "abandoned";

export type PlanStepOperationType =
  | "create_normal_artian"
  | "convert_normal_to_gogma"
  | "reset_bonuses"
  | "keep_bonuses"
  | "reset_skills"
  | "reserve_weapon"
  | "confirm_result";

export type ExecutionAction =
  | "confirmed_expected"
  | "secured_weapon"
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
- statusにかかわらず `restorationBonuses` は必ず5枠保持する
- `status` はユーザーが所持武器を整理するための管理ラベルだけを意味する。Plannerの操作可否、
  Search Route eligibility、Target Satisfactionをstatusから決定しない
- 手動で新規登録する巨戟アーティアの初期値は `status = "unclassified"`、`isProtected = false`
- PlannerがCandidateを確保する場合、`status = "practical"` は `isProtected = false`、
  `status = "ideal"` は `isProtected = true` を初期値とする
- `isProtected = true` はPlanner / Candidate Searchによる武器性能の変更から武器を保護する
- `isProtected = true` の武器を、Reset Bonuses、Keep Bonuses、Reset Skillsの対象にしない
- statusと保護は独立したユーザー設定であり、既存保存値をmigrationまたはstatus変更だけで暗黙変更しない
- 通常アーティアの新規保護初期値はfalseとし、ユーザーが手動で保護できる
- 保護中の通常アーティアは巨戟化Routeの変換元にしない
- Plannerに保護武器の消費を許可するoverride設定は持たない
- statusを書き換える経路は、Owned Weapons画面の通常CRUDと、`reserve_weapon` が
  理想品ラベルを設定する場合だけとする。後者は新規生成Candidateでも既存Gogma
  Candidateの確保でも同じで、既存Gogmaの保護状態は維持する。checkpointへの到達では
  statusも保護も変更しない。Material化のためのstatus変更と
  `change_owned_weapon_status` PlanStepは廃止した
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
- Search / Plannerでの位置づけは[SEARCH_SPEC.md](./SEARCH_SPEC.md) 8.1と
  [PLANNER_SPEC.md](./PLANNER_SPEC.md) 7.4に従う
- Target Satisfactionを制限しない。あるTargetがWeapon Xを優先起点にしていても、性能を満たす
  別のWeapon YがそのTargetを満たしてよい。1対1制約は優先起点の関係にだけ適用する
- `reserve_weapon` その他のPlanner処理がこの値を自動設定・自動付け替えしてはいけない。
  設定はTarget Weapons画面からのユーザー操作だけで行う

collection validation。TargetWeapon単体validationは構造だけを検証できるため、以下は
OwnedWeapon collectionと他Targetを参照する専用のvalidation authorityでfail closedにする。
保存Service、Candidate Search入力、Planner入力の各境界で同じ契約を再利用し、UIだけを
authorityにしない。

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
   * このCandidate自身のRouteのstrict prefixに現れる妥協checkpoint。
   * 現行calculation schemaのCandidateでは必須であり、field自体が存在しない
   * 旧artifactはそのまま保持する（SEARCH_SPEC 5.8）。
   */
  checkpointGroups?: CompromiseCheckpointGroup[];
}

export interface CompromiseConditionMatch {
  bonus: "ideal" | "practical" | "alternative";
  skill: "ideal" | "practical";
}

/** ユーザーから見て同一の妥協品。slot順はidentityに含めない。 */
export interface CompromiseCheckpointGroup {
  id: CompromiseCheckpointGroupId;
  restorationBonusScope: ArtianBonusScope;
  /** 代表として表示する5枠。最早opportunityのslot順をそのまま使う。 */
  restorationBonuses: RestorationBonusSet;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  conditionMatch: CompromiseConditionMatch;
  /** Route位置の昇順。1件以上。 */
  opportunities: CompromiseCheckpointOpportunity[];
  /** 表示専用のdominance。Domainからは何も削除しない。 */
  isDisplaySecondary: boolean;
  dominatingGroupId: CompromiseCheckpointGroupId | null;
}

/** その妥協品へ到達する具体的なRoute位置。 */
export interface CompromiseCheckpointOpportunity {
  id: CompromiseCheckpointOpportunityId;
  /** `route.operations` のindex。常に `operations.length - 1` 未満。 */
  afterOperationIndex: number;
  operationCount: number;
  remainingOperationCount: number;
  /** exactなslot順。groupの代表5枠とはslot順が異なりうる。 */
  restorationBonuses: RestorationBonusSet;
  restorationBonusScope: ArtianBonusScope;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  conditionMatch: CompromiseConditionMatch;
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
- `checkpointGroups` は現行calculation schemaのCandidateでは必須である。field自体が
  無い旧artifactは互換対象として保持し、補完も再分類もしない
- 各checkpoint groupは `restorationBonusScope = "gogma_artian"` であり、
  `conditionMatch` が両軸idealになることはない
- 各opportunityの `afterOperationIndex` は `route.operations.length - 1` 未満の
  strict prefixであり、group内で昇順に並ぶ
- 各opportunityはgroupと同じscope / 5枠multiset / Series Skill / Group Skillへ到達する
- 各opportunityの `conditionMatch` はgroupの `conditionMatch` と一致する
- 各opportunityの `operationCount` はRoute先頭から `afterOperationIndex` までの
  操作unit数(`create_normal_artian` は `count` 本分)と一致し、
  `remainingOperationCount` はRoute全体のunit数からそれを引いた値と一致する
- `dominatingGroupId` は同じCandidateの別groupのIDだけを参照する。自分自身や
  存在しないgroupを参照せず、`isDisplaySecondary` は `dominatingGroupId !== null`
  と一致する
- group IDとopportunity IDは `candidateStableKey` とgroup identityから決まる
  deterministicな値であり、`searchRunId`・Clock・列挙順に依存しない。group IDは
  `checkpoint-group:`、opportunity IDは `checkpoint-opportunity:` で始まる
- 現行calculation schemaのCandidate validationは上記をすべて検証する。
  `checkpointGroups` を持たないschema 9以前のartifactは互換対象として読めるまま
  保持し、補完しない
- `checkpointGroups` はCandidate semantic identityに含めない。Candidate ID
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
- transientまたはOwned Gogmaの `restorationBonusScope = "normal_artian"` なら、v1の最初のBonus amendmentはResetBonusesOperationでなければならない。最初のReset後だけKeepBonusesOperationを許可する。この検証はProduction prediction supportの制限に由来し、normal-tier KeepのProduction prediction semanticsがgame-verifiedになった時点でSearch / Plannerの除外と同時に解除する。Keep操作自体のgame legalityは確定済みであり、再検証の対象ではない
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
   * ユーザーが選択した妥協checkpointのopportunity ID。
   * 初期値は空配列であり、1 groupにつき最大1件だけ選択できる。
   * 選択はCandidateの意味ではなくユーザーの計画入力なので、Candidate Snapshot、
   * 両hash、CalculationContextのいずれも変更せず、Entryをstaleにしない。
   * 一方でPlanの `buildListEntriesHash` には入るため、選択を変えると既存Planは
   * 再計算対象になる（PLANNER_SPEC 7.5.5）。
   */
  selectedCheckpointOpportunityIds?: CompromiseCheckpointOpportunityId[];
}

export type BuildListEntryStaleReason =
  | "target_definition_changed"
  | "rng_state_changed"
  | "owned_weapon_changed"
  | "calculation_context_changed";
```

不変条件。

- 作成リスト追加時にBuildCandidate全体を `candidateSnapshot` へ複製する
- `targetDefinitionHash` はTargetWeaponの意味を持つ項目を安定serializeして生成する。
  `preferredOwnedWeaponId` はTargetの計画意味に影響するため対象に含め、変更すると既存Entryは
  `target_definition_changed` としてstaleになる。一方でCandidate stable key、Candidate ID、
  Candidate dedup key、BuildCandidate meaning fingerprintへは混ぜない。preferredはCandidate
  自身の意味ではなくTarget側の選好だからである
- `searchStateHash` は `candidateSnapshot.searchStateHash` を複製する
- `referencedOwnedWeaponsHash` は `candidateSnapshot.referencedOwnedWeaponsHash` を複製する
- `calculationContext` は `candidateSnapshot.calculationContext` と一致する
- 再検索でBuildCandidateが削除または置換されてもSnapshotは保持する
- `candidateId` は作成元の追跡用であり、作成元BuildCandidate削除後もSnapshotが有効ならEntryはstaleにならない
- TargetWeapon変更、検索に使用したRNG状態変更、Route参照OwnedWeapon変更、CalculationContext非互換時は `isStale = true` とし、Planner入力から除外する
- 初期版では `searchStateHash` が現在値から再計算したHashと異なる場合、安全側に倒して `rng_state_changed` とする
- Route成立性に影響しない変更を明示的かつテスト可能に証明できる場合だけ、将来 `rng_state_changed` を回避してよい
- Active Plan開始後、PlanどおりのRNG進行またはOwnedWeapon変更でEntry自体が再利用不可になっても、進行中Planのstale判定はPlanStepの期待状態を優先する
- 同じCandidateを重複追加しない。既に同一semanticのCandidateが存在する場合は既存Entryを
  返し、`selectedCheckpointOpportunityIds` を上書きしない
- `selectedCheckpointOpportunityIds` の各IDは `candidateSnapshot.checkpointGroups` の
  いずれかのopportunityに存在しなければならない。存在しないIDはfail closedで拒否する
- 同一groupから2件以上のopportunityを選択できない
- 同じopportunity IDを2回含めない
- checkpoint選択の変更は `isStale` / `staleReasons` に影響しない

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
`PlannerClock` 由来の値、`checkpointGroups` はそのCandidateへcheckpoint抽出を
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
}
```

各hashは、Plan実行に影響する項目だけを安定ソートした正規化JSONから生成する。`updatedAt`、表示名、メモなど計算に影響しない項目を含めない。

- `rngStateHash`: Base Seed、Gogma Counter、Skill Counterの各KnownValueについて正規化valueとisConfirmedを含み、legacy `counterGate`、source、notes、日時を除外する
- `normalCountersHash`: id、counter、isConfirmedを含み、観測日時を除外する
- `ownedWeaponsHash`: 共通項目としてID、kind、武器種、属性、restorationBonusScope、保存中のボーナス5枠順、isProtectedを含む。OwnedWeaponはTargetWeaponを参照しないため、Target関連情報は含めない。巨戟だけseriesSkillId、groupSkillIdを加える。`status` は管理ラベルであり計算に影響しないため、名称、memo、日時と同じく除外する。通常に存在しないSkillへ仮値を設定しない
- `buildListEntriesHash`: Entry ID、Candidate Snapshot、Target定義Hash、searchStateHash、CalculationContextを含み、派生値のisStale、staleReasons、日時を除外する

`ExpectedPlanState` の各hashは1つのPlan内で意味を持つ検証値である。`ownedWeaponsHash`
はOwnedWeapon IDを含み、`reserve_weapon` の予約IDは
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
  progressedTargetWeaponIds?: TargetWeaponId[];
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
- statusだけを変更する専用PlanStepは持たない。`reserve_weapon` が理想品のラベル
  （`ideal` / 保護あり）を設定する以外に、Plannerがstatusを書き換える経路はない。statusは
  非semanticであるため、ユーザーがOwned Weapons画面でラベルを変更しても実行中Planの
  ExpectedPlanState不一致にならない
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
- `reserve_weapon` は結果確認だけの `confirm_result` と異なり、Target候補をInventoryへ正式確保してTargetSatisfactionを更新する
- `normal_artian_to_gogma` のreserveは予約した新IDでGogmaを追加し、`status = "ideal"`、
  保護初期値 `true`、CandidateのfinalBonusScopeを含む完成結果を保持する。Candidateは
  常に理想品なので、reserve時のラベルは常にIdealである
- checkpointへ到達しただけではreserveしない。statusも保護も変更しない。reserve semanticsは
  最終的に理想品が完成したときだけ適用する（PLANNER_SPEC 7.5.4）
- `owned_normal_artian_to_gogma` のconvert Stepは元Normal IDをInventoryから削除し、変換後Gogmaをまだ登録しない。後続Reset / Keep / Reset SkillsはsourceOwnedWeaponId = nullを維持する
- `owned_normal_artian_to_gogma` のreserveは元Normalを再削除せず、別の予約IDでGogmaだけを追加する。元IDのkind変更では表現しない
- amendmentを持つ `existing_gogma_*` のreserveは新規追加せず、Route sourceと同じGogma IDをCandidate結果、status、Target参照で更新する。保存済みの保護状態、既存Target参照、createdAtを失わない
- reserveによるInventoryChangeはexpectedStateBefore / expectedStateAfterへ反映する。OwnedWeaponへTarget IDを追加する処理は存在せず、`TargetWeapon.preferredOwnedWeaponId` も変更しない
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
  checkpointGroupId: CompromiseCheckpointGroupId;
  checkpointOpportunityId: CompromiseCheckpointOpportunityId;
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
   * 選択済みcompromise checkpointの終端unitとしてこの競合に参加するEntry。
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

初期作成schemaは1。現行DATABASE_SCHEMA_VERSIONは4。version(1)のstoresを保持し、
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

## 14.4 Execution Transaction

Execution Navigatorの1Step確定処理は、次の更新を1つのDexie read-write transactionで原子的に行う。

- Step実行前状態からExecutionUndoSnapshotを作成する
- RngStateを更新する
- NormalArtianCounterを更新する
- OwnedWeaponを追加、更新、削除する
- ExecutionHistoryを追加する
- PlanStepを完了またはstaleとして更新する
- ProductionPlanのcurrentStepId、status、recalculationReasons、updatedAtを更新する

対象操作は、結果一致、武器確保、想定外結果記録とする。Transaction内のいずれかが失敗した場合は全更新をrollbackし、Step確定前の状態を維持する。

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
  schemaVersion: 5;
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

現行ExportRootはschemaVersion=5である。BuildCandidateが `checkpointGroups` を、
BuildListEntryが `selectedCheckpointOpportunityIds` を持つ最初の形状であり、
Dexie `DATABASE_SCHEMA_VERSION = 4` とは独立して更新する。
現実装は型のみであり全置換Import/Exportサービスは未実装。
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
- Planner対象はstaleでないBuildListEntryのみ
- Active Planは同時に1件まで
- PlanとExecutionHistoryは分離する
- 保護武器をPlannerはReset Bonuses・Keep Bonuses・Reset Skillsへ使用しない
- protected武器でも現在性能を変更しない操作0 Candidateとしては利用できる
- 通常→巨戟化はNormal bonus 5枠をslot順のまま継承し、Skill Counterだけを1進め、Normal / Gogma Counterを進めない
- normal scopeの巨戟に対する最初のBonus amendmentは、v1ではprediction support上の理由でReset Bonusesだけを許可し、その後は同一Route内でもReset / Keepを許可する
- Plannerは所持武器を素材として消費せず、statusは `reserve_weapon` の理想品ラベル設定以外で変更しない
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
- 所持武器のstatusだけを変更してもPlanがstaleにならない
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
- `create_material_gogma` / `use_weapon_as_material` / `change_owned_weapon_status` を
  含むPlanStepをDomain validationが拒否する
- `recalculate_plan` がPlanStepOperationTypeとして受理されない
- PlannerInputへRngEngine / engineCapabilities / existingActivePlanを含めずstructured cloneできる
- PlannerOptionsはmaxPlanSteps、beamWidth、maxExpandedStatesだけを受け付け、各1以上を要求する
- normal新規、所持Normal、既存Gogmaのreserve InventoryChangeがそれぞれadd、add-only、same-ID updateになる。所持Normalのremoveはconvert Stepで検証する
- Candidate BuildRouteを変更せず、Candidate Route内の具体的な起点OwnedWeapon IDを別武器へ差し替えない
- 有効な競合選択だけを適用し、削除済み・staleな選択をwarningにする
- max_steps_reachedとmax_expanded_states_reachedを別kindとして検証する
- TargetWeapon変更で `targetWeaponsHash` が変わる
- BuildListEntry変更で `buildListEntriesHash` が変わる
- 同じRoute依存RNG状態から同じ `searchStateHash` が生成される
- Route依存RNG状態が変わると `searchStateHash` が変わる


### 妥協条件version 6の判定理由と監査記録

妥協判定 `conditionMatch`（bonus: ideal/practical/alternative、skill: ideal/practical）は
Candidate本体ではなくcheckpoint group / opportunityが保持し、Build List snapshotへそのまま複写する。
これはTarget定義と完成結果から導出した説明情報であり、Candidate ID / stable key / deduplication key / meaning fingerprint / searchStateHashには追加しない。
条件の意味はTarget definition hashとCalculationContext version 6で区別する。旧artifactではフィールドを省略でき、推測補完・再分類しない。
UIは保存された判定理由を「ボーナス判定: 実用 / 代替」「スキル判定: 理想 / 実用」と表示する。
両軸Idealは理想品そのものなのでcheckpointとしては存在しない。

Productionベンチマークの旧wildcard条件も明示的な理想構成基準へ変更するため、旧versionの測定記録と負荷が異なる。
過去のBrowser Worker測定値は当時のartifactとして保持する。今回のVitestは意味・不変条件の検証であり、新しいBrowser性能測定の代用ではない。

Build Listへの同一意味の候補の重複追加を防ぐ際はCalculationContext互換性も確認する。
旧version 1..5の項目を削除・上書きせず、version 6の再検索結果を別項目として追加できる。この歴史的境界とは別に、現行version 7では旧1..6をfail closedとする。
Candidate meaning fingerprint自体は変更しない。
