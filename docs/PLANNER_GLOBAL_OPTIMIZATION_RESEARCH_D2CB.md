# Global Planner Research D2-C-B（阻害Entry由来の限定K1探索と集合評価の実装・正式計測）

Refs #154。Research-only。事前登録: [D2-C-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md)（PR #227、本書作成時に改訂なし）。正式RESULT: `docs/PLANNER_GLOBAL_D2C_RESULT.json`。

本書はD2-C-Bの結果の要約であり、判定規則・数値の権威はD2-C-A（事前登録）と正式RESULTである。Production source、Search / Planner / RNG semantics、
Worker、UI、Persistence、schema / version、Production defaultは変更していない。Phase B / D1 / D2のformal RESULT・module・record・G storeも変更していない。

## 1. 実装

| 部品 | file |
| --- | --- |
| 登録条件、V（§3.1の導出と§3.2表の照合）、CTX record（C1〜C5）、DSC unit（D-1〜D-4、cap 2、context drift）、評価run、parity primitive、start attestation | `src/benchmarks/plannerGlobalD2C.ts` |
| analyzer（CTX / C1〜C5の独立再計算、rung-major discovery replay、ordinal、ADM、CMP replay、R5独立再判定、S1〜S5、parity 4状態、証拠整合、decision） | `src/benchmarks/plannerGlobalD2CAnalysis.ts` |
| runner（親 + `context` / `discover` / `evaluate` child、journal、abort、9時間discovery envelope、12時間run envelope） | `scripts/run-planner-global-d2c.mjs` |
| analyzer script（RESULT生成、C4のorigin digestをExportから独立に再計算） | `scripts/analyze-planner-global-d2c.mjs` |
| test（38件） | `src/benchmarks/plannerGlobalD2C.test.ts` |

- §14の既存部品をそのまま使った: `phase2c27bResolveSupportContext()`、`derivePhase2C26B2C1Schedule()`、`visitPlannerAlternativeCandidates()`、
  `createPlannerAlternativeMaterializer()`、`respectsPhase2C2Reservation()`、`runD2Evaluation()`（S5は既存APIの (a) digest一致 ∧ (b) `stableStringify()` 一致のまま）、
  D1の `d1InputDigest()` / `d1ResultDigest()` / `judgeD1R5()` / `d1B0Parity()` / `judgeD1R5Independently()`、D2の `d2R1R4()` / `judgeD2R6()` / `d2CompositionStep()` /
  `d2DiscoveryUnitOutcome()`。D2 / D1 / Phase Bのmoduleは変更していない
- §14のとおり、D2のdiscovery unitはK0専用（supportを拒否）でcap 3・D-2だけを持つため、K1 context、cap 2、D-1 / D-4、context driftはD2-C moduleで実装した
- CTX recordの `reservationBody` は導出reservationを `structuredClone()` したJSONオブジェクトで保存し、runner・analyzerはrecordのbytes・SHA-256をjournalと照合したうえで
  オブジェクトであることを確認する（文字列なら `evidence_integrity`）。評価childへはそのオブジェクトを `supportReservation` に、`reservationDigest` を
  `supportReservationDigest` に渡した。S4のSHA-256部分（Exportのsupport body → CTX record `supportBodySha256`）は `runD2Evaluation()` の前にD2-C側で検査する
- Target ID・Entry ID・stable key・reservation digestはsourceへ書いていない。context表は§3.1の導出をVで再実行して得て、§3.2表（attest済みのD2-C本文から読む）とは照合にだけ使う

### 1.1 実装上の選択（事前登録の意味論は変更していない）

| 項目 | 内容 |
| --- | --- |
| I0の実行 | `runD2Evaluation()` のstage `Z0`（`replacement_set`、`found_R` 診断なし）で実行した。D2のZ0と同じ「与えられた受理集合を1 runで評価する」手順である |
| CTXのC5不一致 | runnerはC5 mismatched（`D2C_INVALID`）を検出した時点でも中止する（§8.5に明記はないが、結果がINVALIDになることは変わらない）。正式計測では発生していない |
| D2-Bとの決定性の照合範囲 | §10.1のallowlist（`stage ∈ { B0, ADM, CMP, Z }`）の評価だけを読む。Z0はallowlist外だが、Z0の集合はD1 t09のK1 seedを含みt06を含まないため、D2-Cの評価集合と一致し得ない |
| CTX recordの整合 | analyzerは `hashStableValue(reservationBody) === reservationDigest` も照合する（不一致は `evidence_integrity`） |

## 2. provenance

| 項目 | 値 |
| --- | --- |
| measurement HEAD | `627184363db50ef256f602014b457f05a227861c`（Working Tree clean） |
| start attestation | SHA-256 `a3998ab6…5970`、verified |
| D2-C文書 SHA-256（HEAD git object） | `edd9a3fb…70a5` |
| 登録policy SHA-256 | `da3dd35c…bbf4` |
| calculation code digest | `a86f81d1…a242` |
| 入力evidence | Export、manifest、D2 / Phase B / Phase 2-C2 RESULT、D2-B G store 5件、Phase B task / record 10件、登録文書のSHA-256がすべて登録値と一致（V、analyzerで独立に再検証） |
| Production changed files | `[]`（measurement HEAD、analysis HEADとも） |
| CalculationContext / Engine | `{ unknown-initial, 4, production-rng:c5-e7, 17 }` / `production-rng:c5-e7` |
| `provenance.formal` | `true`、invalid 0 |

正式計測を1回実行し、計測開始後に計算コードを変更していない。smoke（非formal）は別run dir（`.local/d2c-k1-smoke/run1〜3`）で、context 1 / 6の一部rungだけを
`--allow-uncommitted` で実行した。smokeの結果で条件を変更しておらず、formal evidenceにしていない（`.local/d2c-smoke1/`（Phase 2-C2.5-D2-C）は読んでいない）。

## 3. 結果

### 3.1 decision

| 項目 | 値 |
| --- | --- |
| decision | **`D2C_EXCEEDS_D2B_MAIN`** |
| final | `CMP-t10-c1`: completed **23 / 43**、Conflict **20**、steps 1465、termination `exhausted`、R5成立 |
| 受理したK1 Candidate | t00 c1（`K1-t00-e396d352`、L1）、t04 c1（`K1-t04-92d87b90`、L2）、t10 c1（`K1-t10-e396d352`、L1）の3件 |
| 最終受理集合 | D2-B主軸の5件（t01 c1 / t06 c3 / t07 c1 / t08 c1 / t09 c1）+ 上記K1 3件 |
| 比較 | baseline 20 / 21 → +3 / −1、D1 incumbent 22 / 21 → +1 / −1、**D2-B主軸（I0）22 / 20 → +1 / ±0**（stepsはいずれも1465） |
| R6 | 判定13件、成立0（43 / 43、Conflict 0には達していない）。`D2C_GLOBAL_COMPLETE_R` ではない |
| 計測状態 | invalid 0、unmeasured 0、not_executed 0、bound-limited 0、discovery / run envelopeとも未到達 |

- D2-B主軸からの改善は **t00の1 Targetの完成** だけである（`CMP-t00-c1` で `O_t00` の代わりにK1 Candidateがselectedになり、completed 22 → 23）。Conflict数は20のまま
- t04 / t10のK1 Candidateは、completed・Conflict・stepsを変えずに（23 / 20 / 1465のまま）R5と非後退gateを満たして受理された。`O_t04` / `O_t10` はB0から
  selectedであり、受理はRouteの置換であってTargetの新規完成ではない。gateは「completedが後退しない」なので、同値の置換も受理される（§6.2 / §6.4の規則どおり）

### 3.2 CTX（context作成）

| context | support | reservation digest | C1〜C4 | C5 | 排他OwnedWeapon |
| --- | --- | --- | --- | --- | --- |
| `K1-t00-e396d352` | `e396d352` | `fnv1a32:240e4673` | 成立 | matched（`t00-r09-L0`） | なし |
| `K1-t02-e396d352` | `e396d352` | `fnv1a32:240e4673` | 成立 | matched（`t02-r10-L0` / `-L1`） | なし |
| `K1-t03-92d87b90` | `92d87b90` | `fnv1a32:36a22758` | 成立 | matched（`t03-r43-L0` / `-L1`） | `60126fe6…` |
| `K1-t03-e396d352` | `e396d352` | `fnv1a32:240e4673` | 成立 | matched（`t03-r10-L0` / `-L1`） | なし |
| `K1-t04-92d87b90` | `92d87b90` | `fnv1a32:36a22758` | 成立 | matched（`t04-r43-L0` / `-L1`） | `60126fe6…` |
| `K1-t05-61066e62` | `61066e62` | `fnv1a32:3eebc8a4`（初導出） | 成立 | not_applicable | `aec3d2e4…`（I-D2C-3のとおり） |
| `K1-t10-e396d352` | `e396d352` | `fnv1a32:240e4673` | 成立 | matched（`t10-r10-L0`） | なし |

7件とも `context_ready`、child wall 6.9〜7.0 s。Entry IDは `build-list.fnv1a32-` の先頭8桁表記である。

### 3.3 DSC（K1 Candidate発見）

| context | L0 | L1 | L2 | pool |
| --- | --- | --- | --- | --- |
| `K1-t00-e396d352` | extent bound、0件（27 s） | **cap、2件**（13 s） | — | 2 |
| `K1-t02-e396d352` | extent bound、0件（42 s） | extent bound、0件（89 s） | **ladder exhausted、0件**（1,009 s、heap 6.6 GB） | 0 |
| `K1-t03-92d87b90` | extent bound、0件（28 s） | extent bound、0件（45 s） | **cap、2件**（487 s） | 2 |
| `K1-t03-e396d352` | extent bound、0件（46 s） | extent bound、0件（74 s） | **cap、2件**（693 s、heap 6.4 GB） | 2 |
| `K1-t04-92d87b90` | extent bound、0件（22 s） | extent bound、0件（38 s） | **cap、2件**（503 s） | 2 |
| `K1-t05-61066e62` | extent bound、0件（273 s、heap 4.7 GB） | **cap、2件**（312 s、heap 6.1 GB） | — | 2 |
| `K1-t10-e396d352` | extent bound、0件（33 s） | **cap、2件**（3 s） | — | 2 |

- Search unit 18 / 21（登録上限21のうち、rung進行規則で到達した18件をすべて計測。残り3件はcapで終わったcontextの上位rungで、登録上の実行対象ではない）
- pool 12 Candidate（t00 2、t03 4、t04 2、t05 2、t10 2、t02 0）。全deliveryが `pooled`（`duplicate_of_lower_rung` 0、`same_key_as_d2b_k0_pool` 0）、R0違反0
- t03の2 contextで同じkeyのCandidateは無かった（`crossContextSameKey` 0）
- **Phase B K1 prefix parity 10 / 10 matched**（I-D2C-1のとおり、Phase Bで0件だった10 unitはD2-Cでも0件・extent bound）
- t02は全rungが正常に計測され、support `e396d352` のK1 contextではL2までCandidateが得られなかった（`contextsWithoutCandidateMeasured`）。これはextent bound /
  ladder終端であり、Candidate不存在の証明ではない（G34）
- K1 L2の初計測値: 487〜1,009 s、heap 3.4〜6.6 GB（60分上限・OOMには達していない）

### 3.4 ADM（R1）・集合評価

| 項目 | 値 |
| --- | --- |
| B0 | completed 20 / 43、Conflict 21、steps 1465。Phase 2-C2 summary・D2 B0の `inputDigest` / `resultDigest` とmatched |
| I0 | completed 22 / 43、Conflict 20、steps 1465、`inputDigest fnv1a32:488e42f1`、`resultDigest fnv1a32:21e8e8b5`、R5成立。D2 `CMP-t09-c1` とmatched |
| ADM | 12件すべて `evaluated`、**R1成立 12 / 12**。R2 12、R3 8（t03の4件は `G` 非selected）、`target_regressed_R` 0、`found_R` 12 |
| CMP | 12件すべて `evaluated`。R5成立 5件（t00 c1 / c2、t04 c1 / c2、t10 c1）、うちgate成立5件 |
| support | S1〜S5すべて成立（全24件のK1評価）。support非selected 0、失効0 |
| 決定性 | D2-Bとの照合2組（B0、I0）matched。D2-C内で同じ `inputDigest` の組は無かった |
| full Planner起動 | 26回（評価26件 × 1）、runtime-unsupported retry 0 |

CMPの各段:

| t | 結果 | 内容 |
| --- | --- | --- |
| t00 | **受理 c1** | c1 / c2とも23 / 20でR5成立、選択順（ordinal）でc1。`O_t00` のTargetが新たに完成 |
| t02 | `not_replaced_no_admitted` | poolが空 |
| t03 | `not_replaced_no_eligible` | 4件ともR5不成立（`G` 非selected。`K1-t03-92d87b90` の2件は集合内Conflictも）。ADMでも `G` は非selectedで、勝者はc1 / c2が `e396d352`、c3 / c4が `92d87b90`（互いに相手contextのsupport） |
| t04 | **受理 c1** | c1 / c2とも23 / 20でR5成立（completed・Conflictは不変）、ordinalでc1 |
| t05 | `not_replaced_no_eligible` | 2件ともR5不成立。t05のK1 Candidateは選ばれるが、受理済みのt07 c1（D2-BのK0）が非selectedになり集合内Conflictが生じる（t05と他1 Targetを得て2 Targetを失う） |
| t10 | **受理 c1** | c1は23 / 20でR5成立。c2は22 / 21でgate不成立かつR5不成立（受理済みt00の `G` が非selected） |

### 3.5 所要・資源

| 項目 | 値 |
| --- | --- |
| run全体 | 4,159 s（約69分） |
| CTX / DSC / 評価のchild wall合計 | 49 s / 3,735 s / 375 s |
| 評価wall | 7.4〜15.3 s / 件 |
| child process | 51 / 58 |
| child heap最大 / RSS最大 | 7.07 GB（`DSC-2-L2`）/ 10.5 GB |

## 4. 言えること・言えないこと

- 言えること: このExport・6 Target・7 K1 context（provisional winner由来、support 1件）・登録ladder・Research envelopeで、contextあたり2件以下のK1 Candidate、
  R1 admission、D2-B主軸集合からの単一pass・Target ID昇順の単調合成と非後退gateにより、D2-B主軸（22 / 20）より良い **23 / 20** の集合を得た。改善はt00の完成による
- 言えないこと: 43 / 43、Conflict 0（R6）への到達、Production runtimeとしての許容、別Export・別populationへの一般化。t02（全rung計測でpool 0）、t03 / t05
  （R5不成立）について、他のsupport・3件目以降のCandidate・別extent・別の合成順で改善できないこと
- t04 / t10の受理は同値の置換であり、完成・Conflictの改善ではない。R5成立をIssue #154の最終Acceptanceと混同しない（R6は0 / 13）

## 5. 次フェーズへの引き継ぎ（診断であり、事前登録ではない）

- 残る未完成のE1 Target（t02 / t03 / t05）の阻害要因は、Targetごとに異なる:
  - t02: support `e396d352` のK1 contextではL2までCandidateが無い（L2は1,009 s・heap 6.6 GBで最も重い）
  - t03: どちらのcontextのCandidateも、もう一方のsupport（`e396d352` / `92d87b90`）に負ける。2 supportを同時に置くK2 contextが候補になり得る（未計測）
  - t05: K1 Candidate自体は選ばれるが、D2-Bで受理済みのt07 c1と衝突する。受理済みTargetの再評価（複数pass）や合成順の変更は今回登録外（§16）
- t04 / t10の同値置換を受理したことで最終集合の状態が変わっている。後続の評価で起点にする場合は、置換が他Targetに与える影響（R5 / Conflictの構成）を改めて測る必要がある
- K1 L2のcostは事前見積もりの範囲（数十秒〜60分上限）の中央付近だった（487〜1,009 s）。discovery envelope（9時間）には大きく余裕があった
