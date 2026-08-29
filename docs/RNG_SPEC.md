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

---

## 3. RNG状態の構成

アプリが管理するRNG状態。

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate
- 通常アーティアの武器種・レア度別Counter

Domain Modelは `DATA_MODEL.md` の `RngState` と `NormalArtianCounter` を使用する。

Base Seed、Gogma Counter、Skill Counter、Counter Gateは `KnownValue<T>` として独立に確定・未確定を保持する。RngState全体の確定フラグは使用しない。

予測前に `deriveRngCapabilities` を呼び、必要な確定値が揃った機能だけを有効化する。不足値に依存するRouteだけをskipする。

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
  normalizeSeed(input: string): NormalizedSeed;
  predictGogmaBonus(input: GogmaBonusPredictionInput): RestorationBonusSet;
  predictSkills(input: SkillPredictionInput): SkillPredictionResult;
  predictNormalArtian(input: NormalArtianPredictionInput): RestorationBonusSet;
  enumerateKeepSelections(
    input: KeepSelectionEnumerationInput
  ): KeepBonusSelection[];
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
```

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
  counterGate: number;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  operation:
    | { type: "new_gogma" }
    | { type: "reset_bonuses" }
    | {
        type: "keep_bonuses";
        selection: KeepBonusSelection;
      };
  master: RngMasterSubset;
}

export interface KeepSelectionEnumerationInput {
  sourceBonuses: RestorationBonusSet;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  master: RngMasterSubset;
}
```

Keep Bonusesの正確な選択単位がslotかBonus Typeか、それ以外かはRNG Engineの解析結果に従う。Domain側は `KeepBonusSelection` を不透明な入力として保持し、現在のType + Rankがそのまま完成結果へ残るとは仮定しない。

`predictGogmaBonus` が返す `RestorationBonusSet` だけを完成結果として使用する。EngineがKeep仕様を未対応の場合、`supportsKeepBonusesPrediction = false` としてRouteを生成しない。

## 6.2 SkillPredictionInput

```ts
export interface SkillPredictionInput {
  baseSeed: NormalizedSeed;
  skillCounter: number;
  counterGate: number;
  weaponTypeId: WeaponTypeId;
  elementId: ElementId;
  master: RngMasterSubset;
}

export interface SkillPredictionResult {
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
}
```

## 6.3 NormalArtianPredictionInput

```ts
export interface NormalArtianPredictionInput {
  baseSeed: NormalizedSeed;
  weaponTypeId: WeaponTypeId;
  rarity: NormalArtianRarity;
  normalCounter: number;
  master: RngMasterSubset;
}
```

## 6.4 RngMasterSubset

Web Workerへ渡すRNG用の最小マスター。

```ts
export interface RngMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[];
  lotteries: LotteryMaster[];
  bonusRanks: BonusRankMaster[];
}
```

Normal Artian Predictionが扱う復元ボーナス定義は `normal_artian` scope、Gogma Predictionが返す完成復元ボーナスは `gogma_artian` scopeである。通常→巨戟Bonus Type Mappingは意味上の対応とValidation補助であり、RNG EngineやSearchがMappingからRank・抽選結果・完成5枠を生成してはならない。

---

## 7. Counter進行

## 7.1 GogmaOperation

```ts
export type GogmaOperation =
  | { type: "create_gogma_from_normal" }
  | { type: "reset_bonuses" }
  | { type: "keep_bonuses"; selection: KeepBonusSelection }
  | { type: "consume_as_material" };
```

進行量はRNG Engine内で定義する。

実装上は以下の関数で一元管理する。

```ts
getGogmaCounterDelta(operation: GogmaOperation): number
```

## 7.2 SkillOperation

```ts
export type SkillOperation =
  | { type: "assign_skills" }
  | { type: "reset_skills" };
```

## 7.3 NormalArtianOperation

```ts
export type NormalArtianOperation =
  | { type: "create_normal_artian"; count: number };
```

制約。

- `count` は1以上
- 初期版では複数操作をまとめてUI実行しないが、検索内部では距離計算のため `count` を使ってよい

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

禁止事項。

- GogmaSeedFinderのソースコードをコピーしない
- 外部ツールの内部実装にアプリを密結合しない

## 8.2 Manual Input

ユーザーが正確に判明している値だけを直接入力する。4項目をすべて入力する必要はない。

制約。

- `baseSeed` は `normalizeSeed` で正規化して保存
- Counterは0以上の整数のみ
- 入力した各KnownValueの `source` を `"manual"` とする
- 空欄項目を既存値から削除する操作は、明示的な「確定解除」として別に扱う

---

## 9. 観測検索

## 9.1 目的

実際のゲーム内抽選結果から、Seed / Counterまたは通常アーティアCounterを特定する。

初期版の主用途。

- 通常アーティアの武器種・レア度別Counter特定
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

- `kind = "normal_artian"` の場合、`rarity` と `restorationBonuses` は必須。現在のEngineで属性を使わない場合、`elementId = null` を許可する
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
- `searchKind = "normal_artian_counter"` では、すべてのObservationを `kind = "normal_artian"` とし、入力の武器種・レア度と一致させる
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

---

## 10. Web Worker

## 10.1 Worker用途

以下はWeb Workerで実行する。

- Seed検索
- Counter検索
- 大量候補のRNG予測
- Search Specで定義する候補検索
- Plannerで必要な長いシミュレーション

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

`LotteryMaster` の現行 `internalValue` / `weight` は暫定スキーマである。実ゲームのRNG解析結果と合わない場合、本番アルゴリズムをLotteryMasterへ無理に合わせず、Master schemaとEngine Interfaceを見直す。

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
- Observation validationがkind別に正しく動く
- Gogma Bonus / Skill観測でelementId欠落を拒否する
- Normal Artian観測でEngineが属性不要の場合にelementId nullを許可する
- CounterSearchInputでsearchKindと異なるObservation kindの混在を拒否する
- SeedSearchInput内の全Observationへkind別validationを適用する
- KnownValueが項目ごとに独立して確定できる
- Capability判定が不足値に依存する機能だけをfalseにする
- Keep入力を完成ボーナスとして扱わない

## 12.2 Fixture Test

- 既知Seed / Counter / 武器種から期待ボーナスが一致する
- 既知Skill Counterから期待スキルが一致する
- 観測1件で複数候補になるケースを再現する
- 観測追加で一意になるケースを再現する
- 一致なしケースを再現する
- Seed検索でNormal Artian、Gogma Bonus、Skill観測を組み合わせて候補が絞られる
- 未確定Keep仕様はFake Engineだけで検証し、本番Engineを推測実装しない

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
