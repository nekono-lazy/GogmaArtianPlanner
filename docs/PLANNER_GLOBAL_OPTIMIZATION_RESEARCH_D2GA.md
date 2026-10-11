# Global Planner Research D2-G-A（K3 Searchメモリ消費原因調査・非formal診断）

Refs #154。Research-only・**非formal**。基準main: `e292915b30833518fe72fc98378a609a27b87702`（PR #234マージ後）。

本書はD2-F-B（[D2-F-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2FB.md)、正式RESULT `docs/PLANNER_GLOBAL_D2F_RESULT.json`）で
`DSC-K3-L2` が `out_of_memory` になった原因を調べる診断である。D2-E / D2-Fの計測条件・formal RESULTは変更しない。
本書の計測値はformal RESULTへ混入させず、D2-E-B / D2-F-Bの正式値は参照値としてだけ使う。

Production Search / Planner / RNG、Search ordering、Candidate探索範囲、UI / Persistence / schemaは変更しない。
K3 L2の再計測、heap上限を上げた試行、K3 Candidateの存在 / 不存在の断定は行わない。oracle / population authorityは読まない。
Phase 2-C2.5系の成果物は読まない。

## 1. 目的・範囲

- 目的: K3 context（t03、support `54dd2b4e` / `92d87b90` / `e396d352`、reservation `fnv1a32:6e2a0744`）のPlanner Alternative Search
  がK2 context（D2-E、reservation `fnv1a32:fd85c864`）より大きくメモリを使う主因を、Search実装と計測値から特定する
- 範囲: (a) Search実装のメモリ保持構造の静的調査、(b) 既存read-only instrumentationを付けたK2 / K3 × L0 / L1の非formal再実行4件、
  (c) D2-F-Bの `DSC-K3-L2` 既存evidence（RESULT、process outcome、stderr tail、memory sample）の読み取り専用分析
- 範囲外: Searchの改善実装、新しいformal measurement、K3 L2の再実行、Issue #154のClose

## 2. 入力

| 入力 | 値 |
| --- | --- |
| Export | `gogma-artian-planner-backup_20260927015837.json`（19,424,064 bytes、SHA-256 `cc35fb5b…1e6b`。D2-E / D2-Fの登録値。commitしない） |
| K2 context | D2-E formal run dir `.local/d2e-k2-formal2.run/` の `DSC-K2-L0.task.json` / `DSC-K2-L1.task.json`（読み取り専用） |
| K3 context | D2-F formal run dir `.local/d2f-k3-formal.run/` の `DSC-K3-L0.task.json` / `DSC-K3-L1.task.json`（読み取り専用） |
| L2 evidence | `docs/PLANNER_GLOBAL_D2F_RESULT.json`、`.local/d2f-k3-formal.run/discovery.jsonl`（process outcome・stderr tail）、`DSC-K3-L2.memory.jsonl`、比較用に `.local/d2e-k2-formal2.run/DSC-K2-L2.*` |
| Production RNG | `production-rng:c5-e7`、CalculationContext `{ unknown-initial, 4, production-rng:c5-e7, 17 }`、Research `maxPlanSteps = 20000` |
| Search input | formal taskの `targetWeaponId` / supports / extentから、formal childと同じ `phase2c27bResolveSupportContext()` で再導出し、formal taskのcontext record（reservation body / digest、origin digest `fnv1a32:ff018910`、excluded Route keys、`O_t`、supports）と照合する。不一致ならSearchを始めない（`context_drift`） |

診断コード: `src/benchmarks/plannerGlobalD2GA.ts`（module）、`src/benchmarks/plannerGlobalD2GA.test.ts`（test）、
`scripts/run-planner-global-d2ga.mjs`（runner）、`scripts/analyze-planner-global-d2ga.mjs`（分析）。いずれもResearch専用で、Productionからimportされない。

## 3. 計測プロトコル（計測前に記載。結果を見て変更しない）

### 3.1 比較対象

| # | unit | context | rung | extent（Normal / Gogma / Skill） |
| --- | --- | --- | --- | --- |
| 1 | `K2-L0` | K2 | L0 | 4 / 235 / 4 |
| 2 | `K3-L0` | K3 | L0 | 4 / 235 / 4 |
| 3 | `K2-L1` | K2 | L1 | 8 / 235 / 256 |
| 4 | `K3-L1` | K3 | L1 | 8 / 235 / 256 |

対象Targetはt03に固定する。この順で1件ずつ実行する。

### 3.2 実行条件

- 各unitは独立した新しいchild process（Process間でSearch stateを引き継がない）、concurrency 1
- Node.js v24.19.0、同じExport・Production RNG Engine・origin・reservation・Search extent（formal taskのものを読み、registered ladderとの一致を確認）
- child heap上限 `--max-old-space-size=12288`（formal D2-E / D2-Fと同じ）、child wall上限15分、診断全体90分（残り時間がchild上限より短ければそれを上限にする）
- retry・fallbackなし。GCは強制しない（`--expose-gc` を使わない）
- 計測は非formal。K3 L2は実行しない

### 3.3 記録する情報

| 情報 | 取得方法（すべてread-only） |
| --- | --- |
| wall time、Search所要時間 | child内 `performance.now()` |
| heapUsed / heapTotal / RSS / external | `process.memoryUsage()` を250 ms毎（formalと同じ間隔）。最大値は全sample、時系列は1 s毎に間引き、最大1,200点（超えたら半分に間引く） |
| 生存heapの近似 | `PerformanceObserver('gc')` でmajor GC（mark-compact）直後の `heapUsed` を記録（GCを起こさず観測するだけ） |
| settled work数 | 既存 `onWorkSettled`（`createPlannerAlternativeSearchObserver()`） |
| Skill / Gogma depth | 既存 `onSkillReservedDepth` / `onGogmaReservedDepth`。depth別集計（既存observer）に加え、stream別の保持state数（Skill）とlive frontier（Gogma）を集計 |
| section別時間 | 既存 `onSearchRuntime` を既存 `createPhase2C26A4RuntimeTracker()` で集計（inclusive / exclusive、件数、depth workのcounts） |
| channel別 | depth workのcounts（`retainedCountAfter`、`subscriberCount`）からchannel別の保持Ideal解数・購読数 |
| prediction呼び出し | 既存 `createCountingRngEngine()`（同じ入力で1回ずつ転送し、元の結果を返す） |
| 終了理由・delivery数 | `visitPlannerAlternativeCandidates()` のsummary |
| conversion Skill位置数 | Productionの `nextOperationPositions()` をreservationに適用（predictionなし） |

visitorは配達されたkeyのSHA-256だけを記録し、formalのL0 / L1（両context）は配達0件なので、1件でも配達があればparity mismatchとしてそのunitを止める。
instrumentationはイベント列・Route body・state本体を保存しない（集計値のみ）。

### 3.4 smoke

計測前に1回だけ、`K2-L0` を別run dirで `--smoke` 実行し、runner / child / recordの経路だけを確認する。smokeの値は比較・分析に使わない。

### 3.5 instrumentationの影響（限界）

`onSearchRuntime` は全section境界で `performance.now()` とframe objectの割り当てを行うため、wall timeは未instrumentedのformal値より長く、
GCの頻度・heapの最大値もformal値とずれる。formal値（未instrumented）とのwall / heap比を報告し、時間・メモリの絶対値はformal値を優先する。
instrumentationのあり・なしで配達key列・終了理由・summary・prediction呼び出し数が一致することは、Fake / 小規模fixtureのtest
（`plannerGlobalD2GA.test.ts`）で確認する。実Exportでのあり・なし比較は、formal recordの終了理由・配達数（0件）との一致で代える。

## 4. 静的コード調査

コードから確認できた事実（F）と仮説（H）を区別する。

### 4.1 pending work（`SearchWorkQueue`、`TargetSearchScheduler`）

- F: queueは `lowerBound` の最小heap。settleされた項目は取り除かれる。積まれるのは (1) Route base登録、(2) channelごとの次のstream depth
  （1 channelにつき同時に1件。`next(depth + 1)` はそのdepthのsettle後に積む）、(3) lazy Crossのcell（1 rowにつき同時に高々1件）、
  (4) waiting rowのwake-up（1 batchにつき同時に1件）
- F: したがってpending数は概ね「channel数 + Route baseごとのIdeal Bonus row数 + batch数」で抑えられ、Cartesian productを先に展開しない
- H: pending work自体がGB単位を占めるには、Ideal Bonus row × Route base数が非常に大きい必要がある。実測のchannel / row数で判断する

### 4.2 Skill stream（`skillStream.ts`、held-aware `readReservedDepth()`）

- F: streamは開始Skill Counterごと（`reservedSets`）。各streamは **全depthのstate配列を `set.depths` に保持し続ける**（`set.depths.push(set.frontier)`、解放なし）。
  scheduler側はchannelごとに各depthを1回、昇順に読むだけなので、過去depthの配列は再読されない
- F: 1 depthのstateは絶対位置でdedupe（1位置1 state）。stateは直前stateのnodeへ `previous` で連結される履歴を持つ
- F: `windows`（`nextFrom` → 合法位置配列）をstreamごとにmemo。prediction memo（位置 → Skills）はTarget単位で共有
- F: heldの連続区間が長いと、1 stateの合法位置が区間末尾まで広がる。区間がwindow上限（`origin + M (+1)`）を越えると、各depthのstate数は
  「残りwindow幅」に比例し、1 depthのtransition数はその2乗に比例する
- F: **conversionはheld Skill位置を越えて任意の合法位置に置ける**（`conversionSkillPositions()`）。conversion位置ごとに別Route baseが登録され、
  別の開始Skill Counter（= 別Skill stream / channel）になる。reservationとextentからの計算値:

  | context | L0（M = 4） | L1（M = 256） | L2（M = 1500） |
  | --- | ---: | ---: | ---: |
  | K2（Skill held 341〜343） | 2 | 2 | 2 |
  | K3（Skill held 341〜648） | 3 | **255**（window末尾で打ち切り） | **306** |

- H: K3のL1 / L2では、Skill stream数（≈ conversion位置数）× streamごとの保持state数（全depth保持）が急増し、これがL1以降のメモリ増の主要候補

### 4.3 Gogma stream（`bonusStream.ts`、held-aware `readReservedDepth()`）

- F: streamはRoute baseの `bonusStreamBaseKey`（開始Gogma位置・amendment policy・family layout）ごと。同じNormal offsetのconversion位置違いは
  同じGogma開始位置・同じlayoutなので **1 streamを共有する**
- F: single-pass。返したdepthの生解はstreamが保持しない。保持するのは縮約後frontier、`windows` memo、unsupported通知だけ。frontierは
  `(絶対位置, family layout)` で縮約され、異なる位置のstateは統合されない
- F: Reset予測memo（位置ごと）とKeep予測memo（位置 × layoutごと）はTarget単位で保持され続ける
- F: Gogma held区間は55から連続し、最初の非held位置はK2で78、K3で126。1 depthの生成数は「合法位置 × その位置へ届くfrontier state数」で、
  heldを抜けた後も位置の広がり（K2約23、K3約71）はdepthを進んでも縮まらない
- H: L0の差（Skill M = 4でSkill側はほぼ無関係）はGogma側の位置幅（約3倍）とfrontier幅の差が主要候補

### 4.4 Skill × Gogma cross composition（`lazyIdealCross.ts`）

- F: Route baseごとに1つ。そのbaseへ配られたIdeal Bonus解（row）とIdeal Skill解（column）の配列、`nextColumn`、waiting heapを保持する。
  Ideal以外の解はcrossへ入らない
- F: channelの `retained` は公開済みIdeal解を全て保持する（Planner Alternative policyは同じ結果でも絶対位置ごとに別解として公開する）。
  後から登録されたbaseへ再配布するため
- H: Ideal解の数が少なければcrossの保持量は小さい。実測（`retainedCountAfter`、`subscriberCount`）で判断する

### 4.5 same-cost closure・delivery前buffer

- F: `buffered` は同一costの非null Candidateだけを保持し、queueの次の `lowerBound` がそのcostを超えた時点で配達する
- F: formalのL0 / L1（K2 / K3とも）は配達0件・除外0件なので、bufferへCandidateが入ったことは一度もない（入れば配達か除外のどちらかで数えられる）
- F: L2ではK2が2件配達しており、K3 L2のbuffer状態はevidenceが無い

### 4.6 過去の深度・経路・予測結果の保持

| 構造 | 寿命 | 正当性に必要か |
| --- | --- | --- |
| Skill `set.depths`（全depthのstate配列） | Search終了まで | 過去depthは再読されない（F）。解放可能候補（H: 効果量は未計測） |
| Skill / Gogmaのstate履歴（`previous` 連結） | 生存stateから到達可能な間 | 将来stateのoperations再構成に必要（F） |
| Skill / Gogma `windows` memo | Search終了まで | 再計算可能なmemo（F） |
| Skill prediction memo、Gogma Reset / Keep memo | Search終了まで | prediction回数を抑える既存契約（F）。位置 × layoutで増える |
| channel `retained`、lazy Crossの配列 | Search終了まで | 後から来るbase・未openのcellのために必要（F） |
| `seen` / `skippedExcludedRouteKeys` | Search終了まで | 配達keyだけ（L0 / L1は空） |

## 5. 計測結果（K2 / K3比較）

（計測後に記載）

## 6. L2 OOMの分析（既存evidence、読み取り専用）

（計測後に記載）

## 7. 確認できた事実・未検証の仮説

（計測後に記載）

## 8. 次の方針の比較と推奨

（計測後に記載）

## 9. Productionへの影響

Production source、Search / Planner / RNG semantics、Worker、UI、Persistence、schema / version、Production default / boundsは変更していない。
既存formal RESULT（D2-E / D2-F）・module・recordも変更していない。
