# Global Planner Research Phase 2-C2.5-B（Search-only failureの実Chrome Dedicated Worker再現確認）

Refs #154。Researchであり、Search algorithmの最適化・held-aware state削減・frontier reduction変更・Production default変更・
portfolio context再設計・global assignment・heap snapshot / allocation profileによる原因確定はしていない。Browser環境での再現確認と
memory growthの外部観測だけを行った。

## 結論

**Phase 2-C2.5-AでNode上Planner Alternative Search単体へ局所化した代表3 context（`same_gogma_counter` c0-p0、`same_skill_counter`
c12-p0、`same_owned_weapon_consumed` c2-p1）は、同じcurrent Domain inputを実Chrome 153のDedicated Workerで実行すると、minimal /
instrumentedの両modeで、2 attemptとも（計12 run）、Search開始後・1件目Candidate notice前にrenderer processごと失われた。
native Worker `error` は1件も発生していない。**

- 事前登録した分類規則では、page / browser loss は `inconclusive_page_or_browser_crash` であり、Search failureへ自動分類しない。
  したがって **formal verdictは `inconclusive_page_or_browser_crash`（3 / 3 context）** で、規則A（`browser_search_failure_reproduced`、
  両modeのnative Worker failure）には該当しない。
- ただし補助観測として、12 / 12 runで次の全てが揃った（formal分類とは別枠で記録）:
  - relayされた `search_ready` の後で、`first_candidate` noticeもfinal resultもないまま、CDP `Inspector.detached`
    （`Render process gone.`）でpageが失われ、同時刻（±5 ms）にSearch Worker targetがdetach / destroy された。
  - そのrunのrenderer crash dumpに、V8のOOM crash key `v8-oom-location` = `MarkCompactCollector: young object promotion failed`
    がある（§14）。これは§18で許された「Chrome / V8の明示的なOOM diagnostic」に当たるため、補助ラベル
    `explicit_v8_oom_crash_key` を付けた。
  - loss直前のCDP Worker heap（sampled）は3.71〜3.85 GiBで、Chromeの `jsHeapSizeLimit`（page realm 4,395,630,592 bytes）に近い。
- completed control 12 contextは両modeとも正常終了し（first Candidate 5、extent stop 7）、Browser 2 modeのsemanticsと、Node Phase 2-C2.5-A
  のstatus・Search summary・first Candidate key SHA-256が **12 / 12一致** した。instrumentation contamination 0、timeout 0、structured error 0。
- 同じ条件のformal seriesを2回実行し（§9.4）、2回とも同じ結果（loss 12、正常24、control parity 12 / 12、V8 OOM key 12 / 12）だった。

## 1. 目的

Phase 2-C2.5-Aは、Node（heap上限8 GB）で、C2 kernel OOM代表3 orientationのOOMがPlanner Alternative Search単体・1件目Candidate delivery前に
再現することをformalに示した。本Phaseでは同じpre-search contextを実ChromeのDedicated Workerで実行し、Node固有ではなくBrowser Worker環境でも
1件目Candidate前に同じSearch段階でfailureするかを確認し、あわせてWorker heapの成長を外部CDPで観測する。

## 2. authority

- `docs/REQUIREMENTS.md`、`docs/SEARCH_SPEC.md` 5.6.8（Planner Alternative Search、execution-only instrumentation）、`docs/PLANNER_SPEC.md` 9.2.19
- `docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`（fresh Worker、MessageChannel macrotask yield、benchmark.html限定）
- `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2A.md` / `PHASE2B.md`（元Exportのpage内pure validation、外部CDP Worker heap計測、build provenance）
- `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C2.md`、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25A.md`、
  `docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json`
- 既存実装: `plannerGlobalPhase2C25A.ts`（`derivePhase2C25APreSearchContexts()`、`phase2c25aSearchStatus()`）、
  `plannerAlternativeBenchmarkInstrumentation.ts`（`createCountingRngEngine()`、`createPlannerAlternativeSearchObserver()`）、
  `constrainedEnumeration.worker.benchmark.ts`（`benchmarkWorkerYield`）、`vite.benchmark.config.ts`（build provenance）

## 3. Node C2.5-Aからの入力事実

| 項目 | 値 |
| --- | --- |
| C2.5-A measured HEAD | `a479bc27` |
| C2.5-A evidence SHA-256 | `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd` |
| selected orientation / Search context | 7 / 15（OOM代表3 context、completed control 12 context） |
| Node minimal / instrumented | OOM 3 / first Candidate 5 / extent stop 7（両mode同じ） |
| Node分類 | 代表3 = `search_only_oom_reproduced`、control 12 = `no_oom`、contamination 0 |
| Node OOM（minimal / instrumented child wall） | c0-p0 36.3 / 36.2 s、c12-p0 76.4 / 77.3 s、c2-p1 67.3 / 78.1 s（8 GB heap上限、preparation約2 s込み） |

## 4. Browser measurement境界

- benchmark.html限定のpage（`PlannerGlobalPhase2C25BBenchmarkPage`、`BenchmarkApp` の選択肢のみ）。Production routing・Worker protocol・
  `PlannerWorkerClient`・Search Worker・Persistence・UIには接続していない。
- 1 Search run = 1 fresh Dedicated Worker。run終了（failure含む）で必ず `terminate()`。
- Worker内の計算はNode Search childと同じ: `derivePhase2C25APreSearchContexts()` で再導出 → digest一致を確認 →
  `visitPlannerAlternativeCandidates()` だけを、Production default extent `{ N 4, G 235, S 4 }`、`ProductionRngEngine`、
  consumer stop = 1 Candidate、`benchmarkWorkerYield`（MessageChannel macrotask）で実行。materialization / preflight / Planner trialは実行しない
  （1件目Candidateの要約は、Search終了後にだけ作る）。
- Browser Workerに8 GBのheap上限は設定していない（Chromeの既定のまま）。
- 1,657 oracle（manifest・optimum Route・lower bound・optimum Counter位置）は計算にも分析にも使っていない。

## 5. Export / evidence loading

- pageのfile inputで元Exportを選ぶ → bytes → SHA-256 → JSON parse → pure validation（`globalResearchInputFromExport()`、Research
  `maxPlanSteps` 20,000）→ PlannerInput。IndexedDBへImportせず、永続化しない。
- 同じpageでC2.5-A evidenceを選ぶ。evidenceの用途は、代表 / controlの選択、searchable contextの列挙、期待context digest、post-hocのNode比較だけ。
  Worker requestにevidence由来の値（Counter位置・reservation・Candidate・extent・Search順）は入らない（テストで、Workerへpostされた全messageに
  evidence fieldがないことを確認）。
- formal準備はfail closed: page計算のExport SHA-256がevidenceの `exportSha256` と、Research `maxPlanSteps` と candidate stop boundが
  evidenceの記録と一致しなければcontexts Workerも起動しない。Target / Entry ID・Counter位置・orientation idはsource codeにない。

## 6. context parity

各page sessionで、1回限りのcontexts Worker（fresh）が本session自身のbaseline（元ExportのBuild Listに通常Production Planner）→ orientation →
evidenceが選んだorientation IDのpre-search contextを、current Domain codeで導出する。pageはSearch前に、evidenceの記録と次を比較する:

- baseline summary（planning Target数・完了数・termination・Plan step数・Conflict署名・rejected等）の完全一致
- orientationごとのcontext件数
- contextごと: orientation ID、Conflict kind、workIndex、targetWeaponId、status、invalidated Entry、invalidated Route key（SHA-256）、fixed Route set、
  normalized reservation（C2.5-A analyzerと同じrange形式）、excluded Route key（SHA-256）、extent、origin digest、context digest

1件でも不一致なら準備は `failed` となり、`runContext()` は拒否する。Search Workerは受け取った期待digestと自分の再導出digestを再度比較し、不一致なら
Search前にstructured errorで止まる。

| 検査 | 結果 |
| --- | --- |
| page session | 13（page lossのたびに新しいsessionで準備をやり直した） |
| baseline summary | 13 / 13 session一致（baseline Production Planner 3.5〜3.7 s） |
| selected context parity | **13 session × 15 / 15 context、全field一致** |

## 7. dedicated Worker harness

benchmark専用protocol `pg2c25b_benchmark_*`（`plannerGlobalPhase2C25BProtocol.ts`）。historicalな `pa3_benchmark_*` / `pg2a_benchmark_*` は変更していない。

| message | 内容 |
| --- | --- |
| `ready` | Worker module評価完了とWorker realm環境（`performance.memory` の有無等） |
| `accepted` | request受理（1 Worker 1 request、2件目は拒否） |
| `contexts_result` | contexts Workerのbaseline summary / orientation / pre-search context |
| `search_ready` | Search Workerがcontextを再導出しdigest一致、Search開始直前 |
| `progress` | instrumentedのsparse snapshot（集計値のみ） |
| `first_candidate` | 1件目Candidateのdelivery時（consumerが `stop` を返す直前）の専用notice |
| `search_result` | 正常終了のrecord（status、Search summary、first Candidate key SHA-256と要約、prediction回数） |
| `error` | Worker内でcatchしたstructured error（stage、name、message、first Candidate前後） |

page側（`plannerGlobalPhase2C25BHarness.ts`）はrunごとに次を分離して記録する: 正常終了3種、`structured_error`、native `error` の
first Candidate前 / 後、`messageerror`、ready失敗、timeout（1 run 20分）、外部abort。native failureをno Candidateにも `out_of_memory` にも変換しない。
加えて各lifecycle eventを `console.info('[pg2c25b]', json)` でrelayし、pageが失われても外部driverが直前まで保持できるようにした（relayは複製で、
pageは読み戻さない）。

## 8. minimal / instrumented

| mode | 内容 |
| --- | --- |
| minimal | instrumentationなし、counting Engineなし、progressなし。first Candidate noticeだけ送る。Productionに最も近いcontrol |
| instrumented | 既存 `createCountingRngEngine()` と既存 `createPlannerAlternativeSearchObserver()`。snapshot: heartbeat 2 s、held-aware depth 5進行、first Candidate直前、終了時。heap増加triggerはWorker realmで `performance.memory` がある時だけ（Chrome 153のDedicated Workerでは無く、発火しない） |

snapshotはstate / family layout / Candidateの内容を含まない集計値（settled work、Skill / Gogmaのmax depth・累積state・transition、最後のevent、
1 depth最大生成state、prediction回数）だけ。

## 9. formal Browser結果

### 9.1 run一覧（formal series 2回目、commitしたevidence）

| context | role | minimal a1 | instrumented a1 | minimal a2 | instrumented a2 | 分類 |
| --- | --- | --- | --- | --- | --- | --- |
| c0-p0 #0 | Gogma OOM代表 | page loss | page loss | page loss | page loss | inconclusive_page_or_browser_crash |
| c12-p0 #0 | Skill OOM代表 | page loss | page loss | page loss | page loss | inconclusive_page_or_browser_crash |
| c2-p1 #0 | owned OOM代表 | page loss | page loss | page loss | page loss | inconclusive_page_or_browser_crash |
| c8-p1 #0 | Gogma control | first | first | — | — | browser_no_failure |
| c13-p4 #0〜#8 | Skill control | first 3 / extent 6 | 同じ | — | — | browser_no_failure ×9 |
| c2-p0 #0 | owned control | first | first | — | — | browser_no_failure |
| c9-p0 #0 | Normal control | extent | extent | — | — | browser_no_failure |

- run 36（15 context × 2 mode + repeat 3 context × 2 mode）。status: page_crashed 12、first_candidate 10、stopped_by_extent_before_candidate 14。
- native Worker failure 0、`messageerror` 0、structured error 0、timeout 0、browser crash 0、Worker target消失（page生存）0。
- repeat: page lossの3 contextだけが規則どおり1回repeatされ、2回目もpage lossだったのでそれ以上は実行していない。1回目のrecordは残した。
- 全runの開始時・終了時 visibility `visible`、visibility変化0。

### 9.2 minimal outcome / instrumented outcome

| | first_candidate | stopped_by_extent | page_crashed |
| --- | ---: | ---: | ---: |
| minimal | 5 | 7 | 6（3 context × 2 attempt） |
| instrumented | 5 | 7 | 6 |

Nodeと同じく、正常終了contextのstatusは両modeで一致した。

### 9.3 first Candidate到達

- control: 10 run（5 context × 2 mode）でfirst Candidate noticeとfinal resultの両方を受信。
- OOM代表: 12 runとも `search_ready` は受信、`first_candidate` noticeは **0件**。final resultも0件。

### 9.4 formal seriesを2回実行した理由

1回目（formal1、同じclean build `9017731`、同じ入力）は完走し、結果は2回目と同一（page loss 12、正常24、control parity 12 / 12、sampled max 3.824 GiB、
V8 OOM key 12 / 12）だった。ただし1回目の外部driverは、page lossしたsessionについてpage自身の `exportJson()`（準備・parity行）を準備直後に保存して
いなかった（lossしたsessionにはrun recordがなく、driverはrun後にだけ保存していた）。driver（scratch計測tooling、benchmark codeではない）を準備直後にも
保存するよう直し、benchmark buildは変えずにformal seriesをもう一度実行した。commitしたevidenceは2回目。1回目のrawはローカルに残し、commitしていない。

## 10. control parity

| context | Browser status（両mode） | Browser time to first（min / instr） | Node time to first | Node status / summary / key | CDP max heap |
| --- | --- | --- | --- | --- | ---: |
| c8-p1 #0 | first | 6.0 / 6.5 s | 10.5 s | 一致 | 1.83 GiB |
| c13-p4 #0 | extent | — | — | 一致 | 1.16 GiB |
| c13-p4 #1 | extent | — | — | 一致 | 2.00 GiB |
| c13-p4 #2 | first | 3.8 / 3.6 s | 8.2 / 8.6 s | 一致 | 1.66 GiB |
| c13-p4 #3 | first | 1.2 / 1.2 s | 2.6 / 2.8 s | 一致 | 0.59 GiB |
| c13-p4 #4 | extent | — | — | 一致 | 0.89 GiB |
| c13-p4 #5 | extent | — | — | 一致 | 0.90 GiB |
| c13-p4 #6 | first | 0.8 / 0.8 s | 1.7 s | 一致 | 0.35 GiB |
| c13-p4 #7 | extent | — | — | 一致 | 1.12 GiB |
| c13-p4 #8 | extent | — | — | 一致 | 1.99 GiB |
| c2-p0 #0 | first | 1.0 / 1.0 s | 2.1 s | 一致 | 0.36 GiB |
| c9-p0 #0 | extent | — | — | 一致 | 0.92 GiB |

- Browser minimal / instrumented semantic parity（status・Search summary・first Candidate key SHA-256）: 12 / 12。
- Node C2.5-Aとの一致（両mode、status・Search summary・first Candidate key SHA-256）: 12 / 12。NodeでCandidateが出なかったextent stop 7 contextは、
  Browserでも両modeとも同じ `stopped_by_extent_before_candidate` とsummaryで終わった。
- 時間はWorker内のSearch開始から。Node（Vite SSR、`setImmediate` yield）とは実行環境が異なり、timing benchmarkではない（warm-upなし）。

## 11. OOM代表3 context結果

| run | Search開始→page loss | Worker lifetime | CDP sampled max | loss前最後のsample | 最後に受信したprogress（instrumented） |
| --- | ---: | ---: | ---: | ---: | --- |
| c0-p0 min a1 | 12.5 s | 13.6 s | 3.742 GiB | 3.742 GiB | — |
| c0-p0 instr a1 | 12.6 s | 13.6 s | 3.847 GiB | 3.847 GiB | 11.3 s、Gogma depth 120、累積生成 730,261 / frontier 704,058、settled 716 |
| c0-p0 min a2 | 12.5 s | 13.6 s | 3.795 GiB | 3.795 GiB | — |
| c0-p0 instr a2 | 12.5 s | 13.6 s | 3.714 GiB | 3.714 GiB | 11.7 s、depth 124、累積生成 775,135 / frontier 748,860、settled 740 |
| c12-p0 min a1 | 26.2 s | 27.3 s | 3.785 GiB | 3.778 GiB | — |
| c12-p0 instr a1 | 27.7 s | 28.8 s | 3.806 GiB | 3.806 GiB | 23.4 s、depth 5、累積生成 3,048,468 / frontier 132,456、1 depth最大 1,226,624、settled 42 |
| c12-p0 min a2 | 25.5 s | 26.6 s | 3.773 GiB | 3.773 GiB | — |
| c12-p0 instr a2 | 27.6 s | 28.7 s | 3.808 GiB | 3.808 GiB | 23.3 s、depth 5、累積生成 3,048,468 / frontier 132,456、settled 42 |
| c2-p1 min a1 | 34.4 s | 35.5 s | 3.819 GiB | 3.819 GiB | — |
| c2-p1 instr a1 | 32.8 s | 33.9 s | 3.808 GiB | 3.808 GiB | 31.7 s、depth 6、累積生成 3,203,487 / frontier 134,594、1 depth最大 942,420、settled 47 |
| c2-p1 min a2 | 32.5 s | 33.7 s | 3.850 GiB | 3.836 GiB | — |
| c2-p1 instr a2 | 29.9 s | 31.0 s | 3.783 GiB | 3.762 GiB | 24.0 s、depth 6、累積生成 3,046,892 / frontier 129,550、settled 46 |

- 全12 run: Worker accepted あり、`search_ready` あり、first Candidate notice なし、final result なし、native Worker error なし、structured error なし、
  Worker target destroyed = page lossと同時。
- progressは、page loss前に外部driverが受信した最後のrelay eventまで（heartbeat 2 s間隔のため、loss直前の最大約2 s分と、生成途中のdepthは含まない）。
- 型はNode C2.5-Aと同じ: c0-p0は深い型（depthが120台まで進み、生成とfrontierがほぼ同数）、c12-p0 / c2-p1は浅い型（depth 5〜6で1 depthの生成が
  約94万〜123万、frontierは約13万に縮約）。

## 12. CDP heap

- 外部driverが、page sessionにauto-attach（flatten）したDedicated Worker targetへ、約500 ms間隔（直前の要求が終わってから次を要求）で
  `Runtime.getHeapUsage` を送った。usedSizeは未回収garbageを含むV8 isolate used heap。sampled maxであり連続peakではない。
- 実測: median interval 約502〜504 ms、全runでsample 3〜58件。OOM代表では、loss直前に1件ずつ要求がtimeout（5 s）またはGC中に遅延
  （最大応答4.1 s、c2-p1）し、その要求はheap値として扱わず `sampleErrors` に記録した。loss前最後の成功sampleからloss検出までは0.4〜3.8 s。
- 全run sampled max: **4,133,777,868 bytes（3.850 GiB）**（c2-p1 minimal a2）。OOM代表のsampled maxは3.71〜3.85 GiB、controlは0.35〜2.00 GiB。
- page realmの `performance.memory.jsHeapSizeLimit` は4,395,630,592 bytes（4.09 GiB）。Dedicated Workerのrealmには `performance.memory` が無く
  （`null`）、Worker自身のheap上限値は取得していない。Nodeの8 GB（`--max-old-space-size=8192`）とは同一視しない。
- target lifecycle（Worker target作成を0 msとして）: attach 3〜5 ms、first sample 約510 ms、detach / destroy = page loss検出の2〜4 ms前。

## 13. Node vs Browser比較

| context | Node（8 GB）minimal / instrumented | Node最後のsnapshot（instrumented） | Browser（Chrome 153 Worker） |
| --- | --- | --- | --- |
| c0-p0 | OOM 36.3 / 36.2 s（child wall）、last GC 8,182 MB | 29.8 s、heapUsed 7.91 GiB、Gogma depth 134、累積生成 898,590 | Search開始後12.5 s前後でpage loss、sampled max ≤3.85 GiB、最後のprogressはdepth 120〜124 / 累積生成 73〜78万 |
| c12-p0 | OOM 76.4 / 77.3 s、last GC 7,977 MB | 61.6 s、heapUsed 7.47 GiB、depth 5、累積生成 4,274,305 | 25.5〜27.7 sでpage loss、最後のprogressはdepth 5 / 累積生成 3,048,468 |
| c2-p1 | OOM 67.3 / 78.1 s、last GC 8,010 MB | 71.5 s、heapUsed 7.75 GiB、depth 7、累積生成 4,306,320 | 29.9〜34.4 sでpage loss、最後のprogressはdepth 6 / 累積生成 3.05〜3.20M |

- どちらの環境でも、同じcontextが **1件目Candidate前のSearch段階** で進めなくなった。Browserは約4 GiBでNodeより早いdepth / state数で止まった
  （Nodeのheapはpointer compressionなし、Chromeはあり、で1 state当たりのbyte数も異なりうる。数値の直接比較はしない）。
- control 12 contextは両環境で同じstatus / summary / first Candidate keyだった。したがってBrowser Worker上のSearchはNodeと同じ入力で同じSearch semanticsを
  実行しており、代表3 contextの差は「Browserでは異なる計算をした」ことによるものではない。

## 14. Browser OOM判定境界

- 事前に決めた扱い: native Worker `error` / Worker target消失 / heapが大きい、だけでは `out_of_memory` としない。page / browser lossは
  inconclusiveで、Search failureへ自動分類しない。本Phaseのformal分類はこの規則のまま適用した。
- 観測事実: Chrome 153では、Dedicated Worker内のV8 heap枯渇でWorkerの `error` は発火せず、Workerはparent pageと同じrenderer processで動くため、
  renderer processごと終了した（CDP `Inspector.detached: Render process gone.`）。実装前の非formal probe（scratch、Research codeと無関係な
  合成allocation Worker）でも同じ挙動を確認しており、この挙動の下では規則Aの「両modeのnative Worker failure」は起こり得ない。
- 明示的diagnostic: 外部driverは、page loss後に本計測専用のChrome profileに新しく書かれたCrashpad report（`.dmp`）から、process type、loaded origin、
  V8 OOM crash key（`v8-oom-location` / `v8-oom-details`）の文字列だけを抽出した（dumpはcommitしない）。12 / 12 runで、そのrunのrenderer dump
  （`ptype` = `renderer`、origin = benchmark preview）に `v8-oom-location` = `MarkCompactCollector: young object promotion failed` があった。
  これはV8がheap上限到達で致命的に終了する時に設定するcrash keyであり、§18の「Chrome / V8の明示的なOOM diagnostic」に当たる。よって補助ラベル
  `browserOomEvidence = explicit_v8_oom_crash_key` を付けた。formal分類（inconclusive）は置き換えていない。
- 言えること: この12 runでは、renderer processはV8 heap OOMで終了し、その時点でrendererの中で動いていた計算はこのSearch Workerだけ
  （page main threadはidle、contexts Workerは準備時に終了済み）で、Worker heapは上限近く（3.71〜3.85 GiB）まで増えていた。
- 言えないこと: crash keyはprocess単位であり、どのisolateが上限に達したかを直接は示さない（page realmのheapはCDPで取っていない）。

## 15. 未確認事項

- 規則Aの意味での「Browser Workerのnative failureとしての再現」: Chrome 153ではV8 OOMでWorker `error` が届かないため、この形では観測できない。
- heapを保持する具体object（heap snapshot / allocation profileは取っていない）。
- 残る40のPhase 2-C2 OOM orientation（3 participant以上、2件目Targetなど）への一般化。
- 他Browser（Firefox / Safari）、スマートフォン（heap上限がさらに小さい）での挙動と時間。
- Browser heap上限（約4 GiB）の下で、代表3 contextが上限なしなら何depth / 何秒でfirst Candidateまたはextent stopに届くか。
- page realmのheapとrenderer process全体のmemory（OS private bytes）の同時系列（本Phaseは外部CDPのWorker heapだけ）。
- 既存のreference-verified / game-verified / unverifiedのRNG境界は拡張していない（RNGは変更していない）。

## 16. 次Phase

1. **原因局所化（第一候補、最適化の前に）**: 代表3 context（深い型c0-p0と浅い型c12-p0 / c2-p1を分けて）について、Node側でheap snapshot /
   allocation samplingを取り、保持objectの内訳（held-aware Bonus streamの公開解・amendment history chain・frontier・memo）を特定する。
   Browserは約4 GiBでrenderer processごと失われるため、プロファイル取得はNode（または上限を下げたNode）が扱いやすい。
2. 残る40 OOM orientationを同じNode Search-only harnessで分類し、Search-localizedがどこまで一般化するかを測る。
3. Production上の影響整理: 「比較する」「この候補を優先」は同じkernel / Searchを使うため、同じ入力ではPlanner Worker上で同様にrenderer processごと
   失われうる（page全体が落ちる）。UXとしてのfail-closed（Worker分離・上限付きSearch）の要否は、原因特定の後に仕様として判断する。
4. その後に限り、Search semanticsを変えない範囲のheld-aware Bonus stream memory削減を設計する。本Phaseでは最適化していない。

## 17. 変更境界

- **Production source変更 0件**。Search algorithm・frontier retention / dedup・held-aware traversal・Candidate ordering・reservation・kernel・Planner・RNG・
  Production default・Production Worker protocol・schema / version（CalculationContext 17、DB 10、Export 13、`production-rng:c5-e7`、Master
  `dataVersion` 4）・UI route・Persistenceは変更なし。
- 追加はbenchmark / Research側だけ:

| 役割 | ファイル |
| --- | --- |
| protocol（`pg2c25b_benchmark_*`、status型、Research定数） | `src/benchmarks/plannerGlobalPhase2C25BProtocol.ts` |
| Worker側計算（contexts導出、Search-only、nullable memoryのprogress observer、first Candidate notice） | `src/benchmarks/plannerGlobalPhase2C25B.ts` |
| C2.5-A evidence view・workload・context parity（evidenceはここだけが扱う） | `src/benchmarks/plannerGlobalPhase2C25BEvidence.ts` |
| main-thread harness / runner（fresh Worker、status分離、repeat判定、console relay） | `src/benchmarks/plannerGlobalPhase2C25BHarness.ts` |
| post-hoc analysis（page export + 外部CDP evidence + C2.5-Aの統合・分類・Node比較） | `src/benchmarks/plannerGlobalPhase2C25BAnalysis.ts` |
| benchmark Worker / entry | `src/workers/plannerGlobalPhase2C25B.worker.benchmark(.entry).ts` |
| benchmark page・console API `globalThis.plannerGlobalPhase2C25BBenchmark` | `src/pages/PlannerGlobalPhase2C25BBenchmarkPage.tsx`（`BenchmarkApp` にボタン1つ） |
| analyzer | `scripts/analyze-planner-global-phase2c25b.mjs` |
| テスト | `src/benchmarks/plannerGlobalPhase2C25B.test.ts`、`src/pages/BenchmarkApp.test.tsx` |

## 18. 外部CDP driver

scratchpadの計測tooling（commitしない、SHA-256 `501b2e1eb85c585d32d5ea78902d3509dc50661de0e1402a4c00804946914ba1`、external evidenceに記録）。

- 役割: 専用の一時profileでChromeを起動（`--disable-backgrounding-occluded-windows`、headedの前面window）、benchmark pageを開き、2つのfileを
  `DOM.setFileInputFiles` で渡し、準備（parity）完了を待ってから、console API `startRun()` で1 runずつ実行する。
- attach policy: browser levelで `Target.setDiscoverTargets`、page sessionで `Target.setAutoAttach`（flatten、`waitForDebuggerOnStart: false`）。run中に
  作成されたWorker targetをそのrunのSearch Workerとして扱う。
- sampling: 約500 ms間隔の `Runtime.getHeapUsage`（1要求5 s timeout、in-flight中は次を送らない）。失敗はheap値にせず `sampleErrors` へ。
- lifecycle / crash検出: Worker targetの作成・attach・最初 / 最後の成功sample・detach・destroy、page sessionの `Inspector.detached` /
  `Inspector.targetCrashed`、`Target.targetCrashed`、browser WebSocket close。page loss後は8 s待ってcrash dump keyを抽出し、crashしたtabを閉じ、
  新しいpage sessionで準備（parity含む）からやり直して次のrunへ進む。1 runのdriver予算22分（timeoutは0件）。
- 出力: page sessionごとのpage自身の `exportJson()`（準備直後と各run後に上書き保存、内容は加工しない）と、external evidence（raw target / session IDは
  書かずSHA-256だけ）。repeat判定はpageの `repeatDecision()`（pure関数）に、driverが観測したstatus（page recordのstatusまたは `page_crashed`）を渡して得た。
- Browser resultを加工・補完していない。page recordが無いrun（page loss）はexternal evidenceだけで表し、analyzerはpage recordがある時はそれを
  statusの権威とする。

## 19. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| 開始時 | branch `main`、`main` = `origin/main` = `1801d3d8`（PR #170 merge済み）、Working Tree clean、Issue #154 Open |
| 作業branch | `research/global-planner-phase2c25b-browser` |
| **measured HEAD** | `901773191f2293953bfdf5dd40468453e707466f`（benchmark codeをcommitしたclean HEADからbuild） |
| benchmark code SHA-256 | `65187aa7383bbc1290f17650a29515f27a5142e9dfee0ab968bad725b2aa6132`（uncommitted benchmark code = false） |
| analysis | measured HEAD以降のbenchmark code変更なし（analyzerが検査） |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| C2.5-A evidence | `PLANNER_GLOBAL_PHASE2C25A_RESULT.json`、SHA-256 `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd` |
| 実施 | 2026-09-29 00:59〜01:11 JST（formal series 2回目、wall 688 s）。1回目は 00:47〜00:59 JST |
| Browser | Google Chrome 153.0.8010.49（fullVersionList）、UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/153.0.0.0 Safari/537.36`、platformVersion 19.0.0、x86 64-bit |
| page | `crossOriginIsolated` true（`BENCHMARK_CROSS_ORIGIN_ISOLATED=1` の `vite preview`）、`isSecureContext` true、visibility visible、`hardwareConcurrency` 16、`deviceMemory` 32 |
| OS / CPU / memory | Windows 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 33,377,591,296 bytes |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17、Research `maxPlanSteps` 20,000（baselineのみ） |
| Search extent / stop bound | Production default `{ N 4, G 235, S 4 }` / 1 Candidate |
| snapshot policy | heartbeat 2,000 ms、depth step 5、heap growth 256 MiB（Worker realmの `performance.memory` が無いため不発）、first Candidate直前、終了時 |
| CDP sampling | 約500 ms |
| 並行作業 | 測定中にtest / build / Node benchmarkは実行していない（開始前のCPU負荷約5 %） |

## 20. テスト・検証

`src/benchmarks/plannerGlobalPhase2C25B.test.ts`（14件）:

- evidence: C2.5-A evidenceのparseとworkload導出（選択を減らすとworkloadも減る＝codeに名前が無い）、malformed evidenceのfail closed（formalでない、
  context欠落、Node結果欠落、未知role、conditions欠落）
- parity: context digest・extent・reservation・excluded Route key・origin digest・baseline summaryの不一致を検出
- runner: 合成scenarioで、実controller（in-process Worker）がcontextを再導出しevidenceと一致し、両modeでNode C2.5-A Search-only経路と同じ
  status・Search summary・first Candidate key SHA-256を返す。1 run 1 fresh Worker、全Worker terminate、Workerへevidence由来fieldがpostされない。
  Export SHA不一致ではWorkerを起動せず拒否、context digest不一致では全runを拒否
- Worker protocol: 正常（first / extent）、structured error、native errorのfirst Candidate前 / 後、`messageerror`、timeoutを区別し、どれもno Candidateに
  しない
- 分類: 両mode native failure → reproduced、minimal正常 + instrumented failure → contamination、逆 → inconsistent、両正常同semantics → no failure、
  page / browser loss → inconclusive、structured / mixed / after first、repeat判定、page lossのexternal-only mergeと明示的V8 OOM keyの補助ラベル
- control parity: status・Search summary・first Candidate keyが両modeでNodeと一致する時だけ `controlSemanticParity`
- isolation: ProductionからC2.5-Bへの到達なし、Production Worker protocol不変、oracle・UUID・64桁hex・orientation id / Entry IDリテラルなし、file / DB
  読み書きなし、benchmark.html（`BenchmarkApp`）からのみ到達、Production default / schema / version不変

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 309 files / 4,923 tests passed |
| `npm run build` | passed。`dist` にPhase 2-C2.5-B識別子なし |
| `npx vite build --config vite.benchmark.config.ts` | passed |
| `git diff --check` | passed |

## 21. 証跡

- [PLANNER_GLOBAL_PHASE2C25B_RESULTS.json](PLANNER_GLOBAL_PHASE2C25B_RESULTS.json): provenance、環境、条件、sessionごとのparity、workload、repeat判定、
  totals、verdict（formal / auxiliary）、contextごとの分類・attempt・Node比較（controlはparity、代表はNode / Browserのfailure比較）、runごとの統合record
  （status、first Candidate到達、CDP heap summaryと全sample trajectory、target lifecycle、crash dump key）、formalに言えること / 言えないこと。
- [PLANNER_GLOBAL_PHASE2C25B_BROWSER_RESULTS.json](PLANNER_GLOBAL_PHASE2C25B_BROWSER_RESULTS.json): 13 page sessionそれぞれのpage `exportJson()`（verbatim、
  Candidate body・Export全文・raw stable keyなし、Route keyはSHA-256、progressは集計値）。
- [PLANNER_GLOBAL_PHASE2C25B_EXTERNAL_MEMORY.json](PLANNER_GLOBAL_PHASE2C25B_EXTERNAL_MEMORY.json): driverのexternal evidence（CDP構成、runごとの
  `Runtime.getHeapUsage` sample・sample error・Worker target lifecycle（target IDはSHA-256）・page relay event・page loss・crash dump key、sessionごとの準備結果）。
- raw（commitしない、scratchpad）: formal series 1回目 / 2回目のdriver出力一式、Chrome profile（Crashpad dumpを含む）。
- 再生成:

```powershell
$env:BENCHMARK_CROSS_ORIGIN_ISOLATED = '1'; npx vite build --config vite.benchmark.config.ts; npx vite preview --config vite.benchmark.config.ts --port 4179 --strictPort
node <scratch>/cdp-driver.mjs --export <Export.json> --evidence docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --out-dir <new dir>
node scripts/analyze-planner-global-phase2c25b.mjs --run-dir <new dir> --evidence docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --output <results.json> --browser-output <browser.json> --external-output <external.json>
```
