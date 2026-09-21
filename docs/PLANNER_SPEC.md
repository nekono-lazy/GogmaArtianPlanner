# モンハンワイルズ 巨戟アーティア厳選Planner
## PLANNER_SPEC.md

## 1. この文書の目的

この文書は、作成リストのBuildListEntryをもとに、複数目標を横断したProductionPlanを生成するPlannerの仕様を定義する。

PlannerはUIやIndexedDBに依存せず、入力からProductionPlanを返す純粋な計算モジュールとして実装する。

---

## 2. 基本方針

Plannerの基本優先順位。

1. 理想品未所持のTargetの理想品を、Target優先度順に早く揃える
2. 共有RNG進行中に他の目標武器も効率よく取得する
3. 作成リストで選択済みのcompromise checkpointをhard constraintとして必ず経由する（7.5）
4. 同程度の場合は武器消費や操作量を抑える

Plannerが追う到達目標はTargetの理想品だけである。実用品を先に確保する優先評価は
存在しない（7章）。

生成したProductionPlanを実行するExecution lifecycle（Step単位の確定、中断 / 再開、
再計画Previewと採用、ゲーム内セーブ地点、作成中武器の追跡、Target完了、Undo）は16章で定義する。

初期版で実装しないこと。

- ユーザーによる作成順の完全固定
- 高度な任意スコアリング
- アイテム素材の所持数による作成不能判定
- 複数キャラクター横断計画

---

## 3. 配置

```text
src/domain/planner/
  plannerTypes.ts
  createProductionPlan.ts
  scoreCandidate.ts
  inventorySimulation.ts
  conflictDetection.ts
  planInvalidation.ts
  planStepFactory.ts

src/workers/
  planner.worker.ts
```

---

## 4. 入力

```ts
export interface PlannerInput {
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
  targetWeapons: TargetWeapon[];
  buildListEntries: BuildListEntry[];
  calculationContext: CalculationContext;
  options: PlannerOptions;
  master: PlannerMasterSubset;
  conflictResolutions: PlannerConflictResolution[];
}

export interface PlannerOptions {
  maxPlanSteps: number;
  beamWidth: number;
  maxExpandedStates: number;
}

export interface PlannerConflictResolution {
  conflictKey: string;
  selectedBuildListEntryId: BuildListEntryId;
}

export interface PlannerMasterSubset {
  weaponBonusDefinitions: WeaponBonusDefinition[];
  weaponTypes: WeaponTypeMaster[];
  elements: ElementMaster[];
  bonusTypes: BonusTypeMaster[];
  artianBonusTypeMappings: ArtianBonusTypeMapping[];
  materialCosts: MaterialCostMaster[];
  bonusRanks: BonusRankMaster[];
}
```

`PlannerMasterSubset` は `LotteryMaster` を持たない。Planner計算、constrained
re-search、Trace Replayはいずれも `LotteryMaster` を読まず、PredictionはRngEngineだけから
取得する。`MasterDataRoot.lotteries` はprovisional / legacy Master structureとしてrootに
残るが、`createPlannerInput()` はPlanner Workerへのpayloadに含めない。`materialCosts` は
アイテム素材の表示用で、Plan可否・scoreの判定要素ではない（8.2）。

初期値。

```ts
const defaultPlannerOptions = {
  maxPlanSteps: 300,
  beamWidth: 50,
  maxExpandedStates: 10000,
};
```

`PlannerInput` はstructured clone可能なデータだけを保持する。`RngEngine` instance、
Engine method、`RngEngineCapabilities` の複製、ID generator、Clockを含めない。

Plannerの実行時dependencyは次の非永続境界から注入する。

```ts
export interface PlannerDependencies {
  rngEngine: RngEngine;
  idFactory: PlannerIdFactory;
  clock: PlannerClock;
}

export interface PlannerIdFactory {
  productionPlanId(): ProductionPlanId;
  planStepId(): PlanStepId;
  ownedWeaponId(): OwnedWeaponId;
}

export interface PlannerClock {
  now(): ISODateTimeString;
}
```

本番adapterは `crypto.randomUUID()` と現在UTC時刻をラップしてよい。Planner計算内で
直接呼び出さない。テストは連番IDと固定時刻を注入する。

制約。

- 保存済みの `isStale` / `staleReasons` だけでは採否を決めない。Planner実行時に
  現在状態から再validationし、実行可能なBuildListEntryだけを使用する
- PlannerはBuildListEntryの `candidateSnapshot` を入力候補として使う
- Planner入力validationでTarget定義Hash、searchStateHash、referencedOwnedWeaponsHash、CalculationContextを現在値から再確認し、保存済み `isStale` だけを信用しない
- Planner入力validationは各BuildListEntryの `intermediateStateSelection` を
  共有Domain関数 `validateBuildListEntryIntermediateStateSelection()` で検証し、未知ID・
  別laneのID・未知の改善優先はPlanner入力全体をfail closedする（7.5.9）
- RngState全体の確定は要求しない
- `deriveRngCapabilities(rngState, normalCounters, requiredOperations, engineCapabilities)` で、各BuildListEntryの全RouteOperationに必要なKnownValueと現在Engineのsupportが揃うか確認する
- conversionだけのEntryはSkill Prediction、確定Base Seed / Skill Counter、concrete semantic input supportを要求し、persisted Counter Gate、Gogma Prediction、Gogma Counterを要求しない
- Reset / Keepを含むEntryだけがGogma Prediction、確定Base Seed / Gogma Counter、concrete semantic input / Master supportを要求し、Keepを含む場合はKeep Prediction supportも要求する。persisted Counter Gateは要求しない
- Normal Counterは `create_normal_artian` operationを含むEntryだけに要求する。Normal Counterが未確定でも、Gogma-only Entry、existing Gogma Entry、適合するowned Normalからのconversion Entryを個別にvalidationしてPlannerへ残す
- capability確認後、Predictionが必要な各operationのsemantic inputを
  `getPredictionSupport()` で確認する。Normalはweapon/element/rarity、conversionと
  Reset SkillsはSkillのweapon/element、Resetはcaller-supplied Masterを含む
  `gogma_reset`、Keepはその時点のordered 5slotとcaller-supplied Masterを含む `gogma_keep` を使う
- `supported: false` は既知unsupportedとして該当BuildListEntryだけを除外する。
  他のsupported EntryはBeam Searchへ残す。support queryの例外と
  support確認後のPrediction例外は除外へ変換せずPlanner error経路へ伝播する
- Reset / Keepが連続する場合、後続Keepのsupport inputはRoute開始時のbonusではなく、
  直前のReset / Keep Prediction結果を持つdeterministic preflight/replay stateから作る
- concrete inputがsupported:falseの場合のwarningは、RNG状態不足を表す
  rng_state_missingではなくrng_prediction_unsupportedを使用する
- RNG値不足とEngine capability不足を別warning reasonとして扱う。該当BuildListEntryだけを除外し、無関係なEntryを一括無効化しない
- `targetWeapons` は `isEnabled = true` かつ `lifecycleStatus = "active"` のみ対象。
  `completed` Target（16.13）のEntryは入力validationで除外し、理由を返す
- `maxPlanSteps`、`beamWidth`、`maxExpandedStates` は1以上
- `preferPracticalBeforeIdeal` は旧Planner契約のOptionであり、現在はサポートしない。
  Plannerに実用品優先の評価は存在せず、この項目を含む `PlannerOptions` は
  validation issueとして拒否する
- Active Planの有無はPlanner pure calculationの入力に含めない。PlannerはDraft Planを計算し、Active Plan単一制約、置換、破棄、再計算の制御はApplication / Persistence層で行う

---

## 5. 出力

Plannerは `ProductionPlan` を返す。

```ts
export interface PlannerResult {
  plan: ProductionPlan | null;
  conflicts: PlanConflict[];
  warnings: PlannerWarning[];
  termination: PlannerSearchTermination;
}

export type PlannerWarningKind =
  // 通常のPlanner入力validation / Beam Search
  | "no_build_list_entries"
  | "rng_state_missing"
  | "rng_prediction_unsupported"
  | "protected_weapon_required"
  | "build_list_entry_stale"
  | "calculation_context_incompatible"
  | "all_targets_already_satisfied"
  | "invalid_conflict_resolution"
  | "max_steps_reached"
  | "max_expanded_states_reached"
  // B8 constrained-search orchestrationだけが返す（9.2.16）
  | "max_candidate_trials_per_conflict_reached"
  | "max_generated_build_list_entries_reached"
  | "max_planner_reruns_reached"
  | "constrained_enumeration_bound_reached"
  // 選択済みcompromise checkpoint（7.5.6〜7.5.9、9.5.2）
  | "selected_checkpoint_blocks_constrained_search"
  | "multiple_selected_checkpoint_entries"
  | "selected_checkpoint_target_already_ideal"
  | "selected_checkpoint_fixes_target_entry"
  | "invalid_checkpoint_selection";

export interface PlannerWarning {
  kind: PlannerWarningKind;
  message: string;
}
```

この列挙は `src/domain/planner/plannerTypes.ts` の `PlannerWarningKind` /
`plannerWarningKinds` と一致させ、`presentation/labels.ts` の
`plannerWarningLabels` は全kindの表示ラベルを持つ。ここに無いkindを返さない。

- `rng_state_missing` はRNG値不足、`rng_prediction_unsupported` はEngine
  capability不足またはconcrete inputのunsupportedを表す。capability不足専用の
  kindは存在しない
- `max_candidate_trials_per_conflict_reached` /
  `max_generated_build_list_entries_reached` / `max_planner_reruns_reached` /
  `constrained_enumeration_bound_reached` はorchestrationまたはenumerationの
  停止を表し、通常の `createProductionPlan()` は返さない（9.2.16）
- `selected_checkpoint_blocks_constrained_search` はrequired checkpoint Entryを
  持つTargetを再検索しなかったことを表す（9.5.2）
- `multiple_selected_checkpoint_entries`（7.5.7）、
  `selected_checkpoint_target_already_ideal`（7.5.8）、
  `invalid_checkpoint_selection`（7.5.9）はvalidation issueに添えて返し、
  Planner入力はfail closedされる
- `selected_checkpoint_fixes_target_entry` は、required checkpoint Entryを持つ
  Targetの他のEntryをそのrunの候補選択から外したことを伝える情報warning（7.5.6）

`max_steps_reached` は `maxPlanSteps`、`max_expanded_states_reached` は
`maxExpandedStates` に到達した場合だけ使用する。両方へ到達した場合は両方を返してよい。
探索途中のbest Stateが存在する場合、上限warningと `plan != null` を同時に返せる。

これらのwarningは診断情報であり、UI制御authorityではない。探索が完了したかどうかは
`PlannerResult.termination` でtypedに判断する（7.2.1）。上限へ到達して完成Planを
得られなかった `status === "incomplete"` のresultは、`plan != null` であっても
実行可能なProductionPlanとして永続化しない。

---

## 6. 目標充足判定

Planner実行前に、OwnedWeaponで各TargetWeaponが満たされているか判定する。

```ts
export interface TargetSatisfaction {
  targetWeaponId: TargetWeaponId;
  hasPractical: boolean;
  hasIdeal: boolean;
  practicalOwnedWeaponIds: OwnedWeaponId[];
  idealOwnedWeaponIds: OwnedWeaponId[];
}

export interface PlannerTargetSatisfaction {
  hasPractical: boolean;
  hasIdeal: boolean;
}
```

判定。

- `hasPractical`: `kind = "gogma"` のOwnedWeaponがTargetの実用条件を満たす
- `hasIdeal`: `kind = "gogma"` のOwnedWeaponがTargetの理想条件を満たす

制約。

- `status` だけで判定しない。実際のボーナス・スキル条件で判定する
- `restorationBonusScope` に対応する実際のBonus Type / Rankを評価し、normal-tierをgogma-tierへ暗黙変換したりTarget条件を緩和したりしない
- `status` はユーザー管理ラベルとして扱う
- `hasPractical`、`hasIdeal`、`practicalOwnedWeaponIds`、`idealOwnedWeaponIds` はすべてOwnedGogmaArtianWeaponだけから導出する
- OwnedNormalArtianWeaponはInventory資源・巨戟化元であり、Target充足武器として評価しない
- 既に理想品があるTargetは原則Planner対象から外す
- 既に実用品があるTargetも理想品未所持であり、実用品を持たないTargetと同じ優先度で
  Planner対象に残る。`hasPractical` はPlannerの優先順位・scoreに影響しない（7章）
- PlannerSearchStateの初期 `targetSatisfaction` はTargetSatisfactionから生成する
- `hasIdeal = true` の場合は常に `hasPractical = true` とする

---

## 7. Beam Searchと評価関数

初期版Plannerは上限付きBeam Searchを使用する。Candidate Scoreだけの単純ソートでは採用順を確定しない。

```ts
export interface PlannerSearchState {
  currentRngState: RngState;
  currentNormalCounters: NormalArtianCounter[];
  simulatedInventory: SimulatedInventory;
  targetSatisfaction: Record<
    TargetWeaponId,
    PlannerTargetSatisfaction
  >;
  selectedBuildListEntryIds: BuildListEntryId[];
  routeProgressByEntryId: Record<BuildListEntryId, number>;
  routeRuntimeByEntryId: Record<BuildListEntryId, PlannerRouteRuntimeState>;
  sourceMutationVersionByOwnedWeaponId: Record<OwnedWeaponId, number>;
  candidateReadySourceVersionByEntryId: Record<BuildListEntryId, number>;
  routeSourceVersionByEntryId: Record<BuildListEntryId, number>;
  inFlightExistingSourceByOwnedWeaponId: Record<OwnedWeaponId, true>;
  securedOwnedWeaponIdByEntryId: Record<BuildListEntryId, OwnedWeaponId>;
  trace: PlannerSearchAction[];
  /**
   * 各BuildListEntryが実際に到達済みのcompromise checkpoint opportunity ID。
   * 選択したcheckpointをすべて到達していないEntryはreserveできない（7.5.3）。
   */
  reachedCheckpointOpportunityIdsByEntryId: Record<BuildListEntryId, string[]>;
  totalCost: number;
  evaluationScore: number;
}
```

`practicalFirstProgressTargetIds` は存在しない。Practicalは独立した到達目標では
なくなったため、Practical優先の進行記録も、それを使う評価項目も廃止した。
```

探索手順。

1. 現在RNG状態と在庫から初期Stateを作成する
2. 未充足Targetに対する実行可能なBuildListEntryを列挙する
3. 各Entryの `BuildRoute.operations` から、現在の共有RNG状態と在庫で実行可能な次操作を列挙する
4. 同じ共有RNG遷移を要求する複数Entryがあれば、1回の遷移で各Entryのroute progressを進める
5. `count` を持つ操作は実行ナビ用の1操作単位へ分割し、現在Counterまで正常に通過済みのprefixを重複生成しない
6. 別Entryの実操作でcurrent Counterが通過したRoute prefixのうち、実行しなくても後続Route
   semanticsを維持できるunitはsilentにroute progressだけ進める（7.0.2）
   同じCounter位置に実行可能な必須unitがある場合、その位置を先に消費して必須unitを失わせる
   skip可能unitはsuccessor展開対象から除外する（7.0.2）
7. 操作前提が現在Stateより過去にあり、skipできない、または副作用・必要資源が満たされていない
   Entryは実行不能とする
8. 実行可能な操作を適用し、共有RNGと在庫を進めた次Stateへ展開する
9. Satisfaction、Route progress、Inventory変化後の現在Stateで、未実行のcurrent / future
   Route unitだけを対象にConflictを再評価する。通過済みRoute prefixを再Conflict化しない
   ConflictResolutionは探索中に同じstable Conflict IDが再検出され、selected Entryがその
   Stateで有効なparticipantである場合だけ適用する
10. 実用品確保、理想品更新、操作数、武器消費、現在Stateで意味のある競合を評価する
11. 同じ深さで評価値の高い上位 `beamWidth` 件だけを残す
12. `maxExpandedStates` または `maxPlanSteps` 到達時に打ち切る
13. 完了Stateのうち最良、完了Stateがなければ最も充足度の高いStateからPlanを生成する

### 7.0 physical action sharing

共有Counter streamで同じRNG遷移を要求することは、1回の物理操作を複数Entryで共有する
ための必要条件ではあるが、十分条件ではない。`physicalActionKey` はRNG transition identity
に加えて、その操作を実際に受けるphysical weapon subject identityを含める。

- concrete OwnedWeaponを対象とするReset Bonuses、Keep Bonuses、Reset Skillsは、同じ非nullの
  `sourceOwnedWeaponId`、同じoperation type、同じCounter before / afterを持つ場合だけ
  cross-Entryでshareableとする
- `sourceOwnedWeaponId = null` のReset Bonuses、Keep Bonuses、Reset Skillsは、その
  BuildListEntryの同一Routeで直前に生成したEntry-local transient Gogmaだけを対象とする。
  別BuildListEntryのnull sourceは別physical weaponであり、Counter before / afterが同じでも
  1回の物理操作として共有しない
- transient physical subjectのPlanner内部identityにはBuildListEntry IDを使用してよい。
  これはroute runtime用の非永続identityであり、fake OwnedWeapon ID、route-local永続ID、
  ProductionPlan field、DB schemaを追加しない
- create Normal、conversion、およびnull sourceの操作はcross-Entryでshareableにしない
- blind create Normal([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)も同様にEntry-localである。
  Counter位置を持たず、同じ「Normal Artianを1本作成する」操作に見えても、Entryごとに
  別の物理武器を作るため1回の物理操作として共有しない
- `PlannerSearchAction.progressedBuildListEntryIds` は、その1回の物理操作で実際にRoute progressが
  進んだEntryだけを保持する。Counter位置が一致するだけのEntryを追加しない
- Trace Replayは同じphysical action identityを再検証し、shareableでない複数Entryへ同じ
  transient outputを複製してはならない
- `PlanStep.progressedTargetWeaponIds` は正当な `progressedBuildListEntryIds` からだけ導出する。
  同じCounter位置にいたという理由だけで複数Targetを記録しない

同一concrete OwnedWeaponのshared actionでは、既存のsource mutation / version契約を維持し、
同じ操作で進んだEntryを操作後の同一versionへ更新してよい。異なるOwnedWeapon IDまたは異なる
Entry-local transient subject間では、このversion共有を行わない。

#### 7.0.1 Calculation compatibility

このphysical action sharing修正はProductionPlanの計算semanticsを変更するため、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を2から3へ更新する。version 2 ProductionPlanは、
別々のEntry-local transient Gogmaに対するReset / Keepを誤共有した可能性を保存済みStepだけから
安全に否定できないため、version 3で互換とみなしてはならない。

- Planと `baseSnapshot.calculationContext` の両方をcurrent CalculationContextと4項目完全一致で
  比較する
- いずれかが非互換なら `calculation_context_changed` としてfail-closedにし、Worker preparation、
  what-if、競合選択、実行へ進めず再計算を要求する
- exact persisted表示のため、読取時に保存済みPlanのstatus、recalculationReasons、Step、
  expected resultを補正または再生成しない
- version 2のBuildCandidate / BuildListEntryはSearchおよびsnapshot semanticsが変わっていない。
  他のCalculationContext 3項目が同じ場合に限りversion 3で明示的に再利用可能とし、既存の
  BuildList stale再判定から除外しない
- このBuild artifact互換例外をversion 2 ProductionPlanへ適用しない

このsilent fast-forward修正もProductionPlanの計算semanticsを変更するため、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を3から4へ更新する（7.0.2）。version 3
ProductionPlanは、共有Counter位置を競合として保存し、通過済みprefixを持つEntryを
`counter_before_current` としてPlanから除外している可能性がある。保存済みStepは物理的に
実行可能なままだが、その `conflicts` と `rejectedBuildListEntries` はcurrent calculationが
生成しない判断であるため、version 4で互換とみなしてはならない。上記のfail-closed比較と
exact persisted表示のルールをそのまま適用する。

version 2と3のBuildCandidate / BuildListEntryは、Searchおよびsnapshot semanticsが
変わっていないため、他のCalculationContext 3項目が同じ場合に限りversion 4で明示的に
再利用可能とする。このBuild artifact互換例外をversion 2 / 3 ProductionPlanへ適用しない。

DB schema、AppSettings schema、Production RNG Engine version、ProductionPlan persisted shapeは
変更しない。

#### 7.0.2 Counter進行とRoute prefixのsilent fast-forward

Counter streamの進行とphysical action sharingは別概念である。

共有Counter streamは排他資源ではない。あるEntryの実操作でcurrent Counterがある位置を
通過した場合、別EntryのRoute unitのうち「その位置で物理的に実行しなくても後続Route
semanticsを維持できるもの」は、実行せずに通過済みとして扱ってよい。これをsilent
fast-forwardと呼ぶ。

fast-forwardはphysical action sharingではない。別Entryの武器へ操作したのではなく、
そのunitを実行する必要がなくなっただけである。したがってfast-forwardしたunitは次を
一切生成しない。

- `PlannerSearchAction`
- Search Trace項目
- `progressedBuildListEntryIds`
- `PlanStep.progressedTargetWeaponIds`
- inventory効果 / route runtime output
- expected result
- source mutation version更新

Route progressだけをsilentに前進させる。

##### skip可能条件

Planner内部のRoute unit属性 `canSkipWhenCounterPassed` は、保存済みRoute semanticsから
導出する。永続fieldではなく、`RouteOperation`、`BuildRoute`、`BuildCandidate`、
`ProductionPlan`、DB schemaへ追加しない。

条件は「直後のRoute操作が、このunitのsemantic outputを一切読まずに全面的に上書きする」
ことだけとする。この狭い条件により、最終Candidate結果だけでなく、各Stepのexpected result
表示もskipの有無で変化しない。

| unit | 直後の操作 | skip |
| --- | --- | --- |
| `reset_bonuses` | `reset_bonuses` | 可 |
| `keep_bonuses` | `reset_bonuses` | 可 |
| `keep_bonuses` | `keep_bonuses` | 可 |
| `reset_bonuses` | `keep_bonuses` | 不可 |
| `reset_skills` | `reset_skills` | 可 |
| 上記以外 | — | 不可 |

根拠。

- Reset Bonusesは直前の5slotを読まず、Gogma Counter位置とWeapon/Elementだけから
  5slotを完全再抽選する（[RNG_SPEC.md](./RNG_SPEC.md) 5.3）。したがって直後がReset
  Bonusesであるbonus操作は、誰にも観測されない
- Keep Bonusesは各slotのfamilyだけを入力として読み、そのfamilyをslot位置ごとに保持して
  tierのみ再抽選する。Keep連鎖はfamily layoutを不変に保つため、途中のKeepをskipしても
  次のKeepの入力familyは変わらず、結果も変わらない
- Reset直後のKeepはそのResetのfamilyを読むため、そのResetはskip不可
- Reset SkillsはSeries / Group Skillだけを書き、Skill Counter位置から位置的に予測する。
  直後がReset Skillsなら、前のReset Skillsの結果はどの操作の入力にもならない
- Route末尾の操作はCandidate結果そのものを形成するため常に必須
- `create_normal_artian`、`convert_normal_to_gogma`、`reserve_weapon`、在庫変化を伴う
  操作は物理副作用を持つため常に必須

Route末尾のunitは常にskip不可なので、Route全体がfast-forwardされることはない。Candidate
結果を形成する最後の操作は必ず実行され、`reserve_weapon` の前提となるroute outputも必ず
生成される。skipしたunitのoutputを `routeRuntimeByEntryId` などへ複製してはならない。

##### 適用位置とfail closed

Beam Searchは、実操作でCounterを進めた直後のstateに対してRoute progressを正規化し、
current Counterより過去になったskip可能unitだけを順に通過させる。skip不可unitに到達した
時点で停止する。初期stateにも同じ正規化を適用し、初期competition検出が通過済みprefixを
含まないようにする。

したがって過去unitの扱いは次の2種類だけである。

```text
past + skip可能 -> route progressだけ前進（silent fast-forward）
past + skip不可 -> 従来どおり counter_before_current などでfail closed
```

`current > unit.counterBefore` を一律にrejectしない。逆に、skip不可unitのfail closedは
弱めない。

##### Counter位置を持たないRoute unit

blind create Normal([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)は
`counterStream = null`、`counterBefore = counterAfter = null` を持つ。

これは「このRouteのCandidate結果が特定のabsolute Normal Counter位置へ依存しない」という
**Routeの性質**であり、「実行しても物理的にCounterが進まない」という**runtimeの主張ではない**。
プレイヤーは実際に通常アーティアを1本作成し、ゲーム内Counterは1進む。
2つを同一視してはならない。

Routeの性質として次を維持する。

- 絶対Normal Counter preconditionを要求しない。`counter_unavailable` の対象にしない
- どのCounter位置も占有しないため、Counter位置競合のparticipantにならない
- `counter_before_current` 等のCounter位置rejectの対象にしない
- `canSkipWhenCounterPassed = false` である。必ず1 PlanStepとして実行する
- predicted variantのcreate Normalは従来どおりNormal Counter streamに属し、確定Counterが
  無ければ `counter_unavailable` などでrejectされる。全 `create_normal_artian` から
  Counter確認を外してはならない

runtimeの物理効果として次を行う。

- action適用時に `${weaponTypeId}:${rarity}` のNormalArtianCounterを現在stateから探す
- `isConfirmed === true && counter !== null` の場合だけ、既存 `advanceNormalCounter()`
  authorityへ `operation.count` を渡して進める。`counter + 1` を直接書かない
- unconfirmed、`counter = null`、recordなしの場合は現在stateを変更しない。
  未確定値は権威ではないため進めず、架空のCounter recordも作らない
- この更新はBeam SearchとTrace Replayで同一のauthorityを使う。片方だけ直してはならない

結果として、blind createが確定Counterを進めたことにより、同じNormal Counter位置を必要と
するpredicted Route unitが `counter_before_current` でrejectされることがある。これは
物理的に正しい。blind unitはCounter位置競合のparticipantではないため、この実行順は
conflict resolutionではなくBeam Searchの探索が決める。

##### Route lane: Bonus laneとSkill laneのinterleave（7.0.4）

Route unitは3つのlaneへ分割して実行する（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.8）。

```text
base lane   create_normal_artian / convert_normal_to_gogma   必ず先頭で順に実行する
bonus lane  reset_bonuses / keep_bonuses                       Gogma streamの順序を保つ
skill lane  reset_skills                                       Skill streamの順序を保つ
```

`PlannerSearchState.routeProgressByEntryId` はEntryごとに `{ base, bonus, skill }` のlane進行を
保持する。base lane完了後、bonus laneとskill laneの物理的な実行順序はRouteが固定せず、
Plannerが決める。Beam Searchは各展開で、そのstateで実行できる（counter precondition、
inventory precondition、conflict resolution block、required unit dominance、7.5.2のpin gating
を通る）両laneのunitを **どちらもsuccessorとして生成する**。Skill先行branchとBonus先行branchは
両方beamに残り、どちらを採るかは既存のscoring（7.3）と7.6のsoft preferenceが決める。
「先に成功したlaneだけを残す」「改善優先のlaneが実行可能なら反対laneを生成しない」という
枝刈りは行わない: それは改善優先をhard constraintにし、優先laneを先に進めると将来の
全体Planが破綻するケースを探索から失わせるためである。探索量は既存のbeamWidth、
semantic dedup、scoring、maxExpandedStates、maxPlanStepsで有界にする。

`canSkipWhenCounterPassed` の「直後の操作」は同一lane内の次の操作で判定する。別laneの操作は
このunitの出力を読まないため、間に挟まっても観測されたことにならない。

Trace ReplayはBeam Searchのtraceどおりに操作を再生するだけであり、lane分割の影響を受けない。
`RouteOperation`、`BuildRoute`、`BuildCandidate`、`ProductionPlan`、DB schemaへlaneを永続化しない。

##### Conflict判定と実行順序の支配関係

同じCounter位置に複数Entryのunitがあるだけでは競合ではない。skip可能unitはその位置を
排他的に必要としないため、競合participantにもならず、conflict resolutionによる
blockingの対象にもならない。

```text
必須unit vs 必須unit（同一physical actionとしてshare不可）
  -> 競合

必須unit vs skip可能unit
  -> 競合ではない
  -> 必須unitがそのCounter位置を優先して実行される
  -> skip可能側はCounter通過後にsilent fast-forward

skip可能unit vs skip可能unit
  -> 競合ではない
  -> どちらを先に実行してもよい（実行されなかった側はfast-forward）
```

「競合ではない」ことと「どちらを先に実行してもよい」ことは同じではない。必須unitと
skip可能unitの間には実行順序の支配関係がある。

```text
必須A @C を先に実行 -> Counter C+1 -> skip可能B @C はfast-forward -> 両Route継続可能
skip可能B @C を先に実行 -> Counter C+1 -> 必須A @C は past + skip不可 -> A Route不能
```

したがって、あるCounter位置に実行可能な必須unitが存在する場合、その位置を先に消費して
必須unitを不可逆に失わせるskip可能unitは、Beam Searchのsuccessor展開対象にしない。これは
execution eligibility（semantic pruning）であり、evaluationScoreによる優遇ではない。
scoreだけではbeamWidthやtie-break次第で無効branchが残り、無効な状態爆発を防げない。

この順序はPlanner自身が一意に決定できるため、ユーザー選択の競合ではない。
`required vs skippable` をConflictへ戻さず、Conflict Resolution UIへも出さない。

判定は次の条件で行う。

- 対象は同じstream・同じCounter位置のunitだけである。別streamや別位置のunitは干渉しない
- 必須unitが現在stateで実際に実行可能な場合だけ支配が成立する。source version、counter
  precondition、inventory / protection、conflict resolutionによるblockingは、通常の展開と
  同じ判定authorityで確認する。必須unitが実行不能なら支配は発生せず、skip可能unitの展開を
  妨げない
- 必須unitとskip可能unitが同一physical actionとしてshareableな場合は代替関係ではない。
  既存のphysical action sharing契約（7.0）が1操作で両Entryを進めるため、この除外を適用しない
- 除外された展開はrejectionとして記録しない。Entryが実行不能になったわけではなく、同じ
  Counter位置を別Entryが消費した後にfast-forwardするだけである

通過済みRoute prefixはConflict対象へ戻さない。

`same_owned_weapon_consumed` は別の排他資源であり、この除外を適用しない。1つのRouteが
あるOwnedWeaponを起点として使う場合、そのRouteには必ず必須unitが残るため、既存の
排他使用semanticsはそのまま維持される。PR #4で定めたphysical action identity判定
（7.0）も弱めない。


候補確保時の状態遷移。

- Candidate reserveや所持通常アーティアの変換消費など、SimulatedInventoryの意味的変更後は、
  enabled Target全体のTargetSatisfactionを現在InventoryのOwnedGogmaだけから再導出する。
  statusだけで判定せず、Idealは常にPracticalも満たす。1武器が複数Targetを満たす場合は
  すべてへ反映し、削除・更新で満たさなくなったTargetはtrueを保持しない。
- 既存Gogmaのreset_bonuses、keep_bonuses、またはsourceを持つreset_skillsを実行したら、
  そのsourceのmutation versionを進め、Candidate reserveまでin-flightとして
  TargetSatisfaction評価から除外する。EntryのRoute完了時にそのsource versionを記録し、
  reserveは記録versionと現在versionが一致するときだけ許可する。後続操作でsourceが
  変更された古いCandidateはreserveできない。同一physical actionを共有して同時に
  完了したEntryは同じversionを記録してよい。
- 既存Gogma Routeは開始時にsource version 0を前提とし、Route全体で前提versionと
  現在source versionの一致を要求する。共有physical actionで進行したEntryは操作後の
  versionへ同時に更新する。共有prefix後に別Entryがsourceを変更した場合、古いversionの
  Routeは後続操作・reserveとも実行しない。
- reserve後の再導出は、Entry自身のTargetだけでなく、確保した武器が満たす他の
  未所持Targetにも反映する。複数Targetを満たす1武器は、そのすべてのTargetの
  TargetSatisfactionへ反映する。
- 現在在庫がPractical条件だけを満たすTargetもIdeal未所持であり、探索対象に残す

### 7.1 Planner Search Action / Trace

Beam SearchはCandidate Snapshotの `BuildRoute.operations` を変更せず、実際に採用した
操作を非永続のPlanner Search Action / Traceとして別に保持する。

- `RouteOperation`、Planner Search Action、`PlanStep` は別の型・責務である
- Search Actionは元RouteOperation、主対象BuildListEntry、同じ物理操作で進んだEntry、
  route progress位置、OwnedWeapon ID、RNG Before / After、Inventory効果、Target充足効果を保持する
- `count > 1` のRouteOperationは元Snapshotを変更せず、Trace上で1操作単位に分割する
- Candidateを確保するSearch ActionはPlanner-onlyであり、RouteOperationではない。current
  ProductionPlanでは独立した `reserve_weapon` PlanStepへ変換せず、Entryの最後の物理Stepの
  target completion effectへ統合する（16.3）
- Search Traceは非永続で、PlanStep IDまたは日時を生成しない

### 7.2 expandedStates

`expandedStates` は次の定義で数える。

- 初期Stateは数えない
- 実行前提を満たさずsuccessor生成前にrejectした展開は数えない
- successor PlannerSearchStateを実際に構築し、評価対象にした時点で1増やす
- beamWidthによる枝刈り前でも、構築・評価したsuccessorは数える
- `maxExpandedStates = N` の場合はN件まで許可し、N+1件目を構築しない
- N件へ到達した場合だけ `max_expanded_states_reached` warningを返す

`maxPlanSteps = 300`、`beamWidth = 50`、`maxExpandedStates = 10000` は
`defaultPlannerOptions` の初期値であり、Application callerがBuildList画面の詳細設定で
上書きできる。完全最適解は保証せず、実用的な時間内で十分良いPlanを返す。

### 7.2.1 探索上限設定と typed termination

#### PlannerOptions authority

`PlannerInput.options` はBeam Search boundの唯一のauthorityとする。

- 初期値authorityは `defaultPlannerOptions` だけとする
- BuildList画面の詳細設定でユーザーが `maxPlanSteps` / `beamWidth` /
  `maxExpandedStates` を変更できる
- Application callerが選択値を `PlannerInput.options` へ明示的に反映する
- Worker Client、Worker controller、Domain moduleは既定値を補わない
- 3項目とも1以上の整数だけを受け付け、NaN・0・負数・小数・空欄はPlannerへ渡さない
- 推測による固定最大値は設けない。長時間化はWorker実行と既存Cancelで扱う
- 設定値はBuildList画面のruntime UI stateであり、AppSettingsやIndexedDBへ永続化しない

`PlannerOptions` はB8 orchestration bounds
（`maxCandidateTrialsPerConflict` / `maxGeneratedBuildListEntries` /
`maxPlannerReruns`）およびB8 `ConstrainedEnumerationBounds`、B9 `PlannerWhatIfBounds`
とは別物であり、混同しない。今回の詳細設定はこの3項目だけを公開する。

#### typed termination

Beam Searchの終了状態は `PlannerSearchTermination` としてtypedに返す。

```ts
export type PlannerSearchLimitKind =
  | "max_expanded_states"
  | "max_plan_steps";

export type PlannerSearchTerminationStatus =
  | "completed"
  | "incomplete"
  | "exhausted"
  | "cancelled";

export interface PlannerSearchTermination {
  status: PlannerSearchTerminationStatus;
  reachedLimits: PlannerSearchLimitKind[];
  limits: PlannerOptions;
  expandedStates: number;
  completedTargetCount: number;
  totalTargetCount: number;
}
```

statusの決定順序は次のとおりとする。

1. `cancelled`: ユーザーが探索をキャンセルした
2. `completed`: 全enabled Targetが完了した。完了とは `hasIdeal = true` であり、かつ
   そのTargetにrequired checkpoint Entry（7.5.6）があればそのEntry自身をsecure済み
   であること。`completedTargetCount` も同じ判定で数える
3. `incomplete`: それ以前に `PlannerOptions` boundが探索を打ち切った
4. `exhausted`: boundに到達せず探索が自然終了し、全Target完成Planが無かった

`PlannerBeamSearchResult.termination` と `PlannerResult.termination` が保持する。
`PlannerOrchestrationResult` は `PlannerResult` を継承するため同じ値を引き継ぐ。
複数回full Beam Searchが走った場合は、結果として採用したrunのterminationとする。

`termination` はruntime result metadataであり、`ProductionPlan`、`PlanStep`、
`BuildListEntry`、DB schemaへ永続化しない。structured-clone可能なplain dataとして
Worker境界をそのまま通し、Worker側でwarningから再構築しない。

#### warningとの役割分担

`max_steps_reached` / `max_expanded_states_reached` PlannerWarningは診断情報として残す。

- UI / Application / PersistenceはUI制御authorityとして `termination` だけを読む
- warning messageを文字列解析して可用性を判断してはいけない
- `reachedLimits` はwarning一覧のコピーではない。`completed` な探索でもboundへ到達した
  場合は `reachedLimits` が非空になり、warningと矛盾しない
- Beam Searchへ到達しなかったrun（入力invalid、orchestration bound）は
  `reachedLimits` を空にする。停止理由はそれぞれのwarningが報告する

#### incomplete resultの扱い

`status === "incomplete"` のresultは、探索途中のpartial Beam Search artifactであり、
完成したProduction Planではない。

- `PlannerResult.plan` はnullにせず、partial Planをそのまま保持してよい
- B8 constrained orchestration内部の `isConstrainedTrialAdoptable()` は従来どおり
  partial Planを利用してよい。この内部契約は変更しない
- 一方、Persistenceは `planner_result_invalid` としてfail closedし、
  実行可能なDraft ProductionPlanとして保存しない
- 生成BuildListEntriesも単独では保存しない
- UIは `/plans/{id}` へnavigateしない
- UIは到達したbound、設定値、探索状態数、完成Target数、設定見直し案内を表示する

`status === "exhausted"` は「探索未完了」ではない。入力・Conflict・resourceにより
complete Planが無かった通常の結果として、従来どおりの意味と挙動を維持する。

#### Calculation compatibility

この変更はBeam Searchの展開、評価、Conflict検出、Trace Replay、PlanStep生成、
`ProductionPlan` 永続形状のいずれも変更しない。同じ `PlannerInput` に対する計算結果は
従来と同一であり、変わったのは保存時のartifact受け入れ判定だけである。

それでもこれはCalculation schema境界であり、
`CURRENT_CALCULATION_APP_SCHEMA_VERSION` を4から **5** へ更新する。

version 4以前のruntimeでは、`maxExpandedStates` などで探索が打ち切られても
`bestComplete ?? bestPartial` からpartial ProductionPlanが通常のDraftとして保存され得た。
永続化された `ProductionPlan` は `PlannerSearchTermination` を保持せず、ProductionPlan
互換判定はCalculationContextの完全一致であるため、保存済みversion 4 Planが
complete search由来かpartial search由来かをcurrent runtimeから判別できない。判別できない
以上、安全側として旧schema 4 ProductionPlanは一括でstaleとする。

- version 4以前のProductionPlanはversion 5 runtimeで `calculation_context_changed` とし、
  Worker preparation、conflict interaction、what-if、実行準備、実行へ進めない
- 保存済みStep、status、conflicts、rejectedBuildListEntriesをread migrationで書き換えず、
  exact persisted表示は維持する
- ProductionPlan互換判定は従来どおりexact CalculationContext matchのままとし、
  build-result例外を適用しない
- Candidate Search semanticsは変更していないため、version 2 / 3 / 4の
  BuildCandidate / BuildListEntryは、他のCalculationContext authorityが一致する
  version 5 runtimeで明示的に互換とする。version 1は引き続き非互換とする

旧artifactへのfail closedと、新しく計算されたresultへのfail closedは別の防御であり、
両方を維持する。

```text
version 5                     旧schema 4 ProductionPlanへのfail closed
termination.status incomplete 新規計算resultへのfail closed
```

`PlannerResultPersistenceService` の `termination.status === "incomplete"` 拒否は
schema versionを上げても削除しない。

Calculation semantics / artifact validity境界とDexie schemaは別概念であるため、
`DATABASE_SCHEMA_VERSION = 1`、`AppSettings.schemaVersion = 1`、
`PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2` は変更しない。

Planner内部ではBeam Searchの状態評価用にCandidate Scoreを計算する。

```ts
export interface CandidateScore {
  targetPriorityScore: number;
  satisfactionScore: number;
  distancePenalty: number;
  conflictPenalty: number;
  total: number;
}
```

推奨重み。

```ts
targetPriorityScore = target.priority * 10000
satisfactionScore =
  state.targetSatisfaction[target.id].hasIdeal ? 0 : 50000
distancePenalty = estimatedOperationCount * 100
conflictPenalty = conflictCount * 5000
```

state全体の評価は次の3項からなる。

```text
achieved  = sum over Targets (hasIdeal なら 1200000 + priority * 120000)
progress  = Target ごとに、relevant で進行中の Entry の最大 (CandidateScore.total + 進行bonus)
penalty   = trace.length * 100
evaluationScore = achieved + progress - penalty
```

`hasPractical` はCandidateScoreにもstate評価にも一切現れない。Practical未所持の
Targetと、Practical所持かつIdeal未所持のTargetは同じ扱いであり、同priority・
同costなら `hasPractical` の有無だけでscore差は付かない。Beam pruningの順序も
同様である。競合の `recommendedBuildListEntryId` もTarget priority・次Candidate
までの距離・操作数・安定IDだけで決め、`hasPractical` を読まない。

`categoryScore` は存在しない。BuildListEntryのCandidateは常に理想品なので、
categoryで重み付けする対象がない。妥協checkpointはscoreへ加算も減算もしない
hard constraintであり、7.5で扱う。

制約。

- scoreはBeam Search内の状態比較用であり、単独で採用候補を確定しない
- scoreはPlanner内部の比較用であり、初期版UIで高度なユーザー調整は提供しない
- Debug Modeではscore内訳を表示してよい
- Practical優先(practical-first)の評価項目は存在しない。Plannerが追う到達目標は
  Targetの理想品だけである
- `hasPractical` は6章の充足判定として残るが、Beam Searchの目標にはしない
- 選択済みcheckpointはscoreではなくhard constraintとして扱う(7.5)
- `isProtected = true` の武器に対するReset Bonuses・Keep Bonuses・Reset Skillsはpenaltyではなく実行不能な展開として除外する
- `status` はユーザー管理ラベルであり、score項目にしない。未分類武器の本数はPlanner scoreへ影響しない

### 7.3 Plan quality preference: 武器切替の最小化

correctness / feasibilityより下位のPlan quality preferenceを1つ定義する。

同等にcorrectで、既存評価も同点のPlanner state / Planが複数ある場合、
実際のゲーム操作で対象武器を持ち替える回数が少ない方を優先する。

これはcorrectness ruleではない。武器切替が多いPlanも正しく実行可能なPlanである。

#### 優先順位

```text
correctness / feasibility
  -> 選択済み途中採用状態の充足（hard constraint、7.5）
  -> Target satisfaction
  -> 既存evaluationScore（Target priority、satisfaction、resource cost、action count、conflict）
  -> preferred source match（7.4）
  -> improvementPreferenceViolationCount 昇順（7.6）
  -> weaponSwitchCount 昇順
  -> 既存semantic stable tie-break
  -> 既存trace stable tie-break
```

`weaponSwitchCount` をTarget satisfactionや既存costより上位へ置かない。
`evaluationScore` へ大きなweightとして混ぜ込まない。切替1回・操作200回のPlanが
切替2回・操作100回のPlanより優先されてはならない。

#### metric対象Operation

Gogma武器を選択して継続操作する次の3操作だけを対象とする。

```text
reset_bonuses
keep_bonuses
reset_skills
```

`create_normal_artian` と `convert_normal_to_gogma` は
「継続して操作している復元対象武器」というsubjectを持たない。v1ではこれらを
metric対象にせず、subjectとしても記録しない。曖昧な定義を広げないための
意図的な限定であり、後から必要になればformal specを更新して拡張する。

`reserve_weapon` はPlanner-only actionであり、ゲーム上の操作ではない。
switch countを増やさず、直前subjectも変更しない。したがって

```text
水 Keep -> reserve -> 火 Reset
```

は `水 -> 火` の1 switchである。

#### weapon subject identity

`physicalActionKey` をweapon subject keyとして流用してはならない。同キーは
operation typeとCounter before / afterを含むため、同じ武器を連続操作しても
actionごとに変わり、「同じ武器か」の判定に使えない。

subject identityは操作対象の武器だけで決める。

- concrete OwnedWeapon: `sourceOwnedWeaponId` を持つ操作は、どのBuildListEntryが
  駆動しても同一subject
- transient Gogma: `sourceOwnedWeaponId = null` の操作は7.0のEntry-local physical
  subject契約に従い、BuildListEntryごとに別subject

#### 数え方

- 直前のmetric対象操作と同じsubjectなら +0
- 直前subjectが `null`（branch最初のmetric対象操作）なら +0
- 直前subjectと異なるsubjectなら +1
- metric対象外操作はcountも直前subjectも変更しない
- physical action sharingで1回の物理操作が複数Entryを進めた場合、
  実際の物理操作は1回なのでswitch判定も1回だけ行う
- silent fast-forward（7.0.2）は実物理操作ではないため数えず、直前subjectも変えない

#### Planner runtime state

`PlannerSearchState` はこのmetricをincremental runtime stateとして保持する。

```ts
weaponSwitchCount: number;
lastWeaponOperationSubjectKey: string | null;
```

初期値は `0` と `null` である。state比較のたびにTrace全体を走査して
O(trace length)で再計算してはならない。

いずれも非永続のPlanner runtime stateであり、`RouteOperation`、`BuildRoute`、
`BuildCandidate`、`ProductionPlan`、PlanStep、DB schemaへ追加しない。

`createPlannerSearchStateSemanticKey()` へは追加しない。両fieldは既にsemantic keyへ
含まれるtrace projectionの純粋な関数であり、各actionの `primaryBuildListEntryId` と
`progressedRoutePositions` が保存済み `RouteOperation`、したがってweapon subjectを
一意に決める。同じsemantic keyを持つstateは常に同じ両値を持つため、dedup identity、
以後のswitch計算、決定的tie-breakのいずれも整合する。

#### Beam Searchへの影響

これはranking preferenceであり、7.0.2のrequired / skippable execution eligibilityのような
semantic pruningではない。

- 武器切替が増えるbranchを実行不能として削除しない
- rejectionを記録しない
- conflictを生成しない
- physical action sharing、silent fast-forward、conflict semantics、Trace Replay
  semanticsを変更しない

上限付きBeam Searchであるため、武器切替回数の絶対最小は保証しない。
同じ入力・同じEngine fixture・同じ定数に対する決定性は従来どおり維持する。

#### Calculation compatibility

この変更は実行可能なPlanの意味を変えず、同等にcorrectな複数Planからどれを優先するかだけを
変える。既存のversion 4 ProductionPlanは武器切替が現行Plannerより多くても物理的・意味的に
実行可能なままである。したがって `CURRENT_CALCULATION_APP_SCHEMA_VERSION` を更新せず、
`DATABASE_SCHEMA_VERSION`、`AppSettings.schemaVersion`、
`PRODUCTION_RNG_ENGINE_VERSION` も変更しない。

### 7.4 Plan preference: Targetの優先起点

`TargetWeapon.preferredOwnedWeaponId`（[DATA_MODEL.md](./DATA_MODEL.md) 8.5）は、Plannerでも
hard constraintにしない。correctness、選択済みcheckpointの充足、Target satisfaction、
Target priority、operation / resource / conflict cost、実行可能性はすべてpreferredより上位
である。preferred起点は、それらが同等の場合のPlan preferenceとする。

#### 優先順位

```text
選択済み途中採用状態の充足
  -> 既存evaluationScore / correctness / cost
  -> preferred source match
  -> improvementPreferenceViolationCount（7.6）
  -> weaponSwitchCount
  -> semantic stable tie-break
  -> trace stable tie-break
```

preferredをweighted scoreへ混ぜ込まない。1操作以上遠いRouteをpreferredという理由だけで
逆転させてはならない。同時に、同評価のbranchがstable keyだけを理由にpreferred Routeより
先に残ることがないよう、Beam Searchの途中stateでもこのpreferenceを適用する。

#### preferred判定

```ts
entry.candidateSnapshot.route.sourceOwnedWeaponId === target.preferredOwnedWeaponId
```

- 所持Normal Routeはsource IDで判定できる
- 既存Gogma Routeはsource IDで判定できる
- 新規Normal Routeはsourceが `null` のためpreferredにならない。Targetのpreferredが `null` の
  場合もpreference自体が無効であり、`null` source同士を一致とみなさない

#### Planner runtime state

`PlannerSearchState` はこのpreferenceをincremental runtime stateとして保持する。

```ts
preferredSourceProgressCount: number;
```

初期値は `0` である。1つのSearch Actionが進めたBuildListEntryのうち、preferred判定を満たす
ものの数だけ加算する。physical action sharingで1回の物理操作が複数Entryを進めた場合は、
その物理操作が進めたpreferred Entryだけを数える。silent fast-forward（7.0.2）はEntryを進めた
記録を持たないため加算しない。

非永続のPlanner runtime stateであり、`RouteOperation`、`BuildRoute`、`BuildCandidate`、
`ProductionPlan`、PlanStep、DB schemaへ追加しない。`createPlannerSearchStateSemanticKey()`
へも追加しない。`weaponSwitchCount` と同様に、semantic keyが既に保持するtrace projection
（各actionの `primaryBuildListEntryId` と `progressedBuildListEntryIds`）の純粋な関数だからである。

#### Beam Searchへの影響

7.3と同じくranking preferenceであり、semantic pruningではない。

- preferred以外のRouteを実行不能として削除しない
- rejectionを記録しない
- conflictを生成しない
- physical action sharing、silent fast-forward、Counter fast-forward、conflict semantics、
  weapon switch semantics、Trace Replay semanticsを変更しない

#### 自動変更の禁止

Planner計算（Beam Search、Trace Replay、constrained re-search、what-if）と `reserve_weapon`
（探索内部action）は `TargetWeapon.preferredOwnedWeaponId` を変更してはいけない。
Idealを確保した、新規Gogmaを登録した、既存Gogmaを更新したという探索上の理由で優先起点を
自動設定・付け替えしない。優先起点はユーザーがTarget Weapons画面から設定する計画入力である。

唯一の例外はExecutionである。既存の所持武器はPlan開始（「作成開始」、`draft -> active`）の
transactionで、Plan内で新規登録する作成対象Normalはその登録Stepの確定でTargetへ紐付け、
理想品完成時に解除する（16.2 / 16.11 / 16.13）。これはPlanner計算ではなくApplication /
Persistence層のExecution effectであり、Active Planの正常進行として扱う。

#### Target Satisfaction

Target Satisfactionは従来どおり武器種、属性、実際のボーナス、実際のスキル、Target条件から
判定する。`preferredOwnedWeaponId` を見てTarget Satisfactionを制限してはいけない。
Target AがWeapon Xを優先起点にしていても、条件を満たすWeapon YによってTarget Aが
Ideal satisfiedになってよい。

### 7.5 選択済み途中採用状態と妥協checkpoint

`BuildListEntry.intermediateStateSelection`（[DATA_MODEL.md](./DATA_MODEL.md) 9.4）の
`skillOpportunityId` / `bonusOpportunityId` は **hard constraint** である。Plannerはこれを
無視・解除・別opportunityへの読み替えのいずれも行わない。できるのは「それを満たすPlanを
作れない」と報告することだけである。`improvementPreference` はsoft preferenceであり7.6で扱う。

#### 7.5.1 選択済みlane終端はfast-forwardしない

選択したopportunity（lane位置 `n >= 1`）を生むRoute unitは、7.0.2のsilent fast-forward対象から
外す。`canSkipWhenCounterPassed = false` とする。ユーザーはその瞬間に実際にその武器を
手に持つのだから、その状態は「直後に上書きされる未観測な中間状態」ではない。
lane位置0の選択は操作を持たず、lane開始状態を保持することで表現する。

選択されていない中間unitは従来どおりskip可能である。選択したopportunityより手前にあり、
同一laneの次の操作が出力全体を書き換えるprefix unitも従来どおりskip可能である。

#### 7.5.2 pinと妥協checkpoint

Entryの選択から **pin** を導出する。

```text
pin.skill = 選択したSkill opportunityのlanePosition、未選択ならSkill laneの操作数（Ideal終点）
pin.bonus = 選択したBonus opportunityのlanePosition、未選択ならBonus laneの操作数（Ideal終点）
```

妥協checkpointは、両laneが同時にpin状態を持った瞬間である。Plannerは次の順序制約を
execution eligibilityとして課す（scoreではなくsemantic pruning）。

```text
lane L のunit（laneIndex k）は、k + 1 > pin[L] かつ progress[other] < pin[other] の間は実行しない
silent fast-forwardも同じ条件でpinを越えない
```

したがって片laneがpinを越える前に、必ずもう片laneがpinへ到達する。両laneのpinへ到達した
瞬間を `PlannerSearchState.reachedCheckpointByEntryId` に記録する。pin終端unitはskip不可なので、
到達は必ず実物理actionで起こる。選択がまったく無いEntryにpinは無く、そのままIdealへ進む。

**開始時点で既に到達しているcheckpoint。** 既存巨戟のRouteで両pinがlane位置0になる場合
（両laneでlane開始状態を選択した場合、または片laneの開始状態を選択しもう片laneが操作を
持たない＝既にIdealである場合）、pin状態はユーザーが今持っている武器そのものである。
このcheckpointはどのRoute操作も生まず、`createInitialPlannerSearchState()` が
`reachedCheckpointByEntryId[entry.id] = true` として初期化する（Planner開始時点で到達済み）。
`reserve_weapon` は拒否されず、残りの操作はそこから理想品へ続く。conversion Routeのlane位置0
（巨戟化直後のSkill / 5枠）は巨戟化が生む状態なので開始時点では未到達であり、base lane完了後に
両pinが揃った時点で到達する。base lane未完了のEntryを到達済みと判定しない。
Executionでは、開始時点で到達済みのcheckpointの `practical` ラベルと「妥協品として確定して終了」の
選択を、そのEntryの最初の物理Stepで扱う（16.12）。

片laneだけを選択した場合、もう片laneのpinはIdeal終点である。すなわち

```text
Skillのみ選択 -> 妥協checkpoint = 選択Skill + Ideal Bonus
Bonusのみ選択 -> 妥協checkpoint = Ideal Skill + 選択Bonus
両方選択      -> 妥協checkpoint = 選択Skill + 選択Bonus
```

checkpoint到達後の改善順序は固定しない。両laneの残りをどちらから進めるかは7.6のsoft
preferenceが決め、全Planの成立性が優先される。

#### 7.5.3 未到達のcheckpointはreserveを止める

`reserve_weapon` の展開条件に、そのEntryの妥協checkpointへ実際に到達済みであることを加える。
選択を持つEntryで未到達なら `selected_checkpoint_not_reached` として拒否する。

同一groupの別opportunityへ到達しても、選択したopportunityの到達にはならない。
Plannerが選択を勝手に読み替えないという契約はここで具体化される。

#### 7.5.4 PlanStepはmilestoneを持つが、checkpoint専用Stepは作らない

checkpointは新しい `PlanStepOperationType` ではない。両laneのpinを揃えた物理Step
（Reset Bonuses / Reset Skillsなど）に `PlanStep.checkpointMilestones` を付ける。

```ts
export interface PlanStepCheckpointMilestone {
  buildListEntryId: BuildListEntryId;
  targetWeaponId: TargetWeaponId;
  /** 選択したSkill opportunity。未選択（Ideal終点）なら null */
  skillOpportunityId: IntermediateStateOpportunityId | null;
  /** 選択したBonus opportunity。未選択（Ideal終点）なら null */
  bonusOpportunityId: IntermediateStateOpportunityId | null;
  /** 到達した組み合わせの両軸判定。説明情報 */
  conditionMatch: CompromiseConditionMatch;
  remainingOperationCount: number;
}
```

- checkpoint到達でOwnedWeaponをreserveしない
- Planner計算はcheckpoint到達でstatusも保護も変更しない。Executionは、milestoneを持つStepの
  確定時に追跡武器を `status = "practical"` にするcompromise label effectを適用する（16.12）。
  保護と作成中状態は変更しない
- checkpoint到達でPlanは止まらない。Executionでユーザーが「妥協品として確定して終了」を
  明示選択した場合だけPlanを `abandoned` にする（16.12）。`remainingOperationCount` 分の後続Stepが必ず残る。
  この値のauthorityは確定済みSearch Traceであり、milestoneを載せたactionより後ろで
  そのEntryをprogressする `route_operation` の数である。別Entryの操作でsilent
  fast-forwardされたunitは数えず、shared physical actionは当該Entryにつき1操作、
  `reserve_weapon` は数えない。Candidateの `estimatedOperationCount` からの引き算は
  fast-forwardされたunitを未消化扱いするため使わない
- 完成semantics（`status = "ideal"`、新規・既存を問わず保護あり、Target完了）は、最終的に
  理想品が完成したときだけ適用する（16.13）
- 1つの共有Stepが複数Entryのcheckpointを達成した場合、milestoneはEntryごとに
  1件ずつ並ぶ。Stepを複製しない

Trace Replayは、milestoneを出す前に、その時点でreplayした武器状態が選択Skill
opportunityのSeries / Group Skill（未選択ならCandidate最終Skill）、選択Bonus opportunityの
exact ordered 5枠とscope（未選択ならCandidateの `finalBonuses` / scope）と一致することを
検証する。一致しない場合は `checkpoint_state_mismatch` としてfail closeする。到達判定は
pin終端operationの実行有無で行い、silent fast-forwardで消えたunit数に依存しない。

開始時点で到達済みのcheckpoint（7.5.2）はどのStepも生まないため、milestoneを持つStepは
存在しない。Trace ReplayはPlan開始時点の起点OwnedWeaponが選択状態を正確に保持することを
検証し（不一致は `checkpoint_state_mismatch`）、到達済みとして扱う。Plan生成後のfail-closed
defence（7.5.6）もこのEntryにはmilestone Stepを要求しない。UIは開始時点のcheckpointに
特別な表示を追加しない（最小変更）。

#### 7.5.5 選択変更とPlanのstale

選択と改善優先はPlanの `PlanningInputSnapshot.buildListEntriesHash` に含める。
変えるとhashが変わるので、既存Planは通常のBuild List変更と同じく
再計算対象になる。一方でBuildListEntry自体はstaleにならない
（[DATA_MODEL.md](./DATA_MODEL.md) 9.4）。

途中採用状態を持つEntryでは、hashは選択したopportunityだけでなく、Plannerが実際に要求する
**checkpoint pin pair全体**（7.5.2）を正規化して含める。laneごとに

```text
選択lane   -> kind = selected: opportunityId / lanePosition / operationIndex /
              Skillなら groupの seriesSkillId / groupSkillId、Bonusなら exact ordered 5枠 /
              restorationBonusScope、および groupの match
未選択lane -> kind = ideal: CandidateのIdeal終点。Skillなら candidate.seriesSkillId /
              groupSkillId、Bonusなら candidate.finalBonuses（exact ordered 5枠）/
              candidate.restorationBonusScope、match = ideal
```

Skillのみ選択なら「選択Skill + exact Ideal Bonus」、Bonusのみ選択なら「exact Ideal Skill +
選択Bonus」がhash対象である。Candidate Snapshot hashは `finalBonuses` を順不同multisetとして
正規化するが、checkpointのTrace Replay検証は順序付きなので、pin pair側の5枠はselected /
idealのどちらもsortしない。同じIDのままpayloadが変わるstructurally-valid artifactや、
Skillのみ選択でIdeal Bonusのslot順だけが変わったartifactでも既存Planが再計算対象になる。
途中採用状態をまったく持たないEntryはcheckpointを持たないため、pin pairは `null` であり、
Candidate Snapshot hashの従来semanticsは変えない。Candidate identityとdeduplication keyは
変更しない。Snapshot上で解決できない選択IDはvalidationの責務であり、hash helperは未解決IDとして
決定的に扱うだけで、空選択とも Ideal終点とも読み替えない。

#### 7.5.6 選択を持つEntryはTargetのrequired Entry

どちらかのlaneを選択したBuildListEntryは、そのPlanner runにおける当該Targetの
**required Entry** である。選択は「このTargetではこのcanonical Ideal Route上の途中状態を
必ず利用する」というユーザー入力であり、同じTargetの別Entryで迂回できてはならない。

required Entryを持つTargetについて、Plannerは次を保証する。

- Targetの完了は、required Entry自身が妥協checkpointへ実到達し、その
  Ideal Candidateを `reserve_weapon` でsecureしたときだけである。別Entry、別Target
  のEntry、または既存武器によって `hasIdeal = true` になっても、それだけでは
  Targetを完了扱いにしない
- required EntryはsecureされるまでrelevanceをPlannerに保つ。`hasIdeal` だけで
  irrelevantにしない
- 同じTargetの他のBuildListEntryは、そのrunのcandidate selectionから外す。代替
  完成Routeとして採用せず、競合検出・共有physical action・scoreにも参加させない。
  永続データを削除・stale化する必要はなく、authorityをrequired Entryへ固定する
  だけである。外したEntryは `selected_checkpoint_fixes_target_entry` warningで
  ユーザーへ伝える

authorityは `PlannerCheckpointRequirements`（Target -> required Entry ID）の1つであり、
`preparePlannerInitialContext()` がそのrunのvalid BuildListEntry全体から導出する。
`entryIsRelevantForState()`、`isPlannerSearchStateComplete()`、Beam Searchの展開・
reserve・conflict detection・`progressPotential`、typed termination、constrained
re-search / what-if（9.5.2）はすべてこの1つの導出を読む。どこかで参加者だけから
再導出してはならない。

これはscoreではなくhard correctness / feasibility constraintである。required Entryを
「他Entryより高いscore」で優先する実装にしない。

Plan生成後にも同じ不変条件をfail-closed defenseとして置く。`completed` を主張する
Beam Searchの結果がrequired Entryをsecureしていない場合、またはsecure済みrequired Entryの
`PlanStep.checkpointMilestones` が存在しない場合は `PlannerPlanGenerationError` として
失敗し、Draft Planを作らない。

#### 7.5.7 1 Targetにつき選択を持つEntryは最大1件

同一TargetにBuildListEntryが複数存在すること自体は許可する。ただし選択を持つEntryが
同一Targetに2件以上ある場合、ユーザーが2本のRouteを両方必須にしたのか代替として
選んだのかをPlannerは推測できない。

v1では保守的に、Planner入力のcollection-level invariantとして

```text
1 Targetにつき intermediateStateSelection のどちらかのlaneを選択したBuildListEntryは最大1件
```

を要求する（[DATA_MODEL.md](./DATA_MODEL.md) 9.4）。判定対象はvalidation後の
valid Entry集合である。2件以上ある場合は `validatePlannerInput()` が
`buildListEntries` のvalidation issueと `multiple_selected_checkpoint_entries`
warningでfail closedし、Build Listで片方の選択を解除するよう案内する。
自動で片方を選ぶ、score・Candidate cost・入力順で決める、最初のEntryを採用する、
のいずれも行わない。

#### 7.5.8 既にIdeal所持のTargetに選択がある場合

Planner開始時点で `hasIdeal = true` のTargetにrequired Entryがある場合、
Plannerはその選択を暗黙に捨てて正常終了してはならない。v1では安全側として、
`createInitialPlannerSearchState()` が `buildListEntries` のvalidation issue
（`invalid_state`）と `selected_checkpoint_target_already_ideal` warningで
Planner入力をfail closedし、「既に理想品を所持している目標武器の選択を
Build Listで解除してください」と案内する。

選択の無いTargetが既にIdealを所持している場合は従来どおり
（`all_targets_already_satisfied` など）である。

#### 7.5.9 壊れた選択はPlanner入力をfail closedする

`intermediateStateSelection` の構造違反（Candidate Snapshotに存在しないopportunity ID、
別laneのID、未知の改善優先）は、
[DATA_MODEL.md](./DATA_MODEL.md) 9.4のDomain validationが拒否する。Planner入力
validationも同じ共有関数 `validateBuildListEntryIntermediateStateSelection()` を各
BuildListEntryへ適用し、違反があればそのEntryを含むPlanner入力全体を
`buildListEntries.<id>.intermediateStateSelection` のvalidation issueと
`invalid_checkpoint_selection` warningでfail closedする。

- 壊れた選択を「選択なし」と解釈してBeam Searchへ入れない
- 同じTargetのselection-freeな別Entryを代わりに採用して迂回しない（Planner入力全体が
  無効なので、そのrunではどのEntryも計画しない）
- 保存済み `isStale` を現在状態のauthorityとして信用しない契約は変わらない。
  この検証はstalenessではなく、現在入力の構造検証である
- 正しい選択を持つEntryと選択のないEntryは従来どおり動作する

### 7.6 Plan preference: 理想品までの改善優先

`BuildListEntry.intermediateStateSelection.improvementPreference`
（`planner | skill_first | bonus_first`）は、妥協checkpoint到達後（選択が無いEntryでは
Route開始から）にSkill laneとBonus laneのどちらを先に理想へ近づけるかのユーザー希望である。
これは **soft preference** であり、hard constraintではない。

#### 優先順位

```text
correctness / feasibility
  -> 選択済み途中採用状態の充足（7.5）
  -> Target satisfaction
  -> Counter / source / inventory feasibility
  -> 複数Target全体のPlan成立
  -> 既存evaluationScore / cost / conflict評価
  -> preferred source match（7.4）
  -> improvementPreferenceViolationCount 昇順
  -> weaponSwitchCount（7.3）
  -> stable tie-break
```

#### metric

`PlannerSearchState.improvementPreferenceViolationCount` をincremental runtime stateとして持つ。
物理actionで進んだ各Entryについて、その改善優先が `planner` でなく、そのEntryの
checkpointが到達済み（選択が無ければ常に）で、実行したunitが非優先laneであり、かつ優先lane
に残りunitがある場合に +1 する。base laneのunit、silent fast-forward、`reserve_weapon` は
数えない。`createPlannerSearchStateSemanticKey()` へは入れない（trace projectionの純粋関数）。

#### Beam Searchへの影響

7.0.4のとおり、各展開はそのstateで実行できる両laneのunitをどちらもsuccessorとして生成する。
改善優先はsuccessor生成に一切影響せず、`comparePlannerSearchStates()` のranking termとして
だけ働く。`planner` はどちらのlaneにもpreferenceを付けない設定であり、「Bonusを先に試す」の
意味ではない: 両laneのbranchを対等に生成し、既存scoringと全体feasibilityに任せる。
したがって

- 両laneが同等に成立する場合、Plannerはユーザー指定の改善優先を反映する
- 優先laneが今実行可能でも、それを先に進めると将来の全体Planが成立しない場合（例:
  別TargetがそのCounter位置を後で必要とする）、Plannerはもう片方のlaneを先に進めた
  branchを選んでPlanを完成する。violationは記録するが、branchを拒否せず、rejectionも
  conflictも生成しない
- 選択済み途中採用状態のpin（hard constraint）は改善優先より常に上位である

上限付きBeam Searchであるため、violation数の絶対最小は保証しない。決定性は従来どおり維持する。

#### 変更しないもの

改善優先はTargetWeaponに保存せず、Target定義hash、Candidate identity、
`searchStateHash`、`referencedOwnedWeaponsHash` に入らない。Production RNG semantics、
physical action sharing、silent fast-forward、conflict semantics、Trace Replay semanticsを変更しない。

## 8. 在庫シミュレーション

Plannerは所持レア8通常アーティアと所持巨戟アーティアの両方を有限のOwnedWeapon資源として扱う。レア6・7通常アーティアはv1 Inventoryへ含めない。

```ts
export interface SimulatedInventory {
  ownedWeapons: OwnedWeapon[];
  consumedWeaponIds: OwnedWeaponId[];
  reservedWeaponIds: OwnedWeaponId[];
  createdWeaponIds: OwnedWeaponId[];
}
```

武器状態の扱い。

- レア8通常アーティアかつ保護OFF: `owned_normal_artian_to_gogma` の変換元として使用可能
- 通常アーティアかつ保護ON: 変換元として使用しない
- 巨戟アーティアかつ保護OFF: Reset Bonuses / Keep Bonuses / Reset Skillsの起点として使用可能
- `isProtected = true`: Reset Bonuses・Keep Bonuses・Reset Skillsへ使用しない
- `status` は使用可否の判定に一切使用しない。未分類 / 実用 / 理想はユーザー管理ラベルである
- 所持レア8通常アーティアを巨戟化したStateでは元通常アーティアをInventoryから除き、同じ通常アーティアを二重使用しない
- `owned_normal_artian_to_gogma` ではconvert_normal_to_gogma適用時に元NormalをInventoryから削除し、変換後GogmaはまだOwnedWeaponとして追加しない。以後そのNormal IDは別Routeへ利用できない。これは探索上の排他source表現である
- ProductionPlanのexecution projection（16.3）では、所持Normalの巨戟化は同じOwnedWeapon IDを `normal` から `gogma` へ更新し、元IDを削除して別のGogma IDを作らない。新規Normal Routeでは作成対象Normalを作成Stepで登録し、同じIDを巨戟化・完成まで維持する。探索内部表現とprojectionの違いは、Plan全体のsemantic outcome（最終的な武器性能、保護、Target完了、Counter進行）を変えてはならない
- 通常アーティアはstatusを持たない

### 8.1 所持武器を素材として消費するモデルは存在しない

所持している巨戟アーティア武器そのものを消耗品として消費するv1 Planner仕様は撤去した。
Plannerは次の概念を一切持たない。

```text
use_weapon_as_material        RouteOperation
canUseAsMaterial              Domain rule
canConsumeMaterialWeapon      SimulatedInventory
consumeMaterialWeapon         SimulatedInventory
consumedMaterialWeaponCount   PlannerSearchState
PlannerMaterialRequirement    Planner-only DTO
PlannerMaterialAssignment     Planner-only DTO
material_weapon_shortage      PlannerWarningKind
create_material_gogma         PlanStepOperationType
change_owned_weapon_status    PlanStepOperationType
```

したがってPlannerは次を行わない。

- 素材用巨戟の不足を判定する
- 素材用巨戟を補充するRoute / Stepを生成する
- 素材補充だけを目的にNormal / Gogma / Skill Counterを進める
- 旧PracticalをMaterialへ変える確認付きStepを予定する
- statusだけを変更する専用Stepを予定する
- 素材武器の消費本数をscoreへ加算する

`SimulatedInventory.consumedWeaponIds` は維持する。所持通常アーティアの巨戟化で元武器を
在庫から消費し、同じsourceを二重利用しないためのsemanticsであり、素材消費とは別概念である。

statusを書き換える経路は次の4つだけである（16章）。

```text
任意のユーザー管理ラベル変更
→ Owned Weapons画面の通常CRUD

巨戟化Stepの確定（Execution）
→ 追跡武器が巨戟になった時点の初期値 status = unclassified

選択済み妥協checkpointへ到達したStepの確定（Execution、16.12）
→ status = practical（保護は変更しない）
   「妥協品として確定して終了」でもpracticalのまま確定する

理想品完成Stepの確定（Execution、16.13）
→ status = ideal、isProtected = true（新規生成武器でも既存武器でも保護する）
```

Planner計算（Beam Search、Trace Replay、reserve action）はstatusを永続化しない。
探索内部のreserve effectは上記の完成semanticsに従い、既存武器も保護ありとして扱う（16.3）。
性能が妥協条件や理想条件を満たしただけでは、選択済みcheckpoint到達・理想品完成Stepの確定を
経ずにstatusを変更しない。statusはnon-semanticのままで、Search eligibility、Plannerの
operation可否、Target Satisfaction、semantic hashを決めない。Material化のためのstatus変更と
`change_owned_weapon_status` PlanStepは廃止した。

### 8.2 ゲーム内アイテム素材

復元強化やスキル再抽選が消費するゲーム内アイテム素材は別概念であり、
`MaterialRequirement`、`MaterialCostMaster`、`PlannerMasterSubset.materialCosts`、
`ProductionPlan.requiredMaterials`、`InventoryChange.materialRequirements` として維持する。

制約。

- 初期版ではアイテム素材の所持数不足をPlan不可理由にしない
- 必要数を表示するだけで、所持数管理や不足判定を行わない
- protected武器へのReset Bonuses・Keep Bonuses・Reset Skillsが必要な探索展開は生成せず、該当BuildListEntryを不採用として理由を残す
- Search後に起点武器がprotectedへ変わった場合、Bonus / Skill amendmentを必要とするEntryはPlanner入力validationで実行不能とする
- PlannerはCandidate Route内の具体的な起点OwnedWeapon IDを別武器へ差し替えず、reserveはBuildRouteを書き換えない。reserveは探索内部actionであり、current ProductionPlanでは独立Stepではなく最後の物理Stepのtarget completion effectになる（16.3）

---

## 9. 競合検出

同じRNG位置または同じ資源を同時に必要とする候補を競合として扱う。

競合種別は `DATA_MODEL.md` の `ConflictKind` を使用する。

検出条件。

- 同じGogma Counter位置で同時取得できない候補
- 同じSkill Counter位置で同時取得できない候補
- 同じ通常アーティアCounter位置で同時取得できない候補
- 同じOwnedWeaponを起点として排他的に使用・消費する候補

Counter位置の競合対象は、その位置で物理的に実行する必要があるunitだけである。
`canSkipWhenCounterPassed` なunitはその位置を排他的に必要としないため、competition
participantにもconflict resolutionのblocking対象にもならない（7.0.2）。同一physical
actionとしてshareできる場合も従来どおり競合ではない。`same_owned_weapon_consumed` には
この除外を適用しない。

選択済みcheckpointの終端unitは `canSkipWhenCounterPassed = false` になるため、
通常の必須unitと同じく競合当事者になりうる（7.5.2）。

ただし競合でないことと実行順序が自由であることは別である。必須unitとskip可能unitが同じ
Counter位置にある場合、必須unitを先に実行する順序をPlanner自身が一意に決める（7.0.2）。
ユーザー選択の競合ではないため、Conflict Resolution UIへ出さない。

解決方針。

1. Target priorityが高い候補
2. 見送った場合の次候補までの距離が遠い候補
3. 武器消費が少ない候補
4. 操作量が少ない候補

ユーザー選択が必要な場合。

- score差が小さい
- どちらも高優先度Targetの候補

### 9.5 checkpointが関係する競合

競合の当事者が選択済み途中採用状態の終端unitである場合、`PlanConflict` へ
typed metadataとしてそれを記録する。

```ts
export interface PlanConflictCheckpointParticipant {
  buildListEntryId: BuildListEntryId;
  axis: IntermediateStateAxis;
  opportunityId: IntermediateStateOpportunityId;
}
```

`PlanConflict.checkpointParticipants` は、その競合のどのEntryが「自分で選んだ
途中採用状態のために」その位置を必要としているかを示す。UIはこれを使って
「この競合には途中採用する状態の選択が関係しています。作成リストで途中採用する状態を変更
または解除してください。」と案内できる。

- `PlanConflict.id` の生成規則には含めない。既存のConflictKind + kind固有position +
  sorted participant Entry IDのままである
- 新しい `ConflictKind` を追加しない
- Plannerがこのmetadataを見て選択を自動変更することはない

#### 9.5.1 checkpoint競合は勝者選択で解決できない

`checkpointParticipants` が1件以上ある競合は、汎用の `PlannerConflictResolution`
では解決できない。どちらのEntryを優先しても、もう一方の選択済みcheckpointを
Plannerが落とすことになるためである。保守的に、参加者の一方だけがcheckpointで
あっても、その競合全体を「この候補を優先」の対象外とする。

この拒否はDomain authorityであり、UIだけの無効化ではない。

- 判定は `conflictResolutionRefusalReason()` の1箇所に置く。競合が見つからない、
  選択Entryが参加者でない、選択済みcheckpointが関係する、のいずれかで拒否する
- 初期conflict detectionは拒否したresolutionを適用せず
  `selectedBuildListEntryId = null` のままにする。半適用はしない
- Beam Searchは `invalid_conflict_resolution` warningを返し、Application / UIは
  既存のfail closed(11.4)でPlanを保存しない
- constrained re-searchの `preparePlannerFixedConflictConstraints()` は
  `checkpoint_conflict` で失敗し(all-or-nothing)、再検索を開始しない。
  preflightの再対応付け(9.2.3.1)も、対応先の競合がcheckpoint競合なら
  `checkpoint_conflict` で失敗する
- Plan UIは、その競合の全participantを `checkpoint_conflict` として利用不可にし、
  「比較する」「この候補を優先」を無効化して作成リストへの導線を示す
  ([UI_FLOW.md](./UI_FLOW.md) 11.1)

解決手段は作成リストでcheckpointを変更または解除することだけである。
同じ武器の同じ操作が複数Entryのcheckpointへ同時に到達する場合は、従来どおり
1つの共有physical actionであり競合ではない(7.5.2)。

#### 9.5.2 選択済みcheckpointを持つTargetは再検索対象外

constrained re-search(9.2)とwhat-if(9.2.4)は、required checkpoint Entry（7.5.6）を
持つTargetのRouteを置き換えない。

- 選択済みcheckpointを別のopportunityへ自動的に移さない
- 「同じ性能へ到達する別Route」へ差し替えない
- 選択を空にして再検索しない

判定はTarget-wideである。authorityはcurrent PlannerInputのvalid BuildListEntry全体から
導出した `PlannerCheckpointRequirements`（7.5.6）であり、Conflict contextの
participantだけではない。競合のparticipantがcheckpointを持たない別Entry Bであっても、
同じTargetにcheckpoint-selected Entry Aが存在する限り、そのTargetは代替Routeへ
再検索しない。`createPlannerConflictWorks()` はorchestrationとwhat-ifの両方で
同じrequirementsを受け取り、participantの `hasSelectedCheckpoints` はその狭い
証拠として残す。

orchestrationは該当Targetの `PlannerConflictWork` を
`blockedBySelectedCheckpoint = true` とし、enumeration・materialize・trialを一切
行わずに競合をそのまま返す。warning kindは
`selected_checkpoint_blocks_constrained_search`、what-ifの `outcome.status` は
`blocked_by_selected_checkpoint` とする。選択を持たないTargetの再検索は従来どおりである。

なお7.5.6により、required Entryを持つTargetの他のEntryはそのrunで競合の
participantにならない。したがってparticipant経由の迂回は、持ち越した
`PlannerConflictResolution` が現在の競合と対応しないことでもfail closedする。

競合をユーザーが選択した場合は、現在入力へ `PlannerConflictResolution` を追加して
Plannerを再実行する。`conflictKey` は検出された `PlanConflict.id` と対応し、その競合では
選択Entryを優先して相反Entryを採用しない。これは局所的な競合解決であり、全Planの
作成順固定ではない。

`PlanConflict.id` はrandom IDではなく、ConflictKind、kind別の競合位置、sort済みの
BuildListEntry IDsからstable hashで生成する。same_gogma_counterはGogma Counter、
same_skill_counterはSkill Counter、same_normal_counterはNormalArtianCounter IDと位置、
same_owned_weapon_consumedはOwnedWeapon IDを位置情報として使う。Candidate IDと
PlannerIdFactoryは使用しない。

第9の適用時には、再検出された競合のIDがconflictKeyと一致し、選択Entryがその競合の
参加BuildListEntryに含まれる場合だけresolutionを適用する。

選択Entryが削除済み、stale、Target無効、Capability不足、または保護状態変更により
実行不能ならresolutionを適用せず `invalid_conflict_resolution` warningを返し、再選択を促す。

protected武器へのReset Bonuses・Keep Bonuses・Reset Skillsは競合として解決せず、常に実行不能として `requires_protected_weapon` の不採用理由を付ける。

RouteOperation別のRNG位置は実際に消費するstreamで判定する。`convert_normal_to_gogma` は `same_skill_counter` の競合対象であり、`same_gogma_counter` として扱わない。Reset SkillsもSkill、Reset / KeepだけがGogma、forgeだけが該当Normal Counter位置を競合資源とする。

## 9.1 Candidate SearchとPlannerの責務分離

```text
Candidate Search
  このTarget単体を現在のRNG状態から作るなら、
  近い位置にどの実用品・理想品があるかを高速に求める

Planner
  複数Targetを同時に作る場合に、Counter操作をどう両立させるかを決める
```

Candidate Searchは、Plannerで将来競合する可能性があるという理由だけで、2個目以降の
同一Ideal、遠いCounter位置の代替Ideal、Bonus代替 × Skill代替のCartesian productを
初回検索で先読みしない。初回検索はcanonical Idealを1件確定した時点で終了し、
そのRoute上のcheckpointを記録済みtraceから抽出する
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6 / 5.8参照)。

複数Target間でCounter競合が実際に発生した場合にだけ、Plannerが必要に応じて次を調べる。

- 競合したTargetの再検索
- 一方を優先した場合の他方の次に実行可能なIdeal Route
- どちらを優先するとどの程度遠くなるか

ただし選択済みcheckpointを持つTargetは再検索の対象外である(9.5.2)。

## 9.2 Planner-driven constrained re-search

B8-Aで正式契約を確定した。実装はB8-B1以降で行う。

- 9.2.1〜9.2.5はB0で固定した責務と禁止事項であり、B8-AでもB9-A2でも変更しない
- 9.2.6以降がB8-Aで追加した正式契約である
- 9.2.4のwhat-if比較はB9、競合UIはB10であり、B8では実装しない
- 9.2.4.1〜9.2.4.13はB9-A2で確定したwhat-if比較の正式契約である。B8の契約
  (9.2.1〜9.2.3.1、9.2.5〜9.2.17)とB0固定契約は変更していない

B8 architecture自体はProduction RNG semantics、RouteOperationの意味、ProductionPlanの
永続shape、PlanStepの意味、既存BuildListEntryのshapeを変更しない(9.2.17)。

### 9.2.1 開始位置を後方固定しない

再検索の開始位置を次のような単純な後方検索へ固定してはならない。

```text
禁止 : startCounter = conflictingCounter + 1
```

`Ideal +10` が競合していても、`Practical +4` や `Practical +6` のように競合位置より
前に利用可能な実用品が存在し得る。再検索は元のSearch / RNG起点を基準に再評価し、
Plannerが固定しているCandidateとconflict contextを制約として渡して、その制約下で
実行可能かどうかを判定する。

ここでいう「元のSearch / RNG起点」は次を指す。

```text
正 : Planner計算開始時のcurrent validated Search / RNG snapshot
誤 : 過去のUI Candidate Search request
```

過去のUI requestは永続化されておらず、BuildListEntryは `searchStateHash` /
`referencedOwnedWeaponsHash` というhashしか保持しないため、Planner / BuildListから
復元できない。したがってenumeratorへ渡す起点はPlanner計算開始時の現在状態から構成する
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。「競合位置より後ろへ後方固定しない」という
本節の禁止事項は変わらない。

### 9.2.2 Counter位置だけで除外しない

同一Counter位置でもPlanner上shareableなoperationが存在するため、次のような
単純除外を行ってはならない。

```text
禁止 : Counter 351を使っている -> Counter 351を使うCandidateはすべて禁止
```

判定は本書の既存契約に基づく。

- counter precondition(runtime counterと `counterBefore` の一致)
- action identity
- shareable operation

Candidate Search側にこれらのPlannerロジックを複製してはならない。
望ましい責務分担は次である。

```text
Candidate Search
  -> Candidateを順次提示

Planner / constrained search orchestration
  -> 固定Candidateと共存可能か評価

実行不能 -> 次のCandidate探索を継続
実行可能 -> 次のIdeal Routeとして採用
```

### 9.2.3 Planner conflict context

再検索へ渡す競合文脈は、B8 orchestration専用の非永続transient DTOとする。
既存の `PlanConflict` と `PlannerConflictResolution` を変更・置換しない。
永続化せず、`ProductionPlan` へ埋め込まない。

保持する情報は少なくとも次とする。

| 項目 | 粒度 | 内容 |
| --- | --- | --- |
| `PlanConflict.id` | 競合 | 検出時点のstable conflict key |
| ConflictKind | 競合 | 既存の `ConflictKind` |
| 競合資源identity | 競合 | 下記の競合資源identity |
| counter stream | 競合 | Skill / Gogma / Normal。`same_owned_weapon_consumed` では null |
| Normal Counter ID | 競合 | `same_normal_counter` の場合のNormalArtianCounter ID |
| `counterBefore` | 競合 | 競合しているCounter位置 |
| 競合対象OwnedWeapon ID | 競合 | `same_owned_weapon_consumed` の場合の排他消費OwnedWeapon ID |
| `counterAfter` | participant | participantごとの操作後Counter位置 |
| operation type | participant | `RouteOperation` の種別 |
| `sourceOwnedWeaponId` | participant | 必要な場合の起点武器 |
| `physicalActionKey` | participant | 既存 `PlannerRouteUnit.physicalActionKey` |
| BuildListEntry ID | participant | 競合参加Entry |
| TargetWeapon ID | participant | 競合参加Target |
| Candidate semantic fingerprint | participant | 9.2.12のsemantic identity |
| 固定制約 | 競合 | 固定して残すBuildListEntry / TargetWeapon |

`counterAfter`、operation type、`sourceOwnedWeaponId`、`physicalActionKey` は
競合単位ではなくparticipant単位で保持する。参加者ごとに異なり得るためである。

#### 競合資源identity

競合資源identityはConflictKindごとに次で構成する。participant BuildListEntry集合を
含めない。これは9.2.3.1の再対応付けで、participant集合が変わっても同じ物理競合を
同定するための鍵だからである。

| ConflictKind | 競合資源identity |
| --- | --- |
| `same_gogma_counter` | ConflictKind、Gogma Counter位置 |
| `same_skill_counter` | ConflictKind、Skill Counter位置 |
| `same_normal_counter` | ConflictKind、NormalArtianCounter ID、Normal Counter位置 |
| `same_owned_weapon_consumed` | ConflictKind、排他消費されるOwnedWeapon ID |

`same_owned_weapon_consumed` の競合対象OwnedWeapon IDは、conflict context DTOへ
明示的な独立fieldとして保持する。participantの `sourceOwnedWeaponId` で代用しては
ならない。両者は別concernのfieldであり、participant単位のfieldから競合資源を
復元する実装にしない。

これは `PlanConflict.id` の生成規則([DATA_MODEL.md](./DATA_MODEL.md) 11.8)を
変更するものではない。`PlanConflict.id` は従来どおりConflictKind、kind別の競合位置、
sort済みBuildListEntry IDsから生成する。競合資源identityは、そのうち
BuildListEntry IDsを除いた部分をorchestrationが個別に保持するtransient値である。

`PlanConflict.id` は既存契約どおりstable conflict keyであり、conflict contextは
その周辺情報を補う位置づけである。既存の `PlannerConflictResolution` を置き換えない。
このDTOをSearch Domainへ渡してはならない(9.2.9)。

### 9.2.3.1 conflict preflightとConflict Resolution再対応付け

`PlanConflict.id` はparticipant BuildListEntry集合を含む。したがってgenerated Entryを
加えたaugmented PlannerInputでは、**同じ物理競合でもIDが変わり得る。**

```text
元のPlan            : same_gogma_counter, position 351, entries { E1, E2 }     -> id X
generated Entry追加後 : same_gogma_counter, position 351, entries { E1, E2, G1 } -> id Y
```

元の `conflictKey` をそのまま再利用してはならない。IDが変わった場合、その
`PlannerConflictResolution` は再検出された競合と一致せず、既存の適用規則により
無視されて `invalid_conflict_resolution` になるためである。

再対応付けをfull Beam Search実行**後**に行う設計にしてはならない。次は循環である。

```text
禁止 : Beam Search完全再実行 -> Conflict取得 -> resolution再構築 -> もう一度完全再実行
```

resolutionが無いまま実行したBeam Searchの結果は、ユーザーの固定意図を反映していない。
その出力からresolutionを組み立てて再実行するのでは、full Beam Searchが必ず2回以上必要に
なり、`maxPlannerReruns` の意味も曖昧になる。

正式順序は次とする。再対応付けはfull Beam Searchの前に、既存Planner authorityによる
**initial conflict preflight** で行う。

```text
temporary generated Entryを含むaugmented PlannerInputを作成
  ↓
preflight用に、staleな旧conflictKeyを適用しない入力を作成
  ↓
validatePlannerInput
  ↓
validation.validBuildListEntries
  ↓
createInitialPlannerSearchState
  ↓
通常Plannerと同じinitial relevant-entry selection
  ↓
createPlannerRouteUnitPlans
  ↓
detectPlannerConflicts
  ↓
元の全fixed constraintを現在のConflict群へ一意に再対応付け
  ↓
現在の PlanConflict.id で PlannerConflictResolution[] を再構築
  ↓
その完全なresolution配列を持つaugmented PlannerInputで
Beam Searchを初期Stateから完全再実行
  ↓
Planner / Trace Replayを最終coexistence authorityとする
```

#### preflightのvalidation authority

preflightは通常Beam Searchとまったく同じvalidation authorityを使う。
raw `BuildListEntry` から直接preflightしてはならない。

理由。`createInitialPlannerSearchState()` は `ValidatedBuildListEntry[]` を要求し、
通常のBeam Searchは `validatePlannerInput()` が返す `validBuildListEntries` だけを
使う。preflightだけraw Entryを使うと、staleness、capability、prediction support、
protection、CalculationContext互換性の判定が通常Plannerと乖離する。

契約。

1. preflight入力は、staleな旧 `conflictKey` を持つ `conflictResolutions` を
   適用しない状態で作る。旧keyはこの時点で一致しないため、適用すると
   `invalid_conflict_resolution` を誤って発生させる
2. `validatePlannerInput()` を通し、`validation.validBuildListEntries` を得る
3. `createInitialPlannerSearchState(input, validation.validBuildListEntries)` で
   初期Stateを作る
4. 通常Plannerと同じinitial relevant-entry selectionを適用する。Route unit planを
   持つEntryへの絞り込み、安定sort、初期Stateに対するentry relevance判定を
   通常経路と一致させる
5. `createPlannerRouteUnitPlans()` でRoute unit planを作る
6. `detectPlannerConflicts()` で `PlanConflict` を検出する。
   B8専用の `usedCounters` 等の簡易競合判定を追加してはならない(9.2.11)

fail closed規則。

```text
generated Entry が validation で除外された  -> そのCandidate trialを採用しない
fixed Entry が validation で除外された      -> そのCandidate trialを採用しない
```

除外されたまま先へ進んではならない。除外理由は既存の
`excludedBuildListEntries` / warning契約をそのまま使う。

#### 二重実装の禁止

B8-Cでこの経路を独自に再実装し、通常Plannerと乖離させてはならない。

推奨契約は次である。

```text
現行 runPlannerBeamSearch のinitial conflict detection経路を
shared pure helperへ抽出し、
通常PlannerとB8 preflightの双方が同じhelperを使用する。
```

helperの具体的な名称と分割単位はB8-Cで決めてよい。ただし次の意味を二重実装しない。

```text
validation
validBuildListEntries
initial state
entry relevance
route unit plans
conflict detection
```

preflightは引き続きBeam Searchではなく、`maxPlannerReruns` に数えない(9.2.16)。

#### 全explicit resolutionの再対応付け

B8 orchestrationは、再検索対象となった競合のresolutionだけを保持してはならない。
`PlannerInput` には複数の `PlannerConflictResolution` が存在し得る。generated Entryの
追加でparticipant集合が変われば、**今回の再検索対象ではない別Conflictの
`PlanConflict.id` も変わり得る。**

```text
元のvalidated PlannerInput
  ↓
全てのvalid PlannerConflictResolutionを取得
  ↓
resolutionごとにtransient fixed constraintを作成
    fixed BuildListEntry ID
    fixed TargetWeapon ID
    fixed Candidate semantic fingerprint
    競合資源identity
  ↓
augmented preflight
  ↓
全fixed constraintを現在のConflict群へ再対応付け
  ↓
全て一意に対応できた場合のみ
現在の PlanConflict.id を使った PlannerConflictResolution[] を再構築
  ↓
その完全なresolution配列でBeam Searchを実行
```

対象となった1件だけを再構築し、他のユーザー明示resolutionを黙って捨ててはならない。

取得元は元のvalidated PlannerInputの `validation.validConflictResolutions` とする。
validationが既に無効と判定したresolutionを復活させない。

各fixed constraintごとの判定。

```text
一致1件                          -> current conflictKeyへ再構築
一致0件                          -> 推測しない
一致複数                          -> 推測しない
fingerprint不一致                 -> 推測しない
fixed Entryがvalidation除外       -> 推測しない
```

一致条件は次の両方である。

```text
競合資源identityが一致する
buildListEntryIds が fixed BuildListEntry ID を含む
```

再構築するresolutionの形は次とする。

```text
PlannerConflictResolution = {
  conflictKey: preflightで再検出した PlanConflict.id,
  selectedBuildListEntryId: fixed BuildListEntry ID,
}
```

既存のexplicit resolutionのうち1つでも安全に再対応付けできない場合は、そのCandidate
trialを採用せずfail closedにするか、ユーザーへConflictを返す。一部だけ再構築した
不完全なresolution配列でBeam Searchを実行してはならない。ユーザーへ再選択を求める
経路は既存の `invalid_conflict_resolution` と同じ扱いとする。

`recommendedBuildListEntryId` やPlanner bestStateから代替のfixed Entryを作らない
という9.2.7の契約は維持する。再対応付けできないことを、別Entryを固定してよい理由に
しない。

#### Beam Search実行

再構築できた完全なresolution配列を含むaugmented PlannerInputで、初期Stateから
Beam Searchを1回完全再実行する。共存可能性の最終authorityはこのBeam Searchと
Trace Replayであり、preflightではない(9.2.11)。

規則。

- preflightはConflict検出とresolution再対応付けのためだけに行う。Candidateの採否、
  共存可能性、Plan内容をpreflightの結果だけで決めない
- preflightは `maxPlannerReruns` に数えない。`maxPlannerReruns` はfull Beam Searchの
  実行回数だけを数える(9.2.16)
- fixed BuildListEntry IDは、ユーザーが選択した既存Entryである。generated Entryを
  fixed側へ昇格させない
- fixed Candidate semantic fingerprintは、fixed Entryがpreflightの時点で別Candidateへ
  すり替わっていないことの検証に使う。fingerprintが一致しない場合は再対応付けを
  成立させない
- 競合資源identityにparticipant BuildListEntry集合を含めない。含めると
  generated Entry追加によって必ず不一致になり、再対応付けが常に失敗する
- 再対応付けはorchestrationのtransient処理であり、`PlanConflict.id` の生成規則、
  `PlannerConflictResolution` の型、Beam Search内のresolution適用規則を変更しない

### 9.2.4 what-if比較

複数武器で競合した場合、ユーザーが「どちらを優先すべきか」を判断できる情報を将来提供する。

```text
Target Aを優先した場合
  Target B:
    次に実行可能なIdeal      +47

Target Bを優先した場合
  Target A:
    次に実行可能なIdeal      +12
```

契約。

- 一方を固定したPlanner制約下で、他方の次に実行可能なIdeal Routeまでの距離を求める
- 「競合Counter以降のIdealだけ」を探す仕様にしない。競合位置より前の位置で完成する
  Ideal Routeも、固定Candidateと共同実行可能なら候補である
- 選択済みcheckpointを持つTargetには代替Routeを求めず
  `blocked_by_selected_checkpoint` を返す(9.5.2)
- 距離の表現は既存の `estimatedGogmaAdvance` / `estimatedSkillAdvance` /
  `estimatedNormalAdvance` と `estimatedOperationCount` を用いる

what-if比較はB9で実装する。B8では実装しない。B8のorchestrationは、B9が明示的な
仮想fixed constraintを渡せる形へ将来拡張してよいが、B8でB9の機能を先取りしない。

B9-A2で正式契約を確定した。9.2.4.1〜9.2.4.13がその契約である。上記のB0固定契約
(距離表現、競合位置より前の位置も対象、後方固定の禁止)は変更しない。9.2.4.1以降は
それを具体化するものであり、9.2.1〜9.2.3.1、9.2.5〜9.2.17のB8契約も変更しない。

B9-A2は仕様文書だけを変更した。`src/**`、テスト、Worker protocol、DB schema、
schema version、Production RNG semantics、Candidate分類、Planner競合検出、
B8 orchestration、`defaultConstrainedEnumerationBounds`、
`defaultPlannerOrchestrationBounds`、`defaultCandidateSearchSettings`、
`defaultPlannerOptions` はいずれも変更していない。

#### 9.2.4.1 距離のbaseline

what-if距離のbaselineは次だけとする。

```text
正 : Planner計算開始時の ConstrainedSearchOrigin
```

これは9.2.1および[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7の「元のSearch / RNG起点」と
同一であり、B8 constrained enumerationが既に使用している起点である。したがって
what-if距離は、enumeratorが返す `ConstrainedCandidate` のestimate値をそのまま用いる。

```text
estimatedOperationCount
estimatedGogmaAdvance
estimatedSkillAdvance
estimatedNormalAdvance
```

禁止。

```text
競合Counter位置からの差分
固定Candidate実行後Stateからの差分
新しいdistance尺度の新設
B9専用のscore / distance comparatorの新設
```

理由。上記4値はorigin基準のadvanceとして定義されており
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 3.1)、9.2.4のB0契約が距離表現をこの4値へ固定している。
別のbaselineを採用すると、同じfield名で別の意味を持つ値が生まれる。

#### 9.2.4.2 Targetごとに1つの結果

what-ifが答えるのはTargetごとに1つである。

```text
このTargetが譲った場合、次に実行可能な理想品Candidateはどれだけ遠いか
```

constrained enumerationは理想品Candidateだけをyieldするため
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)、category別の枠は存在しない。
`PlannerWhatIfTargetComparison` は `targetWeaponId` と1つの `outcome` を持つ。

- practical枠 / ideal枠という2枠構造を設けない
- 妥協状態をwhat-ifの代替解として提示しない。妥協は独立したRouteではなく、
  採用された理想品Routeのcheckpointとして作成リストで選ぶものである

#### 9.2.4.3 「次」のordering authority

**重要。** B9の「次に実行可能」は次で定義する。

```text
compareConstrainedCandidates() 順に最小であり、
かつscenario固定制約下のPlanner full rerun + Trace Replayによって
共存可能性が証明されたCandidate
```

禁止。

```text
visitConstrainedCandidates() で最初にdeliveryされたCandidateを
そのまま「次」と決める
```

理由。`visitConstrainedCandidates()` のincremental delivery orderはfrontierの
best-first traversal orderであり、`enumerateConstrainedCandidates()` が最後に適用する
`compareConstrainedCandidates()` のfinal sorted orderと一致するとは限らない。B9の
semantic outcomeは後者を基準に固定する。

- ordering authorityは既存の `compareConstrainedCandidates()` とする
- B9専用のcomparatorやscoreを新設しない
- 実装方式(全列挙後にsortする / 同じ順序を保証する別consumerを組む)はB9-B1で決めてよい。
  本節が固定するのはsemantic outcomeだけである
- [SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7のconstrained enumeration semantics
  (route policy、yield条件、boundsのauthority、決定性、軸外Cross規則)は変更しない

#### 9.2.4.4 3 participant以上と独立評価

`PlanConflict.buildListEntryIds` は2件限定ではない([DATA_MODEL.md](./DATA_MODEL.md) 11.8)。
B9は2 participantを前提にしない。

1つのscenario固定Entryに対し、**unique非固定TargetWeaponごとに独立**へwhat-ifを求める。

```text
fixed A
  -> Target B what-if (ideal)
  -> Target C what-if (ideal)
```

各Targetの評価はすべて同じ前提から開始する。

```text
Planner開始時origin
scenario固定制約
その他のexplicit conflict resolution
```

禁止。

```text
Target Bのwhat-if Candidateを採用したinputでTarget Cの距離を測る
```

Target間の評価順によって距離が変わってはならない。非固定participantの列挙とTarget単位の
dedupeは、9.2.14のconflict work規則と同じく
`participant.buildListEntryId != fixedBuildListEntryId` かつ
`participant.targetWeaponId !== fixedTargetWeaponId` を満たすものを対象とする。

#### 9.2.4.5 scenario fixed authorityとpublic request

B9のcallerに、B8のtransient DTO(`PlannerConstrainedConflictContext` /
`PlannerFixedConflictConstraint`)を組み立てさせない。public概念requestは次とする。

```ts
interface PlannerWhatIfRequest {
  plannerInput: PlannerInput;
  scenarioResolution: PlannerConflictResolution;
  bounds: PlannerWhatIfBounds;
}
```

`PlannerWhatIfRequest` へ `ConstrainedEnumerationBounds` を追加しない。Application /
Worker requestが運ぶboundsは `PlannerWhatIfBounds` だけである。Search Domainの探索範囲は
Domain calculation側の別optionsとしてcaller必須で受け取る。

```ts
interface PlannerWhatIfCalculationOptions {
  enumerationBounds: ConstrainedEnumerationBounds;
  executionOptions?: PlannerExecutionOptions;
}
```

責務分離は次とする。

```text
Application / Worker caller
  PlannerWhatIfBounds を明示的に渡す

Production Worker adapter
  defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500 を
  Domain calculation へ明示的に渡す

Domain calculation
  enumerationBounds を caller必須で受け取る。
  default substitution / fallback / clamp / field-wise completion を行わない
```

これはB8-D1 / B8-E2bと同じ責務分離である。B8でも
`PlannerConstrainedWorkerTaskInput` は `PlannerOrchestrationBounds` だけを運び、
`ConstrainedEnumerationBounds` はProduction Worker adapterがWorker境界内で明示的に
供給する。B9も同じ形にし、Application callerへSearch Domainの探索範囲を再記述させない。
9.2.4.10のenumeration bounds契約と矛盾させない。

`scenarioResolution` が唯一の仮想fixed authorityである。Domain内部でのmerge規則。

```text
plannerInput.conflictResolutions のうち
scenarioResolution.conflictKey と同じ conflictKey のもの
    -> scenarioResolution で置換する

その他のexplicit resolution
    -> そのまま保持する

scenario keyが元inputに存在しない
    -> scenarioResolution を追加する
```

merge後は既存authorityをそのまま使う。

```text
validatePlannerInput()
preparePlannerInitialContext()
conflict context生成
fixed constraint構築
```

9.2.7の固定authority契約は変更しない。次からfixed sideを推論してはならない。

```text
PlanConflict.recommendedBuildListEntryId
Planner score
Beam Search bestState
Target priority
```

`PlannerConflictResolution` の型、`PlanConflict.id` の生成規則、Beam Search内の
resolution適用規則はいずれも変更しない。

#### 9.2.4.6 `reusedExisting` のsemantics

**重要。** B8 orchestrationの次の扱いをB9へ流用してはならない。

```text
B8 : reusedExisting === true -> trial 1消費、Beam再実行なし、そのtrialは不採用
```

B8でそれが成立するのは、同一のaugmented inputに対するcurrent Planner resultを既に
保持しており、同じ入力を再実行しても結果が変わらないからである(9.2.14)。B9は
baseline Planner resultを前提にせず、scenario固定制約下の実行可能性を新たに判定する。

B9の規則。materializerが `reusedExisting === true` を返した場合。

```text
重複するBuildListEntryを追加しない
その既存semantic Entryをtrial Entryとして使用する
scenario固定制約下で preflight + full Planner rerun + Trace Replay を行う
その結果で実行可能性を判定する
```

既存Entryであることだけを理由に、what-if Candidateから除外しない。

#### 9.2.4.7 feasibility authority

Candidateがwhat-if結果として `found` になる条件は次だけとする。

```text
full Planner rerun後の ProductionPlan.selectedBuildListEntryIds が
  trial Entry ID を含む
  かつ 全fixed Entry ID を含む
```

- 共存可能性の最終authorityは9.2.11のまま、既存Plannerの完全再実行とTrace Replayである
- B9専用の簡易競合判定(`usedCounters.has(counter)` 等)を追加しない
- B9はgenerated Entryをadoptしないため、9.2.14の
  「以前adopt済みの全generated Entryがselectedであること」に相当する条件は存在しない
- `completed === true` は要求しない。bound到達によるpartial Planでも、上記のEntryが
  すべてselectedならfeasibilityを認めてよい
- 9.2.3.1のinitial conflict preflightと全explicit resolutionの再対応付けは、B9でも
  full Beam Searchの前に行う。preflightは `maxPlannerReruns` に数えない

#### 9.2.4.8 transient only

B9は永続化を行わない。

```text
BuildListEntryを永続化しない
ProductionPlanを永続化しない
what-if resultをIndexedDBへ保存しない
Application / Persistenceの保存serviceを呼ばない
```

- materializeしたEntryはPlanner trial入力専用であり、破棄する
- resultへ `ProductionPlan` を含めない
- resultへCandidate IDやgenerated BuildListEntry IDを必須fieldとして要求しない。
  B9のproduct requirementは距離比較であり、永続Candidate identityではない
- 9.2.8の「trialで不採用だったCandidateは永続化しない」、9.2.15のPersistence契約、
  および[DATA_MODEL.md](./DATA_MODEL.md) 11.1の「Candidate SnapshotをProductionPlanへ
  埋め込まない」は変更しない

#### 9.2.4.9 `PlannerWhatIfBounds`

B9専用のboundsを新設する。B8の `PlannerOrchestrationBounds` を流用しない。

```ts
interface PlannerWhatIfBounds {
  maxCandidateTrialsPerTarget: number;
  maxPlannerReruns: number;
}
```

両方とも次を満たす。

```text
finite integer
>= 1
caller必須指定
validationのみ。repair / clamp / field-wise completion を行わない
```

**B9-B2bの専用real Browser Worker benchmarkに基づき、B9-B2cでProduction defaultを
2 / 8に確定した。** 実測と選定理由の詳細は
[B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md](./B9_PLANNER_WHAT_IF_BROWSER_WORKER_BENCHMARK.md)
9〜11章に記録する。

```ts
export const defaultPlannerWhatIfBounds: PlannerWhatIfBounds = {
  maxCandidateTrialsPerTarget: 2,
  maxPlannerReruns: 8,
}
```

定義authorityは `src/domain/planner/constrained/plannerWhatIfBounds.ts` とする。
T=2はtwo_targets / dual_categoryで必要な代替Idealを得る最小測定値で、Tを増やしても
semantic改善は観測されなかった。R=6はthree_targetsで全4枠foundとなる最小測定値だが、
combinedでは最後の枠がrerun boundで止まる。R=8ならcombinedの全4枠がT=2の試行まで
到達するため、finalistのcombined中央値で約1.8%の追加costを許容し、各非固定Targetの
評価機会を優先した。これは測定workload内の根拠であり、任意のTarget数で全枠の試行を保証する
ものではない。combinedのfoundは0で、Candidate不存在を意味しない。

この定数はcallerが明示的に選択して渡すProduction値である。
`PlannerWhatIfRequest.bounds` は引き続きcaller-requiredで、省略可能にしない。
Domain内部fallback、invalid boundsのrepair target、field-wise completionには使わない。
Worker adapter / Worker Client / wire schemaも暗黙に注入しない。B10 Application callerが
このdefaultを選んで渡す責務を持つ。

B8の `defaultPlannerOrchestrationBounds = 2 / 1 / 4` の流用ではない。
`ConstrainedEnumerationBounds` とも独立した決定であり、そのProduction default
40 / 30 / 100 / 500と9.2.4.10のWorker境界は変更しない。

`maxCandidateTrialsPerTarget` は次の組ごとに独立して数える。

```text
(conflict scenario, targetWeaponId)
```

```text
Target B  N trials
Target C  N trials
```

一方のTargetがtrial capへ到達しても、他方のTargetのtrialを禁止しない。

1 trialの定義は次とする。

```text
対象TargetのCandidateをfeasibility判定の対象として取り上げた時点で1消費する
```

```text
1消費する
  reusedExisting のCandidate
  preflightでrejectされたCandidate
  full Planner rerunでrejectされたCandidate
  found になったCandidate

消費しない
  別TargetのCandidate
  既にfoundを確定済みのTargetのCandidate
  enumeration bound到達やcancel等でfeasibility attemptへ到達しなかったCandidate
```

`reusedExisting` のCandidateも1消費する。重複するBuildListEntryは追加しないが、B9では
9.2.4.6のとおりpreflightとfull Planner rerunを実際に行うためである。B8の
`maxCandidateTrialsPerConflict` が `reusedExisting` をno-opとして1消費する扱いとは、
根拠が異なる点に注意する。

予期しないmaterialization error、prediction error、invariant violationは、trialの
rejectionへ変換しない。既存のerror経路へそのまま伝播させる。

`maxPlannerReruns` は、1つのwhat-if request全体で開始可能なfull Beam Searchの総数である。

```text
数える
  Candidate trialのfull Beam Search
  Production Plan生成内部のruntime unsupported retryで実際に開始するBeam Search

数えない
  preflight
  validation
  conflict context生成
  Candidate enumeration
  materialization
```

B9は「initial ordinary Planner run」を必須としない。B9の目的はPlan生成ではなく
feasibility comparisonである。この点でB8-C4aの `maxPlannerReruns` とは数える対象が
異なるため、名前が同じでも既定値を流用しない。

共有 `maxPlannerReruns` の消費順を確定するため、B9-B1bで次の実行順を固定した。

```text
Target処理順   createPlannerConflictWorks() の既存stable order
Target内順     compareConstrainedCandidates()
```

`works` のstable orderをそのまま使用し、B9独自のTarget sortを追加しない。
Target内のordering authorityは9.2.4.3のとおり
`compareConstrainedCandidates()` のままである。

#### 9.2.4.10 enumeration bounds

B9は `ConstrainedEnumerationBounds` の意味とProduction defaultを変更しない。

```text
defaultConstrainedEnumerationBounds = 40 / 30 / 100 / 500
```

- B9 Domain calculationは、9.2.4.5の `PlannerWhatIfCalculationOptions.enumerationBounds`
  としてenumeration boundsをcaller必須で受け取る。default substitution、fallback、
  clamp、field-wise completionを行わない
- `PlannerWhatIfRequest`、すなわちApplication / Worker requestへ
  `ConstrainedEnumerationBounds` を追加しない。requestが運ぶboundsは
  `PlannerWhatIfBounds` だけである
- Production Worker adapterが、B8-D1 / B8-E2bと同じく
  `defaultConstrainedEnumerationBounds` をWorker境界内でDomain calculationへ明示的に
  渡す
- B9-A2で新しいenumeration defaultを作らない
- B9 benchmarkは、まずこの既存のProduction enumeration extentで測定する
- B9に必要だからという理由だけでB8-B2のdefaultを再調整しない。実測で不足が判明した
  場合は別のdecisionとして扱う

#### 9.2.4.11 result / no-result契約

概念resultは次とする。名称はB9-B1で調整してよいが、意味を変更しない。

```ts
interface PlannerWhatIfComparison {
  conflictKey: string;
  fixedBuildListEntryId: BuildListEntryId;
  fixedTargetWeaponId: TargetWeaponId;
  alternatives: PlannerWhatIfTargetComparison[];
}

interface PlannerWhatIfTargetComparison {
  targetWeaponId: TargetWeaponId;
  practical: PlannerWhatIfOutcome;
  ideal: PlannerWhatIfOutcome;
}

interface PlannerWhatIfDistance {
  estimatedOperationCount: number;
  estimatedGogmaAdvance: number;
  estimatedSkillAdvance: number;
  estimatedNormalAdvance: number | null;
}
```

`PlannerWhatIfOutcome` は最低限次を区別するtyped unionとする。

```ts
type PlannerWhatIfOutcome =
  | { status: 'found'; distance: PlannerWhatIfDistance }
  | { status: 'not_found_within_search_extent' }
  | { status: 'stopped_by_enumeration_bound' }
  | { status: 'stopped_by_candidate_trial_bound' }
  | { status: 'stopped_by_planner_rerun_bound' }
```

意味。

```text
found
  bound内のCandidateについてPlanner feasibilityが証明された

not_found_within_search_extent
  enumerationが exhausted === true で終わり、
  そのTargetにfeasibleなCandidateが無かった

stopped_by_enumeration_bound
  Candidate未発見のまま、Search extent boundによって未確認が残った

stopped_by_candidate_trial_bound
  Candidateはまだ残り得るが、そのTargetのtrial予算を使い切った

stopped_by_planner_rerun_bound
  Candidate feasibilityを判定するBeam予算を使い切った
```

規則。

- 「見つからない」と「上限で未確認」を同じ `null` へ潰さない。9.2.16の
  「bound到達を無言でexhaustionとして扱わない」をB9でも維持する
- 既に `found` を確定したTargetは、その後enumeration boundへ達したことだけを理由に
  無効化しない
- `found` の判定authorityは9.2.4.7だけであり、message文字列をcontrol authorityにしない

scenario固定制約を安全に構築できない場合は、comparison全体をtyped failureとする。

```text
invalid_fixed_resolution
planner_input_not_ready
```

正確な型名はB9-B1で調整してよい。次を守る。

```text
message parsingをcontrol authorityにしない
recommendedBuildListEntryId等から代替のfixed Entryを選ばない
```

#### 9.2.4.12 warning / cancellation契約

B9は9.2.16のB8専用 `PlannerWarningKind` を生成しない。

```text
max_candidate_trials_per_conflict_reached
max_generated_build_list_entries_reached
max_planner_reruns_reached
constrained_enumeration_bound_reached
```

これらはB8 orchestrationのbound signalであり、数える対象と発生条件がB9とは異なる
(9.2.4.9)。B9の打ち切り理由は `PlannerWhatIfOutcome` などのB9専用typed statusで表す。
ordinary Planner内部のwarningをB9のbound signalへ読み替えない。

cancellationはWorker / Client requestのcancellationとして扱う。

- `cancelled` を `PlannerWhatIfOutcome` へ含めない
- cancelされたrequestのpartial comparison resultを、正常なresultとして返さない
- 既存のtask generation / stale response / cancel semantics(B8-D1)をB9-Cで再利用する

#### 9.2.4.13 B9とB10の責務分離

```text
B9
  Domain what-if calculation
  PlannerWhatIfBounds
  Worker protocol / routing
  Production Worker adapter
  PlannerWorkerClient API
  benchmarkとProduction default決定

B10
  Conflict選択UI
  what-if距離の表示
  比較カード
  選択不可表示と理由提示
  what-if requestの起動
```

[UI_FLOW.md](./UI_FLOW.md) 11章の「将来のwhat-if比較」はB10の表示責務であり、その距離を
計算するDomain / Worker / Application APIがB9である。

#### 9.2.4.14 B10 Application / UI mapping

B10-Aで、B9のwhat-if計算をProduction Plan画面へ接続するApplication / UI契約を確定した。
B9で確定したDomain what-if semantics、`create_what_if_comparison` request / result shape、
default責務は変更しない。B10-Bはparticipant / current Conflict availability取得のために、
B10専用のtyped Planner Worker request / Client APIを追加してよい。

##### Plan表示authorityとcurrent calculation authority

Conflict UIは `/plans/:planId` のProduction Plan画面に置く。表示対象はrouteの `planId` で
`ProductionPlanRepository.getProductionPlan(planId)` から取得した保存済み
`ProductionPlan` だけである。該当Planが無い場合、Active Plan、最新Plan、その他のPlanを
推測して代替表示しない。

表示と計算のauthorityを次のとおり分離する。

```text
表示中のConflict
  persisted ProductionPlan.conflicts

what-if / Planner再計算の入力
  操作開始時点のcurrent persisted stateからcreatePlannerInput()で新規構築したPlannerInput
```

`ProductionPlan.baseSnapshot` はcompatibility / audit authorityであり、current
`PlannerInput` そのものではない。`baseSnapshot` から入力を復元せず、古いPlanner Worker
inputまたは過去のCandidate Search requestをcache / 復元して再利用しない。

##### persisted explicit resolutionの復元

`createPlannerInput()` が返す `conflictResolutions: []` へ、表示中Planのうち
`selectedBuildListEntryId !== null` のConflictだけを次の形で設定する。

```ts
plan.conflicts
  .filter((conflict) => conflict.selectedBuildListEntryId !== null)
  .map((conflict) => ({
    conflictKey: conflict.id,
    selectedBuildListEntryId: conflict.selectedBuildListEntryId,
  }))
```

これは保存済みPlanに残るユーザー明示resolutionの復元である。
`recommendedBuildListEntryId`、Planner score、Beam bestState、Target priority、
`selectedBuildListEntryIds` からresolutionを生成しない。

##### participant表示とcurrent availability

`PlanConflict.buildListEntryIds` のparticipantは原則すべて表示する。current stateで利用不能な
participantも消さず、選択不可と理由を示す。`recommendedBuildListEntryId` は「Planner推奨」
等のbadge、`selectedBuildListEntryId` は「現在選択中」等の表示だけに使う。

選択可否は、操作時点に新規構築した `PlannerInput` と既存validation / staleness authorityから
導出する。新しいDomain validity ruleを作らない。最低限、次を区別して理由表示できること。

```text
BuildListEntryがcurrent persistenceに存在しない
BuildListEntryがcurrent stateに対してstale
対応Targetが存在しない
対応Targetが無効またはdisabled
CalculationContextが非互換
validatePlannerInput()がEntryをvalidBuildListEntriesから除外した
```

Targetの構造およびIdeal ⇒ Practical包含は既存の `validateTargetWeapon()` と
`validateTargetIdealImpliesPractical()`、Entryのcurrent stale理由は
`evaluateBuildListEntryStaleness()` をauthorityとする。Planner利用可否とcurrent Conflictは、
B10-BのWorker-side current interaction preparationで判定する。

fresh PlannerInputと既存explicit resolutionを準備した後、B10-BはPlanner Workerへ専用のtyped
preparation requestを送る。Worker内でProduction Planner dependenciesを使い、既存の
`preparePlannerInitialContext()` 相当の処理として最低限次を実行する。

```text
validatePlannerInput()
current initial Planner stateの準備
current initial Conflict detection
```

UI / main threadで `ProductionRngEngine` を新たに生成してvalidationしない。内部の
`PlannerInitialContext` 自体をwireへ漏らさず、structured-clone可能なB10用projectionだけを返す。
projectionは最低限、次をUIが判定できる形とする。正確な型名とrequest名はB10-BでRepositoryの
命名規則へ合わせてよい。

```text
ready / invalid
valid BuildListEntry IDs
excluded BuildListEntry: BuildListEntry ID + 表示用reason
current initial Conflict: conflict ID + participant BuildListEntry IDs
```

表示中ConflictをB10操作対象にできるのは、そのConflict IDがWorker projectionのcurrent initial
Conflictに存在し、対象Entry IDがそのcurrent Conflictのparticipantであり、かつcurrent
persistenceに存在してvalid BuildListEntry IDsに含まれる場合だけである。current initial Conflictに
同じIDが無い場合もpersisted Conflictは表示するが、「比較する」と「この候補を優先」をdisabledにし、
現在のPlanner入力では競合を再現できない旨を示して再計算を促す。
preparationが `invalid` の場合もすべてのConflict操作をfail closedでdisabledにし、typed resultに
基づく理由と再計算導線を表示する。

Capability、concrete prediction support、保護状態等による除外もWorker projectionへ反映する。
typed ready / invalid、ID集合、Conflict membershipをcontrol authorityとし、表示用reason文字列は
そのまま表示してよいが解析して分岐しない。B9の `create_what_if_comparison` requestへvalidation
fieldを追加せず、availability取得だけのためにwhat-if calculationを実行しない。

preparation requestを追加する場合も、既存Planner WorkerのrequestId / generation / stale response
rejectionまたはignore / dispose / cancelの考え方と整合させる。古いpreparation結果でcurrent
availabilityを上書きしない。

##### what-if preview requestとlifecycle

有効なparticipantの「比較する」で、選択したparticipantだけから次を構築する。

```ts
const scenarioResolution = {
  conflictKey: conflict.id,
  selectedBuildListEntryId: participantEntry.id,
}

const request = {
  plannerInput: freshPlannerInputWithExistingExplicitResolutions,
  scenarioResolution,
  bounds: defaultPlannerWhatIfBounds,
}
```

`scenarioResolution` が今回scenarioの唯一のfixed authorityである。Application callerが
`defaultPlannerWhatIfBounds = 2 / 8` を明示的に渡す。Worker / Clientのdefault injection、
省略、B8 defaultの流用、requestへのenumeration bounds追加を行わない。

what-ifは完全にtransientなpreviewである。起動時にも完了時にもBuildListEntry、
`PlannerConflictResolution`、ProductionPlan、comparison resultを保存しない。UIは最低限
`idle` / `loading` / `completed` / `failure` を区別する。別participantの比較、別Conflictへの
移動、page離脱、Planner再計算開始では不要なrequestを `cancelPlan(requestId)` でcancelする。
既存のrequestId / generation / stale response semanticsを使い、cancelをfailure表示にせず、
partial resultを表示せず、古いresultを別participantのcardへ適用しない。

`comparison.alternatives` はDomainのstable orderのまま表示し、Application / UIでTargetを
並べ替えない。各non-fixed Targetは排他的な `practical` / `ideal` の2枠を独立表示する。
`found` は `estimatedOperationCount` を主距離とし、残り3つのestimateは絶対Counterではなく
進行量として表示してよい。次のtyped statusを「候補なし」へまとめない。

```text
not_found_within_search_extent       探索範囲内に実行可能な候補なし
stopped_by_enumeration_bound         探索範囲上限のため未確認
stopped_by_candidate_trial_bound     候補試行上限のため未確認
stopped_by_planner_rerun_bound       Planner再計算上限のため未確認
```

comparison全体の `planner_input_not_ready` / `invalid_fixed_resolution` はtyped failureとして
扱う。後者は `reason` をcontrol authorityとし、detail / message parsingで分岐しない。
別participantまたは `recommendedBuildListEntryId` へfallbackせず、再選択または再計算を促す。

##### explicit choiceとB8再計算

「比較する」と「この候補を優先」は別操作とする。what-if成功を選択のgateにせず、what-ifを
行わず有効participantを選択できる。current availabilityが選択不可のparticipantは、what-ifの
成否にかかわらず選択できない。

「この候補を優先」でだけ今回の `PlannerConflictResolution` を作る。操作開始時点に再びcurrent
persisted stateからfresh `PlannerInput` を構築し、保存済みPlanから復元した他Conflictのexplicit
resolutionを保持したうえで、同一 `conflictKey` は今回選択で置換し、無ければ追加する。

Plan生成はwhat-if resultを採用せず、B8 Production constrained Plannerの
`createConstrainedPlan()` を新規実行する。Application callerが
`defaultPlannerOrchestrationBounds = 2 / 1 / 4` を明示的に渡す。what-if trial Entryまたは
comparison resultを保存・採用しない。

`createConstrainedPlan()` の返却warningsに
`warning.kind === 'invalid_conflict_resolution'` が1件でもある場合はfail closedとする。
`plan !== null` のordinary resultを含んでいても
`plannerResultPersistenceService.savePlannerOrchestrationResult()` を呼ばず、ProductionPlanも
generated BuildListEntryも保存せず、新Planへ遷移しない。表示中の旧Planを維持し、ユーザーへ
再選択または再計算を促す。typed `PlannerWarningKind` をcontrol authorityとし、warning.messageを
解析せず、Planner推奨または別participantへfallbackせず、invalid resolutionを無視したordinary
Planを保存しない。

上記warningが無い再計算結果の保存は既存
`plannerResultPersistenceService.savePlannerOrchestrationResult()` だけを使用し、generated
BuildListEntryとProductionPlanのatomic save契約を維持する。B10専用Persistence serviceを
追加しない。新しいPlanが保存された場合は `/plans/:newPlanId` へ遷移する。`plan === null` または
保存失敗時は表示中の旧Planを置換・削除しない。B10の判断だけで旧Planを自動削除しない。

Conflict選択とwhat-ifはPlan確定前の意思決定機能であり、編集対象は原則 `status === 'draft'`
とする。`stale` は比較・固定を続けず既存の明示再計算へ誘導し、`active` / `completed` /
`abandoned` はB10操作で書き換えない。既存Plan lifecycleと矛盾が見つかった場合は推測せず
設計レビューへ戻す。

### 9.2.5 初回Search pruningを永久除外にしないこと

初回Candidate Searchは、単体Targetの探索を高速・簡潔に保つために複数のpruningを
適用する。これらはすべて**初回Search用のpolicy**であり、Planner制約下で候補を
永久に無効化する**Domain dominanceではない**。

| 初回Searchで省略される理由 | 定義 |
| --- | --- |
| 同一結果の最小advance retention | [SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.5.2 / 5.5.3 |
| Practical dominance | 同 5.5.6 |
| Practical保持のhorizon (`estimatedOperationCount <= D`) | 同 5.5.6.0 |
| canonical Ideal到達による探索終了 | 同 5.6.2 / 5.6.3 |
| Cross-onlyの初回bounded policy | 同 5.5.4 |

契約。

```text
Planner-driven constrained re-searchでは、
初回Search用pruningによって省略されたCandidateを、
固定Candidateとの共存可能性に応じて再評価できなければならない。
```

例1。同一結果の後続Counter位置。

```text
Practical同一結果 earlier位置  -> 固定Candidateと競合し実行不能
Practical同一結果 later位置    -> 固定Candidateと共存可能
-> later solutionを次点として再評価・採用できる
```

例2。Practical dominanceで省略された候補。

```text
+2 攻撃III Practical
+4 攻撃II  Practical

初回Search : +2が+4を明確に上回るため+4を省略
Planner    : 固定Candidateとの競合で+2が実行不能、+4は実行可能
再検索     : +4を次点Practicalとして再評価・採用できる
```

規則。

- 使用不能なearlier same-result solutionが、実行可能なlater same-result solutionを
  恒久的に隠してはならない
- **初回SearchのPractical dominanceをそのまま再検索へ持ち込み、現在実行不能な
  dominant candidateが実行可能なdominated candidateを永久に隠してはならない**
- canonical Ideal到達による探索終了と5.5.6.0のhorizonは初回Searchの範囲であり、
  再検索の探索範囲を恒久的に制限しない
- Cross-onlyは初回boundedポリシーであり、再検索で軸外解の必要性が実際に生じた場合は
  そのTarget・その競合に限って評価できる
- あるCandidateが実行不能であることだけを理由に、その完成結果や、そこから
  派生し得る解の系列全体を除外しない

これはCartesian productの復活を意味しない。Bonus streamとSkill streamは
引き続き独立に解き、Cross-onlyの初回policyも維持する。追加で必要なのは、
省略されたCandidateを固定Candidateとの共存可能性に応じて再評価できることだけである。

本要件はB8 constrained enumerationの必須要件であり、9.2.9と
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7で具体化する。

### 9.2.6 B8 architecture

正式architectureは次とする。

```text
Candidate Search / constrained enumerator
  元のSearch / RNG起点からTarget単体のCandidateを順次提示
        ↓
Planner constrained-search orchestration
  明示的に固定したCandidateとの共存可能性をPlanner自身で評価
        ↓
必要なCandidateを一時BuildListEntryへmaterialize
        ↓
augmented PlannerInput
        ↓
元のRNG / Planner初期StateからBeam Searchを完全再実行
        ↓
最終ProductionPlan
        ↓
Application / Persistence
  generated BuildListEntries + ProductionPlanをatomic保存
```

責務分離は9.1および[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.0のままである。
constrained enumeratorはTarget単体のRNG近傍解を列挙するだけであり、共存可能性を
判定しない。共存可能性の最終authorityは、そのCandidateを含むaugmented PlannerInput
に対する既存Plannerの再実行である(9.2.11)。

### 9.2.7 固定Candidateのauthority

constrained re-searchで「固定する側」を決めるauthorityは次だけとする。

```text
PlannerConflictResolution.selectedBuildListEntryId
```

次を固定authorityとして使用してはならない。

```text
PlanConflict.recommendedBuildListEntryId
Planner bestStateで偶然選択されたparticipant
Target priorityからの自動決定
Candidate scoreだけによる自動決定
```

有効な明示 `PlannerConflictResolution` が無い競合については、B8 constrained
re-searchを自動実行せず、その競合を `PlanConflict` として返す。ユーザー選択を経て
`PlannerConflictResolution` が与えられた実行でだけ再検索を行う。

`recommendedBuildListEntryId` は従来どおりユーザー提示用の推奨であり、固定制約では
ない。削除済み・stale・Target無効・Capability不足・保護状態変更で実行不能な選択を
`invalid_conflict_resolution` として扱う既存規則も変更しない。

固定authorityはユーザーの選択そのもの、すなわちfixed BuildListEntry IDである。
`conflictKey` はその選択を局所競合へ結び付ける識別子にすぎない。generated Entryの
追加でPlanConflict IDが変わっても固定authorityは変わらない。したがってfull Beam
Searchの前に、9.2.3.1のinitial conflict preflightで現在の `PlanConflict.id` へ
対応付け直す。元の `conflictKey` をそのまま次の再実行へ渡してはならない。再対応付けが一意に成立しない場合は、
固定対象を推測せず、そのCandidate trialを採用しないか競合を返す。

### 9.2.8 Planner-generated BuildListEntry

BuildListEntryの生成主体を拡張する。

```text
1. ユーザーがCandidate Search結果から選択して追加する
2. Planner constrained re-searchがPlan生成に必要としてmaterializeする
```

規則。

- Planner-generated Entryも通常の `BuildListEntry` 形状をそのまま使う
- 新しい永続provenance fieldを追加しない
- `ProductionPlan` へembedded Candidate Snapshotを追加しない
- Candidate table等の新しい永続entityを追加しない
- constrained enumerationで発見した全Candidateを保存しない

Candidateはまずmaterializeしてから一時Entryとして生成し、Planner trialへ使う。

```text
ConstrainedCandidate yield        (Search Domainのtransient semantic result)
  ↓
deterministic materializer         (BuildCandidate形状へ変換。9.2.13)
  ↓
temporary BuildListEntry
  ↓
augmented PlannerInputでPlannerを完全再実行
```

enumeratorは `BuildCandidate` を直接yieldしない。`BuildCandidate` は `id` /
`searchRunId` / `createdAt` / `intermediateStateGroups` を必須とするが、
`ConstrainedSearchOrigin` は `searchRunId` と `settings` を持たないため、Search Domain
側では完成させられない([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。

trialで不採用だったCandidateは永続化しない。最終augmented PlannerInputへ正式採用した
generated Entryだけを `generatedBuildListEntries` として返す(9.2.14)。

ProductionPlanが生成されない場合、generated Entryを永続化しない。
Planがpartialでも `plan != null` であり、Plan snapshotがgenerated Entryを含む場合は、
そのEntryをPlanと同一transactionで保存する(9.2.15)。

### 9.2.9 constrained Candidate enumeration境界

constrained enumerationはSearch Domain側の責務であり、通常の `searchCandidates()`
とは別のAPI境界へ置く。enumerator側の契約本文は
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7に定義する。

Planner側の要件は次である。

- Search Domain APIへ9.2.3のConflict DTOを渡さない。Plannerが渡すのは
  `ConstrainedSearchOrigin`、対象TargetWeaponId、enumeration boundsだけである
- `origin` は過去のUI Candidate Search requestではない。Planner計算開始時の
  current validated Search / RNG snapshotから構成し、`rngState` / `normalCounters` /
  `ownedWeapons` / `targetWeapons` / `master` / `calculationContext` を保持する。
  `searchRunId` / `routeFilter` / `settings` を持たせない
- constrained re-searchは過去のUI一時filterを継承しない。route scopeは現時点で
  成立する全Search routeとし、UI一時filterや `CandidateSearchSettings` を
  適用しない。探索範囲の上限は
  `ConstrainedEnumerationBounds` だけをauthorityとする
- route policyが広がっても、TargetのIdealまたはPractical条件を満たすCandidateだけを
  yieldする契約は維持する
- enumeratorがyieldするのは `BuildCandidate` ではなく、Search Domainのtransientな
  semantic result `ConstrainedCandidate` である。`BuildCandidate.id` /
  `searchRunId` / `createdAt` / random ID / Clock / enumeration ordinalを
  enumerator resultへ混ぜない。`BuildCandidate` 形状への変換は9.2.13の
  deterministic materializerが行う
- `maxCandidateTrialsPerConflict` / `maxGeneratedBuildListEntries` /
  `maxPlannerReruns` はPlanner orchestration側のboundsであり、
  `ConstrainedCandidateSearchInput` へ含めない(9.2.16)
- Candidate Search側へ次のPlannerロジックを複製しない

```text
counter precondition
physical action identity
shareability
inventory conflict
source mutation / version
PlannerConflictResolution
```

- 実行不能と判定したCandidateについては、enumeratorへ次のCandidateを要求する
- Cross規則の軸外pair(`i > 0` かつ `j > 0`)は、必要になったTarget・その競合に限って
  評価を要求してよい。full Cartesianの事前生成は要求しない

### 9.2.10 Planner再実行

constrained CandidateをBeam Search途中のStateへinjectしてはならない。

```text
Candidate発見
  ↓
一時BuildListEntry
  ↓
augmented PlannerInput作成
  ↓
createInitialPlannerSearchState から初期Stateを再生成
  ↓
Beam Searchを最初から再実行
```

理由。途中Stateでは既に次が進行済みであり、後からEntryを追加しても、過去に共有した
物理操作を正しく復元できない。

```text
routeProgressByEntryId
current counters
transient route output
sourceMutationVersionByOwnedWeaponId
candidateReadySourceVersionByEntryId
routeSourceVersionByEntryId
inFlightExistingSourceByOwnedWeaponId
```

したがってEntry集合が変わるたびに初期Stateから完全再実行する。full Beam Searchの
実行回数は `maxPlannerReruns` で有限に抑える。9.2.3.1のinitial conflict preflightは
Beam Searchを走らせないため、この回数へ含めない(9.2.16)。

再実行入力の `conflictResolutions` は、前回入力のものをそのまま流用しない。
Entry集合が変わると同じ物理競合でも `PlanConflict.id` が変わり得るため、full Beam
Searchを走らせる**前**に9.2.3.1のinitial conflict preflightで再対応付けを行い、
現在の `PlanConflict.id` を `conflictKey` とする `PlannerConflictResolution` を
組み立ててから完全再実行する。再対応付けが一意に成立しないresolutionは入力へ含めず、
その競合を未解決として扱う。

```text
元のvalidated PlannerInputの全valid resolution
  -> resolutionごとのtransient fixed constraint
       (fixed Entry ID / Target ID / fingerprint / 競合資源identity)
  -> augmented PlannerInput作成
  -> initial conflict preflight
       validatePlannerInput
       validation.validBuildListEntries
       createInitialPlannerSearchState
       通常Plannerと同じinitial relevant-entry selection
       createPlannerRouteUnitPlans
       detectPlannerConflicts
  -> 全fixed constraintについて
       競合資源identity一致かつfixed Entryを含むConflictを探す
  -> 全て一意なら現在のPlanConflict.idでresolution配列を再構築
  -> 1つでも0件・複数件・fingerprint不一致・validation除外なら
       推測せず、trial不採用またはconflict返却
  -> 完全なresolution配列でBeam Searchを初期Stateから完全再実行
```

full Beam Searchの前にpreflightを置くため、resolution無しのBeam Searchを一度走らせて
から組み直す循環は発生しない。preflightはConflict検出専用であり、共存可能性の最終
authorityは完全再実行のBeam SearchとTrace Replayである(9.2.11)。

preflightは通常Beam Searchと同じ `validatePlannerInput()` /
`validation.validBuildListEntries` / initial relevant-entry selectionを使う。
B8だけがraw `BuildListEntry` から初期Stateを作ることを禁止し、この経路は
shared pure helperとして通常Plannerと共有する(9.2.3.1)。

### 9.2.11 共存可能性のauthority

Candidateが固定Candidateと共存できるかどうかの最終authorityは、既存Plannerの
再実行結果とする。次をそのまま再利用する。

```text
createPlannerRouteUnitPlans
counter precondition
physicalActionKey
arePlannerRouteUnitsShareable
inventory precondition
protected weapon判定
source mutation / version
PlannerConflictResolution
Beam Search
Trace Replay
```

B8専用の簡易競合ロジックを追加してはならない。次のような判定を書かない。

```ts
usedCounters.has(counter)
```

Counter位置の一致だけを理由とする除外は9.2.2で既に禁止している。

### 9.2.12 Candidate semantic identityとEntry再利用

Planner-generated Candidateのsemantic identityは、run ID / Candidate ID / timestampへ
依存してはならない。少なくとも次を含める。

```text
targetWeaponId
route (kind / sourceOwnedWeaponId / operations)
finalBonuses multiset
restoration bonus scope
seriesSkillId
groupSkillId
```

**重要。** 現行の `createBuildCandidateMeaningFingerprint()` はrestoration bonus scopeを
含まない。同一ラベル5枠のnormal scope結果とgogma scope結果を同一意味とみなすため、
B8 semantic identityとしてそのまま信用してはならない。B8実装時にscopeを含むauthorityへ
修正または統合する。

既存BuildListEntryの再利用判定は、semantic fingerprintだけでは不十分である。
次をすべて確認する。

```text
candidate semantic fingerprint
targetDefinitionHash
searchStateHash
referencedOwnedWeaponsHash
CalculationContext
現在のstaleness
```

同一semantic Candidateに対応する既存Entryが存在しても、Target定義、Search状態、
OwnedWeapon参照状態、CalculationContextのいずれかが現在値と異なる場合は再利用しない。

stale Entryを上書き更新してはならない。

```text
旧stale Entry   -> 履歴としてそのまま残す
現在のCandidate -> 新しいBuildListEntryを作成する
```

理由。過去のProductionPlanが旧BuildListEntry IDとSnapshotを参照しているためである。

同じgenerated IDまたは同じcurrent semantic Entryが既に存在する場合は、current semantic
contentがすべて一致するときだけ再利用する。ID一致だが内容が異なる場合はfail closedとし、
上書きせずerrorにする。これによりretry時のidempotencyを保証する。

### 9.2.13 決定的ID生成

通常Candidate SearchのID契約は変更しない。B6-F1で行ったのはCandidate出力順の
run非依存化であり、`BuildCandidate.id` の生成規則と `semanticHash` への
`searchRunId` 包含は現行のままである。

B8 constrained search専用境界では次を用いる。

```text
deterministic constrained search identity
deterministic Candidate ID factory
deterministic generated BuildListEntry ID
```

deterministic constrained search identityは名前だけでなく構成要素を固定する。
少なくとも次から安定生成する。

```text
TargetWeapon ID
Planner開始時のSearch / RNG semantic origin
  (ConstrainedSearchOrigin の semantic 正規化値。
   Base Seed / 該当Counter群 / 参照OwnedWeapon semantic / Target定義)
CalculationContext
ConstrainedEnumerationBounds
route policy
  (route scope、filter非適用、上限authorityを表す正規化値)
```

次を含めてはならない。

```text
random UUID
Clock
request UUID
enumeration ordinal
```

`searchRunId` に相当するrun識別子をこのidentityへ含めない。通常Candidate Searchの
`BuildCandidate.id` 生成規則は上記のとおり変更しないため、constrained search側の
Candidate ID factoryは通常Searchのものを流用せず、この identity を基点にする。

#### deterministic materializer

B8-B1のenumeratorはSearch Domainのtransientな `ConstrainedCandidate` をyieldする
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。通常の `BuildCandidate` 形状への変換は
B8-Cのdeterministic materializerが行う。

```text
BuildCandidate.searchRunId
  = deterministic constrained search identity

BuildCandidate.id
  = deterministic constrained search identity
    + Candidate semantic meaning (9.2.12)
    から安定生成

BuildCandidate.createdAt
  = PlannerClock

BuildCandidate.intermediateStateGroups
  = materializeしたCandidateのRouteへintermediate state抽出を適用した結果
    ([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.8)
```

`intermediateStateGroups` は作成リストの選択入力を支える表示・選択データであり、次には使用しない。

```text
Candidate yield可否
Candidate enumeration ordering
route scope
探索終了
探索範囲
off-axis評価
Planner coexistence
```

`CandidateSearchSettings` はconstrained enumerationのfilter authorityでも
extent authorityでもない(9.2.9)。

`createdAt` は `PlannerClock` 由来のためrun間で変わる。これは15.9.1で一致を要求しない
値であり、`BuildCandidate.id` と `searchRunId` はrun間で一致する。generated
BuildListEntry IDは `createdAt` を含めずsemantic contentから生成する(前掲)。

generated BuildListEntry IDは、少なくとも次から安定生成する。

```text
Candidate semantic meaning (9.2.12)
targetDefinitionHash
searchStateHash
referencedOwnedWeaponsHash
CalculationContext
```

次をEntry IDまたはsemantic tie-breakへ使用してはならない。

```text
random UUID
Clock
enumeration ordinal
request UUID
```

`createdAt` は永続表示用として `PlannerClock` から生成してよいが、ID、semantic
ordering、Planning input hashの意味へ使わない。`createdAt` をID生成へ含める既存の
`createBuildListEntry()` 既定経路をそのまま流用しない。

### 9.2.14 Orchestration結果

Core `PlannerResult` の意味を変更せず、外側のorchestration resultを追加する。

```ts
interface PlannerOrchestrationResult extends PlannerResult {
  generatedBuildListEntries: BuildListEntry[];
}
```

具体的な名称はB8-Cで決定してよいが、意味を変更しない。

- `generatedBuildListEntries` には、最終augmented PlannerInputへ正式採用したEntryだけを含む
- trial中に生成して不採用となったEntryを含めない
- `plan === null` の場合は空配列とする
- 既存の `plan` / `conflicts` / `warnings` の意味を変更しない
- `PlannerOrchestrationResult` は非永続であり、`ProductionPlan` へ埋め込まない

#### B8-C4b実装名

B8-C4bで確定した実装上の名称は次である。意味は上記から変更していない。

```ts
createProductionPlanWithConstrainedSearch(
  input: PlannerInput,
  dependencies: PlannerDependencies,
  options: PlannerConstrainedOrchestrationOptions,
): Promise<PlannerOrchestrationResult>

interface PlannerConstrainedOrchestrationOptions {
  enumerationBounds: ConstrainedEnumerationBounds
  orchestrationBounds: PlannerOrchestrationBounds
  executionOptions?: PlannerExecutionOptions
}
```

両boundsともcaller必須である。orchestration側のProduction defaultはB8-Eで決める。

#### conflict work

再検索対象は `(fixed constraint, 非固定participant Target)` の組とする。

```text
work対象にする    : participant.buildListEntryId != fixedBuildListEntryId
work対象にしない  : participant.targetWeaponId === fixedTargetWeaponId
```

同一Targetが複数RouteUnit / Entryで参加してもTarget単位に1件へdedupeする。
work順は競合資源identity / fixed BuildListEntry ID / TargetWeapon ID /
元の `PlanConflict.id` から作るstable keyの昇順とし、context配列順・participant配列順・
Map挿入順へ依存しない。

1件adoptするたびに残りworkを再評価する。current `ProductionPlan.selectedBuildListEntryIds`
が、そのworkのfixed EntryとそのTargetのEntryを両方含む場合、そのworkは充足済みとして
enumerationしない。Candidate score・`recommendedBuildListEntryId` は判定に
使わない。

#### monotonic adoption

trial採否の最終authorityは、preflightを通したaugmented inputに対する完全再実行
(`createProductionPlanWithObserver()` = full Beam Search + Trace Replay +
ProductionPlan組み立て)である。採用条件は次をすべて満たすことである。

```text
plan !== null
plan.selectedBuildListEntryIds が trial generated Entry ID を含む
plan.selectedBuildListEntryIds が 全fixed Entry ID を含む
plan.selectedBuildListEntryIds が 以前adopt済みの全generated Entry ID を含む
```

したがってadoptionはmonotonicである。新Candidateの採用によって、固定Entryまたは
以前adoptしたgenerated EntryがPlanから落ちる場合は不採用とする。`completed === true`
は要求しないため、bound到達によるpartial Planでも上記を満たせば採用してよい。

`reusedExisting: true` のmaterialize結果はcurrent inputに既に存在するため、
Entryを重複追加せず、full Planner再実行も行わず、`generatedBuildListEntries` へも
含めない。Candidate trialは1消費済みとして次Candidateへ進む。

### 9.2.15 Persistence契約

Planner Domain / WorkerはIndexedDBへ直接アクセスしない。保存はB8-DのApplication /
Persistence serviceが行う。

保存単位は次を1つのDexie read-write transactionとする。

```text
generated BuildListEntries + ProductionPlan
```

- Planだけ、またはEntryだけが残るpartial saveを禁止する
- 保存直前にcurrent stateを再読込・再validationする
- validationに失敗した場合は何も書き込まず、retry可能なerrorとして返す

保存直前に最低限確認する項目。

```text
CalculationContext
RngState
Normal Counters
OwnedWeapons
TargetWeapons
BuildListEntry set
generated Entryのstaleness
PlanningInputSnapshot.initialExecutionState
PlanningInputSnapshot.targetWeaponsHash
PlanningInputSnapshot.buildListEntriesHash
Planが参照するBuildListEntry IDs
PlanStepのcandidateIdとEntry Snapshot
```

`PlanningInputSnapshot.buildListEntriesHash` は最終augmented PlannerInput全体を表す。
したがって最終inputへ含めたgenerated Entryは、例外なく同一transaction内で保存する。

Active Plan単一制約、置換、破棄、再計算は従来どおりApplication / Persistence層の
責務であり、B8で変更しない。

### 9.2.16 bounds

B8 constrained re-searchは必ずfiniteであること。boundsは責務ごとに2つへ分離する。
片方をもう片方の境界へ渡してはならない。

#### Search enumeration bounds

constrained enumeratorが消費する上限である。契約本文は
[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7にある。

```ts
interface ConstrainedEnumerationBounds {
  maxNormalForgeCount: number;
  maxGogmaAdvance: number;
  maxSkillResetCount: number;
  maxOffAxisPairEvaluations: number;
}
```

前3つは既存Candidate Search設定と同じ意味([SEARCH_SPEC.md](./SEARCH_SPEC.md) 3.1)であり、
B5の実Browser Worker実測位置をB8-B2 benchmarkの基準値として使用してよい。

```text
Normal 1000
Gogma   200
Skill  1000
```

`maxOffAxisPairEvaluations` はB8で新設する上限である。

#### Planner orchestration bounds

Planner orchestrationが消費する上限である。Search Domainへ渡さない。

```ts
interface PlannerOrchestrationBounds {
  maxCandidateTrialsPerConflict: number;
  maxGeneratedBuildListEntries: number;
  maxPlannerReruns: number;
}
```

`maxPlannerReruns` はfull Beam Searchの実行回数を数える。9.2.3.1のinitial conflict
preflight(`createInitialPlannerSearchState` / `createPlannerRouteUnitPlans` /
`detectPlannerConflicts`)はBeam Searchを走らせないため、この回数へ含めない。

B8-C4aで、数える対象を次のとおり明確化する。

`maxPlannerReruns` はB8 orchestrationから開始される `runPlannerBeamSearch()` の
全実行開始を数える。

```text
数える
  最初のordinary Planner full Beam Search
  Candidate trialのfull Beam Search
  Trace Replayでruntime unsupportedが判明したとき
  Production Plan生成内部で行うBeam再実行

数えない
  preparePlannerInitialContext()
  9.2.3.1 initial conflict preflight
  Conflict context生成
  Candidate materialization
  Candidate enumeration
```

したがってProduction Plan生成関数の呼出し回数と `maxPlannerReruns` の消費回数は
一致しない場合がある。1回のProduction Plan生成が、runtime unsupported retryにより
複数回のfull Beam Searchを開始し得るためである。

開始しなかったBeam Searchは消費へ数えない。boundへ到達した場合は打ち切りを
typed signalとして報告し、無言でexhaustionとして扱わない。

`ConstrainedCandidateSearchInput` へこの3つを含めてはならない
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.6.7)。enumerationの探索量に影響せず、
Search DomainがPlanner側の試行回数を知る必要もないためである。

#### Production defaultの決定時期

**B8-AではどちらのProduction defaultも確定しない。** 根拠のない
`10000` / `32` / `16` / `64` などをProduction仕様として採用しない。

```text
B8-B1 : enumeration boundsをcaller必須指定とする。Production defaultを定義しない
B8-B2 : B8-B1実装後にenumerator側の実Browser Worker benchmarkを実施し、
        enumeration boundsのProduction defaultを決定する
B8-C  : orchestration boundsをcaller必須指定のまま実装する。
        orchestration実装前には実測できないため、ここでdefaultを決めない
B8-E  : B8-C / B8-D実装後にorchestration側のBrowser / Planner benchmarkを実施し、
        orchestration boundsのProduction defaultを決定する
```

`maxCandidateTrialsPerConflict` / `maxGeneratedBuildListEntries` /
`maxPlannerReruns` はPlanner再実行1回のコストと再実行回数に依存する。そのコストは
B8-C / B8-Dのorchestration実装が存在しなければ測定できない。したがってB8-B2の
enumerator benchmarkでこれらのdefaultを決めない。

implementation mapping（normativeなbounds semanticsではない）。

```text
Production default selected by B8-E2 Browser benchmark:
2 / 1 / 4
  maxCandidateTrialsPerConflict = 2
  maxGeneratedBuildListEntries  = 1
  maxPlannerReruns              = 4
実装: defaultPlannerOrchestrationBounds
      src/domain/planner/constrained/plannerOrchestrationBounds.ts
記録: docs/B8_PLANNER_ORCHESTRATION_BROWSER_WORKER_BENCHMARK.md 10-11章
```

この3値は**Domain validity ruleではない**。validityの契約は本節と実装の
`validatePlannerOrchestrationBounds()` が定めるとおり「finite integer かつ `>= 1`」の
ままであり、defaultはその範囲内でcallerが選べる1点にすぎない。boundsは引き続き
caller-supplied typeであり、invalid値をdefaultへrepair・clamp・field-wise completion
してはならない。`maxGeneratedBuildListEntries = 1` はDomain上の最大generated Entry数を
意味しない。

どちらのboundsも、到達した場合は打ち切りをenumeration summaryまたはwarningとして
明示する。bound到達を無言でexhaustionとして扱わない。

#### B8-C4b bound semantics

`maxCandidateTrialsPerConflict` は、1つの元Conflictに対してorchestrationが実際に
処理した `ConstrainedCandidate` 数を数える。同一Conflictに複数の非固定Targetがある
場合も同じbudgetを共有し、Targetごとにresetしない。preflight却下・Planner却下・
`reusedExisting` によるno-opも1消費とする。

```text
used < limit   -> used += 1、そのCandidateを処理
used >= limit  -> そのCandidateを処理せずconsumer stop、打ち切りとして報告
```

`limit` 件目を処理した直後に無条件で打ち切りとしてはならない。ちょうど `limit` 件で
enumerationが尽きた場合はtruncateされていないため、`limit + 1` 件目が実際に
deliveryされた時点で初めてtrial boundによる打ち切りとする。

`maxGeneratedBuildListEntries` は最終augmented PlannerInputへadoptした新規generated
Entry数だけを数える。materializeしただけの不採用trial、`reusedExisting` のEntry、
元のBuildListEntryは数えない。limit到達そのものではwarningを出さず、未充足workが
残っていて新規Entryをこれ以上adoptできないと判明した時点でwarningを出しglobal stopと
する。既にcapが満杯であると分かった新規Entryについては、無駄なfull Planner再実行を
行わない。

`PlannerOrchestrationLimitCode` はtyped値であり、message文字列を制御authorityに
しない。

```ts
type PlannerOrchestrationLimitCode =
  | 'max_candidate_trials_per_conflict'
  | 'max_generated_build_list_entries'
  | 'max_planner_reruns'
```

Search enumeration boundは `ConstrainedEnumerationSummary.stoppedByBound` がauthority
であり、このunionへ含めない。

#### B8 orchestration warning kind

B8 orchestrationだけが生成するPlannerWarningKindを追加する。通常の
`createProductionPlan()` 経路はこれらを生成しない。

```text
max_candidate_trials_per_conflict_reached
max_generated_build_list_entries_reached
max_planner_reruns_reached
constrained_enumeration_bound_reached
```

既存の `max_steps_reached` / `max_expanded_states_reached` は1回のBeam Searchの
`PlannerOptions` boundを表すものであり、意味が異なるため流用しない。

`constrained_enumeration_bound_reached` は、consumer stopではなく
`summary.stoppedByBound === true` でenumerationが終わり、かつそのworkでCandidateを
adoptできなかった場合だけ出す。対象workは終了するが、他Conflictのworkは継続する。

`max_planner_reruns_reached` に到達した場合、新しいCandidate trialを開始しない。
到達の検出を次の `beforeBeamSearch()` のthrowまで遅らせてはならない。full Beam Search
の実行可能回数を使い切っており、かつ未解決workが実際に残っている時点で、新しい
enumeration / materialization / preflightを一切開始せずwarningを出しglobal stopとする。

```text
work開始前   : 充足判定 -> 未解決かつbudget使い切り -> warning / global stop
trial却下後  : そのtrialで最後のBeamを消費 -> 次Candidateを要求せずwarning / global stop
trial採用後  : 即warningとしない。残りworkをcurrent Planで再評価し、
               未解決workが残る場合だけ次work開始前にwarning / global stop
```

最初のordinary Production Plan生成の内部でruntime unsupported retryが拒否された場合は、
Replay未成功のBeamからProductionPlanを組み立てず、最後に完了したBeam Searchの
conflicts / warningsと `plan: null` を返す。この観測のために
`ProductionPlanGenerationObserver` へsemantics-neutralな
`afterBeamSearch?(result)` を追加した。`beforeBeamSearch()` と同様に観測専用であり、
通常のProduction Plan生成semanticsを変更しない。

#### cancellation

通常PlannerはBeam cancellationを `beamResult.cancelled = true` から
`plan: null` の正常 `PlannerResult` として返す。orchestrationはこれをtypedな
run outcomeとして扱い、その後Search Domainへ進めてはならない。同じ `shouldCancel`
がconstrained enumeratorのcheckpointで
`CandidateSearchError('cancelled')` を送出し、処理済みのcancellationを
rejected Promiseへ変えてしまうためである。

```text
initial ordinary runがcancelled
  -> constrained enumerationを開始しない
  -> generatedBuildListEntries = []
  -> initial ordinary safe PlannerResultを返す

Candidate trialがcancelled
  -> 通常のreject扱いにして探索継続しない
  -> orchestration全体を終了し、最後にaccepted済みのcurrent PlannerResultを返す
```

cancellation専用のwarning kindは追加しない。`afterBeamSearch` の観測状態は
Production Plan生成1回ごとにresetし、過去runのBeam結果を誤参照しない。
`visitConstrainedCandidates()` 自身が検出したSearch cancellationのsemanticsは
変更しない。

### 9.2.17 B8のtask分割とCompatibility

```text
B8-A   Spec / DTO / API / persistence contract           (本節)
B8-B1  Search-domain constrained candidate enumerator          実装済み
       enumeration boundsはcaller必須指定
B8-B2  enumerator側の実Browser Worker benchmark                実装済み
       enumeration boundsのProduction default決定
B8-C   Planner conflict orchestration / deterministic materializer /
       augmented-input full rerun / Conflict Resolution再対応付け  実装済み
       orchestration boundsはcaller必須指定のまま
       C1 initial context / C2 materializer / C3 preflight /
       C4a rerun budget / C4b candidate trial / adoption orchestration
B8-D   Worker / Application / Persistence / atomic save /
       既存UIへの最小配線
       D1 Worker protocol / routing / Production adapter /
          Worker Client                                        実装済み
       D2a save-time再validation / atomic save                 実装済み
       D2b BuildListPageのconstrained経路配線                  実装済み
B8-E   orchestration側のBrowser / Planner benchmark            実装済み
       orchestration boundsのProduction default決定
       (defaultPlannerOrchestrationBounds = 2 / 1 / 4)
```

boundsのProduction defaultはB8-B2とB8-Eの2回に分けて決定する。orchestration
boundsはPlanner再実行の実コストに依存し、B8-C / B8-D実装前には測定できないためである。

B9 what-if、B10 Conflict UIは別Phaseとする。B11として予定していたnormal-scope Keepはnormal-scope Keep仕様訂正で実装済みである([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.9)。

B8 architecture自体は当時の次の値を変更しなかった。

```text
CURRENT_CALCULATION_APP_SCHEMA_VERSION = 2
DATABASE_SCHEMA_VERSION = 1
AppSettings.schemaVersion = 1
PRODUCTION_RNG_ENGINE_VERSION = production-rng:c5-e2
supportsSeedSearch = false
```

これはB8実装時の歴史的記録である。その後のphysical action sharing修正で3へ、共有Counter
prefixのsilent fast-forward修正で4へ更新されており、7.0.1のPlan失効 / Build artifact
互換契約が適用される。

理由。

- Production RNG semanticsを変更しない
- RouteOperationの意味を変更しない
- ProductionPlanの永続shapeを変更しない
- PlanStepの意味を変更しない
- 既存BuildListEntryのshapeを変更しない
- 既存Plan実行の意味を変更しない

実装時にこれらの前提を破る必要が判明した場合、勝手にversionを変更せず設計チャットへ戻す。

---

## 10. Plan生成手順

推奨アルゴリズム。

1. 入力validation
2. PlanningInputSnapshot作成
3. TargetSatisfaction作成
4. staleでないBuildListEntryをTargetごとに分類
5. 初期PlannerSearchStateを作成
6. BuildRoute.operationsを使ってBeam Searchを実行
7. 各展開で共有RNG時系列と在庫をシミュレート
8. 競合を検出し、実行不能な展開を除外
9. 最良Stateから採用BuildListEntryとRejectedBuildListEntryを決定
10. CandidateのBuildRoute.operationsを変更せずRouteOperation列からPlanStep列を生成し、Planner-only Stepを別に挿入する
11. 各PlanStepの期待状態Before / Afterを計算
12. requiredMaterials（アイテム素材）を集計
13. ProductionPlanを返す

制約。

- PlanStepの `order` は1始まりの連番
- PlanStepは実行ナビで1つずつ確認できる粒度にする
- 高速モード用のまとめStepは作らない
- Plan生成時点では実際のDBを更新しない。保存は呼び出し側Repositoryが行う
- Beam Searchの打切り時は到達した上限に応じて `max_steps_reached` / `max_expanded_states_reached` を返す
- 併せて `PlannerResult.termination` にtypedな終了状態を返す（7.2.1）
- `ProductionPlan.calculationContext` はPlannerInputと一致させる
- 同じPlannerInput、RngEngine fixture、ID Factory、Clock、Planner constantsから、採用Entry、操作列、PlanStep、score、warning、予約IDが同一になる

---

## 11. PlanStep生成

### 11.0 第9C-A: Search Trace Replay Draft

第9C-AではProductionPlanや永続PlanStepを生成しない。Beam Searchで確定した
`PlannerSearchState.trace` を、開始 `PlannerInput` から順にpureにReplayし、将来の
PlanStep変換用 `PlannerPlanStepDraft` を生成する。

- `PlannerMasterSubset` はSearchのRNG Predictionと同じ `weaponBonusDefinitions`、
  `bonusRanks`、`artianBonusTypeMappings` を保持する。PredictionはRngEngineのみから取得し、Lottery、
  Bonus Rank、Keep、Counter Gateを推測しない。
- `ExpectedPlanState` はProduction semantic RNG KnownValueのvalue/isConfirmed、stable sorted Normal Counter、
  OwnedWeaponのsemantic fields（kindを含む）をstable hash化する。名前、memo、日時、
  RNG source/notes、観測表示項目、legacy `counterGate` は除く。OwnedWeaponはTargetWeaponを
  参照しないため、Target関連情報も含めない。
- `ExpectedPlanState.ownedWeaponsHash` とBuild Listの`referencedOwnedWeaponsHash`は別契約である。
  前者はNormal rarityを含むが、後者は既存Search契約どおり含めない。両者ともname、memo、
  timestampsを含めない。
- 1 Search Actionは、共有されるEntry数にかかわらず1 physical operation、1 Draftである。
  Draftはprimary Entryと全progressed Entryを別々に保持する。
- silent fast-forwardしたRoute unitはtraceに存在しないため、Replayは再生成しない。
  Beam SearchのtraceだけでReplay stateが一意に決まる既存設計を維持し、Replay側で
  route progressを別途正規化しない。Beam SearchとReplayのsemantic差異を作らない。
- Replay RuntimeはRngState、Normal Counter、persistent OwnedWeapon Inventoryと、未登録の
  Normal/Gogma出力を保持する。Normal出力はEntryごとに分離し、複数作成後のconvertは
  そのEntryの最後に作成したNormalだけを使用して全Normal transientを破棄する。未登録出力へ
  永続OwnedWeapon IDを割り当てない。
- CreateNormalArtianOperationのpredicted variantは `count = forgeCount` をReplayし、`normalCounterAfter = normalCounterBefore + forgeCount` を検証する。convert対象は最後の結果であり、その位置は `candidateCounter = normalCounterBefore + forgeCount - 1` である
- blind variant([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)ではNormal Predictionを呼ばず、NormalArtianCounterをRoute preconditionとして読まない。物理的な通常アーティア1本は実在するため、Replay Runtimeは「5枠がunknownな作成結果」を保持する。unknownはruntime専用の明示的variantであり、架空の `RestorationBonusSet` を代入しない
- blind variantのReplayも7.0.3と同じauthorityでNormal Counterを更新する。runtimeに `isConfirmed === true && counter !== null` のNormalArtianCounterが存在する場合は `advanceNormalCounter()` で進め、存在しない場合は変更しない。`RngAdvance.normalCounterDelta` は前者で `1`、後者で `null` になる。Planner applyだけを直してReplayを直さない実装は禁止する
- unknown 5枠のtransientはconversionでそのまま継承され、`ExpectedResult.restorationBonuses` と `restorationBonusScope` は `null` になる。`null` は「予測しない」であり「ボーナスが存在しない」ではない
- 各Actionの`rngBefore`一致を検証し、`rngAfter`との差分からRngAdvanceを作る。複数Normal
  Counterの変化やunknown→knownの差分は現行RngAdvanceで表せないためReplay failureとする。
- create/reset/keep/reset-skillsは現在のRngEngine predictionを再実行する。KeepはReplay時点のtransientまたは起点武器の現在5slotをslot順のまま入力し、selection branchを持たない。
- Replayは各Predictionの直前にも同じsemantic inputで `getPredictionSupport()` を確認する。
  既知unsupportedがpreflight後の実stateで判明した場合は該当BuildListEntryだけを除外して
  Beam Searchを再実行する。support query例外とsupport=true後のPrediction例外は
  `prediction_failed` 等へ変換せず呼出元へ伝播する。
- convertはGogma Predictionを呼ばない。変換元Normalの `normal_artian` scope 5-slot bonusesをslot順のままtransient Gogmaへ継承し、現在Skill位置で `predictSkills` を実行して初回Series / Groupを設定する。
- convertのRNG遷移はSkill Counter `+1`、Normal / Gogma Counter `+0` とする。変換時のSkill結果を無視するRouteでも、実ゲームでconversionする限り同じSkill位置を消費する。
- Reset / Keepはtransient Gogmaのscopeとslot順を追跡する。5枠が既知ならnormal scopeでも最初のBonus amendmentとしてReset / Keepの両方を実行でき、Keep familyは各slotの `bonusTypeId`（通常側はArtianBonusTypeMappingで巨戟側へ正規化）から解決する。Reset / Keepのどちらの結果もgogma scopeへ置き換える([SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.9参照)。
- unknown 5枠に対してはReset Bonusesだけが実行可能である。Resetは置き換える5枠を読まないため、unknownからknownな `gogma_artian` scope 5枠へ遷移できる唯一の操作である。Reset Skillsは5枠を読まずSeries / Group Skillだけを書き換えるため、unknownをunknownのまま通過させる
- unknown 5枠を読む操作はReplay issue code `unknown_restoration_bonuses` でfail closedする。対象はKeep Bonusesの入力と、reserve時のCandidate Snapshot照合である。架空の5枠を合成してReplayを継続しない
- reserve前にEntry固有transient Gogmaのbonuses、Series Skill、Group SkillがCandidate Snapshotと
  完全一致することを検証する。不一致またはtransient不足はReplay failureであり、Candidate Snapshotで
  transientを上書きしてはならない。成功したEntryのtransientだけを破棄する。
- Predictionはvalueだけでなく、そのOperationが実際に依存するconfirmed入力を要求する。conversionとReset SkillsはBase Seed / Skill Counter、Reset / KeepはBase Seed / Gogma Counter、forgeはBase Seed / 対象Normal Counterを要求する。persisted exact GateはどのProduction Replay operationでも要求せず、Production forward runtimeと同じoperation別active representativeを使用する。Routeが使わないstreamの未確定値をReplay failureにしない。
- 探索上のpersistent simulated inventoryでは、reset/keep/reset-skillsによる更新をreserveまで行わない。
  所持Normalはconvertで削除し、new/owned-Normal reserveは予約済みIDのGogmaを追加、existing Gogma
  reserveは同一IDを更新する。これは探索内部表現であり、ProductionPlanのexecution projection
  （作成Stepでの登録、同一ID更新、完成effect）は16.3に従ってReplay結果から作る。
- Replay完了時はRNG、Normal Counter、persistent simulated inventoryがbest Search Stateと一致しなければ
  Draftを返さない。confirm_result、ProductionPlan、ID/Clock生成は第9C-Aの対象外である。


### 11.0-B 第9C-B: ProductionPlan組み立て

`createProductionPlan(input, dependencies, options)` はBeam Searchと9C-A Replayを再実装せず、
次の順でDraft ProductionPlanを組み立てる。

1. `runPlannerBeamSearch` を実行する。
2. `bestState` がnullならPlanを作らず、Beam Searchのconflicts / warningsをそのまま返す。
3. `bestState.trace` が空なら（初期状態ですべての有効TargetがIdealを満たす場合を含む）空Planを作らず `plan = null` とする。
4. `replayPlannerSearchTrace(input, bestState, dependencies.rngEngine)` を実行する。Replay failureはwarningへ変換せず、issue code / message / actionIndexを含むPlanner内部エラーとして失敗させる。
5. Replayが成功したDraftを順序を変えずにPlanStepへ変換する。物理操作Draftは1対1でPlanStepになる。
   探索内部の `reserve_weapon` DraftはPlanStepにせず、そのEntryの最後の物理StepのDraftへ
   target completion effectとして統合する（16.3）。操作0 Candidateの完成は
   `confirm_owned_ideal` Stepにする。
6. PlanningInputSnapshot、採用/不採用Entry、アイテム素材表示、ProductionPlanを作る。

Replay後、ProductionPlan IDを1回生成し、その後Draft順にPlanStep IDを1回ずつ生成する。
Searchで確定したreserve用OwnedWeapon IDはDraftの値をそのまま使用し、再生成しない。
execution projectionでは、新規Normal Routeの作成対象Normalを登録するIDとしてこの予約IDを使い、
作成Stepから完成Stepまで同じIDを維持する（16.3）。Clockは
Replay成功後に1回だけ呼び、その同じ値を`baseSnapshot.createdAt`、`plan.createdAt`、
`plan.updatedAt`へ設定する。PlannerはPlanを`status = "draft"`で返し、active化や保存は
Application / Persistence層の責務である。

#### PlanningInputSnapshot

`initialExecutionState` は既存の`createExpectedPlanState()`で、Plannerの入力状態とPlan依存Target
（16.5）から生成する。Plan依存Targetはexecution projection後に確定するため、snapshotはprojectionの後で作る。
独自Hashを再実装しない。

`targetWeaponsHash` はPlanner入力全体の監査用hashであり、`createTargetDefinitionHash()` の単純再利用
ではないplanning-input用の独立契約である（16.11のTarget field責務表）。`PlannerInput.targetWeapons` の
全TargetをTarget IDの辞書順に並べ、各Targetを次の構造へ正規化してstable hash化する。

```ts
interface PlanningInputTargetNormalized {
  id: TargetWeaponId;
  definitionHash: string;                      // createTargetDefinitionHash(target)
  priority: number;
  isEnabled: boolean;
  preferredOwnedWeaponId: OwnedWeaponId | null;
  lifecycleStatus: TargetWeaponLifecycleStatus;
}
```

`definitionHash` は性能定義だけを表し、`preferredOwnedWeaponId` を含まない。planning inputとしての
`priority` / `isEnabled` / `preferredOwnedWeaponId` / `lifecycleStatus` は `definitionHash` の外側の
fieldとして明示的に含める。`name`、`memo`、`completedAt`、`completedByProductionPlanId`、timestampsは
含めない。Plannerはこの構造以外のTarget fieldをhashへ加えない。

`buildListEntriesHash` はEntry IDの辞書順で、実行意味を持つCandidate Snapshot、
`targetDefinitionHash`、`searchStateHash`、`referencedOwnedWeaponsHash`、
`calculationContext`をstable hash化する。Candidate ID、searchRunId、Candidate createdAt、
idealDifference、similarity表示値、BuildListEntryの`candidateId`、`isStale`、`staleReasons`、
`createdAt`は含めない。finalBonusesはbonus type/rankのmultiset、requiredMaterialsは重複を保った
  materialId/quantity順で正規化し、finalBonusScopeを含め、RouteOperationの実行順は変えない。いずれのsortにもlocale依存比較を
使わない。

#### DraftからPlanStepへの変換

1 Draftは共有されたEntry数に関係なく1 physical operation、1 PlanStepである。
`PlanStep.buildListEntryId` は`draft.primaryBuildListEntryId`だけを保存し、
`progressedBuildListEntryIds`の数だけ複製しない。Candidate IDその他のoperation、expected result、
expected state、inventory change、RngAdvance、debugはReplay Draftからstructured cloneする。
PredictionやCandidate Snapshotからの中間結果再構成は行わない。

`PlanStep.progressedTargetWeaponIds` は、1回の物理Stepが複数TargetのRouteを同時に進めた事実を
persisted ProductionPlanから判定するためのobservational metadataである。新規生成する全PlanStepへ
必ず設定し、`draft.progressedBuildListEntryIds` を唯一の権威として
`PlannerInput.buildListEntries` からTargetWeapon IDへ変換する。重複Targetは除去し、順序は
locale非依存のstable string比較で決定的にする。`progressedBuildListEntryIds` に対応する
BuildListEntryが見つからない場合は黙って除外せず、Plan生成の不整合として
`PlannerPlanGenerationError` で失敗させる。

このfieldは `targetWeaponId` / `buildListEntryId` を置き換えず、両者のprimary presentation /
primary Entry権威も意味も変えない。`targetWeaponId` が必ず含まれるという契約は追加せず、Route進行を
伴わないStepは空配列でよい。fieldはoptionalであり、`undefined` はこのfield導入前に保存された
legacy Planだけを意味する。読み取り時に `[step.targetWeaponId]` などで補完してはならない。実際には
他Targetも共有していた可能性があり誤情報になる。

`progressedTargetWeaponIds` はPlanner semantics、Search semantics、RNG semantics、PlanStep identity、
`CalculationContext` semanticsのいずれも変更せず、schema / version bumpも伴わない。

StepはReplay時系列のままorder 1から連番にし、初期状態を未完了とする。最初の
`expectedStateBefore`はbase snapshotのinitialExecutionStateと一致し、各隣接Stepの
`expectedStateAfter` / `expectedStateBefore`が連鎖しなければ内部エラーとする。今回の対象
operationはすべて`requiresUserConfirmation = true`とする。`confirm_result`を自動追加しない。

title / instructionはoperation typeと、存在する場合だけTarget名から決定的に生成する。未確認の
ゲームUI名、ボタン、座標、画面遷移を文言へ推測してはならない。

`create_normal_artian` のinstructionだけは、そのStepがblind creation
([SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1)かどうかで分岐する。blind creationでは
「復元ボーナス内容は問わない」ことと、後続のReset Bonusesで5枠全体が引き直されることを
明示する。これは非永続の `PlannerPlanStepDraft` が保持するpresentation情報から決定し、
永続 `PlanStep` へ新しいfieldを追加しない。生成済み文言はこれまでどおりPlanStepの
`instruction` 文字列としてそのまま保存される。

#### ProductionPlanの集約値

`selectedBuildListEntryIds`はbest Search Stateの値だけをdedupeして辞書順にする。
`conflicts`はBeam Searchが返したstable conflict IDを再生成せずstructured cloneして保存する。
`currentStepId`は最初のStep ID（Stepなしならnull）である。

Beam SearchがcancelledならReplay、Clock、Plan/Step ID生成、Plan組み立てを行わず、`plan = null`で
conflicts / warningsだけを返す。partial Stateではtraceのprimary/progressed EntryをRejectedへ入れない。
`completed = false`では、protected destructive useと、選択済みConflictによって明確に除外された
resource conflictだけをRejectedとしてよく、未決定Entryへalready_satisfied、longer_route、
dominated_by_better_candidateを付けない。

complete PlanではTraceに登場したこと自体をRejected除外理由にしない。RejectedBuildListEntryは、最終selectedでない検討可能Entryと明確なprotected destructive
rejectionだけをEntry IDごとに1件作る。理由は証明できる順に
`requires_protected_weapon`、選択済みConflictによる`resource_conflict`、
`candidate_already_satisfied`による`already_satisfied`、同一Targetで短い採用Routeが
ある`longer_route`を使う。これらを証明できない場合だけ
`dominated_by_better_candidate`を使う。stale / CalculationContext / capability等のvalidation除外は
このunionへ押し込まず、既存warning/validation結果の責務とする。

`requiredMaterials`はselected BuildListEntryの`candidateSnapshot.requiredMaterials`だけを
materialIdごとに合算し、materialId辞書順で返す。master materialCostsからの再推測はしない。
shared physical actionとCandidate別requiredMaterialsの二重計上は既知の未解決境界である。Candidate単位の
total requiredMaterialsをphysical action単位へ安全に分解する契約がないため、第9C-Bではmasterからの
再計算、Entry数での除算、補正式の追加を行わない。

上限到達時でもtraceが1件以上あるbest partial Stateは、その到達点までのDraft Planとして返して
既存warningを維持する。Execution、Invalidation、Undo、Worker契約追加、Dexie保存は
第9C-Bでは生成・実装しない。
BuildCandidateの `BuildRoute.operations` を順にPlanStepへ変換する。Route kindやCounter endpointだけから操作列を再構成しない。

基本変換。

```text
CreateNormalArtianOperation -> create_normal_artian
ConvertToGogmaOperation    -> convert_normal_to_gogma
ResetBonusesOperation      -> reset_bonuses
KeepBonusesOperation       -> keep_bonuses
ResetSkillsOperation       -> reset_skills
```

current `RouteOperation` unionはこの5種類だけである。switch文のdefaultで旧operationを
暗黙処理せず、exhaustiveに扱う。

OperationごとのExpectedResult / RngAdvance / debug before-afterは次を正式契約とする。

| Operation | ExpectedResult | RngAdvance |
| --- | --- | --- |
| create normal | そのforge結果のnormal scope 5枠 | Normal +1 / forge、Skill 0、Gogma 0 |
| convert normal to Gogma | 継承したnormal scope 5枠 + 初回Series / Group | Normal 0、Skill +1、Gogma 0 |
| reset skills | bonusとscopeを維持し、次Series / Group | Normal 0、Skill +1、Gogma 0 |
| reset bonuses | gogma scopeの次5枠 | Normal 0、Skill 0、Gogma +1 |
| keep bonuses | familyをslotごとに維持したgogma scopeの次5枠 | Normal 0、Skill 0、Gogma +1 |

PlanStepDebugInfoも同じbefore / afterを記録し、conversion StepではSkillだけが進みGogmaは同値であることを表示する。PRNG内部10 stepをRngAdvanceのCounter deltaへ記録しない。

第9C-Bの旧契約ではReplay Traceに存在する `reserve_weapon` を独立PlanStepへ変換していた。
current ProductionPlanは16.3に従い、`reserve_weapon` を独立PlanStepにせず、Entryの最後の
物理Stepのtarget completion effectへ統合する。`confirm_result` は自動追加しない。

`confirm_result` は予測結果の確認だけを表す旧operation typeであり、current Plannerは生成しない。
Target候補を理想品として完成させ、Target完了とTargetSatisfactionの更新を適用するのは、
target completion effectを持つStep（最後の物理Step、または操作0の `confirm_owned_ideal`）の
Execution確定だけである。独立 `reserve_weapon` Stepを持つ保存済みlegacy Planは表示できても
current Execution operationとして実行しない（16.17）。

Route別の典型例。

## 11.1 通常アーティア経由

```text
1. create_normal_artian（`candidateOffset = k` なら `forgeCount = k + 1`。先行k本は通常のまま見送る）
2. convert_normal_to_gogma
3. Gogma-tier bonusが必要なら最初に reset_bonuses
4. 最初のReset後、必要なら追加の reset_bonuses / keep_bonuses
5. conversion時のSkillが不足する場合だけ reset_skills
   （最後の物理Stepがtarget completion effectを持つ。独立した確保Stepは作らない）
```

`candidateOffset = k` を採用する場合のconversion直後の合計進行はNormal `+(k + 1)`、Skill `+1`、Gogma `+0` である。`forgeCount = k + 1` の最後の1本だけを巨戟化し、先行k本を巨戟化しない。conversionは通常5枠をslot順のまま継承し、初回Series / Groupを付与する。conversion後のReset / Keep / Reset Skillsは `sourceOwnedWeaponId = null` のtransient Gogmaを対象とし、5枠既知なら最初のBonus amendmentはReset / Keepのどちらでもよい。blind Normal（Counter位置null）からのtransient Gogmaだけは5枠未知のため最初のBonus amendmentをResetとする。

Planner生成時に新しいOwnedWeapon IDを予約する。execution projection（16.3）では、
`count = forgeCount` のうち最後の1本の作成Stepでこの予約IDの `kind = "normal"` 武器を登録し
（先行するCounter進行用の作成Stepは登録しない）、巨戟化Stepで同じIDを `kind = "gogma"` へ更新し、
以後のReset / Keep / Reset Skills Stepで同じIDを更新する。blind variantでは作成対象の5枠を
ユーザー観測値でbindする（16.4）。最後の物理Stepのtarget completion effectで
Candidate Snapshotの finalBonuses / `finalBonusScope` / Series Skill / Group Skillと一致する
完成状態を、status ideal、protected、Target completedとして確定する（16.13）。
checkpointは同じRouteの途中状態であり、完成の対象にならない(7.5.3)。
OwnedWeaponへTarget IDを追加する処理は存在しない。`TargetWeapon.preferredOwnedWeaponId` は
Planner計算では変更せず、既存武器はPlan開始時、新規登録武器は登録Step確定で紐付け、完成時に解除する
（16.11 / 16.13）。

UI実行は1操作ずつ。

## 11.2 所持通常アーティア経由

```text
1. convert_normal_to_gogma
2. Gogma-tier bonusが必要なら最初に reset_bonuses
3. 最初のReset後、必要なら追加の reset_bonuses / keep_bonuses
4. conversion時のSkillが不足する場合だけ reset_skills
   （最後の物理Stepがtarget completion effectを持つ）
```

変換元の所持通常アーティアはレア8かつ非保護であることを要求する。探索上は `convert_normal_to_gogma` で元通常アーティアを排他消費し、その時点以降同じIDを別Routeで再利用しない。execution projectionでは同じOwnedWeapon IDを `normal` から `gogma` へ更新し、元IDを削除して別IDを作らない（16.3）。通常5枠をnormal scopeのまま継承し、初回Skillを予測してSkill Counterだけを1進める。後続Reset / Keep / Reset Skillsは `sourceOwnedWeaponId = null` とし、変換元の5枠は既知なので最初のBonus amendmentはReset / Keepのどちらでもよい。Bonus Type MappingはKeep family解決にだけ使い、Rank変換を推測しない。

探索内部のreserveは元OwnedNormalArtianWeaponを再削除しない。execution projectionでは
同じIDのまま完成状態、status ideal、protected、Target completedを最後の物理Stepで確定する。
変換元の所持通常アーティアはPlan開始時点で存在するため、Target紐付けはPlan開始時に行う（16.11）。

## 11.3 既存巨戟 Reset Bonuses

```text
1. reset_bonuses
2. 必要なら reset_skills
   （最後の物理Stepがtarget completion effectを持つ）
```

既存巨戟Routeは新しい武器を追加せず、各物理Stepの確定でRouteの `sourceOwnedWeaponId` と同じ
OwnedGogmaArtianWeaponを逐次更新する。Targetへの紐付けはPlan開始時に行い（16.11）、最初の物理Stepの
確定で作成中にする。
最後の物理Stepで理想品が完成した場合は、既存武器でも `status = "ideal"`、`isProtected = true`、
作成中OFF、Target completed、preferred解除とする（16.13）。旧契約の「既存武器の保護状態を維持する」
は廃止した。

## 11.4 既存巨戟 Reset Skills

```text
1. reset_skills（必要回数。最後のStepがtarget completion effectを持つ）
```

起点OwnedWeaponのrestorationBonusScopeと復元ボーナス5枠を変更せず、Skill CounterとSkill Prediction結果だけを反映する。Reset SkillsはSkill性能を変更するため、起点OwnedWeaponはGogmaかつunprotectedでなければならない。

各Reset Skills Stepの確定で同じIDのseriesSkillId、groupSkillId、updatedAtを更新し、復元ボーナスと
createdAtを維持する。完成Stepでstatus ideal、isProtected true、作成中OFFとし、Target紐付けと
完了は16.11 / 16.13に従う。

## 11.5 既存巨戟 Keep Bonuses

```text
1. keep_bonuses
2. 必要なら reset_skills
   （最後の物理Stepがtarget completion effectを持つ）
```

起点は `restorationBonusScope = "gogma_artian"` でなければならない。Keepはcurrent 5slotのfamilyをslotごとに保持する単一操作であり、selection別のPlanStepを生成しない。

## 11.6 撤去したPlanner-only Step

所持武器を素材として消費するモデルの廃止にともない、次のPlanner-only Stepは
current仕様から撤去した(8.1)。

```text
create_material_gogma         素材用巨戟として登録
use_weapon_as_material        素材として消費
change_owned_weapon_status    旧PracticalをMaterialへ変更
```

Plannerは素材用巨戟の補充Routeを生成せず、旧Practical武器の確認付き素材化Stepも
予定しない。statusを書き換えるのはOwned Weapons画面の通常CRUDと、8.1に列挙した
Execution Step確定（巨戟化時の未分類、選択済みcheckpoint到達時の実用、理想品完成時の理想）
だけである。

保存済みlegacy artifactがこれらのoperationを含んでいても、current Domain operationへ
自動変換せず、CalculationContext境界でfail closeする。

すべてのPlanStepは上記Route別のexecution effect（登録、同一ID更新、完成）を
`expectedStateBefore` / `expectedStateAfter` へ反映する（16.5）。探索上のTargetSatisfactionは
従来どおりreserve action適用時に更新し、reserve actionはEntryの最後の物理unitの直後に適用する
（16.3）。

---

## 12. 再計算

計画どおり進行している場合は再計算しない。

再計算はstale Planに対してユーザーが開始するUI / Planner操作であり、
`PlanStepOperationType` ではない。旧Planへ `recalculate_plan` Stepを追加しない。

Plan開始時の `baseSnapshot.initialExecutionState` と現在の可変状態を毎回比較してはならない。正常なStep実行でもRNG Counterと所持武器が変化するためである。

再計算判定は現在Stepの `expectedStateBefore` / `expectedStateAfter` を使用する。

```ts
export interface PlanRuntimeState {
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
  // 16.5: Plan依存Targetのexecution state検証用
  targetWeapons: TargetWeapon[];
  // 16.5: binding token解決用。binding StepのExecutionHistory.actualResult
  executionHistory: ExecutionHistory[];
}

export function detectPlanInvalidation(
  plan: ProductionPlan,
  currentInput: PlannerInput,
  runtimeState: PlanRuntimeState,
  phase: "before_step" | "after_step"
): RecalculationReason[];
```

判定手順。

1. 現在のCalculationContext、Plan依存Targetの性能定義Hash、Plan依存BuildListEntryの不変項目HashをPlanの不変前提と比較する（16.6）。全Target / 全Entryでは比較しない。BuildListEntryの不変項目にはSnapshot、searchStateHash、referencedOwnedWeaponsHash、CalculationContext、途中採用状態のpin pairと改善優先を含め、派生値のisStale / staleReasonsはHashに含めない
2. `phase = "before_step"` では実状態Hash（`targetExecutionStateHash` とbinding token解決を含む、16.5）を現在Stepの `expectedStateBefore` と比較する
3. ユーザー確認後、呼び出し側が実結果に基づくRNG更新とExecution effectをトランザクション内で適用する
4. `phase = "after_step"` では更新後の実状態Hashを現在Stepの `expectedStateAfter` と比較する
5. 一致した場合だけStepを完了し、次Stepへ進める
6. 一致した正常進行ではPlanをstaleにしない

再計算が必要な条件。

- RNG状態が現在Stepの期待状態と異なる
- NormalArtianCounterが現在Stepの期待状態と異なる
- Plan依存TargetWeaponの性能定義、`priority`、検索対象ON/OFF、execution state（lifecycle、preferred）が期待と異なる（`target_changed`）
- Plan依存BuildListEntryが変わった（`build_list_changed`）
- OwnedWeaponが現在Stepの期待状態と異なる
- CalculationContextとの互換性が失われた。この場合は `calculation_context_changed` を記録する
- 想定結果と実結果が違った（`unexpected_result`）
- 何を何回操作したか不明と記録された（`execution_operation_uncertain`）。Recovery Window内で現在位置を
  一意に特定して追従した場合（`operation_count_recovered`、16.15）はこの理由を取り除いて `active` へ戻す

次は再計算条件にしない（16.6）。

- 新しいTargetWeaponの追加、Plan非依存Targetの変更
- Build Listへの新規Entry追加、Plan非依存Entryの変更
- Candidate Searchの実行
- 所持武器のstatusだけの変更、作成中状態の正常な変化
- Execution自身によるTarget紐付け・完成・preferred解除
- ゲーム内でのセーブと中断

`planned_candidate_not_secured` / `different_candidate_secured` は独立した確保Stepを持つlegacy Planの
記録にだけ現れ、current Executionは生成しない（完成は最後の物理Stepの確定に統合された）。

制約。

- 実行に影響する項目だけを正規化した安定Hashで比較する
- Plan開始時の可変状態Hashは監査用であり、Step 1開始後のstale判定基準にしない
- Active Plan開始後、正常なRNG進行または計画どおりのOwnedWeapon変更によってBuildListEntryのsearchStateHashまたはreferencedOwnedWeaponsHashが現在値と一致しなくなっても、それだけで進行中Planをstaleにしない
- 正常なStep進行で生じるCounter / Inventory変更は `expectedStateAfter` と一致する限り差分とみなさない
- 差分がある場合、Planを `stale` にする
- UIからPlanを壊す変更を保存しようとした場合は、保存前に警告し、承認時にPlanを `abandoned`
  （`breaking_change_approved`）にしてから保存する。これはstaleとは区別する（16.2 / 16.6）
- 自動で新Planへ置き換えず、ユーザーに再計算を促す。実行中Planからの再計算は再計画Previewと
  明示採用で行う（16.8）

---

## 13. Undo

Undo対象。

- 表示中の実行Planの最後のExecutionHistoryが持つExecutionUndoSnapshot（実行可否は16.16）
- そのSnapshotに保存されたRngState、全NormalArtianCounter、変更対象OwnedWeapon（status・作成中状態を含む）、追加OwnedWeapon ID、削除OwnedWeapon本体、Executionが変更したTargetWeapon、ProductionPlan、ゲーム内セーブ地点

制約。

- Undoはアプリ状態だけを戻す
- ゲーム内操作が巻き戻るわけではないことをUIに表示する
- 最後のExecutionHistoryだけから、そのStep確定前のアプリ状態を正確に復元する
- UndoはExecutionHistory取消、PlanStep取消、RNG復元、NormalArtianCounter復元、Inventory復元、TargetWeapon復元、ProductionPlan復元、ゲーム内セーブ地点の復元または削除を1つのDexie transactionで行う
- Undo transactionが失敗した場合は部分復元を残さず、Undo前の状態を維持する
- Snapshotどおりの復元後は、復元したProductionPlanのstatusと再計算理由をそのまま使用し、現在値との差分を新たに推測しない

---

## 14. Worker

```ts
export type PlannerWorkerRequest =
  | {
      type: "create_plan";
      requestId: string;
      input: PlannerInput;
    }
  | {
      type: "detect_invalidation";
      requestId: string;
      plan: ProductionPlan;
      input: PlannerInput;
      runtimeState: PlanRuntimeState;
      phase: "before_step" | "after_step";
    }
  | {
      type: "cancel";
      requestId: string;
    };

export type PlannerWorkerResponse =
  | {
      type: "create_plan_result";
      requestId: string;
      result: PlannerResult;
    }
  | {
      type: "invalidation_result";
      requestId: string;
      reasons: RecalculationReason[];
    }
  | {
      type: "progress";
      requestId: string;
      progress: {
        expandedStates: number;
        maxExpandedStates: number;
      };
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
```

Worker messageはstructured clone可能なPlannerInputだけを受け取る。RngEngine instanceを
postMessageしない。Worker moduleがEngine、ID Factory、Clockを生成して
`PlannerDependencies` とし、pure Planner calculationへ注入する。PlannerInputへ
`engineCapabilities` を重複保存せず、validationは
`dependencies.rngEngine.capabilities` を `deriveRngCapabilities` へ渡す。

Planner domainとTrace ReplayはProduction RNGのinput-level support契約へ対応済みである。
本番経路はBuild List UIからProduction Planner Worker Clientを呼び、
`planner.worker.entry.ts` がWorker内部で `ProductionRngEngine`、ID Factory、Clockを
生成して `PlannerDependencies` として注入する。Engine instanceや関数をWorker messageへ
含めない。Client、Plannerのcurrent `CalculationContext`、Worker内Engineは
`PRODUCTION_RNG_ENGINE_VERSION` を共通authorityとして使用する。

C5-E2C3でactive Gate契約をPlanner validation、Trace Replay、expected-state hashへ同期済みである。exact persisted Gateはoperation preflightまたはReplay requirementではなく、expected-state hashにも含めない。Production adapterのruntime policy変更と同時に `PRODUCTION_RNG_ENGINE_VERSION`を `production-rng:c5-e2`へbumpした。これはIdentification Production UIのactivationを意味しない。

B8-D1でconstrained re-search用のrequest kindを追加した。ordinary `create_plan` /
`create_plan_result` は変更していない。実装名称の対応は次のとおりで、`cancel`、
`progress`、`error` は両request kindで共有する。

```text
create_constrained_plan          input: { plannerInput, orchestrationBounds }
create_constrained_plan_result   result: PlannerOrchestrationResult
```

あわせて、logical `requestId` とは別にtask instanceを識別するruntime-only
`generation` をWorker wire messageへ追加した。ordinary / constrainedのtask requestと
`cancel` はgenerationを運び、`progress`・両result・`error` はそれをechoする。Clientが
monotonicに採番し、Workerはそれをownership authorityとして使う。Clientは
requestIdとgenerationが両方一致するresponseだけを現在requestのものとして扱う。
`postMessage()` が非同期であるため、requestIdだけでは同一ID再利用時に旧task instanceの
responseを新requestのものとして誤処理しうるためである。`generation` はWorker protocol
限定のruntime primitiveであり、`PlannerInput` / `PlannerResult` /
`PlannerOrchestrationResult`、Domain entity、Persistenceへは追加しない。

`PlannerOrchestrationResult` は `domain/planner/constrained` の型であるため、この
protocolはWorker層の `src/workers/plannerWorkerContracts.ts` へ置く。Domainは
Worker moduleをimportしない。`PlannerOrchestrationBounds` はcaller必須としてWorker
messageへ含め、`ConstrainedEnumerationBounds` は含めない。Production Worker adapterが
`defaultConstrainedEnumerationBounds` をWorker境界内で明示的に渡す。

B9-Cでwhat-if比較を同じPlanner Worker境界へ接続した。実装名称の対応は次である。

```text
create_what_if_comparison          input: PlannerWhatIfRequest
create_what_if_comparison_result   result: PlannerWhatIfCalculationResult
```

ordinary / constrained / what-ifは同じ `requestId` / generation、`cancel`、`progress`、
`error` 契約を共有する。`PlannerWorkerClient.createWhatIfComparison()` は
`PlannerWhatIfRequest` をそのまま渡す。Production Worker adapterの
`createProductionPlannerWhatIfComparison()` が `defaultConstrainedEnumerationBounds` を
Domain calculationへ明示供給し、caller-requiredの `PlannerWhatIfBounds` は変更しない。
`defaultPlannerWhatIfBounds` はB9-B2cで2 / 8に確定したが、callerだけが明示選択し、
Worker adapter / Clientは暗黙適用しない（9.2.4.9）。この記述は実装mappingであり、
9.2.4.1〜9.2.4.13のnormative semanticsを変更しない。

Workerを利用できない環境ではClientのversionを `production-engine-unavailable` とし、
計画実行を明示的なunavailable errorにする。これは
`getPredictionSupport() = supported: false` のBuildListEntry単位除外とは別経路である。

---

## 15. テスト観点

## 15.1 Satisfaction Test

- 通常アーティアをTargetのPractical / Ideal所持判定に含めない
- 巨戟アーティアだけを実際のTarget条件で評価する
- statusではなく条件で実用品所持を判定する
- 理想品所持TargetをPlanner対象から外す。ただしrequired checkpoint Entryを持つ
  Targetは、そのEntry自身をsecureするまで対象に残る（7.5.6）
- 妥協品しか持たないTargetはPlanner対象に残る
- 同一Targetの別Entryの理想品完成だけではrequired checkpoint EntryのTargetを
  完了扱いにせず、required Entryのcheckpoint到達とsecureで完了する
- 同一Targetにcheckpoint-selected Entryが2件以上あればfail closedし、片方を自動選択しない
- Planner開始時点で理想品所持のTargetにcheckpoint選択があればfail closedする
- checkpoint選択の無い同一Target複数Entryは従来のcandidate選択のまま
- 競合participantがcheckpointなしのEntryでも、同Targetの別Entryにcheckpoint選択が
  あればconstrained re-searchとwhat-ifは再検索しない
- `hasPractical` はstatusではなく実際の性能から判定する
- Ideal候補確保でhasPracticalとhasIdealがtrueになる
- 開始OwnedWeaponが妥協条件を満たしていてもcheckpoint opportunityにしない

## 15.2 Score Test

- priorityが高いTargetの候補が優先される
- 理想品未所持Targetの候補が優先される
- Candidate ScoreがBeam Searchの状態評価に使われ、単純Score順でPlanが確定しない
- `categoryScore` と `practicalFirstProgressTargetIds` が存在しない
- 選択済みcheckpointの充足に差がある場合、`weaponSwitchCount` が少なくても従来の優先順位が勝つ
- `evaluationScore` に差がある場合も、`weaponSwitchCount` が少ない側ではなく高score側が勝つ
- 両者が同点の場合だけ `weaponSwitchCount` が少ないstateを優先し、それも同数なら
  従来のsemantic / trace stable tie-breakへ進む

## 15.3 Beam Search Test

- 共有Gogma / Skill Counterを進める複数候補を単独Score順より少ない操作で組み合わせられる
- 複数Routeの共有RNG prefixを重複実行せず、各Entryのroute progressが進む
- `beamWidth` を超えたStateが評価順に枝刈りされる
- `maxExpandedStates` 到達時に探索を停止してwarningを返す
- `maxPlanSteps` と `maxExpandedStates` のwarning kindを区別する
- `PlannerInput.options` の値がそのまま `termination.limits` に載り、module既定値へ
  差し替えられない
- 上限打切り時に `termination.status = "incomplete"` と `reachedLimits` を返し、
  対応するwarningと矛盾しない
- 完成した探索が上限へ到達していた場合は `status = "completed"` のまま
  `reachedLimits` が非空になり、保存とnavigationを妨げない
- キャンセルは `incomplete` ではなく `cancelled` になる
- Beam Searchへ到達しなかった入力invalid runは `exhausted` で `reachedLimits` が空になる
- typed terminationが `PlannerBeamSearchResult` からProduction Plan生成、
  orchestration結果、Worker応答、Worker Clientまで再構築されずに届く
- 同じ入力と同じ定数から決定的なPlanが生成される
- 同じEngine fixture、ID Factory、ClockでもID、時刻、予約OwnedWeapon IDを含め決定的になる
- offset kのNormal候補が `forgeCount = k + 1` だけNormalを進め、最後の1本だけのconversionでSkillを1進め、Gogmaを進めない
- create operationの `normalCounterAfter = normalCounterBefore + forgeCount` と、採用候補位置 `normalCounterBefore + forgeCount - 1` を混同しない
- 完全最適解を要求せず、探索上限内の最良Stateを返す
- 別Entryの実操作でcurrent Counterが通過したskip可能prefixがroute progressだけ前進し、
  Search Action、trace、progressedBuildListEntryIds、inventory効果、route runtime outputを
  生成しない
- 同じCounter位置に必須unitと実行可能なskip可能unitがある場合、skip可能unitを先に実行する
  successorを生成せず、不要な `counter_before_current` も記録しない
- 必須unitが現在stateで実行不能な場合はこの除外を適用しない
- skip可能unit同士だけの位置では、どちらのEntryが実行してもよい
- skip不可なpast unitは従来どおり `counter_before_current` などでfail closedになる
- Route末尾のunitはskip不可であり、Route全体がfast-forwardされない
- Reset→Reset / Keep→Reset / Keep→Keep / Reset Skills→Reset Skillsだけがskip可能で、
  Keep直前のReset、create、conversionはskip不可
- 共有Gogma Counterを別武器の操作で進めた複数Targetが、どちらのTargetも落とさずIdealまで
  完成し、必要なRoute prefixだけがPlanStepになる
- 同じOwnedWeaponの連続操作はswitchを増やさず、別武器への変更で1、元の武器へ戻ると2になる
- `reserve_weapon` はswitch countも直前subjectも変えず、同じ武器の操作列を分断しない
- silent fast-forwardされたRoute prefixはswitchを増やさない
- 同じconcrete OwnedWeaponのshareable physical actionで複数Entryが進んでも、
  switchを二重加算しない
- 同じEntryのtransient Gogma連続操作はswitchを増やさず、別Entryのtransient Gogmaは別subject
- 共有Counter位置の分割が既存評価で同点になるユーザー再現ケースで、Beam Searchが実際に
  選んだTrace / ProductionPlanのglobal execution orderが武器切替1回の順序になる

## 15.4 Inventory Test

- current `RouteOperation` に `use_weapon_as_material` が存在しない
- `canUseAsMaterial`、`canConsumeMaterialWeapon`、`consumeMaterialWeapon`、
  `consumedMaterialWeaponCount`、`PlannerMaterialRequirement`、
  `PlannerMaterialAssignment`、`material_weapon_shortage` が存在しない
- Plannerが `create_material_gogma` / `change_owned_weapon_status` を生成しない
- 素材用巨戟の補充Routeを生成しない
- 素材武器消費のpenaltyがscoreに存在せず、未分類武器の本数がscoreへ影響しない
- `isProtected = true` の武器をReset Bonuses・Keep Bonuses・Reset Skillsへ使う探索展開を生成しない
- Bonus / Skill amendmentで保護武器を必要とするEntryは `requires_protected_weapon` で不採用になる
- 所持通常アーティアの巨戟化で元のNormalがInventoryから削除される
- 同じ所持Normalを二重使用できない
- 消費済み武器を再利用しない
- `status` は使用可否の判定に使われず、未分類の巨戟でも実性能でTargetを満たせる

## 15.4.1 Checkpoint Constraint Test

- 選択済みopportunityの終端unitをsilent fast-forwardしない
- 未選択の中間unitは従来どおりsafe fast-forwardできる
- 選択に不要な完全上書き済みprefix unitは従来どおりskipできる
- `canSkipWhenCounterPassed` の「直後の操作」を同一lane内で判定する
- pinを片laneが越える前に必ずもう片laneがpinへ到達する（pin gating）
- Skillのみ選択 -> Practical Skill + Ideal Bonusの瞬間にmilestoneが載り、その後Skillを改善する
- Bonusのみ選択 -> Ideal Skill + Practical Bonusの瞬間にmilestoneが載り、その後Bonusを改善する
- 両方選択 -> Practical + Practicalの瞬間にmilestoneが載り、Skill先行 / Bonus先行の両continuationが成立する
- 選択済み状態のexact stateがTrace Replayで検証され、不一致は `checkpoint_state_mismatch` になる
- checkpointへ到達していないEntryはreserveできず、`selected_checkpoint_not_reached` になる
- Plannerが選択を自動解除しない
- Plannerが同一groupの別opportunityへ自動変更しない（後続到達点を選んだ場合、その操作自体を実行する）
- 選択なしのEntryでは従来のIdeal Route実行意味が変わらない
- 1つの共有物理actionが複数Entryのcheckpointを同時達成する場合、操作を重複させない
- checkpointは新しい `PlanStepOperationType` ではない
- checkpoint milestoneが該当する物理PlanStepへ載る
- milestone到達後も `remainingOperationCount` 分の後続PlanStepが存在する
- checkpoint到達でOwnedWeaponをreserveしない
- Planner計算はcheckpoint到達でstatusも保護も変更せず、execution projectionのmilestone Stepだけが
  compromise label（practical、保護不変）を持つ（16.12）
- 最終的な理想品完成時だけ完成semantics（ideal、既存武器も保護、Target completed）を適用する（16.13）
- 改善優先 `skill_first` / `bonus_first` が両lane同等成立時の実行順へ反映される
- 優先laneが現在実行不能な場合、Plannerがもう片方のlaneを先に進めて完了する
- 優先laneが現在実行可能でも、それを先に進めると別Targetの必須Counter位置を潰して全体Planが
  成立しない場合、Plannerは優先に反してもう片方のlaneを先に進めたbranchで完了する
  （`improvementPreferenceViolationCount > 0`）
- `planner` は両laneのbranchを対等に生成し、Bonus先行固定ではない（Skill先行しか成立しない
  scenarioで完了する）
- 既存巨戟の現在Skill（Practical）+ 現在5枠（Ideal）でSkill lane位置0を選択すると、validationを
  通り、Planner開始時点でcheckpoint到達済みになり、Skillを後で理想化して完了する
- 既存巨戟の現在Skill（Ideal）+ 現在5枠（妥協）でBonus lane位置0を選択した場合も同様である
- 既存巨戟の現在Skill + 現在5枠がともに妥協条件を満たし両lane位置0を選択すると、validationを
  通り、開始時点で到達済みとしてそこから理想品まで続く
- conversion RouteのSkill lane位置0は開始時点では未到達で、巨戟化実行後に成立する
- `comparePlannerSearchStates()` でevaluationScoreとpreferred sourceがviolation数より上位、
  violation数がweaponSwitchCountより上位である
- 複数TargetがSkill Counter / Gogma Counterを共有するとき、各Entryの物理依存順を守りながら
  interleaveして全TargetをIdealまで進める

## 15.5 Conflict Test

- 同じRNG位置の候補を競合にする
- conversionを同じSkill Counter位置の競合にし、同じGogma Counter位置の競合にしない
- 同じOwnedWeapon消費を競合にする
- 推奨候補が優先順位どおり決まる
- ユーザー選択が必要な競合を検出できる
- PlanConflictの参照がBuildListEntry ID基準である
- RejectedBuildListEntryの参照がBuildListEntry ID基準である
- 必須unitとskip可能unitが同じCounter位置にあっても競合にせず、Conflict Resolution UIへ
  出さない（順序はPlannerがexecution eligibilityとして決める）
- skip可能unit同士を同じCounter位置だけで競合にしない
- 必須unit同士の同一Counter位置競合と `same_owned_weapon_consumed` は従来どおり検出する
- fast-forward済みのpast prefixがConflict対象へ戻らない
- 2武器の選択済みcheckpointが同じCounterで両立不能なら競合になる
- 作成リストで別opportunityへ変更すると、その競合が解消する
- 選択のない共有prefix位置は従来どおり競合にならない
- 競合へ参加した選択済みcheckpointが `PlanConflict.checkpointParticipants` に記録され、
  `PlanConflict.id` の生成規則は変わらない

Planner-driven constrained re-search実装後に追加する観点。

- 再検索の開始位置を `conflictingCounter + 1` へ固定せず、競合位置より前の解も候補になる
- 同一Counter位置でもshareableなoperationを持つCandidateを除外しない
- 固定Candidateと共存不能なCandidateを順次読み飛ばし、共存可能なものをnext Idealとして採用する
- Candidate Search側にcounter precondition / action identity判定を複製していない
- earlier same-result solutionが固定Candidateと競合して実行不能な場合に、
  later same-result solutionを再評価して採用できる
- 初回Search用の「同一結果なら最小advanceだけ保持」pruningが再検索へ持ち込まれていない
- 初回SearchのPractical dominanceで省略された候補が、dominant candidate実行不能時に
  再評価・採用できる
- canonical Ideal到達による終了とhorizonが再検索の探索範囲を恒久的に制限しない
- 再評価がCartesian productの列挙にならず、stream独立性とCross-only初回policyを保つ
- what-if比較が双方向(A優先時のB、B優先時のA)で対称に求まる

## 15.6 Plan Test

- PlanStep orderが連番になる
- requiredMaterialsが集計される
- currentStepIdが最初の未完了Stepを指す
- maxPlanSteps超過でwarningが出る
- Plan生成が入力を破壊しない
- Candidate SnapshotのBuildRoute.operationsを書き換えない
- BuildRoute.operationsと同じ順序でPlanStepが生成される
- 5枠既知のnormal scope transient Gogmaには最初のReset前でもkeep_bonuses PlanStepを生成でき、blind transient Gogmaにだけ最初のReset前のkeep_bonuses PlanStepを生成しない
- 最初のReset後はnormal / owned-Normal Routeから後続keep_bonuses PlanStepを生成できる
- conversion StepのExpectedResultが継承normal bonusと初回Skillを持ち、RngAdvanceがSkill +1 / Gogma +0になる
- transient GogmaのReset / Keep / Reset Skills PlanStepがfake OwnedWeaponIdを持たない
- `existing_gogma_reset_skills` からreset_skills Stepを生成し、最後のStepがtarget completion effectを持つ。独立した確保Stepを生成しない
- Search後にsourceがprotectedへ変わったReset Skills Routeを `requires_protected_weapon` で不採用にする
- 各PlanStepにexpectedStateBefore / Afterが設定される
- BuildListEntry IDとCalculationContextがPlanへ保存される
- Candidate由来PlanStepの主参照がBuildListEntry IDである
- `recalculate_plan` PlanStepを生成しない
- Route別execution projection（新規Normalは作成対象Stepで登録しCounter進行用は登録しない、所持Normalは同一IDのkind更新、既存Gogmaは同一ID更新、完成は最後の物理Step）が守られる
- 上限打切りのincomplete resultから生成されたpartial Planを、実行可能なDraft
  ProductionPlanとして永続化しない
- そのとき生成BuildListEntriesも単独で永続化しない
- 探索が自然終了しただけの `exhausted` resultは従来どおり保存できる
- version 2 / 3 / 4 ProductionPlanがcurrent version 5で非互換となり、
  `calculation_context_changed` を返す
- version 5 ProductionPlanがcurrent version 5で互換となる
- version 2 / 3 / 4のBuildCandidate / BuildListEntryはcurrent version 5で互換、
  version 1は非互換であり、build-result例外がProductionPlanへ波及しない
- 実ユーザーケース（Bonus 23 / Bonus 148 + Skill 82の2 Target）が既定上限で
  `incomplete` と24 step partialになり、`maxExpandedStates` を引き上げると
  232 stepの完成Planになる

## 15.7 Invalidation Test

- 現在StepのexpectedStateBeforeと一致する状態ではstaleにならない
- 期待操作適用後にexpectedStateAfterと一致すればstaleにならない
- Plan開始時からCounterが進んでいても現在Step期待値と一致すればstaleにならない
- 現在Step期待値と異なるRngState変更でstaleになる
- Plan依存TargetWeaponの性能定義変更でstaleになり、新規Target追加やPlan非依存Target変更ではstaleにならない
- Plan依存BuildListEntry変更でstaleになり、新規Entry追加やPlan非依存Entry変更ではstaleにならない
- 計画外のOwnedWeapon semantic変更でstaleになる
- ExecutionHistoryの想定外結果でstaleになる
- CalculationContext非互換で `calculation_context_changed` が記録され、staleになる
- Active Planの計画どおりの参照OwnedWeapon変更では、BuildListEntry由来の `owned_weapon_changed` だけを理由にstaleにならない
- 所持武器のstatusだけを変更してもstaleにならない

## 15.8 Worker Contract Test

- detect_invalidation requestがplan、input、runtimeState、phaseをすべて保持する
- Workerが同じ引数をdetectPlanInvalidationへ渡す
- create_plan requestはserializable PlannerInputだけを保持し、Engine instanceを持たない
- Worker module内で生成したPlannerDependenciesがPlanner計算へ渡される
- 有効、削除済み、staleな競合選択を区別し、無効選択をwarningにする

## 15.9 Constrained Re-search Test

B8-Aで固定した契約に対するテスト観点である。実装はB8-B1以降で行う。

- 明示的な `PlannerConflictResolution` が無い競合でconstrained re-searchを自動実行しない
- `recommendedBuildListEntryId` やbestStateのparticipantを固定authorityとして使わない
- 再検索の開始位置が `conflictingCounter + 1` へ後方固定されない
- enumeratorへ渡す `origin` がPlanner計算開始時のcurrent validated snapshotから
  構成され、過去のUI Candidate Search requestを要求しない
- constrained re-searchが過去のUI一時filterを継承せず、route scopeが現時点で
  成立する全Routeになり、UI一時filterや `CandidateSearchSettings` を
  適用しない
- 探索範囲の上限が `ConstrainedEnumerationBounds` だけで決まる
- deterministic constrained search identityがTargetWeapon ID、Search / RNG semantic
  origin、CalculationContext、`ConstrainedEnumerationBounds`、route policyから
  安定生成され、random UUID / Clock / request UUID / enumeration ordinalを含まない
- 競合位置より前のPracticalが再評価対象に含まれる
- 初回Searchのstream-local retentionで省略された同一結果の後続位置を再評価できる
- 初回SearchのPractical dominanceで省略された候補を再評価できる
- Counter位置の一致だけを理由にCandidateを除外しない
- 共存判定が既存Planner再実行の結果に一致し、B8専用の簡易競合判定を持たない
- constrained CandidateをBeam Search途中Stateへinjectせず、初期Stateから再実行する
- 再実行のたびにconflict resolutionを再対応付けし、元の `conflictKey` を流用しない
- 再対応付けをfull Beam Search実行後ではなくinitial conflict preflightで行い、
  resolution無しのBeam Searchを先に走らせる循環が発生しない
- preflightが `validatePlannerInput` / `validation.validBuildListEntries` /
  `createInitialPlannerSearchState` / initial relevant-entry selection /
  `createPlannerRouteUnitPlans` / `detectPlannerConflicts` の既存Plannerロジック
  だけを使い、B8専用の `usedCounters` 等の簡易判定を持たない
- preflightがraw `BuildListEntry` から初期Stateを作らず、通常Beam Searchと同じ
  validation authorityを共有する
- generated Entryまたはfixed Entryがvalidationで除外された場合にfail closedとなり、
  そのCandidate trialを採用しない
- preflight入力にstaleな旧 `conflictKey` を適用せず、誤った
  `invalid_conflict_resolution` を発生させない
- 元のvalidated PlannerInputの全valid `PlannerConflictResolution` を再対応付け対象と
  し、再検索対象以外のユーザー明示resolutionを黙って捨てない
- 全fixed constraintが一意に対応できた場合だけ完全なresolution配列を再構築し、
  1つでも0件・複数件・fingerprint不一致・validation除外があればfail closedとする
- 競合資源identityが一致しfixed Entryを含むConflictが一意なときだけ、現在の
  `PlanConflict.id` でresolutionを構築する
- 再対応付けが0件または複数件のとき、対応付けを推測せずtrial不採用または競合返却にする
- 共存可能性の最終判定がpreflightではなく完全再実行のBeam Search / Trace Replayである
- `maxPlannerReruns` がfull Beam Searchの実行回数だけを数え、preflightを含めない
- `same_owned_weapon_consumed` の競合資源が独立fieldとして保持され、
  participantの `sourceOwnedWeaponId` で代用されない
- `generatedBuildListEntries` が最終augmented PlannerInputへ採用したEntryだけを含む
- `plan === null` の場合にgenerated Entryを永続化しない
- generated BuildListEntry IDがrandom UUID / Clock / enumeration ordinalへ依存しない
- enumeratorが `ConstrainedCandidate` をyieldし、`BuildCandidate.id` /
  `searchRunId` / `createdAt` を持たない
- materializerが `searchRunId` にdeterministic constrained search identityを設定し、
  `id` をそのidentityとCandidate semantic meaningから安定生成する
- materializerが `intermediateStateGroups` を抽出し、その値がyield可否・ordering・
  route scope・探索終了・探索範囲・off-axis評価・coexistence判定へ影響しない
- 通常Candidate Searchの `searchRunId` 契約と `BuildCandidate` ID生成規則が
  変更されていない
- 同一入力の再実行で15.9.1のsemantic outcomeが一致し、`ExpectedPlanState` の
  hash完全一致は要求されない
- 各run内で first `expectedStateBefore` が
  `PlanningInputSnapshot.initialExecutionState` と一致し、step Nの
  `expectedStateAfter` が step N+1 の `expectedStateBefore` と一致する
- 連番ID・固定時刻のテストdependency注入時だけ、`ExpectedPlanState` 完全一致を
  追加検証する
- semantic contentが異なるID衝突でfail closedになる
- stale既存Entryを再利用も上書きもせず、新しいEntryを作成する
- Candidate semantic identityにrestoration bonus scopeが含まれる
- generated EntryとProductionPlanが同一transactionで保存され、partial saveが発生しない
- 保存直前validation失敗時に何も書き込まない
- enumeration boundsとorchestration boundsが分離され、Planner専用3 boundsが
  `ConstrainedCandidateSearchInput` へ渡らない
- どちらのboundsも、到達した場合にexhaustionではなく打ち切りとして報告する

### 15.9.1 determinismの範囲

同一入力の再実行に対して要求するのはsemantic outcomeの一致だけである。
「Plan全体が一致する」と読める契約にしてはならない。

#### 一致を要求するもの

```text
generated BuildListEntry ID
selected BuildListEntry の semantic 集合
PlanStep の semantic operation 列と順序
RNG Counter advance / transition semantics
inventory transition semantics
conflicts の semantic outcome
warnings
rejectedBuildListEntries
requiredMaterials
```

#### 一致を要求しないもの

```text
ProductionPlan.id                          (PlannerIdFactory 由来)
PlanStep.id                                (PlannerIdFactory 由来)
予約 OwnedWeapon ID                        (PlannerIdFactory 由来)
createdAt / updatedAt                      (PlannerClock 由来)
PlanningInputSnapshot.createdAt            (PlannerClock 由来)
ExpectedPlanState の hash 値そのもの        (下記)
PlanningInputSnapshot.initialExecutionState の hash 値そのもの
```

**`ExpectedPlanState` のhash完全一致を要求しない。** `ownedWeaponsHash` は
OwnedWeapon IDを含み(11.2 / [DATA_MODEL.md](./DATA_MODEL.md) 11.2)、
`reserve_weapon` の予約OwnedWeapon IDは `PlannerIdFactory` が生成する。したがって通常のProduction dependencyでは、
同じsemantic outcomeでもrunごとに `ownedWeaponsHash` が変わる。
「予約OwnedWeapon IDの一致は不要」と「expectedState hashの一致は必須」は両立しない。
要求するのは上記のinventory transition semanticsとRNG Counter advance /
transition semanticsであり、hash文字列そのものではない。

#### run内で必須のchain validity

hash完全一致をrun間で要求しない代わりに、各run内では既存のchain validityを必須とする。

```text
first expectedStateBefore == PlanningInputSnapshot.initialExecutionState
step N expectedStateAfter == step N+1 expectedStateBefore
```

これは12章の再計算不変条件と14章のExecution Transactionが依存する既存契約であり、
B8で緩めない。run間のhash一致を要求しないことと、run内のchainが閉じていることは
別の要件である。

#### 固定dependencyでの追加検証

`PlannerIdFactory` と `PlannerClock` は本書4章の既存契約どおりruntime dependencyであり、
本番adapterは `crypto.randomUUID()` と現在UTC時刻をラップする。B8はこの契約を変更しない。

連番IDと固定時刻のテストdependencyを注入した場合に限り、`ExpectedPlanState` の
完全一致、`ProductionPlan.id` / `PlanStep.id` / 予約OwnedWeapon IDの一致、
`createdAt` / `updatedAt` の一致を追加で検証してよい。これはProduction契約ではなく、
固定dependency下の追加検証である。

generated BuildListEntry IDの決定性(9.2.13)はこれとは別である。generated Entry IDは
`PlannerIdFactory` を使わず、semantic contentから安定生成するため、Production
dependencyでもrun間で一致する。

## 15.10 Execution Lifecycle Test

16章の後続実装PRで少なくとも次を検証する。

- Step確定ごとに `rngAdvance` がRngState / NormalArtianCounterへ即時反映され、未確定Stepの
  進行は永続化されない
- 中断・再読み込み後も `active` のまま `currentStepId` から再開でき、新しいstatusを持たない
- Case A（単一Target・新規Normal）: Counter進行用Normalを複数作成してもOwnedWeaponを登録せず、
  作成対象の最後の1本だけを予約IDで登録し、巨戟化・Reset / Reset Skillsで同じIDを更新し、
  完成Stepでideal / protected / 作成中OFF / Target completed / preferred解除、全Step完了でPlan completed
- Case B（blind Normal）: 作成対象の5枠をユーザー観測値として入力しない限り確定できず、架空5枠を
  生成せず、binding tokenで後続Stepの期待状態が一致し、観測値と異なる計画外編集は不一致になる
- Case C（既存Gogma）: Plan生成時は紐付けを変更せず、Plan開始のtransactionでTargetへ紐付け、別Targetの
  紐付けを同じtransactionで解除し、最初のStepはその開始後状態から確定でき、同じIDを更新し、完成時に
  既存武器でもprotectedになる
- Case D（妥協品で終了）: 選択済みcheckpoint到達Stepでpracticalになり作成中は継続し、確認後の終了で
  Plan abandoned（`finished_as_compromise`）、Target active、preferred維持、作成中OFFになる。
  未選択の状態へ性能上到達してもpracticalにしない
- Case E（武器切替）: Weapon A -> B -> Aで切替案内が2回導出され、ExecutionHistory、Counter、
  Planner cost、`maxPlanSteps` に影響しない
- Case F（Plan中Target追加）: 新Target追加、新Entry追加、Plan非依存Target変更でPlanがstaleにならず、
  現在地点からCandidate Searchできる
- Case G（再計画）: Previewは旧Plan、currentStep、永続状態を変更せず、採用時にstate再検証が失敗すれば
  拒否し、成功すれば旧Plan abandoned（`replan_adopted`）と新Plan activeがatomicに切り替わり、
  旧PlanのExecutionHistoryが残る
- Case H（ゲーム内セーブ地点）: Step 12で記録しStep 20まで進めた後のPlan破棄操作で
  「現在地点を維持 / Step 12へ戻す / キャンセル」を選ばせ、復元はexecution scopeだけを戻して
  Plan非依存Targetなどを巻き戻さない。セーブ地点が無い、または現在位置と同じなら選択を出さない
- Case I（想定外結果）: 操作が明確ならCounter消費と実結果を保存してPlan stale（`unexpected_result`）、
  操作内容不明ならCounterも武器も変更せずPlan stale（`execution_operation_uncertain`）となる。
  想定外結果はRNG再同定を促し、操作内容不明は通常のRNG同定へ直接誘導せず、同じ操作の回数不明なら
  Recovery Window内の現在位置確認（`operation_count_recovered`）、別操作・別武器や一意に特定できない場合は
  ゲーム内セーブ地点の復元、セーブ地点が無ければPlan破棄を案内する（16.15）
- Case J（操作0 Ideal）: Target登録時・Search時に通知でき、Planへ入った場合は `confirm_owned_ideal`
  StepだけでCounterを進めずにideal / protected / Target completedになる
- UIからのPlanを壊す変更は警告し、承認時はPlan abandoned（`breaking_change_approved`）と変更保存が
  同一transactionになり、キャンセル時は何も変更しない
- 「実行中Plan完了後（予測）」起点の検索がRNG Predictionを再実行せず、永続状態とPlanを変更せず、
  結果をBuild Listへ追加できない
- Undoが最新ExecutionHistoryの範囲でRngState、全NormalArtianCounter、OwnedWeapon（status・作成中状態を
  含む）、TargetWeapon、ProductionPlan、ゲーム内セーブ地点を正確に戻し、再計画採用・ユーザー破棄で
  abandonedになったPlanのUndoを許可しない
- `preferredOwnedWeaponId` だけの変更で `createTargetDefinitionHash()` とBuildListEntry stalenessが変わらず、
  PlannerInputとDraft Planの `targetWeaponsHash` には反映される
- `completed` TargetがCandidate Search、Planner入力、通常の目標武器一覧から除外され、レコードは保持される
- `createTargetDefinitionHash()` が性能定義fieldだけを対象にし、`priority` / `isEnabled` /
  `preferredOwnedWeaponId` / lifecycleの変更でBuildListEntryがstaleにならない
- `targetWeaponsHash` が `definitionHash` に加えて `priority` / `isEnabled` / `preferredOwnedWeaponId` /
  `lifecycleStatus` の変更で変わり、Plan依存Targetの `priority` / `isEnabled` 変更で
  `dependentTargetDefinitionsHash` が変わってPlan前提変更になる
- 理想品完成（Execution、`confirm_owned_ideal`、目標の直接完了）で完成武器を優先起点にする他の全Targetの
  preferredだけが同一transactionで解除され、その性能条件・priority・isEnabled・lifecycleは変わらず、
  ExecutionではUndoで元に戻る
- セーブ地点復元で、復元後Planに必要な所持武器・Plan依存Target・Plan依存Entryが欠損していれば
  どの永続状態も変更せず拒否し、Plan非依存Targetの欠損だけでは拒否しない
- Step確定、再計画採用、セーブ地点復元、Undoの途中失敗で部分更新が残らない

---

## 16. Execution lifecycle

### 16.0 位置づけ

本章はExecution Navigatorで確定したProductionPlanを実行する際のライフサイクルを定義する
正式仕様である。対象は、Step単位の状態確定、中断 / 再開、Candidate Searchの起点、
再計画Previewと採用、Plan破棄、ゲーム内セーブ地点、作成中武器のOwnedWeapon追跡、
Targetとの作成中紐付け、妥協checkpoint、妥協品での終了、理想品完成とTarget完了、
武器切替案内、想定外結果、Undoである。

本章は仕様確定である。永続Entity基盤（Dexie 5 / Export 7）と、calculation schema 12の
Execution Plan契約（16.3 / 16.5 / 16.6 / 16.11のhash、projection、`executionEffects`、Beam Searchのreserve
適用位置と完成時保護）は実装済みである。Execution runtimeのうち、Plan開始（`draft` -> `active`）と
`confirmed_expected` のStep確定（blind観測値入力、`confirm_owned_ideal`、Undo Snapshot生成、最終Stepの
Plan completedを含む）、および想定外結果（`actual_result_different`）・操作内容不明（`operation_uncertain`）の
記録（16.15）、最新ExecutionHistoryのUndo（16.16）、ゲーム内セーブ地点の記録 / 復元（16.9）、
妥協品として確定して終了（16.12）、Plan破棄と16.10のセーブ地点選択、再計画Previewと採用（16.8）の
Runtimeは実装済みである。Execution Navigator UIは正常系（作成開始 / 再開、Step確定、blind観測値入力、
`confirm_owned_ideal`、武器切替案内、妥協checkpointパネルと妥協品での終了、完了表示）と、Execution
Navigator内の想定外結果（「結果が違う」の実結果入力と最新ExecutionHistoryに基づく再同定導線、
「何を何回操作したか分からない」の確認Dialog）と、操作内容不明後のExecution Recovery（16.15の
Recovery Window内の現在位置確認と `operation_count_recovered` の追従Runtime、ゲーム内セーブ地点の復元と
セーブ地点が無い場合のPlan破棄への最小導線）まで接続済みである。
続いて、Execution Navigatorの「実行状態の管理」として、最新ExecutionHistoryのUndo（16.16。表示可否は
Runtimeと同じ判定を共有するread-only helperから導出）、ゲーム内セーブ地点の記録 / 上書き確認 / 直接復元
（16.9。ゲーム側復元の明示確認つき）、active / stale Planの通常のPlan破棄と16.10の3択（破棄前inspectを
authorityとし、セーブ地点への復元と破棄は既存Runtimeの1 transaction）を接続した。
通常のPlan破棄後も、未解決の `actual_result_different`（対象streamの正式なIdentificationがその記録より後に
採用されていない）があれば終了画面で再同定を引き続き案内する（16.15の解決authorityをpure helperとして実装し、
後続の継続表示と共有する。Normal作成のdivergenceは通常アーティアCounterの再同定へ案内する）。
calculation schema 13で、既存武器のTarget紐付けを各Entryの最初の物理Step確定からPlan開始effect
（16.2 / 16.11）へ移し、Production Plan画面での事前表示とともに実装した。
続いて、再計画Previewと採用（16.8）のUIをBuild ListとProduction Plan画面に接続した。対象は永続状態が
active / staleのPlanだけであり、Preview入力はRuntimeの `prepareProductionPlanReplanPreview()` から取り、
既存のPlanner Worker（constrained orchestration、`defaultPlannerOrchestrationBounds`）で計算し、結果は
メモリ上だけの「再計画の試算（未採用）」として通常のPlan内容確認（UI_FLOW 11.0）と同じ形式で表示する
（Plan無し・探索未完了のPreviewは採用不可）。「この再計画を採用」は `inspectProductionPlanReplanAdoption()`
の結果だけで16.10の3択を出し、いずれの選択も `adoptProductionPlanReplanPreview()` 1回で行う。
「最後のゲーム内セーブ地点へ戻す」ではゲーム側復元の明示確認の後に復元だけを行い、同じPreviewは採用せず
再試算を求める。採用成功時は新PlanのExecution Navigatorへ遷移し、`replan_state_changed` ではPreviewを破棄して
再試算を案内する（自動再試算・自動採用はしない）。
Planを壊す変更の警告、
16.15のDashboard / RNG Setup / Candidate Searchでの
RNG再同定の継続表示などは後続の実装PRが
本章をauthorityとして実装する。本章と矛盾する旧記述（Execution上の独立した「確保」操作、
Target / Build List変更による一律stale、reserve時の既存保護維持など）は本改訂で
本書・[REQUIREMENTS.md](./REQUIREMENTS.md)・[DATA_MODEL.md](./DATA_MODEL.md)・
[SEARCH_SPEC.md](./SEARCH_SPEC.md)・[UI_FLOW.md](./UI_FLOW.md)から書き換えた。
矛盾する記述が残っている場合は本章を優先し、差分として報告する。

本章は次を変更しない。

- Production RNG semantics、Counter delta（create normal +1 / forge、conversion Skill +1、
  Reset Skills Skill +1、Reset / Keep Gogma +1）、verification provenance
  （direct observation / category-level adoption / reference parity / unverified）
- Candidate Searchのstream探索、canonical Ideal、intermediate state抽出
- Beam Searchのphysical action sharing、silent fast-forward、conflict、what-if、
  constrained re-searchの各契約（16.3で明示した `reserve_weapon` の適用位置と
  完成時保護を除く）
- 通常UIでSeed / Counter数値を表示しない契約（16.18）

Planner pure calculationはIndexedDBを変更しない。本章のExecution effectは
Application / Persistence層がDexie transactionで適用する。

### 16.1 基本原則: Step単位の確定

RNG状態とNormalArtianCounterはPlan完了時にまとめて更新しない。各ゲーム内物理操作について

```text
ゲーム内で操作
  -> ユーザーが結果を確認
  -> Execution NavigatorでStepを確定
  -> そのStepのrngAdvanceを即時反映
```

とする。Step確定後の永続RngState / NormalArtianCounter / OwnedWeapon / Target execution stateは
「最後にユーザーがExecutionで確定したゲーム状態」を表す。未確定StepのCounter進行、
武器状態、Target状態は永続化しない。

正常系のStep確定は概念的に次の順で、1つのDexie read-write transactionとして原子的に行う。

```text
expectedStateBefore検証（16.5）
  -> ExecutionUndoSnapshot生成（16.16）
  -> RngState / NormalArtianCounter更新（rngAdvance）
  -> OwnedWeapon / TargetWeapon等のExecution effect適用（16.3）
  -> expectedStateAfter検証（16.5）
  -> ExecutionHistory追加
  -> PlanStep完了
  -> currentStepId更新（最後のStepならPlan completed）
```

いずれかが失敗した場合は全体をrollbackし、Step確定前の状態とUIの現在Stepを維持する。
複数Stepを一括確定する操作は提供しない。

### 16.2 Plan status

| status | 意味 |
| --- | --- |
| `draft` | Plannerが生成し、まだ実行を開始していない |
| `active` | 実行中。中断してブラウザやゲームを終了しても `active` のまま |
| `completed` | Plan対象の必要な処理（全Step）が正常に完了した |
| `stale` | 想定外結果、外部状態の不一致などで予測を信用できず、続行できない |
| `abandoned` | ユーザー意思で終了した |

`abandoned` は理由を区別して保持する（[DATA_MODEL.md](./DATA_MODEL.md) 11.1）。

```text
user_abandoned             ユーザーがPlan破棄を実行した
replan_adopted             再計画Previewを採用して新Planへ切り替えた（16.8）
finished_as_compromise     妥協品として確定して終了した（16.12）
breaking_change_approved   Plan前提を壊す手動変更をユーザーが承認した（16.6）
```

`stale` は「Planの前提が壊れたことが検出された」、`abandoned` は「ユーザーが意図して終えた」を
表し、互いに読み替えない。`stale` Planの `recalculationReasons` は、その後に再計画採用や破棄で
`abandoned` へ遷移しても保持する。

制約。

- Planを一時中断するための新しいstatusは追加しない。再開は `currentStepId` から行う
- ゲーム内でセーブして中断しただけではPlanをstaleにしない
- 実行中Plan（`active` または `stale`）は同時に1件まで。別のPlanを開始するには
  再計画採用（16.8）または破棄で現在の実行中Planを終わらせる
- `draft` から `active` への開始時は、現在の永続状態が `PlanningInputSnapshot.initialExecutionState`
  （Plan開始前の前提）と一致することを検証し、同じtransactionでPlan開始effect（16.11の既存武器の
  Target紐付け）を適用し、適用後の状態が先頭Stepの `expectedStateBefore` と一致することを検証する。
  Draftの生成・保存・表示だけでは永続状態を変更しない。開始が拒否・失敗した場合はPlan statusも
  Targetの紐付けも変更しない
- `completed` / `abandoned` への遷移transactionで、そのPlanのゲーム内セーブ地点（16.9）を
  削除し、作成中状態（16.10.1）を解除する（再計画採用時の付け替えは16.8）

### 16.3 Execution projection

#### Planner探索とexecution projectionの分離

BuildCandidate / BuildRoute / RouteOperationの契約は変更しない。新規Normal / 巨戟化直後の
transient武器へのReset / Keep / Reset Skillsは引き続き `sourceOwnedWeaponId = null` であり、
Candidate SnapshotにOwnedWeapon IDを発明しない。Planner探索内部のtransient runtime、
排他source semantics（`consumedWeaponIds`、`same_owned_weapon_consumed`）も探索上の
表現として維持してよい。

一方、ProductionPlanのPlanStepは、ゲーム内の物理武器をOwnedWeapon IDへbindした
**execution projection** を保持する。PlanStepの `ownedWeaponId`、`expectedStateBefore` /
`expectedStateAfter`、`executionEffects` はこのprojectionを表す。projectionはTrace Replay
（11.0）の結果から決定的に作り、Candidate SnapshotやRNG Predictionから別途再構成しない。

#### 追跡するOwnedWeapon

```text
Plan上で今後も識別・加工・再計画の対象として使い続ける物理武器だけを
OwnedWeaponとして永続追跡する。
```

ゲーム上に実在する全武器をOwnedWeapon化する方針は採らない。

- `create_normal_artian` の `count = forgeCount` を1操作単位へ分割したStepのうち、
  最後の1本（巨戟化する作成対象）より前の各Stepは **Counter進行用** である。
  OwnedWeaponへ登録しない。各Step確定ごとにNormal Counterだけを進める
- 最後の1本は **作成対象** である。そのStepの確定時にOwnedWeapon（`kind = "normal"`、
  rarity 8、`normal_artian` scope、`status = null`、`isProtected = false`）として登録し、
  以後同じOwnedWeapon IDを維持する。IDはPlan生成時に `PlannerIdFactory` で予約する。
  名称の初期値は登録時点の対象TargetWeapon名とし、ユーザーは後から変更できる（非semantic）
- predicted variantの作成対象は予測5枠で登録する。blind variantの作成対象は、
  ユーザーがゲーム画面で確認した実際の5枠を入力させ、その観測値で登録する（16.4）
- `convert_normal_to_gogma` は同じIDを `kind = "normal"` から `kind = "gogma"` へ更新する。
  5枠とslot順、`normal_artian` scopeを維持し、予測した初回Series / Group Skillを設定し、
  `status = "unclassified"` とする。所持通常アーティア起点でも同じであり、元IDを削除して
  別のGogma IDを作る方式にしない
- 所持巨戟起点、および上記で追跡中の武器へのReset Bonuses / Keep Bonuses / Reset Skillsは、
  各確定Stepで同じOwnedWeapon IDの実状態を逐次更新する
- Plannerの排他source semanticsは探索上の二重利用防止であり、永続OwnedWeaponの削除を
  意味しない

#### reserve_weaponの扱い

`reserve_weapon` はExecution Navigatorの独立したユーザー操作Stepとして表示しない。
Planner探索内部でCandidate確保を表すactionとして残してよいが、current ProductionPlanの
PlanStepへは変換しない。代わりに、Entryの最後の物理操作Stepの `executionEffects` に
target completion（16.13）を載せ、その物理Stepの確定と同じtransactionで適用する。

このため次を探索契約とする。

- Planner探索内部のreserve actionは、Entryの最後の物理unitの直後に、別actionを挟まず
  適用されたものとして扱う。execution projection上の完成時点と探索上の確保時点を
  ずらさない
- reserve effectは16.13の完成semanticsに従う。新規生成武器だけでなく既存武器も
  `isProtected = true` になるため、完成した武器を同じPlanの後続unitでReset / Keep /
  Reset Skillsの起点にしない
- Planner内部の `selected_checkpoint_not_reached` によるreserve拒否と、required Entry
  （7.5.6）の完成判定は従来どおり有効である

calculation schema 12の実装では、Beam Searchは直前の物理action（とその後に続くreserveだけ）で
Routeが完了したEntryにだけreserveを試みる。reserveしない分岐も通常の後続として残し、その場合その
Entryは以後reserveしない（共有物理actionが別Entryの継続に使われる場合）。操作0 Candidateの
`confirm_owned_ideal` は、RNGを進めないため展開前の初期状態で1 Targetにつき1件適用する。
Trace Replayは探索表現の検証とRNG予測結果の確定だけを行い、PlanStepとexpected stateは
Replay結果からexecution projection（`projectProductionPlanExecution()`）が作る。projectionの最終状態は
確保済みEntryの武器について探索最終状態とsemanticに一致しなければならず、所持Normalの巨戟化だけは
探索側の新規予約IDとprojection側の元IDを対応付けて比較する。

#### executionEffects

PlanStepは次の意味を持つexecution effectを保持する。型名・field名は実装PRで
[DATA_MODEL.md](./DATA_MODEL.md) 11.3の概念型に従って確定する。

| effect | 内容 |
| --- | --- |
| tracked weapon | このStepが操作・登録する追跡武器のOwnedWeapon ID。Counter進行用Normal作成Stepは `null` |
| normal creation role | `create_normal_artian` Stepの `counter_advance` / `production_target` |
| weapon registration | 作成対象Normalの登録内容（blindでは5枠をobservation bindingとする） |
| observation binding | Plan生成時に未知で、Step確定時にユーザー観測値をbindする値（16.4） |
| target link | Plan内で新規登録する作成対象Normalの登録Stepで、Targetの `preferredOwnedWeaponId` を設定する（16.11）。既存武器の紐付けはStep effectではなくPlan開始effect（16.2 / 16.11）である |
| compromise label | 選択済み妥協checkpointへ到達するStepで、追跡武器を `practical` にする（16.12） |
| target completion | Entryの最後の物理Step（操作0では確認Step）で、理想品完成とTarget完了を適用する（16.13） |

`executionEffects` はprojectionの一部としてexpected stateへ反映する（16.5）。statusと
作成中状態はexpected state hashへ入れないが、effectとしては決定的に適用する。

#### 操作0 Candidate

`existing_gogma_current`（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.5.5）のEntryが、Planner開始時に
`active` なTargetの有効Entryとして入力に含まれ、その所持巨戟が現在性能でTargetの理想条件を
満たす場合、Plannerはそれを `already_satisfied` として黙って捨てず、RNGを進めない確認Step
（`confirm_owned_ideal`）を1件生成する。

- `rngAdvance` はGogma / Skill delta 0、`normalCounterDelta = null`
- tracked weaponはその所持巨戟、`executionEffects` はtarget completionだけを持つ
- protectedな武器でもこのStepの対象にできる（性能を変更しないため）
- 物理操作ではないため、武器切替案内（16.14）とweapon switch metric（7.3）の対象外
- 操作0 Candidateを持たない既Ideal Targetの扱い（`all_targets_already_satisfied` 等）は
  従来どおりである

Target登録時・Candidate Search時の通知から、この確認Stepへ至る前にTargetを完了できる導線を
優先する（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 5.5.5、[UI_FLOW.md](./UI_FLOW.md) 8.2）。

### 16.4 Step確定の種類

| 操作 | ExecutionAction | Counter | 武器 / Target | Plan |
| --- | --- | --- | --- | --- |
| 結果一致・次へ | `confirmed_expected` | rngAdvanceを適用 | executionEffectsを適用 | 次Step / completed |
| 観測値を入力して確定 | `confirmed_expected`（`actualResult` に観測値） | rngAdvanceを適用 | 観測値でbindして登録 | 次Step |
| 所持武器で完成を確認 | `confirmed_expected` | 変更なし | target completion | 次Step / completed |
| 結果が違う | `actual_result_different` | rngAdvanceを適用 | 実結果を保存（16.15） | stale |
| 何を何回操作したか不明 | `operation_uncertain` | 変更なし | 変更なし | stale |
| 同じ操作の回数不明から現在位置へ追従 | `operation_count_recovered` | 区間内Stepの `rngAdvance` を順に適用 | 区間内Stepの `executionEffects` をreplay（16.15） | active / completed |
| 妥協品として確定して終了 | `finished_as_compromise` | 変更なし | 16.12 | abandoned |

`secured_weapon` と `skipped_candidate` は独立した確保Stepを持つlegacy Planの記録だけに
現れ、current Executionは生成しない。

#### observation binding（blind Normal作成対象）

Normal Counter未確定などによりblind variant（[SEARCH_SPEC.md](./SEARCH_SPEC.md) 6.1.1）で
作成する通常アーティアの5枠は、Plan生成時に予測しない。

- 作成対象blind NormalのStepは、確定時にゲーム画面で確認した実際の5枠を入力させる。
  入力は所持武器登録と同じEntity Validation（`normal_artian` scope、Production
  availability）を通す
- 入力値は **予測値ではなくユーザー観測値** であり、`ExecutionHistory.actualResult` に
  記録し、その値でOwnedWeaponを登録する。架空の5枠を生成しない
- 観測値が何であっても予測との不一致にはならない（予測が存在しない）。blind Routeは
  続くReset Bonusesで5枠全体を置き換えるため、Plan生成時の後続Stepの予測は変わらない
- Counter進行用のblind NormalはOwnedWeaponへ登録しないため、観測値入力を求めない
- Trace Replayがunknown 5枠を読む操作（Keep、reserve照合）をfail closedにする契約
  （11.0）は変更しない。観測値のbindはExecution時点の永続状態だけを変え、生成済みPlanの
  予測を書き換えない

Plan生成時に未知の観測値は、expected state hashへ値として埋め込まない。16.5の
binding tokenで表す。

### 16.5 Expected execution state

`ExpectedPlanState` は次の4 hashを持つ（[DATA_MODEL.md](./DATA_MODEL.md) 11.2）。

```text
rngStateHash                 変更なし
normalCountersHash           変更なし
ownedWeaponsHash             semantic fieldは変更なし。projectionで登録・更新される武器を含む
targetExecutionStateHash     追加。Plan依存Targetのexecution stateだけ
```

#### Plan依存Target

Plan依存Targetは、`selectedBuildListEntryIds` のEntryの `targetWeaponId` と、全PlanStepの
`targetWeaponId` / `progressedTargetWeaponIds` / `executionEffects` が参照するTargetWeapon IDの
和集合とする。

`targetExecutionStateHash` はPlan依存Targetごとの `id`、`lifecycleStatus`、
`preferredOwnedWeaponId` をID順に安定hash化する。全Targetをhashしない。Plan非依存Targetの
追加・変更はActive Planを壊さないためである。`completedAt` 等の日時は含めない。

Plan開始effect・target link effect（16.11）またはtarget completion effect（16.13）で別Targetの
紐付けを外す場合、Plan依存Targetについては、Planner入力時点の `preferredOwnedWeaponId` からその解除を
projectionで予測し `targetExecutionStateHash` へ反映する。Plan非依存Targetの解除はhashで検証しない。代わりにStep確定
transactionで、link後は「追跡武器を `preferredOwnedWeaponId` に持つTargetはlink先Targetだけである」、
完成後は「完成武器を `preferredOwnedWeaponId` に持つTargetは存在しない」ことをcollection validationで
検証し、解除したTargetのbefore状態をUndo Snapshotへ保存する。

#### 所持武器

- `ownedWeaponsHash` の正規化対象（id、kind、武器種、属性、scope、保存中5枠順、
  isProtected、巨戟のSeries / Group Skill、Normal rarity）は変更しない
- `status` と作成中状態（`executionInProgress`、[DATA_MODEL.md](./DATA_MODEL.md) 7.1）は含めない。
  いずれもCandidate / Plannerの計算に影響しない管理・execution metadataであり、
  Execution transactionが決定的に更新し、Undo / セーブ地点復元が正確に戻す
- 作成対象Normalは登録Stepの `expectedStateAfter` から含まれる。Counter進行用Normalは含まない
- 完成時の `isProtected = true` はsemantic変更としてhashへ反映する

#### binding token

observation bindingを持つ武器の5枠は、Plan生成時のexpected stateで
`{ observationBinding: <binding StepのPlanStep ID> }` というtokenとして正規化する。
tokenはbindingを置き換える操作（Reset Bonuses）の `expectedStateAfter` の直前まで続き、
conversionとReset Skillsはtokenをそのまま通過させる。

実状態のhashを計算するときは、tokenの対象武器について、実際の5枠とscopeが
binding Stepの `ExecutionHistory.actualResult` と完全一致（slot順を含む）する場合だけ
tokenへ置き換える。一致しない場合は実値のまま正規化するため、計画外の編集は不一致として
検出される。binding Stepが未確定の間は、そのStepの `expectedStateBefore` に対象武器は
存在しない。

#### chain validity

#### Plan開始前の前提と先頭Step

calculation schema 13以降は、次の3つを区別する。

```text
PlanningInputSnapshot.initialExecutionState   Plan開始前の永続状態の前提（Planner入力時点）
Plan開始effect（16.11）                        既存武器のTarget紐付け。PlanStepではない
先頭Stepの expectedStateBefore                 Plan開始effectを適用した直後の状態
```

Plan開始effectはTargetの `preferredOwnedWeaponId` だけを変更するため、先頭Stepの
`expectedStateBefore` は `initialExecutionState` と `rngStateHash` / `normalCountersHash` /
`ownedWeaponsHash` が一致し、`targetExecutionStateHash` だけが異なり得る（変更がなければ全て一致する）。
Plan内のchain validity（Step Nの `expectedStateAfter` = Step N+1の `expectedStateBefore`）は変更しない。
calculation schema 12以前のPlanは先頭 `expectedStateBefore` = `initialExecutionState` の契約のまま
保持し、schema 13ではProductionPlanの完全一致判定（`isCalculationContextCompatible()`）により
`calculation_context_changed` でfail closedする。schema 13の変更はCandidate Search、BuildCandidate、
BuildListEntry snapshotの意味を変えないため、version 12のBuildCandidate / BuildListEntryは
build-result互換判定の明示的な `13 -> [12]` 例外によりschema 13でもそのまま利用できる（他の
CalculationContext fieldの一致と通常のstaleness判定は必要。version 1..11は非互換のまま。
ProductionPlanには適用しない）。

### 16.6 Plan依存性とPlanを壊す変更

#### 区別

次はPlanを壊さない。これだけではdraft / active Planをstaleにしない。

- 新しいTargetWeaponを追加する
- Plan非依存Targetを変更・無効化・削除する
- Candidate Searchを実行する（16.7）
- Build Listへ新規Entryを追加する
- Plan非依存EntryのBuild List操作（途中採用状態の変更、削除など）
- 所持武器のstatusだけを変更する
- 名称、memoなど非semanticな項目だけを変更する
- ゲーム内でセーブして中断する

次はPlanの前提を壊し、Planを続行不可にし得る。

- Plan依存Targetの性能定義（`createTargetDefinitionHash()` の対象、16.11）、`priority`、
  検索対象ON/OFF（`isEnabled`）、`lifecycleStatus`、`preferredOwnedWeaponId` を変更する
- Plan依存Entry（`selectedBuildListEntryIds`）の削除、途中採用状態・改善優先の変更
- Planが追跡するOwnedWeapon（execution scope、16.9）のsemantic項目（保護、5枠、Skill、
  武器種、属性など）を計画外で変更、または削除する
- RngState、NormalArtianCounterを手動変更する（RNG Setupの直接入力、Identification Wizardの
  採用、Normal Counter Setupの確定 / 確定解除 / Debug修正）
- CalculationContextが非互換になる
- その他expected stateまたはPlan不変条件を壊す変更

#### UIからの変更

実行中Plan（`active`）がある状態で、UIからPlanを壊す変更を保存しようとした時点で警告する。
ユーザーが承認した場合は、16.10のセーブ地点選択を経て、Planを
`abandoned`（`breaking_change_approved`）にしてから変更を保存する。Plan破棄と変更保存は
同一transactionで行い、片方だけを残さない。キャンセルした場合は何も変更しない。
`stale` Planはすでに続行できないため、この警告を出さずに変更を保存してよい。

実装上の確定事項（Planを壊す変更の承認Runtime PR）。

- RNG Setupの直接保存、Identification Wizardの採用、Normal Counterの保存（確定 / 確定解除 / Debug修正 /
  Identification結果）、OwnedWeapon / TargetWeaponの保存・削除、Build Listの途中採用状態・改善優先の変更と
  Entry削除は、すべて同じguard（`PlanBreakingChangeGuard`）を通る1つのDexie transactionで保存する。
  各変更は「保存時の永続状態 -> 変更後状態」の純関数（変更自身のvalidationと既存の参照保護を含む）として
  表し、guardは変更を先に適用・検証してからPlanの扱いを判定する。Build Listへの新規追加と
  staleness再評価（`isStale` / `staleReasons` のderived metadata）はPlanを壊さないためguardを通さない
- 判定対象は `active` Planだけである。`active` / `stale` のPlanが2件以上ある場合は推測で選ばず拒否する
  （`running_plan_invariant_violated`）。`stale` Planや実行中Planが無い場合は警告せず通常保存し、Plan、
  セーブ地点、ExecutionHistory、作成中状態を変更しない
- 壊すかどうかは変更の主Entityではなく、副作用（優先起点の奪取・解除など）を含む保存後の状態全体で
  判定する（`detectPlanBreakingMutation()`）。判定は既存authorityだけを使う: RngState / Normal Counterは
  `createExpectedPlanState()` の `rngStateHash` / `normalCountersHash`、所持武器はexecution scope
  （`collectExecutionScopeOwnedWeaponIds()`）の武器の同 `ownedWeaponsHash`、TargetはPlan依存Targetの
  `createDependentTargetDefinitionsHash()` と `createTargetExecutionStateHash()`、Build Listは
  `createDependentBuildListEntriesHash()`。理由は既存の `rng_state_changed` / `normal_counter_changed` /
  `owned_weapon_changed` / `target_changed` / `build_list_changed` を警告用に一時的に使うだけで、Planを
  `stale` にせず永続化もしない
- 承認が無い場合は何も保存せず拒否する（`plan_breaking_change_approval_required`、警告の内容となる
  inspectionを保持）。読み取り専用のinspectionは理由、ユーザーが見たPlan（`planId`、`status`、
  `currentStepId`、`updatedAt`）、16.10の選択要否とセーブ地点の `recordedAt` を返す
- 承認はユーザーが見たPlanと16.10の選択を持つ。transaction内で現在のPlanがそのPlanでない（進行、stale化、
  終了を含む）場合は `plan_breaking_change_state_changed`、変更がもうPlanを壊さない場合は
  `plan_breaking_change_approval_not_required` で拒否する。選択要否と選択の検証はPlan破棄と同じ
  `deriveRunningPlanSavePointChoiceRequirement()` / `assertRunningPlanSavePointDecision()` で再導出する
- 「現在地点を維持」（選択が出ない場合を含む）は現在の永続状態へ変更を適用する。「最後のゲーム内セーブ地点へ
  戻す」は `prepareExecutionSavePointRestore()` をそのまま使って復元を先に決め、その復元後の状態へ変更を
  もう一度適用する。変更はユーザーが画面で見た値から変えた項目だけを保存時の状態へ適用する
  （`applyUserChanges()`）ため、復元前に読んだEntity本体（5枠、Skill、優先起点、Counter値、作成中状態、
  lifecycleなど）で復元結果を上書きしない。所持武器は保存時点の `kind` をauthorityとし、復元で同じ
  OwnedWeapon IDが巨戟から通常へ戻った場合も画面で見たvariantの本体を持ち込まない。両variantに共通する
  項目（名称、memo、保護、武器種、属性）の変更だけを適用し、保存時点のvariantが持てない項目（Skill、status、
  5枠とscope、kind）の変更は変換・破棄せず拒否する。保存の戻り値はPlan終了処理後に永続化された本体とする
- どちらも（復元後の）Planを `abandoned`（`breaking_change_approved`）にし、`currentStepId`、Step完了状態、
  `recalculationReasons` を維持し、そのPlan IDの作成中状態を全武器で解除し、セーブ地点を削除する。
  Targetの優先起点は変更自身とその既存の副作用でだけ変わる。ExecutionHistoryは追加しないため、この終了は
  Undoできない（16.16）
- 変更のvalidation失敗、既存の参照保護（`ReferencedEntityDeleteError`）による削除拒否、復元の拒否、
  保存失敗のいずれでも、Plan、変更、セーブ地点、ExecutionHistory、作成中状態のどれも変更しない

実装上の確定事項（Planを壊す変更の事前警告UI PR）。Runtime semanticsは変更していない。

- 対象画面はRNG Setupの直接保存、Identification Wizardの採用、Normal Counter Setupの保存 / 確定解除 /
  Debug修正 / Identification結果の採用、所持武器・目標武器の保存と削除、Build Listの途中採用状態・改善優先の
  変更とEntry削除である。すべて共通のcontroller（`usePlanBreakingChangeApproval()`）と共通Dialog
  （`PlanBreakingChangeDialog`）を通り、画面ごとにDialogを複製しない
- 順序は「操作固有のvalidation・既存確認（優先起点の解除確認、takeover確認、削除確認、調査前状態へ戻した確認）
  -> Application serviceの `inspect` -> `approvalRequired: false` なら通常保存、`true` なら警告 -> 必要なら
  16.10の選択 -> 同じ操作を承認付きで再実行」である。`inspect` は読み取り専用で、警告表示だけでは何も保存しない。
  UIはPlanを壊すかどうかを判定せず、Planを直接abandonせず、セーブ地点を別APIで復元しない
- 警告の内容は `inspection.reasons` だけをauthorityとする（画面やbuttonから理由を決め打ちしない）。承認は
  `{ observedPlan: inspection.observedPlan, savePointDecision }` であり、`planId` / `status` / `currentStepId` /
  `updatedAt` をUI側で作り直さない。inspectionと承認はそのpending mutation専用で、別操作へ流用しない
- 承認無しの保存が `PlanBreakingChangeApprovalRequiredError` を返した場合（inspectと保存の間にactive Planが
  開始した等）は、そのerrorが持つ `inspection` をそのまま警告へ昇格する。Identification Wizard Coordinatorは
  この拒否をadoption errorではなくreview保持のidle状態へ戻す
- `plan_breaking_change_state_changed` / `plan_breaking_change_approval_not_required` /
  `running_plan_invariant_violated` / セーブ地点選択の不一致 / 復元の拒否 / `transaction_failed` は保存せず、
  自動再実行せず、typed codeから日本語で案内し、画面のdraftを可能な限り保持する
- 「最後のゲーム内セーブ地点へ戻す」はゲーム側復元確認（共通の `ExecutionSavePointRestoreDialog`）を必須とし、
  確認後に `restore_save_point` の決定を付けて元の保存を1回だけ実行する。復元・変更保存・Plan破棄は
  `PlanBreakingChangeGuard.apply()` の1 transactionで行われる
- 承認付き保存の成功後は「…実行中の生産計画を破棄しました。」を示し、各画面の関連状態を最新化する（Build Listは
  実行中Planを再読込し、再計画導線を通常の生産計画作成へ戻す）。警告待ちの間は同じ画面で別のguarded変更を
  積まない（Build Listは選択controlと削除buttonを一時無効化し、既存のper-Entry save chainは維持する）
- 永続shape、Calculation semantics、`breaking_change_approved` の意味、Undo / 再計画 / `user_abandoned` の
  各flowは変更していない

#### UIを経由しない不一致

Import、別タブ、保存失敗からの復旧などで警告を経ずに前提が壊れた場合は、次のStep確定時の
検証（12章）で検出し、Planを `stale` にして理由を記録する。

#### PlanningInputSnapshotと不変前提

`PlanningInputSnapshot` は監査用の全体hash（`targetWeaponsHash`、`buildListEntriesHash`）に
加えて、Plan依存Targetのplanning定義hash（`dependentTargetDefinitionsHash`）とPlan依存Entryの
不変項目hash（`dependentBuildListEntriesHash`）を保持する（[DATA_MODEL.md](./DATA_MODEL.md) 11.2）。
`dependentTargetDefinitionsHash` はPlan依存TargetごとのID、`createTargetDefinitionHash()`、
`priority`、`isEnabled` だけを対象とする。`preferredOwnedWeaponId` と `lifecycleStatus` はExecution自身が
正常進行として変更するため、このhashではなくStepごとの `targetExecutionStateHash`（16.5）で検証する。`detectPlanInvalidation()`（12章）の不変前提比較は
全Target / 全Entryではなくこの依存hashで行う。全体hashの差分はDebug表示と
「この生産計画に含まれない目標武器・候補がある」案内だけに使う。

`target_changed` と `build_list_changed` は、Plan依存Target / Plan依存Entryの変更にだけ使う。

### 16.7 Candidate Searchの起点

#### 現在地点（通常Search）

Active Planの有無にかかわらず、Candidate Searchは常に最後にExecutionで確定済みの
現在RngState、現在NormalArtianCounter、現在OwnedWeapon、現在TargetWeaponを起点とする。
Plan開始時Snapshot（`baseSnapshot`）を検索起点にしない。作成中の武器もCandidate Searchの
起点候補として通常どおり扱い、作成中状態を性能判断に使わない。`completed` Targetは
検索対象にしない。

#### 実行中Plan正常完了後（予測）

実行中Planが `active` の場合だけ、追加の検索起点として「実行中Plan完了後（予測）」を
提供する。

- 現在の永続状態から、Active Planの未完了Stepを順に副作用なしで仮想適用した将来状態を
  起点にする。仮想適用はPlanStepに保存済みの `rngAdvance`、`expectedResult`、
  `executionEffects` だけを使い、RNG Predictionを再実行しない
- 前提として、Planが `active`、CalculationContextが互換、現在状態が現在Stepの
  `expectedStateBefore` と一致することを要求する。満たさない場合はこの起点を利用不可とし、
  理由を表示する
- 仮想状態では、Planが完了させるTargetは `completed`、完成武器は `ideal` / protectedになる。
  選択Targetが実行中Planで完了予定なら検索せずその旨を通知する
- 未確定のblind作成対象の5枠は仮想状態でもunknownのままであり、後続Reset Bonusesの
  expected resultで置き換わる。Plan完了時点の完成武器の状態は常に既知である
- 初期版では永続RngState / NormalArtianCounter / OwnedWeapon / TargetWeaponとActive Planを
  変更せず、BuildCandidateを永続保存せず、Build Listへ直接追加できない
- 検索結果には「実行中の生産計画が予測どおり完了した場合の予測」であることを明示する

### 16.8 再計画Previewと採用

実行中PlanにTargetやBuild List Entryを追加しても、自動でPlanを書き換えない。Build List等から
「現在地点から再計画を試算」を実行できる。

#### Preview

- 入力は現在の確定済みRngState / NormalArtianCounter、現在OwnedWeapon、最新TargetWeapon、
  最新Build Listから、通常のPlanner実行と同じ `createPlannerInput()` で作る。Active Planは
  Planner入力に含めない（4章）
- Plannerは通常どおりdraft相当のProductionPlanを計算する（constrained re-searchを含む）
- Preview中、現実行中Planのstatus、`currentStepId`、永続RngState、NormalArtianCounter、
  OwnedWeapon、TargetWeapon、Build Listを変更しない。Preview結果とgenerated Entryを永続化しない

#### 採用

Previewの正式採用は別操作とする。採用時は同一transaction内で次を再検証する。

- 現在のRngState / NormalArtianCounter / OwnedWeaponのsemantic hashが、Preview計算開始時の
  `PlanningInputSnapshot.initialExecutionState` と一致する
- 新Planの依存Target性能定義、依存Entry、CalculationContextがPreview計算時と一致する
- 旧実行中Planのstatusと `currentStepId` がPreview開始時から変わっていない

1つでも変化していれば採用を拒否し、再試算を要求する。正常採用時は

```text
旧実行中Plan（active / stale） -> abandoned（replan_adopted）
新ProductionPlan                -> active
generated BuildListEntry       -> 保存
旧Planのゲーム内セーブ地点      -> 削除（新Planへ引き継がない）
作成中状態                      -> 新Planが同じ武器を追跡する場合は新Plan IDへ付け替え、
                                   追跡しない場合は解除
```

を1つのtransactionで行う。旧PlanのExecutionHistoryは履歴として残す。16.10のセーブ地点選択で
「最後のゲーム内セーブ地点へ戻す」を選んだ場合は採用を中止し、復元後の状態から
再試算を求める（Preview時の状態と一致しなくなるため）。

実行中Planが無い場合は従来どおりDraft Planを作成し、作成開始でactiveにする。

実装上の確定事項（再計画採用Runtime PR）。

- Preview開始時に保持する旧Plan tokenは `planId`、`status`、`currentStepId` だけであり、`updatedAt` は
  採用の一致条件にしない。Preview入力は1つの読み取りtransaction内で通常の `createPlannerInput()` から作り、
  旧Planの `baseSnapshot`・expected state・conflict resolutionを流用しない。Planner計算は既存の
  Planner Worker（constrained orchestration、`defaultPlannerOrchestrationBounds`）で行い、Worker protocolは
  追加しない。Preview（旧Plan token、Planner結果、CalculationContext）はplain dataとしてメモリ上だけに保持し、
  永続化・Exportしない
- 採用は、旧Plan tokenの一致、採用可能な結果（Planがあり、`incomplete` でなく、通常Planner保存と共有する
  save-time検証を満たす）、16.10の選択を先に確認する。現在地点での採用では続けてCalculationContext、
  新Plan IDの非衝突（既存Planを上書きしない）、generated Entryの非衝突と鮮度、generated Entryを加えた
  Build Listに対する新Planの `dependentBuildListEntriesHash` / `dependentTargetDefinitionsHash`、
  `initialExecutionState` を再検証する。全体hash（`targetWeaponsHash` / `buildListEntriesHash`）は採用の
  authorityにしないため、新Planに依存しないTarget / Entryの追加・変更だけでは採用を拒否しない
- 新Planの `active` 化は通常のPlan開始authority（`prepareProductionPlanStart()`）を、旧Planを破棄済みとみなした
  状態に適用して判定する。旧Plan以外の実行中Planがあれば拒否する。新Planとgenerated Entryは追加であり、
  既存レコードを上書きしない
- 作成中状態の付け替え先は、新Planのselected EntryのRouteが参照し、かつ現在存在する所持武器である。
  付け替え時は `startedAt` を維持する。採用だけで作成中でない武器を作成中にせず、Targetの優先起点も
  変更しない。旧PlanのExecutionHistoryは残し、採用のExecutionHistoryは追加しない
- 「最後のゲーム内セーブ地点へ戻す」を選んだ場合は16.9の復元（`prepareExecutionSavePointRestore()`）だけを
  行い、旧Planの破棄、新Plan / generated Entryの保存、作成中状態の付け替え、セーブ地点削除は行わない。
  復元後は旧Plan tokenが一致しなくなるため、同じPreviewの採用は拒否され、再試算が必要になる

### 16.9 ゲーム内セーブ地点

本節の「ゲーム内セーブ地点」は妥協checkpoint（7.5）と別概念である。永続モデル名は
`ExecutionSavePoint`（[DATA_MODEL.md](./DATA_MODEL.md) 12.1）とし、checkpointの語で呼ばない。

#### 記録

- アプリはゲーム側のセーブ発生を推測しない。ユーザーの明示操作
  「ゲーム内セーブ済みとして記録」だけで記録する
- 意味は「ユーザーがゲーム側で現在地点を保存済みであることを確認した」である
- `active` Planについてだけ記録でき、Planごとに最新1件だけを保持する（上書き）
- ExecutionHistoryは追加しない

保持内容。

```text
rngState                 RngState全体
normalCounters           全NormalArtianCounter
ownedWeapons             execution scopeのOwnedWeapon
targetWeapons            execution scopeのTargetWeapon
productionPlan           ProductionPlan全体（currentStepId、status、Step完了状態）
lastExecutionHistoryId   記録時点でそのPlanの最新ExecutionHistory ID（無ければnull）
```

execution scopeのOwnedWeaponは、Plan依存EntryのRouteが参照する所持武器、このPlanの
Executionが登録した武器、このPlanを作成中状態に持つ武器の和集合とする。execution scopeの
TargetWeaponは、Plan依存Targetと、execution scopeの武器を `preferredOwnedWeaponId` に持つ
Targetの和集合とする。

#### 復元

例: Step 12でセーブ地点を記録し、Step 20まで実行した後、ゲームを保存せず終了して
ゲームがStep 12相当へ戻った場合、ユーザー明示操作でアプリもStep 12相当へ戻せる。

- 実行前に「ゲーム側もこの保存地点から再開していること」を確認させる
- `active` または `stale` のPlanについて実行できる
- 復元は1つのDexie transactionで行い、途中失敗時は何も変更しない

#### 復元前検証（fail closed）

復元transactionで書き込みを始める前に、同じtransaction内で現在状態を読み、復元後の
ProductionPlanが必要とするentityがすべて存在することを検証する。必要entityは次である。

- セーブ地点snapshotの `ownedWeapons` の全OwnedWeapon（Plan依存EntryのRouteが参照する所持武器、
  記録時点までにこのPlanが登録した武器、記録時点で作成中の武器）。current Executionは武器を削除しない
  ため、これらの欠損は計画外の削除を意味する
- 復元後のProductionPlanのPlan依存Target（16.5）
- 復元後のProductionPlanの `selectedBuildListEntryIds` のBuildListEntry

1つでも現在のデータに存在しない場合は復元を拒否し、RngState、NormalArtianCounter、OwnedWeapon、
TargetWeapon、ProductionPlan、ExecutionHistory、ExecutionSavePointのいずれも変更しない。
初期版では欠損entityを自動復活させない。UIは[UI_FLOW.md](./UI_FLOW.md) 12.8の案内を表示する。

セーブ地点snapshotの `targetWeapons` のうちPlan依存Targetでないもの（記録時点でscope武器を
preferredにしていたPlan非依存Target）が現在欠損していても、復元を拒否しない。そのTargetは
復元しない（復活させない）。

復元内容（検証成功時だけ）。

- RngState、全NormalArtianCounter、ProductionPlanをセーブ地点の値へ戻す
- execution scopeのOwnedWeaponと必要TargetWeaponをセーブ地点の値へ戻す。Plan非依存Targetは
  現在も存在する場合だけ戻す
- セーブ地点より後のこのPlanのExecutionHistoryが登録した武器を削除する
- セーブ地点より後のExecutionHistoryが変更し、セーブ地点のscopeに含まれないTargetWeaponは、
  そのうち最も古いExecutionHistoryのUndo Snapshotのbefore状態へ戻す
- セーブ地点より後のこのPlanのExecutionHistoryを削除する

復元はExecutionに関係するゲーム対応状態だけを戻す機能であり、アプリ全DBを昔の状態へ戻す
機能ではない。セーブ地点より後に追加したPlan非依存Target、Build List Entry、
execution scope外の所持武器、設定などは巻き戻さない。ユーザーが削除したentityを復活させない。
復元後のPlanに必要なentityが欠損している場合は、復活させず復元自体を拒否する（復元前検証）。

実装上の確定事項（セーブ地点Runtime PR）。

- 記録時は、Planが `active` であることに加え、Step確定と同じ前提検証（current Step、Plan依存Target / Entry、
  `expectedStateBefore` との一致）を満たす場合だけ記録する。乖離した状態をsnapshotしない。
  `lastExecutionHistoryId` はPlanのExecutionHistoryを `compareExecutionHistoryOrder()` で並べた最後の記録とする
- execution scopeの「Plan依存EntryのRouteが参照する所持武器」は `referencedOwnedWeaponsHash` と同じRoute参照
  authority（`collectReferencedOwnedWeaponIds()`）で導出する。「このPlanのExecutionが登録した武器」は現在残っている
  ExecutionHistoryの `addedOwnedWeaponIds` のうち現存する武器とする。snapshotはID順に保持する
- 復元要求は表示中セーブ地点の `recordedAt` を指定し、transaction内で現在のセーブ地点と一致しなければ拒否する。
  別タブ等で上書きされた、ユーザーが見ていないセーブ地点を代わりに復元しない
- 境界（`lastExecutionHistoryId`）の記録が存在しない、または別Planの記録である場合、nullとみなさず拒否する。
  境界より後（`compareExecutionHistoryOrder()` で境界より大きい記録）だけを「セーブ地点より後」とする
- ExecutionSavePointは、本節で定義したexecution scope（Plan依存EntryのRoute参照武器、このPlanのExecutionが
  登録した武器、作成中の武器、Plan依存Target、scope武器を `preferredOwnedWeaponId` に持つTarget）を完全に含む
  必要がある。記録時と復元時は同じscope定義で検証し、復元時もscope完全性を再検証する。不足は現在値から補完せず
  拒否する（`save_point_snapshot_invalid`）
  - 復元時の「記録時点の状態」は、snapshot内のentityはsnapshot本体、snapshot外のentityはセーブ地点より後で
    最も古いExecutionHistoryのUndo Snapshotのbefore状態（無ければ現在値）とし、`updatedAt` が `recordedAt`
    以前のものだけを記録時点に存在した状態とみなす。境界以前のExecutionHistoryが登録した武器と、snapshot Planの
    完了済みStepの追跡武器（`executionEffects.trackedOwnedWeaponId`）もscopeとして要求する。未実行Stepの
    追跡武器は要求しない。これは完全性の検出だけに使い、復元値には使わない
  - snapshot完全性（`save_point_snapshot_invalid`）と、復元後Planに必要なentityの現在の存在
    （`save_point_required_entity_missing`）は別の検証である。snapshotに含まれるPlan非依存Targetが現在削除
    されていることは、どちらの拒否理由にもしない
- snapshot Planが `active` でない、またはセーブ地点より後に登録された武器がsnapshotに含まれる場合は拒否する
- 復元値はsnapshot本体そのものであり、RNG予測の再実行、Counter差分の逆算、timestampの付け直しをしない。
  NormalArtianCounterはcollection全体を置き換える。書き込み前に復元後のentity、Target優先起点collection、
  セーブ地点とその参照（残すExecutionHistoryに対して）を検証する
- 復元成功後もセーブ地点は変更せず残す。記録・復元のいずれもExecutionHistoryを追加しない

#### 失効

- Undo（16.16）がセーブ地点の `lastExecutionHistoryId` のExecutionHistoryを取り消した場合、
  同じtransactionでセーブ地点を削除する
- Planが `completed` / `abandoned` になったtransactionで削除する
- 再計画採用で新Planへ引き継がない

### 16.10 Plan破棄時のセーブ地点選択

セーブ地点より後までPlanを実行した後に、Planを破棄する操作（Plan破棄、再計画採用、
Planを壊す変更の承認）を行う場合、ゲーム側でユーザーが現在地点を保存して続けるのか、
過去のセーブ地点へ戻るのかをアプリは判別できない。そのため次を選ばせる。

```text
現在地点を維持
最後のゲーム内セーブ地点へ戻す
キャンセル
```

- 「最後のゲーム内セーブ地点へ戻す」は16.9の復元を行ってから破棄操作を続ける。
  Planを壊す変更の承認では、復元 -> Plan破棄 -> 変更保存の順とする。
  再計画採用だけは16.8のとおり採用を中止する
- セーブ地点が存在しない場合、またはセーブ地点の後にこのPlanのExecutionHistoryが無い
  （現在位置と同じ）場合は選択を出さない
- 妥協品として確定して終了（16.12）は、現在の武器状態を確定する操作なので選択を出さない
- アプリ側でゲームの保存状態を推測しない

実装上の確定事項（Plan破棄Runtime PR）。

- 選択要否は再計画採用・Planを壊す変更の承認でも共有するpure helper
  （`deriveRunningPlanSavePointChoiceRequirement()`）で導出する。境界の解釈はセーブ地点復元と同じ
  authority（`compareExecutionHistoryOrder()`、境界記録の欠損 / 別Planは拒否）を使い、挿入順を使わない
- Plan破棄（`user_abandoned`）は `active` / `stale` のPlanだけを対象とする。Planの終了でありExecutionの
  継続ではないため、「現在地点を維持」（選択が出ない通常破棄を含む）はCalculationContext非互換の
  `stale` Planでも実行できる。「最後のゲーム内セーブ地点へ戻す」は16.9の復元契約（CalculationContext
  互換性とfail-closed条件を含む）をそのまま適用し、復元が拒否された場合はPlanを破棄しない
- 破棄要求は、確認時にユーザーが見たPlanの `status`、`currentStepId`、`updatedAt` を指定し、
  transaction内で一致しなければ拒否する。選択要否はtransaction内で再導出し、選択が必要なのに選択が
  無い場合、選択が不要なのに選択がある場合、選択が指すセーブ地点の `recordedAt` が現在と異なる場合は
  いずれも拒否する。「キャンセル」はServiceを呼ばないことであり、永続actionを持たない
- 「現在地点を維持」は現在の永続状態を基準に、Planだけを `abandoned`（`user_abandoned`）へ遷移させる。
  `currentStepId`、Step完了状態、`recalculationReasons`、ExecutionHistory、Targetの優先起点を保持する
- 「最後のゲーム内セーブ地点へ戻す」は16.9の復元結果（セーブ地点より後の記録と登録武器の削除を含む）を
  基準に、snapshot PlanをPlanとして `abandoned`（`user_abandoned`）へ遷移させる。`recalculationReasons`
  はsnapshot Planの値であり、復元で消えた後続のstale理由を現在Planから再注入しない
- どちらも当該Plan IDの作成中状態を全武器で解除し（他Planの作成中状態は変更しない）、セーブ地点を
  削除し、ExecutionHistoryを追加しない。破棄自体はUndo対象外である（16.16）

#### 16.10.1 作成中状態

作成中かどうかは `OwnedWeapon.status` と直交した内部状態 `executionInProgress`
（[DATA_MODEL.md](./DATA_MODEL.md) 7.1）で表す。`status` に `in_progress` 等を追加しない。

- ON: Executionが作成対象Normalを登録したStep、または既存武器に対するそのEntryの最初の
  実ゲーム操作（conversion、Reset Bonuses、Keep Bonuses、Reset Skills）を確定したStepで、
  Plan IDを設定する。OwnedWeaponはTargetWeaponを参照しないため、Target IDは持たない
  （対応する目標武器はPlanの追跡情報とTarget側の `preferredOwnedWeaponId` から導出する）
- OFF: 理想品完成、妥協品として終了、Planの `completed` / `abandoned` 遷移。再計画採用では
  16.8の付け替えを行う。`stale` への遷移では変更しない
- ユーザーは直接編集できない
- Candidate Searchの武器性能判断、Search route eligibility、Planner入力、semantic hashに使わない
- Execution consistency、Undo、セーブ地点復元では正確に追跡・復元する

### 16.11 Targetとの作成中紐付け

#### 自動設定

Planner計算とDraft Planの生成・保存・表示では `preferredOwnedWeaponId` を変更しない。Planは
「どの既存OwnedWeaponをどのTargetの作成起点に使うか」を決めるだけであり、その反映は次の2経路に限る。

- **Plan開始effect（既存武器）**: Planの選択Entry（`selectedBuildListEntryIds`）のうち、Routeが既存の
  OwnedWeapon（`BuildRoute.sourceOwnedWeaponId`。所持Normal / 所持Gogma）から始まり、1操作以上を行う
  Entryについて、そのTargetをその武器へ紐付ける。Production Plan画面の「作成開始」
  （`draft -> active`）と同じtransactionで適用する。再計画採用（16.8）で新Planを開始する場合も同じ
  effectを同じtransactionで適用する。操作0 Entry（`confirm_owned_ideal`）は紐付けず完成だけを行う
- **登録Step（新規作成対象Normal）**: Plan内の `create_normal_artian` で新規登録する作成対象Normalは
  Plan開始時に存在しないため、Plan開始時には紐付けない。その登録Step（blindでは観測値入力による確定）の
  transactionで `executionEffects.targetLinks` によりTargetへ紐付ける。Counter進行用Normalは登録も
  紐付けもしない

Target AをOwnedWeapon Xへ紐付ける場合、別のTarget BがXを優先起点にしていれば
`Target B.preferredOwnedWeaponId = null` と `Target A.preferredOwnedWeaponId = X` を同じtransactionで
行う。Target Aが別の武器を優先起点にしていた場合もXへ置き換える。既にXなら変更も更新日時の書き換えも
しない。途中状態は永続化しない。

Plan開始effectの紐付けは、Planの選択Entryから決定的に導出する（永続fieldを追加しない）。選択Entryの
内容は開始時に `dependentBuildListEntriesHash` で不変を検証するため、Production Plan画面の事前表示、
Plan開始のRuntime、execution projectionは同じ導出authorityを共有する。preferredの関係は1:1であるため、
1つの既存武器を複数の選択Entry（別Target、共有物理actionによる）が起点にする場合、および1つのTargetを
複数の武器へ紐付けることになる場合は、Planがその武器の起点Targetを1つに決めていないため紐付けない
（順序で1つを選ばない）。

Production Plan画面は、Draft Planの表示時に「作成開始」で実際に変わる紐付け（武器、現在の紐付け先
Target または未設定、紐付け先Target、紐付け先Targetがそれまで優先していた武器）を事前表示する
（[UI_FLOW.md](./UI_FLOW.md) 11）。既に同じ紐付けで変更がないものは表示しない。変更予定を確認できるまで
（確認中・確認失敗時）は「作成開始」を受け付けず、失敗時は再確認できる。この表示は読み取り専用で
あり、「作成開始」はtransaction内で最新の永続状態から改めて導出・検証して適用する。表示結果を書き込みの
authorityにしない。Execution Navigatorの通常Stepでは、紐付けの移動を改めて通知しない。

この自動設定はExecutionだけの経路である。Planner計算、Candidate Search、`reserve_weapon`
（探索内部action）は引き続き `preferredOwnedWeaponId` を変更しない。紐付けはPlan破棄・妥協品での終了
後も残し、外したい場合はユーザーがTarget Weapons画面で変更する。1 Target 1武器、1武器1 Target、
非保護、武器種・属性一致のcollection validation（[DATA_MODEL.md](./DATA_MODEL.md) 8.5）は
自動設定後も満たされなければならない。

#### Build List stalenessとplanning preferenceの分離

`preferredOwnedWeaponId` の責務を次のとおり分離する。

```text
BuildCandidate / BuildListEntry validity
  preferredOwnedWeaponIdをTarget性能定義として扱わない
  -> createTargetDefinitionHash() の対象外。変更してもtarget_definition_changedにしない

Planner / Draft Planのplanning input
  preferredOwnedWeaponIdをplanning inputとして扱う（7.4、SEARCH_SPEC 8.1）
  -> PlannerInput.targetWeapons、PlanningInputSnapshot.targetWeaponsHashに含める

Active Plan Execution
  Execution自身による設定・付け替え・完成時解除は正常進行
  -> targetExecutionStateHash（16.5）で期待どおりか検証する
```

Candidateの意味そのものと、Plannerがどの起点武器を優先するかを混同しない。preferredを変更した
後の再検索でcanonical Idealのtie-breakが変わり得るが、既存Entryは有効なIdeal Routeのままであり
staleにしない。`lifecycleStatus` も性能定義ではないため `createTargetDefinitionHash()` の
対象外とする。

#### TargetWeapon fieldの責務

`createTargetDefinitionHash()` はCandidateの成立と意味を決めるTarget性能定義だけを表す。
正規化対象のfield集合を次に固定する。

```text
含める:
  weaponTypeId
  elementId
  Ideal bonus条件（idealBonuses）
  Practical bonus条件（practicalBonusConditions）
  Alternative bonus条件（alternativeBonusRules）
  Ideal skill条件（idealSkillCondition）
  Practical skill条件（practicalSkillCondition）

含めない:
  priority
  isEnabled
  preferredOwnedWeaponId
  lifecycleStatus
  completedAt
  completedByProductionPlanId
  name
  memo
  timestamps
  （旧Target移行の案内flag `compromiseNeedsReview` などの表示用metadata）
```

calculation schema 11以前の `createTargetDefinitionHash()` は `priority`、`isEnabled`、`preferredOwnedWeaponId` を
含んでいた。calculation schema 12でこの集合へ正規化し、version境界（16.17）とともに適用した。

各fieldの責務は次のとおりである。

| field | Candidate / BuildListEntry validity | Search | Planner / Draft Plan planning input | Active / Draft Planの前提検証 |
| --- | --- | --- | --- | --- |
| 性能定義（上記「含める」） | `createTargetDefinitionHash()`。変更で `target_definition_changed` | 条件評価 | `targetWeaponsHash.definitionHash` | `dependentTargetDefinitionsHash` |
| `priority` | 含めない。変更してもstaleにしない | 使わない | Plannerの計画順・scoreへの入力。`targetWeaponsHash` に含める | `dependentTargetDefinitionsHash`。Plan依存Targetの変更はPlan前提変更（`target_changed`） |
| `isEnabled` | 含めない。変更してもstaleにしない | `false` のTargetは検索しない（入力validation） | `false` のTargetとそのEntryを入力から除外。`targetWeaponsHash` に含める | `dependentTargetDefinitionsHash`。Plan依存Targetの変更はPlan前提変更（`target_changed`） |
| `preferredOwnedWeaponId` | 含めない。変更してもstaleにしない | 同一コスト間のtie-break（SEARCH_SPEC 8.1） | 起点優先のplan preference（7.4）。`targetWeaponsHash` に含める | `targetExecutionStateHash`（Plan依存Targetだけ）。Executionの紐付け・解除は正常進行、それ以外の変更はPlan前提変更 |
| `lifecycleStatus` | 含めない。`completed` のEntryはstaleではなく入力から除外 | `completed` は検索しない | `completed` のTargetとそのEntryを入力から除外。`targetWeaponsHash` に含める | `targetExecutionStateHash`（Plan依存Targetだけ）。Executionの完了は正常進行、それ以外の変更はPlan前提変更 |
| `completedAt` / `completedByProductionPlanId` / `name` / `memo` / timestamps | 含めない | 使わない | 含めない | 検証しない |

Plan依存Targetの `priority` / `isEnabled` / 性能定義をUIから変更する場合は、16.6の事前警告の対象である。
Plan非依存Targetの同じ変更はPlanを壊さない。

### 16.12 妥協checkpoint

Build Listでユーザーが明示選択した妥協checkpoint（7.5）へExecutionが実際に到達した場合、
そのmilestoneを持つStepの確定transactionで、追跡武器を `status = "practical"` にする。

- 選択していない状態へ性能上たまたま到達しても、Bonus / Skill性能だけを見て自動でPracticalに
  しない
- Practicalになっても作成中状態は継続し、`isProtected` は変更しない。Planはそのまま理想品へ進む
- 開始時点で到達済みのcheckpoint（7.5.2）は、そのEntryの最初の物理Stepの確定transactionで
  `practical` にする（statusは非semanticなので時点の差はPlan検証に影響しない）

#### 「この武器を妥協品として確定して終了」

checkpoint到達後（開始時点到達済みの場合はそのEntryの最初の物理Stepの前）、Execution
Navigatorは次を選べる。

```text
次の操作へ進む
この武器を妥協品として確定して終了
```

後者は確認ダイアログ必須とし、次の意味を伝える。

```text
この武器を妥協品として確定し、現在の生産計画を終了します。
残りの作成手順は実行されません。
未完了の目標武器がある場合は現在状態から再計画できます。
```

確定時は1つのtransactionで次を行い、`finished_as_compromise` のExecutionHistoryを追加する。

```text
OwnedWeapon.status             = practical
作成中状態                      = OFF（Planの他の作成中武器も16.10.1によりOFF）
Target                         = 未完了のまま（lifecycleStatus = active）
Targetとのpreferred紐付け      = 維持
ProductionPlan                 = abandoned（finished_as_compromise）
ゲーム内セーブ地点              = 削除
```

TargetのIdeal条件自体は変更しない。後日そのPractical武器を起点に再びIdealを目指せる。

実装上の確定事項（妥協品終了Runtime PR）。

- 終了要求は、ユーザーが提示を見た時点のPlanのcurrent Step ID、対象BuildListEntry ID、Target ID、
  OwnedWeapon IDを指定する。どれもauthorityとしては扱わず、transaction内でPlan自身のcheckpoint
  projectionと突き合わせて再検証する。表示後に別のStepが確定していれば拒否する
- 実行できるのは `active` なcurrent Execution契約Planだけである。`stale` Planは、予測と現在状態が
  乖離しているため「選択済みcheckpointへ到達済み」を推測せず拒否する
- 終了できるのは、選択済みcheckpointへ過去に到達したことではなく、**現在もそのcheckpoint状態を
  保持している**場合だけである。提示は「次の操作へ進む」と並ぶ選択肢なので、続行してその武器へ
  次の操作を行った時点で終了対象外になる
  - 通常のcheckpointは、妥協labelを持つStepが確定済みで、かつそれより後に**同じ追跡武器**を
    対象とするStepが1つも確定していない間だけ保持中とする
  - 開始時点到達済みcheckpoint（7.5.2）は、そのEntryの最初の物理Step（= そのcheckpointをlabelする
    Step）を確定するまで保持中とする。`isIntermediatePinHeldAtRouteStart()` はEntry定義として
    恒久的にtrueなので、単独では終了可否に使わない
  - 境界はPlan全体の進行ではなく追跡武器である。別EntryのStepが別武器に対して確定しても、
    この武器の状態は変わらないため終了可否に影響しない
- 到達判定のauthorityは `BuildListEntry.intermediateStateSelection`、Planの
  `executionEffects.compromiseLabels`、およびPlan StepのExecution進行状態
  （`executionEffects.trackedOwnedWeaponId`、Step順、`isCompleted`）であり、武器性能をその場で
  再評価しない。未選択のcheckpointへ性能上到達しただけ、選択済みcheckpoint未到達、既に通過済み、
  別EntryのIDはいずれも拒否する
- 対象OwnedWeaponはPlanの妥協label effectが持つIDだけであり、`preferredOwnedWeaponId` や
  `status = practical` の検索、性能一致からは決めない
- ExecutionHistoryは `wasExpected = true`、`recalculationReason = null`、`actualResult = null` とする。
  ユーザーの明示的な意思決定であり、Planを `stale` にせず `abandoned` にするためである。
  `createdAt` はPlanの `abandonedAt` と一致させ、16.16のUndoが終端遷移の原因記録として認識できるようにする
- `currentStepId` とStep完了状態は終了直前のまま保持し、未実行Stepを完了扱いにしない
- 書き込み前に、Plan終了後に当該Plan IDの作成中武器が残らないこと、対象武器がPracticalであること、
  変更entityとTarget優先起点collectionが妥当であることを検証し、不正なら何も書かない

### 16.13 理想品完成とTarget完了

新規武器 / 既存武器を問わず、Entryの最後の物理Stepが期待どおり確定し理想品が完成した場合、
同じtransactionで次を行う。

```text
OwnedWeapon                          Candidate結果（5枠、scope、Series / Group Skill）
OwnedWeapon.status                   = ideal
OwnedWeapon.isProtected              = true（既存武器でも保護する）
作成中状態                            = OFF
TargetWeapon.lifecycleStatus         = completed（completedAt、完了Plan IDを記録）
TargetWeapon.preferredOwnedWeaponId  = null
完成武器をpreferredにしている他の全Target.preferredOwnedWeaponId = null
```

#### 完成時の他Target preferred解除

`TargetWeapon.preferredOwnedWeaponId` が指せるのは非保護武器だけである（[DATA_MODEL.md](./DATA_MODEL.md)
8.5）。OwnedWeapon Xを理想品完成でprotectedにする場合は、次を同一transactionで行う。

- 完成対象Targetの `preferredOwnedWeaponId` を `null` にする
- Xを `preferredOwnedWeaponId` に持つ他のすべてのTargetの `preferredOwnedWeaponId` も `null` にする

解除するのは `preferredOwnedWeaponId` だけである。他Targetの性能条件、`priority`、`isEnabled`、
`lifecycleStatus` を変更しない。この契約は次のすべてに適用する。

- Executionのtarget completion（最後の物理Step）
- `confirm_owned_ideal` Step
- Target Weapons画面の「この武器で目標を完了にする」（[UI_FLOW.md](./UI_FLOW.md) 8.2）

Executionで解除した他Targetは、`ExecutionUndoSnapshot.affectedTargetWeaponsBefore` にbefore状態を
保存し、Undoで正確に戻す。ゲーム内セーブ地点のexecution scopeには、記録時点でXをpreferredに
持つTargetが含まれる（16.9）。記録後にXをpreferredにしたTargetは、セーブ地点より後の
ExecutionHistoryのUndo Snapshotから復元する（16.9の復元手順）。Plan依存Target / Plan非依存Targetの
hash上の扱いは16.5に従う。完成transaction後、Xを優先起点に持つTargetが残っていればcollection
validation違反としてtransaction全体をrollbackする。

- Ideal完成は「目標武器が手に入った」ことを意味する。TargetWeaponは物理削除せず、
  履歴とProductionPlan参照のためレコードを保持する
- `completed` Targetは通常の目標武器一覧から除外し、Candidate Search対象外、Planner対象外とする
  （Planner入力validationでそのEntryを除外して理由を返す。warning kindは実装PRで5章へ追加する）
- 完成武器はprotectedになるため、preferredを解除して「protected武器を優先起点にしない」
  契約と整合させる
- 妥協品での終了ではTargetを `completed` にしない
- 全Stepが完了したtransactionでPlanを `completed` にする
- 同じ武器が性能上ほかのactive Targetも満たしても、自動で `completed` にするのはそのEntryの
  Targetだけである。他Targetには操作0 Idealの通知導線（16.3）を使う

### 16.14 武器切替案内

連続する物理操作Stepで対象OwnedWeaponが変わる場合、Execution Navigatorは

```text
作業する武器を「○○」へ切り替えてください
```

という案内を挟み、ユーザー操作「武器を切り替えました」で現在Stepの表示へ進む。

- 判定対象はtracked weaponを持つ `convert_normal_to_gogma` / `reset_bonuses` / `keep_bonuses` /
  `reset_skills` Stepである。`create_normal_artian` と `confirm_owned_ideal` は判定対象にしない
- 直前の対象は、このPlanで最後に完了した判定対象Stepのtracked weaponである。無い場合
  （Plan最初の判定対象Step）も案内を出してよい
- PlanStepではない。RNG Advance、Counter変更、Inventory変更、ExecutionHistory、Undo対象、
  Planner cost、`maxPlanSteps` のいずれにも含めない
- 隣接する物理Stepのtracked weapon差分からExecution UIが導出するpresentation-only stepである。
  ブラウザ再開時に再表示されても安全であり、「武器を切り替えました」の状態を永続化しない
- Plannerのweapon switch metric（7.3）の定義は変更しない

### 16.15 想定外結果

#### 操作は正しいが結果だけ予測と違う

例: Reset Bonusesは1回行ったが、出た5枠が予測と違う。

実際に操作したことが明確なら、その操作のCounter消費は実状態へ反映する。

- `rngAdvance` を適用する
- 追跡武器の実結果（5枠とscope、Series / Group Skill）をOwnedWeaponへ保存する。作成対象
  Normalなら実結果で登録し、登録Stepのtarget linkと作成中ONは通常どおり適用する
- compromise labelとtarget completionは適用しない（期待状態に到達していない）
- `ExecutionHistory` に `actual_result_different` と `actualResult` を記録する
- Planを `stale`（`unexpected_result`）にし、以降のStepの予測を使わない
- RNG再同定へ誘導する。Gogma / Skillの不一致はIdentification Wizard、Normalの不一致は
  Normal Counter Setupを案内する

RNG実装不具合、ゲーム仕様漏れ、Master漏れ、Seed / Counter同定不良などがあり得るため、
自動で再計画しない。

実装上の確定事項（想定外結果Runtime PR）。

- 操作自体は実行済みのため、対象Stepは `isCompleted = true` とし、`currentStepId` は次の最初の未完了Step
  （最後のStepなら `null`）へ進める。最後のStepでもPlanは `completed` にしない（`stale`、`completedAt = null`）
- 実結果は操作の結果契約（[DATA_MODEL.md](./DATA_MODEL.md) 11.4）に従う。Normal作成は `normal_artian` scopeの5枠、
  Reset / Keep Bonusesは `gogma_artian` scopeの5枠、conversion / Reset SkillsはSeries / Group Skillだけを受け付ける。
  conversionは同じOwnedWeapon IDを5枠とscopeを保ったまま `gogma` へ更新し、Reset Skillsは5枠を変更しない
- Counter進行用Normalの実結果はOwnedWeaponへ登録せず `actualResult` にだけ記録する
- 予測を持たない操作（blind作成対象Normal、`confirm_owned_ideal`）と、Plan予測と一致する結果は
  `actual_result_different` として受け付けない。blind作成対象の観測値は `confirmed_expected` で記録する
- 結果の武器は所持武器保存と同じEntity Validation（Master / Production availability）を通し、Counter進行用Normalの
  5枠も対象Targetの武器種・属性で同じ検証を通す
- `expectedStateBefore` は検証し、`expectedStateAfter` は比較しない。ゲーム内セーブ地点は削除しない

#### 何を何回操作したか自体が不明

例: Resetを2回押したかもしれない、別操作をしてしまった、アプリ確定前に複数回進めた。

記録（`operation_uncertain`）の意味。

- Counterを推測しない。RngState、NormalArtianCounter、OwnedWeapon、TargetWeaponを変更しない
- 対象Stepは未完了のまま、`currentStepId` も変えない。ゲーム内セーブ地点も変えない
- `ExecutionHistory` に `operation_uncertain` を記録する
- Planを `stale`（`execution_operation_uncertain`）にする

記録後の回復（Execution Recovery）。

通常のRNG同定（Identification Wizard / Normal Counter Setup）は、追加のReset等をゲーム内で行って
観測を集める調査手順である。実行中Planの途中でそれを使うと、回復のためにPlan外の操作でゲーム状態を
さらに進めることになる。また「ResetのつもりでKeepした」「別の武器を操作した」はCounter位置の推測では
なくPlan外のゲーム状態変更である。したがって `operation_uncertain` の記録後は通常のRNG同定へ直接
誘導せず、Execution Navigatorで次のどちらに近いかをユーザーに選ばせる。

- **同じ操作を何回行ったか分からない**（操作種類と操作した武器は分かっていて、回数だけが分からない）:
  現在位置の確認（Current Position Recovery）。ゲーム内セーブ地点があれば、その復元も同時に選べる。
  どちらを使うかはユーザーが選び、現在位置の確認を強制しない
- **別の操作・別の武器を操作してしまった**: 現在位置の確認は提示しない。Counterだけ合わせれば済む
  保証がないためである。ゲーム内セーブ地点があればその復元（16.9）を案内し、無ければPlan破棄（16.2）を
  案内する

##### Recovery Window

Current Position Recoveryが追従してよい範囲は、現在Step（`operation_uncertain` を記録したStep）から
Plan順（`ProductionPlan.steps` の配列順。`currentStepId` と未完了Stepの決定と同じ順序）に連続する、
**同一の物理操作identity** を持つ未完了Stepの区間 `W = [w1 .. wn]`（`w1` が現在Step）である。
これをRecovery Windowと呼び、Planどおりの同じ操作だけで現在のゲーム状態を説明できる範囲そのものである。

物理操作identityは次のすべてが一致することである。

- `operationType`
- 物理対象: `executionEffects.trackedOwnedWeaponId`（Counter進行用Normalでは `null` 同士）
- Counter stream: `reset_bonuses` / `keep_bonuses` はGogma Counter、`convert_normal_to_gogma` /
  `reset_skills` はSkill Counter、`create_normal_artian` は `rngAdvance.affectedNormalCounterId` の
  Normal Counter
- `create_normal_artian` では `executionEffects.normalCreationRole` も一致すること。Counter進行用から
  作成対象Normal登録への意味の境界は、同じNormal Counter streamでも越えない

Windowに入るStepは、比較できる予測結果を持つことも条件とする。

- `executionEffects` を持つ現行Stepである（legacy Stepは入らない）
- `executionEffects.observationBinding === null`（blind作成対象Normalは予測5枠が無いため入らない）
- `expectedResult` が操作の結果契約（[DATA_MODEL.md](./DATA_MODEL.md) 11.4）の比較項目を持つ。
  Normal作成は `normal_artian` scopeの5枠と `affectedNormalCounterId`、Reset / Keep Bonusesは
  `gogma_artian` scopeの5枠、conversion / Reset SkillsはSeries / Group Skill
- `confirm_owned_ideal` はゲーム操作ではないため入らない

`executionEffects.targetCompletions` を持つStepはWindowの最後のStepになる（完成した武器は保護され、
同じ物理操作は続かない）。現在Step自体がWindowに入らない場合（blind作成対象Normal、比較できる予測が
無いStep）はCurrent Position Recoveryを適用しない。Recovery WindowはPlan外へ一切広げず、
Plan全体を検索しない。Window外のStepで現在結果が一致しても候補にしない。現在ツールが確定済みの位置より
前も検索しない。ゲームが以前の状態へ戻っている可能性はゲーム内セーブ地点の復元の責務である。

Reset BonusesとKeep BonusesはどちらもGogma Counterを1進める（RNG_SPEC、`advanceGogmaCounter`）。
WindowのStepは各自の記録済み `rngAdvance` を持ち、Keepを含めてCounter進行なしとして扱わない。

##### 位置と観測

Window内の位置 `p`（`0 <= p <= n`）は「Windowの先頭から `p` 個のStepをゲームで実行済み」を表す。
位置 `p` の結果は、`p >= 1` なら `w_p.expectedResult`、`p = 0` なら現在位置のbaseline結果である。

baseline結果（現在永続化されている位置そのもの）は、安全に導出できる場合だけ定義する。

- Reset / Keep Bonuses: 追跡武器（Gogma）の現在の5枠が `gogma_artian` scopeならその順序付き5枠
- Reset Skills: 追跡武器（Gogma）の現在のSeries / Group Skill
- conversion: 定義しない（追跡武器はまだNormalであり、観測するSkillが存在しない）
- Normal作成: Plan順で直前のStepが完了済みの予測ありNormal作成で `affectedNormalCounterId` が同じであり、
  かつPlanのExecutionHistory順で `operation_uncertain` 記録の直前の記録がそのStepの `confirmed_expected`
  （`actualResult = null`）である場合だけ、そのStepの `expectedResult` の5枠（`normal_artian`）

baselineを安全に導出できない場合は架空値を作らず、位置0を候補に含めない。

観測はユーザーがゲーム画面で確認した現在の結果である。

- Reset / Keep Bonuses: 現在表示されている復元ボーナス5枠（順序付き、scopeは `gogma_artian` 固定）
- conversion / Reset Skills: 現在のSeries / Group Skill（`null` は「スキルなし」の明示入力）
- Normal作成: 最後に作成した通常アーティアの5枠（scopeは `normal_artian` 固定）

照合は完全一致である。5枠は順序付き5枠とscope、Skillは `seriesSkillId` と `groupSkillId` の両方を
比較する。この比較はpure Domain helperが唯一のauthorityであり、RNG Predictionを再実行しない。

観測列 `o1 .. om` に対し、候補 `k` は `k + m - 1 <= n` かつ全 `j` で「位置 `k + j - 1` の結果が
定義されていて `o_j` と一致」する位置である。候補 `k` の現在位置は `k + m - 1` である。
候補はWindow全体（`p = 0 .. n`）で求める。照合は保存済みの結果列の比較だけでRNGの計算を伴わないため、
UIで範囲を段階的に広げる必要はなく、hard boundは常にRecovery Windowである。

- 候補がちょうど1件: 現在位置を一意に特定できた。確定すれば後述のreplayでアプリ状態をその位置まで
  追従させる
- 候補が2件以上: 残る全候補 `k` について「次に行う操作 `w_{k+m}`」がWindow内に存在する（`k + m <= n`）
  場合だけ、Planどおり次の同じ操作を1回だけ行い、その結果を次の観測として入力させる。Window内の
  Stepは同一identityなので、どの候補でも次の操作は同じ操作・同じ武器・同じCounter streamである。
  1候補でも次がWindow外（Plan上は別の操作）なら、追加の操作を求めない。本当の位置がその候補なら
  追加操作はPlan外の操作になるためである。回復のためだけのPlan外操作は求めない
- 候補0件: まず入力の修正を許す。Window全体で一致が無ければ、現在のゲーム状態はこのPlanの同一操作
  連続区間では説明できない。通常のRNG同定で強引にCounterを探さない
- 候補が2件以上で安全な追加観測も無い場合も、推測で候補を選ばない

一意に特定できない（0件、または安全な追加観測の無い2件以上）場合は、ゲーム内セーブ地点があれば
その復元（16.9）を、無ければPlan破棄（16.2）を案内する。

##### 追従の確定（`operation_count_recovered`）

一意に特定した位置 `p` への追従は1つのDexie transactionで確定する。transaction内で最新の永続状態から
すべてを再導出し、表示時の候補をwrite authorityにしない。

再確認する前提。

- Planが `stale` で、`recalculationReasons` がちょうど `execution_operation_uncertain` だけである。
  それ以外の理由が1つでもあれば `active` へ戻せないためfail closedとする
- CalculationContextが互換で、現行Execution契約のPlanである
- Planの最新ExecutionHistory（`compareExecutionHistoryOrder()`）が要求の指す `operation_uncertain`
  記録であり、その記録のStepが現在Step（要求のStep）である。表示後に別の記録が追加されていれば拒否する
- Plan依存Target / Entryが変わっていない（16.6）
- 永続状態が現在Stepの `expectedStateBefore` と一致する（`operation_uncertain` は何も変えないため）
- 同じ手順で導出したRecovery Windowと観測列から候補がちょうど1件で、その位置が要求の表示位置と同じ

replay。`w1 .. wp` を順に、各Stepの記録済み `rngAdvance`、`expectedResult`、`executionEffects` だけで
適用する。適用内容は `confirmed_expected` のStep確定と同じstate transition authority（Counter authority
経由のrngAdvance、追跡武器の登録 / 同一ID更新、作成中、target link、compromise label、target completion、
Step完了）であり、Counterだけを `+N` で書き換えない。RNG Prediction、Candidate Search、Plannerは
再実行しない。各Stepの適用後に `expectedStateAfter` と一致することを検証する。最後に、追跡武器を
持つ操作では追従後の追跡武器の結果（5枠とscope、またはSkill）が最後の観測と一致することを検証する。

追従後のPlan。

- `recalculationReasons` から `execution_operation_uncertain` を除く（前提によりそれ以外は無い）
- 未完了Stepが残れば `active`、`currentStepId` は最初の未完了Step。元Planをそのまま再開し、再計画しない
- 位置 `p` がPlan最後のStepで未完了Stepが無くなれば、通常のStep確定と同じく `completed`
  （`completedAt`、作成中の解除、target completionを含む）。回復だからといって完成処理を省略しない
- `p = 0`（baselineと一致）: Counter、武器、Targetは変えず、Step完了も無く、`currentStepId` も維持し、
  Planだけ `stale -> active` に戻す

ゲーム内セーブ地点は通常のPlan実行と同じく維持する。追従でPlanが `completed` になる場合だけ、通常の
Plan completionと同じ規則で削除する。

ExecutionHistoryは1件だけ追加する。中間Stepの `confirmed_expected` を複数捏造しない。

- `action = "operation_count_recovered"`
- `planStepId`: `p >= 1` なら追従で到達した最後のStep `wp`、`p = 0` なら `operation_uncertain` 記録の
  Step（現在Stepのまま）
- `actualResult`: 最後の観測（5枠とscope、またはSeries / Group Skill）。`note = null`
- `wasExpected = true`、`recalculationReason = null`
- `undoSnapshot`: 追従直前の `stale` 状態（RngState、全Normal Counter、追従で変わったOwnedWeapon /
  TargetWeapon、追加されたOwnedWeapon ID、`stale` のPlan、セーブ地点）

Undo（16.16）はこの記録を通常どおり取り消せ、`operation_uncertain` 記録後の `stale` 状態へアプリ状態
だけを戻す。ゲーム内の操作は戻さない。

##### ゲーム内セーブ地点への復元とPlan破棄

ゲーム内セーブ地点の復元は16.9の既存Runtime（`restoreExecutionSavePoint()`）をそのまま使う。
アプリ側だけを先に戻さないため、「ゲーム側を最後のゲーム内セーブ地点まで戻しました」という明示確認の
後にだけ実行する。復元はセーブ地点より後の記録（`operation_uncertain` を含む）を削除し、セーブ地点の
Plan状態へ戻す。

セーブ地点が無く、現在位置を一意に特定できない、または別の操作・別の武器を操作した場合は、Planを安全に
継続する根拠が無い。16.2 / 16.10の既存ユーザー破棄（`user_abandoned`）で確認Dialogの後に破棄する。
破棄後は、現在のゲーム状態に合わせてRNG状態、通常アーティアCounter、所持武器を確認・再登録してから
再計画するよう案内する。Planは終了しているため、この段階で通常のRNG同定を使ってよい。

##### 再同定を促す継続表示と解決authority

Dashboard、RNG Setup、Candidate Search、およびExecution NavigatorのPlan終了表示で再同定を促す継続表示は、
永続flagを追加せず、divergence記録、Planの状態、対象streamのIdentification provenanceから導出する。
`RngState.updatedAt` は通常保存（notes、Counter Gate、手動編集）でも更新されるため、解決判定のauthorityに
しない。`KnownValue.source = observation` だけでも「そのdivergenceより後に採用された」ことは証明できない。
解決の根拠は、正式なIdentification adoptionだけが書くprovenance（[DATA_MODEL.md](./DATA_MODEL.md) 6.1 / 6.2の
`lastIdentifiedAt`）である。

`actual_result_different` の解決条件。対象Stepの予測streamについて、そのdivergence記録（`createdAt`）より
後に正式なIdentification結果が採用され、現在のpersisted stateがそのIdentification済み状態を満たすまで
未解決とする。

- `create_normal_artian`: 対象streamは `step.rngAdvance.affectedNormalCounterId` のNormalArtianCounterである。
  そのCounterのunique Normal Counter Identification（Normal Counter Setup、[UI_FLOW.md](./UI_FLOW.md) 6）が
  divergence後に正式確定され、現在も `isConfirmed = true` かつ `counter` が保持されていれば解決とする
  （`NormalArtianCounter.lastIdentifiedAt > record.createdAt`）。別武器種のCounterの再同定、RNG Identification、
  手動 / Debug保存では解決しない。`affectedNormalCounterId` が `null`、または対象Counter recordが存在しない
  場合は解決できないものとしてfail closedし、他のCounterを推測しない。確定解除中（`isConfirmed = false`）は
  Candidate Searchが使えないため未解決のままとし、再確定で解決に戻る
- `convert_normal_to_gogma` / `reset_bonuses` / `keep_bonuses` / `reset_skills`: 対象streamはRNG Identification
  （Gogma / Skill）である。Identification Wizardの正式adoption（[RNG_SPEC.md](./RNG_SPEC.md) 9.9）は
  Base Seed / Skill Counter / Gogma Counterを一体として採用するため、1回の採用でGogma側・Skill側の
  divergenceを解決してよい。解決条件は `RngState.lastIdentifiedAt > record.createdAt` かつ、採用した3値が
  現在も `isConfirmed = true` / `source = observation` / 値ありであること。divergence後にnotesやCounter Gateだけを
  保存しても解決せず（R1）、Base Seed / Gogma Counter / Skill Counterをmanual編集した値は `source = manual` になる
  ため、採用後にそれらを編集した場合もIdentification済み状態とは扱わない（R2 / R5）
- 時刻比較は正規UTC ISO文字列（`Date.prototype.toISOString()` 形式）同士の文字列比較で行い、同時刻・非正規形式・
  provenanceが `null` の場合は解決済みにしない
- 同一Planに複数の `actual_result_different` がある場合は、divergence streamごとに最新の記録
  （`compareExecutionHistoryOrder()`）を判定し、その後の採用で同じstreamのそれ以前の記録も解決とする。
  別streamの記録は解決しない。現行lifecycleでは記録後にPlanが `stale` になり以降のStepは確定されないため
  1 Plan 1件が通常だが、判定はそれに依存しない
- Planの終了（`user_abandoned` / `replan_adopted` / `breaking_change_approved` / 妥協終了）は解決ではない。
  記録が残り対象Identificationが未実施なら継続表示する
- セーブ地点の復元やUndoで該当記録自体が削除された場合は解決である。provenanceを別途クリアしない

`operation_uncertain`: 実行中Planが `stale` で最新ExecutionHistoryがその記録である間は、通常のRNG同定
ではなくExecution Navigatorでの回復（現在位置の確認 / セーブ地点の復元 / Plan破棄）を促す。
現在位置の追従（`operation_count_recovered`）とセーブ地点の復元（記録が削除される）では解決済みとし、
表示しない。Plan破棄で終わった場合は、RNG状態・通常アーティアCounter・所持武器の確認・再登録を案内する
（`actual_result_different` のprovenance判定へ吸収しない）。

判定はpure Domain helper `deriveExecutionReidentificationReminder()`
（`src/domain/execution/reidentificationReminder.ts`）が担い、再同定先は
`executionReidentificationDestination()`（Normal作成はNormal Counter Setup、他はRNG Setup）を共有する。
Execution NavigatorのPlan終了表示、およびDashboard / RNG Setup / Candidate Searchの継続表示UIは接続済みであり、
同じhelperを使う。継続表示は全ProductionPlanのExecutionHistoryをPlanごとにこのhelperへ渡し、返された未解決
streamをRNG stream / Normal Counter ID / 解決不能Normal streamの単位で表示用にまとめるだけである
（`src/services/execution/persistentReidentificationReminderService.ts`）。集約側は解決を判定せず、永続flagを
持たず、Plan statusで絞らない。RNG Setupは直接保存とIdentification adoptionの成功後に再読込し、Dashboard /
Candidate Searchはmount時に読み込む。読み込み失敗は「再同定不要」と扱わずerrorとして表示する。Candidate Searchは
警告表示のみで、検索を禁止するhard gateは追加しない。

### 16.16 Undo

Execution Undoは引き続き「アプリ状態だけを戻す。ゲーム内操作は戻さない」ことをUIで明示する。

Undo対象は、表示中の実行Planの最新ExecutionHistory 1件であり、次の場合だけ実行できる。

- Planが `active` または `stale`
- Planが `completed` / `abandoned` で、その遷移を起こしたのがそのExecutionHistory自身
  （最終Stepの確定、`finished_as_compromise`）である

再計画採用、ユーザー破棄、Planを壊す変更の承認で `abandoned` になったPlanのExecutionHistoryは
Undoできない。

Undoは最後のExecutionHistoryの `ExecutionUndoSnapshot` から、少なくとも次を1つのDexie
transactionで正確に戻す（[DATA_MODEL.md](./DATA_MODEL.md) 12）。

- RngState
- 全NormalArtianCounter
- そのStepが追加・更新・削除したOwnedWeapon（status、作成中状態を含む）
- そのStepが変更したTargetWeapon（`preferredOwnedWeaponId`、`lifecycleStatus` を含む。
  紐付けを外された別Targetも含む）
- ProductionPlan（status、abandonment理由、`currentStepId`、Step完了状態）
- ゲーム内セーブ地点（そのStepの遷移で削除されたものは復元し、取り消すStepがセーブ地点の
  境界なら削除する）
- そのExecutionHistoryの削除

Undo自体のExecutionHistoryは追加しない。Snapshotどおり復元したPlanのstatusと再計算理由を
そのまま使い、現在値との差分を新たに推測しない。

実装上の確定事項（Undo Runtime PR）。

- Undo要求は取り消すExecutionHistory IDを指定する。transaction内で、それがPlanの最新
  ExecutionHistory（`createdAt` 昇順、同時刻は `id` 昇順で最後）であることを再確認し、違えば拒否する。
  表示後に追加された新しい記録を代わりに取り消さない
- `completed` Planは、最新記録が `confirmed_expected` で、Snapshot PlanのただひとつのStep未完了が
  その記録のStepであり、現在Planの `completedAt`・そのStepの `completedAt` が記録の `createdAt` と一致する
  場合だけ取り消せる。最新記録が `operation_count_recovered` の場合は、Snapshot Planで未完了だったStepが
  すべて現在Planで記録の `createdAt` に完了し、現在Planの `completedAt` が記録の `createdAt` と一致する
  場合だけ取り消せる（追従がPlanを完了させた場合）。`abandoned` Planは、最新記録が `finished_as_compromise` で、
  `abandonmentReason = finished_as_compromise`、`abandonedAt` が記録の `createdAt` と一致する場合だけ取り消せる
- 現行Validationを満たさない記録、legacy action、Snapshot Planが記録Stepを現在Stepとする `active` Planでない
  記録は推測補完せず拒否する。例外は `operation_count_recovered` で、Snapshot Planは
  `execution_operation_uncertain` を持つ `stale` Planであり、その `currentStepId` が未完了Stepで、記録Stepが
  Snapshot Planで未完了かつ現在Step以降（Plan順）にあることを要求する（16.15）。取り消すと
  `operation_uncertain` 記録後の `stale` 状態へ戻り、その記録が再び最新になる
- 復元値はSnapshot本体そのものであり、RNG予測の再実行、Counter差分の逆算、timestampの付け直しをしない。
  NormalArtianCounterはcollection全体をSnapshotで置き換える
- ゲーム内セーブ地点は、取り消す記録が境界（`lastExecutionHistoryId`）なら削除し、Snapshotの古いセーブ地点を
  代わりに復活させない。取り消す記録の終端遷移（`completed` / `abandoned`）が削除したセーブ地点は
  Snapshotから復元する。それ以外は変更しない
- 書き込み前に復元後のRngState、NormalArtianCounter、OwnedWeapon、TargetWeapon、ProductionPlan、
  Target優先起点collection、残す / 復元するセーブ地点とその参照を検証し、不正なら何も書かない。
  RNG予測やMaster availabilityの再判定はしない

### 16.17 Persistence、Export / Import、versioning

本章で追加・変更する永続状態は次のとおりである。

- TargetWeaponのlifecycle（`lifecycleStatus`、`completedAt`、完了Plan ID）
- OwnedWeaponの作成中状態（`executionInProgress`）
- ProductionPlanのabandonment理由 / 日時、PlanningInputSnapshotの依存hash
- PlanStepの `executionEffects`、`confirm_owned_ideal`
- ExpectedPlanStateの `targetExecutionStateHash` とbinding token正規化
- ExecutionHistoryの新action、ActualResultの拡張、ExecutionUndoSnapshotの拡張
- ExecutionSavePoint（新table）
- `createTargetDefinitionHash()` から `preferredOwnedWeaponId` / lifecycleを除く正規化変更

これらはExport / Importの対象になる（[DATA_MODEL.md](./DATA_MODEL.md) 15）。端末間同期は
追加せず、既存の全置換Import / Exportで扱う。

本改訂はTarget lifecycle、OwnedWeapon execution lifecycle、`preferredOwnedWeaponId` の
staleness semantics、PlanStep / reserve semantics、Expected execution state、Undo対象範囲を
変更する。後続実装PRでは次を行う。

- 現行schemaとImport互換を監査し、`CURRENT_CALCULATION_APP_SCHEMA_VERSION`、Dexie
  `DATABASE_SCHEMA_VERSION`、`ExportRoot.schemaVersion` の必要なversion境界を確定する。
  本仕様PRでは実コードのversionを変更しない。最初の実装PR（永続Entity基盤）でDexie
  `DATABASE_SCHEMA_VERSION` を5、`ExportRoot.schemaVersion` を7へ更新し、
  `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は計算意味を切り替える後続PRまで11のまま維持した
  （[DATA_MODEL.md](./DATA_MODEL.md) 3.5 / 14.2 / 15）。2番目の実装PR（Execution Plan契約）で
  `CURRENT_CALCULATION_APP_SCHEMA_VERSION` を12、`ExportRoot.schemaVersion` を8へ更新し、Dexieは
  table / index変更が無いため5のまま維持した。3番目の実装PR（Execution runtime core）で
  ProductionPlan lifecycle metadataとExecutionUndoSnapshotの拡張を永続形状へ加え、Dexie
  `DATABASE_SCHEMA_VERSION` を6（non-terminal Planへのnull補完だけのdata-only upgrade）、
  `ExportRoot.schemaVersion` を9へ更新した。計算意味は変更しないため
  `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は12のまま維持した。
  操作内容不明からの現在位置追従（16.15）はExecutionHistoryの新action literal
  `operation_count_recovered` だけを加え、既存のfield（`actualResult`、`undoSnapshot` など）をそのまま使う。
  Dexieのtable / index / field形状、ExportRootの形状、Plan生成・Candidate Search・Plannerの計算意味は
  変わらないため、`CURRENT_CALCULATION_APP_SCHEMA_VERSION = 13`、`DATABASE_SCHEMA_VERSION = 6`、
  `ExportRoot.schemaVersion = 9` を維持する。この記録を含むExportを旧版が読むと、action literalの
  検証でImport全体がfail closedになり、部分適用はしない。その後のIdentification provenance
  （16.15の解決authority、[DATA_MODEL.md](./DATA_MODEL.md) 6.1 / 6.2）の追加でDexie
  `DATABASE_SCHEMA_VERSION` を7、`ExportRoot.schemaVersion` を10、`RngState.schemaVersion` を2へ更新した
  （現行値）。計算意味は変わらないため `CURRENT_CALCULATION_APP_SCHEMA_VERSION` は13のままである
- 既存データを推測migrationして意味を変えない。所持Ideal武器の存在からTargetを
  `completed` と推測しない。既存OwnedWeaponを作成中と推測しない
- 旧契約のProductionPlan（独立 `reserve_weapon` Step、旧expected state）はexact persisted
  contentを保持し、CalculationContext境界でfail closedにする。legacy Stepを表示できても
  current Execution operationとして実行可能にしない

### 16.18 変更しないUI表示契約

Counterは各Step確定時にリアルタイム更新するが、Debug Mode OFFでSeed / Counterの数値を通常表示
しない契約（[REQUIREMENTS.md](./REQUIREMENTS.md) 33）は変更しない。Debug ModeではStepごとの
before / afterを従来どおり確認できる。
