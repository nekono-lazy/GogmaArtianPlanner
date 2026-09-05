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
この方針と矛盾するため廃止対象とする。この誤表現の廃止は
RNG semantics検証の完了を待つ必要がなく、UI / skip reasonの是正だけで先行できる。

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

conflict contextは概念契約のみを定義し、新しいTypeScript型を追加しない。
what-if比較(一方を固定した場合の他方の次のPractical / Idealまでの距離)は
将来Planner契約として記録し、v1では実装しない。

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
                                   -> B8 -> B9 / B10

B11 は実ゲーム観測を前提とする独立系列
```

| # | タスク | 内容 | 依存 |
| --- | --- | --- | --- |
| B0 | 仕様確定 | 本記録と `AGENTS.md` / `docs/*` の契約更新 | 完了 |
| B7 | Target Ideal ⇒ Practical validation | `docs/DATA_MODEL.md` 8.1 の包含不変条件をTargetWeapon validationへ実装。既存保存Targetの扱いを含む | 完了 |
| B1 | Existing Gogma Skill stream独立化 | 共有Skill列、Ideal既達成時の0回化、`maxSkillAdvance` off-by-one整合、SEARCH_SPEC 6.5前提の早期判定。Gogma側は触らない | B0, **B7**。完了 |
| B2 | Gogma Reset / Keep探索のstate search化 | depthごとReset 1回、family layout dedup、frontierから操作列を除去、Keep-only先行路、決定的representative | B1。完了 |
| B3 | Candidate生成 / route表現の整理 | Cross規則、stream-local anchor ordering、offset / source重複除去、分解評価と既存Target評価器の一致担保 | B1, B2 |
| B4 | 初回Search終了条件とPractical保持 | canonical Ideal終了、`candidateStableKey` によるrun非依存tie-break、操作数D以下のPractical horizon、branch-and-bound / best-first、非劣位Practical列挙、保守的dominance、`maxCandidatesPerTarget` のIdeal枠確保 | B3, **B7** |
| B5 | 実Browser Worker性能検証 | C5-E2C8と同形式の実測。checkpoint yield間隔の見直しを含む | B4 |
| B6 | UI / default / labels修正 | default値、進捗表示粒度、`no_owned_weapon_available` 文言、`normal_scope_requires_reset` の誤表現是正 | B5 |
| B8 | Planner-driven constrained re-search | conflict context DTO、制約付き再検索orchestration、Counter位置だけで除外しない判定、初回Search pruning全般を永久除外にしない保証 | B4, 既存Planner |
| B9 | what-if比較 | 一方固定時の他方の次のPractical / Idealまでの距離算出と提示 | B8 |
| B10 | 競合UI | 競合候補の除外 / 選択不可表示と理由提示 | B8 |
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
| Planner-driven constrained re-search | B8 |
| conflict context DTO | B8 |
| 初回Search pruning全般を永久除外にしない保証 | B8 |
| canonical Idealのrun非依存tie-break (`candidateStableKey`) | B4 |
| Practical保持のdeterministic horizon | B4 |
| what-if検索 | B9 |
| UI競合表示 | B10 |
| default値変更 | B6 |
| Search progress改善 | B6 |
| normal-scope Keep prediction | B11 |
| Worker error handling | B5 / B6 で実測後に判断 |

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
5. `searchExecution.ts` のcheckpoint / yield間隔を件数ベースから経過時間ベースへ
   変えるかどうか。B5の実測後に決める
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
2. `no_owned_weapon_available` の日本語表示が所持通常アーティアRouteでも「所持巨戟」になる(B6)
3. Candidate Search default `5000 / 5000 / 5000` の適正値(B5の実測後にB6で決定)
4. Normal Counter Identification
5. Normal Bonus familyを利用した将来探索(7章)
6. Searchのより詳細な進捗表示(B6)
7. Worker error handlingの見直し(B5 / B6で実測後に判断)

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
