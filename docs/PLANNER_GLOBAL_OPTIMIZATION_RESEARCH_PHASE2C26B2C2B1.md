# Global Planner Research Phase 2-C2.6-B2-C2B1（extent不足20 Targetのrequired extent characterization）

Refs #154。Research only。Production source、Production default extent、Search / Planner semantics、Search ordering /
comparator、P1、Candidate capture policy、trial / rerun bound、RNG、schema / version、Persistence、UIは変更していない。
Candidate Search、Planner Alternative Search、actual Search probe、Candidate capture比較、trial、kernel、full Planner rerun、
global assignment、K2 feature / grouping、residual unreached 3件への対応は行っていない。

- measured HEAD: `2ce4d3c70426ffaa462ae12c3a4cfd99d51ac0af`（calculation・post-hoc analyzer・ladder rule・decision rule・
  runner / analyzer・testsを含むclean HEAD）
- analysis HEAD: `2ce4d3c70426ffaa462ae12c3a4cfd99d51ac0af`（`codeChangedSinceMeasuredHead = []`、
  `calculationCodeChangedSinceMeasuredHead = []`）
- RESULT: [`docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json`](PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json)
  （`provenance.formal = true`、`oracleReadByCalculation = false`、`oracleInformedLadder = true`、
  `targetIndividualOracleExtentAsSearchInput = false`、`searchRun = false`）
- formal raw（commitしない）: `.local/PLANNER_GLOBAL_PHASE2C26B2C2B1_RAW.json.local`
  SHA-256 `47b8ffc88cd52f34ba6a1459583ea0c6e83cab0ab0f99fe0b43878674cec3555`（37,158,562 bytes、36,084 context行）

## 1. 結論（`B2C2B1_CHARACTERIZED`）

B2-C1でextent不足とされた20 Targetについて、oracle Routeが実際にSearch可能になるために各streamで必要なProduction extentを、
B2-A / B2-B1と同じextent意味でformalにcharacterizeした。20 / 20がfinite・readableで、B2-A / B2-B1記録値と全件一致し、
B2-C1 windowとProduction limit walkの両方で「required値ちょうどで受理、1つ下で拒否」を全stream確認した。

| cohort | 件数 | 不足stream | Skill required（median / max） | Normal required（不足Targetのみ） | Gogma required max | P1 first compatible rank |
| --- | ---: | --- | --- | --- | ---: | --- |
| **E1 K1-minimal extent不足** | **11** | Skill 11 / Normal 2 / Gogma 0 | 226 / 1,083 | 5, 126 | 125 | 2〜32（median 17） |
| E2 K2-minimal extent不足 | 9 | Skill 9 / Normal 2 / Gogma 0 | 368 / 552 | 19, 207 | 233 | 50〜306（median 78） |
| 全20 | 20 | Skill 20 / Normal 4 / Gogma 0 | 248 / 1,083 | 5, 19, 126, 207 | 233 | 2〜306 |

- **不足はほぼSkill streamだけ**（20 / 20がSkill不足、Normal不足4件はすべてSkillとの複合、Gogmaは0件）。
  Gogmaは全20件がProduction default 235以内（max 233）。B2-B1登録aggregate（Skill 20・Normal 4・Gogma 0）と一致。
- Skill不足量は大きい: E1でdefault 4に対して +4〜+1,079（median +222）。
- 次Phase（E1 actual Search）用に、事前登録ruleから共通extent ladderを導出した（§7）。

| rung | Normal | Gogma | Skill | E1 covered（累積） | E2（diagnostic） |
| --- | ---: | ---: | ---: | ---: | ---: |
| L0 default | 4 | 235 | 4 | 0 / 11 | 0 / 9 |
| L1 intermediate | 8 | 235 | 256 | 7 / 11 | 1 / 9 |
| **L2 larger** | **128** | **235** | **1,500** | **11 / 11** | 8 / 9 |

**このladderはE1 cohortのrequired extent（post-hoc oracle値）のpercentileから導いたResearch条件であり、Production defaultではない。
Targetごとのoracle値をSearch入力として渡す方式ではなく、全E1 Targetを同じrungで順に試す共通ladderである。**

## 2. 方針

```text
Export
  -> derivePhase2C26B2C2B1Calculation()（oracle非依存）
       derivePhase2C26B2C1Schedule()（B2-C1そのまま: B2-B1 snapshot = Planner-start origin・43 Target・K0 / K1 / K2・
         Production reservation・semantic context、Target別eligible minimum cardinality、geometry、P0〜P3 rank）
       + P1 ordering projection（Targetごとのcontext数 / eligible minimum別件数 / K1・K2のP1 rank範囲）
  -> post-hoc analyzer（calculation終了後にRESULT群・oracle・manifestを読む）
       runPhase2C26B2C1Audit()（B2-C1 audit再実行: schedule consistency、B2-B1 universe parity、reach、subgroup、P1 first compatible）
       + extentInsufficient 20 → E1 / E2、required extent（phase2c26b2aRouteExtent()）、shortage、
         B2-A / B2-B1 / B2-C1 parity、window / Production walk境界、cohort aggregate、ladder、decision
```

calculation（`plannerGlobalPhase2C26B2C2B1.ts` + runner）はExport・current Production code・formal specだけを読み、
oracle RESULT・manifest・oracle Target ID・Route・Counter位置・earlier RESULTを一切知らない（testで確認: source内の数値literalは
heap size 8192のみ、UUID / Entry ID / `--oracle` 等なし）。B2-C1 RESULTのTarget IDをhard-codeしてpopulationを作っていない。
population・cohort・required extentはすべてanalyzerがpost-hocに導出した。

## 3. authority / provenance

| authority | 値 |
| --- | --- |
| Export | `cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（calculation = B2-B1 = B2-C1 = B2-A = R2 = oracle RESULT） |
| B2-C1 RESULT | SHA-256 `04904fafb93664ecfed5f3bd654b29d9c39029dde34aa88a59d1d11de8fc2bac`（B2-C2Aの登録parserで検証: formal、`B2C1_WIDE`、P1 selected、subgroup 40 / 20 / 20 / 31 / 9 / 3） |
| B2-B1 RESULT | SHA-256 `5a56ab010828519df00e7084c8b9cf6bd9276ad7425f609d520ba1392071309d`（B2-C1登録parserで検証） |
| B2-A RESULT | SHA-256 `7f425ca46d7908280793440570d8af6e85fe589ec8772160021f15f2e814b883`（formal、`B2A_BOTH`、needsLargerExtent 23 = Normal 6 / Skill 23 / Gogma 0） |
| R2 RESULT | SHA-256 `5014571404310d287eaa03391d7f31c3d64621c6f68ee740e82fad8690ba6402`（formal、`B2C2AR2_ALL_C4C`、combined 20 Target fully measured、C4C exact 20） |
| oracle RESULT | SHA-256 `be51e7cdb69bec75e2b6640d6c28c774f4fa712643dfbc2f1d1e420f16b584a1` |
| oracle manifest | file SHA-256 `c8b240f6d79cbad192882c2ec9654f8649ec79383df6e1abc029d58c3c9d81af`、routes SHA-256 `ffb6db5a39e248b950a75f9094ae641a4a35f256a035e37564227bdc6e0e73cc`、manifest ↔ RESULT整合を再検査して一致 |
| benchmark code | SHA-256 `85b9caaa04711fab3431c7ed2c42fe0185eda1821e4c0ccd7dffc02510917f94`（`uncommittedBenchmarkCode = false`） |
| calculation run | Node（Vite SSR loader、1 process）、wall 4.2 s |

**hash chain**（`hashChainIssues = []`）: Export SHA（6 recorder）、oracle RESULT SHA（file / B2-B1 / B2-C1 / B2-A / R2）、
manifest file SHA（同5）、manifest routes SHA（file / oracle / B2-B1 / B2-C1 / B2-A / R2）、B2-C1 RESULT SHA（file / R2）、
B2-B1 RESULT SHA（file / B2-C1 / R2）がすべて一致。

R2 RESULTは「default extent側のSearch validationが完了済み」というauthorityとしてのみ使い、そのcombined 20 TargetがB2-C1の
`defaultExtent` subgroupと完全一致し、extent不足20と重ならないことだけを確認した。extent requirementをR2から導いていない。

## 4. population

| 項目 | 値 |
| --- | --- |
| planning Targets / context | 43 / 36,084（B2-C1と同じ。B2-C1 audit再実行のinvalid reason 0） |
| P1 ordering projection | 43 / 43 cardinality-first（K0 rank 1、K1 rank 2..43、K2 rank 44..） |
| subgroup（B2-B1 authority、B2-C1 RESULTと全43件一致） | recovered 40、defaultExtent 20、**extentInsufficient 20**、K1-minimal 31、K2-minimal 9、unreached 3 |
| **E1 = extentInsufficient ∩ K1-minimal** | **11** |
| **E2 = extentInsufficient ∩ K2-minimal** | **9** |
| 重複 | E1 / E2は排他、defaultExtent・unreachedとの重複0、R2の20 Target = defaultExtent |
| P1 first compatible rank（B2-C1 RESULTとreservation digestまで全43件一致） | E1 2〜32、E2 50〜306 |

## 5. extent semantics

required extentは独自ruleを作らず、B2-Aの `phase2c26b2aRouteExtent()` をそのまま使った（Production `PlannerAlternativeSearchExtent`
の意味）。

| stream | required | defaultでのwindow |
| --- | --- | --- |
| Normal（new Normal Routeのみ） | production target − origin + 1 | `origin .. origin + 3` |
| Gogma | 最後のGogma操作 − origin + 1 | `origin .. origin + 234` |
| Skill（既存Gogma Reset Skills） | 最後のSkill操作 − origin + 1 | `origin .. origin + 3` |
| Skill（conversion Route） | 最後のSkill操作 − origin（1つ広い窓） | `origin .. origin + 4` |

「Routeがextent内」⇔ 全streamで `required ≤ extent値`。各Targetについて2通りの独立した確認を行い、20 / 20で成立した。

- **B2-C1 window境界**: `phase2c26b2c1DefaultWindows(required extent)` でRouteが窓内、どれか1 streamを1つ下げると窓外
  （required ≥ 2のstream全部）。conversion RouteのSkill off-by-oneもここで固定（testでも境界ごとに検証）。
- **Production walk境界**: P1 first compatible context（Routeがreservation-compatibleなcontext）の下で、unchangedの
  `phase2c26b2aReachability()`（Production `nextOperationPositions()` / `heldPrefixNormalCreation()` をextent上限で切ったwalk）が
  required値では全laneを受理し、1つ下げたlaneを拒否。
- B2-B1記録extent（reach / required / verdict / withinDefaultExtent）、B2-A記録extent（+ estimatedMatches）と全43件一致。

## 6. Target別required extent

Production default extent: Normal 4 / Gogma 235 / Skill 4。ID prefixのみ表示（全IDはRESULT）。

| cohort | Target | P1 rank | source | Normal req | Gogma req | Skill req | Normal不足 | Skill不足 | 不足stream | 最初のrung |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| E1 | `e523209e…` | 2 | owned | — | 42 | 8 | — | 4 | skill | L1 |
| E1 | `05e6b206…` | 3 | owned | — | 46 | 46 | — | 42 | skill | L1 |
| E1 | `02876df4…` | 8 | new_normal (conversion) | 5 | 119 | 22 | 1 | 18 | normal+skill | L1 |
| E1 | `a367c177…` | 11 | owned | — | 59 | 1083 | — | 1079 | skill | L2 |
| E1 | `b6780f04…` | 14 | owned | — | 110 | 145 | — | 141 | skill | L1 |
| E1 | `070a1222…` | 17 | new_normal (conversion) | 126 | 23 | 450 | 122 | 446 | normal+skill | L2 |
| E1 | `188571a7…` | 18 | owned | — | 17 | 446 | — | 442 | skill | L2 |
| E1 | `d453ca34…` | 18 | owned | — | 22 | 547 | — | 543 | skill | L2 |
| E1 | `b27e57a7…` | 31 | owned | — | 99 | 226 | — | 222 | skill | L1 |
| E1 | `e4147de7…` | 31 | owned | — | 125 | 168 | — | 164 | skill | L1 |
| E1 | `a6c17e25…` | 32 | owned | — | 107 | 248 | — | 244 | skill | L1 |
| E2 | `6c65c924…` | 50 | new_normal (conversion) | 1 | 213 | 69 | — | 65 | skill | L1 |
| E2 | `a830a376…` | 64 | new_normal (conversion) | 19 | 76 | 55 | 15 | 51 | normal+skill | L2 |
| E2 | `9d817a9b…` | 75 | owned | — | 71 | 308 | — | 304 | skill | L2 |
| E2 | `1f121742…` | 76 | owned | — | 90 | 514 | — | 510 | skill | L2 |
| E2 | `1efa01c6…` | 78 | owned | — | 83 | 417 | — | 413 | skill | L2 |
| E2 | `813fb479…` | 136 | new_normal (conversion) | 207 | 176 | 137 | 203 | 133 | normal+skill | none |
| E2 | `86439c85…` | 143 | owned | — | 139 | 400 | — | 396 | skill | L2 |
| E2 | `45b13c06…` | 305 | owned | — | 223 | 368 | — | 364 | skill | L2 |
| E2 | `2378d3e0…` | 306 | owned | — | 233 | 552 | — | 548 | skill | L2 |

post-hoc diagnostic: owned 15件はすべて `existing_gogma_mixed`、new_normal 5件はすべて `normal_artian_to_gogma`（conversion）。
E2の最初のrung列は参考値（E2はladderの対象外）。

## 7. aggregate（nearest rank: `sorted[ceil(p/100 × n) − 1]`）

### 7.1 required extent（そのstreamを操作するTargetのみ）

| cohort | stream | n | min | median | p75 | p90 | max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| E1 | Normal | 2 | 5 | 5 | 126 | 126 | 126 |
| E1 | Gogma | 11 | 17 | 59 | 110 | 119 | 125 |
| E1 | Skill | 11 | 8 | 226 | 450 | 547 | 1,083 |
| E2 | Normal | 3 | 1 | 19 | 207 | 207 | 207 |
| E2 | Gogma | 9 | 71 | 139 | 213 | 233 | 233 |
| E2 | Skill | 9 | 55 | 368 | 417 | 552 | 552 |
| 全20 | Normal | 5 | 1 | 19 | 126 | 207 | 207 |
| 全20 | Gogma | 20 | 17 | 90 | 125 | 213 | 233 |
| 全20 | Skill | 20 | 8 | 248 | 446 | 547 | 1,083 |

### 7.2 shortage（defaultからの不足量、そのstreamで不足するTargetのみ）

| cohort | stream | 不足Target | min | median | p75 | p90 | max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| E1 | Normal | 2 | 1 | 1 | 122 | 122 | 122 |
| E1 | Gogma | 0 | — | — | — | — | — |
| E1 | Skill | 11 | 4 | 222 | 446 | 543 | 1,079 |
| E2 | Normal | 2 | 15 | 15 | 203 | 203 | 203 |
| E2 | Gogma | 0 | — | — | — | — | — |
| E2 | Skill | 9 | 51 | 364 | 413 | 548 | 548 |
| 全20 | Normal | 4 | 1 | 15 | 122 | 203 | 203 |
| 全20 | Gogma | 0 | — | — | — | — | — |
| 全20 | Skill | 20 | 4 | 244 | 442 | 543 | 1,079 |

複数stream不足: E1 2件・E2 2件（いずれもNormal + Skill）。単独Skill不足: E1 9件・E2 7件。

## 8. extent ladder（formal run前に登録したrule）

- 対象: E1のみ。
- L0 default = `defaultPlannerAlternativeSearchExtent`。
- L1 intermediate = stream別に、そのstreamで不足するE1 Targetのrequired値のnearest-rank median をgridへ。
- L2 larger = 同じく最大値をgridへ。
- grid: どのE1 Targetも不足しないstreamはdefaultのまま。それ以外は `max(default, 2の冪 ≥ 値)`、その冪がceilingを超えたら
  ceilingへ下げる。値自体がceilingを超えたらunbounded。
- ceiling = `recommendedCandidateSearchDefaults`（Normal 350 / Gogma 500 / Skill 1,500）。同じ `max*Advance` 意味を持つ
  Candidate Search初期探索範囲で、Issue #104 / #125でBrowser計測済みの既存authority。
- 前rungと同一のrungは削除。

| stream | E1不足値 | median → L1 | max → L2 |
| --- | --- | --- | --- |
| Normal | 5, 126 | 5 → **8** | 126 → **128** |
| Gogma | （なし） | default **235** | default **235** |
| Skill | 8, 22, 46, 145, 168, 226, 248, 446, 450, 547, 1,083 | 226 → **256** | 1,083 → 2,048 > ceiling → **1,500** |

coverage（累積）: L0 0 / 11、L1 7 / 11、L2 11 / 11。最初にcoverするrung: L1 7件・L2 4件（`a367c177…` Skill 1,083、
`070a1222…` Normal 126 / Skill 450、`188571a7…` Skill 446、`d453ca34…` Skill 547）。ladderはmonotone。

E2（diagnostic、ladder対象外）: L1 1 / 9、L2 8 / 9。`813fb479…` はNormal 207 > 128でL2でも入らない。E2はextent拡張では
なくK2 feature / groupingが先なので、ここからE2用ladderは導かない。

## 9. decision（formal run前に固定）

| case | 条件 | 結果 |
| --- | --- | --- |
| B2C2B1_INVALID | authority / hash chain / provenance / population / extent semantics / B2-A・B2-B1 extent parity / B2-C1 subgroup・P1 rank parity / window・walk境界 / oracle isolation / raw-result不整合、不足streamの無いextent不足Target、stream件数がB2-B1登録値と不一致 | 該当なし（`invalidReasons = []`） |
| B2C2B1_UNDETERMINED | 操作するstreamのrequired extentが非finite / 読めないTargetがある | 該当なし（`unreadableTargets = []`） |
| B2C2B1_UNBOUNDED | E1のrequired extentがceilingを超え、bounded ladderが作れない | 該当なし（max: Normal 126 ≤ 350、Skill 1,083 ≤ 1,500） |
| **B2C2B1_CHARACTERIZED** | 20 / 20 characterize（E1 11 / E2 9）、全required extent finite・authority一致、invalid 0、top rungが全E1をcover | **成立** |

## 10. interpretation

- extent不足の正体は、ほぼ **Skill streamを数百〜千position先まで待つRoute** である。E1のowned 9件はすべて
  `existing_gogma_mixed` で、Gogma laneはdefault内に収まる一方、Reset Skillsの最後の位置が origin + 7〜1,082 にある
  （held reservationでSkill streamを他Routeへ譲りながら待つ形）。Production default Skill 4では構造的に届かない。
- Normal不足は4件だけで、すべてconversion RouteがSkill不足と同時に起きている。Gogmaはdefault 235で全件足りる
  （Gogma default 235はIssue #101由来の閾値で、この層でもGogma側の拡張は不要）。
- L1（Skill 256）でE1の7件、L2（Skill 1,500 / Normal 128）で11件全部がextent上は届く。L2のSkill 1,500はCandidate Searchの
  推奨初期範囲と同じ値で、既にBrowserで動かしている範囲を超えない。ただしPlanner Alternative SearchでSkill 1,500 + held
  reservationを走らせたときのruntime / capture挙動は未測定であり、それは次Phaseの計測対象。
- E2のrequired extentもE1と同程度（Skill median 368、max 552）で、extent自体はL2でほぼ届く。E2の問題はextentではなく
  P1 rank 50〜306（K1を全部通過してからK2へ入る構造）であり、B2-C1の結論どおりextent拡張では解決しない。
- このladderはE1 cohortのoracle required値から作ったので `oracleInformedLadder = true`。Production defaultの変更根拠では
  なく、次PhaseのResearch Search条件の事前登録である。

## 11. next recommendation

事前登録ruleの `B2C2B1_CHARACTERIZED` recommendation:

> E1（K1-minimal extent不足）11件を対象に、P1 scheduler ordering + 登録したextent ladder（L0 → L1 → L2）でactual Search
> probeへ。E2（K2-minimal）9件はextent拡張ではなくTarget-relative K2 feature / grouping研究を先に行う。

補足（次Phaseの論点。今回は実施していない）:

1. **E1 actual Search probe**: P1 rank ≤ 32の範囲（K1 context）で、L0 → L1 → L2の順にSearch。L0は全件届かないことが
   今回確定しているので、L1から始めてもよい（L0を含めるかは次Phaseで事前登録する）。Skill 256 / 1,500でのPlanner
   Alternative Search runtime・memory・capture boundが主な計測対象。
2. **E2**: Target-relative K2 feature / grouping研究（extentとは独立）。
3. **residual unreached 3件**: 引き続きalternative-to-alternative support（別系統）。

## 12. validation

- focused: `npx vitest run src/benchmarks/plannerGlobalPhase2C26B2C2B1.test.ts`（23 tests: required extent / shortage /
  unreadable、window境界（Gogma・既存Gogma Reset Skills・conversion Skill off-by-one・production target、required + 1が
  最小値でないこと）、Production walk境界、exact extent、percentile決定性、grid / ladder / dedup / monotone / coverage、
  cohort aggregate、decision 4 case、synthetic worldでのcharacterization（E1 / E2分離、population / subgroup / P1 rank /
  B2-B1・B2-A extent parity / stream件数 / 境界driftのfail closed、UNDETERMINED / UNBOUNDED）、calculation（Planner inputから
  B2-C1 scheduleと一致、P1 cardinality-first、K0重複fail closed）、B2-A / R2 authority parser、committed RESULTのみから
  cohort・stream件数・rank範囲・ladderを再導出、committed RESULTのpin、hash chain、isolation）
- `npm run lint`、`npx tsc -b --force`、`npm test`、`npm run build`、`git diff --check`（結果はPRに記載）

## 13. files

- `src/benchmarks/plannerGlobalPhase2C26B2C2B1.ts`（calculation、oracle非依存）
- `src/benchmarks/plannerGlobalPhase2C26B2C2B1Analysis.ts`（post-hoc analysis）
- `src/benchmarks/plannerGlobalPhase2C26B2C2B1.test.ts`
- `scripts/run-planner-global-phase2c26b2c2b1.mjs`（formal calculation runner）
- `scripts/analyze-planner-global-phase2c26b2c2b1.mjs`（post-hoc analyzer）
- `docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json`

再現:

```text
node --max-old-space-size=8192 scripts/run-planner-global-phase2c26b2c2b1.mjs --export <Export> --output .local/PLANNER_GLOBAL_PHASE2C26B2C2B1_RAW.json.local
node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b1.mjs --calculation .local/PLANNER_GLOBAL_PHASE2C26B2C2B1_RAW.json.local \
  --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json \
  --b2a-result docs/PLANNER_GLOBAL_PHASE2C26B2A_RESULT.json --r2-result docs/PLANNER_GLOBAL_PHASE2C26B2C2AR2_RESULT.json \
  --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest src/benchmarks/plannerGlobalOracle1657Manifest.ts --output docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json
```
