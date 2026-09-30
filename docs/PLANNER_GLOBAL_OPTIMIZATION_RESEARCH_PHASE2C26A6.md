# Global Planner Research Phase 2-C2.6-A6（Bonus multiset equalityのallocation-free化と正式再測定）

Refs #154。Production変更は `src/domain/models/domainRules.ts` の `areRestorationBonusSetsEqual()` 1関数だけ（performance-only）。
Candidate / Search / Planner semantics、defaults、extent、trial / rerun bounds、schema / version、RNG engine、Persistence、UI、
`docs/SEARCH_SPEC.md` は変更していない。Target Ideal multisetの事前計算、rank lookup / validation hoist、`Array.filter` の置換、
notice scan、frontier reduction、state generationのoptimizationは行っていない。

## 1. 結論

**A5で特定したmultiset equality hotspotを除いた結果、同一raw solutionに対する `bonus_ideal_filter` の時間は3件とも約84%減った
（after / before = 0.157 / 0.156 / 0.160）。一方、3件ともprimary Searchは30分以内に完了せず（timeout 3、OOM 0）、Search wallの
91〜92%を `bonus_depth_read`（held-aware Gogma `readReservedDepth()`）が占める構成になった。**

事前登録rule（§8）の判定: **Case R（`R_filter_reduced_timeout_remains`）**。次の候補は、A3で既に最大だった `bonus_depth_read` 内部
（`frontier_reduction_sort` / `state_generation`）の再評価である。

| orientation | 共通work prefix | 同一raw solution | filter before → after（prefix） | filter ratio | filter ns / raw | prefix到達時間 before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 609 work | 311,911,268 | 469.1 s → 73.8 s | **0.157** | 1,504 → 237 | 1,797 s → 1,376 s（0.77） |
| c13-p1 | 266 work | 355,597,735 | 525.7 s → 82.2 s | **0.156** | 1,478 → 231 | 1,790 s → 1,303 s（0.73） |
| c14-p0 | 492 work | 337,048,805 | 503.1 s → 80.6 s | **0.160** | 1,493 → 239 | 1,796 s → 1,368 s（0.76） |
| 3件合計 | 1,367 work | 1,004,557,808 | 1,498.0 s → 236.7 s | **0.158** | — | — |

- 共通work prefix = A4 formal runとA6 runの完了済みwork recordの先頭一致部分。A6は3件ともA4が30分で完了した全work recordを
  含み（A4の全記録が共通prefix）、**そのすべてでwork identityとcounts（raw / Ideal / evaluated solution数、subscriber、retained、
  exhausted、unsupported）がA4と完全一致した（semantic failure 0）**。
- prefix到達時間 = 最初の共通workの開始から最後の共通workの完了まで。A4が約30分かけた処理量にA6は約22〜24分で到達した。
- 同じprefixで `bonus_depth_read`（ratio 0.965〜0.995）と `bonus_notice_scan`（0.98〜1.10）はほぼ不変。filterの約1,261秒の削減が
  到達時間短縮の大部分である。

30分budget全体（各runの観測点まで。afterの方が多く処理するため絶対値は like-for-like ではない）:

| orientation | Search wall | `bonus_depth_read` share | `bonus_ideal_filter` share | `bonus_notice_scan` share | raw solution（30分内） | Bonus depth works | Keep予測 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 before (A4) | 1,794.4 s | 71.6% | 26.1% | 2.3% | 311,563,140 | 600 | 29,104 |
| c6-p1 after (A6) | 1,792.8 s | **92.1%** | **4.9%** | 3.0% | 370,604,107（×1.19） | 813 | 29,247 |
| c13-p1 before | 1,789.7 s | 67.9% | 29.4% | 2.7% | 355,597,735 | 256 | 28,218 |
| c13-p1 after | 1,793.5 s | **90.8%** | **5.8%** | 3.4% | 449,355,409（×1.26） | 332 | 28,218 |
| c14-p0 before | 1,796.6 s | 69.5% | 28.0% | 2.5% | 337,048,805 | 484 | 26,996 |
| c14-p0 after | 1,792.8 s | **91.5%** | **5.4%** | 3.0% | 403,560,655（×1.20） | 601 | 29,236 |

filter section全体のraw solution 1件あたり（30分budget、section合計 / raw solution合計）: 1,504 / 1,478 / 1,493 ns → 238 / 231 / 241 ns。
Bonus depth work単位の中央値も 1,505 / 1,479 / 1,493 ns → 240 / 231 / 245 ns。

3件とも: Ideal Bonus solution 0、Candidate delivered 0、trial 0、full Planner run 0、kill時のactive sectionは `bonus_depth_read`、
boundary contract violation 0、coverage ≥ 0.999998。sampled max heap 4.4 / 4.7 / 4.6 GiB（A4: 3.8 / 4.7 / 4.2 GiB）、RSS 4.9〜5.1 GiB。
処理量が増えた分heapも増えたが、8 GBに対して余裕があり、OOMは無い。

## 2. Production変更

`areRestorationBonusSetsEqual(left, right)`（`src/domain/models/domainRules.ts`）:

| | 旧 | 新 |
| --- | --- | --- |
| 方式 | 各sideで `JSON.stringify([bonusTypeId, bonusRankId])` をkeyに `Map<string, number>` を作り、sizeとkeyごとのcountを比較 | 左slotを順に見て、未使用の右slotのうち `bonusTypeId` と `bonusRankId` が両方一致する最初のslotを消費する。使用済み右slotはbit maskで管理。見つからなければfalse |
| allocation | 1回あたりMap 2個、key string 10個、spread配列等 | なし（matching管理のArray / Set / Mapを作らない。sort、JSON.stringify、key string、clone、inputのmutationなし） |
| 比較回数 | — | 最大5 × 5 |

`bonusKey()` / `countBonuses()` はこのhelper専用だったため削除した。

### 2.1 維持したDomain semantics

- unordered multiset: slot順だけが違う5 bonusは一致（Ideal判定の意味はslot順を含まない）
- duplicate count: 同じBonus Type + Rankの重複数まで一致を要求（`A,A,B,C,D` と `A,B,B,C,D` は不一致）。右slotを一度しか消費しない
  ことで保証する
- identity: 1 bonusの一致は `bonusTypeId` と `bonusRankId` の両方の完全一致。string IDの `===` は、旧実装の
  `JSON.stringify([type, rank])` key一致（string配列のJSON表現は単射）と同値である
- `areRestorationBonusSlotsEqual()`（Keep / slot順の意味）は変更していない。multiset比較をslot-order-sensitiveな契約へ流用していない
- `satisfiesIdealBonuses()`（`src/domain/target/targetEvaluator.ts`）は変更していない: target側 → final側のBonusRank reference
  validation、scope判定（`gogma_artian` だけがIdeal）、multiset比較の順序、unknown BonusRankのDomain Error（`normal_artian`
  scopeでもfalseを返す前にthrow）はそのまま
- 長さが異なる配列（`RestorationBonusSet` の型契約外）はfalse（旧実装も異なる長さの多重集合は不一致）

`RestorationBonusSet` の型契約（5要素、string ID）の範囲で旧実装と同一の結果を返す。型契約外の値（ID以外の型、欠落entry）について
旧実装と挙動を合わせる設計はしていない（Production caller・validation pathはいずれも型契約内の値でこのhelperを呼ぶ）。

### 2.2 correctness test

`src/domain/models/restorationBonusMultisetEquality.test.ts`:

- identical / permutation / 全5 slotの120 permutation / duplicateを含む120 permutation（両方向）→ true
- duplicate countだけ違う（両方向）、`bonusTypeId` 違い、`bonusRankId` 違い → false
- frozen inputでmutationしない
- **旧実装（JSON key + Map count）をtest-only referenceとして再現**し、4 bonus（type共有 / rank共有 / 両方違いを含む）上の全順序付き
  5-slot集合 1,024件の全組合せ 1,048,576 pairで新実装と一致すること、true pairの数が56 multisetの（順序数）²の和と一致すること
- JSON quoting / 単純連結で衝突し得るID（`'ab','c'` と `'a','bc'`、`'a","b'`、`'["a"'`、空文字列）上の全組合せでreferenceと一致
- `areRestorationBonusSlotsEqual()` とは区別される（permutationでmultisetはtrue、slot比較はfalse）
- `satisfiesIdealBonuses()`: Gogma scopeのpermutationはIdeal、Normal scopeはfalse、duplicate count違いはfalse、target側 / final側の
  unknown BonusRankは両scopeでthrow

旧実装はProduction sourceに残していない（test内referenceのみ）。既存のCandidate Search、Planner Alternative、constrained enumeration、
Target evaluation関連testは全件passした。

A5 testのfunction span検査は現行 `domainRules.ts` のsource textを読んでいたため、A5 measured HEAD（`a2e3c3e`）時点の
`domainRules.ts` 1〜40行を固定したtext（A5 analyzer自身もmeasured HEADのsourceを読む）へ置き換えた。A5の検査内容は変えていない。

## 3. authorityと位置付け

| authority | ファイル | SHA-256 | 用途 |
| --- | --- | --- | --- |
| C2.6-A RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json` | `dab2f27a1ca94e5db38279e3848f76d033710c38d6e838da227e36e78c67b171` | baseline / condition parity |
| C2.6-A2 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json` | `4bde9a5bcd84cc5e29d5dcf666f9eafb6bbb64d5f49aace1b15f36cf913fadc2` | A2 rule（chain） |
| C2.6-A3 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json` | `b5562342585899163c8d554bbc25ef6654bab12479ec403cf5d474f799beb3a2` | A3 selection / 条件（chain） |
| C2.6-A4 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json` | `15e415990fc48a77f2f890a52dd74e13f1ac349622cd266fc6cfe69b87e9d529` | **before**（formal、Case O） |
| C2.6-A5 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json` | `9d025a20cad23955adcb19fdee92d7c2e70eeb4b2429e875ddf5fb7bbdcd84c3` | **optimization理由とprimary selection**（formal、Case MULTISET） |
| A4 formal raw | `PLANNER_GLOBAL_PHASE2C26A4_RAW.json.local`（commitしない） | `b6fd9b844f9d0add9b5e7b6d46e974c072c8fd43e8a680ee0f32ac3ced2d30a5` | work prefix semantic parity（A4 RESULTの `sources.run` と一致したときだけ使う） |
| Export | `gogma-artian-planner-backup_20260927015837.json`（commitしない） | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | calculation input |

A5 RESULTはfail-closedで検証した（`parsePhase2C26A5ResultAuthority()`）: `provenance.formal`、`formalSeriesValidation.valid`、
`selectionValidation.valid`、`conditionParity.valid`、`baselineParity.valid`、orientations 3、timeout 3、decision case
`MULTISET_multiset_equality`、`validPrimaries` と `primariesAtThreshold.multiset_equality` がselection全体、各primaryのjit_default行が
valid かつ multiset share ≥ 0.35、A5の `c26a4MeasuredHead` がA4 measured HEAD。SHA chainとして、A5が記録したC2.6-A / A2 / A3 / A4の
SHA（provenance、runner記録、`authorityShaChain`、A4のchain記録、sources）がすべて実際に読んだファイルと一致することを確認した。
A4 RESULTはA5と同じ `parsePhase2C26A4ResultAuthority()`、A3以前も既存parserで検証した。どのRESULTもSearch / Planner inputには使っていない。

- formal measured HEAD / analysis HEAD: `65a2a5cb2b811809b6afa1b6a5abdd988f721247`（計測後のcalculation code変更なし、`formal = true`）
- raw: `PLANNER_GLOBAL_PHASE2C26A6_RAW.json.local`（SHA-256 `feb1238d58e24d68bc9ee00a8cd68dcd8b904027f5868449e70df10062480bda`、commitしない）
- committed evidence: `docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json`

### 3.1 Production変更guard

runner（working tree込み）とanalyzer（gitのcommit間diff）の両方で、A4 measured HEAD（`9fadd93`）→ A6 measured HEAD、および
A5 measured HEAD（`a2e3c3e`）→ A6 measured HEAD の `src` 変更から Research（`src/benchmarks/`）・test（`*.test.ts(x)`、`src/test/`）を
除いた集合が **ちょうど `src/domain/models/domainRules.ts` だけ** であることをfail-closedで確認した。したがってA4 beforeとA6 afterの
calculation codeの差はこの最適化だけである。

## 4. 変更境界

| 役割 | ファイル |
| --- | --- |
| Production optimization | `src/domain/models/domainRules.ts` |
| correctness test | `src/domain/models/restorationBonusMultisetEquality.test.ts` |
| A5 authority parse・Production変更guard・A4 before読込・条件parity・selection | `src/benchmarks/plannerGlobalPhase2C26A6.ts` |
| work prefix semantic parity・before / after比較・formal validator・decision rule | `src/benchmarks/plannerGlobalPhase2C26A6Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A6.test.ts`、`src/benchmarks/plannerGlobalPhase2C26A5.test.ts`（span source固定のみ） |
| runner / analyzer | `scripts/run-planner-global-phase2c26a6.mjs` / `scripts/analyze-planner-global-phase2c26a6.mjs` |

kernel childはA4のchild roleそのまま（`createPhase2C26A4KernelProgress()`、`runPhase2C26A4Kernel()`、同じdurable記録・heartbeat・IPC）。
per-orientationの解析もA4の `analyzePhase2C26A4Kernel()` をそのまま使い、A6 moduleはbefore / after比較だけを加えた。

## 5. 条件

A4 / A5 primaryと同一（A5 RESULTの `conditions` とfield単位で一致を検証し、さらにA5のparity関数でA4条件、A4経由でA3 / C2.6-A / A2の
条件chainも再検証）:

| 条件 | 値 |
| --- | --- |
| concurrency | 1 |
| child heap / Node flags | 8,192 MB（`--max-old-space-size=8192` のみ、JIT default） |
| orientation budget | 30分（1,800,000 ms）、retryなし、fresh Node child |
| extent | Normal 4 / Gogma 235 / Skill 4（Production default） |
| trial bounds | `maxCandidateTrialsPerTarget = 2` / `maxPlannerReruns = 8` |
| Research maxPlanSteps | 20,000 |
| yield | `setImmediate` |
| CalculationContext | `unknown-initial` / master 4 / `production-rng:c5-e7` / app schema 17 |
| lineage | empty |
| Search instrumentation | A4の `onSearchRuntime`（section境界observer）のみ。CPU profiler・A3 / A5 instrumentationなし |

A5のCPU profiler付きwall timeとは比較していない。比較相手は同じinstrumentationのA4 formal runだけである。

baseline parity: baseline child（ordinary Production Planner）の54 orientation、summary、順序付きID、identity、metadataがC2.6-A
authorityと一致した。**最適化後のordinary Production Planner結果もC2.6-A時点と同一**である。

## 6. selection

A5 RESULTの `selectionValidation.expected`（= A4 selection = A3 selection）をauthorityとし、sourceにIDを固定していない。現在のbaseline
から再導出したorientationのうちその3件（c6-p1、c13-p1、c14-p0）だけを各1回実行した（missing / duplicate / foreign / non-primary /
metadata mismatch 0）。

## 7. 測定方法

- 各orientationはA4と同じfresh Node child。Search section境界の時刻はResearch側 `performance.now()`。観測点はtimeoutでは最後の
  heartbeat（以降の未観測tailは4.1〜4.8秒）。
- **semantic parity**: 各orientationについて、A6とA4 formal rawの完了済みwork summary（Bonus / Skill depth work）をseq順に並べ、
  共通prefixの各recordの `{targetOrdinal, section, work, counts}` が完全一致することを要求した。1件でも違えばformal seriesは不成立
  （RESULTを書かない）。A4 rawはA4 RESULTが記録したSHA-256と一致するときだけ使う。
- **主効果**: 共通prefixの `bonus_ideal_filter` phase時間の合計（after / before）。両runが同じwork recordを同じraw solution数で
  処理した範囲なので like-for-like である。30分全体の値（Search wall share、raw solution 1件あたり）は併記するが、afterの方が多く
  処理するため絶対値は直接比較しない。

## 8. 事前登録decision rule

formal run前に固定（`PHASE2C26A6_DECISION_RULE`）。primary 3件、majority 2、filter縮小threshold 0.5（共通prefixの
`bonus_ideal_filter` after / before）。判定順:

1. **C** `primary_search_completed`: 2件以上でprimary Searchが30分以内に完了 → 54 orientation再評価、またはC2.6-B（Candidate
   portfolio / 1,657 oracle coverage）へ戻る準備
2. **R** `filter_reduced_timeout_remains`: 2件以上でfilter ratio ≤ 0.5 → A3で最大だった `bonus_depth_read` 内部
   （`frontier_reduction_sort` / `state_generation`）を次候補として再評価
3. **F** `filter_improvement_small`: 2件以上でfilter ratio > 0.5 → Target Ideal prepared representation等を追加検討
4. **M** mixed: それ以外

結果: primary Search完了 0 / 3、filter ratio 0.157 / 0.156 / 0.160（3 / 3で ≤ 0.5）→ **Case R**。

参考として、A4の事前登録rule（outer category）をA6 runへそのまま適用すると **Case I（`I_inner_read_dominant`）**: coverage 1.0で、
3件とも最大categoryが `bonus_depth_read`（90.8〜92.1%）かつ他の全categoryが10%未満（filter 4.9〜5.8%、notice 3.0〜3.4%）。
これはCase Rの推奨（`bonus_depth_read` 内部へ戻る）と整合する。

## 9. 言えること / 言えないこと

### 言えること

- allocation-free multiset equalityにより、同一raw solutionを処理する `bonus_ideal_filter` sectionの時間は3件とも約84%減った
  （合計 1,498.0 s → 236.7 s、raw solution 1件あたり約1.48〜1.50 µs → 約0.23〜0.24 µs）。削減幅はA5のmultiset stack share
  （73〜77%）を上回る。A5で別categoryに入っていたGC（2〜3%）やfilter call site側sampleの一部も旧実装のallocationに由来していた
  可能性があるが、今回は内訳を測っていないため断定しない。
- 最適化はSearch semanticsを変えていない: A4が30分で完了した全work record（3件で1,367件、raw solution 10億件）のidentityとcountsが
  完全一致し、ordinary Production Plannerのbaseline 54 orientationもC2.6-A authorityと一致した。
- 同じ処理量への到達時間は約23〜27%短縮した（prefix到達時間比 0.73〜0.77）。30分内のraw solution処理量は1.19〜1.26倍。
- それでもprimary Searchは3件とも30分以内に完了せず、Ideal Bonus solutionもCandidateも0件のままである。
- bottleneck構成は `bonus_depth_read` 91〜92%、filter 5〜6%、notice scan 3%になった。filterは主要因から外れた。

### 言えないこと

- 1,657-step oracleに近いRouteを見つけられるか（Candidateはまだ1件も出ていない）
- 54 orientation全体の結果（primary 3件だけを測った）
- Browser Worker・他deviceでの効果
- Target Ideal precompute / prepared representationを追加した場合の効果（今回は実装していない。filterの残り約0.23 µs / raw solutionの内訳
  も今回は測っていない）
- `frontier_reduction_sort` / `state_generation` optimizationの効果
- primary Searchが完了するまでに必要な時間（30分以上には延長していない）
- run間ばらつき（A4 / A6とも各1回）

## 10. 次Phase recommendation

事前登録rule Rに従い、次の候補は **`bonus_depth_read`（held-aware Gogma `readReservedDepth()`）内部** である。A3のinner evidenceでは
`frontier_reduction_sort` がmeasured内の52〜58%、`state_generation` が31〜37%だった。filterが5%程度まで縮んだ現在の構成で、A3と同様の
inner section計測（またはその再利用可否の確認）から、`frontier_reduction_sort` / `state_generation` の局所化・設計へ進むのが妥当である。

- Target Ideal prepared representationは、filterがSearch wallの5〜6%まで縮んだため優先度は低い（Case Fではない）。
- filterを完全に除いても残り約91%は `bonus_depth_read` であり、30分内完了にはread側の大幅な改善が必要である。
- 最終ゴールはbenchmark高速化そのものではなく、Issue #154の「良いglobal Route集合を実用時間で探索する」ことである。read側の改善で
  primary Searchが実用時間で完了する見込みが立った時点で、54 orientation再評価またはC2.6-B（Candidate portfolio / 1,657 oracle coverage）
  へ戻る。

## 11. limitations

- Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。
- 各orientation 1回（retryなし）。A4 beforeも各1回。A4とA6は別process・別時刻の測定で、machine負荷の差は制御していない
  （prefix上の `bonus_depth_read` ratio 0.965〜0.995、notice ratio 0.98〜1.10 は、変更していないsectionのrun間差の目安）。
- section時間にはその時openなsectionに入ったawait / timer / GCが含まれる（A4と同じ）。
- 観測点は最後のheartbeat。以降のtail（4.1〜4.8秒）は未観測。
- 30分budget全体の値は各runの処理量が異なるため、主効果には使っていない。

## 12. 検証

- `npm run lint`、`npx tsc -b --force`、`npm test`（326 files / 5,324 tests pass）、`npm run build`、`git diff --check`
- formal run: measured HEAD `65a2a5c`（clean）で `scripts/run-planner-global-phase2c26a6.mjs` を実行し、同じHEADで
  `scripts/analyze-planner-global-phase2c26a6.mjs` によりRESULTを生成（`formal = true`、formal series failure 0）
- raw artifact（`PLANNER_GLOBAL_PHASE2C26A6_RAW.json.local`、`PLANNER_GLOBAL_PHASE2C26A6_RUN.local/`、`PLANNER_GLOBAL_PHASE2C26A6_LOG.local`）
  はcommitしていない
