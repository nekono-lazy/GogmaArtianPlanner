# Master Data 監査状況

## 目的

v1に同梱する静的Master Dataの確認状況を記録する。2026-08-29の第8.2～第8.3実装で、プロジェクトオーナー確認済み情報と属性・出現スキル制約を入力・条件評価用Masterへ反映した。

Manifestの `dataVersion` は4。`gameVersion` は引き続き `unknown-initial` であり、特定ゲームバージョンへの適合確認は未完了である。

## 監査結果（2026-08-29）

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

## UIへの影響

- 所持武器・目標武器の武器種、属性、scope別復元ボーナス、Rank、シリーズ／グループスキルは正式選択肢として利用できる。
- 所持巨戟アーティアとBuildCandidateは、conversion直後の `normal_artian` またはamendment後の `gogma_artian` scopeを明示して保持する。目標武器の既存bonus条件は `gogma_artian` scopeを基準とする。
- 所持通常アーティアの復元ボーナスは `normal_artian` scopeに限定する。
- 無属性では両scopeとも属性強化を選択できない。ライト／ヘビィボウガンの属性強化不可ルールも維持する。これは現行Master selector（`allowsElementBonus`）の挙動であり、ゲームの抽選availabilityとは一致しない条件がある（スラッシュアックスの無属性構成は属性強化を持ち得、弓の毒・麻痺・睡眠は属性強化を抽選しない。[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1）。UI / Validationは後続PR-Cで、Masterの武器種・scope定義とProduction family availabilityの積を返す複合availability selectorへ揃える。
- 通常UIのスキル選択肢は有効なSeries 21件、Group 16件だけを表示する。無効レコードは履歴参照用にIDを保持する。
- 通常アーティアPrediction・Debug用の復元ボーナス定義は `normal_artian` scopeを使用する。
- LotteryMasterは無効のまま維持し、Production RNGはprovenance付きRNG-specific reference-verified tableとEngine内部定数を使用する。reference-verifiedは参照repositoryとの一致であり、全実ゲーム条件でのgame-verifiedを意味しない。disabled LotteryMasterだけを理由にProduction Routeをskipしない。
- 素材名とMaterial Costは未検証のため、必要素材を推測して表示しない。
- Bonus Type Mappingから巨戟Rankまたは完成5枠を生成しない。conversionはnormal scopeを継承し、Reset / Keep結果はreference-verified tableを使用するProduction RNG Engineに委ねる。game-verified範囲は実機fixtureの確認範囲に限定する。
- Current Masterの有効Series 21 / Group 16は入力・表示用集合であり、Production skill抽選poolの21 × 14をMaster enabled数から再構築しない。差分の栄光の誉れ、祝祭の巡り等は実機確認まで未確認とする。

## Production Search readiness と advisory

`getMasterDataStatus(master, 'search')` の判定契約は次のとおりである。

```text
isProductionReady   Searchそのものを利用できるか（core Masterの有無だけで決まる）
blockingReason      isProductionReady = false の理由。Search自体が利用不能
advisories          Searchは利用できるが、結果の一部が制限される注意（型で区別）
```

- disabled LotteryMasterはProduction Searchのblocking reasonではない。Production RNGは
  `LotteryMaster` を読まず、`RngMasterSubset` / `SearchMasterSubset` / `PlannerMasterSubset`
  にも含めない。LotteryMasterのenabled有無でSearch readinessは変化しない
- MaterialCostがunavailable（usableなenabled `MaterialCostMaster` entryがない）でも
  Searchのblocking reasonではない。`material_cost_unverified` advisoryとして扱い、
  「候補検索は利用できる」ことが分かる文面で表示する
- MaterialCost advisoryは必要素材の表示とアイテム素材量による候補比較に関する注意である。
  unavailableな場合、Candidateの `requiredMaterials` 空配列は「素材が0」ではなく
  「素材コスト情報を利用できない」を意味し、UIは「なし」と表示しない。未検証コストは
  Searchのmaterial tie-breakにも読まれないため、現在のall-disabled状態では候補間に有意な
  差を生じない
- MaterialCost availabilityは「enabled entryが1件以上あるか」というcurrent stateの判定だけ
  である。一部enabledなら完全検証済み、全operation coverage済み、といった完全性ルールは
  Repositoryに権威がないため設けない
- Search Routeの実行可否はこのgeneric statusではなく、RngState、Normal Counter、
  Owned Weapon、RngEngine capability、concrete `getPredictionSupport()`、Predictionが実際に
  依存するsemantic Master（WeaponBonusDefinition等）、protected state等のRoute eligibilityで
  route-localに判定する
- 通常ユーザー向けSearch UIには「抽選マスターデータ」「通常アーティア経由の検索は利用
  できません」といったLotteryMaster由来の警告を表示しない。reference pool / weight等の
  技術的provenanceはdocs / Debugの責務である
