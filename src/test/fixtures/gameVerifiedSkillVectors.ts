/**
 * Live-game Skill stream observation recorded by the project owner on
 * 2026-09-04 for C5-E2C9. The Base Seed and starting Skill Counter come from a
 * GARP live RNG state read, which is independent of this project's Production
 * RNG, Identification kernel, and Wizard. The four ordered results were then
 * observed in game from the same pre-investigation state, and that state was
 * restored afterwards, so the persisted Counter is the starting Counter and is
 * never advanced by the observation count.
 *
 * This fixture proves the listed weapon type, element, and Counter positions
 * only. It does not verify every weapon, element, or game version, and it does
 * not verify Gogma or Normal stream behavior. The GARP build used for the state
 * read is not identified here; do not infer a version or commit from the
 * reference-algorithm audit.
 */
export const gameVerifiedSkillIdentificationVector = {
  provenance: {
    status: 'game-verified',
    liveObservationDate: '2026-09-04',
    stateSource: 'GARP live RNG state read',
    gameStateRestoredAfterObservation: true,
  },
  baseSeed: 51_231_782,
  startSkillCounter: 341,
  weaponTypeId: 'weapon.insect_glaive',
  elementId: 'element.ice',
  /**
   * Counter 341 is the conversion-assigned Skill; 342-344 are three
   * consecutive Reset Skills. Semantic IDs are the fixture authority; the
   * observed Japanese names are retained only so the display-name transcription
   * stays testable against Master data.
   */
  observations: [
    {
      skillCounter: 341,
      operation: 'convert_normal_to_gogma',
      seriesSkillId: 'series_skill.verified_11',
      groupSkillId: 'group_skill.verified_08',
      observedSeriesDisplayNameJa: '暗器蛸の力',
      observedGroupDisplayNameJa: '革細工の滑性',
    },
    {
      skillCounter: 342,
      operation: 'reset_skills',
      seriesSkillId: 'series_skill.verified_10',
      groupSkillId: 'group_skill.verified_10',
      observedSeriesDisplayNameJa: '凍峰竜の反逆',
      observedGroupDisplayNameJa: '毛皮の誘惑',
    },
    {
      skillCounter: 343,
      operation: 'reset_skills',
      seriesSkillId: 'series_skill.verified_14',
      groupSkillId: 'group_skill.verified_10',
      observedSeriesDisplayNameJa: '鎖刃竜の飢餓',
      observedGroupDisplayNameJa: '毛皮の誘惑',
    },
    {
      skillCounter: 344,
      operation: 'reset_skills',
      seriesSkillId: 'series_skill.verified_09',
      groupSkillId: 'group_skill.verified_09',
      observedSeriesDisplayNameJa: '鎧竜の守護',
      observedGroupDisplayNameJa: '鱗重ねの工夫',
    },
  ],
  /** Bounded C9 verification window; not a Wizard Production default. */
  identificationSearch: {
    seedRange: { startInclusive: 51_206_782, endInclusive: 51_256_782 },
    skillCounterRange: { startInclusive: 336, endInclusive: 346 },
  },
} as const
