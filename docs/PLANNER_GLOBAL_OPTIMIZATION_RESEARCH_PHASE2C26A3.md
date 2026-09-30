# Global Planner Research Phase 2-C2.6-A3（held-aware Gogma stream internal runtime localization）

Refs #154。Research only。Production semantics、defaults、schema / version、Persistence、UIは変更していない。Production sourceへの変更は
held-aware Gogma Bonus streamへの任意の観測用section境界seam（default undefined、Production callerは指定しない）と、その
`PlannerAlternativeSearchInstrumentation` へのpass-throughのみ。optimization、Candidate portfolio再構築（C2.6-B）、extent変更、
trial / rerun変更、Global Planner scheduling変更は行っていない。

## 1. 結論（「Searchが遅い」→「Search wallの約69%はheld-aware Gogma stream内6 sectionで直接説明でき、最大はfrontier_reduction_sort。
ただし事前登録の80%には届かず、Gogma stream内部だけではまだ説明しきれない」まで進んだ）

C2.6-A2で **Target 1件のPlanner Alternative Searchだけで30分を使い切った** 3 orientation（A2 RESULTからruleで導出: c6-p1、c13-p1、
c14-p0）を、concurrency 1・旧heavy depth observerなしで各1回profileした。3件ともtimeout（Search中、30分）、OOM 0、failure 0。

| orientation | Search wall（観測点） | measured Gogma sections | coverage | 最大section | unattributed |
| --- | ---: | ---: | ---: | --- | ---: |
| c6-p1 | 1,796.5 s | 1,284.4 s | **0.715** | frontier_reduction_sort 741.1 s（41.2%） | 512.2 s |
| c13-p1 | 1,794.9 s | 1,203.6 s | **0.671** | frontier_reduction_sort 626.7 s（34.9%） | 591.2 s |
| c14-p0 | 1,797.0 s | 1,248.8 s | **0.695** | frontier_reduction_sort 669.5 s（37.3%） | 548.2 s |

（% はSearch wallに対する割合。観測点は各childの最後のheartbeat。以降の未観測tailは0.5〜2.3秒。）

section別（3件合計、measured内の割合）:

| section | 合計 | measured比 | Search wall比 |
| --- | ---: | ---: | ---: |
| window_collection | 25.1 s | 0.7% | 0.5% |
| support_evaluation | 88.6 s | 2.4% | 1.6% |
| state_generation | 1,286.7 s | 34.4% | 23.9% |
| solution_materialization | 296.4 s | 7.9% | 5.5% |
| **frontier_reduction_sort** | **2,037.2 s** | **54.5%** | **37.8%** |
| exhaustion_scan | 2.7 s | 0.1% | 0.1% |
| 合計（measured） | 3,736.8 s | 100% | 69.3% |
| unattributed（section外） | 1,651.6 s | — | 30.7% |

**事前登録rule（§8）の判定: Case R**。3件中3件でcoverage < 0.80（0.671〜0.715）。したがって
「Gogma stream内部だけではSearch runtimeを説明できない」とし、optimizationへは進まない。

直接計時で確定した事実:

- held-aware Gogma 6 sectionの合計はSearch wallの **67〜71%**。残り **約30%（1件当たり512〜591秒）はsection外**（§6）。
- measured section内では **3件すべてで frontier_reduction_sort が最大**（section合計の52〜58%、Search wallの35〜41%）、次いで
  state_generation（22〜25%）、solution_materialization（約5.5%）。window_collection / support_evaluation / exhaustion_scan は合計でも2〜3%。
- 「state数が多いのでgenerationが原因」という事前の見立ては支持されない。generationより **frontier reduction / sort** の方が約1.6倍大きい。
- kill時点のactive sectionは c6-p1 = frontier_reduction_sort（stream 6 / depth 71）、c13-p1 = solution_materialization（stream 0 / depth 54）、
  c14-p0 = state_generation（stream 7 / depth 52）。

## 2. authorityと位置付け

参照: `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md` 5.6.8、`docs/PLANNER_SPEC.md` 9.2.19、
`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26A.md`、`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26A2.md`。

| authority | ファイル | SHA-256 | 用途 |
| --- | --- | --- | --- |
| C2.6-A RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json` | `dab2f27a1ca94e5db38279e3848f76d033710c38d6e838da227e36e78c67b171` | baseline / condition parity |
| C2.6-A2 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json` | `4bde9a5bcd84cc5e29d5dcf666f9eafb6bbb64d5f49aace1b15f36cf913fadc2` | primary selection |
| Export | `gogma-artian-planner-backup_20260927015837.json`（commitしない） | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | calculation input |

A2 RESULTはfail-closedで検証した（`parsePhase2C26A2ResultAuthority()`）: `provenance.formal`、`formalSeriesValidation.valid`、
`selectionValidation.valid`、orientations 9、timeout 9 / OOM 0 / failure 0 / completed 0、`resultClass.timeout_in_search` 9、
`conclusion.next.case = A_search_runtime`、A2 perOrientationがC2.6-A timeout集合と完全一致、そして **A2が記録するC2.6-A RESULT SHA
（provenance / runner記録 / sources）が実際に読んだC2.6-A RESULTのSHAと一致**。どちらのRESULTもSearch / Planner inputには使っていない。

## 3. 変更境界

| 役割 | ファイル |
| --- | --- |
| Production observer seam | `src/domain/search/bonusStream.ts`（`ReservedGogmaRuntimeEvent` / `ReservedGogmaRuntimeObserver`、`createTargetBonusStream()` の任意引数） |
| pass-through | `src/domain/search/alternative/plannerAlternativeSearch.ts`（`PlannerAlternativeSearchInstrumentation.onGogmaReservedRuntime`） |
| authority parse・primary導出・selection / condition parity・runtime tracker・kernel progress | `src/benchmarks/plannerGlobalPhase2C26A3.ts` |
| post-hoc analysis（formal validator・coverage・分布・相関・decision rule） | `src/benchmarks/plannerGlobalPhase2C26A3Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A3.test.ts` |
| runner / analyzer | `scripts/run-planner-global-phase2c26a3.mjs` / `scripts/analyze-planner-global-phase2c26a3.mjs` |
| isolation testの更新（新seamもSearch以外のProductionから渡されないこと） | `src/benchmarks/plannerAlternativeBenchmarkIsolation.test.ts` |

### 3.1 section境界seam

`generateReservedDepth()` / `readReservedDepth()` の既存処理順に境界を置いただけで、生成・window・prediction memo・
`reservedBonusSteps()`・frontier key / representative / sort・exhaustion判定は一切変えていない。

| section | 範囲 |
| --- | --- |
| window_collection | frontierごとの `reservedWindow()`（`nextOperationPositions()`・memo）、`ReadonlySet`生成、position union |
| support_evaluation | Reset support、Keep capability、frontierごとの `gogmaKeep` support、unsupported記録 |
| state_generation | position順の確定、position loop（Reset parent lookup・`predictReset`・Keep scan・`predictKeep`・`advanceGogmaCounter`・`reservedGeneratedState`、checkpoint yieldを含む） |
| solution_materialization | `generated.map(...)`（`reservedBonusSteps()`による各raw solutionのsteps展開を含む） |
| frontier_reduction_sort | `byKey` Map reduction（`compareReservedRepresentative()`）、frontier配列化、`compareReservedFrontier` sort |
| exhaustion_scan | `readReservedDepth()` 側のfrontier window scan |

- Domainは時刻を読まない（`performance.now` / `Date.now` / `process.hrtime` を使わないことをtestで固定）。eventは
  `depth_started` / `phase_started` / `phase_completed` / `depth_completed` の同期通知のみで、戻り値は読まない。
- eventのcountは既存処理中に既知の値だけ（`set.frontier.length`、`positions.size`、`generated.length`、`set.windows.size`）。
  観測のための `new Set(generated.map(...))` 等の追加走査は無い。
- 例外（cancellation等）が起きたdepthはそれ以降のeventを出さない。exhaustedで閉じたstreamにeventは無い。
- 旧 `onGogmaReservedDepth` / `onSkillReservedDepth`（depth完了後にgenerated全体を走査しSetを作る）と `onWorkSettled` は **formal A3では
  接続していない**（runnerが `searchInstrumentation` として記録し、analyzerがformal条件として検証）。既存observer実装は変更していない。

### 3.2 semantic neutrality / contract test

- Search level（Production RNG Engine、empty reservation / long Gogma held / held + blocked）: observerあり・なしで delivered Candidate順
  （`candidateStableKey`列）、Search summary（exhausted / extent / stop）、prediction count が一致。observerが値を返しても不変。
- kernel level: A3の `createPhase2C26A3KernelProgress()` instrumentationあり・なしでkernel result（Target outcome、trial、Search summary、
  `plannerRerunsUsed`）が一致。Targetに渡るSearch instrumentationは `onGogmaReservedRuntime` のみ。
- event contract: `phase_started → phase_completed` が同じstream / depth / phaseでpair、overlapなし、section順序固定（空depthは
  state_generationで終了、solutionありなら exhaustion_scan まで）、depthはstream内で1ずつ昇順、closed stream後eventなし、
  cancellation時はactive sectionのstartで止まる。
- tracker: exclusive section時間とinclusive depth時間を分離し二重計上しないこと、contract違反はthrowせず数えること。

## 4. 条件

| 条件 | A3 formal | C2.6-A / A2 |
| --- | --- | --- |
| Export SHA / extent（Normal 4 / Gogma 235 / Skill 4）/ bounds（trials 2 / reruns 8）| 同一 | — |
| child heap / orientation budget | 8192 MB / 30分 | 同一 |
| Research maxPlanSteps / yield / CalculationContext / lineage | 20,000 / setImmediate / 同一 / empty | 同一 |
| **concurrency** | **1** | 3 |
| Search instrumentation | `onGogmaReservedRuntime` のみ | A2は heavy depth observer + onWorkSettled |
| retry | なし（各1回、fresh Node child） | 同 |

concurrency 1は、他childとのCPU競合を除いてsection wall timeの配分を安定させるための本Phaseの計測条件。heavy observerも外したため、
**A2とのabsolute wall time比較はしない**（A2・A3とも30分timeoutという結果の遷移だけを記録: 3件とも timeout → timeout）。

provenance: measured HEAD = analysis HEAD = `0e2a5fea93882f4c7d121c305d7fa1ad7e3b8bf0`、benchmarkCodeSha256
`638c66a5c817b07c629988dc8dc160c6b637e195f524391602856fd294918a2b`、uncommittedBenchmarkCode false、
calculationCodeChangedSinceMeasuredHead なし、formal true。

parity: current baseline（54 orientation）のsummary・順序付きorientation ID・identity・metadataがC2.6-A authorityと一致。
Search条件はconcurrency以外すべてC2.6-Aと一致し、A2 RESULTの記録条件もC2.6-Aと一致。selectionは導出primary集合と完全一致
（missing / duplicate / foreign / rule非該当 / metadata mismatch 0）。record stream（lifecycle・runtime seq連続、heartbeat有り、
boundary contract violation 0）も全件valid。

## 5. primary selection

A2 RESULTの `perOrientation` から次のruleで導出（source中にIDは固定していない）:

```
resultClass == timeout_in_search
counters.startedTargets == 1 && counters.completedTargets == 0
counters.trialsStarted == 0 && counters.fullPlannerRunsStarted == 0
activeTargetOrdinal == 0
```

結果 3件（登録countと一致）: **c6-p1**（same_gogma_counter）、**c13-p1**（same_skill_counter）、**c14-p0**（same_gogma_counter）。
いずれも「Target 1件開始・完了0・Candidate 0・trial 0・full Planner run 0」で、複数Target直列積み上げ・trial・rerunの影響を含まない
Planner Alternative Search 1回そのものである。

## 6. 計時方法とreconciliation

- 時刻はResearch child側のobserverが境界受信時に `performance.now()` で記録。section時間は相互排他で、合計しても二重計上しない。
  inclusive depth時間（`depth_started`→`depth_completed`）は別fieldで、section合計には入れない。
- coverage = measured Gogma sections / Search wall。両方とも **同じ瞬間（最後のheartbeat）** で評価: heartbeatは完了section累計と
  active sectionの経過時間を同じ `now()` で持つ。Search wall = heartbeat経過 − `search_started`（trialなし）。
- kill時のactive sectionは、section開始ごとにopen fdへ同期追記した最後の記録から読む（depth完了記録が後にあればsection外）。
  kill時点の経過はparentのkill時刻とIPC clock offset（最小値）からの推定値。
- inclusive depth時間とsection合計の差（depth内・section外: cursor check等）は1件当たり26〜55 ms で無視できる。つまりunattributedの
  約30%は **`readReservedDepth()` の外** にある。

| orientation | Search wall at kill（推定） | 未観測tail | active at kill（経過推定） |
| --- | ---: | ---: | --- |
| c6-p1 | 1,797.6 s | 1.1 s | frontier_reduction_sort, stream 6 / depth 71（264 ms） |
| c13-p1 | 1,797.2 s | 2.3 s | solution_materialization, stream 0 / depth 54（612 ms） |
| c14-p0 | 1,797.5 s | 0.5 s | state_generation, stream 7 / depth 52（472 ms） |

## 7. depth別・量と時間

| orientation | completed depths | max depth | streams | generated states（計） | 最大generated depth（stream合計） | 最大frontier depth（stream合計） |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| c6-p1 | 580 | 74 | 8 | 304,272,027 | depth 3（5,132,327） | depth 69（171,002） |
| c13-p1 | 255 | 54 | 5 | 354,317,027 | depth 3（7,625,820） | depth 23（123,440） |
| c14-p0 | 483 | 55 | 9 | 336,425,712 | depth 3（7,085,929） | depth 50（188,456） |

section別のdepth記録分布（ms、completed depthのみ）:

| section | c6-p1 median / max（at） | c13-p1 median / max（at） | c14-p0 median / max（at） |
| --- | --- | --- | --- |
| state_generation | 711 / 924（s5 d36） | 1,807 / 2,089（s0 d35） | 954 / 1,121（s5 d51） |
| solution_materialization | 154 / 470（s6 d68） | 374 / 934（s4 d49） | 201 / 551（s3 d51） |
| frontier_reduction_sort | 1,478 / 1,912（s0 d45） | 2,646 / 3,796（s0 d53） | 1,536 / 2,184（s3 d51） |
| window_collection | 14 / 67 | 37 / 86 | 17 / 35 |
| support_evaluation | 62 / 212 | 90 / 135 | 65 / 178 |
| exhaustion_scan | 1.5 / 5.4 | 3.0 / 7.1 | 1.6 / 10.3 |

volume / time（depth記録単位のPearson相関、記述統計のみ・因果は断定しない）:

| 組 | c6-p1 | c13-p1 | c14-p0 |
| --- | ---: | ---: | ---: |
| generatedStates vs state_generation | 0.83 | 0.95 | 0.91 |
| generatedStates vs frontier_reduction_sort | −0.10 | 0.27 | 0.15 |
| frontierStatesAfter vs frontier_reduction_sort | 0.87 | 0.56 | 0.88 |
| depth vs solution_materialization | 0.85 | 0.84 | 0.86 |
| generated × depth vs solution_materialization | 0.86 | 0.84 | 0.85 |
| frontierStatesAfter vs exhaustion_scan | 0.24 | 0.28 | 0.19 |
| frontierStatesBefore vs support_evaluation | 0.87 | 0.95 | 0.89 |

per-unit（median、ns）: state_generation 1,247〜1,322 / generated state、frontier_reduction_sort 1,828〜2,711 / generated state、
solution_materialization 264〜274 / generated state（9〜11 / generated state × depth）、support_evaluation 約3,700 / frontier state。

記述的に言えること: state_generationはgenerated数とほぼ比例し、solution_materializationはdepth（history長）とともに伸びる（H2系の
steps展開と整合）。frontier_reduction_sortはgenerated数よりfrontier後の数と強く相関する（3件中2件で0.87〜0.88）。ただし原因
（sortの比較コスト、`compareReservedRepresentative()` 内の `stableStringify()`、Map key文字列生成、GC等）は本Phaseでは区別していない。

## 8. 事前登録rule

primary 3件について coverage = sum(Gogma sections) / Search observed wall。

- **Case G**: 3件中2件以上で coverage ≥ 0.80 かつ同じ1 sectionが最大 → そのsectionを次optimization候補。
- **Case R**: 3件中2件以上で coverage < 0.80 → Gogma stream内部だけではSearch runtimeを説明できない。次Phaseはscheduler /
  Bonus publication / Ideal filter / Lazy Cross等のruntime計時。optimizationへ進まない。
- **Case M**: dominant sectionが一致しない → mixed。次Phaseでcontext差を局所化。optimizationへ進まない。

判定: **R**（coverage 0.715 / 0.671 / 0.695、3 / 3が < 0.80）。dominant sectionは3件とも frontier_reduction_sort で一致したが、
coverage条件を満たさないためGにはならない。

## 9. 言えること / まだ言えないこと

formalに言えること:

- 3 primaryのSearch wallの約69%（67〜71%）はheld-aware Gogma streamの6 section内で直接計時できた。
- measured sectionのうち最大は3件一致して frontier_reduction_sort（Search wallの35〜41%）、次がstate_generation（22〜25%）。この2つで
  Search wallの約60〜64%を占める。window / support / exhaustion scanは小さい（合計2〜3%）。
- 残り約30%は `readReservedDepth()` の外で、本Phaseでは計時していない。

まだ言えないこと:

- unattributed約30%の内訳（scheduler、Bonus publication・Ideal filter（1 depth数百万solutionの受け取り）、Lazy Cross、Skill stream、
  Route base登録、GC配分など）。
- frontier_reduction_sort内の比較・key生成・sortの内訳、およびGCがどのsectionに計上されたか（GC pauseはその時activeなsectionに入る）。
- Browser Worker・他deviceでの配分、run間ばらつき（各1回）。

## 10. 次Phase recommendation

事前登録rule Rに従い、**optimizationへは進まない**。次Phaseは、残り約30%のsection外runtime（scheduler step、Bonus publication /
Ideal filter、Lazy Cross composition、Skill stream、Route base登録）を同じ方式（Domainは境界のみ、時刻はResearch側、低負荷記録）で
計時し、Search wallを80%以上説明できる状態にする。その際、今回最大だった frontier_reduction_sort（および state_generation）の
内部区間分割も同時に行えば、次の判断でoptimization対象をより直接に選べる。H6 generation単独を最優先とする根拠は今回得られなかった。

## 11. limitations

- Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。
- concurrency 1・heavy observer除去のため、A2とのabsolute wall time比較はしない。
- 各orientation 1回のみ（retryなし）。
- coverageの観測点はtimeoutでは最後のheartbeat。以降のtail（0.5〜2.3秒）は未観測として別記。kill時のactive section経過は推定値。
- section内のawait（checkpoint yield = setImmediate）とその間に走るtimer（250 ms memory sampler、5 s heartbeat）、およびGCは、その時
  activeなsectionへ計上される。
- section境界記録（section開始ごとの同期追記 + IPC、depthごとのsummary、1件当たり約1,800〜4,100記録）は計算を変えないが、wall timeへの
  overheadはゼロではない。
- depth別分布・相関は完了したdepth記録のみで、記述統計。

## 12. 検証

`npm run lint`、`npx tsc -b --force`、`npm test`、`npm run build`、`git diff --check`。raw（`PLANNER_GLOBAL_PHASE2C26A3_RAW.json.local`、
`PLANNER_GLOBAL_PHASE2C26A3_RUN.local/`）はcommitしていない。
