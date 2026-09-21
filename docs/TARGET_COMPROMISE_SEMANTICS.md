# TargetWeaponの理想品基準の妥協条件

本書はTarget妥協条件変更のtask-specific formal specificationである。
authorityは REQUIREMENTS > 本書 > 他の正式仕様 > 実装 > tests > chat / handoff。

## Domain契約

理想5枠を唯一の基準とし、順不同のmultisetで比較する。
ユーザー決定によりすべてのBonus判定はgogma_artian scopeを要求する。
通常由来scopeは受理せず、通常作成・巨戟化RouteはReset後の予測から評価する。
Practical Bonusは種類と各種類の個数を完全一致させる。条件のある種類だけ、
全枠の最低RankとEX最低数を指定する。未設定種類はRank multisetも完全一致する。
必要個数はidealBonusesから導出し、入力・保存しない。同一種類の条件は1件まで。
Ideal自身が各Practical条件を満たさなければ保存・Search入力を拒否する。

Alternative Bonusは元種類ごとに1 Rule、その中に代替先optionsを持つ。
Candidateは1 Rule内の1 Optionだけで、1以上maxReplacementCount以下の枠を置換する。
残りの枠はIdealの部分multisetと完全一致し、PracticalのRank緩和を併用しない。
置換先が既にIdealにある場合も、元の枠を完全一致で残したうえで追加された枠だけを
Optionの最低Rank / EX最低数の対象とする。異なる元種類・異なるOptionの複合置換は禁止。
0枠置換はAlternativeではなくIdealの判定を使用する。

Skillは別軸。Ideal Skillを優先し、Ideal不一致の場合だけ明示したPractical Skillを評価する。
Practical Skillの両IDがnullなら妥協未設定であり、wildcardではない。
明示されたSkill条件のIdeal包含validationと参照validationは維持する。

`CandidateCategory` は存在しない。Domain評価はbonusMatch
(ideal / practical / alternative / null)とskillMatch (ideal / practical / null)を返し、
両軸Idealなら理想品、それ以外の受理組み合わせは「妥協状態」である。

妥協状態は独立したCandidateではない。canonical Ideal RouteのSkill lane / Bonus laneの
途中状態（intermediate state）をlaneごとに提示し、ユーザーがlaneごとに採用する状態を選ぶ。
両laneが同時に受理状態を持った瞬間が妥協checkpointであり、Plannerが実行順へ組み込む
（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.7 / 5.8、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7.5）。

## Validation

Practical: 種類はIdeal内、種類重複禁止、有効な最低Rank、整数EX数0..Ideal内個数、Ideal包含。
Alternative: 元種類はIdeal内、元種類重複禁止、整数最大置換数1..元種類個数、options非空。
Option: 有効な種類・Rank、元と先の同一種類禁止、先種類重複禁止、整数EX数0..最大置換数。
Rank順はMaster order、EXはMaster isExで評価し、表示名やID文字列から推測しない。

## Search

SearchはTargetの妥協設定にかかわらずIdeal-onlyである。妥協条件はintermediate stateの
有無だけを変え、探索範囲、canonical Idealの選択、RNG Prediction呼び出し回数の
いずれも変えない。

妥協条件がまったく未設定のTargetは、canonical Ideal Routeの各laneにintermediate stateが
1件も現れないというだけである。
Normal / Gogma / Skillの独立性、Cross、determinism、保護、blind Normal、予測traceを維持する。
評価のための追加RNG Predictionを行わない。

## 永続化と互換性

Dexie schemaを1から2に上げる。旧Practical / OR条件は新条件へ推測変換せず、
旧TargetのPractical Bonus・OR・Practical Skillを未設定へリセットする。Ideal、ID、名称、優先度、メモを保持する。
再設定を促す情報を残す。Candidate、BuildListEntry、Plan、履歴の内容は変更・削除しない。

CalculationContext.appSchemaVersionは、妥協条件導入時に5から6へ上げた。
現行は11（lane別intermediate stateと改善優先）であり、旧version 1..10のCandidate /
BuildListEntry / Planはすべて非互換。
既存のcalculation_context_changedによるfail closedを使う。RNG version、Master version、
AppSettings.schemaVersion、RngState.schemaVersionは変更しない。
searchStateHashと参照武器hashはRNG・武器依存の既存定義を維持する。
Target definition hashは新Rule構造を含める。

Import/Exportの全置換Persistence / Application Service基盤（JSON parser、full validation、
保存service）は実装済みであり、Settings画面のUIは未接続である（[DATA_MODEL.md](./DATA_MODEL.md) 15.3）。
この文書の執筆時点のExportRootはschemaVersion 6であった（現行は10）。将来のimportでも旧条件の推測変換を禁止し、
旧versionを新Targetとして直接受理しない。同じfail-closed Target移行を使用する。
履歴artifactを新評価で再分類しない。

## UI

PracticalはIdealに含まれる種類、Ideal内個数(read-only)、最低Rank、EX最低数を表示する。
未設定種類は理想条件のままと説明する。Alternativeは元種類・最大置換数・optionsを編集する。
1元種類/1候補のみ、未置換枠は理想のまま、実用Bonusとは非併用であることを明示する。
武器種・属性変更でBonus依存条件をリセットし、Ideal編集後の不整合はvalidationで拒否する。
Search結果はcanonical Ideal 1件と、そのRouteのスキル候補（Skill lane）・復元ボーナス候補
（Bonus lane）の一覧である。候補は既定でOFFであり、ユーザーがlaneごとに明示的に選択した状態と
「理想品までの改善優先」（生産計画に任せる / スキルを優先 / 復元ボーナスを優先）が
BuildListEntryへ保存され、作成リストでも変更できる。改善優先はTargetWeaponへ保存しない。
UIがSkill × Bonusの組み合わせを列挙することはない。


### 妥協条件version 6の判定理由と監査記録

妥協判定はlaneごとの `match`（Bonus: ideal/practical/alternative、Skill: ideal/practical）を
intermediate state group / opportunityが保持し、Build List snapshotへそのまま複写する。
Plannerが到達したcheckpointのmilestoneは両軸の組み合わせを `conditionMatch` として持つ。
これらはTarget定義と到達状態から導出した説明情報であり、Candidate ID / stable key / deduplication key / meaning fingerprint / searchStateHashには追加しない。
旧artifactではフィールドを省略でき、推測補完・再分類しない。
UIは保存された判定理由を「ボーナス判定: 実用 / 代替」「スキル判定: 理想 / 実用」と表示する。
両軸Idealは理想品そのものなのでcheckpointとしては存在しない。

Productionベンチマークの旧wildcard条件も明示的な理想構成基準へ変更するため、旧versionの測定記録と負荷が異なる。
過去のBrowser Worker測定値は当時のartifactとして保持する。今回のVitestは意味・不変条件の検証であり、新しいBrowser性能測定の代用ではない。

Build Listへの同一意味の候補の重複追加を防ぐ際はCalculationContext互換性も確認する。
旧versionの項目を削除・上書きせず、新versionの再検索結果を別項目として追加できる。
Candidate meaning fingerprint自体は変更しない。途中採用状態の選択と改善優先はfingerprintに
入らないため、同一意味のCandidateを再追加しても既存の選択を上書きしない。
