# Issue #104 Normal Route base reduction / Browser Worker benchmark

実施日: 2026-09-24。基準main: `2a560304f1b02af2310831e058cdd07c0c98f2a2`。
この文書は測定記録。意味論の正本は SEARCH_SPEC 6.1.2 / RNG_SPEC 6・7。

> 以下の既存測定節は **first reduction**（PR #105 head `f9b2189`）のhistorical record。
> 最新の挙動・追加測定・default判断は末尾「family compatibility filter追加後」を参照。

## 実装と同値性（first reduction）

新規predicted Normalのoffset 0だけが従来のfull Reset/Keep streamを使う。
後続offsetはordered family layoutの初出だけをKeep-only streamへ登録する。
Reset後の未来は初期5枠に依存せず、Keep未来はordered family layoutだけで決まる。
Normal forgeはSkill/Gogmaを進めず、conversionは最後の1本だけなので、同じ未来の
後方Normalはforge差だけ総操作数で厳密に劣後する。後続のadvance / preferred source /
stable-key比較へ進まない。異なるlayoutで少ないGogma操作により勝つ後方Normalは残す。

最初のbaseのfull frontierを残すため、同costのcanonical Reset/Keep履歴は変更しない。
後続Keep-onlyが旧frontierのReset代表との合流後もKeep履歴を辿る場合、その結果には
offset 0のReset由来の厳密に安い対応物がある。normal scopeは5/5同名でもIdealではない。
Normal予測は従来のlowerBoundによる遅延cursorを保ち、上限まで先読みしない。

`normalRouteReduction.test.ts` と `normalRouteReductionBenchmarkFixtures.test.ts` は
テスト専用の旧per-offset全登録oracle（`src/test/fixtures/normalRouteReduction.ts`）と
canonical Candidate全体を比較する。Route、全cost、scope、予測trace、lane別intermediate
state、hashも同じである。Reset-only、Keep-only、Reset→Keep、Skill reset、深いSkill、
no-Ideal、同layout・異tier・Normal側family名・異slot順、同操作数でGogma advanceが勝つ後方Normal、
preferred source / stable tie、近傍Ideal、cancel / progressを固定した。
既存の所持Normal、所持Gogma、blind、constrained enumeratorの経路は従来どおりである。

## 環境と方法

- Windows、AMD Ryzen 7 9700X、16 logical processors
- 実Chrome **153.0.8010.49**、専用headless profile、`visibilityState = visible`
- Node **24.19.0** はbuild・CDP制御・構造回数取得のみ。Node時間をBrowser実測に使わない
- Vite **8.3.0** のproduction bundle。既存 `createProductionSearchWorkerClient()` と
  production Worker entry/controller/ProductionRngEngineをそのまま使用
- Worker cancel/pingのみ既存 `benchmark_seam` を使う。production protocolは変更なし
- throughputはclient `startSearch()` 呼出からresolveまでの主スレッド時間。
  warm-up 1回＋measurement 3回、表はmeasurement中央値（ms）
- 1回15秒のwatchdogでcancel/dispose。中止は完走と区別し、完走時刻やparityを捏造しない
- before bundleは基準mainの `normalArtianRouteSearch.ts` をWorkerのbuild入口で差し込み、
  同一fixture・同一RNG・同一Worker yield・同一上限で比較した。
  Bonus streamの追加policyは未指定（従来full探索）で、beforeには縮約が適用されない
- 計測前の接続/ページ遷移が完了しないCDP試行は除外し、専用Browserを再起動した。
  他アプリの負荷を完全には隔離していない。特に境界付近の時間は機種・負荷依存

固定入力はB5と同じBase Seed `51231782`、Bow/Fire、Normal 0、Gogma 200、Skill 341。
Gogma開始点はsyntheticで、実機観測の主張はしない。新presetはhistorical B5を変更しない。

- near Ideal: 最初のReset Bonusとconversion Skill。canonical cost **3**
- deep Skill: 最初のReset BonusとSkill Counter **1425** の組
  (`series_skill.verified_21`, `group_skill.verified_08`)。最初の一致は起点から**1084**先、
  conversion後のReset Skills 1084回、canonical cost **1087**。
  全0..1083位置の不一致とSkill上限1000で未達・1500で到達をテストした。
  ユーザーの「約1083回先」の実例そのものを再現したとの主張ではない
- no-Ideal: historical B5と同じ到達不能Bonus rank / Group Skillのsynthetic Target。
  ユーザー入力用Master validationを通るTargetという主張はしない

## Normal sweep（前後とも完走する比較）

deep Skill、Gogma **20** / Skill **1500** 固定。

| Normal | before ms | after ms | canonical cost |
| ---: | ---: | ---: | ---: |
| 1 | 161.2 | 181.9 | 1087 |
| 100 | 540.2 | 242.9 | 1087 |
| 500 | 993.8 | 409.5 | 1087 |
| 1000 | 1169.9 | 547.8 | 1087 |

全16個の完走before run（warm-up含む）と対応afterのCandidate bodyを、`createdAt`だけを
除いて比較して一致。Normal 1は削減対象がないため改善を主張しない。

同一入力の構造回数（Nodeテスト、時間は不使用）。`bonusStates`は各channelの新depthで
返された、retention前のBonus状態数。settledはqueue項目数であり、内部状態数ではない。

| Normal prediction (前後同数) | unique layout | Normal base 前→後 | Bonus channel 前/後 | Bonus状態評価 前→後 | checkpoint呼出 前→後 | settled work 前/後 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 1→1 | 1 | 205→205 | 2398→2398 | 1107 |
| 100 | 76 | 100→76 | 76 | 15515→1705 | 19307→5497 | 2706 |
| 500 | 202 | 500→202 | 202 | 41298→4225 | 48010→10937 | 5626 |
| 1000 | 227 | 1000→227 | 227 | 46397→4725 | 54109→12437 | 6626 |

全行でSkill channel=1、実際にsettleしたCandidate composition=1、最初のIdeal cost=1087、
その後のcanonical tie drain=1 work（前後同数）。settled workとcompositionはこのfixtureでは
減っていない。cost境界が後方baseのcompositionを既に止めていたからである。
主な削減は、Normal base購読と、各layout channelが重複して行っていたReset由来の状態評価。
Normal1000ではbase **77.3%減**、Bonus状態評価 **89.8%減**。
同一layoutが反復するFake fixtureではNormal1000でもbaseは2以内で、削除前よりcompositionが
減るケースもテストする。layout種類が増える入力のKeep探索そのものは残る。

## 大きい範囲とdefault候補

Skill **1500**固定、deep SkillのNormal sweep（Gogma **200**）。

| Normal | before ms | after ms | after settled work |
| ---: | ---: | ---: | ---: |
| 1 | 1292.6 | 1131.6 | 1287 |
| 100 | >15000、中止 | 2460.6 | 16386 |
| 500 | >15000、中止 | 3582.1 | 41986 |
| 1000 | >15000、中止 | 4455.5 | 47486 |

Normal **500** / Skill **1500**、no-Ideal。

| Gogma | before | after measurement | after settled work |
| ---: | --- | --- | ---: |
| 200 | 15秒で中止 | 中央値3709.2ms、3/3完走 | 42400 |
| 350 | 15秒で中止 | 中央値9109.9ms、3/3完走 | 72700 |
| 500 | 15秒で中止 | 13515.9ms / 13573.7ms / 15秒で中止 | 完走時103000 |

Gogma500のwarm-upは14757.3msで完走したが、measurementの1/3がwatchdogに達した。
完走2試行だけの中央値を、3試行の通常中央値と同等には扱わない。

**500 / 350 / 1500** のdeep Skillはbeforeが15秒で中止、after中央値 **9090.9ms**
（3/3完走、72286 work、cost1087）。near Idealはbefore **17.1ms** → after **15.4ms**
（4 work、cost3）。近傍IdealのNormal predictionはテストで2件と固定し、500件を先読みしない。

大範囲で中止したbeforeについては最終CandidateのBrowser parityは未測定。
完走したthroughputのbefore 8 run（warm-up含む）は、対応afterと`createdAt`以外の
Candidate bodyが一致。追加のG20完走比較とProduction/Fake oracleテストが同値性を補う。
no-Idealのafterは全完走runでCandidate=null、partial結果を成功と扱わない。

## cancelとWorker responsiveness

500 / 350 / 1500、benchmark_seam。主スレッドの同じclockで送信→観測message受信を測る。
50ms間隔のping。cancel後150ms観測してからdispose。

| scenario / cancel時点 | Promise拒否 ms | Worker cancel受信 ms | Worker停止 ms | ping最大 ms | cancel後progress |
| --- | ---: | ---: | ---: | ---: | ---: |
| no-Ideal / 100ms | 0.2 | 1.5 | 1.6 | 0.3 | 0 |
| deep Skill / 100ms | 0.0 | 0.7 | 1.0 | 0.9 | 0 |
| no-Ideal / 2000ms | 0.1 | 0.8 | 1.0 | 4.7 | 0 |
| deep Skill / 2000ms | 0.0 | 1.2 | 1.5 | 7.8 | 0 |

2秒試行はそれぞれ15300 workまで進み、39 pingすべてに応答。Workerが計算途中で
macrotaskへ戻り、cancelを処理して停止したことを確認した。
これは全探索中の最大pauseや実デバイスのUI frame latencyを保証する測定ではない。

## defaultの決定と限界

**Normal 500 / Gogma 350 / Skill 1500** を採用。

- Normal: 1000までの先読みを既定とせず500を基本範囲にする。重複baseの増加を抑制
- Skill: 1000超のIdealを含める。今回の固定fixtureでも1000では未達、1500で到達
- Gogma: 200不足という実使用要件を満たすため350へ増加。約9秒のno-Ideal / deep-caseは
  軽快とは言えないが全試行で完走し、進捗・cancel・Worker応答が機能した。
  500は約13～15秒以上でwatchdogにも達したため既定値として採用しない

未測定: モバイル/低性能PC/Firefox/Safari、実際のUI frame応答・memory peak、
15秒で中止したbeforeの完走時間・結果、Gogma500の中止試行の真の完走時間。
UI layout、Planner #101/#102/#103、schema、RNG algorithm/versionは変更しない。
既存normal-scope Keepの実機確認範囲を拡張する変更でもない。

## 再実行

既存benchmark harnessに独立した `issue104_*` presetを追加した。B5 presetは不変。

```sh
npx vite build --config vite.benchmark.config.ts
npx vite preview --config vite.benchmark.config.ts --port 4173
```

`/GogmaArtianPlanner/benchmark.html` のCandidate Search benchmarkを選び、
`#104` presetを実行する。console APIも従来どおり `globalThis.b5Benchmark`。
安全上限付きの例（各caseでwarm-up 1回、その後measurementを3回）:

```js
await b5Benchmark.run({
  workloadId: 'issue104_no_ideal_gogma_350',
  mode: 'production', phase: 'measurement', cancelAfterMs: 15000,
})
await b5Benchmark.run({
  workloadId: 'issue104_deep_skill_default',
  mode: 'benchmark_seam', phase: 'cancel', cancelAfterMs: 2000, pingIntervalMs: 50,
})
```

構造回数はテスト用 `measureNormalRouteSearch(input, new ProductionRngEngine(), reduced)`
の`metrics`で再取得できる。`reduced=false`は旧per-offset oracle、trueは実装。
G20比較には `createNormalRouteReductionBenchmarkInput('deep_skill',
{maxNormalAdvance:N,maxGogmaAdvance:20,maxSkillAdvance:1500})` を渡す。
本番UI、Worker protocol、計算結果にdiagnostic fieldやdebug switchは追加していない。

## family compatibility filter追加後（2026-09-24）

### 変更と同値性

後続Normal（offset > 0）は、まずTarget Idealと同じ**unordered Keep-family multiset**を
持つか判定する。互換なものだけをordered layoutで重複排除し、最初の1本をKeep-only
baseへ登録する。`keepFamilyMultisetKey()` は既存 `keepFamilyLayout()` の結果をsortする
だけで、Normal / Gogma typeおよびSharpness / Capacityのmany-to-one mappingは同じ
Master authorityを使う。familyの個数が同じでもslot順が違えば別channelとして残す。

Keepは各slotのfamilyを変えないため、不互換baseのKeep-only結果はどのSkill位置でも
Idealにならない。Reset経由の結果はoffset 0が既に厳密に安く代表する。offset 0には
互換filterを適用せず、full Reset/Keep frontierを維持する。既存のcanonical比較、
normal scope、RNG algorithm/version、schema、Planner constrained enumerationは変更しない。

pre-#104のper-offset full-registration oracleは変更していない。追加テストは不互換Normal
100本でもReset-only / Reset→Keep / 深いSkillのCandidate全体が一致すること、no-Ideal、
A A A S S と S A S A A の両layout保持、tier / mapped-type重複の最小forge代表を固定する。
従来の後方Normalが同操作数からGogma advanceで勝つテストも維持。
Production fixtureはNormal100 / 500（Gogma8 / Skill1500）の3シナリオで旧oracleと完全一致。

### 実Browser Worker再測定

同じWindows / Ryzen 7 9700X / 16 logical processors、Chrome **153.0.8010.49**。
専用headless ChromeをCDPで操作し、production buildの実Workerを実行。
production Worker bundleは `search.worker.entry-Cvu7bVvD.js`。
各caseはwarm-up 1回 + measurement 3回、15秒watchdog。全48 run完走。
NodeはCDP制御と構造回数の計測にだけ使い、Node時間を以下のBrowser時間に含めない。
first reduction列は上記historical測定であり、同時刻に取り直した対照群ではない。

Normal500 / Skill1500、Browser elapsed中央値（ms）:

| scenario | Gogma | first reduction | family filter後 | settled work（filter後） |
| --- | ---: | ---: | ---: | ---: |
| deep Skill | 200 | 3582.1 | 1388.5 | 5586 |
| deep Skill | 350 | 9090.9 | 3758.5 | 8586 |
| deep Skill | 500 | 未測定 | 6898.9 | 11586 |
| no-Ideal | 200 | 3709.2 | 1769.4 | 6000 |
| no-Ideal | 350 | 9109.9 | 3820.4 | 9000 |
| no-Ideal | 500 | 13515.9 / 13573.7 / 15秒中止 | 7217.9 | 12000 |
| near Ideal | 200 | 未測定 | 14.8 | 4 |
| near Ideal | 350 | 15.4 | 15.6 | 4 |
| near Ideal | 500 | 未測定 | 14.6 | 4 |

すべてのdeep Skillはcost1087、near Idealはcost3、no-IdealはCandidate=null。
対応するhistorical first-reduction完走結果がある24 runで、createdAtを除くCandidate bodyが
一致。今回の大範囲Browser比較はfirst reductionとの比較であり、旧pre-#104 oracleとの
同値性は前述のFake / Productionテストで別に固定する。

### 構造回数（Production fixture）

Gogma350 / Skill1500、deep Skill。回数はテストhelperのinstrumentation、時間は上記と
同じBrowser計測。family互換本数は実際に予測したNormal内の本数で、offset 0も含めて数える。
unique layoutは全予測内 / 互換予測内を区別する。offset 0はこのfixtureでは不互換なので、
登録base数は互換unique layout + 1。

| Normal上限 | 予測本数 | family互換本数 | 全unique layout | 互換unique layout | 登録base / Bonus channel | Bonus状態評価 | settled work | Browser ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 1 | 0 | 1 | 38289 | 1437 | 3208.2 |
| 100 | 100 | 11 | 76 | 9 | 10 | 41439 | 4686 | 3584.6 |
| 500 | 500 | 52 | 202 | 19 | 20 | 44939 | 8586 | 3758.5 |
| 1000 | 1000 | 102 | 227 | 19 | 20 | 44939 | 9086 | 3834.0 |

Normal500 / Gogma350 / Skill1500について、`f9b2189`のNormal登録処理を同じ測定helperへ
差し替えて構造回数も再取得した（本番debug switchなし）。

| metric | first reduction | family filter後 |
| --- | ---: | ---: |
| Normal予測本数 | 500 | 500 |
| family互換本数 / 互換unique layout | 52 / 19 | 52 / 19 |
| 全unique layout | 202 | 202 |
| Normal base / Bonus channel | 202 / 202 | 20 / 20 |
| Bonus状態評価（deep / no-Ideal共通） | 108639 | 44939 |
| settled work（deep Skill） | 72286 | 8586 |
| settled work（no-Ideal） | 72700 | 9000 |
| Skill channel | 1 | 1 |
| composition（deep / no-Ideal） | 1 / 0 | 1 / 0 |
| Ideal cost / tie drain（deep） | 1087 / 1 | 1087 / 1 |

base / channelは90.1%、Bonus状態評価は58.6%、deepのsettled workは88.1%削減。
near Idealは前後ともNormal予測2、family互換0、全unique2、Bonus状態評価2、settled4。
登録baseだけ2→1となり、初回baseのResetで完了する。500本の先読みはしない。

### cancel / responsiveness再確認

benchmark_seam、50msごとping。主スレッドでcancel送信から観測message受信までを計測し、
cancel後150msのprogressも確認した。各セルは no-Ideal / deep Skill の順。

| Gogma / cancel時点 | Promise拒否 ms | Worker cancel受信 ms | Worker停止 ms | ping最大 ms | cancel後progress |
| --- | --- | --- | --- | --- | --- |
| 350 / 100ms | 0.1 / 0.1 | 1.4 / 1.9 | 1.5 / 2.1 | 1.3 / 0.2 | 0 / 0 |
| 500 / 100ms | 0.0 / 0.1 | 0.3 / 1.4 | 0.6 / 1.6 | 0.7 / 0.7 | 0 / 0 |
| 350 / 2000ms | 0.1 / 0.1 | 1.7 / 2.4 | 2.0 / 2.6 | 5.5 / 6.4 | 0 / 0 |
| 500 / 2000ms | 0.1 / 0.0 | 0.9 / 2.5 | 0.9 / 2.9 | 10.3 / 5.1 | 0 / 0 |

2秒試行は3400〜3500 workまで進み、各39 pingに応答。Worker応答不能やcancel後のprogressを
観測しなかった。全探索中の最大pauseやUI frame latencyを保証する数値ではない。

### 最終defaultと再実行

**Normal500 / Gogma350 / Skill1500を維持する。** 350の重いfixtureは約3.8秒まで改善。
500も全試行完走し、cancelも応答するため選択肢になるが、約6.9〜7.2秒と350の約1.8倍で、
低性能端末は未測定。既定値を500へ自動的に増やさず、350を採用する。
最初のfull Reset/Keep frontierの深さ依存コストは残る（Normal1でもGogma350は約3.2秒）。

上記の再実行方法を使い、`issue104_{deep_skill,no_ideal,near_ideal}_gogma_{200,350,500}`
を選択する。historical B5 presetは変更しない。Normal sweepのGogma350はfactoryに
`{maxNormalAdvance:N,maxGogmaAdvance:350,maxSkillAdvance:1500}`を渡して実行した。
構造計測helperは `familyCompatibleNormals` / `compatibleUniqueLayouts` を追加済み。
未測定範囲（モバイル / 低性能端末、Firefox / Safari、memory peak、UI frame応答）は従来どおり。
