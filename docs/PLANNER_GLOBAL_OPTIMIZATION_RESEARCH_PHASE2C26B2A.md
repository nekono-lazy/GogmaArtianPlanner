# Global Planner Research Phase 2-C2.6-B2-A（1,657 oracle Routeの未coverage要因の事後監査）

Refs #154。Research only。Production source、Search / Planner semantics、extent、capture bound、trial / rerun bound、RNG、
schema / version、Persistence、UIは変更していない。`visitPlannerAlternativeCandidates()` の新規実行、extent probe、
Planner Alternative kernel、Planner trial、full Planner、global assignment、Candidate組合せ探索、runtime optimizationは行っていない。

- measured HEAD: `ae2083f076c3ddfa6d2c7b45248be9a43c2da1d1`（context snapshot計算module・runner・analyzer・事前登録decision rule・testsを含むclean HEAD）
- analysis HEAD: `0da244d35a02d7b3ea4af3179a52caf69ab946d3`（measured HEAD以降の変更はpost-hoc解析 `plannerGlobalPhase2C26B2AAnalysis.ts`・analyzer・testのみで
  `calculationCodeChangedSinceMeasuredHead = []`。formal snapshotの再測定はしていない。§17）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json)（`provenance.formal = true`）

## 1. 結論（`B2A_BOTH`）

B1 formal evidence、current pre-Search context（146件の再導出snapshot）、1,657 oracleを **post-hoc** に照合し、
B1でuncoveredだったoracle Route 41件の失われ方を分類した。

| 分類（uncovered 41件） | 件数 |
| --- | ---: |
| **probe可能gap**（reservation互換contextがあり、Search完走 / capture / extent / 未観測のいずれかで失われる） | **1** |
| **context gap**（single-winner Search context無し、またはどのcontextもreservation / held / exclusive条件を満たさない） | **40** |
| うち Search context無し（Conflict non-participant） | 9 |
| うち contextはあるが全context非互換 | 31 |
| 説明不能 | 0 |

事前登録ruleにより **B2A-BOTH**（probe可能gapとcontext gapが両方存在）。ただし量的には **context gapが40 / 41で支配的** で、
probe可能gapは1件（`extent_insufficient`）のみである。

**formalに言えること**（このExport・current Production・B1の146 context・default extent `{ 4, 235, 4 }` について）:

- B1の未完走（timeout）contextとcapture bound 8到達（consumer stop）contextは、**uncovered oracle Routeを1件も隠していない**。
  uncovered Routeに関係するtimeout context 17件のうち16件はreservation非互換、1件は互換だがdefault extent外。consumer stop
  context 29件はすべてreservation非互換。`default_context_unfinished` / `capture_or_ordering_unresolved` /
  `eligible_but_not_observed` は **0件**。
- default extent内かつreservation互換のcontextを持つuncovered Routeは **0件**。
- extent不足（23件: Skill 23 / Normal 6、Gogmaは0）は、1件（02876df4）を除き、すべてreservation非互換contextとの **重複** である。
  extent probeだけで既知Routeとして回収できる見込みがあるのは最大1件。
- non-participant 9件は「alternative無し」でも「extent不足」でもなく、current Conflict-orientation portfolio生成が
  そのTargetにSearch contextを **作っていない** gapである（うち5件はdefault extent内のRoute）。
- uncovered 41件すべてで、oracle Plan上の前方position（Routeが自分で操作しないposition）を2つ以上の他Targetが担当している
  （support provider 2+ が41 / 41）。

**まだ言えないこと**: oracle Routeと **同じ最終武器を別position / 別Routeで作るalternative** の有無（B2-Aはoracle Routeそのものの
到達可能性だけを判定する）。multi-route reservationやnon-conflict contextでSearchが実際に何を返すか。extentを広げたときの
runtime。portfolioからの全Target同時成立。

**次Phase（B2-B）**: 本Phaseの実測分類から、B2-Bは「context生成側」を主、「Search / extent側」を従として分ける（§11）。

## 2. 方針: Searchを実行せず、既知の成立Routeがどこで失われるかを調べる

```text
[formal calculation]  Export → Production Planner baseline → 54 orientation → 146 pre-Search context（B1と同じ経路）
                      → 各contextのCounter origin / normalized reservation / extent / fixed Route / digestをsnapshot
                      （oracle・manifest・B1 RESULTを読まない）
[post-hoc analyzer]   snapshot ↔ B1 RESULT（parity・B1 Search結果）
                      oracle RESULT ↔ manifest（exact operation segment）
                      oracle Route × 同Targetの各context → Production primitiveで到達判定 → 分類
```

oracleはIssue #154の既知minimumに対する **post-hoc diagnostic fixture** であり、Production heuristic、Search入力、ゲーム仕様ではない。
計算module（`plannerGlobalPhase2C26B2A.ts`）とrunnerはoracle RESULT・manifest・oracle Target ID・oracle Counter positionを
参照しない（testでsource検査）。

## 3. authority

| authority | 内容 | 検証 |
| --- | --- | --- |
| B1 RESULT | `docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json`、SHA-256 `292471e89eabda45710a5ac82b5770f7a43072501aea8b393ca779c57959f77e`、measured HEAD `cef40343` | `parsePhase2C26B2AB1Authority()`: `formal = true`、`calculationCodeChangedSinceMeasuredHead = []`、`decision.case = B1_M_measurement_complete`、participant 34 / 34 explored、Stage 1 136 run / 116 completed / 20 timeout / OOM 0 / process failure 0、fallback 3 / 3 completed、oracle coverage exact 2 / uncovered 41 / 43、54 orientation、146 context、run行139件、capture bound 8 |
| oracle RESULT | `docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json`、SHA-256 `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1` | `verdict = proven_minimum`、Target 43、physical operations 1657、Conflict 0、43 / 43 completed、Trace Replay valid。B1が記録した `oracleSha256` と一致 |
| oracle manifest | `src/benchmarks/plannerGlobalOracle1657Manifest.ts`、file SHA-256 `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、Routes SHA-256 `ffb6db5a…6e0e73cc` | Routes SHA-256がoracle RESULT `hashes.manifestSha256` と一致。analyzerだけが読む |
| Export | `gogma-artian-planner-backup_20260927015837.json`、SHA-256 `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（commitしない） | snapshot・B1・oracleの3者で一致 |

benchmark code SHA-256（measured HEADのsrc / scripts / config）: `eff8d92570760567d32637a3aac9d4c7b0b55f10a530a7d277120ee6f133e0fe`。

## 4. parity（snapshot ↔ B1、すべて一致）

- Export SHA、baseline（planning Target / completed / termination / Plan steps / Conflict / kind別 / selected Target / Conflict signature）、
  CalculationContext、Research maxPlanSteps。
- orientation 54件の順序とkind。
- context 146件（Target 34）を順序どおりに、Target、status、`contextDigest`、`searchInputDigest`、fixed Route Entry ID、
  normalized reservation（B1のrange形式）、excluded Route key SHA-256、extent（= Production default `{ 4, 235, 4 }`）。
- B1 task ID ⇔ `searchInputDigest` が全単射（136 task）。
- 全contextのPlanner-start originが同一（Skill 341、Gogma 55、Normal: charge blade 0 / dual blades 349 / sword and shield 7 / switch axe 0 ほか）。
  oracle summaryの各stream開始位置とも一致。

snapshotの計算は1 process、約102秒（baseline + 54 orientationのcontext導出）。

## 5. oracle / manifest consistency（すべて一致）

manifestのexact operation segmentを `expandOracleOperations()` で展開し、Routeごと・streamごとに以下をoracle RESULTと照合した。

- source（owned / new Normal、OwnedWeapon ID）、Normal production target、conversion position、first / last / operation数。
- required position: manifestの `required` と、oracle RESULTのPlanner側 `plannerRequired`（oracle runが `createPlannerRouteUnitPlans()` から取得）および
  streamごとの `required`。
- Route kind・materialization method・`estimated`。
- `gogmaUsage` 295件（position・Target・type・required）、`requiredSkillUsage` 25件、`requiredNormalUsage` 8件。
- streamごとの被覆が `[start, end)` を隙間なく覆い、advance合計が1,657。

推測で「first〜lastの全positionがown operation」とは扱わず、segmentを展開した実positionだけをown operationとした。

## 6. 判定方法（Production primitiveの再利用）

oracle Routeごとに、同Targetの各B1 contextのreservation下で判定した。独自の近似ruleは作っていない。

| 判定 | authority |
| --- | --- |
| Skill / Gogma laneの5.6.8 coverage | `createCounterReservation()` + `nextOperationPositions()`: originから、直前のown operationの次positionから歩き、各own operationがwindow内（間のpositionはすべてheld、own positionはblockedでない）か |
| conversion | Skill laneの先頭として同じ歩行（originからheldをまたいでconversion位置へ） |
| 新規Normal | `heldPrefixNormalCreation(reservation, origin, production target)` のcanonical creationがoracleのcreate segmentと一致し、production targetがblockedでないか |
| exclusive OwnedWeapon | oracle Routeのsource OwnedWeaponが `reservation.exclusiveOwnedWeaponIds` に含まれないか |
| default extent | reach = 最後のown position − origin + 1（oracle RESULTの `estimated` と独立再計算で一致）。Gogma ≤ maxGogmaAdvance、既存Gogmaのreset skills ≤ maxSkillAdvance、conversion Routeは ≤ maxSkillAdvance + 1、Normal offset < maxNormalAdvance。互換contextでは同じ歩行をProduction limitで打ち切った判定とも一致することを確認 |

primitiveの判定と、その分解（missing held / blocked / held-prefix overlap）が食い違えばaudit inconsistency（formal runで0件）。

contextの分類:

| class | 条件 |
| --- | --- |
| `observed` | 互換・extent内・B1でoracle Candidateをdeliver |
| `default_context_unfinished` | 互換・extent内・B1で正常終了runが無い（timeoutをCandidate 0として扱わない） |
| `capture_or_ordering_unresolved` | 互換・extent内・consumer stop（8件到達）でoracle未deliver（「oracle Candidate無し」としない） |
| `eligible_but_not_observed` | 互換・extent内・extent stop / exhaustedでoracle未deliver（即Search bugとはしない） |
| `extent_insufficient` | 互換だがoracle reachがdefault extent外 |
| `reservation_incompatible` | exclusive / blocked / held coverage / Normal held-prefixのいずれかが不成立（複数同時可） |

## 7. oracle coverage audit

### 7.1 全体

| 項目 | 全体 | participant | non-participant |
| --- | ---: | ---: | ---: |
| oracle Route | 43 | 34 | 9 |
| covered（B1 exact） | 2 | 2 | 0 |
| uncovered | **41** | **32** | **9** |

covered 2件（57126a5e、820831d0）は、監査上もreservation互換・extent内でB1がdeliverしたcontext（どちらもc13-p1）で `observed`
と判定され、B1 coverageと矛盾しない。

### 7.2 uncovered 41件の内訳（原因フラグは重複あり）

| 項目 | uncovered | participant | non-participant |
| --- | ---: | ---: | ---: |
| Search context無し | 9 | 0 | 9 |
| Search contextあり | 32 | 32 | 0 |
| reservation互換contextあり | 1 | 1 | 0 |
| reservation互換contextなし（contextあり） | 31 | 31 | 0 |
| default extent内かつ互換contextあり | **0** | 0 | 0 |
| larger extentが必要 | 23 | 19 | 4 |
| └ Skill / Normal / Gogma | 23 / 6 / 0 | 19 / 5 / 0 | 4 / 1 / 0 |
| 互換だがextent不足 | 1 | 1 | 0 |
| 互換contextがtimeout（未完走） | **0** | 0 | 0 |
| 互換contextがconsumer stop（capture未解決） | **0** | 0 | 0 |
| completed + extent内 + 互換なのに未観測 | **0** | 0 | 0 |
| held coverage gapあり | 28 | 28 | 0 |
| blocked position conflictあり | 16 | 16 | 0 |
| exclusive OwnedWeapon conflictあり | 2 | 2 | 0 |
| Normal held-prefix不一致あり | 2 | 2 | 0 |
| probe可能gap | 1 | 1 | 0 |
| context gap | 40 | 31 | 9 |

uncovered Routeの全context 124件の分類: `reservation_incompatible` 123、`extent_insufficient` 1。
B1状態との交差: 非互換 × consumer stop 29、非互換 × extent stop 78、非互換 × timeout 16、extent不足 × timeout 1。
非互換理由の延べ件数: held coverage gap 111、blocked position 42、Normal held-prefix 4、exclusive weapon 2。

### 7.3 oracle held Route 18件

| 項目 | 18件 | うちuncovered 17件 |
| --- | ---: | ---: |
| Search context無し | 2 | 2 |
| 互換contextあり | 1（covered 820831d0） | 0 |
| larger extent（Skill） | 7 | 7 |
| held coverage gap | 14 | 13 |
| blocked position conflict | 6 | 6 |
| exclusive weapon conflict | 1 | 1 |
| context gap | 17 | 17 |
| probe可能gap | 0 | 0 |

uncovered held Route 17件は **すべてcontext gap**。held Routeを作るのに必要な前方heldを、single fixed winnerのreservationが
供給できていない。

### 7.4 唯一のprobe可能gap

02876df4（new Normal、sword and shield）: c13-p1（fixed winner 6c65c924）のreservationで全laneが互換（missing held 0、blocked 0）。
ただしNormal reach 5 > 4、Skill（conversion）reach 22 > 4でdefault extent外。このcontextはB1でtimeoutしている。

## 8. support analysis（oracle Planで前方positionを担当するTarget）

oracle Routeが自分で操作しないpositionのうち、originから最後のown operationまで（Normalはcreate segmentより前）を「必要前方position」とし、
各positionの担当Targetを「そのpositionにrequired unitを持つ他Target、無ければ唯一そこを操作する他Target」としてmanifestから導出した
（担当者を決められない曖昧positionは0件）。これは既知minimumで実際に成立している支援例であり、唯一の解法を意味しない。

| support provider数 | uncovered | participant | non-participant | uncovered held Route |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 0 | 0 | 0 |
| 2+ | **41** | 32 | 9 | 17 |

provider数は8〜42（median 33）。必要前方positionを単独の他oracle Routeがすべて操作しているcarrierは20件にあり、19件が
Gogma全域をReset連鎖で進める711f7d15、1件がSkill全域をReset Skills連鎖で進めるa367c177だった。Skillとgogmaの両方に前方heldが
必要なRouteには単独carrierが無い。

uncovered Routeのcontext 124件中88件では、そのorientationのfixed winnerがoracle上のsupport Targetの1つだが、single fixed winnerの
reservationはそのwinnerの **current baseline Route** のunit positionだけをheldにするため、必要前方positionを覆えていない。

## 9. single fixed winner contextで不足する代表パターン

各uncovered Routeの「最も近いcontext」（missing held + overlapが最小）で何が足りないかの集計:

| パターン | 件数 | 内容 |
| --- | ---: | --- |
| context無し・Gogma前方heldが必要 | 5 | non-participant。Route自体はdefault extent内（Gogma-only） |
| context無し・Skill + Gogma前方heldが必要 | 4 | non-participant。うち4件がSkill extent外（1件はNormalも） |
| held coverageは足りるがown positionがblocked（1 position） | 8 | Gogma 5 / Skill 2 / exclusive weapon併発1。fixed winnerのbaseline Routeのrequired unitが、oracleではこのTargetに割り当てられたpositionを占有している |
| held coverage gapのみ | 18 | Gogma 7 / Skill 3 / Skill + Gogma 6 / Normal + Gogma 1 / Normal + Skill 1 |
| blocked + held gap | 5 | |
| 互換・extent不足 | 1 | §7.4 |

- **blocked 1 positionのみ（8件）**: single fixed winnerが自分の **baseline Route** を保ったまま固定されるため、oracleでfixed winner側が
  別Routeへ移ることで空くpositionを、検索側Targetが使えない。fixed winner自身のalternativeも同時に許すcontextが必要。
- **held gap（23件）**: Routeの前方（Gogma 55〜、Skill 341〜）を、oracleでは複数Targetのoperationが連続被覆しているが、
  single fixed winnerのheldはそのwinner 1 Routeの範囲しか覆わない。
- **non-participant（9件）**: Conflictに参加していないためorientation由来のSearch contextが存在しない。

## 10. 結論の整理（要因A〜Eとの対応）

| 要因 | 本Phaseの実測 |
| --- | --- |
| A. default-extent contextが10分budget内に未完走 | uncovered Routeを隠しているものは **0件**（timeout context 17件は非互換16 / extent外1） |
| B. capture bound 8より後ろにoracle Route | **0件**（consumer stop context 29件はすべて非互換） |
| C. Production default extent不足 | 23件で必要（Skill 23 / Normal 6）。ただしextentだけで回収可能性があるのは1件、22件はreservation非互換またはcontext無しと重複 |
| D. single fixed winner reservationでheld coverageを作れない | **31件**（held gap 28 / blocked 16 / exclusive 2 / Normal held-prefix 2、重複あり）。support providerは全件2+ |
| E. oracle TargetにConflict orientation由来Search contextが無い | **9件**（non-participant全件） |

## 11. 次Phase B2-Bへの推奨（本Phaseの分類のみから）

1. **context生成側（主）**: 40 / 41件がここに属する。
   - non-participant 9件: Conflict participant以外のTargetにもSearch contextを作る生成規則（non-conflict context）が必要。
     うち5件はGogma前方heldのみでdefault extent内。
   - blocked 1 positionのみの8件: fixed winner自身のRouteも置き換え可能なcontext（winnerのbaseline Routeを固定しない、
     もしくは複数decisionの同時reservation）。
   - held gap 23件: 複数のfixed Routeのheldを合わせたmulti-route reservation。oracleでは前方positionを2つ以上のTargetが担当している。
   B2-Bでは、まずSearchを回さずに **Productionから導出可能な候補context生成規則**（oracleを入力にしない）ごとにB2-Aと同じ
   post-hoc到達判定を行い、どの生成規則がoracle Routeを何件reservation互換にするかを測ってからSearchへ進むのが安価。
2. **Search / extent側（従）**: extent不足23件（Skill 23 / Normal 6）はcontext gap解消後に効いてくる。単独で回収候補になるのは
   02876df4（c13-p1、Normal 5・Skill 22が必要、B1でtimeout済み）のみで、extent拡張とcontext完走の両方が要る。
   default-extent contextの完走（timeout 20 task）やcapture bound拡大は、current single-winner contextのままでは既知oracle Route（exact）の回収に
   寄与しないことが本Phaseで分かった（alternative diversity全般への効果は別問題）。

## 12. limitations

- 判定対象はoracle Routeそのもの（exact operation列）。同じ最終武器を別positionで作るRoute、oracleとは異なる成立Routeは評価していない。
  例: Reset連鎖Route（711f7d15）はblocked positionを避けた等価Routeが存在し得る。
- support Targetは既知minimumで実際に担当しているTargetであり、唯一の解法でも必要条件でもない。
- B1のcontext状態はB1の10分budget・capture bound 8での結果をそのまま使った（再Searchしていない）。
- origin・reservationはcurrent baselineのものであり、oracle Plan上のTarget順・時間順は判定しない（Search自身も判定しない）。
- context gapの解消方法（どの生成規則が妥当か）はB2-Aでは決めていない。

## 13. 事前登録したdecision rule（formal snapshot前にcommit）

`PHASE2C26B2A_DECISION_RULE`（`src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts`）:

1. **B2A-INVALID**: B1 authority不一致、baseline / context parity失敗、oracle / manifest不一致、origin / estimated reach不一致、
   Production primitive判定とその分解の不一致、監査上到達不能なcontextがoracle Candidateをdeliverしていた、coveredなのに
   どのcontextでも観測されない、またはprobe可能gapでもcontext gapでも説明できないuncovered Routeがある。
2. **B2A-COVERED**: uncovered 0。
3. **B2A-BOTH**: uncoveredにprobe可能gapとcontext gapの両方。
4. **B2A-PROBE**: probe可能gapのみ。
5. **B2A-CONTEXT**: context gapのみ。

1 Routeについて2種のgapは構成上排他（reservation互換contextを持つか否か）で、caseはuncovered集合についての判定。原因フラグは排他にしない。

## 14. 変更ファイル

| file | 内容 |
| --- | --- |
| `src/benchmarks/plannerGlobalPhase2C26B2A.ts` | context snapshot（B1と同じ経路の再導出 + prepared originのCounter origin）。oracle / B1 RESULTを読まない |
| `src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts` | B1 authority parser、snapshot parity、oracle parser・manifest整合、Route lane展開、Production primitiveによる到達判定、extent判定、support導出、B1 context状態、分類・フラグ・集計・パターン、decision |
| `src/benchmarks/plannerGlobalPhase2C26B2A.test.ts` | 19 tests |
| `scripts/run-planner-global-phase2c26b2a.mjs` | snapshot runner（Exportのみ読む） |
| `scripts/analyze-planner-global-phase2c26b2a.mjs` | post-hoc analyzer（B1 RESULT・oracle RESULT・manifestを読む） |
| `docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json` | formal RESULT |
| `docs/PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE2C26B2A.md` | 本文書 |

Production source（`src/domain` / `src/services` / `src/workers` / UI / db）の変更なし。ProductionからB2-A moduleをimportしない（testで確認）。

## 15. 検証

- focused: `npx vitest run src/benchmarks/plannerGlobalPhase2C26B2A.test.ts`（19 pass）、および既存のoracle隔離test
  `plannerGlobalOracle1657.test.ts` / `plannerGlobalLowerBound.test.ts`
- `npm run lint`、`npx tsc -b --force`、`npm test`、`npm run build`、`git diff --check`

## 16. 再現

```bash
node --max-old-space-size=8192 scripts/run-planner-global-phase2c26b2a.mjs --export <gogma-artian-planner-backup_20260927015837.json> --output .local/PLANNER_GLOBAL_PHASE2C26B2A_RAW.json.local
```

```bash
node scripts/analyze-planner-global-phase2c26b2a.mjs --snapshot .local/PLANNER_GLOBAL_PHASE2C26B2A_RAW.json.local --b1-result docs/PLANNER_GLOBAL_PHASE2C26B1_RESULT.json --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --output docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json
```

raw snapshot（`.local/`、Git管理外）: 約102秒。

## 17. measured HEAD以降の解析側変更

formal snapshot（measured HEAD `ae2083f`）の後、full testで既存のPhase 2-A.5 oracle隔離test（oracle verifier / manifestを他のResearch moduleが
読まないこと）に抵触していたため、既存guardは変更せず、解析module・testからoracle moduleへのimportを除いた（`0da244d`）。
manifestはanalyzerが `--manifest` 引数から読み込み、解析moduleは構造型（`Phase2C26B2AOracleRouteSpec`）で受け取り、segment展開も
解析module内で行う。これに伴いrequired positionの照合から `deriveOracleRequiredPositions()` による独立導出を外し、manifestと
oracle RESULTのPlanner側 `plannerRequired` / streamごとの `required` / usageとの照合に限った。計算module・runnerは無変更で、
再生成したRESULTは `analyzedAt`・analysis HEAD・`codeChangedSinceMeasuredHead` を除き初回解析と全field一致した。
