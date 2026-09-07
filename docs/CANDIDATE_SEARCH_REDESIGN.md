# Candidate Search再設計 設計記録

## 0. この文書の位置づけ

この文書はCandidate Search再設計(Phase A監査 / Phase B実装)の設計記録である。

仕様authorityではない。
正式な契約は `AGENTS.md` と `docs/SEARCH_SPEC.md` にある。
両者が食い違う場合は `AGENTS.md` の Specification Authority に従う。

この文書が記録するのは以下である。

- Phase A監査で確認した実装事実
- B0で確定した設計方針とその根拠
- 採用しなかった案とその理由
- 受け入れた既知の制約
- Phase Bのタスク分割
- B1 / B2実装時に残る設計判断

---

## 1. Phase Aで確認した実装事実

すべて実repositoryコードと、`docs/RNG_REFERENCE_AUDIT.md` が固定する参照repository
commit `eceb2bd9ca6f4897ec516387acab2ad6beb8b38b` の実コードに基づく。

### 1.1 現在の探索構造

`searchBonusAmendmentVariants()` はGogma stateごとに `searchResetSkillVariants()` を
呼び、Gogma streamとSkill streamをネストしている。
`searchResetSkillVariants()` へ渡す開始Skill Counterはどのstateからも同一定数のため、
全Gogma stateがまったく同一のSkill予測列を再計算している。

通常アーティア経由では、`candidateOffset` ごとに同じamendment探索を丸ごと再実行する。
conversion後の最初の操作はResetであり、Resetは現在Bonusを参照しないため、
`depth >= 1` のstate列はoffsetに依存せず完全に重複する。

### 1.2 探索量の実測

参照実装のGogma kernelで、実PRNG進行を伴うfrontier成長を測定した。

| `maxGogmaAdvance` | 展開state数 | `predictGogmaBonus` | 最終frontier |
| ---: | ---: | ---: | ---: |
| 100 | 4,965 | 9,930 | 95 |
| 200 | 18,428 | 36,856 | 174 |
| 1000 | 344,885 | 689,770 | 577 |
| 5000 | 3,636,386 | 7,272,772 | 921 |

frontierはfamily layout数(4 familyで上限1024)へ向かって飽和する。

`maxGogmaAdvance = maxSkillAdvance = 1000`、未保護gogma scope起点1本の場合。

| 項目 | 回数 |
| --- | ---: |
| `predictGogmaBonus` | 約 690,000(約半数は同一結果のReset重複) |
| ネストされた `predictSkills` | 約 690,000,000(相異なる値は1,000個) |
| `evaluateTargetCandidate` | 約 690,000,000 |
| 操作列コピー要素数 | 約 3.5 × 10^11 |
| checkpoint由来の `setTimeout(0)` 往復 | 約 13,800,000 |

現default `5000 / 5000 / 5000` では、通常アーティア経由だけで `predictSkills` が
約 1.8 × 10^14 回となり原理的に完走不能である。

### 1.3 分解可能性の根拠

- `satisfiesIdealTarget` / `satisfiesPracticalTarget` はいずれもBonus述語とSkill述語の
  論理積であり交差項を持たない
- `createIdealDifference` はBonus側とSkill側が独立に決まる
- `calculateSimilarityScore` は両者の加算である
- `predictGogmaBonus` はGogma Counterだけを、`predictSkills` はSkill Counterだけを入力に取る

### 1.4 pruningのlossless範囲の根拠

- `predictReferenceGogmaReset` は現在Bonusを受け取らない。
  Reset結果は `(seed, gogmaCounter)` だけの関数である
- `predictReferenceGogmaKeep` は `referenceGogmaKeepFamilyCandidates(currentReferenceIds[slot])`
  だけを使い、tierを参照しない。Keep結果はslot family layoutとCounter位置だけの関数である
- したがって同一family layoutの2 stateは、以後すべてのCounter位置で同一のKeep結果を返す
- family layout単位のfrontier dedupは、将来到達可能なBonus outcomeについては
  近似ではなく無損失である。ただしroute-history diversityは1代表へ縮約される(2.4)

### 1.5 Plannerの位置固定性

`plannerBeamSearch.ts` の `counterPreconditionRejection()` は、runtime counterが
RouteOperationに記録された `counterBefore` と完全一致しない限り棄却する。

```text
current > counterBefore -> counter_before_current
current < counterBefore -> counter_unavailable
```

`plannerRouteProgress.ts` の `actionIdentity()` は、同一Counter位置の同一
Reset / Keep / Reset Skillsを `shareable` として複数Entryで共有する。

BuildRouteは位置固定であり、Plannerが再タイミングすることはできない。

---

## 2. B0で確定した方針

### 2.1 採用した基本方針

- Normal / Gogma / Skillは独立RNG stream
- Reset SkillsはSkill Counterのみ、Reset / Keep BonusesはGogma Counterのみを進める
- Skill探索をGogma stateの内側へネストしない
- Gogma探索をSkill結果の内側へネストしない
- Gogma Resetは1 Counter位置につき1回だけ計算する
- Keepは直前Bonusのslot family layoutに依存する
- frontierをfamily layout単位でdedupする。Bonus reachabilityについては無損失、
  route-history diversityについては1代表へ縮約する
- current SkillがIdeal条件を満たす武器はSkill Reset探索を行わない
- current BonusがIdeal条件を満たす武器はBonus変更探索を行わない
- currentがPracticalのみを満たす場合、操作0のPractical解を保持しつつIdeal到達探索を継続する
- Candidate SearchはTarget単体の近傍解探索、PlannerはCounter操作の両立を担当する
- IdealはPracticalの完全上位である(2.6)
- 初回検索はcanonical Idealと、その操作数以下のPractical評価を確定した時点で終了する(2.7)
- canonical Idealのtie-breakにrun依存値を使わない(2.7)
- horizon内の非劣位Practicalは列挙する。保持範囲を発見順に依存させない(2.8)
- Planner競合対策の先読みを初回検索の責務にしない(2.9)
- Production RNG prediction semanticsを変更しない
- `PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2` を維持する
- `supportsSeedSearch = false` を維持する
- `resultFilter` は最終表示・出力filterであり、探索の意味と終了規則を変えない

正式な契約本文は `docs/SEARCH_SPEC.md` 3.1 / 5.4 / 5.5 / 5.6 / 5.7 と
`AGENTS.md` の Candidate Search Stream Separation にある。

### 2.2 Candidate合成規則: Cross規則

プロジェクトオーナー判断により **Cross規則のみ** を採用した。

Cross規則は「初回Candidate Searchを高速かつboundedに保つための初期探索policy」であり、
Plannerまで含めた完全探索ではない。Bonus側代替とSkill側代替の両方が同時に必要になる
Planner競合は、Planner-driven constrained re-searchで必要時に解決する方向とする。

```text
b0 = B(c)[0]      Bonus anchor
k0 = K(c)[0]      Skill anchor

Candidate(c) = { (B(c)[i], k0) } ∪ { (b0, K(c)[j]) }

件数 = |B(c)| + |K(c)| - 1
```

採用理由。

- Bonus候補 × Skill候補の直積を構造的に発生させない
- 除外される `(B(c)[i], K(c)[j])`(`i > 0` かつ `j > 0`)は、操作数が
  `(B(c)[i], k0)` と `(b0, K(c)[j])` の両方以上であり、標準ソート順で常に劣る
- streamごとの代替解は軸候補として保持されるため、片方のstreamだけで発生する
  Conflictには対応できる

### 2.3 採用しなかった案

| 案 | 却下理由 |
| --- | --- |
| per-stream非支配解の完全直積 + `maxCandidatesPerTarget` 打ち切り | 実質d×kの遅延直積であり、今回の指示で明示的に却下された |
| 総操作数昇順のpriority queue生成 | 同上。同じ直積を遅延展開しているだけである |
| Cross規則 + 固定小定数の対角バンド(`R = 2` など) | プロジェクトオーナー判断により採用しない。Bonus側とSkill側の代替が同時に必要になる局面はPlanner-driven constrained re-searchで解決する |
| Searchがper-stream解集合を出力しPlannerが合成する | `BuildListEntry` はCandidate Snapshotであり、PlannerはBuildRoute.operationsを書き換えられない。DATA_MODELの大規模変更が必要でv1範囲外 |
| GARPの完全一致target移植 | GogmaArtianPlannerはideal / practical / alternative group / similarityを持つ。移植すると条件表現力を失う |
| GARPの最短1本返却の移植 | `maxCandidatesPerTarget` 契約とPlannerの選択肢を失う |
| GARPの `counterGate` 入力の移植 | Production active-branch方針に反する |

### 2.4 受け入れた既知の制約

1. **Cross規則の軸外未提供。** 1つのTargetがBonus側代替解とSkill側代替解を同時に
   必要とする局面で、Cross規則は `(B(c)[i], K(c)[j])`(`i > 0` かつ `j > 0`)を
   提供しない。Plannerが位置固定であるため、その局面ではそのTargetの候補が不足し得る。
   解決はPlanner-driven constrained re-searchに委ねる(2.9)。
2. **route-history diversityの縮約。** family layout dedupは、将来到達可能な
   Bonus outcomeについては無損失だが、同じlayoutへ至る `reset -> reset -> keep` と
   `reset -> keep -> keep` を1代表へ畳む。Plannerのaction sharing上、異なる操作履歴は
   異なる価値を持ち得るため、この多様性は失われる。「完全に無損失」とは表現しない。
3. **後続Counter位置は初回Searchの保持・出力対象から省略されるが、支配ではない。**
   省略には2種類ある。canonical Idealより後ろの位置は本当に未探索であり得る。
   canonical Idealより手前の位置は、たとえばPractical同一結果の `+2` と `+4` のように
   評価済みでもstream-local retentionで `+2` だけを残し `+4` を出力しない場合がある。
   いずれも「支配されたので永久に不要」ではない。Plannerは `counterBefore` の一致を
   要求するため両者は別の意味を持ち、必要になればre-searchで改めて対象になる(2.9)。

いずれもCartesian explosion回避と初回検索の高速性を優先した意図的な選択である。
B1 / B2の実装判断で勝手に緩和・追加しない。

### 2.4.1 family layout representativeの選択根拠

v1は直近Reset優先を採る。根拠は次である。

- depth dのstateはすべて操作数d・`estimatedGogmaAdvance` dで同順位のため、
  代表選択は標準ソート順を変えない
- 直近Reset優先は、そのlayoutへ至る履歴のうちKeep連鎖が最も短いものを選ぶ。
  Keep連鎖が短い履歴はより後方のReset位置1点だけに依存するため、先行位置が
  他Targetに消費された場合でも再現できる可能性が相対的に高い
- 参照実装 `findGogmaRoute()` も `lastReset` を保持して同じ代表を選ぶため、
  参照挙動との対応関係を保てる

これは最適性の主張ではなく、決定的で説明可能な既定値の選択である。

### 2.4.2 stream-local anchor ordering

`b0` / `k0` が実装偶然順に依存しないよう、stream-local deterministic orderingを
`docs/SEARCH_SPEC.md` 5.5.2 / 5.5.3 に定義した。

```text
Bonus : gogmaAdvance -> ideal closeness -> 素材必要量 -> 安定semantic key
Skill : resetCount   -> ideal closeness -> 安定semantic key
```

各streamでは進行量が操作数そのものであるため、操作数を独立キーとして重ねない。
素材はBonus側でReset / Keepの構成比により同一depthでも変わり得るため、
Bonus側にだけ入れている。

### 2.5 normal scope Keepの3層分離

| レイヤー | 内容 |
| --- | --- |
| Game operation legality | 巨戟化後の最初のBonus操作としてReset / Keepのどちらも選択できる |
| Production prediction support | normal-tier Bonusを現在値とするKeepは `unsupported_current_bonus` |
| Product挙動 | prediction supportが無い間、Search / Plannerは生成・計画しない。Domain検証も当面不正として扱う |

理由の言い換えを禁止する。除外理由は常に prediction support 不足であり、
「ゲーム上Reset必須」ではない。

normal-tier familyからKeepした場合のProduction RNG prediction semanticsは
unverifiedである。B0では推測して定義しない。
Master DataのBonus Type Mappingからfamily対応を導けそうに見えても、
抽選pool・weight・repeat penaltyを推測しない。

Game operation legalityは確定済みである。

```text
通常アーティア -> 巨戟化 -> preserved normal-tier bonuses -> Reset または Keep を選択可能
```

したがって「normal-scopeからKeepできるかをgame-verifiedする」を将来タスクの前提に
しない。未検証なのはnormal-tier BonusからKeepした場合の
Production RNG prediction semanticsだけである。必要なのは次である。

- 実ゲーム観測
- game-verified fixture
- normal-tier family -> Keep結果のprediction semantics確定

実装上のskip reason `normal_scope_requires_reset` と対応するUI文言は
この方針と矛盾するため廃止した。B6で `normal_scope_keep_prediction_unsupported`
へ改称し、UI文言も予測未対応を意味する表現へ訂正した。この誤表現の廃止は
RNG semantics検証の完了を待つ必要がなく、UI / skip reasonの是正だけで先行できた。

---

### 2.6 Ideal ⇒ Practical 包含不変条件

プロジェクトオーナー判断により、IdealはPracticalの完全上位とする。

```text
Ideal     = 本来ほしい完成形
Practical = Idealには届いていないが妥協して使用できるライン

{ Idealを満たす完成品 } ⊆ { Practical条件を満たす完成品 }
```

Phase A報告では「Ideal条件とPractical条件は独立なので、Idealを満たしても
Practicalを満たさない可能性がある」と指摘したが、これはプロダクト仕様として
採用しない。正式な不変条件は `docs/DATA_MODEL.md` 8.1 にある。

この不変条件が2.7のIdeal既達成stream早期終了の前提である。
TargetWeapon validationはB7でこの包含を検証するようになった。

包含を利用する最適化はvalidation実装(B7)完了後にのみ実装する。
Phase順は `B0 -> B7 -> B1 -> ...` とし、B7を後回しにできる独立作業として
扱わない(4.0参照)。この順序自体は変更しない。

実装状況は次である。

```text
B7 : Ideal ⇒ Practical validation        完了
B1 : Skill stream Ideal既達成 early exit  完了
B2 : Bonus stream Ideal既達成 early exit  完了
```

### 2.7 初回Searchの終了条件とcanonical Ideal

初回Candidate Searchは、canonical Idealを1件確定し、その
`estimatedOperationCount = D` 以下で到達可能なPracticalの評価も確定した時点で終了する。

```text
探索開始
  -> canonical Idealを確定 (操作数 D)
  -> estimatedOperationCount <= D のPracticalを評価対象として確定
  -> 5.5.6のdominanceを適用して非劣位Practicalを保持
  -> Idealを保持
  -> 通常探索終了
```

終了はcanonical Idealの発見だけでは成立しない。`D` 以下のPractical評価対象が
すべて確定していなければならない(2.8のhorizon)。

「最初のIdeal」はincidental traversal order(先に評価されたRouteKind、先に解決した
Promise)であってはならない。`docs/SEARCH_SPEC.md` 8章の標準ソート順で最小の
Ideal候補と定義する。Ideal候補間では `category` / `similarityScore` /
`matchedBonusCount` が縮退するため、実質は
操作数 -> Gogma -> Skill -> Normal -> `candidateStableKey` の全順序になる。

最終tie-breakに `BuildCandidate.id` を使わない。実装事実として、
`SearchPage` は検索ごとに `crypto.randomUUID()` 由来の `searchRunId` を生成し、
`createCandidateFromPrediction()` の `semanticHash` はそれを含み、
`BuildCandidate.id` はその hash から生成される。したがってCandidate IDは
run間で安定せず、canonical Idealの一意性を壊す。

`candidateStableKey` は `searchRunId` / `createdAt` / `BuildCandidate.id` を含まず、
`finalBonuses`(正規化multiset) / `restorationBonusScope` / `seriesSkillId` /
`groupSkillId` / `route.kind` / `route.sourceOwnedWeaponId` / `route.operations`
から決まる。既存の `stableStringify` / semantic hashing 規則と整合させる。

**同一入力なら検索runを跨いでも同じcanonical Idealを選ぶ**ことを契約とする。
B0では `BuildCandidate.id` の生成実装を変更しない。`candidateStableKey` の導入は
B4の実装事項である。

実装はbest-firstでも、暫定最良の総操作数を上界とするbranch-and-boundでもよい。
参照実装 `calculate()` の `if (best && forgeCount >= best.total) break;` が
後者の例である。探索スケジューリングはB1 / B2で設計してよいが、一意性契約は変えない。

Ideal既達成streamの早期終了。

```text
current Bonus = Ideal    -> Bonus streamの将来探索不要
current Skill = Ideal    -> Skill streamの将来探索不要
current = Practicalのみ  -> 操作0のPractical解を保持し、Ideal探索を継続
```

この早期終了はB7完了後にのみ実装する(2.6、4.0)。

### 2.8 Practical保持とdominance規則

Practicalは最良1件に絞らない。保持範囲は実装上の発見順から独立させる。

```text
canonical Ideal の estimatedOperationCount = D

初回Searchでは estimatedOperationCount <= D で到達可能なPracticalを
Practical保持の評価対象とし、その集合へ保守的dominanceを適用する。
```

操作数がちょうど `D` のPracticalも対象に含める。canonical Idealが探索上限内に
存在しない場合は、設定された探索範囲内で評価できたPracticalへ同じ規則を適用する。

「たまたまIdealを先に発見したので、それより近いPracticalを評価しなかった」という
結果を許可しない。best-first / branch-and-bound / RouteKind評価順 / Promise解決順の
いずれを変えてもPractical集合が変わらないことを契約とする。
canonical Ideal確定後に `D` を超える遠方Practicalまで探索を広げる必要はない。

この評価対象集合のうち、明確に他候補の下位互換でないものを列挙する。

dominance判定は保守的に狭く定義する。削除してよいのは確実なPareto dominanceが
成立する場合だけであり、判定条件は `docs/SEARCH_SPEC.md` 5.5.6 に10項目で定義した。

2つの比較は特に厳密化した。

- **Bonus rank**(5.5.6.1)。完成Bonusはmultisetとして評価するため、rank比較を
  slot indexへ依存させない。`bonusTypeId` ごとにMasterのrank orderingで正規化した
  rank vectorを降順ソートし、全要素で `sortedRanks(B)[i] >= sortedRanks(A)[i]` が
  成立する場合だけBを上位とみなす。Masterでrank orderingを安全に比較できない
  scope / typeは推測せず比較不能とする
- **素材**(5.5.6.2)。合計個数ではなく `materialId` 単位のcomponent-wise比較とする。
  異なるmaterialId同士の価値をSearchが推測してはならない。
  `X×2` と `Y×1`、`{X×2, Y×1}` と `{X×1, Y×2}` はいずれも比較不能である

2.4.2のstream-local anchor orderingにある「素材必要量合計」は決定的tie-breakであり、
Practical dominanceの判定基準とは別物である。

Search側が次のような主観的・未定義な性能比較を行うことを禁止する。

- 会心率の方が属性より強い
- 攻撃の方が会心より価値が高い
- あるSeries SkillがほかのSeries Skillより優れている

異なるBonus Type構成、異なるSkill構成、異なるsource、
一方が近いがもう一方が強いというtrade-offは、すべて比較不能として両方保持する。

### 2.9 Planner-driven constrained re-search

Counter競合の解決はPlannerの責務とし、Candidate Searchの初回探索から切り離した。
契約は `docs/PLANNER_SPEC.md` 9.1 / 9.2 にある。B0で固定したのは次の禁止事項である。

- 再検索開始位置を `conflictingCounter + 1` へ後方固定しない。
  競合位置より前に利用可能なPracticalが存在し得る
- Counter位置の一致だけを理由に候補を除外しない。
  shareableなoperationは共同実行できる
- Candidate Search側にcounter precondition / action identity /
  shareable operation 判定を複製しない
- 初回Search用pruningを、Planner制約下の再検索へ永久除外として持ち込まない
  (`docs/PLANNER_SPEC.md` 9.2.5)

初回Searchで候補が省略される理由は次であり、いずれも**初回の単体Target Searchを
高速・簡潔にするためのpolicy**である。Planner制約下で候補を永久に無効化する
**Domain dominanceではない**。

| 省略理由 | 定義 |
| --- | --- |
| 同一結果の最小advance retention | SEARCH_SPEC 5.5.2 / 5.5.3 |
| Practical dominance | 同 5.5.6 |
| Practical保持のhorizon | 同 5.5.6.0 |
| canonical Ideal到達による探索終了 | 同 5.6.2 / 5.6.3 |
| Cross-onlyの初回bounded policy | 同 5.5.4 |

```text
+2 攻撃III Practical
+4 攻撃II  Practical

初回Search : +2が+4を明確に上回るため+4を省略
Planner    : 固定Candidateとの競合で+2が実行不能、+4は実行可能
再検索     : +4を次点Practicalとして再評価・採用できる
```

特に、初回SearchのPractical dominanceをそのまま再検索へ持ち込み、
現在実行不能なdominant candidateが実行可能なdominated candidateを
永久に隠してはならない。

これはCartesian productの復活を意味しない。Bonus streamとSkill streamは
引き続き独立に解き、Cross-onlyの初回policyも維持する。追加で必要なのは、
省略されたCandidateを固定Candidateとの共存可能性に応じて再評価できることだけである。

B0時点ではconflict contextを概念契約のみとし、新しいTypeScript型を追加しなかった。
B8-Aでconflict context DTO、constrained enumeration API、generated BuildListEntry、
決定的ID、Persistence契約、boundsまでを正式契約として確定した(4.2)。
契約本文は `docs/PLANNER_SPEC.md` 9.2と `docs/SEARCH_SPEC.md` 5.6.7にある。

what-if比較(一方を固定した場合の他方の次のPractical / Idealまでの距離)はB9であり、
B8では実装しない。

---

## 3. Production RNG semanticsとengine version

今回の再設計はCandidate Search orchestration / algorithmの変更である。

- `predictGogmaBonus` / `predictSkills` / `predictNormalArtian` の入出力を変えない
- 同一入力に対する予測値を変えない
- Resetがstate非依存であること、Keepがfamily layoutだけに依存することは
  現行実装の性質であり、新設計はそれを利用するだけで変更しない

したがって `PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2` を維持する。

bumpすると `CalculationContext` 変更により既存のBuildCandidate / BuildListEntry /
ProductionPlanがすべて `calculation_context_changed` でstale化する。
探索効率化のためにユーザーの作成リストを破棄することは正当化できない。

B11(normal-tier Keep prediction semantics)は、既存のsupported入力の出力が
1件でも変わる場合にだけbumpを検討する。単なるcoverage追加であればbumpしない。
B5は実Browser Worker性能検証であり、engine versionへ影響しない。

---

## 4. Phase Bタスク分割

| # | タスク | 内容 | 依存 |
| --- | --- | --- | --- |
実行順は次である。B7はB1より先に完了させる。

```text
B0 -> B7 -> B1 -> B2 -> B3 -> B4 -> B5 -> B6
                                  \
                                   -> B8-A -> B8-B1 -> B8-B2
                                                   \
                                                    -> B8-C -> B8-D -> B8-E
                                                                          \
                                                                           -> B9 / B10

B11 は実ゲーム観測を前提とする独立系列
```

| # | タスク | 内容 | 依存 |
| --- | --- | --- | --- |
| B0 | 仕様確定 | 本記録と `AGENTS.md` / `docs/*` の契約更新 | 完了 |
| B7 | Target Ideal ⇒ Practical validation | `docs/DATA_MODEL.md` 8.1 の包含不変条件をTargetWeapon validationへ実装。既存保存Targetの扱いを含む | 完了 |
| B1 | Existing Gogma Skill stream独立化 | 共有Skill列、Ideal既達成時の0回化、`maxSkillAdvance` off-by-one整合、SEARCH_SPEC 6.5前提の早期判定。Gogma側は触らない | B0, **B7**。完了 |
| B2 | Gogma Reset / Keep探索のstate search化 | depthごとReset 1回、family layout dedup、frontierから操作列を除去、Keep-only先行路、決定的representative | B1。完了 |
| B3 | Candidate生成 / route表現の整理 | Cross規則、stream-local anchor ordering、offset / source重複除去、分解評価と既存Target評価器の一致担保 | B1, B2。完了 |
| B4 | 初回Search終了条件とPractical保持 | canonical Ideal終了、`candidateStableKey` によるrun非依存tie-break、操作数D以下のPractical horizon、branch-and-bound / best-first、非劣位Practical列挙、保守的dominance、`maxCandidatesPerTarget` のIdeal枠確保 | B3, **B7**。完了 |
| B5 | 実Browser Worker性能検証 | C5-E2C8と同形式の実測。checkpoint yield間隔の見直しを含む | B4。完了 |
| B6 | UI / default / labels修正 | default値、進捗表示粒度、Worker native error handling、`no_owned_weapon_available` 文言、`normal_scope_requires_reset` の誤表現是正 | B5。完了 |
| B6-F1 | Candidate出力順のrun非依存化 | `compareCandidates()` / `compareDuplicateCandidates()` の最終tie-breakを `BuildCandidate.id` から `candidateStableKey` へ変更。Candidate ID生成規則は不変 | B6。完了 |
| B8-A | Planner-driven constrained re-search 仕様確定 | architecture、conflict context DTO、constrained search API、generated BuildListEntry、決定的ID、Persistence契約、bounds、task分割 | B4, 既存Planner。完了 |
| B8-B1 | constrained candidate enumerator | Search Domain側の制約付き列挙。enumeration boundsはcaller必須指定 | B8-A。完了 |
| B8-B2 | enumerator実Browser Worker benchmark | enumeration boundsのProduction default決定 | B8-B1。完了 |
| B8-C | Planner conflict orchestration | 固定Candidate判定、Conflict Resolution再対応付け、deterministic materializer、augmented-input完全再実行。orchestration boundsはcaller必須指定のまま | B8-B1 |
| B8-D | Worker / Application / Persistence | atomic save、既存UIへの最小配線 | B8-C |
| B8-E | orchestration Browser / Planner benchmark | orchestration boundsのProduction default決定 | B8-D |
| B9 | what-if比較 | 一方固定時の他方の次のPractical / Idealまでの距離算出と提示 | B8-E |
| B10 | 競合UI | 競合候補の除外 / 選択不可表示と理由提示 | B8-E |
| B11 | normal-tier Keep prediction semantics | 実ゲーム観測 -> game-verified fixture -> Production prediction実装。Search / Planner / Domain検証の除外解除 | 実ゲーム観測 |

### 4.0 B7を先行させる理由

Ideal既達成streamの早期終了(2.7)は Ideal ⇒ Practical 包含不変条件に依存する。
validationが無い状態でB1の「Ideal既達成なら0回探索」を実装すると、
包含を満たさない不正Targetに対してPractical候補を取りこぼす。

したがってB1 / B4のように包含を利用する最適化は、B7完了後にのみ実装する。
B7を「B1〜B3と独立なので後回しにできる作業」として扱わない。
既存保存Targetの扱い(保存時のみ検証するか、読み込み時にwarningを出すか)は
B7の実装判断として残してよいが、B1を先行させて不正Targetでも早期終了する状態を
作ってはならない。

**B7完了。** Master-awareな `validateTargetIdealImpliesPractical()` を
`src/domain/target/targetInvariantValidation.ts` へ追加し、保存時
(`TargetWeaponCrudService.save()`) とCandidate Searchの対象Target選択時
(`selectedTargets()`) の両方で実行する。既存保存Targetは自動修正せず、
Searchがwarning付きで除外する。B1 / B4の早期終了前提は満たされた。

**B1完了。** Skill streamを `src/domain/search/skillStream.ts` の
`TargetSkillStream` として独立させた。`searchTarget()` がTargetごとに1つ生成し、
`RouteSearchContext.skillStream` で全RouteKind・全Route baseが共有する。
Prediction列は絶対Skill Counter位置単位でmemoizeし、解集合は開始Counter単位で
memoizeする。したがって同一 `(TargetWeaponId, baseSeed, Skill Counter位置)` に対する
`predictSkills()` は最大1回であり、Gogma state数・起点武器数・normal offset数に
比例しない。

`searchBonusAmendmentVariants()` はCandidateではなくBonus stateだけを返す
Bonus stream専用の探索になり、内側からSkill探索を呼ばない。Candidate生成は
`composeSkillCandidates()` がRoute base側でBonus解とSkill解を合成する。
Ideal既達成のSkill stream早期終了は、既存巨戟のcurrent Skill(SEARCH_SPEC 6.5)と
conversion時の初回Skill(同 6.1 手順4 / 6.2)の両方へ適用する。判定は共通の
`skillsSatisfyIdeal()` で行い、該当する場合はそのRouteの `skillStream.solve()` を
呼ばず ResetSkillsOperation も追加しない。conversion結果そのもののCandidateは
通常どおり生成し、Bonus streamの探索も継続する。

`maxSkillAdvance = M` のCounter範囲は既存実装が既にB0仕様どおりであり、
今回はoff-by-oneを作らないことをテストで固定した。既存巨戟は `S ... S + M - 1` の
M位置、conversionを含むRouteは conversion が `S`、Reset Skills が `S + 1 ... S + M`
で、共有列全体は `M + 1` 位置、Reset上限は常にMである。conversion Skillが
Idealの場合は `S` の1回だけで、Reset Skillsは0回になる。

B1の範囲外として残したもの。Cross規則の正式実装(B3)前であるため、Bonus解と
Skill解の合成件数は従来どおりBonus state数 × Skill解数のままである。B1で新設・
拡大はしていない。Skill解のstream-local retention(同一 `(seriesSkillId,
groupSkillId)` は最小 `resetCount` だけ残す)とdeterministic anchor orderingも
B3 / B4へ残した。`existing_gogma_reset_skills` / `existing_gogma_mixed` の
`searchedRoutes` 報告条件は従来どおりで、Ideal既達成による早期終了は
skip reasonを新設しない。

**B2完了。** Bonus streamを `src/domain/search/bonusStream.ts` の `TargetBonusStream`
として独立させた。`searchTarget()` がTargetごとに1つ生成し、`RouteSearchContext.bonusStream`
で全RouteKind・全Route baseが共有する。

Reset予測は絶対Gogma Counter位置単位でmemoizeするため、同一 `(TargetWeaponId, baseSeed,
Gogma Counter位置)` に対する `predictGogmaBonus({ type: "reset_bonuses" })` は最大1回であり、
frontier state数・起点武器数・normal offset数に比例しない。Keep予測は
`(Gogma Counter位置, 順序付きfamily layout)` 単位でmemoizeする。family layout keyは
`src/domain/rng/gogmaBonusFamily.ts` の `gogmaKeepFamilyLayoutKey()` がDomain semantic値
(`bonusTypeId` の順序付き5枠) から求める。参照実装のprivate reference IDをSearchへ持ち込まず、
normal-tier familyも定義していない。参照Keep family tableが `bonusTypeId` 単位で
グルーピングされていることはテストで固定した。

frontier stateは `{ depth, lastResetDepth, bonuses, scope, familyLayoutKey }` のcompact形で、
`RouteOperation[]` を保持しない。同一depth・同一family layoutのstateは2.4.1の
直近Reset優先(`lastResetDepth` 最大)で1代表へ畳み、同点は完成5枠のstable semantic keyで
決定する。生成したstateはfrontier縮約の前にすべてBonus解として公開するため、
畳み込みで候補を失わない。Candidateへ渡す操作列は `(depth, lastResetDepth)` から
`bonusAmendmentOperations()` が再構成し、depth `1 ... r` をReset、以降をKeepとする
canonical historyを与える。Counter進行値は `engine.advanceGogmaCounter()` から取る。

`depth >= 1` のBonus解集合はキャッシュする。normal scope起点は最初のBonus操作が必ずResetで
以後が起点非依存になるため `(startGogmaCounter)` 単位、gogma scope起点は
`(startGogmaCounter, 順序付き5枠)` 単位で共有する(SEARCH_SPEC 5.5.3)。Keep prediction support
判定は畳み込み後の代表の実際の5枠に対して行うため、layout共有がsupport判定を跨がない。

> **B5-F1補正:** 以下はB2当時の実装記録である。`areRestorationBonusSetsEqual()` だけの
> current Bonus Ideal判定は、5.1のgogma scope要件を欠いていた。B5-F1でTarget Domainの
> scope-aware `satisfiesIdealBonuses()` へ補正した。normal scopeの5/5一致では探索を止めない。

現在BonusがTargetの `idealBonuses` と一致するRoute baseは、Bonus amendment探索を行わない。
判定は既存Domain semanticsの `areRestorationBonusSetsEqual()` を使う。該当する場合
`predictGogmaBonus` は0回、Reset / Keep操作も0件になり、Skill streamは独立に継続する。
Practicalのみを満たす状態では探索を打ち切らない。

B2の範囲外として残したもの。Cross規則(B3)、stream-local anchor ordering、同一結果の
最小advance retention、Practical dominance、canonical Ideal、`candidateStableKey`、
初回Search終了条件(B4)は未実装で、Bonus解とSkill解の合成件数はB1時点のままである。
Ideal既達成による早期終了は今回もskip reasonを新設していないため、全起点がBonus Ideal
既達成の場合の `existing_gogma_reset_bonuses` skip reasonは従来どおり
`gogma_prediction_unsupported` のままである。文言是正はB6の範囲とする。

**B3完了。** Route baseごとのstream解集合、stream-local retention / ordering、Cross規則、
分解評価をそれぞれ独立モジュールへ実装した。

- `src/domain/search/streamSolutions.ts` が `RouteSkillSolution` / `RouteBonusSolution`
  (いずれも操作0解を含む)、stream-local評価、retention、deterministic orderingを持つ
- `src/domain/search/crossComposition.ts` が `crossStreamSolutions()` としてCross規則だけを
  実装する。生成件数は `|B(c)| + |K(c)| - 1` であり、軸外pairを生成しない
- `src/domain/search/routeSearchShared.ts` の `composeRouteCandidates()` が
  ideal / practicalのcategory predicateごとにCrossし、重複pairを1回だけCandidate化する

> **B5-F1補正:** 以下のB3当時の「scopeをretention identityに含めない」という記録と
> 当時のSEARCH_SPEC 5.5.3は、5.1のIdeal scope契約と矛盾していた。B5-F1で正式仕様と
> full-prefix / incremental retention、差分Crossの重複判定を `(scope, 完成5枠multiset)`
> へ修正した。normal / gogmaの同一multisetは別解とし、stream-local安定順序の最後に
> scope tie-breakを加えた。B2のfamily-layout frontier dedupとは別のretentionである。

Skill retentionは同一 `(seriesSkillId, groupSkillId)` の最小 `resetCount`、Bonus retentionは
同一完成5枠multisetの最小 `gogmaAdvance` を残す。`restorationBonusScope` は
`RouteBonusSolution` には保持するが、retention identityには含めない(SEARCH_SPEC 5.5.3)。
完成5枠のkeyはslotごとに `(bonusTypeId, bonusRankId)` を構造的にencodeしてから
sortするため、区切り文字を含むMaster IDでも別pairが衝突しない。orderingは
SEARCH_SPEC 5.5.2 / 5.5.3どおりで、比較はlocale非依存の文字列比較を使う。
Bonus orderingの素材必要量合計はtie-break専用で、B4のcomponent-wise dominanceとは
別物である。

分解評価のauthorityは既存Domain関数のままとした。Bonus側は
`areRestorationBonusSetsEqual()` / `evaluatePracticalBonusConditions()` と、
`createIdealDifference()` から切り出した `createBonusIdealDifference()`、Skill側は
`evaluateSkillCondition()` を使う。合成後の `category` / `idealDifference` /
`similarityScore` / `isSimilarToIdeal` は従来どおり `evaluateTargetCandidate()` が決める。

既存巨戟RouteKindは合成した `(d, k)` から決める。`d = 0` かつ `k = 0` はCandidate化しない。
通常 / 所持通常経由は `create_normal_artian` / `convert_normal_to_gogma` を必ず含むため
`d = 0` / `k = 0` でも合成する。操作列はRoute base → Bonus → Reset Skillsの順に連結する。
Protected起点は `gogmaAdvance = 0` のBonus解しか持たないため、Skill軸のみのCandidateになる。

B3の範囲外として残したもの。canonical Ideal、`candidateStableKey`、Practical horizon、
Pareto dominance、`maxCandidatesPerTarget` のIdeal枠確保、初回Search終了条件はB4のままで、
出力段のsort / dedup / truncationも現行実装を維持した。

B1 / B2のテストのうち、同一結果を全depth・全位置で候補化する前提だったものは、
各stateへ固有の完成結果を与えるfixtureへ更新した。stream-local retentionが
「同一結果の後続位置を初回Searchの出力から省く」挙動そのものであり、
テストを弱めずに元の観点(全depthのcanonical history、Reset 1 ... Mの被覆)を維持するための
最小変更である。

**B4 = 完了。** Target全体のpending-work queueを総操作数の下界で処理し、
D以下の全workをsettleした後、Idealがあれば終了する。Idealがなくてもqueueが
空ならexhaustionとして終了し、空のoperation layerを回さない。
Normalは次offsetだけを登録し、各Route baseを1回生成する。共有Skill / Bonus channelは
新しいdepthだけをretentionへ投入し、保持された差分だけを各baseのCrossへ配信する。
各categoryのanchorを固定し、新しいpairだけを1回評価する。計算済みprefixと
Bonus frontier、B1 / B2のPrediction memoは保持する。

完成multisetの構造化encodingを共有し、canonical Idealとbounded Practicalの選択には
run非依存の `candidateStableKey` を使用する。操作数D以下のPracticalにだけ、
Master rank vectorとmaterialIdごとのcomponent-wise比較を含む保守的dominanceを適用する。
Ideal枠を確保して件数上限を適用し、その後にresultFilterを適用する。
B1 / B2 / B3の回帰に加え、上限100 / 5000でもD=3でNormal 2回、Skill 3回、
Reset 3回、Keep 4回に予測を限定するテストを追加した。Route base登録・depth評価・
Cross評価の非再実行と、workなし時のscheduler step 0もテストで固定した。
**B5 = 完了。** 実Browser Worker計測は
[B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md](./B5_CANDIDATE_SEARCH_BROWSER_WORKER_BENCHMARK.md)
に記録した。checkpoint間隔(50回)は測定上の問題が無かったため変更せず、
yieldの手段だけを `setTimeout(resolve, 0)` からMessagePortのtask 1回へ置き換えた。
同一条件のbefore / afterで保持集合は完全一致し、yield回数の多いworkloadで
1.3〜3.4倍速くなった。cancelはWorker ackとWorker停止をbenchmark seamで実測し、
ack 1.2〜16.5 ms、計算停止 1.3〜16.7 msである。cancel後のclient-visibleな
progress callbackは0件だが、Workerが送出したraw response message自体は
instrumentしていない。
Search semantics、B4 scheduler、Cross規則、Production RNG semanticsは変更していない。

B5で判明し、B5では修正しなかった事項が3つある。

1. Candidate出力順がrun依存である。`compareCandidates()` の最終tie-breakが
   `BuildCandidate.id`(= `searchRunId` を含む)であり、保持集合とcanonical Idealは
   run非依存だが表示順だけが変わりうる。**B6-F1で解決済み** (下記)
2. `SearchWorkerClient` がWorkerの `error` / `messageerror` を購読しておらず、
   Worker load失敗を自動検知できない(再現済み)。ユーザー操作が無ければ検索中
   表示が続く。既存のCancelボタンによる手動復帰は可能
3. `docs/SEARCH_SPEC.md` 5.1 はIdealに `finalBonusScope = "gogma_artian"` を
   要求するが、`createCandidateFromPrediction()` が `restorationBonusScope` を
   評価器へ渡していないため、`normal_artian` scopeのままでもIdealになり得る。
   B5 benchmarkはこの挙動へ依存しないようfixtureを修正した。Production修正は
   B5のscope外であり、設計チャットで独立したSearch correctness taskとして扱う
   (B6の作業へ自動的に含めない)。**B5-F1で解決済み** (下記)

**B5-F1 = 完了。** 5.1をauthorityとして、Target Domainの共通Ideal Bonus helperに
gogma scopeと完全multiset一致を集約した。Target評価・stream-local Ideal・current Bonus
shortcutへ適用し、unknown rank validationはscope判定より先に維持する。
normal-scope CandidateはPractical評価対象で、IdealDifference / Similarityにscope減点は追加しない。
full-prefix / incremental retentionと差分Crossのidentityはscope込みへ補正した。
B4 schedulerのqueue / lowerBoundは変更せず、normal-scope D=2をPracticalとし、
Reset後のgogma-scope D=3まで探索する回帰と、既存normal-scope GogmaのReset探索回帰を追加した。
Plannerは明示承認に基づくTarget評価call siteへのscope引数追加1行だけを行った。
B2 frontier / lastResetDepth、RNG、Cross規則、Practical dominance、candidateStableKey、
表示順、Worker性能コード、UI/defaultとB5測定値は変更していない。

**B5-F1 Compatibility review補正:**

B5-F1はCandidate classification / Search calculation semanticsを変更したため、
現行の `CalculationContext.appSchemaVersion` を1から **2** へ更新した。
単一authorityは `src/domain/models/common.ts` の
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2` とし、Search、BuildList、Plannerと
benchmark入力のruntime creatorで共用する。これはDexieの `DATABASE_SCHEMA_VERSION = 1`
や `AppSettings.schemaVersion = 1` の変更ではない。gameVersion、Master Data version、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2`、`supportsSeedSearch = false` は維持する。

version 1の既存BuildCandidate / BuildListEntry / ProductionPlanはversion 2とCalculationContext
非互換であり、現行計算結果として再利用しない。BuildListEntryは既存のstale再判定で
`calculation_context_changed` を付け、Planner入力から除外する。旧Candidateのcategoryや
Snapshotを自動変換せず、削除migrationも追加しない。必要なCandidateは再検索して取得する。
歴史データの形式検証・Export/Import契約は変更しない。

Plannerのscope回帰ではnormal-scopeのOwned GogmaがIdealラベルとSkillに完全一致しても
`hasIdeal = false / hasPractical = true`、gogma-scopeでは `hasIdeal = true` を固定する。
Planner algorithm / Beam Search / scoringは変更していない。benchmarkの変更は計算contextの
version追従のみであり、B5 workload、予測条件、測定値とWorker性能コードは維持する。

**B6-F1 = 完了。** B5 7章のFinding「Candidate出力順がrun依存」を解消した。
`compareCandidates()` と `compareDuplicateCandidates()` の最終tie-breakを
`compareStableKeys(left.id, right.id)` から `candidateStableKey` 比較へ変更した。
既存のsort priority(category、操作数、Gogma / Skill / Normal advance、
similarityScore、matchedBonusCount と、duplicate側の操作数、素材合計、Counter合計)は
変更していない。`candidateStableKey` まで完全一致する2 Candidateは
run非依存のsemantic差を持たないため比較結果0とし、`BuildCandidate.id` や
`createdAt` で無理に順序づけない(`deduplicateCandidates()` は先着を保持する)。

`BuildCandidate.id` の生成規則、`semanticHash` への `searchRunId` 包含、
`candidateStableKey` の構成、`candidateDeduplicationKey()` は変更していない。
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2`、Production RNG semantics / version、
`supportsSeedSearch`、B2 / B3 / B4 / B5-F1 / B6の契約、Similarity式、resultFilter、
B5 benchmarkのworkload設定値と測定値も変更していない。

回帰として、`searchRunId` だけを変えた2 runで各Targetの
`candidates.map(candidateStableKey)` が配列順まで一致し、かつ `BuildCandidate.id`
列は一致しないことを固定した。B5でordered parityが実際にrunごとに変わった
`no_ideal_gogma_25` を含む。

**B8-A = 完了。** Planner-driven constrained re-searchの正式契約を仕様文書へ固定した。
Production TypeScript実装とテストは変更していない。詳細は4.2に記録する。
B8-B1以降は未完了である。

B8 / B9 / B10 はB1〜B3のstream独立化とは責務が異なるため、既存B1 / B2へ混ぜない。
特にB8はPlanner側の新規orchestrationである。

B11は「normal-scopeからKeepできるか」の検証ではない。game legalityは確定済みで、
未検証なのはprediction semanticsだけである。B6のUI / skip reason是正は
B11の完了を待たない。

### 4.1 B0で実装しないもの

次はすべて仕様化・設計記録のみであり、B0では実装しない。

| 項目 | 割り当て先 |
| --- | --- |
| Target Ideal ⇒ Practical validation | **B7(B1より先行、完了)** |
| Candidate Searchのstream独立化 | B1 / B2 / B3(B7完了後) |
| 初回Search終了条件とPractical保持 | B4(B7完了後) |
| Planner-driven constrained re-search | B8-A(仕様) / B8-B1〜B8-D(実装) |
| conflict context DTO | B8-A(仕様) / B8-C(実装) |
| 初回Search pruning全般を永久除外にしない保証 | B8-A(仕様) / B8-B1(実装) |
| canonical Idealのrun非依存tie-break (`candidateStableKey`) | B4 |
| Practical保持のdeterministic horizon | B4 |
| what-if検索 | B9 |
| UI競合表示 | B10 |
| default値変更 | B6 |
| Search progress改善 | B6 |
| normal-scope Keep prediction | B11 |
| Worker error handling | B5で再現済み。設計判断はB6 |

---

### 4.2 B8-Aで確定した契約

B8-Aは仕様タスクである。変更したのは仕様文書だけで、`src/**`、テスト、build設定、
DB schemaは変更していない。

契約本文の所在。

| 内容 | 所在 |
| --- | --- |
| B8 architectureと全体契約 | `docs/PLANNER_SPEC.md` 9.2.6〜9.2.17 |
| conflict context DTO / 競合資源identity | 同 9.2.3 |
| conflict preflightとResolution再対応付け | 同 9.2.3.1 |
| 固定Candidateのauthority | 同 9.2.7 |
| Planner-generated BuildListEntry | 同 9.2.8、`docs/DATA_MODEL.md` 9.4 |
| Planner再実行 | 同 9.2.10 |
| 共存可能性のauthority | 同 9.2.11 |
| semantic identityとEntry再利用 | 同 9.2.12 |
| 決定的ID生成 | 同 9.2.13 |
| Orchestration結果 | 同 9.2.14 |
| Persistence契約 | 同 9.2.15、`docs/DATA_MODEL.md` 14.5 |
| bounds(enumeration / orchestration分離) | 同 9.2.16 |
| determinismの範囲 | 同 15.9.1 |
| deterministic constrained search identity | 同 9.2.13 |
| deterministic materializer | 同 9.2.13、`docs/SEARCH_SPEC.md` 5.6.7 |
| constrained enumeration API / origin / route policy / 軸外Cross | `docs/SEARCH_SPEC.md` 5.6.7 |

確定した主な点。

- 共存可能性の最終authorityは、augmented PlannerInputに対する既存Plannerの再実行とする。
  Search側へcounter precondition / action identity / shareability / inventory /
  source versionを複製しない
- constrained CandidateをBeam Search途中Stateへinjectせず、
  `createInitialPlannerSearchState` から完全再実行する
- 固定Candidateのauthorityは `PlannerConflictResolution.selectedBuildListEntryId` だけとする。
  `recommendedBuildListEntryId`、bestStateのparticipant、priority、scoreを使わない
- 最終augmented PlannerInputへ採用したgenerated BuildListEntryだけを、
  ProductionPlanと同一Dexie transactionで保存する
- generated Entry IDはrandom UUID / Clock / enumeration ordinal / request UUIDへ依存させない
- 既存 `TargetSearchScheduler` をconstrained enumerationへ流用しない
- 軸外Crossは必要なTarget・競合に限りlazyに評価し、full Cartesianを事前生成しない
- `PlanConflict.id` はparticipant集合を含むためgenerated Entry追加でIDが変わり得る。
  元の `conflictKey` を流用せず、競合資源identityとfixed Entryで一意に再検出できた
  場合だけ現在のIDでresolutionを構築する。0件・複数件では推測しない
- 再対応付けはfull Beam Searchの前のinitial conflict preflightで行う。resolution
  無しのBeam Searchを先に走らせて結果からresolutionを組み直す循環を作らない。
  `maxPlannerReruns` はfull Beam Searchの実行回数だけを数え、preflightを含めない
- preflightは通常Beam Searchと同じvalidation authorityを使う。
  `validatePlannerInput` → `validation.validBuildListEntries` →
  `createInitialPlannerSearchState` → 通常Plannerと同じinitial relevant-entry
  selection → `createPlannerRouteUnitPlans` → `detectPlannerConflicts` の順とし、
  raw `BuildListEntry` から初期Stateを作らない。generated Entryまたはfixed Entryが
  validation除外ならfail closed。この経路はshared pure helperとして通常Plannerと
  共有し、二重実装しない
- 再対応付け対象は元のvalidated PlannerInputの全valid `PlannerConflictResolution`
  とする。今回の再検索対象以外のユーザー明示resolutionを黙って捨てない。全fixed
  constraintが一意に対応できた場合だけ完全なresolution配列を再構築する
- enumeratorは `BuildCandidate` ではなくtransientな `ConstrainedCandidate` を
  yieldする。`BuildCandidate` 形状への変換はB8-Cのdeterministic materializerが行い、
  `searchRunId` はdeterministic constrained search identity、`id` はそれと
  Candidate semantic meaningから安定生成、`createdAt` は `PlannerClock` とする。
  threshold 0.6は `isSimilarToIdeal` の算出だけに使う
- enumeratorの `origin` は過去のUI Candidate Search requestではなく、Planner計算
  開始時のcurrent validated Search / RNG snapshotとする。専用の
  `ConstrainedSearchOrigin` を定義し、UI一時filterと `searchRunId` を持たせない
- constrained re-searchは過去のUI一時filterを継承しない。route scopeは現時点で
  成立する全Routeとし、`resultFilter` / similar filter / `maxCandidatesPerTarget`
  を適用せず、上限は `ConstrainedEnumerationBounds` だけをauthorityとする
- deterministic constrained search identityはTargetWeapon ID、Planner開始時の
  Search / RNG semantic origin、CalculationContext、`ConstrainedEnumerationBounds`、
  route policyから安定生成する
- boundsをenumeration側4つとorchestration側3つへ分離し、Planner専用3 boundsを
  `ConstrainedCandidateSearchInput` へ渡さない
- determinismはsemantic outcomeの一致だけを要求する。`PlannerIdFactory` 由来の
  ProductionPlan ID / PlanStep ID / 予約OwnedWeapon ID、`PlannerClock` 由来の
  `createdAt` / `updatedAt`、および `ExpectedPlanState` のhash完全一致は要求しない。
  run内のexpected-state chain validityは従来どおり必須とする

B8-Aで確定しなかった点。

- enumeration boundsのProduction default(`maxNormalForgeCount` /
  `maxGogmaAdvance` / `maxSkillResetCount` / `maxOffAxisPairEvaluations`)。
  B8-B1ではcaller必須指定とし、B8-B2のenumerator実Browser Worker benchmark後に決定する
  -> **B8-B2で決定済み**(4.5章)。B8-A時点でdefaultを持たなかったことは
  この記録のとおりであり、値は後からB8-B2の実測で決まった
- orchestration boundsのProduction default(`maxCandidateTrialsPerConflict` /
  `maxGeneratedBuildListEntries` / `maxPlannerReruns`)。Planner再実行1回のコストは
  B8-C / B8-Dのorchestration実装が無ければ測定できないため、B8-B2では決めない。
  B8-C / B8-Dはcaller必須指定のまま実装し、B8-Eのbenchmark後に決定する
- constrained enumeratorの具体的な探索スケジューリング(lazy frontier / best-first等)
- `PlannerOrchestrationResult` およびconstrained search API群の最終的な型名

B8-Aで確認した既存実装の問題。

- `createBuildCandidateMeaningFingerprint()`(`src/domain/buildList/buildListEntry.ts`)が
  restoration bonus scopeを含まない。同一ラベル5枠のnormal scope結果とgogma scope結果を
  同一意味とみなすため、B8 semantic identityとしてそのまま使えない。B8実装時に
  scopeを含むauthorityへ修正または統合する(6章9項)
- `createBuildListEntry()` の既定ID生成が `createdAt` を含むため、generated Entryの
  決定的ID生成へそのまま流用できない
- `CandidateSearchInput` は永続化されず、BuildListEntryは `searchStateHash` /
  `referencedOwnedWeaponsHash` しか保持しないため、過去のUI Candidate Search request
  をPlanner / BuildListから復元できない。B8の `origin` をhistorical requestに
  依存させられないことがB8-A final reviewで判明した
- `ExpectedPlanState.ownedWeaponsHash` はOwnedWeapon IDを含み、`reserve_weapon` /
  `create_material_gogma` の予約IDは `PlannerIdFactory` 由来である。したがって
  「予約OwnedWeapon IDの一致は不要」と「expectedState hashの一致は必須」は
  両立しない。B8-A final reviewでdeterminism契約から前者を優先して整理した
- `createInitialPlannerSearchState()` は `ValidatedBuildListEntry[]` を要求し、
  通常Beam Searchは `validatePlannerInput()` の `validBuildListEntries` だけを使う。
  B8 preflightがraw `BuildListEntry` を使うと通常Plannerと乖離するため、
  最終仕様レビューでvalidation authorityを統一した
- `BuildCandidate` は `id` / `searchRunId` / `createdAt` / `isSimilarToIdeal` を
  必須とし、`createCandidateFromPrediction()` は `CandidateSearchInput.searchRunId`
  と `CandidateSearchSettings.similarityThreshold` を使う。`ConstrainedSearchOrigin`
  はこれらを持たないため、enumeratorが `BuildCandidate` を完成できないことが
  最終仕様レビューで判明した。enumerator outputとmaterializationを分離した

B8-A自体はProduction RNG semantics、`PRODUCTION_RNG_ENGINE_VERSION`、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2`、`DATABASE_SCHEMA_VERSION = 1`、
`AppSettings.schemaVersion = 1`、`supportsSeedSearch = false` を変更しない。

### 4.3 B8-B1a implementation checkpoint

**この節はB8-B1a時点の記録である。B8-B1bで解消した暫定事項の最終形は4.4にある。**

B8-B1a時点でのB8-B1b remaining。以下はすべて4.4で実装済みとなった。

```text
- off-axis (Bi, Kj), i>0,j>0 lazy frontier
- maxOffAxisPairEvaluationsの実消費
- deterministic incremental / sequential Candidate delivery
- enumeration完了時のConstrainedEnumerationSummary
- B8-Cが必要Candidate取得後に不要な列挙を続けなくてよいProduction境界
```

sequential delivery契約。B8-Aの最終architectureは
「Candidateをdeterministic semantic orderで順次提示 → Planner orchestrationが
Candidate trial」である。B8-B1aの
`enumerateConstrainedCandidates(): Promise<ConstrainedEnumerationResult>` は
全Candidateを収集・sortしてから返すcollector型であり、これはB8-B1a checkpoint
限定の暫定形とする。**B8-B1完了時の唯一のProduction APIを「全bounded Candidate
を生成し終わるまでcallerが1件も受け取れない」形にしてはならない。** current
array collectorはtest / helperとして残してよい。

具体APIはB8-B1b実装時に選択する。例。

```text
AsyncIterator / AsyncGenerator
または
ordered async visitor/callback + completion summary
```

いずれを選んでも、Search DomainがPlanner conflict DTOやPlanner trial boundを
受け取らない契約は維持する(SEARCH_SPEC 5.6.7、PLANNER_SPEC 9.2.9 / 9.2.16)。

B8-B1aで実装した範囲。

```text
ConstrainedEnumerationBounds / ConstrainedSearchOrigin
ConstrainedCandidateSearchInput / ConstrainedCandidate
ConstrainedEnumerationSummary / ConstrainedEnumerationResult
input validation (既存Domain validatorによるorigin snapshot全体のfail closed)
全legal Route baseの構築
retention前Skill / Bonus depthの再利用
軸Candidate列挙 (Cross規則)
Target条件評価とmetadata算出
deterministic ordering
bounds
cancellation / yield
```

追加ファイル。

```text
src/domain/search/constrained/constrainedTypes.ts
src/domain/search/constrained/constrainedValidation.ts
src/domain/search/constrained/constrainedCandidateFactory.ts
src/domain/search/constrained/constrainedRouteBases.ts
src/domain/search/constrained/constrainedEnumeration.ts
src/domain/search/constrained/index.ts
src/domain/search/routeEligibility.ts
src/domain/search/searchStreamInputs.ts
```

既存streamのrefactorは意味を狭めるだけに留めた。`createTargetSkillStream()` /
`createTargetBonusStream()` は `CandidateSearchInput` ではなく
`SkillStreamInput` / `BonusStreamInput`(semantic RNG input、Master subset、
explicit depth bound)を受け取る。通常Candidate Searchは
`skillStreamInputForSearch()` / `bonusStreamInputForSearch()` 経由で
`CandidateSearchSettings` を渡し続けるため、ダミーのCandidateSearchSettingsを
B8のauthorityに仕立てる必要が無い。Route base可用性の選択は
`routeEligibility.ts` へ抽出し、通常Searchの3 Route searcherと
constrained enumeratorが同一authorityを使う。

retentionを適用しない実装根拠。constrained enumeratorは
`buildSkillSolutionSet()` / `buildBonusSolutionSet()` ではなく、新設した
`evaluateSkillSolutions()` / `evaluateBonusSolutions()` を使う。両者は評価と
5.5.2 / 5.5.3のdeterministic orderingだけを行い、同一結果の最小advance retention
を行わない。Bonus側はstreamが公開するfrontier縮約前のdepth出力をそのまま使うため、
B2のfamily-layout frontier dedupは維持される。

`exhausted` / `stoppedByBound` の扱い。SEARCH_SPEC 5.6.7はこの2 flagを
「区別する」「bound到達をexhaustionとして報告しない」とだけ定めており、
互いの補集合とは規定していない。したがってB8-B1a暫定実装は次とした。

```text
stoppedByBound = enumeration boundが探索を打ち切った
exhausted      = boundによる打ち切りが無く、かつ未評価のCross cellも無い
両方false      = boundには達していないが、B8-B1a未実装の軸外cellが残っている
```

これによりB8-B1aが未カバーの範囲についてexhaustionを主張しない。

未評価cellの判定はO(1)である。B8-B1aはoff-axis cellを列挙も計数もせず、
`hasOffAxisCells(bonusAxisLength, skillAxisLength)` が2軸の長さから
「reachable off-axis cellが1件でも存在するか」だけを返す。full Cartesianの
事前生成禁止(5.6.7)はこの確認処理にも適用される。片方の軸が1件しか無い場合は
off-axis cellが存在しないため、未評価扱いにしない。実際のcell評価と
`maxOffAxisPairEvaluations` の消費はB8-B1bのlazy frontierが行う。

B8-B1b完成後の最終契約は次とする。

```text
reachable off-axis cellが残り、
maxOffAxisPairEvaluationsによって評価を止めた
=> stoppedByBound = true
=> exhausted = false
```

`maxOffAxisPairEvaluations = 0` は引き続きvalidな設定とする。B8-B1b最終実装で
`0` かつreachable off-axis cellが存在する場合は、off-axis bound stopとして
`stoppedByBound = true` / `exhausted = false` を返す。B8-B1aの「両方false」は
軸外評価が未実装である期間限定の暫定状態であり、B8-B1bで解消する。

`maxOffAxisPairEvaluations` の最小値は0とした。0は5.5.4のCross-onlyそのもので
あり、意味のある設定を禁止しないためである。他3 boundsは既存
`validateCandidateSearchSettings()` と同じ最小値1を維持した。Production default
はB8-B2まで定義しない(B8-B2で `defaultConstrainedEnumerationBounds` として決定、
4.5章)。

SEARCH_SPEC 5.6.1のIdeal既達成早期終了は適用したままとした。5.6.7の
「適用しない」列挙(Practical dominance、canonical Ideal終了、初回Practical
horizon、`maxCandidatesPerTarget`、`resultFilter`、similar filter)に5.6.1は
含まれておらず、操作0のstream解はCounter位置を消費しないため固定Candidateと
競合し得ないためである。

origin validation。`ConstrainedSearchOrigin` はPlanner開始時のcurrent validated
snapshotだが、public Search Domain boundary自身もsnapshot全体を再確認する。
`assertConstrainedCandidateSearchInput()` が `validateRngState` /
`validateNormalArtianCounter` / `validateOwnedWeapon` / `validateTargetWeapon` /
`validateCalculationContext` の結果を配列index付きpathで集約し、
`origin.normalCounters[*]` / `origin.ownedWeapons[*]` / `origin.targetWeapons[*]`
を全要素検証する。Ideal ⇒ Practical containmentだけは選択Targetに限定して
`validateTargetIdealImpliesPractical` で確認する。新しいDomain制約は追加せず、
Master DataやDBのvalidationも追加していない。invalid inputではEngine predictionが
1回も実行されない。

既存不整合の修正(B8-B1a review correction 1)。`AGENTS.md` の Existing Gogma
Mixedは「normal scope起点のmixed routeはKeep Bonusesより前にReset Bonusesを行う」
と定めるが、`canKeepBonuses()` は永続OwnedWeaponの
`restorationBonusScope === "gogma_artian"` を要求していたため、normal scope起点の
既存巨戟に対する `reset -> keep` routeがDomain validationで拒否されていた。通常
`searchCandidates()` でも同一に発生する既存挙動であることを実測確認したうえで、
`validateProtectedRouteUse()` にRoute sequenceのroute-local bonus scope追跡を
追加した。

```text
initial scope = source.restorationBonusScope
reset_bonuses -> route-local current scope = gogma_artian
keep_bonuses  -> source unprotected AND current scope == gogma_artian のとき許可
reset_skills  -> scopeを変更しない
```

結果。`normal scope -> Keep` は拒否、`normal scope -> Reset -> Keep` は許可、
`gogma scope -> Keep` は従来どおり許可、protected sourceのReset / Keepは禁止のまま。
`canKeepBonuses(weapon)` の意味は変更せず、新設の
`canKeepBonusesFromScope(weapon, currentScope)` へ委譲するだけとした。したがって
normal scope current bonusesからKeepを**直接**予測する経路は有効化しておらず、
B11(normal-tier Keep family mapping / pool / weightsの実ゲーム検証)を先取りして
いない。今回許可した経路のKeep入力はReset後のgogma-tier 5枠であり、既存Production
Keep prediction supportの範囲内である。通常Candidate Searchとconstrained enumerator
は同じ `validateBuildRoute()` を使うため、両者の結論は一致する。

### 4.4 B8-B1b implementation record

**B8-B1a complete / B8-B1b complete / B8-B1 complete。次PhaseはB8-B2。**
Phase表の `B8-B1` を完了扱いにしてよい。`B8-B2` 以降は未着手のままである。
（B8-B2はその後完了した。4.5章を参照）

B8-B1bで実装した範囲。

```text
軸外(Bi, Kj) i>0,j>0 のlazy frontier
maxOffAxisPairEvaluationsの実消費とglobal cap
deterministic best-first incremental / sequential Candidate delivery
consumerによる正常early stop境界
ConstrainedEnumerationSummaryの最終semantics
```

追加ファイル。

```text
src/domain/search/constrained/constrainedFrontier.ts
src/domain/search/constrained/constrainedFrontier.test.ts
```

B8-B1bはSearch orchestrationの追加だけであり、通常 `searchCandidates()` semantics、
Cross-only初回policy、canonical Ideal終了、Practical horizon / dominance、
stream-local retention、B2 family-layout frontier reduction、normal scope直接Keepの
未対応、Production RNG semantics、Planner semanticsのいずれも変更していない。
B8-B1aで追加した `validateProtectedRouteUse()` のroute-local bonus scope追跡
(`normal scope -> Reset -> Keep` を許可し `normal scope -> Keep` を拒否する)も維持した。

#### Production sequential boundary

Production境界は `visitConstrainedCandidates()` とした。ordered async visitorであり、
AsyncGeneratorは採用しなかった。

```ts
type ConstrainedCandidateDecision = 'continue' | 'stop'

visitConstrainedCandidates(
  input, engine, onCandidate, options
): Promise<ConstrainedEnumerationExecution>
```

- Candidateは発見順に1件ずつ渡す。callerはcallbackの中で任意のasync処理を行える
- callerが `'stop'` を返すと、以降のpair評価・Candidate通知・軸外frontier展開を行わない
- Search Domainはcallbackの中身を知らない。Planner型、Conflict DTO、
  orchestration boundsはこの境界を越えない
- 正常early stopは `ConstrainedEnumerationSummary` の外側の
  `ConstrainedEnumerationExecution.stoppedByConsumer` で報告する。`shouldCancel()` の
  Cancellationとは別物であり、後者は従来どおり `CandidateSearchError('cancelled')` で
  rejectする

`enumerateConstrainedCandidates()` は残したが、Production境界ではなくcollector helper
である。sequential coreを最後までconsumeし、既存 `compareConstrainedCandidates()` で
最終sortして `ConstrainedEnumerationResult` を返す。B8-B1aの外部挙動は維持した。

#### incremental orderとcollector final sortの役割差

incremental deliveryとcollectorの最終sort配列が同一順であることは要求していない。
未展開の軸外cellまで含めたglobal sortを先に確定するには、それらを展開するしかなく、
それは5.6.7が禁止するCartesian走査そのものになるためである。

incremental側へ要求するのは次だけである。

```text
deterministic
semantic
best-first
run非依存
```

#### 軸外frontier

Route base × stream category predicateごとに1つのlattice(matrix)を考え、cell `(i, j)`
を `(B(c)[i], K(c)[j])` とする。full Cartesianは生成しない。

```text
seed        各matrixの (0,0) のみ
展開        pop済みcellから (i+1, j) と (i, j+1) だけをenqueue
frontier    compareConstrainedWorkItems によるbinary heap
visited     matrix + local座標のnodeKey集合
```

`bonusAxis.flatMap(...)` のような全cell生成、全pairの事前登録、固定diagonal bandは
行わない。live frontierとvisited集合のサイズは `O(seed数 + pop済みcell数)` であり、
`|B| x |K|` に比例するデータ構造は存在しない。軸外cellは既に解いたstream位置解を
そのまま組み合わせるだけなので、Engine prediction回数は軸のみの場合と変わらない。

lattice上の任意のcell `(i, j)` は `(i,0) -> (i,1) -> ... -> (i,j)` という単調経路で
到達可能なので、capで拒否したcellを展開しないことによって到達不能になるcellは無い。
拒否したcellの子孫はすべて軸外であり、capが空くことはないため評価対象にもならない。

既存 `SearchWorkQueue` は流用しなかった。tie-breakにinsertion sequenceを使っており
5.6.7が禁止するrun依存tie-breakになること、および二次元latticeが満たさない
monotone operation lower boundを強制することが理由である。

#### work-item ordering

priorityはEngineを呼ばずに、Route baseと既に解けた2つのstream解から算出する。

```text
 1 Candidate category (両streamがIdeal一致なら0、それ以外1)
 2 estimated operation count (base単位数 + Bonus操作数 + Skill操作数)
 3 Gogma advance
 4 Skill advance
 5 Normal advance
 6 Ideal closeness (matchedIdealBonusCount + skill idealCloseness)
 7 Bonus material quantity (数値として比較)
 8 Bonus multiset key
 9 Bonus operation type key
10 Bonus scope
11 Skill semantic key
12 stable semantic key (baseKeyを含む)
13 軸上 -> 軸外
14 category predicate
15 i, j, matrix index
```

1-6は既存 `compareCandidateSelection()` / 8の優先順位と整合する。
7-10は `compareBonusSolutions()`(5.5.3)のキー3-6、11は `compareSkillSolutions()`(5.5.2)
のキー3と同じ意味・同じ順序である。12のstable keyは `baseKey` + Bonus解のretentionKey /
operationTypeKey / gogmaAdvance / lastResetDepth + Skill解のsemanticKey / resetCountから
作る。random UUID、Clock、Candidate ID、Map挿入順、Promise完了順、enumeration ordinalは
一切使わない。数値量を文字列へ畳んで辞書順比較にしない。

13-15は「同一actual pairを指す別matrixのfrontier node」だけを分離するためのもので、
配信されるCandidate列には影響しない。13を入れているのは、ある実pairが片方のmatrixでは
軸上・他方では軸外に現れる場合に、必ず軸上として評価させて軸外budgetを消費させない
ためである。

`maxOffAxisPairEvaluations` が十分大きい場合、遠い軸上Candidateより近い軸外Candidateが
先に配信される。「全軸を吐き切ってから軸外へ移る」実装にはしていない。

#### 1-seed lazy latticeがbest-firstになる根拠

「binary heapを使っているからbest-first」ではない。各matrixを `(0,0)` だけでseedし、
pop済みcellから右と下だけを公開する構造では、work comparatorが各座標方向へ
**coordinate-wise monotone**でなければ、より高優先のcellがfrontierへ現れないまま
低優先のcellをpopしてしまう。consumerの早期停止や小さい軸外capでは、それがそのまま
誤ったCandidate選択になる。

したがってwork comparatorは、各軸のcanonical stream orderingと一致させる。

```text
Bonus軸 (i -> i+1)
  childは compareBonusSolutions() 順の次の解
  key1 gogmaAdvance          -> priority 2 / 3
  key2 matchedIdealBonusCount-> priority 6 (Skill側固定なら同値)
  key3 materialQuantity      -> priority 7
  key4 bonusKey              -> priority 8
  key5 operationTypeKey      -> priority 9
  key6 scope                 -> priority 10

Skill軸 (j -> j+1)
  childは compareSkillSolutions() 順の次の解
  key1 resetCount            -> priority 2 / 4
  key2 idealCloseness desc   -> priority 6 (Bonus側固定なら同値)
  key3 semanticKey           -> priority 11
  Bonus側fieldはすべて同値
```

親と子が最初に食い違うfieldで必ず親が先になるため、両方向へmonotoneである。

B8-B1bの初版はpriority 7-11を持たず、6の直後に12のstable keyへ落ちていた。stable keyの
Bonus部分はscope + 完成multisetであり、canonical順の `materialQuantity` を見ないため、
同depth・同matched countで素材の多い後方解が親より高優先になり得た。独立レビューが
この非単調性を指摘し、7-11を追加して解消した。

唯一、priority 1 `categoryRank` だけは後方で改善し得る。`categoryRank` は
`bonus.idealMatch && skill.idealMatch` なので、Practical matrixでは**両軸とも**
rank 1 -> 0 の改善が起こり得る。

```text
Bonus軸  fixed SkillがIdealで、後方のBonus解がPractical-only -> Idealになる場合
Skill軸  fixed BonusがIdealで、後方のSkill解がPractical-only -> Idealになる場合
```

安全性の理由は両軸で共通である。rank 0になるactual pairはBonus解とSkill解の両方が
Idealを満たす場合だけであり、そのactual pairは同一baseのIdeal matrixにも存在する。
Ideal matrixは両axisがIdeal解のみで構成されるためcategoryRankは常に0であり、
rank 1のcellより先にmatrix全体がpopされる。したがってPractical matrix側のrank改善node
はCandidate意味として新しいhidden high-priority Candidateではなく、Ideal matrix側でも
到達する同一actual pairであり、到達時点では評価済みduplicateである。

#### maxOffAxisPairEvaluationsのcount / stop semantics

- Target enumeration全体でglobalに消費する。Route baseごと・categoryごとにresetしない
- unique actual軸外pairをTarget評価した回数を数える。Ideal / Practical / 条件未達 /
  semantic duplicateのいずれになっても、評価したなら1消費する
- Ideal matrixとPractical matrixが同じactual pairを指す場合、評価は1回だけであり、
  `examinedCandidates` も `evaluatedOffAxisPairs` も二重に増えない。重複側のfrontier
  nodeは評価をskipしても隣接cellの展開だけは行う
- 軸上pairは消費しない
- `0` は引き続きvalidであり、5.5.4のCross-onlyそのものである。この場合軸外は1件も
  評価せず、`evaluatedOffAxisPairs = 0` のまま、軸のCandidateは最後まで列挙する
- capに到達したあとに未評価のreachable軸外cellが残った場合だけ、軸外を理由とする
  bound stopとして扱う。ちょうど最後のreachable cellをcapが賄った場合は
  truncateではない。未評価cellの有無はfrontier状態から判定しており、
  Cartesian全走査は行わない

現行v1では、軸外cellが存在する状況は「Bonus streamとSkill streamの両方を探索した」
状況に限られ、両streamは探索すると必ず自分のboundまで進む。したがって
`summary.stoppedByBound` を軸外capだけに帰属させて観測できるケースは実質存在しない。
実装は軸外capによる拒否が実際に起きたときだけ軸外flagを立てており、テストは
`evaluatedOffAxisPairs` と配信Candidate集合でcap境界を固定している。

#### summary最終semantics

B8-B1aの暫定状態(「boundには達していないが軸外未実装」の両方false)は廃止した。

```text
自然完走かつどのboundにもtruncateされていない
  exhausted = true / stoppedByBound = false

Normal / Gogma / Skill / 軸外のいずれかがreachable workをtruncate
  exhausted = false / stoppedByBound = true

consumerによる正常early stop
  exhausted = false / stoppedByBound は実際にtruncateされた場合のみtrue
  stoppedByConsumer = true (summary外)
```

`hasOffAxisCells()` はB8-B1a限定のO(1) proxyだったため削除した。実際のlazy frontierが
未評価cellの有無を直接扱うようになり、役目が無くなったためである。

#### Candidate semantic dedup

Candidate通知は `constrainedCandidateStableKey()` で重複排除し、同一semantic Candidate
を2回渡さない。同じ完成結果でもCounter位置が違えばconcrete operationsが違い、stable key
も異なるため両方残る。これは初回Searchのretentionではない。

#### テスト観点として構成できなかった項目

「軸だけではTargetを満たさず (B1,K1) だけがPracticalになる」形のテストは、v1の
Domain上構成できない。Practical判定はBonus streamとSkill streamで独立に評価され、
`B(practical)` / `K(practical)` は各streamのPractical条件を満たす解だけを含む。
したがって `(B1, K1)` がPracticalなら `(B0, K1)` と `(B1, K0)` も必ずPracticalになる。
Idealについても、Ideal matrixのanchor `(0,0)` が該当pairそのものになるため、
「軸外でしかIdealに到達できない」状況は生じない。

軸外が実際に増やすのは「Cross規則が合成しない別のPractical組み合わせ」であり、
Plannerが固定Candidateとの共存を探すときに必要になるのはこの部分である。そのため
テストは次を固定した。

```text
軸のみでは到達しないpairが cap >= 1 で配信される
cap = 0 では軸外0件・軸Candidateは維持・bound stop
cap = N < reachable では evaluatedOffAxisPairs = N かつ残りが未評価
cap = reachable ちょうどでは cap を上げても結果が変わらない
Ideal / Practical双方に現れる同一pairは評価1回・count1回・配信1回
```

---

### 4.5 B8-B2 benchmark record

**B8-B2 complete。次PhaseはB8-C。**
実測記録は
[B8_CONSTRAINED_ENUMERATION_BROWSER_WORKER_BENCHMARK.md](./B8_CONSTRAINED_ENUMERATION_BROWSER_WORKER_BENCHMARK.md)
にある。ここには設計判断だけを残す。

B8-B2は計測タスクである。B8-B1のenumerator algorithm、`visitConstrainedCandidates()`、
lazy off-axis frontier、global `maxOffAxisPairEvaluations`、consumer early stop、
`ConstrainedEnumerationSummary`、deterministic incremental deliveryを変更していない。
Production Worker protocol、Persistence、UI、Production RNG semanticsも変更していない。
Production側の追加は `defaultConstrainedEnumerationBounds` 定数1つだけである。

benchmark harnessの計測基点は `visitConstrainedCandidates()` の直前であり、
fixture生成 / Master load / 合成所持武器のProduction predictionは計測に含めない。

harnessは2モードを持つ。**性能判断はtiming modeの直接計測のみを使う。**

```text
timing mode  最小recorder。delivered / ideal・practical count / routeKinds /
             1・10・50件目timestampだけを記録する。
             parity instrumentation（constrainedCandidateStableKey()の再生成、
             digest生成、Candidate列保持）は行わない。
             Worker wall timeを補正なしでenumerationのコストとして扱う。
parity mode  determinism確認専用。ordered rolling digestと固定長per-key digestを
             作るため、そのコストがwall timeに乗る（実測で最大8割）。
             この時間を性能値として読まない。
```

parity recorderはstable key全文を保持せず、1回の文字走査でordered rolling digestへ
foldし、固定長24文字のper-key digestだけを残す。したがってharnessの保持量は
`O(配信Candidate数)` の固定幅であり、`O(stable key総文字数)` ではない。

決定したenumeration defaults。

```text
maxNormalForgeCount       40
maxGogmaAdvance           30
maxSkillResetCount       100
maxOffAxisPairEvaluations 500
```

選定は、全Route baseで両streamがactiveでIdealが近傍に無いcombined workloadの
timing mode直接計測のみに基づく。single-axis値の合算では決めていない。
full bounded enumeration中央値1782.0 ms、time to first Candidate中央値331.6 ms、
consumer stop 50件で354.6 ms。

2秒枠の前後を挟むまで近傍tupleを実測したうえで、共有streamを優先して配分した。

```text
off-axis   100 -> 500   +26 ms      （1659.2 -> 1685.0 ms、ほぼ無償）
Skill      100 -> 250   3.2x        （単独sweep）
Gogma       10 -> 200   285x        （単独sweep、最も急峻）
```

Gogmaは最も高価な軸である。Normalを譲ってGogmaを25から30へ引き上げた。
補助的な理由として、Gogma CounterはPlanner競合が起きる共有resourceであり、
Normal Counterは武器種ごとに独立という既存Plannerの事実がある。

Gogma 35の `30/35/100/500` も2秒枠内だが、採用しなかった理由は実測値である。

```text
40/30/100/500   1782.0 ms   2秒枠への余裕 約218 ms   20,306件
30/35/100/500   1899.0 ms   2秒枠への余裕 約101 ms   20,178件
```

このfixtureでは40/30の方が速く、Candidate数もわずかに多い。session / machine
variabilityを考え、2秒ぎりぎりではなく余裕を残す方を採った。
**B8-B2は探索品質そのものを測定していないため、特定のNormal値を実用最低ラインと
して扱わない。**

`ConstrainedCandidateSearchInput.bounds` はcaller必須のままである。この定数は
B8-C以降のProduction callerが明示的に渡す値であり、enumeratorが適用するfallbackでは
ない。orchestration boundsのdefaultはB8-Eで決める。

B8-Cが引き継ぐべき観測。

- 1 Targetのenumerationコストは、採用defaultで全件1782 ms、
  最初の数件で打ち切るなら約347〜355 ms（いずれもtiming modeの直接計測）。
  差の大半はupfront stream solveではなくtraversal分であり、
  trialを打ち切る設計なら実効コストは後者になる
- 性能を測り直す場合はtiming modeを使うこと。parity modeのwall timeは
  parity instrumentationのコストを含み、workloadによってはその8割に達する
- time to first Candidateはupfront raw stream solveが支配する。
  Candidate 1件目と50件目の差はどのworkloadでも数msしかない
- `exhausted` / `stoppedByBound` / `stoppedByConsumer` は排他ではない。
  bound到達はtraversal前のbase構築 / stream solveで確定するため、
  consumer stopしたrunでも `stoppedByBound = true` になりうる
- off-axis budgetが足りたかは、単一の値からは判定できない。`stoppedByBound` は
  Gogma / Skill boundでも `true` になるため使えず、`evaluatedOffAxisPairs` と
  budgetの比較だけでも足りない

  ```text
  full traversal && evaluatedOffAxisPairs < maxOffAxisPairEvaluations
    => off-axis capはbindingではなかった
  evaluatedOffAxisPairs == maxOffAxisPairEvaluations
    => reachableがちょうどcapか、capでtruncateしたかを区別できない
  consumer stop
    => evaluatedOffAxisPairsだけからoff-axis exhaustion / sufficiencyを
       判断してはいけない
  ```

  実測ではbudgetを変えて再測定し、`evaluatedOffAxisPairs` と配信Candidate集合が
  動かなくなる点（`G/S = 10/10` で470件）を見つけて初めて飽和と判定できた。
  B8-B2では `ConstrainedEnumerationSummary` 型もenumerator semanticsも変更していない。
  B8-Cがこの区別を要するなら、そのPhaseで設計判断すること

---

## 5. B1 / B2に残る設計判断

以下はB0で決めきらず、実装時にコードを見て決める。
Domain契約を変える判断が必要になった場合は、実装前に設計チャットへ戻す。

1. ~~共有Skill列の保持場所。~~ B1で決定済み。専用モジュール
   `src/domain/search/skillStream.ts` へ切り出し、`searchTarget()` が生成して
   `RouteSearchContext.skillStream` で渡す
2. ~~共有Bonus解集合(conversion後 `depth >= 1`)のキャッシュ境界。~~
   B2で決定済み。Target単位の `TargetBonusStream` が保持し、解集合キャッシュは
   normal scope起点を `(startGogmaCounter)`、gogma scope起点を
   `(startGogmaCounter, 順序付き5枠)` で分ける。Prediction memoはReset が
   Gogma Counter位置単位、Keepが `(位置, family layout)` 単位
3. `evaluateTargetCandidate` を分解版へ置換するか、既存APIを残して
   分解結果との一致をテストで固定するか。後者を推奨する
4. ~~frontier stateから操作列を除いた後、候補確定時に
   `(lastResetDepth, depth)` から `RouteOperation[]` を再構成する具体形。~~
   B2で決定済み。`bonusAmendmentOperations(set, solution, sourceOwnedWeaponId)` が
   `steps[0 ... depth - 1]` を走査し、`depth <= lastResetDepth` をReset、
   以降をKeepとして再構成する。Counterは解集合の `steps` が持つ
   `engine.advanceGogmaCounter()` 由来の値を使う
5. ~~`searchExecution.ts` のcheckpoint / yield間隔を件数ベースから経過時間ベースへ
   変えるかどうか。~~ B5で決定済み。件数ベース(50回ごと)のまま変更しない。
   yield間のsynchronous区間は実測で最大20〜50 ms、cancel到達も数ms〜十数msであり、
   経過時間ベースへ変える必要を示す測定結果が出なかった。変更したのは
   `search.worker.ts` の `workerYield()` の手段だけである
6. `candidateSearch.integration.test.ts` の
   「bounds amendment frontier growth」fixtureを、depthごとに異なるReset結果を返す形へ
   強化する範囲
7. canonical Ideal終了をbest-firstで実装するか、暫定最良の総操作数を上界とする
   branch-and-boundで実装するか。どちらでもよいが、Route base横断の下界計算が必要。
   いずれの場合も操作数 `D` 以下のPractical評価を完了してから終了する必要がある。
   best-firstで操作数昇順に走査すればhorizonは自動的に満たされる。
   branch-and-boundなら上界 `D` の枝刈りを維持したまま `D` 以下の枝を走査し切る
7.1. `candidateStableKey` を `BuildCandidate` へ持たせるか、比較時に都度算出するか。
   `BuildCandidate.id` の生成規則(`searchRunId` を含む `semanticHash`)は変更しない
   方針だが、canonical ordering専用の安定キーをどこで持つかはB4の判断
8. 非劣位Practical集合の保持データ構造。5.5.6の10条件は比較コストが高いため、
   Bonus multiset / Skill / source によるバケット分割が必要かどうか
9. `maxCandidatesPerTarget` 到達時のIdeal枠確保を、保持段で行うか出力段で行うか
10. ~~Target validation(B7)を既存の保存済みTargetへどう適用するか。~~
    B7で決定済み。保存時に拒否し、加えてCandidate Searchの対象Target選択時に
    warning付きで除外する。既存保存Targetの自動修正・自動削除・Practical条件の
    暗黙緩和は行わない

## 6. 別Issueとして記録した事項

1. 新規Normal → Gogma RouteがNormal Counter確定を必須にしている
2. ~~`no_owned_weapon_available` の日本語表示が所持通常アーティアRouteでも「所持巨戟」になる~~
   B6で「条件に合う所持武器がありません」へ汎用化。武器種はRouteKind labelが示す
3. ~~Candidate Search default `5000 / 5000 / 5000` の適正値~~
   B6で `1000 / 200 / 1000` へ変更。B5実測(Normal 1000 ≈ 256 ms、Skill 1000 ≈ 325 ms、
   Gogma 200 ≈ 1961 ms)が根拠。上限機能は削除しておらず詳細設定で引き上げ可能
4. Normal Counter Identification
5. Normal Bonus familyを利用した将来探索(7章)
6. ~~Searchのより詳細な進捗表示~~
   B6で Target開始 / Target内activity / Target完了 の3点へ拡張。
   `CandidateSearchProgress` に `phase` と `processedWorkItems` を追加した。
   Target内の総work量は探索中に増えるため、推定percentは作らない
7. ~~Worker error handlingの見直し~~
   B6で native `error` / `messageerror` をfail closedとして自動検知。
   pending全rejectとterminateを行い、壊れたWorkerを再利用しない。
   Worker自動再生成とページ自動reloadはv1では実装しない
8. ~~Candidate出力順のrun依存(B5で判明。保持集合とcanonical Idealはrun非依存)。~~
   B6では未修正。**B6-F1で解決済み**。`compareCandidates()` と
   `compareDuplicateCandidates()` の最終tie-breakを `candidateStableKey` へ変更した。
   `BuildCandidate.id` の生成規則は変更していない
9. Ideal分類が `restorationBonusScope` を評価していない(B5で判明。SEARCH_SPEC 5.1
   との矛盾。独立したSearch correctness task **B5-F1で解決済み**。B6には含めない)
10. `createBuildCandidateMeaningFingerprint()` がrestoration bonus scopeを含まない
    (B8-Aで判明)。B5-F1で修正したのはSearch側のIdeal判定と stream retention identityで
    あり、BuildList側のsemantic fingerprintは対象外だった。現状は
    `isSameBuildListCandidate()` の重複判定で、同一ラベル5枠のnormal scope Candidateと
    gogma scope Candidateを同一とみなす。B8実装時にscopeを含むauthorityへ修正または
    統合する(`docs/PLANNER_SPEC.md` 9.2.12)
11. `createBuildListEntry()` の既定Entry ID生成が `createdAt` を含むため、
    Planner-generated Entryの決定的ID生成へそのまま流用できない(B8-Aで判明)

---

## 7. 将来のNormal Bonus family活用戦略

v1実装対象外。将来設計候補としてのみ記録する。

### Strategy A: Normal Bonus familyを活かす

```text
Target idealのfamily layoutに一致する将来Normal位置 j を探索
  -> j まで通常アーティアをforge
  -> 最後の1本を巨戟化 (Skill +1, Gogma +0, 5枠はnormal scopeのまま)
  -> Keep Bonusesを繰り返し、familyを保持したままtierを目標へ寄せる
```

前提条件。

- Normal Counterの特定手段。現在のIdentification WizardはSkill / Gogmaだけを扱う
- normal-tier BonusからKeepした場合のProduction RNG prediction semanticsが
  game-verifiedであること。Keepできること自体は確定済みで検証対象ではない(2.5参照)
- normal tier枠からGogma familyへの写像

Normal予測列に対してfamily layoutでフィルタすれば
`O(maxNormalAdvance)` で候補位置が求まる。Gogma探索とのネストは不要である。

### Strategy B: Resetから開始

```text
通常アーティアを1本forge -> 巨戟化 -> Reset Bonuses -> Gogma streamから目標を探索
```

有利なNormal familyが近傍に無い場合の既定路であり、現在唯一実装されている経路である。

### 比較軸

`forgeCount` / Gogma Reset回数 / Keep回数 / Skill Reset回数 / 素材必要量 / 総操作数。
既存の標準ソートは操作数 -> Gogma -> Skill -> Normalの順で比較するため、
A / Bの比較はそのソートへ載せられる。

Strategy Aの価値はGogma Counter消費をNormal forgeへ振り替えられる点にあり、
複数TargetがGogma streamを奪い合うPlanner局面で効く。
