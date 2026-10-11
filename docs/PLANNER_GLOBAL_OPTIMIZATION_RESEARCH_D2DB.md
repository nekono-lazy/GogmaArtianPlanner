# Global Planner Research D2-D-B（既存Candidateによるt05 / t07局所2-Target再合成の実装・正式計測）

Refs #154。Research-only。事前登録: [D2-D-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md)（PR #229、本書作成時に改訂なし）。正式RESULT: `docs/PLANNER_GLOBAL_D2D_RESULT.json`。

本書はD2-D-Bの結果の要約であり、判定規則・数値の権威はD2-D-A（事前登録）と正式RESULTである。Production source、Search / Planner / RNG semantics、
Worker、UI、Persistence、schema / version、Production default / boundsは変更していない。Phase B / D1 / D2 / D2-Cのformal RESULT・module・record・G store・
CTX recordも変更していない。新しいSearch、Candidate discovery、CTX作成、ADMは行っていない。oracleは実行入力・診断入力・分析のいずれにも使っていない。

## 1. 実装

| 部品 | file |
| --- | --- |
| 登録条件、V（D2-C / D2 RESULTのallowlist projection、§3.1の機械導出と§3.2表・§1.8 digestの照合、G store 12件・CTX record 4件の照合）、RV1〜RV6、評価wrapper（child内のRV1 / RV2再確認）、§5の共通判定、start attestation | `src/benchmarks/plannerGlobalD2D.ts` |
| analyzer（RV1 / RV2 / RV3(K1) / RV5の独立再計算、R5独立再判定と `judgeD1R5()` との相互照合、S1〜S5、R6、`pairCoexistence`、gate、improved、選択順、parity 4状態、§8.3診断、証拠整合、decision） | `src/benchmarks/plannerGlobalD2DAnalysis.ts` |
| runner（親 + `rv` / `evaluate` child、journal、abort、4時間run envelope） | `scripts/run-planner-global-d2d.mjs` |
| analyzer script（RESULT生成、RV2のbaseline EntryをExportから独立に構築） | `scripts/analyze-planner-global-d2d.mjs` |
| test（27件） | `src/benchmarks/plannerGlobalD2D.test.ts` |

- §13.1の既存部品をそのまま使った: 評価は `runD2CEvaluation()`（I0 / PAIRはD2-CのI0と同じ手順 = `runD2Evaluation()` stage `Z0`、`replacement_set`、`found_R` なし）、
  `globalResearchInputFromExport()` / `globalResearchDependencies()`、`readD2CContextRecord()`、`d2cSupportExpiryCause()`、`d2cI0Parity()`、RV3は
  `derivePhase2C26B2C1Schedule()` + `buildPhase2C27BTargetPlans()` + `phase2c27bResolveSupportContext(…, [])`（D2-BのK0と同じ経路）、RV4は
  `summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`、RV6は `derivePlannerAlternativeReservation()`、D1の `d1InputDigest()` / `d1ResultDigest()` /
  `judgeD1R5()` / `judgeD1R5Independently()` / `d1B0Parity()` / `isD1BoundLimited()`、D2の `judgeD2R6()`。D1 / D2 / D2-C / Phase Bのmoduleは変更していない
- PAIRはD2-C moduleへstageを追加せず、D2-D側のwrapper（`runD2DEvaluation()`）で `stage = 'I0'` 相当の手順を使い、RESULTの `stage` は `PAIR` と記録した（§13.2）
- Target ID・Entry ID・stable keyはsourceへ書いていない。PAIR表・Fixed 7件・support・CTXはVで§3.1の導出を再実行して得て、§3.2表（attest済みのD2-D本文から読む）と
  §1.8の登録 `inputDigest` とは照合にだけ使う。ExportのSHA-256もsourceへ書かず、D2-Cと同じくD2-C RESULT `sources.export` から辿るchainで照合した
  （D2 RESULTの `sources.export` と一致し、D2-D本文が同じ値を登録していることを確認）

### 1.1 実装上の選択（事前登録の意味論は変更していない）

| 項目 | 内容 |
| --- | --- |
| K1 support recordの受け渡し | 各K1置換は自身のCTX record（t00 CTX-1、t04 CTX-5、t05 CTX-6、t10 CTX-7）を `runD2CEvaluation()` へ渡した（§4.3 / §13.1）。analyzerはS4 / S5をsupportの最小kのCTX record（`e396d352` はCTX-1、§6.2）と照合し、CTX-1とCTX-7の一致はV・RVで確認済み |
| 評価childの `inputDigest` | 評価childも自分が読んだExportのSHA-256から `inputDigest` を計算してrecordへ書き、`registered_input` parityはその値と§3.2の登録値を照合した（runnerの値とも一致を要求） |
| `equalMetrics` / `conflictIncreased` | eligibleなPAIRについてだけ記録した（improvedでない理由の説明、§5.4）。eligibleでないPAIRはfalse |
| 決定性の照合範囲（`determinism_prior`） | §9.1のallowlist内の評価（D2: B0 / ADM-t07-c1..c3、D2-C: B0 / CMP-t10-c1 / CMP-t05-c1 / -c2 / ADM-t05-c1 / -c2）だけを読む。PAIRの `inputDigest` が既存112評価のいずれにも無いことは§1.8の登録事実で、VではPAIR digestがallowlist内に現れないことを確認した |
| 既存testの許可対象 | `plannerGlobalD2C.test.ts` の「D2-C moduleを他のResearch moduleがimportしない」検査に、登録上の後継D2-D（D2-D-A §13でD2-C moduleのimportを要求）だけを許可対象として追加した。検査の厳しさはD2-D以外について変わらない |

## 2. provenance

| 項目 | 値 |
| --- | --- |
| measurement HEAD | `38f4ed7bbfd7e994367856484817d115b9860ab8`（Working Tree clean、analysis HEADも同じ） |
| start attestation | SHA-256 `15090ba23d6a757b6106e040e90a884d17301db062a62ebf6c6059bfc6ca7985`、verified |
| D2-D文書 SHA-256（HEAD git object） | `bafcb2d4e39e801afa2a28dbb9902ec3285cced625d865859a48d024c5c60c17` |
| 登録policy SHA-256 | `2db65c0e50053c3d3ffaae0d5cd30a28f5860b80161e5d0de6707343b57ddb09` |
| calculation code digest | `6d0313bcecf1d5ca3ad593c385e147970ec523d2e3f18146b9d43bfd628c702e` |
| raw | `.local/PLANNER_GLOBAL_D2D_PAIR_RAW.json.local`（36,344 bytes、`45be5525…f2c3`）、run dir `.local/d2d-pair-formal.run/`（commitしない） |
| 入力evidence | Export、D2-C / D2 / Phase 2-C2 RESULT、D2-C-A / D2-C-B文書、chained文書7件、D2-C attestation / raw、G store 12件、CTX record 4件のbytes・SHA-256がすべて登録値と一致（V、analyzerで独立に再検証） |
| Production changed files | `[]`（measurement HEAD、analysis HEADとも。基準main `6f1c90b`） |
| CalculationContext / Engine | `{ unknown-initial, 4, production-rng:c5-e7, 17 }` / `production-rng:c5-e7` |
| `provenance.formal` | `true`、`runStatus = completed`、invalid 0 |

正式計測を1回実行し、計測開始後に計算コードを変更していない（`calculationCodeChangedSinceMeasuredHead = []`）。smoke（非formal）は別run dir
（`.local/d2d-pair-smoke/run1〜3`）で `--allow-uncommitted` で実行し、V・RVとB0 / I0だけを確認した（PAIRはsmokeで1件も評価していない）。smokeの結果で
条件を変更しておらず、formal evidenceにしていない。Phase 2-C2.5-D2-Dの成果物は読んでいない。

## 3. 結果

### 3.1 decision

| 項目 | 値 |
| --- | --- |
| decision | **`D2D_EXCEEDS_D2C_FINAL`** |
| R5成立PAIR | PAIR-3（t05 c1 / t07 c3）、PAIR-6（t05 c2 / t07 c3） |
| `pairCoexistence` 成立PAIR | PAIR-3、PAIR-6（R5成立と同じ2件。pairCoexistentだがR5不成立のPAIRは0件） |
| improved PAIR | PAIR-3、PAIR-6 |
| `bestEligiblePair` / `bestImprovedPair` | **PAIR-3（`PAIR-t05c1-t07c3`）**: completed **24 / 43**、Conflict **19**、steps 1465 |
| R6 | 判定7件（I0 + PAIR 6）、成立0。`D2D_GLOBAL_COMPLETE_R` ではない |
| 比較（best = PAIR-3） | baseline 20 / 21 → **+4 / −2**、D2-B主軸 22 / 20 → **+2 / −1**、**D2-C最終（I0）23 / 20 → +1 / −1**（stepsはいずれも1465、差0） |
| 計測状態 | invalid 0、unmeasured 0、not_executed 0、bound-limited 0、run envelope未到達 |

### 3.2 RV・B0・I0

| 項目 | 結果 |
| --- | --- |
| RV | `verified`。12 CandidateすべてRV1（body SHA-256 / id / Target / CalculationContext / `isStale = false` / Search identity / key SHA-256）・RV2（`ready`、`replacedBuildListEntryId = O_t`）・RV3（K0 7件は `fnv1a32:5ac88909`、K1 5件はCTX recordのreservation）・RV4（blocked hit / exclusive hit 0）成立。support 3件ともRV5 / RV6成立（`e396d352` はCTX-1 / CTX-7の両方と一致）。wall 17.4 s |
| B0 | `evaluated`、20 / 43、Conflict 21、steps 1465、`exhausted`、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`。Phase 2-C2 summary・D2 B0・D2-C B0とmatched |
| I0 | `evaluated`、23 / 43、Conflict 20、steps 1465、`exhausted`、`inputDigest fnv1a32:75e7dba9`、`resultDigest fnv1a32:77d41017`、R5成立。D2-C `CMP-t10-c1` とmatched（`d2c_final`、`determinism_prior`） |
| parity | `baseline` 1、`d2c_final` 1、`d2c_context` 4、`registered_input` 6、`determinism_prior` 2がすべて `matched`。`mismatched` / `not_checked` 0。D2-D内で同じ `inputDigest` の評価は無かった |

### 3.3 6 PAIRの結果（すべてfresh、各1 run、`fullRunsStarted = 1`、retry 0）

| PAIR | t05 | t07 | completed / Conflict / steps | R5 | 失敗理由 | `pairCoexistence` | gate | improved | vs I0（completed / Conflict） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 `PAIR-t05c1-t07c1` | c1 selected | c1 **非selected**（winner t05 c1） | 23 / 20 / 1465 | 不成立 | `generated_not_selected:…0f0b9ba2`、`conflict_within_set` | false | 成立 | — | ±0 / ±0 |
| 2 `PAIR-t05c1-t07c2` | c1 selected | c2 **非selected**（winner `build-list.fnv1a32-2fdb4406`） | 23 / 20 / 1465 | 不成立 | `generated_not_selected:…98fce3dc` | false | 成立 | — | ±0 / ±0 |
| 3 `PAIR-t05c1-t07c3` | c1 selected | c3 selected | **24 / 19 / 1465** | **成立** | — | **true** | 成立 | **yes**（rank 1） | **+1 / −1** |
| 4 `PAIR-t05c2-t07c1` | c2 selected | c1 **非selected**（winner t05 c2） | 23 / 21 / 1465 | 不成立 | `generated_not_selected:…0f0b9ba2`、`conflict_within_set` | false | 成立 | — | ±0 / +1 |
| 5 `PAIR-t05c2-t07c2` | c2 selected | c2 **非selected**（winner `build-list.fnv1a32-2fdb4406`） | 23 / 21 / 1465 | 不成立 | `generated_not_selected:…98fce3dc` | false | 成立 | — | ±0 / +1 |
| 6 `PAIR-t05c2-t07c3` | c2 selected | c3 selected | **24 / 20 / 1465** | **成立** | — | **true** | 成立 | **yes**（rank 2） | **+1 / ±0** |

- 全PAIRで `termination = exhausted`、Trace Replay成功、support 3件（`e396d352` / `92d87b90` / `61066e62`）はS1〜S5成立・selected、失効0。
  `targetSelected` は `selected` と全PAIRで一致した
- Target差分（I0比）: 全PAIRでt05 Target（`a6c17e25…`）とE1外のTarget `fea60316…` を獲得し、E1外のTarget `b4f252cd…` を喪失した（D2-Cのt05段と同じ組）。
  t07 Target（`b6780f04…`）はPAIR-1 / 2 / 4 / 5で喪失し、PAIR-3 / 6では保持した。これがPAIR-3 / 6の +1 の内訳である
- `resource_conflict` rejectionはPAIR-3 / 6で19件（I0 20件）。R6の条件（Conflict 0、`resource_conflict` 0、43 / 43）には遠い

### 3.4 Skill 485の衝突

| PAIR | t07 | Skill 485 `same_skill_counter`（`{"counterBefore":485,"counterStream":"skill","kind":"same_skill_counter"}`） |
| --- | --- | --- |
| 1 / 4 | c1 | **残った**。participantsは {t07 c1, t05 c1 / c2} で、集合内Conflict（`conflict_within_set`）。t07 c1はprovisional outcomeでt05に負けて非selected |
| 2 / 5 | c2 | 現れない。t07 c2は代わりにGogma 73の `same_gogma_counter`（相手はE1外のExport Entry `build-list.fnv1a32-2fdb4406`、置換集合外）で非selectedになった |
| 3 / 6 | c3 | **現れない**。t05とt07 c3の間のConflictは0件。t07 c3はselected |

- PAIR-3 / 6でもt05 Gには置換集合外のExport Entry `build-list.fnv1a32-462a2dfa` とのGogma 140の `same_gogma_counter` が残るが、t05 Gはselectedで、
  集合内Conflictではない（PAIR-6ではt05 c2のsource OwnedWeapon `5749b7fb…` の `same_owned_weapon_consumed` も置換集合外の相手と残り、Conflictが1件多い）
- I-D2D-1（t07 c2 / c3ではSkill 485が途中のskippable `reset_skills` になる）の構造は、Skill 485の衝突の消失としては観測された。ただしt07 c2では
  別資源（Gogma 73）の衝突で非selectedになり、改善はt07 c3の組だけで得られた（I-D2D-1の注意書きどおり）

### 3.5 D2-Cの既知結果との比較（§8.3、診断）

| D2-D | D2-C | 集合の差 | D2-D | D2-C | `sameStructuralOutcome` |
| --- | --- | --- | --- | --- | --- |
| PAIR-1 | `CMP-t05-c1` | t10: `O_t10` → K1 t10 c1 | 23 / 20、R5不成立、t07非selected、Skill 485あり | 23 / 20、同左 | true |
| PAIR-4 | `CMP-t05-c2` | 同上 | 23 / 21、R5不成立、t07非selected、Skill 485あり | 23 / 21、同左 | true |

t10 c1の有無はt05 / t07の衝突の帰結を変えなかった（I-D2D-2のとおり）。digest parityではなく診断であり、D2-Cの結論は書き換えていない。

### 3.6 runtime / memory

| 項目 | 値 |
| --- | --- |
| run wall | 135.6 s（RV 17.4 s、評価8件合計118.1 s。評価1件 8.8〜16.4 s） |
| child process | 9 / 9（RV 1 + 評価 8） |
| full Planner起動 | 8回（評価ごと1回、上限8に対し）、runtime-unsupported retry 0 |
| memory | child heap最大0.74 GB、RSS最大1.35 GB（上限12,288 MB） |
| 実行環境 | Node v24.19.0、AMD Ryzen 7 9700X、メモリ 33.4 GB |

## 4. 言えること・言えないこと

言えること:

- このExport・登録6組・Research envelopeで、既存Candidateだけによる局所2-Target再合成（t05 K1 c1を追加し、t07をD2-B K0 c1からc3へ差し替え）により、
  D2-C最終（23 / 20）より良い **24 / 43、Conflict 19** の置換集合を得た。置換集合はR5（全 `G` とsupportのselected、support依存の有効性、集合内Conflictなし）を満たした
- D2-Cでt05 K1とt07 c1が衝突したSkill 485の `same_skill_counter` は、t07をc3に差し替えた組では生じなかった。t07 c2では別のGogma資源の衝突でt07が非selectedになった
- t07 c1のままt05を加える組（PAIR-1 / 4）は、t10 c1を含む集合でもD2-Cと同じ構造の非共存だった

言えないこと:

- R6（43 / 43、Conflict 0、`resource_conflict` 0）には達していない。**Issue #154の最終Acceptanceではない**
- PAIR-3が「最良」なのは登録6組の中だけである。t07 / t05の3件目以降・別supportのCandidate、t07以外の受理済みTargetの差替え、t04 / t10の同値置換を外した集合、
  3 Target以上の同時変更、別の合成順・複数pass、新しいSearchは未評価である
- Target `b4f252cd…` の喪失はD2-Cのt05段と同じく残っており、その原因の特定・解消は本Phaseの範囲外である
- E1由来のpopulation（`oracleGuidedTargetPopulation = true`）の部分集合での結果であり、別Export・別population・Production semanticsとしての妥当性へは一般化しない

## 5. 次Phaseへ

D2-D-A §15の未決事項はそのまま残る。D2-Dの結果を新しい起点（24 / 19）にした後続合成（最良PAIRへの他Targetの追加、t02 / t03の探索、t04 / t10の別axis、
population拡大）は、いずれも新しい事前登録を要する。D2-Dでは最良PAIRを起点にした追加評価・合成を行っていない（§4.4 / G38）。
