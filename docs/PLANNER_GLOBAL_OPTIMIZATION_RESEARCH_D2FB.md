# Global Planner Research D2-F-B（t03の3-support K3 context探索とD2-D最良incumbentへの追加評価の実装・正式計測）

Refs #154。Research-only。事前登録: [D2-F-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2F_SPEC.md)（PR #233、本書作成時に改訂なし）。正式RESULT: `docs/PLANNER_GLOBAL_D2F_RESULT.json`。

本書はD2-F-Bの結果の要約であり、判定規則・数値の権威はD2-F-A（事前登録）と正式RESULTである。Production source、Search / Planner / RNG semantics、
Worker、UI、Persistence、schema / version、Production default / boundsは変更していない。Phase B / D1 / D2 / D2-C / D2-D / D2-Eのformal RESULT・module・record・
G store・CTX recordも変更していない（D2-C / D2-D / D2-Eのtestには、他Researchからのimport禁止検査の許可対象としてD2-Fのexact pathだけを追加した）。
oracleは実行入力・診断入力・分析のいずれにも使っていない。Phase 2-C2.5系（`plannerGlobalPhase2C25*`）の成果物は読んでいない。

## 1. 実装

| 部品 | file |
| --- | --- |
| 登録条件、V（D2-E RESULTとD2-C RESULTはD2-F-A §11.1の狭いallowlist、D2-D / D2 RESULTはD2-E-Aのallowlist、§3.1のK3 context機械導出（E* / lost / X）と§3.2表の照合、§8.1のI0集合とD2-E-A §1.2表の照合、§8.2のWP集合と表の照合、G store 9件・K1 CTX record 6件・D2-E CTX-K2 record・D2-E K2 c2 G store・D2-E attestation / rawの照合）、RV（D2-Dの `runD2DReverification()` + RV7 + RV8）、CTX-K3（C1〜C8）、DSC unit（R0-K3 / R0-K2 / R0-split、D-1〜D-6、`K3_POOL_CAP = 2`、delivery上限11）、評価wrapper `runD2FEvaluation()`、start attestation | `src/benchmarks/plannerGlobalD2F.ts` |
| analyzer（RV1〜RV6の再照合、RV7 / RV8の独立再計算、CTX-K3のC1 / C3 / C4 / C6 / C7の独立再計算とC5 / C8の登録値照合、rung進行・pool・重複排除の再生、R1、S1〜S6、R5独立再判定と `judgeD1R5()` の相互照合、EXT診断、gate、improved、選択順、R6、parity 4状態、決定性、証拠整合、decision） | `src/benchmarks/plannerGlobalD2FAnalysis.ts` |
| runner（親 + `rv` / `context` / `discover` / `evaluate` child、journal、abort、5時間discovery envelope、8時間run envelope） | `scripts/run-planner-global-d2f.mjs` |
| analyzer script（RESULT生成。baseline PlannerInput、Planner-start origin digest、登録済みProduction RNG EngineをExportからanalyzer自身で構築） | `scripts/analyze-planner-global-d2f.mjs` |
| test（32件） | `src/benchmarks/plannerGlobalD2F.test.ts` |

- K3 reservationは3 supportのExport Entry bodyから既存authority（`phase2c27bResolveSupportContext()` = `derivePlannerAlternativeReservation()`）で導出し、
  K1 / K2 reservationのunionはsemanticsとして使っていない（union一致は診断 `equalsK1ComponentwiseUnion` / `equalsK2UnionNewSupport` だけ）
- Target ID・Entry ID・stable keyはsourceへ書いていない。K3 context・I0集合・WP集合・追加supportはVで§3.1 / §8.1 / §8.2の導出を再実行して得て、
  §3.2 / §8.2表（attest済みのD2-F本文）とD2-E-A §1.2表（登録済みのD2-E-A文書）とは照合にだけ使う。登録reservation bodyはD2-F本文 §1.6のJSONから読む

### 1.1 実装上の選択（事前登録の意味論は変更していない）

| 項目 | 内容 |
| --- | --- |
| 評価wrapper | §6どおり、D2-E moduleを変更せず `runD2FEvaluation()` をD2-F moduleに置き、`runD2EEvaluation()` と同じProduction部品を同じ順序で使った。変えたのは静的checkの件数上限だけ（requiresSupport ≤ 3、ADM / EXTはK3 Candidateちょうど1件、WPはK2 Candidateちょうど1件、B0 / I0は0件）。同一性は (a) Fake Engine fixtureでB0・K1置換（I0形）・K2置換（D2-FのWPとD2-EのEXT）について `runD2EEvaluation()` とfacts・`resultDigest`・reservation checkが一致するtest、(b) 正式計測のI0がD2-D / D2-E I0の `resultDigest fnv1a32:57dbb4e5` と一致、(c) 正式計測のWPがD2-E `EXT-K2-t03-c2` の `fnv1a32:2f7009bf` / `fnv1a32:03e2ef58` と一致、で確認した |
| D2-C RESULTの読み取り | D2-F-A §11.1のD2-C allowlistはD2-E-Aより狭い（`composition`・ADM / CMP観測・`aggregates` を含まない）ため、D2-Eの `validateD2EInputs()` / `projectD2ED2CResult()` は使わず、D2-F専用の `projectD2FD2CResult()` で `sources` / `provenance` / `invalidReasons` / `decision.case` / `contexts[]` / `discovery.targets[t03].pool[]` / `evaluations[].{id, status, digests}` だけを読んだ |
| 登録値の記載場所 | §11.1が直接名指しする入力はD2-F文書で、「D2-E-A §10.1と同じ」と委譲している入力（D2-D / D2-C attestation・raw、D2-D-A / D2-D-B文書、G store、K1 CTX record、K0 digest）はD2-E-A文書（SHA-256照合済み）で、SHA-256の記載を照合した |
| §8.5の資源identity | k2Failure（Skill 648 / Gogma 125）はD2-E RESULTのE*で `G` が新supportと衝突したConflictから導出し、D2-F §1.2の記載と照合した。priorT03（Skill 341 / Gogma 71 / Skill 344）はD2-F §1.2とD2-E-A §1.5の記載の和から前者を除いたもの（診断だけ） |
| C7・C5・C8のanalyzer側再計算 | §5.1どおり、analyzerは3 supportのExport bodyから `derivePlannerAlternativeReservation()` でK3本体を全6順列で、単独reservationを各bodyから再導出し、recordのbody・digestと照合した（recordを再計算値の代わりに使っていない） |
| S5 authority | `61066e62` → CTX-6、`92d87b90` → CTX-3、`e396d352` → CTX-1、`54dd2b4e` → CTX-K3 recordの `singleSupportReservations` / `supportBodySha256s`（C8で§4.2の登録値と一致を確認したもの） |

## 2. provenance

| 項目 | 値 |
| --- | --- |
| measurement HEAD | **`b9c1de23e250eabdccdb454b88bc79e2a29aecfb`**（Working Tree clean、analysis HEADも同じ） |
| start attestation | SHA-256 `4846e391a8308a35af47bed4e69769f3036b5d37c3287ca638092fbe1f0d12a8`（40,832 bytes）、verified |
| D2-F-A文書 SHA-256（HEAD git object） | `2d4b946f69b57b4dd7ce92afcf3a57f2be0a1976d2558da299d2b07ecbf423df` |
| 登録policy SHA-256 | `780748d17b02af3b98b684b91fce72cbbea032c2d5d62a1c5647b1d5b1666c89` |
| calculation code digest | `98e743a38a7eed00a1dc6f1bbf64dcb7536fc1e0f4791b0f638b3e5799e91692` |
| raw | `.local/PLANNER_GLOBAL_D2F_K3_RAW.json.local`（24,167 bytes、`e747a5b9…7431`）、run dir `.local/d2f-k3-formal.run/`（record 7件。commitしない） |
| 入力evidence | Export、D2-E / D2-D / D2-C / D2 / Phase 2-C2 RESULT、D2-E-A / D2-E-B / D2-D-A / D2-D-B文書、chained文書9件、D2-E / D2-D / D2-C attestation / raw、G store 9件、K1 CTX record 6件、D2-E CTX-K2 record、D2-E K2 c2 G storeのbytes・SHA-256がすべて登録値と一致（V、analyzerで独立に再検証） |
| Production changed files | `[]`（measurement HEAD、analysis HEADとも。基準main `407a57f`） |
| `calculationCodeChangedSinceMeasuredHead` | `[]` |
| CalculationContext / Engine | `{ unknown-initial, 4, production-rng:c5-e7, 17 }` / `production-rng:c5-e7` |
| `provenance.formal` | `true`、`runStatus = completed`、invalid 0、`oracleReadBy{Runner,Child,Analyzer} = false`、`oracleGuidedTargetPopulation = true` |

正式計測は1回だけ行った。smoke（非formal）は別run dir（`.local/d2f-k3-smoke/`）で `--allow-uncommitted` により実行し、V〜CTX-K3とDSC L0の経路の動作だけを確認した。
smokeの結果で条件を変更しておらず、formal evidenceにしていない。

## 3. 結果

### 3.1 decision

| 項目 | 値 |
| --- | --- |
| decision | **`D2F_INCOMPLETE`**（`lowerBound = true`） |
| 理由 | 登録unit `DSC-K3-L2` が **`out_of_memory`**（unmeasured）。それ以外のRV / B0 / I0 / WP / CTX-K3 / DSC L0 / L1はすべてmeasured |
| discovery | `unmeasured`（L0 / L1は `stopped_by_search_extent_bound` で0件、L2はOOM） |
| pool / admitted | 0 / 0（ADM・EXTは登録規則によりpoolが空なので0件。L2が計測できなかったためで、Candidate不存在の観測ではない） |
| R5 / improved / R6 | EXT 0件のため判定対象なし（`k3CandidateObservedUnderIncomplete = false`、`setCoexistenceObservedUnderIncomplete = false`、`exceedsD2dObservedUnderIncomplete = false`、`globalCompleteObservedUnderIncomplete = false`） |
| wrapper parity | `matched` |
| 比較（subject = I0） | baseline 20 / 21 → +4 / −2、D2-C最終 23 / 20 → +1 / −1、**D2-D最良 24 / 19 → ±0 / ±0**、D2-E best EXT（参考）24 / 19 / 1470 → ±0 / ±0（steps −5） |
| 計測状態 | invalid 0、unmeasured 1（`DSC-K3-L2`）、not_executed 0、bound-limited 0、discovery / run envelope未到達 |

### 3.2 RV・B0・I0・WP・CTX-K3

| 項目 | 結果 |
| --- | --- |
| RV | `verified`。incumbent 9件RV1〜RV4、support 3件RV5 / RV6成立。**RV7**（`54dd2b4e`）: Export body 1件、SHA-256 `2dd3ca57…7b81` 一致、単独reservation `fnv1a32:6ee53871`・body一致。**RV8**（D2-E K2 c2）: G store bytes・SHA-256一致、id / Target / CalculationContext / `isStale = false` / Search identity / `candidateStableKey` SHA-256一致、replacement `ready`（`O_t03`）、D2-E CTX-K2 reservationに対するR0成立（analyzerが再計算）。wall 13.5 s |
| B0 | `evaluated`、20 / 43、Conflict 21、steps 1465、`exhausted`、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`。Phase 2-C2 summary・D2-E / D2-D / D2-C / D2 B0とmatched |
| I0 | `evaluated`、**24 / 43、Conflict 19、steps 1465**、`exhausted`（`reachedLimits = []`）、`inputDigest fnv1a32:6493291d`、`resultDigest fnv1a32:57dbb4e5`、R5成立、Trace Replay成功、`resource_conflict` 19、support 3件selected、`54dd2b4e` selectedでそのTarget完成。`d2d_best` / `d2e_i0` / `registered_input` / `determinism_prior` すべてmatched |
| WP（`WP-D2E-EXT-c2`） | `evaluated`、24 / 43、Conflict 19、steps 1470、R5成立、`inputDigest fnv1a32:2f7009bf`、`resultDigest fnv1a32:03e2ef58`。**`d2e_wrapper` matched**（D2-E `EXT-K2-t03-c2` と一致。I0比でt03 Target獲得・`54dd2b4e` のTarget喪失もD2-Eと同じ）。parity専用で、incumbent・EXT・decisionの比較値には使っていない |
| CTX-K3 | `context_ready`。C1〜C8すべて成立。**C5 matched**（`reservationDigest fnv1a32:6e2a0744`、body一致、analyzerのExport body再導出とも一致）、**C8 matched**（`54dd2b4e` 単独 `fnv1a32:6ee53871`、`92d87b90` 単独はCTX-3 / CTX-5、`e396d352` 単独はCTX-1 / CTX-4 / CTX-7の記録と一致）、C7は全6順列で同一digest・body（analyzerも独立再計算）、origin `fnv1a32:ff018910`、`conflictContextCount = 21`。wall 16.4 s |
| C3（analyzer独立再計算） | 成立。3 supportのExport bodyから再導出した参照OwnedWeapon = 排他消費OwnedWeapon = {`60126fe6…`, `da8d7cf3…`}、route unit plan 3 Entry / rejection 0、reservation `exclusiveOwnedWeaponIds` と一致、child recordと一致 |
| 診断 | `equalsK1ComponentwiseUnion = true`、`equalsK2UnionNewSupport = true`（D2-F-A §1.6の観測どおり。semanticsには使っていない）。登録資源: Skill 648 / Gogma 125 / Skill 341 / Gogma 71はheldかつblocked、Skill 344はheldだがblockedでない |
| parity | `baseline` 1、`d2d_best` 1、`d2e_i0` 1、`registered_input` 1、`d2e_wrapper` 1、`k1_context` 6、`k2_context_prior` 1、`k3_context_registered` 1、`k1_new_support_registered` 1、`determinism_prior` 3（B0 / I0 / WP）がすべて `matched`。`mismatched` / `not_checked` 0 |

### 3.3 discovery（K3 context `K3-t03-54dd2b4e-92d87b90-e396d352`）

| unit | extent（Normal / Gogma / Skill） | outcome | delivered | wall / searchOnly | heap peak / RSS peak |
| --- | --- | --- | ---: | --- | --- |
| `DSC-K3-L0` | 4 / 235 / 4 | `stopped_by_search_extent_bound` | 0 | 149.8 s / 147.0 s | 4.00 GB / 4.84 GB |
| `DSC-K3-L1` | 8 / 235 / 256 | `stopped_by_search_extent_bound` | 0 | 246.1 s / 243.0 s | 7.40 GB / 8.69 GB |
| `DSC-K3-L2` | 128 / 235 / 1500 | **`out_of_memory`**（unmeasured） | —（recordなし） | 2,662.0 s（child終了時） | 10.40 GB（IPC最終sample）/ 13.46 GB |

- L2 childは開始から2,662 sでV8のfatal error（exit code 134、`node::OnFatalError`）により終了し、runnerはrecordなしの `out_of_memory` と分類した。child heap上限は登録値12,288 MB
  （`--max-old-space-size`）で、wall上限60分には達していない（`timedOut = false`）。登録どおりretry・fallback・上限変更は行っていない（§10.4 / G6）
- 比較（参考）: t03のK2 contextはL0 42.5 s / 1.38 GB、L1 63.0 s / 1.95 GB、L2 671.2 s / 6.00 GBだった。K3はL0で約3.5倍の時間・2.9倍のheap、L1で約3.9倍の時間・3.8倍のheapを要した。
  K3 reservationのSkill heldは308位置、Gogma heldは71位置の連続区間であり（K2はそれぞれ3 / 23位置）、D2-F-A §1.7 / I-D2F-5が未計測としていたL2のcostは登録envelopeを超えた
- L0 / L1でdeliveryは0件だったので、D-2〜D-6のいずれにも該当するdeliveryは無かった。R0-K3 / R0-K2 / R0-splitの不成立も観測されていない

### 3.4 ADM・EXT

- poolが0件のため、登録規則（§7 / §8.3）によりADM・EXTの評価は0件である（`not_executed` ではなく、登録上の評価対象が存在しない）。評価リクエストはB0 / I0 / WPの3件、child processは8 / 12

### 3.5 runtime / memory

| 項目 | 値 |
| --- | --- |
| run wall | 3,119.5 s（RV 13.5 s、CTX-K3 16.4 s、DSC 3 unit合計 3,057.9 s、評価3件合計 31.6 s） |
| child process | 8 / 12（RV 1 + CTX 1 + DSC 3 + 評価 3） |
| full Planner起動 | 3回（評価ごと1回、上限8に対し）、runtime-unsupported retry 0 |
| memory | child heap最大10.40 GB・RSS最大13.46 GB（`DSC-K3-L2`、上限12,288 MB）。評価childのheapは最大0.73 GB |
| 実行環境 | Node v24.19.0、AMD Ryzen 7 9700X、メモリ 33.4 GB |

## 4. 言えること・言えないこと

言えること:

- D2-E evidenceから機械導出したK3 context（t03、support `54dd2b4e` / `92d87b90` / `e396d352`）は登録表と一致し、3 supportのExport bodyから既存authorityで導出した
  K3 reservationは登録値 `fnv1a32:6e2a0744` と一致した。Skill 648 / Gogma 125はK3でheldかつblockedである（C5の帰結）
- D2-F評価wrapperはB0 / I0 / WPのいずれでも既存のformal結果を再現した。特にWPはD2-Eの2-support経路（`EXT-K2-t03-c2`、24 / 19 / 1470）を同じdigestで再現した
- 登録ladderのL0 / L1では、K3 contextのSearchはCandidateをdeliverしなかった（extent bound）
- K3 contextのL2 Searchは、登録envelope（child heap 12,288 MB）の範囲では計測できなかった（`out_of_memory`）

言えないこと:

- **K3 Candidateが存在しない、とは言えない**。L2はOOMでunmeasuredであり、L0 / L1の0件もextent boundによる（§10.2 / G6 / G7）
- K3 Candidateがselectedになるか、`54dd2b4e` のTargetを維持できるか、R5を満たすか、24 / 19から改善するか、R6に達するかは、いずれも観測していない。
  `D2F_INCOMPLETE` のmeasured範囲（pool 0、EXT 0）は下限evidenceであり、「unmeasuredが無ければ同じ結果だった」とは主張しない
- **K3仮説が誤りだったとは結論づけない**
- D2-D最良（24 / 19）からの改善は得られていない。R6（43 / 43、Conflict 0、`resource_conflict` 0）には達していない。**Issue #154の最終Acceptanceではない**
- WPのparity matchedはD2-F評価wrapperがD2-Eの2-support経路を再現したことだけを示し、3-support経路の正しさの証明ではない（§6 / §14.2）
- E1由来のpopulation（`oracleGuidedTargetPopulation = true`）の部分集合での結果であり、別Export・別population・Production semanticsとしての妥当性へは一般化しない

## 5. 次Phaseへ

D2-F-A §17の未決事項はそのまま残る。D2-Fの観測から、次の点が具体化した（いずれも新しい事前登録を要し、本Phaseでは評価していない。登録条件を事後に変えた再計測は行っていない）:

- K3 contextのL2 Searchは12 GB heapでOOMとなった。L2を計測するには、heap上限の見直し、あるいはextentの分割（例: Skill方向の段階追加）、
  またはheld区間が長いreservationでのsame-cost closureのmemory特性の調査が必要になる。いずれも本書では決めない
- D2-E-B §5のもう一つの候補（`54dd2b4e` 側Targetの代替Routeとt03 K2 c2の組み合わせ）、incumbent t00とt03の同時変更、t02の探索、population拡大は未評価のまま残る

Issue #154はCloseしない。
