# 作成リスト全体最適化 Production Browser計測基盤と計測記録（Issue #260 PR-5A / PR-5B）

Refs #260。**benchmark専用**。本書は、作成リスト全体最適化（[PLANNER_SPEC.md](PLANNER_SPEC.md) 17章）の探索範囲・探索上限の
Production定数（17.13、17.19のU2）を決めるために、Production計算をPC Browserで計測する基盤と、その計測の記録である。

- PR-5A: 計測基盤、機能確認計画（[MECHANICS_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md)）とその結果、
  PR-5Bの測定計画案（[MEASUREMENT_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md)）
- PR-5B: 共通キャンセルゲート（判定規則）の追加、Owner承認済みの計画の登録（measurement HEAD `e0c176b`）、実Exportの正式計測（series `pr5b-r1`、§6）。
  **探索上限の採用セットは計測結果をOwnerが確認して決める**。それまで `PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS = null` のままである
- 実Export（`gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`）はローカルの同じファイルを
  使った（bytes・SHA-256を計測前に照合）。Repositoryへ置かず、外部へ送っていない

## 1. 何を計測するか（Production計算をそのまま）

```text
page（main thread）                                計測Worker（benchmark entry）
  Export / synthetic → 入力の準備                     attachBuildListOptimizationBenchmarkWorker()
    prepareExportRootForImport()                       ├ 1通目: blo_benchmark_bounds（boundsだけ）
    validateExportRootForFullReplacement()             └ 以降: Production controller
    createPlannerInput()（通常のApplicationと同じ）          createBuildListOptimizationCalculation(bounds)
  Production Client（createBuildListOptimizationWorkerClient）      runBuildListOptimization()
    blo_run（requestIdとPlannerInputだけ）  ─────────▶      ProductionRngEngine / Production ID factory / Clock
    blo_progress / blo_result / blo_error   ◀─────────
    構造検査 buildListOptimizationResultIssues()
```

- 計算はPR-4のProduction Client・Production controller・Production adapter・Production依存で行う。benchmark専用なのは、boundsを
  設定messageで受け取る計測Worker entry（PR-4で用意済み）と、その周りの計測だけである。`blo_run` にboundsを足さない
- 入力はProductionと同じ意味を持つ。Exportを、Importと同じ移行・検証を通したうえで、Applicationと同じ `createPlannerInput()`
  （`createBuildListCalculationContext()`、`conflictResolutions = []`）でPlannerInputにする。DBは開かない。実行中Planがあれば
  計算せず（Applicationの `running_plan_exists` と同じ位置）、RngStateが無ければfail closedする。Entryの選択・Counter・RNGを変更しない。
  Researchの入力構築（`globalResearchInputFromExport()`）は使わない
- Worker objectの薄いwrapperが、Worker生成・設定message・requestのserialize・各progress・結果messageの受信・Clientの処理の
  時刻だけを記録し、messageはそのまま渡す（synthetic のlifecycle確認で故意に故障を入れる場合を除く）
- キャンセルはClientの `cancel()` を使う（cancel triggerの段階に入ってから指定msの後）

## 2. module（`src/benchmarks/buildListOptimization/`）

| module | 責務 |
| --- | --- |
| `buildListOptimizationBenchmarkProtocol.ts` | raw recordの型・slot指定・検証（`bloRunRecordIssues()`、`bloSlotSpecIssues()`）。recordは件数・分類・時間・memory・fingerprintだけで、ID・Seed・Counter・path・UUIDを持たない |
| `buildListOptimizationBenchmarkInput.ts` | Export → PlannerInput（上記のProduction経路） |
| `buildListOptimizationBenchmarkSynthetic.ts` | 機能確認用のsynthetic Export（`sanity-3` fixture）とsynthetic探索上限（PR-4のtest値とその変形。Productionの候補ではない） |
| `buildListOptimizationBenchmarkSemantic.ts` | 結果のsemantic射影と成分別SHA-256 fingerprint（Plan ID・Step ID・予約OwnedWeapon ID・時刻を除く、PLANNER_SPEC 17.6） |
| `buildListOptimizationBenchmarkRunner.ts` | 1 slotのrun（Client、計測Worker、cancel trigger、固定点memory、long task、lifecycle、storageの件数） |
| `buildListOptimizationBenchmarkBrowserPorts.ts` | Browserの読取り（`performance.memory`、`measureUserAgentSpecificMemory()`、`PerformanceObserver('longtask')`、storageの件数） |
| `BuildListOptimizationBenchmarkPage.tsx` / `main.tsx` | 計測page。driver用のconsole API `globalThis.buildListOptimizationBenchmark` |
| `buildListOptimizationBenchmarkPlan.ts` | 計画blockの抽出・検証・slotへの結び付け（post-hoc。page / runnerはimportしない） |
| `buildListOptimizationBenchmarkAnalysis.ts` | 公開RESULTの導出と再検証（post-hoc） |
| `buildListOptimizationBenchmarkDriverControl.ts` | driverのslot制御（page再利用の条件、異常終了後のpage交換、`not_run`）とBrowser実行形態の判定。analyzerも同じ規則でdriver記録を読む（post-hoc） |

script:

| script | 役割 |
| --- | --- |
| `scripts/drive-build-list-optimization-browser.mjs` | CDP driver。計画をmeasurement HEADから読んで検証し、計画の `browserMode` と異なる起動（headed / headless）を拒否したうえで、専用profileのChromeで計画順にslotを実行し、slotごとにrecordを保存する。CDPでWorker targetのattach / detach（全slot）とWorker heap（memory slot）、OSのrenderer memory（memory slot、Windows）、crash（OOMの注記）を記録する。保存したrecordで終わらなかったslot（期限超過・page loss・settle不明のerror）の後はpageを閉じて開き直し、そのslotを再実行しない（driver記録 revision 2の `pageRestarts`）。期限（30分）を短くする `--slot-deadline-ms` はmechanicsだけ。実Exportの計測は `registered` かつ `owner_approved` の計画でしか始めない |
| `scripts/run-build-list-optimization-node-reference.mjs` | 同じHEADのNode reference（同じ入力準備・同じProduction adapterと依存・同じfingerprint）。`--preflight-only` は計算せず入力の準備だけを記録する |
| `scripts/analyze-build-list-optimization-browser.mjs` | analyzer。計画をmeasurement HEADから `git show` で読み、解析時のcodeがmeasurement HEADと異なれば解析しない。`--public` は排他的に書き、`--check` は同じrawから再導出して比較する |

## 3. 記録と判定の分離

- 4軸（semantic parity、計算成立・探索上限、性能とmemory、cancel / lifecycle）を分けて導出し、どれも他を読まない
- 計画が `proposed`（Owner承認待ち）なら観測だけを導出し、判定はすべて `not_yet_registered` とする。`registered` かつ `owner_approved` の
  計画だけを基準で判定し、基準は探索上限セットごとに判定する
- 共通ゲート（PR-5B）: 基準は `application` で適用方法を明示する。`common_gate` の基準（キャンセル試験。baselineだけで実施）は1回だけ判定し、
  その結果をすべてのセットの判定に含める。RESULTの `commonGate` に適用先・証拠のセット・各基準の結果・判定を、`verdicts.allCriteriaPerBoundsSet` に
  セットごとの全基準の判定を出す。共通ゲートが失敗・未測定ならどのセットも全基準合格にならない（[MEASUREMENT_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md) §3）
- record・driver記録・Node referenceが別のHEAD・未commitのcodeで作られていれば、analyzerは何も導出しない
- 欠けたslot・完了しなかったrun・取得できなかった値を成功と数えない（`missingSlots`、`incomplete`、`not_comparable`、`unmeasured`）
- 計画外のrecord（`planned: false`、計画に無いslot、目的・入力・探索上限・option・origin・Browserの不一致、同じslotの2件目）は除外し、理由を記録する
- Browserの実行形態: 計画が `headed` / `headless` を定める環境では、記録自身のuser agent（headlessは `HeadlessChrome`）とdriver記録の起動形態の両方が
  一致する記録だけを結び付ける（`browser_mode_mismatch`、driver記録が無ければ `browser_mode_unverified`）。mechanicsの計画は `either`
- driverの終了経路: driverが保存しなかったslotの記録（`driver_outcome_not_saved`）、異常終了の後に交換されなかったpageの記録（`page_not_replaced`）、
  driverが保存したraw file以外から読んだ記録（`driver_source_mismatch`）は結び付けない。異常終了したslotは欠けたslotとして扱う
- semantic fingerprintはStepの実行効果（`executionEffects`）を含む。予約OwnedWeapon IDだけを登録順の記号へ置き換え、入力由来の武器IDと
  Target / Entry IDはそのまま比べる（[MEASUREMENT_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md) §7）
- storageは件数（IndexedDBのdatabase数、localStorage / sessionStorageのキー数、Cache Storageのcache数、Service Workerの登録数）だけを比べる。
  同じ件数のままの内容変更は検出しない。取得できない件数は不変と推測しない（`storage_counts_unchanged` / `storageCountsChanged`）
- 測定できない項目: Production Workerの最大同期区間（Production Workerは計算中にevent loopへ戻らないので計算全体が1つのtaskである。
  Workerを変更して測ることはしない）。UIへの影響はmain threadのlong taskで測る

## 4. 実行方法

```bash
npx vite build --config vite.benchmark.config.ts
```

```bash
npx vite preview --config vite.benchmark.config.ts --port 4181 --strictPort --host 127.0.0.1
```

```bash
BENCHMARK_CROSS_ORIGIN_ISOLATED=1 npx vite preview --config vite.benchmark.config.ts --port 4182 --strictPort --host 127.0.0.1
```

計測page: `http://127.0.0.1:4181/GogmaArtianPlanner/benchmark-build-list-optimization.html`（手動runはsynthetic入力・synthetic探索上限だけを選べる計画外run）。
driver・Node reference・analyzerのcommandは各計画書の手順を参照する。build・preview・driverはclean checkoutのmeasurement HEADで行う。
`dist-benchmark/`、`.local/`（rawの保存先）はcommitしない。

## 5. PR-5Aの機能確認

### 5.0 r2（レビュー修正後のcode、現在の記録）

**結果: `mechanics: passed`（10 / 10 slotが期待どおり）**。公開RESULTは
[BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_RESULT_R2.json](BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_RESULT_R2.json)
（51,887 bytes、SHA-256 `15aa053271eaf414b3813cbdc7747d0b8a1239584226728c1d3be88e10d951e3`）。同じrawからの再導出（`--check`）は一致した。
syntheticの機能確認であり、性能・memoryの合否やProduction定数の根拠ではない。

| 項目 | 値 |
| --- | --- |
| measurement HEAD | `87df1b4d4d28329025b4509b10ef38b352cd7ddc`（clean。benchmark buildのprovenanceも同じcommit、`uncommittedBenchmarkCode: false`） |
| 計画 | `docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md`（series `pr5a-mech-r2`、`browserMode: either`、そのHEADでSHA-256 `4136bde4…`。`--validate-plan` ok。測定計画案も同じHEADで ok） |
| 環境 | r1と同じPC、Google Chrome 154.0.8037.98 **headless**（driver記録 revision 2の `launcher.mode: headless`、各recordのuser agentも `HeadlessChrome`）。各slot前のCPU負荷7〜28% |
| driver | `scripts/drive-build-list-optimization-browser.mjs`（SHA-256 `57c86aea…`）。raw・driver記録・Node referenceは `.local/pr5a-mech-r2/`（git-ignored） |
| 正常系のpage | 非isolated sessionの9 slotはpage #1を再利用、isolated sessionのmemory slotはpage #2。page再生成0件（正常終了時は従来どおりの実行方式） |
| semantic | `synthetic.open`: Browser 2 run + Node referenceが同一（`e5a5fd8c…`）。`synthetic.wide-window`: Browser 2 run + Nodeが同一（`ce4dee4f…`）。r1の値（`8b6ddbf6…` / `4a884d01…`）と異なるのは、fingerprintにStepの実行効果を加えたためである |
| 結果分類・lifecycle | r1と同じ（optimized、unsupported、search_bound_reached、cancelled ×2、`worker_error` / `invalid_result` の失敗）。storageの件数は両sessionで変化なし |
| キャンセル | `cancelled` までの時間 0 / 0.1 ms、結果の採用なし、再実行は完了しsemanticも一致。キャンセル → Worker targetのdetach（CDP）は777 ms / 473 ms |
| 時間（参考） | request → 結果: `synthetic.open` 67 / 60 ms、`synthetic.wide-window` 790 / 795 ms。main threadのlong task 0件 |
| memory（参考） | CDP Worker heap used max sampled 14,375,284 bytes（2 sample）、renderer private max sampled 74,694,656 bytes、main thread heapの結果保持 442,074 bytes、解放後のWorker bytes 0。未測定項目なし |

**driverの期限超過（実Chromeでの確認、計画外）**: 同じHEAD・同じ計画で、mechanicsだけが使える `--slot-deadline-ms` を短くした確認runを2回
行った（`.local/pr5a-mech-r2/deadline-check*`、RESULTには使わない）。

- 期限1,000 ms: 各runは結果の後にpageが1秒の遅着message待ちをするので、全10 slotが `driver_deadline` になった。各slotの後に
  そのpageを閉じて新しいpageを開き直し（page #1〜#12。各sessionの終わりのstorage読取り用を含む）、どのslotも再実行されず、rawは1件も保存されなかった
- 期限2,000 ms: 非isolatedの9 slotはpage #1で保存され、memory slotだけが `driver_deadline` になってpage #2を閉じ、page #3を開き直した
  （`pageRestarts` に記録）。このrawをanalyzerにかけると `mechanics: failed`、`missingSlots: ["mech.memory"]` となり、期限超過したslotを
  成功とも後続の結果とも扱わなかった
- 期限超過をpage lossや `search_bound_reached` とは記録せず、OOMとも判定していない

### 5.1 r1（修正前のcode、`a5858ad`）

PR #267のレビュー修正の前のcodeで測った最初の記録である。修正（driverのpage隔離、driver記録revision 2、`browserMode`、
`executionEffects` のsemantic比較、storage件数の名称）でcodeが変わったので、このRESULTは現在のcodeでは再導出できない（analyzerは
measurement HEADと異なるcodeで解析しない）。`a5858ad` をcheckoutすれば同じrawから再導出できる。書き換えずに残す。

**結果: `mechanics: passed`（10 / 10 slotが期待どおり）**。公開RESULTは
[BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_RESULT.json](BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_RESULT.json)
（50,246 bytes、SHA-256 `aebbac41a7ea2b7e11c6e2d68fabc6f5071315bc46a854e238226ff903ee64c5`）。同じrawからの再導出（`--check`）は一致した。
syntheticの機能確認であり、性能・memoryの合否やProduction定数の根拠ではない。

| 項目 | 値 |
| --- | --- |
| measurement HEAD | `a5858ad7ff6a6d00a4db9000198107990a156717`（clean。benchmark buildのprovenanceも同じcommit、`uncommittedBenchmarkCode: false`） |
| 計画 | `docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md`（そのHEAD、SHA-256 `372a66b1…`。`--validate-plan` ok。測定計画案も同じHEADで `--validate-plan` ok） |
| 環境 | Windows 11 Pro 10.0.26200 x64、AMD Ryzen 7 9700X（16 logical CPU）、31.1 GiB、Google Chrome 154.0.8037.98 **headless**、専用の一時profile。各slot前のCPU負荷79〜94%（動画エンコード等が並行していた） |
| driver | `scripts/drive-build-list-optimization-browser.mjs`（SHA-256 `0cfac049…`）、raw・driver記録・Node referenceは `.local/pr5a-mech/`（git-ignored） |
| binding | 10 / 10 slotを計画順に記録、計画外0、欠落0 |
| semantic | `synthetic.open`: Browser 2 run + Node referenceが同一（`8b6ddbf6…`）。`synthetic.wide-window`: Browser 2 run（非isolatedの再実行とisolatedのmemory slot）+ Nodeが同一（`4a884d01…`） |
| 結果分類 | optimized（7操作、3 / 3 Target）、unsupported（`invalid_planner_input`）、search_bound_reached（`structural_search_node_budget`）、cancelled ×2、failed（`worker_error`、`invalid_result`） |
| キャンセル | `input_check` 直後・`reach_table` 中（0.33 s）とも、`cancelled` までの時間 0 / 0.1 ms、結果の採用なし、settle後のmessage 0、再実行は完了しsemanticも一致。キャンセル → Worker targetのdetach（CDP）は1,151 ms / 816 ms |
| lifecycle | Workerの `error` eventは `worker_error`、壊した結果は `invalid_result` の失敗になり、どちらも結果として扱われない。storage（IndexedDB / localStorage / sessionStorage / Cache / Service Worker）は両sessionで変化なし、page loss・中断なし |
| 時間（参考） | request → 結果: `synthetic.open` 97 / 85 ms、`synthetic.wide-window` 1,246 / 1,199 ms（後者はmemory slot。Worker内の `reach_table` 1,099 ms）。入力準備 0.6〜2.8 ms、Clientの処理 ≤ 1.8 ms、main threadのlong task 0件 |
| memory（参考、memory slot） | CDP Worker heap used max sampled 7,280,040 bytes（runが1.2 sのため2 sample）、renderer private max sampled 74,702,848 bytes（96 sample）、main thread heapの結果保持 587,110 bytes、`measureUserAgentSpecificMemory()` は4固定点とも取得でき、解放後のWorker bytesは0。未測定項目なし |

観測と注意:

- キャンセルからWorker targetのdetachまで0.8〜1.2 sかかった（CDPの観測で、高いCPU負荷のheadless環境）。画面上のキャンセルは同期的に完了しており、
  これはWorkerの資源を返すまでの時間である。測定計画案の基準案はこの観測を踏まえて ≤ 2 sとした（[MEASUREMENT_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md) §9の3）
- memory slotは `measureUserAgentSpecificMemory()` の4固定点（各読取りがGCを待つ）とGC待ちのため、run自体が1.2 sでも約100 sかかった。
  実Exportのmemory slotも同程度の付加時間がかかる
- Production Workerは計算中にevent loopへ戻らないので、in-processのtestではキャンセルのtimerが結果より後になる。testでは即時実行にし、
  実Workerでの非同期キャンセルを本機能確認で確かめた
- headlessで実行した。PR-5Bの正式計測は測定計画案どおりheadedで行う

自動テスト（r2時点）: `src/benchmarks/buildListOptimization/` の9 file（protocol、入力、semantic、runner、計画、解析、driver制御、page、isolation）、
既存isolation test 2件の更新（PR-4のWorker isolation、Research P-1のbenchmark config固定）。

## 6. PR-5Bの正式計測（series `pr5b-r1`）

### 6.0 結論

**全基準を満たした探索上限セットは0件である。Production定数は確定しない（`PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS = null` のまま）。**

| セット | 判定（全基準） | 理由 |
| --- | --- | --- |
| `w0-research`（baseline） | **判定不能**（`not_comparable`） | 共通キャンセルゲートの1基準（キャンセル → Worker detach）が未測定。それ以外の全基準（semantic・計算成立・performance・memory・他のcancel / lifecycle）は合格 |
| `w0-candidates-3` | **判定不能**（`not_comparable`） | 同上。代表ケースの結果・時間・memoryは `w0-research` と同じ |
| `w-half` | **不合格**（`failed`） | 計算成立: 2 runとも `not_found`（`no_structural_candidate` / `target_without_option`）。共通ゲートも未測定 |
| `w-wide` | **不合格**（`failed`） | performance: request → 結果 112,099 ms（基準 median ≤ 40,000 ms・各run ≤ 60,000 ms）。共通ゲートも未測定 |

- 未測定の原因（§6.5）: driverはキャンセルのslotをキャンセルの約1.0 s後（結果の遅着message待ち1 s）に締め、その時点のWorker targetを記録する。実Exportの計算中に
  キャンセルしたWorkerのdetachはその後に起きたので、5試験とも `detachedAtEpochMs = null` となり、≤ 2,000 msを判定できなかった。取得できない値を
  0や合格に置き換えず、計画どおり判定不能とした（共通ゲートなので全セットが判定不能以下になる）
- 計画外の診断（正式記録ではない、§6.5）では、同じHEADのbuild・実Export・`w0-research` でキャンセル → detachが3試験とも **約2,015 ms** だった。
  観測窓を延ばして測り直しても、登録基準 ≤ 2,000 msは約15 ms超過で不合格になる見込みである。採用の前にOwnerの判断が要る（§7）

### 6.1 計測の同一性

| 項目 | 値 |
| --- | --- |
| 判定規則のcommit | `c501a85ef8c7b02d8bf852a3337d2a0f1fb2014f`（共通キャンセルゲート。計画の `baseCommit`） |
| measurement HEAD | `e0c176bcd49adc0035408d94e13339766b02000b`（計画の登録commit。clean。benchmark buildのprovenanceも同じcommit、`uncommittedBenchmarkCode: false`） |
| 計画 | `docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md`（series `pr5b-r1`、`registered` / `owner_approved`、approvedBy Owner、2026-10-15。そのHEADでSHA-256 `81408be0…62f7`、`--validate-plan` ok） |
| 環境 | Windows 11 Pro 10.0.26200 x64、AMD Ryzen 7 9700X（16 logical CPU）、31.1 GiB、Google Chrome 154.0.8037.98 **headed**（driver記録 `launcher.mode: headed`、全recordのuser agentもheaded）、計測専用の新しいprofile |
| CPU負荷（各slot前） | 5〜29%（driverの瞬時値）。計測開始前に、ゲームと動画エンコードが動いていないことを確認した（エンコードソフトのGUIは常駐していたが処理は無かった） |
| driver | `scripts/drive-build-list-optimization-browser.mjs`（SHA-256 `57c86aea…`、PR-5A r2と同じ）。raw・driver記録・Node referenceは `.local/pr5b/`（git-ignored） |
| 公開RESULT | [BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_RESULT.json](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_RESULT.json)（121,433 bytes、SHA-256 `1e93438f7aba644d2389ce189b318356223a4d4d188f7b11fdb90c12a05f9b9c`）。measurement HEADのcodeで同じsourceから再導出（`--check`）して一致 |

手順（すべてmeasurement HEADのclean checkoutで実行。順序は計画どおり）:

1. `npx vite build --config vite.benchmark.config.ts`、preview 4181（非isolated）/ 4182（isolated）
2. 機能確認計画（mechanics）の再実行（§6.2）
3. 実ExportのNode reference `--preflight-only`: 入力準備 `ready`（計画対象43 Target、Entry 43、所持武器40、Normal Counter 14、Draftあり・実行中Planなし）
4. headed Chromeで16 slot（driver。非isolated 12 slotはpage #1、isolated 4 slotはpage #2。page再生成0件）
5. 4セットのNode reference（Browserの計測の後に逐次実行）
6. analyzer `--public` → `--check`

### 6.2 同じHEADの機能確認（synthetic mechanics）

**結果: `mechanics: passed`（10 / 10 slotが期待どおり、headed）**。公開RESULTは
[BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_RESULT_PR5B.json](BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_RESULT_PR5B.json)
（51,897 bytes、SHA-256 `035a199e89cba49c05bb41495833a62e8e247f3357de29890962f9d59f7db627`、`--check` 一致）。計画はPR-5Aの登録済みmechanics計画
（series `pr5a-mech-r2`）をそのまま使った。semanticは `synthetic.open` `e5a5fd8c…`、`synthetic.wide-window` `ce4dee4f…`（Browser 2 run + Nodeが同一、
PR-5A r2と同じ値）。キャンセル2試験とも `cancelled` まで0.1 ms、結果不採用、再実行完了・Nodeと一致、キャンセル → Worker detach 675 ms / 365 ms
（syntheticの計算は短く、キャンセル時のWorkerはほぼ空いている）。storage件数は両sessionで変化なし、未測定項目なし。

### 6.3 16 slotの実行結果

全16 slotが `record_saved` で終わり、計画順に記録された（計画外0、欠落0、page loss・期限超過・driver error 0、visibility / freeze / pagehideの中断0、
integrity issue 0、settle後のmessage 0）。storageの件数（IndexedDB・localStorage・sessionStorage・Cache・Service Worker）はslotごと・sessionごとに変化なし。

| 順 | slot | セット | 結果 | request → 結果（ms） | 各slot前のCPU |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `pc.pilot.1` | w0-research | `optimized` 43 / 43 | 27,312（母集団外） | 5% |
| 2 | `pc.timing.1` | w0-research | `optimized` 43 / 43 | 26,803 | 20% |
| 3 | `pc.rerun.1` | w0-research | `optimized` 43 / 43 | 26,467 | 18% |
| 4 | `pc.cancel.input-check` | w0-research | `cancelled`（`input_check` 中、要求0.23 s） | — | 14% |
| 5 | `pc.cancel.reach-table` | w0-research | `cancelled`（`reach_table` 中、2.19 s） | — | 10% |
| 6 | `pc.cancel.assignment` | w0-research | `cancelled`（`assignment_search` 中、10.13 s） | — | 11% |
| 7 | `pc.cancel.route-generation` | w0-research | `cancelled`（`route_generation` 中、22.31 s） | — | 21% |
| 8 | `pc.cancel.plan-verification` | w0-research | `cancelled`（`plan_verification` 中、23.69 s） | — | 21% |
| 9 | `pc.rerun.2` | w0-research | `optimized` 43 / 43 | 26,631 | 7% |
| 10 | `pc.bounds.w0-candidates-3` | w0-candidates-3 | `optimized` 43 / 43 | 26,909 | 28% |
| 11 | `pc.bounds.w-half` | w-half | `not_found` | 5,162 | 12% |
| 12 | `pc.bounds.w-wide` | w-wide | `optimized` 43 / 43 | 112,099 | 14% |
| 13 | `pc.memory.w0-research` | w0-research | `optimized` 43 / 43 | 26,681（母集団外） | 29% |
| 14 | `pc.memory.w0-candidates-3` | w0-candidates-3 | `optimized` 43 / 43 | 27,023（母集団外） | 15% |
| 15 | `pc.memory.w-half` | w-half | `not_found` | 5,036（母集団外） | 15% |
| 16 | `pc.memory.w-wide` | w-wide | `optimized` 43 / 43 | 113,284（母集団外） | 12% |

キャンセルは5試験とも目標のstageで受け付けられた（`cancel_not_exercised` 0件）。キャンセルの要求時刻はrun開始からの時間。

### 6.4 探索上限セットの比較

| 項目 | `w0-research` | `w0-candidates-3` | `w-half` | `w-wide` |
| --- | --- | --- | --- | --- |
| 結果（Browser全run / Node） | `optimized` 4 / 4、Node `optimized` | `optimized` 2 / 2、Node `optimized` | `not_found` 2 / 2、Node `not_found` | `optimized` 2 / 2、Node `optimized` |
| 完成Target | 43 / 43 | 43 / 43 | —（Plan無し） | 43 / 43 |
| 物理操作数 / Plan Step数 | 1,766 / 1,766 | 1,766 / 1,766 | — | 1,766 / 1,766 |
| structural objective / 最終検証の `maxPlanSteps` | 1,766 / 2,500 | 1,766 / 2,500 | — | 1,766 / 2,500 |
| generated Entry / unchanged Target | 43 / 0 | 43 / 0 | — | 43 / 0 |
| Conflict / rejected / warning / 除外Entry | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | — | 0 / 0 / 0 / 0 |
| structural search展開node / candidate数 | 44 / 1（`running`、最初の候補で停止） | 44 / 1 | 1 / 0（`exhausted`、`target_without_option`） | 44 / 1 |
| Planner検証回数 / 結果 | 1 / `optimized`（full run 1） | 1 / `optimized` | 0 | 1 / `optimized` |
| Stage Dの生成方式 | 投影 21 / 形状制約 22 | 投影 21 / 形状制約 22 | — | 投影 21 / 形状制約 22 |
| semantic fingerprint | `3cdc8927…`（4 run + Node一致） | `3cdc8927…`（2 run + Node一致、`w0-research` と同一） | `f0f50282…`（2 run + Node一致） | `0289aab8…`（2 run + Node一致、`w0-research` と異なる） |
| request → 結果（timing母集団） | median 26,631 / max 26,803 ms（3 run） | 26,909 ms（1 run） | 5,162 ms（1 run） | 112,099 ms（1 run） |
| Worker stage（timing母集団の範囲） | 入力確認 1.02〜1.05 s、到達表 8.86〜9.07 s、割当 11.97〜12.15 s、Route生成 1.09 s、検証 3.45〜3.48 s | 1.13 / 8.95 / 12.22 / 1.10 / 3.48 s | 1.10 / 2.43 / 1.62 s（割当で終了） | 1.05 / 19.63 / 86.73 / 1.11 / 3.54 s |
| main threadのlong task最大 | 104 ms（各run 1件） | 117 ms | 105 ms | 113 ms |
| Worker heap used max sampled | 573,858,448 bytes（約547 MiB） | 571,988,696 bytes（約545 MiB） | 364,700,056 bytes（約348 MiB） | 749,246,148 bytes（約715 MiB） |
| renderer private max sampled | 1,540,042,752 bytes（約1.43 GiB） | 1,638,023,168 bytes（約1.53 GiB） | 708,263,936 bytes（約0.66 GiB） | 1,968,115,712 bytes（約1.83 GiB、基準の92%） |
| main threadの結果保持 | 6,222,397 bytes | 10,403,576 bytes | −27,239,830 bytes（GCで減少） | 22,617,412 bytes |
| Worker解放後のattributed memory | 0 | 0 | 0 | 0 |
| Node referenceの経過時間（参考） | 33,432 ms | 33,759 ms | 6,295 ms | 142,580 ms |

- `w0-research` と `w0-candidates-3`: 代表ケースでは最初のstructural candidate（node 44）が採用されるので、候補数・検証回数の3は使われず、結果
  （fingerprint）・時間・memoryは同じだった。候補が棄却された場合の追加コストは、この入力では測れない（未確認範囲）
- `w-half`: 到達表は速いが、計画対象Targetのうち少なくとも1つがwindow内に選択肢を持たず（`target_without_option`）、割当探索の最初のnodeで尽きた。
  代表ケースには半分のwindowでは足りない
- `w-wide`: 結果は `optimized` で物理操作数・structural objectiveも同じ1,766だが、Routeが異なる（fingerprintが異なる）。到達表が約2.2倍、割当探索が約7倍に
  なり、時間基準を大きく超えた。renderer privateも基準（2 GiB）の92%に達した
- main threadのlong taskは、非isolated sessionの各runで1件（約100〜120 ms、入力準備の時間と同程度）、isolatedのmemory slotでは0件だった。
  原因は特定していない（基準 ≤ 1,000 msには余裕がある）
- main threadの結果保持は `performance.memory` の固定点の差であり粗い（`w-half` はGCで負になった）。基準は満たしているが、精密な保持量ではない

### 6.5 共通キャンセルゲートと、キャンセル → Worker detachの未測定

共通ゲート（`w0-research` の5試験で1回判定し、全セットに適用）:

| 基準 | 結果 | 観測 |
| --- | --- | --- |
| `cancel.trial-passed` | passed | 5 / 5 `cancel_passed`（試験自身のキャンセルで `cancelled`、結果不採用、integrity issue無し） |
| `cancel.settle`（≤ 100 ms） | passed | 0 / 0 / 0.1 / 0 / 0.1 ms |
| `cancel.worker-gone`（≤ 2,000 ms） | **unmeasured** | 5試験とも、slotの終わりまでにWorker targetのdetachを観測していない（`null`） |
| `cancel.no-result` | passed | 5 / 5 結果不採用、settle後のmessage 0 |
| `cancel.rerun` | passed | 再実行 `pc.rerun.2` は `completed`、integrity issue無し |
| `cancel.rerun-identical` | passed | `pc.rerun.2` のfingerprintが同じセットのNode referenceと一致（`3cdc8927…`） |

共通ゲートの判定は `not_comparable`（1基準が未測定）であり、どのセットの cancel / lifecycle 軸も `passed` にならない。比較セットの storage件数の
不変（合格）だけでこの軸が通ることはない（PR-5Bで直した判定規則のとおり）。

未測定の原因: driverは各slotの終わり（キャンセルの約1.0 s後。runnerの遅着message待ち1 sと記録の保存）に、そのslotで生成されたWorker targetの
attach / detachを記録して締める。実Exportの計算中のWorkerはその時点でまだdetachしていなかった。synthetic（§6.2）ではキャンセル時のWorkerの計算が
短いので、0.4〜0.7 sでdetachを観測できていた。計画の観測方法そのものの窓が、計画の基準（2 s）を判定するには短かった。

**計画外の診断（正式記録ではない。RESULTに入れていない）**: 同じmeasurement HEADのbenchmark build、同じ実Export、`w0-research`、headed Chrome、別の
新しいprofile、非isolated pageで、scratchのCDP scriptがpageの `runSlot`（`planned: false` の計画外run）を呼び、slotが終わった後も最大20 sまで
Worker targetのdetachを観測した。

| キャンセル | 受け付けたstage | `cancelled` まで | slot終了（キャンセル後） | Worker detach（キャンセル後） |
| --- | --- | ---: | ---: | ---: |
| `reach_table` + 1 s | `reach_table` | 0.2 ms | 1,013 ms | **2,015 ms** |
| `assignment_search` + 0.1 s | `assignment_search` | 0.1 ms | 1,003 ms | **2,016 ms** |
| `plan_verification` + 0.5 s | `plan_verification` | 0.1 ms | 1,006 ms | **2,014 ms** |

- 3回とも約2,015 msで一定であり、stageや計算の進み具合に依存しなかった。Production Workerは計算中にevent loopへ戻らない（`yieldControl` を渡さない）ので、
  `terminate()` の後もWorkerは計算中であり、Browserが強制終了するまでの待ち時間でdetachが決まっていると考えられる。Chromium（Blink）がWorkerの終了時に
  強制終了taskを予約する設計であることは公開情報で確認したが、その待ち時間の値はこのPRでは確認していない（原因は推定であり、特定していない）
- 画面上のキャンセル（`cancelled`）はいずれも0.2 ms以内であり、結果は採用されない。2 sはWorkerがCPU・memoryを返すまでの時間である
- 観測窓を延ばして正式に測り直しても、登録基準 ≤ 2,000 msは約15 ms超過で `failed` になる見込みである

### 6.6 各探索上限セットの判定

| セット | semantic | 計算成立 | performance | memory | cancel / lifecycle | 全基準 |
| --- | --- | --- | --- | --- | --- | --- |
| `w0-research` | passed | passed | passed | passed | not_comparable（共通ゲート） | **判定不能** |
| `w0-candidates-3` | passed | passed | passed | passed | not_comparable（共通ゲート） | **判定不能** |
| `w-half` | passed | **failed**（`not_found`） | passed | passed | not_comparable（共通ゲート） | **不合格** |
| `w-wide` | passed | passed | **failed**（112 s） | passed | not_comparable（共通ゲート） | **不合格** |

採用可能条件（計画 §9 の6）のうち「同じHEADのmechanicsが `passed`」は満たした（§6.2）が、全基準を満たしたセットが無いので、どのセットも正式採用可能ではない。

### 6.7 未確認範囲と残るリスク

- 入力は代表Export 1件（43目標武器）だけである。他のExport・他の利用者の入力で成立するか、時間・memoryがどうなるかは未確認
- 計測PCは1台（Ryzen 7 9700X）。より遅いPC・memoryの少ないPCは未確認。Android（任意）は計測していない。iPhoneは未検証（非対応ではない）
- 代表ケースでは最初のstructural candidateが採用されるので、2件目以降の候補（棄却後の再探索・再検証）のコストは測れていない。`w0-candidates-3` の
  候補数・検証回数3の効果と費用は未確認
- `w-wide` のRouteが `w0-research` と異なることから、windowの違いで代表ケースの結果（Route）が変わる。最短性は主張しない
- memoryはsamplingの最大値（max sampled）であり、連続的な真のpeakではない。renderer privateはtab全体の値である
- Production Workerの最大同期区間は測っていない（計算全体が1つのtask、§3）
- キャンセル → Worker detachは正式には未測定であり、計画外の診断値（約2,015 ms）は判定に使っていない

## 7. 次の計測案とOwnerの判断事項（PR-5Bの残作業）

全基準を満たしたセットが0件なので、Production定数は確定しない。採用に進むには、キャンセル → Worker detachの基準を判定できる計測が要る。

1. **Owner判断: キャンセル → Worker detachの基準**。計画外の診断では約2,015 msで一定だった（§6.5）。選択肢:
   - (a) 基準 ≤ 2,000 msを維持する: 現在のProduction Worker（計算中にyieldしない）とこのChromeでは満たせない見込みであり、どのセットも採用できない。
     Workerを変える場合は計算意味論・Worker契約の変更になり、PR-5の範囲外である
   - (b) 基準を見直して計画を登録し直す（例: ≤ 3,000 ms。根拠: 画面上のキャンセルは0.2 ms以内で結果は採用されず、この時間はWorkerの資源を返すまでの
     Browser側の強制終了の待ちである）。値と根拠はOwnerが決める
2. **driverの観測窓の修正（計測code）**: キャンセルのslotでは、Worker targetのdetachを観測するか一定時間（例: キャンセルから10 s）経つまでslotを締めない。
   計測codeの変更なので、新しいmeasurement HEADと新しいseries（例: `pr5b-r2`）で16 slot全体を測り直す。`pr5b-r1` の記録は上書きせず、混在させない
3. 比較セット・slot・cancel trigger・他の基準は変えない（計画 §9 の7・8）。計測時間の目安はBrowser約17分 + Node reference約4分
4. 測り直しの後、全基準を満たしたセットからOwnerが採用セットを決め、別commitで `PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS` を確定する
   （PR-4のisolation testの `null` 固定を同時に更新する）。`pr5b-r1` の範囲では、`w0-research` と `w0-candidates-3` が共通ゲート以外の全基準を満たし、
   代表ケースで同じ結果・時間・memoryだった。両者の違いは2件目以降の候補が必要な入力でだけ現れ、その費用は未測定である（§6.7）
5. 長時間化の案内の時間閾値（17.19のU3）は、本計測の時間（代表ケースで約27 s）を参考にUI公開PRで決める（本PRでは決めない）
