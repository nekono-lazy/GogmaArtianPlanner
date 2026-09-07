# B8-B2 Constrained Enumeration Browser Worker Benchmark

実施日: 2026-09-07

## Status

- B8-B2 実Browser Worker性能検証: 完了
- Production enumeration defaults決定: 完了
- 次Phase: B8-C（Planner orchestration）

この計測とdefault決定は次を変更していない。

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
```

B8-B1の `visitConstrainedCandidates()` / lazy off-axis frontier / global
`maxOffAxisPairEvaluations` / consumer early stop / `ConstrainedEnumerationSummary` /
deterministic incremental deliveryも変更していない。通常Candidate Searchの
`defaultCandidateSearchSettings`（`1000 / 200 / 1000 / 200 / 0.6`）、
`CandidateSearchSettings`、Production Worker protocol、Persistence、UI、
Production RNG algorithmも変更していない。

Production側で追加したのは `defaultConstrainedEnumerationBounds` という定数1つだけであり、
`ConstrainedCandidateSearchInput.bounds` はcaller必須のままである
（B8-B1の「caller supplied bounds」契約を維持）。今回Applicationへは接続していない。

この文書は実測記録であり、仕様authorityではない。

> **性能値はすべて timing mode の直接計測である。**
> timing modeはparity instrumentation（stable key再生成・digest・Candidate列保持）を
> 行わない最小recorderで動く。default判断に差し引き補正値
> （`enumerationElapsedMs`）は使っていない。
> parity確認は別モード・別runで実施している（2.3 / 10章）。

---

## 1. 実施環境

| 項目 | 値 |
| --- | --- |
| Browser | Chromium 148.0.7778.280（Claude Desktop内蔵Browser pane、`Claude/1.46388.4`） |
| OS | Windows 11 Pro 10.0.26200 |
| `navigator.hardwareConcurrency` | 16 |
| Production RNG version | `production-rng:c5-e2` |
| `document.visibilityState` | **`hidden`**（4章の制約） |
| 基準commit | `a732f6a B8-B1 制約付き候補列挙を完成` |
| build | `npx vite build --config vite.benchmark.config.ts` |
| serve | `npx vite preview --config vite.benchmark.config.ts`（port 4175） |
| URL | `http://localhost:4175/GogmaArtianPlanner/benchmark.html` |

Node / Vitest はfixture correctnessと件数検証にのみ使用した。性能判断の根拠は
すべて上記の実Browser Worker経路である。

timing modeのrun間ばらつきは小さい（同一tupleの5 runで概ね±1〜2%）。
それでも本記録の絶対値は同一セッション内の相対比較にのみ使用し、
他セッション・他環境の数値と直接比較しない。過去セッションとの関係は12章を参照。

---

## 2. Harness

C5-E2C8の `benchmark.html` / `src/benchmark.tsx` / `vite.benchmark.config.ts` を
再利用し、`src/pages/BenchmarkApp.tsx` に3つ目のbenchmarkとして追加した。既定は
C8のままで、C8とB5の入力・手順・Worker policyは変更していない。通常アプリからは
どれにも到達できない。

| ファイル | 役割 |
| --- | --- |
| `src/benchmarks/constrainedEnumerationBenchmarkFixtures.ts` | 決定的workload / `ConstrainedCandidateSearchInput` 生成 |
| `src/benchmarks/constrainedEnumerationBenchmarkProtocol.ts` | benchmark専用Worker message契約、mode定義、parity digest |
| `src/benchmarks/constrainedEnumerationBrowserBenchmark.ts` | 主スレッドharness（run / cancel / ping / fail closed） |
| `src/workers/constrainedEnumeration.worker.benchmark.ts` | benchmark専用Worker controllerと2つのrecorder |
| `src/workers/constrainedEnumeration.worker.benchmark.entry.ts` | benchmark専用Worker entry |
| `src/pages/ConstrainedEnumerationBenchmarkPage.tsx` | 計測UIと `globalThis.b8Benchmark` |

### 2.1 Worker経路

Worker内で次を直接実行する。Production Worker protocolは経由しない。

```ts
new ProductionRngEngine()
visitConstrainedCandidates(input, engine, onCandidate, { shouldCancel, yieldControl })
```

B8-DがWorker / Application integrationのPhaseであるため、
`src/workers/search.worker.ts`、`src/workers/planner.worker.ts`、
`SearchWorkerRequest`、`PlannerWorkerRequest`、Application serviceへ
constrained re-search protocolを追加していない。benchmark専用protocolは
全message typeが `b8_benchmark_` 前置であり、既存Production messageと衝突しない。

`ConstrainedEnumerationBenchmarkPage` は **1 runごとにharnessとWorkerを生成し、
run終了時にdisposeする**（B5のpageと同じ方式）。したがってWorker生成コストは
runをまたいで償却されず、`roundTripMs` に含まれる。Worker内の計測値には含まれない。

### 2.2 Worker yield

benchmark Worker内に、Production Search Workerと同種のMessageChannel macrotask
FIFO yieldを**局所実装**した（指示の選択肢A）。B5で `setTimeout(resolve, 0)` の
最小clampが大きいworkloadで支配的になることが実測済みであり、timerを使うと
enumeratorではなくclampを測ることになるためである。

`src/workers/search.worker.ts` のyield実装は変更していない。checkpoint間隔50も
変更していない。

### 2.3 timing mode と parity mode

**benchmarkは2モードを持つ。両モードとも同じ入力で同じ
`visitConstrainedCandidates()` を呼ぶ。違いはvisitorが何をするかだけである。
B8-B1のProduction APIはどちらのモードでも同一で、callbackにstable keyを
追加するようなAPI変更は行っていない。**

| mode | visitorの記録内容 | 用途 |
| --- | --- | --- |
| `timing` | delivered count / ideal・practical count / TTF・10th・50th / routeKinds のみを記録する最小recorder。parity instrumentation（stable key再生成・digest・Candidate列保持）を行わない | **性能計測。default判断はこのモードのWorker wall timeのみを使う** |
| `parity` | 上記に加え ordered rolling digest と固定長per-key digest | determinism確認専用 |

`timing` modeのvisitorは記録を行わないわけではない。delivered count、
ideal / practical count、routeKinds、1 / 10 / 50件目のtimestampは記録する。
行わないのは **parity instrumentation** であり、具体的には
`constrainedCandidateStableKey()` の再生成、parity digestの生成と保持、
Candidate列の保持をしない。per-Candidateの `performance.now()` も
1件目 / 10件目 / 50件目の3回だけである。この最小recorderの下では
runのWorker-local wall timeを補正なしでenumerationのコストとして扱う。

```text
timing mode  workerElapsedMs        直接計測値。default判断はこれだけを使う
             recorderOverheadMs     null（parity instrumentationが無く引く対象が無い）
             enumerationElapsedMs   null
             orderedParityKey       null（keyを生成しない）
             setParityKey           null

parity mode  workerElapsedMs        parity instrumentationのコストを含む。性能値にしない
             recorderOverheadMs     parity instrumentationのper-Candidateコスト（実測）
             enumerationElapsedMs   workerElapsedMs - recorderOverheadMs（補正値）
             ordered / setParityKey determinism確認用digest
```

**この分離を導入した理由は、parity instrumentationのコストが実測で支配的だったためである。**
同一tuple `40/30/100/500` で timing mode 1782.0 ms に対し parity mode 5111.8 ms
（parity instrumentation 3494.3 ms、65%）。差し引き補正値を性能判断の根拠にすると、
大きな引き算の残差にdefaultを賭けることになる。timing modeはその引き算自体を
不要にする。

parity instrumentationはkey全文を保持しない。1回の文字走査でordered rolling digestへ
foldし、固定長24文字のper-key digest（独立した2つの32-bit hash + source length）
だけを残す。保持量は `O(配信Candidate数)` の固定幅であり、
`O(stable key総文字数)`（深さの二乗で伸びる）ではない。

---

## 3. Fixture / workload

固定入力はB5と同一の値を**import して再利用**している（`weapon.bow` / `element.fire`）。

| 項目 | 値 |
| --- | --- |
| Base Seed | `51231782`（C5-E2C9のlive read値、source `observation`） |
| Normal Counter | 0（`weapon.bow:8`、confirmed） |
| Skill Counter | 341（C5-E2C9のlive read値、source `observation`） |
| Gogma Counter | 200（benchmark用のsynthetic開始点。source `manual`、実観測値ではない） |
| Counter Gate | `null` / unconfirmed（legacy fieldとして未使用） |
| Practical Bonus条件 | `bonus_type.attack` >= `bonus_rank.base` を1枠以上 |
| Practical Skill条件 | 無制約 |

到達不能なIdealの半分は、B5と同じ参照レベルの事実であり新しい推測ではない。

- Bonus: `bonus_type.attack` / `bonus_rank.i` は `REFERENCE_GOGMA_RESET_CANDIDATES`
  に存在せず、Normal結果は常に `bonus_rank.base` である
- Skill: `group_skill.verified_14` はMasterでは有効だが `REFERENCE_GROUP_SKILL_POOL`
  に無く、`predictSkills` は返さない

**B5とは到達不能Idealの使い方が違う。** B5はcanonical Ideal終了条件を無効化するために
使っていた。constrained enumeratorにはcanonical Ideal終了が無いので、ここでは
SEARCH_SPEC 5.6.1の「現在状態が既にIdealならそのstreamを探索しない」規則を利用して
**streamをactiveに保つ**ために使っている。同じ規則を逆向きに使い、
`owned_gogma_current` をIdeal anchorにすることで、単一軸を分離している。

合成した所持巨戟はB5と同じ作り方である。5枠はProduction Reset結果（Gogma Counter
`200 + 778 - 1`）なので `gogma_artian` scopeかつ全枠が参照Keep family member、
SkillもProduction予測値（Skill Counter 350）で、いずれも開始Counterから十分離れている。
`material` / unprotected なのでReset BonusesとKeep Bonusesの両方が成立する。
合成した所持通常アーティアの5枠もProduction Normal結果（Normal Counter 3000）である。

全workloadは生成時に `assertConstrainedCandidateSearchInput()` と
`validateTargetIdealImpliesPractical()` を通している
（`src/benchmarks/constrainedEnumerationBenchmarkFixtures.test.ts`）。
`ConstrainedSearchOrigin` は `searchRunId` / `routeFilter` / `resultFilter` /
`settings` を持たないことをテストで固定している。

| group | Ideal Bonus anchor | Ideal Skill anchor | inventory | 分離される軸 |
| --- | --- | --- | --- | --- |
| A. Normal | 到達不能 | 到達不能 | Normal Counterのみ | Normal offset |
| B. Skill | 所持巨戟の現在5枠 | 到達不能 | 所持巨戟のみ | Skill stream |
| C. Gogma | 到達不能 | 所持巨戟の現在Skill | 所持巨戟のみ | Bonus stream |
| D. off-axis | 到達不能 | 到達不能 | 所持巨戟のみ | off-axis budget |
| E. combined | 到達不能 | 到達不能 | Normal Counter + 所持通常 + 所持巨戟 | （分離しない） |

groupごとの到達RouteはNodeテストで固定している。A = `normal_artian_to_gogma` のみ、
B = `existing_gogma_reset_skills` のみ（全候補 `estimatedGogmaAdvance = 0`）、
C = 全候補 `estimatedSkillAdvance = 0`、E = 現時点で成立する6 route kindすべて。

---

## 4. 測定方法と、この環境で測定できなかったもの

各workloadで warm-up 1回 + measurement 3回。default候補tupleは warm-up 1回 +
measurement 5回。表は中央値を使う。近傍tupleの探索は `boundsOverride` で
combined workloadのoriginに対して行っており、fixtureは同一である。

**5章以降のtiming表の `worker` はすべて実Worker wall timeの直接計測値である。**
parity instrumentationを行わない最小recorderでの計測であり、差し引き補正は
行っていない。parity modeの数値は10章にのみ載せ、
そこでは性能値として読まないことを明記する。

**測定できなかった項目: 主スレッドのrequestAnimationFrame responsiveness。**
Browser paneのページは前面表示中でも `document.visibilityState === 'hidden'` であり、
B5と同じ制約を受ける。したがってframe intervalは**未測定**であり、成功扱いにしない。
本harnessはRAFを計測していない。

**測定できなかった項目: 採用tupleのupfront solve区間へcancelを当てること。**
主スレッド `setTimeout` が約1回/秒へthrottleされるため、`cancelAfterMs` に
50 msを指定しても実際のcancel送出は661 msになった（9.2章）。
採用tupleのtime to first Candidateは331.6 msなので、cancelは常に
Candidate traversal区間に入ってしまい、solve区間のcancel挙動は
採用tupleでは**直接測定できていない**。より重いboundsでは観測できた（9.2章）。

---

## 5. Single-axis実測（timing mode）

`worker` = 実Worker wall time（直接計測、3 run）。

### 5.1 A. Normal scaling（bounds N/1/1/0）

| bound | worker 3回 (ms) | **中央値** | rt中央値 | 件数 | ttf中央値 | t50 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 6.5/7.5/6.8 | **6.8** | 17.7 | 29 | 4.5 | — |
| 50 | 12.9/12.5/11.2 | **12.5** | 22.8 | 143 | 7.3 | 10.1 |
| 100 | 16.0/16.2/17.1 | **16.2** | 26.3 | 285 | 8.8 | 10.2 |
| 250 | 36.3/35.1/34.4 | **35.1** | 45.0 | 715 | 16.2 | 19.3 |
| 500 | 63.8/62.5/66.1 | **63.8** | 73.3 | 1,433 | 33.4 | 35.8 |
| 1000 | 138.8/141.2/137.9 | **138.8** | 148.0 | 2,851 | 74.2 | 76.3 |

ほぼ線形（10 → 1000 で約20倍、boundは100倍）。全workloadで
`exhausted = false` / `stoppedByBound = true`。Normal streamには自然な終端が無いため、
forge countを網羅してもexhaustionにはならない。

### 5.2 B. Skill scaling（bounds 1/1/S/0）

| bound | worker 3回 (ms) | **中央値** | rt中央値 | 件数 | ttf中央値 | t50 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 4.1/4.2/4.0 | **4.1** | 13.5 | 10 | 3.1 | — |
| 50 | 9.6/10.7/11.3 | **10.7** | 20.1 | 50 | 5.1 | 10.6 |
| 100 | 16.7/15.9/16.6 | **16.6** | 26.4 | 100 | 6.6 | 11.4 |
| 250 | 52.8/52.5/51.1 | **52.5** | 62.8 | 250 | 14.4 | 19.1 |
| 500 | 201.2/199.6/202.5 | **201.2** | 210.0 | 500 | 32.6 | 40.7 |
| 1000 | 835.2/848.8/851.8 | **848.8** | 858.2 | 1,000 | 96.0 | 103.4 |

100を超えると明確に超線形（100 → 1000 で51倍）。Candidate件数は
`maxSkillResetCount` に正比例するが、深さ `k` のRouteはoperationを `k` 個持つため
出力サイズが `O(n^2)` になる。

### 5.3 C. Gogma scaling（bounds 1/G/1/0）

| bound | worker 3回 (ms) | **中央値** | rt中央値 | 件数 | ttf中央値 | t50 |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 12.5/12.1/12.4 | **12.4** | 22.8 | 47 | 8.6 | — |
| 25 | 35.2/34.7/33.0 | **34.7** | 45.1 | 275 | 20.2 | 23.1 |
| 50 | 136.6/136.9/136.4 | **136.6** | 145.9 | 1,092 | 58.6 | 61.2 |
| 100 | 708.9/724.5/716.8 | **716.8** | 727.5 | 4,086 | 228.3 | 232.8 |
| 200 | 3514.5/3531.0/3545.4 | **3531.0** | 3541.4 | 14,056 | 1089.8 | 1094.2 |

**最も急峻な軸である**（10 → 200 で285倍）。constrained enumeratorは
同一結果の後続Counter位置を保持し、Practical dominanceも初回horizonも
適用しないため、Candidate件数がGogma深さに対して大きく増える。
これは設計どおりであり、B8-B2で変更していない。

---

## 6. off-axis実測（timing mode）

所持巨戟1本、両stream active。`G/S` を固定して `maxOffAxisPairEvaluations` だけを変える。

### 6.1 G/S = 10/10（bounds 1/10/10/O）

| budget | worker 3回 (ms) | **中央値** | 件数 | `evaluatedOffAxisPairs` | ttf中央値 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 0 | 13.7/13.6/12.7 | **13.6** | 57 | 0 | 9.0 |
| 10 | 14.4/13.6/11.6 | **13.6** | 67 | 10 | 9.7 |
| 25 | 12.7/12.9/15.7 | **12.9** | 82 | 25 | 8.2 |
| 50 | 14.1/13.9/14.3 | **14.1** | 107 | 50 | 8.8 |
| 100 | 16.3/16.4/16.1 | **16.3** | 157 | 100 | 8.4 |
| 250 | 22.1/22.7/21.9 | **22.1** | 307 | 250 | 8.1 |
| 500 | 35.2/34.8/35.3 | **35.2** | 527 | **470** | 8.0 |
| 1000 | 34.4/34.4/33.6 | **34.4** | 527 | **470** | 8.5 |

**この形では到達可能な軸外pairが470件しかない。** budget 500と1000は同じ470件を評価し、
parity modeでもordered / set parityが完全に一致した（10章）。
capがreachable pair数より大きい場合の挙動として記録する。判定方法の注意は13.4章。

### 6.2 G/S = 25/25（bounds 1/25/25/O）

| budget | worker 3回 (ms) | **中央値** | 件数 | `evaluatedOffAxisPairs` | ttf中央値 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 0 | 38.6/38.8/37.9 | **38.6** | 300 | 0 | 21.0 |
| 100 | 41.1/42.1/40.0 | **41.1** | 400 | 100 | 21.3 |
| 250 | 48.4/49.4/48.3 | **48.4** | 550 | 250 | 20.9 |
| 500 | 57.3/59.4/56.9 | **57.3** | 800 | 500 | 20.9 |
| 1000 | 78.7/78.5/78.0 | **78.5** | 1,300 | 1,000 | 20.9 |

この形では1000まで飽和しない。budgetは1:1でpair数になり、pair 1件が
Candidate 1件を追加している（`件数 = 300 + budget`）。
限界コストは約 `(78.5 - 41.1) / 900 ≒ 0.042 ms/pair`。**軸外評価は安い。**
ttfはbudgetに依存しない（軸上pairが先に配信されるため）。

---

## 7. combined実測（timing mode）

`E. combined` は Normal Counter + 所持通常 + 所持巨戟 を持ち、全baseで両streamがactive、
近傍にIdealが無い。default決定に使うのはこの形の実測値だけである。

### 7.1 workload ladder（warm-up 1 + measurement 3）

| bounds N/G/S/O | worker 3回 (ms) | **中央値** | rt中央値 | 件数 | ttf中央値 | t50 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 10/10/25/25 | 51.2/48.0/47.3 | **48.0** | 59.1 | 789 | 17.3 | 19.7 |
| 25/25/50/50 | 607.8/598.7/604.1 | **604.1** | 615.1 | 8,198 | 124.5 | 126.9 |
| 50/25/100/100 | 1608.8/1627.5/1670.2 | **1627.5** | 1638.3 | 18,369 | 274.4 | 277.5 |
| 100/50/200/250 | 13899.0/13786.8/13710.7 | **13786.8** | 13800.8 | 127,070 | 2627.9 | 2632.1 |
| 250/100/500/500 | — | **未完走** | — | — | — | — |

全件 `exhausted = false` / `stoppedByBound = true`、Ideal 0件（Idealは到達不能）。

**`250/100/500/500` は完走しなかった。** parity instrumentationを行わないtiming mode
（3.のrecorder構成）で120秒のcancel guard付きで1回試行したが、guardが発火する前に
Browserのrender frameがdisposeされた（タブのクラッシュ）。`not completed within observation window` として
記録し、外挿は行わない。メモリ内訳の扱いは13.6章。
ひとつ下の `100/50/200/250` が既に13.8秒で目標を大きく超えているため、
default選定には影響しない。

### 7.2 採用tuple近傍の探索（timing mode、warm-up 1 + measurement 3、`boundsOverride`）

2秒目標の前後を挟むまで探索した。すべて `boundsOverride` で同一fixtureに対して測定。

| bounds | worker 3回 (ms) | **中央値** | 件数 | ttf中央値 | 判定 |
| --- | --- | ---: | ---: | ---: | --- |
| 25/35/100/500 | 1576.9/1617.1/1599.1 | **1599.1** | 17,109 | 302.8 | 目標内 |
| 50/25/100/100 | 1659.2/1668.1/1651.0 | **1659.2** | 18,369 | 271.2 | 目標内 |
| 50/25/100/500 | 1701.4/1689.6/1670.1 | **1685.0** | 18,769 | 270.5 | 目標内 |
| **40/30/100/500** | 1787.4/1819.6/1795.0 | **1795.0** | 20,306 | 330.7 | **目標内（採用）** |
| 30/35/100/500 | 1871.4/1905.2/1899.0 | **1899.0** | 20,178 | 367.1 | 目標内 |
| 50/25/125/500 | 1914.6/1916.0/1887.1 | **1914.6** | 20,069 | 278.1 | 目標内 |
| 60/25/100/500 | 1906.9/1948.8/1926.4 | **1926.4** | 22,279 | 334.3 | 目標内 |
| 40/30/110/500 | 1921.0/1927.3/1937.4 | **1927.3** | 20,726 | 345.7 | 目標内 |
| 60/25/100/1000 | 1938.0/1948.1/1959.6 | **1948.1** | 22,779 | 335.8 | 目標内 |
| 55/25/110/500 | 1972.6/1986.9/1920.3 | **1972.6** | 21,094 | 306.2 | 目標内 |
| 45/30/100/500 | 2035.7/2013.7/2008.0 | **2013.7** | 22,660 | 390.8 | 目標超過 |
| 25/40/100/500 | 2083.8/2110.2/2147.8 | **2110.2** | 21,326 | 415.2 | 目標超過 |
| 20/45/100/500 | 2149.0/2102.2/2122.4 | **2122.4** | 21,420 | 438.8 | 目標超過 |
| 35/35/100/500 | 2188.9/2208.6/2138.9 | **2188.9** | 23,247 | 426.3 | 目標超過 |
| 50/30/100/500 | 2229.6/2230.4/2222.4 | **2229.6** | 25,014 | 421.5 | 目標超過 |
| 50/25/150/500 | 2240.9/2239.1/2239.9 | **2239.9** | 21,369 | 317.1 | 目標超過 |
| 60/25/125/500 | 2225.3/2275.5/2288.8 | **2275.5** | 23,829 | 351.5 | 目標超過 |
| 75/25/100/500 | 2466.1/2343.1/2447.8 | **2447.8** | 27,542 | 448.4 | 目標超過 |

指示で指定された4 tupleは warm-up 1 + measurement 5 で測定した（7.3章）。

### 7.3 指定tupleと採用tupleの確認測定（timing mode、warm-up 1 + measurement 5）

| bounds | worker 5回 (ms) | **中央値** | rt中央値 | 件数 | ttf 5回 (ms) | ttf中央値 | t10 / t50 |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |
| **40/30/100/500（採用）** | 1827.1/1782.0/1775.6/1857.6/1772.6 | **1782.0** | 1793.7 | 20,306 | 331.6/333.1/328.4/327.9/333.9 | **331.6** | 332.9 / 335.9 |
| 25/25/100/500 | 831.3/834.1/841.6/844.0/838.5 | **838.5** | 851.5 | 9,998 | 140.3/140.9/139.9/142.3/140.4 | **140.4** | 141.5 / 143.5 |
| 30/25/100/500 | 985.8/974.0/959.6/987.9/985.2 | **985.2** | 997.3 | 11,752 | 163.3/162.7/161.2/164.6/164.4 | **163.3** | 164.2 / 166.4 |
| 25/25/100/250 | 814.1/828.5/820.4/819.9/828.2 | **820.4** | 833.2 | 9,748 | 141.4/141.5/139.1/140.0/143.9 | **141.4** | 142.4 / 144.7 |
| 40/20/100/500 | 940.0/933.1/937.5/935.4/931.3 | **935.4** | 949.6 | 11,266 | 131.9/133.1/129.4/132.7/131.5 | **131.9** | 133.1 / 136.0 |

全件 `exhausted = false` / `stoppedByBound = true` / `stoppedByConsumer = false`、
`examinedCandidates` は delivered件数と一致。

---

## 8. time-to-first / early-stop（timing mode）

### 8.1 upfront solveがtime to first Candidateを決めている

B8-B1の契約どおり、raw Skill / Bonus stream solveはCandidate traversalより前に行われる。
その結果、time to first Candidate は「最初の1件を作るコスト」ではなく
「そのTargetのstream solveを終えるコスト」になる。実測でも `ttf` と `t50` の差は
どのworkloadでも数msしかない。

| workload | **中央値** | ttf | t50 | ttf / 全体 |
| --- | ---: | ---: | ---: | ---: |
| `constrained_gogma_200` | 3531.0 | 1089.8 | 1094.2 | 31% |
| combined 100/50/200/250 | 13786.8 | 2627.9 | 2632.1 | 19% |
| combined 40/30/100/500（採用） | 1782.0 | 331.6 | 335.9 | 19% |

**このupfront costは隠していない。** B8-B2ではenumerator algorithmを変更せず、
Findingとして記録する（13.1章）。

### 8.2 consumer early stop（採用tuple 40/30/100/500、warm-up 1 + measurement 3）

`visitConstrainedCandidates()` のvisitorから `'stop'` を返す。

| stop | worker 3回 (ms) | **中央値** | rt中央値 | delivered | `examinedCandidates` | `evaluatedOffAxisPairs` | `stoppedByConsumer` | `exhausted` |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 345.9/346.8/351.4 | **346.8** | 360.7 | 1 | **1** | 0 | true | false |
| 10 | 348.6/353.2/350.3 | **350.3** | 363.5 | 10 | **10** | 2 | true | false |
| 50 | 354.8/354.6/351.1 | **354.6** | 367.2 | 50 | **50** | 20 | true | false |
| なし | — | **1782.0** | 1793.7 | 20,306 | 20,306 | 500 | false | false |

- `examinedCandidates` が delivered件数と完全に一致する。**consumer stop後に
  Candidate evaluationは増えていない**
- `stoppedByConsumer = true` / `exhausted = false` を確認
- 3水準とも所要時間は約347〜355 msで、time to first Candidate（331.6 ms）と同水準。
  つまりPlannerが数件だけtrialする場合のコストは、**ほぼupfront solveのコストだけ**であり、
  全件列挙（1782.0 ms）の約5分の1で済む

**`stoppedByBound` はconsumer stop時も `true` だった。** これは矛盾ではない。
Normal / Gogma / Skill boundによるreachable workの切り捨ては、traversalより前の
base構築 / stream solveの時点で確定しているためである。`stoppedByBound` と
`stoppedByConsumer` は排他ではなく、両方 `true` になりうる。
B8-Cはこの2つを独立に読むこと。`exhausted` はどちらの場合も `false` である。

---

## 9. cancellation / responsiveness（timing mode）

### 9.1 Worker event loopのping

ping連続（`pingIntervalMs = 0`）で1 run。ping自体が負荷になる点に注意。

| bounds | worker (ms) | ttf (ms) | 件数 | ping数 | 最大ping (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 40/30/100/500（採用） | 1915 | — | 20,306 | 822 | **284.0** |
| 100/50/200/250（cancel run） | 1103 | — | 0 | 59 | **1030.3** |

Workerのevent loopは常に応答している。ただし**最大gapはboundsに強く依存する**。

### 9.2 cancel観測

`requested` は主スレッド上でcancelを送出した時刻（run開始からのオフセット）。
4章のとおりhidden pageのtimer throttleにより、指定した `cancelAfterMs` より
大幅に遅れて送出されている。

| bounds | 指定 delay | 実 requested (ms) | **ack (ms)** | settle (ms) | delivered | workerElapsed (ms) | 最大ping (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 40/30/100/500 | 50 | 661 | **0.7** | 0.8 | 4,415 | 648 | 297.5 |
| 40/30/100/500 | 500 | 999 | **2.2** | 2.4 | 10,073 | 990 | 278.2 |
| 40/30/100/500 | 1000 | （発火前に完走） | — | — | 20,306 | 1,915 | 284.0 |
| 100/50/200/250 | 1000 | 1073 | **40.8** | 41.0 | **0** | 1,103 | 1030.3 |

列の意味。

- **ack**: Workerのevent loopがcancel messageを処理したというWorker発observationの
  到達時刻。主スレッド時計で往復を含む
- **settle**: enumerationが `CandidateSearchError('cancelled')` としてsettleするまで
- **delivered**: cancel時点までに配信されたCandidate数。`0` は
  upfront solve区間でcancelされたことを意味する

読み取れること。

- **採用tupleでは、cancelは常にCandidate traversal区間に届き、ackは0.7〜2.2 msだった**
- **より重いboundsのupfront solve区間ではack 40.8 msかかった**。同区間の
  最大pingが1030.3 msであることと合わせると、solve区間のcheckpoint密度が
  traversal区間より低いことを示している
- 採用tupleでは、solve区間が331.6 msしかないうえに主スレッドのthrottleにより
  その区間へcancelを当てられなかった（4章）。**採用tupleのsolve区間cancelは未測定である**

したがって「Worker cancellationは実用範囲」という判定は、
**採用tupleのtraversal区間についてのみ実測に基づく**。solve区間については
直接測定していない。補助的証拠として、採用tupleのcontinuous ping最大値が
278〜298 msであり、重いboundsで観測した秒オーダーのgapは生じていない。
これは補助的証拠であって、solve区間cancelの実測値ではない。

**B8-B2ではenumeratorのcheckpoint配置を変更していない。** solve区間の応答性は
Findingとして記録する（13.2章）。

---

## 10. determinism / parity（parity mode、別run）

parity modeで warm-up 1 + measurement 3 を実施した。**この章の時間はparity instrumentationの
コストを含むため性能値ではない。** 併記しているのは、timing modeと分離した理由
（2.3章）を数値で示すためだけである。

| workload / bounds | parity worker中央値 (ms) | parity instrumentation中央値 (ms) | timing中央値 (ms) | 件数 | ordered parity | set parity |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| **40/30/100/500（採用）** | 5111.8 | 3494.3 | 1782.0 | 20,306 | `3136bd0c:68293760` | `64165f48:507649` |
| 25/25/100/500 | 2361.2 | 1592.1 | 838.5 | 9,998 | `faf9c63d:32794795` | `aab374a1:249949` |
| `constrained_normal_1000` | 243.7 | 102.6 | 138.8 | 2,851 | `d4535a43:2185397` | `2bbd810a:71274` |
| `constrained_skill_1000` | 3461.6 | 2829.9 | 848.8 | 1,000 | `b938c573:61652501` | `0387c2eb:24999` |
| `constrained_gogma_100` | 2299.0 | 1626.8 | 716.8 | 4,086 | `257f9a74:34974500` | `c78ce624:102149` |
| `constrained_off_axis_10_500` | 82.0 | 42.7 | 35.2 | 527 | `c870e10b:984553` | `f7ce4634:13174` |
| `constrained_off_axis_10_1000` | 80.9 | 43.3 | 34.4 | 527 | `c870e10b:984553` | `f7ce4634:13174` |
| `constrained_off_axis_25_1000` | 216.5 | 126.5 | 78.5 | 1,300 | `5f5d4e51:3011087` | `96153a37:32499` |
| `constrained_combined_10_10_25_25` | 105.7 | 54.8 | 48.0 | 789 | `5040ea6d:1244292` | `3d01eeff:19724` |
| `constrained_combined_25_25_50_50` | 1586.2 | 1004.7 | 604.1 | 8,198 | `5f13d064:20957918` | `6db38d12:204949` |

結果。

- **全workload・全runで ordered / set parity の両方が一致した**（各セルは3 runで単一値）
- **Candidate件数もrun間で完全一致**（`examinedCandidates` も同様）
- timing modeとparity modeで delivered件数・ideal/practical内訳・routeKinds・
  `ConstrainedEnumerationSummary` が一致することはNodeテストでも固定している（17章）
- `constrained_off_axis_10_500` と `_1000` は parity keyまで完全一致しており、
  6.1章の「reachable 470件で飽和」を裏づける
- parity instrumentationのコストは workload次第で parity wall time の 42〜82% を占める。
  `constrained_skill_1000` では 2829.9 / 3461.6 = 82%。
  **これがdefault判断をtiming modeへ移した直接の理由である**

`ConstrainedCandidate` は `id` / `searchRunId` / `createdAt` を持たず、run依存値が
無いため、順序まで一致することが期待される契約であり、実測でもそのとおりだった。
B5の通常Searchで観測されたordered parityのrun依存（B6-F1で解決）に相当する問題は、
constrained enumeratorでは観測されていない。

---

## 11. 採用したProduction enumeration defaults

```ts
export const defaultConstrainedEnumerationBounds: ConstrainedEnumerationBounds = {
  maxNormalForgeCount: 40,
  maxGogmaAdvance: 30,
  maxSkillResetCount: 100,
  maxOffAxisPairEvaluations: 500,
}
```

配置は `src/domain/search/constrained/constrainedTypes.ts`。

### 11.1 選定根拠

すべて7章のcombined workload、timing modeの直接計測に基づく。
single-axis値を足し合わせて決めていない。差し引き補正値も使っていない。

| 目安 | 目標 | 実測（timing、中央値） | 判定 |
| --- | --- | ---: | --- |
| combined full bounded enumeration | おおむね2秒以内 | **1782.0 ms** | 満たす |
| time to first Candidate | おおむね1秒以内 | **331.6 ms** | 満たす |
| Worker cancellation | 実用上すぐ反応 | traversal区間で 0.7〜2.2 ms（solve区間は未測定、9.2章） | traversal区間について満たす |

軸ごとの判断。

- **`maxOffAxisPairEvaluations = 500`**: 最も安い軸。6.2章で約0.042 ms/pair、
  7.2章でも `50/25/100/100`（1659.2 ms）と `50/25/100/500`（1685.0 ms）の差は26 ms。
  初回SearchがCross-onlyで省いた組み合わせをPlannerへ供給するというB8の目的に
  直接効くため、大きめに取った
- **`maxGogmaAdvance = 30`**: 最も高価な軸（5.3章で10 → 200 が285倍）。
  2秒枠内でGogmaを25から30へ引き上げられる組み合わせを探し、Normalを譲ることで
  達成した。補助的な理由として、Gogma CounterはPlanner競合が起きる共有resourceで
  あり、Normal Counterは武器種ごとに独立という既存Plannerの事実がある
- **`maxNormalForgeCount = 40`**: 最も譲った軸。Gogmaを30へ上げる原資として
  減らした
- **`maxSkillResetCount = 100`**: 100を超えると急に高価になる
  （5.2章で100 → 250 が3.2倍）。`40/30/110/500`（1927.3 ms）も枠内だが、
  Skillを10増やす対価としてマージンを150 ms失うため100に留めた

#### `40/30/100/500` と `30/35/100/500` の比較

Gogmaをさらに35へ上げる `30/35/100/500` も2秒枠内である。両者の実測は次のとおり。

| tuple | timing中央値 | 2秒枠への余裕 | 件数 | ttf中央値 |
| --- | ---: | ---: | ---: | ---: |
| **40/30/100/500（採用）** | 1782.0 ms | 約218 ms | 20,306 | 331.6 |
| 30/35/100/500 | 1899.0 ms | 約101 ms | 20,178 | 367.1 |

このfixtureでは `40/30/100/500` の方が速く、Candidate数もわずかに多く、ttfも小さい。
1章のとおりセッションやマシン負荷による変動があるため、2秒ぎりぎりではなく余裕を
残す方を採った。**B8-B2は探索品質そのもの（どの上限なら実用的な解が得られるか）を
測定していないため、特定のNormal値を実用最低ラインとして扱わない。**
上記は所要時間・Candidate数・目標への余裕という実測事実のみによる選択である。

### 11.2 採用しなかったtupleと理由

| tuple | **timing中央値** | 不採用理由 |
| --- | ---: | --- |
| 250/100/500/500 | 未完走 | 観測窓内で完走せず、タブがクラッシュした。外挿しない |
| 100/50/200/250 | 13786.8 | 目標の約7倍。ttfも2627.9 msで1秒目標を超える |
| 75/25/100/500 | 2447.8 | 目標超過 |
| 60/25/125/500 | 2275.5 | 目標超過 |
| 50/25/150/500 | 2239.9 | 目標超過 |
| 50/30/100/500 | 2229.6 | 目標超過。Gogma 30を保ったままNormal 50は入らない |
| 35/35/100/500 | 2188.9 | 目標超過 |
| 20/45/100/500 | 2122.4 | 目標超過 |
| 25/40/100/500 | 2110.2 | 目標超過 |
| 45/30/100/500 | 2013.7 | 目標をわずかに超過 |
| 55/25/110/500 | 1972.6 | 枠内だがGogmaが25のまま。共有stream優先の方針に合わない |
| 60/25/100/1000 | 1948.1 | 同上。off-axis 1000は+22 msと安いが、Gogma 25では採らない |
| 40/30/110/500 | 1927.3 | Gogma 30は満たすが、Skill +10 の対価にマージン150 msを失う |
| 60/25/100/500 | 1926.4 | 件数は最多クラス（22,279）だがGogmaが25 |
| 50/25/125/500 | 1914.6 | 同上。Gogma 25 |
| 30/35/100/500 | 1899.0 | 枠内。採用tupleより遅く（+117 ms）、件数もわずかに少ない（20,178）。11.1章参照 |
| 50/25/100/500 | 1685.0 | 余裕はあるがGogmaが25 |
| 50/25/100/100 | 1659.2 | 同上。off-axisも100と小さい |
| 25/35/100/500 | 1599.1 | 枠内。Gogma 35だが件数が17,109と採用tupleより少ない |
| 30/25/100/500 | 985.2 | 保守的すぎ。全軸で探索範囲を狭める |
| 25/25/100/500 | 838.5 | 同上 |
| 25/25/100/250 | 820.4 | 同上。off-axisも半分 |
| 40/20/100/500 | 935.4 | 時間は余るがGogmaを20へ下げており、最も競合する軸を犠牲にしている |

### 11.3 この定数の位置づけ

- **defaultであってcapabilityではない。** `ConstrainedCandidateSearchInput.bounds` は
  caller必須のままであり、`visitConstrainedCandidates()` /
  `enumerateConstrainedCandidates()` が `input.bounds` をoptionalにしたわけではない。
  B8-C以降のProduction callerがこの定数を**明示的に渡す**
- **orchestration側boundsは含まない。** `maxCandidateTrialsPerConflict` /
  `maxGeneratedBuildListEntries` / `maxPlannerReruns` はB8-Eで別のbenchmarkから決める。
  Planner再実行1回のコストはB8-C / B8-Dのorchestration実装が無ければ測定できない
- **今回Applicationへは接続していない**

---

## 12. 過去測定・B5との比較について

### 12.1 timing mode導入前の測定

timing mode導入前の測定値は本記録に採用していない。当時の性能値は
`workerElapsedMs - recorderOverheadMs` という差し引き補正値であり、
parity instrumentationのコストがworkloadによってはwall timeの8割を占めていた（10章）。
補正の残差にdefaultを賭けないため、性能判断をtiming modeの直接計測へ移した。

その過程でdefault候補は次のように変わった。いずれも実測に従った変更であり、
先に決めた値を守るための解釈は行っていない。

```text
補正値ベース（旧）  50/25/100/500 -> 25/25/100/500
直接計測（現）      40/30/100/500
```

直接計測では同じ `50/25/100/500` が1685.0 msで目標内に収まる。旧測定で
これが目標超過に見えたのは、parity instrumentationのコストを含んだ計測とセッション負荷の
両方が効いていたためである。

### 12.2 B5との比較

B5の測定値（`docs/B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md`）は
historical comparisonとしてのみ参照する。次の理由で同一条件ではない。

- 測定セッションが異なる。B5自身がセッションAとBで同一workloadに2.6倍の差を
  記録している
- 測っている対象が違う。B5は `searchCandidates()`（初回Search: canonical Ideal終了、
  Practical dominance、horizon、`maxCandidatesPerTarget` 200あり）、
  B8-B2は `visitConstrainedCandidates()`（それらをすべて適用しない）
- boundsの意味が違う。`maxNormalAdvance` と `maxNormalForgeCount` は同義だが、
  B8には `maxOffAxisPairEvaluations` があり、`maxCandidatesPerTarget` が無い

傾向として一致している点のみ記す。Gogma軸が最も超線形であること、
Normal軸が単独では線形であることは両者で共通している。Skill軸はB5ではほぼ線形だったが、
B8-B2では超線形である。これは同一結果の後続Counter位置を保持することと、
深いRouteのoperation列がそのまま出力量になることによる差であり、
constrained enumeratorの設計どおりの違いである。

---

## 13. Finding

いずれもB8-B2が導入した問題ではなく、B8-B2では修正していない。
B8-B2はbenchmarkとdefault決定のPhaseであり、enumerator algorithmを変更しない。

### 13.1 time to first Candidateはupfront stream solveが支配する

8.1章。Candidate traversal前にraw Skill / Bonus stream solveが完了するため、
最初の1件までの時間はstream solve全体のコストになる。採用tupleでは331.6 msで
実用上問題ないが、boundsを上げると比例して悪化する（`gogma_200` で1089.8 ms、
combined 100/50/200/250 で2627.9 ms）。

B8-Cのorchestrationは、1 Targetあたり最低でもこのupfront costを払う。
`maxCandidateTrialsPerConflict` を小さくしてもこのコストは減らない。
8.2章のとおり、trial件数を減らすことで削減できるのはtraversal分だけである。

### 13.2 upfront solve区間はtraversal区間よりcancel応答が遅い

9.2章。重いbounds（100/50/200/250）でsolve区間にcancelを当てると、
ackまで40.8 msかかった。同区間の最大pingは1030.3 msである。
traversal区間では0.7〜2.2 msで届く。

原因はcheckpoint配置の差にあると考えられるが、B8-B2では特定も修正もしていない。
採用tupleのsolve区間は331.6 msしかなく、最大pingも278〜298 msだったため、
Production defaultの範囲では実害は観測されていない。ただし採用tupleの
solve区間cancelは直接測定できていない（4 / 9.2章）。

### 13.3 出力量がRoute深さの二乗で伸びる

5.2 / 5.3章。深さ `k` のRouteはoperationを `k` 個持つため、
Candidate `n` 件の総出力量は `O(n^2)` になる。`constrained_skill_1000` の
ordered parity key文字数61,652,501はその直接的な観測である
（同じrunのset parity key文字数は24,999で、per-key digestが固定長であることを示す）。
enumerator自身も `constrainedCandidateStableKey()` をdedupのために
Candidateごとに計算しているため、この二乗成分は実行時間にも乗る。

### 13.4 off-axis budgetが足りたかは、単一の値からは判定できない

6.1章。`G/S = 10/10` では到達可能な軸外pairが470件しかなく、budget 500と1000は
同じ結果になった。budgetを上げても結果が変わらない領域が存在する。

`stoppedByBound` はこの場合もGogma / Skill boundにより `true` のままなので、
`stoppedByBound` だけからは判定できない。

**`evaluatedOffAxisPairs` と budget の比較だけでも判定できない。**
正しい読み方は次のとおりである。

```text
full traversal（consumer stopしていない） &&
evaluatedOffAxisPairs < maxOffAxisPairEvaluations
  => off-axis capはbindingではなかった

evaluatedOffAxisPairs == maxOffAxisPairEvaluations
  => reachableがちょうどcapだったのか
     capでtruncateしたのか
     この値だけでは判定不能

consumer stop
  => evaluatedOffAxisPairsだけから
     off-axis exhaustion / sufficiencyを判断してはいけない
```

`==` の曖昧さを実際に解消できたのは、6.1章のようにbudgetを変えて再測定し、
`evaluatedOffAxisPairs` と配信Candidate集合（parity key）が動かなくなる点を
見つけたからである（470件で飽和）。単一runの値だけでは同じ結論には到達できない。

B8-B2では `ConstrainedEnumerationSummary` 型もenumerator semanticsも変更していない。
B8-Cがこの区別を必要とする場合、そのPhaseで設計判断すること。

### 13.5 `stoppedByBound` と `stoppedByConsumer` は排他ではない

8.2章。bound到達はbase構築 / stream solveの時点で確定するため、
consumer stopしたrunでも `stoppedByBound = true` になりうる。
`exhausted` はどちらでも `false` である。3つのフラグを独立に読むこと。

### 13.6 巨大boundsでのメモリ挙動は未確定

7.1章。`250/100/500/500` は次のいずれの構成でもタブがクラッシュした。

1. key全文を全件保持していた初期harness
2. 固定長per-key digestだけを保持するmemory-bounded parity harness
3. parity instrumentationを行わないtiming harness（recorderはroute kindのSetと
   カウンタ、および3つのtimestampのみ）

したがって **stable key全文の保持が唯一の原因ではないことは確認できた。**

一方で、次は確定していない。

- enumerator側が保持する `deliveredCandidates`（stable key全文のSet）/
  `evaluatedPairs` / `enqueuedNodes` が支配的である**可能性はある**が、実証していない
- **現行recorderを含めたメモリ内訳はprofile未実施であり未確定である**

B8-B2ではheap profileを取っていないため、「recorderが主因ではない」と断定しない。
言えるのは上記1〜3の再現事実だけである。Production defaultの範囲では発生していない。

---

## 14. 未測定・未証明事項

- 主スレッドのrequestAnimationFrame responsivenessとtimer gap。
  Browser paneが `hidden` のため未測定（4章）。B5と同じ制約
- **採用tupleのupfront solve区間へcancelを当てた場合の応答。**
  主スレッドtimerのthrottleにより当てられなかった（4 / 9.2章）。
  したがって「cancellationが実用範囲」はtraversal区間についてのみ実測に基づく
- `250/100/500/500` の完走時間。観測窓内で完走せず、タブがクラッシュした（7.1章）
- 巨大boundsでのメモリ消費の内訳。heap profile未実施で未確定（13.6章）
- `maxGogmaAdvance` 200超、`maxSkillResetCount` 1000超、
  `maxNormalForgeCount` 1000超のコスト
- 複数Targetを連続してconstrained enumerationした場合のコスト。
  測定したのは常に単一Targetである
- Planner orchestrationのコスト。`maxCandidateTrialsPerConflict` /
  `maxGeneratedBuildListEntries` / `maxPlannerReruns` のdefaultはB8-Eで決める
- Idealが到達可能なworkloadでのconstrained enumerationコスト。
  全workloadでIdealは到達不能であり、Ideal 0件だった
- normal scope Keep prediction。引き続きunsupportedであり、
  本benchmarkでも生成していない
- Chromium 148以外のBrowser、モバイル、低コア環境
- `performance.memory` によるmemory計測。B8-B2harnessでは取得していない
- B5との絶対値比較（12章）

---

## 15. B8-Cへの引き継ぎ

- `defaultConstrainedEnumerationBounds` を明示的に渡すこと。
  `input.bounds` はcaller必須のままである
- 1 Targetあたりのenumerationコストは、採用defaultで
  **全件 1782 ms、最初の数件で打ち切るなら約347〜355 ms**（いずれも直接計測）。
  trialを打ち切る設計なら後者が実効コストになる（8.2章）
- time to first Candidateはupfront raw stream solveが支配する。
  Candidate 1件目と50件目の差はどのworkloadでも数msしかない（13.1章）
- orchestration側boundsのdefaultはここで決めていない。B8-Eで決める
- `exhausted` / `stoppedByBound` / `stoppedByConsumer` は独立に読むこと（13.5章）
- off-axis budgetが足りたかは、`stoppedByBound` からも
  `evaluatedOffAxisPairs` とbudgetの比較からも一般には判定できない（13.4章）。
  B8-Cがこの区別を要するなら、そのPhaseで設計判断すること
- boundsを大きく上げる場合、cancel応答（13.2章）とメモリ（13.6章）の
  両方が未検証領域に入る
- 性能を測り直す場合は timing mode を使うこと。parity modeのwall timeは
  parity instrumentationのコストを含み、workloadによってはその8割に達する（10章）
