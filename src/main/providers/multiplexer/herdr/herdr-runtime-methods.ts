export const REQUIRED_HERDR_METHODS = [
  // Session
  'session.snapshot',

  // Workspace
  'workspace.create',
  'workspace.list',
  'workspace.get',
  'workspace.focus',
  'workspace.rename',
  'workspace.report_metadata',
  'workspace.close',
  'workspace.move',
  'workspace.move_block',

  // Worktree
  'worktree.open',
  'worktree.list',
  'worktree.create',
  'worktree.remove',

  // Tab
  'tab.create',
  'tab.list',
  'tab.get',
  'tab.focus',
  'tab.rename',
  'tab.move',
  'tab.close',

  // Pane
  'pane.split',
  'pane.get',
  'pane.focus',
  'pane.list',
  'pane.current',
  'pane.process_info',
  'pane.read',
  'pane.send_keys',
  'pane.send_text',
  'pane.wait_for_output',
  'pane.report_metadata',
  'pane.report_agent',
  'pane.report_agent_session',
  'pane.release_agent',
  'pane.close',
  'pane.rename',
  'pane.layout',
  'pane.neighbor',
  'pane.edges',
  'pane.zoom',
  'pane.swap',
  'pane.move',
  'pane.resize',

  // Agent
  'agent.list',
  'agent.get',
  'agent.wait',
  'agent.read',
  'agent.rename',
  'agent.focus',
  'agent.explain',
  'agent.start',
  'agent.prompt',
  'agent.send_keys',

  // Notification
  'notification.show',

  // Server
  'server.live_handoff',
  'server.stop',
  'server.reload_config',
  'server.agent_manifests',
  'server.reload_agent_manifests',

  // Events
  'events.subscribe',
  'events.wait',

  // Layout
  'layout.export',
  'layout.apply',
  'layout.set_split_ratio',

  // Pane socket-only
  'pane.focus_direction',
  'pane.send_input',
  'pane.clear_agent_authority',
  'pane.graphics.set',
  'pane.graphics.clear',
  'pane.graphics.info',

  // Agent socket-only
  'agent.view.set',
  'agent.view.clear',

  // Client
  'client.window_title.set',
  'client.window_title.clear',

  // Plugin
  'plugin.link',
  'plugin.list',
  'plugin.unlink',
  'plugin.enable',
  'plugin.disable',
  'plugin.action.list',
  'plugin.action.invoke',
  'plugin.log.list',
  'plugin.pane.open',
  'plugin.pane.focus',
  'plugin.pane.close',

  // Integration
  'integration.install',
  'integration.uninstall',

  // Popup
  'popup.close',

  // Ping
  'ping'
] as const
