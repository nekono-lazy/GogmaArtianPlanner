# モンハンワイルズ 巨戟アーティア厳選Planner
## REQUIREMENTS.md

## 1. 文書の目的

本書は、Monster Hunter Wildsの通常アーティア武器および巨戟アーティア武器について、RNG状態をもとに将来の復元ボーナスとスキルを検索し、複数の目標武器を効率よく作成するWebアプリケーションの初期版要件を定義する。

本書を初期版の上位要件とし、具体的な型、保存形式、アルゴリズム、画面遷移は以下の文書で定義する。

- [DATA_MODEL.md](./DATA_MODEL.md): 型、ID、enum、関係、永続化、不変条件
- [MASTER_DATA.md](./MASTER_DATA.md): 武器種、属性、ボーナス、スキル、抽選、素材のマスター
- [RNG_SPEC.md](./RNG_SPEC.md): RNG状態、予測、進行、Import、観測検索
- [SEARCH_SPEC.md](./SEARCH_SPEC.md): 条件評価、候補検索、経路比較、条件緩和
- [PLANNER_SPEC.md](./PLANNER_SPEC.md): 候補選択、競合、在庫、作成計画、再計算
- [UI_FLOW.md](./UI_FLOW.md): 画面、操作導線、表示ルール、実行ナビ

本書と詳細仕様に矛盾がある場合、勝手に解釈して実装せず、要件差分として報告すること。

---

## 2. プロダクトの目的

本アプリは単なるSeed Finderではなく、次の作業を一続きで支援する。

- 通常アーティア経由と既存巨戟アーティア経由を比較する
- 複数の目標武器を横断して効率的な作成ルートを計画する
- 所持している通常アーティアと巨戟アーティアを再利用する
- 実用品を早期に確保し、その後に理想品まで到達する計画を立てる
- 計画に沿ったゲーム操作を1ステップずつ案内する
- 実際の結果が想定と異なった場合に状態を修正して計画を再生成する

単一武器のRNG予測・作成RouteはGogma-Artian-Roll-Plannerの参照実装で確認済みのアルゴリズムを参照し、GogmaArtianPlannerはこれを複数Target、所持Inventory、共有RNG Planner、1 Step Executionへ拡張する。Seed / Counterの観測・特定はGogma Seed Finder系を参照する。外部Repositoryはalgorithm provenanceであり、コードをコピーして組み込むことを意味しない。

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

スマートフォンでゲームを見ながら操作する利用形態を重視する。PCブラウザでも同じ機能を利用できること。

---

## 4. 初期版の基本方針

- 1キャラクター分のデータのみ管理する
- 複数キャラクターの切替機能は実装しない
- 別キャラクターで利用する場合は、現在データのExport、データクリア、別キャラクターの設定という運用にする
- 最終的に作成する目標武器は常に巨戟アーティアとする
- 通常画面ではSeedやCounterを原則表示しない
- RNGやPlannerの専門知識がなくても主要操作を完了できるUIにする
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

機能ごとに必要な値からCapabilityを判定する。例えばGogma予測、Skill予測、通常アーティア検索、Planner実行は、それぞれが依存する確定値だけを要求する。不足値に依存する経路のみを無効化し、利用可能な経路まで一括で無効化しない。

stream進行は次を正式契約とする。Statusはprovenanceの確認範囲であり、正式契約かどうかとは別である。

| Operation | Normal | Skill | Gogma | Status |
| --- | ---: | ---: | ---: | --- |
| create normal | +1 / forge | 0 | 0 | reference-verified |
| convert normal to Gogma | 0 | +1 | 0 | game-verified |
| reset skills | 0 | +1 | 0 | reference-verified |
| reset bonuses | 0 | 0 | +1 | reference-verified |
| keep bonuses | 0 | 0 | +1 | reference-verified |

`use_weapon_as_material` のRNG進行は未確認であり推測しない。Domain Counter +1とPRNG内部1 blockの10 stepは別概念とする。Counter Gateは予測時のeffective PRNG blockにだけ適用し、Skill Gate < 54ならSkill offsetを0、Gogma Gate < 35ならGogma offsetを0とする。Gate未満で保存Counter自体が操作後にどう変化するかは未確認のまま維持する。

通常画面では内部値を直接操作させない。詳細表示またはデバッグモードでのみ確認可能とする。

---

## 6. RNG状態の取得

初期版では次の3方式を提供する。

### 6.1 GogmaSeedFinderからImport

GogmaSeedFinderが出力する状態情報をユーザーが貼り付け、解析結果を確認してから取り込めること。

一部の値だけ読み取れた場合は、読み取れた項目だけを適用できること。読み取れない項目や既存の他項目を暗黙に上書きしない。

GogmaSeedFinderのソースコードそのものをコピーして使用しない。対応する入力形式は[RNG_SPEC.md](./RNG_SPEC.md)で定義する。

### 6.2 正確な値の直接入力

別ツールやREFrameworkなどで取得した値を入力できること。取得手段との直接連携は行わない。

入力対象は次の値とする。

- Base Seed
- Gogma Counter
- Skill Counter
- Counter Gate

判明している項目だけを入力でき、4項目すべてを必須としない。

### 6.3 観測結果から検索

ゲーム内で確認した抽選結果を入力し、対応するSeedまたはCounter候補を検索できること。通常アーティアの現在位置特定はこの方式を主に使用する。

一度の観測で候補が一意にならない場合は、追加観測が必要であることを明示する。

Seed検索とCounter検索は別の入力・結果型として扱う。Seed検索は検索Seed範囲と、Normal Artian、Gogma Bonus、Skillの利用可能な観測情報を組み合わせて候補を絞り込む。いずれも重い処理としてWeb Workerで実行する。

通常アーティアCounterの直接修正は通常UIに置かず、必要な場合のみDebug Modeで提供する。

---

## 7. 通常アーティアCounter

- Base Seedが判明していても、通常アーティアCounterが不明な場合は観測結果から現在位置を検索する
- レア8 Counterが未確定の武器種について、通常アーティア経由の候補検索を行わない
- Counterが未確定でも、既存巨戟アーティア経由の候補検索は利用可能とする
- すべての武器種のレア8 Counterを事前に確定させる必要はない
- Counter候補が複数ある状態を確定済みとして扱わない

---

## 8. 所持アーティア管理

所持している通常アーティアと巨戟アーティアを1本ずつ個別管理する。素材用巨戟も省略せず登録できること。

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
- 関連する目標武器

巨戟アーティアの状態は次の3種類とする。通常アーティアは状態を持たない。

- `Material`: 素材用
- `Practical`: 実用品
- `Ideal`: 理想品

素材用武器にも復元ボーナス5枠とスキルを保持する。現在の復元構成がKeep Bonusesによって将来の目標武器作成に利用できる可能性があるためである。

通常アーティアはレア8だけを登録でき、`normal_artian` scopeの復元ボーナス5枠を保持し、シリーズ／グループスキルとstatusを持たない。巨戟アーティアは、変換直後から最初のResetまでは継承した `normal_artian` scopeの5枠、その後は `gogma_artian` scopeの5枠を保持できる。1本の5枠内でscopeを混在させない。レア度選択UIは持たない。通常／巨戟の両方で保護を設定でき、保護中の通常アーティアを自動計画の巨戟化元にしない。

無属性武器では通常／巨戟とも属性強化を利用できない。ライト／ヘビィボウガンの属性強化不可ルールも維持し、ElementとWeaponBonusDefinitionのMasterから選択肢を決定する。

実用品と理想品は原則として保護する。同一TargetのIdeal武器を取得しても旧Practical武器を自動的に素材化せず、ユーザーの明示操作を必要とする。Practical同士の優劣はv1で判定しない。

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

優先度は1から5、デフォルトは3とする。未変更の場合は3として扱う。

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

## 11. 実用ライン

理想品が遠い場合でも、ゲームで使用できる妥協品を確保できるように実用ラインを設定する。

### 11.1 通常条件

条件には次の項目を設定できる。

- ボーナス種類
- 最低ランク
- 必要個数
- そのうちEXを何個以上必要とするか

例: 「攻撃II以上を2個、そのうちEXを1個以上」

### 11.2 OR条件

複数候補のいずれかを満たせばよい条件グループを設定できる。

例: 「属性EXまたは会心EXを合計1枠以上」

初期版では複雑な任意論理式を実装しない。実用ラインは次の構造に限定する。

```text
すべての通常条件を満たす
AND
すべてのOR条件グループを満たす
```

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

---

## 13. 完成判定

### 13.1 実用品

次の両方を満たす候補を実用品と判定する。

- 復元ボーナスが実用ラインを満たす
- スキルが実用ラインを満たす

### 13.2 理想品

次の両方を満たす候補を理想品と判定する。

- 復元ボーナスが理想構成と一致する
- スキルが理想条件と一致する

理想品は実用品より上位のカテゴリとして扱い、同じ候補を重複表示しない。

---

## 14. 候補検索

検索対象がONの目標武器について、現在のRNG状態から将来の完成候補を検索する。

候補カテゴリは次の2種類とする。

- `Ideal`
- `Practical`

理想への近さはカテゴリとは別の軸として、理想との差分、近似表示の可否、必要に応じた類似度で表す。UI上のSimilar（近似）は、実用品のうち理想に近いと判定された候補を抽出するフィルタであり、独立カテゴリではない。実用ラインを満たさない「惜しい候補」は初期版では原則表示しない。

同じ完成結果と実質的に同じ経路を持つ候補は重複排除する。検索処理は進捗表示とキャンセルに対応し、UIを長時間停止させないこと。

---

## 15. 条件緩和

検索結果がない、少ない、または非常に遠い場合でも、目標条件を自動変更しない。代わりに条件緩和案を提示する。

緩和案の例:

- 攻撃III以上からII以上へ下げる
- EX必須を解除する
- 必要数を2から1へ減らす

各案について、適用した場合の最短候補までのおおよその距離を表示する。ユーザーが選択した場合のみ条件を変更し、再検索する。

---

## 16. 作成経路

検索では次の経路を比較する。

### 16.1 通常アーティア経由

レア8通常アーティアを作成し、有望な復元構成を利用して巨戟化する。候補の `candidateOffset = k` には `forgeCount = k + 1` 回のforgeが必要であり、先行する `forgeCount - 1` 本は通常のまま見送り、最後の1本だけを巨戟化する。conversionは通常5枠をslot順のまま継承し、初回Series / Groupを付与してSkill Counterだけを1進める。

`maxNormalAdvance` は既存UIの「通常アーティア最大進行量」と既存検索ループの意味を維持し、1以上の「最大forge回数」とする。最大0-based offsetではない。探索する `candidateOffset` は `0 ... maxNormalAdvance - 1`、最大候補位置での `forgeCount` は `maxNormalAdvance` である。

Gogma-tierのTarget条件へ到達する必要がある場合、同一Route内でconversion後のReset Bonuses、最初のReset後の追加Reset / Keep、必要なReset Skillsまでを表現できる。normal scopeの巨戟に対する最初のBonus amendmentは必ずResetとし、Keepを直接適用しない。transient GogmaへのReset / Keep / Reset Skillsは `sourceOwnedWeaponId = null` で表し、fake IDまたはRoute-local IDを作らない。

### 16.2 既存巨戟アーティア経由

所持している巨戟アーティアを起点に、次の操作を組み合わせる。

- Reset Bonuses
- Keep Bonuses
- スキルのみ再付与

既存巨戟のスキルのみ再付与経路では、起点武器の復元ボーナス5枠を変更せず、Skill Prediction結果からシリーズスキルとグループスキルだけを更新する。現在のv1前提ではReset Skillsを非破壊操作として扱い、protected武器も起点にできる。実ゲーム上の追加制約が確認された場合は推測で変更せず、別途仕様変更として扱う。

経路フィルタが「すべて」の場合、利用可能な経路を比較し、推奨経路を表示する。

Keep Bonusesにユーザー選択slotはない。現在5slotのBonus familyをslotごとに保持し、同family内tierを再抽選する単一操作である。完成復元ボーナスは現在5slotを明示入力したRNG Engine Predictionから得る。同一Counter位置でselection branchを作らず、Keep depth 1、2、...の時間方向だけを探索する。

### 16.3 所持通常アーティア経由

レア8、非保護でTargetと武器種・属性が一致する所持通常アーティアを、作成操作なしで巨戟化する。BuildRouteは変換元IDを参照し、conversion後の必要なReset / Keep / Reset Skillsを同一Routeへ含められる。conversionでは通常5枠を継承して初回Skillを付与し、Skill Counter +1、Gogma Counter +0とする。Bonus Type MappingからRankまたは完成5枠を推測しない。変換後は元通常アーティアを在庫から除き、二重利用しない。

---

## 17. 検索結果

検索結果は目標武器単位で表示する。スマートフォンでは目標武器を容易に切り替えられること。

検索結果フィルタ:

- すべて
- 理想
- 実用
- 近似

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

---

## 18. 作成リスト

検索結果からPlannerに検討させる候補を作成リストへ追加できること。

BuildCandidateは検索結果、BuildListEntryはユーザーがPlannerへ渡すために選択した状態として分離する。作成リスト追加時にはCandidateのSnapshot、Target定義Hash、検索開始RNG状態Hash、Routeが参照するOwnedWeaponの状態Hash、計算時のバージョン情報をBuildListEntryへ保存する。OwnedWeaponを参照しないRouteでは参照武器Hashを `null` とする。

追加方式:

- 個別追加
- 理想候補の一括追加
- 実用候補の一括追加
- 理想候補と実用候補の一括追加

近似フィルタで表示される候補は初期版では個別追加のみ許可する。

再検索でBuildCandidateが置き換わってもBuildListEntryのSnapshotは失われない。ただしTarget条件、Candidate Route成立に使用したRNG状態、Routeが参照する起点武器・素材武器の状態、または計算バージョンとの互換性が失われたEntryはstaleとし、Planner入力に使用しない。stale理由はそれぞれ `target_definition_changed`、`rng_state_changed`、`owned_weapon_changed`、`calculation_context_changed` とする。初期版では計算に使用したRNG状態Hashが変わった場合、安全側に倒してstaleとしてよい。Routeと無関係なOwnedWeaponの変更は参照武器Hashへ含めず、Entryをstaleにしない。

作成リストに追加された候補がすべて採用されるとは限らない。PlannerはBuildListEntryを入力とし、目標の充足と全体効率を考慮して採用候補を決定する。

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
- 素材用武器、実用品、理想品の状態
- 目標優先度
- 武器消費
- 操作回数

Plannerは候補検索と分離し、作成リストに追加された候補を入力として計画を生成する。

PlannerはCandidate SnapshotのBuildRouteと具体的なRouteOperationを変更しない。
Planner独自の素材補充、素材登録、一般素材消費、Target武器確保、確認付き状態変更は
Planner-only PlanStepとして挿入する。Candidate Route内の具体的素材武器IDを別武器へ
差し替えない。

Plannerが自動判断できない局所競合では、ユーザーがBuildListEntryを選択し、その選択を
競合解決入力として再計算できる。この入力は競合箇所だけへ適用し、手動作成順固定には
使用しない。削除済み、stale、無効または実行不能な選択はwarningとして再選択を促す。

初期版の探索方式は上限付きBeam Searchとする。共有RNG状態、シミュレーション中の武器在庫、目標ごとの実用品・理想品充足状態、採用候補、操作列、累積コストを探索状態として持ち、実行可能な次操作へ展開する。完全最適解の保証より、実用的な時間内で十分良い計画を返すことを優先する。

探索中はTargetごとに「実用品未所持」「実用品所持」「理想品所持」を区別する。Practical候補の確保で実用品所持、Ideal候補の確保で実用品所持かつ理想品所持へ更新し、未所持Targetの実用品確保を先に評価する。

BuildCandidateのRouteには、通常アーティア作成、巨戟化、Reset Bonuses、Keep Bonuses、Reset Skillsなどの具体的な操作列を保持する。Plannerはこの操作列からPlanStepを再現する。

---

## 20. Plannerの優先順位

基本優先順位は次のとおりとする。

1. 未所持の実用品を早く揃える
2. 共有RNGの進行中に他の目標武器も効率よく取得する
3. 実用品の確保後に理想品へ更新する
4. 同程度なら武器消費と操作量を抑える

ユーザーによる作成順の完全固定機能は初期版では実装しない。競合など判断が必要な箇所のみユーザーに選択を求める。

---

## 21. 武器在庫管理

武器をPlanner上の資源として扱い、計画ステップごとの生成、確保、消費、状態変更を追跡する。

- 非保護の所持レア8通常アーティアは巨戟化元として使用でき、変換後は元在庫から消費する
- レア6・7通常アーティアはv1 Inventoryへ含めない
- 保護中の通常アーティアは変換元にしない
- 通常アーティアにはPractical / Ideal / Material状態を適用しない

- Material武器はゲーム操作の素材として消費できるが、その操作単独のRNG進行は未確認である。Gogma Counterを進める目的と推測して使用しない
- Keep Bonusesにより目標候補へ転用できるMaterial武器は温存を検討する
- Practical武器は原則保護する
- Ideal武器は原則保護する
- 保護された武器を素材消費、Reset Bonuses、Keep Bonusesへ使用しない
- Ideal武器取得後も旧実用品を自動的に素材化しない
- 1本の武器を同時に複数の排他的用途へ割り当てない

v1のPlannerは、同一TargetのIdeal武器を確保済み、または同一Plan内の先行Stepで確保する場合に限り、旧Practical武器を後続素材として使う確認必須の `change_owned_weapon_status` PlanStepを予定できる。このStepは自動的な素材化ではなく、実行ナビでユーザーに「素材用に変更」または「保管」を選択させる。別のPractical武器を取得したことだけを理由に、旧Practical武器の素材化を計画しない。ユーザーがOwned Weapons画面で手動変更することは許可する。

- 予定どおり素材用に変更: `status = Material`、`isProtected = false` とし、期待状態Afterと一致するためPlanをstaleにしない
- 保管: 状態と保護を維持し、Planの期待状態と異なるためstaleにして再計算を促す

Plannerが確認なしで保護を解除または素材化すること、protected武器を素材消費・Reset Bonuses・Keep Bonusesへ使用すること、保護消費のoverride設定を設けることは禁止する。Reset Skillsはこの禁止対象に含めない。

---

## 22. 素材用武器不足

作成計画上、素材用巨戟アーティアが不足する場合は補充操作を計画に含める。

補充の例:

```text
通常アーティア作成
→ 巨戟化
→ `create_material_gogma` で素材用巨戟として登録
→ 必要になった位置で素材消費
```

`create_material_gogma` は追加のゲーム内RNG操作ではなく、直前までに作成済みの巨戟アーティアを `kind = Gogma`、`status = Material`、保護OFFとしてツールのInventoryへ登録するPlanner-only PlanStepである。Plannerは後続の素材消費と結ぶOwnedWeapon IDをPlan生成時に予約してよいが、登録Step確定前にDBまたはシミュレーション在庫へ追加せず、BuildRouteへ未来武器IDを入れない。

素材補充のconversionも通常Routeと同じく初回Skillを1つ消費し、Gogma Counterは進めない。素材用途でSkill結果をTarget評価しない場合でも、実ゲーム操作のSkill進行を省略しない。

既存PracticalをMaterialへ変える `change_owned_weapon_status`、Target候補を確保する `reserve_weapon` とは役割を分離する。再計算はstale Planに対するユーザー操作であり、旧Plan内の `recalculate_plan` Stepとして表現しない。

素材アイテムそのものは初期版では厳密な所持数制約にしない。必要数または必要量のみ表示する。

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

Plannerの競合、不採用、推奨、選択の記録はBuildCandidate IDではなくBuildListEntry IDを基準に保存する。

---

## 24. 作成プラン

Plannerの結果を時系列のPlanStepとして表示する。

最低限、次の内容を確認できること。

- 作成予定武器
- 作成順
- 素材用武器の補充
- 必要素材数
- 採用候補
- 不採用候補と理由
- 競合と解決結果

通常表示ではSeedとCounterを表示しない。計画生成時の入力状態をスナップショットとして保持し、前提が変わった計画をそのまま実行できないようにする。

Plan全体の開始Snapshotは監査と再現用に保持する。加えて各PlanStepに、実行前と実行後に期待するRNG状態・通常Counter・所持武器状態、またはそれらの安定Hashを保持する。

---

## 25. 実行ナビ

作成プラン確定後、ゲーム内で行う操作を1ステップずつ案内する。

各ステップには最低限、次の内容を表示する。

- 今回行う作業
- 使用する武器
- 想定結果
- 確保対象かどうか

基本操作:

- 結果一致・次へ
- 確保
- 結果が違う

初期版では必ず1操作ずつ確認する。複数操作を一括完了する高速モードは実装しない。

---

## 26. 全体プラン確認

実行ナビ中にプラン全体を確認できること。

表示項目:

- 完了済みステップ
- 現在のステップ
- 今後のステップ
- 確保予定武器
- 素材補充予定

この画面の目的は現在地確認であり、初期版ではプラン編集を行わない。「現在の作業に戻る」操作で実行ナビへ戻れること。

---

## 27. Planner再計算

計画どおりに進行している間は再計算しない。再計算判定ではPlan開始時の可変状態と現在値を単純比較せず、現在Stepの期待状態と実際の状態を比較する。Step実行前に実際の状態が期待状態Beforeと一致し、実行後に期待状態Afterと一致する場合はPlanをstaleにしない。

Plan開始前のBuildListEntryは検索開始RNG状態との不一致でstaleになり得る。一方、Active Plan開始後の正常なRNG進行はPlanStep期待状態で検証し、BuildListEntryの検索開始状態と現在値が異なることだけを理由に進行中Planをstaleにしない。

次のように、現在Stepの期待状態または計画の不変前提と実態に差分が生じた場合に再計算する。

- 実際のRNG状態が想定と異なる
- Counterを手入力で修正した
- 目標武器または条件を変更した
- 作成リストを変更した
- 所持武器を計画外で変更した
- CalculationContextとの互換性が失われた（`calculation_context_changed`）
- 想定結果と実結果が異なる
- 予定候補を確保しなかった
- 予定とは異なる候補を確保した

実行中の計画を黙って置き換えず、再計算理由と影響をユーザーに示す。

---

## 28. 操作履歴とUndo

実行ナビの操作履歴を保存する。

保存内容:

- 対象PlanStep
- 実行操作
- 実行結果
- 想定どおりだったか
- Step実行前のUndo Snapshot
- 実行日時

ツール上で誤ってステップを進めた場合に備えてUndoを提供する。最後のExecutionHistoryだけで、そのStepが変更したRNG状態、通常アーティアCounter、OwnedWeapon、PlanStep、ProductionPlanを実行前へ正確に戻せるSnapshotを保存する。Undoはアプリ内の状態と履歴を戻すための機能であり、ゲーム内操作を巻き戻すものではないことを明示する。

---

## 29. 永続化

次のユーザーデータをIndexedDBへ保存する。

- RNG状態
- 通常アーティアCounter
- 所持武器
- 目標武器
- 作成候補
- BuildListEntry
- ProductionPlan
- ExecutionHistory
- 設定

データの関係、ID、トランザクション、不変条件は[DATA_MODEL.md](./DATA_MODEL.md)に従う。

旧RNG契約のconversion Gogma Counter、巨戟化時のbonus再抽選、Keep selectionを保存したBuildCandidate / BuildListEntry Candidate Snapshotは新契約と非互換である。推測変換せずinvalid / staleとして再検索を要求する。Target、OwnedWeapon、RngStateなど意味を維持できるデータは不用意に削除しない。ProductionPlanは本契約確定時点で永続化前のためmigration対象外とし、Dexie migration手順は次のコード実装フェーズで決定する。

Execution Navigatorの結果一致、武器確保、旧実用品の素材化確認、想定外結果記録は、RNG状態、通常アーティアCounter、OwnedWeapon、ExecutionHistory、PlanStep、ProductionPlanの関連更新を1つのDexie transactionで確定する。Undoも同じ範囲を1つのtransactionで復元する。transaction失敗時は部分更新を残さず、操作前の状態を維持する。

---

## 30. Export / Import

全ユーザーデータをJSONとしてExportおよびImportできること。

- Exportデータには必ず`schemaVersion`を含める
- Import前に形式と参照整合性を検証する
- 破損または未対応バージョンのデータを部分適用しない
- 初期版は全置換Importのみとする
- Import失敗時は既存データを維持する
- データクリアには確認を必要とする

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
6. 理想 / 実用カテゴリ、実用品の近似属性、到達距離を確認する
7. 復元ボーナス条件を満たす既存武器から、スキルのみ再付与する候補を検索できる

### 38.2 複数目標の計画生成

1. 複数目標の候補を作成リストへ追加する
2. Plannerが共有RNG、武器在庫、優先度を考慮する
3. 競合がなければ実行可能な時系列計画を生成する
4. 競合があれば理由と選択肢を表示し、選択後に再計算する
5. 保護武器が素材消費・Reset Bonuses・Keep Bonusesへ使われないことを確認する
6. Plannerの競合と不採用記録がBuildListEntry基準で追跡できる

### 38.3 実行と再同期

1. ユーザーが計画を1ステップずつ実行する
2. 想定どおりの場合は状態と履歴を更新して次へ進む
3. 想定と異なる場合は実結果を記録する
4. 差分と再計算理由を表示し、新しい計画を生成する
5. 誤って進めたアプリ内操作をUndoできる
6. 予定された旧実用品の素材化を承認するとPlanを継続できる
7. 素材化予定に対して保管を選ぶとPlanがstaleになり再計算できる
8. 最後のExecutionHistoryのSnapshotから直前Stepのアプリ内変更を完全にUndoできる
9. Step確定またはUndoの保存失敗時に部分更新が残らない

### 38.4 保存と復元

1. ブラウザを再読み込みしてもユーザーデータが復元される
2. 全データをJSONとしてExportできる
3. データクリア後に対応バージョンのJSONをImportできる
4. 不正データまたは未対応バージョンのImportが既存データを破壊しない

---

## 39. 初期版v1仕様の固定

本書および参照する詳細仕様書を、初期版実装のv1基準とする。実装中に意味変更が必要になった場合は、コードだけで吸収せず該当仕様書を更新して変更理由を記録する。

conversionのNormal +0 / Skill +1 / Gogma +0、bonus継承、初回Skillはgame-verified（実機確認済み）である。create/reset/keepのstream進行、first Reset、Keep family保持はreference-verifiedであり、本書の正式製品契約として採用するが、全weapon、attribute、game versionでgame-verifiedという意味ではない。BowのSharpness/Ammo family、LBG/HBGのElement family、elementless GogmaのElement bonus、栄光の誉れ、祝祭の巡り、Gogma rank I、Gate未満の保存Counter進行、`use_weapon_as_material` のRNG進行はunverified（未確認）のため推測固定しない。Interface、Capability、Fake Engine、Fixtureの境界を維持する。

Practical同士の優劣判定と、それに基づくPlannerからの旧Practical素材化提案は将来仕様とし、v1では実装しない。

同一Route内で新規生成した武器を後続Operationから参照するRoute内武器参照型は将来仕様とし、v1では追加しない。
