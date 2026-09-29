# Global Planner Research Phase 2-C2.5-C（Search-only OOMのheap profile / heap snapshot）

Refs #154。Researchであり、memory optimizationは実装していない。`set.depths` の削減、history表現の変更、lazy Crossの変更、
retentionの変更、Candidate semanticsの変更はしていない。Production source・semantics・schema・version・defaultsは変更なし。

## 結論

**Phase 2-C2.5-A / BでPlanner Alternative Search単体・1件目Candidate前のOOMへ局所化した代表3 context（c0-p0 / c12-p0 / c2-p1）では、
memory growthはいずれもscheduler `bonusChannel` のheld-aware Bonus publication path（`settle`）に集中している。deep型c0-p0とshallow型c2-p1
では、生成された評価済みBonus解を `channel.retained` が長期保持する構造がmajorな保持要因だった。一方c12-p0ではnear-limit snapshotが巨大depthの
同期publication途中で取得され、新規bytesの58.2%がSearchの長期構造からまだ到達しないin-flight dataであり、`channel.retained` edge-cutは14.3%
だった。したがってc12-p0では、長期保持より同期publication中の一時的memory pressureも重要である。**

結論は次の3つを別の概念として扱う（§15）。

| 概念 | 根拠 | c0-p0（deep） | c12-p0（shallow） | c2-p1（shallow） |
| --- | --- | --- | --- | --- |
| 共通allocation path | jit_default（Production-like JIT）でbonusChannel `settle` のinclusive share | 87.6% | 77.8% | 78.6% |
| persistent retention | snapshotの `channel.retained` edge-cut（新規bytes / Search構造到達分） | 83.8% / 84.2%：major | 14.3% / 34.3%：保持要因の1つだが支配的ではない | 55.5% / 63.8%：major |
| in-flight working set | 新規bytesのうち `TargetSearchScheduler` から未到達の割合 | 0.5% | 58.2% | 13.0% |

- sampling heap profile（8 GB child、live-object、7,168 MiB時点）: jit_defaultで3 contextとも99.99%以上がRepositoryのSearch code由来。
- `no_inlining` **diagnostic variantでのallocation attribution**（Production-like heapの割合ではない、§6）:
  - deep型c0-p0の最大attributed allocation siteは `bonusAmendmentOperations`（評価済み解ごとのdepth長 `RouteOperation[]`）56.6%で、
    threshold 512→7,168 MiBで39%→57%へ比率が増える。
  - shallow型c12-p0 / c2-p1の最大attributed allocation siteはkey文字列（`serializeStable` 22.8% / 22.0%、`compareStableKeys` 14.4% / 14.5%、
    `semantic_keys` 計37.3% / 36.4%）で、次いで `bonusAmendmentOperations` 15.4% / 17.7%。
- snapshot上には、RouteOperation・key文字列・評価済みBonus解・held-aware published solutionが大量に存在する。`channel.retained` が保持する
  評価済みBonus解はほぼ全件が非Ideal（`idealMatch=false`）。
- `reservedBonusSteps()` のsteps[]は約10%、`set.depths` の排他保持は3.4〜14.3%、`previous` history chainは1.6〜4.4%で二次的。
  Lazy Ideal Cross・SearchWorkQueue・prediction memo / reservation windowは1%未満。
- 事前登録したResearch判定規則（snapshot edge-cut + no_inlining diagnostic sampling）では、H4（channel.retained）partially_supported
  （c0-p0 / c2-p1 strong、c12-p0 mixed）、H1 / H2 / H3 partially_supported（二次的）、H5 / H6 / H7 not_supported。
- completed control 2 contextは2 variantとも、status・Search summary・first Candidate keyがC2.5-Aと一致した（Searchのsemantic output parity。
  heap-allocation parityではない）。

本文書はPR #172のreviewで改訂した（`no_inlining` のscope限定、共通allocation path / persistent retention / in-flight working setの分離）。
formal profilingはやり直しておらず、同じraw profile / snapshotを同じpost-hoc analyzerで再解析した。

## 1. 目的

「Planner Alternative Searchが大量memoryを使う」から一段進め、どのallocation siteのlive objectが増え、どの保持構造から参照され続けて
いるかを、V8 sampling heap profile（割り当て元）とheap snapshot（保持関係）の2種類の証拠で特定する。最適化は次Phase以降。

## 2. authority

- `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md` 5.6.8（Planner Alternative Search、execution-only instrumentation）、`docs/PLANNER_SPEC.md` 9.2.19
- `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25A.md` / `PHASE2C25B.md`、`docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json`、
  `docs/PLANNER_GLOBAL_PHASE2C25B_RESULTS.json`（SHA-256のみprovenanceとして記録）
- code: `src/domain/search/bonusStream.ts`、`skillStream.ts`、`targetSearchScheduler.ts`、`lazyIdealCross.ts`、`searchWorkQueue.ts`、
  `streamSolutions.ts`、`alternative/plannerAlternativeSearch.ts`、C2.5-A harness（`derivePhase2C25APreSearchContexts()`、
  `phase2c25aSearchStatus()`）
- 1,657 oracle（manifest / optimum Route / lower bound / optimum Counter）は計算にもprofile分析にも使用していない。

## 3. Phase A / Bからの確定事項

| 項目 | 内容 |
| --- | --- |
| C2.5-A（Node、8 GB） | 代表3 context（same_gogma_counter c0-p0、same_skill_counter c12-p0、same_owned_weapon_consumed c2-p1）は minimal / instrumented とも first Candidate前にOOM |
| C2.5-A成長型 | deep（c0-p0: Gogma depth 134、累積生成約90万）/ shallow（c12-p0 / c2-p1: depth 5〜7、1 depthで110万〜196万生成） |
| C2.5-B（Chrome Dedicated Worker） | 同じ3 contextの12 runすべて `search_ready` 後・first Candidate前にrenderer消失、V8 OOM crash key 12 / 12。formal verdictは `inconclusive_page_or_browser_crash`。Worker自身のheap limitは未測定 |

## 4. hypotheses

| ID | 内容 | snapshot側のedge群（holder / edge type） | sampling側のcategory |
| --- | --- | --- | --- |
| H1 | held-aware Bonus `ReservedSet.depths` が全生成stateをpublished solutionとして保持 | `depths`（Bonus ReservedSet） | reserved_bonus_generation + reserved_bonus_steps |
| H2 | `reservedBonusSteps()` による解ごとのfull `steps[]` | `steps`（ReservedBonusStreamSolution） | reserved_bonus_steps |
| H3 | `ReservedBonusResultNode.previous` history chain | `results` + `previous`（解 / state / result node） | reserved_bonus_generation |
| H4 | scheduler `channel.retained` | `retained`（property） | scheduler_channel + bonus_solution_materialization + stream_solution_evaluation + semantic_keys |
| H5 | `createLazyIdealCross()` の bonuses / skills / nextColumn / waiting | 同名のcontext edge | lazy_ideal_cross |
| H6 | SearchWorkQueue / pending closures | `heap`（SearchWorkQueue）、`queue`（TargetSearchScheduler） | search_work_queue |
| H7 | prediction memo / reservation windows | `windows`、`resetPredictions` / `keepPredictions` / `predictions`（context） | rng_prediction + reservation_window |

判定規則（formal run前にcommit）: context毎に snapshot edge-cut share（新規bytesに対する比率）と no_inlining sampling share（到達した最大threshold）が
両方25%以上なら strong、両方5%未満なら none、それ以外 mixed、どちらか欠ければ missing。全context strong → supported、全context none →
not_supported、両measureを持つcontextがなければ inconclusive、それ以外 partially_supported。holder signatureとedge群の選定はnon-formal smoke
（c0-p0）の観察後に行った。

この判定はsampling側に `no_inlining` diagnostic variantを使う**Research判定**であり、Production-like JIT（jit_default）で同じ割合が成り立つ
ことを判定したものではない（jit_defaultのshareはevidenceに併記）。

## 5. workload

`docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json` から機械的にderiveした（sourceにTarget / orientation IDを書いていない）。

| role | 規則 | 選ばれたcontext |
| --- | --- | --- |
| OOM代表 | role oom_representative・classification search_only_oom_reproduced・両modeOOMの全件 | c0-p0#0（same_gogma_counter）、c12-p0#0（same_skill_counter）、c2-p1#0（same_owned_weapon_consumed） |
| control（first Candidate） | C2.5-A evidence順で、両mode first_candidate の最初のcompleted_control | c8-p1#0（same_gogma_counter） |
| control（extent stop） | 同、両mode stopped_by_extent_before_candidate の最初 | c13-p4#0（same_skill_counter） |

context parity: このrun自身のbaseline（元Exportに対するordinary Production Planner）から `derivePhase2C25APreSearchContexts()` で再導出し、
orientation / workIndex / targetWeaponId / status / invalidated Entry / invalidated Route key（SHA-256）/ fixed Route set / reservation /
excluded Route keys / extent / originDigest / contextDigest を C2.5-A evidence とfield単位で照合した。**5 / 5 context・全field一致**。
各childは同じcontextをExportから再導出し、contextDigestが一致しなければSearchを始めない。

## 6. sampling profiler方法

- 1 run = 1 fresh child（`--max-old-space-size=8192`）、concurrency 1、`setImmediate` yield、1件目Candidateでconsumer stop。
- Node built-in `node:inspector` のin-process Sessionで `HeapProfiler.startSampling` / `getSamplingProfile` / `stopSampling`。
  条件: `samplingInterval` 256 KiB、`stackDepth` 64、`includeObjectsCollectedByMajorGC=false` / `includeObjectsCollectedByMinorGC=false`
  （live-object profile）。V8 13.6はこのoptionを受理し、error / fallbackはなかった。
- live-only optionが実際に効くことを、合成garbageだけを使うprobe childで確認した: 同じ割り当てでlive-only 23,584 bytes、
  collected込み 117,671,568 bytes。
- threshold: Search開始後の `process.memoryUsage().heapUsed` が 512 / 1024 / 2048 / 4096 / 6144 / 7168 MiB を初めて超えたyieldで1回ずつ取得。
- **2 variant**: V8 sampling heap profilerは物理stack frameの関数単位で記録するため、TurboFan / Maglevがinline展開したcallee（例:
  `bonusAmendmentOperations`）の割り当ては呼び出し元（`settle`）へ計上される（non-formal smokeで確認）。そこで
  - `jit_default`: 通常のJIT（Production-like条件。主なformal evidenceはこちら）
  - `no_inlining`: `--no-turbo-inlining --no-maglev-inlining`
  の2 variantを各contextで実行した。
- **`no_inlining` の位置付け**: Search semanticsの比較用ではなく、inlineされたcalleeのallocationを関数単位で観測しやすくするための
  diagnostic conditionである。completed controlではSearchのsemantic output parity（status / Search summary / first Candidate key）を確認したが、
  通常JITと同一のallocation量・escape analysis・object lifetime・live-object構成・allocation site別shareを保証するものではない。inliningの有無で
  heap allocation自体が変わりうるため、`no_inlining` 由来の関数別割合はすべて「no_inlining diagnostic variantでのallocation attribution」と書き、
  Production-like heapの割合としては扱わない。
  - 注: measured HEAD `6f08a2d` の計算code（`src/benchmarks/plannerGlobalPhase2C25C.ts` の `PHASE2C25C_SAMPLING_VARIANTS` comment）には
    no_inliningについて「Search, its data and its live objects are unchanged」とする記述が残っている。measured provenanceを保つため計算codeは
    変更せず、本節とevidenceの `interpretation.supersededStatements` でこの記述を置き換える。
- Vite SSR moduleのframeは `url` が空になるため、module読込中だけ `Debugger.scriptParsed` で scriptId→url と inline source map を記録し
  （Search開始前に `Debugger.disable`）、post-hocで関数開始行をsource mapで元のTS行へ解決した。未解決script由来bytesは0。
- instrumentationは held-aware depth hookを数値だけに縮めたもの（最大depth・累積生成数・最後のevent）で、counting Engineは使わない。
- 各profileのraw `.heapprofile` はcommitせず、manifest（file / bytes / SHA-256 / context / threshold / heapUsed / elapsed / Node / options /
  V8 flags）をevidenceへ記録した。

## 7. snapshot方法

- samplingとは別のfresh child: `--max-old-space-size=512 --heapsnapshot-near-heap-limit=1 --diagnostic-dir=<run dir>`、sampling profilerなし、
  concurrency 1、同じSearch input、1件目Candidateでstop。
- Search開始直前に `v8.writeHeapSnapshot()` でbaseline snapshotを1枚取る（GC後heap約44 MiB）。V8は同一process内のsnapshot間でobject id
  を保つため、near-limit snapshotの `id > baselineの最大id` を「Search中に割り当てられた新規object」とした。
- near-limit snapshotは3 contextとも Search開始後（7.8〜9.1 s）に書き出しが始まり、完全に書き出された後にchildはOOMで終了した
  （`snapshot_written_then_oom`）。
- parser: 最大791 MBのsnapshotは1文字列にできないため、stream parser で `nodes` / `edges` を typed array へ直接読む。field位置は
  `snapshot.meta.node_fields` / `node_types` / `edge_fields` / `edge_types` から解決し（固定indexなし）、未知sectionはskip、
  不完全file・field欠落・count不一致・範囲外 `to_node`・root不一致はfail closed。1 snapshot = 1 analyzer process（heap 16 GB、concurrency 1）。
- 用語: dominator treeは計算していないので retained size は使わない。
  - shallow size: nodeの `self_size`
  - reachable: synthetic rootから非weak edgeで到達するnode
  - edge-cut: 指定edge群を全部外すと到達不能になるnodeの合計（その edge群だけが生かしている量。共有objectは入らない。仮説間で合算しない）
  - retaining path: rootからのBFS最短経路
  - persistent / in-flight: `TargetSearchScheduler` instanceから到達する新規node / しない新規node（実行中・中断中frameのlocal等）

## 8. contamination確認

| control | variant | status | Search summary | first Candidate key（SHA-256） |
| --- | --- | --- | --- | --- |
| c8-p1#0（first_candidate） | jit_default / no_inlining | 一致 / 一致 | 一致 / 一致 | 一致 / 一致 |
| c13-p4#0（stopped_by_extent） | jit_default / no_inlining | 一致 / 一致 | 一致 / 一致 | 一致（null） / 一致（null） |

profiler contaminationは0。OOM代表のprofile runもC2.5-Aと同じ成長をした: OOM直前の累積Gogma生成state数は c12-p0 4,274,305 / c2-p1 4,306,320
（C2.5-Aと完全一致）、c0-p0は最大depth 134（C2.5-Aと同じ。累積生成数はC2.5-Aの最後の疎なsnapshotより後の値で902,586）。profile取得のため
wall timeはC2.5-Aの約1.7〜2.1倍で、性能指標としては扱わない。profile取得失敗は0件。

## 9. allocation callsite結果（7,168 MiB時点、attributed Repository frame）

「attributed」は、built-in / 無名frameの割り当てをstack上で最も近い名前付きRepository frameへ寄せた集計（raw frameもevidenceに記録）。

**Production-like条件（jit_default）**: bonusChannel `settle`（`targetSearchScheduler.ts:328`）が attributed 1位（67.0% / 29.2% / 30.8%）で、
inclusive shareは 87.6%（c0-p0）/ 77.8%（c12-p0）/ 78.6%（c2-p1）。inlineのため関数内訳は `settle` に吸収される。shallow型ではjit_defaultでも
`stableStringify` が22.8% / 22.0%で2位。

以下の関数別の表は **no_inlining diagnostic variantでのallocation attribution** であり、Production-like heapでの割合ではない。

| context | 1位 | 2位 | 3位 | 4位 | 5位 |
| --- | --- | --- | --- | --- | --- |
| c0-p0（deep） | `bonusAmendmentOperations` 56.6% | `evaluateBonusSolution` 12.0% | `bonusAmendmentResults` 9.6% | `reservedBonusSteps` 9.5% | `serializeStable` 4.7% |
| c12-p0（shallow） | `serializeStable` 22.8% | `bonusAmendmentOperations` 15.4% | `compareStableKeys` 14.4% | `bonusAmendmentResults` 10.3% | `reservedBonusSteps` 10.1% |
| c2-p1（shallow） | `serializeStable` 22.0% | `bonusAmendmentOperations` 17.7% | `compareStableKeys` 14.5% | `reservedBonusSteps` 9.8% | `bonusAmendmentResults` 9.7% |

`settle` のinclusive（その下で割り当てられたlive bytes）はno_inliningでも 88.1% / 77.8% / 78.7% で、jit_defaultとほぼ同じだった。

category別（no_inlining diagnostic variant、7,168 MiB）:

| category | c0-p0 | c12-p0 | c2-p1 |
| --- | ---: | ---: | ---: |
| bonus_solution_materialization（bonusAmendmentOperations / Results） | 66.2% | 25.7% | 27.3% |
| semantic_keys（serializeStable / stableStringify / compareStableKeys） | 7.7% | 37.3% | 36.4% |
| stream_solution_evaluation（evaluateBonusSolution(s) 等） | 13.3% | 10.2% | 10.7% |
| reserved_bonus_steps（reservedBonusSteps） | 9.5% | 10.1% | 9.8% |
| reserved_bonus_generation（ensureReserved / reservedGeneratedState） | 2.3% | 11.9% | 11.4% |
| lazy_ideal_cross / search_work_queue | 0.0% | 0.0% | 0.0% |
| rng_prediction + reservation_window | 0.1% | 0.2% | 0.1% |

## 10. threshold別growth

sampled live bytes（MiB）と主要category比率（no_inlining diagnostic variantでのattribution）:

| context | 512 | 1024 | 2048 | 4096 | 6144 | 7168 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c0-p0 sampled | 381 | 911 | 1,902 | 3,949 | 6,052 | 7,118 |
| c0-p0 Gogma depth | 39 | 57 | 78 | 103 | 120 | 128 |
| c0-p0 bonus_solution_materialization | 48.4% | 57.1% | 60.0% | 63.6% | 65.4% | 66.2% |
| c12-p0 sampled | 523 | 936 | 1,764 | 3,522 | 6,214 | 7,044 |
| c12-p0 semantic_keys | 37.5% | 38.0% | 38.7% | 37.9% | 37.0% | 37.3% |
| c12-p0 bonus_solution_materialization | 22.9% | 23.8% | 24.0% | 25.3% | 26.0% | 25.7% |
| c2-p1 sampled | 345 | 870 | 1,689 | 3,391 | 5,982 | 7,199 |
| c2-p1 semantic_keys | 37.2% | 36.9% | 37.2% | 36.7% | 36.6% | 36.4% |
| c2-p1 bonus_solution_materialization | 23.3% | 23.9% | 24.3% | 25.9% | 26.7% | 27.3% |

- deep型（no_inlining diagnostic attribution）: `bonusAmendmentOperations` の比率が depth に伴って増える（growthVsTotal 1.45）。評価済み解ごとに depth長の `RouteOperation[]`
  を持つため、1解あたりのbytesが深さに比例して増える構造と整合する。
- shallow型（同）: 各categoryの比率は全thresholdでほぼ一定（`serializeStable` growthVsTotal 0.99〜1.02）で、同じallocation siteが比例して増えている。
- jit_defaultでも `settle` の比率はthresholdごとに同程度か増加（c0-p0 50%→67%、c12-p0 26%→29%、c2-p1 25%→31%）で、publication pathへの集中は
  Production-like条件でも変わらない。
- controlも同じ構造で増える（例: no_inlining c13-p4 は bonus_solution_materialization 65.9%→70.8%）が、first Candidate / extent stopで先に終わる。

## 11. heap snapshot結果

| context | near-limit file | nodes / edges | 新規object（Search中） | Search構造から到達（persistent） | 書き出し時のSearch進行 |
| --- | ---: | --- | ---: | ---: | --- |
| c0-p0 | 790,821,023 bytes | 5,981,630 / 47,370,258 | 460.5 MiB | 458.1 MiB（99.5%） | Gogma depth 42、累積生成129,492 |
| c12-p0 | 588,421,859 bytes | 6,546,710 / 31,086,034 | 459.4 MiB | 191.8 MiB（41.8%） | depth 2、累積53,048（heap 179 MB→512 MBの同期burst中） |
| c2-p1 | 622,883,420 bytes | 7,005,827 / 32,760,585 | 457.3 MiB | 397.9 MiB（87.0%） | depth 3、累積196,474 |

snapshot completenessは3 / 3で完全（JSON完結、`snapshot.meta` あり、nodes / edges / strings あり、`node_count` / `edge_count` とarray長一致）。
最終解析runでparse 1.5〜2.2 s、解析37〜79 s、analyzer max RSS 2.0〜2.7 GiB（解析時間は実行ごとに変動する）。

新規objectのshallow size上位（c0-p0、新規460.5 MiB中）:

| signature | 件数 | shallow |
| --- | ---: | ---: |
| `Object{gogmaCounterAfter,gogmaCounterBefore,sourceOwnedWeaponId,type}`（RouteOperation） | 3,058,767 | 163.4 MiB |
| `(object elements)`（配列backing store） | 411,722 | 101.1 MiB |
| `reset_bonuses,reset_bonuses,…`（operationTypeKey文字列） | 76,180 | 28.6 MiB |
| `"gogma_artian","[…]"` 等（retentionKey / bonusKey文字列） | 数万 | 各8〜17 MiB |
| `Object{bonusKey,idealMatch,index,…}`（評価済みBonus解） | 135,580 | 10.3 MiB |
| `Object{bonuses,depth,lastResetDepth,restorationBonusScope,results,steps}`（held-aware published solution） | 136,330 | 9.4 MiB |
| `Object{depth,previous,result,step}`（ReservedBonusResultNode） | 136,283 | 7.3 MiB |

shallow型（c12-p0 / c2-p1）でも上位は `(object elements)`・RouteOperation・key文字列・`concatenated string` で、c12-p0には `index` を
持たない評価済み解（`evaluateBonusSolutions()` のsort前の中間配列）が180,764件あり、その保持経路例は `(Stack roots)` 直下（Search構造を経由しない）だった。

仮説edge群のedge-cut（新規bytesに対する比率）:

| group | c0-p0 | c12-p0 | c2-p1 |
| --- | ---: | ---: | ---: |
| H4 `retained` | 83.8% | 14.3% | 55.5% |
| （参考）operations + amendmentResults（RouteBonusSolution） | 50.7% | 25.6% | 27.7% |
| （参考）operationTypeKey + retentionKey + bonusKey | 27.9% | 37.2% | 30.5% |
| （参考）`reservedSets`（Bonus / Skill streamのclosure） | 13.6% | 5.1% | 15.6% |
| H1 `depths`（Bonus ReservedSet） | 11.7% | 3.4% | 14.3% |
| H2 `steps` | 8.8% | 11.4% | 13.6% |
| H3 `results` + `previous` | 1.6% | 3.5% | 4.4% |
| H5 cross context edges | 0.0% | 0.0% | 0.0% |
| H6 `heap` / `queue` | 0.0% | 0.0% | 0.0% |
| H7 windows / prediction memo | 0.1% | 0.4% | 0.3% |

`channel.retained` 要素のcensus（`idealMatch` の参照先）:

| context | Bonus channel retained | うち idealMatch=true | Skill channel retained（全件false） |
| --- | ---: | ---: | ---: |
| c0-p0 | 135,580 | 2 | 8 |
| c12-p0 | 53,048 | 1 | 12 |
| c2-p1 | 196,474 | 0 | 4 |

## 12. retaining path

代表的な最短保持経路（rootからのBFS、evidenceに全step記録）:

- RouteOperation（c0-p0 / c12-p0）: `(Stack roots)` → 実行中settleのContext → `this` = `TargetSearchScheduler` → `bonuses`（Map）→
  BonusChannel → **`retained`** → 評価済みBonus解 → `solution` → RouteBonusSolution → `operations` → 配列 → RouteOperation
- key文字列: 同じく `retained` → 評価済みBonus解 → `operationTypeKey` / `retentionKey`（concatenated string）
- steps配列（c0-p0）: `TargetSearchScheduler` → `context` → `bonusStream` → `readReservedDepth` closure → `reservedSets`（Map）→ Bonus ReservedSet →
  **`depths`** → depth配列 → published solution → `steps`
- ReservedBonusResultNode: `reservedSets` → Bonus ReservedSet → `frontier` / `depths` → state / solution → `results`
- c2-p1 / c12-p0の一部RouteOperation・published solution: `(Stack roots)` → 実行中frameの配列（`generated` / `solutions` 等）→ 各object
  （Search構造には未登録の、同期publication途中の一時データ）

no_inlining diagnostic variantでの最大attributed allocation site（`bonusAmendmentOperations` / key文字列）が作るobject種別（RouteOperation配列 /
key文字列）は、snapshot上で `channel.retained` → 評価済み解 → `solution.operations` / key の経路で保持されていた（c0-p0 / c2-p1では主経路、
c12-p0では同じobject種別の多くが `(Stack roots)` 直下のin-flight配列からも保持）。`reservedBonusSteps()` のsteps配列は `set.depths` 経由の経路で
保持されていた。

## 13. deep vs shallow比較

| 観点 | c0-p0（deep） | c12-p0（shallow） | c2-p1（shallow） |
| --- | --- | --- | --- |
| 成長 | 少数state（1 depth約2,000）× 深いdepth（134） | 巨大state数（1 depth数十万〜200万）× 浅いdepth（5） | 同（depth 7） |
| 共通allocation path（jit_default `settle` inclusive） | 87.6% | 77.8% | 78.6% |
| 最大attributed allocation site（no_inlining diagnostic） | `bonusAmendmentOperations` 56.6% | `serializeStable` 22.8%（semantic_keys計37.3%） | `serializeStable` 22.0%（semantic_keys計36.4%） |
| persistent retention（`channel.retained` edge-cut / Search構造到達分） | 83.8% / 84.2%：major | 14.3% / 34.3%：保持要因の1つ、支配的ではない | 55.5% / 63.8%：major |
| in-flight（snapshot新規bytes） | 0.5% | 58.2% | 13.0% |

共通しているのは **allocation path**（bonusChannelのheld-aware Bonus publication）であり、保持構造はcontextで異なる。c0-p0 / c2-p1では
`channel.retained` の評価済み解（ほぼ全件非Ideal）がmajorな保持構造で、1解あたりの支配的な中身はdeepがdepthに比例する `operations`、shallowが
depthに依存しない文字列key（いずれもno_inlining diagnostic attributionでの読み）。c12-p0の512 MB snapshotでは `channel.retained` は支配的とは
言えず、新規bytesの過半が同期publication途中のin-flight dataだった。

## 14. hypotheses判定

事前登録したResearch判定規則（snapshot edge-cut + no_inlining diagnostic sampling）による判定。Production-like JITで同じ割合が成り立つことは
意味しない。

| ID | verdict | c0-p0（snapshot / sampling） | c12-p0 | c2-p1 | 限界 |
| --- | --- | --- | --- | --- | --- |
| H1 depths | partially_supported | 11.7% / 11.8% mixed | 3.4% / 22.0% mixed | 14.3% / 21.2% mixed | sampling categoryはstate生成全体を含む |
| H2 steps | partially_supported | 8.8% / 9.5% mixed | 11.4% / 10.1% mixed | 13.6% / 9.8% mixed | jit_defaultではinlineで0.1〜0.2%に見える |
| H3 previous | partially_supported | 1.6% / 2.3% none | 3.5% / 11.9% mixed | 4.4% / 11.4% mixed | sampling categoryはstate生成（result node以外も）を含む |
| H4 retained | partially_supported | 83.8% / 88.1% strong | 14.3% / 77.8% mixed | 55.5% / 78.7% strong | c12-p0のsnapshotは同期burst途中 |
| H5 lazy cross | not_supported | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | — |
| H6 queue | not_supported | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | pending closureがbonus解を持つ経路は確認されず |
| H7 memo / windows | not_supported | 0.1% / 0.1% | 0.4% / 0.2% | 0.3% / 0.1% | — |

## 15. formal conclusions

**共通（3 context）**

1. memory growthはいずれもscheduler bonusChannelのheld-aware Bonus publication path（`settle`）に集中している。Production-like JIT
   （jit_default）の7,168 MiB時点で `settle` のinclusive shareは c0-p0 87.6%、c12-p0 77.8%、c2-p1 78.6%。
2. jit_default（およびno_inlining diagnostic variant）で、live sampled bytesの99.99%以上がRepositoryのSearch code由来。3 contextとも1件目
   Candidate前にOOMした（C2.5-Aと同じ成長）。
3. snapshot上にRouteOperation・key文字列・評価済みBonus解・held-aware published solutionが大量に存在する（c0-p0: RouteOperation 305万件
   163 MiB、評価済みBonus解135,580件、published solution 136,330件）。`channel.retained` が保持する評価済みBonus解はほぼ全件が非Ideal。
4. steps[]（no_inlining diagnostic sampling約10%、snapshot edge-cut 9〜14%）、`set.depths` の排他保持（3〜14%）、`previous` chain（2〜4%）は二次的。
   Lazy Ideal Cross・SearchWorkQueue・prediction memo / windowsは両variant・snapshotとも1%未満で主要因ではない。
5. profilerはSearchのsemantic outputを変えていない（control 2 context × 2 variantでstatus・Search summary・first Candidate keyが一致、OOM代表は同じ
   depth / 累積生成数でOOM）。これはsemantic output parityであり、heap-allocation parityではない。

**context別の保持構造（persistent retention）**

6. c0-p0: `channel.retained` はmajor persistent retaining structure（edge-cut 83.8%、Search構造到達分の84.2%）。deepなRouteOperation
   materializationが大きい。
7. c2-p1: `channel.retained` はmajor persistent retaining structure（55.5% / 63.8%）。key allocationが大きい。
8. c12-p0: `channel.retained` は保持要因の1つだが、この512 MB snapshotでは支配的とは言えない（14.3% / 34.3%）。`channel.retained` が
   3 context共通の支配的保持構造だとは結論しない（事前登録判定のH4 partially_supported：c0-p0 / c2-p1 strong、c12-p0 mixed と整合）。

**in-flight working set**

9. c12-p0のnear-limit snapshotは巨大depthの同期publication途中で取得され、新規bytesの58.2%が `TargetSearchScheduler` からまだ到達しない
   in-flight dataだった（c0-p0 0.5%、c2-p1 13.0%）。c12-p0では長期保持に加えて同期publication中の一時的memory pressureも重要である。

**no_inlining diagnostic variant**

10. no_inlining diagnostic variantでのallocation attributionでは、deep型c0-p0の最大attributed allocation siteは `bonusAmendmentOperations`
    （56.6%）、shallow型c12-p0 / c2-p1は `serializeStable`（22.8% / 22.0%）で `compareStableKeys`（14.4% / 14.5%）が続いた。これは関数別の
    attributionを読むためのdiagnostic conditionの値で、Production-like heapの関数別割合ではない。

**formalにはまだ言えないこと**: no_inliningとjit_defaultのheap-allocation parity、8 GB到達時点の保持構造そのもの（snapshotは512 MB heap）、
c12-p0で8 GB到達時に `channel.retained` が支配的かどうか、shallow型peakにおける同期publication in-flight dataの8 GB時点での寄与、
`channel.retained` から非Ideal解を除いてもPlanner Alternative Searchの意味論が不変か、Browser Dedicated Worker内の内訳、`compareStableKeys`
のlive bytesがcons stringのflattenによるという読み（推定）。

## 16. limitations

- sampling bytesは統計的推定（256 KiB間隔）で関数単位の帰属。jit_defaultはinlineされたcalleeを呼び出し元へ計上する。no_inliningは
  attributionを読みやすくするdiagnostic conditionで、**jit_defaultとのheap-allocation parity（allocation量・escape analysis・object lifetime・
  live-object構成・allocation site別share）は証明していない**。controlで確認したのはSearchのsemantic output parityのみ。
- 事前登録の仮説判定はsampling側にno_inlining diagnostic variantを使うResearch判定。
- snapshotは **512 MB heap** での取得で、8 GB到達時点のheapではない。c0-p0はdepth 42時点、shallow型はdepth 2〜3。8 GBへの外挿はsampling
  thresholdの比例性に依拠している。
- **c12-p0のsnapshotは同期publication途中**（新規bytesの58.2%がin-flight）で、長期保持構造の比率はその時点の値である。
- edge-cutはdominator retained sizeではない。共有object（bonuses配列、step object等）はどの単独edge-cutにも入らない。仮説間で合算しない。
- callsiteの行はsource mapで解決した関数開始行。
- 判定規則（25% / 5%）はformal run前にcommitしたが、holder signatureとedge群はnon-formal smoke（c0-p0）の観察後に選んだ。§15の結論scope
  （major / 支配的ではない / in-flight majority、50% / 5%基準）はreview後のpost-hoc分類で、仮説判定を変えない。
- 各条件1 run。profile runのwall timeは性能指標ではない。Nodeのみ（Browser Worker内のprofileは取っていない）。
- post-hoc analyzerのsource map解決は間接依存の `source-map-js` を使う（Research scriptのみ、新規dependencyなし）。

## 17. 次Phase候補

memory改善を最初に試す候補（実装ではなく候補）:

1. **C1**: bonusChannel publicationでの、評価済み解ごとの `operations`（depth長 `RouteOperation[]`）/ `amendmentResults` の即時materialization。
   no_inlining diagnostic attributionでdeep 56.6% + 9.6%、shallow 15〜18% + 約10%。snapshot（JIT条件に依らない保持構造）でoperations +
   amendmentResults edge-cut 50.7% / 25.6% / 27.7%。
2. **C2**: 評価済み解が保持する文字列key（`retentionKey` / `bonusKey` / `operationTypeKey`）とsort比較。no_inlining diagnostic attributionで
   shallow約37%・deep約8%、jit_defaultでもshallowで `stableStringify` 22.8% / 22.0%、snapshot key edge-cut 28〜37%。
3. **C3**: `channel.retained` が非Ideal解まで全件保持していること（census: 保持解のほぼ全件が `idealMatch=false`、LazyIdealCrossはIdealのみ採用
   ＝code読解）と、`set.depths` + steps[] との二重表現（edge-cut 3〜14% + 9〜14%）。c0-p0 / c2-p1では強い削減候補。c12-p0については
   同期publication中のin-flight allocationも同時に対処しないとpeak削減が限定的な可能性がある。全OOM patternの最大原因とは言わない。

独立検討事項:

4. **shallow synchronous-publication peak**: shallow型で1 depthに数十万〜200万stateを同期的に生成・評価・publicationする途中のpeak working set
   （c12-p0 snapshotで新規bytesの58.2%がin-flight。`index` を持たないsort前の評価済み解180,764件等）を減らせるか。`channel.retained` 削減とは
   別問題として扱う（まだ実装しない）。

次Phaseで決めること:

- 各候補のsemantic-preserving memory reduction案（まだ実装しない）。
- formal equivalence条件: 同じinputで delivered Candidate sequence（`candidateStableKey` 順）、Search summary、prediction call回数、
  first Candidate key、extent stop / exhausted判定がC2.5-A / C2.5-Cと一致すること。
- benchmark条件: 同じOOM代表3 context + completed control 2件、Node 8 GB fresh child、**jit_default（Production-like JIT）を主条件**とする同一
  threshold、到達depth / 累積生成state数 / OOM有無、Browser Dedicated Workerでの再確認。no_inliningは関数別attributionの補助に限る。
- C3の前提: planner_alternative policyで、後から登録されるRoute baseに対し非Ideal retained解が意味を持つ経路があるかをcode / testで確定する。

## 18. 変更境界

- 追加: `src/benchmarks/plannerGlobalPhase2C25C.ts`（workload / parity / threshold profiling boundary / Search呼び出し）、
  `plannerGlobalPhase2C25CProfileAnalysis.ts`（sampling profile集計）、`plannerGlobalPhase2C25CSnapshotAnalysis.ts`（stream parser / 保持構造）、
  `plannerGlobalPhase2C25CAnalysis.ts`（仮説・判定規則・findings・interpretation）、`plannerGlobalPhase2C25C.test.ts`、
  `scripts/run-planner-global-phase2c25c.mjs`、`scripts/analyze-planner-global-phase2c25c.mjs`、本文書、`docs/PLANNER_GLOBAL_PHASE2C25C_RESULT.json`。
- Production source / Search algorithm / retention / Candidate ordering / reservation / Planner / RNG / Worker protocol / defaults / schema /
  version / UI / Persistence の変更なし。Production objectへのdebug property追加なし。Production moduleからC2.5-Cへのimportなし（testで固定）。

## 19. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| measured HEAD | `6f08a2db53487c58651233319e7247b4339f7b6d`（profiling-affecting codeをcommitしたclean HEAD） |
| analysis HEAD | `8ec71d11913f19787008ec26662e29f34516d3dc`（PR #172 review後の再解析。初版は `f6f6b14`。measured HEAD以降の変更はpost-hoc解析・test・interpretation・文書のみで、calculation code変更なし） |
| raw artifact | 再解析時に全raw profile 48件・snapshot 6件をSHA-256で再検証し48 / 48・6 / 6一致。raw run SHA-256不変（`rawArtifactVerification`） |
| benchmark code SHA-256 | `66ac735bb61d4f2ba45892beebcda0f70d7540da9c8000d60956d91f4ac8a427`、uncommitted benchmark code = false |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| C2.5-A evidence SHA-256 | `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd` |
| C2.5-B evidence SHA-256 | `789a1525394210084b71c04e666608fe11fcf9970afe0b48e0b00783b05a6bdd` |
| Node / V8 | v24.19.0 / 13.6.233.17-node.51 |
| OS / CPU / memory | Windows 11 Pro 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 33,377,591,296 bytes |
| sampling | child heap 8192 MB、interval 262,144 bytes、stack depth 64、live-only、threshold 512〜7168 MiB、variant jit_default / no_inlining |
| snapshot | child heap 512 MB、near-limit snapshot 1、Search直前baseline snapshot 1、snapshot run 3（snapshot計6枚）、analyzer heap 16 GB |
| 共通 | concurrency 1、1 run = 1 fresh child、Search extent 4 / 235 / 4、Candidate stop 1、yield `setImmediate`、calculationContext appSchemaVersion 17 / production-rng:c5-e7 |
| run wall | 942.2 s（probe・contexts・sampling 10・snapshot 3） |

## 20. テスト・検証

`src/benchmarks/plannerGlobalPhase2C25C.test.ts`（30件）:

- workload: synthetic evidenceと実C2.5-A evidenceから、OOM代表3件とcontrol 2件をstatusとevidence順でderive、ID改名・順序変更に追従、不正evidenceはfail closed
- context parity: field単位一致、contextDigest / originDigest / extent / reservation / excluded key / Target / workIndex の不一致をそれぞれ検出
- Search呼び出し: C2.5-Aの `runPhase2C25ASearchOnly()` と同一のSearch input・同一record
- profiler boundary: threshold一度きり、captureの失敗 / 返り値がSearch結果を変えない、失敗は `profile_failed` として記録しyieldは継続、consumer stop後は取得しない、child failureとprofiling failureの分類
- sampling analyzer: synthetic profileでself / inclusive（再帰1回）、callsite grouping、attributed集計、category、threshold比較、不正profileのfail closed
- snapshot parser: metaの並べ替えたfield順から位置を解決、任意chunk境界、未知section skip、escape文字列、retaining path（weak edge不使用）、不完全file / schema不一致 / count不一致 / 範囲外edge / root不一致のfail closed、edge-cut・新規node split・persistent split・census
- terminology: 解析結果のkeyに retained size / dominator を持たない（`dominatorTreeComputed=false`）
- conclusion scope（review後に追加）: 共通allocation path / persistent retention / in-flight working setを別概念として算出すること、c12-p0相当
  （H4 mixed・retained edge-cut低・in-flight高）で「全contextで支配的」と結論しないこと、全contextがmajorのときだけその結論になること、no_inlining
  にheap-allocation parityを主張しないこと、interpretation文言が「live objectは不変」「共通の最大の保持構造」等を含まないこと
- 判定規則とfindings、isolation（oracle名・UUID・64桁hex・orientation ID・evidence ID がResearch source / scriptにない、Production moduleからのimportなし、Production default / schema / version不変、samplingとsnapshotが別child role）

標準検証（lint / tsc / test / build / diff check）の結果はPR本文に記録する。

## 21. 証跡

- commit: `docs/PLANNER_GLOBAL_PHASE2C25C_RESULT.json`（provenance・raw artifact再検証、`hypothesisScope`、`conclusionScopes`、workload、parity、probe、contamination、sampling run・threshold・top callsite・category・
  growth、profile manifest、snapshot manifest・completeness・保持構造・retaining path・census、仮説判定、findings（Q1〜Q7）、interpretation（Q8・結論・限界・次Phase））
- commitしないraw（`*.local`）:
  - `docs/PLANNER_GLOBAL_PHASE2C25C_PROFILES.local/`: `.heapprofile` 48件 + script table 10件、計51,114,783 bytes（各profileのSHA-256はRESULTの `profileManifest`）
  - `docs/PLANNER_GLOBAL_PHASE2C25C_SNAPSHOTS.local/`: `.heapsnapshot` 6件（baseline 3 + near-limit 3）、計2,102,315,482 bytes（SHA-256はRESULTの `snapshotRuns`）
  - `docs/PLANNER_GLOBAL_PHASE2C25C_RUN.json.local`（raw run、638,311 bytes、SHA-256 `d04f622240c492d83129b9334f87dde507a8b237014a1c0e0594ad3f09eb0ceb`）、
    `docs/PLANNER_GLOBAL_PHASE2C25C_RUN.local/`（child task / IPC messages、30件）、`docs/PLANNER_GLOBAL_PHASE2C25C_ANALYSIS.local/`（snapshot解析結果、3件）
