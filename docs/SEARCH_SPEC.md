# モンハンワイルズ 巨戟アーティア厳選Planner
## SEARCH_SPEC.md

## 1. この文書の目的

この文書は、目標武器ごとの候補検索、候補カテゴリ、作成経路、条件判定、条件緩和案、Web Worker入出力、保存方針、テスト観点を定義する。

候補検索はProduction Plannerの前段であり、Plannerは検索結果から作成リストへ追加された候補だけを入力として扱う。

---

## 2. 基本方針

- 検索はTargetWeapon単位で実行する
- 検索結果はBuildCandidateとして保存する
- 初期版では実用ラインを満たさない候補を原則表示しない
- 候補カテゴリは理想 / 実用とし、理想への近さは別属性で表す
- 通常アーティア経由と既存巨戟アーティア経由を比較する
- 対象武器種のレア8通常アーティアCounterが未確定なら新規通常アーティア経由を検索しない
- 条件は自動変更せず、緩和案だけを提示する
- 重い検索はWeb Workerで行う

---

## 3. 入力

```ts
export interface CandidateSearchInput {
  searchRunId: string;
  targetWeaponIds: TargetWeaponId[];
  routeFilter: CandidateRouteFilter;
  resultFilter: CandidateResultFilter;
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
  targetWeapons: TargetWeapon[];
  settings: CandidateSearchSettings;
  master: SearchMasterSubset;
  calculationContext: CalculationContext;
}
```

```ts
export type CandidateRouteFilter =
  | "all"
  | "normal_artian"
  | "existing_gogma";

export type CandidateResultFilter =
  | "all"
  | "ideal"
  | "practical"
  | "similar";

export interface CandidateSearchSettings {
  maxNormalAdvance: number;
  maxGogmaAdvance: number;
  maxSkillAdvance: number;
  maxCandidatesPerTarget: number;
  similarityThreshold: number;
}

export interface SearchMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[];
  weaponTypes: WeaponTypeMaster[];
  elements: ElementMaster[];
  bonusTypes: BonusTypeMaster[];
  bonusRanks: BonusRankMaster[];
  lotteries: LotteryMaster[];
  materialCosts: MaterialCostMaster[];
}
```

`createCandidateSearchInput()` は同じvalidated `MasterDataRoot`から上記subsetを構成し、
structured clone可能なrequest dataとしてWorkerへ渡す。`lotteries` はlegacy payloadとして
型に残るが、Production RNGのeligibility、input support、predictionの根拠には使用しない。

`BuildCandidate.finalBonusScope` と `finalBonuses` はRoute完了時の巨戟アーティアが実際に保持するscopeと5枠である。巨戟化だけなら `normal_artian` scopeの通常5枠をslot順のまま継承し、Reset / Keepを実行した後はRNG Engineが返した `gogma_artian` scopeの5枠を使う。SearchはBonus Type Mappingから巨戟Rankや完成5枠を推測しない。

初期値。

```ts
const defaultCandidateSearchSettings = {
  maxNormalAdvance: 5000,
  maxGogmaAdvance: 5000,
  maxSkillAdvance: 5000,
  maxCandidatesPerTarget: 200,
  similarityThreshold: 0.6,
};
```

制約。

- RngState全体の確定は要求しない
- `deriveRngCapabilities` を使い、必要値が揃ったRouteだけを検索する
- 不足Capabilityに依存するRouteは `skippedRoutes` へ理由を記録する
- Engine capabilityがある場合は、Prediction前に具体的なsemantic inputを `getPredictionSupport()` で確認する
- input supportがfalseの場合は、該当Route、operation、またはsourceの最小単位だけを正常系としてskipし、他のsupported探索を継続する
- support queryの予期しない例外、またはsupport=true確認後のPrediction例外は通常skipへ変換せず、既存Search / Worker error経路へ伝播する
- すべての選択Routeが実行不能な場合のみ検索を開始不可とする
- `targetWeaponIds` は `isEnabled = true` のTargetWeaponのみ
- `max*Advance` は1以上
- `maxNormalAdvance` は既存設定・既存UIの意味を維持した「最大forge回数」であり、最大0-based offsetではない。探索する `candidateOffset` は `0 ... maxNormalAdvance - 1`
- `maxCandidatesPerTarget` は1以上
- `similarityThreshold` は0以上1以下

---

## 4. 出力

```ts
export interface CandidateSearchResult {
  searchRunId: string;
  calculationContext: CalculationContext;
  targetResults: TargetCandidateSearchResult[];
  relaxationSuggestions: RelaxationSuggestion[];
  warnings: CandidateSearchWarning[];
  elapsedMs: number;
  isTruncated: boolean;
}

export interface TargetCandidateSearchResult {
  targetWeaponId: TargetWeaponId;
  candidates: BuildCandidate[];
  searchedRoutes: RouteKind[];
  skippedRoutes: SkippedRoute[];
}

export interface SkippedRoute {
  route: RouteKind;
  reason:
    | "normal_counter_unconfirmed"
    | "base_seed_unconfirmed"
    | "gogma_counter_unconfirmed"
    | "skill_counter_unconfirmed"
    | "no_owned_weapon_available"
    | "no_unprotected_source_weapon"
    | "normal_prediction_unsupported"
    | "gogma_prediction_unsupported"
    | "skill_prediction_unsupported"
    | "keep_prediction_unsupported"
    | "material_rng_advance_unverified"
    | "master_data_unavailable"
    | "calculation_context_incompatible"
    | "disabled_by_filter";
  detail: string;
}

export interface CandidateSearchWarning {
  targetWeaponId: TargetWeaponId | null;
  message: string;
}
```

未確定RNG値は `*_unconfirmed`、Engine機能不足は `*_prediction_unsupported`、所持source不足は `no_owned_weapon_available` / `no_unprotected_source_weapon` として区別する。値が確定していてもEngineが未対応なら予測可能とみなさず、逆にEngineが対応していても必要値が未確定なら該当RNG値のreasonを返す。

Production Searchはroute-local / operation-local supportを維持し、RngState全体のall-or-nothing availabilityを設けない。Skill-dependent routeはBase SeedまたはSkill Counter不足、Skill Prediction / concrete semantic input unsupportedでskipする。Gogma amendment routeはBase SeedまたはGogma Counter不足、Gogma Prediction / concrete semantic input / Master unsupportedでskipする。persisted Counter Gateの未設定・未確定はskip reasonにしない。Normal Counter不足は `create_normal_artian` を含むrouteだけに適用する。
`use_weapon_as_material` 後のRNG位置へ依存するRouteは、素材使用時の進行がgame-verifiedになるまで `material_rng_advance_unverified` としてskipし、0進行またはGogma +1を推測しない。

`master_data_unavailable` は、Route実行に必要なWeaponBonusDefinition、BonusRank、Material等のMaster Dataが存在しない、無効、または利用不能な場合に使用する。Production RNG poolはEngineのreference-verified tableであり、disabled LotteryMasterだけを理由にこのreasonを返さない。reference-verifiedは参照repositoryとの一致を表し、全実ゲーム条件でのgame-verifiedを意味しない。

`CandidateRouteFilter` はRouteグループを選ぶ入力であり、SkippedRouteの粒度には使用しない。`normal_artian` は `normal_artian_to_gogma` と `owned_normal_artian_to_gogma`、`existing_gogma` は4つの `existing_gogma_*` RouteKindを対象とする。`disabled_by_filter` も除外された具体的なRouteKindごとに返す。`searchedRoutes` と `skippedRoutes[].route` は同じRouteKind粒度で、同じRouteを両方へ含めない。

すべてのBuildCandidateとCandidateSearchResultに、入力の `calculationContext` をそのまま保存する。各BuildCandidateには検索開始時のRoute依存RNG状態から生成した `searchStateHash` と、Routeが参照するOwnedWeaponだけから生成した `referencedOwnedWeaponsHash` を保存する。参照武器がないRouteでは後者を `null` とする。Worker実行中に現在環境のCalculationContext、検索開始状態、またはCandidateが参照するOwnedWeapon状態が変わった場合、そのrequestIdの結果を現行候補として保存しない。

`searchStateHash` はProduction Predictionのsemantic authorityだけを含め、legacy `RngState.counterGate` のvalue / isConfirmed / sourceを含めない。Gateだけの変更によるfalse staleを発生させない。C5-E2C3でruntime hashを本契約へ同期済みである。

---

## 5. 条件判定

## 5.1 理想判定

候補が理想品になる条件。

```text
finalBonuses が target.idealBonuses と順不同で完全一致
AND
候補スキルが target.idealSkillCondition を満たす
```

Idealの5枠完全一致は `finalBonusScope = "gogma_artian"` を要求し、normal / gogmaの同名Bonus TypeまたはRankを暗黙に同一視しない。

分類。

```ts
category = "ideal"
```

## 5.2 実用判定

候補が実用品になる条件。

```text
finalBonuses がすべての practicalBonusConditions を満たす
AND
finalBonuses がすべての practicalAlternativeGroups を満たす
AND
候補スキルが target.practicalSkillCondition を満たす
```

Practical評価も `finalBonusScope` に対応するWeaponBonusDefinitionを使って、実際に保持するBonus Type / Rank / Skillだけを評価する。normal-tierをgogma-tierへ読み替えたり、Target条件を自動緩和したりしない。Bonus条件が空の場合までscopeだけで不合格にせず、定義された条件を通常どおり評価する。

分類。

```ts
category = "practical"
```

ただし理想判定を満たす場合は `ideal` を優先する。

## 5.3 近似判定

近似はCandidateCategoryではなく、実用品の理想への近さを表す別属性とする。

```text
category = practical
AND similarityScore >= settings.similarityThreshold
```

算出。

```ts
const comparableItemCount = 5 + specifiedIdealSkillCount;
const matchedItemCount =
  idealDifference.matchedBonusCount +
  matchedSpecifiedIdealSkillCount;

similarityScore = matchedItemCount / comparableItemCount;
isSimilarToIdeal =
  category === "practical" &&
  similarityScore >= settings.similarityThreshold;
```

注意。

- `specifiedIdealSkillCount` は理想条件で指定されたseries / groupの件数
- `matchedSpecifiedIdealSkillCount` はそのうち一致した件数
- ideal候補は `isSimilarToIdeal = false` とし、近似フィルタへ重複表示しない
- UIの「近似」は `category = "practical" AND isSimilarToIdeal = true` を抽出する
- 実用ラインを満たさない「惜しい候補」は初期版では原則表示しない
- 将来版で「惜しいが未実用」のカテゴリを追加する場合は別仕様とする
- `normal_artian` Filterは新規通常アーティア作成経由と所持通常アーティア経由の両方を対象とする

---

## 6. Route検索

## 6.1 通常アーティア経由

RouteKind。

```ts
"normal_artian_to_gogma"
```

必要条件。

- `canSearchNormalArtian = true`
- EngineがNormal Artian PredictionとSkill Predictionをsupportする
- Base SeedとSkill Counterが確定している。persisted Counter Gateは要求しない
- 対象武器種・対象レア度のNormalArtianCounterが確定している
- 対象レア度はv1固定の8
- 対象武器種・属性のnormal scope WeaponBonusDefinitionを利用できる。RNG poolはEngineのreference-verified tableを使い、現行LotteryMasterの有効性を要求しない
- Reset / KeepをRouteへ含める場合だけ、Gogma Prediction Capability、確定Gogma Counter、Keepの場合はKeep Prediction Capabilityを追加で要求する

検索手順。

1. `candidateOffset = 0 ... maxNormalAdvance - 1` を走査し、`candidateCounter = normalCounterBefore + candidateOffset` をTargetの `elementId` とともに通常アーティアPredictionへ渡す
2. 各候補の `forgeCount = candidateOffset + 1` とする。先行する `forgeCount - 1` 本を通常のまま見送り、候補である最後の1本だけを巨戟化する
3. 変換元の通常5枠をslot順のまま継承し、現在Skill位置を `predictSkills` して初回Series / Groupを付与する
4. conversion時のSkillがTarget条件を満たさなければ、Skill Counter +1後の位置からReset Skillsを探索する
5. 継承したnormal-tier bonusのままでTarget条件を満たさない場合、最初にReset Bonusesを行い、その後は必要に応じて追加Reset / Keepを探索する
6. TargetWeapon条件に照合し、条件を満たす場合はBuildCandidateを生成する
7. `estimatedNormalAdvance`, `estimatedGogmaAdvance`, `estimatedSkillAdvance` と実行順の `RouteOperation[]` を設定する

制約。

- 通常Counter未確定ならこのRouteはskipする
- レア6・7のCounterまたはLotteryを探索しない
- すべての武器種Counter確定を要求しない
- 検索対象はTargetWeaponの武器種だけでよい
- CreateNormalArtianOperationは `count = forgeCount`、`normalCounterAfter = normalCounterBefore + forgeCount` とし、候補位置は `candidateCounter = normalCounterBefore + forgeCount - 1` である。ConvertToGogmaOperationは最後の1本に対する1件だけを持つ
- conversion直後のCounter進行はNormal `+0`、Skill `+1`、Gogma `+0` である。Normal / Gogma Counterをpaired advanceしない
- conversionはGogma Predictionを呼ばず、通常5枠をslot順のまま継承する
- conversionは初回Skill付与を内包し、別のassign操作へ分割しない
- 操作列はconversion後にResetBonusesOperation、最初のReset以降のKeepBonusesOperation、必要なResetSkillsOperationを含めてよい
- BuildRoute.sourceOwnedWeaponIdは `null` とする
- 同一Routeのtransient Gogmaへ適用するReset / Keep / Reset Skillsは `sourceOwnedWeaponId = null` とし、未登録武器用のOwnedWeaponIdを生成しない
- normal scopeのtransient GogmaへKeepを直接適用せず、最初のBonus amendmentを必ずResetとする

## 6.2 所持通常アーティア経由

RouteKind。

```ts
"owned_normal_artian_to_gogma"
```

必要条件。

- `kind = "normal"`、`rarity = 8`、かつ非保護のOwnedWeaponが存在する
- 変換元の `weaponTypeId` と `elementId` がTargetと一致する
- EngineがSkill Predictionをsupportし、Base SeedとSkill Counterが確定している。persisted Counter GateとNormal Counterは要求しない
- Reset / Keepを含める場合だけ、Gogma Prediction Capability、確定Gogma Counter、Keepの場合はKeep Prediction Capabilityを追加で要求する

制約。

- `BuildRoute.sourceOwnedWeaponId` は変換元の所持通常アーティアIDとする
- 操作列はConvertToGogmaOperation、その後の必要なReset / Keep / Reset Skillsを含めてよいが、CreateNormalArtianOperationを含めない
- conversionは変換元の `normal_artian` scope 5枠をslot順のまま継承し、Skill Predictionで初回Skillを付与する。Gogma Predictionを呼ばない
- conversion直後はSkill Counterだけを1進め、Gogma Counterを進めない
- 変換後のReset / Keep / Reset SkillsはRoute出力を対象とするため `sourceOwnedWeaponId = null` とする
- normal scopeからの最初のBonus amendmentはResetだけを許可し、その結果を `gogma_artian` scopeとして以後のReset / Keepへ渡す
- 変換元を `referencedOwnedWeaponsHash` へ含め、保護・bonus・kindの変更または削除を `owned_weapon_changed` として検出できるようにする
- 同じ所持通常アーティアを1回の変換資源として扱い、Searchまたは将来Plannerで二重利用しない

## 6.3 既存巨戟 Reset Bonuses経由

RouteKind。

```ts
"existing_gogma_reset_bonuses"
```

必要条件。

- 対象TargetWeaponと同じ武器種・属性のOwnedWeaponがある
- またはゲーム仕様上、素材として使用可能なOwnedWeaponがある
- 起点OwnedWeaponの `isProtected = false`
- `canPredictGogma = true`
- Skill操作を含む場合は `canPredictSkills = true`

検索手順。

1. 起点OwnedWeaponを選ぶ
2. Reset Bonuses後の5枠を予測する
3. 必要に応じてSkill予測を組み合わせる
4. TargetWeapon条件に照合する
5. Reset / Skill操作を実行順の `RouteOperation[]` としてBuildRouteへ保存する
6. BuildCandidateを生成する

`isProtected = true` のOwnedWeaponを起点とするReset Bonuses Routeは生成しない。保護解除overrideは初期版に持たない。

起点の `restorationBonusScope` はnormal / gogmaの双方を許可する。normal scopeならこのResetが最初のBonus amendmentとなり、結果のscopeをgogmaへ置き換える。

利用可能な起点がprotected武器だけの場合は `no_unprotected_source_weapon` としてRouteをskipする。

## 6.4 既存巨戟 Keep Bonuses経由

RouteKind。

```ts
"existing_gogma_keep_bonuses"
```

必要条件。

- 起点OwnedWeaponがある
- 起点OwnedWeaponの復元ボーナスの一部がTarget条件に有用
- 起点OwnedWeaponの `restorationBonusScope = "gogma_artian"`
- 起点OwnedWeaponの `isProtected = false`
- `canPredictGogma = true`
- RNG Engineが `supportsKeepBonusesPrediction = true`

検索手順。

1. 起点の現在5slotをslot順のまま `predictGogmaBonus({ type: "keep_bonuses", currentBonuses })` へ渡す
2. RNG Engineが返した次の一意な5枠をTargetWeapon条件に照合する
3. 必要ならその結果を次のcurrent 5slotとしてKeep depth 2以降を時間方向に探索する
4. 必要なSkill条件を照合する
5. Keep / Skill操作を実行順の `RouteOperation[]` としてBuildRouteへ保存し、BuildCandidateを生成する

制約。

- 同一Counter位置にユーザーselectionまたはslot subsetのbranchを作らない
- Keepは現在5slotのfamilyをslotごとに保持し、各slotのtierを同family内で再抽選する
- Keep depth 1、2、...という時間方向の探索は許可する
- `isProtected = true` のOwnedWeaponを起点とするKeep Bonuses Routeは生成しない
- `isProtected = true` のOwnedWeaponを素材消費するRouteも生成しない
- Keepの起点候補がprotected武器だけの場合も `no_unprotected_source_weapon` としてskipする

## 6.5 既存巨戟 Reset Skills経由

RouteKind。

```ts
"existing_gogma_reset_skills"
```

既存OwnedWeaponの復元ボーナス5枠を変更せず、スキルだけを再付与するRouteである。

必要条件。

- 起点OwnedWeaponが存在する
- 起点OwnedWeaponのweaponTypeIdとelementIdが対象TargetWeaponと一致する
- 起点OwnedWeaponの現在のrestorationBonusesがTargetWeaponのIdealまたはPracticalボーナス条件を満たす
- `canPredictSkills = true`
- Base SeedとSkill Counterが確定し、RNG EngineがSkill Predictionとconcrete semantic inputをsupportする。persisted Counter Gateは要求しない

検索手順。

1. 起点OwnedWeaponを選ぶ
2. 起点OwnedWeaponのrestorationBonusesを完成ボーナスとして維持する
3. 現在位置から `maxSkillAdvance` までのSkill Counter位置についてRNG Engineでスキルを予測する
4. TargetWeaponのボーナス条件とスキル条件を評価する
5. IdealまたはPractical条件を満たす位置についてBuildCandidateを生成する
6. BuildRoute.operationsへResetSkillsOperationを具体的な実行順で保存する

BuildRoute例。

```ts
{
  kind: "existing_gogma_reset_skills",
  sourceOwnedWeaponId,
  operations: [
    {
      type: "reset_skills",
      sourceOwnedWeaponId,
      skillCounterBefore,
      skillCounterAfter,
    },
  ],
}
```

制約。

- 復元ボーナスのRNG予測または再抽選を行わない
- BuildCandidate.finalBonusesは起点OwnedWeaponのrestorationBonusesと一致させる
- BuildCandidate.finalBonusScopeは起点OwnedWeaponのrestorationBonusScopeと一致させる
- BuildCandidate.seriesSkillId / groupSkillIdだけをRNG EngineのSkill Prediction結果から設定する
- Search側でSkill RNGまたはCounter進行を推測しない
- `estimatedGogmaAdvance = 0`、`estimatedNormalAdvance = null` とし、`estimatedSkillAdvance` だけに必要なSkill Counter進行量を設定する
- 起点OwnedWeaponを `referencedOwnedWeaponsHash` の対象にする
- Reset Skillsはv1で非破壊操作として扱い、`isProtected = true` のPractical / Ideal武器も起点にできる
- `canPredictGogma` とKeep Prediction Capabilityは要求しない
- Skill Counter等のRNG値不足とSkill Prediction未対応を、それぞれ対応する `*_unconfirmed` / `skill_prediction_unsupported` で区別してskipする

## 6.6 既存巨戟 Mixed経由

RouteKind。

```ts
"existing_gogma_mixed"
```

Reset Bonuses、Keep Bonuses、Reset Skillsを組み合わせる場合に使用する。

起点がnormal scopeの巨戟なら、最初のBonus operationをReset Bonusesとし、その後に限りKeep Bonusesを組み合わせられる。起点がgogma scopeならReset / Keepのいずれから開始してよい。

組み合わせた操作を実行順の `RouteOperation[]` として必ず保持する。Plannerはこの操作列からPlanStepを生成し、start / target Counterだけから中間操作を推測しない。

PlannerはCandidate SnapshotのBuildRoute.operationsを書き換えない。Route内の
UseWeaponAsMaterialOperationが具体的OwnedWeapon IDを持つ場合は検索時点で要求する武器であり、
Planner-only素材割当を理由に別IDへ差し替えない。素材補充・登録・一般素材消費は別PlanStepで表現する。

Reset BonusesまたはKeep Bonusesを含むMixed Routeは、起点OwnedWeaponが `isProtected = false` の場合のみ生成する。Reset Skillsだけの場合はMixedではなく `existing_gogma_reset_skills` として生成する。

---

## 7. 候補重複排除

同一TargetWeapon内で以下が同じ候補は重複とみなす。

- `finalBonuses` のmultiset
- `seriesSkillId`
- `groupSkillId`
- `route.kind`
- Routeの起点OwnedWeapon
- `RouteOperation[]` の安定Hash

重複時の採用ルール。

1. estimatedOperationCountが少ない候補を残す
2. 必要素材数が少ない候補を残す
3. startからの総Counter進行が少ない候補を残す
4. IDが辞書順で小さい候補を残す

---

## 8. 並び順

検索結果の標準ソート。

1. category: ideal, practical
2. estimatedOperationCount昇順
3. estimatedGogmaAdvance昇順
4. estimatedSkillAdvance昇順
5. estimatedNormalAdvance昇順。ただし `null` は最後
6. similarityScore降順
7. idealDifference.matchedBonusCount降順
8. id昇順

TargetWeapon間の表示順。

1. priority降順
2. updatedAt降順
3. id昇順

---

## 9. 条件緩和案

検索結果が少ない、または非常に遠い場合、条件を自動変更しない。

RelaxationSuggestion。

```ts
export interface RelaxationSuggestion {
  id: string;
  targetWeaponId: TargetWeaponId;
  kind:
    | "lower_minimum_rank"
    | "remove_required_ex"
    | "lower_required_count"
    | "relax_skill_series"
    | "relax_skill_group"
    | "skill_match_all_to_any";
  description: string;
  patch: TargetWeaponRelaxationPatch;
  nearestCandidateDistance: number | null;
}

export interface TargetWeaponRelaxationPatch {
  practicalBonusConditions?: BonusCondition[];
  practicalAlternativeGroups?: AlternativeBonusConditionGroup[];
  practicalSkillCondition?: SkillCondition;
}
```

緩和案生成ルール。

- `minimumRank` を1段階下げる
- `requiredExCount` を1減らす
- `requiredCount` を1減らす
- 実用スキルのseries指定を外す
- 実用スキルのgroup指定を外す
- `matchMode = "all"` を `"any"` にする

制約。

- 理想条件は自動緩和しない
- 緩和案はユーザーが選択するまでTargetWeaponへ適用しない
- 緩和案ごとに再検索した場合の最短距離を表示する

---

## 10. 作成リスト

BuildCandidateは検索結果のまま変更せず、追加時に独立したBuildListEntryを生成する。

```ts
createBuildListEntry(
  candidate: BuildCandidate,
  target: TargetWeapon,
  rngState: RngState,
  normalCounters: NormalArtianCounter[],
  ownedWeapons: OwnedWeapon[],
  context: CalculationContext
): BuildListEntry;
```

生成時に、Candidate Snapshot、Target定義Hash、`candidate.searchStateHash`、`candidate.referencedOwnedWeaponsHash`、CalculationContextを固定する。追加時の現在RNG状態と現在OwnedWeaponから同じHashを再計算し、どちらかがCandidateと不一致なら追加を拒否して再検索を促す。再検索でCandidateが消えてもBuildListEntryは直ちに削除しない。

`referencedOwnedWeaponsHash` は[DATA_MODEL.md](./DATA_MODEL.md)の正規化規則に従う。参照IDはRouteとReset Bonuses、Keep Bonuses、Reset Skills、素材消費Operationから収集する。共通項目は `id`、`kind`、武器種、属性、保存中の復元ボーナス5枠順、isProtectedとし、巨戟だけシリーズスキル、グループスキル、statusを加える。name、memo、日時およびRouteに無関係なOwnedWeaponは含めない。

追加方式。

- 個別追加
- 理想候補一括追加
- 実用候補一括追加
- 理想＋実用一括追加

一括追加の制約。

- 現在表示中のTargetWeaponに対して実行する
- filterで非表示の候補を含めるかはUIで明示する
- 近似フィルタの候補は初期版では一括追加対象に含めない。個別追加のみ許可する
- 同じCandidateのBuildListEntryを重複作成しない
- Target定義変更、`searchStateHash` 不一致、`referencedOwnedWeaponsHash` 不一致、CalculationContext非互換時はBuildListEntryをstaleにする
- `searchStateHash` 不一致のstale reasonは `rng_state_changed`
- `referencedOwnedWeaponsHash` 不一致のstale reasonは `owned_weapon_changed`
- 初期版ではRoute成立に使用したRNG状態が変わった場合、安全側に倒してstaleにする
- staleなBuildListEntryはPlannerへ渡さない

---

## 11. Worker

```ts
export type SearchWorkerRequest =
  | {
      type: "candidate_search";
      requestId: string;
      input: CandidateSearchInput;
    }
  | {
      type: "cancel";
      requestId: string;
    };

export type SearchWorkerResponse =
  | {
      type: "candidate_search_result";
      requestId: string;
      result: CandidateSearchResult;
    }
  | {
      type: "progress";
      requestId: string;
      completedTargets: number;
      totalTargets: number;
      currentTargetWeaponId: TargetWeaponId | null;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
```

制約。

- UI側は最新requestId以外の結果を破棄する
- cancel後の結果は反映しない
- Worker内ではDexieに直接アクセスしない。必要な入力をmessageで受け取る
- Worker messageはstructured clone可能な `requestId` と `CandidateSearchInput` だけを保持し、メソッドを持つ `RngEngine` instanceを含めない
- Worker module内でEngineまたはEngine Factoryを取得し、Worker Handlerのdependencyとして注入する
- Production Search Worker entryはWorker内部factoryから `ProductionRngEngine` を生成する
- Search Worker ClientとBuildListのcurrent CalculationContextは `PRODUCTION_RNG_ENGINE_VERSION` を共通のRNG Engine version authorityとして使用する
- SearchのProduction接続はPlanner WorkerのProduction接続を意味しない

---

## 12. 保存方針

- Search実行ごとに `searchRunId` を発行する
- 新しい検索結果を保存する前に、同じTargetWeaponの古いBuildCandidateを削除してよい
- BuildListEntryはBuildCandidateの削除処理と分離する
- TargetWeaponを変更した場合、紐づくBuildCandidateは再検索対象、BuildListEntryはstale扱いにする
- Candidate Route成立に使用したRNG状態が変わった場合、BuildListEntryを `rng_state_changed` としてstale扱いにする
- Candidate Routeが参照する起点武器または素材武器の状態が変わった場合、BuildListEntryを `owned_weapon_changed` としてstale扱いにする
- Routeに無関係なOwnedWeaponの変更、または参照武器のname、memo、日時だけの変更ではBuildListEntryをstaleにしない
- BuildCandidateも現在RNG状態Hashと一致しなければ現行検索結果として扱わず、再検索を促す
- BuildCandidateも現在の参照武器Hashと一致しなければ現行検索結果として扱わず、再検索を促す
- CalculationContext非互換のBuildCandidateとBuildListEntryはstaleとして表示し、Planner入力に使用しない

---

## 13. テスト観点

## 13.1 Condition Test

- 理想5枠が順不同で一致する
- 実用BonusConditionが正しく判定される
- RequiredExCountが正しく判定される
- OR条件グループが正しく判定される
- SkillCondition `all` / `any` が正しく判定される
- 理想条件が実用条件より優先分類される
- PracticalとSimilarityが別軸で判定される
- 近似フィルタが `category = practical AND isSimilarToIdeal = true` だけを返す

## 13.2 Route Test

- 通常Counter未確定なら通常アーティア経由をskipする
- 対象武器種・属性のnormal scope WeaponBonusDefinitionが利用不能なら `master_data_unavailable` で通常アーティア経由をskipする
- 既存巨戟がない場合、既存巨戟Routeをskipする
- Keepがcurrent 5slotのfamilyを維持した一意の次結果を返し、同一Counterでselection branchを作らない
- Keep後の完成5枠がRNG Engine Predictionだけから生成される
- RNG EngineがKeep未対応ならRouteをskipする
- BuildRouteの操作列から実行順を復元できる
- protected武器を起点とするReset Bonuses / Keep Bonuses / それらを含むMixed Routeを生成しない
- protected武器を素材消費するRouteを生成しない
- Reset Bonuses / Keep Bonusesの起点候補がprotected武器だけなら `no_unprotected_source_weapon` を返す
- 復元ボーナス条件を満たす既存武器から `existing_gogma_reset_skills` 候補を生成できる
- Reset Skills候補のfinalBonusesが起点OwnedWeaponのrestorationBonusesと一致する
- Reset Skills候補ではSkill Prediction結果だけがseriesSkillId / groupSkillIdへ反映される
- protectedなPractical / Ideal武器からReset Skills Routeを生成できる
- Reset Skills Routeの起点武器変更でreferencedOwnedWeaponsHashが変わる
- Skill RNG値不足時とSkill Prediction未対応時を別reasonでskipする
- normal / owned-Normal Routeでnormal scopeのtransient Gogmaへ最初のReset前のKeepBonusesOperationを生成しない
- 最初のReset後はnormal / owned-Normal RouteでKeepBonusesOperationを生成できる
- 巨戟化直後の未登録武器へOwnedWeaponIdを生成せず、後続Reset / Keep / Reset Skillsをnull sourceで表す
- `candidateOffset = 0` で `forgeCount = 1`、一般のoffset kで `forgeCount = k + 1` となり、最後の1本だけを巨戟化する
- `maxNormalAdvance` が最大forge回数として働き、最大候補offsetが `maxNormalAdvance - 1` になる
- conversionでnormal bonusesをslot順のまま継承し、Skill +1 / Gogma +0になる
- conversion Skillが条件を満たす場合はReset Skillsを生成せず、不足時は次Skill位置から探索する
- 所持通常アーティア経由は保護中または武器種・属性非互換の通常アーティアを使用しない
- 所持通常アーティア経由はcreate_normal_artianを含めず、sourceOwnedWeaponIdとreferencedOwnedWeaponsHashへ元通常アーティアを設定する
- 所持通常アーティア経由のResetBonusesOperation / KeepBonusesOperation / ResetSkillsOperationは `sourceOwnedWeaponId = null` とする
- Route Filter `normal_artian` が新規通常と所持通常の2 RouteKindを対象とする
- Route Filter `existing_gogma` が既存巨戟4 RouteKindを対象とする
- RNG値不足、Engine capability不足、source不足、filter除外がそれぞれ具体的なRouteKindと異なるreasonで報告される
- 同じRouteKindをsearchedRoutesとskippedRoutesの両方へ含めない

## 13.3 Candidate Test

- 重複候補が排除される
- category順でsortされる
- estimatedOperationCountが少ない候補が優先される
- Candidate選択時にBuildCandidateを変更せずBuildListEntryが生成される
- BuildCandidateに検索開始時のsearchStateHashが保存される
- BuildCandidateにRoute参照武器だけのreferencedOwnedWeaponsHashが保存される
- 追加時の現在RNG状態HashがCandidateと異なる場合、BuildListEntry追加を拒否する
- 追加時のRoute参照武器HashがCandidateと異なる場合、BuildListEntry追加を拒否する
- 再検索でCandidateを削除してもBuildListEntry Snapshotが保持される
- Target定義またはCalculationContext変更でBuildListEntryがstaleになる
- Route成立に使用したRNG状態変更でBuildListEntryが `rng_state_changed` になる
- Route参照OwnedWeaponのボーナス、スキル、status、isProtected変更でBuildListEntryが `owned_weapon_changed` になる
- Routeに無関係なOwnedWeapon変更と、参照武器のname、memo、日時変更ではBuildListEntryがstaleにならない
- OwnedWeaponを参照しないRouteではreferencedOwnedWeaponsHashが `null` のままになる

## 13.4 Relaxation Test

- 条件を自動変更しない
- Rankを1段階下げる案を生成する
- EX必須を緩和する案を生成する
- Skill条件を緩和する案を生成する
- 緩和案適用後の最短距離を計算できる

## 13.5 Worker Test

- 複数TargetWeapon検索でprogressが返る
- cancelで結果反映を止める
- Worker errorがUIへ伝わる
- 大量検索でもUIスレッドがブロックされない
