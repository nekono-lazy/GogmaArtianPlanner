# C5-E2C9 Skill Live-Game Verification

観測日: 2026-09-04

## Status

- C5-E2C7 Wizard UI: completed
- C5-E2C7 StrictMode lifecycle hotfix: completed
- C5-E2C8 real Browser Worker benchmark: completed
- C5-E2C9 Skill live-game verification: completed
- C5-E2C10 Production Identification activation: pending

この結果は `production-rng:c5-e2`、`supportsSeedSearch = false`、Production RNG
semantics、Worker protocol、Coordinator state machine、Wizard UXを変更していない。
C9完了はSkill live-game verificationの完了であり、Production Identification
activationの完了ではない。

## Independent state authority

Base Seedとstarting Skill Counterは、本ProjectのProduction RNG / Identification
kernel / Wizardとは独立した GARP live RNG state read から取得した。observation
終了後、調査前stateへ復元済みである。したがって永続Counterはstarting Counterで
あり、観測数を加算した値ではない。

| 項目 | 値 |
| --- | --- |
| Base Seed | `51231782` |
| Starting Skill Counter | `341` |
| Weapon Type | 操虫棍 / `weapon.insect_glaive` |
| Element | 氷 / `element.ice` |
| State source | GARP live RNG state read |
| Game state restored after observation | yes |

同時にexportされた `gogmaCounter` と `counterGate` は本verificationのauthorityと
して使用していない。Counter GateはC9のinput、observation、search dimension、
result、adopted fieldのいずれでもない。

GARPのbuild versionまたはcommitは本Repositoryおよび観測情報から確定できないため、
provenanceは `GARP live RNG state read` までを記録する。
`docs/RNG_REFERENCE_AUDIT.md` が固定する参照algorithm commitを、live state readの
runtime buildとして推定しない。

## Forward live-game verification

`ProductionRngEngine.predictSkills()` にsemantic Domain inputのみを与え、Production
内部のactive branch representativeをそのまま使用した。Counter Gateはcaller input
へ追加していない。

Observation 1はconversion割当Skill、Observation 2-4は連続するReset Skillsである。
conversion契約は Normal +0 / Skill +1 / Gogma +0 を維持する。

| Skill Counter | Operation | Expected Series / Group | Observed Series / Group | 判定 |
| ---: | --- | --- | --- | --- |
| 341 | `convert_normal_to_gogma` | `series_skill.verified_11` / `group_skill.verified_08` | 暗器蛸の力 / 革細工の滑性 | MATCH |
| 342 | `reset_skills` | `series_skill.verified_10` / `group_skill.verified_10` | 凍峰竜の反逆 / 毛皮の誘惑 | MATCH |
| 343 | `reset_skills` | `series_skill.verified_14` / `group_skill.verified_10` | 鎖刃竜の飢餓 / 毛皮の誘惑 | MATCH |
| 344 | `reset_skills` | `series_skill.verified_09` / `group_skill.verified_09` | 鎧竜の守護 / 鱗重ねの工夫 | MATCH |

結果: 4/4 exact parity。Forward live-game verification PASS。

参考diagnosticとして、`predictReferenceSkills` の `effectiveBlock` は各Skill Counter
と一致し（341 / 342 / 343 / 344）、`combinationIndex` は 31 / 147 / 175 / 47 で
あった。

## Identification reverse verification

同じordered observation 4件をProduction Skill Identificationへ入力した。

| 項目 | 値 |
| --- | --- |
| Seed range | `51,206,782..51,256,782` inclusive (50,001 Seeds) |
| Skill Counter range | `336..346` inclusive (11 Counters) |
| Searched Seed range | `51,206,782..51,256,782` |
| matches | `[{ baseSeed: 51231782, startSkillCounter: 341 }]` |
| `isTruncated` | `false` |

kernel直接呼出しと、Production multi-worker orchestration（4 Worker分割、
deterministic merge、global progress）の両方が同一結果を返した。

Identification reverse verification PASS。

100M canonical domainは実行していない。この範囲はC9 verification用であり、Wizardの
Production default rangeを決定しない。

## 検証経路の範囲

Node / Vitest環境では実Browser Workerを起動できないため、multi-worker検証は既存
`KernelChildClient` test adapterを通した `createMultiWorkerSkillIdentificationClient`
のorchestration経路で実行した。実Browser Worker自体はC5-E2C8で検証済みであり、C9で
Browser benchmarkを再実行していない。

## Fixture and tests

- Fixture: `src/test/fixtures/gameVerifiedSkillVectors.ts`
  （`gameVerifiedSkillIdentificationVector`）
- `src/domain/rng/production/productionRngEngine.test.ts`:
  `predictSkills` の4/4 exact parityと、observationごとのSkill Counter +1契約
- `src/domain/rng/production/skillPrediction.test.ts`:
  観測日本語表示名からsemantic IDへのMaster解決と、`effectiveBlock` 一致
- `src/domain/rng/identification/skillIdentification.test.ts`:
  bounded rangeで `(51231782, 341)` がuniqueかつnon-truncated
- `src/services/rngIdentification/multiWorkerSkillIdentificationClient.test.ts`:
  4 Worker orchestrationで同一のunique / non-truncated結果

fixtureのauthorityはsemantic IDである。日本語表示名はMaster解決の転記guardとしてのみ
保持する。

## 適用範囲と残課題

- 本fixtureが証明するのは操虫棍 / 氷 / Skill Counter 341-344のみである。全weapon、
  全element、全game versionを証明しない
- Gogma streamとNormal streamのlive verificationは本タスクの対象外である
- Bow Sharpness/Ammo、LBG/HBG Element、elementless Gogmaのelement bonus、栄光の誉れ、
  祝祭の巡り、Gogma rank I、Counter Gate閾値未満の永続Counter挙動、
  `use_weapon_as_material` によるRNG advancementはいずれもunverifiedのままである
- C5-E2C10 Production Identification activationはpendingである。C9を理由に
  `supportsSeedSearch` を `true` へ変更しない
