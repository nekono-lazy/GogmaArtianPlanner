# Global Planner Research Phase 2-C2.6-B2-C2B2C（E1 ∩ L2 4 Targetを共通L2 extentで実Search）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Production default
extent、Search algorithm / ordering / comparator、P1は変更していない。B2-C2B2B timeout 33 taskのretry、incompatible context性能最適化、
Search runtime最適化、E2 9 Target、K2 grouping、residual unreached 3件、Production rung selector、global assignment、Planner kernel統合、
full Planner rerun、UI、B2-C2B2A / B2-C2B2B RESULTの再生成は行っていない。

- measurement HEAD: `eb42e750041ee6bd2a2da51eaea02d15635757dc`（runnerがSearch開始前にstart attestationで記録。`measuredHeadSource = runner_start_attestation`）
- analysis HEAD: `eb42e750041ee6bd2a2da51eaea02d15635757dc`（analyzerはmeasurement HEADそのままで実行。`codeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json)（**`provenance.formal = true`**、
  `evidenceGrade = formal`、`partialRun = false`、`launchProvenanceVerified = true`、decision **`B2C2B2C_INCOMPLETE`**、invalid reason 0）

## 0. 最重要limitation

> **E1 population・L2 rungの割当（= 本Phaseのpopulation）・P1・L2 extentは、いずれも過去のoracle post-hoc評価（B2-C1 / B2-C2B1）の影響を受けている。**
> **一方、各Target内でどのcontextを何番目にSearchしたか、どのextentでSearchしたかに、Target個別のoracle情報は使っていない（全taskが同一のL2）。**

| provenance flag | 値 |
| --- | --- |
| `oracleGuidedPolicySelection` | `true`（P1はB2-C1でoracle coverageを見て選んだResearch候補） |
| `oracleGuidedTargetPopulation` | `true`（4件はB2-C2B1 cohort E1 ∩ `firstLadderRung = L2`。B2-C2B1がoracle required extentからpost-hocに割り当てた） |
| `oracleInformedCommonExtent` | `true`（L2はB2-C2B1がE1 cohortのrequired extentから登録したladder rung。B2-C2B2Aと同一extent） |
| `commonExtentForEveryTask` / `perTargetExtent` | `true` / `false`（128 task全部が同一L2） |
| `targetIndividualOracleExtentAsSearchInput` | `false` |
| `contextOrderingUsesOracle` / `oracleReadBySearchChild` / `oracleMatchUsedForEarlyStop` | `false` / `false` / `false` |

本Phaseが示すのは「この実利用Exportで、B2-C2B1がL2-neededとcharacterizeした4 Targetを共通L2 extentのままP1上位32 contextでSearchすると、
何が起きたか」まで。L1 / L2 ladder、oracleなしのrung判定、Target個別required extentの利用、P1、context budget 32、どのcapture policyも
Production defaultとして採用できるとは結論しない。

## 1. 結論

Search decisionとroute recoveryを別軸で示す（route recoveryはdecision inputではない）。

| 軸 | 値 | 意味 |
| --- | --- | --- |
| Search semantic decision | **`B2C2B2C_INCOMPLETE`**、`invalidReasons = []` | 事前登録rule。110 taskが未計測（timeout 108 / OOM 2）なので `ALL_*` へは昇格しない |
| evidence provenance grade | **`formal = true`**、`evidenceGrade = formal`、`partialRun = false` | runner start attestationがSearch前に書かれ、独立に得た値と一致した（§3） |
| measurement completeness | **`incomplete`**: measured 18 / 128（timeout 108、OOM 2、process failure 0、context mismatch 0、notRun 0） | |
| route recovery（4 Target中） | **C8 1 / C32 1 / C4C 2** | 未計測taskはCandidate 0扱いしない。数値は下限（`recoveryIsLowerBound = true`） |

実測の観察（判定ではない）:

| | 値 |
| --- | --- |
| first exact rank = B2-C1 first compatible rank | **2 / 2**（回収した2件ともdelta 0。観測値で、Search選択条件ではない） |
| compatible context（15件） | 計測できたのは2件（2件ともC4C exact）、**残り13件は未計測**（timeout 12、OOM 1） |
| incompatible contextからのexact / partial（sentinel含む） | 0 / 0（計測16件） |
| reservation violation | 0 |
| 未回収2 Target | **どちらもcompatible contextが1件も計測できていない**（`missClass = unmeasured`）。Route不存在・Search non-deliveryとは結論しない |

### 1.1 E1全体のladder集計（post-hoc、Research-level）

B2-C2B2B RESULT（`2066506…`、formal、`B2C2B2B_INCOMPLETE`）をpredecessor authorityとして読み、再実行はしていない。

| rung | population | extent | decision | measurement | C8 | C32 | C4C |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: |
| L1（B2-C2B2B） | 7 | `{8, 235, 256}` | `B2C2B2B_INCOMPLETE` | incomplete（191 / 224、timeout 33） | 6 / 7 | 6 / 7 | **7 / 7** |
| L2（本Phase） | 4 | `{128, 235, 1500}` | `B2C2B2C_INCOMPLETE` | incomplete（18 / 128、timeout 108、OOM 2） | 1 / 4 | 1 / 4 | **2 / 4** |
| **E1 total** | **11** | | | | 7 / 11 | 7 / 11 | **9 / 11** |

C4C 9 / 11 で、未回収2件はいずれもL2 rungで計測できなかったTarget。したがって
**「E1 11 / 11 routes rediscovered under the registered Research ladder」というstatementは出さない**（`e1Ladder.statement = null`）。
first exact = first compatible はE1回収9件のすべて（L1 7 / 7、L2 2 / 2）で成立。

ladder集計のlimitation（RESULT `e1Ladder.limitations`）:

- rung割当はB2-C2B1がoracle required extentからpost-hocに決めたもので、Productionでoracleなしにrungを判定できることは示していない
- L1 / L2 ladder・P1・budget 32・C4CはResearch条件で、Productionでladderを採用できることも別Exportへの一般化も示していない
- 回収とは「既存SearchがP1 rank ≤ 32のどこかで計測できたcontextにexact oracle Routeをdeliverした」ことで、Planner trial・kernel・full Planner rerun・global assignmentは走らせていない
- 両rungとも未計測task（timeout / OOM / notRun）は不明で、Candidate 0ではない

## 2. 方針

```text
B2-C2B1 RESULT（418166d2…、registered） + B2-C1 RESULT（04904faf…） + B2-C2B2B RESULT（2066506…、registered formal）
  -> parsePhase2C26B2C2B2AB2C2B1Authority() / parsePhase2C26B2C2AB2C1Authority() / parsePhase2C26B2C2B2CB2C2B2BAuthority()
  -> phase2c26b2c2b2cPopulation():
       B2-C2B2B population関数（E1 = B2-C1 extentInsufficient ∧ k1Minimal、L1 fit / L2-neededはL1に収まらない）をそのまま通し、
       recorded firstLadderRung = L2 の4件。記録required extentがL2に収まりL1に収まらないこと、ladder rung L2 = {128, 235, 1500}、
       ladderCoverage L2 = 11 of 11、firstRungHistogram L1 7 / L2 4、
       E1 ∩ L1 = B2-C2B2B RESULTのTarget 7件、E1 ∩ L2 = 4、overlap 0、union = E1 11 をfail-close確認
  -> phase2c26b2c2b2cTargetManifest(): Target ID 4件だけ（rank / digest / required extent / rung / oracle field無し）
       -> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2C_TARGETS.json.local（SHA-256 83ab341f…）
Search runner（Export + Target manifestのみ読む）
  -> start attestation（§3）を run dir へ書いてから
  -> tasks child: derivePhase2C26B2C1Schedule()（Production default extent）-> 各TargetのP1 rank 1..32
       -> B2-C2B2Aの buildPhase2C26B2C2B2ATasks()（reconstructPhase2C26B2B2AContext() -> phase2c26b2c2b2aL2Context()）-> 4 × 32 = 128 task
  -> Search child（taskごとにfresh process）: B2-C2B2Aの runPhase2C26B2C2B2ATask() / runPhase2C26B2C2B2ASearch() 無変更
       （visitPlannerAlternativeCandidates() 無変更、共通L2、B2-C2A C4C capture無変更）
analyzer（run終了後のみ）: oracle / 先行RESULTを読み、B2-C2B2Aと同じ比較関数でcompatibility / coverageを判定
```

Search側はB2-C2B2AのL2 Search関数そのもの（同一関数をre-exportし、testで `toBe` 同一性を固定）。Target IDはどのsourceにも書いていない
（testで固定）。Search childはoracle RESULT / manifest・B2-C1 firstCompatible・B2-C2B1 required extent・Targetのladder rung・
B2-C2B2A / B2-C2B2Bの結果を知らない。visitorの `'stop'` はB2-C2B2A Search内のsentinelとsafety capの2箇所だけ。

### 2.1 実行条件（実測前に登録、B2-C2B2Bとpopulation / extent以外同一）

| 項目 | 値 |
| --- | --- |
| Targets / context budget / tasks | 4 / 32（P1 rank 1..32） / 128 |
| Search extent | **共通L2 `{ maxNormalAdvance: 128, maxGogmaAdvance: 235, maxSkillAdvance: 1500 }`**（全task同一、B2-C2B2Aと同一object） |
| schedule extent | Production default `{ 4, 235, 4 }`（reservation universe・P1 ordering・digest不変） |
| capture | C4C（4 cost cohort完全drain + 5番目cost先頭sentinel、safety cap 1024）。C8 / C32はそのprefix |
| Stage 1 | fresh child / task、heap 8192 MB、**concurrency 1**、budget 10分、`setImmediate` yield、memory sampling 250 ms、retry / fallbackなし |
| 環境 | Node v24.19.0（Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |

## 3. runner start attestation

B2-C2B2Bの契約をそのまま本Phase用に登録した（phase marker `Issue #154 Phase 2-C2.6-B2-C2B2C runner start attestation`、登録条件はL2 / 4 Target / 128 task。
B2-C2B2Bのattestationを持ち込むとintegrity issueになる）。

| field | 値 |
| --- | --- |
| file / SHA-256 | `start-attestation.json` / `0dde2cf76b9b1c2a1c2e46004f9ccbf9f357c6a1e02e8ce5f84de20b7ba5f517`（`wx` で作成後 read-only） |
| createdAt | 2026-10-03T14:40:39.415Z（tasks child START 14:40:39.452Z より前） |
| repositoryHead | `eb42e750041ee6bd2a2da51eaea02d15635757dc`（起動時Working Tree clean） |
| uncommittedBenchmarkCode / smoke | `false` / `null` |
| benchmarkCodeSha256 | `dde0731d662e2d3775ec136cbf3ce6f084593664983fb3c35a3be079ede63eae`（analyzerがmeasured HEADのgit objectから再計算した値と一致） |
| exportSha256 / targetManifestSha256 | `cc35fb5b…` / `83ab341f…`（analyzerが読んだfileと一致） |
| stage1 / extent / targets / expectedTasks | 登録値と一致 |
| 検証結果 | runner起動時に即verify、analyzerでも `launchProvenanceVerified = true`、issues 0、integrity issues 0 |

runnerは各childの `START` 行をlogに出し、終了childを `processes.jsonl` に追記した。formal runは完走したため途中停止runの再構成
（`scripts/reconstruct-planner-global-phase2c26b2c2b2c-partial-raw.mjs`）は使っていない。再構成経路はnon-formal smoke（§4）で確認した。

途中停止は「OOMが3連続」またはhostのresource safetyなどoperational reasonでのみchild境界で行うと決めていたが、OOMは2件（非連続）で
条件に達せず、停止していない。

## 4. smokeと計測時の環境

- non-formal smoke 2回（`--allow-uncommitted`）。1回目は2 task指定（budget 2分）でrunner・analyzerの配線確認。2回目はprefix 3 taskの
  runを1 task終了後に親processごとkillし、再構成scriptが `--allow-nonformal` なしでfail-close、ありで再構成でき、analyzerが
  `partialRun = true` / `evidenceGrade = diagnostic_partial` / notRun 127（Candidate 0扱いなし）とすることを確認した。smoke結果を見て条件は変えていない
- formal run開始前: Working Tree clean、CPU負荷3〜5%、空きメモリ約16 GB、他の計測processなし
- formal runはsessionから切り離したprocessで起動。2026-10-03T14:40:39Z〜2026-10-04T09:26:12Z（約18.8時間）

## 5. 実行結果

| | 件数 |
| --- | ---: |
| planned / started | 128 / 128 |
| completed | 18 |
| timeout（10分） | **108** |
| OOM | **2** |
| process failure / context mismatch / notRun | 0 / 0 / 0 |
| safety cap（capture 1024件、`captureComplete = false`） | 2 |

| Target | B2-C2B1 Route（required Normal / Gogma / Skill） | P1 first compatible | completed | timeout | OOM |
| --- | --- | ---: | ---: | ---: | ---: |
| t00 `070a1222` | new Normal、`normal_artian_to_gogma`、128 ops（126 / 23 / 450） | 17 | 4（rank 1, 6, 7, 24） | 26 | 2（rank 17, 20） |
| t01 `188571a7` | owned Gogma、mixed、2 ops（— / 17 / 446） | 18 | 7（rank 1, 6, 7, 18, 21, 22, 24） | 25 | 0 |
| t02 `a367c177` | owned Gogma、mixed、1,084 ops（— / 59 / 1,083） | 11 | 2（rank 1, 8） | 30 | 0 |
| t03 `d453ca34` | owned Gogma、mixed、2 ops（— / 22 / 547） | 18 | 5（rank 1, 6, 7, 18, 21） | 27 | 0 |

runtime / memory（GBは10^9 bytes）:

| | min | median | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Search elapsed（completed 18） | 2.2 s | 58.2 s | 202 s | 243 s | 243 s |
| child process wall（128） | 7.8 s | 600 s（timeout） | 600 s | 601 s | 601 s |
| peak heap（128） | 0.40 GB | 3.42 GB | 5.98 GB | 6.57 GB | **8.32 GB** |
| peak RSS（128） | 0.73 GB | 3.94 GB | 8.19 GB | 8.77 GB | 8.99 GB |
| yields（completed） | 56,624 | 101,763 | 4,253,585 | 4,291,579 | 4,291,579 |

child process wall合計 67,525 s（18.8時間、concurrency 1）。Target別wall合計: t00 17,017 s、t01 15,401 s、t02 18,286 s、t03 16,822 s。
OOMはt00のrank 17（476 s、peak heap 8.32 GB）とrank 20（538 s、7.07 GB）。heap上限8 GB付近まで使ったtaskは他にもあり（timeout taskのpeak heap最大 7.85 GB）、
L2はこのpopulationでresource-heavy。

## 6. oracle comparison（post-hoc）

| Target | B2-C1 first compatible | compatible ranks（P1 ≤ 32） | 計測状況 | C8 | C32 | C4C | Candidate index | cost |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| t00 `070a1222` | 17 | 17 | rank 17 **OOM** | — | — | — | — | — |
| t01 `188571a7` | 18 | 18 | rank 18 completed（480件、4 cohort drain） | 18 | 18 | **18** | 2 | 2 |
| t02 `a367c177` | 11 | 11, 12, 13, 15, 16, 18, 25〜28, 30, 32 | **12件すべてtimeout** | — | — | — | — | — |
| t03 `d453ca34` | 18 | 18 | rank 18 completed（**safety cap 1024**、cost 2 / 3） | — | — | **18** | 50 | 2 |

- **first exact rank = first compatible rank は回収2 / 2で成立**（B2-C2A / B2-C2B2A / B2-C2B2Bと同じ観察。selection条件にはしていない）
- t01はC8でexact（index 2）。t03はC8 / C32ではmissしC4Cで回収（rank 18のcaptureはsafety capで止まったが、exactはindex 50で最初のcohort内）。
  cascadeは C8 1、C32 miss→C4C 1、C4C miss 2（2件とも `unmeasured`）
- t00のcompatible contextはrank 17の1件だけで、それがOOM。t02は12件のcompatible contextがすべて10分timeout。どちらもexact有無は不明
  （t00のB2-C2B1 Routeは128 ops / Normal 126、t02は1,084 ops / Skill 1,083で、どちらも深いRoute）
- 計測できたincompatible context 16件からexact / partialは0
- first compatible rankのparity: B2-C1 RESULT・B2-C2B1 RESULT・analyzerの再計算が4 / 4で一致

Candidate distribution（計測した18 context）: delivered 4,556 / captured 4,541（sentinel 15）、termination four_cost_cohorts_drained 15・
candidate_safety_cap 2・stopped_by_extent 1、route kind `existing_gogma_mixed` 2,761・`normal_artian_to_gogma` 1,780、held Route 4,252、
unique stable keys合計 4,349。

## 7. B2-C2B2B（L1 population）とのresource比較（post-hoc diagnostic）

**診断のみ。decision条件・Production判断には使わない。** populationが異なる（共通contextは無い）ため、同一contextの比較ではない。
B2-C2B2AのL2 runはt00 `02876df4`・t01 `05e6b206`（いずれもL1 population）しか開始しておらず、本Phaseの4 Targetとの共通contextも無い。

| | B2-C2B2B（L1 7 Target、224 task） | B2-C2B2C（L2 4 Target、128 task） |
| --- | ---: | ---: |
| completed 割合 | 191 / 224（85%） | 18 / 128（14%） |
| timeout / OOM | 33 / 0 | 108 / 2 |
| child wall median | 44.5 s | 600 s（timeout） |
| peak heap median / max | 1.50 / 5.07 GB | 3.42 / 8.32 GB |
| wall合計 | 10.6時間 | 18.8時間 |

L2-needed populationを共通L2でSearchすると、多くのcontextが10分以内に4 cost cohortをdrainできず、資源上限付近まで使う。
これはextentの差・Targetの差・contextの差が交絡した観察で、原因の切り分けはしていない。

## 8. 「L1 7 + L2 4」ladder構成について（Research上の評価）

- L1 rungの7件（B2-C2B2B）は7 / 7をC4Cで回収した。L2 rungの4件は、計測できたcompatible contextでは2 / 2を回収したが、残り2件は
  compatible contextが計測不能（OOM / timeout）で、回収の有無が分からない
- したがってE1全体は **C4C 9 / 11（未計測2）** で、「registered Research ladderの下でE1 11 / 11を再発見」とは言えない
- L2 rungではrouteの探索自体より先に、10分budget・8 GB heapという実行条件が回収を制約している。未回収2件はB2-C2B1 Routeが深い
  （128 ops / 1,084 ops）Targetで、L2でのSearchがcompatible contextに到達しても完了しない
- populationとrung割当自体がoracle post-hoc characterizationに依存しており（§0）、Production上でTargetのrungを事前に知る手段は本Phaseの範囲外。
  ProductionでL1 / L2 ladderやTarget個別required extentを採用してよいとは結論しない

## 9. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B1 RESULT | `418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae`（formal、`B2C2B1_CHARACTERIZED`） |
| B2-C1 RESULT | `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac` |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d` |
| B2-C2B2B RESULT（predecessor、L1 rung） | `2066506462159ae7d7045268e2d5c670de2ec157322265f970786c5ad29684c9`（formal、`B2C2B2B_INCOMPLETE`、measured HEAD `a8435749…`） |
| oracle RESULT / manifest | `be51e7cd…` / file `c8b240f6…`、Routes `ffb6db5a…` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| Target manifest | `83ab341f72a37922962c35e1af6931c90dc72876a9783328fd52098e4eb2ebff` |
| raw run | `PLANNER_GLOBAL_PHASE2C26B2C2B2C_RAW.json.local`、SHA-256 `b385b21f47dcd6a98105f0b4b8191b5857d23dbe6682780bec4f2dc8973ca065`（.local、未commit） |

hashChain 25項目（B2-C2B2B registered・B2-C2B2B ↔ B2-C2B1・Export ↔ B2-C2B2Bを含む）すべてtrue。schedule parity（128 taskが再導出scheduleと完全一致、
contexts / origin digest、schedule extent = Production default、全taskが共通L2、Target個別extentなし、CalculationContext・RNG Engine `production-rng:c5-e7` 一致、
各TargetがP1 rank 1..32）すべてtrue。population parity（manifest = E1 ∩ L2、split L1 7 / L2 4 / overlap 0 / union 11、E1 ∩ L1 = B2-C2B2B Target、
全Target first rung L2、B2-C2B2B / E2 / defaultExtent / unreachedとの重複0）true。

## 10. 未検証事項・limitation

- timeout 108 task・OOM 2 taskの結果（Candidate有無、exact有無）は不明。とくにt00 rank 17（OOM）とt02のcompatible 12 context（timeout）は
  未回収2 Targetのexact有無を左右する
- 回収数（C4C 2 / 4、E1 9 / 11）は下限で、未計測taskがあるため上限は分からない
- B2-C2B2Bとのresource比較はpopulationが異なる診断値で、同一contextの比較ではない
- Node / Vite SSRでの計測で、Browser Workerの計測ではない。concurrency 1
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない

## 11. 次Phase候補（本PRでは実行しない、レビュー後に決める）

- 未回収2 Targetのcompatible context（t00 rank 17、t02 rank 11ほか）に限らない、L2 timeout / OOM taskの長時間・高heap再測定（retry条件は別途登録）
- L2でのresource explosion（深いSkill / Normal Routeのcontext）の原因調査、またはSearch runtime最適化の研究
- E2 9 Target（K2-minimal）のTarget-relative K2 feature / grouping研究
- Production上でrungを事前に決める（oracleに依存しない）手段の研究
