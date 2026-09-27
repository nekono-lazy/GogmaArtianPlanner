# Global Planner Research Phase 2-A（Browser Worker実測）

**Phase 1-EのResearch semanticsは、実Browser（Chrome 153）のBrowser Workerでもそのまま成立した。**
original Exportだけから各attemptを新しいBrowser Workerで実行し、`normal-2x-fallback` は
**43/43 completed・Conflict 0・rejected 0・resource_conflict 0・Trace Replay passed・8,534 steps・expandedStates 8,577** になった。
Phase 1-E Node winnerとのsemantic parityは完全で、Phase 1-E reproduction semantic SHA
`b8ac8bdf4af43224df2947067c13c23113b6c994388fabbc29cd4e992a00a9f8` が、正式測定のnormal-2x fallback 11 recordのうち
**completedした9 recordすべて** で一致した（残り2 recordはcancel専用run。後述）。
winner単体のround trip中央値は **86.9秒**（measurement 3回）、Phase 1-Eと同じ3axis比較のcontrollerは **345.4秒**、
最初の43/43までは **165.6秒** だった。一方、**final Planner stageでWorker event loopが最大13.3秒応答しない** 区間と、
その区間でWorker JS heapが約1.7 GiBまで増える挙動を観測した。

これはResearchであり、Production化・仕様変更はしていない。8,534 stepsはProduction default `maxPlanSteps = 1000` を超える。
計測はPC Browser（Windows / Chrome）のみで、スマートフォンは未確認。

Refs #154。開始時のmain / origin/mainは `b11442649c008dd2da585af4bf612d7a0b00a23e`（PR #164）、Working Treeはclean、Issue #154はOpen。
branch: `claude/global-planner-phase2a`。PR #159〜#164、Phase 1-B〜1-E文書、既存Browser benchmark（B5 / B8 / Planner Alternative Phase 3）を確認した。

## 目的・変更境界

Phase 1-EはNode（8 GiB V8 heap、Vite SSR loader、fresh child process）での計測だった。Phase 2-Aは同じResearch semanticsを
実Browser Workerで実行し、(A) 43/43になるか、(B) Nodeとsemantic parityがあるか、(C) 時間、(D) raw block cacheの効果、
(E) cancel / ping応答、(F) Browserで観測できるmemory、(G) 次に優先すべき障害を確認する。

Production behavior変更なし。Production Planner / Search Worker protocol・`PlannerWorkerClient` / `SearchWorkerClient`・Production Worker entry
（`setTimeout(0)` yieldを含む）、Candidate Search semantics / default extent、Planner routing、UI、Persistence / Dexie / Export schema、
CalculationContext（17）、`PRODUCTION_RNG_ENGINE_VERSION`（`production-rng:c5-e7`）、Production `maxPlanSteps`（1000）、REQUIREMENTSの現行契約を
変更しない。raw block cacheは引き続きResearch-onlyのper-searchで、`new ProductionRngEngine()` のdefaultは変えていない。これらはテストで固定した。

参照authority: REQUIREMENTS、PLANNER_SPEC、SEARCH_SPEC、RNG_SPEC、Phase 1-B〜1-E Research文書、B5 / B8 / Planner Alternative Browser benchmark記録、
AGENTS.md、AI_DEVELOPMENT_WORKFLOW。

## benchmark-only構成

`benchmark.html`（`vite.benchmark.config.ts`）の「Global Planner Phase 2-A」タブだけから到達する。通常アプリからのroute・importは無い。

| 役割 | ファイル |
| --- | --- |
| protocol（`pg2a_benchmark_` prefix、run / cancel / ping → ready / accepted / pong / cancel_ack / progress / result / cancelled / error） | `src/benchmarks/plannerGlobalBrowserBenchmarkProtocol.ts` |
| semantic evidence（Node runnerと同じ `sha256(JSON.stringify(value))`、Web Crypto） | `src/benchmarks/plannerGlobalBrowserEvidence.ts` |
| main-thread harness（1 harness = 1 Worker = 1 run） | `src/benchmarks/plannerGlobalBrowserBenchmark.ts` |
| runner（records、series、Phase 1-E controller、chained ping、cancel trigger、memory sampling、JSON export） | `src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts` |
| Worker controller / entry | `src/workers/plannerGlobal.worker.benchmark(.entry).ts` |
| page | `src/pages/PlannerGlobalBrowserBenchmarkPage.tsx` |

- **Worker内でResearch algorithmそのものを実行する**: `ProductionRngEngine`（Planner / Trace Replay）、`runGlobalPlannerResearch()`、
  Phase 1-E generic fallback（`createPhase1EFallback()`、episode上限3、fallback budget 180秒）、`GlobalRawBlockResearch`（Candidate Search用）、
  yield、cancel stateをWorker自身が持つ。main threadはResearch計算をしない（入力準備とcontrollerの比較だけ）。
- **入力はpageで選んだoriginal Export JSONだけ**。main threadでSHA-256（Web Crypto）を取り、既存の `globalResearchInputFromExport()`
  （pure validation、IndexedDBへImportしない）でPlannerInputを1回構築し、各Workerへstructured cloneで渡す。Target ID・winner情報・
  Phase 1-C〜1-Eの結果JSONはruntime inputにしない（source scan testで固定）。入力構築は計測外（約0.17秒）。
- **fresh Worker policy**: 1 attempt = 新しいWorker。harnessとWorker controllerの両方が2回目のrun・重複requestIdを拒否する。
  `Worker作成直前 → ready`（module評価完了）、`request post → accepted`、`request post → result settle` を別々に記録する。
- **yield**: benchmark Workerは原則MessageChannel macrotask yield（B5 / B8と同じ方式を局所copy）。`timer` も選べる。microtaskは不可。
  Production `planner.worker.ts` の `setTimeout(0)` は変更していない。
- **raw cache**: `off`（同じpass-through observer、cacheなし）と `per-search`（Phase 1-Bと同じ、actual derived seed + block index key、
  成功blockのみ、Search終了で解放、run-global cacheなし）。Workerごとに独立。
- **progress observation**: benchmark専用。stage / Search index / Search status / fallback statusが変わったときだけ送る（cancel trigger・
  最後の有効progressの保存用）。Production protocolへprogressを追加していない。
- **semantic evidence**: Search evidence（Search結果から `elapsedMs` を除いたもの、Candidate）、fallback Search evidence、generated Entry
  （Entry / Candidate snapshot）、final selected Entry IDs、Plan / final result / result（finalResult + generatedEntries）SHA-256、
  そしてPhase 1-E reproductionと同じ構造・同じkey順のsemantic（retained IDs、pending順、state、Search status列、fallback、各evidence、
  stop、final summaryから `elapsedMs` を除いたもの）とそのSHA-256。elapsed / memory / environmentは含まない。
- **JSON export**: pageの「JSON保存」とconsole API `exportJson()` が `planner-global-phase2a-browser_<timestamp>.json` を作る。
  environment、Export SHA、workload設定、timing、semantic evidence、ping、cancel、memory、controller結果を含み、raw Export・Candidate全文・
  Plan全文は含まない。
- benchmark buildは自分のprovenance（build時のgit HEAD、benchmark-affecting codeの未commit有無、そのcodeのSHA-256）を埋め込む。
  COOP / COEP headerは `BENCHMARK_CROSS_ORIGIN_ISOLATED=1` のときだけbenchmark preview / serverへ付く（既存harnessの既定環境と
  通常 `vite.config.ts` は変えない）。

### Task M（PR #164 reviewのOptional）

Browser controllerはWorker failure（`worker_error`）とprotocol error（`error`）をattemptとして扱うため、Phase 1-E controllerの
retry条件をResearch-onlyで明確にした。`isRetryablePartialAttempt()` = stopなし・report `partial`・errorなし・final Planあり、のattemptだけが
retry可能なpartialで、全initialがこれを満たすときだけretryを開始する。error / memory_limit / process_error / cancel / time_budget /
blockerはpartialとしてretryへ流さない（`nonRetryableInitial` として記録）。Phase 1-Eのrunでは全initialが完了 or partialだったため、
Phase 1-Eの結果は変わらない。テストを追加した。

### Browser controllerのfailure保持（PR #165 review）

最初の実装では、Workerが `accepted` を返す前に壊れると（record `result` も `priorityEntries` も無い）、`runController()` の
adapterがthrowして `runPhase1EController()` 全体がrejectし、すでに得たcompleted winnerまで失う経路があった。これはPhase 1-D / 1-Eで確定した
「一度completed variantを得たら後続のfailure / cancel / deadlineで失わない」契約をBrowser adapter境界で破る。修正後は:

- runが自分の `priorityEntries` を返した場合はそれを使い、controller-localの既知priorityとして保持する（`runPhase1EController()` の
  「fresh run間でpriorityが異なれば拒否」は維持）。
- `accepted` 前に壊れたrunには、同じoriginal inputの先行runで得た既知priorityを **そのfailure attemptを返すためだけに** 使う。attemptは
  `process_error`（worker_error）/ `attempt_error` のままで、completed・partial・no-matchには変換しない（`nonRetryableInitial` に残り、
  retryは開始しない）。再利用したrecordは `priorityReusedForRecordIds` に記録する。
- まだ一度もpriorityを得ていない（最初のcontrolが `accepted` 前に壊れた等）場合は、推測せずfail closedのまま。

testで「control正常 → normal 43/43 → gogmaが `accepted` 前にnative Worker error → skillは通常実行」を固定した: controllerはthrowせず、
outcome `completed`、winner normal initial、retry未開始、gogmaは `process_error` / final nullのfailure、skillまで実行される。
修正前コードではこのtestが失敗することも確認した。正式測定ではこの経路は発生していない（下記の測定結果は変わらない）。

### CIのMessageChannel test（PR #165 CI failure）

旧testは「別MessageChannelにpendingなmessageが、`plannerGlobalMessageChannelYield()` の5 turn以内にdispatchされる」ことを期待しており、
別MessagePort間のdispatch順序（fairness）に依存していた。GitHub Actions Linuxではこれが保証されずfailureした（runtimeの問題ではない）。
yield実装は変えず、testを「`plannerGlobalMessageChannelYield()` のresolveが、先にqueueされたmicrotaskより後になる」ことを直接比較する形へ
変えた（microtaskとして解決するyieldなら順序が逆になり失敗する）。ping / cancelがyieldを介して届くtestはそのまま維持した。

## 実施環境（正式測定）

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-09-27（UTC 14:52〜15:22、JST 23:52〜翌00:22） |
| measured HEAD | `d61122649707797d9c746c5be3f4b6198c11c7cb`（PR #165 review修正をcommitした後に全workloadを再測定） |
| benchmark code SHA-256 | `70282eb370d21b45f5caff905700792cc6e933b630318838ae457ab1097d082b`（build埋め込み、未commit codeなし） |
| build / preview | `BENCHMARK_CROSS_ORIGIN_ISOLATED=1 npx vite build --config vite.benchmark.config.ts` → `... npx vite preview --config vite.benchmark.config.ts --host 127.0.0.1 --port 4173 --strictPort`（production benchmark build、dev serverではない） |
| URL | `http://127.0.0.1:4173/GogmaArtianPlanner/benchmark.html` |
| Browser | Google Chrome 153.0.8010.49（desktop、一時プロファイル）。flags: `--remote-debugging-port`、`--remote-allow-origins`、`--no-first-run`、`--no-default-browser-check`、`--disable-backgrounding-occluded-windows`（visibilityをvisibleに保つため） |
| userAgent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36`（UA-CH platformVersion 19.0.0） |
| OS | Windows 11 Pro 10.0.26200（x64） |
| CPU / memory | AMD Ryzen 7 9700X（16 logical）/ 32 GB。`navigator.hardwareConcurrency` 16、`navigator.deviceMemory` 32 |
| crossOriginIsolated / secureContext | true / true |
| visibilityState | 全16 recordで開始・終了とも `visible`、visibilitychange 0回 |
| memory API | `performance.measureUserAgentSpecificMemory` あり（crossOriginIsolated）、main realm `performance.memory` あり、Worker realm `performance.memory` なし |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17 |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`、schemaVersion 13、Target 43、BuildListEntry 43 |
| raw cache / yield | 主経路 `per-search` / `message-channel`（比較で `off`） |
| Research bounds | base N350 / G500 / S1500、fallback factor 2、episode 3 / attempt、fallback budget 180秒、attempt budget 900秒、Research maxPlanSteps 20000（Production default 1000とは別） |
| 背景負荷 | 各task開始・終了時の `Win32_Processor.LoadPercentage` 8〜38%（Claude desktop等。benchmark Worker 1本分を含む）。補正していない |

page操作はconsole API（`globalThis.plannerGlobalBrowserBenchmark`）をCDP `Runtime.evaluate` で呼び、Exportの選択はCDP
`DOM.setFileInputFiles` でpageのfile inputへ渡した（pageの通常の入力経路）。driverはstep毎に `exportJson()` を保存しただけでrecordを
作り変えていない（driverはscratchpadの計測tooling、commitしていない）。memory run中だけ、driverが別途CDP `Runtime.getHeapUsage`（Worker target）と
OSのrenderer process memoryを採取した。正式測定中にtest / build / Node benchmarkは並行実行していない。

### 前回測定（参考、集計には混ぜない）

PR #165初版はmeasured HEAD `3258b935dd07a1bd49ca81aa8d1e660faafaa909`（benchmark code SHA `2d883423…4500`）で同じworkloadを測った。
review修正でbenchmark-affecting code（runner）を変えたため、全workloadを上記HEADで再測定し、本書の値はすべて再測定のものに置き換えた。
前回と今回でsemantic（全recordのsemantic / result / Plan SHA、status、Conflict、steps）は同一で、時間は数%以内の差だった
（例: winner round trip中央値 前回88.8秒 → 今回86.9秒、controller 362.0秒 → 345.4秒、ping最大13.5秒 → 13.3秒）。
さらにその前に未commit codeでsmoke 1回を行っている（集計外）。

## Node Phase 1-E比較基準（文書化段階でだけ参照）

Browser runtimeはPhase 1-Eの結果JSONを読まない。比較は計測後に `docs/PLANNER_GLOBAL_PHASE1E_*.json` と行った。

| 区分 | Node Phase 1-E |
| --- | --- |
| control | 42/43、Conflict 2、rejected 1、7,330 steps、result `d799923f…0ccc0e`、Plan `5db23122…33bf6`、wall 154.7秒 |
| normal winner | 43/43、Conflict 0、rejected 0、8,534 steps、expandedStates 8,577、result `7046b2ab…2579`、Plan `6c380cb3…ef66`、final result `c133660b…651f`、fallback Candidate `e8608eea…51ac`、semantic `b8ac8bdf…a9f8`、wall 178.3秒（Search 99.2 / fallback 7.2 / Planner 66.0） |
| controller | 3axis比較wall 716.0秒、最初の43/43まで333.0秒 |

## 結果

### Workload 1: Phase 0 control（fallbackなし、per-search）

| run | completed | Conflict | rejected / resource | steps | expandedStates | Trace Replay | round trip | Search | Planner |
| --- | --- | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: |
| control（measurement） | 42/43 | 2 | 1 / 1 | 7,330 | 7,372 | passed | 79.3秒 | 42.5秒 | 31.6秒 |
| controller内control | 42/43 | 2 | 1 / 1 | 7,330 | 7,372 | passed | 78.1秒 | 41.4秒 | 31.5秒 |

retained 20 / pending 23（run自身が導出）、index 20の `813fb479-…` がbounded no-match（Target IDは観測結果）。result SHA `d799923f…`、
Plan SHA `5db23122…` はNode controlと同一。Node controlのsemantic構造と **field単位の差分0**。

### Workload 2: normal-2x-fallback（主要workload）

fresh Worker、warm-up 1回 + measurement 3回。全4回とも:

- **43/43、Conflict 0、rejected 0、resource_conflict 0、steps 8,534、expandedStates 8,577、Trace Replay passed**、stop `completed`
- index 20（`813fb479-…`）のbase Searchが `not_found_within_extent`（観測reach N350 / G500 / S1501）→ Normal 2倍fallback（N700 / G500 / S1500、
  searchRunId `research.global.search.fnv1a32:c35d5e3f`）が `found`（`normal_artian_to_gogma` 896操作、advance N643 / G1 / S252、fallback reach 700 / 500 / 895）
- generated Entry 23、final selected 43、fallback 1回
- semantic SHA `b8ac8bdf…a9f8`、result `7046b2ab…2579`、Plan `6c380cb3…ef66`、final result `c133660b…651f`、fallback Candidate `e8608eea…51ac`

| 項目（ms） | measurement 1 | 2 | 3 | **中央値** | 参考: Node Phase 1-E winner |
| --- | ---: | ---: | ---: | ---: | ---: |
| Worker作成 → ready | 23.6 | 23.4 | 23.2 | **23.4** | — |
| request post → accepted | 18.4 | 18.3 | 18.2 | **18.3** | — |
| request post → result（round trip） | 86,879.5 | 86,944.8 | 87,574.4 | **86,944.8** | wall 178,252 |
| Worker elapsed（accepted → result post） | 86,860.9 | 86,926.4 | 87,556.0 | **86,926.4** | — |
| うちResearch計算 | 86,513.7 | 86,574.1 | 87,214.5 | **86,574.1** | 176,608 |
| うちevidence（SHA-256等） | 346.5 | 351.6 | 341.1 | **346.5** | — |
| Search（fallback込み） | 44,713.9 | 44,965.0 | 45,686.5 | **44,965.0** | 99,225 |
| fallback Search | 2,816.7 | 3,182.2 | 2,811.5 | **2,816.7** | 7,168 |
| Planner | 36,268.0 | 36,109.4 | 36,036.6 | **36,109.4** | 65,969 |

warm-upはround trip 88,283ms。Candidate Search 23回・fallback 1回は全runで同じ。

Nodeとの時間差（約2倍）は **環境差であり、同一条件の比較ではない**。Node childはVite SSR module loader上で、Research prediction profiler
（Phase 1-B以降の観測用observer）が常に有効だった。Browserでprofilerを有効にしたprobe 1回は93.8秒（Search 51.7、Planner 36.3）で、
profilerだけでは差を説明しない。差の原因は計測していない。

### Workload 3: Phase 1-E 3axis controller（fresh Workerごと）

Browser main threadで既存 `runPhase1EController()` を、control → normal → gogma → skill（`EXTENT_AXES` の安定順）の各attemptを
新しいWorkerで実行した。Phase 1-E結果はruntime inputにしていない。

| attempt | 結果 | fallback | steps | round trip | Search（fallback） | Planner | Node比較 |
| --- | --- | --- | ---: | ---: | --- | ---: | --- |
| control | 42/43、Conflict 2、rejected 1 | — | 7,330 | 78.1秒 | 41.4秒 | 31.5秒 | field差分0 |
| normal initial | **43/43、Conflict 0、rejected 0** | found | 8,534 | 87.5秒 | 45.2秒（2.8秒） | 36.3秒 | semantic SHA一致 |
| gogma initial | 42/43、Conflict 2、rejected 1 | not_found（reach 350 / 1000 / 1501） | 7,330 | 96.9秒 | 60.4秒（19.1秒） | 31.3秒 | field差分0 |
| skill initial | 42/43、Conflict 2、rejected 1 | not_found（reach 350 / 500 / 3001） | 7,330 | 82.8秒 | 46.0秒（3.4秒） | 31.5秒 | field差分0 |

- outcome `completed`、winner normal initial、ranking normal → gogma → skill（Phase 1-Eと同じ）、`initialSuccess = true`、
  **retry未開始**（全initialがpartialではないため）、`nonRetryableInitial = []`、`priorityReusedForRecordIds = []`
- gogma / skillの最終Planはcontrolと同一（result `d799923f…`、Plan `5db23122…`）で、Node initial variantsとfield差分0
- **最初の43/43までの時間: 165.6秒**（control 78.2秒を含む。Node 333.0秒）
- **3axis比較完了: 345.4秒**（controller elapsed。Node 716.0秒）
- Worker heap / OOM問題はgogma（Node peak 4.68 GiBだった軸）でも起きなかった

### semantic parity（まとめ）

正式測定のrecordは16件（うちcontroller 4件）。`docs/PLANNER_GLOBAL_PHASE2A_BROWSER_RESULTS.json` のrecordを数えた内訳:

| 区分 | record数 | 結果 |
| --- | ---: | --- |
| normal-2x fallback、completed（warm-up 1、measurement 3、raw cache off、responsiveness、memory、controller normal initial、profiler probe） | **9** | 全recordでsemantic SHA `b8ac8bdf…` = Node Phase 1-E reproduction semantic SHA、field差分0 |
| normal-2x fallback、cancel専用run（base Search中、fallback中） | **2** | `cancelled`。途中で止めたrunなのでwinnerとsemanticは比較しない（同じrun同士の再現性は前回測定とsemantic SHA一致） |
| control（measurement、controller） | 2 | Node controlのsemantic構造とfield差分0（result / Plan / final result SHA、Search evidence 23件、generated Entry 22件、selected 42件、status列） |
| gogma initial（controller、gogma memory）、skill initial（controller） | 3 | Node initial variantsとfield差分0 |

field差分の比較対象: retained original Entry IDs、pending Target順、Search status列、fallback発動位置・axis・extent・searchRunId・
requestFingerprint・generated Entry ID、fallback Search evidence（Candidate SHA）、Search evidence、generated Entry IDs / body SHA、
final selected Entry IDs、Plan / final result / result SHA、stop、final summary（completed、Conflict、rejected、resource_conflict、steps、
expandedStates、Trace Replay等）。**差分は0件で、「Browser差」として説明が必要なものは無かった。**

### raw block cache: off vs per-search（Browser）

| mode | round trip | Search | fallback Search | Planner | raw reads | hits | reader時間 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| per-search（measurement中央値） | 86.9秒 | 45.0秒 | 2.8秒 | 36.1秒 | 954,530 | 948,149（99.33%） | 1.1秒 |
| off（1回、budget 900秒） | **242.6秒** | 201.2秒 | 23.1秒 | 35.7秒 | 954,530 | 0 | 148.4秒 |

cache-offはbudget内に完走し、semanticはper-searchと完全同一（SHA `b8ac8bdf…`）。Browserでもper-search cacheはSearchを約4.5倍速くし、
Planner時間は変えない（Plannerはcacheを使わない）。offは1回だけの測定。

### Worker responsiveness（別run）

normal-2xを1回、main threadからchained ping（pongを受けたら即次のping）しながら実行した。**Worker event loop responsivenessであり、UI frame rateではない**。
visibilityはvisible。

| ping数 | lost / timeout | 中央値 | p95 | 最大 | run round trip |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 39,136 | 0 | 0.25ms | 6.4ms | **13,268ms** | 87.1秒 |

200ms超の間隔は27回。最大13.3秒はrequest後約73.8秒、`final_planner` stage（68.1〜86.8秒）の中で、scheduler部分（64 action毎にyieldする）の後の
同期区間と推定される（Trace Replay / Plan生成等の内訳は計測していない）。1〜3.6秒級の間隔はbaseline / retained prefix / 単体Candidate適用の
各full Planner runに対応する。Search中はほぼ常に数ms以内で応答した。

### cancel（別run、benchmark専用observation）

| 試行 | trigger | cancel要求 | Worker ack | settle | 結果 | 後からのresult |
| --- | --- | --- | ---: | ---: | --- | --- |
| base Search中 | discovery index 0のSearch開始観測（8.32秒）+ 1秒 | 9.33秒 | 0.80ms | 2.45ms | report `cancelled`、index 0は1秒以内にfound、index 1のSearchが `cancelled`、stop `cancelled` | 5秒待って0件 |
| fallback中 | index 20のfallback `searching` 観測（57.24秒）+ 1秒 | 58.24秒 | 0.65ms | 23.10ms | fallback `cancelled` / `external_cancel`、base status `not_found_within_extent` は保持、report `cancelled` | 5秒待って0件 |

cancelはnot_found（no-match）にも `time_budget_reached` にもならなかった。ack / settleはcancel post基準のmain-thread時間。
ただしresponsivenessの結果から、**final Planner中のcancelは最大で十数秒待たされ得る**（今回そこでのcancelは測っていない）。

### memory（別run、scopeを区別）

memory runはtiming runと分けた（sampling自体、特に `measureUserAgentSpecificMemory()` の解決に10〜60秒かかり、attempt wallを延ばすため）。
page側は Worker作成前 / ready後 / 実行中（15秒毎、重ならない）/ result直後 / Worker dispose後 / 10秒待機後（参考）で採取した。
いずれも一定間隔samplingなので値は **max sampled** であり、連続的なpeakではない。

| scope | normal-2x | gogma-2x（参考） |
| --- | --- | --- |
| Worker isolate JS heap（CDP `Runtime.getHeapUsage` usedSize、約2秒毎、未回収garbageを含む） | max sampled **1.731 GiB**（totalSize 1.796 GiB） | 1.483 GiB（1.555 GiB） |
| page + Worker aggregate（`measureUserAgentSpecificMemory`、GC後のlive相当） | max sampled 258.8 MB（うちDedicatedWorker 248.0 MB） | DedicatedWorker 178.1 MB |
| main realm only（`performance.memory`） | used 約9.7 MB（`jsHeapSizeLimit` 4,395,630,592 bytes） | 約10.4 MB |
| Browser process（Windows、renderer process PrivateMemorySize64、約5秒毎） | max sampled **3.939 GiB**（WorkingSet 3.975 GiB） | 3.542 GiB |
| Worker realm `performance.memory` | unavailable（Chrome WorkerGlobalScopeに無い） | unavailable |

- Worker heapは各Search・full Planner runでGC付きに上下し、Discoveryでは最大約0.92 GiB、**final Planner stageで約0.31 GiBから1.73 GiBへ増えた**
  （その後result・dispose前は未回収のまま）。result直後の `measureUserAgentSpecificMemory` ではDedicated Workerは約4.4 MBで、最終的なlive setは小さい。
- **Browser OOM・renderer crash・worker_errorは全16 run（正式測定）で無かった**（前回測定・smokeでも無かった）。Chromeの専用Worker heap上限値は
  Worker realmから取得できない（main realmの `jsHeapSizeLimit` は約4.09 GiB）。Phase 3-Bでは約4 GBでrenderer crashを観測しており、
  今回のWorker heap max sampled 1.73 GiBはその範囲内だが、sampling間のpeakは保証しない。
- **Node RSS（Phase 1-E 3.88 / 4.68 GiB）とBrowser値は別scopeで、互いに推定していない。**

## 判断（Phase 2-A）

| | 問い | 結果 |
| --- | --- | --- |
| A | Browser Workerでも43/43か | **はい**（completedしたnormal-2x 9 record全て、Conflict 0 / rejected 0 / Trace Replay passed） |
| B | semantic parityは完全か | **完全**（semantic SHA一致、control / gogma / skillもfield差分0） |
| C | 時間 | winner round trip中央値86.9秒、3axis比較345.4秒、最初の43/43まで165.6秒（PC Chrome） |
| D | per-search raw cacheはBrowserでも有効か | **有効**（Search 201.2 → 45.0秒、hit 99.33%、semantic同一） |
| E | run中もcancel / pingへ応答できるか | Search中は応答する（ping中央値0.25ms、cancel ack 0.65〜0.80ms）。**final Planner中に最大13.3秒の無応答区間がある** |
| F | Browser memoryは現実的か | PCでは完走・OOMなし。ただしWorker heap max sampled 1.73 GiB、renderer private 3.9 GiBは、スマートフォン・低memory端末では成立を保証しない水準 |
| G | 次の優先 | **Planner（final full run）とPlan length**。同期ブロックとheap増加の両方がfinal Planner stageに集中し、8,534 stepsの長いPlanと直結する |

### PC Browser / スマートフォン

今回の結論はWindows 11 + Chrome 153 + 32 GB RAM + 16 logical CPUのPC Browserに限る。スマートフォン（CPU、メモリ、Worker heap上限、
バックグラウンド時のthrottle）は **未確認**。

### Production化の障害（今回観測したもの）

1. **Plan長**: 8,534 steps / expandedStates 8,577はProduction `maxPlanSteps = 1000` を超える（Research bound 20000で実行）。oracle 2,982 stepsの約2.86倍。
2. **final Planner stageの同期ブロック**: 最大13.3秒Worker event loopが止まり、その間cancel / pingが届かない。Production UI側のcancel体験に直結する。
3. **final Planner stageのheap増加**: 約1.4 GiBの増加（max sampled）。低memory端末で問題になり得る。
4. **Candidate Search時間**: per-search cache前提で45秒。cacheはResearch-onlyで、Production Engineへ入れるかは別判断。
5. **Worker architecture**: 1 attempt = 1 Worker、3axis比較は逐次で345秒。並列化は未検討（memoryとのトレードオフ）。
6. 仕様: 自動再検索禁止（REQUIREMENTSの現行契約）との関係、`maxPlanSteps` policy。

## 次Phase推奨

1. **final Planner stageの内訳計測とPlan長**（最初に着手）: final full runのscheduler / Trace Replay / Plan projection各区間の同期時間とheap増加を
   Browser Workerで分解し、8,534 stepsのうちfallback Candidate（896操作、Normal forge 643）由来の長さと切り分ける。同期ブロックとheap増加の
   主因がPlan長なら、Plan長削減（よりadvanceの小さいfallback Candidate、Normal forge共有の扱い）が時間・memory・`maxPlanSteps` の3つを同時に
   改善する候補になる。
2. 別Export / 別武器種での一般性確認（Phase 1-E推奨1）。同じBrowser harnessでoriginal Exportを差し替えるだけで測れる。
3. スマートフォンBrowserでの同harness実測（時間・memory・crash有無）。
4. Search時間（per-search cacheのProduction化可否、Research-onlyのまま）。
5. Production contract / REQUIREMENTS変更案の整理後にProduction化を判断する。

## テスト

新規:

- `src/benchmarks/plannerGlobalBrowserBenchmarkProtocol.test.ts`: request / response guard、run意味検証（mode / axis整合、maxPlanSteps一致、
  episode範囲、未知mode）、Web Crypto SHA-256既知vectorと `JSON.stringify` 式の安定性
- `src/workers/plannerGlobal.worker.benchmark.test.ts`: 実 `ProductionRngEngine` + 実 `GlobalRawBlockResearch` でWorker controllerを実行し、
  Node Phase 1-E runnerの計算（同じResearch呼び出し、JSON往復、同じ射影）をtest内で再現してsemantic・SHAが一致すること、timingを変えても
  semanticが変わらないこと、raw cache off / per-searchでsemantic同一・offはhit 0、Search毎のraw block lifetimeとrun終了、normal / gogma / skill
  fallback extent、重複・同時・2回目requestの拒否（fresh Worker）、不正requestは計算前に拒否、ping / cancelがyieldを介して届きcancelはresult /
  no-matchにならないこと、deadlineは `time_budget_reached`、MessageChannel yieldが先行microtaskより後に解決すること（deterministic）
- `src/benchmarks/plannerGlobalBrowserBenchmark.test.ts`: create → ready / accepted / round trip、fresh Worker policy、cancel後のresultを適用せず
  countする、ping / pong、native Worker error / messageerrorでfail closed、runnerのfresh Worker per attempt・warm-up順、memory unavailableでも
  完走、controllerが `EXTENT_AXES` 順でinitial成功後retryなし、Worker failure / errorからretryを開始しない、**`accepted` 前のnative Worker failureでも
  completed winnerを保持し、failureは `process_error` のまま（既知priorityはそのfailureだけに再利用）**、priority未取得ならfail closed、
  fallback開始でのcancel trigger
- `src/benchmarks/plannerGlobalBrowserBenchmarkIsolation.test.ts`: ProductionからPhase 2-A / Research moduleへのimportなし、通常pageからのrouteなし、
  Production Planner / Search Worker protocol・Client・yieldに変更なし、Phase 2-A sourceにTarget ID（UUID）・64桁hex・旧Phase結果・file / network読込・
  persistenceなし、通常Vite configにCOOP / COEPなし、Production default / schema / version不変

変更: `plannerGlobalOptimizationPhase1E.test.ts`（Task M: error / memory_limit / process_error / attempt_error / cancel / time_budget / search_errorの
initialからretryしない）、`plannerGlobalOptimizationResearch.test.ts`（benchmark専用Worker / pageをProduction scanから除外）、
`BenchmarkApp.test.tsx`（タブ5つ）。test用fixture `plannerGlobalBrowserTestFixture.ts` を追加した。

| 確認 | 結果 |
| --- | --- |
| focused（`plannerGlobal.worker.benchmark.test.ts` + `plannerGlobalBrowserBenchmark.test.ts`） | 6回連続で17 tests passed（flakyなし） |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 最終: 301 files / 4,819 tests passed。途中の3回は変更対象外の `IdentificationWizardDialog.test.tsx` の1 test（`shows global progress, cancellation, and Worker failure distinctly`）が15秒timeout（15.1〜15.3秒、単独実行では3.9秒・同file 58件pass）。変更を外した状態では同時期に全件pass。Phase 1-C〜1-Eでも同fileで観測した並列負荷下の境界timeoutと扱い、testは変更していない |
| `npm run build` | passed（既存の500 kB超chunk warning）、`dist` にResearch / Phase 2-A識別子なし |
| `npx vite build --config vite.benchmark.config.ts` | passed |
| `git diff --check` | passed |

## raw evidence

- [PLANNER_GLOBAL_PHASE2A_BROWSER_RESULTS.json](PLANNER_GLOBAL_PHASE2A_BROWSER_RESULTS.json): pageの `exportJson()` 出力そのもの（16 record + controller 1件、measured HEAD `d6112264…`）。
  3,280,058 bytes、SHA-256 `0dfd56b6616b273c4204b3c4b3f9df9c2c7ced2e3fcf75cb46746209c103250c`。record 1〜9, 11〜14が正式workload、10 / 15がmemory、16がprofiler probe。
- [PLANNER_GLOBAL_PHASE2A_EXTERNAL_MEMORY.json](PLANNER_GLOBAL_PHASE2A_EXTERNAL_MEMORY.json): memory runのCDP Worker heap sampleとOS renderer memory sample、
  driverのtask開始・終了log（CPU負荷）。SHA-256 `d9d399282dbbc300047e0ddb071f335736e107afda8e7f702dc40c37d9dbf22f`。

前回測定（`3258b935…`）のraw evidenceはこのcommitで置き換えた（git履歴の `aca12274` に残る）。19 MBのExportはcommitしない。
Phase 1-B〜1-Eの結果ファイルは変更していない。

## 未確認事項

スマートフォン・他Browser（Firefox / Safari）、別Export・別武器種、final Planner stage内の区間別内訳、final Planner中のcancel latency、
連続的なmemory peak（sampling間）、Chrome Worker heap上限値そのもの、複数回の性能分布（measurementは3回）、cache-offの複数回測定、
Node / Browser時間差の原因、retry経路のBrowser実データ（今回不発動）、ゲーム実機の追加検証。既存のreference-verified / game-verified /
unverifiedの境界は拡張しない。
