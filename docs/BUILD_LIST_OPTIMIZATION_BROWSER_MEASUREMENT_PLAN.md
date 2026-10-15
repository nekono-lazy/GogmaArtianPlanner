# 作成リスト全体最適化 Production Browser計測 測定計画案（PR-5B用）

Refs #260（PR-5A）。**提案（`proposed`）・Owner承認待ち（`owner_approval_pending`）**。本書は、作成リスト全体最適化
（[PLANNER_SPEC.md](PLANNER_SPEC.md) 17章）の探索範囲・探索上限のProduction定数（17.13、17.19のU2）を決めるPC Browser計測の
**測定計画案** である。本書の基準・run数・比較条件はまだ正式な合格基準ではない。計測基盤は
[BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT.md](BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT.md) を参照する。

## 1. 位置づけと進め方

- PR-5A（本PR）は計測基盤と本計画案だけを置く。正式な実Export計測とProduction定数の確定は行わない
  （`PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS = null` のまま）
- PR-5Bの手順:
  1. Ownerが §9 の判断事項を決める
  2. 決定を計画blockへ反映し、`status: registered`、`criteria.status: registered`、`approval.state: owner_approved`（承認者・日付）としてcommitする。
     このcommitが **measurement HEAD** である（計画blockは自分のcommit SHAを書けないので、`baseCommit` には直前のcommitを書く）
  3. measurement HEAD（clean）でbenchmark build・Node reference・driverを実行し、analyzerで公開RESULTを導出・再検証する
  4. 結果と未確認範囲を記録し、別commitで `PRODUCTION_BUILD_LIST_OPTIMIZATION_BOUNDS` を確定する
- analyzerは計画blockを常に measurement HEAD から `git show` で読む。計測後に本書を書き換えても、そのHEADの計画が使われる。
  `proposed` の計画では観測だけを導出し、全軸の判定を `not_yet_registered` とする（承認前の基準で合否を出さない）
- driverは `registered` かつ `owner_approved` の計画でしか実Exportの計測を始めない
- 計測開始後に計算コード・計測コードを変更した場合、それ以前の記録と新しいHEADの記録を同じ計測として混在させない（analyzerが拒否する）

## 2. 固定する項目

| 項目 | 値 |
| --- | --- |
| measurement HEAD | PR-5Bで登録した計画をcommitしたcommit（本書には書けない。記録に残す） |
| baseCommit（計画案） | `181963d`（PR-4のmerge。PR-5Bの登録時に直前のcommitへ更新する） |
| 計算 | Production Worker Client + 計測Worker（Production controller、Production adapter `createBuildListOptimizationCalculation(bounds)`、`ProductionRngEngine`、Production ID factory / Clock）。boundsはbenchmark専用の設定messageで渡し、`blo_run` には含めない |
| protocol / version | Worker `build-list-optimization:1`、計測設定 `build-list-optimization-benchmark:1`、記録 `build-list-optimization-browser-record:1`。`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13、`production-rng:c5-e7`、Master `dataVersion` 4 |
| 入力 | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（D-0B-2 / D-1C / P-2と同じ。PR-5A時点でローカルに存在することを確認済み。Repositoryへ置かない・外部へ送らない） |
| 入力の作り方 | Export → `prepareExportRootForImport()` → `validateExportRootForFullReplacement()` → 通常の `createPlannerInput()`（`createBuildListCalculationContext()`、`conflictResolutions = []`）。実行中Planがあれば計算せず `running_plan_exists`、RngStateが無ければfail closed（Productionの開始readerと同じ位置で止める）。Entryの選択・Counter・RNGを変更しない |
| CalculationContext | gameVersion `unknown-initial`、masterDataVersion 4、rngEngineVersion `production-rng:c5-e7`、appSchemaVersion 17 |
| build | measurement HEAD（clean）で `npx vite build --config vite.benchmark.config.ts`。pageはbuild provenance（commit、未commitの変更の有無、code SHA-256）を記録し、driver / analyzerはHEADと一致しないpageを拒否する |
| serving | `vite preview --config vite.benchmark.config.ts`。非isolated `http://127.0.0.1:4181/`、isolated（`BENCHMARK_CROSS_ORIGIN_ISOLATED=1`）`http://127.0.0.1:4182/` |
| driver / analyzer / Node reference | `scripts/drive-build-list-optimization-browser.mjs`、`scripts/analyze-build-list-optimization-browser.mjs`、`scripts/run-build-list-optimization-node-reference.mjs`（いずれもmeasurement HEADのcode） |

## 3. 4つの判定軸

次の4つを分けて判定し、どれか1つの成功で他を成功としない。

1. **semantic parity**: 同じ入力・同じ探索上限のBrowser run同士、およびNode referenceとsemantic fingerprintが一致する
2. **計算成立・探索上限**: 結果の分類（`optimized` / `not_found` / `search_bound_reached` / `unsupported`）、計画対象Targetの完成、探索の診断値
3. **性能とmemory**: 区間ごとの時間、main threadのlong task、Worker heap、renderer memory、main threadが保持する結果
4. **cancel / lifecycle**: キャンセルの即時性、結果の不採用、Worker終了、再実行、永続状態の不変、中断

基準は探索上限セットごとに判定する（基準の対象を特定のセットに限るもの以外）。Ownerはすべての基準を満たすセットから定数を選ぶ。

## 4. 比較する探索上限の候補

いずれも全fieldを計画blockに固定する。Researchの登録値を比較の基準（baseline）に置くが、baselineであることはProduction値の採用を意味しない。

| boundsId | 役割 | window（通常 / 復元ボーナス / スキル） | 候補数 / 検証回数 | 何を比較・確認するか |
| --- | --- | --- | --- | --- |
| `w0-research` | baseline | 350 / 500 / 1500 | 1 / 1 | Research D-0C / D-1Cの登録条件そのもの（node budget 2,000、lookahead 8、gate・budgetも登録値）。Production計算（Production token・Production adapter・Production build）で同じ代表ケースがどうなるか |
| `w0-candidates-3` | comparison | 350 / 500 / 1500 | 3 / 3 | 候補数・検証回数を増やしても、最初の候補が成立する代表ケースの結果と時間が変わらないこと。棄却された候補の追加コストは測らない（実データにその入力が無い） |
| `w-half` | comparison | 175 / 250 / 750 | 1 / 1 | windowを半分にした場合（到達表が速く、memoryが小さい）に代表ケースがまだ成立するか、`not_found` / `search_bound_reached` になるか |
| `w-wide` | comparison | 525 / 750 / 2250 | 1 / 1 | windowを1.5倍にした場合の時間・memoryの増え方（他の利用者の入力で到達できる範囲が広がる）と、結果が変わるか |

- `w-half` / `w-wide` のgate・budgetはwindowからD-0C登録と同じ式で導く（射影起点gate: 32 / Gogma幅 / Skill幅 + 1 / 通常forge数、形状制約gate:
  深さ = Skill + Gogma、生成状態数 = 深さ × Gogma × (Gogma + 2)、通常forge数、Skill + 1、budget: Gogma生成状態50,000,000（Nodeで完了を観測した範囲。
  変更しない）、Skill状態 = Skill²、settled work 100,000、予測回数 通常 / Skill + 1 / Gogma / Gogma）。node budgetとlookaheadは2,000 / 8で共通
- 比較しない項目と理由:
  - node budget・lookaheadの別値: Researchでは最初のstructural candidateがnode 44で得られた。各runの診断（`expandedNodes`）で実使用量が記録されるので、
    別セットを追加せずに余裕を観測する
  - gateの別値: gateはwindowの最大値であり、window内の探索を拒否しない。実行時間はbudgetが抑える
- 1件の成功から、すべての入力で成立するとは主張しない。最短ルートも主張しない（`best_found`）

## 5. run slot（PC、実行順）

| 順 | slot | 目的 | 探索上限 | 内容 |
| ---: | --- | --- | --- | --- |
| 1 | `pc.pilot.1` | pilot | w0-research | 系列最初の実Export run。環境の観測だけ（母集団外） |
| 2 | `pc.timing.1` | timing | w0-research | 必須比較run 1（時間の母集団） |
| 3 | `pc.rerun.1` | rerun | w0-research | 必須比較run 2（run間の決定性） |
| 4〜8 | `pc.cancel.*` | cancel | w0-research | `input_check` + 0.1 s、`reach_table` + 1 s、`assignment_search` + 0.1 s、`route_generation` + 0.2 s、`plan_verification` + 0.5 s |
| 9 | `pc.rerun.2` | rerun | w0-research | 必須比較run 3。全cancel試験の後の再実行（各cancel試験の再実行slot） |
| 10〜12 | `pc.bounds.*` | bounds | 比較セット | w0-candidates-3、w-half、w-wideの観測 |
| 13〜16 | `pc.memory.*` | memory | 各セット | isolated origin。固定点memory（GC待ち10 s）、CDP Worker heap（0.5 s間隔）、OS renderer memory（1 s間隔） |

- cancel triggerは各stageに入った直後を狙う固定値であり、Node・Research P-2の時間から推測した期待値ではない。目標stageより早く計算が終われば
  `cancel_not_exercised`、別stageで受け付けられればそのstageを記録する
- 時間の母集団は `timing` / `rerun` / `bounds` のうち、完了し・中断（visibility / freeze / pagehide）が無く・integrity issueが無いrun。
  pilot・cancel・memoryのrunは集計しない（slotごとの値は記録する）。memory slotはCDP samplingの負荷があるので時間の母集団に入れない
- Androidは任意（端末と安全な接続経路があれば別途計画する）、iPhoneは対象外（未検証であり、非対応ではない）

## 6. 記録する指標

**計算結果**（raw recordは件数・分類・fingerprintだけを持つ）: result status、計画対象Target数、完成予定Target数、物理操作数、Plan Step数、
structural objective、Conflict / rejected数、generated Entry数、unchanged Target数、除外Entry数、到達した探索上限の種類、
structural searchの展開node数・structural candidate数、Planner検証回数、Stage Dの生成方式内訳、semantic fingerprint（全体と成分別）。

**時間**（区間を混ぜて「総時間」としない）:

| 指標 | 区間 |
| --- | --- |
| `inputPreparationMs` | 入力の準備（parse、移行、検証、`createPlannerInput()`）。計算区間に含めない |
| `workerCreateToRequestPostedMs` | Worker生成の開始 → `blo_run` の送信完了（Worker生成、設定message、入力のserialize） |
| `requestPostMs` | `postMessage(blo_run)` だけ（main threadでの入力のserialize） |
| `requestToFirstProgressMs` | 送信 → 最初のprogress（Workerの起動と入力のdeserialize） |
| `requestToTerminalMs` | 送信 → 結果のmain thread受信 |
| `terminalDataReadMs` / `clientHandlingMs` | 結果messageの `data` 読取り（Browserにより遅延deserializeを含む）/ Clientの構造検査とsettle |
| `workerStageMs` / `workerStageTotalMs` | Worker内のStage 0 / A / B-C / D / D'（Domainの単調時計）と合計（Worker計算時間） |
| `mainObservedStageMs` | main threadが受けたprogressの間隔 |
| `workerCreateToOutcomeMs` / `endToEndMs` | Worker生成 → 結果 / runの開始（入力準備を含む）→ 結果 |
| `cancelSettleMs` | キャンセル要求 → `cancelled` |

**memory**（取得できないものはnull。Nodeの値から推測しない。samplingの最大値は「max sampled」と呼び、連続的な真のpeakと呼ばない）:
Worker heap used / total（CDP）、renderer process private / working set（OS）、main thread heap（`performance.memory`、固定点）、
固定点の `measureUserAgentSpecificMemory()`（isolated、Worker / Window別）、結果保持中（`after_outcome`）と解放後（`after_release`）の差、Worker終了後の解放。

**操作性・安全性**: progressの順と受信時刻、main threadのlong task（最大・合計）、キャンセル → `cancelled` の時間、キャンセル → Worker targetのdetach
（CDP、同一machineの時計）、キャンセル後の結果不採用、settle後に届いたmessage数、再実行の完了、Workerの `error` / `messageerror`、page loss / OOM
（driverが外部証拠で記録）、visibility / freeze / pagehide、IndexedDB / localStorage / sessionStorage / Cache / Service Workerの不変。

**測定できない項目**: Production Workerの最大同期区間。Production Workerは計算中にevent loopへ戻らない（`yieldControl` を渡さない）ので計算全体が1つの
taskであり、Workerを変更せずに区間を分けて測れない。本計測ではWorkerを変更せず、UIへの影響としてmain threadのlong taskを測る。

## 7. semantic比較

- fingerprintの成分: status、generated Entry（ID、Candidate、hash、Route。作成時刻を除く）、置換、unchanged Target、計画対象Target、除外Entry、入力token、
  summary、termination、Conflict、warning、Plan（ID・時刻・現在Step IDを除く）、Step列（Step ID、予約OwnedWeapon ID、期待状態hash、実行効果、表示文言を除く）、
  診断（Workerの時間を除く）。Plan ID・Step ID・予約OwnedWeapon ID・時刻は比較しない（[PLANNER_SPEC.md](PLANNER_SPEC.md) 17.6）
- 比較group: 各探索上限セットのcomparison slot（baselineは4 run、比較セットは2 run）がすべて完了して1つのfingerprintになり、同じHEADのNode referenceと一致する
- 欠けたrun・完了しなかったrunは比較できないものとして扱い、一致とは数えない（`incomplete`）

## 8. 合格基準案（Owner判断待ち）

計画blockの `criteria.items` が機械可読な定義である。値はすべて **提案** であり、Owner承認前は合否に使わない。

| 基準 | 対象 | 提案値 | 根拠 |
| --- | --- | --- | --- |
| semantic一致 | 各セットのcomparison run | 全run同一 + Node一致 | 同じ入力から同じsemantic（17.6 / 17.21） |
| 計算成立 | 各セットのcomparison run | すべて `optimized`、全計画対象Target完成 | 採用するセットは代表ケースを成立させる |
| request → 結果（median） | timing / rerun / bounds | ≤ 40 s | 計測PC（Ryzen 7 9700X）より2〜3倍遅いPCでも約2分以内に収める |
| request → 結果（max） | 同上 | ≤ 60 s | 計測PCの最遅runを1分以内（3倍遅いPCで約3分） |
| main threadのlong task最大 | 同上 | ≤ 1 s | 計算はWorkerで行い、main threadは受信と構造検査だけ |
| Worker heap（max sampled） | memory | ≤ 1 GiB | このPCで観測されたWorker heap上限（約4 GiB）の1/4。memoryの少ない端末の余地を残す |
| renderer private（max sampled） | memory | ≤ 2 GiB | tab全体 |
| main threadの結果保持 | memory | ≤ 256 MiB | Previewがartifactを保持する分 |
| Worker memoryの解放 | memory | 解放後に0 | settle時にterminateする（17.16） |
| キャンセル → `cancelled` | cancel（w0-research） | ≤ 100 ms | Clientは同期的にキャンセルする |
| キャンセル → Worker detach | cancel（w0-research） | ≤ 1 s | `terminate()` は待たずに止める |
| キャンセル後の結果不採用 / 再実行の完了 | cancel（w0-research） | すべて | 17.16 |
| 永続状態の不変 | 全run | すべて | Preview・計算は何も書かない（17.9） |

Research P-2の計測値（同じExportでResearch harnessのfirst Workerが約28 s、Worker heap max sampled約431 MB）は参考であり、上の値は
そこから機械的に決めたものではない。

## 9. Ownerが判断する事項

1. **43目標武器の代表ケースで許容する計算時間**: 推奨は request → 結果のmedian ≤ 40 s、各run ≤ 60 s（計測PC）。より遅いPCでの体感（約2〜3分）を上限と
   みなす考え方を採るか、長時間化の案内（U3）を前提にもっと長く許すかを決める
2. **PC BrowserでのWorker memory**: 推奨はWorker heap max sampled ≤ 1 GiB、renderer private ≤ 2 GiB、main threadの結果保持 ≤ 256 MiB
3. **キャンセル後の終了時間**: 推奨は `cancelled` まで ≤ 100 ms、Worker detachまで ≤ 1 s（CDPで測れない場合は未測定とし、合格とは数えない）
4. **必要なsemantic一致run数**: 推奨はbaseline 4 run（非isolated 3 + isolated 1）+ Node 1、比較セット各2 run + Node 1
5. **`search_bound_reached` の許容条件**: 推奨は「採用するセットでは代表ケースで許容しない（`optimized` 必須）」。比較セットでの `search_bound_reached` /
   `not_found` は観測結果として記録し、そのセットを採用できない理由になるだけとする。syntheticの機能確認（mechanics）では意図した結果である
6. **定数確定の必須根拠**: 推奨は「採用するセットで本計画のすべての基準を満たす（4軸すべて `passed`）」「同じHEADで機能確認計画（mechanics）が `passed`」
   「未確認範囲（他のExport、他のmachine、Android / iPhone、2件目以降の候補）を記録する」の3つ
7. **比較セットの範囲**: 推奨は §4 の4セット。追加・削除する場合はPR-5Bの登録前に決める（計測後に増やさない）
8. **計測条件**: headed Chrome、計測中の他の重い処理（ゲーム、動画エンコード等）を止めること、各slot前のCPU負荷の記録、cancel triggerの遅延値（§5）

## 10. 異常・中断の扱い（事前に固定）

- 自動retryをしない。失敗・中断・timeoutしたslotを別のrunで置き換えない、元のslotに上書きしない、目的を付け替えない。同じslotの2件目以降は計画外
- renderer crash・page lossはdriverが記録する（`page_lost`。crash dumpにOOMの注記がある場合だけ `out_of_memory`）。残りのslotは新しいpage loadで続け、失ったslotは再実行しない
- visibility / freeze / pagehideがあったrunは時間の集計から除く（両方完了していればsemanticは比較に使う）
- driverが途中で止まった場合、残りのslotは未記録とし、同じ系列で補わない。必要なら新しい計画commit・新しい系列で測り直す
- BrowserとNodeの結果が異なっても、計算や条件を合わせて変更しない。原因を切り分けで確定できなければ「原因未特定」と記録する
- 判定不能の分類: `not_comparable`（基準の値が欠けた・runが不足した）、`not_yet_registered`（承認前）、`not_applicable`（その軸の基準が無い）

## 11. 公開結果から除外するもの

Export本体とそのrecord、Target / Entry / OwnedWeapon / Plan / Step / Candidate ID、Base SeedとすべてのCounter値、Plan Stepの詳細、
絶対pathとローカルのuser名。raw recordもこれらを持たない（件数・分類・fingerprintだけ）。rawとdriver記録は `.local/`（git-ignored）に置く。

## 12. 計画block

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
  "planKind": "measurement",
  "series": "pr5b-r1",
  "status": "proposed",
  "approval": {
    "state": "owner_approval_pending",
    "approvedBy": null,
    "approvedOn": null,
    "note": "Issue #260 PR-5A proposal. PR-5B commits the Owner-approved plan (status registered) and measures at that commit."
  },
  "inputs": [
    {
      "inputId": "real-export",
      "kind": "export",
      "fileName": "gogma-artian-planner-backup_20260927015837.json",
      "bytes": 19424064,
      "sha256": "cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b",
      "note": "The Export of D-0B-2 / D-1C / P-2 (43 planning Targets there). Never committed, uploaded or hosted."
    }
  ],
  "boundsSets": [
    {
      "boundsId": "w0-research",
      "role": "baseline",
      "purpose": "The Research D-0C / D-1C registered conditions verbatim, as the reference set of the comparison (being the baseline adopts nothing).",
      "derivation": "MATERIALIZATION_D0C_PREREGISTRATION and the D-1C verification budget, verbatim.",
      "bounds": {
        "window": {
          "normal": 350,
          "gogma": 500,
          "skill": 1500
        },
        "nodeBudget": 2000,
        "mrvLookahead": 8,
        "maxStructuralCandidates": 1,
        "maxPlannerVerifications": 1,
        "routeGeneration": {
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
          }
        }
      }
    },
    {
      "boundsId": "w0-candidates-3",
      "role": "comparison",
      "purpose": "Whether a structural candidate limit and verification budget of 3 leave the representative result and its cost unchanged when the first candidate is accepted (it does not measure the cost of a rejected candidate).",
      "derivation": "w0-research with maxStructuralCandidates 3 and maxPlannerVerifications 3.",
      "bounds": {
        "window": {
          "normal": 350,
          "gogma": 500,
          "skill": 1500
        },
        "nodeBudget": 2000,
        "mrvLookahead": 8,
        "maxStructuralCandidates": 3,
        "maxPlannerVerifications": 3,
        "routeGeneration": {
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
          }
        }
      }
    },
    {
      "boundsId": "w-half",
      "role": "comparison",
      "purpose": "Whether a half window (faster ReachTable, less memory) still yields the representative result, or turns it into not_found / search_bound_reached.",
      "derivation": "The window as named; every gate and budget derived from the window by the D-0C registration formulas (projected gate: 32 / gogma / skill + 1 / normal; shape gate: depth = skill + gogma, generated states = depth × gogma × (gogma + 2), normal, skill + 1; budget: 50,000,000 Gogma states (the Node-observed region, unchanged), skill² Skill states, 100,000 settled work, predictions normal / skill + 1 / gogma / gogma); node budget 2,000, MRV lookahead 8.",
      "bounds": {
        "window": {
          "normal": 175,
          "gogma": 250,
          "skill": 750
        },
        "nodeBudget": 2000,
        "mrvLookahead": 8,
        "maxStructuralCandidates": 1,
        "maxPlannerVerifications": 1,
        "routeGeneration": {
          "projectedSearchScaleGate": {
            "maxConversionPositions": 32,
            "maxGogmaLegalWidth": 250,
            "maxSkillLegalWidth": 751,
            "maxNormalForgeCount": 175
          },
          "shapeSearchScaleGate": {
            "maxDepthUpperBound": 1000,
            "maxGogmaGeneratedStateUpperBound": 63000000,
            "maxNormalForgeCount": 175,
            "maxConversionWalkPositions": 751
          },
          "shapeSearchBudget": {
            "maxGogmaGeneratedStates": 50000000,
            "maxSkillStates": 562500,
            "maxSettledWork": 100000,
            "maxPredictions": {
              "normalArtian": 175,
              "skill": 751,
              "gogmaReset": 250,
              "gogmaKeep": 250
            }
          }
        }
      }
    },
    {
      "boundsId": "w-wide",
      "role": "comparison",
      "purpose": "The time and memory growth of a 1.5x window (more inputs reachable for other users), and whether the representative result changes.",
      "derivation": "The window as named; every gate and budget derived from the window by the D-0C registration formulas (projected gate: 32 / gogma / skill + 1 / normal; shape gate: depth = skill + gogma, generated states = depth × gogma × (gogma + 2), normal, skill + 1; budget: 50,000,000 Gogma states (the Node-observed region, unchanged), skill² Skill states, 100,000 settled work, predictions normal / skill + 1 / gogma / gogma); node budget 2,000, MRV lookahead 8.",
      "bounds": {
        "window": {
          "normal": 525,
          "gogma": 750,
          "skill": 2250
        },
        "nodeBudget": 2000,
        "mrvLookahead": 8,
        "maxStructuralCandidates": 1,
        "maxPlannerVerifications": 1,
        "routeGeneration": {
          "projectedSearchScaleGate": {
            "maxConversionPositions": 32,
            "maxGogmaLegalWidth": 750,
            "maxSkillLegalWidth": 2251,
            "maxNormalForgeCount": 525
          },
          "shapeSearchScaleGate": {
            "maxDepthUpperBound": 3000,
            "maxGogmaGeneratedStateUpperBound": 1692000000,
            "maxNormalForgeCount": 525,
            "maxConversionWalkPositions": 2251
          },
          "shapeSearchBudget": {
            "maxGogmaGeneratedStates": 50000000,
            "maxSkillStates": 5062500,
            "maxSettledWork": 100000,
            "maxPredictions": {
              "normalArtian": 525,
              "skill": 2251,
              "gogmaReset": 750,
              "gogmaKeep": 750
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
          "slotId": "pc.pilot.1",
          "order": 1,
          "purpose": "pilot",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": null,
          "note": "The first real run of the series: environment observation only (outside every population)."
        },
        {
          "slotId": "pc.timing.1",
          "order": 2,
          "purpose": "timing",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": null,
          "note": "Required comparison run 1; timing population."
        },
        {
          "slotId": "pc.rerun.1",
          "order": 3,
          "purpose": "rerun",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": null,
          "note": "Required comparison run 2: determinism across runs."
        },
        {
          "slotId": "pc.cancel.input-check",
          "order": 4,
          "purpose": "cancel",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": {
            "stage": "input_check",
            "delayMs": 100
          },
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": "pc.rerun.2",
          "expect": null,
          "note": "Cancel 0.1 s after input_check started."
        },
        {
          "slotId": "pc.cancel.reach-table",
          "order": 5,
          "purpose": "cancel",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": {
            "stage": "reach_table",
            "delayMs": 1000
          },
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": "pc.rerun.2",
          "expect": null,
          "note": "Cancel 1 s into reach_table."
        },
        {
          "slotId": "pc.cancel.assignment",
          "order": 6,
          "purpose": "cancel",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": {
            "stage": "assignment_search",
            "delayMs": 100
          },
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": "pc.rerun.2",
          "expect": null,
          "note": "Cancel 0.1 s into assignment_search."
        },
        {
          "slotId": "pc.cancel.route-generation",
          "order": 7,
          "purpose": "cancel",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": {
            "stage": "route_generation",
            "delayMs": 200
          },
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": "pc.rerun.2",
          "expect": null,
          "note": "Cancel 0.2 s into route_generation."
        },
        {
          "slotId": "pc.cancel.plan-verification",
          "order": 8,
          "purpose": "cancel",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": {
            "stage": "plan_verification",
            "delayMs": 500
          },
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": "pc.rerun.2",
          "expect": null,
          "note": "Cancel 0.5 s into plan_verification."
        },
        {
          "slotId": "pc.rerun.2",
          "order": 9,
          "purpose": "rerun",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": null,
          "note": "Required comparison run 3, after every cancel trial in the same page session: their re-run slot."
        },
        {
          "slotId": "pc.bounds.w0-candidates-3",
          "order": 10,
          "purpose": "bounds",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w0-candidates-3",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": null,
          "note": "Comparison set observation."
        },
        {
          "slotId": "pc.bounds.w-half",
          "order": 11,
          "purpose": "bounds",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w-half",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": null,
          "note": "Comparison set observation."
        },
        {
          "slotId": "pc.bounds.w-wide",
          "order": 12,
          "purpose": "bounds",
          "origin": "non_isolated",
          "inputId": "real-export",
          "boundsId": "w-wide",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": null,
          "rerunSlotId": null,
          "expect": null,
          "note": "Comparison set observation."
        },
        {
          "slotId": "pc.memory.w0-research",
          "order": 13,
          "purpose": "memory",
          "origin": "isolated",
          "inputId": "real-export",
          "boundsId": "w0-research",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": {
            "fixedPoints": true,
            "gcWaitMs": 10000,
            "cdpWorkerHeap": true,
            "osProcessMemory": true
          },
          "rerunSlotId": null,
          "expect": null,
          "note": "Memory of the baseline set (fixed points, CDP Worker heap, OS renderer memory)."
        },
        {
          "slotId": "pc.memory.w0-candidates-3",
          "order": 14,
          "purpose": "memory",
          "origin": "isolated",
          "inputId": "real-export",
          "boundsId": "w0-candidates-3",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": {
            "fixedPoints": true,
            "gcWaitMs": 10000,
            "cdpWorkerHeap": true,
            "osProcessMemory": true
          },
          "rerunSlotId": null,
          "expect": null,
          "note": "Memory of the comparison set."
        },
        {
          "slotId": "pc.memory.w-half",
          "order": 15,
          "purpose": "memory",
          "origin": "isolated",
          "inputId": "real-export",
          "boundsId": "w-half",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": {
            "fixedPoints": true,
            "gcWaitMs": 10000,
            "cdpWorkerHeap": true,
            "osProcessMemory": true
          },
          "rerunSlotId": null,
          "expect": null,
          "note": "Memory of the comparison set."
        },
        {
          "slotId": "pc.memory.w-wide",
          "order": 16,
          "purpose": "memory",
          "origin": "isolated",
          "inputId": "real-export",
          "boundsId": "w-wide",
          "cancelTrigger": null,
          "faultInjection": null,
          "memory": {
            "fixedPoints": true,
            "gcWaitMs": 10000,
            "cdpWorkerHeap": true,
            "osProcessMemory": true
          },
          "rerunSlotId": null,
          "expect": null,
          "note": "Memory of the comparison set."
        }
      ]
    },
    {
      "environmentId": "android-chrome",
      "status": "optional",
      "reason": "Not a release gate (PLANNER_SPEC 17.17, O12): measured only if a device and a safe local route are available; otherwise unconfirmed.",
      "description": "Android + Chrome (real device)",
      "userAgentMustInclude": [
        "Android"
      ],
      "slots": []
    },
    {
      "environmentId": "iphone-safari",
      "status": "excluded",
      "reason": "Not a verification target (PLANNER_SPEC 17.17, O12 / O19): unverified, never unsupported; no pre-release hosting is created for it.",
      "description": "iPhone + Safari (real device)",
      "userAgentMustInclude": [],
      "slots": []
    }
  ],
  "nodeReference": {
    "runner": "scripts/run-build-list-optimization-node-reference.mjs",
    "runs": [
      {
        "inputId": "real-export",
        "boundsId": "w0-research"
      },
      {
        "inputId": "real-export",
        "boundsId": "w0-candidates-3"
      },
      {
        "inputId": "real-export",
        "boundsId": "w-half"
      },
      {
        "inputId": "real-export",
        "boundsId": "w-wide"
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
        "groupId": "real.w0-research",
        "inputId": "real-export",
        "boundsId": "w0-research",
        "slotIds": [
          "pc.timing.1",
          "pc.rerun.1",
          "pc.rerun.2",
          "pc.memory.w0-research"
        ],
        "requiredBrowserRuns": 4,
        "nodeReferenceRequired": true
      },
      {
        "groupId": "real.w0-candidates-3",
        "inputId": "real-export",
        "boundsId": "w0-candidates-3",
        "slotIds": [
          "pc.bounds.w0-candidates-3",
          "pc.memory.w0-candidates-3"
        ],
        "requiredBrowserRuns": 2,
        "nodeReferenceRequired": true
      },
      {
        "groupId": "real.w-half",
        "inputId": "real-export",
        "boundsId": "w-half",
        "slotIds": [
          "pc.bounds.w-half",
          "pc.memory.w-half"
        ],
        "requiredBrowserRuns": 2,
        "nodeReferenceRequired": true
      },
      {
        "groupId": "real.w-wide",
        "inputId": "real-export",
        "boundsId": "w-wide",
        "slotIds": [
          "pc.bounds.w-wide",
          "pc.memory.w-wide"
        ],
        "requiredBrowserRuns": 2,
        "nodeReferenceRequired": true
      }
    ]
  },
  "criteria": {
    "status": "proposed",
    "items": [
      {
        "criterionId": "semantic.identical",
        "axis": "semantic",
        "description": "Every listed Browser run of the set completed with one semantic fingerprint, equal to the Node reference at the same HEAD.",
        "metric": "semantic_group_identical",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "timing",
            "rerun",
            "bounds",
            "memory"
          ]
        },
        "aggregate": "all",
        "comparator": "equals",
        "threshold": true,
        "unit": null,
        "rationale": "PLANNER_SPEC 17.6 / 17.21: the same input gives the same semantics; IDs and times are excluded from the fingerprint."
      },
      {
        "criterionId": "computation.optimized",
        "axis": "computation",
        "description": "Every comparison run of the set is optimized (search_bound_reached and not_found are not accepted for an adopted set on the representative case).",
        "metric": "result_status",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "timing",
            "rerun",
            "bounds",
            "memory"
          ]
        },
        "aggregate": "each",
        "comparator": "equals",
        "threshold": "optimized",
        "unit": null,
        "rationale": "The Production constants must make the representative real case succeed; a comparison set may fail it, and is then not adoptable."
      },
      {
        "criterionId": "computation.all-targets",
        "axis": "computation",
        "description": "Every planning Target is completed in every comparison run.",
        "metric": "all_planning_targets_completed",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "timing",
            "rerun",
            "bounds",
            "memory"
          ]
        },
        "aggregate": "each",
        "comparator": "equals",
        "threshold": true,
        "unit": null,
        "rationale": "PLANNER_SPEC 17.7 item 1 (already a condition of optimized; recorded separately)."
      },
      {
        "criterionId": "performance.request-to-result.median",
        "axis": "performance",
        "description": "Median of request → result over the timing population of the set.",
        "metric": "request_to_terminal_ms",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "timing",
            "rerun",
            "bounds"
          ]
        },
        "aggregate": "median",
        "comparator": "at_most",
        "threshold": 40000,
        "unit": "ms",
        "rationale": "A PC 2 - 3 times slower than the measurement PC (Ryzen 7 9700X) should stay within about 2 minutes; 40 s on the measurement PC leaves that margin."
      },
      {
        "criterionId": "performance.request-to-result.max",
        "axis": "performance",
        "description": "Every run of the timing population.",
        "metric": "request_to_terminal_ms",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "timing",
            "rerun",
            "bounds"
          ]
        },
        "aggregate": "max",
        "comparator": "at_most",
        "threshold": 60000,
        "unit": "ms",
        "rationale": "The slowest observed run on the measurement PC within 1 minute (3 minutes on a 3x slower PC)."
      },
      {
        "criterionId": "performance.main-long-task",
        "axis": "performance",
        "description": "The longest main-thread long task between the run start and the outcome (the Client's result check included).",
        "metric": "main_long_task_max_ms",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "timing",
            "rerun",
            "bounds"
          ]
        },
        "aggregate": "max",
        "comparator": "at_most",
        "threshold": 1000,
        "unit": "ms",
        "rationale": "The calculation runs in the Worker; the main thread only receives and checks the result, so it should never block the page for a second."
      },
      {
        "criterionId": "memory.worker-heap",
        "axis": "memory",
        "description": "Max sampled Worker V8 used heap (CDP Runtime.getHeapUsage every 0.5 s).",
        "metric": "worker_heap_used_max_bytes",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "memory"
          ]
        },
        "aggregate": "max",
        "comparator": "at_most",
        "threshold": 1073741824,
        "unit": "bytes",
        "rationale": "A quarter of the about 4 GiB Worker heap limit observed on this PC, leaving room for devices with less memory."
      },
      {
        "criterionId": "memory.renderer-private",
        "axis": "memory",
        "description": "Max sampled private bytes of the renderer process (OS, every 1 s).",
        "metric": "renderer_private_max_bytes",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "memory"
          ]
        },
        "aggregate": "max",
        "comparator": "at_most",
        "threshold": 2147483648,
        "unit": "bytes",
        "rationale": "The whole tab within 2 GiB on the measurement PC."
      },
      {
        "criterionId": "memory.main-retained",
        "axis": "memory",
        "description": "Main-thread heap held after the outcome (after_outcome − before_run, performance.memory).",
        "metric": "main_heap_retained_bytes",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "memory"
          ]
        },
        "aggregate": "max",
        "comparator": "at_most",
        "threshold": 268435456,
        "unit": "bytes",
        "rationale": "The Preview holds the artifact in memory; it should stay well below the Worker's footprint."
      },
      {
        "criterionId": "memory.worker-released",
        "axis": "memory",
        "description": "No Worker memory is attributed after the run and the release wait (measureUserAgentSpecificMemory).",
        "metric": "worker_memory_released",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "memory"
          ]
        },
        "aggregate": "each",
        "comparator": "equals",
        "threshold": true,
        "unit": null,
        "rationale": "The Client terminates the Worker at settle (PLANNER_SPEC 17.16)."
      },
      {
        "criterionId": "cancel.settle",
        "axis": "cancel_lifecycle",
        "description": "From the cancel request to the cancelled outcome on the main thread.",
        "metric": "cancel_settle_ms",
        "scope": {
          "inputId": "real-export",
          "boundsId": "w0-research",
          "purposes": [
            "cancel"
          ]
        },
        "aggregate": "each",
        "comparator": "at_most",
        "threshold": 100,
        "unit": "ms",
        "rationale": "The Client cancels synchronously; the screen must change at once."
      },
      {
        "criterionId": "cancel.worker-gone",
        "axis": "cancel_lifecycle",
        "description": "From the cancel request to the Worker target being detached (CDP; same machine wall clock).",
        "metric": "cancel_worker_gone_ms",
        "scope": {
          "inputId": "real-export",
          "boundsId": "w0-research",
          "purposes": [
            "cancel"
          ]
        },
        "aggregate": "each",
        "comparator": "at_most",
        "threshold": 1000,
        "unit": "ms",
        "rationale": "terminate() stops the Worker without waiting for it; its CPU and heap are released within a second."
      },
      {
        "criterionId": "cancel.no-result",
        "axis": "cancel_lifecycle",
        "description": "A cancelled run adopts no result.",
        "metric": "cancel_no_result_adopted",
        "scope": {
          "inputId": "real-export",
          "boundsId": "w0-research",
          "purposes": [
            "cancel"
          ]
        },
        "aggregate": "each",
        "comparator": "equals",
        "threshold": true,
        "unit": null,
        "rationale": "PLANNER_SPEC 17.16."
      },
      {
        "criterionId": "cancel.rerun",
        "axis": "cancel_lifecycle",
        "description": "The re-run slot after the cancel trials completes.",
        "metric": "cancel_rerun_completed",
        "scope": {
          "inputId": "real-export",
          "boundsId": "w0-research",
          "purposes": [
            "cancel"
          ]
        },
        "aggregate": "each",
        "comparator": "equals",
        "threshold": true,
        "unit": null,
        "rationale": "A new run starts from scratch after a cancel (PLANNER_SPEC 17.16)."
      },
      {
        "criterionId": "lifecycle.storage",
        "axis": "cancel_lifecycle",
        "description": "IndexedDB / localStorage / sessionStorage / Cache Storage / Service Worker registrations unchanged by each run.",
        "metric": "storage_unchanged",
        "scope": {
          "inputId": "real-export",
          "boundsId": null,
          "purposes": [
            "pilot",
            "timing",
            "rerun",
            "cancel",
            "bounds",
            "memory"
          ]
        },
        "aggregate": "each",
        "comparator": "equals",
        "threshold": true,
        "unit": null,
        "rationale": "The calculation and the Preview write nothing (PLANNER_SPEC 17.9)."
      }
    ]
  },
  "anomalyRules": [
    "No automatic retry: a failed, cancelled-by-environment, interrupted or timed-out slot keeps its record; nothing re-runs it under its slot ID, moves it to another slot or changes its purpose.",
    "A page loss or renderer crash is recorded by the driver (page_lost; out_of_memory only with crash-dump OOM evidence); the remaining slots continue in a new page load and the lost slot is not re-run.",
    "A run with a visibility change, freeze or pagehide is excluded from the timing population (its semantics still count if it completed).",
    "A driver stop leaves the remaining slots unrecorded; they are never filled in within this series (a new plan commit and series measure again).",
    "Records of another HEAD or of uncommitted benchmark code are refused by the analysis; code changed after the measurement started makes a new measurement HEAD.",
    "A Browser / Node difference is never fixed by changing the calculation or the conditions to match; an unexplained cause is recorded as not identified."
  ],
  "publicExclusions": [
    "The Export body and any of its records.",
    "Target / Build List Entry / OwnedWeapon / Plan / Step IDs and Candidate IDs.",
    "Base Seed and every Counter value, Plan Step details.",
    "Absolute file paths and the local user name."
  ]
}
```
<!-- blo-browser-plan:end -->
