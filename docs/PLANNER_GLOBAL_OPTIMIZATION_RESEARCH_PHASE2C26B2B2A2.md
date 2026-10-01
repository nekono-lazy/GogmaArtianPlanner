# Global Planner Research Phase 2-C2.6-B2-B2A2（boundary operation-cost cohortのdrain）

Refs #154。Research only。Production source、Search algorithm / ordering / comparator、extent default、Production capture bound、
Candidate Search、Planner Alternative kernel、Candidate trial、full Planner rerun、global assignment、最終43 Target共存判定、
context scheduler、extent不足19件のSearch、UI、runtime optimizationは変更・実行していない。

- measured HEAD: `ca4542942c06851d11572093c398691242b3e7cd`（B2-B2A authority parser・task選択・boundary cost導出・cohort stop rule・
  safety cap・Search runner・prefix parity・fallback rule・analyzer・事前登録decision rule・testsを含むclean HEAD）
- analysis HEAD: `3eb7c1b4ab45de3ad630a8c865b561160d401ed7`（measured HEAD以後の変更は post-hoc許可対象の
  `src/benchmarks/plannerGlobalPhase2C26B2B2A2Analysis.ts` だけ。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json)（`provenance.formal = true`、
  `oracleGuidedTaskSelection = true`、`oracleReadBySearchRunner = false`）

## 0. 最重要limitation

> 対象2 contextはB2-B1のpost-hoc oracle compatibilityで選ばれた代表contextで、さらにtask選択はB2-B2Aのpost-hoc miss分類
> （`capture_or_ordering_unresolved`）に基づく。今回証明するのは「current Searchのdelivery sequenceのどこにoracle Routeがあるか」だけ。

Productionがこのcontextをoracle無しで選べること、Productionのcapture boundを増やすべきこと、Planner trial / 43 Target共存が
成立することは、本Phaseでは示していない。

## 1. 結論（`B2B2A2_ALL_LATE_EXACT`）

| Target | boundary cost | boundary cohort | drained | sentinel（index / cost） | first exact | B2-B2A index 32以降 |
| --- | ---: | ---: | --- | --- | ---: | --- |
| 46bf2c78 | 2 | 158件（+ cost 1 が1件） | yes | 159 / 3 | **158** | yes |
| c140578c | 2 | 100件（+ cost 1 が1件） | yes | 101 / 3 | **99** | yes |

事前登録ruleにより **B2B2A2_ALL_LATE_EXACT**（2 / 2 measured、2 / 2 exact、prefix parity 2 / 2、reservation violation 0、
invalid reason 0）。

- 2件とも、B2-B2Aが32件目で打ち切ったoperation cost 2のcohortの **中に** oracle Routeとexact一致するCandidateがあり、
  cost 2 cohortを最後までdrainしたところ（cost 3のsentinelが届いた時点）で観測された。partial_comparableは0。
- 従ってB2-B2Aの未解決2件は「Searchがpublishしない」ではなく、**capture 32と同cost内のordering（Gogma advance昇順）だけで説明できる**。
  `boundary_cohort_drained_without_match`（composition / publication gap）は0件。
- ただし「Productionのcapture boundを増やすべき」とはまだ結論しない（§8）。

## 2. 方針

```text
B2-B2A RESULT（task選択authority、oracle-guided）
  -> comparison.deliveryClass === capture_or_ordering_unresolved の行だけ（RESULTから機械的に2行、Target UUIDのhard-code無し）
  -> 各行: search.status = consumer_stop、delivered = 32、coverage = uncovered、exact / partial index = [] を確認
  -> boundaryCost = search.candidates[31].summary.estimatedOperationCount（行ごとに導出。両行とも2）、先頭32件のcostは非減少
  -> tasks child: derivePhase2C26B2B1Snapshot()（Exportのみ）からcontext再構築
  -> gate: B2-B1 representative（既存 comparePhase2C26B2B2AReconstruction()）かつ B2-B2A行
       （fixed set / fixed Targets / cardinality / group / reservation digest・range形 / searchInputDigest / excluded Route key SHA-256 / extent）と一致
  -> Search child（task毎のfresh process）: 再度contextを再導出しtask digestと照合
       visitPlannerAlternativeCandidates() 無変更、Production default extent
       cost <= boundaryCost   -> cohortへ記録して continue
       最初の cost > boundaryCost -> nextCostSentinel として記録（cohort外）、stop
       natural end（exhausted / stopped_by_extent） -> drain済み
       boundaryCost以下が8192件 -> cohort_safety_cap で stop（drainとは主張しない）
  -> analyzer（run終了後のみ）: oracle RESULT / manifest を読み、既存 phase2c26b2b2aCompare() -> phase2c2OracleCoverage() で比較
```

Search child / runnerが知るのは Target・fixed-set selector・reservation digest・searchInputDigest・Production default extent・
再導出したreservation / excluded current Route key / origin・boundary cost・safety capだけで、oracle RESULT・manifest・oracle stable key・
oracle Route kind・oracle operation位置・oracle operation count・expected delivery indexは知らない（testで確認）。
visitorの `'stop'` はsentinelとsafety capの2箇所だけで、oracle一致で止まる経路は無い。oracleのoperation cost（`materialization.estimated.operations`）
とboundary costの照合はanalyzerだけが行う（2 / 2一致）。

Search ordering契約（`compareConstrainedCandidates()`）: operation cost → Gogma advance → Skill advance → Normal advance → preferred source →
stable key。同一costのCandidateはそのcost以下のpending workがsettleしてからbuffer→sort→deliveryされるため、cost 3のsentinelが届いた時点で
cost 2 cohortは完全にdeliveryされている。child側では全deliveryについて直前deliveryとの `Math.sign(compareConstrainedCandidates(prev, cur))`
を記録し、全件 `-1`、かつ記録した6 keyの辞書式比較と一致することをanalyzerで確認した（cost列は非減少）。

## 3. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-B2A RESULT | `docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json` SHA-256 `b1ae4e8112772ebc75cba14de3fdead48a55ce34c6871ec03ca6f628c73fa9cb`（登録値と一致） |
| B2-B2A provenance | `formal = true`、`calculationCodeChangedSinceMeasuredHead = []`、measured = analysis `93f42f4`、`B2B2A_PARTIAL_DELIVERY` |
| B2-B2A 登録値 | targets 20 / measured 20 / exact 18 / partial 0 / capture_or_ordering_unresolved 2 / completed_without_oracle_match 0 / unmeasured 0、reservation violation 0、capture bound 32、default extent、hashChain全true、reconstruction 20 / 20 |
| B2-B1 RESULT | SHA-256 `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d`（B2-B2A記録値・B2-B2A登録値と一致） |
| B2-A RESULT | SHA-256 `7f425ca46d7908280793440570d8af6e85fe589ec8772160021f15f2e814b883`（B2-B2A・B2-B1記録値と一致） |
| oracle RESULT | SHA-256 `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1`（B2-B2A・B2-B1・B2-A記録値と一致） |
| oracle manifest | file `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、Routes `ffb6db5a39e248b950a75f9094ae641a4a35f256a035e37564227bdc6e0e73cc`（B2-B2A・B2-B1・oracle記録値と一致、manifest ↔ RESULT整合も一致） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（run = B2-B2A = B2-B1 = B2-A = oracle） |
| B2-B2A raw（補助prefix parity） | SHA-256 `9fb9749bb85efb04f8eba7d1c7d42c6af1b2727146e691b10dd928837cbc81c0`（B2-B2A RESULT `sources.run` と一致したときだけ使用） |
| benchmark code | SHA-256 `8ce5b55bc65629141ecb4e74dbcef67b0c86cf23e2b67e8aa412edb171414a2b` |

## 4. task / 実行条件

| 項目 | 値 |
| --- | --- |
| total | 2（B2-B2A `capture_or_ordering_unresolved`、RESULTから機械的に選択） |
| context | B2-B2Aと同じ（K1、fixed set `K1:build-list.fnv1a32-32e817d9`、同一reservation、current Route除外）、再構築 2 / 2一致 |
| extent | Production default `{ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }` |
| boundary cost | 行ごとに index 31 のcostから導出（2 / 2）。index 0はcost 1、index 1..31はcost 2 |
| cohort safety cap | 8192（`PHASE2C26B2B2A2_COHORT_SAFETY_CAP`、Research事故防止。Production capture boundではない） |
| Stage 1 | fresh child / task、heap 8192 MB、concurrency 1、budget 30分、`yieldControl = setImmediate`、retryなし、memory sampling 250 ms |
| fallback | Stage 1 timeoutのみ、同一task、fresh child、heap 8192 MB、budget 60分、1回。OOM / process failureは再試行しない |

## 5. 実行

| | 件数 |
| --- | ---: |
| Stage 1 completed / timeout / OOM / process failure / context mismatch | 2 / 0 / 0 / 0 / 0 |
| fallback attempted | 0 |
| final measured / unmeasured | 2 / 0 |

| Target | Search | child process wall | yields | peak heap | peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 46bf2c78 | 17.3 s | 24.5 s | 85,642 | 1.71 GB | 2.00 GB |
| c140578c | 41.8 s | 50.4 s | 213,884 | 4.93 GB | 5.28 GB |

run全体のwall 81 s（tasks child 5.6 s含む、Node / Vite SSR、AMD Ryzen 7 9700X、NOT a Browser Worker）。safety capには
どちらも達していない（`safetyCapHit = 0`）。

## 6. prefix parity（B2-B2A deliveries 0..31）

| Target | stable key SHA-256 | routeKind / sourceKind / cost / stream位置 / heldRoute | estimatedAdvances・summary全体（B2-B2A raw） |
| --- | --- | --- | --- |
| 46bf2c78 | 32 / 32 | 32 / 32 | 32 / 32 |
| c140578c | 32 / 32 | 32 / 32 | 32 / 32 |

今回のSearchの先頭32件はB2-B2A formal RESULT（およびそのraw）と完全一致した。Search / ordering / contextのdriftは無い。

## 7. boundary cohortとordering

### 7.1 cohortの中身（cost 2のCandidateのみ）

| 項目 | 46bf2c78 | c140578c |
| --- | --- | --- |
| cohort件数 | 158 | 100 |
| routeKind | keep_bonuses 157 / mixed 1 | keep_bonuses 98 / mixed 2 |
| operation | Keep×2: 157 / Reset+Keep: 1 | Keep×2: 98 / Reset+Keep: 2 |
| source | owned Gogma 1種（158件同一） | owned Gogma 2種（preferred 99 / 他 1） |
| Gogma advance | 158: 157件 / 234: 1件 | 99: 98件 / 114: 2件 |
| Gogma位置（Keep×2） | 1回目 55..211（157通り）、2回目 すべて212 | 1回目 55..152（98通り）、2回目 すべて153 |
| Gogma位置（mixed） | Reset 101 → Keep 288 | Reset 70 → Keep 168（2 source） |
| Skill / Normal advance | 0 / なし | 0 / なし |
| **distinct final weapon** | **1** | **1** |
| heldRoute / late-start | 157 / 157 | 99 / 99 |
| reservation violation | 0（sentinel含む） | 0（sentinel含む） |

sentinel（cost 3の最初のCandidate）はいずれも Keep×3（46bf2c78: 55 / 99 / 212、c140578c: 55 / 99 / 153）。

### 7.2 exact Candidate

| Target | index | routeKind | Gogma位置 | Gogma advance | preferred rank | stable key SHA-256 |
| --- | ---: | --- | --- | ---: | ---: | --- |
| 46bf2c78 | 158（cohort最後） | existing_gogma_mixed（Reset + Keep） | 101, 288 | 234 | 0 | `c9dbd08a…7915` |
| c140578c | 99 | existing_gogma_mixed（Reset + Keep） | 70, 168 | 114 | 0 | `fe0c6f30…ac76` |

### 7.3 なぜB2-B2Aの32件より後ろだったか（six-key comparatorでのpost-hoc説明）

| 先行Candidateを先にした最初のkey | 46bf2c78（158件） | c140578c（99件） |
| --- | ---: | ---: |
| lower operation cost（cost 1） | 1 | 1 |
| same cost, lower Gogma advance | **157** | **98** |
| same Gogma, lower Skill advance | 0 | 0 |
| same Skill, lower Normal advance | 0 | 0 |
| same stream advances, preferred source | 0 | 0 |
| stable-key tie-break | 0 | 0 |

- exact Candidateより前の同cost Candidateはすべて **Gogma advanceが小さい** ことだけで先行していた（46bf2c78: 158 < 234、
  c140578c: 99 < 114）。tie-break（preferred source / stable key）で負けたものは無い。
- 先行したKeep×2群は最終Gogma位置（212 / 153）が同じで1回目のKeep位置だけが異なるheld Routeで、最終武器はexact Candidateと同一
  （distinct final weapon = 1）。heldの広いreservation（Gogma 55..430 held）の下で、同じ結果に届く位置違いの変種が
  cohort内でGogma advanceの小さい側に並び、oracle Route（より遠いGogma位置を使う別operation構成）がcohortの末尾側に回った。
- c140578cではexact（index 99）と同じGogma advance 114のReset+Keepが別sourceでindex 100にあり、こちらはpreferred sourceの差で
  exactの後ろに並んだ（exactのpredecessorではないので上表には入らない）。
- oracleがなぜ位置違いのKeep×2ではなくこのReset+Keepを使ったか（他Targetとの共存など）は本Phaseでは判定しない。

## 8. interpretation

- current Searchは、known-compatible代表context下で、2件ともoracle Routeをboundary cost cohort内でpublishしていた。
  B2-B2Aの20件は、20 / 20がこの代表contextのdefault extent Search sequence内でexact deliveryされることになる
  （18件は先頭8件以内、2件はcost 2 cohortのindex 99 / 158）。
- 位置違い・同一結果のheld Route変種がcohortの大半（157 / 158、98 / 100）を占めたことが、capture 32で届かなかった直接の原因。
  これはcapture policy（同一結果をどう扱うか、何件取るか）の論点であって、Search生成能力の欠落ではない。
- それでも **Productionのcapture boundを直ちに増やすべきとは結論しない**: (1) contextはoracle-guided representative、
  (2) Production context schedulerは未設計、(3) Planner trial / global coexistenceは未検証、(4) 同一結果の変種を捨てる / 圧縮する方針は
  oracle Routeの位置要件と衝突しうる（位置違いが共存上意味を持つ）ため、単純な件数拡大でも単純な重複除去でもない設計判断が要る。

## 9. next recommendation（結果から: 2 / 2 exact）

1. **oracle非依存context schedulerとCandidate capture policyの研究**: どのcurrent Routeを固定するかを決める規則と、
   cost cohort内に同一最終武器の位置違い変種が大量に並ぶ場合のcapture方針（cohort単位のcapture、同一結果の代表選択、
   位置多様性の確保など）を、oracle非依存の事前登録ruleで比較する。Search ordering / comparatorの変更はまだ根拠にしない。
2. その後 **extent不足19件（B2-B2B）** へ。
3. residual 3件はalternative-to-alternative support研究として別branch。

## 10. limitations

- task選択・context選択ともoracle-guided（§0）。
- 1 context / Target、2 Targetのみ。同じTargetの他contextでの順位は見ていない。
- cohort drainの判定はSearch ordering契約（cost非減少のcohort単位delivery）に依拠する。これはchild側で記録した
  comparator verdictとcost列の非減少で各runについて確認した。
- 単一Export・current Production・default extentのみ。Node（Vite SSR）child processでの測定で、Browser Workerではない。

## 11. 事前登録したdecision rule（formal run前に `ca45429` でcommit、以後無変更）

1. **B2B2A2_INVALID**: B2-B2A authority mismatch、hash chain不一致（B2-B1 / B2-A / oracle / manifest / ExportとB2-B2A記録値）、task数≠2、
   選択行がcapture_or_ordering_unresolvedでない（consumer stop 32・uncovered・exact / partial index無し）、context再構築不一致
   （B2-B1 representative / B2-B2A行）、Search child内context mismatch、first32 prefix不一致、default extent不一致、
   delivery cost列の非単調 / comparator不一致、oracle operation cost ≠ boundary cost、delivered Candidate（sentinel含む）の
   reservation違反、provenance failure、raw / result不整合。
2. **B2B2A2_ALL_LATE_EXACT**: 2 / 2 measured かつ 2 / 2 exact（late_exact_in_boundary_cohort）。
3. **B2B2A2_PARTIAL_LATE_EXACT**: 2 / 2 measured、exact 1、他方はdrained（match levelは問わない）かsafety_cap_unresolved。
4. **B2B2A2_NO_MATCH_AFTER_DRAIN**: 2 / 2 measured、exact 0、2 / 2 cohortDrained。
5. **B2B2A2_INCOMPLETE**: invalid無しで上記いずれでもない（exact 0でsafety cap未drainあり、またはfallback後unmeasured）。

class: `late_exact_in_boundary_cohort`（exact、index ≥ 32、cost = boundary）、`partial_in_boundary_cohort`、
`boundary_cohort_drained_without_match`、`safety_cap_unresolved`、`unmeasured`（timeout / OOM / failure、Candidate 0扱いしない）。

formal run前に、配線確認のため非formal smoke（`--allow-uncommitted --smoke-tasks 2`）を1回実行した。task選択・stop rule・safety cap・
decision ruleはsmoke前に確定しており、smoke後のcalculation code変更は無い（smoke rawはformal RESULTに使っていない）。
formal run後に、post-hoc許可対象のanalysis moduleへcohort記述統計（operation構成・source・Gogma first / last位置分布・distinct final weapon数）
だけを追加し、同じformal rawを再解析した（decision・classは変化なし）。

## 12. 変更ファイル

| file | 内容 |
| --- | --- |
| `src/benchmarks/plannerGlobalPhase2C26B2B2A2.ts` | B2-B2A authority parser、task選択とboundary cost導出、B2-B2A行との再構築parity、cohort drain Search child（`visitPlannerAlternativeCandidates()` + 既存summary / reservation helper + 6 key / comparator記録）、task outcome / fallback trigger。oracleを読まない。B2-B2Aの再構築・context型を再利用 |
| `src/benchmarks/plannerGlobalPhase2C26B2B2A2Analysis.ts` | post-hoc: final outcome、raw整合（cost単調・comparator一致・termination）、prefix parity、既存 `phase2c26b2b2aCompare()` による比較とclass、six-key ordering説明、cohort分布、decision |
| `src/benchmarks/plannerGlobalPhase2C26B2B2A2.test.ts` | 20 tests |
| `scripts/run-planner-global-phase2c26b2b2a2.mjs` | runner（B2-B2A / B2-B1 RESULTとExportのみ読む、timeoutは親側判定） |
| `scripts/analyze-planner-global-phase2c26b2b2a2.mjs` | analyzer（B2-B2A / B2-B1 / B2-A / oracle / manifest、任意でB2-B2A rawを読む） |
| `docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json` | formal RESULT（stable keyはSHA-256。cohort全件はraw側、RESULTはmatched / 境界付近 / 末尾のみ） |
| `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26B2B2A2.md` | 本文書 |

Production source（`src/domain` / `src/services` / `src/workers` / UI / db）の変更なし。ProductionからB2-B2A2 moduleをimportしない（testで確認）。

## 13. 再現

```bash
node scripts/run-planner-global-phase2c26b2b2a2.mjs --export <gogma-artian-planner-backup_20260927015837.json> --b2b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --run-dir .local/b2b2a2-formal.run --output .local/PLANNER_GLOBAL_PHASE2C26B2B2A2_RAW.json.local
```

```bash
node scripts/analyze-planner-global-phase2c26b2b2a2.mjs --run .local/PLANNER_GLOBAL_PHASE2C26B2B2A2_RAW.json.local --b2b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --b2b2a-raw .local/PLANNER_GLOBAL_PHASE2C26B2B2A_RAW.json.local --output docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json
```

raw run（`.local/`、Git管理外）SHA-256 `99576fc62e5f4b9c745cbfceead97cc9e164e887d6405d3ae8fdaf9d2ca6632b`。
