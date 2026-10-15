# 作成リスト全体最適化 Browser計測基盤 機能確認計画（mechanics）

Refs #260（PR-5A）。**benchmark専用・synthetic入力だけ**。本書は、作成リスト全体最適化（[PLANNER_SPEC.md](PLANNER_SPEC.md) 17章）の
Production計算をPC Browserで計測する基盤（[BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT.md](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT.md)）が、
計測の前提となる動作を満たすかを確かめる **機能確認（mechanics）の計画** である。探索上限の正式値（17.19のU2）や性能・memoryの合否は判定しない。

- 入力はRepository内のtest fixture（`sanity-3` scheduler workload。実Masterと `ProductionRngEngine`、利用者データなし）から作る
  synthetic Exportだけで、実Exportは使わない
- 探索上限はPR-4のWorker / Client testの値（`BUILD_LIST_OPTIMIZATION_TEST_BOUNDS`）とその変形であり、Productionの候補値ではない
- Owner承認を要しない（`approval.state = not_required`）。slotごとに期待する結果（`expect`）を持ち、analyzerはそれとの一致だけを判定する
- 計画blockは、この文書をcommitしたcommit（measurement HEAD）から `git show` で読まれる。計測後に本書を書き換えても、そのHEADの計画が使われる

## 1. 確認すること

| slot | 確認内容 | 期待 |
| --- | --- | --- |
| `mech.optimized` / `mech.rerun` | 通常の最適化。新しいWorkerで2回計算し、同じsemanticになる（Node referenceとも一致） | `completed` / `optimized` |
| `mech.unsupported` | 1目標武器に2件のEntry（legacy duplicate）を持つ入力。入力全体のfail closed | `completed` / `unsupported` |
| `mech.bound` | node budget 1。最初のstructural candidateの前で止まる | `completed` / `search_bound_reached` |
| `mech.cancel.input-check` / `mech.cancel.reach-table` | 計算中のキャンセル（`input_check` 直後、`reach_table` の同期区間内）。Workerを直ちに終了し、結果を採用しない | `cancelled` |
| `mech.rerun.after-cancel` | キャンセル後の再実行が完了する（前runの結果を混入させない） | `completed` / `optimized` |
| `mech.worker-error` | Workerの `error` event（Production controllerが応答できないmessageを受けたとき）を計算失敗として扱う | `failed` / `worker_error` |
| `mech.invalid-result` | main threadの構造検査に通らない結果（harnessが故意に壊したもの）を計算失敗として扱う | `failed` / `invalid_result` |
| `mech.memory` | cross-origin isolated originでの固定点memory、CDPのWorker heap、OSのrenderer memoryの採取 | `completed` / `optimized` |

`unsupported` には `checkpoint_selection`（途中採用状態の選択）を使わない。`sanity-3` のCandidateは途中状態を持たず、正しい選択を
作れないためである。途中採用状態の `unsupported` はDomain / Nodeのtest（PR-3）が固定している。

## 2. 実行手順

1. 本書と計測基盤のcodeをcommitしたclean HEADで、benchmark buildを作る: `npx vite build --config vite.benchmark.config.ts`
2. 2つのpreviewを起動する（どちらも `127.0.0.1` のsecure context。外部hosting・tunnelは使わない）
   - 非isolated: `npx vite preview --config vite.benchmark.config.ts --port 4181 --strictPort --host 127.0.0.1`
   - isolated: `BENCHMARK_CROSS_ORIGIN_ISOLATED=1 npx vite preview --config vite.benchmark.config.ts --port 4182 --strictPort --host 127.0.0.1`
3. Node reference（同じHEAD）: `node scripts/run-build-list-optimization-node-reference.mjs --measurement-head <HEAD> --plan docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md --input-id sanity-3 --bounds-id synthetic.open --output <dir>/node-open.json`（`synthetic.wide-window` も同様）
4. driver: `node scripts/drive-build-list-optimization-browser.mjs --mode mechanics --measurement-head <HEAD> --plan docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md --chrome <chrome.exe> --profile <新しいdir> --out <新しいdir>`
5. analyzer: `node scripts/analyze-build-list-optimization-browser.mjs --measurement-head <HEAD> --plan docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md --browser-raw-dir <out>/raw --driver-record <out>/driver.json --node-reference-dir <dir> --public <RESULT.json>`、続けて `--check <RESULT.json>`

自動retryをしない。失敗・中断したslotを別のrunで置き換えない。

## 3. 計画block

<!-- blo-browser-plan:begin -->
```json
{
  "kind": "build-list-optimization-browser-plan",
  "revision": 1,
  "baseCommit": "181963d7ec7934f455e3195c86179972b36728b3",
  "protocols": {
    "worker": "build-list-optimization:1",
    "benchmarkConfig": "build-list-optimization-benchmark:1",
    "record": "build-list-optimization-browser-record:1"
  },
  "versions": {
    "calculationAppSchemaVersion": 17,
    "databaseSchemaVersion": 10,
    "exportSchemaVersion": 13,
    "productionRngEngineVersion": "production-rng:c5-e7",
    "masterDataVersion": 4
  },
  "calculationContext": {
    "gameVersion": "unknown-initial",
    "masterDataVersion": 4,
    "rngEngineVersion": "production-rng:c5-e7",
    "appSchemaVersion": 17
  },
  "planKind": "mechanics",
  "series": "pr5a-mech-r1",
  "status": "registered",
  "approval": {
    "state": "not_required",
    "approvedBy": null,
    "approvedOn": null,
    "note": "A harness check on synthetic inputs: it decides nothing about the Production bounds and needs no Owner approval."
  },
  "inputs": [
    {
      "inputId": "sanity-3",
      "kind": "synthetic",
      "caseId": "synthetic.sanity-3",
      "note": "The sanity-3 scheduler workload as an Export (Repository test fixture; no user data)."
    },
    {
      "inputId": "sanity-3-duplicate",
      "kind": "synthetic",
      "caseId": "synthetic.sanity-3.duplicate-entry",
      "note": "The same with a legacy duplicate Entry of one Target (the whole input fails closed)."
    }
  ],
  "boundsSets": [
    {
      "boundsId": "synthetic.open",
      "role": "synthetic",
      "purpose": "Show an optimized result on the synthetic input.",
      "derivation": "BUILD_LIST_OPTIMIZATION_TEST_BOUNDS (the PR-4 Worker / Client test bounds); a test value, not a Production candidate.",
      "bounds": {
        "window": {
          "normal": 2,
          "gogma": 8,
          "skill": 8
        },
        "nodeBudget": 500,
        "mrvLookahead": 4,
        "maxStructuralCandidates": 3,
        "maxPlannerVerifications": 3,
        "routeGeneration": {
          "projectedSearchScaleGate": {
            "maxConversionPositions": 100000,
            "maxGogmaLegalWidth": 100000,
            "maxSkillLegalWidth": 100000,
            "maxNormalForgeCount": 100000
          },
          "shapeSearchScaleGate": {
            "maxDepthUpperBound": 1000000,
            "maxGogmaGeneratedStateUpperBound": 1000000000,
            "maxNormalForgeCount": 1000000,
            "maxConversionWalkPositions": 1000000
          },
          "shapeSearchBudget": {
            "maxGogmaGeneratedStates": 1000000000,
            "maxSkillStates": 1000000000,
            "maxSettledWork": 1000000000,
            "maxPredictions": {
              "normalArtian": 1000000000,
              "skill": 1000000000,
              "gogmaReset": 1000000000,
              "gogmaKeep": 1000000000
            }
          }
        }
      }
    },
    {
      "boundsId": "synthetic.node-budget-1",
      "role": "synthetic",
      "purpose": "Show search_bound_reached (structural_search_node_budget).",
      "derivation": "synthetic.open with nodeBudget 1.",
      "bounds": {
        "window": {
          "normal": 2,
          "gogma": 8,
          "skill": 8
        },
        "nodeBudget": 1,
        "mrvLookahead": 4,
        "maxStructuralCandidates": 3,
        "maxPlannerVerifications": 3,
        "routeGeneration": {
          "projectedSearchScaleGate": {
            "maxConversionPositions": 100000,
            "maxGogmaLegalWidth": 100000,
            "maxSkillLegalWidth": 100000,
            "maxNormalForgeCount": 100000
          },
          "shapeSearchScaleGate": {
            "maxDepthUpperBound": 1000000,
            "maxGogmaGeneratedStateUpperBound": 1000000000,
            "maxNormalForgeCount": 1000000,
            "maxConversionWalkPositions": 1000000
          },
          "shapeSearchBudget": {
            "maxGogmaGeneratedStates": 1000000000,
            "maxSkillStates": 1000000000,
            "maxSettledWork": 1000000000,
            "maxPredictions": {
              "normalArtian": 1000000000,
              "skill": 1000000000,
              "gogmaReset": 1000000000,
              "gogmaKeep": 1000000000
            }
          }
        }
      }
    },
    {
      "boundsId": "synthetic.wide-window",
      "role": "synthetic",
      "purpose": "A reach_table stage long enough to land a cancel in, and a few CDP heap samples.",
      "derivation": "synthetic.open with the window Normal 300 / Gogma 400 / Skill 1200.",
      "bounds": {
        "window": {
          "normal": 300,
          "gogma": 400,
          "skill": 1200
        },
        "nodeBudget": 500,
        "mrvLookahead": 4,
        "maxStructuralCandidates": 3,
        "maxPlannerVerifications": 3,
        "routeGeneration": {
          "projectedSearchScaleGate": {
            "maxConversionPositions": 100000,
            "maxGogmaLegalWidth": 100000,
            "maxSkillLegalWidth": 100000,
            "maxNormalForgeCount": 100000
          },
          "shapeSearchScaleGate": {
            "maxDepthUpperBound": 1000000,
            "maxGogmaGeneratedStateUpperBound": 1000000000,
            "maxNormalForgeCount": 1000000,
            "maxConversionWalkPositions": 1000000
          },
          "shapeSearchBudget": {
            "maxGogmaGeneratedStates": 1000000000,
            "maxSkillStates": 1000000000,
            "maxSettledWork": 1000000000,
            "maxPredictions": {
              "normalArtian": 1000000000,
              "skill": 1000000000,
              "gogmaReset": 1000000000,
              "gogmaKeep": 1000000000
            }
          }
        }
      }
    }
  ],
  "environments": [
    {
      "environmentId": "pc-windows-chrome",
      "status": "planned",
      "reason": null,
      "description": "Windows 11 Pro 10.0.26200 x64, AMD Ryzen 7 9700X (16 logical CPUs), 31.1 GiB; Google Chrome stable, dedicated scratch profile, driven over CDP by scripts/drive-build-list-optimization-browser.mjs",
      "userAgentMustInclude": [
        "Windows NT 10.0",
        "Chrome/"
      ],
      "slots": [
        {
          "slotId": "mech.optimized",
          "order": 1,
          "purpose": "mechanics",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.open",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": {
            "outcome": "completed",
            "resultStatus": "optimized",
            "failureKind": null
          },
          "note": "A normal optimization: the result reaches the main thread and passes the Client check."
        },
        {
          "slotId": "mech.rerun",
          "order": 2,
          "purpose": "mechanics",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.open",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": {
            "outcome": "completed",
            "resultStatus": "optimized",
            "failureKind": null
          },
          "note": "A second run on a new Worker: the same semantics."
        },
        {
          "slotId": "mech.unsupported",
          "order": 3,
          "purpose": "mechanics",
          "origin": "non_isolated",
          "inputId": "sanity-3-duplicate",
          "boundsId": "synthetic.open",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": {
            "outcome": "completed",
            "resultStatus": "unsupported",
            "failureKind": null
          },
          "note": "unsupported (invalid_planner_input)."
        },
        {
          "slotId": "mech.bound",
          "order": 4,
          "purpose": "mechanics",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.node-budget-1",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": {
            "outcome": "completed",
            "resultStatus": "search_bound_reached",
            "failureKind": null
          },
          "note": "search_bound_reached (structural_search_node_budget)."
        },
        {
          "slotId": "mech.cancel.input-check",
          "order": 5,
          "purpose": "cancel",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.wide-window",
          "cancelTrigger": {
            "stage": "input_check",
            "delayMs": 0
          },
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": "mech.rerun.after-cancel",
          "expect": {
            "outcome": "cancelled",
            "resultStatus": null,
            "failureKind": null
          },
          "note": "Cancel right after input_check."
        },
        {
          "slotId": "mech.cancel.reach-table",
          "order": 6,
          "purpose": "cancel",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.wide-window",
          "cancelTrigger": {
            "stage": "reach_table",
            "delayMs": 300
          },
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": "mech.rerun.after-cancel",
          "expect": {
            "outcome": "cancelled",
            "resultStatus": null,
            "failureKind": null
          },
          "note": "Cancel inside the synchronous reach_table stage."
        },
        {
          "slotId": "mech.rerun.after-cancel",
          "order": 7,
          "purpose": "mechanics",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.wide-window",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": {
            "outcome": "completed",
            "resultStatus": "optimized",
            "failureKind": null
          },
          "note": "A new run after the cancels completes."
        },
        {
          "slotId": "mech.worker-error",
          "order": 8,
          "purpose": "lifecycle",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.open",
          "cancelTrigger": null,
          "faultInjection": "worker_error",
          "memory": null,
          "rerunSlotId": null,
          "expect": {
            "outcome": "failed",
            "resultStatus": null,
            "failureKind": "worker_error"
          },
          "note": "The Worker error event is a failed run (never a result)."
        },
        {
          "slotId": "mech.invalid-result",
          "order": 9,
          "purpose": "lifecycle",
          "origin": "non_isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.open",
          "cancelTrigger": null,
          "faultInjection": "corrupt_result",
          "memory": null,
          "rerunSlotId": null,
          "expect": {
            "outcome": "failed",
            "resultStatus": null,
            "failureKind": "invalid_result"
          },
          "note": "A result failing the Client check is a failed run."
        },
        {
          "slotId": "mech.memory",
          "order": 10,
          "purpose": "memory",
          "origin": "isolated",
          "inputId": "sanity-3",
          "boundsId": "synthetic.wide-window",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": {
            "fixedPoints": true,
            "gcWaitMs": 2000,
            "cdpWorkerHeap": true,
            "osProcessMemory": true
          },
          "rerunSlotId": null,
          "expect": {
            "outcome": "completed",
            "resultStatus": "optimized",
            "failureKind": null
          },
          "note": "Fixed-point memory, CDP Worker heap and OS renderer memory on the isolated origin."
        }
      ]
    },
    {
      "environmentId": "android-chrome",
      "status": "excluded",
      "reason": "A harness check: PC only.",
      "description": "Android + Chrome (real device)",
      "userAgentMustInclude": [],
      "slots": []
    },
    {
      "environmentId": "iphone-safari",
      "status": "excluded",
      "reason": "Not a verification target of this series (unverified, never unsupported).",
      "description": "iPhone + Safari (real device)",
      "userAgentMustInclude": [],
      "slots": []
    }
  ],
  "nodeReference": {
    "runner": "scripts/run-build-list-optimization-node-reference.mjs",
    "runs": [
      {
        "inputId": "sanity-3",
        "boundsId": "synthetic.open"
      },
      {
        "inputId": "sanity-3",
        "boundsId": "synthetic.wide-window"
      }
    ]
  },
  "semanticComparison": {
    "components": [
      "status",
      "generatedEntries",
      "replacements",
      "unchangedTargets",
      "planningTargets",
      "inputExclusions",
      "inputToken",
      "summary",
      "termination",
      "conflicts",
      "warnings",
      "plan",
      "steps",
      "diagnostics"
    ],
    "groups": [
      {
        "groupId": "mech.sanity-3.open",
        "inputId": "sanity-3",
        "boundsId": "synthetic.open",
        "slotIds": [
          "mech.optimized",
          "mech.rerun"
        ],
        "requiredBrowserRuns": 2,
        "nodeReferenceRequired": true
      },
      {
        "groupId": "mech.sanity-3.wide",
        "inputId": "sanity-3",
        "boundsId": "synthetic.wide-window",
        "slotIds": [
          "mech.rerun.after-cancel",
          "mech.memory"
        ],
        "requiredBrowserRuns": 2,
        "nodeReferenceRequired": true
      }
    ]
  },
  "criteria": {
    "status": "registered",
    "items": []
  },
  "anomalyRules": [
    "No automatic retry: a failed or interrupted slot keeps its record, and nothing re-runs it under its slot ID.",
    "Records of another HEAD or of uncommitted benchmark code are refused by the analysis."
  ],
  "publicExclusions": [
    "Export body, Target / Entry / OwnedWeapon / Plan IDs, Seed and Counter values, file paths."
  ]
}
```
<!-- blo-browser-plan:end -->
