# Master Data 監査状況

## 目的

v1に同梱する静的Master Dataの確認状況を記録する。2026-08-29の第8.2～第8.3実装で、プロジェクトオーナー確認済み情報と属性・出現スキル制約を入力・条件評価用Masterへ反映した。

Manifestの `dataVersion` は3。`gameVersion` は引き続き `unknown-initial` であり、特定ゲームバージョンへの適合確認は未完了である。

## 監査結果（2026-08-29）

| Master | 登録件数 | 有効件数 | 確認済み件数 | 本番UI利用 | 情報源 / 未確認事項 |
| --- | ---: | ---: | ---: | --- | --- |
| MasterManifest | 1 | — | 1 | 部分可 | dataVersion 3。ゲームバージョンは未確認。 |
| WeaponTypeMaster | 14 | 14 | 14 | 可 | プロジェクトオーナー確認済み14武器種。 |
| ElementMaster | 10 | 10 | 10 | 可 | プロジェクトオーナー確認済み10属性。無属性は属性強化不可として明示。 |
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
- 無属性では両scopeとも属性強化を選択できない。ライト／ヘビィボウガンの属性強化不可ルールも維持する。
- 通常UIのスキル選択肢は有効なSeries 21件、Group 16件だけを表示する。無効レコードは履歴参照用にIDを保持する。
- 通常アーティアPrediction・Debug用の復元ボーナス定義は `normal_artian` scopeを使用する。
- LotteryMasterは無効のまま維持し、Production RNGはprovenance付きRNG-specific reference-verified tableとEngine内部定数を使用する。reference-verifiedは参照repositoryとの一致であり、全実ゲーム条件でのgame-verifiedを意味しない。disabled LotteryMasterだけを理由にProduction Routeをskipしない。
- 素材名とMaterial Costは未検証のため、必要素材を推測して表示しない。
- Bonus Type Mappingから巨戟Rankまたは完成5枠を生成しない。conversionはnormal scopeを継承し、Reset / Keep結果はreference-verified tableを使用するProduction RNG Engineに委ねる。game-verified範囲は実機fixtureの確認範囲に限定する。
- Current Masterの有効Series 21 / Group 16は入力・表示用集合であり、Production skill抽選poolの21 × 14をMaster enabled数から再構築しない。差分の栄光の誉れ、祝祭の巡り等は実機確認まで未確認とする。
