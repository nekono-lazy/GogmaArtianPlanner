# Global Planner Research Phase 2-C2.6-B1（全orientation pre-Search contextからのdefault extent Candidate portfolio）

Refs #154。Research only。Production source、Search / Planner semantics、extent、trial / rerun bound、RNG、schema / version、
Persistence、UIは変更していない。kernel trial、full Planner rerun、extent probe、60分budget、global assignment、Candidate組合せ探索、
oracle-guided Search、multi-decision reservation、新しいruntime optimizationは行っていない。

- measured HEAD: `cef40343e7149e0612c8efb0ad97a40f572c6e42`（Research module・runner・analyzer・事前登録decision rule・testsを含むclean HEAD）
- analysis HEAD: `2dc72c0b4931dd039e8c52dc84e3abc3caab13c2`（PR #189レビュー対応。measured HEAD以降の変更はpost-hoc解析
  `plannerGlobalPhase2C26B1Analysis.ts`・analyzer・testのみで `calculationCodeChangedSinceMeasuredHead = []`。formal再測定はしていない）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B1_RESULT.json)（`provenance.formal = true`）

## 1. 結論（B1-M `B1_M_measurement_complete`）

kernel完走を前提にせず、current baselineの **54 orientation全部** のpre-Search contextを既存helperで直接導出し、Production default extent
（Normal 4 / Gogma 235 / Skill 4）で `visitPlannerAlternativeCandidates()` だけを実行した（capture bound 8）。

| 指標 | 旧C2（historical） | **B1** |
| --- | ---: | ---: |
| participant explored | 15 / 34 | **34 / 34** |
| participant portfolio > 1 | 12 | **17** |
| oracle coverage（exact + partial） | 0 / 43 | **2 / 43**（default extentのみ） |

- semantic failure **0**: baseline / orientation / condition / context parity、kernel trial prefix parity（98 match、不一致0）、
  Search child内のcontext再導出不一致0、reservation違反0。
- Stage 1: 136 unique context中 completed 116、timeout 20、OOM 0、process failure 0。
- coverage fallback: Stage 1でcompleted 0だったparticipant **3件** に1 contextずつ実行し、**3件ともcompleted**。
- 事前登録ruleの判定は **B1-M**（34 / 34 explored、semantic mismatch 0、OOM / failureによるunexplored 0）。

**formalに言えること**: current Productionの元Export・Production default extentで、Conflict participant 34 / 34について
少なくとも1つのdefault-extent Search contextを正常終了でき（consumer stop / stoppedByExtent / exhausted、Candidate 0も含む）、
participant measurement coverageを34 / 34まで確保した。

`B1_M_measurement_complete` はparticipant measurement coverageについての事前登録名称であり、**全Search context完走を意味しない**。
Stage 1では136 unique context中20 contextがtimeoutしており、timeout contextを持つparticipantが13件残る（§9）。portfolio size・
diversity・oracle coverageは、今回正常終了したcontextから得られた観測値である。

**まだ言えないこと**: 全default-extent Search contextの測定完了。timeout contextにalternativeが無いこと。portfolio size 1の
participantにdefault extent内alternativeが無いこと（17件中11件はtimeout contextが残る、§10）。
portfolioのCandidateが実行可能Planに入ること（B1はSearch-only。kernel trial / Planner実行をしていない）。
全Targetを競合なく完成できるRoute集合が存在すること。extent拡張で増えるCandidate。final C3 readiness（A / B / C）。
oracle Routeがdefault extent外にあるのか、single fixed winner reservationで届かないのか（B2で評価）。

**次Phase（B1-M）**: B2で、未観測の理由を「10分budgetで未完走のdefault-extent context / Production default extent不足 /
single fixed winner reservation・context自体の制約」に切り分けたうえで、extent probe・oracle coverage gap（41 / 43 uncovered）・
held / late-start不足・single fixed winner reservationの限界を評価する（§13）。

## 2. 方針: kernel完走をportfolio生成の前提にしない

旧C2は「kernel完走 → kernelがSearchしたTarget → post-hoc portfolio Search」の順だったため、kernel OOM / timeoutでSearch context
自体が測定不能なparticipantが19件残った。B1は既存Research helper `derivePhase2C25APreSearchContexts()` をauthorityとし、

```text
preparePlannerAlternativeKernel()（kernel自身のpreparation、無変更）
  -> scenario.works（kernelのTarget順）
  -> Targetごと: Planner-start origin / invalidated Entry / invalidated Route key /
     fixedRouteBuildListEntryIds / derivePlannerAlternativeReservation()（Planner authority）/
     excludedRouteKeys（invalidated Route keyのみ）/ Production default extent
  -> visitPlannerAlternativeCandidates() のみ（既存 runPhase2C2SearchContext()、capture 8）
```

で全54 orientationのcontextを直接作った。reservation semanticsの再実装はない。`blocked_by_selected_checkpoint` は記録のみで
Searchしない（今回0件）。orientationがA10でtimeoutしたかどうかはtask生成条件に使っていない。

## 3. authority

| authority | 内容 | 検証 |
| --- | --- | --- |
| A10 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json`、SHA-256 `74bbc08e…2aa80c317a96e3348b0fedfdd1b53ab3d`、measured HEAD `886e3f74` | `parsePhase2C26B1A10Authority()`: `formal = true`、`calculationCodeChangedSinceMeasuredHead = []`、formalRunValidation / comparability valid、`decision.case` / `conclusion.case` = `R1_improved_timeouts_remain`、`kernel.orientations = 54`、rowがorientationを丁度1回ずつcoverしchild status件数と一致、completed kernelのTarget記録（Target・outcome・search summary・trial key SHA-256）が読めること |
| A9 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json`、SHA-256 `069a5332…14f27502a` | A10が記録した `a9ResultSha256` と読んだfileのSHA-256が一致（authority chainのみ。B1のportfolioへCandidate / outcomeを流用しない） |
| 1,657 oracle | `docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json`（`proven_minimum`、同じExport） | 計算runは読まない（runner / moduleにoracle参照が無いことをtestで確認）。formal Search終了後、analyzerだけが読む |
| 旧C2 RESULT | `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` | historical referenceのみ（decision入力にしない） |

A9の参考: A9ではc14-p0がconcurrency 1で完走しdefault extent内Candidate 0だった。B1はA9の結果を流用せず、current mainから
fresh Search-onlyで実行し、c14-p0のcontext（participant fea60316）はfallbackで1,707秒かけて `stopped_by_extent`・delivered 0となった
（A9 referenceと矛盾しない）。

## 4. 条件

| 項目 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| Search | `visitPlannerAlternativeCandidates()`（current Production）、Search-only、Production default extent `{ 4, 235, 4 }`、capture bound 8（既存 `PHASE2C2_PORTFOLIO_CAPTURE_BOUND`） |
| contexts child | baseline + 54 orientationのcontext導出、fresh child、heap 8 GB、budget 30分 |
| Stage 1 | 1 context = fresh Node child、heap 8192 MB、concurrency 3、budget 10分、`setImmediate` yield、retryなし |
| coverage fallback（事前登録） | Stage 1でcompleted 0のparticipantのみ、1 participantにつき1 context、fresh child、heap 8192 MB、concurrency 1、budget 30分、同じSearch入力 / extent / capture bound、1回だけ |
| 付けないもの | CPU profiler、no-inlining diagnostic、section / depth / lifecycle observer、counting RNG、kernel trial、full Planner rerun |
| memory | `process.memoryUsage()` 250 ms sampled max（true peakではない） |
| CalculationContext | `unknown-initial` / master 4 / `production-rng:c5-e7` / app schema 17、Research maxPlanSteps 20000（A10と同じ） |

fallback context選択規則: そのTargetをsearchableとするcontextのうち、baseline orientation順 → workIndex順 → contextDigest順の最初の1件。

## 5. parity（Search開始前にfail-closed）

- **baseline / orientation**: Export SHA、planning Target 43、completed 20、termination `exhausted`、Plan steps 1465、Conflict 21
  （Gogma 15 / Skill 3 / Normal 1 / owned weapon 2）、selected Target、Conflict signature、ordered orientation ID、各orientationの
  Conflict index / key / kind / participant Entry / participant Target / fixed Entry / fixed TargetがA10と全一致。
- **condition**: context extent・Production default extent・CalculationContext・Research maxPlanStepsがA10と一致。全contextのextentは均一。
- **context（A10 completed kernel 48 orientation / 100 Target）**: 導出contextのTarget順がkernelのTarget順と一致、
  searched ⇔ searchable、extentがA10 extentと一致。A10 RESULTが保持しないfield（invalidated Entry / Route key、fixed Route set、
  reservation、excluded Route keys、origin digest）は推測せず比較対象外として記録。
- **旧C2 historical reference**: 旧C2 completed 11 orientationのfixed Route set / reservation range / excluded Route key SHA-256が
  11 / 11一致（説明用、decision入力ではない）。
- **search child**: 各childはorientationのpreparationを再導出し、`contextDigest` / `searchInputDigest` / Targetがcontexts childと
  一致しなければSearchせず `context_mismatch` を記録する。formal runで0件。

## 6. context導出とdedup

| 項目 | 値 |
| --- | ---: |
| orientation | 54 |
| derived context | 146 |
| searchable | 146 |
| blocked_by_selected_checkpoint | 0 |
| unique Search input | 136 |
| dedupで節約したrun | 10 |

既存 `contextDigest` はbodyに `orientationId` / `workIndex` を含むためorientation間で一致せず、dedupに使えない。B1は同じbodyから
この2つのprovenance fieldだけを除いた `searchInputDigest`（Target、status、invalidated Entry / Route key、fixed Route set、
normalized / Search用reservation、excluded Route keys、extent、origin digest）でまとめ、group内のbodyが完全一致することを
追加でassertした。Targetやreservation・excluded keysが異なるcontextはまとめない。まとまった8 groupは、別Conflictでも
同じfixed Entryと同じ検索Targetになるcontext（例: c9-p0 / c11-p0 / c13-p4）で、全aliasのorientation / workをprovenanceに保持した。

## 7. Stage 1

| 項目 | 件数 |
| --- | ---: |
| run | 136 |
| completed | **116** |
| timeout | 20 |
| out_of_memory | 0 |
| process_failure | 0 |
| consumer stop（8件到達） | 46 |
| stoppedByExtent | 70 |
| exhausted | 0 |
| delivered Candidate総数 | 374 |

delivered分布: 0件 66、1件 2、2件 2、8件 46。completed contextのwall median 77秒、max 1,708秒（fallback含む）。
sampled max heap 約5.0 GB。

representative kind別: Gogma（consumer stop 24 / extent 13 / timeout 3）、Skill（consumer stop 20 / extent 55 / timeout 17）、
Normal（extent 2）、owned weapon（consumer stop 2）。timeout 20件はc13（Skill 10 participant Conflict）のp1 / p3 / p9由来15件、
c20-p1由来2件、c6-p0 / c6-p1 / c14-p0（Gogma）3件。timeoutはCandidate 0として扱っていない。

## 8. coverage fallback

Stage 1でcompleted contextが0のparticipantは3件（searchable context無しは0件）。

| participant | 選択context | 結果 | delivered | wall |
| --- | --- | --- | ---: | ---: |
| 46bf2c78 | c6-p0#0（s014） | completed / consumer stop | 8 | 597秒 |
| 15829bfe | c6-p1#0（s015） | completed / stoppedByExtent | 0 | 1,240秒 |
| fea60316 | c14-p0#0（s114） | completed / stoppedByExtent | 0 | 1,708秒 |

3件ともfallbackで初めてexploredになった。fallbackで得たCandidateは同じSearch semanticsなのでportfolioへ統合し、
provenanceに `coverage_fallback` を明示した（fallbackのみで得たalternative 8件、すべてheld Route）。

## 9. participant measurement coverage

| 項目 | 値 |
| --- | ---: |
| participant | 34 |
| explored | **34** |
| unexplored | 0 |
| Stage 1でexplored | 31 |
| fallbackで初めてexplored | 3 |

explored = そのTargetのSearch contextが少なくとも1つ正常終了（consumer stop / stoppedByExtent / exhausted、Candidate 0を含む）。
**exploredはそのparticipantの全contextが完走したことを意味しない。** Stage 1でtimeout contextを1つ以上持つparticipantは
34件中13件（portfolio size 1の11件、portfolio > 1の2件）で、うち15829bfe・fea60316はStage 1の全contextがtimeoutし、
fallbackの1 contextだけが正常終了している。participantごとの内訳はRESULTの `participants.rows`（Stage 1 / fallbackの終了状態別件数）と
`portfolio.observation.participants`（Stage 1未完走context数）に記録した。

## 10. portfolio

Target portfolio = original Candidate + 全completed contextのdelivered alternative、Target内で `candidateStableKey()` によりdedup
（Candidate ID / run ID / context ID / delivered ordinalは使わない）。B1のalternativeはすべて **`search_delivered`** であり、
実行可能Planとして確認済みではない。A10 completed kernelとstable keyが一致したものだけmetadataとして `kernel_found` 28件・
`kernel_trial_rejected` 22件を紐付けた（A10の全trial 50件と一致）。

| 項目 | 値 |
| --- | ---: |
| Target | 43 |
| unique Candidate | 368 |
| original | 43 |
| alternative | 325 |
| Target portfolio size分布 | 1: 26、9: 8、17: 6、43: 1、58: 1、67: 1 |
| participant portfolio > 1（観測値） | **17 / 34** |
| participant source alternativeあり | 12 |
| participant Counter位置alternativeあり | 16 |
| participant held Routeあり | 17 |
| held alternative Candidate | 270 |
| late-start alternative（originより後に開始） | 154（Gogma 144 / Skill 70 / Normal 4、重複あり） |
| reservation違反 | 0 |

portfolio size 1のparticipant 17件は、**今回正常終了したcontextからはalternativeを観測できなかった** participantである。
内訳（`portfolio.observation.singleton`）:

| 区分 | 件数 |
| --- | ---: |
| portfolio size 1のparticipant | 17 |
| Stage 1にtimeout contextあり | **11**（うち2件はStage 1全timeoutで、coverage fallbackの1 contextのみ正常終了） |
| Stage 1の全contextが正常終了 | **6** |

全contextが正常終了した6件については、このrunで導出したそのTargetの全default-extent contextでalternativeが0だった。一方11件は
timeout contextが残っており、timeout contextをCandidate 0として扱わないというB1自身の原則により、**そのTargetのdefault extent内に
alternativeが存在しないとは言えない**。

同様に `participant portfolio > 1 = 17 / 34` は今回のformal runで観測された値であり、timeout contextを残す（portfolio > 1の
participantにも2件ある）ため下限側の観測値になり得る。default extentにおける最終的なdiversityの上限や、「残り17 participantには
alternativeが無い」ことを意味しない。

prefix別（各contextの先頭k件のみ）:

| k | participant portfolio > 1 | Candidate総数 | held Route |
| ---: | ---: | ---: | ---: |
| 1 | 17 | 85 | 18 |
| 2 | 17 | 126 | 45 |
| 4 | 17 | 206 | 117 |
| 8 | 17 | 368 | 270 |

## 11. 1,657 oracle coverage（default-extent portfolio coverage）

旧C2と同じ比較contract（`phase2c2OracleCoverage()`）。推測でfieldを補わない。

| 分類 | 件数 |
| --- | ---: |
| exact | **2**（いずれもdefault extentのalternative） |
| partial comparable | 0 |
| not comparable | 0 |
| uncovered | 41 |
| oracle held Route 18件のうちcovered | 1 |

exactは57126a5e（non-held）と820831d0（oracle held Route）。uncovered 41件のうち26件はportfolio size 1（original以外なし）。
B1はdefault extentだけなので、これは **default-extent portfolio coverage** であり、extent拡張後のcoverageではない。さらに
timeout contextのCandidateを含まない、**今回正常終了したcontextに基づく観測値** である（RESULT `oracleCoverage.scope`）。

## 12. 旧C2との比較（説明的比較のみ）

旧C2: participant explored 15 / 34、unexplored 19、portfolio > 1 12、oracle coverage 0 / 43。B1: 34 / 34、0、17、2 / 43。
差はcurrent Production全体（A6 / A9等）と測定方法の変更（kernel完走依存を外した、probe extent無し）の両方を含むため、
単一optimizationの効果とは扱わない。

## 13. 次Phase B2への入力

- uncovered oracle Route 41件のclosest差分は、多くがGogma開始位置・operation数（`gogma:first` / `gogma:operations`）。
  extent probeで届くのか、fixed winner 1つのreservationでは届かないのかの切り分けが必要。
- portfolio size 1のparticipant 17件では、正常終了contextからalternativeを観測できなかった。ただし11件にはtimeout contextが残るため、
  未観測の理由は
  1. default extent内だが10分budgetで未完走のcontext
  2. Production default extent外
  3. single fixed winner reservation / context自体の制約
  をまだ分離できない。B2でこの3要因を切り分ける（全contextが正常終了した6件は1を除外できる）。
- oracle held Route 18件中covered 1件。held / late-start Routeの不足評価。
- B1のtimeout 20 context（10分）。B1-M判定（participant coverage）には影響しないが、上の要因1に直結する。B2でextentを広げる際の
  runtimeにも注意。

## 14. limitations

- Stage 1では136 unique context中20 contextがtimeoutしている。participant coverageは34 / 34だが、全default-extent Search contextが
  測定済みという意味ではない（timeout contextを持つparticipant 13件）。
- timeout contextはCandidate 0として扱っておらず、portfolio size / diversity / oracle coverageは今回正常終了したcontextから得られた
  観測値である。portfolio size 1でもtimeout contextが残る11件については、default extent内alternativeの不在を確認していない。
- Search-onlyのため、portfolio Candidateがfixed Route setと共存できるか（Planner trial）は未確認。
- context parityのうちA10が記録しないfieldは比較していない（旧C2 11 orientationでは一致を確認）。
- kernel trial prefix parityのnot comparable 2件は、A10ではkernel完走したc20-p1の2 TargetがB1の10分budgetでtimeoutしたため。
- memoryはsampled max（250 ms）でtrue peakではない。
- final C3 readinessはB1では判定しない（default extentのみ）。

## 15. 事前登録したdecision rule（formal run前にcommit）

`PHASE2C26B1_DECISION_RULE`（`src/benchmarks/plannerGlobalPhase2C26B1Analysis.ts`）:

1. **B1-S semantic_failure**: A10 authority / A9 chain不一致、baseline / orientation / condition parity失敗、pre-Search context parity失敗、
   Search childのcontext再導出不一致、kernel trial prefix不一致、Search delivered Candidateのreservation違反のいずれか。
2. **B1-M measurement_complete**: 全participant explored、かつOOM / process failureによるunexplored 0。
3. **B1-I measurement_incomplete**: それ以外。

portfolio diversityの低さはsemantic failureではない。

## 16. 変更ファイル

| file | 内容 |
| --- | --- |
| `src/benchmarks/plannerGlobalPhase2C26B1.ts` | A10 authority parser、parity、context導出・`searchInputDigest` dedup、Search task、outcome / coverage / fallback選択、portfolio |
| `src/benchmarks/plannerGlobalPhase2C26B1Analysis.ts` | formal run検証、実行集計、kernel trial prefix parity、kernel metadata、portfolio集計、observed portfolioの解釈境界（`phase2c26b1PortfolioObservation()`、レビュー対応で追加）、decision |
| `src/benchmarks/plannerGlobalPhase2C26B1.test.ts` | 24 tests |
| `scripts/run-planner-global-phase2c26b1.mjs` | runner（contexts child → gate → Stage 1 → fallback） |
| `scripts/analyze-planner-global-phase2c26b1.mjs` | post-hoc analyzer |
| `docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json` | formal RESULT |
| `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26B1.md` | 本文書 |

Production source（`src/domain` / `src/services` / `src/workers` / UI / db）の変更なし。ProductionからB1 moduleをimportしない（testで確認）。

## 17. 検証

- focused: `npx vitest run src/benchmarks/plannerGlobalPhase2C26B1.test.ts`（24 pass）
- `npm run lint`、`npx tsc -b --force`、`npm test`（332 files / 5442 tests pass）、`npm run build`、`git diff --check`

## 18. 再現

```bash
node scripts/run-planner-global-phase2c26b1.mjs --export <gogma-artian-planner-backup_20260927015837.json> --a10-result docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --run-dir .local/b1-formal.run --output .local/PLANNER_GLOBAL_PHASE2C26B1_RAW.json.local
```

```bash
node scripts/analyze-planner-global-phase2c26b1.mjs --run .local/PLANNER_GLOBAL_PHASE2C26B1_RAW.json.local --a10-result docs/PLANNER_GLOBAL_PHASE2C26A10_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --c2-result docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --output docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json
```

raw evidence（`.local/`、Git管理外）: run wall 12,850秒（約3.6時間）。

## 19. レビュー対応（PR #189）

formal measurement・計算module・runner・decision rule・semantic failure rule・oracle比較contractは変更していない。formal再測定はしていない。

- 解釈の修正: 「portfolio size 1 = 全contextを完走したうえでalternative 0」とした断定を、timeout context 11件 / 全context完走6件の
  区別に改めた（§1・§9・§10・§11・§13・§14）。
- RESULT: analyzerが生成していた `decision.recommendation`（「default extent portfolioを全participantで測定できた」）を、participant
  coverageであり全context完走ではない旨に修正し、`portfolio.observation`（participantごとのStage 1未完走context数とsize 1の内訳）と
  `oracleCoverage.scope` の説明を追加して再生成した。measured HEAD `cef4034`・`formal = true`・
  `calculationCodeChangedSinceMeasuredHead = []` は維持。説明field（`decision.recommendation`・`portfolio.observation`・`oracleCoverage.scope`）と
  analysis HEADを除き、旧RESULTとJSON全体が一致することを確認した（Stage 1 116 / 20、fallback 3 / 3、34 / 34、prefix 98 / 0 / 2、
  reservation違反0、`B1_M_measurement_complete` はすべて同値）。
- 改行コード: post-hoc解析TS・test・analyzer・本文書がCRLFでcommitされており、PR全体の `git diff --check` が行末空白として
  検出していた（初回commitのdiff-checkは未追跡fileに対して実行していたため見逃した）。内容を変えずLFへ統一した（`4d8dda1`。解析TS末尾の余分な空行も `2dc72c0` で削除）。
  計算module（`plannerGlobalPhase2C26B1.ts`）とrunnerは元からLFで、measured HEADのまま無変更。
