# B5 Candidate Search Browser Worker Benchmark

実施日: 2026-09-05 / 2026-09-06

## Status

- B5 実Browser Worker性能検証: 完了
- checkpoint / yield見直し: 実測後に **yield機構のみ** を変更（8章）
- 基準commit: `4146040 B4 Candidate Searchの初期探索終了制御を実装`

この計測と変更は `PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2` と
`supportsSeedSearch = false` を変更していない。Candidate Searchのstream独立性、
Cross規則、B4 schedulerのlowerBound semantics、Practical horizon、
stream-local retention、family-layout frontier dedup、resultFilterの非関与も
変更していない。変更したのはWorker内checkpointがevent loopへ戻る手段だけである。

この文書は実測記録であり、仕様authorityではない。

---

## 1. 実施環境

| 項目 | 値 |
| --- | --- |
| Browser | Chromium 148.0.7778.280（Claude Desktop内蔵Browser pane、`Claude/1.46388.4`） |
| OS | Windows 11 Pro 10.0.26200 |
| `navigator.hardwareConcurrency` | 16 |
| Production RNG version | `production-rng:c5-e2` |
| `performance.memory` | 利用可能 |
| `document.visibilityState` | **`hidden`**（4章の制約） |
| build | `vite build --config vite.benchmark.config.ts` |
| serve | `vite preview --config vite.benchmark.config.ts --port 4173` |
| URL | `http://localhost:4173/GogmaArtianPlanner/benchmark.html` |

Node側の構造計測（checkpoint / yield回数）は `vitest` / jsdom、同一PCで実施した。
Node計測はBrowser性能の根拠ではなく、回数という構造的事実の取得にのみ使用する。

---

## 2. Harness

C5-E2C8の `benchmark.html` / `src/benchmark.tsx` / `vite.benchmark.config.ts` を
再利用し、`src/pages/BenchmarkApp.tsx` で C8 Skill Identification harness と
B5 Candidate Search harness を切り替える。既定はC8のままで、C8の入力・手順・
Worker policyは変更していない。通常アプリからはどちらも到達できない。

| ファイル | 役割 |
| --- | --- |
| `src/benchmarks/candidateSearchBenchmarkFixtures.ts` | 決定的workload / `CandidateSearchInput` 生成 |
| `src/benchmarks/candidateSearchBenchmarkProtocol.ts` | benchmark専用観測message |
| `src/benchmarks/candidateSearchBrowserBenchmark.ts` | Worker harnessとWorker error probe |
| `src/workers/search.worker.benchmark.entry.ts` | benchmark専用Worker entry |
| `src/pages/CandidateSearchBenchmarkPage.tsx` | 計測UIと `globalThis.b5Benchmark` |

### 2.1 Worker経路

| mode | 内容 |
| --- | --- |
| `production` | `createProductionSearchWorkerClient()` をそのまま使用。**elapsedの根拠はすべてこの経路** |
| `benchmark_seam` | 同じ `createSearchWorkerController` と `ProductionRngEngine` を別entryで構成し、観測messageを追加。cancelとWorker responsivenessの観測にのみ使用 |

観測messageは予約 `requestId` `__b5_candidate_search_benchmark__` を使う。
Production `SearchWorkerClient` は該当pendingを持たないため無視する。
Production Worker protocolは変更していない。

---

## 3. Fixture / workload

固定入力（`weapon.bow` / `element.fire`）。Bowの通常アーティアpoolはgame-verified、
SkillとGogma ResetもProduction supportedである。

| 項目 | 値 |
| --- | --- |
| Base Seed | `51231782`（C5-E2C9のlive read値、source `observation`） |
| Normal Counter | 0（`weapon.bow:8`、confirmed） |
| Skill Counter | 341（C5-E2C9のlive read値、source `observation`） |
| Gogma Counter | 200（benchmark用のsynthetic開始点。source `manual`、実観測値ではない） |
| Counter Gate | `null` / unconfirmed（legacy fieldとして未使用） |
| owned weapons | `skill_depth_8_default_bounds` のみ合成した所持巨戟1本。他は空（`routeFilter = 'all'`） |
| Practical条件 | `bonus_type.attack` >= `bonus_rank.base` を1枠以上 |
| Practical Skill条件 | 無制約 |

Idealはstreamごとに指定する。到達可能なIdealはEngineから読み戻し、到達不能な
Idealは推測ではなく次の理由で到達不能である。

- Bonus: `bonus_type.attack` / `bonus_rank.i` は `REFERENCE_GOGMA_RESET_CANDIDATES`
  に存在せず、Normal結果は常に `bonus_rank.base` である
- Skill: `group_skill.verified_14` はMasterでは有効だが
  `REFERENCE_GROUP_SKILL_POOL` に無く、`predictSkills` は返さない

全workloadで `validateTargetIdealImpliesPractical()` を生成時に検証している
（`src/benchmarks/candidateSearchBenchmarkFixtures.test.ts`）。

SEARCH_SPEC 5.1 はIdealの5枠完全一致に `finalBonusScope = "gogma_artian"` を
要求する。巨戟化しただけのCandidateは `normal_artian` scopeのままなので、
到達可能なIdealのbonus anchorに巨戟化出力は使わない（9.2章）。使うのは次の2つ
だけであり、型 `BenchmarkIdealBonuses` は巨戟化出力をanchorとして表現できない。

- Reset Bonuses結果（Gogma Counter `start + depth - 1`）
- 所持巨戟起点の現在5枠（`gogma_artian` scope）

| workload | Ideal Bonus anchor | Ideal Skill anchor | 起点 | bounds N/G/S | 期待 |
| --- | --- | --- | --- | --- | --- |
| `near_ideal_default_bounds` | Reset深さ1 | 巨戟化時Skill | Normal | 5000/5000/5000 | D = 3 (`normal_artian_to_gogma`) |
| `skill_depth_8_default_bounds` | 所持巨戟の現在5枠 | Reset Skills深さ8 | 所持巨戟 | 5000/5000/5000 | D = 8 (`existing_gogma_reset_skills`) |
| `bonus_depth_8_default_bounds` | Reset深さ8 | 巨戟化時Skill | Normal | 5000/5000/5000 | D = 10 (`normal_artian_to_gogma`) |
| `no_ideal_gogma_{10,25,50,100,200}` | 到達不能 | 到達不能 | Normal | 1/N/1 | Gogma streamのexhaust |
| `no_ideal_skill_{10,100,1000,5000}` | 到達不能 | 到達不能 | Normal | 1/1/N | Skill streamのexhaust |
| `no_ideal_normal_{10,100,1000,5000}` | 到達不能 | 到達不能 | Normal | N/1/1 | Normal offsetのexhaust |
| `no_ideal_default_bounds` | 到達不能 | 到達不能 | Normal | 5000/5000/5000 | 既定値そのまま。完走観測用ではない |

`skill_depth_8_default_bounds` だけが所持武器を持つ。合成した所持巨戟は、5枠が
Production Reset結果（したがって `gogma_artian` scopeで全枠が参照Keep family
member）、SkillもProduction予測値で、いずれも開始Counterから十分離れた位置から
取っている。現在5枠がそのままIdealなのでBonus streamは深さ0で停止し、
Skill streamだけが探索される。Ideal Skillは Reset Skills 深さ8（Skill Counter
348）で初めて一致し、深さ0〜7では一致しない（fixture testで固定）。
他のworkloadの所持武器は空で、入力はこの変更前と同一である。

---

## 4. 測定方法と、この環境で測定できなかったもの

計測は2セッションに分かれる。**セッションA**は全workloadの初回計測と、
入力を変更していないworkloadのbefore / after（5.2 / 6 / 8.2章）。
**セッションB**は、SEARCH_SPEC 5.1 準拠のためfixtureを差し替えた
`near_ideal_default_bounds` と `skill_depth_8_default_bounds` の再測定
（6.1 / 8.2.1章）。セッションBはPCの負荷が高く、入力不変の対照workloadでも
セッションAの約2.6倍の時間がかかった。**セッションをまたいだ絶対値の比較は
しないこと。** before / afterはいずれも同一セッション内の連続実行である。

各workloadで warm-up 1回 + measurement 3回（セッションBは5回）。`elapsed` は
`startSearch()` からPromise settleまでの主スレッド実測、`search elapsed` は
`CandidateSearchResult.elapsedMs`（Worker内計測）。表は中央値を使う。

**測定できなかった項目: requestAnimationFrame responsiveness。**
Browser paneのページは前面表示中でも `document.visibilityState === 'hidden'`
であり、`requestAnimationFrame` は1度も発火しなかった（全runで frame count = 0）。
連鎖する主スレッド `setTimeout` も約1回/秒へthrottleされる。したがって
C5-E2C8と同じ形式のframe intervalは**未測定**である。成功扱いにはしない。

代替として、Workerのevent loopそのものを観測した。

- benchmark seamのping round-trip（主スレッド送信 → Worker応答受信）
- cancel messageをWorkerが処理するまで / Workerが計算を止めるまで
- cancel後にclient-visibleなprogress callbackが呼ばれるか

Workerのtimerはthrottleされていない（Browser実測値がNode実測値と同水準）。

---

## 5. Baseline（変更前）計測

`workerYield()` は `setTimeout(resolve, 0)`、checkpoint 50回ごとにyield。

### 5.1 Node側の構造的回数

Browserの時間ではなく回数の事実。`shouldCancel` はyieldするcheckpointで2回
呼ばれるため、checkpoint数はおよそ「呼び出し数 − yield数」である。

| workload | `shouldCancel` 呼び出し | yield（`setTimeout(0)`）回数 |
| --- | ---: | ---: |
| `near_ideal_default_bounds` | 11 | 1 |
| `skill_depth_8_default_bounds` | 209 | 5 |
| `bonus_depth_8_default_bounds` | 218 | 5 |
| `no_ideal_gogma_25` | 613 | 13 |
| `no_ideal_gogma_50` | 1,809 | 36 |
| `no_ideal_gogma_100` | 5,466 | 108 |
| `no_ideal_normal_1000` | 6,841 | 135 |
| `no_ideal_skill_5000` | 10,805 | 212 |

yieldは数十〜数百回しか起きず、1回あたりの固定コストが支配的になりうる形である。

### 5.2 Browser baseline（`production` mode、search elapsed中央値）

`near_ideal_default_bounds` と `skill_depth_8_default_bounds` は後にfixtureを
差し替えたため（9.2章）、この表と6章・8.2章には旧fixtureの数値を残していない。
両者の再測定はセッションBで行い、6.1章と8.2.1章に分けて記録する。

| workload | 3回 (ms) | 中央値 (ms) | candidates | Ideal |
| --- | --- | ---: | ---: | ---: |
| `bonus_depth_8_default_bounds` | 23.8 / 25.1 / 23.6 | 23.8 | 14 | 1 (D=10) |
| `no_ideal_gogma_25` | 130.9 / 125.3 / 126.3 | 126.3 | 41 | 0 |
| `no_ideal_gogma_50` | 454.2 / 450.1 / 441.3 | 450.1 | 62 | 0 |
| `no_ideal_gogma_100` | 1224.4 / 1262.2 / 1179.4 | 1224.4 | 83 | 0 |
| `no_ideal_skill_1000` | 548.2 / 551.0 / 547.4 | 548.2 | 200 | 0 |
| `no_ideal_normal_1000` | 894.7 / 907.2 / 887.0 | 894.7 | 32 | 0 |

同一baseline codeでも別セッションでは15〜25%遅い値が出た（例:
`no_ideal_gogma_100` 1513 ms）。したがってbefore / afterの比較は
**同一セッションの連続実行**（8章）だけを使用する。

### 5.3 Baseline responsiveness / cancellation（`benchmark_seam`）

| 条件 | cancel要求時刻 (ms) | Promise reject (ms) | Worker ack (ms) | Worker停止 (ms) | cancel後client progress | ping数 | 最大ping (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| default bounds / ping 100 ms | 1095.7 | 0.2 | 3.3 | 6.8 | 0 | 2 | 32.7 |
| default bounds / ping連続 | 2734.0 | 1.4 | 6.6 | 11.2 | 0 | 76,548 | 52.0 |
| `no_ideal_gogma_200` / ping連続 | 1004.3 | 0.5 | 1.5 | 1.9 | 0 | 68,138 | 29.3 |
| `no_ideal_normal_5000` / ping連続 | 1990.9 | 0.3 | 1.0 | 1.4 | 0 | 28,581 | 20.7 |
| default bounds / 60秒後 | 60670.2 | 0.2 | 5.6 | 10.7 | 0 | 63 | 86.4 |

各列が何を測っているかは次のとおりである。混同しないこと。

- **Promise reject**: client側のローカルrejectまで。`SearchWorkerClient.cancelSearch()`
  はcancel messageを送る前にpendingを削除してrejectするため、これはWorkerが
  停止した証拠ではない
- **Worker ack**: Workerのevent loopがcancel messageを処理したという、
  benchmark seamのWorker発observationの到達時刻。主スレッド時計で往復を含む
- **Worker停止**: 同じくWorker発observationで、`handleMessage()` が解決した時刻。
  検索計算が実際に止まったことを示す
- **cancel後client progress**: `startSearch()` の `onProgress` callbackが
  cancel要求後に何回呼ばれたか。`cancelSearch()` がpendingを先に削除するため、
  これはclientから見える範囲の値であり、**Workerが送出したraw response message
  そのものを数えた値ではない**。raw Worker response messageはinstrumentしていない
  （現行のProduction controllerはcancel後にprogress / resultをpostしない実装だが、
  B5はそれをmessage単位では計測していない）

baselineでもcancel応答は数ms〜十数msであり、responsivenessに明確な問題は無い。

---

## 6. Workload特性（採用版build、search elapsed中央値）

セッションAの測定である。fixtureを差し替えた2件はここに含めず6.1章へ分ける。

| workload | bounds N/G/S | 中央値 (ms) | candidates | Ideal | truncated |
| --- | --- | ---: | ---: | ---: | --- |
| `bonus_depth_8_default_bounds` | 5000/5000/5000 | 25.3 | 14 | 1 (D=10) | false |
| `no_ideal_gogma_10` | 1/10/1 | 17.6 | 15 | 0 | false |
| `no_ideal_gogma_25` | 1/25/1 | 93.3 | 41 | 0 | false |
| `no_ideal_gogma_50` | 1/50/1 | 286.9 | 62 | 0 | false |
| `no_ideal_gogma_100` | 1/100/1 | 644.3 | 83 | 0 | false |
| `no_ideal_gogma_200` | 1/200/1 | 1960.8 | 91 | 0 | false |
| `no_ideal_skill_100` | 1/1/100 | 33.0 | 85 | 0 | false |
| `no_ideal_skill_1000` | 1/1/1000 | 325.2 | 200 | 0 | true |
| `no_ideal_skill_5000` | 1/1/5000 | 1420.5 | 200 | 0 | true |
| `no_ideal_normal_100` | 100/1/1 | 37.6 | 32 | 0 | false |
| `no_ideal_normal_1000` | 1000/1/1 | 255.9 | 32 | 0 | false |
| `no_ideal_normal_5000` | 5000/1/1 | 2223.2 | 32 | 0 | false |

### 6.1 差し替えたfixtureの再測定（セッションB、採用版build）

warm-up 1回 + measurement 5回、search elapsed。**セッションBはPCの負荷が高く、
入力を変更していない `bonus_depth_8_default_bounds` の中央値が
セッションAの25.3 msに対し66.7 msだった。したがってセッションBの絶対値を
セッションAの表と直接比較してはならない。**

| workload | 5回 (ms) | 中央値 (ms) | candidates | Ideal | scope | route kind |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `near_ideal_default_bounds` | 11.1 / 8.5 / 6.8 / 6.8 / 12.9 | 8.5 | 3 | 1 (D=3) | `gogma_artian` | `normal_artian_to_gogma` |
| `skill_depth_8_default_bounds` | 49.8 / 50.1 / 56.1 / 53.1 / 56.6 | 53.1 | 36 | 1 (D=8) | `gogma_artian` | `existing_gogma_reset_skills` |
| `bonus_depth_8_default_bounds`（対照、入力不変） | 66.7 / 66.5 / 44.1 / 75.5 / 80.1 | 66.7 | 14 | 1 (D=10) | `gogma_artian` | `normal_artian_to_gogma` |

対照の `bonus_depth_8_default_bounds` はセッションA / Bともset parity keyが
`678f333c:33383` で一致しており、入力が変わっていないことを確認している。

観測できる形。

- 近いIdealがあるとB4の終了制御が効き、既定bounds 5000/5000/5000 のままでも
  数ms〜数十msで終わる。boundsそのものは近傍解の速度を悪化させていない
- Skill / Normalは単独ではboundにほぼ比例する
- Gogmaはboundに対して超線形（10 → 200 で約111倍、指数およそ1.6）
- Skill 5000は候補上限200に達して `truncated`、Normalは100以上で保持集合が
  飽和し、100 / 1000 / 5000 で同一の保持集合になる

`no_ideal_default_bounds`（既定値のまま、近傍にIdealが無い場合）は
**60秒経過時点で完了しなかった**（変更前 60.7秒、採用版 60.2秒でcancel）。
これ以上の外挿は行っていない。100M相当の推定値も出していない。

---

## 7. Result parity / determinism

各runでは `BuildCandidate.id` / `searchRunId` / `createdAt` を除いた内容で
2種類のkeyを取った。

- ordered parity: 出力順を含む
- set parity: 保持集合のみ（順不同）

結果。

- **set parityは全workload・全runで一致した**（変更前後でも一致、8章）
- **ordered parityは一部workloadでrunごとに変わった**
  （`no_ideal_gogma_*` で3 run中3種類、`skill_depth_8_default_bounds` で2種類）

原因は特定済みで、性能とは無関係である。`sortCandidates()` が使う
`compareCandidates()` の最終tie-breakが `compareStableKeys(left.id, right.id)`
であり、`BuildCandidate.id` の `semanticHash` は `searchRunId` を含む。
`compareDuplicateCandidates()` も同じくidをtie-breakに使う。
B4が導入した `candidateStableKey` は `compareCanonicalIdeals()` と
`compareCandidateSelection()` にのみ入っており、最終出力順には入っていない。

Node（jsdom）でも同一inputの3 runで保持集合は完全一致し、順序だけが変わることを
確認した。canonical Idealと保持集合はrun非依存であり、B4の契約は保たれている。
影響範囲は「同じ検索を2回実行したときの表示順が変わりうる」ことである。

これは性能変更ではなくCandidate出力順のsemanticsに関わるため、B5では修正せず
9章のFindingとして残す。

---

## 8. checkpoint / yieldの判断と変更

### 8.1 判断

- **checkpoint間隔（50回ごと）は変更しない。** yield間のsynchronous区間は
  実測で最大20〜50 msに収まり、cancelはbaselineでも数ms〜十数msで届いていた。
  経過時間ベースへ変える必要を示す測定結果は出なかった
- **yieldの手段だけを変更した。** `setTimeout(resolve, 0)` の最小clampが
  大きいworkloadで支配的だったため、MessagePortのtask 1回へ置き換えた

yieldはmacrotaskである必要がある。microtaskではWorkerがmessage eventを
dispatchできず、cancelが届かない。MessagePortはmacrotaskであり、この性質を
保ったままclampを回避する。

変更したのは `src/workers/search.worker.ts` の `workerYield()` のみである。
`MessageChannel` が無い環境では従来の `setTimeout(resolve, 0)` へfallbackする。
resolverはFIFOで保持する。1つのWorkerで2件の検索が同時に走る可能性があり、
単一handlerだと片方が解決されないためである。

### 8.2 before / after（セッションA、同一セッション連続実行、search elapsed中央値）

入力を変更していないworkloadのみを載せる。fixtureを差し替えた2件は8.2.1章。

| workload | before (ms) | after (ms) | 比 |
| --- | ---: | ---: | ---: |
| `bonus_depth_8_default_bounds` | 23.8 | 24.5 | 0.97x |
| `no_ideal_gogma_25` | 126.3 | 98.4 | 1.28x |
| `no_ideal_gogma_50` | 450.1 | 291.0 | 1.55x |
| `no_ideal_gogma_100` | 1224.4 | 668.7 | 1.83x |
| `no_ideal_skill_1000` | 548.2 | 323.3 | 1.70x |
| `no_ideal_normal_1000` | 894.7 | 259.9 | 3.44x |

小さいworkloadは測定ノイズの範囲で変わらず、yield回数が多いworkloadほど改善する。
改善幅がyield回数と対応している（5.1のyield回数を参照）。

最終実装（FIFO resolver版）で再計測しても同水準である
（`no_ideal_gogma_100` 644.3、`no_ideal_gogma_25` 93.3、
`no_ideal_skill_1000` 325.2、`no_ideal_normal_1000` 255.9）。

### 8.2.1 差し替えたfixtureのbefore / after（セッションB、5回の中央値）

fixture差し替え後の入力で、同一セッション内に `setTimeout(resolve, 0)` 版と
MessagePort版を連続で測り直した。build差し替え以外の条件は同じである。

| workload | yield回数 | before (ms) | after (ms) | 比 |
| --- | ---: | ---: | ---: | ---: |
| `near_ideal_default_bounds` | 1 | 13.6 | 8.5 | 1.60x |
| `skill_depth_8_default_bounds` | 5 | 50.9 | 53.1 | 0.96x |
| `bonus_depth_8_default_bounds`（対照、入力不変） | 5 | 61.6 | 66.7 | 0.92x |

これらはyieldが1〜5回しか起きないworkloadなので、yield機構の差は測定ノイズに
埋もれる。この3件は改善の根拠ではなく、**fixture差し替え後も回帰していないこと**
と、次の set parity 一致を示すための測定である。セッションBの実測値の散らばりは
大きい（対照の5回は44.1〜80.1 ms）。

### 8.3 before / after: result parity

8.2 / 8.2.1 の全workloadで、set parity keyは変更前後で完全一致した。

| workload | set parity key（変更前 = 変更後） | セッション |
| --- | --- | --- |
| `bonus_depth_8_default_bounds` | `678f333c:33383` | A / B とも |
| `near_ideal_default_bounds` | `931e391b:6372` | B |
| `skill_depth_8_default_bounds` | `ca4a9a76:85897` | B |
| `no_ideal_gogma_25` | `f3ae1658:154081` | A |
| `no_ideal_gogma_50` | `bd1da4e1:290802` | A |
| `no_ideal_gogma_100` | `e06df9b9:486604` | A |
| `no_ideal_skill_1000` | `72ddea03:3335675` | A |
| `no_ideal_normal_1000` | `1959a711:76307` | A |

### 8.4 before / after: responsiveness / cancellation（採用版）

| 条件 | cancel要求時刻 (ms) | Promise reject (ms) | Worker ack (ms) | Worker停止 (ms) | cancel後client progress | ping数 | 最大ping (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| default bounds / ping連続 | 2158.1 | 0.2 | 1.2 | 1.3 | 0 | 45,958 | 18.1 |
| `no_ideal_gogma_200` / ping連続 | 1000.8 | 0.0 | 16.5 | 16.7 | 0 | 44,041 | 30.2 |
| default bounds / ping 250 ms | 2011.6 | 0.1 | 1.5 | 1.6 | 0 | 4 | 19.3 |
| default bounds / 60秒後 | 60237.9 | 0.2 | 2.4 | 3.5 | 0 | 62 | 129.3 |

cancel到達（ack）と停止は変更前と同等かそれより速い。cancel後のclient-visibleな
progress callbackは全条件で0件（5.3の但し書きのとおり、raw Worker response
messageは直接instrumentしていない）。60秒runの最大pingは変更前86.4 msに対し
129.3 msだが、
このサンプルは主スレッドのthrottleにより約1回/秒しか取れておらず（62サンプル）、
GCの影響も分離できていない。ping連続条件では変更後の方が小さい。

### 8.5 環境差の注意

jsdomでは、MessagePort yieldの連続中に主スレッド `setTimeout(0)` が実行されず、
Node上ではtimer由来のcancelがstarveした。Chromium 148の実Workerでは
親からのcancel messageが数msで届くことを実測している（8.4）。
Production Workerはtimerではなくmessageだけでcancelされるためこの差は
production挙動に影響しないが、**確認できたのはChromium 148のみ**である。

---

## 9. 既存実装に対するFinding

いずれもB5が導入した問題ではなく、B5では修正していない。

### 9.1 Worker error handling

`SearchWorkerClient` はnative Workerの `message` しか購読していない。
`error` / `messageerror` のlistenerは無い。

benchmark harnessの `probeSearchWorkerErrorHandling()` で、存在しない同一origin
URLからWorkerを生成し、そのWorkerをProductionの `createSearchWorkerClient()` で
包んで `startSearch()` を実行した。結果は再現性がある。

| 観測 | 値 |
| --- | --- |
| Worker `error` event | 1回発火 |
| Worker `messageerror` event | 0回（再現できず） |
| `startSearch()` のPromise | **一度もsettleしない** |
| outcome | `pending_after_timeout`（3回とも） |

正確なFindingは次のとおりである。

- Worker errorを**自動検知できない**。`startSearch()` は自力ではsettleせず、
  `SearchPage` はエラー表示へ遷移しない
- したがって**ユーザー操作がなければ検索中表示が継続する**
- ただし**Cancelによる手動復帰は可能**である。`SearchPage` は検索中にCancel
  ボタンを出しており、押すと `cancelSearch()` が `activeRequestRef` をnullにし、
  `SearchWorkerClient.cancelSearch()` がpendingを `SearchCancelledError` で
  rejectし、`searching = false` と通知表示になる。再検索も行える

つまり「UIが永久に固まって復帰不能」ではなく、「自動検知が無いため、ユーザーが
Cancelするまで検索中のままになる」という不具合である。

B5では修正していない。修正には次のような設計判断が必要で、Worker protocolと
Application error semanticsに関わるためである。

- rejectするerror型とユーザー向け文言
- reject後にclientをdisposeするか、同じWorkerで再試行を許すか
- `SearchPage` へのエラー表示動線（既存Cancelによる手動復帰との関係）
- Identification系Worker clientにも同じ扱いを適用するか

設計チャットへ差し戻す。

### 9.2 Ideal分類が `restorationBonusScope` を評価していない — B5-F1で解決

以下はB5時点のFinding記録である。**B5-F1で解決済み**。Target Domainのscope-aware Ideal
判定をSearch stream / shortcutへ適用し、retentionと差分Crossの重複判定を
`(restorationBonusScope, 完成5枠multiset)` へ補正した。normal scope D=2では停止せず、
Reset後のgogma scope D=3をcanonical Idealとする回帰テストを追加した。
B5のscope-safe fixture、測定値、Worker性能コードは変更していない。

benchmark fixtureのレビューで、正式仕様との矛盾が判明した。

`docs/SEARCH_SPEC.md` 5.1 は、Idealの5枠完全一致に
`finalBonusScope = "gogma_artian"` を要求する。一方、
`createCandidateFromPrediction()` は `evaluateTargetCandidate()` へ
`restorationBonusScope` を渡しておらず、`satisfiesIdealTarget()` /
`classifyCandidate()` もscopeを見ていない。

その結果、巨戟化だけで `normal_artian` scopeのまま5枠が
`target.idealBonuses` と一致すると、現行実装はそのCandidateを
`category = "ideal"` に分類する。SEARCH_SPEC 5.1 に反する。

B5 benchmarkはこの挙動へ依存しないよう修正した。

- 到達可能なIdealのbonus anchorに巨戟化出力を使わない。型
  `BenchmarkIdealBonuses` は conversion出力をanchorとして表現できない
- `near_ideal_default_bounds` は Reset Bonuses depth 1 を anchor とし、
  `create_normal_artian` + `convert_normal_to_gogma` + `reset_bonuses` の
  D = 3 でIdealになる
- `skill_depth_8_default_bounds` は、現在Bonusが既にIdealな
  gogma scope の Owned Gogma 起点へ変更し、Skill streamだけを深さ8まで進める
  `existing_gogma_reset_skills` の D = 8 にした
- fixture testは `category === 'ideal'` だけでなく
  `restorationBonusScope === 'gogma_artian'` と route kind も検証する

**Production Searchの修正はB5のscope外だった。**
独立したSearch correctness task B5-F1で解決した。B6の作業には含めない。

---

## 10. Memory

Chromium非標準 `performance.memory` は利用可能だった。sampled JS heapのpeakは
おおむね次の範囲である（100 ms間隔サンプリング、主スレッドthrottleにより
サンプル間隔は一定ではない）。

| workload群 | peak範囲 |
| --- | --- |
| 近傍Ideal / 小boundsのworkload | 6〜23 MiB |
| `no_ideal_gogma_*` | 6〜52 MiB |
| `no_ideal_skill_1000` / `5000`（候補200件保持） | 17〜51 MiB |
| `no_ideal_normal_*` | 8〜21 MiB |

GCタイミングに依存する観測傾向であり、上限値ではない。変更前後で系統的な差は
見られなかった。

---

## 11. B6への入力

### 11.1 default値（`5000 / 5000 / 5000`）判断材料

- 近傍にIdealがある通常ケースでは既定値のままで数ms〜数十msであり（セッションA
  で `bonus_depth_8` が25.3 ms、セッションBで `near_ideal` 8.5 ms /
  `skill_depth_8` 53.1 ms）、既定値が常に問題になるわけではない
- 近傍にIdealが無い場合、既定値では60秒でも完了しない（実測）
- 単独streamのexhaustコスト（採用版、実測）
  - Skill: 100 → 33 ms、1000 → 325 ms、5000 → 1421 ms（ほぼ線形）
  - Normal: 100 → 38 ms、1000 → 256 ms、5000 → 2223 ms（ほぼ線形）
  - Gogma: 10 → 17.6 ms、25 → 93 ms、50 → 287 ms、100 → 644 ms、200 → 1961 ms
    （超線形。実測範囲は200まで）
- Gogmaは200までしか実測していない。5000の所要時間は測定していないので、
  この文書からは推定しない
- 保持集合の飽和も材料になる。Normalは100 / 1000 / 5000 で保持集合が同一、
  Skillは1000で既に上限200に達し `truncated` になる

### 11.2 progress表示改善の判断材料

- progress eventは**1 Targetにつき1回、検索完了時のみ**。単一Target検索では
  全runで progress event数 = 1
- 60秒以上動き続けるケースでも、途中経過はUIへ一切出ない
- Workerのevent loopは常に応答しており（ping最大18〜31 ms）、途中progressを
  送る余地は十分にある。制約はWorker側の余力ではなくprogressの粒度である

### 11.3 Worker error handling

9.1章の再現結果を参照。B5では未修正。B6への判断材料は次の切り分けである。

- 自動検知が無いことが不具合であり、UIが復帰不能なわけではない。既存のCancel
  ボタンで手動復帰できる
- したがってB6で決めるのは「Worker `error` / `messageerror` をどう検知して
  どうユーザーへ伝えるか」であり、復帰動線をゼロから作る話ではない
- `messageerror` は再現できていないため、扱いは仕様判断になる

### 11.4 その他

- Candidate出力順のrun依存（7章）はB6以降で扱う対象として残る
- Ideal分類がscopeを評価していない件（9.2章）は独立したSearch correctness
  task B5-F1で解決済みであり、B6の作業には含めない
- `no_owned_weapon_available` 等のlabel整備はB6のまま

---

## 12. 未測定・未証明事項

- `requestAnimationFrame` frame count / longest frame interval（4章）。
  Browser paneが `hidden` のため未測定
- 主スレッドのtimer gapによるresponsiveness。同じthrottleにより未測定
- `messageerror` の実挙動。再現できていない
- `no_ideal_default_bounds` の完走時間。60秒での未完了のみ観測
- `maxGogmaAdvance` 200超のコスト
- Chromium 148以外のBrowser、モバイル、低コア環境
- 複数Targetを同時に検索した場合のコストとprogress挙動
- 所持巨戟を起点とする `existing_gogma_*` routeの網羅的なコスト。測定したのは
  `skill_depth_8_default_bounds` の1件（Bonus stream停止・Skill streamのみ探索）
  だけで、Reset / Keep Bonusesを含む所持巨戟routeは測定していない
- セッションAとセッションBをまたいだ絶対値の比較。負荷条件が異なるため
  意味のある比較ができない
- 変更前後でMemoryに系統差が無いことは「観測されなかった」だけであり、
  上限の証明ではない
