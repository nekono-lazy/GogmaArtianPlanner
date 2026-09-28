# Global Planner Research Phase 2-C2.5-A（kernel OOMのSearch-only局所化）

Refs #154。Researchであり、Search algorithmの最適化・frontier reductionの変更・Production default変更・portfolio context再設計・
global assignmentはしていない。原因の局所化だけを行った。

## 結論

**Phase 2-C2でkernel child processが8 GB heap上限でOOMしたorientationから、Conflict kind別に機械的に選んだ代表3件
（`same_gogma_counter` c0-p0、`same_skill_counter` c12-p0、`same_owned_weapon_consumed` c2-p1）について、kernelと完全に同じ
pre-search contextを与えたPlanner Alternative Search単体（`visitPlannerAlternativeCandidates()`、1件目のCandidateでstop）が、
instrumentationなし（minimal）とあり（instrumented）の両方で、1件目のCandidateをdeliverする前に8 GB heap上限でOOMした。
3件とも Search-localized である。**

- 3件はいずれも2 participant Conflictで、kernelのnon-fixed Targetは1件だけであり、kernelはそのTargetについて最初に
  このSearchを同じ入力で呼ぶ（trial・full Planner rerunはCandidate delivery後にしか始まらない）。したがってこの3 orientationに
  ついては、kernel OOMはPlanner Alternative Search単体で再現し、Candidate trial・full Planner・次Targetの処理へ到達する前に
  heap上限へ達したと言える。**他の40 OOM orientationへは一般化しない。**
- completed control 4 orientation / 12 contextは、minimal / instrumentedとも正常終了（first Candidate 5、extent stop 7）し、
  2 modeのSearch semantics（status・summary・first Candidate key）は12/12一致した。instrumentation contaminationは0件、
  timeout・process failureは0件。
- pre-search context parity: Phase 2-C2で完走した11 orientation / 27 kernel Target contextの全てで、Target・invalidated Entry・
  invalidated Route key・fixed Route set・reservation・excluded Route keysが一致した（不一致があればSearchを実行せずfailする設計）。
- OOM直前のprogressは2つの型に分かれた（因果は断定しない、§9）:
  - **深い型（c0-p0）**: Gogma held-aware depth 134まで進み、depthごとの生成state 2千〜1.2万、累積生成約90万 / frontier約87万
    （family layout縮約でほぼ減らない）。heap増分 / 累積生成stateは約9.1 KB。
  - **浅い型（c12-p0、c2-p1）**: depth 5 / 7で停止、depth 3の1 depthだけで生成state 196万 / 110万、累積約427万 / 431万。
    frontierは約17万に縮約される。heap増分 / 累積生成stateは約1.8 KB。
- completed control最大値との比較: 累積生成stateは1.8倍（c0-p0）/ 8.7倍（c12-p0、c2-p1）、1 depthの最大生成stateは
  浅い型で10.6〜18.9倍。**正常contextより何桁も大きいわけではない**（最大で約1桁）。深い型では「Σ depth × 生成state」
  （既存per-depth集計から算出する履歴長の記述的proxy）が2.4倍で、control最大の約3.7 GBに対しOOM側は8 GB到達。

## 1. 目的

Phase 2-C2のformal evidenceは「43 / 54 orientationのkernel child processが8 GB heap上限でOOMした」ところまでで、kernel内の
どの段階（Planner Alternative Search / materialization・preflight / full Planner trial / 次Target）でheapが尽きたかは
局所化していなかった。本Phaseでは、同じorientationのkernelがSearchへ渡すpre-search contextを再導出し、Searchだけをfresh child
processで実行して、Search単体で同じ8 GB OOMが起きるかをformalに確認する。あわせてOOM直前のheld-aware state / frontier /
heapの成長をprogress evidenceとして残す。

## 2. authority

- `docs/REQUIREMENTS.md`
- `docs/SEARCH_SPEC.md` 5.6.8（Planner Alternative Search、held-aware Skill / Gogma stream、「計測用instrumentation（Phase 3-A、
  execution-only）」: `onWorkSettled` / `onSkillReservedDepth` / `onGogmaReservedDepth` は集計値だけを渡し、有無でdeliverされる
  `candidateStableKey` 列・summary・prediction呼び出し回数は同一）
- `docs/PLANNER_SPEC.md` 9.2.19（Planner Alternative kernel: fixed Route集合とreservation 9.2.19.3、代替探索の呼び出し 9.2.19.5、
  found判定 9.2.19.6、bounds / extent 9.2.19.12）
- `docs/PLANNER_ALTERNATIVE_BROWSER_WORKER_BENCHMARK.md`、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C2.md`、
  `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json`
- 実装: `plannerAlternativeSearch.ts`、`bonusStream.ts`（`ensureReserved()`）、`skillStream.ts`、`plannerAlternativeKernel.ts`
  （`preparePlannerAlternativeKernel()` / `runTarget()`）、`plannerAlternativeReservation.ts`、
  `plannerAlternativeBenchmarkInstrumentation.ts`（`createPlannerAlternativeSearchObserver()` / `createCountingRngEngine()`）

## 3. Phase 2-C2からの入力事実

| 項目 | 値 |
| --- | --- |
| Conflict participant | 34（explored 15 / unexplored 19） |
| orientation | 54 |
| kernel child completed / OOM | 11 / 43（heap上限 8 GB、timeout 0、その他failure 0） |
| C2 measured HEAD | `3db8197f` |
| C2 evidence SHA-256 | `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4` |

## 4. formal / non-formal境界

- formal: 本Phaseのformal runは、Research codeをcommitしたclean HEAD `a479bc27` で実行した（runnerは未commit codeを拒否）。
  evidence JSONはmeasured HEADと同じHEADのanalyzerで生成し、`calculationCodeChangedSinceMeasuredHead` は空。
- Phase 2-C2の非formal診断（開発中のscratch scriptでの観測）はformal evidenceとして扱っていない。本Phaseの結論は本Phaseの
  formal runだけによる。
- 実装前のsmoke run（`--allow-uncommitted`、1〜3 context）は配線確認だけで、evidenceには含めていない。

## 5. workload selection

Phase 2-C2 evidenceはrunnerが明示引数 `--c2` で読み、次の4用途にだけ使う: orientationのC2 process outcome（completed / OOM）、
代表workloadの選択、完走orientationのpre-search context parity、post-hoc比較。Search入力（Counter位置・reservation・Candidate・
extent・Target順）には使わない。

選択規則（`selectPhase2C25AWorkload()`、ID hard-codeなし）: Conflict kindごとに、Phase 2-C2 baselineの順（Conflict順、
participant順 = orientation id `c<conflict>-p<participant>` の順）で最初の該当orientationを選ぶ。

| role | kind | orientation | participant | C2 kernel |
| --- | --- | --- | ---: | --- |
| OOM代表 | same_gogma_counter | c0-p0 | 2 | OOM（50 s） |
| OOM代表 | same_skill_counter | c12-p0 | 2 | OOM（121 s） |
| OOM代表 | same_owned_weapon_consumed | c2-p1 | 2 | OOM（112 s） |
| completed control | same_gogma_counter | c8-p1 | 2 | completed（found） |
| completed control | same_skill_counter | c13-p4 | 10 | completed（extent 8 / trial bound 1） |
| completed control | same_owned_weapon_consumed | c2-p0 | 2 | completed（found） |
| completed control | same_normal_counter | c9-p0 | 2 | completed（extent） |

選択したorientationの全non-fixed Target（selected-checkpoint blockedは0件）をSearch-onlyで実行した: 7 orientation、**15 context**、
30 run。

## 6. pre-search context parity

各Search入力は元Export + current Domain preparationから再導出する。

- `contexts` child: 本run自身のbaseline（元ExportのBuild Listに通常Production Planner）→ orientation生成 → Phase 2-C2と同じ
  kernel request（`phase2c2KernelRequest()`: prior fixed Entryなし、prior exclusionなし、Production default extentのspread copy）で
  `preparePlannerAlternativeKernel()` を呼び、`scenario.works` の順に各Targetについて kernelの `runTarget()` と同じ規則で
  invalidated Entry（Targetの唯一のsearchable Entry、かつpreparationの `invalidatedBuildListEntryIds` の要素）、fixed Route set
  （explicit decision Entries − invalidated）、reservation（`derivePlannerAlternativeReservation()`）、excluded Route keys
  （`candidateStableKey(invalidated)` を `normalizePlannerAlternativeExcludedRouteKeys()`）、origin（prepared scenario origin）を得る。
  held / blocked・reservation規則・ranking・Search orderingはResearch側で再実装していない。
- `search` child: 同じ導出をExportからやり直し、context digestが `contexts` childのものと一致することをassertしてからSearchする。
- parity（Search実行前に判定）:

| 検査 | 結果 |
| --- | --- |
| baseline orientation 54件の全identity field（Conflict key・kind・participant・fixed Entry / Target） | 54 / 54一致 |
| C2完走orientationのkernel Target context（Target・invalidated Entry・invalidated Route key SHA-256・fixed Route set・reservation範囲・excluded Route key SHA-256） | **11 / 11 orientation、27 / 27 context一致** |

synthetic testでは、同一入力でkernelが実際にSearchへ渡した入力（`vi.mock` で捕捉）とSearch-only runの入力が完全一致すること、
Search-only first CandidateがkernelのtrialしたCandidateと一致することを固定した。formal runでもcompleted controlのうちkernel trialの
あったcontext 5件で、Search-only first Candidate key（SHA-256）がC2 kernelの1件目trial keyと一致した（post-hoc）。

budget exhaustion（前Targetのtrialでrerun budgetを使い切ったkernelが後続TargetのSearchを省略する）はtrialに依存するため再現しない。
選んだOOM代表は全てnon-fixed Targetが1件なので、この差は結論に影響しない。

## 7. minimal vs instrumented

| mode | 内容 |
| --- | --- |
| minimal | instrumentationなし、counting Engineなし、progressなし。kernelと同じEngine instance、yield `setImmediate`、1件目でstop。Productionに最も近いcontrol |
| instrumented | 既存 `createCountingRngEngine()` と既存 `createPlannerAlternativeSearchObserver()` を使い、そのcallbackに最後のevent（stream index・開始Counter・depth・そのdepthの集計）とsparse snapshotを足しただけ。1件目でstop |

- 両modeとも別のfresh child process（heap `--max-old-space-size=8192`、concurrency 1、1 run 1 process、budget 20分）。
- instrumentedのsnapshot（Research定数、Production defaultではない）: heartbeat 2秒、heap増加256 MiB、held-aware最大depth 5増加、
  first Candidate直前、終了時。child内では集計値だけを更新し、送るのは集計（per-depth集計の数値を含む）だけで、state・family layout
  の内容は送らない。snapshotはchild process IPCでparentへ送り、parentは受信した全snapshotを保持する（OOMでfinal recordが書けなくても
  最後のsnapshotが残る）。
- Gogma depth eventは1 depthの生成・公開・縮約が終わった後に出るため、最後のsnapshotはOOM時に生成途中だったdepthを含まない。
- memoryは `process.memoryUsage()`（heapUsed / heapTotal / rss / external / arrayBuffers）。「sampled max」はsnapshot時点の
  サンプル最大、「last」はprocess死亡前に受信した最後のsnapshotの値であり、true peakではない。minimalにはsnapshotがないため、
  OOM時はV8のfatal GC trace（stderr）の最後のGC行を併記した。

判定: minimal OOM + instrumented OOM = Search-only OOMのformal再現。minimal正常 + instrumented OOM = instrumentation contamination
（原因判定禁止）。両方正常 = Search semantics（status・summary・first Candidate key）の一致を要求。

## 8. Search-only結果

| orientation | kind / role | Target | minimal | instrumented | 分類 |
| --- | --- | --- | --- | --- | --- |
| c0-p0 | Gogma / OOM代表 | be881717 | **OOM** 36.3 s | **OOM** 36.2 s | search_only_oom_reproduced |
| c12-p0 | Skill / OOM代表 | a830a376 | **OOM** 76.4 s | **OOM** 77.3 s | search_only_oom_reproduced |
| c2-p1 | owned / OOM代表 | b27e57a7 | **OOM** 67.3 s | **OOM** 78.1 s | search_only_oom_reproduced |
| c8-p1 | Gogma / control | 1d916ff0 | first 10.5 s | first 10.5 s | no_oom |
| c13-p4 w0〜w8 | Skill / control | 9 Target | first 3（1.7〜8.2 s）/ extent 6 | 同じ | no_oom ×9 |
| c2-p0 | owned / control | a26f6bcf | first 2.1 s | first 2.1 s | no_oom |
| c9-p0 | Normal / control | 711f7d15 | extent（4.4 s） | extent（4.5 s） | no_oom |

（時間はSearch開始からfirst Candidate / 終了まで。OOMはchild process wall時間。preparationは各run約1.8〜1.9 s、Search開始時heapUsed約0.3 GB。）

- minimal: OOM 3 / first_candidate 5 / stopped_by_extent_before_candidate 7。instrumented: 同じ。exhausted・timeout・process failure 0。
- OOM runのV8 fatal GC trace最後の行: c0-p0 minimal Mark-Compact 8,182 → 8,175 MB、c12-p0 7,977 → 7,916 MB、c2-p1 8,010 → 7,972 MB
  （instrumentedもほぼ同値）。いずれも `Ineffective mark-compacts near heap limit`。
- OOMをno-matchとして扱っていない（status `out_of_memory` のまま）。

## 9. OOM直前progress

最後に受信したsnapshot（heartbeat）の値:

| 項目 | c0-p0 | c12-p0 | c2-p1 |
| --- | ---: | ---: | ---: |
| 最後のsnapshot時刻 | 29.8 s | 61.6 s | 71.5 s |
| last heapUsed / RSS | 8.50 GB / 8.81 GB | 8.02 GB / 8.68 GB | 8.32 GB / 8.92 GB |
| settled work | 804 | 47 | 55 |
| Gogma max depth / held-aware stream | 134 / 6 | 5 / 8 | 7 / 8 |
| 最後のGogma event | stream 3、開始55、depth 132: 生成2,017 / frontier 2,014 / 絶対位置16 / layout 132 | stream 4、開始55、depth 4: 245,813 / 6,641 / 114 / 110 | stream 4、開始55、depth 6: 156,223 / 5,137 / 98 / 99 |
| 累積Gogma生成 / frontier | 898,590 / 872,067 | 4,274,305 / 165,358 | 4,306,320 / 175,225 |
| 1 depthの最大生成（depth） | 11,880（129） | 1,964,741（3） | 1,099,490（3） |
| 1 depthの最大絶対位置 | 96 | 912 | 784 |
| Σ depth × 生成state | 74,606,992 | 15,897,554 | 20,181,763 |
| Skill max depth / 累積state | 4 / 8 | 3 / 16 | 4 / 8 |
| RNG prediction（Normal / Skill / Reset / Keep） | 4 / 5 / 149 / 11,072 | 4 / 4 / 118 / 7,383 | 4 / 5 / 104 / 5,873 |
| first Candidate | 未到達 | 未到達 | 未到達 |

reservation（kernelと同一）: c0-p0 Gogma held 55〜71（blocked 67, 71）+ exclusive weapon 1、c12-p0 Gogma held 55〜168（blocked 168）+
Skill held 341〜396 + Normal held 349〜358、c2-p1 Gogma held 55〜153（blocked 79, 153）+ exclusive weapon 1。

成長の形（per-depth集計、evidence `contexts[].growth.gogma.perDepth`）:

- c0-p0: depth 1で192、depth 25で3,126、depth 100で9,378、depth 129で11,880と、depthとともに1 depthの生成stateが線形に増え、
  frontierは生成とほぼ同数（family layout縮約がほとんど効かない）。heapUsedはsnapshot系列で累積生成stateとほぼ比例
  （Pearson 0.99、heap増分 / 累積生成state 約9.1 KB）。
- c12-p0 / c2-p1: depth 1で約1.6〜1.8千、depth 2で約7.7万〜10万、depth 3で110万〜196万と、held範囲（約100〜114位置）の絶対位置 × layout
  の組合せで1〜3 depthのうちに急増し、frontierは約3〜5万に縮約されるが、生成stateは全て公開され累積する（Pearson 0.99、約1.8 KB / state）。

これらは「heap増加とstate数が同時に増えて見える」という相関であり、そのstateがheapの原因だという因果の証明ではない。本Phaseは
allocation profileを取っていない。state 1件あたりのheap増分が型によって約5倍違う（深い型9.1 KB、浅い型1.8 KB、深いcontrolは約7〜16 KB）
ことから、累積生成state数だけでheapは説明できない。コード上、held-aware Bonus streamは各depthで生成した全stateを公開解として
保持し（`set.depths`）、各解が自身のamendment history（depth長のstep列と結果node chain）を持つため、「Σ depth × 生成state」を
記述的proxyとして併記したが、これも因果の断定ではない。

## 10. successful controlとの比較

completed control 12 context（全てno_oom）のinstrumented最終snapshotの最大値との比（`controlComparison`）:

| 指標 | control最大 | c0-p0 | c12-p0 | c2-p1 |
| --- | ---: | ---: | ---: | ---: |
| Gogma max depth | 234 | 0.57× | 0.02× | 0.03× |
| 累積Gogma生成state | 493,595 | 1.82× | **8.66×** | **8.72×** |
| 累積Gogma frontier | 450,388 | 1.94× | 0.37× | 0.39× |
| 1 depthの最大生成state | 103,692 | 0.11× | **18.95×** | **10.60×** |
| 1 depthの最大frontier | 49,868 | 0.24× | 1.05× | 0.76× |
| Σ depth × 生成state | 31,497,492 | **2.37×** | 0.50× | 0.64× |
| settled work | 2,000 | 0.40× | 0.02× | 0.03× |
| RNG prediction合計 | 26,953 | 0.42× | 0.28× | 0.22× |
| sampled max heapUsed | 3.67 GB | 2.32× | 2.19× | 2.27× |

- controlはfirst Candidate到達または extent stop（depth 234まで到達）で終わり、heap最大は約0.4〜3.7 GB。
- OOM contextは「正常contextより何桁も大きい」わけではない。浅い型は1 depthの生成stateが約1桁（10.6〜18.9倍）大きく、深い型は
  累積生成が1.8倍・Σ depth × 生成stateが2.4倍で、prediction数・settled workはむしろ少ない（OOM時点で途中のため）。つまり
  RNG prediction回数やscheduler work数ではなく、公開・保持されるheld-aware Bonus stateの量の側で差が出ている（相関の観測）。
- control c2-p0（held 55〜216、depth 2で10万state生成）は、1件目のCandidateがdepth 2で確定するため2.1 sで終わる。held範囲の広さ
  だけではOOMを決めず、first Candidateに到達するまでに何depth分の保持stateが積み上がるかで分かれる。

## 11. Search-localized判定

| orientation | 判定 | 根拠 |
| --- | --- | --- |
| c0-p0（Gogma） | **Search-localized** | 唯一のnon-fixed Targetでminimal / instrumentedとも1件目delivery前にOOM |
| c12-p0（Skill） | **Search-localized** | 同上 |
| c2-p1（owned weapon） | **Search-localized** | 同上 |
| control 4 | control_completed | 12 contextとも両mode正常・semantics一致 |

- Search-localized: 3 / 3（OOM代表）。not reproduced in first-Candidate Search: 0。measurement contaminated: 0。
- formalに言えること: この3 orientationについて、Phase 2-C2のkernel OOMは、kernelと同一のpre-search contextを与えたPlanner Alternative
  Search単体で、1件目のCandidate delivery前に再現する。kernelはこのTargetについてtrial・materialization・full Planner rerunの前に
  同じSearchを同じ入力で呼ぶため、この3 orientationのkernel OOMはSearch段階で起きていたと局所化できる。

## 12. 未確認事項

- 他の40 OOM orientation（特に3 participant以上のConflict、Target 2件目以降のSearch）がSearch-localizedか。
- heapの原因（どのobjectがheapを保持しているか）。allocation / heap snapshot profileは取っていない。state数・Σ depth × stateとの対応は相関のみ。
- OOMしたSearchがheap制限なしなら何depth / 何秒でfirst Candidateまたはextent stopへ到達するか（Phase 2-C2の非formal診断では24 GBでもc0-p0は完走しなかったが、formalではない）。
- Browser Worker（Chrome、スマートフォン）での再現・時間・memory。本Phaseは全てNode（Vite SSR loader）。
- control以外のcompleted orientationでのmode間parity（controlとして選んだ4 orientationだけを実行した）。
- 既存のreference-verified / game-verified / unverifiedのRNG境界は拡張していない（RNGは変更していない）。

## 13. 次Phase

1. **Phase 2-C2.5-B（第一候補）**: Search-localizedが確認できたため、実Browser Worker（既存Planner Alternative benchmark harnessの経路）で
   同じ3 contextのSearch-onlyを再現し、ProductionのWorker上でも同じ段階で失敗することを確認する（「比較する」「この候補を優先」は
   同じkernel / Searchを使う）。
2. 原因局所化の続き（最適化の前に）: OOM contextでheap snapshot / allocation samplingを取り、保持objectの内訳（公開解・history chain・
   frontier・memo）を特定する。深い型と浅い型を分けて扱う。
3. 残る40 OOM orientationを同じharnessで分類し（kind別の代表を増やす、3 participant以上・2件目Target）、Search-localizedがどこまで一般化するかを測る。
4. その後に限り、held-aware Bonus streamのmemory削減（Search semanticsを変えない範囲）を設計する。本Phaseでは最適化していない。

## 14. 変更境界

- **Production source変更 0件**。Planner Alternative Search algorithm・frontier retention / dedup・family-layout reduction・held-aware traversal・
  Candidate ordering・reservation semantics・kernel trial semantics・Planner・RNG・Production defaults・Worker protocol・schema / version
  （CalculationContext 17、DB 10、Export 13、`production-rng:c5-e7`、Master `dataVersion` 4）・UI・Persistence・Exportは変更なし。
- 既存Domain API（`preparePlannerAlternativeKernel()`、`derivePlannerAlternativeReservation()`、`candidateStableKey()`、
  `normalizePlannerAlternativeExcludedRouteKeys()` / `normalizePlannerAlternativeReservation()`、`visitPlannerAlternativeCandidates()`、
  `createPlannerAlternativeMaterializer()`）と既存benchmark observerだけを呼ぶ。新しいProduction seamは追加していない。
- 1,657 oracle（manifest・Route・lower bound・optimum Counter位置）は計算にも分析にも使っていない。

| 役割 | ファイル |
| --- | --- |
| pre-search context導出・Search-only実行（minimal / instrumented）・sparse progress observer | `src/benchmarks/plannerGlobalPhase2C25A.ts` |
| C2 evidence view・workload選択・parity・run分類・IPC collector・growth / control比較（C2 evidenceはここだけが扱う） | `src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts` |
| テスト（17件） | `src/benchmarks/plannerGlobalPhase2C25A.test.ts` |
| Node runner（contexts child → parity → search child、IPC）/ post-hoc analyzer | `scripts/run-planner-global-phase2c25a.mjs` / `scripts/analyze-planner-global-phase2c25a.mjs` |

## 15. 測定環境・provenance

| 項目 | 値 |
| --- | --- |
| 開始時 | branch `main`、`main` = `origin/main` = `ab630341`（PR #169 merge済み）、Working Tree clean、Issue #154 Open |
| 作業branch | `research/global-planner-phase2c25a-oom-localization` |
| **measured HEAD** | `a479bc27fe0e55cb6d5112b1be8e8eb4d4ac11d4`（Research codeをcommit後、clean HEADで測定） |
| benchmark code SHA-256 | `094aa6f79cfe95ed7e0b7797beccf62f3b001b76ce97daed8517988129e09244`（uncommitted benchmark code = false） |
| analysis HEAD | measured HEADと同じ（測定後のcalculation code変更なし） |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| C2 evidence | `PLANNER_GLOBAL_PHASE2C2_RESULT.json`、SHA-256 `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4`（C2 measured HEAD `3db8197f`） |
| 実施 | 2026-09-28 23:34〜23:45 JST（wall 598 s） |
| runtime | Node v24.19.0（Vite SSR loader、1 Search run = 1 fresh child process、Browser Workerではない） |
| child heap / concurrency | `--max-old-space-size=8192`（V8 heap_size_limit約8.2 GiB）/ 1 |
| yield | `setImmediate`（Search内checkpoint 50回ごと） |
| Search extent | Production default `{ N 4, G 235, S 4 }`（spread copy） |
| Candidate stop bound | 1 |
| progress snapshot | heartbeat 2,000 ms、heap増加 256 MiB、depth step 5、first Candidate直前、終了時（instrumentedのみ） |
| timeout | 1 run 20分（timeout 0件） |
| OS / CPU / memory | Windows 10.0.26200 x64 / AMD Ryzen 7 9700X（16 logical）/ 33,377,591,296 bytes |
| RNG Engine / Calculation schema | `production-rng:c5-e7` / 17、Research `maxPlanSteps` 20,000（baselineのみ） |

## 16. テスト・検証

`src/benchmarks/plannerGlobalPhase2C25A.test.ts`（17件）: workload選択（kind / process outcomeで決定的、同じinputで同じ選択、ID名に依存しない、
不在kindの記録、不正evidenceのfail-closed）、pre-search context（kernelが実際にSearchへ渡した入力とSearch-only入力の完全一致、fixed Route set・
reservation・excluded keys・origin・target・extent、digestの決定性）、完走kernel parity（一致と各fieldの不一致検出、件数不一致）、baseline
orientation比較、observer（instrumentationの有無でCandidate key列全体とsummaryが不変、minimal / instrumentedのfirst Candidate semantics一致、
sparse trigger・sampled max）、Search status / child outcome分類（first / extent / exhausted / OOM / timeout / process failure、final recordなしの
completedを拒否）、2 mode・orientation分類、IPC collector（final recordなしでもsnapshotが残りOOMを空結果にしない）、V8 GC trace解析、growth /
control比較、post-hoc run分析、isolation（計算moduleはC2 evidenceもanalysis moduleも読まない、oracleなし、UUID / 64桁hex / orientation id
リテラルなし、childはC2 evidenceを受け取らない、ProductionからC2.5へ到達しない、Production default / schema / version不変）。

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | 308 files / 4,909 tests passed |
| `npm run build` | passed（既存の500 kB超chunk warningのみ）。`dist` にPhase 2-C2.5-A識別子なし |
| `git diff --check` | passed |

## 17. 証跡

- [PLANNER_GLOBAL_PHASE2C25A_RESULT.json](PLANNER_GLOBAL_PHASE2C25A_RESULT.json): provenance、conditions、selection、baseline、parity（orientation /
  pre-search context全行）、選択orientationのpre-search context（reservationは範囲圧縮、Route keyはSHA-256）、contextごとの2 mode結果
  （status、時間、first Candidate要約と key SHA-256、prediction counts、V8 fatal GC、snapshot数）、分類、growth（最後のsnapshot、per-depth表、
  snapshot系列、相関）、control比較、process一覧。
- raw（commitしない、`.local`）: `PLANNER_GLOBAL_PHASE2C25A_RAW.json.local`（4,211,774 bytes、stable key原文を含む）、
  `PLANNER_GLOBAL_PHASE2C25A_RUN.local/`（task、contexts record、runごとの `*.progress.jsonl`）、`PLANNER_GLOBAL_PHASE2C25A_RUN.log.local`。
- 再生成:

```powershell
node scripts/run-planner-global-phase2c25a.mjs --export <Export.json> --c2 docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --out-dir <new dir> --output <raw.json.local>
node scripts/analyze-planner-global-phase2c25a.mjs --run <raw.json.local> --c2 docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --output <new.json>
```
