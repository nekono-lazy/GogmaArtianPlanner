/**
 * Reference-verified fixture values for WiseHorror/Gogma-Artian-Roll-Planner
 * GARP.lua v0.9.4 (`u32`, `rng_step`, `initialize_rng`,
 * `initialize_gogma_rng`, `predict_skill_route`, and its seed expressions)
 * @ eceb2bd9ca6f4897ec516387acab2ad6beb8b38b.
 * GARP.lua SHA-256:
 * dd9ff4ede166542c1efa4bc13595b2d064c581676c289893946af2f9b5551282.
 * The existing values were independently revalidated with the fixed-hash Lua
 * source: 20 / 20 cases and 81 scalar comparisons passed with no mismatch.
 *
 * Do not regenerate these values from GogmaArtianPlanner production code.
 */
export const referenceRngVectors = {
  prng: {
    seed0InitialState: {
      x: 1789334513,
      y: 75484576,
      z: 917002911,
      w: 723841435,
    },
    additionalInitialStates: [
      {
        seed: 1,
        initialState: { x: 310994555, y: 572947858, z: 2418431193, w: 3735855589 },
        firstStep: 1963134732,
      },
      {
        seed: 4294967295,
        initialState: { x: 994290633, y: 1011362247, z: 235882909, w: 760277502 },
        firstStep: 3441275361,
      },
    ],
    seed0Block0: [
      3327040012,
      717991236,
      814877476,
      1715858466,
      3854171324,
      370592769,
      541509415,
      3105318085,
      2739855994,
      3562655649,
    ],
    seed0Block1: [
      2477906518,
      2557699138,
      1193786588,
      2006345150,
      249893361,
      638735232,
      3067049377,
      4157768690,
      2041498786,
      1988213207,
    ],
    seed8524433Block0: [
      1381807740,
      1033729024,
      3769696119,
      1904989250,
      2021608149,
      4154190422,
      1633690986,
      4084227943,
      599051908,
      556739434,
    ],
    seed8524433Block1: [
      1439128927,
      2227748192,
      3295746858,
      2074252501,
      2407319426,
      1487140175,
      366587154,
      655177764,
      3313181414,
      1834948310,
    ],
  },
  normalSeeds: [
    { baseSeed: 8524433, weaponTypeId: 'weapon.insect_glaive', seed: 3058381 },
    { baseSeed: 1, weaponTypeId: 'weapon.great_sword', seed: 11309933 },
    { baseSeed: 99999999, weaponTypeId: 'weapon.light_bowgun', seed: 89817259 },
  ],
  attributeSeeds: [
    {
      baseSeed: 8524433,
      weaponTypeId: 'weapon.insect_glaive',
      elementId: 'element.thunder',
      seed: 3058368,
    },
    {
      baseSeed: 1,
      weaponTypeId: 'weapon.great_sword',
      elementId: 'element.none',
      seed: 11309924,
    },
    {
      baseSeed: 99999999,
      weaponTypeId: 'weapon.light_bowgun',
      elementId: 'element.blast',
      seed: 89817269,
    },
  ],
  skillPredictions: [
    {
      baseSeed: 8524433,
      weaponTypeId: 'weapon.insect_glaive',
      elementId: 'element.thunder',
      counterGate: 200,
      skillCounter: 186,
      combinationIndex: 275,
      seriesSkillId: 'series_skill.verified_21',
      groupSkillId: 'group_skill.verified_12',
    },
    {
      baseSeed: 1,
      weaponTypeId: 'weapon.great_sword',
      elementId: 'element.none',
      counterGate: 0,
      skillCounter: 999,
      combinationIndex: 107,
      seriesSkillId: 'series_skill.verified_05',
      groupSkillId: 'group_skill.verified_12',
    },
    {
      baseSeed: 99999999,
      weaponTypeId: 'weapon.light_bowgun',
      elementId: 'element.blast',
      counterGate: 54,
      skillCounter: 0,
      combinationIndex: 196,
      seriesSkillId: 'series_skill.verified_15',
      groupSkillId: 'group_skill.verified_04',
    },
    {
      baseSeed: 42,
      weaponTypeId: 'weapon.great_sword',
      elementId: 'element.fire',
      counterGate: 54,
      skillCounter: 1,
      combinationIndex: 162,
      seriesSkillId: 'series_skill.gore_magala',
      groupSkillId: 'group_skill.verified_06',
    },
    {
      baseSeed: 42,
      weaponTypeId: 'weapon.great_sword',
      elementId: 'element.fire',
      counterGate: 55,
      skillCounter: 1,
      combinationIndex: 162,
      seriesSkillId: 'series_skill.gore_magala',
      groupSkillId: 'group_skill.verified_06',
    },
    {
      baseSeed: 42,
      weaponTypeId: 'weapon.great_sword',
      elementId: 'element.fire',
      counterGate: 53,
      skillCounter: 999,
      combinationIndex: 234,
      seriesSkillId: 'series_skill.verified_19',
      groupSkillId: 'group_skill.verified_05',
    },
    {
      baseSeed: 42,
      weaponTypeId: 'weapon.great_sword',
      elementId: 'element.fire',
      counterGate: 54,
      skillCounter: 999,
      combinationIndex: 168,
      seriesSkillId: 'series_skill.verified_14',
      groupSkillId: 'group_skill.verified_04',
    },
  ],
} as const
