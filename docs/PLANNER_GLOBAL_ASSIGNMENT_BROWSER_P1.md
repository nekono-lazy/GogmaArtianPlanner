# Global Assignment Browser Worker実行基盤とsynthetic検証（Production準備 P-1）

Refs #154。**Research記録・非formal**。正式なProduction仕様（REQUIREMENTS / PLANNER_SPEC / SEARCH_SPEC / DATA_MODEL / UI_FLOW）、Domain契約、
D-1Cの登録条件・正式RESULTは変更していない。設計は [P-0設計](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md)（以下「P-0」）に従う。

## 1. 目的

P-0 §16.1のP-1として、D-1Cで正式acceptanceされたGlobal Assignmentの計算列（materialization → Phase D'）を、Research専用のBrowser Dedicated Workerで
実行する基盤を作り、合成データ（synthetic）と実Browserの基本動作で検証した。**実Export（43 Target / 1,766物理操作）での実行・性能計測はP-2で行い、本PRでは開始していない。**
本PRの成果は「Browser Worker基盤とsynthetic検証が成立したこと」であり、Browserでのsemantic parity・性能・合否は主張しない（§15）。

## 2. 基準と作業HEAD

| 区分 | 値 |
| --- | --- |
| 基準main | PR #256 merged `b2d0d7dfb94617b4a25abcbab95afabe7094a7ac`（作業開始時に `main` = `origin/main` = HEAD、Working Tree clean、stash / 追加worktreeなしを確認） |
| branch | `research/global-assignment-browser-p1` |
| 実装commit | `f33da7b24c6eb72f7a25f4ee163b77a43f0bb9af`（基盤・test一式） |
| 修正commit 1 | `7de10bb386499b8fb3e10276f698773cffbbf94b`（実Browser確認で見つかった2件: settle時の未応答ping、375px幅の横はみ出し。§12.4） |
| 修正commit 2 = **実Browser確認のmeasurement HEAD** | `43820f01b7a4d4930d08b8508338ebec9439d76f`（settle後にchained pingを送らない。§12.4） |
| 実Browser確認のbuild provenance | commit `43820f0…`、`uncommittedBenchmarkCode: false`、benchmark code SHA-256 `e835126e4201eae3f4d78a747b3adb046626b096ea13bb233b7e65da8817373d` |
| 記録文書commit | `e38fc710b4cc0244ffa1e93e910008a90a491d4d`（docs-only。PR #257 Required fixの修正前HEAD） |
| Required fix commit = **Required fix再確認のmeasurement HEAD** | `4890e036fc1495e553e63871f0284bbe5b1b59e2`（cancel後のrequest送信防止、不正Worker応答のfail closed。§17） |
| Required fix再確認のbuild provenance | commit `4890e03…`、`uncommittedBenchmarkCode: false`、benchmark code SHA-256 `d3d97e06b27a36f703bc80d1c040f521384d9343afc5ed62242df226730100e0` |

本書はdocs-only commitとして上の後に追加する（`docs/` は `BENCHMARK_CODE_PATHS` に含まれないので、benchmark code SHA-256は変わらない）。§17の追記もdocs-only commitで行った。
§12・§13の実Browser結果はmeasurement HEAD `43820f0` のbuildのもので、Required fix後に再確認した範囲は§17.5に分けて記す。

## 3. 実装ファイル一覧

すべてResearch codeで、通常アプリからは到達しない。Production file（`src/{app,components,db,domain,services,stores,workers,pages,presentation,data}/**`、`src/*.{ts,tsx}`、
`vite.config.ts`、`index.html`）の変更は **0件**。既存Global Assignment計算module・Node runner script・`isolation.test.ts`・`benchmark.html`・`BenchmarkApp.tsx`・
Phase 2-A等の既存harnessも変更していない。

| file | 役割 |
| --- | --- |
| `src/benchmarks/globalAssignment/browser/globalAssignmentBrowserProtocol.ts` | `gab_` protocol（version `global-assignment-browser:1`）の型・guard・request検証、環境probe / progress / result型 |
| `.../globalAssignmentBrowserStages.ts` | 環境非依存のfirst / fresh stage（D-1A子processと同じ計算列。§5） |
| `.../globalAssignment.worker.benchmark.ts` | Worker controller（1 Worker 1 run、request検証、heartbeat / slice計測、cooperative cancel、終了message 1件） |
| `.../globalAssignment.worker.benchmark.entry.ts` | Worker entry |
| `.../globalAssignmentBrowserWorkerOptions.ts` | entryが注入する依存（`ProductionRngEngine`、`globalResearchInputFromExport(json, 1_000)`、`registeredD1cConditions()`）。entryとtestが同じものを使うため1か所に置いた（P-0 §7.1に無いfile。§14） |
| `.../globalAssignmentBrowserHarness.ts` | main-thread harness（P-0 §7.8 C1〜C9のrequest lifecycle） |
| `.../globalAssignmentBrowserRunner.ts` | logical runの実行（first → terminate → fresh → terminate、C10、再hash、Entry集合の再検査、lifecycle、ping、memory、JSON export） |
| `.../globalAssignmentBrowserJudgement.ts` | logical runの判定（P-0 §12.1） |
| `.../GlobalAssignmentBrowserBenchmarkPage.tsx`、`.../main.tsx` | benchmark画面とpage entry |
| `.../globalAssignmentBrowserTestFixture.ts` | test専用（合成scenario、Engine factory、D-1A直接呼出し列、Worker double） |
| `.../*.test.ts(x)`（8 file、79 test） | protocol 6、stage 11、controller 13、harness 19、runner 19、判定 3、page 2、`browserIsolation.test.ts` 6（Required fix前は64 test: protocol 5、harness 16、runner 9、page 1。§17.4） |
| `benchmark-global-assignment.html` | 独立HTML entry（repo直下） |
| `vite.benchmark.config.ts` | `rollupOptions.input` を `{ benchmark: 'benchmark.html', globalAssignment: 'benchmark-global-assignment.html' }` に、`BENCHMARK_CODE_PATHS` に新HTMLを追加 |
| `.gitignore` | `dist-benchmark` を追加 |

## 4. Browser専用entry構成

```text
benchmark-global-assignment.html
  -> src/benchmarks/globalAssignment/browser/main.tsx（ThemeProvider + page）
     -> GlobalAssignmentBrowserBenchmarkPage -> runner -> harness
        -> new Worker(new URL('./globalAssignment.worker.benchmark.entry.ts', import.meta.url), { type: 'module' })
           -> attachGlobalAssignmentBrowserWorker(self, globalAssignmentBrowserWorkerOptions())
              -> controller -> runFirstStage() / runFreshStage()
```

- benchmark build（`npx vite build --config vite.benchmark.config.ts`）は `dist-benchmark/benchmark.html` と `dist-benchmark/benchmark-global-assignment.html` を出力し、
  Workerは `assets/globalAssignment.worker.benchmark.entry-*.js`（約746 kB）になった。build provenance（`__PLANNER_GLOBAL_BENCHMARK_BUILD__`）はWorker bundleにも埋め込まれる（確認済み）
- 通常build（`vite.config.ts`、`index.html`、`dist/`）は変更なし。通常 `dist/` の検査は §11
- page・main threadはExportを **decode・JSON parse・検証しない**。byte列を読んでSHA-256（name / bytes / SHA-256）を求め、`File` をWorkerへ渡すだけ
  （`File` のstructured cloneができない環境ではbyte列をtransferする。§12でChrome 154は `File` のcloneが可能）
- console API `globalThis.globalAssignmentBrowserBenchmark`（`exportInfo` / `conditions` / `environment` / `probe` / `runLogicalRun` / `cancel` / `ping` / `running` /
  `current` / `records` / `exportJson` / `clear`）はpageがmountされている間だけ存在する（P-2の外部driver用）

### 4.1 protocol（P-0 §7.3）

| 方向 | message |
| --- | --- |
| main → Worker | `gab_run`（`protocolVersion`、`requestId`、`role`、`exportPayload`（`blob` / `array_buffer`）、`exportIdentity`、`entrySet`、`execution`）、`gab_cancel`、`gab_ping` |
| Worker → main | `gab_ready`（環境probe）、`gab_accepted`、`gab_progress`、`gab_heartbeat`、`gab_cancel_ack`、`gab_pong`、`gab_result`、`gab_cancelled`、`gab_error` |

- run requestのfieldは上の8個だけ。条件・window・規則・budget・期待hash・D-0C / D-1C identity・RESULTのfieldは型にも検証にも無く、余分なfieldは計算前に `invalid_request` で拒否する
  （型レベルの一致も `browserIsolation.test.ts` で固定）
- firstは `entrySet: null` 必須、freshはEntry集合必須。不正なversion / role / payload / identity / execution optionは計算前に拒否し、そのWorkerは消費しない
- 1 Worker 1 run。同じrequestIdの2回目は `duplicate_request`、別requestIdの2回目は `worker_already_used`
- 全messageがprotocol versionを持つ。main threadは形の不正な `gab_` messageを解釈せず、実行中requestを `worker_error`（`protocol_violation`）でfail closedする

## 5. stage moduleとNode（D-1A）の計算列

| # | first | fresh |
| --- | --- | --- |
| 1 | `readExport()` → SHA-256（decode前のbyte列）→ main threadの観測値と照合（不一致は計算前に `export_changed`） | 同じ |
| 2 | `new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })`（Node `Buffer.toString('utf8')` 互換）→ `JSON.parse` → `buildInput(json)`（Worker: `globalResearchInputFromExport(json, 1_000)`） | 同じ（自分で再構築） |
| 3 | `createEngine()`（Engine A）→ `runMaterializationSmoke(input, globalResearchDependencies(A), { conditions: materialization })`（Phase 0 → A → B / C → D） | `createEngine()` → `createGlobalAssignmentContext(input, globalResearchDependencies(engine))`（自分のPhase 0。refuseなら `fresh_phase0_refused`） |
| 4 | materialization semantic SHA-256 = `sha256(JSON.stringify(semantic))` | Entry集合を `d1aEntrySetIssues()` で自分の観測（build commit、Export、CalculationContext、Engine、再計算したfingerprint）と照合（不合格は `entry_set_refused`） |
| 5 | handoffが `all_materialized` なら `createD1aEntrySet(handoff, …)` | `handoffFromEntrySet(set, 自分のPhase 0)` |
| 6 | `verifyPlannerCandidate(input, handoffs[0], globalResearchDependencies(createEngine()), { researchMaxPlanSteps })`（新しいEngine B） | 同じ（新しいEngine） |
| 7 | verification semantic SHA-256 | 同じ |

- 条件はcallerから受け取るだけで、Worker entryは `registeredD1cConditions()` の `materialization` / `verification` を渡す（requestからは渡らない）。Vitestだけが別の条件を注入する
- PlannerInputの `options.maxPlanSteps` は検証用の1,000のまま、Phase D'には登録値のResearch maxPlanSteps 20,000を `verifyPlannerCandidate()` へ渡す
- verification budgetが1でなければ計算前に拒否（`condition_refused`。D-1C runnerと同じく1 run 1候補）
- 時計・SHA-256・yield・cancel・progress・Engine生成・入力構築はすべて注入（stage moduleは時計・file・random・`crypto.subtle` を直接読まない。isolation testで固定）

D-1A runnerとの違い（P-0 §6.2の指定どおり、または本PRで決めたこと。§14）:

- D-0C identityの照合を持たない。materializationの結果をそのままPhase D'へ渡し、記録値との比較はP-2の事後判定で行う
- handoffが0件（Phase 0 / Aの `unsupported_input`、候補なし、structural searchの未完了・cancel、fail-closed）ならPhase D'を行わず、materializationの型付きoutcomeをそのまま記録する
- handoffが2件以上（verification budget 1を超える）は最初の1件だけを検証し、integrity issueとして記録する。handoffのEntry本体とsemantic recordのEntry fingerprintが食い違う場合、
  materialization semantic recordが自分のintegrity issueを持つ場合もintegrity issueとする（D-1Aの `compareD0cMaterializationIdentity()` のうち、期待値を要しない自己整合の部分）
- Entry集合はfirstのhandoffが `all_materialized` のときだけ作る（P-0 §7.4）。`repositoryHeadSha` にはgitの観測でなくbuild provenanceのcommit（benchmark buildで無い場合は固定文字列
  `no-benchmark-build-commit`）を入れる。Entry集合のSHA-256はfileを書かないので `JSON.stringify(entrySet)` に対して取る（D-1Aのfile textは末尾改行付き。環境依存値であり判定に使わない）

## 6. synthetic semantic parity

既存のGlobal Assignment合成fixture（`materializationScenario()` と同じ表Engine。実データなし、実Target / 武器IDなし）を使い、合成Exportは「合成PlannerInputのJSON byte列」とした。
`globalAssignmentBrowserStages.test.ts` で次を固定した。

| 確認 | 結果 |
| --- | --- |
| stage moduleの結果と、D-1A子processの呼出し列をtest内に直接書いたもの（`d1aReferenceRun()`。別の時計を使う）の完全一致 | materialization semantic record（`JSON.stringify` 文字列）、そのSHA-256、Entry集合、Entry fingerprint、first / freshのverification semantic recordとSHA-256、freshのPhase 0集合が **全て一致** |
| 時計・yieldを変えた再実行 | semantic SHA-256・Entry集合は不変、時間だけが変わる |
| Engine・dependencyの構築順序 | first: 入力構築 → Engine 1（materialization）→ … → Engine 2（Phase D'。開始時点でEngine 2の予測回数0、以後Engine 2だけが予測）。fresh: 入力構築 → Engine 1（Phase 0）→ Engine 2（Phase D'） |
| maxPlanSteps | PlannerInput 1,000、Phase D'の `conditions` / final input / termination limits は20,000 |
| 条件の出所 | `registeredD1cConditions()` を渡すと、resultとmaterialization semantic recordの条件が登録値と一致 |
| UTF-8 decode | BOM付き・不正byte・末尾で切れた多byte列・日本語でNode `Buffer.toString('utf8')` と一致。BOMは保持される |
| 型付きoutcome | Phase 0 `unsupported_input(no_planning_target)`、Planner rejection（Research maxPlanSteps 1で `max_plan_steps_reached`）、Phase Aの `scan_cancelled`、Plannerの `unmeasured(cancelled)` がそのまま記録され、独自の分類で上書きされない |
| 拒否 | Export SHA不一致・不正JSON・入力構築失敗・verification budget 2・freshのPhase 0拒否・改変したEntry集合・別build commit・Entry集合なしは計算前に型付きで拒否 |
| integrity | candidate上限3（test用）で2 handoff → 1件目だけ検証し、integrity issue → 判定は `invalid_run_integrity` |

Worker controller経由でも（`globalAssignment.worker.benchmark.test.ts`）stage moduleと同じsemantic SHA-256になり、Worker entryと同じ依存（`globalAssignmentBrowserWorkerOptions()`）で
最小合成Exportを計算すると、ProductionRngEngine・maxPlanSteps 1,000・登録条件・Phase 0 `unsupported_input` が記録される。

**実Exportでのsemantic parity（Node D-1A・D-1C公開RESULTとの一致）は未確認であり、P-2で判定する。**

## 7. first / freshの独立性

- first / freshは別のharness・別のWorker（別realm・別heap・別Engine・別PlannerInput）。firstのWorkerをterminateしてからfreshのWorkerを作る（runner testでWorker作成時に前のWorkerがterminate済みであることを確認）
- freshは自分でExportを読み、自分でPlannerInputとPhase 0を作る。firstから受け取るのはEntry集合だけで、main threadが `d1aEntrySetIssues()` で検査してから渡し、fresh Worker自身も再検査する
- logical runごとにfirstからmaterializationをやり直し、前のlogical runのEntry集合・結果・messageを使わない（runner test: 2 logical runで4 Worker、request ID別、fresh 2のEntry集合 = first 2の結果、semanticは1回目と一致）

## 8. cancel C1〜C10（P-0 §7.8）

安全保証はmain threadのrequest lifecycle（`running` / `cancelling` / `settled`）で行い、Workerのcancel flagは補助（best effort）に留めた。harnessは `audit()` で
requestごとの `cancelAccepted` / `settleCount` / `ignoredSettleAttempts` / `adoptedResults` を返し、testはそれを直接assertする。

| # | 実装 | test（`globalAssignmentBrowserHarness.test.ts` ほか） |
| --- | --- | --- |
| C1 | `cancel()` は同じ同期処理で `running` → `cancelling` にし受付時刻を記録してから `gab_cancel` をpost | 「C1 / C3 / C5」 |
| C2 | `cancelling` で届いた `gab_result` はpayloadを保持せず捨て、到着時刻（`ignoredResultAfterCancel`）だけ記録 | race 1・2・3（settlementにpayloadの文字列が含まれないことも確認） |
| C3 | `cancelling` から `running` へ戻る経路が無い（progress・ack・再cancelで不変） | 「C1 / C3 / C5」 |
| C4 | `cancelling` は最初の終了message（`gab_cancelled` / 捨てた `gab_result` / `gab_error`）で `cancelled` | race 1〜4 |
| C5 | cancel受付でwall timerを止めgrace timerだけを動かし、超過で `terminate()` → `cancelled_terminated` | race 5、実Browser（§12） |
| C6 | settleはrequestごとに1回（2回目以降は `ignoredSettleAttempts`）、settle直後にterminate。未応答pingもsettle時にlost | 「C6」、全race |
| C7 | settle後・未知requestIdのmessageは適用せず `lateResponses` | race 3・4・5・7、timeout |
| C8 | settled（cancellingも）requestへの `cancel()` は何もせず `false`、`gab_cancel` もpostしない | race 6 |
| C9 | 1 harness = 1 Worker = 1 request（2回目の `run()` は拒否） | lifecycle test、race 7 |
| C10 | runnerは `completed` かつintegrity issueなし・Entry集合ありのfirstからだけfreshを起動 | `globalAssignmentBrowserRunner.test.ts`（Phase 0未到達、Worker error、`export_changed`、再hash不一致、環境拒否、cancel、page離脱で fresh `not_run`。Required fix後はWorker間・fresh起動前のcancelも。§17） |

PR #257 Required fixで、requestがまだ無い段階（Worker作成前・起動中・main threadのExport読込み中）のcancel / page離脱でもrequestを送らないことをrunner側で保証した（§17.2）。
C1〜C9（harnessのrequest lifecycle）は変更していない。

native `error` / `messageerror`（`cancelling` 中を含む）、timeout、`pagehide` / dispose、postの失敗（structured clone不可）、不正形式の応答もそれぞれtestで1回だけsettleする。

## 9. 競合テスト8ケース（P-0 §16.1）

scripted Worker（Workerが送信済みのmessageをmain threadへいつ届けるかをtestが制御する）で再現した。**全ケースで「cancelを受け付けたrequestから採用された結果 = 0件」「requestごとのsettle = ちょうど1回」をassertした。**

| # | ケース | 結果 |
| --- | --- | --- |
| 1 | Workerが `gab_result` を送信済み（未配送）でcancel → 配送 | `cancelled`（`ignored_gab_result`）、payload不保持 |
| 2 | `cancelling` 後に同じrequestIdの `gab_result` | 採用しない、`cancelled` |
| 3 | `gab_cancel_ack` より先に `gab_result` | `cancelled`、後のackは `lateResponses` |
| 4 | cancel後に `gab_cancelled`（`gab_error` の場合も） | `cancelled`、後の結果は `lateResponses` |
| 5 | cancel grace超過 | `terminate()`、`cancelled_terminated`、以後のmessageは `lateResponses`（wall timerは停止済み） |
| 6 | settled（`completed`）requestへのcancel | `false`、`gab_cancel` なし、採用済み結果は不変 |
| 7 | 前requestのmessageが次runの開始後に届く | 旧harnessでも新harnessでも適用されず `lateResponses` |
| 8 | cancel後に新しいlogical run | 実controllerをin-processで動かすrunner test。cancelしたrunは採用0・settle 1・fresh未起動、次のrunは `browser_nonformal_conditions_met` で、semanticはcancelの無いrunと一致し、前runのEntry集合を使わない |

## 10. Research isolation

`browserIsolation.test.ts`（P-0 §13.2）で固定した。既存 `isolation.test.ts` は変更していない（browser folderはその非再帰globの対象外）。

1. Production scope（除外patternなし）のどのfileも `globalAssignment/browser`・`gab_`・`global-assignment-browser`・`benchmark-global-assignment`・browser moduleのexport名（40個超）を含まない
2. browser moduleのimport先は同folder、Global Assignment runtime module、`plannerGlobalOptimizationResearch` / `plannerGlobalBrowserEvidence`、Domainだけ（React / MUI / theme / CSSはpageとentryだけ）。
   `src/workers` / `services` / `db` / `pages` / `components` / `stores` を直接importしない
3. `indexedDB|Dexie|appDatabase|localStorage|sessionStorage|caches.|serviceWorker|fetch(` を含まない
4. oracle・過去RESULT・JSON import・UUID・40〜64桁hex・fnv1a32 literal・`Math.random` / `randomUUID` を含まない
5. Engineは `new ProductionRngEngine()` だけ（Fake Engine・table Engine・raw block cache・profilerなし）。計算を呼ぶのはstage moduleだけで、main thread（page / harness / runner）は計算もExportのparseもしない
6. run requestの型に条件・期待hash・登録のfieldが無い（型レベルの等価性と、`GabRunRequest` 定義のsource検査）
7. 通常 `vite.config.ts` は新HTMLを参照せずCOOP / COEPを持たない。`index.html` は無関係、`benchmark.html` は従来どおり
8. Production Worker protocol（`plannerWorkerContracts.ts`）・`planner.worker.ts`・`search.worker.ts`・`BenchmarkApp.tsx`・`benchmark.tsx` にGlobal Assignment Browserの識別子が無く、Production PlannerのWorkerはtimer yieldのまま

**Dexieへの推移的依存（P-0 §4.3）**は切断していない。`plannerGlobalOptimizationResearch.ts` → `importExportValidation.ts` → `productionPlanRepository.ts` → `AppDatabase.ts` の連鎖でWorker bundleにDexieと
`new AppDatabase()` が含まれる（bundleにDexieの文字列を確認）。実Browserでrun前後のIndexedDBが空のままであることを確認した（§13）。Production依存コードは変更していない。

## 11. 通常build / benchmark build

| 確認 | 結果 |
| --- | --- |
| `npm run build` | 成功 |
| 通常 `dist/` の識別子検査 | `gab_`、`global-assignment-browser`、`globalAssignment`、`GLOBAL_ASSIGNMENT`、`GlobalAssignment`、`runMaterializationSmoke`、`verifyPlannerCandidate`、`benchmark-global-assignment`、`registeredD1cConditions`、`research.global` が **全て0 file** |
| `npx vite build --config vite.benchmark.config.ts` | 成功。`benchmark.html` と `benchmark-global-assignment.html` の2 entry、既存の全benchmark Worker（Skill Identification、B5、B8、Planner Alternative、Phase 2-A、2-C2.5-B / D2-b / D2-e）も出力 |
| 既存benchmark shell | 実Chromeで `benchmark.html` が従来どおり表示（8 harnessの選択、既定C5-E2C8、page error 0）。§12 |
| `dist-benchmark/` | `.gitignore` に追加。commitしていない |

## 12. 実Browser確認（PC Chrome、非formal）

### 12.1 環境と方法

| 項目 | 値 |
| --- | --- |
| OS / machine | Windows 11 Pro 10.0.26200、AMD Ryzen 7 9700X 8-Core（`hardwareConcurrency` 16）、RAM 31.1 GiB（`deviceMemory` 32はChromeの丸め値）。開始時のCPU負荷 約14% |
| Browser | Google Chrome 154.0.8037.98（V8 15.4.80.20）。**`--headless=new`**、専用の一時profile（scratchpad、確認ごとに作り直し）、`--remote-debugging-port` でCDP操作。user agentは `HeadlessChrome/154.0.0.0` |
| serving | benchmark buildを `vite preview --config vite.benchmark.config.ts` で配信。非isolated `http://127.0.0.1:4179/`、isolated（`BENCHMARK_CROSS_ORIGIN_ISOLATED=1`、COOP / COEP付与をcurlで確認）`http://127.0.0.1:4180/`、通常アプリ `dist/` を `http://127.0.0.1:4181/` |
| 入力 | **実Exportは使用していない**。Repository内のfactoryで作った合成ファイルだけ: 最小合成Export（schema 13、初期RNG state・既定設定・空collection、973 bytes、SHA-256 `1502661c…02615`）、不正JSON（`{"broken":`）、`{}`、同期decode用の60,000,010 byteの合成JSON（Exportではない） |
| driver | 外部Node（v24.19.0）CDP script。commitしない（D2-e等と同じ扱い）。SHA-256: 主driver `3ae26a99…93923`、shell確認 `82e0590a…377c3`、layout確認 `82f9f9d2…0e4` / `0bb92882…774c`、button確認 `69a7d429…8bcc`。計算はpageとWorkerだけが行い、driverはfile選択（`DOM.setFileInputFiles`）とconsole APIの呼出し・観測だけ |
| locale | `navigator.language` `ja`、`Intl` locale `ja`（main / Worker） |
| 記録 | raw JSON（合成入力のみ）を git-ignoredな `.local/global-assignment-browser-p1/` に保存。実施日時 2026-10-13T16:39Z（UTC）前後 |

### 12.2 結果（measurement HEAD `43820f0` のbuild）

| # | 確認項目 | 結果 |
| --- | --- | --- |
| 1 | 非isolatedでのWorker起動 | ready 約26〜36 ms、environment probe: secure context true、`crossOriginIsolated` false、Web Crypto / MessageChannel / structuredClone / TextDecoderあり、Worker realmの `performance.memory` なし、環境issue 0 |
| 2 | isolatedでのWorker起動 | ready 約28 ms、`crossOriginIsolated` true（main / Worker）、環境issue 0 |
| 3 | Worker readyと環境probe | engine `production-rng:c5-e7`、build commit `43820f0…`（page・Workerとも）、locale `ja` |
| 4 | `File` のstructured clone | 可能（clone後も `File`）。全runで `blob` transportを使用 |
| 5 | 不正JSON | first `worker_reported_error`（`input_build_failed` @ `json_parse`）→ `unmeasured(first, process_failure)`、fresh未起動 |
| 5' | Export検証失敗（`{}`） | `input_build_failed` @ `input_build`（`appName` 不正）→ 同上 |
| 6 | 不正requestの拒否（同じbuildのWorker scriptを直接起動） | 余分なfield `conditions` / `expectedSemanticSha256`、protocol version 0、Entry集合なしのfresh、role `second` の5件が `invalid_request`。その後の `gab_ping` に `gab_pong`、valid run（identity不一致）は受理後 `export_changed`、2件目のrunは `worker_already_used` |
| 7 | 合成入力での型付き停止 | 最小合成Export: first `completed`、materialization outcome `unsupported_input(context, no_planning_target)`、Phase D'なし、fresh未起動（Entry集合なし）、判定 `browser_nonformal_phase_d_prime_not_reached`。PlannerInput maxPlanSteps 1,000、条件source `registeredD1cConditions`（Research maxPlanSteps 20,000、budget 1）、CalculationContext `unknown-initial` / Master 4 / `production-rng:c5-e7` / schema 17 |
| 8 | ping / pong | probeのping 約0.2〜0.3 ms。chained ping付きrunでcount 3 / lost 1（lost 1はsettle時点で未応答だったpingで、settle後のpingは送らない） |
| 9 | cancel / terminate | (a) 開始直後のcancel: Workerが `gab_cancel_ack`（受付から約6 ms）→ `gab_cancelled`、`cancelled`。(b) grace 1 ms: 同じく `gab_cancelled` が先に届き `cancelled`。(c) **60 MB合成JSONの同期decode中のcancel（grace 1 ms）: Workerはackできず（ackなし）、grace超過でterminate → `cancelled_terminated`**（C5を実Workerで確認）。全cancel runで採用結果0・settle 1回・late 0 |
| 10 | timeout | wall 1 ms: measurement HEADのrunでは `timeout`（約1.3 msで発火、terminate、採用結果0）。修正前build（`7de10bb`）での同じ確認では結果のmessageが先に届き `completed` だった（timerとmessageの到着順による）。60 MB合成JSONの同期decode中のwall 20 ms → `timeout`（約20.6 msで発火、terminate） |
| 11 | 連続再実行 | 同じpage sessionで13 logical run（正常・cancel・timeout・terminate・error）を続けて実行。正常runは毎回同じmaterialization semantic SHA-256 `84430962424618a867b5d6576c6b5eec14a678805c5a23185d9ea5f741e01446`、cancel / timeout / terminate後の再実行も同じ値。isolated環境でも同じ値 |
| 12 | IndexedDB / storage | §13 |
| 13 | 通常アプリへの影響 | 通常 `dist/` のpreviewが表示（title `GogmaArtianPlanner`、h1「ダッシュボード」、navigation link 10）、Global Assignmentのglobal・resourceなし、page error 0。既存 `benchmark.html` も表示（8 harness、既定C5-E2C8、error 0） |
| 14 | 狭幅画面（375 × 812、mobile emulation） | `scrollWidth` = `clientWidth` = 375（横はみ出しなし）、全buttonの高さ44 px以上、入力は全てvisible labelとhelper text付き。状態は文字で表示（色だけに依存しない） |
| 15 | memory API（isolated、固定点） | `measureUserAgentSpecificMemory()` が利用可能で、解決に約2.5〜60秒。page + Worker 約7.8〜10.4 MB、Worker ready時のWorker分 約2.5 MB（合成最小入力。実Exportの値ではない）。Worker realmの `performance.memory` は無い（Phase 2-Aと同じ所見） |

Browser（Chrome）とNode（Vitest、同じWorker依存 `globalAssignmentBrowserWorkerOptions()`、Node v24.19.0）で最小合成Exportのmaterialization semantic SHA-256が一致した
（`84430962…01446`）。これは合成最小入力（Phase 0で停止）での一致であり、実Exportでのparityの根拠ではない。

### 12.3 page上の基本操作

UIのbuttonから「logical runを実行」して記録cardが追加されること、実行中は「キャンセル」「Ping」だけが有効で終了後に戻ることを、DOMのdisabled状態で確認した。
headless screenshotでは実行可能なbuttonが無効色で写る時点があったが、DOMの状態は正しかった（描画時点の問題で、機能の不具合ではない）。

### 12.4 実Browser確認で見つかり修正したもの

| 所見 | 原因 | 修正 |
| --- | --- | --- |
| chained ping付きのlogical runが約11秒かかった | settle直後にWorkerをterminateしても、送信済みpingのpromiseがtimeout（10秒）まで解決されず、runnerがそれを待った | settle時に未応答pingを即座にlost（null）で解決（`7de10bb`）。harness testを追加 |
| 375px幅で横スクロール（`scrollWidth` 401） | 状態欄の分類token（`browser_nonformal_phase_d_prime_not_reached`、underscore区切り）が改行されない | 状態欄・判定文・Alertに `overflow-wrap: anywhere`（`7de10bb`） |
| chained pingが lost 3 になった | settle後もrunner側の終了処理までの間にpingを送り、即座にnullとして数えていた | settled requestにはpingを送らない（`43820f0`）。runner testに `lost <= 1` を追加し、修正前のloopでは失敗することを確認 |

## 13. IndexedDB / storage

非isolated・isolatedの両originで、確認の最初と最後（全run・page reload・狭幅確認の後）に、外部driverが `indexedDB.databases()`・`localStorage.length`・`sessionStorage.length`・
`caches.keys()`・Service Worker登録を読んだ。**どちらも全て空 / 0のまま**（benchmark originにDBは作られなかった）。Worker bundleに含まれるDexie instance生成（§10）は、
今回の合成入力のrunではDBを開かなかった。browser moduleのsourceはこれらのAPIを参照しない（isolation testで固定）。

## 14. 既存仕様・P-0との整合と、本PRで決めたこと

Production semantics（REQUIREMENTS 19 / 23、PLANNER_SPEC 7 / 9.2.19、SEARCH_SPEC 5.6.9）・D-1C登録条件・既存Global Assignment計算は変更していない。P-0が提案とした部分で、
本PRが具体化したことは次のとおり（いずれもResearch harnessの範囲）。

| # | 決めたこと | 理由 |
| --- | --- | --- |
| 1 | `globalAssignmentBrowserWorkerOptions.ts` を追加しentryから呼ぶ | entryとtestが同じ依存（ProductionRngEngine、maxPlanSteps 1,000、登録条件）を使うため。P-0 §7.2の依存内容は同じ |
| 2 | 判定に `phase_d_prime_not_reached`（first完了・handoffなし。materializationの型付きoutcomeを保持）を設けた | D-1AではD-0C identity不一致で止まった位置。Browserはidentityを照合しない（P-0 §6.2 #5）ので、その位置をPlanner結果でもunmeasuredでもない形で残す |
| 3 | `environment_unsupported` は `unmeasured` の理由としてそのまま記録 | P-0 §7.11のD-1A対応表に無いため、別の理由に読み替えない |
| 4 | `export_changed` / `entry_set_refused` はWorkerが計算前に拒否（`gab_error`）し、runnerがlogical runのintegrity issueにする | P-0は両方をintegrity issueとする。D-1Aの子processも計算前に拒否する |
| 5 | materialization semantic recordのintegrity issue、handoff超過、handoffとrecordの不一致はintegrity issue | §5。D-1Aではidentity不一致として `verified` にならなかった状態 |
| 6 | `cancelling` でない（cancelしていない）requestへの `gab_cancelled` はprotocol violation（`worker_reported_error`） | cancelの採否はmain threadだけが決める（P-0 §7.8） |
| 7 | requestIdがnullの `gab_error` は、受理前のrequestについてのものだけを適用 | Workerがdeserializeできなかったmessageは帰属できないため |
| 8 | Worker controllerにtest専用の `environmentOverrides` | jsdomにはWorkerのsecure contextが無いため。entryは渡さない |
| 9 | page既定値（wall 30分、grace 10秒、heartbeat 1秒、late待ち1秒）は「P-1の暫定値」と画面に明記 | 実測値・Production値ではない。P-2が測定計画で固定する |
| 10 | run slot（slot ID・目的・planned）をlogical runの記録に持たせ、P-1のrunは全て `planned: false` | P-2が測定計画のslotに結び付けられるよう（P-0 §12.2） |

P-0との相違は無いと判断した。設計上の矛盾は見つからなかった。

## 15. 未確認事項（検証済みとして扱わない）

- **実Export（43 Target / 1,766物理操作）のBrowser実行・完走・時間・memory**: 未実施（P-2）
- **Browserでのsemantic parity**（Node D-1A・D-1C公開RESULTとの一致）: 未確認（P-2。本PRの一致は合成入力だけ）
- **性能**: 各Phaseの時間、最大同期slice、cancel latency、ping応答は合成最小入力でしか観測しておらず、実Exportの値ではない。閾値・Production defaultは決めていない
- **headed Chrome**: 確認はheadless=newだけ。headedでの描画・visibility・background throttlingの影響は未確認（P-2は外部driverでheaded・`--disable-backgrounding-occluded-windows` を想定。P-0 §11）
- **C2（cancel後に結果が届く経路）の実Browserでの発生**: 実Workerでは未観測（cancelは常にWorkerの `gab_cancelled` か terminateで終わった）。synthetic testでのみ確認
- **Worker heapの最大値**: 固定点のmemoryはsettle（terminate）後に採るのでWorkerの最大使用量を捉えない。Worker realmに `performance.memory` は無い。実測には外部CDPの `Runtime.getHeapUsage` 等が要る（P-2）
- **IndexedDBが作られないこと**: 合成入力のrunでだけ確認（実Exportのrunでは未確認）
- **`localeCompare` を使うDomain順序の環境差**: 未確認（P-0 §4.6。今回の環境は `ja` のみ）
- Android / iPhone、Edge / Firefox / Safari: 未確認
- PR #257 Required fixに関する未確認事項は§17.6

## 16. P-2への引き継ぎ

- 入口: `benchmark-global-assignment.html`（benchmark build + `vite preview --config vite.benchmark.config.ts`、memory runは `BENCHMARK_CROSS_ORIGIN_ISOLATED=1`）。console API
  `globalAssignmentBrowserBenchmark.runLogicalRun({ slot, envelope, execution, cancelTrigger, ping, memory, exportTransport })` で外部driverから実行し、`exportJson()` をlogical runごとに保存する
- P-2で実装するもの（P-0 §16.2）: 測定計画file（slot・目的・必要run数を計測前にcommit）、parity判定・cancel試験判定・未完了集計のpure関数（`globalAssignmentBrowserJudgement.ts` に追加）、
  事後analyzer（`scripts/analyze-planner-global-assignment-browser.mjs` 想定。追加時は `isolation.test.ts` の指定script一覧を更新）、Node reference（同じHEADでのD-1A non-formal runner）
- 記録の形: logical run recordは `slot`（P-1は `planned: false`）、first / freshのsettlement（`result` は採用時だけ）、`rehash`、`audit`、`integrityIssues`、`judgement`、`lifecycle`、
  `ping`、`memory` を持つ。raw JSONはEntry本体・Target IDを含み得るので `.local/` 限定
- 注意点:
  - 実Exportのfirst Workerは約40秒（Node D-1Cの観測。Browserの期待値ではない）の計算になり、Phase 0 / A・Plannerの同期区間ではcancelもpingも届かない。cancel試験のtrigger key
    （`materialization:context` = Phase A中、`materialization:reach_table` = B / C中、`materialization:candidate_started` = D中、`verification:planner:started`、
    `verification:trace_replay:started`）とgrace値は測定計画で固定する
  - wall 1 msのような極端なtimeoutは結果とtimerの到着順で `completed` にも `timeout` にもなる（§12.2 #10）。timeout試験は計画した値で行う
  - memoryの固定点はWorker terminate後になるので、Worker heapの推移は外部CDPでWorker targetを標本する
  - Dexieの推移的依存は残っている。実Exportのrunでも前後の `indexedDB.databases()` を記録する
  - 外部driverはcommitせずSHA-256を記録する（本PRと同じ）
- 本PRのmeasurement HEAD以降でBrowser基盤に修正が要る場合は、P-2の計測の **前** に別commitで行い記録する（P-0 §16.2）
- PR #257 Required fixで基盤を修正した（`4890e03`）。P-2の計測は `4890e03` 以降のbuildで行う。外部driverの `cancel()` は真偽値ではなく `GabRunnerCancelResult` を返す（§17.2）。
  logical run記録のworker側に `requestStarted` / `stoppedBeforeRequest` / `rehashError` / `runnerError`、`cancel` に `phase` / `role` が増えた

## 17. PR #257 Required fix（レビュー指摘2件）

### 17.1 基準

| 区分 | 値 |
| --- | --- |
| 修正前HEAD | `e38fc710b4cc0244ffa1e93e910008a90a491d4d`（= PR #257のreview HEAD。作業開始時にlocal HEAD = PR head、Working Tree clean、stash / 追加worktreeなしを確認） |
| 修正commit | `4890e036fc1495e553e63871f0284bbe5b1b59e2`（コードとtest。`src/benchmarks/globalAssignment/browser/**` だけ） |
| 記録 | 本節（docs-only commit） |

変更範囲は `src/benchmarks/globalAssignment/browser/**` と本書だけ。Production file、既存Global Assignment計算module、D-1A / D-1C runner、D-1C登録条件・RESULT、既存Browser benchmark、
永続化・schema、`vite.config.ts`、`vite.benchmark.config.ts` は変更していない。

### 17.2 Fix 1: cancel後に `gab_run` が送られ得た

**原因**: `runWorker()` はWorker作成前とready直後にだけcancelを確認し、その後 `await source.file.arrayBuffer()`（`array_buffer` transport）を挟んで `harness.run()` を呼んでいた。
この読込み中にcancelされると、`runner.cancel()` はまだrequestが無いのでどのrequestにも届かず（`false`）、logical runにcancelを記録するだけで、読込み完了後に `gab_run` がpostされた
（first / freshとも）。ready待機中のcancelも、readyかready timeoutまで待っていた。page離脱では破棄済みharnessの `run()` が拒否され、`worker_error` と記録された。
戻り値の `false` は「Worker間」と「request未作成」と「request終了後」を区別していなかった。

**修正**:

1. request送信前の全てのawait（memory固定点、ready待機、Export読込み）の後でcancel / page離脱を再確認し、最後の確認から `harness.run()` までawaitを置かない（同じ同期処理でpostする）
2. requestをまだ持たないWorker（作成前・起動中・Export読込み中）は、cancel / pagehideの時点でdispose（terminate）する。ready待機はその場で終わり、ready timeoutを待たない
3. 送らなかったrequestは `settle: 'not_run'`、`stoppedBeforeRequest`（`cancel` / `page_left`）、`requestStarted: false`、`notRunReason`（どの段階か）で記録し、settlementもharness auditのrequest entryも作らない（settle回数を捏造しない）
4. `runner.cancel()` の戻り値を型付きにした（`GabRunnerCancelResult`）

   | kind | 意味 |
   | --- | --- |
   | `idle` | logical runが無い。何も変えない |
   | `already_stopping`（`cancel` / `page_left`） | 既にcancel済み / page離脱済み。何も変えない |
   | `request_cancel_accepted`（role、requestId） | 実行中のrequestがcancelを受け付けた（C1: `running` → `cancelling`）。その結果は採用しない |
   | `logical_run_stop_recorded`（phase、role） | requestはcancelを受け付けていない。logical runの停止だけを記録した。phase `before_request`（requestの無いWorkerは即dispose）/ `between_workers`（fresh Workerを作らない）/ `after_request_settled`（requestは終了済み、以降のWorkerは起動しない） |

5. logical run記録の `cancel` に `phase`（上記 + `request_running`）と `role`
6. 判定（`judgeBrowserLogicalRun()` の第4引数 `{ cancelled }` を必須にした）: 送らなかったfirstは `unmeasured(first, cancelled, browserSettle: not_run)`（停止理由が無ければ `process_failure`）。
   cancelを記録したlogical runはfresh側の評価に進まず `unmeasured(fresh, cancelled)` になり、両requestがcancel前に完了していても `browser_nonformal_conditions_met` にならない。
   first側のoutcome（D-1Aと同じく「first側の結果はfreshに関係なく残る」）は変えない。D-1A `judgeD1aRun()` との75通りの同値testは `cancelled: false` で従来どおり一致する
7. benchmark画面のcancel表示を戻り値で区別し、console API `cancel()` は戻り値をそのまま返す

### 17.3 Fix 2: 不正なWorker結果を採用し得た / 異常時に状態が戻らない経路があった

**原因**: `gabResponseIssues()` はprotocol version・requestId・body fieldがnull / undefinedでないことだけを見ていたので、`gab_result.result` がobjectでなくても、
runnerが読むfieldが欠けていても採用された。runnerは採用結果の `exportObservation` 等を直接読み、再hash（`JSON.stringify` / Web Crypto）やEntry集合検査の例外を捕まえていなかった。
例外は `guarded()` が空のworker記録に置き換え（settlement等の診断を失う）、`runWorker()` のfinally内のawaitで例外が出ると `active` / `current` が戻らない経路があった。

**修正**:

1. protocol: `gabResponseIssues()` が各応答のbodyを、main threadが読むfieldについて検証する（`gab_ready` の環境probe、`gab_accepted` の時刻、`gab_progress` のevent種別・stage・`atMs`、
   `gab_heartbeat` の数値、`gab_pong` の `pingId`、`gab_cancelled` の `observed`、`gab_error` の `error`。`gab_result` は `result` がobjectであること）
2. `gabWorkerResultIssues(result, { requestId, role })`: 採用前の構造検証。他request / 他roleの結果、protocol version、環境、`exportObservation`（name・bytes・SHA-256・`matchesRequest`）、
   `calculationContext`、`rngEngineVersion`、`conditions`、`phase0`、`integrityIssues`（文字列配列）、`observed`、`formal: false` / `oracleFreeExecution: true`。
   nullableな部分（`materialization` / `entrySet` / `freshEntrySet` / `verification`）はkey必須・null可とし、nullでなければ形を検査する。role別に、firstはmaterialization必須・`freshEntrySet` なし・
   Entry集合があればverification必須、freshはmaterialization / Entry集合なし・verification・`freshEntrySet`・自分のPhase 0必須。`conditions_met` のverificationは判定が読むfield
   （finalInput、planner、physicalのphysicalOperations / planSteps）必須。Entry集合はD-1A Entry集合の形と、fingerprint・件数の自己整合だけを見る。
   **semantic recordの中身は走査しない**（有界。循環構造でも止まらない）。中身は従来どおりmain threadの再hash・`d1aEntrySetIssues()`・integrity checkが担う
3. harness: 不正な応答・結果はpayloadを捨て、`worker_error` / `settledBy: protocol_violation`（errorName `MalformedResponse` / `MalformedResult`）でsettleしWorkerをterminateする。
   そのWorkerは以後信頼しない（ready待機は失敗、pingとrequestは拒否）
4. runner:
   - `protocol_violation` のsettlementはintegrity issue（判定は `invalid_run_integrity`、Workerのsettleは `worker_error` のまま。既存分類の両方で記録）
   - 再hashの例外（record化できない循環構造を含む）は `rehashError` として残しintegrity issue
   - integrity check・Entry集合検査の例外はintegrity issue（fresh Workerは起動しない）。Entry集合検査はtest専用に依存注入できる（`entrySetIssues`）
   - 判定自体の例外は `gabIntegrityJudgement()`（`invalid_run_integrity`）
   - runner自身の例外は `runnerError` として観測値（settlement等）と一緒に残しintegrity issue。memory固定点の失敗は `status: error` の標本として残す
   - 全exit pathで `running()` false、`current` null、Worker slot・lifecycle listener解除・Worker disposeを戻す。onChange observer（画面）の例外でcleanupは止まらない。
     logical runの外へ例外が出る場合（runner不具合）はcleanupの後でrejectし、記録にはしない（正常結果に握りつぶさない）

### 17.4 test

新規 / 変更: protocol +1、harness +3、runner +10、page +1（判定testは既存2件を拡張）。全体は433 file passed / 1 skipped、**7,019 passed** / 3 skipped（skipは既存の `src/research/issue74`）。

Fix 1（runner test。Export読込み・ready待機・memory固定点を `deferred()` で止め、その間にcancel / pagehideを入れる）:

| # | 要求 | test |
| --- | --- | --- |
| 1 | Export読込み中（`array_buffer`）のcancel | `gab_run` なし、Workerはcancel時点でterminate、first `not_run`（while the Export was read）、audit request 0、fresh未起動、`unmeasured(first, cancelled, not_run)` |
| 2 | Export読込み中のpagehide | 同上（`page_left`）、`lifecycle.pageLeft`、listener解除 |
| 3 | Worker ready待機中のcancel | ready timeout 600秒でも即終了、`gab_run` なし、後から届くreadyは無視、`worker_error` にしない |
| 4 | first完了後・fresh開始前のcancel | memory固定点 `fresh:before_worker_create` / `first:after_dispose`（`between_workers`）と `first:settled`（`after_request_settled`）で、fresh Workerを作らない。firstの採用結果は残り、判定は `unmeasured(fresh, cancelled, not_run)` |
| 5 | fresh Export読込み中のcancel | fresh Workerはterminate、fresh `gab_run` なし、`before_request`（fresh） |
| 6 | cancel後に `gab_run` を送らない | 1・2・3・5（WorkerのpostMessage記録で確認） |
| 7 | 不要なWorkerを作らない | 1〜5でWorker数を確認 |
| 8 | cancelしたrunを正常完了にしない | 1〜5、および両request完了後（`fresh:settled`）のcancelでも `unmeasured(fresh, cancelled, completed)` |
| 9 | cancel後の新しいlogical run | 5の後のrunが `browser_nonformal_conditions_met`、freshに渡るEntry集合はそのrunのfirstのもの |
| 10 | 通常のfirst / fresh semanticが不変 | 9のrunのmaterialization / verification semantic SHA-256がcancelの無い別runnerのrunと一致。既存の実controller testも不変 |

Fix 2:

| 要求 | test |
| --- | --- |
| resultがnull / primitive / 文字列 | harness（envelopeで拒否）、runner |
| `exportObservation` 欠落 / 必須field欠落・型違い | harness、runner |
| materialization / verification / Entry集合の不正 | harness、runner、protocol（role別要件・自己整合・conditions_metの必須field） |
| `integrityIssues` が配列でない / 文字列配列でない | harness、runner、実controller経路（InProcessWorkerの応答を改変） |
| `gab_progress` / `gab_heartbeat` / `gab_accepted` / `gab_cancelled` / `gab_error` / `gab_pong` / `gab_ready` のbody不正 | harness（hookは呼ばれない、ready待機は失敗）、runner（progress・heartbeat） |
| 他request / 他roleの結果 | harness、protocol |
| runner再hash中の例外 | Web Crypto失敗の注入、循環構造の結果（`rehashError`、`invalid_run_integrity`、fresh未起動） |
| integrity check中の例外 | Entry集合検査が投げる注入（`first: the Entry set check failed: …`、fresh未起動）、次runは注入を外して条件達成 |
| 不正応答後の状態 | `running()` false、`current()` null、最後の通知が `running: false`、Worker terminate、harness audit `adoptedResults` 0・`invalidResponses` 1 |
| 不正payloadの不採用 | settlement・記録のJSONにpayloadの目印文字列が含まれない |
| 旧Entry集合を持ち越さない | 実controller経路で、不正結果のrunの後のrunのfreshには、そのrunのfirstのEntry集合だけが渡る |
| 新しいlogical runの成功 | 各不正ケースの後、同じrunnerで次のrunが採用・判定まで進む |

**修正を外したときに失敗することの確認**（一時的に変更してtestを実行し、元に戻した）: Fix 1の最後の確認とcancel時のdisposeを外すと1・2・3・5の4 testが失敗した。
harnessの `gabWorkerResultIssues()` を外すとFix 2の3 test（harness、runner、実controller経路）が失敗した。

C1〜C10（§8）と競合8ケース（§9）のtestは全て通過している（harness / runnerの変更後も同じassert）。Synthetic semantic parity（§6）のtestも不変で通過している。

### 17.5 実Chrome再確認（PC、非formal、合成入力のみ）

| 項目 | 値 |
| --- | --- |
| 環境 | §12.1と同じmachine、Google Chrome 154.0.8037.98（`--headless=new`、新しい一時profile、CDP）。user agent `HeadlessChrome/154.0.0.0`、locale `ja` |
| build | `4890e03` のbenchmark build（provenance §2）を `vite preview --config vite.benchmark.config.ts` で `http://127.0.0.1:4179/GogmaArtianPlanner/` に配信（**非isolatedだけ**） |
| 入力 | **実Exportは使用していない**。最小合成Export（973 bytes、SHA-256 `1502661c…02615`）、不正JSON、`{}`、60,000,010 byteの合成JSON（Exportではない。作り直した） |
| driver | 外部Node CDP script（commitしない）、SHA-256 `630bb14d9c99b6815b3b07d8a7c391a3926636a65852fd4f4e8d64616b597d56` |
| 記録 | `.local/global-assignment-browser-p1/required-fix/`（raw JSON SHA-256 `8db03af3f539421b5f30422c7996247650790d48b6d258d0055a657fca58edc1`、375px screenshot）。実施 2026-10-13T22:07:49Z〜22:08:00Z |

| 確認 | 結果 |
| --- | --- |
| Worker起動 | probe ready 29.5 ms、ping 0.2 ms、環境issue 0、Worker・pageのbuild commit `4890e03…` |
| synthetic run | `browser_nonformal_phase_d_prime_not_reached`、materialization semantic SHA-256 `84430962…01446`（§12.2と同じ）、main threadの再hash一致 |
| cancel（呼出しと同じtask = Worker作成前） | `logical_run_stop_recorded` / `before_request` / first、Workerを作らず、first `not_run`（before the Worker was created）、logical run 0.2 ms |
| cancel 1 / 5 / 10 / 20 ms後（Worker起動中） | 全て `before_request`、first `not_run`（while the Worker was starting）、`requestStarted: false`、harness audit request 0、logical runはcancel時刻（7〜20 ms）で終了（ready timeoutを待たない） |
| cancel 30 / 40 / 50 / 60 ms後（`array_buffer`、60 MB合成JSONのmain thread読込み中） | 全て `before_request`、first `not_run`（while the Export was read）、`requestStarted: false`、audit request 0。logical runは62〜71 ms（読込み自体は中断できないので完了まで待つが、postはしない） |
| cancel 80 / 100 ms後（request実行中） | `request_cancel_accepted` → Workerは同期decode中でackできず、grace 1 ms超過で `cancelled_terminated`。採用0・settle 1・late 0 |
| cancel 150 ms後 | `logical_run_stop_recorded` / `after_request_settled`（requestは既に `worker_reported_error` で終了。合成JSONはExportではない）。判定はfirst側の `unmeasured(process_failure)` のまま |
| 2回目のcancel / 終了後のcancel | `already_stopping(cancel)` / `idle`。終了後は `running()` false、`current()` null |
| cancel後の再実行 | 最小合成Exportのrunが同じSHA-256で完了 |
| 不正入力後の復旧 | 不正JSON・`{}` → `unmeasured(first, process_failure)`（`worker_reported_error`）、その後の最小runが同じSHA-256で完了 |
| 狭幅375px | 画面のbuttonで実行→即キャンセル: 「logical runの停止を記録しました（first Workerへrequestを送る前のため、requestを送らずWorkerを破棄しました）。」を表示、記録はfirst `not_run`・audit request 0。`scrollWidth` 375（横はみ出しなし）、button最小高さ44 px |
| storage | 前後とも IndexedDB 0・localStorage 0・sessionStorage 0・Cache 0・Service Worker 0 |
| page error | 0 |

requestを送らなかったことは、実Browserではharnessの記録（audit request、`requestStarted`、settlementなし）で確認した。Workerが受け取ったmessageそのものを観測したのはtest（Worker doubleのpost記録）だけである。

### 17.6 未確認事項（Required fix）

- **不正なWorker応答（Fix 2）の実Browserでの発生**: Workerを改変しないので実Workerからは発生させていない。testでのみ確認
- **isolated origin・memory固定点のrun・既存 `benchmark.html`・通常アプリ表示**: `4890e03` では再確認していない（§12の `43820f0` の結果のまま）。通常 `dist/` に研究識別子（追加した `gabWorkerResultIssues` 等を含む）が0件であることは、`4890e03` とcommit前に同じコードでbuildした `dist/` で確認した
- **headed Chrome、Android / iPhone**: 今回は実施していない（指示どおり）
- **main threadのExport読込みの中断**: `Blob.arrayBuffer()` は中断できないので、読込み中のcancelは読込み完了まで待ってから（postせずに）終わる。60 MBの合成JSONで62〜71 ms。実Exportでの値は未確認（P-2）
- C2（cancel後に結果が届く経路）の実Browserでの発生は引き続き未観測（§15）
