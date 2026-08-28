type TestDistribution = 'official' | 'horca'

const profile: TestDistribution =
  process.env.HORCA_TEST_DISTRIBUTION === 'horca' ? 'horca' : 'official'
;(globalThis as { ORCA_DISTRIBUTION?: TestDistribution }).ORCA_DISTRIBUTION = profile
