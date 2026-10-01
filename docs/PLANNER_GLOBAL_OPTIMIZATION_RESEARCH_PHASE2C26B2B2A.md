# Global Planner Research Phase 2-C2.6-B2-B2A（known-compatible代表contextでのSearch delivery測定）

Refs #154。Research only。Production source、Search algorithm / ordering、extent default、Candidate Search、Planner Alternative
kernel、Candidate trial、full Planner rerun、global assignment、最終43 Target共存判定、alternative-to-alternative support生成、
residual 3件のSearch、extent不足19件の拡張Search、UI、runtime optimizationは変更・実行していない。

- measured HEAD: `93f42f406e2e2593db9755cbf38b60781558189d`（task選択・代表context再構築・Search runner・capture rule・
  timeout / fallback rule・analyzer・事前登録decision rule・testsを含むclean HEAD）
- analysis HEAD: `93f42f406e2e2593db9755cbf38b60781558189d`（`codeChangedSinceMeasuredHead = []`、
  `calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json)（`provenance.formal = true`、
  `oracleGuidedTaskSelection = true`、`oracleReadBySearchRunner = false`）

## 0. 最重要limitation

> 今回のrepresentative contextは、oracle RouteとのB2-B1 post-hoc compatibilityに基づいて選ばれている。
> したがって今回の実験は、「このcontextをどう自動発見するか」ではなく、
> 「このcontextを与えた場合にSearchがRouteをdeliveryできるか」だけを測る。

これは **known-compatible representative context下でのSearch delivery診断** であり、Productionがそのcontextを
oracle無しで選択できる証拠ではない。B2-B2Aの結果から「Production context schedulerは解決済み」「Global Plannerが1,657 Routeを
自動発見できる」とは言えない。Production schedulerへrepresentative fixed setやTarget IDを固定する、oracle supporterを優先する、
oracle位置をSearch hintにする、extentをoracle必要値へ設定する、といった利用はしてはならない。

## 1. 結論（`B2B2A_PARTIAL_DELIVERY`）

B2-B1でreservation-compatibleかつProduction default extent内と判定された20 Target（B2-A covered 2 + context gapから新規回収 18、
全件K1）について、B2-B1の代表contextをExportから再導出し、そのまま `visitPlannerAlternativeCandidates()` に渡して先頭32件を
captureした。

| 集計 | 全20 | 新規回収18 | historically covered control 2 |
| --- | ---: | ---: | ---: |
| measured | 20 | 18 | 2 |
| **exact** | **18** | **16** | **2** |
| partial_comparable | 0 | 0 | 0 |
| capture_or_ordering_unresolved | **2** | **2** | 0 |
| completed_without_oracle_match | 0 | 0 | 0 |
| not_comparable | 0 | 0 | 0 |
| unmeasured | 0 | 0 | 0 |

事前登録ruleにより **B2B2A_PARTIAL_DELIVERY**（20 / 20 measured、exact 18、semantic failure 0、invalid reason 0）。

- 新規回収18件のうち16件は、代表contextを与えるとSearchがoracle Routeと **exact一致するCandidateを先頭8件以内** でpublishした
  （index 0: 11、1: 3、2-3: 1、4-7: 1）。B1のcapture 8でも届く位置であり、B2-Aでuncoveredだった原因はcapture上限ではなく
  context（固定winner / reservation）の不足だった、という読みと整合する。
- 残る2件（46bf2c78、c140578c、いずれもoracle held Route）は32件captureしてもexact / partialが無く、Searchは32件目で
  consumer stopした（extent stop / exhaustionではない）。32件以降にoracle Routeが存在する可能性は残るため、
  「Searchで生成不能」とはしない（§6）。
- `completed_without_oracle_match` は0件。compatible + default extent内なのにSearchが完走してRouteをpublishしなかった
  ケースは今回観測されなかった。
- historically covered control 2件は今回もexact（index 0 / 3）で、B1でexactだったCandidateと同じstable key（SHA-256一致）。
- delivered 640件すべてが自身のreservationを守った（`respectsPhase2C2Reservation().respects === true`、violation 0）。

## 2. 方針

```text
B2-B1 RESULT（task選択authority、oracle-guided）
  -> minimalCardinality ∈ {1, 2} AND extent.withinDefaultExtent の20 Target（2 covered + 18 新規、全K1）
  -> tasks child: derivePhase2C26B2B1Snapshot()（Exportのみ）から代表context再構築
       Target current Entry / fixedSetId / fixed Entry IDs / reservation group / normalized reservation / reservationDigest /
       cardinality / current Route key / Planner-start origin / default extent
  -> gate: B2-B1 RESULTの representative・range形reservation・current Entry・Route key SHA-256・origin digest と一致（20 / 20）
  -> Search child（task毎のfresh process）: 再度snapshotから同じcontextを再導出し、task digestと照合
       visitPlannerAlternativeCandidates({ origin, targetWeaponId, extent, reservation, excludedRouteKeys })
       先頭32件capture（consumer stopはcaptureだけ）、materialize -> summarizePhase2C2Entry() / respectsPhase2C2Reservation()
  -> analyzer（run終了後のみ）: oracle RESULT / manifest / B2-A / B1 RESULTを読み、phase2c2OracleCoverage()で比較
```

Search child / runnerが知るのは Target・Planner-start origin・Production default extent・reservation・excluded current Route key・
capture boundだけで、oracle RESULT・manifest・oracle Candidate stable key・oracle operation位置・expected source / Route kind・
expected delivery indexは知らない（testで確認）。oracle一致で早期停止する経路は無い（visitorの `'stop'` はcapture到達の1箇所のみ）。
Searchへ渡すreservationはRESULTの値ではなく、今回再導出したProduction authority（`derivePlannerAlternativeReservation()`）の値である。

## 3. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-B1 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json` SHA-256 `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d`（登録値と一致） |
| B2-B1 provenance | `formal = true`、`calculationCodeChangedSinceMeasuredHead = []`、measured = analysis `b7d04bb` |
| B2-B1 登録値 | `B2B1_PARTIAL_ELIGIBLE_RECOVERY`、context gap K1 28 / K2 9 / unreached 3、回収37件のdefault extent内 18 / 不足 19、全43件の `recoveredWithinDefaultExtent = 20`、invalidReasons []、snapshot整合 valid、B2-A parity valid（K1 context・reachability verdict・extent・empty reservation verdict 全一致） |
| B2-A RESULT | SHA-256 `7f425ca46d7908280793440570d8af6e85fe589ec8772160021f15f2e814b883`（B2-B1記録値と一致、B2-A authorityとしても登録値どおり） |
| oracle RESULT | SHA-256 `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1`（B2-B1・B2-A記録値と一致、`proven_minimum`） |
| oracle manifest | file `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、Routes `ffb6db5a39e248b950a75f9094ae641a4a35f256a035e37564227bdc6e0e73cc`（B2-B1・B2-A・oracle記録値と一致、manifest ↔ RESULT整合も一致） |
| B1 RESULT（control参照のみ） | SHA-256 `292471e89eabda45710a5ac82b5770f7a43072501aea8b393ca779c57959f77e`（B2-A記録値と一致） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（run = B2-B1 = B2-A = oracle） |
| benchmark code | SHA-256 `7f95760dfdfd0d7004d01b4f4dc6044bbb5df2245a30144a75f04171565ce4a6` |

## 4. task

| 項目 | 値 |
| --- | --- |
| total | 20（B2-B1 `routes` のうち minimalCardinality 1 / 2 AND `extent.withinDefaultExtent`） |
| historically covered control | 2（57126a5e、820831d0） |
| newly recovered default extent | 18（B2-A context gap → B2-B1でcompatible化 → default extent内） |
| K1 / K2 | 20 / 0（K2が含まれたらauthority driftとしてfail-close。新規18件はB2-B1 context gapのK1回収・default内18件と一致） |
| 代表fixed set | 3種類（全件K1、reservationも3種類） |
| representative reconstruction | 20 / 20 一致（fixed set・group・digest・range形reservation・current Entry・Route key・origin・extent） |
| extent | Production default `{ maxNormalAdvance: 4, maxGogmaAdvance: 235, maxSkillAdvance: 4 }`（Target毎の拡張なし） |
| capture bound | 32（`PHASE2C26B2B2A_CAPTURE_BOUND`、Research only） |
| Stage 1 | fresh child / task、heap 8192 MB、concurrency 3、budget 10分、`yieldControl = setImmediate`、retryなし、memory sampling 250 ms |
| fallback | Stage 1 timeoutのみ、同一task（Target・origin・reservation・fixed set・extent・excluded Route・capture）、fresh child、heap 8192 MB、concurrency 1、budget 30分、1回。OOM / process failureは再試行しない |

checkpoint hard constraint・unreached・extent不足のTargetは対象外。

## 5. Search completion / runtime

| | 件数 |
| --- | ---: |
| Stage 1 completed / timeout / OOM / process failure / context mismatch | 20 / 0 / 0 / 0 / 0 |
| fallback attempted / completed / timeout / OOM / failure | 0 / 0 / 0 / 0 / 0 |
| final measured / unmeasured | 20 / 0 |

| runtime（measured 20件） | min | median | p90 | max |
| --- | ---: | ---: | ---: | ---: |
| Search（visit + capture） | 0.44 s | 1.88 s | 28.5 s | 49.4 s |
| child process wall（loader・Export・snapshot・Search） | 5.5 s | 7.1 s | 33.9 s | 54.9 s |
| yield count | 2,341 | 14,501 | 213,884 | 409,168 |

peak heap max 4.90 GB、peak RSS max 5.25 GB（同時3 process）。run全体のwallは109 s（Node / Vite SSR、AMD Ryzen 7 9700X、
NOT a Browser Worker）。

## 6. delivery

### 6.1 per Target

| task | Target | 区分 | 代表fixed set（K1） | oracle held | delivery class | matched index | Search s | peak heap MB |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| t00 | 0d98b225 | newly | 32e817d9 | - | exact | 0 | 1.7 | 649 |
| t01 | 155a6831 | newly | 0e8ede71 | - | exact | 0 | 0.4 | 649 |
| t02 | 15829bfe | newly | 32e817d9 | held | exact | 0 | 16.8 | 4084 |
| t03 | 1d916ff0 | newly | 0e8ede71 | held | exact | 0 | 2.1 | 649 |
| t04 | 2123eaa6 | newly | 0e8ede71 | - | exact | 0 | 1.3 | 363 |
| t05 | 27ac3237 | newly | 32e817d9 | held | exact | 4 | 28.5 | 4643 |
| t06 | 46bf2c78 | newly | 32e817d9 | held | capture_or_ordering_unresolved | — | 1.0 | 648 |
| t07 | 57126a5e | control | 32e817d9 | - | exact | 0 | 0.9 | 649 |
| t08 | 820831d0 | control | 6aac5fa0 | held | exact | 3 | 8.2 | 1466 |
| t09 | 8d233d8b | newly | 32e817d9 | - | exact | 0 | 5.7 | 1438 |
| t10 | 9733b090 | newly | 0e8ede71 | held | exact | 3 | 0.6 | 649 |
| t11 | a26f6bcf | newly | 32e817d9 | - | exact | 1 | 1.3 | 664 |
| t12 | aa4e67d8 | newly | 32e817d9 | - | exact | 0 | 1.3 | 649 |
| t13 | b4f252cd | newly | 32e817d9 | - | exact | 0 | 1.5 | 659 |
| t14 | be881717 | newly | 32e817d9 | held | exact | 1 | 10.8 | 1493 |
| t15 | c140578c | newly | 32e817d9 | held | capture_or_ordering_unresolved | — | 1.3 | 649 |
| t16 | d45a7d4e | newly | 32e817d9 | held | exact | 0 | 49.4 | 4622 |
| t17 | e96249b4 | newly | 32e817d9 | held | exact | 1 | 5.4 | 1451 |
| t18 | f5d20af4 | newly | 0e8ede71 | - | exact | 0 | 3.6 | 647 |
| t19 | fea60316 | newly | 32e817d9 | held | exact | 0 | 30.1 | 4675 |

（fixed setは `K1:build-list.fnv1a32-<表の値>`。exactのCandidateは各taskで1件ずつ、`exactDeliveryIndexes` = matched indexのみ。）

### 6.2 delivery index分布（exactの最初の一致位置）

| index | 0 | 1 | 2-3 | 4-7 | 8-15 | 16-31 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 全20（exact 18） | 12 | 3 | 2 | 1 | 0 | 0 |
| 新規18（exact 16） | 11 | 3 | 1 | 1 | 0 | 0 |
| control 2（exact 2） | 1 | 0 | 1 | 0 | 0 | 0 |

`exactBeyondCapture8 = 0`: exactはすべてindex 7以内で、B1のcapture 8で取り逃がしていたものは無い。

### 6.3 未delivery 2件（capture_or_ordering_unresolved、post-hoc記述のみ）

| Target | oracle Route | delivered 32件 |
| --- | --- | --- |
| 46bf2c78 | owned Gogma、`existing_gogma_mixed`、Gogma 101 と 288（held route、2 operation） | 全件 `existing_gogma_keep_bonuses`、同じ所持武器、最終Gogma位置はすべて212、先頭operationの位置だけが異なる（212単独、99..の各位置） |
| c140578c | owned Gogma、`existing_gogma_mixed`、Gogma 70 と 168（held route、2 operation） | 全件 `existing_gogma_keep_bonuses`、同じ所持武器、最終Gogma位置はすべて153、先頭operationの位置だけが異なる |

どちらもSearchは32件目でconsumer stopしており、Searchがより早く終わる同一source・同一最終位置のKeep Route変種を先に列挙し続けた
ことだけが観測された。oracle Routeが33件目以降にあるか、このcontextでは列挙されないかは今回の測定では区別できない
（closest differenceは routeKind / Gogma位置 / finalBonuses / estimatedAdvances）。Search algorithmやorderingの不具合とは断定しない。

## 7. Search termination / candidate diversity（20 context、1 context / Target）

| 項目 | 値 |
| --- | --- |
| total delivered | 640（全taskで32件、unique stable key / Target も全件32） |
| termination | consumer_stop 20、stopped_by_extent 0、exhausted 0 |
| excluded Candidates（current Route） | 0（current Routeには到達しなかった） |
| sourceKind | owned_gogma 637、new_normal 3 |
| routeKind | existing_gogma_mixed 321、existing_gogma_keep_bonuses 316、normal_artian_to_gogma 3 |
| heldRoute | 624 / 640（20 / 20 TargetでheldRoute Candidateあり） |
| late-start | 584（Gogma 584、Skill 32、Normal 0） |
| reservation violation | 0 |

これは代表context 1つ / Targetの結果であり、Production全体のCandidate portfolioではない。

## 8. interpretation

- これはknown-compatible representative context下でのSearch delivery診断であり、Productionがそのcontextをoracle無しで
  選択できる証拠ではない。
- reservation上で表現可能かつdefault extent内のRouteは、20件中18件でcurrent SearchからCandidateとしてpublishされた。
  そのほとんど（15 / 18）はindex 0..1で、B2-Aでuncoveredだった新規16件は「Searchがdeliverできない」ではなく「適切なcontext
  （どのcurrent Routeを固定するか）が与えられていなかった」ことで説明できる。
- B2-B1のreservation compatibility（表現可能性）はSearch deliveryの必要条件として整合しており、今回反例（completed_without_oracle_match）
  は無かった。ただし十分条件かは、capture内で決着しなかった2件が残るため確定しない。
- 最終43 Target Planでの共存、full Planner rerun、alternative同士の組合せは見ていない。

## 9. next recommendation

1. **oracle非依存のcontext scheduler設計**: 今回の代表fixed setは3種類（全K1）で20件を覆えた。どのcurrent Routeを固定するかを
   oracle無しで決める規則（候補fixed setの列挙・順序・予算）を別Phaseで設計する。代表fixed setやTarget IDのhard-codeはしない。
2. **ordering / capture probe**（未delivery 2件）: 同一source・同一最終位置のKeep変種が先頭を占める状況で、capture拡大または
   列挙順序の観測によりoracle Routeが33件目以降に現れるかを切り分ける。現時点でSearch ordering変更の根拠にはしない。
3. **extent不足19件の別probe（B2-B2B）**: Skill 19・Normal 3（重複あり）のextent不足Routeを、oracle必要値ではない事前登録gridで
   測る。
4. **residual 3件**: current Route固定では原理的に届かないため、alternative-to-alternative support研究として別branchで扱う。

Searchのruntimeは全件10分以内に完走しており、performance / completion問題は今回の20 contextでは観測されていない。

## 10. limitations

- task選択はoracle-guided（§0）。
- 1 context / Target（B2-B1の代表、minimal cardinalityで最初のcompatible context）だけを測った。同じTargetの他のcompatible contextでの
  deliveryは見ていない。
- capture 32で打ち切るため、`capture_or_ordering_unresolved` の2件は32件以降の存在 / 不在が未確定。
- 単一Export・current Production・default extentのみ。Node（Vite SSR）child processでの測定で、Browser Workerではない。

## 11. 事前登録したdecision rule（formal run前に `93f42f4` でcommit、以後無変更）

1. **B2B2A_INVALID**: B2-B1 authority mismatch、Export / B2-A / oracle / manifest hash chain不一致、task数≠20（2 covered + 18新規）、
   K1-only fixture条件違反、代表context再構築 / reservation digest / extent不一致、Search child内のcontext mismatch、
   delivered Candidateのreservation違反（`respectsPhase2C2Reservation().respects === false`）、provenance failure、raw / result不整合、
   比較の内部不整合。
2. **B2B2A_INCOMPLETE**: invalid無し、かつfallback後もunmeasured taskあり（timeout / OOM / process failure）。
3. **B2B2A_ALL_EXACT**: 20 / 20 measured かつ 20 / 20 exact。
4. **B2B2A_NO_EXACT**: 20 / 20 measured かつ exact 0。
5. **B2B2A_PARTIAL_DELIVERY**: 20 / 20 measured かつ exact 1〜19。

`exact` は `phase2c2OracleCoverage().coverage === "exact"` だけ。`partial_comparable` は別記録でALL_EXACTに含めない。
consumer stop（32件）でexact / partial無し = `capture_or_ordering_unresolved`、extent stop / exhaustionでexact / partial無し =
`completed_without_oracle_match`、timeout / OOM / failure = `unmeasured`（Candidate 0扱いしない）。

formal run前に、配線確認のため非formal smoke（`--allow-uncommitted --smoke-tasks 3`）を1回実行した。task選択・capture・decision rule・
analyzerはsmoke前に確定しており、smoke後の変更は無い（smoke rawはformal RESULTに使っていない）。

## 12. 変更ファイル

| file | 内容 |
| --- | --- |
| `src/benchmarks/plannerGlobalPhase2C26B2B2A.ts` | B2-B1 authority parser、task選択、代表context再構築・parity、Search child（`visitPlannerAlternativeCandidates()` + 既存summary helper）、task outcome / fallback trigger。oracleを読まない |
| `src/benchmarks/plannerGlobalPhase2C26B2B2AAnalysis.ts` | post-hoc: final outcome（timeout fallback採用）、raw整合、`phase2c2OracleCoverage()` による比較とdelivery class、index bucket、diversity、runtime、decision |
| `src/benchmarks/plannerGlobalPhase2C26B2B2A.test.ts` | 19 tests |
| `scripts/run-planner-global-phase2c26b2b2a.mjs` | runner（B2-B1 RESULTとExportのみ読む、timeoutは親側判定） |
| `scripts/analyze-planner-global-phase2c26b2b2a.mjs` | analyzer（B2-B1 / B2-A / oracle / manifest / B1 RESULTを読む） |
| `docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json` | formal RESULT（stable keyはSHA-256） |
| `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26B2B2A.md` | 本文書 |

Production source（`src/domain` / `src/services` / `src/workers` / UI / db）の変更なし。ProductionからB2-B2A moduleをimportしない（testで確認）。

## 13. 再現

```bash
node scripts/run-planner-global-phase2c26b2b2a.mjs --export <gogma-artian-planner-backup_20260927015837.json> --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --run-dir .local/b2b2a-formal.run --output .local/PLANNER_GLOBAL_PHASE2C26B2B2A_RAW.json.local
```

```bash
node scripts/analyze-planner-global-phase2c26b2b2a.mjs --run .local/PLANNER_GLOBAL_PHASE2C26B2B2A_RAW.json.local --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --b1-result docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json --output docs/PLANNER_GLOBAL_PHASE2C26B2B2A_RESULT.json
```

raw run（`.local/`、Git管理外）SHA-256 `9fb9749bb85efb04f8eba7d1c7d42c6af1b2727146e691b10dd928837cbc81c0`。
