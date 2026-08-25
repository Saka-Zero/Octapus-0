import { render } from 'ink';
import { ChatApp } from './ChatApp';
import { Router } from '../router';
import { ConversationSession } from '../utils/history';
import { mcpManager } from '../mcp';

/**
 * Mount the Ink-based TUI and resolve when the user exits.
 * Registers full lifecycle teardown: MCP children hold ref'd stdio pipes,
 * so without explicit disconnectAll the node process survives its terminal
 * as an invisible zombie burning API tokens in the background.
 */
export async function startTui(
  router: Router,
  session: ConversationSession,
  config: any,
  options: any
): Promise<void> {
  const instance = render(
    <ChatApp router={router} session={session} config={config} options={options} />
  );

  let cleanedUp = false;
  const teardown = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { mcpManager.disconnectAll(); } catch {}
    try { instance.unmount(); } catch {}
  };

  // Terminal/window death vectors (Windows delivers these unreliably — register all)
  process.once('SIGINT', () => { teardown(); process.exit(130); });
  process.once('SIGTERM', () => { teardown(); process.exit(143); });
  process.once('SIGHUP', teardown);
  process.once('exit', teardown);

  try {
    await instance.waitUntilExit();
  } finally {
    teardown();
  }
}
