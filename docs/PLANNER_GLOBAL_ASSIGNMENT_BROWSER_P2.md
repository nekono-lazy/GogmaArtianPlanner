# Global Assignment 実ExportのBrowser性能・semantic parity検証（Production準備 P-2）

Refs #154。**Research記録・非formal**。正式なProduction仕様（REQUIREMENTS / PLANNER_SPEC / SEARCH_SPEC / DATA_MODEL / UI_FLOW）、Domain契約、
D-1Cの登録条件・正式RESULTは変更していない。設計は [P-0](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md)、基盤は [P-1](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P1.md)、
測定計画は [P-2測定計画](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_PLAN.md)（計測前にcommit）、公開RESULTは [P-2 RESULT](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_RESULT.json)。

## 0. 要約

| 項目 | 結果 |
| --- | --- |
| PC（Windows 11 + Chrome 154 headed） | **`parity_confirmed`**（必須比較run 3 / 3、比較したWorker 10、不一致0、前提issue 0） |
| Android / iPhone | **未確認**（端末・安全な接続経路が無いため計画しなかった。PCの結果を代入していない） |
| semantic | Browserの比較母集団10 Worker・Node reference（同じHEAD）・D-1C公開RESULTが、materialization semantic SHA-256 `6f790d33…cb18f`、verification semantic SHA-256 `0a56da0f…33dd4`、Entry fingerprint `fnv1a32:ed959cc4` で一致 |
| planning Target / 物理操作数 | 43 / **1,766**（Plan steps = 物理操作数 = Σ stream前進 = objective、非物理Step 0、Conflict / rejected / warning 0、Trace Replay valid） |
| cancel試験 | 6件すべて `cancel_passed`（採用結果0、settle 1回、terminate、fresh未起動、cancel後の再実行完了）。うち3件はcancel受付後に届いた `gab_result` をmain threadが捨てた経路（C2）で、実Browserで初めて観測した |
| 未完了run | 0件（cancel slotの意図的中断を除く）。timeout / Worker error / page loss / OOM 0、非表示・凍結による中断 0、計画外record 0 |
| storage | 両sessionの前後でIndexedDB 0・localStorage 0・sessionStorage 0・Cache 0・Service Worker 0（変化なし） |
| 判定しないもの | 性能の合格基準、Production可否、formal validity / acceptance。`parity_confirmed` はこれらの合格を意味しない |

## 1. 目的と範囲

P-1で作ったResearch専用Browser Worker基盤で実Export（D-1Cと同じExport・同じ登録条件）を実行し、(1) Node D-1A referenceとD-1C正式RESULTとのsemantic parity、
(2) cancel試験、(3) 時間・応答性・memoryの観測を、計測前にcommitした測定計画に従って記録した。Production統合、計算アルゴリズムの最適化、性能の合格基準の決定、
Phase Eは行っていない。

## 2. 基準とHEAD

| 区分 | 値 |
| --- | --- |
| 基準main | PR #257 merged `65b9e47cf10e61656656366c90f0a186b6638acf`（作業開始時に `main` = `origin/main` = HEAD、Working Tree clean、stash / 追加worktreeなしを確認） |
| branch | `research/global-assignment-browser-p2` |
| 実装commit | `55df0f3ff4ee5e08a0a095d6036ab1f3c3f6b343`（判定・計画module・analysis・analyzer・test） |
| 修正commit | `d3716304b6f6749f6bdbc9e3cf6e8bdf7bd2ab3e`（公開RESULTのcancel latencyの丸め。§5.3のdry runで発見。計測前）= 計画の `baseCommit` |
| 計画commit = **measurement HEAD** | `3dfe24aa3574921bfe4596db3b2280a7a397cc91`（docs-only。測定計画の事前登録） |
| build provenance | commit `3dfe24a…`、`uncommittedBenchmarkCode: false`、benchmark code SHA-256 `6d356860a33f94ec9ea02d1a14a312517158d86d5c038d1dce13f633d1502c35`（page・Worker両bundleに埋込みを確認） |
| 記録commit | 本書と公開RESULT（docs-only。`docs/` はbenchmark code pathの外なのでbuild provenanceは変わらず、analyzerはmeasurement HEADと同じcodeで再導出できる） |

計測開始後に計算コード・測定コードは変更していない。

## 3. 実装

すべてResearch codeで、Production file（`src/{app,components,db,domain,services,stores,workers,pages,presentation,data}/**`、`src/*.{ts,tsx}`、`vite.config.ts`、`index.html`）の変更は **0件**。
既存Global Assignment計算module、D-1A / D-1C runner、D-1C登録条件・RESULT、P-1のWorker / page / runner / harnessの挙動は変更していない。

| file | 内容 |
| --- | --- |
| `src/benchmarks/globalAssignment/browser/globalAssignmentBrowserJudgement.ts` | 追加: 環境ごとのparity判定 `judgeGabEnvironmentParity()`（P-0 §12.4の順、比較母集団は計画の必須比較slot全Workerと、両Worker完了の追加比較slotだけ）、cancel試験 `judgeGabCancelTrial()`（3分類）、終了経路の集計 `tallyGabOutcomes()`。3つは互いを読まない |
| `.../globalAssignmentBrowserMeasurementPlan.ts`（新規） | 計画文書のJSON block抽出・検証 `gabMeasurementPlanIssues()`、recordのslot割当て `bindGabRecordsToPlan()`（planned・slot・目的・options・origin・user agentが一致し、slotが空いているときだけ。最初のrecordを採用し、2件目以降・付け替えは計画外） |
| `.../globalAssignmentBrowserAnalysis.ts`（新規） | Browser raw・driver記録・Node reference（D-1A runner出力 + first / fresh record）・D-1C公開RESULTの読取りと構造検証、semantic recordの再hash、前提検査、比較view、観測値の集計、最小化した公開RESULTの導出 `deriveGabPublicResult()` と再導出検査 `gabPublicResultIssues()`。異なるmeasurement HEAD・未commit code・読めない入力はfail closed。計算・file読取り・時計は持たない |
| `.../globalAssignmentBrowserP2TestFixture.ts`（新規、test専用） | runner・harness・実controllerによる合成scenarioのrecord、D-1A書式のNode reference、D-1C書式のreference、計画文書 |
| `scripts/analyze-planner-global-assignment-browser.mjs`（新規） | analyzer。計画とD-1C RESULTを `git show <measurement HEAD>:<path>` で読み（D-1C pathは計画から）、解析時のcode（benchmark code path）がmeasurement HEADと同じでなければ拒否。`--validate-plan` / `--public`（排他的書込み）/ `--check`。Exportを読まず、計算しない |
| test（新規4 file、変更1 file） | `globalAssignmentBrowserParity.test.ts`（19）、`globalAssignmentBrowserMeasurementPlan.test.ts`（7）、`globalAssignmentBrowserAnalysis.test.ts`（16）、`scripts/analyze-planner-global-assignment-browser.test.ts`（3）、`browserIsolation.test.ts`（+2） |
| `src/benchmarks/globalAssignment/isolation.test.ts` | 指定scriptの一覧にanalyzerを1件追加（P-0 §13.2の許可どおり。他の検査は不変） |

### 3.1 必須テスト（P-0 §16.2）

| # | ケース | 結果 |
| --- | --- | --- |
| 1 | PCの必須比較2 logical runが完了・一致 | `parity_confirmed` |
| 2 | 必須比較1件しか完了しない | `not_comparable`（`required_runs_incomplete`） |
| 3 | cancel runがあっても必須比較runが成立 | `parity_confirmed`（cancel slotは比較しない。両Worker完了のcancel slotも） |
| 4 | cancel runしか存在しない | `not_comparable`（完了0件） |
| 5 | 完了runでsemantic不一致 | `parity_mismatch`（slot・Worker・part・field、D-1C / Node / Browser内部の別） |
| 6 | 必要run数未達でも確定した不一致を隠さない | `parity_mismatch`（Node referenceが無くても） |
| 7 | Node reference欠落 | `not_comparable`（`node_reference_missing`） |
| 8 | Export identity不一致 | `not_comparable`（`export_identity_mismatch`、差を不一致と呼ばない） |
| 9 | integrity issueのあるrunを成功扱いしない | 比較せず、必要数に数えない |
| 10 | cancel / timeout / Worker error / page lossの件数がparityと独立 | 集計値はparityの入力・結果で変わらない |
| 11 | 測定後の比較母集団・必要run数の変更を拒否 | 必要数を下げた計画は検証で拒否、測定時commit以外の計画は拒否、目的を付け替えたrecordは割り当てない |

加えて、cancel 3分類（cooperative停止 / 捨てた結果 / grace terminateのpass、結果採用・settle 2回・未terminate・cancel中のerror・fresh起動・再実行未完了のfail、
未実行・未発火・requestなし・計画外triggerのnot_exercised）、cancel試験がparityを変えないこと、環境中断runの時間集計除外、計画外runの母集団除外、
異なるmeasurement HEAD・未commit code・別buildのWorkerのfail closed、raw欠落・不正のfail closed、D-1C referenceの不一致・SHA-256不一致・未acceptedの検出、
公開RESULTの最小化（ID・path・Target単位配列なし）と2回の再導出一致、未測定memoryの `unavailable` / `not_sampled`、実D-1C RESULTを読む同値test
（`deriveD1cPublicResult()` の実出力を読んだ値 = 元のraw semantic recordから作った値）を固定した。

## 4. 測定計画（commit `3dfe24a`）

[P-2測定計画](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_PLAN.md) の計画blockが唯一のauthority（`git show 3dfe24a:docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_PLAN.md`、
SHA-256 `dfebc5776f7891170c43a20398fdf5d86831b0acd73f2b2e1b6d935bdf088abd`）。計測前に `--validate-plan` の6項目（計画の形、D-1C RESULT SHA-256 `9e9e33d7…fb46` が計画どおり、
条件 = `registeredD1cConditions()`、fingerprint = `fnv1a32:2393847e`、D-1C referenceがaccepted、計画のExport / CalculationContext = D-1C）がすべて通った。

- PC: 12 slot（pilot、timing、rerun、responsiveness、cancel 6件、cancel後のrerun、isolated originのmemory）、必須比較run 3件（`pc.timing.1` / `pc.rerun.1` / `pc.rerun.2`）
- envelope: first / fresh wall 1,800,000 ms、cancel grace 10,000 ms、ready timeout 120,000 ms。heartbeat 1,000 ms、yield `message-channel`、late待ち1,000 ms、transport `auto`
- Android / iPhone: `not_available`（計画登録時に `adb devices` が端末を示さなかった / 信頼済みHTTPS経路とMac Web Inspectorが無い）

## 5. 実行

### 5.1 環境

| 項目 | 値 |
| --- | --- |
| machine | Windows 11 Pro 10.0.26200 x64、AMD Ryzen 7 9700X 8-Core（`hardwareConcurrency` 16）、RAM 31.1 GiB（`deviceMemory` 32はChromeの丸め値） |
| Browser | Google Chrome 154.0.8037.98、**headed**、専用の一時profile（scratchpad）。flags `--remote-debugging-port`、`--remote-allow-origins=*`、`--no-first-run`、`--no-default-browser-check`、`--disable-backgrounding-occluded-windows`、`--window-size=1280,900`、`--new-window` |
| user agent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36` |
| locale | `navigator.language` `ja`、Worker `Intl` locale `ja` |
| serving | `vite preview --config vite.benchmark.config.ts`：非isolated `http://127.0.0.1:4179/`、isolated `http://127.0.0.1:4180/`（COOP / COEPをcurlで確認）。secure context true、`crossOriginIsolated` 4179 false / 4180 true |
| Export transport | 全runで `blob`（`File` のstructured clone） |
| 背景負荷 | 各slot開始前のCPU負荷 6〜36%（参考値。HunterPie等の常駐あり） |
| driver | 外部Node（v24.19.0）CDP script `gab-p2-driver.mjs`（git-ignoredな `.local/` に保管、**commitしない**）、SHA-256 `caff73b1c50b440d28a3b8f0670177515a1ec8b68819fac3c87c1c9c3dfbed1d`。計算せず、page API・file選択・memory採取・raw保存・storage読取りだけを行う |
| 実施 | 2026-10-13T23:14:27Z〜23:25:12Z（UTC） |

### 5.2 Node reference（measurement HEAD、1回）

`node scripts/run-planner-global-assignment-d1a.mjs --export <Export> --expected-export-sha256 cc35fb5b…e1e6b --expected-d0c-semantic-sha256 6f790d33…cb18f --expected-d0c-entry-fingerprint fnv1a32:ed959cc4 --run-dir .local/global-assignment-browser-p2/p2-r1/node.run --output .local/global-assignment-browser-p2/p2-r1/node.result.json`
（既存CLI・登録済みD-0C identityの事後照合だけ。D-1C formal runnerは実行していない）。結果: HEAD `3dfe24a`、clean、verdict `verified`（`nonformal_planner_verified`）、
integrity issue 0、first / freshともmaterialization `6f790d33…`、Entry fingerprint `fnv1a32:ed959cc4`、verification `0a56da0f…`、物理操作1,766。
子processのwall: first 35.1 s（materialization 29.3 s、Planner 3.96 s）、fresh 7.3 s（Planner 3.98 s）。

### 5.3 計測前の確認（計測系列外）

- **analyzerのdry run**: 使い捨てbranch（push・merge しない、削除済み）でsynthetic計画・synthetic recordを作り、analyzerの全mode（validate / public / check、排他的書込み、
  code差分の拒否、改変した公開RESULTの拒否）を実行した。公開RESULTのcancel latencyが丸められていないことを見つけ、計画登録の前に修正した（`d371630`）
- **driver機構の事前確認**: 計画どおり、Repository内factoryの合成最小Export（973 bytes、SHA-256 `1502661c…02615`。実データなし）だけを使い、slot IDに `mech.` を付けた
  `planned: false` のrunで12 slot・2 sessionを実行した（全run `browser_nonformal_phase_d_prime_not_reached`、storage不変、CDP Worker heap 25標本・OS memory 113標本）。
  rawは系列外の `.local/global-assignment-browser-p2/mechanics/` に置き、analyzerへ渡していない（raw書式の構造検査だけ行った）。**実Exportを使った計画外runは行っていない**

### 5.4 Browser計測（series `p2-r1`）

session 1（4179）でslot 1〜11、session 2（4180、新しいpage load）でslot 12を計画順に実行した。12 slotすべてで `exportJson()` を保存した（page loss・driver期限超過なし）。
logical run間5,000 ms。rawは `.local/global-assignment-browser-p2/p2-r1/browser/raw/`（12 file、各12 KiB〜3.1 MiB）。

| 順 | slot | first / fresh | 判定 | logical run |
| ---: | --- | --- | --- | ---: |
| 1 | `pc.pilot.1` | completed / completed | `browser_nonformal_conditions_met` | 34.5 s |
| 2 | `pc.timing.1` | completed / completed | `browser_nonformal_conditions_met` | 35.1 s |
| 3 | `pc.rerun.1` | completed / completed | `browser_nonformal_conditions_met` | 34.6 s |
| 4 | `pc.responsiveness.1` | completed / completed | `browser_nonformal_conditions_met` | 34.6 s |
| 5 | `pc.cancel.phase-a` | cancelled / not_run | `unmeasured(cancelled)` | 4.2 s |
| 6 | `pc.cancel.phase-bc` | cancelled / not_run | `unmeasured(cancelled)` | 14.8 s |
| 7 | `pc.cancel.phase-d` | cancelled / not_run | `unmeasured(cancelled)` | 24.2 s |
| 8 | `pc.cancel.planner` | cancelled / not_run | `unmeasured(cancelled)` | 28.6 s |
| 9 | `pc.cancel.trace-replay` | cancelled / not_run | `unmeasured(cancelled)` | 29.0 s |
| 10 | `pc.cancel.fresh-planner` | completed / cancelled | `unmeasured(cancelled)` | 34.4 s |
| 11 | `pc.rerun.2` | completed / completed | `browser_nonformal_conditions_met` | 34.8 s |
| 12 | `pc.memory.1` | completed / completed | `browser_nonformal_conditions_met` | 232.5 s（memory APIの解決待ちを含む） |

全recordのintegrity issue 0、計画外record 0、計画順どおり、非表示・凍結・離脱 0。

## 6. 結果

### 6.1 semantic parity（`pc-windows-chrome`）

**`parity_confirmed`**。必須比較run 3 / 3（両Worker `completed`・`browser_nonformal_conditions_met`・integrity 0）、追加比較run（responsiveness、memory）も両Worker完了で比較し、
比較したWorker 10件の全項目がD-1C公開RESULT・Node reference・Browser内の他Workerと一致した（前提issue 0、referenceの不一致 0、不一致 0）。

| 項目（P-0 §12.1） | Browser（比較母集団10 Worker） | Node reference | D-1C公開RESULT |
| --- | --- | --- | --- |
| materialization semantic SHA-256 | `6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f`（first 5件、1種類） | 同じ | 同じ |
| verification semantic SHA-256 | `0a56da0f24206f1fcde76246b5ad47a6101d7a5fc9517f24c2bcdbc894833dd4`（10件、1種類） | first / fresh同じ | 4 processとも同じ |
| Entry fingerprint | `fnv1a32:ed959cc4`（10件） | 同じ | 同じ |
| planning Target / materialized（射影起点 / 形状制約） | 43 / 43（21 / 22） | 同じ | 同じ |
| termination / expandedStates / completed / total | `completed` / 1,809 / 43 / 43 | 同じ | 同じ |
| selected / Conflict / rejected / resource_conflict / warning | 43 / 0 / 0 / 0 / 0 | 同じ | 同じ |
| Trace Replay | valid、draft 1,809、対応不一致 0 | 同じ | 同じ |
| 物理操作 = Plan steps = Σ stream前進 = objective、非物理Step | 1,766、0 | 同じ | 同じ |
| Plan hash / Step semantic hash / 実行位置hash | `fnv1a32:903e4274` / `fnv1a32:8d28811e` / `fnv1a32:3cf477e7` | 同じ | 同じ |
| full Planner run | 1 | 1 | 1 |

`parity_confirmed` は「この環境・このExport・この条件で、計画した必須比較runがNodeと同じ計算結果になった」ことだけを意味する（性能・cancel・Production可否の合格ではない）。

### 6.2 時間（観測値。`timing` / `rerun` の3 run、min / median / max）

| 区間 | first Worker | fresh Worker |
| --- | --- | --- |
| Worker起動（`new Worker()` → ready） | 25.7 / 25.7 / 25.8 ms | 18.7 / 19.5 / 19.6 ms |
| request受理 | 0.4 / 0.5 / 0.5 ms | 3.4 / 3.4 / 4.0 ms |
| Export読込 / SHA-256 / UTF-8 decode / JSON parse | 13.2 / 11.2 / 13.4 / 20.2 ms（median） | 11.3 / 10.2 / 11.5 / 17.3 ms（median） |
| PlannerInput構築 | 65.0 / 73.2 / 75.5 ms | 61.5 / 62.7 / 65.9 ms |
| Phase 0 | 1,044 / 1,062 / 1,067 ms | 1,023 / 1,026 / 1,033 ms |
| Phase A | 9,081 / 9,125 / 9,165 ms | — |
| Phase B / C | 12,279 / 12,335 / 12,677 ms | — |
| Phase D（materialization / 診断） | 1,190 / 1,199 / 1,207 ms / 1.8 ms（median） | — |
| materialization合計 | 23,654 / 23,709 / 24,121 ms | — |
| Phase D' final input / Planner / Trace Replay / physical | 194 / 3,275 / 285 / 2.1 ms（median） | 187 / 3,287 / 286 / 2.1 ms（median） |
| Phase D' 合計 | 3,784 / 3,844 / 3,851 ms | 3,788 / 3,810 / 3,835 ms |
| Worker総計算（accepted → result） | 27,638 / 27,714 / 28,055 ms | 4,930 / 4,964 / 4,984 ms |
| Worker round trip（post → result） | 27,647 / 27,723 / 28,065 ms | 4,938 / 4,971 / 4,991 ms |
| logical run全体 | 34,644 / 34,755 / 35,114 ms | |

pilot・responsiveness・memory・fresh-planner cancelのslotの値も同じ範囲だった（first round trip 27.39〜28.14 s、Phase A 9.10〜9.14 s、Phase D' Planner 3.26〜3.42 s。slotごとの値は公開RESULT）。
Node referenceの時間（子processのwall。vite SSR loader等を含む）とは計測範囲が異なるので換算・比較しない。

### 6.3 応答性（観測値）

| 指標 | first Worker | fresh Worker |
| --- | --- | --- |
| yield回数 / heartbeat / progress event（timing run） | 22,575 / 20 / 118 | 27 / 1 / 24 |
| 最大同期slice（stage別、timing run） | Phase B / C 3,106 ms、Phase D' Planner 2,403 ms、Phase 0 1,063 ms、Trace Replay 280 ms、final input 186 ms、Phase A 8.5 ms、Phase D 27.8 ms | Phase D' Planner 2,441 ms、Phase 0 1,026 ms、Trace Replay 284 ms |
| 最長のyield間隔（timing run） | 3,107 ms（Phase A終了 → Phase B / C） | 2,763 ms（Phase D' Planner → evidence） |
| chained ping（responsiveness run） | 15,295回、lost 1（settle時の未応答）、median 0.1 ms、p95 2.2 ms、max 2,829.7 ms | 203回、lost 1、median 0 ms、p95 28 ms、max 1,529.7 ms |
| main threadで観測したmessage間隔の最大 | 3,106 ms | 3,109 ms |

Worker event loopの応答性であり、UI frame rateではない。Phase AはyieldごとのsliceがPhase内で最大8.5 msだった一方、Phase B / C・Phase 0・Phase D' Plannerには
秒単位の同期区間がある（§6.5のcancel ack遅延と整合する）。

### 6.4 memory（`pc.memory.1`、isolated origin。観測値）

| scope | 方法 | 値 |
| --- | --- | --- |
| Worker isolateのused heap | 外部CDP `Runtime.getHeapUsage`（約500 ms間隔、エラー0） | first: max sampled used **430,659,028 bytes**（total 474,796,032）、75標本。fresh: max sampled used **373,307,116 bytes**（total 434,372,608）、29標本 |
| Chrome renderer process | OS `PrivateMemorySize64` / `WorkingSet64`（約1,000 ms間隔、renderer 4 process中の最大） | max sampled private **1,243,992,064 bytes**、working set 1,299,509,248 bytes、225標本 |
| page + Worker（固定点） | `measureUserAgentSpecificMemory()`（10点、解決1〜60 s） | 7.4〜11.9 MB。Worker分はready時の2,503,706 bytesだけで、settle以降は0（settle直後にterminateするため。Workerの最大使用量は捉えない） |
| main realm JS heap | `performance.memory` | used 6.4〜25.8 MB、`jsHeapSizeLimit` 4,395,630,592 bytes（page realmの値。Worker上限ではない） |
| Worker realm `performance.memory` | — | 利用不可 |
| Dedicated Workerのheap上限 | — | 不明（Browserが公開しない） |

sampling値は連続的なpeakではない。Node heap / RSS（D-1C）とBrowser heapは別scopeであり換算しない。OOM・page lossは無かった。

### 6.5 cancel試験（6件すべて `cancel_passed`）

| slot | 受付時のstage（狙い） | 受付（post後） | ack | settle | 経路 | Workerの停止位置 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `pc.cancel.phase-a` | Phase A | 3,192.8 ms | 3.5 ms | 3.6 ms | `gab_cancelled` | `evidence`（`before_result`） |
| `pc.cancel.phase-bc` | Phase B / C | 13,382.4 ms | 370.8 ms | 375.3 ms | `gab_cancelled` | `evidence`（`before_result`） |
| `pc.cancel.phase-d` | Phase D | 23,111.9 ms | 2.9 ms | 12.9 ms | `gab_cancelled` | `phase_d_prime`（`cancel_point`） |
| `pc.cancel.planner` | first Phase D' Planner | 24,907.4 ms | なし | 2,678.0 ms | 捨てた `gab_result`（C2） | — |
| `pc.cancel.trace-replay` | first Trace Replay | 27,768.3 ms | なし | 246.9 ms | 捨てた `gab_result`（C2） | — |
| `pc.cancel.fresh-planner` | fresh Phase D' Planner | 2,347.3 ms | なし | 2,590.9 ms | 捨てた `gab_result`（C2） | — |

- 全件: requestは `running` で受付、settleちょうど1回、採用結果0、Worker terminate、late response 0。first側のcancelではfreshを起動していない。
  再実行slot `pc.rerun.2` は両Worker完了（`browser_nonformal_conditions_met`）
- Phase A / B・C / Dでは、Workerが自分でcancelを受けて止まった（記録上の順序）。Phase A: 受付の約3 ms後に `materialization:reach_table` が出てmaterializationが終わり、
  semantic recordのhash後、結果送信前のflag確認で `gab_cancelled`。Phase B / C: 受付の約370 ms後（同期slice）に `materialization:structural_search` が出て、同様に結果送信前に停止。
  Phase D: 受付後もcandidateの残りが約8 msで決着し、Phase D'開始前のcancel点で停止。いずれもPhase D'へ進まず、freshを起動していない
- Phase D'（Planner・Trace Replay）では、Workerは結果を送るまで `gab_cancel` をdispatchせず（ackなし）、cancel受付後に届いた `gab_result` をmain threadがC2で捨てて `cancelled` にした。
  P-1 §15で「実Browserでは未観測」としたC2の経路を、実Chromeで3件観測した。cancel後に結果を採用しない保証はmain threadのrequest lifecycleで守られた

### 6.6 終了経路の集計（parityと独立）

| 区分 | first | fresh |
| --- | ---: | ---: |
| completed | 7 | 6 |
| cancelled（うち捨てた `gab_result`） | 5（2） | 1（1） |
| cancelled_terminated / timeout / worker_error / worker_reported_error / page_left | 0 | 0 |
| not_run（firstのcancelでfreshを起動しない） | 0 | 5 |

page loss 0、out_of_memory 0、environment_unsupported 0、環境中断 0、未記録slot 0、未完了run（cancel以外）0、計画外record 0。

### 6.7 storage

両session（非isolated / isolated）の開始時と終了時に、IndexedDB database 0、localStorage 0、sessionStorage 0、Cache Storage 0、Service Worker登録 0（変化なし）。
Worker bundleに含まれるDexie instance生成（P-0 §4.3）は、実ExportのrunでもDBを開かなかった。

## 7. 公開RESULTと再導出

- [P-2 RESULT](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_RESULT.json)（86,152 bytes、SHA-256 `9031d3ba9dcaf46db2dfb59b7ac0a3405a171fb76e5a55e15f42bc73ad7cea2c`）は、
  `node scripts/analyze-planner-global-assignment-browser.mjs --measurement-head 3dfe24aa3574921bfe4596db3b2280a7a397cc91 --browser-raw-dir .local/global-assignment-browser-p2/p2-r1/browser/raw --driver-record .local/global-assignment-browser-p2/p2-r1/browser/driver.json --node-output .local/global-assignment-browser-p2/p2-r1/node.result.json --node-run-dir .local/global-assignment-browser-p2/p2-r1/node.run --public docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_RESULT.json`
  で導出した（18 source: 計画、D-1C RESULT、raw 12、driver記録、Node出力・record 2。各source fileのbytes・SHA-256を記録）
- 同じrawから `--check` を2回実行し、2回とも `ok: true`・issue 0・同じSHA-256で再導出が一致した
- 公開RESULTはTarget / OwnedWeapon / Entry / Candidate ID、Counter位置、Plan Step、raw Entry、local絶対path、Target単位の配列、UUID、Export本体を含まない
  （analyzerの最小化検査: raw recordから集めた識別子のどれも含まない、禁止key・未知の配列なし）。integrity issueの本文は件数だけを残す
- raw（Browser 12 file、driver記録・log、Node run directory、build・preview log、mechanics確認、dry run）はgit-ignoredな `.local/global-assignment-browser-p2/` に保持し、上書きしていない

## 8. 検証

| command | 結果 |
| --- | --- |
| `git diff --check` / `npm run check:nul` | 問題なし / NUL byteなし |
| `npm run lint` | 成功 |
| `npm test` | 437 file passed / 1 skipped、7,066 passed / 3 skipped（skipは既存の `src/research/issue74`。P-1時点の7,019から +47） |
| `npm run build` | 成功。通常 `dist/` に `gab_`・`global-assignment-browser`・`globalAssignment`・`GLOBAL_ASSIGNMENT`・`GlobalAssignment`・`runMaterializationSmoke`・`verifyPlannerCandidate`・`benchmark-global-assignment`・`registeredD1cConditions`・`research.global`・`analyzeGabMeasurement`・`judgeGabEnvironmentParity`・`gabMeasurementPlanIssues` を含むfileは0 |
| `npx vite build --config vite.benchmark.config.ts` | 成功（measurement HEAD、build provenanceは§2） |
| browser folder test（12 file） | 連続4回すべて成功（analysis testのcancel slotは、in-process Workerがcancelをawait点で受けるか結果を捨てるかがtimingで変わるため、両経路をpassとして受ける形にした） |

## 9. 未確認事項・制約（検証済みとして扱わない）

- **Android / iPhone**: 未確認（端末・安全な経路なし）。PCの結果をスマートフォンの性能・成否の保証にしない
- 他のmachine・Browser（Edge / Firefox / Safari）・Chromeの他version、他のExport・window・条件、2件目以降のstructural candidate
- Dedicated Workerのheap上限、sampling間の連続的なpeak、OSの空きmemory。memoryは1 run（`pc.memory.1`）の観測だけ
- 時間は1台・1 session・3 runの分布で、温度・背景負荷（CPU 6〜36%）の影響を分離していない。性能の許容値は決めていない
- cancel試験の遅延は各stageを狙った固定値で、各stage内の全時点でのcancelを網羅していない。Phase D'の同期区間中のcancelはackされず、結果到着まで待つ（その間 計算は続く）
- `localeCompare` を使うDomain順序の環境差: 今回の環境は `ja` だけで、差は観測されなかった（他localeは未確認）
- 本系列はheadedのChromeだが、画面を操作するuserの影響の有無は記録していない（visibility / freeze / pagehideは0件）

## 10. 所見（判定ではない）

- PC Chromeでは、実Exportのfirst Worker（materialization + Phase D'）が約27.7 s、fresh Workerが約5.0 s、logical run全体が約34.8 sで完走し、Node・D-1Cと同じsemanticになった
- 応答性: Phase B / C（約3.1 s）、Phase D' Planner（約2.4 s）、Phase 0（約1.06 s）に秒単位の同期区間があり、その間はpingもcancelも届かない
- memory: Worker isolateのused heapは最大約431 MB（sampled）、renderer processのprivate memoryは最大約1.24 GB（sampled）
- これらを性能の合否・Production可否の判断に使うかは、プロジェクトオーナーが決める（P-0 §15 #9 / #10）。**P-2はここで停止し、Production統合・性能基準の決定・Phase Eには進まない**
