# Master Data 監査状況

## 目的

v1に同梱する静的Master Dataの確認状況を記録する。2026-08-29の第8.2実装で、プロジェクトオーナー確認済み情報を入力・条件評価用Masterへ反映した。

Manifestの `dataVersion` は2。`gameVersion` は引き続き `unknown-initial` であり、特定ゲームバージョンへの適合確認は未完了である。

## 監査結果（2026-08-29）

| Master | 登録件数 | 有効件数 | 確認済み件数 | 本番UI利用 | 情報源 / 未確認事項 |
| --- | ---: | ---: | ---: | --- | --- |
| MasterManifest | 1 | — | 1 | 部分可 | dataVersion 2。ゲームバージョンは未確認。 |
| WeaponTypeMaster | 14 | 14 | 14 | 可 | プロジェクトオーナー確認済み14武器種。 |
| ElementMaster | 10 | 10 | 10 | 可 | プロジェクトオーナー確認済み10属性。 |
| BonusTypeMaster | 6 | 6 | 6 | 可 | 共通3種、通常専用2種、巨戟専用1種。 |
| BonusRankMaster | 5 | 5 | 5 | 可 | 通常 / I / II / III / EX。通常→巨戟Rank変換は未確認。 |
| WeaponBonusDefinition | 227 | 227 | 227 | 可 | scope別の武器種・Bonus Type・Rank組み合わせ。効果実数値は未確認で、計算に使用しない。 |
| ArtianBonusTypeMapping | 5 | — | 5 | 可 | 通常→巨戟のBonus Type対応。斬れ味／装填から統合TypeへのMany-to-Oneを含む。 |
| SeriesSkillMaster | 25 | 25 | 25 | 可 | プロジェクトオーナー確認済みUI選択肢。抽選確率は未確認。 |
| GroupSkillMaster | 17 | 17 | 17 | 可 | プロジェクトオーナー確認済みUI選択肢。抽選確率は未確認。 |
| LotteryMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用placeholder。weight、pool、internalValue、確率は未確認。 |
| MaterialMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用placeholder。素材名は未確認。 |
| MaterialCostMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用placeholder。必要数量は未確認。 |

## UIへの影響

- 所持武器・目標武器の武器種、属性、scope別復元ボーナス、Rank、シリーズ／グループスキルは正式選択肢として利用できる。
- 所持武器・目標武器・BuildCandidateの復元ボーナスは `gogma_artian` scopeに限定する。
- 通常アーティアPrediction・Debug用の復元ボーナス定義は `normal_artian` scopeを使用する。
- Lotteryが無効なため、通常アーティアLotteryを必要とする検索Routeは `master_data_unavailable` でskipする。
- 素材名とMaterial Costは未検証のため、必要素材を推測して表示しない。
- Bonus Type Mappingから巨戟Rankまたは完成5枠を生成しない。最終結果は将来の検証済みRNG Engineに委ねる。
