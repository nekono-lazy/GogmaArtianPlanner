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

本節はformal run開始前にcommitしたmeasurement HEADの内容であり、run後に変更しない。Phase A §9.1の「Phase B固有の実装値」に当たるものと、
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

## 2. 結果

（formal run後に追記する。）
