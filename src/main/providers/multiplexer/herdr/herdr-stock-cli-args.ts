import {
  asRecord,
  assertNoLeadingDash,
  optionalFlag,
  optionalLabelFlag,
  requiredNumber,
  requiredString,
  tokenFlags
} from './herdr-stock-cli-flags'
import { herdrStockCliAgentArgs, herdrStockCliPaneArgs } from './herdr-stock-cli-pane-args'

export function herdrStockCliArgs(method: string, rawParams: unknown): string[] {
  const params = asRecord(rawParams)
  const paneArgs = herdrStockCliPaneArgs(method, params)
  if (paneArgs) {
    return paneArgs
  }
  const agentArgs = herdrStockCliAgentArgs(method, params)
  if (agentArgs) {
    return agentArgs
  }
  switch (method) {
    case 'workspace.create':
      return [
        'workspace',
        'create',
        ...optionalFlag('--cwd', params.cwd),
        ...optionalLabelFlag(params.label),
        params.focus ? '--focus' : '--no-focus'
      ]
    case 'workspace.list':
      return ['workspace', 'list']
    case 'workspace.get':
      return ['workspace', 'get', requiredString(params.workspace_id, 'workspace_id')]
    case 'workspace.focus':
      return ['workspace', 'focus', requiredString(params.workspace_id, 'workspace_id')]
    case 'workspace.rename':
      return [
        'workspace',
        'rename',
        requiredString(params.workspace_id, 'workspace_id'),
        requiredString(params.label, 'label')
      ]
    case 'workspace.report_metadata':
      return [
        'workspace',
        'report-metadata',
        requiredString(params.workspace_id, 'workspace_id'),
        '--source',
        requiredString(params.source, 'source'),
        ...tokenFlags(params.tokens),
        ...optionalFlag('--ttl-ms', params.ttl_ms),
        ...optionalFlag('--seq', params.seq)
      ]
    case 'workspace.close':
      return ['workspace', 'close', requiredString(params.workspace_id, 'workspace_id')]
    case 'worktree.open':
      return [
        'worktree',
        'open',
        ...optionalFlag('--cwd', params.cwd),
        ...optionalFlag('--path', params.path),
        ...optionalFlag('--branch', params.branch),
        ...optionalLabelFlag(params.label),
        params.focus ? '--focus' : '--no-focus'
      ]
    case 'worktree.list':
      return ['worktree', 'list', ...optionalFlag('--cwd', params.cwd)]
    case 'worktree.create':
      return [
        'worktree',
        'create',
        ...optionalFlag('--cwd', params.cwd),
        ...optionalFlag('--path', params.path),
        ...optionalFlag('--branch', params.branch),
        ...optionalFlag('--base', params.base),
        ...optionalLabelFlag(params.label),
        params.focus ? '--focus' : '--no-focus'
      ]
    case 'worktree.remove':
      return [
        'worktree',
        'remove',
        requiredString(params.workspace_id, 'workspace_id'),
        ...(params.force ? ['--force'] : [])
      ]
    case 'tab.create':
      return [
        'tab',
        'create',
        '--workspace',
        requiredString(params.workspace_id, 'workspace_id'),
        ...optionalFlag('--cwd', params.cwd),
        ...optionalLabelFlag(params.label),
        params.focus ? '--focus' : '--no-focus'
      ]
    case 'tab.list':
      return ['tab', 'list', ...optionalFlag('--workspace', params.workspace_id)]
    case 'tab.get':
      return ['tab', 'get', requiredString(params.tab_id, 'tab_id')]
    case 'tab.focus':
      return ['tab', 'focus', requiredString(params.tab_id, 'tab_id')]
    case 'tab.rename':
      return [
        'tab',
        'rename',
        requiredString(params.tab_id, 'tab_id'),
        requiredString(params.label, 'label')
      ]
    case 'tab.move':
      return [
        'tab',
        'move',
        requiredString(params.tab_id, 'tab_id'),
        '--insert-index',
        requiredNumber(params.insert_index, 'insert_index')
      ]
    case 'tab.close':
      return ['tab', 'close', requiredString(params.tab_id, 'tab_id')]
    case 'session.snapshot':
      return ['api', 'snapshot']
    case 'notification.show':
      return [
        'notification',
        'show',
        assertNoLeadingDash(requiredString(params.title, 'title'), 'title'),
        ...optionalFlag('--body', params.body),
        ...optionalFlag('--position', params.position),
        ...optionalFlag('--sound', params.sound)
      ]
    case 'server.live_handoff':
      return [
        'server',
        'live-handoff',
        ...optionalFlag('--expected-protocol', params.expected_protocol),
        ...optionalFlag('--expected-version', params.expected_version),
        ...optionalFlag('--import-exe', params.import_exe)
      ]
    default:
      throw new Error(`Unsupported stock Herdr CLI request: ${method}`)
  }
}
