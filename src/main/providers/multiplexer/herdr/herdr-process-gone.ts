import { HerdrRuntimeError } from './herdr-runtime-contract'

export function isHerdrProcessGone(error: unknown): boolean {
  if (error instanceof HerdrRuntimeError) {
    return error.code === 'herdr_unavailable'
  }
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'ECONNRESET') {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /not initialized|ECONNREFUSED|ENOENT/i.test(message)
}
