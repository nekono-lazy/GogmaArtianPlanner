# Global Planner Research Phase 2-C2.6-B2-C2B2E（B2-C2B2D未回収2 Targetの同一Search input × 拡張execution budget diagnostic）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Production default
extent、Search algorithm / ordering / comparator、Candidate materializer、P1、captureは変更していない。16 GB heap retry、60分超、
automatic fallback、B2-C2B2C timeout 108件・B2-C2B2B timeout 33件の再実行、Search最適化、Production extent / rung selector、E2 9 Target、
K2 grouping、residual 3 Target、global assignment、full Planner、UIは行っていない。

- measurement HEAD: `e69a94ea0fdd1ef39a39286dffab1bfc44fb1f0b`（runnerがchild起動前にstart attestationで記録。`measuredHeadSource = runner_start_attestation`）
- analysis HEAD: `e69a94ea0fdd1ef39a39286dffab1bfc44fb1f0b`（measurement HEADと同一。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json)（**`provenance.formal = true`**、
  `evidenceGrade = formal`、`partialRun = false`、`launchProvenanceVerified = true`、decision **`B2C2B2E_INCOMPLETE`**、invalid reason 0）

## 0. 最重要limitation（oracle-guided diagnostic）

> **このPhaseは明示的なoracle-guided diagnosticである。population・context・extentはB2-C2B2Dと同じく過去のoracle post-hoc評価由来で、
> さらにexecution budgetをB2-C2B2Dより拡大している。Production scheduler / Production extent selection / Production runtimeのevidenceにはならない。**

| provenance flag | 値 | 意味 |
| --- | --- | --- |
| `oracleGuidedTargetPopulation` | `true` | 2 TargetはB2-C2B2D RESULTの `recovery = none` かつ task process ∈ {timeout, out_of_memory} |
| `oracleGuidedContextSelection` | `true` | contextはB2-C2B2Dと同じB2-C1記録のP1 first compatible rank |
| `oracleInformedPerTargetExtent` / `targetIndividualOracleExtentAsSearchInput` / `perTargetExtent` | `true` / `true` / `true` | extentはB2-C2B2Dと同じ `max(Production default, B2-C2B1 required)` |
| `oracleReadBySearchChild` / `oracleMatchUsedForEarlyStop` / `expectedOutcomeKnownBySearchChild` | `false` / `false` / `false` | Search childはoracleもB2-C2B2Dの計測値も知らない |
| `productionSchedulerEvidence` / `productionExtentSelectionEvidence` | `false` / `false` | |

確認したのは「B2-C2B2Dと完全に同じSearch inputで、budgetを10分 → 60分、heapを8 GB → 12 GBに広げたとき、既存Searchがexact oracle Routeを
deliverできるか」のみ。

## 1. 結論

| 軸 | 値 |
| --- | --- |
| Search semantic decision（diagnostic、scheduler decisionではない） | **`B2C2B2E_INCOMPLETE`**、`invalidReasons = []`（2 task中1 taskが60分timeout） |
| evidence provenance grade | **`formal = true`**、`evidenceGrade = formal`、`partialRun = false` |
| measurement completeness | incomplete：measured 1 / 2（timeout 1、OOM 0、process failure 0、context mismatch 0、notRun 0） |
| route recovery（2 Target中） | **C8 1 / C32 1 / C4C 1**（未計測はCandidate 0扱いしない、下限） |
| 次Phase分岐（別軸） | **C**：heap_growth型（t00）だけ回収、time_bound型（t02）は60分でも未計測 |
| E1集計 | common ladderは **C4C 9 / 11のまま**。oracle-guided diagnostic集計は **C8 8 / C32 9 / C4C 10 of 11**。11 / 11 statementは出さない（`e1Aggregate.diagnostic.statement = null`） |

- **t00 `070a1222`（new Normal 128 ops）は回収できた**：552秒で完走し（safety cap 1024）、exact oracle RouteをC8 index 0（cost 128 = oracle operation cost）でdeliverした。
  必要だったpeak heapは約8.92 GBで、B2-C2B2Dの8,192 MB heap上限（約8.59 GB）を超えていた。
- **t02 `a367c177`（owned Gogma 1,084 ops）は60分でも完走しなかった**：heapは約7.83 GBで横ばいになり（12 GB上限には遠い）、時間で止まった。
  60分以内にexactをdeliverしたかは不明で、Route不存在・Search non-deliveryとは結論しない。

## 2. 方針と変更点（B2-C2B2Dとの差はexecution条件2因子のみ）

```text
B2-C2B2D RESULT（644962a9…、formal、B2C2B2D_INCOMPLETE）+ B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C RESULT
  -> phase2c26b2c2b2ePopulation(): B2-C2B2D Target行のうち recovery = none かつ process ∈ {timeout, out_of_memory}（unmeasured）
       previously unrecovered = 2、previously recovered = 2、他理由の未回収 = 0、記録なしtaskのrecord / Candidate数がnull をfail-close確認
  -> phase2c26b2c2b2eProbes(): B2-C2B2D自身の phase2c26b2c2b2dProbes() をauthority chainで再実行し、
       再導出derivationがB2-C2B2D RESULTの probes と完全一致、population各Targetのrank / tight extent / task IDが
       B2-C2B2DのTarget行・task行と一致することを確認
  -> probe manifest（Target ID / B2-C2B2D task ID / P1 rank / tight extentのみ）-> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2E_PROBES.json.local（SHA-256 a506881c…）
Search runner（Export + probe manifestのみ読む）
  -> start attestation（§4）-> tasks child: derivePhase2C26B2C1Schedule() -> buildPhase2C26B2C2B2ETasks()
       = B2-C2B2Dの buildPhase2C26B2C2B2DTasks() そのもの（task IDだけB2-C2B2Dのもの、t00-r17 / t02-r11）-> 2 task
  -> Search child（fresh process、heap 12,288 MB、60分）: runPhase2C26B2C2B2ETask = runPhase2C26B2C2B2DTask（同一の関数object）
analyzer（run終了後のみ）: oracle / 先行RESULTを読み、B2-C2B2Dの比較関数 + B2-C2B2D同一Target taskとのpaired比較
```

| 項目 | B2-C2B2D | B2-C2B2E |
| --- | --- | --- |
| population | E1 ∩ L2 4 Target | **B2-C2B2D未計測・未回収の2 Target**（既回収2件は再実行しない） |
| budget | 10分（600,000 ms） | **60分（3,600,000 ms）** |
| child heap | 8,192 MB | **12,288 MB** |
| context / tight extent / Planner-start origin / reservation universe / P1 / Search / comparator / materializer / C4C capture（max 4 cost cohort、5th-cost sentinel、safety cap 1024）/ fresh child / concurrency 1 / setImmediate / 250 ms sampling / oracle isolation / exact・context early stopなし / retry・fallbackなし | 同一 | 同一（Search input digestまで一致、§7） |

### 2.1 2 Targetのprobe（authorityから機械導出、sourceには値を書いていない）

| task | Route（B2-C2B1） | selected rank | required（N / G / S） | tight extent | B2-C2B2C同一context | B2-C2B2D |
| --- | --- | ---: | --- | --- | --- | --- |
| t00-r17 `070a1222` | new Normal、`normal_artian_to_gogma`、128 ops | 17 | 126 / 23 / 450 | `{126, 235, 450}` | out_of_memory | timeout（heap 6.40 GB、増加中） |
| t02-r11 `a367c177` | owned Gogma、mixed、1,084 ops | 11 | — / 59 / 1083 | `{4, 235, 1083}` | timeout | timeout（heap 5.00 GB、横ばい） |

型付け（次Phase分岐用）はB2-C2B2C同一context processから機械的に行う：out_of_memory → `heap_growth`（t00）、timeout → `time_bound`（t02）。

## 3. 実行条件

| 項目 | 値 |
| --- | --- |
| Targets / contexts per Target / tasks | 2 / 1 / 2 |
| capture | C4C（4 cost cohort完全drain + 5番目cost先頭sentinel、safety cap 1024）。C8 / C32はそのprefix |
| Stage 1 | fresh child / task、**heap 12,288 MB**、concurrency 1、**budget 60分**、`setImmediate` yield、memory sampling 250 ms、retry / fallbackなし。B2-C2B2Dの `conditions.stage1` とは `budgetMs` と `childHeapMb` だけが異なることをanalyzerで確認（`conditionChecks` 全項目true） |
| 環境 | Node v24.19.0（Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |

## 4. runner start attestation

| field | 値 |
| --- | --- |
| file / SHA-256 | `start-attestation.json` / `d11cd8b6d3e861bade6e987bdbf5fde70731f25cb088712d47007b313c340f30`（`wx` で作成後 read-only） |
| createdAt | 2026-10-05T09:52:52.665Z（tasks child START 09:52:52.693Z より前） |
| repositoryHead | `e69a94ea0fdd1ef39a39286dffab1bfc44fb1f0b`（起動時Working Tree clean） |
| uncommittedBenchmarkCode / smoke | `false` / `null` |
| benchmarkCodeSha256 | `0800363f2ed56b3ad325cede8296a1cdc1556796b016acb6a02a964bf2a7e66a`（analyzerがmeasured HEADのgit objectから再計算した値と一致） |
| exportSha256 / probeManifestSha256 / probeManifestB2C2B2DResultSha256 | `cc35fb5b…` / `a506881c…` / `644962a9…`（登録B2-C2B2D RESULT） |
| targetWeaponIds / probes | manifestの2 Target、B2-C2B2D task ID（t00-r17 / t02-r11）、selected rank（17 / 11）、tight extent |
| stage1 | `{ executionClass: stage1, childHeapMb: 12288, concurrency: 1, budgetMs: 3600000, retry: none, fallback: none }`、`b2c2b2dStage1`（8192 / 600000）と `changedStage1Fields = [budgetMs, childHeapMb]` も記録 |
| provenanceFlags | B2-C2B2Dと同一（oracle-guided flags true、Production evidence flags false） |
| 検証 | runner起動時に即verify、analyzerでも `launchProvenanceVerified = true`、issues 0、integrity issues 0 |

## 5. smokeと計測時の環境

- non-formal smoke 2回（`--allow-uncommitted`）：
  1. B2-C2B2Dで既回収の2 probe（t01-r18 / t03-r18、budget 2分）でrunner・child・analyzerの完走経路を確認。B2-C2B2Dと同じcapture（288件 / safety cap 1024件）、
     exact（t01 C8 index 2、t03 C32 index 10）を再現し、B2-C2B2D task行とのpaired identity（excluded current Routeまで）がverifiedになった
  2. 本番probe（budget 5秒）でtimeoutの扱い（Candidate 0にしない）、中断runの再構成（`--allow-nonformal` なしでfail-close、ありで再構成）、
     analyzerの `B2C2B2E_INCOMPLETE` / 分岐判定を確認
  smoke結果を見て条件は変えていない
- formal run開始前：最初の確認時に動画エンコード（AmatsukazeCLI / x265）でCPU 83〜91%、空きメモリ約15.9 GBだったため開始せず、
  エンコーダ終了・CPU 25%未満・空き16 GB以上が3分連続した時点まで待った。起動直前はWorking Tree clean、HEAD `e69a94e`、node process 0、
  CPU 2%、空き物理メモリ約17.0 GB（runner記録 `freeMemoryBytesAtLaunch` 17.5 GB）
- formal runはsessionから切り離したprocessで起動。2026-10-05T09:52:52Z〜11:02:10Z（約69.3分）。実行中は60秒ごとに空き物理メモリ（< 1.5 GBで警告）
  とrunner logを監視し、警告は0件（10:26Z時点で空き約10.1 GB、CPU 20%）。operational stopなし、停止条件の変更なし。完走したため再構成は使っていない

## 6. 実行結果

| task | process | termination | captured | C8 | C32 | C4C | exact index | cost | Search elapsed | child wall | peak heap | peak RSS | yields |
| --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| t00-r17 | completed | candidate_safety_cap | 1024 | ✓ | ✓ | ✓ | **0** | 128 | 546.7 s | 552.3 s | 8.92 GB | 10.93 GB | 3,093,698 |
| t02-r11 | **timeout** | — | — | — | — | — | — | — | — | 3,600.4 s | 7.83 GB | 8.32 GB | 25,774,814 |

（GBは10^9 bytes。timeout taskのyieldsは最後のIPC値。）timeout / OOMはCandidate 0ではない（`candidateCount = null`、`coverage = null`）。
t00のcaptured Candidate 1,024件はすべて `normal_artian_to_gogma`、cost 128 / 129 / 130（3 cohort、4 cohort目に届く前にsafety cap）、
reservation violation 0、partial 0。exactはindex 0（最初にdeliverされたCandidate）で、そのcost 128はoracle Routeのoperation countと一致。

### 6.1 heap / yield推移（memory.jsonl、running maximumの観察、decision inputではない）

| 経過 | t00 peak heap | t00 yields | t02 peak heap | t02 yields |
| --- | ---: | ---: | ---: | ---: |
| 60 s | 3.40 GB | 0.78 M | 5.74 GB | 0.50 M |
| 300 s | 7.92 GB | 2.21 M | 6.09 GB | 2.64 M |
| 600 s | （552 sで完走） | — | 7.32 GB | 5.26 M |
| 1,200 s | | | 7.40 GB | 10.28 M |
| 1,800 s | | | 7.47 GB | 14.40 M |
| 2,400 s | | | 7.83 GB | 18.58 M |
| 3,000 s | | | 7.83 GB | 22.40 M |
| 3,600 s | | | 7.83 GB | 25.76 M |

- **t00**：heapは完走直前まで増え続けた（peakの90 %到達333.6 s、99 %到達488.2 s、終盤の頭打ちなし）。peak 8.92 GBはB2-C2B2Dのheap上限
  8,192 MiB（約8.59 GB）を上回る。B2-C2B2Dでは600 sで2.69 M yields・heap 6.40 GBのままtimeoutしたが、今回は3.09 M yieldsで完走した
- **t02**：heapは約10分で7.3 GB、約37分で7.83 GBに達した後は最後の1/3で増加なし（`heapPlateauInLastThird = true`）。12 GB上限には余裕が
  あり、メモリではなく時間で止まった。yield速度は0〜10分 8,873 / s → 10〜30分 7,612 / s → 30〜60分 6,302 / s と徐々に低下した

## 7. B2-C2B2Dとのpaired comparison（同一Target・同一Search input）

**paired identityは2 / 2で一致**した。照合した項目：task ID、targetWeaponId、P1 rank、groupIndex、reservationDigest、
targetEligibleMinCardinality、representativeFixedSetId / Target IDs、default Search input digest、**tight Search input digest**、**tight extent**、
excluded current Route。Planner-start origin、CalculationContext、researchMaxPlanSteps、RNG Engine `production-rng:c5-e7` もB2-C2B2D RESULTと一致した。
意図的な差はbudgetとheapだけ（`b2c2b2d.budgetMs = 600000 / childHeapMb = 8192`、`b2c2b2e.budgetMs = 3600000 / childHeapMb = 12288`）。

excluded current RouteはPR #203の再導出（`phase2c26b2c2b2dRederiveBaselineContext()`）をそのまま再利用して証明した：analyzerがExportから再導出した
scheduleでB2-C2B2D task行のdefault contextを再構築し、そのdefault digest / body digestがB2-C2B2D task行と一致し、excluded keyがちょうど1件で
current Routeであることを確認したうえで、

| task | 再導出値 = B2-C2B2Dが記録した再導出値 | B2-C2B2D record | B2-C2B2E record | 判定 |
| --- | --- | --- | --- | --- |
| t00-r17 | `5b5f8cd7…` = `5b5f8cd7…` | なし（timeout） | record値 = 再導出値 | verified |
| t02-r11 | `4a875aac…` = `4a875aac…` | なし（timeout） | なし（timeout）→ 同一default digestで束縛 | verified |

| task | L2（B2-C2B2C） | tight 10分 / 8 GB（B2-C2B2D） | tight 60分 / 12 GB（B2-C2B2E） | wall（D → E） | peak heap（D → E） | peak RSS（D → E） | yields（D → E） | exact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| t00-r17 | OOM | timeout | **completed** | 600.6 s → 552.3 s | 6.40 → 8.92 GB | 8.07 → 10.93 GB | 2,693,463 → 3,093,698 | 未計測 → **C8 idx 0** |
| t02-r11 | timeout | timeout | **timeout** | 600.3 s → 3,600.4 s | 5.00 → 7.83 GB | 5.37 → 8.32 GB | 2,854,034 → 25,774,814 | 未計測 → 未計測 |

- t00：B2-C2B2Dの10分timeoutは、10分という時間ではなく8 GB heap上限付近での実行がボトルネックだったと見られる。今回は10分未満（552 s）で完走し、
  必要heapは8 GB上限を上回った（B2-C2B2Cの共通L2ではOOM）。heap上限付近でGC負荷が増えていた可能性を示唆するが、原因の切り分けはしていない（単一計測）
- t02：最初の10分で比べると、B2-C2B2Dは600 s時点で2.85 M yields、今回は5.26 M yieldsと速度に差がある（heap上限以外の条件は同一、各1回の計測で
  ばらつきは未評価）。60分では25.8 M yieldsまで進んだが4 cost cohortのdrainに届かなかった

## 8. 次Phase分岐

**branch = C**（`nextBranch.branch = "C"`、型割当はunambiguous）。事前に登録した分岐：

- A. 2 / 2 exact回収 → 既存SearchはRouteをdeliver可能。次はoracleなしでcontext / extent / budgetをどう選ぶか
- B. time_bound（t02）だけ回収 → t02は単純なtime budget問題、t00はmemory / search explosion側。次はt00専用profiling
- **C. heap_growth（t00）だけ回収 → t00はheap / budget増加で解決、t02は時間計算量問題。次はt02専用profiling** ← 今回
- D. 2件とも未回収 → これ以上budgetを増やす前にSearch runtime profiling

次Phase候補（本PRでは実行しない、レビュー後に決める）：**t02（owned Gogma 1,084 ops、Skill深さ1,083、heap約7.8 GBで横ばい、yield速度が時間とともに低下）の
Search runtime profiling**。どのstream / cohort / 処理で時間を使っているか、yield速度の低下要因を計測する。16 GB heap retryや60分超のbudgetは
自動的な次手にしない（t02はheap上限に達していない）。

## 9. E1集計（post-hoc、Research-level）

| 集計 | L1（7） | L2（4） | E1合計（C8 / C32 / C4C） | statement |
| --- | --- | --- | --- | --- |
| registered common ladder（B2-C2B2B common L1 + B2-C2B2C common L2） | C4C 7 / 7 | C4C 2 / 4 | 7 / 7 / **9** of 11 | なし（変更なし） |
| oracle-guided diagnostic（B2-C2B2D時点） | C4C 7 / 7 | C4C 2 / 4 | 7 / 8 / 9 of 11 | なし |
| **oracle-guided diagnostic（本Phase後）**：L1 = B2-C2B2B、L2 = B2-C2B2D回収2件 + 本Phase | C4C 7 / 7 | **C4C 3 / 4** | **8 / 9 / 10** of 11 | なし |

「E1 11件すべてについて、少なくともoracle-guided diagnostic条件で既存Searchがexact oracle Routeをdeliverできた」とは**まだ言えない**（10 / 11、t02が未計測）。
registered common ladderのevidenceは9 / 11のまま。Production schedulerで11 / 11、Production runtimeとして許容、とも主張しない。
t00の回収は「B2-C1 first compatible context × tight extent × 60分 / 12 GB」というoracle-guidedかつ拡大budgetの条件でのみ確認した。

## 10. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B2D RESULT（paired baseline、population source） | `644962a942622a0da25e02c83b87866319618e9ceddb24ca9c5dbee5a55130e3`（formal、`B2C2B2D_INCOMPLETE`、measured HEAD `3b35ee17…`） |
| B2-C2B2C RESULT | `b04ecace9ee6b5f36fe83e7680922d2d76c6cf4dfcdd677b408c856678313c9d` |
| B2-C2B2B RESULT | `2066506462159ae7d7045268e2d5c670de2ec157322265f970786c5ad29684c9` |
| B2-C2B1 RESULT | `418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae` |
| B2-C1 RESULT | `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac` |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d` |
| oracle RESULT / manifest | `be51e7cd…` / file `c8b240f6…` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| probe manifest | `a506881c34e23007a850c106cd7eb5d9b66c265fb4ff8bbe1073af05136ed0c2` |
| raw run | `PLANNER_GLOBAL_PHASE2C26B2C2B2E_RAW.json.local`、SHA-256 `1b0680050c0ec6721d94a021a51724eb045ab84cc8bbb545b34a56ef59d665b1`（.local、未commit） |

hashChain 39項目（B2-C2B2D registered、B2-C2B2D ↔ B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C / Exportを含む）すべてtrue。schedule parity
（2 taskが再導出と完全一致、B2-C2B2Dのrank / tight extent / default・tight Search input digest / task IDと一致、origins・CalculationContext・
researchMaxPlanSteps・RNG一致）すべてtrue。population parity（manifest = 再導出probe、population = B2-C2B2D未計測未回収Target、previously
unrecovered 2 / recovered 2 / other 0）true。execution conditions（60分 / 12,288 MB / concurrency 1 / retry・fallbackなし、他はB2-C2B2Dと同一、
child計算 = B2-C2B2Dの関数object）すべてtrue。

## 11. 未検証事項・limitation

- t02の結果（Candidate有無、exact有無）は不明。回収数（C4C 1 / 2、E1 10 / 11）は下限
- paired comparisonは同一Search inputの比較だが各1回の計測で、時間・メモリのばらつきは評価していない。t00がB2-C2B2Dで止まった理由（heap上限付近のGC負荷）は観察からの推測で、切り分けていない
- population・context・extentがoracle由来のdiagnosticで、budgetもB2-C2B2Dより拡大している。Productionでの再現手段・許容runtimeは示していない（§0）
- Node / Vite SSRでの計測で、Browser Workerの計測ではない。concurrency 1
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない
