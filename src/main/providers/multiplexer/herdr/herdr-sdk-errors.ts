import {
  HerdrInvalidInput,
  HerdrInvalidResponse,
  HerdrRequestTimeout,
  HerdrServerError,
  HerdrTransportError,
  HerdrUnsupportedProtocol
} from '@herdr/sdk'
import { HerdrRuntimeError } from './herdr-runtime-contract'

function taggedName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('_tag' in error)) {
    return undefined
  }
  const tag = (error as { _tag?: unknown })._tag
  return typeof tag === 'string' ? tag : undefined
}

function fiberCause(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return (error as { cause?: unknown }).cause
  }
  return error
}

export function toHerdrRuntimeError(error: unknown): HerdrRuntimeError {
  const tagged = taggedName(error)
  if (tagged === 'HerdrInvalidInput' && error instanceof Error) {
    return new HerdrRuntimeError('herdr_invalid_input', error.message)
  }
  const cause = fiberCause(error)
  if (cause instanceof HerdrRuntimeError) {
    return cause
  }
  if (cause instanceof HerdrUnsupportedProtocol) {
    return new HerdrRuntimeError(
      'herdr_incompatible',
      `Herdr protocol ${cause.actualProtocol} is incompatible with SDK protocols ${cause.supportedProtocols.join(', ')}`
    )
  }
  if (cause instanceof HerdrTransportError) {
    return new HerdrRuntimeError('herdr_unavailable', cause.message)
  }
  if (cause instanceof HerdrRequestTimeout) {
    return new HerdrRuntimeError('herdr_timeout', cause.message)
  }
  if (cause instanceof HerdrServerError) {
    return new HerdrRuntimeError(cause.serverCode, cause.message)
  }
  if (cause instanceof HerdrInvalidInput) {
    return new HerdrRuntimeError('herdr_invalid_input', cause.message)
  }
  if (cause instanceof HerdrInvalidResponse) {
    return new HerdrRuntimeError('herdr_invalid_response', cause.message)
  }
  const tag = taggedName(cause)
  if (tag === 'HerdrUnsupportedProtocol' && typeof cause === 'object' && cause !== null) {
    const body = cause as { actualProtocol?: unknown; supportedProtocols?: unknown }
    const supported = Array.isArray(body.supportedProtocols)
      ? body.supportedProtocols.join(', ')
      : String(body.supportedProtocols)
    return new HerdrRuntimeError(
      'herdr_incompatible',
      `Herdr protocol ${String(body.actualProtocol)} is incompatible with SDK protocols ${supported}`
    )
  }
  if (error instanceof Error) {
    return new HerdrRuntimeError('herdr_request_failed', error.message)
  }
  return new HerdrRuntimeError('herdr_request_failed', String(error))
}
