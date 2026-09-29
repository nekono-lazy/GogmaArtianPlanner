# Global Planner Research Phase 2-C2.5-D1（Ideal-only publicationのsemantic feasibility）

Refs #154。Researchであり、memory optimizationは実装していない。Production source / Search algorithm / retention / Candidate
ordering / reservation / Planner / RNG / Worker protocol / defaults / schema / version / UI / Persistence は変更していない。
formal spec（`docs/REQUIREMENTS.md` / `docs/SEARCH_SPEC.md` / `docs/PLANNER_SPEC.md`）も変更していない。

## 結論

**verdict: `feasible`**

Planner Alternative policyのheld-aware stream publicationを「全stream positionは従来どおり生成・予測・Ideal判定するが、
scheduler channelへmaterializeしてpublication / retainするのはIdeal positionだけ」（以下 **Ideal-only publication**）に変えても、
正式仕様の要求とCandidate-visible semanticsを完全に保てることを、consumer監査・late subscriber監査・順序の証明・
characterization testで確定した。

- Planner Alternative policyで `EvaluatedBonusSolution` / `EvaluatedSkillSolution` を受け取るsemantic consumerは
  `createLazyIdealCross()` の `addBonus` / `addSkill` だけであり、どちらも非Idealを即 `return` する（§5、source audit test）。
  非Ideal solutionのpublication / replayは全subscriberでno-opである。
- late subscriber（queue settle中に `addBase()` されるRoute base）は実在し、`channel.retained` によるIdeal solutionのreplayは
  必要である（§6、実schedulerでのtest）。非Idealのreplayは不要である。
- Ideal predicateはraw solutionの `bonuses` + `restorationBonusScope`（Bonus）、`seriesSkillId` + `groupSkillId`（Skill）だけで
  既存authority（`satisfiesIdealBonuses()` / `evaluateSkillCondition()`）により判定できる（§7）。
- 「全件evaluate → sort → Idealだけ使う」と「Idealだけfilter → evaluate → sort」は、Ideal solutionの相対順序が完全に一致する
  （安定sort + 要素単独のkey比較による証明と、順列testで確認。§8）。`index` はPlanner Alternative経路のどこからも読まれない。
- notice、extent / exhausted、prediction呼び出しはraw stream側で決まり、evaluation / publicationから独立している（§9）。
- 正式仕様（`SEARCH_SPEC.md` 5.6.8）は非Ideal solutionのscheduler channelへのpublicationを要求していない。「every stream position is
  published」はformal specではなく実装コメントの文言である（§10）。D2では実装コメントを直す。formal specへの明確化文言は
  **推奨するが必須ではない**（D2の実装PRかそれ以前のspec PRでの採否はレビューで決める）。

削減できるのは「Ideal判定後に初めて不要と分かるmaterialization / retention」だけである。raw held-aware state、`set.depths` と
その `steps[]`、result node chain、stream生成中のin-flight配列は残る。特にdeep型（c0-p0）の `set.depths` の `steps[]` はdepthに
比例するpointer配列として残り、shallow型（c12-p0）のstream生成burstも残るので、D2だけでOOMが解消するとは主張しない（§12、§18）。

## 1. 目的

Phase 2-C2.5-Cは、OOM代表3 contextのmemory growthがheld-aware Bonus publication（scheduler `bonusChannel` の `settle`）に集中し、
`channel.retained` が保持するBonus解のほぼ全件が非Idealであることを示した。本Phaseは、非Ideal positionの高価なRoute materialization
（`operations` / `amendmentResults`）・semantic key生成・`channel.retained` 保持を省いても、Planner Alternativeの全consumer・
late subscriber・ordering・extent・notice・prediction契約と正式仕様を保てるかを、推測ではなくコードとテストで確定する。
実装はD2で行う。

## 2. authority

`AGENTS.md` の階層に従う: `docs/REQUIREMENTS.md` → task-specific spec（`docs/SEARCH_SPEC.md` 5.6.8 / 5.6.4 / 5.5.2 / 5.5.3 / 13.2.6、
`docs/PLANNER_SPEC.md` 9.2.19）→ 実装 → テスト → Research文書。Research文書（本書、C2.5-A / B / C）はauthorityではない。

## 3. C2.5-Cからの入力事実

| 事実 | c0-p0（deep） | c12-p0（shallow） | c2-p1（shallow） |
| --- | ---: | ---: | ---: |
| jit_default `settle` inclusive | 87.6% | 77.8% | 78.6% |
| `channel.retained` edge-cut（新規bytes / 到達分） | 83.8% / 84.2% | 14.3% / 34.3% | 55.5% / 63.8% |
| in-flight（新規bytesのうちscheduler未到達） | 0.5% | 58.2% | 13.0% |
| operations + amendmentResults edge-cut | 50.7% | 25.6% | 27.7% |
| operationTypeKey + retentionKey + bonusKey edge-cut | 27.9% | 37.2% | 30.5% |
| `set.depths`（H1）edge-cut | 11.7% | 3.4% | 14.3% |
| `steps`（H2）edge-cut | 8.8% | 11.4% | 13.6% |
| Bonus `channel.retained` 件数 / うち `idealMatch=true` | 135,580 / 2 | 53,048 / 1 | 196,474 / 0 |
| Skill `channel.retained` 件数（全件false） | 8 | 12 | 4 |

no_inlining diagnostic attributionでは、deep型は `bonusAmendmentOperations`、shallow型はkey文字列（`serializeStable` /
`compareStableKeys`）が最大。これはdiagnosticであり、Production-like heapの割合ではない（C2.5-C §6）。snapshotは512 MB時点で
取得したもので、OOM時点の内訳ではない。

## 4. current publication pipeline

`TargetSearchScheduler`（`src/domain/search/targetSearchScheduler.ts`）のPlanner Alternative分岐（`policy === 'planner_alternative'`）。

### Bonus（`bonusChannel()` の `settle`、1 depth分）

```text
reserved = bonusStream.readReservedDepth(base, depth)          # raw held-aware state。bonusStream側の set.depths に永続保持
for solution of reserved.solutions: publishNotice(route_kind)   # rawから（evaluation前）
for prediction of reserved.unsupportedPredictions: publishNotice(unsupported)
solutions = reserved.solutions.map(s => RouteBonusSolution {    # 全件materialize
  operations: bonusAmendmentOperations({ steps: s.steps }, s)   #   steps.slice(0, depth) + depth個のRouteOperation
  amendmentResults: bonusAmendmentResults(s)                    #   result chainを辿るdepth長配列（整合性assert付き）
})
evaluateBonusSolutions(target, input, solutions)                # 全件: idealMatch / matchedIdealBonusCount /
                                                                #   materialQuantity / bonusKey / retentionKey /
                                                                #   operationTypeKey → sort → {...e, index}
for value: channel.retained.push(value); subscribers(value)      # 全件retain・全件通知
if !reserved.exhausted: next(depth + 1)
else if reservedReachesBeyondExtent(base): noteExtentReached()
```

### Skill（`skillChannel()` の `settle`）

```text
reserved = skillStream.readReservedDepth(start, depth)          # raw（resetCount / series / group / steps）
solutions = reserved.solutions.map(s => RouteSkillSolution {
  operations: resetSkillsOperations({ steps: s.steps }, s.resetCount, null),
  amendmentResults: skillAmendmentResults(...) })
evaluateSkillSolutions(target, solutions)                       # idealMatch / idealCloseness / semanticKey → sort → index
for value: channel.retained.push(value); subscribers(value)
exhausted / extent は Bonus と同じ形
```

### subscriber（`addBase()`）

Planner Alternativeでは `cross = createLazyIdealCross(...)`。zero solution（`base.zeroBonus` / `base.zeroSkill`）は
`buildBonusSolutionSet()` / `buildSkillSolutionSet()` で評価してcrossへ渡し、zeroがIdealでなければstream channelへsubscribeして
`channel.retained` をreplay（`for (const value of channel.retained) cross.addBonus(value)`）した後 `subscribers.push(cross.addBonus)`
する。Skillも同形。notice subscriberは `base.onBonusNotice`。

## 5. consumer dependency audit

Planner Alternative経路で評価済みsolutionを受け取るのは次だけである（`subscribers.push` は `cross.addSkill` / `cross.addBonus`、
`noticeSubscribers.push` は `base.onBonusNotice` のみ。source audit testで固定）。

| consumer | 受け取るもの | 非Idealの扱い |
| --- | --- | --- |
| `Channel.retained` | publication済み全件（現状） | 後のsubscriberへのreplay以外に読者なし |
| `createLazyIdealCross().addBonus / addSkill` | 評価済みsolution | `if (!x.idealMatch) return`（状態変化・enqueueなし） |
| `LazyIdealCrossWork.open / wake`（scheduler） | Ideal pairだけ | 到達しない |
| `composeScheduledRoute()` | Ideal pair | 到達しない |
| `ScheduledComposition` → `createPlannerAlternativeCandidate()` | Ideal pair | 到達しない |
| Candidate buffering / `compareConstrainedCandidates()` / `candidateStableKey()` / excluded Route / summary | Candidate | 到達しない |
| `noticeSubscribers`（`base.onBonusNotice`） | raw solution由来のnotice | evaluationと独立 |

`index` を読むのは `constrained/constrainedFrontier.ts`（5.6.7 constrained enumerator、`evaluateBonusSolutions()` を別途呼ぶ）だけで、
Planner Alternative経路（scheduler / Lazy Ideal Cross / `alternative/*`）には `.index` の参照が無い（source audit test）。
Research analyzer（C2.5-C）はheap snapshotのproperty名を読むだけでruntime consumerではない。

field別依存表（Planner Alternative policy）:

| field | Ideal判定前に必要 | Idealだけ必要 | 非Idealでも必要 | ordering | Candidate identity | notice | late replay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| raw `depth` / `resetCount` | ○（cost・depth単位） | | ○（stream進行） | ○（第1キー、depth内一定） | ○（operation数経由） | | |
| raw `lastResetDepth` | | ○ | ○（route_kind notice） | | ○（RouteKind・operation種別） | ○ | |
| raw `bonuses` + `restorationBonusScope` | ○（predicate） | ○ | | ○（matched / key） | ○ | | |
| raw `seriesSkillId` / `groupSkillId` | ○（predicate） | ○ | | ○（closeness / key） | ○ | | |
| raw `steps` / `results` | | ○（materialize元） | | | ○（位置・trace） | | |
| `RouteBonusSolution.operations` | | ○ | | ○（materialQuantity / operationTypeKey） | ○（Route） | | Ideal分 |
| `RouteBonusSolution.amendmentResults` | | ○（trace） | | | trace（identity外） | | Ideal分 |
| `idealMatch` | —（predicateの結果） | ○ | ○（crossのreject判定、現状） | | | | Ideal分 |
| `matchedIdealBonusCount` / `materialQuantity` / `bonusKey` / `operationTypeKey` | | ○ | | ○（depth内sort） | | | |
| `retentionKey` | | | | 読まれない（initial Search retentionとdelta Cross専用） | | | |
| `index` | | | | 読まれない | | | |
| `RouteSkillSolution.operations` / `amendmentResults` | | ○ | | | ○ / trace | | Ideal分 |
| `idealCloseness` / `semanticKey` | | ○ | | ○（depth内sort） | | | |

非Ideal evaluated Bonus / Skill solutionをsemantic consumerが使う経路は **見つからなかった**（code reviewと§13のtest）。

## 6. late subscriber audit

Planner Alternativeの登録順は `searchNormalArtianRoutes` → `searchOwnedNormalArtianRoutes` → `searchExistingGogmaRoutes`
（`visitPlannerAlternativeCandidates()`）で、その後 `step()` を回す。

| Route base | `addBase()` の時点 | 後から登録され得るか |
| --- | --- | --- |
| Existing Gogma | `searchExistingGogmaRoutes()` 内で同期的、最初の `step()` 前 | いいえ（最早の購読者） |
| Owned Normal | 各sourceの `queue` work（lowerBound 1）のsettle内、巨戟化位置ごと | はい |
| Normal predicted（offset k） | `scheduleOffset(k)` のwork（lowerBound = forge count + 1）のsettle内、巨戟化位置ごと | はい |
| Normal blind | 1件のwork（lowerBound 3）のsettle内で全巨戟化位置をまとめて登録（間はcheckpointのみ） | そのsettle時点で既存のchannelに対してははい |

channelの共有: Skill channelは `startSkillCounter` ごと（巨戟化位置 + 1、既存巨戟はorigin）、Bonus channelは
`bonusStreamBaseKey()`（startGogma、`amendmentPolicy`、Keep family layout。blindは `null`）ごと。したがって同じ巨戟化位置の
Normal predicted各offset / Owned Normal / blindはSkill channelを共有し、family layoutが同じNormal offset / Owned Normal /
既存巨戟（Normal側typeはMaster mappingで正規化）はBonus channelを共有する。stream depth dのpublicationは最初の購読者の
`baseCost + d` のlowerBoundでsettleするので、より高costで後から登録されるbaseは、既にpublication済みのdepthをreplayで受け取る。

実schedulerでのtest（§13）で、predicted offset 3〜5（count 3〜5）のbaseがBonus depth 1・Skill depth 1のpublication後に登録され、
count 5のbaseがpublication済みのdepth 1 Ideal Bonus（Reset 10）とのcompositionを受け取ることを確認した。

| replay対象 | 必要か | 根拠 |
| --- | --- | --- |
| 過去のIdeal Bonus | **必要** | late baseのIdeal pairの行になる（test） |
| 過去の非Ideal Bonus | 不要 | `addBonus` が即return（no-op） |
| 過去のIdeal Skill | **必要** | late baseのIdeal pairの列になる（test） |
| 過去の非Ideal Skill | 不要 | `addSkill` が即return（no-op） |

現行Planner Alternative policyでは、retainedされた非Ideal valueはreplayされても全subscriberでno-opである。Lazy Ideal Crossに
同じ到着列を非Ideal付き / 非Ideal抜きで与え、各到着の後に同じ回数のwork settleを挟むと、open / wakeされるcell列が完全に一致する
（test）。したがって `channel.retained` 自体は削除できず、**「これまでにpublicationされた全Ideal position」を保持する配列**へ
縮小するのが正しい。

## 7. Ideal predicateの最小入力

- Bonus: `satisfiesIdealBonuses(target, bonuses, restorationBonusScope, master)`。raw `ReservedBonusStreamSolution` の
  `bonuses` と `restorationBonusScope` だけで判定でき、`operations` / `amendmentResults` / `materialQuantity` / key類は不要。
  現行 `evaluateBonusSolution()` の `idealMatch` は同じ関数を `finalBonuses`（= raw `bonuses`）と `scope` で呼んでいるだけである
  （test: 全compositionで一致）。
- Skill: `evaluateSkillCondition(target.idealSkillCondition, seriesSkillId, groupSkillId)`。raw solutionの2 fieldだけで判定できる。
- 注意: `satisfiesIdealBonuses()` は `assertRestorationBonusRankReferences()` で不明なBonusRank参照にDomain Errorを投げる
  （`AGENTS.md`: normal-scopeの結果を非Idealとして捨てる前にもDomain Errorを投げる）。D2はこの関数そのものを **全raw solution** に
  適用しなければならず、multiset key比較などの安価な代用predicateでassertを省いてはならない。

## 8. ordering / index audit

### 順序の同一性（証明）

`compareBonusSolutions()` は `gogmaAdvance`、`matchedIdealBonusCount`、`materialQuantity`、`bonusKey`、`operationTypeKey`、scope の
辞書式比較で、各keyは **その要素単独** から決まる（target・master・自分のoperationsのみ。他要素に依存しない）。数値は有限整数、
文字列は `compareStableKeys()`（code unit比較）なので、比較はstrict weak orderingである。`compareSkillSolutions()` も
`resetCount`、`idealCloseness`、`semanticKey` で同様。

`Array.prototype.sort` はES2019以降stableなので、raw列Lに対し `sort(L)` は「key、次にL内の位置」の順に一意に決まる。Ideal部分集合
S（Lの部分列）に対し `sort(S)` も「key、次にL内の位置」で決まり、`filter(sort(L), ideal)` も同じ順序になる。したがって
**Ideal solution同士の相対順序は完全に一致する**。`materialQuantity` の元になる `operations` はsolutionの純関数
（`bonusAmendmentOperations(..., null)`）なので、どちらのpipelineでも同値。順列（恒等・逆順・rotation）testで、全件評価後filterと
filter後評価が同一objectを同順に返すことを確認した（ties: 同結果・同operation種別・位置違いのIdeal、normal-scopeの同ラベル非Idealを含む）。

### さらに強い事実: held-aware depthではIdealが常に先頭

held-aware Bonus depth ≥ 1のsolutionは全件 `gogma_artian` scopeであり、`matchedIdealBonusCount = 5` はIdeal multisetとの完全一致
（= Ideal）でしか起きないので、同じdepth内でIdealは第2キーで全非Idealより前に並ぶ。Skillも、`matchMode = all` ならIdealの
closenessが指定数（最大）、`any` なら非Idealのclosenessは0なので、同じ `resetCount` 内でIdealが先頭に並ぶ。したがって現行の
`index` とIdeal-onlyで再採番した `index` は値まで一致する（test）。ただしこれは結果論であり、D2の正しさは `index` が
Planner Alternative経路で読まれないこと（source audit test）に依拠する。

### wake / queue順序

Lazy Ideal Crossが `open` / `wake` するのはIdeal到着時だけで、非Ideal到着はenqueueしない。channelの `next(depth + 1)` は
publicationループの後で1回。したがってIdeal-onlyでも `SearchWorkQueue.enqueue` の呼び出し列（lowerBoundとsequence番号）が
同一になり、settle順・composition順・same-cost bufferの中身とdelivery順（`compareConstrainedCandidates()`）が変わらない。
subscriber callbackは同期的にenqueueするだけで、publicationループ中に `addBase()` やchannel登録は起きない。

## 9. notices / extent / prediction audit

- **notice**: `route_kind` はraw `reserved.solutions` の `(depth, lastResetDepth)` から、`unsupported` は
  `reserved.unsupportedPredictions` から、evaluationの前に作られる。Ideal-onlyでもこのループをraw全件に対して残せば不変。
  なお `visitPlannerAlternativeCandidates()` はsearcherの `RouteSearchResult`（searchedRoutes / warnings）を公開APIに含めないので、
  Planner Alternativeではnoticeはcandidate-visibleではないが、D2は現行どおり保つ（test: Idealが1つも無い入力でも
  `existing_gogma_reset_bonuses` / `keep_bonuses` / `mixed` のsearched報告とKeep unsupported warningが出る）。
- **extent / exhausted**: `reserved.exhausted`、`next(depth + 1)`、`reservedReachesBeyondExtent()` / `noteExtentReached()` は
  stream側の状態だけで決まり、evaluation結果を読まない。Idealが1つも無いdepthでも次depthへ進む（test: Ideal無しで
  Reset 10..14・Skill 7..12を全位置予測し `stoppedByExtent`、Bonus streamが自然終了する入力で `exhausted`）。
  Ideal-onlyは「非Ideal positionを探索しない」のではなく、「探索・予測・Ideal判定はし、Candidateに決して使われない表現を作らない」
  という境界である。
- **prediction**: `predictSkills` / Reset / Keep はstreamの `ensureReserved()` 内、Normalはroute searchのsettle内で行われ、
  scheduler側のmaterialization / evaluationはpredictionを呼ばない（traceもstreamが記録済みの値）。instrumentation
  （`onGogmaReservedDepth` の `generatedStates` 等）もstream内で報告されるので不変。`onWorkSettled` はwork数で、enqueue列が
  同じなので不変。
- **error path**: `satisfiesIdealBonuses()` のDomain Errorは両pipelineとも同じdepthの全raw solutionに対してpublication前に投げられる。
  唯一の差は、非Ideal solutionに対する `bonusAmendmentResults()` の内部整合性assert（history chainとdepthの不一致）が走らなくなる
  ことで、stream自身が作るchainでは起きないinternal invariantである（§18）。

## 10. formal spec wording audit

| 箇所 | 文言 | 種別 | 意味 |
| --- | --- | --- | --- |
| `alternative/plannerAlternativeSearch.ts` doc | "every stream position is published (no same-result retention)" | 実装コメント | same-result retentionをしない、の意 |
| `routeSearchShared.ts` `SearchFrontierPolicy` | "every stream position is published" | 実装コメント | 同上 |
| `targetSearchScheduler.ts` class doc / 298 / 372、`Channel.retained` doc | "publishes every stream position" / "every evaluated solution of each depth" | 実装コメント | 現行実装の説明 |
| `bonusStream.ts` `ensureReserved` doc | "Every generated state is published before the frontier reduction" | 実装コメント | **stream側**（`set.depths`）のpublication。D2で不変 |
| `SEARCH_SPEC.md` 5.6.8 Phase 1 | 「同一結果の後続Counter位置を含むextent内の完全なfrontier」「軸外pairのlazy評価（Route baseごとにIdeal Bonus解を行、Ideal Skill解を列として…）」 | formal | Candidate frontierの完全性。Crossの入力はIdealだけと明記 |
| `SEARCH_SPEC.md` 5.6.8 再利用しないもの | 「同一結果の最小advance retentionによる永久省略。順序付けやlazy化には使ってよいが、extent内の後方位置を再要求時に返せなければならない」 | formal | 同一結果の後続**Candidate**を落とさない |
| `SEARCH_SPEC.md` 5.6.8 instrumentation | 「held-aware Skill / Bonus streamの1 depthを生成・公開（Bonusはfrontier縮約）した後に1回」 | formal | stream側の生成・公開。D2で不変 |
| `SEARCH_SPEC.md` 13.2.6 | 「同一結果の後続位置と軸外pairを、再要求時にextent内で返せる」「返すCandidateがIdeal条件を満たすものだけ」 | formal | Candidate-visible |

整理:

- **A（外部observable semanticか）**: いいえ。Planner Alternativeの外部APIが公開するのはCandidate列・summary・
  `skippedExcludedRouteKeys`・`stoppedByConsumer` だけで、channel publicationは内部。
- **B（frontier requirementか）**: formal specが要求するのはこれである。各absolute positionを同一結果retentionで畳まず独立に考慮し、
  Idealとなる各positionをcompositionへ到達可能にすること。
- **C（非Ideal solutionのmaterialized publicationまで要求するか）**: 要求していない。formal specはCrossの入力を
  「Ideal Bonus解 / Ideal Skill解」と書いている。

formal specを変えずにIdeal-only publicationを実装できるのでverdictは `feasible` とする。D2では上表の実装コメントを直し、
仕様の読み違いを防ぐため次の明確化文言を `SEARCH_SPEC.md` 5.6.8へ入れることを **推奨** する（本PRでは入れない）。

> held-aware Skill / Bonus streamは、extent内の各absolute positionを同一結果retentionで畳まずに独立して生成・予測・Ideal判定する。
> Ideal条件を満たす各positionは独立したsolutionとしてcompositionの対象であり、後から登録されるRoute baseにも提示される。
> Ideal条件を満たさないpositionは、Candidateを構成しないので、Route operationやorderingのためのmaterializeを要求しない
> （そのpositionのnotice・extent判定・prediction・stream frontierへの寄与は変わらない）。

## 11. Ideal-only publication candidate

### D1-A Bonus

```text
reserved = readReservedDepth(base, depth)
route_kind / unsupported notice: raw全件から（現行と同一のループ）
ideal = reserved.solutions.filter(s => satisfiesIdealBonuses(target, s.bonuses, s.restorationBonusScope, master))   # 全raw、authorityそのもの
solutions = ideal.map(現行と同一のRouteBonusSolution materialization)
for value of evaluateBonusSolutions(target, input, solutions): retained.push(value); subscribers(value)
exhausted / extent: 現行と同一
```

### D1-B Skill

```text
reserved = readReservedDepth(start, depth)
ideal = reserved.solutions.filter(s => evaluateSkillCondition(target.idealSkillCondition, s.seriesSkillId, s.groupSkillId))
solutions = ideal.map(現行と同一のRouteSkillSolution materialization)
for value of evaluateSkillSolutions(target, solutions): retained.push(value); subscribers(value)
exhausted / extent: 現行と同一
```

Skill `channel.retained` は代表3 contextで4〜12件でmemory効果はほぼ無いが、Bonusと同じ契約にしておくと「Planner Alternative
channelはIdealだけ」を1つの規則で書け、late replayの意味も対称になる。

### D1-C `channel.retained`

`planner_alternative` policyだけ `channel.retained` =「これまでにpublicationされた全Ideal position（publication順）」。
`initial_candidate_search` policy（delta retention、`createDeltaCross()`）は一切変えない。zero solutionの評価と
subscribe条件（`!zero.idealMatch && stream available`）も変えない。

## 12. C1〜C3 / shallow peakとの対応

| C2.5-C候補 | Ideal-onlyでの効果 | 残るもの |
| --- | --- | --- |
| C1 `operations` / `amendmentResults` の即時materialization | 非Ideal分は作らない（`steps.slice` のcopy、depth個のRouteOperation、amendmentResults配列、RouteBonusSolution） | Ideal分のみ（代表3 contextで0〜2件） |
| C2 semantic key文字列（bonusKey / retentionKey / operationTypeKey）とsort比較 | 非Ideal分は作らず、sort対象もIdealだけになる | predicate内の一時Map / key（`countBonuses`、transient） |
| C3 非Idealの `channel.retained` | 保持しない | `set.depths` + `steps[]`、result node chain（stream側の二重表現の片側） |
| shallow in-flight peak | depth内の `solutions`（N件）・評価済み中間配列（N件）・`{...e, index}` 配列（N件）・sort作業領域が、Ideal k件分になる | stream生成中の `generated` 配列、`set.depths.push(generated.map(...))` のN件のraw solutionと `steps[]`、frontier縮約Map |

1つの設計変更でC1・C2・C3を同時に削れるので、個別最適化（lazy operations、key interning等）より先にこれを試す価値がある。

### memory削減見積り（定性・上限の目安）

削減対象は「Ideal判定後に初めて不要と分かるmaterialization / retention」だけである。

- c0-p0（deep）: 512 MB snapshot（depth 42）で `channel.retained` edge-cut 83.8%（Search構造到達分の84.2%）。retainedの
  135,580件中Idealは2件なので、この経路で到達するbytesはほぼ全て対象になり得る。残るのは `set.depths`（11.7%）・`steps`（8.8%）・
  result node等。no_inlining attributionでは `bonusAmendmentOperations` の比率がdepthとともに増える（39%→57%）ので、深いdepthほど
  削減割合は大きい見込み。ただし `set.depths` の各raw solutionは長さdepthの `steps[]`（shared step objectへのpointer配列）を
  持ち、これも累積state数 × depthで増えるので、成長率は下がっても成長そのものは残る。
- c2-p1（shallow）: retained edge-cut 55.5%、in-flight 13.0%。retained 196,474件は全件非Idealで対象。`set.depths` 14.3% /
  `steps` 13.6% は残る。
- c12-p0（shallow）: retained edge-cut 14.3%、in-flight 58.2%。in-flightのうちevaluation側の中間配列（`index` を持たない評価済み解
  180,764件など）は削れるが、stream生成中の配列は残る。C2.5-Cのsnapshotはin-flight内訳を分割していないので、peak削減量は
  D2 benchmarkで測るまで見積もらない。

「99.9%のmemoryが消える」とは計算しない。raw stream state、prediction memo、Ideal判定前のraw solution、stream生成burstは残る。

## 13. characterization test結果

追加: `src/domain/search/alternative/plannerAlternativeIdealPublication.test.ts`（17 tests、すべて現行コードでpass）。
fixtureはPhase 1-Cのfrontier fixtureを `src/test/fixtures/plannerAlternativeFrontier.ts` へ切り出して共有した
（`plannerAlternativeFrontier.test.ts` はimport先の変更だけで、26 testsの内容は不変）。

| test群 | 固定した内容 |
| --- | --- |
| late subscriber replay | 実 `TargetSearchScheduler` + 実streamで、predicted offset 3〜5のbaseがBonus / Skill depth 1のpublication後に登録される。全compositionがIdeal × Ideal、各offset baseのpairは Ideal Bonus {R10, R10-R12} × Ideal Skill {8, 8-10} の4件、count 5のbaseがpublication済みdepth 1 Ideal Bonusを受け取る |
| non-Ideal no-op | Lazy Ideal Crossへ同じ到着列を非Ideal付き / 抜き（settle回数同一）で与えるとopen / wake列が一致 |
| Ideal predicate | Bonusは `satisfiesIdealBonuses(raw bonuses, scope)`、Skillは `evaluateSkillCondition(series, group)` が `idealMatch` と一致 |
| ordering parity | Bonus / Skillとも、全件評価後filterとfilter後評価がIdealの同一objectを同順で返す（恒等・逆順・rotationの5順列、ties込み） |
| index | held-aware Bonus depthではIdealが全非Idealより前に並び、`index` 値も一致 |
| source audit | scheduler / Lazy Ideal Cross / `alternative/*.ts` に `.index` 参照が無い。channel subscriberは `cross.addSkill` / `cross.addBonus` / `base.onBonusNotice` だけ。Lazy Ideal Crossが非Idealを即returnする |
| notices | Idealが無い入力でも既存巨戟のReset / Keep / mixedのsearched報告、Keep unsupported warningが出る |
| extent | Idealが無い入力でGogma 10..14・Skill 7..12を全位置予測し `stoppedByExtent`。Bonus streamの自然終了で `exhausted` |
| D2 baseline | predicted Normal 5 offset + 既存巨戟 + 同一結果後続位置（R10..R12とR10,R11,K12,K13の同結果）+ 軸外pair + 両軸の非Ideal位置を持つfixtureの **全48 Candidate** の配送順（projection）、stable key重複なし、summary、`skippedExcludedRouteKeys`、全prediction呼び出し列。先頭Candidateを除外した場合の残り47件の順序と除外記録 |

## 14. semantic feasibility verdict

**`feasible`**。根拠: §5（非Ideal consumerなし）、§6（Ideal replayのみ必要）、§7（predicate最小入力）、§8（順序同一の証明と
test）、§9（notice / extent / prediction独立）、§10（formal specは非Ideal publicationを要求しない）。formal specの明確化は推奨だが
blockerではない。

## 15. D2 implementation contract

Planner Alternative stream publication（`frontierPolicy === 'planner_alternative'` の分岐だけ）:

1. extent内の全legal stream positionは、従来どおり生成・予測・考慮される（stream側 `ensureReserved()` と `set.depths` は変えない）
2. 全raw solutionに、今日と同じIdeal authority（Bonus `satisfiesIdealBonuses()`、Skill `evaluateSkillCondition()`）を適用する。
   安価な代用predicateでMaster参照assertを省かない
3. 非Ideal positionは `RouteBonusSolution` / `RouteSkillSolution` / `Evaluated*Solution` にならない（operations、amendmentResults、
   key、materialQuantity、sort対象、retained、subscriber通知のいずれも作らない）
4. Idealの各absolute positionは、今日と同じ関数で独立にmaterializeされる
5. Ideal positionは今日と同じ順序（`evaluateBonusSolutions()` / `evaluateSkillSolutions()` のsort）でpublicationされる
6. Planner Alternativeの `channel.retained` は、publication済みの全Ideal positionを保持し、late subscriberへ従来どおりreplayする
7. 全Ideal Bonus × Ideal Skill pairは `createLazyIdealCross()` で従来どおりlazyに到達可能（Cross・queue・lower boundは変えない）
8. 同一結果の後続positionを畳まない（Ideal outcomeごとに1件へ縮めない）
9. notice（raw全件から）、extent / exhausted、prediction、instrumentationは不変
10. Candidate列・Search summary・`skippedExcludedRouteKeys`・`stoppedByConsumer` は不変
11. `initial_candidate_search` policy（retention、delta Cross、#104、zero solution処理）は一切変えない
12. 実装コメント（§10の表）をIdeal-only publicationの説明へ更新する

変更範囲の想定: `targetSearchScheduler.ts` のPlanner Alternative分岐2箇所（と必要ならstreamSolutionsの小helper）。Worker protocol、
defaults、schema / version、Persistence、UIは変えない。calculation semanticsが変わらないので
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` 等のversionも動かさない。

## 16. D2 semantic acceptance

- 既存unit test全件、Planner Alternative frontier / reservation / search test、Lazy Ideal Cross test、ordinary Search test
  （prediction呼び出し列を含む）が不変でpass
- 本PRのcharacterization test（`plannerAlternativeIdealPublication.test.ts`）が **期待値を変えずに** pass（late subscriber、
  順序、notice、extent、D2 baselineの全48件配送順・summary・prediction列）
- 追加: Planner Alternative channelが非Idealをmaterializeしないことのwhite-box test（例: 非Idealだらけのfixtureで
  `bonusAmendmentOperations` / `resetSkillsOperations` の呼び出し回数がIdeal position数に等しいこと）
- 追加: 小さなexhaustive synthetic fixture（Ideal位置パターンを網羅的に変える）で、現行実装（比較用にtest内へ残すreference
  pipeline、または変更前commitで記録した値）とのCandidate stable-key列・summary・prediction呼び出し数の一致
- C2.5-Aのcompleted control（例: c8-p1#0 / c13-p4）でstatus・Search summary・first Candidate key（完走するものは全Candidate列）・
  extent stop / exhausted判定が一致
- 比較項目: delivered Candidate count / sequence、`candidateStableKey` 列、summary（`deliveredCandidates` / `excludedCandidates` /
  `exhausted` / `stoppedByExtent`）、`skippedExcludedRouteKeys`、`stoppedByConsumer`、prediction呼び出し数（Normal / Skill / Reset /
  Keep別）、notice（該当するfixture）

## 17. D2 memory benchmark acceptance

- 対象: OOM代表3 context（c0-p0 / c12-p0 / c2-p1）+ completed control 2件。C2.5-Aのworkload derivationをそのまま使う
- 条件: Node fresh child、8 GB heap、**jit_default** を主条件（no_inliningは使わないか補助のみ）
- 記録: OOM有無、first Candidateへの到達有無、peak heap（used / total）、到達した最大Gogma depth、累積生成state数、time to first
  Candidate（到達した場合）、C2.5-Aとの比較
- 期待を事前に固定しない。特にc0-p0は `set.depths` の `steps[]`、c12-p0はstream生成burstが残るので、OOMが続く可能性を結果として
  受け入れ、その場合は次候補（§18）を判断材料にする
- 必要ならC2.5-Cと同じsnapshot手順で `channel.retained` 要素のcensus（`idealMatch=false` が0件）を確認する
- Browser: Nodeで効果を確認した後、C2.5-Bと同じChrome Dedicated Worker代表contextで再確認する

PR分割の提案: **D2-a**（実装 + semantic acceptance + Node benchmark）と **D2-b**（Browser Dedicated Worker再確認）に分ける。
D2-aだけでProduction semanticsの同一性は判定でき、Browser測定は環境依存で時間がかかるため。

## 18. unresolved risks / formalにまだ不明な点

- **残存memory**: `bonusStream` の `set.depths` は全raw solutionと長さdepthの `steps[]` を永続保持する（channelは各depthを1回しか
  読まないのに解放しない）。deep型ではこれが累積state数 × depthで成長し続けるので、Ideal-onlyだけではc0-p0のOOMが消えない可能性が
  ある。次候補: raw solutionの `steps` をresult node chainから必要時にだけ導出する、読み終えたdepthを `set.depths` から解放する
  （いずれもstream側の変更で、D2の範囲外）
- **shallow burst**: c12-p0型の1 depth数十万〜200万stateの同期生成はstream側に残る。in-flight 58.2%の内訳は未分割
- **predicateのCPUコスト**: 全raw solutionに `satisfiesIdealBonuses()`（Master参照assert + 一時Map）が残る。現行も同じ呼び出しを
  しているので増えはしない
- **internal invariantの縮小**: 非Idealに対する `bonusAmendmentResults()` のhistory整合性assertが走らなくなる。stream自身が作る
  chainでは起きないが、D2でcheapなassert（allocationなしのchain長検査）を残すかはD2で判断する
- **順序証明の前提**: 安定sortと「keyが要素単独で決まる」comparator。将来comparatorが他要素・channel状態に依存する変更を入れると
  この証明は崩れる（D2で `streamSolutions.ts` のcomparatorにその旨を明記することを推奨）
- **heap attributionの限界**: C2.5-Cのsnapshotは512 MB時点・1 run、比率はOOM時点の内訳ではない。削減量はD2 benchmarkで測る
- **C2.5-C analyzerとの互換**: C2.5-Cのsnapshot analyzerはobject shape（property名）で仮説edgeを数える。D2後のcensusで同じ
  analyzerを使う場合、shape変更の有無を確認する
- **spec明確化**: §10の明確化文言をformal specへ入れるかは未決（非blocker）

## 19. 変更境界

- 追加: 本文書、`src/domain/search/alternative/plannerAlternativeIdealPublication.test.ts`、`src/test/fixtures/plannerAlternativeFrontier.ts`
- 変更: `src/domain/search/alternative/plannerAlternativeFrontier.test.ts`（fixture関数を共有fixtureのimportへ置換。test内容は不変）
- Production source、formal spec、Worker protocol、defaults、schema / version、UI、Persistenceの変更なし。追加したtest / fixtureは
  Production buildに含まれない（`dist` にfixture / test由来の文字列が無いことを確認）
