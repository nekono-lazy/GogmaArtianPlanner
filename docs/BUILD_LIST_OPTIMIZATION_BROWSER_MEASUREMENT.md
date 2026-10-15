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
| `buildListOptimizationBenchmarkRunner.ts` | 1 slotのrun（Client、計測Worker、cancel trigger、固定点memory、long task、lifecycle、storage） |
| `buildListOptimizationBenchmarkBrowserPorts.ts` | Browserの読取り（`performance.memory`、`measureUserAgentSpecificMemory()`、`PerformanceObserver('longtask')`、storage） |
| `BuildListOptimizationBenchmarkPage.tsx` / `main.tsx` | 計測page。driver用のconsole API `globalThis.buildListOptimizationBenchmark` |
| `buildListOptimizationBenchmarkPlan.ts` | 計画blockの抽出・検証・slotへの結び付け（post-hoc。page / runnerはimportしない） |
| `buildListOptimizationBenchmarkAnalysis.ts` | 公開RESULTの導出と再検証（post-hoc） |

script:

| script | 役割 |
| --- | --- |
| `scripts/drive-build-list-optimization-browser.mjs` | CDP driver。計画をmeasurement HEADから読み、専用profileのChromeで計画順にslotを実行し、slotごとにrecordを保存する。CDPでWorker targetのattach / detach（全slot）とWorker heap（memory slot）、OSのrenderer memory（memory slot、Windows）、crash（OOMの注記）を記録する。実Exportの計測は `registered` かつ `owner_approved` の計画でしか始めない |
| `scripts/run-build-list-optimization-node-reference.mjs` | 同じHEADのNode reference（同じ入力準備・同じProduction adapterと依存・同じfingerprint）。`--preflight-only` は計算せず入力の準備だけを記録する |
| `scripts/analyze-build-list-optimization-browser.mjs` | analyzer。計画をmeasurement HEADから `git show` で読み、解析時のcodeがmeasurement HEADと異なれば解析しない。`--public` は排他的に書き、`--check` は同じrawから再導出して比較する |

## 3. 記録と判定の分離

- 4軸（semantic parity、計算成立・探索上限、性能とmemory、cancel / lifecycle）を分けて導出し、どれも他を読まない
- 計画が `proposed`（Owner承認待ち）なら観測だけを導出し、判定はすべて `not_yet_registered` とする。`registered` かつ `owner_approved` の
  計画だけを基準で判定し、基準は探索上限セットごとに判定する
- record・driver記録・Node referenceが別のHEAD・未commitのcodeで作られていれば、analyzerは何も導出しない
- 欠けたslot・完了しなかったrun・取得できなかった値を成功と数えない（`missingSlots`、`incomplete`、`not_comparable`、`unmeasured`）
- 計画外のrecord（`planned: false`、計画に無いslot、目的・入力・探索上限・option・origin・Browserの不一致、同じslotの2件目）は除外し、理由を記録する
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

機能確認計画のmeasurement HEADは、本書と計測基盤をcommitしたcommitである。結果は、そのHEADで実行した後の記録commitで本節に追記する。

## 6. PR-5Bで実測を始めるための残作業

1. Ownerが測定計画案の判断事項（[MEASUREMENT_PLAN](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md) §9）を決める
2. 決定を計画blockへ反映し（`status: registered`、`criteria.status: registered`、`approval: owner_approved` と承認者・日付、`baseCommit` の更新）、
   そのcommitをmeasurement HEADとする
3. measurement HEADで機能確認計画を再実行し（同じHEADの基盤が動くことの確認）、Node referenceの `--preflight-only` で実Exportの入力準備を確認する
4. 計測中は他の重い処理を止め、headed Chromeでdriverを実行する（非isolated 4181 → isolated 4182）。各探索上限セットのNode referenceを実行する
5. analyzerで公開RESULTを導出・再検証し、結果・未確認範囲（他のExport、他のmachine、Android / iPhone、2件目以降の候補）を記録する
6. 別commitで `PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS` を確定する（PR-4のisolation testの `null` 固定を同時に更新する）
