# モンハンワイルズ 巨戟アーティア厳選Planner
## RNG_SPEC.md

## 1. この文書の目的

この文書は、RNG Engine、Counter管理、観測結果からの検索、Gogma / Skill / 通常アーティアの進行、Web Worker境界、テスト観点を定義する。

ゲーム内部RNGの詳細が未確定の箇所は、推測で固定せず、差し替え可能なEngineとして実装する。

---

## 2. 基本方針

- RNG EngineはReactに依存しない
- RNG EngineはIndexedDBに直接依存しない
- RNG Engineは可能な限り純粋関数として実装する
- 重い検索はWeb Workerで実行する
- UIはSeed / Counterを通常表示しない
- Debug Mode ONの場合のみ内部値を表示する
- Production Identificationは外部Seed Finderのalgorithmまたは実装へ依存させない
- 外部ツール出力のImportは、出力テキストをparseして内部型へ変換するだけにする

Production RNG契約のprovenanceは次のとおりとする。

- Gogma-Artian-Roll-Planner `GARP.lua v0.9.4`: reference-verified Production RNGと単一武器Route behaviorの正式な外部Reference Implementation
- GogmaArtianPlanner: 同じProduction RNG primitives / semantic mappingsを用いるSeed / Counter Identificationを含め、複数Target、Inventory、Planner、Executionへ拡張する製品側実装
- 外部live-game fixture: 出典をfixture単位の観測evidenceとして記録する。出典toolはProduction RNG algorithmまたはIdentification implementationのauthorityではない

現在のprovenance構造は次のとおりとする。

```text
WiseHorror / Gogma Artian Roll Planner
GARP.lua v0.9.4
        ↓
Reference-verified Production RNG
        ↓
GogmaArtianPlanner-owned implementation
        ├─ Seed / Counter Identification
        ├─ Candidate Search
        ├─ Build List
        ├─ Planner
        └─ Guided Execution
```

正式な外部RNG Referenceは固定したGARP.luaとし、外部ソースコードをコピーして組み込まない。監査時点の参照file、function、commit、参照実装で確認済みの事項と未確認事項は [RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) に記録する。第三者が公開したlive-game observationをfixtureに保持する場合は、algorithm authorityと分離してfixture自身へ出典を記録する。

確認状態の用語を次のように固定する。

- `reference-verified` / 参照実装で確認済み: 監査commitの参照repositoryに存在する実装内容を確認済み。全weapon、attribute、game versionでの実ゲーム一致を保証しない
- `game-verified` / 実機確認済み: ユーザーの実機確認または同等の実ゲームfixtureで確認済み
- `unverified` / 未確認: 十分な参照根拠または実機根拠がない

文脈なしの `verified` をProduction correctnessの意味で使用しない。Masterの `.verified_*` は安定IDの一部であり、確認状態を意味しない。

---

## 3. RNG状態の構成

アプリが管理するRNG状態。

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate
- 通常アーティアの武器種別レア8 Counter

Domain Modelは `DATA_MODEL.md` の `RngState` と `NormalArtianCounter` を使用する。

Base Seed、Gogma Counter、Skill Counter、Counter Gateは `KnownValue<T>` として独立に確定・未確定を保持する。RngState全体の確定フラグは使用しない。

`RngState.counterGate` はlegacy/manual/import compatibility、将来のExport / Import round-trip、diagnostic / reference情報のために保持し、v1では削除またはmigrationしない。ただしpersisted exact GateはProduction Skill / Gogma Predictionのavailability、Candidate Search、Planner、Trace Replay、またはPrediction結果のauthorityに使用しない。通常ユーザー向けRNG SetupではCounter Gateを表示・編集せず、他項目の保存でもpersisted値をそのまま保持する（[UI_FLOW.md](./UI_FLOW.md) 5.2）。

予測前に、RngState、レア8通常Counter、必要なRouteOperation、現在の
`RngEngineCapabilities` を渡して `deriveRngCapabilities` を呼ぶ。
Capabilityは必要なKnownValueが確定済みであり、かつ現在のEngineが該当Predictionを
supportする場合だけ有効にする。値が揃っていてもEngine未対応ならfalseとし、
不足に依存するRouteだけをskipする。

Production Skill Predictionは確定Base Seed、確定Skill Counter、Skill Prediction support、concrete semantic input supportを要求する。Production Gogma Predictionは確定Base Seed、確定Gogma Counter、Gogma Prediction support、concrete semantic input / Master supportを要求する。いずれもconfirmed Counter Gateを要求しない。Normal Counterは新規Normal Artian生成にだけ要求し、Skill Prediction、Gogma-only route、所持Normalからのconversionへ波及させない。

---

## 4. Engine構成

推奨配置。

```text
src/domain/rng/
  rngTypes.ts
  rngEngine.ts
  gogmaRng.ts
  skillRng.ts
  normalArtianRng.ts
  observationSearch.ts
  importParsers.ts
  rngValidation.ts

src/workers/
  rngSearch.worker.ts
```

---

## 5. RNG Engine Interface

ゲーム側アルゴリズムの差し替えを可能にするため、Engineをinterface化する。

```ts
export interface RngEngine {
  readonly version: string;
  readonly capabilities: RngEngineCapabilities;
  getPredictionSupport(input: RngPredictionSupportInput): RngPredictionSupport;
  normalizeSeed(input: string): NormalizedSeed;
  predictGogmaBonus(input: GogmaBonusPredictionInput): RestorationBonusSet;
  predictSkills(input: SkillPredictionInput): SkillPredictionResult;
  predictNormalArtian(input: NormalArtianPredictionInput): RestorationBonusSet;
  advanceGogmaCounter(current: number, operation: GogmaOperation): number;
  advanceSkillCounter(current: number, operation: SkillOperation): number;
  advanceNormalCounter(current: number, operation: NormalArtianOperation): number;
}
```

```ts
export type NormalizedSeed = string;

export interface RngEngineCapabilities {
  supportsNormalArtianPrediction: boolean;
  supportsGogmaPrediction: boolean;
  supportsSkillPrediction: boolean;
  supportsKeepBonusesPrediction: boolean;
}

export type RngPredictionSupportInput =
  | {
      type: "normal_artian";
      weaponTypeId: WeaponTypeId;
      elementId: ElementId;
      rarity: NormalArtianRarity;
    }
  | {
      type: "skill";
      weaponTypeId: WeaponTypeId;
      elementId: ElementId;
    }
  | {
      type: "gogma_reset";
      weaponTypeId: WeaponTypeId;
      elementId: ElementId;
      master: RngMasterSubset;
    }
  | {
      type: "gogma_keep";
      weaponTypeId: WeaponTypeId;
      elementId: ElementId;
      currentBonuses: RestorationBonusSet;
      master: RngMasterSubset;
    };

export type RngPredictionUnsupportedReason =
  | "engine_capability_unavailable"
  | "normal_pool_unverified"
  | "reference_adapter_unsupported"
  | "master_data_unavailable"
  | "no_available_reset_candidates"
  | "unsupported_current_bonus";

export type RngPredictionSupport =
  | { supported: true }
  | { supported: false; reason: RngPredictionUnsupportedReason };
```

`RngEngineCapabilities` はPrediction operationのsupportだけを表す。Identification可否はRngEngine capability flagで表さず、Worker/application levelでSkill STEP 1とGogma Counter STEP 2を個別に表すconcrete availabilityとする。Identificationのために新しいRngEngine capability flagを追加しない。

Prediction可否は二段階で判定する。

```text
RngEngineCapabilitiesでoperation-level capabilityを確認
  ↓ capabilityあり
getPredictionSupport()で具体的なsemantic inputのcoverageを確認
  ↓ supported: true
predict*()
```

Capabilityがfalseならそのoperationは利用不可であり、具体的inputを予測可能とみなさない。
Capabilityがtrueでも `getPredictionSupport()` が `supported: false` を返したinputは予測しない。
`supported: false` は既知のunsupported inputだけを表す。support query自体の予期しない例外、
または `supported: true` 確認後のPrediction例外をunsupportedへ変換してはならない。

制約。

- 同じ入力に対して常に同じ結果を返す
- 入力オブジェクトを破壊的に変更しない
- 不正入力は例外ではなくDomain Errorを返してもよい
- `any` は使用しない

---

## 6. Prediction Input / Output

## 6.1 GogmaBonusPredictionInput

```ts
export interface GogmaBonusPredictionInput {
  baseSeed: NormalizedSeed;
  gogmaCounter: number;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  operation:
    | { type: "reset_bonuses" }
    | {
        type: "keep_bonuses";
        currentBonuses: RestorationBonusSet;
      };
  master: RngMasterSubset;
}
```

`predictGogmaBonus` の対象は `reset_bonuses` と `keep_bonuses` だけである。通常アーティアからの巨戟化は復元ボーナスを再抽選せず、Gogma Predictionを呼ばない。

Keep Bonusesにはユーザーが保持slotを選ぶ概念がない。入力した現在5slotのBonus familyをslotごとに保持し、各slotのtierだけを同じfamily内から再抽選する単一操作である。`currentBonuses` は現在のordered 5枠そのものであり、`normal_artian` / `gogma_artian` のどちらのscopeでもよい。Keep入力にscopeフィールドは持たせず、Engineは各slotの `bonusTypeId` だけからBonus familyを解決する。巨戟側Bonus Typeはそのfamilyを直接使い、通常側Bonus Typeは `ArtianBonusTypeMapping`（`RngMasterSubset.artianBonusTypeMappings`）で巨戟側Bonus Typeへ正規化してからfamilyを引く。`bonusRankId` はfamily解決に使わない。Engineはslot順を保持して抽選poolを構築する。Searchは同一Counter位置でselection branchを作らない。

`predictGogmaBonus` が返す `RestorationBonusSet` だけをamendment後の完成結果として使用する。Resetは入力武器が `normal_artian` / `gogma_artian` のどちらのscopeでも実行でき、結果を `gogma_artian` scopeへ置き換える。Keepも入力は `normal_artian` / `gogma_artian` のどちらのscopeでもよく、結果は常に `gogma_artian` scopeである。EngineがKeep仕様を未対応の場合、`supportsKeepBonusesPrediction = false` としてRouteを生成しない。

実ゲームでは巨戟化後の最初のBonus操作としてReset / Keepのどちらも選択できる。Production RNGは、current 5枠が既知であればそのscopeを問わずKeepを予測する。Keep可否の判定基準は「Normal Counterが既知か」ではなく「normal-scope current bonuses 5枠が既知か」である。

```text
Owned Normal                                  -> 5枠既知 -> conversion後 Reset / Keep可能
Owned Gogma / restorationBonusScope=normal_artian -> 5枠既知 -> conversion不要、Reset / Keep可能
New Normal + Normal Counterから5枠Prediction可能   -> 5枠既知 -> conversion後 Reset / Keep可能
New Normal + Normal Counter不明（blind、SEARCH_SPEC 6.1.1） -> 5枠未知 -> conversion後、最初はResetのみ
```

5枠が未知のblind Normalに対してだけKeepを予測できない。これはunknown入力の問題であり、prediction support不足でもゲームルールでもない。blind Normalへ架空の5枠を合成しない。

参照実装GARP.luaがbase-tier（normal-scope）状態で最初のamendmentをResetへ強制するのは、参照実装がnormal-scope current bonusesをPrediction入力として扱わないという実装上の制約であり、ゲーム上Resetしかできないという意味ではない。GogmaArtianPlannerはOwned Weapon、Normal Artian Prediction、Restoration Bonus Scope、ArtianBonusTypeMappingを保持するため、normal-scope current bonusesが既知なら直接Keep predictionを扱える。参照実装の制約とゲームルールを混同しない。

Keep familyへの正規化はBonus Typeの意味対応（ArtianBonusTypeMapping）だけを使い、family内の候補pool・weight・repeat penalty・tier draw algorithmは参照実装のGogma family tableをそのまま用いる。この正規化以外に通常tier専用のpool、weight、rank tableを推測しない。normal-scope current bonusesからのKeep結果はgame-verified fixtureをまだ持たない（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 20）。

### 6.1.1 Production Gogma Reset family availability / family上限 contract

本節は2026-09-15の実ゲーム検証（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.17）で確定したProduction Gogma Reset契約である。**本節はPR-Bで実装済みであり、現在のruntimeは `PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7` である。** 実装は `productionGogmaResetCandidatesForWeaponAndElement()`（family availability）、`buildProductionWeightedGogmaResetPool()`（`sharpness_capacity` family上限2 + exact-ID repeat penalty）、`predictProductionGogmaResetSlotsFromRawValues()` / `predictProductionGogmaReset()`（Production Reset draw）である。`production-rng:c5-e6` までのruntimeは `getBonusDefinitionsForWeapon(master, weaponTypeId, elementId, 'gogma_artian')` のMaster availabilityで `REFERENCE_GOGMA_RESET_CANDIDATES` をfilterし、weighted drawはexact-ID repeat penaltyだけを使っていた。その旧runtimeは、Bow / 毒、Switch Axe / `element.none`、および `sharpness_capacity` familyが2枠に達した後のslotで実ゲームと一致しないことが直接実測で確認された。

**Reference behaviorとProduction behaviorの分離**

| 区分 | authority | candidate | weighted draw |
|---|---|---|---|
| Reference behavior（GARP v0.9.4 parity） | `REFERENCE_GOGMA_RESET_CANDIDATES`、`buildReferenceWeightedGogmaPool`、`predictReferenceGogmaReset`、reference golden / reference tests | 固定10候補。weapon / elementで除外しない | `weight = max(0, 100 - exactIdOccurrenceCount * repeatPenalty)` のみ |
| Production contract（直接実機観測とcategory-level Production adoptionが混在。区別は下記8） | Production Gogma Reset（`gameGogmaBonuses.ts` / `gogmaPrediction.ts` のProduction関数、PR-Bで実装済み） | 固定reference候補順のまま、下記1のfamily availabilityでfilter | exact-ID repeat penalty + 下記2の `sharpness_capacity` family上限2 |

Reference behaviorはreference parity契約であり、ゲーム実測に合わせてreference候補表、reference weighted draw、reference golden / testsを書き換えてはならない。下記のfamily availability連携と `sharpness_capacity` family上限2はProduction固有の補正であり、reference層へ入れてはならない。

**1. family availability**

Production Gogma Resetで候補となるbonus familyの集合は、同じ `weaponTypeId` + `elementId` に対してProduction Normal Artian lotteryが使用するcandidate pool（6.3.1。`gameVerifiedNormalCandidatesForWeaponAndElement()` と同じ分類authority）の**family集合**とする。

```text
Production Normal pool（weaponTypeId + elementId、6.3.1）
  ↓ familyだけ抽出（Normal lottery ID 6 -> attack / 4 -> element / 7 -> sharpness_capacity / 8 -> affinity）
{attack, affinity, element, sharpness_capacity} の部分集合
  ↓ 固定reference Reset候補順のままGogma rank候補へ展開
attack             -> Attack II / III / EX          (reference ID 8, 12, 15)
affinity           -> Affinity II / III / EX        (reference ID 9, 13, 16)
element            -> Element II / EX               (reference ID 11, 14)
sharpness_capacity -> Sharpness/Capacity base / EX  (reference ID 6, 10)
  ↓ Gogma固有の抽選
Gogma seed / Gogma Counter / 10-step block / candidate order / exact-ID repeat penalty / sharpness_capacity family上限2
```

- 共有するのはfamily availabilityだけである。Normal側のseed、Normal Counter、`maximumOccurrences` はGogmaへ共有しない。Normal Attack 5 / Element 4 / family 7 2 / Affinity 3を、Gogma Resetの上限として流用してはならない
- `WeaponBonusDefinition` + `ElementMaster.allowsElementBonus`（`getBonusDefinitionsForWeapon()`）をProduction Gogma Reset family availabilityのauthorityにしない（下記5）
- candidate順は固定reference順 `[8, 12, 15, 9, 13, 16, 11, 14, 6, 10]` からfamily外の候補を除いた部分列とする。並べ替え、ID置換、retryは行わない（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 10.4と同じpre-draw filter mechanism）
- Bow: Normal Table A / B分類（6.3.1）をそのまま使う。Table A（火 / 水 / 雷 / 氷 / 龍 / 爆破）= Attack / Element / Affinity、Table B（無属性 / 毒 / 麻痺 / 睡眠）= Attack / Affinity
- Switch Axe: パーツ構成によらないsingle pool = Attack / Element / Sharpness / Affinity。`element.none` でもElement familyを含む
- Melee共通10種: Table A（属性あり）= Attack / Element / Sharpness / Affinity、Table B（無属性）= Attack / Sharpness / Affinity
- Light / Heavy Bowgun: 両table = Attack / Capacity（`sharpness_capacity`）/ Affinity
- Production Normal poolを持たないweapon / element（`normal_pool_unverified` 等）に対して、Gogma Reset family availabilityを推測で補わない。現時点では14武器種すべてがProduction Normal poolを持つ

**2. family上限**

- `sharpness_capacity` family: 同じReset結果内でreference ID 6と10の合計選択数が2に達した後のslotでは、familyの全candidate（ID 6とID 10の両方）をweighted poolから除外する。これはexact-ID repeat penaltyによるweight計算に加えて適用する
- Attack / Affinity / Elementには明示family上限を新設しない。「Attack = 5 / Affinity = 5 / Element = 5」のような明示family limitを追加してはならない
  - Affinity: Gogma Resetで4枠 / 5枠が直接実測されている
  - Element: candidateがII / EXの2 IDだけであり、exact-ID repeat penaltyにより各IDは2個でweight 0になるため、family上限なしで実効最大4（II×2 + EX×2、直接実測済み）
  - Attack: Reset結果は5 slotしかないため、追加family limitを設けない
- Normal Artianの `maximumOccurrences`（特にAffinity 3）をGogma Resetのfamily上限に使ってはならない

**3. exact-ID repeat penalty（維持）**

同じreference IDの既選択数 `n` に対して `weight = max(0, 100 - n * repeatPenalty(id))` とする。Gogmaの非EX candidateは100 → 50 → 0、EX candidateは100 → 20 → 0であり（`normal_artian` scopeの通常tierとは無関係）、数える単位はfamilyではなくexact reference IDである。Reset / Keepの双方で使用する。

**4. Keep（変更しない）**

Keep契約（6.1本文、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 11）は変更しない。現在5slotそれぞれのfamilyとslot位置を保持し、family内でtierだけを再抽選し、exact-ID repeat penaltyを使う。Keepへfamily availability filterも `sharpness_capacity` family上限2も追加しない。Dual Blades / 龍でcurrent family layout Element / Element / Element / Element / SharpnessをGogma Counter 55..59で5回連続Keepした結果は、現行Keep weighted modelと5件完全一致した（各結果のElementはII×2 + EX×2）。

- current layoutに `sharpness_capacity` familyを3枠以上持つKeepの実ゲーム結果は未確認である。そのKeepをunsupportedにする、family上限2をKeepへ強制する、等の新しい契約を追加しない

**5. Master availabilityとの関係**

`ElementMaster.allowsElementBonus` および現在のMaster availability（`getBonusDefinitionsForWeapon()`）は、Production lottery family availabilityを表現できない。

- Bow / 毒: `allowsElementBonus = true` だが、Production Gogma ResetはElementを抽選しない（直接実測）
- Switch Axe / `element.none`: `allowsElementBonus = false` だが、Production Gogma ResetはElementを抽選する（直接実測）

したがって `allowsElementBonus` と現在のMaster availabilityをProduction lottery family authorityとして扱わない。Production上で利用可能なBonusDefinitionは、Masterのweapon type / scope定義とProduction family availabilityの積として決める方針とする。PR-A / PR-B / PR-Cのいずれでも `getBonusDefinitionsForWeapon()` の意味、Master JSON、`allowsElementBonus`、Master dataVersionを変更しない。PR-Cで、Master層がProduction RNG層へ依存しない依存方向を保った複合availability selector（`src/domain/artian/productionBonusAvailability.ts`、[MASTER_DATA.md](./MASTER_DATA.md) 15.1）を実装し、Owned Weapon editor、Target editor、Target compromise editor、Entity validation、Gogma Counter Identification Wizard STEP 2、new entity draftをconsumerとした。`getBonusDefinitionsForWeapon()` はMaster-only semanticsのまま残す。このavailabilityはUI / Entityの選択可否であり、Keep predictionの入力制約ではない（上記4）。availability外の保存済みbonusはnon-destructive load + fail-closed saveで扱う（[DATA_MODEL.md](./DATA_MODEL.md) 7.1）。

**6. Gogma Counter Identification**

Gogma Counter Identification（9.8）はProduction Resetと同じcandidate availabilityと同じProduction weighted draw semanticsを使う。PR-Bで、Identification kernelはProduction Resetと同じ `productionGogmaResetCandidatesForWeaponAndElement()` と `predictProductionGogmaResetSlotsFromRawValues()` を共有するよう移行した。Identification専用の別candidate tableもMaster availability pathも持たない。

**7. version**

- current implementation: `PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e7`（本節は実装済み）
- 本節のfamily availabilityと `sharpness_capacity` family上限2はGogma Reset Prediction outputを変えるobservable Production RNG semantics changeであるため、PR-B実装時に `production-rng:c5-e6` から `production-rng:c5-e7` へ更新した。旧BuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` になる
- 仕様確定（PR-A）はsrcを変更しなかったため当時は `production-rng:c5-e6` のままだった。PR-A / PR-Bのいずれでも `CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、`ExportRoot.schemaVersion`、`RngState.schemaVersion`、PRNG、seed derivation、10-step block、Counter semanticsは変更していない。PR-BでもMaster JSON / `allowsElementBonus` / Master dataVersion / `getBonusDefinitionsForWeapon()` の意味、reference parity（候補表、`buildReferenceWeightedGogmaPool`、`predictReferenceGogmaReset`、reference golden / tests）、Keepアルゴリズム、Search / Planner algorithmは変更していない。UI / Validationへの反映はPR-Cで実装済みであり、PR-CはPrediction outputを変えないため `production-rng:c5-e7` のままである

**8. provenance**

- directly game-verified（2026-09-15、Base Seed 51231782、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.17）: Bow / 毒のReset（Counter 55 / 179）でElement familyが候補にないこと、Switch Axe / `element.none` のReset（Counter 55）でElement familyが候補にあること、Hammer / 麻痺のReset Counter 104で `sharpness_capacity` family合計上限2（primary evidence。Counter 94は補助観測であり、契約はCounter 94に依存しない）、Hammer / 麻痺 Counter 160のAffinity 4枠とBow / 毒 Counter 179のAffinity 5枠、Lance / 龍 Counter 197のElement II×2 + EX×2、Dual Blades / 龍 Counter 55..59の連続Keep。既存fixture（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 10.4の5条件、14.5のHammer / 麻痺 Counter 55..60）も本節のmodelと全slot一致する
- category-level Production adoption: Bow / 麻痺・睡眠のGogma Reset family availability（Gogma側の直接実測ではなく、Normal Table B分類をProduction契約として適用）、その他直接観測していないweapon type / elementへのNormal pool family集合の適用、Hammer / 麻痺以外（Capacityを持つLBG / HBGを含む）への `sharpness_capacity` family上限2の適用。「全weapon / 全elementでGogma Reset availabilityを実機検証した」と記述してはならない

## 6.2 SkillPredictionInput

```ts
export interface SkillPredictionInput {
  baseSeed: NormalizedSeed;
  skillCounter: number;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  master: RngMasterSubset;
}

export interface SkillPredictionResult {
  seriesSkillId: SeriesSkillId;
  groupSkillId: GroupSkillId;
}
```

上記はProduction Domain adapterのsemantic input契約である。Counter Gateはcaller-supplied Domain inputではなく、Production v1 adapterがoperation別active representativeを内部供給する。Core / reference predictorは低Gate branchの検証用にGate入力を保持してよいが、その内部inputをSearch、Planner、Worker message、またはpersisted RngState requirementとして公開しない。

Production Skill PredictionはSeries / Groupを必ず1件ずつ返す。conversion直後の初回付与もReset Skills結果も同じ完全な結果型を使い、`null / null` を予測結果として生成しない。

## 6.3 NormalArtianPredictionInput

```ts
export interface NormalArtianPredictionInput {
  baseSeed: NormalizedSeed;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  rarity: NormalArtianRarity;
  normalCounter: number;
  master: RngMasterSubset;
}
```

v1のDomain `rarity` は必ず8であり、レア6・7のPrediction、Counter、Lotteryは扱わない。Production adapterは表示／Domain rarity 8を参照アルゴリズムの内部rarity値7へ明示変換する。`WeaponTypeId`、`ElementId`もProduction adapter内のreference-verified mappingでnumeric encodingへ変換し、Master配列indexやDomain IDの並びを暗黙利用しない。参照numeric値や `attributeForce` を `engineParameters` 等でDomainへ漏らさない。

### 6.3.1 Production game-verified Normal pool current contract

Production `predictNormalArtian` は、reference-verified PRNG・seed derivation・10-step block・pool step（`selectReferenceNormalLotteryIdsFromRawValues()`）をそのまま使い、candidate poolだけをgame-verified pool（`gameVerifiedNormalCandidatesForWeaponAndElement()`）へ置き換える。各candidateは `maximumOccurrences` に達した時点でpoolから除外される。

このProduction Normal poolの**family集合**は、Production Gogma Resetのfamily availability authorityとしても使う（6.1.1、PR-Bで実装済み）。ただし共有するのはfamily集合だけであり、本節のseed、Normal Counter、`maximumOccurrences` はGogma Resetへ流用しない。

Production poolのcandidate別上限（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 5.3 / 14.13）。

| candidate | reference lottery ID | 上限 | provenance |
|---|---:|---:|---|
| 基礎攻撃力強化（Attack） | 6 | 5 | 属性ありMelee 1293個体で直接game-verified |
| 属性強化（Element） | 4 | 4 | 属性ありMelee 1293個体で直接game-verified（Bowへの適用は下記） |
| 斬れ味強化（family 7） | 7 | 2 | 属性ありMelee 1293個体で直接game-verified |
| 装填数強化（family 7） | 7 | 2 | 直接境界観測なし。Game8上限表 + 既存LBG / HBG fixtureとの無矛盾 |
| 会心率強化（Affinity） | 8 | 3 | 属性ありMelee 1293個体で直接game-verified（Bow / Bowgun / none poolへの適用は下記） |

provenanceは一様ではない。2026-09-14の1293個体 / 6465 slots（Great Sword / Dual Blades / Hammer / Charge Blade、すべて属性あり）で保存画像まで直接確認しgame-verifiedしたのはAttack 5 / Element 4 / Sharpness 2 / Affinity 3である。次はその1293個体による直接境界観測ではなく、ユーザー提示のGame8上限情報と、既存game-observed fixture（Bow 属性あり / none、LBG Fire / none、HBG Fire / none、Long Sword Fire / none）が新上限と矛盾しないことを根拠にProduction contractとして採用している。

- Capacity 2（LBG / HBG）
- BowへのElement 4 / Affinity 3上限の適用
- LBG / HBGへのAffinity 3上限の適用
- none poolへのAffinity 3上限の適用

「1293個体 / 6465 slotsでCapacityを含む全Production上限を直接game-verifiedした」と記述してはならない。

**Lottery table class（pool選択の正式Domain概念）**

Normal seedはBase Seed + 武器種 + rarityだけで決まり、属性はseedへ入らない。属性が決めるのは「同じCounter Cに対してどのcandidate poolを使うか」だけであり、その区分を `NormalArtianLotteryTableClass = 'table_a' | 'table_b'`（`src/domain/rng/normalArtianLotteryTable.ts`）として正式化する。exact `ElementId` からtable classへの分類は `normalArtianLotteryTableClassForWeaponAndElement(weaponTypeId, elementId)`、table classからProduction poolへの選択は `gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, tableClass)` が担い、既存 `gameVerifiedNormalCandidatesForWeaponAndElement()` は両者へdelegateする。旧 `NormalArtianAttributeClass = 'none' | 'attribute_present'` は「Normal lottery全体の正式区分」ではなかった（Bowで誤る）ため廃止した。

| Weapon | Table A | Table B |
|---|---|---|
| Bow | 火 / 水 / 雷 / 氷 / 龍 / 爆破 | 無属性 / 毒 / 麻痺 / 睡眠 |
| Melee共通（Switch Axe除く） | 属性あり（毒 / 麻痺 / 睡眠 / 爆破を含む） | 無属性 |
| Light / Heavy Bowgun | 属性あり | 無属性（両tableのpoolは同一） |
| Switch Axe | 属性あり | 無属性（両tableのpoolは同一。ゲーム上はパーツ構成非依存のsingle table） |

Table A / BはCounter streamではない。Bowで火（Table A）をCounter Cで作成し、次に毒（Table B）を作成すればC+1を消費する同一streamであり、`weapon.bow:8` のCounterは1本だけである。table classを `NormalArtianCounter.id`、persisted shape、`normalArtianCounterId()`、DB schemaへ入れてはならず、Table A Counter / Table B Counterの2本へ分けてはならない。Melee / Bowgun / Switch AxeにBowのTable A / B分類を適用してはならない。Switch Axeの `table_a` / `table_b` はIdentification / UIのobservation adapterとしての2値であり、「Switch Axeにはゲーム上別々のTable A / Bがある」という意味ではない（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）。

Production supported武器種とpool構成（Melee support拡張後、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.14 / Bow Table A / B修正後、14.15 / Switch Axe Production activation後、14.16）。

| Weapon | Table A | Table B | provenance |
|---|---|---|---|
| Bow | `[6, 4, 8]` | `[6, 8]` | 下記のとおり二層（14.15） |
| Light Bowgun | `[6, 7, 8]` | `[6, 7, 8]` | directly game-verified（C4-C fixture） |
| Heavy Bowgun | `[6, 7, 8]` | `[6, 7, 8]` | directly game-verified（C4-C fixture） |
| Melee共通: Great Sword / Sword and Shield / Dual Blades / Long Sword / Hammer / Hunting Horn / Lance / Gunlance / Charge Blade / Insect Glaive | `[6, 4, 7, 8]` | `[6, 7, 8]` | 下記のとおり二層 |
| Switch Axe（独立contract） | `[6, 4, 7, 8]` | `[6, 4, 7, 8]` | 下記のとおり二層（14.16） |

Switch Axeの行は「ゲーム上2つのtableがある」という意味ではない。Switch Axeのゲーム側抽選はパーツ構成に依存しないsingle pool `[6, 4, 7, 8]` であり、Identification Domainの `table_a` / `table_b` 双方からその1つのpoolを参照するadapter表現である（LBG / HBGで両tableが同じpoolを返すのと同じ構造）。Production定数は `GAME_VERIFIED_SWITCH_AXE_NORMAL_CANDIDATES` であり、Melee共通10種の `PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS` / `GAME_VERIFIED_MELEE_ELEMENTAL_NORMAL_CANDIDATES` とは別contractである。pool配列の値がMelee Table Aと一致することはcategory semanticsの一致ではない（Melee Table Bは `[6, 7, 8]`、Switch Axeは無属性でも `[6, 4, 7, 8]`）。Normal seed（Base Seed + 武器種 + rarity）とCounter semanticsは不変である。

Bow Table A / Bのprovenanceは二層であり、「Bowの全属性を実機検証した」と記述してはならない（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.15）。

- directly game-verified: 火（Counter 0..2の既存fixtureと、再確認したCounter 0 / 1）、爆破（Counter 0、`[6, 6, 8, 4, 4]` で火と完全一致 → Table A）、毒 / 麻痺 / 睡眠（Counter 0、`[8, 8, 6, 6, 8]` で無属性と完全一致 → Table B）、無属性（Counter 0..2の既存fixture）。いずれもBase Seed 51231782
- category-level Production adoption: 水 / 雷 / 氷 / 龍のTable A分類。根拠はユーザー提示のGame8分類（<https://game8.jp/mhwilds/673616>）、火と爆破がTable Aである直接fixture、従来Productionが五属性を同一elemental poolとして扱っていたことを反証するevidenceがないことである

Melee共通poolのprovenanceは二層であり、混同して記述してはならない。

- directly game-verified: Long Sword（属性あり / none各15 slotsの既存fixture）と、Great Sword / Dual Blades / Hammer / Charge Bladeの属性ありpool（2026-09-14、Base Seed 51231782、1293個体 / 6465 slotsを保存画像authorityで確認し `[6, 4, 7, 8]` / Attack 5 / Element 4 / Sharpness 2 / Affinity 3と完全一致）
- category-level Production adoption: Sword and Shield / Hunting Horn / Lance / Gunlance / Insect Glaiveの両pool、およびGreat Sword / Dual Blades / Hammer / Charge Bladeのnone pool。直接大量検証はしておらず、(1) Long Swordを含む5種類の独立したMelee weapon streamで共通規則が成立すること、(2) ユーザー提示のGame8通常アーティアTable情報でSwitch Axeだけが別カテゴリとされ、その他の近接武器が共通条件として扱われていること、(3) none poolが既存Long Sword none fixtureと整合すること、(4) PRNG / seed derivation / weaponType streamは全武器共通でweaponType numeric値だけがseedを分離すること、というcategory-level evidenceを根拠にProduction contractとして採用している

Melee membershipは `PRODUCTION_MELEE_NORMAL_POOL_WEAPON_TYPE_IDS` の明示allow-listだけが決め、unknown WeaponTypeIdを暗黙にMelee扱いしない。Switch AxeはGame8上で他の近接とTable条件が異なり（パーツ構成によらず同一Table）、Melee support拡張の時点では使用candidate pool、属性の扱い、`NormalArtianLotteryTableClass` / pool対応を実ゲームfixtureで確認していなかったため、推測でMelee poolへ入れずunsupportedとしていた。その後のSwitch Axe実機検証（下記、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）で独立したsingle pool contractとしてProduction supportedへ昇格したが、Melee allow-listには引き続き入れない。Table A / BのDomain modelとBowの属性分類はMelee support拡張の対象外であり、その後のBow Table A / B修正（上記、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.15）で導入した。

Switch Axe single poolのprovenanceは二層であり、混同して記述してはならない（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16、2026-09-15、Base Seed 51231782）。

- directly game-verified: pool membership `[6, 4, 7, 8]`、パーツ構成（火属性構成 / 全部別々の属性パーツ構成 = Domainの `element.none`）に依存しないこと、Counter 0 → 1の連続stream。同じsaveからCounter 0で火構成 `[7, 7, 8, 6, 4]`、同じsaveからCounter 0で全部別々構成 `[7, 7, 8, 6, 4]`（完全一致）、同じsaveからreloadなしで火C0 `[7, 7, 8, 6, 4]` → 全部別々C1 `[8, 6, 4, 4, 6]` を直接観測し、既存PRNG / seed derivation / 10-step blockのC0 / C1とslot順を含め完全一致した。Melee Table B pool `[6, 7, 8]` では無属性構成のElementを抽選できないため、この観測はMelee分類を直接反証する
- category-level Production adoption: Attack 5 / Element 4 / Sharpness 2 / Affinity 3の `maximumOccurrences` 境界。Switch Axeで境界そのものを大量観測してはおらず、14.13のMelee 1293個体 / 6465 slots直接検証、ユーザー提示のGame8上限表、今回のSwitch Axe観測がこれらを一切反証しないことを根拠に採用する。「Switch AxeでAttack 5 / Element 4 / Sharpness 2 / Affinity 3の境界を直接game-verifiedした」と記述してはならない

pinned reference implementation（`REFERENCE_NORMAL_NONE_CANDIDATES` / `REFERENCE_NORMAL_ELEMENTAL_CANDIDATES`、`predictReferenceNormalRaw()`）はElement 5 / Affinity 5のままであり、これはreference parity契約として変更しない。Element 5 / Affinity 5は「実ゲーム仕様」ではなく「pinned reference implementationの挙動」である。reference parity poolとgame-verified Production poolは別物として維持し、混同しない。`ReferenceNormalCandidate.maximumOccurrences` の型は `2 | 3 | 4 | 5` である。

この上限修正はProduction Normal prediction結果を変えるobservable RNG semantics changeであり、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e3` へ更新した。旧versionで生成されたBuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` になる。`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、Base Seed derivation、weaponType numeric mapping、block size 10、PRNG、Counter semanticsは変更していない。上限修正の時点ではProduction support対象武器種も変更していない。

その後のMelee support拡張（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.14）で、Production Normal support対象武器種をLong Sword単独からSwitch Axeを除く近接10武器種へ拡張した。以前unsupportedだったNormal Prediction inputがsupportedになり、Candidate SearchのRoute availabilityとCounter Identification supportが変わるため、これもobservable Production RNG semantics changeとして `PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e3` から当時の `production-rng:c5-e4` へ更新した。`rngEngineVersion` の差だけがCalculationContextの失効境界であり、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、reference parity pool、reference golden、PRNG、seed derivation、10-step block、candidate `maximumOccurrences`、Normal Counter semantics、persistence schema、当時の `NormalArtianAttributeClass` は変更していない。

さらにその後のBow Table A / B修正（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.15）で、Bowの毒 / 麻痺 / 睡眠をTable B pool `[6, 8]` へ、爆破をTable A pool `[6, 4, 8]` へ分類した。Bow毒 / 麻痺 / 睡眠のProduction Normal prediction outputが変わるobservable Production RNG semantics changeとして、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e4` から当時の `production-rng:c5-e5` へ更新した。旧versionのBuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` になる。`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、`ExportRoot.schemaVersion`、reference parity pool（`REFERENCE_NORMAL_ELEMENTAL_CANDIDATES` / `REFERENCE_NORMAL_NONE_CANDIDATES`、`predictReferenceNormalRaw()`、reference golden。referenceのnone / non-none分類はreference parity契約としてそのまま残す）、PRNG、seed derivation（ElementIdはNormal seedへ追加しない）、10-step block、candidate `maximumOccurrences`、Counter increment semantics、`NormalArtianCounter` ID / persisted shape、Melee / Bowgunの既存pool、当時のSwitch Axeのunsupportedは変更していない。

その後のSwitch Axe Normal Production activation（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）で、Switch Axeを独立したsingle pool `[6, 4, 7, 8]` のProduction contractとしてsupportedにした。以前unsupportedだったSwitch AxeのNormal Prediction inputがsupportedになり、Candidate SearchのRoute availabilityとCounter Identification supportが変わるobservable Production RNG semantics changeとして、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e5` から当時の `production-rng:c5-e6` へ更新した（その後、6.1.1のGogma Reset family availability / `sharpness_capacity` family上限2の実装で現在の `production-rng:c5-e7` へ更新した。Normal poolとNormal Prediction outputはその更新で変わっていない）。旧versionのBuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` になる。`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、`ExportRoot.schemaVersion`、reference parity pool（referenceのnone / non-none分類はSwitch Axeでもreference parity契約としてそのまま残す）、PRNG、seed derivation、10-step block、candidate `maximumOccurrences`、Counter increment semantics、`NormalArtianCounter` ID / persisted shape、Bow Table A / B分類、Melee 10種の分類、LBG / HBG pool、Skill RNG、Gogma RNG、Search algorithm、Planner algorithmは変更していない。結果としてv1のrarity-8 Normal Prediction / Counter Identificationは14武器種すべてをカバーするが、verification provenanceは一様ではなく、Bow / LBG / HBG / Melee共通10種 / Switch Axe独立という構造を保つ。

## 6.4 RngMasterSubset

Web Workerへ渡すRNG用の最小マスター。

```ts
export interface RngMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[];
  bonusRanks: BonusRankMaster[];
  elements?: ElementMaster[];
  bonusTypes?: BonusTypeMaster[];
  weaponTypes?: WeaponTypeMaster[];
  artianBonusTypeMappings?: ArtianBonusTypeMapping[];
}
```

`elements`、`bonusTypes`、`weaponTypes` は共通interfaceではoptionalである。Production Gogma Resetのcandidate availabilityは6.1.1のProduction Normal pool family集合で決まり、caller supplied Masterを読まない（`production-rng:c5-e7`）。したがってResetのinput supportはこれらのMasterの有無で `master_data_unavailable` にならない。`production-rng:c5-e6` までのruntimeではMaster availability filterの入力要件としてこれらが必要だった。Search / Plannerが従来どおりこれらを含むMaster subsetを渡すことは妨げない。`artianBonusTypeMappings` も共通interfaceではoptionalだが、Production Keepのfamily解決ではcaller supplied Masterに存在する必要がある。不足時は `gogma_keep` のinput supportが `master_data_unavailable` となる。Search / Plannerのsubset（`SearchMasterSubset` / `PlannerMasterSubset`）ではrequiredとし、validated Master rootから渡す。空配列やfake mappingを本番経路へ入れない。`weaponBonusDefinitions` とこれらのMasterを同じvalidated Master rootから渡し、predictor内部で別Masterを読み込まない。

`RngMasterSubset` は `LotteryMaster` を持たない。`MasterDataRoot.lotteries` はprovisional / legacy Master structureとしてrootに残るが、RNG Predictionのinput、input support、capability判定のいずれにも渡さない。Production RNGのseed式、pool order、weight、repeat penalty、skill order、semantic ID↔reference numeric mappingは、provenance付きRNG-specific reference-verified tableとEngine内部定数の責務であり、Production Predictionは `LotteryMaster` に依存しない。現行disabled `LotteryMaster` を有効化したり、Production Predictionの前提にしたりしない。reference-verified tableは参照repositoryとの一致を表し、それだけで全実ゲーム条件のgame-verifiedを意味しない。

Normal Artian Predictionが扱う復元ボーナス定義は `normal_artian` scope、Gogma Predictionが返すamendment後の復元ボーナスは `gogma_artian` scopeである。通常→巨戟化時はNormal Predictionまたは所持Normalの `normal_artian` scope 5枠をslot順のまま継承し、通常→巨戟Bonus Type MappingからRank・抽選結果・完成5枠を生成しない。Mappingは、Keep predictionでnormal-scope current slotの通常側Bonus Typeを巨戟側Bonus Type（Keep family）へ正規化するためにだけ使う。

---

## 7. Counter進行

## 7.1 GogmaOperation

```ts
export type GogmaOperation =
  | { type: "reset_bonuses" }
  | { type: "keep_bonuses" };
```

Reset BonusesとKeep BonusesはそれぞれDomain Gogma Counterを1進める。通常→巨戟化はGogma streamを消費しない。

Reset Bonusesは抽選を実行した時点でGogma Counterを1消費し、その後に抽選結果を武器へ反映するか破棄するかは、そのCounter進行を変更または巻き戻さない。この範囲は2026-09-13のgame-verified observationで確認済みである。save / autosave / reloadの挙動はこの確認範囲に含めず、推測しない。

実装上は以下の関数で一元管理する。

```ts
getGogmaCounterDelta(operation: GogmaOperation): number
```

## 7.2 SkillOperation

```ts
export type SkillOperation =
  | { type: "convert_normal_to_gogma" }
  | { type: "reset_skills" };
```

通常→巨戟化とReset SkillsはそれぞれDomain Skill Counterを1進める。巨戟化は1つのゲーム操作であり、別の `assign_skills` RouteOperationへ分割しない。変換時の `predictSkills` 結果を初回Series Skill / Group Skillとして付与する。

## 7.3 NormalArtianOperation

```ts
export type NormalArtianOperation =
  | { type: "create_normal_artian"; count: number };
```

制約。

- `count` は1以上
- 初期版では複数操作をまとめてUI実行しないが、検索内部では距離計算のため `count` を使ってよい

NormalArtianCounterは「次にforgeされる結果の0-based block index」である。候補位置とforge数は次の数式で扱う。

```text
candidateOffset = 0:
  candidateCounter = normalCounterBefore
  forgeCount = 1

candidateOffset = k:
  candidateCounter = normalCounterBefore + k
  forgeCount = k + 1

CreateNormalArtianOperation.count = forgeCount
normalCounterAfter = normalCounterBefore + forgeCount
candidateCounter = normalCounterBefore + forgeCount - 1
```

stream進行は次を正式契約とする。Statusは確認根拠の範囲であり、正式契約として採用するかどうかとは別である。

| Operation | Normal | Skill | Gogma | Status |
| --- | ---: | ---: | ---: | --- |
| create normal | +1 / forge | 0 | 0 | reference-verified |
| convert normal to Gogma | 0 | +1 | 0 | game-verified |
| reset skills | 0 | +1 | 0 | reference-verified |
| reset bonuses | 0 | 0 | +1 | reference-verified |
| keep bonuses | 0 | 0 | +1 | reference-verified |

Domain Counterの `+1` は1回のforgeが次の予測位置へ進む意味であり、参照PRNG内部の1 blockあたり10 stepと混同しない。`candidateOffset = k` の通常候補を採用する場合、合計進行はNormal `+(k + 1)`、Skill `+1`、Gogma `+0` である。先行するk本は巨戟化せず、候補である最後の1本だけを巨戟化する。

Core / reference semanticsではCounter Gateは予測時のeffective PRNG blockだけに作用する。

```text
Skill Gate < 54 -> effective Skill block = 0
otherwise       -> effective Skill block = Domain Skill Counter

Gogma Gate < 35 -> effective Gogma block = 0
otherwise       -> effective Gogma block = Domain Gogma Counter
```

Domain Counterはアプリが保持するゲーム状態、effective PRNG blockは予測時にseed streamへ適用するoffsetであり、別概念である。Gate未満でゲーム内部に保存されたCounter自体が操作後にどう変化するかは未確認のため、`advance*Counter` 契約や永続Counterをeffective blockへ置き換えてはならない。Normal streamにはCounter Gateを適用しない。

Production v1は通常アーティアおよび巨戟アーティアを利用可能なゲーム進行状態を対象とし、runtime adapterはactive branchを選択する。Skill operationでは54、Gogma operationでは35を内部representativeとしてCoreへ渡す。54 / 35はactual game Counter Gate値ではなく、ユーザー入力、Identification結果、または永続値として扱わない。persisted Gateが200、54、またはnullのいずれでも、他の必要入力とsupportが同じなら同じProduction active Predictionを行う。低Gate branch自体はCore / reference contractとfixture検証のために削除しない。

---

## 8. 手動入力仕様

## 8.1 Manual Input

ユーザーが正確に判明している値だけを直接入力する。通常ユーザー向けの入力対象はBase Seed、Gogma Counter、Skill Counterの3項目であり、3項目をすべて入力する必要はない。

制約。

- `baseSeed` は `normalizeSeed` で正規化して保存
- manual Base SeedはProduction runtime authorityの`ProductionRngEngine.normalizeSeed()`を保存直前に使用し、10進/16進rawを`mod 100000000`したcanonical 10進文字列として`KnownValue<string>.value`へ保存する
- 空文字は未入力として既存KnownValueを保持する。空白のみ、NaN相当、不正hex、unsigned 64-bit範囲外は`normalizeSeed()`のerrorとして保存しない
- Counterは0以上の整数のみ
- 入力した各KnownValueの `source` を `"manual"` とする
- 空欄項目を既存値から削除する操作は、明示的な「確定解除」として別に扱う
- 通常ユーザー向けRNG SetupはCounter Gateの入力欄を提供しない。過去に保存されたmanual Counter Gateはlegacy / diagnostic / compatibility値としてそのまま保持し、Production active Predictionのavailabilityまたは結果を変更しない

---

## 9. 観測検索

## 9.1 目的

実際のゲーム内抽選結果から、Seed / Counterまたは通常アーティアCounterを特定する。

初期版の主用途。

- 通常アーティアの武器種別レア8 Counter特定
- 必要に応じたRNG状態の検証

9.2〜9.4のgeneric `Observation` / `CounterSearchInput` / `CounterSearchResult` は初期設計の汎用Counter Search契約として保持する。current Productionの観測検索は次の専用契約を使用する。

| stream | current Production contract |
|---|---|
| Base Seed + 開始Skill Counter | 9.7 Skill Identification |
| 開始Gogma Counter | 9.8 Gogma Counter Identification |
| 武器種別レア8 通常アーティアCounter | 9.12 Normal Artian Counter Identification |

新しい実装はgeneric契約の `Observation.id` / `observedAt` / `elementId` / `searchKind` / `CounterMatch.confidence` を実装対象にしない。9.12は9.3の `searchKind = "normal_artian_counter"` 案をsupersedeする。

Seed候補を汎用的に検索する契約はcurrent specificationに存在しない。Base Seedの特定は9.7のSkill Identificationだけが行う。9.5と9.6は欠番であり、9.7以降の番号はsrcコメントおよび他文書からの参照安定性のためそのまま維持する。

## 9.2 Observation

```ts
export interface Observation {
  id: string;
  observedAt: ISODateTimeString;
  kind:
    | "normal_artian"
    | "gogma_bonus"
    | "skill";
  weaponTypeId: WeaponTypeId;
  elementId: ElementId | null;
  rarity: NormalArtianRarity | null;
  restorationBonuses: RestorationBonusSet | null;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
}
```

制約。

- `kind = "normal_artian"` の場合、`rarity = 8` と `restorationBonuses` は必須。現在のEngineで属性を使わない場合、`elementId = null` を許可する
- `kind = "gogma_bonus"` の場合、`elementId` と `restorationBonuses` は必須
- `kind = "skill"` の場合、`elementId` は必須で、seriesまたはgroupの少なくとも一方が必須
- `elementId` が指定される場合はMaster Dataに存在し、対象武器種で有効でなければならない
- 実RNG解析で特定観測種別にelementが不要と判明した場合のみ、Engine InterfaceとObservation validationを同時に変更する

## 9.3 CounterSearchInput

```ts
export interface CounterSearchInput {
  baseSeed: NormalizedSeed;
  searchKind:
    | "normal_artian_counter"
    | "gogma_counter"
    | "skill_counter";
  weaponTypeId: WeaponTypeId;
  rarity: NormalArtianRarity | null;
  observations: Observation[];
  startCounter: number;
  endCounter: number;
  master: RngMasterSubset;
}
```

制約。

- `startCounter` と `endCounter` は0以上の整数
- `endCounter >= startCounter`
- 検索範囲はUIから指定可能にしてよいが、初期値は設定の `defaultSearchLimit` を使用する
- `searchKind = "normal_artian_counter"` では、すべてのObservationを `kind = "normal_artian"` とし、入力の武器種とレア8に一致させる
- `searchKind = "gogma_counter"` では、すべてのObservationを `kind = "gogma_bonus"` とし、各Observationの `elementId` を必須とする
- `searchKind = "skill_counter"` では、すべてのObservationを `kind = "skill"` とし、各Observationの `elementId` を必須とする
- 異なるCounterストリームのObservationを1つのCounterSearchInputへ混在させない

## 9.4 CounterSearchResult

```ts
export interface CounterSearchResult {
  matches: CounterMatch[];
  searchedFrom: number;
  searchedTo: number;
  elapsedMs: number;
  isTruncated: boolean;
}

export interface CounterMatch {
  counter: number;
  observationCount: number;
  confidence:
    | "unique"
    | "multiple";
}
```

処理方針。

- 一致が1件ならCounter確定
- 一致が複数なら追加観測を要求
- 一致が0件なら入力ミス、Seed違い、検索範囲不足を提示
- 検索が時間上限に達した場合は `isTruncated = true`

## 9.7 C5-E2B1 Skill Identification current contract

Production Identification WizardのSkill-first経路は次の専用契約を使用する。

- 入力は武器種、属性、Series SkillとGroup Skillをともに持つ連続観測列、bounded inclusive Skill Counter rangeである
- 観測1はNormal ArtianからGogma Artianへのconversion時に自動付与されたSkill、以後は連続するReset Skills結果である
- 開始Skill Counterを`S`とすると、観測`i`は`S + i`（観測1を`i = 0`とする）に対応する
- Base Seed探索domainはcanonical `0..99,999,999` inclusiveである。テストとbenchmarkでは、このdomain内のbounded inclusive Seed rangeを指定できる。Wizard UIのSeed range初期値はこのcanonical全域であり、ユーザーが狭いbounded rangeへ変更できる（[UI_FLOW.md](./UI_FLOW.md) 5.4）。Seed range入力はcanonical 10進8桁の数字入力であり、RNG Setupの手動Base Seed入力（raw 10進 / 16進を `normalizeSeed()` で正規化）とは別契約である
- Skill Counterのformal domainと1回の検索coverageは分離する。C5-E2B1時点の初期UX推奨幅は11候補だが、永久上限ではない
- Counter Gateは入力、観測、探索対象にしない。kernelはSkill active branchを選ぶ内部代表値54を用いるが、これはactual Gate値ではなく永続化しない
- Series SkillとGroup Skillはsemantic Domain IDで受け取り、両方を完全一致させる
- 候補は`baseSeed`昇順、次に`startSkillCounter`昇順で返す
- `maxMatches`を使用する場合、現在処理中のSeedに属する全Counterを完了したprefixだけを保持・切り詰め対象とする。並列chunkは全chunk完了後にSeed range順でmergeし、Worker完了順を結果順へ使わない
- 結果は候補、実際に完了したSeed range、truncation状態を返す。RngStateへのadopt/persistはC5-E2B1の責務外である
- Production正解authorityは`ProductionRngEngine.predictSkills()`であり、compiled matcherは既存Production PRNG、Skill seed adapter、Skill table mappingとdifferential parityを維持する高速化kernelである
- Skill Identification kernelとProduction Worker foundationはimplementedであり、C5-E2C7でWizard UIはRNG Setupへ接続済みである。C5-E2C10 Production Identification activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。`production-rng:c5-e2`を維持する
- Worker requestIdはactive中の再利用を禁止し、新requestを明示的に拒否する。cancel状態はrequest-scoped tokenに保持し、旧処理のterminal completionまで解除せず、その後に破棄する
- bounded goldenに加えて、C5-E2C9で独立したgame-verified fixture `src/test/fixtures/gameVerifiedSkillVectors.ts` を追加した（[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。live verificationは完了しており、Production UI activationもC5-E2C10で完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）
- STEP 1は完全な探索で候補がexactly oneかつnon-truncatedの場合だけ一意とする。候補が複数なら候補をユーザーに選ばせず、次のReset Skills観測を追加して同じ検索を再実行する。候補0件では観測入力、Counter range、操作順を確認し、範囲を自動拡張しない
- Skill live verificationはC5-E2C9で完了した。known Base Seed `51231782` / starting Skill Counter `341` / `weapon.insect_glaive` / `element.ice` と、conversion自動SkillおよびReset Skills 3回のSeries / Group両方をSkill Counter 341-344として記録したgame-verified fixtureを保持する。state sourceは独立したGARP live RNG state readであり、観測後にゲーム状態を復元済みのため、starting Counterへ観測回数を加算しない
- 実Browser Worker benchmarkはC5-E2C8で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）。Skill live-game verificationはC5-E2C9で完了した（[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。Node benchmarkをBrowser benchmarkとして扱わない。C9完了自体はProduction Identification activationの完了ではなく、activationはC5-E2C10で別途判断した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）
- Seed rangeをcontiguous / non-overlapping chunkへ分割するmulti-worker orchestrationはC5-E2C6で実装済みである。chunk結果はSeed range順にdeterministic mergeし、global progress、全Workerへのcancel propagation、Worker failureの明示errorを提供する。この契約を維持する

## 9.8 C5-E2B2 Gogma Counter Identification current contract

Skill Identificationでcanonical Base Seedが確定した後のSTEP 2には、次のReset-only専用契約を使用する。

- 入力はknown canonical Base Seed、武器種、属性、連続するordered five-slot Reset観測、bounded inclusive Gogma Counter rangeである。Seed range、Keep、current bonuses、Counter Gateは入力に含めない
- 開始Gogma Counterを`G`とすると、観測`i`は`G + i`（観測1を`i = 0`とする）に対応する。各slotのsemantic Bonus Type/Rankを同位置で完全一致させる
- Counterのformal persisted domainとWizard coverageを分離する。Identification rangeはProduction PRNG block positioningが安全な`0..floor(Number.MAX_SAFE_INTEGER / 10)`内に制限する
- Counter Gate exact値は探索・保存しない。Gogma active branchの内部代表値35を用いるが、actual Gate値ではない
- callerは`weaponTypes`、`elements`、`bonusTypes`、`weaponBonusDefinitions`のMaster subsetをWorker inputへ渡す。LotteryMaster、Worker内Master load、Lottery availability gateは使用しない。PR-B（`production-rng:c5-e7`）以降、このMaster subsetはWorker input shapeの互換のために保持するだけであり、Reset candidate availabilityのauthorityではない
- Production Gogma Resetと同じcandidate availabilityと同じProduction weighted draw semanticsを共有し、raw reference Resetだけで照合しない。Identification専用の別candidate tableを持たない。PR-B（`production-rng:c5-e7`）でProduction Resetへ6.1.1のProduction family availabilityと `sharpness_capacity` family上限2を実装した際に、Identification kernelも同時に移行し、`productionGogmaResetCandidatesForWeaponAndElement()` と `predictProductionGogmaResetSlotsFromRawValues()` をProduction Resetと共有する。`production-rng:c5-e6` まではMaster availability filter済みcandidate orderとexact-ID repeat penaltyを共有していた
- 2026-09-15のgame-verified Switch Axe / `element.none` Reset観測（Base Seed 51231782、Counter 55、`[6, 14, 9, 8, 6]`）は、Counter 50..65の探索で55だけに一致する。2026-09-15の各Reset観測（6.1.1 / [RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.17）はそれぞれ自身のCounterに一致し、Hammer / 麻痺 Counter 104のexact-ID-only model結果 `[6, 6, 8, 10, 8]` は一致しない
- 候補は`startGogmaCounter`数値昇順で返す。`maxMatches`は最初のN候補で停止し、完了した連続Counter prefixを`searchedCounterRange`として返し、未探索範囲があればtruncatedとする
- progressは完全にaccept/rejectした`searchedCounters / totalCounters`と`matchesFound`である。Counter chunk sizeはruntime tuning値で、永続Production契約ではない
- 2026-09-13（Asia/Tokyo）のgame-verified Hammer/Paralysis six-Reset fixture（Base Seed 51231782、start Counter 55、actual Gate 200）はCounter 55..60の30 ordered slotsすべてがProduction Gate 35/200で一致する。Counter 50..65では1観測から55だけ、0..100,000では1観測で5候補、2観測以降は55だけに一致する
- Gogma Counter Identification kernelとProduction Worker foundationはimplementedであり、C5-E2C4 Identification Adoption Serviceもimplementedである。C5-E2C7でWizard UIはRNG Setupへ接続済みである。C5-E2C10 Production Identification activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`を維持する
- STEP 2へ進めるのはSTEP 1がexactly oneかつnon-truncatedのBase Seed候補を返した場合だけとする。STEP 2も完全な探索でstarting Gogma Counter候補がexactly oneかつnon-truncatedの場合だけreviewへ進める。複数なら追加Reset観測、0件なら観測入力、range、操作順の確認を要求する
- WizardはCounter Gateを入力、探索、Observation、resultへ含めず、Skill 54 / Gogma 35をactual Gateとしてpersistしない
- 採用前に調査前のゲーム状態へ戻したことをユーザーに確認させる。採用するCounterはstarting Skill Counter `S` とstarting Gogma Counter `G`であり、観測中の操作回数を加算した `S + N` / `G + M`ではない
- adoption時はBase SeedをProduction `normalizeSeed()`で再validation / canonicalizeし、Base Seed、Skill Counter、Gogma Counterのsourceに既存の `observation` を使用する。Counter GateとNormal Counterを変更せず、新しい `identified` sourceはv1必須ではない
- Wizard開始時と各観測Stepでは、観測中はゲーム状態を保存しないこと、開始前にバックアップ方法と自動保存の設定・挙動を確認すること、案内された操作だけを連続して行うこと、観測後は調査前状態へ戻してから採用することを表示する。ゲーム側の保存仕様や安全を断定・保証しない
- `invalid_input` / `unsupported_input` / `cancelled` / `unexpected_error` / Worker unavailable / duplicate requestIdを区別する。`unexpected_error`またはWorker failureを候補0件へ変換しない

## 9.9 C5-E2C4 Identification Result Adoption Service current contract

- application serviceはreview済みexact値 `baseSeed`、`startingSkillCounter`、`startingGogmaCounter`だけを受ける。Workerのraw result、observation count、UI stateは入力に含めない
- `matches.length === 1 && isTruncated === false` のunique判定と、調査前ゲーム状態へ戻したことの確認は後続Wizard Coordinatorの責務である
- Base Seedは保存前にProduction `normalizeSeed()`で再validation / canonicalizeする。RNG Setupと同様、valid noncanonical入力はcanonical decimal stringへ変換し、invalid入力は永続化前に拒否する
- starting Skill / Gogma Counterは既存 `validateRngState()` のpersisted Counter domainで検証する。Identification kernel固有のsearch range上限をadoption domainへ持ち込まない
- repositoryの `ensureInitialRngState()`でcurrent stateを取得し、Base Seed、Skill Counter、Gogma Counterだけをconfirmed / source `observation`へoverrideする。Counter Gate、notes、createdAt、その他fieldを保持し、`updatedAt`をRNG Setupと同じく更新する。あわせてIdentification provenance `RngState.lastIdentifiedAt` を採用時刻で更新する（[DATA_MODEL.md](./DATA_MODEL.md) 6.1）。このfieldを書くのは本adoptionだけであり、RNG Setupの通常保存やDebug編集は書かない。3値を一体で採用するため、1回の採用でGogma / Skill両streamの `actual_result_different` を解決してよい（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15）
- 観測回数によるCounter advanceは行わず、starting `S` / `G`をそのまま保存する。単一のvalidated RngStateを `putRngState()`へ1回渡し、保存されたRngStateを返す
- NormalArtianCounter、BuildCandidate、BuildListEntry、ProductionPlanのrepositoryには依存せず、直接mutationまたはstale書込みを行わない
- state未作成時は既存ensure契約に従ってinitial RngStateを作成してからadoptする。現repositoryにCAS/version checkはなくread-modify-put間の同時manual updateを上書きし得るため、Wizard側は同時編集を避ける。C5-E2C4だけの新concurrency機構は追加しない
- persistence failureとunexpected failureはsuccessへ変換せずcallerへ伝播する。`RngState.counterGate` schema、Production RNG semantics/versionは変更しない
- Adoption Serviceはimplementedである。STEP 1/2 Coordinatorの契約は9.10、C5-E2C7 Wizard UIはRNG Setupへ接続済みであり、Production Identification activationはC5-E2C10で完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）

## 9.10 C5-E2C5 Identification Wizard Coordinator current contract

- Reactから独立した非永続application Coordinatorは、Skill Identification Worker Client、Gogma Counter Identification Worker Client、C5-E2C4 Adoption Serviceをcomposeする。CoordinatorがRngState repositoryへ直接依存せず、途中結果をIndexedDB / localStorage / RngStateへ保存しない
- STEP 1 / STEP 2とも `matches.length === 1 && isTruncated === false` だけをuniqueとする。truncatedは候補数に関係なくincompleteであり、0件、複数、incompleteを候補手動選択または自動range拡張で解決しない
- STEP 1 uniqueからcanonical `baseSeed` と `startingSkillCounter`だけを保持する。STEP 2 caller inputにSeedを持たせず、CoordinatorがSTEP 1 Seedを注入する。STEP 2 uniqueと結合したreviewは `baseSeed` / `startingSkillCounter` / `startingGogmaCounter`だけで、観測回数をCounterへ加算しない
- STEP 1再検索はSTEP 2、review、復元確認をinvalidateし、STEP 2再検索はSTEP 1 uniqueを保持してreview、復元確認をinvalidateする。request IDはstep / generation / sequenceで使い回さず、generation照合によってcancel後のlate responseがcurrent stateを上書きしない
- cancelは再実行用input snapshotと有効な上流unique結果を保持する。restartはactive Worker requestをcancelして全transient stateを破棄し、disposeはCoordinatorが所有する両Worker Clientを停止する。Workerのinvalid / unsupported / cancelled / unavailable / duplicate / unexpected errorを0件へ変換しない
- review後にユーザーが調査前ゲーム状態へ戻したことを明示確認しない限りadoptionを拒否する。adoption中および成功後の同一Coordinatorからの重複adoptionを拒否し、成功時はC5-E2C4が返す保存済みRngStateを保持する。persistence failure時はreviewと復元確認を保持して明示的retryを可能にする
- Coordinatorはimplementedである。C5-E2C6 Skill multi-worker orchestrationも既存Client interfaceの背後でimplementedであり、C5-E2C7 Wizard UIはRNG Setupへ接続済みである。実Browser Worker benchmarkはC5-E2C8で、Skill live-game verificationはC5-E2C9で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md) / [C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。C5-E2C10 Identification Production activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。`production-rng:c5-e2`を維持する

## 9.11 C5-E2C6 Skill Identification Multi-Worker Orchestration current contract

- Coordinatorから見える `SkillIdentificationWorkerClient` interfaceは変更せず、Production factoryだけがmulti-worker clientを注入する。Gogma Counter Identificationはsingle Workerのままとする
- Production Worker数はlogical coreが4以上なら4、2から3なら2、それ以外または取得不能なら1とし、正式上限は4である。Seed数がWorker数未満なら空chunkを作らず、実使用Worker数をSeed数以下にする
- defaultを含むinclusive Seed rangeだけを、contiguous / non-overlapping / gap-free chunkへ分割する。Skill Counter rangeとsemantic observation inputは全childで同一である
- child request IDはparent request ID、logical request token、chunk indexから一意に生成する。同じactive parent request IDは拒否し、success / cancel / failure後は再利用できる。複数の異なるparent requestは既存Client interfaceどおり同時実行可能である
- childにはparent `maxMatches`を渡さず全chunkを完全探索させ、Seed順・Counter順でdeterministic mergeした後にglobal limitを適用する。global `searchedSeedRange` / `isTruncated`はsingle kernelが同じinputを処理した場合のcompleted Seed prefix semanticsと一致させる。truncated、欠落、overlapのあるchild resultは `incomplete_parallel_chunk` とし、partial successへ変換しない
- global progressは各childのlatest `searchedSeeds`と`matchesFound`を保持して合計し、元range全体を`totalSeeds`とする。out-of-order progressでも各child値を巻き戻さず、`searchedSeeds`を0から`totalSeeds`に収める。`matchesFound`はglobal limit前に発見済みの完全な候補数であり、`maxMatches`を超え得る
- parent cancelは全active childへ伝播し、parent Promiseをcancelled errorでrejectする。1 childのfailure / unavailableは全active siblingをcancelしてlogical request全体をfailureにし、partial matchesを返さない。cancel / failure後のlate child result/progressはparent、次request、global progressへ反映しない
- child Engine versionは全て同じProduction versionでなければならない。creation failureまたはversion mismatchはfail closedでWorker unavailableとし、生成済みchildをdisposeする。`dispose()`はactive childをcancelし、全child clientをdisposeする
- C5-E2C6はorchestrationだけであり、Skill kernel、Production RNG semantics/version、Coordinator state machine、Gogma Identification、RngState、Search、Planner、React UIを変更しない。実Browser Worker benchmarkはC5-E2C8で、Skill live-game verificationはC5-E2C9で完了済みであり、C5-E2C10 Production activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。Wizard UIはC5-E2C7でRNG Setupへ接続済みであり、development StrictMode環境のCoordinator lifecycle起因の表示不具合はC5-E2C7 lifecycle hotfixで解消済みである

## 9.12 Normal Artian Counter Identification current contract

`NormalArtianCounter.counter` が不明な武器種について、既知Base Seedと連続forgeした通常アーティアの5枠観測から開始Counterを特定する専用契約である。9.3のgeneric `searchKind = "normal_artian_counter"` 案をsupersedeし、Skill / Gogma Identification（9.7 / 9.8）と同じDomain kernel / Worker protocol / Worker Client構造を持つ。

型（`src/domain/rng/identification/normalArtianCounterIdentificationTypes.ts`）。

```ts
// src/domain/rng/normalArtianLotteryTable.ts（6.3.1）
export type NormalArtianLotteryTableClass = 'table_a' | 'table_b'

export interface NormalArtianCounterObservation {
  readonly tableClass: NormalArtianLotteryTableClass
  readonly bonuses: RestorationBonusSet
}

export interface NormalArtianCounterIdentificationInput {
  readonly baseSeed: NormalizedSeed
  readonly weaponTypeId: WeaponTypeId
  readonly rarity: NormalArtianRarity
  readonly observations: readonly NormalArtianCounterObservation[]
  readonly normalCounterRange: InclusiveNumberRange
  readonly maxMatches?: number
}

export interface NormalArtianCounterIdentificationMatch {
  readonly startNormalCounter: number
}

export interface NormalArtianCounterIdentificationResult {
  readonly matches: readonly NormalArtianCounterIdentificationMatch[]
  readonly searchedCounterRange: InclusiveNumberRange
  readonly isTruncated: boolean
}

export interface NormalArtianCounterIdentificationProgress {
  readonly searchedCounters: number
  readonly totalCounters: number
  readonly matchesFound: number
}
```

前提と入力。

- Base Seedは既知が前提である。kernelはBase Seedを探索しない。入力はProduction `NormalizedSeed` であり、`engine.normalizeSeed()` で再validationしてcanonical Production decimal formと一致しない値は `invalid_input` とする
- v1は既存契約どおり `NormalArtianRarity = 8` だけを受け付け、それ以外は `invalid_input` とする。内部rarity 7への変換は既存Production adapterがそのまま行う
- Counterは武器種ごとに独立している。1回のIdentificationは1武器種のレア8 Counterだけを対象にし、他武器種の通常アーティア作成が間に挟まっても対象武器種のCounter連続性には影響しない
- Counter Gateは入力、観測、探索対象、結果、採用値のいずれにも使用しない
- `normalCounterRange` はinclusiveで、`0 <= startInclusive <= endInclusive <= floor(Number.MAX_SAFE_INTEGER / 10)` とする。上限はProduction PRNGの10-step block positioning（`readReferenceRngBlock()` と同じ境界）から導出した値であり、persisted `NormalArtianCounter` domainとは別契約である。`endInclusive + observations.length - 1` がこの上限を超える入力は拒否する
- `maxMatches` を指定する場合は1以上のsafe integerとする

属性の扱い。

- Normal seedは既存実装どおりBase Seed + 武器種 + rarityで決まり、属性の種類そのものはseedへ影響しない。属性はNormal bonus candidate poolの選択にだけ影響する
- 通常アーティアRNGが区別するのは、その武器種のlottery table class（6.3.1、`NormalArtianLotteryTableClass = 'table_a' | 'table_b'`）だけである。Bowでは火 / 水 / 雷 / 氷 / 龍 / 爆破がTable A、無属性 / 毒 / 麻痺 / 睡眠がTable Bであり、Switch Axeを除く近接とBowgunでは属性ありがTable A、無属性がTable Bである。Switch Axeも観測adapterとしては属性あり = Table A、無属性 = Table Bだが、両tableは同じsingle pool `[6, 4, 7, 8]` を参照する（6.3.1）。「無属性か属性ありか」はNormal lottery全体の正式区分ではなく（Bowの毒 / 麻痺 / 睡眠で誤る）、旧 `NormalArtianAttributeClass` は廃止した
- したがって各Observationは `tableClass` だけを持ち、exact `ElementId` を検索domainへ要求しない。UI上の表記は、Bowでは「テーブルA（火・水・雷・氷・龍・爆破）/ テーブルB（無属性・毒・麻痺・睡眠）」、その他の武器種では「属性あり / 無属性」とし、`table_a` / `table_b` の技術enumを表示しない（[UI_FLOW.md](./UI_FLOW.md) 6）
- Table A / Bは同じCounter Cに対するpool選択だけを表し、Counter streamではない。1回のIdentification内でTable AとTable Bの観測が混在しても、それは同じCounter stream上で各forgeが選んだpoolが異なるだけであり、別Counterではない。table classを `NormalArtianCounter` ID / persisted shape / DB schemaへ入れない
- kernelのcandidate poolは `gameVerifiedNormalCandidatesForWeaponAndTableClass(weaponTypeId, tableClass)` から直接取得する。既存 `RngEngine.getPredictionSupport()` は `elementId` を受け取るため、support query内部でのみ `table_a -> element.fire`、`table_b -> element.none` を内部representativeとして写像する（`normalArtianLotteryTableClassSupportQueryElementId()`）。この代表値は「そのtableのpoolのsupportを問い合わせる」以上の意味を持たず、実際の観測属性を意味しない。永続化、結果、Observation、表示へ漏らしてはならず、core candidate authorityにもしない

Observation連続性。

- Observation配列は順序付き連続forgeである。開始Counter候補を `C` とすると、観測 `i`（観測1を `i = 0` とする）は `C + i` に対応する。kernelは配列をsortしない
- 各観測は同じ武器種・レア8の実forge結果であり、5枠ordered exact matchで照合する。`bonusTypeId`、`bonusRankId`、slot順のすべてが一致した場合だけ一致とする。同じfamilyが5個含まれるだけでは一致としない
- 各観測の候補poolは、その観測自身の `tableClass` から選ぶ。1回のIdentification内でTable AとTable Bの観測が混在してもよい（例: Bowで火 → 毒 → 爆破と連続forgeした場合、観測は `table_a` / `table_b` / `table_a` であり、同じCounter C / C+1 / C+2に対応する）

探索とアルゴリズム。

- 開始候補 `C` を `normalCounterRange` 全域で昇順に評価し、すべての観測が `C + i` の予測と一致した `C` だけをmatchとする。matchesは `startNormalCounter` 昇順で返し、同じ入力からは常に同じ配列を返す
- correctness authorityは `ProductionRngEngine.predictNormalArtian()` である。kernelは同じNormal seed derivation、10-step block positioning、game-verified candidate pool、pool step（`selectReferenceNormalLotteryIdsFromRawValues()`）を共有し、独自のRNG規則を持たない。観測は `mapReferenceNormalResult()` の逆写像でreference ID namespaceへ変換して照合し、対象武器種のNormal lotteryが生成し得ないBonus（Gogma tier、未知type、Bowgunの斬れ味、Bowのfamily 7など）は `invalid_input` とする
- さらに各観測は、その `tableClass` に対応するgame-verified candidate poolで生成可能でなければならない。poolに存在しないreference ID（例: Heavy Bowgun / Table A / Element、Long Sword / Table B / Element、Bow / Table B / Element）を含む観測、または同一candidateが `maximumOccurrences` を超えて出現する観測（例: BowgunのCapacity 3枠、Long Sword / Bow / Table AのElement 5枠、Bow / Table BのAffinity 4枠、任意のsupported poolのAffinity 4枠。上限は6.3.1のProduction値 Attack 5 / Element 4 / family 7 2 / Affinity 3）は、検索0件ではなく `invalid_input` とする。「入力自体がProduction poolから生成不能」と「範囲内に一致なし」は区別する
- progressは開始Counter候補として評価を完了した `searchedCounters / totalCounters` と `matchesFound` であり、Observation数×prediction回数ではない。Counter chunk sizeはruntime tuning値で永続Production契約ではない
- Workerは各chunk間でmacrotask yield（`setTimeout(..., 0)`）を挟み、pending cancel messageを処理できる。cancel後はresultをpostしない
- `maxMatches` 到達時は探索を停止し、`searchedCounterRange.endInclusive` に実際に評価完了した最後の開始Counterを、未探索Counterが残る場合は `isTruncated = true` を返す

結果の解釈。

- unique: `matches.length === 1 && isTruncated === false` の場合だけCounterを確定できる
- multiple: 追加観測（次の連続forge）を追加して同じ検索を再実行する。候補をユーザーに手動選択させない
- zero: 観測入力、Base Seed、武器種、属性区分、検索範囲、forge順を確認する。範囲を自動拡張しない
- truncated: 候補数に関係なくincompleteであり、unique確定不可とする
- 確定時に既存 `NormalArtianCounter` へ反映する処理（`counter` / `isConfirmed` / `observationCount` / `candidateCount` / `lastObservedAt`、およびIdentification provenance `lastIdentifiedAt`、[DATA_MODEL.md](./DATA_MODEL.md) 6.2）はNormal Counter Setupの確定経路（`RngStatePersistenceService.adoptNormalArtianCounterIdentification()`）の責務であり、kernel / WorkerはDBを変更しない。kernelが返す `startNormalCounter` は観測1を作成する直前のCounter `C`（調査前状態で次にforgeされるCounter）であり、観測数を加算しない。運用はSkill / Gogma Identificationと同じく、観測後はゲームを保存せず、調査前状態へ戻ったことを確認してから `counter = startNormalCounter` を確定する（[UI_FLOW.md](./UI_FLOW.md) 6）。`C + observationCount` を保存する運用は採用しない。Observation履歴のDB永続化schemaは追加しない

Production support境界。

- Production supportはProduction Normal pool（`gameVerifiedNormalCandidatesForWeaponAndElement()`）の範囲だけである。現時点ではBow、Light Bowgun、Heavy Bowgun、Switch Axeを除く近接10武器種（Great Sword / Sword and Shield / Dual Blades / Long Sword / Hammer / Hunting Horn / Lance / Gunlance / Charge Blade / Insect Glaive）、およびSwitch Axe（独立single pool）の14武器種であり、これはアルゴリズム上の制約ではなくProduction poolが確定している範囲である。Melee共通poolのprovenance（directly game-verifiedとcategory-level Production adoptionの区別）は6.3.1と[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.14に、Switch Axeのprovenanceは6.3.1と14.16に従う
- Production poolを持たない武器種（現時点では該当なし）でProduction Counter Searchを呼んだ場合は `unsupported_input` / `unsupportedReason = normal_pool_unverified` でfail closedする契約を維持する。reference poolへfallbackせず、unknown WeaponTypeIdを暗黙にMelee扱いしない（unknown WeaponTypeIdは `reference_adapter_unsupported`）。`reference_adapter_unsupported` / `engine_capability_unavailable` も既存 `RngPredictionUnsupportedReason` のまま構造化して上位へ渡し、message文字列から推測させない
- `predictReferenceNormalRaw()` によるreference parityは検証用であり、reference-verifiedとgame-verified Productionは別契約である。Counter Identificationのobservation validation（pool membership / `maximumOccurrences`）は、Melee共通poolでもSwitch Axe poolでもAttack 5 / Element 4 / Sharpness 2 / Affinity 3の6.3.1契約をそのまま使う。Switch Axeでは両table classが同じpoolを持つため、`table_b` の観測でもElementは有効であり、Melee Table BのElement invalidをSwitch Axeへ誤適用してはならない

Error semantics。

- `invalid_input` / `unsupported_input` / `cancelled` / `unexpected_error` / Worker unavailable / duplicate requestIdを区別する。Domain errorは `NormalArtianCounterIdentificationError` であり、`unsupported_input` では `unsupportedReason` に `RngPredictionUnsupportedReason` を保持する
- Worker requestは `identify_normal_artian_counter` / `cancel`、responseは `normal_artian_counter_identification_result` / `progress` / `error` である。active requestIdの再利用は拒否し、terminal後は再利用できる。late responseはClientがrequestIdで無視する

Golden。

- 既存game-verified fixture `src/test/fixtures/gameVerifiedNormalVectors.ts` のHeavy Bowgun観測（Base Seed 51231782、Normal Counter 4 / 5 / 6の連続15slot）は、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 5.3の監査どおり開始Counter 0..5000で `startNormalCounter = 4` の1件だけに一致し、`isTruncated = false` である。同じ15slotは1観測では0..5000に19候補、2観測以降は4だけになる
- kernel / Worker foundationはimplementedである。NormalCountersPageへのUI接続、Counter確定処理、未検証武器種のProduction activationは後続PRである。`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`、Production Normal RNG output、Normal seed derivation、`NormalArtianCounter` persisted shape、`DATABASE_SCHEMA_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` は変更していない
- その後の通常アーティア抽選上限修正（6.3.1）で、game-verified Production poolの `maximumOccurrences` はAttack 5 / Element 4 / family 7 2 / Affinity 3となり、`PRODUCTION_RNG_ENGINE_VERSION` は `production-rng:c5-e3` となった。Counter Identificationのpool membership / occurrence validationはこの値を使う。HBG golden（Base Seed 51231782、Counter 4 / 5 / 6、0..5000で `startNormalCounter = 4` 唯一）は上限修正後も変わらない。上限修正の時点ではsupport対象武器種、`NormalArtianAttributeClass`、Counter semanticsを変更していない
- さらにその後のMelee support拡張（6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.14）で、Counter IdentificationはSwitch Axeを除く近接10武器種を `attribute_present` / `none` の両classで検索可能になり、`PRODUCTION_RNG_ENGINE_VERSION` はこの時点では `production-rng:c5-e4` であった。kernelは `ProductionRngEngine.getPredictionSupport()` と `gameVerifiedNormalCandidatesForWeaponAndElement()` を共有しているため、support境界の拡張はkernel側の変更なしに自動的に反映される。Switch Axeだけが `unsupported_input` / `normal_pool_unverified` のままである。HBG golden、`NormalArtianAttributeClass`、Counter semantics、`NormalArtianCounter` persisted shape、`DATABASE_SCHEMA_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` は変更していない
- その後、NormalCountersPageへのUI接続が完了した（[UI_FLOW.md](./UI_FLOW.md) 6）。`createProductionNormalArtianCounterIdentificationWorkerClient()` は通常UIから呼ばれ、観測入力 → Counter検索 → 追加観測 → unique確認 → 調査前状態への復元確認 → `counter = startNormalCounter` 確定保存までを行える。観測で選択可能なBonusは `normalArtianCounterObservationBonusOptions()` がProduction pool（`gameVerifiedNormalCandidatesForWeaponAndElement()`）とreference semantic mapping（`restorationBonusFromReferenceNormalId()`）から導出し、UI側に別の抽選表を持たない。検索可否は `getNormalArtianCounterIdentificationSupport()` がkernelと同じcapability / `getPredictionSupport()` で判定する。この接続はUI / Application層だけの変更であり、kernelのアルゴリズム、Production pool、reference parity、当時の `PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e4`、`NormalArtianCounter` persisted shape、`DATABASE_SCHEMA_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` は変更していない。Observation履歴の永続化schemaも追加していない
- その後のBow Table A / B修正（6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.15）で、Observationの区分を `attributeClass: 'none' | 'attribute_present'` から `tableClass: NormalArtianLotteryTableClass` へ再設計した。kernelのcandidate comparisonとPRNG walkは変更しておらず、candidate pool取得だけを `gameVerifiedNormalCandidatesForWeaponAndTableClass()` へ置き換えた。Worker request / Worker Client / UIも同じfieldへ更新した（Worker protocolは同一bundle内のtyped protocolでありDB persisted schemaではないため、旧 `attributeClass` payloadの互換handlingは持たない）。`PRODUCTION_RNG_ENGINE_VERSION` は `production-rng:c5-e5` である。HBG golden（Base Seed 51231782、Counter 4 / 5 / 6、0..5000で `startNormalCounter = 4` 唯一）は不変であり、Bow Table A Counter 0観測 `[Attack, Attack, Affinity, Element, Element]` とBow Table B Counter 0観測 `[Affinity, Affinity, Attack, Attack, Affinity]` がそれぞれC = 0に一致すること、同じBow identification内のTable A / B混在を受理すること、Bow / Table B / Elementが `invalid_input` であること、当時Switch Axeが `unsupported_input` / `normal_pool_unverified` のままであることをtestで固定した。`NormalArtianCounter` persisted shape、`DATABASE_SCHEMA_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、Observation履歴の非永続化は変更していない
- その後のSwitch Axe Normal Production activation（6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）で、`getNormalArtianCounterIdentificationSupport('weapon.switch_axe', 8)` は `supported: true` となり、Switch Axeの `table_a` / `table_b` 双方が同じsingle pool `[6, 4, 7, 8]` を使って1本の `weapon.switch_axe:8` Counterを検索できる。kernelのcandidate comparisonとPRNG walkは変更していない。golden: Base Seed 51231782でTable A Counter 0観測 `[Sharpness, Sharpness, Affinity, Attack, Element]` とTable B Counter 1観測 `[Affinity, Attack, Element, Element, Attack]` の2観測は、0..5000で `startNormalCounter = 0` の1件だけに一致し `isTruncated = false` である（Counter 0観測1件だけでは候補が複数）。Switch Axe / Table B / Elementは有効、Sharpness 3 / Affinity 4 / Element 5は `invalid_input`、Attack 5は有効。`PRODUCTION_RNG_ENGINE_VERSION` はこの時点では `production-rng:c5-e6` であった（その後のGogma Reset実装で `production-rng:c5-e7`。Normal Counter Identificationの挙動は変わっていない）。HBG golden、Bow Table A / B golden、`NormalArtianCounter` persisted shape、`DATABASE_SCHEMA_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、Observation履歴の非永続化は変更していない

---

## 10. Web Worker

## 10.1 Worker用途

以下はWeb Workerで実行する。

- Seed検索
- Counter検索
- 大量候補のRNG予測
- Search Specで定義する候補検索
- Plannerで必要な長いシミュレーション

Candidate SearchとPlannerはいずれもWorker messageへRngEngine instanceを含めない。
Production Candidate Search WorkerはWorker module内部のfactoryで
`ProductionRngEngine`を生成する。Search ClientとBuildListのcurrent
CalculationContextは`PRODUCTION_RNG_ENGINE_VERSION`を共通authorityとして使う。
Production Planner Workerも独立したWorker-local factoryで同じ
`PRODUCTION_RNG_ENGINE_VERSION` のEngineを生成し、Planner ClientとPlanner current
CalculationContextの共通authorityにする。
PlannerWorker requestはstructured clone可能なPlannerInputだけを持ち、Worker module内部で
Engine factoryを取得する。生成したEngine、ID Factory、ClockはPlannerDependenciesとして
pure Planner calculationへ注入する。PlannerInputへengineCapabilitiesを重複保存せず、
`dependencies.rngEngine.capabilities` をCapability判定に使用する。

PlannerがRoute実行の予測を必要とする場合も注入EngineのPrediction / advance
契約だけを使用し、Bonus Type Mapping、固定Counter delta、Skill、Keep結果を推測しない。

Settings、Debug、RNG Setupのmain thread向け軽量操作は、
`ProductionRngEngine`から生成したnon-persistent runtime descriptorを共通authorityとする。
descriptorはmode `Production`、Engine version、operation-level capabilitiesを保持し、
Settingsはmode/versionとRNG同定の利用可否を、Debugは全capabilityを表示する。
RNG Setupは同じProduction Engine instanceの`normalizeSeed()`と`capabilities`を使用する。
具体的weapon/element/inputの対応範囲はoperation-level capabilityとは別に
`getPredictionSupport()`で判定する。Worker実行可否はEngineの存在・modeとは別概念であり、
Worker unavailableをEngine未設定として表示しない。descriptorやcapability snapshotを
BuildCandidate、BuildListEntry、ProductionPlanへ追加保存せず、永続provenanceは引き続き
`CalculationContext.rngEngineVersion`をauthorityとする。

現行Production capabilityはNormal Artian、Skill、Gogma Reset、Gogma KeepのPredictionがactive、
専用Skill / Gogma Identification Workerのavailabilityは、RngEngine capability flagではなく
Worker/application levelで個別に判定する。
Production有効判定とPredictionはdisabled legacy `LotteryMaster`を要求しない。

C5-E2C3でactive Gate policyをruntimeへ統合した。Production Domain Prediction inputはcaller-supplied Gateを持たず、Production adapterがCore/reference predictorへSkill 54、Gogma 35をoperation別のactive-branch representativeとして供給する。Capability、Search、Planner、Trace Replayはpersisted exact Gateを要求せず、semantic hashもlegacy Gateを除外する。observable semantics changeとして `PRODUCTION_RNG_ENGINE_VERSION` は `production-rng:c5-e2` である。C5-E2C7でIdentification UIは実装済みであり、C5-E2C10でProduction Identification activationが完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。

## 10.2 Message

```ts
export type RngWorkerRequest =
  | {
      type: "counter_search";
      requestId: string;
      input: CounterSearchInput;
    }
  | {
      type: "cancel";
      requestId: string;
    };

export type RngWorkerResponse =
  | {
      type: "counter_search_result";
      requestId: string;
      result: CounterSearchResult;
    }
  | {
      type: "progress";
      requestId: string;
      searched: number;
      total: number;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
```

制約。

- すべてのrequestに `requestId` を付与する
- UI側は古いrequestIdのresponseを無視する
- 中断用に `AbortController` 相当のキャンセルメッセージを用意する

---

## 11. 未確定アルゴリズムの扱い

RNG詳細が未確定の場合、以下の順で実装する。

1. Interfaceと型を先に固定する
2. fixture based fake engineを作る
3. 既知サンプルが得られたらreal engineへ差し替える
4. fake engineのテストをreal engine fixtureテストへ置き換える

`LotteryMaster` の現行 `internalValue` / `weight` は暫定スキーマである。Production Engineはreference-verifiedのbonus order、weight、repeat penalty、skill order、numeric mappingをRNG-specific reference-verified tableまたはEngine内部定数としてDomain IDへadapter変換し、現行LotteryMasterへ機械的に流し込まない。表示MasterとRNG抽選表の一致がgame-verifiedになるまで、現行LotteryMasterをProduction correctnessの根拠にしない。

Fake Engineの用途。

- UI実装
- Planner実装
- Domain Model検証
- Search / Plannerの入出力テスト

Fake Engineの制約。

- 本番ビルドで誤って使用しないようfeature flagで分離する
- Debug画面に使用中Engine名を表示する

---

## 12. テスト観点

## 12.1 Unit Test

- `normalizeSeed` が同じ値を同じ形式に正規化する
- Counterが負数の場合にvalidation error
- 同じPredictionInputから同じ結果が返る
- 復元ボーナス5枠の順不同比較が正しい
- Counter deltaがoperationごとに一元管理される
- conversionがSkill +1 / Gogma +0、Reset SkillsがSkill +1、Reset / KeepがGogma +1、forgeがNormal +1になる
- `candidateOffset = k` で `forgeCount = k + 1`、Normal `+(k + 1)` / Skill +1 / Gogma +0となり、最後の1本だけを巨戟化する
- `normalCounterAfter = normalCounterBefore + forgeCount` と `candidateCounter = normalCounterBefore + forgeCount - 1` の境界を取り違えない
- Gate thresholdからDomain Counterを変更せず、effective Skill / Gogma blockだけを0へ切り替える
- Observation validationがkind別に正しく動く
- Gogma Bonus / Skill観測でelementId欠落を拒否する
- Normal Artian観測でEngineが属性不要の場合にelementId nullを許可する
- CounterSearchInputでsearchKindと異なるObservation kindの混在を拒否する
- KnownValueが項目ごとに独立して確定できる
- Capability判定が不足値に依存する機能だけをfalseにする
- Keepがcurrent 5slotを明示入力し、slot familyを維持した単一結果を返す
- Domain rarity 8を内部7へ、WeaponTypeId / ElementIdをreference-verified numeric値へ明示mappingする

## 12.2 Fixture Test

- 既知Seed / Counter / 武器種から期待ボーナスが一致する
- 既知Skill Counterから期待スキルが一致する
- 観測1件で複数候補になるケースを再現する
- 観測追加で一意になるケースを再現する
- 一致なしケースを再現する
- Seed検索でNormal Artian、Gogma Bonus、Skill観測を組み合わせて候補が絞られる
- Keepで複数family layoutのcurrent 5slotから期待tier結果とslot family維持が一致する
- （PR-B）Production Gogma Resetが2026-09-15のgame-verified観測（Bow / 毒 Counter 55 / 179、Switch Axe / none Counter 55、Hammer / 麻痺 Counter 104 / 160、Lance / 龍 Counter 197、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.17）と5slot完全一致し（`sharpness_capacity` family上限2の決定的なtestはCounter 104とする。Counter 94は補助観測であり、fixture化する場合もtestの合否根拠を依存させない）、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 10.4の5条件とHammer / 麻痺 Counter 55..60の既存fixtureも不変である。reference parity（`predictReferenceGogmaReset`、reference golden / tests）は不変である
- （PR-B）Production Gogma ResetがNormal `maximumOccurrences` を流用せずAffinity 4 / 5枠を生成でき、`sharpness_capacity` family 2枠到達後はID 6 / 10の両方を除外し、Attack / Affinity / Elementに明示family上限を持たない。Gogma Counter IdentificationがProduction Resetと同じavailability / weighted drawを使う
- （PR-B）Keepへfamily availability filterとfamily上限を適用しない（Dual Blades / 龍 Counter 55..59のKeep観測が不変）
- conversion時のSkill fixtureと、Reset Skillsの次位置fixtureを区別して再現する

## 12.3 Worker Test

- `counter_search` requestに対してresultが返る
- `seed_search` requestに対してresultが返る
- progressが返る
- 古いrequestIdのresponseをUI側で無視できる
- cancel後に結果を反映しない
- Worker内エラーがUIへ伝わる

## 12.4 Performance Test

- 初期検索範囲でUIスレッドがブロックされない
- 大量検索時にprogressが更新される
- 検索上限到達時に `isTruncated = true` が返る
- Seed検索がUIスレッドではなくWorkerで実行される
