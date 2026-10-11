# Global Planner Research D2-E（t03の2-support K2 context探索とD2-D最良incumbentへの追加評価の事前登録）

Refs #154。**docs-only**。基準main: PR #230 merged `2c08bc9609243f1e43e7f9896c7ad1ff364ab2ac`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなし、worktreeは1件だけ、実行中のResearch process（node）なしを確認。本書が使う `.local` evidence（incumbent G store 9件、
K1 CTX record 6件、D2-C / D2-Dのstart attestation・raw、D2-DのRV / B0 / I0 / PAIR-3 record）のbytes・SHA-256が正式RESULTの記録と一致することを確認）。

本書は [D2-C-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2CB.md) §5で次Phase候補とした「t03について2 supportを同時に置くK2 context」と、
[D2-D-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2DB.md) で得た最良置換集合（`PAIR-t05c1-t07c3`、24 / 43、Conflict 19）を起点とする追加評価だけを、
実装・計測より前に確定する事前登録である。本書ではResearch項目名を **D2-E**、本書による事前登録を **D2-E-A**、実装と正式計測を **D2-E-B** と呼ぶ。
Phase 2-C2.5-D2-E（`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2E.md`、`PLANNER_GLOBAL_PHASE2C25D2E_*`、`plannerGlobalPhase2C25D2E*`、
`scripts/analyze-planner-global-phase2c25d2e.mjs`）とは別のResearch項目であり、名称・file・run dirを混同しない（§10.4）。

本PRで変更していないもの: Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default / bounds、
既存formal RESULT（Phase B / D1 / D2 / D2-C / D2-Dを含む）、既存Research文書（Research索引へのリンク追加を除く）、既存Research runner / analyzer / module / test、
正式仕様の意味論。新規Search run、Candidate delivery、materialization、full Planner run、Trace Replay、formal measurement、RESULT JSON生成、oracle読み取りは行っていない。

§1の値は、既存committed RESULT、既存 `.local` record / G store / CTX recordのSHA-256照合と読み取り・数え上げ、および§1.7のreservation導出だけで得た。
§1.7は、Repositoryへ追加しないscratch scriptで既存の純粋な導出部品（`phase2c27bResolveSupportContext()` = `derivePlannerAlternativeReservation()`、
`derivePhase2C26B2C1Schedule()`）をHEAD `2c08bc9` で読み取り専用に1回呼んだものである（Search・materializer・full Planner run・Trace Replayを呼んでいない。
wall 17 s）。非formalであり、formal authorityはD2-E-BのCTX record（§4.1）である。登録値はその照合期待値としてだけ使う。

本書の各節は次の4種類のどれかであり、見出しに明記する。

| 種類 | 意味 | 節 |
| --- | --- | --- |
| **事実** | D2 / D2-C / D2-Dの既存formal RESULT・record・G store・文書から読み取った値と、§1.7の非formal導出値（本書で新しく計測していない） | §1 |
| **事前登録条件** | D2-E-Bが変えてはならない実行条件・判定規則 | §2〜§13、§15、§17 |
| **既存API** | D2-E-Bが使う既存の部品と、新規に必要なResearch処理の区別（Production変更なし） | §14 |
| **未決事項** | D2-Eの外、またはD2-E-B以降に決めること | §16 |

## 0. 位置づけとauthority

本書はResearch文書であり、正式仕様ではない。正式仕様のauthorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md`（19 / 20 / 23 / 23.1）→
`docs/PLANNER_SPEC.md`（7、9.2.3.1、9.2.18、9.2.19）/ `docs/SEARCH_SPEC.md`（5.6.8）→ その他の正式文書 → 実装 → test → Research文書である。
D2-EはResearch-onlyであり、REQUIREMENTS 23（明示的な選択が無い競合について自動で再検索しない）、Planner Alternative（9.2.19.1〜9.2.19.16）、RNG、Search、UI、
Persistence、schema / version、Production default / boundsの意味論を変更しない。複数support Entryを同時にreservationへ含めるK2 context、置換集合の一括評価、
support Entryの扱いはResearch harnessの中だけのものであり、Productionの動作（9.2.19.3のuser-fixed Route reservation、9.2.19.8.1のscenario composition）ではない。

D2-Eの判定に使う順位（上を優先し、矛盾は報告してD2-E-Bを止める。本書は正式仕様の意味論を変えられないので、本書の規則が正式仕様の変更を要する場合も止める）:

1. `docs/REQUIREMENTS.md`
2. 本書（D2-E-A事前登録）
3. D2-D-A（[`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md`](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md)。§5 R5・gate・選択順、§6 RV / S1〜S5、§8 parity、§9 formal validity）
4. D2-D-B（[`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2DB.md`](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2DB.md)、evidenceの要約）
5. D2-C-A（[`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md`](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md)。§4 CTX / DSC / 重複排除 / rung進行、§5 ADM・R1、§6.3 R5、§7 support validity、§10 formal validity）
6. D2-C-B（[`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2CB.md`](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2CB.md)、evidenceの要約）
7. `docs/PLANNER_SPEC.md`
8. `docs/SEARCH_SPEC.md`
9. その他正式仕様、D2-A / D1-A / follow-up / Phase A（R0〜R6、G1〜G43の出典）
10. 実装 / test / 過去Research

既存Researchのformal RESULTは **evidence** であり、Production仕様のauthorityではない。D2-E-Bは本書の規則だけで判定でき、実装時に意味論を追加決定しなくて済むことを目標とする。
実装名（module / 関数 / fieldの綴り）はD2-E-Bで決めてよいが、§12のRESULT必須fieldの意味と§11の判定順序を変えてはならない。変える必要が生じた場合は、
D2-E-Bの正式計測前に本書を更新する（docs PR）。

## 1. 事実（D2 / D2-C / D2-Dから確認されたこと。本書で再計測していない）

### 1.1 D2-D-Bの正式結果（`docs/PLANNER_GLOBAL_D2D_RESULT.json`、402,549 bytes、SHA-256 `5a27030d7be3fd4650eb0094cc2227759a3b0656a096ac09291e5807298fa4b0`）

| 項目 | 値 | 出典（D2-D RESULT） |
| --- | --- | --- |
| formal validity | `provenance.formal = true`、`runStatus = completed`、`invalidReasons = []`、unmeasured 0、not_executed 0、bound-limited 0、run envelope未到達、`oracleReadBy{Runner,Child,Analyzer} = false` | `provenance`、`aggregates`、`decision` |
| provenance | measurement HEAD `38f4ed7bbfd7e994367856484817d115b9860ab8`（= analysis HEAD）、start attestation `15090ba23d6a757b6106e040e90a884d17301db062a62ebf6c6059bfc6ca7985`（verified）、calculation code digest `6d0313bcecf1d5ca3ad593c385e147970ec523d2e3f18146b9d43bfd628c702e`、登録policy `2db65c0e50053c3d3ffaae0d5cd30a28f5860b80161e5d0de6707343b57ddb09`、`calculationCodeChangedSinceMeasuredHead = []`、Production changed files `[]` | `provenance` |
| D2-D-A文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md`（90,841 bytes、`bafcb2d4e39e801afa2a28dbb9902ec3285cced625d865859a48d024c5c60c17`）。現在のmainの実ファイル・git objectとも一致 | `sources.specDocument` |
| D2-D-B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2DB.md`（15,120 bytes、`ea29814003717afaf737486cafee9d6a19437954a2e210c3fc49a2916933472e`） | 本書作成時の実ファイル |
| decision | `D2D_EXCEEDS_D2C_FINAL`、`bestEligiblePair = bestImprovedPair = PAIR-t05c1-t07c3`（PAIR ordinal 3） | `decision` |
| B0 | 20 / 43、Conflict 21、steps 1465、`exhausted`、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`（D2 / D2-CのB0とmatched） | `evaluations[B0]` |
| **D2-D最良（PAIR-3）** | `PAIR-t05c1-t07c3`: completed **24 / 43**、Conflict **19**、steps **1465**、termination `exhausted`（`reachedLimits = []`）、`inputDigest fnv1a32:6493291d`（= 登録値）、`resultDigest fnv1a32:57dbb4e5`、**R5成立**（`supportVacuous = false`、5条件すべてtrue）、R6不成立（43 / 43・Conflict 0・`resource_conflict` 0を満たさない）、`resourceConflictRejections = 19`、`fullRunsStarted = 1`、selected Entry 24件、wall 15.2 s、heap 0.70 GB | `evaluations[PAIR-t05c1-t07c3]`、`pairs.ranking` |
| PAIR-3のsupport | `e396d352` / `92d87b90` / `61066e62` の3件ともS1〜S5成立・selected、`supportExpiryCause = null` | `evaluations[PAIR-t05c1-t07c3].supportChecksByEntry` |
| PAIR-3のI0（D2-C最終）比 | completed +1 / Conflict −1 / steps ±0。獲得 `a6c17e25…`（t05）/ `fea60316…`、喪失 `b4f252cd…` | `evaluations[PAIR-t05c1-t07c3].referenceDiff` |
| RV | `verified`。PAIR-3の9件を含む12 CandidateのRV1〜RV4、support 3件のRV5 / RV6成立 | `rv` |
| 実行環境 | Node v24.19.0、AMD Ryzen 7 9700X、メモリ 33.4 GB。評価1件 8.8〜16.4 s、child heap最大0.74 GB | `environment`、`aggregates` |

D2-D-B run dirのevidence（`.local/d2d-pair-formal.run/`）: start attestation `start-attestation.json`（24,839 bytes、`15090ba2…7985`）、raw `.local/PLANNER_GLOBAL_D2D_PAIR_RAW.json.local`
（36,344 bytes、`45be55254652287521d07e3364ccfe64a03008754285a9591c30e2d0d586f2c3`）、PAIR-3 record `PAIR-t05c1-t07c3.record.json`（754,373 bytes、
`50b32ec9c8b93542f8784e09b149790d6e23567addb1af3a545b9600f5b3ce5c`）。いずれもD2-D RESULT `sources.d2d` と一致した。

### 1.2 D2-D最良incumbent（PAIR-3）の9 Candidate（Target ID昇順）

すべて本書作成時に実ファイルのbytes・SHA-256を照合し、D2-D RESULT `inputValidation.derivedPairs[pairOrdinal = 3]`（`generatedBuildListEntryIds` /
`generatedEntrySha256s` / `requiresSupport` / `inputDigest`）と `conditions.{fixedCandidates, t05Candidates, t07Candidates}` の記録値と一致することを確認した。

| t | TargetWeapon ID | `O_t` | 由来 | G store file | bytes | SHA-256 | generated Entry ID | Search identity | `candidateStableKey` SHA-256 | `requiresSupport` | Search当時のreservation |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| t00 | `02876df4-cd56-4c95-add9-9e3e9cc90801` | `build-list.fnv1a32-bb36c5ca` | D2-C `K1-t00-e396d352` c1 | `.local/d2c-k1-formal.run/K1-t00-e396d352-c1.generated-entry.json` | 101,010 | `ee101531376ac36f491d4b1d07592fc6ca8356a62da2daeee85d956c83ff13e0` | `build-list.constrained.fnv1a32-1d2ed2a8` | `planner-alternative-search.fnv1a32-ad5c6d89` | `c3741b636fce41cfdc821b89a1e5ba31aab7ed0157e52b6ff199b7c438530f05` | `e396d352` | CTX-1 `fnv1a32:240e4673` |
| t01 | `05e6b206-21d4-447d-86dd-f5a62ff8479e` | `build-list.fnv1a32-c1fe111c` | D2-B K0 c1 | `.local/d2-formal2.run/t01-c1.generated-entry.json` | 66,309 | `3c3f5cc8f98108735da053546fc2939176e8f4050b47854ed31b3f7f6bb48f14` | `build-list.constrained.fnv1a32-174be6b1` | `planner-alternative-search.fnv1a32-1377d794` | `0441099a969be9e58deb007a0072ca4cb5c1257073a9cb3ed88ca142d63ded5f` | — | K0 `fnv1a32:5ac88909` |
| t04 | `a367c177-a0c2-4986-995e-4efcf4131b5c` | `build-list.fnv1a32-a3d6817e` | D2-C `K1-t04-92d87b90` c1 | `.local/d2c-k1-formal.run/K1-t04-92d87b90-c1.generated-entry.json` | 481,245 | `3d83de2ab3eac164f1ad49a21ed22bfe174f83a7fe8ac0f2644fda3ba49062c4` | `build-list.constrained.fnv1a32-7652f8d7` | `planner-alternative-search.fnv1a32-fe83bb24` | `54c5d75643bbcb12ad2e99077e88be8731096ff466f828e9b96428ec0a50c218` | `92d87b90` | CTX-5 `fnv1a32:36a22758` |
| t05 | `a6c17e25-bd3a-42e1-b86a-c813b78acde0` | `build-list.fnv1a32-df40f28f` | D2-C `K1-t05-61066e62` c1 | `.local/d2c-k1-formal.run/K1-t05-61066e62-c1.generated-entry.json` | 67,339 | `982b6da2247de3ce01fb06a747a0053f86e44a44a8fe8c02d1602a18ef51a0b2` | `build-list.constrained.fnv1a32-fc2f3f48` | `planner-alternative-search.fnv1a32-d3e60089` | `656920c9ece2bc75160c04f3c6d1022d5bd0226e0121f363334379bd3c5745e8` | `61066e62` | CTX-6 `fnv1a32:3eebc8a4` |
| t06 | `b27e57a7-4a80-41a8-8d8d-17bc44f868a7` | `build-list.fnv1a32-5923e1d5` | D2-B K0 c3 | `.local/d2-formal2.run/t06-c3.generated-entry.json` | 251,042 | `06a928333ceb8a85eb33572268570673a0b082e7e44b31464230fb22bd93c218` | `build-list.constrained.fnv1a32-8b2f6ba7` | `planner-alternative-search.fnv1a32-ea668773` | `d3750e51d56ccda64b86be32bde80dbb81e952b6ced1fae7e5082924ac218a53` | — | K0 `fnv1a32:5ac88909` |
| t07 | `b6780f04-da21-42b0-af8c-88f09a192e17` | `build-list.fnv1a32-fd6caf7b` | D2-B K0 c3 | `.local/d2-formal2.run/t07-c3.generated-entry.json` | 211,734 | `f23e0891fac67f6260c48aed0a121a8d2de53669b64be79efc4ca9f5d3d8abb7` | `build-list.constrained.fnv1a32-d20151d0` | `planner-alternative-search.fnv1a32-fcefda67` | `8d4af1ef62dec1cf4319c9fd720fb8fc025876ed254b147f47e81603d190f54e` | — | K0 `fnv1a32:5ac88909` |
| t08 | `d453ca34-a142-4241-9dce-8551c96cb887` | `build-list.fnv1a32-7df2bbec` | D2-B K0 c1 | `.local/d2-formal2.run/t08-c1.generated-entry.json` | 222,523 | `825e8a9eac526d62440b55bdafc21b5f5b8d98b7d00eb5b5dcdb3a80416944cc` | `build-list.constrained.fnv1a32-39482235` | `planner-alternative-search.fnv1a32-1f4c7e97` | `d070f1a2702fac3ec7cee156192ed7bc11e0e1b311bd2a3500421f7ed32d0d16` | — | K0 `fnv1a32:5ac88909` |
| t09 | `e4147de7-587c-4106-a47d-b09f8796464d` | `build-list.fnv1a32-a1d13672` | D2-B K0 c1 | `.local/d2-formal2.run/t09-c1.generated-entry.json` | 270,975 | `b791b03eed4f44197b9edf13f7dfe086c6cb89899d45b97f5390a225f1ce35bc` | `build-list.constrained.fnv1a32-d4134c84` | `planner-alternative-search.fnv1a32-77712a90` | `2bc34e4e13fc9633863d4dfffa5b84e2567695906cd2b65273a8e94b0410535b` | — | K0 `fnv1a32:5ac88909` |
| t10 | `e523209e-57e8-4316-a7f0-329f64fd0b00` | `build-list.fnv1a32-66c25e3d` | D2-C `K1-t10-e396d352` c1 | `.local/d2c-k1-formal.run/K1-t10-e396d352-c1.generated-entry.json` | 24,593 | `4ae6d9b2ca28df084a3496913fdb2e53189c7425dd460cbe3064f9f9c2307b0d` | `build-list.constrained.fnv1a32-e6ff80b1` | `planner-alternative-search.fnv1a32-18c89f1d` | `fcb28f9ea63a5ee5bdf1e1d8346ad4f5bb54945d8e3a8f3531929f7322f415f7` | `e396d352` | CTX-7 `fnv1a32:240e4673` |

- supportは `build-list.fnv1a32-` の先頭8桁表記である。PAIR-3の `S_sup` は {`61066e62`, `92d87b90`, `e396d352`}（`requiresSupport` の和、Entry ID昇順）
- **t03の2 support（`92d87b90` / `e396d352`）はPAIR-3の `S_sup` に既に含まれ、PAIR-3でselectedである**（§1.1）。t03 K2 Candidateを加えても `S_sup` は増えない
- PAIR-3ではt03 Target（`188571a7…`）は完成していない（`selectedTargetWeaponIds` に無い。`O_t03` は非selected、§1.8）

### 1.3 D2-C-Bの正式結果（`docs/PLANNER_GLOBAL_D2C_RESULT.json`、1,541,755 bytes、SHA-256 `99860c42e195de7544f5fa6b7032ad68e91950e107003cd2ed03efc86e9fcc68`）

| 項目 | 値 |
| --- | --- |
| formal validity / provenance | `provenance.formal = true`、measurement HEAD = analysis HEAD `627184363db50ef256f602014b457f05a227861c`、start attestation `a3998ab6460b03e9dbf91329a9f1e133e4eae63c201c9ac51ed05f153c695970`（verified）、calculation code digest `a86f81d1…a242`、登録policy `da3dd35c…bbf4`、Production changed files `[]`、invalid 0、unmeasured 0 |
| decision | `D2C_EXCEEDS_D2B_MAIN`（最終 `CMP-t10-c1`、23 / 20 / 1465） |
| `composition.main.steps` | t00 `accepted`、t02 `not_replaced_no_admitted`、**t03 `not_replaced_no_eligible`**、t04 `accepted`、t05 `not_replaced_no_eligible`、t10 `accepted` |
| D2-C-A / D2-C-B文書 | 104,521 bytes `edd9a3fb…70a5` / 13,983 bytes `a8fe3285…ceebe`（D2-D RESULT `sources.documents` と同じ） |
| D2-C-B run dir | start attestation 27,674 bytes `a3998ab6…5970`、raw `.local/PLANNER_GLOBAL_D2C_K1_RAW.json.local` 136,356 bytes `a0e106891b2805bb2b6b28a3b99ee31b5c535a84e795084292185e07bdc78601` |

### 1.4 t03の2つのK1 context（D2-C、`contexts[k ∈ {3, 4}]`）

| k | context | support Entry（supportのTarget） | CTX record（`.local/d2c-k1-formal.run/`） | bytes | SHA-256 | `reservationDigest` | `supportBodySha256` | `originDigest` | `excludedRouteKeySha256s` | C1〜C5 |
| ---: | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| 3 | `K1-t03-92d87b90` | `build-list.fnv1a32-92d87b90`（`cbdf9d8f-07d8-4b30-b5b3-5d8f1ab23b4a`） | `CTX-3.context.json` | 98,825 | `56ed06f37c3d3887c3d2d538111fdff1866e936bd591ba56b05b3e1c12932dda` | `fnv1a32:36a22758` | `9e9d5211a5aacd4c0fffebb5d38959fd92d360d36e264e3cb38b7f76b6efe032` | `fnv1a32:ff018910` | [`aa5f756dd827e9a8428daa6325e40797a71ee0659edebbd6df944e617f137706`] | 成立（C5 matched: `t03-r43-L0` / `-L1`） |
| 4 | `K1-t03-e396d352` | `build-list.fnv1a32-e396d352`（`820831d0-edd9-4005-a4a2-c8025cdad2c2`） | `CTX-4.context.json` | 99,020 | `c0b706ff7f7f6ecc1cc4e1dc654ae801dd454ff0ef6cf19870f0fe460798230b` | `fnv1a32:240e4673` | `d92ccdded3c09a7b98997fd6fb8ff2b6ee7223069f66575d1ba895dbc0be4b60` | `fnv1a32:ff018910` | 同上 | 成立（C5 matched: `t03-r10-L0` / `-L1`） |

- t03: TargetWeapon `188571a7-b480-4085-a8f5-59666c0e4cc5`、`O_t03 = build-list.fnv1a32-dd79ecce`。両contextとも `status = context_ready`、`conflictContextCount = 21`
- 両supportともE1外のExport Entryで、B0 / D2-B final / D2-D PAIR-3でselected（D2-C RESULT `contexts[].b0SelectedInD2` / `d2bFinalSelected`、§1.1）

DSC（discovery unit。extentはNormal / Gogma / Skill）:

| unit | context | rung / extent | outcome | delivered | wall / searchOnly | heap peak（bytes） |
| --- | --- | --- | --- | ---: | --- | ---: |
| `DSC-3-L0` | `K1-t03-92d87b90` | L0 `{4, 235, 4}` | `stopped_by_search_extent_bound` | 0 | 27.9 s / 25.3 s | 1,081,337,640 |
| `DSC-3-L1` | 同上 | L1 `{8, 235, 256}` | `stopped_by_search_extent_bound` | 0 | 45.2 s / 42.5 s | 1,289,359,904 |
| `DSC-3-L2` | 同上 | L2 `{128, 235, 1500}` | `discovery_cap_reached` | 2 | 486.8 s / 483.9 s | 3,664,824,200 |
| `DSC-4-L0` | `K1-t03-e396d352` | L0 | `stopped_by_search_extent_bound` | 0 | 45.5 s / 42.8 s | 2,061,967,168 |
| `DSC-4-L1` | 同上 | L1 | `stopped_by_search_extent_bound` | 0 | 74.1 s / 71.3 s | 3,054,186,672 |
| `DSC-4-L2` | 同上 | L2 | `discovery_cap_reached` | 2 | 693.2 s / 690.2 s | 6,898,512,160 |

pool（4件。すべて `pooled`、R0 true、`reusedExisting = false`、`replacement = ready`（`replacedBuildListEntryId = O_t03`）、`crossContextSameKey = []`）:

| ordinal | context | cost / Route kind / 操作数 | `candidateStableKey` SHA-256 | generated Entry ID | Search identity | G store SHA-256 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `K1-t03-92d87b90` | 367 / `normal_artian_to_gogma` / 363 | `adbd02acca5057c76bf345bc72e6f5960522d2f50b598d89369a9a5712dd24ee` | `build-list.constrained.fnv1a32-7cca8a04` | `planner-alternative-search.fnv1a32-24bddbf3` | `267da9af…698c` |
| 2 | `K1-t03-92d87b90` | 368 / `normal_artian_to_gogma` / 364 | `1caa2227578c383a459b1712cc29ec8f44878d9ce73019b383599034ed9e412f` | `build-list.constrained.fnv1a32-8a0eb84f` | 同上 | `5c30826a…410b` |
| 3 | `K1-t03-e396d352` | 306 / `existing_gogma_mixed` / 306 | `099088f2712f81d83649f950324d3d46d45ce8a6420369db39f80853a07450d4` | `build-list.constrained.fnv1a32-98fb311c` | `planner-alternative-search.fnv1a32-8be973fc` | `4dda106e…dd48` |
| 4 | `K1-t03-e396d352` | 307 / `existing_gogma_mixed` / 307 | `3ee9c9a3dce4823d41551bda8137c79f067ffeefa5516ef26ab0912406e08882` | `build-list.constrained.fnv1a32-29039f6e` | 同上 | `f0d49679…66c4` |

D2-Bのt03 K0 pool（D2 RESULT `discovery.targets[label = t03].pool[].keySha256`、3件）: `2cb15341b91ab2d3d18a48f8e9146d0b8d71460b928351f28f7ae10815aea0d2`、
`cbbe70c72d7bcea8df059ab5696a9410d1dda7d6975b13d6630f2995e0dc5d4c`、`8dc107d23913ca14d90d08d02c60f45fe415b012113e7e0b2f2d030740449c88`。

### 1.5 相互support阻害の観測（D2-C `ADM-t03-c1..c4` / `CMP-t03-c1..c4`、すべて `evaluated`）

| ordinal | context（自身のsupport） | ADM（baseline）: R1 / completed / Conflict | CMP（受理集合 {t00, t01, t06, t07, t08, t09} + t03） | t03 `G` | winner | winnerとのConflict（resource identity） | 他に `G` を含むConflict |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `92d87b90` | true / 20 / 21 | 23 / 20 / 1465、R5不成立（`generated_not_selected`、`conflict_within_set`） | 非selected（ADM・CMPとも） | **`e396d352`** | `same_skill_counter` Skill 341 | Skill 648（`54dd2b4e` / `b4b4c72c`）、Gogma 125（`54dd2b4e`） |
| 2 | `92d87b90` | true / 20 / 21 | 23 / 20 / 1465、R5不成立（同上） | 非selected | **`e396d352`** | Skill 341 | Skill 648、Gogma 125 |
| 3 | `e396d352` | true / 20 / 21 | 23 / 20 / 1465、R5不成立（`generated_not_selected`） | 非selected | **`92d87b90`** | `same_gogma_counter` Gogma 71 | Skill 648（`54dd2b4e` / `b4b4c72c`） |
| 4 | `e396d352` | true / 20 / 21 | 23 / 20 / 1465、R5不成立（同上） | 非selected | **`92d87b90`** | Gogma 71 | Skill 648 |

- **構造**: `92d87b90` をsupportにしてSearchしたCandidate（c1 / c2）は `e396d352` にSkill 341で負け、`e396d352` をsupportにしてSearchしたCandidate（c3 / c4）は
  `92d87b90` にGogma 71で負けた。自身のsupportは全評価でselectedだった（ADM / CMPの `supportSelected`）。CMPのc1 / c2では、受理済みt00（`e396d352` 依存）により
  `e396d352` が `S_sup` に入っていたため、Skill 341の衝突は集合内Conflictとして記録された
- resource identityの全文: Skill 341 `{"counterBefore":341,"counterStream":"skill","kind":"same_skill_counter"}`、Gogma 71 `{"counterBefore":71,"counterStream":"gogma","kind":"same_gogma_counter"}`、
  Skill 648 `{"counterBefore":648,"counterStream":"skill","kind":"same_skill_counter"}`、Gogma 125 `{"counterBefore":125,"counterStream":"gogma","kind":"same_gogma_counter"}`
- 診断値（D2-C RESULT `evaluations[].candidates` / `conflicts`）であり、D2-Eではこれらを判定に使わない（§6.4の観測診断の参照値だけに使う）

### 1.6 K1 support context record（D2-C CTX、6件。`.local/d2c-k1-formal.run/`）

| CTX | context | support | bytes | SHA-256 | `reservationDigest` | `supportBodySha256` | D2-Eでの用途 |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| CTX-1 | `K1-t00-e396d352` | `e396d352` | 35,505 | `39adb498b93d2f60cd465ae16125cee53bdf131c8979c092dcb3d0a3d6c0a2e1` | `fnv1a32:240e4673` | `d92ccdde…4b60` | t00 c1のSearch当時のreservation（RV3）、`e396d352` のS5 authority |
| CTX-3 | `K1-t03-92d87b90` | `92d87b90` | 98,825 | `56ed06f3…2dda` | `fnv1a32:36a22758` | `9e9d5211…e032` | `92d87b90` のS5 authority、K2のC4 / C6照合 |
| CTX-4 | `K1-t03-e396d352` | `e396d352` | 99,020 | `c0b706ff…230b` | `fnv1a32:240e4673` | `d92ccdde…4b60` | K2のC4 / C6照合 |
| CTX-5 | `K1-t04-92d87b90` | `92d87b90` | 338,994 | `7e42c33cbeca28265ecbc7946f9a48ae764bb3c528bbc3f89fa107d1988a4b4c` | `fnv1a32:36a22758` | `9e9d5211…e032` | t04 c1のSearch当時のreservation（RV3） |
| CTX-6 | `K1-t05-61066e62` | `61066e62` | 31,237 | `d1e415c4a06970055395901b40811dd9fe1226d6af70ce23471c831c79e5e054` | `fnv1a32:3eebc8a4` | `01228e341f3bbcd0991216133efe3b1cd7c29e3fb8f873f026550f4bf890c135` | t05 c1のRV3、`61066e62` のS5 authority |
| CTX-7 | `K1-t10-e396d352` | `e396d352` | 18,630 | `a3a531065350f1a2f854ddbb7ffe2e25d6fcf14fe7f39ea83717a5a36b012372` | `fnv1a32:240e4673` | `d92ccdde…4b60` | t10 c1のRV3 |

- 6件ともbytes・SHA-256がD2-C RESULT `contexts[].record`（CTX-1 / 5 / 6 / 7はD2-D RESULT `sources.d2c.contextRecordsUsed` とも）と一致し、`result.reservationBody` はJSONオブジェクト、
  `result.status = context_ready` である。同じsupportのrecord同士（`e396d352`: CTX-1 / CTX-4 / CTX-7、`92d87b90`: CTX-3 / CTX-5）は `reservationDigest` /
  `supportBodySha256` が一致する（D2-C-Bでreservation bodyのC5 parityもmatched）
- reservation body（JSON。`build-list.fnv1a32-` の先頭8桁で示す）:
  - `e396d352`: Normal `weapon.sword_and_shield:8` held 7..12・blocked [12]、Skill held 341..343・blocked [341, 343]、Gogma held 55..77・blocked [77]、exclusive `[]`
  - `92d87b90`: Normal なし、Skill なし、Gogma held 55..71・blocked [67, 71]、exclusive [`60126fe6-ad44-492c-bb13-b0320f2cbd2a`]
  - `61066e62`: Gogma held 55..144・blocked [107, 144]、exclusive [`aec3d2e4-2c1d-4dca-abae-39d648b2c4f0`]

### 1.7 K2 reservationの事前導出（非formal。Search・full Planner runなし）

本書作成時にscratch script（Repositoryへ追加しない）で、HEAD `2c08bc9` の既存部品を読み取り専用で1回呼んだ。入力はExport（19,424,064 bytes、
`cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`）、`globalResearchInputFromExport(Export, 20000)`、`new ProductionRngEngine()`
（`production-rng:c5-e7`）、CalculationContext `{ unknown-initial, 4, production-rng:c5-e7, 17 }`。

| 導出 | 呼び出し | 結果 |
| --- | --- | --- |
| K2（登録順） | `phase2c27bResolveSupportContext(baseline, dependencies, t03, [92d87b90, e396d352]).prepared` | `status = ready`、`invalidated.id = O_t03`、reservation digest **`fnv1a32:fd85c864`**、origin `fnv1a32:ff018910`、`excludedRouteKeys` 1件（SHA-256 `aa5f756d…7706`）、`conflictContexts` 21件 |
| K2（逆順） | 同上、`[e396d352, 92d87b90]` | 同じ body・digest（`stableStringify()` 一致） |
| Export bodyからの直接導出 | `derivePlannerAlternativeReservation([Exportの92d87b90 body, Exportのe396d352 body], engine)` | digest `fnv1a32:fd85c864`、body一致。Export bodyは各1件、SHA-256（`stableStringify()`）はCTX-3 / CTX-4の `supportBodySha256` と一致 |
| K1（各support単独） | 同上、`[92d87b90]` / `[e396d352]` | `fnv1a32:36a22758` / `fnv1a32:240e4673`（CTX-3 / CTX-4と一致）、origin・excluded keyも同じ |
| B2-C1 schedule | `derivePhase2C26B2C1Schedule(baseline, dependencies).snapshot.originDigest` | `fnv1a32:ff018910` |
| 成分ごとのunion（診断） | CTX-3 bodyとCTX-4 bodyのstream / counterIdごとのheld・blockedの和集合、exclusiveの和集合 | K2 bodyと一致 |

導出されたK2 reservation body（`stableStringify()` 表記。§3.3の登録値）:

```json
{"exclusiveOwnedWeaponIds":["60126fe6-ad44-492c-bb13-b0320f2cbd2a"],"gogma":{"blocked":[67,71,77],"held":[55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77]},"normal":[{"blocked":[12],"counterId":"weapon.sword_and_shield:8","held":[7,8,9,10,11,12]}],"skill":{"blocked":[341,343],"held":[341,342,343]}}
```

- 成分ごとのunionと一致したのは、このExport・この2 supportで観測された **結果** である。`derivePlannerAlternativeReservation()` のblockedは全fixed Entryのexclusive集合に依存する
  （`alternativeCouldShareFixedUnit()`）ので、K2の意味論を「K1 reservationの単純union」と定義しない。D2-E-Bは必ずsupport 2件のExport Entry bodyから既存authorityで再導出する（§3.3 / §4.1）
- この導出はformal evidenceではない。D2-E-BのCTX recordが同じ値を再導出し、登録値との一致をparityとして検査する（§4.1 C5、§9）

### 1.8 PAIR-3におけるt03の状況（D2-D RESULT `evaluations[PAIR-t05c1-t07c3]`、診断）

| 項目 | 値 |
| --- | --- |
| `O_t03`（`dd79ecce`） | 非selected、`rejectedBuildListEntries` に `resource_conflict` |
| `O_t03` を含むConflict | `same_gogma_counter` Gogma 71 {`92d87b90`, `dd79ecce`}（`selectedBuildListEntryId = null`）、`same_skill_counter` Skill 648 {`54dd2b4e`, `b4b4c72c`, `dd79ecce`}（同） |
| 関係するExport Entry | `54dd2b4e` はselected、`b4b4c72c` は非selected（`resource_conflict`）。どちらもsupportではなく、置換集合外 |
| support | `92d87b90` / `e396d352` / `61066e62` はselected |

### 1.9 cost参照値（見積もりの根拠。事前登録値ではない）

| 参照 | 値 | 出典 |
| --- | --- | --- |
| t03 K1 L0 / L1 | 27.9〜74.1 s、heap peak 1,081,337,640〜3,054,186,672 bytes | D2-C RESULT `discovery.units[]`（§1.4） |
| t03 K1 L2 | 486.8 s / 693.2 s、heap peak 3,664,824,200 / 6,898,512,160 bytes | 同上 |
| K1 L2全体（D2-C） | 487〜1,009 s、heap最大7.07 GB（`DSC-2-L2`、t02） | D2-C-B §3.3 / §3.5 |
| CTX child | 6.9〜7.0 s | D2-C RESULT `contexts[]` |
| 評価run（D2-D） | 8.8〜16.4 s / 件、heap最大0.74 GB、full run 1回 / 件、retry 0 | D2-D RESULT |
| RV（D2-D、12 Candidate） | 17.4 s | D2-D RESULT `aggregates.timing` |
| K2 L0 / L1 / L2 | **未計測**（K2 contextのSearchはPhase B / D2 / D2-C / D2-Dのいずれでも行われていない。Phase BはK ≤ 1だけ） | — |

### 1.10 推論（測定していない。D2-E-Bの計測で確かめる）

- I-D2E-1: K2 reservationはSkill 341（`e396d352` のblocked）とGogma 71（`92d87b90` のblocked）を両方blockedに含む（§1.7）。§1.5でD2-Cのt03 K1 Candidateが
  負けた位置はこの2つである。したがってK2 contextのSearchがdeliverするCandidateは、D2-Cの4 Candidateと同じRouteではあり得ない（R0がそれを除く）。
  **これはK2 CandidateがL2までに見つかること、selectedになること、R5を満たすこと、24 / 19から改善することのいずれも意味しない**
- I-D2E-2: D2-Cの4 Candidateはすべて、supportでないExport Entry（`54dd2b4e` / `b4b4c72c`）とのSkill 648（c1 / c2はGogma 125も）のConflictを持っていた。
  PAIR-3では `54dd2b4e` がselectedで、`O_t03` はSkill 648とGogma 71で非selectedである（§1.8）。K2 reservationはSkill 648 / Gogma 125を保持しない。K2 Candidateが
  これらの位置を使えば、t03が負けるか、t03が勝って `54dd2b4e` 側のTargetを失う（completedが増えない）可能性がある
- I-D2E-3: K2 reservationは各K1 reservationを成分ごとに包含する（§1.7）。ただし、reservationのheld位置はRouteが武器を触らずに通過できる位置でもある
  （SEARCH_SPEC 5.6.8）ので、より厳しいreservationでのSearchの到達集合が、K1の到達集合の部分集合になるとは既存仕様から導けない。K1のL0 / L1が0件だったことから、
  K2のL0 / L1が0件になるとは推定しない（§4.5）
- I-D2E-4: K2 L2のcostは未計測で、K1 L2（487 / 693 s、heap最大6.9e9 bytes）より軽いとも重いとも推定できない。L2 unitのtimeout / OOMは起こり得る（§8.4）
- I-D2E-5: t03が完成しても、別Targetを失えばcompletedは24のままである。これは「+1完成」ではない（§6.4 / §6.5）

## 2. 事前登録条件: 目的・scope・対象外

### 2.1 目的と仮説

**主仮説（未検証）**: t03について `e396d352` と `92d87b90` の両supportを同時にreservationへ含めたK2 contextでSearchすれば、D2-Cで観測された
「片方だけをsupportにしたK1 Searchでは、もう片方のsupportに負ける」構造（§1.5）を回避したCandidateが得られる可能性がある。

D2-Eはこの仮説を、次の有界な手順で測る。

1. t03の **K2 context 1件** をD2-C evidenceから機械導出し、既存authorityでreservationを再導出する（CTX、§3 / §4.1）
2. 登録ladder L0 / L1 / L2でK2 Candidateを高々2件discoveryする（DSC、§4）
3. 既存のR0 / R1でadmissionする（ADM、§5）
4. D2-D最良incumbent（PAIR-3、24 / 19）をfreshに再評価してparityを取り（I0、§6.1）、admitted K2 Candidateを1件ずつincumbentへ追加して評価する（EXT、§6.2）

K2 Candidateが見つかること、R5を満たすこと、24 / 19から改善することを事前に仮定しない。discovery、共存（R5）、全体改善（gate・improved）、R6は別々に記録する。

### 2.2 scope

| 項目 | D2-Eの値 |
| --- | --- |
| 対象Target | **t03だけ**（TargetWeapon `188571a7-b480-4085-a8f5-59666c0e4cc5`、`O_t03 = build-list.fnv1a32-dd79ecce`）。§3.1の規則で機械導出し、§3.2の登録表と一致すること |
| context | **K2 context 1件** `K2-t03-92d87b90-e396d352`（support 2件、Entry ID昇順）。K0 / K1 / K3以上のcontextのSearchは行わない |
| support | `build-list.fnv1a32-92d87b90`、`build-list.fnv1a32-e396d352`（いずれもExport上の元Entry、E1外、B0 / D2-B final / PAIR-3でselected） |
| reservation | 2 supportのExport Entry bodyから既存の `derivePlannerAlternativeReservation()`（`phase2c27bResolveSupportContext()` 経由）で再導出したもの（§3.3） |
| extent ladder | L0 `{ Normal 4, Gogma 235, Skill 4 }` / L1 `{ 8, 235, 256 }` / L2 `{ 128, 235, 1500 }`（§4.5） |
| Candidate保持数 | `K2_POOL_CAP = 2`（§4.6） |
| 比較・合成の起点 | D2-D最良 `PAIR-t05c1-t07c3` の9 Candidate（§1.2）。D2-E-Bのmeasurement HEADでfresh full runしてparityを取る（I0、§6.1） |
| 置換しないTarget | 置換集合に入らないTarget（E1外の32 Targetと、置換集合外のE1 Target t02）は元Route（Export上のEntry）のまま。43 Targetすべてを評価対象とし、Targetを除外しない |
| Export / RNG / CalculationContext | D2 / D2-C / D2-Dと同じ（Export `cc35fb5b…1e6b`、`production-rng:c5-e7`、`{ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }`） |
| Plan step bound | Research `researchMaxPlanSteps = 20000`（Production A / Bと混同しない、G12） |
| conflict resolution / fixed constraint | すべての評価runで `conflictResolutions = []`、preflightのfixed constraint `[]`（G1） |
| population | `oracleGuidedTargetPopulation = true`（E1の部分集合を継承。E1 populationはPhase Bでoracle-informedに選ばれた。このprovenanceは隠さずRESULTに記録する）。D2-Eの規則はTarget IDで分岐せず、§3.1の導出規則で機械的に決まる |

### 2.3 対象外

- t02のSearch（K1 / K2 / extent拡大 / 別support）
- t05 / t07の追加Candidate探索（3件目以降、別support、K1 / K2）
- t04 / t10の同値置換を外す別axis、PAIR-6など他のPAIRを起点にする評価
- K3以上のcontext、t03以外の新規K2 Search、E2 9 Target全体のK2探索、residual 3 Target
- winner以外のConflict co-participant（`54dd2b4e` / `b4b4c72c` 等）をsupportにすること、supportの自動追加、adaptive context expansion（結果を見たcontext・supportの追加）
- alternative-to-alternative support（生成Entryをsupportにすること）、support依存の連鎖・失効したsupportの自動再解釈
- D2-Cのt03 K1 Candidate（§1.4の4件）やD2-Bのt03 K0 CandidateをPAIR-3に対して再評価すること（複数passに当たる）
- 複数pass全般、合成順の総当たり、EXTの結果を受けた追加評価・追加合成（EXT同士の合成、受理済みTargetの再評価・差替え）
- 3 Target以上の局所再合成、population拡大（baseline未完成23 Target、43全体）
- oracle exactとの比較。oracle（`PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、manifest、module）は実行入力・診断入力・分析のいずれにも使わない
- Phase B / D1 / D2 / D2-C / D2-Dのformal RESULT・decisionの書き換え、D2-Eの結果をそれらのdecision inputへ戻すこと
- Production Search / Planner / RNG / UI / Persistence、schema / version、Production default / bounds、Domain semanticsの変更、Production化、REQUIREMENTS 23の契約変更
- Issue #154のClose

### 2.4 なぜt02を先に扱わないか（判断根拠）

t02はK1 `K1-t02-e396d352` でL0 / L1 / L2すべてCandidate 0件（L2は1,009 s・heap 6.6 GB、`ladder_exhausted`）まで確認済みである（D2-C-B §3.3）。
次に必要なのがextent拡大なのか別supportなのかは、既存evidenceから一意に決まらない（どちらを選んでも結果を見た後の条件変更に近く、登録の根拠が弱い）。
一方t03は、2つのK1 contextでCandidateを取得済み（各2件、R1成立 4 / 4）で、集合評価での失敗が互いのsupportに負けたことによると観測済みであり（§1.5）、
「2 supportを同時に置くK2 context」という具体的で未測定の仮説がある。したがって先にt03のK2を測る方がResearch上の情報価値が高い。t02は未決事項に残す（§16）。

### 2.5 なぜD2-D最良incumbentを起点にするか

- D2-D最良（PAIR-3、24 / 19 / 1465、R5成立、Trace Replay成功）は、既存formal evidenceの中で最も良い置換集合である（D2-D-B §3.1）。D2-C最終（23 / 20）へ戻して評価すると、
  t03の追加効果をD2-Dで得た改善と分離できず、得られた集合もD2-D最良を下回り得る
- t03の2 supportはPAIR-3で既にselectedであり（§1.2）、t03 K2 Candidateを加えても新しいsupportは増えない（`S_sup` は3件のまま）
- 過去RESULTの数値をそのまま採用しない。I0としてD2-E-Bのmeasurement HEADでfresh full Planner runを行い、D2-D記録とのparity（`inputDigest` / `resultDigest` /
  completed / Conflict / steps / R5）を取ってからreferenceにする（§6.1）

## 3. 事前登録条件: K2 contextの導出

### 3.1 導出規則（V・analyzerが機械的に再実行する）

```text
D2C_NE   = D2C RESULT composition.main.steps のうち stepOutcome === 'not_replaced_no_eligible' の label（Target ID昇順）
for t in D2C_NE:
    ctx(t)  = D2C RESULT contexts のうち label === t かつ status === 'context_ready'（k昇順）
    |ctx(t)| < 2 -> K2 対象外（次のTarget）
    sup(c)  = c.supportBuildListEntryId                       // context c のsupport
    obs(t)  = D2C RESULT evaluations のうち stage ∈ { ADM, CMP } かつ targetLabel === t
    for e in obs(t):
        e.status !== 'evaluated'                         -> V失敗
        x = e.candidates のうち label === t の要素          -> ちょうど1件でなければV失敗
        x.selected === false かつ x.winnerBuildListEntryId ∈ { sup(c') | c' ∈ ctx(t), c'.contextId !== x.contextId }
                                                           -> crossSupportLoss(e) = true、それ以外 false
    ADM(t) のR1がすべてtrue かつ obs(t) のすべてで crossSupportLoss = true
        -> K2(t) = { targetWeaponId, O_t, supports = sorted({ sup(c) | c ∈ ctx(t) }) }   // Entry ID昇順
K2対象 = K2(t) が定義された t の集合
```

- 導出結果は§3.2の登録表と **Target集合・O_t・support集合・順序・観測評価数（ADM 4 / CMP 4）がすべて一致** しなければならない。不一致はV失敗
  （`D2E_INVALID`、`input_evidence`）で、childを1つも起動しない。不一致を推測で補正しない
- 2 supportの集合は、D2-C evidenceのcontext supportから導出する。D2-E-B sourceへsupport Entry ID・Target IDを直接書かない（§10.3）。§3.2の表は照合にだけ使う
- 2つのK1 reservationを文字列・配列レベルでunionして新しいsemanticsを作らない。reservationは§3.3 / §4.1のとおり、support 2件のEntry bodyから既存authorityで再導出する
- support EntryのE1外判定（§4.1 C1）に使うE1 Target集合と `O_t` 集合は、D2 RESULT `discovery.targets[].{targetWeaponId, currentBuildListEntryId}`（11件）から読む。
  population manifest file・population-authority moduleは読まない（§10.3）

### 3.2 登録K2 context（1件）

| 項目 | 値 |
| --- | --- |
| context ID | `K2-t03-92d87b90-e396d352`（表示ID。同定はTargetWeapon IDとsupport Entry ID全文で行う） |
| Target | t03、TargetWeapon `188571a7-b480-4085-a8f5-59666c0e4cc5` |
| `O_t` | `build-list.fnv1a32-dd79ecce`（`candidateStableKey` SHA-256 `aa5f756dd827e9a8428daa6325e40797a71ee0659edebbd6df944e617f137706`） |
| support（Entry ID昇順） | `build-list.fnv1a32-92d87b90`（Target `cbdf9d8f-07d8-4b30-b5b3-5d8f1ab23b4a`、`supportBodySha256 9e9d5211a5aacd4c0fffebb5d38959fd92d360d36e264e3cb38b7f76b6efe032`）、`build-list.fnv1a32-e396d352`（Target `820831d0-edd9-4005-a4a2-c8025cdad2c2`、`supportBodySha256 d92ccdded3c09a7b98997fd6fb8ff2b6ee7223069f66575d1ba895dbc0be4b60`） |
| 導出根拠 | D2-C K1 context 2件（k = 3 / 4）、ADM 4件（R1 4 / 4）・CMP 4件すべてで `crossSupportLoss = true`（§1.5） |
| 対象外になるTarget | t05（`not_replaced_no_eligible` だがK1 contextが1件）、t00 / t04 / t10（`accepted`）、t02（`not_replaced_no_admitted`） |

### 3.3 登録reservation（K2 CTXの照合期待値、§1.7）

| 項目 | 登録値 |
| --- | --- |
| `reservationDigest` | `fnv1a32:fd85c864` |
| `reservationBody`（`stableStringify()`） | §1.7のJSON |
| exclusive OwnedWeapon | [`60126fe6-ad44-492c-bb13-b0320f2cbd2a`] |
| Normal | `weapon.sword_and_shield:8`: held [7, 8, 9, 10, 11, 12]、blocked [12] |
| Skill | held [341, 342, 343]、blocked [341, 343] |
| Gogma | held [55 .. 77]（23位置）、blocked [67, 71, 77] |
| origin | `originDigest = fnv1a32:ff018910`（B2-C1 schedule snapshotのorigin digest、CTX-3 / CTX-4の `originDigest` と同じ） |
| `excludedRouteKeys` | `[candidateStableKey(O_t03)]`（SHA-256 `aa5f756d…7706`、CTX-3 / CTX-4と同じ） |
| `conflictContexts` 件数 | 21（参考。判定に使わない） |

- reservationの導出は既存authorityだけで行う: `phase2c27bResolveSupportContext(baseline, dependencies, t03, [92d87b90, e396d352])`
  （= `derivePlannerAlternativeReservation([2 supportの初期context上のEntry], engine)`）。support Entryは2件ともExportの元Entryそのものを使う
- 登録値との不一致は `k2_context_registered` parityの `mismatched`（`D2E_INVALID`）であり、D2-E-Bは登録値に合わせて補正しない（§4.1 C5）

## 4. 事前登録条件: discovery（K2 Search）

### 4.1 context作成（CTX-K2、1 child）

```text
unit CTX-K2:
    baseline = globalResearchInputFromExport(Export, 20000)                 // conflictResolutions = [] を確認
    S = K2(t03).supports（§3.1、Entry ID昇順、2件）
    supportBodies = 各 s ∈ S について Export.buildListEntries のうち id === s の要素（ちょうど1件）
    resolved = phase2c27bResolveSupportContext(baseline, dependencies, t03, S)
    reservation = resolved.prepared.reservation
    記録: contextId, targetWeaponId, O_t（resolved.prepared.invalidated.id）, supportBuildListEntryIds = S,
          supportBodySha256s = { s: SHA-256(stableStringify(supportBody(s))) },
          reservationBody = structuredClone(reservation)（JSONオブジェクト）, reservationDigest = hashStableValue(reservation),
          originDigest, excludedRouteKeys（全文とSHA-256）, conflictContextCount,
          checks C1〜C7, diagnostics { equalsK1ComponentwiseUnion, k1Reservations { s: CTX record SHA-256 / digest } }
    record file: <run dir>/CTX-K2.context.json（runnerがbytes・SHA-256をjournalへ記録）
```

| check | 内容 | 不成立時 |
| --- | --- | --- |
| C1 | `|S| = 2` で重複なし。各 `s` について、support EntryがExportの `buildListEntries` にちょうど1件あり、そのTarget IDがE1 Target集合（§3.1）に無く、IDが生成Entry prefix（`build-list.constrained.`）でなく、いずれのE1 Targetの `O_t` でもない | guardrail違反（`D2E_INVALID`） |
| C2 | `resolved.status === 'ready'`、`resolved.prepared.invalidated.id === O_t03`、`resolved.prepared.supportBuildListEntryIds` が `S` と一致 | guardrail違反 |
| C3 | 導出reservationの `exclusiveOwnedWeaponIds` が、2 supportの `collectReferencedOwnedWeaponIds(supportBody.candidateSnapshot.route)` の和と、2 supportを1回の `createPlannerRouteUnitPlans([2 body], engine)` で計画したunitの `exclusiveConsumedOwnedWeaponId` をすべて含む | guardrail違反 |
| C4 | `hashStableValue(resolved.prepared.origin)` がB2-C1 schedule snapshotの `originDigest`、CTX-3 / CTX-4 recordの `originDigest` と一致。`excludedRouteKeys` が `[candidateStableKey(O_t03.candidateSnapshot)]` で、scheduleのt03の `excludedRouteKeys`、CTX-3 / CTX-4の `excludedRouteKeySha256s` と一致 | guardrail違反 |
| C5 | `reservationDigest === 'fnv1a32:fd85c864'` かつ `stableStringify(reservationBody) === stableStringify(§3.3の登録body)`（両辺オブジェクト） | parity `k2_context_registered` `mismatched`（`D2E_INVALID`） |
| C6 | 包含: 各 `s` について、K2 bodyが `s` のK1 CTX record（`92d87b90`: CTX-3、`e396d352`: CTX-4）の `reservationBody` を成分ごとに包含する（Normalはcounter IDごと、Normal / Skill / Gogmaの `held` ⊇、`blocked` ⊇、`exclusiveOwnedWeaponIds` ⊇） | guardrail違反 |
| C7 | 順序不変: `S` を逆順にした `phase2c27bResolveSupportContext()` の導出reservationが、`stableStringify()` とdigestで一致する（`derivePlannerAlternativeReservation()` が意味集合であることの確認） | guardrail違反 |

- `equalsK1ComponentwiseUnion` は診断だけに記録する（本書作成時の観測値はtrue、§1.7）。判定・semanticsに使わない
- **`reservationBody` の保存・比較形式**: D2-C-A §4.1と同じ。JSONオブジェクトとして保存し、`stableStringify()` 済み文字列として保存しない。比較は両辺オブジェクトの
  `stableStringify()` 一致、digestは文字列一致。runner・analyzerは読込時にrecordのbytes・SHA-256をjournalと照合し、`reservationBody` がJSONオブジェクトであることを確認する
  （文字列等なら `evidence_integrity`。文字列をparseして救済しない）
- support Entryはexportの元Entryそのものを使い、user-fixed Route、resolution、scenario resolution、repair lineage、fixed constraint、`selectedBuildListEntryId` に変換しない（G1）
- CTX-K2はSearchを実行しない。full Planner runも起動しない
- analyzerはC1 / C3 / C4 / C6をExport・CTX record・K1 CTX recordから独立に再計算し、C5 / C7はrecordと登録値で再照合する

### 4.2 Search入力とconsumer（unit = (K2 context, rung)、unitごとに新しいchild）

```text
pool = []                              // K2 contextのunique Candidate（discovery順、最大 K2_POOL_CAP = 2）
unit DSC-K2-<rung>:
    resolved = phase2c27bResolveSupportContext(baseline, dependencies, t03, S)
    reservation body / digest、originDigest、excludedRouteKeys、O_t が CTX-K2 record と一致しない -> guardrail違反（context_drift、D2E_INVALID）
    searchInput = { origin, targetWeaponId: t03, extent: rung, reservation, excludedRouteKeys }
    visitPlannerAlternativeCandidates(searchInput, engine, consumer)     // capture policy・instrumentationなし、既存orderingのまま
    consumer(candidate):
        key = candidateStableKey(candidate)
        R0-K2:    respectsPhase2C2Reservation(summarizePhase2C2Entry(...), candidate.route, reservation) が偽   -> guardrail違反（D2E_INVALID）
        R0-split: 各 s ∈ S について respectsPhase2C2Reservation(..., candidate.route, K1 CTX record(s).reservationBody) が偽 -> guardrail違反（不変条件違反）
        key ∈ poolのkey                            -> action = duplicate_of_lower_rung、continue（D-2）
        SHA-256(key) ∈ D2B_K0_POOL(t03)            -> action = same_key_as_d2b_k0_pool、continue（D-4）
        SHA-256(key) ∈ D2C_K1_POOL(t03)            -> action = same_key_as_d2c_k1_pool、continue（D-5）
        それ以外 -> materializer.materializeBuildListEntry(candidate, baseline.buildListEntries)
                    G store へbody全体を書く（SHA-256を記録）、poolへ追加、action = pooled
                    |pool| = K2_POOL_CAP -> stop、それ以外 -> continue
```

- 消費者はdiscovery中にtrial（full Planner run）を行わない。`found_R` を探索停止条件にしない（follow-up §4.2）
- Search ordering、Candidate semantics、extentの意味、`excludedRouteKeys` を変えない。`excludedRouteKeys` にD2-B K0 / D2-C K1のCandidateを足さない（D-4 / D-5はconsumer側の分類である）
- materializeは既存materializer（`createPlannerAlternativeMaterializer({ ...searchInput, clock })`）だけで行い、Route・`route.operations` からBuildListEntryを組み立てない
- **support 2件のreservationを実際に尊重していることの検証**: R0-K2（K2 reservationに対するR0）と、R0-split（各supportのK1 reservationに対するR0）を全deliveryで記録する。
  C6（包含）が成立していればR0-K2 ⇒ R0-splitであり、R0-splitの不成立は不変条件違反として扱う。評価時はS6（§7.2）で、評価入力内の2 support bodyから再導出したreservationが
  CTX-K2と一致することも検査する
- R0の不成立はPhase B / D2 / D2-Cの全deliveryで一度も観測されていない。SearchはreservationをSearch入力として受け取るので、不成立は通常の結果として扱わない

### 4.3 重複排除（5層を区別する）

| 層 | 規則 | 扱い |
| --- | --- | --- |
| D-1 同一unit内 | Searchは1 run内で同じ `candidateStableKey` を2回deliverしない（`visitPlannerAlternativeCandidates()` の `seen`） | 2回目が観測されたら不変条件違反（guardrail、`D2E_INVALID`） |
| D-2 同一context・rung間 | key（全文）がpoolに既にある | `duplicate_of_lower_rung`。poolに数えない、materializeしない（D2-C-A §4.3と同じ） |
| D-3 異なるcontext間 | K2 contextは1件なので該当しない | — |
| D-4 D2-Bのt03 K0 pool（§1.4の3 key） | `SHA-256(key)` が一致 | `same_key_as_d2b_k0_pool`（一致したD2-B ordinalを記録）。poolに数えない。D2-C-A §4.3 D-4と同じく、support不要の同じRouteは既にadmission・集合評価されており、K2のsupport依存を付けても新しいRouteは増えない。そのK0 CandidateをPAIR-3に対して再評価することは複数passであり、登録しない |
| D-5 D2-Cのt03 K1 pool（§1.4の4 key） | `SHA-256(key)` が一致 | `same_key_as_d2c_k1_pool`（一致したD2-C ordinal・context IDを記録）。poolに数えない。理由はD-4と同じ（support 1件で既にdiscovery・admission・集合評価されたRouteに、support依存を1件足すだけになる）。I-D2E-1のとおりR0-K2により起き得ない見込みだが、規則として常に検査する（R0-K2の検査が先に行われる） |

- K2 CandidateとD2-Cのt03 K1 Candidateは、Search identity（reservation・extentを含む）、`requiresSupport`、CTX record SHA-256、G store SHA-256が異なる別Candidateである。
  generated Entry IDはCandidate意味・hash・CalculationContextだけから決まるので一致し得るが、同定は (context ID, key) とし、Entry IDだけで同定しない
- 他TargetのCandidate・incumbentの `G` とはkeyが一致し得ない（Targetが異なる）。一致した場合は不変条件違反である

### 4.4 rungの進行・停止

unitの型付きoutcomeはD2-C-A §4.4と同じ規則で判定する（上から）:

```text
consumerがstopした（|pool| = 2）              -> discovery_cap_reached          : discovery終了
summary.exhausted                             -> discovery_exhausted            : discovery終了
summary.stoppedByExtent                       -> stopped_by_search_extent_bound : 次rungへ（L2なら ladder_exhausted で終了）
timeout / OOM / process failure / interrupted -> unmeasured                     : discovery終了（上位rungへ進めない、G6 / G11）
typed calculation error                       -> discovery_calculation_error    : unmeasured扱い
not_executed（envelope到達、abort）            -> not_executed                   : discovery終了
```

- 上位rungへ進む条件は、unitが `stopped_by_search_extent_bound` で終わり、かつ `|pool| < 2` であることだけである
- L0 / L1でpoolが1件になっても、上位rungへ進む条件は同じである（`|pool| < 2`）。上位rungで同じkeyが再度deliverされた場合はD-2になる

### 4.5 extent ladder（固定）

| rung | maxNormalAdvance | maxGogmaAdvance | maxSkillAdvance |
| --- | ---: | ---: | ---: |
| L0 | 4 | 235 | 4 |
| L1 | 8 | 235 | 256 |
| L2 | 128 | 235 | 1500 |

根拠:

1. Phase B / D2 / D2-Cの登録ladderそのままである。t03のK1 2 contextも同じladderで計測されており（§1.4）、K2の結果をK1と同じ軸で比較できる
2. L0 / L1を省略しない。K1のL0 / L1は0件だったが、I-D2E-3のとおりK2の到達集合がK1の部分集合になるとは導けない。L0 / L1のcostは小さい（K1で28〜74 s）
3. L2を初回formalに含める。t03のK1 CandidateはL2で初めて得られた（2 contextとも）。K2はK1より厳しいreservationなので、L2を除いた計測は結果がほぼ事前に決まる可能性が高い
4. L2より上のrungは無い。Gogma 235は既存authority（`defaultPlannerAlternativeSearchExtent`、Issue #101 real fixtureの実測境界、SEARCH_SPEC 5.6.8）のまま全rungで変えない

**結果を見てextentを追加・変更しない**。L2で `ladder_exhausted` / `stopped_by_search_extent_bound` になっても、L3や別extentを同じD2-E内で追加しない（新しい事前登録を要する）。

### 4.6 discoveryの上限・Candidate保持数（すべて事前登録値）

| 量 | 上限 | 導出 |
| --- | ---: | --- |
| context | 1 | §3.2 |
| CTX unit | 1 | — |
| DSC unit（Search unit） | **3** | L0 / L1 / L2 |
| unique Candidate（pool） | **`K2_POOL_CAP = 2`** | 下記 |
| unitあたりdelivery | **9** | pooled ≤ `2 − |pool|開始時`、`duplicate_of_lower_rung` ≤ `|pool|開始時`（両者の和 ≤ 2）、`same_key_as_d2b_k0_pool` ≤ 3、`same_key_as_d2c_k1_pool` ≤ 4（Searchの `seen` により各key高々1回）。`excludedRouteKeys` で除外されたRouteはdeliverされない |
| G store file | 2 | pooled 1件につき1 |

`K2_POOL_CAP = 2` の根拠（D2-CのK1を継承する）:

1. D2-CのK1 context（7件）と同じ値にして、contextあたりの情報量・costをK1と比較可能にする
2. D2-Cのt03では、両contextとも2件のCandidateがcost隣接（367 / 368、306 / 307）の近縁Routeだった（§1.4）。3件目以降も同じ型の近縁Routeである可能性が高く、
   集合評価での情報価値に比べてL2 Searchの延長（cap停止が遅れる）のcostが読めない
3. EXT（PAIR-3への追加評価）は1 Candidateにつき1評価で有界にする（§8.3）
4. 値2はoracle由来ではない

### 4.7 記録

各pooled Candidateについて記録する: context ID、support Entry ID（2件）、unit ID、rung、unit内delivery index、discovery ordinal（§5）、`candidateStableKey()` 全文とSHA-256、
cost（`estimatedOperationCount`）、Route kind、`route.operations` 件数、R0-K2、R0-split（support別）、Search identity（`createPlannerAlternativeSearchIdentity()`）、
Search入力として使ったreservation digest、CTX-K2 record SHA-256、generated Entry ID、`reusedExisting`、G store fileとbytes・SHA-256、
`resolveBuildListEntryReplacement()` の結果（`ready` かつ `replacedBuildListEntryId === O_t03`）、`requiresSupport = S`（Entry ID昇順）。

各unitについて記録する: Search summary（`deliveredCandidates` / `excludedCandidates` / `exhausted` / `stoppedByExtent` / `stoppedByConsumer` / `skippedExcludedRouteKeys` 件数）、
consumerが受け取った全deliveryのkey SHA-256・cost・action（`pooled` / `duplicate_of_lower_rung` / `same_key_as_d2b_k0_pool` / `same_key_as_d2c_k1_pool`）・R0-K2・R0-split、
Search identity、searchOnlyMs、materializeMs、wall、heap / RSS peak。

## 5. 事前登録条件: admission（ADM、R1）

discovery ordinal（1始まり）は (rung昇順, unit内delivery index) の辞書式順である（contextは1件）。pooled Candidateごとにadmission評価を1件行う。

| 項目 | 値 |
| --- | --- |
| 評価ID | `ADM-K2-t03-c<ordinal>`（D2-Cの `ADM-t03-c<o>` と別の評価。混同しない） |
| 入力 | `T = { t03 }`、`G = 当該Candidate`（D2-EのG storeのbody）。D1-A §4.1と同じ手順（baseline + `G` を末尾に追加、9.2.18 replacement、preflight、full runner） |
| `evaluatedAgainst` | `baseline` |
| `requiresSupport` | `S`（`[92d87b90, e396d352]`、Entry ID昇順） |
| 実行順 | discovery ordinal昇順 |
| 上限 | 2 |

R1（`candidate_admissible_R`）の成立条件はD2-A §3 / D2-C-A §5.1と同じ（すべて必須）:

1. discoveryのmaterializationで `reusedExisting === false`（`true` なら評価を実行せず `not_run_reused_existing`、measured、R1偽）
2. `resolveBuildListEntryReplacement()` が `ready` で `replacedBuildListEntryId === O_t03`
3. preflight `ready`
4. 評価statusが `evaluated`（full runがPlannerResultを返し、Plan生成とTrace Replayが例外なく完了）
5. `plan !== null` かつ `termination.status ∈ { 'completed', 'exhausted' }`

- **admitted** ⇔ R1成立。K2であることを理由に判定を緩めない（supportのselectedはR1に含めない。それはR2）
- 次を **診断として** 記録する: R2（`support_consistent_R`。非vacuous: R1 ∧ `S` の2件がともにselected ∧ `G` といずれかのsupportを同時participantとするConflictなし）、
  R3（`generated_selected_R`）、R4（`joint_selected_R`）、`target_regressed_R`、Phase Bと同じ `found_R` 判定（`judgePlannerAlternativeTrial()`、
  explicit decision = fixed Route = support = `S`）、`G` を外した勝者Entry、`crossSupportLoss`（勝者が `S` の要素か）、`G` を含むConflictの他participant、S1〜S3
- S4 / S5 / S6（静的check、§7.2）はADMでも検査し、不成立はguardrail違反（`D2E_INVALID`）である
- `G` がselectedでないこと、R2 / R3 / R4が偽であること、`target_regressed_R`、`found_R` 不成立を理由にCandidateをpool・admissionから除外しない（G14 / G26）
- ADMの結果（R1〜R4）をR5として流用しない（G20 / G25）

## 6. 事前登録条件: 集合評価

### 6.1 I0（D2-D最良incumbentのfresh再評価）

| 項目 | 値 |
| --- | --- |
| 評価ID | `I0` |
| 集合 | D2-D RESULT `decision.bestImprovedPair`（= `bestEligiblePair` = `PAIR-t05c1-t07c3`）の置換集合、§1.2の9件（Target ID昇順）。D2-D RESULT `inputValidation.derivedPairs[pairOrdinal = 3]` から機械導出し、§1.2と照合する |
| `G` のbody | §1.2のG store（D2-B run dirの5件、D2-C run dirの4件）。runnerは読み込み時にbytes・SHA-256を登録値・D2-D RESULT `conditions` / `derivedPairs` と照合する |
| `requiresSupport` | t00 / t10: `[e396d352]`、t04: `[92d87b90]`、t05: `[61066e62]`、他: `[]` |
| support record（評価入力） | D2-Dと同じく、各K1置換は自身のCTX record（t00: CTX-1、t04: CTX-5、t05: CTX-6、t10: CTX-7） |
| `evaluatedAgainst` | `replacement_set` |
| 期待値（parity `d2d_best`、§9） | `inputDigest = fnv1a32:6493291d`、status `evaluated`、`resultDigest = fnv1a32:57dbb4e5`、termination `exhausted`（`reachedLimits = []`）、completed 24 / 43、Conflict 19、steps 1465、R5成立、`resourceConflictRejections = 19`、`92d87b90` / `e396d352` / `61066e62` がselected |
| 役割 | EXTのreferenceとgateの基準。比較値「D2-D最良」の **D2-E-B内の実行結果** |

- **D2-Dの過去RESULTを新しい集合評価の実行結果として流用しない**。gate・比較のreferenceはI0の評価recordだけから読む。D2-D RESULTの値はparityの期待値にだけ使う
- I0が比較可能な結果を持ち期待値と異なれば `mismatched`（`D2E_INVALID`）で、runnerは直ちに中止する（§8.5）
- I0がunmeasuredなら、EXTは評価を起動せず `not_executed`（`notExecutedReason = i0_unmeasured`）で、decisionは `D2E_INCOMPLETE`。CTX / DSC / ADMは続ける（下限evidence）
- t03の2 supportがI0でselectedであることは、parity期待値の一部として検査する（D2-D RESULTでの事実は§1.2、V）

### 6.2 EXT（admitted K2 Candidateを1件ずつincumbentへ追加）

```text
for c in admitted K2 Candidates（discovery ordinal昇順）:       // 早期打ち切りなし。全件評価する
    proposed = I0の置換集合（9件）∪ { t03: c }               // Target ID昇順、10件。O_t03 → c の置換を加える
    評価 EXT-K2-t03-c<ordinal>: proposed を evaluatedAgainst = replacement_set として1 runで評価
        手順はD1-A §4.1 / D2-C-A §6.2と同じ: baseline + 各 G を末尾に追加、9.2.18 replacement（-O_t + G）、preflight、
        full runner（Trace Replayを含む）、評価ごとのfull Planner起動上限8
    記録: R5（§6.3）、EXT診断（§6.4）、gate・improved（§6.5）、R6（§6.6）
```

- 各EXTはI0の集合だけに依存し、他のEXTの結果に依存しない。incumbentの9件のbody・`requiresSupport` は全EXTで同じであり、選び直さない
- 1回のPlannerInputには各Target高々1件の生成Entryだけを入れる（G15）。2件のK2 Candidateを同じPlannerInputへ入れない
- EXT同士の比較・選択（§6.5）は記録済みの結果だけで行い、追加の評価runを行わない。最良EXTを起点にした追加の合成・受理済みTargetの再評価をしない（単一段）
- 評価上限: EXT 2件（admittedが0件ならEXTは0件）

### 6.3 R5（`set_coexistent_R`）

D2-D-A §5.1（D2-C-A §6.3、D1-A §4.4）の5条件を、各評価の置換集合へそのまま適用する。

記号: 置換集合 `T`、`S_G = { G_t.id | t ∈ T }`、`S_sup = ⋃_{t ∈ T} requiresSupport(G_t)`、`M = S_G ∪ S_sup`、`selected = plan.selectedBuildListEntryIds`。

| 条件 | 判定 | failure reason |
| --- | --- | --- |
| (1) 置換集合の全generated Entryがselected | `S_G ⊆ selected` | `generated_not_selected`（どの `G_t` かを列挙） |
| (2) 必要supportがすべてselected | `S_sup ⊆ selected` | `support_not_selected`（どの `s` かを列挙） |
| (3) support依存が有効 | `S_sup` の各 `s` について§7.2の動的check S1〜S3がすべて成立 | `support_expired_R`（`supportExpiryCause`） |
| (4) 集合内Conflictなし | `result.conflicts` に `|c.buildListEntryIds ∩ M| ≥ 2` となる `c` が存在しない（`c.selectedBuildListEntryId` によらない） | `conflict_within_set` |
| (5) Plan + Trace Replay | 評価statusが `evaluated`、`plan !== null`、`termination.status ∈ { 'completed', 'exhausted' }` | `no_plan` / `plan_bound_truncated` / `preflight_refused` / `planner_rerun_bound_reached` |

- `R5.satisfied = (1) ∧ (2) ∧ (3) ∧ (4) ∧ (5)`。(5)が偽でも計算できる条件は記録する
- EXTでは `|S_G| = 10`、`S_sup = { 61066e62, 92d87b90, e396d352 }`（3件。t03 K2 Candidateは新しいsupportを加えない）、`|M| = 13`。I0では `|S_G| = 9`、`|S_sup| = 3`
- R5は置換集合外Targetの完成、Conflict 0、全体completedの増加を要求しない。**R5成立はIssue #154の最終Acceptanceではない**（それはR6、§6.6）
- supportがPlannerでselectedにならなかった場合は(2)偽でR5不成立（measured、通常の非共存）であり、INVALIDではない

### 6.4 EXTの診断（判定にはR5・gate・improved・R6だけを使う）

| field | 内容 |
| --- | --- |
| `t03.{generatedBuildListEntryId, selected, winnerBuildListEntryId, targetSelected}` | t03 K2 Candidate自身がselectedか、非selectedならprovisional winner（D1の `candidates[]` と同じ定義）、t03 Targetが `selectedTargetWeaponIds` に含まれるか（別fieldとして記録し、`selected` と一致しなくても補正しない） |
| `t03Supports[]` | `S` の各 `s` の `selected`、S1〜S5、`supportExpiryCause` |
| `incumbentRetention` | `{ allIncumbentGeneratedSelected, incumbentGeneratedNotSelected[] { label, generatedBuildListEntryId, winnerBuildListEntryId } }`（I0の9件の `G` がEXTでも全件selectedか） |
| `supportExpired` | `S_sup` のいずれかでS1〜S3が不成立か（原因別） |
| `conflictsWithinSet[]` | `|c.buildListEntryIds ∩ M| ≥ 2` のConflict（kind、participants、resource identity、`selectedBuildListEntryId`） |
| `conflictsWithT03G[]` | t03 `G` をparticipantとするConflictと、相手の分類（`support` / `incumbent_generated` / `outside_set`） |
| `d2cT03ResourcesObserved[]` | §1.5の4つのresource identity（Skill 341、Gogma 71、Skill 648、Gogma 125）が、t03 `G` をparticipantとするConflictとして現れるか（各true / false） |
| `referenceDiff` | I0比の `completedDelta` / `conflictDelta` / `stepsDelta` / `targetsGained[]` / `targetsLost[]` |
| `t03Completion` | `{ t03TargetCompleted, netCompletedDelta, t03CompletedWithoutNetGain }`。`t03CompletedWithoutNetGain = t03TargetCompleted ∧ netCompletedDelta ≤ 0`（t03を得て別Targetを失った場合など） |
| `resourceConflictRejections` | `plan.rejectedBuildListEntries` の `reason === 'resource_conflict'` 件数（I0は19） |

- **t03が完成しても、別Targetを失って24 / 43のままなら「+1完成」と記録しない**。全体の完成数の変化は `netCompletedDelta`（= `referenceDiff.completedDelta`）だけで表し、
  t03の完成は `t03TargetCompleted` として別に記録する
- 診断はINVALID / INCOMPLETEの理由にしない

### 6.5 非後退gate・「より良い」・選択順

- gate: `completed(EXT) ≥ completed(I0)`（`termination.completedTargetCount`。I0はD2-E-Bのfresh評価の値で、parityにより24）
- gate不成立でR5成立のEXTは `r5OnlyEligible = true`（診断）
- **eligible(EXT)** ⇔ 評価statusが `evaluated` ∧ R5成立 ∧ gate成立
- 「(a) が (b) より良い」は、completedが大きい、またはcompletedが等しくConflict（`result.conflicts.length`）が少ないことをいう（D2-A §9.1 / D2-C-A §11.1 / D2-D-A §5.4と同じ。
  **stepsは「より良い」に使わない**）
- **improved(EXT)** ⇔ eligible(EXT) ∧ (completed, Conflict) がI0より良い
  - completedがI0と等しくConflictが等しい場合は `equalMetrics = true`、多い場合は `conflictIncreased = true` を記録し、改善ではない
  - `improvementKind`: `completed_increase`（completed > 24）/ `conflict_decrease_only`（completed = 24、Conflict < 19）/ `null`。後者はt03完成による改善と混同しない
- 選択順（eligibleが複数あるとき、上から）: (1) completed 大きい方、(2) Conflict 少ない方、(3) `plan.steps.length` 少ない方（同率時のtie-breakだけ）、(4) discovery ordinal 小さい方
- `bestEligibleExtension` = eligibleのうち選択順で最初のもの（無ければnull）。`bestImprovedExtension` = improvedのうち選択順で最初のもの（無ければnull）
- 比較値はすべて当該評価runの結果から読み、ADM・D2-C・D2-Dの過去評価の値を使わない。選択は記録だけで、選択したEXTを起点にした追加の評価・合成をしない

### 6.6 R6（`global_complete_R`）

`replacement_set` の評価（I0、EXT）について、D2-D-A §5.6と同じ5条件をすべて満たすこと:

1. `evaluated` かつ `plan !== null` かつTrace Replay成功
2. `termination.status === 'completed'` かつ `completedTargetCount === totalTargetCount === 43`
3. `result.conflicts.length === 0`
4. `plan.rejectedBuildListEntries` に `reason === 'resource_conflict'` が無い
5. R5成立

R5成立・t03完成・completed増加・Conflict減少だけではR6を主張しない。t03の追加だけでR6へ届くことは仮定しない（I0のcompletedは24、`resource_conflict` 19）。

## 7. 事前登録条件: Candidate・support validity

### 7.1 RV（1 child。評価・Searchの前に1回だけ行う）

D2-D-A §6.1と同じ検査を、incumbentの9件とsupport 3件に適用する。

```text
unit RV:
    baseline = globalResearchInputFromExport(Export, 20000)                        // conflictResolutions = [] を確認
    for G in incumbent 9件（§1.2）:
        RV1 body: SHA-256、id、targetWeaponId、calculationContext、isStale = false、candidateSnapshot.searchRunId === 登録Search identity、
                  SHA-256(candidateStableKey(G.candidateSnapshot)) === 登録keySha256（§1.2、D2-D RESULT conditions）
        RV2 replacement: resolveBuildListEntryReplacement(baseline, G) が ready かつ replacedBuildListEntryId === O_t
        RV3 Search当時のreservation res(G):
              K0: phase2c27bResolveSupportContext(baseline, dependencies, t, []).prepared.reservation、digest === 'fnv1a32:5ac88909'
              K1: 自身のCTX record（t00: CTX-1、t04: CTX-5、t05: CTX-6、t10: CTX-7）の reservationBody / reservationDigest
        RV4 R0再判定: respectsPhase2C2Reservation(summarizePhase2C2Entry(G, baseline, engine), G.candidateSnapshot.route, res(G)).respects === true
    for s in { 61066e62, 92d87b90, e396d352 }:
        RV5 S4相当: Exportの s のbodyが1件あり、SHA-256(stableStringify(body)) === sのすべてのK1 CTX recordの supportBodySha256
        RV6 S5相当: (a) hashStableValue(derivePlannerAlternativeReservation([Exportの s のbody], engine)) === sのすべてのK1 CTX recordの reservationDigest
                    (b) stableStringify(導出reservation) === stableStringify(各K1 CTX record reservationBody)（両辺オブジェクト）
        sのK1 CTX record: 61066e62 → CTX-6、92d87b90 → CTX-3 / CTX-5、e396d352 → CTX-1 / CTX-4 / CTX-7
    記録: <run dir>/RV.record.json（runnerがbytes・SHA-256をjournalへ記録）
```

- RV1〜RV6のいずれかの不成立はguardrail違反（`D2E_INVALID`、`guardrail`）であり、runnerは直ちに中止する（§8.5）
- RVはSearchを実行しない。full Planner runも起動しない。discovery・materializationもしない（G store bodyは読み込むだけで書き換えない）
- K2 CandidateはRVの対象ではない（RVの時点で存在しない）。K2 CandidateのR0はDSCのconsumer（§4.2）、RV1 / RV2相当は評価child（§7.2）で検査する
- K0 CandidateにsupportやK1 / K2のreservationを付け足さない。Search当時のreservationだけをRV3 / RV4の基準にする（G42）

### 7.2 評価時のcheck（ADM / I0 / EXT）

support check（`S_sup` の各 `s` について。D2-C-A §7.2 / D2-D-A §6.2と同じ）:

| check | 内容 | 種類 | 不成立時 |
| --- | --- | --- | --- |
| S1 | `s` のTargetが置換集合 `T` に含まれない | 動的 | R5(3)偽、`support_expired_R` |
| S2 | 最終run入力（runtime-unsupported retry後）の `buildListEntries` に `s` が存在する | 動的 | R5(3)偽、`support_expired_R` |
| S3 | 最終run入力の初期contextに `s` がvalid Entryとして存在する | 動的 | R5(3)偽、`support_expired_R` |
| S4 | 評価入力内の `s` のbodyがExportのbodyと `stableStringify()` で一致し、そのSHA-256が `s` のS5 authority recordの `supportBodySha256` と一致する | 静的 | guardrail違反（`D2E_INVALID`） |
| S5 | (a) `hashStableValue(derivePlannerAlternativeReservation([Exportの s のbody], engine))` がS5 authority recordの `reservationDigest` と一致し、かつ (b) 導出reservationとrecordの `reservationBody` の `stableStringify()` が一致する | 静的 | guardrail違反 |

- S5 authority record: `e396d352` → CTX-1、`92d87b90` → CTX-3、`61066e62` → CTX-6（各supportの最小kのrecord。同じsupportの他recordとの一致はV・RVで確認する）

K2 Candidateの組のcheck（評価集合に含まれる各K2 Candidate `G` について。ADM / EXT）:

| check | 内容 | 種類 | 不成立時 |
| --- | --- | --- | --- |
| S6 | (a) `hashStableValue(derivePlannerAlternativeReservation([評価入力内の S の2 body], engine))` がCTX-K2 recordの `reservationDigest` と一致し、かつ (b) 導出reservationとCTX-K2 recordの `reservationBody` の `stableStringify()` が一致する。加えて、`G` のpooled recordのSearch入力reservation digestがCTX-K2の `reservationDigest` と一致する | 静的 | guardrail違反（`support_pair_reservation_mismatch`、`D2E_INVALID`） |
| RV1′ / RV2′ | full runの前に、評価集合の全 `G`（incumbent 9件とK2 Candidate）についてbody SHA-256・id・targetWeaponIdとreplacement `ready`（`replacedBuildListEntryId === O_t`）を再確認する | 静的 | guardrail違反 |

- 評価childへの受け渡し: bytes・SHA-256を照合済みのCTX recordの `result.reservationBody` オブジェクトと `reservationDigest`、`supportBodySha256` を渡す（D2-C-B / D2-D-Bと同じ。
  文字列を渡さない）。K2 Candidateの評価taskにはCTX-K2の値を、support別のS4 / S5には各supportのS5 authority recordの値を渡す
- K0 Candidate（t01 / t06 / t07 / t08 / t09）はsupportを要求しないので、S1〜S6の対象にならない。K0の `G` 自身の選択はR5(1)で検査する
- S1は登録scopeでは構造上成立する（supportのTargetはE1外で、置換集合はE1 Targetだけ）が、規則として常に検査する
- supportは通常のBuild List Entryとして扱い、user-fixed Route、resolution、scenario resolution、repair lineage、fixed constraint、`selectedBuildListEntryId` に変換しない（G30）

### 7.3 support失効・不成立の原因（RESULTの `supportExpiryCause`）

D2-C-A §7.3の表をそのまま使い、次を追加する（上から最初に該当するもの。S4 / S5 / S6が不成立なら記録した原因によらず `D2E_INVALID`）。

| 原因 | 判定 | 区分 |
| --- | --- | --- |
| `support_pair_reservation_mismatch` | S6不成立 | `D2E_INVALID`（guardrail） |

- 失効・不成立したCandidateを、別support上の結果、K1 / K0 Candidate、置換後Routeをsupportとする結果として読み替えない（G18）。失効を理由に自動で再Searchしない

## 8. 事前登録条件: 実行順序・status・budget・envelope

### 8.1 実行順序（固定）

```text
V      入力検証（親。childを起動しない、§10.1）
RV     incumbent 9件・support 3件の再検証（1 child。Searchもfull Planner runも行わない、§7.1）
B0     baseline参照評価（D1-A §5.1、{ kind: 'persisted' }）
I0     D2-D最良incumbentのfresh再評価（§6.1）
CTX    CTX-K2（§4.1）
DSC    L0 → L1 → L2（§4.4の進行規則による）
ADM    discovery ordinal昇順（§5）
EXT    discovery ordinal昇順（admittedだけ、§6.2）
```

- B0 / I0を高価なdiscoveryの前に行い、parity不一致なら中止する（§8.5）
- 登録された評価をすべて実行する。早期打ち切りはしない（どのEXTでR5や改善が成立しても、残りのEXTを評価する）。同じ `inputDigest` の評価が既にあっても結果を流用せず、
  別のchild processで実行する

### 8.2 status

D2-C-A §8.2 / D2-D-A §7.1の評価status・discovery unit statusをそのまま使い、次を追加・確認する。

| 対象 | status / outcome | measured | 扱い |
| --- | --- | --- | --- |
| RV | `verified` | yes | B0へ |
| RV | RV1〜RV6不成立 | — | guardrail違反（`D2E_INVALID`、runnerは中止） |
| RV | `timeout` / `out_of_memory` / `process_failure` / `interrupted` | **no** | 以降の全段 `not_executed`（`rv_unmeasured`）。decision `D2E_INCOMPLETE` |
| B0 | unmeasured | **no** | B0 parityは `not_checked`、ADMの `target_regressed_R` と差分は `null`（理由を記録）。他は続ける。decision `D2E_INCOMPLETE` |
| I0 | unmeasured | **no** | EXT全件 `not_executed`（`i0_unmeasured`）。CTX / DSC / ADMは続ける。decision `D2E_INCOMPLETE` |
| CTX-K2 | `context_ready` | yes | DSCへ |
| CTX-K2 | C1〜C4 / C6 / C7不成立、C5 `mismatched` | — | guardrail違反 / parity不一致（`D2E_INVALID`、runnerは中止） |
| CTX-K2 | unmeasured / `not_executed` | **no** | DSC全rung `not_executed`（`dependency_unmeasured`）、ADM / EXTは0件。decision `D2E_INCOMPLETE` |
| DSC | `context_drift`、R0-K2 / R0-split不成立、D-1違反 | — | guardrail違反（`D2E_INVALID`） |
| DSC | unmeasured | **no** | discovery終了。それより前にpoolしたCandidateのADM / EXTは実行し記録する（下限evidence）。decision `D2E_INCOMPLETE` |
| ADM | unmeasured | **no** | 当該Candidateはadmitted扱いにしない（`admission_unmeasured`）、そのEXTは `not_executed`（`dependency_unmeasured`）。decision `D2E_INCOMPLETE` |
| EXT | unmeasured | **no** | そのEXTのR5 / gate / 改善は未判定。後続EXTは続ける。decision `D2E_INCOMPLETE` |
| 任意 | `not_executed`（`discovery_envelope_reached` / `run_envelope_reached` / `rv_unmeasured` / `i0_unmeasured` / `dependency_unmeasured` / `aborted_after_invalid`） | **no** | 登録件数に必ず計上する |

- `plan_bound_truncated`（`termination.status === 'incomplete'`）と `planner_rerun_bound_reached` はbound-limitedとして一覧に残し、通常の非共存と区別する（measured、R5(5)偽）
- wall-clock timeout・OOM・Search extent bound・`ladder_exhausted` を、Candidate不存在・非共存・extent不足・改善不能の証明として扱わない（G6 / G7 / G34 / G43）
- unmeasuredかどうかは、runnerが記録したprocess outcomeとnot_executed記録だけで決まる。証拠の欠損・破損は `D2E_INVALID`（`evidence_integrity`、§10.5）

### 8.3 budget（それぞれ独立。Production boundへ流用・合算しない、G5）

| budget | 値 |
| --- | --- |
| context | 1（support / context = 2） |
| CTX child | 1 |
| DSC unit（Search unit） | 3以下 |
| unique Candidate | 2以下 |
| unitあたりdelivery | 9以下（§4.6） |
| RV | 1 child（評価に数えない） |
| B0 | 1 |
| I0 | 1 |
| ADM | 2以下 |
| EXT | 2以下 |
| 評価リクエスト合計 | B0 1 + I0 1 + ADM ≤ 2 + EXT ≤ 2 = **6以下** |
| child process合計 | RV 1 + CTX 1 + DSC ≤ 3 + 評価 ≤ 6 = **11以下** |
| 評価ごとのfull Planner起動上限 | 8（runtime-unsupported retryを含む。評価ごとに新規。総数は最大48、見込みは評価数と同じ6以下） |
| `researchMaxPlanSteps` | 20000 |

### 8.4 execution envelope

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| RVのwall上限 | 10分 | D2-DのRV（12 Candidate）は17.4 s |
| CTX-K2のwall上限 | 10分 | D2-CのCTXは6.9〜7.0 s（Search・full runなし） |
| DSC unitのwall上限 | 60分（全rung共通。超過はtimeout = unmeasured） | Phase B / D2 / D2-Cと同じ。t03 K1 L2は487 / 693 s。K2は未計測 |
| 評価のwall上限 | 30分（preflight、full run、retry、Trace Replayを含むchild全体） | D1-A / D2-A / D2-C-A / D2-D-Aと同じ。D2-Dの評価は最大16.4 s |
| discovery envelope | run開始から **4時間**。経過後は新しいCTX / DSC childを起動せず、未起動のunitを `not_executed`（`discovery_envelope_reached`）とする（実行中のchildは各上限まで待つ） | 登録上の最悪（RV 10分 + B0 / I0 60分 + CTX 10分 + L0 / L1 120分でL2開始は3時間20分）でも到達しない安全上限 |
| run envelope | run開始から **7時間**。到達後は新しいchildを起動せず、未起動のunit / 評価を `not_executed`（`run_envelope_reached`）とする | 登録上の最悪（上記 + L2 60分 + ADM / EXT 4 × 30分 = 6時間20分）でも到達しない安全上限 |
| child heap上限 | 12,288 MB（`--max-old-space-size`） | Phase B / D1 / D2 / D2-C / D2-Dと同じ。t03 K1 L2のheap peak最大6,898,512,160 bytes。K2で超えた場合はOOM = unmeasuredで、上限を事後に上げない |
| concurrency | 1 | 既存と同じ |
| retry / fallback | なし / なし（timeout・OOM・failureでも条件を変えて再実行しない） | G6 |
| child process | RV / CTX / DSC unit・評価ごとに新しいchild。Node yieldは `setImmediate`、memory sample間隔250 ms | 既存と同じ |

見積もり（事前登録値ではない。成功条件にしない）: RV 約0.3分、B0 / I0 約0.5分、CTX 約0.2分、DSC L0 / L1 約1〜3分、DSC L2 約8〜12分（K1並み）〜60分上限、
ADM / EXT 約1分。合計 約12〜20分（L2がK1並みの場合）。

上限の構造: Search unitは3、評価は6、child processは11が上限である。**探索・評価を際限なく続ける規則は無い**。envelopeに達した場合は `not_executed` を記録して
`D2E_INCOMPLETE`（下限evidence）とし、確認できなかった部分をCandidate不存在・非共存・改善不能の証明として扱わない。

### 8.5 途中失敗の扱い

| 状況 | 扱い |
| --- | --- |
| Vの失敗 | childを起動せず終了。`D2E_INVALID`（`input_evidence`） |
| RV1〜RV6不成立、B0 / I0のparity不一致（runnerが登録値と照合）、CTX-K2のC1〜C7不成立（C5 mismatchedを含む）、`context_drift`、R0-K2 / R0-split不成立、D-1違反、G1違反、S4〜S6不成立、評価child内のRV1′ / RV2′不成立、replacement不変条件違反 | runnerは直ちに中止し、残りを `not_executed`（`aborted_after_invalid`）として記録。`D2E_INVALID` |
| RVのunmeasured | 以降を `not_executed`（`rv_unmeasured`）。`D2E_INCOMPLETE` |
| B0のunmeasured | 他は続ける。`D2E_INCOMPLETE` |
| I0のunmeasured | EXTを `not_executed`（`i0_unmeasured`）、CTX / DSC / ADMは続ける。`D2E_INCOMPLETE` |
| CTX-K2 / DSC / ADM / EXTのunmeasured | §8.2のとおり。`D2E_INCOMPLETE` |
| analyzerだけが検出する不一致（決定性、証拠整合） | runnerは中止しない。analyzerが `D2E_INVALID` |

## 9. 事前登録条件: parity・決定性

parity状態はD2-C-A §9 / D2-D-A §8と同じ4状態（`matched` / `mismatched` / `not_checked` / `not_applicable`）で、比較可能な結果の定義も同じである。
`mismatched` は `D2E_INVALID`、`not_checked` は `D2E_INCOMPLETE` に含まれる。analyzerはrecordから独立に再計算し、runner / childの自己申告をそのまま使わない。
`inputDigest` / `resultDigest` はD1-A §9.4と同じ定義・同じ関数（`d1InputDigest()` / `d1ResultDigest()`）で計算する。

| 検査 | kind | 比較対象・期待値 | `mismatched` | `not_checked` | category |
| --- | --- | --- | --- | --- | --- |
| B0 | `baseline` | D2-D RESULT `evaluations[B0]`（= D2 / D2-C B0）: `inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`、`evaluated`、`exhausted`、20 / 43、Conflict 21、steps 1465。Phase 2-C2 RESULT `baseline.summary` とも一致 | 比較可能な結果が異なる（`calculation_error` を含む） | B0が未計測 | `baseline_parity_mismatch` |
| I0 | `d2d_best` | §6.1の期待値（D2-D `PAIR-t05c1-t07c3`） | いずれかが異なる（`preflight_refused`、`planner_rerun_bound_reached`、`calculation_error` を含む） | I0が未計測 | `d2d_parity` |
| I0の入力 | `registered_input` | `inputDigest = fnv1a32:6493291d`（評価childが記録した値と、Vで§1.2の登録値から再計算した値） | 異なる | I0が未計測 | `guardrail` |
| K1 support context | `k1_context` | RV6 / S5: 各supportのK1 CTX recordの `reservationDigest` / `reservationBody` と導出値 | digestまたはbodyが異なる | RVが未計測 | `k1_context_parity` |
| K2 context | `k2_context_registered` | §4.1 C5（§3.3の登録digest・body） | digestまたはbodyが異なる | CTX-K2が未計測 | `k2_context_parity` |
| Phase B prefix | — | Phase BはK ≤ 1だけで、K2 contextの対応unitが無い | — | — | `not_applicable` |
| D2-E内 | `determinism_d2e` | `inputDigest` が同じD2-E評価の組（登録上は存在しない。存在すれば不変条件違反として記録する） | 比較可能な結果のstatus・`resultDigest` が異なる | 比較可能な結果が1件以下で残りが未計測 | `determinism` |
| 既存Researchとの照合 | `determinism_prior` | D2-E評価の `inputDigest` がD2-D RESULT（8件）・D2-C RESULT（26件）・D2 RESULT（86件）の評価のいずれかと一致するもの。登録上はB0（D2 / D2-C / D2-D B0）とI0（D2-D `PAIR-t05c1-t07c3`）だけ。ADM / EXTは新しいG storeを含むので一致しない見込み（analyzerは検査する） | D2-E評価が比較可能な結果を持ち、既存の記録とstatus・`resultDigest` が異なる | D2-E評価が未計測 | `determinism` |

- 既存RESULTの記録はparityの期待値としてだけ使い、R5・受理・decisionへ流用しない
- 1件でも `mismatched` があれば、他に `not_checked` があっても `D2E_INVALID` である

## 10. 事前登録条件: formal validity・provenance（いずれか違反なら `D2E_INVALID`）

### 10.1 入力（V、analyzerも独立に再検証）

D2-Eが読む入力は次に限る。いずれもRepositoryへ追加しない（committed済みを除く）。`.local` 配下のpathはRepository rootからの相対pathである。

| 入力 | 場所 | bytes | SHA-256 | 読み取り範囲 |
| --- | --- | ---: | --- | --- |
| Export（commitしない） | 外部path（引数）`gogma-artian-planner-backup_20260927015837.json` | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | PlannerInput構築、support Entry body |
| D2-D formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2D_RESULT.json` | 402,549 | `5a27030d7be3fd4650eb0094cc2227759a3b0656a096ac09291e5807298fa4b0` | allowlist（下記） |
| D2-C formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2C_RESULT.json` | 1,541,755 | `99860c42e195de7544f5fa6b7032ad68e91950e107003cd2ed03efc86e9fcc68` | allowlist（下記） |
| D2 formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2_RESULT.json` | 4,122,806 | `ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c` | allowlist（下記） |
| Phase 2-C2 RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` | 1,195,107 | `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4` | `baseline.summary` だけ |
| incumbent G store 9件 | §1.2の9 file | §1.2 | §1.2（D2-D RESULT `conditions` / `derivedPairs`、D2 / D2-C RESULTの `sources` とも一致） | body全体（評価入力） |
| K1 CTX record 6件 | `.local/d2c-k1-formal.run/CTX-{1,3,4,5,6,7}.context.json` | §1.4 / §1.6 | §1.4 / §1.6（D2-C RESULT `contexts[].record` とも一致） | `result.{contextId, supportBuildListEntryId, supportBodySha256, reservationBody, reservationDigest, originDigest, excludedRouteKeys, excludedRouteKeySha256s, status}` だけ |
| D2-D start attestation・raw | `.local/d2d-pair-formal.run/start-attestation.json`、`.local/PLANNER_GLOBAL_D2D_PAIR_RAW.json.local` | 24,839 / 36,344 | `15090ba2…7985` / `45be5525…f2c3` | hash照合だけ |
| D2-C start attestation・raw | `.local/d2c-k1-formal.run/start-attestation.json`、`.local/PLANNER_GLOBAL_D2C_K1_RAW.json.local` | 27,674 / 136,356 | `a3998ab6…5970` / `a0e10689…8601` | hash照合だけ |
| D2-D-A / D2-D-B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md` / `…_D2DB.md` | 90,841 / 15,120 | `bafcb2d4e39e801afa2a28dbb9902ec3285cced625d865859a48d024c5c60c17` / `ea29814003717afaf737486cafee9d6a19437954a2e210c3fc49a2916933472e` | hash照合だけ |
| D2-C-A / D2-C-B / D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B文書 | D2-D RESULT `sources.documents` と同じ | — | 同左 | hash照合だけ（内容を判断入力にしない） |
| 本書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md` | — | D2-E-Bのmeasurement HEADでgit objectから計算し、start attestationへ記録する | — |

**D2-D RESULTの読み取りallowlist**:

- `sources`（`specDocument` / `d2c.*` / `d2.*` / `phase2c2Result` / `export` / `documents` / `d2d.{raw, runDir, attestation}`）
- `provenance.{formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, registeredPolicySha256, calculationCodeChangedSinceMeasuredHead,
  productionChangedFiles, startAttestation.{sha256, verified}, oracleReadByRunner, oracleReadByChild, oracleReadByAnalyzer, oracleGuidedTargetPopulation}`、`invalidReasons`
- `decision.{case, bestEligiblePair, bestImprovedPair}`、`aggregates.evaluations.{unmeasuredByReason, notExecutedByReason}`、`pairs.ranking`
- `inputValidation.derivedPairs[evaluationId = decision.bestImprovedPair].{pairOrdinal, evaluationId, t05Ordinal, t07Ordinal, generatedBuildListEntryIds, generatedEntrySha256s, requiresSupport, inputDigest}`
- `conditions.{fixedCandidates[], t05Candidates[ordinal = 当該PAIRのt05Ordinal], t07Candidates[ordinal = 当該PAIRのt07Ordinal]}.{label, ordinal, origin, contextId, targetWeaponId,
  currentBuildListEntryId, generatedBuildListEntryId, generatedEntry, requiresSupport, searchIdentity, keySha256}`
- `rv.{status, satisfied}`
- `evaluations[evaluationId ∈ {B0, I0, decision.bestImprovedPair}].{evaluationId, stage, status, inputDigest, resultDigest, generatedEntryIds, generatedEntrySha256s, requiresSupport,
  plan.{termination, steps, selectedBuildListEntryIds}, conflicts（件数）, resourceConflictRejections, r5.{satisfied, failureReasons}, r6.satisfied, selectedTargetWeaponIds,
  supportChecksByEntry[s].{selected, supportExpiryCause}}`
- `evaluations[].{evaluationId, status, inputDigest, resultDigest}`（`determinism_prior` だけ）

**D2-C RESULTの読み取りallowlist**:

- `sources`、`provenance.{formal, measuredHead, analysisHead, runStatus, calculationCodeChangedSinceMeasuredHead, productionChangedFiles, startAttestation.{sha256, verified}}`、
  `invalidReasons`、`decision.case`、`aggregates.evaluations.{unmeasuredByReason, notExecutedByReason}`
- `composition.main.steps[].{label, stepOutcome}`
- `contexts[].{contextId, k, label, targetWeaponId, currentBuildListEntryId, supportBuildListEntryId, supportTargetWeaponId, record, supportBodySha256, reservationDigest,
  originDigest, excludedRouteKeySha256s, status}`
- `discovery.targets[label = t03].{label, targetWeaponId, currentBuildListEntryId, contextIds, pool[].{ordinal, contextId, keySha256, generatedBuildListEntryId, requiresSupport}}`
- `evaluations[stage ∈ {ADM, CMP} ∧ targetLabel ∈ D2C_NE].{evaluationId, stage, targetLabel, status, candidates[label = targetLabel].{label, selected, winnerBuildListEntryId,
  contextId, generatedBuildListEntryId}, r1r4.R1, r5.{satisfied, failureReasons}, conflicts[participants ∋ 当該Candidateの G].{kind, participants, resourceIdentity}}`
- `evaluations[].{evaluationId, status, inputDigest, resultDigest}`（`determinism_prior` だけ）

**D2 RESULTの読み取りallowlist**:

- `sources.export`、`provenance.{formal, measuredHead}`、`invalidReasons`、`decision.case`
- `discovery.targets[].{label, targetWeaponId, currentBuildListEntryId}`（E1 Target集合と `O_t`、11件）、`discovery.targets[label = t03].pool[].{ordinal, keySha256}`（D-4）
- `evaluations[].{evaluationId, status, inputDigest, resultDigest}`（`determinism_prior` だけ）

検証条件:

- D2-D RESULT: `provenance.formal === true`、`measuredHead === analysisHead === 38f4ed7bbfd7e994367856484817d115b9860ab8`、`runStatus === 'completed'`、
  `calculationCodeChangedSinceMeasuredHead` が空、Production changed filesが空、`invalidReasons` が空、unmeasured / not_executedが0、`decision.case === 'D2D_EXCEEDS_D2C_FINAL'`、
  `bestImprovedPair === bestEligiblePair === 'PAIR-t05c1-t07c3'`、`startAttestation.verified === true`、`oracleReadBy* === false`、`rv.status === 'verified'`、
  当該PAIRの評価が§1.1の値（24 / 19 / 1465、`exhausted`、R5成立、`fnv1a32:6493291d` / `fnv1a32:57dbb4e5`）、`92d87b90` / `e396d352` がselected
- D2-C RESULT: D2-D-A §9.1の検証条件（`measuredHead === 627184363db50ef256f602014b457f05a227861c`、`decision.case === 'D2C_EXCEEDS_D2B_MAIN'` 等）に加え、§3.1の導出が§3.2と一致
- D2 RESULT: `provenance.formal === true`、`measuredHead === 6f66c168e9163dab02bb60b2f1dc5b1cfc531e71`、`invalidReasons` が空、`decision.case === 'D2A_EXCEEDS_D1_INCUMBENT'`、
  `discovery.targets` が11件
- §6.1のI0集合をD2-D RESULTから導出した結果が§1.2と一致し、`d1InputDigest()` で再計算した `inputDigest` が `fnv1a32:6493291d` であること
- 同じsupportのK1 CTX record同士の `reservationDigest` / `supportBodySha256` / `reservationBody`（`stableStringify()`）が一致すること

**入力検証の失敗は黙って代替しない**。ファイル不足、SHA-256 / bytes不一致、record間の不整合、§3.1の導出不一致があれば、別ファイル・再計算値・近い値で代替せず、
runnerはchildを1つも起動せずに終了し、analyzerは `D2E_INVALID`（reason category `input_evidence`）を出す。

### 10.2 measurement HEAD・provenance

D2-C-A §10.2 / D2-D-A §9.2をそのまま適用する（読み替え: 本書、§10.1の入力、登録policy = §12の `conditions` に入る登録条件（K2 context表、導出規則、
登録reservation、ladder、`K2_POOL_CAP`、重複排除規則、手順・gate・選択順・budget・envelope・decision rule）を `stableStringify()` したもののSHA-256、
calculation code digest = D2-E benchmark codeと推移的にimportするResearch計算moduleのSHA-256）。

- D2-E-Bのrunner / child / analyzer / test / 本書を含むmeasurement HEADを正式計測前にcommitし、Working Tree cleanの状態で計測する
- runnerはchild起動前にstart attestation（`wx`、read-only）を書く。記録するもの: 本書のSHA-256（measurement HEADのgit object）、§10.1の全digest、登録policy SHA-256、
  calculation code digest、uncommitted false、Production audit（D2-E-B開始時のbase main以降のProduction changed files `[]`）、`appliedExecutionEnvelope`、
  CalculationContext、`PRODUCTION_RNG_ENGINE_VERSION`、Vで観測した§10.1の入力digest
- analyzerはattestationをmeasurement HEADのgit objectと照合し、measurement HEADがanalysis HEADのancestorであること、measurement HEAD以降の計算コード変更が `[]`、
  Production source changed files（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）が `[]` であることを確認する
- **計算コード変更後の結果流用禁止**: measurement HEAD以降に計算コードが変わった場合、そのrunを正式結果として使わない。再計測は新しいmeasurement HEADで最初から
  （V → RV → B0 → I0 → CTX → DSC → ADM → EXT）やり直し、部分的なrecordの再利用・merge・継ぎ足しをしない。**異なるmeasurement HEADのrecordを混在させない**
- raw / journal / record / RESULTの整合: runnerは全child recordのbytes・SHA-256をjournal（`rv.jsonl` / `contexts.jsonl` / `discovery.jsonl` / `evaluations.jsonl`）へ追記し、
  rawとRESULTの `sources.d2e` はそれと一致しなければならない（D2-A §8.4）
- 正式計測後に本書の意味論（context、reservation、ladder、規則、上限、decision）を変更しない。変更が必要になった場合は、本書の改訂を記録し、改訂後の新しいmeasurement HEADから
  全段階を再計測する。旧runのevidenceは監査用に保持し、正式evidenceとして採用しない
- CalculationContextが `{ 'unknown-initial', 4, 'production-rng:c5-e7', 17 }`、`PRODUCTION_RNG_ENGINE_VERSION === 'production-rng:c5-e7'` であること。D2-E-B開始時点で
  これらが動いていた場合は、D2-Eを実行せず本書の再登録を先に行う
- smoke（非formal確認）はformal run dirと別に行い、formal evidenceにしない。smokeの結果で条件を変えない

### 10.3 guardrail検査・oracle isolation

- G1: すべての評価runで `conflictResolutions` 0件、preflightのfixed constraint 0件。support Entryを含め、resolution / scenario resolution / repair lineage /
  `selectedBuildListEntryId` を作らない（testでも確認）
- **oracle isolation**: runner / child / analyzerは、oracle module（`plannerGlobalOracle1657*`）、Phase B analysis module（`plannerGlobalPhase2C27BAnalysis*`）、
  population-authority module（`plannerGlobalPhase2C27BTargets*`）、`*Interpretation*` / `*FormalValidation*` / `*LowerBound*`、Phase 2-C2.5-D2-D（`plannerGlobalPhase2C25D2D*`）、
  **Phase 2-C2.5-D2-E（`plannerGlobalPhase2C25D2E*`）** を推移的にimportしない（testでimport closureを検査）。oracle RESULT・oracle manifest・population manifest
  （`.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local`）を読まない。D2 / D2-C / D2-D RESULTはallowlistのfieldだけを読む
- populationがoracle-informedであったprovenanceは隠さず、RESULTの `provenance.oracleGuidedTargetPopulation = true` として記録する
- D2-E-B sourceにTarget ID / Entry ID / stable keyを書かない（testで検査）。§10.1のfile名・SHA-256、§3.3 / §6.1 / §9の登録digest・登録reservation bodyは登録値として置いてよい。
  K2 context表（Target ID・support Entry ID）とI0集合は§3.1 / §6.1の導出をVで再実行して得て、§3.2 / §1.2の登録値は照合にだけ使う
- 登録された順序（§8.1）・規則（§4〜§6）以外のunit / 評価が無い（retry、再実行、追加評価、順序違反、件数違反なし）。child process数 = 実行したRV + CTX + DSC + 評価の数
- discovery / ADM / EXTのreplay: analyzerは記録済みの結果から§4.4のrung進行・pool構成・重複排除、§5のadmission、§6のR5・gate・improved・選択順を再実行し、記録と一致することを確認する
- C1〜C7・context drift・R0-K2 / R0-split・S1〜S6・RV1〜RV6の再照合。analyzerもCTX recordの `reservationBody` をJSONオブジェクトとして読み、比較は両辺オブジェクトの
  `stableStringify()` 一致、digestとの比較は文字列一致で行う
- Phase B / D1 / D2 / D2-C / D2-Dのmoduleとformal RESULT・record・G store・CTX recordを変更しない（D2-E-Bは新しいmoduleからimportして使う。既存testの「他moduleからの
  importを禁止する」検査に登録上の後継D2-Eを許可対象として加える場合は、検査の厳しさを他moduleについて変えない）

### 10.4 run dir・file名

| 用途 | 名前（推奨。D2-E-Bで変えてよいが、既存名と衝突させない） |
| --- | --- |
| formal run dir | `.local/d2e-k2-formal.run/` |
| raw | `.local/PLANNER_GLOBAL_D2E_K2_RAW.json.local` |
| smoke | `.local/d2e-k2-smoke/` |
| RESULT（committed） | `docs/PLANNER_GLOBAL_D2E_RESULT.json` |
| RV record | `<run dir>/RV.record.json` |
| CTX record | `<run dir>/CTX-K2.context.json` |
| DSC record | `<run dir>/DSC-K2-<rung>.record.json` |
| G store | `<run dir>/K2-t03-92d87b90-e396d352-c<context内index>.generated-entry.json` |
| 評価record | `<run dir>/<評価ID>.record.json` |
| module（推奨） | `src/benchmarks/plannerGlobalD2E.ts` / `plannerGlobalD2EAnalysis.ts` / `plannerGlobalD2E.test.ts`、`scripts/run-planner-global-d2e.mjs` / `scripts/analyze-planner-global-d2e.mjs` |

既存の `PLANNER_GLOBAL_PHASE2C25D2E_*`（`docs/` と `.local/`）、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2E.md`、`plannerGlobalPhase2C25D2E*`、
`scripts/analyze-planner-global-phase2c25d2e.mjs` はPhase 2-C2.5-D2-Eの成果物であり、D2-Eとは無関係である。読まない、再利用しない、変更しない。
D2-Eのmodule参照検査は、`D2E` という部分文字列ではなく正確なpathで行う（Phase 2-C2.5-D2-Eのpathにも `D2E` が含まれるため）。
D2-B / D2-C / D2-Dのrun dirは読み取り専用で、D2-Eのfileを書き込まない。

### 10.5 証拠の欠損・破損

D2-A §8.4（raw / RESULT整合）・§8.5（未計測と証拠の欠損・破損の区別）をそのまま適用する。RV record、CTX record、DSC record、評価record、G store、入力のK1 CTX recordの
いずれかが、process outcome completedなのに存在しない、SHA-256 / bytesがjournal・raw・RESULTの `sources` と一致しない、必須fieldが欠ける、CTX recordの
`reservationBody` がJSONオブジェクトでない場合は `D2E_INVALID`（`evidence_integrity`）であり、未計測に読み替えない。

## 11. 事前登録条件: decision（上から順に判定）

### 11.1 比較基準（固定）

| 基準 | completed / 43 | Conflict | steps | 出典 |
| --- | ---: | ---: | ---: | --- |
| baseline（B0） | 20 | 21 | 1465 | D2-D RESULT `B0`（D2-EのB0もparityで一致を要求） |
| D2-C最終 | 23 | 20 | 1465 | D2-D RESULT `I0`（読み取り専用の参照値。D2-Eでは評価しない） |
| **D2-D最良（I0）** | **24** | **19** | **1465** | D2-D RESULT `PAIR-t05c1-t07c3`（D2-EのI0もparityで一致を要求し、gate・比較にはI0の実行結果を使う） |

### 11.2 decision（`decision.case`）

| decision | 条件 |
| --- | --- |
| `D2E_INVALID` | §4 / §7 / §9 / §10のformal validityに1件でも違反。parity `mismatched` を含む。reason category: `input_evidence` / `provenance` / `baseline_parity_mismatch` / `d2d_parity` / `k1_context_parity` / `k2_context_parity` / `guardrail` / `determinism` / `evidence_integrity` / `raw_result_mismatch` |
| `D2E_INCOMPLETE` | invalid 0、かつ登録・policy-requiredなRV / B0 / I0 / CTX / DSC / ADM / EXTのいずれかがunmeasuredまたは `not_executed`。parity `not_checked` はこの未計測が原因なのでここに含まれる |
| `D2E_GLOBAL_COMPLETE_R` | invalid 0、unmeasured 0、いずれかのEXTがR6を満たす |
| `D2E_EXCEEDS_D2D_BEST` | 上記以外で、improvedなEXT（§6.5）が1件以上ある |
| `D2E_SET_COEXISTENT_NOT_BETTER` | 上記以外で、R5成立のEXTが1件以上ある（gate不成立、またはcompleted 24でConflict ≥ 19） |
| `D2E_NO_SET_COEXISTENCE` | 上記以外で、EXTが1件以上measuredで、すべてR5不成立 |
| `D2E_NO_ADMITTED_K2_CANDIDATE` | invalid 0、unmeasured 0、poolが1件以上で、ADMがすべてmeasuredでR1不成立（EXTは0件） |
| `D2E_NO_K2_CANDIDATE` | invalid 0、unmeasured 0、discoveryが `ladder_exhausted` または `discovery_exhausted` で終わり、poolが0件 |

- 改善 / 改善なしの区分: `D2E_GLOBAL_COMPLETE_R` と `D2E_EXCEEDS_D2D_BEST` が「改善」、`D2E_SET_COEXISTENT_NOT_BETTER` / `D2E_NO_SET_COEXISTENCE` /
  `D2E_NO_ADMITTED_K2_CANDIDATE` / `D2E_NO_K2_CANDIDATE` が「D2-D最良からの改善なし」である。判定順は INVALID → INCOMPLETE → 改善 → 改善なし で変えない
- decisionには修飾fieldを必ず付ける: `bestEligibleExtension`、`bestImprovedExtension`、`improvementKind`、`discoveryOutcome`（`cap_reached` / `ladder_exhausted` /
  `discovery_exhausted` / `unmeasured`）、`pooledCandidates`、`admittedCandidates`、`r5SatisfiedExtensions[]`、`eligibleExtensions[]`、`improvedExtensions[]`、
  `r5OnlyEligibleExtensions[]`、`equalMetricsExtensions[]`、`conflictIncreasedExtensions[]`、`t03SelectedExtensions[]`、`t03CompletedWithoutNetGainExtensions[]`、
  `incumbentRegressedExtensions[]`（incumbentの `G` のいずれかが非selected）、`boundLimitedEvaluations[]`、`unmeasuredEvaluations[]`、
  `vsBaseline` / `vsD2cFinal` / `vsD2dBest`（best EXTまたはI0のcompleted / Conflict / stepsの差）
- **K2 Candidateのdiscovery、t03自身のselected、置換集合の共存（R5）、全体指標の改善（improved）、R6は別fieldに記録し、一方から他方を推論しない**
- `D2E_INCOMPLETE` でも、measuredだった結果（pool、R1、R5 / improved / R6到達の有無）を **下限のevidence** として記録する
  （`globalCompleteObservedUnderIncomplete`、`exceedsD2dObservedUnderIncomplete`、`setCoexistenceObservedUnderIncomplete`、`k2CandidateObservedUnderIncomplete`）
- 通常の非共存・不受理（`evaluated` でR5不成立、gate不成立、R1不成立、`preflight_refused`、bound-limited、support失効・非selected、Search extent bound / ladder exhausted）は
  measuredであり、INVALIDにもINCOMPLETEにもしない
- 正常に計測された結果の不一致は `D2E_INVALID`、測定できなかったための未確認は `D2E_INCOMPLETE` であり、未確認を不一致にも一致にも読み替えない

## 12. 事前登録条件: RESULT schema（D2-E-Bで固定する必須field）

D2-E-Bのanalyzerは `docs/PLANNER_GLOBAL_D2E_RESULT.json`（committed）を出力する。raw（`.local`、commitしない）とrun dir（RV / CTX / DSC / 評価record、G store、
start attestation）はRepositoryへ追加しない。次のfieldは必須で、意味を変えない（追加fieldは可）。

```text
phase                      "Issue #154 D2-E: t03 two-support K2 context discovery and extension of the D2-D best incumbent (post-hoc analysis)"
analyzedAt
sources
  specDocument             { file, sha256 }                        本書（measurement HEADのgit object）
  d2d                      { result, attestation, raw, documents { d2dA, d2dB } }                         各 { file, bytes, sha256 }
  d2c                      { result, attestation, raw, contextRecordsUsed[6] }                            各 { file, bytes, sha256 }
  d2                       { result }                                                                     { file, bytes, sha256 }
  incumbentGeneratedEntries[9]                                                                            各 { file, bytes, sha256 }
  phase2c2Result           { file, sha256 }
  export                   { file, bytes, sha256, committed: false }
  documents                D2-C-A / D2-C-B / D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B { file, sha256 }
  d2e                      { raw, runDir, attestation, rvRecord, contextRecord, discoveryRecords[], generatedEntries[], records[] } 各 { file, bytes, sha256 }
provenance
  formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256（calculation code digest）, registeredPolicySha256,
  calculationCodeChangedSinceMeasuredHead: [], productionChangedFiles { toMeasuredHead: [], toAnalysisHead: [] },
  startAttestation { sha256, verified, issues, body },
  d2dMeasuredHead, d2cMeasuredHead, d2MeasuredHead,
  oracleReadByRunner: false, oracleReadByChild: false, oracleReadByAnalyzer: false, populationManifestRead: false,
  d2dResultFieldsRead: [allowlist], d2cResultFieldsRead: [allowlist], d2ResultFieldsRead: [allowlist], contextRecordFieldsRead,
  d2dResultModified: false, d2cResultModified: false, d2ResultModified: false, priorEvidenceReusedAsResult: false,
  oracleGuidedTargetPopulation: true, newSearchInD2E: true, searchScope: 't03 K2 context only', newAdmissionInD2E: true,
  k2ReservationDerivedFromSupportBodies: true, k1ReservationUnionUsedAsSemantics: false,
  speculativeSupportWrittenAsResolution: false, alternativeToAlternativeSupport: false, productionSemanticsChanged: false
environment                runtime, node, v8, platform, cpu, logicalCpuCount, totalMemoryBytes, rngEngineVersion, calculationContext, appliedExecutionEnvelope, machine
conditions                 k2Context（§3.2）, derivationRule（§3.1）, registeredReservation（§3.3）, ladder（§4.5）, k2PoolCap: 2, dedupRules（§4.3）, deliveryCapPerUnit: 9,
                           incumbent（§1.2）, order（§8.1）, i0Rule（§6.1）, admissionRule（§5）, extensionRule（§6.2）, r5Definition（§6.3）, extensionDiagnostics（§6.4）,
                           gate / betterRule / improvedRule / selectionOrder（§6.5）, r6Definition（§6.6）, rvChecks（RV1〜RV6）, contextChecks（C1〜C7）, supportChecks（S1〜S6）,
                           supportExpiryCauses, budgets（§8.3）, executionEnvelope（§8.4）, researchMaxPlanSteps, evaluationFullRunCap: 8, decisionRule（§11、文字列配列）,
                           comparisonBaselines（§11.1）, notRun
inputValidation            { passed, issues[], derivedK2Contexts[] { targetWeaponId, currentBuildListEntryId, supportBuildListEntryIds[], admObserved, cmpObserved, crossSupportLossAll },
                             derivedI0 { generatedBuildListEntryIds[], generatedEntrySha256s[], requiresSupport[], inputDigest } }
rv                         { status, unmeasuredReason, process, record { file, bytes, sha256 },
                             candidates[9] { label, ordinal, origin: d2b_k0 | d2c_k1, contextId | null, generatedBuildListEntryId, generatedEntry { file, bytes, sha256 },
                                             RV1 {…}, RV2 { status, replacedBuildListEntryId }, RV3 { reservationSource: k0_empty | ctx_record, reservationDigest, matched },
                                             RV4 { respects, blockedHits, exclusiveHit }, satisfied },
                             supports[3] { supportBuildListEntryId, contextRecords[], RV5 { expected, observed, matched }, RV6 { digestExpected, digestObserved, digestMatched, bodyMatched, satisfied } },
                             satisfied }
context                    { contextId, status, unmeasuredReason, process, record { file, bytes, sha256 }, targetWeaponId, currentBuildListEntryId, supportBuildListEntryIds[],
                             supportBodySha256s, reservationBody, reservationDigest, originDigest, excludedRouteKeySha256s, conflictContextCount,
                             checks { C1, C2, C3, C4, C5 { state, expectedDigest, observedDigest, bodyMatched }, C6 { satisfied, perSupport[] }, C7 },
                             diagnostics { equalsK1ComponentwiseUnion } }
discovery
  units[]                  { unitId, rung, extent, status, unmeasuredReason, notExecutedReason, process, searchIdentity, reservationDigest, summary,
                             deliveries[] { keySha256, cost, action, r0K2, r0Split { [s]: boolean }, matchedD2bOrdinal | null, matchedD2cK1 { ordinal, contextId } | null },
                             searchOnlyMs, materializeMs, wallMs, peakHeapBytes, peakRssBytes }
  pool[]                   { ordinal, unitId, rung, indexInUnit, candidateStableKey, keySha256, cost, routeKind, routeOperationCount, r0K2, r0Split, searchIdentity, reservationDigest,
                             contextRecordSha256, requiresSupport[], generatedBuildListEntryId, reusedExisting, generatedEntry { file, bytes, sha256 }, replacement }
  outcome                  cap_reached | ladder_exhausted | discovery_exhausted | unmeasured
evaluations[]              D1-A §8 / D2-C-A §12 / D2-D-A §11の `evaluations[]` の全fieldに加えて
                           { stage: B0 | I0 | ADM | EXT, ordinal, registeredInputDigest | null, inputDigestMatched | null,
                             rejectedBuildListEntries[] { buildListEntryId, reason }, resourceConflictRejections, selectedTargetWeaponIds[],
                             conflicts[] { id, kind, participants[], resourceIdentity, selectedBuildListEntryId, withinSet: boolean },
                             referenceDiff { referenceEvaluationId: 'I0', completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] } | null,
                             baselineDiff { completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] } | null,
                             r1r4 | null（ADMだけ）, r5 { judged, conditions, satisfied, failureReasons[] },
                             extension { t03 { generatedBuildListEntryId, selected, winnerBuildListEntryId, targetSelected }, t03Supports[], incumbentRetention, supportExpired,
                                         conflictsWithinSet[], conflictsWithT03G[], d2cT03ResourcesObserved[], t03Completion } | null（EXTだけ）,
                             gate { judged, referenceCompleted, proposedCompleted, satisfied }, r5OnlyEligible, eligible, improved, improvementKind, equalMetrics, conflictIncreased,
                             supportChecksByEntry { [s]: { contextId, S1, S2, S3, S4, S5 {…}, selected, supportExpiryCause | null } },
                             pairReservationCheck { S6 { digestExpected, digestObserved, digestMatched, bodyMatched, searchInputDigestMatched, satisfied } } | null,
                             r6 { judged, conditions, satisfied },
                             priorParity { state, matchedPriorEvaluationIds[], resultDigestsEqual, notChecked } }
parityChecks[]             { checkId, kind: baseline | d2d_best | registered_input | k1_context | k2_context_registered | determinism_d2e | determinism_prior,
                             state: matched | mismatched | not_checked | not_applicable, subjects[], expected, observed, mismatches[],
                             notChecked { dependsOn[] { id, status, unmeasuredReason, notExecutedReason } } | null, category }
extensions
  ranking[]                { ordinal, evaluationId, eligible, improved, improvementKind, completed, conflicts, steps, rank | null }
  bestEligibleExtension, bestImprovedExtension
comparison
  vsBaseline / vsD2cFinal / vsD2dBest   { subjectEvaluationId, completedDelta, conflictDelta, stepsDelta, better: boolean, equalMetrics: boolean }
  byExtension[]            { evaluationId, vsI0 { completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] }, t03Selected, t03TargetCompleted, r5Satisfied, improved }
aggregates
  evaluations              { registeredMax: 6, executed, measured, unmeasuredByReason, notExecutedByReason, byStage, byStatus }
  discovery                { registeredMaxUnits: 3, executedUnits, pooledCandidates, deliveriesByAction }
  childProcesses           { registeredMax: 11, started }
  fullPlannerRunsStarted   合計（評価リクエスト数とは別）
  runtimeUnsupportedRetries
  r1                       { judged, satisfied }
  r5                       { judged, satisfied }
  r6                       { judged, satisfied, satisfiedEvaluationIds[] }
  boundLimitedEvaluations[]
  supportOutcomes          { notSelected, expiredByCause }
  determinismCrossChecks[] { inputDigest, evaluationIds[], priorEvaluationIds[], comparableEvaluationIds[], state, resultDigestsEqual }
  parity                   { byKindAndState, mismatched[], notChecked[] }
  timing                   { rvWallMs, contextWallMs, discoveryWallMs, evaluationWallMs, runWallMs, discoveryEnvelopeReached, runEnvelopeReached }
  memory                   { peakHeapBytes, peakRssBytes }
invalidReasons[]           { category, detail }
decision                   { case, reasons[], lowerBound: boolean, …§11.2の修飾field }
```

## 13. 事前登録条件: 言えること・言えないこと

### 13.1 decisionごと

- `D2E_GLOBAL_COMPLETE_R`: このExport・登録K2 context・Research envelopeで、D2-D最良集合にt03 K2 Candidateを加えて、43 / 43、Conflict 0、`resource_conflict` 0、
  Trace Replay成功のPlanに到達した。Production runtimeとしての許容、別Export・別populationへの一般化、Production semanticsとしての妥当性（REQUIREMENTS 23の契約変更が先）は言えない
- `D2E_EXCEEDS_D2D_BEST`: t03 K2 Candidateの追加で、D2-D最良（24 / 19）より良い完成・Conflictの置換集合を得た。`improvementKind` が `conflict_decrease_only` なら、
  t03の完成による改善ではない。R6には達していない
- `D2E_SET_COEXISTENT_NOT_BETTER`: t03 K2 Candidateを含む置換集合はR5を満たしたが、全体のcompleted・ConflictはD2-D最良より良くならなかった（後退したか、同等だった）
- `D2E_NO_SET_COEXISTENCE`: **他のCandidate・別support・別extent・別の合成で解消できないことの証明ではない**。言えるのは「登録K2 contextのCandidate（高々2件）を
  D2-D最良へ1件ずつ加えた1 run評価では、置換集合としてR5を満たすものは無かった」ことだけである
- `D2E_NO_ADMITTED_K2_CANDIDATE`: K2 Candidateは得られたが、baseline上のR1を満たさなかった
- `D2E_NO_K2_CANDIDATE`: 登録ladder（L2まで）・`K2_POOL_CAP = 2` の範囲で、K2 contextのSearchはCandidateをdeliverしなかった。**Candidate不存在の証明ではない**（extent bound / ladder終端）
- `D2E_INCOMPLETE`: measuredな範囲の結果は下限であり、「unmeasuredが無ければ同じ結果だった」とは主張しない

### 13.2 共通

- K2 Candidateが得られても、selectedにならない・R5を満たさない・改善しない場合、**K2仮説が誤りだったとは結論づけない**。未評価のもの: 3件目以降のK2 Candidate、
  L2より広いextent、他のsupport（`54dd2b4e` 等のco-participant）、D2-Dの別PAIRや別の起点、t04 / t10の別axis、複数pass、3 Target以上の同時変更
- K2 Candidateがselectedになりt03が完成しても、別Targetを失ってcompletedが24のままなら「+1完成」とは言わない（`t03CompletedWithoutNetGain`）
- R5成立は、置換集合としての共存（全 `G` とその前提supportの同時selected、support依存の有効性、集合内Conflictなし）だけを示し、集合外Targetの完成やConflict 0を示さない。
  **R5成立をIssue #154の最終Acceptance（R6）と混同しない**
- I-D2E-1〜5（§1.10）は予想であり、結果がどうであっても一般化しない
- E1由来の対象Target（t03）はoracle-informedなpopulationの部分集合であり（`oracleGuidedTargetPopulation = true`）、別populationへの一般化は主張しない

## 14. 既存API（D2-E-Bで使う部品。Production変更なし）と新規に必要なResearch処理

### 14.1 再利用する既存部品

| 用途 | 既存の部品（module） |
| --- | --- |
| baseline PlannerInputとResearch依存（固定ID Factory、定数Clock） | `globalResearchInputFromExport(Export, 20000)` / `globalResearchDependencies(engine)`（`src/benchmarks/plannerGlobalOptimizationResearch.ts`） |
| K2 / K1 / K0 context（origin、reservation、`excludedRouteKeys`、`O_t`） | `phase2c27bResolveSupportContext(input, dependencies, targetWeaponId, supportBuildListEntryIds)`（`plannerGlobalPhase2C27B.ts`。support配列を受け取る既存API） |
| reservation（C3 / C6 / C7 / S5 / S6 / RV6） | `derivePlannerAlternativeReservation([...], engine)`（`src/domain/planner/alternative/plannerAlternativeReservation.ts`）、`createPlannerRouteUnitPlans()`、`collectReferencedOwnedWeaponIds()` |
| C4（origin digest、scheduleの `excludedRouteKeys`） | `derivePhase2C26B2C1Schedule()`（`plannerGlobalPhase2C26B2C1.ts`） |
| Search / materialization | `visitPlannerAlternativeCandidates()`、`createPlannerAlternativeMaterializer()`、`createPlannerAlternativeSearchIdentity()` |
| R0 | `summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`（`plannerGlobalPhase2C2.ts`） |
| 評価run（ADM / I0 / EXT / B0） | D2-Cの `runD2CEvaluation()`（ADMはD2-CのADMと同じ手順、I0 / EXTは `replacement_set` を1 runで評価し `found_R` 診断を持たない手順 = `d2cRunnerStage('I0') = 'Z0'`）。D2-Dの評価wrapper（`runD2DEvaluation()`）を参考にできる |
| digest・R5・R1・差分 | D1の `d1InputDigest()` / `d1ResultDigest()` / `judgeD1R5()` / `judgeD1R5Independently()` / `d1B0Parity()` / `d1TrialRunSummary()` / `d1RuntimeUnsupportedRemoved()` / `isD1BoundLimited()`、D2の `d2R1R4()` / `judgeD2R6()` |
| `found_R`（ADM診断） | `judgePlannerAlternativeTrial()` |
| support失効原因・CTX record読込 | `d2cSupportExpiryCause()`、`readD2CContextRecord()`（`reservationBody` がJSONオブジェクトであることの確認を含む） |
| replacement / Candidate identity | `resolveBuildListEntryReplacement()`、`candidateStableKey()` |
| provenance | `d2cProductionChangedFiles`（= `d2dProductionChangedFiles`）、start attestationの `wx` / read-only手順 |
| hash | `hashStableValue()`、`stableStringify()` |

### 14.2 D2-E-Bで新規に必要なResearch処理（D2-E moduleに置く）

| 処理 | 内容 |
| --- | --- |
| 登録条件・policy | §3.2 / §3.3の登録値（照合用）、§1.2 / §6.1の登録 `inputDigest`、ladder、`K2_POOL_CAP`、budget、envelope、decision rule、登録policy SHA-256 |
| V | D2-D / D2-C / D2 RESULTのallowlist projection、§3.1 / §6.1の導出、G store 9件・K1 CTX record 6件の照合、`inputDigest` 再計算 |
| RV unit | §7.1（incumbent 9件・support 3件） |
| CTX-K2 unit | §4.1のC1〜C7（D2-Cの `prepareD2CContextRecord()` はsupport 1件専用なので、support 2件のrecordを新規に作る。導出部品はD2-Cと同じ） |
| DSC unit | §4.2のconsumer（R0-K2 / R0-split、D-2 / D-4 / D-5、cap 2）、context drift、§4.4のrung進行 |
| 評価task構築 | ADM（`requiresSupport = S`、CTX-K2の値）、I0（§1.2の9件、各K1置換は自身のCTX record）、EXT（I0の9件 + K2 Candidate） |
| 評価child内の再確認 | full run前のRV1′ / RV2′、S6 |
| 判定 | §6.4のEXT診断、§6.5のgate・improved・`improvementKind`・選択順 |
| parity | `d2d_best`、`registered_input`、`k1_context`、`k2_context_registered`、`determinism_d2e` / `determinism_prior` |
| decision | §11.2（`D2E_*`） |
| runner / analyzer | `scripts/run-planner-global-d2e.mjs`（親 + `rv` / `context` / `discover` / `evaluate` child、journal、abort、4時間discovery envelope、7時間run envelope）、`scripts/analyze-planner-global-d2e.mjs` |

- D2-Cの `D2CEvaluationTask.stage` に `EXT` は無い。EXTをD2-C moduleへ追加せず、D2-E moduleで `I0` 相当の手順（`replacement_set`、`found_R` なし）としてtaskを組み立てるか、
  D2-E側で同じ手順のwrapperを持つ。RESULTの `stage` は `EXT` と記録する。D2 / D2-C / D2-D / D1 / Phase Bのmoduleは変更しない
- 既存部品で本書の規則を表現できないことが分かった場合は、別の判定を発明せず、本書の更新（docs）を先に行う

## 15. guardrail（D2-D-A G37〜G43に追加）

| ID | guardrail |
| --- | --- |
| G44 | D2-EのSearchはt03のK2 context 1件だけである。他のTarget・他のsupport集合・K3以上のcontextのSearchをしない。結果を見てcontext・support・extentを追加しない |
| G45 | K2 reservationはsupport 2件のExport Entry bodyから既存authority（`derivePlannerAlternativeReservation()`）で導出する。K1 reservationの文字列・配列レベルのunionをsemanticsとして使わない |
| G46 | K2 Candidateは、K2 reservationとsupport別のK1 reservationの両方についてR0を満たさなければpoolしない（不成立はguardrail違反）。K2であることを理由にR0 / R1 / R5を緩めない |
| G47 | 合成の起点はD2-D最良（PAIR-3）のfresh再評価（I0）だけであり、parityがmatchedでなければEXTを判定しない。D2-Dの過去RESULTをEXTのreferenceとして流用しない |
| G48 | EXTはincumbentへのt03 K2 Candidate 1件の追加だけである。incumbentの9件を置換・除外・再評価しない。EXTの結果を受けた追加の評価・合成をしない |
| G49 | discovery（K2 Candidateの有無）、t03自身のselected、R5、improved、R6を別々に記録し、互いに読み替えない。t03の完成を全体のcompleted増加と読み替えない |
| G50 | D2-Cのt03 K1 Candidate・D2-Bのt03 K0 CandidateをPAIR-3に対して再評価しない（D-4 / D-5は除外規則であり、評価の代わりではない） |
| G51 | timeout / OOM / `not_executed` / bound-limited / extent bound / ladder exhaustedを、Candidate不存在・非共存・改善不能の証明として扱わない |
| G52 | D2-EのmoduleとPhase 2-C2.5-D2-E（`plannerGlobalPhase2C25D2E*`）を相互にimportしない。成果物名・run dirを共有しない |

Issue #154はCloseしない。

## 16. 未決事項（D2-Eの外、またはD2-E-B以降）

D2-Eの判定に必要な意味論は本書で確定した。次はD2-Eの外の事項である。

1. D2-E-Bの実装名（module / script / field綴り）。§12の必須fieldの意味と§11の判定順序は変えない
2. t02の探索（L2より広いextent、別support、K2）
3. t05 / t07の3件目以降・別supportのCandidate、t04 / t10の同値置換を外す別axis
4. t03のK2 Candidateの3件目以降、L2より広いextent、co-participant（`54dd2b4e` 等）をsupportに含むcontext
5. D2-Eの結果を新しい起点にした後続合成（複数pass、合成順の変更、3 Target以上の局所再合成とその組み合わせ数の上限）
6. E2 9 Target全体のK2探索、residual 3、population拡大（baseline未完成23 Target、43全体）
7. Production化に伴うREQUIREMENTS 23の契約変更の要否（follow-up §10）

## 17. D2-C-A / D2-D-Aからの変更・追加点

| # | D2-C-A / D2-D-A | 本書で正式に採用する条件 | 理由 |
| --- | --- | --- | --- |
| 1 | K1 context（support 1件）7件 | **K2 context（support 2件）1件**（t03） | D2-Cで観測された相互support阻害（§1.5）を、両supportを同時に置いて測るため |
| 2 | context supportはprovisional winner由来（D2-C-A §3.1） | D2-Cの同一TargetのK1 contextのsupportの和（cross-support lossが全観測評価で成立したTargetだけ、§3.1） | 依頼の仮説をD2-C evidenceから機械導出するため |
| 3 | reservationはsupport 1件から導出 | support 2件のbodyから既存authorityで導出し、C5（登録値parity）・C6（K1包含）・C7（順序不変）を追加 | union semanticsを作らず、導出の正しさをfail-closedで確認するため |
| 4 | 登録reservation digestはPhase B record由来（D2-C-A §3.2） | 本書作成時の非formal導出値（§1.7）を登録し、formal authorityはD2-E-BのCTX record | K2はPhase Bで計測されていないため |
| 5 | 重複排除 D-1〜D-4 | D-5（D2-Cのt03 K1 pool）を追加。unitあたりdelivery 9 | K1で既に評価されたRouteを再評価しないため |
| 6 | 合成の起点: D2-B主軸（D2-C）/ D2-C最終（D2-D） | **D2-D最良PAIR-3**をI0としてfresh再評価 | 既存evidenceの最良集合からの改善を測るため（§2.5） |
| 7 | CMP（単一pass、複数Target）/ PAIR（2 Target同時変更） | **EXT**: admitted K2 Candidateを1件ずつincumbentへ追加（1 Target、単一段） | 対象がt03だけで、incumbentを変えずに追加効果を測るため |
| 8 | RV: 12 Candidate（D2-D） | incumbent 9件に限定 | 評価集合に入るCandidateだけを再検証するため |
| 9 | S1〜S5 | S6（K2 Candidateの2 support組のreservation一致）を追加 | 評価入力でもK2 reservationの前提が保たれていることを確認するため |
| 10 | E1外判定にpopulation manifestを読む（D2-C-A） | D2 RESULT `discovery.targets[]`（11件）から読み、manifestを読まない | population authorityを判断入力に持ち込まないため。populationのoracle-informed provenanceは記録する |
| 11 | decision `D2C_*` / `D2D_*` | `D2E_*`。`D2E_NO_ADMITTED_K2_CANDIDATE` / `D2E_NO_K2_CANDIDATE` を追加し、`improvementKind` と `t03CompletedWithoutNetGain` を記録 | discovery・admission・共存・改善を区別し、t03完成と全体改善を混同しないため |
| 12 | envelope: discovery 9時間 / run 12時間（D2-C）、run 4時間（D2-D） | discovery 4時間 / run 7時間 | Search unit 3・評価6で、登録上の最悪（6時間20分）でも到達しない安全上限にするため |

## 18. validation

- `git diff --check`
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無い。結果はPRに記載）
