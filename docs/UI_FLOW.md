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
Guide / 使い方
```

PCブラウザとスマートフォンブラウザの双方を主要利用環境として想定する。端末ごとの適応方針は3.1で定義する。

### 2.1 ナビゲーション

固定ナビゲーション（Drawer）の表示順とグループは次のとおりとする。

```text
ダッシュボード

管理
  所持武器
  目標武器

計画
  候補検索
  ビルドリスト
  生産計画

----------------

初期設定
  RNG状態設定
  通常アーティアカウンター

使い方
設定
デバッグ          ※ Debug Mode ON時のみ
```

- 「生産計画」は生産計画一覧（`/plans`、11.5）へ遷移する。個別Plan（`/plans/:planId`）と
  Execution Navigator（`/plans/:planId/run`）でも「生産計画」をactiveにし、Execution Navigator専用の
  固定ナビゲーション項目は追加しない。AppBarのcurrent page表示は `/plans` と `/plans/:planId` を
  「生産計画」、`/plans/:planId/run` を「実行ナビゲーション」とし、より具体的なpathを `/plans` より
  先に判定する
- デバッグはDebug Mode ON時のみ表示する
- 「使い方」（`/guide`、2.2）は日常のDomain操作ではないため管理・計画・初期設定のいずれのグループにも
  入れず、区切り線の下で「設定」の直前に置く。AppBarのcurrent page表示は「使い方」とする。Debug Modeに
  よって表示の有無を変えない
- PC（permanent Drawer）とスマートフォン（temporary Drawer）で到達可能な主要機能は同じとする
- Drawerは縦スクロールを許容するが、縦スクロールバーの有無にかかわらず不要な横スクロールを
  発生させない。ナビゲーション内容はDrawer paperの利用可能幅へ収め、固定幅で溢れさせない。
  横overflowを `overflow-x: hidden` で隠すだけの対応は行わない

### 2.2 Guide / 使い方

目的。

GitHub Pages上でアプリを開いたユーザーが、Repositoryの仕様書を読まずに、準備、目標武器の登録、候補検索、
ビルドリスト、生産計画、実行ナビ、バックアップ / 復元までの代表的な流れを理解できるようにする。

- route は `/guide`（HashRouterでは `#/guide`）、ページタイトルは「使い方」とする
- 実アプリのスクリーンショットと本文で、代表的な利用フローを手順ごとに説明する。スクリーンショットは
  架空のガイド用データで実Browserから取得したものとし、開発者やユーザーの実データ、Debug Modeの内部値を
  写さない。画像はGitHub Pagesのbase pathで壊れないようbundleへimportし、横overflowを起こさずに
  端末幅へ縮小する。画像には意味のある代替テキストを付け、同じ内容を本文でも説明する
- Guideはユーザー向けの説明であり、仕様書ではない。Domain / RNG / Search / Planner / Persistenceの
  authorityはこの文書を含む正式仕様のままであり、Guideの文言は正式仕様と現在の画面を言い換えるだけで、
  semanticsを追加・変更しない。必須でない準備（通常アーティアCounter、所持武器の登録など）を
  一本道の必須手順として説明しない
- 該当する画面（RNG状態設定、通常アーティアカウンター、所持武器、目標武器、候補検索、ビルドリスト、
  生産計画、設定）への補助リンクを置いてよい
- 永続データを読み書きせず、Debug Modeによって内容を変えない

---

## 3. 共通UI方針

- 通常画面ではSeed / Counterを表示しない
- Debug Mode ONの場合のみ内部RNG情報を表示する
- 例外として、Normal Counter Setup（6）の一覧だけは、確定済み通常アーティアCounterの現在値を「カウンター値」として
  通常UIへ表示してよい。未確定の保持値は表示しない。この例外は他のRNG内部値（Base Seed / Skill Counter /
  Gogma Counter / Counter Gate）、他画面、Identification Dialogへ拡張しない
- 重要な操作は1画面1目的にする
- 復元ボーナス5枠は常に5つの固定スロットとして表示する
- slot順の意味は用途ごとのDomain契約に従い、共通UI方針として「常に順不同」とは扱わない
- 通常アーティアCounter観測（6、ordered exact match）やKeep Bonus（slotごとのfamily保持）など、slot順に意味がある場面では表示順を維持し、並べ替えない
- 目標武器の理想5枠や途中採用する復元ボーナス状態など順不同比較を行う画面・判定では、その画面の契約に従い、必要に応じてUI内で順不同であることを軽く示す
- 長時間検索中は進捗とキャンセルを表示する
- 総work量が探索中に増える処理では、推定percentを作らず活動中であることを示す
- 作成ナビは必ず1操作ずつ進める
- 高速モードは表示しない
- 手動作成順固定UIは表示しない

### 3.1 PC・スマートフォン対応方針

PCブラウザとスマートフォンブラウザの双方を主要利用環境とする。ユーザーはどちらの端末でも
設定・管理・検索・計画・実行の一連の操作を完結でき、いずれの端末でも全主要機能を実用レベルで
利用可能にする。

共通原則。

- 利用端末によって機能、情報、入力項目、主要操作、Domain semanticsを減らしたり変更したりしない
- 端末差はPresentation層の情報密度、配置、表示形式、操作位置に限定する
- PCでは一覧性、比較性、情報密度を活かす。TableやTableに準じた複数カラム配置を利用してよい
- スマートフォンでは同じ情報と操作をCard、Accordion、縦配置などへ適応する。PC向けTableを
  単純に横スクロールさせるだけの対応は原則避ける
- PCではTable、スマートフォンではCard等へ表示形式を適応してよい。詳細表示、Accordion、
  メニュー等によるprogressive disclosureは許可するが、端末差によって情報や操作そのものを
  利用不能または到達不能にしてはならない
- 長いフォームやDialogはスマートフォン向けレイアウトへ適応する。スクロール自体は許容するが、
  保存や次へなどの主要操作を見失いにくく無理なく到達できるようにする。固定表示するUIが
  コンテンツやキーボードフォーカスを隠してはならない
- 主要操作を画面下部へ固定する配置は、それを必要とする画面が明示的に選択する。全画面で一律に
  下部固定へ変換する設計にはしない
- レスポンシブスタイルは原則として小画面を基本形とし、breakpointで大画面向けの配置・密度を
  加える。これは実装上の記述規約であり、製品自体をmobile-only / mobile-priorityにすることとは
  区別する。後者は採用しない
- 登録、編集、検索、比較、作成リスト操作、計画確認はスマートフォンでも完結できる

画面別の重点。

- Identification Wizard（5.4）はゲーム操作と並行して使用され得るため、PC専用扱いにせず
  PC・スマートフォン双方で実用可能にする
- Execution Navigator（12）は双方で利用可能としたうえで、PC / PS5でゲームを操作しながら
  スマートフォンで確認・操作する利用形態を特に重視する。ゲーム画面から目を離して短時間で
  次の操作を確認できる表示と、片手操作しやすい位置の主要ボタンを優先する

### 3.2 管理一覧の表示順

Owned Weapons（7）とTarget Weapons（8）の一覧は自動sortしない。一覧順の契約は次のとおり。

```text
新規追加  -> 一覧末尾へ追加
編集      -> 元の位置で置換
削除      -> 削除した項目以外の相対順序を維持
```

編集しただけで項目を末尾へ移動してはならない。保存に伴って別項目が更新される場合
（8.1の優先起点の付け替えで前の保持Targetの優先起点が解除される場合など）も、
更新された各項目は元の一覧位置を維持する。

### 3.3 復元ボーナスscopeの表示

内部値 `normal_artian` / `gogma_artian`（`ArtianBonusScope`）は変更しない。通常ユーザー向けには
次の表記を使う。

```text
normal_artian -> 通常アーティア系
gogma_artian  -> 巨戟アーティア系
```

- フィールド名は原則「復元ボーナスの種類」とする
- 巨戟アーティアでscopeを選択する場所には必要に応じて
  「巨戟化直後、まだ復元ボーナス変更前は「通常アーティア系」です。」という補足を表示する
- `scope`、`normal_artian`、`gogma_artian`、`amendment` 等の内部用語を通常ユーザー向け表示へ
  漏らさない。Debug Modeの内部表示はこの制約の対象外とする

### 3.4 復元ボーナスの種類別カラー表示

復元ボーナス5枠の読み取り専用表示（Candidate Search、途中採用する状態、Production Plan、
Execution Navigator等が共用する `RestorationBonusSlots`、および所持武器一覧（7）／目標武器一覧（8）の
番号付き5枠表示 `BonusSlotList`）は、Bonus Typeごとに文字色と枠線色で種類を判別しやすくする。
両者は同じPresentation authority（色系統、文字色、枠線色、EXのtint、未知Typeのfallback）を共有し、
片方だけが別の配色や別のEX強調を持ってはならない。これはPresentationのみの補助表現であり、Bonusの意味、RNG、Search、
Planner、Target評価、Master、persisted schema、calculation semanticsを変更しない。

```text
基礎攻撃力強化                              -> 赤系
会心率強化                                  -> 紫系
属性強化                                    -> 青・水色系
斬れ味強化 / 装填数強化 / 斬れ味・装填強化  -> 黄色系（同じ系統として同色）
```

- 色分けはstableな `bonusTypeId` から解決し、表示名の文字列から判定しない
- 通常アーティア側とGogma側で同じ意味の系統（斬れ味 / 装填）は同じ色系統として扱う
- 色は補助表現に留め、現在の文字ラベル（種類名とRank）はそのまま維持する。色だけが種類やRankを
  伝える唯一の手段になってはならない
- EX Rankは `BonusRankMaster.isEx` で判定し、ラベル中の `EX` 表示を維持したうえで、同じ色系統の
  まま背景tint等で通常Rankより少し識別しやすくする。強調は控えめな補助表現に留め、EXだけ文字を
  太くしたり枠線を太くしたりはしない。`EX` の文字があるため、色だけが唯一の情報伝達手段にはならない
- 既知の系統に属さない `bonusTypeId` には推測で色を付けず、標準のChip表示へfallbackする
- 既存の `filled` / `outlined` の違いは維持し、色分けやEX強調でChipの寸法やwrap挙動を変えない
- 所持武器一覧／目標武器一覧の番号付き表示は、slot番号1〜5と保存順（sortしない、group化しない、重複も
  5枠のまま）を維持したうえで同じ色分けを適用する。slot番号はBonus Typeではなく順序を表す情報なので、
  系統色で染めず中立の補助テキスト色のまま残す。ラベルのscopeは呼び出し側の権威に従う（所持武器は保存済みの
  `restorationBonusScope`、目標武器の理想ボーナスはGogma側定義）。`<ol>` / `<li>` の順序付きリストとしての
  意味は維持する
- 文字色は白背景およびtint背景に対して通常テキストのコントラスト基準（4.5:1）を、枠線色は
  ページ背景に対して非テキストの基準（3:1）を満たす。黄色系は明るい黄色文字を避け、文字は
  濃いamber系、枠線を黄色系とする
- Dark theme（3.5）では同じ4系統・同じEX規則・同じfallbackのまま、Dark用の色値を使う。文字色は
  Darkのpaper背景およびtint背景に対して4.5:1を、枠線色はDarkのページ背景・paper背景に対して3:1を
  満たす。Light用の色値をDark背景へそのまま流用しない。Light / Darkの色値の選択も同じPresentation
  authorityが行い、`RestorationBonusSlots` と `BonusSlotList` が別々のDark配色を持ってはならない
- Dark面では同じtint段差でも通常RankとEXの背景差が小さく見えるため、Dark themeではLightより
  通常RankとEXの背景tintの差を明確にしてよい（通常Rankのtintは維持し、EXのtintだけを強める）。
  5枠を並べたとき、ラベルを読む前でもEXの枠が分かる程度の差とし、発光的・蛍光的な強さにはしない。
  このときもEXの文字色・枠線色・文字weight・枠線幅は通常Rankと同じとし、EXの文字色はEXのtint背景に
  対して4.5:1を満たす。Light themeのtintはこれによって変えない。mode別のtintの選択も同じ
  Presentation authorityが行い、画面ごとにDark用のEX強調を持たない
- 具体的な色値はPresentation実装の詳細であり、この文書では固定しない

### 3.5 Light / Dark theme

画面の配色はLight themeとDark themeから選択できる。

- 選択肢は「ライト」「ダーク」の2つとし、既定はライトとする。保存値がない場合、未知の値の場合、
  読込に失敗した場合もライトとして扱う
- OS / browserの `prefers-color-scheme` へ自動追従しない。ユーザーが設定画面で選択したthemeだけを
  authorityとする（OSに追従する選択肢は追加していない）
- themeは端末・browser固有のlocal Presentation preferenceであり、ユーザーデータではない。
  browserのlocalStorageへ保存し、`AppSettings`、Dexieのsettings table、`ExportRoot` には含めない
- したがってExport JSONにtheme情報は含まれず、Importしてもthemeは変わらず、全データ削除（14）でも
  themeは変わらない。Import / Clear後のSettings Storeのhydrateはthemeへ影響しない
- 選択は再読込なしで即時に反映し、現在のroute、入力中の内容、開いているDialog、検索結果、Plan表示を
  失わせない（theme変更で画面treeをremountしない）。保存済みの選択は初回描画から適用し、
  Lightを描画してからDarkへ切り替える表示のちらつきを避ける
- 保存（localStorageへの書込み）に失敗しても表示中のthemeは切り替え、設定画面に保存できなかったこと
  （再読込後は以前のthemeに戻る場合があること）を簡潔に表示する。browserのerror文言やstack traceは
  通常UIへ表示しない
- Dark themeはLightの色を反転したものではなく、同じブランド系統（落ち着いたdark-greenのprimary、
  brownのsecondary、境界線ベースの面構成）をDark面で読める明るさへ調整した専用paletteとする。
  本文・補助テキスト・semantic color（success / warning / error / info）はDarkの面に対して4.5:1以上を
  保つ。各画面はtheme token（`background.paper`、`text.secondary`、`divider` 等）を通して配色し、
  画面ごとにDark用styleを重複実装しない
- Dark themeではDialog、Menu、スマートフォンのDrawer等の浮き上がった面を白いoverlayで明るくせず、
  `background.paper` のまま境界線（`divider`）で区別する。浮き上がった面の上でも補助テキストのコントラストを
  4.5:1以上に保つためである。Light themeの面の描画は変更しない
- native control等にもthemeのcolor schemeを伝える（CSS `color-scheme`）
- 使い方ガイド（Guide）のスクリーンショットは操作例の静的画像であり、Dark用に撮り直したり二重に
  保持したりしない
- themeはPresentationだけの設定であり、Domain、RNG、Search、Planner、Worker、Persistence semantics、
  `DATABASE_SCHEMA_VERSION`、`ExportRoot.schemaVersion`、`AppSettings.schemaVersion`、
  calculation schema、RNG Engine versionを変更しない

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
- Active Planの有無と進行（完了Step数 / 全Step数、作成中の武器数）
- 完了済み目標武器数
- 再同定を促す表示（想定外結果の記録後に、対象stream（RNG Identification、または該当武器種の通常アーティア
  Counter）の正式なIdentificationを採用していない場合。操作内容不明は実行ナビでの回復を促し、回復済みなら
  表示しない。導出条件は[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15）

主要アクション。

- RNGを設定する
- 通常Counterを特定する
- 所持武器を登録する
- 目標武器を登録する
- 候補検索を開始する
- 生産計画一覧を見る（`/plans`。Active Planの有無にかかわらず常に到達できる）
- 作成プランを見る
- 実行ナビを再開する

状態別CTA。

- RNG未設定: RNG Setupへ誘導
- TargetWeaponなし: Target Weaponsへ誘導
- Search結果なし: Search Resultsへ誘導
- Active Planあり: 「実行ナビを再開する」でExecution Navigatorの現在Stepへ誘導
- Plan stale: stale理由、ゲーム内セーブ地点への復元（記録がある場合）、現在地点からの再計画試算へ誘導
  （16.1）

---

## 5. RNG Setup

目的。

Base Seed、Gogma Counter、Skill CounterをProduction Prediction用に項目ごとに設定する。Counter Gateは通常UIに表示・編集欄を設けない。persisted `RngState.counterGate` はlegacy / diagnostic値として保持するだけであり、Production Predictionの必須項目またはauthorityではない。判明している値だけの適用を許可する。

通常ユーザー向けのRNG取得方法は次の2つとする。外部toolの出力textを取り込む専用Import機能と、汎用Seed Search UIは提供しない。

1. 正確な値の手動入力（5.2）
2. Production Skill-first Identification Wizard（5.4）

画面構成。

1. 保存済みのRNG状態: Base Seed / Gogma Counter / Skill Counterの確定状態だけを表示する。未保存の変更がある場合はその旨を示す
2. 値が分からない場合: RNG状態の特定（Identification Wizard）の利用可否と、Wizardが特定する3値（Base Seed、調査開始前のSkill Counter、調査開始前のGogma Counter）、開始条件を示し、Wizard開始導線を置く
3. 手動入力: Base Seed / Gogma Counter / Skill Counterとメモを編集し保存する
4. 現在の入力内容で利用可能な機能: 現在値から導出したCapabilityと不足項目を表示する
5. Production RNG Engine（技術情報）: 既定で折りたたみ、Engine mode / version とPrediction operationのsupportだけを表示する

RNG状態の特定の利用可否表示。

- 通常ユーザー向けには、5.4 Identification Wizard（Production Identification）の
  Worker / application levelのavailabilityに基づいて「RNG状態の特定: 利用可能」（利用不可なら
  「利用不可」と理由）と表示する
- この表示をRngEngine capability flagへ接続しない。Engineの技術情報セクションが表すのは
  Prediction operationのsupportだけであり、RNG状態の特定（Identification）機能の可否ではない
- 技術情報セクションにも、Identificationの可否がEngine capabilityではなくアプリ側で
  判定される旨を明記する
- 通常UIの表示文言では「同定」を使わず「特定」を使う（Issue #90）。Dialog名・開始ボタン・採用結果は
  「RNG状態の特定」「RNG状態の特定を開始」「特定結果をRNG状態へ採用しました。」とし、想定外結果の後の
  再Identificationは「再特定」「特定し直す」と表示する。型名・Domain名・内部契約の `Identification` は変更しない

5.1と5.3は欠番であり、5.2 / 5.4の番号はsrcコメントおよび他文書からの参照安定性のため
そのまま維持する。


## 5.2 直接入力

入力。

- Base Seed
- Gogma Counter
- Skill Counter

制約。

- Counterは0以上の整数
- Base Seedは正規化後に保存。raw 10進 / `0x` 16進入力をProduction `normalizeSeed()` でcanonical 10進文字列へ正規化する手動入力semanticsは、Identification WizardのSeed range入力UXとは別契約であり変更しない
- 3項目をすべて入力する必要はない
- 入力した各KnownValueのsourceを `manual` にする
- 空欄は既存値を削除しない。確定解除は別操作にする
- Counter Gateの入力欄・状態表示・取得方法表示を通常UIに出さない。保存時はpersisted `RngState.counterGate` をそのまま保持し、null化、確定解除、source書き換え、代表値54 / 35の書込みを行わない
- persisted Gateが200、54、または未設定でも、他の必要値とsupportが同じならProduction active Predictionのavailabilityと結果は同じである
- 実行中（active）の生産計画がある場合、保存前に16.3の警告を出し、承認時だけ生産計画を破棄して保存する。
  Execution Navigatorの正常なStep確定によるCounter更新はこの画面の保存ではないため警告対象ではない

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

検証状態の表示。

- 通常ユーザー向けWizardは、repositoryに存在するgame-verified evidenceを根拠に「RNG状態の特定は実機で動作を確認済みです。ただし確認条件は限定されており、全武器種・全属性・全ゲームバージョンを保証するものではありません。」と表示し、採用後の予測結果をゲーム側でも確認するよう促す
- 全武器種・全属性・全game versionが確認済みであるとは表現しない
- 個別fixture（武器種 / 属性 / Counter位置）の列挙は [RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) の責務であり、通常Wizardへ固定表示しない

STEP 1。

1. 同じ武器種・属性で、連続したSkill抽選結果（Series / Groupの両方）を観測1以降へ実際の順番どおり記録する。開始操作は次のどちらでもよい
   - 通常アーティアから開始: 巨戟化（conversion）時に自動付与されたSkillを観測1とし、以後のReset Skills結果を観測2以降とする
   - 既存巨戟アーティアから開始: Reset Skillsの結果を観測1とし、以後のReset Skills結果を観測2以降とする
   - どちらもstarting Skill Counterは観測1を生成する直前のSkill Counterである。途中で別のSkill Counter消費操作を挟まない。conversionとReset Skillsは同じSkill Counter位置・武器種・属性で同じ結果になる（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.18）ため、開始操作の種別は入力させず（開始方法の選択UIを置かない）、各観測は「N回目のスキル抽選結果」のように操作種別を固定しない表示とする
2. 観測は追加・削除でき、観測1からの順序を保持する
3. approximate Skill Counterはcenter + ±Nを基本入力とし、計算後のinclusive start / endを併記する。初期推奨幅は11候補である
4. Base Seed rangeの初期値はcanonical全域 `0..99,999,999`（`CANONICAL_BASE_SEED_MIN` / `CANONICAL_BASE_SEED_MAX`）とし、Restart後も同じ初期値へ戻す。ユーザーは従来どおり狭いbounded rangeへ変更でき、自動range拡張は行わない
5. Seed range入力は数字専用8桁（`type="text"` / `inputMode="numeric"` / `maxLength=8` 相当）とし、空文字と0-9最大8桁だけをdraftへ採用する。`-` / `+` / `.` / `e` / 空白 / 英字 / 9桁以上はpaste・programmatic changeでもdraftへ入れない。検索実行時はDomain validationで `0 <= start <= end <= 99,999,999` を確認し、空欄・逆順・domain外はerrorとしてCoordinatorへ渡さない。RNG Setupの手動Base Seed入力（raw 10進 / 16進をnormalize）とは別契約である
6. Base Seedとstarting Skill CounterをWorkerで探索する
7. 完全・non-truncatedな結果がexactly oneになるまでSTEP 2へ進めない

STEP 2。

1. STEP 1の一意なcanonical Base Seedを使用する
2. Reset Bonusesを連続して行い、各結果をordered five-slot Observationとして記録する。各slotのボーナス種別・ランク選択肢と観測の完成判定は、STEP 1の武器種・属性に対するProduction Gogma Reset候補（`productionGogmaResetCandidatesForWeaponAndElement()`）に基づく複合availability selector（[MASTER_DATA.md](./MASTER_DATA.md) 15.1）を使い、`getBonusDefinitionsForWeapon()` を使わない。スラッシュアックスの無属性構成では属性強化II / EXを入力でき、弓の毒・麻痺・睡眠では属性強化を提示しない
3. approximate Gogma Counterはcenter + ±Nを基本入力とし、inclusive start / endを併記する
4. starting Gogma CounterをWorkerで探索する
5. 完全・non-truncatedな結果がexactly oneの場合だけreviewへ進む

結果別UI。

- `unique`: 次STEPまたはreviewへ進む
- `multiple`: 候補をユーザーに選ばせず、次の連続したSkill抽選結果（STEP 1）/ Reset Bonuses結果（STEP 2）の追加観測を要求して同じ検索を再実行する
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
- 実行中（active）の生産計画がある場合、adopt前に16.3の警告を出し、承認時だけ生産計画を破棄してadoptする

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
- 状態: 未設定 / 候補複数 / 確定 / 未確定（「未設定・検索に未使用」「候補複数・検索に未使用」「確定・検索に使用」「未確定・検索に未使用」）
- カウンター値
- 操作

カウンター値の表示。

- `isConfirmed = true` かつ `counter !== null` の行だけ、保存済み `counter` を「カウンター値」として表示する。
  これは3章の「通常画面ではSeed / Counterを表示しない」に対する、本画面だけの限定的な例外である
  （[REQUIREMENTS.md](./REQUIREMENTS.md) 4）
- それ以外（未設定、候補複数、未確定、確定解除後）は「—」を表示する。`counter` に値が保持されていても、
  未確定の値は現在有効なCounterと誤認させないため通常UIに表示しない
- 確定解除は `isConfirmed = false` へ戻すだけで `counter` などの保持値は変えない（後述のUI接続状態）。
  したがって確定解除前に表示されていた値は、確定解除後の通常一覧では「—」になる。保持値はDebug Modeで確認できる
- 通常UIのラベルは「カウンター値」とし、「Counter raw値」「内部Counter」などのDebug用語を使わない
- 観測数、候補数、最終観測日時は通常一覧に表示しない。`observationCount` / `candidateCount` /
  `lastObservedAt` / `lastIdentifiedAt` はpersisted dataとして削除せず、状態判定（候補複数など）、
  Identification provenance、Debug Modeの表示・編集のため引き続き保持する
- PCではtable-likeな4カラム（武器種 / 状態 / カウンター値 / 操作）、スマートフォンでは横スクロールさせず
  同じ情報を縦積みのcardとして表示する（3.1）

操作。

- 観測を追加
- Counter検索
- 確定解除

観測入力。

- 武器種
- 抽選テーブル区分（`NormalArtianLotteryTableClass`、[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1）
  - 弓: テーブルA（火・水・雷・氷・龍・爆破）/ テーブルB（無属性・毒・麻痺・睡眠）
  - 弓以外（近接10種、スラッシュアックス、ライト / ヘビィボウガン）: 属性あり / 無属性
  - スラッシュアックスとライト / ヘビィボウガンは両区分が同じProduction poolを参照するため、区分によって選択可能な復元ボーナスは変わらない。スラッシュアックスは両区分とも基礎攻撃力強化 / 属性強化 / 斬れ味強化 / 会心率強化であり、無属性でも属性強化を選択できる（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）。この場合Dialogの案内にDomainのpool同一性から導出した補足文を表示し、UI側に武器種別のテーブルを持たない
- 復元ボーナス5枠

通常アーティア観測の `rarity` はDomain上に保持するが、v1 UIでは8を内部的に自動設定し、レア度選択を表示しない。

属性の具体的な種類（火 / 水 / 雷 / 氷 / 龍 / 毒 / 麻痺 / 睡眠 / 爆破）は選択させない。通常アーティアRNGでは属性の種類そのものではなく、その武器種の抽選テーブル区分（Table A / Table B）だけがcandidate poolを変えるため（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1 / 9.12）、Counter検索に必要な入力は2択のテーブル区分だけであり、Observationやworker inputにexact ElementIdを保持する必要はない。弓ではテーブルAが火・水・雷・氷・龍・爆破、テーブルBが無属性・毒・麻痺・睡眠であり、「属性あり / 無属性」では毒・麻痺・睡眠を誤るため、選択肢のラベルにそれぞれの属性名を列挙して表示する。その他の武器種ではテーブルAが属性あり、テーブルBが無属性に一致するため、ユーザー向けには従来どおり「属性あり / 無属性」と表示してよい（必要なら「属性あり（テーブルA）」のような補助表示も可）。どの武器種でも `table_a` / `table_b` の技術enumをそのまま表示しない。ラベルの導出はDomainの分類（`normalArtianLotteryTableClassElementIds()`）に従い、UI側に別の分類表やcandidate tableをハードコードしない。

テーブル区分はCounterを分けない。弓でテーブルAとテーブルBの武器を交互に作成しても、消費するのは同じ武器種のレア8 Counter 1本であり、1回の検索セッション内でテーブルA / Bの観測が混在してよい。テーブル区分を切り替えたとき、切替先のpoolで抽選され得ない復元ボーナス（例: 弓のテーブルBで属性強化）が入力済みなら、そのslotを未入力へ戻す。

観測は同じ武器種のレア8通常アーティアを連続して作成した結果を、作成した順に入力する。観測1の開始Counter候補を `C` とすると観測2は `C + 1`、観測3は `C + 2` に対応するため、間に同じ武器種の通常アーティア作成を挟んではならない。他武器種の通常アーティア作成はCounterが武器種別に独立しているため影響しない。各観測の5枠は表示順のまま入力し、並べ替えない。この表示順契約を視覚的にも追いやすくするため、各観測の復元ボーナス5枠はPC・スマートフォンを問わず、viewport幅にかかわらずslot 1〜5を常に縦1列で表示する。PC幅で2列に折り返してはならない。

検索セッション。

- 観測は検索セッション内でin-memoryに保持し、Observation履歴自体をDBへ永続化しない
- 検索範囲（開始Counter候補のinclusive range）を指定して検索する
- 検索中は進捗（評価完了した開始Counter候補数 / 全候補数、発見候補数）とキャンセルを提供する
- 候補数を表示する。候補が複数なら次の連続forge結果を追加観測として入力し、同じ検索を再実行する。候補をユーザーに手動選択させない
- `maxMatches` 到達などで探索が打ち切られた結果（truncated）は候補数に関係なく確定不可とし、範囲の見直しまたは追加観測を促す
- 候補0件なら観測入力、Base Seed、武器種、属性区分、検索範囲、作成順を確認する。範囲を自動拡張しない
- Base Seedが未確定の場合はこの検索を開始できず、RNG Setupで先にBase Seedを確定するよう案内する
- Production poolを持たない武器種では検索を開始できず、その武器種の通常アーティアpoolが実機未検証であることを表示する。referenceの推測poolで代替検索しない。現時点のProduction supportは弓 / ライトボウガン / ヘビィボウガン / スラッシュアックスを除く近接10武器種（大剣・片手剣・双剣・太刀・ハンマー・狩猟笛・ランス・ガンランス・チャージアックス・操虫棍）/ スラッシュアックス（独立single pool、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）の14武器種すべてであり、該当する武器種はない。可否の判定はUI側の武器種リストではなく `getNormalArtianCounterIdentificationSupport()` に従う

Counter確定とゲーム状態の復元。

Base Seed / Skill Counter / Gogma CounterのIdentification Wizard（5.4）と同じ運用に統一する。`NormalArtianCounter.counter` は「次にforgeされる結果の0-based block index」（[DATA_MODEL.md](./DATA_MODEL.md) 6.2）であり、確定するのは調査前状態のその値である。

- 候補が1件かつ探索が打ち切られていない場合だけ確定できる
- kernelの `startNormalCounter = C` は観測1を作成する直前のCounter、つまり調査前状態で次にforgeされるCounterを表す
- 観測のために通常アーティアを `N` 本作成すると、ゲーム側CounterはC, C+1, ..., C+N-1を消費して一時的に `C + N` へ進む
- 観測後はゲームを保存しない
- 調査前のゲーム状態へ戻ったことをユーザーに確認させてからCounterを確定する。復元後に次にforgeされるCounterは再び `C` である
- 復元確認後、既存 `NormalArtianCounter` へ `counter = startNormalCounter`、`isConfirmed = true`、`observationCount = 観測数`、`candidateCount = 1`、`lastObservedAt = now`、`lastIdentifiedAt = now`（Identification provenance、[DATA_MODEL.md](./DATA_MODEL.md) 6.2）を反映する。この経路だけが `lastIdentifiedAt` を書き、Debug編集や確定 / 確定解除は書かない
- `C + observationCount` を保存する運用は採用しない。kernel / Workerは観測数を加算せず、Counter確定処理とDB更新もkernel / Workerの責務ではない

注意書き。通常ユーザー向けに、検索開始時と確定前の少なくとも2箇所で次の意味の注意を表示する。

```text
観測後はゲームを保存しないでください。
調査前の状態へ戻ったことを確認してからCounterを確定してください。
```

「保存しない」だけでなく「調査前状態へ戻ったことを確認する」まで明記する。5.4と同様に、ゲーム側の保存仕様や安全を断定・保証しない。

制約。

- 一致が1件なら確定
- 複数一致なら追加観測を促す
- 未確定の武器種のレア8 Counterは通常アーティア経由検索に使わない
- Counterの直接修正は通常UIに表示しない（確定済みCounterの値の表示は上記の例外であり、編集ではない）
- Debug Mode ONの場合のみ、警告と確認を伴う手動修正を許可してよい
- 実行中（active）の生産計画がある場合、Counterの確定、確定解除、Debug修正の保存前に16.3の警告を出し、
  承認時だけ生産計画を破棄して保存する

UI接続状態。

- Domain kernel / Worker / Worker Clientは実装済みである（[RNG_SPEC.md](./RNG_SPEC.md) 9.12）
- 本画面への接続は完了している。各武器種行の「観測・検索」が `NormalCounterIdentificationDialog` を開き、観測入力（属性区分 + ordered 5枠）、`AppSettings.defaultSearchLimit` を終了値とする初期検索範囲、Worker Clientによる検索、進捗、キャンセル、unique / multiple / zero / truncatedの候補表示、追加観測、復元確認後のCounter確定（`counter = startNormalCounter`）までを通常UIから行える。確定済み行には「確定解除」を提供し、`isConfirmed = false` へ戻す際に `counter` / `observationCount` / `candidateCount` / `lastObservedAt` / `lastIdentifiedAt` は保持する
- 観測履歴はDialog内のin-memory stateだけに保持し、Observation履歴の永続化schemaは追加していない。Worker Clientはページが所有し、Dialogを閉じたとき・確定したとき・ページunmount時に `dispose()` する
- 検索可能条件は確定済みBase Seed（Production canonical decimal form）だけである。Skill Counter / Gogma Counter / 旧Counter Gateは要求しない。Switch AxeはSwitch Axe Normal Production activation（[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）以降、他の武器種と同様に「観測・検索」を利用できる。Production poolを持たない武器種を「Production検証対象外」として検索開始できなくする表示と、Domain / Worker側の `normal_pool_unverified` fail closedは契約として維持する（現時点で該当する武器種はない）
- unique結果でも通常UIは「候補が1件に絞り込まれました」とだけ表示し、`startNormalCounter` の数値はDebug Mode ONの診断表示に限る。Dialog内でこの数値を通常表示しない契約は一覧の「カウンター値」表示の例外によって変わらず、確定・保存してDialogを閉じた後に一覧で初めて確定値を表示する
- Bow Table A / B修正（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.15）後、Dialogの区分入力は `tableClass` を送る。弓では「テーブルA（火・水・雷・氷・龍・爆破）/ テーブルB（無属性・毒・麻痺・睡眠）」の2択、その他の武器種では「属性あり / 無属性」の2択であり、exact ElementIdのdropdownは追加していない。選択可能Bonusは引き続き `normalArtianCounterObservationBonusOptions(weaponTypeId, tableClass)` がProduction poolから導出し、弓のテーブルAは基礎攻撃力強化 / 属性強化 / 会心率強化、テーブルBは基礎攻撃力強化 / 会心率強化である。unique / multiple / zero / truncated、progress / cancel、復元確認、`counter = startNormalCounter` の確定、raw CounterのDebug限定表示は変更していない
- Switch Axe Normal Production activation（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）後、スラッシュアックス行の「観測・検索」が有効になった。Dialogは弓ではないためgeneric表示「属性あり / 無属性」のままで、exact ElementIdのdropdownは追加していない。両区分の選択可能Bonusは `normalArtianCounterObservationBonusOptions('weapon.switch_axe', tableClass)` からの導出でどちらも基礎攻撃力強化 / 属性強化 / 斬れ味強化 / 会心率強化となり、区分を切り替えても属性強化のslotは未入力へ戻さない。Worker inputは従来どおり `table_a` / `table_b` を送り、Counterは `weapon.switch_axe:8` の1本を両区分で共有する。unique確認 / 復元確認 / `counter = startNormalCounter`（観測数を加算しない）の流れは変更していない

---

## 7. Owned Weapons

目的。

所持している通常アーティアと巨戟アーティアを個別管理する。

一覧表示。

- 名称
- 種類（通常アーティア／巨戟アーティア）
- 武器種
- 属性
- 復元ボーナスの種類（通常アーティア系／巨戟アーティア系。3.3の表記に従う）
- 復元ボーナス5枠
- シリーズスキル（巨戟のみ）
- グループスキル（巨戟のみ）
- 状態（巨戟のみ。通常は「—」）
- 保護
- 優先起点（この武器を優先起点にしているTarget名。未使用なら「なし」。read-only）
- 作成中（実行中の生産計画で作成・加工中なら「作成中（目標武器名）」。read-only、編集不可）

操作。

- 新規登録
- 編集
- 複製
- 削除
- 未分類 / 実用 / 理想切替
- 保護ON/OFF
- 新規登録時の「通常アーティアとして登録」切替。初期値は巨戟

入力制約。

- 復元ボーナスは必ず5枠
- 通常アーティアはscopeを `normal_artian` に固定する。巨戟アーティアは、最初のBonus amendment前の通常継承かamendment後の巨戟tierかを「復元ボーナスの種類」（通常アーティア系／巨戟アーティア系）として明示入力し、選択scope、武器種、属性に対応したWeaponBonusDefinitionだけを表示する。この選択欄には「巨戟化直後、まだ復元ボーナス変更前は「通常アーティア系」です。」という補足を表示する
- 一覧は3.2の表示順契約に従い、自動sortしない
- 復元ボーナス種別とランクの選択肢は、Masterの武器種・scope定義とProduction family availabilityの積を返す複合availability selector（[MASTER_DATA.md](./MASTER_DATA.md) 15.1）から取る（PR-Cで実装済み）。スラッシュアックスの無属性構成は通常／巨戟とも属性強化を選択でき、弓の毒・麻痺・睡眠とライト／ヘビィボウガンは属性強化を表示しない。Masterの `allowsElementBonus` による除外は選択肢のauthorityにしない。UI側に武器種別の抽選テーブルをハードコードしない
- 保存済みの値がこのavailability外の場合（旧UIで保存した弓 / 毒の属性強化等）、その値を自動削除・自動置換せず、「〇〇（現在値・Production抽選対象外）」という無効化された選択肢として表示し、注意文で選び直しを促す。この現在値は通常の選択肢として新規に選択できず、保存はEntity Validationが明示的に拒否する（[DATA_MODEL.md](./DATA_MODEL.md) 7.1）。空欄表示やconsole warningだけにしない
- 通常アーティアではシリーズ／グループスキルとstatus入力を表示せず、保護初期値をOFFにする
- 通常アーティアはレア8として自動登録し、レア度選択UIを表示しない
- 巨戟アーティアのstatusと保護は独立項目として扱う
- 既存武器の種類変更は互換項目の初期化を伴うためv1 UIでは禁止する
- 新規巨戟アーティアの初期値は「未分類 / 保護OFF」とする
- 新規作成時だけ、未分類 / 実用は保護OFF、理想は保護ONを初期値にする（Owned Weapons画面での手動登録の初期値）
- 登録済み巨戟アーティアの通常のstatus変更ではProtectionを自動上書きしない。Protectionは独立項目とする
- statusはユーザー管理ラベルであり、Plannerの操作可否・Target Satisfaction・Search Route
  eligibilityに影響しない。武器性能を変更してよいかは `isProtected` だけが決める
- `isProtected = true` の武器はPlannerがReset Bonuses・Keep Bonuses・Reset Skillsへ使用しない
- `restorationBonusScope = "normal_artian"` の巨戟アーティアにもReset Bonuses / Keep Bonusesの両方を提示する。所持巨戟の5枠は既知であり、Keep可否をscopeで決めない
- 「素材用武器」「素材として使用」など、所持武器を消耗品と誤解させる文言を表示しない
- 削除時にActive Planで参照されている場合は警告する
- 実行中（active）の生産計画が作成・加工中の武器、またはその計画の起点武器について、保護、復元ボーナス、
  スキル、武器種、属性などsemantic項目の変更または削除を保存する前に16.3の警告を出す。status、名称、
  memoだけの変更では警告しない
- 作成中状態はユーザーが直接編集できない。生産計画の完了・終了、Undo、ゲーム内セーブ地点の復元だけで変わる
- statusはユーザーが変更できるほか、Execution Navigatorが巨戟化時に未分類、選択済み妥協checkpoint到達時に
  実用、理想品完成時に理想（保護あり）へ変更する（12.2 / 12.3）。Execution Navigator以外の自動変更はしない
- 旧「関連する目標武器」の表示・編集UIは廃止する。目標武器との紐づけ操作はTarget Weapons画面
  だけから行い、この画面はread-only表示と確認付き解除のためにTarget関係を読み取るだけとする

### 7.1 優先起点として使われている武器の変更

`TargetWeapon.preferredOwnedWeaponId`（[DATA_MODEL.md](../docs/DATA_MODEL.md) 8.5）から
参照されている武器を保護ONへ変更する、または武器種 / 属性を変更して紐づいているTargetと
非互換にする場合は、保存前に確認ダイアログを表示する。

```text
この武器は「Target A」の優先起点に設定されています。
保護するとPlannerでこの武器を変更できなくなるため、
Target Aとの紐づけを解除します。よろしいですか？
```

- キャンセル: 保存しない。保護状態も紐づけも変更しない
- 承認: 武器の変更とTarget側の紐づけ解除を同一トランザクションで保存する

「Targetが保護武器または非互換武器を `preferredOwnedWeaponId` として保持した状態」を
作ってはいけない。保護ON時については確認付き解除を必須とする。

削除時は、優先起点として参照されている武器を黙って削除しない。既存の参照中Entity削除保護
（`PersistenceReferenceKind = "target_weapon"`）を適用する。

statusの変更はこの画面の通常CRUDである。statusは非semanticであるため、statusだけを
変更してもActive Planやビルドリストはstaleにならず、確認ダイアログも表示しない。
Protectionを変更したい場合は独立した項目として明示的に操作する。

優先起点の武器が実行中の生産計画で作成・加工中の場合、保護ONまたは武器種 / 属性変更の確認は
16.3の警告（生産計画の破棄）と1つのダイアログにまとめ、承認時は武器の変更、Target側の紐付け解除、
生産計画の破棄を同一トランザクションで保存する。

Plannerによる保護解除と、ユーザー確認前の状態変更は禁止する。理想品完成時にExecution Navigatorが
保護をONにすることは、Planの正常な完成処理であり保護解除ではない。

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
- 優先起点（設定済みなら武器名、未設定なら「なし」。作成中なら「作成中」を併記）
- 操作0 Idealの通知（所持巨戟が理想条件を満たす場合、8.2）

通常の一覧は `lifecycleStatus = "active"` の目標武器だけを表示する。完了済みの目標武器は折りたたみの
「完了済みの目標武器」に表示する（8.3）。

操作。

- 新規登録
- 編集
- 複製
- 削除
- 検索対象ON/OFF
- この武器で目標を完了にする（8.2）

入力セクション。

1. 基本情報
2. 優先する所持武器
3. 理想復元ボーナス
4. 実用ライン
5. 理想スキル
6. 実用スキル

制約。

- 優先度デフォルトは3
- 理想復元ボーナスは5枠完全指定
- 実用は種類・理想内個数(read-only)・最低Rank・EX最低数。種類はIdeal内のみ、重複禁止
- 代替は元種類・最大置換数・options(代替先種類/最低Rank/EX最低数)。同じ元は1 Rule
- 理想復元ボーナス、実用条件の最低Rank、代替先種類、代替最低Rankの選択肢は、所持武器と同じ複合availability selector（`gogma_artian` scope、[MASTER_DATA.md](./MASTER_DATA.md) 15.1）と、availability外の現在値表示（7）に従う。妥協条件の意味（[TARGET_COMPROMISE_SEMANTICS.md](./TARGET_COMPROMISE_SEMANTICS.md)）は変更しない
- 「未設定種類は理想条件のまま」「代替は1元/1候補のみ、未置換枠は理想、実用Bonusと非併用」を説明する
- 実用Skillの両項目未設定はスキル妥協なし。一覧は全妥協未設定なら「妥協なし（理想のみ検索）」
- DB移行後は旧妥協条件の解除と再設定を案内する。武器種・属性変更はBonus条件を解除し、Ideal編集の不整合は保存validationで拒否する
- 複雑な任意論理式UIは作らない
- 一覧は3.2の表示順契約に従い、自動sortしない。8.1の付け替えで前の保持Targetの優先起点が解除
  される場合も、保存したTargetと解除されたTargetはそれぞれ元の一覧位置を維持する
- 実行中（active）の生産計画に含まれる目標武器について、性能定義、優先度、検索対象ON/OFF、優先起点を
  変更して保存する前に16.3の警告を出す。名称とmemoだけの変更、計画に含まれない目標武器の変更、新規追加では
  警告しない
- 新規追加や計画に含まれない目標武器の変更では生産計画をstaleにしない。保存後に「実行中の生産計画には
  含まれていません。候補検索と現在地点からの再計画の試算で取り込めます。」と案内してよい

### 8.1 優先する所持武器

`TargetWeapon.preferredOwnedWeaponId`（[DATA_MODEL.md](../docs/DATA_MODEL.md) 8.5）を設定する
Selectを置き、補助説明を添える。

```text
この目標を作る際の起点として優先します。
より短い作成ルートがある場合は、そちらが選ばれることがあります。
```

候補には少なくともweapon name、kind、status（巨戟のみ、必要なら）、保護状態、
他Targetへの割当状況が判断できる表示を行う。

```text
双剣 / 火 / 武器A
双剣 / 火 / 武器B  [Target Xに割当中]
双剣 / 火 / 武器C  [保護中・選択不可]
```

- 候補は同一武器種・属性の所持武器とする。Normal / Gogmaのどちらも表示する
- statusは表示条件にしない。非保護で互換なら未分類 / 実用 / 理想のいずれも選択できる
- 互換性のある保護武器も表示するが選択不可とする。完全に非表示にせず、「なぜ候補にないのか」
  が分かるUIにする
- `指定なし` を選択可能にする

表示順は次のグループ順とし、同一グループ内は名前またはID等のstableな既存基準で決定的に並べる。

1. 現在このTargetに設定されている武器
2. 未割当かつ非保護
3. 別Targetに割当済みかつ非保護
4. 保護中

#### 別Targetに割当済み武器の付け替え

別Targetが優先起点にしている武器を選択した場合、選択自体は可能だが確認メッセージを出す。

```text
この武器は現在「Target A」の優先起点に設定されています。
「Target B」に変更すると、Target Aとの紐づけは解除されます。
変更しますか？
```

- キャンセル: 選択を変更しない。DBも変更しない
- 承認して保存: 旧Target `preferredOwnedWeaponId = null` と
  新Target `preferredOwnedWeaponId = Weapon X` を同一トランザクションで保存する

#### Targetの武器種 / 属性変更

編集中にweaponTypeIdまたはelementIdを変更し、現在の `preferredOwnedWeaponId` が互換でなくなる
場合は `preferredOwnedWeaponId = null` へ戻す。これは編集中のdraftだけで行い、保存まではDBを
書き換えない。Target自身の定義変更なので、別Targetから武器を奪う操作とは扱わず確認も出さない。

#### Executionによる自動紐付けと作成中の武器

- 生産計画が既存の所持武器を起点に使う目標武器は、Production Planの「作成開始」で優先起点がその武器へ
  自動設定され、別の目標武器の紐付けは解除される（変更は開始前にProduction Plan画面で表示する、11）。
  Plan内で新規作成する作成対象の通常アーティアは、その登録Stepの確定で紐付く。理想品完成時は解除される
  （[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11 / 16.13）。この自動変更に確認ダイアログは出さない
- 優先起点Selectでは、実行中の生産計画で作成中の武器に「作成中（目標武器名）」を表示する
- 別の目標武器で作成中の武器を選択する場合は、付け替え確認に加えて16.3の警告（その生産計画に含まれる
  目標武器の紐付けを変えるため、生産計画を破棄する）を1つのダイアログにまとめる
- 優先起点の変更だけでは作成リストの項目はstaleにならない（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 8.1）

### 8.2 操作0 Idealの通知と目標の完了

active Targetの保存時と一覧表示時に、所持巨戟が現在性能で理想条件を満たす場合は通知する
（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.5.5）。

```text
この目標の理想条件を満たす所持武器をすでに所有しています。
```

- 該当する所持武器を表示し、「この武器で目標を完了にする」を優先導線として置く。候補検索、作成リスト
  追加、生産計画作成を不要にするためである
- 「この武器で目標を完了にする」は確認ダイアログを必須とし、「武器を理想・保護ありにし、目標武器を
  完了済みにします。」を伝える。承認時は武器 `status = "ideal"`、`isProtected = true`、目標武器
  `lifecycleStatus = "completed"`、`preferredOwnedWeaponId = null` を1つのトランザクションで保存する。
  武器の復元ボーナスとスキルは変更しない
- その武器を別の目標武器が優先起点にしている場合は、同じトランザクションでそれらの目標武器の
  `preferredOwnedWeaponId` も `null` にする（保護武器は優先起点にできないため、
  [PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.13）。解除するのは優先起点だけで、それらの目標武器の条件、
  優先度、検索対象ON/OFF、完了状態は変更しない。確認ダイアログには影響する目標武器名とともに次を表示する

```text
この武器は別の目標武器（Target B）でも優先起点に設定されています。
完了すると武器が保護されるため、その優先起点設定も解除されます。
```

- 実行中の生産計画に含まれる目標武器、または計画が作成・加工中の武器では、この操作の前に16.3の警告を出す
- 通知の判定はTarget評価だけで行い、RNG Predictionを実行しない

### 8.3 完了済みの目標武器

- 理想品完成または8.2の操作で完了した目標武器は、通常の一覧から除き、折りたたみの
  「完了済みの目標武器」にread-onlyで表示する（完了日時、完成に使った生産計画があればそのリンク）
- 完了済みの目標武器は候補検索のSelectと作成リストのPlanner入力から除外される。作成リストの項目は
  staleではなく「完了済みの目標武器」として表示する
- 「未完了に戻す」を置く。確認ダイアログで「所持武器は変更しません。再び候補検索と生産計画の対象に
  なります。」を伝え、承認時は `lifecycleStatus = "active"`、`completedAt = null`、`completedByProductionPlanId = null` にする。優先起点は
  `null` のままとする
- 削除は既存の参照中Entity削除保護に従う。生産計画から参照される目標武器は削除できない

---

## 9. Search Results

目的。

TargetWeaponごとに候補を検索し、作成リストへ追加する。

表示構造。

- 目標武器Select（検索対象がONかつ完了済みでない目標武器だけを並べる。単一選択）
- 検索起点（実行中の生産計画がある場合だけ表示）: 現在地点（既定） / 実行中の生産計画の完了後（予測）
- 経路フィルタ: すべて / 通常アーティア経由（新規作成・所持通常の両方） / 既存巨戟から
- 探索量の詳細設定（通常 / 巨戟 / スキルの3上限のみ）
- 理想品候補1件
- 途中採用する状態の選択（スキル候補 / 復元ボーナス候補）と理想品までの改善優先

1回の検索は1つの目標武器だけを対象とする。結果フィルタ（すべて / 理想 / 実用 / 近似）は
存在しない。

スマートフォン。

- 目標武器Selectは上部に固定してよい
- 候補カードと途中採用する状態の一覧は縦スクロール

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
- 必要素材・費用の目安（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 4.3。表示専用）
- 作成リスト追加状態
- 作成ルート内の `reset_bonuses` / `keep_bonuses` については、その操作直後の予測復元ボーナス5枠
- 通常アーティアCounter未確定の強制Resetルート([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)では、
  作成する通常アーティアの復元ボーナス内容を問わないことを操作ラベルへ明示する。
  予測していない5枠を表示しない

途中採用する状態の表示。

理想品候補のRouteを **スキル候補** と **復元ボーナス候補** の2つの独立した軸として提示する。
スキル×復元ボーナスの組み合わせは提示しない。ユーザーは軸ごとに「途中で採用する状態」を
選び、妥協checkpointはPlannerが両軸の選択から合成する
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.8)。

- スキル候補: Skill laneの各途中状態（シリーズスキル / グループスキル、
  判定「スキル判定: 実用 / 理想」、何回目のスキルリセット直後か）と、最後に理想スキル
  （最終目標。チェックボックスなし）
- 復元ボーナス候補: Bonus laneの各途中状態（5枠、判定「ボーナス判定: 実用 / 代替」、
  何回目の復元ボーナス操作直後か、残り何操作で理想品になるか）と、最後に理想5枠
  （最終目標。チェックボックスなし）
- conversionが付与した初回スキルと、既存巨戟の現在スキルは
  「巨戟化直後のスキル（スキルリセット0回）」「現在のスキル（スキルリセット0回）」として
  スキル候補に含める。既存巨戟の現在5枠（gogma scope）も復元ボーナス候補に含める。
  巨戟化直後のnormal scope 5枠は候補にしない
- 同じ性能へ複数回到達できる場合は「その他の到達点」として折りたたみ開示する
- 上位互換の復元ボーナス候補に隠された下位のものは「その他の候補」として
  折りたたみ開示する。一覧から消さない
- 各到達点のチェックボックス。既定はすべてOFF。1 laneにつき選べる到達点は1つまで
- 理想品までの改善優先: 生産計画に任せる（既定）/ スキルを優先 / 復元ボーナスを優先。
  checkpoint到達後にどちらの軸を先に理想へ近づけるかの希望であり、soft preferenceである

操作。

- 検索開始
- 検索キャンセル
- 途中採用する状態の選択 / 解除（lane別）と改善優先の変更
- 作成リストへ追加（選択中の状態と改善優先を一緒に登録する）

検索起点（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 3.2）。

- 既定は「現在地点」であり、最後に実行ナビで確定したRNG状態・通常アーティアCounter・所持武器から検索する。
  実行中の生産計画の開始時点ではない。作成中の武器も起点候補になる
- 「実行中の生産計画の完了後（予測）」は、生産計画が実行中で、現在Stepの期待状態と一致する場合だけ
  選べる。選べない場合は理由を表示する
- この起点の結果には「実行中の生産計画が予測どおり完了した場合の予測です」と常時表示し、
  「作成リストへ追加」を表示しない。途中採用する状態の選択UIも表示しない。現在地点から再検索するか、
  計画完了後に検索するよう案内する
- 実行中の生産計画で完了予定の目標武器を選んだ場合は検索せず、「この目標武器は実行中の生産計画で
  完成予定です。」と表示する
- 操作0 Idealの通知（8.2）に該当する目標武器では、検索結果の上に同じ通知と「この武器で目標を完了にする」
  導線を表示する
- 想定外結果の記録後に対象streamの正式なIdentificationが未採用の場合は再同定（RNG Setup、または通常アーティア
  Counter Setup）を、操作内容不明で実行中Planが停止している場合は実行ナビでの回復を促すwarningを表示する
  （導出条件は[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15）

制約。

- RngState全体の確定は要求しない
- CapabilityがあるRouteだけを検索し、不足値に依存するRouteはskip理由を表示する
- 選択対象の全Routeが実行不能な場合のみ検索開始不可
- TargetWeaponなしなら検索開始不可
- 通常Counter未確定Routeはskip理由を表示
- Route実行に必要なWeaponBonusDefinition等のMaster Dataが利用不能な場合は `master_data_unavailable` としてskip理由を表示する。disabled LotteryMasterだけを理由にProduction Routeをskipしない
- disabled LotteryMasterに由来する警告（「抽選マスターデータ」「通常アーティア経由の検索は
  利用できません」等）を通常UIへ表示しない。LotteryMasterはSearch readinessの判定要素ではない
- MaterialCostMasterのenabled有無はSearch readinessにもCandidate表示にも関係しない。
  「素材コストは未検証です」「素材コストは未検証のため表示できません」のようなMaterialCost由来の
  warning / 表示を通常UIへ出さない
- Candidateカードの候補詳細には「必要素材・費用の目安」セクションを表示する
  （[SEARCH_SPEC.md](./SEARCH_SPEC.md) 4.3、[REQUIREMENTS.md](./REQUIREMENTS.md) 22.1）。
  Candidateの `requiredMaterials` は表示しない。この表示契約はSearch画面と作成リストで共通の
  Candidateカードが担う
  - 区分は RARE8アーティアパーツ（パーツ名と個数）/ 通常復元（ナナイロカネ）/ 巨戟化
    （油濁した遺装置 ×3 と「※巨戟化に使用する激化タイプ」）/ 巨戟復元（回数、ナナイロカネ、
    「または 歴戦錬磨の証」）/ スキル再付与（回数、油濁した遺装置 ×6換算、
    「※巨戟化時と同じ激化タイプなら ×3換算」）/ 必要ゼニー（「約 XXX,XXXz」、3桁区切り）とする
  - Routeに存在しない区分は表示しない。既存巨戟RouteならRARE8パーツ・通常復元・巨戟化を表示しない
  - 操作0の既所持Idealでは「追加の素材・ゼニーは不要」と表示する
  - ナナイロカネと歴戦錬磨の証を「両方必要」と誤認させず、数値と素材名の対応が分かる形にする。
    長い素材名はwrapでき、数値は素材名から離れない
  - パーツ構成が未定義の武器種のforgeは、パーツを推測せず本数だけを示す
  - PCと375px幅のスマートフォンの両方で横スクロールを発生させない。過剰な表形式にせず
    Candidateカードのデザインに合わせる
- protected武器を起点とするReset Bonuses / Keep Bonuses / Reset Skills / mixed amendment Routeは検索結果へ表示しない
- amendmentの起点候補がprotected武器だけの場合は「保護されていない起点武器がない」と各該当Routeのskip理由を表示する
- protected武器でも現在性能がTarget条件を満たす場合は、操作なしの現在性能候補として表示する。この評価だけを理由にSkill / Gogma Predictionを実行しない
- 通常アーティア経由では、候補位置までのforge数、最後の1本だけの巨戟化、conversion時の初回Skill、必要なfirst Reset、その後のReset / Keep / Reset Skillsを実行順に表示する
- 既存の「通常アーティア最大進行量」入力は `maxNormalAdvance`、すなわち最大forge回数を表す。最大0-based offsetではなく、候補offsetの表示が必要なら `0 ... maxNormalAdvance - 1` とする
- normal-tier bonusを持つ巨戟でも最初のBonus amendmentとしてKeepを表示できる。5枠未知のblind Normal経由だけfirst Reset後にKeepを表示する。
  これはunknown入力によるものであり、ゲームルール上の禁止ではない
- conversionだけのRouteでGogma Counter不足をskip理由にせず、Base Seed / Skill Counter不足、Skill Predictionまたはconcrete semantic input support不足を区別して表示する。persisted Counter Gate不足をskip理由にしない
- レア8、非保護、かつTargetと武器種・属性が一致する所持通常アーティアだけを変換元候補として表示する
- 理想品が見つからない場合は「現在の探索範囲では理想品が見つかりませんでした。
  探索量の上限を上げると見つかる場合があります。」と表示する。
  「この目標武器に理想品は存在しません」とは表示しない
- 理想品が見つからない場合は途中採用する状態も表示しない。妥協状態だけを
  単独の候補として提示しない
- 同じ意味の候補が既に作成リストにある場合は「この候補は作成リストに追加済みです。
  途中採用する状態と改善優先は作成リストで変更してください。」と案内し、既存の選択を上書きしない
- 次期契約（未実装、[DATA_MODEL.md](./DATA_MODEL.md) 9.4.1 / [SEARCH_SPEC.md](./SEARCH_SPEC.md) 10.1）:
  同じ目標武器に別の候補が作成リストにある場合は、追加せず置換の確認Dialogを出す。Dialogでは最低限、
  現在登録済みの候補、新しく登録する候補、置き換えると旧候補の途中採用する状態と改善優先は
  引き継がれないことが分かるようにする。承認時だけ1つの置換操作を実行し、キャンセル時は何も変更しない。
  置換が実行中の生産計画を壊す場合は16.3の警告Dialogを経る。同じ目標武器に候補が2件以上ある
  （既存データ）場合は追加も置換もせず、作成リストで1件に整理するよう案内する。具体的な文言とレイアウトは
  実装PRで `ui-ux-pro-max` を使って確定する。現行Productionは別の候補を別項目として追加する
- 既存巨戟のlane位置0候補（現在のスキル / 現在の5枠）は通常どおり選択でき、両laneの開始状態を
  同時に選択した状態でも作成リストへ追加できる。Plannerはそれを開始時点で到達済みの
  妥協checkpointとして扱う
- 検索中は 現在の目標武器名、現在のphase（準備中 / 探索中 / 結果を整理中）、
  settleした探索ステップ数を表示する。探索ステップ数をpercentへ変換しない。
  総work量は探索中に増えるため未知である
- 現在の目標武器はTarget探索の開始時点で表示する
- Search Worker自体が異常終了した場合は検索中表示を解除し、ページ再読み込みを促す
  errorを表示する。v1ではWorkerの自動再生成やページ自動reloadを行わない
- skip理由の文言は、ゲームルール上の禁止とProduction予測未対応を混同しない。
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
- 候補詳細の作成ルートでは、`reset_skills` の各操作について操作直後の予測
  シリーズスキル / グループスキルを表示する。表示はMaster由来の日本語labelとし、
  Master IDをそのまま表示しない。`null` のlabelは既存helperの表記に従う
- 予測結果は `BuildCandidate.skillAmendmentTrace` が示す `operationIndex` に対応させて
  表示し、`reset_skills` が連続しても対応がずれないようにする
- `skillAmendmentTrace` の予測スキルを `reset_skills` 以外のOperationへ表示しない
- `skillAmendmentTrace` を持たない既存Candidateは予測結果を表示せず、記録がない旨だけを
  示す。stale扱いにせず、最終Skillを各Reset Skillsの予測結果として代用しない
- 候補詳細の作成ルートでは、`convert_normal_to_gogma` についても巨戟化時に付与される
  初回シリーズスキル / グループスキルを表示する。表示形式はReset Skillsの予測結果と
  同じとし、Master由来の日本語labelを用いる
- 予測結果は `BuildCandidate.conversionSkillTrace` が示す `operationIndex` に対応させて
  表示する。`skillAmendmentTrace` とは別の観測契約であり、変換をReset Skillsのentryとして
  表示しない
- `conversionSkillTrace` を持たない既存Candidateは予測結果を表示せず、操作名だけを表示する。
  stale扱いにせず、記録がない旨の補足文も表示しない。旧Candidateであることを
  過剰に通知しないためであり、`bonusAmendmentTrace` / `skillAmendmentTrace` の
  補足文は従来どおり維持する
- conversionを含まないRouteには変換の予測スキルを表示しない
- 候補カード上部の最終シリーズ / グループ表示は維持する。これは完成状態であり、
  作成ルートの予測は途中の各Reset Skills直後の状態なので意味が異なる
- 予測結果はSearch / Domainが確定した値を表示するだけとし、UIスレッドでProduction RNGを
  再実行しない
- `no_owned_weapon_available` の文言は武器種を限定しない。武器種はRouteKind labelが示す
- `CandidateSearchWarning` は `severity` ごとに区別して表示する。`info` は見出し
  「お知らせ」のinfo Alert、`warning` は見出し「警告」のwarning Alertとし、両方が
  存在する場合はユーザーが区別できるよう別Alertへ分ける
- 検索方法が限定されただけで検索自体は成立した場合を `warning` として表示しない。
  6.1.1のblind Reset variantが正常に検索された場合がこれにあたり、「検索に失敗した」と
  誤解されない文言にする
- 通常UIへ内部reason enum（`normal_counter_unconfirmed` など）や英語Domain用語を
  そのまま表示しない。技術的な詳細が必要な場合はDebug Modeへ置く

---

## 10. Build List

目的。

Plannerに検討させる候補集合を確認・調整する。

表示。

- TargetWeaponごとのBuildListEntry
- Candidate Snapshot
- route
- estimatedOperationCount
- 途中採用する状態の選択状態（スキル / 復元ボーナス）と理想品までの改善優先
- 競合しそうな資源
- 優先度
- stale状態と理由

途中採用する状態の表示。

- そのEntryのCandidate Snapshotが持つスキル候補と復元ボーナス候補（Search画面と同じ部品）
- laneごとに1つまで選択できるチェックボックス
- 最短の到達点をprimaryとして表示し、その他の到達点は折りたたみ開示する
- 選択中の状態は「作成途中で必ずこの状態を経由する」として説明し、一覧タイルには
  「途中採用状態を選択中」と選択内容・改善優先のchipを表示する
- 理想品までの改善優先のラジオ（生産計画に任せる / スキルを優先 / 復元ボーナスを優先）

操作。

- 候補を外す
- 途中採用する状態の選択 / 解除 / 別の到達点へ変更、改善優先の変更（再検索不要）
- TargetWeapon優先度を変更
- Planner探索上限の詳細設定
- Planner実行（実行中の生産計画が無い場合）
- 現在地点から再計画を試算（実行中の生産計画がある場合、16.4）
- 現在の下書き（未開始の生産計画）を開く、生産計画一覧を見る（10.3）

制約。

- 作成順の手動固定は提供しない
- 実行中の生産計画に含まれる項目には「実行中の生産計画で使用中」を表示する。その項目の削除、途中採用する
  状態・改善優先の変更、その目標武器の優先度変更は保存前に16.3の警告を出す
- 優先度はPlannerの計画順・scoreへの入力であり、Candidateの性能条件ではない。優先度を変更しても作成リストの
  項目はstaleにならない。計画に含まれない目標武器の優先度変更は生産計画をstaleにしない
- 実行中の生産計画があっても新規追加と計画に含まれない項目の変更はでき、生産計画をstaleにしない。
  取り込むには16.4の試算と採用を使う
- 完了済みの目標武器の項目はstaleではなく「完了済みの目標武器」と表示し、Planner入力に含めない
- 途中採用する状態と改善優先の変更はここが唯一の編集場所である。Search側での再追加では変更しない
- 同じEntryへの選択保存は直列化し、各保存は直前の保存結果(または保存中の最新値)を
  起点に次の選択を組み立てる。描画時点の古い選択を起点にして、直前の保存を
  上書きしてはならない(lost update)。Domain validationが選択内容の唯一のauthorityである
- 選択・改善優先を変更してもEntry自体はstaleにならない
- 選択・改善優先を変更すると、その項目を含む既存の作成プランは再計算対象になる。変更後は
  「途中採用する状態と改善優先を更新しました。生産計画を再作成してください。」と案内する。
  実行中の生産計画に含まれる項目では保存前に16.3の警告を出す
- 同一laneから2つ以上の到達点を選択できない。両laneの開始状態の同時選択は有効である
- 改善優先はsoft preferenceであり、選択した途中状態（hard constraint）より常に下位である
  ことを説明する
- 次期契約（未実装、[DATA_MODEL.md](./DATA_MODEL.md) 9.4.1）: 作成リストは目標武器ごとに候補を
  最大1件だけ持つ。同じ目標武器に候補が2件以上ある既存データでは、その目標武器に「複数の作成リスト候補が
  登録されています。使用する候補を1件にしてください。」相当の案内を出し、既存の「候補を外す」
  （16.3の警告を含む）で整理させる。自動で残す候補を選ばない。整理されるまで生産計画の作成と再計画の
  試算はPlannerのfail closedにより作成されない。現行Productionは同じ目標武器に複数の候補を並べられる
- 途中採用する状態を選択した候補は、その目標武器の必須ルートになる。同じ目標武器の
  別候補はそのPlanner実行では使われず、`selected_checkpoint_fixes_target_entry`
  warningで伝える(PLANNER_SPEC 7.5.6)
- 同じ目標武器に途中採用する状態を選択した候補が2件以上ある場合、Plannerは計画を作らず
  `multiple_selected_checkpoint_entries` warningで片方の選択解除を案内する(同 7.5.7)。
  UIが片方を自動解除しない
- 既に理想品を所持している目標武器に途中採用する状態の選択がある場合、Plannerは計画を作らず
  `selected_checkpoint_target_already_ideal` warningで選択解除を案内する(同 7.5.8)
- 選択の内容が候補と一致しない場合、Plannerは計画を作らず
  `invalid_checkpoint_selection` warningでその候補の選択解除を案内する(同 7.5.9)
- Plannerが採用しない可能性があることを表示する
- BuildCandidateの検索結果とBuildListEntryを同一Entityとして扱わない
- staleなBuildListEntryはPlanner入力に含めず、再検索または再追加を促す
- 有効なBuildListEntryが0件ならPlanner実行不可
- Target条件（性能定義）、検索に使用したRNG状態、Routeが参照する起点武器、CalculationContext変更時にEntryのstale理由を表示する。目標武器の優先度、検索対象ON/OFF、優先起点、完了状態だけの変更（Execution Navigatorの自動紐付けを含む）ではstale表示しない
- RNG変更によるstaleは `rng_state_changed` と表示し、再検索・再追加へ誘導する
- Route参照武器のボーナス、スキル、isProtected変更によるstaleは `owned_weapon_changed` と表示し、再検索・再追加へ誘導する。status、作成中状態だけの変更ではstale表示しない
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
- 「完成した目標武器」の分母は `termination.totalTargetCount`（今回の計画対象Target数。作成リストに
  有効な候補がある目標武器の数であり、有効な目標武器全体の数ではない。PLANNER_SPEC 4.1）をそのまま
  表示し、UI側で再計算しない
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

### 10.3 現在の下書きへの導線

Build Listは `ProductionPlanRepository.getDraftProductionPlan()` で現在の下書き（未開始の
生産計画、[DATA_MODEL.md](./DATA_MODEL.md) 11.1）を読み、存在する場合は読み取り専用の案内を表示する。

```text
未開始の生産計画があります。
[下書きを開く]          -> /plans/:draftPlanId
[生産計画一覧を見る]    -> /plans
```

- 実行中の生産計画が無く通常のPlanner実行を提供する状態で下書きが既にある場合、「生産計画の作成」に
  「新しい生産計画を保存すると、現在の未開始の生産計画は置き換えられます。」を明示する。これは
  既存のatomic replacement（`savePlannerOrchestrationResult()`、PLANNER_SPEC 9.2.15）の説明であり、
  UIが新しいPersistence semanticsを持つわけではない
- 下書きと実行中Planの同時存在は禁止されていないため、実行中Planがあるからといって下書きを
  読み捨てない。実行中PlanがあるときのPlanner操作は従来どおり16.4の再計画試算だけとし、下書きは
  「未開始の下書きも保存されています。」の読み取り専用案内として確認できる。実行中Plan中に通常の
  下書き作成ボタンを追加しない
- `getDraftProductionPlan()` が失敗した場合（Persistence invariant violationを含む）は「下書きなし」と
  推測せず、エラーとして表示し、実行中Planを確認できない場合と同じく通常の生産計画の作成を提供しない。
  複数の下書きをUI側で選ばない。再計画の試算は影響を受けない

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
- 必要素材・費用の目安（計画全体。表示専用）
- 必要素材（アイテム）合計（記録がある場合だけ）
- タイムライン形式のPlanStep

操作。

- 作成開始（draft。実行中の生産計画がある場合は、そのPlanを16.4の試算・採用で置き換える案内を表示する）
- 実行ナビを再開する（active）
- 現在地点から再計画を試算（active / stale、16.4）
- 再計算（draft / stale）
- Plan破棄（確認必須、16.2）
- 生産計画一覧へ（11.5。presentationだけの導線であり、Plan表示・what-if・作成開始・再計画の
  state machineには影響しない）
- Debug詳細表示
- 生成時CalculationContext

作成開始では、現在の永続状態が生産計画の計算時の前提（`initialExecutionState`）と一致することを検証し、
一致しない場合は開始せず再計算を促す。

#### 作成開始で変わる優先起点の事前表示

生産計画は既存の所持武器をどの目標武器の作成起点に使うかを決めるが、Draftの生成・保存・表示では
目標武器の優先起点（`preferredOwnedWeaponId`）を変更しない。「作成開始」で `draft -> active` と
同じtransactionで既存武器の紐付けを反映する（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11）。

Draft Planの表示時に、開始で実際に変わる紐付けがある場合だけ「作成開始」の直前に次を表示する
（エラーではない案内）。

```text
この生産計画を開始すると、目標武器の優先起点が変更されます。

所持武器「武器X」
目標A → 目標B
（「目標B」の優先起点だった「武器Y」は解除されます。）

変更は「作成開始」を押した時点で反映されます。
```

- 対象の所持武器、現在その武器を優先起点にしている目標武器（無ければ「未設定」）、紐付け先の目標武器、
  紐付け先がそれまで優先起点にしていた武器を、IDではなく名称で示す。複数あればすべて表示する
- 既に同じ紐付けで変更が起きないものは表示しない
- Plan内で新規作成する作成対象の通常アーティアは開始時に存在しないため表示しない（登録Stepで紐付く）
- 変更予定を確認し終えるまで「作成開始」を押せない。確認中は「開始時に変わる目標武器の優先起点を確認して
  います。」を表示して「作成開始」を無効にする。確認に失敗した場合は失敗を表示し、「作成開始」を無効の
  まま「再確認」を提供する（再確認中は再び確認中として扱う）。確認できた場合だけ、変更の有無にかかわらず
  「作成開始」を有効にする（変更がなければ案内は出さない）
- 表示は読み取り専用で、書き込みの根拠にしない。「作成開始」は保存状態から改めて導出・検証して反映する。
  開始が拒否・失敗した場合はPlanも紐付けも変わらない
- activeになった後はこの未来形の表示を出さない

Plan statusの表示は[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.2に従い、`abandoned` では理由
（ユーザーが破棄 / 再計画を採用 / 妥協品で終了 / 前提を壊す変更を承認）を、`stale` では再計算理由を
区別して表示する。

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
必要素材・費用の目安（計画全体）
必要素材（アイテム）合計（記録がある場合だけ）
既存のConflict / what-if UI
```

#### Plan概要

- Plan status
- Plan ID
- 作成日時
- 全Step数
- 目標武器数
- 完成予定の目標武器数

目標武器数は、そのPlanのStepから確認できるdistinct TargetWeapon ID数とする。
完成予定の目標武器数は `steps[].executionEffects.targetCompletions` のdistinct TargetWeapon ID数だけを
authorityとし、Target件数や `selectedBuildListEntryIds.length` を武器本数と仮定しない。
独立した `reserve_weapon` Stepの数や `expectedResult.shouldSecure` は完成予定のauthorityにしない
（[DATA_MODEL.md](./DATA_MODEL.md) 11.4）。`executionEffects` を持たないlegacy Planでは、完成予定数を
推測せず「不明（旧形式の計画）」と表示する。

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
- `confirm_owned_ideal`（legacy Planでは `reserve_weapon`）のようにRoute進行を伴わないStepは `targetWeaponId` により帰属する
- 同じTarget IDを1Step内で重複させない
- `targetWeaponId === null` かつ `progressedTargetWeaponIds` が空のStepは、
  目標武器ごとのルートに含めず、計画全体の実行順にだけ含める

`progressedTargetWeaponIds.length > 1` のStepは各Target側へ表示してよいが、それはpresentation上の
帰属表示であり、物理操作を複数回行う意味にしてはならない。「共有操作」badge等で、計画全体では
1回だけ実行するStepであることを示す。

#### 計画全体の実行順

authorityは `ProductionPlan.steps`、表示順は `step.order` の昇順とする。UI独自の並べ替えや
Candidate順への変換を行わない。shared physical Stepもここでは1回だけ表示する。

#### 必要素材・費用の目安（計画全体）

計画全体を最後まで実行した場合に必要となる素材・ゼニーの目安を、Candidateカードと同じ区分
（RARE8アーティアパーツ / 通常復元 / 巨戟化 / 巨戟復元 / スキル再付与 / 必要ゼニー）で表示する
（[REQUIREMENTS.md](./REQUIREMENTS.md) 22.1、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 8.2）。

- authorityは `ProductionPlan.steps` の物理Step列であり、表示時に導出する。Build List Entryや
  CandidateのCost Estimateを加算しない。shared physical Stepは1回だけ加算する。
  `confirm_owned_ideal`、legacyの `reserve_weapon` / `confirm_result`、武器切替案内は加算しない
- 完了済みStepも含めた計画全体の総量である旨を表示する
- `create_normal_artian` Stepの役割は `executionEffects.normalCreationRole` だけをauthorityとし、
  作成対象Normal（`production_target`）だけに完全復元を加算する。武器種は同じEntryの登録Stepの
  `inventoryChange.addOwnedWeapon.weaponTypeId` から解決し、無い場合だけcurrent TargetWeaponの
  武器種へfallbackする。`executionEffects` を持たないlegacy Planの作成Stepでは役割を推測せず、
  「旧形式の計画のため、必要素材・費用の目安を算出できません。」と表示する
- 目安であることを明示し、素材不足の判定やwarningを行わない。Plannerの結果、Step順、Plan validity、
  実行semanticsを変えず、persistもしない
- 「必要素材（アイテム）合計」（Master価格付きの `plan.requiredMaterials`）は記録がある場合だけ、
  保存値のまま別セクションとして表示する。記録が無い場合はセクション自体を表示しない
- 375px幅で横overflowを発生させない

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
`executionEffects.targetCompletions` を持つStepだけを「このStepで完成する目標武器」として表示し、
`shouldSecure` やStep種別から完成予定を推測しない。

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

current Conflictの `checkpointParticipants` が1件以上ある場合(checkpoint競合)、その
競合の全participantを `checkpoint_conflict` として利用不可にし、「比較する」と
「この候補を優先」をdisabledにする。競合単位で「この競合には途中採用する状態の選択が
関係しています。作成リストで途中採用する状態を変更または解除してください。」と、
作成リスト(`/build-list`)への導線「ビルドリストで途中採用する状態を変更」を表示する。
checkpointを持つ側だけでなく相手側も選択できない。これはUIだけの無効化ではなく、
Domainが同じresolutionを拒否する([PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.5.1)。
checkpoint関与の判定はcurrent preparationの `checkpointParticipants` から行い、
保存済みPlanの `PlanConflict.checkpointParticipants` を判定authorityにしない。

### 11.2 「比較する」とwhat-if preview

各有効participantに「比較する」を置く。クリックしたparticipantだけを
`scenarioResolution` とし、fresh PlannerInputへ表示中Planの既存explicit resolutionを
復元して、`defaultPlannerWhatIfBounds = 2 / 8` をApplication callerが明示指定する。

表示中Planから復元するのは `conflicts[].selectedBuildListEntryId !== null` の選択だけである。
`recommendedBuildListEntryId`、Planner score、Beam bestState、Target priority、
`selectedBuildListEntryIds` からresolutionを作らない。

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
追加しない。各non-fixed Targetについて理想品候補1件の結果を表示する。
Practical枠 / Ideal枠という2枠構造は存在しない。

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
| `blocked_by_selected_checkpoint` | 途中採用する状態が選択されているため代替ルートを探索しない。作成リストでの変更または解除を案内する |

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
`plan !== null` でもfail closedとする。checkpoint競合へのresolutionはDomainがこのwarningで
拒否するため、同じfail closedがそのまま適用される。選択済みcheckpointを持つTargetの
Routeを置き換えられない場合の `selected_checkpoint_blocks_constrained_search` は
再選択を促すwarningであり、Planの保存を妨げない。`savePlannerOrchestrationResult()` を呼ばず、ProductionPlanも
generated BuildListEntryも保存せず、新Planへ遷移しない。表示中の旧Planを維持し、再選択または
再計算を促す。warning.messageを解析せず、Planner推奨または別participantへfallbackせず、invalid
resolutionを無視したordinary Planを保存しない。

上記warningが無い結果だけ、既存
`plannerResultPersistenceService.savePlannerOrchestrationResult()` でgenerated BuildListEntryと
ProductionPlanをatomic保存する。新しいPlanが保存された場合はその
`/plans/:planId` へ遷移する。Planが生成されない場合または保存失敗時は旧Draftを置換・削除しない。
保存が完全に成功した場合だけ、Persistence serviceが同一transaction内で旧Draftを新Draftへatomicに
置換する（通常Draftは最大1件、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.15 /
[DATA_MODEL.md](./DATA_MODEL.md) 11.1）。B10が独自の判断で旧Planを削除することはなく、実行中・
完了・破棄済みのPlanは新Draft保存で削除されない。

B10の編集対象は原則 `status === 'draft'` とする。`stale` はwhat-if / Conflict固定を継続せず
既存の再計算へ誘導する。`active` / `completed` / `abandoned` PlanをB10操作で書き換えない。

PlanStep表示。

- 順番
- 今回行う作業
- 使用する武器
- 通常アーティア作成Stepの区分（Counter進行用 / この後巨戟化する作成対象）
- 想定結果
- このStepで完成する目標武器（`executionEffects.targetCompletions` がある場合）

独立した「確保」Stepは表示しない。legacy Planに残る `reserve_weapon` Stepは内容確認のために表示して
よいが、実行可能な操作として扱わない。


制約。

- 実行中（active / stale）のPlanは同時に1件まで
- stale Planでは作成開始不可。再計算または現在地点からの再計画試算を促す
- 現在CalculationContextと非互換なPlanはstaleとする
- Debug Mode OFFではSeed / Counterを表示しない

### 11.5 生産計画一覧（/plans）

目的。

保存済みのProductionPlan全体を1つの一覧で確認し、現在の下書きを削除する。

- Draft専用一覧や履歴専用一覧へ分けず、`draft` / `active` / `stale` / `completed` / `abandoned` の
  すべてを同じ「生産計画一覧」に表示する。status別sectionへ分割しない
- 一覧のauthorityは `ProductionPlanRepository.getAllProductionPlans()` が返すexact persisted
  ProductionPlanである。BuildCandidate / BuildListEntryからの再構成、Plannerの再実行、RNG Predictionを
  行わない。一覧はread-only projectionであり、下書きの削除だけがwrite操作である
- 表示順は `updatedAt` 降順、次に `createdAt` 降順、最後にIDの安定tie-breakとし、最近変更されたPlanを
  上に表示する。Repositoryの既存orderingは変えず、presentation側で安定sortする
- statusは既存 `ProductionPlanStatus` をauthorityとし、`StatusChip` の文字列ラベルで識別する
  （draft 下書き / active 実行中 / stale 再計算が必要 / completed 完了 / abandoned 終了）。色だけで
  区別しない。`abandoned` は再計画採用や妥協品終了を含むため「破棄済み」ではなく「終了」と表示し、
  `abandonmentReason` のtyped label（ユーザーが破棄 / 再計画を採用 / 妥協品で終了 / 前提を壊す変更を
  承認）を併記する。`stale` は `recalculationReasons` を `RecalculationReason` 全kindに対応する
  ユーザー向け文言で表示する。message文字列の解析やraw enumの表示は行わない
- 各Planに最低限、status、stale理由または終了理由、作成日時、最終更新日時、Step進捗
  （完了Step数 / 全Step数。`steps[].isCompleted` と `steps.length` から数える）、目標武器数
  （`createProductionPlanSummary()`。`selectedBuildListEntryIds.length` から推測しない）、
  詳細への導線を表示する。technical Plan IDは通常表示の主情報にせず、Debug Mode ON時だけ補助表示する
- 操作: 全statusに「詳細を見る」（`/plans/:planId`）。`active` にだけ「実行ナビを再開」
  （`/plans/:planId/run`）。`draft` にだけ「下書きを削除」。`stale` / `completed` / `abandoned` に
  削除ボタンを出さない
- 「下書きを削除」は確認Dialog（title / description付き）を必須とする。「まだ開始していない生産計画だけを
  削除します。ビルドリスト、候補、目標武器、所持武器は削除されません。」を示し、破壊的ボタンは
  「キャンセル」と区別して誤タップしにくい位置に置く。削除の実体は
  `ProductionPlanRepository.deleteDraftProductionPlan(id)`（[DATA_MODEL.md](./DATA_MODEL.md) 11.1）で
  あり、汎用の `deleteProductionPlan(id)` をUIから直接呼ばない。表示後にstatusが変わっていた場合も
  `draft` 以外のPlanは削除されない。削除はBuildListEntry / BuildCandidate / TargetWeapon / OwnedWeapon /
  ExecutionHistory / ExecutionSavePointへcascadeしない
- 削除成功後は一覧からその下書きだけを消す（ページreloadを要求しない）。削除失敗時は既存の一覧を
  維持してerror Alertを表示し、typed codeで文言を選ぶ
- 0件なら「生産計画はまだありません。ビルドリストから生産計画を作成できます。」と
  「ビルドリストを開く」を表示する。Persistenceの読み込み失敗は0件として扱わず、error Alertを表示して
  空状態を出さない。loading / loaded / errorを区別し、loading中はLinearProgress等を表示する
- PCとスマートフォンを同等に扱う。375px程度でもstatus・理由・日時・進捗・操作が横にはみ出さない
  カードlayoutとし、操作はxsで縦並び、sm以上で横並び、ボタンのminHeightは44pxとする
- 到達経路: 固定ナビゲーションの「生産計画」（2.1）、Dashboardの「生産計画一覧を見る」（4）、
  Build Listの「生産計画一覧を見る」（10.3）、Production Plan詳細の「生産計画一覧へ」（11）

---

## 12. Execution Navigator

目的。

作成プランに従ってゲーム操作を1ステップずつ案内し、ユーザーが確認したゲーム状態をStepごとに
確定する。意味論のauthorityは[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16章である。

表示。

- 現在Step番号と完了済み / 残りStep数
- 今回行う作業
- 使用する武器（tracked weaponの名称。Counter進行用Normal作成では武器名を出さない）
- 使用する武器・目標武器の名称は、その登録内容をread-onlyで確認する操作を兼ねる。
  名称そのものを操作可能なbutton（別画面へ遷移しないためlinkではない）とし、
  accessible nameから内容確認操作であることが分かるようにする
- `create_normal_artian` の区分: 「Counter進行用（この武器は登録しません）」または
  「この後巨戟化する作成対象」（`executionEffects.normalCreationRole` だけをauthorityとする）
- 想定結果（予測しないStepでは「予測なし」。blind作成対象では「ゲーム画面で確認した5枠を入力」）
- このStepで完成する目標武器（`executionEffects.targetCompletions` がある場合だけ）
- このStepで到達する妥協checkpoint（`checkpointMilestones` がある場合だけ）
- 「アプリはゲームのセーブを判別しません」の短い補足と、最後のゲーム内セーブ地点の記録有無
- RNG再同定を促す表示（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15の条件を満たす場合）

### 使用する武器・目標武器の内容確認

実行ナビから離れずに、いま操作する武器とその目標武器の内容を確認できるようにする。

- 所持武器の内容確認では、現在persistされている `OwnedWeapon` の現在内容を表示する。
  表示するのは武器名、種類（通常アーティア / 巨戟アーティア）、武器種、属性、復元ボーナスの種類、
  復元ボーナス5枠、巨戟アーティアの場合のシリーズスキルとグループスキルとする。
  status、保護状態、memo、優先起点、作成中状態、日時、内部IDは表示しない
- 目標武器の内容確認では、現在persistされている `TargetWeapon` の理想条件を表示する。
  表示するのは目標武器名、武器種、属性、理想ボーナス5枠、理想スキル条件とする。
  優先度、有効 / 無効、優先起点、実用ボーナス条件、代替ボーナス条件、実用スキル条件、
  lifecycle、日時、内部IDは表示しない。妥協条件の確認画面にはしない
- 5枠は保存順のまま表示し、sort / group化 / 重複の削除を行わず、既存の復元ボーナス表示
  （種類別の色分けとEXの強調）をそのまま再利用する（3.4）
- 表示authorityは実行ナビが読み込んだ現在のentityだけとする。`PlanStep.expectedResult` は
  操作後の想定結果であり現在の武器内容ではないため、そこから再構成しない。BuildCandidate、
  BuildListEntry、Planner結果、RNG再計算からも再構成しない
- entityを解決できずID fallback名（「所持武器（…）」「目標武器（…）」）を表示する場合は、
  名称をそのまま表示し内容確認操作を出さない。内容を推測して表示しない
- Counter進行用Normal作成では使用する武器自体を表示しないため、内容確認操作も出さない。
  作成対象Normalの登録Stepでは所持武器がまだ存在しないため、所持武器の内容確認は出さない
- 内容確認の表示と終了はPresentationのみの操作であり、ProductionPlan、RngState、
  NormalArtianCounter、OwnedWeapon、TargetWeapon、ExecutionHistory、ゲーム内セーブ地点の
  いずれも変更しない

基本操作。

- 結果一致・次へ
- 実際の5枠を入力して確定（blind作成対象Stepだけ）
- 所持武器で完成を確認（`confirm_owned_ideal` Stepだけ）
- 結果が違う
- 何を何回操作したか分からない
- Undo
- ゲーム内セーブ済みとして記録
- 最後のゲーム内セーブ地点へ戻す
- プラン全体を見る

独立した「確保」ボタンとStepは表示しない。理想品の完成は最後の物理操作Stepの「結果一致・次へ」で
同時に確定する（12.2）。

スマートフォンでは主要ボタン（結果一致・次へ、または入力して確定）を片手で押しやすい位置に置き、
「結果が違う」「何を何回操作したか分からない」「Undo」はそれと誤タップしにくい配置にする（3.1）。

中断と再開。

- 一時中断用の操作やstatusは持たない。ブラウザやゲームを閉じてもPlanは `active` のままで、
  再訪時は `currentStepId` のStepから再開する
- Dashboard（4）とProduction Plan（11）から「実行ナビを再開する」で戻れる

## 12.1 結果一致・次へ

処理（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.1）。

- 実状態が現在Stepの `expectedStateBefore` と一致することを確認
- 実行前状態からExecutionUndoSnapshotを作成
- `rngAdvance` をRngState / NormalArtianCounterへ即時反映
- `executionEffects` を適用（作成対象Normalの登録とそのTarget紐付け、同一ID更新、妥協checkpointの
  実用ラベル、理想品完成）
- 更新後の実状態が `expectedStateAfter` と一致することを確認
- ExecutionHistory追加
- PlanStep完了、次Stepへ進む（最後のStepならPlan完了）

これらは12.9の共通Dexie transactionで確定する。不一致の場合はStep完了を確定せず、差分と再計算導線を
表示する。

既存の所持武器の紐付けは作成開始時に反映済みで、Production Plan画面で事前に表示している（11）。
Stepの確定で紐付けの移動を改めて通知しない。実行ナビでは、今どの武器を操作するかと現在Stepの操作を
中心に表示する。

### blind作成対象の観測値入力

- 作成対象がblind Normal（5枠を予測しない）の場合、「結果一致・次へ」の代わりに
  「実際の5枠を入力して確定」を表示する
- 入力UIは所持武器登録と同じ5枠入力部品と複合availability selectorを使い、5枠すべてが入力されるまで
  確定できない
- 「これは予測ではなく、ゲーム画面で確認した実際の5枠です」と表示する。予測との一致判定は行わない
- 架空の5枠を初期値として埋めない
- Counter進行用Normalでは入力を求めない

## 12.2 理想品の完成

`targetCompletions` を持つStepでは、Stepカードに「このStepで『（目標武器名）』が完成します」と表示し、
「結果一致・次へ」で次を同時に確定する（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.13）。

- 武器を理想（status ideal）にし、保護する（既存武器でも保護する）
- 作成中を解除する
- 目標武器を完了にし、優先起点の紐付けを解除する。その武器を優先起点にしている他の目標武器の紐付けも
  同時に解除する（解除した目標武器はUndoで戻る）

確定後、`targetCompletions` をauthorityとして「（目標武器名）が完成しました」を1回通知する。完成した
所持武器は目標武器の起点としてPlanで作成・更新してきた同じ実体であり、所持武器側の完成通知を別に出さない。
全Stepが終わった場合は「生産計画が完了しました」を表示する。

### 操作0の完成確認

`confirm_owned_ideal` Stepでは次を表示し、ゲーム操作を求めない。

```text
この所持武器はすでに目標条件を満たしています。
理想品として確定します。
```

「所持武器で完成を確認」でCounterを進めずに12.2の完成処理だけを行う。武器切替案内（12.6）は出さない。

## 12.3 妥協checkpointへの到達

`checkpointMilestones` を持つStepを確定すると、そのStepの確定transactionで武器を実用（status practical）に
する。作成中と保護は変更しない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.12）。

確定後、次Stepへ進む前に次のパネルを表示する。

```text
作成リストで選んだ途中採用状態に到達しました。
この武器は「実用」になりました。
```

- 次の操作へ進む（主要ボタン）
- この武器を妥協品として確定して終了

開始時点で既に到達しているcheckpoint（既存巨戟の現在状態を途中採用状態に選んだ場合）は、
そのEntryの最初の物理Stepの前に同じパネルを表示する。

パネルは直近に完了したStepのmilestoneから導出するpresentationであり、「次の操作へ進む」を押した事実を
永続化しない。ブラウザ再開時に再表示されても安全である。

「この武器を妥協品として確定して終了」は確認ダイアログを必須とする。

```text
この武器を妥協品として確定し、現在の生産計画を終了します。
残りの作成手順は実行されません。
未完了の目標武器がある場合は現在状態から再計画できます。

[キャンセル] [妥協品として確定して終了]
```

承認時は武器を実用のまま確定し、作成中を解除し、目標武器は未完了のまま、優先起点の紐付けは維持し、
Planを破棄（妥協品で終了）にする。ゲーム内セーブ地点の選択（16.2）は出さない。完了後はBuild List /
Target Weaponsへの導線と「現在地点から再計画を試算」の案内を表示する。

## 12.4 結果が違う

「結果が違う」は、操作自体は案内どおり1回行ったことが明確で、結果だけが予測と異なる場合に使う。

処理。

- 実結果入力画面を開く（5枠、Series / Group Skillのうち、そのStepで確認できる項目）
- 実行前状態をExecutionUndoSnapshotへ保存
- 操作は実行済みとしてCounter消費を反映する
- 実結果を追跡武器へ保存する（作成対象Normalなら実結果で登録する）
- ActualResultとExecutionHistoryを保存する
- Planをstale（予測と異なる結果）にする
- RNG再同定への導線を表示する（Gogma / SkillはRNG SetupのIdentification Wizard、通常アーティアは
  Normal Counter Setup）

妥協checkpointの実用ラベルと理想品完成は適用しない。自動で再計画しない。

## 12.5 何を何回操作したか分からない

「Resetを2回押したかもしれない」「別の操作をしてしまった」など、実際の操作内容が不明な場合に使う。
意味論のauthorityは[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.15である。

記録。

- 確認ダイアログで「Counterと武器の状態は変更しません。何を何回操作したかを推測せず、この生産計画を
  続行できない状態にします」と伝える
- 同じ確認ダイアログで、記録後はこの画面で回復方法を選ぶこと、および誤って記録した場合は記録を取り消して
  元の操作へ戻せることを伝える。通常のRNG同定が必要になるとは書かない
- Counterを推測せず、RngState / NormalArtianCounter / 所持武器 / 目標武器を変更しない
- ExecutionHistoryを記録し、Planをstale（操作内容不明）にする

記録後の回復（Planが操作内容不明でstaleで、最新の記録がその操作内容不明である間）。

通常のRNG同定（RNG SetupのIdentification Wizard、Normal Counter Setup）へは直接誘導しない。それらは
追加の操作でゲーム状態を進める調査手順であり、実行中Planの回復に使うとPlan外の操作が増えるためである。
Execution Navigatorで次から選ばせる。

- 「同じ操作を何回行ったか分からない」: 操作種類と操作した武器は分かっていて回数だけが分からない場合。
  現在位置の確認へ進む。ゲーム内セーブ地点があれば「最後のゲーム内セーブ地点へ戻す」も同時に選べる
- 「別の操作・別の武器を操作してしまった」: 現在位置の確認は提示しない。ゲーム内セーブ地点があれば
  その復元を推奨し、無ければPlan破棄を案内する

現在位置の確認（Current Position Recovery）。

- 説明: 現在ゲーム画面に表示されている結果から作成プラン内の現在位置を確認できること、確認中はゲーム内で
  ここで案内された操作以外を行わないこと
- 入力: Reset / Keep Bonusesは現在の復元ボーナス5枠（scopeは固定で選ばせない）、conversion / Reset Skillsは
  Series / Group Skill（「未入力」と「スキルなし」を区別する）、予測ありの通常アーティア作成は最後に作成した
  通常アーティアの5枠。いずれも架空値や想定結果で初期化しない
- 照合はPlanの記録済み結果との完全一致で、同じ操作が連続する区間（Recovery Window）の中だけを対象にする
- 一意: 「現在位置を特定できました」と、Plan上の到達Stepと次の操作を表示し、「この位置に合わせて続ける」で
  追従を確定する。Planはそのまま再開する（再計画しない）
- 複数: 「候補を1件に絞れませんでした」と候補数を表示し、どの候補でも次が同じ操作である場合だけ
  「Planどおり次の操作を1回だけ実行し、その結果を入力してください」と案内して次の観測を入力させる
- 0件、または安全に絞り込めない: 「現在位置を安全に特定できません」と表示し、入力の修正、
  セーブ地点の復元（あれば）、Plan破棄（セーブ地点が無ければ）を表示する
- blind作成対象Normalなど比較できる予測を持たないStepでは現在位置の確認を提示せず、セーブ地点の復元または
  Plan破棄を案内する
- Seed / Counterの数値はDebug Mode OFFで表示しない。Plan上のStep番号や操作名は表示してよい

ゲーム内セーブ地点の復元（回復内の導線）。

- 実行前に「ゲーム側を最後のゲーム内セーブ地点まで戻しました」という明示確認を求め、確認後にだけ
  アプリ側を復元する（16.9の既存復元。アプリ側だけを先に戻さない）

誤って記録した場合の取り消し（回復内の導線）。

- 「操作内容不明」の記録は永続化済みであるため、Presentationだけのキャンセルでは戻せない。最新の
  ExecutionHistoryとしてUndoできる間は、12.7のUndoをこの記録専用の表示で提示する
- 回復画面には、誤記録なら取り消して記録前の操作へ戻せること、実際に操作状況が不明な場合は取り消さず
  現在位置の確認やゲーム内セーブ地点への復元を使うことを併記する
- 新しい取り消し用のtransactionは追加しない。既存のUndo（12.7）をそのまま使う

Plan破棄（回復内の導線、セーブ地点が無い場合）。

- 確認ダイアログの後に既存のユーザー破棄で終了する。キャンセルでは何も変更しない
- 破棄後は「現在のゲーム状態に合わせて、RNG状態・通常アーティアCounter・所持武器を確認・再登録してから
  再計画してください」と案内し、RNG状態設定、通常アーティアCounter、所持武器、ビルドリストへの導線を出す

## 12.6 武器切替案内

連続する物理操作Stepで対象の武器が変わる場合、現在Stepの表示へ進む前のinterstitialとして次の案内だけを
表示する（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.14）。

```text
作業する武器を「○○」へ切り替えてください
[武器を切り替えました]
```

- 判定は巨戟化 / Reset Bonuses / Keep Bonuses / Reset SkillsのStepのtracked weaponで行い、
  通常アーティア作成と操作0の完成確認は対象外とする
- 案内中は現在Stepカードを表示しない。操作名、Stepのtitle / instruction、使用する武器・目標武器、
  想定結果、「結果一致・次へ」「結果が違う」「何を何回操作したか分からない」を含む、現在Stepの実操作に
  関わる表示を出さない。CSSで隠すのではなく、支援技術からも存在しない状態とする
- 案内中でも、切替対象を識別するために切替先のcurrent persisted OwnedWeaponのread-only内容
  （12の「使用する武器・目標武器の内容確認」と同じ表示）を確認してよい。案内文中の武器名自体を
  その操作対象とする。これは現在Stepの内容を先に開示するものではなく、目標武器とその条件、
  現在Stepの操作、想定結果は引き続き表示しない
- 内容確認の表示と終了は「武器を切り替えました」の代わりにはならない。acknowledgementは
  明示的なボタンだけで行い、内容確認を開閉しても現在Stepカードは表示しない
- 現在Step番号と完了 / 残りStep数の進捗表示（12）、Undo（12.7）、ゲーム内セーブ地点（12.8）、
  現在Planの破棄（16.2）は案内中も従来どおり利用できる。
  現在Step固有のDebug表示（15）は案内中は出さず、現在Stepカードと同時に表示する
- 「武器を切り替えました」で初めて現在Stepカード全体（操作説明、想定結果、操作ボタン）を表示する。
  これはStep確定ではなく、Counter、所持武器、ExecutionHistory、Undo対象のいずれも変更しない
- 表示状態を永続化しない。ブラウザ再開時には再び案内から始め、現在Stepカードは再び非表示となってよい
- 途中採用checkpoint（12.3）が未処理の間はそちらを先に処理し、その後に必要なら武器切替案内を表示する
- Case: 武器A操作 -> 武器B操作 -> 武器A操作 では、B操作の前とA操作の前に案内を出す

## 12.7 Undo

処理（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.16）。

- 最後のExecutionHistoryのExecutionUndoSnapshotを読み込む
- RngStateと全NormalArtianCounterを実行前へ戻す
- Stepで追加した所持武器を削除し、更新した所持武器（status、作成中を含む）を実行前へ戻す
- Stepで変更した目標武器（優先起点の紐付け、完了状態）を実行前へ戻す
- ProductionPlanを実行前Snapshotへ戻す
- ゲーム内セーブ地点を戻す（そのStepで削除されていれば復元し、取り消すStepがセーブ地点なら削除する）
- 最後のExecutionHistoryを削除する

Undoは上記すべてを1つのDexie transactionで行う。途中で失敗した場合は部分復元を残さず、Undo前の状態と
履歴を維持する。Undo自体のExecutionHistoryは追加しない。

Undoを表示できるのは、Planが実行中 / staleの場合と、完了または妥協品で終了した直後の最後の記録の場合
だけである。再計画採用、Plan破棄、前提を壊す変更の承認で終了したPlanにはUndoを表示しない。

注意表示。

```text
Undoはツール上の操作を戻すだけです。ゲーム内の操作は戻りません。
```

取り消すStepがゲーム内セーブ地点の記録地点である場合は、Undo確認に「ゲーム内セーブ地点の記録も
削除されます」を添える。

Undoの表示文言は取り消す記録に合わせる。通常は「最後の操作をUndo」とする。取り消す記録が
`operation_uncertain` の場合は、回復画面からその記録を取り消すことが分かるよう「「操作内容不明」の記録を
取り消す」とし、確認ダイアログにも誤記録の場合だけ使うこと、実際に操作状況が不明な場合は12.5の回復方法を
使うことを添える。「キャンセル」「戻る」だけの曖昧な名称にはしない。文言だけの違いであり、Undoの対象記録、
適用条件、復元内容は変わらない。

## 12.8 ゲーム内セーブ地点

「ゲーム内セーブ済みとして記録」（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.9）。

- 補足: 「ゲーム側で現在の地点を保存したことを確認してから記録してください。アプリはゲームのセーブを
  判別しません。」
- 実行中（active）のPlanだけで押せる。既存の記録は上書きし、上書き前に確認する
- 妥協checkpoint（途中採用状態）と混同しないよう、UI文言にcheckpointの語を使わない

「最後のゲーム内セーブ地点へ戻す」。

- 記録があり、その後に確定したStepがある場合だけ有効
- 確認ダイアログ:

```text
ゲーム側も、記録したセーブ地点（Step 12完了時点）から再開していますか？
アプリの実行状態（RNG状態、通常アーティアCounter、この計画で作成・加工中の武器、
関係する目標武器、計画の進行）をその地点へ戻します。
その後に追加した目標武器や作成リストなど、ゲーム進行と無関係なデータは戻しません。

[キャンセル] [セーブ地点へ戻す]
```

- 実行中Planとstale Planの両方で使える。stale Planはセーブ地点の状態（実行中）へ戻る
- 復元前に、復元後の計画に必要な所持武器、計画に含まれる目標武器、作成リスト項目が現在も存在するかを
  検証する（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.9）。欠損があれば何も変更せず、次を表示する。
  削除されたデータを自動で復活させない

```text
このセーブ地点の復元に必要な所持武器または目標武器が現在のデータに存在しないため、
安全に復元できません。
現在状態からRNG・所持武器を確認し、再計画してください。
```

- 16.2の「最後のゲーム内セーブ地点へ戻す」で復元が拒否された場合は、続けようとした破棄・採用・変更の
  保存も行わず、選択前の状態へ戻す

## 12.9 Step確定Transaction

結果一致、観測値入力、操作0の完成確認、想定外結果記録、操作内容不明の記録、操作内容不明後の現在位置への追従（12.5）、妥協品として終了では、
次の関連更新を1つのDexie read-write transactionで原子的に行う。

- RngState更新
- NormalArtianCounter更新
- 所持武器の追加・更新（status、保護、作成中を含む）
- 目標武器の更新（優先起点の紐付けと別目標の解除、完了）
- ExecutionHistory追加
- PlanStep完了または取消
- ProductionPlan更新
- Plan完了 / 終了時のゲーム内セーブ地点削除

操作開始前に同じtransaction内で実状態を読み、`expectedStateBefore` のvalidationとExecutionUndoSnapshot
生成を行う。結果一致と操作0の完成確認では `expectedStateAfter` 不一致をvalidation失敗としてtransaction
全体をrollbackする。想定外結果と操作内容不明は不一致を意図して記録する経路であるため、実状態とstale
理由を同じtransactionで保存する。各経路で必要な読み書きまたはvalidationが失敗した場合は部分更新を
残さず、Step確定前の状態を維持する。UIは次Stepへ遷移せず、再試行可能な保存エラーを表示する。

---

## 13. Plan Overview During Navigation

目的。

実行ナビ中に全体の現在地を確認する。

表示。

- 完了済みStep
- 現在Step
- 今後のStep
- 完成予定の目標武器（`executionEffects.targetCompletions` をauthorityとする）
- 妥協checkpointを持つStep
- 最後のゲーム内セーブ地点の位置

操作。

- 現在の作業に戻る

制約。

- 初期版ではOverviewからPlan編集をしない
- 武器切替案内（12.6）はStepとして一覧に数えない

---

## 14. Settings / Import Export

表示。

- テーマ（ライト / ダーク、3.5）。この端末・browserの表示設定として保存され、データの
  Export / Importや全データ削除の対象にならないことを簡潔に示す
- Debug Mode ON/OFF
- Master Data gameVersion
- Master Data dataVersion
- RNG Engine version
- RNG状態の特定の利用可否（5の表示ルールに従う。Identification Wizardのavailabilityに基づき、
  RngEngine capability flagへ接続しない）
- App schemaVersion
- Export
- Import
- 全データクリア

Import制約。

- 初期版は全置換Importのみ
- Import前に現在データExportを促す
- 実行中の生産計画、ゲーム内セーブ地点、作成中状態、目標武器の完了状態もExport / Importの対象である
  （[DATA_MODEL.md](./DATA_MODEL.md) 15.1）。PCからスマートフォンへの移行などの端末間同期機能は追加せず、
  このExport / Importで行う
- 未対応の `schemaVersion` は拒否する。対応する旧 `schemaVersion`（6..10）は
  [DATA_MODEL.md](./DATA_MODEL.md) 15.3の純粋migrationを順に通してcurrent schema（11）へ変換してから
  検証する。current schemaのrootはそのまま読む。migrationの内容と拒否条件は15.3をauthorityとし、
  UI側で再実装しない
- Master ID不一致は拒否または明示警告する

全データクリア。

- 確認ダイアログを必須にする
- クリア後は初期状態へ戻る

実装状況（Settings UI接続済み、[DATA_MODEL.md](./DATA_MODEL.md) 15.3）。

- Settings画面の「データ管理」sectionにバックアップ（データをエクスポート）、復元（データをインポート）、
  初期化（全データを削除）を置く。既存の表示設定（テーマ、Debug Mode）とバージョン情報は維持する
- 「表示設定」のテーマは「ライト」「ダーク」をラベル付きの選択肢として並べ、選択状態を文字とcontrolの
  状態でも判別できるようにする（各選択肢のタッチ領域は44px程度、375px幅でも横にはみ出さない）。
  テーマはData Transfer operationではなく、Export / Import / Clearの実行状態に関係なく変更できる
- 「データをエクスポート」は `ImportExportService.serializeExport()` を1回だけ呼ぶ。失敗
  （`export_state_invalid` / `transaction_failed` / 予期しない失敗）はDialogを開かず、Settings画面に日本語で
  表示し、validation issueは有界のscroll領域に列挙する。成功時はdownloadせずに「バックアップデータ」Dialogを開く。
  Exportはデータを変更しない
- 「バックアップデータ」Dialogは、説明（このJSONにアプリのユーザーデータが含まれること、コピーまたはJSON
  ファイルとして保存できること）、Serviceが返したJSON文字列をそのまま表示するread-onlyのmultiline欄
  （monospace、固定高さで内部scroll、長いtokenは折り返し、truncateも再整形もしない、全文選択できる）、
  actions「閉じる」「ファイル出力」「コピー」を持つ。表示・コピー・ファイル出力するJSONはDialogを開いたときの
  同一snapshotであり、コピーやファイル出力は `serializeExport()` を再度呼ばない
  - 「コピー」は表示中の文字列と同一の文字列を非同期Clipboard API（`navigator.clipboard.writeText()`）で
    書き込む。Clipboard APIへのアクセスはPresentationのbrowser adapterに隔離し、Domain / Serviceへ入れない。
    書込み中はボタンを無効化して二重実行を防ぐ。成功は「クリップボードにコピーしました。」、失敗（API不在、
    権限拒否等）は「クリップボードにコピーできませんでした。JSON欄から手動でコピーしてください。」をDialog内に
    表示し、Dialogを閉じない。browserのerror文言やstack traceは表示しない。`document.execCommand('copy')`
    のfallbackは設けない
  - 「ファイル出力」は同じ文字列をUTF-8のJSON Blobとしてdownloadし（object URLは使用後にrelease）、
    「バックアップファイルを出力しました。」をDialog内に表示する。ファイル名は
    `gogma-artian-planner-backup_yyyyMMddHHmmss.json`（browserのlocal time、年4桁、月日時分秒は2桁
    zero padding、`:` や `/` を含まない）とし、時刻はDialogを開いたExport生成時点のものを使う。同じDialog
    から何度出力しても同じファイル名でよい。このtimestampはファイル名だけのPresentation規則であり、
    ExportRootの `exportedAt` とは無関係である
  - JSON生成の成功だけでは「出力した」「コピーした」とは表示しない。Dialog内のfeedbackは次のExportで
    開いたDialogへ持ち越さない
- 「データをインポート」は「バックアップデータを読み込む」Dialogを開く。Dialogは説明、JSONを貼り付ける
  編集可能なmultiline欄（monospace、固定高さで内部scroll、スマートフォンでは入力時の自動zoomを避けるため
  16px、入力内容を自動整形・書換えしない）、actions「閉じる」「ファイルから読み込む」「貼り付けた内容を読み込む」
  を持つ。アプリがクリップボードを読み取る機能（`navigator.clipboard.readText()`）は設けず、ユーザーが
  OS / browserの貼り付け操作で入力する
  - 「貼り付けた内容を読み込む」は入力欄の文字列を一切加工せず `prepareImportJson()` へ渡す。空または
    空白だけの間はボタンを無効にし、Serviceを呼ばない
  - 「ファイルから読み込む」はfile input（`.json` / `application/json` を補助的に受け付ける）を開き、選択した
    ファイルの本文を同じ準備処理で `prepareImportJson()` へ渡す。ファイル選択後に追加の操作は求めず、
    検証から全置換確認まで進む。同じファイルを選び直して再試行できる
  - 貼り付けとファイルは同一の準備処理へ収束し、`prepareImportJson()` のtyped resultだけをImport可否の
    authorityとする。UI側でJSON parse、migration、schema / reference / full replacement validationを
    再実装しない
  - `invalid_json` / `invalid_import`（および準備処理の予期しない失敗、ファイルの読取り失敗）はDialog内に
    日本語で表示し（validation issueは有界のscroll領域）、Dialogを閉じず、入力欄の内容を保持し、全置換の
    確認Dialogを開かず、`applyImport()` を呼ばず、現在データを変更しない。ファイルの読取り失敗は
    「選択したファイルを読み取れませんでした。」とし、貼り付け済みの入力を消さない。ユーザーはその場で
    修正して再度読み込める
  - 成功したrootは、入力Dialogを閉じてから既存の全置換の確認Dialog（現在データが置き換わること、必要なら
    実行前にExportすること、バックアップ作成日時と件数）へ渡し、「現在のデータを置き換えてインポート」を
    押したときにだけ `applyImport()` を呼ぶ。二つのDialogを重ねて表示しない。Import自体はbackup Exportを
    自動実行しない
  - 「閉じる」（およびEscape）はImport処理を開始せず、保存データを変更せず、入力内容を破棄する。背景の
    タップでは閉じず、貼り付けた入力を失わない。準備処理の実行中は閉じられない
- 全データクリアは確認Dialog（元に戻せないこと、必要なら先にExportすること）を経てから
  `clearAllData()` を呼ぶ。追加の文字入力確認は設けない
- Import / Clear成功後は、Importでは `root.settings`、ClearではServiceが返したdefault AppSettingsを
  そのままSettings Storeへhydrateし、Debug Modeの表示とnavigationを即時に同期する。失敗時はStoreを変更せず、
  保存済みデータが変更されていないことを日本語で表示する
- Export（`serializeExport()` の実行中）/ Import準備（貼り付け・ファイルどちらの `prepareImportJson()` も
  `import_prepare`）/ Import適用 / Clearは同時に1つだけ実行でき、確認Dialogの二重submitも防ぐ。
  Debug Mode保存中はData Transferを開始せず、Data Transfer中はDebug Mode toggleを変更できない。
  Export Dialogを開いた後のコピー・ファイル出力は保存データを読まないPresentation操作であり、Data Transfer
  operationとして扱わない
- 成功表示と失敗表示は同時に残らない。Dialogが開いている間のfeedbackはそのDialog内に表示し、背後の
  Settings画面だけに出さない。Dialogは `aria-labelledby` / `aria-describedby` を持つ。Export / Import Dialogは
  小画面で左右の余白を詰めて幅を確保し、JSON欄とactionsがDialogやページを横にはみ出さない。actionsは小画面で
  全幅の縦並び（各44px以上）、`sm` 以上で横並びとする。PC / スマートフォン双方で主要操作を完結できる

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
- RngEngine capability flag。Prediction operationのsupportだけを表示し、
  Identification Wizard（Production Identification）のavailabilityは
  application levelの値として別行に表示する
- Master Data version
- 各StepのNormal / Skill / Gogma Counter before-after。conversionはSkillだけが+1でGogmaは同値として表示する

制約。

- Debug Mode OFFでは通常導線に内部値を表示しない
- Debug Modeは観測機能であり、ON / OFFでRNG計算、Candidate Search、Planner、Prediction support、
  Persistence semantics、Validation、Execution semantics、Counter advance、
  Production Engine selectionのいずれも変更しない
- Debug DetailsはRead-onlyとする。保存済みの状態、Planのpersisted metadata、
  Engine / Master metadataを読むだけで、保存や編集の操作を持たない。
  Normal Counter Setupに既存のDebug編集（6）を置く契約は変更しない
- ExportにはDebug Modeに関係なく必要な内部状態を含める

実装authority（表示接続）。

- 現在のRNG状態 / 通常アーティアCounter / 実行中の生産計画 / Master・calculation versionは
  `src/pages/DebugPage.tsx`。永続層へは `DebugPageDependencies`
  （`getRngState()` / `getNormalCounters()` / `getRunningProductionPlan()`）だけで触れ、
  loading / loaded / errorを区別する。read failureを「値なし」「Counterなし」「Planなし」と
  読み替えず、Repository invariant error（running Plan 2件など）もerrorとして表示する
- 実行中の生産計画はrunning（`active` / `stale`）のみを対象とし、Draftを代替表示しない。
  Draftと終了済みPlanは `/plans` と `/plans/:planId` で確認する
- 通常アーティアCounterはMaster `sortOrder` → rarity → idの安定順で表示し、
  Repositoryの返却順に依存しない
- PlanStep内部情報 / RNG予測情報 / Planner判定理由 / Counter before-afterは共有component
  `src/components/debug/PlanStepDebugDetails.tsx` と純関数
  `src/components/debug/planStepDebugPresentation.ts` が唯一のDebug表示authorityで、
  Debug Details、生産計画詳細（11）、実行ナビ（12）が同じものを使う。
  `PlanStep.debug` / `rngAdvance` / `expectedResult` / `expectedStateBefore` /
  `expectedStateAfter` を保存値のまま表示し、UI側でdeltaやhashを再計算せず、
  RNG PredictionもPlannerも再実行しない。`PlanStep.debug === null` は
  「PlanStepDebugInfo: 記録なし」と表示し、Candidateや現在Counterから再構成しない。
  `0` と未記録を混同しない
- 実行ナビはゲーム操作より下に折りたたみで現在Stepだけを表示する。`stale` Planでは
  保存値を表示したうえで現在状態と一致しない可能性を明示する
- Planner内部確認のauthorityは `PlanStep.debug.plannerReason`、persist済み
  `RejectedBuildListEntry`、persist済み `PlanConflict` に限る。
  Planner探索traceの再構築viewerは持たない（[REQUIREMENTS.md](./REQUIREMENTS.md) 34）

---

## 16. 再計算導線

意味論のauthorityは[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.2 / 16.6 / 16.8 / 16.10である。

### 16.1 Planがstaleになる条件

- 現在StepのexpectedStateBefore / Afterと一致しないRNG状態変更
- 現在StepのexpectedStateBefore / Afterと一致しないNormalArtianCounter変更
- 現在StepのexpectedStateBefore / Afterと一致しないOwnedWeapon変更
- Plan依存TargetWeaponの性能定義、優先度、検索対象ON/OFF、完了状態、優先起点が期待と異なる
- Plan依存BuildListEntryの変更
- 想定外結果（12.4）
- 操作内容不明（12.5）
- CalculationContext非互換（`calculation_context_changed`）

次はPlanをstaleにしない。

- PlanどおりのStep完了によるCounter、所持武器、目標武器の紐付け・完了の変化
- 新しい目標武器の追加、Planに含まれない目標武器の変更
- Candidate Search、作成リストへの新規追加、Planに含まれない作成リスト項目の変更
- 所持武器のstatusだけの変更
- ゲーム内でセーブして中断すること、ブラウザを閉じること

Plan開始時Snapshotとの単純比較は行わない。Active Planの正常進行によってBuildListEntryの
searchStateHashまたはreferencedOwnedWeaponsHashと現在値が一致しなくなっても、その派生staleだけを
理由に進行中Planを停止しない。Execution NavigatorではPlanStep期待状態を優先する。

stale表示。

- stale理由
- 期待状態と実状態の差分（数値はDebug Mode ONだけ）
- 影響を受けるPlan
- 最後のゲーム内セーブ地点へ戻す（記録がある場合、12.8）
- 現在地点から再計画を試算（16.4）
- 現在Planを破棄する（16.2）
- 想定外結果ではRNG再同定への導線
- 操作内容不明では通常のRNG同定へ直接誘導せず、12.5の回復（同じ操作の回数不明なら現在位置の確認、
  別操作・別武器や特定できない場合はセーブ地点の復元、セーブ地点が無ければPlan破棄）

### 16.2 Plan破棄とゲーム内セーブ地点の選択

Plan破棄、再計画の採用（16.4）、Planを壊す変更の承認（16.3）では、ゲーム内セーブ地点が記録されており、
その後に確定したStepがある場合だけ次を選ばせる。

```text
この生産計画は、最後のゲーム内セーブ地点（Step 12完了時点）より先まで進んでいます。
ゲーム側の状態に合わせて選んでください。

[現在地点を維持] [最後のゲーム内セーブ地点へ戻す] [キャンセル]
```

- 現在地点を維持: 現在のアプリ状態のまま操作を続ける
- 最後のゲーム内セーブ地点へ戻す: 12.8の復元を行ってから操作を続ける。再計画の採用だけは、復元後に
  採用を中止して再試算を求める
- キャンセル: 何も変更しない
- セーブ地点が無い、またはセーブ地点と現在位置が同じ場合はこの選択を出さない
- アプリ側でゲームの保存状態を推測しない
- 妥協品として確定して終了（12.3）ではこの選択を出さない

Plan破棄自体にも確認ダイアログを必須とし、「残りの作成手順は実行されません。作成途中の武器と目標武器の
紐付けは残ります。」を伝える。

### 16.3 Planを壊す変更の事前警告

実行中（active）のPlanがある状態で、次の変更を保存しようとした時点で警告する。

- RNG Setupの直接入力保存、Identification Wizardの採用
- Normal Counter Setupの確定、確定解除、Debug Modeの手動修正
- Planが作成・加工中の所持武器、またはPlanの起点武器のsemantic項目（保護、復元ボーナス、スキル、
  武器種、属性など）の変更、削除
- Planに含まれる目標武器の性能定義、優先度、検索対象ON/OFF、優先起点の変更、未完了に戻す操作
- Planに含まれる作成リスト項目の削除、途中採用状態・改善優先の変更

例。

```text
実行中の生産計画があります。
RNG状態を変更すると現在の生産計画は続行できなくなります。
変更を保存すると、この生産計画は破棄されます。

[キャンセル] [生産計画を破棄して保存]
```

- キャンセル: 何も保存しない
- 承認: 16.2の選択を経て、Planの破棄（前提を壊す変更の承認）と変更の保存を同一transactionで行う
- 警告はstaleとは区別する。承認による終了は「ユーザーが破棄した」として表示する
- 所持武器のstatus、名称、memoだけの変更、Planに含まれない目標武器・作成リスト項目の変更、
  新規追加では警告しない
- stale Planはすでに続行できないため警告しない

実装上の確定事項（事前警告UI PR）。

- 警告は共通Dialog（`PlanBreakingChangeDialog`）で、題名「実行中の生産計画があります」、本文
  「この変更を保存すると、現在の生産計画は続行できなくなります。」「変更を保存すると、この生産計画は破棄されます。」、
  操作固有の短い説明（任意）、「この変更で変わるもの」としてRuntimeの `inspection.reasons` を全件（RNG状態が変わります /
  通常アーティアカウンターが変わります / 生産計画が使用する所持武器の状態が変わります / 生産計画が使用する目標武器の
  条件または状態が変わります / 生産計画が使用する作成リスト項目が変わります）、および「破棄した生産計画は元に戻せません」
  を表示し、actionは「キャンセル」と破壊的操作として強調した「生産計画を破棄して保存」である
- `savePointChoiceRequired` のときだけ承認後に16.2の三択を表示する。セーブ地点の位置は画面がPlanを持つ場合
  （Build List）は「Step N完了時点」等、持たない場合は記録日時で示す。「最後のゲーム内セーブ地点へ戻す」は
  12.8の共通ダイアログでゲーム側復元のcheckboxを必須とし、そのキャンセルは変更全体のキャンセルである
- Identification Wizard内の警告は、Wizardの「調査前のゲーム状態へ戻した」確認とは別であり、キャンセルしても
  STEP 1 / STEP 2の結果、Review、その確認を保持する。Normal Counter Setupの観測・検索ダイアログも同様に
  観測、検索結果、復元確認を保持する
- 拒否（確認後にPlanが進んだ、承認が不要になった、実行中Planが複数、セーブ地点の状態変化、復元の拒否、
  保存失敗）は「…変更を保存していません。もう一度保存してください。」等の日本語で示し、自動再実行しない
- 承認付き保存の成功は各画面の通常の成功表示に「実行中の生産計画を破棄しました。」を組み合わせて示す
  （例: 「RNG状態を保存し、実行中の生産計画を破棄しました。」）

### 16.4 現在地点から再計画を試算

実行中Planがある状態でも、Build List（10）とProduction Plan（11）から「現在地点から再計画を試算」を
実行できる。

Preview。

- 入力は現在の確定済みRNG状態・通常アーティアCounter・所持武器、最新の目標武器、最新の作成リストである
- 通常のPlanner実行と同じ進捗表示、キャンセル、探索未完了表示（10.1）を使う
- Preview中は現在のPlanを実行中のまま変更せず、Execution Navigatorの現在Step、RNG状態、所持武器、
  作成リストを変更しない。Preview結果を保存しない
- Preview結果は通常のPlan内容確認（11.0）と同じ形式で、「再計画の試算（未採用）」と明示して表示する
- 現在のPlanとの差（含まれる目標武器、全Step数、完成予定の目標武器数）を比較表示してよい

採用。

- 「この再計画を採用」を別操作として置き、確認ダイアログで「現在の生産計画を終了し、この計画を実行中に
  します。現在の計画の実行履歴は残ります。」を伝える
- 16.2の選択を経て、採用時に状態を再検証する。Preview後にRNG状態、Counter、所持武器、計画に含まれる
  目標武器・作成リスト項目、現在Planの進行が変わっていた場合は採用を拒否し、
  「試算後に状態が変わりました。もう一度試算してください。」と表示する
- 正常採用時は旧Planの破棄（再計画採用）と新Planの実行中化を同一transactionで行い、新Planの
  Execution Navigatorへ遷移する。旧Planのゲーム内セーブ地点は引き継がない

制約。

- 自動で新Planへ置き換えない
- ユーザーが試算と採用を明示した場合だけ新Planを実行中にする
- 実行中Planが無い場合は従来どおりBuild ListからPlanner実行し、Draft Planを作成する

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
/plans
/plans/:planId
/plans/:planId/run
/guide
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
- Debug Mode OFFでSeed / Counterが表示されない（Normal Counter Setup一覧の確定済みCounter値だけは例外、6）
- Normal Counter Setup一覧が未確定・未設定・候補複数・確定解除後の行でカウンター値を「—」と表示し、保持値を表示しない
- Debug Mode ONで内部情報が表示される
- Normal Counterの手動修正がDebug Mode OFFで表示されない
- Normal Counter画面が14武器種のレア8だけを表示し、Debug Modeでもレア6・7を扱わない
- Normal Artian観測入力にレア度選択を表示せず、内部値を8に固定する
- RNG項目を一部だけ入力して保存できる
- Capability不足の機能だけが無効表示になる
- Candidateカードに必要素材・費用の目安が表示され、Routeにない区分を表示しない、
  ナナイロカネと歴戦錬磨の証をalternativeとして表示する、スキル再付与の同タイプ補足を表示する、
  ゼニーを3桁区切りで表示する、操作0では「追加の素材・ゼニーは不要」と表示する、
  旧「素材コスト未検証」表示がCandidate Searchに残らない
- 生産計画詳細に計画全体の必要素材・費用の目安が表示され、共有Stepを二重計上せず、
  legacy Planでは算出できない旨を表示する

## 19.2 Flow Test

- RNG設定から候補検索まで進める
- Identification WizardのSTEP 1（Base Seed + 開始Skill Counter）とSTEP 2（開始Gogma Counter）の入力・結果が混在しない
- Identification中に進捗表示とキャンセルが使える
- 通常Counter未確定時に通常Route skipが表示される
- 通常アーティアのnormal scope WeaponBonusDefinition不足時に `master_data_unavailable` の通常Route skipが表示される
- 既存武器の復元ボーナスを維持したスキルのみ再付与Routeを表示できる
- protected武器ではスキルのみ再付与Routeを表示せず、現在性能がTargetを満たす場合だけ操作なし候補を表示する
- Skill Capability不足時にスキルのみ再付与Routeのskip理由が表示される
- `candidateOffset = k` の通常アーティア経由で `forgeCount = k + 1` 本forgeし、最後の1本だけを巨戟化する操作列が表示される
- conversion結果に継承normal bonus 5枠と初回Series / Groupが表示される
- 5枠既知のnormal scopeの巨戟にfirst Reset前のKeepを表示でき、blind Normal経由ではfirst Reset後にKeepを表示する
- blind Normal経由でfirst Reset前にKeepが無い理由を「ゲーム上Reset必須」とは表示しない
- transient GogmaのReset / Keep / Reset Skillsにfake OwnedWeapon IDを表示しない
- Search Resultsから候補を作成リストへ追加できる
- 理想品が見つからない場合に「現在の探索範囲では理想品が見つかりませんでした」と表示し、
  「理想品は存在しません」とは表示しない
- 理想品Routeの途中で妥協条件を満たす状態をスキル候補と復元ボーナス候補として
  lane別に一覧表示し、スキル×復元ボーナスの組み合わせを提示しない
- 各laneの終点を理想（最終目標）として表示し、チェックボックスを付けない
- 途中採用する状態の既定選択が空、改善優先の既定が「生産計画に任せる」である
- 同じ性能グループの複数到達点を「その他の到達点」として開示し、選択は1 laneにつき1つまでに制限する
- 上位互換に隠された復元ボーナス候補を「その他の候補」として開示し、一覧から消さない
- conversionが付与した初回スキルを「巨戟化直後のスキル（スキルリセット0回）」として選択できる
- 追加済みの候補を再追加しても既存の選択・改善優先を上書きせず、
  作成リストで変更するよう案内する
- 作成リストで途中採用する状態を選択・解除・別の到達点へ変更でき、改善優先を再検索なしに変更できる
- 選択・改善優先の変更でEntryがstale表示にならず、既存Planが再計算対象になる
- 作成プランで、両laneの選択状態が揃う物理Stepにmilestoneが表示され、
  その後も後続Stepが残る
- Build ListからPlannerを実行できる
- Production PlanからExecution Navigatorへ進める
- 結果一致で次Stepへ進み、そのStepのCounter進行が即時に保存される
- ブラウザを閉じて再訪すると、active Planの現在Stepから再開できる
- PlanどおりのStepで期待状態Afterに一致した場合はstaleにならない
- Plan開始時からCounterが進んでも現在Step期待状態と一致すれば実行を継続できる
- Execution Navigatorに独立した「確保」ボタンとStepが表示されず、最後の物理操作の確定で理想品が完成し、
  武器が理想・保護あり、目標武器が完了済みになる
- 新規通常アーティア経由でCounter進行用の作成Stepと作成対象Stepが区別表示され、作成対象だけが所持武器に
  登録される
- blind作成対象Stepで実際の5枠を入力するまで確定できず、架空の5枠が初期値に入らない
- 既存巨戟を起点にするDraft Planで、作成開始前に優先起点の変更予定が表示され、表示だけでは保存状態が変わらず、
  「作成開始」の成功でPlanのactive化と同時に優先起点が設定され別目標武器の紐付けが解除され、最初のStepを
  そのまま確定できる。変更がない場合は表示されず、開始失敗時は何も変わらない
- 選択済み妥協checkpoint到達後に武器が実用になり、「次の操作へ進む」「妥協品として確定して終了」を選べ、
  終了は確認ダイアログ後にPlanを終了し目標武器を未完了のまま残す
- 武器A -> 武器B -> 武器Aの操作で切替案内が2回表示され、案内がExecutionHistoryやUndo対象にならない
- 操作0 Idealの目標武器で通知と「この武器で目標を完了にする」が表示され、Planへ含まれた場合は
  Counterを進めない完成確認Stepになる
- 結果が違う場合にCounter消費と実結果が保存され、Planがstaleになり、RNG再同定の導線が出る
- 操作内容不明を記録するとCounterと武器を変更せずPlanがstaleになる
- 操作内容不明の後、同じ操作の回数だけ不明なら現在のゲーム結果で同じ操作の連続区間内の現在位置を確認し、
  一意ならPlanどおり追従して同じPlanを再開する。複数なら全候補で安全な場合だけ次の同じ操作の結果を追加入力し、
  特定できない・別操作・別武器ならセーブ地点の復元（ゲーム側復元の確認後）かPlan破棄になる
- 実行中Plan中に目標武器・作成リスト項目を新規追加してもPlanがstaleにならない
- 実行中Plan中にRNG状態、Planに含まれる目標武器、作成中の武器を変更しようとすると保存前に警告し、
  キャンセルでは何も変わらず、承認でPlanが破棄（前提を壊す変更の承認）になってから保存される
- 現在地点から再計画を試算しても現在Planが実行中のまま変わらず、採用時に状態が変わっていれば拒否され、
  変わっていなければ旧Plan破棄と新Plan実行中が同時に切り替わる
- ゲーム内セーブ済みとして記録した後に進めたPlanを破棄すると「現在地点を維持 / 最後のゲーム内セーブ地点へ
  戻す / キャンセル」が表示され、セーブ地点が無い場合や現在位置と同じ場合は表示されない
- セーブ地点へ戻すと実行状態だけが戻り、その後に追加した目標武器や作成リスト項目は残る
- 「実行中の生産計画の完了後（予測）」起点の検索結果に予測である旨が表示され、作成リストへ追加できない
- 完了済みの目標武器が通常一覧・候補検索Selectに出ず、「完了済みの目標武器」から未完了に戻せる
- Undoで最後の操作を戻せる
- Undoで最後のStepが変更したRNG、通常Counter、OwnedWeapon、TargetWeapon、ProductionPlan、ゲーム内セーブ地点を完全に戻せる
- 再計画採用や破棄で終了したPlanにはUndoが表示されない
- Step確定、再計画採用、セーブ地点復元、Undoの途中で保存失敗しても部分更新が残らない
- Debug Mode OFFではStep確定後もCounter数値が表示されず、Debug Mode ONではbefore / afterを確認できる
- 所持武器のstatus選択肢が「未分類 / 実用 / 理想」であり、「素材」が表示されない
- 新規巨戟アーティアの初期値が「未分類 / 保護OFF」である
- 登録済み武器のstatus変更でProtectionが変わらない
- status変更だけではActive Planもビルドリストもstaleにならない
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
- comparisonがDomainのTarget順を維持し、Targetごとに理想品候補の結果を1つ表示する
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
- `expectedResult === null` でも表示が壊れず、`executionEffects.targetCompletions` だけを完成予定として示す
- TargetWeapon名をcurrent persisted Targetから解決し、欠損時はTargetWeapon IDへfallbackする
- Planner保存成功時に、Persistenceが返したPlanの `/plans/:planId` だけへ遷移する

## 19.3 Import / Export Test

- ExportボタンでJSONを出力できる
- ExportしたJSONをImportできる
- 未対応のschemaVersionを拒否し、対応する旧schemaVersionはmigrationを通してImportできる
- Master ID不一致を検出する

## 19.4 Responsive Test

- スマートフォン幅で主要画面が横スクロールなしで使える
- Search ResultsのTarget切替が操作できる
- Execution Navigatorの主要ボタンが片手操作しやすい位置にある
- 復元ボーナス5枠が小画面でも判読できる
- 端末幅に応じて一覧の表示形式を適応しても、必要な情報と主要操作が失われない
- スマートフォン幅で登録、編集、検索、作成リスト操作を完結できる
- 長いフォームやDialogの主要操作へスマートフォン幅で無理なく到達でき、固定UIがコンテンツや
  フォーカスを隠さない
- 必要素材・費用の目安がCandidateカードと生産計画詳細の両方で375px幅でも横overflowせず、
  長い素材名がwrapし数値が素材名から離れない


### 妥協条件version 6の判定理由と監査記録

妥協判定はlaneごとの `match`（Bonus: ideal/practical/alternative、Skill: ideal/practical）として
Candidate本体ではなくintermediate state group / opportunityが保持し、Build List snapshotへそのまま複写する。
両軸の `conditionMatch` はPlannerが到達したcheckpoint milestoneが保持する。
これらはTarget定義と到達状態から導出した説明情報であり、Candidate ID / stable key / deduplication key / meaning fingerprint / searchStateHashには追加しない。
旧artifactではフィールドを省略でき、推測補完・再分類しない。
UIは保存された判定理由を「ボーナス判定: 実用 / 代替」「スキル判定: 理想 / 実用」と表示する。
両軸Idealは理想品そのものなのでcheckpoint milestoneとしては存在しない。

Productionベンチマークの旧wildcard条件も明示的な理想構成基準へ変更するため、旧versionの測定記録と負荷が異なる。
過去のBrowser Worker測定値は当時のartifactとして保持する。今回のVitestは意味・不変条件の検証であり、新しいBrowser性能測定の代用ではない。
