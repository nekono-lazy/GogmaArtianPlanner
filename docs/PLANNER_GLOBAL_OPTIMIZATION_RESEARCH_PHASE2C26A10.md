# Global Planner Research Phase 2-C2.6-A10（A6 / A9後current Productionの54 orientation正式再評価）

Refs #154。Research only。Production source、Search / Planner semantics、frontier / ordering / retention、extent / bounds、RNG、
schema / version、Persistence、UIは変更していない。CPU profiler・no-inlining diagnostic・section / depth observerは付けていない。
portfolio Search、global assignment、1,657-step oracle coverage、capture bound変更、extent拡張、60分budgetは実行していない。

- measured HEAD: `886e3f74ab6971107e2d421acbe3d39056f59d1b`（Research code・analyzer・事前登録decision ruleを含むclean HEAD）
- analysis HEAD: 同じ `886e3f7`（測定後のcode変更なし、`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json`](PLANNER_GLOBAL_PHASE2C26A10_RESULT.json)（`provenance.formal = true`）

## 1. 結論（Case R1 `R1_improved_timeouts_remain`）

Phase 2-C2.6-Aと同じ元Export・同じ54 orientation・同じNode条件（fresh child、heap 8 GB、**concurrency 3**、30分budget、
`setImmediate` yield、retryなし）で、current Productionのkernelを全件1回ずつformalに再実行した。

| child status | C2.6-A | **A10** |
| --- | ---: | ---: |
| completed | 45 | **48** |
| timeout | 9 | **6** |
| out_of_memory | 0 | 0 |
| process_failure | 0 | 0 |

- **旧completed 45件**: 45 / 45がcompletedを維持（→ timeout / OOM / failure 0）。Target outcome・trial結果 / 理由 / `generatedSelected`・
  trialしたCandidate key SHA-256・found key SHA-256・`plannerRerunsUsed`（core）が **45 / 45完全一致**、さらにTarget毎のSearch summary・
  foundのtrial Plan summary / Route summary・`skippedExcludedRouteKeys`（extended）も **45 / 45完全一致**。semantic regression 0件。
- **旧timeout 9件**: **timeout → completed 3**（c6-p1、c13-p6、c20-p1）、**timeout → timeout 6**（c13-p0 / p1 / p2 / p3 / p9、c14-p0）、
  → OOM / failure 0。
- participant: 34中 **33** がSearchまで到達（C2.6-A 32）。新たに到達したのは15829bfe（c6-p1の完走による）。未到達は **fea60316の1件**
  （それが非fixed側になる唯一のorientation c14-p0がtimeoutのまま）。
- 事前登録ruleの判定は **R1**: OOM 0・failure 0・旧completedのstatus / semantic regression 0、timeout 6（1〜8の範囲）。

**formalに言えること**: 今回の元Export・54 orientation・Node 8 GB・concurrency 3条件で、C2.6-A測定時のProductionからcurrent Production
（A6・A9等を含むProduction全体）への変更により、kernel availabilityはcompleted 45 → 48、timeout 9 → 6へ改善した。旧completed 45件は
全件同じkernel判定を返し、多くは速くなった（§7）。

**まだ言えないこと**: 全orientationが測定可能になったこと（6件はtimeout）。全34 participantが測定可能になったこと（1件未到達）。
改善をA9単独の効果とすること（§3）。timeout 6件にCandidateが無いこと。foundがfixed Route setとのkernel trialで選ばれた以上の意味を
持つこと。portfolio / global assignment / oracle coverage / C3 readiness。

**次Phase推奨（R1）**: 残timeout 6件（c13のSkill 10 participant Conflict 5件と、Gogmaのc14-p0）の内容とparticipant coverage 33 / 34を
踏まえ、portfolio側へ進むか追加runtime対策をするかを判断する（§10）。

## 2. authority

| authority | 内容 | 検証 |
| --- | --- | --- |
| C2.6-A RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json`、SHA-256 `dab2f27a…78c67b171`、measured HEAD `525ed892` | 既存 `parsePhase2C26AAuthority()`（formal、formal series valid、旧C2 comparability valid、54 / 45 / 9 / 0 / 0、case `timeout_without_out_of_memory`、rowがorientationを丁度1回ずつcover）に加え、`parsePhase2C26A10Before()` が全completed rowのkernel判定（Target・trial・found・search）を読めることを確認。期待値はRESULTから導出し、sourceにorientation ID・件数をhard-codeしていない（テストで確認） |
| A9 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json`、SHA-256 `069a5332…14f27502a`、measured HEAD `a89b388f` | `parsePhase2C26A9ResultAuthority()`: `formal = true`、`calculationCodeChangedSinceMeasuredHead = []`、formal series valid、`summary.decision.case` / `conclusion.decision.case` = `O_optimization_adopted`、A9が記録したC2.6-A・A2〜A8 RESULTのSHA-256（provenance・runner記録・sources）が読んだfileと全一致、Export SHAがC2.6-Aと一致 |

A9はauthority chainの確認だけに使い、orientationを選ばない（A10は全orientationを実行）。PRはsquash mergeのため、C2.6-A / A9の
measured HEADはPR branch上のcommitでありA10 measured HEADの祖先ではない。両commitがrepositoryに存在することを確認し、祖先性は記録のみ
（`provenance.ancestry`）。

## 3. 「A9単独の効果」とは言わない

C2.6-A measured HEAD `525ed892` からA10 measured HEADまでのProduction変更は次の6 fileで、計算に関わるA6（Bonus multiset比較の
allocation-free化）・A9（held-aware representative比較のstable serialization cache）と、A2〜A4で入ったexecution-only instrumentation
seamを含む（`provenance.currentProductionScope`。main上のfirst-parent履歴で確認）:

| file | 変更したPhase |
| --- | --- |
| `src/domain/models/domainRules.ts` | A6 |
| `src/domain/planner/alternative/plannerAlternativeKernel.ts` | A2（instrumentation seam） |
| `src/domain/search/alternative/plannerAlternativeSearch.ts` | A3、A4（instrumentation seam） |
| `src/domain/search/bonusStream.ts` | A3（instrumentation seam）、A9 |
| `src/domain/search/searchRuntime.ts` | A4（instrumentation seam） |
| `src/domain/search/targetSearchScheduler.ts` | A4（instrumentation seam） |

したがって本Phaseのbefore / afterは **「C2.6-A measured Production → current Production全体」** であり、「A9によって3件改善した」とは
言わない。A9単独の効果はA9 RESULTの局所比較（concurrency 1、primary 3件）がauthorityである。A10ではinstrumentation seamに
observerを渡していない（Production callerと同じ未指定）。

## 4. 条件

| 項目 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`、19,424,064 bytes（commitしない） |
| child | 1 task = fresh Node child（Vite SSR loader）、Node flagsは `--max-old-space-size=8192` のみ、concurrency 3、budget 30分（baselineも同じ）、retryなし |
| 付けないもの | CPU profiler、no-inlining diagnostic、Search section observer、reserved depth observer、kernel lifecycle observer、heartbeat、counting RNG engine（`PHASE2C26A10_NOT_ATTACHED`） |
| memory | `process.memoryUsage()` を250 ms間隔でsample（sampled max、true peakではない）。失敗childは死亡直前の最後のIPC sample |
| extent / bounds | `{ N 4, G 235, S 4 }` / `{ trials 2, reruns 8 }`（Production定数のspread copy、C2.6-Aと一致） |
| Research `maxPlanSteps` | 20,000 |
| lineage | `priorFixedBuildListEntryIds = []`、`priorExcludedRoutes = []`（`phase2c2KernelRequest()` のtest済みinvariant。C2.6-A RESULTも同値を記録） |
| CalculationContext | gameVersion `unknown-initial`、masterDataVersion 4、`production-rng:c5-e7`、appSchemaVersion 17（C2.6-Aと一致） |
| 環境 | Node v24.19.0、Windows 11（10.0.26200）x64、AMD Ryzen 7 9700X（16 logical）、RAM 32 GB |
| 実行時間 | 2026-10-01 03:27Z開始、全体約2時間29分（8,930,745 ms） |
| benchmarkCodeSha256 | `60287123a92b0c4deca1cfc3e52297733d6fb789a68cfdc37713ef86a9954d45`、uncommitted false |

childの計算はC2.6-Aの `runPhase2C26AKernel()` / `runPhase2C26ABaseline()` をそのまま呼ぶ。child構造（250 ms memory IPC、20 sample毎の
memory trace）もC2.6-A runnerと同じ。C2.6-Aと同様、childのstderrには無害な `WebSocket server error: Port 24678 is already in use` が出る
（timeout 6件のstderrはこの1行のみ）。

formal前にnon-formal smoke（`--allow-uncommitted --smoke-orientations c9-p1,c11-p0,c2-p0`、条件変更なし）で配線を確認した。smokeは
3 / 3 completed、core / extended semantic 3 / 3一致。analyzerはsmokeを `environment.smoke` 非null・orientation欠落でformal invalidとし、
decisionを生成しないことを確認した（smoke rawはcommitしない）。

## 5. baseline / orientation parity（kernel開始前にfail-closed）

runnerはbaseline child完了後、kernelを1件も起動する前に次を確認した（いずれかinvalidならkernelを起動せず `parity_failed` を書いて終了する）。
analyzerは同じ検証をraw runからpost-hocに再計算する。

| 項目 | A10 | C2.6-A | 一致 |
| --- | --- | --- | --- |
| planning Target / completed | 43 / 20 | 43 / 20 | ✓ |
| termination | exhausted | exhausted | ✓ |
| Plan steps | 1,465 | 1,465 | ✓ |
| Conflict / kind別 | 21（Gogma 15 / Skill 3 / owned weapon 2 / Normal 1） | 同 | ✓ |
| Target単位Conflict signature | 21 | 21 | ✓（完全一致） |
| selected Target | 20 | 20 | ✓（完全一致） |
| orientation数 / 順序付きID列 | 54 / 同一順 | 54 | ✓ |
| orientation identity（Conflict index、kind、fixed Target、participant Target set）不一致 | 0 | — | ✓ |
| orientation metadata（Conflict key、fixed Entry、participant Entry列、participant Target列）不一致 | 0 / 0 / 0 / 0 | — | ✓ |
| run条件（Export SHA、heap、concurrency 3、budget、yield、extent、bounds、maxPlanSteps、CalculationContext、lineage） | 全一致 | — | ✓ |
| task set（authorityの全orientationを同順で丁度1回ずつ、subset / 重複 / foreign / metadata差なし） | 54 | 54 | ✓ |

formal series validation: valid（baseline 1 + kernel 54 child、missing / duplicate / foreign / metadata mismatch / unknown status 0、
runnerが読んだC2.6-A / A9 / A2〜A8 RESULT SHA-256がanalyzerの読んだfileと一致、Node flags heap-only、何も付けていない）。

## 6. kernel child outcome

| Conflict kind | orientation | completed（C2.6-A → A10） | timeout（C2.6-A → A10） | OOM | failure |
| --- | ---: | ---: | ---: | ---: | ---: |
| same_gogma_counter | 33 | 31 → **32** | 2 → **1** | 0 | 0 |
| same_skill_counter | 15 | 8 → **10** | 7 → **5** | 0 | 0 |
| same_owned_weapon_consumed | 4 | 4 → 4 | 0 → 0 | 0 | 0 |
| same_normal_counter | 2 | 2 → 2 | 0 → 0 | 0 | 0 |
| **計** | **54** | **45 → 48** | **9 → 6** | **0** | **0** |

preparation failureは0件。

### 6.1 遷移

| C2.6-A → A10 | completed | timeout | OOM | failure |
| --- | ---: | ---: | ---: | ---: |
| C2.6-A completed（45） | **45** | 0 | 0 | 0 |
| C2.6-A timeout（9） | **3** | **6** | 0 | 0 |

### 6.2 旧completed 45件のregression確認

- status: 45 / 45 completed維持。regression 0件。
- semantic（core、C2.6-Aと同じ比較項目）: **45 / 45 identical**。
- semantic（extended、本Phaseで追加）: **45 / 45 identical**、kernel status mismatch 0件。
- trial rejection（C2.6-A completed分を含む全体）: `explicit_decision_not_selected` 18 → 18、`preflight_refused` 4 → 4。

### 6.3 旧timeout 9件

wallはchild wall（親から見たspawn〜exit）。memoryはsampled max（timeoutは死亡直前のIPC sample）。

| orientation | kind | fixed Target | C2.6-A | A10 | A10 wall | A10 sampled heap / RSS | A10 Target outcome | A9参考（concurrency 1・profiler付き） |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| c6-p1 | Gogma（2 participant） | 46bf2c78 | timeout | **completed** | 1,657 s | 4.20 / 4.54 GiB | 15829bfe: `stopped_by_search_extent_bound`（delivered 0、trial 0） | completed（1,244 s） |
| c13-p0 | Skill（10） | 2378d3e0 | timeout | timeout | 1,800 s | 3.57 / 4.11 GiB | 観測不能 | — |
| c13-p1 | Skill（10） | 6c65c924 | timeout | timeout | 1,800 s | 4.74 / 5.07 GiB | 観測不能 | timeout（1,800 s） |
| c13-p2 | Skill（10） | 45b13c06 | timeout | timeout | 1,800 s | 4.60 / 5.56 GiB | 観測不能 | — |
| c13-p3 | Skill（10） | 02876df4 | timeout | timeout | 1,800 s | 4.35 / 5.09 GiB | 観測不能 | — |
| c13-p6 | Skill（10） | a830a376 | timeout | **completed** | 1,499 s | 4.62 / 5.26 GiB | found 3（45b13c06、57126a5e、820831d0）、`stopped_by_search_extent_bound` 6 | — |
| c13-p9 | Skill（10） | 8d233d8b | timeout | timeout | 1,800 s | 3.71 / 4.21 GiB | 観測不能 | — |
| c14-p0 | Gogma（2） | b4f252cd | timeout | timeout | 1,800 s | 4.52 / 4.91 GiB | 観測不能 | completed（1,800 s、budget直前） |
| c20-p1 | Skill（3） | 86439c85 | timeout | **completed** | 1,581 s | 3.74 / 4.42 GiB | 188571a7・9d817a9b: `stopped_by_search_extent_bound`（delivered 0） | — |

- **c13-p6**: 非fixed 9 Targetを全てSearchし、found 3件（各1 trial、`generatedSelected = true`、うち820831d0はheld Route）、残り6件は
  extent boundで停止。`plannerRerunsUsed = 3`（bound 8未到達）。found trialのPlanは completed 22 / 43、Conflict 21〜22、Plan 1,460 steps。
- **c6-p1 / c20-p1**: 非fixed TargetのSearchはextent boundで停止（Candidate 0、trial 0）。kernelは完走したがfoundは無い。
- **A9局所測定との関係**: A9（concurrency 1、CPU profilerをSearch開始+120〜720秒に付与、A7 section observer付き）では c6-p1 completed、
  c13-p1 timeout、c14-p0 completed（1,799.6 s、budget直前）だった。A10（concurrency 3、何も付けない）では c6-p1 completed、
  c13-p1 timeout、**c14-p0 timeout**。c14-p0はA9でもbudgetとの差が0.4秒しかなく、concurrency 3では30分内に完走しなかった。
  条件が異なるため、A9 / A10のwall timeは直接比較しない。
- timeout 6件のyieldは数百万〜約1,000万回続いており（例: c14-p0 9,998,150、c13-p1 9,855,954）、hangではなく計算継続中にbudgetで
  打ち切られた。A10はobserverを付けていないため、どのTargetで時間を使ったかは観測していない。timeoutを「Candidateなし」とは扱わない。

## 7. completed kernelの集計

完走48 kernelのTarget結果100件（Search実行100、未実行0）:

| outcome | C2.6-A（45 kernel、88件） | **A10（48 kernel、100件）** |
| --- | ---: | ---: |
| found | 25 | **28** |
| stopped_by_candidate_trial_bound | 8 | 8 |
| stopped_by_search_extent_bound | 55 | **64** |
| not_found_within_search_extent | 0 | 0 |
| stopped_by_planner_rerun_bound | 0 | 0 |
| blocked_by_selected_checkpoint | 0 | 0 |
| その他のstatus | 0 | 0 |

- 増加分（found +3、extent +9）は全て新たに完走した3 orientation（c6-p1 / c13-p6 / c20-p1）由来。旧completed 45件分は一致（§6.2）。
- found: 28件、**distinct Target 16**（C2.6-Aと同じ16。c13-p6のfound 3 Targetは他orientationでも既にfound）。held Route 10件
  （C2.6-A 9件）。`generatedSelected` true 25 / false 3。
- trial: 50件（found 28 / rejected 22）。rejection理由 `explicit_decision_not_selected` 18、`preflight_refused` 4（C2.6-Aと同じ）。
  Target当たりtrial数分布 {0: 60, 1: 30, 2: 10}。
- `plannerRerunsUsed` 分布 {0: 20, 1: 17, 2: 8, 3: 1, 5: 2}、最大5（bound 8未到達）。

**foundの意味**: そのorientationのfixed Route setとのkernel trialで選択された、という意味だけである。全43 Target完成、全Conflict解消、
global assignment成立、1,657-step oracle到達のいずれも意味しない（c13-p6のfound trial Planも completed 22 / 43のまま）。

## 8. runtime・memory

| 項目 | C2.6-A | A10 |
| --- | --- | --- |
| kernel wall（全54、timeout含む）median | 283 s | **161 s** |
| kernel wall（completed）max / median | 1,438 s（c6-p0） / 159 s | 1,657 s（c6-p1） / 126 s |
| 両run completedの45件のwall比（A10 / C2.6-A） | — | median **0.84**、min 0.45、max 1.21 |
| kind別completed wall median / max | — | Gogma 118 / 1,657 s、Skill 476 / 1,581 s、owned weapon 242 / 328 s、Normal 4.8 / 4.8 s |
| max sampled heapUsed | 4.92 GB | 5.09 GB（c13-p1、timeout） |
| max sampled RSS | 5.97 GB | 5.97 GB（c13-p2、timeout） |
| completed childの `resourceUsage().maxRSS` 最大 | 5,783,316 KiB | 5,799,308 KiB |
| baseline | 5.8 s / sampled heap 0.48 GB | 5.4 s / sampled heap 0.49 GB |

- 長いorientationほど短縮が大きい（c6-p0 1,438 → 697 s、c18-p0 1,149 → 621 s、c12-p0 961 → 633 s、c1-p0 959 → 548 s）。
- wall比が1を超えた10件は、5〜20秒の短いkernel（c9 / c11 / c15 / c17-p1）と、c13の完走4件（c13-p4 / p5 / p7 / p8、+5〜14%）。
  concurrency 3の同時実行による相互干渉を含む1 seriesの値であり、run間ばらつきは測っていない。
- sampled maxはtrue peakではない。timeout childは死亡直前のIPC sampleのみ。

## 9. Conflict participant

| 項目 | C2.6-A | A10 |
| --- | ---: | ---: |
| participant総数 | 34 | 34 |
| Searchまで到達 | 32 | **33** |
| 未到達 | 2（15829bfe、fea60316） | **1（fea60316）** |

- 15829bfe: c6-p1の完走で到達（Candidate 0、extent bound）。
- fea60316: 非fixed側になる唯一のorientation c14-p0がtimeoutのまま。
- **全34 participantが測定可能になったとはまだ言えない**。また「全participantが測定可能」と「Global Planが完成可能」は別である。

## 10. 次Phase推奨（R1）

1. 残timeout 6件は、c13（10 participant Skill Conflict）のfixed側 2378d3e0 / 6c65c924 / 45b13c06 / 02876df4 / 8d233d8b の5件と、
   Gogma 2 participantのc14-p0（未到達participant fea60316を含む）。c13は同じConflictのp4〜p8が91〜1,499秒で完走しており、fixed側に
   よって所要時間が大きく異なる。
2. 判断材料: 測定可能範囲は 48 / 54 orientation・33 / 34 participant。portfolio / global route quality側へ進む場合は、c14-p0
   （fea60316）とc13残5件を測定外として明示する必要がある。runtime対策を先にする場合は、A9後のhotspot（`state_generation`、
   `reduction_loop_or_inlined` 等）をtimeout orientationで再局所化する。
3. budget延長・concurrency変更による同Phaseのformal再測定はしない。

## 11. limitations

- Node child（Vite SSR loader）のみ。Browser Worker、他device、他heap / concurrency条件は測っていない。
- 1 formal seriesのみで、wall timeのrun間ばらつきは測っていない。concurrency 3の相互干渉を含む。
- C2.6-A → A10の差はcurrent Production全体（A6・A9・その間の全変更）の差であり、A9単独の効果ではない。
- memoryはsampled max（250 ms）で、失敗childは死亡直前のIPC sampleのみ。
- timeout childはrecordを書かず、observerも付けていないため、kernel内部の進捗は観測不能。
- A9 primaryの結果は、A9自身の条件（concurrency 1、CPU profiler）での参考値。

## 12. 変更ファイル

| 役割 | ファイル |
| --- | --- |
| 条件定数・C2.6-A authority再利用・A9 authority chain parser・全task set validator（計算はC2.6-A helperへ委譲） | `src/benchmarks/plannerGlobalPhase2C26A10.ts` |
| C2.6-A RESULTのbefore view化・formal validator・comparability・遷移・core / extended semantic・participant・事前登録decision rule（post-hoc） | `src/benchmarks/plannerGlobalPhase2C26A10Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A10.test.ts` |
| Node runner / post-hoc analyzer | `scripts/run-planner-global-phase2c26a10.mjs` / `scripts/analyze-planner-global-phase2c26a10.mjs` |
| committed evidence | `docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json` |

過去のC2.6-A〜A9 RESULT・raw evidence・文書は変更していない。

### 12.1 事前登録したdecision rule（formal run前にcommit）

1. **R3 `regression_or_failure`**: comparability / parity invalid、OOM > 0、process failure > 0、timeout > C2.6-Aのtimeout数、C2.6-A
   completedの非completed化、両run completedのsemantic差（core / extended / kernel status）、新たなpreparation failure のいずれか。
   timeout数が同じでも旧completedが退行していればR3。
2. **R0 `all_completed`**: timeout 0。
3. **R2 `unchanged_timeout_count`**: timeout = C2.6-Aのtimeout数。
4. **R1 `improved_timeouts_remain`**: それ以外（1 ≤ timeout < C2.6-Aのtimeout数）。

C2.6-Aのtimeout数はRESULTから導出し、定数にしない。decisionはcomplete formal seriesでのみ生成する（smoke / subsetでは生成しない）。

## 13. 検証

- focused test `src/benchmarks/plannerGlobalPhase2C26A10.test.ts`: 23 passed。
- `npm run lint`、`npx tsc -b --force`、`npm run build`、`git diff --check`: pass。
- `npm test`: formal run前（code commit時）は331 files / 5,419 tests全pass。文書化時のfull runでは
  `src/components/rng/IdentificationWizardDialog.test.tsx > STEP 2 > incomplete does not advance to Review` が15秒timeoutで1件失敗した。
  同fileの単独実行は58 / 58 pass。本branchの変更を含まないmain `fa86383` の別worktreeでもfull runで同じ1件が同じ形でtimeoutしたため、
  本Phaseの変更（benchmark / script / docsのみ）に起因しない負荷依存のflakyと判断した。

## 14. 再現

```bash
node scripts/run-planner-global-phase2c26a10.mjs --export <Export> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --run-dir PLANNER_GLOBAL_PHASE2C26A10_RUN.local --output PLANNER_GLOBAL_PHASE2C26A10_RAW.json.local
node scripts/analyze-planner-global-phase2c26a10.mjs --run PLANNER_GLOBAL_PHASE2C26A10_RAW.json.local --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --output docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json
```

raw evidence（commitしない）: `PLANNER_GLOBAL_PHASE2C26A10_RAW.json.local`（SHA-256 `79d5564e4214c83d5346b827b49749718c33fa4a8a8788a803e3252cb9655b67`、
7,777,910 bytes）、`PLANNER_GLOBAL_PHASE2C26A10_RUN.local/`（task / record / memory trace）、`PLANNER_GLOBAL_PHASE2C26A10_RUN.log.local`。
committed RESULTではCandidate stable keyをSHA-256化している。
