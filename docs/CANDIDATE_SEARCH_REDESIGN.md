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
B8では実装しない。B9-A2でwhat-if比較の正式契約を確定した(4.17)。契約本文は
`docs/PLANNER_SPEC.md` 9.2.4.1〜9.2.4.13にある。距離の算出とWorker / Application APIが
B9、競合UIとwhat-if距離の表示がB10である。

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
                                                                           -> B9-A -> B9-A2
                                                                                -> B9-B1 -> B9-C -> B9-B2
                                                                                                -> B10-A
                                                                                                     -> B10-B -> B10-C -> B10-D

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
| B8-D | Worker / Application / Persistence | atomic save、既存UIへの最小配線 | B8-C。**完了**。B8-D1 Worker境界 / B8-D2a atomic save / B8-D2b BuildListPage配線（4.12 / 4.13 / 4.16章） |
| B8-E | orchestration Browser / Planner benchmark | orchestration boundsのProduction default決定 | B8-D。**完了**。B8-E1 harness / B8-E2a real Browser measurement / B8-E2b default決定 `2 / 1 / 4`（4.15章、`B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md` 10-11章） |
| B9 | what-if比較の算出 | 一方固定時の他方の次のPractical / Idealまでの距離算出。Domain計算、`PlannerWhatIfBounds`、Worker protocol / routing、Production Worker adapter、`PlannerWorkerClient` API、benchmarkとProduction default決定。表示は含まない | B8-E。B9-A / B9-B1 / B9-C / B9-B2 **完了**（4.17〜4.22章、`PLANNER_SPEC.md` 9.2.4.1〜9.2.4.13）。Production what-if defaultは独立実測で **2 / 8** に確定 |
| B10 | 競合UI / what-if提示 | persisted Plan表示、current PlannerInput構築、Worker-side interaction preparation、participant / current Conflict availability、Conflict選択、what-if比較、B8再計算とfail-closed atomic保存 | B8-E, B9。B10-A契約確定は**完了**、B10-B〜D実装は未完了（4.23章） |
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
| what-if検索 | B9-A2(仕様) / B9-B1・B9-C・B9-B2(実装) |
| UI競合表示 / what-if距離の表示 | B10 |
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
  -> **B8-E2bで決定済み**(4.15章、`2 / 1 / 4`)。B8-A時点でdefaultを持たなかったことは
  この記録のとおりであり、値は後からB8-E2aの実測で決まった
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

### 4.6 B8-C1 implementation record

**B8-C1 complete。B8-C全体はまだ未完である。次subtaskはB8-C2(4.7で完了)。**

B8-C1はbehavior-preserving refactorである。B8 constrained re-search orchestrationは
実装していない。

`runPlannerBeamSearch()` に埋め込まれていた初期競合検出経路を、shared pure helper
`preparePlannerInitialContext()`(`src/domain/planner/plannerInitialContext.ts`)へ抽出した。
`PLANNER_SPEC.md` 9.2.3.1「二重実装の禁止」が要求する共有authorityがこれにあたる。

helperが1箇所で生成するもの。

```text
validatePlannerInput
validation.validBuildListEntries / excludedBuildListEntries / validConflictResolutions
createInitialPlannerSearchState + searchable Entryへのprune
createPlannerRouteUnitPlans と route plan rejection
allSearchEntries / entriesById / allUnitPlans / routeUnitCountByEntryId
enabled Targetのstable sortとtargetsById
initial relevant entries / initial relevant unit plans
detectPlannerConflicts による initial PlanConflict 検出
```

`entryIsRelevantForState()` は `src/domain/planner/plannerEntryRelevance.ts` へ移し、
初期選択とBeam Search動的stateの双方が同じ関数を使う。B8だけの別relevance判定は作らない。

通常 `runPlannerBeamSearch()` 自身がこのhelperを使用する。旧経路は残していない。
validation失敗と初期State失敗は `status: 'invalid'` の discriminated union で返し、
`PlannerBeamSearchResult` の意味は変更していない。

helperはPlanner Domain内のpure calculationであり、Persistence / Worker / React /
Clock / random UUID へアクセスしない。既存validationとRoute unit plan生成が必要とする
`PlannerDependencies.rngEngine` だけを受け取る。

変更していないもの。

```text
validatePlannerInput semantics / staleness / CalculationContext / prediction support
entry relevance semantics
Route unit plan生成 と rejectionの内容・順序・dedup
detectPlannerConflicts / physical action identity / shareability
PlannerConflictResolution適用規則 と PlanConflict.id 生成規則
Beam scoring / ordering / dedup / beamWidth / maxPlanSteps / maxExpandedStates
Trace semantics
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
defaultConstrainedEnumerationBounds
```

`createBuildCandidateMeaningFingerprint()` のrestoration bonus scope不足(6章の10)は
B8-C1では扱わず、B8-C2で対応した(4.7)。

### 4.7 B8-C2 implementation record

**B8-C1 complete。B8-C2 complete。B8-C全体はまだ未完である。次subtaskはB8-C3(前半のB8-C3aは4.8で完了)。**

B8-C2はDomain基盤タスクである。Planner conflict orchestration、constrained
enumeratorの呼出し、Candidate trial loop、Beam Search再実行、
`PlannerOrchestrationResult`、orchestration boundsはいずれも実装していない。

#### scope-aware Candidate semantic fingerprint

`createBuildCandidateMeaningFingerprint()` へ `restorationBonusScope` を追加した
(`PLANNER_SPEC.md` 9.2.12、6章の10)。同一ラベル5枠のnormal scope結果とgogma scope
結果は、これで別意味になる。5枠は従来どおりslot順非依存のmultisetであり、
`route.operations` の順序はsemanticのまま変更していない。引数型だけを
`BuildCandidateMeaning` へ広げ、`BuildCandidate` と `ConstrainedCandidate` 由来の
materialize前semanticの双方が同じ1つのauthorityを通るようにした。fingerprintの
run / presentation非包含(Candidate ID、`searchRunId`、`createdAt`、category、
similarity、`idealDifference.summary`、estimate、`requiredMaterials`)は変更していない。

通常 `createBuildListEntry()` の既定ID規則(fingerprint + `createdAt`)自体は変更して
いない。既存の永続Entryは保持しているIDをそのまま使い続ける。

#### deterministic constrained search identity

`src/domain/planner/constrained/constrainedSearchIdentity.ts` に
`createConstrainedSearchIdentity()` を実装した。構成要素は
`PLANNER_SPEC.md` 9.2.13どおりである。

```text
TargetWeapon ID
正規化したPlanner開始時Search / RNG origin
CalculationContext
ConstrainedEnumerationBounds
route policy token
```

route policy tokenは `CONSTRAINED_ROUTE_POLICY_VERSION = 'b8-constrained-route-policy:v1'`
で、`SEARCH_SPEC.md` 5.6.7のroute policy(全legal route / filter非適用 / 上限は
`ConstrainedEnumerationBounds` のみ / B8-B1 lazy off-axis)を1つの安定tokenとして表す。
`PRODUCTION_RNG_ENGINE_VERSION` とは無関係であり、変更していない。

origin semantic正規化の方針。

```text
含む : Base Seed / Gogma Counter / Skill Counter の value と isConfirmed
       Targetの武器種のrarity 8 Normal Counter (value と isConfirmed)
       Route sourceになり得る所持武器のsemantic
       Target定義hash
除く : legacy counterGate、KnownValue.source、notes、観測timestamp
       他Target、Route sourceになり得ない所持武器、無関係なNormal Counter
       SearchMasterSubset本体
```

Route sourceになり得る所持武器の判定には、B8-B1 enumeratorがRoute baseを組む際の
authorityと同じ選択子を使い、B8専用のeligibility規則を作っていない。

```text
Normal : selectConvertibleOwnedNormalArtianWeapons()
Gogma  : selectCompatibleOwnedGogmaWeapons()
```

protectedなOwned Normalは自動conversion Routeのsourceにならないため、identityにも
含めない。Owned Gogmaは `existing_gogma_reset_skills` がprotectedでも使えるので
protected込みで対象とし、protection状態は正規化semanticの一部として反映される。
武器1件のsemanticは
`referencedOwnedWeaponsHash` のauthorityである `normalizeReferencedOwnedWeapon()` を
export して再利用した。`normalizeKnownValue()` も同様にexportした。どちらも中身は
変更していない。

Master subset本体をhashしない理由は、Master identityの権威が
`CalculationContext.masterDataVersion` だからである。subsetの組み立て方でidentityが
変わることを避けている。set的collectionはIDでstable sortし、slot順がsemanticな
5枠は並べ替えていない。

#### deterministic materializer

`src/domain/planner/constrained/constrainedMaterializer.ts` の
`createConstrainedMaterializer()` が `ConstrainedCandidate` を `BuildCandidate` 形状へ
変換する。Search semanticsは再計算せず、category、5枠とscope、Skills、Route、
estimate群、`requiredMaterials`、`idealDifference`、`similarityScore`、両hash、
`CalculationContext` をそのまま引き継ぐ。追加するのはSearch Domain側が意図的に
作れない値だけである。

```text
searchRunId = deterministic constrained search identity
id          = identity + Candidate semantic meaning から安定生成
              candidate.constrained.<hash>
createdAt   = PlannerClock
isSimilarToIdeal = 既存 isSimilarToIdeal() authority に threshold 0.6 を適用
```

`0.6` は `defaultCandidateSearchSettings.similarityThreshold` から読むが、用途は表示
metadata `isSimilarToIdeal` だけである。yield可否、category、enumeration order、
route scope、探索終了、探索範囲、off-axis評価、Planner coexistence、Entry reuse、
ID生成のいずれにも使っていない。`CandidateSearchSettings` はこの境界のfilter
authorityでもextent authorityでもない。

`createdAt` はID・semantic ordering・hashのどこにも入らない。Clockだけを変えて
materializeすると、Candidate ID / `searchRunId` / generated Entry IDは一致し、
`createdAt` だけが変わる。`materializeBuildListEntry()` は `clock.now()` を1回だけ
呼び、CandidateとEntryでその1つの値を共有する。Clock呼出し回数はsemantic identityへ
影響しない。

完成した `BuildCandidate` は既存 `validateBuildCandidate()` を通す。Target不一致・
validation失敗・deterministic ID衝突は `ConstrainedMaterializationError` の
`target_mismatch` / `invalid_candidate` / `generated_entry_id_collision` として
fail closedする。callerはmessage文字列ではなく `code` を見る。

通常Candidate Search側は変更していない。`createCandidateFromPrediction()` の
`semanticHash` / ID生成規則、`SearchExecutionContext.createCandidateId()`、
`searchRunId` 契約、candidate ordering、`CandidateSearchSettings`、Search既定値は
そのままである。constrained materializerはこれらを流用していない。

#### generated BuildListEntry

generated Entryは通常の `BuildListEntry` 形状そのままで、永続provenance fieldを
追加していない。IDは次から安定生成する。

```text
Candidate semantic meaning
targetDefinitionHash
searchStateHash
referencedOwnedWeaponsHash
CalculationContext
-> build-list.constrained.<hash>
```

`createdAt`、Clock、random UUID、request UUID、enumeration ordinalは含まない。
そのため既定IDに `createdAt` を含む通常 `createBuildListEntry()` の既定経路は
流用せず、IDと `createdAt` を明示指定して呼んでいる。通常経路の既定挙動自体は
変更していない。

current Entry reuseの条件は `PLANNER_SPEC.md` 9.2.12どおり全項目一致とする。

```text
Candidate semantic fingerprint
targetDefinitionHash
searchStateHash
referencedOwnedWeaponsHash
CalculationContext (isCalculationContextCompatible)
現在のstaleness (evaluateBuildListEntryStaleness で再計算し空であること)
```

`createdAt` は一致条件に含めない。過去runのtimestampは今回のClock値と異なり得るし、
semantic contentを表さないためである。reuseした場合はexisting Entryの
`createdAt` とIDをそのまま保持する。reuse候補が複数ある場合はID昇順で選ぶので、
入力配列の順序が結果を決めない。reuse時は防御的にcloneを返し、既存Entryを
mutationしない。

stale duplicateはreuseせず、updateもしない。旧Entryは履歴として残し、現在semantic
のgenerated Entryを新規に作る。deterministic Entry IDが既存Entryと一致し、かつ
current semantic contentが異なる場合はfail closedする。上書き、silent reuse、
random IDへのfallbackはいずれも行わない。

同じIDかつ同じcurrent semantic contentならreuseするので、retry時のidempotencyは
保たれる。

#### 変更していないもの

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
Production RNG semantics / RouteOperationの意味 / ProductionPlanの永続shape
PlanStepの意味 / 既存BuildListEntryのshape
B8-B1 enumerator semantics と B8-C1 preparePlannerInitialContext
```

schema bumpは不要である。normal scope Keep predictionは引き続きunsupportedのままで
ある。

---

### 4.8 B8-C3a implementation record

**B8-C1 complete。B8-C2 complete。B8-C3a complete。resolution再対応付けは
B8-C3bで完了した(4.9)。B8-C全体はまだ未完であり、次subtaskはB8-C4である。**

B8-C3aはPlanner Domain内のtransient DTOとpure抽出だけを実装した。augmented
PlannerInputの作成、`conflictResolutions: []` でのpreflight、fixed constraintの
現在Conflictへの再対応付け、current `conflictKey` の再構築、
`visitConstrainedCandidates()` 呼出し、Candidate trial loop、Beam Search完全再実行、
Trace Replay orchestration、`PlannerOrchestrationResult`、
`PlannerOrchestrationBounds` とその既定値、Worker / Application / Persistence / UI は
いずれも実装していない。

実装は `src/domain/planner/constrained/plannerConflictContext.ts` の1モジュールで、
Planner constrained indexからexportしている。すべて非永続transientであり、
`ProductionPlan` へ埋め込まず、Search Domainへ渡さない。

#### conflict context DTO

`PlannerConstrainedConflictContext` は `PLANNER_SPEC.md` 9.2.3の表どおりに、競合単位
(`conflictId` / `kind` / 競合資源identity / counter stream / Normal Counter ID /
`counterBefore` / 排他消費OwnedWeapon ID)とparticipant単位
(`counterAfter` / operation type / `sourceOwnedWeaponId` / `physicalActionKey` /
BuildListEntry ID / TargetWeapon ID / Candidate semantic fingerprint)を分けて保持する。
`PlanConflict` を拡張・置換していない。

#### 競合資源identity

`PlannerConflictResourceIdentity` はConflictKindごとのdiscriminated unionで、
participant BuildListEntry集合を含まない。

```text
same_gogma_counter        : kind + Gogma位置
same_skill_counter        : kind + Skill位置
same_normal_counter       : kind + NormalArtianCounter ID + Normal位置
same_owned_weapon_consumed: kind + 排他消費OwnedWeapon ID
```

比較用に `plannerConflictResourceKey()` と `samePlannerConflictResource()` を用意し、
key生成は既存 `stableStringify()` を使う。

`same_owned_weapon_consumed` の資源authorityは既存
`PlannerRouteUnit.exclusiveConsumedOwnedWeaponId` だけである。participantの
`sourceOwnedWeaponId` から復元していない。DTO側も `consumedOwnedWeaponId` を独立
fieldとして持つ。

#### context生成authority

新しいConflict検出を実装していない。既存 `preparePlannerInitialContext()` が返す
`initialRelevantUnitPlans` と `initialConflictDetection` だけを使い、
`conflictIdsByUnitKey` を既存 `plannerRouteUnitKey()` で逆引きして、
どの `PlannerRouteUnit` がどのConflictへ参加したかを復元する。
`detectPlannerConflicts()` の内部groupingをコピーしておらず、
`usedCounters` 相当の簡易判定も追加していない。既存の
shareability判定でConflictが生成されない同一Counter位置には、C3 contextも生成されない。

participantの粒度は競合へ参加した `PlannerRouteUnit` である。BuildListEntry IDへ
圧縮していない。重複除去はunit keyの完全一致だけに限る。

順序はinput Map / arrayのinsertion orderへ依存しない。contextは `conflictId` 昇順、
participantは BuildListEntry ID -> operation index -> unit index -> `physicalActionKey`
のstable順である。

#### participant sourceOwnedWeaponId

既存 `routeUnitOwnedWeaponId()` をauthorityとして再利用し、
`use_weapon_as_material` のときだけ `null` にしている。消費武器は
`exclusiveConsumedOwnedWeaponId` が持つため、source fieldへ詰め替えない。結果として
次になる。

```text
reset_bonuses / keep_bonuses / reset_skills -> operation.sourceOwnedWeaponId
owned Normal conversion                     -> route.sourceOwnedWeaponId
new Normal conversion / create_normal_artian-> null
use_weapon_as_material                      -> null
```

#### Candidate fingerprint authority

participant fingerprintはB8-C2でscope込みへ修正済みの
`createBuildCandidateMeaningFingerprint()` だけを使う。新しいfingerprint実装は
書いていない。Candidate ID / `searchRunId` / `createdAt` は含まない。

#### fixed conflict constraint

`PlannerFixedConflictConstraint` は `originalConflictId` / 競合資源identity /
fixed BuildListEntry ID / fixed TargetWeapon ID / fixed Candidate fingerprint を持つ。
generated Entryを示すfieldやprovenanceは追加していない。永続fieldも追加していない。

`originalConflictId` はdiagnosticであり、B8-C3bはこれをcurrent `conflictKey` として
再利用してはならない。再対応付けauthorityは競合資源identityである。この境界は型の
docコメントにも明記した。

固定authorityは `PlannerConflictResolution.selectedBuildListEntryId` だけである。
`recommendedBuildListEntryId`、Beam Search bestState、Target priority、Candidate score
は参照していない。取得元は `PlannerInitialContext.validConflictResolutions` に限定し、
validationがdrop済みのresolutionを復活させない。fixed constraintはoriginalの
validated Planner入力からのみ作る。augmented inputのgenerated Entryから新しい
fixed constraintを作る設計にはしていない。

#### fail closed

`preparePlannerFixedConflictConstraints()` はall-or-nothingである。1件でも
constraint化できなければ `status: 'unresolved'` と `constraints: []` を返し、成功分だけ
返さない。失敗理由はstructuredである。

```text
conflict_not_found
selected_entry_not_participant
participant_context_ambiguous
```

callerはraw error message文字列ではなく `status` と `reason` で分岐する。

#### 変更していないもの

```text
PlanConflict / PlannerConflictResolution / ConflictKind
PlanConflict.id 生成規則
detectPlannerConflicts semantics
physicalActionKey semantics / shareability semantics
Beam Search resolution適用規則
B8-C1 preparePlannerInitialContext / B8-C2 materializer semantics
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
```

schema bumpは不要である。normal scope Keep predictionは引き続きunsupportedのままで
ある。

### 4.9 B8-C3b implementation record

**B8-C1 complete。B8-C2 complete。B8-C3a complete。B8-C3b complete。したがって
B8-C3全体はcomplete。B8-C全体はまだ未完である。次subtaskはB8-C4 orchestration core。**

B8-C3はこれで次の4点を揃えた。

```text
transient conflict resource identity            (C3a)
explicit resolution -> fixed constraint          (C3a)
augmented conflict preflight                     (C3b)
complete PlannerConflictResolution[] 再対応付け  (C3b)
```

B8-C3bで実装していないもの。`visitConstrainedCandidates()` 呼出し、
ConstrainedCandidate materialize trial loop、`maxCandidateTrialsPerConflict` /
`maxGeneratedBuildListEntries` / `maxPlannerReruns`、full Beam Search再実行、
Trace Replay orchestration、`PlannerOrchestrationResult`、orchestration bounds
Production default、Worker / Application / Persistence / atomic save / UI。

実装は `src/domain/planner/constrained/plannerAugmentedPreflight.ts` の1モジュールで、
Planner constrained indexからexportしている。すべて非永続transientである。

#### preflight API

```ts
preparePlannerAugmentedConflictPreflight(
  augmentedInput: PlannerInput,
  fixedConstraints: readonly PlannerFixedConflictConstraint[],
  dependencies: PlannerDependencies,
): PlannerAugmentedConflictPreflightResult
```

resultはmessage文字列解析を要しないstructured unionである。

```text
ready      : preflightContext / conflictContexts / conflictResolutions / resolvedInput
invalid    : warnings / issues / excludedBuildListEntries
unresolved : conflictResolutions: [] / failures
```

`resolvedInput` は `{ ...augmentedInput, conflictResolutions }` のcloneであり、caller
inputをmutationしない。B8-C4はこれをそのままfull Beam Searchへ渡せる。C3b自身は
`runPlannerBeamSearch()` / `createProductionPlan()` / Trace Replayを呼ばない。

再対応付け部分だけはpure helperとしても切り出してある。

```ts
reassociatePlannerFixedConstraints(
  context: PlannerInitialContext,
  conflictContexts: readonly PlannerConstrainedConflictContext[],
  fixedConstraints: readonly PlannerFixedConflictConstraint[],
): PlannerConstraintReassociationResult
```

synthetic conflict contextでのテスト(0件 / 複数件 / key衝突 / participant semantic
不一致)を、実detectorが構造上作れないケースについても行うためである。

#### 旧conflictResolutionsをpreflightへ適用しない

preflight入力は必ず次で作る。

```ts
{ ...augmentedInput, conflictResolutions: [] }
```

`PlanConflict.id` はparticipant集合を含むため、generated Entry追加後は旧keyが一致
しない。旧keyを適用すると誤った `invalid_conflict_resolution` を生む。テストでは、
同じaugmented inputへ旧resolutionを適用した `preparePlannerInitialContext()` が実際に
`invalid_conflict_resolution` warningを出すこと、preflight経由ではそれが出ず
`validConflictResolutions` が空であることの両方を確認している。preflight検出時点の
`PlanConflict.selectedBuildListEntryId` はnullであり、固定選択はre-association後の
`resolvedInput.conflictResolutions` にだけ現在keyで現れる。

#### C1 helperの再利用

validation / `validBuildListEntries` / initial state / entry relevance / route unit
plans / conflict detectionをB8側で再実装していない。`preparePlannerInitialContext()`
をそのまま呼び、current conflict contextは `createPlannerConstrainedConflictContexts()`
を使う。`usedCounters` 相当の簡易判定、counter grouping、shareability判定の複製は
無い。preflightはBeam Searchを走らせないため `maxPlannerReruns` へ数えない。

#### fixed constraintの現在検証

constraintごとに次の順で確認する。

```text
1. fixed Entryが preflight context.validBuildListEntries に存在するか
     0件 -> fixed_entry_not_valid
     複数 -> fixed_entry_ambiguous
2. entry.targetWeaponId === constraint.fixedTargetWeaponId
     不一致 -> fixed_target_mismatch
3. createBuildCandidateMeaningFingerprint(entry.candidateSnapshot) 一致
     不一致 -> fixed_candidate_fingerprint_mismatch
4. current conflict match
     resourceIdentity一致 かつ participantにfixed Entryを含む
     0件 -> current_conflict_not_found
     複数 -> current_conflict_ambiguous
5. matched conflict内のfixed Entry participantが
   全て同じ fixedTargetWeaponId / fixedCandidateFingerprint
     混在 -> participant_context_mismatch
```

raw `augmentedInput.buildListEntries` は探索対象にしない。stale / Target無効 /
CalculationContext不整合 / capability不足 / protected destructive / prediction
unsupportedで除外されたEntryをfixed側へ復活させないためである。Candidate ID /
`searchRunId` / `createdAt` はいずれも判定に使わない。

match条件に旧 `PlanConflict.id` を使わない。`constraint.originalConflictId` は
diagnosticとfailure報告にだけ残す。

同一Entryが同一Conflictへ複数RouteUnitで参加することは正常であり、ambiguous扱いに
しない。authorityはConflict match件数がexactly oneであることだけである。

#### 再構築resolution

成功時に作るのは次だけである。

```ts
{ conflictKey: currentConflict.conflictId, selectedBuildListEntryId: constraint.fixedBuildListEntryId }
```

`recommendedBuildListEntryId` / Beam Search bestState / Target priority / Candidate
score / category は参照していない。generated Entryをselected側へ昇格させない。
C3bはfixedConstraintsを受け取って再対応付けするだけで、augmented inputを見て新しい
fixed constraintを生成しない。

#### all-or-nothing

1件でも失敗すれば `status: 'unresolved'` / `conflictResolutions: []` を返し、成功分の
partial配列を返さない。result shapeとして、`unresolved` は `conflictResolutions: []`
しか持てないためcallerが誤用できない。

再構築後に同一 `conflictKey` が複数になる場合はsilent dedupeせず
`resolution_key_collision` でfail closedにする。`validatePlannerInput()` が
conflictKey一意を要求するためである。

#### 決定的順序

fixedConstraintsは入力配列順に依存しない。処理順は
(競合資源key, fixed Entry ID, fixed Target ID, originalConflictId) の安定順である。
再構築resolutionは (conflictKey, selectedBuildListEntryId) 昇順、failuresは
(競合資源key, fixed Entry ID, fixed Target ID, originalConflictId, reason) 昇順で
返す。同semantic inputは入力順を反転しても同一resultになる。

`fixedConstraints = []` は正常であり、current conflictsが存在しても
`status: 'ready'` / `conflictResolutions: []` を返す。explicit resolutionが無い競合に
対して固定選択を勝手に生成しない。

#### invalid preflight

`preparePlannerInitialContext()` が `invalid` を返した場合は、その `warnings` /
`issues` / `excludedBuildListEntries` をそのまま `status: 'invalid'` として返す。
`current_conflict_not_found` 等のre-association reasonへ変換しない。

#### 変更していないもの

```text
PlanConflict / PlannerConflictResolution / ConflictKind
PlanConflict.id 生成規則
detectPlannerConflicts semantics
plannerRouteUnitKey / physicalActionKey / shareability semantics
runPlannerBeamSearch のresolution適用規則
PlannerWarningKind (invalid_conflict_resolution semanticsを含む)
createBuildCandidateMeaningFingerprint
B8-C1 preparePlannerInitialContext / B8-C2 materializer / C3a resource identity semantics
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
```

C3b専用の `PlannerWarningKind` は追加していない。ユーザー再選択への最終mappingは
B8-C4以降が扱う。schema bumpは不要である。normal scope Keep predictionは引き続き
unsupportedのままである。

---

### 4.10 B8-C4a implementation record

**B8-C1 complete。B8-C2 complete。B8-C3 complete。B8-C4a complete。**
**B8-C4全体は4.11のB8-C4bで完了した。**

B8-C4aが揃えたもの。

```text
PlannerOrchestrationBounds       caller必須。Production defaultなし
bounds validation                pure。3値とも finite integer >= 1
exact full-Beam observation      実際に開始するfull Beam Searchのみを観測
maxPlannerReruns budget          typed limit signal付きの消費controller
```

B8-C4aはsemantics-neutral runtime boundary追加である。Candidate enumeration、
materialization trial loop、`maxCandidateTrialsPerConflict` /
`maxGeneratedBuildListEntries` の消費loop、`PlannerOrchestrationResult`、
generated Entry adoption、orchestration bounds Production default、Worker /
Application / Persistence / UIはいずれもB8-C4a対象外である。

#### observed ProductionPlan生成境界

Production Plan生成の実装は1つに保ち、ordinary pathとB8 orchestration pathで
共有する。実装を複製しない。

```ts
interface ProductionPlanGenerationObserver {
  beforeBeamSearch(): void
}

createProductionPlanWithObserver(
  input,
  dependencies,
  options,
  observer?,
): Promise<PlannerResult>
```

`createProductionPlan()` は同じ実装へobserver無しでdelegateする。public signatureと
結果semanticsは変更していない。

`observer.beforeBeamSearch()` は、実際に開始する各full Beam Searchの直前に1回だけ
呼ぶ。

```text
observer.beforeBeamSearch()
  ↓
runPlannerBeamSearch()
```

最初のBeam Searchでも呼び、runtime unsupported retryのBeam Searchでも毎回呼ぶ。
observerがthrowした場合、その例外をそのままcallerへ伝播する。catchして通常の
`PlannerResult` へ変換しない。partial Planも返さない。

observerはruntime-onlyである。`PlannerInput`、Worker DTO、`ProductionPlan`、
Persistenceのいずれへもfieldを追加していない。structured-clone dataへ関数を
入れていない。B8-D Worker wiringはB8-C4a対象外である。

#### PlannerOrchestrationBounds

```ts
interface PlannerOrchestrationBounds {
  maxCandidateTrialsPerConflict: number
  maxGeneratedBuildListEntries: number
  maxPlannerReruns: number
}
```

Search側の `ConstrainedEnumerationBounds` とは完全に別typeであり、
`CandidateSearchSettings` も再利用しない。この3 fieldを
`ConstrainedCandidateSearchInput` へ追加していない。

validationは `validatePlannerOptions()` と同じstyleで、3値とも finite integer かつ
`>= 1` を要求する。`maxOffAxisPairEvaluations` のzero-disable semanticsはSearch
enumeration固有であり、この3 boundsへ移植していない。validationは入力をmutateせず、
defaultへ補正もしない。

Production defaultはB8-Eのbenchmark後である。`defaultPlannerOrchestrationBounds`、
`32` / `16` / `64`、`10000` などの仮値を追加していない。
`CandidateSearchSettings` や `defaultConstrainedEnumerationBounds` からのfallbackも
実装していない。

-> `defaultPlannerOrchestrationBounds` は**B8-E2bで追加済み**(4.15章、`2 / 1 / 4`)。
値はB8-E2aの実測から決めたものであり、`CandidateSearchSettings` /
`defaultConstrainedEnumerationBounds` からのfallback・clamp・repairは
B8-E2b以降も実装していない。validationはcaller supplied値の純粋validationのままである。

#### maxPlannerReruns budget

budgetは `ProductionPlanGenerationObserver` の形をしており、
`createProductionPlanWithObserver()` へそのまま渡せる。

```text
limit = maxPlannerReruns
used  = 0

before Beam:
  used < limit  -> used += 1、実行許可
  used >= limit -> typed failure、usedは増やさない
```

打ち切りはmessage文字列ではなくtyped signalで報告する。

```ts
class PlannerOrchestrationLimitError extends Error {
  code: 'max_planner_reruns'
  limit: number
  used: number
}
```

`code` は現在B8-C4aが実際に消費する1つだけである。未使用のerror codeを先行実装して
いない。他2 boundsのcodeは、消費loopを実装するB8-C4bで追加する。

budgetはpreflightを認識しない。9.2.3.1のpreflightは
`preparePlannerInitialContext()` / `createPlannerRouteUnitPlans()` /
`detectPlannerConflicts()` だけを呼びBeam Searchを走らせないため、この観測境界へ
到達せず、budgetを消費し得ない。

#### 変更していないもの

```text
PlannerResult / ProductionPlan / PlanningInputSnapshot / PlanStep shape
runtime unsupported retry semantics
unsupported Entryの扱い
Trace Replay順序
warnings / conflicts / selectedBuildListEntryIds
rejectedBuildListEntries / requiredMaterials
Clock / PlannerIdFactory呼出し意味
B8-C1 preparePlannerInitialContext / B8-C2 materializer
B8-C3a resource identity / B8-C3b re-association semantics
Production RNG semantics
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
```

schema bumpは不要である。normal scope Keep predictionは引き続きunsupportedの
ままである。

---

### 4.11 B8-C4b implementation record

**B8-C1 complete。B8-C2 complete。B8-C3 complete。B8-C4a complete。B8-C4b complete。**
**B8-C4 implementation complete。B8-C implementation complete。**

次phaseはB8-D Worker / Application / Persistence / atomic save / 既存UIへの最小配線
である。B8-C4のorchestration bounds Production defaultは未確定であり、B8-Eの
Browser / Planner benchmark後に決める。

B8-C4bが接続したpipelineは次である。すべて既存実装をauthorityとして呼ぶだけであり、
Beam Search / Trace Replay / ProductionPlan生成を複製していない。

```text
createPlannerFullBeamBudget()                      C4a
  -> createProductionPlanWithObserver()            initial ordinary Planner
  -> preparePlannerInitialContext()                C1
  -> createPlannerConstrainedConflictContexts()    C3a
  -> preparePlannerFixedConflictConstraints()      C3a
  -> visitConstrainedCandidates()                  B8-B1 sequential visitor
  -> createConstrainedMaterializer()               C2
  -> preparePlannerAugmentedConflictPreflight()    C3b
  -> createProductionPlanWithObserver()            trial full Beam + Trace Replay
  -> adoption / next candidate
```

#### orchestration API

```ts
createProductionPlanWithConstrainedSearch(
  input, dependencies, options,
): Promise<PlannerOrchestrationResult>
```

`PlannerConstrainedOrchestrationOptions` は `enumerationBounds` /
`orchestrationBounds` / 任意の `executionOptions` を持ち、両boundsともcaller必須で
ある。Production defaultはこのモジュールに存在しない。

#### ConstrainedSearchOrigin

`createConstrainedSearchOriginFromPlannerInput()` が、**元のPlannerInputから1回だけ**
構築する。`rngState` / `normalCounters` / `ownedWeapons` / `targetWeapons` / `master` /
`calculationContext` をdefensive cloneする。adopt後のPlanner state、Beam bestState、
競合Counter+1、過去のUI Candidate Search requestのいずれからも作らない。
`PlannerMasterSubset` と `SearchMasterSubset` は構造的に同一なのでそのまま渡す。

#### fixed constraintとwork

fixed constraintは元のvalidated inputに対して1回だけ作る。`context.validConflictResolutions`
だけがauthorityであり、`recommendedBuildListEntryId`・bestState participant・priority・
score・categoryは使わない。有効なexplicit resolutionが0件ならenumeratorを一切起動せず、
initial ordinary Planner resultと `generatedBuildListEntries: []` を返す。
`preparePlannerFixedConflictConstraints()` が `unresolved` の場合も同様に停止し、
structured failureから `invalid_conflict_resolution` warningを組み立てる。

workは `(fixed constraint, 非固定participant Target)` で、同一Targetはdedupe、
順序はstable keyの昇順である。1件adoptするたびに残りworkの充足を再評価する。

#### trial semantics

`maxCandidateTrialsPerConflict` は元Conflict単位のbudgetで、その元Conflictの複数Target
workが共有する。`limit + 1` 件目のdeliveryで初めて打ち切りと判断するため、ちょうど
`limit` 件でenumerationが尽きた場合にfalse positive warningを出さない。

`maxGeneratedBuildListEntries` はadoptした新規generated Entryだけを数える。新規Entryだと
分かった時点でcapが満杯なら、full Planner再実行を行わずにwarningを出してglobal stopする。

`maxPlannerReruns` はC4aのbudget instanceをinitial run・全trial run・runtime unsupported
retryで共有する。preflightはBeam Searchを走らせないため消費しない。実測でも、5 Candidate
処理・4 trial Beamのfixtureが `maxPlannerReruns = 5` でちょうど完了し、`4` では
`max_planner_reruns_reached` になる。

#### afterBeamSearch観測

initial ordinary Production Plan生成の内部でruntime unsupported retryがrerun budgetに
拒否されるケースのため、`ProductionPlanGenerationObserver` へ
`afterBeamSearch?(result: PlannerBeamSearchResult)` を追加した。各
`runPlannerBeamSearch()` 完了直後にちょうど1回呼ぶ観測専用hookである。これにより
Replay未成功のBeamからProductionPlanを組み立てずに、最後に完了したBeamの
conflicts / warningsと `plan: null` を返せる。ordinary
`createProductionPlan()` のsemanticsとbudget semanticsは変更していない。

#### 追加したwarning kind

```text
max_candidate_trials_per_conflict_reached
max_generated_build_list_entries_reached
max_planner_reruns_reached
constrained_enumeration_bound_reached
```

いずれもB8 orchestration専用であり、ordinary Planner経路では生成しない。
`constrained_enumeration_bound_reached` は、consumer stopではなく
`summary.stoppedByBound === true` で終わり、かつそのworkでadoptできなかった場合だけ
出す。

#### 一次レビュー修正 (MEDIUM 1 / MEDIUM 2)

初版では次の2点が契約違反だった。実装で修正済みである。

**MEDIUM 1**: `budget.used === limit` でも、次の `beforeBeamSearch()` がthrowするまで
到達を検出していなかったため、無駄なenumeration / materialization / preflightが1回
走っていた。`budget.used >= budget.limit` を直接見る判定を、work開始時(充足判定の後)と
trial却下直後の2箇所へ追加した。trial採用直後は即warningとせず、残りworkを
current Planで再評価する。実測では `maxPlannerReruns = 1` のときClock呼出しが1回
(= initial Plan組み立てのみ)となり、materializationが1回も起きないことを固定した。

**MEDIUM 2**: 通常Plannerがcancellationを `plan: null` の正常結果として処理した後も
work / enumerationへ進んでいたため、同じ `shouldCancel` が
`CandidateSearchError('cancelled')` を送出し得た。`runFullPlanner()` を
`completed` / `cancelled` / `rerun_budget_reached` のtyped outcomeへ変更し、
`afterBeamSearch` の観測状態を各run開始時にresetして、そのrun自身の最後のBeamの
`cancelled` だけを見るようにした。initial runがcancelledならenumerationを開始せず
ordinary safe resultを返し、trialがcancelledならreject扱いにせずorchestration全体を
終了して最後にacceptedなresultを返す。cancellation専用のwarning kindは追加していない。

#### テスト

`plannerConstrainedOrchestration.test.ts` は29件で、orchestration testは実コード経路
(C1 / C3a / C3b / B8-B1 enumerator / C2 materializer / Beam Search / Trace Replay)を
そのまま通す。Fake RNG Engine、ID factory、Clockだけを注入する。fixtureは
`src/test/fixtures/plannerConstrainedOrchestration.ts` で、B8-B1のconstrained
enumeration fixtureを再利用し、1つのFake Engineがenumeratorと通常Plannerの両方へ
答える。

シナリオの骨子は、Target Aと Target Bが同一Gogma Counter位置を奪い合う
`same_gogma_counter` 競合である。Target Aを固定すると、Target B向けのIdeal Candidateは
すべて同じGogma位置を使うため完全再実行で不採用となり、Gogma位置を使わない
Reset-Skills-onlyのPractical Candidateが採用される。

#### 実測できなかったテスト観点

次はこのfixtureでは自然なPlanner局面として再現できなかったため、実装authorityである
純粋関数 `isConstrainedTrialAdoptable()` / `isPlannerConflictWorkSatisfied()` を
export して直接検証した。orchestrationはこの関数だけを採否・充足判定に使う。

```text
generated selectedだがfixed Entryが落ちるtrialの不採用
以前adoptしたgenerated Entryが落ちるtrialの不採用
1つのgenerated Entryが別workも充足するケース
```

また、bound到達なしでenumerationがちょうど `limit` 件でexhaustedになるfixtureは作れて
いない。false positive警告の不在は、`limit` 件目のCandidateでadoptするケースで検証した。

#### 変更していないもの

```text
createProductionPlan public signature / 結果semantics
runPlannerBeamSearch / Trace Replay / runtime unsupported retry semantics
PlanningInputSnapshot / ProductionPlan / PlanStep shape
conflict detection / shareability
B8-C1 / B8-C2 / B8-C3a / B8-C3b
通常Candidate SearchのAPIとsearchRunId契約
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
```

schema bumpは不要である。normal scope Keep predictionは引き続きunsupportedのままで
ある。Worker / Application / Persistence / UIはB8-Dの対象であり、B8-C4bでは実装して
いない。

---

### 4.12 B8-D1 implementation record

B8-Cは完了、B8-D1は完了、B8-D全体は未完了である。

B8-D1はWorker protocol / Worker execution routing / Production Worker adapter /
Application Worker Clientまでを対象とする。save-time current-state再読込、再validation、
generated Entry + ProductionPlanのatomic save、BuildListPageのconstrained経路切替は
B8-D2の対象であり、本タスクでは実装していない。

#### constrained Worker protocol

ordinary `create_plan` / `create_plan_result` protocolは互換のまま残し、request kindを
1つ追加した。

```text
request   create_constrained_plan
            input.plannerInput        PlannerInput
            input.orchestrationBounds PlannerOrchestrationBounds
response  create_constrained_plan_result
            result                    PlannerOrchestrationResult
```

`cancel` / `progress` / `error` は両request kindで共有する。

protocolの配置は `src/workers/plannerWorkerContracts.ts` である。
`PlannerOrchestrationResult` は `domain/planner/constrained` の型であるため、
`plannerTypes.ts` へ constrained protocolを置くとPlanner foundationが自身の
constrained sub-moduleへ依存する循環になる。DomainはWorker moduleをimportせず、
依存はWorker -> Domainの一方向のみである。既存 `src/workers/contracts.ts` の
`WorkerTaskRequest` / `WorkerResultResponse` を再利用した。

#### bounds責務

```text
Application caller       -> orchestration boundsのみ指定 (caller必須)
Production Worker adapter -> defaultConstrainedEnumerationBoundsを明示
                          -> caller orchestration boundsをそのまま明示
createProductionPlanWithConstrainedSearch()
```

`createProductionConstrainedPlan` は `defaultConstrainedEnumerationBounds`
(40 / 30 / 100 / 500) をSearch Domainのauthorityからimportして渡す。数値をadapter内へ
複写していない。orchestration boundsは変換・clamp・default補完を行わず、同一参照のまま
渡す。`defaultPlannerOrchestrationBounds` 相当のProduction defaultは追加していない。
その3値はB8-E benchmarkがauthorityである。

-> B8-E2bで `defaultPlannerOrchestrationBounds` = `2 / 1 / 4` が決まった後も、
このadapterは**caller supplied boundsを同一参照のままforwardする**。Worker内で
defaultへ置換しない。defaultを使うかどうかはApplication caller側の判断である(4.15章)。

#### Worker controller

`createPlannerWorkerController` はrequest typeでdispatchするmessage routingのみを担当し、
Candidate enumeration、materialization、fixed constraint、preflight、Beam Search、
Trace Replay、adoptionを複製していない。両request kindは同一の
`PlannerDependencies` / `shouldCancel` / `yieldControl` / `onProgress` を使用し、
constrained側の `executionOptions` へそのまま渡す。B8-C4bのcancellation semanticsを
Worker側で別実装していない。

progressは既存 `PlannerProgress { expandedStates, maxExpandedStates }` をBeam progressと
してそのまま流す。Search enumerationのwork量から疑似percentを作っていない。新しい
Worker progress DTOは追加していない。

#### task generation契約 (primary / second review修正)

Client側の同一requestId置換だけでは、Worker側の旧計算が失効しない。ordinary Xの実行中に
constrained Xを開始すると旧ordinary計算がliveのまま残り、その旧resultがcurrentの
constrained pendingへ届いて `PlannerWorkerProtocolError` になる。これはB8-D1の
duplicate requestId契約違反である。

primary reviewではWorker-local generationを追加したが、それだけでは解決しない。
`postMessage()` は非同期であり、Clientがpendingを置換した時点でWorkerがまだ新messageを
受信していない窓が存在する。その窓では旧generationがWorker側でcurrentのままなので、
旧resultは正当にpostされ、Main threadのcurrent pendingへ届いてしまう。

そこでlogical `requestId` とは別に、task instanceを識別する
runtime-only `generation` をWorker protocolへ追加した。

```text
Client : task作成ごとにmonotonic generationを採番
         pendingへ requestId / generation / expectedResultType を保持
         同一requestId再利用 -> old Promiseを PlannerCancelledError -> 新generationへ置換
request  : create_plan / create_constrained_plan / cancel すべてがgenerationを運ぶ
response : progress / create_plan_result / create_constrained_plan_result / error が
           対応するtask generationをechoする
```

両側でチェックする。

```text
Worker : Client-provided generationをownership authorityとして使用し、独自採番しない
         current generationでない task は実行せず破棄
         shouldCancel : generation不一致 OR そのgenerationがcancelled
         progress / result / error : current generation かつ non-cancelled のときだけpost
         cancel : 指定generationがcurrent task instanceのときだけ retire
                  古いgenerationのcancelは新しいgenerationをcancelしない
Client : response.requestId === pending.requestId
         AND response.generation === pending.generation
         のときだけcurrent requestのresponseとして扱う
         generation不一致は stale response として silent ignore
```

cancellationはrequestIdではなくgeneration単位で追跡するため、新task instanceが
cancelled状態で生まれることも、旧instanceが新instanceによって復活することもない。

`PlannerWorkerProtocolError` は削除していない。generation一致かつresult discriminantが
違う場合、つまり本物のcurrent protocol violationのときだけ引き続きfail closeする。
generation不一致のstale resultはsilent ignoreとなり、両者を区別できる。

外部semanticsは変更していない。`createPlan()` / `createConstrainedPlan()` /
`cancelPlan(requestId)` のsignature、同一requestId再利用時の
`PlannerCancelledError` 置換、ordinary / constrained共通logical ID namespace、
progress、errorはそのままである。`generation` はWorker wire DTO限定のruntime primitive
であり、`PlannerInput` / `PlannerResult` / `PlannerOrchestrationResult`、Domain entity、
Persistenceへは追加しない。

testは同期delivery fakeでは不十分なため、双方向のmessage deliveryを手動制御できる
fake Workerを追加し、「Clientがpendingを置換済みだが新taskはWorker未到達」という窓で
旧result / 旧error / 旧progressが届く順序を再現している。

errorは既存 `type: 'error'` responseのままで、message textからbound / cancel /
materialization errorへの再分類を行わない。

#### Application Worker Client

```text
createPlan(requestId, input, callbacks?)                            : PlannerResult
createConstrainedPlan(requestId, input, orchestrationBounds, cb?)   : PlannerOrchestrationResult
```

`orchestrationBounds` はcaller必須で、client内defaultは無い。pending requestは
期待するresponse discriminantを保持し、不一致のresultは
`PlannerWorkerProtocolError` でfail closedする。ordinary resultが
constrained Promiseへ silent resolveすると `generatedBuildListEntries` が欠落するため
である。同一requestId再使用時に以前のpendingを `PlannerCancelledError` で置換する既存
semanticsは、ordinary / constrainedの混在時も同一ID namespaceとして維持する。
`createUnavailablePlannerWorkerClient()` の `createConstrainedPlan()` は
`ProductionPlannerWorkerUnavailableError` を返し、main thread fallback計算や
orchestration default fallbackへ切り替えない。

#### structured clone境界

constrained requestは `PlannerInput` / `PlannerOrchestrationBounds` / `requestId` のみ、
responseは `PlannerOrchestrationResult` のみを運ぶ。RngEngine、関数、Clock、ID Factory、
`ProductionPlanGenerationObserver`、Map、Set、class instanceを含めない。generated
BuildListEntryは通常のDomain data shapeのままである。

#### D1で行っていないこと

WorkerとApplication ClientはIndexedDB / Dexie / repositoriesへアクセスしない。resultは
callerへ返すだけで保存しない。BuildListPage / ProductionPlanPage /
ExecutionNavigatorPageの実動作は変更しておらず、BuildListPageは引き続き ordinary
`createPlan()` を使用する。UIへhidden orchestration defaultを入れていない。

#### 変更していないもの

```text
createProductionPlan / PlannerResult / ordinary create_plan protocol
BuildListPage current plan creation
Search Worker / Identification Workers
Production RNG semantics
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
```

schema bumpは不要である。

#### next

B8-D2: save-time current-state再読込 / 再validation / generated Entry +
ProductionPlanのatomic persistence / 既存UIへの最小配線。

### 4.13 B8-D2a implementation record

B8-Cは完了、B8-D1は完了、B8-D2aは完了、B8-D全体は未完了である。

B8-D2aはApplication / Persistence層のsave-time境界だけを対象とする。
`PlannerOrchestrationResult` のsave-time current-state再読込、snapshot再validation、
generated BuildListEntries + ProductionPlanのatomic保存を実装した。
BuildListPageのconstrained経路切替はB8-D2bであり、本タスクでは実装していない。
`PlannerOrchestrationBounds` のProduction defaultはB8-Eがauthorityであるため、
UIから制約付き経路を起動できる状態にしていない。

#### service / API

```text
src/services/planner/plannerResultPersistenceService.ts
  PlannerResultPersistenceService
    savePlannerOrchestrationResult(
      result: PlannerOrchestrationResult,
      currentCalculationContext: CalculationContext,
    ): Promise<ProductionPlan | null>
```

Domain / WorkerはPersistenceをimportしない。serviceはPlannerを再実行せず、
Beam Search / Trace Replay / constrained enumeration / Candidate trialを1回も呼ばない。
Main threadへ `ProductionRngEngine` を生成せず、`validatePlannerInput()` も呼ばない。
Planの計算authorityはWorker結果のままであり、save-timeはcurrent snapshotとの
整合確認だけを行う。

#### transaction対象とsave-time readの位置

1つのDexie read-write transactionへ次のtableを含める。

```text
rngState
normalArtianCounters
ownedWeapons
targetWeapons
buildListEntries
productionPlans
```

`buildCandidates` は含めない。generated CandidateをBuildCandidate tableへ保存しないため
である。DB schema / table追加はない。

current stateのreadはtransaction外ではなく、writeと同じtransaction内で行う。
Worker計算時の `PlannerInput` は再利用しない。RngStateが存在しない場合は
`ensureInitialRngState()` を呼ばずfail closedする。current RngStateが
`validateRngState()` を通らない場合も同様である。

#### snapshot comparison authority

新しいhashやnormalizationを追加せず、既存authorityだけを使用する。

```text
CalculationContext        isCalculationContextCompatible()
initialExecutionState     createExpectedPlanState()
targetWeaponsHash         createPlanningTargetWeaponsHash()
buildListEntriesHash      createPlanningBuildListEntriesHash()
generated Entry staleness evaluateBuildListEntryStaleness()
Domain validation         validateProductionPlan() / validateBuildListEntry()
                          / validateRngState()
```

比較対象の最終augmented BuildListEntry setは
`current persisted BuildListEntries + result.generatedBuildListEntries` である。
generated Entryは1回だけ含む。timestamp / source / note / `isStale` /
`staleReasons` を独自にhashへ足していない。上記authorityがすべて配列順に依存しない
ため、current arrayの順序だけが変わってもfalse staleにならない。

#### generated Entry staleness

各generated Entryをcurrent Target / RngState / Normal Counters / OwnedWeapons /
CalculationContextに対して `evaluateBuildListEntryStaleness()` で再評価する。
computed `isStale === true` なら保存しない。返却Entryが持つ `isStale` /
`staleReasons` を信用しない。

#### Plan reference validation

最終augmented setからID mapを作り、Planが参照する次のIDがすべて存在することを確認する。

```text
plan.selectedBuildListEntryIds
plan.steps[].buildListEntryId != null
plan.conflicts[].buildListEntryIds
plan.conflicts[].recommendedBuildListEntryId != null
plan.conflicts[].selectedBuildListEntryId != null
plan.rejectedBuildListEntries[].buildListEntryId
```

加えてPLANNER_SPEC 9.2.14のadoption契約を防御的に再確認する。

```text
generatedBuildListEntries ⊆ plan.selectedBuildListEntryIds
```

#### PlanStep candidate identity

`PlanStep.buildListEntryId != null` のStepは、対応Entry Snapshotと
`step.candidateId === entry.candidateSnapshot.id` を満たすことを確認する。
`buildListEntryId === null` のPlanner-only Stepへはcandidateを要求しない。
これは既存Planner生成契約と同じで、Trace Replayが
`candidateId: entry.candidateSnapshot.id` を設定している。

#### ID collision handling

generated Entry IDが保存時点で既にPersistenceへ存在した場合、内容が同一でも
reuseせず、上書きもせず、save-time raceとして拒否する。`reusedExisting: true` の
materialize結果は `generatedBuildListEntries` へ含まれないため、返却後に同じIDが
現れることはsave-time raceを意味する。

書き込みは既存IDを潰さない方法を使う。repositoryへ `addBuildListEntry()` と
`addProductionPlan()` を追加し、`put` ではなく `add` でinsertする。両者とも
既存 `put` と同じDomain validationとactive Plan guardを使用し、validation
semanticsを弱めていない。

#### plan === null / partial Plan / Active Plan

```text
plan === null かつ generated []            -> DB write 0件、nullを返す
plan === null かつ generated non-empty     -> C4 invariant破壊としてfail closed、write 0件
plan != null かつ bound到達のpartial Plan  -> snapshot整合なら保存する
```

Plannerから返るPlanは `draft` であることを要求し、B8-D2aでactive化しない。
既存Active Planが存在してもDraft保存を許可し、Active Planを変更しない。
Active Plan単一制約、置換、破棄、再計算は従来どおりApplication / Persistence層の
責務のままである。

#### retry可能なvalidation error

既存 `RepositoryError` 体系へcodeを2つ追加した。schema変更ではない。

```text
planner_state_changed   save-time current stateがPlan snapshotから乖離した。
                        write 0件。Plannerを再実行すればよい。
planner_result_invalid  orchestration result自体がpersist不可能。
                        同一stateで再実行しても同じく失敗する。
```

message parsingを要求しない。`runInRepositoryTransaction()` は `RepositoryError` を
そのまま再throwするため、これらのtyped errorが `transaction_failed` へ潰れない。

#### atomic rollback

全validation成功後にのみwriteし、generated Entries -> ProductionPlanの順に書く。
途中のEntry write失敗、Plan write失敗、ID collision、Dexie errorはいずれも
transaction全体をrollbackする。最終状態は「全部保存」か「何も保存しない」だけである。

save-time mismatchを見つけてもProductionPlan snapshotをpatchしない。
`baseSnapshot` hashの書き換え、generated EntryのPlanからの除去、
`selectedBuildListEntryIds` の修正、`PlanStep.candidateId` の書き換えを行わず、
retryable failureとして返す。

#### tests

`src/services/planner/plannerResultPersistenceService.test.ts` を追加した(21件)。
fixtureは実 `createPlanningInputSnapshot()` / `plannerBeam` fixtureから
整合stateを組み立てており、hand-written hash文字列だけのtestにしていない。

```text
plan=null + generated []                     -> write 0件
plan=null + generated non-empty              -> fail closed / write 0件
happy path                                   -> Entry + Plan両方保存
BuildCandidate tableへ保存しない
partial Plan (bound warning) でも保存可能
RngState変更 / Normal Counter変更 / OwnedWeapon semantic変更
TargetWeapon semantic変更 / BuildListEntry set変更 / CalculationContext変更
generated Entryがcurrent stateでstale               -> 保存拒否
generated Entry IDが既存                            -> 上書きせず拒否
generated EntryがPlanでselectedされていない          -> 拒否
Plan参照Entry ID missing                            -> 拒否
PlanStep candidateIdとEntry Snapshot不一致           -> 拒否
Plan write失敗 -> Entryもrollback
複数generated Entriesの途中write失敗 -> 1件目もrollback
RngState不在 -> initial state生成せずfail closed
既存Active Planあり -> Draft保存可 / Active Plan unchanged
current array順序だけ変更 -> false staleにならない
```

#### 変更していないもの

```text
PLANNER_SPEC normative semantics
Planner Domain orchestration (B8-C)
Worker protocol / Worker generation (B8-D1)
Search Domain / constrained enumerator
BuildListPage createPlan/createConstrainedPlan切替
PlannerOrchestrationBounds Production default
benchmark / ProductionPlanPage / ExecutionNavigator
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
```

DB schema bumpは不要である。

#### next

B8-E: orchestration Browser / Planner benchmarkと
`PlannerOrchestrationBounds` のProduction default決定。
その後B8-D2b: BuildListPageのconstrained経路切替。

### 4.14 B8-E1 implementation record

B8-Cは完了、B8-D1は完了、B8-D2aは完了、**B8-E1は完了、B8-E全体は未完了**である。

B8-E1はharnessとProduction-valid workloadだけを対象とする。
**Production defaultは決めていない。** `PlannerOrchestrationBounds` のProduction
defaultは依然として存在せず、caller必須指定のままである。

計測手順・timing boundary・fresh Worker policy・result normalization・workload定義は
[B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md](./B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md)
に記録した。

timing pathは実Production経路である。

```text
createProductionPlannerWorkerClient()
  -> planner.worker.entry.ts
  -> Production Worker adapter (defaultConstrainedEnumerationBounds)
  -> createProductionPlanWithConstrainedSearch()
  -> ProductionRngEngine / Beam Search / Trace Replay
```

benchmark専用のPlanner Worker・Planner algorithm・Fake Engineは作っていない。
`ConstrainedEnumerationBounds` はbenchmark requestに含めず、Production adapterが
Worker境界の内側で供給する。

#### 未確認: `generatedBuildListEntries.length >= 2` が未成立

workload要件「generous boundsでgenerated Entry 2件以上」は、B8-E1の
Production-valid調査では確認できなかった。owner decisionによりB8-E1のこの必須要件は
免除され、**この未確認事項はB8-E2をブロックしない**。
**「最大1件」をDomain invariantとして断定しない。** 詳細な調査記録は
benchmark文書7.5にある。

初版はここに「1 Counter位置 → 1 Route」を前提とした証明を書いていたが、それは現行
Planner実装と一致しないため撤回した。`plannerRouteProgress.ts` の
`actionIdentity()` は `reset_bonuses` / `keep_bonuses` /
`sourceOwnedWeaponId != null` の `reset_skills` をshareableとして扱い、同一
`physicalActionKey` のunitは `allOneShareablePhysicalAction()` によりcounter
conflictにならない。すなわち `1 Counter position != 1 BuildListEntry` である。

実Production予測だけで共有 `reset_skills` の構成を作って確認した結果は次である。

```text
generated A / B が同一 physicalActionKey、shareable = true
両者間に same_skill_counter conflict は検出されない
augmented preflight は ready
Beam trace で1回の reset_skills が両Entryを progressed している
```

却下されているのはconflictでもshareabilityでもない。`reserve_weapon` は
`existing_gogma_*` に対して同一source Gogma IDをin-place更新するため、共有physical
actionから得られる物理武器は1本だけである。その1本をreserveすると
`refreshTargetSatisfaction()` が同一 weaponType / element の全Targetを更新し、
2件目のEntryは `entryIsRelevantForState()` の
`!hasIdeal && (!hasPractical || category === 'ideal')` を満たさなくなって
`targetCanUseEntry()` で除外される。rejectionsにも現れず、relevanceが消えるだけである。

独立した2本のchainを作る方向も、Gogma / Skillの起点位置が各1つしか使えず、
`use_weapon_as_material` はSearch / constrained enumeratorのどのroute emitterも
生成しないため、B8-E1では2件目のadoptへ到達しなかった。

確認できたのは「現行のProduction-valid workloadでは2件adoptを確認できなかった」
という観測事実であり、一般証明ではない。`maxGeneratedBuildListEntries = 1 / 2 / 4`
のうち2以上が有用であるケースも今回未確認である。B8-E2では、値を上げてadopt成功件数が
増えることを今回のworkloadでは期待せず、cap = 1 と larger cap のあいだで追加の
Candidate trial / Planner rerunコスト・warning kinds・outcomeKeyがどう変わるかを
測定事実として扱う。Domain / Planner / conflict semanticsは変更していない。

#### 変更していないもの

```text
PLANNER_SPEC normative semantics
Planner Domain orchestration (B8-C)
Worker protocol / Worker generation (B8-D1)
Application / Persistence atomic save (B8-D2a)
Search Domain / constrained enumerator
BuildListPage createPlan/createConstrainedPlan切替
PlannerOrchestrationBounds Production default
既存3 benchmark（C5-E2C8 / B5 / B8-B2）とglobalThis.b8Benchmark
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings = 1000 / 200 / 1000 / 200 / 0.6
defaultPlannerOptions
```

Production codeの変更は0ファイルである。

#### next

B8-E2: 実Browser計測と `PlannerOrchestrationBounds` のProduction default決定。
その後B8-D2b: BuildListPageのconstrained経路切替。

### 4.15 B8-E2 implementation record

**B8-E2a complete / B8-E2b complete。B8-E complete。次PhaseはB8-D2b。**

B8-E2aは実Browser計測タスクである。実Chromiumページで `benchmark.html` と
実Production Planner Worker bundleを動かし、174 runを記録した。Vitest実行時間・
Node直接実行・jsdom・Fake Worker・FakeRngEngine・main-thread直接呼出し・推定値は
使用していない。測定手順と全raw測定表は
[B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md](./B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md)
10章にある。

B8-E2bはowner decisionによるProduction default確定である。

```ts
export const defaultPlannerOrchestrationBounds: PlannerOrchestrationBounds = {
  maxCandidateTrialsPerConflict: 2,
  maxGeneratedBuildListEntries: 1,
  maxPlannerReruns: 4,
}
```

```text
Production tuple  2 / 1 / 4
実装位置          src/domain/planner/constrained/plannerOrchestrationBounds.ts
public export     src/domain/planner（既存 constrained/index.ts 経由。新規cycleなし）
決定根拠          B8-E2a実測（同文書10章）とfinalist比較（同10.9）
decision record   同文書11章
```

決定根拠の要点。

- `maxCandidateTrialsPerConflict = 2` は、generated Candidateがadoptされる
  測定上の最小trial数である。workload B / C とも trial=1 では adopt 0 であった。
  `trial > 2` でsemantic outcomeの改善は観測されなかった。latencyの挙動は
  workloadで異なり、Cのisolated trial sweep（generated / rerun固定）では
  trial増加に伴って追加costが増加した一方、Bのlatencyは非単調だった。
  したがってdecisionの根拠はsemantic改善が無かったことだけであり、
  「trialを増やすと必ずコストが増える」ではない
- `maxPlannerReruns` は initial ordinary Beam を含めて数えるため、trial数と
  同じ単位で比較できない。実測でも rerun=1 は ordinary Beam だけで終了した。
  したがってfield単位の最低値ではなく、**finalist tuple `2/1/4` 全体**を
  authorityとする。`2/1/4` は workload B / C / D / E のすべてで
  large-bounds側と同じ semantic outcome へ到達した
- `maxGeneratedBuildListEntries = 1` は
  **Domain上の最大generated Entry数を意味しない**。B8-E1 / B8-E2aで
  Production-validな2件adoptを確認できていないという観測事実に基づく現行default
  であり、workload D では cap を 2 / 4 へ上げても adopt件数は 1 のままで
  latencyだけが増えた。将来Production-validな2件adoptが確認された場合は
  再benchmark対象である

default追加にあたって次は行っていない。

```text
clamp
invalid valueのrepair / field-wise completion
fallback mutation
CandidateSearchSettings からの導出
defaultConstrainedEnumerationBounds からの導出
benchmark-only sweep定数のProduction import
```

`validatePlannerOrchestrationBounds()` / `assertPlannerOrchestrationBounds()` は
caller supplied値の純粋validationのままで、invalid値はfail closedする。
`planner.worker.production.ts` と `PlannerWorkerClient` も
caller supplied boundsをそのままforwardし、defaultへ置換しない。
defaultを実際に渡すApplication側の配線はB8-D2bで行う。

B8-E2は次を変更していない。

```text
Planner orchestration algorithm / Beam Search / Trace Replay
Search Domain / constrained enumerator
Persistence / Worker protocol / PlannerWorkerClient API
BuildListPage / ProductionPlanPage / ExecutionNavigator
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultCandidateSearchSettings
defaultPlannerOptions
```

DB schema bumpは不要である。

#### next

B8-D2b: BuildListPageのconstrained経路切替。**完了**(4.16章)。

### 4.16 B8-D2b implementation record

**B8-D2b complete。B8-D complete。**

B8-D2bはApplication callerの配線タスクである。変更したexecution codeは
`src/pages/BuildListPage.tsx` だけであり、Planner Domain orchestration /
Beam Search / Trace Replay / constrained enumerator / materializer / preflight /
Planner Worker protocol / `PlannerWorkerClient` / `PlannerResultPersistenceService` /
`createPlannerInput()` / DB repositories / Production RNG / Candidate Searchは
変更していない。

旧経路と新経路。

```text
旧  createPlannerInput()
      -> client.createPlan()
      -> productionPlanRepository.putProductionPlan(result.plan)

新  createPlannerInput()
      -> client.createConstrainedPlan(
           requestId, input, defaultPlannerOrchestrationBounds, { onProgress })
      -> savePlannerResult(result, save-time CalculationContext)
      -> PlannerResultPersistenceService.savePlannerOrchestrationResult()
```

要点。

- `defaultPlannerOrchestrationBounds`(`2 / 1 / 4`、4.15章)を渡すのはApplication
  callerであるBuildListPageである。`PlannerWorkerClient` は従来どおりcaller supplied
  boundsをそのままforwardし、defaultを選ばない
- Persistenceへ渡すのは `PlannerOrchestrationResult` 全体であり、`plan` だけを
  取り出さない。generated BuildListEntriesとProductionPlanを同一transactionで
  保存する必要があるためである(PLANNER_SPEC 9.2.15)
- `plan === null` でもPersistence serviceを必ず呼ぶ。`plan === null` かつ
  `generatedBuildListEntries.length > 0` という不正resultをfail closedする
  authorityはservice側にあり、page側で `if (result.plan)` により分岐して
  service呼出しを飛ばさない。正常な `plan === null` / generated 0件では
  serviceが `null` を返し、既存の「計画なし」noticeを表示する
- CalculationContextはPlanner開始時とsave時で別に構成する。Worker計算完了後、
  Persistence呼出しの直前に `createPlannerCalculationContext()` を再度呼び、
  その結果をsave-time contextとして渡す。`input.calculationContext` /
  Planner開始時context / Worker resultのcontextをsave-time contextへ流用しない。
  同一manifest / engine versionであれば値は一致するが、境界としてsave時に
  current contextを再構成することを固定する
- 成功noticeのauthorityはPersistenceである。Worker resultにPlanがあっても、
  serviceが返したPlanでのみ成功表示を行い、Plan IDもservice戻り値のものを使う。
  Persistence errorは既存のerror表示経路へ流し、成功扱いしない
- `productionPlanRepository` の直接importはBuildListPageから除去した
- `activeRequestRef` / `PlannerCancelledError` / `cancelPlan()` / `dispose` の
  既存cancellation semanticsは変更していない。Persistence開始前と成功notice表示前に
  active requestであることを確認し、古いrequestの結果は保存・表示しない
- 競合UIはB10のscopeであり、本タスクでは実装していない。`createPlannerInput()` が
  `conflictResolutions: []` を作る契約も変更していない。したがって現行Production UIは
  explicit resolutionを持たず、constrained APIへ切り替えてもordinary result相当で
  終了し得る。これは仕様どおりであり、explicit resolutionの供給はB10が行う
- generated Entry用の新UI、競合表示、bounds入力UIは追加していない

`BuildListPageDependencies` の変更は次の1点である。

```text
savePlan(plan: ProductionPlan): Promise<unknown>
  -> savePlannerResult(
       result: PlannerOrchestrationResult,
       currentCalculationContext: CalculationContext,
     ): Promise<ProductionPlan | null>
```

default dependencyは `plannerResultPersistenceService.savePlannerOrchestrationResult`
へ接続する。

B8-D2bは次を変更していない。

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultPlannerOrchestrationBounds = 2 / 1 / 4
defaultCandidateSearchSettings
defaultPlannerOptions
```

DB schema bumpは不要である。

#### next

B9 what-if比較(4.17)、B10競合UI、B11 normal-tier Keep prediction semantics。

---

### 4.17 B9-A contract audit / B9-A2 contract decision

#### B9-A contract audit = 完了

B9 what-if比較の実装前に、既存authorityとB8実装の契約監査を行った。コード変更は無い。
確認した主な事実は次である。

- `PlanConflict.buildListEntryIds` は2件限定ではない。`detectPlannerConflicts()` は
  同一競合資源keyへ何unitでも束ねるため、3 participant以上は構造的に発生し得る
- constrained enumeratorの `compareConstrainedWorkItems()` は `categoryRank` を先頭
  比較keyに持つため、incremental delivery orderは「両stream Ideal一致のcellを全て、
  その後practical-onlyのcell」という順になる。これは
  `enumerateConstrainedCandidates()` が最後に適用する `compareConstrainedCandidates()`
  のfinal sorted orderと一致するとは限らない
- `createProductionPlanWithConstrainedSearch()` はwhat-ifへそのまま流用できない。
  1件adoptすると `currentAugmentedInput` / `currentPlannerResult` を更新して以降の
  workの基準が動き、workあたり最初の1件adoptで停止し、adoptionとPlan返却を行うため
- 仮想固定は既存 `PlannerInput.conflictResolutions` に乗せられる。`validatePlannerInput()`
  が空key・重複key・選択Entryの存在と有効性を既存規則で検証するため、B9専用の
  fixed authorityも新しいvalidation経路も要らない
- `PlanConflict.recommendedBuildListEntryId` の算出に使う `nextCandidateDistance()` は
  既存BuildListEntry集合内の `estimatedOperationCount` 差であり、再検索を伴わない。
  B9のwhat-if距離とは別物であり、B9は `recommendEntry()` を変更しない

監査で一意に決まらなかった論点は、次のB9-A2でproject ownerが決定した。

#### B9-A2 contract decision = 完了

B9-A2は仕様タスクである。変更したのは仕様文書だけで、`src/**`、テスト、build設定、
DB schemaは変更していない。契約本文は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.4.1〜9.2.4.13にある。確定した内容の要約。

| # | 決定 | 契約 |
| --- | --- | --- |
| distance baseline | Planner計算開始時の `ConstrainedSearchOrigin` からの既存estimate 4値だけを使う。競合位置起点・固定Candidate実行後State起点・新distance尺度・B9専用comparatorを禁止 | 9.2.4.1 |
| Practical / Ideal | 既存の排他 `CandidateCategory` で2枠を定義する。「次のPractical」は `category === 'practical'` を指し、同一Candidateが両枠を埋めない。Ideal ⇒ Practical包含不変条件は変更しない | 9.2.4.2 |
| 「次」のordering authority | 対象category内で `compareConstrainedCandidates()` 順に最小、かつPlanner full rerun + Trace Replayで共存可能性が証明されたCandidate。visitorのdelivery順をそのまま採用しない | 9.2.4.3 |
| 3 participant以上 | unique非固定Targetごとに独立評価。Target Bの解を採用した入力でTarget Cを測らない。評価順で距離が変わってはならない | 9.2.4.4 |
| scenario fixed authority | public requestは `plannerInput` / `scenarioResolution` / `bounds: PlannerWhatIfBounds`。同一 `conflictKey` のresolutionを置換し、他のexplicit resolutionは保持、無ければ追加。callerにB8 transient DTOを組ませない。requestへ `ConstrainedEnumerationBounds` を追加せず、Domain calculationが `PlannerWhatIfCalculationOptions.enumerationBounds` としてcaller必須で受け取る（B8-D1 / B8-E2bと同じ責務分離） | 9.2.4.5 |
| `reusedExisting` | B8の「trial消費・Beam再実行なし・不採用」を流用しない。既存semantic Entryをtrial Entryとして使い、scenario制約下でpreflight + full rerunして実行可能性を判定する | 9.2.4.6 |
| feasibility authority | trial Entryと全fixed Entryが `ProductionPlan.selectedBuildListEntryIds` に含まれること。簡易競合判定禁止。partial Planでも可 | 9.2.4.7 |
| transient only | BuildListEntry / ProductionPlan / what-if resultのいずれも永続化しない。resultへProductionPlanを含めず、Candidate IDやEntry IDを必須fieldにしない | 9.2.4.8 |
| `PlannerWhatIfBounds` | `maxCandidateTrialsPerCategoryPerTarget` / `maxPlannerReruns`。finite integer `>= 1`、caller必須、repair / clamp / field completion禁止。**B9-A2ではProduction defaultを定義しない**。1 trialは「対象categoryのCandidateをfeasibility判定対象として取り上げた時点」で消費し、`reusedExisting` / preflight reject / rerun reject / found はいずれも1消費、別category・found確定済みcategory・feasibility attempt未到達は消費しない。予期しないerrorはtrial rejectionへ変換せず既存error経路へ伝播する | 9.2.4.9 |
| enumeration bounds | `defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500` を変更しない。Production Worker adapterがWorker境界内でDomain calculationへ明示的に渡し、Domainはdefault substitution / fallback / clampを行わない。B9 benchmarkはまずこのextentで測る | 9.2.4.10 |
| result / no-result | `found` / `not_found_within_search_extent` / `stopped_by_enumeration_bound` / `stopped_by_candidate_trial_bound` / `stopped_by_planner_rerun_bound` をtyped unionで区別する。「見つからない」と「未確認」を同じ `null` へ潰さない。確定済み `found` を後からbound到達だけで無効化しない | 9.2.4.11 |
| warning | B8専用の4 `PlannerWarningKind` をB9で生成しない。B9のstop理由はB9専用typed statusで表す | 9.2.4.12 |
| cancellation | `cancelled` を `PlannerWhatIfOutcome` へ含めない。cancelはWorker / Client requestのcancellationとして扱い、partial resultを正常resultとして返さない | 9.2.4.12 |
| B9 / B10境界 | B9 = Domain計算 / bounds / Worker protocol / Production adapter / Client API / benchmark。B10 = Conflict選択UI / 距離表示 / 比較カード / 選択不可表示 / request起動 | 9.2.4.13 |

#### B9のtask分割

```text
B9-A   contract audit                                        完了
B9-A2  contract decision (本節、PLANNER_SPEC 9.2.4.1〜9.2.4.13) 完了
B9-B1  Domain what-if calculation。PlannerWhatIfBoundsは
       caller必須指定とし、Production defaultを定義しない
B9-C   Worker protocol / routing / Production adapter /
       PlannerWorkerClient API。永続化しない
B9-B2  実Browser Worker benchmark。PlannerWhatIfBoundsの
       Production default決定
```

`B9-B2` を `B9-C` の後に置くのは、B8-E2と同じく実Browser Workerでの計測にWorker境界が
必要なためである。

#### 変更していないもの

```text
src/**
tests
REQUIREMENTS domain meaning
SEARCH_SPEC constrained enumeration semantics
Candidate分類
Planner conflict detection
B8 orchestration
Worker protocol
DB / persistence
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
defaultPlannerOrchestrationBounds = 2 / 1 / 4
defaultCandidateSearchSettings
defaultPlannerOptions
```

#### next

B9-B1 Domain what-if calculation。B10競合UI、B11 normal-tier Keep prediction semantics
は従来どおり別Phaseである。

---

### 4.18 B9-B1a implementation record

B9-B1a = 完了。B9-B1のうちDomain foundationだけを実装した。Candidate enumeration、
materialization、full Beam trial loop、distance算出はB9-B1bである。契約本文は
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.4.1〜9.2.4.13にあり、B9-B1aはそのnormative
semanticsを変更していない。

#### 実装したもの

```text
src/domain/planner/constrained/plannerWhatIfBounds.ts
src/domain/planner/constrained/plannerWhatIfTypes.ts
src/domain/planner/constrained/plannerWhatIfScenario.ts
```

`PlannerWhatIfBounds` は `maxCandidateTrialsPerCategoryPerTarget` /
`maxPlannerReruns` の2値で、どちらもfinite integer `>= 1`。
`validatePlannerWhatIfBounds()` はpure validationで、repair / clamp /
field-wise completionを行わない。`assertPlannerWhatIfBounds()` は
`PlannerWhatIfBoundsError` でfail closedする。`validatePlannerOrchestrationBounds()`
と同じ形にそろえたが、型は別である。

**Production defaultは定義していない。** `defaultPlannerWhatIfBounds` は存在せず、
`defaultPlannerOrchestrationBounds = 2 / 1 / 4` も `CandidateSearchSettings` も
流用していない (9.2.4.9)。テストは public Domain surface に
`defaultPlannerWhatIfBounds` が無いことを確認する。

public Domain typeは `PlannerWhatIfRequest` / `PlannerWhatIfCalculationOptions` /
`PlannerWhatIfDistance` / `PlannerWhatIfOutcome` /
`PlannerWhatIfTargetComparison` / `PlannerWhatIfComparison` /
`PlannerWhatIfCalculationResult` を定義した。requestへ
`ConstrainedEnumerationBounds` を入れず、Domain calculation側の
`PlannerWhatIfCalculationOptions.enumerationBounds` をcaller必須にした
(9.2.4.5 / 9.2.4.10)。resultに `ProductionPlan` は含めず、Candidate IDと
generated Entry IDも必須fieldにしていない。`cancelled` は
`PlannerWhatIfOutcome` に含めない。

failureは `planner_input_not_ready` と `invalid_fixed_resolution` のtyped result
とした。後者の `reason` は `scenario_resolution_not_valid` /
`fixed_constraints_unresolved` / `scenario_constraint_missing` である。
`detail` はdiagnostic文字列であり、control authorityはあくまでtyped
status / reasonである。

#### scenario resolution merge

`mergePlannerWhatIfScenarioResolution()` は同一 `conflictKey` のresolutionを
scenarioで置換し、他のexplicit resolutionを保持し、keyが無ければ追加する。
元 `PlannerInput` とその配列をmutateしない。

malformed inputをrepairしない。元inputに同一 `conflictKey` が2件あればmerge後も
2件のまま残し、`validatePlannerInput()` の重複key検出でfail closedできる状態を
維持する。merge自体はvalidation bypass、duplicate repair、invalid resolution削除の
いずれも行わない。

#### scenario preparation

`preparePlannerWhatIfScenario()` の順序は次である。既存authorityを再利用し、
validation / initial state / entry relevance / route unit plan / conflict detection
のいずれも複製していない。

```text
assertPlannerWhatIfBounds
  -> mergePlannerWhatIfScenarioResolution
  -> preparePlannerInitialContext
  -> scenario exact pairがvalidConflictResolutionsに残っているかを確認
  -> createPlannerConstrainedConflictContexts
  -> preparePlannerFixedConflictConstraints (valid explicit resolution全件)
  -> scenario constraintをexactly one特定
  -> createConstrainedSearchOriginFromPlannerInput
  -> createPlannerConflictWorks([scenarioConstraint], conflictContexts)
```

`preparePlannerInitialContext()` が `ready` でも、scenarioが有効とは限らない。
`validatePlannerInput()` は選択Entryがmissing / stale / excludedのresolutionを
warningだけ出して `validConflictResolutions` から落とすため、ready取得後に
`(conflictKey, selectedBuildListEntryId)` のexact pairが残っているかを確認し、
無ければ `scenario_resolution_not_valid` でfail closeする。別Entryは選ばない。

fixed constraintはvalid explicit resolution**全件**から構築する。1件でも構築できな
ければB8と同じall-or-nothingで `fixed_constraints_unresolved` とし、comparisonを
開始しない。

what-if subjectはscenario conflictだけなので、work生成は
`createPlannerConflictWorks([scenarioConstraint], conflictContexts)` である。
全fixed constraintを渡すと他のexplicit resolutionまでwhat-if対象になるため行わない。
他のfixed constraintsはB9-B1bのpreflight / full rerun feasibility制約として
`PreparedPlannerWhatIfScenario.fixedConstraints` に保持する。

`PlanConflict.recommendedBuildListEntryId` がscenario選択と別Entryを指していても、
固定されるのは `scenarioResolution.selectedBuildListEntryId` だけである
(9.2.7)。score / bestState / priority / category / similarityも固定authorityに
していない。

`PreparedPlannerWhatIfScenario` はinternal transient typeであり、
`plannerWhatIfScenario.ts` からのみ提供する。`constrained/index.ts` からは
`plannerWhatIfBounds` と `plannerWhatIfTypes` だけをexportし、不要なpublic surfaceを
増やしていない。

#### テスト

```text
src/domain/planner/constrained/plannerWhatIfBounds.test.ts
src/domain/planner/constrained/plannerWhatIfScenario.test.ts
```

bounds: `1 / 1` とpositive integerがvalid。0 / negative / fraction / NaN /
Infinity / -Infinity がinvalid。invalidで `PlannerWhatIfBoundsError`。input
mutationなし。default substitutionなし。`defaultPlannerWhatIfBounds` 不在。

merge: replace / add / 元input未変更 / 無関係fieldの保持 / malformed duplicateの
保持、および保持したduplicateが `planner_input_not_ready` へ落ちること。

preparation: valid scenarioでready contextが `mergedInput` / origin /
all fixed constraints / scenario constraint / scenario-only worksを持つこと。
originがPlanner-start snapshotのみで構成されること。3 participantでunique非固定
Targetごとに1 workになること。scenario以外のvalid resolutionが保持され、works
だけがscenario conflict由来になること。request inputをmutateしないこと。

failure: scenario validation drop → `scenario_resolution_not_valid` かつ代替Entry
選択なし。conflict未検出 / 選択Entryが非participant → `fixed_constraints_unresolved`。
invalid Planner options → `planner_input_not_ready`。invalid bounds → throw。

inference prohibition: `recommendedBuildListEntryId` がscenario選択と異なる場合でも、
scenario選択だけがfixed constraintになること。

#### B9-B1bに残るもの

```text
enumerateConstrainedCandidates / visitConstrainedCandidates
compareConstrainedCandidates順のCandidate走査
Candidate materialization trial loop
trial counting (category / Target単位)
reusedExisting feasibility
preparePlannerAugmentedConflictPreflight呼出し
createProductionPlanWithObserver によるfull rerun + Trace Replay
Beam budget消費
PlannerWhatIfDistance算出とoutcome判定
```

Worker protocol / Production adapter / PlannerWorkerClient / UI / Persistence /
benchmark / Production defaultはB9-C以降で、B9-B1aでは触っていない。

#### 変更していないもの

```text
PLANNER_SPEC normative semantics
B8 orchestration semantics
createProductionPlanWithConstrainedSearch behavior
plannerOrchestrationBounds / defaultPlannerOrchestrationBounds = 2 / 1 / 4
ConstrainedEnumerationBounds / defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
Search constrained enumeration / compareConstrainedCandidates / materializer
augmented preflight / Beam Search / Trace Replay
Worker protocol / PlannerWorkerClient / BuildListPage
Persistence / Dexie / ProductionPlan / BuildListEntry shape
Candidate category semantics
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
defaultCandidateSearchSettings / defaultPlannerOptions
```

#### next

B9-B1b Domain what-if calculation本体。B9-C Worker / adapter / client、
B9-B2 benchmarkとProduction default決定、B10競合UI、B11 normal-tier Keep prediction
semanticsは従来どおり別タスクである。

---

### 4.19 B9-B1b implementation record

B9-B1b = 完了。B9 Domain what-if calculation本体を実装した。public entry pointは
`createPlannerWhatIfComparison()` で、B9-B1aの `preparePlannerWhatIfScenario()` を
そのまま前段として使用する。scenario preparationがreadyでない場合は、その typed
failure result をそのまま返す。

#### ordering

```text
Target処理順   PreparedPlannerWhatIfScenario.works の既存stable order
Target内順     practical -> ideal
category内順   compareConstrainedCandidates()
```

`practical -> ideal` は共有 `maxPlannerReruns` の消費順を固定するexecution scheduling
authorityであり、Candidate semantic ordering authorityではない。この実行順だけを
[PLANNER_SPEC.md](./PLANNER_SPEC.md) 9.2.4.9へ最小追記した。9.2.4.1〜9.2.4.13の
normative semanticsは変更していない。

#### enumeration

`enumerateConstrainedCandidates()` を使用する。`visitConstrainedCandidates()` の
incremental delivery orderは最終 `compareConstrainedCandidates()` 順と一致するとは
限らないため(4.3)、collector形の最終sorted orderをB9のordering authorityとした。
`options.enumerationBounds` はcaller supplied値をそのまま渡し、default substitution /
fallback / clamp / field-wise completionを行わない。`CandidateSearchSettings`、
`resultFilter`、similar filter、`maxCandidatesPerTarget`、canonical Ideal early-stop、
initial Search pruning、Practical dominanceはいずれも持ち込んでいない。

#### independence

全Target・全Candidate trialが同じbaseline(`scenario.mergedInput` /
`scenario.origin` / `scenario.fixedConstraints`)から開始する。B8の
`currentAugmentedInput` 更新、adopted generated Entry累積、`currentPlannerResult`
更新に相当する状態は持たない。B9は何もadoptしない。

#### trial semantics

1 trialは「対象categoryのCandidateをfeasibility判定対象として取り上げた時点」で
1消費する。materialization成功後ではない。`reusedExisting` のCandidateは重複Entryを
追加せずtrial inputを `mergedInput` のままとするが、preflightとfull Planner rerunは
実際に行い、その結果でfeasibilityを判定する。preflight rejectはそのCandidateだけを
rejectし、trialを1消費してBeamは0消費する。preflightへは
`scenario.fixedConstraints` 全件を渡す。

feasibility authorityは
`plan !== null` かつ `plan.selectedBuildListEntryIds` が trial Entry と全fixed Entry を
含むこと(`isPlannerWhatIfCandidateFeasible()`)だけである。`completed === true` は
要求しない。距離は `ConstrainedCandidate` の既存estimate 4値をそのまま返す。

#### Beam budget

B9専用の `PlannerWhatIfFullBeamBudget` / `PlannerWhatIfRerunLimitError` を新設した。
B8の `PlannerOrchestrationBounds` / `PlannerOrchestrationLimitError` は流用していない。
`limit = request.bounds.maxPlannerReruns`。Candidate trialのfull Beam Searchと
Production Plan生成内部のruntime unsupported retry Beamだけを数え、preflight /
validation / conflict context生成 / enumeration / materializationは数えない。B9は
initial ordinary Planner runを行わない。

`used === limit` に到達しただけではbound statusにしない。上限到達後に実際にBeam開始が
阻止された場合だけ `stopped_by_planner_rerun_bound` とする。ただしTarget評価開始前に
budgetが完全消費済みの場合は、そのTargetのenumeration / materialization / preflightを
開始せず両slotをrerun boundとする(9.2.4.9)。Candidate 0件のcategoryはBeam不要なので
enumeration summaryだけでstatusを確定する。

#### outcome precedence

```text
found
stopped_by_candidate_trial_bound
stopped_by_planner_rerun_bound
stopped_by_enumeration_bound
not_found_within_search_extent
```

trial boundも「limitを使い切ったうえで同categoryに未試行Candidateが残っている」場合
だけとする。同じ次Candidateをtrial capとrerun capの双方が阻止する場合はtrial capを
優先する。`exhausted === false` かつ `stoppedByBound === false` はcollector経路では
発生しないため、そのケースはinvariant failureとしてerrorを伝播し、B9 statusへ変換
しない。

#### cancellation

`cancelled` は `PlannerWhatIfOutcome` にも正常resultにも含めない。request
cancellationは `PlannerWhatIfCancelledError` のthrowで終える。Search側の
`CandidateSearchError('cancelled')` だけをこれへnormalizeし、その他の
`CandidateSearchError` / `ConstrainedSearchError` / RNG error / invariant errorは
そのまま伝播する。Beam cancellationは `afterBeamSearch(result).cancelled` で検知し、
`plan: null` をCandidate rejectとして扱わずrequest全体を終了する。partial comparison
は返さない。

#### persistence

なし。materializeしたEntryはtrial input専用で、破棄する。Dexie / repository /
persistence serviceは呼ばない。resultへ `ProductionPlan`、Plan ID、PlanStep ID、
Candidate ID、generated BuildListEntry ID、`createdAt`、runtime OwnedWeapon IDは
含めない。

#### Production default

作っていない。`defaultPlannerWhatIfBounds` はB9-B2のbenchmarkまで存在しない。

#### 追加ファイル

```text
src/domain/planner/constrained/plannerWhatIfCalculation.ts
src/domain/planner/constrained/plannerWhatIfCalculation.test.ts
src/domain/planner/constrained/plannerWhatIfRerunBudget.ts
src/domain/planner/constrained/plannerWhatIfRerunBudget.test.ts
```

#### public API boundary

`src/domain/planner/constrained/index.ts` がbarrelから公開するB9-B1b APIは次の2つだけ
である。

```text
createPlannerWhatIfComparison
PlannerWhatIfCancelledError
```

次はB9内部実装として barrel export しない。

```text
PlannerWhatIfFullBeamBudget
PlannerWhatIfRerunLimitError
createPlannerWhatIfFullBeamBudget
isPlannerWhatIfCandidateFeasible
plannerWhatIfEnumerationOutcome
```

責務は次のとおり分ける。

```text
public   what-if calculation entry point と cancellation signal
internal shared Beam budget / feasibility helper / enumeration outcome helper
```

`plannerWhatIfRerunBudget.ts` はbarrel exportしない。テストは対象moduleを直接
importする。

#### 既知のテスト限界

`stopped_by_planner_rerun_bound` を「Production Plan生成内部のruntime unsupported
retry Beamが阻止された」経路で起こす統合fixtureは作っていない。retry Beamがbudgetを
消費すること、および limit 1 で retry Beam が
`PlannerWhatIfRerunLimitError` により阻止されることは、既存の
`runtimeUnsupportedFixture()` と実際の `createProductionPlanWithObserver()` に対する
budget統合テストで検証している。そこから先(typed signalをcatchして
`stopped_by_planner_rerun_bound` を返し、途中Beam結果を採用しないこと)は、
what-if calculation側の同一catch経路をconflict fixtureで検証している。

`not_found_within_search_extent` は、`enumerateConstrainedCandidates()` が
`exhausted === true` を返すconflict fixtureを構成できなかったため、
`plannerWhatIfEnumerationOutcome()` の単体テストで検証している。統合経路では
`stopped_by_enumeration_bound` 側を検証した。

#### next

B9-C Worker / adapter / client、B9-B2 benchmarkとProduction default決定、
B10競合UI、B11 normal-tier Keep prediction semanticsは従来どおり別タスクである。

---

### 4.20 B9-C implementation record

B9-C = 完了。B9-B1bの `createPlannerWhatIfComparison()` を既存Planner Worker経路へ
接続した。Domain what-if semantics、Persistence、UIは変更していない。

#### Worker protocol / routing

`src/workers/plannerWorkerContracts.ts` のWorker-layer protocolへ次を追加した。

```text
request   create_what_if_comparison
            input PlannerWhatIfRequest
response  create_what_if_comparison_result
            result PlannerWhatIfCalculationResult
```

wire上の `input` は `plannerInput` / `scenarioResolution` /
`bounds: PlannerWhatIfBounds` だけで、余計なwrapperを持たない。
`ConstrainedEnumerationBounds`、RngEngine、Clock、ID Factory、function、observer、
runtime dependencyはWorker requestを横断しない。

`planner.worker.ts` は `create_plan` / `create_constrained_plan` /
`create_what_if_comparison` の明示3分岐とし、what-ifをordinary fallbackとして扱わない。
controllerはmessage routingだけを担当し、enumeration、materialization、preflight、
Beam Search、Trace Replay、outcome判定、distance算出を実装しない。

#### generation / cancellation / progress / error

ordinary / constrained / what-ifは同じlogical `requestId` namespaceとClient-minted
monotonic `generation` sequenceを共有する。WorkerとClientはrequestIdとgenerationの
両方がcurrentなmessageだけを扱い、stale generationのprogress / result / errorは
silent ignoreする。同generationのresult discriminant mismatchだけを
`PlannerWorkerProtocolError` とする。

`cancelPlan(requestId)`、generation付き `cancel`、`shouldCancel()` をwhat-ifでも再利用する。
cancelled generationはresult / progress / errorをpostしない。Domainの
`PlannerWhatIfCancelledError` のmessageはcontrol authorityにせず、current generationが
実際にcancelled / retiredかどうかをauthorityとする。currentな非cancelled taskが同Errorを
throwした場合は既存 `error` responseへ流し、Promiseをpendingのまま残さない。
progressは既存 `PlannerProgress` / `progress` responseだけを共有する。

#### Production adapter / Client

`createProductionPlannerWhatIfComparison()` はcallerの `PlannerWhatIfRequest` と
`request.bounds` を変更せずDomain calculationへ渡し、Search Domain authorityの
`defaultConstrainedEnumerationBounds` だけをoptionsへ明示供給する。adapter内へ
40 / 30 / 100 / 500を複写していない。

`PlannerWhatIfBounds` は引き続きcaller-requiredである。repair / clamp / completion /
fallbackは行わず、`defaultPlannerWhatIfBounds` は定義していない。
`defaultPlannerOrchestrationBounds` もwhat-ifへ流用していない。

`PlannerWorkerClient.createWhatIfComparison(requestId, request, callbacks?)` は
`PlannerWhatIfRequest` をそのままwireへ渡し、既存pending union、progress、error、
duplicate requestId、cancel、dispose、protocol mismatchの契約へ参加する。
Worker unavailable時は `ProductionPlannerWorkerUnavailableError` でrejectし、
main-thread fallback計算を行わない。

#### scope / next

BuildListEntry、ProductionPlan、what-if resultの保存は行わず、IndexedDB / Dexie /
repository / UI / B10 wiringは変更していない。次はB9-B2の実Browser Worker benchmarkと
`PlannerWhatIfBounds` Production default決定である。

---

### 4.21 B9-B2a implementation record

B9-B2a時点: harness = 完了。B9-B2b real Browser measurement = pending。
B9-B2c Production default decision / implementation = pending（UNDECIDED）。
後続B9-B2b / B9-B2cは4.22章で完了を記録する。

`plannerWhatIfBenchmarkFixtures.ts` がB8のProduction-valid origin / Master / source生成を
再利用し、到達可能なIdeal条件と通常Domain factory経由のCandidate / Entryを構築する。
Gogma競合のtrial pressure、Skill競合の排他Practical / Ideal、3 participantのrequest-global
rerun budget、5 Targetsと複数explicit resolutionの4 workloadを追加した。

`plannerWhatIfBrowserBenchmark.ts` はfresh Production Planner Worker Clientの
`createWhatIfComparison()` callからPromise settleまでを計測する。fixture、validation、
Worker constructor、dispose、outcome normalizationは計測外。request時点で残るWorker async
initialization、structured clone、Production計算と配送は計測内。requestへenumeration
boundsを追加せず、Production adapterが既存authorityをWorker内で供給する。

`plannerWhatIfBenchmarkOutcome.ts` はtyped statusとdistance 4値だけを中心にsemantic keyと
bound診断を作る。alternativesのDomain stable orderを保持し、B8 warningをauthorityにしない。
`PlannerWhatIfBenchmarkPage.tsx` と `globalThis.b9WhatIfBenchmark` はbenchmark-only。
BenchmarkAppにタブを追加し、C5既定選択と既存4 harness、通常UIは変更していない。

非性能のProduction意味テストでT感度、両categoryのfeasibility、3 participantのR感度を
確認した。実Browser測定値はまだ存在しない。測定gridはProduction defaultではなく、
`defaultPlannerWhatIfBounds`、fallback、B10 wiring、Persistence、Domain semanticsは追加・
変更していない。既存B8 raw artifactを触らず、B9 raw artifactも作成していない。

構築方法、意味検証結果、coverage gap、B9-B2b予定手順は
[B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md](./B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md)
に記録した。PLANNER_SPEC 9.2.4.1〜9.2.4.13のnormative契約は変更していない。

---

### 4.22 B9-B2b measurement / B9-B2c Production default implementation record

B9-B2b real Browser measurement = 完了。
B9-B2c Production default decision / implementation = 完了。

#### 実測と決定

build commit `5368b3b`、Windows 11 / Chrome 152 / hardwareConcurrency 16、
`production-rng:c5-e2`、enumeration bounds 40 / 30 / 100 / 500で測定した。
B9専用real Production Browser Workerの140 records（401,316 bytes）が証拠である。
主要sweep、finalist各5 measurement、測定境界とcoverage gapの詳細authorityは
[B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md](./B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md)
9〜11章とする。

- T=2はtwo_targets / dual_categoryで必要なPracticalを得る最小測定値。T>2でsemantic改善を
  観測しなかった。
- R=6はthree_targetsで4 / 4 foundの最小測定値だが、combinedでは1slotがrerun bound。
  R=8なら全4slotがT=2のcandidate trial boundまで到達する。
- finalistのcombined中央値は2 / 6が5827.1 ms、2 / 8が5934.7 ms。+107.6 ms（約1.8%）を
  許容してTarget / category間の評価機会を優先し、**2 / 8** を採用した。
- combinedのfoundは0のまま。Candidate不存在の証明ではなく、coverage gapは継続する。

#### 実装と契約

`src/domain/planner/constrained/plannerWhatIfBounds.ts` に
`defaultPlannerWhatIfBounds = { maxCandidateTrialsPerCategoryPerTarget: 2, maxPlannerReruns: 8 }`
を追加した。既存のconstrained / Planner barrelを通じて公開し、barrel自体の変更は不要だった。
PLANNER_SPEC 9.2.4.9をdefault確定後の契約へ更新し、Worker mappingの説明も同期した。
B8 default 2 / 1 / 4の流用ではなく、`ConstrainedEnumerationBounds` と独立した値である。

`PlannerWhatIfRequest.bounds` はcaller-requiredのまま。Domain / Worker adapter / Clientは
implicit fallback、repair、clamp、field-wise completionを行わない。Workerはrequestをそのまま
渡し、`defaultConstrainedEnumerationBounds` だけを内部供給する。rerun budget / adapterの
古いコメントは更新したが挙動は変えていない。

bounds testはdefault 2 / 8、validation / assertion通過、public export、non-default値の保持、
不正値と欠損fieldのfail closedを固定する。既存のinvalid値検証とB8 default確認は維持した。
request shape、Worker protocol、Planner algorithm、Candidate enumeration、RNG、Persistence、
B10 UI、既存default群、schema / Engine versionは変更していない。

raw evidenceのB8 / B9両fileは変更・削除・stage・commitせずローカルに保持する。
B10 Application callerのdefault選択・what-if起動と表示は後続作業である。

---

### 4.23 B10-A UI / Application contract decision

B10-A = 完了。B9 Domain / Worker契約をProduction Plan画面へ接続する前に、Conflict選択、
what-if preview、current state authority、cancellation、明示選択後のPlanner再計算と保存の
境界を仕様へ固定した。B10-Aはdocs-onlyであり、Production UI、Application service、Worker、
Domain、Persistence、DB schema、テストコードは変更していない。

正式契約本文は次に置く。

```text
REQUIREMENTS.md   23章
PLANNER_SPEC.md   9.2.4.14
UI_FLOW.md        11.1〜11.4
```

#### authority分離

`/plans/:planId` が表示するPlanは、routeの `planId` で
`ProductionPlanRepository.getProductionPlan(planId)` から取得した保存済みPlanだけである。
該当Planが無い場合にActive / latest Planを推測しない。

```text
Conflict表示         persisted ProductionPlan.conflicts
what-if / 再計算入力 操作開始時のcurrent persisted stateからcreatePlannerInput()でfresh構築
```

`baseSnapshot` はcompatibility / audit authorityであり、PlannerInput復元元ではない。古い
Planner Worker inputと過去のSearch requestも再利用しない。

`createPlannerInput()` のcurrent実装は `conflictResolutions: []` を返すため、B10
Applicationは表示中Planの `conflicts[].selectedBuildListEntryId !== null` だけを既存の
ユーザー明示resolutionとしてfresh inputへ設定する。`recommendedBuildListEntryId`、score、
bestState、priority、category、similarity、`selectedBuildListEntryIds` からfixed choiceを
推論しない。

#### participantとwhat-if

Conflict participantは原則全件表示する。current stateで利用不能なEntryも消さず、disabledと
reasonを表示する。B10-Bはfresh PlannerInputとexplicit resolution復元後、Production Planner
dependenciesを持つPlanner Workerで既存 `preparePlannerInitialContext()` 相当の処理を実行する。
`validatePlannerInput()`、current initial Planner state準備、current initial Conflict detectionを
Worker側へ置き、UI / main threadで `ProductionRngEngine` を生成しない。

Workerは内部 `PlannerInitialContext` をwireへ漏らさず、ready / invalid、valid Entry IDs、excluded
EntryのID + 表示用reason、current initial ConflictのID + participant Entry IDsからなる
structured-clone可能なB10 projectionを返す。正確なrequest / result / Client型名はB10-Bで決めてよい。
B9の `create_what_if_comparison` requestへvalidation fieldを追加せず、availabilityだけのために
what-if calculationを実行しない。B10専用のtyped Planner Worker request / Client APIは追加してよい。

persisted Conflictは表示authorityとして維持するが、同じConflict IDがcurrent initial Conflictに
存在し、対象Entryがそのparticipantであり、current persistenceに存在してvalidな場合だけB10操作を
許可する。current initial Conflictに無いConflictは表示を維持して両操作をdisabledにし、現在の
Planner入力では再現できない旨と再計算導線を示す。既存Target validation、BuildListEntry staleness、
CalculationContext compatibility、Planner validation / exclusionを再利用し、新しいDomain ruleを
追加しない。Capability / prediction support / protection等もtyped projectionをauthorityとし、
表示用reasonは表示してよいがmessage解析で分岐しない。preparationがinvalidの場合もすべての
Conflict操作をfail closedでdisabledにする。

preparation requestも既存Planner WorkerのrequestId / generation / stale response rejectionまたは
ignore / dispose / cancelの考え方へ揃え、古い結果でcurrent availabilityを上書きしない。

「比較する」はtransient previewで、「この候補を優先」と分離する。比較対象participantだけから
`scenarioResolution` を作り、Application callerが
`defaultPlannerWhatIfBounds = 2 / 8` を明示指定する。what-ifはPlan、Entry、resolution、
comparison、trial Entryのいずれも保存しない。

UIは `idle` / `loading` / `completed` / `failure` を区別し、別participant、別Conflict、page離脱、
Planner再計算で不要requestをcancelする。B9-CのrequestId / generation / stale response semanticsを
再利用し、cancelをerror表示せずpartial resultを表示しない。

comparisonはDomainの `alternatives` stable orderを維持し、TargetごとのPractical / Idealを
独立した2枠として表示する。`found` の主距離は `estimatedOperationCount`。残る3 advanceは
絶対Counterではなく進行量である。4種類のtyped no-resultを「候補なし」へ潰さず、comparison
全体の `planner_input_not_ready` / `invalid_fixed_resolution` もtyped failureとして扱う。

#### explicit choice、B8再計算、保存

what-if成功は選択のgateではない。有効participantは比較せず「この候補を優先」できる。
disabled participantはwhat-if成否にかかわらず選択できない。明示選択時だけscenario resolutionを
作り、他Conflictの既存explicit resolutionを保持し、同一keyを今回選択で置換する。

選択後はB9結果をPlan生成へ流用せず、fresh PlannerInputでB8 constrained Plannerを再実行する。
Application callerが `defaultPlannerOrchestrationBounds = 2 / 1 / 4` を明示指定する。
結果にtyped `invalid_conflict_resolution` warningが1件でもあれば、`plan !== null` のordinary result
でもfail closedとし、`savePlannerOrchestrationResult()` を呼ばない。Entry / Planを保存せず、遷移せず、
旧Planを維持して再選択または再計算を促す。warning.message解析、Planner推奨へのfallback、別候補の
自動選択、invalid resolutionを無視したordinary Plan保存は禁止する。

上記warningが無い場合だけ、既存 `savePlannerOrchestrationResult()` のgenerated Entry +
ProductionPlan atomic transactionを使う。新Plan保存時はそのPlanへ遷移し、Planなしまたは保存失敗時は
旧Planを置換・削除しない。

B10編集対象は原則Draft Planである。staleは既存再計算へ誘導し、active / completed / abandonedを
B10操作で変更しない。

#### B10 task split

```text
B10-A  UI / Application契約確定（本節）                         完了
B10-B  ProductionPlanPageのroute Plan読込、fresh PlannerInput、
       explicit resolution復元、Worker-side current interaction preparation、
       participant / current Conflict availability                    未実装
B10-C  what-if request起動、async state、cancel、typed comparison card  未実装
B10-D  「この候補を優先」、B8 constrained再計算、atomic保存、
       invalid resolution fail-closed、新Plan遷移、status guard、
       統合 / responsive test                                          未実装
```

B10-Bは表示authorityとcurrent calculation inputを確立し、B10-Cは保存を伴わないpreviewだけを
追加する。B10-Dで初めて明示選択をB8 Plan生成と既存atomic persistenceへ接続する。この順序により、
what-if trial結果をPlanまたはBuild Listへ誤採用する経路を作らない。

#### 変更していないもの

```text
src/**
B9 Domain what-if semantics
B9 create_what_if_comparison request / result shapeとdefault責務
B8 constrained Planner / orchestration / atomic persistence
defaultPlannerWhatIfBounds = 2 / 8
defaultPlannerOrchestrationBounds = 2 / 1 / 4
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
```

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
10. ~~`createBuildCandidateMeaningFingerprint()` がrestoration bonus scopeを含まない~~
    (B8-Aで判明)。B8-C2で解消済み。fingerprintへ `restorationBonusScope` を追加し、
    同一ラベル5枠のnormal scope Candidateとgogma scope Candidateを別意味として扱う
    (4.7、`docs/PLANNER_SPEC.md` 9.2.12)
11. ~~`createBuildListEntry()` の既定Entry ID生成が `createdAt` を含むため、
    Planner-generated Entryの決定的ID生成へそのまま流用できない~~ (B8-Aで判明)。
    B8-C2で解消済み。通常経路の既定挙動は変更せず、generated Entry専用の
    deterministic ID helperを用意し、IDと `createdAt` を明示指定して呼ぶ(4.7)

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
