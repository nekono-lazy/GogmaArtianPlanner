# Global Assignment Browser P-2 測定計画（事前登録）

Refs #154。**Research・非formal**。本書はP-2（実ExportのBrowser性能・semantic parity検証）の測定計画であり、**計測を始める前にcommitする**。
設計は [P-0](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md)（§7〜§13、§16.2）、基盤は [P-1](PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P1.md)。
正式仕様（REQUIREMENTS / PLANNER_SPEC / SEARCH_SPEC / DATA_MODEL / UI_FLOW）、Domain契約、D-1Cの登録条件・正式RESULTは変更しない。

## 1. authorityと固定方法

- 本書の **計画block**（下の `gab-p2-measurement-plan` marker の間のJSON 1件）が、測定の唯一のauthorityである。
  analyzer（`scripts/analyze-planner-global-assignment-browser.mjs`）は計画blockを **測定時commit** から `git show <measurement HEAD>:docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_PLAN.md`
  で読み直し、その計画のslot・目的・options・必要run数だけを使う（P-0 §12.2）。測定後に本書を書き換えても、測定時commitの計画が使われる
- **measurement HEAD = 本書をcommitしたcommit**（測定用コード・テスト・本書をすべてcommit済みのclean HEAD）。本書は自分のcommit SHAを書けないので、
  計画blockの `baseCommit` には直前のコードcommitを書き、measurement HEADはBrowser raw recordのbuild provenance（`__PLANNER_GLOBAL_BENCHMARK_BUILD__.commit`）と
  Node referenceの `repositoryHeadSha` に記録される。analyzerは全recordのbuild commitが `--measurement-head` と一致し、`uncommittedBenchmarkCode: false` であることを要求し、
  異なるHEADのrecordを混在させない（fail closed）。analyzer自身も、解析時のcode（`src`・`scripts` 等のbenchmark code path）がmeasurement HEADと同じでなければ解析しない
- 計画blockは `gabMeasurementPlanIssues()`（`src/benchmarks/globalAssignment/browser/globalAssignmentBrowserMeasurementPlan.ts`）の検証を通る。
  測定前に `node scripts/analyze-planner-global-assignment-browser.mjs --measurement-head <HEAD> --validate-plan` で、計画の形、D-1C公開RESULTのSHA-256、
  条件が `registeredD1cConditions()` / `d1cRegistrationFingerprint()` と一致することを確認する（何も書かない）

## 2. 固定する項目

| 項目 | 値 |
| --- | --- |
| measurement HEAD | 本書のcommit（上記のとおり本書には書けない。測定記録に記す） |
| baseCommit（直前のコードcommit） | 計画blockの `baseCommit` |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（D-0B-2登録・D-1Cと同じ。Repositoryに置かない） |
| CalculationContext | gameVersion `unknown-initial`、masterDataVersion 4、rngEngineVersion `production-rng:c5-e7`、appSchemaVersion 17（D-1C公開RESULTと同じ） |
| 条件 | `registeredD1cConditions()` の `materialization` / `verification`（W0 350 / 500 / 1,500、規則 `d0a2-v2`、option集合 `a2`、structural candidate 1、verification budget 1、Research maxPlanSteps 20,000）。登録fingerprint `fnv1a32:2393847e`。Workerが自分で読み、requestでは渡さない |
| PlannerInput maxPlanSteps（検証用） | 1,000（D-1A / D-1Cと同じ） |
| 比較用reference | D-1C公開RESULT `docs/PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json`（SHA-256は計画blockに固定）、Node reference = 同じmeasurement HEADで既存のD-1A non-formal runnerを1回 |
| Browser protocol | `global-assignment-browser:1` |
| build provenance | `npx vite build --config vite.benchmark.config.ts` をmeasurement HEAD（clean）で行い、`commit` = measurement HEAD、`uncommittedBenchmarkCode: false` |
| serving | `vite preview --config vite.benchmark.config.ts`。非isolated `http://127.0.0.1:4179/`、isolated（`BENCHMARK_CROSS_ORIGIN_ISOLATED=1`）`http://127.0.0.1:4180/`。どちらもsecure context。外部hosting・tunnelは使わない |
| Worker envelope | first / fresh とも wall 1,800,000 ms、cancel grace 10,000 ms、ready timeout 120,000 ms |
| heartbeat / yield | heartbeat 1,000 ms、yield `message-channel` |
| late response待ち | 1,000 ms |
| Export transport | `auto`（Blobをstructured cloneできればBlob） |
| ping（responsivenessだけ） | chained ping、timeout 60,000 ms |
| memory（memoryだけ） | 固定点の `measureUserAgentSpecificMemory()`（isolated origin）、GC待ち 10,000 ms |

## 3. 環境

| 環境 | 状態 | 内容 |
| --- | --- | --- |
| `pc-windows-chrome` | **計画する（必須）** | Windows 11 Pro 10.0.26200 x64、AMD Ryzen 7 9700X（16 logical CPU）、31.1 GiB。Google Chrome 154 stable（計画時 154.0.8037.98）、**headed**、専用の一時profile、外部CDP driverで操作。user agentに `Windows NT 10.0` と `Chrome/154.` を含むrecordだけをこの環境のslotに割り当てる |
| `android-chrome` | 計画しない（未確認） | 計画登録時に `adb devices` が接続端末を示さなかった（platform-toolsは導入済み）。この系列ではAndroidを測らず、未確認と記録する |
| `iphone-safari` | 計画しない（未確認） | 信頼済みのローカルHTTPS経路（とMacのWeb Inspector）が用意されていない。外部hosting・tunnelでbuildやExportを公開する方法は使わない。未確認と記録する |

PCで得た時間・memory・成否をスマートフォンの結果として扱わない（P-0 §11.1）。

## 4. run slot（PC、実行順）

slot ID・目的・順序・origin・logical run optionsは計画blockに固定する。要約:

| 順 | slot | 目的 | 内容 |
| ---: | --- | --- | --- |
| 1 | `pc.pilot.1` | pilot | 系列最初の実Export run。環境の観測だけ（比較母集団外） |
| 2 | `pc.timing.1` | timing | 必須比較run 1。時間の観測 |
| 3 | `pc.rerun.1` | rerun | 必須比較run 2。logical run間の決定性 |
| 4 | `pc.responsiveness.1` | responsiveness | 各requestの実行中にchained ping（Worker event loopの応答性。UI frame rateではない）。追加比較run |
| 5 | `pc.cancel.phase-a` | cancel | first、`materialization:context`（Phase 0終了）の2,000 ms後（Phase A狙い） |
| 6 | `pc.cancel.phase-bc` | cancel | first、`materialization:reach_table`（Phase A終了）の3,000 ms後（Phase B / C狙い） |
| 7 | `pc.cancel.phase-d` | cancel | first、`materialization:candidate_started` の500 ms後（Phase D狙い） |
| 8 | `pc.cancel.planner` | cancel | first、`verification:planner:started` の1,000 ms後（firstのPhase D' Planner狙い） |
| 9 | `pc.cancel.trace-replay` | cancel | first、`verification:trace_replay:started` の100 ms後（同期のTrace Replay狙い） |
| 10 | `pc.cancel.fresh-planner` | cancel | fresh、`verification:planner:started` の1,000 ms後（freshのPhase D' Planner狙い） |
| 11 | `pc.rerun.2` | rerun | 必須比較run 3。全cancel試験の後、同じpage sessionでの再実行（各cancel試験の再実行slot） |
| 12 | `pc.memory.1` | memory | isolated originの別page session。固定点memory、外部CDP Worker heap、OS memory。追加比較run |

- **必須比較run（`timing` / `rerun`）の必要logical run数 = 3**（`pc.timing.1`、`pc.rerun.1`、`pc.rerun.2`）。3件すべてのfirst / freshが `completed` でsettleし、
  `browser_nonformal_conditions_met` で、integrity issueが0件のときだけ必要数を満たす。1件でも欠ければ `not_comparable`（`required_runs_incomplete`）
- 追加比較run（`responsiveness` / `memory`）は両Workerが `completed` でsettleした場合だけ比較し、不一致は `parity_mismatch` の根拠にする。未完了は比較母集団に入れず、件数を別に記録する
- `cancel` / `pilot` は比較母集団から除外する（semanticは記録する）
- cancel triggerの遅延はNode D-1Cの時間から推測した期待値ではなく、目標stageに入った直後を狙う固定値である。目標stageより早くrequestが終われば
  `cancel_not_exercised`、別stageで受け付けられればその停止stageを記録する（合否の条件はP-0 §12.6のまま）

## 5. 判定

- **parity**: P-0 §12.4の順（前提 → 比較母集団 → 確定した不一致 → Node reference欠落 → 必要数不足 → confirmed）で、環境ごとに
  `parity_confirmed` / `parity_mismatch` / `not_comparable` の1つ。比較項目はP-0 §12.1（materialization / verification semantic SHA-256、Entry fingerprint、
  planning Target数、materialization方式の内訳、termination、Conflict / rejected / warning、Trace Replay、物理操作数、Plan hash等）。比較先はD-1C公開RESULT、
  同じHEADのNode reference、比較母集団の他のBrowser Worker。`judgeGabEnvironmentParity()`
- **cancel試験**: cancel slotごとに `cancel_passed` / `cancel_failed` / `cancel_not_exercised`（P-0 §12.6）。再実行slotは `pc.rerun.2`。`judgeGabCancelTrial()`
- **終了経路の集計**: slotごとのfirst / freshのsettle、未記録slot、外部証拠（page loss / OOM）、`ignoredResultAfterCancel`、中断、計画外record。`tallyGabOutcomes()`
- 3つは互いに独立で、どれも他の結果を読まない。**parity_confirmedは性能・cancel・Production可否の合格を意味しない**。性能の許容値・Production可否は判定しない

## 6. 実行手順

1. measurement HEAD（本書のcommit、clean）で `--validate-plan` を実行し、全checkが通ることを確認する
2. 同じHEADでNode referenceを1回: `node scripts/run-planner-global-assignment-d1a.mjs --export <Export> --expected-export-sha256 cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b --expected-d0c-semantic-sha256 6f790d33839ce9dcae2bd030b2e0b92c0dd1c5e7c4850de9cbd54dc4ab4cb18f --expected-d0c-entry-fingerprint fnv1a32:ed959cc4 --run-dir .local/<run dir> --output .local/<output>.json`
   （既存CLI・登録済みD-0C identityの事後照合値だけ。新しい条件・Export・windowは与えない。D-1C formal runnerは実行しない）
3. 同じHEADでbenchmark buildを行い、2つのpreview（4179 / 4180）を起動する
4. **driver機構の事前確認（計測系列外）**: Repository内のfactoryで作った合成最小Export（実データなし。P-1と同じもの）だけを使い、driverの操作（file選択、logical run、
   cancel trigger、ping、memory session、raw保存、storage読取り）を確認してよい。このrunは `planned: false` のslot IDで行い、raw recordは系列の
   raw directoryとは別のdirectoryに置き、analyzerへ渡さない。**実Exportを使った計画外runは行わない**
5. **session 1**（非isolated、4179）: driverがheaded Chromeを専用profileで起動し、pageを開き、Exportを選び（`DOM.setFileInputFiles`）、page APIで識別子と
   SHA-256が計画のExportと一致することを確かめてから、slot 1〜11を順に、`runLogicalRun({ slot: { slotId, purpose, planned: true }, ...計画のoptions })` で実行する
6. **session 2**（isolated、4180）: 新しいpage loadでslot 12を実行する。このsessionだけ、driverはWorker targetへauto-attachし `Runtime.getHeapUsage` を約500 ms間隔で、
   OSのChrome renderer process memory（PrivateMemorySize64 / WorkingSet64）を約1,000 ms間隔で採取する（max sampledとして記録し、連続的なpeakと呼ばない）
7. 各logical runの直後に、driverがpage APIの `exportJson()` をそのまま1 fileとして保存し、`clear()` する（page memoryにrecordを溜めない）。logical run間は5,000 ms待つ。
   各slotの開始前にCPU負荷（参考値）を記録する。各sessionの最初と最後に `indexedDB.databases()`・`localStorage`・`sessionStorage`・Cache Storage・Service Worker登録を記録する
8. 計測中はChromeの画面を表示したままにする（`--disable-backgrounding-occluded-windows`）。`visibilitychange` / `freeze` / `pagehide` があったrunは
   `environment_interrupted` として時間・応答性の集計から除外する（両Workerが完了していればsemanticは比較に使う）
9. analyzerで公開RESULTを導出し（`--public`）、同じrawから再導出して一致を確認する（`--check`）

## 7. 異常・中断の扱い（事前に固定）

- **自動retryをしない。失敗・中断・timeoutしたslotを別のrunで置き換えない、元のslotに上書きしない、目的を付け替えない**。同じslot IDの2件目以降のrecordは
  `duplicate_slot` として計画外になる（最初のrecordがslotに残る）
- renderer crash・page lossは外部driverが検出し（CDP `Inspector.targetCrashed` / `Target.targetCrashed`）、driver記録に `page_lost` として残す。
  `out_of_memory` はcrash dumpのOOM annotation等の外部証拠があるときだけ付ける。page lossの後は、残りのslotを新しいpage loadで順に続ける（失ったslotは再実行しない）
- driver自体が途中で止まった場合、残りのslotは未実行として記録する。足りない分を同じ系列で補わず、必要なら新しい測定計画（新しいcommit・新しいseries）で測り直す。旧runは保持する
- **計測開始後に計算コード・測定コードを変更した場合、それ以前の測定と新しいHEADの測定を同じmeasurementとして混在させない**（analyzerが拒否する）
- BrowserとNodeの結果が異なっても、Research計算・条件を修正して一致させない。原因を推測で書かず、切り分けで確定できなければ「原因未特定」と記録する
- raw record・driver記録・Node rawは git-ignoredな `.local/global-assignment-browser-p2/` に置き、上書きしない。Export本体・raw Entry・Target ID等を公開しない

## 8. 集計対象外の条件

| 条件 | 扱い |
| --- | --- |
| 目的 `cancel` / `pilot` | parityの比較母集団外（semanticは記録） |
| integrity issueのあるrun（runnerのintegrity issue、analyzerの再hash不一致・不正なresult） | 比較母集団外。必須比較slotなら必要数を満たさない |
| 計画外のrecord（`planned: false`、計画に無いslot、目的・options・origin・user agentの不一致、同じslotの2件目） | 比較母集団外。件数と理由だけ記録 |
| `environment_interrupted`（非表示・凍結・離脱があったrun） | 時間・応答性の集計から除外（semanticは完了していれば比較） |
| cancel / timeout / Worker error / page loss / 未完了のrun | 時間・memoryの集計から除外し、件数と停止stageを別に数える |
| 時間の集計 | `timing` / `rerun` slotのうち、両Worker完了・integrity issue 0・中断なしのrunだけ（min / median / max）。pilot・responsiveness・memory・cancelのrunは集計しない（slotごとの値は記録する） |

## 9. 計画block

<!-- gab-p2-measurement-plan:begin -->
```json
{
  "kind": "global-assignment-browser-p2-measurement-plan",
  "revision": 1,
  "series": "p2-r1",
  "protocolVersion": "global-assignment-browser:1",
  "baseCommit": "d3716304b6f6749f6bdbc9e3cf6e8bdf7bd2ab3e",
  "export": {
    "fileName": "gogma-artian-planner-backup_20260927015837.json",
    "bytes": 19424064,
    "sha256": "cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b"
  },
  "calculationContext": {
    "gameVersion": "unknown-initial",
    "masterDataVersion": 4,
    "rngEngineVersion": "production-rng:c5-e7",
    "appSchemaVersion": 17
  },
  "conditions": {
    "source": "registeredD1cConditions",
    "registrationFingerprint": "fnv1a32:2393847e",
    "materialization": {
      "rule": "d0a2-v2",
      "window": {
        "normal": 350,
        "gogma": 500,
        "skill": 1500
      },
      "nodeBudget": 2000,
      "mrvLookahead": 8,
      "coverageDrivenOrdering": true,
      "structuralCandidateLimit": 1,
      "projectedSearchScaleGate": {
        "maxConversionPositions": 32,
        "maxGogmaLegalWidth": 500,
        "maxSkillLegalWidth": 1501,
        "maxNormalForgeCount": 350
      },
      "shapeSearchScaleGate": {
        "maxDepthUpperBound": 2000,
        "maxGogmaGeneratedStateUpperBound": 502000000,
        "maxNormalForgeCount": 350,
        "maxConversionWalkPositions": 1501
      },
      "shapeSearchBudget": {
        "maxGogmaGeneratedStates": 50000000,
        "maxSkillStates": 2250000,
        "maxSettledWork": 100000,
        "maxPredictions": {
          "normalArtian": 350,
          "skill": 1501,
          "gogmaReset": 500,
          "gogmaKeep": 500
        }
      },
      "routeVerification": "every_shape_constrained_materialization",
      "reachOptionSet": "global-assignment-reach-options:a2"
    },
    "verification": {
      "researchMaxPlanSteps": 20000,
      "verificationBudget": 1
    }
  },
  "references": {
    "d1cPublicResult": {
      "path": "docs/PLANNER_GLOBAL_ASSIGNMENT_D1C_RESULT.json",
      "sha256": "9e9e33d77e99c45b24fbb52ac27248fc1fbaa8fc210bba72af164daa4431fb46"
    },
    "nodeReference": {
      "runner": "scripts/run-planner-global-assignment-d1a.mjs",
      "runs": 1
    }
  },
  "environments": [
    {
      "environmentId": "pc-windows-chrome",
      "status": "planned",
      "unavailableReason": null,
      "description": "Windows 11 Pro 10.0.26200 x64, AMD Ryzen 7 9700X (16 logical CPUs), 31.1 GiB; Google Chrome 154 stable, headed, dedicated scratch profile, driven over CDP by an uncommitted external driver",
      "userAgentMustInclude": [
        "Windows NT 10.0",
        "Chrome/154."
      ],
      "requiredComparisonRuns": 3,
      "slots": [
        {
          "slotId": "pc.pilot.1",
          "purpose": "pilot",
          "order": 1,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": null,
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": null,
          "note": "The first real-Export run of the series: environment observation only (outside the comparison population)."
        },
        {
          "slotId": "pc.timing.1",
          "purpose": "timing",
          "order": 2,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": null,
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": null,
          "note": "Required comparison run 1; its timings are the timing observation."
        },
        {
          "slotId": "pc.rerun.1",
          "purpose": "rerun",
          "order": 3,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": null,
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": null,
          "note": "Required comparison run 2: Browser-internal determinism across logical runs."
        },
        {
          "slotId": "pc.responsiveness.1",
          "purpose": "responsiveness",
          "order": 4,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": null,
            "ping": {
              "timeoutMs": 60000
            },
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": null,
          "note": "Chained ping during each request (Worker event-loop responsiveness, not UI frame rate); additional comparison run."
        },
        {
          "slotId": "pc.cancel.phase-a",
          "purpose": "cancel",
          "order": 5,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": {
              "role": "first",
              "onProgressKey": "materialization:context",
              "delayMs": 2000
            },
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": "pc.rerun.2",
          "note": "Cancel aimed at Phase A (2 s after Phase 0 ended)."
        },
        {
          "slotId": "pc.cancel.phase-bc",
          "purpose": "cancel",
          "order": 6,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": {
              "role": "first",
              "onProgressKey": "materialization:reach_table",
              "delayMs": 3000
            },
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": "pc.rerun.2",
          "note": "Cancel aimed at Phase B / C (3 s after Phase A ended)."
        },
        {
          "slotId": "pc.cancel.phase-d",
          "purpose": "cancel",
          "order": 7,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": {
              "role": "first",
              "onProgressKey": "materialization:candidate_started",
              "delayMs": 500
            },
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": "pc.rerun.2",
          "note": "Cancel aimed at Phase D (0.5 s after the candidate started)."
        },
        {
          "slotId": "pc.cancel.planner",
          "purpose": "cancel",
          "order": 8,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": {
              "role": "first",
              "onProgressKey": "verification:planner:started",
              "delayMs": 1000
            },
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": "pc.rerun.2",
          "note": "Cancel aimed at the first Worker's Phase D' Planner (1 s after it started)."
        },
        {
          "slotId": "pc.cancel.trace-replay",
          "purpose": "cancel",
          "order": 9,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": {
              "role": "first",
              "onProgressKey": "verification:trace_replay:started",
              "delayMs": 100
            },
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": "pc.rerun.2",
          "note": "Cancel aimed at the first Worker's synchronous Trace Replay (0.1 s after it started)."
        },
        {
          "slotId": "pc.cancel.fresh-planner",
          "purpose": "cancel",
          "order": 10,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": {
              "role": "fresh",
              "onProgressKey": "verification:planner:started",
              "delayMs": 1000
            },
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": "pc.rerun.2",
          "note": "Cancel aimed at the fresh Worker's Phase D' Planner (1 s after it started)."
        },
        {
          "slotId": "pc.rerun.2",
          "purpose": "rerun",
          "order": 11,
          "origin": "non_isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": false
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": null,
            "ping": null,
            "memory": null,
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": null,
          "note": "Required comparison run 3, after every cancel trial in the same page session: the re-run slot of each cancel trial."
        },
        {
          "slotId": "pc.memory.1",
          "purpose": "memory",
          "order": 12,
          "origin": "isolated",
          "options": {
            "execution": {
              "yieldMode": "message-channel",
              "heartbeatIntervalMs": 1000,
              "workerHeapSampling": true
            },
            "envelope": {
              "firstWallMs": 1800000,
              "freshWallMs": 1800000,
              "cancelGraceMs": 10000,
              "readyTimeoutMs": 120000
            },
            "cancelTrigger": null,
            "ping": null,
            "memory": {
              "gcWaitMs": 10000
            },
            "lateResponseWaitMs": 1000,
            "exportTransport": "auto"
          },
          "rerunSlotId": null,
          "note": "Isolated origin, its own page session: fixed-point measureUserAgentSpecificMemory, external CDP Worker heap sampling and OS renderer memory; additional comparison run."
        }
      ]
    },
    {
      "environmentId": "android-chrome",
      "status": "not_available",
      "unavailableReason": "No Android device was attached when the plan was registered (adb devices listed none); no Android measurement is planned in this series, so Android stays unconfirmed.",
      "description": "Android + Chrome (real device)",
      "userAgentMustInclude": [],
      "requiredComparisonRuns": 0,
      "slots": []
    },
    {
      "environmentId": "iphone-safari",
      "status": "not_available",
      "unavailableReason": "No trusted local HTTPS route to an iPhone (and no Mac Web Inspector) is prepared, and publishing the build or the Export through an external host or tunnel is excluded; iPhone stays unconfirmed.",
      "description": "iPhone + Safari (real device)",
      "userAgentMustInclude": [],
      "requiredComparisonRuns": 0,
      "slots": []
    }
  ]
}
```
<!-- gab-p2-measurement-plan:end -->
