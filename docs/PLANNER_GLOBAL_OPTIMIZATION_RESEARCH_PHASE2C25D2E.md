# Global Planner Research Phase 2-C2.5-D2-e（H1後のChrome Dedicated Worker正式再測定）

Issue #154 Global Planner Researchの一部。Research only。Production source、Search semantics、defaults、schema / version、Persistence、UIは
変更していない。

## 1. 結論

Phase 2-C2.5-D2-dでheld-aware Bonus streamのpast depth raw solution保持（H1）を除去した現在のProduction Searchを、D2-bと同じChrome 153の
Dedicated Worker・同じ外部CDP観測・同じ事前登録分類規則・同じ5 context・同じ20分budgetで再測定した（10 run、1 page session、context parity
5 / 5、repeat 0件）。

| context | D2-dでの役割 | Browser before（D2-b） | **Browser after（D2-e）formal分類** | Node D2-d | Node D2-d parity |
| --- | --- | --- | --- | --- | --- |
| c0-p0#0 | cleared reference | browser_no_failure | **browser_no_failure**（両mode `stopped_by_extent_before_candidate`） | stopped_by_extent_before_candidate | 完全一致 |
| c12-p0#0 | primary（旧OOM） | inconclusive_page_or_browser_crash（4 / 4 renderer loss） | **browser_no_failure**（両mode `stopped_by_extent_before_candidate`） | stopped_by_extent_before_candidate | 完全一致 |
| c2-p1#0 | primary（旧OOM） | inconclusive_page_or_browser_crash（4 / 4 renderer loss） | **browser_no_failure**（両mode `first_candidate`） | first_candidate | 完全一致 |
| c8-p1#0 | control（first Candidate） | browser_no_failure | **browser_no_failure** | first_candidate | 完全一致 |
| c13-p4#0 | control（extent stop） | browser_no_failure | **browser_no_failure** | stopped_by_extent_before_candidate | 完全一致 |

- C2.5-B / D2-bの全体規則（OOM代表3 contextの分類）による **formal verdict は `not_reproduced`**。semantic failureは0件。
  それと並べて追加したsummaryは **`browser_no_failure_all_selected_contexts`**。
- renderer loss 0、browser loss 0、native Worker failure 0、structured error 0、timeout 0、explicit V8 OOM crash key 0。
- 「完全一致」は、全10 runでNode D2-dとstatus・Search summary・first Candidate key SHA-256・extent / exhausted、instrumentedではさらに
  prediction countsとfinal progress（Gogma max depth、累積generated / frontier、max generated per depthとそのdepth、Skill max depth / states、
  settled work）がすべて一致したことを指す。

**formalに言えること**: H1後、c12-p0#0とc2-p1#0はChrome Dedicated WorkerでもD2-bの旧renderer lossを再現せず、Node D2-dと同じSearch
terminationまで完了した。今回測定した5 contextでは、H1後のChrome Dedicated Worker Search-only runはすべて正常終了し、Node D2-dと
Candidate-visible semanticsが一致した。

**まだ言えないこと**: 「Global Planner memory問題は完全に解決した」。測ったのはSearch-only runだけで、Global Planner kernel全体
（portfolio、trial、full run）、他のPhase 2-C2 OOM orientation、他のbrowser / deviceは測っていない（§10）。

**次Phase推奨**: Search-only memory問題からGlobal Planner kernel全体のformal再評価へ戻る（§11）。ただしc12-p0#0は正常終了しても
Search-onlyで約9分かかったため、generation量 / H6 runtime最適化を検討対象として記録する（実装はしない）。

## 2. 目的とauthority

目的は、D2-dのNode 8 GB上の改善（primary 2件がOOMを脱して正常終了）がChrome Dedicated Workerでも再現するか、Node D2-dとSearch semanticsが
一致するかを、D2-bと同一の保守的なBrowser failure classificationで確認することである。Production optimizationは追加していない。

参照した順: `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md`（5.6.8）、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2D.md`、
`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2B.md`、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25B.md`、current implementation、tests。

## 3. workloadとD2-d reference

### 3.1 D2-d RESULTのformal reference検証

committed `PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json`（SHA-256 `da131978cb7fd479a221669ce5eb5620fb8886dd970203de94a482af81f0bc8d`、measured HEAD
`aebe6bbb2e52ca59641fb70b25754de0a76b78c5`）を `parsePhase2C25D2EReference()` で読み、次をfail closedで確認した（page読込時とanalyzerの両方）。

| 項目 | 要求 | 実値 |
| --- | --- | --- |
| `provenance.formal` | true | true |
| `formalRunValidation.valid` | true | true |
| contexts | 5 | 5 |
| `totals.primaryLeftOom` | 2 | 2 |
| `totals.primaryEndedNormally` | 2 | 2 |
| `totals.semanticParityWithD2A` | true | true |
| `totals.modeSemanticParityFailures` | 0 | 0 |

加えて `workloadSelection.unselected` が空で、各selection itemのroleが所属group（primary / clearedReferences / controls）と整合することを確認する。
1つでも外れればBrowser formal runは開始できない（pageはExportとevidenceを読み込めず、analyzerはRESULTを書かない。テストで確認）。

### 3.2 workloadの導出

sourceにorientation ID / Target IDを書かず、次の2つが一致することをfail closedで確認して導出した（`phase2c25d2eWorkload()`）。

1. D2-bと同じ規則: committed C2.5-A evidenceへ `phase2c25d2bWorkload()`（既存 `selectPhase2C25CWorkload()`）を再適用した5 context
2. D2-d RESULTの `workloadSelection`（primary 2、cleared reference 1、control 2）

両者で orientation・work index・Target・context digestが一致し、roleの系統（D2-dのprimary / cleared reference ⇔ D2-bのOOM代表、controlは同名）
も一致した。D2-d RESULTが同じExport（SHA-256）とC2.5-A evidence（SHA-256）を測ったことも確認する。結果（順序はD2-b規則の順）:

- c0-p0#0（D2-d cleared reference）
- c12-p0#0、c2-p1#0（D2-d primary、旧OOM）
- c8-p1#0（control、first Candidate）、c13-p4#0（control、extent stop）

## 4. Search inputとcontext parity

- Workerへ渡したSearch inputは、page sessionで元Export（`gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256
  `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`）をpure Research pathでPlannerInputにし、current Domainで再導出したものだけ
  である。D2-d / D2-bのCandidate、oracle、optimum Route、RESULT内のRoute stateは使っていない。D2-d RESULTとC2.5-A evidenceはworkload選択・
  照合・parity・post-hoc比較だけに使い、Workerへは渡らない（テストでpost内容を検査）。
- ExportとC2.5-A evidenceは、D2-d RESULTが記録したSHA-256と一致しなければpageが読み込まない。
- Search開始前に、D2-bと同じcontexts Worker（fresh）がworkload 5 orientationのpre-search contextを再導出し、C2.5-A evidenceと
  orientationId・kind・workIndex・targetWeaponId・status・invalidatedBuildListEntryId・invalidatedRouteKey（SHA-256）・
  fixedRouteBuildListEntryIds・reservation・excludedRouteKeys（SHA-256）・extent・originDigest・contextDigestを比較した。
- 今回のformal runはpage lossが無く1 page sessionで完了し、そのsessionで **13 / 13行一致、workload 5 / 5一致**、baseline summary一致。
  workload 5 contextのcontext digestはD2-d RESULTの `workloadSelection` とも一致する（§3.2）。不一致ならformal Searchを開始しない。

## 5. 実行条件

| 項目 | 値 |
| --- | --- |
| extent | Production default `{ Normal 4, Gogma 235, Skill 4 }`（変更なし） |
| candidate stop | 1（first Candidate） |
| Worker | 1 run = 1 fresh Dedicated Worker、run後terminate、concurrency 1 |
| mode | minimal / instrumented（既存 `createCountingRngEngine` + `createPlannerAlternativeSearchObserver`、sparse snapshot） |
| snapshot policy | D2-bと同一（heartbeat 2,000 ms、depth step 5、heap growth 256 MiB、first Candidate直前、終了時 `final`） |
| Search | 現在のProduction `visitPlannerAlternativeCandidates()`（D2-dのsingle-pass held-aware Bonus streamを含む）。D2-e固有のSearch実装はない |
| first Candidate notice | final resultより先にmain threadへnotice（D2-bと同一） |
| repeat policy | C2.5-B / D2-bと同一（attempt 1 pairにpage / browser crash、native Worker failure、mode分類不一致、CDP attach failureがある時だけattempt 2、最大2 attempt） |
| Search run budget | 20分（`PHASE2C25B_RUN_BUDGET_MS`、D2-bと同一。延長していない） |
| external driverのrun待機 | 22分 = page budget 20分 + 固定margin 2分（D2-bと同一値。page環境に `driverRunBudgetMs` として記録し、driverが一致を確認） |
| Browser heap上限 | 設定していない（Chrome既定） |

## 6. 実装（Research only）

D2-bのcodeは複製せず、C2.5-B runner / controllerをD2-bと同じ注入点で再利用した。

- **wire namespace**: `pg2c25d2e_benchmark_*`（`src/benchmarks/plannerGlobalPhase2C25D2EProtocol.ts`）。C2.5-Bのrequest / responseのprefixだけを
  renameする型付き変換。C2.5-B・D2-bのmessageは無視される。relay prefix `[pg2c25d2e]`、protocol version `planner-global-phase2c25d2e`、
  record ID `pg2c25d2e-record-*`。`PHASE2C25D2E_RUN_BUDGET_MS` はC2.5-Bの20分をそのまま参照し、`PHASE2C25D2E_DRIVER_RUN_BUDGET_MS` はそれに固定margin 2分を足した値。
- **Worker**: `src/workers/plannerGlobalPhase2C25D2E.worker.benchmark(.entry).ts`。C2.5-Bの `createPhase2C25BController()` を無変更で使い、
  入出力だけD2-e wireに変換する。Engineは既定の `ProductionRngEngine`。
- **runner**: `src/benchmarks/plannerGlobalPhase2C25D2EHarness.ts`。C2.5-Bの `createPhase2C25BRunner()` に `phase`（protocol version、record ID prefix、
  workload）を渡す。D2-d RESULTを先に読み（formal reference検証）、Export / evidenceのSHA-256をD2-d RESULTと照合してから既存loaderへ渡す。
  page exportにはD2-d RESULTのfile identity（`d2dReferenceInfo`）を追記する（既存fieldは変更しない）。
- **workload**: `src/benchmarks/plannerGlobalPhase2C25D2E.ts`（§3）。
- **分類・merge・repeat・formal series**: C2.5-Bの `mergePhase2C25BRun()`、`phase2c25bPairClassification()`、`phase2c25bLostDuringSearchBeforeFirstCandidate()`、
  `phase2c25bRepeatDecision()`、D2-bの `validatePhase2C25D2BFormalSeries()`・`phase2c25d2bRunMetrics()`・`phase2c25d2bNodeParity()`・
  `phase2c25d2bProgressDelta()` を無変更で使う。
- **analysis**: `src/benchmarks/plannerGlobalPhase2C25D2EAnalysis.ts`（D2-d RESULTのNode view、D2-b RESULTのBrowser before view、instrumented
  final progress parity、CDP detail、全context acceptance、statements）。`scripts/analyze-planner-global-phase2c25d2e.mjs` は純粋なpost-hoc
  analyzerで、Search / Plannerを実行しない。
- **page**: `src/pages/PlannerGlobalPhase2C25D2EBenchmarkPage.tsx`（console API `globalThis.plannerGlobalPhase2C25D2EBenchmark`）。`BenchmarkApp` に
  ボタン1つを追加。`benchmark.html` からのみ到達し、Production routeからは到達しない（テストで確認）。

## 7. 外部CDP driver

D2-bのscratch driver（SHA-256 `1594465c43b4c459d200f4145f15721e31ae351fc8f841f5fb7ad267dcf26065`、そのbaseはC2.5-B
`501b2e1eb85c585d32d5ea78902d3509dc50661de0e1402a4c00804946914ba1`。ローカルに残っていた）を基礎にした。

- 変更内容: page identityの定数（D2-eタブ名、console API名、relay prefix、file input ID）、D2-d RESULTを最初にpageへ渡すfile input（`--d2d`）、
  page session準備後に「driverのrun待機 = pageが記録した `driverRunBudgetMs`、かつpage Search budgetより長い」ことを確認して外れればfail closedで
  停止する検査、`driver.base` へのbase / root SHA-256記録。観測（headed Chrome、専用profile、`--disable-backgrounding-occluded-windows`、
  target discovery / auto-attach flatten、約500 ms間隔の `Runtime.getHeapUsage`（1要求5 s timeout、並列samplingなし）、lifecycle / crash検出、
  crash dump key抽出、page loss後の新page session、pageの `repeatDecision()`）は無変更。Search計算ロジックはdriverに入っていない。
- 新SHA-256: `f2a7fd606f4bc0c3417f53e76905b044c8afdd0983eee75c473a8e38484703b9`（external evidenceに記録）。commitしない。
- 今回page lossが無かったため、Crashpad dumpの確認対象run・新規dumpは0件。`.dmp` はcommitしない。

### 7.1 formal前の確認（非formal、evidenceに含めない）

- **run待機の検査（synthetic）**: `--run-budget-ms 1200000`（page budgetと同値）で起動すると、準備直後に
  `Driver run wait 1200000 ms is not the page's driverRunBudgetMs 1320000` でfail closedに停止した（Searchは開始しない）。
- **smoke 1**: c13-p4#0の両mode（`--only`）。両mode正常終了し、非formal解析でNode D2-d parity（final progress含む）が成立することを確認。
- **smoke 2（長時間run）**: c2-p1#0 minimalのみ（`--only`、`--no-repeat`）。約188 sのSearch中にdriverがrunを打ち切らず、heap sample 366件・
  sample error 0件で正常終了した。
- formal前に、D2-bセッションで起動されたまま残っていた古いbenchmark preview server（port 4179）2プロセスを停止し、measured HEADのbuildで
  preview serverを起動し直した。

### 7.2 formal run completenessの検証

D2-bの `validatePhase2C25D2BFormalSeries()` を、D2-e workloadとexternal evidenceへ無変更で適用した（analyzerはanalysisより前に実行し、不完全なら
RESULTを書かずerror終了）。結果: valid、workload 5 context、expected 10 run（= 5 × 2、repeat 0 context）= actual 10 run、duplicate runKey 0、
duplicate logical run 0、missing / unexpected / foreign / attempt > 2 なし、repeat decision 5 / 5（欠落・重複・余計・不一致なし）、driver issueなし
（modes exactly minimal + instrumented、`allowRepeat = true`、`only = null`、`completedAt` あり）。

## 8. 結果

### 8.1 run一覧（10 run、1 page session）

| context | minimal | instrumented | Node D2-d（minimal / instrumented） |
| --- | --- | --- | --- |
| c0-p0#0 | stopped_by_extent_before_candidate（Search 23.2 s） | stopped_by_extent_before_candidate（13.9 s） | 30.9 s / 31.4 s |
| c12-p0#0 | stopped_by_extent_before_candidate（547.7 s = 9.1分） | stopped_by_extent_before_candidate（551.0 s = 9.2分） | 867.6 s / 903.0 s |
| c2-p1#0 | first_candidate（179.9 s） | first_candidate（185.5 s） | 305.7 s / 314.9 s |
| c8-p1#0 | first_candidate（2.5 s） | first_candidate（2.1 s） | 4.2 s / 4.2 s |
| c13-p4#0 | stopped_by_extent_before_candidate（1.2 s） | stopped_by_extent_before_candidate（1.3 s） | 2.0 s / 2.0 s |

- repeat decisionは5 contextすべて `repeat: false, reasons: []`（attempt 2なし）。
- first Candidate到達run 4（c2-p1#0とc8-p1#0の両mode）、renderer（page）loss 0、browser loss 0、native Worker failure 0、structured error 0、
  timeout 0、explicit V8 OOM crash key 0。
- wall timeは各1 runの参考値であり、Browser / Nodeの速度比は主張しない（§10）。

### 8.2 Node D2-d parity

全10 runで `phase2c25d2bNodeParity()` がapplicableかつ一致（status、Search summary、first Candidate key SHA-256、extent / exhausted、instrumented
prediction counts）、instrumented 5 runで `phase2c25d2eProgressParity()`（Browser `final` snapshot対Node D2-dの最終progress）が全field一致した。

| context | status | first Candidate key | prediction counts（N / S / Reset / Keep） | final progress（Gogma depth / 累積generated / 累積frontier / max per depth @depth / Skill depth・states / settled） |
| --- | --- | --- | --- | --- |
| c0-p0#0 | stopped_by_extent_before_candidate | null | 4 / 5 / 233 / 25,474 | 233 / 2,360,100 / 2,331,740 / 18,558 @218 / 4・8 / 1,410 |
| c12-p0#0 | stopped_by_extent_before_candidate | null | 4 / 4 / 234 / 26,719 | 234 / 125,904,312 / 21,126,394 / 1,964,741 @3 / 3・16 / 1,886 |
| c2-p1#0 | first_candidate | `fffec72ab6b58d8ff06a7ee0e549e5d4647bedc2694a03bbb78e6323ae15115c` | 4 / 5 / 160 / 13,173 | 63 / 55,433,083 / 3,602,677 / 1,256,560 @3 / 4・8 / 503 |
| c8-p1#0 | first_candidate | `39d2d78787b6…`（Node D2-dと同一） | 4 / 5 / 119 / 6,079 | 101 / 493,595 / 450,388 / 7,410 @96 / 0・0 / 500 |
| c13-p4#0 | stopped_by_extent_before_candidate | null | 4 / 4 / 234 / 25,874 | 234 / 125,860 / 125,690 / 1,005 @233 / 3・16 / 1,184 |

Search summaryは、extent stopのcontextでdelivered 0・excluded 0・exhausted false・stoppedByExtent true・stoppedByConsumer false・skippedExcludedRouteKeys 0、
first Candidateのcontextでdelivered 1・stoppedByConsumer true・exhausted false・stoppedByExtent falseで、いずれもNode D2-dと完全一致。
比較値はすべてcommitted D2-d RESULTから読み、runtime sourceにはhard-codeしていない。

### 8.3 primary（c12-p0#0 / c2-p1#0）: Browser before（D2-b）→ after（D2-e）

| 指標 | c12-p0 before | c12-p0 after | c2-p1 before | c2-p1 after |
| --- | --- | --- | --- | --- |
| formal分類 | inconclusive_page_or_browser_crash | **browser_no_failure** | inconclusive_page_or_browser_crash | **browser_no_failure** |
| status | 4 / 4 page_crashed | 両mode stopped_by_extent_before_candidate | 4 / 4 page_crashed | 両mode first_candidate |
| attempt数 | 2（repeat） | 1 | 2（repeat） | 1 |
| explicit V8 OOM crash key | 4 / 4 run | 0 | 4 / 4 run | 0 |
| Search開始→loss / 終了 | loss 40.8–49.9 s | 終了 547.7 s / 551.0 s | loss 44.2–55.8 s | 終了 179.9 s / 185.5 s |
| Worker lifetime | 41.8–51.0 s | 548.8 s / 552.1 s | 45.2–56.9 s | 181.0 s / 186.6 s |
| CDP sample数 | 77–85 | 1,073 / 1,088（error 0） | 84–94 | 357 / 368（error 0） |
| CDP sampled max used heap | 3.28–3.39 GiB | 2.21 GiB / 2.15 GiB | 3.25–3.31 GiB | 0.62 GiB / 0.66 GiB |
| sampled max時点（Worker作成から） / その時のtotal | — | 479.0 s・2.33 GiB / 482.0 s・2.26 GiB | — | 160.1 s・0.67 GiB / 151.4 s・0.72 GiB |
| last successful heap sample（used / total） | 3.21–3.38 GiB | 0.57 / 1.88 GiB、0.45 / 1.87 GiB | 3.18–3.31 GiB | 0.33 / 0.60 GiB、0.19 / 0.64 GiB |
| Gogma depth（instrumented） | 12（最後に受信したsnapshot） | 234（終了） | 17 | 63（終了） |
| 累積Gogma generated | 16,918,625 | 125,904,312 | 16,975,980 | 55,433,083 |
| 累積Gogma frontier | 531,770 | 21,126,394 | 640,070 | 3,602,677 |
| max generated per depth | 1,964,741（depth 3） | 1,964,741（depth 3） | 1,256,560（depth 3） | 1,256,560（depth 3） |
| settled work | 99 | 1,886 | 138 | 503 |
| prediction counts（N / S / Reset / Keep） | 4 / 4 / 125 / 8,214 | 4 / 4 / 234 / 26,719 | 4 / 5 / 114 / 6,989 | 4 / 5 / 160 / 13,173 |
| first Candidate | なし | なし（extent stop） | なし | あり（key `fffec72a…115c`） |

- beforeのloss時にV8 OOM crash keyがあった（`MarkCompactCollector: young object promotion failed` 7件、`CALL_AND_RETRY_LAST` 1件）のに対し、
  afterはrenderer lossもcrash dumpも無い。
- 記述的な進行比（after / before、instrumented）: c12-p0はdepth 19.5倍・累積generated 7.4倍・frontier 39.7倍・settled 19.1倍、c2-p1はdepth 3.7倍・
  累積generated 3.3倍・frontier 5.6倍・settled 3.6倍。これは「beforeのloss時点に比べてSearchがどこまで進んだか」の比で、memory効率の倍率ではない。
- max generated per depth（depth 3の生成burst、c12で1,964,741 state）はH1の前後で同じで、H1が除去したのはpast depthのraw solution保持だけである
  ことと整合する。

### 8.4 cleared reference（c0-p0#0）とcontrols

| context | before（D2-b） | after（D2-e） | Browser after sampled max heap（minimal / instrumented） | before sampled max heap |
| --- | --- | --- | --- | --- |
| c0-p0#0 | browser_no_failure（24.9 s / 19.6 s） | browser_no_failure（23.2 s / 13.9 s） | 0.55 / 0.54 GiB | 2.09 / 1.95 GiB |
| c8-p1#0 | browser_no_failure | browser_no_failure | 0.27 / 0.23 GiB | 0.40 / 0.36 GiB |
| c13-p4#0 | browser_no_failure | browser_no_failure | 0.21 / 0.20 GiB | 0.29 / 0.27 GiB |

3 contextとも両modeのBrowser semantic digestが一致し、Node D2-dとのparityも全fieldで成立した（既存の正常caseはH1後も壊れていない）。

## 9. heap limitの境界

- **CDP**: Dedicated Worker targetへの `Runtime.getHeapUsage` は、Worker used heap（未回収garbageを含む）の約500 ms間隔のsampleである。
  primary runのsampled最大値はrunごとに0.62–2.21 GiB、全run最大2.21 GiB（2,370,730,460 bytes、c12-p0#0 minimal）。連続的なpeakやtrue peakではない。
- **page realm**: `performance.memory.jsHeapSizeLimit` は4,395,630,592 bytes（約4.09 GiB）だった。これは別realm（page）の参考値である。
- **Dedicated Worker自身のheap limit**: Worker realmは `performance.memory` を公開しなかったため **unknown**（未測定）である。page realmの値と
  同一視しない。「Browser Workerのheap上限 ≈ 4 GiB」とは言わない。
- Node 8 GBの上限、Nodeのheap bytesとは直接比較しない。

## 10. formalに言えること / まだ言えないこと

言えること（RESULTの `statements.formal` と同内容）:

1. Search前に、page sessionでworkloadのpre-search contextが元Exportから再導出され、C2.5-A evidenceとfield単位で一致した。workloadはD2-d RESULTの
   `workloadSelection` と一致した。
2. formal分類（C2.5-B / D2-b規則、無変更）: 5 contextすべて `browser_no_failure`。代表verdict `not_reproduced`、summary
   `browser_no_failure_all_selected_contexts`。
3. **H1後、c12-p0#0とc2-p1#0はChrome Dedicated WorkerでもD2-bの旧renderer lossを再現せず、Node D2-dと同じSearch termination
   （それぞれ `stopped_by_extent_before_candidate`、`first_candidate`）まで完了した。**
4. **今回測定した5 contextでは、H1後のChrome Dedicated Worker Search-only runはすべて正常終了し、Node D2-dとCandidate-visible semanticsが一致した。**
5. 補助: explicit V8 OOM crash keyを持つrunは0件、renderer lossは0件。
6. Browser before → after（観測値）: primaryのsampled max used heapは、D2-bのloss時3.25–3.39 GiBから、D2-eの正常終了runで0.62–2.21 GiB。

まだ言えないこと:

- 「Global Planner memory問題は完全に解決した」。Global Planner kernel全体（portfolio、trial、full run、runtime-unsupported retry）、
  他のPhase 2-C2 OOM orientation、他のbrowser / deviceは未測定。
- CDP sampleからのmemory効率の倍率（sampleは約500 ms間隔で未回収garbageを含み、GC timingに依存し、beforeはloss時点・afterは正常終了で
  終了地点が異なる）。§8.3の比は進行の比である。
- Dedicated Worker自身のheap limit（unknown）。
- Nodeとのheap比較。
- Browser / Nodeの速度比（各1 run）。今回BrowserのほうがNode D2-dより短いwall timeだったが、参考値に留める。

## 11. runtimeの解釈と次Phase recommendation

### 11.1 runtime（Q6）

正常終了はしたが、Production利用として現実的とは言いにくい。c12-p0#0は1 Target・1 contextのSearch-onlyで約9.1–9.2分、c2-p1#0で約3分かかった。
Global Planner kernelはこれを複数Targetのtrialとfull runの中で繰り返すため、kernel全体のwall timeはさらに長くなりうる（未測定）。
analyzerが事前に固定した機械的な判定（primaryのSearch elapsed ≥ page budgetの半分 = 10分で `runtimeNote` を立てる）には、c12-p0#0の約9.1分は
届かなかった（`runtimeNote = null`）。ただしこれは閾値に届かなかったというだけで、上の理由から、generation量（c12でdepth 3の1,964,741 stateを含む
累積125,904,312 state生成）/ H6 runtime最適化を **検討対象として記録** する。本PRでは実装しない。

### 11.2 次Phase

primary 2件ともBrowserで正常終了したため（analyzer `nextPhase.recommendation = A_return_to_global_planner_kernel_formal_reevaluation`）、
**Search-only memory問題から、Global Planner kernel全体のformal再評価へ戻る** ことを第一候補とする。具体的には、current Productionで
Phase 2-C2のportfolio / kernelを再実行し、

- OOM orientation数、
- found / extent / trial-boundの内訳、
- global Candidate coverage

を再確認する。その前後で、c12-p0#0型の長いSearch-only runtime（§11.1）に対するgeneration量 / H6 runtime最適化を検討する。kernel再測定と
最適化は本PRでは行わない。

## 12. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| measured HEAD | `5739b5ce1468c74477b1e85c14be8e3ebaefe354`（D2-e harness commit。formal前に全Research codeをcommitし、Working Tree clean） |
| analysis HEAD | `5739b5ce1468c74477b1e85c14be8e3ebaefe354`（`calculationCodeChangedSinceMeasuredHead` 0件） |
| benchmark build | `uncommittedBenchmarkCode = false`、`benchmarkCodeSha256` `a872a0c23f0dbcf1683d4a499ad415195b412ac4febd26fc0bb35935178fe1b9` |
| 測定開始 | 2026-09-29T09:14:05Z（driver）、所要約25.5分 |
| Chrome | Chrome/153.0.8010.49（headed、専用profile、`--disable-backgrounding-occluded-windows`）、visibility visible |
| machine | win32 x64、AMD Ryzen 7 9700X（16 logical）、RAM 33,377,591,296 bytes |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| C2.5-A evidence | `PLANNER_GLOBAL_PHASE2C25A_RESULT.json`、SHA-256 `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd` |
| D2-b RESULT（Browser before） | SHA-256 `ce73520dce6b0ddaa94ec0d8bc8f565a49984f1aa1e42ccf1ad6c321cd3c4402` |
| D2-d RESULT（Node reference） | SHA-256 `da131978cb7fd479a221669ce5eb5620fb8886dd970203de94a482af81f0bc8d`、measured HEAD `aebe6bbb2e52ca59641fb70b25754de0a76b78c5` |
| external driver | SHA-256 `f2a7fd606f4bc0c3417f53e76905b044c8afdd0983eee75c473a8e38484703b9`（base: D2-b `1594465c…`、root: C2.5-B `501b2e1e…`） |
| page session | 1 |
| raw Browser evidence | `PLANNER_GLOBAL_PHASE2C25D2E_BROWSER_RESULTS.json`、SHA-256 `2953e44e6a0e786059a41d33e07977fb47c6fd7b1107b13adcbbea14c811624a` |
| raw external evidence | `PLANNER_GLOBAL_PHASE2C25D2E_EXTERNAL_MEMORY.json`、SHA-256 `66bb0a4be377132b1de0232caf5f9fa2f3cd85ac98b37af56494c0af2da4262f` |

Production変更は0件（`bonusStream.ts`、`targetSearchScheduler.ts`、`skillStream.ts`、`lazyIdealCross.ts`、Planner Alternative、Planner、RNG、Production
Worker、defaults、schema / version、Persistence、UIはいずれも未変更）。D2-dのsingle-pass testsも変更していない。

## 13. 成果物

- [PLANNER_GLOBAL_PHASE2C25D2E_RESULT.json](PLANNER_GLOBAL_PHASE2C25D2E_RESULT.json): post-hoc analysis（provenance、条件、parity、workload、
  formalSeriesValidation、context別分類・Node D2-d parity・final progress parity・CDP detail・before / after、totals、verdict、statements）。
- [PLANNER_GLOBAL_PHASE2C25D2E_BROWSER_RESULTS.json](PLANNER_GLOBAL_PHASE2C25D2E_BROWSER_RESULTS.json): page `exportJson()` のverbatim（raw）。
- [PLANNER_GLOBAL_PHASE2C25D2E_EXTERNAL_MEMORY.json](PLANNER_GLOBAL_PHASE2C25D2E_EXTERNAL_MEMORY.json): driverのexternal evidence（raw）。
- raw（commitしない、scratchpad）: driver出力一式、Chrome profile、driver本体。

再解析は、raw evidenceを書き換えずbyte-for-byte検証する（既存fileと異なればerror）。

```text
node <scratch>/cdp-driver.mjs --d2d docs/PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json --export <Export.json> --evidence docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --out-dir <new dir>
node scripts/analyze-planner-global-phase2c25d2e.mjs --run-dir <driver out dir> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json \
  --d2b docs/PLANNER_GLOBAL_PHASE2C25D2B_RESULT.json --d2d docs/PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json --output <result.json> \
  --browser-output docs/PLANNER_GLOBAL_PHASE2C25D2E_BROWSER_RESULTS.json --external-output docs/PLANNER_GLOBAL_PHASE2C25D2E_EXTERNAL_MEMORY.json
```
