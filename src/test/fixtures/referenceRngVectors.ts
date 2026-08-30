/**
 * Literal output fixtures extracted from the read-only reference repository:
 * WiseHorror/Gogma-Artian-Roll-Planner
 * commit eceb2bd9ca6f4897ec516387acab2ad6beb8b38b
 * source: app.js functions u32, rngStep, initializeRng, and the seed
 * expressions used by predictSkillRoute and initializeGogma.
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
} as const
