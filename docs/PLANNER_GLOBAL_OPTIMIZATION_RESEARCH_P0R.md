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

（実行後に追記）
