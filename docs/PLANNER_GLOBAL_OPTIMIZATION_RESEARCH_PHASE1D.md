# Global Planner Research Phase 1-D

**43/43に到達した。** Phase 1-Cで観測されたbounded no-matchに対し、同一Projected snapshotから
Normalだけを2倍にするgeneric fallbackを組み込むと、2つのanchorの両方で
**43/43 completed・Conflict 0・rejected 0・resource_conflict 0・Trace Replay passed** になった。
最良は **6,857 steps**（Phase 1-C Attempt 3由来のanchor）で、新しいNode processによる独立再現も完全一致した。
Gogmaだけ2倍・Skillだけ2倍は、どちらのsnapshotでもextent内未発見だった。

これはResearch結果であり、Production化の判断・仕様変更はしていない。Plan品質は既知oracle 2,982 stepsより悪く、
Production default `maxPlanSteps = 1000` も超える。

Refs #154。開始時のmain / origin/mainは `d3c338ca84553355c9c237a261506242bcef1fc5`（PR #162）、Working Treeはclean。
branch: `claude/global-planner-phase1d`。Phase 0 / 1-A / 1-B / 1-C（PR #159〜#162）とIssue本文・コメントを確認した。

## 目的・変更境界

Phase 1-Cで観測された `not_found_within_extent` が、どのaxisのbound不足によるものかを
そのSearchを開始した**全く同じ**Projected snapshotから単軸probeで切り分け、見つかったCandidateを
Global discoveryへ戻して43/43・Conflict 0まで到達できるかを検証する。

Production behavior変更なし。通常Candidate Search semantics / default extent、Planner routing、Worker protocol、UI、
Persistence / Dexie / Export schema、CalculationContext（17）、`PRODUCTION_RNG_ENGINE_VERSION`（`production-rng:c5-e7`）、
preferredOwnedWeaponId、Production maxPlanSteps、manual Conflict、Issue #157、REQUIREMENTSの現行契約（明示的選択なしに
自動再検索しない）を変更しない。raw block cacheは引き続きResearch-onlyのper-search。

参照authority: REQUIREMENTS 14 / 19 / 20 / 23、PLANNER_SPEC 7 / 9 / 11、SEARCH_SPEC 3.1 / 5.5 / 5.6、
DATA_MODEL 9 / 11、RNG_SPEC 6 / 7、前4PhaseのResearch文書、AGENTS.md、AI_DEVELOPMENT_WORKFLOW。

### oracle・Target ID非使用

oracleの18 retained / 25 replacement ID、Target順、Counter位置、RouteKind、2,982-step Routeは入力にも判断にも使わない。
Source codeにTarget ID・attempt IDを埋め込まない。axisの選択はbase Searchのboundary証跡だけから導く。
本書に現れるTarget IDは実験の**観測結果**である。

## anchorの選択

`selectExtentProbeAnchors()` がcommit済みの正式結果 [PHASE1C_RESULTS_8G](PLANNER_GLOBAL_PHASE1C_RESULTS_8G.json)
（SHA-256 `f0254b517b4224255b174f457173ef2986fa5e370946ff20aa938eb8acb3dd70`）の全attemptから導く。

1. 使えるstateは、signatureがstateと一致し、stop（blocker）なし、report errorなし、final Trace Replay passed、
   semantic evidence（result SHA）ありのものだけ。raw reportの `bestAttemptId` はblindに信じない。
2. 使えるstateのうちcompleted最大（42）のものを、Phase 1-Cの既存 `compareResearchAttempts()` で順位付けし、先頭をprimaryとする。
3. primaryのnot_found集合に無いTargetをnot_foundに持つstateのうち、同じ順位で最良のものを1件だけsecondaryとする。

結果はprimary **Attempt 4**（42/43、6,214 steps、未発見 `711f7d15-bb2b-4113-af0c-bd1832dcfd49`）、
secondary **Attempt 3**（42/43、6,448 steps、未発見 `813fb479-accd-454d-8fcd-fed51d4e891d`）。
reportの `bestAttemptId`（4）と一致した。8 attemptとも1.の条件を満たし、5つのfixed retained stateが42 completedだった。
Attempt 2と3は全metricとresult SHAが同じで、stable signatureの順でAttempt 3になった。

## anchorのfresh再現

各anchorは新しいNode processで **original Export + anchorのretained set + pending order + base extent** から再実行した。
Phase 1-CのCandidateやProjected stateは受け取らない。

| anchor | completed | Conflict | rejected | steps | result SHA | Search status列 / 23 Search evidence SHA | 判定 |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 4 | 42/43 | 2 | 1 | 6,214 | `2242740c…cc1e`（1-Cと同一） | 全一致 | passed |
| 3 | 42/43 | 2 | 1 | 6,448 | `7d17ea7b…d195`（1-Cと同一） | 全一致 | passed |

最終completed・Conflict・rejected・resource_conflict・steps・Trace Replay・result / Plan SHA・not_found Target・
全Searchのstatusと結果SHAを比較した。どちらも完全一致したのでprobeへ進んだ。

## not_found時点のsnapshotとboundary証跡

再現run内で `not_found_within_extent` になったSearchの `CandidateSearchInput` を、Research seam `onBoundedNoMatch`
（deep copy）でPlanner-start Targetとbase measurementごとにlocal `.local` へ記録した。前後stateからCounterを推測して
再構成していない。snapshotはrepositoryへcommitしない（約157KB / 件）。

| anchor | Target | search index | 武器種 / 属性 | Normal / Gogma / Skill Counter | 観測reach N / G / S | boundary N / G / S-existing / S-conv | settled work | base elapsed |
| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: |
| 4 | 711f7d15 | 1 | charge_blade / fire | 207 / 432 / 2246 | 350 / 500 / 1501 | yes / yes / yes / yes | 2,350 | 7.067秒 |
| 3 | 813fb479 | 1 | charge_blade / dragon | 207 / 433 / 1792 | 350 / 500 / 1501 | yes / yes / yes / yes | 2,350 | 7.079秒 |

どちらも対応OwnedWeapon 0件、searched Routeは `normal_artian_to_gogma` のみ。両anchorで直前（index 0）の
もう一方のcharge_blade Targetが同じNormal Counter 0から207 forgeを使って発見されており、その後に検索されたTargetが未発見になっていた。

### boundary証跡の意味と限界

probe対象は `predictionBoundaryReached` だけで決める（Normal: `normal`、Gogma: `gogma`、Skill: `skillExisting || skillConversion`）。
bounded no-matchのSearchはcanonical Idealが無いためqueueを全消化するので、boundaryに届かなかったaxisは
自然終了しており、そのaxisだけを広げても読む範囲は増えない（今回の2件は全axisがboundary到達で、全axisがeligible）。
逆に、boundary到達は「そのaxisが原因」の証明ではなく候補であることを示すだけである。
reachはSearch開始Counterからの実prediction呼出しの最大位置であり、Skillのexisting / conversion窓は1つのreachから近似する。
scheduler内部の `stoppedByExtent` はPlanner Alternativeだけが読む内部状態で、通常Search結果には公開されていない。
Researchのためにこれを外部APIへ昇格させていない。

## single-axis probe

base extent N350 / G500 / S1500 に対し、Normal 700 / Gogma 1000 / Skill 3000 の**1軸だけ**を2倍にした（それ以上は広げない）。
各probeは別Node processで同じcaptureを読み直し、deep copyから開始する。probe同士で結果を引き継がない。
probe budgetは180秒。

**searchRunId / identity**: Phase 0の `searchRunId` 生成式（Target、正規化したProjected origin、extent）を
`globalResearchSearchInput()` に抽出し、base / probe / fallbackの全Searchで共有した。probeはcaptureからrequest fieldだけを除いた
projected stateをこのhelperへ通し直して作る。base extentでの再構築がcaptureと完全一致することを毎回検証してからprobe extentで作る。
`settings` の書換えや `searchStateHash` 等の後書き換えはしない。materializerのsearch identityもprobe / fallbackのextentを含む。

| anchor / Target | axis | extent N / G / S | status | Search秒 | settled | prediction calls N / G / S | 観測reach N / G / S | Route / 操作数 / advance N・G・S | 検証 | child maxRSS |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | ---: |
| 4 / 711f7d15 | Normal | 700 / 500 / 1500 | **found** | 5.663 | 3,679 | 700 / 105,325 / 1,479 | 700 / 500 / 1,479 | normal_artian_to_gogma / 1,480 / 643・1・836 | passed | 1.020 GiB |
| 4 / 711f7d15 | Gogma | 350 / 1000 / 1500 | not_found_within_extent | 32.530 | 2,850 | 350 / 341,541 / 1,501 | 350 / 1,000 / 1,501 | — | — | 2.555 GiB |
| 4 / 711f7d15 | Skill | 350 / 500 / 3000 | not_found_within_extent | 7.321 | 3,850 | 350 / 104,325 / 3,001 | 350 / 500 / 3,001 | — | — | 0.900 GiB |
| 3 / 813fb479 | Normal | 700 / 500 / 1500 | **found** | 5.435 | 3,168 | 700 / 103,492 / 1,097 | 700 / 500 / 1,097 | normal_artian_to_gogma / 1,098 / 643・1・454 | passed | 0.823 GiB |
| 3 / 813fb479 | Gogma | 350 / 1000 / 1500 | not_found_within_extent | 39.040 | 2,850 | 350 / 341,372 / 1,501 | 350 / 1,000 / 1,501 | — | — | 2.552 GiB |
| 3 / 813fb479 | Skill | 350 / 500 / 3000 | not_found_within_extent | 7.770 | 3,850 | 350 / 102,621 / 3,001 | 350 / 500 / 3,001 | — | — | 0.839 GiB |

prediction elapsedは6probe合計7.401秒。raw block cacheはGogma unique 500（Gogma probeは1,000）blocks、hit率は約99.5〜99.7%。
foundのCandidateは通常validationで確認した: `validateBuildCandidate`、元起点へのmaterialize（`createConstrainedCandidate` による
元Ideal再判定を含む）、単体Entryの `validatePlannerInput`、snapshot上の単体ordinary Planner（completed、Conflict / rejected 0）と
既存Execution transitionでの投影。

**Q1 / Q2の回答**: 観測された2件のno-matchはどちらもNormal extent不足で、Normalだけの2倍で発見できた。
Gogmaだけ・Skillだけの2倍では発見できなかった。どちらのCandidateもNormal advance 643
（絶対Normal Counter 207 + 643 − 1 = 849）で、base窓（207〜556）の外にある。これはPhase 1-Aの別snapshot
（Phase 0順）で813fb479がN700で見つかった観測とも整合する。643が発見可能性の最小閾値であること、
G1000超・S3000超や複合extentに別解がないことは主張しない。

### Candidate比較authority（Task H）

Search Domainは `compareCanonicalIdeals()`（SEARCH_SPEC 5.6.3）をexportしているが、これは**1つのSearch request / extent内**で
canonical Idealを決める順序である。extentの異なる別Searchの結果同士を比べても、どの探索範囲のcanonicalでもない
（合成extentは探索していない）。したがってCandidate単体でwinnerを決めず、発見したaxisごとに別のGlobal integrated variantとして
実行し、最終Planner結果で比較する方針にした。今回は各anchorでNormalだけがfoundだったため、同一anchor内の複数axis比較は発生しなかった。

## generic integrated fallback

`createSingleAxisExtentFallback(axis, budget)` はResearch seam `extentFallback` へ渡す一般規則で、
**base Searchが `not_found_within_extent`、かつそのaxisのboundaryに到達**したときだけ、全く同じProjected snapshotから
そのaxisだけ2倍で1回だけ再検索する。Target IDを見ない。foundなら通常どおりmaterialize → 単体ordinary Planner → 投影して続行、
not foundなら元Entryを残して続行する。

- base Searchの `not_found_within_extent` は上書きしない。`fallback`（axis、extent、searchRunId、status、stoppedBy、時間、reach、
  Route、advance、generated Entry）を別記録し、Target outcomeを `resolved_by_extent_fallback` /
  `unresolved_after_extent_fallback` のResearch diagnosticとして持つ。Candidate Searchのstatus contractは変更しない。
- fallbackの時間切れ（`fallback_budget`）、外部cancel、attempt budget、search_error、unavailable、materialization / projection失敗は
  no-matchへ変換せず、そのattemptを止める（blocker `extent_fallback_*`、stop `extent_fallback_blocked`、cancelは `cancelled`）。
- fallback Searchも同じcheckpoint・raw cache（per-search）・profilerを使い、Search時間はcumulative Searchに含めたうえで別集計する。

各variantは新しいNode processで **original Export + anchor retained set + anchor pending order** から開始し、
自らbase no-matchを観測し、同じ規則でprobeしてCandidateを再発見する。focused probeのCandidate objectは渡さない。
事後照合として、再発見したCandidateのSHA-256はfocused probeと一致した（下表）。
最後にoriginal 43件の分母でordinary full Plannerを実行する。

## integrated variantの結果

variantは実際にfoundしたaxisだけ（各anchorでNormalの1つ、計2）。同じanchor + strategyは実行しない。

| anchor | strategy | fallback発動 | fallback Candidate | completed | Conflict | rejected / resource | steps | expandedStates | Trace Replay | termination |
| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| **3** | normal-2x-fallback | index 1 / 813fb479のみ | 1,098操作（N643 / G1 / S454）、SHA `922a86f0…3533`（probeと一致） | **43/43** | **0** | **0 / 0** | **6,857** | 6,900 | passed | completed |
| 4 | normal-2x-fallback | index 1 / 711f7d15のみ | 1,480操作（N643 / G1 / S836）、SHA `4acfe3aa…8608`（probeと一致） | **43/43** | **0** | **0 / 0** | 8,589 | 8,632 | passed | completed |

どちらもnot_found 0、blocker 0、selected 43、generated replacement 23。fallbackは各runで1回だけ発動し、
後続22 Searchはすべてbase extentでfoundだった。Plannerはbound truncateされていない（status completed）。

Research variant比較（43/43 → resource rejected → Conflict → completed → steps → stable signature）で
**winnerはanchor 3 / normal-2x-fallback（6,857 steps）**。これはResearch上の比較でありProduction Candidate rankingではない。
**Q3**: Candidateを見つけるだけでなく、Global discoveryへ戻して43/43・Conflict 0へ到達した。
**Q4**: 今回はNormal軸だけが成立し、両anchorで成立した。

### 独立再現

新しいNode processで同じoriginal Export、同じanchor導出、同じgeneric fallback strategyを再実行し、
anchor retained set / pending order、全base Search status、fallback発動箇所・axis・extent・searchRunId、fallback Candidate SHA、
23 base Search evidence、generated Entry IDs / body SHA、selected IDs、Plan SHA、final result SHA、43/43、Conflict 0、rejected 0、
Trace Replayが**完全一致**した（semantic SHA `3e908264f9a796758a32841fa24daede17dd4135314c83e5d64f122fbb0fa727`）。
Plan SHA `c124f9a3d144b9f225f0ecf978512a9d1f916d6b228e38f8285a1a0b210f3e1c`、
result SHA `86b38b033d30238f0a37022ccf93efe733663d402b2173cfeadce35820f0cecc`。elapsed / memoryは比較対象外。

## runtime・memory

| 区分 | 件数 | Candidate Search | Search秒 | Planner秒 | attempt内部 / wall秒 | peak child maxRSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| anchor再現 | 2 | 46 | 134.112 | 86.154 | 238.219 / 240.976 | 2.973 GiB（anchor 3）|
| focused probe | 6 | 6 | 97.759 | （単体検証Plannerを含むwall）| — / 110.737 | 2.555 GiB |
| integrated variant | 2 | 46 + fallback 2 | 163.589（うちfallback 15.043） | 122.273 | 307.527 / 310.820 | **3.793 GiB**（anchor 4）|
| **Phase 1-D discovery計** | — | **100** | **395.460** | **208.428** | controller wall **662.951秒（11分2.951秒）** | 3.793 GiB |
| 独立再現（別計上） | 1 | 23 + fallback 1 | 64.075（fallback 5.770） | 52.391 | 125.590 / 127.173 | 2.886 GiB |

controller maxRSSは180,520KiB（約176.3MiB）、再現込みwall 790.126秒。winning variant単体は126.894秒
（Search 63.980、Planner 53.452）で、anchor 4 variantは180.633秒。

**この126.894秒を「43/43を発見する総時間」と呼ばない。** Phase 1-D discoveryは Phase 1-Cの8 state / 206 Searches /
controller wall 1,050.921秒で得たanchorを前提にしている。anchor 3はPhase 1-Cのordering履歴（Attempt 0〜3）から
導かれたstateである。Phase 1-C＋1-Dの合算wallは約1,713.9秒だが、これも成功までの最短経路の測定ではない。
fallbackをPhase 1-C controllerの最初のattemptから有効にした場合の所要時間は未測定である。

Research childは `--max-old-space-size=8192`（V8 heap limit 8,791,261,184 bytes）で実行した。
8GiB heapで動いたことはProduction（Browser Worker / スマートフォン）で実用的であることを意味しない。
Phase 1-Cで既定heapのretain-noneがOOMした証跡（[4G_STOP](PLANNER_GLOBAL_PHASE1C_4G_STOP.json)）は有効なまま残る。
今回memory最適化はしていない。

## cancel / deadline

正式runと同じmeasured commitで、main controller終了後に別childで逐次測定した（discovery累積には含めない）。
anchor 4 / Normal axisを使用。

| 試行 | 設定 | 結果 | 備考 |
| --- | --- | --- | --- |
| probe deadline | `--time-budget-ms 2000` | time_budget_reached（2,000.6ms） | Candidateなし、not_foundにしない |
| probe cancel | `--cancel-after-ms 2000` | cancelled（1,985.3ms）、要求→集計2.423ms | 同上 |
| fallback deadline | `--fallback-budget-ms 1000` | fallback time_budget_reached / stoppedBy fallback_budget（1,001.0ms）、report blocked、stop `extent_fallback_blocked` | 元Entryで続行せずfinal Planner未実行 |
| fallback cancel | fallback開始1,000ms後にcancel | fallback cancelled / external_cancel（1,000.2ms）、report cancelled、要求→集計3.515ms | 同上 |

raw: [DEADLINE](PLANNER_GLOBAL_PHASE1D_DEADLINE.json) / [CANCEL](PLANNER_GLOBAL_PHASE1D_CANCEL.json)。
cancel応答値はrunnerが要求時刻を記録してから結果集計までで、Browser UIの応答時間ではない。

## oracle（2,982 steps）との比較

既知oracleは43/43・2,982 stepsで、今回の最良6,857 stepsはその約2.3倍である。本研究はcorrectness優先であり、
6,857を良い品質とは扱わない。steps増の大部分はfallback CandidateのNormal 643 forge（1,098操作のRoute）に由来する。
oracleは保持集合・順序・Routeの比較基準のみで、今回の入力・判断には使っていない。
6,857 / 8,589 stepsはいずれもProduction default `maxPlanSteps = 1000` を超え、Research boundの20000で実行した結果である。

## Q5: bounded / deterministicな一般ルールとしての可能性

- 規則は「base bounded no-match ＋ そのaxisのboundary到達 → 同じsnapshotからそのaxisだけ2倍で1回」だけで、
  Target ID・順序・oracleを参照せず、deterministicで、追加Search数は発動回数（今回1回 / attempt）に抑えられる。
- 観測した3件のno-match（今回の2件とPhase 1-Aの1件）はすべてNormal 2倍で解決し、Gogma / Skill 2倍では解決しなかった。
  いずれも同じcharge_blade Normal streamを別Targetが先に使ったあとで、次の到達可能Normalが遠いケースである。
- ただし観測は1 Export・1武器種の現象に限られる。Normal優先を規則として固定する根拠にはならず、
  3axisの独立variantを最終Plan結果で比較する今回の構造を維持すべきである。
- 1回2倍で見つからない場合（より遠い位置、複合extentが必要な場合）の扱い、fallbackのSearch時間上限、
  追加Normal forgeによるPlan長の増大は未解決である。

## テスト

synthetic fixtureで以下を固定した（`plannerGlobalOptimizationExtentProbe.test.ts` 12件、runner guard 3件）。

- fallbackなしのdefault / explicit attempt / retain-none / no-matchの4経路は、Phase 1-D変更前の実装で計算した
  完全結果（report・final Plan・generated Entries）のSHA-256と一致（Phase 0 / 1-C parity）。
- probeはcaptureを変更しない。N / G / Sは互いに独立（単独実行でも同じCandidate）、対象axis以外のextent不変、
  base extentで再構築したrequestがcaptureと完全一致、probe searchRunIdはprobe extentで再生成、
  Candidateは通常Search結果そのもの（hash書換えなし）、偽造captureとboundary未到達axisを拒否。
- generic policyはboundary未到達axis・not_found以外で発動しない。Target IDを変えても判定は同じ。
- integrated fallbackはbase not_foundを保持しfallback foundを別記録、通常materializer・単体Planner・投影を通り、
  original起点から43件分母で完成。fresh依存の再実行で完全一致し、focused probeのEntryと同じIDを自ら再発見する。
- fallback not_found（unresolved記録）、fallback timeout・cancel・search_errorはno-matchにならずblocker / cancelになる。
- anchor選択はblocker・未Replay・evidence欠落・signature不一致を除外し、Target名を付け替えても同じstateを選ぶ。
- 同じanchor + axisを二度実行しない。probe / variantの上限を超えない。variant比較はfinal Plan結果だけで行う。
- completed stateは後続error / OOMで上書きされない（Phase 1-D outcomeとPhase 1-C `runDiscoveryRetries()` の両方。
  PR #162 reviewのOptional指摘をResearch-onlyで修正）。
- ProductionからResearch moduleへのimportなし（既存テストの対象名に新moduleが含まれる）、build artifactに識別子なし。

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | **295 files / 4,778 tests passed**（最終再実行） |
| `npm run build` | passed（既存の500kB超chunk warning）、dist にResearch識別子なし |
| focused Research / runner tests | passed（`src/benchmarks` + `scripts` 25 files / 263 tests） |
| `node --check` 両runner | passed |
| `git diff --check` | passed |

測定後の最初の `npm test` では、変更対象外の `IdentificationWizardDialog.test.tsx` の
`shows global progress, cancellation, and Worker failure distinctly` が15秒timeoutになり4,777 passed / 1 failedだった
（Phase 1-Cでも同じtestで観測）。benchmarkと並行実行はしていない。testは変更せず、続く `npm test` で全件passedした。
測定前にも同fileの別test（`incomplete does not advance to Review`）が一度timeoutし、単独実行（58件passed）で確認した。
また新規runner guard testが同期spawnの多さで既定5秒timeoutに掛かったため、正式測定前に分割し明示timeoutを付けた。

## 再現性・ファイル

正式measured commit: `2c595ad53a31b71497aab5f823f76569986ca6cb`。
benchmark code SHA-256: `ffdf91544b0454721c2a62a57f240cbeb7412f713c75c9ac482e074cbd6ee131`。
Node v24.19.0、Windows x64 10.0.26200、AMD Ryzen 7 9700X（16 logical CPUs）、physical memory 33,377,591,296 bytes、
RNG `production-rng:c5-e7`、child heap limit 8,791,261,184 bytes、raw cache per-search、Node yield immediate、
Research maxPlanSteps 20000、attempt budget 900秒、fallback / probe budget 180秒。
Export SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（19MB Exportとsnapshotはcommitしない）。
controllerはsrc / scripts / package / lock / Vite / TS configの未commit・未tracked codeを拒否し、
全childのHEAD / code SHA / Engine version / Export SHA / heap limitが一致することを検査する。
code commit後の文書追加はdocs-onlyで、benchmark behaviorは変更していない。

```powershell
node scripts/run-planner-global-phase1d.mjs C:/Users/nekon/Downloads/gogma-artian-planner-backup_20260927015837.json docs/PLANNER_GLOBAL_PHASE1D
node scripts/run-planner-global-phase1d.mjs C:/Users/nekon/Downloads/gogma-artian-planner-backup_20260927015837.json docs/PLANNER_GLOBAL_PHASE1D --cancel-deadline
```

raw: [PROBES](PLANNER_GLOBAL_PHASE1D_PROBES.json)（anchor選択・再現・snapshot概要・6 probe）、
[VARIANTS](PLANNER_GLOBAL_PHASE1D_VARIANTS.json)（variant・順位・独立再現・totals）、CANCEL / DEADLINE。
Candidate / Planの全文ではなくSHAとsummaryだけを保存した。Phase 1-Cの結果ファイルは変更していない。

コード: `src/benchmarks/plannerGlobalOptimizationExtentProbe.ts`（新規: anchor選択、単軸extent、probe、generic fallback、
ledger、variant比較）、`plannerGlobalOptimizationResearch.ts`（Search request helper、`runGlobalResearchSearch()`、
`extentFallback` / `onBoundedNoMatch` seam）、`plannerGlobalOptimizationRetry.ts`（fallback-aware signal、completed保持）、
`plannerGlobalOptimizationTestFixture.ts`（既存fixtureの共有化）、`scripts/run-planner-global-research.mjs`（capture / probe /
fallback option）、新規 `scripts/run-planner-global-phase1d.mjs`、各test。

## 次Phaseの推奨

1. **一般性確認**: fallbackを有効にしたままPhase 1-C相当のcontrollerを最初（Phase 0順）から回し、anchorに依存しない
   総所要時間・Search数・成功までのattempt数を測る。Phase 0順のno-match（813fb479、index 20）でも成立するかを確認する。
2. 別Export / 別武器種でno-match axisの分布を測り、Normal偏りが今回のExport固有かを確認する。
3. memory（variant peak 3.793GiB、Gogma probe 2.55GiB）と、Search / Planner残りコストの削減。
4. Plan長（6,857 steps）とProduction `maxPlanSteps` policyの整理、Browser Worker benchmark。
5. Production contract変更案（自動再検索禁止との関係）とREQUIREMENTS変更案を整理してからProduction化を判断する。

## 未確認事項

Browser Worker / スマートフォンの時間・メモリ・cancel、複数回の性能分布、heap / GCの内訳、
Gogma / Skill 2倍超や複合extentでの発見可否、別Exportでの一般性、fallbackを初回attemptから有効にした場合の結果、
ゲーム実機の追加検証は未確認。既存reference-verified / game-verified / unverifiedの境界を拡張しない。
