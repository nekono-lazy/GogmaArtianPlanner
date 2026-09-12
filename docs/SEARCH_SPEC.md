# モンハンワイルズ 巨戟アーティア厳選Planner
## SEARCH_SPEC.md

## 1. この文書の目的

この文書は、目標武器ごとの候補検索、canonical Ideal Routeとcompromise checkpoint、作成経路、条件判定、条件緩和案、Web Worker入出力、保存方針、テスト観点を定義する。

候補検索はProduction Plannerの前段であり、Plannerは検索結果から作成リストへ追加された候補だけを入力として扱う。

Candidate Search再設計の背景、実測値、採用しなかった案、受け入れた制約は
[CANDIDATE_SEARCH_REDESIGN.md](./CANDIDATE_SEARCH_REDESIGN.md) に記録する。
同文書は設計記録であり仕様authorityではない。契約は本書とAGENTS.mdが定める。

---

## 2. 基本方針

- 検索はTargetWeapon単位で実行する
- 検索結果はBuildCandidateとして保存する
- 初期版では実用ラインを満たさない候補を原則表示しない
- Candidateは常に理想品であり、実用品のcategoryや理想への近さを表す属性は持たない
- 通常アーティア経由と既存巨戟アーティア経由を比較する
- 対象武器種のレア8通常アーティアCounterが未確定なら新規通常アーティア経由を検索しない
- 条件は自動変更せず、緩和案だけを提示する
- 重い検索はWeb Workerで行う
- Normal / Gogma / Skillは独立RNG streamとして独立に探索する
- Bonus結果とSkill結果のCartesian productを列挙しない
- 現在状態が既に理想条件を満たすstreamは探索しない
- 初回検索はcanonical Idealを1件確定した時点で終了する。Searchは常にIdeal-onlyである
- 妥協状態は独立したCandidateではなく、canonical Ideal Routeのstrict prefixに現れるcheckpointである（5.7 / 5.8）
- canonical Idealの選択を実装上の発見順へ依存させない
- 理想品は実用ラインも必ず満たす(Ideal ⇒ Practical 包含不変条件)
- Planner競合対策の先読みは初回検索の責務ではない

---

## 3. 入力

```ts
export interface CandidateSearchInput {
  searchRunId: string;
  targetWeaponId: TargetWeaponId;
  routeFilter: CandidateRouteFilter;
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

export interface CandidateSearchSettings {
  maxNormalAdvance: number;
  maxGogmaAdvance: number;
  maxSkillAdvance: number;
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
ユーザーは詳細設定で各上限を引き上げられる。

制約。

- RngState全体の確定は要求しない
- `deriveRngCapabilities` を使い、必要値が揃ったRouteだけを検索する
- 不足Capabilityに依存するRouteは `skippedRoutes` へ理由を記録する
- Engine capabilityがある場合は、Prediction前に具体的なsemantic inputを `getPredictionSupport()` で確認する
- input supportがfalseの場合は、該当Route、operation、またはsourceの最小単位だけを正常系としてskipし、他のsupported探索を継続する
- support queryの予期しない例外、またはsupport=true確認後のPrediction例外は通常skipへ変換せず、既存Search / Worker error経路へ伝播する
- すべての選択Routeが実行不能な場合のみ検索を開始不可とする
- `targetWeaponId` は単一のTargetWeaponを指す。1 requestで検索するTargetはちょうど1件であり、`isEnabled = true` でなければならない
- 存在しないTarget、`isEnabled = false` のTarget、Ideal implies Practical不変条件を満たさないTargetは、Candidateを返さず `CandidateSearchWarning` として報告する
- `max*Advance` は1以上
- `maxNormalAdvance` は既存設定・既存UIの意味を維持した「最大forge回数」であり、最大0-based offsetではない。探索する `candidateOffset` は `0 ... maxNormalAdvance - 1`
- 出力上限 (`maxCandidatesPerTarget`) と近似閾値 (`similarityThreshold`) は存在しない。Searchが返すCandidateはcanonical Ideal 1件以下であり、上限で打ち切る対象がない

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
  targetResult: TargetCandidateSearchResult;
  warnings: CandidateSearchWarning[];
  elapsedMs: number;
}

export interface TargetCandidateSearchResult {
  targetWeaponId: TargetWeaponId;
  candidate: BuildCandidate | null;
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
    | "master_data_unavailable"
    | "calculation_context_incompatible"
    | "disabled_by_filter";
  detail: string;
}

export type CandidateSearchNoticeSeverity = "info" | "warning";

export interface CandidateSearchWarning {
  targetWeaponId: TargetWeaponId | null;
  severity: CandidateSearchNoticeSeverity;
  message: string;
}
```

`CandidateSearchWarning` はseverity付きの通知である。`severity` を明示しないCandidate Search通知を生成しない。

- `info` は、通常より限定された方法で検索が成立したことの案内に使う。6.1.1のblind Reset variantが正常に検索された場合がこれにあたる。エラーでも結果品質の低下でもない
- `warning` は、検索能力が欠けてRouteを検索できなかった場合、一部の予測を除外した場合、Target定義が不正で検索対象から除外した場合など、結果を読むうえで注意が必要な場合に使う
- fallbackが成立したという理由だけで既存warningを `info` へ引き下げない

通常UIへ内部reason enum（`normal_counter_unconfirmed` など）や英語Domain用語をそのまま表示しない。reasonはどの文言を選ぶかの判定にだけ使う。UIでのseverity別表示は `docs/UI_FLOW.md` 9が正本である。

未確定RNG値は `*_unconfirmed`、Engine機能不足は `*_prediction_unsupported`、所持source不足は `no_owned_weapon_available` / `no_unprotected_source_weapon` として区別する。`no_owned_weapon_available` は `owned_normal_artian_to_gogma` と `existing_gogma_*` の両方で使うため、UI文言は武器種を限定しない汎用表現にする。武器種はRouteKind labelが示す。値が確定していてもEngineが未対応なら予測可能とみなさず、逆にEngineが対応していても必要値が未確定なら該当RNG値のreasonを返す。

Production Searchはroute-local / operation-local supportを維持し、RngState全体のall-or-nothing availabilityを設けない。Skill-dependent routeはBase SeedまたはSkill Counter不足、Skill Prediction / concrete semantic input unsupportedでskipする。Gogma amendment routeはBase SeedまたはGogma Counter不足、Gogma Prediction / concrete semantic input / Master unsupportedでskipする。persisted Counter Gateの未設定・未確定はskip reasonにしない。Normal Counter不足は `create_normal_artian` を含むrouteだけに適用する。
`master_data_unavailable` は、Route実行に必要なWeaponBonusDefinition、BonusRank、アイテム素材等のMaster Dataが存在しない、無効、または利用不能な場合に使用する。Production RNG poolはEngineのreference-verified tableであり、disabled LotteryMasterだけを理由にこのreasonを返さない。reference-verifiedは参照repositoryとの一致を表し、全実ゲーム条件でのgame-verifiedを意味しない。

`CandidateRouteFilter` はRouteグループを選ぶ入力であり、SkippedRouteの粒度には使用しない。`normal_artian` は `normal_artian_to_gogma` と `owned_normal_artian_to_gogma`、`existing_gogma` は操作0の `existing_gogma_current` と4つの amendment RouteKindを対象とする。`disabled_by_filter` も除外された具体的なRouteKindごとに返す。`searchedRoutes` と `skippedRoutes[].route` は同じRouteKind粒度で、同じRouteを両方へ含めない。

すべてのBuildCandidateとCandidateSearchResultに、入力の `calculationContext` をそのまま保存する。各BuildCandidateには検索開始時のRoute依存RNG状態から生成した `searchStateHash` と、Routeが参照するOwnedWeaponだけから生成した `referencedOwnedWeaponsHash` を保存する。参照武器がないRouteでは後者を `null` とする。Worker実行中に現在環境のCalculationContext、検索開始状態、またはCandidateが参照するOwnedWeapon状態が変わった場合、そのrequestIdの結果を現行候補として保存しない。

`searchStateHash` はProduction Predictionのsemantic authorityだけを含め、legacy `RngState.counterGate` のvalue / isConfirmed / sourceを含めない。Gateだけの変更によるfalse staleを発生させない。C5-E2C3でruntime hashを本契約へ同期済みである。

---

### 4.1 検索対象Targetの選択

`targetWeaponId` が指すTargetWeaponだけを検索する。存在しない、`isEnabled = false`、
またはIdeal implies Practical不変条件を満たさないTargetは、
`targetResult.candidate = null`、`searchedRoutes = []`、`skippedRoutes = []` の
空結果と `severity: "warning"` の通知として返す。request自体は成立しているため
errorにはせず、UIは理由を表示する。

### 4.2 出力上限の不在

`targetResult.candidate` はcanonical Ideal 1件または `null` である。
出力上限で候補を切り落とす概念は存在しないため、`isTruncated` も
`relaxationSuggestions` も返さない。Idealが見つからなかった場合は
「現在の探索範囲ではIdealが見つからなかった」であり、
「このTargetにIdealが存在しない」ではない。

---

保護契約の改訂により、現行CalculationContext.appSchemaVersionは **7**。
単一authorityは src/domain/models/common.ts の CURRENT_CALCULATION_APP_SCHEMA_VERSION。
Search、BuildList、Planner、benchmark runtime creatorで共用する。
旧version 1..6のCandidate / BuildListEntry / ProductionPlanはすべて非互換であり、
calculation_context_changedにより現行計算・実行から除外する。
旧Candidateのcategoryやsnapshotは再分類・削除せず、現在のTarget条件で再検索する。

歴史的にはB5-F1で1→2、Plannerのみの変更で2→3→4→5と更新した。
2..5間のCandidate / BuildList互換例外は当時の境界に限り、version 6以降へは適用しない。
Targetの永続形状は独立してDexie DATABASE_SCHEMA_VERSIONを1→2へ更新する。
AppSettings.schemaVersion、gameVersion、Master Data version、RNG Engine version、
supportsSeedSearchは変更しない。移行・ExportRoot契約はDATA_MODELと
TARGET_COMPROMISE_SEMANTICSを参照する。

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

## 5.2 妥協判定

Bonus Match=ideal / practical / alternative、Skill Match=ideal / practicalを独立評価する。
Bonus / Skill両方Idealなら理想品、それ以外の受理組み合わせは「妥協状態」である。
BonusのPracticalとAlternativeは非併用、Skillとの組み合わせは許可する。
すべてのBonus Matchはgogma_artian scopeを要求する。通常由来scopeは未達であり、Reset探索を継続する。
詳細はDATA_MODEL 8とTARGET_COMPROMISE_SEMANTICS.md。
妥協条件なしならIdealだけを受理し、両ID=nullのPractical Skillをwildcardとして扱わない。

妥協状態は独立したCandidateではない。5.7と5.8の通り、canonical Ideal Routeの
strict prefixとして到達する妥協状態だけがcheckpointになる。

```ts
export interface CompromiseConditionMatch {
  bonus: "ideal" | "practical" | "alternative";
  skill: "ideal" | "practical";
}
```

両軸がidealの組み合わせは理想品そのものであり、`CompromiseConditionMatch` としては
存在しない。`evaluateCompromiseCheckpointCondition()` がこの判定authorityであり、
両軸idealまたは受理不能な状態に対して `null` を返す。

## 5.3 近似判定の廃止

近似 (similarity) の概念は存在しない。`similarityScore`、`isSimilarToIdeal`、
`similarityThreshold`、およびSearch UIの「近似」フィルタはすべて削除した。

Targetの妥協条件（Practical Bonus、Alternative Rule、Practical Skill）が
「どこまでなら受け入れるか」の唯一のauthorityであり、Idealへの近さを測る
スコアがそれを代替することはない。`IdealDifference` は表示用の差分説明として
残るが、受理判定にも順序付けにも参加しない。

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
accepted(B, scope, S) = bonusMatch(B, scope) != null AND skillMatch(S) != null
```

`IdealDifference` も同様に分解できる。

```text
Bonus側 : missingBonuses, extraBonuses, matchedBonusCount
Skill側 : seriesSkillMatches, groupSkillMatches
```

したがってCandidate Searchは、Bonus結果とSkill結果を先に独立評価し、
最後に定数時間で合成できる。合成後の理想判定と `idealDifference` は、
既存のTarget評価器が返す値と一致しなければならない。分解評価は最適化であり、
判定semanticsの変更ではない。

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

#### 5.5.2.1 Reset Skills結果の観測記録

Skill streamは各Reset Skills位置について、その操作が生成する予測Skillを
observational recordとして保持する。`resetCount = r` の解では、`1 ... r` 回目の
Reset Skillsの結果を実行順に並べたものであり、`resetSkillsOperations()` が
再構成する操作列とindexが1対1で対応する。

- 記録はstream生成時に確定した予測をそのまま保持し、最終Skillからの逆算、
  最終Skillの全stepへの複製、別Counter位置の結果の流用を行わない
- 記録はstreamの既存memoized予測を読むだけであり、`predictSkills` の呼び出し回数を
  増やさない。UI層・presentation層でProduction RNGを再実行しない
- 記録は `RouteSkillSolution` の `operations` とindexが1対1で対応し、Candidateでは
  `BuildCandidate.skillAmendmentTrace` として `operationIndex` 付きで保持する
  (`docs/DATA_MODEL.md` 9.1)
- 記録は観測情報であり、stream-local retention key、5.5.2の順序、canonical Ideal選択、
  Practical dominance、Candidate semantic identityのいずれの入力にもならない
- 記録はRouteKindに依存しない。`reset_skills` を含むCandidateであれば、新規通常
  アーティア経由、6.1.1のblind variant、所持通常アーティア経由、既存巨戟のいずれでも
  同じ規則で生成する
- `convert_normal_to_gogma` の初回Skill付与はこの記録の対象外であり、
  `reset_skills` のentryとして報告しない。conversionの初回Skillは5.5.2.2の別記録とする

`ConstrainedCandidate` はこの観測記録を持たない。5.5.3.1と同じ理由である。

#### 5.5.2.2 conversion初回Skillの観測記録

`convert_normal_to_gogma` が付与する初回Series / Group Skillも観測記録として保持する。
5.5.2.1と同じ観測情報契約に従うが、対象Operationが異なるため別の記録とする。

- 値はSearchがconversion位置のSkill Counterに対して既に確定させた予測をそのまま保持する。
  Skill streamのmemoized予測を読むだけであり、`predictSkills` の呼び出し回数を増やさない。
  UI層・presentation層でProduction RNGを再実行しない
- Candidateでは `BuildCandidate.conversionSkillTrace` として `operationIndex` 付きで保持する
  (`docs/DATA_MODEL.md` 9.1)。`operationIndex` は完成したRouteの操作列を走査して求め、
  基点操作数からの手計算で決めない
- 記録は単数である。Routeが持つconversionは最大1件であり(6.1 / 6.1.1 / 6.2)、
  conversion件数が1件でないRouteへこの記録を付与しない
- 記録を `skillAmendmentTrace` へ統合しない。`skillAmendmentTrace` は `reset_skills` 専用契約を
  維持し、`operationType` へconversionを追加して兼用しない
- 記録はCandidateの最終Skillとの一致を要求しない。conversion後に `reset_skills` が続く場合、
  最終Skillはconversion直後Skillと異なる。最終Skillからの逆算も行わない
- 記録は観測情報であり、stream-local retention key、5.5.2の順序、canonical Ideal選択、
  Practical dominance、Candidate semantic identityのいずれの入力にもならない
- 記録はRouteKindに依存しない。6.1のpredicted variant、6.1.1のblind variant、6.2の
  所持通常アーティア経由のいずれでも同じ規則で生成する。6.1.1では作成した通常アーティアの
  5枠がunknownであるが、conversion時のSkill予測はknownなので記録を省略しない
- conversionを含まない既存巨戟Routeはこの記録を持たない

`ConstrainedCandidate` はこの観測記録を持たない。5.5.3.1と同じ理由である。

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
3. アイテム素材必要量合計 昇順
     同一depthでもReset / Keepの構成比でアイテム素材が変わり得るため
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

Ideal Bonus条件を満たす解を5.5.3のorderingで並べたものを `B`、
Ideal Skill条件を満たす解を5.5.2のorderingで並べたものを `K` とする。
`b0` / `k0` は各streamのdeterministic orderingで一意に決まり、
RouteKindの評価順やPromiseの解決順に依存してはならない。

```text
b0 = B[0]      Bonus anchor
k0 = K[0]      Skill anchor

Candidate = { (B[i], k0) | i = 0 ... |B| - 1 }
          ∪ { (b0, K[j]) | j = 0 ... |K| - 1 }
```

生成件数は `|B| + |K| - 1` であり、`|B| × |K|` ではない。

規則。

- `B` または `K` が空なら、そのRoute baseから候補を生成しない
- Bonus軸の候補はSkill anchorを固定し、Skill軸の候補はBonus anchorを固定する
- 両軸から外れた `(B(c)[i], K(c)[j])`(`i > 0` かつ `j > 0`)は生成しない
- Bonus候補 × Skill候補の直積を列挙しない。総操作数順のpriority queueなどで
  同じ直積を遅延展開する設計も禁止する
- 固定小定数の対角バンド(`R = 2` など)も追加しない
- 合成した操作列は「Bonus操作列 → Skill操作列」の順で1本の `BuildRoute.operations` へ記録する。
  Counterはstreamごとに独立に保持し、`estimatedGogmaAdvance = d`、
  `estimatedSkillAdvance` は既存巨戟Routeで `r`、conversionを含むRouteで `r + 1` とする
- 合成結果が理想品であることは必ず既存のTarget評価器が確認する。満たさない合成結果は
  Candidateにしない
- 軸候補の重複は7章の既存重複排除で1件へ畳む
- `routeFilter` はRouteグループを選ぶ入力であり、stream探索・解集合・合成規則の意味を
  変えない

Cross規則と5.5.2 / 5.5.3のstream-local retention / orderingはB3で実装済みである。
5.6.2の実探索終了条件と5.6.3のrun非依存canonical IdealはB4で実装済みである。
妥協状態の扱いは5.7 / 5.8のcheckpointモデルへ移した。

### 5.5.5 操作0の扱い

- Bonus stream `d = 0` は「現在の5枠をそのまま使う」ことを表す
- Skill stream `k = 0` は「現在のSeries / Group Skillをそのまま使う」ことを表す
- 既存巨戟Routeで `d = 0` かつ `k = 0` になる合成は、`existing_gogma_current` として
  `BuildRoute.operations = []` の操作0 Candidateを生成できる。保護中の巨戟も現在性能が
  Target条件を満たす場合はこの評価対象に残す
- `existing_gogma_current` は操作を持たず、Plannerは所持巨戟アーティアからTarget充足を
  直接導出する。Planner-driven constrained re-searchでは実行可能な代替Routeではないため列挙しない
- 通常アーティア経由と所持通常アーティア経由は `create_normal_artian` /
  `convert_normal_to_gogma` を必ず含むため、`d = 0` かつ `k = 0` でも操作列は空にならない

### 5.5.6 Cross合成はIdeal軸だけを取る

Cross規則が取るBonus軸とSkill軸は、いずれも当該Route baseの **Ideal解** だけである。

```text
B(c) = そのRoute baseでIdeal Bonus条件を満たすBonus stream解
K(c) = そのRoute baseでIdeal Skill条件を満たすSkill stream解
合成数 = |B| + |K| - 1
```

妥協状態はCross合成に参加しない。合成されたCandidateは常に理想品であり、
妥協状態はそのRouteのstrict prefixとしてcheckpointに現れるだけである。

この帰結として、Ideal Bonus multisetは定義上1種類しかないため、stream-local retentionを
経た `|B|` は通常1になる。`|K|` は、Ideal Skill条件がGroup Skillを拘束しない場合などに
1を超えうる。off-axis cell (`i > 0 AND j > 0`) は両軸が2件以上ある場合にだけ存在する。

旧来のPractical候補保持、Practical horizon、Practical dominance、
`practicalDominates()` はすべて削除した。妥協状態の取捨選択は5.8の
checkpoint grouping、および5.8.4の表示専用dominanceが引き継ぐ。

### 5.5.7 出力上限の不在

`maxCandidatesPerTarget` は存在しない。1 Target 1 requestが返すCandidateは
canonical Ideal 1件以下であり、切り落とす対象がない。表示上の件数制御は
5.8.4のcheckpoint表示dominanceが担当し、Domainのopportunityは削除しない。

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
| 妥協条件のみ満たす | Ideal到達可能性を探すため継続する | 探索で見つかるIdeal解（妥協状態はそのRouteのcheckpoint候補） |
| 未達 | Ideal到達位置を探索する | 探索で見つかるIdeal解 |

Ideal既達成streamの早期終了は、[DATA_MODEL.md](./DATA_MODEL.md) 8.1の
Ideal ⇒ Practical 包含不変条件に依存する。Idealを満たす現在状態はPracticalも必ず
満たすため、そのstreamについて将来探索で得られるより良い状態は存在しない。

**実装順の制約。** この早期終了はTargetWeapon validationが包含を保証してから
実装する。validation有効化前に導入すると、包含を満たさない不正Targetに対して
理想Route上の妥協checkpointを取りこぼす。Phase依存は
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
- 妥協条件だけを満たす状態で探索を打ち切ると、Ideal候補を失うため打ち切らない

### 5.6.2 初回Candidate Searchの終了条件

初回Candidate Searchは、canonical Idealを1件確定した時点で通常探索を終了する。

```text
探索開始
  -> canonical Idealを確定
  -> そのRouteのstrict prefixからcheckpointを抽出 (5.8)
  -> 通常探索終了
```

Idealが探索範囲内に見つからない場合だけ、`max*Advance` の上限まで探索する。
その場合の結果はCandidate 0件であり、checkpointも0件である（5.7）。

妥協条件の有無は終了条件を変えない。妥協条件はcheckpointの有無だけを変え、
探索範囲、RNG Prediction呼び出し回数、canonical Idealの選択には影響しない。

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

Candidateは常に理想品なので、品質を測る追加キーは存在せず、順位はこの5キーで決まる。

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

### 5.6.6 `resultFilter` の廃止

`resultFilter` は存在しない。Searchが返すのはcanonical Ideal 1件以下であり、
表示側で選り分けるcategoryがないためである。妥協状態の表示の出し分けは
5.8のcheckpoint group表示（primary / secondary、その他の到達点）が担当する。

`routeFilter` は従来どおり機能する。

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
advance bounds  = ConstrainedEnumerationBounds をauthorityとする
```

- `CandidateRouteFilter` を `origin` へ持たせない。現在のRNG値、Engine capability、
  input support、所持武器から成立するRouteをすべて対象にする
- 探索範囲の上限は `ConstrainedEnumerationBounds` だけをauthorityとする。
  `CandidateSearchSettings` を参照しない

**yieldするのはIdeal Candidateだけである。** constrained re-searchは、Plannerが
固定したCandidateのもとで「そのTargetのIdealへ到達する別の方法」を探す仕組みであり、
妥協状態を独立したCandidateとして提案する仕組みではない。妥協状態をここでyieldすると、
Plannerが妥協専用のBuildListEntryを生成することになり、35章の禁止事項に反する。

このpolicyは通常Candidate Searchの `routeFilter` 契約(3章 / 4章)を変更しない。
両者は別の境界である。

#### enumerator outputはBuildCandidateではない

B8-B1のenumeratorは `BuildCandidate` を直接yieldしない。Search Domainのtransientな
semantic resultである `ConstrainedCandidate` をyieldする。

理由。`BuildCandidate` は `id` / `searchRunId` / `createdAt` を必須とし、
通常Searchのcandidate factoryは `CandidateSearchInput.searchRunId` から埋める。
一方 `ConstrainedSearchOrigin` は意図的に `searchRunId` / `settings` /
`routeFilter` を持たない。したがってenumeratorは `BuildCandidate` を完成させられない。

次のrun / persistence metadataをB8-B1 enumeratorのsemantic resultへ混ぜない。

```text
BuildCandidate.id
BuildCandidate.searchRunId
BuildCandidate.createdAt
random / request ID
Clock
enumeration ordinal
```

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

BuildCandidate.checkpointGroups
  = 5.8のcheckpoint抽出をそのCandidateへ適用した結果
```

`CandidateSearchSettings` は、constrained enumerationのfilter authorityでも
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
- canonical Ideal(5.6.3)で探索を終了しない
- TargetのIdeal条件を満たすCandidateだけをyieldする
- deterministicである
- finite boundsを持つ
- cancellation可能である
- Worker yield可能である
- Production RNGのinput-level support契約を維持する
- normal scope Keep predictionは引き続きunsupportedとして扱う(5.9)
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

## 5.7 Candidate出力はcanonical Idealだけである

1 Target 1 requestの出力は、canonical Ideal Candidate 1件または `null` である。

```text
Idealが探索範囲内に存在する    -> canonical Ideal 1件 + そのRouteのcheckpoint
Idealが探索範囲内に存在しない  -> Candidate 0件。checkpointも0件
```

妥協状態を独立したCandidateとして返すことはない。Idealが見つからなかった場合、
妥協状態に到達できることが分かっていてもCandidateは0件である。理由は、
妥協状態は「理想品へ向かう1本の物理Routeの途中状態」としてしか意味を持たず、
その先へ続くRouteが存在しない妥協状態は、continuation可能なcheckpointではなく
単なる行き止まりだからである。

UIは「現在の探索範囲では理想品が見つかりませんでした」と表示する。
「このTargetに理想品は存在しません」と表示してはならない。探索範囲上限を上げれば
見つかる可能性を否定していないためである。

## 5.8 canonical Ideal Routeのcompromise checkpoint

canonical Ideal CandidateのRouteのうち、Targetの妥協条件を満たす **strict prefix**
の到達状態だけをcheckpointとして提示する。

### 5.8.1 strict prefixとpure replay

対象はcanonical Ideal Route自身の操作列 `operations[0 .. n-1]` のうち
`operations[0 .. i]`(`i < n - 1`)を実行し終えた状態である。最終操作 `n - 1` は
理想品を完成させる操作なのでcheckpointにならない。

状態の再構成は **既存の観測traceのpure replay** で行う。

```text
Route baseの5枠とSkill  <- BuildRoute.sourceOwnedWeaponId のOwnedWeapon
reset / keep の結果      <- BuildCandidate.bonusAmendmentTrace
reset_skills の結果      <- BuildCandidate.skillAmendmentTrace
巨戟化時の初期Skill      <- BuildCandidate.conversionSkillTrace
```

したがってcheckpoint抽出は `predictGogmaBonus` / `predictSkills` /
`predictNormalArtian` を **1回も追加で呼ばない**。UI / presentation /
CandidateCardも、checkpointを描画するためにRNG Engineを再実行してはならない。

記録が存在しない状態（blind forgeの5枠、trace以前に永続化されたCandidateなど）は
`known: false` として扱い、checkpointにしない。値を捏造しない。

replayした最終状態がCandidate自身の `finalBonuses` / `restorationBonusScope` /
`seriesSkillId` / `groupSkillId` と食い違う場合は内部不整合であり、
loudly失敗する。短い方へ切り詰めない。

### 5.8.2 2層モデル : groupとopportunity

checkpointは2層で表現する。

```text
CompromiseCheckpointGroup       ユーザーが見る「妥協品としての性能」
  scope
  5枠の順不同multiset(重複数を保存)
  seriesSkillId / groupSkillId
  conditionMatch

CompromiseCheckpointOpportunity 到達機会
  afterOperationIndex
  operationCount / remainingOperationCount
  exact ordered 5枠
  seriesSkillId / groupSkillId
  conditionMatch
```

group identityにslot順は含めない。同じ5枠をslot順違いで持つ2状態は、
ユーザーから見て同じ妥協品なので同じgroupへまとめる。
opportunity側にはexactなslot順を残す。PlannerとTrace Replayは
「実際にその瞬間手に持つ武器」を検証するため、slot順が必要である。

group ID / opportunity IDは `candidateStableKey` とgroup identityから決まる
deterministicな値であり、`searchRunId`、Clock、列挙順序を含まない。

### 5.8.3 複数回の到達をすべて保持する

同じgroupへ2手目と4手目の両方で到達する場合、両方のopportunityを保持する。
早い方を表示上のprimaryとして扱い、後続は「その他の到達点」として開示する。
後続opportunityをDomainから削除しない。Counter競合により早い到達が使えず、
遅い到達だけが実行可能なケースがあるためである。

選択できるのは1 groupにつき最大1 opportunityである。Plannerは選択された
opportunityを別のopportunityへ勝手に読み替えない。

### 5.8.4 表示専用の保守的dominance

表示整理のためだけに、次をすべて満たす場合に限りgroup `w` を
display-secondaryにできる。

```text
scope が等しい
seriesSkillId / groupSkillId が等しい
bonusTypeId ごとのrank降順vectorが b >= w で、少なくとも1箇所で b > w
b の最早opportunityが w の最早opportunity以下の操作数で到達する
Master参照(BonusType / BonusRank / WeaponBonusDefinition)がすべて比較可能
```

Bonus Type構成が異なる場合、Skillが異なる場合、Master参照が比較不能な場合は
dominanceを成立させない。これは表示の優先度だけを決めるものであり、
Domainのgroupもopportunityも削除しない。「劣る」checkpointが、
Counter競合を避けられる唯一の選択肢になりうるためである。

### 5.8.5 開始状態はcheckpointではない

Route baseの開始状態（変換元のOwnedWeaponが既に持っている状態）はRouteのprefixでは
ないので、それが妥協条件を満たしていてもcheckpointにしない。ユーザーが既に
手元に持っているものを「到達点」として提示する意味がないためである。

Target SatisfactionのhasPracticalは従来どおり実際の性能から判定する。
checkpointの有無とは独立である。

## 5.9 normal scope Keepのgame legalityとprediction support

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
- このnullは「このRouteのCandidate結果が特定のabsolute Normal Counter位置へ依存しない」という意味である。「Normal Counterが必ず未確定である」でも「実行してもCounterが進まない」でもない。Normal Counterが確定していてもNormal Artian Predictionだけが利用不能な場合、このvariantが選ばれる。Plan実行時に確定Counterを1進めるかどうかはPlannerの実行時契約であり、`docs/PLANNER_SPEC.md` 7.0.3が正本である
- 通常アーティアを2本以上作成するblind Candidateを生成しない。5枠を読まずResetで全上書きするため、追加forgeは手数・アイテム素材・Normal Counter進行だけを増やす完全劣後経路である
- 変換直後にCandidateを完成させない。変換直後の5枠はunknownであり、Candidateの最終結果へunknownを残さない
- 変換直後にKeep Bonusesを適用しない。これはProduction predictionの制限ではなくunknown入力の問題であり、normal scope Keepの扱い(5.7)とは独立に禁止する
- Reset Skillsだけを行ってCandidateを完成させない
- 最初のResetを実行した時点で `restorationBonusScope = "gogma_artian"` かつ5枠known となり、以降は6.1と同じReset / Keep / Reset Skills semanticsをそのまま使う
- `zeroBonus`(`gogmaAdvance = 0`)のBonus解は存在しない。Bonus軸は最初のResetから始まる。unknownを表すfake bonus setをstream解集合へ入れない
- `estimatedGogmaAdvance` は最初のResetを含めて1以上になり、`maxGogmaAdvance` を通常どおり消費する
- `estimatedSkillAdvance` と `maxSkillAdvance` semanticsは6.1と同一である
- Route最小操作数は `create 1 + convert 1 + reset 1 = 3` である
- `BuildRoute.sourceOwnedWeaponId = null`、変換後のReset / Keep / Reset Skillsも `sourceOwnedWeaponId = null` とする。`referencedOwnedWeaponsHash = null` である
- `searchStateHash` はBase Seed、Skill Counter、Gogma Counterに依存し、NormalArtianCounterに依存しない。後からNormal Counterを確定しても、またその値が変わっても、このCandidateの予測結果semanticsは変わらないためstaleにならない。これはPlan実行後に現在Counterを更新しなくてよいという意味ではない(`docs/PLANNER_SPEC.md` 7.0.3)
- `estimatedNormalAdvance = null` も同じ理由による。Candidate SearchがNormal Counter進行量をabsolute route dependencyとして表現しないことを示すだけで、実行時の物理的なCounter進行とは別概念である
- アイテム素材コストは通常どおり計上する。通常アーティア作成1本分、変換1回分、Reset等の分をそれぞれ含める
- Candidateの保持、順序、Ideal判定、checkpoint抽出は既存規則をそのまま適用し、blind variantを優遇も冷遇もしない

報告。

- blind variantを検索した場合、RouteKind `normal_artian_to_gogma` は `searchedRoutes` に入る。同じRouteKindを同時に `skippedRoutes` へ載せない
- predicted variantが実行されなかったことは `CandidateSearchWarning` で報告する。blind variantが正常に検索された場合、この通知は `severity = "info"` とする。検索は成立しており、生成されたCandidateは通常のCandidateだからである
- 通知は「初期ボーナスを使わないルートで検索した」という成立事実と、predicted variantが使えなかった原因を区別して示す。原因は少なくとも次の2つを別の文言として扱う
  - 対象武器種のレア8 NormalArtianCounterが未確定
  - Normal Artian Predictionまたはそのinput supportが利用不能
  Normal Counterが確定していてもPredictionだけが利用不能な場合があるため、後者を「カウンターが未確定」と説明しない
- 通知本文へ `normal_counter_unconfirmed` などの内部reason enumや英語Domain用語を埋め込まない
- blind variantも不可の場合は、従来どおりpredicted variantのskip理由を `skippedRoutes` へ記録し、blind variantが不可だった理由を `severity = "warning"` の通知へ追加する。このRouteKindは何も検索されていないためである

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
- Keepの起点候補がprotected武器だけの場合も `no_unprotected_source_weapon` としてskipする

## 6.5 既存巨戟 Reset Skills経由

RouteKind。

```ts
"existing_gogma_reset_skills"
```

既存OwnedWeaponの復元ボーナス5枠を変更せず、スキルだけを再付与するRouteである。

必要条件。

- 起点OwnedWeaponが存在する
- 起点OwnedWeaponが `isProtected = false` である
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
- Reset Skillsは武器性能を変更するため、`isProtected = true` の武器を起点にできない
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

PlannerはCandidate SnapshotのBuildRoute.operationsを書き換えない。Routeが具体的な起点
OwnedWeapon IDを持つ場合は検索時点で要求する武器であり、Plannerが別IDへ差し替えない。

Mixed Routeは含まれるamendment種別にかかわらず、起点OwnedWeaponが `isProtected = false` の場合のみ生成する。Reset Skillsだけの場合はMixedではなく `existing_gogma_reset_skills` として生成する。

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
2. 必要アイテム素材数が少ない候補を残す
3. startからの総Counter進行が少ない候補を残す
4. `candidateStableKey` が辞書順で小さい候補を残す

4のtie-breakに `BuildCandidate.id` を使ってはならない(8章)。
ここまで完全一致する2 Candidateはrun非依存のsemantic差を持たないため
比較結果0とし、先に到達した候補をそのまま残す。

---

## 8. 並び順

1 Target 1 requestの出力はcanonical Ideal 1件以下なので、表示ソートは
canonical Idealの選択順序そのものである。

1. estimatedOperationCount昇順
2. estimatedGogmaAdvance昇順
3. estimatedSkillAdvance昇順
4. estimatedNormalAdvance昇順。ただし `null` は最後
5. preferred source match（8.1）
6. `candidateStableKey` 昇順

checkpoint groupの表示順は5.8.4に従う（最早到達、妥協軸の少なさ、stable key）。

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
`BuildCandidate.id` は異なってよいが、`candidateStableKey` と
`checkpointGroups` は完全に一致しなければならない。
これはB6-F1で実装済みである。`BuildCandidate.id` の生成規則
(`searchRunId` を含む `semanticHash`)は変更していない。

5.5.2 / 5.5.3で初回検索の解集合から外す同結果・後続位置の解は、このソート順の
すべてのキーで残す解に劣るか同値である。ただしそれは初回検索の順位付けに
限った話であり、Planner上の代替Counter位置としての価値まで否定するものではない
(5.6.4参照)。

出力打ち切りは存在しない（5.5.7）。合成段階でCartesian productを作ってから
打ち切る設計にもしない。

### 8.1 Targetの優先起点

`TargetWeapon.preferredOwnedWeaponId`（[DATA_MODEL.md](./DATA_MODEL.md) 8.5）はhard filter
ではない。Searchは従来どおり新規Normal / 所持Normal / 所持Gogmaの実行可能Routeをすべて
探索し、preferred以外のRouteを除外しない。

概念的な優先順序。

```text
1. Routeが実行可能であること
2. 既存のoperation cost / Counter advance の比較
3. それらが同等ならpreferredOwnedWeaponIdを起点とするRoute
4. 最終stable key
```

例。

```text
preferred Weaponから Ideal -> 4操作
新規Normalから Ideal       -> 2操作
```

なら新規Normalを優先する。一方で

```text
preferred Weaponから Ideal -> 2操作
別OwnedWeaponから Ideal    -> 2操作
```

でその他条件も同等ならpreferred Weaponを優先する。

判定は

```ts
candidate.route.sourceOwnedWeaponId === target.preferredOwnedWeaponId
```

を基本とする。所持Normal Routeと既存Gogma Routeはsource IDで判定でき、新規Normal Routeは
sourceが `null` のためpreferredにならない。Targetのpreferredが `null` の場合はpreference自体
が無効であり、`null` source同士を一致とみなさない。

#### Comparatorへの入れ方

既存Comparatorへ単純な大きいbonus scoreを加えてはならない。既存のコスト比較をpreferredが
逆転しないよう、**最終stable tie-breakの直前**に明示的なlexicographic preferenceとして
入れる。対象は次のとおり。

- canonical Ideal selection（5.6.3）
- bounded Candidate selection（5.5.7）
- Practical retention後のordering（5.5.6）
- 表示用ソート（本章）
- constrained searchの同様のbounded ordering（5.6.7）
- constrained searchのstreaming traversal priority（5.6.7）

#### constrained searchのstreaming delivery順

constrained enumerationには2つの出力経路がある。

- `enumerateConstrainedCandidates()`: 全件を集めてから最終sortする配列API
- `visitConstrainedCandidates()`: Candidateを1件ずつconsumerへ渡すstreaming API

Production PlannerのConstrained re-searchは後者を使い、trial Plannerが採用可能と判断した
時点で`'stop'`を返して打ち切る。したがって最終sortはProductionの候補採用順に効かない。
preferred sourceのtie-breakは、最終配列sortだけでなく**traversal priority自体**へ反映し、
streaming deliveryの順序にも効かせること。

lattice cellのtraversal priorityでは、既存のCandidate品質・コスト相当比較をすべて終えた後、
安定semantic keyより前にpreferred sourceを置く。

```text
categoryRank
operationCount
gogmaAdvance
skillAdvance
normalAdvance
idealCloseness
bonus / material / skill semantic comparisons
preferredSourceRank
stable semantic key
internal node tie-break
```

preferred sourceはRoute baseごとに固定値であり、同一matrix内で`i` / `j`が増えても変化しない。
親cellと子cellは常にこの項目で同値となり比較は次の項目へ落ちるため、lazy latticeが依存する
coordinate-wise monotonicityを損なわない。異なるbase間のcellだけを分離する。

この配置はlazy traversalの正しさ、off-axis budget、frontierのmonotonicity、cancellation、
`examinedCandidates`のいずれも変更しない。

#### 変更してはいけないもの

preferredのために次を変更してはならない。同一コストCandidate間の選択・順序だけに影響させる。

- Search horizon
- canonical Idealのcost境界
- checkpoint抽出の結果
- RNG Prediction call count
- Stream探索深さ
- Gogma / Skill / Normal Counter semantics

#### Candidate identityへ入れない

Candidate ID、`candidateStableKey`、dedup key、`BuildCandidateMeaning` fingerprintへ
preferred情報を入れない。preferredはCandidateそのものの意味ではなく、Target側の選好だからである。

---

## 9. 条件緩和案の廃止

`RelaxationSuggestion` と `CandidateSearchResult.relaxationSuggestions` は存在しない。

Searchが返すのはcanonical Ideal 1件以下であり、「候補が少ない」という状態は
「探索範囲内にIdealが無かった」だけである。この場合にDomainが提示するのは
探索範囲上限の引き上げであって、Target条件の自動緩和案ではない。

妥協をどこまで許すかはTargetの妥協条件がすでに表現しており、
その妥協をRouteのどこで受け取るかは5.8のcheckpoint選択が表現する。
Target条件は従来どおりユーザーの明示操作以外で変更しない。

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

`referencedOwnedWeaponsHash` は[DATA_MODEL.md](./DATA_MODEL.md)の正規化規則に従う。参照IDはRouteとReset Bonuses、Keep Bonuses、Reset Skills Operationから収集する。共通項目は `id`、`kind`、武器種、属性、保存中の復元ボーナス5枠順、isProtectedとし、巨戟だけシリーズスキル、グループスキルを加える。`status` はユーザー管理ラベルであり計算に影響しないため、name、memo、日時と同じく除外する。Routeに無関係なOwnedWeaponも含めない。

追加方式は個別追加だけである。1 Target 1 requestが返すCandidateは
canonical Ideal 1件以下なので、一括追加の対象がない。

追加時には、そのCandidateについてユーザーが選択したcheckpoint opportunityの
IDを `BuildListEntry.selectedCheckpointOpportunityIds` として保存する。

```ts
createBuildListEntry(candidate, target, {
  selectedCheckpointOpportunityIds,
});
```

初期選択は空である。既に同一semanticのCandidateがBuildListに存在する場合は、
既存Entryをそのまま返し、既存のcheckpoint選択を上書きしない。Search側は
「この候補は作成リストに追加済みです。チェックポイントは作成リストで変更して
ください。」と案内する。checkpoint選択の変更は作成リスト側の操作である。

制約。

- 1 groupにつき選択できるopportunityは最大1件
- Candidate Snapshotに存在しないopportunity IDはfail closedで拒否する
- checkpoint選択はCandidateのidentityにもhashにも入らない。選択を変えても
  BuildListEntry自体はstaleにならない
- 一方でPlanの `buildListEntriesHash` には入る。選択を変えると既存Planは
  再計算対象になる
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
- Candidate Routeが参照する起点武器の状態が変わった場合、BuildListEntryを `owned_weapon_changed` としてstale扱いにする。`status` は非semanticであり、status変更だけではstaleにしない
- Routeに無関係なOwnedWeaponの変更、または参照武器のname、memo、日時だけの変更ではBuildListEntryをstaleにしない
- BuildCandidateも現在RNG状態Hashと一致しなければ現行検索結果として扱わず、再検索を促す
- BuildCandidateも現在の参照武器Hashと一致しなければ現行検索結果として扱わず、再検索を促す
- CalculationContext非互換のBuildCandidateとBuildListEntryはstaleとして表示し、Planner入力に使用しない

---

## 13. テスト観点

## 13.1 Condition Test

- 理想5枠が順不同で一致し、gogma scopeの場合だけBonus Idealになる
- normal scopeの5/5一致はBonus Ideal / Practical / Alternativeすべて不一致とし、Candidateにしない
- normal scopeでもunknown BonusRankを明示的Domain Errorとして返す
- 実用BonusConditionが正しく判定される
- RequiredExCountが正しく判定される
- Alternativeは1 Rule / 1 Optionだけを使い、未置換枠のIdeal Rankを維持する
- SkillCondition `all` / `any` が正しく判定される
- 理想条件が実用条件より優先分類される
- 理想条件を満たす完成品が実用条件も満たす(Ideal ⇒ Practical 包含不変条件)
- 妥協判定が両軸Idealのとき `null` を返し、checkpointにならない
- 近似 (similarity) の概念が存在しない

## 13.2 Route Test

- 通常Counter未確定なら通常アーティア経由のpredicted variantをskipする
- 対象武器種・属性のnormal scope WeaponBonusDefinitionが利用不能なら `master_data_unavailable` で通常アーティア経由をskipする
- 既存巨戟がない場合、既存巨戟Routeをskipする
- Keepがcurrent 5slotのfamilyを維持した一意の次結果を返し、同一Counterでselection branchを作らない
- Keep後の完成5枠がRNG Engine Predictionだけから生成される
- RNG EngineがKeep未対応ならRouteをskipする
- BuildRouteの操作列から実行順を復元できる
- protected武器を起点とするReset Bonuses / Keep Bonuses / Reset Skills / Mixed Routeを生成しない
- protected武器でも現在性能がTarget条件を満たす場合は `existing_gogma_current` の操作0候補を生成する
- `status` をRoute eligibilityの条件にしない。未分類 / 実用 / 理想のいずれでも同じ扱いとする
- amendmentの互換起点候補がprotected武器だけなら各amendment Routeへ `no_unprotected_source_weapon` を返す
- 復元ボーナス条件を満たす既存武器から `existing_gogma_reset_skills` 候補を生成できる
- Reset Skills候補のfinalBonusesが起点OwnedWeaponのrestorationBonusesと一致する
- Reset Skills候補ではSkill Prediction結果だけがseriesSkillId / groupSkillIdへ反映される
- protectedな武器からは、statusがpractical / idealでもReset Skills Routeを生成しない
- protectedな互換武器しかない場合、不要なSkill / Gogma Predictionを呼ばない
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
- Normal Counterが確定していてNormal Artian Predictionだけが利用不能な場合も、blind variantが検索され `predictNormalArtian` を1度も呼ばない
- その場合でもblind Candidateの `create_normal_artian` はCounter位置nullのままであり、`estimatedNormalAdvance` も `null` である。Plan実行時のCounter進行は `docs/PLANNER_SPEC.md` 7.0.3のtest観点で確認する
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
- checkpoint抽出のために `predictGogmaBonus` / `predictSkills` / `predictNormalArtian`
  の呼び出し回数が1回も増えない

## 13.2.2 Candidate Composition Test

- 合成件数が `|B| + |K| - 1` になり、`|B| × |K|` にならない
- Bonus軸候補はSkill anchorを固定し、Skill軸候補はBonus anchorを固定する
- 両軸から外れた `(B[i], K[j])`(`i > 0` かつ `j > 0`)を生成しない
- 合成した `RouteOperation[]` がBonus操作列 → Skill操作列の順で保存される
- `estimatedGogmaAdvance` と `estimatedSkillAdvance` がstreamごとに独立して正しい
- 合成結果が理想品でない場合はCandidateにならない
- 既存巨戟Routeで `d = 0` かつ `resetCount = 0` になる合成を候補化しない
- `b0` / `k0` が5.5.2 / 5.5.3のdeterministic orderingで一意に決まり、Route baseの評価順を変えても変わらない

## 13.2.3 Termination and Checkpoint Test

- 初回検索がcanonical Idealを確定した時点で通常探索を終了する
- 確定したIdealが8章の標準ソート順で最小であり、RouteKindの評価順を入れ替えても同一になる
- canonical Idealのtie-breakが `searchRunId` / `createdAt` / `BuildCandidate.id` に
  依存せず、`searchRunId` を変えて同一入力を再検索しても同じIdealが選ばれる
- checkpointの有無でcanonical Idealの選択が変わらない
- Idealが見つからない場合だけ `max*Advance` の上限まで探索する
- Idealが見つからない場合はCandidate 0件であり、妥協状態へ到達できてもCandidateを返さない
- 現在Bonusがgogma scopeでIdealと完全一致する起点についてBonus探索を行わない
- normal scopeでIdealラベル5/5・Skill一致のconversion D=2をIdealとせず、同じ5枠を返す
  Reset Bonuses後のgogma scope D=3まで探索し、そのCandidateをcanonical Idealにする
- 同じ5枠のnormal d=0 / gogma d=1をfull-prefix / incremental両方で保持する
- 同一scope・同一multisetは最小advanceを保持し、異なるscopeの同点は安定順序で決める
- normal scopeを継承した既存Gogmaの5/5一致でもReset探索を0回化しない
- 現在SkillがidealSkillConditionを満たす起点についてSkill探索を行わない
- 同一結果の後続Counter位置を「支配された」として恒久除外しない

### checkpoint抽出

- canonical Ideal Routeのstrict prefixだけをcheckpoint評価する
- 最終操作（理想品を完成させる操作）をcheckpointにしない
- canonical Ideal Routeから分岐する妥協状態をcheckpointにしない
- 記録のない状態（blind forgeの5枠など）をcheckpointにしない
- 開始OwnedWeaponが妥協条件を満たしていてもcheckpoint opportunityにしない
- 同一Bonus multiset / scope / Skillでslot順だけが違う状態を同じgroupへまとめる
- opportunity側にexact slot順が残る
- 同じ妥協品が2手目と4手目に存在した場合、両opportunityを保持する
- 最早opportunityがgroup代表として選ばれ、後続opportunityを削除しない
- conservative dominanceで下位互換groupをdisplay-secondaryにできる
- display dominanceでDomainのgroupもopportunityも削除しない
- 異なるSkill、異なるBonus Type構成、比較不能なMaster参照をdominance扱いしない
- 後から到達するgroupが、より早く到達する下位groupをdominateしない
- group ID / opportunity IDが `searchRunId` / Clock / 列挙順に依存しない

## 13.2.4 Target Invariant Test

Target validation(B7)はIdeal既達成早期終了より先に実装する。
以下はB7で追加済みの観点であり、13.2.3のIdeal既達成早期終了のうち
Skill stream側はB1で実装済み、Bonus stream側はB2で実装済みである。

- `idealBonuses` が `practicalBonusConditions` をすべて満たす。AlternativeにはIdeal包含を要求せず、元種類・個数・Optionを検証する
- `idealSkillCondition` を満たす `(seriesSkillId, groupSkillId)` が
  明示設定された `practicalSkillCondition` も満たす
- 包含が成立しないTargetWeapon定義を保存できない
- 包含が成立しない保存済みTargetWeaponはCandidate Searchの対象から
  warning付きで除外される

## 13.2.5 Constrained Enumeration Test

5.6.7の契約に対するテスト観点である。実装はB8-B1で行う。

- constrained enumerationが `ConstrainedSearchOrigin` 起点から再評価し、
  `conflictingCounter + 1` へ後方固定されない
- canonical Ideal終了を適用しない
- 同一結果の後続Counter位置解をyieldできる
- Idealを満たさないCandidateをyieldしない
- `origin` がPlanner計算開始時のcurrent validated snapshotから構成され、
  `searchRunId` / `routeFilter` / `settings` を持たない
- 過去のUI Candidate Search requestを `origin` として要求しない
- route scopeが現時点で成立する全Routeであり、UI一時filterを継承しない
- 探索範囲の上限が `ConstrainedEnumerationBounds` だけで決まり、
  `CandidateSearchSettings` を参照しない
- route policyが広がってもIdeal条件を満たさないCandidateをyieldしない
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

## 13.3 Candidate Test

- 重複候補が排除される
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

## 13.4 Checkpoint選択Test

- checkpoint初期選択が空である
- 異なるgroupから複数checkpointを選択できる
- 同一groupから複数opportunityの選択をrejectする
- Candidate Snapshotに存在しないopportunity IDをrejectする
- checkpoint selection変更でBuildListEntry自体はstaleにならない
- checkpoint selection変更でPlanの `buildListEntriesHash` が変わる
- 同一semanticのCandidateを再追加しても既存checkpoint selectionを上書きしない

## 13.5 Worker Test

- 単一TargetWeapon検索でprogressが返る
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


### 妥協条件version 6の判定理由と監査記録

妥協判定 `conditionMatch`（bonus: ideal/practical/alternative、skill: ideal/practical）は、
Candidate本体ではなく5.8のcheckpoint group / opportunityが保持する。
これはTarget定義と到達状態から導出した説明情報であり、Candidate ID / stable key /
deduplication key / meaning fingerprint / searchStateHashには追加しない。
UIは保存された判定理由を「ボーナス判定: 実用 / 代替」「スキル判定: 理想 / 実用」と表示する。
両軸Idealは理想品そのものなのでcheckpointとして存在しない。

Productionベンチマークの旧wildcard条件も明示的な理想構成基準へ変更するため、旧versionの測定記録と負荷が異なる。
過去のBrowser Worker測定値は当時のartifactとして保持する。今回のVitestは意味・不変条件の検証であり、新しいBrowser性能測定の代用ではない。
