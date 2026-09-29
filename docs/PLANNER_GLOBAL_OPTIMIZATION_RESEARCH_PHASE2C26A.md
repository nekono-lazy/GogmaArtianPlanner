# Global Planner Research Phase 2-C2.6-A（H1後Global Planner kernel再評価）

Refs #154。Research only。Production source、Search / Planner semantics、defaults、schema / version、Persistence、UIは変更していない。
portfolio Search、capture bound、extent probe、oracle coverage、C3 readiness、global assignmentは実行していない。

## 1. 結論（`timeout_without_out_of_memory`）

旧Phase 2-C2と同じ元Export・同じbaseline Conflict・同じ54 orientation・同じProduction default extent / trial bounds・同じNode条件
（fresh child、heap 8 GB、concurrency 3、orientation budget 30分、`setImmediate` yield）で、current Production（D2-a Ideal-only
publication + D2-d H1後）のPlanner Alternative kernelを全件formalに再実行した。

| child status | 旧C2 | **C2.6-A** |
| --- | ---: | ---: |
| completed | 11 | **45** |
| out_of_memory | 43 | **0** |
| timeout | 0 | **9** |
| process_failure | 0 | **0** |

- 旧OOM 43件の遷移: **OOM → completed 34**、**OOM → timeout 9**、OOM → OOM 0、OOM → process failure 0。
- 旧completed 11件の遷移: **completed → completed 11**（→ OOM / timeout / failure 0）。この11件はTarget outcome・trial結果 / 理由 /
  `generatedSelected`・trialしたCandidate key SHA-256・found key SHA-256・`plannerRerunsUsed` が旧C2と **11 / 11完全一致**。
- baseline（43 Target、completed 20 / 43、exhausted、Plan 1,465 steps、Conflict 21 = Gogma 15 / Skill 3 / owned weapon 2 / Normal 1）と、
  orientation set（54件、id・Conflict順・kind・fixed Target・participant Target set、加えてConflict key・Entry IDまで）は旧C2と完全一致。
- formal series validation: valid（baseline 1 + kernel 54 child、missing / duplicate / foreign / metadata mismatch / unknown status 0）。

**formalに言えること**: 今回の元Export・54 orientation・Node 8 GB条件では、旧Phase 2-C2で43件発生したkernel child OOMはcurrent Production
では1件も再現しなかった。そのうち34件は30分budget内に完走し、残り9件はOOMではなく30分budgetのtimeoutで停止した。memory bottleneckは
runtime bottleneckへ移った可能性が高い。旧C2で完走していた11件はcurrent Productionでも同一のkernel判定を返した。

**まだ言えないこと**: 「全orientationを測定可能になった」（9件はtimeout）。「Global Planner memory問題は完全に解決した」。timeout 9件で
Candidateが無いこと（timeoutはCandidateなしを意味しない）。foundがfixed Route setとのkernel trialで選ばれた以上の意味を持つこと。C3 readiness。

**次Phase推奨**: timeout 9 orientationのtargeted runtime analysis（§10）。portfolio再構築（C2.6-B）へは、その結果で測定可能範囲を
整理してから判断する。

## 2. authorityと位置付け

参照: `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md` 5.6.8、`docs/PLANNER_SPEC.md` 9.2.19、
`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C2.md`、`..._PHASE2C25D2D.md`、`..._PHASE2C25D2E.md`。

D2系列では代表context（c12 / c2など）のSearch-only runで改善を確認した。本Phaseはそれを元C2の54 orientation全体のkernel（Search + trial +
full Planner rerun）で確認するkernel availability確認Phaseである。

## 3. 変更境界と追加ファイル

Production変更0件（`src/domain`・`src/services`・`src/workers`・`src/pages`・`src/components`・`src/db`は未変更）。Production moduleは
C2.6-Aをimportしない（テストで確認）。schema / version / default不変（CalculationContext 17、DB 10、Export 13、`production-rng:c5-e7`、
extent `{ N 4, G 235, S 4 }`、bounds `{ trials 2, reruns 8 }`、`maxPlanSteps` 1000）をテストで確認。

| 役割 | ファイル |
| --- | --- |
| kernel task生成・child条件定数・memory tracker（計算は旧C2 helperへ委譲） | `src/benchmarks/plannerGlobalPhase2C26A.ts` |
| 旧C2 RESULT parser・baseline / orientation parity・formal validator・集計・遷移・結論規則（post-hoc） | `src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A.test.ts` |
| kernel-only Node runner / post-hoc analyzer | `scripts/run-planner-global-phase2c26a.mjs` / `scripts/analyze-planner-global-phase2c26a.mjs` |
| committed evidence | `docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json` |

計算は旧C2 helperをそのまま使う: `runPhase2C2Baseline()`、`derivePhase2C2Orientations()`、`phase2c2ProductionDefaultConditions()`、
`phase2c2KernelRequest()`、`runPhase2C2Kernel()`、`classifyPhase2C2ChildExit()`。旧 `scripts/run-planner-global-phase2c2.mjs` と旧C2
evidenceは変更していない。runnerは旧C2 RESULT・oracle・earlier Phase evidenceを読まず（テストで確認）、旧C2 RESULTはanalyzerだけが
測定後に読む。

## 4. 条件

| 項目 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`、19,424,064 bytes（commitしない） |
| 旧C2 RESULT | `PLANNER_GLOBAL_PHASE2C2_RESULT.json`、SHA-256 `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4`（measured HEAD `3db8197f`） |
| measured HEAD / analysis HEAD | `525ed892acb09609fcce1f7589c6751038ae255d` / 同一（測定後に計算・analysisコードの変更なし） |
| benchmarkCodeSha256 | `ed29815e9560f0df8f874025126a44636749229e2a2ea2d1672ac5627f260db5`、uncommitted false |
| 環境 | Node v24.19.0（V8 13.6）、Windows 11（10.0.26200）x64、AMD Ryzen 7 9700X（16 logical）、RAM 32 GB |
| child | 1 task = fresh Node child（Vite SSR loader）、`--max-old-space-size=8192`、concurrency 3、budget 30分（baselineも同じ） |
| memory | `process.memoryUsage()` を250 ms間隔でsample（sampled max、true peakではない）。失敗childは死亡直前の最後のIPC sample |
| kernel request | decision = baseline Conflict key + orientation participant、`priorFixedBuildListEntryIds = []`、`priorExcludedRoutes = []`、extent / boundsはProduction定数のspread copy |
| Research `maxPlanSteps` | 20,000（旧C2と同一） |
| 実行時間 | 2026-09-29 11:36Z開始、全体約2時間56分 |

旧C2との差はProduction側（D2-a / D2-d）と、harness側の2点のみ: (1) childがIPCで最後のmemory sampleとyield回数を親へ送るようにした
（OOM / timeoutでもsampleが残る）、(2) Vite loaderの `hmr: false`。いずれも計算入力・kernel requestを変えない。
なお旧C2と同様、childのstderrには無害な `WebSocket server error: Port 24678 is already in use` が出る（全timeout childのstderrはこの1行のみ）。

smokeはformal前にnon-formalで2 orientation（c2-p0、c9-p0）だけ実行した（harness sanity確認のみ、条件変更なし）。formal validatorは
smoke runを `environment.smoke` 非null・orientation欠落でrejectすることを確認した。

## 5. baselineとorientation parity

current `createProductionPlan()` を元Exportへ実行し、そのrun自身のConflictからorientationを導出した（期待値はhard-codeしない）。

| 項目 | C2.6-A | 旧C2 | 一致 |
| --- | --- | --- | --- |
| planning Target / completed | 43 / 20 | 43 / 20 | ✓ |
| termination | exhausted | exhausted | ✓ |
| Plan steps | 1,465 | 1,465 | ✓ |
| Conflict / kind別 | 21（G 15 / S 3 / owned 2 / N 1） | 同 | ✓ |
| Target単位Conflict signature | 21 | 21 | ✓（完全一致） |
| selected Target | 20 | 20 | ✓（完全一致） |
| orientation数 | 54 | 54 | ✓ |

orientation setはid・Conflict index・kind・fixed Target・participant Target setが54件全件一致し、補助比較（Conflict key、fixed Entry ID、
participant Entry ID列）も差分0だった。semantic differenceは無い。

## 6. kernel child outcome

| Conflict kind | orientation | completed | OOM | timeout | failure |
| --- | ---: | ---: | ---: | ---: | ---: |
| same_gogma_counter | 33 | 31 | 0 | 2 | 0 |
| same_skill_counter | 15 | 8 | 0 | 7 | 0 |
| same_owned_weapon_consumed | 4 | 4 | 0 | 0 | 0 |
| same_normal_counter | 2 | 2 | 0 | 0 | 0 |
| **計** | **54** | **45** | **0** | **9** | **0** |

preparation failureは0件。

### 6.1 旧OOM 43件 / 旧completed 11件の遷移

| 旧 → 現 | completed | OOM | timeout | failure |
| --- | ---: | ---: | ---: | ---: |
| 旧OOM（43） | **34** | 0 | **9** | 0 |
| 旧completed（11） | 11 | 0 | 0 | 0 |

- OOM → completed 34: c0-p0、c0-p1、c1-p0、c1-p1、c2-p1、c3-p0 / p1 / p2、c4-p0 / p1、c5-p0 / p1、c6-p0、c7-p0 / p1、c8-p0、c10-p0 / p1 / p2、
  c12-p0 / p1、c13-p7 / p8、c14-p1、c15-p0、c16-p0 / p1 / p2、c17-p0、c18-p0 / p1、c19-p1、c20-p0 / p2。
- OOM → timeout 9: c6-p1、c13-p0 / p1 / p2 / p3 / p6 / p9、c14-p0、c20-p1。
- 旧OOM代表c12-p0（D2-e primary）はkernelで961秒・sampled heap 4.6 GBで完走、c2-p1は358秒・1.3 GBで完走。
- 旧completed 11件は全件同じkernel判定（§1）を約2倍速く返し、sampled heapも下がった（例: c8-p1 4.4 GB → 0.55 GB、c13-p4 5.7 GB → 1.6 GB）。

### 6.2 timeout 9件

| orientation | kind | fixed Target | wall | sampled max heap / RSS | 最後のyield回数 | stderr |
| --- | --- | --- | ---: | --- | ---: | --- |
| c6-p1 | Gogma（2 participant） | 46bf2c78 | 1,800 s | 3.6 / 4.1 GB | 5,925,019 | WebSocket警告のみ |
| c13-p0 | Skill（10 participant） | 2378d3e0 | 1,800 s | 4.2 / 4.8 GB | 4,581,017 | 同 |
| c13-p1 | Skill（10） | 6c65c924 | 1,800 s | 4.4 / 5.0 GB | 5,886,094 | 同 |
| c13-p2 | Skill（10） | 45b13c06 | 1,800 s | 4.6 / 5.6 GB | 4,196,280 | 同 |
| c13-p3 | Skill（10） | 02876df4 | 1,800 s | 4.3 / 5.1 GB | 4,949,207 | 同 |
| c13-p6 | Skill（10） | a830a376 | 1,800 s | 4.2 / 5.2 GB | 3,772,629 | 同 |
| c13-p9 | Skill（10） | 8d233d8b | 1,800 s | 3.6 / 4.1 GB | 5,596,638 | 同 |
| c14-p0 | Gogma（2） | b4f252cd | 1,800 s | 4.2 / 4.6 GB | 6,384,279 | 同 |
| c20-p1 | Skill（3 participant） | 86439c85 | 1,800 s | 3.6 / 4.4 GB | 5,153,362 | 同 |

- いずれもheap上限8 GBの半分前後で、OOMの兆候（V8 fatal GC trace）は無い。yieldは数百万回続いており、hangではなく計算継続中に
  budgetで打ち切られた。
- **Target outcome到達状況は観測不能**: kernel APIは途中経過を公開せず、timeout childはrecordを書かない。どのTargetのSearch / trialで
  時間を使ったかは本Phaseでは局所化していない。timeoutを「Candidateなし」とは扱わない。
- c13は10 participant Skill Conflict（1 orientationで非fixed 9 Targetを順に探索）。同じConflictのc13-p4 / p5 / p7 / p8は80〜467秒で完走しており、
  fixed側によって所要時間が大きく変わる。

## 7. completed kernelのTarget outcome・trial・rerun

完走45 kernelのTarget結果88件（うちSearch実行88、未実行0）:

| outcome | 旧C2（11 kernel、27件） | **C2.6-A（45 kernel、88件）** |
| --- | ---: | ---: |
| found | 5 | **25** |
| stopped_by_candidate_trial_bound | 2 | 8 |
| stopped_by_search_extent_bound | 20 | **55** |
| not_found_within_search_extent | 0 | 0 |
| stopped_by_planner_rerun_bound | 0 | 0 |
| blocked_by_selected_checkpoint | 0 | 0 |
| その他のstatus | — | 0 |

- kind別: Gogma found 19 / trial bound 6 / extent 15、Skill found 4 / trial bound 2 / extent 36、owned weapon found 2 / extent 2、Normal extent 2。
- foundは16 distinct Target（25件）。うちheld Route（Gogma / Skill own位置が非連続）は9件。
- trial: 47件（found 25 / rejected 22）。rejection理由は `explicit_decision_not_selected` 18、`preflight_refused` 4（c3-p0 / c3-p2の
  Target 2e26c0b1、各2 trial）。foundの `generatedSelected` は true 22 / false 3（c8-p1、c15-p1、c16-p1の1件）。Target当たりtrial数分布
  {0: 51, 1: 27, 2: 10}。
- `explicit_decision_not_selected`: 旧C2 10件 → C2.6-A 18件（旧completed 11件由来の10件は同一、新たに完走したkernelで8件）。
  `preflight_refused` は旧C2で0件（旧C2で完走したkernelには出現しなかった）。
- `plannerRerunsUsed` 分布 {0: 18, 1: 17, 2: 8, 5: 2}、最大5（bound 8未到達）。
- 注記: 旧C2文書 §6の「found 5件は全て `generatedSelected = true`」は旧C2 raw / RESULTと一致しない（旧C2 RESULTでもc8-p1、c15-p1は
  `false`）。本Phaseの比較はRESULTの値を使い、旧文書は変更していない。

**foundの意味**: そのorientationのfixed Route setとのkernel trialで選択された、という意味だけである。全43 Target完成、全Conflict解消、
Global assignment成立、1,657 oracle coverageのいずれも意味しない（found trialのPlanは completed 19〜22 / 43、Conflict 19〜21のまま）。

## 8. runtime・memory

| 項目 | 値 |
| --- | --- |
| kernel wall（全54、timeout含む） | max 1,800 s（budget）、median 283 s |
| kernel wall（completed 45） | max 1,438 s（c6-p0）、median 159 s |
| 旧OOM → completed 34件のwall | median 315 s、max 1,438 s |
| kind別completed wall median / max | Gogma 143 / 1,438 s、Skill 441 / 961 s、owned weapon 486 / 490 s、Normal 5 / 5 s |
| max sampled heapUsed | 4.92 GB（c18-p0、completed） |
| max sampled RSS | 5.97 GB（c13-p2、timeout） |
| completed childの `resourceUsage().maxRSS` 最大 | 5,783,316 KiB |
| baseline | 5.8 s、sampled heap 0.48 GB |

sampled maxはtrue peakではない。Node heap bytesはD2-e Browser CDP bytesと直接比較しない。

## 9. Conflict participant

| 項目 | 旧C2 | C2.6-A |
| --- | ---: | ---: |
| participant総数 | 34 | 34 |
| Searchまで到達（explored） | 15 | **32** |
| 未到達 | 19 | **2** |

未到達2 Targetは、それぞれが非fixed側になる唯一のorientationがtimeoutしたもの: 15829bfe（c6-p1で探索対象、timeout）、fea60316（c14-p0で
探索対象、timeout）。**全34 participantが測定可能になったとはまだ言えない**。

## 10. 次Phase推奨

事前登録の結論規則（OOM > timeout > その他failure）により `timeout_without_out_of_memory`:

1. **primary: timeout 9 orientationのtargeted runtime analysis**。Research-onlyのper-Target進捗観測（Target開始・Search終了・trial開始 /
   終了・full run時間）でどのTargetのSearch / trial / full Planner rerunが30分を消費しているかを局所化する。特にc13（10 participant Skill）
   6件、c20-p1、Gogmaのc6-p1 / c14-p0。D2-eのSearch-only c12約9分（Browser）・D2-d Node約15分と整合する規模のSearchが複数Target分
   直列に積まれている可能性があるが、未確認である。
2. その結果で測定可能範囲を整理し、completed 45 orientation（participant 32 / 34）でC2.6-B（current Productionでのportfolio再構築）へ進むか、
   timeout解消を先にするかを判断する。budget延長による同Phaseのformal再測定はしない。

## 11. limitations

- Node child（Vite SSR loader）のみ。Browser Worker、他device、他heap条件は測っていない。
- memoryはsampled max（250 ms）で、失敗childは死亡直前のIPC sampleのみ。
- timeout childのkernel内部進捗は観測不能。
- 1 formal seriesのみで、wall timeのrun間ばらつきは測っていない。concurrency 3の同時実行による相互干渉を含む。
- portfolio、capture bound、extent probe、oracle coverage、C3 readinessは評価していない（C2.6-Bで扱う）。

## 12. 再現

```bash
node scripts/run-planner-global-phase2c26a.mjs --export <Export> --run-dir PLANNER_GLOBAL_PHASE2C26A_RUN.local --output PLANNER_GLOBAL_PHASE2C26A_RAW.json.local
node scripts/analyze-planner-global-phase2c26a.mjs --run PLANNER_GLOBAL_PHASE2C26A_RAW.json.local --old-c2 docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --output docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json
```

raw evidence（commitしない）: `PLANNER_GLOBAL_PHASE2C26A_RAW.json.local`（SHA-256 `cddafccc3d1a33dc174a19caedf2d620c881a3c6f27f369dd1bb4d543ac2533d`、
7,035,114 bytes）、`PLANNER_GLOBAL_PHASE2C26A_RUN.local/`（task / record / memory trace）、`PLANNER_GLOBAL_PHASE2C26A_RUN.log.local`。
committed RESULTではCandidate stable keyをSHA-256化している。
