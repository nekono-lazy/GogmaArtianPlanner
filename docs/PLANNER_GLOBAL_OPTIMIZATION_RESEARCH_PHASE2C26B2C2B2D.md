# Global Planner Research Phase 2-C2.6-B2-C2B2D（E1 ∩ L2 Targetのfirst-compatible context × target-relative tight extent diagnostic）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Production default
extent、Search algorithm / ordering / comparator、P1、captureは変更していない。60分retry、heap増加、B2-C2B2C timeout 108件・B2-C2B2B
timeout 33件の再実行、Search最適化、Production extent / rung selector、E2 9 Target、K2 grouping、residual 3 Target、global assignment、
full Planner、UIは行っていない。

- measurement HEAD: `3b35ee178174e2cb53958d38497a1a3f8fc26c20`（runnerがSearch開始前にstart attestationで記録。`measuredHeadSource = runner_start_attestation`）
- analysis HEAD: `d90124a6c8b501320974090c9ea8355fcfdb5761`（レビュー対応でpaired excluded Route identityの再導出をpost-hoc analysisに追加し、同じraw runを再解析した。
  measurement HEAD以降に変わったのはpost-hoc analysis・analyzer・testだけで、`calculationCodeChangedSinceMeasuredHead = []`、`measurementCodeChangedSinceMeasuredHead = []`。
  Searchは再実行しておらず、measurement値は再解析前のRESULTと同一）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2D_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2D_RESULT.json)（**`provenance.formal = true`**、
  `evidenceGrade = formal`、`partialRun = false`、`launchProvenanceVerified = true`、decision **`B2C2B2D_INCOMPLETE`**、invalid reason 0）

## 0. 最重要limitation（oracle-guided diagnostic）

> **このPhaseは明示的なoracle-guided diagnosticである。population・context・extentのすべてが過去のoracle post-hoc評価（B2-C1 / B2-C2B1）由来で、Production scheduler / Production extent selectionのevidenceにはならない。**

| provenance flag | 値 | 意味 |
| --- | --- | --- |
| `oracleGuidedTargetPopulation` | `true` | 4 TargetはB2-C2B1 cohort E1 ∩ `firstLadderRung = L2`（oracle required extentからのpost-hoc割当）で、B2-C2B2Cの4 Targetと同一 |
| `oracleGuidedContextSelection` | **`true`** | 各TargetのcontextはB2-C1が記録したP1 first compatible rank（post-hoc oracle compatibility） |
| `oracleInformedPerTargetExtent` / `targetIndividualOracleExtentAsSearchInput` / `perTargetExtent` | **`true` / `true` / `true`** | extentはTargetごとに `max(Production default, B2-C2B1 required)` |
| `commonExtentForEveryTask` | `false` | |
| `contextOrderingUsesOracle` | `true` | 上記context selectionのため |
| `oracleReadBySearchChild` / `oracleMatchUsedForEarlyStop` / `expectedOutcomeKnownBySearchChild` | `false` / `false` / `false` | Search childは何を見つければ成功かを知らない |
| `productionSchedulerEvidence` / `productionExtentSelectionEvidence` | `false` / `false` | |

本Phaseの結果から、Productionがfirst compatible contextを事前に選べる、required extentを事前に知れる、Target個別extentをProduction採用できる、
とは結論しない。確認したのは「既知のcompatible contextでSearch spaceをRoute requirement付近までtightにした場合、既存Searchが
B2-C2B2Cと同じ実行条件（10分 / 8 GB）でexact Routeをdeliverできるか」のみ。

## 1. 結論

| 軸 | 値 |
| --- | --- |
| Search semantic decision（diagnostic、scheduler decisionではない） | **`B2C2B2D_INCOMPLETE`**、`invalidReasons = []`（4 task中2 taskがtimeout） |
| evidence provenance grade | **`formal = true`**、`evidenceGrade = formal`、`partialRun = false` |
| measurement completeness | incomplete：measured 2 / 4（timeout 2、OOM 0、process failure 0、context mismatch 0、notRun 0） |
| route recovery（4 Target中） | **C8 1 / C32 2 / C4C 2**（未計測はCandidate 0扱いしない、下限） |
| interpretation（別軸） | **B**：B2-C2B2Cで未回収だった2 Targetは、tight extentでも**どちらも10分timeout**（`still_unmeasured`）。既回収2件は2件とも再回収（`previouslyRecoveredStillRecovered = true`） |
| E1集計 | common ladder（B2-C2B2B L1 + B2-C2B2C L2）は **C4C 9 / 11のまま**。oracle-guided diagnostic集計（L1はB2-C2B2B、L2は本Phase）も **C4C 9 / 11**。11 / 11 statementは出さない（`e1Aggregate.diagnostic.statement = null`） |

**未回収2 Targetはtight extentでも回収できなかった。** 「common L2を必要以上に広げたこと」は、少なくともこの2 Targetについては
resource explosionの主因ではない（§8）。

## 2. 方針と変更点（B2-C2B2Cとの差は2因子のみ）

```text
B2-C2B1 RESULT（418166d2…） + B2-C1 RESULT（04904faf…） + B2-C2B2B RESULT（2066506…） + B2-C2B2C RESULT（b04ecace…、paired baseline）
  -> phase2c26b2c2b2dPopulation(): B2-C2B2Cのpopulation関数をそのまま通し（E1 11 = L1 7 + L2 4、overlap 0、union 11）、
       E1 ∩ L2 = B2-C2B2C RESULTの4 Targetと完全一致をfail-close確認
  -> phase2c26b2c2b2dProbes(): 各Targetの
       selected rank = B2-C1記録のP1 first compatible rank（= B2-C2B1記録rank = B2-C2B2C analyzer再計算rank、1..32）
       tight extent  = per stream max(Production default, B2-C2B1 recorded required)、required = nullのstreamはdefault
       を導出し、phase2c26b2c2b1Covers(required, tight)（B2-A / B2-C2B1の required <= extent）、default <= tight <= 共通L2、
       L2よりstrictly小、default以外をfail-close確認
  -> probe manifest（Target ID / P1 rank / tight extentのみ）-> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2D_PROBES.json.local（SHA-256 ae107898…）
Search runner（Export + probe manifestのみ読む）
  -> start attestation（§4）-> tasks child: derivePhase2C26B2C1Schedule()（Production default）-> probeごとにそのrankの行 ->
     reconstructPhase2C26B2B2AContext() -> phase2c26b2c2b2dTightContext()（extentだけ置換、他fieldは同一確認、digest再計算）-> 4 task
  -> Search child（fresh process）: runPhase2C26B2C2B2DSearch() = B2-C2B2AのSearch本体とextent guard以外line-for-line同一（testで固定）
analyzer（run終了後のみ）: oracle / 先行RESULTを読み、B2-C2B2Aと同じ比較関数 + B2-C2B2C同一Target・同一rank taskとのpaired比較
```

| 項目 | B2-C2B2C | B2-C2B2D |
| --- | --- | --- |
| context selection | P1 rank 1..32（全部） | **B2-C1 first compatible rank 1件** |
| Search extent | 共通L2 `{128, 235, 1500}` | **Target別 `max(default, required)`** |
| population / Search / C4C capture / safety cap 1024 / fresh child / concurrency 1 / heap 8192 MB / 10分 / setImmediate / 250 ms sampling / retry・fallbackなし / schedule extent default | 同一 | 同一（budget・heapは増やしていない） |

### 2.1 4 Targetのprobe（authorityから機械導出、sourceには値を書いていない）

| task | Route（B2-C2B1） | selected rank | required（N / G / S） | tight extent | 共通L2との差（N / G / S） | ratio（N / S） |
| --- | --- | ---: | --- | --- | --- | --- |
| t00 `070a1222` | new Normal、`normal_artian_to_gogma`、128 ops | 17 | 126 / 23 / 450 | `{126, 235, 450}` | −2 / 0 / −1050 | 0.98 / 0.30 |
| t01 `188571a7` | owned Gogma、mixed、2 ops | 18 | — / 17 / 446 | `{4, 235, 446}` | −124 / 0 / −1054 | 0.03 / 0.30 |
| t02 `a367c177` | owned Gogma、mixed、1,084 ops | 11 | — / 59 / 1083 | `{4, 235, 1083}` | −124 / 0 / −417 | 0.03 / 0.72 |
| t03 `d453ca34` | owned Gogma、mixed、2 ops | 18 | — / 22 / 547 | `{4, 235, 547}` | −124 / 0 / −953 | 0.03 / 0.36 |

全Targetでtight ≥ Production default、tight ≤ 共通L2、少なくとも1 stream（Skill）でstrictly smaller、required coverage成立。
Gogmaはrequiredが全件235未満のためdefault 235のまま。

## 3. 実行条件

| 項目 | 値 |
| --- | --- |
| Targets / contexts per Target / tasks | 4 / 1 / 4 |
| capture | C4C（4 cost cohort完全drain + 5番目cost先頭sentinel、safety cap 1024）。C8 / C32はそのprefix |
| Stage 1 | fresh child / task、heap 8192 MB、concurrency 1、budget 10分、`setImmediate` yield、memory sampling 250 ms、retry / fallbackなし（B2-C2B2C RESULTの `conditions.stage1` と一致をanalyzerで確認） |
| 環境 | Node v24.19.0（Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |

## 4. runner start attestation

| field | 値 |
| --- | --- |
| file / SHA-256 | `start-attestation.json` / `008e1b615945d1c034dd6a67e8de589550b86c3e3def25aa876f55f565c8f0ff`（`wx` で作成後 read-only） |
| createdAt | 2026-10-05T03:03:52.764Z（tasks child START 03:03:52.793Z より前） |
| repositoryHead | `3b35ee178174e2cb53958d38497a1a3f8fc26c20`（起動時Working Tree clean） |
| uncommittedBenchmarkCode / smoke | `false` / `null` |
| benchmarkCodeSha256 | `63aa6acc71f111165c84d417d719c4910084becdb76162e5c70f627fd28160e6`（analyzerがmeasured HEADのgit objectから再計算した値と一致） |
| exportSha256 / probeManifestSha256 | `cc35fb5b…` / `ae107898…` |
| targetWeaponIds / probes | manifestの4 Target、selected rank（17 / 18 / 11 / 18）、tight extent |
| contextSelection / extentRule | `b2c1_recorded_p1_first_compatible_rank` / `b2c2b2d_tight_max_production_default_b2c2b1_required_v1` |
| stage1 / expectedTasks / capture / heap / timeout | 登録値（4 task、C4C、8192 MB、600,000 ms） |
| provenanceFlags | `oracleGuidedContextSelection = true`、`targetIndividualOracleExtentAsSearchInput = true`、`perTargetExtent = true`（偽装なし） |
| 検証 | runner起動時に即verify、analyzerでも `launchProvenanceVerified = true`、issues 0、integrity issues 0 |

## 5. smokeと計測時の環境

- non-formal smoke 2回（`--allow-uncommitted`）。1回目はt01-r18だけ（budget 2分）でrunner・analyzerの配線確認（8.4 sで完走）。2回目はt00 / t01を
  budget 5秒（schedule導出中にtimeoutする長さ、Search結果は得ない）で走らせ、再構成scriptが `--allow-nonformal` なしでfail-close、ありで
  再構成でき、analyzerが `partialRun = true` / `diagnostic_partial` / notRunをCandidate 0扱いしない / interpretation未判定とすることを確認した。
  smoke結果を見て条件は変えていない
- formal run開始前: Working Tree clean、CPU負荷は平均十数%（他の計測processなし）、空きメモリ約16 GB
- formal runはsessionから切り離したprocessで起動。2026-10-05T03:03:52Z〜03:24:31Z（約20.7分）。完走したため再構成は使っていない

## 6. 実行結果

| task | process | termination | captured | C8 | C32 | C4C | exact index | cost | Search elapsed | child wall | peak heap | peak RSS | yields |
| --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| t00-r17 | **timeout** | — | — | — | — | — | — | — | — | 600.6 s | 6.40 GB | 8.07 GB | 2,693,463 |
| t01-r18 | completed | four_cost_cohorts_drained | 288 | ✓ | ✓ | ✓ | 2 | 2 | 6.6 s | 16.3 s | 0.91 GB | 1.12 GB | 322,721 |
| t02-r11 | **timeout** | — | — | — | — | — | — | — | — | 600.3 s | 5.00 GB | 5.37 GB | 2,854,034 |
| t03-r18 | completed | candidate_safety_cap | 1024 | — | ✓ | ✓ | 10 | 2 | 6.5 s | 16.4 s | 0.82 GB | 1.03 GB | 563,773 |

（GBは10^9 bytes。timeout taskのyieldsは最後のIPC値。）timeout / OOMはCandidate 0ではない（`candidateCount = null`、`coverage = null`）。
captured Candidate 1,312件すべて `existing_gogma_mixed`、reservation violation 0、incompatible context 0（選んだcontextは2件ともanalyzerの再計算でcompatible）。

timeout 2件のheap推移（memory.jsonl、参考）:

- t00-r17：heapは36 sで2.7 GB → 129 sで5.0 GB → 600 s直前で6.4 GBまで単調増加し、yield増加速度は時間とともに低下（GC負荷の増大を示唆）。B2-C2B2C（L2）では476 sで8.32 GBに達してOOMだった
- t02-r11：heapは約157 sで4.9 GBに達した後は5.0 GBで横ばい、yieldは約4,800 / sでほぼ一定に増え続けた。メモリ上限ではなく時間で止まっている

## 7. B2-C2B2Cとのpaired comparison（同一Target・同一P1 rank）

**paired context identityは4 / 4で一致**した（targetWeaponId、P1 rank、groupIndex、reservationDigest、targetEligibleMinCardinality、
representativeFixedSetId / Target IDs、defaultSearchInputDigest、excluded current Route key）。B2-C2B2C側がtimeout / OOMだった2 task
（t00・t02）のexcluded current Routeは、同じdefault contextからpost-hoc再導出して照合した。Planner-start origin（Skill 341 / Gogma 55）、
CalculationContext、researchMaxPlanSteps、RNG Engine `production-rng:c5-e7` もB2-C2B2C RESULTと一致。差はextentと、それに伴うSearch input digestだけ。

excluded current Routeの証明方法（RESULT `parity.pairedIdentity[].excludedRouteKeyComparison`、`parity.baselineRederivations`）:

1. analyzerがExportから再導出したscheduleで、baseline taskのTarget・P1 rankに該当するschedule行がちょうど1件であることを確認する。
   その行のgroup / reservation digest / representative / cardinalityはbaseline taskと一致する
2. 既存の `reconstructPhase2C26B2B2AContext()` でdefault contextを再構築する（excluded Route keysはSearch開始前にsnapshotのTargetから決まる）
3. 再構築したcontextのSearch input digestと、そのbody（excluded Route keysを含む）から再計算したB1 digestが、どちらもbaseline taskの
   committed `defaultSearchInputDigest` と一致することを確認する
4. excluded Route keyがちょうど1件で、Targetのcurrent Route keyであることを確認し、そのSHA-256を再導出値とする
5. 再導出値を、存在するrecordと照合する

| task | baseline側（B2-C2B2C） | B2-C2B2D側 | 判定 |
| --- | --- | --- | --- |
| t00-r17 | OOMでrecordなし → 再導出値をbaseline identityとして使用 | timeoutでrecordなし → 同一default digest（Search childがSearch前に同じ再構築と照合済み） | verified |
| t01-r18 | record値 = 再導出値 | Search record値 = 再導出値 | verified |
| t02-r11 | timeoutでrecordなし → 再導出値 | timeoutでrecordなし → 同一default digest | verified |
| t03-r18 | record値 = 再導出値 | Search record値 = 再導出値 | verified |

再導出不能、行数不一致、identity drift、key 1件以外、record値との不一致は、すべてinvalid reasonになる登録である（今回は0件）。
`identity.matches` は、excluded current Routeまで証明できた場合のみtrueになる。注記: default digestはfnv1a32（非暗号）で、
record無しの側の一致は、決定的な再構築とdigest一致に基づく。

| task | outcome（L2 → tight） | wall（L2 → tight、差） | peak heap（L2 → tight、差） | peak RSS（L2 → tight） | yields（L2 → tight） | delivered | exact（L2 → tight） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t00-r17 | **OOM → timeout** | 476.2 s → 600.6 s（+124.4 s ※1） | 8.32 → 6.40 GB（−1.92 GB） | 8.98 → 8.07 GB | 5,815,448 → 2,693,463 | — / — | 未計測 → 未計測 |
| t01-r18 | completed → completed | 40.1 s → 16.3 s（−23.8 s） | 3.72 → 0.91 GB（−2.80 GB） | 4.01 → 1.12 GB | 4,291,579 → 322,721 | 481 → 289 | C8 idx 2 → **C8 idx 2** |
| t02-r11 | **timeout → timeout** | 600.3 s → 600.3 s | 4.99 → 5.00 GB（+0.002 GB） | 5.36 → 5.37 GB | 2,674,298 → 2,854,034 | — / — | 未計測 → 未計測 |
| t03-r18 | completed → completed | 38.1 s → 16.4 s（−21.7 s） | 2.65 → 0.82 GB（−1.82 GB） | 2.92 → 1.03 GB | 4,253,585 → 563,773 | 1024 → 1024（両方safety cap） | C4C idx 50 → **C32 idx 10** |

※1 B2-C2B2C側はOOMで476 sに終了したwallで、Searchが完走するのに要した時間の下限。tight側は10分まで走ってtimeout。
Search elapsed（completedのみ）: t01 34.4 s → 6.6 s、t03 28.5 s → 6.5 s。

- 既回収の2件（Skill required 446 / 547、Normal不要）は、tight extentでwall約2.4倍速、peak heap約1/3〜1/4、yields約1/8〜1/13になり、
  exactも同じ（t01）か前方へ移動（t03：L2のindex 50 → index 10、C4C → C32）した。この2件ではcommon L2のoversizingがresourceに大きく効いていた
- t00は Normal 128 → 126（ほぼ不変）・Skill 1500 → 450 でOOMは回避した（peak heap −1.9 GB）が、10分以内に4 cost cohortをdrainできなかった
- t02は Normal 128 → 4・Skill 1500 → 1083 でもheap・yield速度・結果がL2とほぼ同一。この2件のresource profileはRoute自体が要するSkill深さ
  （t02：1,083）/ Normal深さ（t00：126）でほぼ決まっていると見られる（観察であり、原因の切り分けはしていない）

## 8. 未回収2 Targetとinterpretation

| Target | B2-C2B2C（L2、同一rank） | B2-C2B2D（tight） | 判定 |
| --- | --- | --- | --- |
| t00 `070a1222`（new Normal 128 ops、required 126 / 23 / 450） | OOM | timeout（heap 6.40 GB、メモリ増加中） | `still_unmeasured` |
| t02 `a367c177`（owned Gogma 1,084 ops、required — / 59 / 1083） | timeout | timeout（heap 5.00 GB横ばい、時間律速） | `still_unmeasured` |

**interpretation = B**（`interpretation.case = "B"`）。事前に登録した分岐:

- A. 未回収2 Targetもtight extentでexact回収 → common L2 oversizingが大きなresource要因。次はoracleなしでtight extent / finer ladderを予測する研究へ
- **B. tight extentでもtimeout / OOM → Route自体の深さ / Search algorithm側のresource problemが強い。次は60分budget / 12 GB〜16 GB heapのtargeted retry、またはSearch runtime profilingへ** ← 今回
- C. completedしたがexact non-delivery → extentではなくCandidate ordering / capture / context semanticsを調査

（Aは未回収Targetの全件回収が条件。1件回収・1件未計測はB。未実行（notRun）が残る場合は未判定とする登録。）

未回収2件は今回も **未計測** で、exact Routeの有無は分からない。Route不存在・Search non-deliveryとは結論しない。

## 9. E1集計（post-hoc、Research-level）

| 集計 | L1（7） | L2（4） | E1合計（C8 / C32 / C4C） | statement |
| --- | --- | --- | --- | --- |
| registered common ladder（B2-C2B2B common L1 + B2-C2B2C common L2） | C4C 7 / 7 | C4C 2 / 4 | 7 / 7 / **9** of 11 | なし（変更なし） |
| oracle-guided diagnostic（B2-C2B2B common L1 + 本Phase tight） | C4C 7 / 7 | C4C 2 / 4 | 7 / 8 / **9** of 11 | なし |

本Phaseの成功条件だった「E1 11件すべてについて、既存Searchがexact oracle Routeをdeliverできることを少なくともoracle-guided diagnostic条件で確認」
には届かない（9 / 11）。registered common ladderのevidenceも9 / 11のまま。Production schedulerが見つけられるという主張もしない。

## 10. 次Phaseへのdecision point

interpretation Bに対応する候補（本PRでは実行しない、レビュー後に決める）:

- 未回収2 Target（t00 rank 17、t02 rank 11）の同一context × tight extentでの **targeted retry**（60分budget、12〜16 GB heap）。retry条件は別途登録
- **Search runtime profiling**：t02型（heap横ばい・時間律速、Skill深さ1,083）とt00型（heap単調増加、new Normal 126 forge × Skill 450）で、
  どのstream / cohortで時間・メモリを使っているかの計測
- 既回収2件で観察した「tight extentでresourceが大きく減り、exactが前方に来る」ことを、oracleなしで予測できるかは、未回収2件の扱いが決まった後に検討

## 11. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B1 RESULT | `418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae` |
| B2-C1 RESULT | `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac` |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d` |
| B2-C2B2B RESULT（L1 half） | `2066506462159ae7d7045268e2d5c670de2ec157322265f970786c5ad29684c9` |
| B2-C2B2C RESULT（paired baseline） | `b04ecace9ee6b5f36fe83e7680922d2d76c6cf4dfcdd677b408c856678313c9d`（formal、`B2C2B2C_INCOMPLETE`、measured HEAD `eb42e750…`） |
| oracle RESULT / manifest | `be51e7cd…` / file `c8b240f6…` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| probe manifest | `ae1078984ac699064c45a5bc28aa8478cc7adfb19952e64fa367d93331b97261` |
| raw run | `PLANNER_GLOBAL_PHASE2C26B2C2B2D_RAW.json.local`、SHA-256 `b84bfcc065045a66719ddcb63cf6f30eee1d0ccc501587a3344bf5c8ba9bec3b`（.local、未commit） |

hashChain 30項目（B2-C2B2C registered、B2-C2B2C ↔ B2-C2B1 / B2-C1 / B2-C2B2B / Exportを含む）すべてtrue。schedule parity
（4 taskが再導出と完全一致、contexts / origin digest、schedule extent = default、originsがB2-C2B2Cと一致、各taskがそのTargetのtight extent・
bounds内・共通L2でない・first compatible rank、CalculationContext / researchMaxPlanSteps / RNG一致）すべてtrue。population parity
（manifest = 再導出probe、E1 11 = L1 7 + L2 4、overlap 0、union 11、E1 ∩ L1 = B2-C2B2B Target、population = B2-C2B2C Target）true。

## 12. 未検証事項・limitation

- timeout 2 taskの結果（Candidate有無、exact有無）は不明。回収数（C4C 2 / 4、E1 9 / 11）は下限
- paired comparisonはcontext identityが同一の比較だが、単一計測（各1回）で、時間・メモリのばらつきは評価していない
- population・context・extentがoracle由来のdiagnosticで、Productionでの再現手段は示していない（§0）
- Node / Vite SSRでの計測で、Browser Workerの計測ではない。concurrency 1
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない
