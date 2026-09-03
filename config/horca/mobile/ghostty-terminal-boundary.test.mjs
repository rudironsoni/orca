import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const mobileRoot = resolve(repoRoot, 'out', 'horca-mobile', 'mobile')

const nativeView = readFileSync(
  resolve(mobileRoot, 'packages', 'libghostty-terminal', 'ios', 'ExpoLibghosttyView.swift'),
  'utf8'
)
const terminalPane = readFileSync(
  resolve(mobileRoot, 'src', 'session', 'TerminalPaneView.tsx'),
  'utf8'
)
const sessionResize = readFileSync(
  resolve(mobileRoot, 'src', 'session', 'use-mobile-session-terminal-webview.ts'),
  'utf8'
)

test('resets the existing Ghostty session without reporting a fake process exit', () => {
  const resetStart = nativeView.indexOf('  func reset(with text: String) {')
  const resetEnd = nativeView.indexOf('  func paste(_ text: String) {', resetStart)

  assert.notEqual(resetStart, -1)
  assert.notEqual(resetEnd, -1)

  const resetImplementation = nativeView.slice(resetStart, resetEnd)
  assert.match(resetImplementation, /Data\(\[0x1b, 0x63, 0x1b, 0x5b, 0x33, 0x4a\]\)/)
  assert.match(resetImplementation, /session\?\.receive\(data\)/)
  assert.doesNotMatch(resetImplementation, /\.finish\(/)
  assert.doesNotMatch(resetImplementation, /makeSession\(|installSession\(/)
})

test('keeps the Ghostty surface fitted to the React Native view', () => {
  assert.match(
    nativeView,
    /override func layoutSubviews\(\) \{[\s\S]*?terminalView\.frame = bounds[\s\S]*?terminalView\.fitToSize\(\)/
  )
  assert.match(nativeView, /UIView\.noIntrinsicMetric/)
  assert.match(nativeView, /terminalView\.setSurfaceVisible\(surfaceVisible\)/)
})

test('hides inactive Ghostty panes without opacity', () => {
  assert.match(terminalPane, /surfaceVisible=\{active\}/)
  assert.match(terminalPane, /isUsableTerminalViewport/)
  assert.doesNotMatch(terminalPane, /opacity:\s*0/)
})

test('closes the native Ghostty event delegate extension', () => {
  assert.match(
    nativeView,
    /extension ExpoLibghosttyView: TerminalSurfaceBellDelegate[\s\S]*?\n\}\n$/
  )
})

test('uses a mobile-sized default terminal font', () => {
  assert.match(terminalPane, /fontSize=\{8 \* textScale\}/)
  assert.doesNotMatch(terminalPane, /fontSize=\{(?:10|14) \* textScale\}/)
})

test('updates the live subscriber before falling back to snapshot replay', () => {
  const resizeStart = sessionResize.indexOf('const handleTerminalNativeResize = useCallback(')
  const resizeEnd = sessionResize.indexOf('\n\n  useEffect(', resizeStart)
  const resizeImplementation = sessionResize.slice(resizeStart, resizeEnd)
  const requestIndex = resizeImplementation.indexOf('.request(client, handle, deviceToken')
  const cacheIndex = resizeImplementation.indexOf(
    'client.updateTerminalSubscriptionViewport(handle, { cols, rows })'
  )
  const fallbackIndex = resizeImplementation.indexOf('unsubscribeTerminal(handle)')

  assert.notEqual(resizeStart, -1)
  assert.notEqual(resizeEnd, -1)
  assert.notEqual(requestIndex, -1)
  assert.ok(cacheIndex > requestIndex)
  assert.ok(fallbackIndex > cacheIndex)
})
