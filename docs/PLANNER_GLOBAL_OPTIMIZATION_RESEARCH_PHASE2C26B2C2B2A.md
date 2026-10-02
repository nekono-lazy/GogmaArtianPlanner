# Global Planner Research Phase 2-C2.6-B2-C2B2A（E1 11 Targetを共通L2 extentで実Search）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Production default
extent、Search algorithm / ordering / comparator、P1は変更していない。L0 / L1 Search、ladder escalation、Target個別extent、
K2 feature / grouping、E2 9件のSearch、residual unreached 3件、Candidate trial、Planner Alternative kernel、full Planner rerun、
global assignment、Production scheduler採用判断、runtime optimization、UIも行っていない。timeout / OOM taskのretry・fallbackもしていない。

- measurement candidate HEAD（`reconstructedMeasuredHead`）: `32130e843cabcb3777f6675a84fa580d114ed27d`。E1 manifest rule・P1 top32 task構築・
  L2 context置換・C4C capture・実行条件・analyzer・事前登録decision rule・testsを含むcommitで、Stage 1 measurementはこのcommitから
  起動した。**ただしこれはpost-hoc再構成時に指定した値であり、runnerが実測開始時にattestしたHEADではない**（§2.2）
- analysis HEAD: `bfe0dd8285c114d4667f335b9548997ab249aa00`（measurement candidate HEAD以後の変更はpost-hoc許可対象の
  `src/benchmarks/plannerGlobalPhase2C26B2C2B2AAnalysis.ts`・`scripts/analyze-planner-global-phase2c26b2c2b2a.mjs`・
  `scripts/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw.mjs`・testだけ。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2A_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2A_RESULT.json)（**`provenance.formal = false`**、
  `evidenceGrade = diagnostic_partial`、`partialRun = true`、`launchProvenanceVerified = false`、decision `B2C2B2A_INCOMPLETE`、invalid reason 0）

## 0. 最重要limitation

> **E1 population・P1・L2 extentは、いずれも過去のoracle post-hoc評価（B2-C1 / B2-C2B1）の影響を受けている。**
> **一方、各Target内でどのcontextを何番目にSearchしたか、どのextentでSearchしたかに、Target個別のoracle情報は使っていない。**
> **さらに本PhaseのStage 1 measurementは352 task中44 taskで意図的に停止したpartial runで、RESULTはformalではなくdiagnostic partial evidenceである（§2.2）。**

| provenance flag | 値 |
| --- | --- |
| `oracleGuidedPolicySelection` | `true`（P1はB2-C1でoracle coverageを見て選んだResearch候補） |
| `oracleGuidedTargetPopulation` | `true`（E1 11件はB2-C2B1 cohort E1 = B2-C1 subgroup extentInsufficient ∧ k1Minimal） |
| `oracleInformedCommonExtent` | `true`（L2はB2-C2B1がE1 cohortのrequired extentから登録したladder rung） |
| `commonExtentForEveryTask` / `perTargetExtent` | `true` / `false`（352 task全部が同一L2。Target個別extentは存在しない） |
| `targetIndividualOracleExtentAsSearchInput` | `false` |
| `contextOrderingUsesOracle` / `oracleReadBySearchChild` / `oracleMatchUsedForEarlyStop` | `false` / `false` / `false` |
| `partialRun` | `true`（§2 intentional stop） |
| `formal` / `evidenceGrade` | `false` / `diagnostic_partial`（launch provenance未検証、§2.2） |
| `launchProvenanceVerified` / `launchWorkingTreeCleanVerified` | `false` / `false` |

本Phaseが示すのは「この実利用Exportで、E1 Targetを共通L2 extentのまま P1上位32 context でSearchすると、実行できたtaskの範囲で何が
起きたか」まで。P1・context budget 32・L2・どのcapture policyもProduction defaultとして採用できるとは結論しない。

## 1. 結論（`B2C2B2A_INCOMPLETE`、non-formal diagnostic partial evidence）

二つの軸を分けて記録する。

| 軸 | 値 | 意味 |
| --- | --- | --- |
| Search semantic decision | **`B2C2B2A_INCOMPLETE`**、`invalidReasons = []` | 事前登録ruleによる判定。semantic INVALIDではない |
| evidence provenance grade | **`formal = false`**、`evidenceGrade = diagnostic_partial` | 停止したrunnerがlaunch時のHEAD / Working Tree clean状態 / code hashを永続化しておらず、launch provenanceを証明できない |

観測したchild record（44 started task）はdiagnostic partial evidenceとして保持する。provenance gradeの格下げは、測定結果を無効・失敗と
するものではない。

事前登録ruleにより **`B2C2B2A_INCOMPLETE`**。理由は二重で、どちらもINCOMPLETEに落ちる:

1. 実行した44 taskのうち **9 taskが未計測**（timeout 7、OOM 2）。登録ruleではtimeout / OOMはCandidate 0ではなく未計測。
2. プロジェクトオーナー判断でStage 1を意図的に停止し、**308 taskが `notRun`**。notRunもCandidate 0やSearch failureには変換していない。

semantic failure・reservation violation・incompatible contextからのexact / partialはいずれも0、invalid reasonは0。partial runを
`ALL_*` へ昇格させる経路は無い（notRunが1件でもあればunmeasured task > 0でINCOMPLETE）。

実行できた範囲の観察（判定ではない）:

| | 値 |
| --- | --- |
| 実行したTarget | t00（32 / 32 context）、t01（12 / 32 context）。残り9 Targetは0 / 32 |
| C8 / C32 / C4C exactに到達したTarget | 2 / 2 / 2（t00・t01。どちらも **first exact rank = B2-C1 first compatible rank**、delta 0、Candidate index 0） |
| compatible context（計測分） | 6件、6 / 6でC8 exact |
| 未計測9 task | **9件ともreservation-incompatible context**（§6） |

**最も重要な観察**: t00はB2-C2B1上 **L1で既にcoverされるTarget** だったが、共通L2の32 contextでtimeout 5 / OOM 2が発生した。
「E1 11件をsemanticにcoverするL2」と「E1 11件へ一律適用して実用的にSearchできるL2」は同義ではない（§7）。

## 2. intentional stop（意図的停止）

| 項目 | 値 |
| --- | --- |
| Stage 1 measurement開始 | 2026-10-02 10:13:21 UTC頃（tasks child終了 10:13:26.8 UTC、wall 5.6 s） |
| 停止 | **2026-10-02 12:44:17.919 UTC** |
| 停止境界 | 実行中child `t01-r12` が自力で終了（timeout 600.2 s）しlogに結果が記録された直後に、parent runnerをkill。次のchildは起動していない |
| 実行 / 未実行 | planned 352、started 44（completed 35、timeout 7、OOM 2、process failure 0、context mismatch 0）、**notRun 308** |
| 理由 | プロジェクトオーナーが「既に得た結果で、共通L2 extentのresource feasibilityについて十分なnegative evidenceが得られた」と判断し、352 task完走を不要として本Phaseを `B2C2B2A_INCOMPLETE` で閉じた |
| 守ったこと | 測定条件・concurrency・extent・capture ruleを変えず続行しない、retry（30 / 60分）なし、既存child recordの削除・上書き・再実行なし |

- `t01-r13` は、parentが停止直前にtask file（`stage1-t01-r13.task.json`）だけを書いた状態だった。child processは観測されず、memory file /
  record fileも無い。**notRun** として扱う（Search failureでもCandidate 0でもない）。
- runnerのlog末尾の `EXIT 0` は、detached起動に使った `cmd /c` の `%ERRORLEVEL%` が行の解析時点で展開された値で、runnerの終了状態を
  表さない（runnerはkillされた）。
- Stage 1 measurementの起動は2回目である。1回目は、Claude Code sessionのbackground実行上限（2時間）に巻き込まれないようsession外の
  detached processで起動し直すため、**tasks child（schedule再導出・task構築、Searchなし）の途中で停止**した（`.local/c2b2a-aborted1.run`:
  task file / memory fileのみ、record無し）。起動command・条件は同一（`--allow-uncommitted` / smoke optionなし）。

### 2.1 partial rawのpost-hoc再構成

runnerは全taskが終わったときにだけaggregate rawを書く構造だったため、停止したrunのaggregate rawは存在しない。そこで
`scripts/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw.mjs`（post-hoc、Searchを実行しない、child recordを書き換えない）で、
run dir・child record・runner logから同じ形のrawを組み立てた。

| 項目 | 値 |
| --- | --- |
| reconstructed raw | `PLANNER_GLOBAL_PHASE2C26B2C2B2A_RAW.json.local`、SHA-256 `d393c263d17a05e769d024df62a929efac2c260741e5e2273234c61e344dcb6f`（committed scriptで再生成して同一） |
| run dir inventory | 127 files、inventory SHA-256 `35516f7d87dd16db0fcdd3e05683a98522ba47987e25b2f945f3011687c9b7d2`（全file名とSHA-256） |
| child record | 35件 + tasks record。各recordのtaskはtask fileと構築taskに一致 |
| logから再構成した値 | process wall（0.1 s分解能）、失敗childの最終IPC heap（log値とsubsampleされたmemory.jsonl最終行の大きい方。RSSは下限） |
| 失われた値 | parentのin-memory process table、失敗childのexit code / stderr tail（`null`で記録） |
| benchmarkCodeSha256 | `adc9631a6574eb75dffcd6f26d1a8ea595e3fe3e3551edfe3fa87f6563f3596c`（再構成時に指定したmeasurement candidate HEADのgit objectから、runnerと同じ規則でpost-hoc再計算。launch時の観測値ではない） |
| `status` | `intentionally_stopped`（`reconstruction.postHoc = true`、`childRecordsModified = false`、`searchRun = false`） |

analyzer / analysis moduleの変更はpost-hocのみ: `intentionally_stopped` rawを解析対象として受け付け、実行taskがtask順の
prefixであること・残りがちょうど `notRunTaskIds` であることをfail-close確認し、notRunを未計測として数える。決定ロジックは不変
（decision ruleの文言にnotRunを明記しただけ）。

### 2.2 launch provenanceとevidence grade（formalではない理由）

> Stage 1 measurementは44 / 352 taskで意図的に停止した。観測したchild recordはdiagnostic partial evidenceとして保持する。
> 停止したrunnerはlaunch時のrepository HEAD / Working Tree clean状態 / code hashのattestationを永続化していなかったため、
> 再構成したrunはformal evidenceと分類できるほど強くlaunch provenanceを証明できない。
>
> `provenance.formal = false`、decision = `B2C2B2A_INCOMPLETE`、`invalidReasons = []`

runnerは全task終了時にだけraw（launch時に計算したHEAD・uncommitted判定・benchmark code hashを含むenvironment）を書く。停止したrunでは
そのrawが無く、Search開始前にrunnerが永続化したimmutableなattestationも無い。したがって:

| RESULT provenance field | 値 | 意味 |
| --- | --- | --- |
| `formal` | `false` | 通常のformal条件（calc変更なし・analysis commit済み・smokeなし）は満たすが、launch provenanceが未検証 |
| `evidenceGrade` | `diagnostic_partial` | |
| `launchProvenanceVerified` / `launchProvenanceSource` | `false` / `none` | runner raw（完走時）もrunner start attestationも無い |
| `launchProvenanceReason` | The stopped parent runner did not persist an immutable start attestation containing the actual repository HEAD, working-tree cleanliness and benchmark code hash. measuredHead and benchmarkCodeSha256 were reconstructed post hoc. | |
| `measuredHead` / `reconstructedMeasuredHead` | `32130e8…` | `measuredHeadSource = post_hoc_reconstruction_argument`。再構成時に指定したmeasurement candidate HEAD。`codeChangedSinceMeasuredHead` はこのcommitからのdiff |
| `benchmarkCodeSha256Source` | recomputed post hoc … | 上記HEADのgit objectからの再計算値 |
| `uncommittedBenchmarkCode` / `launchWorkingTreeCleanVerified` | `null` / `false` | launch時のWorking Tree状態は不明。「uncommittedではなかった」とは後付けで断定しない |
| `rawRecordedUncommittedBenchmarkCode` | `false` | 保持している再構成raw（SHA-256 `d393c263…`）は本修正前のscriptで作られ、`false` を書いていた。analyzerはこの値を読まず、記録値として残すだけ |
| `calculationCodeChangedSinceMeasuredHead` / `measurementCodeChangedSinceMeasuredHead` | `[]` / `[]` | |
| `analysisCodeUncommitted` | `false` | |

analyzerのformal判定は `formal = 通常のformal条件 AND launch provenance verified` で、launch provenanceは
`phase2c26b2c2b2aLaunchProvenance()` が判定する。完走したrunner raw、またはrunnerがSearch前に永続化した完全なstart attestation
（`attestedBy: 'runner'`、clean、environmentと一致）だけがverifiedになる。`intentionally_stopped` かつ `reconstruction.postHoc` で
あることや、再構成scriptに任意の `--measured-head` を渡すことではformalにならない。今回のRESULTは `--allow-nonformal` で生成したが、
このoptionはnon-formal RESULTの書き出しを許すだけで、formalへは昇格させない（testで固定）。

再構成scriptも修正し、launch時の値を断定しないようにした（`uncommittedBenchmarkCode: null`、`launchWorkingTreeCleanVerified: false`、
`repositoryHeadSource` / `benchmarkCodeSha256Source` の明示、attestationは書かない）。Search / measurement code、run dir、child record、
runner log、保持している再構成rawは変更していない。RESULTの測定部分（aggregates・taskRows・targets・parity・decision・invalidReasons等）は
修正前と完全に同一で、変わったのはprovenanceだけである。

## 3. 方針

```text
B2-C2B1 RESULT（SHA-256 418166d2…、registered） + B2-C1 RESULT（04904faf…）
  -> parsePhase2C26B2C2B2AB2C2B1Authority()（formal / calc変更なし / CHARACTERIZED / reasons・invalid・unreadable無し /
       counts 20・11・9・20・3 / E1 rank max 32 / E2 50..306 / ladder L0・L1・L2 / L2 = 128・235・1500 / coverage 0・7・11 of 11 /
       oracleReadByCalculation = false / targetIndividualOracleExtentAsSearchInput = false / hash chain / predecessor SHA-256）
  -> phase2c26b2c2b2aPopulation(): B2-C1 extentInsufficient ∧ k1Minimal = B2-C2B1 E1、defaultExtent / unreached / E2と非重複
  -> phase2c26b2c2b2aTargetManifest(): Target ID 11件だけ（rank / digest / required extent / rung / oracle field無し）
       -> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2A_TARGETS.json.local（SHA-256 7250c574…）
Search runner（Export + Target manifestのみ読む）
  -> tasks child: derivePhase2C26B2C1Schedule()（Production default extentのまま：universe / P1 / digest / fixed set不変）
       -> 各TargetのP1 rank 1..32 -> reconstructPhase2C26B2B2AContext()（default extent）
       -> phase2c26b2c2b2aL2Context(): extentだけをL2へ置換、他fieldはdefault reconstructionと同一をfail-close確認、
          Search input digestは既存 phase2c26b1SearchInputDigest() でL2 bodyから再計算（default digestも保持）
       -> 11 × 32 = 352 task（違えばSearchしない）
  -> Search child（taskごとにfresh process）: scheduleを再導出し、Target × P1 rankの行・default / L2 digest・extentを照合
       visitPlannerAlternativeCandidates() 無変更、共通L2 { Normal 128, Gogma 235, Skill 1500 }
       B2-C2A C4C capture無変更（4 distinct cost cohort完全drain、5番目のcost先頭はsentinel、safety cap 1024）
analyzer（run終了後のみ）: scheduleを再導出しparity確認、oracle RESULT / manifestを読み
  compatibility = phase2c26b2c2aReach()（-> phase2c26b2c1TargetReach() -> phase2c26b2aReachability()）、
  coverage = phase2c26b2c2aCompareContext()（-> phase2c26b2b2aCompare() -> phase2c2OracleCoverage()）
```

Search childが知るのは Target・P1 rank・group / reservation digest / representative alias・default / L2 Search input digest・
共通L2 extent・capture rule・safety capだけ。oracle RESULT / manifest・B2-C1 firstCompatible・B2-C2B1 required extent・Target個別
minimum extent・expected stable key / Candidate index / cost / route kind / exact context・compatibility・L1でcoverされるか否かは
知らない（testで固定）。visitorの `'stop'` はsentinelとsafety capの2箇所だけで、oracle matchによるearly stopは無い。

## 4. 実行条件（Stage 1 measurement前に登録、変更なし）

| 項目 | 値 |
| --- | --- |
| E1 Targets / context budget / tasks | 11 / 32（P1 rank 1..32） / 352 |
| Search extent | **共通L2 `{ maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }`**（全task同一） |
| schedule extent | Production default `{ 4, 235, 4 }`（reservation universe・P1 ordering・digest不変） |
| capture | C4C（4 cohort + sentinel、safety cap 1024）。C8 / C32はC4C captureのprefix（Searchは1回） |
| Stage 1 | fresh child / task、heap 8192 MB、**concurrency 1**、budget 10分、`setImmediate` yield、memory sampling 250 ms、retry / fallbackなし |
| 環境 | Node v24.19.0（Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |

Stage 1 measurement前のnon-formal smoke（4 task、`--allow-uncommitted`）は配線確認だけに使い、smoke結果を見て条件を変えていない。

## 5. 実行結果

| | 件数 |
| --- | ---: |
| planned | 352 |
| started | 44 |
| completed | 35 |
| timeout（10分） | 7 |
| OOM（heap 8 GB） | 2 |
| process failure / context mismatch | 0 / 0 |
| **notRun（intentional stop）** | **308** |
| safety cap（capture 1024件、`captureComplete = false`） | 14 |

Target別:

| Target | planned | started | completed | timeout | OOM | notRun |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| t00 `02876df4-cd56-4c95-add9-9e3e9cc90801` | 32 | 32 | 25 | 5 | 2 | 0 |
| t01 `05e6b206-21d4-447d-86dd-f5a62ff8479e` | 32 | 12 | 10 | 2 | 0 | 20 |
| 残り9 Target（070a1222, 188571a7, a367c177, a6c17e25, b27e57a7, b6780f04, d453ca34, e4147de7, e523209e） | 各32 | 0 | 0 | 0 | 0 | 各32 |

runtime / memory（44 started task、GBは10^9 bytes）:

| | min | median | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Search elapsed（completed 35） | 0.6 s | 43.9 s | 460 s | 543 s | 570 s |
| child process wall（started 44） | 5.3 s | 78.5 s | 600 s | 600 s | 600 s（timeout） |
| peak heap | 0.26 GB | 2.37 GB | 5.03 GB | 6.02 GB | **8.51 GB**（OOM） |
| peak RSS | 0.67 GB | 2.65 GB | 5.52 GB | 6.50 GB | 8.86 GB |
| yields（completed） | 2,913 | 240,656 | 4,755,745 | 5,315,758 | 5,778,065 |

child process wall合計 9,046 s（2時間31分、concurrency 1）。schedule再導出は1 childあたり4.0〜4.3 s。

## 6. t00の32 context全件

t00 = `02876df4-cd56-4c95-add9-9e3e9cc90801`（B2-C2B1: new Normal Route、`normal_artian_to_gogma`、conversionあり、7 operations、
P1 first compatible rank 8）。`C` = reservation-compatible（post-hoc）。

| rank | K | process | termination | captured | captured costs | C | coverage | exact idx / cost | wall s | Search s | heap MiB | RSS MiB |
| ---: | ---: | --- | --- | ---: | --- | :-: | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 0 | completed | 4 cohorts | 4 | 179/184/204/211 | | uncovered | | 20.0 | 15.0 | 553 | 743 |
| 2 | 1 | completed | 4 cohorts | 439 | 11/12/13/14 | | uncovered | | 41.5 | 36.5 | 798 | 1067 |
| 3 | 1 | completed | 4 cohorts | 126 | 24/25/26/27 | | uncovered | | 106.5 | 101.6 | 1317 | 1574 |
| 4 | 1 | completed | 4 cohorts | 439 | 49/50/51/52 | | uncovered | | 165.9 | 161.1 | 2046 | 2505 |
| 5 | 1 | completed | 4 cohorts | 177 | 102/103/104/105 | | uncovered | | 48.3 | 43.4 | 1434 | 1836 |
| 6 | 1 | completed | safety cap | 1024 | 124/125/126 | | uncovered | | 13.9 | 9.1 | 1052 | 1250 |
| 7 | 1 | completed | 4 cohorts | 378 | 124/125/126/127 | | uncovered | | 9.6 | 4.8 | 405 | 734 |
| **8** | 1 | completed | safety cap | 1024 | 7/8/9 | **C** | **exact** | **0 / 7** | 76.8 | 71.8 | 4250 | 4599 |
| 9 | 1 | completed | 4 cohorts | 7 | 117/118/119/120 | | uncovered | | 78.5 | 73.7 | 1566 | 2006 |
| 10 | 1 | **timeout** | | | | | | | 600.3 | | 4877 | 5260 |
| 11 | 1 | **timeout** | | | | | | | 600.2 | | 3203 | 3807 |
| 12 | 1 | completed | 4 cohorts | 352 | 29/30/31/32 | | uncovered | | 465.2 | 460.2 | 3034 | 3435 |
| **13** | 1 | completed | safety cap | 1024 | 7/8 | **C** | **exact** | **0 / 7** | 14.3 | 9.6 | 968 | 1218 |
| 14 | 1 | completed | 4 cohorts | 4 | 31/32/33/34 | | uncovered | | 253.5 | 248.8 | 1846 | 2174 |
| 15 | 1 | completed | 4 cohorts | 4 | 48/49/50/51 | | uncovered | | 346.2 | 341.4 | 2565 | 2979 |
| 16 | 1 | completed | safety cap | 1024 | 54/55 | | uncovered | | 149.6 | 144.6 | 4628 | 5134 |
| 17 | 1 | **OOM** | | | | | | | 184.3 | | 8116 | 8452 |
| 18 | 1 | completed | 4 cohorts | 4 | 84/85/86/87 | | uncovered | | 244.0 | 239.0 | 4622 | 5537 |
| 19 | 1 | completed | 4 cohorts | 4 | 116/117/118/119 | | uncovered | | 100.7 | 95.9 | 3107 | 3771 |
| 20 | 1 | completed | safety cap | 1024 | 102/103 | | uncovered | | 70.6 | 65.7 | 5743 | 6196 |
| 21 | 1 | completed | safety cap | 1024 | 106/107/108 | | uncovered | | 48.0 | 43.0 | 2258 | 2524 |
| 22 | 1 | completed | safety cap | 1024 | 108/109 | | uncovered | | 49.1 | 43.9 | 4236 | 4549 |
| 23 | 1 | completed | 4 cohorts | 4 | 127/128/129/130 | | uncovered | | 71.5 | 66.7 | 1789 | 2242 |
| 24 | 1 | **OOM** | | | | | | | 87.0 | | 8078 | 8411 |
| 25 | 1 | **timeout** | | | | | | | 600.2 | | 3950 | 4233 |
| 26 | 1 | **timeout** | | | | | | | 600.2 | | 3787 | 4089 |
| 27 | 1 | **timeout** | | | | | | | 600.2 | | 3480 | 3812 |
| 28 | 1 | completed | 4 cohorts | 349 | 29/30/31/32 | | uncovered | | 575.3 | 570.4 | 3371 | 3791 |
| 29 | 1 | completed | 4 cohorts | 352 | 28/29/30/31 | | uncovered | | 547.8 | 543.0 | 3265 | 3684 |
| 30 | 1 | completed | 4 cohorts | 352 | 29/30/31/32 | | uncovered | | 468.1 | 463.2 | 2931 | 3295 |
| **31** | 1 | completed | safety cap | 1024 | 7/8 | **C** | **exact** | **0 / 7** | 19.0 | 14.0 | 1731 | 2041 |
| 32 | 1 | completed | 4 cohorts | 4 | 33/34/35/36 | | uncovered | | 262.2 | 257.4 | 1842 | 2156 |

- compatible contextはrank 8 / 13 / 31の3件で、3件ともcost 7のcohortの先頭（index 0）にoracle exact Routeがpublishされた（C8 hit）。
  3件ともsafety capで止まっている（cost 7〜9の大きなequal-cost cohort）が、exactは先頭にあるのでC4C判定に影響しない。
- timeout 5（rank 10 / 11 / 25 / 26 / 27）・OOM 2（rank 17 / 24）は **すべてreservation-incompatible context**。
- t00の未計測7 taskはすべてincompatibleで、t00自体はrank 8でexactが確定している。ただし「incompatibleならexactを出さない」は本Phaseで
  検証している契約（incompatibleからexactが出ればINVALID）を前提にした条件付き解釈で、timeout / OOMをCandidate 0とは扱っていない。

t01 = `05e6b206-21d4-447d-86dd-f5a62ff8479e`（owned Gogma、`existing_gogma_mixed`、3 operations、P1 first compatible rank 3、compatible
rank 3 / 5 / 9 / 14 / 17 / 18 / 32）はrank 1..12を実行: compatibleの3 / 5 / 9はいずれもcost 3 cohortの先頭（index 0）でexact（safety cap、
wall 6〜27 s）。timeoutはrank 11 / 12（どちらもincompatible、heap 4,801 / 3,485 MiB）。rank 14 / 17 / 18 / 32のcompatible contextはnotRun。

## 7. post-hoc diagnostic: semantic coverageと実用的なSearch可能性

B2-C2B1がt00について記録した値:

| 項目 | t00 |
| --- | --- |
| required Normal / Gogma / Skill | **5 / 119 / 22**（insufficient: Normal・Skill） |
| first covering rung | **L1** `{ 8 / 235 / 256 }` |
| 本PhaseのSearch extent | 共通L2 `{ 128 / 235 / 1500 }` |

t00はL1で既にsemanticにcoverされるTargetだが、E1全体をcoverするために選んだ共通L2を一律に適用した結果、32 contextでtimeout 5・
OOM 2が発生した（いずれもincompatible context、compatible contextは10〜77 sでexact）。schedulerはcontextがcompatibleかを知らずに
上位から順にSearchするので、incompatible contextの重さもそのまま実行コストになる。

これは次のことを示すevidenceである:

> **「E1 11件をsemanticにcoverするL2」と「E1 11件へ一律適用して実用的にSearchできるL2」は同義ではない。**

B2-C2B1のE1 required extent（参考、Search inputではない）:

| Target | required N / G / S | first rung | P1 first compatible |
| --- | --- | --- | ---: |
| 02876df4（t00） | 5 / 119 / 22 | L1 | 8 |
| 05e6b206（t01） | — / 46 / 46 | L1 | 3 |
| 070a1222 | 126 / 23 / 450 | L2 | 17 |
| 188571a7 | — / 17 / 446 | L2 | 18 |
| a367c177 | — / 59 / 1083 | L2 | 11 |
| a6c17e25 | — / 107 / 248 | L1 | 32 |
| b27e57a7 | — / 99 / 226 | L1 | 31 |
| b6780f04 | — / 110 / 145 | L1 | 14 |
| d453ca34 | — / 22 / 547 | L2 | 18 |
| e4147de7 | — / 125 / 168 | L1 | 31 |
| e523209e | — / 42 / 8 | L1 | 2 |

L1で足りるt00・t01の2件ですら共通L2で未計測taskが9件出たため、L2でしかcoverされない4件（Skill 446〜1083）や、first compatible rankが
31〜32の3件がL2で完走するかは本Phaseでは分からない。

## 8. diagnostic comparison: B2-C2A（default extent）との比較

**診断のみ。Production採用判断やdecision条件には使わない。** population（B2-C2A: defaultExtent 20 Target × P1 1..16、本Phase: E1の
t00・t01 × 実行分）もconcurrency（3と1）も異なるので、process wallは直接比較できない。

| | B2-C2A（default `{4, 235, 4}`、concurrency 3） | B2-C2B2A（L2 `{128, 235, 1500}`、concurrency 1） | 比 |
| --- | --- | --- | ---: |
| task | 320（completed 318） | started 44（completed 35） | |
| timeout / OOM | 2（0.6 %） / 0 | **7（15.9 %） / 2（4.5 %）** | |
| Search elapsed median | 15.4 s | 43.9 s | 2.85× |
| Search elapsed p90 | 187 s | 460 s | 2.46× |
| Search elapsed max | 460 s | 570 s | 1.24× |
| peak heap max | 5.02 GB | 8.51 GB（OOM: heap上限8192 MiBに到達） | 1.70× |
| peak RSS max | 5.41 GB | 8.86 GB | 1.64× |
| yields median | 96,231 | 240,656 | 2.50× |
| safety cap | 14 / 318 | 14 / 35 | |

## 9. oracle comparison（計測した35 task）

| | 件数 |
| --- | ---: |
| compatible contexts searched | 6（t00 rank 8 / 13 / 31、t01 rank 3 / 5 / 9） |
| compatible + exact（C8 / C32 / C4C） | 6 / 6 / 6 |
| compatible + no exact | 0 |
| incompatible contexts searched | 29 |
| **incompatible + exact**（sentinel含む） | **0** |
| **incompatible + partial**（sentinel含む） | **0** |
| reservation violation（sentinel含む全delivery） | **0** |
| nonmonotonic cost sequence | 0 |

| Target | B2-C1 first compatible | C8 | C32 | C4C | delta | Candidate index | cost | miss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| t00 02876df4 | 8 | 8 | 8 | 8 | 0 | 0 | 7 | — |
| t01 05e6b206 | 3 | 3 | 3 | 3 | 0 | 0 | 3 | — |
| 残り9 Target | 2〜32 | — | — | — | — | — | — | unmeasured |

context budget別exact Target数（C8 = C32 = C4C）: top1 0、top2 0、top4 1、top8 2、top16 2、top32 2。
B2-C2Aで見た「first exact rank = first compatible rank」は、実行できた2 Targetでも成立した（2 / 2、delta 0）。これは比較記録で、
decision条件ではない。

first compatible rankのparity: B2-C1 RESULT・B2-C2B1 RESULT・analyzerの再計算が11 / 11 Targetで一致。

## 10. Candidate distribution（計測した35 context）

| | 値 |
| --- | --- |
| delivered / captured | 17,948 / 17,927（sentinel 21） |
| termination | four_cost_cohorts_drained 21、candidate_safety_cap 14 |
| captured length | min 4、median 352、p90 1,024、max 1,024（8件未満 9 context） |
| distinct cost cohorts | 4: 27、3: 3、2: 5 |
| route kind | `normal_artian_to_gogma` 16,794、`existing_gogma_mixed` 1,133 |
| held Route / late start | 17,630 / 17,193（Gogma 15,537、Skill 16,776、Normal 462） |
| unique stable keys | t00 8,710、t01 4,784 |

safety capの14 contextのうち、compatible contextは6件（exactは全て先頭）、incompatible 8件。safety capで判定が未確定になったTargetは無い
（`unresolvedSafetyCapTargets = 0`）。

## 11. authority / hash chain / provenance

| authority | 値 |
| --- | --- |
| B2-C2B1 RESULT | `418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae`（登録値、最新mainのcommitted fileから算出）、formal、calc変更なし、`B2C2B1_CHARACTERIZED`、E1 11 / E2 9、ladder L0 / L1 / L2 |
| B2-C1 RESULT | `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac`（B2-C2B1記録値と一致） |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d`（B2-C2B1 = B2-C1記録値と一致） |
| B2-C2A RESULT（diagnosticのみ） | `9b2736cc0a58c039837207d4caa41a6360715e7dd72e26237a6366b80d1bd74f` |
| oracle RESULT | `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1` |
| oracle manifest | file `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、Routes `ffb6db5a39e248b950a75f9094ae641a4a35f256a035e37564227bdc6e0e73cc`（43 / 43整合） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（run = Target manifest = B2-C2B1 = B2-C1 = B2-B1 = oracle） |
| Target manifest | `7250c5746a1578c9f15402ab486c162978672dd9d760b5eca8fe57da60a49108`（= E1 11件、runner記録値と一致） |
| benchmark code | `adc9631a6574eb75dffcd6f26d1a8ea595e3fe3e3551edfe3fa87f6563f3596c` |

hashChain 22項目すべてtrue。schedule parity（352 taskが再導出scheduleと完全一致、contexts / origin digest、schedule extent =
Production default、全taskが共通L2、Target個別extentなし、notRunがintentional stopと一致、CalculationContext・RNG Engine
`production-rng:c5-e7` 一致、各TargetがP1 rank 1..32）すべてtrue。population parity（manifest = E1、E2 / defaultExtent / unreachedとの
重複0）true。

## 12. 未検証事項・limitation

- 9 Target（E1の大半、L2でしかcoverされない4件を含む）は1 contextもSearchしていない。L2でE1を回収できるかは本Phaseでは不明。
- timeout / OOM 9 taskの結果（Candidate有無、exact有無）は不明。incompatibleなのでexactを出さないという読みは条件付き解釈にすぎない。
- launch provenance（実測開始時のHEAD・Working Tree clean状態・benchmark code hash）はrunnerにattestされておらず、RESULTはformalではない（§2.2）。
- process wall・失敗childのheapはlogからの再構成値、失敗childのRSSは下限、exit code / stderr tailは失われた。
- Node / Vite SSRでの計測で、Browser Workerの計測ではない。concurrency 1。
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない。

## 13. 次Phase候補（本PRでは実行しない、レビュー後に決める）

- **runner start attestation**: formal runを途中停止してもprovenanceを保てるよう、parent runnerがSearch開始前に、少なくとも
  repository HEAD、Working Tree clean / uncommitted benchmark状態、benchmarkCodeSha256、Export SHA-256、Target manifest SHA-256、
  registered execution conditions、createdAtを含むimmutableなstart attestationをrun dirへ永続化する（本PRでは実装しない。analyzer側の
  検証関数 `phase2c26b2c2b2aLaunchProvenance()` はこの形を受け付ける）

- L1（`{8, 235, 256}`）などTargetのfirst covering rungを使うladder escalation（E1のうちL1でcoverされる7件はL1で済む可能性）
- incompatible contextでのresource explosion（Skill 1500 / Normal 128のheld-aware Search）の原因調査
- timeout / OOM taskだけの長時間・大heap再測定
- Search runtime optimization（Production判断とは切り離す）
