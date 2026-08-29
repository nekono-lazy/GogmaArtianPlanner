# モンハンワイルズ 巨戟アーティア厳選Planner
## PLANNER_SPEC.md

## 1. この文書の目的

この文書は、作成リストのBuildListEntryをもとに、複数目標を横断したProductionPlanを生成するPlannerの仕様を定義する。

PlannerはUIやIndexedDBに依存せず、入力からProductionPlanを返す純粋な計算モジュールとして実装する。

---

## 2. 基本方針

Plannerの基本優先順位。

1. 未所持の実用品を早く揃える
2. 共有RNG進行中に他の目標武器も効率よく取得する
3. 実用品確保後に理想品へ更新する
4. 同程度の場合は武器消費や操作量を抑える

初期版で実装しないこと。

- ユーザーによる作成順の完全固定
- 高度な任意スコアリング
- 素材アイテム所持数による作成不能判定
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
  existingActivePlan: ProductionPlan | null;
  options: PlannerOptions;
  master: PlannerMasterSubset;
}

export interface PlannerOptions {
  maxPlanSteps: number;
  preferPracticalBeforeIdeal: boolean;
  beamWidth: number;
  maxExpandedStates: number;
}

export interface PlannerMasterSubset {
  materialCosts: MaterialCostMaster[];
  bonusRanks: BonusRankMaster[];
}
```

初期値。

```ts
const defaultPlannerOptions = {
  maxPlanSteps: 300,
  preferPracticalBeforeIdeal: true,
  beamWidth: 50,
  maxExpandedStates: 10000,
};
```

制約。

- `buildListEntries` は `isStale = false` の項目のみ
- PlannerはBuildListEntryの `candidateSnapshot` を入力候補として使う
- Planner入力validationでTarget定義Hash、searchStateHash、referencedOwnedWeaponsHash、CalculationContextを現在値から再確認し、保存済み `isStale` だけを信用しない
- RngState全体の確定は要求しない
- `deriveRngCapabilities` で全RouteOperationに必要なCapabilityが揃う場合のみPlannerを実行する
- Capability不足またはCalculationContext非互換のBuildListEntryだけを除外し、理由をwarningへ出す
- `targetWeapons` は `isEnabled = true` のみ対象
- `beamWidth` と `maxExpandedStates` は1以上

---

## 5. 出力

Plannerは `ProductionPlan` を返す。

```ts
export interface PlannerResult {
  plan: ProductionPlan | null;
  conflicts: PlanConflict[];
  warnings: PlannerWarning[];
}

export interface PlannerWarning {
  kind:
    | "no_build_list_entries"
    | "rng_state_missing"
    | "material_weapon_shortage"
    | "protected_weapon_required"
    | "build_list_entry_stale"
    | "calculation_context_incompatible"
    | "all_targets_already_satisfied"
    | "max_steps_reached";
  message: string;
}
```

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

- `hasPractical`: OwnedWeaponがTargetの実用条件を満たす
- `hasIdeal`: OwnedWeaponがTargetの理想条件を満たす

制約。

- `status` だけで判定しない。実際のボーナス・スキル条件で判定する
- `status` はユーザー管理ラベルとして扱う
- 既に理想品があるTargetは原則Planner対象から外す
- 既に実用品があるTargetでは、理想候補を優先度に応じて後回しにする
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
  steps: PlanStep[];
  totalCost: number;
  evaluationScore: number;
}
```

探索手順。

1. 現在RNG状態と在庫から初期Stateを作成する
2. 未充足Targetに対する実行可能なBuildListEntryを列挙する
3. 各Entryの `BuildRoute.operations` から、現在の共有RNG状態と在庫で実行可能な次操作を列挙する
4. 同じ共有RNG遷移を要求する複数Entryがあれば、1回の遷移で各Entryのroute progressを進める
5. `count` を持つ操作は実行ナビ用の1操作単位へ分割し、現在Counterまで正常に通過済みのprefixを重複生成しない
6. 操作前提が現在Stateより過去にあり、副作用または必要資源が満たされていないEntryは実行不能とする
7. 実行可能な操作を適用し、共有RNGと在庫を進めた次Stateへ展開する
8. 実用品確保、理想品更新、操作数、武器消費、競合を評価する
9. 同じ深さで評価値の高い上位 `beamWidth` 件だけを残す
10. `maxExpandedStates` または `maxPlanSteps` 到達時に打ち切る
11. 完了Stateのうち最良、完了Stateがなければ最も充足度の高いStateからPlanを生成する

候補確保時の状態遷移。

- Practical候補: 対象Targetの `hasPractical = true`
- Ideal候補: 対象Targetの `hasPractical = true`、`hasIdeal = true`
- Practical確保済みでもIdeal未所持なら、そのTargetは理想更新候補として探索に残す

`beamWidth = 50`、`maxExpandedStates = 10000` は初期値であり、UI設定ではなく将来調整可能な定数とする。完全最適解は保証せず、実用的な時間内で十分良いPlanを返す。

Planner内部ではBeam Searchの状態評価用にCandidate Scoreを計算する。

```ts
export interface CandidateScore {
  targetPriorityScore: number;
  satisfactionScore: number;
  categoryScore: number;
  distancePenalty: number;
  resourcePenalty: number;
  conflictPenalty: number;
  total: number;
}
```

推奨重み。

```ts
targetPriorityScore = target.priority * 10000
satisfactionScore =
  !state.targetSatisfaction[target.id].hasPractical
    ? 50000
    : candidate.category === "ideal" &&
      !state.targetSatisfaction[target.id].hasIdeal
      ? 20000
      : 0
categoryScore =
  candidate.category === "ideal" ? 20000 :
  10000
distancePenalty = estimatedOperationCount * 100
resourcePenalty = consumedMaterialWeaponCount * 1000
conflictPenalty = conflictCount * 5000
```

制約。

- scoreはBeam Search内の状態比較用であり、単独で採用候補を確定しない
- scoreはPlanner内部の比較用であり、初期版UIで高度なユーザー調整は提供しない
- Debug Modeではscore内訳を表示してよい
- 実用品未所持Targetでは実用候補の価値を高くする
- 実用品未所持TargetをPractical以上へ進める評価を、実用品取得済みTargetのIdeal更新より高くする
- Practical確保後はhasPracticalを維持しつつIdeal候補を評価する
- 理想候補でも、実用品未所持Targetの遠すぎる理想は短距離実用品より後回しになることがある
- `isProtected = true` の武器に対する素材消費・Reset Bonuses・Keep Bonusesはpenaltyではなく実行不能な展開として除外する

---

## 8. 在庫シミュレーション

PlannerはOwnedWeaponを資源として扱う。

```ts
export interface SimulatedInventory {
  ownedWeapons: OwnedWeapon[];
  consumedWeaponIds: OwnedWeaponId[];
  reservedWeaponIds: OwnedWeaponId[];
  createdWeaponIds: OwnedWeaponId[];
}
```

武器状態の扱い。

- Materialかつ保護OFF: 消費可能
- Practical: 消費しない
- Ideal: 消費しない
- `isProtected = true`: 素材消費・Reset Bonuses・Keep Bonusesへ使用しない

素材用巨戟が不足する場合。

```text
通常アーティア作成
→ 巨戟化
→ 素材用巨戟として登録
→ 後続Stepで素材として使用
```

制約。

- 初期版では素材アイテムの所持数不足はPlan不可理由にしない
- 巨戟アーティア武器の不足はPlanに補充Stepを追加して解決する
- 補充StepでもRNG進行を伴うため、後続候補のCounterと整合させる
- protected武器への素材消費・Reset Bonuses・Keep Bonusesが必要な探索展開は生成せず、該当BuildListEntryを不採用として理由を残す
- Search後に起点武器がprotectedへ変わった場合、素材消費・Reset Bonuses・Keep Bonusesを必要とするEntryはPlanner入力validationで実行不能とする。Reset SkillsのみのEntryは実行可能とする
- v1では、Plannerは同一TargetのIdeal武器を先に確保できる場合だけ、旧Practical武器の確認付き素材化Stepを探索へ追加してよい
- 素材化Stepを予定することは許可するが、ユーザー確認前に `isProtected` または `status` を変更しない
- 素材化Stepが確認された後のStateでのみ、その武器を後続の素材消費へ割り当てる
- 別のPractical武器を確保したことだけを理由に旧Practical武器の素材化展開を生成しない。Practical同士の優劣判定は将来仕様とする

旧実用品の素材化に必要な探索条件。

- 対象武器は現在 `status = "practical" AND isProtected = true`
- 同じTargetのIdeal武器を確保済み、または同一Plan内の先行Stepで確保する
- 素材化後も、そのTargetの `hasIdeal = true` を満たす別のOwnedWeaponが残る
- 後続Stepで素材として使う合理的な必要性がある
- `change_owned_weapon_status` Stepを素材消費Stepより前に配置する
- この素材化はCandidate Searchがprotected武器を起点に破壊的Routeを生成することを許可するものではなく、Plannerが後続の一般素材不足を解消する在庫操作として追加する

---

## 9. 競合検出

同じRNG位置または同じ資源を同時に必要とする候補を競合として扱う。

競合種別は `DATA_MODEL.md` の `ConflictKind` を使用する。

検出条件。

- 同じGogma Counter位置で同時取得できない候補
- 同じSkill Counter位置で同時取得できない候補
- 同じ通常アーティアCounter位置で同時取得できない候補
- 同じOwnedWeaponを素材または起点として排他的に消費する候補

解決方針。

1. Target priorityが高い候補
2. 実用品未所持Targetの候補
3. ideal候補
4. 見送った場合の次候補までの距離が遠い候補
5. 武器消費が少ない候補
6. 操作量が少ない候補

ユーザー選択が必要な場合。

- score差が小さい
- どちらも高優先度Targetの初回実用品

protected武器への素材消費・Reset Bonuses・Keep Bonusesは競合として解決せず、常に実行不能として `requires_protected_weapon` の不採用理由を付ける。確認付き素材化Stepが先行し、期待状態どおりMaterial / unprotectedへ変わった後の素材消費はこの禁止に該当しない。

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
10. 必要に応じて素材用巨戟補充Stepを追加
11. RouteOperation列からPlanStep列を生成
12. 各PlanStepの期待状態Before / Afterを計算
13. requiredMaterialsを集計
14. ProductionPlanを返す

制約。

- PlanStepの `order` は1始まりの連番
- PlanStepは実行ナビで1つずつ確認できる粒度にする
- 高速モード用のまとめStepは作らない
- Plan生成時点では実際のDBを更新しない。保存は呼び出し側Repositoryが行う
- Beam Searchの打切り時は `max_steps_reached` または探索上限warningを返す
- `ProductionPlan.calculationContext` はPlannerInputと一致させる

---

## 11. PlanStep生成

BuildCandidateの `BuildRoute.operations` を順にPlanStepへ変換する。Route kindやCounter endpointだけから操作列を再構成しない。

基本変換。

```text
CreateNormalArtianOperation -> create_normal_artian
ConvertToGogmaOperation    -> convert_normal_to_gogma
ResetBonusesOperation      -> reset_bonuses
KeepBonusesOperation       -> keep_bonuses
ResetSkillsOperation       -> reset_skills
UseWeaponAsMaterialOperation -> use_weapon_as_material
```

各変換後、必要に応じて `reserve_weapon` または結果確認Stepを追加する。

Route別の典型例。

## 11.1 通常アーティア経由

```text
1. create_normal_artian
2. convert_normal_to_gogma
3. 必要なら reset_skills
4. confirm_result または reserve_weapon
```

必要に応じて通常アーティア作成を複数回挟む。v1ではこのRouteへKeepBonusesOperationを挿入しない。巨戟化直後のreset_skillsは `sourceOwnedWeaponId = null` とし、未登録武器用のOwnedWeaponIdを生成しない。

完成武器をreserve_weaponでOwnedWeaponとして登録した後は、後続の別検索で既存巨戟Keep Bonuses Routeの起点にできる。

UI実行は1操作ずつ。

## 11.2 既存巨戟 Reset Bonuses

```text
1. reset_bonuses
2. reset_skills または confirm_result
3. reserve_weapon
```

## 11.3 既存巨戟 Reset Skills

```text
1. reset_skills
2. confirm_result または reserve_weapon
```

起点OwnedWeaponの復元ボーナス5枠を変更せず、Skill CounterとSkill Prediction結果だけを反映する。Reset Skillsは非破壊操作として扱うため、protectedなPractical / Ideal武器も起点にできる。

## 11.4 既存巨戟 Keep Bonuses

```text
1. keep_bonuses
2. reset_skills または confirm_result
3. reserve_weapon
```

## 11.5 素材補充

```text
1. create_normal_artian
2. convert_normal_to_gogma
3. change_owned_weapon_status(material)
```

## 11.6 旧実用品の素材化

同一TargetのIdeal武器の確保後に旧Practical武器を後続素材へ使うPlanでは、次のStepを生成できる。

```text
1. reserve_weapon（同一TargetのIdeal武器）
2. change_owned_weapon_status（旧実用品）
3. use_weapon_as_material（変更後の旧実用品）
```

`change_owned_weapon_status` Stepの契約。

- `requiresUserConfirmation = true`
- expectedStateBefore: 旧実用品がPractical / protected
- 予定どおり「素材用に変更」: Material / unprotectedへ更新し、expectedStateAfter一致としてPlanを継続
- 「保管」: 状態を変更せず、expectedStateAfter不一致としてPlanをstaleにする
- ユーザー操作前に状態変更を適用しない
- 確認結果をExecutionHistoryへ保存する

---

## 12. 再計算

計画どおり進行している場合は再計算しない。

Plan開始時の `baseSnapshot.initialExecutionState` と現在の可変状態を毎回比較してはならない。正常なStep実行でもRNG Counterと所持武器が変化するためである。

再計算判定は現在Stepの `expectedStateBefore` / `expectedStateAfter` を使用する。

```ts
export interface PlanRuntimeState {
  rngState: RngState;
  normalCounters: NormalArtianCounter[];
  ownedWeapons: OwnedWeapon[];
}

export function detectPlanInvalidation(
  plan: ProductionPlan,
  currentInput: PlannerInput,
  runtimeState: PlanRuntimeState,
  phase: "before_step" | "after_step"
): RecalculationReason[];
```

判定手順。

1. 現在のCalculationContext、TargetWeapon Hash、BuildListEntryの不変項目HashをPlanの不変前提と比較する。BuildListEntryの不変項目にはSnapshot、searchStateHash、referencedOwnedWeaponsHash、CalculationContextを含め、派生値のisStale / staleReasonsはHashに含めない
2. `phase = "before_step"` では実状態Hashを現在Stepの `expectedStateBefore` と比較する
3. ユーザー確認後、呼び出し側が実結果に基づくRNG更新とInventoryChangeをトランザクション内で適用する
4. `phase = "after_step"` では更新後の実状態Hashを現在Stepの `expectedStateAfter` と比較する
5. 一致した場合だけStepを完了し、次Stepへ進める
6. 一致した正常進行ではPlanをstaleにしない

再計算が必要な条件。

- RNG状態が現在Stepの期待状態と異なる
- NormalArtianCounterが現在Stepの期待状態と異なる
- TargetWeaponが変わった
- 作成リストが変わった
- OwnedWeaponが現在Stepの期待状態と異なる
- CalculationContextとの互換性が失われた。この場合は `calculation_context_changed` を記録する
- 想定結果と実結果が違った
- 予定候補を確保しなかった
- 予定とは異なる候補を確保した
- 予定された素材化に対して「保管」を選び、`planned_status_change_declined` が記録された

制約。

- 実行に影響する項目だけを正規化した安定Hashで比較する
- Plan開始時の可変状態Hashは監査用であり、Step 1開始後のstale判定基準にしない
- Active Plan開始後、正常なRNG進行または計画どおりのOwnedWeapon変更によってBuildListEntryのsearchStateHashまたはreferencedOwnedWeaponsHashが現在値と一致しなくなっても、それだけで進行中Planをstaleにしない
- 正常なStep進行で生じるCounter / Inventory変更は `expectedStateAfter` と一致する限り差分とみなさない
- 差分がある場合、Planを `stale` にする
- 自動で新Planへ置き換えず、ユーザーに再計算を促す

---

## 13. Undo

Undo対象。

- 最後のExecutionHistoryが持つExecutionUndoSnapshot
- そのSnapshotに保存されたRngState、全NormalArtianCounter、変更対象OwnedWeapon、追加OwnedWeapon ID、削除OwnedWeapon本体、ProductionPlan

制約。

- Undoはアプリ状態だけを戻す
- ゲーム内操作が巻き戻るわけではないことをUIに表示する
- 最後のExecutionHistoryだけから、そのStep確定前のアプリ状態を正確に復元する
- UndoはExecutionHistory取消、PlanStep取消、RNG復元、NormalArtianCounter復元、Inventory復元、ProductionPlan復元を1つのDexie transactionで行う
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
      message: string;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
```

---

## 15. テスト観点

## 15.1 Satisfaction Test

- statusではなく条件で実用品所持を判定する
- 理想品所持TargetをPlanner対象から外す
- 実用品所持Targetでは理想候補が後回しになる
- Practical候補確保でhasPracticalだけがtrueになる
- Ideal候補確保でhasPracticalとhasIdealがtrueになる
- Practical確保後もIdeal未所持Targetが理想更新候補として残る

## 15.2 Score Test

- priorityが高いTargetの候補が優先される
- 実用品未所持Targetの実用候補が優先される
- 遠すぎる理想より近い実用品が優先される
- Candidate ScoreがBeam Searchの状態評価に使われ、単純Score順でPlanが確定しない

## 15.3 Beam Search Test

- 共有Gogma / Skill Counterを進める複数候補を単独Score順より少ない操作で組み合わせられる
- 複数Routeの共有RNG prefixを重複実行せず、各Entryのroute progressが進む
- `beamWidth` を超えたStateが評価順に枝刈りされる
- `maxExpandedStates` 到達時に探索を停止してwarningを返す
- 同じ入力と同じ定数から決定的なPlanが生成される
- 完全最適解を要求せず、探索上限内の最良Stateを返す

## 15.4 Inventory Test

- Material武器を消費できる
- Practical / Ideal武器を消費しない
- `isProtected = true` の武器を素材消費・Reset Bonuses・Keep Bonusesへ使う探索展開を生成しない
- `isProtected = true` のPractical / Ideal武器でもReset Skillsのみの探索展開を生成できる
- 素材消費・Reset Bonuses・Keep Bonusesで保護武器を必要とするEntryは `requires_protected_weapon` で不採用になる
- 素材用巨戟不足時に補充Stepが追加される
- 消費済み武器を再利用しない
- 同一TargetのIdeal確保後に確認必須のchange_owned_weapon_status Stepを生成できる
- 別のPractical確保だけを理由にchange_owned_weapon_status Stepを生成しない
- 素材化確認後だけ旧実用品を後続素材へ使用できる

## 15.5 Conflict Test

- 同じRNG位置の候補を競合にする
- 同じOwnedWeapon消費を競合にする
- 推奨候補が優先順位どおり決まる
- ユーザー選択が必要な競合を検出できる
- PlanConflictの参照がBuildListEntry ID基準である
- RejectedBuildListEntryの参照がBuildListEntry ID基準である

## 15.6 Plan Test

- PlanStep orderが連番になる
- requiredMaterialsが集計される
- currentStepIdが最初の未完了Stepを指す
- maxPlanSteps超過でwarningが出る
- Plan生成が入力を破壊しない
- BuildRoute.operationsと同じ順序でPlanStepが生成される
- `normal_artian_to_gogma` からkeep_bonuses PlanStepを生成しない
- `existing_gogma_reset_skills` からreset_skillsと結果確認または確保Stepを生成する
- protected武器のReset Skills Routeを `requires_protected_weapon` として誤って不採用にしない
- 各PlanStepにexpectedStateBefore / Afterが設定される
- BuildListEntry IDとCalculationContextがPlanへ保存される
- Candidate由来PlanStepの主参照がBuildListEntry IDである

## 15.7 Invalidation Test

- 現在StepのexpectedStateBeforeと一致する状態ではstaleにならない
- 期待操作適用後にexpectedStateAfterと一致すればstaleにならない
- Plan開始時からCounterが進んでいても現在Step期待値と一致すればstaleにならない
- 現在Step期待値と異なるRngState変更でstaleになる
- TargetWeapon変更でstaleになる
- BuildListEntry変更でstaleになる
- OwnedWeapon変更でstaleになる
- ExecutionHistoryの想定外結果でstaleになる
- CalculationContext非互換で `calculation_context_changed` が記録され、staleになる
- Active Planの計画どおりの参照OwnedWeapon変更では、BuildListEntry由来の `owned_weapon_changed` だけを理由にstaleにならない
- 予定どおり素材化してexpectedStateAfterと一致する場合はstaleにならない
- 素材化予定に対して「保管」を選ぶとstaleになる

## 15.8 Worker Contract Test

- detect_invalidation requestがplan、input、runtimeState、phaseをすべて保持する
- Workerが同じ引数をdetectPlanInvalidationへ渡す
