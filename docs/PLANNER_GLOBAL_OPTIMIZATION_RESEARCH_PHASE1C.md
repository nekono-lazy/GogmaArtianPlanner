# Global Planner Research Phase 1-C

**43/43は未達。** 8state / 206 Candidate Searchesのbounded研究はcycleで停止した。
固定retained20は42/43、retain-noneは41/43、直接Conflictから1件releaseしたretained19は19/43。
すべての完走attemptはTrace Replay passed。未達を解の不存在とは扱わない。

Refs #154。開始時のmain / origin/main / fetched origin/mainは
`5779eed743a31923f1231443ccfd70473415730a`（PR #161）、Working Treeはclean。
branch: `codex/global-planner-phase1c`。Phase 0 / 1-A / 1-B（PR #159 / #160 / #161）とIssue本文・コメントを確認した。

## 目的・変更境界

元の43 BuildListEntryから、oracleの答えを渡さず、deterministic / boundedな再試行で
43/43完成・Conflict 0・rejected 0・Trace Replay passedへ到達できるか検証する。
Phase 0のretained 20はResearch heuristicでありHard constraintではない。
既知oracleの43/43・2,982 stepsは比較基準だけである。18件の維持ID、25件の置換ID、順序、
Counter、TargetごとのRouteKind、oracle Candidate / Routeは入力にもcontroller判断にも使わない。

Production behavior変更なし。通常Search semantics / default extent、Planner routing、Worker protocol、UI、
Persistence / Dexie / Export schema、CalculationContext、RNG version、preferredOwnedWeaponId、
maxPlanSteps、manual Conflict UI、Issue #157を変更しない。raw cacheはResearch-onlyのper-search。
正式な自動再検索契約を本研究で改訂しない。global optimumの探索・証明ではない。

参照authority: REQUIREMENTS 14 / 19 / 20 / 23、PLANNER_SPEC 7 / 9 / 9.2.11 / 11、
SEARCH_SPEC 3.1 / 5.6、DATA_MODEL 9 / 11.8 / 11.9、RNG_SPEC 2 / 6 / 7、MASTER_DATA 8、
前3PhaseのResearch文書、AGENTS.md、AI_DEVELOPMENT_WORKFLOW。

## Phase 1-B基準

| 条件 | retained / pending | found / not found | completed | Conflict / rejected | steps | Search秒 | total秒 |
| --- | --- | --- | --- | --- | ---: | ---: | ---: |
| Phase 0順 + per-search | 20 / 23 | 22 / 1 | 42/43 | 2 / 1 | 7,330 | 91.282 | 160.502 |
| failed-first + per-search | 20 / 23 | 22 / 1 | 42/43 | 2 / 1 | 6,214 | 63.512 | 122.297 |

どちらもReplay passed。未発見が813fb479から711f7d15へ移り、単一greedy orderの限界が観測された。
今回のcontrollerはそれらのIDを含まない。Attempt 0を新しく実行して得たsignalだけを使用する。

## 独立attempt

`runGlobalPlannerResearch(originalInput, freshDependencies, options)` のResearch seamに、
retained Entry ID集合、全pending Target順序、extent、raw cache、cancel / time budgetを指定する。
既存Phase 0呼出しはこれらの追加指定を省略できる。元入力をdeep cloneし、replacements MapとProjected stateは
その呼出しのlocalだけに置く。ID factory / deterministic timestampもattemptごとに初期化する。

1. original Build Listでordinary Plannerを実行。Phase 0ではselected / progressedの和集合をretainedとする。
   明示stateではこのbaselineを保持集合の変更に使わない。baselineの再実行コストも各attempt時間へ含める。
2. original入力のretained Entryだけでordinary Plannerを再実行し、全retained Target完成、Conflict / rejected 0、
   Replayを検証する。失敗prefixを投影しない。release後も前attemptのprefixを使わない。
3. Plan start effectsと既存Execution transitionでprefixを投影する。
4. 全pending Targetを指定順にordinary Candidate Search (`routeFilter = all`)で毎回再検索する。
5. 既存Research materializerからcurrent factory / origin authorityを通して元起点のEntryへmaterializeする。
6. 各Candidateを単体ordinary Planner + Replayで投影する。次のTargetはこのattempt内の新しい投影状態から検索する。
7. original 43 Entriesのうち今回成功したものだけ置換し、未発見・失敗の元Entryは残す。
8. original Planner-start状態から全43件をordinary full Planner + Trace Replayへ通す。

retain-noneの空prefixもordinary Plannerへ通す。現行authorityは0件を `exhausted` / plan nullとして返すため、
0/0、空のbestState trace、Conflict / rejected 0を確認し、既存 `replayPlannerSearchTrace()` で空traceを検証する。
この場合だけ元状態を開始投影とする。非空prefixのcompleted要件は緩和しない。

既存Phase 0のmaterializer identityと各ordinary Planner呼出し順を維持するので、
明示的に同じretained / orderを渡した場合もCandidate / Entry / Plan bodyまで一致する。

## signal・順序・bounds

`PlanConflict.buildListEntryIds` と `RejectedBuildListEntry.buildListEntryId / reason` を使い、
そのattemptの最終Entry集合からTargetへ対応づける。表示用reason / detailは一切parseしない。
not_found_within_extent、resource_conflict rejected、unresolved Conflictの直接参加Targetは別配列で保存する。
retained / generated replacement / pending originalのparticipant roleも区別する。
未知のparticipant IDは推測せずエラーにする。

search_error、materialization_blocked、projection_failed、checkpoint_blocked、unavailable、cancel、timeoutは
別blockerでありbounded no-matchへ変換しない。blockerがあれば完成扱いをせずcontrollerを止める。
retained releaseでprefixが不成立のstateは記録して捨て、別stateを検討できる。

Strategy 1はPhase 0順から開始し、同じretainedで最大6 attempts。次のvariant候補を固定順で列挙して、
未実行signatureの先頭だけを実行する。group内でbaselineのordinary Planner priorityを維持する。

1. 最新attemptの未発見＋resource rejectedを先頭へ移す。
2. 過去の未解決集合を累積し、baseline priority順で先頭へ移す。
3. 最新→過去の観測順で未解決Targetを先頭へ置き、残りはbaseline順。
4. 最新の未解決Targetとunresolved Conflictの直接参加Targetを先頭へ移す。
5. 過去→最新の観測順で未解決Targetを先頭へ置き、残りはbaseline順。

未解決signalが同じでも未実行variantがある限り試せる。全候補が既実行ならcycleとしてStrategy 1を終える。
signatureはsorted retained Entry IDs、ordered pending Target IDs、3axis extentの完全JSON。
短いhashの衝突でstateを同一扱いしない。毎回の順序・理由・signatureをraw reportに保存する。
elapsed、cache hit率、CPU性能、乱数を順序判断へ渡さない。

Strategy 1未達の場合はretain-none controlをordinary stable Planner priorityで1回実行する。
control成功でも「全Routeを捨てるべき」と判断せず、bounded retained releaseを続ける。
release候補は、未発見／resource rejected Targetと同じ実測unresolved Conflictに直接参加するretained Entryだけ。
候補内ではordinary Planner priorityを使う。generated / pending participantをretainedと誤認しない。
parent stateに対して1件ずつreleaseし、深さは最大2。深さ2は組合せ爆発を防ぐResearch boundであり、
oracleの維持18という数から導いたものではない。初回・controlを含む全discoveryは最大12state。

releaseのparentを選ぶResearch順序は、成功、resource rejected少、Conflict少、completed多、
retained多、steps少、stable signatureのlexicographic順。Production objectiveを変更しない。
本runはbase extent N350 / G500 / S1500、Research maxPlanSteps 20000。
attempt budget 600秒、controller budget 3600秒。時間は停止にだけ使う。

## 計測・memory・再現性

正式measured commit: `49cc7cedde4b67780a61a63f5fb02063fb123cd4`。
benchmark code SHA-256: `9e629a2354ad6491ef74c07715722cb39b971f9662320454ca131044ffb0a3bd`。
Node v24.19.0、Windows x64 10.0.26200、AMD Ryzen 7 9700X（16 logical CPUs）、
physical memory 33,377,591,296 bytes。RNG `production-rng:c5-e7`。
Research childのold-space上限8192MiB、実際のV8 heap limitは8,791,261,184 bytes。
codeをcommit後、test / build / 他benchmarkと並行せずNode immediateで測定する。
runnerはsrc / scripts / package / lock / Vite / TS configの未commit・未tracked codeを拒否する。
各childのHEAD / code SHA / Engine version / Export SHAがcontroller中に変わった場合も拒否する。

```powershell
node scripts/run-planner-global-phase1c.mjs C:/Users/nekon/Downloads/gogma-artian-planner-backup_20260927015837.json docs/PLANNER_GLOBAL_PHASE1C_RESULTS_8G.json
```

Export SHA-256は `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`。
19MB Exportとattempt途中の `.local` 証跡はcommitしない。
各attemptは別Node processで元Exportを読み直し、前attemptのCandidate / Projected stateを受け取らない。
controllerが保持するのはreport、Search / Candidate / Entry / PlanのSHA-256、IDs、signalだけで、
Candidate / Plan全bodyや投影snapshotは保持しない。raw cacheの寿命は1 Search、上限20,000 blocks。
Planner / ReplayはcacheなしProduction Engineのまま。child終了で残るheapも解放される。

child maxRSSはVite / Export parseを含むprocess high-water。controller自身のmaxRSSも別に記録し、
両processが同時に存在することに注意する。maxRSSの和は同時peakの厳密測定ではない。
controller wall timeは失敗attempt、child起動、読込、集計も含む。Search / Planner合計、
attempt内部total、winner単体、独立再現の時間を分離する。独立再現はdiscovery累積時間には加えない。

成功stateは新規childで同じ元Exportから再実行し、retained / order、Search statusと完全semantic SHA、
Candidate fingerprints、generated Entry IDs / body SHA、selected IDs、Plan / result body SHA、
Conflict / rejected 0、Replayを比較する。時刻はdeterministic Research timestampを含めて比較し、
elapsed / memoryだけ一致不要とする。既知Phase 0 result SHAの比較はparity assertionだけで、探索入力ではない。

## 結果

### Strategy 1: 固定retained 20

5つの異なるstateを実行し、すべて42/43で止まった。各attemptはretained20 / pending23、
Search23、found22 / not found1、generated replacement22、Conflict2（same_normal_counter1 / same_skill_counter1）、
rejected1 / resource_conflict rejected1、Trace Replay passed。その他のblockerは0。
6回目に新しいorderがなく、既実行signatureを検出してcycle終了した。未発見を不可能と解釈しない。

| attempt | 順序の変更理由 | 未発見Target prefix | steps | expandedStates | Search秒 | Planner秒 | total秒 | peak RSS GiB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | Phase 0 baseline | 813fb479 | 7,330 | 7,372 | 87.275 | 56.272 | 152.953 | 3.844 |
| 1 | 最新未解決を先頭 | 711f7d15 | 6,214 | 6,256 | 58.827 | 48.635 | 116.456 | 2.868 |
| 2 | 最新未解決を先頭 | 813fb479 | 6,448 | 6,490 | 77.339 | 43.171 | 129.448 | 2.866 |
| 3 | 累積未解決をbaseline priority順で先頭 | 813fb479 | 6,448 | 6,490 | 61.651 | 37.286 | 105.198 | 3.328 |
| 4 | 最新→過去の未解決観測順で先頭 | 711f7d15 | 6,214 | 6,256 | 46.693 | 36.771 | 89.800 | 3.169 |

Target full IDs、完全なpending order、retained IDs、signalとConflict当事者、state signatureはraw reportに保存する。
Attempt0のresult SHAはPhase 1-Bと完全一致する:
`d799923f94d3803325af20686618aff371cfc31eb7d33bcffd6a01b9e70ccc0e`。
Attempt1も前段failed-firstのresult SHAと一致。Attempt2/3、Attempt1/4はそれぞれ最終Entry集合＋Planの
semantic SHAが同じだった。未発見Searchを前へ移しても投影状態を進めないため、別orderでも同じ完成集合に戻る。
この同値性は結果の観察であり、未探索orderの結果を予測して省略する規則にはしていない。

Attempt0のsame_normal_counterはpending originalの813fb479とgeneratedの711f7d15が直接参加し、
same_skill_counterは同じpending originalとretained Target820831d0が参加した。
このようにreplacement側は次attemptで再検索するもの、retained側はrelease候補として明確に区別できた。

### retain-none / retained release

retain-none（Attempt5）はstable Planner priorityで全43Targetを検索した。
**41 found / 2 not found、41/43 completed、Conflict2、rejected2 / resource_conflict2、
10,738 steps、expandedStates10,779、Trace Replay passed**。
未発見は `02876df4-cd56-4c95-add9-9e3e9cc90801` と
`813fb479-accd-454d-8fcd-fed51d4e891d`。ConflictはNormal1 / Skill1。
Search188.686秒、Planner61.864秒、attempt total261.422秒、peak RSS5,382,684KiB（5.133GiB）。
保持を0へ緩めるだけで成功することはなく、20件固定の影響だけでこのcontrolの失敗を説明できない。
全Routeを毎回捨てるProduction policyを支持する結果ではない。

固定retainedの全5attemptで、直接Conflictに参加するretained候補は
`build-list.fnv1a32-e396d352`（Target `820831d0-edd9-4005-a4a2-c8025cdad2c2`）の1件だった。
これは実測結果の記録であり、コードへ埋め込んだIDではない。
parentのResearch順位でAttempt4を先に選び、次に未実行stateを作れるAttempt3を選んだ。
各回とも元の20件からこの1件だけをreleaseし、ordinary Plannerで残り19件を再検証した。
両prefixとも **19/19、Conflict0、rejected0、1,459 steps、Replay passed** だった。

| attempt | orderの根拠 | Search found / not found | completed | Conflict | rejected / resource rejected | steps | expandedStates | Search秒 | Planner秒 | total秒 | peak GiB |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | Attempt4の最新未解決を先頭 | 23 / 1 | 19/43 | 1 | 23 / 23 | 2,220 | 2,239 | 62.884 | 27.019 | 96.370 | 2.970 |
| 7 | Attempt3の最新未解決を先頭 | 23 / 1 | 19/43 | 1 | 23 / 23 | 1,986 | 2,005 | 49.576 | 30.232 | 87.729 | 2.746 |

どちらもpending24、generated replacement23、final Trace Replay passed。
未発見はAttempt6が813fb479、Attempt7が711f7d15。その他blockerは0。
残ったConflictはsame_normal_counter1で、当事者はgenerated replacementと未発見Targetの元Entryだけ。
retained participantも、retainedのresource_conflict rejected Targetも0である。
したがって本研究の「直接Conflictからrelease」規則では2件目を導けず、release depth2は未実行。
oracleの維持18という数へ合わせるために別Entryを選ぶことはしなかった。

23件の単体Candidateを発見・投影できても、元起点から全43件を再構成すると19件しか完成しない。
未発見Targetの元Entryも残す契約の下では、残る1Conflictとschedulerのresource rejectionが
完成集合を大きく減らすことを観測した。rejectionの詳細な因果traceまでは今回追加profileしていない。
部分Planの1,986 / 2,220 stepsを、43件完成oracleの2,982 stepsより良い品質とは扱わない。

## 累積結果・終了理由・再現

raw: [RESULTS_8G](PLANNER_GLOBAL_PHASE1C_RESULTS_8G.json)。全8attemptのretained / released IDs、
pending order、signature、reason、typed signals、Search結果、Candidate / Entry / Plan SHA、
環境、timing、memoryを収録した。Candidate / Planの大容量本文はcommitしていない。

| 項目 | 結果 |
| --- | --- |
| discovery attempts / states | 8（固定retained5、control1、release2） |
| Candidate Searches | 206 |
| cumulative Search | 632.931秒 |
| cumulative Planner（Replay / projectionを含む） | 341.250秒 |
| attempt内部total合計 | 1,039.376秒 |
| controller wall time | **1,050.921秒（17分30.921秒）** |
| winning attempt / winning retained / winning replacements | なし（43/43未達） |
| best partial（Research順位） | Attempt4、42/43、retained20、replacement22、6,214 steps |
| best partial単体時間 | 89.800秒（成功までの所要時間ではない） |
| peak child maxRSS | 5,382,684KiB = **5.133GiB** |
| controller maxRSS | 103,624KiB = 約101.195MiB |
| stop reason | `cycle_detected` |
| 重複生成の抑止 | 15回（実行attempt数ではない） |
| Trace Replay | 全8attempt passed |
| extent fallback | 未実施 |
| 成功state独立再実行 | 該当stateがなく未実施 |

15は既実行signatureに当たったvariant生成の回数であり、同じstateを15回実行したわけではない。
6attempt / 12stateという最大枠を使い切る前に、定義したvariantと直接release候補が尽きた。
新しくなったretained集合内でordering historyを再度フル展開する探索や、直接Conflictに出ない
retained Routeの影響分析はこのcontrollerに含めていない。探索しなかったstateに成功解がないとは言えない。

Phase 0 default result SHAはPhase 1-Bと一致し、固定retainedの5stateについても4GiB実行と8GiB実行の
result SHAは一致した。syntheticでは同じstateの新規dependency / fresh runも完全一致した。
ただし、これを存在しない「43/43 winnerの独立再現成功」とは報告しない。

controllerは全Candidate / Projected snapshotを保持せず、maxRSS約101MiBに留まった。
childは毎回終了するので、attemptを重ねることによるchild heapの累積はない。
一方、1attemptのSearch / materialization / Plannerに大きいheapが必要で、
retain-noneは5.133GiBに達した。GC内訳は未計測であり、8GiB flagをメモリ最適化とは呼ばない。

## Research Questionへの回答・次Phase

- **Q1:** 試した5orderではretained20固定で43/43へ届かなかった。すべてのorderの不可能性は未証明。
- **Q2:** 実測Conflictから1件releaseする2stateでも未達。直接retained participantがなくなった時点で、
  このrelease heuristicは次の候補を導けなくなった。depth2に解がないという結論ではない。
- **Q3:** retained heuristicは到達状態と結果へ影響するが、全削除controlも失敗したため、
  retained20だけを唯一の原因とはできない。retained19の単体prefix自体は有効だった。
- **Q4:** 206 Searches / 約17.5分 / peak5.133GiBで未達であり、現在の形でProductionに実用的とは判断しない。
  失敗stateの費用を隠して89.800秒を「全43完成時間」と呼ばない。

**次Phaseで最初に行う候補は、実際のnot_found_within_extentに限定したgenericなsingle-axis extent probe。**
Task Jはoptionalとして今回は実装しなかった。同じProjected snapshotを固定し、観測したboundaryから
Nのみ / Gのみ / Sのみ最大2倍のprobeを行い、timeoutをno-matchへ変換せず、既存canonical comparatorの
再利用可否を確認して選ぶべきである。今回のTarget IDをaxis選択に埋め込まない。
得たCandidateは元43件へ戻してfull Planner + Replayするまで成功扱いしない。
次いで、直接Conflictの外にあるretained prefixがNormal / Skill到達位置へ与える影響と、
release後のordering retryを別のbounded仮説として調べる価値がある。

既知2,982 steps oracleは43/43の実行可能性の比較基準のままであり、今回の保持集合・順序・位置・Route入力には使っていない。
43/43のalgorithmがまだ見つかっていないため、Browser WorkerのProduction化候補benchmarkには進まない。
正式仕様変更、Production cache有効化や既定bound変更も提案結果として確定しない。

### 既定ヒープでの中断（正式再測定と分離）

最初のcommit `83acec646df625491a33ec3566c5f1afcaf5ca83`、code SHA
`8c2c658d4871d6879ef779481936a0a1e2d1578377ed0b8b7dac338a14708738`では、
固定retainedの5attemptの後、retain-noneの最終PlannerでNodeの既定ヒープ上限に達した。
`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`、exit134。
最後のGCはprocess開始317,170ms、heap表示4091.8MB。Searchは41 found / 2 not foundまで完了したが、
最終Plan、completed数、Conflict、rejected、Trace Replayは未確認である。
append-only進捗を [4G_STOP](PLANNER_GLOBAL_PHASE1C_4G_STOP.json) にまとめて保持した。
childが最終reportを書けず、正確な失敗process maxRSSとcontroller wall timeは未取得（null）である。
これをnot_foundや「43件は不可能」という結果へ置き換えない。

この実測を受け、Research childだけ `--max-old-space-size=8192` を明示し、実際のV8 heap limitと
execArgvをreportへ記録するようにした。Production設定は不変。benchmark code変更をcommitし、
正式測定は全attemptを最初からやり直す。8GiBを必要最低限と判定したわけではない。
実行が通っても既定heapで失敗した事実や、スマートフォンでの実用性問題は消えない。

runnerは今後のchild異常終了でも直前のprogressとstderr末尾を保存する。exit134かつNodeの
heap out of memory診断がある場合だけmemory_limit、それ以外はprocess_errorとする。
最後のprogress時刻・memoryは下界であり最終peakと呼ばない。
retain-noneがmemory_limitのときはstage stopに残し、元の固定retained実験のtyped Conflictだけから
releaseを試せる。OOM controlの未知の最終結果をrelease判断へ使わない。

## 検証範囲

### 実Exportのcancel / deadline

measured HEADは正式runと同じ。主controller終了後に、test / buildと並行せず別childで逐次測定した。
どちらも2件目のCandidate Search中に止まった。

| 設定 | report / controller分類 | attempt total | runner cancel要求→結果集計 |
| --- | --- | ---: | ---: |
| `--cancel-after-ms 15000` | cancelled / cancelled | 15,000.745ms | 3.224ms |
| `--attempt-budget-ms 15000` | time_budget_reached / time_budget | 15,002.014ms | 該当なし |

raw: [CANCEL](PLANNER_GLOBAL_PHASE1C_CANCEL.json) / [DEADLINE](PLANNER_GLOBAL_PHASE1C_DEADLINE.json)。
完了した1Searchはfound、停止したSearchはそれぞれcancelled / time_budget_reachedで、
not_found_within_extentは0。final Planner / final Replayは未実行としてnullを維持した。
cancel応答値はrunnerが要求時刻を記録してから結果集計までで、Browser UIの応答時間ではない。
両試行はdiscoveryの累積runtimeに含めない。

synthetic / unit testsは、Phase 0 defaultと明示attemptの完全結果同値、元入力の不変性、
別retained stateを挟んだ独立再実行でのCandidate / Entry / Plan一致、空prefixのordinary Replay、
競合する非空retained prefixの拒否、cache off / per-searchの完全attempt同値を検証する。
typed participant対応、generated / retainedの区別、決定的な順序とsignature、重複stateの拒否、
attempt / state / release depth上限、cycle、外部stateの検証、cancel / timeout / error分類、
OOM control後に先行Conflictだけからreleaseを続けることも検証する。
ProductionからResearchへのimport禁止テストとbuild artifactの識別子不在を確認した。
Domain / Worker / UI / DB / schema / versionのファイルは変更しない。

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npm test` | **294 files / 4,763 tests passed**（最終再実行） |
| `npm run build` | passed（既存の500kB超chunk warning） |
| `npx tsc -b --force` | passed |
| focused Research / runner tests | passed（4 files / 31 tests、OOM追加後のretry / runner 2 files / 14 testsもpassed） |
| `node --check` 両runner | passed |
| `git diff --check` | passed |
| 正式controller run | exit0、cycle_detected、8state、全Replay passed |
| Production領域のdiff / build混入検査 | 差分なし / Research識別子なし |

測定後の最初の全テストでは、変更対象外の `IdentificationWizardDialog.test.tsx` の
`shows global progress, cancellation, and Worker failure distinctly` が15秒timeoutになり、
4,762 tests passed / 1 failedだった。benchmarkと並行実行はしていない。
テスト・timeout値を変更せず、該当テストの単独実行は2.84秒でpassed、続く通常の `npm test` は
上記4,763件すべてpassed。最初の失敗を隠さず、既存UIテストの時間依存の不安定さとして残す。

コードはmeasured commitのまま、以後はこの文書と4つのraw JSONだけを追加する。
変更したコードは `src/benchmarks/plannerGlobalOptimizationResearch.ts`、同Research / RawBlocksのtests、
新規 `plannerGlobalOptimizationRetry.ts` / `.test.ts`、既存runnerと新規
`scripts/run-planner-global-phase1c.mjs`。19MB Export、`.local` の途中証跡・PR本文はcommit対象外。

## 未確認事項

Browser Worker / スマートフォンの時間・メモリ・cancel、複数回の性能分布、heap allocation / GCの
厳密な内訳、同期Planner Replay / projection中のcancel応答性、ゲーム実機の追加検証は未確認。
既存reference-verified / game-verified / unverifiedの境界を拡張しない。
