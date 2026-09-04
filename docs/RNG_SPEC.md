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
- GogmaSeedFinderのソースコードはコピーしない
- 外部ツール出力のImportは、出力テキストをparseして内部型へ変換するだけにする

Production RNG契約のprovenanceは次のとおりとする。

- Gogma-Artian-Roll-Planner: 単一武器のRNG予測と作成Routeの参照実装
- GogmaArtianPlanner: 参照した単一武器契約を、複数Target、Inventory、Planner、Executionへ拡張する製品
- Gogma Seed Finder系: Seed / Counterの観測・特定機能の参照元

外部Repositoryはreference-verified algorithmの参照元として扱い、ソースコードをコピーして組み込まない。監査時点の参照file、function、commit、参照実装で確認済みの事項と未確認事項は [RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) に記録する。

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

`RngState.counterGate` はlegacy/manual/import compatibility、将来のExport / Import round-trip、diagnostic / reference情報のために保持し、v1では削除またはmigrationしない。ただしpersisted exact GateはProduction Skill / Gogma Predictionのavailability、Candidate Search、Planner、Trace Replay、またはPrediction結果のauthorityに使用しない。

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
  supportsSeedSearch: boolean;
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

`supportsSeedSearch` は旧generic `SeedSearchInput` / `SeedSearchResult` の実行Capabilityだけを表し、Skill-first Identification Wizardのavailability flagとして使用しない。C5-E2C2、C5-E2C3、Wizard activation後も現行設計では `false` を維持する。Identification可否はWorker/application levelでSkill STEP 1とGogma Counter STEP 2を個別に表すconcrete availabilityとし、新しいRngEngine capability flagは追加しない。

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

Keep Bonusesにはユーザーが保持slotを選ぶ概念がない。入力した現在5slotのBonus familyをslotごとに保持し、各slotのtierだけを同じfamily内から再抽選する単一操作である。`currentBonuses` は必ず `gogma_artian` scopeの5枠であり、Engineはそのslot順を保持して抽選poolを構築する。Searchは同一Counter位置でselection branchを作らない。

`predictGogmaBonus` が返す `RestorationBonusSet` だけをamendment後の完成結果として使用する。Resetは入力武器が `normal_artian` / `gogma_artian` のどちらのscopeでも実行でき、結果を `gogma_artian` scopeへ置き換える。Keepは入力も結果も `gogma_artian` scopeである。EngineがKeep仕様を未対応の場合、`supportsKeepBonusesPrediction = false` としてRouteを生成しない。

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

## 6.4 RngMasterSubset

Web Workerへ渡すRNG用の最小マスター。

```ts
export interface RngMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[];
  lotteries: LotteryMaster[];
  bonusRanks: BonusRankMaster[];
  elements?: ElementMaster[];
  bonusTypes?: BonusTypeMaster[];
  weaponTypes?: WeaponTypeMaster[];
}
```

`elements`、`bonusTypes`、`weaponTypes` は共通interfaceではoptionalだが、Production Gogma Resetのavailability判定ではcaller supplied Masterに存在する必要がある。不足時はinput supportが `master_data_unavailable` となる。`weaponBonusDefinitions` とこれらのMasterを同じvalidated Master rootから渡し、predictor内部で別Masterを読み込まない。

`lotteries` は現行の共通interfaceに残るlegacy payloadである。Production RNGのseed式、pool order、weight、repeat penalty、skill order、semantic ID↔reference numeric mappingは、provenance付きRNG-specific reference-verified tableとEngine内部定数の責務であり、Production Predictionは `LotteryMaster` に依存しない。現行disabled `LotteryMaster` を有効化したり、Production Predictionの前提にしたりしない。reference-verified tableは参照repositoryとの一致を表し、それだけで全実ゲーム条件のgame-verifiedを意味しない。

Normal Artian Predictionが扱う復元ボーナス定義は `normal_artian` scope、Gogma Predictionが返すamendment後の復元ボーナスは `gogma_artian` scopeである。通常→巨戟化時はNormal Predictionまたは所持Normalの `normal_artian` scope 5枠をslot順のまま継承し、通常→巨戟Bonus Type MappingからRank・抽選結果・完成5枠を生成しない。

---

## 7. Counter進行

## 7.1 GogmaOperation

```ts
export type GogmaOperation =
  | { type: "reset_bonuses" }
  | { type: "keep_bonuses" };
```

Reset BonusesとKeep BonusesはそれぞれDomain Gogma Counterを1進める。通常→巨戟化はGogma streamを消費しない。`use_weapon_as_material` のRNG進行は未確認であり、この型へ含めたり0進行と推測したりしない。

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

## 8. Import仕様

## 8.1 GogmaSeedFinder Import

入力はユーザーが貼り付けるテキスト。

Parser出力。

```ts
export interface GogmaSeedFinderImportResult {
  values: {
    baseSeed?: string;
    gogmaCounter?: number;
    skillCounter?: number;
    counterGate?: number;
  };
  warnings: string[];
}
```

実装方針。

- 複数形式に対応できるようparserを分離する
- 正規表現はparser内に閉じ込める
- 読み取れた項目だけを確認画面に表示し、ユーザーが適用対象を選べる
- 読み取れない項目があっても、読み取れた項目の適用を妨げない
- 適用した各KnownValueの `source` を `"gogma_seed_finder_import"` とする
- Importに含まれない既存項目を未確定へ戻さない
- ImportでCounter Gateを取得した場合は従来どおりvalidation・保存し、将来のExport / Import round-trip対象にできる。ただしProduction active Predictionのauthorityにはしない

禁止事項。

- GogmaSeedFinderのソースコードをコピーしない
- 外部ツールの内部実装にアプリを密結合しない

## 8.2 Manual Input

ユーザーが正確に判明している値だけを直接入力する。4項目をすべて入力する必要はない。

制約。

- `baseSeed` は `normalizeSeed` で正規化して保存
- manual Base SeedはProduction runtime authorityの`ProductionRngEngine.normalizeSeed()`を保存直前に使用し、10進/16進rawを`mod 100000000`したcanonical 10進文字列として`KnownValue<string>.value`へ保存する
- 空文字は未入力として既存KnownValueを保持する。空白のみ、NaN相当、不正hex、unsigned 64-bit範囲外は`normalizeSeed()`のerrorとして保存しない
- Counterは0以上の整数のみ
- 入力した各KnownValueの `source` を `"manual"` とする
- 空欄項目を既存値から削除する操作は、明示的な「確定解除」として別に扱う
- manual Counter Gateはlegacy / diagnostic / compatibility値として保存可能だが、Production active Predictionのavailabilityまたは結果を変更しない

---

## 9. 観測検索

## 9.1 目的

実際のゲーム内抽選結果から、Seed / Counterまたは通常アーティアCounterを特定する。

初期版の主用途。

- 通常アーティアの武器種別レア8 Counter特定
- 必要に応じたRNG状態の検証

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

## 9.5 SeedSearchInput

Base Seedが不明な場合に、利用可能な観測情報からSeed候補を検索する。CounterSearchInputとは別の契約とする。

本節と9.6は旧generic Seed Search案の履歴契約であり、Production v1 Identification Wizardのcurrent contractではsupersededである。ここに残るCounter Gate候補型はexternal referenceまたは将来のgeneric search設計を記録するもので、現在のProduction availability、Skill-first Identification入力、または `RngState.counterGate` requirementとして使用しない。generic Seed Searchはinactiveで、`supportsSeedSearch = false`を維持する。

```ts
export interface SeedSearchInput {
  seedRange: SeedSearchRange;
  observations: SeedSearchObservation[];
  counterGateCandidates: number[];
  maxMatches: number;
  master: RngMasterSubset;
}

export interface SeedSearchRange {
  startInclusive: string;
  endInclusive: string;
}

export interface CounterRange {
  startInclusive: number;
  endInclusive: number;
}

export interface SeedSearchObservation {
  observation: Observation;
  knownCounter: number | null;
  counterRange: CounterRange | null;
  knownCounterGate: number | null;
}
```

制約。

- `seedRange` はRNG Engineが対応する正規化可能な範囲で、終了値は開始値以上
- 各観測は、既知Counterまたは有限の `counterRange` のどちらかを持つ
- Normal Artian観測は武器種とレア度を使用する
- Normal Artian観測の `elementId` はEngineが不要とする場合nullを許可する
- Gogma Bonus観測は武器種、必須の属性、Counter Gate候補を使用する
- Skill観測は武器種、必須の属性、シリーズ / グループスキル、Counter Gate候補を使用する
- `SeedSearchObservation.observation` はkind別Observation validationを必ず通過させる
- `counterGateCandidates` は重複のない0以上の整数とする
- `maxMatches` 到達時は検索を打ち切り、結果をtruncatedとする

## 9.6 SeedSearchResult

```ts
export interface SeedSearchResult {
  matches: SeedMatch[];
  searchedSeedRange: SeedSearchRange;
  elapsedMs: number;
  isTruncated: boolean;
}

export interface SeedMatch {
  baseSeed: NormalizedSeed;
  matchedObservationIds: string[];
  positions: SeedMatchPosition[];
}

export interface SeedMatchPosition {
  observationId: string;
  counter: number;
  counterGate: number | null;
}
```

処理方針。

- すべての観測制約を満たすSeedだけを返す
- 一意候補のみBase Seedを確定できる
- 複数候補なら観測追加または検索条件の絞り込みを促す
- 一致なしの場合は観測入力、範囲、Counter Gate候補を見直す
- RNG EngineがSeed検索に必要なPredictionを未実装なら、本番検索を無効化しFake EngineでInterfaceのみ検証する

## 9.7 C5-E2B1 Skill Identification current contract

9.5および9.6は汎用Seed Search案として保持する。Production Identification WizardのSkill-first経路には、次の専用契約を優先する。

- 入力は武器種、属性、Series SkillとGroup Skillをともに持つ連続観測列、bounded inclusive Skill Counter rangeである
- 観測1はNormal ArtianからGogma Artianへのconversion時に自動付与されたSkill、以後は連続するReset Skills結果である
- 開始Skill Counterを`S`とすると、観測`i`は`S + i`（観測1を`i = 0`とする）に対応する
- Base Seed探索domainはcanonical `0..99,999,999` inclusiveである。テストとbenchmarkでは、このdomain内のbounded inclusive Seed rangeを指定できる
- Skill Counterのformal domainと1回の検索coverageは分離する。C5-E2B1時点の初期UX推奨幅は11候補だが、永久上限ではない
- Counter Gateは入力、観測、探索対象にしない。kernelはSkill active branchを選ぶ内部代表値54を用いるが、これはactual Gate値ではなく永続化しない
- Series SkillとGroup Skillはsemantic Domain IDで受け取り、両方を完全一致させる
- 候補は`baseSeed`昇順、次に`startSkillCounter`昇順で返す
- `maxMatches`を使用する場合、現在処理中のSeedに属する全Counterを完了したprefixだけを保持・切り詰め対象とする。並列chunkは全chunk完了後にSeed range順でmergeし、Worker完了順を結果順へ使わない
- 結果は候補、実際に完了したSeed range、truncation状態を返す。RngStateへのadopt/persistはC5-E2B1の責務外である
- Production正解authorityは`ProductionRngEngine.predictSkills()`であり、compiled matcherは既存Production PRNG、Skill seed adapter、Skill table mappingとdifferential parityを維持する高速化kernelである
- kernelとProduction Worker foundationは存在するが、UIへは未接続であり、`supportsSeedSearch = false`とProduction RNG versionを維持する
- Worker requestIdはactive中の再利用を禁止し、新requestを明示的に拒否する。cancel状態はrequest-scoped tokenに保持し、旧処理のterminal completionまで解除せず、その後に破棄する
- 現在のbounded goldenはreference-generatedであり、独立したgame-verified fixtureではない。Production UI activationには後続のlive verificationが必要である
- STEP 1は完全な探索で候補がexactly oneかつnon-truncatedの場合だけ一意とする。候補が複数なら候補をユーザーに選ばせず、次のReset Skills観測を追加して同じ検索を再実行する。候補0件では観測入力、Counter range、操作順を確認し、範囲を自動拡張しない
- Skill live verificationはkernel blockerでもWizard implementation blockerでもないが、Production activation blockerである。known Base Seed / starting Skill Counter / weapon type / elementと、conversion自動Skillおよび後続Reset SkillsのSeries / Group両方を記録したgame-verified fixtureをactivation前に確認する
- 実Browser Worker benchmarkはC5-E2C8で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）。Skill live-game verificationはWizard implementation blockerではないがProduction activation blockerであり、Node benchmarkをBrowser benchmarkとして扱わない
- Production activation前にSeed rangeをcontiguous / non-overlapping chunkへ分割するmulti-worker orchestrationを実装する。chunk結果はSeed range順にdeterministic mergeし、global progress、全Workerへのcancel propagation、Worker failureの明示errorを提供する

## 9.8 C5-E2B2 Gogma Counter Identification current contract

Skill Identificationでcanonical Base Seedが確定した後のSTEP 2には、次のReset-only専用契約を使用する。

- 入力はknown canonical Base Seed、武器種、属性、連続するordered five-slot Reset観測、bounded inclusive Gogma Counter rangeである。Seed range、Keep、current bonuses、Counter Gateは入力に含めない
- 開始Gogma Counterを`G`とすると、観測`i`は`G + i`（観測1を`i = 0`とする）に対応する。各slotのsemantic Bonus Type/Rankを同位置で完全一致させる
- Counterのformal persisted domainとWizard coverageを分離する。Identification rangeはProduction PRNG block positioningが安全な`0..floor(Number.MAX_SAFE_INTEGER / 10)`内に制限する
- Counter Gate exact値は探索・保存しない。Gogma active branchの内部代表値35を用いるが、actual Gate値ではない
- callerは`weaponTypes`、`elements`、`bonusTypes`、`weaponBonusDefinitions`のMaster subsetをWorker inputへ渡す。LotteryMaster、Worker内Master load、Lottery availability gateは使用しない
- Productionのavailability filter済みcandidate order、weighted draw、exact-ID repeat penaltyを共有し、raw reference Resetだけで照合しない
- 候補は`startGogmaCounter`数値昇順で返す。`maxMatches`は最初のN候補で停止し、完了した連続Counter prefixを`searchedCounterRange`として返し、未探索範囲があればtruncatedとする
- progressは完全にaccept/rejectした`searchedCounters / totalCounters`と`matchesFound`である。Counter chunk sizeはruntime tuning値で、永続Production契約ではない
- game-verified Heavy Bowgun/Ice six-Reset fixture（Base Seed 86315169、start Counter 480）はCounter 475..485で480だけに一致する。Gate 35とfixture actual Gate 200は同じ30 ordered slotsを返す
- kernelとProduction Worker foundationは存在するが、UI/adoptには未接続である。`supportsSeedSearch = false`と`production-rng:c5-b`を維持する
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
- repositoryの `ensureInitialRngState()`でcurrent stateを取得し、Base Seed、Skill Counter、Gogma Counterだけをconfirmed / source `observation`へoverrideする。Counter Gate、notes、createdAt、その他fieldを保持し、`updatedAt`をRNG Setupと同じく更新する
- 観測回数によるCounter advanceは行わず、starting `S` / `G`をそのまま保存する。単一のvalidated RngStateを `putRngState()`へ1回渡し、保存されたRngStateを返す
- NormalArtianCounter、BuildCandidate、BuildListEntry、ProductionPlanのrepositoryには依存せず、直接mutationまたはstale書込みを行わない
- state未作成時は既存ensure契約に従ってinitial RngStateを作成してからadoptする。現repositoryにCAS/version checkはなくread-modify-put間の同時manual updateを上書きし得るため、Wizard側は同時編集を避ける。C5-E2C4だけの新concurrency機構は追加しない
- persistence failureとunexpected failureはsuccessへ変換せずcallerへ伝播する。`RngState.counterGate` schema、Production RNG semantics/version、`supportsSeedSearch = false`は変更しない
- Adoption Serviceはimplementedである。STEP 1/2 Coordinatorの契約は9.10、C5-E2C7 Wizard UIはRNG Setupへ接続済みであるが、Production Identification activationは未完了である

## 9.10 C5-E2C5 Identification Wizard Coordinator current contract

- Reactから独立した非永続application Coordinatorは、Skill Identification Worker Client、Gogma Counter Identification Worker Client、C5-E2C4 Adoption Serviceをcomposeする。CoordinatorがRngState repositoryへ直接依存せず、途中結果をIndexedDB / localStorage / RngStateへ保存しない
- STEP 1 / STEP 2とも `matches.length === 1 && isTruncated === false` だけをuniqueとする。truncatedは候補数に関係なくincompleteであり、0件、複数、incompleteを候補手動選択または自動range拡張で解決しない
- STEP 1 uniqueからcanonical `baseSeed` と `startingSkillCounter`だけを保持する。STEP 2 caller inputにSeedを持たせず、CoordinatorがSTEP 1 Seedを注入する。STEP 2 uniqueと結合したreviewは `baseSeed` / `startingSkillCounter` / `startingGogmaCounter`だけで、観測回数をCounterへ加算しない
- STEP 1再検索はSTEP 2、review、復元確認をinvalidateし、STEP 2再検索はSTEP 1 uniqueを保持してreview、復元確認をinvalidateする。request IDはstep / generation / sequenceで使い回さず、generation照合によってcancel後のlate responseがcurrent stateを上書きしない
- cancelは再実行用input snapshotと有効な上流unique結果を保持する。restartはactive Worker requestをcancelして全transient stateを破棄し、disposeはCoordinatorが所有する両Worker Clientを停止する。Workerのinvalid / unsupported / cancelled / unavailable / duplicate / unexpected errorを0件へ変換しない
- review後にユーザーが調査前ゲーム状態へ戻したことを明示確認しない限りadoptionを拒否する。adoption中および成功後の同一Coordinatorからの重複adoptionを拒否し、成功時はC5-E2C4が返す保存済みRngStateを保持する。persistence failure時はreviewと復元確認を保持して明示的retryを可能にする
- Coordinatorはimplementedである。C5-E2C6 Skill multi-worker orchestrationも既存Client interfaceの背後でimplementedであり、C5-E2C7 Wizard UIはRNG Setupへ接続済みである。実Browser Worker benchmarkはC5-E2C8で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）が、Skill live-game verificationは未完了で、Identification Production activationは完了していない。`production-rng:c5-e2`と`supportsSeedSearch = false`を維持する

## 9.11 C5-E2C6 Skill Identification Multi-Worker Orchestration current contract

- Coordinatorから見える `SkillIdentificationWorkerClient` interfaceは変更せず、Production factoryだけがmulti-worker clientを注入する。Gogma Counter Identificationはsingle Workerのままとする
- Production Worker数はlogical coreが4以上なら4、2から3なら2、それ以外または取得不能なら1とし、正式上限は4である。Seed数がWorker数未満なら空chunkを作らず、実使用Worker数をSeed数以下にする
- defaultを含むinclusive Seed rangeだけを、contiguous / non-overlapping / gap-free chunkへ分割する。Skill Counter rangeとsemantic observation inputは全childで同一である
- child request IDはparent request ID、logical request token、chunk indexから一意に生成する。同じactive parent request IDは拒否し、success / cancel / failure後は再利用できる。複数の異なるparent requestは既存Client interfaceどおり同時実行可能である
- childにはparent `maxMatches`を渡さず全chunkを完全探索させ、Seed順・Counter順でdeterministic mergeした後にglobal limitを適用する。global `searchedSeedRange` / `isTruncated`はsingle kernelが同じinputを処理した場合のcompleted Seed prefix semanticsと一致させる。truncated、欠落、overlapのあるchild resultは `incomplete_parallel_chunk` とし、partial successへ変換しない
- global progressは各childのlatest `searchedSeeds`と`matchesFound`を保持して合計し、元range全体を`totalSeeds`とする。out-of-order progressでも各child値を巻き戻さず、`searchedSeeds`を0から`totalSeeds`に収める。`matchesFound`はglobal limit前に発見済みの完全な候補数であり、`maxMatches`を超え得る
- parent cancelは全active childへ伝播し、parent Promiseをcancelled errorでrejectする。1 childのfailure / unavailableは全active siblingをcancelしてlogical request全体をfailureにし、partial matchesを返さない。cancel / failure後のlate child result/progressはparent、次request、global progressへ反映しない
- child Engine versionは全て同じProduction versionでなければならない。creation failureまたはversion mismatchはfail closedでWorker unavailableとし、生成済みchildをdisposeする。`dispose()`はactive childをcancelし、全child clientをdisposeする
- C5-E2C6はorchestrationだけであり、Skill kernel、Production RNG semantics/version、`supportsSeedSearch`、Coordinator state machine、Gogma Identification、RngState、Search、Planner、React UIを変更しない。実Browser Worker benchmarkはC5-E2C8で完了済みであり、Skill live-game verificationは引き続きProduction activation blockerである。Wizard UIはC5-E2C7でRNG Setupへ接続済みであり、development StrictMode環境のCoordinator lifecycle起因の表示不具合はC5-E2C7 lifecycle hotfixで解消済みである

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

Plannerが素材補充やRoute実行の予測を必要とする場合も注入EngineのPrediction / advance
契約だけを使用し、Bonus Type Mapping、固定Counter delta、Skill、Keep結果を推測しない。

Settings、Debug、RNG Setupのmain thread向け軽量操作は、
`ProductionRngEngine`から生成したnon-persistent runtime descriptorを共通authorityとする。
descriptorはmode `Production`、Engine version、operation-level capabilitiesを保持し、
Settingsはmode/versionとSeed Search未対応を、Debugは全capabilityを表示する。
RNG Setupは同じProduction Engine instanceの`normalizeSeed()`と`capabilities`を使用する。
具体的weapon/element/inputの対応範囲はoperation-level capabilityとは別に
`getPredictionSupport()`で判定する。Worker実行可否はEngineの存在・modeとは別概念であり、
Worker unavailableをEngine未設定として表示しない。descriptorやcapability snapshotを
BuildCandidate、BuildListEntry、ProductionPlanへ追加保存せず、永続provenanceは引き続き
`CalculationContext.rngEngineVersion`をauthorityとする。

現行Production capabilityはNormal Artian、Skill、Gogma Reset、Gogma KeepのPredictionがactive、
generic Seed Searchはinactiveである。専用Skill / Gogma Identification Workerのavailabilityは
`supportsSeedSearch`ではなくWorker/application levelで個別に判定し、`supportsSeedSearch = false`を維持する。
Production有効判定とPredictionはdisabled legacy `LotteryMaster`を要求しない。

C5-E2C3でactive Gate policyをruntimeへ統合した。Production Domain Prediction inputはcaller-supplied Gateを持たず、Production adapterがCore/reference predictorへSkill 54、Gogma 35をoperation別のactive-branch representativeとして供給する。Capability、Search、Planner、Trace Replayはpersisted exact Gateを要求せず、semantic hashもlegacy Gateを除外する。observable semantics changeとして `PRODUCTION_RNG_ENGINE_VERSION` は `production-rng:c5-e2` である。C5-E2C7でIdentification UIは実装済みだが、`supportsSeedSearch = false`とProduction Identification activation未完了を維持する。

## 10.2 Message

```ts
export type RngWorkerRequest =
  | {
      type: "counter_search";
      requestId: string;
      input: CounterSearchInput;
    }
  | {
      type: "seed_search";
      requestId: string;
      input: SeedSearchInput;
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
      type: "seed_search_result";
      requestId: string;
      result: SeedSearchResult;
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
- SeedSearchInput内の全Observationへkind別validationを適用する
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
