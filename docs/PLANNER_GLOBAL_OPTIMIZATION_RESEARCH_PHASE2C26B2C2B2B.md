# Global Planner Research Phase 2-C2.6-B2-C2B2B（E1 ∩ L1 7 Targetを共通L1 extentで実Search）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Production default
extent、Search algorithm / ordering / comparator、P1は変更していない。E1のL2-needed 4 Target、E2 9 Target、K2 grouping、residual unreached 3件、
global assignment、Planner kernel統合、full Planner rerun、UI、timeout taskのretry / fallback、B2-C2B2A RESULTの再生成も行っていない。

- measurement HEAD: `a84357490cc23b14b383c30510bf5a55a3491b7c`（runnerがSearch開始前にstart attestationで記録。`measuredHeadSource = runner_start_attestation`）
- analysis HEAD: `01660483a2bdc5f642bc851990e11f7ccd2a1aeb`（measurement HEAD以後の変更はpost-hoc許可対象の `scripts/analyze-planner-global-phase2c26b2c2b2b.mjs` だけ。
  `calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json)（**`provenance.formal = true`**、
  `evidenceGrade = formal`、`partialRun = false`、`launchProvenanceVerified = true`、decision **`B2C2B2B_INCOMPLETE`**、invalid reason 0）

## 0. 最重要limitation

> **E1 population・L1 rungの割当（= 本Phaseのpopulation）・P1・L1 extentは、いずれも過去のoracle post-hoc評価（B2-C1 / B2-C2B1）の影響を受けている。**
> **一方、各Target内でどのcontextを何番目にSearchしたか、どのextentでSearchしたかに、Target個別のoracle情報は使っていない（全taskが同一のL1）。**

| provenance flag | 値 |
| --- | --- |
| `oracleGuidedPolicySelection` | `true`（P1はB2-C1でoracle coverageを見て選んだResearch候補） |
| `oracleGuidedTargetPopulation` | `true`（7件はB2-C2B1 cohort E1 ∩ `firstLadderRung = L1`。B2-C2B1がoracle required extentからpost-hocに割り当てた） |
| `oracleInformedCommonExtent` | `true`（L1はB2-C2B1がE1 cohortのrequired extentから登録したladder rung） |
| `commonExtentForEveryTask` / `perTargetExtent` | `true` / `false`（224 task全部が同一L1） |
| `targetIndividualOracleExtentAsSearchInput` | `false` |
| `contextOrderingUsesOracle` / `oracleReadBySearchChild` / `oracleMatchUsedForEarlyStop` | `false` / `false` / `false` |

本Phaseが示すのは「この実利用Exportで、B2-C2B1がL1-coveredとcharacterizeした7 Targetを共通L1 extentのままP1上位32 contextでSearchすると、
何が起きたか」まで。L1 / L2 ladder、Target個別required extentの利用、P1、context budget 32、どのcapture policyもProduction defaultとして
採用できるとは結論しない。

## 1. 結論

| 軸 | 値 | 意味 |
| --- | --- | --- |
| Search semantic decision | **`B2C2B2B_INCOMPLETE`**、`invalidReasons = []` | 事前登録rule。33 taskがtimeout（未計測）なので `ALL_*` へは昇格しない |
| evidence provenance grade | **`formal = true`**、`evidenceGrade = formal` | runner start attestationがSearch前に書かれ、独立に得た値と一致した（§3） |

INCOMPLETEの理由はtimeout 33 taskのみ（OOM 0、process failure 0、context mismatch 0、notRun 0）。timeoutはCandidate 0として扱っていない。

実測の観察（判定ではない）:

| | 値 |
| --- | --- |
| C8 / C32 / C4C exactに到達したTarget | **6 / 6 / 7（of 7）** |
| first exact rank = B2-C1 first compatible rank | **7 / 7**（delta 0。観測値で、Search選択条件ではない） |
| compatible context（計測分） | 24件、**24 / 24でC4C exact**（C8は23 / 24） |
| incompatible contextからのexact / partial（sentinel含む） | 0 / 0 |
| reservation violation | 0 |
| timeout 33 task | **33件ともreservation-incompatible context**（t00 1、t01 7、t04 13、t05 12） |

timeoutが無ければALL_C4Cに該当する到達状況だが、timeout taskの結果は不明なので事前登録ruleどおりINCOMPLETEとする。「incompatibleならexactを
出さない」は本Phaseで検証している契約（incompatibleからexactが出ればINVALID）を前提にした条件付き解釈にすぎない。

## 2. 方針

```text
B2-C2B1 RESULT（418166d2…、registered） + B2-C1 RESULT（04904faf…）
  -> parsePhase2C26B2C2B2AB2C2B1Authority() / parsePhase2C26B2C2AB2C1Authority()（B2-C2B2Aと同じauthority検証）
  -> phase2c26b2c2b2bPopulation(): B2-C2B2A E1 population（B2-C1 extentInsufficient ∧ k1Minimal = B2-C2B1 E1）のうち
       recorded firstLadderRung = L1 の7件。記録required extentがL1に収まること、L2-needed 4件は収まらないこと、
       ladder rung L1 = {8, 235, 256}、ladderCoverage L1 = 7 of 11 をfail-close確認
  -> phase2c26b2c2b2bTargetManifest(): Target ID 7件だけ（rank / digest / required extent / rung / oracle field無し）
       -> .local/PLANNER_GLOBAL_PHASE2C26B2C2B2B_TARGETS.json.local（SHA-256 72d34970…）
Search runner（Export + Target manifestのみ読む）
  -> start attestation（§3）を run dir へ書いてから
  -> tasks child: derivePhase2C26B2C1Schedule()（Production default extent）-> 各TargetのP1 rank 1..32
       -> reconstructPhase2C26B2B2AContext() -> phase2c26b2c2b2bL1Context(): extentだけをL1へ置換 -> 7 × 32 = 224 task
  -> Search child（taskごとにfresh process）: visitPlannerAlternativeCandidates() 無変更、共通L1、B2-C2A C4C capture無変更
analyzer（run終了後のみ）: oracle / 先行RESULTを読み、B2-C2B2Aと同じ比較関数でcompatibility / coverageを判定
```

Target IDはどのsourceにも書いていない（testで固定）。Search childはoracle RESULT / manifest・B2-C1 firstCompatible・B2-C2B1 required extent・
Targetのladder rung・B2-C2B2Aの結果を知らない。visitorの `'stop'` はsentinelとsafety capの2箇所だけ。

### 2.1 実行条件（実測前に登録、B2-C2B2Aとextent以外同一）

| 項目 | 値 |
| --- | --- |
| Targets / context budget / tasks | 7 / 32（P1 rank 1..32） / 224 |
| Search extent | **共通L1 `{ maxNormalAdvance: 8, maxGogmaAdvance: 235, maxSkillAdvance: 256 }`**（全task同一） |
| schedule extent | Production default `{ 4, 235, 4 }`（reservation universe・P1 ordering・digest不変） |
| capture | C4C（4 cost cohort完全drain + 5番目cost先頭sentinel、safety cap 1024）。C8 / C32はそのprefix |
| Stage 1 | fresh child / task、heap 8192 MB、**concurrency 1**、budget 10分、`setImmediate` yield、memory sampling 250 ms、retry / fallbackなし |
| 環境 | Node v24.19.0（Vite SSR loader、NOT a Browser Worker）、AMD Ryzen 7 9700X（16 logical）、32 GB |

synthetic worldでのparity test: 同じdelivery列に対しB2-C2B2A（L2）とB2-C2B2B（L1）のcapture recordはextentとそのdigest以外一致する（testで固定）。

## 3. runner start attestation（今回から）

PR #200（B2-C2B2A）では停止したrunnerがlaunch provenanceを永続化しておらず、RESULTをformalにできなかった。本Phaseでは:

| 項目 | 内容 |
| --- | --- |
| 作成者 / 時点 | parent runner自身。run dir作成直後、**tasks childを含むどのchild processよりも前** |
| 不変性 | `writeFile(..., { flag: 'wx' })`（既存fileを上書きしない）の後 `chmod 0o444`（read-only）。書いた直後に読み戻して一致確認、formal launchなら即verify |
| 内容 | `attestedBy: "runner"`、`createdAt`、`repositoryHead`、`uncommittedBenchmarkCode`、`benchmarkCodeSha256`、Export / Target manifest SHA-256、Target IDs、実際のStage 1、`smoke`、登録条件（context budget、Targets、expected tasks、extent / label、capture rule、safety cap、registered P1、yield、sampling） |
| 補助記録 | runnerは各childの `START` 行をlogに出し、終了したchildを `processes.jsonl` に追記する（exit code・wall・stderr tail・record SHA-256） |
| 検証 | `verifyPhase2C26B2C2B2BStartAttestation()`: attestedBy / phase / key集合、createdAt ≤ tasks child開始、HEAD・**measured HEADのgit objectから再計算したcode hash**・Export / manifest SHA-256（verifierが自分で読んだfile）・Target IDsとの一致、`uncommittedBenchmarkCode === false`、smokeなし、登録条件一致 |
| 分類 | 不一致は **integrity issue**（HEAD / hash / Export / manifest / Target / 作成者 / 時刻 / key）と **non-formal launch**（uncommitted / smoke / 条件差）に分ける。integrity issueがあるattestationはINVALID、non-formal launchはformalにならないだけ |

本formal runのattestation:

| field | 値 |
| --- | --- |
| file / SHA-256 | `start-attestation.json` / `b8ccded581bb74cbc8d9e818d709f25ff5c04836486796b57d3db607b2ffdeda`（read-only） |
| createdAt | 2026-10-02T23:20:47.779Z（tasks child START 23:20:47.809Z より前） |
| repositoryHead | `a84357490cc23b14b383c30510bf5a55a3491b7c` |
| uncommittedBenchmarkCode / smoke | `false` / `null` |
| benchmarkCodeSha256 | `18c44514cc98ee976df3420e52e0326cec8313e952a3cf2978615ec0b6d62c65`（analyzerがmeasured HEADのgit objectから再計算した値と一致） |
| exportSha256 / targetManifestSha256 | `cc35fb5b…` / `72d34970…`（analyzerが読んだfileと一致） |
| stage1 | 登録値と一致 |
| 検証結果 | `launchProvenanceVerified = true`、issues 0、integrity issues 0 |

### 3.1 interrupted run

runnerが完走しなくても、`scripts/reconstruct-planner-global-phase2c26b2c2b2b-partial-raw.mjs` がrun dir（attestation、task / record / memory、
`processes.jsonl`）とrunner logからrawを再構成できる（Searchは実行しない、run dirを書き換えない）。

- attestationがあれば必ず検証し、integrity issueはfail-close。non-formal launchの再構成は `--allow-nonformal` が必要で、formalにはならない
- attestationが無ければ `launchAttestation: null`、launch時Working Treeは `null`（不明）とし、formalへは昇格しない
- 途中停止でも、attestationが正しく検証できれば `partialRun = true` のままformalになり得る（Search semantic decisionはnotRunがあればINCOMPLETE）
- `--allow-nonformal` はnon-formal RESULTの書き出しを許すだけで、`formal` の算出には入らない（testで固定）

本Phaseのformal runは完走したため再構成は使っていない。再構成経路はnon-formal smoke（§4）で、親processを2 task終了後にkillした実例を
使って確認した（attestation検証 → `partialRun = true`、`evidenceGrade = diagnostic_partial`（smokeなのでnon-formal）、notRun 222はCandidate 0扱いなし）。

## 4. smokeと計測時の環境

- non-formal smoke 2回（`--allow-uncommitted`）: 3 task指定のsmokeと、prefix 4 taskを2 task終了後にkillしたinterruption smoke。配線と
  再構成経路の確認だけに使い、smoke結果を見て条件を変えていない
- smoke時、ホストでは別の動画エンコード（x265）がCPU 85〜90%を使っていた。runtime比較と10分timeoutが交絡するため、プロジェクトオーナー判断で
  **エンコード終了とCPUアイドル（負荷25%未満が1分継続）を待ってからformal runを開始**した（開始時負荷4〜11%）
- formal runはClaude Code sessionの外のdetached processで起動。2026-10-02T23:20:47Z〜2026-10-03T09:57:36Z（約10.6時間）

## 5. 実行結果

| | 件数 |
| --- | ---: |
| planned / started | 224 / 224 |
| completed | 191 |
| timeout（10分） | **33** |
| OOM / process failure / context mismatch / notRun | 0 / 0 / 0 / 0 |
| safety cap（capture 1024件、`captureComplete = false`） | 35 |

| Target | route | P1 first compatible | completed | timeout | timeout rank |
| --- | --- | ---: | ---: | ---: | --- |
| t00 `02876df4` | new Normal、`normal_artian_to_gogma`、7 ops | 8 | 31 | 1 | 10 |
| t01 `05e6b206` | owned Gogma、`existing_gogma_mixed`、3 ops | 3 | 25 | 7 | 11, 12, 26〜30 |
| t02 `a6c17e25` | owned Gogma、mixed、3 ops | 32 | 32 | 0 | — |
| t03 `b27e57a7` | owned Gogma、mixed、2 ops | 31 | 32 | 0 | — |
| t04 `b6780f04` | owned Gogma、mixed、2 ops | 14 | 19 | 13 | 2, 8, 11〜13, 15, 25〜30, 32 |
| t05 `e4147de7` | owned Gogma、mixed、2 ops | 31 | 20 | 12 | 2, 9, 11〜14, 25〜30 |
| t06 `e523209e` | owned Gogma、mixed、3 ops | 2 | 32 | 0 | — |

runtime / memory（GBは10^9 bytes）:

| | min | median | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Search elapsed（completed 191） | 0.1 s | 26.3 s | 334 s | 434 s | 580 s |
| child process wall（224） | 5.8 s | 44.5 s | 600 s | 600 s | 600 s（timeout） |
| peak heap | 0.29 GB | 1.50 GB | 4.28 GB | 4.91 GB | **5.07 GB** |
| peak RSS | 0.71 GB | 1.79 GB | 4.88 GB | 5.41 GB | 6.09 GB |
| yields（completed） | 253 | 123,668 | 2,300,996 | 2,726,391 | 3,791,119 |

child process wall合計 38,201 s（10.6時間、concurrency 1）。Target別wall合計: t00 4,937 s、t01 6,066 s、t02 1,033 s、t03 4,312 s、t04 9,953 s、
t05 10,259 s、t06 1,641 s。peak heapはどのTargetも5.1 GB以下で、heap上限8 GBに届いたtaskは無い。

## 6. oracle comparison（post-hoc）

| Target | B2-C1 first compatible | compatible ranks | C8 | C32 | C4C | Candidate index | cost |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| t00 `02876df4` | 8 | 8, 13, 31 | 8 | 8 | 8 | 0 | 7 |
| t01 `05e6b206` | 3 | 3, 5, 9, 14, 17, 18, 32 | 3 | 3 | 3 | 0 | 3 |
| t02 `a6c17e25` | 32 | 32 | — | — | **32** | **84** | 3 |
| t03 `b27e57a7` | 31 | 31 | 31 | 31 | 31 | 0 | 2 |
| t04 `b6780f04` | 14 | 14, 31 | 14 | 14 | 14 | 1 | 2 |
| t05 `e4147de7` | 31 | 31 | 31 | 31 | 31 | 0 | 2 |
| t06 `e523209e` | 2 | 2, 3, 4, 5, 9, 14, 17, 18, 32 | 2 | 2 | 2 | 0 | 3 |

- **first exact rank = first compatible rank は7 / 7で成立**（B2-C2A / B2-C2B2Aと同じ観察。selection条件にはしていない）
- compatible contextは24件で、24件すべてにC4C exactがあった（partialだけのcompatible contextは0）
- t02だけC8 / C32ではmissし、C4Cで回収した。rank 32のcompatible contextはsafety capで止まったが（cost 3〜の大きなequal-cost cohort）、
  exactは最初の4 cohort内のindex 84にある。cascadeは C8 6、C32 miss→C4C 1、C4C miss 0
- context budget別exact Target数: C8 / C32 は top1 0、top2 1、top4 2、top8 3、top16 4、top32 6、C4Cはtop32で7
- first compatible rankのparity: B2-C1 RESULT・B2-C2B1 RESULT・analyzerの再計算が7 / 7で一致

Candidate distribution（計測した191 context）: delivered 60,268 / captured 60,114（sentinel 154）、termination four_cost_cohorts_drained 154・
candidate_safety_cap 35・stopped_by_extent 2、route kind `normal_artian_to_gogma` 38,419・`existing_gogma_mixed` 21,695、held Route 59,376、
unique stable keys合計 35,862。

## 7. B2-C2B2A（共通L2）とのresource比較（post-hoc diagnostic）

**診断のみ。decision条件・Production判断には使わない。** B2-C2B2Aはnon-formal diagnostic partial evidenceで、intentional stopにより実行済みは
t00 32 context・t01 rank 1..12だけ。両Phaseで開始された44 context（Target・P1 rank一致、reservation digest・default Search input digest一致を確認）を比べる。

| 44 common contexts | B2-C2B2A L2 | B2-C2B2B L1 |
| --- | ---: | ---: |
| completed / timeout / OOM | 35 / 7 / 2 | **41 / 3 / 0** |
| safety cap（completed中） | 14 | 16 |
| Search elapsed median / p90 / max（completed） | 43.9 / 460 / 570 s | 24.5 / 371 / 485 s |
| child wall合計 | 9,046 s | 6,405 s |
| peak heap median / max | 2.37 / **8.51 GB** | 1.36 / **5.07 GB** |
| peak RSS median / max | 2.65 / 8.86 GB | 1.63 / 5.42 GB |
| yields median | 240,656 | 199,210 |
| C4C exactのcontext | 6 | 6 |

- process遷移: completed→completed 35、**timeout→completed 4**、**OOM→completed 2**、timeout→timeout 3。completed→失敗は0
- 両方completedの35 context: Search elapsed比（L1/L2）の中央値0.64、合計比0.59、peak heap比中央値0.78、RSS比中央値0.82。terminationは35 / 35一致、
  captured Candidate数は34 / 35一致（t01-r10のみ65→64）
- **t00**: B2-C2B2A L2では32 contextで **completed 25 / timeout 5 / OOM 2**、L1では **completed 31 / timeout 1（rank 10）/ OOM 0**。L2でtimeoutだった
  rank 11 / 25 / 26 / 27はL1で完走（340〜491 s）、OOMだったrank 17 / 24はL1で47 s / 15 s。rank 10はL1でもtimeout（heap 4.8 GB）
- t01 rank 1..12: L2・L1とも completed 10 / timeout 2（rank 11・12）

## 8. 「L1でcoverされるTargetにはL2を適用しない」ladder構成について（Research上の評価）

- B2-C2B1でL1-coveredとcharacterizeされた7件は、共通L1のまま **7 / 7がC4C exact、6 / 7がC8 exact** に到達し、L1で足りないTargetは無かった
- 共通部分44 contextでは、L1は失敗taskを9→3に減らし、OOMを無くし、peak heapを最大8.5 GB→5.1 GBに下げた
- したがって「L1でcoverされるTargetにL2を一律適用しない」構成は、このExport・このpopulationについて、semantic回収を落とさずresource failureを
  減らす方向のResearch evidenceになる
- ただし、L1でもincompatible contextのtimeoutが33件残った（t01・t04・t05のowned Gogma mixedに集中）。timeoutの中身は不明で、
  このladderで「全context完走」には至っていない
- populationとrung割当自体がoracle post-hoc characterizationに依存しており（§0）、Production上でTargetのrungを事前に知る手段は本Phaseの範囲外。
  ProductionでL1 / L2 ladderやTarget個別required extentを採用してよいとは結論しない

## 9. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C2B1 RESULT | `418166d2a7ff40145d8650f418c025783f9b5039673ee19e722bab4836b22eae`（formal、`B2C2B1_CHARACTERIZED`） |
| B2-C1 RESULT | `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac` |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d` |
| B2-C2B2A RESULT（diagnosticのみ） | `735933961df65fcc73677c1aaf7279f2671ac583bb9c5d06de8ec05523947d70`（non-formal diagnostic partial、L2） |
| oracle RESULT / manifest | `be51e7cd…` / file `c8b240f6…`、Routes `ffb6db5a…` |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` |
| Target manifest | `72d3497074ec1e11a2e1fbf1b0de6fbf95fe5ed6b203bd255a2e5288f88c62be` |
| raw run | `PLANNER_GLOBAL_PHASE2C26B2C2B2B_RAW.json.local`、SHA-256 `ff947a6284dfdf513f20e907e8e189de0ffaab95cd5a725c6bec6bb5e18928ff`（.local、未commit） |

hashChain 23項目すべてtrue。schedule parity（224 taskが再導出scheduleと完全一致、contexts / origin digest、schedule extent = Production default、
全taskが共通L1、Target個別extentなし、CalculationContext・RNG Engine `production-rng:c5-e7` 一致、各TargetがP1 rank 1..32）すべてtrue。
population parity（manifest = E1 ∩ L1、全Target first rung L1、E2 / defaultExtent / unreachedとの重複0）true。

## 10. 未検証事項・limitation

- timeout 33 taskの結果（Candidate有無、exact有無）は不明。すべてincompatible contextで、exactを出さないという読みは条件付き解釈
- B2-C2B2A比較はnon-formal partial evidence（44 context）との比較で、両Phaseの計測時刻・ホスト状態は同一ではない（B2-C2B2A計測時の背景負荷は記録が無い）
- Node / Vite SSRでの計測で、Browser Workerの計測ではない。concurrency 1
- Production RNG・Search・Plannerの挙動は変更していない。新しいRNG挙動は導入していない

## 11. 次Phase候補（本PRでは実行しない、レビュー後に決める）

- timeout 33 task（incompatible context）の長時間再測定、またはincompatible contextでのresource consumptionの原因調査
- E1のL2-needed 4 TargetをL2でSearch（本Phaseのattestation付きrunnerで）
- E2 9 Target（K2-minimal）のTarget-relative K2 feature / grouping研究
- Production上でrungを事前に決める（oracleに依存しない）手段の研究
