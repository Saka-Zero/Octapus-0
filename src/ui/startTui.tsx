import { render } from 'ink';
import { ChatApp } from './ChatApp';
import { Router } from '../router';
import { ConversationSession } from '../utils/history';

/**
 * Mount the Ink-based TUI and resolve when the user exits.
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
  await instance.waitUntilExit();
}
