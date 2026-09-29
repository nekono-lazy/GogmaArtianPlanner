# Global Planner Research Phase 2-C2.5-D2-a（Ideal-only publicationの実装とNode memory効果）

Refs #154。Phase 2-C2.5-D1（`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D1.md`）で `feasible` と判定した
Ideal-only publicationを実装し、Phase 2-C2.5-AでSearch-only OOMした実Export代表3 contextに対するNode 8 GBでの効果を正式測定した。
Browser（Chrome Dedicated Worker）での再測定はD2-bへ分離し、本Phaseでは行っていない。

正式evidence: `docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json`（raw runは `.local` でcommitしない）。

## 結論

- **Candidate semanticsは不変。** PR #173の `BASELINE_SEQUENCE` / `BASELINE_STABLE_KEYS` / prediction呼び出し列を期待値変更なしで
  pass（18 tests）。pre-D2実装で一度だけ記録した33パターンのexhaustive synthetic parity（stable-key列SHA-256、Route projection、
  summary、除外、prediction呼び出し列）も一致。実Exportのcompleted control 2件もC2.5-Aとstatus・Search summary・first Candidate
  key SHA-256・extent / exhausted・prediction countsが完全一致した。
- **結果B（一部だけ正常終了）。** OOM代表3件のうち **1件（c0-p0、deep型）がOOMを脱した**。ただしCandidateには到達せず、
  `stopped_by_extent_before_candidate`（Gogma depth 233、sampled max heapUsed約4.5 GB）で終わった。**c12-p0 / c2-p1（shallow型）は
  両modeでOOM継続**。ただし死亡までに生成できた累積Gogma state数は約4倍（4.3 M → 17.3〜17.4 M）、到達depthは5 → 12、7 → 18に伸びた。
- 生成stateあたりの保持heap（記述的比）は c0-p0 約9.1 kB → 約1.8 kB、c12-p0 / c2-p1 約1.8〜1.9 kB → 約0.39〜0.40 kB。
- completed controlはsampled max heapUsedが約1/6（3.67 → 0.60 GB、2.26 → 0.40 GB）、first Candidateまでの時間が10.5 s → 4.6 s。
- 「memory issue solved」とは言えない。shallow型は依然OOMし、c0-p0もextent内でCandidateが無い。次候補はstream側の
  raw state保持（`set.depths` / `steps[]` / 1 depthの巨大generated）であり、D2-bのBrowser再測定と並行して検討する。

## 1. authority

`AGENTS.md` の階層: `docs/REQUIREMENTS.md` → `docs/SEARCH_SPEC.md` 5.6.8 / 13.2.6、`docs/PLANNER_SPEC.md` 9.2.19 → 実装 → テスト →
Research文書。D1 §15〜§18を実装contractとして扱った。本書・C2.5-A / C / D1はauthorityではない。

## 2. Production変更

変更は `src/domain/search/targetSearchScheduler.ts` の `skillChannel()` / `bonusChannel()` の `planner_alternative` 分岐だけ
（ほかは実装コメント）。`initial_candidate_search` 側、zero solutionの評価とsubscribe条件、`createLazyIdealCross()`、
`evaluate*Solutions()`、stream（`bonusStream.ts` / `skillStream.ts`）は変更していない。

### Skill

```text
reserved = skillStream.readReservedDepth(start, depth)          # 変更なし
ideal = reserved.solutions.filter(s => evaluateSkillCondition(target.idealSkillCondition, s.seriesSkillId, s.groupSkillId))
solutions = ideal.map(従来と同一のRouteSkillSolution materialization)   # resetSkillsOperations / skillAmendmentResults はIdealだけ
for value of evaluateSkillSolutions(target, solutions): retained.push(value); subscribers(value)
if !reserved.exhausted: next(depth + 1) else if reservedReachesBeyondExtent(start): noteExtentReached()   # 変更なし
```

### Bonus

```text
reserved = bonusStream.readReservedDepth(base, depth)           # 変更なし
route_kind notice: raw全件から / unsupported notice: reserved.unsupportedPredictions から   # filterより前、変更なし
ideal = reserved.solutions.filter(s => satisfiesIdealBonuses(target, s.bonuses, s.restorationBonusScope, master))   # 全raw、authorityそのもの
solutions = ideal.map(従来と同一のRouteBonusSolution materialization)   # bonusAmendmentOperations / bonusAmendmentResults はIdealだけ
for value of evaluateBonusSolutions(target, input, solutions): retained.push(value); subscribers(value)
exhausted / extent: 変更なし
```

- **notice維持**: Bonusの `route_kind` / `unsupported` noticeはIdeal filterより前にraw全件・全unsupported predictionから作る
  （従来と同一のループ）。Idealが0件のdepthでも同じnoticeになる（test）。
- **extent / prediction維持**: `reserved.exhausted`、`next(depth + 1)`、`reservedReachesBeyondExtent()` / `noteExtentReached()` は
  従来どおりraw depthの結果だけで決まり、非Idealしか無いdepthでも次depthへ進む。predictionはstream側 `ensureReserved()` だけで
  行われ、scheduler側の変更はprediction呼び出しを増減しない（PR #173のprediction列、parity 33パターンのprediction列SHA-256、
  controlのprediction countsで確認）。
- **Ideal predicate**: 既存authorityをそのまま全raw solutionへ適用した。`satisfiesIdealBonuses()` の不明BonusRank参照assert
  （Domain Error）も全rawに対して従来どおり投げられる（test）。安価な代用predicateは作っていない。Ideal solutionでは
  `evaluate*Solutions()` 内で同じpredicateがもう一度評価されるが、semantic安全性を優先してそのままにした。
- **`channel.retained`**: Planner Alternativeでは「これまでにpublicationされた全Ideal absolute position」だけを保持し、
  late subscriberへreplayする。同じ完成結果でもCounter positionが違えば別solutionとして保持する（Ideal resultごとに1件へ畳まない）。
- **internal history assert（D1 §18）**: 非Idealでは `bonusAmendmentResults()` が呼ばれなくなるので、その内部のhistory整合性assertも
  走らない。stream自身が作るchainでは成立するinternal invariantであり、raw全件への新しいO(depth) assertは追加していない。
  Production inputからこのassertがobservable error contractであるという証拠は見つからなかった。
- **ordering**: Ideal同士の順序は `evaluate*Solutions()` の既存sortで決まる（D1 §8の証明）。`streamSolutions.ts` の
  `evaluateSkillSolutions()` / `evaluateBonusSolutions()` に「comparator keyが要素単独で決まり、部分集合のsortでも相対順序が
  変わらない。keyを変えるときはこの性質を保つこと」という注意を追記した（D1 §18の推奨）。

### 実装コメントとformal specの明確化

- 実装コメント（`targetSearchScheduler.ts` のclass doc / `Channel.retained` / 2か所の分岐コメント、`plannerAlternativeSearch.ts`、
  `routeSearchShared.ts` の `SearchFrontierPolicy`）を「各absolute positionを独立に考慮し、Ideal positionをcomposition用に
  publicationする」意味へ直した。
- `docs/SEARCH_SPEC.md` 5.6.8「探索の継続」に、D1 §10でレビュー済みの明確化を1項目追加した。**これはCandidate semanticsの変更ではなく、
  D1で既に確認したexisting Planner Alternative semanticsの明文化である**（held-aware Skill / Bonus streamは各absolute positionを
  同一結果retentionで畳まず独立して生成・予測・Ideal判定し、Ideal positionは独立solutionとしてcompositionと後続Route baseに
  提示される。非Ideal positionはmaterializeを要求しないが、notice / extent / prediction / frontierへの寄与は変わらない）。

schema / version（`DATABASE_SCHEMA_VERSION` 10、`ExportRoot.schemaVersion` 13、`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 17、
`RngState.schemaVersion` 2、`AppSettings.schemaVersion` 2、`PRODUCTION_RNG_ENGINE_VERSION` `production-rng:c5-e7`）、Worker protocol、
Planner semantics、RNG、Persistence、UIは変更していない。

## 3. semantic tests

| test | 内容 | 結果 |
| --- | --- | --- |
| `plannerAlternativeIdealPublication.test.ts`（PR #173） | late subscriber、順序、notice、extent、D2 baseline（全48 Candidateの配送順・`BASELINE_STABLE_KEYS`・summary・prediction列、先頭除外） | **期待値変更なし**で18 / 18 pass |
| `plannerAlternativeIdealOnlyPublication.test.ts`（追加） | 下記 | 42 / 42 pass |
| 全体 | `npm test` | 5025 / 5025 pass（measured HEADで採取したVitest JSON reportをRESULTに記録） |

追加test（42件）:

- **exhaustive synthetic parity（34件）**: `src/test/fixtures/plannerAlternativeIdealPublicationParity.ts` の33パターン
  （既存巨戟のIdeal Bonus / Skill位置の組合せ、Keep由来の同一結果後続位置、現在Ideal軸、同一family layoutの2既存巨戟、predicted
  Normal offset、Normal + 既存巨戟、blind Normal、全位置Ideal、自然終了（exhausted）、Gogma / Skillのheld、held+blocked）。
  各パターンを完走させ、Route projection列、`candidateStableKey` 列のSHA-256、summary、`stoppedByConsumer`、skip除外keyのSHA-256、
  prediction種類別件数と呼び出し列SHA-256、さらに中央のCandidateを除外した再実行の同じ項目を比較する。期待値
  `plannerAlternativeIdealPublicationPreD2.json` は **Production変更前（main 83e8975）に同じ記録関数で一度だけ採取**した
  （test実行時に生成しない）。旧実装をProductionにdual-pathで残していない。Production変更前のschedulerに戻して新test fileを実行すると、
  parity 34件はpassし、Ideal-only固有の白箱7件だけが失敗することも確認した。
- **実streamでのretention（2件）**: 実 `TargetSearchScheduler` + 実streamで、各channelの `retained` が全件 `idealMatch` で、
  streamのmemo済みheld-aware depthから数えたIdeal position列と一致し、raw position数 > Ideal数（非vacuous）。同一Ideal結果の
  後続absolute positionが畳まれずに複数保持される。
- **controlled stream（5件）**: 手作りraw solutionを返すstreamで、非Idealの `steps` / `results`（materializationだけが読むfield）を
  getterで数え、読み取り0回であること、全depthを読む（非Idealだけのdepthを含む）こと、`stoppedByExtent`、subscriberへ届く
  evaluated solution数がIdeal position数（Bonus 4 / Skill 3）と一致すること、depth 1 publication後に登録したlate baseが
  replayで全Ideal pairを得ること、Idealが無くてもnotice（Reset / mixed / Keep / unsupported Keep）がlate subscriberにも届くこと、
  不明BonusRankの非Ideal raw solutionでDomain Errorになること。Production専用のtest hookは追加していない（private channelは
  型castで読むだけ）。
- **source audit（1件）**: 分岐がraw solutionを既存authorityでfilterしてからmapし、Bonus noticeループがfilterより前にあること。

## 4. Node formal benchmark

### 4.1 provenance

| 項目 | 値 |
| --- | --- |
| measured HEAD | `0c054a8415244e99743cc2c615bf38c94917729f`（Production変更・harness・analysis module・test・spec明確化を含むclean HEAD） |
| analysis HEAD | 同上（計算code変更なし: `calculationCodeChangedSinceMeasuredHead = []`） |
| benchmarkCodeSha256 | `a3d028e6df713c970e57a0b37a7f32c0273f6812a3141d8421f0f63d0f14fba7`、`uncommittedBenchmarkCode = false`、formal |
| Export | `gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、SHA-256 `cc35fb5b…e1e6b`（commitしない） |
| C2.5-A evidence | `PLANNER_GLOBAL_PHASE2C25A_RESULT.json` SHA-256 `a6e38294a5c9137a7d62a3f57d552af637a67d115e1fd04541713b27823e87dd`（measured `a479bc2`） |
| 環境 | Node v24.19.0 / V8 13.6.233.17-node.51、Windows 10.0.26200 x64、AMD Ryzen 7 9700X（16 logical）、物理memory 33.4 GB |
| 条件 | 1 Search = 1 fresh Node child、`--max-old-space-size=8192`、concurrency 1、jit_default、candidate stop 1、`setImmediate` yield、run budget 20分、extent Normal 4 / Gogma 235 / Skill 4（C2.5-Aと同一） |

harness: `scripts/run-planner-global-phase2c25d2a.mjs`（run）、`scripts/analyze-planner-global-phase2c25d2a.mjs`（post-hoc）、
`src/benchmarks/plannerGlobalPhase2C25D2A.ts`（before / after比較）。Search呼び出しはC2.5-Aの `runPhase2C25ASearchOnly()` を
変更せず使い、instrumented modeは既存の `createCountingRngEngine` / `createPlannerAlternativeSearchObserver`（C2.5-Aの
progress observer経由）だけを使った。新しいSearch decision instrumentationは追加していない。minimal modeはSearch外のtimer
（2秒）で `process.memoryUsage()` を採るだけである。

### 4.2 workload selection

C2.5-A evidenceからC2.5-Cの `selectPhase2C25CWorkload()`（規則を変えずに再利用）で導出した。source内にTarget / Entry / orientation IDは
固定していない。

- OOM representatives: C2.5-A evidence `contexts` のうち `role = oom_representative`、`classification = search_only_oom_reproduced`、
  両modeで `out_of_memory` の全件 → c0-p0#0、c12-p0#0、c2-p1#0
- controls: C2.5-A evidenceの `contexts` 順（C2.5-Aのselection順、次にwork index）で、completed_controlのうち両modeで
  `first_candidate` の最初 → c8-p1#0、両modeで `stopped_by_extent_before_candidate` の最初 → c13-p4#0

### 4.3 pre-search context parity

contexts childでこのrun自身のbaseline（Production Planner over Export）から `derivePhase2C25APreSearchContexts()` で再導出し、
orientationId / workIndex / targetWeaponId / status / invalidated Entry / invalidated Route key SHA / fixed Route Entry /
reservation / excluded Route key SHA / extent / originDigest / contextDigestをC2.5-A evidenceとfield単位で比較した。**5 / 5一致**
（不一致ならSearchを開始しないfail-closed）。各search childも再導出したcontext digestを照合してから実行した。

### 4.4 OOM代表の結果

| context | mode | before（C2.5-A） | after（D2-a） | after wall |
| --- | --- | --- | --- | --- |
| c0-p0#0（deep） | minimal | out_of_memory | **stopped_by_extent_before_candidate** | 38.0 s |
| c0-p0#0（deep） | instrumented | out_of_memory | **stopped_by_extent_before_candidate** | 37.9 s |
| c12-p0#0（shallow） | minimal | out_of_memory | out_of_memory | 91.4 s（before 76.4 s） |
| c12-p0#0（shallow） | instrumented | out_of_memory | out_of_memory | 94.8 s（before 77.3 s） |
| c2-p1#0（shallow） | minimal | out_of_memory | out_of_memory | 101.2 s（before 67.3 s） |
| c2-p1#0（shallow） | instrumented | out_of_memory | out_of_memory | 102.2 s（before 78.1 s） |

OOMを脱したのは **3件中1件（c0-p0）**。c0-p0はfirst Candidateに到達しておらず、extent内のGogma位置を最後まで読み切って
`stoppedByExtent = true`（`exhausted = false`、delivered 0）で終わった。これは新規観測であり、以前と同一の結果ではない
（C2.5-AではOOMしたので比較対象のCandidate / summaryは存在しない）。first Candidateへ到達したOOM代表は無いので、新規Candidateの
stable keyは無い。

### 4.5 memoryと進行の比較

`sampledMax*` は `process.memoryUsage()` のperiodic sample（instrumentedはprogress snapshot、minimalは2秒timer + pre / post-Search）の
最大値であり、**真のpeakではない**。OOM runのbefore値はC2.5-Aの最後のsnapshot（= sampled max）である。C2.5-A minimalはmemoryを
sampleしていないので、そのbeforeは「—」。V8 fatal GCはOOM死亡時のV8自身のtrace（Mark-Compact直前のused MB）。

| context / mode | status | sampledMax heapUsed | sampledMax heapTotal | sampledMax RSS | V8 fatal GC used | maxRSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| c0-p0 minimal | OOM → extent | — → 4.50 GB | — → 4.62 GB | — → 4.81 GB | 8182 MB → — | — → 4.70 GB |
| c0-p0 instrumented | OOM → extent | 8.50 → 4.47 GB | 8.52 → 4.59 GB | 8.81 → 4.79 GB | 8175 MB → — | — → 4.67 GB |
| c12-p0 minimal | OOM → OOM | — → 7.11 GB | — → 8.66 GB | — → 9.03 GB | 7977 → 6804 MB | — |
| c12-p0 instrumented | OOM → OOM | 8.02 → 7.13 GB | 8.38 → 8.65 GB | 8.68 → 9.02 GB | 7978 → 6811 MB | — |
| c2-p1 minimal | OOM → OOM | — → 7.08 GB | — → 8.66 GB | — → 9.02 GB | 8010 → 6891 MB | — |
| c2-p1 instrumented | OOM → OOM | 8.32 → 7.11 GB | 8.63 → 8.65 GB | 8.92 → 9.05 GB | 8010 → 6824 MB | — |
| c8-p1 minimal | first → first | — → 0.55 GB | — → 0.68 GB | — → 0.79 GB | — | 3.81 → 0.78 GB |
| c8-p1 instrumented | first → first | 3.67 → 0.60 GB | 3.75 → 0.69 GB | 3.92 → 0.80 GB | — | 3.83 → 0.78 GB |
| c13-p4 minimal | extent → extent | — → 0.38 GB | — → 0.48 GB | — → 0.58 GB | — | 2.44 → 0.62 GB |
| c13-p4 instrumented | extent → extent | 2.26 → 0.40 GB | 2.35 → 0.50 GB | 2.49 → 0.65 GB | — | 2.44 → 0.64 GB |

shallow型のD2-a後OOMでは、V8のfatal Mark-Compact時点でusedが約6.8 GB、committedが約8.26 GB（上限）だった。usedの最終sampleは
約7.1 GBで、heapTotal（committed）が上限に張り付いて死亡している。

進行（instrumented、before → after。OOM runは最後に受信したsnapshotの値）:

| context | Gogma max depth | 累積Gogma generated | 累積Gogma frontier | 1 depthの最大generated（全stream合計） | settled work | Skill max depth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| c0-p0 | 134 → 233 | 898,590 → 2,360,100 | 872,067 → 2,331,740 | 11,880 → 18,558（depth 218） | 804 → 1,410 | 4 → 4 |
| c12-p0 | 5 → 12 | 4,274,305 → 17,403,169 | 165,358 → 546,316 | 1,964,741 → 1,964,741（depth 3） | 47 → 101 | 3 → 3 |
| c2-p1 | 7 → 18 | 4,306,320 → 17,267,064 | 175,225 → 652,568 | 1,099,490 → 1,256,560（depth 3） | 55 → 140 | 4 → 4 |
| c8-p1 | 101 → 101 | 493,595 → 493,595 | 450,388 → 450,388 | 7,410 → 7,410 | 500 → 500 | 0 → 0 |
| c13-p4 | 234 → 234 | 125,860 → 125,860 | 125,690 → 125,690 | 1,005 → 1,005 | 1,184 → 1,184 | 3 → 3 |

（c2-p1の「1 depthの最大generated」はdepth 3に到達したstream数が増えたための全stream合計の増加であり、同じstreamのstate数が
変わったのではない。controlは全項目が不変。）

prediction counts（Normal / Skill / Reset / Keep、instrumented）:

| context | before | after |
| --- | --- | --- |
| c0-p0（OOM → extent） | 4 / 5 / 149 / 11,072（OOM直前） | 4 / 5 / 233 / 25,474（完走） |
| c12-p0（OOM） | 4 / 4 / 118 / 7,383 | 4 / 4 / 125 / 8,216（OOM直前） |
| c2-p1（OOM） | 4 / 5 / 104 / 5,873 | 4 / 5 / 115 / 7,099（OOM直前） |
| c8-p1（control） | 4 / 5 / 119 / 6,079 | 4 / 5 / 119 / 6,079（一致） |
| c13-p4（control） | 4 / 4 / 234 / 25,874 | 4 / 4 / 234 / 25,874（一致） |

OOM代表のprediction countsの差は「より先まで進んだ」ことによる差であり、同じ地点での比較ではない。

time to first Candidate / Search時間: c8-p1 10,506 → 4,577 ms（minimal）、10,458 → 4,759 ms（instrumented）。c13-p4のSearch時間
4,553 → 2,241 ms（minimal）。c0-p0はCandidate無しでSearch 35.4 s（minimal）。

生成stateあたりの保持heap（記述的比。最後のsnapshotのheapUsed − pre-Search heapUsed を累積generatedで割った値で、allocation
attributionではない）: c0-p0 約9.1 kB → 約1.8 kB、c12-p0 約1.8 kB → 約0.39 kB、c2-p1 約1.9 kB → 約0.40 kB。

### 4.6 control semantic parity

| control | mode | status | Search summary | first Candidate key SHA | prediction counts | extent / exhausted |
| --- | --- | --- | --- | --- | --- | --- |
| c8-p1#0 | minimal | 一致 | 一致 | 一致（`39d2d787…fd5e`） | —（minimalは数えない） | 一致 |
| c8-p1#0 | instrumented | 一致 | 一致 | 一致 | 一致 | 一致 |
| c13-p4#0 | minimal | 一致 | 一致 | 一致（null） | — | 一致 |
| c13-p4#0 | instrumented | 一致 | 一致 | 一致 | 一致 | 一致 |

minimal / instrumentedのsemantic digest（status、summary、first key）は、正常終了した全contextで一致した（不一致0件）。

## 5. optimization attribution

D2-aで直接削減したのは、非Ideal positionについての次のものである。

- `RouteBonusSolution` / `RouteSkillSolution` object
- Route operation配列（`bonusAmendmentOperations()` の `steps.slice` とown amendmentごとの `RouteOperation`、`resetSkillsOperations()`）
- `amendmentResults` 配列（`bonusAmendmentResults()` / `skillAmendmentResults()`）
- evaluated objectとsemantic key文字列（`bonusKey` / `retentionKey` / `operationTypeKey` / `semanticKey`）、`materialQuantity`
- sort入力と `{...evaluated, index}` のcopy
- `channel.retained` のentry（Planner AlternativeではIdealだけ）

残るもの（D2-aでは変えていない。heap内訳の再計測はしていない）:

- held-aware streamのraw state（`bonusStream` の `set.depths` が全depthの全generated stateをstreamの寿命中保持）
- raw solutionごとの `steps[]`（長さ = depth、shared step objectへのpointer配列）
- result node chain（`BonusAmendmentResultNode`）
- stream生成中の1 depth分の `generated` 配列（c12-p0のdepth 3で約196万state、c2-p1で約126万state）
- frontier reductionの作業領域
- prediction memo（Resetは位置ごと、Keepはfamily layoutと位置ごと）
- 全raw solutionに対する `satisfiesIdealBonuses()` の一時allocation

## 6. formalに言えること

1. D2-aのIdeal-only publicationは、測定した全semantic acceptance（PR #173 baseline、33パターンparity、実Export control 2件）で
   Planner AlternativeのCandidate / 順序 / summary / prediction / exclusionを変えていない。
2. 実ExportのSearch-only OOM代表3件のうち、deep型c0-p0は両modeでOOMせずextentまで読み切る（Candidateなし）。
3. shallow型c12-p0 / c2-p1は8 GB Node childで依然OOMするが、死亡までの累積生成state数は約4倍、到達depthは2倍以上に伸びた。
4. 生成stateあたりの保持heapは記述的比で約1/5に下がり、completed controlのsampled max heapUsedは約1/6になった。

## 7. まだ言えないこと

- このExportのPlanner Alternative kernelがOOMしなくなったこと（測定はSearch-only first Candidate run 5 contextで、2件はOOM継続）。
- Browser（Chrome Dedicated Worker）での効果（D2-b）。
- 真のpeak heap（すべてsampled max、OOM beforeはC2.5-Aの最後のsnapshot）。
- D2-a後のshallow OOMでheapを保持している構造（D2-aではheap snapshot / profileを取っていない。§5の残存構造はC2.5-C / D1からの
  持ち越しで、再計測していない）。
- c0-p0がより広いextentでCandidateに到達するか、Candidateが存在するか。

## 8. D2-bへ進むべきか / 次のmemory optimization候補

- **D2-bへ進むことを推奨する。** Search semanticsは不変で、Nodeでの効果（1件OOM脱出、他2件も約4倍進行、controlのheap約1/6）は
  十分大きい。D2-bではC2.5-Bと同じChrome Dedicated Workerで同じcontextを再測定する。shallow型はBrowserでも引き続きOOMする
  見込みとして結果を受け入れる。
- **shallow型（c12-p0 / c2-p1がOOM継続）**: held-aware stream自身のraw state保持が次候補。`set.depths` は各depthをchannelが1回読むだけ
  なのに全generated state（bonuses、`steps[]`、result node）をstreamの寿命中保持しており、1 depthで最大約200万stateをfrontier縮約前に
  生成する。候補は「全購読channelが読み終えたdepthを `set.depths` から解放する」「`steps` をresult node chainから必要時に導出する」
  「1 depthの生成working setを抑える」。いずれもstream側の変更であり、D1と同様にlate subscriber / replayのsemantic監査を先に行う。
- **deep型（c0-p0はOOMを脱したが約4.5 GB）**: 累積state × depthで増える `set.depths` / `steps[]` の長期保持が同じく次候補。
- 選択の前に、C2.5-Cと同じ手順でD2-a後のshallow OOMのheap snapshotを取り、上の候補のどれが残りのheapを保持しているかを
  確認するのが確実である。

## 9. 変更境界

- Production: `src/domain/search/targetSearchScheduler.ts`（`planner_alternative` 分岐2か所とコメント）、コメントのみ
  `src/domain/search/streamSolutions.ts` / `src/domain/search/routeSearchShared.ts` / `src/domain/search/alternative/plannerAlternativeSearch.ts`
- formal spec: `docs/SEARCH_SPEC.md` 5.6.8（既存semanticsの明文化1項目）
- test / fixture: `src/domain/search/alternative/plannerAlternativeIdealOnlyPublication.test.ts`、
  `src/test/fixtures/plannerAlternativeIdealPublicationParity.ts`、`src/test/fixtures/plannerAlternativeIdealPublicationPreD2.json`、
  `src/benchmarks/plannerGlobalPhase2C25D2A.test.ts`
- Research harness: `src/benchmarks/plannerGlobalPhase2C25D2A.ts`、`scripts/run-planner-global-phase2c25d2a.mjs`、
  `scripts/analyze-planner-global-phase2c25d2a.mjs`
- evidence: `docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json`、本書
- 変更なし: PR #173のtest（期待値を含む）、`initial_candidate_search` policy、stream、Lazy Ideal Cross、Worker protocol、defaults、
  schema / version、Persistence、UI
