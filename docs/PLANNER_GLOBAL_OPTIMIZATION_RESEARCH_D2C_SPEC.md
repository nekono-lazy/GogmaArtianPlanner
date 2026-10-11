# Global Planner Research D2-C（阻害Entry由来の限定K1探索と集合評価の事前登録）

Refs #154。**docs-only**。基準main: PR #226 merged `3b9ae214a88dcf0364cf964e779202a3b5dac060`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなし、worktreeは1件だけ、実行中のResearch processなし、D2-B formal evidence（`.local/d2-formal2.run/`）のSHA-256一致を確認）。

本書は [D2-A](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md) §13.2で「今回は無効」とした **限定K1探索（follow-up §7.2のC2）** の実行条件を、
[D2-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2B.md)の正式RESULT（`docs/PLANNER_GLOBAL_D2_RESULT.json`）から導出した阻害Entryをsupportとして、
実装・計測より前に確定する事前登録である。本書ではResearch項目名を **D2-C**、本書による事前登録を **D2-C-A**、実装と正式計測を **D2-C-B** と呼ぶ。
D2-A / D2-B（K0先行）、D1、Phase 2-C2.7-C（Production compatible architecture設計）、Phase 2-C2.5-D2-C（`PLANNER_GLOBAL_PHASE2C25D2C_*`、
`.local/d2c-smoke1/`）とは別のResearch項目であり、名称・file・run dirを混同しない（§10.4）。

本PRで変更していないもの: Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default / bounds、
既存formal RESULT（Phase B / D1 / D2を含む）、既存Research文書（Research索引へのリンク追加を除く）、既存Research runner / analyzer / module、
正式仕様の意味論。新規Search run、Candidate delivery、reservation導出、full Planner run、formal measurement、RESULT JSON生成、oracle読み取りは行っていない。
§1の値は、既存committed RESULT、既存 `.local` record / task / G store、既存文書のSHA-256照合と、読み取り・数え上げだけで得た。

本書の各節は次の4種類のどれかであり、見出しに明記する。

| 種類 | 意味 | 節 |
| --- | --- | --- |
| **事実** | D2-B / Phase B / D1の既存formal RESULT・record・文書から読み取った値（本書で新しく計算・計測していない） | §1 |
| **事前登録条件** | D2-C-Bが変えてはならない実行条件・判定規則 | §2〜§13、§15、§17 |
| **既存API** | D2-C-Bが使う既存の部品（Production変更なし） | §14 |
| **未決事項** | D2-Cの外、またはD2-C-B以降に決めること | §16 |

## 0. 位置づけとauthority

本書はResearch文書であり、正式仕様ではない。authorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md`（23 / 23.1）→ `docs/PLANNER_SPEC.md`
（9.2.3.1、9.2.18、9.2.19）/ `docs/SEARCH_SPEC.md`（5.6.8）→ その他の正式文書 → 実装 → test → Research文書である。D2-CはResearch-onlyであり、
REQUIREMENTS 23（明示的な選択が無い競合について自動で再検索しない）、Planner Alternative（9.2.19.1〜9.2.19.16）、RNG、Search、UI、Persistence、
schema / version、Production defaultの意味論を変更しない。support Entryから導出するreservationと集合評価はResearch harnessの中だけのものであり、
Productionの動作（9.2.19.3のuser-fixed Route reservation）ではない。

Research authorityの順位（D2-Cの中で矛盾があれば上を優先し、矛盾は報告してD2-C-Bを止める）:

1. 本書（D2-C-A事前登録）
2. D2-A（§2.3 discovery unitの型付きoutcome、§3 R1、§4 合成・§4.2 gate・§4.3 選択順、§6.2 status、§7.3 parity状態、§8 formal validity、§9.1「より良い」の定義、
   §17 S5改訂）。本書が変更・追加した点は§17に列挙する
3. D1-A（§4.1 入力構成、§4.2 記録、§4.3 Conflict resource identity、§4.4 R5、§4.5 support依存S1〜S5、§6.2 評価status、§9.4 決定性digest）
4. follow-up（§4.3 R0〜R6・`evaluatedAgainst`、§5 support、§6 発見と採用の分離、§7.2 C2、§9.3 G13〜G18）
5. Phase A（§2 G1〜G12、§5 ladder、§6.3 typed outcome、§7 budget）、Phase B（§1.3 trial harness、support context）

D2-C-Bは本書の規則だけで判定でき、実装時に意味論を追加決定しなくて済むことを目標とする。実装名（module / 関数 / fieldの綴り）はD2-C-Bで決めてよいが、
§12のRESULT必須fieldの意味と§11の判定順序を変えてはならない。変える必要が生じた場合は、D2-C-Bの正式計測前に本書を更新する（docs PR）。

## 1. 事実（D2-B / Phase B / D1から確認されたこと。本書で再計算していない）

### 1.1 D2-Bの正式結果（`docs/PLANNER_GLOBAL_D2_RESULT.json`、4,122,806 bytes、SHA-256 `ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c`）

| 項目 | 値 | 出典（D2 RESULT） |
| --- | --- | --- |
| formal validity | `provenance.formal = true`、`runStatus = completed`、`invalidReasons = []`、unmeasured 0、not_executed 0、bound-limited 0、run envelope未到達 | `provenance`、`aggregates.evaluations`、`aggregates.timing` |
| provenance | measurement HEAD `6f66c168e9163dab02bb60b2f1dc5b1cfc531e71`、start attestation `8c0843167d2b8037d2c532e2c1646540be29354c3c39f254a125c1da9becd56b`、calculation code digest `40bad5bc…68de`、Production changed files `[]` | `provenance` |
| Baseline（B0） | completed 20 / 43、Conflict 21、steps 1465、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52` | `evaluations[B0]` |
| D1 incumbent（比較値、読み取り専用） | completed 22 / 43、Conflict 21、steps 1465（D1 `A-b`。D2のZ0がinputDigest・resultDigest・R5でmatched） | D2-A §9.1、`seededAxis` |
| D2-B主軸 decision | `D2A_EXCEEDS_D1_INCUMBENT`、`newCandidateAccepted = 2` | `decision` |
| D2-B主軸 final | `CMP-t09-c1`: completed 22 / 43、Conflict 20、steps 1465、termination `exhausted`、`inputDigest fnv1a32:488e42f1`、`resultDigest fnv1a32:21e8e8b5`、R5成立、gate成立、`fullRunsStarted = 1` | `composition.main`、`evaluations[CMP-t09-c1]` |
| D2-B主軸の受理集合 | t01 c1 / t06 c3 / t07 c1 / t08 c1 / t09 c1（すべてK0、`requiresSupport = []`） | `composition.main.finalAccepted` |
| 主軸で不受理 | t00 / t02 / t03 / t04 / t05 / t10（6 Targetすべて `not_replaced_no_eligible`） | `composition.main.steps[].stepOutcome` |
| K0 Candidate | pool 32件（t02のみ2件、他10 Targetは3件）、discovery unit 26 / 33 | `discovery`、`aggregates.discovery` |
| ADM | 32件すべて `evaluated`、R1成立 32 / 32 | `evaluations[stage = ADM].r1r4.R1` |
| R6 | 判定53件、成立0 | `aggregates.r6` |
| 所要 | discovery child wall合計405 s、評価wall合計1,074 s、run全体1,479 s、child heap最大1.10 GB、RSS最大1.48 GB | `aggregates.timing` / `memory` |

D2-B主軸の受理集合のG store（D2-B run dir `.local/d2-formal2.run/`。bytes・SHA-256はD2 RESULT `sources.d2.generatedEntries` と一致し、
`CMP-t09-c1.generatedEntrySha256s` と同じ。本書作成時に実ファイルのSHA-256を照合済み）:

| t | ordinal | file | bytes | SHA-256 | generated Entry ID | rung / kind / cost |
| --- | ---: | --- | ---: | --- | --- | --- |
| t01 | 1 | `t01-c1.generated-entry.json` | 66,309 | `3c3f5cc8f98108735da053546fc2939176e8f4050b47854ed31b3f7f6bb48f14` | `build-list.constrained.fnv1a32-174be6b1` | L1 / `existing_gogma_mixed` / 92 |
| t06 | 3 | `t06-c3.generated-entry.json` | 251,042 | `06a928333ceb8a85eb33572268570673a0b082e7e44b31464230fb22bd93c218` | `build-list.constrained.fnv1a32-8b2f6ba7` | L1 / `existing_gogma_mixed` / 388 |
| t07 | 1 | `t07-c1.generated-entry.json` | 170,990 | `27b098e06fbbda5a6991cc897c7cfa4e09ec69cddd45ee583b35fa365ec55e6f` | `build-list.constrained.fnv1a32-0f0b9ba2` | L1 / `existing_gogma_mixed` / 255 |
| t08 | 1 | `t08-c1.generated-entry.json` | 222,523 | `825e8a9eac526d62440b55bdafc21b5f5b8d98b7d00eb5b5dcdb3a80416944cc` | `build-list.constrained.fnv1a32-39482235` | L2 / `existing_gogma_mixed` / 551 |
| t09 | 1 | `t09-c1.generated-entry.json` | 270,975 | `b791b03eed4f44197b9edf13f7dfe086c6cb89899d45b97f5390a225f1ce35bc` | `build-list.constrained.fnv1a32-d4134c84` | L2 / `existing_gogma_mixed` / 491 |

D2-B run dirの他のevidence: raw `.local/PLANNER_GLOBAL_D2_RAW_2.json.local`（328,373 bytes、`c671eb54bb55103e4a0ed87f9c39580bc6e76fea5e32958ea2e129e903689882`）、
start attestation `.local/d2-formal2.run/start-attestation.json`（17,164 bytes、`8c0843167d2b…cd56b`）。いずれもD2 RESULT `sources.d2` と一致した。

### 1.2 不受理6 Targetの阻害Entry（provisional winner）の再集計

D2 RESULTの `evaluations[]` のうち `stage ∈ { ADM, CMP, Z }` で、当該Targetの `candidates[]`（`label === t` の要素、各評価にちょうど1件）を数えた。
対象の評価はすべて `status = evaluated` で、当該Candidateは **全件 `selected = false`、commitment `dropped`、`winnerBuildListEntryId` は全件非null** だった。

| Target | 観測評価（ADM / CMP / Z） | winner（`build-list.fnv1a32-` 以下） | 観測回数 / 観測評価数 |
| --- | --- | --- | --- |
| t00 | 9（3 / 3 / 3） | `e396d352` | 9 / 9 |
| t02 | 6（2 / 2 / 2） | `e396d352` | 6 / 6 |
| t03 | 9（3 / 3 / 3） | `92d87b90` | 6 / 9 |
| t03 | （同上） | `e396d352` | 3 / 9 |
| t04 | 9（3 / 3 / 3） | `92d87b90` | 9 / 9 |
| t05 | 9（3 / 3 / 3） | `61066e62` | 9 / 9 |
| t10 | 9（3 / 3 / 3） | `e396d352` | 9 / 9 |

- 依頼時に提示された集計値（ChatGPTによる集計）と完全に一致した。差異は無い
- t03の内訳はCandidate単位で固定している: c1と c3はADM / CMP / Zの全評価で `92d87b90`、c2は全評価で `e396d352`
- `selected = true` の評価は0件、winnerがnullの評価は0件。winner以外のConflict co-participantも記録されているが、本書ではsupport候補に使わない（§3.1）

### 1.3 support Entryの性質

| support Entry | Target（先頭8桁、出典） | E1外 | B0でselected | D2-B final（`CMP-t09-c1`）でselected | いずれかのE1 Targetの `O_t` | B0でのConflict（kind、participant、resource identity） |
| --- | --- | --- | --- | --- | --- | --- |
| `build-list.fnv1a32-e396d352` | `820831d0`（D1-A §1.3） | yes | true | true | no | `same_gogma_counter` {`628e1ce0`, `e396d352`, `e5bf89b0`} Gogma 77、`same_skill_counter` {`3e076416`, `6aac5fa0`, `798019f2`, `bb36c5ca`, `bbf8125e`, `d142f3e3`, `d952e728`, `e396d352`, `e5bf89b0`, `f21e3361`} Skill 341 |
| `build-list.fnv1a32-92d87b90` | `cbdf9d8f`（D2-A §1.1） | yes | true | true | no | `same_gogma_counter` {`92d87b90`, `985daebb`} Gogma 67、`same_gogma_counter` {`92d87b90`, `dd79ecce`} Gogma 71 |
| `build-list.fnv1a32-61066e62` | `1f121742`（D2-A §1.1） | yes | true | true | no | `same_gogma_counter` {`61066e62`, `dc0c3204`, `df40f28f`} Gogma 144、`same_owned_weapon_consumed` {`61066e62`, `df40f28f`} OwnedWeapon `aec3d2e4-2c1d-4dca-abae-39d648b2c4f0`、`same_gogma_counter` {`0e8ede71`, `61066e62`} Gogma 107 |

- 「E1外」はsupport EntryがD2 RESULT `discovery.targets[].currentBuildListEntryId`（E1 11 Targetの `O_t`）のいずれでもないことで確認した。Target IDがE1 manifest外であることは
  Exportで再確認する（§10.1 V）
- `bb36c5ca` は `O_t00`、`dd79ecce` は `O_t03`、`df40f28f` は `O_t05` である。`61066e62` と `O_t05` は同じOwnedWeapon `aec3d2e4…` を排他消費する
- 対象6 Targetの `O_t` のB0 / D2-B finalでのselected: t02（`32e817d9`）/ t04（`a3d6817e`）/ t10（`66c25e3d`）はtrue / true、t00 / t03 / t05はfalse / false

### 1.4 Phase Bで同じ (Target, support) contextを実行したK1 unit

Phase Bは各Targetでsupport 1件のK1 contextをP1 rank順・rung-majorで実行した。今回のcontextと同じ (Target, support) のunitを、Phase B task file
（`.local/c27b-formal.run/<unitId>.task.json` の `targetIndex` / `cardinality === 1` / `supportBuildListEntryIds`）で引き当て、Phase B RESULT `units[]` の
非oracle field（`result` / `process` / `wallMs` / `search` / `deliveries` / `peakHeapBytes`）を読んだ。

| context（§3.2） | Phase B unit | rank | rung | result | deliveries | wall / searchOnly | heap peak | task `reservationDigest` |
| --- | --- | ---: | --- | --- | ---: | --- | ---: | --- |
| t00 × `e396d352` | `t00-r09-L0` | 9 | L0 | `stopped_by_search_extent_bound` | 0 | 29 s / 23 s | 1.46 GB | `fnv1a32:240e4673` |
| t02 × `e396d352` | `t02-r10-L0` | 10 | L0 | `stopped_by_search_extent_bound` | 0 | 42 s / 35 s | 1.97 GB | `fnv1a32:240e4673` |
| | `t02-r10-L1` | 10 | L1 | `stopped_by_search_extent_bound` | 0 | 59 s / 52 s | 2.63 GB | `fnv1a32:240e4673` |
| t03 × `92d87b90` | `t03-r43-L0` | 43 | L0 | `stopped_by_search_extent_bound` | 0 | 29 s / 23 s | 1.12 GB | `fnv1a32:36a22758` |
| | `t03-r43-L1` | 43 | L1 | `stopped_by_search_extent_bound` | 0 | 73 s / 61 s | 1.25 GB | `fnv1a32:36a22758` |
| t03 × `e396d352` | `t03-r10-L0` | 10 | L0 | `stopped_by_search_extent_bound` | 0 | 49 s / 43 s | 2.02 GB | `fnv1a32:240e4673` |
| | `t03-r10-L1` | 10 | L1 | `stopped_by_search_extent_bound` | 0 | 64 s / 57 s | 2.93 GB | `fnv1a32:240e4673` |
| t04 × `92d87b90` | `t04-r43-L0` | 43 | L0 | `stopped_by_search_extent_bound` | 0 | 25 s / 18 s | 0.94 GB | `fnv1a32:36a22758` |
| | `t04-r43-L1` | 43 | L1 | `stopped_by_search_extent_bound` | 0 | 65 s / 53 s | 0.88 GB | `fnv1a32:36a22758` |
| t05 × `61066e62` | なし（Phase Bはt05をL0 rank 1のK0で停止し、このcontextのtaskが存在しない） | — | — | — | — | — | — | — |
| t10 × `e396d352` | `t10-r10-L0` | 10 | L0 | `stopped_by_search_extent_bound` | 0 | 33 s / 26 s | 1.25 GB | `fnv1a32:240e4673` |

- 10 unitのrecordはすべて存在し、bytes・SHA-256がPhase B RESULT `sources.unitRecords` と一致した（§10.1）。各recordの `result.reservation` は、
  `e396d352` contextで `exclusiveOwnedWeaponIds = []`、Gogma held 23、Skill held 3、Normal 1件、`92d87b90` contextで `exclusiveOwnedWeaponIds = ['60126fe6-ad44-492c-bb13-b0320f2cbd2a']`、
  Gogma held 17、Skill / Normal 0件だった
- `e396d352` のreservation digest `fnv1a32:240e4673` はD1-A §1.3のt09行の登録値と同じである（reservationはsupport Entryだけから導出され、Targetに依存しない）
- t00 / t10のL1、t02 / t03 / t04のL2、t05の全rungは、このcontextでは **一度も計測されていない**
- 参考（scope外）: t09 × `e396d352` は `t09-r10-L0` が29 s・deliver 0、`t09-r10-L1` が99 s・1件deliverで `found_R`

### 1.5 cost参照値（見積もりの根拠。事前登録値ではない）

| 参照 | 値 | 出典 |
| --- | --- | --- |
| 今回のcontextのK1 L0 / L1（§1.4） | L0 25〜49 s、L1 59〜73 s、heap 0.88〜2.93 GB | Phase B RESULT `units[]` |
| Phase B K1 extent-bound unit全体（535件、deliver 0） | wall p10 28 s / p50 250 s / p90 1,125 s / max 3,189 s | follow-up §2.2.1 |
| Phase B K1 timeout | 8件（rank 8 / 9 / 11、60分上限） | follow-up §1 |
| Phase B child heap peak | 9.26 GB（OOM 0） | follow-up §1 |
| D2-B K0 L2 unit | child wall 41〜43 s、Search 35〜37 s、heap 0.68〜0.76 GB（5件） | D2 RESULT `discovery.units[]` |
| K1 L2 | **未計測**（Phase BのL2 unit 4件はすべてK0） | follow-up §2.2.1 |
| 参考: B2-C2B2C共通L2 | 10分上限で128 task中108がtimeout（capture policyが異なり直接比較できない） | follow-up §9.2 |
| 評価run | D2-Bの評価86件は7.0〜14.8 s / 件、`fullRunsStarted = 1` | D2 RESULT `aggregates` |

### 1.6 推論（測定していない。D2-C-Bのparity検査・計測で確かめる）

- I-D2C-1: Searchは決定的であり（Phase A §6.2、D2-BのPhase B K0 prefix parity 24 / 24）、K1 contextのSearch入力（origin、reservation、`excludedRouteKeys`、extent）は
  Phase Bと同じ部品で再導出される。したがって§1.4の10 unitはD2-Cでも0件・extent boundになるはずである。D2-C-Bはこれを推定として使わず、§9の
  `phase_b_k1_prefix` parityとして検査する。成立すれば、t00 / t10はL1、t02 / t03（2 context）/ t04はL2まで、Candidateが得られない
- I-D2C-2: K1 L2のcostは未計測で、§1.5の値からは数十秒から60分上限超まで幅がある。L2 unitのtimeout / OOMは起こり得る（§8.4）
- I-D2C-3: `61066e62` のreservationは `aec3d2e4…` をexclusive OwnedWeaponに含むはずである（§1.3の `same_owned_weapon_consumed`）。その場合、t05のK1 Searchは
  `aec3d2e4…` を使わないRouteだけを返す。D2-C-Bは§7.1のC3で、導出reservationがsupport Routeの参照OwnedWeaponを含むことを検査する
- I-D2C-4: supportの勝ちRouteと資源が重なるCandidateは、reservationによりdeliverされない。したがってK1 Candidateは「supportと資源を共有しない」Routeに限られるが、
  集合評価で他Target・他Conflictの暫定帰結に負ける可能性は残る。これは予想であり、判定規則には使わない（§13）

## 2. 事前登録条件: 目的・scope・対象外

### 2.1 目的

D2-Bの主軸で受理されなかった6 Targetについて、D2-Bの評価runで観測したprovisional winner（阻害Entry）をsupport 1件のK1 contextとしてSearchし（discovery）、
R1でadmissionし、D2-Bの主軸受理集合に1件ずつ加える単一passの集合評価（R5 + 非後退gate）で採否を決める。これにより、
「D2-BのK0-only最良集合（22 / 20）に、阻害Entryを前提とするK1 Candidateを追加して改善できるか」を、有界な実行で測る。

### 2.2 scope

| 項目 | D2-Cの値 |
| --- | --- |
| 対象Target | D2-B主軸で不受理の6 Target（t00 / t02 / t03 / t04 / t05 / t10）。§3.1の規則で機械導出し、§3.2の登録表と一致すること。Targetを追加・削除しない |
| context | §3.2の **7 K1 context**（support 1件）だけ。K0 / K2 contextのSearchは行わない |
| support | §3.2の3 Entry（いずれもExport上の元Entry、E1外、B0 selected） |
| extent | Phase B / D2の登録ladder L0 `{4, 235, 4}` / L1 `{8, 235, 256}` / L2 `{128, 235, 1500}`（Normal / Gogma / Skill）。L2を初回formalに含める（§4.6） |
| 比較・合成の起点 | D2-B主軸の受理集合（t01 c1 / t06 c3 / t07 c1 / t08 c1 / t09 c1）。G storeはD2-B evidenceから再取得し、D2-C-Bのmeasurement HEADでfresh full runして評価する（I0、§6.1） |
| 置換しないTarget | 置換集合に入らないTarget（E1外の32 Targetと、置換されないE1 Target）は元Route（Export上のEntry）のまま |
| Export / RNG / CalculationContext | D2と同じ（Export `cc35fb5b…1e6b`、`production-rng:c5-e7`、`{ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }`） |
| Plan step bound | Research `researchMaxPlanSteps = 20000`（Production A / Bと混同しない、G12） |
| conflict resolution / fixed constraint | すべての評価runで `conflictResolutions = []`、preflightのfixed constraint `[]`（G1） |
| population | `oracleGuidedTargetPopulation = true`（E1の部分集合）。policyは7 contextすべてに同一の規則を適用し、Target IDで分岐しない |

### 2.3 対象外

- K0 contextのSearch（D2-Bで実施済み）、K2 contextのSearch、support 2件以上のcontext
- winner以外のConflict co-participantをsupportにすること、D2-Cの結果から新しいsupportを追加導出すること（適応的なcontext追加をしない）
- alternative-to-alternative support（D2-B / D2-Cの生成Entryをsupportにすること）、support依存の連鎖・循環、失効したsupportの自動再解釈
- D2-Bで受理済みの5 Targetの置換・再評価、D2-Bで不受理だったK0 Candidateの再評価（複数pass）、合成順の総当たり、同時置換探索
- E1外のTarget、43 Target全体、E2 / residual 3への拡大
- oracle exactとの比較。oracle（RESULT `PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、manifest、module）は実行入力・診断入力・分析のいずれにも使わない。post-hocにも読まない
- Phase B / D1 / D2のformal RESULT・decisionの書き換え、D2-Cの結果をそれらのdecision inputへ戻すこと
- Production化、REQUIREMENTS 23の契約変更、Production defaultの変更

## 3. 事前登録条件: support contextの導出

### 3.1 導出規則（V・analyzerが機械的に再実行する）

```text
ScopeTargets = D2 RESULT composition.main.steps のうち stepOutcome !== 'accepted' の label（Target ID昇順）
SourceEvaluations = D2 RESULT evaluations のうち stage ∈ { ADM, CMP, Z }
for t in ScopeTargets:
    obs(t) = SourceEvaluations のうち targetLabel === t
    for e in obs(t):
        e.status !== 'evaluated'                       -> V失敗（D2-Bはunmeasured 0なので起き得ない）
        c = e.candidates のうち label === t の要素      -> ちょうど1件でなければV失敗
        c.selected === false かつ c.winnerBuildListEntryId !== null -> count_t[winner] += 1
    W(t) = count_t のkeyを (count降順, Entry ID昇順) に並べたもの
    eligible(s) =  s がExportのBuildListEntry
                 ∧ s のTargetがE1 manifestに無い（E1外）
                 ∧ s が生成Entryでない（ID prefix `build-list.constrained.` でない）
                 ∧ s がいずれのE1 Targetの O_t でもない
    contexts(t) = W(t) のうちeligibleなものの先頭 SUPPORT_CAP_PER_TARGET = 2 件
```

- support候補の源は **provisional winnerだけ** である（follow-up §5.3、D2-A §13.2の(a)）。Conflict co-participant（(b)）は診断として記録するが、contextにしない
- 同じEntry IDの複数評価での観測は1件に集約し、観測回数（`count_t[s]`）と観測評価数（`|obs(t)|`）を記録する。Targetとsupportの組は独立したcontextである
  （同じ `e396d352` でも、t00 / t02 / t03 / t10の4 contextは別context）
- B0でのselectedは記録し、§3.2の登録値（すべてtrue）と照合する。導出規則のfilterには使わない（follow-up §5.2: B0非selectedを理由にcontextをcloseしない）
- 導出結果は§3.2の登録表と **context集合・順序・観測回数・観測評価数がすべて一致** しなければならない。不一致はV失敗（`D2C_INVALID`、`input_evidence`）で、
  childを1つも起動しない。不一致を推測で補正しない

### 3.2 登録context（7件、この順序が登録順 = context ordinal）

| k | context ID | Target | TargetWeapon ID | `O_t`（現在Entry） | support Entry | 観測 | Target内順 | Phase B参照unit（§1.4） | 登録reservation digest |
| ---: | --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| 1 | `K1-t00-e396d352` | t00 | `02876df4-cd56-4c95-add9-9e3e9cc90801` | `build-list.fnv1a32-bb36c5ca` | `build-list.fnv1a32-e396d352` | 9 / 9 | 1 | `t00-r09-L0` | `fnv1a32:240e4673` |
| 2 | `K1-t02-e396d352` | t02 | `070a1222-5e31-4c9f-a035-c557bfa7be73` | `build-list.fnv1a32-32e817d9` | `build-list.fnv1a32-e396d352` | 6 / 6 | 1 | `t02-r10-L0` / `-L1` | `fnv1a32:240e4673` |
| 3 | `K1-t03-92d87b90` | t03 | `188571a7-b480-4085-a8f5-59666c0e4cc5` | `build-list.fnv1a32-dd79ecce` | `build-list.fnv1a32-92d87b90` | 6 / 9 | 1 | `t03-r43-L0` / `-L1` | `fnv1a32:36a22758` |
| 4 | `K1-t03-e396d352` | t03 | `188571a7-b480-4085-a8f5-59666c0e4cc5` | `build-list.fnv1a32-dd79ecce` | `build-list.fnv1a32-e396d352` | 3 / 9 | 2 | `t03-r10-L0` / `-L1` | `fnv1a32:240e4673` |
| 5 | `K1-t04-92d87b90` | t04 | `a367c177-a0c2-4986-995e-4efcf4131b5c` | `build-list.fnv1a32-a3d6817e` | `build-list.fnv1a32-92d87b90` | 9 / 9 | 1 | `t04-r43-L0` / `-L1` | `fnv1a32:36a22758` |
| 6 | `K1-t05-61066e62` | t05 | `a6c17e25-bd3a-42e1-b86a-c813b78acde0` | `build-list.fnv1a32-df40f28f` | `build-list.fnv1a32-61066e62` | 9 / 9 | 1 | なし | なし（D2-C-BのCTXで初めて導出・記録） |
| 7 | `K1-t10-e396d352` | t10 | `e523209e-57e8-4316-a7f0-329f64fd0b00` | `build-list.fnv1a32-66c25e3d` | `build-list.fnv1a32-e396d352` | 9 / 9 | 1 | `t10-r10-L0` | `fnv1a32:240e4673` |

- Target内順: 観測回数降順、同数ならsupport Entry ID昇順。今回該当するのはt03だけで、`92d87b90`（6 / 9）が `e396d352`（3 / 9）より先である
- context ordinalは (Target ID昇順, Target内順) の全順序である。`K1-<t>-<support Entry IDの先頭8桁>` はRESULT上の表示IDで、比較・同定はTargetWeapon IDとsupport Entry ID全文で行う
- TargetWeapon ID・`O_t` はD1-A §1.3の登録表（D2-A §17で読取範囲を限定したfield）と一致する。support EntryのTarget IDはExportから読む（§10.1）
- 登録reservation digestはparityの期待値である（§9）。S5の検証対象は、D2-C-BのCTXが記録するreservation body / digestそのものである（§7.2）。Phase B recordの
  reservationを当該contextのS5 authorityとは仮定しない

## 4. 事前登録条件: discovery（K1 Search）

### 4.1 context作成（CTX、contextごとに1 child）

各contextについて、discoveryの前に1回だけcontext recordを作る。**S5の比較対象はこのrecordである。**

```text
unit CTX-<k>:
    baseline = globalResearchInputFromExport(Export, 20000)                 // conflictResolutions = [] を確認
    supportBody = Export.buildListEntries のうち id === s の要素（ちょうど1件）
    resolved = phase2c27bResolveSupportContext(baseline, dependencies, t, [s])   // Phase B / D2と同じ経路
    resolved.status !== 'ready'                         -> guardrail違反（D2C_INVALID）
    reservation = resolved.prepared.reservation           // = derivePlannerAlternativeReservation([s の初期context上のEntry], engine)
    記録: contextId, k, targetWeaponId, O_t（resolved.prepared.invalidated.id）, support Entry ID,
          supportBodySha256 = SHA-256(stableStringify(supportBody)),
          reservationBody = stableStringify(reservation), reservationDigest = hashStableValue(reservation),
          originDigest, excludedRouteKeys（全文とSHA-256）, conflictContextsの件数
    C1〜C5（§7.1）を判定して記録
    record file: <run dir>/CTX-<k>.context.json（runnerがbytes・SHA-256をjournalへ記録）
```

- origin、`excludedRouteKeys`（当該Targetの現在Route `O_t` のkeyだけ）、現在Entryの意味はPhase B / D2と同じで、D2-Cは変更しない
- support Entryはexportの元Entryそのものを使い、user-fixed Route、resolution、scenario resolution、repair lineage、fixed constraint、`selectedBuildListEntryId` に変換しない（G1）
- CTXはSearchを実行しない。full Planner runも起動しない

### 4.2 Search入力とconsumer（unit = (context, rung)、unitごとに新しいchild）

```text
pool(k) = []                         // context k のunique Candidate（discovery順、最大 K1_POOL_CAP = 2）
unit DSC-<k>-<rung>:
    resolved = phase2c27bResolveSupportContext(baseline, dependencies, t, [s])
    reservation / originDigest / excludedRouteKeys / O_t がCTX-<k>のrecordと stableStringify() で一致しない -> guardrail違反（context_drift、D2C_INVALID）
    searchInput = { origin, targetWeaponId: t, extent: rung, reservation, excludedRouteKeys }
    visitPlannerAlternativeCandidates(searchInput, engine, consumer)     // capture policy・instrumentationなし、既存orderingのまま
    consumer(candidate):
        key = candidateStableKey(candidate)
        R0: respectsPhase2C2Reservation(summarizePhase2C2Entry(...), candidate.route, reservation) が偽 -> guardrail違反（D2C_INVALID）
        key ∈ pool(k)のkey              -> action = duplicate_of_lower_rung、continue（§4.3 D-2）
        SHA-256(key) ∈ D2B_K0_POOL(t)   -> action = same_key_as_d2b_k0_pool、continue（§4.3 D-4）
        それ以外 -> materializer.materializeBuildListEntry(candidate, baseline.buildListEntries)
                    G store へbody全体を書く（SHA-256を記録）、pool(k)へ追加、action = pooled
                    |pool(k)| = K1_POOL_CAP -> stop、それ以外 -> continue
```

- 消費者はdiscovery中にtrial（full Planner run）を行わない。`found_R` を探索停止条件にしない（follow-up §4.2）
- Search ordering、Candidate semantics、extentの意味、`excludedRouteKeys` を変えない。`excludedRouteKeys` にD2-BのK0 Candidateを足さない（D-4はconsumer側の分類である）
- materializeは既存materializer（`createPlannerAlternativeMaterializer({ ...searchInput, clock })`）だけで行い、Route・`route.operations` からBuildListEntryを組み立てない
- `D2B_K0_POOL(t)` はD2 RESULT `discovery.targets[label = t].pool[].keySha256` の集合（t00 3件、t02 2件、t03 / t04 / t05 / t10 各3件）である
- R0不成立はPhase BのK1を含む32 deliveryで一度も観測されていない（`respectsReservation = false` は0件）。SearchはreservationをSearch入力として受け取るので、
  不成立はSearchとResearch summaryの定義の不整合であり、通常の結果として扱わない

### 4.3 重複排除（4層を区別する）

| 層 | 規則 | 扱い |
| --- | --- | --- |
| D-1 同一unit内 | Searchは1 run内で同じ `candidateStableKey` を2回deliverしない（`visitPlannerAlternativeCandidates()` の `seen`） | 2回目が観測されたら不変条件違反（guardrail、`D2C_INVALID`） |
| D-2 同一context・rung間 | key（全文）がpool(k)に既にある | `duplicate_of_lower_rung`。poolに数えない、materializeしない（D2-A §2.3と同じ） |
| D-3 同一Target・異なるK1 context間（t03の `K1-t03-92d87b90` と `K1-t03-e396d352`） | **同一視しない**。両contextでそれぞれpoolし、別Candidateとして別々にADM / CMPで評価する。互いに `crossContextSameKey`（相手のcontext ID・ordinal）を診断として記録する | generated Entry IDはCandidate意味・hash・CalculationContextだけから決まる（§14）ので両者で同じになり得るが、`candidateSnapshot.searchRunId`（= Search identity。reservationとextentを含む）が異なるのでG store bodyは異なる。Candidateの同定は (context ID, key) とし、Entry IDだけで同定しない。G store fileはcontext別に分ける。同じPlannerInputに同一Targetの2件を入れない（G15） |
| D-4 D2-BのK0 pool（同一Target、empty-support context） | `SHA-256(key)` がD2-Bの同一TargetのK0 pool keyと一致 | `same_key_as_d2b_k0_pool`（一致したD2-B ordinalを記録）。poolに数えない、materializeしない。**同一視ではなく、D2-Cの対象外とする規則** である: support不要の同じRouteはD2-BでK0 Candidateとして既にadmission・集合評価されており、それに `requiresSupport` を付けても新しいRouteは増えず、依存だけが強くなる。D2-BのK0 Candidateを新しい受理集合に対して再評価することは複数passであり、今回は登録しない（§16） |

- 同一Targetの異なるcontextで得たCandidateは、`requiresSupport`、reservation digest、CTX record SHA-256、Search identity、G store SHA-256が異なる別Candidateである
- D2-BのK0 pool以外（他TargetのCandidate、D2-B受理集合のG）とはkeyが一致し得ない（Targetが異なる）。一致した場合は不変条件違反である

### 4.4 rungの進行・停止（contextごと）

unitの型付きoutcomeはD2-A §2.3と同じ規則で判定する（上から）:

```text
consumerがstopした（|pool(k)| = 2）       -> discovery_cap_reached          : contextのdiscovery終了
summary.exhausted                         -> discovery_exhausted            : contextのdiscovery終了
summary.stoppedByExtent                   -> stopped_by_search_extent_bound : 次rungへ（L2なら ladder_exhausted で終了）
timeout / OOM / process failure / interrupted -> unmeasured                 : contextのdiscovery終了（上位rungへ進めない、G6 / G11）
typed calculation error                   -> discovery_calculation_error    : unmeasured扱い。ただしPhase Bに比較相手のunitがある場合はparity mismatched（§9）
not_executed（envelope到達、abort）       -> not_executed                   : contextのdiscovery終了
```

- 上位rungへ進む条件は、unitが `stopped_by_search_extent_bound` で終わり、かつ `|pool(k)| < 2` であることだけである
- 各contextのrung進行は、そのcontext自身のunitの結果だけで決まる（contextはSearch入力を共有せず、Searchは決定的）。実行順序（§8.1）はこれを変えず、
  envelope到達時にどのunitが `not_executed` になるかだけを決める

### 4.5 discoveryの上限（すべて事前登録値）

| 量 | 上限 | 導出 |
| --- | ---: | --- |
| context | 7 | §3.2 |
| CTX unit | 7 | contextごとに1 |
| DSC unit（Search unit） | contextあたり3、全体 **21** | 7 context × L0 / L1 / L2 |
| contextあたりunique Candidate | `K1_POOL_CAP = 2` | D2-AのTargetあたり3より小さくする。7 context中6 contextでPhase BのL0（うち4 contextはL1も）が0件であり（§1.4、I-D2C-1）、主にL1 / L2で得るCandidateを評価件数の上限内に保つため。値2はoracle由来ではない |
| Targetあたりunique Candidate | t03は4、他は2 | contextあたり2 × Targetのcontext数 |
| Candidate保持数（pool全体） | **14** | 7 × 2 |
| unitあたりdelivery | **5** | pooled ≤ `2 − |pool(k)|開始時`、`duplicate_of_lower_rung` ≤ `|pool(k)|開始時`、`same_key_as_d2b_k0_pool` ≤ 3（D-4、Searchの `seen` により各key高々1回）。`excludedRouteKeys` で除外されたRouteはdeliverされない |
| G store file | 14 | pooled 1件につき1 |

### 4.6 L2を初回formalに含める判断

L2を初回formalに含める（別の登録軸に分けない）。根拠:

1. §1.4のとおり、7 context中6 contextのL0（t02 / t03 / t04はL1も）はPhase Bで0件・extent boundであり、I-D2C-1が成立すればL0 / L1だけではCandidateが
   ほぼ得られない。L2を除いた初回formalは、結果がほぼ事前に決まる計測になる
2. D2-BでもK0 CandidateはL2で初めて得られたTargetがある（t02 / t03 / t04 / t08 / t09）
3. K1 L2のcost未計測（I-D2C-2）というriskは、unitごとの60分上限、discovery envelope（§8.4）、rung-majorの実行順（L2を最後にまとめる）、
   timeout / OOMをunmeasuredとして扱いCandidate不存在に読み替えない規則（G34）で有界にする

L2のunitがtimeout / OOMになった場合、そのcontextは `unmeasured` で終わり、decisionは `D2C_INCOMPLETE`（下限evidence）になる。そのcontextのCandidate不存在、
非共存、extent不足のいずれも主張しない。

### 4.7 記録

各pooled Candidateについて記録する: context ID、k、Target、support Entry ID、unit ID、rung、unit内delivery index、discovery ordinal（§5.1）、`candidateStableKey()` 全文と
SHA-256、cost（`estimatedOperationCount`）、Route kind、`route.operations` 件数、R0の結果、Search identity（`createPlannerAlternativeSearchIdentity()`）、
reservation digest（Search入力として使ったもの）、CTX record SHA-256、generated Entry ID、`reusedExisting`、G store fileとbytes・SHA-256、
`resolveBuildListEntryReplacement()` の結果（`ready` かつ `replacedBuildListEntryId === O_t`）、`requiresSupport = [s]`、`crossContextSameKey`。

各unitについて記録する: Search summary（`deliveredCandidates` / `excludedCandidates` / `exhausted` / `stoppedByExtent` / `stoppedByConsumer` /
`skippedExcludedRouteKeys` 件数）、consumerが受け取った全deliveryのkey SHA-256・cost・action（`pooled` / `duplicate_of_lower_rung` / `same_key_as_d2b_k0_pool`）・R0、
Search identity、searchOnlyMs、materializeMs、wall、heap / RSS peak、`phaseBParity`（§9）。

## 5. 事前登録条件: admission（ADM、R1）

### 5.1 discovery ordinalと評価対象

Targetごとのdiscovery ordinal（1始まり）は (context ordinal, rung昇順, unit内delivery index) の辞書式順である。t03では `K1-t03-92d87b90` のCandidateが
`K1-t03-e396d352` のCandidateより先になる。ordinalは実行順（§8.1）に依存しない。

pooled Candidateごとに、admission評価を1件行う。

| 項目 | 値 |
| --- | --- |
| 評価ID | `ADM-<t>-c<ordinal>`（例 `ADM-t03-c3`） |
| 入力 | `T = { t }`、`G = 当該Candidate`（D2-CのG storeのbody）。D1-A §4.1と同じ手順（baseline + `G` を末尾に追加、9.2.18 replacement、preflight、full runner） |
| `evaluatedAgainst` | `baseline` |
| `requiresSupport` | `[s]`（当該Candidateのcontextのsupport） |
| 実行順 | Target ID昇順、Target内はdiscovery ordinal昇順 |
| 上限 | Targetあたり `|pool(t)|`（t03は4以下、他は2以下）、全体14件 |

R1（`candidate_admissible_R`）の成立条件はD2-A §3と同じ（すべて必須）:

1. discoveryのmaterializationで `reusedExisting === false`（`true` なら評価を実行せず `not_run_reused_existing`、measured、R1偽）
2. `resolveBuildListEntryReplacement()` が `ready` で `replacedBuildListEntryId === O_t`
3. preflight `ready`
4. 評価statusが `evaluated`（full runがPlannerResultを返し、Plan生成とTrace Replayが例外なく完了）
5. `plan !== null` かつ `termination.status ∈ { 'completed', 'exhausted' }`

- **admitted** ⇔ R1成立。R1はsupportのselectedを要求しない（それはR2）。R1が偽でもmeasuredであれば、そのCandidateがadmittedでないだけである
- 次を **診断として** 記録する: R2（`support_consistent_R`。K1なので非vacuous: R1 ∧ `s` selected ∧ `G` と `s` を同時participantとするConflictなし）、
  R3（`generated_selected_R`）、R4（`joint_selected_R`）、`target_regressed_R`（`O_t` がB0でselected、かつ `G` がselectedでない）、Phase Bと同じ `found_R` 判定
  （`judgePlannerAlternativeTrial()`、explicit decision = fixed Route = support = `[s]`。literalは `found_R`）、`G` を外した勝者Entry、`G` を含むConflictの他participant、
  S1〜S3の動的checkの結果
- S4 / S5（静的check、§7.2）はADMでも検査し、不成立はguardrail違反（`D2C_INVALID`）である
- `G` がselectedでないこと、R2 / R3 / R4が偽であること、`target_regressed_R`、`found_R` 不成立を理由にCandidateをpool・admissionから除外しない（G14 / G26）
- ADMの結果（R1〜R4）をR5として流用しない（G20 / G25）

## 6. 事前登録条件: 集合評価

### 6.1 I0（D2-B主軸受理集合のfresh再評価）

| 項目 | 値 |
| --- | --- |
| 評価ID | `I0` |
| 集合 | D2-B主軸の受理集合 `{ t01: c1, t06: c3, t07: c1, t08: c1, t09: c1 }`（Target ID昇順） |
| `G` のbody | D2-B G store（§1.1の5 file）。runnerは読み込み時にbytes・SHA-256を登録値・D2 RESULT `sources.d2.generatedEntries`・`CMP-t09-c1.generatedEntrySha256s` と照合し、bodyの `id` が `composition.main.finalAccepted[].generatedBuildListEntryId` と一致することを確認する |
| `requiresSupport` | 5件とも `[]`（K0） |
| `evaluatedAgainst` | `replacement_set` |
| 期待値（parity `d2b_incumbent`、§9） | `inputDigest = fnv1a32:488e42f1`（D1-A §9.4と同じ定義・関数）、status `evaluated`、`resultDigest = fnv1a32:21e8e8b5`、termination `exhausted`、completed 22 / 43、Conflict 20、steps 1465、R5成立 |
| 役割 | CMPの初期 `accepted` と初期 `reference`。比較値「D2-B主軸」の **D2-C-B内の実行結果** |

- **D2-Bの過去RESULTを新しい集合評価の実行結果として流用しない**。CMPのreferenceはI0の評価recordだけから読む。D2 RESULTの値はparityの期待値にだけ使う
- I0が比較可能な結果を持ち期待値と異なれば `mismatched`（`D2C_INVALID`）で、runnerは直ちに中止する（§8.5）
- I0がunmeasuredなら、CMPの全段は評価を起動せず `not_executed`（`notExecutedReason = i0_unmeasured`）で、decisionは `D2C_INCOMPLETE`

### 6.2 CMP（主軸、単一pass）

```text
accepted   = I0の集合（5件、K0）               // Target ID昇順の置換集合（各Target高々1件）
reference  = I0の結果
for t in [t00, t02, t03, t04, t05, t10]:        // Target ID昇順
    tのいずれかのcontextのdiscoveryがunmeasured / not_executedで終わった、またはtのADMに1件でもunmeasured / not_executedがある
               -> CMP評価を起動せず stepOutcome = step_unmeasured（stepNotEvaluatedReason = dependency_unmeasured）、
                  accepted / referenceは維持、以後の段に afterUnmeasuredStep = true、次のTargetへ
    cands = pool(t)（全contextの和）のうちadmittedなもの（discovery ordinal昇順）
    cands が空 -> stepOutcome = not_replaced_no_admitted、次のTargetへ
    for c in cands:                                   // 早期打ち切りなし。cands全件を評価する
        proposed = accepted ∪ { t: c }                // Target ID昇順
        評価 CMP-<t>-c<ordinal>: proposed を evaluatedAgainst = replacement_set として1 runで評価
        eligible(c) = 評価statusが evaluated
                      ∧ proposed全体がR5（§6.3）を満たす
                      ∧ completed(proposed) ≥ completed(reference)      // 非後退gate（D2-A §4.2と同じ）
    いずれかの評価がunmeasured / not_executed -> stepOutcome = step_unmeasured、accepted / referenceは維持、以後の段に afterUnmeasuredStep = true
    eligibleが空                               -> stepOutcome = not_replaced_no_eligible、accepted / referenceは維持
    それ以外 -> best = eligibleのうち選択順（§6.4）で最初のもの
               accepted = accepted ∪ { t: best }、reference = bestの評価結果、stepOutcome = accepted
final = accepted、finalResult = 最後に受理した評価の結果（受理が無ければI0の結果）
```

- 1回のPlannerInputには各Target高々1件の置換だけを入れる（G15）。t03の2 contextのCandidateも同じPlannerInputへ入れない
- 受理済みの5 Target（t01 / t06 / t07 / t08 / t09）は置換・再評価しない。一度不受理になったTargetを後のTargetの受理後に再評価しない（単一pass）
- 最終結果のために追加の評価runを行わない
- CMP評価の上限: `Σ_t |admitted(t)| ≤ 14`

### 6.3 R5（`set_coexistent_R`）

D1-A §4.4の5条件を、K1 Candidateを含む置換集合へそのまま適用する。

記号: 置換集合 `T`、`S_G = { G_t.id | t ∈ T }`、`S_sup = ⋃_{t ∈ T} requiresSupport(G_t)`（受理済み5件は空なので、D2-Cでは集合内のK1 Candidateのsupportの和）、
`M = S_G ∪ S_sup`、`selected = plan.selectedBuildListEntryIds`。

| 条件 | 判定 | failure reason |
| --- | --- | --- |
| (1) 集合内すべてのGがselected | `S_G ⊆ selected` | `generated_not_selected`（どの `G_t` かを列挙） |
| (2) 必要supportがselected | `S_sup ⊆ selected` | `support_not_selected`（どの `s` かを列挙） |
| (3) support依存が有効 | `S_sup` の各 `s` について§7.2の動的check S1〜S3がすべて成立 | `support_expired_R`（`supportExpiryCause`、§7.3） |
| (4) 集合内Conflict | `result.conflicts` に `|c.buildListEntryIds ∩ M| ≥ 2` となる `c` が存在しない（`c.selectedBuildListEntryId` によらない） | `conflict_within_set` |
| (5) Plan + Trace Replay | 評価statusが `evaluated`、`plan !== null`、`termination.status ∈ { 'completed', 'exhausted' }` | `no_plan` / `plan_bound_truncated` / `preflight_refused` / `planner_rerun_bound_reached` |

- `R5.satisfied = (1) ∧ (2) ∧ (3) ∧ (4) ∧ (5)`。(5)が偽でも計算できる条件は記録する
- R5は集合外Targetの完成、Conflict 0、全体completedの増加を要求しない。**R5成立はIssue #154の最終Acceptanceではない**（それはR6）
- supportがPlannerでselectedにならなかった場合は(2)偽でR5不成立（measured、通常の非共存）であり、INVALIDではない

### 6.4 非後退gate・Candidate選択順

- gate: `completed(proposed) ≥ completed(reference)`（`termination.completedTargetCount`）。gate不成立でR5成立の評価は `r5OnlyEligible = true`（診断）
- 選択順（eligibleが複数あるとき、上から）: (1) `completed(proposed)` 大きい方、(2) `result.conflicts.length` 少ない方、(3) `plan.steps.length` 少ない方、
  (4) discovery ordinal 小さい方。D2-A §4.3と同じであり、t03の2 contextのCandidateも同じ順で比較する（contextを理由に優先しない。ordinalの中だけでcontext順が効く）
- 比較値はすべて当該CMP評価runの結果から読み、ADM（`evaluatedAgainst = baseline`）の値を使わない

### 6.5 R6（`global_complete_R`）

`replacement_set` の評価（I0、CMP）について、D2-A §6.4と同じ5条件（`evaluated` かつ `plan !== null` かつTrace Replay成功、`termination.status === 'completed'` かつ
`completedTargetCount === totalTargetCount === 43`、`result.conflicts.length === 0`、`plan.rejectedBuildListEntries` に `reason === 'resource_conflict'` が無い、R5成立）を
すべて満たすこと。R5成立・completed増加・Conflict減少だけではR6を主張しない。

## 7. 事前登録条件: support validity

### 7.1 context作成時のcheck（CTX）

| check | 内容 | 不成立時 |
| --- | --- | --- |
| C1 | support EntryがExportの `buildListEntries` にちょうど1件あり、そのTarget IDがE1 manifestに無く、IDが生成Entry prefixでなく、いずれのE1 Targetの `O_t` でもない | guardrail違反（`D2C_INVALID`） |
| C2 | `phase2c27bResolveSupportContext(baseline, dependencies, t, [s])` が `ready`（support Entryがbaselineの初期contextでvalid、当該Targetの現在Entryがちょうど1件で `O_t` と一致） | guardrail違反 |
| C3 | 導出reservationの `exclusiveOwnedWeaponIds` が `collectReferencedOwnedWeaponIds(supportBody.candidateSnapshot.route)` をすべて含む。support Routeの排他消費OwnedWeapon（`exclusiveConsumedOwnedWeaponId`）も導出に含まれることを、導出に使った同じunit planから記録する | guardrail違反 |
| C4 | originのdigestがB2-C1 schedule snapshotのorigin digestと一致し、`excludedRouteKeys` が `[candidateStableKey(O_t.candidateSnapshot)]` である（Phase B / D2と同じ照合） | guardrail違反 |
| C5 | 登録reservation digest（§3.2）があるcontextでは、`reservationDigest` が登録値と一致し、`reservationBody` がPhase B参照unit（§1.4）の全recordの `result.reservation` と `stableStringify()` で一致する。`e396d352` はD1-A §1.3の `fnv1a32:240e4673` とも一致する | parity `phase_b_k1_context` `mismatched`（`D2C_INVALID`）。t05は `not_applicable` |

- context recordの `reservationBody` / `reservationDigest` / `supportBodySha256` が、以後のdiscovery（context drift検査）と全評価（S4 / S5）の比較対象になる
- analyzerはC1 / C3 / C4をExportとCTX recordから独立に再計算する（C3の `collectReferencedOwnedWeaponIds()` はEngineを要しない純関数）。C5はrecordとPhase B evidenceで再照合する

### 7.2 評価時のcheck（ADM / CMP / I0。`S_sup` の各 `s` について）

| check | 内容 | 種類 | 不成立時 |
| --- | --- | --- | --- |
| S1 | `s` のTargetが置換集合 `T` に含まれない（`s` が `-O` で外されていない） | 動的 | R5(3)偽、`support_expired_R` |
| S2 | 最終run入力（runtime-unsupported retry後）の `buildListEntries` に `s` が存在する | 動的 | R5(3)偽、`support_expired_R` |
| S3 | 最終run入力の初期context（`preparePlannerInitialContext(最終入力).context.entriesById`）に `s` がvalid Entryとして存在する | 動的 | R5(3)偽、`support_expired_R` |
| S4 | 評価入力内の `s` のbodyがExportのbodyと `stableStringify()` で一致し、そのSHA-256がCTX recordの `supportBodySha256` と一致する | 静的 | guardrail違反（`D2C_INVALID`） |
| S5 | (a) `hashStableValue(derivePlannerAlternativeReservation([Exportの s のbody], engine))` がCTX recordの `reservationDigest` と一致し、かつ (b) 導出reservationが CTX recordの `reservationBody` と `stableStringify()` で一致する。両方成立した場合だけS5成立 | 静的 | guardrail違反（`D2C_INVALID`） |

- S5はD2-A §17のRequired fixと同じく **digestとbodyの両方** を要求する。評価childは(a)(b)を個別に計算し、比較したbody・digestを評価recordへ書く
- 加えて、当該CandidateのDSC record・pooled recordに記録されたSearch入力のreservation digestが、CTX recordの `reservationDigest` と一致しなければならない（analyzerが照合。
  不一致はguardrail違反）
- analyzerは、評価recordの比較body・digestが、runnerがjournalに記録したSHA-256のCTX recordの値と同じであること、S4 / S5の両条件が成立していることを独立に照合する
- 新しく作るK1 contextについて、既存のPhase B reservation recordが存在するとは仮定しない。存在するcontext（§1.4）ではC5のparityとして追加照合するだけで、
  S5のauthorityはCTX recordである
- S1は登録scopeでは構造上成立する（supportのTargetはE1外で、置換集合はE1 Targetだけ）が、規則として常に検査する

### 7.3 support失効・不成立の原因（RESULTの `supportExpiryCause`）

| 原因 | 判定 | 区分 |
| --- | --- | --- |
| `support_target_replaced` | S1不成立 | R5(3)偽（measured） |
| `support_removed_runtime_unsupported` | S2不成立で、かつ `runtimeUnsupportedRemoved` に `s` がある | R5(3)偽（measured） |
| `support_entry_absent` | S2不成立（上記以外） | R5(3)偽（measured） |
| `support_entry_invalid` | S3不成立 | R5(3)偽（measured） |
| `support_not_selected` | S1〜S3成立、`s ∉ selected` | R5(2)偽（measured）。失効ではない |
| `support_body_mismatch` | S4不成立 | `D2C_INVALID`（guardrail） |
| `support_reservation_mismatch` | S5(a)または(b)不成立 | `D2C_INVALID`（guardrail） |

- 複数の原因に該当する場合は、表の上から最初に該当するものを `supportExpiryCause` とし、S1〜S5の各判定値はすべて記録する。S4 / S5が不成立なら、記録した原因によらず `D2C_INVALID` である
- 失効・不成立したCandidateを、別support上の結果、K0 Candidate、置換後Routeをsupportとする結果として読み替えない（alternative-to-alternative supportは定義しない、G18）
- 失効を理由に自動で再Searchしない

## 8. 事前登録条件: 実行順序・status・budget・envelope

### 8.1 実行順序（固定）

```text
V     入力検証（親。childを起動しない、§10.1）
B0    baseline参照評価（D1-A §5.1、{ kind: 'persisted' }）
I0    D2-B主軸受理集合のfresh再評価（§6.1）
CTX   k = 1 → 7
DSC   rung-major: L0（k = 1 → 7）→ L1（L0で次rungへ進んだcontext、k昇順）→ L2（同、k昇順）
ADM   Target ID昇順、Target内はdiscovery ordinal昇順
CMP   t00 → t02 → t03 → t04 → t05 → t10（各段は前段の受理結果に依存）
```

- B0 / I0を最初に行い、parity不一致なら高価なdiscoveryの前に中止する（§8.5）
- DSCをrung-majorにする理由: 各contextのrung進行は順序に依存しない（§4.4）。計測済みで安価なL0 / L1を先にすべて終え、未計測のL2を最後にまとめることで、envelope到達の影響を
  最も不確かなrungに限定する
- 登録された評価をすべて実行する。同じ `inputDigest` の評価が既にあっても結果を流用せず、別のchild processで実行する

### 8.2 status

D2-A §6.2の評価status・discovery unit statusをそのまま使い、次を追加する。

| 対象 | status / outcome | measured | 扱い |
| --- | --- | --- | --- |
| CTX | `context_ready` | yes | DSCへ |
| CTX | C1〜C4不成立 | — | guardrail違反（`D2C_INVALID`、runnerは中止） |
| CTX | `timeout` / `out_of_memory` / `process_failure` / `interrupted` / `not_executed` | **no** | そのcontextのDSCは全rung `not_executed`（`dependency_unmeasured`）、contextは `unmeasured` |
| DSC | `context_drift`（§4.2）、R0不成立、D-1違反 | — | guardrail違反（`D2C_INVALID`） |
| I0 | unmeasured | **no** | CMP全段 `not_executed`（`i0_unmeasured`）、decision `D2C_INCOMPLETE` |
| B0 | unmeasured | **no** | ADMの `target_regressed_R` と差分は `null`（理由を記録）。B0 parityは `not_checked`、decision `D2C_INCOMPLETE` |
| 任意 | `not_executed`（`discovery_envelope_reached` / `run_envelope_reached` / `dependency_unmeasured` / `i0_unmeasured` / `aborted_after_invalid`） | **no** | 登録件数に必ず計上する |

- `plan_bound_truncated`（`termination.status === 'incomplete'`）と `planner_rerun_bound_reached` はbound-limitedとして一覧に残し、通常の非共存と区別する
- wall-clock timeout・OOM・Search extent boundを、Candidate不存在・非共存・extent不足の証明として扱わない（G6 / G7 / G34）
- unmeasuredかどうかは、runnerが記録したprocess outcomeとnot_executed記録だけで決まる。証拠の欠損・破損はD2-A §8.5と同じく `D2C_INVALID`（`evidence_integrity`）

### 8.3 budget（それぞれ独立。Production boundへ流用・合算しない、G5）

| budget | 値 |
| --- | --- |
| context | 7（§3.2）、support / context = 1 |
| CTX child | 7 |
| DSC unit（Search unit） | 21以下（context × L0 / L1 / L2） |
| unique Candidate | contextあたり2、全体14以下 |
| unitあたりdelivery | 5以下（§4.5） |
| B0 | 1 |
| I0 | 1 |
| ADM | 14以下 |
| CMP | 14以下 |
| 評価リクエスト合計 | B0 1 + I0 1 + ADM ≤ 14 + CMP ≤ 14 = **30以下** |
| child process合計 | CTX 7 + DSC ≤ 21 + 評価 ≤ 30 = **58以下** |
| 評価ごとのfull Planner起動上限 | 8（runtime-unsupported retryを含む。評価ごとに新規。full Planner起動の総数は最大240、見込みは評価数と同じ30） |
| `researchMaxPlanSteps` | 20000 |

### 8.4 execution envelope

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| CTX unitのwall上限 | 10分 | Searchもfull runも行わない（Export読込・初期context・reservation導出だけ） |
| DSC unitのwall上限 | 60分（全rung共通。超過はtimeout = unmeasured） | Phase B / D2と同じ（`inheritsOracleInformedExecutionEnvelope = true`）。§1.4のL0 / L1は25〜73 s。K1 L2は未計測 |
| 評価のwall上限 | 30分（preflight、full run、retry、Trace Replayを含むchild全体） | D1-A / D2-Aと同じ。D2-Bは最大14.8 s |
| **discovery envelope** | run開始から **9時間** 経過後は、新しいCTX / DSC childを起動せず、未起動の登録unitを `not_executed`（`discovery_envelope_reached`）とする（実行中のchildは各上限まで待つ） | discoveryが長引いても評価段階の時間を残すため |
| **run envelope** | run開始から **12時間**。到達後は新しいchildを起動せず、未起動のunit / 評価を `not_executed`（`run_envelope_reached`）とする | 目標の12時間以内を明示的な上限にする |
| child heap上限 | 12,288 MB（`--max-old-space-size`） | Phase B / D1 / D2と同じ。Phase B K1のpeak 9.26 GB |
| concurrency | 1 | Phase B / D1 / D2と同じ |
| retry / fallback | なし / なし（timeout・OOM・failureでも条件を変えて再実行しない） | G6 |
| child process | CTX / DSC unit・評価ごとに新しいchild。Node yieldは `setImmediate`、memory sample間隔250 ms | Phase B / D1 / D2と同じ |

見積もり（事前登録値ではない。成功条件にしない）:

| 段階 | 見積もり | 根拠 |
| --- | --- | --- |
| B0 / I0 | 約0.5分 | D2-Bの評価7〜15 s / 件 |
| CTX | 約1〜2分 | 7件、Searchなし |
| DSC L0 / L1 | 約10〜20分 | §1.4: L0 25〜49 s、L1 59〜73 s（t05と、t00 / t10のL1は未計測） |
| DSC L2 | 約5分（D2-BのK0 L2並み）〜 **7時間**（7 unitすべてが60分上限） | K1 L2は未計測（§1.5） |
| ADM / CMP | 約3〜7分 | 28件以下 × 7〜15 s |
| 合計 | 約0.5〜7.5時間 | 12時間のrun envelopeに収まる |

上限の構造: CTX / DSCはdiscovery envelope（9時間）+ 実行中unitの上限（最大60分）までで止まり、評価はrun envelope（12時間）までに起動されたものだけが実行される。
理論上は、L2 unitのtimeoutが重なった場合や、L0 / L1が想定外に遅い場合にenvelopeへ到達し得る。その場合は `not_executed` を記録して `D2C_INCOMPLETE`（下限evidence）とし、
確認できなかったcontextをCandidate不存在や非共存の証明として扱わない。**探索を際限なく続ける規則は無い**: Search unitは21、評価は30、child processは58が上限である。

### 8.5 途中失敗の扱い

| 状況 | 扱い |
| --- | --- |
| Vの失敗 | childを起動せず終了。`D2C_INVALID`（`input_evidence`） |
| B0 / I0のparity不一致（runnerがB0 / I0の `resultDigest` 等を登録値と照合）、CTXのC1〜C4不成立、`context_drift`、R0不成立、D-1違反、G1違反、S4 / S5不成立、replacement不変条件違反 | runnerは直ちに中止し、残りを `not_executed`（`aborted_after_invalid`）として記録。`D2C_INVALID` |
| CTXのunmeasured | そのcontextのDSCは `not_executed`（`dependency_unmeasured`）。他contextは続ける |
| DSCのunmeasured | そのcontextのdiscovery終了。それより前のunitでpoolしたCandidateのADMは実行し記録する（診断）。CMPの当該Target段は `step_unmeasured` |
| ADMのunmeasured | 当該Candidateはadmitted扱いにしない（`admission_unmeasured`）。CMPの当該Target段は `step_unmeasured` |
| CMPのunmeasured | その段は `step_unmeasured`。後続段は続ける（`afterUnmeasuredStep = true`） |
| analyzerだけが検出するparity不一致（Phase B K1 prefix、決定性） | runnerは中止しない。analyzerが `D2C_INVALID` |

## 9. 事前登録条件: parity・決定性

parity状態はD2-A §7.3.1と同じ4状態（`matched` / `mismatched` / `not_checked` / `not_applicable`）で、比較可能な結果の定義はD2-A §7.3.2と同じ（CTXは `context_ready`、
DSCはD2-Aのdiscovery unitと同じ）。`mismatched` は `D2C_INVALID`、`not_checked` は `D2C_INCOMPLETE` に含まれる。analyzerはrecordから独立に再計算し、
runner / childの自己申告をそのまま使わない。未計測のchildの途中出力は `observedPrefixDiagnostic`（診断のみ）とし、状態は `not_checked` のままにする。

`inputDigest` / `resultDigest` はD1-A §9.4と同じ定義・同じ関数で計算する（`inputDigest = hashStableValue({ T（Target ID昇順）, G_TのEntry ID, G_TのG store SHA-256,
Export SHA-256, researchMaxPlanSteps, conflictResolutions: [] })`）。

| 検査 | kind | 比較対象・期待値 | `mismatched` | `not_checked` | category |
| --- | --- | --- | --- | --- | --- |
| B0 | `baseline` | Phase 2-C2 RESULT `baseline.summary`（D1-A §5.1の項目）、`inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`（D1 / D2-BのB0） | 比較可能な結果が異なる（`calculation_error` を含む） | B0が未計測 | `baseline_parity_mismatch` |
| I0 | `d2b_incumbent` | §6.1の期待値（`inputDigest` / status / `resultDigest` / termination / 22 / 20 / 1465 / R5成立） | いずれかが異なる（`preflight_refused`、`planner_rerun_bound_reached`、`calculation_error` を含む） | I0が未計測 | `d2b_parity` |
| CTX context | `phase_b_k1_context` | §7.1 C5（t05以外の6 context） | digestまたはbodyが異なる | CTXが未計測 | `phase_b_k1_parity` |
| Phase B K1 prefix | `phase_b_k1_prefix` | §1.4の10 unitに対応するD2-Cの (context, rung) unit: 0件deliverで `stopped_by_search_extent_bound` | D2-Cのunitがdeliverした、`discovery_exhausted` で終わった、型付きerrorで終わった | D2-Cのunitが未計測・`not_executed` | `phase_b_k1_parity` |
| Phase B K1 prefix（対応unit無し） | — | t00 / t10のL1、全contextのL2、t05の全rung | — | — | `not_applicable` |
| D2-C内の決定性 | `determinism_d2c` | `inputDigest` が同じD2-C評価の組 | 比較可能な結果のstatus・`resultDigest` が異なる | 比較可能な結果が1件以下で残りが未計測 | `determinism` |
| D2-Bとの決定性 | `determinism_d2b` | D2-C評価の `inputDigest` がD2 RESULTの評価86件のいずれかと一致するもの（B0、I0 = `CMP-t09-c1`、その他一致したもの） | D2-C評価が比較可能な結果を持ち、D2-Bの記録とstatus・`resultDigest` が異なる | D2-C評価が未計測 | `d2b_parity` |

- D2-Bの記録はparityの期待値としてだけ使い、R5・受理・decisionへ流用しない
- I-D2C-1が正常な計測で破れた場合（`phase_b_k1_prefix` が `mismatched`）は、計測結果を解釈せず `D2C_INVALID` とする
- 1件でも `mismatched` があれば、他に `not_checked` があっても `D2C_INVALID` である

## 10. 事前登録条件: formal validity・provenance（いずれか違反なら `D2C_INVALID`）

### 10.1 入力（V、analyzerも独立に再検証）

D2-Cが読む入力は次に限る。いずれもRepositoryへ追加しない（committed済みを除く）。`.local` 配下のpathはRepository rootからの相対pathである。

| 入力 | 場所 | bytes | SHA-256 | 読み取り範囲 |
| --- | --- | ---: | --- | --- |
| Export（commitしない） | 外部path（引数）`gogma-artian-planner-backup_20260927015837.json` | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | PlannerInput構築、Entry ID → Target ID、support Entry body |
| Phase B population manifest | `.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local` | 967 | `d4486ba399cb8c0f9272e2c3335e543c8727955f8d9686481fc2975d7874d9de` | Target IDだけ（E1外判定） |
| D2 formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2_RESULT.json` | 4,122,806 | `ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c` | allowlist（下記） |
| D2-B G store 5件 | `.local/d2-formal2.run/{t01-c1, t06-c3, t07-c1, t08-c1, t09-c1}.generated-entry.json` | §1.1 | §1.1 | body全体（I0とCMPの評価入力） |
| Phase B formal RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C27B_RESULT.json` | 808,015 | `d79ea0ded7824f8ba1828d1cffd897ed74dd68681a5759cbb194da80aa79b8e4` | allowlist（下記） |
| Phase B task file 10件 | `.local/c27b-formal.run/<unitId>.task.json`（下表） | 下表 | 下表 | `unitId` / `targetWeaponId` / `targetIndex` / `contextRank` / `rung` / `extent` / `cardinality` / `supportBuildListEntryIds` / `reservationDigest` / `currentBuildListEntryId` だけ |
| Phase B unit record 10件 | `.local/c27b-formal.run/<unitId>.record.json`（下表） | 下表 | 下表（Phase B RESULT `sources.unitRecords` とも一致すること） | `result.reservation` だけ |
| Phase 2-C2 RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` | 1,195,107 | `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4` | `baseline.summary` だけ |
| D1-A文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D1_SPEC.md` | 63,908 | `39974cbbdb7ab81c88bd3edf006796ccf6184c2744e23d61b705fb16f35a359f` | §1.3のfound表のt00 / t02 / t03 / t04 / t05 / t10行の `t` / TargetWeapon ID / `O_t`、t09行のsupport Entry / `reservationDigest` だけ |
| D2-A文書（§17改訂後） | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2_SPEC.md` | — | `a250925a5f25474db1b86f71906b51613608e33ec7b612822ba862e0f7bd1625`（D2 RESULT `sources.specDocument` と同じ） | hash照合だけ |
| D2-B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2B.md` | — | `55952cf4951d9e94d2460fce9cb22c269dec635b30a19e8ae11a98632129028a` | hash照合だけ |
| Phase A / Phase B / follow-up / D1-B文書 | D2 RESULT `sources.documents` と同じ | — | `b45daa27…4147` / `e05eea56…ff9c` / `335a6710…7083` / `536f8cd4…fb4f` | hash照合だけ |
| 本書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2C_SPEC.md` | — | D2-C-Bのmeasurement HEADでgit objectから計算し、start attestationへ記録する | — |

Phase B task / record（10件。record SHA-256はPhase B RESULT `sources.unitRecords` の値と一致することを本書作成時に確認済み）:

| unit | task bytes | task SHA-256 | record bytes | record SHA-256 |
| --- | ---: | --- | ---: | --- |
| `t00-r09-L0` | 775 | `12bf1ff87335fcdc0a64a157c4d45bd000309eb565c039f408382d1b4e2e9c22` | 18,982 | `bda302e7faa524ad8b9b2be5c45b9d68161fd4b73366b7b914b5846009694e77` |
| `t02-r10-L0` | 776 | `a0be4ec91b3e40212c8d23b77fd1a0ffdbf07366bd9b3da34b517368d5c75c9f` | 58,442 | `2e853e7f3e5844bdedac39162511caadef745e4d6555616d00f31712baef8a37` |
| `t02-r10-L1` | 778 | `789412c268d7936ead55e2e6f30e3d5035198a9459bd1e7ae08d48e60c9939ed` | 58,423 | `826a34702a94efd93be498c8b971057c5a33a6baf97d51ae16c99e0840ef6239` |
| `t03-r43-L0` | 776 | `824d862e4f1d1e1b05ac5e7764016258e1d89604f2153b033bdd1eb462dadf03` | 50,636 | `f5c5a7eebe78a694b3c4071770838985234c3e23500215f6f82555f445d07020` |
| `t03-r43-L1` | 778 | `f823efb2e6be62a9ceeeaf25d8f2ccac7d94420ed295bcee12acb237c5f54510` | 50,656 | `9d5dd6eb7acca9a371e0ce58e20f56a9b1a9585d7514a02f8df56f9a32a37baf` |
| `t03-r10-L0` | 776 | `9e429d74d4f6e61a1d218d86cf102115fc6a6c2f42e475daa7bfd978f42a0f7c` | 50,702 | `aa9d43ff486e02ab2f381e8ae80801e38852a142c39e5bf322fdee6671880c29` |
| `t03-r10-L1` | 778 | `27ec3aa2151836b9c0cdb0dd0d9491a2ed036733c73d38d3f05819853174b393` | 50,700 | `cbacb8afed9fc22fd95f389ea623f49512830052ee8b9b54d5c60a7641681847` |
| `t04-r43-L0` | 776 | `fc14dadb648bc479cd99b201f703f0974f2eb0a69f61e87d19c58c556645929d` | 170,718 | `41f4a9506fed0b6b77313ca804cc565d332f793ea54bf4fd4a6baae84ea04073` |
| `t04-r43-L1` | 778 | `1d5aa6449d78e79ac90b69b5a74f0ef2d1a0f4243f7ec3b666f9273a03253c80` | 170,731 | `f7cb4bb3153fc5e54e677deb7a7cfc893deeabcf4326a7e6cc169fd16d4fa49e` |
| `t10-r10-L0` | 777 | `f22a085e2a7022e509aeaa0de640014259e1f59e9a8a93c04d666bbd8ea9d3ba` | 10,538 | `8941f86729d45f4769a81be14689458ae23ba1eaae1e15f34403c22be2323db4` |

**D2 RESULTの読み取りallowlist**（D2はoracleを読んでいないが、範囲を固定する）:

- `sources.export`、`sources.specDocument`、`sources.documents`、`sources.d2.generatedEntries`（§1.1の5 fileのentryだけ）
- `provenance.formal` / `measuredHead` / `runStatus` / `calculationCodeChangedSinceMeasuredHead` / `productionChangedFiles` / `startAttestation.sha256`、
  `invalidReasons`、`decision.case`、`aggregates.evaluations`（`unmeasuredByReason` / `notExecutedByReason` / `byStatus`）、`aggregates.r6.satisfied`、
  `aggregates.discovery.pooledCandidates`
- `discovery.targets[]` の `label` / `targetWeaponId` / `currentBuildListEntryId` / `pool[].{ordinal, keySha256, generatedBuildListEntryId, generatedEntry}`
- `evaluations[]` のうち `stage ∈ { B0, ADM, CMP, Z }` の `evaluationId` / `stage` / `targetLabel` / `status` / `inputDigest` / `resultDigest` / `generatedEntryIds` /
  `generatedEntrySha256s` / `plan.termination` / `plan.steps` / `plan.selectedBuildListEntryIds` / `conflicts`（件数、B0は各要素の `kind` / `participants` / `resourceIdentity`）/
  `candidates[].{label, selected, winnerBuildListEntryId}` / `r5.satisfied` / `r1r4.R1`
- `composition.main.{steps[].{label, stepOutcome, chosen}, finalAccepted, finalResultEvaluationId, finalMetrics}`

D2 RESULTの検証条件: `provenance.formal === true`、`measuredHead === 6f66c168e9163dab02bb60b2f1dc5b1cfc531e71`、`runStatus === 'completed'`、
`calculationCodeChangedSinceMeasuredHead` が空、Production changed filesが空、`invalidReasons` が空、unmeasured / not_executedが0、`decision.case === 'D2A_EXCEEDS_D1_INCUMBENT'`、
`composition.main.finalAccepted` が§1.1の5件、`finalMetrics` が22 / 20 / 1465、`CMP-t09-c1` が§6.1の期待値、pool 32件、ADMのR1が32 / 32、
§3.1の導出が§3.2と一致、`sources.d2.generatedEntries` の5件がG store実ファイルと一致。

**Phase B RESULTの読み取りallowlist**（post-hocのoracle由来fieldを読まない）:

- `sources` のうち `export` / `targets` と、`unitRecords` のうち§10.1の10 recordのentry（`file` / `bytes` / `sha256`）。`oracle` / `oracleManifest` / `oracleModule` のentryは開かず、digest照合にも使わない
- `provenance.formal` / `measuredHead` / `runStatus` / `calculationCodeChangedSinceMeasuredHead`、`decision.case`
- `units[]` のうち§10.1の10 unitIdのentryの `unitId` / `targetIndex` / `contextRank` / `rung` / `cardinality` / `result` / `process` / `search` / `deliveries`（件数）

Phase B RESULTの検証条件はD1-A §9.1 / D2-A §8.1と同じ（`measuredHead === b24bf5dc…a004`、`decision.case === 'B2C27B_INCOMPLETE'`）に加え、10 unitがすべて `process = completed`、
`result = stopped_by_search_extent_bound`、`search.deliveredCandidates = 0` であり、task fileの (Target, support, rung, cardinality 1) が§3.2の該当contextと一致すること。

**入力検証の失敗は黙って代替しない**。ファイル不足、SHA-256 / bytes不一致、record間の不整合、§3.1の導出不一致があれば、別ファイル・再計算値・近い値で代替せず、
runnerはchildを1つも起動せずに終了し、analyzerは `D2C_INVALID`（reason category `input_evidence`）を出す。

### 10.2 measurement HEAD・provenance

- D2-C-Bのrunner / child / analyzer / test / 本書を含むmeasurement HEADを正式計測前にcommitし、Working Tree cleanの状態で計測する
- runnerはchild起動前にstart attestation（`wx`、read-only）を書く。記録するもの: 本書のSHA-256（measurement HEADのgit object）、§10.1の全digest、
  **登録policyのSHA-256**（§12の `conditions` に入る登録条件 = context表、導出規則、`K1_POOL_CAP`、ladder、重複排除規則、手順・選択順・gate・budget・envelope・decision ruleを
  `stableStringify()` したもののSHA-256）、**calculation code digest**（measurement HEADのgit objectから再計算したD2-C benchmark codeと、それが推移的にimportする
  Research計算moduleのSHA-256）、uncommitted false、Production audit（D2-C-B開始時のbase main以降のProduction changed files `[]`）、`appliedExecutionEnvelope`、
  CalculationContext、`PRODUCTION_RNG_ENGINE_VERSION`、Vで観測した§10.1の入力digest
- analyzerはattestationをmeasurement HEADのgit objectと照合し、measurement HEADがanalysis HEADのancestorであること、measurement HEAD以降の計算コード変更が `[]`、
  Production source changed files（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）が `[]` であることを確認する
- **計算コード変更後の結果流用禁止**: measurement HEAD以降に計算コードが変わった場合、そのrunを正式結果として使わない。再計測は新しいmeasurement HEADで最初から
  （V → B0 → I0 → CTX → DSC → ADM → CMP）やり直し、部分的なrecordの再利用・merge・継ぎ足しをしない。**異なるmeasurement HEADの結果を混在させない**
- 正式計測後に本書の意味論（context、規則、上限、decision）を変更しない。変更が必要になった場合は、本書の改訂を記録し、改訂後の新しいmeasurement HEADから全段階を
  再計測する（D2-A §17と同じ手順）。旧runのevidenceは監査用に保持し、正式evidenceとして採用しない
- CalculationContextが `{ 'unknown-initial', 4, 'production-rng:c5-e7', 17 }`、`PRODUCTION_RNG_ENGINE_VERSION === 'production-rng:c5-e7'` であること。D2-C-B開始時点で
  これらが動いていた場合は、D2-Cを実行せず本書の再登録を先に行う
- smoke（非formal確認）はformal run dirと別に行い、formal evidenceにしない。smokeの結果で条件を変えない

### 10.3 guardrail検査

- G1: すべての評価runで `conflictResolutions` 0件、preflightのfixed constraint 0件。support Entryを含め、resolution / scenario resolution / repair lineage /
  `selectedBuildListEntryId` を作らない（testでも確認）
- oracle isolation: runner / child / analyzerは、oracle module（`plannerGlobalOracle1657*`）・Phase B analysis module・population-authority moduleを推移的にimportしない
  （testでimport closureを検査）。Phase B / D2 RESULTはallowlistのfieldだけを読む
- D2-C-B sourceにTarget ID / Entry ID / stable keyを書かない（testで検査）。§10.1のfile名・SHA-256、§3.2 / §6.1 / §9の登録digestは登録値として置いてよい。
  context表（Target ID・support Entry ID）は §3.1の導出をVで再実行して得て、§3.2の登録値は照合にだけ使う
- 登録された順序（§8.1）・規則（§4、§5、§6）以外のunit / 評価が無い（retry、再実行、追加評価、順序違反、件数違反なし）。child process数 = 実行したCTX + DSC + 評価の数
- discovery / CMPのreplay: analyzerは記録済みの結果から§4.4のrung escalation・pool構成・重複排除、§5のadmission、§6の合成（eligible、gate、選択順、受理）を
  再実行し、記録と一致することを確認する
- S4 / S5・C1〜C5・context drift・R0の再照合（§7）
- Phase B / D1 / D2のmoduleとformal RESULT・record・G storeを変更しない（D2-C-Bは新しいmoduleからimportして使う）

### 10.4 run dir・file名

| 用途 | 名前（推奨。D2-C-Bで変えてよいが、既存名と衝突させない） |
| --- | --- |
| formal run dir | `.local/d2c-k1-formal.run/` |
| raw | `.local/PLANNER_GLOBAL_D2C_K1_RAW.json.local` |
| smoke | `.local/d2c-k1-smoke/` |
| RESULT（committed） | `docs/PLANNER_GLOBAL_D2C_RESULT.json` |
| G store | `<run dir>/<context ID>-c<context内index>.generated-entry.json` |
| CTX record | `<run dir>/CTX-<k>.context.json` |

既存の `.local/d2c-smoke1/`（2026-09-29作成）はPhase 2-C2.5-D2-Cの成果物であり、D2-Cとは無関係である。読まない、再利用しない、変更しない。
`docs/PLANNER_GLOBAL_PHASE2C25D2C_*` も同様である。

### 10.5 証拠の欠損・破損

D2-A §8.4（raw / RESULT整合）・§8.5（未計測と証拠の欠損・破損の区別）をそのまま適用する。CTX record、DSC record、評価record、G storeのいずれかが、
process outcome completedなのに存在しない、SHA-256 / bytesがjournal・raw・RESULTの `sources` と一致しない、必須fieldが欠ける場合は `D2C_INVALID`（`evidence_integrity`）
であり、未計測に読み替えない。

## 11. 事前登録条件: decision（上から順に判定）

### 11.1 比較基準（固定）

| 基準 | completed / 43 | Conflict | steps | 出典 |
| --- | ---: | ---: | ---: | --- |
| baseline（B0） | 20 | 21 | 1465 | D2 RESULT `B0`（D2-CのB0もparityで一致を要求） |
| D1 incumbent | 22 | 21 | 1465 | D1 `A-b`（読み取り専用の参照値。D2-Cでは評価しない） |
| D2-B主軸（I0） | 22 | 20 | 1465 | D2 RESULT `CMP-t09-c1`（D2-CのI0もparityで一致を要求し、比較にはI0の実行結果を使う） |

「(a, b) が (c, d) より良い」は、completedが大きい、またはcompletedが等しくConflictが少ないことをいう（stepsは比較に使わない、D2-A §9.1と同じ）。

### 11.2 decision（`decision.case`）

| decision | 条件 |
| --- | --- |
| `D2C_INVALID` | §7 / §9 / §10のformal validityに1件でも違反。parity `mismatched` を含む。reason category: `input_evidence` / `provenance` / `baseline_parity_mismatch` / `d2b_parity` / `phase_b_k1_parity` / `guardrail` / `determinism` / `evidence_integrity` / `raw_result_mismatch` |
| `D2C_INCOMPLETE` | invalid 0、かつ登録・policy-requiredなCTX / DSC / B0 / I0 / ADM / CMPのいずれかがunmeasuredまたは `not_executed`。parity `not_checked` はこの未計測が原因なのでここに含まれる |
| `D2C_GLOBAL_COMPLETE_R` | invalid 0、unmeasured 0、`finalResult` がR6を満たす |
| `D2C_EXCEEDS_D2B_MAIN` | 上記以外で、K1 Candidateを1件以上受理し、`finalResult` がI0（22 / 20）より良い |
| `D2C_K1_ACCEPTED_NOT_BETTER` | 上記以外で、K1 Candidateを1件以上受理したが、`finalResult` がI0より良くない（gateによりcompleted ≥ 22なので、completed 22でConflict ≥ 20） |
| `D2C_NO_K1_ACCEPTED` | invalid 0、unmeasured 0、K1 Candidateの受理0件（`finalResult` = I0） |

- 改善 / 改善なしの区分: `D2C_GLOBAL_COMPLETE_R` と `D2C_EXCEEDS_D2B_MAIN` が「改善」、`D2C_K1_ACCEPTED_NOT_BETTER` と `D2C_NO_K1_ACCEPTED` が「D2-B主軸からの改善なし」である。
  判定順は INVALID → INCOMPLETE → 改善 → 改善なし で変えない
- `D2C_INCOMPLETE` でも、measuredだった評価の結果、到達した受理集合、`finalResult` のcompleted / Conflict、R6到達の有無を **下限のevidence** として記録する
  （`globalCompleteObservedUnderIncomplete`、`exceedsD2bObservedUnderIncomplete`）
- decisionには修飾field `k1Accepted[]`（Target、context ID、ordinal、generated Entry ID）、`boundLimitedEvaluations[]`、`contextsWithoutCandidateMeasured[]`（全rungが正常に計測され
  poolが空のcontext）、`contextsUnmeasured[]`、`vsBaseline` / `vsD1Incumbent` / `vsD2bMain`（completed / Conflict / stepsの差）を必ず付ける
- 通常の非共存（`evaluated` でR5不成立、gate不成立、`preflight_refused`、bound-limited、support失効・非selected）はmeasuredであり、INVALIDにもINCOMPLETEにもしない
- 正常に計測された結果の不一致は `D2C_INVALID`、測定できなかったための未確認は `D2C_INCOMPLETE` であり、未確認を不一致にも一致にも読み替えない

## 12. 事前登録条件: RESULT schema（D2-C-Bで固定する必須field）

D2-C-Bのanalyzerは `docs/PLANNER_GLOBAL_D2C_RESULT.json`（committed）を出力する。raw（`.local`、commitしない）とrun dir（record、G store、CTX record、start attestation）は
Repositoryへ追加しない。次のfieldは必須で、意味を変えない（追加fieldは可）。

```text
phase                      "Issue #154 D2-C: winner-derived limited K1 discovery and set evaluation (post-hoc analysis)"
analyzedAt
sources
  specDocument             { file, sha256 }                        本書（measurement HEADのgit object）
  d2                       { result, generatedEntriesUsedByI0[5] }  各 { file, bytes, sha256 }
  phaseB                   { result, targetsManifest, tasks[10], records[10] } 各 { file, bytes, sha256 }
  phase2c2Result           { file, sha256 }
  export                   { file, bytes, sha256, committed: false }
  documents                D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B { file, sha256 }
  d2c                      { raw, runDir, attestation, contextRecords[], records[], generatedEntries[] } 各 { file, bytes, sha256 }
provenance
  formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256（calculation code digest）, registeredPolicySha256,
  calculationCodeChangedSinceMeasuredHead: [], productionChangedFiles { toMeasuredHead: [], toAnalysisHead: [] },
  startAttestation { sha256, verified, issues, body },
  d2MeasuredHead, phaseBMeasuredHead,
  oracleReadByRunner: false, oracleReadByChild: false, oracleReadByAnalyzer: false,
  d2ResultFieldsRead: [allowlist], phaseBResultFieldsRead: [allowlist], phaseBTaskFieldsRead, phaseBRecordFieldsRead: ['result.reservation'], d1SpecFieldsRead,
  d2ResultModified: false, phaseBResultModified: false, d2EvidenceReusedAsResult: false,
  oracleGuidedTargetPopulation: true, inheritsOracleInformedExtentLadder: true, inheritsOracleInformedExecutionEnvelope: true,
  supportDerivedFromD2ProvisionalWinners: true, speculativeSupportWrittenAsResolution: false, k0SearchInD2C: false, k2SearchInD2C: false,
  alternativeToAlternativeSupport: false, productionSemanticsChanged: false
environment                runtime, node, v8, platform, cpu, logicalCpuCount, totalMemoryBytes, rngEngineVersion, calculationContext, appliedExecutionEnvelope, machine
conditions                 scopeTargets, contexts（§3.2）, derivationRule（§3.1）, supportCapPerTarget: 2, k1PoolCap: 2, ladder, dedupRules（§4.3）,
                           discoveryRule（§4）, admissionRule（§5）, incumbent（§6.1）, compositionRule（§6.2）, r5Definition（§6.3）, gate, selectionOrder（§6.4）,
                           r6Definition（§6.5）, contextChecks（C1〜C5）, supportChecks（S1〜S5）, supportExpiryCauses（§7.3）, budgets（§8.3）, order（§8.1）,
                           executionEnvelope（§8.4）, researchMaxPlanSteps, evaluationFullRunCap: 8, decisionRule（§11、文字列配列）, comparisonBaselines（§11.1）, notRun
inputValidation            { passed, issues[], derivedContexts[] { contextId, targetWeaponId, supportBuildListEntryId, observations, observedEvaluations, b0Selected } }
contexts[7]                { contextId, k, label, targetWeaponId, currentBuildListEntryId, supportBuildListEntryId, supportTargetWeaponId, observations, observedEvaluations,
                             orderInTarget, status, unmeasuredReason, notExecutedReason, process,
                             record { file, bytes, sha256 }, supportBodySha256, reservationDigest, reservationBody, originDigest, excludedRouteKeySha256s[],
                             checks { C1, C2, C3 { referencedOwnedWeaponIds[], exclusiveOwnedWeaponIds[], satisfied }, C4, C5 { state, expectedDigest, phaseBUnitIds[], bodyMatched[] } },
                             discoveryStop: discovery_cap_reached | discovery_exhausted | ladder_exhausted | unmeasured | not_executed,
                             discoveryIncompleteAfterUnmeasured }
discovery
  units[]                  { unitId, contextId, label, rung, extent, status, unmeasuredReason, notExecutedReason, process, searchIdentity, reservationDigest,
                             poolSizeAtStart, poolSizeAtEnd,
                             deliveries[] { indexInUnit, keySha256, cost, r0, action: pooled | duplicate_of_lower_rung | same_key_as_d2b_k0_pool, d2bK0Ordinal },
                             search { deliveredCandidates, excludedCandidates, exhausted, stoppedByExtent, stoppedByConsumer, skippedExcludedRouteKeys },
                             phaseBParity { state, phaseBUnitId, mismatches[], notChecked, observedPrefixDiagnostic },
                             searchOnlyMs, materializeMs, wallMs, peakHeapBytes, peakRssBytes }
  targets[6]               { label, targetWeaponId, contextIds[],
                             pool[] { ordinal, contextId, unitId, rung, indexInUnit, candidateStableKey, keySha256, cost, routeKind, routeOperationCount, r0,
                                      searchIdentity, reservationDigest, contextRecordSha256, requiresSupport[], generatedBuildListEntryId, reusedExisting,
                                      generatedEntry { file, bytes, sha256 }, replacement { status, replacedBuildListEntryId }, crossContextSameKey[] } }
evaluations[]              D1-A §8の `evaluations[]` の全fieldに加えて
                           { stage: B0 | I0 | ADM | CMP, poolOrdinal, contextId,
                             rejectedBuildListEntries[] { buildListEntryId, reason }, resourceConflictRejections, selectedTargetWeaponIds[],
                             referenceDiff { referenceEvaluationId, completedDelta, conflictDelta, stepsDelta, targetsGained[], targetsLost[] } | null,
                             gate { judged, referenceCompleted, proposedCompleted, satisfied }, r5OnlyEligible, eligible,
                             r5 { judged, conditions, satisfied, failureReasons[] },
                             supportChecksByEntry { [s]: { S1, S2, S3, S4, S5 { digestExpected, digestObserved, digestMatched, bodyExpected, bodyObserved, bodyMatched, satisfied },
                                                          selected, supportExpiryCause | null } },
                             r6 { judged, conditions, satisfied },
                             r1r4（ADMのみ）{ R1, R1FailureReason, R2, R3, R4, supportVacuous: false, targetRegressedR, foundRDiagnostic, winnerBuildListEntryId, conflictCoParticipants[] },
                             d2bParity { state, matchedD2EvaluationIds[], resultDigestsEqual, notChecked } }
parityChecks[]             { checkId, kind: baseline | d2b_incumbent | phase_b_k1_context | phase_b_k1_prefix | determinism_d2c | determinism_d2b,
                             state: matched | mismatched | not_checked | not_applicable, subjects[], expected, observed, mismatches[],
                             notChecked { dependsOn[] { id, status, unmeasuredReason, notExecutedReason } } | null, observedPrefixDiagnostic | null, category }
composition
  main                     { i0EvaluationId, initialAccepted[5], steps[6] { label, acceptedBefore[], evaluatedCandidates[] (evaluationId, ordinal, contextId), eligible[], chosen | null,
                                         stepOutcome: accepted | not_replaced_no_admitted | not_replaced_no_eligible | step_unmeasured, acceptedAfter[], afterUnmeasuredStep },
                             finalAccepted[] { label, ordinal, contextId | null, generatedBuildListEntryId, requiresSupport[], fromD2B: boolean },
                             finalResultEvaluationId, finalMetrics { completed, conflicts, steps } }
comparison
  vsBaseline / vsD1Incumbent / vsD2bMain   { completedDelta, conflictDelta, stepsDelta, better: boolean, equalMetrics: boolean }
  targets[6]               { label, contexts[] { contextId, discoveryStop, poolSize, admittedCount }, mainOutcome, acceptedOrdinal, acceptedContextId,
                             targetsGainedWhenAccepted[], targetsLostWhenAccepted[], winnersObserved[]（診断）, supportNotSelectedEvaluations[], supportExpiredEvaluations[] }
aggregates
  contexts                 { registered: 7, executed, byStatus }
  discovery                { registeredUnitsMax: 21, executed, byStatus, pooledCandidates, byAction, searchOnlyMs, wallMs }
  evaluations              { registeredMax: 30, executed, measured, unmeasuredByReason, notExecutedByReason, byStage, byStatus }
  childProcesses           { registeredMax: 58, started }
  fullPlannerRunsStarted   合計（評価リクエスト数とは別）
  runtimeUnsupportedRetries
  r5                       { judged, satisfied }
  r6                       { judged, satisfied, satisfiedEvaluationIds[] }
  boundLimitedEvaluations[]
  supportOutcomes          { notSelected, expiredByCause }
  determinismCrossChecks[] { inputDigest, evaluationIds[], d2EvaluationIds[], comparableEvaluationIds[], state, resultDigestsEqual }
  parity                   { byKindAndState, mismatched[], notChecked[] }
  timing                   { contextWallMs, discoveryWallMs, evaluationWallMs, runWallMs, discoveryEnvelopeReached, runEnvelopeReached }
  memory                   { peakHeapBytes, peakRssBytes }
invalidReasons[]           { category, detail }
decision                   { case, reasons[], lowerBound: boolean, k1Accepted[], boundLimitedEvaluations[], contextsWithoutCandidateMeasured[], contextsUnmeasured[],
                             vsBaseline, vsD1Incumbent, vsD2bMain, globalCompleteObservedUnderIncomplete, exceedsD2bObservedUnderIncomplete }
```

## 13. 事前登録条件: 言えること・言えないこと

### 13.1 decisionごと

- `D2C_GLOBAL_COMPLETE_R`: このExport・6 Target・7 K1 context・登録ladder・Research envelopeで、D2-B主軸集合へのK1 Candidateの単調追加により、43 / 43、Conflict 0、
  `resource_conflict` 0、Trace Replay成功のPlanに到達した。Production runtimeとしての許容、別Export・別populationへの一般化、Production semanticsとしての妥当性
  （REQUIREMENTS 23の契約変更が先）は言えない
- `D2C_EXCEEDS_D2B_MAIN`: 阻害Entryをsupportとするcontextで見つけたK1 Candidateを加えて、D2-B主軸（22 / 20）より良い完成・Conflictの集合を得た。R6には達していない
- `D2C_K1_ACCEPTED_NOT_BETTER`: K1 CandidateはR5とgateを満たして受理されたが、集合全体の完成・ConflictはD2-B主軸より良くならなかった
- `D2C_NO_K1_ACCEPTED`: **K1 Candidateで改善できないことの証明ではない**。言えるのは「登録した7 context（provisional winner由来、support 1件）、contextあたり2件以下のCandidate、
  R1 admission、D2-B主軸集合からの単一pass・Target ID昇順の単調合成、非後退gateで評価した範囲では、K1 Candidateを受理しなかった」ことだけである
- `D2C_INCOMPLETE`: measuredな範囲の結果は下限であり、「unmeasuredが無ければ同じ結果だった」とは主張しない。未計測のcontext・rungでCandidateが存在しない、
  非共存である、extentが足りないとは主張しない

### 13.2 共通

- D2-Bより改善できなかった場合も、**K1全体で改善できないとは結論づけない**。未評価のもの: winner以外のsupport（co-participant）、support 2件以上（K2）、
  contextあたり3件目以降のCandidate、別のextent、D2-BのK0 Candidateの再評価、別の合成順・複数pass・同時置換、alternative-to-alternative support
- R5成立は、置換集合としての共存（`G` とその前提supportの同時selected、support依存の有効性、集合内Conflictなし）だけを示し、集合外Targetの完成やConflict 0を示さない。
  **R5成立をIssue #154の最終Acceptanceと混同しない**（43 / 43・Conflict 0・`resource_conflict` 脱落0・Trace Replay成功はR6で別に検証する）
- admission（R1）とGlobal採用（R5 + gate）を混同しない。`found_R` / R2 / R3 / R4 / `target_regressed_R` は診断である
- supportがbaselineで勝者だったことは、support contextのCandidateが共存することを示さない（follow-up §5.2）
- I-D2C-4（K1 Candidateも他の暫定帰結に負けるかもしれない）は予想であり、結果がどうであっても一般化しない
- E1 / 6 Target / 7 contextはoracle-informedなpopulationの部分集合であり（`oracleGuidedTargetPopulation = true`）、別populationへの一般化は主張しない

## 14. 既存API（D2-C-Bで使う部品。Production変更なし）

| 用途 | 既存の部品（module） |
| --- | --- |
| baseline PlannerInputとResearch依存（固定ID Factory、定数Clock） | `globalResearchInputFromExport(Export, 20000)` / `globalResearchDependencies(engine)`（`src/benchmarks/plannerGlobalOptimizationResearch.ts`） |
| population manifest | `parsePhase2C27BTargetManifest()`（`plannerGlobalPhase2C27B.ts`） |
| K1 contextの準備（origin、reservation、`excludedRouteKeys`、現在Entry） | `derivePhase2C26B2C1Schedule()`（`plannerGlobalPhase2C26B2C1.ts`、origin digest照合）+ `phase2c27bResolveSupportContext(input, dependencies, targetWeaponId, [s])`（`plannerGlobalPhase2C27B.ts`。Phase B K1 / D2 K0と同じ経路。内部で `derivePlannerAlternativeReservation()`、`candidateStableKey(invalidated.candidateSnapshot)`、`createPlannerStartSearchOrigin()` を使う） |
| reservation | `derivePlannerAlternativeReservation(fixedEntries, engine)`（`src/domain/planner/alternative/plannerAlternativeReservation.ts`）。fixed Routeの参照OwnedWeapon（`collectReferencedOwnedWeaponIds()`）と排他消費OwnedWeapon（unit planの `exclusiveConsumedOwnedWeaponId`）を `exclusiveOwnedWeaponIds` に入れ、held / blocked位置をstreamごとに導出する |
| Search | `visitPlannerAlternativeCandidates()`（`src/domain/search/alternative/plannerAlternativeSearch.ts`）。capture policy・instrumentationは渡さない |
| Candidate identity | `candidateStableKey()`、`createPlannerAlternativeSearchIdentity()`（Target、origin、CalculationContext、extent、reservation、`excludedRouteKeys`、route policyから決まる。`searchRunId` になる） |
| materialization | `createPlannerAlternativeMaterializer({ ...searchInput, clock })`。generated Entry IDは `deterministicEntryId()`（Candidate意味のfingerprint、Target定義hash、`searchStateHash`、`referencedOwnedWeaponsHash`、CalculationContext）で決まり、Search identityを含まない（§4.3 D-3の根拠） |
| R0 reservation check | `summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`（`plannerGlobalPhase2C2.ts`、Phase B / D2と同じ） |
| replacement / preflight | `resolveBuildListEntryReplacement()`、`preparePlannerInitialContext()`、`createPlannerConflictContexts()`、`preparePlannerReplacementConflictPreflight()` |
| full run | `createPlannerAlternativeFullRunner()` + Research budget（limit 8、`createPhase2C27BLadderRerunBudget(8, 0)` と同じ形）。内部は `createProductionPlanWithObserver()` + Trace Replay |
| 診断の `found_R` | `judgePlannerAlternativeTrial()`（explicit decision = fixed Route = support = `[s]`） |
| 評価run・digest・R5（import only、変更しない） | D2の `runD2Evaluation()`（`D2ReplacementTask.requiresSupport` / `supportReservationDigest` / `supportReservation` にCTX recordの値を渡す）、`d2R1R4()`、D1の `d1InputDigest()` / `d1ResultDigest()` / `judgeD1R5()` / `d1B0Parity()` / `d1TrialRunSummary()` / `d1RuntimeUnsupportedRemoved()` / `isD1BoundLimited()` |
| discovery outcome | D2の `d2DiscoveryUnitOutcome()` / `d2DiscoveryNext()`（cap値はD2-Cの2を渡すか、同じ規則をD2-C moduleで表す） |
| hash | `hashStableValue()`、`stableStringify()` |

- 実装名の推奨（D2-C-Bで変えてよい）: `src/benchmarks/plannerGlobalD2C.ts`、`src/benchmarks/plannerGlobalD2CAnalysis.ts`、`src/benchmarks/plannerGlobalD2C.test.ts`、
  `scripts/run-planner-global-d2c.mjs`、`scripts/analyze-planner-global-d2c.mjs`。既存の `plannerGlobalPhase2C25D2C*` と混同しない名前にする
- D2の `runD2DiscoveryUnit()` はK0のcap 3と重複規則D-2だけを持つので、D2-CのD-4・cap 2・context driftはD2-C moduleで実装する。D2 / D1 / Phase Bのmoduleは変更しない
- 既存部品で本書の規則を表現できないことが分かった場合は、別の判定を発明せず、本書の更新（docs）を先に行う

## 15. guardrail（follow-up G13〜G18、D1-A G19〜G22、D2-A G23〜G28に追加）

| ID | guardrail |
| --- | --- |
| G29 | D2-CのSearchは§3.2の7 K1 contextだけで行う。K0 / K2 context、co-participant support、D2-Cの結果から追加導出したsupportでSearchしない |
| G30 | support EntryはExportの元Entryのまま通常のBuild List Entryとして扱い、user-fixed Route、resolution、scenario resolution、repair lineage、fixed constraint、`selectedBuildListEntryId` にしない |
| G31 | 異なるsupport context（K0を含む）のCandidateを、`candidateStableKey()` やgenerated Entry IDが同じという理由だけで同一視・mergeしない。1回のPlannerInputには各Target高々1件 |
| G32 | D2-BのRESULT・G store・recordは入力evidenceとparity期待値としてだけ使い、D2-Cの集合評価の実行結果として流用しない（I0をfresh runする）。D2-Bのevidenceを変更しない |
| G33 | S4 / S5（静的）の不成立は `D2C_INVALID`、S1〜S3（動的）の不成立は `support_expired_R`（R5偽）として区別する。失効したsupportを自動で再解釈・再Searchしない |
| G34 | timeout / OOM / Search extent bound / `not_executed` を、Candidate不存在・非共存・extent不足の証明として扱わない |
| G35 | Search ordering、Candidate semantics、extent、origin、`excludedRouteKeys`、現在Entryの意味を変えない。discovery中にtrialせず、`found_R` を停止条件にしない |
| G36 | D2-Cの結果をPhase B / D1 / D2のRESULT・decision inputへ戻さない。Phase B / D1 / D2のmodule・RESULTを変更しない |

Issue #154はCloseしない。

## 16. 未決事項（D2-Cの外、またはD2-C-B以降）

D2-Cの判定に必要な意味論は本書で確定した。次はD2-Cの外の事項である。

1. D2-C-Bの実装名（module / script / field綴り）。§12の必須fieldの意味と§11の判定順序は変えない
2. 合成の複数pass（不受理Targetの再評価、D2-Bで不受理だったK0 Candidateの新しい受理集合に対する再評価）、合成順序の変更、同時置換の探索
3. support候補の拡大: winner以外のConflict co-participant、1 Targetあたり3件目以降のwinner、support 2件以上（K2 context）
4. alternative-to-alternative support（生成Entryをsupportにする）と、その失効伝播・循環防止規則（9.2.19.10と同種）
5. `K1_POOL_CAP` の拡大（contextあたり3件目以降）、K1 L2より広いextent
6. L2がunmeasuredになった場合の再計測を、別のenvelope（unit上限、concurrency、heap）の別axisとして登録するか
7. population拡大（baseline未完成23 Target、43全体）、E2、residual 3
8. Phase 0 projected-state方式（42 / 43）との比較（follow-up X4 / X5）
9. Production化に伴うREQUIREMENTS 23の契約変更の要否（follow-up §10）

## 17. D2-A / D2-A §13.2からの変更・追加点

| # | D2-A（または§13.2の設計候補） | 本書で正式に採用する条件 | 理由 |
| --- | --- | --- | --- |
| 1 | context K0のみ | §3.2の7 K1 context（support 1件、provisional winner由来） | D2-Bで不受理の6 Targetの阻害Entryに限定して、Phase BのK1全件走査（42 context × rung）を繰り返さないため |
| 2 | §13.2: 勝者を最大2件、観測回数降順・Entry ID昇順 | そのまま採用（`SUPPORT_CAP_PER_TARGET = 2`）。観測源をD2-BのADM / CMP / Zに固定し、co-participantは使わない | 導出を機械的・有界にするため |
| 3 | `POOL_CAP = 3`（Targetあたり） | `K1_POOL_CAP = 2`（contextあたり、全体14） | 評価件数を30以下に保つため |
| 4 | discoveryはTarget内L0 → L1 → L2（context-major相当） | rung-major（7 contextのL0 → L1 → L2） | rung進行は順序に依存せず、未計測のL2をenvelopeの最後に置くため |
| 5 | 重複排除はrung間だけ | D-1〜D-4の4層（context間は同一視しない、D2-BのK0 poolと同じkeyは対象外） | support contextの異なるCandidateの同一視を防ぎ、K0 Candidateに依存を付け足さないため |
| 6 | 集合評価の起点は空集合（主軸）/ D1 incumbent（Z） | D2-B主軸受理集合のfresh再評価（I0）。Z軸は置かない | D2-Bの最良集合への追加を測るため。過去RESULTを実行結果として流用しないため |
| 7 | S5の比較対象はPhase B t09 record | CTX recordのreservation body / digest（Phase B recordは存在するcontextでparityとしてだけ照合） | 新しいcontextに既存recordがあると仮定しないため（D2-A §17のRequired fixの趣旨を一般化） |
| 8 | run envelope 12時間 | discovery envelope 9時間 + run envelope 12時間、CTX 10分 | K1 L2が長引いても評価段階を残すため |
| 9 | decision `D2A_*` | `D2C_*`（比較基準にD2-B主軸を追加、K1受理有無で改善なしを2分割） | D2-Bとの差を判定の中心にするため |

## 18. validation

- `git diff --check`
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無い。結果はPRに記載）
