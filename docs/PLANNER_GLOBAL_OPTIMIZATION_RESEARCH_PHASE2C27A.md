# Global Planner Research Phase 2-C2.7-A（oracle-free execution policy / Production復帰境界の仕様確定）

Refs #154。**docs-only**。基準main: PR #211 merged `8b7c218a05d57d8fd0587617687a5ceeccf2c96e`（作業開始時に `main` / `origin/main` の一致と
Working Tree cleanを確認）。

Production source、Search algorithm / ordering / comparator、Planner scheduler、Planner Alternative kernel、Worker protocol、UI、Persistence、
schema / version、RNG、`defaultPlannerAlternativeSearchExtent`、Candidate Search default、`maxCandidateTrialsPerTarget`、`maxPlannerReruns`、
`defaultPlannerOptions`、`conflictResolutionPlannerOptions` は変更していない。formal Search run、benchmark run、RESULT JSON生成、oracle再計算、Candidate生成も行っていない
（このPhaseのProduction changed files = `[]`）。

## 0. 位置づけ

B2-C2B2K（`B2C2B2K_RECOVERED`）で、E1 11 Targetすべてについて **oracle-guided** なTarget / context / extentのもとでexisting Searchが
exact oracle Routeをdeliverするevidenceが揃った。一方、そのcontext / extentはoracle由来であり、Production selectorの証拠ではない。
本Phaseは追加のmicro-optimizationへ戻らず、次の2点だけを文書で確定する。

1. **oracleをSearch / scheduler / calculationの実行入力に入れずに**、次に試すcontext・extent・execution budgetを決めるResearch execution
   policy（Phase 2-C2.7-Bで評価する事前登録candidate）
2. そのpolicyを将来Productionへ持ち込む場合の境界（何をProduction semanticsとして扱ってはならないか、何が先に必要か）

本書はResearch文書であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり
`docs/REQUIREMENTS.md` → タスク固有の正式仕様（本件は `docs/PLANNER_SPEC.md` 9.2.19、`docs/SEARCH_SPEC.md` 5.6.8）→ その他の正式文書 →
実装 → test → 過去Research / チャットである。本書の記述が正式仕様と食い違って見える場合は正式仕様が優先し、本書は
**現行Production semantics（REQUIREMENTS 23 / 23.1、PLANNER_SPEC 9.2.19.1〜9.2.19.16）を一切変更しない**。

## 1. ここまでの到達点（既存formal RESULTの整理、再計算していない）

| Phase | decision | このPhaseで使う事実 |
| --- | --- | --- |
| Phase 0（`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH.md`） | 途中成功 | ordinary Candidate Search + sequential projected stateで42 / 43完成、Conflict 2、rejected 1、7,330 steps。Search約587 s / 全体約657 s（§8） |
| B1 | `B1_M_measurement_complete` | default extent `{ 4, 235, 4 }` のSearch-only portfolio。oracle coverage 2 / 43 |
| B2-B1 | `B2B1_PARTIAL_ELIGIBLE_RECOVERY` | current Route 0 / 1 / 2本のreservationでK0 0 / K1 31 / K2 9 / unreached 3（43 Target、oracleはpost-hocだけ） |
| B2-C1 | `B2C1_WIDE` | P0〜P3のうちP1を事前登録selection ruleで選択（selection自体はoracle post-hoc coverageによる）。K1-minimal 31件はP1 rank ≤ 32、K2-minimal 9件はP1 rank 50〜306 |
| B2-C2B1 | `B2C2B1_CHARACTERIZED` | extent不足20件をE1 11（K1-minimal）/ E2 9（K2-minimal）に分割。不足はほぼSkill。L0 / L1 / L2 ladderをE1 required extentから登録 |
| B2-C2B2A | `B2C2B2A_INCOMPLETE`（non-formal partial） | E1を共通L2・P1上位32 contextでSearch。partial run |
| B2-C2B2B | `B2C2B2B_INCOMPLETE` | E1 ∩ L1 7件、共通L1。C4C 7 / 7（timeout 33件はすべてreservation-incompatible context） |
| B2-C2B2C | `B2C2B2C_INCOMPLETE` | E1 ∩ L2 4件、共通L2。C4C 2 / 4（timeout 108 / OOM 2）。E1 common ladder合計 C4C 9 / 11 |
| B2-C2B2D / E | `B2C2B2D_INCOMPLETE` / `B2C2B2E_INCOMPLETE` | oracle-guided first-compatible context × target-relative tight extent。60分 / 12 GBでheap_growth型1件回収、time_bound型1件は未計測 |
| B2-C2B2F〜J | profiling / optimization | time_bound型のSearch wallはBonus streamの `state_generation` が支配。B2-C2B2I / B2-C2B2JでProduction optimizationを2件採用 |
| B2-C2B2K | `B2C2B2K_RECOVERED` | 残るtime_bound Targetを同一Search input × 60分 / 12 GBで回収（Search 3,374.9 s、exact index 0）。E1 oracle-guided diagnosticは11 / 11 |

E1の11 Targetは、oracle-guided diagnosticの合算として回収済みである（Phaseごとに回収条件が異なり、1回のrunで11件を回収したのではない）。
**registered common ladder（Target別rung割当はoracle由来）ではC4C 9 / 11のまま** であり、oracleなしの選択では1件も評価していない。

現在のProduction authorityは次のままであり、本Phaseでも変えない。

| 項目 | 値 | authority |
| --- | --- | --- |
| Planner Alternative extent | Normal 4 / Gogma 235 / Skill 4 | `defaultPlannerAlternativeSearchExtent`（PLANNER_SPEC 9.2.19.12） |
| `maxCandidateTrialsPerTarget` | 2 | `defaultPlannerAlternativeTrialBounds` |
| `maxPlannerReruns` | 8（request-global） | `defaultPlannerAlternativeTrialBounds`（9.2.19.12） |
| `maxPlanSteps` | 下記A / Bの2つを区別する（固定の1つの値ではない） | PLANNER_SPEC 7.2.1「runtime `maxPlanSteps` の導出（Issue #130）」 |

`maxPlanSteps` は次の3つを混同しない。

| 区分 | 値 | 性格 |
| --- | --- | --- |
| A. Domain default | `defaultPlannerOptions.maxPlanSteps = 1000` | Domain / Applicationのdefault / fallback。Planner Alternative競合解決時の固定Production値ではない |
| B. Planner Alternative Production runtime | `conflictResolutionPlannerOptions(表示中Plan)`（`src/services/planner/plannerRuntimeOptions.ts`）が導出する `max(defaultPlannerOptions.maxPlanSteps, ceilTo500(表示中Plan.steps.length) + 500)` | what-if（9.2.19.7）/ actual repair（9.2.19.8）の各full Planner runの `PlannerInput.options` のauthority。Application callerが書き込み、表示中PlanのStep数に応じて1000を超え得る（UI_FLOW 11.2 / 11.4） |
| C. Research条件 | `researchMaxPlanSteps = 20000` | B2系列（Phase 0以来）から継続するResearch専用条件。A / BのProduction contractとは別物で、Production default・Production runtime導出の変更を意味しない |

## 2. 用語の分離（本Phaseの中心）

### 2.1 user-fixed Route

現行PLANNER_SPEC 9.2.19.3のfixed Route集合である。authorityは次の3つだけであり、本書はその意味を変更しない。

- 今回ユーザーが明示選択したEntry（what-ifでは `scenarioResolution`）
- merge後のPlannerInputのvalid explicit resolutionが選択するEntry
- 有効なrepair lineage（9.2.19.11）により以前固定され、現在のBuild Listに同じIDで存在し、その後の決定で無効化されていないEntry

user-fixed Routeは、9.2.19.6のfound判定（明示決定Entryがselectedであること、`G` とfixed Route集合のEntryを同時participantとする
Conflictが無いこと）と、9.2.19.11のrepair lineageへの記録の対象である。

### 2.2 speculative support context

B2-B1 / B2-C1のK0 / K1 / K2 contextのように、

> 「このcurrent Route集合のreservationを **仮に** 使用すると、TargetのalternativeRouteを探索可能になるか」

を調べるためのResearch上の **仮説context** である。reservationの導出authorityは同じ（`derivePlannerAlternativeReservation()`、
`createPlannerRouteUnitPlans()`、`collectReferencedOwnedWeaponIds()`）だが、**どの集合を使うかの根拠がユーザーの決定ではない**。

> **最重要guardrail**: speculative support contextは **user-fixed Routeではない**。K1 / K2 contextを試すことは、
> 「そのEntryをユーザーが優先した」ことを意味しない。

したがって次を禁止する（Research harnessでも、将来のProductionでも）。

- speculative support contextのEntryを `PlannerConflictResolution`、`scenarioResolution`、explicit resolution、9.2.19.6の明示決定Entryとして
  入力へ書き込むこと
- speculative support contextを `ProductionPlan.conflictRepairLineage` の決定・fixed Entryとして記録すること
- speculative support contextを試した事実から、PlanConflictの `selectedBuildListEntryId` を埋めること、Conflictを「解決済み」と表示すること
- speculative support contextを、9.2.19.10の除外集合や9.2.19.11のsupersede判定のauthorityにすること

speculative support contextのEntryは、full Planner runでは **通常のBuild List Entryとして** 扱われる（resolutionを持たない）。その結果、
暫定帰結（route commitmentのprovisional outcome）で外れることもある。外れた場合にresolutionを合成して救済しない。

### 2.3 oracle-informed policy design

実行時にはoracleを読まないが、**過去のoracle post-hoc評価を利用してResearch候補として選定された** 設計要素である。現時点の該当物:

| 要素 | oracle由来の部分 |
| --- | --- |
| P1 ordering（B2-C1） | P0〜P3からの選択を、oracle Routeのfirst compatible rank CDFで行った（`oracleGuidedPolicyEvaluation = true`） |
| L0 / L1 / L2 ladder（B2-C2B1） | L1 / L2の値をE1 cohortのoracle required extentのmedian / maxから導いた（`oracleInformedLadder = true`） |
| E1 / E2 / residual 3の分割 | B2-B1 / B2-C1のoracle compatibilityとrequired extentでpost-hocに分類した |
| context scopeをK1までに限ること（§4） | E1がK1-minimalであることはoracle post-hoc判定である |
| B2-C2B2Kで観測したSearch所要時間（約3,375 s） | 過去のoracle-guided runの観測値。execution envelopeの選定に使えばoracle-informed |

本書は「完全にoracle非依存なpolicyを既に得た」とは書かない。Phase 2-C2.7-Bで評価するのは **oracle-informedに設計されたpolicyを、
oracleを読まずに実行した場合** であり、その結果はoracle非依存policyの存在証明ではない。Production採用には、少なくともE1以外の集団・
別Exportでのevaluationが別途必要である（§10.3）。

### 2.4 oracle-free execution

Phase 2-C2.7-B以降のformal executionでは、scheduler / Search child / trial / calculationが次のいずれも **実行入力として読まない**。

| 禁止する入力 | 例 |
| --- | --- |
| oracle由来のTarget ID | oracle support Target、oracle Route上の順序・役割、「このTargetはK1 / L2が必要」というTarget単位の分類 |
| oracle Route | operation列、Route kind、source OwnedWeapon |
| oracle stable key | `candidateStableKey()` の期待値（early stopやskipに使うことを含む） |
| oracle Counter位置 | Normal / Skill / Gogmaの到達位置・最後の操作位置 |
| oracle required extent | B2-C2B1のTarget別required値、tight extent |
| oracle first-compatible rank | B2-C1 / B2-C2B1のP1 first compatible rank、compatible context集合 |
| exact Candidate index | B2-C2B2B〜Kで観測したdelivery index |
| 既知の成功context | B2-C2B2B〜Kでexactが出たcontextのdigest / rank / representative |
| 既知のTarget別成功rung | B2-C2B1の `firstLadderRung`、B2-C2B2B / C のpopulation割当 |

oracleはformal run終了後の **post-hoc analyzerだけ** が読む。analyzerの出力（hit / miss）をformal run中のschedulerへ戻さない。

**population manifest** は区別して扱う。Phase BでどのTargetを実行するか（E1 11件）は、それ自体がoracle-informed designであるため、
Target IDだけを持つmanifestとして渡すことを許可し、provenanceに `oracleGuidedTargetPopulation = true` と記録する。manifestへ
上表の属性（rank、rung、required extent、期待結果等）を載せてはならず、schedulerはmanifest内のすべてのTargetに **同一のpolicy** を
適用する（Target IDで分岐しない）。

## 3. guardrail一覧（Phase B以降すべてに適用）

| ID | guardrail |
| --- | --- |
| G1 | speculative support contextをuser-fixed Route / explicit resolution / lineage decisionへ偽装しない（§2.2） |
| G2 | oracle情報（§2.4の表）をscheduler / calculationの実行入力にしない。sourceへTarget個別のoracle値をhard-codeしない |
| G3 | P1をProduction orderingとして確定しない。Research candidate policyとして評価するだけ（§4） |
| G4 | L1 / L2をProduction default extentとして確定しない。`defaultPlannerAlternativeSearchExtent` を変えない（§5） |
| G5 | extent / context budget / Candidate trial bound / Planner rerun budget / Search execution budgetを別概念として扱う（§7） |
| G6 | timeout / OOM / process failure / interruption / 未実行をCandidate 0、not found、extent不足へ読み替えない（§6.3） |
| G7 | wall-clock timeoutをRouteの意味論的なnot-found判定に使わない（§7.5） |
| G8 | 架空のSearch work unitを正式仕様として捏造しない（§7.5） |
| G9 | context / extent / task生成ruleとtask順序をformal run開始前に確定し、run後に条件を追加・変更しない（§9.2） |
| G10 | 現行9.2.19の1段repair semantics（what-if / actual repairのauthority、found判定、lineage）を変更しない |
| G11 | 上位extent rungへ進めるのは `stopped_by_search_extent_bound` のcontextだけ。trial bound / rerun bound / unmeasuredを理由にextentを広げない。extent escalationで増えるのはSearch extentだけで、trial 2 / rerun 8は同一 (Target, context) のladder全体で累積共有する。retryは別axis（§6.2） |
| G12 | `maxPlanSteps` のDomain default（1000）、Planner Alternative Production runtime（`conflictResolutionPlannerOptions(表示中Plan)`）、Research条件（20000）を混同しない（§1） |

## 4. context policy

### 4.1 P1はResearch candidate policy

Phase Bで評価するcontext orderingは、B2-C1のP1 `default_simple_first` とする（変更しない）。

```text
P1: targetEligibleMinCardinality ASC → exclusiveOwnedWeaponCount ASC → blockedCountDefaultTotal ASC
    → shareableHeldCountDefaultTotal DESC → reservationDigest ASC
    （K0 empty reservationは常にrank 1。最終keyは reservationDigest ASC、同key = digest重複はfail closed）
```

P1はProduction orderingとして確定しない。Production Planner Alternativeは現在speculative support contextを生成せず、P1を読まない。

### 4.2 B2-C1の既存結果（再計算していない）

| 区分 | 件数 | P1でのfirst compatible rank |
| --- | ---: | --- |
| K0 compatible | 0 | — |
| K1-minimal | 31 | **全31件がrank ≤ 32**（median 8、max 32） |
| K2-minimal | 9 | **rank 50〜306**（median 78）。cardinality-firstのため全K1 contextを通過してからK2へ入る（構造上rank ≥ 44） |
| K ≤ 2でもunreached | 3 | なし（current Routeを何本固定しても必要なheld supportが無い、B2-B1 §9） |

`B2C1_WIDE` の主原因はK2 layerである。K2-minimal 9件はすべてextent不足でもある。

### 4.3 対象の順序づけ

1. **E1（K1-minimal ∩ extent不足、11 Target）を最初の対象とする**（Phase 2-C2.7-B）。K1-minimalなのでP1のK ≤ 1範囲にcompatible contextを
   持ち、extentはL2で全件coverされる（B2-C2B1）。context選択とextent選択を同時に評価できる最小の集団である。
2. **E2（K2-minimal ∩ extent不足、9 Target）はE1の次段階** とする。問題はextentではなくK2 context breadth（Targetあたり約800件のK2 contextの
   中にcompatibleが1〜66件しか無い、B2-C1 §10）であり、P1をそのまま広げても解決しない。Target-relative K2 feature / groupingが先に必要。
3. **residual 3 Target（K ≤ 2でもunreached）はさらに別問題** である。current Routeだけでは必要なheld supportを生成できないので、
   **alternative-to-alternative support**（他Targetのalternative Routeがheld supportになる構成）を扱うGlobal Planner段階（2-C2.8以降）へ送る。

### 4.4 Phase Bのcontext scope

Phase Bは各Targetについて、**P1 rank 1..(1 + K1 context数)、すなわちK ≤ 1のすべてのcontext** を対象とする（このExportでは各Target 43件:
K0 1件 + 自身のEntryを含まないK1 42件、B2-C2B1 §4）。

- 境界はcardinalityという構造的な定義であり、全Targetで同じである。B2-C2B2A〜Cの「P1上位32」は、B2-C1のK1-minimal max rank 32から
  決めたoracle-informedな数値だったため、Phase Bでは使わない
- ただしK2を含めないこと自体は、E1がK1-minimalであるというoracle-informed designである（§2.3）。E2へ進む段階でK2 scopeを別途登録する
- K2 contextを試さずにladderを終えたTargetは、K2で回収できないとは結論しない

## 5. extent policy

### 5.1 登録済みResearch ladder（B2-C2B1、変更しない）

| rung | Normal | Gogma | Skill | E1 coverage（累積、post-hoc） |
| --- | ---: | ---: | ---: | ---: |
| L0 | 4 | 235 | 4 | 0 / 11 |
| L1 | 8 | 235 | 256 | 7 / 11 |
| L2 | 128 | 235 | 1,500 | 11 / 11 |

L0 = `defaultPlannerAlternativeSearchExtent`。L1 / L2はE1 cohortのoracle required extent（median / max）を2の冪とCandidate Search推奨値
（`recommendedCandidateSearchDefaults`）のceilingへ丸めて導いた **oracle-informed Research ladder** である。

### 5.2 制約

- **Production defaultではない**。`defaultPlannerAlternativeSearchExtent` を変更しない
- **Candidate Searchの推奨値へ読み替えない**。L2のSkill 1,500はceilingとして `recommendedCandidateSearchDefaults` と一致しているだけで、
  Plannerが `recommendedCandidateSearchDefaults` / `AppSettings.candidateSearchDefaults` を読む根拠にはならない（PLANNER_SPEC 9.2.19.12）
- **Target固有のrequired extentを実行時に直接使わない**。tight extent（B2-C2B2D〜K）はPhase Bでは使わない
- **L1 / L2の成功を理由にProduction defaultをL2へ変更しない**
- Phase Bでladderを使う場合、**全Target共通の事前登録rung** として使う。どのTargetがどのrungから始まるか、どのrungで止まるかを
  Target単位に事前指定しない（§6.2の規則だけで決まる）

## 6. outcome-driven escalation

### 6.1 停止信号の選択（なぜSearch deliveryではなくtrialか）

oracleを読まない以上、「このcontext / extentで十分か」をexact hitで判断できない。候補になる信号は2つあるが、Search deliveryは使わない。

- **Search delivery（Candidateが1件以上出た）は停止信号にならない**。B2-C2B2Bでは計測191 contextで60,268件がdeliverされたが、
  reservation-compatibleは24 contextだけだった。incompatible contextも大量のIdeal Candidateをdeliverするので、delivery停止では
  compatible contextへ到達する前に止まる
- **停止信号は、9.2.19.6のfound判定をspeculative support contextへ写したResearch trial（§6.4、以下 `found_R`）とする**。
  Production authorityと同じmaterializer、9.2.18のreplacement、9.2.3.1のpreflight、full Planner run + Trace Replayを使い、共存の最終判定を
  既存Plannerに委ねる（9.2.2 / 9.2.11）。exhaustiveな全unit実行（停止信号なし）は §9.4のcost観測から1 Phaseの規模を超えるので採らない

`found_R` はProductionの `found` ではない（§6.4）。Phase Bのprimary questionの判定（oracle exact）は `found_R` とは別にpost-hocで行う（§9.5）。

### 6.2 escalationの単位と規則

**execution unitとbudget scopeを分ける。**

```text
execution unit              (Target, context, rung)    Search 1回の実行単位（rungごとに別unit）
trial / rerun budget scope  (Target, context)           L0 → L1 → L2のladder全体で1つ
```

Production trial boundの値（`maxCandidateTrialsPerTarget = 2`、`maxPlannerReruns = 8`）は変えない。Phase Bではこの2値を、
**同一 (Target, context) のextent ladder全体で累積共有する上限** として使い、rungごとに2 / 8を新規付与（reset）しない。
同じ (Target, context) のunit間では、次の **ladder state** を引き継ぐ（概念名。型名・field名はPhase Bの実装で決めてよい）。

```text
candidateTrialsUsed                     ladder全体で開始したCandidate trialの累計（上限 maxCandidateTrialsPerTarget = 2）
plannerRerunsUsed                       ladder全体で開始したfull Planner runの累計（runtime-unsupported retryを含む、上限 maxPlannerReruns = 8）
previouslyRejectedCandidateStableKeys   ladder全体でtrial不採用になったCandidateの candidateStableKey
remainingCandidateTrials = maxCandidateTrialsPerTarget - candidateTrialsUsed
remainingPlannerReruns   = maxPlannerReruns - plannerRerunsUsed
```

unit内のCandidate処理（Production kernelのtrial loopと同じ順で、上限だけをladder stateから読む）:

```text
Candidateがdeliverされた:
  candidateStableKey ∈ previouslyRejectedCandidateStableKeys
                                     -> skip（trialしない、budgetを消費しない、skippedPreviouslyRejectedに記録）
  remainingCandidateTrials = 0       -> stopped_by_candidate_trial_bound でcontextを終了
  remainingPlannerReruns = 0         -> stopped_by_planner_rerun_bound でcontextを終了（full Planner runを開始しない）
  それ以外                           -> trial（candidateTrialsUsed += 1、開始したfull Planner runごとに plannerRerunsUsed += 1）
    found_R                          -> Target停止
    trial reject                     -> previouslyRejectedCandidateStableKeysへ追加し、次のCandidateを要求
    trial中にrerun budgetが尽きた    -> stopped_by_planner_rerun_bound でcontextを終了
```

例: L0でAをtrialしてreject（candidateTrialsUsed = 1）、その後 `stopped_by_search_extent_bound`。L1でAはskip、Bをtrial
（candidateTrialsUsed = 2）、Cがdeliverされた時点でtrial budgetが0なので `stopped_by_candidate_trial_bound`（Cはtrialしない）。最初から
L1 extentを1 requestとして実行した場合（A reject、B reject、C delivery時点でtrial bound）とtrial総数は同じであり、extent rungを上げても
trial可能件数・full Planner run数の総量は増えない。

**上位extent rungへ進めるのは、下位rungで `stopped_by_search_extent_bound` になったcontextだけである。** extentを広げる理由になるのは
extentが到達可能workを未確認のまま残したという直接のsignalだけで、trial bound・rerun bound・unmeasuredはextent不足のevidenceではない。
したがってそれらのcontextは上位rungで再実行しない。さらに、`stopped_by_search_extent_bound` からL0 → L1 → L2へ進むcontextでも、
**増えるのはSearch extentだけ** であり、Candidate trial budgetとPlanner rerun budgetは上記ladder stateの残量のまま増えない（budget refillは起きない）。
上位rungで初めて `found_R` になった場合は、「同じCandidate / Planner evaluation budgetの範囲内で、extentを広げたことで新しいCandidateへ到達し
回収できた」と解釈できる。
これにより、Phase Bの結果で次を分離できる。

```text
context selector deficiency      compatible contextを実行していない
extent deficiency                extent boundで止まり、上位rungで初めて回収 / ladder上限でも不足
Candidate trial bound            stopped_by_candidate_trial_bound
Planner rerun bound              stopped_by_planner_rerun_bound
Search execution cost            timeout / OOM / process failure / interruption / 未実行（unmeasured）
```

contextの状態（概念名。実装名はPhase Bで決めてよい）:

| 状態 | 入る条件 | 上位rung |
| --- | --- | --- |
| `extentEscalationContexts` | そのrungのunitが `stopped_by_search_extent_bound` | 次rungで再実行する（唯一のescalation対象） |
| `closedContexts` | `not_found_within_search_extent`（Searchがextent内外ともworkを使い切った） | 再実行しない（extentを広げても結果が変わらない） |
| `boundStoppedContexts` | `stopped_by_candidate_trial_bound`（`candidate_trial_bound_reached`）/ `stopped_by_planner_rerun_bound`（`planner_rerun_bound_reached`） | 再実行しない（extent不足と判断しない） |
| `unmeasuredContexts` | timeout / OOM / process failure / interruption / 未実行 | 再実行しない（extent不足と判断しない） |

Targetごとの手順（**rung-major**。各Targetは独立に、同じbaselineから評価する。他Targetの結果を入力にしない）:

```text
Targetがrequired checkpoint Entryを持つ（kernelの blockedBySelectedCheckpoint と同じ判定）
                                          -> unitを実行せずTargetを停止（stopReason = blocked_by_selected_checkpoint）
activeContexts = P1 order over K ≤ 1 (rank 1 .. 1 + K1 context数)
for rung in [L0, L1, L2]:
  extentEscalationContexts = []
  for context in activeContexts（P1順）:
    outcome = unit(Target, context, rung)
    found_R                               -> Targetを停止（stopReason = found_R）
    not_found_within_search_extent        -> closedContextsへ
    stopped_by_search_extent_bound        -> extentEscalationContextsへ
    stopped_by_candidate_trial_bound      -> boundStoppedContextsへ（candidate_trial_bound_reached）
    stopped_by_planner_rerun_bound        -> boundStoppedContextsへ（planner_rerun_bound_reached）
    timeout / OOM / failure / interrupted -> unmeasuredContextsへ
    （同じrung内の次のcontextへ進むことは、どのoutcomeでも許す）
  extentEscalationContexts が空            -> Targetを停止（stopReason = no_extent_escalation_context）
  activeContexts = extentEscalationContexts（P1順を保つ）
L2の後も extentEscalationContexts が残る   -> Targetを停止（stopReason = ladder_exhausted）
```

- rung-majorにするのは、Production default extent（L0）の全contextを先に試し、狭いextentで共存Routeが無いときだけ広げるためである
  （同じrungの中ではcontextを先に替える）。context-majorとの比較はPhase Bの対象外
- escalation判定はtyped outcomeだけを読む。oracle hit / miss、exact index、required extentは読まない
- `not_found_within_search_extent` は、Planner Alternative Searchが `exhausted`（extent内外に到達可能なworkが無い、SEARCH_SPEC 5.6.8 /
  `PlannerAlternativeSearchSummary`）で終わったことを意味するので、そのcontextはrungを上げても結果が変わらない
- `blocked_by_selected_checkpoint` は、Production kernelでもreservation導出・context Searchより前にTarget単位で判定される状態
  （`work.blockedBySelectedCheckpoint`、9.5.2）なので、Phase BでもTarget単位で停止し、K0 / K1の各contextをno-op評価しない。
  このExportでは既存evidence上0件（B1 / B2-B1）
- **同じcontextの上位rungでのtrial**: escalationしたcontextでは、下位rungでtrial不採用になったCandidate（`candidateStableKey` が同じもの）を
  上位rungで再trialせず、trial budgetを追加消費しない（記録だけする、`skippedPreviouslyRejected`）。新しいCandidateは、ladder stateの
  残budgetがある場合だけtrialする（上記）。trial入力（baseline、support context、`G`）は
  同一なので結果も同じであり、これは9.2.19.10の「1回の代替探索の中でtrial不採用になったCandidateは再試行しない」をcontextのladder全体へ
  適用したものである。下位rungが `stopped_by_search_extent_bound` で終わった時点で、下位extent内のCandidateはすべてdeliver・trial済みなので
  （trial boundに達していない）、上位rungで新たにtrialされるCandidateは下位extentの外にある。analyzerはこのsuperset関係を検証し、
  破れていれば診断として記録する。こうして上位rungでの `found_R` を「extentを広げたため」と帰属させる
- **retryは別axis**。trial / rerun / timeout / OOMの再試行Research（retry policy、retry budget、execution envelope retry、trial-bound escalation、
  rerun-bound escalation等）を将来行うことは禁止しないが、extent escalationとは別のaxis・別Phase / 別Research conditionとして事前登録する。
  Phase Bには暗黙に含めない

### 6.3 typed outcomeの扱い

| outcome / 実行状態 | 意味（authority） | 扱い | 上位rung | measured |
| --- | --- | --- | --- | --- |
| `found_R` | §6.4のResearch trialが成立 | Target停止 | — | yes |
| `not_found_within_search_extent` | Searchがextent内外ともworkを使い切り、trialがfoundにならなかった（9.2.19.13、kernel `settled` 導出） | context close | しない | yes |
| `stopped_by_search_extent_bound` | extentが到達可能workを未確認のまま残した | extent escalation対象 | **する（唯一）** | yes |
| `stopped_by_candidate_trial_bound` | **その (Target, context) ladder全体の累積** trialが2件に達した後に、skip対象でない新しいCandidateがdeliverされた（そのrungだけのbudgetではない。kernel実装の判定をladder stateへ写したもの） | `candidate_trial_bound_reached` として記録 | しない | yes |
| `stopped_by_planner_rerun_bound` | **その (Target, context) ladder全体の累積** full Planner run数が8に達し、必要なrunを開始できなかった（そのrungだけのbudgetではない） | `planner_rerun_bound_reached` として記録 | しない | yes |
| `blocked_by_selected_checkpoint` | required checkpoint Entry（9.5.2、Target単位） | unitを実行せずTarget停止 | — | yes |
| process timeout | Research execution envelopeのwall-clock到達 | **unmeasured** | しない | **no** |
| OOM | heap limit到達 | **unmeasured** | しない | **no** |
| process failure / interrupted / unit未実行 | 異常終了・中断・policyが要求したのに実行されなかった | **unmeasured** | しない | **no** |

- timeout / OOM / process failure / interruption / 未実行を、Candidate 0、`not_found_within_search_extent`、`stopped_by_search_extent_bound`、
  extent不足のいずれへも読み替えない（B2-C2B2E〜Kと同じ）。unmeasured unitはincomplete evidenceであり、§9.4のcompletenessに必ず数える
- unmeasured / bound-stoppedなcontextがあっても、同じrung内の他contextへは進む。それはextentや共存について何も示さないので、そのcontextの
  上位rungは実行しない。そのTargetの判定には必ず記録として残す（§9.6）

### 6.4 Research trial `found_R`（9.2.19.6のResearch写像、Production semanticsではない）

1 unit内のtrialは、Production kernelのtrial loop（Search delivery → materialize → `O + G` / `-O + G` preflight → full Planner run +
Trace Replay → 判定）と同じ部品で行う。ただし入力と判定の一部を次のとおり置き換えた **Research専用の写像** である。

| 項目 | Production（9.2.19.6） | Phase Bの `found_R` |
| --- | --- | --- |
| reservationの源 | user-fixed Route集合 | speculative support context（K0 / K1）のcurrent Route |
| PlannerInputのresolution | 決定をmergeしたexplicit resolution | **B2系列と同じbaseline PlannerInputのまま**（Phase 0以来 `conflictResolutions = []`）。support Entryのresolutionを合成しない（G1） |
| 除外Route key | 現在Route ∪ 有効lineage | 当該Targetの現在Route（B2-B1 / B2-C1のcontext定義と同じ）。lineageは無い |
| 条件1 | `plan !== null` かつTrace Replay成功 | 同じ |
| 条件2 | 明示決定Entryがすべてselected | **support Entryがすべてselected**（reservationが前提とするCounter進行が実際に起きることの確認。明示決定Entryではない） |
| 条件3 | `G` とfixed Route集合のEntryを同時participantとするConflictが無い | `G` とsupport Entryを同時participantとするConflictが無い |
| 条件4 | `G` がselected、またはfixed Route集合外Entryとの暫定帰結だけで外れた | `G` がselected、またはsupport集合外Entryとの暫定帰結だけで外れた（`PlannerRunResult.routeCommitment` evidence） |
| `PlannerInput.options` | `conflictResolutionPlannerOptions(表示中Plan)`（§1のB。表示中PlanのStep数から導出し1000を超え得る） | §1のC `researchMaxPlanSteps = 20000`（B2系列と同じResearch条件。Phase Bには「表示中Plan」が無く、Bの導出をResearchで再現・置換しない。A / Bを変えない） |
| 保存 | actual repairのみ保存 | **保存しない**。lineageも作らない |

- `found_R` はPhase Bのpolicy停止信号であり、ProductionのPlanner Alternative outcome `found`、REQUIREMENTS 23.1の「代替として成立」とは
  別物である。typed resultに書くときもliteralを分ける
- K0 context（empty reservation）は条件2・3が空になる。それでも `G` がbaseline全体と共存するかは条件1・4で判定される
- Phase Bの実装でこの写像を既存部品の組み合わせで表せないことが分かった場合は、別の判定を発明せず、本書の更新（docs）を先に行う

## 7. budgetの整理

### 7.1 6つの別概念

| 概念 | 何を束ねるか | Production authority | Phase Bでの扱い |
| --- | --- | --- | --- |
| Search extent | Counter位置windowの上限（held位置も数える） | `PlannerAlternativeSearchExtent`、default `{ 4, 235, 4 }` | Research ladder L0 / L1 / L2（§5） |
| context budget | 1 Targetについて試すspeculative support contextの数・範囲 | **存在しない**（Productionはspeculative contextを生成しない） | K ≤ 1全context（§4.4） |
| Candidate trial bound | 1 request内で1 Targetにtrialする代替Candidate数 | `maxCandidateTrialsPerTarget = 2` | 値2は維持。同一 (Target, context) のextent ladder全体で累積共有（rungごとにresetしない） |
| Planner rerun budget | 1 requestで開始するfull Planner run数（retry含む） | `maxPlannerReruns = 8`（request-global） | 値8は維持。同一 (Target, context) のextent ladder全体で累積共有（rungごとにresetしない） |
| Search execution budget | Search 1回の計算時間・memory | **存在しない**（§7.5） | Research measurement envelope（wall-clock / heap） |
| Plan step bound | 1 full Planner runのPlanStep上限 | A. `defaultPlannerOptions.maxPlanSteps = 1000`（default / fallback）、B. Planner Alternativeのwhat-if / actual repairでは `conflictResolutionPlannerOptions(表示中Plan)` の導出値（1000を超え得る）（§1） | C. `researchMaxPlanSteps = 20000`（B2系列と同じResearch条件。A / Bと別物） |

これらを同じ「budget」として混同しない。特に、context数やextent rungの試行回数を `maxCandidateTrialsPerTarget` や `maxPlannerReruns` に
読み替えたり、それらへ合算したりしない。Phase Bで生じるunit数 × trial / rerunの総量は、Production budgetではなくResearch上の観測値である。

### 7.2 Planner rerun budget

`maxPlannerReruns = 8` はfull Planner runの開始回数を数えるrequest-global budgetである（9.2.19.12）。Search、reservation導出、
materialization、preflightは数えず、**Searchの計算時間を制限しない**。変更しない。Phase BではProduction値8を維持し、同一 (Target, context) のL0 → L1 → L2 ladder全体で累積共有する
（`plannerRerunsUsed`、§6.2）。下位rungで開始したfull Planner run（runtime-unsupported retryを含む）はすべて累積に含め、上位rungで8回分を
再付与しない。`stopped_by_planner_rerun_bound` で止まったcontextは上位extent rungへ進めない。

### 7.3 Candidate trial bound

`maxCandidateTrialsPerTarget = 2` も現行Production authorityのままである。変更しない。Phase BではProduction値2を維持し、同一 (Target, context) のL0 → L1 → L2 ladder全体で累積共有する（`candidateTrialsUsed`、§6.2）。
`stopped_by_candidate_trial_bound` で止まったcontextは上位extent rungへ進めない。extent escalationしたcontextでは、下位rungでtrial不採用になった
Candidateを再trialせずbudgetを追加消費しない一方、新しいCandidateには残budget（`remainingCandidateTrials`）しか使えない。したがって上位rungの
trialは下位extent外のCandidateにだけ、かつladder全体で2件以内で行われる。
trial / rerun boundの再試行を研究する場合は、extent escalationとは別axisとして事前登録する（§6.2）。

### 7.4 context budget

Productionには存在しない概念である。Phase Bの「K ≤ 1全context」はResearch条件であり、Production化するには新しいbound（意味・default・
Browser測定）を正式仕様として定義する必要がある（Phase C以降）。既存boundへ流用しない。

### 7.5 Search execution budget

B2-C2B2Kでは、exact Candidateがdelivery index 0でも、Search完走（safety cap 1024まで）に約3,375 sかかった。B2-C2B2F / Gでは、
最初のCandidateをdeliverする前に30分を使い切った。したがってProduction復帰時には、「何件trialするか」「何回Plannerをrerunするか」だけでは
Search runtimeを制御できない。ただし本Phaseでは新しいProduction timeout値やwork boundを決めない。決めるのは次の境界までである。

- wall-clock timeout / process heap limitは **Research measurement envelope** としてだけ使う
- wall-clock timeoutをRouteの意味論的なnot-found判定に使わない。timeoutはunmeasured（§6.3）
- Production用Search work budgetを導入する場合は、可能なら **実行速度に依存しないdeterministic work unit** をauthorityとする
  （同じ入力・同じbudgetで、機械や負荷によらず同じoutcomeになること）

現行Search instrumentationに、Production契約として使える安定work counterがあるかを確認した（2026-10-07、main `8b7c218`）。**存在しない**。

| 候補 | 実体 | Production authorityにできない理由 |
| --- | --- | --- |
| `yields`（B2-C2B2Kの27,490,874等） | `searchExecution.ts` のcheckpoint 50回ごとの `yieldControl()` 呼出し数 | checkpointの配置とinterval（50）は実装詳細で、正式仕様にない。Search最適化で1 checkpoint当たりの仕事量が変わる（B2-C2B2I / Jはstate当たり時間を変えた） |
| `onWorkSettled`（`PlannerAlternativeSearchInstrumentation`） | `TargetSearchScheduler.step()` が1 work itemをsettleした回数 | work 1件の大きさが不均一（held-aware Bonus depth 1件が数億stateを生成し得る、B2-C2B2G / H）。費用に比例しない |
| `onGogmaReservedDepth` 等の生成state数 | benchmark専用observerのaggregate count | `PlannerAlternativeSearchExecutionOptions.instrumentation` は「Production callerは常にundefined」「Search identity / ordering / terminationの一部ではない」と定義された実行専用seamで、Search semanticsの契約ではない |
| `PlannerAlternativeSearchSummary` | delivered / excluded / exhausted / stoppedByExtent | 計算量を表すfieldを持たない |

このため本Phaseでは、架空のwork unitを正式仕様として捏造しない。「Search work budgetのsemantic authority確定」（どの量を数えるか、
extent / ordering / lazy性との関係、`stopped_by_search_extent_bound` 等のtyped outcomeとの区別、決定性）は、必要なら **2-C2.7-Bの前、
または2-C2.7-Cの前の独立した小Phase** として分離できる。Phase B自体はResearch envelope（wall-clock / heap）で行い、timeoutをunmeasuredとして
扱えば成立する（§9）。B2-C2B2Kの `yields` 等をProduction budget authorityと断定しない。

## 8. 既存Global Planner Phase 0 prototypeとの関係

`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH.md`（Phase 0）のprototypeは、oracleを探索入力に使わずに次まで到達している。

| 項目 | 値 |
| --- | --- |
| 構成 | baselineのselected / progressed Entryを保持し、残りTargetをordinary Candidate Search（extent 350 / 500 / 1500）でsequential projected stateから順に再検索 |
| 完成 | **42 / 43**（selected 42、Conflict 2、rejected 1） |
| steps | 7,330（Research `maxPlanSteps = 20000`） |
| 時間 | final Planner約30.6 s、Search約586.8 s、全体約657.5 s |
| memory | process peak maxRSS約2.4 GiB |

これはPlanner Alternative Searchのreservation context研究とは **異なる探索構成** である。

- 前段の保持Route集合を完成させた **将来状態（projected state）** から後続TargetをSearchする
- そのため前段区間内の空きCounter位置を利用できない（PLANNER_CONFLICT_REPAIR_DESIGN 3.1の指摘と同じ制限）
- current Planner Alternativeのfixed Route reservation semantics（held位置を跨いで現在originから探す）そのものではない

位置づけ:

- **補助evidence**: Global自動置換は既に42 / 43まで到達しており、そのとき主コストはfinal schedulerではなく **Route discovery**（Search）である
  （Search約89 %）。B2系列で見たSearch runtime問題と整合する
- Phase 0方式をそのままProductionへ採用するとは決めない。Phase 0のfuture-state searchを9.2.19のreplacement（現在originからのreservation付き
  代替探索）として扱わない
- B2系列とPhase 0は互いを否定する研究ではない。

  | 研究 | 探索構成 |
  | --- | --- |
  | B2系列 | reservationを利用して **現在origin** から共存Routeを探す |
  | Phase 0 | completion後の **projected state** から逐次Routeを探す |

  Global Planner段階（2-C2.8以降）では、両者を組み合わせる設計（例: reservationで現在originから探し、見つからないTargetだけprojected stateへ
  回す）も候補になるが、本Phaseでは決めない

## 9. Phase 2-C2.7-Bの事前登録

Phase Bは本節をpre-registrationとして実装・実行する。Phase B固有の実装値（execution envelope、concurrency、raw format等）はPhase BのPRで
formal run前にcommitしてよいが、本節の規則と矛盾させない。矛盾が必要になった場合は、Phase Bを始める前に本書を更新する。

### 9.1 対象と条件

| 項目 | 値 |
| --- | --- |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（B2系列と同じ、commitしない） |
| population | E1 11 Target（B2-C2B1 RESULTのcohort E1からauthority parserで機械導出、IDをsourceへ書かない）。`oracleGuidedTargetPopulation = true` |
| context | P1（§4.1）、K ≤ 1全context（§4.4） |
| extent | L0 → L1 → L2 共通ladder（§5） |
| escalation | §6.2のrung-major規則。上位rungへ進めるのは `stopped_by_search_extent_bound` のcontextだけ。trial bound / rerun bound / unmeasuredのcontextは上位rungで再実行しない。checkpoint blockはTarget単位で停止。retryなし（別axis） |
| trial | §6.4の `found_R`。`maxCandidateTrialsPerTarget = 2` / `maxPlannerReruns = 8`（値は維持）を、同一 (Target, context) のextent ladder全体で累積共有する（§6.2。rungごとにresetしない） |
| Search | 現行mainの `visitPlannerAlternativeCandidates()` 無変更。capture policy（C4C等）は付けない（Production kernelと同じlazy delivery） |
| CalculationContext / RNG | B2系列と同じ（`production-rng:c5-e7`、`researchMaxPlanSteps = 20000`。§1のC。Production A / Bを表さない） |
| execution envelope | unitごとに共通のwall-clock上限・heap上限、retryなし、fallbackなし。値はPhase BのPRでformal run前に固定する。B2-C2B2Kの所要時間を見て値を選ぶ場合は `oracleInformedExecutionEnvelope = true` と記録する |
| instrumentation | Production behaviorを変えないものだけ。profiler等を付ける場合はformal runと分ける |

### 9.2 formal validity（いずれか違反なら `B2C27B_INVALID`）

- measurement HEADがclean（runnerのstart attestationで記録し、analyzerが独立に検証）
- Export SHA-256一致
- Production RNG（`PRODUCTION_RNG_ENGINE_VERSION`）/ CalculationContext / Research `maxPlanSteps` 一致
- authority hash chain（B2-C1 / B2-C2B1 / B2-B1 RESULT、oracle RESULT、manifest）一致
- scheduler / Search child / trialがoracle（§2.4の表）を読まない。population manifestはTarget IDだけで、全Targetに同一policyを適用する
- Target個別のoracle情報をsourceへhard-codeしない（testで確認）
- context ordering（P1 key、K ≤ 1 scope）、extent ladder、escalation規則、task生成順序、execution envelopeをformal run開始前に確定し、
  start attestationへ記録する。run終了後に条件を追加・変更しない
- Production source changed files（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）= `[]`、Production defaultの
  extent / trial / rerun、`defaultPlannerOptions`、`conflictResolutionPlannerOptions` 不変
- speculative support Entryについて `PlannerConflictResolution` / lineageを合成していない（G1、testで確認）
- 上位rungで実行したunitのcontextが、すべて直前rungで `stopped_by_search_extent_bound` だった（§6.2の遵守）。checkpoint block Targetで
  unitを実行していない。下位rungでtrial不採用になったCandidateを上位rungで再trialしていない
- 同一 (Target, context) について `candidateTrialsUsed <= 2`、`plannerRerunsUsed <= 8`（ladder全体の累積）。各上位rung unitの開始時のladder state
  （`candidateTrialsUsed` / `plannerRerunsUsed` / `previouslyRejectedCandidateStableKeys`）が、直前rung unitの終了時のladder stateと一致する
  （消費量が引き継がれている）ことをanalyzerがunit記録から検証できるよう、unitごとに開始時・終了時のladder stateを記録する
- `found_R` RouteのSearch reservation違反0、delivered costの非単調0、Search child内のcontext再導出不一致0
- raw / RESULT不整合0

### 9.3 policy-required unit

policy-required unitは、§6.2の規則がformal run中に実際に要求したunitである（`found_R` で停止した後のunitは要求されない）。
L1 / L2で要求されるのは、直前rungで `stopped_by_search_extent_bound` になったcontextのunitだけであり、trial bound / rerun bound / unmeasuredの
contextの上位rungは要求されない（したがって未実行としても数えない）。execution unit（rungごと）とtrial / rerun budget scope（(Target, context)）は
異なり、上位rungのunitがpolicy-requiredになってもtrial / rerun budgetは回復しない（§6.2）。
task生成は決定的で、同じtyped outcome列からは同じunit列が出る。ただしtimeoutはwall-clockに依存するので、**実行環境が実現unit集合を
変え得る**。analyzerは実現したunit列とその理由をすべて記録する。

### 9.4 execution completeness

policy-required unitに1件でもtimeout / OOM / process failure / interruption / 未実行があれば、未測定を0件として扱わず、
aggregate decisionは **`B2C27B_INCOMPLETE`** とする（per-Target classと回収数は下限として併記する）。

cost観測（予測ではない）: B2-C2B2Bでは共通L1 × 32 contextの224 taskに10.6時間（concurrency 1、10分上限、timeout 33件）、
B2-C2B2Cでは共通L2の128 taskでtimeout 108件だった。Phase Bはtrial停止でunit数を減らす一方、L2 unitやtime_bound Targetは長時間になり得るので、
INCOMPLETEは現実的な結果として扱う。

### 9.5 primary question

> oracleを実行入力に使用しない事前登録policyが、E1 11 Targetについて、許容されたResearch context / extent escalationの中から
> existing Searchを実行し、oracle exact Routeをpost-hocで回収できるか

oracle exact判定はpost-hoc analyzerだけが行う。Targetの **exact recovered** は、「そのTargetでpolicyが停止したunitの `found_R` Routeが、
oracle Routeと `candidateStableKey()` で一致する」ことである。`found_R` 以外でdeliverされたCandidateにexactが含まれていた場合は
診断field（`exactDeliveredButNotFound`）として記録するが、recoveredに数えない。

### 9.6 per-Target class（post-hoc、排他、上から順に判定）

compatible context / required extentはanalyzerがB2-C1 / B2-C2B1 RESULTから読む（schedulerは読まない）。
「covering rung」= そのTargetのrequired extentをcoverする最小のrung、「covering unit」= compatible context × covering rung以上のunit。

まずcompatible contextごとに、このrunで最後に実行したunitから **context verdict** を決める。trial bound / rerun bound / unmeasuredの
contextは上位rungへ進まない（§6.2）ので、verdictはその時点のoutcomeで確定し、他contextを上位rungまで走らせた結果で書き換わらない。

| context verdict | 条件 |
| --- | --- |
| `not_executed` | どのrungでも実行していない（Targetがそれより前に停止した） |
| `covered_measured` | covering unitを実行し、measuredだった |
| `covered_unmeasured` | covering unitを実行したが、timeout / OOM / failure / interruption / 未実行 |
| `unmeasured_below_covering` | covering rungより下のrungでunmeasuredになり、上位rungへ進まなかった |
| `trial_bound_below_covering` | covering rungより下のrungで `stopped_by_candidate_trial_bound`（`candidate_trial_bound_reached`） |
| `rerun_bound_below_covering` | covering rungより下のrungで `stopped_by_planner_rerun_bound`（`planner_rerun_bound_reached`） |
| `closed_below_covering` | covering rungより下のrungで `not_found_within_search_extent`。compatibleでrequired extentが上位にあるのに `exhausted` になったことを意味するので、authority間の不整合候補として診断にも記録する |
| `extent_bound_at_ladder_top` | L2でも `stopped_by_search_extent_bound` で、L2がcovering rungでない（E1はL2で全件coverされるので理論上0件） |

Target class（上から順に最初に当てはまるもの）:

| class | 条件 | 意味 |
| --- | --- | --- |
| `exact_recovered` | `found_R` Route = oracle exact | 成功 |
| `found_non_oracle` | `found_R` で停止したがRouteはoracle exactでない | oracle-free信号が別のRouteで止まった。共存可能な別解かどうかは本Phaseでは主張しない（Global共存は2-C2.8で検証） |
| `blocked_by_selected_checkpoint` | Target単位のcheckpoint blockで停止（E1では既存evidence上0件） | 探索対象外 |
| `context_not_reached` | compatible contextのverdictがすべて `not_executed` | selectorで必要contextへ到達しない |
| `searched_not_recovered` | `covered_measured` が1件以上、または `closed_below_covering` が1件以上 | Searchは完走したがexactを回収しない。sub-reason: covering unitのoutcome（`not_found_within_search_extent` / `stopped_by_search_extent_bound` / `candidate_trial_bound_reached` / `planner_rerun_bound_reached`）、exact未delivery / trial reject、`closed_below_covering` |
| `execution_unmeasured` | `covered_unmeasured` または `unmeasured_below_covering` が1件以上 | execution cost上限で未測定 |
| `stopped_by_trial_or_rerun_bound` | `trial_bound_below_covering` または `rerun_bound_below_covering` が1件以上 | covering rungより前にtrial / rerun boundで止まった。sub-reason: `candidate_trial_bound_reached` / `planner_rerun_bound_reached`。extent不足ではない |
| `extent_ladder_insufficient` | 残り（`extent_bound_at_ladder_top`） | allowed extent ladderでは届かない |

- Target classは1つだが、それと独立に、Targetごとに全contextの最終状態別件数（closed / extent escalation / `candidate_trial_bound_reached` /
  `planner_rerun_bound_reached` / unmeasured）とcompatible contextごとのverdictをfieldとして保持する。class判定の優先順位で他の事実を消さない
- trial bound / rerun bound / unmeasuredのcontextを `extent_ladder_insufficient` へ分類しない。extent不足と言えるのは、extent boundで
  escalationを続けてladder上限でも届かなかった場合だけである

stopReason（`found_R` / `blocked_by_selected_checkpoint` / `no_extent_escalation_context` / `ladder_exhausted`）、停止rung、停止context rank、
各unitのtyped outcome、unit開始時・終了時のladder state（`candidateTrialsUsed` / `plannerRerunsUsed` / `remainingCandidateTrials` /
`remainingPlannerReruns`）、`skippedPreviouslyRejected`、Search elapsed、heap / RSS、trial数、full Planner run数はclassとは別に記録する
（JSON schemaと実装名はPhase Bで決める）。

### 9.7 aggregate decision（上から順に判定）

| decision | 条件 |
| --- | --- |
| `B2C27B_INVALID` | §9.2のいずれかに違反 |
| `B2C27B_INCOMPLETE` | policy-required unitにunmeasuredが1件以上（§9.4）。class件数は下限 |
| **`B2C27B_E1_ORACLE_FREE_EXECUTION_RECOVERED`** | invalid 0、unmeasured 0、`exact_recovered` 11 / 11 |
| `B2C27B_E1_PARTIAL` | invalid 0、unmeasured 0、`exact_recovered` 1〜10 |
| `B2C27B_E1_NOT_RECOVERED` | invalid 0、unmeasured 0、`exact_recovered` 0 |

PARTIAL / NOT_RECOVERED / INCOMPLETEは、必ず §9.6のclass別件数を併記する。単一のFAILEDへ潰さない。

次Phaseへの分岐（recommendationの方向。decision条件ではない）:

| 支配的なclass | 次に扱う問題 |
| --- | --- |
| `exact_recovered`（RECOVERED） | Phase C（Production compatible architecture） |
| `found_non_oracle` | 停止信号は機能している。oracle exactより、`found_R` Route集合のGlobal共存（2-C2.8）を先に検証する |
| `context_not_reached` | context ordering / scopeの再研究 |
| `stopped_by_trial_or_rerun_bound` | trial / rerun boundの研究。extent escalationとは別axisとして事前登録する（§6.2） |
| `extent_ladder_insufficient` | ladderの再研究（oracle-freeなrung判定） |
| `execution_unmeasured` | Search execution budgetのauthority（§7.5）またはruntime |
| `searched_not_recovered` | trial bound / lazy delivery順序とoracle Routeの関係 |

### 9.8 Phase Bの成果としてformalに言えること・言えないこと

`B2C27B_E1_ORACLE_FREE_EXECUTION_RECOVERED` でも、言えるのは「このExport・E1 11 Target・事前登録policy・Research envelopeで、
oracleを実行入力に使わずにexact oracle Routeを回収した」ことまでである。P1 / ladder / K ≤ 1 / populationがoracle-informed designである
（§2.3）以上、oracle非依存policyの存在、Production default、Production runtimeとしての許容、E2 / residual 3、43 / 43 Global Planの成立は
言えない。

## 10. ロードマップとProduction復帰境界

### 10.1 2-C2.7-B

E1 11 Targetについて、§9のoracle-free execution policyをformal measurementする。Production変更なし。

### 10.2 2-C2.7-C

Phase Bが成立した場合（RECOVERED、または `found_non_oracle` を含めて停止信号が機能したと読める結果）に、Production compatible architectureを
設計する。必要ならdocs-onlyを先行する。少なくとも次を扱う。

- speculative support contextをuser-fixed Routeへ偽装しない型・経路（§2.2のG1。reservationの源を区別するtyped input、resolution /
  lineageへ書かないことのtest）
- 現行9.2.19の1段repair semanticsを壊さない（what-if / actual repairのfound判定、scenario composition、lineage、保存APIのauthorityを維持）。
  speculative support探索を既存what-if / actual repairの中で暗黙に行わない
- Search policy（context ordering、ladder、停止信号）とDomain / Worker / Persistence境界の整理（Search DomainへConflict DTOを渡さない9.2.9、
  Worker境界内でdefaultを渡す9.2.19.12の責務分離）
- context budget・Search execution budgetの正式なbound定義（§7.4 / §7.5。既存boundへ流用しない）
- Browser Workerでの実測（Node / Vite SSRの値をProduction runtimeの根拠にしない）

### 10.3 Production復帰の前提（いずれも未充足）

- **REQUIREMENTS 23の契約変更が先**。現行契約は「明示的な選択が無い競合については自動で再検索を行わず、競合としてそのまま提示する」
  であり、speculative support contextによる自動代替探索はこれと両立しない。docs-onlyの契約変更PRとプロジェクトオーナーの決定が必要
- speculative support contextを試した事実を、Conflictの選択済み状態、explicit resolution、lineage decisionとして保存しない
- Production default（extent / trial / rerun）と `maxPlanSteps` のauthority（§1のA `defaultPlannerOptions`、B `conflictResolutionPlannerOptions`）の
  変更は、Research ladderやResearch `researchMaxPlanSteps = 20000` ではなくBrowser Worker測定とdocsで決める。speculative support探索を
  Productionへ入れる場合も、そのfull Planner runの `PlannerInput.options` を決めるのはPhase Cの設計であり、Cの20000を流用しない
- Search work budgetのsemantic authority（§7.5）
- 同じPlannerInputに対するPlanner出力が変わる場合は、AGENTS.mdの規則どおり `CURRENT_CALCULATION_APP_SCHEMA_VERSION` の境界を判断する
- E1以外（E2、residual 3、別Export）での評価

### 10.4 2-C2.8以降（Global Plannerへの復帰）

- E2 9 TargetのK2 context breadth（Target-relative K2 feature / grouping）
- residual 3 Target、alternative-to-alternative support
- generated alternative Routeが別Targetのheld supportになる反復
- stale旧Route invalidation、chained replacement（9.2.18 / 9.2.19.9 / 9.2.19.10との整合）
- Phase 0（projected state）とreservation探索（現在origin）の組合せ（§8）
- 最終43 / 43 full Planner、Conflict 0、`resource_conflict` rejection 0、Trace Replay成功

Issue #154はCloseしない。

## 11. 本Phaseで変更していないもの

Production source、Search algorithm、Search ordering / comparator、Planner scheduler、Planner Alternative kernel、Worker protocol、UI、Persistence、
schema / version（`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13）、RNG
（`production-rng:c5-e7`）、`defaultPlannerAlternativeSearchExtent`、Candidate Search default、`maxCandidateTrialsPerTarget`、`maxPlannerReruns`、
`defaultPlannerOptions`、`conflictResolutionPlannerOptions`、B2-C2B2I / B2-C2B2J optimization、既存RESULT JSON。formal Search run、benchmark run、RESULT JSON生成、oracle再計算、
新しいCandidate生成は行っていない。

## 12. 本Phaseのacceptance criteria

| # | 項目 | 該当箇所 |
| ---: | --- | --- |
| 1 | user-fixed Routeとspeculative support contextを区別 | §2.1 / §2.2 / G1 |
| 2 | P1をProduction orderingとして確定していない | §4.1 / G3 |
| 3 | L1 / L2をProduction default extentとして確定していない | §5.2 / G4 |
| 4 | oracle-informed policy designとoracle-free executionを区別 | §2.3 / §2.4 |
| 5 | Phase Bのcalculation / schedulerからoracle情報を排除する契約 | §2.4 / §9.2 / G2 |
| 6 | extent / trial / Planner rerun / Search execution budgetを別概念として整理（extent escalationでtrial / rerun budgetを再付与しない、maxPlanStepsのA / B / Cを分離） | §1 / §6.2 / §7 / G5 / G11 / G12 |
| 7 | wall-clock timeout / OOMをnot-foundへ読み替えない | §6.3 / §7.5 / G6 / G7 |
| 8 | E1 / E2 / residual 3の役割分離 | §4.3 |
| 9 | Phase 0 prototype 42 / 43との関係 | §8 |
| 10 | Phase Bのformal validity / incomplete / success / partial failure rule | §9.2〜§9.7 |
| 11 | Phase C / Global Planner復帰への入口 | §10 |
| 12 | REQUIREMENTS / PLANNER_SPECのProduction semanticsを変更していない | §0 / §11 |
| 13 | Production source changed files = `[]` | §11（docs 2 fileのみ） |

## 13. validation

- `git diff --check`
- `git diff --name-only main...HEAD`（docs以外の変更が無いこと）
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無いが、既存testがdocsを参照していないことの確認として実行。
  結果はPRに記載）
- 長時間のformal benchmark / Search measurementは実行していない

## 14. レビュー対応（PR #212、初版 `0c8e5d9` に対する修正）

- `maxPlanSteps` を、A. Domain default（`defaultPlannerOptions.maxPlanSteps = 1000`、default / fallback）、B. Planner Alternative
  Production runtime（`conflictResolutionPlannerOptions(表示中Plan)` の導出値、1000を超え得る）、C. Research条件（`researchMaxPlanSteps = 20000`）に
  分離した（§1 / §6.4 / §7.1 / §9 / §10.3 / §11、G12）。初版の「Production `maxPlanSteps = 1000`」はPlanner Alternativeについて不正確だった
- extent escalationを `stopped_by_search_extent_bound` のcontextだけに限定した。trial bound / rerun bound / unmeasuredのcontextは上位rungへ
  進めず、extent経由のbudget再付与をしない。上位rungでは下位rungのtrial不採用Candidateを再trialしない。retryは別axisとした（§6.2 / §6.3 / §7.2 /
  §7.3、G11）。ただしこの時点ではtrial / rerun budgetをunitごとに与えていたため、escalationしたcontextでbudget再付与が起き得た。§15で累積共有に修正した
- `blocked_by_selected_checkpoint` をProduction kernelと同じくTarget単位の停止にした（§6.2 / §6.3）
- per-Target classをcontext verdictから決める形にし、trial bound / rerun bound / unmeasuredを `extent_ladder_insufficient` と誤分類しないよう
  `stopped_by_trial_or_rerun_bound` とsub-reason / fieldを追加した。aggregate decision名は変更していない（§9.3 / §9.6 / §9.7）

## 15. 再レビュー対応（PR #212、`a83f02e` に対する修正）

- extent escalationの際にtrial / rerun budgetがrungごとに再付与されないよう、execution unit（(Target, context, rung)）とtrial / rerun budget
  scope（(Target, context)）を分けた。`maxCandidateTrialsPerTarget = 2` / `maxPlannerReruns = 8` の値は維持し、L0 → L1 → L2のladder全体で
  累積共有する（`candidateTrialsUsed` / `plannerRerunsUsed` / `previouslyRejectedCandidateStableKeys` を引き継ぐ）。extent escalationで
  増えるのはSearch extentだけである（§6.2 / §6.3 / §7.1〜§7.3、G11）
- `stopped_by_candidate_trial_bound` / `stopped_by_planner_rerun_bound` を、ladder全体の累積budgetに基づくoutcomeとした（§6.3）
- formal validityへ累積上限（2 / 8）と、上位rung unit開始時のladder stateが直前rung終了時と一致することのanalyzer検証を追加した（§9.2）。
  policy-required unitとbudget scopeが異なることを明記した（§9.3）。診断fieldの案を追加した（§9.6）
