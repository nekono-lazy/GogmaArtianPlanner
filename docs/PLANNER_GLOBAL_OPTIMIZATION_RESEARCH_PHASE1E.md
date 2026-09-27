# Global Planner Research Phase 1-E

**original Exportだけから、anchorなしで43/43に到達した。** 元の43 BuildListEntryを持つExportを
通常のPhase 0開始状態（そのrun自身が導いたretained 20 / pending 23・Phase 0順）から実行し、
Target非依存のgeneric fallback **normal-2x-fallback** を最初から有効にしただけで、
**初回attempt（ordering retryなし）で 43/43 completed・Conflict 0・rejected 0・resource_conflict 0・Trace Replay passed**
になった。steps 8,534。新しいNode processでaxis strategyとboundsだけを渡した独立再現もsemanticに完全一致した。
Gogma 2倍・Skill 2倍は同じno-matchを解決できず、controlと同一の42/43だった。

これはResearch結果であり、Production化の判断・仕様変更はしていない。8,534 stepsは既知oracle 2,982 steps・
Phase 1-D最良6,857 stepsより長く、Production default `maxPlanSteps = 1000` も超える。
別Export・別武器種での一般性は未確認である。

Refs #154。開始時のmain / origin/mainは `69483206122f05b8ba845d3d71a9003d6c327755`（PR #163）、Working Treeはclean、
Issue #154はOpen。branch: `claude/global-planner-phase1e`。Phase 0 / 1-A / 1-B / 1-C / 1-D（PR #159〜#163）と
Issue本文・コメントを確認した。

## 目的・変更境界

Phase 1-Dは「Phase 1-Cで事前に得た42/43 anchor → 同一snapshot単軸probe → Normal 2x fallback → 43/43」だった。
Phase 1-Eは **anchorを事前計算せず、元のExportだけ** から、fallbackを最初から有効にしたGlobal discovery →
（必要なら）bounded retry → full Planner → 43/43 / Conflict 0 / rejected 0 / Trace Replayを
一連のResearch controllerとして成立させられるかを確認する。

Production behavior変更なし。通常Candidate Search semantics / default extent、Planner routing、Worker protocol、UI、
Persistence / Dexie / Export schema、CalculationContext（17）、`PRODUCTION_RNG_ENGINE_VERSION`（`production-rng:c5-e7`）、
preferredOwnedWeaponId、Production maxPlanSteps（1000）、manual Conflict、Issue #157、REQUIREMENTSの現行契約
（明示的選択なしに自動再検索しない）を変更しない。raw block cacheは引き続きResearch-onlyのper-search。
これらの不変はテストでも固定した（schema 17 / DB 10 / Export 13 / RNG version / `maxPlanSteps` 1000 / Search推奨値）。

参照authority: REQUIREMENTS 14 / 19 / 20 / 23、PLANNER_SPEC 7 / 9 / 11、SEARCH_SPEC 3.1 / 5.5 / 5.6、
DATA_MODEL 9 / 11、RNG_SPEC 6 / 7、Phase 0〜1-DのResearch文書、AGENTS.md、AI_DEVELOPMENT_WORKFLOW。

## runtime入力：original Exportのみ

controller（`scripts/run-planner-global-phase1e.mjs`）が各childへ渡す実データは **Exportのpathだけ** である。
childは毎回Exportを読み直し、通常の `runGlobalPlannerResearch()` がbaseline Plannerから
retained set（selected ∪ progressed）とpending順（ordinary Planner priority）を **そのrun自身で** 導く。

- Phase 1-C / 1-D の結果JSON（`PHASE1C_RESULTS_8G` / `PHASE1D_PROBES` / `PHASE1D_VARIANTS` 等）、anchor、
  attempt ID、retained ID一覧、pending order、snapshot、Candidate、axisの答えを読まない・埋め込まない。
  controllerとmoduleのsourceに対し、`docs/` / 旧Phase結果名 / observed-report / probe snapshot / failed-first /
  UUID（Target ID）/ 64桁hex（Export SHA）が無いこと、controllerの `readFile` 対象がExport・自分のchild出力・
  （stop suiteのみ）自分の `INITIAL_VARIANTS` だけであることをテストで固定した。これらのファイルが無くても動く。
- Export SHA-256の期待値はcontrollerに埋め込まず、計測値として記録するだけにした（Phase 1-C / 1-Dのrunnerは
  固定値を検査していた）。全childが同じExport SHAを読んだことはcontrollerが検査する。
- `--attempt-state` はretry経路でだけ使われ、その状態はPhase 1-C retry controllerがこのrunの観測signalから導く。
  今回のrunではretryは発生しなかった。
- oracleの18 retained / 25 replacement ID、Target順、Counter、RouteKind、2,982-step Routeは入力にも判断にも使わない。
  本書に現れるTarget IDは実験の **観測結果** である。

## controller

`runPhase1EController()`（`src/benchmarks/plannerGlobalOptimizationPhase1E.ts`、executorは注入）:

1. **control**: fallbackなしのPhase 0 run（Task B）。
2. **initial strategies**: `normal-2x-fallback` / `gogma-2x-fallback` / `skill-2x-fallback` を、それぞれ新しい
   Node processでoriginal Exportから独立実行（executorへ渡すのはaxisだけ）。前strategyのCandidate・Projected state・
   結果は引き継がない。各childが出すpriority entriesが全runで一致することも検査する。
3. **比較**: Candidate単体ではなく各strategyの **最終Global Plan** で、既存の `compareExtentVariants()`
   （43/43成功 → resource rejected → Conflict → completed → steps → stable signature）で順位付けする。
   これはResearch variant比較でありProduction Candidate rankingではない。
4. **retry（条件付き）**: 全initial strategyがpartialのときだけ、initialの順位順にaxis strategyを有効にしたまま
   既存 `runDiscoveryRetries()`（Phase 1-C bounds: ordering 6 / states 12 / release depth 2 以内）を回す。
   各retry stateもoriginal Exportから新しいprocessで再構築する。最初にcompletedが出たaxisで打ち切る。
   initialのどれかが43/43なら **retryは開始しない**（Task G / H / I、テストで両分岐を固定）。
5. **outcome**: completed variantが1つでもあればcompleted。後続のerror / timeout / OOM / cancelでは上書きしない
   （Phase 1-Dのcompleted preservationを再利用）。stop要求は `cancel.requested` / `completedBeforeStop` として別に残す。

### generic fallback rule（Phase 1-Dと同一 + episode上限）

base Search（N350 / G500 / S1500）が `not_found_within_extent`、**かつ** strategy axisの観測boundaryに到達した
場合だけ、同一Projected snapshotからそのaxisだけ2倍で1回Searchする（Normal: N700 / G500 / S1500、
Gogma: N350 / G1000 / S1500、Skill: N350 / G500 / S3000）。Target IDは参照しない。strategy名・request規則・
searchRunId生成式・materializer identityはPhase 1-Dのままである。

1 attempt内で複数のbase no-matchが起これば、各no-matchに同じ規則を適用する。Phase 1-Eで追加したのは次の2点だけ。

- **episode上限**: attemptあたり最大 **3** fallback Search。上限到達時はSearchを開始せず、fallback status
  `episode_limit_reached`、attempt `blocked`、stop `fallback_episode_limit` とする。Targetなしとして続行しない。
  3はPhase 1-Dで観測した発動回数（attemptあたり1回）に余裕を持たせたResearch上の初期値で、測定上の閾値ではない。
- **重複防止**: fallback requestの `hashStableValue()`（`requestFingerprint`）をattempt内で一意に保ち、
  同じrequestが再度出たらinvariant errorにする（各Targetはattemptあたり1回しか検索されないため通常は起こらない）。

fallback結果の扱いはPhase 1-Dのまま: base no-matchは上書きせず記録し、found → `resolved_by_extent_fallback`
（通常materializer → 単体ordinary Planner → Trace Replay / 投影を通す）、bounded no-match → `unresolved_after_extent_fallback`。
timeout / cancel / search_error はnot_foundにせずblocker / cancel、materialization / projection失敗はblocker。

## Phase 0 control（fallbackなし、fresh run）

| completed | Conflict | rejected / resource | steps | expandedStates | Trace Replay | Search | Search秒 | Planner秒 | total秒 | wall秒 | child maxRSS |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 42/43 | 2（same_normal_counter 1 / same_skill_counter 1） | 1 / 1 | 7,330 | 7,372 | passed | 23 | 87.281 | 56.359 | 153.146 | 154.736 | 3.839 GiB |

retained 20 / pending 23（controlが自ら導出）、未発見はindex 20の `813fb479-accd-454d-8fcd-fed51d4e891d`
（resource_conflictでrejected）。Conflict参加Targetは711f7d15 / 813fb479 / 820831d0。
result SHA `d799923f94d3803325af20686618aff371cfc31eb7d33bcffd6a01b9e70ccc0e`、
Plan SHA `5db231229d65d8e312b8b6f8dea1cfba8ec99a8a02a9501701bb2f5f77133bf6`。
**Phase 0 semantic parity**: この値は過去のPhase 1-B Phase 0（`PHASE1B_PHASE0_CACHE`）とPhase 1-C Attempt 0の
result SHAと同一だった。比較は本書作成時に行ったもので、controllerはこれらのファイルを読まない。

## initial variants（3 axis、すべてoriginal Exportから独立）

3つとも retained 20 / pending 23 をcontrolと同じく自ら導出し、Search順はpriority導出の順と一致した
（`derivedStateMatchesSearchOrder = true`）。index 0〜19は3つともbase extentでfound、index 20の813fb479だけが
base bounded no-match（観測reach N350 / G500 / S1501、N / G / S全boundary到達）で、各strategyのfallbackが1回発動した。

| strategy | fallback（index 20 / 813fb479） | fallback reach N / G / S | 後続2 Search | completed | Conflict | rejected / resource | steps | expandedStates | Trace Replay |
| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | --- |
| **normal-2x-fallback** | **found**（7.168秒）、normal_artian_to_gogma 896操作、advance N643 / G1 / S252 | 700 / 500 / 895 | found 912操作 / found 118操作 | **43/43** | **0** | **0 / 0** | **8,534** | 8,577 | passed |
| gogma-2x-fallback | not_found_within_extent（37.805秒） | 350 / 1000 / 1501 | found 141 / found 581 | 42/43 | 2 | 1 / 1 | 7,330 | 7,372 | passed |
| skill-2x-fallback | not_found_within_extent（8.996秒） | 350 / 500 / 3001 | found 141 / found 581 | 42/43 | 2 | 1 / 1 | 7,330 | 7,372 | passed |

- normalのwinnerはselected 43、generated replacement 23、warnings 0、Planner termination completed（bound truncateなし）。
  result SHA `7046b2ab95e428870a536e8cc3b9267bcc1d575602d17c201e3fd5f891bd2579`、
  Plan SHA `6c380cb3584d925e82c908ae34fe41f1d4f4f907a91515778542154df641ef66`、
  final result SHA `c133660bf096d110ff3697bf68b948db44b051cd6b379d926dc0cd046a2c651f`、
  fallback Candidate SHA `e8608eea0fafc23b37db854db31917c97429d313332ceeec29b4af1c19c651ac`。
- Gogma / Skillはfallbackがunresolvedのため元Entryを残して続行し、最終Planはcontrolと **同一**（result SHAも同一）になった。
- 順位（`compareExtentVariants`）: normal（成功）→ gogma → skill（gogma / skillは全metric同値で、stable signature順）。

**初回attemptで43/43（initial attempt success）。** したがって今回のExportでは、43/43到達のために
Phase 1-Cのordering retry / retained releaseは **不要だった**（retry開始なし、retry attempt 0）。
これは別Exportでも不要であることを意味しない。

Phase 1-Dとの関係: Phase 1-Dの2つのanchor（Phase 1-C Attempt 3 / 4由来）ではno-match Targetがそれぞれ813fb479 /
711f7d15だったが、Phase 0順ではindex 20の813fb479がno-matchになる（Phase 1-Aの観測と同じ）。
今回のfallback Candidate（896操作、N643 / G1 / S252）は、Phase 1-D anchor 3の同Target（1,098操作、N643 / G1 / S454）とは
Projected snapshotが異なるため別Candidateである。Normal advance 643が同じである点は観測として記録するだけで、閾値とは主張しない。

## 独立再現

新しいNode processで **original Export + axis strategy（normal）+ bounds** だけを渡して再実行した
（Target ID・Candidate・retained ID・pending order・snapshot・Counter位置・Phase 1-C attempt ID・Phase 1-D anchorは渡さない）。
そのrunは自ら同じretained set / pending順を導き、次がすべて一致した:
initial retained set、pending Target順、全base Search status列と23件のSearch evidence SHA、fallback発動Target・axis・extent・
searchRunId・requestFingerprint・fallback Candidate SHA、generated Entry IDs / body SHA、selected Entry IDs、Plan SHA、
final result SHA、43/43、Conflict 0、rejected 0、Trace Replay passed。
semantic SHA `b8ac8bdf4af43224df2947067c13c23113b6c994388fabbc29cd4e992a00a9f8`（元run・再現とも）。elapsed / memoryは比較対象外。

## 「自律的43/43」の判定

| 条件 | 結果 |
| --- | --- |
| original Exportのみが実データ入力 | ✅ |
| observed report（Phase 1-C / 1-D）をalgorithm inputにしない | ✅（source testで固定） |
| Target ID hard-codeなし / oracle入力なし | ✅ |
| deterministic | ✅（独立再現で完全一致） |
| bounded | ✅（axis 3、fallback episode ≤ 3 / attempt、Phase 1-C retry bounds、attempt 900秒 / fallback 180秒 / controller 3時間） |
| generic fallback strategy / ordinary Candidate Search・Planner authority | ✅ |
| final 43/43・Conflict 0・rejected 0・resource_conflict 0・Trace Replay | ✅ |
| fresh reproduction | ✅ |

以上から、**このExportについて** はPhase 1-Eの定義で「自律的に43/43へ到達した」と言える。
ただし「3 axisを並べて最終Planで比べる」構造が前提であり、「no-matchならNormalを2倍にする」を規則として固定したわけではない。

## runtime

| 区分 | Search数（fallback） | Search秒（うちfallback） | Planner秒 | attempt内部秒 | wall秒 | child maxRSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| control | 23（0） | 87.281 | 56.359 | 153.146 | 154.736 | 3.839 GiB |
| normal initial（winner） | 23（1） | 99.225（7.168） | 65.969 | 176.608 | 178.252 | 3.884 GiB |
| gogma initial | 23（1） | 130.641（37.805） | 59.638 | 200.972 | 202.708 | **4.683 GiB** |
| skill initial | 23（1） | 105.173（8.996） | 62.260 | 178.122 | 179.871 | 4.133 GiB |
| **controller計** | **92（3）** | **422.321（53.970）** | **244.226** | 708.848 | controller wall **715.969** | 4.683 GiB |
| 独立再現（別計上） | 23（1） | 99.267（7.058） | 69.549 | 180.798 | 182.486 | 3.891 GiB |

- **最初の43/43が得られた時点までの累積wall: 332.992秒**（controlを含む。control除外では178.254秒）。
- **全axis比較完了までのwall: 715.575秒**（controller wall 715.969秒 = 11分55.969秒、再現を除く）。
- **winning attempt単体: 178.252秒**（Search 99.225、うちfallback 7.168、Planner 65.969）。
  これは「winnerを自律的に発見する総時間」ではない。発見の総時間は上の332.992秒（最初のcompletedまで）または
  715.969秒（3 axis比較完了まで）である。
- Phase 1-Dの「Phase 1-C（1,050.921秒）＋ Phase 1-D（662.951秒）≈ 1,713.9秒」に対し、今回はanchor計算なしで
  3 axis比較を含め715.969秒だった。ただし構造が異なるので単純な高速化率とは扱わない。
- controller processのmaxRSSは181,268 KiB（約177.0 MiB）。

## memory

各childは `--max-old-space-size=8192`（V8 heap limit 8,791,261,184 bytes）で実行した。peak child maxRSSは
gogma initialの4.683 GiB（Gogma 2倍fallbackが1,000 Gogma位置を読むため）、winnerは3.884 GiB。
Phase 1-Dの3.793 GiBより高いが、同じ測定条件内の値である。
**8GiB heapで動いたことはBrowser Worker / スマートフォンで実用可能であることを意味しない。**
Phase 1-Cで既定heapのretain-noneがOOMした証跡は有効なまま残る。今回memory最適化はしていない。

## cancel / deadline

正式runと同じmeasured commitで、main controller終了後に `--cancel-deadline` suiteで逐次測定した（discovery累積には含めない）。
各childはoriginal Exportから開始する。fallbackを使う試行のaxisは、このPhase 1-E run自身の `INITIAL_VARIANTS` で
fallbackに到達した最初のstrategy（normal）から選んだ。childのcancelは、Windowsで強制終了されず結果を書けるよう、
controllerが作るcancel file（`--cancel-file`、100ms間隔で確認）で協調的に行う。

| 区分 | 試行 | 設定 | 結果 | 備考 |
| --- | --- | --- | --- | --- |
| deadline | fallback deadline | fallback budget 1,000ms | fallback `time_budget_reached` / stoppedBy `fallback_budget`（1,003.0ms）、report `blocked`、stop `extent_fallback_blocked` | base no-matchは保持、元Entryで続行せずfinal Planner未実行 |
| deadline | attempt deadline | attempt budget 30,000ms | index 5のbase Searchが `time_budget_reached`（30,001.1ms）、stop `time_budget` | no-matchにしない |
| deadline | controller deadline | controller budget 5,000ms | controlが `time_budget_reached`、controller outcome / stop `time_budget`、initial variant未開始 | wall 8.334秒 |
| cancel | control cancel | 2,000ms後 | baseline Planner中に `cancelled`（2,035.1ms）、要求→集計3.114ms | |
| cancel | initial variant cancel | 60,000ms後 | index 9のbase Searchが `cancelled`（61,817.8ms）、要求→集計22.912ms | no-matchにしない |
| cancel | fallback cancel | fallback開始1,000ms後 | fallback `cancelled` / `external_cancel`（999.7ms）、report `cancelled`、要求→集計38.968ms | 同上 |
| cancel | controller cancel（completed後） | 最初のcompleted観測5,000ms後 | normal initialが43/43後、gogma initialがretained_prefix段階で `cancelled`。**controller outcome `completed`**、stop `cancelled`、`cancel = { requested: true, completedBeforeStop: true }` | completedは上書きされない。wall 371.705秒 |

controller cancel runのnormal initialも、main runと同じresult SHA `7046b2ab…2579` になった（3回目の独立一致）。
cancel応答値はrunnerが要求時刻を記録してから結果集計までで、Browser UIの応答時間ではない。
raw: [DEADLINE](PLANNER_GLOBAL_PHASE1E_DEADLINE.json) / [CANCEL](PLANNER_GLOBAL_PHASE1E_CANCEL.json)。

## oracle（2,982 steps）・Phase 1-D・Production boundとの比較

- 既知oracleは43/43・2,982 steps。今回の8,534 stepsは約2.86倍で、良い品質とは扱わない。
  oracleは比較基準のみで、入力・判断には使っていない。global optimumとは呼ばない。
- Phase 1-D最良（anchor 3）の6,857 stepsより **1,677 steps悪化** した（anchor 4の8,589よりは55 steps短い）。
  anchor依存を除いた代わりに、Phase 0順のSearch順・fallback Candidateが異なる。
- expandedStates 8,577、Research `maxPlanSteps = 20000` で実行した。**Production default `maxPlanSteps = 1000` を超えるため、
  現在のProduction設定でそのまま動くとは言えない。** step bound policyは別課題で、このPRでは変更しない。

## テスト

`src/benchmarks/plannerGlobalOptimizationPhase1E.test.ts`（13件）と `scripts/run-planner-global-phase1e.test.ts`（2件）:

- fallbackなしcontrolはPhase 0 / 1-C / 1-D parity SHA（`9ae56d7e…`）のまま。未使用のPhase 1-E fallbackはPlan / Entryを変えない。
- 1 attempt内の2つのbase no-matchに同じ規則が適用され、各episodeが別requestFingerprint、axis以外のextent不変、
  base statusは上書きされず、通常materializer・単体Planner・投影を通って3/3 completed / Trace Replay passed。
- episode上限: 上限1で2件目が `episode_limit_reached` → blocked / `fallback_episode_limit`、finalなし。不正な上限・boundsを拒否。
- fallback deadline / cancel / search_errorはepisode上限ありでもnot_foundにならない。
- N / G / Sは同じoriginal inputから自らretained / pendingを導出し、inputを変更せず、実行順を入れ替えても結果が同じ（漏れなし）。
- probe recordの `snapshotFingerprint` は `fnv1a32:` 値で、`snapshotSha256` という名前を持たない（Task S）。
- controller: initialはaxisだけを受け取る、1つでも成功ならretryを開始しない、最終Planで比較（steps少が勝ち）、
  全partial時だけ最良axisから独立state（extent / pending / retainedのみ）でbounded retry、何もcompletedしなくてもbounds内、
  completedは後続OOM / cancelで上書きされずcancelは別記録、priority evidence不一致を拒否。
- 再現はaxisだけでinitialを再実行し、retry winnerはchainを再実行して状態を自ら導く。
- Production defaults / schema / versionが不変。runner sourceは旧Phase report・Target ID・Export SHAを含まず、読むファイルが限定される。
  ProductionからResearch moduleへのimportが無いことは既存テストが新moduleも対象にする（名前が `plannerGlobalOptimization*`）。

| 確認 | 結果 |
| --- | --- |
| `npm run lint` | passed |
| `npx tsc -b --force` | passed |
| `npm test` | **297 files / 4,793 tests passed**（最終実行） |
| `npm run build` | passed（既存の500kB超chunk warning）、dist にResearch識別子なし |
| focused Research / runner tests | passed（`src/benchmarks` + `scripts` 27 files / 278 tests） |
| `node --check` 両runner | passed |
| `git diff --check` | passed |

測定後の最初の2回の `npm test` では、変更対象外の `IdentificationWizardDialog.test.tsx` の
`incomplete does not advance to Review` と `shows global progress, cancellation, and Worker failure distinctly` が
15秒timeoutになり4,791 passed / 2 failedだった（Phase 1-C / 1-Dでも同じfileで観測）。benchmarkとは並行実行していない。
同fileの単独実行は58件passed、新規2 test fileを除外した全体実行は295 files / 4,778 tests passed、
その後の全体実行（新規testを含む）は全件passedだった。新規runner guard testは0.64秒である。testは変更していない。

## Task S: snapshot metadataの命名

`ExtentProbeRecord.snapshotSha256` に `hashStableValue()`（`fnv1a32:…`）が入っていた不一致を、`snapshotFingerprint` へ改名した。
Phase 1-D runnerはこのrecordをcapture recordの実SHA-256 `snapshotSha256` の後にspreadしていたため、
committed `PHASE1D_PROBES.json` のprobe `snapshotSha256` はFNV値で上書きされていた（raw evidenceは書き換えない）。
改名後はcapture側の実SHA-256が上書きされない。新しいfallback requestの指紋も `requestFingerprint` と名付けた。

## 再現性・ファイル

正式measured commit: `6ddf5603510f1f6bb5c04321d8113460aa8719fc`（benchmark-affecting codeをcommitした後に測定）。
benchmark code SHA-256: `fc1c28d2d48799d9ab8ff5e7379cd92a23ddfd0a10dc91dd31b56ac1b6439cb9`。
Node v24.19.0、Windows x64 10.0.26200、AMD Ryzen 7 9700X（16 logical CPUs）、physical memory 33,377,591,296 bytes、
RNG `production-rng:c5-e7`、child heap limit 8,791,261,184 bytes、raw cache per-search、Node yield immediate、
Research maxPlanSteps 20000（Production default 1000）、base extent N350 / G500 / S1500、fallback factor 2、
fallback episode limit 3 / attempt、axis strategies normal / gogma / skill、retry bounds ordering 6 / states 12 / release depth 2、
attempt budget 900秒、fallback budget 180秒、controller budget 3時間。
Export SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（19MB Exportはcommitしない）。
controllerはsrc / scripts / package / lock / Vite / TS configの未commit・未tracked codeを拒否し、全childのHEAD / code SHA /
Engine version / Export SHA / heap limitの一致を検査する。code commit後の追加は文書・raw結果のみで、benchmark behaviorは変更していない。

```powershell
node scripts/run-planner-global-phase1e.mjs C:/Users/nekon/Downloads/gogma-artian-planner-backup_20260927015837.json docs/PLANNER_GLOBAL_PHASE1E
node scripts/run-planner-global-phase1e.mjs C:/Users/nekon/Downloads/gogma-artian-planner-backup_20260927015837.json docs/PLANNER_GLOBAL_PHASE1E --cancel-deadline
```

raw: [CONTROL](PLANNER_GLOBAL_PHASE1E_CONTROL.json)、[INITIAL_VARIANTS](PLANNER_GLOBAL_PHASE1E_INITIAL_VARIANTS.json)、
[RESULT](PLANNER_GLOBAL_PHASE1E_RESULT.json)（outcome・順位・totals）、[REPRODUCTION](PLANNER_GLOBAL_PHASE1E_REPRODUCTION.json)、
[CANCEL](PLANNER_GLOBAL_PHASE1E_CANCEL.json)、[DEADLINE](PLANNER_GLOBAL_PHASE1E_DEADLINE.json)。
Candidate / Planの全文ではなくSHAとsummaryだけを保存した（Search profileも除いた）。Phase 1-C / 1-Dの結果ファイルは変更していない。

コード: 新規 `src/benchmarks/plannerGlobalOptimizationPhase1E.ts`（controller、bounds、再現）、
`scripts/run-planner-global-phase1e.mjs`（fresh child controller・stop suite）、各test。変更 `plannerGlobalOptimizationResearch.ts`
（fallback episode上限・requestFingerprint）、`plannerGlobalOptimizationRetry.ts`（stop `fallback_episode_limit`）、
`plannerGlobalOptimizationExtentProbe.ts`（episode引数、`snapshotFingerprint`）、`plannerGlobalOptimizationTestFixture.ts`
（test用の追加Target）、`scripts/run-planner-global-research.mjs`（`--fallback-max-episodes`、`--cancel-file`）。

## 次Phaseの推奨

1. **別Export / 別武器種での一般性確認**を最初に行う。Normal偏り（今回もNormal 2倍だけが成立）が今回のExport固有かを、
   同じcontroller（3 axis、original Exportのみ）で測る。
2. Browser Worker benchmark（時間・memory・cancel）。Node 8GiB heapでの4.7GiB peakがBrowserで成立するかを確認する。
3. Plan長（8,534 steps、oracleの約2.86倍）とProduction `maxPlanSteps` policyの整理。fallback CandidateのNormal forge数が主因か切り分ける。
4. Search / Planner残りコスト（control自体に約153秒）とGogma 2倍fallbackのmemory削減。
5. Production contract変更案（自動再検索禁止との関係）とREQUIREMENTS変更案を整理してからProduction化を判断する。

## 未確認事項

Browser Worker / スマートフォンの時間・メモリ・cancel、複数回の性能分布、heap / GCの内訳、別Exportでの一般性、
1回2倍で見つからないno-matchやepisode 2回以上が必要なケース、retry経路の実データでの挙動（今回は不発動）、
ゲーム実機の追加検証は未確認。既存reference-verified / game-verified / unverifiedの境界を拡張しない。
