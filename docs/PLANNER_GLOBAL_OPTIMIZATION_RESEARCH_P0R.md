# Global Planner Research P0R：Phase 0未完成Targetの原因調査

Refs #154。開始時のmain / origin/main `c22398a224e97c2bc2d728ad49826bbaf0a84e4a`（PR #235マージ後）、Working Tree clean、
worktree・stashなし、実行中のnode processなし。branch: `research/global-planner-phase0-missing-target`。

D2-C〜D2-Gの局所探索を保留し、Phase 0 Global prototype（42 / 43、Conflict 2、Rejected 1、7,330 steps）を起点に、
残る1 Target `813fb479-accd-454d-8fcd-fed51d4e891d` の未完成原因を調べる。Research専用であり、Production Search / Planner / RNG semantics、
通常Candidate Search extent、Target条件、全versionを変更しない。既存のformal RESULT・Research仕様は書き換えない。

## 実験の事前登録（実行前に記録）

本節は改善実験の実行前に記録した。実験後に条件・成功条件を変更しない。

### 既存記録の確認

過去Researchを確認した結果、**Phase 0の未発見Targetは既にPhase 1-A / 1-D / 1-E / 2-Aで調査されていた**。

- Phase 1-A（[PHASE1](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE1.md)）: 同じ投影snapshotでNormal 700だけにすると発見（896操作、N643 / G1 / S252）。
  Gogma 1000だけ・Skill 3000だけでは未発見。failed-first順では813fb479がbase extentで見つかり、代わりに711f7d15が未発見になった。
- Phase 1-E（[PHASE1E](PLANNER_GLOBAL_OPTIMIZATION_RESEARCH_PHASE1E.md)、PR #164）: original Exportだけから、bounded no-matchかつ
  Normal boundary到達時に同一投影snapshotからNormalだけ2倍で1回再Searchする **generic `normal-2x-fallback`** により
  **43 / 43・Conflict 0・rejected 0・Trace Replay passed・8,534 steps** に到達した（独立再現あり）。
- Phase 2-A（PR #165）: 同じsemanticsが実Browser Workerでも成立。

本PRはこれらを前提に、**現行main（PR #165以降にSearch性能最適化が多数入った）で同じ結論が保たれるか**を確認し、
原因をTarget条件・Counter資源の観点で直接確認する。過去結果JSONやTarget IDを探索入力には使わない。

### Exportから直接確認した事実（実験前）

- 813fb479（チャアク・龍）と711f7d15（チャアク・火）はIdeal Bonus（斬れ味・装填EX、属性EX×2、属性II×2）とIdeal Skill
  （`series_skill.verified_24` + `group_skill.apex`）が完全に同じで、priorityも同じ3。
- チャージアックスの所持OwnedWeaponは0件。Normal Counterはconfirmed 0の1本だけで、Melee Table A（属性あり）の火・龍は
  同じNormal位置から同じ5 slotを引く（RNG_SPEC 6.3.1、Normal seedに属性は入らない）。
- 元Build Listの2 Entryはどちらも `create_normal_artian(count = 207, 0 -> 207)` → conversion → `keep_bonuses` …で、
  **同じNormal位置206をproduction targetとする**。2つのproduction targetが同じNormal位置を要求するため、これは真に排他的な
  `same_normal_counter` 資源競合である（Issue #129でも競合として残る唯一の種類）。

### 仮説H1

Phase 0順では711f7d15がindex 17で先に検索され、Normal位置206を消費する。813fb479はindex 20で投影Normal 207から検索され、
Keep-only経路に必要な「Idealと同じ族構成（斬れ味・装填1 + 属性4）のNormal」が投影Normal窓207〜556に存在しないため、
base extent（N350 / G500 / S1500）内で見つからない。原因は「extent不足（1）」として現れるが、本質は
「同じ族構成Normalを先行generated Routeが消費した（3）」と「探索順（2）」の組合せである。

確認方法（診断、variantではない）: Phase 0 controlの再現runでno-match時のSearch入力を取得し、その投影状態から
Normal 0〜1100、Gogma Reset 0〜投影+1000、Skill 0〜投影+3000について、Target Idealに対する必要条件の位置一覧
（Research専用 `mapGlobalResearchTargetResources()`）を作る。H1が正しければ、族構成一致Normalは窓207〜556に無く、
206と窓外（849付近）にある。

### 改善variant（1件のみ）

| 項目 | 内容 |
| --- | --- |
| variant | **V1: `normal-2x-fallback`**（Phase 1-E規則をそのまま適用） |
| 変更条件 | base Searchが `not_found_within_extent` かつNormal boundary到達のときだけ、同一投影snapshotからN700 / G500 / S1500で1回だけ再Search。fallback budget 180秒、episode上限3。Target IDは見ない |
| 不変 | Phase 0順・retained集合（run自身が導出）、base extent N350 / G500 / S1500、`maxPlanSteps = 20000`（Research）、ProductionRngEngine、Production Search / Planner、43 Target条件 |
| 実行時間上限 | attempt 900秒（`--attempt-budget-ms 900000`）、Node heap 8 GiB |
| 成功条件 | (a) Research最終runで43 / 43・Conflict 0・rejected 0・termination completed・Trace Replay passed、かつ (b) 別Node processで元Exportの全43 Targetに対し、生成Entryを各Targetの元Entryと置換しただけのfresh ordinary Plannerが同じ条件を満たし、Target定義が元Exportと同一 |
| 2件目 | 事前登録しない（V1が失敗しても結果を見て別variantを追加しない） |

K3 L2の再実行、Production semantics変更、Target削除・緩和、oracle由来の誘導は行わない。

## 結果

2026-10-11〜12、Windows x64、Node v24.19.0、Ryzen 7 9700X（16 logical CPU）、物理memory約31.1 GiB。全runは
`--max-old-space-size=8192`（V8 heap limit 8,791,261,184 bytes）、ProductionRngEngine `production-rng:c5-e7`、
Research `maxPlanSteps = 20000`、base extent N350 / G500 / S1500、yieldは `setTimeout(0)`、raw block cacheなし（Phase 0と同じ）。
各runは逐次・単独実行（testやbuildと並行させない）。Export SHA-256は
`cc35fb5bd85acb417b2ce0229cd79441b48c642ac8af70bbc2dfdfc8c89e1e6b`（19,424,064 bytes）で、Phase 0と同一。
Production codeは基準main `c22398a` と同一で、計測時は本PRのResearch file（未commit）を加えた状態である。
数値・ID・資源マップは [P0R_RESULT](PLANNER_GLOBAL_P0R_RESULT.json) に保存した。ExportのSeed・Route本体は含めない。

### 1. Phase 0の再現（成功）

既存runner `scripts/run-planner-global-research.mjs` をPhase 0と同じ引数（+ heap指定とcaptureのみ）で実行し、
本PRの診断runner（同じ `runGlobalPlannerResearch()`、fallbackなし）でももう一度実行した。

| 項目 | Phase 0記録（2026-09-27） | 再現（既存runner） | 再現（診断runner） |
| --- | --- | --- | --- |
| baseline completed / Conflict / rejected / steps | 20 / 21 / 23 / 1,465 | 同一 | 同一 |
| retained | 20、20 / 20・Conflict 0 | 同一（ID集合一致） | 同一 |
| Search 23件のstatus・Route・操作数・advance・generated Entry ID | — | **全23件一致** | **全23件一致** |
| final completed / 全planning Target | 42 / 43 | **42 / 43** | **42 / 43** |
| Conflict（内訳） | 2（Normal 1 / Skill 1） | **2（Normal 1 / Skill 1）** | 同一 |
| rejected / resource_conflict | 1 / 1 | **1 / 1** | 同一 |
| steps / expandedStates | 7,330 / 7,372 | **7,330 / 7,372** | 同一 |
| Trace Replay / termination | passed / exhausted | passed / exhausted | passed / exhausted |
| 未発見Target | 813fb479 | **813fb479** | 813fb479 |
| Search / 全Planner / total秒 | 586.839 / 60.590 / 657.467 | 579.506 / 50.161 / 637.857 | 582.932 / 53.338 / 645.491 |
| full Planner run | 25 | 25 | 25 |
| process maxRSS | 2.404 GiB | 2.408 GiB | 2.511 GiB |

診断runnerのfinal Plan SHA-256 `5db231229d65d8e312b8b6f8dea1cfba8ec99a8a02a9501701bb2f5f77133bf6` は、Phase 1-E control
（PR #164）の記録値と一致した。PR #165以降のSearch性能最適化はこのrunのsemanticsを変えていない。時間は1回測定で分布は未測定。

### 2. 未完成Target 813fb479の原因

#### 2.1 Target条件と投影状態

- 条件: チャージアックス・龍、Ideal Bonus = 斬れ味・装填EX + 属性EX×2 + 属性II×2、Ideal Skill = `verified_24` + `apex`、
  priority 3、compromise条件なし、checkpoint選択なし、preferred weaponなし。Ideal族構成は「斬れ味・装填1 + 属性4」。
- 同条件の711f7d15（チャージアックス・火）が存在する。
- Search開始時（index 20）の投影Counter: チャージアックスNormal **207**、Gogma 3,153、Skill 3,184。
  チャージアックスのOwnedWeaponは0件で、`owned_normal_artian_to_gogma` / `existing_gogma_*` は `no_owned_weapon_available`、
  探索Routeは `normal_artian_to_gogma` だけ。
- 探索到達: 予測reach N350 / G500 / S1501、boundaryはN / G / S-existing / S-conversionすべて到達。Search 37.9秒。
  `not_found_within_extent`（Search例外・materialization失敗・projection失敗ではない）。
- Normal Counterの推移: retained 20 Routeと前段16件の生成RouteはチャージアックスNormalを動かさず（index 0〜17で0）、
  **index 17の711f7d15生成Route（`normal_artian_to_gogma`、Normal advance 207）が0→207に進めた**。

#### 2.2 資源マップ（必要条件）

`mapGlobalResearchTargetResources()` で、no-match時のSearch入力から、ProductionRngEngineの公開prediction APIだけを使って
Target Idealの必要条件を満たす位置を数えた（2.06秒、Candidate Searchではない）。

| stream | 調べた範囲 | 該当位置 |
| --- | --- | --- |
| Normal（族構成がIdealと一致） | 0〜1,100 | **206、849、886 の3箇所のみ** |
| Gogma Reset（族構成がIdealと一致） | 0〜4,153 | **0件** |
| Gogma Reset（そのままIdeal） | 0〜4,153 | 0件 |
| Skill（Ideal Skill） | 0〜6,184 | 18箇所（投影3,184以降の最初は3,435） |

Keepは各slotの族を保ち段位だけを引き直し、Resetは5 slotの族を作り直す（RNG_SPEC 6.1）。したがってIdealに届くRouteの最終族構成は、
最後のResetの結果か、Resetを含まない場合は鍛造Normalの族構成で決まる。調べたGogma窓には族構成の合うResetが1つも無いので、
この窓内でIdealへ届くのは **族構成の合うNormal（206 / 849 / 886）からのKeep-only経路だけ** である。
これは必要条件であり、段位・Skillまで含めた十分条件ではない。

- 位置206は元Build Listで813fb479・711f7d15の **両方** がproduction targetにしていた位置（元Entryはどちらも
  `create_normal_artian(count = 207)`）。火・龍はMelee Table Aで同じ5 slotを引くため、両Targetにとって同じ資源である。
  1つの鍛造Normalは1 Targetにしか変換できないので、206は排他的資源である（Issue #129後も残る production target同士の競合）。
- 711f7d15が206を使った後、813fb479の投影Normal窓は207〜556（N350）。次の該当位置849は窓外。
- Gogma 1,000窓・Skill 3,000窓でも見つからなかったPhase 1-Aの観測は、族構成の合うResetがGogma 4,153まで無いことと整合する。

#### 2.3 最終Conflict 2件

| kind | resource identity | 参加Entry（Target） | 内容 |
| --- | --- | --- | --- |
| `same_normal_counter` | `weapon.charge_blade:8` 位置206（`plan-conflict:fnv1a32:61cfd288`） | 生成 `build-list.constrained.fnv1a32-a32ec8c8`（711f7d15）/ 元 `build-list.fnv1a32-bbf8125e`（813fb479） | 2.2の排他的資源 |
| `same_skill_counter` | Skill Counter 341（`plan-conflict:fnv1a32:96d4a203`） | 元 `build-list.fnv1a32-bbf8125e`（813fb479）/ retained `build-list.fnv1a32-e396d352`（820831d0） | 813fb479の元Entryが元起点のSkill位置を要求 |

rejectedは813fb479の元Entry（`resource_conflict`）の1件だけ。2件とも、未発見Targetの元Entryを分母維持のため残したことの帰結であり、
発見済み22 Targetの生成Route同士の競合は無い。

#### 2.4 仮説の判定

| 可能性 | 判定 | 根拠 |
| --- | --- | --- |
| 1. 探索extent不足 | **症状として該当** | 次の該当Normal 849が投影窓207〜556の外。Normal軸だけ広げれば届く（3節）。Gogma / Skillを広げても族構成の合うResetが無い |
| 2. Target処理順序 | **該当（根本要因の一部）** | 同条件の2 Targetのうち先に検索された方が206を取る。Phase 1-Aのfailed-first順では813fb479が見つかり711f7d15が未発見に移った |
| 3. 先行Routeによる資源消費 | **該当（根本要因）** | 206を消費したのはretained Routeではなく、index 17の生成Route（711f7d15）。retained Routeはチャージアックスの資源を使っていない |
| 4. SearchのRoute選択・候補制限 | 該当しない | 所持武器0件で他Route種は利用不可。Normal Routeは窓内の全候補を走査して無かった（boundary到達、例外なし） |
| 5. Materialization / Planner入力構築 | 該当しない | Candidateが無くmaterializationに到達していない。元Entryは分母維持の仕様どおり残った |

結論: **同一条件の2 Target（チャアク火・龍）が、0〜1,100で3箇所しかない族構成一致Normalのうち最も近い206を奪い合い、
逐次投影で後になった方がbase Normal窓（350）内に次の位置を持たない**ことが、42 / 43の直接原因である。
43 / 43には、どちらか一方がNormal 849（または886）以降を使う必要があり、チャージアックスNormal Counterを850以上進めるRouteが不可避となる
（調べたGogma窓内では）。

### 3. 改善実験V1（事前登録どおり1件）

| 項目 | V1 `normal-2x-fallback` |
| --- | --- |
| fallback発動 | index 20 / 813fb479の1回のみ（episode 1 / 3） |
| fallback Search | N700 / G500 / S1500、**found**、38.857秒、reach N700 / G500 / S895 |
| fallback Candidate | `normal_artian_to_gogma`、896操作、advance N643 / G1 / S252（投影起点）＝ **Normal位置849**、Skill 3,435 |
| 後続Search | 1efa01c6: found（`existing_gogma_mixed` 912操作）、86439c85: found（`normal_artian_to_gogma` 118操作） |
| index 0〜19 | controlと同一（generated Entry ID一致） |
| Research final | **43 / 43、Conflict 0、rejected 0 / resource 0、selected 43、termination completed、Trace Replay passed** |
| steps / expandedStates | **8,534 / 8,577**（reached limitsなし、warnings 0） |
| Search（うちfallback）/ 全Planner / total | 621.227（38.857）/ 56.554 / **688.524秒** |
| full Planner run / generated replacement | 26 / 23 |
| process maxRSS | 2.872 GiB |

final Plan SHA-256 `6c380cb3584d925e82c908ae34fe41f1d4f4f907a91515778542154df641ef66`、final result SHA-256
`c133660bf096d110ff3697bf68b948db44b051cd6b379d926dc0cd046a2c651f` は、Phase 1-E winnerの記録値と完全一致した。

#### fresh ordinary Planner（成功条件b）

別のNode processで元Exportから入力を再構築し、V1の生成Entry 23件を各Targetの元Entryと置換しただけ
（元Entry 20件はそのまま、Conflict resolutionsなし）で `createProductionPlanWithObserver()` を1回実行し、
独立に `replayPlannerSearchTrace()` を実行した（`verifyGlobalResearchFreshPlan()`）。

| 項目 | 結果 |
| --- | --- |
| Target定義（43件） | 元Exportと同一（`hashStableValue` 一致、緩和なし） |
| `validatePlannerInput` | valid、除外Entry 0 |
| completed / planning Target | **43 / 43** |
| Conflict / rejected | **0 / 0** |
| termination | **completed**（reached limitsなし） |
| steps / expandedStates / full run | 8,534 / 8,577 / 1 |
| Trace Replay（独立実行） | **valid**、issue 0 |
| 所要時間 / maxRSS | 28.555秒 / 2.982 GiB |

**事前登録した成功条件(a)(b)をすべて満たした。43 / 43に到達した。**

### 4. 評価と限界

- 本PRの新規性は「43 / 43に初めて到達した」ことではない。Phase 1-Eで既に到達しており、本PRは
  (i) 現行mainでのPhase 0完全再現、(ii) 原因を資源（族構成一致Normal位置）として直接確認、(iii) Phase 1-E V1の現行main再現と
  別processのfresh ordinary Planner検証、を加えた。
- 8,534 stepsは既知oracle 2,982より5,552多く、Production default `maxPlanSteps = 1000` を超える。総時間約11.5分（Node、raw block cacheなし）、
  maxRSS約2.9 GiBで、通常操作として実用的とは言えない。Browser Worker・スマートフォンは今回未測定（Phase 2-AでBrowser Worker成立の記録あり）。
- 資源マップはこのExport・この窓での必要条件の観測であり、Gogma 4,153超に族構成一致Resetが無いこと、849より短いRouteが無いことは主張しない。
- Normal 2倍は観測に基づく一般規則であり、「次の該当位置まで広げる」最小extentを計算したものではない。別Exportでの一般性は未確認。
- Production Search / Planner / RNG semantics、通常extent、Target条件、全versionは変更していない。REQUIREMENTS 19 / 23の
  「明示的選択なしに自動再検索しない」契約もそのまま。

### 5. 次の推奨方針

1. **43 / 43の成立性は確立済みとして扱い、研究の主題を「実用化の条件」へ移す。** 42→43の阻害要因は同条件Targetの希少資源競合で、
   generic Normal fallbackで解消し、現行mainでも再現した。D2系の局所探索を再開する必要は43 / 43到達のためには無い。
2. 実用化の最大コストはSearch（総時間の約90%）である。Phase 1-B / 1-EのResearch per-search raw block cacheでは同じsemanticsでSearchが
   大幅に短縮されている（Phase 1-E control: raw block cache per-search + immediate yieldでSearch 87.281秒、本PRのcacheなし・timer yieldでは約580秒）。次はraw block cache付きでV1を再計測し、Browser Worker（Phase 2-A）との差を
   確認したうえで、Production化に必要なdocs-only判断（無選択自動再検索の契約変更、Global Plannerのstep bound policy）へ進むことを推奨する。
3. 資源マップのような安価な必要条件計算（本件2.06秒）は、盲目的な2倍ではなく「次に族構成が合うNormal位置まで」の最小extentを
   決める材料になり得る。導入する場合は事前登録したResearchとして、Searchのcanonical順序を変えないことを確認してから行う。
4. 手数短縮（2,982級）は別目標として、本結果（8,534 steps、全43 Target共存）をincumbentに扱う。

## 検証

- `git diff --check`: pass。`npm run check:nul`: pass（1,370 text files）。
- `npm run lint`: pass。
- 追加test `plannerGlobalPhase0Missing.test.ts`: 4 tests pass。
- `npm test`: **368 files passed / 1 skipped、6,272 tests passed / 3 skipped**。
- `npm run build`（`tsc -b` + Vite）: pass。既存の500 kB超chunk warningのみ。buildしたJSに本PRのResearch識別子は含まれない。
- 計測後の修正は型注釈だけ（`Set<string>` と、testのBuildListEntryId branding）で、計測した処理の動作は変えていない。
  実Export runは再実行していない。

## 成果物

- `src/benchmarks/plannerGlobalPhase0Missing.ts`: 資源マップ `mapGlobalResearchTargetResources()` とfresh ordinary Planner検証
  `verifyGlobalResearchFreshPlan()`（Research専用、Productionからimportされない）
- `src/benchmarks/plannerGlobalPhase0Missing.test.ts`: 族構成一致（順序・段位・Normal側表記を無視）、Reset結果の共有、prediction回数、
  窓 / Seed検証、生成Entryなしでordinary Plannerと一致、Target単位の置換、重複・範囲外Entryの拒否
- `scripts/run-planner-global-phase0-missing.mjs`: `--mode run`（control / normal-2x-fallback、no-match時の資源マップ、最終Conflict詳細）と
  `--mode verify`（別processのfresh ordinary Planner）。出力は新規作成のみ
- [P0R_RESULT](PLANNER_GLOBAL_P0R_RESULT.json): 正式結果（Seed・Route本体・Export pathを含まない）

```powershell
node --max-old-space-size=8192 scripts/run-planner-global-research.mjs --export "<Export>" --output "<new>.json" --max-plan-steps 20000
node --max-old-space-size=8192 scripts/run-planner-global-phase0-missing.mjs --mode run --strategy control --export "<Export>" --output "<new>.json"
node --max-old-space-size=8192 scripts/run-planner-global-phase0-missing.mjs --mode run --strategy normal-2x-fallback --attempt-budget-ms 900000 --fallback-budget-ms 180000 --export "<Export>" --output "<v1>.json"
node --max-old-space-size=8192 scripts/run-planner-global-phase0-missing.mjs --mode verify --export "<Export>" --generated "<v1>.json.entries.local.json" --output "<verify>.json"
```
