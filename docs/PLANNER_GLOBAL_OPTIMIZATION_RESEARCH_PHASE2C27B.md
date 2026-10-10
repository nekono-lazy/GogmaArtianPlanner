# Global Planner Research Phase 2-C2.7-B（E1 11 Target oracle-free execution formal measurement）

Refs #154。Research only。基準main: PR #212 merged `e696ef46e1a01f18aa0bf3039463d036e412ef26`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなしを確認）。

authorityは `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C27A.md`（SHA-256 `b45daa27…4147`、§2〜§7、§9の事前登録）である。本Phaseは新しい
policyを作らず、Phase Aの事前登録を **oracleをscheduler / Search / trial / calculationの実行入力に入れずに** E1 11 Targetへ実行し、oracle exact
Routeの回収をformal run後にpost-hoc analyzerだけで判定する。

Production source、Search algorithm / ordering / comparator、Planner scheduler、Planner Alternative kernel、Worker protocol、UI、Persistence、RNG、
schema / version、`defaultPlannerAlternativeSearchExtent`、Candidate Search default、`maxCandidateTrialsPerTarget`、`maxPlannerReruns`、
`defaultPlannerOptions`、`conflictResolutionPlannerOptions`、B2-C2B2I / B2-C2B2J optimizationは変更しない（Production source changed files = `[]`）。

## 1. 事前登録（measurement HEAD、formal run開始前に固定）

本節はformal run開始前にcommitしたmeasurement HEAD（`b24bf5dc`）の内容であり、run後に変更していない。Phase A §9.1の「Phase B固有の実装値」に当たるものと、
Phase Aの規則を既存部品で表現するための実装上の決定をここに固定する。

### 1.1 対象・context・extent・budget（Phase Aのまま）

| 項目 | 値 | 実装 |
| --- | --- | --- |
| population | E1 11 Target。B2-C2B1 RESULT（`418166d2…`）のcohort E1をB2-C1 RESULT（`04904faf…`）と照合して機械導出（`phase2c27bPopulation()`、B2-C2B2Aの既存parser / ruleを再利用）。`oracleGuidedTargetPopulation = true` | `plannerGlobalPhase2C27BTargets.ts`、`scripts/prepare-planner-global-phase2c27b-targets.mjs` |
| manifest | key は `phase` / `population` / `b2c2b1ResultSha256` / `b2c1ResultSha256` / `exportSha256` / `oracleGuidedTargetPopulation` / `targetWeaponIds` のみ。rank・rung・required extent・context・stable key等を載せるとparserがfail closed | `parsePhase2C27BTargetManifest()` |
| context | P1 `default_simple_first`（B2-C1と同一定義）。各Targetで eligible minimum cardinality ≤ 1 の全context = P1 rank 1..43（K0 1 + K1 42、Exportの構造事実として登録し、異なればfail closed）。P1上位32、K2は使わない | `buildPhase2C27BTargetPlans()` |
| support Entry | 各contextのrepresentative alias（B2-C1のrepresentative fixed set、最小cardinalityの最初のaliasをID順）のEntry。reservationは `derivePlannerAlternativeReservation()` でchild内で再導出し、B2-B1 snapshotのgroup reservationと一致しなければcontext mismatch | `phase2c27bResolveSupportContext()` |
| extent ladder | L0 `{4, 235, 4}` / L1 `{8, 235, 256}` / L2 `{128, 235, 1500}`（全Target / context共通） | `PHASE2C27B_LADDER` |
| scheduler | Target順はmanifest順（ID昇順）、各Target内はrung-major。上位rungへ進むのは `stopped_by_search_extent_bound` のcontextだけ。checkpoint hard-constraint Targetはunitを実行せず停止 | `createPhase2C27BTargetScheduler()` |
| trial / rerun budget | Production値 2 / 8を、同一 (Target, context) のL0→L1→L2全体で累積共有（rungごとにresetしない）。ladder state（`candidateTrialsUsed` / `plannerRerunsUsed` / `previouslyRejectedCandidateStableKeys`）をunit taskで子へ渡し、終了時stateを記録 | `Phase2C27BLadderState`、`createPhase2C27BLadderRerunBudget()` |
| Planner option | `researchMaxPlanSteps = 20000`（§1 C） | `PHASE2C27B_RESEARCH_MAX_PLAN_STEPS` |

### 1.2 execution envelope（Phase B固有の登録値）

| 項目 | 値 |
| --- | --- |
| unitごとのwall-clock上限 | 60分（親が判定し、超過はtimeout = unmeasured） |
| child heap上限 | 12,288 MB（`--max-old-space-size`） |
| concurrency | 1 |
| retry / fallback | なし / なし |
| provenance | `oracleInformedExecutionEnvelope = true`（60分はB2-C2B2KのSearch所要時間約3,375 sを見て選んだ） |

envelopeは全Target / context / rungで共通であり、Target別に変えない。timeout / OOMが出ても条件を変えて再実行しない。

### 1.3 `found_R`（Phase A §6.4）を既存Production部品で表す方法

Production kernel（`runPreparedPlannerAlternativeKernel()`）は `decision: PlannerConflictResolution` を必須とし、それをmergeしたPlannerInputで
trialするので、speculative support contextに使うとG1（supportをresolutionへ偽装しない）に反する。そこでkernel本体は使わず、kernelのtrial loopと
同じ順序・同じ部品をResearch harnessで組み合わせる（Production sourceは変更しない）。

```text
baseline PlannerInput（Exportから、conflictResolutions = []、options.maxPlanSteps = 20000）
  -> visitPlannerAlternativeCandidates({ origin, Target, rungのextent, supportのreservation, excludedRouteKeys = [現在Route] })
  -> 各delivered Candidate（kernelと同じ順）:
       previouslyRejected に含まれる      -> skip（budget消費なし、skippedPreviouslyRejectedに記録）
       累積trial = 2                     -> stopped_by_candidate_trial_bound
       累積full run = 8                  -> stopped_by_planner_rerun_bound（full runを開始しない）
       それ以外                           -> trial
  -> trial: createPlannerAlternativeMaterializer() -> reusedExisting ならrejected（kernelと同じ）
            -> resolveBuildListEntryReplacement()（O -> G）
            -> preparePlannerReplacementConflictPreflight(O + G, [O -> G], fixedConstraints = [], baselineのconflict contexts)
            -> createPlannerAlternativeFullRunner(ladderの累積budget) -> createProductionPlanWithObserver + Trace Replay
            -> judgePlannerAlternativeTrial(explicitDecisionBuildListEntryIds = fixedRouteBuildListEntryIds = support Entry)
```

- `judgePlannerAlternativeTrial()` の4条件は、explicit decision Entry = fixed Route Entry = support Entryとすると、Phase A §6.4の条件1〜4
  （`plan !== null` / support Entryがすべてselected / `G` とsupport Entryの同時participant Conflictなし / `G` がselected、またはsupport集合外
  Entryとの暫定帰結だけで外れた）にそのまま一致する。Trace Replay失敗はProductionと同じく例外で伝播し、unitはprocess failure（unmeasured）になる
- preflightに渡すfixed constraintは常に `[]` で、trial runの `conflictResolutions` は常に0件（そうでなければ不変条件違反として例外）。support Entryの
  `PlannerConflictResolution` / scenario resolution / explicit resolution / repair lineage / `selectedBuildListEntryId` は一切作らない
- 判定literalはProductionの `found` と分けて `found_R` とする。保存・lineage作成はしない
- 累積rerun budgetは `createPlannerAlternativeFullRunBudget()` と同じ形（同じlimit、同じ `PlannerAlternativeRerunLimitError`）で、下位rungで使った
  回数から始まるResearch budget（`createPhase2C27BLadderRerunBudget()`）。runtime-unsupported retryも同じobserverで数える
- **kernelのTarget単位の探索前budgetチェックは写さない**: kernelは（request-global budgetが他Targetで尽きた場合に）Search前に
  `stopped_by_planner_rerun_bound` とする。Phase Bのbudgetは (Target, context) のladderに閉じており、Phase A §6.3はrerun boundを
  「必要なrunを開始できなかった」と定義するので、上位rung unitでもSearchは実行し、判定はdelivery時（§6.2の擬似code）だけで行う
- K0（support Entryなし）では条件2・3が空になり、`G` がsupport集合外の任意のEntryとの暫定帰結で外れた場合も `found_R` になる（Phase A §6.4に
  明記済みの帰結）。本Phaseはこれを変更しない

### 1.4 oracle isolationの実装

- scheduler / unit側のmodule（`plannerGlobalPhase2C27B.ts`）とrunnerは、oracle / analysis / population-authority moduleを推移的にもimportしない
  （testがimport closureを検査）。runnerがloadするmoduleは本module、B2-C1 schedule、memory tracker、Research入力、Production RNG Engineだけ
- runnerが読むのはExportとmanifest（Target IDだけ）とPhase A文書のhashだけで、RESULT・oracleを読まない。子はunit task（context selector、rungの
  extent、ladder state）だけを受け取り、Exportからscheduleを再導出してtaskを照合する（不一致はcontext mismatch = invalid）
- E1のTarget ID、Entry ID、digest、stable keyをsourceに書かない（testで検査）

### 1.5 post-hoc analyzer（formal run後だけoracleを読む）

- launch provenance: runnerがchild起動前に書いたstart attestation（`wx`、read-only）を、measurement HEADのgit objectから再計算したbenchmark code
  SHA-256、Export / manifest SHA-256、Target ID、Phase A文書SHA-256、Production audit（base main以降のProduction changed files `[]`）、登録条件
  すべてに対して検証する
- authority chain: B2-C2B1 / B2-C1（population parser）、B2-B1（`parsePhase2C26B2C1B2B1Authority()`）、oracle RESULT（`be51e7cd…`）、oracle manifest
  （file `c8b240f6…`、routes `ffb6db5a…`）、Exportを相互照合する
- scheduler replay: 同じ登録schedulerを記録済みtyped outcomeで再実行し、実現unit列（unit ID、context、rung、開始時ladder state）・Target stopが
  一致すること、余分なunit（retry、再実行、bound / unmeasuredの上位rung）が無いことを検証する。unitのtyped resultはprocess outcomeとrecordから
  再計算する
- unit検証: echoされたtask、ladder state連鎖（終了時 = 開始時 + そのunitのtrial記録）、累積上限2 / 8、下位rungで不採用のCandidateの再trial禁止、
  各deliveryのskip / stop actionの再計算、Search summaryとtyped outcomeの整合、trial runのresolution 0件、delivered costの単調性
- `found_R` Routeのreservation違反: child側の判定に加え、Route operationごとにblocked位置・exclusive OwnedWeaponを独立に検査する
- oracle exact: oracle manifestと検証moduleを **analyzer引数** として読み、`materializeOracleRoutes()` でoracle RouteをProduction Search Domainから
  再materializeする。その結果がoracle RESULTの `entriesSha256` とbyte一致し、各Targetの `candidateId` / `buildListEntryId` が一致することを確認した上で、
  `candidateStableKey()` をoracle keyとする。Targetの **exact recovered** = 停止した `found_R` Routeの `candidateStableKey()` がoracle keyと一致。
  Phase 2-C2のoracle意味照合（`phase2c2OracleCoverage()`）は診断として併記する
- compatible context / covering rung: B2-C2Aの `phase2c26b2c2aReach()` でcontextごとのcompatibilityを再計算し、B2-C1のK0 / K1 compatible件数と
  P1 first compatible rank、B2-C2B1のfirst ladder rungと照合する。§9.6の表で決まらない2つのcontext状態（found_RでTargetが止まったため上位rungへ
  進まなかったextent-bound context、covering rungより下で `found_R` になったcontext）には `escalation_pending_at_target_stop` /
  `found_r_below_covering` のverdictを与える。これらは `found_R` で止まったTargetにしか現れず、class判定（`exact_recovered` / `found_non_oracle`
  が先）に影響しない
- escalation superset診断（§6.2）: 上位rungでtrialしたCandidateが下位rungでdeliverされていないこと（違反件数）と、推定advanceが下位extent内に
  収まるtrial件数を記録する。decision inputにしない
- aggregate decisionはPhase A §9.7の順（INVALID → INCOMPLETE → RECOVERED → PARTIAL → NOT_RECOVERED）。INCOMPLETEでもclass件数とexact件数は下限として記録する

### 1.6 formal run前に行った非formal確認

formal runとは別に、未commitのコードで次の非formal smokeを行い、計算経路だけを確認した（いずれもformal evidenceではなく、policy・envelopeの変更理由にもしていない）。

- runner smoke: Target index 0のL0 2 unit（11 Target × 43 contextの構築、context mismatch 0、unit record書出し）
- trial経路の確認: 手で作ったL1・K0の1 unitを子roleで直接実行（found_R判定、full run 1回、ladder state記録）
- analyzer smoke: 上記runner smokeに対して `--allow-nonformal` で実行（authority chain、oracle再materializeのbyte一致、P1独立再計算、scheduler replayが通ることを確認）

## 2. 結論（`B2C27B_INCOMPLETE`）

| 項目 | 値 |
| --- | --- |
| measurement HEAD | `b24bf5dc7d98cb8341a24d27fabbd1a36843a004`（runner / analyzer / tests / 本書§1を含むclean HEAD） |
| RESULT | [`docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json`](PLANNER_GLOBAL_PHASE2C27B_RESULT.json)（SHA-256 `d79ea0de…b8e4`、`provenance.formal = true`） |
| raw | `PLANNER_GLOBAL_PHASE2C27B_RAW.json.local`（2,567,122 bytes、SHA-256 `f8c16d9f…3bed`）、run dir（start attestation `d76ebc4d…5c31`、unit record 567件のSHA-256はRESULTの `sources.unitRecords`）。いずれもcommitしない |
| run | 2026-10-07T03:54:55Z〜2026-10-10T06:19Z、wall 267,868 s（約74.4時間）、status `completed` |
| decision | **`B2C27B_INCOMPLETE`**（invalid 0、policy-required unitのunmeasured 8件 = すべてtimeout、required unit未実行 0） |
| exact recovered | **0 / 11（下限）** |
| per-Target class | `found_non_oracle` 11、ほかの7 classはすべて0 |

事前登録のdecision順（§9.7）により、unmeasuredが1件でもあるとINCOMPLETEになる。11 Targetはすべて `found_R` で停止しているので、
Targetのclassはunmeasuredの有無と無関係に `exact_recovered` / `found_non_oracle` のどちらかで決まり、このrunではすべて `found_non_oracle` だった。
「0 / 11」は下限である（§4.3）。条件変更・再実行はしていない。

## 3. formal validity（違反0）

| 検査 | 結果 |
| --- | --- |
| start attestation（child起動前、`wx`・read-only）| verified。HEAD `b24bf5dc`、benchmark code SHA-256をmeasurement HEADのgit objectから再計算して一致、uncommitted false、smokeなし、appliedExecutionEnvelope = 登録値 |
| Production source changed files | base main `e696ef4` → measurement HEAD: `[]`、→ analysis HEAD: `[]` |
| calculation code changed since measurement HEAD | `[]` |
| Phase A文書 / Export / manifest | SHA-256一致（Exportは `cc35fb5b…1e6b`、manifestはB2-C2B1 / B2-C1から機械導出したものと一致、keyはTarget ID等のみ） |
| authority hash chain | B2-C2B1 / B2-C1 / B2-B1 RESULT、oracle RESULT、oracle manifest（file / routes）、Exportの相互照合19項目すべて一致 |
| Production RNG / CalculationContext / `researchMaxPlanSteps` | 全unit record一致（`production-rng:c5-e7`、calculation schema 17、20000） |
| P1 ordering / K ≤ 1 scope | 11 Targetとも独立再計算したP1のK ≤ 1 prefixと一致（各43 = K0 1 + K1 42） |
| scheduler replay | 575 unitの実現列（unit ID、context、rung、開始時ladder state）とTarget stopが登録schedulerのreplayと一致。retry / fallbackなし（child process数 = unit + 1） |
| ladder state / budget | 全unitで終了時state = 開始時state + 自unitのtrial記録、累積trial ≤ 2、累積full run ≤ 8、上位rung開始時state = 直前rung終了時state、下位rung不採用Candidateの再trial 0 |
| G1 | 全trial runの `conflictResolutions` 0件、preflightのfixed constraint 0件 |
| reservation違反 / delivered cost非単調 / context再導出不一致 | 0 / 0 / 0 |
| oracle key authority | `materializeOracleRoutes()` の再実行結果がoracle RESULTの `entriesSha256` とbyte一致、43 Routeの `candidateId` / `buildListEntryId` 一致 |

## 4. 実行結果

### 4.1 unit

| rung | unit | `found_R` | extent bound | trial bound | rerun bound | not found | timeout | OOM / failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| L0 | 389 | 2 | 382 | 0 | 0 | 0 | 5 | 0 |
| L1 | 182 | 5 | 167 | 7 | 0 | 0 | 3 | 0 |
| L2 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| 計 | **575** | 11 | 549 | 7 | 0 | 0 | **8** | 0 |

- timeout（unmeasured）8件: `t02-r08-L1`、`t03-r08-L0`、`t03-r11-L0`、`t04-r11-L0`、`t07-r11-L0`、`t08-r11-L0`、`t08-r08-L1`、`t09-r09-L1`。いずれも上位rungへ
  進めず、再実行していない
- extent escalation: 186 unit（L1 182 + L2 4）。superset診断の違反（上位rungでtrialしたCandidateが下位rungで既にdeliverされていた件数）0
- trial 25件（full Planner run 25回、runtime-unsupported retry 0）。trial時間合計413 s。Search（trial時間を除く）合計234,119 s（約65.0時間、unit wallの約87 %）、
  timeout分28,800 s（8.0時間）。中央値unit wall 237 s、最大3,600 s（timeout）
- memory: child heap peak 9.26 GB、RSS peak 10.60 GB（12,288 MB上限内、OOM 0）、unitごとheap peakの中央値3.78 GB

### 4.2 per-Target

| Target | 停止rung | 停止context（P1 rank） | `G` selected | found Route kind | 推定操作数 | oracleのcovering rung | oracleのP1 first compatible rank | unit L0 / L1 / L2 | unmeasured | trial | wall h | oracle意味照合 |
| --- | --- | --- | --- | --- | ---: | --- | ---: | --- | ---: | ---: | ---: | --- |
| t00 | L1 | 1 (K0) | false | normal_artian_to_gogma | 179 | L1 | 8 | 43 / 1 / 0 | 0 | 1 | 3.45 | uncovered |
| t01 | L1 | 1 (K0) | true | existing_gogma_mixed | 92 | L1 | 3 | 43 / 1 / 0 | 0 | 1 | 3.56 | uncovered |
| t02 | L2 | 1 (K0) | false | normal_artian_to_gogma | 600 | L2 | 17 | 43 / 43 / 1 | 1 | 1 | 11.67 | uncovered |
| t03 | L2 | 1 (K0) | false | normal_artian_to_gogma | 335 | L2 | 18 | 43 / 41 / 1 | 2 | 1 | 14.14 | uncovered |
| t04 | L2 | 1 (K0) | false | existing_gogma_mixed | 1142 | L2 | 11 | 43 / 42 / 1 | 1 | 1 | 10.93 | uncovered |
| t05 | L0 | 1 (K0) | false | existing_gogma_mixed | 97 | L1 | 32 | 1 / 0 / 0 | 0 | 1 | 0.01 | uncovered |
| t06 | L0 | 1 (K0) | false | existing_gogma_mixed | 162 | L1 | 31 | 1 / 0 / 0 | 0 | 1 | 0.01 | uncovered |
| t07 | L1 | 1 (K0) | true | existing_gogma_mixed | 255 | L1 | 14 | 43 / 1 / 0 | 1 | 1 | 5.45 | uncovered |
| t08 | L2 | 1 (K0) | true | existing_gogma_mixed | 551 | L2 | 18 | 43 / 42 / 1 | 2 | 1 | 15.10 | uncovered |
| t09 | L1 | 10 (K1) | true | existing_gogma_mixed | 267 | L1 | 31 | 43 / 10 / 0 | 1 | 15 | 6.18 | uncovered |
| t10 | L1 | 1 (K0) | false | normal_artian_to_gogma | 51 | L1 | 2 | 43 / 1 / 0 | 0 | 1 | 3.90 | uncovered |

- covering rung / first compatible rankはanalyzerがB2-C2B1 / B2-C1 RESULTと再計算から読んだpost-hoc値で、schedulerは読んでいない
- oracleと `candidateStableKey()` が一致した `found_R` Routeは0件。Phase 2-Cの意味照合でも全件 `uncovered`（exactもpartialも無し）。
  `exactDeliveredButNotFound`（`found_R` 以外のdeliveryにoracle exactが含まれていた）も0件
- compatible contextのverdict（45件）: `escalation_pending_at_target_stop` 42、`unmeasured_below_covering` 1（`t04` rank 11、L0 timeout）、
  `not_executed` 2（`t05`、`t06`）

### 4.3 INCOMPLETEの範囲（下限の意味）

unmeasured 8件のcontextのうち7件は、post-hocにoracle Routeとreservation-incompatibleなcontextである（そのcontextのSearchはoracle Routeを
deliverできない）。残る1件 `t04-r11-L0` はcompatibleだが、covering rung L2より下のL0でtimeoutしたもので、L0 extentではoracle Routeを
deliverできない。ただし、これらが計測できていれば同じrung内の後続contextやrungの進み方が変わり、Targetの停止点が変わり得る（例: timeoutした
unitが `stopped_by_search_extent_bound` なら上位rungで再実行対象になる）ので、「unmeasuredが無ければ結果が同じだった」とは主張しない。
exact recovered 0 / 11は下限である。

## 5. 観察（事前登録decisionの外の診断）

### 5.1 K0での停止

- 11 Targetのうち10 Targetが **P1 rank 1のK0 context**（support Entryなし、empty reservation）で停止した。K0は各rungでdeliverが0件なら
  extent boundで次rungへ進み、**K0が初めて1件以上deliverしたrungの最初のCandidateが、そのまま1回目のtrialで `found_R`** になった（10 / 10）
- そのうち7件は `G` がselectedではなく、support集合外Entryとの暫定帰結で外れただけの `found_R` だった（Phase A §6.4の条件4。K0ではsupport集合が
  空なので、どのEntryに負けても条件を満たす）。trial runはいずれも `exhausted`（Target 43件のうち完成19〜21、Conflict 20〜22件）
- K0はreservationを持たないので、oracle Route（held位置をまたぐRoute）はK0ではdeliverされ得ない（B2-C1: E1のK0 compatible 0件）。P1が
  K0を常にrank 1に置き、K0の `found_R` がほぼ無条件に成立するため、policyはcompatibleなK1 contextの上位rungへ到達する前に停止した。
  compatible contextのverdictの大半（42 / 45）は「下位rungでextent boundのまま、Targetが停止したため上位rungへ進まなかった」である

### 5.2 K1でのsupport Entry非選択（`t09`）

- `t09` はL1でK0がdeliver 0だったため、K1 context（rank 2〜10）でtrialした。rank 2〜8の14 trialはすべて `G` 自体はselectedだったが、
  **support Entryがselectedにならず**（条件2、`explicit_decision_not_selected`）、各contextが2 trialでtrial boundに達した。rank 9はtimeout、
  rank 10でsupport EntryもselectedになりK1の `found_R` となったが、oracle Routeではなかった
- G1によりsupport Entryはresolutionを持たない通常のEntryとして扱われ、baselineのfull Planner run（Conflict約21件、43 Entry中20前後がselected）
  の暫定帰結でsupport Entry自身が外れやすい。Phase A §2.2が予告した「暫定帰結で外れることもあり、resolutionを合成して救済しない」が、
  K1 trialの棄却理由の主因として観測された

### 5.3 cost

- unit wallの約87 %がSearch（trial時間を除く）で、trial（full Planner run 25回）は413 sにとどまった。L0 / L1で多数のcontextがdeliver 0のまま
  extentを使い切る（extent bound）Searchに時間を使っており、Targetあたりwallは0.01〜15.1時間と大きく偏った
- timeoutはrank 8 / 9 / 11の特定contextに集中した（reservationの形に依存するheld-aware Searchのcostと読めるが、本Phaseでは原因を調べていない）

## 6. このPhaseで言えること・言えないこと（Phase A §9.8）

- 言えること: このExport・E1 11 Target・事前登録policy・Research envelopeで、oracleを実行入力に使わずにpolicyを実行したところ、全Targetが
  `found_R` で停止し、停止RouteはいずれもoracleのexactRouteではなかった（exact 0 / 11、下限）。formal validityの違反は無い
- 言えないこと: oracle非依存policyが存在しないこと、`found_R` Route集合が43 Target全体として共存すること、E2 / residual 3、Production default、
  Production runtimeとしての許容。`found_non_oracle` のRouteが「共存可能な別解」であることも本Phaseは主張しない（Phase A §9.6）

## 7. 次Phaseへのrecommendation（decision条件ではない）

- Phase A §9.7の分岐では、支配的class `found_non_oracle` は「停止信号は機能している。oracle exactより、`found_R` Route集合のGlobal共存（2-C2.8）を先に
  検証する」に当たる
- ただし§5.1のとおり、このrunの停止の10 / 11はK0の `found_R` で、そのうち7件は `G` が暫定帰結で外れただけである。K0の `found_R` は「reservationなしで
  最初にdeliverされたCandidateが、通常のEntryとしてbaselineに入れても破綻しない」ことしか確かめておらず、共存の証拠としては弱い。2-C2.8へ進む前に、
  次をdocs-onlyで再検討する（Phase Aの事前登録の改訂であり、プロジェクトオーナーの判断が必要）ことを推奨する
  - K0 contextの扱い: K0の `found_R` に `G` のselectedを要求するか、K0をordering上の別位置に置くか、K0を停止信号から外すか
  - support Entryの非選択（§5.2）: G1を守ったまま、support Entryがbaselineの暫定帰結で外れることを `found_R` の前提とどう両立させるか
    （例: support EntryがbaselineのPlanで既にselectedのcontextだけを対象にする、等。いずれも新しい意味論なので本Phaseでは決めない）
  - Search execution budget（Phase A §7.5）: extent boundまでdeliver 0のまま走るSearchがcostの大半を占めたこと
- unmeasured（timeout）を減らすためのenvelope変更や再実行は、事前登録どおり本Phaseでは行わない。行う場合は別axis・別Phaseとして事前登録する

Issue #154はCloseしない。

## 8. validation

- measurement HEAD時点（formal run前）: `git diff --check`、`npm run check:nul`、`npm run lint`、`npm test`（356 files / 5,968 tests）、`npm run build` すべて成功
- RESULT追加後: 同じ5項目すべて成功（Draft PRに記載）

## 9. 変更していないもの

Production source、Search algorithm / ordering / comparator、Planner scheduler、Planner Alternative kernel、Worker protocol、UI、Persistence、
schema / version（`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13）、RNG（`production-rng:c5-e7`）、
`defaultPlannerAlternativeSearchExtent`、Candidate Search default、`maxCandidateTrialsPerTarget`、`maxPlannerReruns`、`defaultPlannerOptions`、
`conflictResolutionPlannerOptions`、B2-C2B2I / B2-C2B2J optimization、既存RESULT JSON、Production test fixture。
