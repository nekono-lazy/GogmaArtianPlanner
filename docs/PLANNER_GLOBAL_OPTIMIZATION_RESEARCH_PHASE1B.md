# Global Planner Research Phase 1-B

Refs #154。開始時のmain / origin/main / remote mainは
`60ac13f4944ee50bad070fb9dcf1e6392e596a94`（PR #160）、Working Treeはclean。
Phase 0はPR #159。作業branchは `codex/global-planner-phase1b`。

## 目的と変更境界

Gogma predictionが同じraw RNG blockをseedから毎回生成するコストを直接計測し、
限定寿命のResearch cacheで次のGlobal discovery研究を速く回せるか判断する。
43/43への探索改善、ordering / retry、portfolio、staged Search、Issue #157は対象外。
Phase 0 / failed-firstの探索algorithm、保持集合、canonical ordering、extent、Plannerは変えない。

Productionコードの変更は `gogmaPrediction.ts` と `productionRngEngine.ts` のraw reader注入seamのみ。
`new ProductionRngEngine()` は従来どおり `readReferenceRngBlock` を使い、cacheを持たない。
RngEngine interface、Worker、UI、DB、Export、通常Search API、default extent / maxPlanStepsは変更なし。
versionはRNG `production-rng:c5-e7`、CalculationContext **17**、Dexie **10**、Export **13**のまま。
ProductionからResearchへのimport禁止テストとbuild artifactの検査を実施した。
REQUIREMENTSの自動再検索contract、GARP reference parity / game-verified / unverifiedの境界も不変。

参照authority: REQUIREMENTS 14 / 19 / 23 / 32、RNG_SPEC 5 / 6.1 / 7、SEARCH_SPEC 3.1 / 5.5 / 5.6、
PLANNER_SPEC 7 / 9.2 / 11、DATA_MODEL 9 / 11 / 16、MASTER_DATA 8、
PLANNER_GLOBAL_OPTIMIZATION_RESEARCH、PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE1、AI_DEVELOPMENT_WORKFLOW。

## raw block構造・計測seam・cache

経路は `ProductionRngEngine.predictGogmaBonus()` → Reset / Keep predictor → `referenceGogmaBlock()`
→ `deriveGogmaSeed(baseSeed, weaponTypeId, elementId)` → `readReferenceRngBlock(seed, effectiveBlock)`。
reference readerはPRNGをinitializeし、`blockIndex * 10`回advanceしてから10個のuint32を読む。
initialize / next-state / uint32 / block size / seed derivation / gate / drawは既存authorityをそのまま使う。

Engine constructorの省略可能なreader引数をGogma predictorへ渡すだけで、通常callerの引数は不変。
Researchは `src/benchmarks/plannerGlobalRawBlocks.ts` のobserverを注入する。
keyはreaderが**実際に受けたderived seedとeffective block indexの組**（区切り付き完全な整数表現）。
Target ID・Counterのみ・Keep layout・operation typeをkeyにしない。gateより前のCounterを使わない。
Productionのactive representativeは35、referenceのgate未満はeffective block 0のまま。

observerは全要求を記録する。cache offではreaderへ毎回ちょうど1回渡し、同じ戻り値参照・同じ例外を返す。
`missReadElapsedMs` はreference readerの呼出しだけを囲む直接wall-clock計測。
`readerElapsedMs` はlookup / miss reader / immutable copy / cache更新までを含む。
key・Set・histogram集計はその外側だがGogma prediction計測の内側。
したがってGogma時間から直接raw時間を引いた残差にはdraw / support / adapter / validationだけでなく
observer、allocation / GC、clockの影響も含まれる。厳密なCPU profilerによる内訳ではない。

cacheするのは成功したraw blockだけ。例外は保持せず、support判定、seed導出、effectiveBlock計算、
Reset / Keepのfamily・slot順・weighted drawは毎回通る。Counter進行、Search checkpointは変更しない。
cache側が値をcopyして配列とblockを両方freezeするため、consumerが後続hitの値を破壊できない。

- `off`: raw値を保持しない。unique keyは観測用だけに保持。
- `per-search`: 1 Candidate Searchの開始から終了・例外・cancelまで。終了時にclear。
- `run`: 1 ResearchインスタンスのSearch間だけ共有し、run終了時にclear・再利用禁止。
  Planner / Trace Replayには共有しない。プロセスをまたがず、永続化も行わない。
- cache上限は20,000 entries、超過時はFIFO eviction。再missは同じreference readerで再生成するだけ。
  上限2でevictionを強制するSearch全結果parityテストもある。
- `peakEntries` / `rawUint32Count` / `approximatePayloadBytes` を記録。
  bytesは10 words × 4 bytesの**packed uint32換算**であり、JS number / array / Map / keyの実heap量ではない。
  観測用SetやPhase 1-A exact prediction profilerのmemoryも別途あり、process peak RSSと混同しない。

最初の予備試行はcommit `b3b994f` の813fb479 snapshotでoff→per-searchの順に実施した。
Search 33.99→6.83秒、Gogma 26.46秒中raw 25.88秒（約97.8%）、99,688要求 / 500 unique、
Search semantic SHA-256一致を確認してからrun-scoped実験を追加した。
この予備値は以下の正式比較値とは混ぜない。

## 再現条件と正式測定commit

正式測定commit: **`96739059ed603607018cc48c98cba662f76f46f8`**。
以降のcommitは結果JSON・研究文書のみ。各raw reportの `environment.repositoryHead` と一致する。
`benchmarkCodeSha256` はtracked src / scripts / package / lock / Vite / TS configのpathと内容を連結したSHA-256。
runnerはbenchmark対象の未commit差分があれば測定を拒否する。

正式code hash: `b3818a8a7f7349d2de7dfe719a5650113bf0945c2efffc62c0eb594a4b6afdd5`。
環境はNode **v24.19.0**、Windows x64 **10.0.26200**、AMD Ryzen 7 9700X、16 logical CPUs、
physical memory 33,377,591,296 bytes。

外部Export: `gogma-artian-planner-backup_20260927015837.json`。
SHA-256はPhase 0 / 1-Aと一致:
`cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`。
Exportと `phase1-projected-inputs.local` はcommitしない。各focused reportはsnapshotのSHA-256も持つ。
Node immediate、routeFilter all、基準extent N350 / G500 / S1500、maxPlanSteps 20000。
拡大focusedだけN700、他の条件は同じ。focused budgetは180秒。
各試行は別Node processで逐次実行し、test / build / 他benchmarkと並行実行しない。
Node version、OS release、CPU、Export SHA、mode、cache mode、extent、yield modeを各raw reportに記録。

```powershell
node scripts/run-planner-global-phase1b.mjs '<external Export>' 'phase1-projected-inputs.local'
```

suiteは既存出力を拒否し、focused off→onとparity、Phase 0 off→onとparity・改善を順に確認してから
run-scoped / failed-firstへ進む。failed-firstは今回のPhase 0 off reportの実際の未発見Targetだけから作る。
既知oracleのCounter / ID / 順序は使わない。単発Node計測であり、Browser Worker性能や性能分布ではない。

## semantic parityの証跡

小さいProduction Engine fixtureではSearch結果、generated Entry、final Planを直接deep equalityで比較。
実Exportでは完全なsemantic bodyのSHA-256を保存し、suiteが比較する。巨大なCandidate / Plan本文はcommitしない。

- Search結果は `elapsedMs` だけを除外。canonical Candidate全field（slot順、全operations、Skill、advance、trace、
  intermediate groups、identityを含む）とsearchedRoutes / skippedRoutes / warningsを含む。
- Candidate単体、generated Candidate、generated Entry全bodyとID、selected Entry IDs、Plan全body、
  final PlannerResult全body、Entry集合＋finalResultのSHA-256をそれぞれ保存。
- input fingerprint、保持ID、Search順、Targetごとのstatus、Conflict / rejected、steps、termination、
  Replay結果、prediction call数、settled work、checkpoint / yield数も比較。
- deterministic Research timestampは一致させたままbodyに含める。cache mode、実時間、memory、
  raw hit/miss等の観測差だけを除外する。完成数だけでparityを判定しない。
- Planner / Trace Replayはoff/onとも**cacheなしの通常Production Engine**で実行する。
  cacheが誤ったCandidateを作れば既存Replay authorityが独立に拒否できる。

## raw block直接profile（Phase 0順・cache off）

raw: [PHASE0_NO_CACHE](PLANNER_GLOBAL_PHASE1B_PHASE0_NO_CACHE.json)。Search内Gogma要求だけを対象とし、
Planner / Replayのraw要求はこのprofileに混ぜない。

**Gogma prediction 183.174秒のうちreference raw readerは178.212秒、97.291%。残差4.962秒。**
raw readerはSearch 281.061秒の約63.4%を占めた。raw取得が主因というPhase 1-Aの仮説を直接計測で支持する。
Normal / Skillを含むprediction全体は185.049秒。上記はwall-clock instrumentationによる概算であり、
GC等を厳密に分離したCPU時間ではない。

要求857,535、run全体のunique `(seed, effectiveBlock)` は5,830、重複851,705、
run-scoped理論hit率99.320%。最大blockIndexは3,653。
blockIndex分布（要求件数）は256..511: 3,589、512..1023: 66,249、1024..2047: 111,524、
2048..4095: 676,173。各Targetの分布もraw reportに記録した。

以下のuniqueはTarget内の値であり、合計をrun全体uniqueと呼ばない。
各行のduplicateはrequests − unique、理論hit率はその値 / requests（rawに明記）。時間は秒。

| Target | requests | unique | Gogma全体 | raw直接 | 残差 | raw比率 | max block |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| be881717 | 12330 | 156 | 0.582 | 0.523 | 0.059 | 89.89% | 586 |
| e96249b4 | 52266 | 343 | 3.487 | 3.249 | 0.238 | 93.18% | 929 |
| 9733b090 | 18694 | 216 | 1.625 | 1.526 | 0.099 | 93.89% | 1145 |
| 2e26c0b1 | 10205 | 139 | 1.022 | 0.969 | 0.053 | 94.80% | 1284 |
| a6c17e25 | 2856 | 71 | 0.305 | 0.289 | 0.016 | 94.75% | 1355 |
| c140578c | 49119 | 330 | 6.199 | 5.932 | 0.267 | 95.69% | 1671 |
| 57126a5e | 24136 | 222 | 3.610 | 3.473 | 0.138 | 96.19% | 1893 |
| 27ac3237 | 12926 | 162 | 2.040 | 1.967 | 0.072 | 96.46% | 2055 |
| a830a376 | 106153 | 500 | 19.760 | 19.132 | 0.628 | 96.82% | 2555 |
| 02876df4 | 35949 | 279 | 6.644 | 6.439 | 0.205 | 96.92% | 2410 |
| 8d233d8b | 5123 | 98 | 1.055 | 1.023 | 0.032 | 96.96% | 2507 |
| 46bf2c78 | 25220 | 234 | 5.240 | 5.091 | 0.149 | 97.15% | 2726 |
| b27e57a7 | 58617 | 363 | 12.883 | 12.526 | 0.357 | 97.23% | 2931 |
| b6780f04 | 1818 | 57 | 0.383 | 0.371 | 0.012 | 96.85% | 2707 |
| fea60316 | 11844 | 156 | 2.619 | 2.546 | 0.072 | 97.23% | 2816 |
| 2378d3e0 | 103165 | 500 | 25.801 | 25.166 | 0.634 | 97.54% | 3316 |
| 45b13c06 | 9977 | 138 | 2.178 | 2.129 | 0.048 | 97.78% | 3027 |
| 711f7d15 | 50352 | 336 | 12.412 | 12.139 | 0.273 | 97.80% | 3363 |
| 6c65c924 | 33380 | 269 | 8.315 | 8.120 | 0.195 | 97.66% | 3300 |
| 188571a7 | 17925 | 194 | 4.800 | 4.676 | 0.123 | 97.43% | 3227 |
| 813fb479 | 99688 | 500 | 28.898 | 28.293 | 0.605 | 97.91% | 3652 |
| 1efa01c6 | 9848 | 141 | 2.793 | 2.732 | 0.061 | 97.82% | 3293 |
| 86439c85 | 105944 | 500 | 30.524 | 29.899 | 0.625 | 97.95% | 3653 |

## focused off / per-Search cache

raw: [FOCUSED_NO_CACHE](PLANNER_GLOBAL_PHASE1B_FOCUSED_NO_CACHE.json) /
[FOCUSED_CACHE](PLANNER_GLOBAL_PHASE1B_FOCUSED_CACHE.json)。5組すべて完全semantic parity passed。
時間は秒、rawはreference reader直接計測（hit lookupを含まない）、GはGogma prediction全体。

| Target / Normal extent | status / cost | work | Search off → on | speedup | G off → on | raw off → on |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 813fb479 / 350 | not_found_within_extent | 2,350 | 33.092 → 6.813 | 4.857× | 25.728 → 0.497 | 25.115 → 0.141 |
| 813fb479 / 700 | found / 896 | 2,562 | 34.193 → 6.641 | 5.149× | 26.766 → 0.502 | 26.142 → 0.148 |
| a830a376 / 350 | found / 783 | 9,351 | 38.671 → 17.986 | 2.150× | 20.082 → 0.564 | 19.488 → 0.112 |
| 86439c85 / 350 | found / 581 | 6,580 | 42.663 → 12.891 | 3.309× | 29.034 → 0.590 | 28.407 → 0.164 |
| 2378d3e0 / 350 | found / 593 | 4,461 | 36.848 → 12.276 | 3.002× | 23.994 → 0.537 | 23.400 → 0.124 |

| Target / Normal extent | requests | unique | hits | hit率 | Candidate fingerprint off = on | peak RSS GiB off → on |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| 813fb479 / 350 | 99,688 | 500 | 99,188 | 99.498% | null | 1.336 → 1.100 |
| 813fb479 / 700 | 100,155 | 500 | 99,655 | 99.501% | fnv1a32:37b97ddc | 1.209 → 1.109 |
| a830a376 / 350 | 106,153 | 500 | 105,653 | 99.529% | fnv1a32:f215d077 | 1.982 → 1.574 |
| 86439c85 / 350 | 105,944 | 500 | 105,444 | 99.528% | fnv1a32:90a64d20 | 1.790 → 1.425 |
| 2378d3e0 / 350 | 103,165 | 500 | 102,665 | 99.515% | fnv1a32:722285a9 | 0.862 → 0.799 |

全ケースでcache high-waterは500 entries / 5,000 uint32 / packed 20,000 bytes、eviction 0。
cache offのduplicate request数はonのhit数と同じであり、cache off自身のhitは0。
N700 Candidateは `normal_artian_to_gogma`、**N643 / G1 / S252、896操作**を維持。
a830a376は `existing_gogma_mixed`、他のfound2件は `normal_artian_to_gogma`。
Candidate全bodyのSHA-256もrawに記録しており、表のFNV fingerprintだけで同値を判定していない。

## Phase 0順 full runとcache lifetime比較

raw: [NO_CACHE](PLANNER_GLOBAL_PHASE1B_PHASE0_NO_CACHE.json) /
[PER_SEARCH](PLANNER_GLOBAL_PHASE1B_PHASE0_CACHE.json) /
[RUN_CACHE](PLANNER_GLOBAL_PHASE1B_PHASE0_RUN_CACHE.json)。単位は秒。

| 項目 | off | per-Search | run-scoped |
| --- | ---: | ---: | ---: |
| Search total | 281.061 | 91.282 | 84.522 |
| prediction total（N/G/S） | 185.049 | 6.341 | 5.675 |
| Gogma prediction | 183.174 | 4.574 | 4.011 |
| raw reference reader直接 | 178.212 | 1.117 | 1.049 |
| raw reader seam全体（hit lookup等含む） | 178.345 | 1.206 | 1.132 |
| Planner total（Replay / projection含む） | 60.193 | 59.167 | 57.463 |
| total elapsed | 351.749 | 160.502 | 151.454 |
| raw requests | 857,535 | 857,535 | 857,535 |
| raw misses | 857,535 | 5,904 | 5,830 |
| raw hits | 0 | 851,631 | 851,705 |
| hit率 | 0% | 99.3115% | 99.3201% |
| peak cache entries | 0 | 500 | 5,830 |
| raw uint32 count | 0 | 5,000 | 58,300 |
| packed payload bytes | 0 | 20,000 | 233,200 |
| peak RSS GiB | 3.099 | 3.097 | 3.099 |

全3試行で保持20、再検索23、generated replacement22、未発見1、
**42/43 completed、Conflict2（Normal1 / Skill1）、rejected1、7,330 steps、termination exhausted、
Trace Replay passed**。Plan bodyと全Entry / Candidate・Search順・workも一致した。
全試行でraw failure / evictionは0。

変更前Phase 1-A immediateのinput fingerprint `fnv1a32:53b2ed88` とも一致。
最終結果＋generated EntriesのSHA-256はPhase 1-Aおよび今回3モードで共通の
`d799923f94d3803325af20686618aff371cfc31eb7d33bcffd6a01b9e70ccc0e`。

off→per-SearchのSearch speedupは**3.079×**、totalは**2.192×**。
peak RSS差は **−2.246 MiB**であり、全体memoryが大きく改善したとは言わない。
run-scopedはper-Searchより74 readsだけ少ない。Search全体6.759秒の差はraw直接時間差0.067秒より
大きく、GC・process状態・単発測定の変動を含む。長寿命cacheで確実にこの差が得られるとは解釈しない。

Phase 1-Aの過去off（Search283.521 / total354.014秒）にも近いが、speedupの分母には今回の同一HEAD offを使った。
`totalElapsedMs` は検証済みPlannerInputから結果まで、Vite起動・Export parsingは除外する。
RSSはそれらも含むprocess全体。maxPlanSteps 20000はResearch boundでありProduction defaultの変更ではない。

## failed-first off / per-Search cache

raw: [NO_CACHE](PLANNER_GLOBAL_PHASE1B_FAILED_FIRST_NO_CACHE.json) /
[CACHE](PLANNER_GLOBAL_PHASE1B_FAILED_FIRST_CACHE.json)。Phase 0順でparityと改善が成立した後に実施。
既存failed-first algorithmのまま、今回のPhase 0 offで未発見だった813fb479だけを先頭へ移した。

| 項目 | off | per-Search |
| --- | ---: | ---: |
| Search total 秒 | 153.248 | 63.512 |
| prediction total 秒 | 95.930 | 4.848 |
| Gogma prediction 秒 | 94.413 | 3.202 |
| raw reference reader直接 秒 | 91.331 | 0.675 |
| raw reader seam全体 秒 | 91.418 | 0.741 |
| Planner total 秒 | 46.230 | 50.463 |
| total elapsed 秒 | 206.525 | 122.297 |
| requests | 628,532 | 628,532 |
| unique（run全体） | 4,608 | 4,608 |
| misses | 628,532 | 4,627 |
| hits / hit率 | 0 / 0% | 623,905 / 99.2638% |
| peak RSS GiB | 3.078 | 2.699 |

**Search 2.413×、total 1.689×、peak RSS差 −387.758 MiB**。
offのGogma時間に占めるraw比率は96.736%、残差3.082秒。
per-Search high-waterは500 entries / 5,000 words / packed20,000 bytes、failure / eviction 0。
run全体duplicateは623,924、理論run hit率99.2669%。failed-firstのrun-scoped性能試行は追加していない。

両方とも保持20、再検索23、generated22、未発見1、**42/43、Conflict2、rejected1、6,214 steps、
termination exhausted、Trace Replay passed**。未発見はPhase 1-A同様711f7d15へ移り、43/43にはならない。
完全Candidate / Entry / Plan parityが成立し、変更前Phase 1-A failed-firstとも最終fingerprintが一致:
`2242740c0eb6f161c62669c3a84748e41febbd8d509029686df76fca5c38cc1e`。

過去値141.032 / 184.863秒との差があるため、同一HEADの今回off/onを比較した。
cacheなしのPlanner時間は今回のonで逆に増えており、総時間はraw削減だけで決まらない。
それでも全体約2分、Search約1分となり、複数のdiscovery研究を繰り返す実用上の価値は大きい。
正式測定で2分以内を達成したとは扱わず、まして全43自動完成の所要時間とは呼ばない。

## cancel / exceptionとparity結果

raw: [CANCEL](PLANNER_GLOBAL_PHASE1B_CANCEL.json)。同じ813fb479 snapshot、runner側100ms後にcancel要求。
timer開始はsnapshot読込より前なので、Search elapsed自体は100msより短い。

| mode | 分類 | Search ms | checkpoint検出→return ms | runner要求→結果集計 ms | 最終報告work（下界） |
| --- | --- | ---: | ---: | ---: | ---: |
| off | cancelled | 87.296 | 0.108 | 2.657 | 0 |
| per-Search | cancelled | 85.123 | 0.122 | 2.619 | 100 |
| run | cancelled | 83.981 | 0.114 | 2.881 | 100 |

すべて `settledCountExact = false`。速いrunほど同じ実時間で進む量は変わり得る。
同じ時間で同じworkになるという主張ではなく、既存checkpoint・cancel分類・未完了扱いが保たれることを確認した。
deterministicな1回目yieldで止めるunit testは全modeで同じcancelを確認し、deadlineは別分類として検証する。
通常reader例外の再throw・失敗非cacheもunit testで確認済み。実Exportの完走試行にはraw例外なし。

[PARITY](PLANNER_GLOBAL_PHASE1B_PARITY.json) はfocused5組、Phase 0 per-Search、Phase 0 run、failed-firstの
**8比較すべてpassed**と比較対象のsemantic SHA-256を記録する。完成数の変化、Candidateの変化、
Search order / prediction count / work / canonical orderingの差はなかった。cancel試行を完走parity比較へ混ぜない。

## Production化判断と次Phase

判定は **A: Researchで効果大・parity成立 → Production化候補**。
本PRではProduction cacheを有効化しない。推奨候補は **per-Search lifetime**。
raw blockはGogma計算の97.291%を占め、Phase 0順のSearchは3.079倍、全体も2.192倍となった。
既存reader / support / drawを維持する小さいseamで実装でき、成功raw値だけをimmutableに扱える。
cache versionの永続invalidationは不要だが、ProductionではSearch job / Engineに寿命を閉じ、
cancel・例外・Worker破棄時の解放、上限、複数job間の隔離を別途確認する必要がある。

per-Searchで5,904 readsまで減り、run全体uniqueは5,830なので、Search間共有で追加削減できるのは
**74 reads（全857,535要求の0.00863%）**だけ。長い寿命をProductionの第一候補にする根拠は弱い。
実測のrun-scoped差は前節のとおりだが、単発の全体時間差を74 reads削減の因果効果とは扱わない。

Phase 0 per-Search runのSearch 91.282秒中、prediction全体は6.341秒、残りは約84.941秒。
Gogma prediction自体も4.574秒まで下がった。次の性能profileはdrawの小改善より、
**state / frontier / retention・queue / composition、allocation / GC**の内訳を優先する。
cacheだけではprocess peak約3.1GiBを解決しておらず、スマートフォン利用の実用性を証明したわけではない。

次のGlobal discovery Researchでは、最初にこのper-Search cache付き既存harnessを使い、
同じExport・保持集合から**事前に決めたordering / bounded retry比較**を行うことを推奨する。
未発見と打ち切りを分け、43/43・Conflict 0・最終Replayまでを評価する。今回の固定ID順序を製品policyにしない。
Production化の前には、別の検証としてBrowser Workerでoff/onの完全parity、実端末時間、memory、cancelを測る。
1回のdiscoveryを反復研究できるコストへ減らせたが、43/43が1〜2分で得られるとはまだ主張しない。

## 検証

- `npm run lint`: passed。
- `npm test`: **293 files / 4,752 tests passed**。
- `npm run build`: passed（既存の500kB超chunk warningあり）。
- `npx tsc -b --force`: passed。
- focused Vitest: 5 files / 44 tests passed。
- `git diff --check`: passed。

正式suiteは `node scripts/run-planner-global-phase1b.mjs <Export> phase1-projected-inputs.local` でexit 0。
構文確認 `node --check scripts/run-planner-global-phase1b.mjs` もpassed。
大きいExport・投影capture・進捗logはlocalのまま、commitする9つのraw / parity JSONは合計約572KiB。

新規テストはdefault reader / 固定game vectors、seedとeffectiveBlock別key、低gate、Reset / Keep、
別layoutでrawを共有しても別drawになること、freeze、例外非cache、support判定、prediction数、
Search全結果・work・identity、synthetic Global Entry / Plan / uncached Replay、cancel / deadline、
Search間hit、lifetime終了、evictionの結果不変性を検証する。既存import禁止テストをraw cacheへ拡張した。

## 未確認事項

Browser Worker / スマートフォンの速度・memory・cancel、複数回のばらつき、厳密なCPU / allocation / GC内訳、
Productionのcache寿命設計と多数Searchの長時間運転は未確認。既存のgame verification範囲も拡張しない。
全43 Targetの自動発見、global optimum、新ordering / retry、default bound変更は本Phaseの成果ではない。
