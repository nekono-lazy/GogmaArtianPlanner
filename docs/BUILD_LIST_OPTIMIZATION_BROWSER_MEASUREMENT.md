# 作成リスト全体最適化 Production Browser計測基盤（Issue #260 PR-5A）

Refs #260。**benchmark専用**。本書は、作成リスト全体最適化（[PLANNER_SPEC.md](PLANNER_SPEC.md) 17章）の探索範囲・探索上限の
Production定数（17.13、17.19のU2）を決めるために、Production計算をPC Browserで計測する基盤の記録である。

- PR-5A（本PR）: 計測基盤、機能確認計画（[MECHANICS_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md)）とその結果、
  PR-5Bの測定計画案（[MEASUREMENT_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md)、Owner承認待ち）
- PR-5B（後続）: Owner承認済みの計画を登録したcommitで実Exportを計測し、Production定数を確定する
- PR-5Aは正式な実Export計測もProduction定数の確定も行わない。`PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS = null` のままである
- 実Export（`gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`）はローカルに存在することを
  確認しただけで、PR-5Aでは読み込んでいない（入力変換の事前確認もPR-5Bの登録後に行う）

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

### 5.0 r2（レビュー修正後のcode）

r2の結果は、修正後のcodeと計画をcommitしたHEADで実行した後の記録commitで追記する。

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

自動テスト（r1時点）: `src/benchmarks/buildListOptimization/` の8 file（protocol、入力、semantic、runner、計画、解析、page、isolation）、
既存isolation test 2件の更新（PR-4のWorker isolation、Research P-1のbenchmark config固定）。

## 6. PR-5Bで実測を始めるための残作業

1. Ownerが測定計画案の判断事項（[MEASUREMENT_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md) §9）を決める
2. 決定を計画blockへ反映し（`status: registered`、`criteria.status: registered`、`approval: owner_approved` と承認者・日付、`baseCommit` の更新）、
   そのcommitをmeasurement HEADとする
3. measurement HEADで機能確認計画を再実行し（同じHEADの基盤が動くことの確認）、Node referenceの `--preflight-only` で実Exportの入力準備を確認する
4. 計測中は他の重い処理を止め、headed Chromeでdriverを実行する（非isolated 4181 → isolated 4182）。各探索上限セットのNode referenceを実行する
5. analyzerで公開RESULTを導出・再検証し、結果・未確認範囲（他のExport、他のmachine、Android / iPhone、2件目以降の候補）を記録する
6. 別commitで `PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS` を確定する（PR-4のisolation testの `null` 固定を同時に更新する）
