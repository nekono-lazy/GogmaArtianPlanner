# モンハンワイルズ 巨戟アーティア厳選Planner
## REQUIREMENTS.md

## 1. 文書の目的

本書は、Monster Hunter Wildsの通常アーティア武器および巨戟アーティア武器について、RNG状態をもとに将来の復元ボーナスとスキルを検索し、複数の目標武器を効率よく作成するWebアプリケーションの初期版要件を定義する。

本書を初期版の上位要件とし、具体的な型、保存形式、アルゴリズム、画面遷移は以下の文書で定義する。

- [DATA_MODEL.md](./DATA_MODEL.md): 型、ID、enum、関係、永続化、不変条件
- [MASTER_DATA.md](./MASTER_DATA.md): 武器種、属性、ボーナス、スキル、抽選、アイテム素材のマスター
- [RNG_SPEC.md](./RNG_SPEC.md): RNG状態、予測、進行、RNG同定
- [SEARCH_SPEC.md](./SEARCH_SPEC.md): 条件評価、候補検索、経路比較、途中採用する状態
- [PLANNER_SPEC.md](./PLANNER_SPEC.md): 候補選択、競合、在庫、作成計画、再計算
- [UI_FLOW.md](./UI_FLOW.md): 画面、操作導線、表示ルール、実行ナビ

本書と詳細仕様に矛盾がある場合、勝手に解釈して実装せず、要件差分として報告すること。

---

## 2. プロダクトの目的

本アプリは単なるSeed Finderではなく、次の作業を一続きで支援する。

- 通常アーティア経由と既存巨戟アーティア経由を比較する
- 複数の目標武器を横断して効率的な作成ルートを計画する
- 所持している通常アーティアと巨戟アーティアを再利用する
- 作成途中の妥協状態を採用しながら理想品まで到達する計画を立てる
- 計画に沿ったゲーム操作を1ステップずつ案内し、確定したゲーム状態をStepごとに記録する
- 実際の結果が想定と異なった場合に状態を修正して計画を再生成する

単一武器のRNG予測・作成Routeは、Gogma-Artian-Roll-Plannerの固定 `GARP.lua v0.9.4` で確認済みのProduction RNG primitives / semantic mappingsを参照する。GogmaArtianPlannerは同じProduction RNGを用いるSeed / Counter Identificationを製品内で実装し、さらに複数Target、所持Inventory、共有RNG Planner、1 Step Executionへ拡張する。外部live-game fixtureの出典はfixture単位の観測evidenceであり、出典toolをalgorithmまたはIdentification implementationのauthorityにしない。

RNG仕様の確認状態は次の3語で区別する。

- `reference-verified` / 参照実装で確認済み: 固定commitの参照repositoryに実装されている動作・定数・順序を確認した状態。全weapon、attribute、game versionで実ゲームと一致することまでは意味しない
- `game-verified` / 実機確認済み: ユーザーの実機確認または同等の実ゲームfixtureで確認した状態
- `unverified` / 未確認: 参照実装または実機から十分な根拠を得ていない状態

文脈なしの「verified / 検証済み」をProduction RNGの正当性レベルとして使用しない。Masterの安定IDに含まれる `.verified_*` は既存ID文字列であり、RNGアルゴリズムの実機確認状態を表さない。

---

## 3. 対象環境

### 3.1 アプリケーション

静的配信可能なWebアプリケーションとして実装する。

- React
- TypeScript
- Vite
- IndexedDB
- Dexie.js
- Web Worker
- GitHub Pages

サーバー側処理、データベースサーバー、ユーザーアカウントを必須としない。計算とユーザーデータ保存は可能な限りブラウザ内で完結させる。

### 3.2 対応ユーザー

- PS5版 Monster Hunter Wildsのユーザー
- PC版 Monster Hunter Wildsのユーザー

PCブラウザとスマートフォンブラウザの双方を主要利用環境とし、全主要機能を双方で実用レベルで利用可能にする。利用端末によって機能、情報、入力項目、Domain semanticsを減らしたり変更したりしない。端末差はPresentation層の情報密度、配置、表示形式、操作位置に限定する。Execution Navigatorは、PC / PS5でゲームを操作しながらスマートフォンで利用する形態を特に重視する。画面ごとの適応方針は[UI_FLOW.md](./UI_FLOW.md) 3.1で定義する。

Production v1のSkill / Gogma PredictionとIdentification Wizardは、通常アーティアおよび巨戟アーティアを利用可能なゲーム進行状態のユーザーを対象とする。この製品前提により、Production runtimeはCounterのactive branchを使用する。これはユーザーのactual Counter Gate値を特定済みとみなすことを意味しない。

---

## 4. 初期版の基本方針

- 1キャラクター分のデータのみ管理する
- 複数キャラクターの切替機能は実装しない
- 別キャラクターで利用する場合は、現在データのExport、データクリア、別キャラクターの設定という運用にする
- 最終的に作成する目標武器は常に巨戟アーティアとする
- 通常画面ではSeedやCounterを原則表示しない
  - 唯一の例外として、通常アーティアカウンター画面（Normal Counter Setup）では、ユーザーが管理している確定済み通常アーティアCounter（`isConfirmed = true` かつ値あり）の現在値を、状態確認のため通常UIへ表示してよい。未確定の保持値（確定解除後の値を含む）は現在値として通常UIに表示しない（[UI_FLOW.md](./UI_FLOW.md) 6）
  - この例外はBase Seed、Skill Counter、Gogma Counter、Counter Gateその他のRNG内部値、および他画面へ拡張しない
- RNGやPlannerの専門知識がなくても主要操作を完了できるUIにする
  - アプリ内に、代表的な利用フローをスクリーンショット付きで説明する「使い方」ページを置く（[UI_FLOW.md](./UI_FLOW.md) 2.2）。これはユーザー向けの説明であり、仕様のauthorityではない
- 仕様にない機能を独断で追加しない

---

## 5. RNG状態管理

アプリは次のRNG状態を管理する。

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate
- 通常アーティアの武器種別レア8 Counter

v1の通常アーティア管理・検索対象はレア8だけとする。通常アーティアCounterは武器種ごとにレア8を1件、全14武器種で最大14件管理し、各Counterについて確定状態と観測回数を保持できること。レア6・7は管理しない。NormalArtianCounterは「次にforgeされる結果の0-based block index」である。

通常候補位置と必要forge数は次を正式契約とする。

```text
candidateOffset = 0:
  candidateCounter = normalCounterBefore
  forgeCount = 1

candidateOffset = k:
  candidateCounter = normalCounterBefore + k
  forgeCount = k + 1

normalCounterAfter = normalCounterBefore + forgeCount
candidateCounter = normalCounterBefore + forgeCount - 1
```

Base Seed、Gogma Counter、Skill Counter、Counter Gateはそれぞれ独立した `KnownValue<T>` として、値、確定状態、取得元を保持する。一部だけ判明している状態を許可し、RNG状態全体を「全確定 / 未確定」の二択にしない。

`RngState.counterGate` はv1で削除しない。legacy compatibility、過去データとの互換性、Export / Import round-trip、diagnostic / reference情報のために保持する。ただし、persisted Counter Gateのvalueまたは確定状態は、Production Skill Prediction、Production Gogma Prediction、Candidate Search、Planner、Trace ReplayのavailabilityまたはPrediction結果のauthorityにしない。

Counter Gateは通常ユーザーが直接操作する値ではない。通常ユーザー向けRNG SetupはCounter Gateを表示・編集せず、Identification Wizardの入力・探索対象・結果にもしない。persisted値はUIから見えなくても保持し、他項目の保存でnull化、確定解除、source書き換え、代表値54 / 35の書込みを行わない。

機能ごとに必要な値からCapabilityを判定する。例えばGogma予測、Skill予測、通常アーティア検索、Planner実行は、それぞれが依存する確定値だけを要求する。不足値に依存する経路のみを無効化し、利用可能な経路まで一括で無効化しない。

- Production Skill Predictionは確定Base Seed、確定Skill Counter、EngineのSkill Prediction support、concrete semantic input supportを要求する
- Production Gogma Predictionは確定Base Seed、確定Gogma Counter、EngineのGogma Prediction support、concrete semantic input / Master supportを要求する
- 新規通常アーティア生成だけが対象武器種の確定Normal Counterを要求する。Skill Prediction、Gogma-only経路、所持通常アーティアからの巨戟化はNormal Counterを要求しない

stream進行は次を正式契約とする。Statusはprovenanceの確認範囲であり、正式契約かどうかとは別である。

| Operation | Normal | Skill | Gogma | Status |
| --- | ---: | ---: | ---: | --- |
| create normal | +1 / forge | 0 | 0 | reference-verified |
| convert normal to Gogma | 0 | +1 | 0 | game-verified |
| reset skills | 0 | +1 | 0 | reference-verified |
| reset bonuses | 0 | 0 | +1 | reference-verified |
| keep bonuses | 0 | 0 | +1 | reference-verified |

所持武器そのものを素材として消費するモデルはv1 Domainに存在しない。Domain Counter +1とPRNG内部1 blockの10 stepは別概念とする。Core / reference semanticsではCounter Gateは予測時のeffective PRNG blockにだけ作用し、Skill Gate < 54ならSkill offsetを0、Gogma Gate < 35ならGogma offsetを0とする。Gate未満で保存Counter自体が操作後にどう変化するかは未確認のまま維持する。

このCore / reference contractとProduction v1 runtime policyを区別する。Production v1 adapterはoperationに応じ、Skillでは54、Gogmaでは35をactive branch選択用の内部representativeとして使用する。54 / 35はactual game Counter Gate値ではなく、`RngState.counterGate`へ保存しない。低Gate branch自体はCore / reference semanticsとその検証のために残す。

通常画面では内部値を直接操作させない。詳細表示またはデバッグモードでのみ確認可能とする。

---

## 6. RNG状態の取得

初期版では次の2方式を提供する。外部toolの出力textを取り込む専用Import機能は提供しない。

### 6.1 正確な値の直接入力

別ツールやREFrameworkなどで取得した値を入力できること。取得手段との直接連携は行わない。

通常ユーザー向けの入力対象は次の3項目とする。

- Base Seed
- Gogma Counter
- Skill Counter

判明している項目だけを入力でき、3項目すべてを必須としない。

Counter Gateは `RngState` に互換・diagnostic目的で残るが、通常ユーザー向け直接入力UIは提供しない。過去に `source = manual` のCounter Gateを持つデータが存在しても、その値はそのまま保持する。persisted Gateが200、54、または未設定のいずれでも、必要なBase Seed、該当Counter、Engine support、concrete semantic input supportが揃っていればProduction active predictionは成立し、persisted GateをProduction Prediction結果のauthorityにしない。

### 6.2 観測結果から検索

ゲーム内で確認した抽選結果を入力し、対応するSeedまたはCounter候補を検索できること。通常アーティアの現在位置特定はこの方式を主に使用する。

一度の観測で候補が一意にならない場合は、追加観測が必要であることを明示する。

Seed検索とCounter検索は別の入力・結果型として扱う。Production v1のRNG特定にはSkill-first Identification Wizardの専用kernelを使用する。Identification availabilityはWorker / application levelで判定し、RngEngine capability flagで表さない。

Identification WizardはCounter Gateを入力、探索、観測、特定、結果化しない。STEP 1は同じ武器種・属性に対する連続したSkill抽選結果（Series / Group）の観測列からcanonical Base Seedとstarting Skill Counter `S`を特定する。最初の観測は巨戟化（conversion）時の自動Skill付与、既存巨戟アーティアへのReset Skillsのどちらから開始してもよく、観測列は途中で別のSkill Counter消費操作を挟まず、実際の順番どおりに記録する。`S`は観測1を生成する直前のSkill Counterであり、観測`i`（観測1を`i = 0`）はSkill Counter `S + i`に対応する。conversionとReset SkillsはいずれもSkill Counterを1進め、同じSkill Counter位置・武器種・属性では同じSkill結果になる（direct game observation、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.18）ため、開始操作の種別はIdentification入力に含めない。STEP 2はそのBase Seedと連続ordered Reset Bonuses観測からstarting Gogma Counter `G`を特定する。STEP 1が完全な探索で一意になるまでSTEP 2へ進めず、複数候補では候補選択ではなく追加観測を要求する。

Wizardの調査中に実行したSkill / Gogma操作でCounterが進んでも、調査中のゲーム状態は保存せず、調査前状態へ戻してから結果を採用する。採用値はstarting Counter `S` / `G`であり、観測数を加えた値ではない。Base Seed、Skill Counter、Gogma Counterのsourceにはv1で既存の `observation` を使用し、Counter Gateは変更しない。

Wizard開始時と観測中は、観測結果の記録が終わるまでゲーム状態を保存しないこと、開始前にバックアップ方法と自動保存の設定・挙動を確認すること、案内された操作だけを連続して行うこと、観測後は調査前状態へ戻してから採用することを案内する。ゲーム側の保存仕様または安全性をアプリが断定・保証してはならない。

Skill Identificationはreference-generated fixtureに加えて、C5-E2C9で独立したgame-verified fixtureを取得した（[C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。Skill STEP 1の実Browser Worker benchmarkはC5-E2C8で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md)）。Production activationはC5-E2C10で完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。Seed rangeをcontiguous / non-overlapping chunkへ分割するmulti-worker orchestration、deterministic merge、global progress、cancel propagation、Worker failureの明示errorはC5-E2C6で実装済みであり、この契約を維持する。

通常アーティアCounterの直接修正は通常UIに置かず、必要な場合のみDebug Modeで提供する。

---

## 7. 通常アーティアCounter

- Base Seedが判明していても、通常アーティアCounterが不明な場合は観測結果から現在位置を検索する
- レア8 Counterが未確定の武器種について、Normal Predictionを使う新規通常アーティア経由のpredicted variant([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1)は検索しない。ただし必要条件を満たす場合は6.1.1のblind Reset variantで新規通常アーティア経由を検索でき、RouteKind全体を禁止するわけではない
- Counterが未確定でも、既存巨戟アーティア経由の候補検索は利用可能とする
- すべての武器種のレア8 Counterを事前に確定させる必要はない
- Counter候補が複数ある状態を確定済みとして扱わない
- Normal Counterが未確定でも、Skill Prediction、Gogma-only Prediction / Search / Planner、既存巨戟経路、適合する所持通常アーティアからの巨戟化を利用可能とする

---

## 8. 所持アーティア管理

所持している通常アーティアと巨戟アーティアを1本ずつ個別管理する。用途を問わず、所持している武器はすべて登録できること。

各武器は最低限、次の情報を保持する。

- 一意なID
- 種類（通常／巨戟）
- 任意名称
- 武器種
- 属性
- 復元ボーナス5枠
- シリーズスキル（巨戟のみ）
- グループスキル（巨戟のみ）
- 状態（巨戟のみ）
- 保護状態

巨戟アーティアの状態は次の3種類とする。通常アーティアは状態を持たない。

- `unclassified`: 未分類
- `practical`: 実用
- `ideal`: 理想

statusはユーザーが所持武器を整理するための管理ラベルだけを意味する。statusから
Plannerの操作可否、Search Route eligibility、Target Satisfactionを決定しない。
責務は次のとおり厳密に分離する。

| 概念 | 意味 |
| --- | --- |
| `status` | 未分類 / 実用 / 理想というユーザー管理ラベル |
| `isProtected` | Planner / Searchが武器性能を変更してよいか |
| `TargetWeapon.preferredOwnedWeaponId` | このTargetを作る際に優先する起点武器 |
| Target Satisfaction | 実際のBonus / Skillから判定 |

どのstatusの武器も復元ボーナス5枠とスキルを保持する。

通常アーティアはレア8だけを登録でき、`normal_artian` scopeの復元ボーナス5枠を保持し、シリーズ／グループスキルとstatusを持たない。巨戟アーティアは、変換直後から最初のBonus amendmentまでは継承した `normal_artian` scopeの5枠、その後は `gogma_artian` scopeの5枠を保持できる。1本の5枠内でscopeを混在させない。レア度選択UIは持たない。通常／巨戟の両方で保護を設定でき、保護中の通常アーティアを自動計画の巨戟化元にしない。

復元ボーナスの選択肢は、Masterの武器種・scope定義（WeaponBonusDefinition）と、Production上で実際に抽選され得るbonus family（武器種 × 抽選テーブル区分、[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1 / 6.3.1）の積として決める方針とする。`ElementMaster.allowsElementBonus` 単独ではゲームの抽選availabilityを表現できない。例えばスラッシュアックスの無属性構成は属性強化を持ち得、弓の毒・麻痺・睡眠は属性強化を抽選しない。ライト／ヘビィボウガンは属性にかかわらず属性強化を抽選しない。PR-Cで、所持武器・目標武器・目標武器の妥協条件・Identification WizardのUI、new entity draft、Entity Validationをこの複合availability（[MASTER_DATA.md](./MASTER_DATA.md) 15.1）へ移行済みである。旧UIで保存されたavailability外の値は、自動削除・自動置換・migrationをせず保持し、保存時だけ明示的に拒否する（non-destructive load + fail-closed save、[DATA_MODEL.md](./DATA_MODEL.md) 7.1）。

手動で新規登録する巨戟アーティアの初期値は `unclassified` かつ保護OFFである。statusと保護は
独立したユーザー設定であり、既存保存データの保護値をmigrationやstatus変更だけで書き換えない。
ユーザーのstatus変更はOwned Weapons画面の通常CRUDであり、ProductionPlanの操作ではない。
Execution Navigatorは、巨戟化したStepで `unclassified`、作成リストで選択した妥協checkpointへ実際に
到達したStepで `practical`（保護は変更しない）、理想品が完成したStepで `ideal` かつ保護ON（既存武器でも
保護する）を設定する（25章）。性能が条件を満たしただけでstatusを自動変更しない。Practical同士の
優劣はv1で判定しない。

生産計画の実行で今後も識別・加工する武器には、statusと直交した「作成中」の内部状態を持たせる。
ユーザーは直接編集できず、Candidate Searchの武器性能判断にも使わない（25章）。

---

## 9. 目標武器管理

欲しい完成武器を1構成につき1件登録する。同じ武器種・属性でも、復元ボーナスやスキル構成が異なる場合は別の目標として扱う。

各目標武器は最低限、次の情報を保持する。

- 一意なID
- 任意名称
- 武器種
- 属性
- 優先度
- 検索対象のON/OFF
- 理想復元ボーナス
- 実用ライン
- 理想スキル条件
- 実用スキル条件
- 優先する所持武器（任意）

優先度は1から5、デフォルトは3とする。未変更の場合は3として扱う。

目標武器には、その目標を作る際に候補検索（および制約付き再検索）が起点として優先したい所持武器を任意で
1本だけ設定できる。通常の設定は目標武器画面からのユーザー操作で行い、所持武器側は目標武器を
参照しない。例外として、作成計画が既存の所持武器を起点に使う目標武器は「作成開始」の時点で、計画内で
新規作成する武器はその登録を確定した時点で、その目標武器へ自動で紐付け（別の目標武器の紐付けは同時に
解除）、理想品完成時に解除する。Plannerの計算、作成計画の生成・表示とCandidate Searchは優先起点を
変更しない（25章）。

優先起点は候補検索と制約付き再検索が同等の候補から起点武器を選ぶための入力（計画入力Hashの一部）であり、
Candidateの性能定義ではない。通常Plannerは目標武器ごとに1件の作成ルートを実行順へ並べるだけなので、
優先起点を実行順の判断に使わない（19章 / 20章）。優先起点だけの変更では作成リスト項目をstaleにしない（18章）。

目標武器は `active`（未完了）/ `completed`（完了）のlifecycleを持つ。理想品が完成すると `completed` に
なり、通常の目標武器一覧、候補検索、Plannerの対象から外れるが、履歴と生産計画の参照のため削除しない。
妥協品で終了した場合は `active` のままとする。所持武器がすでに理想条件を満たす場合は、目標武器の登録時
または候補検索時に通知し、候補検索・作成リスト・生産計画を経ずに目標を完了にする導線を優先する。

- 1つの目標武器につき最大1本
- 1本の所持武器を複数の目標武器へ同時に割り当てない
- 候補は目標武器と武器種・属性が一致する非保護の所持武器とする。通常／巨戟のどちらでもよく、
  状態（未分類 / 実用 / 理想）は選択可否の条件にしない
- 必須ルート指定ではない。より短い、より低コスト、または既存評価で明確に優れたルートがある
  場合はそちらを優先する
- 目標達成判定を制限しない。ある目標が特定の所持武器を優先起点にしていても、条件を満たす別の
  所持武器がその目標を満たしてよい

複数の目標をグループ化して「いずれか1つ達成」とする機能は初期版では実装しない。不要な目標は削除するか検索対象外にする。

---

## 10. 理想復元ボーナス

理想構成は復元ボーナス5枠を完全指定する。

例:

```text
攻撃EX / 攻撃EX / 斬れ味EX / 斬れ味EX / 属性EX
```

枠順には意味を持たせず、5枠の多重集合として一致を判定する。同じボーナスが複数ある場合は個数を正しく評価する。

---

## 11. 実用・代替の妥協条件

理想5枠を唯一の基準とする。詳細は[TARGET_COMPROMISE_SEMANTICS.md](./TARGET_COMPROMISE_SEMANTICS.md)に従う。
理想・実用・代替のBonus判定はすべてgogma_artian scopeを要求する。通常由来のボーナスを
同じラベルの巨戟ボーナスとして受理せず、通常作成・巨戟化RouteはReset後の予測で評価する。

### 11.1 実用ボーナス

種類と種類別個数は理想と完全一致する。指定した種類だけ最低RankとEX最低数を設定し、
その種類の全枠が最低Rank以上、EX枠数が指定以上であることを要求する。
必要個数は理想5枠から導出し入力させない。未設定種類はRank multisetも理想と完全一致する。
Ideal自身がPractical条件を満たさないTargetは保存できない。

### 11.2 代替ボーナス

元種類ごとに最大置換数と代替先optionsを設定する。1 Candidateでは1 Rule / 1 Optionだけを使用し、
1枠以上を置換する。最大置換数は必須数ではない。0枠置換はIdeal側で判定する。
未置換枠は理想のRankを保持し、実用BonusのRank緩和とは併用しない。
EX最低数は実際に置換された代替枠だけで評価する。複合置換・任意論理式は禁止する。

---

## 12. スキル条件

目標武器ごとにシリーズスキルとグループスキルの条件を設定できること。

### 12.1 理想ライン

シリーズ、グループの各スキルを「完全指定」または「指定しない」とする。指定された項目はすべて一致する必要がある。

### 12.2 実用ライン

シリーズ、グループの各スキルを「完全指定」または「指定しない」とする。指定項目が2つある場合は、次の一致方法を選べること。

- 両方を満たす
- どちらか一方を満たす

指定しない項目を、存在しないスキルとの完全一致として扱わない。
ただし実用Skillの両項目が未設定ならスキル妥協なしとし、Ideal Skillだけを許可する。
Ideal Skillを優先し、その不一致時だけ明示された実用Skillを評価する。Bonusとは別軸であり、
Bonus実用・代替と実用Skillの組み合わせを許可する。

---

## 13. 完成判定

### 13.1 妥協状態

BonusがIdeal / Practical / Alternativeのいずれか、SkillがIdeal / Practicalのいずれかを満たし、
両方Idealではない状態を「妥協状態」とする。

妥協状態は独立した作成Candidateではない。理想品へ向かう1本の物理Routeの途中状態として
だけ意味を持ち、Search結果としては「理想品Routeの途中で採用できる状態」として、
スキル軸（スキル候補）と復元ボーナス軸（復元ボーナス候補）に分けて提示する。
スキル×復元ボーナスの組み合わせは提示しない。妥協は理想品への途中の使える状態であって
最終目標ではなく、目標武器の完了は常に理想品である。妥協状態を単独のBuildCandidateや
BuildListEntryとして扱わない。

### 13.2 理想品

次の両方を満たす候補を理想品と判定する。

- 復元ボーナスが理想構成と一致する
- スキルが理想条件と一致する

理想品は実用ラインも必ず満たすため、実用ラインを満たさない理想品は存在しない。
候補検索が返すのは理想品だけである。

候補検索は、この目標武器単体を現在のRNG状態から作る場合に近い位置へある実用品と理想品を高速に求めることを主責務とする。複数目標武器を同時に作る場合のCounter操作の両立はPlannerの責務であり、将来競合し得るという理由だけで2本目以降の理想品や遠い代替を初回検索で先読みしない。

---

## 14. 候補検索

検索対象がONかつ未完了の目標武器について、現在のRNG状態から将来の完成候補を検索する。

検索の起点は、最後に実行ナビで確定した現在のRNG状態・通常アーティアCounter・所持武器である。
実行中の生産計画があっても、その開始時点を起点にしない。実行中の生産計画がある場合だけ、追加の起点として
「実行中の生産計画が予測どおり完了した後」の予測状態から検索できる。この検索はPreview専用であり、
永続状態と生産計画を変更せず、結果を作成リストへ直接追加しない（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 3.2）。

候補検索は1回につき1つの目標武器を対象とし、現在の探索範囲で見つかるcanonical Ideal
候補を1件だけ返す。候補カテゴリ、近似（Similar）判定、結果フィルタ、出力件数上限は
存在しない。

理想品が見つかった場合、その作成Routeの途中で妥協条件を満たす状態を
スキル候補と復元ボーナス候補として軸ごとに一覧表示する。ユーザーは軸ごとに
必要な状態だけを選択でき、既定では何も選択されていない。あわせて理想品までの
改善優先（生産計画に任せる / スキルを優先 / 復元ボーナスを優先。既定は生産計画に任せる）
を選べる。

理想品が見つからなかった場合は候補0件であり、途中採用できる状態も0件である。
UIは「現在の探索範囲では理想品が見つかりませんでした」と案内する。
「この目標武器に理想品は存在しません」とは表示しない。

同じ完成結果と実質的に同じ経路を持つ候補は重複排除する。検索処理は進捗表示とキャンセルに対応し、UIを長時間停止させないこと。

### 14.1 探索量の上限と既定値

候補検索の探索量の上限は、通常アーティア最大進行量（`maxNormalAdvance`）、復元ボーナス最大進行量
（`maxGogmaAdvance`）、スキル最大進行量（`maxSkillAdvance`）の3つである。ユーザー向け表示では
巨戟アーティアの復元ボーナス抽選の進行を「復元ボーナス進行」と呼び、「巨戟進行」とは表示しない
（内部名 `maxGogmaAdvance` / Gogma Counterは変えない）。

- 3つの上限の「普段使う既定値」は設定画面で変更・保存でき、AppSettingsとして永続化する
  （[DATA_MODEL.md](./DATA_MODEL.md) 13、[UI_FLOW.md](./UI_FLOW.md) 14）。再読み込み・再起動後も保持し、
  Export / Importの対象とする
- 推奨の初期値は通常アーティア 350 / 復元ボーナス 500 / スキル 1500 とする。新規環境、全データ削除後、
  旧形式の設定・バックアップからの移行時はこの値を使う
- 復元ボーナスの初期値を通常アーティアより高くするのは、通常アーティアCounterが武器種ごとの固有Counter
  であるのに対し、復元ボーナス（巨戟）Counterは複数の武器で共有され、ある武器にとって遠い位置でも別の
  武器の生産工程によって進められる可能性があるためである。これは推奨値であってValidation上の大小制約では
  ない。各値は1以上の整数であればよく、例えば通常アーティア 1000 / 復元ボーナス 200 も保存できる
- 候補検索画面は、開いたときに保存済みの既定値を探索量の初期値とする。候補検索画面で変更した値は
  その画面での検索（単体検索と一括検索・追加）だけに使い、保存済みの既定値へ自動保存しない
- 一括検索・追加は、一括開始時点の候補検索画面に表示されている探索量をすべての目標武器に使う。
  一括検索専用の既定値は持たない
- 既定値の保存は候補検索のalgorithm、Candidate ranking / canonical選択、Route semantics、RNG semantics、
  CalculationContextを変更しない。Candidate Searchは呼び出し側が渡した探索量だけを使う

---

## 15. 条件緩和案の廃止

検索結果がない、少ない、または非常に遠い場合でも、目標条件を自動変更しない。条件緩和案も生成せず、UIへ提示しない（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 9章）。

Searchが返すのはcanonical Ideal 1件以下であり、「候補が少ない」という状態は「現在の探索範囲内にIdealが無かった」だけである。この場合にUIが案内するのはその事実だけであり、「この目標武器に理想品は存在しません」とは表示しない。

条件を変更するか探索上限を引き上げるかはユーザー自身の明示操作とし、その操作の後で再検索する。Domain / UIは `RelaxationSuggestion` に相当する緩和案の型も生成処理も持たない。

どこまで妥協を許すかはTargetの妥協条件がすでに表現しており、その妥協をRouteのどこで受け取るかは14章のlane別intermediate state選択が表現する。

---

## 16. 作成経路

検索では次の経路を比較する。

### 16.1 通常アーティア経由

レア8通常アーティアを作成し、有望な復元構成を利用して巨戟化する。候補の `candidateOffset = k` には `forgeCount = k + 1` 回のforgeが必要であり、先行する `forgeCount - 1` 本は通常のまま見送り、最後の1本だけを巨戟化する。conversionは通常5枠をslot順のまま継承し、初回Series / Groupを付与してSkill Counterだけを1進める。

`maxNormalAdvance` は既存UIの「通常アーティア最大進行量」と既存検索ループの意味を維持し、1以上の「最大forge回数」とする。最大0-based offsetではない。探索する `candidateOffset` は `0 ... maxNormalAdvance - 1`、最大候補位置での `forgeCount` は `maxNormalAdvance` である。

Gogma-tierのTarget条件へ到達する必要がある場合、同一Route内でconversion後のReset Bonuses、最初のReset後の追加Reset / Keep、必要なReset Skillsまでを表現できる。normal scopeの巨戟に対する最初のBonus amendmentは、5枠が既知ならReset / Keepの両方を生成する。5枠未知のblind Normal経由だけ最初のReset前のKeepを生成しない([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.9参照)。transient GogmaへのReset / Keep / Reset Skillsは `sourceOwnedWeaponId = null` で表し、fake IDまたはRoute-local IDを作らない。

### 16.2 既存巨戟アーティア経由

所持している巨戟アーティアを起点に、次の操作を組み合わせる。

- Reset Bonuses
- Keep Bonuses
- スキルのみ再付与

既存巨戟のスキルのみ再付与経路では、起点武器の復元ボーナス5枠を変更せず、Skill Prediction結果からシリーズスキルとグループスキルだけを更新する。Reset Skillsも武器性能を変更する操作であるため、起点武器は非保護でなければならない。保護中の巨戟は、Bonus / Skillを変更せず現在性能のままTargetを満たす操作0候補としてのみ利用できる。

経路フィルタが「すべて」の場合、利用可能な経路を比較し、推奨経路を表示する。

Keep Bonusesにユーザー選択slotはない。現在5slotのBonus familyをslotごとに保持し、同family内tierを再抽選する単一操作である。完成復元ボーナスは現在5slotを明示入力したRNG Engine Predictionから得る。同一Counter位置でselection branchを作らず、Keep depth 1、2、...の時間方向だけを探索する。

### 16.3 所持通常アーティア経由

レア8、非保護でTargetと武器種・属性が一致する所持通常アーティアを、作成操作なしで巨戟化する。BuildRouteは変換元IDを参照し、conversion後の必要なReset / Keep / Reset Skillsを同一Routeへ含められる。conversionでは通常5枠を継承して初回Skillを付与し、Skill Counter +1、Gogma Counter +0とする。Bonus Type MappingからRankまたは完成5枠を推測しない。変換後は元通常アーティアを在庫から除き、二重利用しない。

---

## 17. 検索結果

検索結果は1回につき1つの目標武器のものを表示する。目標武器はSelectで選ぶ。Selectでは作成リストに
登録済みの目標武器に「登録済み」を表示するが、登録済みでも選択・再検索できる。

検索結果フィルタ（すべて / 理想 / 実用 / 近似）は存在しない。返る候補は
canonical Ideal 1件以下だからである。

作成経路のフィルタ:

- すべて
- 通常アーティア経由
- 既存巨戟から

各候補には最低限、次の情報を表示する。

- 完成復元ボーナス
- シリーズスキル
- グループスキル
- 理想との差分
- 到達までのおおよその操作量
- 推奨作成経路
- 必要素材・費用の目安（22.1）

理想品が見つかった場合は、その作成Routeの途中で妥協条件を満たす状態を
スキル候補と復元ボーナス候補として軸ごとに一覧表示する。各状態には性能、
判定理由、その軸の何操作目で手に入るか、残り何操作で理想品になるかを表示する。
巨戟化直後のスキルや既存巨戟の現在スキルは「スキルリセット0回」の状態として選べる。
既定ではどの状態も選択されていない。

---

## 18. 作成リスト

検索結果からPlannerに検討させる候補を作成リストへ追加できること。

BuildCandidateは検索結果、BuildListEntryはユーザーがPlannerへ渡すために選択した状態として分離する。作成リスト追加時にはCandidateのSnapshot、Target定義Hash、検索開始RNG状態Hash、Routeが参照するOwnedWeaponの状態Hash、計算時のバージョン情報をBuildListEntryへ保存する。OwnedWeaponを参照しないRouteでは参照武器Hashを `null` とする。

1回の検索が返す候補は1件以下なので、検索結果からの追加は個別追加である。これとは別に、作成リストに
未登録の目標武器を単体検索で1件ずつ順に検索し、見つかった理想品候補を途中採用する状態なし・改善優先
「生産計画に任せる」で作成リストへ追加する「一括検索・追加」がある。作成ルートと探索量の上限は一括開始時点の
候補検索画面の値をすべての目標武器に使う（14.1）。候補なし・失敗は他の目標武器の処理を
妨げず、登録済みの項目を置き換えず、キャンセル前に追加した項目は保持する（[UI_FLOW.md](./UI_FLOW.md) 9.1）。

作成リストは、目標武器ごとにユーザーが現在採用した作成ルートを1件だけ持つ（契約本文は
[DATA_MODEL.md](./DATA_MODEL.md) 9.4.1。Issue #103のPhase 0で実装済み）。

- 同じ目標武器に別の候補が登録されている状態で新しい候補を追加する場合は、候補を並べて保持せず、
  ユーザーの確認を経て既存の項目を新しい候補の項目で置き換える。置き換えは1つの操作として行い、
  旧項目だけが消えた状態や新旧が並んだ状態を作らない。キャンセルした場合は何も変更しない
- 置き換えでは旧項目の途中採用状態と改善優先を引き継がない。新しい項目は新しい候補と今回の
  検索画面での選択だけから作る
- 置き換えが実行中の生産計画の前提を壊す場合は、既存の事前警告（27章）を経る
- Plannerが制約付き再検索で見つけた代替ルートを正式採用した場合も、失う側の目標武器の項目を
  置き換える。試行中だけは元の項目と試行中の項目が一時的に共存してよいが、試行は保存しない
- 既存データに同じ目標武器の項目が複数ある場合は、どれを残すかを推測で決めない。計画作成を
  止め、ユーザーが1件に整理するよう案内する

実装状態（Phase 0-3時点）: 計画作成の停止（同じ目標武器の項目が複数ある場合）、置き換えの
Domain / Service基盤、既存データの保持（Phase 0-1）、検索画面の置き換え確認および作成リストでの
整理の案内（Phase 0-2）、制約付き再検索・比較（what-if）・再計画採用での置き換え（Phase 0-3）は
実装済みである。制約付き再検索で採用した代替ルートは、生産計画の保存と同じ1つの操作で元の項目を
置き換える。計算後に元の項目が別の項目へ変わっていた場合は何も保存せず、再計算を求める。
Phase 0-3以前の制約付き再検索で元の項目の横に保存された項目は既存データの重複として扱い、
上記の整理の案内に従う。

追加時には、軸ごとに選択中の状態と改善優先を同じBuildListEntryへ一緒に登録する。
1つの軸から選べる状態は1つまでである。選択と改善優先の変更は作成リスト側で行い
（改善優先は再検索なしに変更できる）、同じ候補を再追加しても既存の選択を上書きしない。
改善優先は目標武器ではなく作成リストEntryの設定である。

選択した状態はPlannerのhard constraintであり、Plannerが勝手に
解除したり別の到達点へ読み替えたりしない。妥協checkpointは、生産計画上で現在の
スキルと現在の復元ボーナスの両方が採用した状態になった瞬間である（両方理想は理想品で
あってcheckpointではない）。Plannerの計算では到達しても武器の確保やstatus / 保護の変更は
行わない。実行ナビで実際に到達したときは武器を実用ラベルにするが保護は変更せず、その先の作成は続く。
ユーザーはその時点で「妥協品として確定して終了」を明示選択できる（25章）。checkpoint到達後にどちらの軸を先に理想へ近づけるかは検索時に
固定せず、改善優先はPlannerのsoft preferenceとして扱う。

再検索でBuildCandidateが置き換わってもBuildListEntryのSnapshotは失われない。ただしTarget条件（性能定義）、Candidate Route成立に使用したRNG状態、Routeが参照する起点武器の状態、または計算バージョンとの互換性が失われたEntryはstaleとし、Planner入力に使用しない。目標武器の優先度、検索対象ON/OFF、優先起点、完了状態はTarget性能定義に含めず、それだけの変更（実行ナビによる自動紐付けを含む）ではEntryをstaleにしない。優先度はPlanner実行時の計画入力、優先起点は候補検索と制約付き再検索で同等の候補からどれを選ぶかの入力（および計画入力Hashの一部）、検索対象OFFと完了状態は検索・Planner入力からの除外条件として扱う。通常のPlannerは各目標武器に作成ルートを1件しか持たないため、優先起点を理由に別ルートを選ぶことはなく、実行順の判断にも優先起点を使わない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7.4）。実行中または作成済みの計画が依存する目標武器の優先度・検索対象ON/OFF・優先起点の変更は、計画の前提変更として扱う（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.11）。完了済み目標武器のEntryはstaleではなく、Planner入力から除外する。stale理由はそれぞれ `target_definition_changed`、`rng_state_changed`、`owned_weapon_changed`、`calculation_context_changed` とする。初期版では計算に使用したRNG状態Hashが変わった場合、安全側に倒してstaleとしてよい。Routeと無関係なOwnedWeaponの変更は参照武器Hashへ含めず、Entryをstaleにしない。

作成リストに追加された候補がすべて採用されるとは限らない。PlannerはBuildListEntryを入力とし、目標の充足と全体効率を考慮して採用候補を決定する。

作成リスト項目の生成主体は次の2つとする。

- ユーザーが検索結果から選択して追加する
- Plannerが競合解決のための制約付き再検索でPlan生成に必要と判断して生成する

Plannerが生成した項目も通常の作成リスト項目と同じ形式で保存する。生成主体を区別する
永続項目は追加しない。制約付き再検索の途中で試したが最終的に採用しなかった候補は保存
しない。採用した項目は生成された作成プランと同時に保存し、片方だけが残る状態を作らない。
作成プランが生成されなかった場合は何も保存しない。

---

## 19. Planner

Plannerは複数目標を横断して作成計画を生成する。

最低限、次の要素を考慮する。

- Gogma側の共有RNG進行
- Skill側の共有RNG進行
- 通常アーティアの武器種別レア8現在位置
- 所持通常アーティアと所持巨戟アーティア
- 各所持武器の復元ボーナスとスキル
- Reset Bonuses
- Keep Bonuses
- スキル再付与
- 未分類 / 実用 / 理想の管理ラベル（計算には使用しない）
- 目標優先度
- 武器消費
- 操作回数

Plannerは候補検索と分離し、作成リストに追加された候補を入力として計画を生成する。
1回の計画で完成を目指す目標武器は、作成リストに有効な候補（staleや完了済みなどで除外されない
候補）がある目標武器だけである。作成リストに有効な候補の無い目標武器は、その計画の完成条件にも
完成数の分母にも含めない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 4.1）。

PlannerはCandidate SnapshotのBuildRouteと具体的なRouteOperationを変更しない。
Planner内部のTarget武器確保（reserve）は、実行ナビ上の独立した操作Stepにせず、そのRouteの最後の物理操作
Stepの完成処理として生産計画へ載せる（25章）。Candidate Route内の具体的な起点OwnedWeapon IDを別武器へ
差し替えない。

Plannerが自動判断できない局所競合では、ユーザーがBuildListEntryを選択し、その選択を
競合解決入力として再計算できる。この入力は競合箇所だけへ適用し、手動作成順固定には
使用しない。削除済み、stale、無効または実行不能な選択はwarningとして再選択を促す。

通常Plannerの計算方式は「ルート確定（Route commitment）+ 決定的scheduling」とする
（Issue #103 Phase C。詳細は[PLANNER_SPEC.md](./PLANNER_SPEC.md) 7と
[ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md](./ISSUE_103_DETERMINISTIC_PLANNER_DESIGN.md)）。

- 作成リストは目標武器ごとに1件だけ候補を持つ（18章）。Plannerは同じ目標武器の複数ルートから
  選ぶのではなく、ユーザーが採用したルートを実行順へ並べる
- まず、今回実行するルートを確定する。同じCounter位置を必要とするなど両立できないルート同士の
  競合があり、ユーザーの競合解決入力が無い場合は、優先度の高い目標武器を暫定的に優先して計画を
  作り（暫定帰結）、その競合をユーザー判断待ちの競合として計画と一緒に返す。暫定的に外した
  目標武器はその計画では完成しない
- 次に、共有RNG状態とシミュレーション中の武器在庫を1つの状態として進め、各時点で安全に実行できる
  操作のうち、決められた順序（目標武器の優先度、改善優先、武器の持ち替え回数、次に位置を保持する
  操作までの近さ、残り操作数、安定順）で1つを選んで実行する。同じ意味の実行順を枝分かれで
  探索しない
- 同じ入力からは常に同じ計画を返す。完全最適解（完成する目標武器数の厳密な最大化など）は保証しない
- 旧版（Phase C以前）の上限付きBeam Searchは通常Plannerでは使わない。テストと、通常Plannerとの
  比較検証（parity regression）のための基準実装（oracle）としてだけ残す。Issue #103の計測専用だった
  Browser benchmark / 計測基盤はPhase D-2bで削除した
- 通常Planner、競合解決のための制約付き再検索、比較（what-if）、実行中計画の再計画試算は、
  同じ計算方式を使う。機能ごとに別の探索方式を持たない
- ユーザーが変更できるPlannerの設定は「最大計画ステップ数」（計画で実行する操作数の安全上限、
  既定値1000）だけとする。上限に達して計画が完成しなかった場合は、探索未完了として表示し、
  値を増やして再実行できる（Issue #103 Phase D-1）
- 計画の計算中は、正確に求められない完了率を推定して表示しない。計算中であることと
  キャンセル操作を表示する

探索中はTargetごとに「理想品所持」を区別する。Ideal候補の確保で実用品所持かつ
理想品所持へ更新する。実用品を先に確保する優先評価（practical-first）は行わない。
ユーザーが選択した途中採用状態はscoreではなくhard constraintとして扱い、
妥協checkpoint未到達のままそのEntryを完了できない。複数目標武器のPlannerは
各Entryの操作をCounter位置で全体的にinterleaveし、生産計画は1本の物理操作列である。

BuildCandidateのRouteには、通常アーティア作成、巨戟化、Reset Bonuses、Keep Bonuses、Reset Skillsなどの具体的な操作列を保持する。Plannerはこの操作列からPlanStepを再現する。

---

## 20. Plannerの優先順位

基本優先順位は次のとおりとする。

1. 理想品未所持の目標武器の理想品を、優先度順に早く揃える。両立できない競合で
   ユーザーの選択が無い場合は、優先度の高い目標武器のルートを暫定的に優先する
2. 共有RNGの進行中に他の目標武器も効率よく取得する（同じCounter位置で済む操作は
   1回の物理操作として共有し、飛ばしてよい位置は他の目標武器の操作で消費する）
3. 作成リストで選択した途中採用状態（妥協checkpoint）は必ず経由する
4. 実行順が選べる場合は、目標武器の優先度、作成リストの改善優先、武器の持ち替え回数の
   少なさの順に反映する

実用品を先に確保する優先評価は行わない。途中採用状態は評価点ではなく必須条件であり、
同じ目標武器の別候補で迂回できない。改善優先は必須条件ではなく、全体の計画が成立する
範囲での希望である。所持武器の優先起点は通常Plannerの実行順の判断に使わない
（候補検索と制約付き再検索での候補の選び方に使う）。

ユーザーによる作成順の完全固定機能は初期版では実装しない。競合など判断が必要な箇所のみユーザーに選択を求める。

---

## 21. 武器在庫管理

武器をPlanner上の資源として扱い、計画ステップごとの生成、確保、消費、状態変更を追跡する。

- 非保護の所持レア8通常アーティアは巨戟化元として使用でき、変換後は元在庫から消費する
- レア6・7通常アーティアはv1 Inventoryへ含めない
- 保護中の通常アーティアは変換元にしない
- 通常アーティアにはstatusを適用しない

- statusと保護は独立して扱い、status変更だけでユーザー設定済みの保護状態を暗黙変更しない
- 武器性能を変更してよいかは `isProtected` だけが決める。statusは判定に使用しない
- 保護された武器をReset Bonuses、Keep Bonuses、Reset Skillsへ使用しない
- 保護中の巨戟は現在性能の操作0候補として利用できるが、将来のBonus / Skill amendment探索の起点にしない
- 1本の武器を同時に複数の排他的用途へ割り当てない

所持している巨戟アーティア武器そのものを「素材武器」として消費するモデルはv1に存在しない。
Plannerは所持武器を消耗品として扱わず、次の概念を一切持たない。

- 武器を素材として消費する `use_weapon_as_material` RouteOperation
- 素材利用可否を判定する `canUseAsMaterial`
- 素材用巨戟の不足（`material_weapon_shortage`）
- 素材用巨戟を補充するRoute
- 素材用として登録する `create_material_gogma` PlanStep
- 旧PracticalをMaterialへ変える確認付き `change_owned_weapon_status` PlanStep

Plannerが所持武器を消費資源として扱うことはなく、未分類武器の本数はPlanner scoreへ影響しない。

statusを書き換える経路は次だけである。

```text
任意のユーザー管理ラベル変更
→ Owned Weapons画面の通常CRUD

実行ナビで巨戟化Stepを確定
→ status = unclassified

実行ナビで、作成リストで選択した妥協checkpointへ到達したStepを確定
→ status = practical（保護は変更しない。作成中は継続）

実行ナビで理想品が完成したStepを確定
→ status = ideal、保護あり（新規生成武器でも既存武器でも保護する）
```

Plannerの計算はstatusを保存しない。性能が妥協条件や理想条件を満たしただけでは自動変更しない。
statusはnon-semanticのままで、Search eligibility、Plannerのoperation可否、Target Satisfaction、
semantic hashを決めない。

Material化のためのstatus変更と、確認必須の `change_owned_weapon_status` PlanStepは廃止した。

Plannerが確認なしで保護を解除すること、protected武器をReset Bonuses・Keep Bonuses・Reset Skillsへ使用すること、保護消費のoverride設定を設けることは禁止する。

Planner探索上で在庫から武器が消費される唯一の操作は、所持通常アーティアの巨戟化である。変換時に元の
通常アーティアを探索上の在庫から取り除き、同じ武器を複数Routeで二重使用しない。実行ナビでの永続状態は
同じ所持武器IDを通常から巨戟へ更新するものであり、元IDを削除して別IDを作らない（25章）。

---

## 22. ゲーム内アイテム素材

復元強化やスキル再抽選はゲーム内のアイテム素材を消費する。これは所持武器の消費とは
まったく別の概念であり、`MaterialRequirement`、`MaterialCostMaster`、
`BuildCandidate.requiredMaterials`、`ProductionPlan.requiredMaterials` として維持する。

アイテム素材は初期版では厳密な所持数制約にしない。必要数または必要量のみ表示する。
正確な必要個数の整備、所持素材数の管理、素材不足によるPlan不可判定はv1の対象外とする。

UIやドキュメントで所持武器と混同しうる箇所では「素材」ではなく「アイテム素材」
「必要素材（アイテム）」など意味が明確な表現を用いる。

### 22.1 必要素材・費用の目安（表示専用）

候補検索の各候補と、生成済み生産計画の詳細画面には、ゲーム内在庫と見比べるための
「必要素材・費用の目安」を表示する。目的は、RARE8アーティアパーツ、ナナイロカネ、
歴戦錬磨の証、油濁した遺装置、ゼニーがどの程度必要かをおおまかに把握することであり、
厳密な所持素材管理やコスト最適化ではない。

この目安は表示専用（display / advisory only）である。

- 候補検索の可否、Route eligibility、canonical Ideal選択、候補の順序・score・重複排除、
  Search Workerの探索結果、PlannerのRoute選択、Build Listの採否、Plan生成結果、Step順、
  競合解決、Plan validity、RNG Prediction / Counter、Candidate identity / hash、
  既存persisted dataの意味のいずれにも影響させない
- 所持素材数・所持ゼニーは管理せず、素材不足の判定・warning・Search / Planner不可判定は行わない
- 永続化せず、Worker結果・Candidate・ProductionPlan・Export / Importへ追加しない。
  候補のRoute、または生産計画の物理Step列から表示時にpure functionで導出する
- 生産計画の総量は、Build List EntryやCandidateの目安の単純加算ではなく、Plannerが生成した
  ProductionPlanの物理Step列をauthorityとして集計する。複数Targetに帰属する共有Stepは
  1回だけ加算する。`confirm_owned_ideal` や武器切替案内など、ゲーム内消費を伴わないものは加算しない
- 既に所持している通常アーティア・巨戟アーティアについて過去に支払ったコストは再計上しない

単価・換算規則は候補検索と生産計画で完全に共通とし、[SEARCH_SPEC.md](./SEARCH_SPEC.md) 4.3を正本とする。

```text
通常アーティア作成（RARE8）        武器種別RARE8アーティアパーツ ×3 / 10,000z（1本ごと）
作成対象Normalの完全復元           ナナイロカネ ×50 / 10,000z（新規Normal Routeの作成対象1本だけ）
通常 → 巨戟アーティア化            同一激化タイプの油濁した遺装置 ×3 / 30,000z（1回ごと）
Reset Bonuses / Keep Bonuses       ナナイロカネ ×20 または 歴戦錬磨の証 ×2 / 5,000z（1回ごと）
Reset Skills（スキル再付与）       油濁した遺装置 ×6（異なる激化タイプ換算）、同じタイプなら ×3 / 9,000z（1回ごと）
confirm_owned_ideal                0
```

- ナナイロカネと歴戦錬磨の証はalternativeであり、両方必要であるかのように合算しない
- 歴戦錬磨の証はReset / Keepにだけ表示する。錬金による歴戦錬磨の証からの間接換算は扱わない
- スキル再付与は異タイプ換算の ×6 を主表示とし、同タイプなら半分（×3）を補足として示す
- Counterを進めるだけのNormalには完全復元コストを加算しない
- ゼニーは概算として3桁区切りで表示する

出典の扱い。通常RARE8アーティア生産の10,000zとNormal → 巨戟化の30,000zはプロジェクトオーナーの
実機観測である。完全復元、Reset / Keep、スキル再付与の単価と14武器種のパーツ構成は、このタスクで
採用した参照情報である。いずれもProduction RNGの `game-verified` / `reference-verified` とは別の
概念であり、RNG予測の検証状態を意味しない。

---

## 23. 競合

同じRNG位置または同じ武器資源について複数候補が成立し、同時に取得できない場合は競合として扱う。

Plannerは次の情報を考慮して推奨候補を提示する。

- 目標優先度
- その目標の実用品をすでに所持しているか
- 理想品か実用品か
- 見送った場合の次候補までの距離
- 武器消費
- 操作量

Plannerだけで確定できない競合はユーザーの選択待ちとする。選択後に計画を再計算する。

Plannerが提示する推奨候補は表示用であり、制約付き再検索でどちらを固定するかを自動決定
する根拠にはしない。固定する候補はユーザーの明示的な競合選択だけが決める。明示的な選択が
無い競合については自動で再検索を行わず、競合としてそのまま提示する。

制約付き再検索は元の検索開始状態から評価し直す。ここでいう元の検索開始状態とは、計画
計算を始めた時点の現在のRNG状態・所持武器・目標定義であり、過去に画面で実行した検索
リクエストではない。過去の検索リクエストは保存しておらず復元できないため、再検索の起点に
しない。競合位置より後ろだけを探す方式にもしない。同じCounter位置を使うという理由だけで
候補を除外せず、同時に実行できるかどうかで判断する。

制約付き再検索は、過去の画面上の絞り込み設定を引き継がない。現時点で成立する作成経路を
すべて対象とし、表示件数上限を適用しない。探索範囲の上限は制約付き再検索専用の設定だけで
決める。対象は目標の理想条件を満たす候補だけである。妥協状態を独立した候補として提案する
ことはない。通常の候補検索における経路フィルタの仕様は変更しない。

制約付き再検索でPlannerが作成リスト項目を追加すると、同じ競合でも競合参加者の組み合わせ
が変わる。ユーザーの競合選択は、参加者の組み合わせではなく、選んだ作成リスト項目と競合
している資源で識別し、計画を作り直すたびに現在の競合へ対応付け直す。対応付けは計画本体の
探索を始める前に行い、その事前確認は通常の計画生成と同じ入力検証を使う。対応付けが一意に
定まらない場合はユーザーの意図を推測せず、その候補を採用しないか、競合として再提示して
選び直しを求める。

対応付け直しは、そのとき解決しようとしている競合だけでなく、ユーザーが明示的に選択済みの
競合すべてを対象とする。今回の対象外だった選択を黙って破棄してはならない。1件でも安全に
対応付けできない場合は、その候補を採用せず、ユーザーへ競合を返す。

Plannerの競合、不採用、推奨、選択の記録はBuildCandidate IDではなくBuildListEntry IDを基準に保存する。

Production Plan画面では、保存済みPlanの競合参加BuildListEntryを原則すべて表示する。
現在状態では利用できない参加者も一覧から消さず、選択不可とその理由を示す。Plannerの推奨は
判断材料として表示するだけで、自動選択または固定制約の根拠にしない。固定する候補は、保存済み
Planに残るユーザー明示選択と、今回ユーザーが明示的に選んだ参加者だけから決める。

「見送った場合の次候補までの距離」は、一方の競合参加者を仮に固定した場合について、他の参加
Targetごとに次に実行可能な理想品候補を比較するwhat-ifとして提示する。距離の
主表示はPlanner開始時の現在状態を起点とする推定操作数とし、探索範囲内に候補が無い場合と、
各種上限により未確認の場合を区別する。what-ifは保存を伴わないpreviewであり、比較の成功を
競合選択の必須条件にしない。「比較する」と「この候補を優先」は別操作とし、明示選択後に
現在の永続状態からPlanner入力を作り直して計画を再計算する。

---

## 24. 作成プラン

Plannerの結果を時系列のPlanStepとして表示する。

最低限、次の内容を確認できること。

- 完成予定の目標武器
- 作成順
- 必要素材・費用の目安（計画全体。22.1）
- 必要アイテム素材数（記録がある場合）
- 採用候補
- 不採用候補と理由
- 競合と解決結果

通常表示ではSeedとCounterを表示しない。計画生成時の入力状態をスナップショットとして保持し、前提が変わった計画をそのまま実行できないようにする。

Plan全体の開始Snapshotは監査と再現用に保持する。加えて各PlanStepに、実行前と実行後に期待するRNG状態・通常Counter・所持武器状態・計画に関係する目標武器の実行状態、またはそれらの安定Hashを保持する。

PlanStepは物理操作ごとに、その確定で適用する実行時の効果（作成対象の武器の登録とその目標武器との紐付け、同じ武器IDの更新、妥協checkpoint到達時の実用ラベル、理想品の完成と目標武器の完了）を保持する。既存の所持武器と目標武器の紐付けはStepではなく作成開始時の効果である。完成予定の目標武器数は、この完成効果だけから数える。独立した「確保」Stepは持たない（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.3）。

作成プランのstatusは次の意味を持つ。

| status | 意味 |
| --- | --- |
| draft | まだ実行を開始していない |
| active | 実行中。中断してブラウザやゲームを終了してもactiveのまま |
| completed | 計画対象の必要な処理が正常完了した |
| stale | 想定外結果や外部状態の不一致などで予測を信用できず続行できない |
| abandoned | ユーザー意思による破棄、再計画の採用、妥協品で終了、計画の前提を壊す手動変更の承認 |

staleは計画が壊れたことの検出、abandonedはユーザーが意図して終えたことを表し、区別して記録する。

作成プランのcollectionは次の件数制約を持つ（[DATA_MODEL.md](./DATA_MODEL.md) 11.1）。

```text
draft                 0..1（現在の下書き）
active + stale 合計   0..1（現在の実行中プラン）
completed / abandoned 0..N（履歴）
```

draftの上限は実行中プランの上限とは独立した不変条件であり、draftと実行中プランの同時存在は禁止しない。
Plannerの新しい結果を保存するときは、旧draftの削除・生成された作成リスト項目の追加・新draftの追加を
同一transactionで行い、保存が完全に成功した場合だけ旧draftが置き換わる。保存に失敗した場合は旧draftを
維持する。draftの置換では、旧draftが参照していた作成リスト項目・作成候補・目標武器を削除しない。
実行中・完了・破棄済みのプランも新draft保存で削除しない。

保存済みの作成プランは、`/plans` の生産計画一覧で確認できること（[UI_FLOW.md](./UI_FLOW.md) 11.5）。

- draft / active / stale / completed / abandonedのすべてを1つの一覧で扱い、statusを文字列ラベルで
  識別する。staleは再計算理由、abandonedは終了理由（ユーザーが破棄 / 再計画を採用 / 妥協品で終了 /
  前提を壊す変更を承認）を表示する。abandonedは「終了」と表示する
- 最近更新された作成プランから表示し、各作成プランの詳細へ移動できる。activeの作成プランは一覧から
  実行ナビを再開できる
- 削除できるのは未開始（draft）の作成プランだけとし、削除には確認を必要とする。表示後にstatusが変わって
  いた場合もdraft以外は削除しない。draftの削除で作成リスト項目、作成候補、目標武器、所持武器、
  操作履歴、ゲーム内セーブ地点を削除しない
- 生産計画一覧は固定ナビゲーションの「生産計画」、Dashboard、作成リスト、作成プラン詳細から到達できる。
  作成リストからは現在のdraftを開け、新しいdraftの保存が現在のdraftを置き換えることを表示する

---

## 25. 実行ナビ

作成プラン確定後、ゲーム内で行う操作を1ステップずつ案内する。意味論の詳細は[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16章、画面は[UI_FLOW.md](./UI_FLOW.md) 12章に従う。

各ステップには最低限、次の内容を表示する。

- 今回行う作業
- 使用する武器
- 想定結果
- 通常アーティア作成では、Counter進行用か、この後巨戟化する作成対象か
- このStepで完成する目標武器（ある場合）

基本操作:

- 結果一致・次へ
- 作成対象のblind通常アーティアでは、ゲーム画面で確認した実際の5枠を入力して確定
- 結果が違う
- 何を何回操作したか分からない
- Undo
- ゲーム内セーブ済みとして記録 / 最後のゲーム内セーブ地点へ戻す

初期版では必ず1操作ずつ確認する。複数操作を一括完了する高速モードは実装しない。

### 25.1 Step単位の確定

RNG状態と通常アーティアCounterは計画完了時にまとめて更新しない。ゲーム内で操作し、ユーザーが結果を確認して実行ナビでStepを確定した時点で、そのStepのCounter進行を即時に保存する。確定後の永続状態は「最後にユーザーが実行ナビで確定したゲーム状態」を表し、未確定StepのCounter進行は保存しない。

正常なStep確定は、実行前の期待状態の検証、Undo Snapshotの生成、RNG状態・Counterの更新、所持武器・目標武器への効果の適用、実行後の期待状態の検証、操作履歴の追加、Stepの完了、現在Stepの更新を1つのtransactionで行う。

### 25.2 中断と再開

一時中断用のstatusは追加しない。中断してブラウザやゲームを終了しても計画はactiveのままであり、再開時は最後に確定したStepの次から続ける。ゲーム内でセーブして中断しただけでは計画をstaleにしない。

### 25.3 所持武器として追跡する武器

計画上で今後も識別・加工・再計画の対象として使い続ける物理武器だけを所持武器として登録・追跡する。ゲーム上に実在する全武器を登録するわけではない。

- 新規通常アーティア経由で `forgeCount` 本を作成する場合、最後の1本（巨戟化する作成対象）より前はCounter進行用であり、所持武器へ登録しない。各1本の作成確定ごとに通常アーティアCounterは進める
- 作成対象の1本は作成Stepの確定時に所持武器として登録し、以後同じIDを維持する
- 通常アーティアのCounterが未確定などで5枠を予測しないblind作成では、作成対象の5枠をユーザーがゲーム画面で確認して入力する。これは予測値ではなくユーザー観測値として扱い、架空の5枠を生成しない。計画生成時に未知だった観測値は、Step確定時に結び付ける（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.4 / 16.5）
- 所持通常アーティアの巨戟化は、同じ所持武器IDを通常から巨戟へ更新する
- 所持巨戟アーティアへのReset Bonuses / Keep Bonuses / Reset Skillsは、確定ごとに同じIDの状態を更新する

作成中かどうかはstatusと直交した内部状態で表し、statusへ `in_progress` 等を追加しない。

### 25.4 目標武器との紐付けと完成

- 作成計画の生成・保存・表示では目標武器の優先起点を変更しない。作成計画は既存の所持武器をどの目標武器の起点に使うかを決め、その紐付けは作成計画画面の「作成開始」（計画の実行開始）と同じtransactionで反映する。開始で変わる紐付けは、開始前に作成計画画面で武器と変更前後の目標武器を示して事前表示する。計画内で新規作成する通常アーティアは開始時に存在しないため、その作成対象の登録を確定した時点で紐付ける。別の目標武器がその武器を優先起点にしていれば、同じtransactionで解除する。開始が失敗した場合は計画も紐付けも変更しない。計画を破棄しても紐付けは残す
- 作成リストで選択した妥協checkpointへ実際に到達した場合、武器を実用にする。作成中は継続し、計画はそのまま理想品へ進む
- 妥協checkpoint到達時は「次の操作へ進む」と「この武器を妥協品として確定して終了」を選べる。後者は確認ダイアログ必須で、武器を実用のまま確定し、作成中を解除し、目標武器は未完了のまま、優先起点の紐付けは維持し、計画をabandonedにする
- 理想品が完成したStepの確定では、新規・既存を問わず武器を理想かつ保護ありにし、作成中を解除し、目標武器を完了にして優先起点を解除する。保護された武器は優先起点にできないため、その武器を優先起点にしている他の目標武器の優先起点も同じtransactionで解除する（条件や完了状態は変更しない）。独立した「確保」操作は表示しない
- 所持武器がすでに理想条件を満たす候補が計画に含まれた場合だけ、Counterを進めない確認Stepで完成処理だけを行う

### 25.5 複数武器の計画

連続する物理操作Stepで対象の武器が変わる場合、「作業する武器を『○○』へ切り替えてください」という案内を挟み、ユーザーが「武器を切り替えました」を押して次へ進む。この案内は画面上の案内だけであり、RNG進行、Counter、所持武器、操作履歴、Plannerのコスト、最大計画ステップ数に含めない。

### 25.6 実行中の検索・目標追加・再計画

- 実行中でも候補検索は現在地点から行える（14章）
- 新しい目標武器の追加、計画に含まれない目標武器の変更、作成リストへの新規追加は計画をstaleにしない
- 計画が依存する目標武器の定義、計画が依存する作成リスト項目、計画が追跡する所持武器、RNG状態・Counterをユーザーが変更しようとした場合は、保存前に警告する。承認した場合は計画をabandonedにしてから変更を保存する
- 実行中の計画は自動で書き換えない。作成リスト等から「現在地点から再計画を試算」でき、試算中は実行中の計画、現在Step、永続状態を変更しない
- 試算した計画を正式採用する操作は別に持つ。採用時に試算開始時と現在の状態を再検証し、変化していれば採用を拒否して再試算を求める。正常採用時は旧計画をabandoned、新計画をactiveにする切替を1つのtransactionで行い、旧計画の操作履歴は残す

### 25.7 ゲーム内セーブ地点

- アプリはゲーム側のセーブ発生を推測しない。ユーザーが「ゲーム内セーブ済みとして記録」を明示操作した場合だけ、実行中計画ごとに最新1件を保持する
- セーブ地点は、復元に必要なRNG状態、全通常アーティアCounter、実行により変わる所持武器と目標武器、計画と現在Step、操作履歴の境界を保持する
- ゲームを保存せず終了してゲームがセーブ地点へ戻った場合、ユーザーはゲーム側もその地点から再開していることを確認したうえで、アプリの実行状態をセーブ地点へ戻せる。戻すのは実行に関係するゲーム対応状態だけであり、その後に追加した別の目標武器などゲーム進行と無関係なデータは巻き戻さない
- 復元後の計画に必要な所持武器・目標武器・作成リスト項目が現在のデータから削除されている場合は、削除されたデータを自動で復活させず、何も変更せずに復元を拒否する
- セーブ地点より先まで実行した計画を破棄する操作（破棄、再計画の採用、前提を壊す変更の承認）では、「現在地点を維持 / 最後のゲーム内セーブ地点へ戻す / キャンセル」を選ばせる。セーブ地点が無い場合、または現在位置と同じ場合は選ばせない
- 再計画した新しい計画へ旧計画のセーブ地点を引き継がない
- ゲーム内セーブ地点は、作成リストで選ぶ妥協checkpointとは別の概念である

### 25.8 想定外結果

- 操作は正しく行ったが結果だけ予測と違う場合は、その操作のCounter消費を反映し、実結果を所持武器と操作履歴へ保存し、計画をstaleにして以降の予測を使わず、RNG再同定へ誘導する。RNG実装不具合、ゲーム仕様漏れ、マスター漏れ、Seed / Counter同定不良などがあり得るためである
- 何を何回操作したか自体が分からない場合は、記録の時点ではCounterを推測せず、RNG状態・所持武器を変更せず、計画をstaleにする。記録後は通常のRNG同定（追加のゲーム内操作を伴う調査）へ直接誘導せず、実行ナビで回復方法を選ばせる
  - 同じ操作を何回行ったか分からないだけなら、現在のゲーム結果を入力し、計画に保存済みの予測結果列と照合して、同じ操作が連続する区間（Recovery Window）の中だけで現在位置を確認する。一意に特定できた場合だけ、その位置までのStepを計画どおり再生してアプリ状態を追従させ、同じ計画を再開する。候補が複数なら、すべての候補で次も同じ操作である場合に限り、計画どおり次の操作を1回行った結果を追加入力させて絞り込む。区間外や計画全体は検索しない
  - 別の操作・別の武器を操作した場合、または現在位置を安全に特定できない場合は、ゲーム内セーブ地点があれば（ゲーム側を戻したことを確認してから）その復元を、無ければ計画の破棄を案内する
  - Reset BonusesとKeep BonusesはどちらもGogma Counterを進める操作として扱う

---

## 26. 全体プラン確認

実行ナビ中にプラン全体を確認できること。

表示項目:

- 完了済みステップ
- 現在のステップ
- 今後のステップ
- 完成予定の目標武器

この画面の目的は現在地確認であり、初期版ではプラン編集を行わない。「現在の作業に戻る」操作で実行ナビへ戻れること。

---

## 27. Planner再計算

計画どおりに進行している間は再計算しない。再計算判定ではPlan開始時の可変状態と現在値を単純比較せず、現在Stepの期待状態と実際の状態を比較する。Step実行前に実際の状態が期待状態Beforeと一致し、実行後に期待状態Afterと一致する場合はPlanをstaleにしない。

Plan開始前のBuildListEntryは検索開始RNG状態との不一致でstaleになり得る。一方、Active Plan開始後の正常なRNG進行はPlanStep期待状態で検証し、BuildListEntryの検索開始状態と現在値が異なることだけを理由に進行中Planをstaleにしない。実行ナビ自身による目標武器の紐付け・完了、作成中の武器の登録・更新も正常な進行である。

次のように、現在Stepの期待状態または計画が依存する前提と実態に差分が生じた場合に計画を続行不可にする。

- 実際のRNG状態が想定と異なる
- Counterを手入力で修正した
- 計画が依存する目標武器またはその条件を変更した
- 計画が依存する作成リスト項目を変更した
- 所持武器を計画外で変更した
- CalculationContextとの互換性が失われた（`calculation_context_changed`）
- 想定結果と実結果が異なる
- 何を何回操作したか分からない

新しい目標武器の追加、計画に含まれない目標武器の変更、作成リストへの新規追加、所持武器のstatusだけの変更は、計画を続行不可にしない。

ユーザーが画面から計画の前提を壊す変更を保存しようとした場合は事前に警告し、承認時は計画をabandonedにする。これは想定外の不一致によるstaleと区別する。

実行中の計画を黙って置き換えず、再計算理由と影響をユーザーに示す。実行中の計画からの再計算は、現在地点からの再計画の試算と明示的な採用で行う（25.6）。

---

## 28. 操作履歴とUndo

実行ナビの操作履歴を保存する。

保存内容:

- 対象PlanStep
- 実行操作
- 実行結果（blind作成対象の観測5枠を含む）
- 想定どおりだったか
- Step実行前のUndo Snapshot
- 実行日時

ツール上で誤ってステップを進めた場合に備えてUndoを提供する。最後のExecutionHistoryだけで、そのStepが変更したRNG状態、全通常アーティアCounter、所持武器（status、作成中を含む）、実行により変更した目標武器（優先起点、完了状態）、PlanStep、ProductionPlan、現在Step、ゲーム内セーブ地点を実行前へ正確に戻せるSnapshotを保存する。Undoはアプリ内の状態と履歴を戻すための機能であり、ゲーム内操作を巻き戻すものではないことを明示する。再計画の採用や破棄で終了した計画の操作履歴はUndoの対象にしない。

---

## 29. 永続化

次のユーザーデータをIndexedDBへ保存する。

- RNG状態
- 通常アーティアCounter
- 所持武器（作成中の内部状態を含む）
- 目標武器（完了状態を含む）
- 作成候補
- BuildListEntry
- ProductionPlan
- ExecutionHistory
- ゲーム内セーブ地点
- 設定（デバッグモード、候補検索の探索量の既定値など。14.1）

データの関係、ID、トランザクション、不変条件は[DATA_MODEL.md](./DATA_MODEL.md)に従う。

旧RNG契約のconversion Gogma Counter、巨戟化時のbonus再抽選、Keep selectionを保存したBuildCandidate / BuildListEntry Candidate Snapshotは新契約と非互換である。推測変換せずinvalid / staleとして再検索を要求する。Target、OwnedWeapon、RngStateなど意味を維持できるデータは不用意に削除しない。ProductionPlanは本契約確定時点で永続化前のためmigration対象外とし、Dexie migration手順は次のコード実装フェーズで決定する。

Execution Navigatorの結果一致（観測値入力と操作0 Idealの完成確認を含む）、想定外結果記録、操作内容不明の記録、操作内容不明後の現在位置への追従、妥協品として終了は、RNG状態、通常アーティアCounter、OwnedWeapon、TargetWeapon、ExecutionHistory、PlanStep、ProductionPlan、ゲーム内セーブ地点の関連更新を1つのDexie transactionで確定する。Undo、再計画の採用、ゲーム内セーブ地点の復元、計画の前提を壊す変更の承認もそれぞれ1つのtransactionで行う。transaction失敗時は部分更新を残さず、操作前の状態を維持する。

---

## 30. Export / Import

全ユーザーデータをJSONとしてExportおよびImportできること。

- Exportデータには必ず`schemaVersion`を含める
- Import前に形式と参照整合性を検証する
- 破損または未対応バージョンのデータを部分適用しない
- 初期版は全置換Importのみとする
- Import失敗時は既存データを維持する
- データクリアには確認を必要とする
- Exportは生成したJSONを画面に表示し、クリップボードへのコピーとJSONファイルの保存のどちらも選べること。表示・コピー・保存するJSONは1回のExportで生成した同一の内容とし、コピーや保存のたびに再生成しない
- Importは、JSONの貼り付けとJSONファイルの選択のどちらからも行えること。どちらの入口も同一の検証・migration・全置換確認を通し、確認後にだけ全置換する。アプリがクリップボードを自動で読み取ることはしない
- PCとスマートフォンのどちらでも、ファイル経由とクリップボード経由のExport / Importを完結できること
- 実行ナビに関係する永続状態（目標武器の完了状態、所持武器の作成中状態、計画の終了理由、PlanStepの実行時効果、ゲーム内セーブ地点、拡張した操作履歴とUndo Snapshot）もExport / Importの対象とする
- PCからスマートフォンへの移行など端末間の同期機能は追加せず、既存のExport / Importで扱う
- 画面の配色は設定画面でLight / Dark themeから選択できる（既定はLight、OSの配色設定へ自動追従しない）。themeは端末・ブラウザ固有の表示設定でありユーザーデータではないため、Export / Importの対象とせず、Importやデータクリアでも変更しない（[UI_FLOW.md](./UI_FLOW.md) 3.5）
- 作成プランのbody内にある作成リスト項目・プラン依存目標武器の参照を現在データへの参照として要求するのは、実行中（active）のプランだけとする。未開始（draft）、続行不可（stale）、完了・破棄済みのプランは、作成リストや目標武器を後から整理していてもExport / Importを拒否しない。プランの開始・再計画・復元の可否はそれぞれの実行時の検証が判断する。ゲーム内セーブ地点の復元に必要な参照は緩めない（[DATA_MODEL.md](./DATA_MODEL.md) 15.2）
- ExportおよびImportで扱う未開始（draft）のプランは最大1件とし、2件以上を含むデータは拒否する。旧形式のExportに蓄積していたdraftは、どれが現在の下書きか判断できないため、Import時にすべて削除する
- 設定に保存した候補検索の探索量の既定値（14.1）もExport / Importの対象とする。この値を持たない旧形式（`schemaVersion` 11以前）のバックアップは、Import時に推奨の初期値（通常アーティア 350 / 復元ボーナス 500 / スキル 1500）で補完し、デバッグモードなどその他の設定は維持する

---

## 31. マスターデータ

次のデータをアプリケーションロジックから分離し、JSONなどの構造化データで管理する。

- WeaponTypeMaster
- ElementMaster
- BonusTypeMaster
- BonusRankMaster
- WeaponBonusDefinition
- SeriesSkillMaster
- GroupSkillMaster
- LotteryMaster
- MaterialMaster
- MaterialCostMaster

復元ボーナスは共通ボーナス定義と武器種別適用定義に分離する。武器種によって利用可能なボーナス種類、ランク、効果値が異なることを表現できること。

表示・効果情報とRNG抽選情報を分離し、抽選仕様の変更が表示マスターへ不要な影響を与えないようにする。

---

## 32. バージョニング

ゲームアップデートとデータ構造変更へ対応できるよう、少なくとも次のバージョンを独立して管理する。

- `gameVersion`: 対応するゲームバージョン
- `dataVersion`: マスターデータのバージョン
- `schemaVersion`: ユーザーデータ形式のバージョン
- RNGアルゴリズムまたはEngineのバージョン

これらをまとめたCalculationContextを定義する。BuildCandidate、BuildListEntry、ProductionPlanには生成時のCalculationContextを保存する。Master DataまたはRNG Engineの変更後、互換性が確認できないCandidate、BuildListEntry、Planをstale扱いにし、現行結果として使用しない。

Production v1 adapterがpersisted exact Gateを要求せずactive representativeを使用する変更はobservable Production semantics changeである。runtime実装を行うC5-E2C3で `PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e2` へ更新し、既存CalculationContextを `calculation_context_changed` として無効化する。C5-E2C2は仕様改訂だけでありversionを変更しない。

通常アーティア復元ボーナス抽選のgame-verified Production pool上限をAttack 5 / Element 4 / 斬れ味・装填数 2 / Affinity 3へ修正した変更もobservable Production RNG semantics changeであり、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e3` へ更新した（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.13）。`rngEngineVersion` の差がCalculationContextの失効境界となるため、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersionは重ねて変更しない。pinned reference implementationとのparity pool（Element 5 / Affinity 5）は別契約として変更しない。

通常アーティアPrediction / Counter IdentificationのProduction support対象武器種を、太刀単独からスラッシュアックスを除く近接10武器種（大剣・片手剣・双剣・太刀・ハンマー・狩猟笛・ランス・ガンランス・チャージアックス・操虫棍）の共通Meleeカテゴリへ拡張した変更も、以前unsupportedだったNormal Prediction inputがsupportedになりCandidate SearchのRoute availabilityとCounter Identification supportが変わるobservable Production RNG semantics changeであり、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e4` へ更新した（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.14）。太刀と、大剣・双剣・ハンマー・チャージアックスの属性ありpoolは直接game-verifiedであり、片手剣・狩猟笛・ランス・ガンランス・操虫棍と、大剣・双剣・ハンマー・チャージアックスの無属性poolはcategory-level Production adoptionである。スラッシュアックスはunsupportedのままfail closedする。この拡張でも `CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersionは変更しない。

弓の通常アーティア復元ボーナス抽選poolを「無属性 / 属性あり」の2分類から実ゲームのTable A（火・水・雷・氷・龍・爆破 → `[6, 4, 8]`）/ Table B（無属性・毒・麻痺・睡眠 → `[6, 8]`）へ修正した変更も、弓の毒・麻痺・睡眠のProduction Normal Prediction outputが変わるobservable Production RNG semantics changeであり、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e5` へ更新した（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1 / 9.12、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.15）。pool選択の正式概念は `NormalArtianLotteryTableClass`（Table A / B）であり、Normal seedはBase Seed + 武器種 + rarityのまま属性を含まず、Counterは武器種 + rarityごとに1本でTable A / Bを共有する。火・爆破・毒・麻痺・睡眠は直接実機観測、無属性は既存観測、水・雷・氷・龍のTable A分類はcategory-level Production adoptionである。スラッシュアックスを除く近接とライト / ヘビィボウガンの既存pool、スラッシュアックスのunsupported、reference parity poolは変更しない。Normal Counter IdentificationのObservationは `tableClass` を持ち、弓ではテーブルA / B、その他の武器種では属性あり / 無属性として入力する（[UI_FLOW.md](./UI_FLOW.md) 6）。この修正でも `CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、`ExportRoot.schemaVersion`、`NormalArtianCounter` persisted shapeは変更しない。

スラッシュアックスの通常アーティア復元ボーナス抽選を実機検証し（Base Seed 51231782、火属性構成と全部別々の属性パーツ構成のCounter 0比較、reloadなしのCounter 0 → 1連続作成）、パーツ構成に依存しないsingle pool `[6, 4, 7, 8]`（基礎攻撃力強化 / 属性強化 / 斬れ味強化 / 会心率強化）としてProduction Normal Prediction / Counter Identification / Candidate SearchのNormal routeで利用可能にした変更も、以前unsupportedだったNormal Prediction inputがsupportedになりCandidate SearchのRoute availabilityとCounter Identification supportが変わるobservable Production RNG semantics changeであり、`PRODUCTION_RNG_ENGINE_VERSION` を `production-rng:c5-e6` へ更新した（[RNG_SPEC.md](./RNG_SPEC.md) 6.3.1 / 9.12、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.16）。結果としてv1のレア8通常アーティアPrediction / Counter Identificationのweapon coverageは14武器種すべてになるが、verification provenanceは一様ではない: 弓 / ライト・ヘビィボウガン / Melee共通10種 / スラッシュアックス独立という構造を保ち、スラッシュアックスをMelee共通10種へ統合しない。スラッシュアックスのpool membership、構成非依存、Counter 0 → 1系列は直接実機観測であり、Attack 5 / Element 4 / Sharpness 2 / Affinity 3の上限境界はcategory-level Production adoptionである。Identification Domainの `table_a` / `table_b` はスラッシュアックスでも属性あり / 無属性の観測区分として残るが、両区分が同じsingle poolを参照するadapter表現であり、ゲーム上2つのtableがある意味ではない。Counterは `weapon.switch_axe:8` の1本のみで、この変更でも `CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、Master dataVersion、`ExportRoot.schemaVersion`、`NormalArtianCounter` persisted shape、reference parity poolは変更しない。

巨戟アーティアのReset Bonuses / Keep Bonusesを2026-09-15に追加実機検証し（Base Seed 51231782）、Production Gogma Resetの契約を次のとおり確定した（[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1、[RNG_REFERENCE_AUDIT.md](./RNG_REFERENCE_AUDIT.md) 14.17）。候補となる復元ボーナスfamilyは、Masterの `WeaponBonusDefinition` + `ElementMaster.allowsElementBonus` ではなく、同じ武器種・属性のProduction通常アーティアpoolのfamily集合で決める（弓のテーブルA / B、スラッシュアックスのsingle poolを含む）。共有するのはfamily集合だけで、通常アーティアのseed、Counter、抽選上限は流用しない。1回のReset結果内で斬れ味・装填強化familyは合計2枠までとし、基礎攻撃力強化 / 会心率強化 / 属性強化には明示family上限を設けない（会心率強化5枠と属性強化4枠が実在する）。exact-ID repeat penaltyとKeepの契約（slot familyと位置を保持しtierだけ再抽選）は変更せず、GARP v0.9.4 reference parity（候補表、weighted draw、reference golden / tests）も変更しない。Gogma Counter IdentificationはProduction Resetと同じavailabilityとweighted drawを共有する。弓の毒、スラッシュアックスの無属性構成、ハンマー麻痺での斬れ味・装填2枠上限、会心率4 / 5枠、槍龍の属性強化4枠、双剣龍の連続Keepは直接実機観測であり、弓の麻痺・睡眠のfamily availability、未観測の武器種・属性、ハンマー麻痺以外への斬れ味・装填上限の適用はcategory-level Production adoptionである。斬れ味・装填familyを3枠以上currentに持つKeepは未確認のまま扱う。この契約はPR-BでProduction Gogma ResetとGogma Counter Identificationへ実装済みであり、Prediction outputが変わるobservable Production RNG semantics changeとして `PRODUCTION_RNG_ENGINE_VERSION` を現在の `production-rng:c5-e7` へ更新した（旧versionのBuildCandidate / BuildListEntry / ProductionPlanは `rngEngineVersion` の差で `calculation_context_changed` になる）。`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、`ExportRoot.schemaVersion`、`RngState.schemaVersion`、PRNG、seed derivation、10-step block、Counter semanticsは変更しない。所持武器・目標武器の選択肢とValidationをこのavailabilityへ揃える変更はPR-Cで実装済みであり、RNG Prediction output、`PRODUCTION_RNG_ENGINE_VERSION`（`production-rng:c5-e7` のまま）、schema、Master JSON / dataVersionは変更していない。

---

実行ナビのライフサイクル改訂（25章、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16章）は、目標武器のlifecycle、所持武器の実行時lifecycle、優先起点のstaleness semantics、PlanStepと確保（reserve）のsemantics、実行時の期待状態、Undo対象範囲を変更する。後続の実装PRではCalculationContextの `appSchemaVersion` 更新が必要になる可能性が高く、目標武器・所持武器・ゲーム内セーブ地点などの永続形状の変更によってはDexie `DATABASE_SCHEMA_VERSION` と `ExportRoot.schemaVersion` の更新も必要になる。本改訂は仕様PRであり実コードのversionを変更しない。実装PRで現行schemaとImport互換を監査し、必要なversion境界を確定する。既存データを推測migrationして意味を変えてはならない（所持している理想品から目標武器を完了済みと推測する、既存の所持武器を作成中と推測する、など）。最初の実装PR（永続Entity基盤）では目標武器lifecycle、所持武器の作成中状態、ゲーム内セーブ地点の永続形状を追加し、Dexie `DATABASE_SCHEMA_VERSION` を5、`ExportRoot.schemaVersion` を7へ更新した。計算意味はまだ切り替えないため `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は11のままとした。2番目の実装PR（Execution Plan契約）で目標定義hashの正規化、計画入力hash、Plan依存hash、実行時の期待状態、PlanStepのexecution effect、確保（reserve）の扱いを切り替え、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を12、`ExportRoot.schemaVersion` を8へ更新した（Dexieは5のまま）。3番目の実装PR（Execution runtime core）で生産計画のlifecycle metadataとUndo Snapshotの拡張を永続形状へ加え、Dexie `DATABASE_SCHEMA_VERSION` を6、`ExportRoot.schemaVersion` を9へ更新した（計算意味は変えないため `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は12のまま）。後続の実装PRで、既存の所持武器と目標武器の紐付けを作成開始時へ移し（計画内で新規作成する武器は登録時のまま）、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を13へ更新した。version 12以前の作成計画は実行できない（再計算が必要）が、候補検索と作成リストの意味は変えていないため、version 12の候補と作成リスト項目は明示的な互換例外によりそのまま利用できる（version 11以前は非互換のまま）。永続形状は変えないためDexieは6、`ExportRoot.schemaVersion` は9のままである。

通常Plannerの計算方式を上限付きBeam Searchから「ルート確定 + 決定的scheduling」へ切り替えた変更（Issue #103 Phase C、19章 / 20章）では、同じ入力に対して未解決競合の暫定帰結、返す競合、不採用記録、操作順などが変わり、保存済みの作成プランは生成方式を記録しないため、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を14へ更新した。version 13以前の作成プランは下書き・実行中を問わず実行・比較・競合操作ができず（`calculation_context_changed`）、実行中のプランは現在地点からの再計画が必要になる。保存内容は削除・変換せず、そのまま表示できる。候補検索と作成リストの意味は変えていないため、version 12 / 13の候補と作成リスト項目は明示的な互換例外によりそのまま利用できる（version 11以前は非互換のまま）。永続形状、RNG、Masterは変えないため、Dexie `DATABASE_SCHEMA_VERSION`（8）、`ExportRoot.schemaVersion`（11）、`RngState.schemaVersion`（2）、`AppSettings.schemaVersion`（1）、`PRODUCTION_RNG_ENGINE_VERSION`、Master dataVersionは変更しない。

候補検索の探索量の既定値を設定として保存できるようにした変更（Issue #125、14.1）は、AppSettingsの永続形状の変更である。AppSettingsへ `candidateSearchDefaults` を追加して `AppSettings.schemaVersion` を2、Dexie `DATABASE_SCHEMA_VERSION` を9、`ExportRoot.schemaVersion` を12へ更新した。Dexie v8 -> v9 upgradeとExport schema 11 -> 12 migrationは、旧AppSettings（version 1）へ推奨の初期値 350 / 500 / 1500 を補完し、デバッグモード・`resultPageSize`・`defaultSearchLimit`・日時は維持する。旧候補検索画面の固定値（500 / 350 / 1500）はユーザーが保存した値ではないため引き継がず、`defaultSearchLimit`（通常アーティアCounter特定の検索範囲）を探索量の既定値へ流用しない。候補検索・Planner・RNGの計算意味は変わらないため、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`（14）、`PRODUCTION_RNG_ENGINE_VERSION`、`RngState.schemaVersion`（2）、Master dataVersionは変更せず、既存の候補・作成リスト項目・作成プランをstaleにしない。

---

## 33. 詳細表示とデバッグモード

通常利用時は内部RNG情報を表示しない。設定からデバッグモードをONにした場合のみ、次の情報を確認可能とする。

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate
- 通常アーティアCounter
- PlanStep内部情報
- RNG予測情報
- Planner判定理由
- 再計算理由

デバッグモードのON/OFFによって計算結果や保存データの意味が変わらないこと。

実行ナビはStep確定ごとにCounterを更新するが、デバッグモードOFFで具体的なSeed / Counter数値を通常表示しない契約は変更しない。デバッグモードONでは各Stepのbefore / afterを確認できる。

---

## 34. 初期版のスコープ外

次の機能は初期版では実装しない。これらを理由なく初期実装へ追加しないこと。

- OCR
- OCRによる所持武器一括登録
- REFrameworkとの直接連携
- 高速実行モード
- 複数キャラクター切替
- クラウド同期
- ユーザーアカウント
- 手動作成順固定
- 高度な任意スコアリング

外部ツールで取得した値の手入力は許可するが、外部ツールとの自動通信は行わない。

---

## 35. 実装原則

- UIとRNG、検索、Plannerロジックを分離する
- RNG EngineはReactに依存させない
- 検索ロジックはReactに依存させない
- PlannerはReactに依存させない
- 純粋関数として実装可能な処理は純粋関数にする
- 重い検索とPlanner処理はWeb Workerで実行する
- UIスレッドを長時間ブロックしない
- Workerとの通信データは型とバージョンを持たせる
- TypeScriptの型安全性を優先し、`any`の使用を原則避ける
- IDやマスター参照を表示名で代用しない
- 復元ボーナス5枠などの不変条件を保存時と計算時に検証する
- 主要ロジックにはVitestによるテストを作成する
- UIの主要導線にはコンポーネントまたはE2Eテストを作成する
- RNGアルゴリズムが未確定の箇所を推測実装しない
- 未確定ロジックは明示的なEngine境界とテスト用Fakeで隔離する
- 仕様変更が必要な場合は実装前に差分を提示する

---

## 36. 完了条件

各実装タスクは、対象範囲に応じて最低限次を満たすこと。

- TypeScriptの型チェックが成功する
- `npm test`が成功する
- `npm run build`が成功する
- 既存テストを破壊しない
- 新規または変更した主要ロジックにテストがある
- 保存データの不変条件と参照整合性を維持する
- Worker処理中も主要UIが操作不能にならない
- スマートフォン幅で主要操作が行える
- GitHub Pagesの配信パスで起動と画面遷移が成功する
- 対応仕様と未実装範囲を実装結果に明記する

RNGの実データやアルゴリズムが未確定の段階では、推測値を使った本番Engineの完成を完了条件に含めない。その段階の完了条件は、型付きEngine境界、Fake実装、固定Fixtureによる検証が成立することとする。

---

## 37. 開発順序

機能を一括実装せず、次の順序を基本として小さな単位で進める。

1. プロジェクト基盤とGitHub Pages向けビルド
2. マスターデータの型、読込、検証
3. Domain ModelとDexie永続化
4. RNG Engineの境界とFixture
5. Counter観測検索
6. 条件評価Engine
7. 候補検索とWorker
8. 所持武器管理
9. 目標武器管理
10. 検索結果と作成リスト
11. Plannerの基本計画生成
12. 武器在庫と競合処理
13. ProductionPlan表示
14. 実行ナビ
15. 履歴、Undo、再計算
16. Export / Importと移行検証
17. レスポンシブ表示と統合テスト

各段階で、その段階の仕様に対応するテスト、型チェック、ビルドを通してから次へ進む。

---

## 38. 受入シナリオ

初期版は少なくとも次の一連の操作を完了できること。

### 38.1 状態設定から候補検索

1. ユーザーがRNG状態をImportまたは直接入力する
2. 必要な武器種のレア8通常Counterを観測結果から確定する
3. 必要に応じて所持通常アーティアと所持巨戟アーティアを登録する
4. 理想構成と実用ラインを持つ目標武器を複数登録する
5. 利用可能な経路から候補を検索する
6. 理想品候補と、その作成Route上で途中採用できるスキル / 復元ボーナス状態、到達距離を確認する
7. 復元ボーナス条件を満たす既存武器から、スキルのみ再付与する候補を検索できる

### 38.2 複数目標の計画生成

1. 複数目標の候補を作成リストへ追加する
2. Plannerが共有RNG、武器在庫、優先度を考慮する
3. 競合がなければ実行可能な時系列計画を生成する
4. 競合があれば理由と選択肢を表示し、選択後に再計算する
5. 保護武器がReset Bonuses・Keep Bonuses・Reset Skillsへ使われないことを確認する
6. Plannerの競合と不採用記録がBuildListEntry基準で追跡できる

### 38.3 実行と再同期

1. ユーザーが計画を1ステップずつ実行し、Step確定ごとにCounter進行が保存される
2. 想定どおりの場合は状態と履歴を更新して次へ進む
3. 想定と異なる場合は実結果を記録し、計画をstaleにしてRNG再同定へ誘導する
4. 差分と再計算理由を表示し、現在地点から新しい計画を試算・採用できる
5. 誤って進めたアプリ内操作をUndoできる
6. 所持武器のstatusを変更してもPlanがstaleにならない
7. 所持通常アーティアの巨戟化で、探索上は同じ武器を二重利用せず、永続状態では同じ所持武器IDが巨戟へ更新される
8. 最後のExecutionHistoryのSnapshotから直前Stepのアプリ内変更（目標武器の紐付け・完了を含む）を完全にUndoできる
9. Step確定、再計画の採用、ゲーム内セーブ地点の復元、Undoの保存失敗時に部分更新が残らない

### 38.5 実行ナビのライフサイクル

仕様上、少なくとも次のケースを通せること（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 15.10 / 16章）。

- A 単一目標・新規通常アーティア: Counter進行用の通常アーティアを複数作成し、最後の1本だけを所持武器へ登録し、巨戟化、Reset / スキルリセット、理想品完成、目標武器完了、計画完了まで進む
- B blind通常アーティア: 作成対象の5枠は予測せず、ユーザーが実際の5枠を入力して所持武器へ登録し、巨戟化、Reset、理想品完成へ進む。架空の5枠を生成しない
- C 既存巨戟: 計画生成時は目標武器を紐付けず、作成開始時に自動紐付けし（変更予定は開始前に表示）、同じ所持武器IDを更新し、理想品完成で理想・保護あり・目標武器完了になる
- D 妥協品で終了: 妥協checkpoint到達で実用になり、ユーザーが確認のうえ終了を選ぶと計画はabandonedになり、目標武器は未完了のまま残る
- E 複数目標・武器切替: 武器A操作、武器B操作、武器A操作の間に切替案内を挟み、案内自体はRNG操作Stepにしない
- F 計画中の目標追加: 実行中の計画があっても新しい目標武器を追加でき、計画はstaleにならず、現在地点から候補検索できる
- G 再計画: Step 12まで完了した計画に目標武器を追加して再計画を試算しても元の計画は変わらず、採用時に状態を再検証して旧計画abandoned・新計画activeへ同時に切り替わる
- H ゲーム内セーブ地点: Step 12でセーブ済みを記録しStep 20まで進めた後に計画を破棄すると、「現在地点を維持 / Step 12へ戻す / キャンセル」を選べる
- I 想定外結果: 予測とゲーム結果が違うと実結果を記録して計画をstaleにし、以降の予測を止めてRNG再同定へ誘導する
- J 操作0の理想品: 所持武器がすでに目標武器の理想条件を満たす場合に目標武器登録・候補検索で通知でき、計画に含まれた場合はCounterを進めない確認Stepだけで理想品として確定する

### 38.4 保存と復元

1. ブラウザを再読み込みしてもユーザーデータが復元される
2. 全データをJSONとしてExportできる
3. データクリア後に対応バージョンのJSONをImportできる
4. 不正データまたは未対応バージョンのImportが既存データを破壊しない

---

## 39. 初期版v1仕様の固定

本書および参照する詳細仕様書を、初期版実装のv1基準とする。実装中に意味変更が必要になった場合は、コードだけで吸収せず該当仕様書を更新して変更理由を記録する。

conversionのNormal +0 / Skill +1 / Gogma +0、bonus継承、初回Skillはgame-verified（実機確認済み）である。create/reset/keepのstream進行、Keep family保持はreference-verifiedであり、本書の正式製品契約として採用するが、全weapon、attribute、game versionでgame-verifiedという意味ではない。直接観測していない武器種・属性におけるGogma Reset family availability（Production通常アーティアpoolのfamily集合からのcategory-level adoption、[RNG_SPEC.md](./RNG_SPEC.md) 6.1.1）、武器種のProduction family availability外のfamilyをcurrentに持つKeep、斬れ味・装填familyを3枠以上currentに持つKeep、栄光の誉れ、祝祭の巡り、Gate未満の保存Counter進行、normal-scope current bonusesからのKeep結果の実機一致はunverified（未確認）のため推測固定しない。`gogma_artian` scopeのRank Iは実機確認済みではなく（かつての確認は巨戟化直後のnormal-scope状態の誤認）、Masterから除外した。Interface、Capability、Fake Engine、Fixtureの境界を維持する。

Practical同士の優劣判定は将来仕様とし、v1では実装しない。

同一Route内で新規生成した武器を後続Operationから参照するRoute内武器参照型は将来仕様とし、v1では追加しない。

C5-E2C2で、本書および詳細仕様のProduction Counter Gate契約を「exact persisted Gate不要、operation別active representative使用」へ正式改訂した。C5-E2C3 Active Gate runtime integrationでProduction adapter、Domain Prediction input、Capability、Search、Planner、Trace Replay、semantic Hashを本仕様へ同期し、`PRODUCTION_RNG_ENGINE_VERSION`を `production-rng:c5-e2`へ更新した。`RngState.counterGate`は互換・診断用に保持する。C5-E2C7でIdentification Wizard UIをRNG Setupへ接続し、実Browser Worker benchmarkはC5-E2C8で、Skill live-game verificationはC5-E2C9で完了した（[C5_E2C8_BROWSER_WORKER_BENCHMARK.md](./C5_E2C8_BROWSER_WORKER_BENCHMARK.md) / [C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md](./C5_E2C9_SKILL_LIVE_GAME_VERIFICATION.md)）。C5-E2C10 Production Identification activationが完了した（[C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md](./C5_E2C10_PRODUCTION_IDENTIFICATION_ACTIVATION.md)）。


Target妥協条件改訂ではDexie schema 2 / ExportRoot schema 2 / CalculationContext appSchemaVersion 6を採用する。旧Targetの妥協条件は推測変換せず解除し再設定を案内する。旧計算artifactは内容を保持してcalculation_context_changedでfail closedとする。詳細はTARGET_COMPROMISE_SEMANTICS.md。

Target妥協条件のversion 6への変更では、旧1..5のBuild List項目を新候補の重複として再利用しない。
同じ完成結果・経路でも、新計算版を別項目として追加できる。旧snapshotは保持する。

保護契約の改訂ではCalculationContext appSchemaVersionを7へ更新する。version 1..6のCandidate / BuildListEntry / ProductionPlanは内容を保持したまま `calculation_context_changed` でfail closedとする。Dexie `DATABASE_SCHEMA_VERSION = 2` とRNG Engine versionは変更せず、既存Practicalの保存済み保護値もmigrationしない。

独立した実用品Candidateを廃止し、canonical Ideal Route上の選択可能な妥協チェックポイントへ
再設計した改訂では、CalculationContext appSchemaVersionを10へ、`ExportRoot.schemaVersion` を
5へ更新する。version 1..9のCandidate / BuildListEntry / ProductionPlanは内容を保持したまま
`calculation_context_changed` でfail closedとする。Dexie `DATABASE_SCHEMA_VERSION = 4` と
RNG Engine versionは変更しない。`OwnedWeaponStatus.practical` は所持武器の管理ラベルとして
そのまま残す。

1本の固定操作列のstrict prefix checkpointを、スキル軸 / 復元ボーナス軸ごとの途中採用状態と
改善優先へ再設計し、Plannerが両軸をinterleaveする改訂では、CalculationContext
appSchemaVersionを11へ、`ExportRoot.schemaVersion` を6へ更新する。version 10の
checkpoint選択は軸ごとの選択へ変換できないため、version 1..10のCandidate / BuildListEntry /
ProductionPlanは内容を保持したまま `calculation_context_changed` でfail closedとする。
Dexie `DATABASE_SCHEMA_VERSION = 4` とRNG Engine versionは変更しない。

実行ナビのライフサイクル（Step単位のCounter確定、中断 / 再開、現在地点と計画完了後予測からの検索、実行中の目標追加と再計画の試算・採用、計画の破棄、ゲーム内セーブ地点、作成中武器の所持武器管理、目標武器との作成中紐付け、妥協checkpointと妥協品での終了、理想品完成と目標武器の完了、確保（reserve）の実行上の役割変更、武器切替案内、想定外結果とRNG再同定、Undo対象の拡張、優先起点とstalenessの分離、blind作成とCounter進行用通常アーティア）を25章と[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16章で正式仕様として確定した。これは仕様確定であり、コード実装、Dexie migration、Export schema変更、CalculationContext version bumpは後続の実装PRで行う（32章）。Production RNG semantics、Candidate Search algorithm、direct observation / category-level adoption / reference parity / unverifiedの確認状態の境界は変更していない。Plannerについては、探索内部の確保（reserve）をRouteの最後の物理unitの直後に適用することと、完成時に既存武器も保護することだけを探索契約として定めた（[PLANNER_SPEC.md](./PLANNER_SPEC.md) 16.3）。

作成プランの下書き（draft）lifecycle整理（24章、[DATA_MODEL.md](./DATA_MODEL.md) 11.1 / 14.2 / 14.5 / 15、[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.15 / 16.2）は、Persistence / backup lifecycle契約の変更である。通常draftをtop-level collectionで最大1件とし、Planner結果の保存で旧draftを同一transaction内でatomicに置換し、Export / Importの作成プランbody内参照をlifecycle-aware（activeだけcurrent参照を要求）にした。旧契約で蓄積したdraftはどれが現在の下書きか判断できないため、Dexie v7 -> v8 upgradeとExport schema 10 -> 11 migrationでdraftを全件削除し、他のプラン・作成リスト項目・その他のデータは変更しない。これに合わせて `DATABASE_SCHEMA_VERSION` を8、`ExportRoot.schemaVersion` を11へ更新した。Planner計算semantics、RNG semantics、Build resultのCalculationContext semanticsは変わらないため、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`（13）、`RngState.schemaVersion`（2）、`AppSettings.schemaVersion`（1）、`PRODUCTION_RNG_ENGINE_VERSION`、Master dataVersionは変更していない。
