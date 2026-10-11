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


## 5. 計測結果（K2 / K3比較、非formal）

### 5.1 実行の記録

| 項目 | 値 |
| --- | --- |
| protocol commit | `8a991e3`（本書 §1〜§4 と診断コードを計測前にcommit。計測時Working Tree clean、HEAD同一） |
| smoke | `K2-L0` 1回（`.local/d2ga-smoke.run/`）。経路確認のみで、以下の比較には使っていない |
| 診断run | `.local/d2ga-diag.run/`、出力 `.local/PLANNER_GLOBAL_D2GA_DIAG.json.local`、分析 `.local/PLANNER_GLOBAL_D2GA_ANALYSIS.json.local`（いずれもcommitしない） |
| 結果 | 4 unitとも `completed`、全体約10分（90分上限・15分child上限は未到達、retry・fallbackなし） |
| context照合 | 4 unitとも `context_drift` なし（reservation `fnv1a32:fd85c864` / `fnv1a32:6e2a0744`、origin `fnv1a32:ff018910`）。origin Counter: Skill 341、Gogma 55 |
| parity（formal recordとの一致） | 4 unitとも `stopped_by_search_extent_bound`、配達0件・除外0件（formalと同じ）。section trackerの契約違反0 |
| 環境 | Node v24.19.0、AMD Ryzen 7 9700X、メモリ33.4 GB（formalと同じマシン） |

計測後に追加・変更したのは分析専用のコードだけである（`d2gaFormalSegments()` の単位を正式文書と同じ10^9 bytesへ統一、§6.2のSkill stream規模モデル
`d2gaHeldAwareSkillStreamCounts()`、分析script）。いずれも診断childが使う経路ではなく、プロトコル（§3）は変更していない。
また、計測時のmoduleはExportのSHA-256をliteralで持っていたが、oracle isolation test（Export hashをoracle以外のResearch sourceに置かない）に従い、
計測後にD2-F-B start attestationの `observedInputs.export.sha256`（同じ値）を読む形へ変えた。照合する値と判定は変わらない。

### 5.2 時間・メモリ（GB = 10^9 bytes）

| unit | child wall s（formal） | Search s | heapUsed peak GB（formal） | heapTotal peak GB | RSS peak GB | major GC直後heap 最大 / 最終 GB | scavenge合計 s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| K2-L0 | 43.5（42.5） | 40.8 | 1.60（1.38） | 1.69 | 1.83 | 0.50 / 0.50 | 1.8 |
| K3-L0 | 180.3（149.8） | 177.3 | 3.91（4.00） | 4.52 | 4.74 | 0.98 / 0.67 | 12.7 |
| K2-L1 | 59.7（63.0） | 56.7 | 1.97（1.95） | 2.06 | 2.22 | 0.68 / 0.68 | 2.6 |
| K3-L1 | 297.8（246.1） | 294.4 | 7.35（7.40） | 8.26 | 8.57 | 1.92 / 0.90 | 30.5 |

- instrumentationのoverheadは、wallでK2 0.95〜1.02倍、K3 1.20〜1.21倍（formal比）。heapUsed peakはformal値とほぼ一致した（K2-L0のみ+0.2 GB）
- **heapUsed peakと生存heapは大きく乖離する**。K3-L1のheapUsed peak 7.35 GBに対し、major GC直後のheapUsedは最大1.92 GB、Search終了直前の
  最後のmajor GC直後は0.90 GB。K3-L0も3.91 GBに対し0.98 GB。L0 / L1のformal heap peak（4.00 / 7.40 GB）の大半は、まだmark-compactで
  回収されていない短命objectである（major GCは4〜43回と少なく、old generationへ昇格したgarbageが次のmark-compactまで残る）
- major GC直後の値は `PerformanceObserver` のcallback時点の `heapUsed` で、GC完了からcallbackまでの割り当てを含むため上振れしうる（近似値）

### 5.3 処理量

| unit | settled work | checkpoint（約、yield×50） | Gogma stream | Gogma生成state | Gogma frontier最大 / stream | Skill stream | Skill保持state | Skill transition | Ideal Bonus解 / Ideal Skill解 | composition |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| K2-L0 | 1,865 | 4.16M | 8 | 4,154,615 | 3,948 | 3 | 6 | 6 | 0 / 0 | 0 |
| K3-L0 | 1,627 | 22.37M | 7 | 22,346,996 | 11,645 | 3 | 7 | 7 | 0 / 0 | 0 |
| K2-L1 | 3,553 | 6.24M | 12 | 6,231,639 | 3,948 | 3 | 1,014 | 1,014 | 21 / 0 | 0 |
| K3-L1 | 35,189 | 40.74M | 11 | 35,117,644 | 11,645 | **255** | **2,795,905** | **177,556,414** | 0 / 0 | 0 |

- prediction呼び出し: Keep 25,025〜26,241回、Reset 231〜232回、Normal 4 / 8回、Skill 3 / 255回で、**K2とK3でほぼ同じ**（memoは位置 × layoutで共有される）
- Gogma frontierのfamily layout数（stream最大）はK2 196、K3 195で同じ。frontier幅の差は「位置」の広がりによる（K3-L1のdepth 164で11 stream合計127,828 state、748位置）
- conversion Skill位置: K2 2 / 2、K3 3 / 255（L0 / L1。§4.2の計算値どおり）。Skill channelの購読数（Route base数の目安）はK2-L1 20、K3-L1 2,008
- composition（Skill × Gogma cross）は全unitで0件。K3 L0 / L1ではIdeal Bonus解もIdeal Skill解も1件も公開されず、lazy Crossとchannel `retained` は空だった。
  same-cost closureのbufferにCandidateが入ったことも無い（配達・除外とも0）

### 5.4 倍率（K3 / K2）

| rung | wall | Search | heapUsed peak | major GC直後最大 | RSS peak | settled work | checkpoint | Gogma生成state | Skill保持state |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| L0 | 4.14（formal 3.52） | 4.35 | 2.44（formal 2.90） | 1.96 | 2.59 | 0.87 | 5.38 | 5.38 | 1.17 |
| L1 | 4.99（formal 3.91） | 5.19 | 3.73（formal 3.79） | 2.82 | 3.86 | 9.90 | 6.53 | 5.64 | 2,757 |

### 5.5 section別時間（exclusive、上位）

| unit | 上位section |
| --- | --- |
| K2-L0 | `bonus_depth_read` 38.0 s、`bonus_ideal_filter` 1.9 s、`bonus_notice_scan` 0.9 s |
| K3-L0 | `bonus_depth_read` 164.2 s、`bonus_ideal_filter` 8.8 s、`bonus_notice_scan` 4.1 s |
| K2-L1 | `bonus_depth_read` 53.4 s、`bonus_ideal_filter` 2.2 s、`bonus_notice_scan` 1.0 s |
| K3-L1 | `bonus_depth_read` 270.2 s、`bonus_ideal_filter` 12.1 s、`skill_depth_read` 6.4 s |

時間の大半はGogma（held-aware Bonus stream）のdepth読み取り（state生成と、生成solutionごとの `steps` 配列の組み立て）である。
K3-L1のSkill側は1.78億transitionでも `skill_depth_read` 6.4 sで、時間への寄与は小さい。**時間の増大はGogma側、K3固有の保持の増大はSkill側**に現れた。

### 5.6 メモリ時系列（major GC直後heapUsed、GB）

- K3-L0: 1 s 0.25 → 50 s 0.43 → 103 s 0.85 → **121 s 0.98** → 143 s 0.91 → 163 s 0.67（Gogma frontierが広がるdepth中盤で増え、frontierが狭まると減る）
- K3-L1: 1 s 0.25 → 62 s 0.69 → 121 s 1.34 → 191 s 1.87 → **220 s 1.92** → 262 s 1.56 → 292 s 0.90
- K2-L0: 0.25 → 0.27 → 0.50（4回）、K2-L1: 0.29 → 0.21 → 0.51 → 0.68（4回）

## 6. L2 OOMの分析（既存evidence、読み取り専用）

### 6.1 D2-F-B `DSC-K3-L2` のevidence

- process: exit code 134、`out_of_memory`、2,662.0 s（wall上限60分未到達）、IPC最終sampleでheapUsed最大10.40 GB / RSS最大13.46 GB
- stderrの最後のGC（V8 trace、MB = 2^20 bytes）: `Mark-Compact 9952.1 (12352.9) -> 9836.8 (12323.2) MB ... average mu = 0.246`、
  直後に `Ineffective mark-compacts near heap limit`。**full GC後も約9.8 GiB（約10.3 GB）が生存していた**（未回収garbageではなく保持）。
  mu ≈ 0.25は実行時間の約75%がGCだったことを示す
- memory時系列（cumulative最大値、20 IPC毎の記録）とcheckpoint yield速度（1 yield = 50 checkpoint）:

  | 区間終端 s | heapUsed最大 GB | yield / s（K3-L2） | 参考: K2-L2 同時刻 |
  | ---: | ---: | ---: | --- |
  | 55 | 2.26 | 15,113 | 1.40 GB、3,268 / s（59 s） |
  | 119 | 3.85 | 10,605 | 2.53 GB、2,338 / s |
  | 238 | 7.17 | 7,944 | 4.01 GB、1,965 / s |
  | 357 | 7.80 | 5,939 | 6.00 GB、1,732 / s（以後最大値は横ばい、670 sで2件配達して終了） |
  | 600 | 8.76 | 3,965 | — |
  | 898 | 9.43 | 2,588 | — |
  | 1,187 | 9.43 | 1,021 | — |
  | 1,498〜2,640 | 9.43 → 10.37 | **183〜223** | — |

- 約1,200 s以降、進行速度は開始時の約1/70〜1/80に落ち、2,640 sまでの約1,450 s（runの過半）はGCがほぼ全時間を占めたまま、
  保持量が少しずつ増えてheap上限に達した。OOMの直接の形は「保持量がheap上限近くまで積み上がった後のGCスラッシング」である
- K3-L2は開始直後からK2-L2の約4.6倍の速度でcheckpointを進めた（15,113 vs 3,268 / s）。Skill側の処理はheld位置のskipとSkill state生成ごとに
  checkpointを通る軽い処理が多いため、K3-L2の初期はSkill streamの処理が多いと考えられる（H。L2のsection内訳は計測されていない）

### 6.2 L2規模の外挿（Search・predictionなし）

Skill held-aware streamの状態規則を数えるだけのモデル `d2gaHeldAwareSkillStreamCounts()` を作り、(a) fixtureで実streamのobserverと
stream毎のdepth数・state数・最大state数、合計transition数が完全一致すること（test）、(b) 本診断のK2-L1（3 stream、1,014 state）・
K3-L1（255 stream、**2,795,905 state、177,556,414 transition**）の実測と完全一致すること（mismatch 0）を確認した。L2のextent
（M = 1500、conversion位置はProductionの規則で再計算）へ適用すると:

| context | L2 Skill stream | conversion位置 | Skill保持state（全depth読了時） | transition | stream最大depth | 1 depthの最大state |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| K2 | 3 | 2 | 5,990 | 5,990 | 1,498 | 2 |
| K3 | 307 | 306 | **60,812,674**（L1の21.8倍） | 423,741,934 | 1,497 | 306 |

- `createTargetSkillStream()` は全depthのstate配列（`set.depths`）とhistory nodeをSearch終了まで保持する（§4.2のF）。したがってK3-L2で
  Skill streamを全depth読み切ると、6,081万stateが同時に保持される（規模はモデル、保持はコードから確認）
- 1 stateあたりの保持byte数は計測していない（heap snapshotを取っていない）。参考の構造推定（H）: state・history node・stepの3 object
  （pointer圧縮なしのV8で各約40〜56 bytes）と配列slotで約140 bytes/state → 約8.5 GB。§6.1のfull GC後生存量（約10.3 GB）と同じ桁である
- Gogma側: Gogma stream数はNormal offset数でほぼ決まり（L0 7〜8、L1 11〜12。K2とK3で1しか違わない）、L2（Normal 128）では最大約130と見込まれる（H、未計測）。
  K3のGogma frontierは1 streamあたりK2の約3倍（11,645 vs 3,948）で、major GC直後heapから基線0.25 GBを引いた粗い推定では、
  1 streamあたりの生存量はK3約0.10 GB、K2約0.03 GB（H）。streamはcost順に並行して進むため、多数のstreamのfrontierが同時に生存しうる

### 6.3 L2 OOMを説明できること・できないこと

説明できること:

- OOMは未回収garbageではなく、full GC後も約10 GB残る**保持量**の増大による（stderr）
- K3でだけ急増する保持構造が存在する: Skill held 341〜648（308位置）により、conversion位置がL1で255、L2で306に増え（K2は常に2）、
  conversion位置ごとのSkill streamが各depthで最大約300 stateを全depth分保持する。L1で280万state（実測、K2の2,757倍）、L2では6,081万state
  （実測で検証済みのモデル。全depth読了時）
- Gogma側もK3でfrontierが約3倍に広く（held 55〜125の71位置。K2は55〜77の23位置）、生成state数・時間は5.4〜5.6倍、depth中盤の生存量はK2の約2〜3倍（L0 / L1実測）

説明できないこと（未検証）:

- L2のOOM時点でSkill streamとGogma streamのどちらが（またはそれ以外の構造が）何GBを占めていたか。L2はsection内訳・stream集計を持たず、
  K3-L2の再実行は本Phaseの禁止事項である
- OOM時点でSkill streamが何depthまで読まれていたか（6,081万stateは全depth読了時の値で、OOM時点の値ではない）
- 1 stateあたりの保持byte数（Skill / Gogmaとも）。heap snapshotは取っていない
- L2のGogma stream数（約130はL0 / L1からの見込み）

### 6.4 処理件数の増加か、1件あたりの保持量の増加か

- 現evidenceは「**件数の増加**」を支持する: K2とK3は同じobject型・同じprediction回数で、K3ではSkill保持state数（L1 2,757倍、L2モデル1万倍超）と
  Gogma frontier state数（約3倍）が増えている
- 「1件あたりの保持量が変わっていない」ことは直接は確認していない（heap snapshotなし）。ただし保持objectの型・history連結の規則はreservationに依存しない（コードから確認）

## 7. 確認できた事実・未検証の仮説

確認できた事実（F）:

1. L0 / L1のformal heap peak（K3 4.00 / 7.40 GB）の大半は未回収の短命objectで、major GC直後の生存heapは最大0.98 / 1.92 GB
2. L0 / L1の時間差はGogma held-aware streamのstate生成量（K3 / K2 = 5.4〜5.6倍）による。prediction回数はK2とK3で同じ
3. K3はL1でSkill streamが255本（K2 3本）、保持state 2,795,905（K2 1,014）、transition 1.78億。Skill streamは全depthのstateをSearch終了まで保持する
4. Skill streamの規模はreservationとextentだけで決まり、モデルが実測と完全一致する。K3-L2では全depth読了時に6,081万stateを保持する計算になる
5. K3 L0 / L1ではIdeal Bonus解・Ideal Skill解が0件で、Skill × Gogma cross、same-cost closure、delivery bufferは何も保持していない
6. K3-L2はfull GC後も約10 GBが生存し、最後の約1,450 sはGCスラッシングでほとんど進まずにOOMとなった

未検証の仮説（H）:

1. K3-L2のOOMの主因はSkill streamの全depth保持（conversion位置306 × depth × 約300 state）である
2. Gogma streamのfrontier history（約130 streamの並行進行）もL2で数GB以上を占めた
3. Skill `set.depths` を最新depthだけにすれば保持量が大きく減る（history nodeは子孫を持つものだけが残る）
4. 1 stateあたり約140 bytes

## 8. 次の方針の比較と推奨

### A. K3 Searchのメモリ効率改善

- 改善できそうな保持構造: (1) Skill `set.depths`（過去depthは再読されない。最新depthだけ残す）、(2) Gogmaで生成solutionごとに作る `steps` 配列を
  Ideal判定後に限定する（主に時間とgarbage）、(3) conversion位置ごとのSkill streamが同じ位置のSkillsを重複して持つ構造
- Search semantics / Candidate orderingへの影響: (1)(2)は読み取り順・公開順・memoを変えない実装変更で、意味は変えない見込み（H、semantics不変のtestが必要）。
  (3)はstreamの共有方法の設計変更で、resetCount（cost）とoperationsの対応を壊さない設計が必要
- Production変更なしで改善できるか: **できない**。保持構造はすべてProduction Search（`skillStream.ts` / `bonusStream.ts`）にある
- 実装難度: (1)小、(2)小〜中、(3)大。期待効果: (1)はSkill保持の主要部（モデル上6,081万state）を最新depth分へ減らせる可能性があるが、
  history nodeの残存量は未計測で、Gogma frontier側には効かない
- 未検証事項: 1 stateあたりbyte、(1)後に残るhistory node量、L2のGogma側保持量

### B. K3 Searchの実行条件見直し

- heap上限引き上げ: 必要量が未知（Skillだけで構造推定約8.5 GB、Gogmaは未計測）。マシンは33.4 GB。さらにL2はGogma stream数が約11 → 約130（H）で、
  Gogma処理だけでL1の10倍以上の時間が見込まれ、GCスラッシングを避けてもwall上限（60分）内に終わる根拠が無い
- extent分割（例: Skill方向の段階追加）: モデルでSkill保持stateをSearch前に計算でき、予測可能性は高い。ただし登録済みladder（D2-E / D2-F）とは別の条件で、新しい事前登録が必要
- Search全体の分割実行（conversion位置やNormal offsetごと）: 分割した各Searchの配達順の和が全体の6-key順と一致する保証が現在のSearch APIに無く、
  順序・重複除外の意味が変わる。既存仕様を守ったままの実現は難しい
- same-cost closure: L0 / L1では一度もbufferが使われておらず、メモリ増の原因ではない（F）。L2での寄与はevidenceが無い
- いずれも本Phaseでは実施しない（heap上限変更は禁止事項）

### C. 別の代替Route探索へ方向転換

- D2-E K2 c2（24 / 19、t03を得て `54dd2b4e` 側Targetを失う）を起点に、失われたTargetの代替Routeを探す、または既存24 / 19集合から局所再合成する
- 必要なscope・仕様: 新しいcontext（reservationの導出元Entry集合）、評価順、成功条件の事前登録
- Search負荷の予測可能性: 本診断で、Search規模（Skill stream数 = conversion位置数、Skill保持state、Gogma held幅）がreservationとextentだけから
  Search前に計算できることを確認した（Skillモデルは実測と一致）。新しいcontextでもSearch前に規模を出し、登録条件にできる

### 推奨（1案）

**C（別の代替Route探索）を次の優先案とし、その事前登録に、本診断のSearch規模の事前計算（conversion位置数、Skill保持stateモデル、Gogma held幅）をgateとして入れる。**

観測に基づく理由:

- K3 contextの負荷は、t03のSkill held 308位置（conversion位置306）とGogma held 71位置という**reservationの形**から来ており、L2で6,081万Skill stateの保持と
  約130 Gogma streamの並行処理が見込まれる。Bのheap上限引き上げ・extent分割はこの規模を前提にするため、時間・メモリとも成立の根拠が薄い
- Aは有効な候補（特にSkill `set.depths`）だが、Production Searchの変更であり、Gogma側の保持には効かず、効果量も未計測である。Research前進の前提にはしない
  （Production改善として行う場合は別Issue・別PRで、semantics不変のtestと計測を伴う）
- Cは新しいcontextのSearch規模をSearch前に計算でき、K3 L2のような「実行して初めて分かるOOM」を事前に避けられる

本推奨は方針の提案であり、K3 Candidateの存在 / 不存在、K3仮説の成否はどちらも結論づけない。

## 9. Productionへの影響

Production source、Search / Planner / RNG semantics、Search ordering、Candidate探索範囲、Worker、UI、Persistence、schema / version、
Production default / boundsは変更していない（Production changed files: なし）。既存formal RESULT（D2-E / D2-F）・module・record・run dirも変更していない
（formal run dirのtask / record / memory seriesは読み取りのみ）。本書の値は非formalで、formal RESULTではない。Issue #154はCloseしない。
