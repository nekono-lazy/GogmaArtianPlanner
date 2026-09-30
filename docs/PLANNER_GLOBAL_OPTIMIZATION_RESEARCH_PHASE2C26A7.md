# Global Planner Research Phase 2-C2.6-A7（A6後bonus_depth_read内部runtimeの正式再局所化）

Refs #154。**Research only。Production計算変更は0件**（A6 measured HEAD `65a2a5c` 以降、`src` のProduction calculation sourceは
一切変わっていない。runnerとanalyzerの両方でfail-closedに確認）。`src/domain/search/bonusStream.ts` の計算ロジック、frontier
reduction、state generation、stableStringify / key生成、Map、sort、Reset parent lookup、Keep scan、prediction memo、
`ReservedBonusState`、Candidate semantics、Search ordering、extent、bounds、Planner、RNG、schema / version、UI、Persistenceは変更して
いない。新しいProduction seamも追加していない（A3の既存 `ReservedGogmaRuntimeObserver` とA4の既存 `SearchRuntimeObserver` を使っただけ）。

## 1. 結論

**A6後の現在mainで、outer `bonus_depth_read` と `readReservedDepth()` 内部6 sectionを同一run・同一clockで直接計時した結果、
3件ともinner 6 sectionで `bonus_depth_read` のほぼ全部（99.99〜100%）を説明でき、最大sectionは3件とも `frontier_reduction_sort`
（`bonus_depth_read` の53〜59%、Search wallの48〜54%）だった。次が `state_generation`（`bonus_depth_read` の29〜36%）。**

事前登録rule（§8）の判定: **Case F（`F_dominant_inner_section`、section = `frontier_reduction_sort`）**。次Phaseは
`frontier_reduction_sort` 内部の分離計時（§10）。本Phaseではoptimizationしていない。

| orientation | outcome | Search wall | `bonus_depth_read` | `bonus_ideal_filter` | `bonus_notice_scan` | inner 6 section合計 | **innerCoverageOfBonusDepthRead** | read remainder | dominant section |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| c6-p1 | timeout | 1,795.0 s | 1,654.1 s（92.2%） | 91.1 s（5.1%） | 49.6 s（2.8%） | 1,653.9 s | **0.9999** | 154 ms | `frontier_reduction_sort` |
| c13-p1 | timeout | 1,792.2 s | 1,626.4 s（90.8%） | 104.8 s（5.9%） | 60.8 s（3.4%） | 1,626.4 s | **1.0000** | 74 ms | `frontier_reduction_sort` |
| c14-p0 | timeout | 1,797.5 s | 1,643.9 s（91.5%） | 96.1 s（5.3%） | 57.3 s（3.2%） | 1,643.8 s | **0.9999** | 110 ms | `frontier_reduction_sort` |

（括弧内はSearch wall share。）

inner 6 section（上段: Search wall share、下段: `bonus_depth_read` share）:

| orientation | window_collection | support_evaluation | state_generation | solution_materialization | **frontier_reduction_sort** | exhaustion_scan |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c6-p1 | 9.9 s / 0.5% / 0.6% | 50.7 s / 2.8% / 3.1% | 471.2 s / 26.3% / 28.5% | 153.4 s / 8.6% / 9.3% | **967.4 s / 53.9% / 58.5%** | 1.2 s / 0.1% / 0.1% |
| c13-p1 | 10.9 s / 0.6% / 0.7% | 27.5 s / 1.5% / 1.7% | 578.9 s / 32.3% / 35.6% | 144.7 s / 8.1% / 8.9% | **863.5 s / 48.2% / 53.1%** | 0.9 s / 0.1% / 0.1% |
| c14-p0 | 9.9 s / 0.5% / 0.6% | 42.2 s / 2.4% / 2.6% | 507.1 s / 28.2% / 30.9% | 139.5 s / 7.8% / 8.5% | **943.9 s / 52.5% / 57.4%** | 1.1 s / 0.1% / 0.1% |
| 3件pooled | 30.7 s / 0.6% / 0.6% | 120.5 s / 2.2% / 2.4% | 1,557.2 s / 28.9% / 31.6% | 437.6 s / 8.1% / 8.9% | **2,774.9 s / 51.5% / 56.4%** | 3.2 s / 0.1% / 0.1% |

pooled: Search wall 5,384.7 s、`bonus_depth_read` 4,924.5 s（91.5%）、inner合計 4,924.1 s（coverage 0.9999）、read remainder 338 ms。

3件とも: Candidate delivered 0、trial 0、full Planner run 0、Ideal Bonus solution 0、semantic failure 0、outer / inner boundary
contract violation 0、primary Search未完了（30分timeout、OOM 0、process failure 0）。kill時のactive sectionは3件とも
`bonus_depth_read` 内（c6-p1 / c14-p0: `state_generation`、c13-p1: `frontier_reduction_sort`）。

## 2. authority

| authority | ファイル | SHA-256 | 用途 |
| --- | --- | --- | --- |
| C2.6-A RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json` | `dab2f27a1ca94e5db38279e3848f76d033710c38d6e838da227e36e78c67b171` | baseline / condition parity |
| C2.6-A2 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json` | `4bde9a5bcd84cc5e29d5dcf666f9eafb6bbb64d5f49aace1b15f36cf913fadc2` | A2 rule（chain） |
| C2.6-A3 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json` | `b5562342585899163c8d554bbc25ef6654bab12479ec403cf5d474f799beb3a2` | inner section taxonomy・過去比較（記述的のみ） |
| C2.6-A4 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json` | `15e415990fc48a77f2f890a52dd74e13f1ac349622cd266fc6cfe69b87e9d529` | outer section taxonomy・条件chain |
| C2.6-A5 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json` | `9d025a20cad23955adcb19fdee92d7c2e70eeb4b2429e875ddf5fb7bbdcd84c3` | 条件chain |
| **C2.6-A6 RESULT** | `docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json` | `a1b38a99ab08a99f536cdc675b75705e512622a27a555de38929839ddd81bf96` | **primary selection・現在のbottleneck authority**（formal、Case R） |
| A6 formal raw | `PLANNER_GLOBAL_PHASE2C26A6_RAW.json.local`（commitしない） | `feb1238d58e24d68bc9ee00a8cd68dcd8b904027f5868449e70df10062480bda` | semantic parity（A6 RESULTの `sources.run` と一致したときだけ使う） |
| Export | `gogma-artian-planner-backup_20260927015837.json`（commitしない） | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | calculation input |

A6 RESULTは `parsePhase2C26A6ResultAuthority()` でfail-closedに検証した: `provenance.formal = true`、
`calculationCodeChangedSinceMeasuredHead` が空、`formalSeriesValidation.valid`、`selectionValidation.valid`、`conditionParity.valid`、
`baselineParity.valid`、orientations 3、timeout 3 / completed 0 / OOM 0 / process failure 0、`primarySearchCompleted = 0`、
`semanticFailures = 0`（summaryと各行）、decision case `R_filter_reduced_timeout_remains`（summaryとconclusion）、A6の
`c26a5MeasuredHead` がA5 measured HEAD、selectionがA5 selectionと同一で3件・重複なし、`perOrientation` がselection順どおり、
**各primaryの最大outer categoryが `bonus_depth_read`（A6のcomparison行とA4-style行の両方で一致）かつshare ≥ 0.90**
（A6 evidence: 0.921 / 0.908 / 0.915）。SHA chainとして、A6が記録したC2.6-A / A2 / A3 / A4 / A5のSHA（provenance、runner記録、
`authorityShaChain`、A5のchain記録、A5が記録したA4のchain記録、sources）がすべて実際に読んだファイルと一致すること、A6の
`sources.run.sha256` が存在することを確認した。C2.6-A〜A5は既存parserで同じchainを検証した。どのRESULTもSearch / Planner
inputには使っていない。A3の結果は現在の結果として再利用していない（§9の記述的比較だけ）。

- formal measured HEAD / analysis HEAD: `b1319d0b128acf721c267fe948962617fbc7815d`（clean、計測後のcalculation / measurement code変更なし、`formal = true`、formal series failure 0）
- raw: `PLANNER_GLOBAL_PHASE2C26A7_RAW.json.local`（SHA-256 `1aac5a87da532bf2dcaa7a65f351825bb2efdf2dc1a131224112b94aaa87fd48`、commitしない）
- committed evidence: `docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json`

### 2.1 Production変更guard

runner（working tree込み）とanalyzer（gitのcommit間diff）の両方で、A6 measured HEAD（`65a2a5c`）→ A7 measured HEADの `src`
変更からResearch（`src/benchmarks/`）・test（`*.test.ts(x)`、`src/test/`）を除いた集合が **空** であることをfail-closedで確認した
（`validatePhase2C26A7NoProductionChange()`、登録値 `PHASE2C26A7_PRODUCTION_CHANGE = []`）。

## 3. 変更境界

| 役割 | ファイル |
| --- | --- |
| A6 authority parse・Production変更なしguard・条件parity・selection・kernel progress（2 observer / 1 clock） | `src/benchmarks/plannerGlobalPhase2C26A7.ts` |
| outer / inner接続・per-work join・formal validator・事前登録decision rule | `src/benchmarks/plannerGlobalPhase2C26A7Analysis.ts` |
| テスト | `src/benchmarks/plannerGlobalPhase2C26A7.test.ts` |
| runner / analyzer | `scripts/run-planner-global-phase2c26a7.mjs` / `scripts/analyze-planner-global-phase2c26a7.mjs` |

kernel childはA4のkernel progress（`createPhase2C26A4KernelProgress()`：lifecycle記録とSearch section tracker）とA3の
held-aware section tracker（`createPhase2C26A3RuntimeTracker()`）を **変更せずに** 組み合わせた（`createPhase2C26A7KernelProgress()`）。
両trackerは同じclock originを共有し、heartbeatは実行中clockを1回だけ読んで凍結し、その同じ時刻で両snapshotを取る（testで
「heartbeat 1回につきclock読み取り1回」を固定）。per-orientationの解析もA4の `analyzePhase2C26A4Kernel()` とA3の
`analyzePhase2C26A3Kernel()` をそのまま使い、A7 moduleは両者の接続だけを加えた。既存A3 / A4 / A5 / A6 RESULTは変更していない。

## 4. 条件

A6と同一（A6 RESULTの `conditions` とfield単位で一致を検証し、さらにA6のparity関数でA5条件、A5経由でA4 / A3 / C2.6-A / A2の条件chainも
再検証）。唯一の登録差分はSearch instrumentationである。

| 条件 | 値 |
| --- | --- |
| Export | 同一実利用Export（SHA-256上記） |
| concurrency | 1 |
| child heap / Node flags | 8,192 MB（`--max-old-space-size=8192` のみ、A6と同一） |
| orientation budget | 30分（1,800,000 ms）、retryなし、fresh Node child per orientation |
| yield | `setImmediate` |
| extent | Normal 4 / Gogma 235 / Skill 4 |
| trial bounds | `maxCandidateTrialsPerTarget = 2` / `maxPlannerReruns = 8` |
| Research maxPlanSteps | 20,000 |
| CalculationContext | `unknown-initial` / master 4 / `production-rng:c5-e7` / app schema 17（A6と同一） |
| lineage | empty |
| **Search instrumentation** | `onSearchRuntime = true`、`onGogmaReservedRuntime = true`、`onGogmaReservedDepth = false`、`onSkillReservedDepth = false`、`onWorkSettled = false` |
| CPU profiler | 使用しない |

baseline parity: baseline child（ordinary Production Planner）の54 orientation、summary、順序付きID、identity、metadataがC2.6-A
authorityと一致した。

selection: A6 RESULTの `selectionValidation.expected`（= A5 / A4 / A3 selection）をauthorityとし、sourceにIDを固定していない。
現在のbaselineから再導出したorientationのうち c6-p1、c13-p1、c14-p0 だけを各1回実行した（missing / duplicate / foreign /
non-primary / metadata mismatch 0）。

## 5. 測定方法

- outer: A4の `onSearchRuntime`。`bonus_depth_read` は `TargetSearchScheduler` が `readReservedDepth()` の呼び出し1回を挟む
  leaf section。inner: A3の `onGogmaReservedRuntime`。`readReservedDepth()` 内の `depth_started` / 6 section / `depth_completed`
  の境界。時刻はどちらもResearch側 `performance.now()`（Domainはclockを読まない）。
- 同じrun・同じ観測点で比較する。観測点はtimeoutでは最後のheartbeat（2 snapshotは同一frozen clock。outer / innerの観測時刻は
  3件とも完全一致: 1,796,617.3 / 1,793,869.2 / 1,799,156.4 ms）。active sectionのその時点までの経過時間も含める（A3 / A4と同じ）。
- **innerCoverageOfBonusDepthRead = sum(inner 6 sections) / outer `bonus_depth_read`**。
- **read remainder = `bonus_depth_read` − sum(inner 6 sections)**。さらに
  - depth境界内・section外（`depth_started`→`depth_completed` の中で6 sectionに入らない時間）
  - depth境界外（`bonus_depth_read` 内で `depth_started` 前 / `depth_completed` 後: cursor claim、stream lookup、promise解決）

  に分けた。
- Search全体に対するshareと `bonus_depth_read` 内に対するshareを分けて報告する（A3のようにSearch全体だけを分母にしない）。
- per-work join: primary Searchのk番目の完了済みBonus depth work（outer）とk番目の完了済みheld-aware depth read（inner）を1対1に
  対応させ、depthの一致を検証した上でwork単位のcoverageを出した。
- **semantic parity**: 各orientationについて、A7とA6 formal rawの完了済みwork summaryをseq順に並べ、共通prefixの各recordの
  `{targetOrdinal, section, work, counts}` が完全一致することを要求した（inner observer追加でSearchの計算内容が変わらないことの
  実runでの確認）。共通prefix 750 / 336 / 610 recordで全件一致、semantic failure 0。

## 6. inner coverageとread remainder

| orientation | coverage | read remainder | うちdepth境界内・section外 | うちdepth境界外 | per-work coverage（min / median / max、joined works） |
| --- | ---: | ---: | ---: | ---: | --- |
| c6-p1 | 0.9999 | 154.1 ms（`bonus_depth_read` の0.009%） | 66.4 ms | 87.7 ms | 0.9455 / 0.9999 / 0.9999（742） |
| c13-p1 | 1.0000 | 74.0 ms（0.005%） | 32.6 ms | 41.4 ms | 0.9596 / 1.0000 / 1.0000（326） |
| c14-p0 | 0.9999 | 109.6 ms（0.007%） | 52.7 ms | 56.8 ms | 0.9460 / 0.9999 / 1.0000（622） |

- 既存6 sectionで `bonus_depth_read` をほぼ完全に説明できる。A3で「未計測30%」だった部分は、A4で確認したとおり
  `bonus_depth_read` の外（filter / notice scan等）であり、`readReservedDepth()` の中にはほとんど残っていない。
- per-work minが0.95前後になるのは、depth単位の時間が小さいwork（ms未満〜数ms）で固定overheadが相対的に大きく見えるため
  （remainderとraw solution数の相関は 0.04 / 0.04 / 0.04 でほぼ無相関）。
- outer works数（join）とinner depths数は3件とも一致（742 / 326 / 622）し、depthも全件一致した。

## 7. 規模とunit ratio（記述的、completed depth recordごと）

| | c6-p1 | c13-p1 | c14-p0 |
| --- | ---: | ---: | ---: |
| raw solution（30分内） | 354,391,192 | 442,346,096 | 414,459,456 |
| Bonus depth works | 741 | 326 | 622 |
| streams / max depth | 8 / 94 | 5 / 68 | 9 / 71 |
| generatedStates合計 | 354,661,168 | 442,346,096 | 414,459,456 |
| frontierStatesAfter合計 | 13,270,435 | 7,553,032 | 11,501,047 |
| 最大generated（1 depth） | 642,573（s0 d3） | 1,525,164（s0 d3） | 788,476（s0 d3） |
| 最大frontierAfter（1 depth） | 22,516（s0 d78） | 24,688（s0 d23） | 23,227（s0 d66） |
| state_generation / generatedState（median） | 1,322 ns | 1,306 ns | 1,227 ns |
| state_generation / (position × frontierBefore)（median） | 241.5 ns | 390.7 ns | 274.7 ns |
| frontier_reduction_sort / generatedState（median） | 3,186 ns | 2,100 ns | 2,461 ns |
| frontier_reduction_sort / frontierStateAfter（median） | 76.7 µs | 120.3 µs | 89.4 µs |
| solution_materialization / (generatedState × depth)（median） | 10.1 ns | 10.1 ns | 9.7 ns |
| corr(generatedStates, state_generation) | 0.894 | 0.976 | 0.699 |
| corr(generatedStates, frontier_reduction_sort) | −0.069 | 0.111 | −0.108 |
| corr(frontierStatesAfter, frontier_reduction_sort) | 0.720 | 0.494 | 0.912 |
| corr(depth, solution_materialization) | 0.827 | 0.854 | 0.892 |

- `state_generation` はgeneratedStatesとよく相関し（0.70〜0.98）、1 generated stateあたり約1.2〜1.3 µs。
- `frontier_reduction_sort` はgeneratedStatesとはほぼ無相関（−0.11〜0.11）で、reduction後のfrontier規模（frontierStatesAfter）と
  相関する（0.49〜0.91）。reduction後の1 frontier stateあたり中央値77〜120 µsと大きい。**ただし、これはsection全体の時間と件数の
  記述的相関であり、どの処理（key生成 / representative比較のstableStringify / Map / array materialization / sort）が主因かは
  測っていない。** A7では主因を断定しない。
- `solution_materialization` はdepthとよく相関し（0.83〜0.89）、generatedState × depthあたり約10 nsで一定に近い
  （`reservedBonusSteps()` のresult chain走査と整合するが、内部は測っていない）。
- predictionはKeep約2.8〜2.9万回、Reset約250回、Skill 4〜5回、Normal 12回（CountingRngEngine）。sampled max heap 4.5 / 5.1 / 4.7 GB、
  RSS 5.0 / 5.5 / 5.3 GB（8 GB heap limitに対してOOMなし）。

## 8. 事前登録decision rule

formal run前にcommit（`b1319d0`、`PHASE2C26A7_DECISION_RULE`）。registered primary count 3、majority 2、coverage threshold 0.90。
dominant section = inner 6 sectionのwall最大値。A3で `frontier_reduction_sort` が最大だったことはruleにhard-codeしていない。

1. **U** `inner_coverage_gap`: 2件以上で innerCoverageOfBonusDepthRead < 0.90 → optimizationへ進まず、read remainderを局所化
2. **F** `dominant_inner_section`: 2件以上で coverage ≥ 0.90 かつ同じdominant section → そのsectionを次のoptimization / 詳細局所化候補とする
3. **M** mixed: それ以外 → optimizationへ進まず、context差を調査

結果: coverage 0.9999 / 1.0000 / 0.9999（3 / 3で ≥ 0.90）、dominant section 3件とも `frontier_reduction_sort` →
**Case F（section = `frontier_reduction_sort`）**。

## 9. A3との記述的比較（absolute wallは比較しない）

A3はA5 / A6の最適化前で、instrumentationも進行量も異なるため、absolute wall・30分進行量は比較しない。6 section合計に対する
構成比だけを並べる。

| section | c6-p1 A3 → A7 | c13-p1 A3 → A7 | c14-p0 A3 → A7 |
| --- | ---: | ---: | ---: |
| frontier_reduction_sort | 57.7% → 58.5% | 52.1% → 53.1% | 53.6% → 57.4% |
| state_generation | 31.2% → 28.5% | 36.9% → 35.6% | 35.4% → 30.9% |
| solution_materialization | 7.6% → 9.3% | 8.4% → 8.9% | 7.8% → 8.5% |
| support_evaluation | 2.8% → 3.1% | 1.8% → 1.7% | 2.4% → 2.6% |
| window_collection | 0.6% → 0.6% | 0.8% → 0.7% | 0.6% → 0.6% |
| exhaustion_scan | 0.1% → 0.1% | 0.1% → 0.1% | 0.1% → 0.1% |

inner 6 sectionの構成順位（frontier_reduction_sort > state_generation > solution_materialization > その他）はA3と同じだった。
ただしA7ではこれがouter `bonus_depth_read` の99.99%以上、Search wallの約91%の中の構成として直接確認された点が異なる。

A6との関係: A6は「`bonus_depth_read` が現在のouter bottleneck（91〜92%）」というselection authority。A7のouter share
（92.2% / 90.8% / 91.5%）はA6（92.1% / 90.8% / 91.5%）と同水準だが、A7はinstrumentationが多いため、A6との速度差・進行量差の
結論は出さない。

## 10. 次Phase recommendation

Case Fに従い、次の候補は **`frontier_reduction_sort`** である。本Phaseではoptimizationしていない。

現在の実装（`generateReservedDepth()`、`src/domain/search/bonusStream.ts`）の `frontier_reduction_sort` sectionは次の処理を含む:

```ts
const byKey = new Map<string, ReservedBonusState>()
for (const state of generated) {
  const key = `${state.position}\u0000${state.familyLayoutKey}`
  const current = byKey.get(key)
  if (!current || compareReservedRepresentative(state, current) < 0) byKey.set(key, state)
}
set.frontier = [...byKey.values()].sort(compareReservedFrontier)
```

`compareReservedRepresentative()` は `lastResetDepth` 比較の後、同値なら `stableStringify(left.bonuses)` /
`stableStringify(right.bonuses)` を比較する。`compareReservedFrontier()` は `position` の後 `familyLayoutKey` を比較する。

次Phaseで分離計時する候補（測定なしに主因を決めない）:

1. frontier key生成（`${position}\0${familyLayoutKey}` の文字列連結、generated stateごと）
2. `Map` lookup / set
3. representative比較 `compareReservedRepresentative()` の回数と、そのうち `stableStringify(left.bonuses)` / `stableStringify(right.bonuses)`
   に到達した回数・時間
4. frontier array materialization（`[...byKey.values()]`）
5. `compareReservedFrontier` sort（件数 = frontierStatesAfter、比較回数）
6. GC（section内でopenなsectionに計上される。reduction後frontierとgenerated statesの保持に伴うallocation）

A7のunit ratioでは、section時間はgeneratedStatesよりreduction後frontier規模と相関した（§7）。これは「1 generated stateあたりの
key生成 / Map操作」よりも「frontier規模に依存する処理（例: collision時のrepresentative比較、sort、GC）」の寄与を示唆しうるが、
section内部を測っていないため、どれが主因かは次Phaseの計測で確かめる。

第2候補の `state_generation`（`bonus_depth_read` の29〜36%）は、次の順で詳細化候補とする（本Phaseでは方式変更しない）:
legal position iteration（positions sort含む）、Reset parent lookup（`set.frontier.find(...)`）、position × frontier のKeep scan、
`windows[index].has(position)`、prediction lookup / calls（`predictReset` / `predictKeep` memo）、`advanceGogmaCounter`、
`reservedGeneratedState()`（family layout key生成とresult node生成）、`execution.checkpoint()`（setImmediate yieldを含む）。
state_generationはgeneratedStatesとよく相関し、1 generated stateあたり約1.2〜1.3 µs、position × frontierBeforeあたり約0.24〜0.39 µsだった。

最終ゴールはbenchmark高速化そのものではなく、Issue #154の「良いglobal Route集合を実用時間で探索する」ことである。
`frontier_reduction_sort` と `state_generation` を合わせてSearch wallの約80%を占めるため、read側の改善でprimary Searchが実用時間で
完了する見込みが立った時点で、54 orientation再評価またはC2.6-B（Candidate portfolio / 1,657 oracle coverage）へ戻る。

## 11. 言えること / 言えないこと

### 言えること

- A6後の現在mainでも、primary 3件はいずれも30分以内にprimary Searchを完了せず、Candidate・Ideal Bonus solutionは0件である。
- outer `bonus_depth_read` はSearch wallの91〜92%を占め、その99.99%以上がinner 6 sectionで説明できる（read remainderは74〜154 ms）。
- 3件とも最大のinner sectionは `frontier_reduction_sort`（`bonus_depth_read` の53〜59%、Search wallの48〜54%）、次が `state_generation`
  （29〜36%、Search wallの26〜32%）、`solution_materialization` が約9%。
- held-aware section observerを追加しても、A6 formal runと共通prefixの全work record（計1,696件）のidentity / countsは完全一致した
  （semantic failure 0）。Search / kernel levelのobserver neutralityもtestで確認した。

### 言えないこと

- `frontier_reduction_sort` 内のどの処理（key生成、Map、representative比較・stableStringify、array materialization、sort、GC）が主因か
- `state_generation` 内のどの処理が主因か
- optimizationした場合の効果、primary Searchが完了するまでに必要な時間（30分以上には延長していない）
- A6 / A3との速度差・進行量差（instrumentationが異なるため比較しない）
- 1,657-step oracleに近いRouteを見つけられるか、54 orientation全体、Browser Worker・他device
- run間ばらつき（各1回）

## 12. limitations

- Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。
- 各orientation 1回（retryなし）。
- A7はA6よりinstrumentationが多い（inner section境界ごとのobserver呼び出し、section開始ごとのdurable write + IPC）。
  このoverheadはその時openなsectionへ計上される。absolute wallはA6 / A3と比較しない。
- section時間にはその時openなsectionに入ったawait（`execution.checkpoint()` のsetImmediate yield）、その間に走るtimer（heartbeat /
  memory sample）、GCが含まれる。
- 観測点は最後のheartbeat。以降のtail（数秒）は未観測。

## 13. 検証

- `npm run lint`、`npx tsc -b --force`、`npm test`（327 files / 5,335 tests pass）、`npm run build`、`git diff --check`
- formal run後に変更したのはA7 test fileの型注釈1か所だけ（`*.test.ts` はpost-hoc allowed。calculation / measurement codeは不変）
- formal run: measured HEAD `b1319d0`（clean）で `scripts/run-planner-global-phase2c26a7.mjs` を実行し、同じHEADで
  `scripts/analyze-planner-global-phase2c26a7.mjs` によりRESULTを生成（`formal = true`、formal series failure 0）
- raw artifact（`PLANNER_GLOBAL_PHASE2C26A7_RAW.json.local`、`PLANNER_GLOBAL_PHASE2C26A7_RUN.local/`、`PLANNER_GLOBAL_PHASE2C26A7_LOG.local`）
  はcommitしていない
