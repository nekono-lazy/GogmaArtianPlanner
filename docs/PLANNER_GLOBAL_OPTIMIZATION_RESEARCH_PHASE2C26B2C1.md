# Global Planner Research Phase 2-C2.6-B2-C1（oracle非依存のreservation context scheduler ordering）

Refs #154。Research only。Production source、Search / Planner semantics、Search ordering / comparator、default extent、
Candidate capture policy、trial / rerun bound、RNG、schema / version、Persistence、UIは変更していない。
`visitPlannerAlternativeCandidates()`、Candidate Search、Planner Alternative Search、Candidate materialization、Candidate
trial、Planner Alternative kernel、full Planner rerun、global assignment、extent probe、extent拡張、runtime optimizationは
行っていない。

- measured HEAD: `4a0c4eb38097301550c82a886ab321497769e51d`（feature定義・default window helper・Target別eligible alias・
  P0〜P3 policy・deterministic ordering・runner・post-hoc analyzer・selection rule・decision rule・testsを含むclean HEAD）
- analysis HEAD: `4a0c4eb38097301550c82a886ab321497769e51d`（`codeChangedSinceMeasuredHead = []`、
  `calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json)
  （`provenance.formal = true`、`oracleReadByCalculation = false`、`oracleGuidedPolicyEvaluation = true`）
- formal raw（committedしない）: `.local/PLANNER_GLOBAL_PHASE2C26B2C1_RAW.json.local`
  SHA-256 `ea275571c7a4a026eed849f4cf5425a41ebabb220a6757e9ef4481742106b739`（37,150,692 bytes、36,084 context行）

## 1. 結論（`B2C1_WIDE`）

oracleを一切読まずに、B2-B1と同一のK0 / K1 / K2固定集合universeから、Target × semantic reservation context
（36,084件）のfeatureを計算し、事前固定した4つのlexicographic policy（P0〜P3）でTargetごとのcontext順序を生成した。
その後、post-hoc analyzerだけがoracle Routeを読み、各policyで「最初のreservation-compatible contextが何番目に現れるか」を測った。

| recovered 40件（B2-B1でK≤2 compatible） | top8 | top16 | top32 | top64 | top256 | all | median | p90 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P0 stable_simple_first | 7 | 17 | 26 | 35 | 40 | 40 | 21 | 96 | 234 |
| **P1 default_simple_first（選択）** | **18** | **25** | **31** | 33 | 38 | 40 | 9 | 78 | 306 |
| P2 default_utility_first | 18 | 25 | 29 | 33 | 38 | 40 | 9 | 78 | 306 |
| P3 full_utility_first | 18 | 22 | 28 | 31 | 38 | 40 | 10 | 214 | 492 |

事前登録selection ruleで **P1** を選択（top8 18はP1 / P2 / P3で同率、top16 25でP3を落とし、top32 31 > 29でP2を落とす）。
P1でも40 / 40は有限rankだがmax 306 > 32なので、事前登録decision ruleにより **B2C1_WIDE**。

ただし内訳ははっきり二層に分かれる。

| P1（選択policy） | 件数 | top8 | top16 | top32 | median | p90 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **default extent内** | 20 | 15 | **20** | 20 | 8 | 11 | **11** |
| extent不足 | 20 | 3 | 5 | 11 | 31 | 143 | 306 |
| K1-minimal | 31 | 18 | 25 | **31** | 8 | 18 | 32 |
| K2-minimal | 9 | 0 | 0 | 0 | 78 | 306 | 306 |

- **default extent内20件はすべてK1-minimalで、P1 / P2ではrank ≤ 11（top16で20 / 20）に到達する。** B2-B2A / B2-B2A2で
  oracle exact Routeのdeliveryを確認した20件が、oracle無しのorderingでも小さいbudgetで回収できる。
- **K1-minimal 31件はP1でrank ≤ 32（max 32）。**
- **WIDEの原因はK2-minimal 9件**（P1 rank 50〜306）。cardinality-firstのP0 / P1では全K1 context（各Target 42件）を通過してから
  K2へ入るので、構造上rank ≥ 44になる。utility-firstのP2 / P3でもK2の到達は早まらなかった（P2のmin 31のみ）。
- **K2-minimal 9件はすべてextent不足でもある**（default extent内のK2-minimalは0件）。つまり「default extent内で回収可能」な
  集合に限れば、P1はTOP16相当で閉じている。WIDEは「extent不足 × K2」の層が引き起こしている。

**選択policyはoracleを入力にしてcontextを生成したものではない。ただし、P0〜P3のどれをResearch候補として選ぶかは
oracle post-hoc coverageで評価しているため、Production採用の証拠ではない。**

## 2. 方針

B2-B1は「current Routeを0 / 1 / 2本固定したreservationで40件がcompatibleになる」ことまでを示した。しかしcontextは
Targetあたり836〜845件あり、全部Searchするのは現実的でない。B2-C1はSearchを回さずに、

```text
Export
  -> derivePhase2C26B2B1Snapshot()（B2-B1をそのまま再利用: preparePlannerInitialContext()、K0 / K1 / K2、
     createPlannerRouteUnitPlans() + detectPlannerConflicts() によるvalidity、derivePlannerAlternativeReservation()、
     normalized reservationでのdedup、Target自身のEntryを含まないalias）
  -> Target × semantic reservation context
       targetEligibleMinCardinality（Target自身のeligible aliasから再計算）
       representative alias（provenanceのみ）
       exclusive / held / blocked / shareable held（full / Production default window）
  -> P0〜P3（K0は常にrank 1）でTargetごとにrank 1..N
  -> post-hoc: B2-B1 parity、oracle Route × context のreservation compatibility（B2-Aのhelperを再利用）、
     first compatible rank、CDF、percentile、selection、decision
```

だけを行い、「oracle非依存のorderingで、少数context budgetで良いreservationへ到達できるか」を判定した。

calculation（`plannerGlobalPhase2C26B2C1.ts` + runner）はExport・current Production code・formal specだけを読み、
oracle RESULT・manifest・oracle Target ID・oracle Route・Counter位置・B2-B1 RESULT（minimal context / representative /
reachability）・B2-B2A / B2-B2A2のTarget情報を一切知らない（testで確認）。B2-B2A2 RESULTはanalyzerがSHA-256を
provenanceとして記録するだけで、parseもしない。

## 3. authority / provenance

| authority | 値 |
| --- | --- |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（schedule = B2-B1 = oracle RESULT） |
| B2-B1 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json` SHA-256 `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d`（登録値と一致） |
| B2-B1 provenance | `formal = true`、`calculationCodeChangedSinceMeasuredHead = []`、decision `B2B1_PARTIAL_ELIGIBLE_RECOVERY`、`invalidReasons = []`、measured / analysis `b7d04bb` |
| B2-B1 登録aggregate（all） | K0 0 / K1 31 / K2 9 / unreached 3、recovered 40、default extent内20 / extent不足20（stream別 Skill 20・Normal 4・Gogma 0） |
| B2-B1 登録aggregate（context gap） | K1 28 / K2 9 / unreached 3、recovered 37、default extent内18 / extent不足19 |
| B2-B1 probe gap | 1件（`02876df4…`）、K1-minimalかつextent不足（structural checkで確認、IDはsourceにhard-codeしない） |
| B2-B2A2 RESULT | SHA-256 `d3a81b8f65033d8d05d72971e621ae8f4c3bc336a8a9b3f6edcc95c34880285b`（latest research provenanceとして記録のみ） |
| oracle RESULT | SHA-256 `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1`（B2-B1が読んだものと一致） |
| oracle manifest | file SHA-256 `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`（B2-B1記録値と一致）、manifest ↔ RESULT整合を再検査して一致 |
| benchmark code | SHA-256 `6d4b403722ff9239d72e7a48c751ce50240fd4c1b43b0ecc78a404ac1207ebfe`（`uncommittedBenchmarkCode = false`） |
| schedule run | Node（Vite SSR loader、1 process）、wall 4.7 s |

## 4. context universe

| 項目 | 値 |
| --- | --- |
| planning Targets | 43（checkpoint hard constraint 0） |
| K0 | proposed 1 / valid 1 |
| K1 | proposed 43 / valid 43 |
| K2 | proposed 903 / valid 835 / invalid 68（Production Conflict authorityで除外） |
| semantic reservations | 879（alias dedupの効果0、B2-B1と同じ） |
| Target別semantic context | **36,084**（eligible minimum K0 43 / K1 1,806 / K2 34,235） |
| Target別minimumがgroup minimumを上回るcontext | 0（このExportではalias重複が無いため。ロジックはsynthetic testで検証済み） |

**B2-B1 parity（post-hoc、すべて一致）**:

- origin（Skill 341 / Gogma 55 / 全Normal Counter）、origin digest、Target / current Entry / Route key SHA-256 / origin semantic digest
- K0 / K1 / K2のproposed / valid / invalid件数、invalid K2 68件のID
- 879 reservation group（digest・minimum cardinality・alias・reservationのrange形）
- 43 Targetそれぞれの context件数・raw alias件数・eligible minimum別件数
- **reservation-compatible context件数（K0 / K1 / K2別）が43 / 43 TargetでB2-B1 RESULTと完全一致**
- **minimal cardinalityが43 / 43一致**（K1 31 / K2 9 / unreached 3）
- Route extent（verdict / required / reach）が43 / 43一致、default window判定がB2-AのRoute extentと43 / 43一致
- relevant Normal Counter（`selectSearchableNormalCounters()`）がoracle Routeのweapon type Counterと一致

## 5. feature

各Target × contextについて、Production default window（Planner-start origin、Normal 4 / Gogma 235 / Skill 4）と
reservation全体（full）の両方で計算した。

- default windowはResearch helper `phase2c26b2c1DefaultWindows()` が5.6.8のextent意味どおりに定義する:
  Normal = production target位置 `origin .. origin + 3`、Gogma = `origin .. origin + 234`、
  Skill = conversion Route窓 `origin .. origin + 4`（Searchの `conversionSkillPositionLimit` と同じ。既存Gogma Reset Skills窓
  `origin .. origin + 3` を含む）。Production helperは絶対窓を返さないため、testでB2-Aの `phase2c26b2aRouteExtent()` と
  Production limit walk（`phase2c26b2aReachability().productionLimitAccepts`）の境界（窓内最後 / 窓外最初）一致を全stream・
  Skill両種で固定し、formal dataでも43 Routeでextent verdictと一致した。
- Normalは **そのTargetのweapon type Normal Counterだけ**（`selectSearchableNormalCounters()`）。他weapon typeのCounterは合算しない。
- `shareableHeld = held − blocked`（`blocked ⊆ held` を検査し、違反・重複positionはfail closed）。

| K1 contexts（1,806） | zero | p25 | median | p75 | p90 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| exclusive OwnedWeapon | 378 | 1 | 1 | 1 | 1 | 1 |
| blocked（default total） | 42 | 1 | 2 | 2 | 2 | 3 |
| shareable held（default total） | 0 | 28 | 88 | 142 | 160 | 235 |
| blocked（full total） | 0 | 2 | 2 | 3 | 3 | 4 |
| shareable held（full total） | 0 | 64 | 136 | 168 | 377 | 1,140 |

| K2 contexts（34,235） | zero | p25 | median | p75 | p90 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| exclusive OwnedWeapon | 0 | 1 | 2 | 2 | 2 | 2 |
| blocked（default total） | 0 | 3 | 3 | 4 | 4 | 5 |
| shareable held（default total） | 0 | 87 | 122 | 159 | 172 | 242 |
| blocked（full total） | 0 | 4 | 4 | 5 | 6 | 7 |
| shareable held（full total） | 0 | 144 | 189 | 394 | 569 | 1,455 |

exclusive OwnedWeapon件数のhistogram（全36,084）: 0件 421 / 1件 13,482 / 2件 22,181。relevant Normalのheldは
K1の1,718 / 1,806、K2の31,439 / 34,235で0（Normal reservationを持たないRouteが大半）。default windowのGogma heldは
K1 median 90 / K2 median 119で、shareable heldの大半はGogmaが占める。Skill default windowは最大5 positionしかない。

## 6. policy（formal run前に固定）

K0（empty reservation）は全policyでrank 1。K1 / K2はlexicographic keyのみ（任意weight scoreなし）、最終keyは常に
`reservationDigest ASC`。同key（digest重複）はfail closed。Map挿入順やPromise解決順は使わない。

| policy | key |
| --- | --- |
| P0 stable_simple_first | targetEligibleMinCardinality ASC → reservationDigest ASC |
| P1 default_simple_first | targetEligibleMinCardinality ASC → exclusiveOwnedWeaponCount ASC → blockedCountDefaultTotal ASC → shareableHeldCountDefaultTotal DESC → reservationDigest ASC |
| P2 default_utility_first | exclusiveOwnedWeaponCount ASC → blockedCountDefaultTotal ASC → shareableHeldCountDefaultTotal DESC → targetEligibleMinCardinality ASC → reservationDigest ASC |
| P3 full_utility_first | exclusiveOwnedWeaponCount ASC → blockedCountFullTotal ASC → shareableHeldCountFullTotal DESC → targetEligibleMinCardinality ASC → reservationDigest ASC |

formal結果を見た後のP4以降・special Target rule・Skill / Gogma重視rule・特定fixed Route優先は追加していない。

## 7. first compatible rank

「compatible」はreservation compatibility（`phase2c26b2aReachability()`）のみ。extent不足でもreservation-compatibleなら
compatibleとして数える。unreached 3件は全policyで `firstCompatibleRank = null`、recovered 40件は全policyで有限rank（検査済み）。

### 7.1 CDF（first compatible rank ≤ N のTarget数）

| subgroup | policy | top1 | top2 | top4 | top8 | top16 | top32 | top64 | top128 | top256 | all |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recovered 40 | P0 | 0 | 3 | 5 | 7 | 17 | 26 | 35 | 38 | 40 | 40 |
| | P1 | 0 | 8 | 9 | 18 | 25 | 31 | 33 | 36 | 38 | 40 |
| | P2 | 0 | 8 | 9 | 18 | 25 | 29 | 33 | 36 | 38 | 40 |
| | P3 | 0 | 9 | 9 | 18 | 22 | 28 | 31 | 35 | 38 | 40 |
| default extent 20 | P0 | 0 | 3 | 4 | 6 | 14 | 18 | 20 | 20 | 20 | 20 |
| | P1 | 0 | 7 | 7 | 15 | 20 | 20 | 20 | 20 | 20 | 20 |
| | P2 | 0 | 7 | 7 | 15 | 20 | 20 | 20 | 20 | 20 | 20 |
| | P3 | 0 | 7 | 7 | 15 | 18 | 20 | 20 | 20 | 20 | 20 |
| extent不足 20 | P0 | 0 | 0 | 1 | 1 | 3 | 8 | 15 | 18 | 20 | 20 |
| | P1 | 0 | 1 | 2 | 3 | 5 | 11 | 13 | 16 | 18 | 20 |
| | P2 | 0 | 1 | 2 | 3 | 5 | 9 | 13 | 16 | 18 | 20 |
| | P3 | 0 | 2 | 2 | 3 | 4 | 8 | 11 | 15 | 18 | 20 |
| context gap recovered 37 | P0 | 0 | 3 | 5 | 7 | 16 | 23 | 32 | 35 | 37 | 37 |
| | P1 | 0 | 8 | 9 | 16 | 22 | 28 | 30 | 33 | 35 | 37 |
| | P2 | 0 | 8 | 9 | 16 | 22 | 26 | 30 | 33 | 35 | 37 |
| | P3 | 0 | 9 | 9 | 16 | 19 | 25 | 28 | 32 | 35 | 37 |
| B2-A covered 2 | P0 | 0 | 0 | 0 | 0 | 1 | 2 | 2 | 2 | 2 | 2 |
| | P1 / P2 / P3 | 0 | 0 | 0 | 1 | 2 | 2 | 2 | 2 | 2 | 2 |
| probe gap 1 | P0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 1 |
| | P1 / P2 / P3 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| K1-minimal 31 | P0 | 0 | 3 | 5 | 7 | 17 | 26 | 31 | 31 | 31 | 31 |
| | P1 | 0 | 8 | 9 | 18 | 25 | 31 | 31 | 31 | 31 | 31 |
| | P2 | 0 | 8 | 9 | 18 | 25 | 28 | 31 | 31 | 31 | 31 |
| | P3 | 0 | 9 | 9 | 18 | 22 | 28 | 31 | 31 | 31 | 31 |
| K2-minimal 9 | P0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 7 | 9 | 9 |
| | P1 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 5 | 7 | 9 |
| | P2 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | 5 | 7 | 9 |
| | P3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 7 | 9 |

top1は全policyで0（K0 empty reservationでcompatibleなRouteは無い。B2-B1と同じ）。

### 7.2 rank percentile（nearest rank: `sorted[ceil(p/100 × n) − 1]`）

| subgroup | policy | min | median | p75 | p90 | p95 | max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| recovered 40 | P0 | 2 | 21 | 43 | 96 | 117 | 234 |
| | P1 | 2 | 9 | 31 | 78 | 143 | 306 |
| | P2 | 2 | 9 | 37 | 78 | 143 | 306 |
| | P3 | 2 | 10 | 41 | 214 | 236 | 492 |
| default extent 20 | P0 | 2 | 9 | 26 | 27 | 43 | 43 |
| | P1 / P2 | 2 | 8 | 8 | 11 | 11 | 11 |
| | P3 | 2 | 7 | 8 | 11 | 21 | 22 |
| extent不足 20 | P0 | 3 | 37 | 47 | 117 | 233 | 234 |
| | P1 | 2 | 31 | 76 | 143 | 305 | 306 |
| | P2 | 2 | 37 | 76 | 143 | 305 | 306 |
| | P3 | 2 | 41 | 119 | 236 | 491 | 492 |
| K1-minimal 31 | P0 | 2 | 11 | 26 | 37 | 43 | 43 |
| | P1 | 2 | 8 | 11 | 18 | 31 | 32 |
| | P2 | 2 | 8 | 11 | 18 | 38 | 38 |
| | P3 | 2 | 7 | 18 | 24 | 41 | 41 |
| K2-minimal 9 | P0 | 47 | 96 | 117 | 234 | 234 | 234 |
| | P1 | 50 | 78 | 143 | 306 | 306 | 306 |
| | P2 | 31 | 78 | 143 | 306 | 306 | 306 |
| | P3 | 79 | 214 | 236 | 492 | 492 | 492 |

K2-minimal 9件が最初のcompatible K2へ到達するまでに通過したK1 context数: P0 / P1 / P3は全件42（そのTargetの全K1）、
P2はmin 23 / median 42。

## 8. selected Research policy

`oracleGuidedPolicyEvaluation = true`。事前登録rule（recovered 40について top8 DESC → top16 DESC → top32 DESC →
p90 ASC → max ASC → policy ID ASC）:

| policy | top8 | top16 | top32 | p90 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| P0 | 7 | 17 | 26 | 96 | 234 |
| **P1** | **18** | **25** | **31** | 78 | 306 |
| P2 | 18 | 25 | 29 | 78 | 306 |
| P3 | 18 | 22 | 28 | 214 | 492 |

選択: **P1 default_simple_first**。P1でのfirst compatible contextのcardinalityはK1 31 / K2 9。

post-hoc診断（scoreには一切入れていない）: P1のfirst compatible representative aliasがB2-B1のoracle support Targetを
含むのは40件中29件。11件は「oracle supporter以外の1本の固定」でもreservation-compatibleになった。

## 9. decision（事前登録）

| case | 条件 | 結果 |
| --- | --- | --- |
| B2C1_INVALID | universe / authority / parity / policy drift / ordering / isolation / provenance / raw-result不整合 | 該当なし（`invalidReasons = []`） |
| B2C1_TOP8 | selected policyで40 / 40がrank ≤ 8 | 18 / 40 |
| B2C1_TOP16 | 40 / 40がrank ≤ 16 | 25 / 40 |
| B2C1_TOP32 | 40 / 40がrank ≤ 32 | 31 / 40 |
| **B2C1_WIDE** | 40 / 40有限、max > 32 | **max 306** |

8 / 16 / 32はProduction defaultではなく、次のResearch Search task数を決めるためのpowers-of-two diagnostic budget。

## 10. interpretation

- **選択policyはoracleを入力にしてcontextを生成したものではない。ただし、P0〜P3のどれをResearch候補として選ぶかは
  oracle post-hoc coverageで評価しているため、Production採用の証拠ではない。**
- 「簡単なfixed setを先に、同cardinalityならexclusive / blockedが少なくshareable heldが多いもの」というP1の素朴な
  geometryは、**K1で足りるTargetについてはよく効く**（K1-minimal 31件はrank ≤ 32、default extent内20件はrank ≤ 11）。
  P0（cardinality + digestのみ）と比べるとtop8は7 → 18、default extent内のmaxは43 → 11に縮んだ。
- 一方、**K2が必要なTargetには効かない**。cardinality-firstでは42件のK1を必ず先に試すため構造的にrank ≥ 44で、
  utility-first（P2 / P3）にしてもK2 contextがK1より上位に来るケースはほとんど無い（P2で1件のみrank 31）。
  K2 contextは「2本分のexclusive / blocked」を持つので、exclusive / blocked最小を優先するkeyではK1より後ろに回る。
  さらにK2 contextはTargetあたり793〜803件あり、その中でcompatibleは1〜66件しかない。現在のreservation geometry
  （件数ベースの集計）だけでは、K2の中から必要なpairを選び出す情報が足りない。
- full geometry（P3）はdefault window geometry（P1 / P2）より悪い。default extent外のheld（数百position）を数えると、
  default extentのSearchでは意味のないheldが大きいcontextを上位に上げてしまう。
- K2-minimal 9件はすべてextent不足（Skill窓外）でもあり、default extentのSearchではいずれにせよ到達しない。したがって
  **「default extentでSearchしてdeliverできる」集合に限れば、P1はrank ≤ 11で閉じている**。WIDEは、
  extent不足 × K2の層が全体のmaxを押し上げた結果である。
- ここで測ったのはreservation compatibilityのrankであり、Search delivery（capture boundやequal-cost cohort内の順位）は
  B2-B2A / B2-B2A2の別問題として残る。

## 11. next recommendation

事前登録ruleのWIDE recommendation:

> 現在のreservation geometryだけでは良いscheduler orderingになっていないため、Searchを大量実行する前に
> context feature / groupingを再研究。

結果の内訳を踏まえた補足（policyの追加・変更ではなく、次Phaseの論点）:

1. **K2 context feature / groupingの再研究**: K2-minimal 9件で必要なのは「どの2本のheld unionが自Routeの通過positionを
   coverするか」であり、件数集計（held / blocked / shareable合計）では区別できない。次Phaseでは、Target自身のcurrent
   Routeやcurrent reservationとの関係（例: Targetが自分で通るstream範囲と重なるheldの量、current Routeとの
   Conflict関係）といった、**oracle非依存のTarget-relative feature** を事前登録して比較する。
2. **default extent内20件のscheduler Search validation**: 全20件がK1-minimalで、P1ではrank ≤ 11。default extent内に
   限れば、P1をoracle無しで実際に走らせるscheduler Search Phase（budget 16、Candidate capture policyの比較込み）は
   WIDEと独立に実施可能な状態にある。
3. **extent不足20件**: K2 groupingの再研究、またはscheduler-selected contextでのextent probeへ。oracle-guided
   representativeではなくscheduler-selected contextを使う。
4. **residual 3件**（unreached）: current Route固定ではK≤2で到達しないため、別途alternative-to-alternative support研究。

## 12. validation

- focused: `npx vitest run src/benchmarks/plannerGlobalPhase2C26B2C1.test.ts`（24 tests: default window境界 × B2-A extent /
  Production limit walk、geometry / feature / relevant Normal、P0〜P3 exact key / K0 rank 1 / digest tie / determinism /
  fail closed、Target別eligible minimum再計算 / representative / checkpoint / invalid K2、Planner inputからの導出と
  B2-B1 snapshot一致、synthetic oracle worldでのB2-B1 parity / first compatible / drift検出、CDF / percentile、
  selection、decision 5 case、B2-B1 authority parser、isolation）
- `npm run lint`、`npx tsc -b --force`、`npm test`、`npm run build`、`git diff --check`（結果はPRに記載）

## 13. files

- `src/benchmarks/plannerGlobalPhase2C26B2C1.ts`（calculation、oracle非依存）
- `src/benchmarks/plannerGlobalPhase2C26B2C1Analysis.ts`（post-hoc analysis）
- `src/benchmarks/plannerGlobalPhase2C26B2C1.test.ts`
- `scripts/run-planner-global-phase2c26b2c1.mjs`（formal schedule runner）
- `scripts/analyze-planner-global-phase2c26b2c1.mjs`（post-hoc analyzer）
- `docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json`

再現:

```text
node --max-old-space-size=8192 scripts/run-planner-global-phase2c26b2c1.mjs --export <Export> --output .local/PLANNER_GLOBAL_PHASE2C26B2C1_RAW.json.local
node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c1.mjs --schedule .local/PLANNER_GLOBAL_PHASE2C26B2C1_RAW.json.local \
  --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2b2a2-result docs/PLANNER_GLOBAL_PHASE2C26B2B2A2_RESULT.json \
  --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --output docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json
```
