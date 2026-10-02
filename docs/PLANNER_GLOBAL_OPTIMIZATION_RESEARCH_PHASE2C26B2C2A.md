# Global Planner Research Phase 2-C2.6-B2-C2A（P1上位16 reservation contextの実Search）

Refs #154。Research only。Production source（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）、Search algorithm /
ordering / comparator、Production default extent、Production Candidate capture、Candidate Search、Planner Alternative kernel、
Candidate trial、full Planner rerun、global assignment、extent不足20件のSearch / extent probe、alternative-to-alternative support、
UI、runtime optimizationは変更・実行していない。timeout fallback / retryも行っていない。

- measured HEAD: `6ae33ab4e7ad0d2de14c67abe85f89ebbcaf0bd1`（target manifest rule・P1 top16 task構築・Search入力再構築・4-cohort capture・
  safety cap・実行条件・analyzer・capture policy比較・事前登録decision rule・testsを含むclean HEAD）
- analysis HEAD: `611b8ae8e24ab218e351f8a59a49271925f8caef`（measured HEAD以後の変更は post-hoc許可対象の
  `scripts/analyze-planner-global-phase2c26b2c2a.mjs` だけ。`calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2A_RESULT.json)（`provenance.formal = true`、invalid reason 0）

## 0. 最重要limitation

> **P1 policyとdefaultExtent 20 Targetの選択は、過去のoracle post-hoc評価（B2-C1）の影響を受けている。**
> **一方、各Target内でどのcontextを何番目にSearchしたかには、oracle compatibility / firstCompatible情報を使用していない。**

| provenance flag | 値 |
| --- | --- |
| `oracleGuidedPolicySelection` | `true`（P1はB2-C1でoracle coverageを見て選んだResearch候補） |
| `oracleGuidedTargetPopulation` | `true`（20 TargetはB2-C1のpost-hoc subgroup `defaultExtent`） |
| `contextOrderingUsesOracle` | `false`（Exportから再導出したP1 rank 1..16を機械的にSearch） |
| `oracleReadBySearchChild` | `false` |
| `oracleMatchUsedForEarlyStop` | `false`（oracle exactがrank 2で見つかるTargetもrank 3..16を全てSearch） |

本Phaseが示すのは「この実利用Exportのdefault-extent層20 Targetでは、oracle Routeを直接context selectionに使わなくても、P1の上位16
reservation contextをSearchすればどこまでexact Routeを再発見できるか」まで。P1・context budget 16・どのcapture policyも、
Production defaultとして採用できるとは結論しない。

## 1. 結論（`B2C2A_INCOMPLETE`）

事前登録ruleにより **`B2C2A_INCOMPLETE`**。320 taskのうち2 taskがStage 1 timeout（10分）で未計測になり、「all 320 task measured」を
満たさないため。semantic failureは0、invalid reasonは0。

ただし計測できた318 taskだけで見ると:

| capture policy | rank ≤ 16でexactに到達したTarget |
| --- | ---: |
| C8 | 18 / 20 |
| C32 | 18 / 20 |
| **C4C** | **20 / 20** |

- 20 / 20 Targetとも、**最初のexactはB2-C1のP1 first compatible rankそのもの**（delta 0）。compatibleなcontextに当たったところで
  すぐにoracle exact Routeがpublishされた。
- compatible context 94件はC4Cで **94 / 94** exactをpublish（C8 / C32では86 / 94）。compatibleなのにSearchがexactを出さないcontextは0。
- reservation-incompatible context 224件（計測分）からのexact / partialは0、sentinelのexactも0。
- C8 / C32で取りこぼした2 Target（46bf2c78、c140578c）は、B2-B2A2で見つけたequal-cost cohort（cost 2）の後方（index 158 / 99）に
  oracle Routeがあるケースそのもので、scheduler-selected contextでも同じtie cohort問題が再現した。

timeoutした2 taskはどちらも **reservation-incompatible** context（B2-A reachability authority上、oracle Routeをpublishできない）で、
しかも該当Targetは別rankでexactが見つかっている（§6）。それでもtimeoutをCandidate 0とは扱わず、登録ruleどおりINCOMPLETEとした。
「timeoutした2 taskがincompatibleならexactを出さない」という読みは、本Phaseで検証している契約（incompatibleからexactが出ればINVALID）を
前提にした条件付き解釈にすぎない。

## 2. 方針

```text
B2-C1 RESULT（population authority、SHA-256固定）
  -> parsePhase2C26B2C2AB2C1Authority()（formal / B2C1_WIDE / P1 / subgroup件数 / P1 defaultExtent 20・top16 20・max 11 を fail-close確認）
  -> phase2c26b2c2aTargetManifest(): subgroup defaultExtent の Target ID 20件だけ（rank / digest / firstCompatible / oracle field無し）
       -> .local/PLANNER_GLOBAL_PHASE2C26B2C2A_TARGETS.json.local（SHA-256 1634163d…）
Search runner（Export + Target manifestのみ読む）
  -> tasks child: derivePhase2C26B2C1Schedule()（Exportのみ）-> 各TargetのP1 rank 1..16 -> reconstructPhase2C26B2B2AContext()
       -> 20 × 16 = 320 task（違えばSearchしない）
  -> Search child（taskごとにfresh process）: scheduleを再導出し、Target × P1 rankの行をtaskの全fieldと照合
       visitPlannerAlternativeCandidates() 無変更、Production default extent { Normal 4, Gogma 235, Skill 4 }
       最大4 distinct operation-cost cohortを完全drain、5番目のcostの最初のCandidateはsentinel（captureに含めない）でstop
       natural end（exhausted / stopped_by_extent）もcapture完了、capture 1024件でsafety cap stop（captureComplete = false）
analyzer（run終了後のみ）: scheduleを再導出しparity確認、oracle RESULT / manifestを読み
  compatibility = phase2c26b2c1TargetReach()（-> phase2c26b2aReachability()）、Candidate coverage = phase2c26b2b2aCompare()（-> phase2c2OracleCoverage()）
```

P1（B2-C1登録定義と同一、formal前後で不変）: `targetEligibleMinCardinality ASC`、`exclusiveOwnedWeaponCount ASC`、
`blockedCountDefaultTotal ASC`、`shareableHeldCountDefaultTotal DESC`、`reservationDigest ASC`（K0は常にrank 1）。

Search childが受け取るのは Target・P1 rank・schedule由来のgroup / reservation digest / representative alias / searchInputDigest
（drift検出用）・capture rule・safety capだけ。oracle RESULT・manifest・B2-C1 firstCompatible・B2-B1 reachability・expected
stable key / rank / Candidate index / operation costは読まない（testで固定）。visitorの `'stop'` はsentinelとsafety capの2箇所だけ。

capture policyは1回のC4C captureから切り出す: C8 / C32 = captureの先頭8 / 32件、C4C = capture全体（C8 ⊆ C32 ⊆ C4C）。
4 cohortが32件未満で終わったcontext（179 / 318）ではC32 = capture全体になる（5番目以降のcost cohortは見ない）。

## 3. authority / hash chain

| authority | 値 |
| --- | --- |
| B2-C1 RESULT | SHA-256 `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac`（登録値）、formal、calc変更なし、`B2C1_WIDE`、selected P1、K1-minimal 31 / K2-minimal 9 / unreached 3、defaultExtent 20（finite 20 / top16 20 / max 11）、invalidReasons [] |
| B2-B1 RESULT | `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d`（B2-C1 = B2-B2A = B2-B2A2記録値と一致） |
| B2-B2A RESULT | `b1ae4e8112772ebc75cba14de3fdead48a55ce34c6871ec03ca6f628c73fa9cb`（B2-B2A2記録値と一致、既存parserで登録値確認） |
| B2-B2A2 RESULT | `d3a81b8f65033d8d05d72971e621ae8f4c3bc336a8a9b3f6edcc95c34880285b`（B2-C1記録値と一致、`B2B2A2_ALL_LATE_EXACT`） |
| oracle RESULT | `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1`（B2-C1 / B2-B1 / B2-B2A / B2-B2A2と一致） |
| oracle manifest | file `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、Routes `ffb6db5a39e248b950a75f9094ae641a4a35f256a035e37564227bdc6e0e73cc`（全記録値・oracle記録値と一致、manifest ↔ RESULT整合 43 / 43） |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（run = Target manifest = B2-C1 = B2-B1 = B2-B2A = B2-B2A2 = oracle） |
| Target manifest | `1634163db4e749bef9346f5f24b39fb6478493a7d478aae869538474f5d48a30`（= B2-C1 defaultExtent 20件と全件一致、runner記録値と一致） |
| raw run | `a634094f63bd740c7047f7dfe9f3e9001a52f4ffa8e4a4a504765002ebf9982b`（child record 318件はそれぞれrunner記録のSHA-256と一致） |
| benchmark code | `b52c10229adf610a7b718473f33dc51dc3ef343017597d726779f97b752307fc` |

hashChain 25項目すべてtrue。

## 4. task / parity

| 項目 | 値 |
| --- | --- |
| validation Targets | 20（B2-C1 defaultExtent、全件K1-minimal） |
| context budget | 16（P1 rank 1..16、全Targetで欠落・重複なし） |
| Search tasks | 320 |
| P1 definition parity | schedule・`PHASE2C26B2C1_POLICIES`・独立登録コピー・B2-C1 RESULTの4者一致 |
| schedule parity | analyzerがExportからscheduleを再導出し、320 task（group / digest / representative / cardinality / searchInputDigest）が完全一致。contexts digest・origin digest・extent・policies・CalculationContext・RNG Engine一致。B2-C1 schedule consistency / B2-B1 universe parity valid |
| first compatible parity | analyzerの再計算P1 first compatible rankがB2-C1 RESULTと20 / 20一致 |
| Stage 1 | fresh child / task、heap 8192 MB、concurrency 3、budget 10分、`yieldControl = setImmediate`、memory sampling 250 ms、retry / fallbackなし |

## 5. 実行

| | 件数 |
| --- | ---: |
| completed | 318 |
| timeout | 2 |
| OOM / process failure / context mismatch | 0 / 0 / 0 |
| safety cap（capture 1024件到達、`captureComplete = false`） | 14 |
| Target 16 / 16 measured | 18（残り2 Targetは15 / 16） |

| | min | median | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Search elapsed（completed） | 0.05 s | 15.4 s | 187 s | 246 s | 460 s |
| child process wall（全320） | 5.5 s | 21.2 s | 193 s | 254 s | 600 s（timeout） |

peak heap max 5.02 GB、peak RSS max 5.41 GB。schedule再導出は1 childあたり4.4〜5.7 s。run全体のwall 2時間1分
（Node / Vite SSR、AMD Ryzen 7 9700X、NOT a Browser Worker）。

context rank別Search elapsed（median / p90 / max、秒）とpeak heap max:

| rank | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| median | 3 | 13 | 20 | 49 | 10 | 4 | 3 | 33 | 37 | 10 | 70 | 30 | 26 | 15 | 11 | 51 |
| p90 | 4 | 299 | 279 | 208 | 59 | 14 | 4 | 82 | 105 | 46 | 115 | 198 | 218 | 206 | 187 | 197 |
| max | 4 | 460 | 415 | 319 | 189 | 48 | 4 | 102 | 130 | 70 | 133 | 248 | 306 | 386 | 355 | 250 |
| heap GB | 0.7 | 3.0 | 3.1 | 3.3 | 3.2 | 1.3 | 0.7 | 4.4 | 3.6 | 4.6 | 4.7 | 2.3 | 2.3 | 2.3 | 2.0 | 2.0 |

P1上位ほどSearchが軽いという傾向は無い（rank 1 = K0は軽いが、rank 2〜4はp90が200〜300 s）。

## 6. 未計測task

| task | Target | P1 rank | cardinality | reservation-compatible | Target側のexact |
| --- | --- | ---: | ---: | --- | --- |
| t02-r12 | 15829bfe | 12 | K1 | no | rank 8でC8 exact |
| t09-r09 | 8d233d8b | 9 | K1 | no | rank 11でC8 exact |

どちらも600 sでkill（heap 3.7 / 4.5 GB、OOMではない）。登録ruleではtimeoutはCandidate 0ではなく未計測で、decisionをINCOMPLETEにする。

## 7. scheduler delivery（context budget別、exactに到達したTarget数）

| policy | top1 | top2 | top4 | top8 | top12 | top16 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C8 | 0 | 6 | 6 | 14 | 18 | 18 |
| C32 | 0 | 6 | 6 | 14 | 18 | 18 |
| C4C | 0 | 7 | 7 | 15 | **20** | 20 |

C4Cはcontext budget 12で20 / 20に閉じる（最大first exact rank 11）。rank 1（K0）は全Targetでincompatible、exact 0。

## 8. first exact（20 Target）

| Target | B2-C1 first compatible | C8 | C32 | C4C | delta | Candidate index | cost | 回収policy | top16内compatible | measured |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 0d98b225 | 8 | 8 | 8 | 8 | 0 | 0 | 1 | C8 | 3 | 16 |
| 155a6831 | 2 | 2 | 2 | 2 | 0 | 0 | 1 | C8 | 11 | 16 |
| 15829bfe | 8 | 8 | 8 | 8 | 0 | 0 | 2 | C8 | 2 | 15 |
| 1d916ff0 | 2 | 2 | 2 | 2 | 0 | 0 | 2 | C8 | 11 | 16 |
| 2123eaa6 | 2 | 2 | 2 | 2 | 0 | 0 | 1 | C8 | 13 | 16 |
| 27ac3237 | 8 | 8 | 8 | 8 | 0 | 4 | 2 | C8 | 2 | 16 |
| 46bf2c78 | 11 | — | — | 11 | 0 | 158 | 2 | C4C | 1 | 16 |
| 57126a5e | 8 | 8 | 8 | 8 | 0 | 0 | 1 | C8 | 2 | 16 |
| 820831d0 | 9 | 9 | 9 | 9 | 0 | 3 | 3 | C8 | 1 | 16 |
| 8d233d8b | 11 | 11 | 11 | 11 | 0 | 0 | 2 | C8 | 2 | 15 |
| 9733b090 | 2 | 2 | 2 | 2 | 0 | 3 | 2 | C8 | 8 | 16 |
| a26f6bcf | 8 | 8 | 8 | 8 | 0 | 1 | 1 | C8 | 2 | 16 |
| aa4e67d8 | 2 | 2 | 2 | 2 | 0 | 0 | 1 | C8 | 6 | 16 |
| b4f252cd | 8 | 8 | 8 | 8 | 0 | 0 | 1 | C8 | 2 | 16 |
| be881717 | 11 | 11 | 11 | 11 | 0 | 1 | 2 | C8 | 1 | 16 |
| c140578c | 2 | — | — | 2 | 0 | 99 | 2 | C4C | 7 | 16 |
| d45a7d4e | 8 | 8 | 8 | 8 | 0 | 0 | 2 | C8 | 4 | 16 |
| e96249b4 | 9 | 9 | 9 | 9 | 0 | 1 | 2 | C8 | 3 | 16 |
| f5d20af4 | 2 | 2 | 2 | 2 | 0 | 0 | 1 | C8 | 11 | 16 |
| fea60316 | 8 | 8 | 8 | 8 | 0 | 0 | 2 | C8 | 2 | 16 |

`firstExactContextRank >= firstCompatibleRank` は全Target・全policyで成立（すべて等号）。first exact Candidateのroute kindは
`existing_gogma_mixed` 12、`existing_gogma_keep_bonuses` 8。

## 9. compatibility

| | 件数 |
| --- | ---: |
| compatible contexts searched | 94 |
| compatible + exact（C8 / C32 / C4C） | 86 / 86 / 94 |
| compatible + no exact（C4C） | **0**（capture完了 0、safety cap 0、partialのみ 0） |
| incompatible contexts searched | 224 |
| **incompatible + exact**（sentinel含む） | **0** |
| incompatible + partial | 0 |

compatibleなcontextは、少なくともこのpopulationでは **常に** 4 cost cohort以内でexact Routeをpublishした。C8で漏れたcompatible
context 8件は、46bf2c78のrank 11（index 158）と、c140578cの7 context（rank 2 / 8 / 11〜15、index 98〜99）で、全件cost 2。
safety capに達した14 contextのうちcompatibleな12件は、1024件以内でexactが見つかっている（index 0〜4）。残り2件はincompatible（exact 0）。

## 10. capture comparison

| | Target数 |
| --- | ---: |
| C8で回収 | 18 |
| C8 miss → C32で回収 | 0 |
| C32 miss → C4Cで回収 | 2（46bf2c78、c140578c） |
| C4Cでも未回収 | 0 |

C32はC8に何も上乗せしなかった。取りこぼした2件はいずれもequal-cost（cost 2）cohortが約100〜160件あり、oracle Routeが
その後方（Gogma advance昇順で後ろ）にある。固定件数のcaptureではなくcost cohort単位のdrainが必要、というB2-B2A2の観察が
scheduler-selected contextでも再現した。

## 11. Candidate分布（global Candidate portfolioではない）

計測318 contextでdelivered 51,439（captured 51,192 + sentinel 247）。Target別unique stable key数 median 713（min 93 / max 2,999）。
capture長 median 12（0件 12、8件未満 113、32件未満 179、1024件 14）。termination: four_cost_cohorts_drained 247、
stopped_by_extent 57、candidate_safety_cap 14。captureしたcost cohort数: 4 → 255、3 → 11、2 → 17、1 → 23、0 → 12。

route kind: `existing_gogma_mixed` 30,218、`existing_gogma_keep_bonuses` 15,187、`normal_artian_to_gogma` 5,787。source:
owned_gogma 45,405 / new_normal 5,787。heldRoute 50,697、late start 25,591（Gogma 25,176 / Skill 4,516 / Normal 30）。
operation costは1〜234に分布（cost 2〜5に約47,800件が集中）。reservation violation 0。

## 12. decision rule（formal前に登録）

1. `B2C2A_INVALID`: B2-C1 authority / Target manifest / Target数20 / task数320 / P1定義 / P1 schedule parity / rank欠落・重複 /
   reservation digest・origin・extent / oracle・hash chain / first compatible rank再現 / context mismatch / reservation violation /
   incompatible contextからのexact / first exact < first compatible / cost非単調 / provenance / raw・result不整合 のいずれか
2. `B2C2A_INCOMPLETE`: timeout / OOM / process failureの未計測taskがある
3. `B2C2A_ALL_C8` / `ALL_C32` / `ALL_C4C`: 全task計測済みで、C8 / C32 / C4Cがそれぞれ初めて20 / 20になったもの
4. `B2C2A_INCOMPLETE`: C4C < 20で、未回収Targetの16 contextにsafety cap未解決がある
5. `B2C2A_PARTIAL`: それ以外（C4C < 20。0 / 20も含め `noExactTarget` で明示）

今回は2のため `B2C2A_INCOMPLETE`。

## 13. 実装・検証上の記録

- formal analyzerの初回実行は `schedule_parity: calculationContextMatches` でINVALIDになった。原因はanalyzerの照合式で、
  timeout runはchild recordを持たず `calculationContext = null` を記録するのに、照合対象から外していなかった。post-hoc許可対象の
  analyzerだけを修正（completed runは一致、未計測runはnullであることを要求）して `611b8ae` でcommitし、同じraw runを再解析した。
  計算コードは無変更（`calculationCodeChangedSinceMeasuredHead = []`）。completed 318 runのCalculationContextは全件一致していた。
- 非formal smoke（6 task、`--allow-uncommitted`）でrank別の重さとsafety capの発生を事前に確認した（formalには使っていない）。

## 14. 次の推奨

結論はINCOMPLETEなので、まずruntime / Search completionを扱う。

1. timeoutした2 task（t02-r12、t09-r09）だけを別Phaseで長いbudget（例: 30分）で再測定し、320 / 320 measuredを確定する。
   今回のcompatibility結果（incompatible 224件からexact 0）を前提にすると、2件ともexactを出さずALL_C4C相当になる見込みだが、
   それは今回の契約を前提にした条件付きの読みにすぎず、本Phaseの結論ではない。
2. 確定後にALL_C4Cなら、default extent層のscheduler mechanismはこのExportでは実Searchまで成立したことになる。その後は
   extent不足20件について、scheduler-selected contextを使ったextent probeへ進む。K2-minimal 9件については、Target-relative
   K2 feature / groupingの改善も別途検討する。
3. capture policyについては、C8 / C32がequal-cost tie cohortで同じ2件を落としたため、件数固定ではなくcost cohort単位のcaptureを
   引き続き候補とする（Production capture defaultの結論ではない）。
4. residual 3件（unreached）は引き続き別系統（alternative-to-alternative support）。
