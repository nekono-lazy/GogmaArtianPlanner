# Global Planner Research D2-E-B（t03の2-support K2 context探索とD2-D最良incumbentへの追加評価の実装・正式計測）

Refs #154。Research-only。事前登録: [D2-E-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md)（PR #231、本書作成時に改訂なし）。正式RESULT: `docs/PLANNER_GLOBAL_D2E_RESULT.json`。

本書はD2-E-Bの結果の要約であり、判定規則・数値の権威はD2-E-A（事前登録）と正式RESULTである。Production source、Search / Planner / RNG semantics、
Worker、UI、Persistence、schema / version、Production default / boundsは変更していない。Phase B / D1 / D2 / D2-C / D2-Dのformal RESULT・module・record・G store・
CTX recordも変更していない。oracleは実行入力・診断入力・分析のいずれにも使っていない。Phase 2-C2.5-D2-E（`plannerGlobalPhase2C25D2E*`）の成果物は読んでいない。

## 1. 実装

| 部品 | file |
| --- | --- |
| 登録条件、V（D2-D / D2-C / D2 RESULTのallowlist projection、§3.1のK2 context機械導出と§3.2表の照合、§6.1のI0集合導出と§1.2表の照合、G store 9件・CTX record 6件の照合）、CTX-K2（C1〜C7）、DSC unit（R0-K2 / R0-split、D-1〜D-5、`K2_POOL_CAP = 2`）、評価child（RV1′ / RV2′、S4 / S5 / S6）、§6.5の共通判定、start attestation | `src/benchmarks/plannerGlobalD2E.ts` |
| analyzer（RV1〜RV6、C1 / C3 / C4 / C6の独立再計算（C3は2 supportのExport bodyから `collectReferencedOwnedWeaponIds()` と `createPlannerRouteUnitPlans()` で再導出、`recomputeD2EK2ContextC3()`）とC5 / C7の再照合、rung進行・pool・重複排除の再生、R1、S1〜S6、R5独立再判定と `judgeD1R5()` の相互照合、EXT診断、gate、improved、`improvementKind`、選択順、R6、parity 4状態、決定性、証拠整合、decision） | `src/benchmarks/plannerGlobalD2EAnalysis.ts` |
| runner（親 + `rv` / `context` / `discover` / `evaluate` child、journal、abort、4時間discovery envelope、7時間run envelope） | `scripts/run-planner-global-d2e.mjs` |
| analyzer script（RESULT生成。RV2のbaseline Entry、C4のPlanner-start origin digest、C3のroute unit plan（登録済みProduction RNG Engineをanalyzer自身でinstantiate）をExportから独立に構築） | `scripts/analyze-planner-global-d2e.mjs` |
| test（32件） | `src/benchmarks/plannerGlobalD2E.test.ts` |

- §14.1の既存部品を使った: `globalResearchInputFromExport()` / `globalResearchDependencies()`、K2 / K1 / K0 contextは `phase2c27bResolveSupportContext()`
  （= `derivePlannerAlternativeReservation()`）、C3は `collectReferencedOwnedWeaponIds()` / `createPlannerRouteUnitPlans()`、C4は `derivePhase2C26B2C1Schedule()`、
  Search / materializationは `visitPlannerAlternativeCandidates()` / `createPlannerAlternativeMaterializer()` / `createPlannerAlternativeSearchIdentity()`、R0は
  `summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`、RVはD2-Dの `runD2DReverification()`（変更なし）、`readD2CContextRecord()`、`d2cSupportExpiryCause()`、
  D1の `d1InputDigest()` / `d1ResultDigest()` / `judgeD1R5()` / `judgeD1R5Independently()` / `d1B0Parity()` / `isD1BoundLimited()`、D2の `d2R1R4()` / `judgeD2R6()` /
  `d2DiscoveryUnitOutcome()`、`judgePlannerAlternativeTrial()`。D1 / D2 / D2-C / D2-D / Phase Bのmoduleは変更していない
- K2 reservationは2 supportのExport Entry bodyから既存authorityで導出し、K1 reservationの文字列・配列unionはsemanticsとして使っていない（union一致は診断 `equalsK1ComponentwiseUnion` だけ）
- Target ID・Entry ID・stable keyはsourceへ書いていない。K2 context・I0集合・supportはVで§3.1 / §6.1の導出を再実行して得て、§3.2 / §1.2表（attest済みのD2-E本文から読む）とは照合にだけ使う。
  登録reservation bodyもD2-E本文 §1.7のJSONから読む。ExportのSHA-256はD2-D RESULT `sources.export` から辿るchainで照合した

### 1.1 実装上の選択（事前登録の意味論は変更していない）

| 項目 | 内容 |
| --- | --- |
| 評価child | `runD2CEvaluation()` はsupport 2件以上のreplacementを明示的に拒否し（`a D2-C Candidate requires more than one support Entry`）、`runD2Evaluation()` のS5は1 replacementに1 reservationしか持てないため、K2 Candidateを変更なしでは評価できない。§14.2（「D2-E側で同じ手順のwrapperを持つ」）に従い、`runD2Evaluation()` と同じProduction部品を同じ順序で使う `runD2EEvaluation()` をD2-E moduleに置き、静的checkだけを§7.2どおりにした（S4 / S5は各supportのS5 authority CTX record、各K1置換は自身のCTX record、K2 CandidateはS6）。B0 / I0 / ADM / EXTはすべてこの関数で評価した。手順の同一性は (1) Fake Engine fixtureで同じK0 / K1入力に対し `runD2CEvaluation()` とfacts・`resultDigest` が一致するtest、(2) 正式計測のI0がD2-D `PAIR-t05c1-t07c3` の `resultDigest fnv1a32:57dbb4e5` と一致したこと（`d2d_best` parity）、で確認した |
| RV3（K1）の照合先 | D2-D RESULTの `conditions` にはpool reservation digestが無いため、K1 incumbentのSearch当時reservationは自身のCTX record（t00 CTX-1、t04 CTX-5、t05 CTX-6、t10 CTX-7）を基準とし、そのdigest / record SHA-256をD2-C RESULT `contexts[]` の行（allowlist内）と照合した |
| S5 authority | 各supportの最小kのCTX record（`61066e62` → CTX-6、`92d87b90` → CTX-3、`e396d352` → CTX-1）。同じsupportの他のCTX recordとの一致はV・RV（RV5 / RV6、`k1_context` parity 6件）で確認した |
| `equalMetrics` / `conflictIncreased` | eligibleなEXTについてだけ記録した（D2-Dと同じ） |
| C3の独立再計算（PR #232レビュー対応） | 初回実装のanalyzerはC3の参照OwnedWeaponだけをExportから再導出し、排他消費OwnedWeapon集合はCTX child recordの値を検証材料に使っていた（§4.1の独立再計算要求を満たさない）。修正後は `recomputeD2EK2ContextC3()` が、登録K2 supportの2 Export bodyから `collectReferencedOwnedWeaponIds()` と1回の `createPlannerRouteUnitPlans([2 bodies], engine)`（登録済みProduction RNG Engine）で参照・排他消費集合を再導出し、rejection 0、reservation `exclusiveOwnedWeaponIds` への包含、recordの3集合との一致を検査する。recordは比較対象だけで、再計算値の代わりに使わない。不一致は `D2E_INVALID`（`guardrail`）。CTX child、reservation導出、判定の意味論は変更していない |
| 既存testの許可対象 | `plannerGlobalD2C.test.ts` / `plannerGlobalD2D.test.ts` の「他ResearchからのD2-C / D2-D import禁止」検査に、登録上の後継D2-Eのexact path（D2-C: D2-E 3 file、D2-D: `plannerGlobalD2E.ts` だけ）を追加した。Phase 2-C2.5-D2-Eが許可対象に入らないこと、それがD2-C / D2-Dをimportすると検出されることのassertionも追加した。他moduleについての検査の厳しさは変えていない |

## 2. provenance

| 項目 | 値 |
| --- | --- |
| measurement HEAD | **`d294efb005e4943627f3ed27873a33ed7ead8173`**（Working Tree clean、analysis HEADも同じ。measurement HEADはanalysis HEADのancestor） |
| start attestation | SHA-256 `6d6c4629cb11cf4f7e26b2c3ed62b3054dd4b5ddcc036b115ffd7fb0cd21b811`（32,853 bytes）、verified |
| D2-E-A文書 SHA-256（HEAD git object） | `9bbb824169ac22364b451b6313730c7e2042b181db8557dbfeec359f8fa14797` |
| 登録policy SHA-256 | `8a123601cac3dd5e33381fabbbfbdff66c775fcd9cf1475c576cfd904c1f6292` |
| calculation code digest | `2fa915045f8066b8aa6167f1623bcf3a04892e05991692e8b2b236a1c7628d05` |
| raw | `.local/PLANNER_GLOBAL_D2E_K2_RAW2.json.local`（31,753 bytes、`c0924292…81ad`）、run dir `.local/d2e-k2-formal2.run/`（record 11件、K2 G store 2件。commitしない） |
| 入力evidence | Export、D2-D / D2-C / D2 / Phase 2-C2 RESULT、D2-D-A / D2-D-B文書、chained文書9件、D2-D / D2-C attestation / raw、G store 9件、CTX record 6件のbytes・SHA-256がすべて登録値と一致（V、analyzerで独立に再検証） |
| Production changed files | `[]`（measurement HEAD、analysis HEADとも。基準main `414c63d`） |
| CalculationContext / Engine | `{ unknown-initial, 4, production-rng:c5-e7, 17 }` / `production-rng:c5-e7` |
| `provenance.formal` | `true`、`runStatus = completed`、invalid 0、`oracleGuidedTargetPopulation = true` |

本RESULTは新measurement HEAD `d294efb` での正式計測（2回目）である。計測開始後に計算コードを変更していない（`calculationCodeChangedSinceMeasuredHead = []`）。

**再計測の経緯**: 旧measurement HEAD `c0248fcba41f3ec22867d966f83f7a7c40e794cc` の正式計測（start attestation `ec8f838d…f173d`、raw
`.local/PLANNER_GLOBAL_D2E_K2_RAW.json.local`、run dir `.local/d2e-k2-formal.run/`）は、analyzerのC3独立再計算の不足（§1.1）を修正したため正式結果として採用せず、
修正をcommitした新measurement HEADからV → RV → B0 → I0 → CTX-K2 → DSC → ADM → EXTを最初から再計測した。旧runのrecord・journal・G storeは新runへ継ぎ足しておらず、
監査用に保持している（削除・上書きしていない）。新旧runで全6評価の `inputDigest` / `resultDigest`、DSC 3 unitのSearch identity・delivery key、pool 2件のkey・generated Entry ID・
G store SHA-256、decisionはすべて一致し、異なるのはwall time / memoryだけだった。

smoke（非formal）は別run dir
（`.local/d2e-k2-smoke1`、`.local/d2e-k2-smoke2`）で `--allow-uncommitted` により実行し、runner / analyzerの全経路の動作だけを確認した。smokeの結果で
条件を変更しておらず、formal evidenceにしていない。

## 3. 結果

### 3.1 decision

| 項目 | 値 |
| --- | --- |
| decision | **`D2E_SET_COEXISTENT_NOT_BETTER`** |
| discovery | `cap_reached`（L0 / L1は0件、L2で2件pool） |
| pool / admitted | 2 / 2（R1 2 / 2） |
| R5成立EXT | `EXT-K2-t03-c2`（1件） |
| eligible / improved | eligible 1件（`EXT-K2-t03-c2`）、**improved 0件**。`bestEligibleExtension = EXT-K2-t03-c2`、`bestImprovedExtension = null`、`improvementKind = null` |
| `EXT-K2-t03-c2` | **24 / 43、Conflict 19、steps 1470**（I0と同じcompleted / Conflict、`equalMetrics = true`。stepsは+5で、選択順のtie-breakにしか使わない） |
| t03の完成 | `EXT-K2-t03-c2` でt03 Targetは完成したが、別Targetを1件失いnet ±0（`t03CompletedWithoutNetGain = true`）。**「+1完成」ではない** |
| R6 | 判定3件（I0 + EXT 2）、成立0。`D2E_GLOBAL_COMPLETE_R` ではない |
| 比較（subject = `EXT-K2-t03-c2`） | baseline 20 / 21 → +4 / −2、D2-C最終 23 / 20 → +1 / −1、**D2-D最良（I0）24 / 19 → ±0 / ±0**（steps +5） |
| 計測状態 | invalid 0、unmeasured 0、not_executed 0、bound-limited 0、discovery / run envelope未到達 |

### 3.2 RV・B0・I0・CTX-K2

| 項目 | 結果 |
| --- | --- |
| RV | `verified`。incumbent 9件すべてRV1〜RV4成立（K0 5件は `fnv1a32:5ac88909`、K1 4件は自身のCTX record）。support 3件ともRV5 / RV6成立。wall 15.9 s |
| B0 | `evaluated`、20 / 43、Conflict 21、steps 1465、`exhausted`、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`。Phase 2-C2 summary・D2 / D2-C / D2-D B0とmatched |
| I0 | `evaluated`、24 / 43、Conflict 19、steps 1465、`exhausted`（`reachedLimits = []`）、`inputDigest fnv1a32:6493291d`、`resultDigest fnv1a32:57dbb4e5`、R5成立、`resource_conflict` 19、support 3件selected。D2-D `PAIR-t05c1-t07c3` とmatched（`d2d_best`、`registered_input`、`determinism_prior`） |
| CTX-K2 | `context_ready`。C1〜C7すべて成立、C5 matched（`reservationDigest fnv1a32:fd85c864`、body一致）、origin `fnv1a32:ff018910`、`conflictContextCount = 21`、`equalsK1ComponentwiseUnion = true`（診断）。wall 9.7 s |
| C3（analyzer独立再計算） | 成立。2 supportのExport bodyから再導出した参照OwnedWeapon = 排他消費OwnedWeapon = `60126fe6…`（`92d87b90` のReset Bonuses source）、route unit plan 2 Entry / rejection 0、reservation `exclusiveOwnedWeaponIds` に包含、child recordの3集合と一致（`recordMatched` すべてtrue） |
| parity | `baseline` 1、`d2d_best` 1、`registered_input` 1、`k1_context` 6、`k2_context_registered` 1、`determinism_prior` 2がすべて `matched`。`mismatched` / `not_checked` 0。D2-E内で同じ `inputDigest` の評価は無かった |

### 3.3 discovery（K2 context `K2-t03-92d87b90-e396d352`）

| unit | extent（Normal / Gogma / Skill） | outcome | delivered | wall / searchOnly | heap peak |
| --- | --- | --- | ---: | --- | ---: |
| `DSC-K2-L0` | 4 / 235 / 4 | `stopped_by_search_extent_bound` | 0 | 42.5 s / 39.5 s | 1.38 GB |
| `DSC-K2-L1` | 8 / 235 / 256 | `stopped_by_search_extent_bound` | 0 | 63.0 s / 59.8 s | 1.95 GB |
| `DSC-K2-L2` | 128 / 235 / 1500 | `discovery_cap_reached` | 2 | 671.2 s / 667.7 s | 6.00 GB |

| ordinal | cost / Route kind / 操作数 | `candidateStableKey` SHA-256 | generated Entry ID | G store SHA-256 |
| ---: | --- | --- | --- | --- |
| 1 | 358 / `normal_artian_to_gogma` / 354 | `9315abca740f6b63e74cadfc8cbda6cbc67a706c344df7e0d2088e1fdedfce6d` | `build-list.constrained.fnv1a32-8702468f` | `3e23248a…8286` |
| 2 | 359 / `normal_artian_to_gogma` / 355 | `a642233da5030f0068903d3d44b1791e9ee7dede704137958e99f3a079060b92` | `build-list.constrained.fnv1a32-b9c3b154` | `b1ac6a83…10f4` |

- 2件ともR0-K2・R0-split（両support）成立、`reusedExisting = false`、replacement `ready`（`O_t03`）、Search identity `planner-alternative-search.fnv1a32-f376cb29`、`requiresSupport = S`
- D-2 / D-4 / D-5（D2-Bのt03 K0 pool、D2-Cのt03 K1 pool）に該当するdeliveryは無かった（2 deliveryとも `pooled`）。I-D2E-1のとおりD2-CのK1 Candidateとは別Routeである

### 3.4 ADM（baseline上、`requiresSupport = S`）

| 評価 | completed / Conflict / steps | R1 | R2 / R3 / R4 | `found_R` | 備考 |
| --- | --- | --- | --- | --- | --- |
| `ADM-K2-t03-c1` | 20 / 21 / 1470 | 成立 | 成立 / 成立 / 成立 | `found_R`（`G` selected） | S6成立。baseline比でt03 Targetを獲得し、`54dd2b4e` のTarget（`9d817a9b…`）を喪失 |
| `ADM-K2-t03-c2` | 20 / 21 / 1470 | 成立 | 成立 / 成立 / 成立 | `found_R`（`G` selected） | 同上 |

- D2-CのK1 Candidateと異なり、baseline上で `G` は両support（`92d87b90` / `e396d352`）に負けていない（winner null、`crossSupportLoss = false`）。`G` を含むConflictの他participantは
  `54dd2b4e` / `b4b4c72c`（supportでも置換集合でもないExport Entry）だった

### 3.5 EXT（I0の9件 ∪ { t03: c }、各1 run）

| 評価 | completed / Conflict / steps | R5 | 失敗理由 | t03 `G` | t03 Target | incumbent 9件 | gate | eligible / improved | vs I0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `EXT-K2-t03-c1` | 24 / 20 / 1465 | 不成立 | `generated_not_selected:…8702468f`、`conflict_within_set` | **非selected**（winner incumbent t00 `…1d2ed2a8`） | 未完成 | 全件selected | 成立 | no / no | ±0 / +1 |
| `EXT-K2-t03-c2` | **24 / 19 / 1470** | **成立** | — | **selected** | **完成** | 全件selected | 成立 | **yes / no**（`equalMetrics`） | ±0 / ±0（steps +5） |

- support（`92d87b90` / `e396d352` / `61066e62`）はEXT 2件ともS1〜S6成立・selected、失効0。`termination = exhausted`、Trace Replay成功、`fullRunsStarted = 1`、retry 0
- **`EXT-K2-t03-c1`**: t03 `G` は置換集合内のincumbent t00（K1 `e396d352` 依存のD2-C Candidate）とSkill 344の `same_skill_counter` で衝突し（集合内Conflict）、非selectedになった。
  ほかにSkill 648（`54dd2b4e` / `b4b4c72c`）、Gogma 125（`54dd2b4e`）のConflictも持つ。Target集合はI0と同じで、Conflictが1件増えた
- **`EXT-K2-t03-c2`**: t03 `G` はselectedでt03 Targetは完成した。集合内Conflictは0件。ただしt03 `G` はSkill 648 / Gogma 125で置換集合外の `54dd2b4e`（I0ではselected）に勝ち、
  `54dd2b4e` は `resource_conflict` で非selectedになり、そのTarget `9d817a9b…` を失った。I0比で獲得 `188571a7…`（t03）/ 喪失 `9d817a9b…` の入れ替わりで、completedは24のまま
- §1.5のD2-Cのt03資源: Skill 341（`e396d352` のblocked）・Gogma 71（`92d87b90` のblocked）はEXT 2件とも `G` のConflictとして現れなかった（K2 reservationの効果）。
  Skill 648・Gogma 125は2件とも現れた（I-D2E-2の観測）
- `resource_conflict` rejectionはEXT 2件とも19件（I0 19件）。R6の条件には遠い

### 3.6 runtime / memory

| 項目 | 値 |
| --- | --- |
| run wall | 882.4 s（RV 15.9 s、CTX-K2 9.7 s、DSC 3 unit合計 776.7 s、評価6件合計 79.9 s。評価1件 8.2〜14.5 s） |
| child process | 11 / 11（RV 1 + CTX 1 + DSC 3 + 評価 6） |
| full Planner起動 | 6回（評価ごと1回、上限8に対し）、runtime-unsupported retry 0 |
| memory | child heap最大6.00 GB（`DSC-K2-L2`）、RSS最大6.55 GB（上限12,288 MB）。評価childのheapは最大0.87 GB |
| 実行環境 | Node v24.19.0、AMD Ryzen 7 9700X、メモリ 33.4 GB |

## 4. 言えること・言えないこと

言えること:

- 2 support（`92d87b90` / `e396d352`）を同時に置くK2 contextでSearchすると、登録ladderのL2で2件のK2 Candidateが得られ、いずれもbaseline上のR1を満たした。
  K2 CandidateはD2-Cのt03 K1 Candidateと異なり、baseline上で両supportに負けなかった（D2-Cで観測された相互support阻害のSkill 341 / Gogma 71は、K2 Candidateの衝突として現れなかった）
- D2-D最良（24 / 19）にK2 Candidateを1件加えた2つの1 run評価のうち、c2の置換集合はR5（全 `G` とsupportのselected、support依存の有効性、集合内Conflictなし）を満たし、t03 Targetが完成した。
  しかし置換集合外の `54dd2b4e` がSkill 648 / Gogma 125で負けてそのTargetを失い、全体は **24 / 43、Conflict 19** のまま（D2-D最良と同値）だった
- c1は置換集合内のincumbent t00とSkill 344で衝突してt03が非selectedになり、Conflictが1件増えた（24 / 20）

言えないこと:

- D2-D最良（24 / 19）からの改善は得られなかった（improved 0）。t03の完成は別Targetの喪失と相殺され、「+1完成」ではない
- R6（43 / 43、Conflict 0、`resource_conflict` 0）には達していない。**Issue #154の最終Acceptanceではない**
- **K2仮説が誤りだったとは結論づけない**。未評価のもの: 3件目以降のK2 Candidate、L2より広いextent、`54dd2b4e` 等のco-participantをsupportに含むcontext、
  D2-Dの別PAIRや別の起点、t04 / t10の別axis、incumbent t00との同時変更、複数pass、3 Target以上の同時変更
- L0 / L1が0件だったことは、その範囲にK2 Candidateが存在しないことの証明ではない（extent bound）
- E1由来のpopulation（`oracleGuidedTargetPopulation = true`）の部分集合での結果であり、別Export・別population・Production semanticsとしての妥当性へは一般化しない

## 5. 次Phaseへ

D2-E-A §16の未決事項はそのまま残る。D2-Eの観測から、次の候補が具体化した（いずれも新しい事前登録を要し、本Phaseでは評価していない）:

- `EXT-K2-t03-c2` でt03と交換になった `54dd2b4e`（Skill 648 / Gogma 125）を、t03と同時に扱う（supportへ含める、または `54dd2b4e` 側Targetの別Routeと組み合わせる）局所再合成
- `EXT-K2-t03-c1` で衝突したincumbent t00（Skill 344）とt03の同時変更
- t02の探索、t05 / t07の3件目以降、t04 / t10の別axis、population拡大

D2-Eでは最良EXTを起点にした追加評価・合成を行っていない（§6.2 / G48）。
