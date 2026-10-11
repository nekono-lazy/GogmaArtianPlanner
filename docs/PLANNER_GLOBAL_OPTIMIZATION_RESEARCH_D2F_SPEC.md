# Global Planner Research D2-F（t03の3-support K3 context探索とD2-D最良incumbentへの追加評価の事前登録）

Refs #154。**docs-only**。基準main: PR #232 merged `cb8426f86be94efda46e7f2d1f2f2be68b353f46`（作業開始時に `main` / `origin/main` / HEADの一致、
Working Tree clean、stashなし、worktreeは1件だけ、実行中のResearch process（node）なしを確認。本書が使う `.local` evidence（D2-Eのrun dir
`.local/d2e-k2-formal2.run/` のCTX-K2 record・G store・I0 / EXT record・start attestation、raw `.local/PLANNER_GLOBAL_D2E_K2_RAW2.json.local`、
D2-Cのt03 K1 CTX record 2件、Export）のbytes・SHA-256が正式RESULTの記録と一致することを確認）。

本書は [D2-E-B](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2EB.md) §5で次Phase候補とした「`EXT-K2-t03-c2` でt03と交換になった `54dd2b4e` を、t03と同時に扱う」
案のうち、**`54dd2b4e` をt03のsupportへ加えた3-support K3 contextでt03だけを再Searchし、得たCandidateをD2-D最良incumbent（24 / 19）へ1件ずつ追加して評価する**
ことだけを、実装・計測より前に確定する事前登録である。本書ではResearch項目名を **D2-F**、本書による事前登録を **D2-F-A**、実装と正式計測を **D2-F-B** と呼ぶ。
Phase 2-C2.5系（`docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C25*.md`、`plannerGlobalPhase2C25*`）とは別のResearch項目である。本書作成時点で
Phase 2-C2.5-D2-Fという成果物は存在しない（`docs/`・`src/benchmarks/`・`scripts/`・`.local/` に `2C25D2F` / `D2F` を含む名前は無い）が、将来作られた場合も
名称・file・run dirを混同しない（§11.4）。

本PRで変更していないもの: Production source、Search / Planner / RNG、Worker、UI、Persistence、schema / version、Production default / bounds、
既存formal RESULT（Phase B / D1 / D2 / D2-C / D2-D / D2-Eを含む）、既存Research文書（Research索引へのリンク追加を除く）、既存Research runner / analyzer / module / test、
正式仕様の意味論。新規Search run、Candidate delivery、materialization、full Planner run、Trace Replay、formal measurement、RESULT JSON生成、oracle読み取りは行っていない。

§1の値は、既存committed RESULT、既存 `.local` record / G store / CTX recordのSHA-256照合と読み取り・数え上げ、および§1.6のreservation導出だけで得た。
§1.6は、Repositoryへ追加しないscratch scriptで既存の純粋な導出部品（`phase2c27bResolveSupportContext()` = `derivePlannerAlternativeReservation()`、
`derivePhase2C26B2C1Schedule()`、`createPlannerRouteUnitPlans()`、`collectReferencedOwnedWeaponIds()`、`summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`）を
HEAD `cb8426f` で読み取り専用に呼んだものである（Search・materializer・full Planner run・Trace Replayを呼んでいない。Vite SSR loaderの起動を含むwall 35.5〜38.3 s、
heap 0.48〜0.52 GB、2回実行して同じ値）。**非formal**であり、formal authorityはD2-F-BのCTX record（§5.1）である。登録値はその照合期待値としてだけ使う。

本書の各節は次の4種類のどれかであり、見出しに明記する。

| 種類 | 意味 | 節 |
| --- | --- | --- |
| **事実** | D2 / D2-C / D2-D / D2-Eの既存formal RESULT・record・G store・文書から読み取った値と、§1.6の非formal導出値（本書で新しく計測していない） | §1 |
| **事前登録条件** | D2-F-Bが変えてはならない実行条件・判定規則 | §2〜§14、§16、§18 |
| **既存API** | D2-F-Bが使う既存の部品と、新規に必要なResearch処理の区別（Production変更なし） | §15 |
| **未決事項** | D2-Fの外、またはD2-F-B以降に決めること | §17 |

## 0. 位置づけとauthority

本書はResearch文書であり、正式仕様ではない。正式仕様のauthorityは `AGENTS.md` の順位どおり `docs/REQUIREMENTS.md`（19 / 20 / 23 / 23.1）→
`docs/PLANNER_SPEC.md`（7、9.2.3.1、9.2.18、9.2.19）/ `docs/SEARCH_SPEC.md`（5.6.8）→ その他の正式文書 → 実装 → test → Research文書である。
D2-FはResearch-onlyであり、REQUIREMENTS 23（明示的な選択が無い競合について自動で再検索しない）、Planner Alternative（9.2.19.1〜9.2.19.16）、RNG、Search、UI、
Persistence、schema / version、Production default / boundsの意味論を変更しない。複数support Entryを同時にreservationへ含めるK3 context、置換集合の一括評価、
support Entryの扱いはResearch harnessの中だけのものであり、Productionの動作（9.2.19.3のuser-fixed Route reservation、9.2.19.8.1のscenario composition）ではない。

D2-Fの判定に使う順位（上を優先し、矛盾は報告してD2-F-Bを止める。本書は正式仕様の意味論を変えられないので、本書の規則が正式仕様の変更を要する場合も止める）:

1. `docs/REQUIREMENTS.md`
2. 本書（D2-F-A事前登録）
3. `docs/PLANNER_SPEC.md` / `docs/SEARCH_SPEC.md`
4. その他正式仕様
5. D2-E-A（[`PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md`](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md)）、D2-D-A、D2-C-A、D2-A / D1-A / follow-up / Phase A（R0〜R6、G1〜G52の出典）
6. 実装 / test
7. D2-E-B / D2-D-B / D2-C-B / D2-B / D1-B（evidenceの要約）、過去Research

既存Researchのformal RESULTは **evidence** であり、Production仕様のauthorityではない。本書が「D2-E-A §X をそのまま適用する」と書いた規則は、本書の読み替え
（K2 → K3、`D2E_*` → `D2F_*`、support 2件 → 3件など）を施したうえで本書の規則として適用する。D2-F-Bは本書の規則だけで判定でき、実装時に意味論を追加決定しなくて済むことを目標とする。
実装名（module / 関数 / fieldの綴り）はD2-F-Bで決めてよいが、§13のRESULT必須fieldの意味と§12の判定順序を変えてはならない。変える必要が生じた場合は、
D2-F-Bの正式計測前に本書を更新する（docs PR）。

## 1. 事実（D2-Eから確認されたこと。本書で再計測していない）

### 1.1 D2-E-Bの正式結果（`docs/PLANNER_GLOBAL_D2E_RESULT.json`、409,430 bytes、SHA-256 `c80f44a8e94dc80a34d9651a7b4f2d8c1242a0e71edaed95d2d7c9d7f0472d58`）

| 項目 | 値 | 出典（D2-E RESULT） |
| --- | --- | --- |
| formal validity | `provenance.formal = true`、`runStatus = completed`、`invalidReasons = []`、unmeasured 0、not_executed 0、bound-limited 0、envelope未到達、`oracleReadBy{Runner,Child,Analyzer} = false`、`oracleGuidedTargetPopulation = true` | `provenance`、`aggregates`、`decision` |
| provenance | measurement HEAD = analysis HEAD `d294efb005e4943627f3ed27873a33ed7ead8173`、start attestation `6d6c4629cb11cf4f7e26b2c3ed62b3054dd4b5ddcc036b115ffd7fb0cd21b811`（verified）、calculation code digest `2fa915045f8066b8aa6167f1623bcf3a04892e05991692e8b2b236a1c7628d05`、登録policy `8a123601cac3dd5e33381fabbbfbdff66c775fcd9cf1475c576cfd904c1f6292`、`calculationCodeChangedSinceMeasuredHead = []`、Production changed files `[]` | `provenance` |
| D2-E-A文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md`（127,982 bytes、`9bbb824169ac22364b451b6313730c7e2042b181db8557dbfeec359f8fa14797`）。現在のmainの実ファイルと一致 | `sources.specDocument` |
| D2-E-B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2EB.md`（20,134 bytes、`fc1d39d43538ecf4b17525c37e3929718f0495c5d0903e73701c8abb0420e498`） | 本書作成時の実ファイル |
| decision | `D2E_SET_COEXISTENT_NOT_BETTER`、`bestEligibleExtension = EXT-K2-t03-c2`、`bestImprovedExtension = null`、`improvementKind = null`、`t03CompletedWithoutNetGainExtensions = [EXT-K2-t03-c2]` | `decision` |
| I0 | 24 / 43、Conflict 19、steps 1465、`exhausted`、`inputDigest fnv1a32:6493291d`、`resultDigest fnv1a32:57dbb4e5`、R5成立、`resource_conflict` 19。D2-D `PAIR-t05c1-t07c3` とparity matched | `evaluations[I0]` |
| CTX-K2 | `K2-t03-92d87b90-e396d352`、`context_ready`、C1〜C7成立、`reservationDigest fnv1a32:fd85c864`、origin `fnv1a32:ff018910`、`conflictContextCount = 21` | `context` |
| discovery | `cap_reached`。L0 / L1 0件、L2で2件pool（`DSC-K2-L2` 671.2 s、heap 6.00 GB、RSS 6.55 GB） | `discovery` |
| evaluations（`inputDigest` / `resultDigest`） | B0 `6f151dc3` / `880bbb52`、I0 `6493291d` / `57dbb4e5`、ADM-c1 `980bd7c4` / `2ee1491f`、ADM-c2 `79f1f649` / `ff47247b`、EXT-c1 `2ef36ad4` / `2199a8eb`、**EXT-c2 `2f7009bf` / `03e2ef58`**（すべて `fnv1a32:`） | `evaluations[]` |

D2-E-B run dirのevidence（`.local/d2e-k2-formal2.run/`）: start attestation `start-attestation.json`（32,853 bytes、`6d6c4629…b811`）、raw
`.local/PLANNER_GLOBAL_D2E_K2_RAW2.json.local`（31,753 bytes、`c092429263dd4300b2dcdf67d1c36bfbcb21024b96030844db908311ab3081ad`）、
`CTX-K2.context.json`（100,563 bytes、`3feb35a7e5746ae2970e8ce64e29bc3bf72aff5b63f54fb056634de7027ee9e4`）、
K2 G store c1 `K2-t03-92d87b90-e396d352-c1.generated-entry.json`（157,999 bytes、`3e23248a3053a4696020a14d5e78c544236ce2cae7ddf81b0a353dc526458286`）、
K2 G store c2 `K2-t03-92d87b90-e396d352-c2.generated-entry.json`（158,357 bytes、`b1ac6a83fed5d956fa50c19d415161a33490ab72055d219dfc3a5378135410f4`）、
`I0.record.json`（522,522 bytes、`18d166eb…b9f7`）、`EXT-K2-t03-c2.record.json`（525,971 bytes、`280ee01d…2bff`）。いずれもD2-E RESULT `sources.d2e` と一致した。
旧measurement HEAD `c0248fc` のrun（`.local/d2e-k2-formal.run/`、raw `PLANNER_GLOBAL_D2E_K2_RAW.json.local`）は正式結果ではないので、D2-Fの入力・照合に使わない。

### 1.2 D2-Eで確認された失敗構造（`EXT-K2-t03-c2`、診断）

| 項目 | 値 |
| --- | --- |
| 置換集合 | I0の9件（§1.4）∪ { t03: K2 c2 `build-list.constrained.fnv1a32-b9c3b154` }、`requiresSupport = [92d87b90, e396d352]` |
| 全体 | 24 / 43、Conflict 19、steps 1470、R5成立、集合内Conflict 0、incumbent 9件の `G` は全件selected、support 3件（`61066e62` / `92d87b90` / `e396d352`）はselected・失効0 |
| 得失（I0比） | 獲得 `188571a7-b480-4085-a8f5-59666c0e4cc5`（t03）、喪失 `9d817a9b-4a79-4430-aa13-48ecab0055d6`。`t03CompletedWithoutNetGain = true`、net ±0 |
| t03 `G` を含むConflict | `same_skill_counter` Skill 648 {`b9c3b154`（t03 `G`）, `54dd2b4e`, `b4b4c72c`}、`same_gogma_counter` Gogma 125 {`b9c3b154`, `54dd2b4e`}。いずれも `selectedBuildListEntryId = null`、`withinSet = false`（相手はすべて `outside_set`） |
| `rejectedBuildListEntries`（関係分） | `54dd2b4e`・`b4b4c72c` が `resource_conflict`（I0では `b4b4c72c`・`dd79ecce` が `resource_conflict` で、`54dd2b4e` はselected） |
| D2-Cのt03資源 | Skill 341 / Gogma 71（D2-Cで相互support阻害が起きた位置）はt03 `G` のConflictとして現れなかった。Skill 648 / Gogma 125は現れた |

- **構造**: K2 reservation（§1.6）は2 support（`92d87b90` / `e396d352`）の資源だけを保持し、Skill 648 / Gogma 125を保持しない。K2 Candidate c2はその2位置を使う
  Routeであり、置換集合外のExport Entry `54dd2b4e`（I0でselected、Target `9d817a9b…` を完成させていた）に勝ってそのTargetを奪った
- `EXT-K2-t03-c1` はincumbent t00（`build-list.constrained.fnv1a32-1d2ed2a8`、K1 `e396d352` 依存）とSkill 344で集合内Conflictになり、t03 `G` が非selectedになった
  （24 / 20）。Skill 648 / Gogma 125のConflictも持っていた
- resource identityの全文: Skill 648 `{"counterBefore":648,"counterStream":"skill","kind":"same_skill_counter"}`、Gogma 125 `{"counterBefore":125,"counterStream":"gogma","kind":"same_gogma_counter"}`、
  Skill 344 `{"counterBefore":344,"counterStream":"skill","kind":"same_skill_counter"}`

### 1.3 追加support候補 `54dd2b4e` と除外する `b4b4c72c`

| 項目 | `build-list.fnv1a32-54dd2b4e` | `build-list.fnv1a32-b4b4c72c` |
| --- | --- | --- |
| Target | `9d817a9b-4a79-4430-aa13-48ecab0055d6`（Export上でこのTargetを持つEntryはこの1件だけ） | `86439c85-0efc-40ba-b490-e39ab38aa1e0` |
| Export body | 1件、`stableStringify()` のSHA-256 `2dd3ca57807e428907d350d3dd1158af664ea262134d82bf01d7a49ecaf67b81`、`isStale = false`、CalculationContext `{ unknown-initial, 4, production-rng:c5-e7, 14 }`（`92d87b90` / `e396d352` と同じ。build-result例外 `17 -> [12..16]` の範囲） | — |
| Route | `existing_gogma_mixed`、source OwnedWeapon `da8d7cf3-2abc-410a-8e51-bfe49977367b`、379 operation（`keep_bonuses` ×71、`reset_skills` ×308） | — |
| E1との関係 | E1 11 Target（D2 RESULT `discovery.targets[]`）に含まれず、いずれのE1 Targetの `O_t` でもなく、生成Entry prefixでもなく、t03のEntryでもない | — |
| B0 / D2-D best / D2-E I0 | **selected** / **selected** / **selected**（Target `9d817a9b…` もI0で完成） | 非selected（`resource_conflict`） / 非selected / 非selected |
| I0のSkill 648 Conflict | participant（`54dd2b4e` / `b4b4c72c` / `dd79ecce`） | participant |
| D2-Fでの扱い | **K3の追加support**（§3の規則で機械導出） | supportにしない（§3.1の規則でI0非selectedのため対象外、依頼のscope外） |

- t03の既存2 support（`92d87b90`: Target `cbdf9d8f-07d8-4b30-b5b3-5d8f1ab23b4a`、`e396d352`: Target `820831d0-edd9-4005-a4a2-c8025cdad2c2`）も、
  E1外・I0でselectedであることをD2-E RESULT（`context`、`evaluations[I0].plan.selectedBuildListEntryIds`）とD2-D RESULTで確認した
- 3 supportのTargetは互いに異なり、いずれもt03（`188571a7…`）ではない

### 1.4 D2-D最良incumbent（I0の集合、9 Candidate）

D2-E-A §1.2の表をそのまま使う（Target ID昇順: t00 / t01 / t04 / t05 / t06 / t07 / t08 / t09 / t10、G store 9件のfile・bytes・SHA-256・generated Entry ID・
Search identity・`candidateStableKey` SHA-256・`requiresSupport`・Search当時のreservation）。本書作成時に9件のbytes・SHA-256がD2-E RESULT `sources.incumbentGeneratedEntries`
と一致することを確認した。I0の `S_sup = { 61066e62, 92d87b90, e396d352 }`、`inputDigest fnv1a32:6493291d`。

### 1.5 t03の既存Candidate pool（重複排除の参照値）

| 由来 | ordinal | `candidateStableKey` SHA-256 | G store |
| --- | ---: | --- | --- |
| D2-B K0 | 1 / 2 / 3 | `2cb15341b91ab2d3d18a48f8e9146d0b8d71460b928351f28f7ae10815aea0d2` / `cbbe70c72d7bcea8df059ab5696a9410d1dda7d6975b13d6630f2995e0dc5d4c` / `8dc107d23913ca14d90d08d02c60f45fe415b012113e7e0b2f2d030740449c88` | `.local/d2-formal2.run/t03-c{1,2,3}.generated-entry.json` |
| D2-C K1 | 1 / 2（`K1-t03-92d87b90`）、3 / 4（`K1-t03-e396d352`） | `adbd02ac…24ee` / `1caa2227…412f` / `099088f2…50d4` / `3ee9c9a3…8882`（全文はD2-E-A §1.4） | `.local/d2c-k1-formal.run/K1-t03-*-c{1,2}.generated-entry.json` |
| D2-E K2 | 1 / 2 | `9315abca740f6b63e74cadfc8cbda6cbc67a706c344df7e0d2088e1fdedfce6d` / `a642233da5030f0068903d3d44b1791e9ee7dede704137958e99f3a079060b92` | §1.1のK2 G store |

### 1.6 K3 reservationの事前検算（非formal。Search・full Planner runなし）

入力はExport（`gogma-artian-planner-backup_20260927015837.json`、19,424,064 bytes、`cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`）、
`globalResearchInputFromExport(Export, 20000)`（`conflictResolutions = 0`、CalculationContext `{ unknown-initial, 4, production-rng:c5-e7, 17 }`）、
`globalResearchDependencies(new ProductionRngEngine())`（`production-rng:c5-e7`）。support表記は `build-list.fnv1a32-` の先頭8桁。

| 導出 | 呼び出し | 結果 |
| --- | --- | --- |
| K3（Entry ID昇順） | `phase2c27bResolveSupportContext(baseline, deps, t03, [54dd2b4e, 92d87b90, e396d352]).prepared` | `status = ready`、`invalidated.id = build-list.fnv1a32-dd79ecce`（`O_t03`）、`supportBuildListEntryIds` = 入力どおり、reservation digest **`fnv1a32:6e2a0744`**（`stableStringify()` のSHA-256 `4d1de5f415932bd1eebb1a1deadfaeebd995143b6d5b9da4bc6a5160190ae531`）、origin `fnv1a32:ff018910`、`excludedRouteKeys` 1件（SHA-256 `aa5f756dd827e9a8428daa6325e40797a71ee0659edebbd6df944e617f137706`）、`conflictContexts` 21件 |
| K3（逆順、全6順列） | 同上、support順を逆順・全順列 | 6順列すべて同じdigest `fnv1a32:6e2a0744`、逆順はbodyの `stableStringify()` も一致 |
| Export bodyからの直接導出 | `derivePlannerAlternativeReservation([Exportの3 body], engine)` | digest `fnv1a32:6e2a0744`、body一致。`92d87b90` / `e396d352` のbody SHA-256はCTX-3 / CTX-4の `supportBodySha256` と一致 |
| B2-C1 schedule | `derivePhase2C26B2C1Schedule(baseline, deps).snapshot.originDigest` | `fnv1a32:ff018910`（K3 originと一致） |
| K2（`92d87b90`, `e396d352`） | 同上 | `fnv1a32:fd85c864`、bodyがD2-E CTX-K2 recordの `reservationBody` と一致 |
| K1（各support単独） | 同上、`[s]` | `54dd2b4e` **`fnv1a32:6ee53871`**（body SHA-256 `b23501cefc9f47102af4137ca83ce6888a0e1bec10933bc2abc718398e8e0253`）、`92d87b90` `fnv1a32:36a22758`（CTX-3と一致）、`e396d352` `fnv1a32:240e4673`（CTX-4と一致） |
| 参考（K2の別組） | `[54dd2b4e, 92d87b90]` / `[54dd2b4e, e396d352]` | `fnv1a32:c038af14` / `fnv1a32:f331074b`（D2-Fでは使わない） |
| 包含（診断） | K3 bodyがK2 body・各K1 bodyを成分ごとに包含するか | K2 ⊆ K3、K1（3件とも）⊆ K3 |
| 成分ごとのunion（診断） | 3つのK1 bodyの成分ごとunion、K2 bodyと `54dd2b4e` K1 bodyのunion | どちらもK3 bodyと一致 |
| support Route unit planning | `createPlannerRouteUnitPlans([3 body], engine)` | 3 Entryすべてplan、rejection 0。参照・排他消費OwnedWeapon: `54dd2b4e` = {`da8d7cf3…`}、`92d87b90` = {`60126fe6…`}、`e396d352` = {} |
| `54dd2b4e` のunit | 同上 | Gogma stream 71 unit（`counterBefore` 55..125）、required（`canSkipWhenCounterPassed = false`）は125だけ（`keep_bonuses`、shareable、排他消費 `da8d7cf3…`）。Skill stream 308 unit（341..648）、requiredは648だけ（`reset_skills`、shareable）。他はKeep → Keep / Reset Skills → Reset Skillsのskip可能unit |

導出されたK3 reservation body（`stableStringify()` 表記。§4.1の登録値）:

```json
{"exclusiveOwnedWeaponIds":["60126fe6-ad44-492c-bb13-b0320f2cbd2a","da8d7cf3-2abc-410a-8e51-bfe49977367b"],"gogma":{"blocked":[67,71,77,125],"held":[55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125]},"normal":[{"blocked":[12],"counterId":"weapon.sword_and_shield:8","held":[7,8,9,10,11,12]}],"skill":{"blocked":[341,343,648],"held":[341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383,384,385,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447,448,449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502,503,504,505,506,507,508,509,510,511,512,513,514,515,516,517,518,519,520,521,522,523,524,525,526,527,528,529,530,531,532,533,534,535,536,537,538,539,540,541,542,543,544,545,546,547,548,549,550,551,552,553,554,555,556,557,558,559,560,561,562,563,564,565,566,567,568,569,570,571,572,573,574,575,576,577,578,579,580,581,582,583,584,585,586,587,588,589,590,591,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648]}}
```

導出された `54dd2b4e` 単独のreservation body（`stableStringify()` 表記。§4.2の登録値）:

```json
{"exclusiveOwnedWeaponIds":["da8d7cf3-2abc-410a-8e51-bfe49977367b"],"gogma":{"blocked":[125],"held":[55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125]},"normal":[],"skill":{"blocked":[648],"held":[341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383,384,385,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447,448,449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502,503,504,505,506,507,508,509,510,511,512,513,514,515,516,517,518,519,520,521,522,523,524,525,526,527,528,529,530,531,532,533,534,535,536,537,538,539,540,541,542,543,544,545,546,547,548,549,550,551,552,553,554,555,556,557,558,559,560,561,562,563,564,565,566,567,568,569,570,571,572,573,574,575,576,577,578,579,580,581,582,583,584,585,586,587,588,589,590,591,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648]}}
```

K3とK2の比較（読みやすさのための要約。登録値は上のJSON）:

| 成分 | K2（D2-E CTX-K2） | K3 |
| --- | --- | --- |
| exclusive OwnedWeapon | [`60126fe6…`] | [`60126fe6…`, `da8d7cf3…`] |
| Normal `weapon.sword_and_shield:8` | held 7..12、blocked [12] | 同じ |
| Skill | held 341..343（3位置）、blocked [341, 343] | **held 341..648（308位置、連続）**、**blocked [341, 343, 648]** |
| Gogma | held 55..77（23位置）、blocked [67, 71, 77] | **held 55..125（71位置、連続）**、**blocked [67, 71, 77, 125]** |

- **Skill 648とGogma 125は、K3でheldかつblockedになった**。理由は既存authorityの規則どおりである: `54dd2b4e` の該当unitはrequired（Route各laneの最終unit）で、
  shareableだが、その武器 `da8d7cf3…` は `54dd2b4e` 自身が参照する排他OwnedWeaponなので `alternativeCouldShareFixedUnit()` が偽になる。単に3 supportを指定したから
  blockedになったと仮定したのではなく、上の導出で確認した値である
- `54dd2b4e` のskip可能unit（Gogma 55..124、Skill 341..647）はheldだがblockedではない。held位置にはblockedでない限り代替Routeのoperationを置ける
  （SEARCH_SPEC 5.6.8 coverage条件）ので、K3のheld拡大は「t03がそれらの位置を使えない」ことを意味しない
- 成分ごとunionとの一致は、このExport・この3 supportで観測された **結果** である。blockedの判定は全fixed Entryの排他OwnedWeapon集合に依存する
  （`alternativeCouldShareFixedUnit()`）ので、K3の意味論を「K1 / K2 reservationの単純union」と定義しない。D2-F-Bは必ず3 supportのExport Entry bodyから既存authorityで再導出する（§5.1）
- 既存t03 Candidateに対するK3 reservationのR0（`respectsPhase2C2Reservation()`、診断）:

  | Candidate | blocked hit（K3） | R0-K3 |
  | --- | --- | --- |
  | D2-B K0 c1 / c3 | Gogma [67, 71]、Skill [341, 343, 648] | 偽 |
  | D2-B K0 c2 | Gogma [67, 71, 77, 125]、Skill [341, 343, 648] | 偽 |
  | D2-C K1 `92d87b90` c1 / c2 | Gogma [77, 125]、Skill [341, 343, 648] | 偽 |
  | D2-C K1 `e396d352` c1 / c2 | Gogma [71]、Skill [648] | 偽 |
  | D2-E K2 c1 / c2 | Gogma [125]、Skill [648] | 偽 |

  9件すべてがK3 reservationを満たさない（排他OwnedWeaponのhitは0）。K3 contextのSearchはreservationを入力として受け取り、blocked位置に自分のoperationを置かないので、
  これらのRouteはdeliverされない見込みである（§5.3のD-4〜D-6は規則として検査するが、R0-K3が先に検査されるので通常は到達しない）
- この導出はformal evidenceではない。D2-F-BのCTX record（§5.1）が同じ値を再導出し、登録値との一致をparityとして検査する

### 1.7 cost参照値（見積もりの根拠。事前登録値ではない）

| 参照 | 値 | 出典 |
| --- | --- | --- |
| t03 K2 L0 / L1 / L2 | 42.5 s / 63.0 s / 671.2 s、heap peak 1.38 / 1.95 / 6.00 GB（RSS最大6.55 GB） | D2-E RESULT `discovery.units[]` |
| t03 K1 L2 | 486.8 s / 693.2 s、heap peak 3.66 / 6.90 GB | D2-C RESULT |
| K1 L2最大（D2-C全体） | 1,009 s、heap最大7.07 GB（t02） | D2-C-B |
| CTX child | K1 6.9〜7.0 s、K2 9.7 s | D2-C / D2-E RESULT |
| 評価run | 8.2〜14.5 s / 件（D2-E）、heap最大0.87 GB、full run 1回 / 件、retry 0 | D2-E RESULT |
| RV（9 Candidate + support 3件） | 15.9 s | D2-E RESULT |
| **K3 L0 / L1 / L2** | **未計測** | — |

- **K3のSearch costをK2と同程度と仮定しない**。K3ではSkill heldが3位置から308位置、Gogma heldが23位置から71位置の連続区間になる。SEARCH_SPEC 5.6.8（same-cost closure）は、
  最初のCandidateまでの時間がsame-cost closureに必要なheld位置・Route base・stream stateの数に比例し得ることを明記している。K3はK2より軽いとも重いとも推定できない

### 1.8 推論（測定していない。D2-F-Bの計測で確かめる）

- I-D2F-1: K3 reservationはSkill 648とGogma 125をblockedに含む（§1.6）。したがってK3 contextのSearchがdeliverするCandidateは、D2-EのK2 Candidate（c1 / c2）とも
  D2-C / D2-Bの既存t03 Candidateとも同じRouteではあり得ない（R0がそれを除く）。**これはK3 CandidateがL2までに見つかること、selectedになること、R5を満たすこと、
  24 / 19から改善することのいずれも意味しない**
- I-D2F-2: K3 CandidateがI0に加わった場合でも、t03 `G` が `b4b4c72c`（I0で非selected）や他の置換集合外Entryと新しい位置で衝突する可能性は残る。K3 reservationが保持するのは
  3 supportの資源だけである
- I-D2F-3: held位置はRouteが武器を触らずに通過できる位置でもある（SEARCH_SPEC 5.6.8）。K3のheld拡大で、K2では到達できなかったRoute形（Skill 344〜647の非blocked位置を
  使うRoute）が到達可能になることもあり得る。K3の到達集合がK2の到達集合の部分集合になるとは既存仕様から導けない。K2のL0 / L1が0件だったことから、K3のL0 / L1が0件になるとは推定しない
- I-D2F-4: t03が完成し `54dd2b4e` のTargetも維持されても、別Targetを失えばcompletedは24のままである。これは「+1完成」ではない（§8.5 / §8.6）
- I-D2F-5: K3 L2のcostは未計測で、L2 unitのtimeout / OOMは起こり得る（§10.4）

## 2. 事前登録条件: 目的・scope・対象外

### 2.1 目的と仮説

**主仮説（未検証）**: t03の代替RouteをSearchする際、既存2 support（`92d87b90` / `e396d352`）の資源に加えて、I0でselectedの置換集合外Entry `54dd2b4e` が使う資源
（特にSkill 648 / Gogma 125）もreservationとして尊重すれば、既存2 support・`54dd2b4e`・incumbent 9 Candidate・新t03 Candidateが同時に成立する置換集合が得られる可能性がある。

D2-Fはこの仮説を、次の有界な手順で測る。

1. t03の **K3 context 1件** をD2-E evidenceから機械導出し（§3）、既存authorityでreservationを再導出する（CTX-K3、§5.1）
2. 登録ladder L0 / L1 / L2でK3 Candidateを高々2件discoveryする（DSC、§5）
3. 既存のR0 / R1でadmissionする（ADM、§7）
4. D2-D最良incumbent（I0）をfreshに再評価してparityを取り（§8.1）、admitted K3 Candidateを1件ずつI0の9 Candidateへ追加して評価する（EXT、§8.3）

K3 Candidateが見つかること、selectedになること、R5を満たすこと、24 / 19から改善することを事前に仮定しない。discovery、t03自身のselected、`54dd2b4e` のselected、
共存（R5）、全体改善（gate・improved）、R6は別々に記録する。

### 2.2 K3を選ぶ理由（判断根拠）

- D2-Eの失敗は、t03 K2 Candidateが置換集合外の `54dd2b4e` とSkill 648 / Gogma 125で衝突し、t03とその相手Targetが入れ替わったことである（§1.2）。
  原因の資源が特定され、その資源を保持するEntryが1件（I0でselected）に定まっている
- その資源をt03のSearch時点で避ける最小の変更は、`54dd2b4e` をt03のsupportに加えて、そのRoute資源を既存authorityでreservationへ反映させることである。
  §1.6の検算で、Skill 648 / Gogma 125が実際にblockedへ入ることを確認した
- Search対象はt03だけのまま、Search ladder・pool cap・評価手順をD2-Eから継承できるので、D2-Eとの差（support 1件の追加）の効果だけを分離して測れる

### 2.3 他案を今回選ばない理由

| 案 | 選ばない理由 |
| --- | --- |
| `54dd2b4e` 側Target（`9d817a9b…`）の代替Routeを再探索し、t03 K2 c2と組み合わせる | Search対象が置換集合外のTargetへ広がり、E1外Targetを置換集合へ入れる新しいscope・population規則が要る。`54dd2b4e` 自身の代替Route探索は依頼のscope外。t03とその相手の2 Target同時変更（PAIR型）になり、D2-Eとの差を1要因に分離できない |
| `EXT-K2-t03-c1` で衝突したincumbent t00とt03の再合成 | c1の失敗原因（Skill 344、集合内）と、c2の失敗原因（Skill 648 / Gogma 125、集合外）は別である。c2は既にR5を満たしたので、集合外の喪失を扱うK3の方が改善への距離が短い。t00の差替えはincumbentを変える複数passで、G48に当たる |
| K2 poolの拡大（3件目以降）・L2より広いextent | 同じK2 reservationのままでは、Skill 648 / Gogma 125を使うRouteを除けない。3件目以降も近縁Routeである可能性が高く（D2-Eのc1 / c2はcost 358 / 359の隣接）、同じ失敗構造を再観測する可能性が高い。結果を見たextent・pool追加になる |
| `b4b4c72c` をsupportに加える | I0で非selectedであり、そのRoute資源を保持してもI0の完成Targetを守る効果が無い。依頼のscope外 |
| K4以上、複数pass、別Targetとの同時差替え | 依頼のscope外。D2-Fは1要因（`54dd2b4e` のsupport化）だけを測る |

### 2.4 scope

| 項目 | D2-Fの値 |
| --- | --- |
| 対象Target | **t03だけ**（TargetWeapon `188571a7-b480-4085-a8f5-59666c0e4cc5`、`O_t03 = build-list.fnv1a32-dd79ecce`） |
| context | **K3 context 1件** `K3-t03-54dd2b4e-92d87b90-e396d352`（support 3件、Entry ID昇順）。K0 / K1 / K2 / K4以上のcontextのSearchは行わない |
| support | `build-list.fnv1a32-54dd2b4e`、`build-list.fnv1a32-92d87b90`、`build-list.fnv1a32-e396d352`（Entry ID昇順。いずれもExport上の元Entry、E1外、I0でselected）。§3.1で機械導出し、§3.2の登録表と一致すること |
| reservation | 3 supportのExport Entry bodyから既存の `derivePlannerAlternativeReservation()`（`phase2c27bResolveSupportContext()` 経由）で再導出したもの（§4.1） |
| extent ladder | L0 `{ Normal 4, Gogma 235, Skill 4 }` / L1 `{ 8, 235, 256 }` / L2 `{ 128, 235, 1500 }`（D2-Eと同じ、§5.5） |
| Candidate保持数 | `K3_POOL_CAP = 2`（§5.6） |
| 比較・合成の起点 | D2-D最良 `PAIR-t05c1-t07c3` の9 Candidate（§1.4）。D2-F-Bのmeasurement HEADでfresh full runしてparityを取る（I0、§8.1） |
| 置換しないTarget | 置換集合に入らないTarget（E1外の32 Targetと、置換集合外のE1 Target t02）は元Route（Export上のEntry）のまま。43 Targetすべてを評価対象とし、Targetを除外しない |
| Export / RNG / CalculationContext | D2〜D2-Eと同じ（Export `cc35fb5b…1e6b`、`production-rng:c5-e7`、`{ gameVersion: 'unknown-initial', masterDataVersion: 4, rngEngineVersion: 'production-rng:c5-e7', appSchemaVersion: 17 }`） |
| Plan step bound | Research `researchMaxPlanSteps = 20000`（Production A / Bと混同しない、G12） |
| conflict resolution / fixed constraint | すべての評価runで `conflictResolutions = []`、preflightのfixed constraint `[]`（G1） |
| population | `oracleGuidedTargetPopulation = true`（E1の部分集合を継承。このprovenanceは隠さずRESULTに記録する）。D2-Fの規則はTarget IDで分岐せず、§3.1の導出規則で機械的に決まる |

### 2.5 対象外

- t02の探索、t03以外の新規探索（K0 / K1 / K2 / K3を問わない）、E2 9 Target全体、residual 3、population拡大
- `54dd2b4e` 自身のTarget（`9d817a9b…`）の代替Route探索
- D2-E K2 contextの3件目以降のCandidate探索、L2より広いextent、K2 Candidate（c1 / c2）をD2-Fの集合評価へ入れること（§8.2のWPは手順parity専用で、decisionに使わない）
- `b4b4c72c` を追加supportとする探索、K4以上のcontext、supportの自動追加、adaptive context expansion（結果を見たcontext・support・extentの追加）
- 別Targetとの同時Route差替え（t00 / t04 / t05 / t07 / t10等のincumbent変更）、multi-pass composition、EXTの結果を受けた追加評価・追加合成
- alternative-to-alternative support（生成Entryをsupportにすること）、support依存の連鎖・失効したsupportの自動再解釈
- D2-E best EXT（`EXT-K2-t03-c2`、24 / 19）を新しいincumbentとして継承すること。`54dd2b4e` を失った集合なので起点にしない
- oracle exactとの比較。oracle（`PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、manifest、module）は実行入力・診断入力・分析のいずれにも使わない
- Phase B / D1 / D2 / D2-C / D2-D / D2-Eのformal RESULT・decisionの書き換え、D2-Fの結果をそれらのdecision inputへ戻すこと
- Production Search / Planner / RNG / UI / Persistence、schema / version、Production default / bounds、Domain semanticsの変更、Production化、REQUIREMENTS 23の契約変更
- Issue #154のClose

## 3. 事前登録条件: K3 contextの導出

### 3.1 導出規則（V・analyzerが機械的に再実行する）

```text
S2      = D2E RESULT context.supportBuildListEntryIds                       // D2-EのK2 support（Entry ID昇順、2件）
t       = D2E RESULT context.targetWeaponId、O_t = context.currentBuildListEntryId
I0e     = D2E RESULT evaluations[evaluationId = 'I0']
E*      = D2E RESULT evaluations のうち stage === 'EXT' ∧ r5.satisfied ∧ eligible ∧ extension.t03Completion.t03CompletedWithoutNetGain
|E*| ≠ 1                                                     -> V失敗
e = E*の唯一の要素
lost    = e.referenceDiff.targetsLost                        // |lost| ≠ 1 -> V失敗
X = { p | c ∈ e.extension.conflictsWithT03G, o ∈ c.others, o.role === 'outside_set', p = o.buildListEntryId,
          p ∈ I0e.plan.selectedBuildListEntryIds,                                  // I0でselected
          p ∉ e.plan.selectedBuildListEntryIds,                                    // eで非selected
          { buildListEntryId: p, reason: 'resource_conflict' } ∈ e.rejectedBuildListEntries,
          Export.buildListEntries のうち id === p の要素がちょうど1件で、その targetWeaponId ∈ lost }
|X| ≠ 1                                                      -> V失敗
K3(t)   = { targetWeaponId: t, O_t, supports = sorted(S2 ∪ X) }                    // Entry ID昇順、3件
```

- 導出結果は§3.2の登録表と **Target・O_t・support集合・順序・E*（`EXT-K2-t03-c2`）・lost（`9d817a9b…`）・X（`54dd2b4e`）がすべて一致** しなければならない。
  不一致はV失敗（`D2F_INVALID`、`input_evidence`）で、childを1つも起動しない。不一致を推測で補正しない
- `b4b4c72c` は `outside_set` のparticipantだがI0で非selectedなので `X` に入らない（規則の結果。Entry IDで除外していない）
- D2-F-B sourceへsupport Entry ID・Target IDを直接書かない（§11.3）。§3.2の表は照合にだけ使う
- 本書作成時に、この規則をD2-E RESULTとExportに対して実行し、`E* = [EXT-K2-t03-c2]`、`lost = [9d817a9b…]`、`X = [54dd2b4e]`、
  `S2 ∪ X = [54dd2b4e, 92d87b90, e396d352]` を得た（非formal）
- 3 supportのE1外判定（§5.1 C1）に使うE1 Target集合と `O_t` 集合は、D2 RESULT `discovery.targets[].{targetWeaponId, currentBuildListEntryId}`（11件）から読む。
  population manifest file・population-authority moduleは読まない

### 3.2 登録K3 context（1件）

| 項目 | 値 |
| --- | --- |
| context ID | `K3-t03-54dd2b4e-92d87b90-e396d352`（表示ID。同定はTargetWeapon IDとsupport Entry ID全文で行う） |
| Target | t03、TargetWeapon `188571a7-b480-4085-a8f5-59666c0e4cc5` |
| `O_t` | `build-list.fnv1a32-dd79ecce`（`candidateStableKey` SHA-256 `aa5f756dd827e9a8428daa6325e40797a71ee0659edebbd6df944e617f137706`） |
| support（Entry ID昇順） | `build-list.fnv1a32-54dd2b4e`（Target `9d817a9b-4a79-4430-aa13-48ecab0055d6`、`supportBodySha256 2dd3ca57807e428907d350d3dd1158af664ea262134d82bf01d7a49ecaf67b81`）、`build-list.fnv1a32-92d87b90`（Target `cbdf9d8f-07d8-4b30-b5b3-5d8f1ab23b4a`、`9e9d5211a5aacd4c0fffebb5d38959fd92d360d36e264e3cb38b7f76b6efe032`）、`build-list.fnv1a32-e396d352`（Target `820831d0-edd9-4005-a4a2-c8025cdad2c2`、`d92ccdded3c09a7b98997fd6fb8ff2b6ee7223069f66575d1ba895dbc0be4b60`） |
| 導出根拠 | D2-E CTX-K2のsupport 2件 ∪ `EXT-K2-t03-c2` でt03 `G` に負けたI0 selectedの置換集合外Entry 1件（§3.1） |
| 新しいsupport | `54dd2b4e`（D2-C / D2-EのK1 / K2 CTX recordを持たない。S5 authorityは本書§4.2の登録値とD2-F-BのCTX-K3 record） |

## 4. 事前登録条件: 登録reservation

### 4.1 K3 reservation（CTX-K3の照合期待値、§1.6）

| 項目 | 登録値 |
| --- | --- |
| `reservationDigest` | `fnv1a32:6e2a0744` |
| `reservationBody`（`stableStringify()`） | §1.6の1つ目のJSON（SHA-256 `4d1de5f415932bd1eebb1a1deadfaeebd995143b6d5b9da4bc6a5160190ae531`） |
| exclusive OwnedWeapon | [`60126fe6-ad44-492c-bb13-b0320f2cbd2a`, `da8d7cf3-2abc-410a-8e51-bfe49977367b`] |
| Normal | `weapon.sword_and_shield:8`: held [7..12]、blocked [12] |
| Skill | held [341..648]（308位置）、blocked [341, 343, 648] |
| Gogma | held [55..125]（71位置）、blocked [67, 71, 77, 125] |
| origin | `originDigest = fnv1a32:ff018910`（B2-C1 schedule snapshot、CTX-3 / CTX-4 / CTX-K2と同じ） |
| `excludedRouteKeys` | `[candidateStableKey(O_t03)]`（SHA-256 `aa5f756d…7706`） |
| `conflictContexts` 件数 | 21（参考。判定に使わない） |

### 4.2 `54dd2b4e` 単独reservation（新supportのS5 authority期待値、§1.6）

| 項目 | 登録値 |
| --- | --- |
| `reservationDigest` | `fnv1a32:6ee53871` |
| `reservationBody`（`stableStringify()`） | §1.6の2つ目のJSON（SHA-256 `b23501cefc9f47102af4137ca83ce6888a0e1bec10933bc2abc718398e8e0253`） |
| `supportBodySha256` | `2dd3ca57807e428907d350d3dd1158af664ea262134d82bf01d7a49ecaf67b81` |

- reservationの導出は既存authorityだけで行う: K3は `phase2c27bResolveSupportContext(baseline, dependencies, t03, S3)`（= `derivePlannerAlternativeReservation([3 supportの初期context上のEntry], engine)`）、
  単独は `derivePlannerAlternativeReservation([Exportの54dd2b4e body], engine)`。support Entryは3件ともExportの元Entryそのものを使う
- 登録値との不一致はparity `k3_context_registered` / `k1_new_support_registered` の `mismatched`（`D2F_INVALID`）であり、D2-F-Bは登録値に合わせて補正しない

## 5. 事前登録条件: discovery（K3 Search）

### 5.1 context作成（CTX-K3、1 child）

```text
unit CTX-K3:
    baseline = globalResearchInputFromExport(Export, 20000)                 // conflictResolutions = [] を確認
    S = K3(t03).supports（§3.1、Entry ID昇順、3件）
    supportBodies = 各 s ∈ S について Export.buildListEntries のうち id === s の要素（ちょうど1件）
    resolved = phase2c27bResolveSupportContext(baseline, dependencies, t03, S)
    reservation = resolved.prepared.reservation
    singles = 各 s ∈ S について derivePlannerAlternativeReservation([supportBody(s)], engine)
    記録: contextId, targetWeaponId, O_t（resolved.prepared.invalidated.id）, supportBuildListEntryIds = S,
          supportBodySha256s = { s: SHA-256(stableStringify(supportBody(s))) },
          reservationBody = structuredClone(reservation)（JSONオブジェクト）, reservationDigest = hashStableValue(reservation),
          singleSupportReservations = { s: { reservationBody（JSONオブジェクト）, reservationDigest } },
          originDigest, excludedRouteKeys（全文とSHA-256）, conflictContextCount,
          checks C1〜C8, diagnostics { equalsK1ComponentwiseUnion, equalsK2UnionNewSupport, registeredResources }
    record file: <run dir>/CTX-K3.context.json（runnerがbytes・SHA-256をjournalへ記録）
```

| check | 内容 | 不成立時 |
| --- | --- | --- |
| C1 | `|S| = 3` で重複なし・Entry ID昇順。各 `s` について、support EntryがExportの `buildListEntries` にちょうど1件あり、そのTarget IDがE1 Target集合（§3.1）に無く、t03でなく、IDが生成Entry prefix（`build-list.constrained.`）でなく、いずれのE1 Targetの `O_t` でもない。3件のTarget IDが互いに異なる | guardrail違反（`D2F_INVALID`） |
| C2 | `resolved.status === 'ready'`、`resolved.prepared.invalidated.id === O_t03`、`resolved.prepared.supportBuildListEntryIds` が `S` と一致 | guardrail違反 |
| C3 | 導出reservationの `exclusiveOwnedWeaponIds` が、3 supportの `collectReferencedOwnedWeaponIds(supportBody.candidateSnapshot.route)` の和と、3 supportを1回の `createPlannerRouteUnitPlans([3 body], engine)` で計画したunitの `exclusiveConsumedOwnedWeaponId` をすべて含み、route unit planのrejectionが0 | guardrail違反 |
| C4 | `hashStableValue(resolved.prepared.origin)` がB2-C1 schedule snapshotの `originDigest`、CTX-3 / CTX-4 / D2-E CTX-K2 recordの `originDigest` と一致。`excludedRouteKeys` が `[candidateStableKey(O_t03.candidateSnapshot)]` で、scheduleのt03の `excludedRouteKeys`、CTX-3 / CTX-4 / CTX-K2の `excludedRouteKeySha256s` と一致 | guardrail違反 |
| C5 | `reservationDigest === 'fnv1a32:6e2a0744'` かつ `stableStringify(reservationBody) === stableStringify(§4.1の登録body)`（両辺オブジェクト） | parity `k3_context_registered` `mismatched`（`D2F_INVALID`） |
| C6 | 包含: K3 bodyが (a) D2-E CTX-K2 recordの `reservationBody`、(b) CTX-3（`92d87b90`）・CTX-4（`e396d352`）の `reservationBody`、(c) `singles[54dd2b4e]` を、成分ごとに包含する（Normalはcounter IDごと、Normal / Skill / Gogmaの `held` ⊇、`blocked` ⊇、`exclusiveOwnedWeaponIds` ⊇） | guardrail違反 |
| C7 | 順序不変: `S` の全6順列の `phase2c27bResolveSupportContext()` の導出reservationが、`stableStringify()` とdigestで一致する | guardrail違反 |
| C8 | 単独reservation: `singles[54dd2b4e]` のdigestが `fnv1a32:6ee53871`、bodyが§4.2の登録bodyと一致（parity `k1_new_support_registered`）。`singles[92d87b90]` / `singles[e396d352]` のdigest・bodyがCTX-3 / CTX-4（および同じsupportの他のK1 CTX record）と一致 | 前者は `mismatched`（`D2F_INVALID`）、後者はguardrail違反 |

- `equalsK1ComponentwiseUnion`（3つの単独reservationの成分ごとunionとK3の一致）、`equalsK2UnionNewSupport`（K2 bodyと `singles[54dd2b4e]` のunionとK3の一致）は
  診断だけに記録する（本書作成時の観測値はどちらもtrue、§1.6）。判定・semanticsに使わない
- `registeredResources`（診断）: Skill 648 / Gogma 125 / Skill 344 / Skill 341 / Gogma 71の各位置について、K3 reservationの `held` / `blocked` に含まれるか。
  Skill 648 / Gogma 125がblockedであることは、C5（登録body一致）の帰結として確認され、独立のcheckにはしない
- **`reservationBody` の保存・比較形式**: D2-E-A §4.1と同じ。JSONオブジェクトとして保存し、比較は両辺オブジェクトの `stableStringify()` 一致、digestは文字列一致。
  runner・analyzerは読込時にrecordのbytes・SHA-256をjournalと照合し、`reservationBody` / `singleSupportReservations[s].reservationBody` がJSONオブジェクトであることを確認する
  （文字列等なら `evidence_integrity`。文字列をparseして救済しない）
- support Entryはexportの元Entryそのものを使い、user-fixed Route、resolution、scenario resolution、repair lineage、fixed constraint、`selectedBuildListEntryId` に変換しない（G1）
- CTX-K3はSearchを実行しない。full Planner runも起動しない
- analyzerはC1 / C3 / C4 / C6 / C7をExport・CTX record・K1 / K2 CTX recordから独立に再計算する（C3は3 supportのExport bodyから `collectReferencedOwnedWeaponIds()` と
  1回の `createPlannerRouteUnitPlans([3 bodies], engine)` で再導出し、recordを再計算値の代わりに使わない。D2-E-B §1.1のC3独立再計算と同じ方式）。C5 / C8は登録値で再照合する

### 5.2 Search入力とconsumer（unit = (K3 context, rung)、unitごとに新しいchild）

```text
pool = []                              // K3 contextのunique Candidate（discovery順、最大 K3_POOL_CAP = 2）
unit DSC-K3-<rung>:
    resolved = phase2c27bResolveSupportContext(baseline, dependencies, t03, S)
    reservation body / digest、originDigest、excludedRouteKeys、O_t が CTX-K3 record と一致しない -> guardrail違反（context_drift、D2F_INVALID）
    searchInput = { origin, targetWeaponId: t03, extent: rung, reservation, excludedRouteKeys }
    visitPlannerAlternativeCandidates(searchInput, engine, consumer)     // capture policy・instrumentationなし、既存orderingのまま
    consumer(candidate):
        key = candidateStableKey(candidate)
        summary = summarizePhase2C2Entry(materialized entry, baseline, engine)
        R0-K3:    respectsPhase2C2Reservation(summary, candidate.route, reservation) が偽                     -> guardrail違反（D2F_INVALID）
        R0-K2:    respectsPhase2C2Reservation(summary, candidate.route, D2-E CTX-K2 record.reservationBody) が偽 -> guardrail違反（不変条件違反）
        R0-split: 各 s ∈ S について respectsPhase2C2Reservation(summary, candidate.route, single(s)) が偽        -> guardrail違反（不変条件違反）
                  single(s): 54dd2b4e -> CTX-K3 record singleSupportReservations[54dd2b4e]、92d87b90 -> CTX-3、e396d352 -> CTX-4
        key ∈ poolのkey                            -> action = duplicate_of_lower_rung、continue（D-2）
        SHA-256(key) ∈ D2B_K0_POOL(t03)            -> action = same_key_as_d2b_k0_pool、continue（D-4）
        SHA-256(key) ∈ D2C_K1_POOL(t03)            -> action = same_key_as_d2c_k1_pool、continue（D-5）
        SHA-256(key) ∈ D2E_K2_POOL(t03)            -> action = same_key_as_d2e_k2_pool、continue（D-6）
        それ以外 -> materializer.materializeBuildListEntry(candidate, baseline.buildListEntries)
                    G store へbody全体を書く（SHA-256を記録）、poolへ追加、action = pooled
                    |pool| = K3_POOL_CAP -> stop、それ以外 -> continue
```

- 消費者はdiscovery中にtrial（full Planner run）を行わない。`found_R` を探索停止条件にしない
- Search ordering、Candidate semantics、extentの意味、`excludedRouteKeys` を変えない。`excludedRouteKeys` にK0 / K1 / K2のCandidateを足さない（D-4〜D-6はconsumer側の分類である）
- materializeは既存materializer（`createPlannerAlternativeMaterializer({ ...searchInput, clock })`）だけで行い、Route・`route.operations` からBuildListEntryを組み立てない
- R0はblocked位置と排他OwnedWeaponだけを検査する（`respectsPhase2C2Reservation()`）。C6（blocked・exclusiveの包含）が成立していればR0-K3 ⇒ R0-K2 ⇒ R0-splitであり、
  R0-K2 / R0-splitの不成立は不変条件違反として扱う。評価時はS6（§9.2）で、評価入力内の3 support bodyから再導出したreservationがCTX-K3と一致することも検査する
- R0の不成立はPhase B / D2 / D2-C / D2-Eの全deliveryで一度も観測されていない。SearchはreservationをSearch入力として受け取るので、不成立は通常の結果として扱わない

### 5.3 重複排除（6層を区別する）

| 層 | 規則 | 扱い |
| --- | --- | --- |
| D-1 同一unit内 | Searchは1 run内で同じ `candidateStableKey` を2回deliverしない | 2回目が観測されたら不変条件違反（guardrail、`D2F_INVALID`） |
| D-2 同一context・rung間 | key（全文）がpoolに既にある | `duplicate_of_lower_rung`。poolに数えない、materializeしない |
| D-3 異なるcontext間 | K3 contextは1件なので該当しない | — |
| D-4 D2-Bのt03 K0 pool（§1.5の3 key） | `SHA-256(key)` が一致 | `same_key_as_d2b_k0_pool`（一致したordinalを記録）。poolに数えない |
| D-5 D2-Cのt03 K1 pool（§1.5の4 key） | `SHA-256(key)` が一致 | `same_key_as_d2c_k1_pool`（ordinal・context IDを記録）。poolに数えない |
| D-6 D2-Eのt03 K2 pool（§1.5の2 key、D2-E RESULT `discovery.pool[].keySha256`） | `SHA-256(key)` が一致 | `same_key_as_d2e_k2_pool`（ordinalを記録）。poolに数えない |

- D-4〜D-6の理由はD2-E-A §4.3 D-4 / D-5と同じ（同じRouteは既にdiscovery・admission・集合評価されており、support依存を足すだけになる。そのCandidateをI0に対して再評価することは複数passで、登録しない）
- §1.6のとおり、9 keyのRouteはすべてR0-K3を満たさないので、R0-K3の検査（先に行う）でguardrail違反になる。D-4〜D-6は規則として常に検査するが、通常は到達しない
- K3 CandidateとK0 / K1 / K2 Candidateは、Search identity（reservation・extentを含む）、`requiresSupport`、CTX record SHA-256、G store SHA-256が異なる別Candidateである。
  同定は (context ID, key) とし、generated Entry IDだけで同定しない
- 他TargetのCandidate・incumbentの `G` とはkeyが一致し得ない（Targetが異なる）。一致した場合は不変条件違反である

### 5.4 rungの進行・停止

D2-E-A §4.4をそのまま適用する（`discovery_cap_reached` / `discovery_exhausted` / `stopped_by_search_extent_bound` / `unmeasured` / `discovery_calculation_error` /
`not_executed`）。上位rungへ進む条件は、unitが `stopped_by_search_extent_bound` で終わり、かつ `|pool| < 2` であることだけである。

### 5.5 extent ladder（固定）

| rung | maxNormalAdvance | maxGogmaAdvance | maxSkillAdvance |
| --- | ---: | ---: | ---: |
| L0 | 4 | 235 | 4 |
| L1 | 8 | 235 | 256 |
| L2 | 128 | 235 | 1500 |

根拠:

1. Phase B / D2 / D2-C / D2-Eの登録ladderそのままである。t03のK1（2 context）・K2（1 context）も同じladderで計測されており、K3の結果を同じ軸で比較できる
2. L0 / L1を省略しない。I-D2F-3のとおり、K3の到達集合がK2の部分集合になるとは導けない
3. L2を初回formalに含める。t03のK1 / K2 CandidateはL2で初めて得られた
4. L2より上のrungは無い。Gogma 235は既存authority（`defaultPlannerAlternativeSearchExtent`、SEARCH_SPEC 5.6.8）のまま全rungで変えない。到達量はorigin基準
   （SEARCH_SPEC 5.6.8）であり、K3のheld拡大で `maxSkillAdvance` / `maxGogmaAdvance` の意味は変わらない

**結果を見てextentを追加・変更しない**。L2で `ladder_exhausted` になっても、L3や別extentを同じD2-F内で追加しない（新しい事前登録を要する）。

### 5.6 discoveryの上限・Candidate保持数（すべて事前登録値）

| 量 | 上限 | 導出 |
| --- | ---: | --- |
| context | 1 | §3.2 |
| CTX unit | 1 | — |
| DSC unit（Search unit） | **3** | L0 / L1 / L2 |
| unique Candidate（pool） | **`K3_POOL_CAP = 2`** | 下記 |
| unitあたりdelivery | **11** | pooled ≤ `2 − |pool|開始時`、`duplicate_of_lower_rung` ≤ `|pool|開始時`（両者の和 ≤ 2）、D-4 ≤ 3、D-5 ≤ 4、D-6 ≤ 2（Searchの `seen` により各key高々1回） |
| G store file | 2 | pooled 1件につき1 |

`K3_POOL_CAP = 2` の根拠（D2-C K1・D2-E K2を継承する）:

1. D2-C / D2-Eと同じ値にして、contextあたりの情報量・costを比較可能にする
2. t03のK1 / K2 Candidateは、どのcontextでも2件がcost隣接の近縁Routeだった（K1: 367 / 368、306 / 307、K2: 358 / 359）。3件目以降も近縁Routeである可能性が高く、
   集合評価での情報価値に比べてL2 Searchの延長のcostが読めない（§1.7、K3 costは未計測）
3. EXT（I0への追加評価）は1 Candidateにつき1評価で有界にする
4. 値2はoracle由来ではない

### 5.7 記録

D2-E-A §4.7をそのまま適用し、次を読み替え・追加する: support Entry IDは3件、R0-K2をR0-K3に、R0-split（support別）を3件に、Search入力reservation digestはCTX-K3の値に、
CTX-K2 record SHA-256をCTX-K3 record SHA-256に、`requiresSupport = S`（3件）。deliveryのactionに `same_key_as_d2e_k2_pool` を加え、R0-K2（D2-E CTX-K2 bodyに対するR0）も記録する。

## 6. 事前登録条件: 評価手順の整合（3 supportの取り扱い）

D2-Eの評価wrapper `runD2EEvaluation()`（`src/benchmarks/plannerGlobalD2E.ts`）は、`requiresSupport.length > 2` のreplacementを不変条件違反として拒否し、
ADM / EXTはK2 Candidateをちょうど1件持つことを要求する。D2-Fはこれを次のとおり扱う。

1. **D2-E moduleを変更しない**。D2-F moduleに、`runD2EEvaluation()` と同じProduction部品を同じ順序で使う評価wrapper（推奨名 `runD2FEvaluation()`）を置く。
   手順は D1-A §4.1 / D2-E-A §6.2と同じ: baseline + 各 `G` をTarget ID昇順で末尾に追加、9.2.18 replacement（`resolveBuildListEntryReplacement()`、−O_t + G）、
   `preparePlannerReplacementConflictPreflight(augmented, replacements, [], createPlannerConflictContexts(baseline initial context), dependencies)`、
   `createPlannerAlternativeFullRunner(createPhase2C27BLadderRerunBudget(8, 0), dependencies)` の1 run（runtime-unsupported retryを含む）、`d1RuntimeUnsupportedRemoved()` で最終入力、
   `d1InputDigest()` / `d1ResultDigest()`、Trace Replayを含むPlan生成。B0は `{ kind: 'persisted' }`、それ以外は `{ kind: 'temporary_replacement', replacements }`
2. 変えるのは静的checkの件数上限だけである: replacementの `requiresSupport` は高々3件、ADM / EXTはK3 Candidateをちょうど1件（`requiresSupport.length === 3`）、
   WP（§8.2）はK2 Candidateをちょうど1件、B0 / I0は0件。S4 / S5は `S_sup` の各support（最大4件）に、S6は評価集合内のK2 / K3 Candidateに適用する（§9.2）
3. **手順の同一性の確認**（D2-F-Bで必須）:
   - (a) test: Fake Engine fixtureで、同じK0 / K1 / K2入力に対し `runD2FEvaluation()` と `runD2EEvaluation()` のfacts・`inputDigest`・`resultDigest` が一致すること
   - (b) 正式計測のI0（K0 / K1置換、support 3件の経路）がD2-D `PAIR-t05c1-t07c3` / D2-E I0の `resultDigest fnv1a32:57dbb4e5` と一致すること（parity `d2d_best` / `d2e_i0`）
   - (c) 正式計測のWP（K2置換、2-support pair reservationの経路）がD2-E `EXT-K2-t03-c2` の `inputDigest fnv1a32:2f7009bf` / `resultDigest fnv1a32:03e2ef58` と一致すること（parity `d2e_wrapper`、§8.2）
4. K3（3-support pair reservation）の経路には既存の参照値が無い。その正しさは、(1)の同じProduction部品・同じ順序、S4 / S5 / S6の静的check、(3)の3つのparity、
   analyzerによる独立再判定で担保する。新しい判定・合成手順を発明しない
5. ADMの `found_R` 診断は `judgePlannerAlternativeTrial()` に explicit decision = fixed Route = support = `S`（3件）を渡す（D2-Eと同じ方式で件数だけが異なる）

既存部品で本書の規則を表現できないことが分かった場合は、別の判定を発明せず、本書の更新（docs）を先に行う。

## 7. 事前登録条件: admission（ADM、R1）

D2-E-A §5をそのまま適用し、次を読み替える。

| 項目 | 値 |
| --- | --- |
| 評価ID | `ADM-K3-t03-c<ordinal>`（D2-Eの `ADM-K2-t03-c<o>`、D2-Cの `ADM-t03-c<o>` と別の評価） |
| 入力 | `T = { t03 }`、`G = 当該K3 Candidate`（D2-FのG storeのbody） |
| `evaluatedAgainst` | `baseline` |
| `requiresSupport` | `S`（`[54dd2b4e, 92d87b90, e396d352]`、Entry ID昇順） |
| 実行順・上限 | discovery ordinal昇順、2 |

- R1の成立条件（`reusedExisting === false`、replacement `ready` かつ `replacedBuildListEntryId === O_t03`、preflight `ready`、`evaluated`、`plan !== null` かつ
  `termination.status ∈ { completed, exhausted }`）は変えない。**admitted** ⇔ R1成立。K3であることを理由に判定を緩めない
- 診断: R2（R1 ∧ `S` の3件がすべてselected ∧ `G` といずれかのsupportを同時participantとするConflictなし）、R3、R4、`target_regressed_R`、`found_R`、
  `G` を外した勝者Entry、`crossSupportLoss`（勝者が `S` の要素か）、`G` を含むConflictの他participant、S1〜S3、加えて
  `newSupport { buildListEntryId: 54dd2b4e, selected, targetSelected }`（baseline上で `54dd2b4e` とそのTargetが残るか）
- S4〜S6の不成立はguardrail違反（`D2F_INVALID`）。R2〜R4・`found_R`・`newSupport` を理由にCandidateをpool・admissionから除外しない。ADMの結果をR5として流用しない

## 8. 事前登録条件: 集合評価

### 8.1 I0（D2-D最良incumbentのfresh再評価）

D2-E-A §6.1をそのまま適用する（集合 = D2-D RESULT `decision.bestImprovedPair` の置換集合9件、§1.4、`requiresSupport` t00 / t10: `[e396d352]`、t04: `[92d87b90]`、
t05: `[61066e62]`、他: `[]`、各K1置換は自身のCTX record、`evaluatedAgainst = replacement_set`）。

| 期待値（parity） | 値 |
| --- | --- |
| `d2d_best`（D2-D `PAIR-t05c1-t07c3`） | `inputDigest fnv1a32:6493291d`、`evaluated`、`resultDigest fnv1a32:57dbb4e5`、`exhausted`（`reachedLimits = []`）、24 / 43、Conflict 19、steps 1465、R5成立、`resourceConflictRejections = 19`、`92d87b90` / `e396d352` / `61066e62` がselected |
| `d2e_i0`（D2-E I0） | 同じ `inputDigest` / `resultDigest`、加えて `54dd2b4e` がselected、Target `9d817a9b…` が `selectedTargetWeaponIds` に含まれる |

- **過去RESULTを新しい集合評価の実行結果として流用しない**。gate・比較のreferenceはD2-FのI0評価recordだけから読む。D2-D / D2-E RESULTの値はparityの期待値にだけ使う
- **D2-E best EXT（`EXT-K2-t03-c2`、24 / 19）をincumbentとして継承しない**。それは `54dd2b4e` を失った集合である
- I0が比較可能な結果を持ち期待値と異なれば `mismatched`（`D2F_INVALID`）で、runnerは直ちに中止する
- I0がunmeasuredなら、EXTは評価を起動せず `not_executed`（`i0_unmeasured`）で、decisionは `D2F_INCOMPLETE`。WP / CTX / DSC / ADMは続ける（下限evidence）

### 8.2 WP（評価wrapperの手順parity、1件。decisionに使わない）

| 項目 | 値 |
| --- | --- |
| 評価ID | `WP-D2E-EXT-c2` |
| 集合 | I0の9件 ∪ { t03: D2-E K2 c2 `build-list.constrained.fnv1a32-b9c3b154` }（G store `.local/d2e-k2-formal2.run/K2-t03-92d87b90-e396d352-c2.generated-entry.json`、158,357 bytes、`b1ac6a83…10f4`）。D2-E RESULT `decision.bestEligibleExtension` の評価と `discovery.pool[]` から機械導出し、本表と照合する |
| `requiresSupport` | K2 c2: `[92d87b90, e396d352]`、context reservation = D2-E CTX-K2 recordの `reservationBody` / `reservationDigest`（`fnv1a32:fd85c864`）、Search入力reservation digest = D2-E RESULT `discovery.pool[ordinal 2].reservationDigest` |
| `evaluatedAgainst` | `replacement_set` |
| 期待値（parity `d2e_wrapper`） | `inputDigest fnv1a32:2f7009bf`、`evaluated`、`resultDigest fnv1a32:03e2ef58`、`exhausted`、24 / 43、Conflict 19、steps 1470、R5成立 |
| 役割 | D2-F評価wrapperが、D2-Eの2-support pair reservation経路をD2-Eと同じ結果で再現することの確認だけ |

- WPの結果はgate・比較・選択・decisionのいずれにも使わない（`extensions` に入れない）。WPのCandidateはincumbentでもEXTでもない
- WPが比較可能な結果を持ち期待値と異なれば `mismatched`（`D2F_INVALID`、`wrapper_parity`）で、runnerは直ちに中止する
- WPがunmeasuredなら、parity `d2e_wrapper` は `not_checked` で、decisionは `D2F_INCOMPLETE`。他の段は続ける

### 8.3 EXT（admitted K3 Candidateを1件ずつincumbentへ追加）

```text
for c in admitted K3 Candidates（discovery ordinal昇順）:       // 早期打ち切りなし。全件評価する
    proposed = I0の置換集合（9件）∪ { t03: c }               // Target ID昇順、10件
    評価 EXT-K3-t03-c<ordinal>: proposed を evaluatedAgainst = replacement_set として1 runで評価（§6の手順、評価ごとのfull Planner起動上限8）
    記録: R5（§8.4）、EXT診断（§8.5）、gate・improved（§8.6）、R6（§8.7）
```

- 各EXTはI0の集合だけに依存し、他のEXT・WPの結果に依存しない。incumbentの9件のbody・`requiresSupport` は全EXTで同じであり、選び直さない
- 1回のPlannerInputには各Target高々1件の生成Entryだけを入れる（G15）。2件のK3 Candidateを同じPlannerInputへ入れない
- EXT同士の比較・選択は記録済みの結果だけで行い、追加の評価runを行わない。最良EXTを起点にした追加の合成・受理済みTargetの再評価をしない（単一段）
- 評価上限: EXT 2件（admittedが0件ならEXTは0件）

### 8.4 R5（`set_coexistent_R`）

D2-E-A §6.3の5条件を、各評価の置換集合へそのまま適用する（`T`、`S_G = { G_t.id }`、`S_sup = ⋃ requiresSupport(G_t)`、`M = S_G ∪ S_sup`、
(1) `S_G ⊆ selected`、(2) `S_sup ⊆ selected`、(3) S1〜S3、(4) `|c.buildListEntryIds ∩ M| ≥ 2` のConflictなし、(5) Plan + Trace Replay）。

- EXTでは `|S_G| = 10`、**`S_sup = { 54dd2b4e, 61066e62, 92d87b90, e396d352 }`（4件）**、`|M| = 14`。I0では `|S_G| = 9`、`|S_sup| = 3`
- したがってEXTでは、`54dd2b4e` がselectedでなければR5(2)が偽（`support_not_selected`）になり、t03 `G` と `54dd2b4e` のConflict（Skill 648 / Gogma 125等）は
  R5(4)の集合内Conflictになる。これはsupportの定義（`S_sup` = 置換集合の `requiresSupport` の和）を変えずに適用した結果であり、D2-Fのための特例ではない
- R5は置換集合外Targetの完成、Conflict 0、全体completedの増加を要求しない。**R5成立はIssue #154の最終Acceptanceではない**（それはR6）
- supportがPlannerでselectedにならなかった場合は(2)偽でR5不成立（measured、通常の非共存）であり、INVALIDではない

### 8.5 EXTの診断（判定にはR5・gate・improved・R6だけを使う）

D2-E-A §6.4のfield（`t03`、`t03Supports[]`（3件）、`incumbentRetention`、`supportExpired`、`conflictsWithinSet[]`、`conflictsWithT03G[]`（相手の分類 `support` / `incumbent_generated` /
`outside_set`）、`referenceDiff`（I0比）、`t03Completion`、`resourceConflictRejections`）に加えて、次を別fieldとして記録する。

| field | 内容 |
| --- | --- |
| `newSupport` | `{ buildListEntryId: 54dd2b4e, selected, targetWeaponId, targetSelected, winnerBuildListEntryId, S1〜S5, supportExpiryCause }`。`targetSelected` = `54dd2b4e` のTargetが `selectedTargetWeaponIds` に含まれるか（I0では含まれる） |
| `newSupportTargetRetained` | `newSupport.targetSelected`（I0で完成していた `54dd2b4e` のTargetがEXTでも完成しているか） |
| `k2FailureResourcesObserved[]` | Skill 648、Gogma 125の各resource identityについて、t03 `G` をparticipantとするConflictとして現れるか、および `54dd2b4e` をparticipantとするConflictとして現れるか（各true / false、participant列） |
| `priorT03ResourcesObserved[]` | Skill 341、Gogma 71（D2-C）、Skill 344（D2-E c1）の各resource identityが、t03 `G` をparticipantとするConflictとして現れるか |
| `outsideSetConflictsWithT03G[]` | t03 `G` と置換集合外Entry（supportでもincumbentでもないもの。`b4b4c72c` を含み得る）とのConflict（kind、participants、resource identity、`selectedBuildListEntryId`、相手のselected） |
| `t03Completion` | `{ t03TargetCompleted, newSupportTargetRetained, netCompletedDelta, t03CompletedWithoutNetGain, t03CompletedWithNewSupportRetainedWithoutNetGain }`。後者 = `t03TargetCompleted ∧ newSupportTargetRetained ∧ netCompletedDelta ≤ 0`（t03と `54dd2b4e` のTargetを両方保ったが別Targetを失った場合など） |

- **t03が完成し、`54dd2b4e` のTargetも維持されても、別Targetを失ってcompletedが24のままなら「+1完成」と記録しない**。全体の完成数の変化は `netCompletedDelta`
  （= `referenceDiff.completedDelta`）だけで表し、t03の完成・`54dd2b4e` Targetの維持は別fieldに記録する
- 診断はINVALID / INCOMPLETEの理由にしない

### 8.6 非後退gate・「より良い」・選択順

D2-E-A §6.5をそのまま適用する。

- gate: `completed(EXT) ≥ completed(I0)`（I0はD2-F-Bのfresh評価の値で、parityにより24）。gate不成立でR5成立のEXTは `r5OnlyEligible = true`（診断）
- **eligible(EXT)** ⇔ `evaluated` ∧ R5成立 ∧ gate成立
- 「(a) が (b) より良い」は、completedが大きい、またはcompletedが等しくConflict（`result.conflicts.length`）が少ないこと。**stepsは「より良い」に使わない**
- **improved(EXT)** ⇔ eligible(EXT) ∧ (completed, Conflict) がI0より良い。等しい場合は `equalMetrics`、Conflictが多い場合は `conflictIncreased`（いずれも改善ではない）
- `improvementKind`: `completed_increase`（completed > 24）/ `conflict_decrease_only`（completed = 24、Conflict < 19）/ `null`。後者はt03完成による改善と混同しない
- 選択順: (1) completed 大きい方、(2) Conflict 少ない方、(3) `plan.steps.length` 少ない方（同率時のtie-breakだけ）、(4) discovery ordinal 小さい方
- `bestEligibleExtension` / `bestImprovedExtension` = 選択順で最初のもの（無ければnull）。比較値はすべて当該評価runの結果から読み、ADM・WP・過去評価の値を使わない

### 8.7 R6（`global_complete_R`）

D2-E-A §6.6の5条件（`evaluated` ∧ `plan !== null` ∧ Trace Replay成功、`termination.status === 'completed'` ∧ `completedTargetCount === totalTargetCount === 43`、
Conflict 0、`resource_conflict` rejection 0、R5成立）をI0・EXTに適用する。WPは対象外（記録だけ）。R5成立・t03完成・completed増加・Conflict減少だけではR6を主張しない。

## 9. 事前登録条件: Candidate・support validity

### 9.1 RV（1 child。評価・Searchの前に1回だけ行う）

D2-E-A §7.1（incumbent 9件のRV1〜RV4、support 3件 `61066e62` / `92d87b90` / `e396d352` のRV5 / RV6）をそのまま適用し、次を追加する。

| check | 内容 |
| --- | --- |
| RV7（新support） | Exportの `54dd2b4e` のbodyがちょうど1件あり、`SHA-256(stableStringify(body)) === 2dd3ca57…7b81`（§3.2）。そのreservation（`derivePlannerAlternativeReservation([body], engine)`）のdigest・bodyが§4.2の登録値と一致 |
| RV8（WPのK2 Candidate） | D2-E K2 c2のG store bodyについて、bytes・SHA-256がD2-E RESULT `discovery.pool[ordinal 2].generatedEntry` と一致、`id` / `targetWeaponId` / `calculationContext` / `isStale = false`、`candidateSnapshot.searchRunId` がD2-E RESULT `discovery.pool[ordinal 2].searchIdentity`、`SHA-256(candidateStableKey) === a642233d…0b92`、replacement `ready`（`O_t03`）、D2-E CTX-K2 record `reservationBody` に対するR0成立 |

- RV1〜RV8のいずれかの不成立はguardrail違反（`D2F_INVALID`、`guardrail`）であり、runnerは直ちに中止する
- RVはSearchを実行しない。full Planner runも起動しない
- K3 CandidateはRVの対象ではない（RVの時点で存在しない）。K3 CandidateのR0はDSCのconsumer（§5.2）、RV1 / RV2相当は評価child（§9.2）で検査する

### 9.2 評価時のcheck（ADM / I0 / WP / EXT）

support check（`S_sup` の各 `s` について。D2-E-A §7.2のS1〜S5と同じ）:

- S1（`s` のTargetが `T` に無い）、S2（最終run入力に `s` がある）、S3（最終run入力の初期contextに `s` がvalid Entryとしてある）: 動的。不成立はR5(3)偽、`support_expired_R`
- S4（評価入力内の `s` のbodyがExportのbodyと一致し、SHA-256がS5 authorityの `supportBodySha256` と一致）、S5（`derivePlannerAlternativeReservation([Exportの s のbody])`
  のdigest・bodyがS5 authorityと一致）: 静的。不成立はguardrail違反
- S5 authority: `e396d352` → CTX-1、`92d87b90` → CTX-3、`61066e62` → CTX-6（D2-Eと同じ）、**`54dd2b4e` → CTX-K3 recordの `singleSupportReservations[54dd2b4e]`**
  （C8で§4.2の登録値と一致を確認済みのもの）と `supportBodySha256s[54dd2b4e]`。CTX-K3がunmeasuredの場合はADM / EXTが実行されないので、この参照が欠けることはない

K2 / K3 Candidateの組のcheck（評価集合に含まれる各K2 / K3 Candidate `G` について。ADM / WP / EXT）:

| check | 内容 | 不成立時 |
| --- | --- | --- |
| S6 | (a) `hashStableValue(derivePlannerAlternativeReservation([評価入力内の G.requiresSupport の body], engine))` が `G` のcontext record（K3: CTX-K3、WPのK2: D2-E CTX-K2）の `reservationDigest` と一致し、かつ (b) 導出reservationとそのrecordの `reservationBody` の `stableStringify()` が一致する。加えて、`G` のpooled recordのSearch入力reservation digest（WPはD2-E RESULT `discovery.pool[ordinal 2].reservationDigest`）がcontext recordの `reservationDigest` と一致する | guardrail違反（`support_set_reservation_mismatch`、`D2F_INVALID`） |
| RV1′ / RV2′ | full runの前に、評価集合の全 `G` についてbody SHA-256・id・targetWeaponIdとreplacement `ready`（`replacedBuildListEntryId === O_t`）を再確認する | guardrail違反 |

- 評価childへの受け渡し: bytes・SHA-256を照合済みのCTX recordの `reservationBody` オブジェクトと `reservationDigest`、`supportBodySha256` を渡す（文字列を渡さない）
- K0 Candidate（t01 / t06 / t07 / t08 / t09）はsupportを要求しないので、S1〜S6の対象にならない
- supportは通常のBuild List Entryとして扱い、user-fixed Route、resolution、scenario resolution、repair lineage、fixed constraint、`selectedBuildListEntryId` に変換しない（G30）

### 9.3 support失効・不成立の原因（RESULTの `supportExpiryCause`）

D2-C-A §7.3の表とD2-E-A §7.3の追加（`support_pair_reservation_mismatch`）を使い、名称を `support_set_reservation_mismatch`（S6不成立、`D2F_INVALID`）とする。
失効・不成立したCandidateを、別support上の結果、K0 / K1 / K2 Candidate、置換後Routeをsupportとする結果として読み替えない（G18）。失効を理由に自動で再Searchしない。

## 10. 事前登録条件: 実行順序・status・budget・envelope

### 10.1 実行順序（固定）

```text
V      入力検証（親。childを起動しない、§11.1）
RV     incumbent 9件・support 3件・新support・WPのK2 Candidateの再検証（1 child、§9.1）
B0     baseline参照評価（{ kind: 'persisted' }）
I0     D2-D最良incumbentのfresh再評価（§8.1）
WP     評価wrapperの手順parity（§8.2）
CTX    CTX-K3（§5.1）
DSC    L0 → L1 → L2（§5.4の進行規則による）
ADM    discovery ordinal昇順（§7）
EXT    discovery ordinal昇順（admittedだけ、§8.3）
```

- B0 / I0 / WPを高価なdiscoveryの前に行い、parity不一致なら中止する
- 登録された評価をすべて実行する。早期打ち切りはしない。同じ `inputDigest` の評価が既にあっても結果を流用せず、別のchild processで実行する

### 10.2 status

D2-E-A §8.2をそのまま適用し（K2 → K3、`D2E_*` → `D2F_*`）、次を追加する。

| 対象 | status / outcome | measured | 扱い |
| --- | --- | --- | --- |
| WP | unmeasured | **no** | parity `d2e_wrapper` は `not_checked`。他は続ける。decision `D2F_INCOMPLETE` |
| WP | 比較可能な結果が期待値と異なる | — | `mismatched`（`D2F_INVALID`、`wrapper_parity`、runnerは中止） |
| CTX-K3 | C1〜C4 / C6 / C7不成立、C8のCTX-3 / CTX-4一致不成立、C5 / C8の登録値 `mismatched` | — | guardrail違反 / parity不一致（`D2F_INVALID`、runnerは中止） |
| DSC | `context_drift`、R0-K3 / R0-K2 / R0-split不成立、D-1違反 | — | guardrail違反（`D2F_INVALID`） |

- `plan_bound_truncated` と `planner_rerun_bound_reached` はbound-limitedとして一覧に残し、通常の非共存と区別する（measured、R5(5)偽）
- wall-clock timeout・OOM・Search extent bound・`ladder_exhausted` を、Candidate不存在・非共存・extent不足・改善不能の証明として扱わない（G6 / G7 / G34 / G43）

### 10.3 budget（それぞれ独立。Production boundへ流用・合算しない、G5）

| budget | 値 |
| --- | --- |
| context | 1（support / context = 3） |
| CTX child | 1 |
| DSC unit（Search unit） | 3以下 |
| unique Candidate | 2以下 |
| unitあたりdelivery | 11以下（§5.6） |
| RV | 1 child（評価に数えない） |
| B0 / I0 / WP | 各1 |
| ADM | 2以下 |
| EXT | 2以下 |
| 評価リクエスト合計 | B0 1 + I0 1 + WP 1 + ADM ≤ 2 + EXT ≤ 2 = **7以下** |
| child process合計 | RV 1 + CTX 1 + DSC ≤ 3 + 評価 ≤ 7 = **12以下** |
| 評価ごとのfull Planner起動上限 | 8（runtime-unsupported retryを含む。評価ごとに新規。総数は最大56、見込みは評価数と同じ7以下） |
| `researchMaxPlanSteps` | 20000 |

### 10.4 execution envelope

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| RVのwall上限 | 10分 | D2-EのRV（9 Candidate + support 3件）は15.9 s。RV7 / RV8の追加は導出1回・照合1件 |
| CTX-K3のwall上限 | 10分 | D2-EのCTX-K2は9.7 s。CTX-K3は全6順列と単独3件の導出を加える（§1.6の非formal導出はloader起動込みで約36 s） |
| DSC unitのwall上限 | **60分**（全rung共通。超過はtimeout = unmeasured） | Phase B / D2 / D2-C / D2-Eと同じ。既存最大はK1 L2の1,009 s、t03 K2 L2は671 s。K3は未計測で、held拡大によりsame-cost closureが重くなる可能性がある（§1.7） |
| 評価のwall上限 | 30分（preflight、full run、retry、Trace Replayを含むchild全体） | D2-A〜D2-E-Aと同じ。D2-Eの評価は最大14.5 s |
| discovery envelope | run開始から **5時間**。経過後は新しいCTX / DSC childを起動せず、未起動のunitを `not_executed`（`discovery_envelope_reached`）とする（実行中のchildは各上限まで待つ） | 登録上の最悪（RV 10分 + B0 / I0 / WP 90分 + CTX 10分 + L0 / L1 120分でL2開始は3時間50分）でも到達しない安全上限 |
| run envelope | run開始から **8時間**。到達後は新しいchildを起動せず、未起動のunit / 評価を `not_executed`（`run_envelope_reached`）とする | 登録上の最悪（上記 + L2 60分 + ADM / EXT 4 × 30分 = 6時間50分）でも到達しない安全上限 |
| child heap上限 | 12,288 MB（`--max-old-space-size`） | Phase B〜D2-Eと同じ。既存のheap peak最大7.07 GB（K1 L2、t02）、t03 K2 L2は6.00 GB（RSS 6.55 GB）。実行環境の物理メモリ33.4 GBに対しconcurrency 1 |
| concurrency | 1 | 既存と同じ |
| retry / fallback | なし / なし（timeout・OOM・failureでも条件を変えて再実行しない） | G6 |
| child process | RV / CTX / DSC unit・評価ごとに新しいchild。Node yieldは `setImmediate`、memory sample間隔250 ms | 既存と同じ |

既存の予算・上限を継承する妥当性:

- DSC 60分・heap 12 GBは、既存の全Search unit（最大1,009 s、7.07 GB）に対して時間3.5倍以上・heap 1.7倍の余裕がある。K3の実測が無いので、上げ下げする根拠が無い。
  継承することで、K1 / K2と同じ条件でのunmeasured率を比較できる
- K3でheld区間が長くなり（Skill 308位置、Gogma 71位置）、SEARCH_SPEC 5.6.8のsame-cost closureの性質上、最初のCandidateまでの時間・memoryが増える可能性がある。
  **D2-Eと同程度の実行時間を保証しない**。60分 / 12 GBを超えた場合は `unmeasured`（`timeout` / `out_of_memory`）とし、上限を事後に上げない。上限を変えた再計測は新しい事前登録を要する
- discovery / run envelopeはWPの追加（1評価・最大30分）だけD2-Eより長い（D2-E: 4時間 / 7時間）

見積もり（事前登録値ではない。成功条件にしない）: RV 約0.3分、B0 / I0 / WP 約0.5分、CTX 約0.5分、DSC L0 / L1 約1〜3分、DSC L2 約8〜12分（K2並みの場合）〜60分上限、
ADM / EXT 約1分。合計 約14〜22分（L2がK2並みの場合）。

上限の構造: Search unitは3、評価は7、child processは12が上限である。**探索・評価を際限なく続ける規則は無い**。envelopeに達した場合は `not_executed` を記録して
`D2F_INCOMPLETE`（下限evidence）とし、確認できなかった部分をCandidate不存在・非共存・改善不能の証明として扱わない。

### 10.5 途中失敗の扱い

D2-E-A §8.5をそのまま適用し、次を追加する: WPのparity不一致はrunnerが直ちに中止（`D2F_INVALID`）、WPのunmeasuredは他を続ける（`D2F_INCOMPLETE`）、
RV7 / RV8 / C8の不成立はrunnerが直ちに中止（`D2F_INVALID`）。

## 11. 事前登録条件: formal validity・provenance（いずれか違反なら `D2F_INVALID`）

### 11.1 入力（V、analyzerも独立に再検証）

D2-Fが読む入力は次に限る。いずれもRepositoryへ追加しない（committed済みを除く）。`.local` 配下のpathはRepository rootからの相対pathである。

| 入力 | 場所 | bytes | SHA-256 | 読み取り範囲 |
| --- | --- | ---: | --- | --- |
| Export（commitしない） | 外部path（引数）`gogma-artian-planner-backup_20260927015837.json` | 19,424,064 | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b` | PlannerInput構築、support Entry body |
| D2-E formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2E_RESULT.json` | 409,430 | `c80f44a8e94dc80a34d9651a7b4f2d8c1242a0e71edaed95d2d7c9d7f0472d58` | allowlist（下記） |
| D2-D formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2D_RESULT.json` | 402,549 | `5a27030d7be3fd4650eb0094cc2227759a3b0656a096ac09291e5807298fa4b0` | D2-E-A §10.1のallowlist |
| D2-C formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2C_RESULT.json` | 1,541,755 | `99860c42e195de7544f5fa6b7032ad68e91950e107003cd2ed03efc86e9fcc68` | D2-E-A §10.1のallowlistのうち `sources`、`provenance`、`invalidReasons`、`decision.case`、`contexts[]`、`discovery.targets[label = t03].pool[]`、`evaluations[].{evaluationId, status, inputDigest, resultDigest}` |
| D2 formal RESULT（committed） | `docs/PLANNER_GLOBAL_D2_RESULT.json` | 4,122,806 | `ec22ba3e2910fe7704e0521acd08aa2c43a729d8724b044a1084f215f338a88c` | D2-E-A §10.1のallowlist |
| Phase 2-C2 RESULT（committed） | `docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json` | 1,195,107 | `afb70e9745bc56c264c8892075e6adbb8886b82cec1491177aa75d265f1833a4` | `baseline.summary` だけ |
| incumbent G store 9件 | D2-E-A §1.2の9 file | 同左 | 同左（D2-E RESULT `sources.incumbentGeneratedEntries` とも一致） | body全体（評価入力） |
| K1 CTX record 6件 | `.local/d2c-k1-formal.run/CTX-{1,3,4,5,6,7}.context.json` | D2-E-A §1.4 / §1.6 | 同左（D2-E RESULT `sources.d2c.contextRecordsUsed` とも一致） | D2-E-A §10.1と同じfieldだけ |
| D2-E CTX-K2 record | `.local/d2e-k2-formal2.run/CTX-K2.context.json` | 100,563 | `3feb35a7e5746ae2970e8ce64e29bc3bf72aff5b63f54fb056634de7027ee9e4` | `contextId, supportBuildListEntryIds, supportBodySha256s, reservationBody, reservationDigest, originDigest, excludedRouteKeySha256s, status` だけ（既存の `readD2EK2ContextRecord()` で読み、`reservationBody` がJSONオブジェクトであることを確認） |
| D2-E K2 G store c2 | `.local/d2e-k2-formal2.run/K2-t03-92d87b90-e396d352-c2.generated-entry.json` | 158,357 | `b1ac6a83fed5d956fa50c19d415161a33490ab72055d219dfc3a5378135410f4` | body全体（WPの評価入力、RV8） |
| D2-E start attestation・raw | `.local/d2e-k2-formal2.run/start-attestation.json`、`.local/PLANNER_GLOBAL_D2E_K2_RAW2.json.local` | 32,853 / 31,753 | `6d6c4629…b811` / `c0924292…81ad` | hash照合だけ |
| D2-D / D2-C start attestation・raw | D2-E-A §10.1と同じ | 同左 | 同左 | hash照合だけ |
| D2-E-A / D2-E-B文書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2E_SPEC.md` / `…_D2EB.md` | 127,982 / 20,134 | `9bbb824169ac22364b451b6313730c7e2042b181db8557dbfeec359f8fa14797` / `fc1d39d43538ecf4b17525c37e3929718f0495c5d0903e73701c8abb0420e498` | hash照合だけ（D2-E-Aの規則は本書の参照として使う） |
| D2-D-A / D2-D-B / D2-C-A / D2-C-B / D2-A / D2-B / D1-A / Phase A / Phase B / follow-up / D1-B文書 | D2-E RESULT `sources.documents` / `sources.d2d.documents` と同じ | — | 同左 | hash照合だけ（内容を判断入力にしない） |
| 本書 | `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_D2F_SPEC.md` | — | D2-F-Bのmeasurement HEADでgit objectから計算し、start attestationへ記録する | — |

**D2-E RESULTの読み取りallowlist**:

- `sources`（`specDocument` / `d2d.*` / `d2c.*` / `d2.*` / `incumbentGeneratedEntries` / `phase2c2Result` / `export` / `documents` / `d2e.{raw, runDir, attestation, contextRecord, generatedEntries}`）
- `provenance.{formal, measuredHead, analysisHead, measuredHeadIsAncestor, runStatus, benchmarkCodeSha256, registeredPolicySha256, calculationCodeChangedSinceMeasuredHead,
  productionChangedFiles, startAttestation.{sha256, verified}, oracleReadByRunner, oracleReadByChild, oracleReadByAnalyzer, oracleGuidedTargetPopulation}`、`invalidReasons`
- `decision.{case, bestEligibleExtension, bestImprovedExtension, eligibleExtensions, t03CompletedWithoutNetGainExtensions, unmeasuredEvaluations}`、`aggregates.evaluations.{unmeasuredByReason, notExecutedByReason}`
- `context.{contextId, status, record, targetWeaponId, currentBuildListEntryId, supportBuildListEntryIds, supportBodySha256s, reservationDigest, originDigest, excludedRouteKeySha256s}`
- `discovery.{outcome, pool[].{ordinal, keySha256, generatedBuildListEntryId, generatedEntry, searchIdentity, reservationDigest, requiresSupport}}`
- `evaluations[evaluationId ∈ {I0} ∪ EXT].{evaluationId, stage, status, inputDigest, resultDigest, r5.satisfied, eligible, plan.{termination, steps, selectedBuildListEntryIds},
  conflicts（件数）, rejectedBuildListEntries, resourceConflictRejections, selectedTargetWeaponIds, referenceDiff.{targetsGained, targetsLost},
  extension.{t03Completion, conflictsWithT03G[].{resourceIdentity, participants, others}}}`
- `evaluations[].{evaluationId, status, inputDigest, resultDigest}`（`determinism_prior` だけ）

検証条件（D2-E-A §10.1のD2-D / D2-C / D2 RESULTの検証条件に加えて）:

- D2-E RESULT: `provenance.formal === true`、`measuredHead === analysisHead === d294efb005e4943627f3ed27873a33ed7ead8173`、`runStatus === 'completed'`、
  `calculationCodeChangedSinceMeasuredHead` が空、Production changed filesが空、`invalidReasons` が空、unmeasured / not_executedが0、
  `decision.case === 'D2E_SET_COEXISTENT_NOT_BETTER'`、`startAttestation.verified === true`、`oracleReadBy* === false`、`context.status === 'context_ready'`、
  `context.reservationDigest === 'fnv1a32:fd85c864'`、`sources.d2e.contextRecord` がCTX-K2 recordのbytes・SHA-256と一致、I0が§1.1の値
- §3.1の導出が§3.2と一致し、§8.1のI0集合をD2-D RESULTから導出した結果がD2-E-A §1.2と一致し、`d1InputDigest()` で再計算した `inputDigest` が `fnv1a32:6493291d` であること
- §8.2のWP集合をD2-E RESULTから導出した結果が§8.2の表と一致し、再計算した `inputDigest` が `fnv1a32:2f7009bf` であること
- 同じsupportのK1 CTX record同士、およびCTX-K2の `originDigest` / `excludedRouteKeySha256s` がCTX-3 / CTX-4と一致すること

**入力検証の失敗は黙って代替しない**。ファイル不足、SHA-256 / bytes不一致、record間の不整合、§3.1の導出不一致があれば、別ファイル・再計算値・近い値で代替せず、
runnerはchildを1つも起動せずに終了し、analyzerは `D2F_INVALID`（reason category `input_evidence`）を出す。旧D2-E run（`.local/d2e-k2-formal.run/`）のfileを代替に使わない。

### 11.2 measurement HEAD・provenance

D2-E-A §10.2をそのまま適用する（読み替え: 本書、§11.1の入力、登録policy = §13の `conditions` に入る登録条件（K3 context表、導出規則、登録reservation（K3と単独）、
ladder、`K3_POOL_CAP`、重複排除規則、評価手順、gate・選択順・budget・envelope・decision rule）を `stableStringify()` したもののSHA-256、
calculation code digest = D2-F benchmark codeと推移的にimportするResearch計算moduleのSHA-256）。

- D2-F-Bのrunner / child / analyzer / test / 本書を含むmeasurement HEADを正式計測前にcommitし、**Working Tree cleanの状態**で計測する
- runnerはchild起動前に **start attestation**（`wx`、read-only）を書く。記録するもの: 本書のSHA-256（measurement HEADのgit object）、§11.1の全digest、登録policy SHA-256、
  calculation code digest、uncommitted false、Production audit（D2-F-B開始時のbase main以降のProduction changed files `[]`）、`appliedExecutionEnvelope`、
  CalculationContext、`PRODUCTION_RNG_ENGINE_VERSION`、Vで観測した§11.1の入力digest
- analyzerはattestationをmeasurement HEADのgit objectと照合し、measurement HEADがanalysis HEADのancestorであること、**measurement HEAD以降の計算コード変更が `[]`**、
  **Production source changed files**（`src/domain` / `services` / `workers` / `pages` / `components` / `db`）**が `[]`** であることを確認する
- **計算コード変更後の結果流用禁止**: measurement HEAD以降に計算コードが変わった場合、そのrunを正式結果として使わない。再計測は新しいmeasurement HEADで最初から
  （V → RV → B0 → I0 → WP → CTX → DSC → ADM → EXT）**全段階をやり直し**、部分的なrecordの再利用・merge・継ぎ足しをしない。異なるmeasurement HEADのrecordを混在させない
- raw / journal / record / G storeの整合: runnerは全child recordとG storeのbytes・SHA-256をjournal（`rv.jsonl` / `contexts.jsonl` / `discovery.jsonl` / `evaluations.jsonl`）へ追記し、
  rawとRESULTの `sources.d2f` はそれと一致しなければならない。analyzerはjournal・raw・record・G storeのbytes・SHA-256を独立に照合する
- **analyzerの独立判定**: analyzerはrunner / childの自己申告（R0、C1〜C8、S1〜S6、R1、R5、gate、improved、R6、parity、decision）をそのまま使わず、recordとExportから再計算し、
  不一致は `D2F_INVALID`。R5は独立再判定と `judgeD1R5()` の相互照合を行う
- 正式計測後に本書の意味論を変更しない。変更が必要になった場合は、本書の改訂を記録し、改訂後の新しいmeasurement HEADから全段階を再計測する。旧runのevidenceは監査用に保持し、
  正式evidenceとして採用しない
- CalculationContextが `{ 'unknown-initial', 4, 'production-rng:c5-e7', 17 }`、`PRODUCTION_RNG_ENGINE_VERSION === 'production-rng:c5-e7'` であること。D2-F-B開始時点で
  これらが動いていた場合は、D2-Fを実行せず本書の再登録を先に行う
- smoke（非formal確認）はformal run dirと別に行い、formal evidenceにしない。smokeの結果で条件を変えない

### 11.3 guardrail検査・oracle isolation

D2-E-A §10.3をそのまま適用し、次を追加・読み替える。

- G1: すべての評価runで `conflictResolutions` 0件、preflightのfixed constraint 0件
- **oracle isolation**: runner / child / analyzerは、oracle module（`plannerGlobalOracle1657*`）、Phase B analysis module（`plannerGlobalPhase2C27BAnalysis*`）、
  population-authority module（`plannerGlobalPhase2C27BTargets*`）、`*Interpretation*` / `*FormalValidation*` / `*LowerBound*`、Phase 2-C2.5-D2-D（`plannerGlobalPhase2C25D2D*`）、
  Phase 2-C2.5-D2-E（`plannerGlobalPhase2C25D2E*`）、および将来のPhase 2-C2.5-D2-F（`plannerGlobalPhase2C25D2F*`）を推移的にimportしない（testでimport closureを検査）。
  oracle RESULT・oracle manifest・population manifest（`.local/PLANNER_GLOBAL_PHASE2C27B_FORMAL_TARGETS.json.local`）を読まない。D2 / D2-C / D2-D / D2-E RESULTはallowlistのfieldだけを読む
- populationがoracle-informedであったprovenanceは隠さず、RESULTの `provenance.oracleGuidedTargetPopulation = true` として記録する
- D2-F-B sourceにTarget ID / Entry ID / stable keyを書かない（testで検査）。§11.1のfile名・SHA-256、§4の登録digest・登録reservation body、§8の登録digestは登録値として置いてよい。
  K3 context表・I0集合・WP集合は§3.1 / §8.1 / §8.2の導出をVで再実行して得て、本書の表は照合にだけ使う。登録reservation bodyは本書§1.6のJSONから読む
- 登録された順序（§10.1）・規則以外のunit / 評価が無い（retry、再実行、追加評価、順序違反、件数違反なし）。child process数 = 実行したRV + CTX + DSC + 評価の数
- discovery / ADM / EXTのreplay: analyzerは記録済みの結果からrung進行・pool構成・重複排除、admission、R5・gate・improved・選択順を再実行し、記録と一致することを確認する
- Phase B / D1 / D2 / D2-C / D2-D / D2-Eのmoduleとformal RESULT・record・G store・CTX recordを変更しない（D2-F-Bは新しいmoduleからimportして使う。
  既存testの「他moduleからのimportを禁止する」検査に登録上の後継D2-Fをexact pathで許可対象として加える場合は、検査の厳しさを他moduleについて変えない）

### 11.4 run dir・file名

| 用途 | 名前（推奨。D2-F-Bで変えてよいが、既存名と衝突させない） |
| --- | --- |
| formal run dir | `.local/d2f-k3-formal.run/` |
| raw | `.local/PLANNER_GLOBAL_D2F_K3_RAW.json.local` |
| smoke | `.local/d2f-k3-smoke/` |
| RESULT（committed） | `docs/PLANNER_GLOBAL_D2F_RESULT.json` |
| RV record | `<run dir>/RV.record.json` |
| CTX record | `<run dir>/CTX-K3.context.json` |
| DSC record | `<run dir>/DSC-K3-<rung>.record.json` |
| G store | `<run dir>/K3-t03-54dd2b4e-92d87b90-e396d352-c<context内index>.generated-entry.json` |
| 評価record | `<run dir>/<評価ID>.record.json` |
| module（推奨） | `src/benchmarks/plannerGlobalD2F.ts` / `plannerGlobalD2FAnalysis.ts` / `plannerGlobalD2F.test.ts`、`scripts/run-planner-global-d2f.mjs` / `scripts/analyze-planner-global-d2f.mjs` |

Phase 2-C2.5系の成果物（`PLANNER_GLOBAL_PHASE2C25*`、`plannerGlobalPhase2C25*`、`scripts/analyze-planner-global-phase2c25*.mjs`）はD2-Fとは無関係である。読まない、再利用しない、変更しない。
D2-Fのmodule参照検査は、`D2F` という部分文字列ではなく正確なpathで行う。D2-B / D2-C / D2-D / D2-Eのrun dirは読み取り専用で、D2-Fのfileを書き込まない。

### 11.5 証拠の欠損・破損

D2-E-A §10.5をそのまま適用する。RV / CTX / DSC / 評価record、G store、入力のCTX record（K1 6件、D2-E CTX-K2）・D2-E K2 G storeのいずれかが、process outcome completedなのに存在しない、
SHA-256 / bytesがjournal・raw・RESULTの `sources` と一致しない、必須fieldが欠ける、`reservationBody` がJSONオブジェクトでない場合は `D2F_INVALID`（`evidence_integrity`）であり、未計測に読み替えない。

## 12. 事前登録条件: parity・決定性・decision

### 12.1 parity

parity状態はD2-E-A §9と同じ4状態（`matched` / `mismatched` / `not_checked` / `not_applicable`）。`mismatched` は `D2F_INVALID`、`not_checked` は `D2F_INCOMPLETE` に含まれる。
analyzerはrecordから独立に再計算する。

| 検査 | kind | 比較対象・期待値 | category |
| --- | --- | --- | --- |
| B0 | `baseline` | D2-E / D2-D B0: `inputDigest fnv1a32:6f151dc3`、`resultDigest fnv1a32:880bbb52`、`evaluated`、`exhausted`、20 / 43、Conflict 21、steps 1465。Phase 2-C2 RESULT `baseline.summary` とも一致 | `baseline_parity_mismatch` |
| I0 | `d2d_best` / `d2e_i0` | §8.1の期待値 | `d2d_parity` |
| I0の入力 | `registered_input` | `inputDigest = fnv1a32:6493291d`（評価childの記録値とVの再計算値） | `guardrail` |
| WP | `d2e_wrapper` | §8.2の期待値（`fnv1a32:2f7009bf` / `fnv1a32:03e2ef58`、24 / 19 / 1470、R5成立） | `wrapper_parity` |
| K1 support context | `k1_context` | RV6 / S5 / C8: 各既存supportのK1 CTX recordの `reservationDigest` / `reservationBody` と導出値 | `k1_context_parity` |
| K2 context | `k2_context_prior` | CTX-K3のC4 / C6、RV8: D2-E CTX-K2 recordとの一致・包含 | `k2_context_parity` |
| K3 context | `k3_context_registered` | §5.1 C5（§4.1の登録digest・body） | `k3_context_parity` |
| 新support単独 | `k1_new_support_registered` | §5.1 C8・RV7（§4.2の登録digest・body） | `k3_context_parity` |
| Phase B prefix | — | Phase BはK ≤ 1だけで、K3 contextの対応unitが無い | `not_applicable` |
| D2-F内 | `determinism_d2f` | `inputDigest` が同じD2-F評価の組（登録上は存在しない） | `determinism` |
| 既存Researchとの照合 | `determinism_prior` | D2-F評価の `inputDigest` がD2-E（6件）・D2-D（8件）・D2-C（26件）・D2（86件）RESULTの評価と一致するもの。登録上はB0、I0、WP（D2-E EXT-c2）。ADM / EXTは新しいG storeを含むので一致しない見込み（analyzerは検査する） | `determinism` |

- 既存RESULTの記録はparityの期待値としてだけ使い、R5・受理・decisionへ流用しない
- 1件でも `mismatched` があれば、他に `not_checked` があっても `D2F_INVALID` である

### 12.2 比較基準（固定）

| 基準 | completed / 43 | Conflict | steps | 出典 |
| --- | ---: | ---: | ---: | --- |
| baseline（B0） | 20 | 21 | 1465 | D2-E / D2-D RESULT `B0`（D2-FのB0もparityで一致を要求） |
| D2-C最終 | 23 | 20 | 1465 | D2-D RESULT `I0`（読み取り専用の参照値。D2-Fでは評価しない） |
| **D2-D最良（I0）** | **24** | **19** | **1465** | D2-D `PAIR-t05c1-t07c3`（D2-FのI0もparityで一致を要求し、gate・比較にはI0の実行結果を使う） |
| D2-E best EXT（参考） | 24 | 19 | 1470 | D2-E `EXT-K2-t03-c2`（`54dd2b4e` を失った集合。比較基準・incumbentにしない。WPのparity期待値だけ） |

### 12.3 decision（`decision.case`、上から順に判定）

| decision | 条件 |
| --- | --- |
| `D2F_INVALID` | §5 / §9 / §11 / §12.1のformal validityに1件でも違反。parity `mismatched` を含む。reason category: `input_evidence` / `provenance` / `baseline_parity_mismatch` / `d2d_parity` / `wrapper_parity` / `k1_context_parity` / `k2_context_parity` / `k3_context_parity` / `guardrail` / `determinism` / `evidence_integrity` / `raw_result_mismatch` |
| `D2F_INCOMPLETE` | invalid 0、かつ登録・policy-requiredなRV / B0 / I0 / WP / CTX / DSC / ADM / EXTのいずれかがunmeasuredまたは `not_executed` |
| `D2F_GLOBAL_COMPLETE_R` | invalid 0、unmeasured 0、いずれかのEXTがR6を満たす |
| `D2F_EXCEEDS_D2D_BEST` | 上記以外で、improvedなEXTが1件以上ある |
| `D2F_SET_COEXISTENT_NOT_BETTER` | 上記以外で、R5成立のEXTが1件以上ある（gate不成立、またはcompleted 24でConflict ≥ 19） |
| `D2F_NO_SET_COEXISTENCE` | 上記以外で、EXTが1件以上measuredで、すべてR5不成立 |
| `D2F_NO_ADMITTED_K3_CANDIDATE` | invalid 0、unmeasured 0、poolが1件以上で、ADMがすべてmeasuredでR1不成立（EXTは0件） |
| `D2F_NO_K3_CANDIDATE` | invalid 0、unmeasured 0、discoveryが `ladder_exhausted` または `discovery_exhausted` で終わり、poolが0件 |

- 判定順は INVALID → INCOMPLETE → 改善（`D2F_GLOBAL_COMPLETE_R` / `D2F_EXCEEDS_D2D_BEST`）→ 改善なし で変えない
- decisionには修飾fieldを必ず付ける: D2-E-A §11.2の修飾field（`D2E` → `D2F`、`K2` → `K3`）に加えて、`newSupportSelectedExtensions[]`（`54dd2b4e` がselectedのEXT）、
  `newSupportTargetRetainedExtensions[]`、`newSupportLostExtensions[]`（`54dd2b4e` が非selectedのEXT）、`t03CompletedWithNewSupportRetainedWithoutNetGainExtensions[]`、
  `wrapperParity`（WPのparity状態）
- **K3 Candidateのdiscovery、t03自身のselected、`54dd2b4e` のselected、置換集合の共存（R5）、全体指標の改善（improved）、R6は別fieldに記録し、一方から他方を推論しない**
- `D2F_INCOMPLETE` でも、measuredだった結果を **下限のevidence** として記録する（`globalCompleteObservedUnderIncomplete`、`exceedsD2dObservedUnderIncomplete`、
  `setCoexistenceObservedUnderIncomplete`、`k3CandidateObservedUnderIncomplete`）
- 通常の非共存・不受理（R5不成立、gate不成立、R1不成立、`preflight_refused`、bound-limited、support失効・非selected、extent bound / ladder exhausted）はmeasuredであり、INVALIDにもINCOMPLETEにもしない

## 13. 事前登録条件: RESULT schema（D2-F-Bで固定する必須field）

D2-F-Bのanalyzerは `docs/PLANNER_GLOBAL_D2F_RESULT.json`（committed）を出力する。raw（`.local`、commitしない）とrun dir（RV / CTX / DSC / 評価record、G store、
start attestation）はRepositoryへ追加しない。D2-E-A §12の必須fieldを次の読み替え・追加で使い、意味を変えない（追加fieldは可）。

```text
phase                      "Issue #154 D2-F: t03 three-support K3 context discovery and extension of the D2-D best incumbent (post-hoc analysis)"
sources                    D2-E-A §12に加えて d2e { result, attestation, raw, contextRecord, wpGeneratedEntry, documents { d2eA, d2eB } }、d2f { raw, runDir, attestation, rvRecord, contextRecord, discoveryRecords[], generatedEntries[], records[] }
provenance                 D2-E-A §12に加えて d2eMeasuredHead, d2eResultFieldsRead: [allowlist], d2eResultModified: false, k3ReservationDerivedFromSupportBodies: true,
                           k1k2ReservationUnionUsedAsSemantics: false, d2eBestExtensionUsedAsIncumbent: false, searchScope: 't03 K3 context only'
conditions                 k3Context（§3.2）, derivationRule（§3.1）, registeredReservation（§4.1）, registeredNewSupportReservation（§4.2）, ladder, k3PoolCap: 2, dedupRules（D-1〜D-6）,
                           deliveryCapPerUnit: 11, incumbent, order（§10.1）, i0Rule, wrapperParityRule（§8.2）, evaluationProcedure（§6）, admissionRule, extensionRule,
                           r5Definition, extensionDiagnostics（§8.5）, gate / betterRule / improvedRule / selectionOrder, r6Definition, rvChecks（RV1〜RV8）, contextChecks（C1〜C8）,
                           supportChecks（S1〜S6）, supportExpiryCauses, budgets（§10.3）, executionEnvelope（§10.4）, researchMaxPlanSteps, evaluationFullRunCap: 8,
                           decisionRule（§12.3、文字列配列）, comparisonBaselines（§12.2）, notRun
inputValidation            { passed, issues[], derivedK3Context { targetWeaponId, currentBuildListEntryId, k2Supports[], extendedEvaluationId, lostTargetWeaponIds[], addedSupport, supportBuildListEntryIds[] },
                             derivedI0 {…}, derivedWp { generatedBuildListEntryIds[], generatedEntrySha256s[], requiresSupport[], inputDigest } }
rv                         D2-E-A §12に加えて newSupport { RV7 {…} }、wpCandidate { RV8 {…} }
context                    D2-E-A §12に加えて singleSupportReservations { [s]: { reservationDigest, reservationBody } }、
                           checks { C1〜C7, C8 { state, expectedDigest, observedDigest, bodyMatched, existingSupportsMatched } }、
                           diagnostics { equalsK1ComponentwiseUnion, equalsK2UnionNewSupport, registeredResources[] }
discovery                  D2-E-A §12に加えて deliveries[].{ r0K3, r0K2, r0Split { [s]: boolean }, matchedD2eK2Ordinal | null }
evaluations[]              D2-E-A §12に加えて stage: B0 | I0 | WP | ADM | EXT、extension { …, newSupport, newSupportTargetRetained, k2FailureResourcesObserved[],
                           priorT03ResourcesObserved[], outsideSetConflictsWithT03G[], t03Completion {…} } | null（EXTだけ）、
                           setReservationCheck { S6 {…} } | null（ADM / WP / EXT）
parityChecks[]             kind: baseline | d2d_best | d2e_i0 | registered_input | d2e_wrapper | k1_context | k2_context_prior | k3_context_registered | k1_new_support_registered |
                           determinism_d2f | determinism_prior
extensions / comparison / aggregates / invalidReasons / decision   D2-E-A §12と同じ（registeredMax: 評価7、child process 12、DSC 3）。WPは extensions・comparison に入れない
```

## 14. 事前登録条件: 言えること・言えないこと

### 14.1 decisionごと

- `D2F_GLOBAL_COMPLETE_R`: このExport・登録K3 context・Research envelopeで、D2-D最良集合にt03 K3 Candidateを加えて、43 / 43、Conflict 0、`resource_conflict` 0、
  Trace Replay成功のPlanに到達した。Production runtimeとしての許容、別Export・別populationへの一般化、Production semanticsとしての妥当性は言えない
- `D2F_EXCEEDS_D2D_BEST`: t03 K3 Candidateの追加で、D2-D最良（24 / 19）より良い完成・Conflictの置換集合を得た。`improvementKind` が `conflict_decrease_only` なら、
  t03の完成による改善ではない。R6には達していない
- `D2F_SET_COEXISTENT_NOT_BETTER`: t03 K3 Candidateを含む置換集合はR5（`54dd2b4e` を含む4 supportのselectedを含む）を満たしたが、全体のcompleted・ConflictはD2-D最良より良くならなかった
- `D2F_NO_SET_COEXISTENCE`: **他のCandidate・別support・別extent・別の合成で解消できないことの証明ではない**。言えるのは「登録K3 contextのCandidate（高々2件）を
  D2-D最良へ1件ずつ加えた1 run評価では、置換集合としてR5を満たすものは無かった」ことだけである
- `D2F_NO_ADMITTED_K3_CANDIDATE`: K3 Candidateは得られたが、baseline上のR1を満たさなかった
- `D2F_NO_K3_CANDIDATE`: 登録ladder（L2まで）・`K3_POOL_CAP = 2` の範囲で、K3 contextのSearchはCandidateをdeliverしなかった。**Candidate不存在の証明ではない**
- `D2F_INCOMPLETE`: measuredな範囲の結果は下限であり、「unmeasuredが無ければ同じ結果だった」とは主張しない

### 14.2 共通

- K3 Candidateが得られても、selectedにならない・R5を満たさない・改善しない場合、**K3仮説が誤りだったとは結論づけない**。未評価のもの: 3件目以降のK3 Candidate、
  L2より広いextent、`b4b4c72c` 等の他のco-participant、`54dd2b4e` 側Targetの代替Route、incumbentの同時変更、複数pass、K4以上
- t03が完成し `54dd2b4e` のTargetも維持されても、別Targetを失ってcompletedが24のままなら「+1完成」とは言わない
- R5成立は置換集合としての共存だけを示し、集合外Targetの完成やConflict 0を示さない。**R5成立をIssue #154の最終Acceptance（R6）と混同しない**
- WPのparity matchedは、D2-F評価wrapperがD2-Eの2-support経路を再現したことだけを示す。3-support経路の正しさの証明ではない（§6）
- I-D2F-1〜5（§1.8）は予想であり、結果がどうであっても一般化しない
- E1由来の対象Target（t03）はoracle-informedなpopulationの部分集合であり（`oracleGuidedTargetPopulation = true`）、別populationへの一般化は主張しない

## 15. 既存API（D2-F-Bで使う部品。Production変更なし）と新規に必要なResearch処理

### 15.1 再利用する既存部品

D2-E-A §14.1の部品をそのまま使う（`globalResearchInputFromExport()` / `globalResearchDependencies()`、`phase2c27bResolveSupportContext()`、`derivePlannerAlternativeReservation()`、
`createPlannerRouteUnitPlans()`、`collectReferencedOwnedWeaponIds()`、`derivePhase2C26B2C1Schedule()`、`visitPlannerAlternativeCandidates()`、`createPlannerAlternativeMaterializer()`、
`createPlannerAlternativeSearchIdentity()`、`summarizePhase2C2Entry()` / `respectsPhase2C2Reservation()`、`resolveBuildListEntryReplacement()`、`candidateStableKey()`、
`preparePlannerReplacementConflictPreflight()`、`createPlannerConflictContexts()`、`createPlannerAlternativeFullRunner()`、`createPhase2C27BLadderRerunBudget()`、
D1の `d1InputDigest()` / `d1ResultDigest()` / `judgeD1R5()` / `judgeD1R5Independently()` / `d1B0Parity()` / `d1RuntimeUnsupportedRemoved()` / `isD1BoundLimited()`、
D2の `d2R1R4()` / `judgeD2R6()` / `d2DiscoveryUnitOutcome()`、`judgePlannerAlternativeTrial()`、`readD2CContextRecord()`、`d2cSupportExpiryCause()`、D2-Dの `runD2DReverification()`、
`hashStableValue()` / `stableStringify()`）。D2-Eの `runD2EEvaluation()` は§6(3)(a)の比較対象としてtestで使う。

### 15.2 D2-F-Bで新規に必要なResearch処理（D2-F moduleに置く）

| 処理 | 内容 |
| --- | --- |
| 登録条件・policy | §3.2 / §4の登録値（照合用）、§8.1 / §8.2の登録 `inputDigest`、ladder、`K3_POOL_CAP`、budget、envelope、decision rule、登録policy SHA-256 |
| V | D2-E / D2-D / D2-C / D2 RESULTのallowlist projection、§3.1 / §8.1 / §8.2の導出、G store 9件 + D2-E K2 c2・K1 CTX record 6件・D2-E CTX-K2 recordの照合、`inputDigest` 再計算 |
| RV unit | §9.1（RV1〜RV8） |
| CTX-K3 unit | §5.1のC1〜C8（D2-Eの `prepareD2EContextRecord()` はsupport 2件専用なので、support 3件のrecordを新規に作る。導出部品はD2-Eと同じ） |
| DSC unit | §5.2のconsumer（R0-K3 / R0-K2 / R0-split、D-2 / D-4 / D-5 / D-6、cap 2）、context drift、§5.4のrung進行 |
| 評価wrapper | §6の `runD2FEvaluation()`（`runD2EEvaluation()` と同じ部品・同じ順序、support上限3、S4〜S6）。D2-E moduleを変更しない |
| 評価task構築 | ADM（`requiresSupport = S`、CTX-K3の値）、I0（9件）、WP（9件 + D2-E K2 c2）、EXT（9件 + K3 Candidate） |
| 判定 | §8.5のEXT診断、§8.6のgate・improved・`improvementKind`・選択順 |
| parity | `d2d_best` / `d2e_i0` / `registered_input` / `d2e_wrapper` / `k1_context` / `k2_context_prior` / `k3_context_registered` / `k1_new_support_registered` / `determinism_d2f` / `determinism_prior` |
| decision | §12.3（`D2F_*`） |
| runner / analyzer | `scripts/run-planner-global-d2f.mjs`（親 + `rv` / `context` / `discover` / `evaluate` child、journal、abort、5時間discovery envelope、8時間run envelope）、`scripts/analyze-planner-global-d2f.mjs` |

## 16. guardrail（D2-E-A G44〜G52に追加）

| ID | guardrail |
| --- | --- |
| G53 | D2-FのSearchはt03のK3 context 1件だけである。他のTarget・他のsupport集合・K4以上のcontextのSearchをしない。結果を見てcontext・support・extentを追加しない |
| G54 | K3 reservationは3 supportのExport Entry bodyから既存authorityで導出する。K1 / K2 reservationの文字列・配列レベルのunionをsemanticsとして使わない |
| G55 | K3 Candidateは、K3 reservation・D2-E K2 reservation・support別単独reservationのすべてについてR0を満たさなければpoolしない（不成立はguardrail違反）。K3であることを理由にR0 / R1 / R5を緩めない |
| G56 | 合成の起点はD2-D最良（PAIR-3）のfresh再評価（I0）だけである。D2-E best EXT（`EXT-K2-t03-c2`）をincumbent・referenceとして使わない。WPはparity専用である |
| G57 | EXTはincumbentへのt03 K3 Candidate 1件の追加だけである。incumbentの9件を置換・除外・再評価しない。EXTの結果を受けた追加の評価・合成をしない |
| G58 | discovery、t03自身のselected、`54dd2b4e` のselected・Target維持、R5、improved、R6を別々に記録し、互いに読み替えない。t03の完成を全体のcompleted増加と読み替えない |
| G59 | D2-B K0 / D2-C K1 / D2-E K2のt03 CandidateをI0に対して再評価しない（D-4〜D-6は除外規則であり、評価の代わりではない。WPはD2-E評価の再現であり、集合評価ではない） |
| G60 | D2-F評価wrapperはD2-Eと同じProduction部品・同じ順序を使い、変えるのはsupport件数の静的上限だけである。D2-E moduleを変更しない |
| G61 | D2-FのmoduleとPhase 2-C2.5系（`plannerGlobalPhase2C25*`）を相互にimportしない。成果物名・run dirを共有しない |

Issue #154はCloseしない。

## 17. 未決事項（D2-Fの外、またはD2-F-B以降）

D2-Fの判定に必要な意味論は本書で確定した。次はD2-Fの外の事項である。

1. D2-F-Bの実装名（module / script / field綴り）。§13の必須fieldの意味と§12の判定順序は変えない
2. t02の探索（L2より広いextent、別support、K2）
3. t05 / t07の3件目以降・別supportのCandidate、t04 / t10の同値置換を外す別axis
4. t03のK3 Candidateの3件目以降、L2より広いextent、`b4b4c72c` 等の他のco-participantをsupportに含むcontext、K4以上
5. `54dd2b4e` 側Targetの代替Route探索、incumbent t00とt03の同時変更、D2-Fの結果を新しい起点にした後続合成（複数pass、3 Target以上の局所再合成）
6. E2 9 Target全体の探索、residual 3、population拡大（baseline未完成23 Target、43全体）
7. Production化に伴うREQUIREMENTS 23の契約変更の要否（follow-up §10）

## 18. D2-E-Aからの変更・追加点

| # | D2-E-A | 本書で正式に採用する条件 | 理由 |
| --- | --- | --- | --- |
| 1 | K2 context（support 2件）1件 | **K3 context（support 3件）1件**（t03） | D2-Eで観測された置換集合外Entryとの交換（§1.2）を、その資源をreservationへ含めて測るため |
| 2 | supportはD2-CのK1 context supportの和（cross-support loss） | D2-E CTX-K2のsupport ∪ `EXT-K2-t03-c2` でt03に負けたI0 selectedの置換集合外Entry（§3.1） | 依頼の仮説をD2-E evidenceから機械導出するため |
| 3 | reservationはsupport 2件から導出、C1〜C7 | support 3件のbodyから既存authorityで導出し、C7を全6順列に、C8（新supportの単独reservation登録値parity）を追加 | union semanticsを作らず、新supportのS5 authorityを確定するため |
| 4 | 重複排除 D-1〜D-5 | D-6（D2-Eのt03 K2 pool）を追加。unitあたりdelivery 11 | K2で既に評価されたRouteを再評価しないため |
| 5 | R0-K2 / R0-split（K1 2件） | R0-K3 / R0-K2（D2-E CTX-K2）/ R0-split（単独3件） | 包含関係から含意される不変条件をfail-closedで確認するため |
| 6 | 評価wrapper `runD2EEvaluation()`（support上限2） | D2-F moduleの `runD2FEvaluation()`（同じ部品・同じ順序、support上限3）とWP parity | D2-E moduleを変えずに3 supportを扱い、2-support経路の再現をformalに確認するため |
| 7 | EXTの `S_sup` 3件 | EXTの `S_sup` 4件（`54dd2b4e` を含む）、`newSupport` 診断を追加 | `requiresSupport` の和という定義をそのまま適用した結果。`54dd2b4e` のselected・Target維持を別に記録するため |
| 8 | 評価6 / child 11、envelope 4時間 / 7時間 | 評価7 / child 12、envelope 5時間 / 8時間 | WPの1評価を加えても登録上の最悪（6時間50分）に到達しない安全上限にするため |
| 9 | decision `D2E_*` | `D2F_*`（`D2F_NO_ADMITTED_K3_CANDIDATE` / `D2F_NO_K3_CANDIDATE`、修飾field `newSupport*` / `wrapperParity`） | discovery・admission・共存・改善・新supportの維持を区別するため |

## 19. validation

- `git diff --check`
- `npm run check:nul`、`npm run lint`、`npm test`、`npm run build`（docs-onlyのため挙動変化は無い。結果はPRに記載）
