# Master Data 監査状況

## 目的

v1に同梱する静的Master Dataの確認状況を記録する。
Manifestは `gameVersion: unknown-initial` であり、notesにも未検証placeholderであることが明記されている。
このため、以下の有効レコードも本番用の確認済みゲームデータとしては扱わない。

`MASTER_DATA.md` に記載された具体的IDはスキーマ例であり、ゲームデータ一式の正確性を保証する情報源ではない。

## 監査結果（2026-08-29）

| Master | 登録件数 | 有効件数 | 確認済み件数 | 本番利用 | 現在の情報源 / 今後必要な情報 |
| --- | ---: | ---: | ---: | --- | --- |
| MasterManifest | 1 | — | 0 | 不可 | `manifest.json`。確認済みゲームバージョンとデータセットの出典が必要。 |
| WeaponTypeMaster | 1 | 1 | 0 | 不可 | `MASTER_DATA.md` の例に対応するplaceholder。全武器種と各属性の確認済み一覧が必要。 |
| ElementMaster | 1 | 1 | 0 | 不可 | 仕様例に対応するplaceholder。利用可能な全属性の確認済み一覧が必要。 |
| BonusTypeMaster | 1 | 1 | 0 | 不可 | 仕様例に対応するplaceholder。全種別・カテゴリ・順序の確認済み情報が必要。 |
| BonusRankMaster | 1 | 1 | 0 | 不可 | 仕様例に対応するplaceholder。全ランク・順序・EX判定の確認済み情報が必要。 |
| WeaponBonusDefinition | 1 | 1 | 0 | 不可 | 1組だけのplaceholder。全対応武器種の組み合わせと効果値の確認済み情報が必要。 |
| SeriesSkillMaster | 1 | 1 | 0 | 不可 | 仕様例に対応するplaceholder。選択可能な全シリーズスキルの確認済み一覧が必要。 |
| GroupSkillMaster | 1 | 1 | 0 | 不可 | 仕様例に対応するplaceholder。選択可能な全グループスキルの確認済み一覧が必要。 |
| LotteryMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用レコード。確認済み表現とデータが必要。weight/internalValueは推測しない。 |
| MaterialMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用レコード。確認済み素材ID・名称が必要。 |
| MaterialCostMaster | 1 | 0 | 0 | 不可 | 無効化されたValidation用レコード。確認済み操作コストが必要。推測しない。 |

## UIへの影響

型付きUIとValidation境界を動作させるため、LoaderとSelectorは有効なplaceholderを引き続き返す。
所持武器・目標武器・候補検索画面では、表示中の選択肢が不完全かつ未検証であることを警告する。
無効化されたLotteryと素材関連fixtureは本番計算用Selectorの結果に含まれない。

第8.1実装では、追加のゲームデータを確認できるリポジトリ内資料が存在しなかったため、Master JSONのレコード追加は行っていない。
