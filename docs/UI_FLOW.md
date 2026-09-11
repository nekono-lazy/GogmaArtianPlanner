# モンハンワイルズ 巨戟アーティア厳選Planner
## UI_FLOW.md

## 1. この文書の目的

この文書は、初期版アプリの画面構成、主要導線、入力制約、表示ルール、実行ナビ、再計算導線、スマートフォン対応、テスト観点を定義する。

UIはReactで実装する。RNG、Search、Plannerの詳細ロジックはUIから分離し、Domain ServiceまたはWeb Worker経由で呼び出す。

---

## 2. 全体画面

初期版の主要画面。

```text
Home / Dashboard
RNG Setup
Normal Counter Setup
Owned Weapons
Target Weapons
Search Results
Build List
Production Plan
Execution Navigator
Settings / Import Export
Debug Details
```

スマートフォンを主要利用環境として想定する。

---

## 3. 共通UI方針

- 通常画面ではSeed / Counterを表示しない
- Debug Mode ONの場合のみ内部RNG情報を表示する
- 重要な操作は1画面1目的にする
- 復元ボーナス5枠は常に5つの固定スロットとして表示する
- ただし判定上は順不同であることをUI内で軽く示す
- 長時間検索中は進捗とキャンセルを表示する
- 総work量が探索中に増える処理では、推定percentを作らず活動中であることを示す
- 作成ナビは必ず1操作ずつ進める
- 高速モードは表示しない
- 手動作成順固定UIは表示しない

---

## 4. Home / Dashboard

目的。

現在の準備状況と次にやるべき操作を示す。

表示。

- RNG状態: 項目ごとの未設定 / 確定 / 要確認
- 利用可能機能: Gogma予測 / Skill予測 / 通常アーティア検索 / Planner
- 通常アーティアCounter: 確定済み武器種数
- 所持アーティア数（通常／巨戟）
- 有効な目標武器数
- 作成リスト候補数
- Active Planの有無

主要アクション。

- RNGを設定する
- 通常Counterを特定する
- 所持武器を登録する
- 目標武器を登録する
- 候補検索を開始する
- 作成プランを見る
- 実行ナビを再開する

状態別CTA。

- RNG未設定: RNG Setupへ誘導
- TargetWeaponなし: Target Weaponsへ誘導
- Search結果なし: Search Resultsへ誘導
- Active Planあり: Execution Navigatorへ誘導
- Plan stale: 再計算へ誘導

---

## 5. RNG Setup

目的。

Base Seed、Gogma Counter、Skill CounterをProduction Prediction用に項目ごとに設定する。Counter Gateはlegacy / diagnostic / manual / import compatibility値として引き続き保存・表示できるが、Production Predictionの必須項目またはauthorityではない。判明している値だけの適用を許可する。

タブ。

1. GogmaSeedFinder Import
2. 直接入力
3. 観測から検索

## 5.1 GogmaSeedFinder Import

入力。

- 貼り付けテキスト

操作。

- 解析
- 適用

表示。

- 読み取れた値
- 読み取れなかった値
- warning

制約。

- 読み取れた項目だけを選択して適用可能
- 読み取れない項目があっても、他の項目の適用を妨げない
- 適用した各KnownValueのsourceを `gogma_seed_finder_import` にする

## 5.2 直接入力

入力。

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate

制約。

- Counterは0以上の整数
- Base Seedは正規化後に保存
- 4項目をすべて入力する必要はない
- 入力した各KnownValueのsourceを `manual` にする
- 空欄は既存値を削除しない。確定解除は別操作にする
- Counter Gate入力欄はC5-E2C2時点ではUIから削除済みと扱わない。後続UI taskで詳細値への移動や説明追加を検討する
- persisted Gateが200、54、または未設定でも、他の必要値とsupportが同じならProduction active Predictionのavailabilityと結果は同じである

## 5.3 観測から検索（legacy generic Seed Search contract）

本節は旧generic Seed Search UI案を記録する履歴契約であり、現在のProduction v1では提供しない。Production v1のRNG特定UIは5.4 Skill-first Identification Wizardを使用する。

旧generic案ではSeed検索とCounter検索を別モードとして想定していた。Counter Gate候補を含むこのgeneric Seed Search contractはcurrent Production v1 Identification Wizardではsupersededであり、`supportsSeedSearch = false` のためinactiveとする。専用Wizardのavailability flagとして流用しない。

入力。

- 観測種別
- 武器種
- 属性（Gogma Bonus / Skillでは必須、Normal ArtianではEngineが不要なら省略可）
- 復元ボーナスまたはスキル
- Seed検索範囲またはCounter検索範囲
- 既知Counter / Counter Gate候補

結果。

- 一致なし
- 複数候補
- 一意候補

一意候補の場合のみ適用可能。

- Seed検索ではBase Seed候補を表示する
- Counter検索では既知Base Seedに対するCounter候補を表示する
- Normal Artian、Gogma Bonus、Skillの観測を追加できる
- 長時間処理中は進捗とキャンセルを表示する
- RNG Engineが本番Seed検索未対応の場合は利用不可理由を表示し、推測結果を出さない
- Gogma Bonus / Skill観測では属性未選択のまま検索できない
- Normal Artian観測ではEngineが属性を使わない場合に属性入力を省略できる

## 5.4 Skill-first Identification Wizard

RNG Setupから専用Wizardを開始し、完了後のreview / adoption結果をRNG Setupへ反映する。C5-E2C7でDialog UIとCoordinator接続を実装済みである。実Browser Worker benchmarkはC5-E2C8で、Skill live-game verificationはC5-E2C9で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md) / [C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。C5-E2C10 Production Identification activationは完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。

対象ユーザー。

- 通常アーティアおよび巨戟アーティアを利用可能なゲーム進行状態
- Production Skill / Gogma Predictionはactive branchを使用する
- Counter Gateを入力、探索、Observation、resultへ含めない
- Skillの54、Gogmaの35はactive branch選択用の内部representativeであり、actual Gateとして表示・保存しない

開始時の必須案内。

- 観測中は結果の記録が終わるまでゲーム状態を保存しない
- 開始前にセーブデータのバックアップ方法と自動保存の設定・挙動を確認する
- 画面で案内された操作だけを順番に連続して行う
- 観測終了後は調査前の状態へ戻してから結果を採用する
- ゲーム側の保存仕様やセーブデータの安全をアプリが断定・保証しない

STEP 1。

1. Normal ArtianをGogma Artianへconversionし、自動付与されたSeries / Group SkillをObservation 1として記録する
2. Reset Skillsを連続して行い、Observation 2以降へSeries / Groupの両方を記録する
3. approximate Skill Counterはcenter + ±Nを基本入力とし、計算後のinclusive start / endを併記する。初期推奨幅は11候補である
4. Base Seedとstarting Skill CounterをWorkerで探索する
5. 完全・non-truncatedな結果がexactly oneになるまでSTEP 2へ進めない

STEP 2。

1. STEP 1の一意なcanonical Base Seedを使用する
2. Reset Bonusesを連続して行い、各結果をordered five-slot Observationとして記録する
3. approximate Gogma Counterはcenter + ±Nを基本入力とし、inclusive start / endを併記する
4. starting Gogma CounterをWorkerで探索する
5. 完全・non-truncatedな結果がexactly oneの場合だけreviewへ進む

結果別UI。

- `unique`: 次STEPまたはreviewへ進む
- `multiple`: 候補をユーザーに選ばせず、追加のReset Skills / Reset Bonuses観測を要求して同じ検索を再実行する
- `zero`: 観測入力、Counter範囲、操作順を確認させ、自動で範囲を拡張しない
- `cancelled`: 入力を保持して観測画面へ戻し、新requestIdで再実行できる
- `invalid_input` / `unsupported_input`: 該当入力またはsupport理由を表示する
- `unexpected_error` / Worker unavailable / duplicate requestId: no-matchへ変換せず、system / request errorとしてretry導線を表示する

review / adoption。

- 調査前の開始Skill Counter `S`、調査前の開始Gogma Counter `G`と明記する
- 観測中の操作回数を加えた `S + N` / `G + M`を保存しない
- 調査前状態へ戻したことを明示確認してからadoptする
- Base SeedをProduction `normalizeSeed()`で再validation / canonicalizeする
- Base Seed、Skill Counter、Gogma Counterのsourceを既存の `observation` とし、Counter GateとNormal Counterを変更しない

activation条件。

- 独立したSkill live-game verificationはC5-E2C9で完了した。Production activationはC5-E2C10の別タスクとして判断し、完了した
- 実Browser Worker benchmarkはC5-E2C8で完了済みであり、測定記録は[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)、live verification記録は[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)、activation判断記録は[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)をauthorityとする
- C5-E2C10 activationはdefault runtime経路の監査、integrated regression、dev / production previewのbrowser smokeによって判断した。新しいfeature flag、RngEngine capability、再配線、Production RNG semantics変更、Seed range defaultを追加していない
- Skill Seed rangeのmulti-worker orchestrationはcontiguous / non-overlapping chunk、deterministic merge、global progress、全Workerへのcancel propagation、Worker failureの明示errorを満たす
- Identification availabilityはWorker/application levelでSkill / Gogma Counterを個別に扱い、新しいRngEngine capability flagを追加しない

---

## 6. Normal Counter Setup

目的。

レア8通常アーティアの武器種別Counterを観測結果から特定する。レア6・7はv1で表示・編集しない。

一覧表示。

- 武器種
- レア度は8固定のため通常UIでは列を表示しない
- 状態: 未設定 / 候補複数 / 確定
- 観測数
- 最終観測日時

操作。

- 観測を追加
- Counter検索
- 確定解除

観測入力。

- 武器種
- 復元ボーナス5枠

通常アーティア観測の `rarity` はDomain上に保持するが、v1 UIでは8を内部的に自動設定し、レア度選択を表示しない。

制約。

- 一致が1件なら確定
- 複数一致なら追加観測を促す
- 未確定の武器種のレア8 Counterは通常アーティア経由検索に使わない
- Counterの直接修正は通常UIに表示しない
- Debug Mode ONの場合のみ、警告と確認を伴う手動修正を許可してよい

---

## 7. Owned Weapons

目的。

所持している通常アーティアと巨戟アーティアを個別管理する。

一覧表示。

- 名称
- 種類（通常アーティア／巨戟アーティア）
- 武器種
- 属性
- 復元ボーナスscope（通常継承／巨戟amendment）
- 復元ボーナス5枠
- シリーズスキル（巨戟のみ）
- グループスキル（巨戟のみ）
- 状態（巨戟のみ。通常は「—」）
- 保護
- 関連目標

操作。

- 新規登録
- 編集
- 複製
- 削除
- Material / Practical / Ideal切替
- 保護ON/OFF
- 旧実用品を素材用に変更
- 新規登録時の「通常アーティアとして登録」切替。初期値は巨戟

入力制約。

- 復元ボーナスは必ず5枠
- 通常アーティアはscopeを `normal_artian` に固定する。巨戟アーティアは、最初のBonus amendment前の通常継承かamendment後の巨戟tierかを明示入力し、選択scope、武器種、属性に対応したWeaponBonusDefinitionだけを表示する
- 無属性では通常／巨戟とも属性強化を表示しない。ライト／ヘビィボウガンも属性にかかわらず表示しない
- 通常アーティアではシリーズ／グループスキルとstatus入力を表示せず、保護初期値をOFFにする
- 通常アーティアはレア8として自動登録し、レア度選択UIを表示しない
- 巨戟アーティアの従来のstatusと保護初期値を維持する
- 既存武器の種類変更は互換項目の初期化を伴うためv1 UIでは禁止する
- 新規巨戟アーティア作成時だけ、Materialは保護OFF、Practical / Idealは保護ONを初期値にする
- 登録済み巨戟アーティアの通常のstatus変更ではProtectionを自動上書きしない。Protectionは独立項目とする
- `isProtected = true` の武器はPlannerが素材消費・Reset Bonuses・Keep Bonusesへ使用しない
- `restorationBonusScope = "normal_artian"` の巨戟アーティアにはKeep Bonusesを提示せず、最初のamendmentとしてReset Bonusesだけを提示する
- Plannerが消費できるのはMaterialかつ保護OFFの武器だけ
- 旧実用品を素材用に変更する場合は確認後に `status = Material` と保護OFFを同時適用する
- 削除時にActive Planで参照されている場合は警告する

Plan外で旧実用品を素材用へ変更する場合は、この画面で確認ダイアログを表示する。Active Plan中に計画された素材化は、Execution Navigatorの独立した `change_owned_weapon_status` Stepで確認する。

選択肢。

- 素材用に変更: `status = Material`、`isProtected = false` とし、計画外変更ならActive Planをstale判定する
- 保管: 状態と保護を維持する

自動的な素材化、Plannerによる保護解除、確認前の状態変更は禁止する。

---

## 8. Target Weapons

目的。

欲しい完成武器の条件を登録する。

一覧表示。

- 名称
- 武器種
- 属性
- 優先度
- 検索対象ON/OFF
- 理想ボーナス要約
- 実用ライン要約
- スキル条件要約

操作。

- 新規登録
- 編集
- 複製
- 削除
- 検索対象ON/OFF

入力セクション。

1. 基本情報
2. 理想復元ボーナス
3. 実用ライン
4. 理想スキル
5. 実用スキル

制約。

- 優先度デフォルトは3
- 理想復元ボーナスは5枠完全指定
- 実用ラインはBonusConditionとAlternativeBonusConditionGroupで表現する
- 複雑な任意論理式UIは作らない

---

## 9. Search Results

目的。

TargetWeaponごとに候補を検索し、作成リストへ追加する。

表示構造。

- TargetWeapon切替
- 結果フィルタ: すべて / 理想 / 実用 / 近似
- 経路フィルタ: すべて / 通常アーティア経由（新規作成・所持通常の両方） / 既存巨戟から
- 候補一覧

スマートフォン。

- TargetWeaponは横スワイプまたはタブで切替
- 候補カードは縦スクロール
- フィルタは上部に固定してよい

候補表示。

- 完成復元ボーナス
- 復元ボーナスscope（変換直後のnormal-tierか、amendment後のgogma-tierかを誤認させない表示）
- シリーズスキル
- グループスキル
- 理想との差分
- 到達までのおおよその操作量
- 推奨作成経路
- 既存巨戟のスキルのみ再付与経路では、復元ボーナスを維持すること
- 所持通常アーティア経由では「所持通常アーティアから巨戟化」と変換元の名称
- 必要素材
- 作成リスト追加状態
- 近似表示と類似度（該当する実用品のみ）
- 作成ルート内の `reset_bonuses` / `keep_bonuses` については、その操作直後の予測復元ボーナス5枠
- 通常アーティアCounter未確定の強制Resetルート([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)では、
  作成する通常アーティアの復元ボーナス内容を問わないことを操作ラベルへ明示する。
  予測していない5枠を表示しない

操作。

- 検索開始
- 検索キャンセル
- 個別追加
- 理想候補一括追加
- 実用候補一括追加
- 理想＋実用一括追加
- 条件緩和案を確認

制約。

- RngState全体の確定は要求しない
- CapabilityがあるRouteだけを検索し、不足値に依存するRouteはskip理由を表示する
- 選択対象の全Routeが実行不能な場合のみ検索開始不可
- TargetWeaponなしなら検索開始不可
- 通常Counter未確定Routeはskip理由を表示
- Route実行に必要なWeaponBonusDefinition等のMaster Dataが利用不能な場合は `master_data_unavailable` としてskip理由を表示する。disabled LotteryMasterだけを理由にProduction Routeをskipしない
- protected武器を起点とするReset Bonuses / Keep Bonuses Routeは検索結果へ表示しない
- Reset Bonuses / Keep Bonusesの起点候補がprotected武器だけの場合は「保護されていない起点武器がない」とskip理由を表示する
- Reset Skillsのみの経路は非破壊操作として扱い、protectedなPractical / Ideal武器からも検索結果へ表示できる
- 通常アーティア経由では、候補位置までのforge数、最後の1本だけの巨戟化、conversion時の初回Skill、必要なfirst Reset、その後のReset / Keep / Reset Skillsを実行順に表示する
- 既存の「通常アーティア最大進行量」入力は `maxNormalAdvance`、すなわち最大forge回数を表す。最大0-based offsetではなく、候補offsetの表示が必要なら `0 ... maxNormalAdvance - 1` とする
- normal-tier bonusを持つ巨戟ではKeepを最初に表示せず、first Reset後だけKeepを表示する。
  これはProduction Keep predictionの未対応によるものであり、ゲームルール上の禁止ではない
- conversionだけのRouteでGogma Counter不足をskip理由にせず、Base Seed / Skill Counter不足、Skill Predictionまたはconcrete semantic input support不足を区別して表示する。persisted Counter Gate不足をskip理由にしない
- レア8、非保護、かつTargetと武器種・属性が一致する所持通常アーティアだけを変換元候補として表示する
- 条件緩和案は選択されるまでTargetWeaponへ適用しない
- 「実用」は `category = practical`、「近似」は `category = practical AND isSimilarToIdeal = true` を表示する
- 検索中は Target単位の `completedTargets / totalTargets`、現在の目標武器名、
  現在のphase（準備中 / 探索中 / 結果を整理中）、現Targetでsettleした探索ステップ数を表示する。
  progress barはTarget単位の完了率だけをpercentとして扱い、Target内の探索ステップ数を
  percentへ変換しない。Target内の総work量は探索中に増えるため未知である
- 現在の目標武器はTarget探索の開始時点で表示する。Target完了までcurrent Targetが
  分からない状態にしない
- Search Worker自体が異常終了した場合は検索中表示を解除し、ページ再読み込みを促す
  errorを表示する。v1ではWorkerの自動再生成やページ自動reloadを行わない
- skip理由の文言は、ゲームルール上の禁止とProduction予測未対応を混同しない。
  normal scope継承状態のKeepは「現在の予測エンジンでは予測未対応」と表示し、
  「最初にReset必須」とは表示しない
- 候補詳細の作成ルートでは、`reset_bonuses` / `keep_bonuses` の各操作について
  操作直後の予測復元ボーナス5枠をslot 1 - 5の順で表示する。表示都合で
  bonusType順・rank順・multiset正規化順へ並べ替えない。Keepはslot位置ごとに
  familyを保持するため、slot順そのものが意味を持つ
- 予測結果は `BuildCandidate.bonusAmendmentTrace` が示す `operationIndex` に対応させて表示し、
  同一操作種別が連続しても対応がずれないようにする
- `reset_bonuses` / `keep_bonuses` 以外のOperationには予測復元ボーナスを表示しない
- `bonusAmendmentTrace` を持たない既存Candidateは予測結果を表示せず、記録がない旨だけを示す。
  stale扱いにしない
- 予測結果はSearch / Domainが確定した値を表示するだけとし、UIスレッドでProduction RNGを
  再実行しない
- `no_owned_weapon_available` の文言は武器種を限定しない。武器種はRouteKind labelが示す

---

## 10. Build List

目的。

Plannerに検討させる候補集合を確認・調整する。

表示。

- TargetWeaponごとのBuildListEntry
- category
- Candidate Snapshot
- route
- estimatedOperationCount
- 競合しそうな資源
- 優先度
- stale状態と理由

操作。

- 候補を外す
- TargetWeapon優先度を変更
- Planner探索上限の詳細設定
- Planner実行

制約。

- 作成順の手動固定は提供しない
- Plannerが採用しない可能性があることを表示する
- BuildCandidateの検索結果とBuildListEntryを同一Entityとして扱わない
- staleなBuildListEntryはPlanner入力に含めず、再検索または再追加を促す
- 有効なBuildListEntryが0件ならPlanner実行不可
- Target条件、検索に使用したRNG状態、Routeが参照する起点武器・素材武器、CalculationContext変更時にEntryのstale理由を表示する
- RNG変更によるstaleは `rng_state_changed` と表示し、再検索・再追加へ誘導する
- Route参照武器のボーナス、スキル、status、isProtected変更によるstaleは `owned_weapon_changed` と表示し、再検索・再追加へ誘導する
- Routeと無関係なOwnedWeapon変更、または参照武器の名前、メモ、日時だけの変更ではEntryをstale表示しない
- CalculationContext非互換は `calculation_context_changed` と表示する

### 10.0 Planner詳細設定

Search Resultsと同じ「詳細設定」Accordionを置き、Beam Searchの探索上限を変更できる。

| 表示名 | `PlannerOptions` |
| --- | --- |
| 最大計画ステップ数 | `maxPlanSteps` |
| 最大探索状態数 | `maxExpandedStates` |
| Beam幅 | `beamWidth` |

説明文。

```text
最大計画ステップ数
作成ルートとして許可する最大ステップ数です。
長いルートで上限に達した場合は増やしてください。

最大探索状態数
Plannerが評価する状態数の上限です。
探索未完了になった場合は、この値を増やして再実行してください。

Beam幅
各探索段階で残す候補状態数です。
通常は変更不要な高度な設定で、大きくすると探索品質が上がる可能性がありますが、
処理量も増えます。
```

制約。

- 初期値は `defaultPlannerOptions` だけをauthorityとする
- 「既定値に戻す」で `defaultPlannerOptions` へ戻す
- 3項目とも1以上の整数のみ有効とし、無効な値はfield errorを表示して
  「生産計画を作成」をdisabledにする
- 無効な値をPlannerへ渡さない
- 推測による固定最大値は設けない。長時間化は既存のWorker実行とキャンセルで扱う
- 選択した `maxExpandedStates` が実行中progressの分母になる
- 設定はBuildList画面のruntime UI stateであり、再読み込みで既定値へ戻る
- B8 orchestration boundsとB9 what-if boundsはこの詳細設定に出さない

### 10.1 探索未完了の表示

`PlannerResult.termination.status === "incomplete"` の場合は、探索上限で打ち切られ、
完成した生産計画を作成できなかったことを明示する（PLANNER_SPEC 7.2.1）。

表示内容。

```text
生産計画の探索が完了していません

最大探索状態数 10,000 に到達しました。
すべての目標武器を含む完成計画を作成できませんでした。
「詳細設定」の「最大探索状態数」を増やして、もう一度生産計画を作成してください。

探索状態数: 10,000 / 10,000
完成した目標武器: 1 / 2
```

`max_plan_steps` へ到達した場合は「最大計画ステップ数」の見直しを案内する。
両方へ到達した場合は両方を表示する。

制約。

- UIはtypedな `termination` だけを読み、`PlannerWarning.message` を解析しない
- incompleteの場合はPersistenceを呼ばず、`/plans/:planId` へ遷移しない
- partial Planの全Stepを表示する必要はない
- 到達したbound、設定値、探索状態数、完成Target数、設定見直し案内を表示する
- `status === "exhausted"` は探索未完了ではない。従来どおり
  「現在の入力から作成できる生産計画はありませんでした。」を表示する
- `status === "cancelled"` は従来どおりキャンセルのnoticeを表示する

### 10.2 Planner実行成功後の遷移

`plannerResultPersistenceService.savePlannerOrchestrationResult()` がnon-nullの
ProductionPlanを返した場合だけ、その保存済みPlanの `/plans/:planId` へ遷移する。
遷移先のIDはPersistenceが返したPlanの `id` だけをauthorityとする。

以下をauthorityにしない。

```text
Worker resultのPlan ID
Active Plan
最新Plan
遷移前に生成したID
```

保存前に遷移しない。`savePlannerOrchestrationResult()` が `null` を返した場合は
遷移せず、Plan未生成のnoticeをBuild Listに表示する。保存失敗、cancel、
`invalid_conflict_resolution` によるfail closedでも遷移しない。

---

## 11. Production Plan

目的。

Plannerが生成した作成計画を確認する。

表示。

- Plan status
- Plan概要
- 目標武器ごとの作成ルート
- 採用BuildListEntryとCandidate Snapshot
- RejectedBuildListEntryと理由
- BuildListEntry基準の競合と解決結果
- 競合ごとの推奨候補とユーザー選択
- 必要素材合計
- タイムライン形式のPlanStep

操作。

- 作成開始
- 再計算
- Plan破棄
- Debug詳細表示
- 生成時CalculationContext

routeの `planId` に対応するPlanを
`ProductionPlanRepository.getProductionPlan(planId)` で取得し、その保存済みPlanだけを
表示する。該当Planが無い場合は、Active Planまたは最新Planを推測して表示しない。

表示中Conflictのauthorityは `ProductionPlan.conflicts`、what-ifとPlanner再計算の入力authorityは
各操作開始時点のcurrent persisted stateから `createPlannerInput()` で新規構築した
`PlannerInput` とする。`baseSnapshot` からPlannerInputを復元せず、古いWorker inputまたは
過去のSearch requestを再利用しない。

### 11.0 読み取り専用のPlan内容確認

保存済みProductionPlanの内容確認は、what-if / Planner再計算のstate machineから独立させる。
`getProductionPlan(planId)` でexact persisted Planを取得できた時点で内容を表示し、
Worker preparationの実行中、preparation失敗後、`status === 'stale'` のいずれでも
保存済み内容を隠さない。planIdのPlanが存在しない場合だけ、内容を表示せずnot foundとする。

表示authorityは常にそのexact persisted Planである。Active Plan / 最新Planへfallbackせず、
Worker resultを表示authorityにせず、BuildCandidateからPlanStepを再構成せず、
Candidate routeからPlanを再計算せず、UI側でRNG予測または `expectedResult` の再生成を行わない。

保存済みPlanおよび `baseSnapshot` のCalculationContextがcurrentと互換でない場合も、
statusやStepを読取時に書き換えずexact persisted内容を表示する。ただしそのPlanは
`calculation_context_changed` による再計算対象として扱い、Worker preparation、what-if、
競合選択、実行へ進めない。version 2 ProductionPlanはversion 3 runtimeでこの扱いになる。

構成は次の順とする。

```text
Plan概要
目標武器ごとの作成ルート
計画全体の実行順
既存のConflict / what-if UI
```

#### Plan概要

- Plan status
- Plan ID
- 作成日時
- 全Step数
- 目標武器数
- 確保予定数

目標武器数は、そのPlanのStepから確認できるdistinct TargetWeapon ID数とする。
確保予定数は `steps[].expectedResult?.shouldSecure === true` のStep数だけをauthorityとし、
Target件数や `selectedBuildListEntryIds.length` を武器本数と仮定しない。

#### 目標武器ごとの作成ルート

各TargetWeaponについて、そのTargetへ帰属するPlanStepをglobal `step.order` 昇順で表示する。
帰属は明示的persisted fieldだけで判断する。

```ts
relatedTargetIds = union(
  step.progressedTargetWeaponIds ?? [],
  step.targetWeaponId !== null ? [step.targetWeaponId] : [],
)
```

- shared physical Stepは `progressedTargetWeaponIds` により複数Targetへ帰属する
- `reserve_weapon` のようにRoute進行を伴わないStepは `targetWeaponId` により帰属する
- 同じTarget IDを1Step内で重複させない
- `targetWeaponId === null` かつ `progressedTargetWeaponIds` が空のStepは、
  目標武器ごとのルートに含めず、計画全体の実行順にだけ含める

`progressedTargetWeaponIds.length > 1` のStepは各Target側へ表示してよいが、それはpresentation上の
帰属表示であり、物理操作を複数回行う意味にしてはならない。「共有操作」badge等で、計画全体では
1回だけ実行するStepであることを示す。

#### 計画全体の実行順

authorityは `ProductionPlan.steps`、表示順は `step.order` の昇順とする。UI独自の並べ替えや
Candidate順への変換を行わない。shared physical Stepもここでは1回だけ表示する。

#### legacy Plan

`plan.steps.some(step => step.progressedTargetWeaponIds === undefined)` のPlanをlegacyとする。

legacy Planでも保存済み内容は表示する。ただし目標武器ごとの作成ルートには、共有Target進行情報の
保存機能追加前に作成されたため一部の共有操作が表示されない可能性がある旨のwarningを表示し、
計画全体の実行順の確認を促す。

`undefined` からshared Targetを推測せず、Candidate / BuildListEntryから過去のshared attributionを
再構成しない。legacyでも `step.targetWeaponId` によるprimary関連表示は行ってよい。

#### PlanStepの予測復元ボーナス

`reset_bonuses` / `keep_bonuses` を含む各Stepの予測復元ボーナスは、
`PlanStep.expectedResult.restorationBonuses` だけをauthorityとする。Candidateの
`bonusAmendmentTrace` / `finalBonuses` / `route` を表示authorityにしない。

5枠はstored slot orderのまま表示する。sort、group、multiset正規化、bonusType単位のまとめ、
rank順並び替えを行わない。同一bonusが複数slotにあっても欠落させない。

`expectedResult === null` および `expectedResult.restorationBonuses === null` は正常系として扱い、
予測結果なしとして安全にfallbackする。nullを理由にpageをerrorにしない。
`shouldSecure === true` のStepだけを確保予定として表示し、false / null から確保予定を推測しない。

#### TargetWeapon名の解決

TargetWeapon表示名はcurrent persisted TargetWeaponから解決する。生成時のTarget名snapshotを
Domainへ追加しない。取得失敗またはTarget欠損でPlan内容全体を壊さず、解決できない場合は
TargetWeapon IDへfallbackする。

#### 長いPlanへの対応

実際のPlanは100〜300 Step規模になり得るため、目標武器ごとの作成ルートと計画全体の実行順は
折りたたみ表示とし、閉じている間は内容をunmountしてよい。renderごとに無意味な再計算や
RNG再計算を行わない。

### 11.1 競合候補の表示と選択可否

各Conflictでは `buildListEntryIds` のparticipantを原則すべて表示する。current stateで
利用不能なparticipantも一覧から消さず、disabled表示と理由を併記する。

- `recommendedBuildListEntryId`: 「Planner推奨」badge等の表示だけに使用する
- `selectedBuildListEntryId`: 保存済みPlanでの「現在選択中」を明示する
- 推奨を自動選択、what-if固定、Planner再検索のauthorityにしない

選択可否は、操作時点のfresh PlannerInputと既存のTarget validation、BuildListEntry
staleness、CalculationContext compatibility、Planner input validationから判定する。
Planner input validation、current initial Planner state準備、current initial Conflict detectionは、
Production Planner dependenciesを持つPlanner Worker内で既存 `preparePlannerInitialContext()` 相当の
処理として行う。UI / main threadで `ProductionRngEngine` を生成しない。

Workerから内部 `PlannerInitialContext` そのものを返さず、ready / invalid、valid Entry IDs、excluded
EntryのIDと表示用reason、current initial ConflictのIDとparticipant Entry IDsを含む
structured-clone可能なB10用projectionを返す。B10-Bはこの取得に専用のtyped Planner Worker request /
Client APIを追加してよいが、B9の `create_what_if_comparison` request / result shapeへfieldを追加せず、
availability取得のためだけにwhat-ifを実行しない。

persisted Conflictを操作できるのは、同じConflict IDがcurrent initial Conflictに存在し、対象Entryが
そのcurrent Conflictのparticipantであり、current persistenceに存在してvalid Entry IDsに含まれる
場合だけである。current initial Conflictに同じIDが無い場合もConflictは表示し、「比較する」と
「この候補を優先」をdisabledにして、現在のPlanner入力ではこの競合を再現できない旨と再計算導線を
示す。preparationがinvalidの場合もすべてのConflict操作をdisabledにし、typed resultに基づく理由と
再計算導線を表示する。

最低限、BuildListEntry不存在、stale、Target不存在、Target無効またはdisabled、
CalculationContext非互換、Capability / prediction support / protectionその他のPlanner validation
除外を理由として表示できること。新しいDomain ruleをUIへ作らない。typed status、Entry ID集合、
Conflict membershipをcontrol authorityとし、表示用reason文字列は表示してよいが解析して分岐しない。
preparation requestもrequestId / generation / stale response rejectionまたはignore / dispose / cancelの
考え方を既存Planner Worker lifecycleと揃え、古い結果でavailabilityを上書きしない。

Counter位置が一致することだけを理由に「作成できない」と表示してはならない。
同一Counter位置でもPlannerがshareableと判定するoperationは共同実行できる
([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.2参照)。

### 11.2 「比較する」とwhat-if preview

各有効participantに「比較する」を置く。クリックしたparticipantだけを
`scenarioResolution` とし、fresh PlannerInputへ表示中Planの既存explicit resolutionを
復元して、`defaultPlannerWhatIfBounds = 2 / 8` をApplication callerが明示指定する。

表示中Planから復元するのは `conflicts[].selectedBuildListEntryId !== null` の選択だけである。
`recommendedBuildListEntryId`、Planner score、Beam bestState、Target priority、Candidate
category / similarity、`selectedBuildListEntryIds` からresolutionを作らない。

what-ifはtransient previewであり、次を行わない。

```text
ProductionPlanの変更または保存
BuildListEntryの変更または保存
PlannerConflictResolutionの永続化
what-if resultの永続化
trial Entryの採用
```

数秒かかる処理として、少なくとも次の状態を区別する。

```text
idle       未実行
loading    比較中。進捗とキャンセルを表示
completed  typed comparisonを表示
failure    typed failureまたは予期しないerrorを表示
```

別participantを比較する、別Conflictへ移動する、pageを離れる、Planner再計算を開始する場合は、
不要なrequestを `cancelPlan(requestId)` でcancelする。cancelはfailure表示にせず、partial resultを
表示しない。requestId / generationが古いprogress / result / errorを無視し、古い結果を新しい
participant cardへ表示しない。

### 11.3 comparison card

`PlannerWhatIfComparison.alternatives` のstable orderをそのまま使い、UI独自のTarget sortを
追加しない。各non-fixed TargetについてPracticalとIdealの2枠を独立表示し、Ideal結果を
Practical枠へ流用しない。

`found` は `estimatedOperationCount` を主距離として表示する。
`estimatedGogmaAdvance` / `estimatedSkillAdvance` / `estimatedNormalAdvance` は
「進行量」として補足表示してよいが、絶対Counter値ではない。通常表示でBase Seedまたは
絶対Gogma / Skill / Normal Counterを表示しない。
`estimatedNormalAdvance = null` は「進行量を表現しない」であり、`0` として表示しない。

typed no-resultは少なくとも次の意味を区別する。すべてを「候補なし」へまとめない。

| status | 表示する意味 |
| --- | --- |
| `not_found_within_search_extent` | 探索範囲内に実行可能な候補なし |
| `stopped_by_enumeration_bound` | 探索範囲上限のため未確認 |
| `stopped_by_candidate_trial_bound` | 候補試行上限のため未確認 |
| `stopped_by_planner_rerun_bound` | Planner再計算上限のため未確認 |

comparison全体の `planner_input_not_ready` / `invalid_fixed_resolution` は別のtyped failureとして
表示する。`invalid_fixed_resolution.reason` を分岐authorityとし、detail / message文字列を
解析しない。自動的に別participantまたはPlanner推奨へfallbackせず、再選択または再計算を促す。

### 11.4 「この候補を優先」とPlanner再計算

「比較する」と「この候補を優先」は別操作とする。what-if成功を選択のgateにせず、比較せずに
有効participantを優先できる。11.1でdisabledのparticipantはwhat-if成否にかかわらず選択できない。

ユーザーが「この候補を優先」を明示した場合だけ、そのConflict IDとparticipant Entry IDから
`PlannerConflictResolution` を作る。fresh PlannerInputへ、表示中Planから復元した他Conflictの
explicit resolutionを保持してmergeし、同一 `conflictKey` は今回選択で置換する。

選択確定後はwhat-if resultをPlan生成へ使わず、B8 Production constrained Plannerを最初から
再実行する。Application callerが `defaultPlannerOrchestrationBounds = 2 / 1 / 4` を明示指定する。

結果のwarningsにtyped `warning.kind === 'invalid_conflict_resolution'` が1件でもあれば、
`plan !== null` でもfail closedとする。`savePlannerOrchestrationResult()` を呼ばず、ProductionPlanも
generated BuildListEntryも保存せず、新Planへ遷移しない。表示中の旧Planを維持し、再選択または
再計算を促す。warning.messageを解析せず、Planner推奨または別participantへfallbackせず、invalid
resolutionを無視したordinary Planを保存しない。

上記warningが無い結果だけ、既存
`plannerResultPersistenceService.savePlannerOrchestrationResult()` でgenerated BuildListEntryと
ProductionPlanをatomic保存する。新しいPlanが保存された場合はその
`/plans/:planId` へ遷移する。Planが生成されない場合または保存失敗時は旧Planを黙って置換・削除
せず、B10の判断だけで旧Planを自動削除しない。

B10の編集対象は原則 `status === 'draft'` とする。`stale` はwhat-if / Conflict固定を継続せず
既存の再計算へ誘導する。`active` / `completed` / `abandoned` PlanをB10操作で書き換えない。

PlanStep表示。

- 順番
- 今回行う作業
- 使用する武器
- 想定結果
- 確保対象かどうか

`create_material_gogma` は「素材用巨戟アーティアとして登録」と表示する。追加のRNG抽選ではなく、直前までに作成した巨戟をMaterial / 保護OFFでツールへ登録する確認Stepとして示す。`change_owned_weapon_status`（既存Practicalの素材化）や `reserve_weapon`（Target候補の確保）とは別表示にする。

制約。

- Active Planは同時に1件まで
- stale Planでは作成開始不可。再計算を促す
- 現在CalculationContextと非互換なPlanはstaleとする
- Debug Mode OFFではSeed / Counterを表示しない

---

## 12. Execution Navigator

目的。

作成プランに従ってゲーム操作を1ステップずつ案内する。

表示。

- 現在Step番号
- 今回行う作業
- 使用する武器
- 想定結果
- 確保対象かどうか
- 完了済み / 残りStep数

基本操作。

- 結果一致・次へ
- 確保
- 結果が違う
- Undo
- プラン全体を見る

## 12.1 結果一致・次へ

処理。

- 操作前に実状態が現在Stepの `expectedStateBefore` と一致することを確認
- 実行前状態からExecutionUndoSnapshotを作成
- RNG状態を想定どおり進める
- NormalArtianCounterを想定どおり進める
- InventoryChangeを適用する
- 更新後の実状態が `expectedStateAfter` と一致することを確認
- ExecutionHistory追加
- PlanStepとProductionPlan更新
- 次Stepへ進む

これらは12.6の共通Dexie transactionで確定する。両方の期待状態と一致する正常進行ではPlanをstaleにしない。不一致の場合はStep完了を確定せず、差分と再計算導線を表示する。

## 12.2 確保

処理。

- ExpectedResultをOwnedWeaponとして登録または更新
- statusをPracticalまたはIdealに設定
- 保護ON
- 実行前状態をExecutionUndoSnapshotへ保存
- ExecutionHistory追加
- PlanStepとProductionPlan更新
- 旧実用品の素材化がPlanに含まれる場合でも、このStepでは状態を変更せず、後続の確認Stepへ進む
- 次Stepへ進む

武器追加・更新からPlan更新までを12.6の共通Dexie transactionで確定する。

## 12.3 予定された旧実用品の素材化

`operationType = "change_owned_weapon_status"` のStepで表示する。

表示。

- 対象となる旧実用品
- 先に確保した同一TargetのIdeal武器
- 後続で素材として使う予定

選択肢と処理。

- 素材用に変更: `status = Material`、`isProtected = false` を同一トランザクションで適用し、`confirmed_weapon_status_change` としてExecutionHistoryへ記録する。`expectedStateAfter` と一致すればPlanをstaleにせず次Stepへ進む
- 保管: 状態と保護を変更せず、`declined_weapon_status_change` と `planned_status_change_declined` をExecutionHistoryへ記録する。`expectedStateAfter` と不一致になるためPlanをstaleにして再計算を促す

制約。

- ユーザー選択前に状態を変更しない
- 確認ダイアログを閉じただけではStepを完了しない
- 素材化Step完了前に後続の `use_weapon_as_material` Stepへ進めない
- v1では同一TargetのIdeal武器が先行確保されている場合だけこのStepを表示する。別のPractical取得を理由とするPlanner提案は行わない
- どちらの選択もExecutionHistory、OwnedWeapon変更の有無、PlanStep、ProductionPlanを12.6の共通Dexie transactionで確定する

## 12.4 結果が違う

処理。

- 実結果入力画面を開く
- ActualResultを保存
- 実行前状態をExecutionUndoSnapshotへ保存
- ExecutionHistory追加
- `expectedStateAfter` との不一致理由を記録してPlanをstaleにする
- 再計算導線を表示

ActualResult、RNG / Counter / Inventoryの実変更、ExecutionHistory、PlanStep、ProductionPlanを12.6の共通Dexie transactionで確定する。

## 12.5 Undo

処理。

- 最後のExecutionHistoryのExecutionUndoSnapshotを読み込む
- RngStateと全NormalArtianCounterを実行前へ戻す
- Stepで追加したOwnedWeaponを削除し、更新・削除したOwnedWeaponを実行前へ戻す
- ProductionPlanを実行前Snapshotへ戻す
- 最後のExecutionHistoryを削除する

Undoは上記すべてを1つのDexie transactionで行う。途中で失敗した場合は部分復元を残さず、Undo前の状態と履歴を維持する。Undo自体のExecutionHistoryは追加しない。

注意表示。

```text
Undoはツール上の操作を戻すだけです。ゲーム内の操作は戻りません。
```

## 12.6 Step確定Transaction

結果一致、武器確保、予定された旧実用品の素材化確認、想定外結果記録では、次の関連更新を1つのDexie read-write transactionで原子的に行う。

- RngState更新
- NormalArtianCounter更新
- OwnedWeapon追加・更新・削除
- ExecutionHistory追加
- PlanStep完了または取消
- ProductionPlan更新

操作開始前に同じtransaction内で実状態を読み、`expectedStateBefore` のvalidationとExecutionUndoSnapshot生成を行う。結果一致、武器確保、「素材用に変更」では `expectedStateAfter` 不一致をvalidation失敗としてtransaction全体をrollbackする。想定外結果と「保管」は不一致を意図して記録する経路であるため、実状態とstale理由を同じtransactionで保存する。各経路で必要な読み書きまたはvalidationが失敗した場合は部分更新を残さず、Step確定前の状態を維持する。UIは次Stepへ遷移せず、再試行可能な保存エラーを表示する。

---

## 13. Plan Overview During Navigation

目的。

実行ナビ中に全体の現在地を確認する。

表示。

- 完了済みStep
- 現在Step
- 今後のStep
- 確保予定武器
- 素材補充予定

操作。

- 現在の作業に戻る

制約。

- 初期版ではOverviewからPlan編集をしない

---

## 14. Settings / Import Export

表示。

- Debug Mode ON/OFF
- Master Data gameVersion
- Master Data dataVersion
- RNG Engine version
- App schemaVersion
- Export
- Import
- 全データクリア

Import制約。

- 初期版は全置換Importのみ
- Import前に現在データExportを促す
- schemaVersion不一致は拒否する
- Master ID不一致は拒否または明示警告する

全データクリア。

- 確認ダイアログを必須にする
- クリア後は初期状態へ戻る

---

## 15. Debug Details

Debug Mode ONの場合のみ表示。

表示対象。

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate（legacy / diagnostic / compatibility値。Production active Predictionのauthorityではない）
- NormalArtianCounter
- PlanStep内部情報
- RNG予測情報
- Planner判定理由
- 再計算理由
- 使用中RngEngine名
- Master Data version
- 各StepのNormal / Skill / Gogma Counter before-after。conversionはSkillだけが+1でGogmaは同値として表示する

制約。

- Debug Mode OFFでは通常導線に内部値を表示しない
- ExportにはDebug Modeに関係なく必要な内部状態を含める

---

## 16. 再計算導線

Planがstaleになる条件。

- 現在StepのexpectedStateBefore / Afterと一致しないRNG状態変更
- 現在StepのexpectedStateBefore / Afterと一致しないNormalArtianCounter変更
- TargetWeapon変更
- 作成リスト変更
- 現在StepのexpectedStateBefore / Afterと一致しないOwnedWeapon変更
- 想定外結果
- 予定候補未確保
- 別候補確保
- 予定された素材化に対して「保管」を選択（`planned_status_change_declined`）
- CalculationContext非互換（`calculation_context_changed`）

PlanどおりのStep完了でCounterまたは所持武器が変化しても、現在StepのexpectedStateAfterおよび次StepのexpectedStateBeforeと一致する限りstaleにしない。予定された素材化でMaterial / unprotectedへ変わる場合も同じである。Plan開始時Snapshotとの単純比較は行わない。

Active Planの正常進行によってBuildListEntryのsearchStateHashまたはreferencedOwnedWeaponsHashと現在値が一致しなくなっても、その派生staleだけを理由に進行中Planを停止しない。Execution NavigatorではPlanStep期待状態を優先する。

UI表示。

- stale理由
- 期待状態と実状態の差分
- 影響を受けるPlan
- 再計算ボタン
- 現在Planを破棄するボタン

制約。

- 自動で新Planへ置き換えない
- ユーザーが再計算を実行した場合のみ新Planを作成する

---

## 17. ルーティング

React Routerを使う場合の推奨path。

```text
/
/rng
/normal-counters
/owned-weapons
/target-weapons
/search
/build-list
/plans/:planId
/plans/:planId/run
/settings
/debug
```

GitHub Pages対応。

- Viteの `base` を公開リポジトリ名に合わせる
- SPA fallbackが必要な場合はHash Routerも検討する
- 初期版ではHash Routerを採用してもよい

---

## 18. 状態管理

推奨。

- Dexie: 永続化
- React state / Zustand: 画面状態
- Web Worker: 重い計算

UI state例。

```ts
export interface SearchUiState {
  activeTargetWeaponId: TargetWeaponId | null;
  resultFilter: CandidateResultFilter;
  routeFilter: CandidateRouteFilter;
  isSearching: boolean;
  currentRequestId: string | null;
}
```

制約。

- 永続化すべきデータはDATA_MODEL.mdに従う
- フィルタや開閉状態など一時UI状態はIndexedDBへ保存しなくてよい

---

## 19. テスト観点

## 19.1 Component Test

- 復元ボーナス5枠入力が5枠未満で保存できない
- 武器種変更時に無効なボーナス選択が解除される
- TargetWeapon優先度のデフォルトが3になる
- Debug Mode OFFでSeed / Counterが表示されない
- Debug Mode ONで内部情報が表示される
- Normal Counterの手動修正がDebug Mode OFFで表示されない
- Normal Counter画面が14武器種のレア8だけを表示し、Debug Modeでもレア6・7を扱わない
- Normal Artian観測入力にレア度選択を表示せず、内部値を8に固定する
- RNG項目を一部だけ入力して保存できる
- Capability不足の機能だけが無効表示になる

## 19.2 Flow Test

- RNG設定から候補検索まで進める
- 観測検索でSeed検索とCounter検索の入力・結果が混在しない
- Seed検索中に進捗表示とキャンセルが使える
- 通常Counter未確定時に通常Route skipが表示される
- 通常アーティアのnormal scope WeaponBonusDefinition不足時に `master_data_unavailable` の通常Route skipが表示される
- 既存武器の復元ボーナスを維持したスキルのみ再付与Routeを表示できる
- protectedなPractical / Ideal武器でもスキルのみ再付与Routeを表示できる
- Skill Capability不足時にスキルのみ再付与Routeのskip理由が表示される
- `candidateOffset = k` の通常アーティア経由で `forgeCount = k + 1` 本forgeし、最後の1本だけを巨戟化する操作列が表示される
- conversion結果に継承normal bonus 5枠と初回Series / Groupが表示される
- normal scopeの巨戟にfirst Reset前のKeepが表示されず、first Reset後は同一RouteのKeepを表示できる
- normal scopeでKeepが選べない理由を「現在のProduction RNGが予測できない」と表示し、「ゲーム上Reset必須」とは表示しない
- transient GogmaのReset / Keep / Reset Skillsにfake OwnedWeapon IDを表示しない
- Search Resultsから候補を作成リストへ追加できる
- Build ListからPlannerを実行できる
- Production PlanからExecution Navigatorへ進める
- 結果一致で次Stepへ進む
- PlanどおりのStepで期待状態Afterに一致した場合はstaleにならない
- Plan開始時からCounterが進んでも現在Step期待状態と一致すれば実行を継続できる
- 結果が違う場合にPlanがstaleになる
- Undoで最後の操作を戻せる
- Undoで最後のStepが変更したRNG、通常Counter、OwnedWeapon、ProductionPlanを完全に戻せる
- Step確定またはUndoの途中で保存失敗しても部分更新が残らない
- Planに旧実用品の素材化がある場合、確保Stepとは別の確認Stepが表示される
- 同一TargetのIdeal確保後だけ、Planner予定の旧Practical素材化確認が表示される
- 別のPractical確保だけでは、Planner予定の旧Practical素材化確認が表示されない
- 予定どおり「素材用に変更」でMaterial / 保護OFFになり、Planがstaleにならず次Stepへ進む
- 素材化予定に対する「保管」で状態と保護が維持され、Planがstaleになる
- 素材化確認前に後続の素材消費Stepへ進めない
- staleなBuildListEntryからPlannerを実行できない
- RNG変更理由があるBuildListEntryに `rng_state_changed` が表示される
- Route参照武器変更理由があるBuildListEntryに `owned_weapon_changed` が表示される
- CalculationContext非互換のEntryまたはPlanに `calculation_context_changed` が表示される
- `/plans/:planId` がそのIDの保存済みPlanだけを表示し、不存在時に別Planへfallbackしない
- Conflict participantを原則全件表示し、current stateで利用不能なEntryをdisabled + reasonで示す
- Production Planner dependenciesを使うWorker-side preparationからready / invalid、valid / excluded
  Entry、current initial Conflictのstructured-clone projectionを受け、main threadで
  `ProductionRngEngine` を生成しない
- persisted Conflictと同じIDのcurrent initial Conflictがあり、そのparticipantかつvalidなEntryだけを
  操作可能にし、再現できないConflictは表示維持のまま両操作をdisabledにして再計算を促す
- preparationがinvalidなら全Conflict操作をdisabledにし、typed reasonと再計算導線を表示する
- preparationの古いrequestId / generation結果をcurrent availabilityへ適用しない
- `recommendedBuildListEntryId` をbadge表示だけに使い、自動選択またはwhat-if固定に使わない
- 保存済みPlanの `selectedBuildListEntryId` があるConflictだけをexisting explicit resolutionとして
  fresh PlannerInputへ復元する
- 「比較する」と「この候補を優先」が独立し、what-if未実行でも有効participantを選択できる
- 別participant、別Conflict、page離脱、Planner再計算でwhat-ifをcancelし、cancelをfailure表示せず
  古いgenerationのpartial / completed resultを新しいcardへ表示しない
- comparisonがDomainのTarget順を維持し、Practical / Idealを独立表示する
- what-ifの4種類のtyped no-resultを区別し、`planner_input_not_ready` /
  `invalid_fixed_resolution` をmessage解析なしで扱う
- 明示選択後はfresh PlannerInputと `defaultPlannerOrchestrationBounds` でB8 constrained Plannerを
  再実行し、what-if trial結果をPlan生成へ流用しない
- constrained結果にtyped `invalid_conflict_resolution` warningが1件でもあれば、`plan !== null` でも
  persistenceを呼ばず、Entry / Planを保存せず、遷移せず、旧Planを維持する
- 新Planとgenerated BuildListEntryを既存atomic persistence境界で保存して新Planへ遷移し、
  Planなしまたは保存失敗時に旧Planを置換・削除しない
- Conflict編集をDraft Planに限定し、stale / active / completed / abandonedをB10操作で書き換えない
- exact persisted Planが取得できていれば、Worker preparation中・preparation失敗後・staleでも
  Plan概要、目標武器ごとの作成ルート、計画全体の実行順、予測結果を表示する
- stale PlanでもPlan内容を表示したうえで、既存のConflict操作はdisabledのままにする
- 目標武器ごとの作成ルートが `progressedTargetWeaponIds` と `targetWeaponId` の和集合で帰属し、
  shared physical Stepが各Targetへ表示され、計画全体の実行順では1回だけ表示される
- Route進行がない `progressedTargetWeaponIds = []` のStepがprimary `targetWeaponId` のルートに現れ、
  Target非依存Stepは目標武器ごとのルートに現れず計画全体の実行順にだけ現れる
- legacy Planでwarningを表示し、`undefined` からshared Targetを推測しない
- `expectedResult.restorationBonuses` の5枠がstored slot orderで表示され、同一bonusの重複が欠落しない
- `expectedResult === null` でも表示が壊れず、`shouldSecure === true` だけを確保予定として示す
- TargetWeapon名をcurrent persisted Targetから解決し、欠損時はTargetWeapon IDへfallbackする
- Planner保存成功時に、Persistenceが返したPlanの `/plans/:planId` だけへ遷移する

## 19.3 Import / Export Test

- ExportボタンでJSONを出力できる
- ExportしたJSONをImportできる
- 不正schemaVersionを拒否する
- Master ID不一致を検出する

## 19.4 Responsive Test

- スマートフォン幅で主要画面が横スクロールなしで使える
- Search ResultsのTarget切替が操作できる
- Execution Navigatorの主要ボタンが片手操作しやすい位置にある
- 復元ボーナス5枠が小画面でも判読できる
