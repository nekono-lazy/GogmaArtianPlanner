# Global Planner Research Phase 2-C2.6-A2（timeout orientation targeted runtime analysis）

Refs #154。Research only。Production semantics、defaults、schema / version、Persistence、UIは変更していない。Production sourceへの変更は
Planner Alternative kernelへの任意の観測用seam（default undefined、Production callerは指定しない）1点のみ。
timeout解消のoptimization、Candidate portfolio再構築（C2.6-B）、extent拡張、budget延長、global assignmentは行っていない。

## 1. 結論（9 / 9件がSearch中に30分へ到達）

Phase 2-C2.6-Aで30分timeoutとなった9 orientationを、同じ条件で1回ずつprofileした。

| 分類 | 件数 |
| --- | ---: |
| completed | 0 |
| **timeout_in_search** | **9** |
| timeout_in_preflight | 0 |
| timeout_in_full_planner_run | 0 |
| timeout_elsewhere | 0 |
| OOM / process failure | 0 / 0 |

kind別: `same_gogma_counter` 2件（c6-p1、c14-p0）、`same_skill_counter` 7件（c13の6件、c20-p1）。全件timeout_in_search。

- 9件の観測済みkernel時間 約16,160秒のうち **Planner Alternative Search 16,099秒（99.6%）**、trial preflight 18秒、full Production
  Planner run 28秒、kernel preparation 17秒。
- 完了したfull Planner runは5回のみ（c13-p0 / p2で各1、c13-p6で3）、各 **5.4〜5.8秒**。preflightは各約3.7秒。
  30分をfull Planner rerunが消費したorientationは1件も無い。rerun budget使用は最大3 / 8。
- Search内部は **held-aware Gogma（Bonus）streamが支配的**: Gogma generated statesは1 Target Searchで最大3.2億、Skillは全Targetで
  states 30以下・maxDepth 4以下。完走したSearch 17件はすべて `stopped_by_search_extent_bound`（Gogma depth 234 / extent 235まで
  到達、Candidate 0件）か、Candidate 1件のfoundだった。
- **participant未到達2件**（15829bfe、fea60316）は、それぞれc6-p1 / c14-p0の唯一の非fixed Targetで、そのSearch自体が30分では終わらない
  （Gogma depth 69 / 51まで、Candidate 0件、trial 0件）。

**次Phase推奨（事前登録ruleの判定: A）**: Search runtime optimization（H6: held-aware Gogma stream generation量の局所化）を優先する。
c13は1 Target当たり100〜1,800秒のSearchが9 Target分直列に積まれる構造（C要素）も併せ持つが、単一TargetのSearch自体が30分に届く
orientationが大半なので、portfolio / kernel schedulingより先にSearch 1回のruntimeを下げる必要がある。C2.6-Bへは進めない（§11）。

## 2. authorityと位置付け

参照: `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md` 5.6.8、`docs/PLANNER_SPEC.md` 9.2.19、
`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26A.md`。

C2.6-A RESULT（`docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json`、SHA-256 `dab2f27a1ca94e5db38279e3848f76d033710c38d6e838da227e36e78c67b171`）
は **対象選択とparityのauthorityにのみ** 使い、Search / Planner calculation inputには使っていない。kernel taskはcurrent baseline自身の
orientationから、C2.6-Aと同じ `phase2c26aKernelTasks()` / `runPhase2C2Kernel()` で組み立てた。

## 3. 変更境界

| 役割 | ファイル |
| --- | --- |
| Production observer seam | `src/domain/planner/alternative/plannerAlternativeKernel.ts`（`PlannerAlternativeKernelOptions.instrumentation`） |
| seam semantic neutrality test | `src/domain/planner/alternative/plannerAlternativeKernel.instrumentation.test.ts` |
| authority parse・parity・selection・stage分類・child progress tracker | `src/benchmarks/plannerGlobalPhase2C26A2.ts` |
| post-hoc analysis（formal validator・timeline・stage attribution・next rule） | `src/benchmarks/plannerGlobalPhase2C26A2Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A2.test.ts` |
| runner / analyzer | `scripts/run-planner-global-phase2c26a2.mjs` / `scripts/analyze-planner-global-phase2c26a2.mjs` |
| 旧C2 helperへのpass-through（optional `kernelInstrumentation`） | `src/benchmarks/plannerGlobalPhase2C2.ts` |
| 既存isolation testの更新（seam経由のみを許す形へ正確化） | `src/benchmarks/plannerAlternativeBenchmarkIsolation.test.ts` |
| committed evidence | `docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json` |

### 3.1 observer seam

`PlannerAlternativeKernelInstrumentation`:

- `onEvent(event)`: `target_started` / `target_skipped_checkpoint` / `target_stopped_rerun_bound` / `search_started` /
  `candidate_delivered` / `trial_started` / `preflight_started` / `preflight_completed` / `full_planner_run_started` /
  `full_planner_run_completed`（`runner.run()` の直前・直後） / `trial_completed` / `search_completed` / `target_completed` /
  `kernel_completed`。eventはTarget ID・Target ordinal・trial index・Candidate stable key・rerun budget used / limit・countsだけを持ち、
  Candidate / Route / Entry / PlannerResult / timestampを持たない。同期呼び出し、awaitせず、戻り値は読まない。
- `searchInstrumentationForTarget(targetWeaponId, ordinal)`: そのTargetのSearchへ既存 `PlannerAlternativeSearchInstrumentation` を渡すだけ。
- default undefined。Production caller（`runPlannerAlternativeScenario()`）はexecution optionsと共有budgetだけを渡す（テストで固定）。
  instrumentationなしの経路では追加計算を行わない（Candidate keyの計算も `onEvent` がある時だけ）。

semantic neutrality: 6 fixture（found、preflight refused→found、trial bound、rerun bound、extent stop、checkpoint blocked）で
instrumentationなし / `undefined` 明示 / あり（戻り値を返すobserver）の3通りのkernel resultが完全一致（Target outcome・Candidate順序・
trial record・`generatedSelected`・search summary・`plannerRerunsUsed`）。またnon-formal smoke（c0-p0、c2-p0）でもTarget outcome・
trial key SHA-256・reruns がC2.6-A RESULTと一致した。

## 4. 条件（C2.6-Aと同一、parity検証済み）

| 項目 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| measured HEAD / analysis HEAD | `9bb89e988c619965473cf5ef7a8413d49f97bf4f` / 同（`calculationCodeChangedSinceMeasuredHead = []`） |
| benchmarkCodeSha256 | `e146d5b3f477a5cc4fcf8982bcdb413b9ac54699eda4a94b25d280d0151622d8`、uncommitted false |
| child | fresh Node child per orientation、`--max-old-space-size=8192`、concurrency 3、budget 30分、`setImmediate` yield、Research `maxPlanSteps` 20,000 |
| extent / bounds | `{ N 4, G 235, S 4 }` / `{ trials 2, reruns 8 }`、lineage空 |
| CalculationContext | appSchema 17、master 4、`production-rng:c5-e7` |
| 観測 | lifecycle eventごとにchildがrecordを同期file書き込み + IPC、5秒heartbeat（Search aggregate・prediction count・memory・yield）。memoryは250 ms local sample |
| 実行 | 2026-09-29 16:32Z開始、全体約90分、各orientation 1回（retryなし） |
| 環境 | Node v24.19.0、Windows 11 x64、Ryzen 7 9700X（16 logical）、RAM 32 GB |

parity（runnerが測定前に、analyzerが測定後に独立に再検証）: C2.6-A RESULTのfail-closed条件（formal、formalRunValidation valid、
oldC2Comparability valid、54 / completed 45 / OOM 0 / timeout 9 / failure 0、`timeout_without_out_of_memory`）すべて充足。current baseline
（Target / completed / termination / Plan steps / Conflict数・kind別・signature / selected Target / orientation数）、順序付きorientation ID、
orientation identity・metadata、timeout orientation metadataがすべて一致。Export SHA・heap・concurrency・budget・extent・bounds・
maxPlanSteps・yield・CalculationContext・lineageも一致。selectionはC2.6-A RESULTの `perOrientation[].child.outcome === 'timeout'` から
導出した9件と完全一致（missing / duplicate / foreign / completed混入 / metadata mismatch 0）。9 IDはsourceにhard-codeしていない。

## 5. orientationごとの到達状況

| orientation | kind | 非fixed Target | kill時stage | active Target（ordinal） | 開始Target / 完了Target | full run | kill時点Target経過 |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: |
| c6-p1 | Gogma | 1 | Search | 15829bfe（0） | 1 / 0 | 0 | 1,793 s |
| c13-p0 | Skill | 9 | Search | 57126a5e（2） | 3 / 2 | 1 | 296 s |
| c13-p1 | Skill | 9 | Search | 02876df4（0） | 1 / 0 | 0 | 1,796 s |
| c13-p2 | Skill | 9 | Search | 711f7d15（4） | 5 / 4 | 1 | 20 s |
| c13-p3 | Skill | 9 | Search | 45b13c06（1） | 2 / 1 | 0 | 684 s |
| c13-p6 | Skill | 9 | Search | 8d233d8b（8） | 9 / 8 | 3 | 221 s |
| c13-p9 | Skill | 9 | Search | 2378d3e0（1） | 2 / 1 | 0 | 47 s |
| c14-p0 | Gogma | 1 | Search | fea60316（0） | 1 / 0 | 0 | 1,796 s |
| c20-p1 | Skill | 2 | Search | 9d817a9b（1） | 2 / 1 | 0 | 9 s |

全件の最後のlifecycle eventは `search_started` で、kill時点の観測済みkernel時間は1,794〜1,798秒（kernel開始はchild process起動の
0.8〜1.4秒後）。最後のheartbeatからkillまでは1.4〜4.8秒、heartbeat間隔の最大は10.1秒（同期区間による遅延）。

### 5.1 Target単位timeline（完了Targetの所要時間、Search own = trialを除くSearch時間）

| orientation | Target 0 | Target 1 | Target 2 | Target 3 | Target 4 | Target 5 | Target 6 | Target 7 | Target 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| c13-p0 | 02876df4 614 s extent | 45b13c06 884 s found（Search 874 + trial 9.5） | **57126a5e 296 s〜** | – | – | – | – | – | – |
| c13-p1 | **02876df4 1,796 s〜** | – | – | – | – | – | – | – | – |
| c13-p2 | 02876df4 419 s extent | 2378d3e0 697 s extent | 57126a5e 305 s found | 6c65c924 352 s extent | **711f7d15 20 s〜** | – | – | – | – |
| c13-p3 | 2378d3e0 1,109 s extent | **45b13c06 684 s〜** | – | – | – | – | – | – | – |
| c13-p6 | 02876df4 220 s extent | 2378d3e0 315 s extent | 45b13c06 258 s found | 57126a5e 140 s found | 6c65c924 181 s extent | 711f7d15 174 s extent | 813fb479 180 s extent | 820831d0 107 s found | **8d233d8b 221 s〜** |
| c13-p9 | 02876df4 1,746 s extent | **2378d3e0 47 s〜** | – | – | – | – | – | – | – |
| c20-p1 | 188571a7 1,785 s extent | **9d817a9b 9 s〜** | | | | | | | |
| c6-p1 | **15829bfe 1,793 s〜** | | | | | | | | |
| c14-p0 | **fea60316 1,796 s〜** | | | | | | | | |

（太字 = kill時にSearch中。extent = `stopped_by_search_extent_bound`、Candidate 0件。）Target順はkernelの安定順
（`createPlannerConflictWorks()`）で、fixed Targetが抜けるためorientationごとにずれる。

## 6. 問いへの回答

**Q1（c13 6件の到達Target数）**: 9 non-fixed Targetのうち、開始 / 完了は p0 3 / 2、p1 1 / 0、p2 5 / 4、p3 2 / 1、p6 9 / 8、p9 2 / 1。
最も進んだc13-p6でも最後のTarget 8のSearch中に30分へ達した。

**Q2（同じTargetで止まるか）**: 止まるTargetはorientationごとに **すべて異なる**（57126a5e、02876df4、711f7d15、45b13c06、8d233d8b、
2378d3e0）。同じTargetでもfixed側（= reservation）で所要時間が大きく変わる: 02876df4のSearchは220 s（p6）、419 s（p2）、614 s（p0）、
1,746 s（p9）、1,796 s以上（p1、未完）。

**Q3（主時間）**: c13 6件の観測時間10,770 sのうちSearch 10,715 s（99.5%）、full Planner run 28 s（5回）、preflight 18 s。
主時間はSearchである。

**Q4（Searchのどこか）**: Gogma streamが支配的。完了Searchの多くはGogma depth 234（extent上限）まで到達してCandidate 0件で終わり、
Gogma generated statesは完了Searchで1,441万〜2.46億、未完Search（c13-p1 Target 0）で3.21億、frontierは最大2,188万（いずれもc13）。Skill streamはTarget当たりstates 6〜30、
transitions 39以下、maxDepth 3〜4。scheduler settled work itemは1 Search 31〜1,886。prediction countはkeepBonuses最大23万 / resetBonuses
2,773 / predictSkills 3,285（full runを含む）で、generated states（億単位）に比べて小さく、時間の主因はRNG prediction呼び出し数ではなく
Gogma state生成・frontier処理量と読める（Skill / Gogmaの時間配分自体は直接計時していない）。

**c6-p1 / c14-p0**: どちらも唯一の非fixed TargetのSearchだけで30分を使い切った（full run 0、trial 0、Candidate 0）。Gogma maxDepthは
69 / 51（extent 235の3割弱）、generated states 2.89億 / 3.13億、frontier 887万 / 758万。

**c20-p1**: Target 0（188571a7）のSearchに1,785 s（Gogma depth 233まで到達、extent stop、Candidate 0、generated 2.43億）を使い、Target 1
（9d817a9b）のSearch開始9秒後にkill。止まったのはTarget 1のSearchだが、30分のほぼ全部はTarget 0のSearchである。

## 7. 集計

| 項目 | 値 |
| --- | --- |
| 完了Search（17件）のSearch own時間 | min 98 s、median 315 s、max 1,785 s |
| kill時Search中（9件）の経過 | min 9 s、median 296 s、max 1,796 s |
| 完了full Planner run（5件） | min 5.4 s、median 5.6 s、max 5.8 s |
| preflight | 各約3.6〜3.8 s（同期区間） |
| Search aggregate最大 | settled 1,886、Skill maxDepth 4 / states 30 / transitions 39、Gogma maxDepth 234 / generated 3.21億 / frontier 2,349万 |
| prediction count最大 | Normal 111、Skills 3,285、Reset 2,773、Keep 230,043（c13-p6） |
| sampled max heap / RSS | 5.00 GB（c13-p1） / 5.97 GB |

## 8. formalに言えること

- 今回の元Export・同じProduction extent / bounds・Node 8 GB条件で、C2.6-A timeout 9件は再測定でも9件ともtimeoutで、その全件が
  Planner Alternative Search実行中に30分へ達した。preflight・full Production Planner runで30分に達したものは無い。
- full Planner runは1回約5.6秒、preflightは約3.7秒で、9件合計でも46秒程度。30分の99.6%はSearchである。
- Searchの支配streamはheld-aware Gogma（Bonus）streamで、Skill streamは無視できる規模である（state数の観測）。
- participant未到達2件（15829bfe、fea60316）が測定不能なのは、それを探索する唯一のorientationで、そのTarget 1件のSearchが30分では
  完了しないためである。
- c13では止まるTargetがfixed側ごとに異なり、同じTargetのSearch時間もreservationで数倍変わる。

## 9. まだ言えないこと

- 30分を超えればこれらのSearchがいつ終わるか、Candidateが見つかるか（timeoutはCandidateなしを意味しない）。
- Search内部でSkill / Gogmaそれぞれに何秒使ったか（時間は直接計時しておらず、state数からの推定のみ）。
- 他device・Browser Worker・他concurrencyでの挙動、run間ばらつき（各1回のみ）。
- 特定のoptimization（例: Gogma frontier縮約）がどれだけ効くか。
- C3 readiness、global assignmentの成否。

## 10. 次Phase推奨

事前登録rule（`phase2c26a2NextCase()`）: completedが過半 → D、timeoutの過半がfull run支配 → B、Search支配が過半 → そのうち過半で
Search時間が1 Targetに集中していればA、分散していればC、それ以外はmixed。結果は **A（Search支配 9 / 9、うち6件は1 Targetに集中）**。

1. **primary（A）: Search runtime optimization / H6 generation量の局所化**。対象はheld-aware Gogma（Bonus）stream。特に
   (a) extent 235までCandidate 0件で到達するSearch（c13の多数、c20-p1 Target 0）で何がstateを生成しているか、
   (b) c6-p1 / c14-p0でdepth 51〜69の時点で既に3億state近いのはなぜか（reservationのheld / blocked位置との関係）、
   (c) 同じTargetでもfixed側によってSearch時間が数倍変わる要因、をdepth別aggregate（RESULTの `searchDepths`）から局所化する。
2. secondary（C）: c13-p0 / p2 / p6はSearch時間が複数Targetに分散しており（c13-p6は9 Target平均約200 s）、Search 1回を数倍速くしても
   9 Targetの直列積み上げで30分に近づく。Search最適化の後、kernel scheduling / Target間で再利用できるSearch workを検討する
   （このPRでは実装しない）。
3. full Planner rerun / Trace Replayの最適化（B）は現時点で優先しない。

## 11. C2.6-Bへ進む条件の判定

- timeout原因は局所化できた（9 / 9 Search、支配streamはGogma）。
- participant未到達2件への影響は理解できた（その唯一のorientationのSearch自体が30分で終わらない）。
- しかし、portfolio再構築を先に行うと、同じGogma Searchを別の形で繰り返すことになり、2 participantは引き続き測定できない。

したがって **C2.6-Bはまだ次候補にしない**。Search runtime optimization（A）で上記2件と9 orientationが測定可能になるかを先に確認する。

## 12. limitations

- Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。
- concurrency 3はC2.6-Aと同じだが、今回は9件だけをpoolしたため同時実行相手が54件seriesと異なる。wall timeの厳密なbefore / after比較はしない。
- 各orientation 1回（retryなし）。run間ばらつきは測っていない。
- stage時間はlifecycle event間のResearch側時刻差。最後のheartbeat以降（最大4.8秒）は未観測。kill時のstageはchildが同期書き込みした最後のeventで確定。
- Skill / Gogmaの時間配分は直接計時していない。memoryはsampled max（true peakではない）。
- instrumentation（event同期file書き込み・IPC、Search observerの加算、counting Engine）は計算を変えないがwall timeへのoverheadはゼロではない。

## 13. 再現

```bash
node scripts/run-planner-global-phase2c26a2.mjs --export <Export> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --run-dir PLANNER_GLOBAL_PHASE2C26A2_RUN.local --output PLANNER_GLOBAL_PHASE2C26A2_RAW.json.local
node scripts/analyze-planner-global-phase2c26a2.mjs --run PLANNER_GLOBAL_PHASE2C26A2_RAW.json.local --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --output docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json
```

raw evidence（commitしない）: `PLANNER_GLOBAL_PHASE2C26A2_RAW.json.local`（SHA-256 `609262c988d6644e3f397b295c3758d8fcd17cf5c28303cb692d6d64b6ac7947`、31,245,558 bytes）、`PLANNER_GLOBAL_PHASE2C26A2_RUN.local/`（task、child別
`events.jsonl` / `heartbeats.jsonl`）、`PLANNER_GLOBAL_PHASE2C26A2_RUN.log.local`。committed RESULTではCandidate stable keyをSHA-256化している。
