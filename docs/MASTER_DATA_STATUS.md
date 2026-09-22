# Master Data 監査状況

## 目的

v1に同梱する静的Master Dataの確認状況を、時点付きの監査記録として残す。過去の監査結果は現在値で上書きせず、履歴として保持する。

## 現在の状態

Manifest（`src/data/master/manifest.json`）がcurrent authorityであり、`dataVersion` は4、`gameVersion` は引き続き `unverified` 扱いの `unknown-initial` である。特定ゲームバージョンへの適合確認は未完了であり、本監査では確定しない。

`src/data/master` は `scripts/generate-verified-master-data.mjs` が生成する。生成対象はManifest、WeaponTypeMaster、ElementMaster、BonusTypeMaster、BonusRankMaster、WeaponBonusDefinition、SeriesSkillMaster、GroupSkillMasterであり、ArtianBonusTypeMapping、LotteryMaster、MaterialMaster、MaterialCostMasterは手動保守のJSONである。

## 監査結果（2026-09-16）

件数はcurrent Master JSONを機械的に集計した実測値である。

| Master | 登録件数 | 有効件数 | 確認状態 | 本番UI利用 | 情報源 / 未確認事項 |
| --- | ---: | ---: | --- | --- | --- |
| MasterManifest | 1 | — | 部分確認 | 部分可 | `dataVersion = 4`。`gameVersion = unknown-initial` は未確認のまま維持する。 |
| WeaponTypeMaster | 14 | 14 | プロジェクトオーナー確認済み | 可 | 14武器種。近接11 / 遠距離3。 |
| ElementMaster | 10 | 10 | プロジェクトオーナー確認済み | 可 | 10属性。`element.none` のみ `allowsElementBonus = false`。これはMaster selector上の属性強化除外であり、Production lottery availabilityのauthorityではない（[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1 / 6.3.1）。 |
| BonusTypeMaster | 6 | 6 | プロジェクトオーナー確認済み | 可 | 共通3種（基礎攻撃力強化 / 会心率強化 / 属性強化）、通常専用2種（斬れ味強化 / 装填数強化）、巨戟専用1種（斬れ味・装填強化）。 |
| BonusRankMaster | 5 | 5 | プロジェクトオーナー確認済み | 可 | 通常 / I / II / III / EX。`bonus_rank.i` はMasterとして保持するが、`gogma_artian` scopeのWeaponBonusDefinitionには使用しない。 |
| WeaponBonusDefinition | 187 | 187 | プロジェクトオーナー確認済み | 可 | `normal_artian` 53件、`gogma_artian` 134件。巨戟のRankは基礎攻撃力強化 / 会心率強化がII・III・EX、属性強化がII・EX、斬れ味・装填強化が通常・EXである。効果実数値は未確認で、計算に使用しない。 |
| ArtianBonusTypeMapping | 5 | — | プロジェクトオーナー確認済み | 可 | 通常→巨戟のBonus Type対応。斬れ味強化・装填数強化→斬れ味・装填強化のMany-to-Oneを含む。 |
| SeriesSkillMaster | 25 | 21 | 一覧は確認済み / 抽選確率は未確認 | 可 | 25件を保持し、巨戟に出現しない花舞・踊火・夢灯・祝謡の祈り4件を無効にする。 |
| GroupSkillMaster | 17 | 16 | 一覧は確認済み / 抽選確率は未確認 | 可 | 17件を保持し、巨戟に出現しない拳を極めし者を無効にする。 |
| LotteryMaster | 1 | 0 | 未確認 | 不可 | 無効化されたValidation用placeholder 1件。weight、pool、internalValue、確率はいずれも未確認。 |
| MaterialMaster | 1 | 0 | 未確認 | 不可 | 無効化されたValidation用placeholder 1件。素材名は未確認。 |
| MaterialCostMaster | 1 | 0 | 未確認 | 不可 | 無効化されたValidation用placeholder 1件。必要数量は未確認。 |

## 2026-08-29監査からの主な変更

- Manifest `dataVersion` を3から4へ更新した。`gameVersion = unknown-initial` は変更していない。
- `gogma_artian` scopeのRank I WeaponBonusDefinitionを削除し、WeaponBonusDefinitionは227件から187件になった。以前「巨戟Rank I」と認識していた実機観測は、巨戟化直後で `normal_artian` scopeを保持していた状態の誤認であり、`gogma_artian` scopeのRank Iは再導入しない。`bonus_rank.i` 自体はBonusRankMasterに残り、`normal_artian` scopeは影響を受けない。
- 削除時に後続定義の `sortOrder` を振り直していないため、WeaponBonusDefinitionの `sortOrder` はdataVersion 3の値のまま最大227である。`scripts/generate-verified-master-data.mjs` もこの割り当てを再現する。
- 復元ボーナスのavailability selectorとして、Masterの武器種・scope定義とProduction family availabilityの積を返す複合selectorを導入した（[MASTER_DATA.md](./MASTER_DATA.md) 15.1）。
- 所持武器・目標武器・目標妥協条件の各editor、新規draft、entity validation、Identification Wizard STEP 2をこの複合selectorへ揃えた。Master JSONと `dataVersion`、RNG Prediction outputは変更していない。

## UIへの影響

- 所持武器・目標武器の武器種、属性、scope別復元ボーナス、Rank、シリーズ／グループスキルは正式選択肢として利用できる。
- 所持巨戟アーティアとBuildCandidateは、conversion直後の `normal_artian` またはamendment後の `gogma_artian` scopeを明示して保持する。目標武器の既存bonus条件は `gogma_artian` scopeを基準とする。
- 所持通常アーティアの復元ボーナスは `normal_artian` scopeに限定する。
- 復元ボーナスの選択肢とValidationは、Masterの武器種・scope定義とProduction family availabilityの積を返す複合availability selectorを使う（PR-Cで実装済み。[MASTER_DATA.md](./MASTER_DATA.md) 15.1、[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1）。スラッシュアックスの無属性構成は通常／巨戟とも属性強化を選択でき、弓の毒・麻痺・睡眠とライト／ヘビィボウガンは属性強化を選択できない。Masterの `allowsElementBonus`（無属性で属性強化を除外）は `getBonusDefinitionsForWeapon()` のMaster-only挙動として残るが、UI / Validationのauthorityではなく、ゲームルールとして記述しない。
- 通常UIのスキル選択肢は有効なSeries 21件、Group 16件だけを表示する。無効レコードは履歴参照用にIDを保持する。
- 通常アーティアPrediction・Debug用の復元ボーナス定義は `normal_artian` scopeを使用する。
- LotteryMasterは無効のまま維持し、Production RNGはprovenance付きRNG-specific reference-verified tableとEngine内部定数を使用する。reference-verifiedは参照repositoryとの一致であり、全実ゲーム条件でのgame-verifiedを意味しない。disabled LotteryMasterだけを理由にProduction Routeをskipしない。
- 素材名とMaterial Costは未検証のため、Master価格付きの必要素材（`requiredMaterials`）を推測して
  表示しない。ユーザー向けの「必要素材・費用の目安」はMasterではなく `src/domain/cost` の出典付き
  固定データから導出する表示専用の値であり、Masterの状態に依存しない
  （[MASTER_DATA.md](./MASTER_DATA.md) 13.1、[REQUIREMENTS.md](./REQUIREMENTS.md) 22.1）。
- Bonus Type Mappingから巨戟Rankまたは完成5枠を生成しない。conversionはnormal scopeを継承し、Reset / Keep結果はreference-verified tableを使用するProduction RNG Engineに委ねる。game-verified範囲は実機fixtureの確認範囲に限定する。
- Current Masterの有効Series 21 / Group 16は入力・表示用集合であり、Production skill抽選poolの21 × 14をMaster enabled数から再構築しない。差分の栄光の誉れ、祝祭の巡り等は実機確認まで未確認とする。

## Production Search readiness と advisory

`getMasterDataStatus(master)` の判定契約は次のとおりである。

```text
isProductionReady   画面そのものを利用できるか（core Masterの有無だけで決まる）
blockingReason      isProductionReady = false の理由。画面自体が利用不能
```

かつて存在した `material_cost_unverified` advisory（「素材コストは未検証です…」）は、
表示専用Cost Estimateの導入で廃止した。Candidate SearchはMaster価格付きの `requiredMaterials` を
表示しなくなったため、MaterialCostMasterの状態がユーザーに見える結果を狭めることはなく、
advisoryとして伝えるべきことが無い。

- disabled LotteryMasterはProduction Searchのblocking reasonではない。Production RNGは
  `LotteryMaster` を読まず、`RngMasterSubset` / `SearchMasterSubset` / `PlannerMasterSubset`
  にも含めない。LotteryMasterのenabled有無でSearch readinessは変化しない
- MaterialCostがunavailable（usableなenabled `MaterialCostMaster` entryがない）でも
  Searchのblocking reasonではなく、advisoryも出さない。Candidateの `requiredMaterials` 空配列は
  「素材が0」ではなく「Master価格付きコスト情報を利用できない」を意味するが、通常UIはこの値を
  表示せず、Routeから導出する表示専用Cost Estimateを表示する。未検証コストは
  Searchのmaterial tie-breakにも読まれないため、現在のall-disabled状態では候補間に有意な
  差を生じない
- 表示専用Cost Estimateを成立させるために未検証のMaterialCostMaster placeholderを
  `isEnabled = true` へ変更しない。Cost EstimateはMasterの状態に依存しない
- Search Routeの実行可否はこのgeneric statusではなく、RngState、Normal Counter、
  Owned Weapon、RngEngine capability、concrete `getPredictionSupport()`、Predictionが実際に
  依存するsemantic Master（WeaponBonusDefinition等）、protected state等のRoute eligibilityで
  route-localに判定する
- 通常ユーザー向けSearch UIには「抽選マスターデータ」「通常アーティア経由の検索は利用
  できません」といったLotteryMaster由来の警告を表示しない。reference pool / weight等の
  技術的provenanceはdocs / Debugの責務である

## 過去の監査記録

以下は当時の記録であり、現在値で上書きしない。

### 監査結果（2026-08-29）

| Master | 登録件数 | 有効件数 | 確認済み件数 | 本番UI利用 | 情報源 / 未確認事項 |
| --- | ---: | ---: | ---: | --- | --- |
| MasterManifest | 1 | — | 1 | 部分可 | dataVersion 3。ゲームバージョンは未確認。 |
| WeaponTypeMaster | 14 | 14 | 14 | 可 | プロジェクトオーナー確認済み14武器種。 |
| ElementMaster | 10 | 10 | 10 | 可 | プロジェクトオーナー確認済み10属性。無属性は `allowsElementBonus = false`（Master selector上の属性強化除外。Production lottery availabilityのauthorityではない。[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1）。 |
| BonusTypeMaster | 6 | 6 | 6 | 可 | 共通3種、通常専用2種、巨戟専用1種。 |
| BonusRankMaster | 5 | 5 | 5 | 可 | 通常 / I / II / III / EX。conversionではRank変換せずnormal scopeを継承する。 |
| WeaponBonusDefinition | 227 | 227 | 227 | 可 | scope別の武器種・Bonus Type・Rank組み合わせ。効果実数値は未確認で、計算に使用しない。 |
| ArtianBonusTypeMapping | 5 | — | 5 | 可 | 通常→巨戟のBonus Type対応。斬れ味／装填から統合TypeへのMany-to-Oneを含む。 |
| SeriesSkillMaster | 25 | 21 | 25 | 可 | 25件を保持。巨戟に出現しない花舞・踊火・夢灯・祝謡の祈り4件は無効。抽選確率は未確認。 |
| GroupSkillMaster | 17 | 16 | 17 | 可 | 17件を保持。巨戟に出現しない拳を極めし者は無効。抽選確率は未確認。 |
| LotteryMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用placeholder。weight、pool、internalValue、確率は未確認。 |
| MaterialMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用placeholder。素材名は未確認。 |
| MaterialCostMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用placeholder。必要数量は未確認。 |
