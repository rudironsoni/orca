import { describe, expect, it } from 'vitest'
import { restartSafeEnvironment } from './orca-restart'

describe('restartSafeEnvironment', () => {
  it('removes Electron run-as-node and undefined launch overlays', () => {
    expect(
      restartSafeEnvironment({
        ELECTRON_RUN_AS_NODE: '1',
        ORCA_E2E_FLAG: '1',
        OMITTED: undefined
      })
    ).toEqual({ ORCA_E2E_FLAG: '1' })
  })

  it('removes a lower-case Electron run-as-node key', () => {
    expect(
      restartSafeEnvironment({
        electron_run_as_node: '1',
        ORCA_E2E_FLAG: '1'
      })
    ).toEqual({ ORCA_E2E_FLAG: '1' })
  })
})
