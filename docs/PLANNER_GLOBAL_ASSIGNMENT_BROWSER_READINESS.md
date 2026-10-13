# Global Assignment Browser Worker実行・性能計測の詳細設計（Production準備 P-0）

Refs #154。**docs-only**。基準main: PR #255 merged `53c133b5a2aad77c027e1c6bf531a459cc0f82a5`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stash / 追加worktreeなしを確認）。branch: `docs/global-assignment-browser-readiness`。

本書は、D-1Cで正式統合acceptance（`formalValidity = valid`、候補outcome `verified`、`accepted`）を達成したGlobal Assignmentを、
将来GogmaArtianPlannerの通常機能として使えるかを判断するための第一段階として、**Research専用Browser Worker** でGlobal Assignmentを実行・計測する
仕組みを設計する。Browser Worker実装、実Exportの計測、formal measurement、Production変更は行っていない（本PRのProduction changed files = `[]`。
変更はdocs 2 fileのみ: 本書の新規作成と、[Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md) §16への参照1段落の追加。§17）。

## 0. 位置づけとauthority

本書はResearch設計文書であり、正式仕様でもDomain仕様でもない。authorityは `AGENTS.md` の順位どおり
`docs/REQUIREMENTS.md` → `docs/PLANNER_SPEC.md` / `docs/SEARCH_SPEC.md`（task-specific）→ その他の正式文書 → 最新mainの実装 → test → Research文書である。
Global Assignment内のResearch authorityは [Global Assignment設計](PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md)（以下「設計」）が最上位で、本書はそれを変更しない
（設計 §11 oracle isolation、§12 determinism / cancel、§13 acceptance、§14 Phase分割、§16 Production契約との境界をそのまま継承する）。

- 本書はProduction semantics（REQUIREMENTS 19 / 23の「Build Listに登録済みのRouteを計画し、明示的な選択の無い競合を自動で再検索しない」契約、
  PLANNER_SPEC 7のRoute commitment + 決定的scheduler、9.2.19の1段repair）を一切変更しない
- 本書が挙げる関数名・型名・file名のうち **確認済み** のものは、基準main `53c133b` のsourceで存在と署名を確認したものである（§4 / §6）。
  新規に提案するmodule名・型名・message名は **提案** であり、実装PRで綴りを変えてよいが、§6〜§13の意味と不変条件を変えてはならない
- 本書の数値（D-1CのNode時間・memory、Phase 2-AのBrowser観測）は **既存記録の引用** であり、本書で再計測していない。Browserでの時間・memoryを
  推測で補完せず、閾値も決めない（§9 / §14）
- 本書の系列名: **P-0**（本書、docs-only）、**P-1**（Browser Worker実行基盤・synthetic検証）、**P-2**（実ExportのPC / スマートフォン測定）。
  設計 §14のPhase E（最適化・性能）の「Browser Worker測定」とは目的が異なる: P系列はD-1Cで正式acceptanceされた最初のstructural candidate
  （物理操作数1,766）を **同じ条件のままBrowserで実行できるか** を確認するProduction準備であり、操作数の改善・新しい候補・新しい条件を扱わない

用語:

| 用語 | 意味 |
| --- | --- |
| first Worker / fresh Worker | Node D-1A / D-1Cのfirst / fresh子processに対応するBrowser Dedicated Worker。first = Export → PlannerInput → Phase 0 → A → B / C → D → D'、fresh = Export → PlannerInput → 自分のPhase 0 → firstのEntry集合 → D'。別Worker（別JS realm・別heap）で実行する |
| logical run | first Worker 1回とfresh Worker 1回の組（Node D-1Cの「1 complete run」に相当）。D-1Cは2 logical runを登録した |
| Node reference | 同じmeasurement HEADでNode上の既存Research runner（D-1A non-formal runner）が出したsemantic値（§12.3） |
| semantic | 実行環境に依存しない計算結果の記録（materialization semantic record、verification semantic record とそのSHA-256、fingerprint）。Nodeと完全一致を要求する |
| observed | 時間・memory・yield回数・heartbeat・環境情報など実行環境に依存する観測値。Nodeとの一致を要求しない |
| measurement environment | OS・Browser・端末・serving方法・計測方法の組（§11） |

## 1. 目的

| やること（本書） | やらないこと（本PR） |
| --- | --- |
| 既存Browser benchmark基盤とGlobal Assignment実装の調査、Node依存の分離、Browser専用adapterの特定（§3〜§6） | Browser Worker・page・protocol・adapterの実装（P-1） |
| Worker entry / protocol / 入出力 / provenance / cancel / error / cleanupの設計（§7 / §8 / §10） | 実Exportの実行・計測（P-2）、formal measurement |
| 計測項目、PC / スマートフォンの確認方法、Node semantic parityの判定方法の定義（§9 / §11 / §12） | 性能許容値・Production default・正式計測条件の決定、W0 / `a2` / `d0a2-v2` / 候補1件 / verification budget 1 / Research maxPlanSteps 20,000 のProduction値化 |
| Research isolationの維持方法（§13）、Production統合に向けた課題の整理（§15）、後続PR分割（§16） | 通常PlannerへのGlobal Assignment接続、競合解決仕様の変更、Build Listの自動書換え、Research Entry IDのProduction保存、Dexie登録、UI追加、新しいProduction Worker request、Phase Eの最短化探索 |

## 2. 現在の正式成果（D-1C）

[D-1C記録](PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md)・[公開RESULT](PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json)（正式計測2、measurement HEAD `68a1ac8`）の値である。再計算していない。

| 項目 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`（D-0B-2記録のregistered-export block） |
| 条件 | W0（Normal 350 / Gogma 500 / Skill 1,500）、option集合 `global-assignment-reach-options:a2`、規則 `d0a2-v2`、structural candidate 1件、verification budget 1、Research maxPlanSteps 20,000（`registeredD1cConditions()`） |
| planning Target / materialized | 43 / 43（射影起点21、形状制約22） |
| Production Planner | termination `completed`、expandedStates 1,809、completed / total 43 / 43、selected 43、Conflict / rejected / resource_conflict / warning 0、full Planner run 1 |
| 独立Trace Replay | valid（draft 1,809 = physical 1,766 + reserve 43、Plan物理Stepとの対応不一致0） |
| 物理操作数 | Plan steps = 物理操作数 = Σ stream前進 = objective = **1,766**（非物理Step 0） |
| 決定性 | first / fresh一致、2 complete run一致（verification semantic SHA-256 `0a56da0f…33dd4` × 4、materialization semantic SHA-256 `6f790d33…cb18f` × 2、Entry fingerprint `fnv1a32:ed959cc4` × 4） |
| 判定 | `formalValidity = valid`、候補outcome `verified`、`acceptance = accepted`、最小性 `best_found`（root下界1,657と差109、`proven_minimum` ではない） |

Nodeでの観測値（参考。Browserの期待値ではない。§9.6）:

| 値（正式計測2、run 1 / run 2） | first | fresh |
| --- | --- | --- |
| 子processのwall（親の観測） | 38.9 s / 38.7 s | 7.8 s / 7.9 s |
| setup（vite SSR loader、module load、Export読込・hash、PlannerInput構築） | 0.92 s / 0.90 s | 0.90 s / 0.91 s |
| materialization（context / ReachTable / structural search / 合計） | 1.73 / 11.33 / 17.72 / 32.64 s、1.69 / 11.22 / 17.63 / 32.39 s | — |
| Phase D'（final input / Planner / Trace Replay / physical / 合計） | 0.30 / 4.22 / 0.40 / 0.003 / 4.98 s 等 | 0.31 / 4.22 / 0.40 / 0.003 / 5.00 s 等 |
| heapUsed最大（250 ms標本）/ maxRSS | 1.37 GB / 1,559,768 KiB、1.42 GB / 1,614,232 KiB | 0.65 GB / 874,068 KiB、0.65 GB / 871,212 KiB |
| 環境 | AMD Ryzen 7 9700X（16 logical CPU）、31.1 GiB、Windows 10.0.26200 x64、Node v24.19.0、`--max-old-space-size=8192` | 同じ |

**まだ証明されていないこと**: この成立は特定の実Export・事前登録条件・1台のmachine・Node v24の結果である。(1) 他のExport・他のwindow / 条件、
(2) Browser（JS engine・Worker・heap上限が異なる）、(3) 他のmachine・スマートフォンでの決定性・時間・memoryは、いずれも未確認である
（D-1C記録 §15）。本書のP-1 / P-2が扱うのは (2) と (3) の一部（同じExport・同じ条件）だけで、(1) は扱わない。

## 3. 既存Browser benchmark資産

### 3.1 benchmark build基盤（確認済み）

| file | 内容 |
| --- | --- |
| `benchmark.html` | benchmark buildのHTML entry（`/src/benchmark.tsx` を読む）。通常アプリの `index.html` とは別 |
| `vite.benchmark.config.ts` | benchmark専用Vite config。`build.outDir = 'dist-benchmark'`、`rollupOptions.input = 'benchmark.html'`、`base = '/GogmaArtianPlanner/'`。`define.__PLANNER_GLOBAL_BENCHMARK_BUILD__` にbuild時のgit HEAD・benchmark関係codeの未commit有無・そのcodeのSHA-256（`BENCHMARK_CODE_PATHS`）を埋め込む。COOP / COEP headerは `BENCHMARK_CROSS_ORIGIN_ISOLATED=1` のときだけdev server / previewへ付く |
| `src/benchmark.tsx` / `src/pages/BenchmarkApp.tsx` | benchmark shell。tab 8個（C5-E2C8 Skill Identification、B5、B8 Constrained Enumeration、Planner Alternative Phase 3、Global Planner Phase 2-A、2-C2.5-B、2-C2.5-D2-b、2-C2.5-D2-e）。defaultはC5-E2C8 |
| 通常build | `vite.config.ts`（`index.html` のみ、`dist/`）。GitHub Pagesのdeploy（`.github/workflows/deploy.yml`）とCI（`ci.yml`）は `npm run build` だけを行い、benchmark buildをdeployしない |

注意: `dist-benchmark/` は現在 `.gitignore` に無い（`dist` と `*.local` だけ。作業開始時点で `dist-benchmark/` は存在しない）。P-1でbenchmark buildを行う場合はcommitに混入させない
（P-1で `.gitignore` へ追加するか、build後に削除する。§16）。

### 3.2 Phase 2-A Browser harness（確認済み。以前のGlobal Planner研究用）

[Phase 2-A記録](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2A.md)。**現在のGlobal Assignmentを実行していない**。Worker内で実行するのはPhase 0 / 1-Eの
逐次射影アルゴリズム（`runGlobalPlannerResearch()`、`createPhase1EFallback()`、raw block cache `GlobalRawBlockResearch`）であり、8,534 stepsのincumbentを作った別のアルゴリズムである。
同一の計算アルゴリズムとして扱わない。

| 役割 | file | Global Assignmentでの扱い |
| --- | --- | --- |
| protocol（prefix `pg2a_benchmark_`、run / cancel / ping → ready / accepted / pong / cancel_ack / progress / result / cancelled / error） | `src/benchmarks/plannerGlobalBrowserBenchmarkProtocol.ts` | **形だけ再利用**（新しいprefix・versionで別protocolを定義。§7.3）。message・型は流用しない |
| semantic evidence（Web Crypto SHA-256、`sha256(JSON.stringify(value))`） | `src/benchmarks/plannerGlobalBrowserEvidence.ts` | `webCryptoSha256` / `jsonSha256` は **そのままimport可**（このmoduleの他moduleへの依存は `import type` だけ）。`PlannerGlobalEvidenceCollector` / `plannerGlobalSemantic()` はPhase 1-E用なので使わない |
| main-thread harness（1 harness = 1 Worker = 1 run、ready / accepted / round trip、cancel ack / settle、ping、late response、native error fail closed） | `src/benchmarks/plannerGlobalBrowserBenchmark.ts` | **仕組みを再利用**（同じ境界・同じfail closed規則で新harnessを作る）。message型が異なるのでmoduleは流用しない。ただしPhase 2-Aのharnessは、cancel要求後に届いた `pg2a_benchmark_result` も `completed` としてsettleする（cancel要求は結果の採用を止めない）。Global Assignmentではこの挙動を引き継がず、§7.8のmain thread側のcancel契約に置き換える（Phase 2-Aのharnessは変更しない） |
| runner（records、series、controller、chained ping、cancel trigger、memory sampling、JSON export） | `src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts` | **仕組みを再利用**（memory sampling・JSON export・cancel triggerの方式）。Phase 1-E controllerは使わない |
| Worker controller / entry（fresh Worker policy、MessageChannel macrotask yield、cancel set、`readWorkerPerformanceMemory()`） | `src/workers/plannerGlobal.worker.benchmark(.entry).ts` | **仕組みを再利用**。ただしこのmoduleはPhase 1-E Research（`runGlobalPlannerResearch` / fallback / raw block / profiler）をruntime importするので、Global AssignmentのWorkerからimportしない。MessageChannel yield（約15行）は既存と同じく局所copyにする（Phase 2-Aも `search.worker.ts` / `planner.worker.ts` を変えないため局所copyにした） |
| page（Export file選択、`globalResearchInputFromExport()` をmain threadで1回実行、console API `globalThis.plannerGlobalBrowserBenchmark`、「JSON保存」） | `src/pages/PlannerGlobalBrowserBenchmarkPage.tsx` | **UIの方式を再利用**。ただし入力構築はmain threadでなくWorkerで行う（§7.5） |
| isolation test | `src/benchmarks/plannerGlobalBrowserBenchmarkIsolation.test.ts` | Production scanから `src/benchmark.tsx`、`src/pages/BenchmarkApp.tsx`、`src/pages/*BenchmarkPage.tsx`、`src/workers/*.worker.benchmark(.entry).ts` をpatternで除外している（§13.1でGlobal Assignmentとの違いを述べる） |

Phase 2-Aで観測された事実（引用。Global Assignmentの予測ではない）: Chrome 153（Windows、16 logical CPU、32 GB）で43 / 43・Node Phase 1-Eとsemantic SHA一致、
winner round trip中央値86.9秒（Nodeの約半分。profiler・SSR loader等の環境差があり原因は未計測）、**final Planner stageでWorker event loopが最大13.3秒応答しない**、
Worker heap（CDP `Runtime.getHeapUsage`）max sampled 1.73 GiB、renderer private memory max sampled 3.9 GiB、Worker realmの `performance.memory` はChromeで無い、
main realmの `jsHeapSizeLimit` は約4.09 GiB、スマートフォンは未確認。

### 3.3 その他のBrowser harness（確認済み）

- Phase 2-C2.5-B / D2-b / D2-e（Search-onlyの再現・再計測、外部CDP driver、Browser environment parityのfail closed）。D2-eはcross-origin isolated環境・
  `isSecureContext` の一致をanalyzerで必須にし、外部driver（headed Chrome、専用profile、`--disable-backgrounding-occluded-windows`、約500 ms間隔の
  `Runtime.getHeapUsage`、lifecycle / crash検出、crash dump key抽出）をcommitせずSHA-256だけ記録した。**Dedicated Worker自身のheap上限は未測定（unknown）** とし、
  page realmの値と同一視しなかった（D2-e記録 §9）
- Planner Alternative Phase 3（[記録](PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md)）: ChromeでWorker heap約4 GBの **renderer crash（V8 OOM）** を観測した（12.3 / 12.6）。
  OOMはpage自身からは記録できず、外部driverのcrash検出・crash dumpで分類した

### 3.4 再利用範囲のまとめ

| 区分 | 再利用するもの | 再利用しないもの |
| --- | --- | --- |
| build | `vite.benchmark.config.ts`（2つ目のrollup inputを追加）、build provenanceの埋め込み、COOP / COEP opt-in、`dist-benchmark/` | 通常 `vite.config.ts`（変更しない） |
| Worker制御 | fresh Worker policy、MessageChannel macrotask yield（局所copy）、cancel set + ack、ping / pong、native `error` / `messageerror` のfail closed、late response count | Phase 1-Eのcontroller・protocol message・raw block cache・profiler |
| 計測 | ready / accepted / round tripの時間境界、`measureUserAgentSpecificMemory()` の別run採取、外部CDP driverの方式（uncommitted、SHA記録）、OS memory採取 | Phase 2-Aのsemantic構造（`plannerGlobalSemantic()`） |
| evidence | `webCryptoSha256` / `jsonSha256`（import） | `PlannerGlobalEvidenceCollector` |
| 計算 | なし（Phase 2-Aの計算は別アルゴリズム） | `runGlobalPlannerResearch()` ほか全て |

## 4. Global AssignmentのBrowser移植性監査

### 4.1 Nodeでの計算列（確認済み: `scripts/run-planner-global-assignment-d1a.mjs` の子process部分、D-1Cも同じ処理を再利用）

| # | 処理 | 関数（module） |
| --- | --- | --- |
| 1 | Export読込・SHA-256 | `node:fs` `readFile` + `node:crypto` `createHash` |
| 2 | PlannerInput構築（pure validation、IndexedDBへImportしない。`options.maxPlanSteps` は検証用の1,000） | `globalResearchInputFromExport(json, 1_000)`（`src/benchmarks/plannerGlobalOptimizationResearch.ts`）= `loadMasterData()` → `prepareExportRootForImport()` → `validateExportRootForFullReplacement()` → CalculationContextの構築 |
| 3 | Engine | `new ProductionRngEngine()`（`src/domain/rng/production/productionRngEngine.ts`） |
| 4 | 条件 | `registeredD0cConditions()`（`materializationProtocol.ts`）。D-1Cは `registeredD1cConditions()`（`verificationRegistration.ts`）の `materialization` / `verification` |
| 5 | Phase 0 → A → B / C → D（診断を含む） | `runMaterializationSmoke(input, globalResearchDependencies(engine), { conditions }, { now, yieldControl, onProgress, onMaterializedEntries })`（`materializationRunner.ts`）。内部で `createGlobalAssignmentContext()` → `buildReachTable()` → `createStructuralCandidateSearch()` の `next(1)` loop → `materializeStructuralCandidate()`（rule `d0a2-v2`） |
| 6 | materialization semantic SHA-256、Entry fingerprint | `sha256(JSON.stringify(result.semantic))`、`materializedEntriesFingerprintOfSemantic()` / `materializedEntriesFingerprintOfHandoffs()`（`verificationProtocol.ts`） |
| 7 | Entry集合（first → fresh） | `createD1aEntrySet(handoff, provenance)`、fresh側で `d1aEntrySetIssues()` → `handoffFromEntrySet()` |
| 8 | Phase D'（first: 新しいEngineのdependencies） | `verifyPlannerCandidate(input, handoff, globalResearchDependencies(new ProductionRngEngine()), { researchMaxPlanSteps }, { now, yieldControl, onStage })`（`verify.ts`）。内部で `buildFinalInput()` → `createProductionPlanWithObserver()` → `summarizeVerificationPhysical()`（`summarizePlanPhysical()` を使用）→ `replayPlannerSearchTrace()` |
| 9 | fresh: 自分のPhase 0 | `createGlobalAssignmentContext(input, globalResearchDependencies(engine))`、その後8を新しいEngineで |
| 10 | verification semantic SHA-256、2 processの判定 | `sha256(JSON.stringify(result.semantic))`、`judgeD1aRun()` / `concludeD1aRun()` |

### 4.2 Node APIへの依存（監査結果）

`src/benchmarks/globalAssignment/` のruntime module（test・fixtureを除く41 file）、`plannerGlobalOptimizationResearch.ts`、`plannerGlobalPhase2BPlan.ts`、
`plannerGlobalLowerBound.ts`、`src/domain/**` を検索した結果、`node:` import、`Buffer`、`process.*`、`require()`、`setImmediate` は **0件** だった
（`process.` の出現は `materializationFormal.ts` / `verificationFormal.ts` / `verificationFormalResult.ts` のcomment・Node runnerが渡す記録のfield名だけで、実行時のNode APIではない）。
既存のisolation test（`isolation.test.ts` の2件目）は、runtime moduleが `readFile|fetch(|indexedDB|Dexie|localStorage|sessionStorage`・`Math.random|Date.now|new Date(|randomUUID|performance.now` を
含まないこと、import先が `./`・`../../domain/`・指定された3つの例外（`../plannerGlobalLowerBound`、`../plannerGlobalOptimizationResearch`、`../plannerGlobalPhase2BPlan`）だけであることを固定している。
時計（`now`）・yield・cancelはすべて呼び出し側から注入される。**計算本体はBrowser Workerでそのまま実行できる構造である**（実際にBrowserで実行したことは無い）。

Node依存は計算の外側（runner script・formal gate・process envelope）に集中している（§5）。

### 4.3 推移的な依存（注意点）

- `materialize.ts` → `plannerGlobalOptimizationResearch.ts` → `src/services/dataTransfer/importExportValidation.ts` → `src/db/repositories/productionPlanRepository.ts`
  （`isRunningProductionPlanStatus()` のため）→ `src/db/AppDatabase.ts` という静的import連鎖があり、`AppDatabase.ts` はmodule評価時に `export const appDatabase = new AppDatabase()`（280行）を実行する。
  したがってGlobal AssignmentのWorker bundleにはDexieとこのinstance生成が含まれる。Phase 2-AのWorkerも同じ連鎖（`runGlobalPlannerResearch()`）を含んでいる
- Dexieはinstance生成時にはdatabaseを開かず、最初のqueryで開くと理解しているが、Repositoryで確認した事実ではない。P-1は (1) Browser adapterがrepository・`appDatabase` を参照しないことをisolation testで固定し、
  (2) 実Browser（PC Chrome）でrun前後の `indexedDB.databases()` がbenchmark originで空のまま（DBが作られない）であることを記録する。AGENTS.mdの「Planner WorkerからDexieへ直接アクセスしない」はこの監査で守る
- この連鎖を切るために `plannerGlobalOptimizationResearch.ts` や `importExportValidation.ts` を変更することは **P系列では行わない**（D-1Cの計算コード監査・既存Research runnerに影響するため。
  切る必要があればProduction統合の別PRで扱う。§15）

### 4.4 Search DomainのResearch専用seam

22 Targetをmaterializeした方式 `shape_constrained` は、`src/domain/search/research/` の `visitShapeConstrainedRouteCandidates()`（SEARCH_SPEC 5.6.9、D-0A-2a）を使う。
このmoduleは「Research only。`src/domain/search/index.ts` から再exportせず、Production moduleはimportしない」と規定されている。Browser benchmark bundleから
このmoduleを読むことはSEARCH_SPEC 5.6.9の範囲内（Research code）である。**Production統合ではこの規定と衝突する**（§15 #4）。

### 4.5 同期区間とcancel / yieldの粒度（確認済み）

| stage | yield / cancel点 | Nodeの所要時間（D-1C first、参考） |
| --- | --- | --- |
| PlannerInput構築（JSON parse、Export validation） | なし（同期） | setup 0.9 s（loader等を含む） |
| Phase 0（`createGlobalAssignmentContext()`） | なし（同期） | 1.7 s |
| Phase A（`buildReachTable()`） | 64位置ごとに `shouldCancel()` / `yieldControl()`（`YIELD_INTERVAL = 64`） | 11.3 s |
| Phase B / C（structural search） | runnerが `next(1)` で1 nodeごとに `yieldControl()`。solverは256 optionごとにnode内で `shouldCancel()`（`CANCEL_POLL_INTERVAL = 256`） | 17.7 s |
| D-0B診断 | なし（同期、候補ごと） | （materialization合計に含まれる） |
| Phase D（materialization） | Search内部checkpoint、形状制約Searchのcheckpoint（`shouldCancel` / `yieldControl` を渡す） | 約1.9 s（32.6 s − 上記3段） |
| Phase D' final input | なし（同期） | 0.30 s |
| Phase D' Planner | Production schedulerの64 actionごと（`PLANNER_SCHEDULER_YIELD_INTERVAL = 64`） | 4.2 s |
| Phase D' physical / Trace Replay | なし（同期。`replayPlannerSearchTrace()` はyieldもcancel点も持たない） | 0.003 s / 0.40 s |
| semantic SHA-256（Web Crypto） | 非同期API（Browserでは計測対象） | — |

同期区間の間はWorker event loopが止まり、cancel・pingは届かない（Phase 2-Aで最大13.3秒を観測した区間はPhase 1-Eのfinal Planner stage）。Global AssignmentのBrowserでの最大同期区間は未計測であり、
§9.3の「最大slice」で測る。設計 §12のとおり、同期的なTrace Replay・execution projection中の即時cancelは保証しない。

### 4.6 実行環境間の決定性に関わる箇所（確認済み・未検証）

- `hashStableValue()` / `stableStringify()`（`src/domain/models/hashing.ts`）はkeyを `Array.prototype.sort()`（code unit順）で並べ、FNV-1aで畳むので、JS engine・localeに依存しない
- semantic recordは `findNonPlainJsonPaths()` でplain JSONであることを確認しており、SHA-256は `JSON.stringify` の出力に対して取る。ECMAScriptの `JSON.stringify`（数値の最短表現を含む）は
  仕様で決まっている
- 一方、Domainの一部の順序付けは `String.prototype.localeCompare()`（locale引数なし）を使う: `src/domain/master/masterSelectors.ts`（42 / 49 / 207 / 269行）、
  `src/domain/search/routeEligibility.ts`（35 / 51 / 79行）、`src/domain/search/candidateFactory.ts`（182行）、`src/domain/rng/capabilities.ts`、
  `src/domain/artian/productionBonusAvailability.ts`。比較結果は実行環境のdefault localeとcollation実装（ICU等）に依存し得る。ASCIIのstable IDで実際に差が出るかは
  **未確認** であり、差が出ると主張しない。P-2は各環境の `navigator.language` / `Intl.DateTimeFormat().resolvedOptions().locale` とuserAgentを記録し、semantic不一致があったときの
  切り分けに使う（§12.4）。Domainの順序規則は変更しない

## 5. Node依存一覧

| Node側の要素 | 場所 | 役割 | Browserでの扱い |
| --- | --- | --- | --- |
| `node:fs`（`readFile` / `writeFile` / `appendFileSync` / `chmod` / `existsSync` / `lstatSync`） | D-1A / D-1C runner | Export・task・record・journal・Entry集合fileの読書き、排他作成、read-only化 | Exportはuserがpageで選んだ `File` だけを読む。record・Entry集合はmemory内で受け渡し、保存はuser操作の「JSON保存」（Blob download）と console API `exportJson()` だけ。journal fileは無い（progressはpostMessage） |
| `node:crypto` `createHash('sha256')` | runner | Export・semantic record・Entry集合・code tree のSHA-256 | Web Crypto `crypto.subtle.digest('SHA-256')`（`webCryptoSha256`）。**secure context必須**（§11.2）。code treeのhashはbuild時のdefine（下記） |
| `node:child_process`（`spawn` / `execFileSync`） | runner、`planner-global-assignment-d0b-child-process.mjs` の `runChildProcess()` | first / fresh子process、git（HEAD、clean、未commit、祖先関係、計算コード監査、登録文書の読取り） | 子process → Dedicated Worker（role別の新Worker）。gitの情報 → build時にbenchmark configが埋め込む `__PLANNER_GLOBAL_BENCHMARK_BUILD__`（commit、未commit有無、code SHA-256）。祖先関係・計算コード監査・登録文書の読取りは **移植しない**（§5.1） |
| `node:os`（`cpus` / `totalmem` / `freemem` / `release` / `platform` / `arch`） | runner | machine情報 | `navigator.hardwareConcurrency`、`navigator.deviceMemory`（Chromeのみ、丸めた値）、`navigator.userAgent` / UA-CH、`navigator.language`。空きmemoryはBrowserから取得できない（記録しない） |
| `node:v8` `getHeapStatistics()`、`process.memoryUsage()`、`process.resourceUsage().maxRSS` | runner（250 ms標本） | heap上限・heapUsed・RSS | Worker realmには相当APIが無い（Chromeの `performance.memory` はWorker realmに無いことをPhase 2-Aで確認）。§9.2の方法で別scopeとして測り、Node値から推測しない |
| `--max-old-space-size=8192`（heap envelope） | runner | 子processのheap上限 | **Browserに相当する設定は無い**。Worker heap上限は未知として記録する（§9.2） |
| wall-clock envelope（30分、`runChildProcess()` のtimer + kill） | runner | timeout分類 | main threadのtimer + `worker.terminate()`（§10）。非表示tabではtimerが遅延し得るので、timeoutの発火時刻も記録する |
| `vite` `createServer()` + `ssrLoadModule()` | runner | TS moduleのNode実行 | Vite benchmark build（bundle）。loaderの時間は無い（Worker module評価時間として別に測る） |
| `process.argv`（CLI option）、`process.exit` / `exitCode`、`SIGINT` / `SIGTERM` | runner | 条件・override・中断 | 条件は登録module（`registeredD1cConditions()`）からWorkerが自分で読む。overrideのprotocol fieldは持たない。中断は `gab_cancel` と `terminate()` |
| `setImmediate`（yield） | D-1A runner | macrotask yield | MessageChannel macrotask yield（局所copy）。timer（`setTimeout(0)`）は比較用の選択肢として残してよい |
| `performance.now()`（Node） | runner | stageの時間 | Worker realmの `performance.now()`。main threadとはtimeOriginが異なるので、跨ぐ比較は `performance.timeOrigin + performance.now()`（Phase 2-Bの `defaultEpochNow` と同じ）で揃える |
| `process.pid` / `execArgv` | runner、formal gate | process identity、heap flagの適用確認 | Workerにはpidが無い。identityは `requestId` + main threadが採番するWorker instance番号。heap flagは無い |
| `.local/` のraw file・run directory | runner | git-ignoredなraw record | operatorが「JSON保存」のfileを `.local/`（git-ignored）へ置く。公開するのは最小化したsummaryだけ（§8.4） |

### 5.1 Browserへ移植しないもの

- **formal gate一式**（`verificationFormal.ts` の `d1cFormalStartGate()` / `d1cFormalChildGateIssues()`、登録HEADの祖先関係、計算コード監査、登録fingerprintのcommit済み文書との照合、
  `execArgv` のheap envelope確認）: これらはNode・git・processを前提とするD-1C専用の正式計測契約である。P系列のBrowser runは **non-formal** であり、formal validity・acceptanceを
  主張しない（§12.4）。Browser用のformal契約が必要になった場合は、P-2の後に別の事前登録PRで設計する
- **D-1C formal runnerそのもの**: 登録HEAD `d15ea9b` 以降に許可外の計算コード変更があるHEADでは拒否する（意図どおり）。P-1でBrowser adapterを追加した後のHEADでは、D-1C formal runnerは
  計算コード監査で拒否される。D-1Cの正式記録は変わらず、再実行もしない
- **Node runner script自体**（`scripts/run-planner-global-assignment-d1a.mjs` / `d1c.mjs`）: 変更しない。Node referenceとしてD-1A runnerを **そのまま** 使う（§12.3）

## 6. 再利用可能なResearch計算境界

### 6.1 そのまま使うもの（変更しない）

| 層 | 関数・定数（確認済み） | 用途 |
| --- | --- | --- |
| 入力 | `globalResearchInputFromExport()`、`globalResearchDependencies()`（固定Clock `GLOBAL_RESEARCH_TIME`、`research.global.*` のID factory） | PlannerInputとPlanner dependencies |
| Engine | `ProductionRngEngine`（`production-rng:c5-e7`） | Phase A〜D'の唯一の予測authority |
| 条件 | `registeredD1cConditions()`（`materialization` = `registeredD0cConditions().conditions`、`verification.researchMaxPlanSteps` / `verificationBudget`） | P-2の実行条件（D-1Cと同じ値を同じauthorityから読む） |
| Phase 0〜D | `runMaterializationSmoke()`（`shouldCancel` / `yieldControl` / `onProgress` / `onMaterializedEntries` を注入）、`summarizeMaterializationRun()` | first Worker |
| Phase 0（fresh） | `createGlobalAssignmentContext()` | fresh Worker |
| Phase D' | `verifyPlannerCandidate()`（`shouldCancel` / `yieldControl` / `onStage` を注入）、`materializedEntriesFingerprint()` | first / fresh Worker |
| 受け渡し | `createD1aEntrySet()`、`d1aEntrySetIssues()`、`handoffFromEntrySet()`、`materializedEntriesFingerprintOfSemantic()`、`materializedEntriesFingerprintOfHandoffs()`、`differingSemanticFields()` | firstのEntry集合をfreshへ渡す検査 |
| evidence | `webCryptoSha256`、`jsonSha256`（`plannerGlobalBrowserEvidence.ts`） | semantic SHA-256 |

Entry集合のprovenanceの `repositoryHeadSha` には、build provenanceのcommit（40桁）を渡す（同じpage session・同じbuildの中での整合検査であり、gitの再観測ではない）。

### 6.2 新設する環境非依存のstage module（提案）

Node runnerの子process部分は `.mjs` にinlineで書かれており、Browserからは再利用できない。P-1は **同じ計算列** を、時計・hash・yield・cancel・Engine生成・入力構築をすべて注入で受け取る
環境非依存のTS moduleとして1か所に置く（提案名 `src/benchmarks/globalAssignment/browser/globalAssignmentBrowserStages.ts`）。Browser Worker controllerとVitest（Node環境）の両方がこれを呼ぶ。

```ts
// 提案。綴りは実装PRで変えてよい
interface StagePorts {
  sha256Bytes: (bytes: ArrayBuffer) => Promise<string>   // Export identity。Node runnerと同じく **decode前のbyte列** をhashする（textをhashするとBOM・不正byteで値が変わる）
  sha256Text: (text: string) => Promise<string>      // semantic record。Browser: webCryptoSha256（UTF-8）、Vitest: 同じ関数（Node 24のWeb Crypto）
  now: () => number                                  // Worker: performance.now()
  shouldCancel: () => boolean
  yieldControl: () => Promise<void>                  // Worker: MessageChannel macrotask yield（+ heartbeat / slice計測のwrapper）
  onEvent: (event: StageEvent) => void               // input stage / materialization progress / verification stage
  createEngine: () => RngEngine                      // Worker entry: () => new ProductionRngEngine()
  buildInput: (json: unknown) => PlannerInput        // Worker entry: json => globalResearchInputFromExport(json, 1_000)
}
runFirstStage(exportBytes: ArrayBuffer, conditions: RegisteredConditions, ports: StagePorts): Promise<FirstStageResult>
runFreshStage(exportBytes: ArrayBuffer, entrySet: D1aEntrySet, conditions: RegisteredConditions, ports: StagePorts): Promise<FreshStageResult>
```

不変条件（D-1A子processと同一であること。P-1のtestで固定する）:

1. PlannerInputは `buildInput(JSON.parse(text))` で作り、検証用 `maxPlanSteps` は1,000（D-1A runnerの `PLANNER_INPUT_MAX_PLAN_STEPS_FOR_VALIDATION_ONLY`）。Phase D'のResearch maxPlanStepsは
   `conditions.verification.researchMaxPlanSteps` を `verifyPlannerCandidate()` へ渡すだけで、PlannerInputを書き換えない
2. first: materializationのdependenciesは `globalResearchDependencies(engineA)`、Phase D'は `globalResearchDependencies(createEngine())`（新しいEngine・新しいID factory）。
   fresh: Phase 0は `globalResearchDependencies(engineB)`、Phase D'は新しいEngine。D-1A runnerと同じ構築順序にする（PlanのIDがprocess内の先行runに依存しないため）
3. 条件は `registeredD1cConditions()` だけから取る。run requestに条件fieldを持たせない（D-1Cの子processが「登録moduleから取り直す」のと同じ）。Vitestだけがcontroller optionで別条件を注入できる
4. semantic SHA-256はWorker内で `JSON.stringify(semantic)` に対して取り、postMessage前の値とする。main threadは受け取ったsemanticを再hashして一致を確認する（D-1Aの親の再hashと同じ）
5. D-0Cの登録identity・D-1CのRESULT・期待hashを入力に取らない（§12.5）。D-1A runnerの「D-0C同一性が不一致ならPlannerを走らせない」分岐は持たない（Browser runはmaterializationの
   結果をそのままPhase D'へ渡し、同一性は事後に判定する）
6. firstのPhase D'は `handoff.stage.kind === 'all_materialized'` でなければ `verifyPlannerCandidate()` が型付きoutcome（`materialization_*`）で止める。stage moduleは独自の判定を足さない
7. verification budgetは登録値（1）で、D-1A runnerと同じく最初のhandoff（`handoffs[0]`）だけを検証する。structural candidate 1件の条件でhandoffが2件以上ある場合は
   integrity issueとして記録し、2件目以降を検証しない（設計 §10.4: 未試行候補は `not_attempted`）。handoffが0件（`unsupported_input`、候補なし、cancel、fail closed）の場合はPhase D'を
   行わず、materialization semantic recordのoutcomeをそのまま記録する（D-1A runnerがPhase D'へ進まない場合と同じ）

### 6.3 必要なBrowser専用adapter

| adapter（提案） | 内容 |
| --- | --- |
| Export reader | `File`（Blob）を `arrayBuffer()` で読み、`webCryptoSha256` でhash、Node `Buffer.toString('utf8')` と同じ結果になる設定の `TextDecoder` でdecode（§7.5。Node 24で同じ出力になることを確認済み）。main threadの観測値（name / bytes / SHA-256）と照合し、不一致はintegrity issue |
| yield / slice monitor | MessageChannel macrotask yield（局所copy）をwrapし、yield間隔の最大値（stage別の最大同期slice）・yield回数を数え、heartbeatを間引いて送る（§7.7） |
| cancel state | requestId別のcancel flag（`gab_cancel` で立てる）。`shouldCancel()` として注入 |
| progress relay | stage event・materialization progress event（`MaterializationProgressEvent`）・verification stage eventをそのまま `gab_progress` で送る |
| environment probe | `crossOriginIsolated`、`isSecureContext`、`hardwareConcurrency`、`deviceMemory`、userAgent、language / locale、Worker realmの `performance.memory` の有無、`crypto.subtle` の有無、`MessageChannel` の有無、`structuredClone` の有無、Engine version、CalculationContext、build provenance |
| result packager | semantic・SHA-256・summary・observed・Entry集合（firstだけ）をplain dataでまとめ、送信前にnon-plain値が無いことを確認する |
| main-thread harness / runner | 1 harness = 1 Worker = 1 run、requestのlifecycle（`running` / `cancelling` / `settled`。cancel後の結果不採用の最終保証、§7.8 / §10）、first → terminate → fresh → terminate の順序、timeout / cancel grace、ping、memory hooks、JSON export（§7.4） |
| page | Export選択、条件（登録値の読取り表示だけ。編集不可）、実行・cancel・ping・JSON保存、console API（外部driver用） |

### 6.4 診断のみで、判定に使わないもの

D-0Bの診断（G1 / G3 / G4、`diagnoseSearchPolicyShapes()` 等）はmaterialization semantic recordに含まれるので、Browserでも計算される（記録の一部としてNodeとの一致を確認する）。
これらを使った分岐・枝刈りをBrowser adapterに足さない。

## 7. Worker entry / protocol設計

### 7.1 配置（提案）

```text
benchmark-global-assignment.html                          repo直下。vite.benchmark.config.ts の2つ目のrollup input（benchmark.html は変えない）
src/benchmarks/globalAssignment/browser/
  main.tsx                                                 page entry（ThemeProvider + page）
  GlobalAssignmentBrowserBenchmarkPage.tsx                 page
  globalAssignmentBrowserProtocol.ts                       message型・guard・request validation（prefix gab_、protocol version）
  globalAssignmentBrowserStages.ts                         環境非依存のfirst / fresh stage（§6.2）
  globalAssignment.worker.benchmark.ts                     Worker controller（fresh Worker policy、cancel、heartbeat、slice計測）
  globalAssignment.worker.benchmark.entry.ts               Worker entry（ProductionRngEngine、globalResearchInputFromExport を注入）
  globalAssignmentBrowserHarness.ts                        main-thread harness（1 harness = 1 Worker = 1 run）
  globalAssignmentBrowserRunner.ts                         run slotごとのlogical run、request lifecycle（§7.8）、cancel trigger、ping run、memory hooks、JSON export
  globalAssignmentBrowserJudgement.ts                      logical runの判定とparity判定（pure、P-2のanalyzerと共用）
  *.test.ts、browserIsolation.test.ts
```

**採用理由（Option A）**: 既存のGlobal Assignment isolation test（`isolation.test.ts` 1件目）は、Production scopeとして `src/{app,components,db,domain,services,stores,workers,pages,presentation,data}/**` と
`src/*.{ts,tsx}` を **除外patternなしで** 走査し、`globalAssignment|GlobalAssignment|runMaterializationSmoke|verifyPlannerCandidate|…` を含むfileを禁止している。Phase 2-Aの慣例
（`src/workers/*.worker.benchmark.ts`、`src/pages/*BenchmarkPage.tsx`、`BenchmarkApp.tsx` へのtab追加）に従うと、`src/workers` / `src/pages` のfileがGlobal Assignmentの識別子を含み、
この検査に違反する。Global Assignmentの全Browser fileを `src/benchmarks/globalAssignment/browser/` に置き、独立したHTML entryから読むことで、既存の検査を一切緩めずに隔離を保てる。

**採用しなかった案（Option B）**: Phase 2-Aと同じ配置・`BenchmarkApp` へのtab追加。`isolation.test.ts` のProduction scanにPhase 2-Aと同じ除外pattern（`src/pages/*BenchmarkPage.tsx` 等）を足す必要があり、
Global Assignmentの隔離検査を弱める変更になる。除外patternは名前の規約に依存し、`src/pages` に置いたfileがProduction pageからimportされないことを名前だけで保証することになる。

`src/benchmarks/globalAssignment/browser/` は `isolation.test.ts` の `import.meta.glob('./*.ts')`（非再帰）の対象外なので、既存のruntime module一覧の完全一致検査も変わらない。代わりに
browser folder専用のisolation testを足す（§13.2）。

### 7.2 Worker entry

```ts
// 提案（globalAssignment.worker.benchmark.entry.ts）
attachGlobalAssignmentBrowserWorker(self as unknown as WorkerScope, {
  createEngine: () => new ProductionRngEngine(),
  buildInput: json => globalResearchInputFromExport(json, 1_000),
  conditions: () => registeredD1cConditions(),
})
```

- Worker作成は `new Worker(new URL('./globalAssignment.worker.benchmark.entry.ts', import.meta.url), { type: 'module' })`（harness内。Phase 2-Aと同じ形）
- module評価が終わったら `gab_ready`（environment probe付き）を送る。harnessは `new Worker()` 直前からreadyまでを「Worker起動時間」とする
- Master Dataは `globalResearchInputFromExport()` 内の `loadMasterData()` がWorker内で読む（bundle済みJSON。network fetchは無い）。master validationに失敗した場合は入力構築のerrorとして
  `gab_error` を返す（計算を続けない）
- Production Worker（`planner.worker.ts`、`search.worker.ts` ほか）・`plannerWorkerContracts.ts`・`PlannerWorkerClient` には一切触れない。Production Worker requestを追加しない

### 7.3 protocol（提案。prefix `gab_`、version `global-assignment-browser:1`）

| 方向 | message | field | 規則 |
| --- | --- | --- | --- |
| main → Worker | `gab_run` | `protocolVersion`、`requestId`、`role: 'first' \| 'fresh'`、`exportFile: Blob`（fallback: `exportBytes: ArrayBuffer` をtransfer）、`exportIdentity: { fileName, bytes, sha256 }`（main threadの観測値）、`entrySet`（freshだけ。`D1aEntrySet` のplain data）、`execution: { yieldMode, heartbeatIntervalMs, workerHeapSampling }` | 1 Workerで1回だけ（2回目・重複requestIdは `gab_error`）。条件・期待hash・D-0C identity・RESULTのfieldは **持たない**。`role` と `entrySet` の整合（firstはnull、freshは必須）を計算前に検査 |
| main → Worker | `gab_cancel` | `requestId` | main threadが対象requestを `cancelling` にした **後** にpostする（§7.8 C1）。Workerはdispatchできた時点でcancel flagを立て、直ちに `gab_cancel_ack` を返す（requestが既に終わっていてもackだけ返す） |
| main → Worker | `gab_ping` | `pingId` | 直ちに `gab_pong` |
| Worker → main | `gab_ready` | `environment`（§6.3のprobe、build provenance） | module評価完了 |
| Worker → main | `gab_accepted` | `requestId` | request検証が通った直後 |
| Worker → main | `gab_progress` | `requestId`、`event`（input stage / materialization progress / verification stage）、`atMs`（Worker epoch） | §7.7 |
| Worker → main | `gab_heartbeat` | `requestId`、`stage`、`yields`、`maxSliceMs`、`elapsedMs`、`workerHeap`（取得できる場合だけ） | §7.7 |
| Worker → main | `gab_cancel_ack` / `gab_pong` | `requestId` / `pingId` | — |
| Worker → main | `gab_result` | `requestId`、`result`（§8.2） | 計算が終わったとき、Workerがcancel flagを見ていなければ送る。Workerが `gab_cancel` をdispatchする前に送ったものは、main threadが `cancelling` 以降なら採用しない（§7.8 C2） |
| Worker → main | `gab_cancelled` | `requestId`、`stoppedAt`（stage）、`observed`（それまでの時間・slice） | Workerがcancel flagを認識した後の終了（cancel点で止まった場合、または `gab_result` を送る直前にflagを見た場合。best effort。§7.8） |
| Worker → main | `gab_error` | `requestId`、`stage`、`errorName`、`message` | 入力構築の失敗、request不正、予期しない例外。`GlobalAssignmentInvariantError` 等のResearch内部例外もここへ来る（runnerが型付きoutcomeにしないもの） |

`requestId` はmain threadが採番する識別子（例: `gab.<logicalRun>.<role>`）で、semantic recordにもEntry / Plan IDにも入らない。
Workerは1 requestにつき終了message（`gab_result` / `gab_cancelled` / `gab_error`）を1件だけ送る。どの終了messageを採用するか・捨てるかはmain threadのrequest lifecycle（§7.8 / §10）だけが決める。

### 7.4 logical runの実行順序

```text
page: userがExport fileを選ぶ → main threadでExport identity（name / bytes / SHA-256）を1回観測（計測外として時間を記録）
for each run slot of the measurement plan（slot ID・目的を記録に付ける。§12.2）:
  first = new harness → whenReady → run(role first, exportFile, entrySet null)
          → firstのrequestが completed でsettle（gab_resultを採用）→ semantic再hash → terminate
  firstが completed 以外でsettle（cancelled / cancelled_terminated / timeout / error ほか）、またはEntry集合を返さない（all_materializedでない）
          → Entry集合を取り出さず、freshを起動しない（not_run。§7.8 C10）
  fresh = new harness → whenReady → run(role fresh, exportFile, entrySet = firstのEntry集合)
          → freshのrequestが completed でsettle → semantic再hash → terminate
  judgeBrowserLogicalRun(first, fresh, integrityIssues)（§12.1）
analyzer（事後、P-2）: 測定時commitの計画・Node reference・D-1C公開RESULTとparity判定、cancel試験の判定、未完了の集計（§12）
```

- 同時実行は1 Worker（Node D-1Cのconcurrency 1と同じ）。first Workerをterminateしてからfresh Workerを作る（2つのheapを同時に持たない）
- 2回目以降のlogical runはfirstのmaterializationから再計算する（前runのEntry集合を使わない。D-1Cと同じ）
- 自動retryはしない（設計 G6 / G7）。失敗・中断したslotを別のrunで置き換えない。operatorが明示的に再実行したrunは計画外のrunとして記録し、比較母集団に入れない（§12.2）

### 7.5 Workerへの入力の渡し方とPlannerInput構築

- **main threadではPlannerInputを作らない**（Phase 2-Aとの違い）。理由: (1) Node子processが自分でExportを読み自分で入力を作るのと同じ独立性をfirst / freshの各Workerに持たせる、
  (2) 19 MBのJSON parseとExport全体のvalidationをmain threadで行うとUIが止まる（特にスマートフォン）、(3) 「PlannerInput準備時間」をWorker内で測れる
- 渡すのは `File`（Blob）で、structured cloneは本体のcopyではなく参照の受け渡しになることを期待している（Repositoryでは未確認）。Worker内で `arrayBuffer()` → SHA-256 →
  UTF-8 decode → `JSON.parse()` → `buildInput()` の順に行い、各区間の時間を測る。decodeはNode runnerの `Buffer.toString('utf8')` と同じ結果にする
  （`new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })`: 不正なbyte列は置換文字にし、BOMを取り除かない。既定の `TextDecoder` はBOMを取り除くので、
  BOM付きExportでNodeとBrowserの挙動が分かれる）。Blobの受け渡しができない環境では、main threadが読んだ
  `ArrayBuffer` のcopyをtransferする方式へ切り替え、その旨を環境記録に残す（semanticには影響しない）
- Workerは自分で求めたExport SHA-256をrequestの `exportIdentity.sha256` と比較し、不一致はintegrity issue（`export_changed`）にする。これはuserが選んだ入力の同一性検査であり、
  過去の結果を入力にするものではない
- PlannerInput構築後は、Export text・parse結果への参照を捨ててからPhase 0へ進む（GCで回収可能にする。回収されたかは§9.2でしか分からない）

### 7.6 Phase A〜D'の実行

stage module（§6.2）の `runFirstStage()` / `runFreshStage()` を呼ぶだけで、controllerは計算の順序・条件・判定に手を入れない。
materialization progress（`onProgress`）とverification stage（`onStage`）はそのまま中継する。`onMaterializedEntries` で受け取ったhandoffは1件（structural candidate 1件）である。

### 7.7 進捗通知

| 種類 | 内容 | 頻度 |
| --- | --- | --- |
| input stage | `export_read` / `export_hashed` / `json_parsed` / `input_built` の開始・終了 | 各1回 |
| materialization progress | `context`、`reach_table`、`structural_search`、`structural_candidate`、`candidate_started`、`target_started` / `target_settled`（43組）、`candidate_settled` | 発生ごと（合計約100件） |
| verification stage | `handoff` / `final_input` / `planner` / `trace_replay` / `physical` の started / finished | 各2回 |
| heartbeat | 現在stage、累計yield回数、直近区間と累計の最大slice、経過時間、Worker heap（取得できる場合だけ） | yield時に、前回送信から `heartbeatIntervalMs` 以上経っていれば送る |

- Phase A（11 s級）とPhase B / C（17 s級）はmaterialization progressが段の開始・終了にしか出ないので、heartbeatが「生きていること」の唯一の信号になる。
  heartbeatが途切れた区間 = 同期区間（または停止したWorker）であり、§9.3の応答性の指標になる
- 進捗は数と段の名前だけで、**完了率・残り時間を推定して表示しない**（REQUIREMENTS 19「正確に求められない完了率を推定して表示しない」。Research pageでも同じ扱いにし、Production化の際に
  そのまま使える形にしておく）。`target_settled` の件数（k / 43）は事実の件数として表示してよいが、時間の割合として扱わない
- progressとheartbeatはexecution-onlyで、semantic recordを変えない（`runMaterializationSmoke()` の `onProgress` はstructured cloneを渡す既存仕様）

### 7.8 キャンセル（安全保証はmain threadのrequest lifecycle）

**cancel後の結果不採用を最終的に保証するのはmain thread（harness）である。** Workerは同期区間の間 `gab_cancel` をdispatchできないので、main threadがcancel操作を受け付けた後でも、
Workerがcancelを知らないまま計算を終えて `gab_result` を送ること、またはcancel受付の時点で `gab_result` が既に送信済みでmain threadに未着であることは避けられない。
Worker側のcancel flagと送信抑止はbest effortであり、安全保証の根拠にしない。

main thread（harness）の不変条件:

| # | 不変条件 |
| --- | --- |
| C1 | userのcancel操作（UI、console API、runnerのcancel trigger）を受け付けたとき、harnessは同じ同期処理の中で対象requestを `running` → `cancelling` に変え、受付時刻を記録する。`gab_cancel` のpostはその後に行う（cooperative cancelの要求） |
| C2 | `cancelling` のrequestに届いた `gab_result` は、requestIdが一致していても、Workerがいつ送ったかに関わらず採用しない。payloadは保持・hash・保存せず直ちに捨て、観測値 `ignoredResultAfterCancel`（到着時刻）だけを記録する |
| C3 | `cancelling` から `running` へ戻る遷移は無い。`gab_result` の到着、`gab_cancel_ack` の有無、message間の到着順はこの状態を変えない |
| C4 | `cancelling` のrequestは、Workerの終了message（`gab_cancelled`、C2で捨てた `gab_result`、`gab_error`）の最初の1件で `cancelled` としてsettleする（`gab_error` の内容は観測値に残す）。Workerは1 requestにつき終了messageを1件しか送らないので、捨てた `gab_result` の後に `gab_cancelled` を待たない |
| C5 | cancel受付から `cancelGraceMs` 以内に終了messageが無ければ `worker.terminate()` し、`cancelled_terminated` としてsettleする。cancel受付後はwall-clock timeout（`workerWallMs`）のtimerを止め、graceのtimerだけが働く |
| C6 | settleはrequestごとにちょうど1回（cancel・timeout・error・正常完了・page離脱・disposeのどの経路でも）。2回目以降のsettleは状態を変えない。settle直後にWorkerをterminateする |
| C7 | settle後に届いたmessageと、未知のrequestIdのmessageは結果として適用せず `lateResponses` に数える（Phase 2-Aと同じ観測値。`gab_cancel_ack` の遅着もここに入る） |
| C8 | 既にsettledのrequestへのcancel操作は何もしない（状態を変えず、`gab_cancel` もpostせず、`cancel()` はfalseを返す）。採用済みの正常結果を後から取り消すことはしない |
| C9 | 新しいrunは新しいharness・新しいWorker・新しいrequestIdで始める。前のharnessはdispose済みでlistenerを外し、前のWorkerはterminate済みである。前のrequestのmessageが新しいharnessへ届いても、requestIdが一致しないので `lateResponses` になり、結果・Entry集合・progressとして適用されない |
| C10 | runnerは、first Workerのrequestが `completed`（`gab_result` を採用）でsettleしたときだけ、そのEntry集合をfreshへ渡す。`cancelled` / `cancelled_terminated` ほか `completed` 以外のfirstからはEntry集合を取り出さず、freshを起動しない。前のlogical runの値を次のlogical runへ渡さない |

Worker（controller）の責務（best effort）:

- `gab_cancel` をdispatchできた時点でcancel flagを立て、直ちに `gab_cancel_ack` を返す（requestが終わっていてもackだけ返す）
- 計算は既存のcancel点（Phase Aの64位置、structural searchのnode / 256 option、Searchのcheckpoint、Plannerの64 action）でflagを読んで止まり、`gab_cancelled` を送る。
  停止後のoutcomeは既存の型どおり（`scan_cancelled`、`structural_search_incomplete(cancelled)`、Targetの `unmeasured(cancelled)`、verificationの `unmeasured(cancelled)`）で、
  not found・no match・`planner_rejected` にしない
- `gab_result` を送る直前にもflagを確認し、立っていれば `gab_cancelled` を送る。flagが立つ前に送った `gab_result` はmain threadがC2で捨てる
- 終了messageは1 requestにつき1件。Worker側のこれらの処理をmain threadの安全保証の代わりにしない

境界（main threadのevent loopでどちらのtaskが先に実行されたかで決まり、記録した受付時刻・到着時刻から再現できる）:

| 順序 | 扱い |
| --- | --- |
| cancel操作の受付より **前** に、`gab_result` がmain threadで採用された（`completed` でsettle済み） | 正常完了である。その後のcancel操作はC8で何もしない。過去の結果を取り消す保証はしない |
| cancel操作の受付より **後** に `gab_result` が到着した | Workerの送信時刻に関わらずC2で捨て、C4で `cancelled` としてsettleする |

記録と分類（新しい分類は増やさない）:

- 結果を捨てたrequestのoutcomeは `cancelled` で、観測値 `ignoredResultAfterCancel` を持つ。cooperative停止（`gab_cancelled`）と区別して数えるが、どちらも正常完了ではない
- 結果を捨てたrequestを含むlogical runは、正常完了とも `browser_nonformal_conditions_met` とも扱わない。§12.1の判定では `unmeasured(cancelled)` になり、parityの比較母集団に入らない（§12.2）
- 使う分類と観測値は `cancelled` / `cancelled_terminated`（§7.11）、`lateResponses`、`ignoredResultAfterCancel` だけである
- 測るもの: cancel受付 → `gab_cancel_ack`（cancel messageがWorkerでdispatchされるまで = 同期区間の残り）、cancel受付 → settle、settleの経路（`gab_cancelled` / 捨てた `gab_result` / `gab_error` / terminate）、terminateの件数（§9.3）
- Workerはrunごとに使い捨てで状態を永続化しないので、terminateは常に安全である

Production Plannerのcancel仕様・既存のProduction Worker protocol・既存benchmark harness（Phase 2-Aを含む）はこの契約で変更しない。この契約はP系列のResearch harnessだけのものである。

### 7.9 Worker終了・cleanup

- 全ての終了経路（採用したresult / cancelled（捨てたresultを含む）/ error / timeout / cancel grace超過 / native error / page離脱 / harness dispose）で、settle（1回だけ、§7.8 C6）の直後に
  `worker.terminate()` を呼ぶ。Workerを再利用しない（fresh Worker policy）
- harnessはterminate前にlistenerを外し、未決のping / readyを解決（null / reject）してから終える（Phase 2-Aの `dispose()` と同じ）
- `pagehide` で実行中のWorkerをterminateし、そのrunを `page_left` として記録する（記録はmemory内なので、page自体が破棄された場合は残らない。§10）
- terminate後のmemory回収は保証されない。§9.2のrun後採取（dispose後・待機後）で観測だけする

### 7.10 実行結果の受け取り

- harnessが `gab_result` を採用するのは、requestIdがactive requestと一致し、かつそのrequestの状態が `running` のときだけである（そのとき `completed` としてsettleする）。
  状態が `cancelling` なら捨てて `cancelled` としてsettleし（§7.8 C2 / C4）、settle後・未知requestIdなら `lateResponses` に数えるだけで適用しない（C7 / C9）
- main threadは採用したsemantic（materialization / verification）を再hashしてWorkerのSHA-256と照合する。Entry集合は、firstが `completed` でsettleした場合だけ（C10）、
  `d1aEntrySetIssues()` で検査してからfreshへ渡す
- 受け取ったEntry本体・Plan全Stepはpage memoryだけに置き、page表示は件数・hash・outcomeだけにする（Target ID等の一覧を画面に出さない）

### 7.11 timeout・OOM・Worker errorの分類

| 事象 | 検出 | 分類 | 備考 |
| --- | --- | --- | --- |
| 計算が `workerWallMs` を超えた | main threadのtimer | `timeout`（terminate） | 非表示中はtimerが遅れ得るので、発火時刻とvisibilityを記録 |
| cancel受付後、Workerの終了message（`gab_cancelled` / `gab_result` / `gab_error`）が届いた | main threadのrequest lifecycle | `cancelled` | `gab_result` なら採用せず `ignoredResultAfterCancel` を記録（§7.8 C2 / C4） |
| cancel受付後 `cancelGraceMs` 内に終了messageが無い | main threadのtimer | `cancelled_terminated` | 同期区間の長さの観測値になる |
| Worker module評価・実行中の未捕捉例外 | Worker `error` event | `worker_error` | message・filename・lineno（取得できれば）を記録 |
| messageのdeserialize失敗 | `messageerror` event | `worker_error`（messageerror） | — |
| Worker内で捕捉したerror | `gab_error` | `worker_reported_error`（stage別） | 入力構築・request検証・予期しない例外 |
| renderer process crash（tab全体の喪失） | **page自身は観測できない**。外部driver（CDP `Inspector.targetCrashed` 等）・operatorの目視 | `page_lost` | page内の記録は失われる。外部driverのlogとoperator記録で残す |
| OOM | 外部の証拠（crash dumpのOOM、Browser / OSが示すmemory不足の表示）があるときだけ | `out_of_memory` | heapの推移やcrashだけからOOMと推測しない。証拠が無ければ `page_lost` / `worker_error` のまま |
| 非表示・freeze・discard | `visibilitychange`、`freeze` / `resume`（Chrome）、`pagehide` / `pageshow`（`persisted`） | `environment_interrupted`（観測値の無効化） | 計算が完了していればsemanticは有効、時間・応答性の値は集計から除外 |
| secure contextでない、Web Crypto / module Worker / MessageChannel / structuredClone が無い | environment probe | `environment_unsupported` | runを開始しない |

いずれも「Route無し」「not found」「Planner不成立」に読み替えない（設計 G6 / G7）。Node側の `D1aProcessOutcome`（`completed` / `timeout` / `out_of_memory` / `process_failure` / `cancelled`）へは
次のように対応させ、§12.1の判定に使う: `timeout` → `timeout`、`out_of_memory` → `out_of_memory`、`cancelled` / `cancelled_terminated` / `page_left` → `cancelled`、
`worker_error` / `worker_reported_error` / `page_lost` → `process_failure`。元のBrowser分類は記録に残す。

### 7.12 実行結果を再利用・永続化しない初期方針

- IndexedDB（Dexie）、`localStorage`、`sessionStorage`、Cache Storage、Service Workerを使わない。結果・Entry・Plan・ReachTableをrun間・page session間で再利用しない
- first → freshのEntry集合の受け渡しは、firstが `completed` でsettleした場合だけ（§7.8 C10）、同じlogical run内のmemoryだけで行い、logical runの終了で捨てる
- 保存はuserが押す「JSON保存」（Blob download）とconsole API `exportJson()` だけ。保存先はoperatorが決め、Repositoryへは最小化したsummaryだけをcommitする（§8.4）
- 生成Entry（`build-list.constrained.*`）・Research Candidate ID（`candidate.research.global-assignment.*`）・Plan ID（`research.global.plan.*`）をアプリのDBへ書かない。benchmark originは
  アプリ本体のoriginと別（ローカルpreview）だが、それにも依存せず「書かない」ことをisolation testで固定する

### 7.13 Node計測とのsemantic parityを保つ仕組み

- 計算列はstage module 1か所（§6.2）で、Browser Worker controllerとVitestが同じものを呼ぶ
- P-1のVitestで、stage moduleの結果（semanticとSHA-256）が、同じsyntheticシーンでD-1A子processと同じ直接呼出し列（`runMaterializationSmoke()` → `verifyPlannerCandidate()`、同じdependency構築順）の
  結果と完全一致することを固定する
- P-2で、実Exportに対するBrowserの値を、同じmeasurement HEADのD-1A non-formal runner（Node）の値と事後に比較する（§12）

## 8. 入力・出力・provenance

### 8.1 入力

| 入力 | 取得元 | 備考 |
| --- | --- | --- |
| Export | userがpageで選んだfile（PC: file picker / 外部driverはCDP `DOM.setFileInputFiles`、スマートフォン: OSのfile picker） | Repositoryに置かない。identity = name / bytes / SHA-256 |
| 条件 | `registeredD1cConditions()`（Worker内） | pageは読取り表示だけ（編集不可） |
| execution option | page（`heartbeatIntervalMs`、`workerWallMs`、`cancelGraceMs`、run slotの一覧（slot ID・目的・順序。§12.2）、cancel trigger、ping / memory runの選択） | 計算に影響しない。P-2の測定計画で値を固定し記録する（§16） |
| **入力にしないもの** | oracle manifest / verifier / RESULT JSON、D-0C / D-1Cの登録identity・期待hash、過去のEntry集合・raw record、Target ID・位置、Target順序 | 設計 §11.1と同じ。比較は事後のanalyzerだけ（§12.5） |

### 8.2 出力（Worker result、提案）

```ts
interface GlobalAssignmentBrowserWorkerResult {
  role: 'first' | 'fresh'
  protocolVersion: 'global-assignment-browser:1'
  environment: BrowserEnvironmentProbe               // §6.3
  exportObservation: { fileName: string; bytes: number; sha256: string; matchesRequest: boolean }
  calculationContext: CalculationContext; rngEngineVersion: string
  conditions: { materialization: ShapeMaterializationResearchConditions; researchMaxPlanSteps: number; verificationBudget: number; source: 'registeredD1cConditions' }
  phase0: { planningTargetCount: number; planningTargetIdsSorted: string[] }   // raw記録用。公開summaryには件数だけ
  materialization: { semantic: MaterializationSemanticRecord; semanticSha256: string; summary: MaterializationRunSummary; observed: MaterializationObservedRecord } | null  // firstだけ
  entrySet: { value: D1aEntrySet; sha256: string; entryFingerprint: string; entryCount: number } | null                                                                     // firstだけ
  verification: { semantic: PlannerVerificationSemantic; semanticSha256: string; observed: PlannerVerificationRecord['observed'] } | null
  observed: {
    timing: WorkerTiming                             // §9.1
    slices: Record<string, { maxSliceMs: number; yields: number }>   // stage別
    heartbeats: number
    workerHeap: WorkerHeapSample[] | null            // Worker realmで取得できる場合だけ。無ければnull（推測しない）
  }
}
```

### 8.3 provenance（記録するもの）

build provenance（`__PLANNER_GLOBAL_BENCHMARK_BUILD__` のcommit / 未commit有無 / code SHA-256 / code paths。`BENCHMARK_CODE_PATHS` に新しいHTML entryを加える）、protocol version、
materialization / verification protocol version（`global-assignment-d0a2b:1` / `global-assignment-d1b:1`）、条件とそのsource、Export identity、CalculationContext、Engine version、
Master data version、environment probe（§6.3）、serving方法（URL origin、COOP / COEP、secure context）、測定環境（§11.5）、外部driverのSHA-256（使った場合）、
`oracleFreeExecution: true` / `oracleInformedDesign: true`（設計 §11.2）、`formal: false`。

### 8.4 公開と非公開

- page JSON（raw）はEntry本体・Target ID・Plan全Stepを含み得るので、git-ignoredな `.local/` にだけ置く。公開しない
- 公開するsummary（P-2）はD-1C公開RESULTと同じ最小化方針: Target / OwnedWeapon / Entry / Candidate / Conflict / CounterのID、UUID、local path、per-Target配列を含めない。
  hash・件数・outcome・時間・memory・環境だけにする

## 9. 性能計測項目

すべて観測値であり、semanticの判定に使わない（設計 G6 / G7）。sampling値は「max sampled」と書き、連続的なpeakと呼ばない。

### 9.1 計算時間

| 指標 | 開始 → 終了 | 時計 | 取得元 |
| --- | --- | --- | --- |
| Export identity（main） | file選択 → SHA-256確定 | main | page（計測外の準備時間として記録） |
| Worker起動 | `new Worker()` 直前 → `gab_ready` 受信 | main | harness |
| request受理 | `gab_run` post → `gab_accepted` 受信 | main | harness（structured clone + 検証） |
| PlannerInput準備 | Worker: Export読込 / SHA-256 / decode / `JSON.parse` / `buildInput()` の各区間と合計 | Worker | adapter |
| Phase 0 | `elapsedMs.context`（first）、fresh側はadapterで測る | Worker | `MaterializationObservedRecord` / adapter |
| Phase A | `elapsedMs.reachTable` | Worker | `MaterializationObservedRecord` |
| Phase B / C | `elapsedMs.structuralSearch`、`elapsedMs.toFirstStructuralCandidate` | Worker | 同上（B / Cは1つのcoverage-gated searchなので分けない） |
| Phase D | `elapsedMs.candidates[0].diagnostics`、`.materialization`、Target別 `ms` と `shapeTimeline`（射影起点 / 形状制約の内訳） | Worker | 同上 |
| Phase D' | `elapsedMs.handoff` / `final_input` / `planner` / `trace_replay` / `physical` / `total` | Worker | `PlannerVerificationRecord.observed` |
| Trace Replay | 上の `trace_replay` | Worker | 同上 |
| evidence | semantic SHA-256・Entry集合作成 | Worker | adapter |
| Worker総計算 | `gab_accepted` → result post | Worker | adapter |
| round trip | `gab_run` post → result受信（結果のstructured cloneを含む） | main | harness |
| logical run総時間 | first Worker作成 → fresh terminate | main | runner |

### 9.2 メモリ

| scope | 方法 | 取得できる環境（想定。P-1 / P-2で可否を記録） | 注意 |
| --- | --- | --- | --- |
| page + Worker（GC後のlive相当、Worker内訳つき） | `performance.measureUserAgentSpecificMemory()` | Chrome系（`crossOriginIsolated` 必須 = COOP / COEP + secure context） | 1回の解決に長時間かかり得る（Phase 2-Aで10〜60秒）ので **timing runと別のmemory run** で採る |
| main realmのJS heap | `performance.memory`（非標準） | Chrome系のmain realm | Workerのheapではない。`jsHeapSizeLimit` はpage realmの参考値で、Worker上限と同一視しない |
| Worker realmのJS heap | `performance.memory` | Phase 2-AではChromeのWorker realmに **無かった** | 無い場合はnull。推測しない |
| Worker isolateのused heap（未回収garbageを含む） | 外部CDP `Runtime.getHeapUsage`（Worker targetへattach、約500 ms間隔） | PC Chrome、Android Chrome（USB remote debugging経由） | sampling間のpeakは保証しない |
| Browser process | OSのprocess memory（Windows: renderer processのPrivateMemorySize64 / WorkingSet、Android: `adb shell dumpsys meminfo` 等） | PC、Android（方法はP-2で確定） | Browser全体のscopeで、Workerだけの値ではない |
| Safari | Web Inspector（Timelines / Memory） | macOSのSafariに接続できる場合だけ | Macが無ければ取得できない（未測定と記録） |
| OOM / Worker termination | §7.11 | — | 外部の証拠があるときだけ `out_of_memory` |

**計測不能（未測定として記録し、推測しない）**: Dedicated Worker自身のheap上限（Chrome Worker realmは公開しない）、sampling間の連続的なpeak、Safari / iOSのmemory（Macが無い場合）、
iOSがtabを破棄した理由、空き物理memory（Browserから取得できない）、端末の実RAM（`deviceMemory` は丸めた値でChromeだけ）。Node値（heapUsed 1.37〜1.42 GB、maxRSS約1.6 GB）とBrowser値は
別scopeであり、互いに換算しない。

### 9.3 操作性

| 指標 | 方法 |
| --- | --- |
| progress通知間隔 | `gab_progress` / `gab_heartbeat` の受信間隔（main）。stage別の最大・中央値 |
| 最大同期slice | Workerのyield間隔の最大値（stage別、§6.3）。heartbeatが届かない区間の長さとして main 側でも観測 |
| Workerの応答性 | 別runで chained ping（pong受信で次のping。Phase 2-Aと同じ）。RTTの中央値・p95・最大、200 ms超の回数、stageとの対応。**Worker event loopの応答性でありUI frame rateではない** |
| cancel受付 | main threadのcancel受付（`cancelling` への遷移、§7.8 C1）→ `gab_cancel_ack`（stage別に、Phase A / B・C / D / D' Planner / D' Trace Replay中を狙う。triggerは該当stageのprogress受信 + 固定遅延） |
| cancel停止 | cancel受付 → settle。経路（`gab_cancelled` / 捨てた `gab_result`（`ignoredResultAfterCancel`）/ `gab_error` / `cancelGraceMs` 超過のterminate）ごとの件数と時間 |
| 停止後の遅延結果混入防止 | cancel受付後に届いた `gab_result` が採用されないこと（`ignoredResultAfterCancel`）、settle後・前runのmessageが `lateResponses` に数えられ適用されないこと。cancelしたrequestから採用された結果が0件であること（§7.8） |
| 再実行可能性 | 同じpage sessionで、cancel・timeout・error・正常終了の後に新しいlogical runを開始し、完了すること。前runの状態が残らないこと（semanticが1回目と一致） |
| UIの応答性（参考） | main threadのlong task（`PerformanceObserver` の `longtask`、取得できる環境だけ）。入力構築をWorkerへ移したことの確認 |

### 9.4 再現性（semantic）

D-1C・Node referenceとの比較項目（§12.1で一致を要求）: planning Target数、materialization semantic SHA-256、Entry fingerprint（semantic record・Entry本体・Entry集合の3つ）、materialized Target数と方式の内訳、
completed / total Target数、selected Entry数、Conflict / rejected / resource_conflict / warning数、termination、expandedStates、full Planner run数、Trace Replay（valid、draft数、対応不一致数）、
物理操作数・Plan steps・非物理Step・Σ stream前進・objective、Plan hash / Step semantic hash / 実行位置hash、verification semantic SHA-256（first / fresh、比較母集団の全logical run）。
どのrunをこの比較に使うか（比較母集団）と必要run数は §12.2 で事前に固定し、判定は §12.4 で行う。

### 9.5 runの種類

timing・rerun・responsiveness（ping）・memory・cancel・pilotは互いの計測が干渉するので別runにする（Phase 2-Aと同じ）。runの目的は計測前に測定計画のslotとして固定し（§12.2）、目的ごとにparityでの扱いを決める:
timing / rerunは必須比較run、responsiveness / memoryは完了した場合だけ比較する追加比較run、cancel / pilotは比較母集団から除外する。cancel試験の合否・応答性・memory・未完了runの件数は、
parityとは独立に評価・記録する（§12.6）。どのrunもsemanticは記録する（比較に使わないrunでも、記録は残す）。

### 9.6 Node値の扱い

Node D-1Cのfirst約39秒を、Browserの期待値・閾値・timeoutの根拠にしない。Phase 2-Aでは別アルゴリズムでBrowserがNodeより速かったが、その原因は計測されておらず、
Global Assignmentでも同じとは仮定しない。Browserの時間はBrowserで測った値だけを使う。

## 10. cancel / error / cleanup

状態遷移（harness、提案）:

```text
created ──ready──▶ ready ──run──▶ running
                                    ├──gab_result（採用）──────────────────────────────▶ settled(completed)
                                    ├──timeout──────────────────────────────────────────▶ settled(timeout)
                                    ├──gab_error / error / messageerror─────────────────▶ settled(worker_reported_error | worker_error)
                                    ├──pagehide / dispose────────────────────────────────▶ settled(page_left)
                                    └──cancel受付（同期。この後に gab_cancel をpost）──▶ cancelling
                                          cancelling ──gab_cancelled / gab_result（採用しない）/ gab_error──▶ settled(cancelled)
                                          cancelling ──cancelGraceMs超過─────────────────────────────────▶ settled(cancelled_terminated)
                                          cancelling ──error / messageerror──────────────────────────────▶ settled(worker_error)
                                          cancelling ──pagehide / dispose────────────────────────────────▶ settled(page_left)
settled(*) ──▶ terminated（全経路でsettle直後にterminate）。settled後のmessageは lateResponses（適用しない）
settled(*) へのcancel操作は何もしない（cancel() は false）
（renderer crash: harnessごと消える → 外部記録で page_lost）
```

- §7.8のC1〜C10がこの状態遷移の不変条件である。`cancelling` から `running` へ戻る遷移は無く、`cancelling` の間に届いた `gab_result` は採用しない
- settleはrequestごとにちょうど1回。settle後のmessageは適用しない（`lateResponses`）。cancelを受け付けたrequestから採用された結果は0件でなければならない（P-1のtestで確認する。§16.1）
- `cancelling` 中の native `error` / `messageerror` は `worker_error`（`cancelRequested: true` を記録）としてsettleし、cancel試験の評価では `cancel_failed`（理由 `worker_error_during_cancel`）として数える（§12.6）
- logical runの判定（§12.1）はfirst / freshのsettle結果だけから行い、`out_of_memory` を外部証拠なしに付けない
- cancel・timeout・errorのrunは、性能の集計（時間・memory）から除外し、件数と停止stageを別に数える
- 分類はすべて「未計測（unmeasured）」側であり、Production Plannerの成立・不成立、materializationの `shape_mismatch` と混同しない（設計 §9.6）
- renderer crash・tab破棄ではpage memory内の未保存recordが失われる（Planner Alternative Phase 3で、Browser paneの応答停止によりそのsessionの未保存recordが失われた記録がある）。
  そのため外部driverはlogical runごとに `exportJson()` を保存し、driverの無い環境ではoperatorがlogical runごとに「JSON保存」を行う手順を測定計画に入れる（自動保存のためのstorageは使わない。§7.12）

## 11. PC / スマートフォンの確認方法

### 11.1 対象環境

| 環境 | P-1（synthetic・基盤） | P-2（実Export） | 備考 |
| --- | --- | --- | --- |
| Windows + Chrome（stable、headed、専用profile） | **確認する**（bundle・Worker起動・protocol・異常系・cleanup。実Exportは使わない） | **必須**（timing / rerun / ping / memory / cancel。必須比較run（timing / rerun）は2 logical run以上を測定計画で固定。§12.2） | 外部CDP driverとOS memoryを使える。既存Browser記録と同じ系統 |
| Android + Chrome（実機） | しない | **端末を用意できれば実施**（timing / cancel / rerun。memoryはCDP経由で取れる範囲） | USB debugging（`adb`）が要る。端末のRAM・SoCを記録 |
| iPhone + Safari（実機） | しない | **端末とsecure contextの経路を用意できれば実施**（timing / cancel / rerun。memoryはMacのWeb Inspectorがある場合だけ） | HTTPSが要る（§11.2） |
| その他（Edge、Firefox、iPad等） | しない | 任意 | 実施した場合だけ記録 |

- **実施しなかった環境は「未確認」と記録し、検証済みとして扱わない**。PCで得た時間・memory・成否をスマートフォンの性能・成否の保証にしない
- どの端末を使えるかはP-2の開始時にプロジェクトオーナーが決める（本書では決めない）

### 11.2 serving・secure context

- benchmark build（`npx vite build --config vite.benchmark.config.ts`）を `vite preview --config vite.benchmark.config.ts` で配信する（dev serverではなくproduction build。既存記録と同じ）。
  memory runでは `BENCHMARK_CROSS_ORIGIN_ISOLATED=1` を付けてCOOP / COEPを有効にする
- Web Crypto（`crypto.subtle`）と `crossOriginIsolated` は **secure context** でしか使えない。`http://127.0.0.1` / `http://localhost` はsecure contextだが、LAN IP（`http://192.168.x.x`）はsecure contextではない
- PC: `http://127.0.0.1:<port>/GogmaArtianPlanner/benchmark-global-assignment.html`
- Android: `adb reverse tcp:<port> tcp:<port>` で端末の `http://localhost:<port>/…` からPCのpreviewへ接続する（secure contextになる）。CDPは `adb forward` でPCのdriverへ転送する
- iPhone: `adb reverse` 相当が無いので、HTTPS配信（端末に信頼させたローカル証明書）が要る。証明書の作成・端末への導入はオーナーの操作になる。外部のhosting・tunnel serviceへbenchmark buildや
  Exportを公開する方法は使わない（Export・計算結果を外部へ送らない）。経路を用意できなければiPhoneは未確認とする
- environment probeがsecure contextでない・Web Cryptoが無いと示した場合はrunを開始しない（`environment_unsupported`）。hash関数を別実装に差し替えて続行しない

### 11.3 計測手段

| 環境 | page内で取れるもの | 外部手段 |
| --- | --- | --- |
| Windows + Chrome | §9.1の全時間、heartbeat、ping、cancel、`measureUserAgentSpecificMemory`（isolated時）、main realm `performance.memory` | CDP driver（Worker targetの `Runtime.getHeapUsage`、lifecycle / crash検出、file input操作、console APIの呼出し、`exportJson()` の保存）、OSのrenderer process memory |
| Android + Chrome | 同上（`measureUserAgentSpecificMemory` の可否は記録） | `adb forward` 経由のCDP（同じdriverを使えるかはP-2で確認）、`adb shell dumpsys meminfo`（任意） |
| iPhone + Safari | 時間、heartbeat、ping、cancel（memory APIは無いと想定し、有無を記録） | MacのSafari Web Inspector（ある場合だけ）。無ければ外部memoryは未測定 |

外部driverは既存記録と同じく **commitせず、SHA-256を記録する**（計算logicを含めない）。driverがpageの操作（file選択・実行・保存）を行う場合も、計算はpageとWorkerだけが行う。

### 11.4 バックグラウンド・長時間実行

- 一般に、Browser・OSは非表示tabのtimerを間引き、tabを凍結・破棄することがあり、iOSではbackgroundへ移ったtabのJS実行が止まることがある（一般的な挙動であり、本Repositoryで観測した事実ではない）。
  Workerが非表示中に動き続けるかは環境に依存し、保証は無い
- 計測中は画面を表示したまま（自動lock・省電力をオフ、PCは `--disable-backgrounding-occluded-windows`）にする。pageはScreen Wake Lock API（`navigator.wakeLock`）を **任意で** 要求できるようにし、
  取得できたかを記録する（取得できなくても計算は続ける）
- `visibilitychange` / `freeze` / `resume` / `pagehide` / `pageshow` を時刻付きで記録し、run中に一度でも非表示・凍結になったrunは `environment_interrupted` として時間・応答性の集計から除外する
  （計算が完了していればsemanticは有効）
- 長時間の連続runは発熱・省電力制御で時間が変わり得る。run順・run間隔・開始時の充電状態（取得できる場合）を記録し、時間を1点ではなく分布として扱う
- スマートフォンのWorker heap上限は取得できない。memory不足はpage loss（tab再読込）として現れ得るので、P-2はスマートフォンでまず1回のlogical runを行い、完走・page lossのどちらかを記録してから
  繰り返す（このpilotの結果は記録し、集計に入れるかは測定計画で事前に決める）

### 11.5 記録する環境項目

OS・version、Browser・version（userAgent、UA-CHが取れればplatformVersion）、端末model（operator記録）、`hardwareConcurrency`、`deviceMemory`、`navigator.language` / locale、
`crossOriginIsolated`、`isSecureContext`、serving URL origin、memory APIの有無、Wake Lockの有無と取得結果、visibility / lifecycleの履歴、背景負荷（PCはCPU使用率の参考値）、計測日時。

## 12. Browser semantic parityの判定

### 12.1 一致すべき情報と、一致しなくてもよい情報

| 区分 | 項目 | D-1Cの値（事後比較用。実行入力にしない） |
| --- | --- | --- |
| **完全一致を要求** | planning Target数 | 43（first・freshとも） |
| | materialization semantic SHA-256 | `6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f` |
| | Entry fingerprint（semantic record・handoffのEntry本体・Entry集合・fresh側） | `fnv1a32:ed959cc4` |
| | materialized Target数 / 方式 | 43（射影起点21、形状制約22） |
| | verification semantic SHA-256（first / fresh、比較母集団の全logical run。§12.2） | `0a56da0f24206f1fcde76246b5ad47a6101d7a5fc9517f24c2bcdbc894833dd4` |
| | termination / expandedStates / completed / total | `completed` / 1,809 / 43 / 43 |
| | selected Entry / Conflict / rejected / resource_conflict / warning | 43 / 0 / 0 / 0 / 0 |
| | Trace Replay | valid、draft 1,809、対応不一致0 |
| | 物理操作数 = Plan steps = Σ stream前進 = objective、非物理Step | 1,766、0 |
| | Plan hash / Step semantic hash / 実行位置hash | `fnv1a32:903e4274` / `fnv1a32:8d28811e` / `fnv1a32:3cf477e7` |
| | full Planner run数 | 1 |
| | first / freshのverification semanticの一致、比較母集団のlogical run間の一致 | 一致 |
| **観測（一致を期待するが判定に使わない）** | yield回数、progress event数（同じ計算経路なら同じになると期待されるが、adapterのwrapperの有無で変わり得る） | — |
| **環境依存（一致を要求しない）** | 全ての時間、memory、heartbeat間隔、ping、cancel latency、Worker起動時間、userAgent・端末・locale、build provenance（HEAD）、Entry集合をserializeしたtextのSHA-256（provenanceにHEADを含むため。D-1Cでも正式計測1と2で異なった） | — |

semantic SHA-256の一致はsemantic record全体の一致を意味する（materialization semantic recordはReachTableの予測回数・memo hit・structural searchのnode数・診断を、verification semantic recordは
final input・Planner・Trace Replay・物理の各recordを含む）。したがって個別項目は、SHA-256が一致しなかったときの切り分けに使う。

logical runの判定（Browser内、§6.2のstage結果だけから）: 提案 `judgeBrowserLogicalRun(first, fresh, integrityIssues)`。順序はD-1Aの `judgeD1aRun()` と同じ
（integrity issue → firstの終了状態 → firstのverification outcome → freshの終了状態 → freshのPhase 0集合がfirstと同じ → freshのoutcome → first / freshのsemantic一致）で、
`differingSemanticFields()` を再利用する。違いはD-0C identityの照合を持たないこと（§6.2 5）と、結果のlabelを `browser_nonformal_conditions_met`（両Workerが全条件を満たし一致）とし、
`verified` / `nonformal_planner_verified` / `accepted` を名乗らないことである。integrity issue（Export identityの不一致、main threadの再hash不一致、Entry集合の検査不合格、build provenanceの不一致）が
1件でもあれば `invalid_run_integrity`。firstまたはfreshのrequestが `completed`（main threadが `gab_result` を採用）以外でsettleした場合は、§7.11の対応で `unmeasured(<side>, <reason>)` とし、
cancelを受け付けたrequest（`ignoredResultAfterCancel` を持つものを含む）は `unmeasured(<side>, cancelled)` である。`browser_nonformal_conditions_met` は、両Workerが `completed` でsettleし、
全条件を満たし、semanticが一致した場合だけに付く。

### 12.2 比較母集団（run目的・必要run数の事前固定）

semantic parityは、計測前に固定した **比較母集団** のrunだけで判定する。cancel試験・応答性・memory・未完了runの結果は、parityとは別に評価・記録する（§12.6）。

P-2の測定計画は、計測前に環境ごと（PC、端末ごとのAndroid / iPhone）のrun slotを固定する: slot ID、目的、実行順、cancel試験ならtriggerのstage、そして必須比較runの必要数。
runの目的とparityでの扱いは次のとおり。

| 目的 | 正常完了の意図 | parityでの扱い | 別評価（§12.6） |
| --- | --- | --- | --- |
| `timing` | あり | **必須比較run**（必要数に数える） | 時間 |
| `rerun` | あり | **必須比較run**（必要数に数える） | 再実行可能性 |
| `responsiveness`（ping） | あり | **追加比較run**: 両Workerが完了した場合だけ比較する | 応答性 |
| `memory` | あり | **追加比較run**: 同上 | memory |
| `cancel` | なし（正しく中断することが目的） | 比較母集団から除外 | cancel試験の合否 |
| `pilot` | 測定計画で定める | 比較母集団から除外 | 記録だけ |

規則:

- **必要run数**: 必須比較run（`timing` / `rerun`）の必要logical run数を、環境ごとに測定計画で固定する（1 logical run = first Worker + fresh Worker）。PC（Windows + Chrome）は2以上。
  スマートフォンは端末ごとの測定計画で決める。`parity_confirmed` を主張し得る環境の必要数は2以上とする（D-1Cの2 complete runsと同じく、Browser内のrun間決定性を確認するため）。
  必要数を1と計画した環境は、計画の時点で `parity_confirmed` を主張しない環境として扱う
- **必須比較slotはすべて完了して初めて必要数を満たす**。計画した必須比較slotのうち1つでも、firstかfreshが `completed` 以外でsettleした（cancel、timeout、worker error、page loss等）・
  実行されなかった・integrity issueがある場合は、必要数を満たさない。失敗・中断したslotを追加runで置き換えない、成功したrunだけを選んで必要数に数えない
- **計測後に変更しない**: 必要数を減らさない、runの目的を付け替えない（失敗した `timing` を `pilot` / `cancel` にしない）、比較母集団を足し引きしない。
  計画外のrun（計画のslotに対応しないrun）は記録を残すが比較母集団に入れない。必要数の不足を補うには、新しい測定計画（新しいcommit）で測り直す
- **追加比較run** は、両Workerが `completed` でsettleした場合だけ比較し、不一致があれば `parity_mismatch` の根拠にする。完了しなかった場合は比較母集団に入れず、その件数はparityと独立に
  記録する（§12.6）。追加比較runの未完了をparityの成立・不成立に読み替えない
- integrity issueのあるrunは比較母集団に入れず、成功runとして採用しない（必須比較slotなら「完了していない」）
- `environment_interrupted`（非表示・凍結。§11.4）のrunは、両Workerが `completed` でsettleしていればsemanticは比較に使う（時間・応答性の集計からだけ除外する）
- **計画の固定方法**: 測定計画はmeasurement HEADにcommitしたfile（P-2で作る）に置く。各Browser recordはbuild provenanceのcommitと、そのrunに割り当てたslot ID・目的を持つ。
  analyzerはrecordのcommitから計画を `git show <commit>:<計画file>` で読み直し、その計画のslot・目的・必要数だけを使う。計画fileを測定後に書き換えても、測定時commitの計画が使われる

### 12.3 Node reference

- **同じmeasurement HEADのNode値**: P-2で、Browserと同じHEADで既存のD-1A non-formal runner（`scripts/run-planner-global-assignment-d1a.mjs`、変更しない）を1回実行し、
  materialization semantic SHA-256、Entry fingerprint、first / freshのverification semantic SHA-256を得る（runnerの既存のCLI規約どおり、D-0Cの値は事後照合のためにだけ渡される）。
  これが「同じコードでのNode」との比較基準になる
- **D-1Cの正式記録**: 公開RESULT `docs/PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json` の `determinism` / `plannerIntegration` の値（§12.1の表）。analyzerはこのfileを読むだけで、hashを
  sourceにhard-codeしない
- D-1C formal runnerはP-1以降のHEADで計算コード監査により拒否されるので使わない（§5.1）

### 12.4 判定

判定は環境ごとに、3分類 `parity_confirmed` / `parity_mismatch` / `not_comparable` のどれか1つに決める。次の順に評価する。

1. **比較の前提**: Browser recordとD-1C公開RESULTの間で、Export identity（name / bytes / SHA-256）、CalculationContext、Engine version、Master data version、条件
   （`registeredD1cConditions()` の値）が一致すること。Node referenceがある場合は、Node referenceもそれらが一致し、かつ§12.1の要求項目がD-1C公開RESULTと一致すること。
   成り立たなければ `not_comparable`（理由: `export_identity_mismatch` / `calculation_context_mismatch` / `conditions_mismatch` / `reference_inconsistent` 等）。前提が違う入力どうしの差は
   不一致と呼ばない（Node referenceとD-1Cが食い違う場合は、Browserとは独立した重大な所見として別に記録する）
2. **比較母集団の確定**: §12.2の規則で、必須比較slotの結果と、完了した追加比較runを集める。integrity issueのあるrunを除く
3. **確定した不一致**: 比較母集団の完了run（必須比較・追加比較を問わない）のどれかで、§12.1の完全一致項目がD-1C公開RESULTまたは（ある場合は）Node referenceと異なる、または
   Browser内のrunどうしが異なる → `parity_mismatch`。異なるrun（slot ID・Worker）とfieldを記録する（`differingSemanticFields()` で最上位fieldを特定）。
   **必要run数に満たない場合でも、確定した不一致は隠さない**（4・5より優先する）
4. **Node referenceの欠落** → `not_comparable`（理由 `node_reference_missing`）
5. **必要run数の不足** → `not_comparable`（理由 `required_runs_incomplete`。各必須比較slotのsettle結果を併記。完了runが1件も無い場合も同じ理由で、件数0と記録する）。
   計画した必要数が2未満の環境は、全slotが完了しても `not_comparable`（理由 `planned_runs_below_minimum`。§12.2）
6. 以上のどれにも当たらない → `parity_confirmed`

`parity_confirmed` の条件をまとめると: 測定計画で事前固定した必須比較runが必要数そろい、各logical runのfirst / freshが `completed` でsettleし、各logical runが
`browser_nonformal_conditions_met` を満たし、比較母集団のBrowser run間でsemanticが一致し、Node referenceとD-1C公開RESULTの要求項目と一致し、比較母集団のintegrity issueが0件であること。

- `not_comparable` の理由は具体的に記録する（上の理由コードと、その根拠になったslot・値）。「一致」とも「不一致」とも言わない
- 不一致が出た場合は、(1) 環境（locale・engine）、(2) 入力（Export identity、CalculationContext）、(3) build（HEAD・未commit）の順に切り分ける。原因を推測で書かず、
  切り分けで確定できなければ「原因未特定」と記録する。Domainの計算規則・条件を変えて一致させない
- `parity_confirmed` は「この環境・このExport・この条件で、計画した必須比較runがNodeと同じ計算結果になった」ことだけを意味し、Production defaultの根拠・正式acceptance・
  性能の合格・cancelの合格を意味しない。環境をまたいだ1つの「Browser全体のparity」は作らず、環境ごとの結果を並べて記録する

### 12.5 判定する場所

Worker・stage moduleは期待値を受け取らず、比較もしない。比較はP-2の事後analyzer（Node script、提案名 `scripts/analyze-planner-global-assignment-browser.mjs`）だけが、
測定時commitの測定計画・Browserの「JSON保存」file・Node referenceのraw output・D-1C公開RESULTを読んで行う。analyzerの出力（parity、cancel試験、未完了の集計）をBrowser runへ戻さない
（設計 §11.1のpost-hoc evaluationと同じ境界）。

### 12.6 parityと独立に評価・記録するもの

- **未完了・終了経路の集計**: 環境・目的ごとに、firstとfreshのsettle結果（`completed` / `cancelled`（うち `ignoredResultAfterCancel`）/ `cancelled_terminated` / `timeout` / `worker_error` /
  `worker_reported_error` / `page_left` / `page_lost` / `out_of_memory` / `environment_unsupported`）と `environment_interrupted` の件数・slotを記録する。parityの判定と独立に記録し、
  parityの結果から逆算しない
- **cancel試験**（目的 `cancel` のslotごと。P-2の独立したacceptance項目）:

  | 判定 | 条件 |
  | --- | --- |
  | `cancel_passed` | cancel受付時にrequestが `running` だった、settleがちょうど1回、settle結果が `cancelled`（経路が `gab_cancelled` または捨てた `gab_result`）または `cancelled_terminated`、cancelしたrequestから採用された結果が0件、Workerがterminateされた、測定計画がその試験の後に置いた再実行slot（あれば）が `completed` でsettleした |
  | `cancel_failed` | 上のどれかが成り立たない（結果が採用された、settleが2回以上、grace超過後もterminateされない、`cancelling` 中の `worker_error`（`worker_error_during_cancel`）または `gab_error` による終了（`worker_reported_error_during_cancel`。結果の不採用は守られていても異常終了として扱う）、cancel後の再実行が完了しない等。理由を記録） |
  | `cancel_not_exercised` | cancelが試されなかった（triggerのstageに達する前にrequestがsettleした、cancel操作時にrequestが既にsettled等）。合格にも不合格にも数えない |

  内訳として、settleの経路（cooperative停止 `gab_cancelled` / 捨てた `gab_result` / `gab_error` / terminate）の件数と、cancel受付 → `gab_cancel_ack` / settle の時間をstage別に記録する。
  cancel試験の合否はparityの比較母集団にもparity判定にも影響しない
- **応答性・memory**: §9.2 / §9.3の値として別に記録する。responsiveness / memoryのrunが完了しなかったこと（page loss等）は、その評価項目の所見として記録し、parityへ読み替えない

## 13. Research isolationの維持方法

### 13.1 配置とbuildの分離

- Browser関係fileはすべて `src/benchmarks/globalAssignment/browser/` と repo直下の `benchmark-global-assignment.html` に置く（§7.1）。`src/{app,components,db,domain,services,stores,workers,pages,presentation,data}/**`
  と `src/*.{ts,tsx}` には一切追加しない。`src/pages/BenchmarkApp.tsx` / `src/benchmark.tsx` は変更しない
- 通常build（`vite.config.ts`、`index.html`、`dist/`）は変更しない。通常アプリのmoduleがbrowser folderをimportしない限りbundleされない
- benchmark build（`vite.benchmark.config.ts`）は `rollupOptions.input` を `{ benchmark: 'benchmark.html', globalAssignment: 'benchmark-global-assignment.html' }` にし、`BENCHMARK_CODE_PATHS` に新HTMLを加える。
  既存の `benchmark.html` のharnessは変わらない（Phase 2-A等の記録の手順を変えない）

### 13.2 test

- 既存の `src/benchmarks/globalAssignment/isolation.test.ts` は **変更しない**（Production scopeの禁止識別子、runtime module一覧の完全一致、import先の制限、oracle・file・時計の禁止）。
  P-2でanalyzer scriptを足す場合だけ、1件目のtestの「指定script」一覧へanalyzerを加える（runnerの一覧を広げる変更なので、そのPRで理由を書く）
- 新しい `src/benchmarks/globalAssignment/browser/browserIsolation.test.ts`（提案）で固定すること:
  1. Production scope（上と同じglob、除外patternなし）のどのfileも `globalAssignment/browser`、`gab_`、`global-assignment-browser`、`benchmark-global-assignment`、browser moduleの公開識別子を含まない
  2. browser moduleのimport先は `./`、`../`（Global Assignment runtime module）、`../../plannerGlobalOptimizationResearch`、`../../plannerGlobalBrowserEvidence`、`../../../domain/**`、
     Reactとbenchmark用UI（pageだけ）、`../../../app/theme` / `../../../index.css`（pageだけ）に限る（既存benchmark moduleからの `import type` は可）。`src/workers/**`（Production Worker・既存benchmark Worker）・
     `src/services/**`・`src/db/**` を直接importしない（`src/db/**` は §4.3の推移的依存としてだけbundleに入る）
  3. browser moduleは `indexedDB|Dexie|appDatabase|localStorage|sessionStorage|caches\.|serviceWorker|fetch\(` を含まない（Exportは `File` だけから読む）
  4. oracle・過去RESULT（`plannerGlobalOracle|ORACLE_1657|PLANNER_GLOBAL_[A-Z0-9_]*RESULT|\.json['"]`）、UUID、64桁hex、Target ID先頭8文字を含まない
  5. Worker entryのEngineは `new ProductionRngEngine()` だけで、Fake Engine・raw block cache・profilerをimportしない
  6. run requestの型に条件・期待hash・D-0C identityのfieldが無い（protocol testでも検査）
  7. 通常 `vite.config.ts` が `benchmark-global-assignment.html` を参照せず、COOP / COEPを持たない
  8. Production Worker protocol（`plannerWorkerContracts.ts`）・`PlannerWorkerClient`・`planner.worker.ts` のyieldが変わっていない（既存のPhase 2-A isolation testと同じ検査をこのfolderにも適用）
- stage module・judgement moduleはNode環境のVitestで実行する（DOM不要）。harness・runnerはfake Workerで、pageはjsdomで検査する（既存の `plannerGlobalBrowserBenchmark.test.ts` と同じ方式）

### 13.3 dist検査

P-1 / P-2のPR検証で、`npm run build` 後の `dist/` に `gab_`、`global-assignment-browser`、`globalAssignment`、`GLOBAL_ASSIGNMENT`、`runMaterializationSmoke`、`verifyPlannerCandidate`、
`benchmark-global-assignment` が含まれないことを確認し、結果をPR本文に記載する（Phase 2-Aと同じ確認。CIのtestはbuild成果物を前提にしないので、PRの検証commandとして行う）。

### 13.4 oracle isolation

設計 §11をそのまま適用する。Worker・stage module・pageはoracle manifest / verifier / RESULT JSON・D-0C / D-1Cの登録identityを読まない。analyzerだけが、Browser runの終了後に、測定計画・Node reference・D-1C公開RESULTとともに読む（§12.5）。

### 13.5 永続化しないことの確認

P-1の実Browser確認で、run前後の `indexedDB.databases()`（benchmark origin）、`localStorage.length`、`sessionStorage.length` が変わらないことを記録する（§4.3のDexie instance生成がDBを開かないことの確認を兼ねる）。

## 14. 未確認事項

| 項目 | 状態 | 確認する場所 |
| --- | --- | --- |
| Global AssignmentがBrowser Workerで完走するか | 未実行 | P-2（PC Chrome） |
| Browserでのsemantic parity（Node・D-1Cとの一致） | 未確認 | P-2 |
| Browserの時間（各Phase）、最大同期slice、cancel latency | 未計測。Nodeの値から推測しない | P-2 |
| Browser Worker heapの使用量と上限、OOMの起き方 | 未計測。Worker heap上限は取得できない可能性が高い | P-2（PCは外部CDP、スマートフォンは取れる範囲） |
| スマートフォンでの完走・時間・memory・バックグラウンドの影響 | 未確認（端末の用意が未定） | P-2（端末がある場合だけ） |
| Blob（`File`）のWorkerへのstructured cloneが各Browserで使えるか | 未確認 | P-1（PC Chrome）、P-2（各環境） |
| Dexie instance生成がWorker内でDBを開かないこと | Repositoryで未確認（Dexieの仕様理解に基づく想定） | P-1 |
| `localeCompare` を使うDomain順序の環境差 | 未確認（差が出るとは主張しない） | P-2（semantic不一致時の切り分け） |
| 他のExport・W0以外のwindow・2件目以降のstructural candidate | 本書の範囲外 | Phase E / 別の事前登録 |
| Safari / Firefoxでの挙動 | 未確認 | P-2（任意） |
| 性能の許容値 | 決めない | P-2の結果を見てProduction仕様として判断（§15） |

## 15. Production統合に向けた課題

本書はProduction統合を設計しない。以下は将来の別docs-only PRとプロジェクトオーナーの決定が要る事項の整理であり、**正式仕様との衝突は変更候補として記録するだけ** である。

| # | 項目 | 現行の正式仕様・実装 | 課題 | 決定が要る事項 |
| --- | --- | --- | --- | --- |
| 1 | 通常Plannerとの責務分担 | 通常PlannerはBuild Listに登録済みのRouteを並べる（REQUIREMENTS 19、PLANNER_SPEC 7）。明示選択の無い競合は自動で再検索しない（REQUIREMENTS 23） | Global Assignmentは全planning TargetのRouteを作り直す（既存EntryのRoute内容を使わない）。現行契約の「自動で再検索しない」と衝突する | **変更候補**: Global Assignmentを、通常Plannerとは別の「全体最適化の提案」（user起点の別操作）として定義するか。通常Planner・競合repair（Planner Alternative）はそのまま残すか |
| 2 | 既存Entryの扱い | Build Listは目標武器ごとに1件（DATA_MODEL 9.4.1）。置換は確認付き・Plan-breaking guard付きの1 transaction | Global AssignmentはPhase 0の集合決定にだけ既存valid Entryを使い、全Targetを生成Entryで置換する（`verify.ts` はProductionの置換authority `resolveBuildListEntryReplacement()` / `applyBuildListEntryReplacements()` / `validateBuildListEntryReplacements()` を使う）。Entryの無いTarget・stale Entryだけのtargetはplanning Targetにならない | 置換を全Targetまとめて採用するか、Target単位で選べるか。Entryの無いTargetをどう扱うか（現行は対象外） |
| 3 | 途中採用状態・改善優先 | `intermediateStateSelection` はhard constraint、`improvementPreference` はsoft（PLANNER_SPEC 7.5 / 7.6） | Global Assignmentは選択を持つEntryを `unsupported_input(checkpoint_selection)` でfail closedする（設計 §15.1）。置換すると選択・優先は引き継がれない | 選択を持つTargetを固定Routeとして残す設計が要るか、選択のあるBuild Listでは提供しないか |
| 4 | 生成Entryの方式 | 形状制約付きSearch `visitShapeConstrainedRouteCandidates()` は「Research only。Production moduleはimportしない」（SEARCH_SPEC 5.6.9） | D-1Cの43 Entryのうち22は形状制約付き方式で作られた。この方式なしでは同じ候補を得られない（D-0B / D-0A-2の経緯） | **変更候補**: SEARCH_SPEC 5.6.9のResearch専用規定を、Production APIとして正式化するか（Search contract・計算版数への影響を含む） |
| 5 | 生成Entry・Candidateのidentity | 生成Entry IDは `createDeterministicMaterializer()` の `build-list.constrained.*`。Candidate IDは `candidate.research.global-assignment.*`、search identityは `research.global-assignment.*`、algorithm token `global-assignment-d0a-materialization-v1`（Research値） | Research prefix・tokenはProduction IDではない（設計 §16）。Planner Alternativeの生成Entryと同じEntry ID空間を使う | Production用のalgorithm token・searchRunId規約、Entry ID衝突時の規則（同ID・異内容はfail closed）の確認 |
| 6 | 最適化結果のプレビュー | replan Preview（PLANNER_SPEC 16.8）・Planner Alternativeの「比較する」は永続化しないpreview | 結果（Route集合・物理操作数・Plan）は大きく、計算が長い | 永続化しないpreviewとして何を見せるか（操作数の比較、Route・sourceの変化、完成数）。完了率を推定して表示しない（REQUIREMENTS 19） |
| 7 | 明示採用 | replan adoption・repair saveは、preview開始時の状態を再検証して1 transactionで採用する | Global Assignmentの結果は、計算開始時のRNG状態・所持武器・Target・Build Listに依存する | 採用時の再検証token、Entry置換とDraft保存を同じtransactionで行うか、採用後に通常Plannerを走らせるか、実行中Planとの関係（Plan-breaking guard） |
| 8 | step bound | Production `maxPlanSteps` は既定1000、Build Listの初期表示は候補の必要操作数から求める（REQUIREMENTS 19、Issue #130） | 本Exportの結果は1,766 stepsで1000を超える。Research maxPlanSteps 20,000はProduction値ではない（設計 G12） | Global Assignment用のstep boundの定義（例: structural objectiveから導く案を含め、未決）。通常Plannerの規則と混同しない |
| 9 | Workerの実行制限 | Production Workerは計算中にcancel可能で、完了率を推定表示しない | Browserでの時間・memory・最大同期slice・cancel latencyは未計測（P-2）。Browserではheap上限を設定できない | 時間・memoryの許容値（P-2の実測後）、timeout、cancelの保証範囲（terminateで止める設計）、Production Worker protocolの形 |
| 10 | スマートフォン | PC・スマートフォンの双方で全主要機能を実用レベルで使える（REQUIREMENTS 3.2、UI_FLOW 3.1）。端末によって機能を減らさない | スマートフォンで完走しない・実用時間にならない場合、PC限定の機能にすることは現行仕様と衝突する | **変更候補**（必要になった場合のみ）: 端末差の扱い。P-2のスマートフォン結果が出るまで判断しない |
| 11 | 入力 | Productionの入力は永続状態から `createPlannerInput()` で作る | Researchは `globalResearchInputFromExport()`（Export → pure validation）。window W0 = `recommendedCandidateSearchDefaults`（350 / 500 / 1,500）で、userの保存済み `AppSettings.candidateSearchDefaults` は読まない | Production入力の作り方、windowをuser設定・別設定・固定のどれにするか |
| 12 | 前提条件 | 部分的なRNG状態でも依存するrouteだけを無効にする（AGENTS Partial RNG State） | Global AssignmentはBase Seed / Skill / Gogma Counterの未確定、Normal Counter未確定でowned sourceが無い場合、blind routeしか無い場合を `unsupported_input` で全体fail closedする | 一部Targetだけ最適化できない場合の扱い（全体を止めるか、そのTargetを固定にするか） |
| 13 | Research条件のProduction値化 | — | node budget 2,000、MRV lookahead 8、structural candidate 1、verification budget 1、gate・budget値はResearchの事前登録値 | Production boundの定義（意味・既定値・userへの見せ方）。Research値をそのまま流用しない |
| 14 | 検証の二重化 | Production Plan生成は内部でTrace Replayを行う | Researchのfresh process検証・formal gateはResearchの完全性の仕組み | Productionで何を残すか（fresh検証は通常不要と考えられるが未決） |
| 15 | Calculation schema / version | 同じPlannerInputに対するPlanner出力が変わる場合は `CURRENT_CALCULATION_APP_SCHEMA_VERSION` 境界を判断する（AGENTS.md）。ProductionPlanは生成方式を記録しない | Global Assignmentを別操作として足すだけなら通常Plannerの出力は変わらないが、生成Entry（形状制約方式のCandidate）という新しいbuild resultの意味、「生産計画を作成」の経路を置き換える場合のPlan出力の変化がある | その時点の仕様PRで、計算版数・build-result例外・DB / Export schemaへの影響を判断する |
| 16 | Dexieへの推移的依存 | Planner WorkerはDexieへ直接アクセスしない（AGENTS.md） | `plannerGlobalOptimizationResearch.ts` 経由でWorker bundleに `AppDatabase` のinstance生成が入る（§4.3） | Production化する場合は入力構築をResearch adapterから切り離し、Worker bundleに `src/db/**` を含めない構成にする |
| 17 | 端末間の決定性 | — | `localeCompare` を使う順序の環境差は未確認（§4.6） | P-2で差が出た場合、Production全体の決定性の問題として別途扱う |

## 16. 後続PR分割案

依存順序: **P-0（本書）→ P-1 → P-2 →（オーナー判断）→ Production統合の仕様docs PR → 実装PR群**。P-1とP-2はResearch（`src/benchmarks/**`・benchmark build・docs）だけを変更し、
Production fileを変更しない。どちらも1 PR、main向けDraft PR、mergeはオーナー判断。

### 16.1 P-1: Browser Worker実行基盤・synthetic検証

| 区分 | 内容 |
| --- | --- |
| 実装範囲 | §7.1のfile一式（protocol、stage module、Worker controller / entry、harness、runner、judgement、page、`main.tsx`）、`benchmark-global-assignment.html`、`vite.benchmark.config.ts`（2つ目のinputと `BENCHMARK_CODE_PATHS`）、`.gitignore` への `dist-benchmark/` 追加（任意。行わない場合はbuild成果物をcommitしないことを確認）、test、P-1記録docs（非formal） |
| 変更しないもの | Production file全て、既存のGlobal Assignment runtime module・runner script・登録module・D-1C記録 / RESULT、`isolation.test.ts`、`benchmark.html` / `BenchmarkApp.tsx`、Phase 2-A等の既存harness |
| 依存 | P-0（本書）のmerge |
| test | (1) protocol: guard、request検証（role / entrySetの整合、条件fieldが無いこと、重複・2回目の拒否）。(2) stage module: syntheticシーン（既存の `materializationScenario()` 等。小さな表から計算する決定的なtest用Engine、実データなし）で、D-1A子processと同じ直接呼出し列とsemantic・SHA-256が完全一致、dependency構築順序、検証用maxPlanSteps 1,000、条件が `registeredD1cConditions()` 由来（Vitestの注入時を除く）。(3) controller（fake postMessage、Engine・入力構築・条件を注入）: ready / accepted / progress / heartbeat / result、`gab_cancel` でflagを立ててackを返すこと、各stageのcancel点での `gab_cancelled`、`gab_result` 直前のflag確認（best effort）、1 requestにつき終了message 1件、`gab_error`、Export SHA不一致、fresh Worker policy。(4) harness（fake Worker）: 時間境界、§7.8のC1〜C10と§10の状態遷移（cancel受付で同期的に `cancelling`、`cancelling` から戻らない、settleちょうど1回、settle直後のterminate、grace超過のterminate、cancel受付後のwall timer停止、settled requestへのcancelが何もしない）、timeout、native `error` / `messageerror`（`cancelling` 中を含む）、`lateResponses`、dispose、pagehide、**下記の競合ケース1〜8**。(5) runner: first → terminate → fresh の順序、firstが `completed` 以外でsettleしたときEntry集合を取り出さずfreshを起動しない（C10）、logical run間で結果・message・Entry集合を持ち越さない、JSON exportの最小化。(6) judgement（logical run）: `judgeD1aRun()` と同じ優先順位、`browser_nonformal_conditions_met` / `invalid_run_integrity` / 各outcome、`completed` 以外のsettle（`ignoredResultAfterCancel` を含む）が `unmeasured` になり `browser_nonformal_conditions_met` にならない、`verified` を名乗らない（parityの3分類はP-2で実装・testする）。(7) `browserIsolation.test.ts`（§13.2）。(8) 既存testが全てそのまま通る |
| 競合test（fake Worker、message配送の順序をtestが制御する） | 1. Workerが `gab_result` を送信済み（fake Workerのqueueに入れたが未配送）の状態でcancelする → `cancelling` の後に配送された結果を採用せず `cancelled`（`ignoredResultAfterCancel`）。2. `cancelling` になった後に同じrequestIdの `gab_result` が届く → 採用しない。3. `gab_cancel_ack` より先に `gab_result` が届く → 結果を採用せず `cancelled` でsettle、後から届いたackは `lateResponses`。4. cancel後に `gab_cancelled` が届く → `cancelled`。5. cancel graceを超過する → `worker.terminate()` を呼び `cancelled_terminated`、その後に配送されたmessageは `lateResponses`。6. 既にsettled（`completed`）のrequestへcancelする → `cancel()` がfalse、`gab_cancel` をpostしない、採用済みの結果は変わらない。7. 前のrequestのmessage（結果・progress・Entry集合を含む）が次のrunの開始後に届く → 新しいrunへ適用されず `lateResponses`。8. cancel後に新しいlogical runを始める → 新しいrunが `completed` でsettleし、semanticがcancelの無いrunと一致し、前runのEntry集合を使わない。**全ケースで、cancelを受け付けたrequestから採用された結果が0件、各requestのsettleがちょうど1回**であることをassertする（採用件数をharnessの観測値として数え、testが読む） |
| 実Browser確認（非formal） | Windows + Chrome、benchmark build + preview（isolated / 非isolatedの両方）。bundleの読込、Worker ready、environment probe、`File` のstructured clone可否、request検証の拒否、合成入力（Repository内のdomain fixtureから作った実データを含まないExport。planning Targetが0件などでPhase 0までに型付きで止まるもの）での `unsupported_input`、不正JSON・Export検証失敗の `gab_error`、ping、cancel、terminate、timeout（小さい値）、連続再実行、`indexedDB.databases()` / storageの不変（§13.5）。**実Exportは使わない** |
| 受入条件 | lint / test / build / benchmark build成功、`git diff --check`・`npm run check:nul`、Production changed files `[]`、`dist/` に§13.3の識別子が無い、syntheticでstage moduleとNode直接呼出しのsemantic完全一致、**cancel後の結果不採用がmain threadのrequest lifecycleで保証されていること**（§7.8 C1〜C10、競合test 1〜8が全て通り、どのケースでもcancelしたrequestからの採用結果0件・settle 1回）、Worker側のcancel処理を安全保証の根拠にしていないこと、実Browser確認の各項目の記録。実Exportを使った性能測定は開始しない |

### 16.2 P-2: 実ExportのPC / スマートフォン測定

| 区分 | 内容 |
| --- | --- |
| 実装範囲 | 測定計画file（§12.2。計測前にcommit）、parity判定・cancel試験判定・未完了集計のpure関数（`globalAssignmentBrowserJudgement.ts`）とそのtest、analyzer script（`scripts/analyze-planner-global-assignment-browser.mjs`、提案）とそのtest、`isolation.test.ts` の指定script一覧へのanalyzer追加、測定記録docs、公開summary JSON（最小化）。P-1の基盤に不具合が見つかった場合の修正は、計測の **前** に別commitで行い、記録する |
| 依存 | P-1のmerge、オーナーによる端末・環境の決定（§11.1） |
| 測定計画（計測前にcommitし、結果を見て変えない） | measurement HEAD（clean）、benchmark build provenance、環境一覧、条件（`registeredD1cConditions()` の値。D-1Cと同じ。変更しない）、Browser envelope（`workerWallMs`、`cancelGraceMs`）、heartbeat間隔、**環境ごとのrun slot一覧（slot ID・目的 `timing` / `rerun` / `responsiveness` / `memory` / `cancel` / `pilot`・実行順・cancel試験のtrigger stageと後続の再実行slot）**、**環境ごとの必須比較runの必要logical run数**（PCは2以上。parity_confirmedを主張し得る環境は2以上。§12.2）、memoryの方法（環境別）、集計から除外する条件（`environment_interrupted` ほか）、logical runごとの記録保存手順（§10）。値の根拠をNode D-1Cの観測から推測しない（必要なら目的 `pilot` のslotを計画に入れて先に行い、それを記録する） |
| 実施 | (1) 同じHEADでNode reference（D-1A non-formal runner）を1回。(2) PC Windows + Chrome（必須）。(3) Android + Chrome、iPhone + Safari（端末と経路がある場合）。(4) analyzerで、環境ごとのparity判定、cancel試験の判定、未完了の集計を行う。計画外のrun・slotの置き換え・必要数の変更はしない |
| test | analyzer / judgement: 入力の検査（測定時commitの計画file・Browser JSON・Node raw・D-1C公開RESULTの読取り、欠落・改変の検出）、最小化検査（ID・path・per-Target配列が無い）、未実施環境が「未確認」になること、そして**parity判定の必須ケース**: 1. PCで必須比較2 logical runが正常完了しsemantic一致 → `parity_confirmed`。2. PCで必須比較のうち1 logical runだけ正常完了 → `not_comparable`（`required_runs_incomplete`）。3. 意図的なcancel runがあり、必須比較runは必要数を満たす → `parity_confirmed`（cancel runは母集団外）。4. 意図的なcancel runのみ（完了した比較対象runが無い）→ `not_comparable`。5. 正常完了runでsemantic不一致 → `parity_mismatch`（runとfieldを記録）。6. 必要run数に満たなくても、完了runで確定したsemantic不一致は `parity_mismatch` として隠さない。7. Node referenceが欠落（Browser runはD-1Cと一致）→ `not_comparable`（`node_reference_missing`）。8. Export identity不一致 → `not_comparable`（`export_identity_mismatch`）。9. integrity issueのあるrunを成功runとして採用しない（必須比較slotなら必要数に数えない）。10. cancel / timeout / worker error / page lossの件数がparity判定とは独立に記録される（parityの結果が変わってもこの集計は変わらない）。11. 実行後に比較母集団や必要run数を変更できない（計画外run・目的を付け替えたrecord・必要数を減らした計画fileは測定時commitの計画に従って扱われ、比較母集団に入らない）。加えて、cancel試験の判定（`cancel_passed` / `cancel_failed` / `cancel_not_exercised`、§12.6）と、cancel試験の結果がparityに影響しないこと |
| 受入条件 | 測定計画どおりに実施した環境ごとの記録（実施できなかった環境は未確認として理由を記録）、環境ごとのparity判定（`parity_confirmed` / `parity_mismatch` / `not_comparable` のいずれかと、その根拠・理由コード）、**parityとは独立した** cancel試験の判定と未完了runの集計、§9の各指標の記録、Production changed files `[]`、正式D-1Cの計測条件・過去のRESULTを変更していないこと、oracle・過去RESULTを実行入力にしていないこと。**性能の許容値・Production可否の判定は行わない**（オーナーが結果を見て判断する。§15 #9 / #10） |

### 16.3 P-2の後（本書の範囲外）

- P-2の結果で必要になった場合: Browser向けの改善（同期区間の分割、memoryの削減）。Production code（例: Trace Replayのyield）に触れる変更は、Production変更として別PRで仕様と合わせて扱う
- Production統合の仕様docs PR（§15の決定事項。REQUIREMENTS 19 / 23、SEARCH_SPEC 5.6.9、DATA_MODEL、UI_FLOW、計算版数の判断）
- Phase E（操作数の改善）は設計 §14のまま独立して進められる。P系列の結果をPhase Eの成否に使わない

## 17. 本PRの検証と既存文書の変更

- 変更file: `docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md`（新規、本書）、`docs/PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md`（§16の末尾に本書への参照を1段落追加）
- 設計 §16への追加の理由: 設計 §16はProduction統合に必要な事項として「Search規模 / node budgetの正式なbound定義とBrowser Worker測定」を挙げ、§14のPhase Eにも「Browser Worker測定」がある。
  本書のP系列（D-1Cの候補を同じ条件でBrowser実行するProduction準備）とPhase E（操作数の改善）を混同しないよう、§16から本書を参照させる。設計の意味・Phase分割・acceptanceは変更していない
- 正式仕様（REQUIREMENTS / PLANNER_SPEC / SEARCH_SPEC / DATA_MODEL / UI_FLOW）・`AGENTS.md`・実装・test・既存のResearch記録 / RESULTは変更していない
- 確認したこと: 本書で **確認済み** とした関数・型・定数・file・行の存在（基準main `53c133b`）、`src/benchmarks/globalAssignment/` ほかの計算moduleにNode APIが無いこと（§4.2）、
  Production module（`src/domain` / `services` / `workers` / `pages` / `components` / `db` / `stores` / `app` / `presentation` / `data`）からGlobal Assignment moduleへの依存が無いこと
  （既存 `isolation.test.ts` の検査対象）、通常build（`vite.config.ts`、`index.html`）とbenchmark build（`vite.benchmark.config.ts`、`benchmark.html`、`dist-benchmark/`）の分離、
  D-1C記録・公開RESULT・設計 §9.16 / §13.2 / §14 / §16との数値・用語の整合
- 実行したcommandと結果はPR本文に記載する（`git diff --check`、`npm run check:nul`）。docs-onlyのため挙動変化は無い。Browser実行・Search実行・formal run・RESULT生成は行っていない
- PR #256のRequired fix 2件（§18）は本書だけを変更した。設計（`PLANNER_GLOBAL_ASSIGNMENT_DESIGN.md`）との整合を確認し、設計側の変更は要らなかった
  （設計 §12のcancel記述はcooperative cancelのseamについてであり、Browser harnessのrequest lifecycleとは衝突しない。parityの比較母集団はP系列だけの規則で、設計 §13.2の正式acceptanceを変えない）

## 18. レビュー対応（PR #256、初版 `bb35546` に対する修正）

| 区分 | 指摘 | 対応 |
| --- | --- | --- |
| Required fix 1 | cancel後に `gab_result` を送らないことをWorkerのcancel flagで保証していたが、同期区間中のWorkerは `gab_cancel` をdispatchできず、main threadのcancel受付後に `gab_result` が送られる（または既に送信済みで未着である）ことは防げない | 安全保証をmain threadのrequest lifecycleへ移した（§7.8）。cancel受付で同期的に `cancelling` にし（C1）、以降の `gab_result` はrequestIdが一致しても採用しない（C2）、`cancelling` から戻らない（C3）、終了message 1件で `cancelled` / grace超過で `cancelled_terminated`（C4 / C5）、settleちょうど1回（C6）、settle後は `lateResponses`（C7）、settled requestへのcancelは何もしない（C8）、新しいrunへ持ち越さない（C9 / C10）。Workerのflag・送信抑止はbest effortと明記した。cancel受付の前後の境界、記録（`ignoredResultAfterCancel`）、結果を捨てたrunを `browser_nonformal_conditions_met` にしないことを定めた。§7.3 / §7.9 / §7.10 / §7.11 / §9.3 / §10 / §12.1を整合させ、P-1に競合test 1〜8と受入条件を追加した（§16.1）。Phase 2-A harnessがcancel後の結果を採用する挙動は引き継がないことを§3.2に書いた |
| Required fix 2 | `parity_confirmed` が「logical runがすべて `browser_nonformal_conditions_met`」を要求しており、意図的なcancel runがあるだけでparityが成立しなかった | semantic parityを、計測前に固定した比較母集団（必須比較run `timing` / `rerun`、完了した追加比較run `responsiveness` / `memory`）だけで判定し、`cancel` / `pilot` を母集団から除外した（§12.2）。必要logical run数を環境ごとに事前固定し（PCは2以上）、必須比較slotは全て完了して初めて必要数を満たす、失敗slotの置き換え・成功runだけの抽出・計測後の必要数変更や目的の付け替えを禁止し、測定時commitの計画だけを使う方法を定めた。判定順（前提 → 母集団 → 確定した不一致 → Node reference欠落 → 必要数不足 → confirmed）と3分類の条件・理由コードを書き直した（§12.4）。cancel試験の判定（`cancel_passed` / `cancel_failed` / `cancel_not_exercised`）と未完了runの集計をparityと独立に定めた（§12.6）。§9.4 / §9.5 / §11.1 / §12.5を整合させ、P-2の測定計画・テスト（必須ケース1〜11）・受入条件を更新した（§16.2） |
| Optional（今回変更しない） | `plannerGlobalOptimizationResearch.ts` を介したDexie / `AppDatabase` への推移的依存 | 依頼どおり変更しない。§4.3の注意書き、§13.5のP-1確認、§14の未確認事項、§15 #16は維持した |
