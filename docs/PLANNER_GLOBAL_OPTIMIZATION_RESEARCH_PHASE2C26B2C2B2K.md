# Global Planner Research Phase 2-C2.6-B2-C2B2K（B2-C2B2E time-bound Targetの現在mainでの同一Search input × 60分 / 12 GB再実行）

Refs #154。Research only。**Production sourceは一切変更していない**（このPhaseのProduction changed files = `[]`）。B2-C2B2Eで60分 / 12 GBでもtimeoutした
唯一のtime-bound Targetを、B2-C2B2I / B2-C2B2JのProduction optimizationがmergeされた現在mainで、B2-C2B2Eと同一Search input・同一execution条件で
1回だけ再実行し、existing Searchがexact oracle Routeを60分以内にdeliverできるかをformalに確認した。

- 起点main: PR #210 merged `d42a5cc83f33ffaa805746f84a07af29136ef694`（`origin/main` と一致、Working Tree clean）
- measurement HEAD: `9017a61fe84020f0de64283e44b8d4e8a1866c19`（benchmark / runner / analyzer / 事前登録decision ruleをformal run前にcommit）
- analysis HEAD: `c57c485609ef69be2f4586ac03f215efb86e1349`（measurement HEAD以降の変更はpost-hoc許可ファイルのみ：analyzerへの環境観察ログ取り込みとtest。
  `calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2K_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2K_RESULT.json)（**`provenance.formal = true`**、`evidenceGrade = formal`、
  `partialRun = false`、`launchProvenanceVerified = true`、decision **`B2C2B2K_RECOVERED`**、invalid reason 0）

## 0. 最重要limitation（oracle-guided diagnostic）

> **このPhaseはoracle-guided diagnosticである。Target・context（B2-C1 P1 first compatible rank）・extent（B2-C2B1 required由来のtight extent）は
> 過去のoracle post-hoc評価由来。Production scheduler / Production default extent / Production extent・context selector / Production runtimeのevidenceにはならない。**

- exact判定はrun終了後のanalyzerだけが行う。Search childはoracle、RESULT、B2-C2B2Eの結果・計測値、B2-C2B2I / Jの速度改善値、
  「time_boundだった」という期待、expected stable key / index / cost / Route kindを一切受け取らない（child引数はtask fileのみ）
- 60分 / 12 GBがProductionとして許容できるとは主張しない
- 単一run。速度比はdecisionに使わず、B2-C2B2I / B2-C2B2Jの効果量をこのrunから分解しない
- **計測中に外部負荷があった**（§5）。起動時は無負荷だったが、12:31〜12:47Z（約16分）に動画エンコーダが稼働しCPU 80〜94 %になった。
  single-threadのSearchを遅くし得るだけで、Search input・ordering・結果は変えない。都合のよい結果を求めた再実行はしていない

## 1. 結論

| 軸 | 値 |
| --- | --- |
| primary question | 現在mainのoptimized Searchは、B2-C2B2Eと同じt02 Search input / 60分 / 12 GBでexact oracle Routeをdeliverできるか |
| decision | **`B2C2B2K_RECOVERED`**（invalid reason 0） |
| process | **completed**（B2-C2B2Eではtimeout） |
| exact | **C8 / C32 / C4C すべて hit、exact index 0**（最初にdeliverされたCandidateがexact oracle Route） |
| operation cost / route kind | **1,084**（= oracle operation cost）/ `existing_gogma_mixed`（owned Gogma、Keep 1 + Reset Skills 1,083） |
| captured | 1,024（termination `candidate_safety_cap`、cost cohort 1,084 / 1,085 / 1,086 / 1,087、reservation violation 0、partial 0） |
| Search elapsed / child wall / process wall | 3,374.9 s / 3,379.1 s / 3,380.6 s（budget 3,600 s以内） |
| peak heap / peak RSS / yields | 7.64 GB / 8.53 GB / 27,490,874 |
| E1 oracle-guided diagnostic | **C8 9 / C32 10 / C4C 11 of 11**（B2-C2B2E時点 8 / 9 / 10） |
| registered common ladder | C4C 9 / 11のまま（変更なし） |
| next phase | 追加micro-optimizationやt02 profilingへ戻らず、oracleなしでcontext / extent / budgetをどう選ぶか、Global Plannerへどう戻すかを整理する（本PRでは実装しない） |

E1 statement（`e1Aggregate.diagnostic.statement`、許可範囲の表現のみ）：

> **E1 11 Targetすべてについて、oracle-guided target/context/extentおよび各登録execution条件のもとで、existing Searchがexact oracle Routeをdeliverしたevidenceが得られた**

これは「Production schedulerで11 / 11」「Production default extentで11 / 11」「Production runtimeとして許容」「oracleなしで11 / 11」「global Plannerが完成」を意味しない。

## 2. population（B2-C2B2E RESULTから機械導出、sourceに値を書いていない）

B2-C2B2E RESULT（`5bf6bba3…`、formal、`B2C2B2E_INCOMPLETE`、branch C）の2 Targetから、B2-C2B2Fのpopulation rule（next-branch type `time_bound` かつ
result `timeout`、Target行がunmeasured / recovery none / paired identity・excluded Route verified、task行がrecordなし・Candidate数null・budget 3,600,000）で
導出した。もう1件（heap_growth、B2-C2B2Eで回収済み）は再実行していない。

| 項目 | 導出値（B2-C2B2E記録とassertで一致） |
| --- | --- |
| task / Target | `t02-r11` / `a367c177-a0c2-4986-995e-4efcf4131b5c` |
| context rank / groupIndex | 11 / 3 |
| tight extent | `{ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 1083 }` |
| reservationDigest / cardinality / representative | `fnv1a32:ff85a91d` / 1 / `K1:build-list.fnv1a32-32e817d9`（`070a1222…`） |
| default / tight Search input digest | `fnv1a32:d80ff6de` / `fnv1a32:824a0ec4` |
| excluded current Route key SHA-256 | `4a875aac19fe2ecb92343266fd50ae0a2c94e3072c48660d8656cf1e1aec68ba` |

さらにB2-C2B2I / B2-C2B2J RESULTが同じTarget・probe・Search input identity・excluded current Routeを探索したことを照合した（population chain 14項目
すべてtrue）。analyzerではB2-C2B2EのProbe導出（`phase2c26b2c2b2eProbes()`）をB2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C / B2-C2B2D authority chainで
再実行し、B2-C2B2E RESULTの `probes` と完全一致することも確認した。

## 3. Search input / 実行条件のparity（B2-C2B2E t02と同一）

| 項目 | 結果 |
| --- | --- |
| Search input identity | task ID / Target / rank / group / reservationDigest / cardinality / representative / default・tight Search input digest / tight extent がB2-C2B2E task行と完全一致（`pairedComparison[0].identity.matches = true`）。B2-C2B2D task行とのpaired identityもB2-C2B2Eのanalysisで成立 |
| excluded current Route | analyzerがExportから再導出したscheduleでB2-C2B2E task行のdefault contextを再構築：digest一致、excluded keyはちょうど1件でcurrent Route、SHA-256 `4a875aac…` = B2-C2B2E再導出値。今回のSearch record自身のexcluded keyとも一致（`b2c2b2k_record`） |
| Planner-start origin / CalculationContext / researchMaxPlanSteps / RNG Engine | B2-C2B2E RESULTと一致（`production-rng:c5-e7`）。schedule parity全項目true |
| Stage 1 | `{ executionClass: stage1, childHeapMb: 12288, concurrency: 1, budgetMs: 3600000, retry: none, fallback: none }` = B2-C2B2E RESULTの `conditions.stage1`（changed fields `[]`） |
| child | fresh child 1回、node flagは `--max-old-space-size=12288` のみ、child計算は `runPhase2C26B2C2B2ETask`（= B2-C2B2D、同一関数object） |
| capture / safety cap / yield / sampling | C4C（max 4 cost cohort、5th-cost sentinel）、safety cap 1024、`setImmediate`、250 ms |
| instrumentation | なし（section observer / CPU profiler / B2J profiling observer / allocation profiler / heap snapshotすべてなし） |
| retry / fallback / early stop | なし（exact / oracle / context early stopなし） |

conditionChecks 18項目・childIsolation 3項目・hashChain 48項目（B2-C2B2E / I / J、B2-C2B2D〜B2-B1、oracle、Export）すべてtrue。

## 4. authority / Production provenance

| authority | 値 |
| --- | --- |
| B2-C2B2E RESULT（paired before authority） | `5bf6bba389bb3c4f1089ddc9b079426930be203bd5e88f3d3f9b2032a42ecabe`（formal、`B2C2B2E_INCOMPLETE`、measured HEAD `e69a94e`） |
| B2-C2B2E raw evidence（local SHA = RESULT記録値） | raw `1b068005…`、start attestation `d11cd8b6…`、probe manifest `a506881c…`（3件一致。不一致ならformal runを開始しない） |
| B2-C2B2I RESULT | `ad877e1efd53b893ee48f9b9bc3747f51d4a278890a0dd7f96530d4bb4a1e4d4`（formal、`B2C2B2I_ADOPTED`、`predict_keep_nested_counter_family_cache_v1`） |
| B2-C2B2J RESULT | `4e5c9b0bfb2336e5f9ed0228d5169373bcdd78c6a976f1532e02779bf9708750`（formal、`B2C2B2J_ADOPTED`、`reserved_keep_family_layout_key_reuse_v1`、B2-C2B2I / B2-C2B2Eに対して作成） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |

Production calculation source audit（runnerがlaunch前にgitで取得・attest、analyzerがmeasured HEADで再計算し一致を確認）：

| 項目 | 値 |
| --- | --- |
| base main（PR #210）以降のProduction変更（このPhaseの変更） | **`[]`** |
| B2-C2B2E measured HEAD `e69a94e` → measurement HEADのProduction変更 | `src/domain/search/bonusStream.ts` のみ（= adopted optimization 2件のfile） |
| main commit別（B2-C2B2E分岐点以降） | `613b497`（B2E）/ `5a44164`（F）/ `4babb9f`（G）/ `4007ef1`（H）: なし、`f482811`（B2I）: bonusStream.ts、`9ae3f2a`（#209、fixture / testのみ）: なし、`d42a5cc`（B2J）: bonusStream.ts |
| optimized fileの同一性 | 現在の `bonusStream.ts` はB2-C2B2J measured HEAD `4ed9fb9` のfileとbyte一致（B2-C2B2J RESULTのsource checkはB2-C2B2I measured fileからの変更を検証済み） |

## 5. start attestationと計測環境

| field | 値 |
| --- | --- |
| file / SHA-256 | `start-attestation.json` / `3784e6440ea5dcc7f8eb58ab7e7db7f7faa8a67cfa280efdc81f5c8a048d3ae6`（`wx` で作成後read-only、read-back確認） |
| createdAt | 2026-10-06T12:23:20.088Z（tasks child START 12:23:20.127Z、Search child START 12:23:25.489Zより前） |
| repositoryHead / Working Tree | `9017a61` / clean（`uncommittedBenchmarkCode = false`、`smoke = null`） |
| 記録内容 | benchmarkCodeSha256（measured HEADのgit objectから再計算した値と一致）、Export / manifest SHA、B2-C2B2E / I / J RESULT SHA、B2-C2B2E evidence SHA、adopted optimizations、Production audit、probe / expected identity、Stage 1、instrumentationなし |
| 起動時machine | 空き物理メモリ 17.8 GB / 33.4 GB、他Node process 0、CPU busy 8 %（runner計測）。起動前のoperator確認でもCPU 11〜32 %、エンコーダCLIなし |

**計測中の外部負荷（記述値、decision inputではない）**：operatorが1分ごとに記録した監視ログ（`provenance.machineDuringRun`、54 sample）で、
12:31:03Z〜12:46:46Z（Search開始後 約7.5〜23分）の16 sampleで動画エンコーダprocessが稼働し、CPU 79〜94 %、空き物理メモリ最小 8.38 GBだった。
それ以外の時間帯はCPU 11〜32 %程度。memory warning（< 1.5 GB）は0件。エンコーダは起動時には存在せず計測途中で始まったもので、停止・再実行はしていない。
このrunのwall / yield速度はその影響を含む。

smoke：runner配線確認のためnon-formal smokeを1回（`--allow-uncommitted --smoke-budget-ms 20000`、20秒でtimeout）。analyzer（`--allow-nonformal`）で
INCOMPLETE判定・timeoutをCandidate 0扱いしないこと・paired identity / Production audit / evidence照合を確認した。smoke結果はformal evidenceに使わず、
条件も変えていない。formal runは1回のみ。

## 6. 実行結果とB2-C2B2E t02とのdescriptive comparison

| 項目 | B2-C2B2E（`e69a94e`） | B2-C2B2K（`9017a61`、B2I + B2J） |
| --- | --- | --- |
| process | timeout | **completed** |
| termination | — | `candidate_safety_cap` |
| captured | —（未計測、Candidate 0ではない） | 1,024（cost 1,084〜1,087） |
| exact | 未計測 | **C8 index 0、cost 1,084** |
| process wall | 3,600.4 s（budget到達、必要時間の下限） | 3,380.6 s |
| Search elapsed | — | 3,374.9 s |
| peak heap | 7.83 GB | 7.64 GB |
| peak RSS | 8.32 GB | 8.53 GB |
| yields | 25,774,814（最後のIPC値） | 27,490,874 |

heap / yield推移（memory.jsonl、running maximum、観察のみ）：

| 経過 | B2-C2B2E heap | B2-C2B2E yields | B2-C2B2K heap | B2-C2B2K yields |
| --- | ---: | ---: | ---: | ---: |
| 60 s | 5.74 GB | 0.50 M | 4.57 GB | 0.80 M |
| 300 s | 6.09 GB | 2.64 M | 4.91 GB | 3.95 M |
| 600 s | 7.32 GB | 5.26 M | 6.16 GB | 6.58 M |
| 1,200 s | 7.40 GB | 10.28 M | 6.62 GB | 10.34 M |
| 1,800 s | 7.47 GB | 14.40 M | 7.48 GB | 15.53 M |
| 2,400 s | 7.83 GB | 18.58 M | 7.48 GB | 20.83 M |
| 3,000 s | 7.83 GB | 22.40 M | 7.64 GB | 25.33 M |
| 3,600 s | 7.83 GB | 25.76 M | （3,380 sで完走） | — |

- B2-C2B2Kは3,380 sで完走し、60分budget内でexact oracle RouteをCandidate index 0としてdeliverした（その後safety cap 1024までcapture）。
  exactがdeliverされた時刻はrecordに無く、「3,375 s以内」以上のことは言えない
- yield速度：0〜10分 11,086 / s（B2-C2B2E 8,873 / s）、10〜30分 7,459 / s（同 7,612 / s）。10〜30分の区間はエンコーダ負荷と重なっている
- 単一runで外部負荷も含むため、B2-C2B2I / B2-C2B2Jそれぞれの効果量、および「どれだけ速くなったか」をこのrunから分解・断定しない
  （B2-C2B2Jの同一work `state_generation` 811,888 ms → 463,867 ms、ratio 0.571は背景として `background.b2c2b2jDirect` に転記のみ）
- recoveryは60分の上限に近い（残り約225 s）。budget・負荷条件の違いで結果が変わり得ることはlimitationとして残す

## 7. E1集計（post-hoc、Research-level）

| 集計 | L1（7） | L2（4） | E1合計（C8 / C32 / C4C） | statement |
| --- | --- | --- | --- | --- |
| registered common ladder（B2-C2B2B common L1 + B2-C2B2C common L2） | C4C 7 / 7 | C4C 2 / 4 | 7 / 7 / **9** of 11 | なし（変更なし） |
| oracle-guided diagnostic（B2-C2B2E時点） | C4C 7 / 7 | C4C 3 / 4 | 8 / 9 / 10 of 11 | なし |
| **oracle-guided diagnostic（本Phase後）**：B2-C2B2Eのt02を本Phaseの結果で置換 | C4C 7 / 7 | **C4C 4 / 4** | **9 / 10 / 11** of 11 | §1の限定statement |

各Targetの回収条件はphaseごとに異なる（L1はB2-C2B2B common L1、L2はB2-C2B2D / B2-C2B2E / 本Phaseのfirst compatible context × tight extentとそれぞれの
登録budget、本PhaseのTargetは現在mainのoptimized Search）。1回のrunで11件を回収したという意味ではない。

## 8. 次Phase

decision `B2C2B2K_RECOVERED` に従い、**追加micro-optimizationやt02 profilingへは戻らない**。Issue #154の次段階は、
oracleなしでcontext / extent / budgetをどう選ぶか、およびGlobal Plannerへどう戻すかの整理を優先する（本PRでは実装しない、レビュー後に決める）。

## 9. 変更ファイル

| file | 内容 |
| --- | --- |
| `src/benchmarks/plannerGlobalPhase2C26B2C2B2K.ts` | Search側：登録条件（B2-C2B2E Stage 1そのもの）、probe manifest parse、identity-gated task構築、child計算の再export、start attestation |
| `src/benchmarks/plannerGlobalPhase2C26B2C2B2KTargets.ts` | B2-C2B2E / I / J authority parse、population導出、manifest、adopted optimization、Production audit判定 |
| `src/benchmarks/plannerGlobalPhase2C26B2C2B2KAnalysis.ts` | launch provenance、B2-C2B2E paired comparison、事前登録decision、recovery、E1集計 |
| `scripts/prepare-planner-global-phase2c26b2c2b2k-probes.mjs` / `run-…k.mjs` / `analyze-…k.mjs` | probe準備、runner、analyzer |
| `src/benchmarks/plannerGlobalPhase2C26B2C2B2K.test.ts` | 単体test + committed RESULT固定 |
| `docs/PLANNER_GLOBAL_PHASE2C26B2C2B2K_RESULT.json` / 本document | formal RESULT |

Production source、fixture、frozen JSON、Search algorithm / ordering / comparator、Candidate materializer、extent、context、P1、capture、safety capは変更していない。

## 10. 未検証事項・limitation

- 単一run。時間・メモリのばらつきは未評価。計測中16分間の外部エンコーダ負荷を含む（§5）
- recoveryは60分budgetの約94 %時点での完走で、余裕は小さい
- population・context・extentはoracle由来。Productionがそれらを選べること、budgetを許容できることは示していない
- exactのdeliver時刻は記録していない（Search全体の完走時間のみ）
- Node / Vite SSRでの計測で、Browser Workerの計測ではない
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない
