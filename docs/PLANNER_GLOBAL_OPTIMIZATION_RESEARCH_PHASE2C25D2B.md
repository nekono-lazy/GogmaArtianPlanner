# Global Planner Research Phase 2-C2.5-D2-b（Ideal-only publication後のChrome Dedicated Worker再測定）

Issue #154 Global Planner Researchの一部。Research only。Production source、Search semantics、defaults、schema / version、Persistence、UIは
変更していない。

## 1. 結論

Phase 2-C2.5-D2-aで実装したPlanner Alternative Ideal-only publicationの後、D2-aと同じ5 contextを、Phase 2-C2.5-Bと同じChrome 153の
Dedicated Worker・同じ外部CDP観測・同じ事前登録分類規則で再測定した（14 run、context parity 5 / 5、controlのsemantic parity 2 / 2）。

| context | 役割 | Browser before（C2.5-B） | **Browser after（D2-b）formal分類** | Node D2-a |
| --- | --- | --- | --- | --- |
| c0-p0#0 | OOM代表（deep） | inconclusive_page_or_browser_crash | **browser_no_failure**（両mode `stopped_by_extent_before_candidate`） | stopped_by_extent_before_candidate |
| c12-p0#0 | OOM代表（shallow） | inconclusive_page_or_browser_crash | **inconclusive_page_or_browser_crash**（2 attempt × 2 mode、全4 runでrenderer loss） | out_of_memory |
| c2-p1#0 | OOM代表（shallow） | inconclusive_page_or_browser_crash | **inconclusive_page_or_browser_crash**（2 attempt × 2 mode、全4 runでrenderer loss） | out_of_memory |
| c8-p1#0 | control（first Candidate） | browser_no_failure | **browser_no_failure** | first_candidate |
| c13-p4#0 | control（extent stop） | browser_no_failure | **browser_no_failure** | stopped_by_extent_before_candidate |

全体のformal verdictは **`mixed`**（C2.5-Bの全体規則: 代表の分類が揃わない）。semantic failureは0件。

- **formalに言えること**: D2-a Ideal-only publication後、c0-p0#0はChrome Dedicated WorkerでもC2.5-Bの旧renderer lossを再現せず、
  minimal / instrumentedとも `stopped_by_extent_before_candidate` まで完了した。status・Search summary・first Candidate key（null）・
  extent / exhausted・instrumented prediction countsはNode D2-aと一致した。
- **言えないこと**: 「Browser OOM問題は解消した」。shallow型のc12-p0#0 / c2-p1#0は、D2-a後もChrome Dedicated Workerで
  first Candidate前にrenderer lossした（formal `inconclusive_page_or_browser_crash`。全8 runのrenderer crash dumpに明示的なV8 OOM crash
  key、補助ラベル `explicit_v8_oom_crash_key`）。これは明確な残課題である。
- **次Phase推奨**: shallow型のpage lossが続くため、C2.5-Cと同じ手順（Node sampling heap profile / low-heap snapshot）をD2-a後のcodeで
  再実行する **post-D2 heap localization** へ進む。stream optimizationはまだ実装しない（§11）。

## 2. 目的とauthority

目的は、D2-aのNode上の改善がChrome Dedicated Workerでも再現するかを、C2.5-Bと同一の保守的なBrowser failure classificationで確認する
ことである。Production Searchの追加最適化は行わない。

参照した順: `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md`（5.6.8）、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2A.md`、
`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25B.md`、current implementation、tests。Search semanticsは変更していない。

## 3. workload

D2-aと完全に同じ5 context。sourceにorientation ID / Target IDを書かず、committed `PLANNER_GLOBAL_PHASE2C25A_RESULT.json` を既存の
`parsePhase2C25CEvidence()` で読み、既存の `selectPhase2C25CWorkload()` 規則で導出した（`phase2c25d2bWorkload()`）。

- OOM representatives: C2.5-A evidenceで `role = oom_representative`、`classification = search_only_oom_reproduced`、両mode `out_of_memory` の全context
  → c0-p0#0、c12-p0#0、c2-p1#0
- controls: evidenceの順で、両mode `first_candidate` の最初のcompleted control（c8-p1#0）と、両mode `stopped_by_extent_before_candidate` の
  最初のcompleted control（c13-p4#0）

導出結果はD2-a RESULTの `workloadSelection`（順序・context digest）と一致する（テストで確認）。

## 4. Search inputとcontext parity

- Workerへ渡すSearch inputは、各page sessionで元Export（`gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5b…e1e6b`）を
  pure Research pathでPlannerInputにし、current Domain（`derivePhase2C25APreSearchContexts()`）で再導出したものだけである。
  C2.5-AのCandidate、C2.5-B / D2-aの結果、oracle、optimum Routeは使っていない。evidenceはworkload選択・parity・post-hoc比較だけに使い、
  Workerへは渡らない（テストでpost内容を検査）。
- Search開始前に、contexts Worker（fresh）がworkload 5 orientationのpre-search contextを再導出し、C2.5-A evidenceと
  orientationId・kind・workIndex・targetWeaponId・status・invalidatedBuildListEntryId・invalidatedRouteKey（SHA-256）・
  fixedRouteBuildListEntryIds・reservation（range形式）・excludedRouteKeys（SHA-256）・extent・originDigest・contextDigestを比較した。
  parity行はworkload 5 orientationの全記録context（c13-p4は9 context）＝13行で、workload 5 contextはその部分集合。
- 9 page session（初回 + page loss後の再準備8回）すべてで **13 / 13行一致、workload 5 / 5一致**、baseline summary一致。
  不一致ならformal Searchを開始しない（fail closed、テストで確認）。

## 5. 実行条件

| 項目 | 値 |
| --- | --- |
| extent | Production default `{ Normal 4, Gogma 235, Skill 4 }`（変更なし） |
| candidate stop | 1（first Candidate） |
| Worker | 1 run = 1 fresh Dedicated Worker、run後terminate、concurrency 1 |
| mode | minimal（計測なし、first Candidate noticeのみ）/ instrumented（既存 `createCountingRngEngine` + `createPlannerAlternativeSearchObserver`、sparse snapshot） |
| snapshot policy | heartbeat 2,000 ms、depth step 5、heap growth 256 MiB（Worker realmに `performance.memory` が無く不発）、first Candidate直前、終了時（C2.5-Bと同一） |
| Search | 現在のProduction `visitPlannerAlternativeCandidates()`（D2-aのIdeal-only publicationを含む）。D2-b固有のSearch実装はない |
| first Candidate notice | Workerはfirst Candidateで、final resultより先にnoticeをmain threadへ送る（C2.5-Bと同一） |
| repeat policy | C2.5-Bと同一: attempt 1のpairにpage / browser crash、native Worker failure、mode分類不一致、semantic digest不一致、CDP attach failureがある時だけ同contextをattempt 2でもう1回（最大2 attempt）。正常pairは繰り返さない |
| run予算 | page 20分 / driver 22分（timeout 0件） |
| Browser heap上限 | 設定していない（Chrome既定） |

## 6. 実装（Research only）

C2.5-Bのharnessをcopyせず、最小限の注入点で再利用した。

- **wire namespace**: `pg2c25d2b_benchmark_*`（`src/benchmarks/plannerGlobalPhase2C25D2BProtocol.ts`）。C2.5-Bのrequest / responseのprefixだけを
  純粋にrenameする型付き変換（template literal型）。Worker境界を越えるmessageはすべてD2-b名（テストで全messageを検査）、C2.5-Bのmessageは
  無視される。relay prefixは `[pg2c25d2b]`、Worker environmentの `protocolVersion` は `planner-global-phase2c25d2b`、record IDは `pg2c25d2b-record-*`。
- **Worker**: `src/workers/plannerGlobalPhase2C25D2B.worker.benchmark(.entry).ts`。C2.5-Bの `createPhase2C25BController()` をそのまま使い、
  入出力だけD2-b wireに変換する（Search、context再導出、first Candidate notice、observerはC2.5-Bのpure関数）。
- **runner**: `src/benchmarks/plannerGlobalPhase2C25D2BHarness.ts`。C2.5-Bの `createPhase2C25BRunner()` に任意の `phase`（protocol version・record ID
  prefix・workload）を渡す。`phase` を渡した時だけ、contexts Workerの導出とparityをworkloadのorientationに絞る
  （`phase2c25bEvidenceForOrientations()`）。`phase` 省略時のC2.5-Bの挙動は不変（C2.5-Bの既存テストは無変更で通過）。
- **heap wording**: C2.5-Bの `phase2c25bWorkerHeapLimitStatement()` に、sample時点の表現を差し替える任意引数 `sampledWhen` を追加（既定値は
  C2.5-Bの "before the renderer loss" のまま）。D2-bでは代表runが正常終了とlossの両方を含むため、D2-b用の表現を渡す。
- **分類・merge・repeat**: C2.5-Bの `mergePhase2C25BRun()`、`phase2c25bPairClassification()`、`phase2c25bLostDuringSearchBeforeFirstCandidate()`、
  `phase2c25bRepeatDecision()` を無変更で使う（分類規則を変更していない）。
- **analysis**: `src/benchmarks/plannerGlobalPhase2C25D2BAnalysis.ts`（Browser before → after、Node D2-a parity、controls、Node終了代表の受入判定、
  progress比較、statements）。`scripts/analyze-planner-global-phase2c25d2b.mjs` は純粋なpost-hoc analyzerで、Search / Plannerを実行しない。
- **page**: `src/pages/PlannerGlobalPhase2C25D2BBenchmarkPage.tsx`（console API `globalThis.plannerGlobalPhase2C25D2BBenchmark`）。`BenchmarkApp` に
  ボタン1つを追加。`benchmark.html` からのみ到達し、通常routeからは到達しない。pageの入力はExportとC2.5-A evidenceだけで、D2-a / C2.5-Bの
  結果はanalyzerだけが読む。

## 7. 外部CDP driver

C2.5-Bのscratch driver（SHA-256 `501b2e1eb85c585d32d5ea78902d3509dc50661de0e1402a4c00804946914ba1`、ローカルに残っていた）を基礎にした。

- 変更内容: page identityの定数だけ（D2-bタブ名、console API名、relay prefix、file input ID）と、external evidenceへのbase driver SHA-256記録
  （`driver.base`）。観測（`--disable-backgrounding-occluded-windows` のheaded Chrome、専用profile、browser target discovery、page sessionの
  auto-attach flatten・`waitForDebuggerOnStart: false`、約500 ms間隔の `Runtime.getHeapUsage`（1要求5 s timeout、in-flight中は次を送らない）、
  lifecycle / crash検出、crash dump key抽出、page loss後の新page session、pageの `repeatDecision()` によるrepeat判定）は無変更。
- 理由: D2-b pageはC2.5-Bと別のタブ・console API・relay prefix・file inputを持つため。
- 新SHA-256: `1594465c43b4c459d200f4145f15721e31ae351fc8f841f5fb7ad267dcf26065`（external evidenceに記録）。commitしない。
- Search計算ロジックはdriverに入っていない。raw target / session IDはevidenceへ書かずSHA-256だけ。
- page recordがあるrunはそれをstatusの権威とし、page lossしたrunはexternal evidenceだけで表す。driverはpage resultを推測・補完しない。
- page loss後は8 s待って新規Crashpad dumpを確認した。各lossのdumpはrun開始後のmtimeを持つ別々の1ファイル（8件、再利用なし）で、
  すべて `ptype = renderer`、loaded origin `http://127.0.0.1:4179`、`mentionsAllocationFailure = true`。`.dmp` 本体はcommitしない。

### 7.1 formal run completenessの検証

formal resultは、5 contextすべてについてattempt 1 minimal / instrumented pairが存在し、Phase 2-C2.5-B repeat ruleでrepeatが必要な2 contextだけ
attempt 2 pairが存在し、duplicate / missing / extra runおよびrepeat decision不一致がないことを、post-hoc analyzerでfail-closed確認した
（Required fix。Browser / Dedicated Workerの再測定はしていない）。

- 検証器: `validatePhase2C25D2BFormalSeries()`（`src/benchmarks/plannerGlobalPhase2C25D2BAnalysis.ts`、pure、Research only）。run集合のauthorityは
  external driver evidence（renderer lossしたrunにはpage recordが無いため）。入力はD2-a workload、external runs、external `repeatDecisions`、driver metadata。
- 要求: 各workload contextにattempt 1のminimal / instrumentedがexactly 1件ずつ。attempt 1 pairから既存 `phase2c25bRepeatDecision()` で
  （driverが観測したstatus・semantic digest・CDP attach failureから）decisionを再計算し、記録decisionの存在と一致を確認。repeat = falseならattempt 2は0件、
  trueならattempt 2 pairがexactly 1件ずつで、attempt 2 decisionは再計算でrepeat = false（記録と一致）。attempt ≥ 3、workload外context、duplicate runKey、
  同一context / mode / attemptのduplicate、minimal / instrumented以外のmode、実行pairごとのdecisionの欠落・重複、実行していないattemptのdecisionを拒否。
  driverは `modes` がexactly minimal + instrumented、`allowRepeat === true`、`only === null`、`completedAt` あり。page session数（今回9）とtimestamp順は条件にしない。
- expected run数はworkloadとrepeat ruleからderiveする（固定値なし）。
- 正式analyzer（`scripts/analyze-planner-global-phase2c25d2b.mjs`）は、analysisより前にこの検証を実行し、不完全ならRESULTを書かずに
  `Formal series incomplete: …` でerror終了する。したがってformal RESULTに `not_run` は出ない（`analyzePhase2C25D2B()` 自体はtest utilityとして
  `not_run` 表現を残す）。
- 今回のformal raw evidenceの結果（RESULT `formalSeriesValidation`）: valid、workload 5 context、expected 14 run（= 5 × 2 + repeat 2 context × 2）=
  actual 14 run、repeat context c12-p0#0 / c2-p1#0、duplicate runKey 0、duplicate logical run 0、missing / unexpected / foreign / attempt > 2 なし、
  repeat decision 7 / 7（欠落・重複・余計・不一致なし）、driver issueなし。
- 再解析では既存のraw Browser evidence（SHA-256 `146222dd…07fd`）とexternal evidence（SHA-256 `fe55d971…3e43`）を書き換えず、同じrun directoryから
  byte-for-byte再現されることだけを確認した（`rawEvidence.*.action = verified_unchanged`）。formal resultのtotals・verdict・context別分類・run・statementsは
  再解析前と同一。

## 8. 結果

### 8.1 run一覧（14 run、9 page session）

| context | attempt | minimal | instrumented |
| --- | --- | --- | --- |
| c0-p0#0 | 1 | stopped_by_extent_before_candidate（Search 24.9 s） | stopped_by_extent_before_candidate（Search 19.6 s） |
| c12-p0#0 | 1 | page_crashed（Search開始→loss 49.9 s） | page_crashed（40.8 s） |
| c12-p0#0 | 2 | page_crashed（46.1 s） | page_crashed（43.3 s） |
| c2-p1#0 | 1 | page_crashed（55.8 s） | page_crashed（51.7 s） |
| c2-p1#0 | 2 | page_crashed（44.2 s） | page_crashed（47.7 s） |
| c8-p1#0 | 1 | first_candidate（2.3 s） | first_candidate（2.4 s） |
| c13-p4#0 | 1 | stopped_by_extent_before_candidate（1.2 s） | stopped_by_extent_before_candidate（1.2 s） |

- repeatされたcontext: c12-p0#0、c2-p1#0（理由 `page_or_browser_crash`）。c0-p0#0と2 controlは正常pairのためrepeatなし。
- first Candidate到達run 2（controlのc8-p1#0のみ）、renderer（page）loss 8、browser loss 0、native Worker failure 0、structured error 0、timeout 0。
- lossした8 runはすべて、Search開始後・first Candidate notice前にrendererが失われ、Worker targetも同時に消えた
  （`lostDuringSearchBeforeFirstCandidate` 8 / 8）。native Worker `error` は1件も届いていない（C2.5-Bと同じ観測）。

### 8.2 V8 OOM補助診断

lossした8 runすべてのrenderer crash dumpに明示的なV8 OOM crash keyがあった（補助ラベル `explicit_v8_oom_crash_key`、formal分類の置き換えではない）。
`v8-oom-location` は `MarkCompactCollector: young object promotion failed` 7件、`CALL_AND_RETRY_LAST` 1件（c12-p0#0 minimal attempt 2）。
c0-p0#0と両controlはcrashしていない。

### 8.3 c0-p0#0（deep型）: Browser before → after

| 指標 | before（C2.5-B、4 run） | after（D2-b） |
| --- | --- | --- |
| status | 4 / 4 page_crashed | minimal / instrumentedとも stopped_by_extent_before_candidate |
| Search開始→loss / 終了 | loss 12.5–12.6 s | 終了 24.9 s（minimal）/ 19.6 s（instrumented） |
| Worker lifetime | 13.6 s | 26.1 s / 20.8 s |
| CDP sampled max used heap | 3.71–3.85 GiB | 2.09 GiB / 1.95 GiB |
| last successful heap sample | 3.71–3.85 GiB | 2.09 GiB / 1.95 GiB |
| Gogma max depth（instrumented） | 120 / 124（最後に受信したsnapshot） | 233（終了） |
| 累積Gogma generated | 730,261 / 775,135 | 2,360,100 |
| 累積Gogma frontier | 704,058 / 748,860 | 2,331,740 |
| max generated per depth | 10,806 / 11,142 | 18,558（depth 218） |
| settled work | 716 / 740 | 1,410 |
| prediction counts（N / S / Reset / Keep） | 4 / 5 / 135 / 9,206、4 / 5 / 139 / 9,721 | 4 / 5 / 233 / 25,474 |
| first Candidate | なし | なし（extent stop） |

**Node D2-a parity（受入条件）**: 両modeで同status（`stopped_by_extent_before_candidate`）、Search summary（delivered 0、excluded 0、exhausted false、
stoppedByExtent true、stoppedByConsumer false、skippedExcludedRouteKeys 0）がNode D2-aと一致、Candidate key = null、extent / exhausted一致、
instrumented prediction counts（4 / 5 / 233 / 25,474）一致。Browser instrumentedの最終progress（depth 233、generated 2,360,100、
frontier 2,331,740、max per depth 18,558 @218、settled 1,410）もNode D2-a instrumentedのmetricsと同値。受入条件をすべて満たした
（`nodeTerminatedRepresentativeAcceptance.accepted = true`）。

### 8.4 c12-p0#0 / c2-p1#0（shallow型）: Browser before → after

両contextとも2 attempt × 2 modeすべてでrenderer lossし、formal分類はbeforeと同じ `inconclusive_page_or_browser_crash`。
lossまでの進行は、beforeより伸びた（instrumentedの最後に受信したsnapshot。heartbeat 2 s間隔のため、loss直前の最大約2 sと生成途中のdepthは含まない）。

| 指標 | c12-p0 before | c12-p0 after | c2-p1 before | c2-p1 after |
| --- | --- | --- | --- | --- |
| Search開始→loss | 25.5–27.7 s | 40.8–49.9 s | 29.9–34.4 s | 44.2–55.8 s |
| Worker lifetime | 26.6–28.8 s | 41.8–51.0 s | 31.0–35.5 s | 45.2–56.9 s |
| CDP sampled max used heap | 3.77–3.81 GiB | 3.28–3.39 GiB | 3.78–3.85 GiB | 3.25–3.31 GiB |
| last successful heap sample | 3.77–3.81 GiB | 3.21–3.38 GiB | 3.76–3.84 GiB | 3.18–3.31 GiB |
| last Gogma depth | 5 | 12 | 6 | 17 |
| 累積Gogma generated | 3,048,468 | 16,918,625 | 3,046,892–3,203,487 | 16,975,980 |
| 累積Gogma frontier | 132,456 | 531,770 | 129,550–134,594 | 640,070 |
| max generated per depth | 1,226,624（depth 3） | 1,964,741（depth 3） | 942,420（depth 3） | 1,256,560（depth 3） |
| settled work | 42 | 99 | 46–47 | 138 |
| prediction counts（N / S / Reset / Keep） | 4 / 4 / 118 / 7,378 | 4 / 4 / 125 / 8,214 | 4 / 5 / 103 / 5,766–5,767 | 4 / 5 / 114 / 6,989 |
| first Candidate | なし | なし | なし | なし |

- 記述的な進行比（after / before、同じmodeのinstrumented、最も進んだattempt同士）: c12-p0はdepth 2.4倍・累積generated 5.5倍・frontier 4.0倍・
  settled 2.4倍、c2-p1はdepth 2.8倍・累積generated 5.3倍・frontier 4.8倍・settled 2.9倍。これは「Searchがどこまで進んだか」の比であり、
  memory効率の倍率ではない（§10）。
- Node D2-aとの比較（参考、parity判定の対象外）: Node D2-aも両contextでOOM（`node_not_terminated`）。Browser afterの最後に受信した進行
  （c12-p0: depth 12、generated 16,918,625、frontier 531,770、max per depth 1,964,741、settled 99。c2-p1: depth 17、generated 16,975,980、
  frontier 640,070、max per depth 1,256,560、settled 138）は、Node D2-aの最後のsnapshot（c12-p0: depth 12、17,403,169、546,316、1,964,741、101。
  c2-p1: depth 18、17,267,064、652,568、1,256,560、140）と近い位置だった。ただし両者は別runtime・別snapshot時刻で、heap bytes / limitは
  比較しない。同じSearch stateで止まったとも主張しない。

### 8.5 controls

| context | 両mode status | Node D2-aとの一致 | Browser after sampled max heap | before sampled max heap |
| --- | --- | --- | --- | --- |
| c8-p1#0 | first_candidate | status・Search summary・first Candidate key SHA-256・extent / exhausted・instrumented prediction counts（4 / 5 / 119 / 6,079）すべて一致 | 0.40 / 0.36 GiB | 1.83 / 1.83 GiB |
| c13-p4#0 | stopped_by_extent_before_candidate | 同上（prediction counts 4 / 4 / 234 / 25,874） | 0.29 / 0.27 GiB | 1.16 / 1.14 GiB |

両controlとも両modeのBrowser semantic digestが一致し、`controlSemanticParity = true`（2 / 2）。semantic failureは無いため、Browser memory結果より
優先すべきsemantic問題はない。

## 9. heap limitの境界

- **CDP**: Dedicated Worker targetへの `Runtime.getHeapUsage` は、Worker used heap（未回収garbageを含む）の約500 ms間隔のsampleである。
  representative runのsampled最大値はrunごとに1.95–3.38 GiB（正常終了とlossの両方を含む）、全run最大3.38 GiB（3,634,381,716 bytes）。
  連続的なpeakではない。
- **page realm**: `performance.memory.jsHeapSizeLimit` は4,395,630,592 bytes（約4.09 GiB）だった。これは別realm（page）の参考値である。
- **Dedicated Worker自身のheap limit**: Worker realmは `performance.memory` を公開しなかったため **unknown**（未測定）である。page realmの値と
  同一視しない。「Browser Workerのheap上限 ≈ 4 GiB」とは言わない。
- Node 8 GBの上限、Nodeのheap bytesとは直接比較しない。

## 10. formalに言えること / まだ言えないこと

言えること（RESULTの `statements.formal` と同内容）:

1. 9 page sessionすべてで、Search前にworkloadのpre-search contextが元Exportから再導出され、C2.5-A evidenceとfield単位で一致した。
2. 2 controlは両modeで正常終了し、Node D2-aとstatus・Search summary・first Candidate key・extent / exhausted・instrumented prediction countsが一致した。
3. formal分類（C2.5-B規則、無変更）: c0-p0#0 `browser_no_failure`（before `inconclusive_page_or_browser_crash`）、c12-p0#0 / c2-p1#0
   `inconclusive_page_or_browser_crash`（beforeと同じ）、2 control `browser_no_failure`。全体 `mixed`。
4. **D2-a Ideal-only publication後、c0-p0#0はChrome Dedicated Workerでも旧renderer lossを再現せず、Node D2-aと同じextent stopまで完了した。**
5. 補助: 代表10 runのうち8 runでrenderer crash dumpに明示的なV8 OOM crash keyがあり、その8 runはSearch Worker実行中・first Candidate notice前に
   rendererを失った。

まだ言えないこと:

- 「Browser OOM問題は解消した」。c12-p0#0 / c2-p1#0はChrome Dedicated Workerで正常終了していない。
- CDP sampleからのmemory効率の倍率（sampleは約500 ms間隔で未回収garbageを含み、loss runはloss時点で切れる）。§8.4の比は進行の比である。
- Dedicated Worker自身のheap limit（unknown）。
- Nodeとのheap比較。
- この5 context以外（他のPhase 2-C2 OOM orientation）、Planner Alternative kernel全体、他のbrowser / device。
- D2-a後のshallow型でheapを保持している構造（本Phaseではheap snapshot / profileを取っていない）。
- c0-p0#0がより広いextentでCandidateに到達するか。

## 11. 次Phase recommendation

shallow型のpage lossが続くため、**post-D2 heap localization** へ進む。C2.5-Cと同じ思想で、D2-a後のcodeに対して

- Node sampling heap profile、
- low-heap snapshot

を再実行し、`set.depths`、`steps[]`、1 depthのgenerated burst（c12-p0 / c2-p1ともdepth 3で100万〜200万state）、frontierのどれが残存heapを
支配するかを再確認する。stream optimizationはまだ実装しない。kernel全体のformal再測定は、Search-onlyでshallow型が正常終了した後に行う。

## 12. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| 開始時 | branch `main`、`main` = `origin/main` = `994d8b97021dee618dc282230cc6d6889fb956b2`（PR #174 merge済み）、Working Tree clean、Issue #154 Open |
| 作業branch | `research/global-planner-phase2c25d2b-browser` |
| **measured HEAD** | `cb36d0ce157b681465527205be7ed11b1337ffd8`（benchmark codeをcommitしたclean HEADからbuild） |
| analysis HEAD | `14c6ff580d460c92e991b80a02f4febfaaa9098b`（Required fix: formal series completeness検証の追加。measured HEAD以降の変更はpost-hoc analyzer・analysis helper・testだけで、`calculationCodeChangedSinceMeasuredHead` 空。初回解析は `cb36d0ce`） |
| benchmark code SHA-256 | `97099b6fd6e043e8c82baf2f209a5dff2a5c1b51c85aa6d010ddbd97e9c99039`（uncommitted benchmark code = false） |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| C2.5-A evidence | SHA-256 `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd` |
| D2-a result | SHA-256 `51918edeb7b8b4b08953847125295f6bddab5f4f89c2a759daa37d7d1bc7e914`（measured HEAD `0c054a84`） |
| C2.5-B results | SHA-256 `789a1525394210084b71c04e666608fe11fcf9970afe0b48e0b00783b05a6bdd`（measured HEAD `90177319`） |
| external driver | SHA-256 `1594465c43b4c459d200f4145f15721e31ae351fc8f841f5fb7ad267dcf26065`（base: C2.5-B `501b2e1e…`） |
| 実施 | 2026-09-29 12:19〜12:29 JST（formal series 1回、wall 627 s） |
| Browser | Google Chrome 153.0.8010.49、Windows x64 |
| page | `crossOriginIsolated` true（`BENCHMARK_CROSS_ORIGIN_ISOLATED=1` の `vite preview --host 127.0.0.1`）、`isSecureContext` true、visibility visible |
| OS / CPU / memory | Windows 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 33,377,591,296 bytes |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17 |
| 並行作業 | 測定中にtest / build / Node benchmarkは実行していない |

非formalのsmoke（formal前）: 1回目はpreview serverが `localhost` のみにbindしてpageが開けずdriverが停止（Search未実行）。`--host 127.0.0.1` で
C2.5-Bと同じoriginにして2回目のsmoke（c8-p1#0のみ、`--only`）でparity・run・analyzerの経路を確認した。smokeの結果はformal evidenceに含めていない。

## 13. テスト・検証

`src/benchmarks/plannerGlobalPhase2C25D2B.test.ts`（35件）:

- workload: committed C2.5-A evidenceから `selectPhase2C25CWorkload()` と同じ5 context、D2-a `workloadSelection` と一致。記録と食い違う選択はfail closed
- protocol: prefixだけのrename、C2.5-B messageの無視、ready environmentのD2-b protocol version
- runner（合成scenario、in-processの実D2-b Worker controller）: parity一致、両modeでNode Search-only経路と同じstatus・Search summary・first Candidate key、
  normal resultのsemantic digestが両modeで一致、1 run 1 fresh Worker・全terminate、全messageがD2-b wire、Workerへevidence由来fieldが渡らない、
  contexts Workerはworkloadのorientationだけを導出、context parity不一致でformal Searchを開始しない
- analysis: page crash分類、native failure分類（OOM claimにしない）、first Candidate後failureの区別（C2.5-B規則）、external-only lost page merge、
  control Node D2-a parity（一致 / 不一致）、Node終了代表（c0型）のNode D2-a parity受入と不一致時の拒否・semantic failure優先、
  Browser before / after比較と進行比、repeat判定
- statements / heap wording: Worker自身のlimit = unknown、page realm limitは参考値でWorker limitと同一視しない、Nodeとheap比較しない、
  「≈ 4 GiB」と書かない、残る代表がある時に「解消」と書かない
- 比較source: committed D2-a result / C2.5-B resultsのparse
- formal series completeness（Required fix、16件）: committed formal external evidenceと合成seriesがpass（expected runをruleからderive）。
  context丸ごと欠落、片mode欠落、必要repeat欠落、attempt 2片mode欠落、不要repeat追加、attempt > 2、duplicate runKey、duplicate logical run、
  repeat decision欠落・重複・不一致・未実行attemptのdecision、foreign run、driver modes不足 / 余計、`allowRepeat = false`、`only` あり、`completedAt` なしを
  すべてfail。analyzerがanalysis前に検証し `Formal series incomplete` でerror終了すること
- isolation: runtime moduleにoracle・UUID・64桁hex・orientation / Entry ID・context digestリテラルなし、file / DB読み書きなし、D2-b Search実装なし、
  ProductionからD2-bへの到達なし、Production Worker protocol / defaults / schema / version不変

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 314 files / 5,060 tests passed（Required fix後） |
| `npm run build` | passed。`dist` にD2-b識別子なし |
| `npx vite build --config vite.benchmark.config.ts` | passed（formal build） |
| `git diff --check` | passed |
| 実Browser smoke | benchmark page / Dedicated Workerを実Chromeで実行（§12、formal series自体も実Browser） |

## 14. 変更境界

- Production source: 変更なし（`targetSearchScheduler.ts`、`bonusStream.ts`、`skillStream.ts`、`lazyIdealCross.ts`、Planner Alternative Search、Planner、RNG、
  Production Worker、defaults、schema / version、Persistence、UIすべて無変更）
- Research: `src/benchmarks/plannerGlobalPhase2C25D2B{,Protocol,Harness,Analysis}.ts`、`src/benchmarks/plannerGlobalPhase2C25D2B.test.ts`、
  `src/workers/plannerGlobalPhase2C25D2B.worker.benchmark(.entry).ts`、`src/pages/PlannerGlobalPhase2C25D2BBenchmarkPage.tsx`、
  `src/pages/BenchmarkApp(.test).tsx`（ボタン1つ）、`scripts/analyze-planner-global-phase2c25d2b.mjs`
- Required fix（post-hocのみ）: `validatePhase2C25D2BFormalSeries()` の追加、analyzerのfail-closed gate、test、RESULTの再生成、本書。Browser execution code・
  Worker・protocol・harness・workload selection・classification ruleは変更していない
- C2.5-B Research codeへの最小注入点（既定挙動不変）: `plannerGlobalPhase2C25BHarness.ts`（`phase`、`phase2c25bEvidenceForOrientations()`）、
  `plannerGlobalPhase2C25BAnalysis.ts`（`sampledWhen`）
- 変更なし: PR #173の固定baseline、D2-a unit tests、C2.5-B / D2-aのevidence

## 15. 証跡

- [PLANNER_GLOBAL_PHASE2C25D2B_RESULT.json](PLANNER_GLOBAL_PHASE2C25D2B_RESULT.json): provenance、環境（`heapLimits`）、条件、`formalSeriesValidation`、sessionごとのparity
  （13行と `workloadRows`）、workload、repeat判定、totals、verdict（formal / per context / auxiliary / semanticFailures）、contextごとの分類・attempt・
  Node D2-a parity・Browser before / afterのrun指標・進行比、runごとの統合record（CDP heap summaryと全sample trajectory、target lifecycle、crash dump key）、
  statements（formal / notYet）。
- [PLANNER_GLOBAL_PHASE2C25D2B_BROWSER_RESULTS.json](PLANNER_GLOBAL_PHASE2C25D2B_BROWSER_RESULTS.json): 9 page sessionそれぞれのpage `exportJson()`（verbatim）。
- [PLANNER_GLOBAL_PHASE2C25D2B_EXTERNAL_MEMORY.json](PLANNER_GLOBAL_PHASE2C25D2B_EXTERNAL_MEMORY.json): driverのexternal evidence（CDP構成、runごとの
  heap sample・lifecycle・relay event・page loss・crash dump key、driver SHA-256とbase）。
- raw（commitしない、scratchpad）: driver出力一式、Chrome profile（Crashpad dumpを含む）。
- 再生成:

```powershell
$env:BENCHMARK_CROSS_ORIGIN_ISOLATED = '1'; npx vite build --config vite.benchmark.config.ts; npx vite preview --config vite.benchmark.config.ts --port 4179 --strictPort --host 127.0.0.1
node <scratch>/cdp-driver.mjs --export <Export.json> --evidence docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --out-dir <new dir>
node scripts/analyze-planner-global-phase2c25d2b.mjs --run-dir <new dir> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --d2a docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json --c25b docs/PLANNER_GLOBAL_PHASE2C25B_RESULTS.json --output <result.json> --browser-output <browser.json> --external-output <external.json>
```
