# Issue #278 PR-6: Planner Alternative Domainの依存関係監査と整理範囲

Refs #278。**docs-only**。本書はIssue #278のPR-6として、Productionから外れたPlanner Alternativeに関係する残存code
（Planner Domain・Replacement Domain・Search Domain・`PlannerBuildListContext`・Research / Benchmark）の利用関係を
最新mainで再監査し、後続PRで削除するもの・維持するもの・判断が必要なものを分類した記録である。

## 0. 位置づけ

- 本書は監査記録であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md` →
  [PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.6.11 / 9.6.12 → その他の正式仕様 → 実装 → test → 本書である
- 本書はProductionの意味論、Domainの型・API、Worker protocol、Persistence、schema / versionを変えない。
  本PRはcode・test・fixture・期待値・Research記録を変更していない（12章）
- 9.2.19（Planner Alternative Searchと1段の競合repair）と [REQUIREMENTS.md](./REQUIREMENTS.md) 23.1は、Issue #278 PR-2より
  前のProduction経路の記録である。本書はそれらを現在のProduction仕様として扱わない。現在の競合解決は9.6である
- 分類は監査時点（下記の基準commit）のimport graphに基づく。削除・移設を行うPRは、その時点で同じ確認をやり直してから
  実施する（9.6.11）
- 13章はPR-7（分類Cの削除）の実施記録であり、PR-7で追記した。1〜12章はPR-6時点の記録のまま変えていない

**基準。** `origin/main` = `db29f228558cc76ca2e5d1b70267782283cc262c`（PR #283「不要になったPlanner Alternative専用保存経路を削除する」の
merge）。作業開始時に local `main`・`origin/main`・HEADの一致、Working Tree clean（未commit・staged変更なし）、worktreeが本checkoutの
1つだけであることを確認し、`origin/main` から作業branch `docs/issue278-alternative-domain-audit` を作成した。PR #279〜#283
（Issue #278 PR-1〜PR-5）はすべて基準commitに含まれる。

## 1. 調査対象と方法

### 1.1 対象

| 区分 | 対象 |
| --- | --- |
| Planner Alternative Domain | `src/domain/planner/alternative/` の10 moduleと `index.ts` |
| Replacement Domain | `src/domain/planner/replacement/` の7 moduleと `index.ts` |
| Search Domain | `src/domain/search/alternative/`、`src/domain/search/constrained/`、`src/domain/search/shapeConstrained/`（`visitPlannerAlternativeCandidates()`、`defaultPlannerAlternativeSearchExtent` を含む） |
| Planner Domain（共有） | `PlannerBuildListContext`（`persisted` / `temporary_augmented` / `temporary_replacement`）と、それを受け取る `plannerTypes.ts`・`plannerValidation.ts`・`plannerInitialContext.ts`・`plannerDeterministicScheduler.ts`・`plannerBeamSearch.ts`・`productionPlanGeneration.ts` |
| Build List（共有） | `src/domain/buildList/buildListEntryReplacement.ts` |
| Research / Benchmark | `src/benchmarks/plannerGlobal*`、`src/benchmarks/globalAssignment/`、`src/benchmarks/plannerAlternative*`、`src/benchmarks/issue101*`、`src/benchmarks/constrainedEnumeration*`、`src/workers/*.worker.benchmark*.ts`、`src/pages/*BenchmarkPage.tsx`、3つのbenchmark HTML、`scripts/*.mjs` |
| 境界test | `src/benchmarks/globalAssignment/isolation.test.ts`、`src/workers/buildListOptimizationWorkerIsolation.test.ts`、`src/domain/search/shapeConstrained/shapeConstrainedIsolation.test.ts`、`src/benchmarks/plannerAlternativeBenchmarkIsolation.test.ts`、Issue #101の実ケースtest |

### 1.2 entrypoint

ファイル名の文字列検索だけでは「未使用」と判断せず、次のentrypointから到達性を求めた。

| 系統 | entrypoint |
| --- | --- |
| Production app（`vite.config.ts`） | `index.html` → `src/main.tsx`。Workerは `new URL('…', import.meta.url)` の参照先（`planner.worker.entry.ts`、`search.worker.entry.ts`、`buildListOptimization.worker.entry.ts`、3つのIdentification Worker）を辿る |
| Benchmark build（`vite.benchmark.config.ts`） | `benchmark.html` → `src/benchmark.tsx`、`benchmark-global-assignment.html` → `src/benchmarks/globalAssignment/browser/main.tsx`、`benchmark-build-list-optimization.html` → `src/benchmarks/buildListOptimization/main.tsx` と、それらが `new URL()` で参照するbenchmark Worker |
| Node Research runner | `scripts/*.mjs` のうち `server.ssrLoadModule('/src/…')` でTypeScriptを直接読む122本（読み込むmoduleをentrypointとする） |
| test | すべての `*.test.ts(x)` |

`src` の非test sourceには `import.meta.glob` と動的 `import()` が1件も無いことを確認した（`import.meta.glob` は境界testなどtestだけが使う）。

### 1.3 方法

1. **import graph**: 作業treeのTypeScript compiler API（`node_modules/typescript`）で `src` の1,184 fileをASTとして読み、
   import（`import type` と、全指定子が `type` の場合をtype-onlyとして区別）、`export … from`、`export *`、動的 `import()`、
   `new URL('…', import.meta.url)`（Worker entry）、`import('…')` 型参照の各edgeを解決した。未解決は `docs/*.md?raw` 等の
   test用raw importだけである
2. **barrel解決したsymbol単位の到達性**: importした名前ごとに `export *` / 名前付きre-exportを辿って定義moduleへ解決し、
   runtime symbolがimportされたmoduleだけを「使われる」とした（namespace importは全export）。使われるmoduleの内部では、
   そのmoduleのruntime importをすべて辿る（module内部は保守的）。`domain/planner/index.ts` の `export * from './alternative'`
   のようなbarrelは、それだけではmoduleを到達させない
3. **build照合（ground truth）**: Production（`vite.config.ts`）とbenchmark（`vite.benchmark.config.ts`）を
   `--minify false` でscratchpadへbuildし、comment除去後のcodeで約60の対象symbolの宣言（`function` / `class` /
   `const`）がどのchunkにあるかを照合した。2の結果とすべて一致した
4. **文字列利用の確認**: `rg` で `'temporary_replacement'` 等の文字列、名前をregexで固定するtest、`vitest.config.ts` の
   test file一覧を確認した
5. **境界testの読解**: 1.1の境界testと、対象moduleを使うProduction Domain testを読み、固定している契約を記録した

制約: Research runnerのCLI option（例: Global Assignmentの `d0a-v1` / `d0a2-v2`）で実行時に選ばれる経路は静的には区別しない
ので、到達し得るものは到達として数えた。module内部の保守的な追跡により、Research runnerの到達数は上限側の値である。

### 1.4 実行した確認

```text
git status --short / git diff / git diff --cached / git log -1 --oneline / git worktree list
git fetch origin; git rev-parse main origin/main
node <scratchpad>/importGraph.mjs . <scratchpad>/graph.json            # AST import graph (1,184 files, 122 runner scripts)
node <scratchpad>/symbolReach.mjs . graph.json sym.json <targets...>   # barrel-resolved reachability, per script / page / test
npx vite build --outDir <scratchpad>/dist-prod --emptyOutDir --minify false
npx vite build --config vite.benchmark.config.ts --outDir <scratchpad>/dist-bench --emptyOutDir --minify false
node <scratchpad>/bundleDecls.mjs <dist>/assets <symbols...>           # declarations per chunk, comments stripped
rg / grep: import.meta.glob, import(, temporary_augmented|temporary_replacement, PlannerBuildListContext,
           toHaveProperty('…Alternative…'), RECORDED_DIGESTS, ssrLoadModule('/src/…'), vitest.config.ts
```

調査用scriptとbuild出力はscratchpadだけに置き、Repositoryへ追加していない。

**名前による横断確認（再現用）。** 分類C（7章）の判定は、barrelを経由するimportも含めて利用者が必ずsymbol名を書くことを使い、
次のcommandでも確かめた（C 5 module自身を除く）。

```bash
grep -rlE "createPlannerAlternativeWhatIfComparison|createPlannerAlternativeRepair\b|runPlannerAlternativeScenario|expandPlannerAlternativeDecision|createPlannerAlternativeRouteSummary|countPlannerAlternativeLineageExclusions|derivePlannerConflictRepairLineageContext|plannerConflictRepairOutcomeOf|appendPlannerConflictRepairDecision|PlannerAlternativeComparison\b|PlannerAlternativeRepair[A-Z]|PlannerAlternativeWhatIf[A-Z]|PlannerAlternativeScenario[A-Z]|PlannerConflictRepairLineageContext" src scripts
```

結果: 非test sourceは2 fileだけで、どちらもcommentである（`plannerAlternativeKernel.ts` のheader commentが `runPlannerAlternativeScenario()` を、
`plannerResultPersistenceService.ts` のcommentがPR-5で削除した保存APIを名指しする）。testは7章のもののほか、
`plannerWorkerClient.test.ts`（Clientにmethodが無いことの否定）と、Issue #154 Phase 2-C2.5-B / 2-C2.6-B*のResearch test 15本
（`plannerGlobalPhase2C25B.test.ts`、`plannerGlobalPhase2C26B2B1.test.ts` 〜 `plannerGlobalPhase2C26B2C2B2K.test.ts`）である。後者は
Researchのsourceが `createPlannerAlternativeWhatIfComparison` 等を使わないことを `not.toMatch()` で確かめる否定の検査であり、
関数を削除しても成立する。

## 2. 結論の要約

- **A（Production共有基盤）**: Productionが実際に使うのは、全体最適化Stage D（ルート生成・形状Route検証）の
  `derivePlannerAlternativeReservation()`、Replacement Domainの `plannerDeterministicMaterializer.ts`・`plannerMaterializationErrors.ts`・
  `plannerSearchOrigin.ts`、Planner Alternative Searchのfrontier / section / route registration / Candidate factory / 型 / validation /
  reservationの正規化（形状制約付き探索が共有）、`src/domain/search/constrained/` のCandidate factory・型・origin validation、
  形状制約付き探索、`buildListEntryReplacement.ts` である。いずれも全体最適化のWorker bundleにあることをbuild照合で確認した
- **C（削除可能）**: `plannerAlternativeWhatIf.ts`・`plannerAlternativeRepair.ts`・`plannerAlternativeScenario.ts`・
  `plannerAlternativeComparison.ts`・`plannerConflictRepairLineage.ts` の5 moduleは、Production・全体最適化・Node Research runner
  122本・Browser benchmark 3 pageのどれからも到達せず、どのbuild chunkにも無い。kernelより上の閉じた層であり、kernel以下は
  これらに依存しない。利用者はそれら自身のtest、Issue #101のrepair / what-if test、3つのtestの一部だけである
- **B（Research / Benchmarkで必要）**: kernel・full run・trial（`defaultPlannerAlternativeTrialBounds` を含む）・Alternative用
  materializer（search identity）、Replacement Domainのaugmented / replacement preflight・conflict context・conflict scenario・
  conflict work、`visitPlannerAlternativeCandidates()`・`defaultPlannerAlternativeSearchExtent`、`src/domain/search/constrained/`
  のconstrained enumeratorは、Issue #154のResearch（凍結済みRESULTを再検証するtest、Global Assignment `d0a-v1` のgolden、
  Phase 2-C2.5系のBrowser Worker）、Planner Alternative benchmark、Issue #101のPhase 2 acceptance test、AGENTS.mdが求める
  契約test（checkpoint conflictの再対応付け拒否、status-only変更とsearch identity）が使う
- **D（追加判断が必要）**: `PlannerBuildListContext` の `temporary_augmented` / `temporary_replacement`（Productionはどちらも
  生成しないが、分岐はProductionの共有moduleとbundleにあり、Bのkernel・preflight・D系Research・scheduler parityの
  Scenario M・PR-2のparity digestが使う）、Issue #101実ケースの現行経路でのregressionを追加するか、Research専用codeを
  Production Domain folderから移すか
- **推奨**: PR-7でCだけを削除する（versionなし、Production bundleのcodeは変わらない見込み）。A・Bは残す。Bの移設は
  Issue #278の目的（通常Plannerの競合解決の簡素化）の外であり、必要なら別Issueで扱う。`alternative` という名前のcodeを
  すべて削除することはIssue #278の完了条件にしない（11章）

## 3. Production bundleの照合結果

非圧縮buildのcomment除去後のcodeで、宣言があったchunk（`-` はどのchunkにも無い）。Production buildのchunkは
`index`（main thread）、`planner.worker.entry`、`search.worker.entry`、`buildListOptimization.worker.entry`、3つのIdentification Worker。

| symbol | 定義module | Production build | benchmark build（抜粋） |
| --- | --- | --- | --- |
| `createPlannerAlternativeWhatIfComparison` / `createPlannerAlternativeRepair` / `runPlannerAlternativeScenario` / `expandPlannerAlternativeDecision` / `createPlannerAlternativeRouteSummary` / `derivePlannerConflictRepairLineageContext` / `appendPlannerConflictRepairDecision` | C 5 module | - | - |
| `runPlannerAlternativeKernel` / `preparePlannerAlternativeKernel` / `createPlannerAlternativeFullRunner` / `judgePlannerAlternativeTrial` | kernel / full run / trial | - | Planner Alternative benchmark Worker、Phase 2-C2.5-B / D2B / D2E Worker（`preparePlannerAlternativeKernel`） |
| `defaultPlannerAlternativeTrialBounds` | trial | - | Phase 2-C2.5-B / D2B / D2E Worker |
| `createPlannerAlternativeMaterializer` / `createPlannerAlternativeSearchIdentity` / `PLANNER_ALTERNATIVE_ROUTE_POLICY_VERSION` | Alternative materializer | -（`buildListOptimization.worker.entry` に関数名を含むcommentが1件あるがcodeではない） | Global Assignment Worker（search identity）、Planner Alternative / Phase 2-C2.5系Worker |
| `derivePlannerAlternativeReservation` / `PlannerAlternativeReservationError` | reservation | `buildListOptimization.worker.entry` | 全体最適化・Global Assignment系 |
| `preparePlannerAugmentedConflictPreflight` / `preparePlannerReplacementConflictPreflight` / `createPlannerConflictContexts` / `preparePlannerConflictScenario` / `createPlannerConflictWorks` | replacement 4 module | - | Planner Alternative benchmark Worker、Phase 2-C2.5系Worker |
| `createDeterministicMaterializer` / `ConstrainedMaterializationError` / `createPlannerStartSearchOrigin` / `normalizePlannerSearchOrigin` / `resolvePlannerSearchOriginTarget` | replacement 3 module | `buildListOptimization.worker.entry` | 全体最適化・Global Assignment系 |
| `createPlannerAlternativeFrontier` / `openPlannerAlternativeSearchSections` / `PLANNER_ALTERNATIVE_ROUTE_REGISTRATIONS` / `createPlannerAlternativeCandidate` / `emptyPlannerAlternativeReservation` / `assertPlannerAlternativeSearchInput` / `normalizePlannerAlternativeReservation` / `validatePlannerAlternativeSearchExtent` | Search alternative | `buildListOptimization.worker.entry` | 同左 |
| `visitPlannerAlternativeCandidates` | Search alternative | - | Global Assignment Worker、Planner Alternative / Phase 2-C2.5系Worker |
| `defaultPlannerAlternativeSearchExtent` | Search alternative | - | benchmark main、Phase 2-C2.5-B / D2B / D2E Worker |
| `normalizePlannerAlternativeExcludedRouteKeys` / `isEmptyPlannerAlternativeReservation` | Search alternative | - | （Research / benchmarkだけ） |
| `createConstrainedCandidate` / `compareConstrainedCandidates` / `collectConstrainedSearchOriginIssues` | Search constrained | `buildListOptimization.worker.entry` | 同左 |
| `visitConstrainedCandidates` / `enumerateConstrainedCandidates` / `defaultConstrainedEnumerationBounds` / `createConstrainedRouteBases` / `assertConstrainedCandidateSearchInput` / `validateConstrainedEnumerationBounds` | Search constrained | - | constrained enumeration benchmark Worker（`visitConstrainedCandidates`） |
| `visitShapeConstrainedRouteCandidates` | Search shapeConstrained | `buildListOptimization.worker.entry` | 同左 |
| `applyBuildListEntryReplacements` / `resolveBuildListEntryReplacement` | buildListEntryReplacement | `buildListOptimization.worker.entry`（`apply` は `index` にも） | 同左 |
| `validateBuildListEntryReplacements` | buildListEntryReplacement | `buildListOptimization.worker.entry`、`index`、`planner.worker.entry` | 同左 |

**PR-7の比較用の基準値。** 基準commitの通常のProduction build（`npm run build`、`VITE_APP_BUILD_ID` 未設定のlocal build）が出力する
JS chunkは次の7つである。同じsourceから2回buildして同じ名前（content hashを含む）になることを確認した。分類Cの削除はこれらの
どのchunkにも含まれないcodeの削除なので、PR-7の後も同じ名前になる見込みである。

```text
buildListOptimization.worker.entry-CJNAaBtN.js
gogmaCounterIdentification.worker.entry-CBxGKU0c.js
index-C_1rVpUc.js
normalArtianCounterIdentification.worker.entry-x3Hf0VUE.js
planner.worker.entry-BSYennu9.js
search.worker.entry-C3cItWKn.js
skillIdentification.worker.entry-BsLKbc-3.js
```

`planner.worker.entry` の `validateBuildListEntryReplacements` は `plannerValidation.ts` の `temporary_*` 分岐からだけ到達する（4.4）。
`index` では同じ分岐に加えて、全体最適化の採用保存の検証（`plannerResultPersistenceValidation.ts` の `prepareFinalReplacementBuildList()`）
からも到達する。生産計画画面・作成リスト画面・Application serviceから到達するPlanner AlternativeのDomain計算は無い。

## 4. module / API別の依存関係

到達数は1.3の方法による。「Research runner」はNode Research runner 122本のうち到達する本数、「page」は3つの
benchmark HTMLのうち到達するもの（`benchmark` = `benchmark.html`、`GA` = `benchmark-global-assignment.html`、
`BLO` = `benchmark-build-list-optimization.html`）、「test」は直接importするtest file数（同じfolderのtestを含む）である。

### 4.1 Planner Alternative Domain（`src/domain/planner/alternative/`）

| module | 行数 | 分類 | Production | 全体最適化 | Research runner | page | 直接importするtest |
| --- | ---: | --- | --- | --- | ---: | --- | ---: |
| `index.ts` | 10 | 4.1.11参照 | barrelのみ | なし | 0 | なし | 0 |
| `plannerAlternativeComparison.ts` | 172 | C | なし | なし | 0 | なし | 6（type） |
| `plannerAlternativeFullRun.ts` | 99 | B | なし | なし | 102 | benchmark | 0（kernel test経由） |
| `plannerAlternativeKernel.ts` | 789 | B | なし | なし | 102 | benchmark | 15 |
| `plannerAlternativeMaterializer.ts` | 114 | B | なし | なし | 108 | benchmark, GA | 2 |
| `plannerAlternativeRepair.ts` | 230 | C | なし | なし | 0 | なし | 5 |
| `plannerAlternativeReservation.ts` | 155 | A | GA Worker | Stage D | 109 | 3 page | 14 |
| `plannerAlternativeScenario.ts` | 396 | C | なし | なし | 0 | なし | 0（what-if / repair経由） |
| `plannerAlternativeTrial.ts` | 231 | B | なし | なし | 102 | benchmark | 21 |
| `plannerAlternativeWhatIf.ts` | 102 | C | なし | なし | 0 | なし | 7 |
| `plannerConflictRepairLineage.ts` | 146 | C | なし | なし | 0 | なし | 4 |

module間の依存（runtime）は `kernel → materializer / full run / reservation / trial / replacement（preflight・scenario）`、
`full run → trial / productionPlanGeneration`、`scenario → kernel / full run / trial / comparison / replacement preflight`、
`what-if → scenario`、`repair → scenario / lineage` である。kernel・full run・trial・materializer・reservationは
scenario・what-if・repair・comparison・lineageのどれにもruntimeで依存しない（comparisonとlineageはkernelの型だけを読む）。

#### 4.1.1 `plannerAlternativeComparison.ts`（C）

- 主なexportと責務: 9.2.19.13のtyped comparisonの型（`PlannerAlternativeComparison`、`PlannerAlternativeDistance`、
  `PlannerAlternativeRouteSummary`、`PlannerAlternativeTargetOutcome`、`PlannerAlternativeConflictSummary`、
  `PlannerAlternativeScenarioOutcome`）と、`createPlannerAlternativeRouteSummary()`・`createPlannerAlternativeDistance()`・
  `countPlannerAlternativeLineageExclusions()`。what-ifとactual repairが共有する比較結果
- Productionからの直接参照: なし。推移的経路: なし（`domain/planner/index.ts` のbarrelだけ。symbol解決で到達しない）
- 全体最適化: なし（全体最適化の変更Route表示は `artifact.summary` と最終Planの記録から作る。17.9）
- Research / Benchmark: なし（PR-4で比較表示 `presentProductionPlanAlternative` を削除済み）
- test: `plannerAlternativeScenario.ts` 経由のwhat-if / repair test（4.1.9 / 4.1.6）とIssue #101のrepair / what-if test
- 正式仕様: PLANNER_SPEC 9.2.19.13（記録）
- 削除の影響: scenarioがruntimeでimportするので、scenarioと同時に削除する。他に利用者は無い
- 推奨: PR-7でscenario / what-if / repairと同時に削除

#### 4.1.2 `plannerAlternativeFullRun.ts`（B）

- 主なexportと責務: `createPlannerAlternativeFullRunner()`、`PlannerAlternativeFullRunner` / `PlannerAlternativeFullRun`、
  `PlannerAlternativeCancelledError`。request-globalな `PlannerAlternativeFullRunBudget` を消費する唯一のfull Planner run経路
  （`createProductionPlanWithObserver()` + Trace Replay）
- Production: なし
- 全体最適化: なし（Stage D' は `createProductionPlanWithObserver()` をDomain内で直接使う）
- Research / Benchmark: Issue #154 D系Research（`plannerGlobalD1.ts`・`plannerGlobalD2.ts`・`plannerGlobalD2E.ts`・
  `plannerGlobalD2F.ts`）とPhase 2-C2.7-B（`plannerGlobalPhase2C27B.ts`）がfull runnerを使い、Planner Alternative benchmark
  Worker（`plannerAlternative.worker.benchmark.ts`）が `PlannerAlternativeCancelledError` を使う
- test: 直接のunit testは無く、kernel test・D系 / Phase 2-C2.7-BのResearch testを経由して検証される
- 正式仕様: PLANNER_SPEC 9.2.19.6 / 9.2.19.8.1 / 9.2.19.12（記録）
- 削除の影響: kernelがruntimeでimportするので単独では削除できない。D系Researchの記録の再現経路を失う
- 推奨: 維持（kernelと同じ扱い）

#### 4.1.3 `plannerAlternativeKernel.ts`（B）

- 主なexportと責務: `preparePlannerAlternativeKernel()`・`runPlannerAlternativeKernel()`・`runPreparedPlannerAlternativeKernel()`
  と、その要求・option・instrumentation・結果の型。Target単位の代替探索、individual trial、found判定（9.2.19.3〜9.2.19.6、
  9.2.19.10、9.2.19.12）。prior fixed Entry・prior excluded Route keyとsupersedeの入力を持つ
- Production: なし。全体最適化: なし（全体最適化はkernelを使わず、形状制約付き探索とStage D' を使う）
- Research / Benchmark: Issue #154 Phase 2-C2〜2-C2.6（kernelを実行する `plannerGlobalPhase2C2.ts`・`plannerGlobalPhase2C25A.ts` と、
  instrumentationの型を読む `plannerGlobalPhase2C26A2`〜`A9`（A6を除く））、Phase 2-C2.5-B / D2B / D2EのBrowser Worker（`preparePlannerAlternativeKernel`）、
  Planner Alternative benchmark（Phase 3-A / 3-B。fixture・protocol・runner・instrumentation・Worker）
- test: kernel自身のtest（`plannerAlternativeKernel.test.ts`・`.instrumentation.test.ts`）、Issue #101のPhase 2 acceptance
  （`issue101PlannerAlternative.test.ts`）、Phase 2-C2.6-A3 / A4 / A7 / A8・2-C2.7-BのResearch test、benchmark test、
  what-if / repairのtest（C）
- 正式仕様: PLANNER_SPEC 9.2.19.3〜9.2.19.6 / 9.2.19.10 / 9.2.19.12（記録）、SEARCH_SPEC 5.6.8
- 削除の影響: 102本のResearch runnerと4つのbenchmark Workerが壊れ、Phase 2-C*のResearch testが通らなくなる
- 推奨: 維持。C削除の後もkernelの外部契約（lineage関連の入力を含む）は変えない（10.1）

#### 4.1.4 `plannerAlternativeMaterializer.ts`（B）

- 主なexportと責務: `PLANNER_ALTERNATIVE_ROUTE_POLICY_VERSION`（`'planner-alternative-route-policy:v1'`）、
  `createPlannerAlternativeSearchIdentity()`、`createPlannerAlternativeMaterializer()`（共通coreの
  `createDeterministicMaterializer()` を使うAlternative用adapter）
- Production: なし。build照合では `buildListOptimization.worker.entry` に関数名を含むcommentが1件あるだけで、codeは無い
- 全体最適化: なし（Production Stage Dは共通core `createDeterministicMaterializer()` を直接使う）
- Research / Benchmark: Global Assignment Researchの `d0a-v1` 規則（`benchmarks/globalAssignment/materialize.ts` が
  `createPlannerAlternativeSearchIdentity()` を読み、そのidentityを記録へ入れる。`materializationV1Golden.test.ts` が固定）、
  D系Research（`plannerGlobalD1/D2/D2C/D2E/D2F.ts`）、Phase 2-C2系の12 module
- test: 自身のtest、`domain/models/ownedWeaponStatusLabel.test.ts`（status-only変更でsearch identityが変わらないことの検証。
  AGENTS.mdのOwned Weapon Rulesが求める契約で、Phase 6-B2bでB8のidentityからこのidentityへ移した）
- 正式仕様: SEARCH_SPEC 5.6.8（出力とidentity）、PLANNER_SPEC 9.2.19.6（記録）
- 削除・移設の影響: identity tokenと関数の値が `d0a-v1` のgoldenとResearch記録のidentityに入っているので、値を1つでも
  変えるとgoldenが壊れる。移設する場合も値と算出規則を完全に保つ必要がある
- 推奨: 維持

#### 4.1.5 `plannerAlternativeReservation.ts`（A）

- 主なexportと責務: `derivePlannerAlternativeReservation()`、`PlannerAlternativeReservationError`。fixed Route集合から
  resource reservation（Counter streamごとのheld / blocked位置、排他OwnedWeapon）を導出する（9.2.19.3）
- Productionからの直接参照: `domain/planner/buildListOptimization/routeGeneration.ts`（Stage Dのルート生成）、
  `shapeRouteCheck.ts`（形状Routeの独立検証）
- 推移的経路: `main.tsx → App.tsx → pages/BuildListPage.tsx → services/planner/planCreationService.ts →
  services/planner/buildListOptimizationWorkerClient.ts →（new Worker URL）workers/buildListOptimization.worker.entry.ts →
  workers/buildListOptimization.worker.production.ts → buildListOptimization/optimizeBuildList.ts → routeGeneration.ts →
  plannerAlternativeReservation.ts`。全体最適化のWorker bundleにある
- Research / Benchmark: D系Research、Phase 2-C2系、Planner Alternative benchmark fixture、Global Assignment Research
- test: 自身のtest、Global Assignment Researchのtest 5本、D系 / Phase 2-C*のtest、Issue #101 Phase 2 acceptance
- 正式仕様: PLANNER_SPEC 9.2.19.3、17章（Stage D）、9.6.11（共有として残す）
- 削除の影響: 全体最適化が動かなくなる
- 推奨: 維持（folder名は `alternative` だが共有基盤。Production Domain内のpathは `globalAssignment/isolation.test.ts` の
  Stage D import allowlistが名指しで固定している）

#### 4.1.6 `plannerAlternativeRepair.ts`（C）

- 主なexportと責務: `createPlannerAlternativeRepair()`、`PlannerAlternativeRepairArtifact`・`PlannerAlternativeRepairCalculationResult`・
  `PlannerAlternativeRepairRequest` ほか。「この候補を優先」のactual repairのPure Domain計算（Phase 5-A）。保存可能artifactと次の
  repair lineageを返す
- Production: なし（Worker / Client / Production adapterはPR-4、保存APIはPR-5で削除済み）
- 全体最適化・Research / Benchmark: なし（Research runner 0本、どのbenchmark Workerにも無い）
- test: `plannerAlternativeRepair.test.ts`・`.composition.test.ts`・`plannerAlternativeRepairChain.test.ts`、
  `benchmarks/issue101PlannerAlternativeRepair.test.ts`、`services/planner/plannerResultPersistenceService.buildListOptimization.test.ts`
  （`PlannerAlternativeRepairArtifact` を型としてcastし、全体最適化の採用保存がrepair artifactを拒否することを確かめる）
- 正式仕様: PLANNER_SPEC 9.2.19.8 / 9.2.19.8.1 / 9.2.19.9 / 9.2.19.11（記録）、REQUIREMENTS 23.1（記録）
- 削除の影響: 永続dataへの影響は無い。`ProductionPlan.conflictRepairLineage` の型・validator・Dexie / Export migrationは
  `domain/models` と `domain/models/persistenceCompatibility.ts` にあり、このmoduleを使わない
- 推奨: PR-7で削除。全体最適化の採用testの「repair artifactを拒否する」検証は、型を使わない構造的なobjectへ置き換えて残す

#### 4.1.7 `plannerAlternativeScenario.ts`（C）

- 主なexportと責務: `runPlannerAlternativeScenario()`（kernel準備、individual trial、9.2.19.8.1のscenario composition、
  request-global budget、決定の展開、typed comparison）、`expandPlannerAlternativeDecision()`・`derivePlannerAlternativeDecisionExpansion()`・
  `isPlannerAlternativeConflictExpandedToFixed()`
- Production / 全体最適化 / Research / Benchmark: なし。9.6.3の明示決定集合（`plannerConflictDecisionSet.ts`）は別のauthorityであり、
  このmoduleを使わない
- test: 直接のimportは無く、what-if / repairのtestとIssue #101のrepair / what-if testが経由する
- 正式仕様: PLANNER_SPEC 9.2.19.8.1 / 9.2.19.9（記録）
- 削除の影響: what-ifとrepairだけが使う。scenarioだけが使う `preparePlannerAugmentedConflictPreflight()` の直接呼び出しは
  無くなるが、同関数は `preparePlannerReplacementConflictPreflight()` の第1段として残る（4.2.1）
- 推奨: PR-7で削除

#### 4.1.8 `plannerAlternativeTrial.ts`（B）

- 主なexportと責務: `PlannerAlternativeTrialBounds`、`defaultPlannerAlternativeTrialBounds`（`{ maxCandidateTrialsPerTarget: 2,
  maxPlannerReruns: 8 }`）、`validatePlannerAlternativeTrialBounds()` / `assertPlannerAlternativeTrialBounds()` と各error、
  `PlannerAlternativeFullRunBudget` / `createPlannerAlternativeFullRunBudget()`、`judgePlannerAlternativeTrial()`
- Production: なし（既定値を渡すProduction callerはPR-4で無くなった）
- Research / Benchmark: D系Researchと2-C2.7-Bが `judgePlannerAlternativeTrial()` を使う。Phase 2-C2（`plannerGlobalPhase2C2.ts` の
  portfolio条件）と2-C2.7-B（`plannerGlobalPhase2C27B.ts`）は既定値を実際の計算条件として読み、Phase 2-C2を読むPhase 2-C2.5-B /
  D2B / D2EのBrowser Workerにも既定値が入る（build照合で確認）。
  Planner Alternative benchmarkは既定値を読まず、`BENCHMARK_ONLY_*` の条件を使う（`plannerAlternativeBenchmarkIsolation.test.ts`）
- test: 自身のtest、kernel test、Phase 2-C*のResearch test 11本、`plannerGlobalOracle1657.test.ts`、Issue #101のrepair / what-if test、
  `plannerNormalCounterFastForward.test.ts`、`globalAssignment/isolation.test.ts`（値 `2 / 8` を固定）
- 正式仕様: PLANNER_SPEC 9.2.19.12（Phase 3-Cの決定）
- 削除の影響: kernelがruntimeでimportする。既定値はResearchの計算条件なので、値の変更・削除は研究の再現性に影響する
- 推奨: 維持（既定値も維持）

#### 4.1.9 `plannerAlternativeWhatIf.ts`（C）

- 主なexportと責務: `createPlannerAlternativeWhatIfComparison()`、`PlannerAlternativeWhatIfRequest` ほか。「比較する」のwhat-if
  （Phase 4-B）。scenarioのcomparison projection
- Production / 全体最適化 / Research / Benchmark: なし
- test: `plannerAlternativeWhatIf.test.ts`・`.composition.test.ts`、repair系test、`benchmarks/issue101PlannerAlternativeWhatIf.test.ts`、
  `domain/planner/plannerNormalCounterFastForward.test.ts` の1件（「compares the production-target Normal conflict through Planner
  Alternative」）
- 正式仕様: PLANNER_SPEC 9.2.19.7 / 9.2.19.13（記録）
- 削除の影響: `plannerNormalCounterFastForward.test.ts` の上記1件を外す必要がある。同じfileの「lets an explicit resolution of the
  production-target conflict select the other Route」がProduction（明示決定）側の振る舞いを既に検証している
- 推奨: PR-7で削除

#### 4.1.10 `plannerConflictRepairLineage.ts`（C）

- 主なexportと責務: `derivePlannerConflictRepairLineageContext()`・`plannerConflictRepairOutcomeOf()`・
  `appendPlannerConflictRepairDecision()`。保存済みlineageからの有効lineageの導出と、次のlineageへの決定の追記（9.2.19.11）
- Production: なし。永続field `ProductionPlan.conflictRepairLineage` の型（`domain/models/planning.ts`）・validator
  （`validatePlannerConflictRepairLineage()`、`domain/models/validation.ts`）・migration（`fillProductionPlanConflictRepairLineage()`、
  `domain/models/persistenceCompatibility.ts`）・Export / Importはこのmoduleを使わない。version 17のPlanの互換判定
  （`isProductionPlanCalculationCompatible()`）も使わない
- Research / Benchmark: なし
- test: 自身のtest、repair系test、`plannerNormalCounterFastForward.test.ts`（what-ifの1件の入力作成だけ）
- 正式仕様: PLANNER_SPEC 9.2.19.10 / 9.2.19.11（記録）、9.6.8、DATA_MODEL 11.1.1
- 削除の影響: 過去のPlanの読込・validation・Export / Importには影響しない（9.6.8の「過去のPlanとlineage」は永続modelの側で
  完結している）
- 推奨: PR-7で削除。lineageの永続model・validator・migrationは残す

#### 4.1.11 `index.ts`

- `export *` で10 moduleを並べるbarrelで、`domain/planner/index.ts` がさらに `export * from './alternative'` する
- Productionの到達性: barrelだけではmoduleは到達しない（tree-shakingで除かれることをbuild照合で確認）。ただし
  `workers/planner.worker.production.test.ts` は `await import('../domain/planner')` の結果に
  `createPlannerAlternativeWhatIfComparison`・`createPlannerAlternativeRepair`・`defaultPlannerAlternativeTrialBounds` が
  あることを固定している（「PR-5+ cleanupまで残る」）。`domain/planner/replacement/plannerMaterializationErrors.test.ts` は
  `import * as plannerBarrel from '..'` で共有errorの同一性を確かめる
- 推奨: PR-7ではCの5行を外し、残りのre-exportは維持する

### 4.2 Replacement Domain（`src/domain/planner/replacement/`）

| module | 行数 | 分類 | Production | 全体最適化 | Research runner | page | 直接importするtest |
| --- | ---: | --- | --- | --- | ---: | --- | ---: |
| `plannerAugmentedPreflight.ts` | 593 | B | なし | なし | 102 | benchmark | 2 |
| `plannerConflictContext.ts` | 553 | B | なし | なし | 102 | benchmark | 6 |
| `plannerConflictScenario.ts` | 315 | B | なし | なし | 102 | benchmark | 1 |
| `plannerConflictWork.ts` | 99 | B | なし | なし | 102 | benchmark | 1 |
| `plannerDeterministicMaterializer.ts` | 316 | A | GA Worker | Stage D | 116 | 3 page | 1 |
| `plannerMaterializationErrors.ts` | 48 | A | GA Worker | Stage D | 116 | 3 page | 3 |
| `plannerSearchOrigin.ts` | 129 | A | GA Worker | Stage D | 116 | 3 page | 12 |

#### 4.2.1 `plannerAugmentedPreflight.ts`（B）

- 主なexportと責務: `reassociatePlannerFixedConstraints()`、`preparePlannerAugmentedConflictPreflight()`（`O + G` を
  `temporary_augmented` で検証し、fixed constraintを再対応付け）、`preparePlannerReplacementConflictPreflight()`（その後に
  replacement set を `temporary_replacement` で検証する2段のtrial preflight。9.2.3.1 / 9.2.18）
- Production / 全体最適化: なし（全体最適化は置換済みの最終入力を `persisted` で検証する。4.4）
- Research / Benchmark: kernel（B）、D系Researchと2-C2.7-Bが `preparePlannerReplacementConflictPreflight()` を直接使う
- test: 自身のtest、`domain/planner/plannerCheckpointConflicts.test.ts`（「refuses to re-associate a fixed constraint onto a
  checkpoint conflict」。AGENTS.mdのCheckpoint conflictsが求める `checkpoint_conflict` の再対応付け拒否）
- 正式仕様: PLANNER_SPEC 9.2.3.1 / 9.2.18 / 9.5.1、AGENTS.md「Checkpoint conflicts and constrained re-search」
- 削除の影響: kernelとD系Researchが壊れ、checkpoint conflictの契約testを失う。`temporary_augmented` の唯一の生成元である
- 推奨: 維持

#### 4.2.2 `plannerConflictContext.ts`（B）

- 主なexportと責務: `createPlannerConflictContexts()`、`plannerConflictResourceKey()`・`samePlannerConflictResource()`、
  `PlannerFixedConflictConstraint`・`preparePlannerFixedConflictConstraints()`。Conflictごとのresource identityと参加者の文脈、
  user決定を保持するtransientなfixed constraint
- Production / 全体最適化: なし。9.6.9の任意の具体説明（各参加者に必要な操作・所持武器名）はPR-3で実装しておらず、
  画面はこの関数を使わない
- Research / Benchmark: D系Researchと2-C2.7-Bが `createPlannerConflictContexts()` / `plannerConflictResourceKey()` を使う。kernelが
  conflict scenario経由で使う
- test: 自身のtestと他のreplacement test、`plannerCheckpointConflicts.test.ts`（fixed constraintの準備とcheckpoint conflict）、
  `plannerNormalCounterFastForward.test.ts`（「gives the constrained conflict context no Counter-advance Normal conflict」
  「still builds a context for the production-target Normal conflict」。Issue #129の契約）
- 正式仕様: PLANNER_SPEC 9.2.3.1 / 9.5.1、9.6.9（任意の具体説明の候補）、AGENTS.md「Conflict Rules」
- 削除の影響: Researchの再現経路と、Issue #129 / checkpointのDomain契約testを失う
- 推奨: 維持（9.6.11の「`createPlannerConflictContexts()` を安易に削除候補としない」に従う）

#### 4.2.3 `plannerConflictScenario.ts`（B）

- 主なexportと責務: `preparePlannerConflictScenario()`（fresh inputと明示決定からscenarioを準備し、typed failureを返す）、
  `mergePlannerConflictScenarioResolution()`、`PreparedPlannerConflictScenario` ほか
- Production / 全体最適化: なし。9.6の明示決定集合はこのmoduleを使わない
- Research / Benchmark: kernel（B）だけが直接使い、kernelを使うResearchとbenchmarkが経由する
- test: 自身のtest
- 削除の影響: kernelが壊れる
- 推奨: 維持（kernelと同じ扱い）

#### 4.2.4 `plannerConflictWork.ts`（B）

- 主なexportと責務: `PlannerConflictWork`（`blockedBySelectedCheckpoint` を含む）、`createPlannerConflictWorks()`
- Production / 全体最適化: なし
- Research / Benchmark: kernelが型を、conflict scenarioがruntimeで使う
- test: 自身のtest
- 正式仕様: AGENTS.md「Checkpoint conflicts and constrained re-search」（required checkpoint Entryを持つTargetのRouteを置き換えない）
- 推奨: 維持（kernelと同じ扱い）

#### 4.2.5 `plannerDeterministicMaterializer.ts`（A）

- 主なexportと責務: `createDeterministicMaterializer()`、`GeneratedBuildListEntryResult`、`DeterministicMaterializationSource`、
  `DeterministicMaterializer`。transientなCandidateからdeterministicなBuildCandidate / BuildListEntryを作る共通core。生成Entry IDは
  `build-list.constrained.<hash>`（prefixはIDの値の一部）
- Production: `buildListOptimization/projectedRouteGeneration.ts`（射影起点の再構築）、`shapeConstrainedRun.ts`（形状制約付き探索の
  実行）。全体最適化のWorker bundleにある
- Research / Benchmark: Global Assignment Research、Issue #154 oracle、Alternative用materializer（B）とkernel
- test: 自身のtest（`enumerateConstrainedCandidates()` をfixtureに使う）
- 正式仕様: PLANNER_SPEC 17.12（identity）、9.2.18、AGENTS.md（generated Entry identity）
- 推奨: 維持

#### 4.2.6 `plannerMaterializationErrors.ts`（A）

- 主なexportと責務: `ConstrainedMaterializationError`（唯一のconstructor、name・code・messageはPhase 6-B2aのまま）と
  別名 `PlannerMaterializationError`
- Production: `shapeConstrainedRun.ts`。`plannerSearchOrigin.ts` も投げる
- test: 自身のtest（Planner barrel経由の同一性を含む）、`plannerSearchOrigin.test.ts`、Alternative用materializerのtest
- 正式仕様: AGENTS.md「Planner-driven Constrained Re-search」（runtime contract）
- 推奨: 維持（runtime contractを変えない）

#### 4.2.7 `plannerSearchOrigin.ts`（A）

- 主なexportと責務: `createPlannerStartSearchOrigin()`、`normalizePlannerSearchOrigin()`、`resolvePlannerSearchOriginTarget()`。
  Planner開始時点のSearch / RNG originの作成と正規化
- Production: `projectedRouteGeneration.ts`・`shapeConstrainedRequest.ts`・`shapeConstrainedRun.ts`
- Research / Benchmark: Phase 2-C*の11 module、oracle、Global Assignment、Phase 0のResearch（`plannerGlobalOptimizationResearch.ts`）。
  3本のrunnerはこのmoduleを `ssrLoadModule()` で直接読む
- 推奨: 維持

### 4.3 Search Domain

#### 4.3.1 `src/domain/search/alternative/`

| module / export | 分類 | Production（全体最適化） | Research / Benchmark | test |
| --- | --- | --- | --- | --- |
| `plannerAlternativeSearch.ts`: `createPlannerAlternativeFrontier()`・`openPlannerAlternativeSearchSections()`・`PLANNER_ALTERNATIVE_ROUTE_REGISTRATIONS`・`PlannerAlternativeSearchExecutionOptions`・`PlannerAlternativeSearchInstrumentation`（型） | A | `shapeConstrained/shapeConstrainedSearch.ts` が共有frontierを使う。Stage Dの `shapeConstrainedRun.ts` はinstrumentationの型を使う | Global Assignment、Phase 2-C* | Search test、shapeConstrained test |
| 同 `visitPlannerAlternativeCandidates()` | B | なし（Production consumerだったkernelがProductionから外れた） | Global Assignment `d0a-v1`（`materialize.ts`）、D系（6 module）、Phase 2-C*（13 module）、oracle、Planner Alternative benchmark Worker、kernel | 直接import 14 file（Search test・Research test）と、golden / parity用のtest fixture 4本。`shapeConstrainedIsolation.test.ts` がsource文字列で存在と本体を固定 |
| `plannerAlternativeCandidateFactory.ts`: `createPlannerAlternativeCandidate()` | A | frontier内で使う（GA Workerにある） | （frontier経由） | （frontier経由） |
| `plannerAlternativeTypes.ts`: 型（`PlannerAlternativeCandidate`・`PlannerAlternativeReservation`・`PlannerAlternativeSearchExtent`・`PlannerAlternativeSearchError` ほか）、`emptyPlannerAlternativeReservation` | A | Stage Dの8 module、shapeConstrained 3 module | 多数 | 多数 |
| 同 `defaultPlannerAlternativeSearchExtent`（`4 / 235 / 4`） | B | なし（PR-4以降Production callerなし。SEARCH_SPEC 5.6.8に記録済み） | Phase 2-C*のResearch module 26本（計算条件として読む）、Phase 2-C2.5-B / D2B / D2Eのbenchmark page 3本とそのBrowser Worker | 34 file（`globalAssignment/isolation.test.ts` が値を固定、Issue #101 test、oracle test、Phase 2-C*のResearch test） |
| `plannerAlternativeValidation.ts`: `assertPlannerAlternativeSearchInput()`・`normalizePlannerAlternativeReservation()`・`validatePlannerAlternativeSearchExtent()`・`collectPlannerAlternativeReservationIssues()` | A | `shapeConstrainedValidation.ts`、`shapeConstrainedRequest.ts`、`shapeRouteCheck.ts` | 多数 | Search test |
| 同 `normalizePlannerAlternativeExcludedRouteKeys()`・`isEmptyPlannerAlternativeReservation()` | B | なし | kernel・Alternative用materializer・comparison（C）、Phase 2-C*、benchmark | Search test |
| `index.ts` | - | `domain/search/index.ts` が `export *`。frontier内部（`createPlannerAlternativeFrontier` 等）は名前付きexportで公開しない | - | `shapeConstrainedIsolation.test.ts` が公開範囲を固定 |

正式仕様: SEARCH_SPEC 5.6.8（Planner Alternative Search）と5.6.9（形状制約付き探索。frontierを共有する）。5.6.8は
Issue #278の切替後もfrontier・section・route registration・Candidate factory・型・input validation・reservationの正規化を残すと定め、
entry point `visitPlannerAlternativeCandidates()` の扱いは削除PRの再監査で決めるとしている。本監査の結論は**維持（B）**である。
理由: Global Assignment Researchの `d0a-v1` 規則（design 9.1）とそのgolden、D系 / Phase 2-C*のResearch、Planner Alternative
benchmark、形状制約付き探索のisolation test（無指定時の探索が変わらないことの比較対象）が使う。名称の中立化（`PlannerAlternative*` →
中立名）は9.6.11のとおり本Issueの範囲外である。

#### 4.3.2 `src/domain/search/constrained/`

| module / export | 分類 | Production（全体最適化） | Research / Benchmark | test |
| --- | --- | --- | --- | --- |
| `constrainedCandidateFactory.ts`: `createConstrainedCandidate()`・`compareConstrainedCandidates()` | A | `projectedRouteGeneration.ts`、Planner Alternative frontier（6キー順序） | Phase 2-C*の7 module、constrained enumeration benchmark Worker | Search test |
| 同 `constrainedCandidateStableKey()` | B | なし | constrained enumeration benchmark Worker | Search test |
| `constrainedTypes.ts`: `ConstrainedCandidate`・`ConstrainedSearchOrigin`（型）、`ConstrainedSearchError` | A | Replacement Domainの3 module、Search alternative、shapeConstrained | 多数 | 多数 |
| 同 `ConstrainedEnumerationBounds`・`ConstrainedCandidateSearchInput`・`ConstrainedEnumerationSummary`、`defaultConstrainedEnumerationBounds` | B | なし | constrained enumeration benchmark（page・protocol・fixture） | `constrainedValidation.test.ts` ほか |
| `constrainedValidation.ts`: `collectConstrainedSearchOriginIssues()` | A | `plannerAlternativeValidation.ts` 経由（GA Worker） | - | Search test |
| 同 `assertConstrainedCandidateSearchInput()`・`validateConstrainedEnumerationBounds()` | B | なし | constrained enumeration benchmark fixture | Search test |
| `constrainedEnumeration.ts`（`visitConstrainedCandidates()`・`enumerateConstrainedCandidates()`）・`constrainedFrontier.ts`・`constrainedRouteBases.ts` | B | なし | B8のconstrained enumeration Browser benchmark（`ConstrainedEnumerationBenchmarkPage`・`constrainedEnumeration.worker.benchmark.ts`。記録は [B8_CONSTRAINED_ENUMERATION_BROWSER_WORKER_BENCHMARK.md](./B8_CONSTRAINED_ENUMERATION_BROWSER_WORKER_BENCHMARK.md)） | Search Domain test（`constrainedEnumeration*.test.ts`・`constrainedPreferredSourceDelivery.test.ts`・`constrainedFrontier.test.ts`・`constrainedValidation.test.ts`）、`normalScopeKeepRoute.test.ts`、`plannerDeterministicMaterializer.test.ts`、benchmark fixture test |

constrained enumeratorはPlanner Alternativeのmoduleではなく、Phase 6-B2bでSearch Domainのbenchmark / validation用に残したもの
（9.2.19.16）である。Issue #278の範囲では扱わない。注意点として、`constrainedEnumeration.worker.benchmark.ts` がexportする
`benchmarkWorkerYield()` を `plannerAlternative.worker.benchmark.ts` と `plannerGlobalPhase2C25B.worker.benchmark.ts` がimportしており
（このため2本のResearch analyzerからもconstrained enumeratorへ到達する）、constrained enumeration benchmarkを整理する場合は
このyield helperを先に分離する必要がある。

#### 4.3.3 `src/domain/search/shapeConstrained/`（A）

- 形状制約付きRoute探索（SEARCH_SPEC 5.6.9）。Productionの唯一のcallerは全体最適化Stage D（`routeGeneration.ts`・
  `routeGenerationTypes.ts`・`shapeConstrainedRequest.ts`・`shapeConstrainedRun.ts`・`shapeSearchScale.ts`。
  `shapeConstrainedIsolation.test.ts` が固定）。Global Assignment Researchは `src/domain/search/research/` のadapter経由で同じ関数を読み、
  Research用route policy tokenだけを別に持つ
- Planner Alternative Searchのfrontier・section・route registrationを共有する（seam 7 file）。このためSearch alternativeの
  A分類のexportは、形状制約付き探索が残る限り削除できない
- 推奨: 維持

### 4.4 `PlannerBuildListContext`（D）

| 項目 | 内容 |
| --- | --- |
| 定義 | `plannerTypes.ts`: `persisted` / `temporary_augmented`（`O + G`、preflight専用）/ `temporary_replacement`（`-O + G`）、full run用の `PlannerRunBuildListContext`（`temporary_augmented` を除く）、`PERSISTED_PLANNER_BUILD_LIST_CONTEXT` |
| 受け取るProduction module | `plannerValidation.ts`（`temporary_augmented` ではtemporary Entryを除いてlegacy duplicateを判定し、非 `persisted` では `validateBuildListEntryReplacements()` で配置を検証）、`plannerInitialContext.ts`、`plannerDeterministicScheduler.ts`、`plannerBeamSearch.ts`（oracle）、`productionPlanGeneration.ts`（runtime-unsupported retryで `temporary_replacement` のreplacementsからunsupportedな `G` を除く） |
| Productionでの生成 | なし。すべてのProduction callerは既定値（`persisted`）を使う。`planCreationMethod.ts` は `PERSISTED_PLANNER_BUILD_LIST_CONTEXT` を明示する |
| 全体最適化 | 使わない。Stage D' は `buildBuildListOptimizationFinalInput()` で `resolveBuildListEntryReplacement()` / `applyBuildListEntryReplacements()` / `validateBuildListEntryReplacements(…, 'replaced')` により置換済みの最終入力を作り、それを `persisted` のまま `validatePlannerInput()` と `createProductionPlanWithObserver()` へ渡す |
| bundle | 分岐のcodeは `index`・`planner.worker.entry`・`buildListOptimization.worker.entry` にある（共有moduleの一部として） |
| 生成元（非Production） | `temporary_augmented`: `preparePlannerAugmentedConflictPreflight()`（4.2.1。`preparePlannerReplacementConflictPreflight()` の第1段）。`temporary_replacement`: replacement preflightの第2段、kernel、scenario（C）、D系Research（`plannerGlobalD1/D2/D2E/D2F.ts`、`plannerGlobalPhase2C27B.ts`）、test fixture（`plannerSchedulerScenarios.ts` のScenario M、`plannerBeamOracle.ts`） |
| test | `plannerBuildListCardinality.test.ts`・`plannerCheckpointRequirements.test.ts`・`plannerDeterministicScheduler.test.ts`・`plannerPlanningTargets.test.ts`・`plannerPreferredSourcePreference.test.ts`・`replacement/plannerConflictContext.test.ts`・`alternative/plannerAlternativeWhatIf.composition.test.ts`（C）。scheduler catalogueのScenario M（`M-temporary-replacement`）はBeam / scheduler parity test（Issue #103）と、PR-2の `plannerConflictResolutionParity.test.ts` の記録digest（schema 17のcodeで記録）に含まれる |
| 正式仕様 | PLANNER_SPEC 9.2.18、DATA_MODEL 9.4.1（Build List cardinality）、AGENTS.md「Build Candidate and Build List Separation」のPhase 0-3の記録 |

削除した場合の影響:

- 通常Planner: `persisted` だけになれば、`plannerValidation.ts` の分岐と `productionPlanGeneration.ts` のretry内の再構築が無くなる。
  通常Plannerの結果は変わらない見込みだが（Productionは常に `persisted`）、`plannerConflictResolutionParity.test.ts` のScenario Mの
  digestは記録時の入力契約を前提にしており、扱いを決め直す必要がある
- 全体最適化: 影響しない（使っていない）
- Research: kernel（B）とreplacement preflight（B）、D系Researchの評価runが成立しなくなる。`temporary_augmented` は `O` と `G` を
  同時に持つ入力なので、`persisted` ではlegacy duplicateとしてfail closedする
- test: 上記のtestとScenario M、Beam / scheduler parity

判断が必要な点と推奨は8章のD-1。

### 4.5 Research / Benchmarkの利用目的

| 系統 | 主な場所 | Planner Alternative系で使うもの | 目的 |
| --- | --- | --- | --- |
| Issue #154 Phase 2-C2〜2-C2.7-B | `src/benchmarks/plannerGlobalPhase2C*.ts`、`plannerGlobalPhase2C25B/D2B/D2E.worker.benchmark*.ts`、対応page、`scripts/run- / analyze- / prepare-planner-global-phase2c*.mjs` | kernel（instrumentation含む）、Alternative用materializer、reservation、`visitPlannerAlternativeCandidates()`、2つの既定値、Search origin | 全体最適化の候補方式としてのPlanner Alternative kernel / Searchの計測・診断。RESULT JSON（`docs/PLANNER_GLOBAL_PHASE2C*_RESULT.json` 等）は凍結済みで、testが記録とcodeの整合を検証する |
| Issue #154 D系（D1 / D2 / D2C / D2D / D2E / D2F / D2GA） | `src/benchmarks/plannerGlobalD*.ts`、`scripts/run- / analyze-planner-global-d*.mjs` | full runner、trial judge、replacement preflight、conflict context、`temporary_replacement`、Alternative用materializer / search identity、`visitPlannerAlternativeCandidates()` | Phase Bの `found_R` Route集合の共存診断（[PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md](./PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md) ほか）。conflict resolution `[]` の置換set runで、Planner Alternativeの判定authorityをそのまま使う |
| Issue #154 oracle | `plannerGlobalOracle1657.ts` / `.test.ts` | `visitPlannerAlternativeCandidates()`、deterministic materializer、Search origin、2つの既定値（test） | 1,657 oracleの検証 |
| Global Assignment Research | `src/benchmarks/globalAssignment/`、GA Browser page / Worker、`scripts/run-planner-global-assignment-*.mjs` | `d0a-v1` 規則が `visitPlannerAlternativeCandidates()` と `createPlannerAlternativeSearchIdentity()`、reservation、deterministic materializer | B-2A〜D-1Cの研究。D-0Bの `d0a-v1` 記録は `materializationV1Golden.test.ts` が固定し、`d0a2-v2` はProduction Stage Dのadapterである。formal D-1Cは正式記録済み |
| Planner Alternative benchmark（Phase 3-A / 3-B） | `src/benchmarks/plannerAlternative*.ts`、`PlannerAlternativeBenchmarkPage`、`plannerAlternative.worker.benchmark*.ts` | kernel、full run errors、trial bounds、Search、reservation、Issue #101 fixture | 2つの既定値の根拠となった計測（[PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md](./PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md)）。instrumentation moduleはIssue #154 Phase 2-C2.6-A2〜A9のrunnerも読む |
| Issue #101 | `issue101PlannerAlternativeFixtures.ts`・`.test.ts`、`issue101PlannerAlternative.test.ts`、`issue101PlannerAlternativeRepair.test.ts`、`issue101PlannerAlternativeWhatIf.test.ts` | fixture: Candidate Search等のProduction authority。Phase 2 acceptance: reservation・kernel。repair / what-if test: C | 実ケース（Dragon / Fire）の回帰。fixtureはPlanner Alternative benchmarkも使う |

Issue #154 Researchのformal runは、PR-2以降のruntime（calculation schema 18）を新しい登録が必要なversion変更として開始gateで
拒否する（9.6.12のPR-2の実施記録）。したがってBを残す目的は、凍結記録を再検証するtest・goldenがCIで通ること、新たに登録した
場合にResearchを再実行できること、Researchの判定authority（kernel・trial judge・preflight）を記録時の意味のまま保つことである。

## 5. A: Production共有基盤として維持するもの

| 区分 | 維持するもの | Production利用者 |
| --- | --- | --- |
| Planner alternative | `plannerAlternativeReservation.ts`（`derivePlannerAlternativeReservation()`・`PlannerAlternativeReservationError`） | 全体最適化Stage D（`routeGeneration.ts`・`shapeRouteCheck.ts`） |
| Planner replacement | `plannerDeterministicMaterializer.ts`、`plannerMaterializationErrors.ts`、`plannerSearchOrigin.ts` | 全体最適化Stage D（`projectedRouteGeneration.ts`・`shapeConstrainedRequest.ts`・`shapeConstrainedRun.ts`） |
| Search alternative | frontier・section・route registration（`plannerAlternativeSearch.ts`）、Candidate factory、型と `emptyPlannerAlternativeReservation`、input validation・reservationの正規化 | 形状制約付き探索（SEARCH_SPEC 5.6.9）とStage D |
| Search constrained | `createConstrainedCandidate()`・`compareConstrainedCandidates()`、`ConstrainedCandidate` / `ConstrainedSearchOrigin` 型、`collectConstrainedSearchOriginIssues()` | Stage D、Planner Alternative frontier |
| Search shapeConstrained | 全体 | Stage D |
| Build List | `buildListEntryReplacement.ts` | Stage D' と採用の保存、Planner validation |
| Planner（共有） | `PlannerBuildListContext` の `persisted` と、それを受け取る共有module | すべてのPlanner実行 |

PR-1（9.6.11の表）とPR-4 / PR-5の再監査で挙げた「残すもの」（Persistenceの共有検査、source Draft CAS、`prepare_interaction`、
lineageの永続model・validator・migration）は、本監査でもProductionが使っていることを確認した（本書の対象外のため詳細は9.6.11）。

## 6. B: Research / Benchmarkのために維持するもの

| 維持するもの | 主な利用者 | 維持する理由 |
| --- | --- | --- |
| `plannerAlternativeKernel.ts`・`plannerAlternativeFullRun.ts`・`plannerAlternativeTrial.ts`（`defaultPlannerAlternativeTrialBounds` を含む） | Issue #154 Phase 2-C*・D系、Planner Alternative benchmark、Issue #101 Phase 2 acceptance | Researchの判定authority。記録とtestの再現 |
| `plannerAlternativeMaterializer.ts`（search identity、route policy token） | Global Assignment `d0a-v1`、D系、Phase 2-C*、status-only identity test | identityの値がgoldenとResearch記録に入っている。AGENTS.mdの契約test |
| replacementの `plannerAugmentedPreflight.ts`・`plannerConflictContext.ts`・`plannerConflictScenario.ts`・`plannerConflictWork.ts` | kernel、D系、checkpoint / Issue #129のDomain test | Researchの判定authority。AGENTS.mdのcheckpoint conflict契約test |
| `visitPlannerAlternativeCandidates()`、`defaultPlannerAlternativeSearchExtent`、`normalizePlannerAlternativeExcludedRouteKeys()`、`isEmptyPlannerAlternativeReservation()` | Global Assignment `d0a-v1`、D系、Phase 2-C*、oracle、benchmark、Search test | 研究の計算条件と記録の再現。形状制約付き探索のisolation testの比較対象 |
| `src/domain/search/constrained/` のenumerator・frontier・route bases・bounds | constrained enumeration benchmark、Search Domain test | Search Domainのbenchmark / validation（Issue #278の範囲外） |
| Research / Benchmarkのcode・page・Worker・script・記録 | - | 凍結記録と再現手段 |

移設（Production Domain folderからResearch専用の場所へ動かすこと）について:

- 利益: Production Domain（`src/domain/planner/`）とPlanner barrelからProductionが使わない計算が無くなり、境界が読みやすくなる
- 必要性: 低い。Productionのbundleには入っておらず（3章）、Issue #278の目的（通常Plannerの競合解決の簡素化）には不要である
- リスク: 100本超のResearch module・runner・testのimport変更、identity token・既定値・goldenの値を保つ必要、境界test
  （`isolation.test.ts` のallowlist・`plannerAlternativeBenchmarkIsolation.test.ts`・`shapeConstrainedIsolation.test.ts`）の更新、
  benchmark buildのprovenance（`benchmarkCodeSha256`）とResearch analyzerの「計測HEAD以降の変更」判定が変わる。kernelが使う
  replacementの4 moduleとSearch alternativeはProduction共有部分と同じfileにあり、file単位では切り分けられない
- 推奨: Issue #278では移設しない。行う場合はResearch基盤の整理として別Issueで扱う（10.2のPR-8候補）

## 7. C: 安全に削除できるもの

| 削除可能 | 行数 | 根拠 |
| --- | ---: | --- |
| `src/domain/planner/alternative/plannerAlternativeWhatIf.ts` | 102 | Production・全体最適化・Research runner 122本・benchmark 3 pageのどれからもsymbol単位で到達しない。Production / benchmark buildのどのchunkにも宣言が無い。PR-4でWorker / Client / Production adapterを削除済み |
| `src/domain/planner/alternative/plannerAlternativeRepair.ts` | 230 | 同上。保存APIはPR-5で削除済み。永続modelに関係しない |
| `src/domain/planner/alternative/plannerAlternativeScenario.ts` | 396 | 利用者はwhat-ifとrepairだけ |
| `src/domain/planner/alternative/plannerAlternativeComparison.ts` | 172 | 利用者はscenario（runtime）とwhat-if / repair（type）だけ |
| `src/domain/planner/alternative/plannerConflictRepairLineage.ts` | 146 | 利用者はrepairだけ。永続lineageのmodel・validator・migrationは `domain/models` にある |

合計1,046行。5 moduleはkernelより上の閉じた層で、B / Aのmoduleはいずれもこれらにruntimeで依存しない（4.1）。保存形式・
互換性への影響は無い: `ProductionPlan.conflictRepairLineage` の読込・validation・version 17の限定互換判定・Dexie / Export
migration・Export / Importはどれもこれらを使わない。

削除と同時に扱うtest（9章で詳述）:

- 削除: `plannerAlternativeWhatIf.test.ts`・`.composition.test.ts`、`plannerAlternativeRepair.test.ts`・`.composition.test.ts`、
  `plannerAlternativeRepairChain.test.ts`、`plannerConflictRepairLineage.test.ts`、`benchmarks/issue101PlannerAlternativeRepair.test.ts`、
  `benchmarks/issue101PlannerAlternativeWhatIf.test.ts`（合計2,744行。いずれも `vitest.config.ts` のNode test一覧に無い）
- 変更: `workers/planner.worker.production.test.ts`（Planner barrelにwhat-if / repairがあることの固定を、無いことの固定へ）、
  `domain/planner/plannerNormalCounterFastForward.test.ts`（what-ifの1件を外す）、
  `services/planner/plannerResultPersistenceService.buildListOptimization.test.ts`（repair artifactの型castを構造的なobjectへ）
- kernelの単体testへ移す候補: `plannerAlternativeRepairChain.test.ts` のうちrepair / what-ifを呼ばず `preparePlannerAlternativeKernel()`
  だけを検証する3件（「drops the restored X -> D from the effective input, and nothing else」「keeps the decision own conflict key under
  the ordinary merge and supersedes only the prior X -> D」「keeps every restored resolution without repair lineage (the ordinary
  what-if)」）と、2件のkernel部分（「reserves neither D nor its old resolution」「never supersedes on an expired lineage decision」の
  前半）。kernelのsupersede契約（restored resolutionのsupersede、prior fixed Entryの除外）はkernel（B）に残るので、lineageの導出を
  使わず `priorFixedBuildListEntryIds` / `priorExcludedRoutes` を直接与える形で `plannerAlternativeKernel.test.ts` へ移す。
  request-global budgetとprior fixed Entryのkernel側の検証は `plannerAlternativeKernel.test.ts` に既にある

## 8. D: 追加判断が必要なもの

### D-1 `PlannerBuildListContext` の `temporary_augmented` / `temporary_replacement`

- 事実: Productionはどちらも生成しない。全体最適化も使わない。分岐はProductionの共有moduleにあり、Production bundleにも入る。
  生成元はBのkernel・replacement preflight・D系Research・test fixture（Scenario M）である
- 選択肢:
  1. 維持する（推奨）。Bを残す限り必要であり、Production callerは常に `persisted` を渡すので通常Plannerの意味は変わらない
  2. Bの移設・退役と合わせて削除する（別Issue）。Scenario Mとそのparity digest、Beam / scheduler parity、D系Researchの評価run、
     4.4の表のtestの扱いを同時に決め、通常Planner・全体最適化の結果が変わらないことをparity testで示す必要がある
  3. 分岐だけをResearch側のwrapperへ移す。共有moduleの関数signature（validation・initial context・scheduler・Plan生成）を変える
     ことになり、通常Plannerのcodeに触れるので、Issue #278の範囲では推奨しない
- 必要な判断: Issue #154のResearch codeをmain上で再実行可能な状態に保つかどうか（Owner）。保つなら選択肢1

### D-2 Issue #101実ケースの現行Production経路でのregression

- 事実: Issue #101の実ケースを検証しているのは、Planner AlternativeのPhase 2 acceptance（B）、repair / what-ifのtest（C）、
  fixture自身のtestである。現在のProduction経路（9.6の優先候補の選択、17章の全体最適化）でこの実ケースを検証するtestは無い
- 選択肢:
  1. PR-7でCのtestを削除するだけにする
  2. PR-7（または直後のPR）で、Issue #101 fixtureに対する9.6の優先候補の選択（`createPlan()` + 明示決定集合、非選択Entryは
     実行されず作成リストに残る）のregressionを追加する。計算時間を確認してから追加する
  3. 全体最適化での検証も加える（結果が成立するかどうかは未確認であり、本監査では主張しない）
- 推奨: 選択肢2を検討する。追加するtestは9.6の既存の意味を固定するだけで、新しい仕様を作らない

### D-3 Research専用codeの配置

- 6章のとおり、Bの移設は必要性が低くリスクが高い。Issue #278では行わず、行う場合は別Issue（Research基盤の整理）とするかを
  Ownerが決める。別Issueにする場合の範囲案は10.2のPR-8候補

### D-4 2つの既定値の正式仕様上の呼称

- 事実: `defaultPlannerAlternativeSearchExtent` / `defaultPlannerAlternativeTrialBounds` はPLANNER_SPEC 9.2.19.12とSEARCH_SPEC 5.6.8で
  「Production default」として決めた値であり、PR-4以降は渡すProduction callerが無いことが両文書に記録済みである。値はResearchの
  計算条件として使われ続けている
- 選択肢: 1. 現状の記述のまま維持（推奨。名前と値を変えない）、2. 「Research / benchmarkの計算条件」へ記述を改める（docsのみ。
  名前・値・isolation testの固定は変えない）
- 推奨: 1。必要ならPR-7のdocs更新で2を行う

## 9. 削除・移設時に維持するtest / 変更するtest

### 9.1 境界test

| test | 保護している契約 | PR-7（C削除）での扱い |
| --- | --- | --- |
| `src/benchmarks/globalAssignment/isolation.test.ts` | Global Assignment ResearchとProduction全体最適化（Stage 0〜D'・採用・方式選択）の分離。Stage Dのimport allowlistが `alternative/plannerAlternativeReservation`・`replacement/plannerDeterministicMaterializer`・`replacement/plannerMaterializationErrors`・`replacement/plannerSearchOrigin` を名指しし、reservationは `emptyPlannerAlternativeReservation` か `derivePlannerAlternativeReservation()` だけ、Stage Dは `visitPlannerAlternativeCandidates()` を使わない、`d0a-v1` はPlanner Alternative Searchを使う、version・Production defaultと2つの既定値 `4 / 235 / 4`・`2 / 8` を固定 | 変更しない（C moduleを名指ししていない）。このtestはcommentも走査するので、PR-7でProduction moduleのcommentを直す際に、許可されていないmoduleのcommentへ全体最適化の関数名・概念名（`BuildListOptimization` 等）を書かない（文章では「Build List global optimization」と書く） |
| `src/workers/buildListOptimizationWorkerIsolation.test.ts` | 全体最適化Worker bundleがDomainだけに到達すること（persistence・Service・UI・benchmark・Researchへ到達しない）、Production Planner Worker protocol / Clientが変わらないこと、boundsがWorker adapterの中だけにあること | 変更しない |
| `src/domain/search/shapeConstrained/shapeConstrainedIsolation.test.ts` | 形状制約付き探索のProduction API境界。seam fieldがseam 7 fileと本moduleだけにあり、Planner Alternative Searchは渡さないこと、frontier内部を公開しないこと、`visitPlannerAlternativeCandidates()` の存在と本体（`createPlannerAlternativeFrontier({ … })` の呼び方）、Research adapter | 変更しない。`visitPlannerAlternativeCandidates()` を削除・移設する場合はこのtestを弱めずに更新する必要がある（Bなので本Issueでは行わない） |
| `src/benchmarks/plannerAlternativeBenchmarkIsolation.test.ts` | Planner Alternative benchmarkがProductionから到達しないこと、Production Planner Worker / Clientにinstrumentationが無いこと、Search instrumentationを渡すProduction callerがStage Dの `shapeConstrainedRun.ts` だけであること、kernelのinstrumentation seam、既定値の定義場所が2 moduleだけであること、benchmarkが既定値を読まないこと | 変更しない（kernel・trial・Search alternativeを名指しするがC moduleを名指ししない） |

### 9.2 その他の関係するtest

| test | 契約 | PR-7での扱い |
| --- | --- | --- |
| `benchmarks/issue101PlannerAlternativeFixtures.test.ts` | Issue #101 fixtureのRNG状態・Route・pinned ID・決定性・Issue #129後のconflict | 維持 |
| `benchmarks/issue101PlannerAlternative.test.ts` | Phase 2 acceptance（reservation、Fire alternative、到達量、full trial） | 維持（Bのkernel / reservation） |
| `benchmarks/issue101PlannerAlternativeRepair.test.ts` / `…WhatIf.test.ts` | 削除したrepair / what-ifの実ケース | 削除（D-2で現行経路のregressionを検討） |
| `domain/planner/plannerCheckpointConflicts.test.ts` | checkpoint conflictへのfixed constraintの再対応付け拒否 | 維持 |
| `domain/planner/plannerNormalCounterFastForward.test.ts` | Issue #129のNormal Counter fast-forwardとconflict context | what-ifの1件だけ外し、残りを維持 |
| `domain/models/ownedWeaponStatusLabel.test.ts` | status-only変更でsearch identityが変わらない | 維持 |
| `domain/planner/plannerConflictResolutionParity.test.ts` | `conflictResolutions = []` の入力のPR-2前後parity（Scenario Mを含む） | 維持（D-1を変える場合だけ扱いを決める） |
| `workers/planner.worker.production.test.ts` | Production Planner Workerのcalculationとadapter export、Planner barrelのDomain計算の存在 | barrelの固定をwhat-if / repairが無いことへ変える。`defaultPlannerAlternativeTrialBounds` と共有primitiveがあることの固定は残す |
| `services/planner/plannerResultPersistenceService.buildListOptimization.test.ts` | 全体最適化の採用保存が通常のPlannerResultやrepair artifactを受け付けない | repair artifactの型を使わない構造的なobjectで同じ拒否を検証する |
| `domain/planner/replacement/plannerMaterializationErrors.test.ts` | Planner barrel経由の共有errorの同一性 | 変更しない |
| `services/planner/plannerWorkerClient.test.ts` | Production Planner ClientにPlanner Alternativeのmethodが無いこと（否定） | 変更しない |
| Issue #154 Phase 2-C2.5-B / 2-C2.6-B*のResearch test 15本 | Researchのsourceがwhat-if等を呼ばないこと（`not.toMatch()` の否定regex） | 変更しない（削除後も成立し、Researchの境界を守る） |

## 10. 後続PRの分割案

### 10.1 PR-7: 到達しないPlanner Alternative計算の削除（推奨）

- 削除: 7章の5 moduleと、それだけを検証するtest 8本。`alternative/index.ts` の5行
- 変更: 9.2の3本のtest、kernelのsupersede検証の移動（7章）。comment（動作は変えない）: `plannerAlternativeKernel.ts` のheaderが
  scenarioを指す記述、`productionPlanGeneration.ts` のlineage初期値のcomment（actual repairの保存がlineageを設定するという記述）、
  `buildListEntryReplacement.ts` のrepair artifactへの言及。現行の利用者（全体最適化の採用）を指す記述へ直す
- docs: PLANNER_SPEC 9.6.11 / 9.6.12の実施記録、9.2.19と15.9.2の実装状態の注記、AGENTS.md（Issue #278とPhase 6-B2bの
  test要件の記述のうちwhat-if / repair / lineage導出を現行として読める箇所）、DATA_MODEL 11.1.1・UI_FLOWの関係箇所の注記。
  SEARCH_SPEC 5.6.8のentry pointの扱いは本監査の結論（維持）を参照する一文を加える。過去の研究文書は変えない
- 変えない: A / Bのcode、kernelの外部契約、境界testの検査内容、Production bundle、Worker protocol、Persistence、version
  （18 / 10 / 13）、Research記録
- 確認: import graphの再監査（本書の方法）、`npm run lint` / `npm test` / `npm run build`、Production buildのJS chunkがPR-7の
  前後で同一であること（3章の基準値と比べる。PR-7の基準commitで再度buildしてから比べる。commentだけの変更はminified buildに
  残らないが、chunk名が変わった場合は理由を調べる）
- 任意: Productionの非test moduleがBの計算（kernel・full run・trial・Alternative用materializer・replacementの4 module・
  `visitPlannerAlternativeCandidates()`・2つの既定値）をimportしないことを固定する境界testを加える（既存testを弱めず、強める方向）

### 10.2 PR-8候補（別Issue推奨）: Research基盤の整理

Issue #278の目的外。行う場合は次を1つのIssueとしてまとめる。

- Planner Alternative kernel・full run・trial・Alternative用materializer・replacementの4 moduleをResearch専用の場所へ移すか、
  Research（Issue #154のPhase 2-C*・D系、Planner Alternative benchmark）の退役を決めて削除するか
- 同時に `PlannerBuildListContext` の `temporary_*`（D-1の選択肢2）、`visitPlannerAlternativeCandidates()` と2つの既定値、
  Issue #101 Phase 2 acceptance、constrained enumeration benchmarkと `benchmarkWorkerYield()` の分離、Search Domainの名称中立化
  （`Constrained*` / `PlannerAlternative*`）を扱う
- identity token・既定値・goldenの値を保つこと、境界testを弱めないこと、Researchの凍結記録を書き換えないことを条件にする

### 10.3 追加削除なしで完了する場合

Cを残しても、Productionには到達せず（3章）、ResearchもBenchmarkも使わないので害は小さい。ただし9.6と矛盾する旧計算
（相手側の代替Route探索・置換・lineage追記）がPlanner barrelから公開され続け、それだけを検証するtestがCIの時間を使う。
Ownerがこの状態を選ぶ場合は、PR-6（本書）とD-1〜D-4の判断の記録をもってIssue #278を完了としてよい。

## 11. Issue #278の完了条件（提案）

1. PR-1〜PR-5（正式仕様、競合解決の切替とversion 18、競合表示、Worker / Client / UI経路の削除、Persistence経路の削除）が
   main（基準commit）に反映されている
2. PR-6（本書）がmergeされ、残存codeの分類（A / B / C / D）がPLANNER_SPEC 9.6.11 / 9.6.12から参照されている
3. 分類Cについて、PR-7で削除する（推奨）か、残す（10.3）かが決まり、削除する場合はPR-7がmergeされている。PR-7では
   Production bundle・Worker protocol・Persistence・versionが変わらず、境界testの検査内容を弱めていない
4. D-1〜D-4の判断が記録されている（PR-7のPR本文、またはIssue #278のcomment）。D-2で現行経路のregressionを追加すると決めた
   場合はそれが入っている
5. 分類A・Bのcodeは意図的に残すものとして記録されている。`alternative` という名前のcodeが残ることは未完了の理由にしない。
   Bの移設・退役を行う場合は別Issueで管理する

## 12. 本PRで変更していないもの

Production実装、RNG / Counter / Search / Plannerの意味論、全体最適化の計算、Domainの型・API、Worker protocol、Persistence、
Database / Export / Calculation schema（18 / 10 / 13）、test・fixture・期待値、研究用の計算条件・測定結果、実行ナビ、UI / UX。
本PRの変更は本書の追加と、PLANNER_SPEC 9.6.11 / 9.6.12・AGENTS.mdへの監査結果の参照の追記だけである。

## 13. PR-7の実施記録（分類Cの削除）

**基準。** `origin/main` = `6965da07f5542d228fb6ee98ad56f937275bd2a7`（PR #284、本書のmerge）。作業開始時に local `main`・`origin/main`・
HEADの一致、Working Tree clean、worktreeが本checkoutの1つだけであることを確認し、作業branch
`refactor/issue278-remove-dead-alternative-domain` を作成した。

### 13.1 再確認

- 1.4の名前による横断確認を基準commitで再実行し、分類C 5 module自身を除く利用者が7章・9章の記載どおり（削除対象test、
  `planner.worker.production.test.ts` のbarrel固定、`plannerNormalCounterFastForward.test.ts` の1件、全体最適化の採用testの型cast、
  否定のregexだけを持つIssue #154 Research test 15本と `plannerWorkerClient.test.ts`、commentだけの2 file）であることを確かめた。
  `scripts/`・`vitest.config.ts`・`vite*.ts` には参照が無い
- **新たに見つけたもの。** `src/domain/planner/alternative/plannerAlternativeKernel.instrumentation.test.ts` が、`import.meta.glob` の
  `?raw` で読んだsourceを `production['./plannerAlternativeScenario.ts']` というfile名の文字列で引き、「kernelを呼ぶ唯一のProduction
  module（scenario）はexecution optionsと共有budgetだけを渡す」ことを固定していた。1.4の確認はsymbol名を探すのでfile名だけの参照を
  拾わず、9章の表にも無かった。削除後は「走査範囲でkernelの関数を呼ぶのはkernel自身だけ」を固定する形に直した（範囲は同じglob。
  callerが無くなった事実を固定するので、検査は弱めていない）
- 削除後に型検査（`tsc -b`）が通り、Planner barrel（`domain/planner`）のruntime exportに削除した12関数が残らないことをtestで固定した
  （名前ではなく形で照合。削除前のmainで同じ照合が12件すべてを検出することを確かめてから削除した）

### 13.2 削除・変更したもの

| 区分 | 内容 |
| --- | --- |
| 削除したmodule | 7章の5 module（合計1,046行）と、`alternative/index.ts` のそれらのre-export 5行 |
| 削除したtest | 7章の8本 |
| kernel testへ移したもの | `plannerAlternativeRepairChain.test.ts` のうちkernelだけを検証する部分（7章の候補3件と2件のkernel部分）。lineageの導出を使わず、`priorFixedBuildListEntryIds` / `priorExcludedRoutes` を値で与える。`derivePlannerConflictRepairLineageContext()` が元のtestで返していた値（有効なlineage: prior fixed = D / E、prior除外 = F / Zの現在Route。失効したlineage: prior fixed = A / E、prior除外 = D / F / Zの現在Route）をそのまま書いた |
| 変更したtest | `planner.worker.production.test.ts`（barrelに削除したcalculationが無いことと、kernel・試行上限・reservation・共有primitiveが残ること）、`plannerNormalCounterFastForward.test.ts`（what-ifの1件を外す。conflict contextの2件と明示決定の1件は残る）、`plannerResultPersistenceService.buildListOptimization.test.ts`（repair artifactの型castを構造的なobjectへ。拒否の条件は同じ）、`plannerAlternativeKernel.instrumentation.test.ts`（13.1） |
| 追加したtest | `src/benchmarks/issue101OrdinaryConflictResolution.test.ts`（13.4のD-2） |
| commentを直したProduction module | `plannerAlternativeKernel.ts`・`plannerAlternativeFullRun.ts`・`plannerAlternativeTrial.ts`（削除したscenario / what-if / repairを現在の利用者として書いていた記述）、`replacement/plannerConflictScenario.ts`、`productionPlanGeneration.ts`（lineage初期値）、`buildList/buildListEntryReplacement.ts`（repair artifactを現在の利用者としていた記述）、`models/planning.ts`（`conflictRepairLineage` のdoc）。動作は変えていない |

kernelへ移した検証で、元のtestのcommentが述べていた「D2 = Reset 11 / Reset 12 / Reset Skills 7」というRouteの形は、実際のkernelの
found Candidate（Fの所持武器を起点にSkill 7でReset Skillsする1操作のRoute）と一致しなかった。元のtestはRouteの形を固定して
いなかったので、移した検証でも固定せず、commentからその記述を外した。kernelの意味と期待値は変えていない。

### 13.3 Production bundle・benchmark build

基準commitと変更後で、同じ環境（Node 24.19.0、npm 11.17.0、Vite 8.3.0、`VITE_APP_BUILD_ID` 未設定、同じ `vite.config.ts`）の
`vite build` を比較した。

- 通常のProduction build（既定のminify）: 7つのJS chunk、CSS、`index.html` のSHA-256がすべて一致した（chunk名は3章の基準値と同じ）
- `--minify false` のProduction build: `index` と `buildListOptimization.worker.entry` だけが異なり、差分は
  `applyBuildListEntryReplacements()` のJSDoc commentの2行（13.2で直したcomment）と、それによるchunk名の違いだけだった
- benchmark build（`vite.benchmark.config.ts`）: 成功した。異なるのは、build provenance（`__PLANNER_GLOBAL_BENCHMARK_BUILD__` の
  `commit`・`uncommittedBenchmarkCode`・`benchmarkCodeSha256`。`src` 全体のhashを含むので、testやcommentの変更でも変わる）を埋め込む
  chunkだけであり、provenanceとchunk名を正規化すると全fileが一致した

### 13.4 分類Dの判断

PLANNER_SPEC 9.6.12の「分類Dの判断（PR-7で確定）」に記録した。

- D-1 `temporary_*`: 維持（8章の選択肢1）
- D-2 Issue #101の現行経路のregression: 通常CIへ追加（8章の選択肢2）。fixture構築（Candidate Search 2回）が約1.5秒、各Planner実行が
  約30ms、test file全体で約3秒であり、timeout延長・skipは無い。明示決定の無いDraftの3つの競合（Gogma / Skill / Normal、参加者は火・龍）、
  3つのどの競合で龍・火のどちらを優先しても決定がその競合だけに記録され残る2つが結果から外れること、優先した登録済みRouteだけが
  実行されてその目標武器が完成すること、他方のEntryが `resource_conflict` で今回作成されず作成リストに残ること、generated Entry・置換・
  lineageが無いこと、`conflictResolutionOutcome` と保存時の形・完成の検査が通ること、計算が `incomplete` でないこと（`exhausted`、
  完成1 / 2）を固定した。期待値は現行codeでfixtureから再現した値である。旧repairのPlanの値を流用せず、競合の解消や全Target完成を
  前提にしていない。全体最適化での検証（8章の選択肢3）は加えていない
- D-3 Research専用codeの配置: Issue #278では移設しない（10.2は別Issueの範囲案として残す）
- D-4 2つの既定値: 名前・値・定義場所を維持し、PLANNER_SPEC 9.2.19.12とSEARCH_SPEC 5.6.8へ「現在はResearch / benchmark / testの
  計算条件で、Productionからは使われない」ことを注記した

### 13.5 Issue #278の完了条件（11章）の状況

1〜5はすべて、本PRのmergeで満たされる見込みである（3: 分類Cの削除。Production bundle・Worker protocol・Persistence・versionは
変わらず、境界test 4本の検査内容は変えていない。4: D-1〜D-4の記録。5: 分類A・Bを意図的に残すものとして記録）。Issue #278の範囲で
残る実装作業は無い。分類Bの移設・退役などは10.2のとおり別Issueの候補である。
