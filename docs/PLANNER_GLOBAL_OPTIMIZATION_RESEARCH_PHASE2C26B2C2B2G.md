# Global Planner Research Phase 2-C2.6-B2-C2B2G（B2-C2B2F BONUS dominant Targetの `bonus_depth_read` 内部runtime再局所化）

Refs #154。Research only・profiling only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Search semantics /
ordering / comparator、Candidate materializer、C4C capture、safety cap、extent、context、P1、termination、yield semanticsは変更していない。
Production optimization、新しいProduction instrumentation seam、独自のinner section、V8 CPU profiler、16 GB heap、60分以上のrun、retry / fallback、
E2、K2、residual 3、global assignment、full Planner、UI、A3〜A9 / B2-C2B2E / B2-C2B2F RESULTの再生成は行っていない。

- measurement HEAD: `03e2f73ca58330f3d55afb49b29a02328c341e4e`（runnerがchild起動前にstart attestationで記録）
- analysis HEAD: `03e2f73ca58330f3d55afb49b29a02328c341e4e`（measurement HEADと同一。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2G_RESULT.json)（**`provenance.formal = true`**、`evidenceGrade = formal`、
  decision **`B2C2B2G_STATE_GENERATION_DOMINANT`**、invalid reason 0）

## 0. 位置づけとlimitation

- B2-C2B2F（`B2C2B2F_BONUS_DOMINANT`、`bonus_depth_read` がSearch wallの81 %）を受けたPhase。問いは「**`bonus_depth_read` = held-aware
  `readReservedDepth()` の内部6 sectionのうち、現行main / t02のSearch inputでどれがwall timeを支配しているか**」だけで、optimizationはしない。
- Search inputはB2-C2B2Fと同一のoracle-guided diagnostic入力（B2-C1 first compatible context × tight extent）。Production scheduler / extent selection /
  runtimeのevidenceではない。Route exact / Candidate有無は判定しない（`routeExactJudged = false`）。
- B2-C2B2Fに `onGogmaReservedRuntime` observerを追加したため、**B2-C2B2Fとの絶対runtime比較（wall、yields/sec、depth/sec、raw solutions/sec）はしない**
  （`absoluteRuntimeComparedWithB2C2B2F = false`）。根拠は同一run内のsection shareだけ。
- A7 / A8 / A9は別population・A9以前のmainでのResearch。taxonomy / implementation referenceとしてのみ使い、decisionには混ぜない（Search childはA7〜A9の結果を一切受け取らない）。

## 1. 結論

| 軸 | 値 |
| --- | --- |
| decision | **`B2C2B2G_STATE_GENERATION_DOMINANT`**（dominant = `state_generation`、`bonus_depth_read` の **64.27 %**、secondary なし、invalid 0） |
| evidence | `formal = true`（start attestation verified、Working Tree clean、smoke null） |
| outcome | 30分budgetでtimeout（正常なprofiling outcome。Candidate 0扱いしない）。Search wall 1,790.9 s、最終snapshot後の未観測tail 4.3 s |
| `bonus_depth_read` | 1,517.1 s（Search wallの **84.71 %**） |
| inner coverage | **0.99996**（inner 6 section合計 1,517.02 s / `bonus_depth_read` 1,517.07 s）、remainder 53.6 ms |
| contract violation | outer 0、inner 0、open `bonus_depth_read` 外のinner境界 0、負のduration 0、reconciliation issue 0 |
| window（0–10 / 10–20 / 20–30分） | dominantは3 windowとも `state_generation`（70.1 / 65.1 / 57.7 %）。`solution_materialization` が9.8 → 16.3 → 25.3 %と増加 |
| Candidate delivery | delivery flush 0、consumer 0（最初のCandidateをdeliverする前に30分を使い切った） |

### 1.1 内部6 section（同一run・同一凍結時刻、Search wall 1,790,899 ms）

| section | ms | share of `bonus_depth_read` | share of Search wall | count（完了） |
| --- | ---: | ---: | ---: | ---: |
| `window_collection` | 18,459 | 1.22 % | 1.03 % | 404 |
| `support_evaluation` | 37,025 | 2.44 % | 2.07 % | 404 |
| **`state_generation`** | **974,985** | **64.27 %** | **54.44 %** | 403 |
| `solution_materialization` | 260,466 | 17.17 % | 14.54 % | 403 |
| `frontier_reduction_sort` | 224,626 | 14.81 % | 12.54 % | 403 |
| `exhaustion_scan` | 1,459 | 0.10 % | 0.08 % | 403 |
| inner合計 | 1,517,019 | 99.996 % | 84.71 % | |
| remainder（`bonus_depth_read` − inner合計） | 53.6 | 0.004 % | | |
| 　うち depth境界内・section外 | 35.9 | | | |
| 　うち depth境界外（cursor claim / stream lookup / promise解決） | 17.7 | | | |

dominant = `state_generation`（64.27 %）、2番目 = `solution_materialization`（17.17 %、secondary閾値0.20未満）、3番目 = `frontier_reduction_sort`（14.81 %）。

## 2. 方針（B2-C2B2Fとの差）

```text
B2-C2B2F RESULT（b7b707bb…、formal、B2C2B2F_BONUS_DOMINANT / dominant BONUS、invalid 0、hash chain all true）
  -> parsePhase2C26B2C2B2GB2C2B2FAuthority(): formal / launch provenance / not partial / decision / Stage 1 / onSearchRuntimeのみ /
       condition checks・hash chain・population parity・child identity all true / task rebuild / identity / excluded Route（3者一致）を fail-close確認
  -> phase2c26b2c2b2gPopulation(): B2-C2B2Fのprofiling対象Target（1件）、probe、期待identityを、
       B2-C2B2E RESULTからB2-C2B2F自身の導出関数（phase2c26b2c2b2fPopulation）で再導出したprobe / identity / Target / excluded Route key / Exportと照合
  -> probe manifest（probe + Search input identityのみ）-> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2G_PROBES.json.local（1171d400…）
runner（Export + manifestのみ読む）
  -> start attestation（wx・read-only・read-back verify）-> tasks child: buildPhase2C26B2C2B2FTasks()（identity全field一致gate）-> 1 task
  -> Search child（fresh、12,288 MB、30分）: 検索前にSearch identity（digest / extent / excluded Route key SHA-256）をdurableに記録
       -> runPhase2C26B2C2B2GTask = B2-C2B2Dのtask / Search本体とline-for-line同一（testで固定）+ 既存2 observer
       -> B2-C2B2Fのprofiler（A4 tracker）+ A3 tracker、1 clock。5秒ごと・window境界でclockを凍結した累積snapshotをdurableに追記
analyzer（run終了後のみ、oracle / A7〜A9 RESULTは読まない）
```

| 項目 | B2-C2B2F | B2-C2B2G |
| --- | --- | --- |
| population | B2-C2B2E time_bound timeout 1 Target | **B2-C2B2F BONUS dominantのprofiling対象 1 Target**（同一Target・同一task） |
| Search instrumentation | `onSearchRuntime` のみ | **`onSearchRuntime` + `onGogmaReservedRuntime`**（A7の組。depth / work observer、CPU profilerなし） |
| 30分 / 12,288 MB / concurrency 1 / fresh child / setImmediate / 250 ms sampling / 5 s heartbeat / window / retry・fallbackなし / Target / P1 rank / group / reservation / representative / Planner-start origin / excluded current Route / tight extent / default・tight Search input digest / ordering / comparator / materializer / C4C capture / safety cap 1024 | 同一 | 同一 |

### 2.1 probe（authorityから機械導出、sourceには値を書いていない）

| task | Target | P1 rank | tight extent | group | reservation | default / tight Search input digest | excluded current Route key SHA-256 |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
| t02-r11 | `a367c177…` | 11 | `{4, 235, 1083}` | 3 | `fnv1a32:ff85a91d` | `fnv1a32:d80ff6de` / `fnv1a32:824a0ec4` | `4a875aac…` |

## 3. 計測方式

- Search Domainは時刻を読まない。既存の `onSearchRuntime`（outer section境界）と `onGogmaReservedRuntime`（`readReservedDepth()` のdepth / 6 section境界）が
  同期的に境界だけを報告し、Research childが `performance.now()` で時刻を付ける。observerの戻り値はSearchに読まれない。新しいProduction seamはない。
- tracker: outerはB2-C2B2Fのprofiler（A4の `createPhase2C26A4RuntimeTracker()`、yield帰属、depth facts）を、innerはA3の `createPhase2C26A3RuntimeTracker()`
  （pairing / overlap / depth昇順 / stream close後の境界を契約違反として数える）をそのまま再利用。**同一clock・同一origin**。
- snapshotは同期処理中にclockを凍結し、outerとinnerを**同一時刻**で観測する（A7方式。341 snapshotすべてで `inner.atMs === runtime.atMs` を確認）。
  open read / open depth / open phaseは観測時刻までの経過を含める（A3 analyzerと同じsemantics）。
- Research側だけの追加：outer open stackのmirrorで「inner境界はopen `bonus_depth_read` の内側」を全境界で検査、yield待ちをinner sectionにも帰属、
  `depth_completed` のcounts（`ReservedGogmaRuntimeEvent.counts`、追加走査なし）からdepth recordと集計を作り、次のsnapshotで1回だけ書き出す（境界ごとの書き込みなし）。
- depth recordの各section和 + open depthの完了section = trackerの完了section total（double countなし・欠落なし）をanalyzerで検査。

```text
innerSectionsMs = 6 sectionの合計 <= innerInclusiveMs（depth_started -> depth_completed）<= bonusDepthReadMs（outer bonus_depth_read inclusive）
innerCoverageOfBonusDepthRead = innerSectionsMs / bonusDepthReadMs
remainder = bonusDepthReadMs - innerSectionsMs = inDepthOutsideSections + outsideDepthBoundaries
```

### 3.1 事前登録decision rule（formal run前にcommit `03e2f73` で固定）

- coverage threshold **0.90**、dominant **≥ 0.50**、secondary **≥ 0.20**（いずれも `bonus_depth_read` 比）、Search wall下限 **60 s**
- `B2C2B2G_INVALID`（authority / population / identity / excluded Route / provenance / outer・inner契約違反 / 負のduration / reconciliation破綻）
  → `B2C2B2G_INSUFFICIENT`（profileなし / 60 s未満 / read未観測 / coverage < 0.90）→ `B2C2B2G_<SECTION>_DOMINANT` → `B2C2B2G_MIXED`（≥ 20 %の上位最大2 sectionを次Phase候補）
- windowは記述のみでdecision inputではない。outer sanityは記録のみで、B2-C2B2Fとの数値一致は要求しない

## 4. 実行

| 項目 | 値 |
| --- | --- |
| 環境 | Node v24.19.0（Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |
| start attestation | `start-attestation.json`、SHA-256 `9eb3f24c…`、createdAt 2026-10-05T14:25:52.409Z（tasks child START 14:25:52.436Z より前）、HEAD `03e2f73`、uncommitted false、smoke null |
| benchmarkCodeSha256 | `f47b42178dfbc1efa6249667a2f9fbb823134fcfe0838d9609d79738d4fda556`（analyzerがmeasured HEADのgit objectから再計算した値と一致） |
| 実行 | tasks child 5.6 s（gate ok）→ Search child 14:25:58Z〜14:55:58Z、1,800.4 sでtimeout（SIGKILL、retryなし） |
| 起動前の確認 | CPU 14 %、空き18.1 GB、node / エンコーダCLI 0 |
| 実行中の監視 | 60秒ごと29回：空き物理メモリ10.5〜14.8 GB、エンコーダ0、1.5 GB未満の警告0件 |
| smoke | non-formal 1回（`--allow-uncommitted --smoke-budget-ms 120000`）でrunner → analyzerの経路を確認。smoke結果を見て条件・ruleは変えていない |

## 5. 結果

### 5.1 outer sanity（本run自身、B2-C2B2Fとの数値比較はしない）

| check | 結果 |
| --- | --- |
| BONUSが最大category | true（BONUS 99.9977 %、SKILL 0.0008 %、SCHEDULER 0.0012 %、COMPOSITION / DELIVERY 0 %） |
| `bonus_depth_read` 観測 | true（Search wallの84.71 %。BONUS内のほかは `bonus_ideal_filter` 171.0 s・`bonus_notice_scan` 101.8 s） |
| delivery前 | true（delivery flush 0、consumer 0） |
| outer nesting違反 / 分割一致 | 0 / true（outer coverage 0.999999） |

最終snapshotのopen stack：`search_runtime > scheduler_step > scheduler_settle > bonus_depth_work（channel 5, depth 65）> bonus_depth_read`、
inner側はstream 5・depth 65の `state_generation`（1,250 ms経過）。outer / innerのopen位置は一致。

### 5.2 depth / generated / frontier counts（`depth_completed` のcountsのみ）

| 項目 | 値 |
| --- | --- |
| completed depths | **403**（+1 open）、exhausted 0、streams 6（すべてstartGogmaCounter 55）、max depth 69 |
| generated states | 合計 **725,971,613**、1 depth中央値 1,878,182、最大 2,011,282 |
| frontier states before / after | 合計 9,472,814 / 9,609,239、1 depth中央値 24,363、最大 24,990 |
| legal positions | 合計 81,363、1 depth 167〜235（中央値202） |
| window memo entries | 236（全depth一定） |
| stream別 | depth 69 / 69 / 68 / 67 / 66 / 64、generated 1.24億 / 1.24億 / 1.22億 / 1.21億 / 1.19億 / 1.16億 |

1 depthあたり（中央値、記述のみ）：inclusive 3.86 s、`state_generation` 2.50 s。生成state 1件あたりのns（中央値）は
`state_generation` 1,338、`frontier_reduction_sort` 308、`solution_materialization` 293。depth間の相関は generated states vs `state_generation` ms が0.976。

### 5.3 yield待ち（Research setImmediate往復、Search wallに含まれる）

| 帰属先 | 回数 | 時間 |
| --- | ---: | ---: |
| 全体 | 14,540,553 | 162.7 s |
| outer `bonus_depth_read` 内 → inner `state_generation` | 14,537,230 | **161.0 s**（`state_generation` 975.0 sの16.5 %） |
| inner `exhaustion_scan` / `window_collection` | 3,272 / 28 | 5.6 ms / 0.4 ms |

`state_generation` には生成state 1件ごとの `execution.checkpoint()` から来るyield待ちが含まれる（Search自身のwall time）。CPU計算部分はおおよそ975 − 161 ≈ 814 s。

### 5.4 window（Search elapsed、記述のみ）

| window | 観測区間 | `bonus_depth_read` | coverage | window / support / **state_gen** / solution_mat / frontier / exhaustion（read比） | depths | generated | max depth | yields |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 0–10分 | 0–600.0 s | 501.2 s | 0.99996 | 1.35 / 2.55 / **70.06** / 9.84 / 16.07 / 0.13 % | 144 | 262.8 M | 26 | 5.29 M |
| 10–20分 | 600.0–1,200.0 s | 507.4 s | 0.99997 | 1.22 / 2.45 / **65.10** / 16.25 / 14.89 / 0.09 % | 132 | 247.9 M | 48 | 4.94 M |
| 20–30分（partial） | 1,200.0–1,790.9 s | 508.5 s | 0.99997 | 1.08 / 2.32 / **57.73** / 25.31 / 13.48 / 0.08 % | 127 | 215.3 M | 69 | 4.31 M |

dominantは3 windowとも `state_generation` だが、shareは70 → 58 %へ下がり、`solution_materialization` が10 → 25 %へ上がっている（depthが深くなるほど増える傾向。
`reservedBonusSteps()` のresult chain走査がdepthに比例する実装と整合するが、本Phaseでは内部を切っていないため記述的観察に留める）。
このままdepthが進めば、後半ではdominantが入れ替わる可能性もある（30分の範囲外は未観測）。

### 5.5 outcome

| 項目 | 値 |
| --- | --- |
| process | timeout（child wall 1,800.4 s、kill at 1,800.0 s）、record null、Candidate 0扱いしない |
| delivery | delivery_flush 0、delivery_consumer 0 |
| peak heap / RSS | 7.47 GB / 8.09 GB（12,288 MB上限に対して余裕あり） |
| profile snapshot | 341件（最終はheartbeat、Search elapsed 1,790.9 s）、未観測tail 4.3 s、profile 3.8 MB |
| events | outer 175,893、inner 5,648 |

## 6. identity / provenance

| 照合 | 結果 |
| --- | --- |
| B2-C2B2F RESULT authority | registered SHA `b7b707bb…`、formal、`B2C2B2F_BONUS_DOMINANT` / BONUS、invalid 0、hash chain・condition checks・child identity all true |
| B2-C2B2E chain | B2-C2B2FはB2-C2B2E `5bf6bba3…` に対して作られており、B2-C2B2Eから再導出したTarget / probe / identity / excluded Route key / Exportと一致（chain 6項目all true） |
| population | manifest = 再導出、runner Target / probe / identity = manifest = B2-C2B2Fのprofiling対象、Target 1 |
| task identity | raw task = 期待identity（11 field）= B2-C2B2Fの `parity.identity.expected`、Exportから再導出したtask = raw task |
| excluded current Route | analyzerの再導出 = B2-C2B2Fの値 = Search childが検索前に記録した値（`4a875aac…`）、key 1件、current Route |
| conditions | 30分 / 12,288 MB / concurrency 1 / retry・fallbackなし / B2-C2B2F Stage 1と同一 / instrumentationは2 observerのみ（B2-C2B2Fとの差は `onGogmaReservedRuntime` のみ）/ CPU profilerなし、すべてtrue |

## 7. A7 / A8 / A9との関係（解釈のみ）

- A7（A6後・別population 3 orientation）では `frontier_reduction_sort` が `bonus_depth_read` の53〜59 %で最大、`state_generation` は29〜36 %だった。
- A8はその `frontier_reduction_sort` 内部の66〜68 %がrepresentative比較のstable serializationであることをCPU profilerで特定し、A9がそのcacheをProductionへ採用した。
- 本Phase（A9後の現行main、t02）では `frontier_reduction_sort` は14.8 %まで下がり、**`state_generation` が64.3 %で支配的**。A7当時の構成を前提にせず、
  現行mainのt02での構成として扱う（populationもmainも異なるため、A7の数値と合算・直接比較はしない）。

## 8. 次Phase recommendation（本PRでは実行しない）

**STATE_GENERATION_DOMINANT → `state_generation` 内部のCPU / allocation hotspot局所化。** 候補（現行実装から列挙、本Phaseでは未計測）：

- legal position iteration（`[...positions].sort()`）、Reset parent lookup（`set.frontier.find(...)`、frontier ~2.4万件の線形探索を位置ごとに実行）
- position × frontier Keep scan（`windows[index].has(position)` を全frontier stateについて評価）
- `predictReset` / `predictKeep` memo lookup、`engine.advanceGogmaCounter()`
- `reservedGeneratedState()`（family layout key生成・result node生成）による割り当て
- 生成state 1件ごとの `execution.checkpoint()`（yield待ち 161 s = `state_generation` の16.5 %はここ。CPU attributionではyield待ちとCPU時間を分けて扱う）

また、windowで増加している `solution_materialization`（`reservedBonusSteps()` のresult chain走査）は、depthが深い後半での2番目の候補として記録しておく。
optimization、16 GB heap、60分以上のrun、CPU profilerへは自動で進まない（CPU profilerを使うかは次Phaseで判断）。

## 9. tests

`src/benchmarks/plannerGlobalPhase2C26B2C2B2G.test.ts`（20件）：B2-C2B2F formal RESULT authority parse（SHA / case / dominant / Stage 1 / instrumentation /
chain / identity / excluded Routeでfail-close）、population = B2-C2B2F profiling対象1件かつB2-C2B2E再導出と一致（Target / task / rank / extentのhard-codeなし）、
manifest（probe + identityのみ）、条件（12,288 MB / 1,800,000 ms / concurrency 1 / retry・fallbackなし / 2 observerのみ / CPU profilerなし / inner section =
`RESERVED_GOGMA_RUNTIME_PHASES`）、identity gate、B2-C2B2D task / Search本体とのline-for-line同一性、**semantics neutrality**（同一world・同一taskで
A：instrumentationなし（B2-C2B2D）、B：onSearchRuntimeのみ（B2-C2B2F）、C：onSearchRuntime + onGogmaReservedRuntimeのrecordが完全一致：Candidate stable key・順序・
summary・termination・stoppedByConsumer / stoppedByExtent・excluded Route。Searchへ渡るinstrumentation keyも確認）、A3 / A4 tracker契約、timeout時のopen outer stack・
active inner depth / phase保持、inner section相互排他（overlapは違反）、open read外のinner境界の検出、inner coverage・remainder・splitの算出とdouble countなし、
同一凍結時刻、yield帰属、decision境界（0.90 / 0.50 / 0.20 / 60 s）、window、depth record収集、start attestation、Production import / oracle child isolation、
committed RESULT固定。A3 / A4 / A7のSearch-level neutrality testはそのまま有効。

## 10. 未検証事項・limitation

- 単一run（ばらつき未評価）。Node / Vite SSRでの計測で、Browser Workerの計測ではない
- 30分でtimeoutしたため、Search全体ではなく最初の約30分（depth 69まで）のprofile。windowではsection構成がdepthとともに変化しており、30分以降の構成は未観測
- section内部（`state_generation` のどの処理か）は未計測。yield待ち時間にはsetImmediate 1往復中に走る他のmacrotask（memory sampling、heartbeat書き込み）が含まれる
- observer追加の影響を受けるため、B2-C2B2Fとのthroughput比較から性能結論は出さない
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない

## 11. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B2F RESULT（population source / identity authority） | `b7b707bbf34a851131eba1a312f228f2948fb5c15d3a9ffad18443365279333d`（measured HEAD `dd41061d…`） |
| B2-C2B2E RESULT（chain先） | `5bf6bba389bb3c4f1089ddc9b079426930be203bd5e88f3d3f9b2032a42ecabe`（measured HEAD `e69a94ea…`） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| probe manifest | `1171d40039598129ea7da40cb6032051d7f8060b1e4d23d608a1cd6c8a4de858` |
| raw run / profile | `PLANNER_GLOBAL_PHASE2C26B2C2B2G_RAW.json.local` `2f0af481…` / `stage1-t02-r11.profile.jsonl` `3c0aa7d9…`（.local、未commit） |
