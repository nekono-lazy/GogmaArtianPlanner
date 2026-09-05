# モンハンワイルズ 巨戟アーティア厳選Planner
## MASTER_DATA.md

## 1. この文書の目的

この文書は、アプリが参照するマスターデータの構造、ID、JSON配置、バージョン管理、制約、検証、テスト観点を定義する。

マスターデータはアプリケーションコードと分離し、ゲームアップデート時は原則としてJSONを更新する。

---

## 2. 配置

推奨配置。

```text
src/data/master/
  manifest.json
  weapon-types.json
  elements.json
  bonus-types.json
  bonus-ranks.json
  weapon-bonus-definitions.json
  series-skills.json
  group-skills.json
  lottery.json
  materials.json
  material-costs.json
```

TypeScript側。

```text
src/domain/master/
  masterTypes.ts
  loadMasterData.ts
  validateMasterData.ts
  masterSelectors.ts
```

---

## 3. バージョン

## 3.1 MasterManifest

```ts
export interface MasterManifest {
  gameTitle: "Monster Hunter Wilds";
  appDataKind: "gogma-artian-planner-master";
  gameVersion: string;
  dataVersion: number;
  generatedAt: string | null;
  notes: string | null;
}
```

例。

```json
{
  "gameTitle": "Monster Hunter Wilds",
  "appDataKind": "gogma-artian-planner-master",
  "gameVersion": "unknown-initial",
  "dataVersion": 1,
  "generatedAt": null,
  "notes": "初期版の手入力マスターデータ"
}
```

制約。

- `dataVersion` は正の整数
- ゲームアップデート対応でデータ内容が変わる場合は `dataVersion` を上げる
- UIには `gameVersion` と `dataVersion` を設定画面で表示する
- User Exportにはユーザーデータの `schemaVersion` を含めるが、Master Data本体は含めない
- 計算時は `gameVersion` を `CalculationContext.gameVersion`、`dataVersion` を `CalculationContext.masterDataVersion` として保存する

---

## 4. WeaponTypeMaster

```ts
export interface WeaponTypeMaster {
  id: WeaponTypeId;
  displayNameJa: string;
  displayNameEn: string;
  sortOrder: number;
  category: "melee" | "ranged";
  supportsElement: boolean;
  supportsSharpness: boolean;
  isEnabled: boolean;
}
```

例。

```json
{
  "id": "weapon.dual_blades",
  "displayNameJa": "双剣",
  "displayNameEn": "Dual Blades",
  "sortOrder": 4,
  "category": "melee",
  "supportsElement": true,
  "supportsSharpness": true,
  "isEnabled": true
}
```

制約。

- `id` は `weapon.` prefixを推奨
- `sortOrder` は重複してもよいが、UI表示は `sortOrder`, `id` の順に安定ソートする
- 初期版で未検証の武器種は `isEnabled = false` にしてUI選択肢から除外してよい

---

## 5. ElementMaster

```ts
export interface ElementMaster {
  id: ElementId;
  displayNameJa: string;
  displayNameEn: string;
  sortOrder: number;
  allowsElementBonus: boolean;
  isEnabled: boolean;
}
```

例。

```json
{
  "id": "element.thunder",
  "displayNameJa": "雷",
  "displayNameEn": "Thunder",
  "sortOrder": 4,
  "allowsElementBonus": true,
  "isEnabled": true
}
```

制約。

- `id` は `element.` prefixを推奨
- 無属性を扱う必要がある場合は `element.none` を定義する
- TargetWeaponとOwnedWeaponの `elementId` は必ずこのマスターを参照する

---

## 6. BonusTypeMaster

復元ボーナスの種類。

```ts
export interface BonusTypeMaster {
  id: BonusTypeId;
  displayNameJa: string;
  displayNameEn: string;
  sortOrder: number;
  category: "offense" | "element" | "sharpness" | "ranged" | "utility";
  isEnabled: boolean;
}
```

例。

```json
{
  "id": "bonus_type.attack",
  "displayNameJa": "攻撃",
  "displayNameEn": "Attack",
  "sortOrder": 10,
  "category": "offense",
  "isEnabled": true
}
```

制約。

- 「攻撃」「属性」「会心」「斬れ味」などをBonusTypeとして定義する
- 武器種ごとの差分はここでは持たず、WeaponBonusDefinitionで定義する

---

## 7. BonusRankMaster

```ts
export interface BonusRankMaster {
  id: BonusRankId;
  displayNameJa: string;
  displayNameEn: string;
  order: number;
  isEx: boolean;
  isEnabled: boolean;
}
```

例。

```json
{
  "id": "bonus_rank.ex",
  "displayNameJa": "EX",
  "displayNameEn": "EX",
  "order": 4,
  "isEx": true,
  "isEnabled": true
}
```

制約。

- ランク比較は `order` で行う
- EX判定は文字列比較ではなく `isEx` で行う
- 実用ラインの「II以上」は `order >= rank("II").order` として判定する

---

## 8. WeaponBonusDefinition

武器種ごとに利用可能な復元ボーナス、表示、効果値を定義する。

通常アーティアと巨戟アーティアのボーナス体系は文字列IDから推測せず、次のscopeで明示する。

```ts
export type ArtianBonusScope =
  | "normal_artian"
  | "gogma_artian";
```

```ts
export interface WeaponBonusDefinition {
  id: string;
  weaponTypeId: WeaponTypeId;
  bonusTypeId: BonusTypeId;
  bonusRankId: BonusRankId;
  scope: ArtianBonusScope;
  displayNameJa: string;
  displayNameEn: string;
  effectValue: string;
  sortOrder: number;
  isEnabled: boolean;
}
```

ID規則。

```text
weapon_bonus.{scope}.{weaponTypeId}.{bonusTypeId}.{bonusRankId}
```

例。

```json
{
  "id": "weapon_bonus.gogma_artian.dual_blades.attack.ex",
  "weaponTypeId": "weapon.dual_blades",
  "bonusTypeId": "bonus_type.attack",
  "bonusRankId": "bonus_rank.ex",
  "scope": "gogma_artian",
  "displayNameJa": "基礎攻撃力強化EX",
  "displayNameEn": "Attack Boost EX",
  "effectValue": "未検証",
  "sortOrder": 1010,
  "isEnabled": true
}
```

制約。

- TargetWeaponの既存Ideal / Practical bonus定義は `gogma_artian` scopeを基準とし、今回の契約変更でnormal-tierへ自動緩和しない
- OwnedNormalArtianWeaponと通常アーティアPrediction・Debugは `normal_artian` scopeを使う
- OwnedGogmaArtianWeaponは、変換直後から最初のBonus amendmentまでは `normal_artian`、Reset / Keep後は `gogma_artian` を使う。保存された `restorationBonusScope` を明示してSelectorを呼ぶ
- UIやDomain validationはOwnedWeaponを暗黙に巨戟とみなさず、`weaponTypeId + elementId + ArtianBonusScope` を明示してSelectorを呼ぶ
- 同一 `scope + weaponTypeId + bonusTypeId + bonusRankId` は1件のみ
- `effectValue` は表示用文字列。計算ロジックは効果値に依存しない
- 武器種によって存在しないBonusTypeやRankは定義しない

## 8.1 通常／巨戟Bonus Type体系

確認済みの体系は次のとおり。

- 共通概念: 基礎攻撃力強化、会心率強化、属性強化
- 通常アーティア専用: 斬れ味強化、装填数強化（別々のBonus Type）
- 巨戟アーティア専用: 斬れ味・装填強化（近接とボウガンで共通の1 Bonus Type）
- 弓は斬れ味強化、装填数強化、斬れ味・装填強化を利用しない
- ライト／ヘビィボウガンは属性強化を利用しない

巨戟側の現在Master Rankは、基礎攻撃力強化・会心率強化が I / II / III / EX、属性強化が I / II / EX、斬れ味・装填強化が通常 / EX。通常アーティア側の基本Bonusはsuffixなしの通常Rankを使う。このRank順は比較用であり、通常Rankと巨戟Rankの変換規則を意味しない。通常→巨戟化ではRankを変換せずnormal scope 5枠をそのまま継承する。

## 8.2 ArtianBonusTypeMapping

通常から巨戟への意味上のBonus Type対応を明示Masterとして保持する。

```ts
export interface ArtianBonusTypeMapping {
  id: string;
  normalBonusTypeId: BonusTypeId;
  gogmaBonusTypeId: BonusTypeId;
}
```

```text
通常 基礎攻撃力強化 -> 巨戟 基礎攻撃力強化
通常 会心率強化     -> 巨戟 会心率強化
通常 属性強化       -> 巨戟 属性強化
通常 斬れ味強化     -+
                       +-> 巨戟 斬れ味・装填強化
通常 装填数強化     -+
```

複数の通常Bonus Typeから同一巨戟Bonus TypeへのMany-to-Oneは有効。逆引きは配列として扱う。MappingはBonus Typeの意味対応だけであり、conversion時のType / Rank変換、抽選、完成ボーナス生成には使用しない。巨戟化だけならnormal scopeを継承し、Reset / Keep後のgogma scope結果はRNG Engine Predictionが返す。

BowのSharpness/Ammo family、LBG/HBGのElement family、elementless GogmaのElement bonus、栄光の誉れ、祝祭の巡り、Gogma rank Iは参照RNG poolとCurrent Masterの差分が未確認である。今回、既存Master JSONまたはDomain制約を変更せず、現在Masterの存在／有効性をProduction RNG抽選poolの検証根拠にしない。

---

## 9. SeriesSkillMaster

```ts
export interface SeriesSkillMaster {
  id: SeriesSkillId;
  displayNameJa: string;
  displayNameEn: string;
  sortOrder: number;
  isEnabled: boolean;
}
```

例。

```json
{
  "id": "series_skill.gore_magala",
  "displayNameJa": "黒蝕竜の力",
  "displayNameEn": "Gore Magala's Tyranny",
  "sortOrder": 100,
  "isEnabled": true
}
```

制約。

- 未指定はマスターデータではなくDomain Model上の `null` で表す
- UIでは「指定なし」を選択肢として追加表示する
- 登録25件のうち、巨戟アーティアに出現しない花舞の祈り、踊火の祈り、夢灯の祈り、祝謡の祈りは履歴参照用IDを維持して `isEnabled = false` とする。通常UIは有効21件だけを表示する

---

## 10. GroupSkillMaster

```ts
export interface GroupSkillMaster {
  id: GroupSkillId;
  displayNameJa: string;
  displayNameEn: string;
  sortOrder: number;
  isEnabled: boolean;
}
```

例。

```json
{
  "id": "group_skill.apex",
  "displayNameJa": "ヌシの魂",
  "displayNameEn": "Apex Spirit",
  "sortOrder": 100,
  "isEnabled": true
}
```

制約はSeriesSkillMasterと同じ。登録17件のうち、巨戟アーティアに出現しない拳を極めし者は履歴参照用IDを維持して `isEnabled = false` とし、通常UIは有効16件だけを表示する。

---

## 11. LotteryMaster

RNG再現で使う抽選定義。表示用定義とは分離する。

`LotteryMaster` はRNG解析結果に応じて変更可能な暫定スキーマである。`internalValue`、`weight`、および現在の抽選単位は、実ゲーム仕様が確定するまで永続的なRNG契約とみなさない。本番RNGロジックをこの形式へ無理に合わせず、解析結果が異なる場合はRNG Engine Interfaceとともに見直す。

未確定期間はFixture用データとして使用してよいが、reference-verified、game-verified、unverifiedのレコードをmanifestのnotesまたは別の確認状態で区別する。`RNG_SPEC.md` の「未確定アルゴリズムを推測実装しない」という原則を優先する。

```ts
export interface LotteryMaster {
  id: string;
  lotteryKind:
    | "normal_artian_bonus"
    | "gogma_bonus"
    | "series_skill"
    | "group_skill";
  weaponTypeId: WeaponTypeId | null;
  rarity: NormalArtianRarity | null;
  resultType: "bonus" | "series_skill" | "group_skill";
  bonusTypeId: BonusTypeId | null;
  bonusRankId: BonusRankId | null;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  internalValue: number | string;
  weight: number;
  sortOrder: number;
  isEnabled: boolean;
}
```

例。

```json
{
  "id": "lottery.gogma_bonus.weapon.dual_blades.attack.ex",
  "lotteryKind": "gogma_bonus",
  "weaponTypeId": "weapon.dual_blades",
  "rarity": null,
  "resultType": "bonus",
  "bonusTypeId": "bonus_type.attack",
  "bonusRankId": "bonus_rank.ex",
  "seriesSkillId": null,
  "groupSkillId": null,
  "internalValue": 123,
  "weight": 10,
  "sortOrder": 1000,
  "isEnabled": true
}
```

制約。

- `resultType = "bonus"` の場合、`bonusTypeId` と `bonusRankId` は必須
- `resultType = "series_skill"` の場合、`seriesSkillId` は必須
- `resultType = "group_skill"` の場合、`groupSkillId` は必須
- `weight` は0以上の数値。0は一時的な無効化に使ってよいが、通常は `isEnabled = false` を使う
- 表示順やUI名はLotteryMasterから取らず、各Masterを参照する
- RNGロジックが必要とする内部値が未確定の場合は `internalValue` を暫定値にし、manifest notesに未検証と明記する
- 暫定LotteryMasterだけを根拠に本番RNGアルゴリズムの正しさを判定しない

---

## 12. MaterialMaster

```ts
export interface MaterialMaster {
  id: MaterialId;
  displayNameJa: string;
  displayNameEn: string;
  sortOrder: number;
  isEnabled: boolean;
}
```

初期版では素材の所持数管理はしない。

用途。

- 候補ごとの必要素材表示
- Plan全体の必要素材集計

---

## 13. MaterialCostMaster

操作ごとの必要素材を定義する。

```ts
export interface MaterialCostMaster {
  id: string;
  operationType:
    | "create_normal_artian"
    | "convert_normal_to_gogma"
    | "reset_bonuses"
    | "keep_bonuses"
    | "reset_skills";
  weaponTypeId: WeaponTypeId | null;
  materialId: MaterialId;
  quantity: number;
  isEnabled: boolean;
}
```

制約。

- `quantity` は1以上
- 武器種共通コストは `weaponTypeId = null`
- 武器種別コストがある場合は `weaponTypeId` を指定する
- 初期版では素材不足によるPlan不可判定は行わない

---

## 14. MasterDataRoot

読み込み後は以下の構造にまとめる。

```ts
export interface MasterDataRoot {
  manifest: MasterManifest;
  weaponTypes: WeaponTypeMaster[];
  elements: ElementMaster[];
  bonusTypes: BonusTypeMaster[];
  bonusRanks: BonusRankMaster[];
  weaponBonusDefinitions: WeaponBonusDefinition[];
  artianBonusTypeMappings: ArtianBonusTypeMapping[];
  seriesSkills: SeriesSkillMaster[];
  groupSkills: GroupSkillMaster[];
  lotteries: LotteryMaster[];
  materials: MaterialMaster[];
  materialCosts: MaterialCostMaster[];
}
```

実装方針。

- 起動時に静的importで読み込む
- 読み込み直後に `validateMasterData` を実行する
- validation errorがある場合はアプリを通常起動せず、エラー画面を表示する
- Web Workerへ渡す場合は必要なsubsetだけをstructured cloneで送る

---

## 15. Selector

実装すべき主要selector。

```ts
getEnabledWeaponTypes(master): WeaponTypeMaster[]
getEnabledElements(master): ElementMaster[]
getBonusDefinitionsForWeapon(master, weaponTypeId, elementId, scope): WeaponBonusDefinition[]
getRanksForBonusType(master, weaponTypeId, elementId, bonusTypeId, scope): BonusRankMaster[]
getGogmaBonusTypeForNormalBonus(master, normalBonusTypeId): BonusTypeId
getNormalBonusTypesForGogmaBonus(master, gogmaBonusTypeId): BonusTypeId[]
getBonusRankOrder(master, bonusRankId): number
isExRank(master, bonusRankId): boolean
getSeriesSkillOptions(master): SeriesSkillMaster[]
getGroupSkillOptions(master): GroupSkillMaster[]
getMaterialCosts(master, operationType, weaponTypeId): MaterialCostMaster[]
getLotteryEntries(master, lotteryKind, weaponTypeId, rarity): LotteryMaster[]
```

制約。

- selectorは純粋関数
- selectorはUIに依存しない
- Bonus Definition selectorはscope、武器種、属性を必須入力とし、ElementMasterの `allowsElementBonus` がfalseなら属性強化を除外する
- 無属性は `allowsElementBonus = false`、その他の現在有効な属性はtrueとする。実行時にElement ID文字列から意味を推測しない
- 存在しないIDを指定された場合は明示的なDomain Errorを返す

---

## 16. Validation

Master Data読み込み時に以下を検証する。

- すべてのIDが空文字ではない
- 各Master内でIDが一意
- 参照IDが存在する
- `sortOrder` が数値
- ElementMasterの `allowsElementBonus` がboolean
- `dataVersion` が正の整数
- WeaponBonusDefinitionの `scope + weaponTypeId + bonusTypeId + bonusRankId` が一意
- WeaponBonusDefinitionが参照するBonusTypeとBonusRankが有効
- `scope` が `normal_artian` または `gogma_artian`
- Mapping元が有効なnormal scope定義、Mapping先が有効なgogma scope定義で利用される
- 同一normalBonusTypeIdから複数のgogmaBonusTypeIdへ対応しない
- 複数normalBonusTypeIdから同一gogmaBonusTypeIdへの対応は許可する
- LotteryMasterのresultType別必須フィールドが正しい
- LotteryMasterのweightが0以上
- MaterialCostMasterのquantityが1以上
- `isEnabled = true` のLotteryが無効なMaster IDを参照していない

---

## 17. テスト観点

## 17.1 Master Validation Test

- 正常なfixtureがvalidationを通過する
- ID重複を検出する
- 存在しない参照IDを検出する
- 不正なLotteryMasterを検出する
- unverified Lottery fixtureをgame-verified Production dataとして読み込まない
- 不正なMaterialCostMasterを検出する
- 無効なBonusRank比較を検出する

## 17.2 Selector Test

- 武器種別に復元ボーナス候補を取得できる
- 存在しない武器種IDでエラーになる
- Rank順序比較が正しい
- EX判定が `isEx` を参照している
- 無効化されたMasterがUI候補から除外される

## 17.3 Integration Test

- TargetWeaponの入力候補がMaster Dataから生成できる
- OwnedWeapon登録時に武器種別の有効ボーナスだけを許可する
- Production RNG用Worker入力へ参照numeric Lottery表をDomain Masterとして渡さず、Engineがprovenance付きreference-verified tableからsemantic ID結果を返す。これは参照repositoryとの一致を表し、全実ゲーム条件でのgame-verifiedを意味しない
- MaterialCostMasterからPlan全体の必要素材を集計できる
