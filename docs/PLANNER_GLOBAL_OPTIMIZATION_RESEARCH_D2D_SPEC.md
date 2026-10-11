# Global Planner Research D2-D（既存Candidateによるt05 / t07局所再合成の事前登録）

Refs #154。**docs-only**。基準main: PR #228 merged `66e334183c01f50a802e5986cbfb00d264661b04`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなし、worktreeは1件だけ、実行中のResearch process（node）なし、D2-B / D2-Cのformal evidence（`.local/d2-formal2.run/`、
`.local/d2c-k1-formal.run/`、raw）のbytes・SHA-256が正式RESULTの `sources` と一致することを確認）。

本書は [D2-C-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2CB.md) §5で「受理済みTargetの再評価・合成順の変更は登録外」とした事項のうち、
**t05のK1 Candidateと受理済みt07の衝突を、t07を同じTargetの別の既存K0 Candidateへ置き換えて解消できるか** だけを、
実装・計測より前に確定する事前登録である。本書ではResearch項目名を **D2-D**、本書による事前登録を **D2-D-A**、実装と正式計測を **D2-D-B** と呼ぶ。
Phase 2-C2.5-D2-D（`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2D.md`、`PLANNER_GLOBAL_PHASE2C25D2D_*`、`plannerGlobalPhase2C25D2D*`）とは
別のResearch項目であり、名称・file・run dirを混同しない（§9.4）。

本PRで変更していないもの: Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default / bounds、
既存formal RESULT（Phase B / D1 / D2 / D2-Cを含む）、既存Research文書（Research索引へのリンク追加を除く）、既存Research runner / analyzer / module、
正式仕様の意味論。新規Search run、Candidate delivery、reservation導出、full Planner run、formal measurement、RESULT JSON生成、oracle読み取りは行っていない。
§1の値は、既存committed RESULT、既存 `.local` record / G store / CTX recordのSHA-256照合と、読み取り・数え上げ、および登録値（Entry ID・SHA-256）に対する
`inputDigest` の算出（§1.8。D1-A §9.4と同じ純粋なhash計算で、Planner・Engineを使わない）だけで得た。

本書の各節は次の4種類のどれかであり、見出しに明記する。

| 種類 | 意味 | 節 |
| --- | --- | --- |
| **事実** | D2-B / D2-Cの既存formal RESULT・record・G store・文書から読み取った値（本書で新しく計測していない） | §1 |
| **事前登録条件** | D2-D-Bが変えてはならない実行条件・判定規則 | §2〜§12、§14、§16 |
| **既存API** | D2-D-Bが使う既存の部品と、新規に必要なResearch処理の区別（Production変更なし） | §13 |
| **未決事項** | D2-Dの外、またはD2-D-B以降に決めること | §15 |

## 0. 位置づけとauthority

本書はResearch文書であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md`（23 / 23.1）→ `docs/PLANNER_SPEC.md`
（9.2.3.1、9.2.18、9.2.19）/ `docs/SEARCH_SPEC.md`（5.6.8）→ その他の正式文書 → 実装 → test → Research文書である。D2-DはResearch-onlyであり、
REQUIREMENTS 23（明示的な選択が無い競合について自動で再検索しない）、Planner Alternative（9.2.19.1〜9.2.19.16）、RNG、Search、UI、Persistence、
schema / version、Production defaultの意味論を変更しない。複数Targetの置換集合をまとめて評価することと、support Entryの扱いは、
Research harnessの中だけのものであり、Productionの動作（9.2.19.3のuser-fixed Route reservation、9.2.19.8.1のscenario composition）ではない。

Research authorityの順位（D2-Dの中で矛盾があれば上を優先し、矛盾は報告してD2-D-Bを止める）:

1. 本書（D2-D-A事前登録）
2. D2-C-A（§6.3 R5、§6.4 gate・選択順、§6.5 R6、§7.2 S1〜S5、§7.3 `supportExpiryCause`、§8.2 status、§9 parity状態、§10 formal validity、§11.1「より良い」の定義）。
   本書が変更・追加した点は§16に列挙する
3. D2-A（§3 R1、§6.2 status、§7.3 parity状態、§8 formal validity、§17 S5改訂）
4. D1-A（§4.1 入力構成、§4.2 記録、§4.3 Conflict resource identity、§4.4 R5、§4.5 support依存S1〜S5、§6.2 評価status、§9.4 決定性digest）
5. follow-up（§4.3 R0〜R6・`evaluatedAgainst`、§5 support、§9.3 G13〜G18）、Phase A（§2 G1〜G12、§7 budget）

D2-D-Bは本書の規則だけで判定でき、実装時に意味論を追加決定しなくて済むことを目標とする。実装名（module / 関数 / fieldの綴り）はD2-D-Bで決めてよいが、
§11のRESULT必須fieldの意味と§10の判定順序を変えてはならない。変える必要が生じた場合は、D2-D-Bの正式計測前に本書を更新する（docs PR）。

## 1. 事実（D2-B / D2-Cから確認されたこと。本書で再計測していない）

### 1.1 D2-C-Bの正式結果（`docs/PLANNER_GLOBAL_D2C_RESULT.json`、1,541,755 bytes、SHA-256 `99860c42e195de7544f5fa6b7032ad68e91950e107003cd2ed03efc86e9fcc68`）

| 項目 | 値 | 出典（D2-C RESULT） |
| --- | --- | --- |
| formal validity | `provenance.formal = true`、`runStatus = completed`、`invalidReasons = []`、unmeasured 0、not_executed 0、bound-limited 0、discovery / run envelope未到達 | `provenance`、`aggregates`、`decision` |
| provenance | measurement HEAD `627184363db50ef256f602014b457f05a227861c`（= analysis HEAD）、start attestation `a3998ab6460b03e9dbf91329a9f1e133e4eae63c201c9ac51ed05f153c695970`（verified）、calculation code digest `a86f81d120ac745b18256556dcd9966ccac4050517cac386022836e52e2fa242`、登録policy `da3dd35ca74ec65b5aaaad92c900e51626167ae617c87a8ad1d788370904bbf4`、Production changed files `[]` | `provenance` |
| D2-C-A文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md`（104,521 bytes、SHA-256 `edd9a3fbf4095a1577ec4fac670cc7649597d5f8c562d40a859dfe64e71a70a5`）。現在のmainの実ファイルとも一致 | `sources.specDocument` |
| decision | `D2C_EXCEEDS_D2B_MAIN` | `decision.case` |
| B0 | completed 20 / 43、Conflict 21、steps 1465、termination `exhausted`、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52` | `evaluations[B0]` |
| D2-C内のI0（D2-B主軸） | completed 22 / 43、Conflict 20、steps 1465、`inputDigest fnv1a32:488e42f1`、`resultDigest fnv1a32:21e8e8b5` | `evaluations[I0]` |
| **D2-C最終** | `CMP-t10-c1`: completed **23 / 43**、Conflict **20**、steps **1465**、termination `exhausted`（`reachedLimits = []`）、`inputDigest fnv1a32:75e7dba9`、`resultDigest fnv1a32:77d41017`、R5成立（`supportVacuous = false`）、`fullRunsStarted = 1` | `composition.main.finalResultEvaluationId`、`finalMetrics`、`evaluations[CMP-t10-c1]` |
| 評価run | 26件、wall 7.4〜15.3 s / 件、child heap最大0.76 GB、RSS最大1.27 GB、full Planner起動26回（評価ごと1回）、runtime-unsupported retry 0 | `evaluations[]`、`aggregates` |
| 実行環境 | Node v24.19.0、AMD Ryzen 7 9700X、メモリ 33.4 GB | `environment` |

D2-C-B run dirのevidence（`.local/d2c-k1-formal.run/`）: raw `.local/PLANNER_GLOBAL_D2C_K1_RAW.json.local`（136,356 bytes、`a0e106891b2805bb2b6b28a3b99ee31b5c535a84e795084292185e07bdc78601`）、
start attestation `start-attestation.json`（27,674 bytes、`a3998ab6…5970`）。いずれもD2-C RESULT `sources.d2c` と一致した。D2-B run dirのG store・start attestation
（`.local/d2-formal2.run/start-attestation.json`、17,164 bytes、`8c0843167d2b…cd56b`）とrawもD2 RESULT `sources.d2` と一致した
（D2 RESULT `docs/PLANNER_GLOBAL_D2_RESULT.json`、4,122,806 bytes、SHA-256 `ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c`）。

### 1.2 D2-C最終受理集合（8 Candidate、Target ID昇順）

すべて本書作成時に実ファイルのbytes・SHA-256を照合し、bodyの `id` / `targetWeaponId` / `candidateSnapshot.searchRunId` / `calculationContext`、
`candidateStableKey` 全文（RESULT記録値）のSHA-256がRESULTの記録と一致すること、`isStale = false` を確認した。

| t | TargetWeapon ID | `O_t` | 由来 / ordinal | G store file | bytes | SHA-256 | generated Entry ID | Search identity（`searchRunId`） | rung / cost | `requiresSupport` |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| t00 | `02876df4-cd56-4c95-add9-9e3e9cc90801` | `build-list.fnv1a32-bb36c5ca` | D2-C `K1-t00-e396d352` c1 | `.local/d2c-k1-formal.run/K1-t00-e396d352-c1.generated-entry.json` | 101,010 | `ee101531376ac36f491d4b1d07592fc6ca8356a62da2daeee85d956c83ff13e0` | `build-list.constrained.fnv1a32-1d2ed2a8` | `planner-alternative-search.fnv1a32-ad5c6d89` | L1 / 117 | `build-list.fnv1a32-e396d352` |
| t01 | `05e6b206-21d4-447d-86dd-f5a62ff8479e` | `build-list.fnv1a32-c1fe111c` | D2-B K0 c1 | `.local/d2-formal2.run/t01-c1.generated-entry.json` | 66,309 | `3c3f5cc8f98108735da053546fc2939176e8f4050b47854ed31b3f7f6bb48f14` | `build-list.constrained.fnv1a32-174be6b1` | `planner-alternative-search.fnv1a32-1377d794` | L1 / 92 | — |
| t04 | `a367c177-a0c2-4986-995e-4efcf4131b5c` | `build-list.fnv1a32-a3d6817e` | D2-C `K1-t04-92d87b90` c1 | `.local/d2c-k1-formal.run/K1-t04-92d87b90-c1.generated-entry.json` | 481,245 | `3d83de2ab3eac164f1ad49a21ed22bfe174f83a7fe8ac0f2644fda3ba49062c4` | `build-list.constrained.fnv1a32-7652f8d7` | `planner-alternative-search.fnv1a32-fe83bb24` | L2 / 1125 | `build-list.fnv1a32-92d87b90` |
| t06 | `b27e57a7-4a80-41a8-8d8d-17bc44f868a7` | `build-list.fnv1a32-5923e1d5` | D2-B K0 c3 | `.local/d2-formal2.run/t06-c3.generated-entry.json` | 251,042 | `06a928333ceb8a85eb33572268570673a0b082e7e44b31464230fb22bd93c218` | `build-list.constrained.fnv1a32-8b2f6ba7` | `planner-alternative-search.fnv1a32-ea668773` | L1 / 388 | — |
| t07 | `b6780f04-da21-42b0-af8c-88f09a192e17` | `build-list.fnv1a32-fd6caf7b` | D2-B K0 c1 | `.local/d2-formal2.run/t07-c1.generated-entry.json` | 170,990 | `27b098e06fbbda5a6991cc897c7cfa4e09ec69cddd45ee583b35fa365ec55e6f` | `build-list.constrained.fnv1a32-0f0b9ba2` | `planner-alternative-search.fnv1a32-fcefda67` | L1 / 255 | — |
| t08 | `d453ca34-a142-4241-9dce-8551c96cb887` | `build-list.fnv1a32-7df2bbec` | D2-B K0 c1 | `.local/d2-formal2.run/t08-c1.generated-entry.json` | 222,523 | `825e8a9eac526d62440b55bdafc21b5f5b8d98b7d00eb5b5dcdb3a80416944cc` | `build-list.constrained.fnv1a32-39482235` | `planner-alternative-search.fnv1a32-1f4c7e97` | L2 / 551 | — |
| t09 | `e4147de7-587c-4106-a47d-b09f8796464d` | `build-list.fnv1a32-a1d13672` | D2-B K0 c1 | `.local/d2-formal2.run/t09-c1.generated-entry.json` | 270,975 | `b791b03eed4f44197b9edf13f7dfe086c6cb89899d45b97f5390a225f1ce35bc` | `build-list.constrained.fnv1a32-d4134c84` | `planner-alternative-search.fnv1a32-77712a90` | L2 / 491 | — |
| t10 | `e523209e-57e8-4316-a7f0-329f64fd0b00` | `build-list.fnv1a32-66c25e3d` | D2-C `K1-t10-e396d352` c1 | `.local/d2c-k1-formal.run/K1-t10-e396d352-c1.generated-entry.json` | 24,593 | `4ae6d9b2ca28df084a3496913fdb2e53189c7425dd460cbe3064f9f9c2307b0d` | `build-list.constrained.fnv1a32-e6ff80b1` | `planner-alternative-search.fnv1a32-18c89f1d` | L1 / 25 | `build-list.fnv1a32-e396d352` |

- 出典: D2-C RESULT `composition.main.finalAccepted`（8件、`fromD2B` はt01 / t06 / t07 / t08 / t09がtrue）、`discovery.targets[].pool[]`（K1）、D2 RESULT
  `discovery.targets[].pool[]`・`sources.d2.generatedEntries`（K0）
- K0 Candidate（`requiresSupport = []`）のSearchは、D2-Bでempty reservation（`fnv1a32:5ac88909`、D2-A §2.3）を入力として行われ、R0（`reservationCheck.respects`）は全件true
- K1 Candidateの R0（`r0`）は全件trueで、Search入力のreservation digestはcontextのCTX recordの `reservationDigest` と一致する（§1.6）

### 1.3 t07のK0 Candidate（D2-B、3件。`DSC-t07-L1`、`discovery_cap_reached`）

| ordinal | G store file（`.local/d2-formal2.run/`） | bytes | SHA-256 | generated Entry ID | cost / Route kind | `candidateStableKey` SHA-256 | ADM（D2-B、baseline）| D2-B CMP（受理集合 {t01, t06} + t07） |
| ---: | --- | ---: | --- | --- | --- | --- | --- | --- |
| 1 | `t07-c1.generated-entry.json` | 170,990 | `27b098e06fbbda5a6991cc897c7cfa4e09ec69cddd45ee583b35fa365ec55e6f` | `build-list.constrained.fnv1a32-0f0b9ba2` | 255 / `existing_gogma_mixed` | `97c8f24aeeb7307644675fb843ed19cb3ec564c4e3f37f2005acd39e76c9abac` | R1成立、21 / 20 / 1465 | 22 / 20 / 1465、R5成立、gate成立（**受理**） |
| 2 | `t07-c2.generated-entry.json` | 119,011 | `d7a708d84757be2b8d8251e676e25decb3c85f150a91a71761712ee9556e91d6` | `build-list.constrained.fnv1a32-98fce3dc` | 267 / `existing_gogma_mixed` | `e4213c2d4a050975ffe460e68e8b0dd9dd418ecef5c6efdd78212784b4d3df6b` | R1成立、20 / 21 / 1465 | 21 / 21 / 1465、R5不成立 |
| 3 | `t07-c3.generated-entry.json` | 211,734 | `f23e0891fac67f6260c48aed0a121a8d2de53669b64be79efc4ca9f5d3d8abb7` | `build-list.constrained.fnv1a32-d20151d0` | 358 / `existing_gogma_mixed` | `8d4af1ef62dec1cf4319c9fd720fb8fc025876ed254b147f47e81603d190f54e` | R1成立、21 / 20 / 1465 | 22 / 20 / 1465、R5成立、gate成立（eligible、選択順でc1に負けた） |

- 3件とも Search identity `planner-alternative-search.fnv1a32-fcefda67`、`replacement = ready`（`replacedBuildListEntryId = build-list.fnv1a32-fd6caf7b`）、R0 true、
  `reusedExisting = false`、source OwnedWeapon `dc4f742c-13ad-433b-bc29-2426fcb4aff0`（3件で同じ）
- 数値はcompleted / Conflict / steps。D2-BのCMPはD2-B主軸の単一pass（t07段の `accepted` は {t01, t06}）であり、D2-Dの集合とは異なる。D2-DではADM / D2-B CMPの値を
  比較値・判定値に使わない（§5.5）

### 1.4 t05のK1 Candidate（D2-C、2件。context `K1-t05-61066e62`、`DSC-6-L1`、`discovery_cap_reached`）

| ordinal | G store file（`.local/d2c-k1-formal.run/`） | bytes | SHA-256 | generated Entry ID | cost / Route kind | `candidateStableKey` SHA-256 | source OwnedWeapon | ADM（D2-C、baseline） |
| ---: | --- | ---: | --- | --- | --- | --- | --- | --- |
| 1 | `K1-t05-61066e62-c1.generated-entry.json` | 67,339 | `982b6da2247de3ce01fb06a747a0053f86e44a44a8fe8c02d1602a18ef51a0b2` | `build-list.constrained.fnv1a32-fc2f3f48` | 153 / `existing_gogma_mixed` | `656920c9ece2bc75160c04f3c6d1022d5bd0226e0121f363334379bd3c5745e8` | `d508b91b-f454-46da-9c77-661bc4589e8d` | R1成立、21 / 21 / 1465 |
| 2 | `K1-t05-61066e62-c2.generated-entry.json` | 67,339 | `d433f6a2a7bf839a2d3470c774a9f8d6a4e7d32beaee3736e4197691005d1c33` | `build-list.constrained.fnv1a32-b63619ae` | 153 / `existing_gogma_mixed` | `53c4ddf0af655c752f5b04f23e900b45bdf2c65cbc1dc28f7d4f97850b2cc1c3` | `5749b7fb-bded-4b89-b383-9cfe904d2f5c` | R1成立、21 / 22 / 1465 |

- 2件とも TargetWeapon `a6c17e25-bd3a-42e1-b86a-c813b78acde0`、`O_t05 = build-list.fnv1a32-df40f28f`、Search identity `planner-alternative-search.fnv1a32-d3e60089`、
  reservation digest `fnv1a32:3eebc8a4`、CTX record SHA-256 `d1e415c4…e054`（CTX-6）、`requiresSupport = ['build-list.fnv1a32-61066e62']`、`replacement = ready`、R0 true、
  `reusedExisting = false`。ADMはS1〜S5成立、supportはselected

### 1.5 D2-Cでのt05段（CMP-t05-c1 / -c2）の観測

D2-Cの単一passでは、t05段の `accepted` は {t00, t01, t04, t06, t07, t08, t09}（7件）であり、**t10 c1はまだ含まれていない**（t10の受理はt05段の後）。

| 評価 | 評価集合 | 結果 | R5 | 集合内Conflict（kind / participants / resource identity） | t07 `G` | Target差分（reference `CMP-t04-c1`） |
| --- | --- | --- | --- | --- | --- | --- |
| `CMP-t05-c1`（`inputDigest fnv1a32:82303860`、`resultDigest fnv1a32:e8f37258`） | 上記7件 + t05 c1 | 23 / 20 / 1465、`exhausted` | 不成立: `generated_not_selected:…0f0b9ba2`、`conflict_within_set` | `same_skill_counter` {`…0f0b9ba2`（t07 c1）, `…fc2f3f48`（t05 c1）}、`{"counterBefore":485,"counterStream":"skill","kind":"same_skill_counter"}`、`selectedBuildListEntryId = null` | 非selected、winner `…fc2f3f48` | 獲得 t05 / `fea60316-a05c-4252-bf1d-41c31b99b75a`、喪失 t07 / `b4f252cd-9530-46f2-b387-b99e3904a66e` |
| `CMP-t05-c2`（`inputDigest fnv1a32:5aeb3800`、`resultDigest fnv1a32:716d503e`） | 上記7件 + t05 c2 | 23 / 21 / 1465、`exhausted` | 不成立（同上） | `same_skill_counter` {`…0f0b9ba2`, `…b63619ae`（t05 c2）}、Skill 485 | 非selected、winner `…b63619ae` | 同上（Conflict +1） |

- 両評価でsupport 3件（`e396d352` / `92d87b90` / `61066e62`）はS1〜S5成立・selected。t05の `G` はselected
- 診断値（D2-C RESULT `evaluations[].candidates` / `conflicts` / `referenceDiff` / `supportChecksByEntry`）。D2-Dではこれらを判定に使わない（§8.3）

### 1.6 support context record（D2-C CTX、再利用する4件。`.local/d2c-k1-formal.run/`）

| CTX | context | support Entry | 使うCandidate | bytes | SHA-256 | `reservationDigest` | `supportBodySha256` | `reservationBody` の概要 |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| CTX-1 | `K1-t00-e396d352` | `build-list.fnv1a32-e396d352` | t00 c1 | 35,505 | `39adb498b93d2f60cd465ae16125cee53bdf131c8979c092dcb3d0a3d6c0a2e1` | `fnv1a32:240e4673` | `d92ccdded3c09a7b98997fd6fb8ff2b6ee7223069f66575d1ba895dbc0be4b60` | exclusive `[]`、Gogma held 23（55..77）、Skill held 3（341..343）、Normal 1 counter |
| CTX-5 | `K1-t04-92d87b90` | `build-list.fnv1a32-92d87b90` | t04 c1 | 338,994 | `7e42c33cbeca28265ecbc7946f9a48ae764bb3c528bbc3f89fa107d1988a4b4c` | `fnv1a32:36a22758` | `9e9d5211a5aacd4c0fffebb5d38959fd92d360d36e264e3cb38b7f76b6efe032` | exclusive `['60126fe6-ad44-492c-bb13-b0320f2cbd2a']`、Gogma held 17（55..71） |
| CTX-6 | `K1-t05-61066e62` | `build-list.fnv1a32-61066e62` | t05 c1 / c2 | 31,237 | `d1e415c4a06970055395901b40811dd9fe1226d6af70ce23471c831c79e5e054` | `fnv1a32:3eebc8a4` | `01228e341f3bbcd0991216133efe3b1cd7c29e3fb8f873f026550f4bf890c135` | exclusive `['aec3d2e4-2c1d-4dca-abae-39d648b2c4f0']`、Gogma held 90（55..144）・blocked 2（107 / 144） |
| CTX-7 | `K1-t10-e396d352` | `build-list.fnv1a32-e396d352` | t10 c1 | 18,630 | `a3a531065350f1a2f854ddbb7ffe2e25d6fcf14fe7f39ea83717a5a36b012372` | `fnv1a32:240e4673` | `d92ccdded3c0…4b60` | CTX-1と同じreservation |

- 4件ともbytes・SHA-256がD2-C RESULT `sources.d2c.contextRecords` と一致し、`result.reservationBody` はJSONオブジェクト（文字列でない）、`result.status = context_ready`、
  C1〜C4成立（C5はCTX-6だけ `not_applicable`、他は `matched`）
- D2-C最終受理集合の `S_sup` は {`e396d352`, `92d87b90`}。t05のK1 Candidateを加えると `61066e62` が加わる

### 1.7 Routeの読み取り（G store bodyの `candidateSnapshot.route.operations` を数えただけ。Plannerは実行していない）

| Candidate | 操作の内訳 | Skill位置（`reset_skills` の `skillCounterBefore`） | Gogma位置 | 最後の操作 |
| --- | --- | --- | --- | --- |
| t07 c1 | keep 110、reset_skills 145 | 341..485（連続145） | 55..164 | `reset_skills` Skill 485 |
| t07 c2 | keep 19、reset_skills 248 | 341..588（連続248） | 55..73 | `reset_skills` Skill 588 |
| t07 c3 | keep 110、reset_skills 248 | 341..588（連続248） | 55..164 | `reset_skills` Skill 588 |
| t05 c1 / c2 | reset_bonuses 1、keep 7、reset_skills 145 | 341..485（連続145） | 140..151 | `reset_skills` Skill 485 |

### 1.8 評価入力digest（D1-A §9.4と同じ定義を登録値へ適用した算出値）

`inputDigest = hashStableValue({ T（Target ID昇順）, generatedBuildListEntryIds, generatedEntrySha256s, exportSha256, researchMaxPlanSteps: 20000, conflictResolutions: [] })` を
§1.2〜§1.4の登録値に適用した。同じ算出でD2-C最終集合の値はD2-C `CMP-t10-c1` の記録 `fnv1a32:75e7dba9` を再現した。

| 集合 | `inputDigest` | D2 RESULT（86件）・D2-C RESULT（26件）の評価で同じ値 |
| --- | --- | --- |
| D2-C最終（I0） | `fnv1a32:75e7dba9` | D2-C `CMP-t10-c1` |
| PAIR-1（t05 c1 / t07 c1） | `fnv1a32:55b1abda` | なし |
| PAIR-2（t05 c1 / t07 c2） | `fnv1a32:30ea5123` | なし |
| PAIR-3（t05 c1 / t07 c3） | `fnv1a32:6493291d` | なし |
| PAIR-4（t05 c2 / t07 c1） | `fnv1a32:a7b574da` | なし |
| PAIR-5（t05 c2 / t07 c2） | `fnv1a32:39fc4b63` | なし |
| PAIR-6（t05 c2 / t07 c3） | `fnv1a32:f135c305` | なし |

- **PAIR-1はD2-Cの既知評価（CMP-t05-c1）と同じ入力ではない**。CMP-t05-c1にはt10 c1が無く（t10は `O_t10` のまま）、PAIR-1にはある。D2-Cでt05 c1とt07 c1を
  t10 c1と同時に評価した記録は存在しない。したがってPAIR-1とD2-Cの既知結果の比較はdigest parityではなく、診断比較として登録する（§8.3）
- D2-D-BのVはこの6値と、§1.2のI0の値を `d1InputDigest()` で再計算して照合する（§9.1）

### 1.9 cost参照値（見積もりの根拠。事前登録値ではない）

| 参照 | 値 | 出典 |
| --- | --- | --- |
| D2-C評価run | 26件、wall 7.4〜15.3 s / 件、heap最大0.76 GB、RSS最大1.27 GB、full run 1回 / 件、retry 0 | D2-C RESULT |
| D2-C の8〜9 G評価（CMP-t05 / CMP-t10） | wall 15.1〜15.2 s、heap 0.70〜0.72 GB | D2-C RESULT `evaluations[]` |
| D2-B評価run | 86件、7.0〜14.8 s / 件、`fullRunsStarted = 1` | D2 RESULT `aggregates` |
| steps | 全評価で1465（`researchMaxPlanSteps = 20000` の7.3%） | D2 / D2-C RESULT |

### 1.10 推論（測定していない。D2-D-Bの計測で確かめる）

- I-D2D-1: D2-Cのt05段の集合内Conflictは、t07 c1とt05 K1のどちらもRoute最後の操作がSkill 485の `reset_skills` である位置での `same_skill_counter` だった（§1.5 / §1.7）。
  t07 c2 / c3はSkill 485の後も `reset_skills` が続く（588まで）ので、Skill 485のunitは `reset_skills` → `reset_skills` の `canSkipWhenCounterPassed` に当たり、
  同じ位置で「最後の操作同士」が衝突する構造ではなくなる。**これは衝突が解消されることを意味しない**: t07 c2 / c3はSkill 486..588を使い、Gogma・他Targetとの別の資源競合や、
  別の暫定帰結による非selectedが起こり得る（D2-B CMPではt07 c2がR5不成立だった）
- I-D2D-2: t07 c1を含むPAIR-1 / PAIR-4は、D2-Cで観測した衝突の構造をそのまま持つ。t10 c1の追加（D2-Cでは同値置換）で帰結が変わる理由は無いが、
  D2-D-Bはこれを推定として使わずfreshに評価する（§8.3）
- I-D2D-3: t07の3 Candidateは同じsource OwnedWeapon（`dc4f742c…`）を使い、t05の2 Candidateは別のsource（`d508b91b…` / `5749b7fb…`）を使う。t05 support
  `61066e62` のexclusive OwnedWeapon `aec3d2e4…` はどのCandidateのsourceでもない。OwnedWeapon排他消費による衝突は §1.7の読み取りからは示唆されない
- I-D2D-4: t07 c2 / c3はcompleted・Conflictの観点でD2-B / D2-Cのt07 c1より有利だった記録はない（§1.3）。t05とt07が共存しても、t07自身や他Targetの完成を失い、
  全体指標がD2-C最終（23 / 20）を下回る可能性がある。これは予想であり、判定規則には使わない（§12）

## 2. 事前登録条件: 目的・scope・対象外

### 2.1 目的

D2-C最終受理集合（23 / 20 / 1465）を起点に、t07の受理済みCandidateをD2-Bで発見済みの別のK0 Candidateへ差し替え、同時にD2-Cで発見済みのt05のK1 Candidateを加えた
**局所2-Target再合成** 6組を、それぞれ1回のfresh full Planner runで評価する。これにより、

1. t05とt07のCandidateが同じ集合内で共存するか（R5、§5.1。共存の局所診断は§5.2）
2. その集合がD2-C最終より良いか（非後退gateと「より良い」、§5.3 / §5.4）

を、新しいSearchなしに、有界な8評価で測る。1と2は別々に記録する。

### 2.2 scope

| 項目 | D2-Dの値 |
| --- | --- |
| 固定するCandidate | D2-C最終受理集合のt07以外の7件（t00 c1 / t01 c1 / t04 c1 / t06 c3 / t08 c1 / t09 c1 / t10 c1、§1.2）。body・Entry ID・`requiresSupport` を変えない |
| 可変部分 | t07: D2-B K0 c1 / c2 / c3（§1.3）、t05: D2-C K1 c1 / c2（§1.4）。各Targetに高々1件 |
| 評価組 | §3.2の6組だけ。結果を見て増減させない |
| 置換しないTarget | 置換集合に入らないTarget（E1外の32 Targetと、置換集合外のE1 Target t02 / t03）は元Route（Export上のEntry）のまま。43 Targetすべてを評価対象とし、Targetを除外しない |
| support | 置換集合のK1 Candidateの `requiresSupport` の和（PAIR: `e396d352` / `92d87b90` / `61066e62`、I0: `e396d352` / `92d87b90`）。Exportの元Entryのまま通常のBuild List Entryとして扱う |
| Export / RNG / CalculationContext | D2 / D2-Cと同じ（Export `cc35fb5b…1e6b`、`production-rng:c5-e7`、`{ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }`） |
| Plan step bound | Research `researchMaxPlanSteps = 20000`（Production A / Bと混同しない、G12） |
| conflict resolution / fixed constraint | すべての評価runで `conflictResolutions = []`、preflightのfixed constraint `[]`（G1） |
| population | `oracleGuidedTargetPopulation = true`（E1の部分集合を継承）。登録組はTarget IDで分岐する新しい規則を持たず、§3.1の導出規則で機械的に決まる |

### 2.3 対象外

- 新しいK0 / K1 / K2 Search、新しいsupport候補の導出、Candidate discovery（3件目以降を含む）、t02 / t03の追加探索
- 3 Target以上を同時に変更する探索（固定7件の置換・除外を含む）、t04 / t10の同値置換を外す別axis、t03のK2探索、t02の再Search
- 6組以外の組み合わせ、合成順の総当たり、PAIRの結果を受けた追加評価（PAIR同士の合成、最良PAIRへの追加など）、複数pass
- 新しいADM（R1は既存formal RESULTの値を確認するだけ、§4.4）
- alternative-to-alternative support、support依存の連鎖・失効したsupportの自動再解釈
- oracle exactとの比較。oracle（`PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、manifest、module）は実行入力・診断入力・分析のいずれにも使わない
- Phase B / D1 / D2 / D2-Cのformal RESULT・decisionの書き換え、D2-Dの結果をそれらのdecision inputへ戻すこと
- Production Search / Planner / RNG / UI / Persistence、schema / version、Domain semanticsの変更、Production化、REQUIREMENTS 23の契約変更

## 3. 事前登録条件: 評価集合

### 3.1 導出規則（V・analyzerが機械的に再実行する）

```text
F    = D2C RESULT composition.main.finalAccepted（Target ID昇順、8件）
       検証: finalResultEvaluationId === 'CMP-t10-c1'、finalMetrics = { 23, 20, 1465 }、
             各要素のG store（K0はD2 RESULT sources.d2.generatedEntries、K1はD2C RESULT discovery.targets[].pool[].generatedEntry）が §1.2 と一致
Fixed = F のうち label !== 't07'（7件）
P07  = D2 RESULT discovery.targets[label = 't07'].pool（ordinal昇順、3件）
       検証: 各 ordinal o について D2 ADM-t07-c<o>.r1r4.R1 === true、F[t07] = P07[ordinal 1]
P05  = D2C RESULT discovery.targets[label = 't05'].pool（ordinal昇順、2件）
       検証: 各 ordinal o について D2C ADM-t05-c<o>.r1r4.R1 === true、
             D2C composition.main.steps[label = 't05'].stepOutcome === 'not_replaced_no_eligible'
PAIRS = [ (a, b) for a in P05 for b in P07 ]           // t05 ordinal 主、t07 ordinal 従。順序 = PAIR ordinal 1..6
各PAIRの置換集合 = Fixed ∪ { t05: a, t07: b }（Target ID昇順、9件）
I0の置換集合     = F（8件）
```

- 導出結果は§3.2の登録表と **集合・順序・Entry ID・G store bytes / SHA-256・`requiresSupport`・`inputDigest`（§1.8）がすべて一致** しなければならない。
  不一致はV失敗（`D2D_INVALID`、`input_evidence`）で、childを1つも起動しない。不一致を推測で補正しない
- Candidate IDとsupportはRESULTから導出し、D2-D-B sourceへTarget ID・Entry ID・stable keyを書かない（§9.3）。§3.2の表は照合にだけ使う

### 3.2 登録PAIR（6組、この順序がPAIR ordinal）

| PAIR ordinal | 評価ID | t05 | t07 | 置換集合（Target ID昇順） | `S_G` 件数 | `S_sup` | `inputDigest`（§1.8） |
| ---: | --- | --- | --- | --- | ---: | --- | --- |
| 1 | `PAIR-t05c1-t07c1` | K1 c1（`…fc2f3f48`） | K0 c1（`…0f0b9ba2`） | t00 c1 / t01 c1 / t04 c1 / **t05 c1** / t06 c3 / **t07 c1** / t08 c1 / t09 c1 / t10 c1 | 9 | `e396d352` / `92d87b90` / `61066e62` | `fnv1a32:55b1abda` |
| 2 | `PAIR-t05c1-t07c2` | K1 c1（`…fc2f3f48`） | K0 c2（`…98fce3dc`） | 同上（t05 c1、t07 c2） | 9 | 同上 | `fnv1a32:30ea5123` |
| 3 | `PAIR-t05c1-t07c3` | K1 c1（`…fc2f3f48`） | K0 c3（`…d20151d0`） | 同上（t05 c1、t07 c3） | 9 | 同上 | `fnv1a32:6493291d` |
| 4 | `PAIR-t05c2-t07c1` | K1 c2（`…b63619ae`） | K0 c1（`…0f0b9ba2`） | 同上（t05 c2、t07 c1） | 9 | 同上 | `fnv1a32:a7b574da` |
| 5 | `PAIR-t05c2-t07c2` | K1 c2（`…b63619ae`） | K0 c2（`…98fce3dc`） | 同上（t05 c2、t07 c2） | 9 | 同上 | `fnv1a32:39fc4b63` |
| 6 | `PAIR-t05c2-t07c3` | K1 c2（`…b63619ae`） | K0 c3（`…d20151d0`） | 同上（t05 c2、t07 c3） | 9 | 同上 | `fnv1a32:f135c305` |

- Entry IDは `build-list.constrained.fnv1a32-` の先頭8桁表記、supportは `build-list.fnv1a32-` の先頭8桁表記である。全文は§1.2〜§1.4
- PAIR-1 / PAIR-4は「t07を差し替えない」組（t07 c1のまま、t05だけを加える）である。D2-Cのt05段とはt10 c1の有無が異なる（§1.8）。比較のためにfreshに評価する
- 評価IDは表示IDであり、同定は (t05 ordinal, t07 ordinal) と、Entry ID全文・G store SHA-256で行う

## 4. 事前登録条件: 評価手順

### 4.1 実行順序（固定）

```text
V      入力検証（親。childを起動しない、§9.1）
RV     Candidate・reservationの再検証（1 child。Searchもfull Planner runも行わない、§6.1）
B0     baseline参照評価（D1-A §5.1、{ kind: 'persisted' }）
I0     D2-C最終受理集合のfresh再評価（§4.3）
PAIR   PAIR ordinal 1 → 6（§3.2）
```

- 依頼時の基本案（V → B0 → I0 → PAIR）に、Search当時のreservationとsupport依存の維持を全対象Candidateについて実行前に検証するため、RVを1 child追加した（§16）。
  RVは評価ではなく、評価件数（§7.3）に数えない
- B0 / I0を先に行い、parity不一致ならPAIRの前に中止する（§7.5）
- 登録された評価をすべて実行する。早期打ち切りはしない（どのPAIRでR5や改善が成立しても、残りのPAIRを評価する）。同じ `inputDigest` の評価が既にあっても結果を流用せず、
  別のchild processで実行する

### 4.2 B0

D2-C-A §8.1のB0と同じ（`{ kind: 'persisted' }`、置換なし、`evaluatedAgainst = baseline_reference`）。期待値はD2-C B0の値（§8.1）。

### 4.3 I0（D2-C最終受理集合のfresh再評価）

| 項目 | 値 |
| --- | --- |
| 評価ID | `I0` |
| 集合 | D2-C最終受理集合（§1.2の8件、Target ID昇順） |
| `G` のbody | §1.2のG store（D2-B run dirの5件、D2-C run dirの3件）。runnerは読み込み時にbytes・SHA-256を登録値・各RESULTの `sources` と照合する |
| `requiresSupport` | t00 / t10: `[e396d352]`、t04: `[92d87b90]`、他: `[]` |
| support record | t00: CTX-1、t04: CTX-5、t10: CTX-7（§1.6） |
| `evaluatedAgainst` | `replacement_set` |
| 期待値（parity `d2c_final`、§8.1） | `inputDigest = fnv1a32:75e7dba9`、status `evaluated`、`resultDigest = fnv1a32:77d41017`、termination `exhausted`、completed 23 / 43、Conflict 20、steps 1465、R5成立 |
| 役割 | 非後退gateと「より良い」の基準（reference）。比較値「D2-C最終」の **D2-D-B内の実行結果** |

- **D2-Cの過去RESULTを新しい集合評価の実行結果として流用しない**。gate・比較のreferenceはI0の評価recordだけから読む。D2-C RESULTの値はparityの期待値にだけ使う
- I0が比較可能な結果を持ち期待値と異なれば `mismatched`（`D2D_INVALID`）で、runnerは直ちに中止する（§7.5）
- I0がunmeasuredなら、PAIRは評価を起動せず `not_executed`（`notExecutedReason = i0_unmeasured`）で、decisionは `D2D_INCOMPLETE`

### 4.4 PAIR（各組を1 runで評価）

```text
for k in 1..6:                                   // PAIR ordinal順。各評価は前の評価の結果に依存しない
    (a, b) = PAIRS[k]
    replacements = Fixed（7件）∪ { t05: a, t07: b }      // Target ID昇順の置換集合（各Target高々1件、9件）
        t07 の既存 generated Entry（I0の t07 c1）は b に置換される（b = c1 の組では同じEntryのまま）
        t05 は O_t05 → a の置換として追加される
    評価 PAIR-t05c<a>-t07c<b>: replacements を evaluatedAgainst = replacement_set として1 runで評価
        手順はD1-A §4.1 / D2-C-A §6.2と同じ: baseline + 各 G を末尾に追加、9.2.18 replacement（-O_t + G）、
        preflight、full runner（Trace Replayを含む）、評価ごとのfull Planner起動上限8
    判定: R5（§5.1）、局所共存診断（§5.2）、gate（§5.3）、R6（§5.6）を記録
```

- t05の追加とt07の差替えは **1つのPlannerInput上で同時に** 行う。t05を先に加えてからt07を差し替える2段階の評価や、t07の差替えだけの評価は行わない
- 1回のPlannerInputには各Target高々1件の生成Entryだけを入れる（G15）。t07のc1とc2、t05のc1とc2を同時に入れない
- 固定7件のbody・`requiresSupport` は全PAIRで同じであり、PAIRごとに選び直さない
- PAIR同士の比較・選択（§5.4）は記録済みの結果だけで行い、追加の評価runを行わない。最良PAIRを起点にした追加の合成もしない
- 評価上限: PAIR 6件（§7.3）

## 5. 事前登録条件: 判定

### 5.1 R5（`set_coexistent_R`）

D2-C-A §6.3（D1-A §4.4）の5条件を、各評価の置換集合へそのまま適用する。

記号: 置換集合 `T`、`S_G = { G_t.id | t ∈ T }`、`S_sup = ⋃_{t ∈ T} requiresSupport(G_t)`、`M = S_G ∪ S_sup`、`selected = plan.selectedBuildListEntryIds`。

| 条件 | 判定 | failure reason |
| --- | --- | --- |
| (1) 置換集合の全generated Entryがselected | `S_G ⊆ selected` | `generated_not_selected`（どの `G_t` かを列挙） |
| (2) 必要supportがすべてselected | `S_sup ⊆ selected` | `support_not_selected`（どの `s` かを列挙） |
| (3) support依存が有効 | `S_sup` の各 `s` について§6.2の動的check S1〜S3がすべて成立 | `support_expired_R`（`supportExpiryCause`） |
| (4) 集合内Conflictなし | `result.conflicts` に `|c.buildListEntryIds ∩ M| ≥ 2` となる `c` が存在しない（`c.selectedBuildListEntryId` によらない） | `conflict_within_set` |
| (5) Plan + Trace Replay | 評価statusが `evaluated`、`plan !== null`、`termination.status ∈ { 'completed', 'exhausted' }` | `no_plan` / `plan_bound_truncated` / `preflight_refused` / `planner_rerun_bound_reached` |

- `R5.satisfied = (1) ∧ (2) ∧ (3) ∧ (4) ∧ (5)`。(5)が偽でも計算できる条件は記録する
- PAIRでは `|S_G| = 9`、`|S_sup| = 3`、`|M| = 12`。I0では `|S_G| = 8`、`|S_sup| = 2`
- R5は置換集合外Targetの完成、Conflict 0、全体completedの増加を要求しない。**R5成立はIssue #154の最終Acceptanceではない**（それはR6、§5.6）
- supportがPlannerでselectedにならなかった場合は(2)偽でR5不成立（measured、通常の非共存）であり、INVALIDではない

### 5.2 t05 / t07の局所共存（`pairCoexistence`、診断）

R5とは別に、各PAIRについて次を記録する。**判定（decision）にはR5だけを使い、`pairCoexistence` を使わない。**

| field | 内容 |
| --- | --- |
| `t05.selected` / `t07.selected` | t05 / t07の `G` が `selected` に含まれるか |
| `t05.winnerBuildListEntryId` / `t07.winnerBuildListEntryId` | 非selectedの場合のprovisional winner（D1の `candidates[]` と同じ定義） |
| `t05.targetSelected` / `t07.targetSelected` | t05 / t07のTargetが `selectedTargetWeaponIds`（`plan.selectedBuildListEntryIds` のTarget集合、D2と同じ定義）に含まれるか。置換集合の評価では `O_t` が外れる（9.2.18 replacement）ので通常は `selected` と同じ値になるが、定義が異なるので別fieldとして記録し、一致しない場合も補正しない |
| `conflictsBetweenPair[]` | `t05.G` と `t07.G` の両方をparticipantとするConflict（kind、participants、resource identity、`selectedBuildListEntryId`） |
| `conflictsWithPair[]` | `t05.G` または `t07.G` を含み、相手が `M` の他の要素であるConflict |
| `pairCoexistence` | `t05.selected ∧ t07.selected ∧ conflictsBetweenPair = []` |
| `d2cT05ResourcesObserved[]` | D2-C CMP-t05-c1 / -c2の集合内Conflictのresource identity（§1.5、Skill 485 `same_skill_counter`）が、当該評価の `result.conflicts` に（participantによらず）現れるか |

- `pairCoexistence` が真でもR5が偽になり得る（固定7件の `G` やsupportが非selectedになる、他の集合内Conflictが生じる）。その場合は「t05とt07は共存したが、
  置換集合としては共存しなかった」と記録し、改善とも置換集合の共存とも扱わない

### 5.3 非後退gate

- gate: `completed(PAIR) ≥ completed(I0)`（`termination.completedTargetCount`。I0はD2-D-Bのfresh評価の値で、parityにより23）
- gate不成立でR5成立のPAIRは `r5OnlyEligible = true`（診断）
- **eligible(PAIR)** ⇔ 評価statusが `evaluated` ∧ R5成立 ∧ gate成立

### 5.4 「より良い」とPAIRの選択順

- 「(a, b) が (c, d) より良い」は、completedが大きい、またはcompletedが等しくConflictが少ないことをいう（D2-A §9.1 / D2-C-A §11.1と同じ。stepsは「より良い」に使わない）
- **improved(PAIR)** ⇔ eligible(PAIR) ∧ (completed(PAIR), conflicts(PAIR)) がI0より良い
  - R5が成立してもcompletedがI0より小さい（gate不成立）PAIRは改善ではない
  - completedがI0と等しくConflictがI0以上のPAIRは改善ではない（等しい場合は `equalMetrics = true`、多い場合は `conflictIncreased = true` を記録）
- 選択順（eligibleが複数あるとき、上から）: (1) completed 大きい方、(2) `result.conflicts.length` 少ない方、(3) `plan.steps.length` 少ない方、(4) PAIR ordinal 小さい方
- `bestEligiblePair` = eligibleのうち選択順で最初のもの（無ければnull）。`bestImprovedPair` = improvedのうち選択順で最初のもの（無ければnull）。improvedはeligibleの部分集合なので、
  `bestImprovedPair` が非nullなら `bestEligiblePair` と同じである
- 比較値はすべて当該評価runの結果から読み、ADM・D2-B CMP・D2-C CMPの値を使わない。選択は記録だけで、選択したPAIRを起点にした追加の評価・合成をしない

### 5.5 既存admission（R1）の扱い

- t07の3件（D2 `ADM-t07-c1..c3`）とt05の2件（D2-C `ADM-t05-c1..c2`）は、既存formal RESULTでR1成立（`evaluatedAgainst = baseline`）である。D2-DはVでその値を確認するだけで、
  ADMを再実行しない。R1・R2〜R4・`found_R` をR5として流用しない（G20 / G25）
- 評価時の (2) `resolveBuildListEntryReplacement()` の `ready`（`replacedBuildListEntryId === O_t`）はRVと各評価childで再確認する（§6.1）

### 5.6 R6（`global_complete_R`）

`replacement_set` の評価（I0、PAIR）について、D2-C-A §6.5と同じ5条件（`evaluated` かつ `plan !== null` かつTrace Replay成功、`termination.status === 'completed'` かつ
`completedTargetCount === totalTargetCount === 43`、`result.conflicts.length === 0`、`plan.rejectedBuildListEntries` に `reason === 'resource_conflict'` が無い、R5成立）を
すべて満たすこと。R5成立・pairCoexistence・completed増加・Conflict減少だけではR6を主張しない。

## 6. 事前登録条件: support validityとSearch当時のreservationの維持

### 6.1 RV（1 child。評価の前に1回だけ行う）

```text
unit RV:
    baseline = globalResearchInputFromExport(Export, 20000)                       // conflictResolutions = [] を確認
    for G in Fixed ∪ P07 ∪ P05（12件、§3.1）:
        RV1 body: SHA-256（§1.2〜§1.4）、id、targetWeaponId、calculationContext、isStale = false、
                  candidateSnapshot.searchRunId === 登録Search identity、
                  SHA-256(candidateStableKey(G.candidateSnapshot)) === 登録keySha256
        RV2 replacement: resolveBuildListEntryReplacement(baseline, G) が ready かつ replacedBuildListEntryId === O_t
        RV3 Search当時のreservation（res(G)）:
              K0: phase2c27bResolveSupportContext(baseline, dependencies, t, []).prepared.reservation
                  （D2-Bと同じ経路）。hashStableValue(res) === 'fnv1a32:5ac88909'（D2-Aの登録値）
              K1: CTX record（§1.6）の reservationBody（JSONオブジェクト）。DSC pooled recordのreservation digest（D2-C RESULT pool[].reservationDigest）
                  === CTX record reservationDigest、pool[].contextRecordSha256 === CTX record SHA-256
        RV4 R0再判定: respectsPhase2C2Reservation(summarizePhase2C2Entry(G, baseline, engine), G.candidateSnapshot.route, res(G)).respects === true
    for s in { e396d352, 92d87b90, 61066e62 }（§1.6）:
        RV5 S4相当: Exportの s のbodyが1件あり、SHA-256(stableStringify(body)) === CTX record supportBodySha256
        RV6 S5相当: (a) hashStableValue(derivePlannerAlternativeReservation([Exportの s のbody], engine)) === CTX record reservationDigest
                    (b) stableStringify(導出reservation) === stableStringify(CTX record reservationBody)（両辺オブジェクト）
    記録: <run dir>/RV.record.json（runnerがbytes・SHA-256をjournalへ記録）
```

- RV1〜RV6のいずれかの不成立はguardrail違反（`D2D_INVALID`、`guardrail`）であり、runnerは直ちに中止する（§7.5）
- RVはSearchを実行しない。full Planner runも起動しない。discovery・materializationもしない（G store bodyは読み込むだけで書き換えない）
- e396d352はCTX-1とCTX-7の両方にあり、両recordのreservationBody / digest / supportBodySha256が一致することも確認する（§1.6のとおり一致している）
- CTX recordの読み込み規則はD2-C-A §4.1と同じ（record全体のbytes・SHA-256をD2-C RESULT `sources.d2c.contextRecords` と照合し、`result.reservationBody` がJSONオブジェクトで
  あることを確認する。文字列などなら `evidence_integrity`。文字列をparseして救済しない。比較は両辺オブジェクトの `stableStringify()`、digestは文字列一致）
- RVはK0 Candidateに新しいsupportを付けない。K0のSearch当時のreservationはempty-supportのものであり、D2-Dの評価集合にsupportがあっても、K0 Candidateの
  `requiresSupport` は `[]` のままである

### 6.2 評価時のcheck（I0 / PAIR。`S_sup` の各 `s` について）

D2-C-A §7.2のS1〜S5をそのまま適用する。S4 / S5の比較対象は、`s` の属するCTX record（t00 / t10の `e396d352` はCTX-1。CTX-7と一致することはRVで確認済み、
t04の `92d87b90` はCTX-5、t05の `61066e62` はCTX-6）である。

| check | 内容 | 種類 | 不成立時 |
| --- | --- | --- | --- |
| S1 | `s` のTargetが置換集合 `T` に含まれない | 動的 | R5(3)偽、`support_expired_R` |
| S2 | 最終run入力（runtime-unsupported retry後）の `buildListEntries` に `s` が存在する | 動的 | R5(3)偽、`support_expired_R` |
| S3 | 最終run入力の初期contextに `s` がvalid Entryとして存在する | 動的 | R5(3)偽、`support_expired_R` |
| S4 | 評価入力内の `s` のbodyがExportのbodyと `stableStringify()` で一致し、そのSHA-256がCTX recordの `supportBodySha256` と一致する | 静的 | guardrail違反（`D2D_INVALID`） |
| S5 | (a) 導出reservationのdigestがCTX recordの `reservationDigest` と一致し、かつ (b) 導出reservationとCTX recordの `reservationBody` の `stableStringify()` が一致する | 静的 | guardrail違反（`D2D_INVALID`） |

- `supportExpiryCause` はD2-C-A §7.3の表と同じ（上から最初に該当するもの。S4 / S5不成立なら記録した原因によらず `D2D_INVALID`）
- 評価childへの受け渡し: D2-C-Bと同じく、bytes・SHA-256を照合済みのCTX recordの `result.reservationBody` オブジェクトを `supportReservation` に、`reservationDigest` を
  `supportReservationDigest` に、`supportBodySha256` を `supportBodySha256` に入れて `runD2CEvaluation()` へ渡す（§13）。文字列を渡さない
- 各評価childは、full runの前に当該評価の全 `G` についてRV1（body SHA-256・id・targetWeaponId）とRV2を再確認し、不一致はguardrail違反とする
  （RVの結果だけを信用しない。RV3 / RV4はRVで1回だけ行う）
- K0 Candidate（t01 / t06 / t07 / t08 / t09）はsupportを要求しないので、S1〜S5の対象にならない。supportの有無にかかわらず、K0の `G` 自身の選択はR5(1)で検査する
- S1は登録scopeでは構造上成立する（supportのTargetはE1外で、置換集合はE1 Targetだけ）が、規則として常に検査する
- supportは通常のBuild List Entryとして扱い、user-fixed Route、resolution、scenario resolution、repair lineage、fixed constraint、`selectedBuildListEntryId` に変換しない（G30）

## 7. 事前登録条件: status・budget・envelope

### 7.1 status

D2-C-A §8.2の評価statusをそのまま使い、次を追加する。

| 対象 | status / outcome | measured | 扱い |
| --- | --- | --- | --- |
| RV | `verified` | yes | B0へ |
| RV | RV1〜RV6不成立 | — | guardrail違反（`D2D_INVALID`、runnerは中止） |
| RV | `timeout` / `out_of_memory` / `process_failure` / `interrupted` | **no** | B0 / I0 / PAIRは `not_executed`（`rv_unmeasured`）。decision `D2D_INCOMPLETE` |
| B0 | unmeasured | **no** | B0 parityは `not_checked`、`baselineDiff` は `null`（理由を記録）。I0 / PAIRは続ける。decision `D2D_INCOMPLETE` |
| I0 | unmeasured | **no** | PAIR全件 `not_executed`（`i0_unmeasured`）、decision `D2D_INCOMPLETE` |
| PAIR | unmeasured | **no** | そのPAIRのR5 / gate / 改善は未判定。後続PAIRは続ける。decision `D2D_INCOMPLETE` |
| 任意 | `not_executed`（`run_envelope_reached` / `rv_unmeasured` / `i0_unmeasured` / `aborted_after_invalid`） | **no** | 登録件数に必ず計上する |

- `plan_bound_truncated`（`termination.status === 'incomplete'`）と `planner_rerun_bound_reached` はbound-limitedとして一覧に残し、通常の非共存と区別する（measured、R5(5)偽）
- wall-clock timeout・OOMを、非共存・改善不能の証明として扱わない（G6 / G7 / G34）。時間・メモリの上限に達した評価はunmeasuredである
- unmeasuredかどうかは、runnerが記録したprocess outcomeとnot_executed記録だけで決まる。証拠の欠損・破損は `D2D_INVALID`（`evidence_integrity`、§9.5）

### 7.2 budget（それぞれ独立。Production boundへ流用・合算しない、G5）

| budget | 値 |
| --- | --- |
| 新規Search / Candidate discovery / CTX / ADM | 0 |
| RV | 1 child（評価に数えない） |
| B0 | 1 |
| I0 | 1 |
| PAIR | 6 |
| 評価リクエスト合計 | **8以下**（B0 1 + I0 1 + PAIR 6） |
| child process合計 | **9以下**（RV 1 + 評価 8） |
| 評価ごとのfull Planner起動上限 | 8（runtime-unsupported retryを含む。評価ごとに新規。full Planner起動の総数は最大64、見込みは評価数と同じ8） |
| `researchMaxPlanSteps` | 20000 |

### 7.3 execution envelope

| 項目 | 値 | D2-Cの実測との照合 |
| --- | --- | --- |
| RVのwall上限 | 10分 | D2-CのCTX child（Export読込・初期context・reservation導出）は6.9〜7.0 s。RVはそれを最大4回分（K0 empty contextとsupport 3件）+ unit plan 12件 |
| 評価のwall上限 | 30分（preflight、full run、retry、Trace Replayを含むchild全体。超過はtimeout = unmeasured） | D2-Cの評価は最大15.3 s、9 G相当の評価は15.1〜15.2 s。上限の1%未満で矛盾しない |
| run envelope | run開始から **4時間**。到達後は新しいchildを起動せず、未起動の評価を `not_executed`（`run_envelope_reached`）とする（実行中のchildは各上限まで待つ） | 見込み約3〜5分。理論上の最悪（RV 10分 + 8評価 × 30分 = 4時間10分）ではenvelopeに達し得るが、それは全評価がtimeoutする場合だけである |
| child heap上限 | 12,288 MB（`--max-old-space-size`） | D2-Cの評価heap最大0.76 GB、RSS最大1.27 GB。D2-C全体のchild heap最大7.07 GB（discovery） |
| concurrency | 1 | Phase B / D1 / D2 / D2-Cと同じ |
| full Planner起動上限 | 評価ごと8 | D2-Cは全26評価で1回、retry 0 |
| `researchMaxPlanSteps` | 20000 | D2 / D2-Cの全評価でsteps 1465 |
| retry / fallback | なし / なし（timeout・OOM・failureでも条件を変えて再実行しない） | G6 |
| child process | RV・評価ごとに新しいchild。Node yieldは `setImmediate`、memory sample間隔250 ms | D2-Cと同じ |

見積もり（事前登録値ではない。成功条件にしない）: RV 約0.5分、B0 / I0 約0.5分、PAIR 6件 約1.5分（D2-Cの評価15 s / 件）、合計約3〜5分。

### 7.4 上限の構造

新しいSearchは無く、評価は8件、child processは9件が上限である。**探索・評価を際限なく続ける規則は無い**。envelopeに達した場合は `not_executed` を記録して
`D2D_INCOMPLETE`（下限evidence）とし、確認できなかったPAIRを非共存・改善不能の証明として扱わない。

### 7.5 途中失敗の扱い

| 状況 | 扱い |
| --- | --- |
| Vの失敗 | childを起動せず終了。`D2D_INVALID`（`input_evidence`） |
| RV1〜RV6不成立、B0 / I0のparity不一致（runnerが登録値と照合）、G1違反、S4 / S5不成立、評価child内のRV1 / RV2不成立、replacement不変条件違反 | runnerは直ちに中止し、残りを `not_executed`（`aborted_after_invalid`）として記録。`D2D_INVALID` |
| RVのunmeasured | B0 / I0 / PAIRを `not_executed`（`rv_unmeasured`）。`D2D_INCOMPLETE` |
| B0のunmeasured | I0 / PAIRは続ける。`D2D_INCOMPLETE` |
| I0のunmeasured | PAIRを `not_executed`（`i0_unmeasured`）。`D2D_INCOMPLETE` |
| PAIRのunmeasured | 後続PAIRは続ける。`D2D_INCOMPLETE` |
| analyzerだけが検出する不一致（決定性、証拠整合） | runnerは中止しない。analyzerが `D2D_INVALID` |

## 8. 事前登録条件: parity・決定性・既知結果との比較

parity状態はD2-C-A §9と同じ4状態（`matched` / `mismatched` / `not_checked` / `not_applicable`）で、比較可能な結果の定義も同じである。`mismatched` は `D2D_INVALID`、
`not_checked` は `D2D_INCOMPLETE` に含まれる。analyzerはrecordから独立に再計算し、runner / childの自己申告をそのまま使わない。
`inputDigest` / `resultDigest` はD1-A §9.4と同じ定義・同じ関数で計算する。

### 8.1 parity

| 検査 | kind | 比較対象・期待値 | `mismatched` | `not_checked` | category |
| --- | --- | --- | --- | --- | --- |
| B0 | `baseline` | D2-C RESULT `evaluations[B0]`（= D2 B0）: `inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`、status `evaluated`、`exhausted`、20 / 43、Conflict 21、steps 1465。Phase 2-C2 RESULT `baseline.summary`（D1-A §5.1の項目）とも一致すること | 比較可能な結果が異なる（`calculation_error` を含む） | B0が未計測 | `baseline_parity_mismatch` |
| I0 | `d2c_final` | §4.3の期待値（D2-C `CMP-t10-c1`） | いずれかが異なる（`preflight_refused`、`planner_rerun_bound_reached`、`calculation_error` を含む） | I0が未計測 | `d2c_parity` |
| RV K1 reservation | `d2c_context` | §1.6の4 CTX recordの `reservationDigest` / `reservationBody` と、RV6の導出値 | digestまたはbodyが異なる | RVが未計測 | `d2c_parity` |
| PAIRの入力 | `registered_input` | §3.2の `inputDigest`（評価childが記録した値） | 異なる | 当該PAIRが未計測・`not_executed` | `guardrail` |

### 8.2 決定性

| 検査 | kind | 対象 | `mismatched` | `not_checked` | category |
| --- | --- | --- | --- | --- | --- |
| D2-D内 | `determinism_d2d` | `inputDigest` が同じD2-D評価の組（登録上は存在しない。存在すれば不変条件違反として記録する） | 比較可能な結果のstatus・`resultDigest` が異なる | 比較可能な結果が1件以下で残りが未計測 | `determinism` |
| D2 / D2-Cとの照合 | `determinism_prior` | D2-D評価の `inputDigest` がD2 RESULT（86件）・D2-C RESULT（26件）の評価のいずれかと一致するもの。登録上はB0（D2 B0 / D2-C B0）とI0（D2-C `CMP-t10-c1`）だけ。PAIRは§1.8のとおり一致しない | D2-D評価が比較可能な結果を持ち、既存の記録とstatus・`resultDigest` が異なる | D2-D評価が未計測 | `determinism` |

- B0 / I0の照合は§8.1のparityと同じ対象を読むが、別の検査として両方を記録する（D2-C-A §9と同じ）
- 1件でも `mismatched` があれば、他に `not_checked` があっても `D2D_INVALID` である

### 8.3 D2-Cの既知結果との比較（診断。parityではない）

PAIR-1（t05 c1 / t07 c1）とPAIR-4（t05 c2 / t07 c1）は、D2-Cのt05段（`CMP-t05-c1` / `-c2`）と **t10 c1の有無だけ** が異なる集合である（§1.5 / §1.8）。
これらは同じ入力ではないので、digestのparityとしては扱わない。次を診断として記録する。

| 診断 | 内容 |
| --- | --- |
| `d2cKnownComparison[]` | PAIR-1 ↔ D2-C `CMP-t05-c1`、PAIR-4 ↔ D2-C `CMP-t05-c2` の組ごとに: 集合の差（`{ t10: O_t10 → K1 t10 c1 }`）、両者のcompleted / Conflict / steps、R5とfailure reason、t07 `G` のselected・winner、Skill 485の `same_skill_counter`（§1.5のresource identity）の有無、`sameStructuralOutcome`（R5のsatisfied・failure reasonの種類・t07のselected・Skill 485 Conflictの有無がすべて同じ） |

- この比較の一致・不一致はINVALIDにもINCOMPLETEにもしない。D2-Cの結果を新しい評価結果として流用しない（PAIR-1 / PAIR-4は必ずfreshに評価する）
- 依頼時の「t07 c1との組み合わせもD2-Cの既知結果とのparityを確認」は、同じ入力のD2-C評価が存在しないため、この診断比較として登録した（§16）。厳密な再現性の確認は
  I0（`CMP-t10-c1`）とB0のparityが担う

## 9. 事前登録条件: formal validity・provenance（いずれか違反なら `D2D_INVALID`）

### 9.1 入力（V、analyzerも独立に再検証）

D2-Dが読む入力は次に限る。いずれもRepositoryへ追加しない（committed済みを除く）。`.local` 配下のpathはRepository rootからの相対pathである。

| 入力 | 場所 | bytes | SHA-256 | 読み取り範囲 |
| --- | --- | ---: | --- | --- |
| Export（commitしない） | 外部path（引数）`gogma-artian-planner-backup_20260927015837.json` | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | PlannerInput構築、support Entry body |
| D2-C formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2C_RESULT.json` | 1,541,755 | `99860c42e195de7544f5fa6b7032ad68e91950e107003cd2ed03efc86e9fcc68` | allowlist（下記） |
| D2 formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2_RESULT.json` | 4,122,806 | `ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c` | allowlist（下記） |
| D2-B G store 7件 | `.local/d2-formal2.run/{t01-c1, t06-c3, t07-c1, t07-c2, t07-c3, t08-c1, t09-c1}.generated-entry.json` | §1.2 / §1.3 | §1.2 / §1.3（D2 RESULT `sources.d2.generatedEntries` とも一致） | body全体（評価入力） |
| D2-C G store 5件 | `.local/d2c-k1-formal.run/{K1-t00-e396d352-c1, K1-t04-92d87b90-c1, K1-t05-61066e62-c1, K1-t05-61066e62-c2, K1-t10-e396d352-c1}.generated-entry.json` | §1.2 / §1.4 | §1.2 / §1.4（D2-C RESULT `sources.d2c.generatedEntries` とも一致） | body全体（評価入力） |
| D2-C CTX record 4件 | `.local/d2c-k1-formal.run/CTX-{1,5,6,7}.context.json` | §1.6 | §1.6（D2-C RESULT `sources.d2c.contextRecords` とも一致） | `result.{contextId, supportBuildListEntryId, supportBodySha256, reservationBody, reservationDigest, status}` だけ |
| D2-C start attestation・raw | `.local/d2c-k1-formal.run/start-attestation.json`、`.local/PLANNER_GLOBAL_D2C_K1_RAW.json.local` | 27,674 / 136,356 | `a3998ab6…5970` / `a0e10689…8601` | hash照合だけ |
| Phase 2-C2 RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` | 1,195,107 | `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4` | `baseline.summary` だけ |
| D2-C-A文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md` | 104,521 | `edd9a3fbf4095a1577ec4fac670cc7649597d5f8c562d40a859dfe64e71a70a5`（D2-C RESULT `sources.specDocument` と同じ） | hash照合だけ |
| D2-C-B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2CB.md` | 13,983 | `a8fe32851f9fcc27f85cf366c6b539ef6464f6f72572edf836e00162c27ceebe` | hash照合だけ |
| D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B文書 | D2-C RESULT `sources.documents` と同じ | — | 同左 | hash照合だけ |
| 本書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2D_SPEC.md` | — | D2-D-Bのmeasurement HEADでgit objectから計算し、start attestationへ記録する | — |

**D2-C RESULTの読み取りallowlist**:

- `sources`（`specDocument` / `d2.result` / `d2.generatedEntriesUsedByI0` / `phase2c2Result` / `export` / `documents` / `d2c.{raw, attestation, contextRecords, generatedEntries}`）
- `provenance.{formal, measuredHead, analysisHead, runStatus, calculationCodeChangedSinceMeasuredHead, productionChangedFiles, startAttestation.{sha256, verified}}`、`invalidReasons`、
  `decision.case`、`aggregates.evaluations.{unmeasuredByReason, notExecutedByReason}`
- `composition.main.{finalAccepted, finalResultEvaluationId, finalMetrics, steps[label = t05].{stepOutcome, acceptedBefore}}`
- `discovery.targets[label ∈ {t00, t04, t05, t10}].{label, targetWeaponId, currentBuildListEntryId, pool[].{ordinal, contextId, candidateStableKey, keySha256, searchIdentity,
  reservationDigest, contextRecordSha256, requiresSupport, generatedBuildListEntryId, generatedEntry, replacement, r0, reusedExisting}}`
- `contexts[k ∈ {1, 5, 6, 7}].{contextId, k, supportBuildListEntryId, record, supportBodySha256, reservationDigest, status}`
- `evaluations[evaluationId ∈ {B0, CMP-t10-c1, CMP-t05-c1, CMP-t05-c2, ADM-t05-c1, ADM-t05-c2}].{evaluationId, stage, status, inputDigest, resultDigest, generatedEntryIds,
  generatedEntrySha256s, plan.{termination, steps}, conflicts（件数、CMP-t05は各要素の kind / participants / resourceIdentity / selectedBuildListEntryId）, candidates[].{label, selected,
  winnerBuildListEntryId}, r5.{satisfied, failureReasons}, r1r4.R1}`

**D2 RESULTの読み取りallowlist**:

- `sources.{export, d2.generatedEntries（§9.1の7 fileのentryだけ）}`、`provenance.{formal, measuredHead, runStatus}`、`invalidReasons`、`decision.case`
- `discovery.targets[label ∈ {t01, t06, t07, t08, t09}].{label, targetWeaponId, currentBuildListEntryId, pool[].{ordinal, candidateStableKey, keySha256, searchIdentity,
  generatedBuildListEntryId, generatedEntry, replacement, reservationCheck, reusedExisting}}`
- `evaluations[evaluationId ∈ {B0, ADM-t07-c1, ADM-t07-c2, ADM-t07-c3}].{evaluationId, status, inputDigest, resultDigest, r1r4.R1}`

検証条件: D2-C RESULTは `provenance.formal === true`、`measuredHead === analysisHead === 627184363db50ef256f602014b457f05a227861c`、`runStatus === 'completed'`、
`calculationCodeChangedSinceMeasuredHead` が空、Production changed filesが空、`invalidReasons` が空、unmeasured / not_executedが0、`decision.case === 'D2C_EXCEEDS_D2B_MAIN'`、
`startAttestation.verified === true`。D2 RESULTは `provenance.formal === true`、`measuredHead === 6f66c168e9163dab02bb60b2f1dc5b1cfc531e71`、`invalidReasons` が空、
`decision.case === 'D2A_EXCEEDS_D1_INCUMBENT'`。§3.1の導出が§3.2と一致し、§1.8の7つの `inputDigest` を `d1InputDigest()` で再計算して一致すること。

**入力検証の失敗は黙って代替しない**。ファイル不足、SHA-256 / bytes不一致、record間の不整合、§3.1の導出不一致があれば、別ファイル・再計算値・近い値で代替せず、
runnerはchildを1つも起動せずに終了し、analyzerは `D2D_INVALID`（reason category `input_evidence`）を出す。

### 9.2 measurement HEAD・provenance

D2-C-A §10.2をそのまま適用する（読み替え: 本書、§9.1の入力、登録policy = §11の `conditions` に入る登録条件（PAIR表、導出規則、固定7件、手順・gate・選択順・budget・
envelope・decision rule）を `stableStringify()` したもののSHA-256、calculation code digest = D2-D benchmark codeと推移的にimportするResearch計算moduleのSHA-256）。

- measurement HEADを正式計測前にcommitし、Working Tree cleanで計測する。runnerはchild起動前にstart attestation（`wx`、read-only）を書く
- analyzerはattestationをmeasurement HEADのgit objectと照合し、measurement HEADがanalysis HEADのancestorであること、measurement HEAD以降の計算コード変更が `[]`、
  Production source changed files（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）が `[]` であることを確認する
- **計算コード変更後の結果流用禁止**: measurement HEAD以降に計算コードが変わった場合、そのrunを正式結果として使わない。再計測は新しいmeasurement HEADで最初から
  （V → RV → B0 → I0 → PAIR）やり直し、部分的なrecordの再利用・merge・継ぎ足しをしない。異なるmeasurement HEADの結果を混在させない
- 正式計測後に本書の意味論（PAIR、規則、上限、decision）を変更しない。変更が必要になった場合は、本書の改訂を記録し、改訂後の新しいmeasurement HEADから全段階を再計測する
- CalculationContextが `{ 'unknown-initial', 4, 'production-rng:c5-e7', 17 }`、`PRODUCTION_RNG_ENGINE_VERSION === 'production-rng:c5-e7'` であること。D2-D-B開始時点で
  これらが動いていた場合は、D2-Dを実行せず本書の再登録を先に行う
- smoke（非formal確認）はformal run dirと別に行い、formal evidenceにしない。smokeの結果で条件を変えない

### 9.3 guardrail検査

- G1: すべての評価runで `conflictResolutions` 0件、preflightのfixed constraint 0件。support Entryを含め、resolution / scenario resolution / repair lineage /
  `selectedBuildListEntryId` を作らない（testでも確認）
- oracle isolation: runner / child / analyzerは、oracle module（`plannerGlobalOracle1657*`）・Phase B analysis module・population-authority moduleを推移的にimportしない
  （testでimport closureを検査）。D2 / D2-C RESULTはallowlistのfieldだけを読む
- D2-D-B sourceにTarget ID / Entry ID / stable keyを書かない（testで検査）。§9.1のfile名・SHA-256、§3.2 / §4.3 / §8.1の登録digestは登録値として置いてよい。
  PAIR表（Entry ID・support）は§3.1の導出をVで再実行して得て、§3.2の登録値は照合にだけ使う
- 登録された順序（§4.1）・評価（§3.2）以外の評価が無い（retry、再実行、追加評価、順序違反、件数違反なし）。child process数 = 実行したRV + 評価の数
- Search（`visitPlannerAlternativeCandidates()` など）、materializer、discovery unitを呼ばない（testでimport・呼び出しを検査）
- analyzerは記録済みの結果から§5のR5、pairCoexistence、gate、improved、選択順を再実行し、記録と一致することを確認する
- RV1〜RV6・S4 / S5の再照合（§6）。analyzerもCTX recordの `reservationBody` をJSONオブジェクトとして読み、比較は両辺オブジェクトの `stableStringify()` 一致、digestとの比較は文字列一致で行う
- Phase B / D1 / D2 / D2-Cのmoduleとformal RESULT・record・G store・CTX recordを変更しない（D2-D-Bは新しいmoduleからimportして使う）

### 9.4 run dir・file名

| 用途 | 名前（推奨。D2-D-Bで変えてよいが、既存名と衝突させない） |
| --- | --- |
| formal run dir | `.local/d2d-pair-formal.run/` |
| raw | `.local/PLANNER_GLOBAL_D2D_PAIR_RAW.json.local` |
| smoke | `.local/d2d-pair-smoke/` |
| RESULT（committed） | `docs/PLANNER_GLOBAL_D2D_RESULT.json` |
| RV record | `<run dir>/RV.record.json` |
| 評価record | `<run dir>/<評価ID>.record.json` |

既存の `PLANNER_GLOBAL_PHASE2C25D2D_*`（`docs/` と `.local/`）、`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25D2D.md`、`plannerGlobalPhase2C25D2D*` はPhase 2-C2.5-D2-Dの
成果物であり、D2-Dとは無関係である。読まない、再利用しない、変更しない。D2-B / D2-Cのrun dirは読み取り専用で、D2-Dのfileを書き込まない。

### 9.5 証拠の欠損・破損

D2-A §8.4（raw / RESULT整合）・§8.5（未計測と証拠の欠損・破損の区別）をそのまま適用する。RV record、評価record、入力のG store・CTX recordのいずれかが、
process outcome completedなのに存在しない、SHA-256 / bytesがjournal・raw・RESULTの `sources` と一致しない、必須fieldが欠ける、CTX recordの `reservationBody` が
JSONオブジェクトでない場合は `D2D_INVALID`（`evidence_integrity`）であり、未計測に読み替えない。

## 10. 事前登録条件: decision（上から順に判定）

### 10.1 比較基準（固定）

| 基準 | completed / 43 | Conflict | steps | 出典 |
| --- | ---: | ---: | ---: | --- |
| baseline（B0） | 20 | 21 | 1465 | D2-C RESULT `B0`（D2-DのB0もparityで一致を要求） |
| D2-B主軸 | 22 | 20 | 1465 | D2-C RESULT `I0`（読み取り専用の参照値。D2-Dでは評価しない） |
| **D2-C最終（I0）** | **23** | **20** | **1465** | D2-C RESULT `CMP-t10-c1`（D2-DのI0もparityで一致を要求し、gate・比較にはI0の実行結果を使う） |

### 10.2 decision（`decision.case`）

| decision | 条件 |
| --- | --- |
| `D2D_INVALID` | §6 / §8 / §9のformal validityに1件でも違反。parity `mismatched` を含む。reason category: `input_evidence` / `provenance` / `baseline_parity_mismatch` / `d2c_parity` / `guardrail` / `determinism` / `evidence_integrity` / `raw_result_mismatch` |
| `D2D_INCOMPLETE` | invalid 0、かつ登録・policy-requiredなRV / B0 / I0 / PAIRのいずれかがunmeasuredまたは `not_executed`。parity `not_checked` はこの未計測が原因なのでここに含まれる |
| `D2D_GLOBAL_COMPLETE_R` | invalid 0、unmeasured 0、いずれかのPAIRがR6を満たす |
| `D2D_EXCEEDS_D2C_FINAL` | 上記以外で、improvedなPAIR（§5.4）が1件以上ある |
| `D2D_SET_COEXISTENT_NOT_BETTER` | 上記以外で、R5成立のPAIRが1件以上ある（gate不成立、またはcompleted 23でConflict ≥ 20） |
| `D2D_NO_SET_COEXISTENCE` | invalid 0、unmeasured 0、6 PAIRすべてがmeasuredでR5不成立 |

- 改善 / 改善なしの区分: `D2D_GLOBAL_COMPLETE_R` と `D2D_EXCEEDS_D2C_FINAL` が「改善」、`D2D_SET_COEXISTENT_NOT_BETTER` と `D2D_NO_SET_COEXISTENCE` が「D2-C最終からの改善なし」である。
  判定順は INVALID → INCOMPLETE → 改善 → 改善なし で変えない
- decisionには修飾fieldを必ず付ける: `bestEligiblePair`、`bestImprovedPair`、`r5SatisfiedPairs[]`、`eligiblePairs[]`、`improvedPairs[]`、`r5OnlyEligiblePairs[]`、
  `equalMetricsPairs[]`、`conflictIncreasedPairs[]`、`pairCoexistencePairs[]`（§5.2）、`pairCoexistentButSetNotCoexistentPairs[]`、`boundLimitedEvaluations[]`、
  `unmeasuredEvaluations[]`、`vsBaseline` / `vsD2bMain` / `vsD2cFinal`（best PAIRまたはI0のcompleted / Conflict / stepsの差）
- **t05とt07の共存（`pairCoexistencePairs`、R5成立）と全体指標の改善（`improvedPairs`）は別fieldに記録し、一方から他方を推論しない**
- `D2D_INCOMPLETE` でも、measuredだった評価の結果、R5 / improved / R6到達の有無を **下限のevidence** として記録する
  （`globalCompleteObservedUnderIncomplete`、`exceedsD2cObservedUnderIncomplete`、`setCoexistenceObservedUnderIncomplete`）
- 通常の非共存（`evaluated` でR5不成立、gate不成立、`preflight_refused`、bound-limited、support失効・非selected）はmeasuredであり、INVALIDにもINCOMPLETEにもしない
- 正常に計測された結果の不一致は `D2D_INVALID`、測定できなかったための未確認は `D2D_INCOMPLETE` であり、未確認を不一致にも一致にも読み替えない

## 11. 事前登録条件: RESULT schema（D2-D-Bで固定する必須field）

D2-D-Bのanalyzerは `docs/PLANNER_GLOBAL_D2D_RESULT.json`（committed）を出力する。raw（`.local`、commitしない）とrun dir（RV record、評価record、start attestation）は
Repositoryへ追加しない。次のfieldは必須で、意味を変えない（追加fieldは可）。

```text
phase                      "Issue #154 D2-D: local two-Target recomposition of existing Candidates (post-hoc analysis)"
analyzedAt
sources
  specDocument             { file, sha256 }                        本書（measurement HEADのgit object）
  d2c                      { result, attestation, raw, generatedEntriesUsed[5], contextRecordsUsed[4] }   各 { file, bytes, sha256 }
  d2                       { result, generatedEntriesUsed[7] }    各 { file, bytes, sha256 }
  phase2c2Result           { file, sha256 }
  export                   { file, bytes, sha256, committed: false }
  documents                D2-C-A / D2-C-B / D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B { file, sha256 }
  d2d                      { raw, runDir, attestation, rvRecord, records[] } 各 { file, bytes, sha256 }
provenance
  formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256（calculation code digest）, registeredPolicySha256,
  calculationCodeChangedSinceMeasuredHead: [], productionChangedFiles { toMeasuredHead: [], toAnalysisHead: [] },
  startAttestation { sha256, verified, issues, body },
  d2cMeasuredHead, d2MeasuredHead,
  oracleReadByRunner: false, oracleReadByChild: false, oracleReadByAnalyzer: false,
  d2cResultFieldsRead: [allowlist], d2ResultFieldsRead: [allowlist], contextRecordFieldsRead,
  d2cResultModified: false, d2ResultModified: false, priorEvidenceReusedAsResult: false,
  oracleGuidedTargetPopulation: true, newSearchInD2D: false, newCandidateDiscoveryInD2D: false, newAdmissionInD2D: false,
  speculativeSupportWrittenAsResolution: false, alternativeToAlternativeSupport: false, productionSemanticsChanged: false
environment                runtime, node, v8, platform, cpu, logicalCpuCount, totalMemoryBytes, rngEngineVersion, calculationContext, appliedExecutionEnvelope, machine
conditions                 fixedCandidates（§1.2のt07以外7件）, t07Candidates（§1.3）, t05Candidates（§1.4）, pairs（§3.2）, derivationRule（§3.1）, order（§4.1）,
                           i0Rule（§4.3）, pairRule（§4.4）, r5Definition（§5.1）, pairCoexistenceDefinition（§5.2）, gate（§5.3）, betterRule / improvedRule / selectionOrder（§5.4）,
                           r6Definition（§5.6）, rvChecks（RV1〜RV6）, supportChecks（S1〜S5）, supportExpiryCauses, budgets（§7.2）, executionEnvelope（§7.3）,
                           researchMaxPlanSteps, evaluationFullRunCap: 8, decisionRule（§10、文字列配列）, comparisonBaselines（§10.1）, notRun
inputValidation            { passed, issues[], derivedPairs[] { pairOrdinal, evaluationId, t05Ordinal, t07Ordinal, generatedBuildListEntryIds[], generatedEntrySha256s[], requiresSupport[], inputDigest } }
rv                         { status, unmeasuredReason, process, record { file, bytes, sha256 },
                             candidates[12] { label, ordinal, origin: d2b_k0 | d2c_k1, contextId | null, generatedBuildListEntryId, generatedEntry { file, bytes, sha256 },
                                              RV1 { bodySha256Matched, idMatched, targetMatched, calculationContextMatched, notStale, searchRunIdMatched, keySha256Matched },
                                              RV2 { status, replacedBuildListEntryId }, RV3 { reservationSource: k0_empty | ctx_record, reservationDigest, matched },
                                              RV4 { respects, blockedHits, exclusiveHit }, satisfied },
                             supports[3] { supportBuildListEntryId, contextRecords[], RV5 { expected, observed, matched },
                                           RV6 { digestExpected, digestObserved, digestMatched, bodyMatched, satisfied } },
                             satisfied }
evaluations[]              D1-A §8 / D2-C-A §12の `evaluations[]` の全fieldに加えて
                           { stage: B0 | I0 | PAIR, pairOrdinal, t05Ordinal, t07Ordinal,
                             registeredInputDigest, inputDigestMatched,
                             rejectedBuildListEntries[] { buildListEntryId, reason }, resourceConflictRejections, selectedTargetWeaponIds[],
                             conflicts[] { id, kind, participants[], resourceIdentity, selectedBuildListEntryId, withinSet: boolean },
                             referenceDiff { referenceEvaluationId: 'I0', completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] } | null,
                             baselineDiff { completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] } | null,
                             r5 { judged, conditions, satisfied, failureReasons[] },
                             pair { t05 { generatedBuildListEntryId, selected, winnerBuildListEntryId, targetSelected },
                                    t07 { generatedBuildListEntryId, selected, winnerBuildListEntryId, targetSelected },
                                    conflictsBetweenPair[], conflictsWithPair[], pairCoexistence, d2cT05ResourcesObserved[] } | null,
                             gate { judged, referenceCompleted, proposedCompleted, satisfied }, r5OnlyEligible, eligible, improved, equalMetrics, conflictIncreased,
                             supportChecksByEntry { [s]: { contextId, S1, S2, S3, S4, S5 { digestExpected, digestObserved, digestMatched, bodyExpected, bodyObserved, bodyMatched, satisfied },
                                                          selected, supportExpiryCause | null } },
                             r6 { judged, conditions, satisfied },
                             priorParity { state, matchedPriorEvaluationIds[], resultDigestsEqual, notChecked } }
parityChecks[]             { checkId, kind: baseline | d2c_final | d2c_context | registered_input | determinism_d2d | determinism_prior,
                             state: matched | mismatched | not_checked | not_applicable, subjects[], expected, observed, mismatches[],
                             notChecked { dependsOn[] { id, status, unmeasuredReason, notExecutedReason } } | null, category }
d2cKnownComparison[]       { pairEvaluationId, d2cEvaluationId, setDifference, d2d { completed, conflicts, steps, r5Satisfied, failureReasons[], t07Selected, skill485Conflict },
                             d2c { 同左 }, sameStructuralOutcome }   診断（§8.3）
pairs
  ranking[]                { pairOrdinal, evaluationId, eligible, improved, completed, conflicts, steps, rank | null }
  bestEligiblePair, bestImprovedPair
comparison
  vsBaseline / vsD2bMain / vsD2cFinal   { subjectEvaluationId, completedDelta, conflictDelta, stepsDelta, better: boolean, equalMetrics: boolean }
  byPair[6]                { evaluationId, vsI0 { completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] }, pairCoexistence, r5Satisfied, improved }
aggregates
  evaluations              { registeredMax: 8, executed, measured, unmeasuredByReason, notExecutedByReason, byStage, byStatus }
  childProcesses           { registeredMax: 9, started }
  fullPlannerRunsStarted   合計（評価リクエスト数とは別）
  runtimeUnsupportedRetries
  r5                       { judged, satisfied }
  pairCoexistence          { judged, satisfied }
  r6                       { judged, satisfied, satisfiedEvaluationIds[] }
  boundLimitedEvaluations[]
  supportOutcomes          { notSelected, expiredByCause }
  determinismCrossChecks[] { inputDigest, evaluationIds[], priorEvaluationIds[], comparableEvaluationIds[], state, resultDigestsEqual }
  parity                   { byKindAndState, mismatched[], notChecked[] }
  timing                   { rvWallMs, evaluationWallMs, runWallMs, runEnvelopeReached }
  memory                   { peakHeapBytes, peakRssBytes }
invalidReasons[]           { category, detail }
decision                   { case, reasons[], lowerBound: boolean, bestEligiblePair, bestImprovedPair, r5SatisfiedPairs[], eligiblePairs[], improvedPairs[],
                             r5OnlyEligiblePairs[], equalMetricsPairs[], conflictIncreasedPairs[], pairCoexistencePairs[], pairCoexistentButSetNotCoexistentPairs[],
                             boundLimitedEvaluations[], unmeasuredEvaluations[], vsBaseline, vsD2bMain, vsD2cFinal,
                             globalCompleteObservedUnderIncomplete, exceedsD2cObservedUnderIncomplete, setCoexistenceObservedUnderIncomplete }
```

## 12. 事前登録条件: 言えること・言えないこと

### 12.1 decisionごと

- `D2D_GLOBAL_COMPLETE_R`: このExport・登録6組・Research envelopeで、D2-C最終集合のt07差替えとt05追加により、43 / 43、Conflict 0、`resource_conflict` 0、
  Trace Replay成功のPlanに到達した。Production runtimeとしての許容、別Export・別populationへの一般化、Production semanticsとしての妥当性（REQUIREMENTS 23の契約変更が先）は言えない
- `D2D_EXCEEDS_D2C_FINAL`: 既存Candidateだけによる局所2-Target再合成で、D2-C最終（23 / 20）より良い完成・Conflictの置換集合を得た。R6には達していない
- `D2D_SET_COEXISTENT_NOT_BETTER`: t05とt07を含む置換集合はR5を満たしたが、全体のcompleted・ConflictはD2-C最終より良くならなかった（後退したか、同等だった）
- `D2D_NO_SET_COEXISTENCE`: **他のCandidateや別の組み合わせで解消できないことの証明ではない**。言えるのは「登録した6組（t05 K1 2件 × t07 K0 3件、他の7件はD2-C最終のまま）の
  1 run評価では、置換集合としてR5を満たす組は無かった」ことだけである
- `D2D_INCOMPLETE`: measuredな範囲の結果は下限であり、「unmeasuredが無ければ同じ結果だった」とは主張しない。未計測のPAIRが非共存である・改善しないとは主張しない

### 12.2 共通

- 6組すべてでR5不成立でも、**t05とt07の衝突が解消できないとは結論づけない**。未評価のもの: t07 / t05の3件目以降・別supportのCandidate、t07以外の受理済みTargetの差替え、
  t04 / t10の同値置換を外した集合、3 Target以上の同時変更、別の合成順・複数pass、新しいSearch
- `pairCoexistence` が真であることは、t05とt07のCandidateがその1 runで同時にselectedになり互いのConflictが無かったことだけを示す。置換集合全体の共存（R5）や改善を示さない
- R5成立は、置換集合としての共存（全 `G` とその前提supportの同時selected、support依存の有効性、集合内Conflictなし）だけを示し、集合外Targetの完成やConflict 0を示さない。
  **R5成立をIssue #154の最終Acceptance（R6）と混同しない**
- PAIR-1 / PAIR-4とD2-Cの既知結果の比較（§8.3）は診断であり、一致しても不一致でもD2-Cの結論を書き換えない
- I-D2D-1〜4（§1.10）は予想であり、結果がどうであっても一般化しない
- E1由来の対象Target（t05 / t07）はoracle-informedなpopulationの部分集合であり（`oracleGuidedTargetPopulation = true`）、別populationへの一般化は主張しない

## 13. 既存API（D2-D-Bで使う部品。Production変更なし）と新規に必要なResearch処理

### 13.1 再利用する既存部品

| 用途 | 既存の部品（module） |
| --- | --- |
| baseline PlannerInputとResearch依存（固定ID Factory、定数Clock） | `globalResearchInputFromExport(Export, 20000)` / `globalResearchDependencies(engine)`（`src/benchmarks/plannerGlobalOptimizationResearch.ts`） |
| 評価run（I0 / PAIR） | D2-Cの `runD2CEvaluation()`（`src/benchmarks/plannerGlobalD2C.ts`。S4のSHA-256部分を検査し、変更しない `runD2Evaluation()` を呼ぶ）。stageはI0と同じく `replacement_set` を1 runで評価し `found_R` 診断を持たない手順（`d2cRunnerStage('I0') = 'Z0'` と同じ）。`D2CReplacementTask` にK0は `requiresSupport = []` / `contextId = null` / support値null、K1はCTX recordの値を入れる |
| B0 | `runD2CEvaluation()` のB0（`{ kind: 'persisted' }`）と同じ手順 |
| digest・R5・差分 | D1の `d1InputDigest()` / `d1ResultDigest()` / `judgeD1R5()` / `d1B0Parity()` / `d1TrialRunSummary()` / `d1RuntimeUnsupportedRemoved()` / `isD1BoundLimited()`、D2の `d2R1R4()`（使わない）/ `judgeD2R6()` |
| support失効原因 | `d2cSupportExpiryCause()` |
| CTX recordの読込 | `readD2CContextRecord()`（`reservationBody` がJSONオブジェクトであることの確認を含む） |
| K0 Search当時のreservation（RV3） | `derivePhase2C26B2C1Schedule()` + `phase2c27bResolveSupportContext(input, dependencies, targetWeaponId, [])`（D2-BのK0と同じ経路） |
| support reservation（RV6 / S5） | `derivePlannerAlternativeReservation([support], engine)`（`src/domain/planner/alternative/plannerAlternativeReservation.ts`） |
| R0（RV4） | `summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`（`plannerGlobalPhase2C2.ts`） |
| replacement（RV2） | `resolveBuildListEntryReplacement()` |
| Candidate identity（RV1） | `candidateStableKey()` |
| provenance | `d2cProductionChangedFiles`（= `d2ProductionChangedFiles`）、`verifyD2CStartAttestation()` の構造、start attestationの `wx` / read-only手順 |
| hash | `hashStableValue()`、`stableStringify()` |

### 13.2 D2-D-Bで新規に必要なResearch処理（D2-D moduleに置く）

| 処理 | 内容 |
| --- | --- |
| 登録条件・policy | §3.2のPAIR表（照合用）、§1.8の登録 `inputDigest`、budget、envelope（run 4時間、評価30分、RV 10分）、decision rule、`d2dRegisteredConditions()` と登録policy SHA-256 |
| V | D2-C / D2 RESULTのallowlist projection（D2-Cの `projectD2CD2Result()` はD2 RESULT用なので、D2-C RESULT用のprojectionを新規に作る）、§3.1の導出、G store 12件・CTX record 4件の照合、§1.8の再計算 |
| RV unit | §6.1のRV1〜RV6（1 child、Search・full runなし） |
| 評価task構築 | Fixed 7件 + (t05, t07) の `D2CReplacementTask[]`（Target ID昇順）。K1の各taskへ対応するCTX recordの値を入れる |
| 評価child内の再確認 | full run前のRV1（body SHA-256・id・targetWeaponId）/ RV2 |
| 判定 | §5.2のpairCoexistence、§5.3〜§5.4のgate・improved・選択順、`d2cKnownComparison`（§8.3） |
| parity | `d2c_final`（D2-Cの `d2cI0Parity()` と同じ比較を期待値 `CMP-t10-c1` で行う）、`d2c_context`、`registered_input`、`determinism_d2d` / `determinism_prior` |
| decision | §10.2（`D2D_*`） |
| runner / analyzer | `scripts/run-planner-global-d2d.mjs`（親 + `rv` / `evaluate` child、journal、abort、4時間run envelope）、`scripts/analyze-planner-global-d2d.mjs` |

- 実装名の推奨（D2-D-Bで変えてよい）: `src/benchmarks/plannerGlobalD2D.ts`、`src/benchmarks/plannerGlobalD2DAnalysis.ts`、`src/benchmarks/plannerGlobalD2D.test.ts`。
  既存の `plannerGlobalPhase2C25D2D*` と混同しない名前にする
- D2-Cの `D2CEvaluationTask.stage`（`B0` / `I0` / `ADM` / `CMP`）に `PAIR` は無い。PAIRをD2-C moduleへ追加せず、D2-D moduleで `stage = 'I0'` 相当の手順（`replacement_set`、
  `found_R` なし）としてtaskを組み立てるか、D2-D側で同じ手順のwrapperを持つ。いずれの場合もRESULTの `stage` は `PAIR` と記録する。D2 / D2-C / D1 / Phase Bのmoduleは変更しない
- 既存部品で本書の規則を表現できないことが分かった場合は、別の判定を発明せず、本書の更新（docs）を先に行う

## 14. guardrail（D2-C-A G29〜G36に追加）

| ID | guardrail |
| --- | --- |
| G37 | D2-Dは新しいSearch・Candidate discovery・materialization・CTX作成・ADMを行わない。評価に使う生成Entryは§1.2〜§1.4の12件のG store bodyだけである |
| G38 | 評価組は§3.2の6組だけであり、結果を見て組を増減・置換しない。PAIRの結果を受けた追加の評価・合成をしない |
| G39 | t05の追加とt07の差替えは1つのPlannerInputで同時に行い、固定7件を変更・除外しない。各Targetの生成Entryは高々1件 |
| G40 | D2-B / D2-CのRESULT・G store・CTX record・評価recordは入力evidenceとparity期待値・診断比較としてだけ使い、D2-Dの集合評価の実行結果として流用しない（I0とPAIR-1 / PAIR-4もfreshに評価する） |
| G41 | R5（置換集合の共存）、pairCoexistence（t05 / t07の局所共存）、improved（D2-C最終より良い）、R6（Issue #154の最終Acceptance）を別々に記録し、互いに読み替えない |
| G42 | K0 CandidateにsupportやK1のreservationを付け足さない。Search当時のreservation（K0はempty、K1はCTX record）だけをRV3 / RV4の基準にする |
| G43 | timeout / OOM / `not_executed` / bound-limitedを、非共存・改善不能の証明として扱わない |

Issue #154はCloseしない。

## 15. 未決事項（D2-Dの外、またはD2-D-B以降）

D2-Dの判定に必要な意味論は本書で確定した。次はD2-Dの外の事項である。

1. D2-D-Bの実装名（module / script / field綴り）。§11の必須fieldの意味と§10の判定順序は変えない
2. D2-Dの結果を新しい起点にした後続合成（最良PAIRへの他Targetの追加、複数pass、合成順の変更）。D2-Dでは行わない
3. t04 / t10の同値置換を外した集合を起点にする別axis
4. t03（2 supportを同時に置くK2 context）、t02（L2より広いextent、別support）の探索
5. t05 / t07の3件目以降のCandidate、別supportのt05 Candidate、t07のK1 Candidate
6. 3 Target以上を同時に変更する局所探索と、その組み合わせ数の上限
7. population拡大（baseline未完成23 Target、43全体）、E2、residual 3
8. Production化に伴うREQUIREMENTS 23の契約変更の要否（follow-up §10）

## 16. D2-C-A / 依頼時の基本案からの変更・追加点

| # | D2-C-A（または依頼時の基本案） | 本書で正式に採用する条件 | 理由 |
| --- | --- | --- | --- |
| 1 | discovery（CTX / DSC）+ ADM + CMPの単一pass | discovery・ADMなし。§3.2の6組を独立に1 runずつ評価（PAIR） | 既存Candidateの局所再合成だけを測るため |
| 2 | 合成の起点はD2-B主軸受理集合（I0） | D2-C最終受理集合（8件）をI0としてfresh再評価 | D2-C最終からの改善を測るため |
| 3 | 受理済みTargetを置換・再評価しない | t07だけを、D2-Bで発見済みの3件の範囲で差し替える | t05との衝突の当事者がt07であり（§1.5）、そのTargetだけに範囲を限定するため |
| 4 | 1回のPlannerInputに置換1件を追加 | t05の追加とt07の差替えを同じPlannerInputで同時に行う（2 Target同時変更） | 単調追加ではt07 c1との衝突が既知であるため |
| 5 | 基本案の順序 V → B0 → I0 → PAIR | V → **RV** → B0 → I0 → PAIR | Search当時のreservationとsupport依存の維持を、全12 Candidateについて評価前に1回で検証するため。RVは評価に数えない |
| 6 | 基本案「t07 c1との組み合わせもD2-Cの既知結果とのparityを確認」 | PAIR-1 / PAIR-4はfreshに評価し、D2-C `CMP-t05-c1` / `-c2` との比較は診断（§8.3）。厳密なparityはI0（= `CMP-t10-c1`）とB0で行う | D2-Cのt05段の集合にはt10 c1が無く、同じ入力のD2-C評価が存在しないため（§1.8） |
| 7 | gate・選択順の基準はI0（22 / 20） | 基準はD2-D-BのI0（D2-C最終、23 / 20） | 依頼どおり非後退gateをD2-C最終の23件にするため |
| 8 | decision `D2C_*` | `D2D_*`。改善（R6、D2-C最終より良い）と改善なし（R5成立あり / なし）を区別し、t05 / t07の局所共存を別fieldに記録 | 共存と全体改善を別々に記録するため |
| 9 | run envelope 12時間、discovery envelope 9時間 | run envelope 4時間、discoveryなし | 評価8件・Searchなしで、D2-Cの実測（評価最大15.3 s）に照らして十分なため |

## 17. validation

- `git diff --check`
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無い。結果はPRに記載）
