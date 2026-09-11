# モンハンワイルズ 巨戟アーティア厳選Planner
## SEARCH_SPEC.md

## 1. この文書の目的

この文書は、目標武器ごとの候補検索、候補カテゴリ、作成経路、条件判定、条件緩和案、Web Worker入出力、保存方針、テスト観点を定義する。

候補検索はProduction Plannerの前段であり、Plannerは検索結果から作成リストへ追加された候補だけを入力として扱う。

Candidate Search再設計の背景、実測値、採用しなかった案、受け入れた制約は
[CANDIDATE_SEARCH_REDESIGN.md](./CANDIDATE_SEARCH_REDESIGN.md) に記録する。
同文書は設計記録であり仕様authorityではない。契約は本書とAGENTS.mdが定める。

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
- Normal / Gogma / Skillは独立RNG streamとして独立に探索する
- Bonus結果とSkill結果のCartesian productを列挙しない
- 現在状態が既に理想条件を満たすstreamは探索しない
- 初回検索はcanonical Idealと、その操作数以下のPractical評価を確定した時点で終了する
- 保持集合を実装上の発見順へ依存させない
- 理想品は実用ラインも必ず満たす(Ideal ⇒ Practical 包含不変条件)
- Planner競合対策の先読みは初回検索の責務ではない

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
  maxNormalAdvance: 1000,
  maxGogmaAdvance: 200,
  maxSkillAdvance: 1000,
  maxCandidatesPerTarget: 200,
  similarityThreshold: 0.6,
};
```

この初期値はB6で `5000 / 5000 / 5000` から変更した。根拠は
`docs/B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md` の実Browser Worker実測である。

```text
Normal 1000 ≈ 256 ms
Skill  1000 ≈ 325 ms
Gogma   200 ≈ 1961 ms
```

`5000 / 5000 / 5000` は近傍にIdealがあれば数ms〜数十msで終わるが、Idealが無い場合は
60秒でも完了しなかった。これは上限機能の削除ではなく初期値の変更であり、
ユーザーは詳細設定で各上限を引き上げられる。探索algorithm、canonical Ideal、
Practical horizonは変更していない。

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

### 3.1 探索量設定の正式な意味

`maxGogmaAdvance = N` と `maxSkillAdvance = M` は、いずれも
「Prediction関数の呼び出し回数」ではなく「探索対象とするCounter位置の数」を表す。

```text
maxGogmaAdvance = N
  探索対象Gogma Counter位置 : gogmaCounterBefore ... gogmaCounterBefore + N - 1
  Routeが取り得る estimatedGogmaAdvance : 0 ... N
  1 Counter位置あたりのEngine呼び出し : Reset 1回 + 生存family layoutごとのKeep 1回
```

`maxSkillAdvance = M` は現行semanticsどおり「Reset Skillsを最大M回探索する」設定である。
Skill Counter位置数そのものではない。RouteKindによって基準位置が1つずれる。

既存巨戟Route。

```text
maxSkillAdvance = M
  保存済み現在Skill     : 0操作
  Reset Skills予測位置  : skillCounterBefore ... skillCounterBefore + M - 1
  Route全体の estimatedSkillAdvance : 0 ... M
```

通常アーティア経由 / 所持通常アーティア経由。

```text
maxSkillAdvance = M
  conversion予測位置    : skillCounterBefore            (初回Skill付与、Skill Counter +1)
  Reset Skills予測位置  : skillCounterBefore + 1 ... skillCounterBefore + M
  Route全体の estimatedSkillAdvance : 1 ... M + 1
```

したがって共有Skill prediction列は `skillCounterBefore ... skillCounterBefore + M` の
`M + 1` 位置を覆う。これは「Reset上限がM + 1回になる」という意味ではない。
Reset上限は常にMであり、余分な1位置はconversionの初回Skill付与に使う。

制約。

- Gogma streamの内部ではstate searchを許可する。1 Counter位置で複数のBonus stateを評価してよい
- Skill streamはstate searchを行わない単純な線形走査とする。同一Skill Counter位置で分岐しない
- 1 Skill Counter位置あたりの `predictSkills` 呼び出しは1回
- どちらの上限も、もう一方のstreamの解の個数によって消費量が変化してはならない
- `maxNormalAdvance` はNormal streamのforge回数上限であり、Gogma / Skillの探索量を倍加させない
- `maxNormalAdvance` はpredicted variantのoffset列挙だけに適用する。6.1.1のblind Reset variantはforge数が常に1で固定であり、`maxNormalAdvance` のoffsetを消費しない
- これらの上限は探索範囲の上限であり、初回検索の終了条件ではない。終了条件は5.6に定義する

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
    | "normal_scope_keep_prediction_unsupported"
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

未確定RNG値は `*_unconfirmed`、Engine機能不足は `*_prediction_unsupported`、所持source不足は `no_owned_weapon_available` / `no_unprotected_source_weapon` として区別する。`no_owned_weapon_available` は `owned_normal_artian_to_gogma` と `existing_gogma_*` の両方で使うため、UI文言は武器種を限定しない汎用表現にする。武器種はRouteKind labelが示す。値が確定していてもEngineが未対応なら予測可能とみなさず、逆にEngineが対応していても必要値が未確定なら該当RNG値のreasonを返す。

Production Searchはroute-local / operation-local supportを維持し、RngState全体のall-or-nothing availabilityを設けない。Skill-dependent routeはBase SeedまたはSkill Counter不足、Skill Prediction / concrete semantic input unsupportedでskipする。Gogma amendment routeはBase SeedまたはGogma Counter不足、Gogma Prediction / concrete semantic input / Master unsupportedでskipする。persisted Counter Gateの未設定・未確定はskip reasonにしない。Normal Counter不足は `create_normal_artian` を含むrouteだけに適用する。
`use_weapon_as_material` 後のRNG位置へ依存するRouteは、素材使用時の進行がgame-verifiedになるまで `material_rng_advance_unverified` としてskipし、0進行またはGogma +1を推測しない。

`master_data_unavailable` は、Route実行に必要なWeaponBonusDefinition、BonusRank、Material等のMaster Dataが存在しない、無効、または利用不能な場合に使用する。Production RNG poolはEngineのreference-verified tableであり、disabled LotteryMasterだけを理由にこのreasonを返さない。reference-verifiedは参照repositoryとの一致を表し、全実ゲーム条件でのgame-verifiedを意味しない。

`CandidateRouteFilter` はRouteグループを選ぶ入力であり、SkippedRouteの粒度には使用しない。`normal_artian` は `normal_artian_to_gogma` と `owned_normal_artian_to_gogma`、`existing_gogma` は4つの `existing_gogma_*` RouteKindを対象とする。`disabled_by_filter` も除外された具体的なRouteKindごとに返す。`searchedRoutes` と `skippedRoutes[].route` は同じRouteKind粒度で、同じRouteを両方へ含めない。

すべてのBuildCandidateとCandidateSearchResultに、入力の `calculationContext` をそのまま保存する。各BuildCandidateには検索開始時のRoute依存RNG状態から生成した `searchStateHash` と、Routeが参照するOwnedWeaponだけから生成した `referencedOwnedWeaponsHash` を保存する。参照武器がないRouteでは後者を `null` とする。Worker実行中に現在環境のCalculationContext、検索開始状態、またはCandidateが参照するOwnedWeapon状態が変わった場合、そのrequestIdの結果を現行候補として保存しない。

`searchStateHash` はProduction Predictionのsemantic authorityだけを含め、legacy `RngState.counterGate` のvalue / isConfirmed / sourceを含めない。Gateだけの変更によるfalse staleを発生させない。C5-E2C3でruntime hashを本契約へ同期済みである。

---

B5-F1はCandidate classification / Search calculation semanticsを変更したため、
`CalculationContext.appSchemaVersion` を1から **2** へ更新した。その後のPlanner physical
action sharing修正により現行versionは **3** である。
単一authorityは `src/domain/models/common.ts` の
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 3` とし、Search、BuildList、Plannerと
benchmark入力のruntime creatorで共用する。これはDexieの `DATABASE_SCHEMA_VERSION = 1`
や `AppSettings.schemaVersion = 1` の変更ではない。gameVersion、Master Data version、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`、`supportsSeedSearch = false` は維持する。

version 1の既存BuildCandidate / BuildListEntry / ProductionPlanはversion 2とCalculationContext
非互換であり、現行計算結果として再利用しない。BuildListEntryは既存のstale再判定で
`calculation_context_changed` を付け、Planner入力から除外する。旧Candidateのcategoryや
Snapshotを自動変換せず、削除migrationも追加しない。必要なCandidateは再検索して取得する。
歴史データの形式検証・Export/Import契約は変更しない。

version 3ではCandidate Search semantics自体は変更しない。したがってversion 2の
BuildCandidate / BuildListEntryは、他のCalculationContext 3項目が一致する場合に限り
version 3と明示的に互換であり、再検索やBuildList再追加を必須にしない。この例外は
ProductionPlanには適用しない。

## 5. 条件判定

## 5.1 理想判定

候補が理想品になる条件。

```text
restorationBonusScope === "gogma_artian"
AND
finalBonuses が target.idealBonuses と順不同で完全一致
AND
候補スキルが target.idealSkillCondition を満たす
```

Idealの5枠完全一致は `finalBonusScope = "gogma_artian"` (実装の `restorationBonusScope`) を要求し、normal / gogmaの同名Bonus TypeまたはRankを暗黙に同一視しない。Target Domainの共通pure helper `satisfiesIdealBonuses()` を判定authorityとし、Target評価器とSearch streamの両方で使用する。scopeは必須の明示引数であり、unknown BonusRankの参照検証をscope判定より先に行う。

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
- scope mismatchはIdealDifferenceの新項目やSimilarityの減点にしない。normal scopeでIdealのBonusラベル5/5・Skillが一致しPractical条件も満たす場合、`category = practical`、`similarityScore = 1`、`isSimilarToIdeal = true` になり得る
- ideal候補は `isSimilarToIdeal = false` とし、近似フィルタへ重複表示しない
- UIの「近似」は `category = "practical" AND isSimilarToIdeal = true` を抽出する
- 実用ラインを満たさない「惜しい候補」は初期版では原則表示しない
- 将来版で「惜しいが未実用」のカテゴリを追加する場合は別仕様とする
- `normal_artian` Filterは新規通常アーティア作成経由と所持通常アーティア経由の両方を対象とする

## 5.4 Stream分離と条件の独立評価

Normal / Gogma / Skillは独立RNG streamである。

```text
create_normal_artian     Normal +forgeCount, Skill 0,  Gogma 0
convert_normal_to_gogma  Normal 0,           Skill +1, Gogma 0
reset_skills             Normal 0,           Skill +1, Gogma 0
reset_bonuses            Normal 0,           Skill 0,  Gogma +1
keep_bonuses             Normal 0,           Skill 0,  Gogma +1
```

Reset SkillsはSkill Counterだけを進め、Reset / Keep BonusesはGogma Counterだけを進める。
Skill操作がGogma Counterを進めることはなく、Gogma Bonus操作がSkill Counterを進めることもない。

5.1 / 5.2の判定式は、いずれもBonus述語とSkill述語の論理積であり、交差項を持たない。

```text
ideal(B, scope, S) = idealBonusMatch(B, scope) AND idealSkillCondition(S)
practical(B, S) = practicalBonusMatch(B) AND practicalSkillCondition(S)
```

`IdealDifference` も同様に分解できる。

```text
Bonus側 : missingBonuses, extraBonuses, matchedBonusCount
Skill側 : seriesSkillMatches, groupSkillMatches
```

`similarityScore` は両者の加算である。

```text
similarityScore =
  (matchedBonusCount + matchedSpecifiedIdealSkillCount)
  / (5 + specifiedIdealSkillCount)
```

したがってCandidate Searchは、Bonus結果とSkill結果を先に独立評価し、
最後に定数時間で合成できる。合成後の最終 `category`、`idealDifference`、
`similarityScore`、`isSimilarToIdeal` は、従来どおり既存のTarget評価器が返す値と
一致しなければならない。分解評価は最適化であり、判定semanticsの変更ではない。

Candidate Searchの制御構造は、この独立性を保存する。

- Skill探索をGogma stateの内側へネストしない
- Gogma探索をSkill結果の内側へネストしない
- `predictSkills` 呼び出し回数がGogma state数・起点武器数・normal offset数に比例しない
- `predictGogmaBonus` 呼び出し回数がSkill位置数に比例しない

## 5.5 Stream解集合とCandidate合成規則

### 5.5.1 Route base

Stream解は「Route base」単位で求める。

| RouteKind | Route base |
| --- | --- |
| `normal_artian_to_gogma` | NormalArtianCounter 1件と `candidateOffset` 1件 |
| `owned_normal_artian_to_gogma` | 起点所持通常アーティア1本 |
| `existing_gogma_*` | 起点所持巨戟アーティア1本 |

### 5.5.2 Skill stream解集合

Skill列はTargetと開始Skill Counterだけに依存し、Route baseに依存しない。

```text
skillAt[i] = predictSkills(baseSeed, skillCounterBefore + i)   i = 0 ... M
```

- この列は `(TargetWeaponId, baseSeed, skillCounterBefore)` ごとに1回だけ生成し、
  すべてのRouteKindとすべてのRoute baseで共有する
- 同一Skill Counter位置に対する `predictSkills` を2回以上呼ばない
- 既存巨戟Routeは起点武器の保存済みSkillを `skillAdvance = 0` として扱い、
  Reset Skills `r` 回目は `skillAt[r - 1]` を使う。`r` は `1 ... M`
- conversionを含むRouteは `skillAt[0]` を巨戟化時の初回Skillとして使い、
  Reset Skills `r` 回目は `skillAt[r]` を使う。`r` は `1 ... M`
- どちらのRouteKindでもReset上限はM回である。列が `M + 1` 位置を覆うのは
  conversionの初回Skill付与のためであり、Reset上限を増やさない(3.1参照)

Skill解は次の三つ組で表す。

```text
SkillSolution = { resetCount r, seriesSkillId, groupSkillId }
  既存巨戟Route          : estimatedSkillAdvance = r
  conversionを含むRoute  : estimatedSkillAdvance = r + 1
```

支配関係。同一の `(seriesSkillId, groupSkillId)` を与える解のうち、
`resetCount` が最小のものだけを初回検索の解集合に残す。
これは同一結果へ後続位置で到達する解を「永久に不要」と判定するものではない。
初回Searchの保持・出力対象から省略するという意味であり、Planner競合時の再検索では
5.6.4と[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.5に従って改めて対象になり得る。

順序。`K(c)` は次のstream-local deterministic orderingで昇順に並べる。
実装上の走査順やPromise解決順に依存してはならない。

```text
1. resetCount 昇順
2. stream-local ideal closeness 降順
     idealSkillCondition で指定された series / group のうち一致した件数
3. 安定semantic key 昇順
     stableStringify({ seriesSkillId, groupSkillId })
```

`resetCount` はSkill streamの操作数そのものなので、操作数を独立キーとして
重ねない。

### 5.5.3 Bonus stream解集合

Bonus解は開始Gogma Counter位置からの層探索で求める。

```text
depth d は Gogma Counter 位置 gogmaCounterBefore + d - 1 で行う d 回目の操作を表す
depth d の全stateは操作数 d、estimatedGogmaAdvance = d で同順位である
```

- Resetは現在Bonusを参照しないため、1 Counter位置につき1回だけ予測する
- Keepは直前Bonusのslot family layoutだけに依存する
- 同一family layoutの2 stateは、以後すべてのCounter位置で同一のKeep結果を返す
- よってfrontierはfamily layout単位で1代表へ畳んでよい
- 畳む前に、生成した各stateをそのままTarget条件へ照合し候補化する。pruningで候補を失わない

family layout dedupのlossless範囲。

```text
将来到達可能なBonus outcome について : 無損失
Route-history diversity について     : canonical representativeへ縮約する
```

Keepがtierではなくfamily layoutにだけ依存するため、同一layoutの代表1件から
到達できる完成5枠の集合は、畳まれたstateから到達できる集合と完全に一致する。
一方、同じlayoutへ至る `reset -> reset -> keep` と `reset -> keep -> keep` は
操作履歴が異なり、Plannerのaction sharing上は異なる価値を持ち得る。
この route-history diversity の損失は既知のPlanner制約として受け入れる。
「完全に無損失」とは書かない。詳細は
[CANDIDATE_SEARCH_REDESIGN.md](./CANDIDATE_SEARCH_REDESIGN.md) 2.4に記録する。

representative選択は決定的にする。depth dのstateはすべて同一操作数・同一
`estimatedGogmaAdvance` であるため、代表選択は候補の順位を変えない。
v1は直近Reset優先を採る。根拠は
[CANDIDATE_SEARCH_REDESIGN.md](./CANDIDATE_SEARCH_REDESIGN.md) に記録する。

Bonus解はscopeを含めて表す。

```text
BonusSolution = { gogmaAdvance d, restorationBonusScope, finalBonuses, operations }
```

初回Searchのstream-local retention。同一の `(restorationBonusScope, 完成5枠multiset)` を
与える解のうち、`gogmaAdvance` が最小のものだけを初回検索の解集合に残す。Skill解と同様、これは「永久に不要」ではなく
「初回Searchの保持・出力対象から省略する」という意味である(5.6.4参照)。

同じ完成5枠でもnormal scopeとgogma scopeはIdeal semanticsが異なるため別解として保持する。
full-prefix、incremental retention、差分Crossの重複判定はすべてこのidentityを使用する。
`bonusOutcomeKey` は純粋な5枠multiset key、`bonusSolutionRetentionKey` はscopeを含むkeyとする。
これはB5-F1で5.1との矛盾を補正した契約であり、depth >= 1のfamily-layout frontier dedupや
`lastResetDepth` representativeを変更するものではない。

順序。`B(c)` は次のstream-local deterministic orderingで昇順に並べる。
実装上の走査順やPromise解決順に依存してはならない。

```text
1. gogmaAdvance 昇順
2. stream-local ideal closeness 降順
     idealDifference.matchedBonusCount 相当のBonus側一致枠数
3. 素材必要量合計 昇順
     同一depthでもReset / Keepの構成比で素材が変わり得るため
4. 安定semantic key 昇順
     完成5枠multisetの正規化文字列、次に操作型列、最後にrestorationBonusScope
     異なるscopeを入力順依存にしないlocale非依存のtie-break
```

`gogmaAdvance` はBonus streamの操作数そのものなので、操作数を独立キーとして
重ねない。

conversionを含むRouteでは、最初のBonus amendmentがResetであり、Resetは現在Bonusを
参照しない。したがって `depth >= 1` のBonus解集合は、`candidateOffset` と起点所持通常
アーティアに依存しない。この集合を `(TargetWeaponId, baseSeed, gogmaCounterBefore)` ごとに
1回だけ生成し、すべてのRoute baseで共有する。`depth = 0`(継承した通常5枠そのもの)だけが
Route baseごとに異なる。

#### 5.5.3.1 canonical amendment historyの観測記録

Bonus streamは各stateについて、そのcanonical operation historyが通過した予測5枠を
observational recordとして保持する。depth `d`、`lastResetDepth = r` のstateでは、
depth `1 ... r` がReset結果、`r + 1 ... d` がKeep結果であり、これは
`bonusAmendmentOperations()` が再構成する操作列と同じ履歴である。

- 記録はstate生成時のchainとして保持し、`finalBonuses` からの逆算や、同一depthの
  別branch結果の流用を行わない
- 記録は `RouteBonusSolution` の `operations` とindexが1対1で対応し、Candidateでは
  `BuildCandidate.bonusAmendmentTrace` として `operationIndex` 付きで保持する
- 記録は観測情報であり、stream-local retention key、5.5.3の順序、family-layout frontier
  dedup、canonical Ideal選択、Practical dominance、Candidate semantic identityの
  いずれの入力にもならない
- Reset結果は現在Bonusに依存しないため、depth `j <= r` の記録はdepth `j` のReset結果
  そのものである。frontier reductionはこの対応関係を変えない

`ConstrainedCandidate` はこの観測記録を持たない。5.6.7のconstrained enumerationは
Planner向けのSearch-domain semantic resultであり、表示用traceを含まない。

### 5.5.4 Cross規則

Cross規則は、初回Candidate Searchを高速かつboundedに保つための初期探索policyである。
Plannerまで含めた完全探索ではない。Bonus側代替とSkill側代替の両方が同時に必要になる
Planner競合は、5.6.5のPlanner-driven constrained re-searchで必要時に解決する。
軸外pairの評価は5.6.7のconstrained enumerationだけの拡張であり、本節の初回合成規則を
変更しない。

category `c` ごとに、その category のBonus述語を満たす解を5.5.3のorderingで並べたものを
`B(c)`、Skill述語を満たす解を5.5.2のorderingで並べたものを `K(c)` とする。
`b0` / `k0` は各streamのdeterministic orderingで一意に決まり、
RouteKindの評価順やPromiseの解決順に依存してはならない。

```text
b0 = B(c)[0]      Bonus anchor
k0 = K(c)[0]      Skill anchor

Candidate(c) = { (B(c)[i], k0) | i = 0 ... |B(c)| - 1 }
             ∪ { (b0, K(c)[j]) | j = 0 ... |K(c)| - 1 }
```

生成件数は `|B(c)| + |K(c)| - 1` であり、`|B(c)| × |K(c)| ` ではない。

規則。

- `B(c)` または `K(c)` が空なら、そのRoute baseからcategory `c` の候補を生成しない
- Bonus軸の候補はSkill anchorを固定し、Skill軸の候補はBonus anchorを固定する
- 両軸から外れた `(B(c)[i], K(c)[j])`(`i > 0` かつ `j > 0`)は生成しない
- Bonus候補 × Skill候補の直積を列挙しない。総操作数順のpriority queueなどで
  同じ直積を遅延展開する設計も禁止する
- 固定小定数の対角バンド(`R = 2` など)も追加しない
- 合成した操作列は「Bonus操作列 → Skill操作列」の順で1本の `BuildRoute.operations` へ記録する。
  Counterはstreamごとに独立に保持し、`estimatedGogmaAdvance = d`、
  `estimatedSkillAdvance` は既存巨戟Routeで `r`、conversionを含むRouteで `r + 1` とする
- 合成後の `category` は必ず既存のTarget評価器が決定する。上記の `c` は生成対象を選ぶための
  分類であり、最終categoryを上書きしない。理想条件を満たす合成結果は `ideal` を優先する
- 軸候補の重複と、`ideal` 系列と `practical` 系列が同じ操作列を生む場合の重複は、
  7章の既存重複排除で1件へ畳む
- `resultFilter` は出力段のフィルタであり、stream探索・解集合・合成規則へ影響しない。
  `similar` を選んでもideal解の探索を省略しない

Cross規則と5.5.2 / 5.5.3のstream-local retention / orderingはB3で実装済みである。
5.5.6のPractical dominance、5.5.7のIdeal枠確保、5.6.2の実探索終了条件、5.6.3のrun非依存canonical IdealはB4で実装済みである。

### 5.5.5 操作0の扱い

- Bonus stream `d = 0` は「現在の5枠をそのまま使う」ことを表す
- Skill stream `k = 0` は「現在のSeries / Group Skillをそのまま使う」ことを表す
- 既存巨戟Routeで `d = 0` かつ `k = 0` になる合成は、`BuildRoute.operations` が空になり
  Domain検証を通らないため候補化しない。その武器は既にTargetを満たしており、
  Plannerは所持巨戟アーティアからTarget充足を直接導出する
- 通常アーティア経由と所持通常アーティア経由は `create_normal_artian` /
  `convert_normal_to_gogma` を必ず含むため、`d = 0` かつ `k = 0` でも操作列は空にならない

### 5.5.6 Practical候補の保持とdominance規則

Practicalは「最良の1件だけ」に絞らない。
5.5.6.0のhorizon内で到達可能なPractical候補のうち、
明確に他候補の下位互換でないものは列挙する。

#### 5.5.6.0 Practical保持のdeterministic search horizon

保持範囲を実装上の発見順へ依存させてはならない。best-first、branch-and-bound、
RouteKindの評価順、Promiseの解決順のいずれを変えてもPractical集合が変わらないこと
を契約とする。

```text
canonical Ideal の estimatedOperationCount = D

初回Searchでは
  estimatedOperationCount <= D
で到達可能なPracticalをPractical保持の評価対象とする。

その集合へ5.5.6の保守的dominanceを適用し、非劣位Practicalを保持する。
```

- 操作数がちょうど `D` のPracticalも評価対象に含める
- canonical Idealが探索上限内に存在しない場合は、設定された探索範囲
  (`maxGogmaAdvance` / `maxSkillAdvance` / `maxNormalAdvance`)内で評価できた
  Practicalへ同じ非劣位保持規則を適用する
- 「たまたまIdealを先に発見したので、それより近いPracticalを評価しなかった」
  という結果を許可しない
- canonical Ideal確定後に `D` を超える遠方Practicalまで探索を広げる必要はない
- 5.5.7の `maxCandidatesPerTarget` によるbounded保持契約は維持する

このhorizonは探索の停止条件ではなく保持の評価範囲である。
探索自体の終了条件は5.6.2に従う。

候補Aを候補Bで削除してよいのは、BがAに対して**確実なPareto dominance**を持つ場合だけである。
判定は保守的に、狭く定義する。

BがAを支配するのは、次のすべてを満たす場合に限る。

```text
1. Bonus結果として B >= A   (5.5.6.1 のrank multiset比較)
2. Series Skill と Group Skill が一致
3. sourceOwnedWeaponId が一致
4. destructive / non-destructive の別が一致
5. estimatedOperationCount   B <= A
6. estimatedGogmaAdvance     B <= A
7. estimatedSkillAdvance     B <= A
8. estimatedNormalAdvance    B <= A   (両方 null か、両方数値)
9. 素材が component-wise で B <= A   (5.5.6.2)
10. 上記のいずれかで B < A   (完全同値なら7章の重複排除に委ねる)
```

```text
削除してよい例
  A: 攻撃II を含む Practical
  B: 攻撃III を含む Practical
  同一Bonus Type構成 / 同一Skill / 同一起点 / 操作・Counter・素材でBが不利でない
  -> A を落として B だけ残す
```

#### 5.5.6.1 Bonus rank dominanceはmultisetで判定する

完成Bonusはmultisetとして評価し、slot順そのものに完成性能上の意味を持たせない。
したがってrank比較をslot indexへ依存させてはならない。

判定手順。

```text
1. A と B の 5枠を bonusTypeId ごとにグループ化する
2. bonusTypeId の集合と、各 bonusTypeId の出現数が A と B で一致しない場合
   -> 比較不能 (異なるBonus Type構成)
3. 各 bonusTypeId について、Master の rank ordering で正規化した
   rank vector を降順ソートして sortedRanks(A) / sortedRanks(B) を作る
4. すべての bonusTypeId、すべての i について
       sortedRanks(B)[i] >= sortedRanks(A)[i]
   が成立し、かつ少なくとも1要素で厳密に上位なら B >= A かつ B != A
5. すべて同位なら Bonus結果として同値
6. どこかで sortedRanks(B)[i] < sortedRanks(A)[i] なら比較不能
```

```text
例 (bonusTypeId = 攻撃 の枠が2つ)
  A: [III, II]   B: [EX, II]   -> B が上位
  A: [III, II]   B: [EX, I ]   -> 比較不能 (2要素目でBが下位)
```

Masterのrank orderingで安全に比較できない `ArtianBonusScope` / `bonusTypeId` が
ある場合は、推測せず比較不能とする。異なるBonus Type構成は従来どおり比較不能である。

#### 5.5.6.2 素材はmaterialId単位のcomponent-wise比較で判定する

素材必要量の**合計個数**だけで優劣を判定してはならない。
異なる `materialId` 同士の価値をSearchが推測してはならない。

```text
全 materialId について
  quantity(B, materialId) <= quantity(A, materialId)
```

出現しない `materialId` の quantity は 0 として扱う。

```text
A: material.X ×2
B: material.X ×1
-> B が素材面で上位

A: material.X ×2
B: material.Y ×1
-> 比較不能

A: X×2, Y×1
B: X×1, Y×2
-> trade-off なので比較不能
```

5.5.3のstream-local anchor orderingにある「素材必要量合計」は、
同一 `gogmaAdvance` かつ同一 ideal closeness の解を決定的に並べるための
tie-breakにすぎない。**Practical dominanceの判定には使用しない**。
両者は別物である。

比較不能として両方保持する例。

```text
A: 会心率EX を含む Practical
B: 属性EX   を含む Practical
-> Bonus Type構成が異なる。ゲーム性能上の優劣を仕様から決定できない
```

禁止事項。Search側が次のような主観的・未定義な性能比較を行ってはならない。

- 会心率の方が属性より強い
- 攻撃の方が会心より価値が高い
- あるSeries SkillがほかのSeries Skillより優れている

次の場合は原則としてすべて比較不能とする。

- 異なるBonus Type構成
- 異なるSkill構成
- 異なるsourceOwnedWeapon
- destructive / non-destructive が異なる
- 一方がCounter上近いが、もう一方が結果として強い

同一の完成結果が異なるCounter位置に存在する場合(たとえば `+10` と `+80`)、
`+10` を `+80` の完全上位互換として扱ってはならない。Plannerは
`counterBefore` と runtime counter の一致を要求するため、両者はPlanner上
異なる意味を持つ。初回検索が `+80` を出力しないのは支配されたからではなく、
初回Searchの保持・出力対象から省略しているからである(5.6.4参照)。

### 5.5.7 `maxCandidatesPerTarget` の意味

`maxCandidatesPerTarget` は、Idealを探す前に検索自体を止める件数として扱わない。

理想的な保持内容は次である。

```text
保持 = 5.5.6.0のhorizon内の非劣位Practical + canonical Ideal
```

`maxCandidatesPerTarget` は非劣位Practicalが非常に多い場合の安全上限として機能する。
horizonの決定(5.5.6.0)には関与せず、horizon内で確定した非劣位集合を
出力段でboundedにするだけである。`maxCandidatesPerTarget` に達したことを理由に
horizon内のPractical評価を打ち切ってはならない。

規則。

- Practical保持集合を `maxCandidatesPerTarget` でboundedにする
- Practical保持集合が上限に達しても、Ideal探索は5.6の終了条件または探索上限まで継続する
- Idealを発見した場合は必ず結果へ含める。上限超過時は8章の並び順で最下位のPractical候補を
  置換する。これによりIdeal用の枠を常に確保する
- Practicalを溢れさせる場合は8章の並び順で下位から落とす
- `maxCandidatesPerTarget` の型・既定値・検証範囲は変更しない

`isTruncated` は、`maxCandidatesPerTarget` によるbounded retentionで、
現在の `resultFilter` に該当する保持候補が1件以上除外された場合にtrueとする。
horizon / dominance適用後のcap前保持集合をfilterした件数と、cap後の集合を
同じfilterで絞った件数を比較する。Ideal枠確保によるPracticalの除外も含む。
filterは探索・保持集合・終了位置に影響しない。

canonical Idealによる探索終了、Practical horizon外、dominance、
stream-local retention、family frontier dedup、Cross policyによる省略は
truncationに含めない。

## 5.6 探索継続と初回Search終了条件

### 5.6.0 Candidate SearchとPlannerの責務分離

```text
Candidate Search
  このTarget単体を現在のRNG状態から作るなら、
  近い位置にどの実用品・理想品があるかを高速に求める

Planner
  複数Targetを同時に作る場合に、Counter操作をどう両立させるかを決める
```

Candidate Searchは、Plannerで将来競合する可能性があるという理由だけで、
次を初回検索で先読みしない。

- 2個目、3個目の同一Ideal
- 遠いCounter位置の代替Ideal
- Bonus代替 × Skill代替のCartesian product

複数Target間でCounter競合が実際に発生した場合にだけ、Plannerが必要に応じて
再検索を要求する(5.6.5)。

### 5.6.1 現在状態別の探索継続規則

BonusとSkillで同一の原則を適用する。

| 現在状態 | そのstreamの将来探索 | 生成できる解 |
| --- | --- | --- |
| Ideal条件を満たす | 不要。探索を終了してよい | 操作0のIdeal解 |
| Practicalのみ満たす | Ideal到達可能性を探すため継続する | 操作0のPractical解と、探索で見つかるIdeal解 |
| 未達 | Practical / Ideal到達位置を探索する | 探索で見つかるPractical / Ideal解 |

Ideal既達成streamの早期終了は、[DATA_MODEL.md](./DATA_MODEL.md) 8.1の
Ideal ⇒ Practical 包含不変条件に依存する。Idealを満たす現在状態はPracticalも必ず
満たすため、そのstreamについて将来探索で得られる上位categoryは存在しない。

**実装順の制約。** この早期終了はTargetWeapon validationが包含を保証してから
実装する。validation有効化前に導入すると、包含を満たさない不正Targetに対して
Practical候補を取りこぼす。Phase依存は
[CANDIDATE_SEARCH_REDESIGN.md](./CANDIDATE_SEARCH_REDESIGN.md) 4章に従う。
このvalidationはB7で実装済みであり、Skill streamの早期終了はB1で実装済みである。
Bonus streamの早期終了はB2で実装済みである。

補足。

- 「Ideal条件を満たす」はBonus streamでは `restorationBonusScope === "gogma_artian"`
  AND `idealBonuses` との5枠multiset完全一致、
  Skill streamでは `idealSkillCondition` を指す
- 起点巨戟の現在Skillが `idealSkillCondition` を満たす場合、その武器について
  `reset_skills` の探索を行わず `maxSkillAdvance` を消費しない
- 起点巨戟の現在Bonusがgogma scopeで `idealBonuses` と完全一致する場合、その武器について
  Bonus amendmentの探索を行わず `maxGogmaAdvance` を消費しない
- normal scopeではラベル5/5が一致してもBonus Idealではない。conversion直後や継承Bonusを
  持つ既存巨戟について、Reset PredictionがsupportedならGogma-scope Idealの探索を継続する
- 片方のstreamがIdeal既達成でも、もう片方のstreamの探索は独立に継続する
- Practicalのみ満たす状態から探索を打ち切ると、Ideal候補を失うため打ち切らない

### 5.6.2 初回Candidate Searchの終了条件

初回Candidate Searchは、canonical Idealを1件確定し、その操作数 `D` までの
Practical評価を完了した時点で通常探索を終了する。

```text
探索開始
  -> canonical Idealを確定 (操作数 D)
  -> estimatedOperationCount <= D のPracticalを評価対象として確定
  -> 5.5.6のdominanceを適用して非劣位Practicalを保持
  -> Idealを保持
  -> 通常探索終了
```

終了はcanonical Idealの発見だけでは成立しない。`D` 以下のPractical評価対象が
すべて確定していなければならない。best-firstで操作数昇順に走査する実装なら、
`D` を確定した時点でこの条件は自動的に満たされる。branch-and-bound実装なら、
上界 `D` の枝刈りを維持したまま `D` 以下の枝を走査し切る必要がある。

`maxGogmaAdvance` / `maxSkillAdvance` / `maxNormalAdvance` は探索範囲の上限であり、
Idealが見つからない場合の停止条件として機能する。Idealが見つかった場合は
上限に達する前に終了してよい。

### 5.6.3 canonical Idealの定義

「最初のIdeal」は、実装上たまたま先に評価されたRouteKindや、最初に解決した
Promiseという意味であってはならない。次の全順序で最小のIdeal候補を指す。

```text
canonical Ideal = 全Route base・全RouteKindを通じたIdeal候補のうち、
                  8章の標準ソート順で最小のもの
```

8章の標準ソート順はIdeal候補間では実質的に次へ縮退する。

```text
1. estimatedOperationCount 昇順
2. estimatedGogmaAdvance   昇順
3. estimatedSkillAdvance   昇順
4. estimatedNormalAdvance  昇順。null は最後
5. candidateStableKey 昇順
```

`category` はIdealで同一、`similarityScore` と `matchedBonusCount` はIdeal候補間で
最大値に張り付くため、順位はこの5キーで決まる。

#### canonical Idealのstable tie-break

最後のtie-breakに `BuildCandidate.id` を使ってはならない。現行実装のCandidate IDは
run間で安定しない。

```text
SearchPageは検索ごとに searchRunId = crypto.randomUUID() を生成する
createCandidateFromPrediction() の semanticHash は searchRunId を含む
BuildCandidate.id はその semanticHash から生成される
```

したがって同一入力でも run が変わればCandidate IDが変わり、canonical Idealの
一意性が壊れる。`searchRunId` / `createdAt` / `BuildCandidate.id` などの
run依存値を含まない `candidateStableKey` を使う。

```text
candidateStableKey = stableStringify({
  finalBonuses,              // 正規化したBonus multiset
  restorationBonusScope,
  seriesSkillId,
  groupSkillId,
  routeKind,                 // route.kind
  sourceOwnedWeaponId,       // route.sourceOwnedWeaponId
  operations,                // route.operations を実行順のまま
})
```

規則。

- `finalBonuses` は7章の重複排除と同じ正規化multisetを使い、slot順の差だけで
  順位が変わらないようにする
- 文字列比較はlocale非依存とし、既存の `stableStringify` / semantic hashing 規則と
  整合させる
- `searchRunId`、`createdAt`、`BuildCandidate.id`、`calculationContext` を含めない
- **同一入力なら検索runを跨いでも同じcanonical Idealを選ぶ**ことを契約とする

B4でcanonical orderingへ `candidateStableKey` を導入済みである。
B6-F1で7章の重複排除と8章の表示用ソートの最終tie-breakへも適用し、
Candidateの最終出力順からrun依存値を排除した。
`BuildCandidate.id` の生成実装は変更していない。

実装要件。

- 探索は総操作数の下界で枝刈りしながら進め、確定したIdealがcanonical orderで
  最小であることを保証する。best-firstでも、暫定最良の総操作数を上界とする
  branch-and-boundでもよい
- 「先に見つかった方」を採用するincidental traversal orderに依存してはならない
- 具体的な探索スケジューリングは後続Phaseで設計してよいが、この一意性契約は変えない

### 5.6.4 同一結果の後続Counter位置

Plannerは `RouteOperation.counterBefore` とruntime counterの一致を要求するため、
同じ完成結果でも `Skill +10` と `Skill +80` はPlanner上で異なる意味を持つ。

したがって次のように仕様化する。

```text
誤 : +80 は +10 に支配されるので永遠に不要
正 : 後続Counter位置は、初回Searchの保持・出力対象から省略できるが、
     Planner上恒久的に支配された解ではない
```

「省略」には2種類あり、どちらも「支配」ではない。

| 位置 | 状態 | 例 |
| --- | --- | --- |
| canonical Idealより後ろ | 本当に未探索 | Ideal `+10` を確定して終了したため `+80` を評価していない |
| canonical Idealより手前 | 探索済みだが保持集合から省略 | 同一結果のPractical `+2` と `+4` のうち、5.5.2 / 5.5.3のstream-local retentionで `+2` だけを残した |

```text
Practical同一結果 +2      -> 保持
Practical同一結果 +4      -> 評価済みだが出力しない
Ideal              +10    -> 保持して終了
```

初回検索が `+10` のIdealを見つけた後、同一結果の `+80` まで探索を継続する必要はない。
省略された後続位置はPlanner競合が実際に発生した場合に、5.6.5の再検索で必要に応じて調べる。

重要。stream-local retentionの「同一結果なら最小advanceだけ保持」は初回Search専用の
pruningである。Planner制約下で使用不能なearlier solutionが、実行可能な
later solutionを恒久的に隠してはならない。詳細は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.5に定義する。

### 5.6.5 Planner競合時の再検索

Counter競合の解決はPlannerの責務である。詳細な契約は
[PLANNER_SPEC.md](./PLANNER_SPEC.md)に定義する。Candidate Search側の要件は次である。

- Candidate Searchは、Planner制約を受け取って候補を順次提示できる形を将来持つ
- Candidate Search自身にPlannerのcounter precondition / action identity /
  shareable operation 判定を複製しない
- 再検索の開始位置を `conflictingCounter + 1` のような単純な後方検索へ固定しない。
  競合位置より前に利用可能なPracticalが存在し得るため、元のSearch / RNG起点を
  基準に再評価する
- Counter位置が一致することだけを理由に候補を除外しない。同一Counter位置でも
  Plannerがshareableと判定するoperationは共同実行できる

B8-AでPlanner-driven constrained re-searchの正式契約を確定した。Planner側の契約は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2、Search Domain側のenumeration契約は5.6.7に
定義する。実装はB8-B1以降で行う。

### 5.6.6 `resultFilter` の位置づけ

`resultFilter` は最終表示・出力のフィルタである。

- `ideal` / `practical` / `similar` のいずれを選んでも、stream探索の意味、
  Ideal探索の継続規則、5.6.2の終了条件は変わらない
- `practical` や `similar` を選んでもIdeal探索を打ち切らない
- `ideal` を選んでもPractical保持集合の構築を省略しない

### 5.6.7 Planner-driven constrained candidate enumeration

B8-Aで確定した契約である。実装はB8-B1で行う。Planner側の契約は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2に定義する。

#### 境界

通常の `searchCandidates()` とは別のAPI境界へ置く。概念APIは次とする。

```ts
export interface ConstrainedEnumerationBounds {
  maxNormalForgeCount: number;
  maxGogmaAdvance: number;
  maxSkillResetCount: number;
  maxOffAxisPairEvaluations: number;
}

export interface ConstrainedSearchOrigin {
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
  targetWeapons: TargetWeapon[];
  master: SearchMasterSubset;
  calculationContext: CalculationContext;
}

export interface ConstrainedCandidateSearchInput {
  origin: ConstrainedSearchOrigin;
  targetWeaponId: TargetWeaponId;
  bounds: ConstrainedEnumerationBounds;
}

export interface ConstrainedCandidate {
  targetWeaponId: TargetWeaponId;
  category: CandidateCategory;
  finalBonuses: RestorationBonusSet;
  restorationBonusScope: RestorationBonusScope;
  seriesSkillId: SeriesSkillId | null;
  groupSkillId: GroupSkillId | null;
  route: BuildRoute;

  estimatedOperationCount: number;
  estimatedGogmaAdvance: number;
  estimatedSkillAdvance: number;
  estimatedNormalAdvance: number | null;
  requiredMaterials: MaterialRequirement[];

  idealDifference: IdealDifference;
  similarityScore: number | null;

  searchStateHash: string;
  referencedOwnedWeaponsHash: string | null;
  calculationContext: CalculationContext;
}

export interface ConstrainedEnumerationSummary {
  examinedCandidates: number;
  evaluatedOffAxisPairs: number;
  exhausted: boolean;
  stoppedByBound: boolean;
}
```

具体的な名称はB8-B1実装時に微調整してよいが、意味を変更しない。

- Search Domain APIはPlannerのConflict DTOを受け取らない。counter precondition /
  action identity / shareability / inventory conflict / source mutation /
  `PlannerConflictResolution` の判定をSearch側へ複製しない
- `exhausted` と `stoppedByBound` を区別する。bound到達をexhaustionとして報告しない

#### originの意味

`origin` は `CandidateSearchInput` ではない。constrained enumeration専用の
概念origin DTOとする。

「元のSearch / RNG起点」が指すのは次である。

```text
正 : Planner計算開始時のcurrent validated Search / RNG snapshot
誤 : 過去のUI Candidate Search request
```

過去のUI requestを `origin` にしてはならない。`CandidateSearchInput` は
`searchRunId`、`routeFilter`、`resultFilter`、`settings` を含むUI一時requestであり、
永続化されていない。BuildListEntryが保持するのは `searchStateHash` /
`referencedOwnedWeaponsHash` というhashだけで、元のrequestは現行のPlanner / BuildList
から復元できない。

したがって `ConstrainedSearchOrigin` は、Planner計算開始時点で既にvalidation済みの
現在状態から構成する。

```text
rngState
normalCounters
ownedWeapons
targetWeapons        (対象TargetWeaponを含むvalidated集合)
master               (SearchMasterSubset)
calculationContext
```

これは `CandidateSearchInput` の部分集合ではあるが、UI一時filterと `searchRunId` を
持たない別の型である。Planner入力と同じ現在状態から作るため、enumeratorが再評価する
起点はPlanner初期Stateの起点と一致する。

`origin` は5.6.5および[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.1の「元のSearch / RNG
起点から再評価する」を満たす。競合位置より後ろへ後方固定しないという契約は変わらない。

#### route policy

B8 constrained re-searchは過去のUI一時filterを継承しない。正式policyは次とする。

```text
route scope     = 現時点で成立する全Search route
resultFilter    = 適用しない
similar filter  = 適用しない
maxCandidates   = 適用しない
advance bounds  = ConstrainedEnumerationBounds をauthorityとする
```

- `CandidateRouteFilter` を `origin` へ持たせない。現在のRNG値、Engine capability、
  input support、所持武器から成立するRouteをすべて対象にする
- `CandidateResultFilter` を適用しない。`ideal` / `practical` / `similar` の
  出力filterはUI表示用であり、Plannerの共存可能性判定を狭めてはならない
- `isSimilarToIdeal` によるsimilar filterを適用しない
- `maxCandidatesPerTarget` を適用しない。件数上限は初回Searchの保持policyであり、
  constrained enumerationの上限は `ConstrainedEnumerationBounds` が担う
- 探索範囲の上限は `ConstrainedEnumerationBounds` だけをauthorityとする。
  `CandidateSearchSettings` を参照しない

TargetのIdealまたはPractical条件を満たすCandidateだけをyieldする契約は維持する。
route policyが広がっても、条件を満たさないCandidateはyieldしない。

このpolicyは通常Candidate Searchの `routeFilter` / `resultFilter` 契約
(3章 / 4章 / 5.6.6)を変更しない。両者は別の境界である。

#### enumerator outputはBuildCandidateではない

B8-B1のenumeratorは `BuildCandidate` を直接yieldしない。Search Domainのtransientな
semantic resultである `ConstrainedCandidate` をyieldする。

理由。`BuildCandidate` は `id` / `searchRunId` / `createdAt` / `isSimilarToIdeal` /
`similarityScore` を必須とし、通常Searchのcandidate factoryは
`CandidateSearchInput.searchRunId` と `CandidateSearchSettings.similarityThreshold`
から埋める。一方 `ConstrainedSearchOrigin` は意図的に `searchRunId` / `settings` /
`routeFilter` / `resultFilter` を持たない。したがってenumeratorは `BuildCandidate`
を完成させられない。

次のrun / persistence metadataをB8-B1 enumeratorのsemantic resultへ混ぜない。

```text
BuildCandidate.id
BuildCandidate.searchRunId
BuildCandidate.createdAt
random / request ID
Clock
enumeration ordinal
```

`ConstrainedCandidate` は `similarityScore` を持つが `isSimilarToIdeal` を持たない。
`isSimilarToIdeal` はthresholdを適用した表示メタデータであり、materialize時に決まる。

具体的な名称と必要最小fieldはB8-B1で微調整してよいが、この分離を変更しない。
通常の `BuildCandidate` 形状への変換はB8-Cのdeterministic materializerが行う
([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.13)。

#### materialize時の契約

B8-Cのmaterializerは次で `BuildCandidate` を組み立てる。

```text
BuildCandidate.searchRunId
  = deterministic constrained search identity

BuildCandidate.id
  = deterministic constrained search identity
    + Candidate semantic meaning
    から安定生成

BuildCandidate.createdAt
  = PlannerClock

similarityScore
  = 既存Similarity計算式 (5.3)

isSimilarToIdeal
  = 現行B6既定similarity threshold 0.6 を使って算出
```

`0.6` は表示メタデータ `isSimilarToIdeal` を埋めるためだけに使う。次には使用しない。

```text
Candidate yield可否
Candidate enumeration ordering
route scope
探索終了
探索範囲
off-axis評価
Planner coexistence
```

すなわち `CandidateSearchSettings` は、constrained enumerationのfilter authorityでも
extent authorityでもない。この点は前掲のroute policyと同じである。

通常Candidate Searchの `searchRunId` 契約と `BuildCandidate` ID生成規則は変更しない。
constrained materializerは通常Searchのcandidate factoryを流用せず、専用の
deterministicな経路で組み立てる。

#### boundsの責務分離

`ConstrainedEnumerationBounds` はenumeratorが消費する上限だけを持つ。
Planner orchestration側のboundsを `ConstrainedCandidateSearchInput` へ含めない。

```text
enumerator側     maxNormalForgeCount
                 maxGogmaAdvance
                 maxSkillResetCount
                 maxOffAxisPairEvaluations

orchestration側  maxCandidateTrialsPerConflict
                 maxGeneratedBuildListEntries
                 maxPlannerReruns
```

orchestration側3つはenumerationの探索量へ影響せず、Search DomainがPlanner側の
試行回数・再実行回数を知る必要もない。契約本文は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.16にある。

`ConstrainedEnumerationBounds` はB8-B1ではcaller必須指定とし、Production defaultを
定義しなかった。Production defaultはB8-B1実装後のB8-B2で、enumerator側の実Browser
Worker benchmarkから決定する。orchestration側boundsのProduction defaultはB8-B2では
決めない。Planner再実行1回のコストはB8-C / B8-Dのorchestration実装が無ければ
測定できないため、B8-C / B8-Dはcaller必須指定のまま実装し、その後のB8-Eで決定する。

**B8-B2で決定済み。** 実測記録は
[B8_CONSTRAINED_ENUMERATION_BROWSER_WORKER_BENCHMARK.md](./B8_CONSTRAINED_ENUMERATION_BROWSER_WORKER_BENCHMARK.md)
にある。

```ts
export const defaultConstrainedEnumerationBounds: ConstrainedEnumerationBounds = {
  maxNormalForgeCount: 40,
  maxGogmaAdvance: 30,
  maxSkillResetCount: 100,
  maxOffAxisPairEvaluations: 500,
}
```

根拠は、全Route baseで両streamがactiveでIdealが近傍に無いcombined workloadの
実Browser Worker実測である。**計測はparity instrumentation（stable key再生成・
digest・Candidate列保持）を行わない最小recorderのtiming modeで行い、Worker wall
timeをそのまま用いる。差し引き補正値をdefault根拠にしない。**
full bounded enumerationの中央値1782.0 ms、time to first Candidateの中央値331.6 ms、
Candidate traversal区間のcancel応答0.7〜2.2 ms。single-axis値を足し合わせて
決めていない。upfront solve区間へのcancelは主スレッドtimer throttleにより
直接測定できていない。determinism（ordered / set parity）は別のparity modeで確認した。

**これはdefaultであってcapabilityではない。** `ConstrainedCandidateSearchInput.bounds`
はcaller必須のままであり、`visitConstrainedCandidates()` /
`enumerateConstrainedCandidates()` が `input.bounds` をoptionalにしたわけではない。
B8-C以降のProduction callerがこの定数を明示的に渡す。B8-B2ではApplicationへ接続していない。

`CandidateSearchSettings` が依然としてconstrained enumerationのfilter authorityでも
extent authorityでもないことも変わらない。

#### 既存schedulerを流用しない

既存 `TargetSearchScheduler` をそのまま使用してはならない。次がいずれも初回Search
専用のpolicyだからである。

```text
同一結果の最小advance retention
Cross-only
canonical Idealによる探索終了
初回Search horizonとcandidate retention
```

既存Skill / Bonus streamのretention前depth出力は再利用する。

#### 要求

- 同一結果の後続Counter位置解を列挙できる
- Practical dominance(5.5.6)を適用しない
- canonical Ideal(5.6.3)で探索を終了しない
- 初回Practical horizon(5.5.6.0)を適用しない
- TargetのIdealまたはPractical条件を満たすCandidateだけをyieldする
- deterministicである
- finite boundsを持つ
- cancellation可能である
- Worker yield可能である
- Production RNGのinput-level support契約を維持する
- normal scope Keep predictionは引き続きunsupportedとして扱う(5.7)
- B2のfamily-layout frontier dedup(5.5.3)を維持する
- route-history完全探索へ拡張しない

#### 軸外Cross

初回Searchは軸上のみを生成する(5.5.4)。

```text
Candidate(c) = { (B(c)[i], k0) } ∪ { (b0, K(c)[j]) }
```

constrained searchでは、必要になったTarget・その競合に限って軸外pairも評価できる。

```text
(B(c)[i], K(c)[j])   i > 0 かつ j > 0
```

規則。

- full Cartesianを事前生成しない。lazy frontier / best-firstなどで、必要なcellだけを
  順次評価する
- 評価数は `maxOffAxisPairEvaluations` で有限に抑える
- tie-breakにrun依存値を使わない。5.5.2 / 5.5.3 / 5.6.3と整合するstable semantic key
  (`candidateStableKey` 相当)を使う
- Bonus family-layout frontierは5.5.3のB2契約を維持する
- 初回Searchの合成規則(5.5.4)は変更しない

#### 変更しないもの

constrained enumerationはSearch orchestrationの追加境界であり、次を変更しない。

```text
Production RNG prediction semantics
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
当時のCURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
初回Searchの終了条件、canonical Ideal、retention、Cross規則
通常Candidate SearchのsearchRunId契約とBuildCandidate ID生成規則
```

これはB8 constrained enumeration自身がSearch semanticsを変えなかったという歴史的記録である。
現行versionは3であり、5.4末尾のversion 2 BuildCandidate / BuildListEntry互換契約に従う。

最後の項目は**通常Candidate Searchについて変更しない**という意味である。
`createCandidateFromPrediction()` が `CandidateSearchInput.searchRunId` を
`semanticHash` へ含め、そこから `BuildCandidate.id` を生成する規則はそのまま残す。
B8 constrained materializerはこの経路を流用せず、deterministic constrained search
identityを基点とする専用契約で `searchRunId` と `id` を決める(前掲のmaterialize契約、
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.13)。両者は別の境界であり矛盾しない。

## 5.7 normal scope Keepのgame legalityとprediction support

以下の三層を厳密に分離する。混同した記述を仕様・UI文言・skip reasonへ書かない。

### レイヤー1 ゲーム操作としての可否

実ゲームでは次が成立する。

- 通常アーティア作成時点で復元ボーナス5枠が付与される
- 通常アーティアを巨戟アーティアへ変換しても、その5枠はslot順のまま維持される
- 巨戟化時に自動付与されるのはSeries Skill / Group Skillである
- 巨戟化そのものではGogma BonusのResetは発生しない
- 巨戟化後、維持された5枠に対する最初のBonus操作として
  **Reset BonusesとKeep Bonusesのどちらも選択できる**

したがって「normal scopeからのKeepはゲームルール上不可能」という記述は誤りであり、
仕様authorityとして採用しない。これは再検証待ちの未確定事項ではない。

### レイヤー2 現在のProduction prediction support

Production RNG Engineは、normal-tier Bonusを現在値とするKeepをまだ予測できない。

```text
getPredictionSupport({ type: "gogma_keep", currentBonuses: <normal scope 5枠> })
  -> { supported: false, reason: "unsupported_current_bonus" }
```

参照実装のKeep family tableは巨戟tier Bonusだけを対象とし、normal-tier枠が
どのfamilyへ属し、どの候補poolとweightでtierを引くかを定義していない。
game-verified fixtureも存在しない。

normal-tier familyからKeepした場合の具体的なProduction RNG prediction semanticsは
未検証であり、B0では推測して定義しない。Master DataのBonus Type Mappingから
family対応を導けそうに見えても、抽選pool・weight・repeat penaltyを推測しない。

### レイヤー3 v1のProduct挙動

- Searchはprediction supportが無い間、normal scope Keepを含むRouteを生成しない
- Plannerはそのようなoperationを計画・実行しない
- Domain検証は当面normal scopeの `keep_bonuses` を不正として扱う。
  これはgame legalityの否定ではなく、期待結果を定義できないためである
- skip / 除外理由は `keep_prediction_unsupported` 系を使う。
  「ゲーム上Reset必須」を意味する理由コードや文言を使わない
- 実装上のskip reason `normal_scope_requires_reset` と、それに対応するUI文言は
  この方針と矛盾するため廃止した。B6で `normal_scope_keep_prediction_unsupported`
  へ改称し、UI文言も「現在の予測エンジンでは予測未対応」という意味へ訂正済みである。
  「ゲーム上できない」「最初にReset必須」を意味する理由コードや文言を再導入しない

normal-tier Keepのprediction semanticsがgame-verifiedになった時点で、
レイヤー2とレイヤー3の制限を同時に解除する。

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
- これらを満たさない場合でも、6.1.1の強制Reset variantが成立することがある
- Base SeedとSkill Counterが確定している。persisted Counter Gateは要求しない
- 対象武器種・対象レア度のNormalArtianCounterが確定している
- 対象レア度はv1固定の8
- 対象武器種・属性のnormal scope WeaponBonusDefinitionを利用できる。RNG poolはEngineのreference-verified tableを使い、現行LotteryMasterの有効性を要求しない
- Reset / KeepをRouteへ含める場合だけ、Gogma Prediction Capability、確定Gogma Counter、Keepの場合はKeep Prediction Capabilityを追加で要求する

検索手順。

1. `candidateOffset = 0 ... maxNormalAdvance - 1` を走査し、`candidateCounter = normalCounterBefore + candidateOffset` をTargetの `elementId` とともに通常アーティアPredictionへ渡す
2. 各候補の `forgeCount = candidateOffset + 1` とする。先行する `forgeCount - 1` 本を通常のまま見送り、候補である最後の1本だけを巨戟化する
3. 変換元の通常5枠をslot順のまま継承し、現在Skill位置を `predictSkills` して初回Series / Groupを付与する
4. conversion時のSkillが `idealSkillCondition` を満たす場合はReset Skillsを探索しない。満たさない場合だけ、Skill Counter +1後の位置から5.5.2のSkill列を線形探索する
5. 継承したnormal-tier bonusのままでTarget条件を満たさない場合、最初にReset Bonusesを行い、その後は必要に応じて追加Reset / Keepを探索する
6. Bonus解集合とSkill解集合を独立に求め、5.5.4のCross規則で合成する。Bonus結果 × Skill結果の直積を列挙しない
7. TargetWeapon条件に照合し、条件を満たす場合はBuildCandidateを生成する
8. `estimatedNormalAdvance`, `estimatedGogmaAdvance`, `estimatedSkillAdvance` と実行順の `RouteOperation[]` を設定する

制約。

- 通常Counter未確定ならこのpredicted variantはskipする。RouteKind全体がskipされるとは限らず、6.1.1のblind Reset variantが成立する場合はそちらを検索する
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
- normal scopeのtransient Gogmaへ直接Keepを適用しない。理由はゲームルールではなく、Production RNGがnormal-tier BonusからのKeepをまだ予測できないことである(5.7参照)
- `candidateOffset` ごとにBonus解集合とSkill解集合を再計算しない。5.5.2と5.5.3の共有規則に従う

## 6.1.1 通常アーティア経由 / Counter未確定時の強制Reset variant

RouteKindは6.1と同じ `normal_artian_to_gogma` を使う。新しいRouteKindを追加しない。
predicted variantとblind variantは `CreateNormalArtianOperation` のCounter null性で
区別でき、既存のRouteOperation semanticsとvalidationで安全に判別できるためである。

成立根拠。

Gogmaの `Reset Bonuses` は直前の復元ボーナス5枠を参照せず、Base Seed、Gogma Counter
位置、武器種、属性、Masterだけから5枠を完全に再抽選する(`docs/RNG_SPEC.md`)。
したがって作成した通常アーティアの5枠を一度も読まないRouteであれば、
NormalArtianCounterもNormal Artian Predictionも不要になる。

必要条件。

- 確定Base Seed
- 確定Skill CounterとSkill Prediction support(変換時の初回Skill付与に必要)
- 確定Gogma CounterとReset Bonuses Prediction support(最初のBonus amendmentに必要)
- Master support
- Normal Artian Prediction capability / input supportは不要
- NormalArtianCounterの確定も不要

適用条件。

- 6.1のpredicted variantが成立しない場合にだけ生成する。具体的には、対象武器種のレア8
  NormalArtianCounterが未確定であるか、Base Seed未確定、Normal Artian Prediction
  capability欠如、またはNormal Artian input unsupportedのいずれかである
- predicted variantが成立する場合、同じ結果はoffset 0 + Resetで既に得られるため、
  blind variantを重複生成しない
- conversion自体が成立しない場合はvariantを問わずRouteKind全体をskipし、predicted
  variantのskip理由を報告する

操作列。

```text
create_normal_artian (count = 1, Counter位置なし)
convert_normal_to_gogma
reset_bonuses                 <- 必須。最初のBonus amendmentは必ずReset
[reset_bonuses | keep_bonuses]*
[reset_skills]*
```

制約。

- `CreateNormalArtianOperation` は `count = 1`、`normalCounterBefore = normalCounterAfter = null` とする。架空のNormal Counter値を代入しない
- 通常アーティアを2本以上作成するblind Candidateを生成しない。5枠を読まずResetで全上書きするため、追加forgeは手数・素材・Normal Counter進行だけを増やす完全劣後経路である
- 変換直後にCandidateを完成させない。変換直後の5枠はunknownであり、Candidateの最終結果へunknownを残さない
- 変換直後にKeep Bonusesを適用しない。これはProduction predictionの制限ではなくunknown入力の問題であり、normal scope Keepの扱い(5.7)とは独立に禁止する
- Reset Skillsだけを行ってCandidateを完成させない
- 最初のResetを実行した時点で `restorationBonusScope = "gogma_artian"` かつ5枠known となり、以降は6.1と同じReset / Keep / Reset Skills semanticsをそのまま使う
- `zeroBonus`(`gogmaAdvance = 0`)のBonus解は存在しない。Bonus軸は最初のResetから始まる。unknownを表すfake bonus setをstream解集合へ入れない
- `estimatedNormalAdvance = null` とする。`null` は「Normal Counter進行量を表現しない」であり、`0` ではない
- `estimatedGogmaAdvance` は最初のResetを含めて1以上になり、`maxGogmaAdvance` を通常どおり消費する
- `estimatedSkillAdvance` と `maxSkillAdvance` semanticsは6.1と同一である
- Route最小操作数は `create 1 + convert 1 + reset 1 = 3` である
- `BuildRoute.sourceOwnedWeaponId = null`、変換後のReset / Keep / Reset Skillsも `sourceOwnedWeaponId = null` とする。`referencedOwnedWeaponsHash = null` である
- `searchStateHash` はBase Seed、Skill Counter、Gogma Counterに依存し、NormalArtianCounterに依存しない。後からNormal Counterを確定してもこのCandidateはstaleにならない
- 素材コストは通常どおり計上する。通常アーティア作成1本分、変換1回分、Reset等の分をそれぞれ含める
- Candidateの保持、順序、Ideal / Practical判定、similarity、dominanceは既存規則をそのまま適用し、blind variantを優遇も冷遇もしない

報告。

- blind variantを検索した場合、RouteKind `normal_artian_to_gogma` は `searchedRoutes` に入る。同じRouteKindを同時に `skippedRoutes` へ載せない
- predicted variantが実行されなかったことは `CandidateSearchWarning` で報告する。warningはpredicted variantが不可だった理由(`normal_counter_unconfirmed` など)と、blind variantだけを検索した事実を含める
- blind variantも不可の場合は、従来どおりpredicted variantのskip理由を `skippedRoutes` へ記録し、blind variantが不可だった理由をwarningへ追加する

将来。

Normal復元ボーナス予測が拡張されても、このvariantは削除しない。
「1本作成 → 即Reset」はpredicted variantより短い有効なCandidateになり得るため、
独立した合法Routeとして残す。

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
- normal scopeからの最初のBonus amendmentはv1ではResetだけを生成し、その結果を `gogma_artian` scopeとして以後のReset / Keepへ渡す。これはprediction support上の制限であり、ゲームルール上の制限ではない(5.7参照)
- 起点ごとにBonus解集合とSkill解集合を再計算しない。5.5.2と5.5.3の共有規則に従う
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
2. 起点の現在5枠が `idealBonusMatch` を満たす場合、この起点についてBonus探索を行わない
3. Reset Bonuses後の5枠を予測する。Resetは現在Bonusを参照しないため、1 Gogma Counter位置につき1回だけ予測する
4. Skill解は5.5.2の共有Skill列から独立に取得し、5.5.4のCross規則で合成する。Bonus結果ごとにSkill探索を繰り返さない
5. TargetWeapon条件に照合する
6. Reset / Skill操作を実行順の `RouteOperation[]` としてBuildRouteへ保存する
7. BuildCandidateを生成する

`isProtected = true` のOwnedWeaponを起点とするReset Bonuses Routeは生成しない。保護解除overrideは初期版に持たない。

起点の `restorationBonusScope` はnormal / gogmaの双方を許可する。normal scopeならこのResetが最初のBonus amendmentとなり、結果のscopeをgogmaへ置き換える。normal scopeの起点でKeepを選べないのはprediction support上の制限であり、ゲームルール上の制限ではない(5.7参照)。

利用可能な起点がprotected武器だけの場合は `no_unprotected_source_weapon` としてRouteをskipする。

## 6.4 既存巨戟 Keep Bonuses経由

RouteKind。

```ts
"existing_gogma_keep_bonuses"
```

必要条件。

- 起点OwnedWeaponがある
- 起点OwnedWeaponの復元ボーナスの一部がTarget条件に有用
- 起点OwnedWeaponの `restorationBonusScope = "gogma_artian"`。normal scope起点を除外するのはprediction support上の制限であり、ゲームルール上の制限ではない(5.7参照)
- 起点OwnedWeaponの `isProtected = false`
- `canPredictGogma = true`
- RNG Engineが `supportsKeepBonusesPrediction = true`

検索手順。

0. 起点の現在5枠が `idealBonusMatch` を満たす場合、この起点についてBonus探索を行わない
1. 起点の現在5slotをslot順のまま `predictGogmaBonus({ type: "keep_bonuses", currentBonuses })` へ渡す
2. RNG Engineが返した次の一意な5枠をTargetWeapon条件に照合する
3. 必要ならその結果を次のcurrent 5slotとしてKeep depth 2以降を時間方向に探索する
4. Skill条件は5.5.2の共有Skill列で独立に評価し、5.5.4のCross規則で合成する。Keep結果ごとにSkill探索を繰り返さない
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
3. 起点の現在Series / Group Skillが `idealSkillCondition` を満たす場合、この起点についてReset Skillsを探索しない。Bonusが変わらないRouteなので、この場合はこのRouteKindの候補を生成しない
4. 満たさない場合は5.5.2の共有Skill列を使う。同一Skill Counter位置を武器ごとに再予測しない
5. TargetWeaponのボーナス条件とスキル条件を評価する
6. 5.5.2の支配関係で残ったSkill解についてBuildCandidateを生成する。同一の `(seriesSkillId, groupSkillId)` へ後続位置で到達する解は生成しない
7. BuildRoute.operationsへResetSkillsOperationを具体的な実行順で保存する

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

起点がnormal scopeの巨戟なら、v1では最初のBonus operationをReset Bonusesとし、その後に限りKeep Bonusesを組み合わせる。これはprediction support上の制限であり、ゲームルール上の制限ではない(5.7参照)。起点がgogma scopeならReset / Keepのいずれから開始してよい。

Mixed RouteでもBonus streamとSkill streamを独立に解き、5.5.4のCross規則で合成する。Bonus結果ごとにSkill探索を繰り返さない。

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
4. `candidateStableKey` が辞書順で小さい候補を残す

4のtie-breakに `BuildCandidate.id` を使ってはならない(8章)。
ここまで完全一致する2 Candidateはrun非依存のsemantic差を持たないため
比較結果0とし、先に到達した候補をそのまま残す。

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
8. `candidateStableKey` 昇順

TargetWeapon間の表示順。

1. priority降順
2. updatedAt降順
3. id昇順

このソート順は5.5の合成規則と5.6の終了条件の前提でもある。
`estimatedOperationCount` が `estimatedGogmaAdvance + estimatedSkillAdvance`
(+ forge回数)に対応するため、各streamで進行量が最小のanchor解を含む合成が
常に上位へ来る。5.6.3のcanonical Idealもこの順序で一意に決まる。
canonical Idealも表示用ソートも、最終tie-breakには `id` ではなく5.6.3の
`candidateStableKey` を使う。`BuildCandidate.id` は `searchRunId` を含むため
run間で安定しない。**Candidateの最終出力順にrun依存値を使ってはならない。**
`candidateStableKey` まで完全一致する2 Candidateはrun非依存のsemantic差を
持たないため比較結果0とし、`BuildCandidate.id` / `createdAt` / `searchRunId` で
順序づけてはならない。7章の重複排除における最終tie-breakも同じ規則に従う。

同一Search入力に対して `searchRunId` だけを変えて2回検索した場合、
`BuildCandidate.id` は異なってよいが、各Targetの
`candidates.map(candidateStableKey)` は**配列順まで一致**しなければならない。
これはB6-F1で実装済みである。`BuildCandidate.id` の生成規則
(`searchRunId` を含む `semanticHash`)は変更していない。

5.5.2 / 5.5.3で初回検索の解集合から外す同結果・後続位置の解は、このソート順の
すべてのキーで残す解に劣るか同値である。ただしそれは初回検索の順位付けに
限った話であり、Planner上の代替Counter位置としての価値まで否定するものではない
(5.6.4参照)。

`maxCandidatesPerTarget` はこのソート後に適用する既存の出力打ち切りであり、
合成規則の代わりにはならない。合成段階でCartesian productを作ってから
打ち切る設計にしない。Idealを発見した場合の枠確保は5.5.7に従う。

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
      phase: "preparing" | "searching" | "finalizing";
      processedWorkItems: number;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
```

progress契約(B6)。

- Target探索の開始時に `completedTargets = index`、`currentTargetWeaponId = target.id`、
  `phase = "preparing"`、`processedWorkItems = 0` を通知する。
  Target完了までcurrent Targetが見えない状態にしない
- Target探索中は、`TargetSearchScheduler` がsettleしたwork item数を一定間隔
  (`SEARCH_ACTIVITY_PROGRESS_INTERVAL = 100`) で `phase = "searching"` として通知する。
  work itemごとにWorker messageを送らない
- Target完了時に `completedTargets = index + 1`、`phase = "finalizing"` を通知する
- `processedWorkItems` はTargetごとに0から開始する
- Target内の総work量は探索中に増えるため未知である。`processedWorkItems` と `phase` を
  推定percentへ変換しない。Target単位の `completedTargets / totalTargets` だけがpercentである
- progress間隔はSearch semanticsへ影響しない。canonical Ideal、保持集合、
  checkpoint yield間隔(50回)を変更しない
- progress callbackの有無でCandidate結果を変えない

Worker error契約(B6)。

- Worker protocolの `type: "error"` は、handled searchの失敗であり当該requestだけを
  rejectする。Workerはそのまま再利用してよい
- native Worker `error` / `messageerror` はWorker自体の異常であり、fail closedとする。
  pending Searchをすべてreject、pendingをclear、listenerを解除、Workerをterminateし、
  以降の `startSearch()` も即rejectする。壊れたWorkerを暗黙に再利用しない
- 専用error型 `SearchWorkerRuntimeError` を使い、`error` と `messageerror` を
  内部codeで区別する。ユーザー向けにはページ再読み込みを促す日本語messageを表示する
- v1ではWorkerの自動再生成やページ自動reloadを行わない

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

- 理想5枠が順不同で一致し、gogma scopeの場合だけBonus Idealになる
- normal scopeの5/5一致もPractical条件を通常どおり評価し、Similarity 1になり得る
- normal scopeでもunknown BonusRankを明示的Domain Errorとして返す
- 実用BonusConditionが正しく判定される
- RequiredExCountが正しく判定される
- OR条件グループが正しく判定される
- SkillCondition `all` / `any` が正しく判定される
- 理想条件が実用条件より優先分類される
- 理想条件を満たす完成品が実用条件も満たす(Ideal ⇒ Practical 包含不変条件)
- PracticalとSimilarityが別軸で判定される
- 近似フィルタが `category = practical AND isSimilarToIdeal = true` だけを返す

## 13.2 Route Test

- 通常Counter未確定なら通常アーティア経由のpredicted variantをskipする
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
- normal scopeのtransient Gogmaへ適用するKeepを `keep_prediction_unsupported` 系の理由で除外し、ゲームルール由来の理由コード・文言を使わない
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

## 13.2.0 強制Reset variant Test (6.1.1)

- 所持武器なし、Normal Counter未確定、Base Seed / Skill Counter / Gogma Counter確定のとき、`normal_artian_to_gogma` が `searchedRoutes` に入り `skippedRoutes` へ載らない
- そのCandidateの操作列が `create_normal_artian`(count = 1、Counter null) → `convert_normal_to_gogma` → `reset_bonuses` を含む
- `supportsNormalArtianPrediction = false` でもblind variantを検索でき、`predictNormalArtian` を1度も呼ばない
- Gogma Counter未確定ならblind variantを生成せず、predicted variantのskip理由を報告する
- Skill Counter未確定ならblind variantを生成しない
- Reset Bonuses prediction unsupportedならblind variantを生成しない
- 最初のReset前のunknown状態からCandidateを生成しない。blind Candidateは常に `restorationBonusScope = "gogma_artian"` で `reset_bonuses` を含む
- blind Candidateで通常アーティアを2本以上作成しない
- blind Candidateの `estimatedNormalAdvance` が `null`、`referencedOwnedWeaponsHash` が `null` になる
- blind Candidateの `searchStateHash` がNormalArtianCounterの確定状態に依存しない
- レア6・7のNormalArtianCounterしかない場合でもblind variantはレア8を作成し、そのCounterを読まない
- 所持通常アーティア経由は登録済み5枠をそのまま使い続け、blind semanticsへ巻き込まれない

## 13.2.1 Stream Independence Test

- 起点巨戟の現在SkillがidealSkillConditionを満たす場合、`predictSkills` が呼ばれず `reset_skills` を含む候補も生成されない
- 起点巨戟の現在BonusがidealBonusMatchを満たす場合、`predictGogmaBonus` が呼ばれずBonus amendmentを含む候補も生成されない
- 現在状態がPracticalのみを満たす場合、操作0のPractical解を保持したままIdeal到達探索を継続する
- `maxGogmaAdvance` だけを増やしても `predictSkills` 呼び出し回数が変化しない
- `maxSkillAdvance` だけを増やしても `predictGogmaBonus` 呼び出し回数が変化しない
- 起点所持巨戟を増やしても `predictSkills` 呼び出し回数が起点数に比例しない
- `maxNormalAdvance` を増やしてもconversion後の `predictGogmaBonus` 呼び出し回数が比例しない
- 同一 `(baseSeed, skillCounter)` に対する `predictSkills` を2回以上呼ばない
- 同一Gogma Counter位置に対するReset予測を1回だけ行う
- 同一family layoutのstateがfrontierで1代表へ畳まれ、それによって候補を失わない
- `resultFilter` を変えてもstream探索量と解集合が変化しない

## 13.2.2 Candidate Composition Test

- 合成件数が `|B(c)| + |K(c)| - 1` になり、`|B(c)| × |K(c)|` にならない
- Bonus軸候補はSkill anchorを固定し、Skill軸候補はBonus anchorを固定する
- 両軸から外れた `(B(c)[i], K(c)[j])`(`i > 0` かつ `j > 0`)を生成しない
- 合成した `RouteOperation[]` がBonus操作列 → Skill操作列の順で保存される
- `estimatedGogmaAdvance` と `estimatedSkillAdvance` がstreamごとに独立して正しい
- 合成後の `category` / `idealDifference` / `similarityScore` / `isSimilarToIdeal` が既存Target評価器の結果と一致する
- 既存巨戟Routeで `d = 0` かつ `resetCount = 0` になる合成を候補化しない
- `b0` / `k0` が5.5.2 / 5.5.3のdeterministic orderingで一意に決まり、Route baseの評価順を変えても変わらない

## 13.2.3 Termination and Retention Test

- 初回検索がcanonical Idealと操作数D以下のPractical評価を確定した時点で通常探索を終了する
- 確定したIdealが8章の標準ソート順で最小であり、RouteKindの評価順を入れ替えても同一になる
- canonical Idealのtie-breakが `searchRunId` / `createdAt` / `BuildCandidate.id` に
  依存せず、`searchRunId` を変えて同一入力を再検索しても同じIdealが選ばれる
- 表示用ソートと重複排除の最終tie-breakが `BuildCandidate.id` に依存せず、
  `searchRunId` だけを変えた再検索で `candidateStableKey` 列が配列順まで一致し、
  かつ `BuildCandidate.id` 列は一致しない
- `estimatedOperationCount <= D` のPracticalがすべて評価対象になり、
  Idealを先に発見してもそれより近いPracticalを取りこぼさない
- Practical保持集合がbest-first / branch-and-bound / RouteKind評価順を変えても同一になる
- canonical Idealが探索上限内に無い場合、探索範囲内で評価できたPracticalへ
  同じ非劣位保持規則が適用される
- Idealが見つからない場合だけ `max*Advance` の上限まで探索する
- 現在Bonusがgogma scopeでIdealと完全一致する起点についてBonus探索を行わない
- normal scopeでIdealラベル5/5・Skill一致のconversion D=2をIdealとせず、同じ5枠を返す
  Reset Bonuses後のgogma scope D=3まで探索し、そのCandidateをcanonical Idealにする
- 同じ5枠のnormal d=0 / gogma d=1をfull-prefix / incremental両方で保持する
- 同一scope・同一multisetは最小advanceを保持し、異なるscopeの同点は安定順序で決める
- normal scopeを継承した既存Gogmaの5/5一致でもReset探索を0回化しない
- 現在SkillがidealSkillConditionを満たす起点についてSkill探索を行わない
- 現在状態がPracticalのみを満たす場合、操作0のPractical解を保持したままIdeal探索を継続する
- Ideal到達前に見つかった非劣位Practicalを複数保持する
- 5.5.6の10条件をすべて満たす場合だけPractical候補を削除する
- Bonus rank dominanceを `bonusTypeId` ごとのrank multisetで判定し、slot順に依存しない
- 同一bonusTypeで `[III, II]` と `[EX, I]` を比較不能として両方保持する
- Masterでrank orderingを安全に比較できないscope / typeを比較不能として扱う
- 素材を `materialId` 単位のcomponent-wiseで比較し、合計個数で優劣判定しない
- `X×2` と `Y×1`、`{X×2, Y×1}` と `{X×1, Y×2}` を比較不能として両方保持する
- Bonus Type構成が異なるPractical候補、Skill構成が異なるPractical候補、
  起点が異なるPractical候補を比較不能として両方保持する
- 同一結果の後続Counter位置を「支配された」として恒久除外しない
- canonical Idealより手前の同一結果が、評価済みでも初回保持集合から省略され得る
- `maxCandidatesPerTarget` に達してもIdealを結果へ含め、最下位Practicalを置換する
- `resultFilter` を変えても終了条件・保持集合の構築が変化しない

## 13.2.4 Target Invariant Test

Target validation(B7)はIdeal既達成早期終了より先に実装する。
以下はB7で追加済みの観点であり、13.2.3のIdeal既達成早期終了のうち
Skill stream側はB1で実装済み、Bonus stream側はB2で実装済みである。

- `idealBonuses` が `practicalBonusConditions` と `practicalAlternativeGroups` をすべて満たす
- `idealSkillCondition` を満たす `(seriesSkillId, groupSkillId)` が
  `practicalSkillCondition` も満たす
- 包含が成立しないTargetWeapon定義を保存できない
- 包含が成立しない保存済みTargetWeaponはCandidate Searchの対象から
  warning付きで除外される

## 13.2.5 Constrained Enumeration Test

5.6.7の契約に対するテスト観点である。実装はB8-B1で行う。

- constrained enumerationが `ConstrainedSearchOrigin` 起点から再評価し、
  `conflictingCounter + 1` へ後方固定されない
- Practical dominance、初回Practical horizon、canonical Ideal終了を適用しない
- 同一結果の後続Counter位置解をyieldできる
- IdealもPracticalも満たさないCandidateをyieldしない
- `origin` がPlanner計算開始時のcurrent validated snapshotから構成され、
  `searchRunId` / `routeFilter` / `resultFilter` / `settings` を持たない
- 過去のUI Candidate Search requestを `origin` として要求しない
- route scopeが現時点で成立する全Routeであり、UI一時filterを継承しない
- `resultFilter` / similar filter / `maxCandidatesPerTarget` を適用しない
- 探索範囲の上限が `ConstrainedEnumerationBounds` だけで決まり、
  `CandidateSearchSettings` を参照しない
- route policyが広がってもIdeal / Practical条件を満たさないCandidateをyieldしない
- 同一入力・同一boundsで列挙順が完全に一致する
- boundsへ到達した場合に `stoppedByBound` を返し、`exhausted` としない
- 軸外pairをlazyに評価し、full Cartesianを事前生成しない
- 軸外評価数が `maxOffAxisPairEvaluations` を超えない
- family-layout frontier dedupとnormal scope Keep未対応の扱いが初回Searchと一致する
- cancellationで列挙が停止し、以降のCandidateをyieldしない
- Search Domain APIがPlannerのConflict DTOを受け取らない
- `ConstrainedCandidateSearchInput` が `maxCandidateTrialsPerConflict` /
  `maxGeneratedBuildListEntries` / `maxPlannerReruns` を持たない
- enumeratorが `BuildCandidate` ではなく `ConstrainedCandidate` をyieldし、
  `id` / `searchRunId` / `createdAt` / random ID / Clock / enumeration ordinalを
  結果へ含めない
- `similarityThreshold` がyield可否、ordering、route scope、探索終了、探索範囲、
  off-axis評価のいずれにも影響しない

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
- Target開始時点でcurrent Targetを含むprogressが返る
- 長時間Targetで完了前にactivity progressが返り、`processedWorkItems` が単調増加する
- Targetごとに `processedWorkItems` が0へresetされ、最終 `completedTargets` が
  `totalTargets` へ到達する
- progress callbackの有無でCandidate結果が変わらない
- cancelで結果反映を止める
- Worker protocol errorがUIへ伝わり、Workerは再利用可能なまま残る
- native `error` / `messageerror` で全pending Searchがrejectされ、listener解除・
  terminate・以降のstartSearch即rejectまで行われる
- 大量検索でもUIスレッドがブロックされない
