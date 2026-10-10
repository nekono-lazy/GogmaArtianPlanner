# Global Planner Research D2-B（K0先行候補探索と集合評価の実装・正式計測）

Refs #154。Research-only。事前登録: [D2-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md)（PR #225）。正式RESULT: `docs/PLANNER_GLOBAL_D2_RESULT.json`。

本書はD2-Bの結果の要約であり、判定規則・数値の権威はD2-A（事前登録）と正式RESULTである。Production source、Search / Planner / RNG semantics、
Worker、UI、Persistence、schema / version、Production defaultは変更していない。Phase B / D1のformal RESULT・module・recordも変更していない。

## 1. 実装

| 部品 | file |
| --- | --- |
| 登録条件、V、DSC unit、評価run、R1 / R6 / gate / 選択順、parity primitive、start attestation | `src/benchmarks/plannerGlobalD2.ts` |
| analyzer（discovery replay、admission、CMP / Z replay、R5独立再判定、parity 4状態、証拠整合、decision） | `src/benchmarks/plannerGlobalD2Analysis.ts` |
| runner（親 + `discover` / `evaluate` child、journal、abort、12時間run envelope） | `scripts/run-planner-global-d2.mjs` |
| analyzer script（RESULT生成） | `scripts/analyze-planner-global-d2.mjs` |
| test | `src/benchmarks/plannerGlobalD2.test.ts` |

- 評価runはD1の公開部品（`d1InputDigest()` / `d1ResultDigest()` / `d1TrialRunSummary()` / `d1RuntimeUnsupportedRemoved()` / `judgeD1R5()` / `d1B0Parity()` /
  `judgeD1R5Independently()`）を再利用し、D1-A §4.1と同じ部品・同じ順序で実行する。`runD1Evaluation()` はPlannerResultを返さないため、D2-A §6.1の追加記録
  （`rejectedBuildListEntries`、selected Target集合）を同じPlannerResultから読む `runD2Evaluation()` をD2 moduleに置いた。D1と同じfactを返すことをtestで固定し、
  正式計測でもD1との決定性19組・B0・Z0がすべて一致した
- 実装上の注記（意味論の追加ではない）
  - `O_t`、t09のsupport Entry・reservation digest、K0 reservation digestはD1-A §1.3の登録表（SHA-256照合済み）から読み、D2-Aの記載値とも照合した
    （D2-A §2.3 / §5が当該表を登録値として名指しするため。D2-A §8.1の文書行は「hash照合だけ」と書くが、読む範囲はこの表に限定した）
  - S5の後半（Phase B recordのreservation bodyとの一致）はPhase B recordがD2の入力（§8.1）に無いため、登録digest（D1-A §1.3 / D2-A §5）との一致で判定した
  - Export SHA-256はD1と同じくsourceへ直書きせず、Phase B RESULT `sources.export` → D1 RESULT `sources.export` → manifest → D2-A本文の連鎖で検証した

## 2. provenance

| 項目 | 値 |
| --- | --- |
| measurement HEAD | `810c5f090d532e67e40c7b0cbdc6d2b8deebec49`（Working Tree clean） |
| start attestation | SHA-256 `a976efd8…7c5e`、verified |
| D2-A文書 SHA-256（HEAD git object） | `e45a0333…15ae3` |
| 登録policy SHA-256 | `2597ff75…d6aa` |
| calculation code digest | `45744c82…0f3d` |
| Production changed files | `[]`（measurement HEAD、analysis HEADとも） |
| CalculationContext / Engine | `{ unknown-initial, 4, production-rng:c5-e7, 17 }` / `production-rng:c5-e7` |
| `provenance.formal` | `true`、invalid 0 |

正式計測は1回だけ実行し、計測開始後に計算コードを変更していない。smokeは別run dir（`.local/d2-smoke/`）で行い、formal evidenceにしていない。

## 3. 結果

### 3.1 decision

| 軸 | decision | final | 比較 |
| --- | --- | --- | --- |
| 主軸（K0のみ） | **`D2A_EXCEEDS_D1_INCUMBENT`** | `CMP-t09-c1`: completed 22 / 43、Conflict 20、steps 1465 | baseline 20 / 21 → +2 / −1。D1 incumbent 22 / 21 → completed同値、Conflict −1 |
| Z軸（D1 incumbent seed） | **`D2A_Z_EXTENDS_D1_INCUMBENT`**（追加 t06） | `Z-t06-c3`: 22 / 43、Conflict 20、steps 1465 | Z0（= D1 A-b）22 / 21 → Conflict −1 |

- invalid 0、unmeasured 0、not_executed 0、bound-limited 0、run envelope未到達
- R6成立 0 / 53（43 / 43には達していない）。`D2A_GLOBAL_COMPLETE_R` ではない
- 主軸の最終受理集合: t01 c1（D1と同じ）、**t06 c3（新規）**、t07 c1（D1と同じ）、t08 c1（D1と同じ）、**t09 c1（新規K0 Candidate）**。`newCandidateAccepted = 2`
- 主軸の改善はcompleted増ではなく、Conflictが1件減ったことである（selected Target集合はD1 incumbent（Z0）と同一）。消えたConflictは `O_t06`（`5923e1d5`）と
  `ccd01768` の `same_owned_weapon_consumed` で、t06の新規Candidate c3が `O_t06` と異なるOwnedWeaponを使うことによる。Z軸も同じ1件が消えた

### 3.2 DSC（Candidate発見）

| 項目 | 値 |
| --- | --- |
| discovery unit | 26 / 33（`stopped_by_search_extent_bound` 15、`discovery_cap_reached` 10、`ladder_exhausted` 1（t02 L2）） |
| pool | 32 Candidate（t02だけ2件、他10 Targetは3件） |
| D1の `G_t` と異なる新規Candidate | 22件（t09の3件を含む） |
| Phase B K0 prefix parity | 24 / 24 matched |
| D1 G parity（t09以外の10 Targetのpool 1件目） | 10 / 10 matched |
| 所要 | child wall合計 415 s、Search時間 238 s。L2 unitは約42〜45 s |

- t06はL0で1件（D1の `G_t06`）だけdeliverしてextent boundとなり、L1で `duplicate_of_lower_rung` 1件と新規2件を得た（Phase BはL0で停止していた）
- t09はL2（Phase B未実行）で3件のK0 Candidateを得た

### 3.3 ADM（R1）・集合評価

| 項目 | 値 |
| --- | --- |
| B0 | completed 20 / 43、Conflict 21、steps 1465。Phase 2-C2 summary・D1 B0 `resultDigest` とmatched |
| ADM | 32件すべて `evaluated`、R1成立 32 / 32（R3成立 10件、`target_regressed_R` t01 2・t02 2・t04 3・t10 3） |
| CMP | 32件。受理 t01 / t06 / t07 / t08 / t09、不受理 t00 / t02 / t03 / t04 / t05 / t10（いずれも `not_replaced_no_eligible`） |
| Z | Z0 1件（D1 A-bとinputDigest・resultDigest・R5がmatched）+ dropped 7の20件。受理 t06 c3 |
| R5 | 判定53件、成立12件（主軸10、Z 2） |
| 決定性 | D2内6組・D1との19組すべてmatched |
| full Planner起動 | 86回（評価86件 × 1）、runtime-unsupported retry 0 |
| 評価wall | 7.2〜13.7 s / 件、合計1,074 s |
| run全体 | 1,489 s（約24.8分）、child heap最大1.10 GB、RSS最大1.48 GB |

### 3.4 dropped 7への寄与

| t | pool / 新規 | 主軸 | Z | 観測した勝者（診断） |
| --- | --- | --- | --- | --- |
| t00 | 3 / 2 | 不受理（3件とも `G` 非selected） | 不受理（集合内Conflictあり） | `e396d352` |
| t02 | 2 / 1 | 不受理（completedが減るためgate不成立、`G` 非selected） | 不受理 | `e396d352` |
| t03 | 3 / 2 | 不受理 | 不受理 | `92d87b90`、`e396d352` |
| t04 | 3 / 2 | 不受理（gate不成立） | 不受理 | `92d87b90` |
| t05 | 3 / 2 | 不受理 | 不受理 | `61066e62` |
| t06 | 3 / 2 | **受理 c3（新規、L1）** | **受理 c3** | （c1 / c2で `85dc00cc` ほか） |
| t10 | 3 / 2 | 不受理（gate不成立） | 不受理（集合内Conflictあり） | `e396d352` |

勝者IDはすべて `build-list.fnv1a32-` の先頭8桁表記である。

## 4. 言えること・言えないこと

- 言えること: このExport・E1 11 Target・K0のみ・登録ladder・Research envelopeで、Targetあたり3件以下のK0 Candidate、R1 admission、単一pass・Target ID昇順の
  単調合成と非後退gateにより、D1 incumbent（K1のt09を含む22 / 21）より良い22 / 20の集合を得た。t09はK0 Candidateだけで集合に入った
- 言えないこと: 43 / 43、Conflict 0（R6）への到達、Production runtimeとしての許容、別Export・別populationへの一般化、未評価のCandidate（4件目以降、K1 / K2、
  他のextent）や未評価の組合せ（別の合成順、複数pass、同時置換）で改善できないこと。dropped 7のうち6 Targetが不受理だったことは非共存の証明ではない
- I-D2-2（2件目・3件目は1件目と同じ勝者に負けるかもしれない）は、t00 / t02 / t03 / t04 / t05 / t10では観測上そのとおりだったが、t06では成り立たなかった。
  これをK0一般やK1の有効性へ一般化しない

## 5. 次の限定K1探索（C2、D2-A §13.2）への引き継ぎ（診断であり、事前登録ではない）

- 主軸で不受理だった6 Target（t00 / t02 / t03 / t04 / t05 / t10）の阻害Entryは、ADM / CMP / Zを通じて `e396d352`（t00 / t02 / t10、t03 c2）、
  `92d87b90`（t03 / t04）、`61066e62`（t05）に集中しており、D1で観測した勝者と同じだった。いずれもB0でselectedのE1外Entryである
- t09はK0 L2 Candidateで共存したため、D1 incumbentのK1 support（`e396d352`）は主軸の最良集合には不要だった。`e396d352` を勝者とするTarget群（t00 / t02 / t10）を
  K1 contextで探す場合、このEntryをsupportに置くことはt09を必要としない（主軸の受理集合と独立に設計できる）
- t02 / t04 / t10は `O_t` がB0でselectedであり、置換するとcompletedが減る（gate不成立、`target_regressed_R`）。K1探索で勝者を変えても、gateの比較基準が
  受理済み集合の結果である点は変わらない
- t06のように、Phase Bの最初のrungで停止していたTargetで上位rungの2件目・3件目が受理された。限定K1探索でも、最初のCandidateで止めない発見規則が有効な可能性がある
  （D2の結果からの推論であり、未計測）
