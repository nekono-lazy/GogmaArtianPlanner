# Global Planner Research Phase 2-C2.5-D2-d（held-aware Bonus streamのsingle-pass化（H1）とNode memory / runtime効果）

Refs #154。Phase 2-C2.5-D2-c（`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2C.md` §17）がprimary recommendationとした
**H1（held-aware Bonus streamの `set.depths` が全past depthの全raw solutionを保持し続ける構造の廃止）だけ**を実装し、
実ExportのNode 8 GB Search-only workloadでmemory / runtime効果を正式測定した。H2（`steps[]` lazy化）、H6（generated burst削減）、
stream間共有、Skill streamの変更、Browser再測定は行っていない。

正式evidence: `docs/PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json`（raw run・semantic test reportは `.local` でcommitしない）。

## 結論

- **結果A: primary 2件とも両modeでOOMを脱し、20分budget内に正常終了した（OOM脱出 2 / 2）。**
  - c12-p0#0: 両modeで `stopped_by_extent_before_candidate`（867.6 s / 903.0 s、Gogma depth 234、累積Gogma generated 125,904,312）
  - c2-p1#0: 両modeで `first_candidate`（305.7 s / 314.9 s、Gogma depth 63、累積Gogma generated 55,433,083）
  - どちらもD2-aにCandidate baselineが無い**新規観測**であり、「D2-aとCandidate parity」ではない
- **Candidate semanticsは不変。** PR #173の48 Candidate baseline、D2-aの33 pattern parity、pre-D2-d実装で一度だけ記録した
  held-aware Bonus stream 11 caseのgoldenを期待値変更なしでpass。実Exportのcleared reference c0-p0#0と完了control 2件は、両modeで
  D2-aとstatus・Search summary・first Candidate key SHA-256・extent / exhausted・prediction counts・累積Gogma generated / frontierまで完全一致した。
- sampled max heapUsed: c12 6.62 / 6.64 GiB（D2-a、OOM前）→ **4.35 / 4.42 GiB**（完走）、c2 6.59 / 6.62 GiB → **1.34 / 1.29 GiB**、
  c0 4.19 / 4.17 GiB → 0.79 / 0.73 GiB（minimal / instrumented）。
- 「memory issue solved」とは言えない。Browserは未測定で、c12のNode sampled max（4.35〜4.42 GiB）はD2-bが記録したpage realmの
  `jsHeapSizeLimit` 約4.09 GiB（Worker上限と同一視しない参考値）を上回る。runtimeもc12でCandidateなしのextent stopまで約15分と長い。
- 次Phase推奨: **H1後のChrome Dedicated Worker正式再測定**（§14）。

## 1. authority

`docs/REQUIREMENTS.md` → `docs/SEARCH_SPEC.md` 5.6.8 → D2-c §17（optimization recommendation authority）→ D2-a → D1 → 実装 → テスト →
過去Research。本書はauthorityではない。

## 2. formal spec clarification（SEARCH_SPEC 5.6.8）

held-aware **Bonus** streamについて、Candidate semanticsを変更しない既存consumer contractとして次を追記した。

- `bonusStreamBaseKey(base, master)` で識別されるstreamごとに **single-pass** で消費する。Production consumer
  （`TargetSearchScheduler` のBonus channel、stream keyごとに1つ）はdepthを1, 2, 3, …の順に各1回だけ読み、`exhausted` の後は読まない
- 後から登録されるRoute baseへの過去Ideal positionの再提示は `BonusChannel.retained` が担い、Bonus streamのraw depth replayは
  Candidate semanticsではない。したがってstreamは返したdepthのraw solutionを保持しない
- 同一depthの再読、逆行、飛び越し、depth 1以外からの開始、`exhausted` 後のread、read実行中の別read、失敗したread後のreadは
  consumer contract違反としてfail closed（空配列を返さず、過去depthを再生成しない）
- `reservedReachesBeyondExtent()` はdepth readではなく、terminal read後にも呼べ、predictionしない
- held-aware Skill streamの保持方式は対象外

`TargetBonusStream.readReservedDepth()` / `reservedReachesBeyondExtent()` のAPI commentにも同じcontractを書いた。

## 3. Production変更（`src/domain/search/bonusStream.ts` のheld-aware部分だけ）

```text
ReservedSet（before）: index, depths: ReservedBonusStreamSolution[][], frontier, done, cutByExtent, unsupported, windows
ReservedSet（after） : index, nextDepth, closedBy: 'exhausted' | 'failed' | null, reading, frontier, done, cutByExtent, unsupported, windows

readReservedDepth(base, depth):
  set = reservedSet(base)                        # key = bonusStreamBaseKey(base, master)
  claimReservedDepth(set, base, depth)           # single-pass検証。違反はthrow（Single-pass violation: ...）
  solutions = generateReservedDepth(set, base, depth)   # 旧ensureReserved()の1 depth分。raw solutionはそのまま返し、保持しない
  exhausted = solutions.length === 0 || 全reduced frontier stateのwindowが空   # 旧判定と同一（全stateのwindowを訪問）
  if exhausted: closedBy = 'exhausted'
  失敗時: closedBy = 'failed'（以後のreadはthrow）
```

- **past raw depth cacheは0**: `depths` fieldを削除し、代替cache（Map、直近数depth、WeakMap、serialized cache）を作っていない
- **不変**: 1 depthの生成（window、Reset parent chain、Keep memo、checkpoint、prediction順序）、raw solutionの件数・順序・内容
  （`depth` / `lastResetDepth` / `bonuses` / `restorationBonusScope` / `results` / `steps`）、`steps: reservedBonusSteps(state.results)` を
  全raw solutionへ従来どおり構築（H2未実装）、frontier reduction（`(position, familyLayoutKey)`、`compareReservedRepresentative` /
  `compareReservedFrontier`）、`ReservedBonusResultNode` history（frontier stateのchainは次depthで延長。非frontier raw solutionだけが
  参照するnodeはread後にGC対象）、unsupported notice、window memo、`cutByExtent`、observer
- **変更なし**: ordinaryの `readDepth()` / `solve()` の `cached.depths`、`skillStream.ts`、`targetSearchScheduler.ts`、
  `lazyIdealCross.ts`、RNG、D2-a Ideal-only publication、`channel.retained`、notice生成
- schema / version変更なし（`DATABASE_SCHEMA_VERSION`、`EXPORT_SCHEMA_VERSION`、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、
  RngState / AppSettings schema、`PRODUCTION_RNG_ENGINE_VERSION` `production-rng:c5-e7`）

## 4. テスト

### 4.1 D2-a real-stream testの再読の置き換え

`plannerAlternativeIdealOnlyPublication.test.ts` の「retains and publishes exactly the Ideal absolute positions…」は、scheduler drain後に
`readReservedDepth(base, 1..)` を再読して期待値を作っていた（H1後はfail closedする）。これを、real streamをtest-only decoratorで包み
**schedulerが実際に行ったsingle-pass readの返り値**を記録する方式へ置き換えた（Skill側も同様。Skill Production実装は不変）。
検証は弱めず、次を追加した: channel keyとread keyの一致、各streamが1, 2, 3, …の順に1回ずつ読まれterminal readで終わること、
Bonusの `channel.retained` のoperation type・absolute positionがIdeal raw solutionのstepsと一致すること。

### 4.2 direct stream contract tests（`src/domain/search/reservedBonusStreamSinglePass.test.ts`、24 tests）

- **A. sequential read**: 11 case（連続 / held + blocked / blind / keep-only / full policy normal scope / Reset unsupported /
  Keep unsupported / blind + Reset unsupportedの自然終了 / 全position blocked / 非空depth後の空terminal depth / Base Seedなし）の
  raw solution・順序・steps・history chain・unsupported notice・exhausted・`reservedReachesBeyondExtent`・prediction呼び出しが、
  pre-D2-d実装（main `1c87b02`）で一度だけ記録したgolden（`src/test/fixtures/reservedBonusStreamPreD2D.json`）と一致。
  canonical `(depth, lastResetDepth)` のoperation typeとabsolute position、history chainとstepsの一致も確認
- **B. duplicate**（1, 1）、**C. skip**（1, 3）、**D. backward**（1, 2, 1）、**E. 1以外の開始**（0 / 2 / 1.5）をreject
- **F. exhausted後**: terminal read後の次depth・同depthをreject。`reservedReachesBeyondExtent()` はterminal後も同じ値でpredictionを増やさない。
  空のterminal first read（Base Seedなし等）は合法で、その後のdepth 2はreject
- in-flight中の別read、失敗したread後のread（同depth再試行を含む）をreject
- **G. 独立key**: 異なる `bonusStreamBaseKey` の2 streamはinterleaveしても単独readと同じ結果
- **H. shared key**: 別object・別scopeでも `bonusStreamBaseKey` が同じbaseは1 cursor（schedulerのchannel identityと同じ）
- structural audit（補助）: `ReservedSet` にraw solution collection / `depths` が無く、`readReservedDepth()` がdepthsを読まず、
  ordinary cacheは残る

### 4.3 回帰境界

PR #173 baseline（`BASELINE_SEQUENCE` / `BASELINE_STABLE_KEYS` / prediction列 / exclusion suffix）、D2-a 33 pattern pre-D2 parity、
Planner Alternative reservation / frontier / search tests、same-cost closure、late subscriber、Lazy Ideal Cross、ordinary Candidate Search、
#104 Normal route reductionは期待値変更なしでpass。measured HEAD `aebe6bb` で317 files / 5,119 tests passed。

## 5. workload（sourceにIDを書かない）

`selectPhase2C25D2CWorkload()`（D2-cと同じ規則）を committed D2-a RESULT と C2.5-A evidence から適用し、D2-c RESULTのworkloadと
完全一致することをfail-closedで確認した。

| role | context | D2-a（minimal / instrumented） |
| --- | --- | --- |
| primary OOM | c12-p0#0（same_skill_counter） | out_of_memory / out_of_memory |
| primary OOM | c2-p1#0（same_owned_weapon_consumed） | out_of_memory / out_of_memory |
| cleared reference | c0-p0#0 | stopped_by_extent_before_candidate ×2 |
| control | c8-p1#0 | first_candidate ×2 |
| control | c13-p4#0 | stopped_by_extent_before_candidate ×2 |

## 6. 条件

| 項目 | 値 |
| --- | --- |
| Search | 既存 `runPhase2C25ASearchOnly()`（C2.5-A Search-only入力、consumer stop 1 Candidate）。extent Normal 4 / Gogma 235 / Skill 4 |
| child | D2-a runnerの `contexts` / `search` child roleをそのまま起動（`scripts/run-planner-global-phase2c25d2a.mjs`）。1 Search = 1 fresh Node child |
| heap / JIT | `--max-old-space-size=8192`、jit_default |
| concurrency / yield | 1 / setImmediate |
| run budget | 20分（`PHASE2C25A_RUN_BUDGET_MS`、formal run前に固定、変更なし） |
| modes | minimal（instrumentationなし、1 s memory timer）、instrumented（既存Search observer + counting Engine） |
| 環境 | Node v24.19.0、Windows 11（10.0.26200）、AMD Ryzen 7 9700X 16 logical CPU、31.1 GiB。既存のvite preview server 2組（本Phaseと無関係、idle）が起動していた |

context parity: 5 / 5（C2.5-A evidenceとfield-by-field、workload digestとも一致）。一致しなければSearchを開始しない。

**formal completeness**: formal post-hoc analysisでは、D2-a RESULT / C2.5-A evidenceからanalyzer自身が再導出した
（`selectPhase2C25D2CWorkload()` → `phase2c25d2dWorkloadItems()`、D2-c RESULT workloadとも一致）5 contextがraw runに exactly 1件ずつ存在し、
全contextにminimal / instrumentedの2 modeが揃い、duplicate / foreign / missingのcontext・mode、workload metadata
（orientationId / workIndex / targetWeaponId / role / contextDigest）の不一致、未知のmodeが無く、`environment.modes` がexactly 2 mode、
`environment.smoke` がnull、`uncommittedBenchmarkCode` がfalse、raw statusがcompleted、child processがcontexts 1 + Search 10であることを
fail-closedで検証した（`validatePhase2C25D2DFormalRun()`、post-hocの `src/benchmarks/plannerGlobalPhase2C25D2DFormalValidation.ts`。runnerは
importしない）。不完全なraw runではanalyzerがRESULTを書かずにerror終了する。現在のformal raw runは5 context / 10 Search runで完全だった
（RESULT `formalRunValidation.valid = true`、expected / actual contexts 5 / 5、Search runs 10 / 10）。この検証はNode benchmarkを再実行せず、
同じraw run（SHA-256 `4b93ac9b…c996`、変更なし）のpost-hoc再解析で追加した。測定値・分類・parityは再解析前と同一である。

non-formal smoke（未commit code、primary 2件・minimalのみ・4分budget）はcontract error / 即OOMが無いことだけを確認し
（両方timeout、sampled max 1.3 / 1.0 GiB）、formal結果・selection・budgetには使っていない。

## 7. per-context結果

| context | mode | D2-a status | D2-d status | D2-d elapsed | sampled max heapUsed D2-a → D2-d | sampled max RSS D2-a → D2-d | maxRSS（D2-d） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| c12-p0#0 | minimal | out_of_memory | stopped_by_extent_before_candidate | 867.6 s | 6.62 → 4.35 GiB | 8.41 → 5.30 GiB | 5.34 GiB |
| c12-p0#0 | instrumented | out_of_memory | stopped_by_extent_before_candidate | 903.0 s | 6.64 → 4.42 GiB | 8.40 → 5.31 GiB | 5.36 GiB |
| c2-p1#0 | minimal | out_of_memory | first_candidate | 305.7 s | 6.59 → 1.34 GiB | 8.40 → 1.75 GiB | 1.76 GiB |
| c2-p1#0 | instrumented | out_of_memory | first_candidate | 314.9 s | 6.62 → 1.29 GiB | 8.43 → 1.50 GiB | 1.51 GiB |
| c0-p0#0 | minimal | extent stop | extent stop | 30.9 s（D2-a 35.4 s） | 4.19 → 0.79 GiB | 4.48 → 0.99 GiB | 0.99 GiB |
| c0-p0#0 | instrumented | extent stop | extent stop | 31.4 s（D2-a 35.3 s） | 4.17 → 0.73 GiB | 4.46 → 0.99 GiB | 0.99 GiB |
| c8-p1#0 | minimal | first_candidate | first_candidate | 4.16 s（D2-a 4.58 s） | 0.51 → 0.36 GiB | 0.74 → 0.60 GiB | 0.61 GiB |
| c8-p1#0 | instrumented | first_candidate | first_candidate | 4.22 s（D2-a 4.76 s） | 0.56 → 0.38 GiB | 0.74 → 0.60 GiB | 0.60 GiB |
| c13-p4#0 | minimal | extent stop | extent stop | 1.97 s（D2-a 2.24 s） | 0.35 → 0.32 GiB | 0.54 → 0.58 GiB | 0.58 GiB |
| c13-p4#0 | instrumented | extent stop | extent stop | 2.04 s（D2-a 2.24 s） | 0.38 → 0.36 GiB | 0.61 → 0.58 GiB | 0.58 GiB |

D2-aのOOM runのsampled maxはOOM前最後のsampleまでの値、V8 fatal GC直前heapはc12 6,804.4 / 6,811.2 MB、c2 6,891 / 6,824.3 MB
（D2-a記録）。pre-search heapUsed / RSSは全context約0.28〜0.32 / 0.54 GiB、Node heap limitは8,791,261,184 B。
post-search memory（正常終了時）: c12 1.01 GiB heapUsed / 5.29 GiB RSS、c2 0.99 / 1.75 GiB。

### 7.1 control / cleared reference parity（D2-aと比較、両mode）

| context | status | Search summary | first Candidate key SHA-256 | prediction counts（instrumented） | extent / exhausted |
| --- | --- | --- | --- | --- | --- |
| c0-p0#0 | 一致 | 一致 | 一致（null） | 一致（4 / 5 / 233 / 25,474） | 一致 |
| c8-p1#0 | 一致 | 一致 | 一致 | 一致（4 / 5 / 119 / 6,079） | 一致 |
| c13-p4#0 | 一致 | 一致 | 一致（null） | 一致（4 / 4 / 234 / 25,874） | 一致 |

累積Gogma generated / frontier、max generated / depth、settled work itemsも3 contextすべてでD2-aと同値。mode間semantic parity失敗は0。

### 7.2 primaryの新規観測

| | c12-p0#0 | c2-p1#0 |
| --- | --- | --- |
| status（両mode） | stopped_by_extent_before_candidate | first_candidate |
| Search summary | delivered 0、stoppedByExtent true、exhausted false | delivered 1、stoppedByConsumer true |
| first Candidate key SHA-256 | なし | `fffec72ab6b58d8ff06a7ee0e549e5d4647bedc2694a03bbb78e6323ae15115c`（両mode一致） |
| prediction counts（instrumented、Normal / Skills / Reset / Keep） | 4 / 4 / 234 / 26,719 | 4 / 5 / 160 / 13,173 |
| final Gogma depth | 234 | 63 |

## 8. progress（instrumented）

| | c12 D2-a（OOM前） | c12 D2-d | c2 D2-a（OOM前） | c2 D2-d |
| --- | --- | --- | --- | --- |
| max Gogma depth | 12 | 234 | 18 | 63 |
| max Skill depth | 3 | 3 | 4 | 4 |
| 累積Skill states | 16 | 16 | 8 | 8 |
| 累積Gogma generated | 17,403,169 | 125,904,312 | 17,267,064 | 55,433,083 |
| 累積Gogma frontier | 546,316 | 21,126,394 | 652,568 | 3,602,677 |
| max generated / depth（8 stream合算）@depth | 1,964,741 @3 | 1,964,741 @3 | 1,256,560 @3 | 1,256,560 @3 |
| settled work items | 101 | 1,886 | 140 | 503 |

D2-cの（profiler付き）jit_default runはc12 depth 12 / 17,403,169、c2 depth 18 / 17,267,064でOOMしており、D2-aのinstrumentedと同じ位置だった
（RESULT `contexts[].d2c`、reference）。

## 9. runtime

- c12-p0#0: Candidateなしでextent stopまで867.6 s / 903.0 s（budget 1,200 sの72〜75%）。instrumented snapshotでは
  約49 sでdepth 10、221 sでdepth 29、584 sでdepth 72、745 sでdepth 118、903 sでdepth 234。生成速度は約1.3〜1.4億state / 900 s
- c2-p1#0: first Candidateまで305.7 s / 314.9 s（depth 63）
- 1 depthの生成burst（最大約196万state、8 stream合算）はD2-aと同一で、生成量そのものはH1で変わらない（H1は保持だけを変える）

## 10. before / after（primary）

| | c12 D2-a | c12 D2-d | c2 D2-a | c2 D2-d |
| --- | --- | --- | --- | --- |
| status（minimal / instrumented） | OOM / OOM | extent stop / extent stop | OOM / OOM | first Candidate / first Candidate |
| sampled max heapUsed | 6.62 / 6.64 GiB | 4.35 / 4.42 GiB | 6.59 / 6.62 GiB | 1.34 / 1.29 GiB |
| sampled max RSS | 8.41 / 8.40 GiB | 5.30 / 5.31 GiB | 8.40 / 8.43 GiB | 1.75 / 1.50 GiB |
| max Gogma depth（instrumented） | 12 | 234 | 18 | 63 |
| 累積Gogma generated（instrumented） | 17.40 M | 125.90 M | 17.27 M | 55.43 M |
| elapsed | 最後のsample 85.4 / 89.1 s でOOM | 867.6 / 903.0 s | 最後のsample 91.3 / 97.9 s でOOM | 305.7 / 314.9 s |

## 11. H1 structural audit

analyzerがmeasured HEADとD2-c measured HEADの `bonusStream.ts` を読んで記録した（RESULT `sourceAudit`）。

| | D2-c measured `dddbfaa` | D2-d measured `aebe6bb` |
| --- | --- | --- |
| `ReservedSet` がraw solution collectionを持つ | true | **false** |
| `readReservedDepth()` がdepthsを読む | true | **false** |
| single-pass cursor | false | true |
| ordinary `readDepth()` / `solve()` cacheのdepths | 残る | 残る |
| 全raw solutionへの `steps` 構築（H2） | あり | あり（未実装） |

両HEAD間で変わったProduction fileは `src/domain/search/bonusStream.ts` だけである。

## 12. formalに言えること

1. H1単独（Candidate semantics不変）で、D2-aのshallow型primary 2件はNode 8 GB・20分budgetで両modeともOOMを脱し、正常終了した
   （c12 extent stop、c2 first Candidate）。
2. D2-aでは累積generated state数に比例して保持が増え約1,740万stateでOOMしたが、D2-dでは約1.26億state（c12）を生成しても
   sampled max heapUsedは4.42 GiB以下だった。heapは単調増加せず、generated burstとfrontier / historyの成長に応じて上下した。
3. cleared referenceと完了controlはD2-aとsemantic・progress・prediction countsまで完全一致し、sampled max heapUsedは同等以下
   （c0は4.19 → 0.79 GiB）、elapsedも同等以下だった。
4. 到達depthと生成量が大きく異なるので、「`set.depths` を消してX GiB減った」という単純差分は主張しない。

## 13. まだ言えないこと

- Browser（Chrome Dedicated Worker）で完走すること（未測定。c12のNode sampled maxは参考上限付近）
- H1後のpeak（c12 4.4 GiB）の内訳（frontier / result history / windows memo / generated burst）。heap profileは取っていない
- Production UXとして十分な速さ（c12 約15分、c2 約5分）
- 実Planner Alternative trial全体（複数Target・複数trial・full rerun）でのmemory / runtime
- c12でextent内にIdeal Candidateが無いことのIssue #154全体への意味

## 14. 次Phase recommendation

- **primary: Phase 2-C2.5-D2-e — H1後のChrome Dedicated Worker正式再測定**（D2-bと同じ5 context・driver条件）。Nodeで両primaryが
  完走したので、同じ入力がBrowserでrenderer lossせず完走するかを確認する。c12はNode sampled max 4.35〜4.42 GiBで特に注意が必要
- secondary（Browserでc12が失われる、またはruntime短縮が必要な場合）: c12のH1後heap localizationと、1 depth最大約196万state
  （8 stream合算、stream間で一致するgenerated列）の生成量・時間の分析（H6）。H2はH1のedge-cutにほぼ含まれていたため単独優先度は低い
- 本Phaseの結果だけでSearch extent（Gogma 235）やProduction defaultの変更は推奨しない

## 15. limitations

- `process.memoryUsage()` は1 s heartbeat / snapshot時点のsampled maximumでtrue peakではない
- 各(context, mode)は1 run。wall timeは同一マシン上の参考値
- D2-cの値はsampling profilerを付けたchildのreference
- minimal modeはprogressを記録しない
- 11 caseのgoldenとparity gridは合成fixtureで、実Exportの全stateを網羅するものではない（実Exportでは3 contextのparityで補強）

## 16. provenance / 証跡

| 項目 | 値 |
| --- | --- |
| measured HEAD | `aebe6bbb2e52ca59641fb70b25754de0a76b78c5`（formal、uncommittedBenchmarkCode false） |
| analysis HEAD | `a1ee8ca3f2b2a7a9229760c0660bc2a7cac762b5`（measured HEAD以後の変更はpost-hocのanalyzer・解釈module・formal completeness validator・testだけ。calculationCodeChangedSinceMeasuredHead 空、allowlist: analyzer・`plannerGlobalPhase2C25D2DInterpretation.ts`・`plannerGlobalPhase2C25D2DFormalValidation.ts`・`*.test.ts`） |
| benchmarkCodeSha256 | `849f2ad4d7aaa66c1f6642abbd12dd3b536d6bd98d08be9ca6cca7a10f644dea` |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） |
| C2.5-A evidence | SHA-256 `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd` |
| D2-a RESULT | SHA-256 `51918edeb7b8b4b08953847125295f6bddab5f4f89c2a759daa37d7d1bc7e914`（measured `0c054a8`） |
| D2-c RESULT | SHA-256 `fc9c5102affda2bf102a68cd782e0f3548d256024416b68c38e264841e50c4c6`（measured `dddbfaa`） |
| semantic tests | measured HEADのVitest JSON report、317 files / 5,119 tests passed、failure 0 |
| raw run | `docs/PLANNER_GLOBAL_PHASE2C25D2D_RUN.json.local`、SHA-256 `4b93ac9b12cc34f3675b4fa77c19146e0e4d0ac0ae2688fe6a220aff3972c996`（commitしない、再解析でも不変） |
| run wall time | 2,505.7 s（contexts 1 + Search 10 child） |

追加ファイル: `src/benchmarks/plannerGlobalPhase2C25D2D.ts`（pure helper。D2-a / D2-cのhelperを再利用）、`plannerGlobalPhase2C25D2D.test.ts`、
`plannerGlobalPhase2C25D2DInterpretation.ts`、`plannerGlobalPhase2C25D2DFormalValidation.ts`（post-hoc）、`scripts/run-planner-global-phase2c25d2d.mjs`（parentのみ。childはD2-a runnerの既存role）、
`scripts/analyze-planner-global-phase2c25d2d.mjs`、`docs/PLANNER_GLOBAL_PHASE2C25D2D_RESULT.json`、本書。Browser benchmark codeは追加していない。
