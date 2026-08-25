import { useState, useRef, useEffect } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import { Router } from '../router';
import { ConversationSession, saveSession, createSession, addMessage, getMessagesForApi, getHistoryText, clearAllHistory, getOverflowMessages } from '../utils/history';
import { learnFromMessage, getAllFacts, rememberFact, forgetFact } from '../utils/memory';
import { estimateTokens, calculateCost, formatCost } from '../utils';
import { matchSkills, formatSkillsForPrompt, listSkills } from '../utils/skills';
import { DEFAULT_SYSTEM_PROMPT } from '../config';
import { renderMarkdown } from './markdown';
import { TextInput } from './TextInput';
import { ModelPicker } from './ModelPicker';

interface ChatAppProps {
  router: Router;
  session: ConversationSession;
  config: any;
  options: any;
}

type DisplayItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string };

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box>
      <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>
      <Text dim>{label}</Text>
    </Box>
  );
}

function buildSystemPrompt(config: any, userSystem?: string, activeSkillText?: string): string {
  const parts: string[] = [];
  parts.push(userSystem || config.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);
  if (config.settings.useMemory !== false) {
    const facts = getAllFacts();
    if (facts.length > 0) {
      const lines = facts.slice(0, 30).map((f) => `- ${f.key}: ${f.value}`);
      parts.push(`[Long-term memory about the user — always apply this context]\n${lines.join('\n')}`);
    }
  }
  if (activeSkillText) {
    parts.push(activeSkillText);
  }
  return parts.join('\n\n');
}

/**
 * Rolling digest: fold turns that fell out of the context window into a
 * persistent AI-generated summary. Fire-and-forget; never blocks the user.
 */
async function updateDigest(router: Router, session: ConversationSession, config: any): Promise<void> {
  try {
    const overflow = getOverflowMessages(session);
    // Only bother when there's meaningful overflow to compress
    const overflowChars = overflow.reduce((a, m) => a + m.content.length, 0);
    if (overflow.length < 4 || overflowChars < 6000) return;

    const transcript = overflow
      .map((m) => `${m.role}: ${m.content.slice(0, 1500)}`)
      .join('\n')
      .slice(0, 24000);

    const prompt =
      `You maintain a rolling digest of a long conversation so no earlier context is ever lost.\n` +
      `Merge the NEW TURNS below into the EXISTING DIGEST, producing one updated digest.\n` +
      `Preserve: user facts & preferences, decisions made, names/paths/commands used, ` +
      `technical details, open questions and unfinished threads. Be dense — drop pleasantries.\n\n` +
      `EXISTING DIGEST:\n${session.digest || '(none yet)'}\n\n` +
      `NEW TURNS TO FOLD IN:\n${transcript}\n\n` +
      `Output ONLY the updated digest text.`;

    let summary = '';
    for await (const chunk of router.chat({
      model: session.model,
      messages: [{ role: 'user', content: prompt }],
      options: { model: session.model, maxTokens: 1500, temperature: 0.2, quiet: true },
      fallbackModels: config.fallbackModels || []
    })) {
      summary += chunk;
    }
    const trimmed = summary.trim();
    if (trimmed.length > 50) {
      session.digest = trimmed;
      saveSession(session);
    }
  } catch {
    // Digest update is best-effort; never surface errors to the user
  }
}

export function ChatApp({ router, session: initialSession, config, options }: ChatAppProps) {
  const { exit } = useApp();

  const [display, setDisplay] = useState<DisplayItem[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const sessionRef = useRef<ConversationSession>(initialSession);
  const [headerModel, setHeaderModel] = useState(initialSession.model);
  const [headerSessionId, setHeaderSessionId] = useState(initialSession.id);
  const [memoryCount, setMemoryCount] = useState(getAllFacts().length);

  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [totals, setTotals] = useState({ tokensIn: 0, tokensOut: 0, cost: 0 });
  const lastProviderRef = useRef('');

  // Count enabled providers once for the header
  const enabledCount = Object.values(config.providers as Record<string, { enabled?: boolean }>)
    .filter((p) => p.enabled).length;

  const pushNote = (text: string) => setDisplay((d) => [...d, { kind: 'note', text }]);
  const refreshMemoryCount = () => setMemoryCount(getAllFacts().length);

  // ─── Core send flow ───────────────────────────────────────────────
  const sendToAI = async (prompt: string) => {
    setBusy(true);
    setDisplay((d) => [...d, { kind: 'user', text: prompt }]);
    setInputHistory((h) => [...h, prompt]);

    // Persist user message BEFORE the API call (survives failures)
    addMessage(sessionRef.current, 'user', prompt);

    // Auto-learn facts
    const learned = learnFromMessage(prompt);
    if (learned.length > 0) {
      pushNote(`🧠 Remembered: ${learned.join(', ')}`);
      refreshMemoryCount();
    }

    // Auto-match skills for this prompt
    const matched = matchSkills(prompt);
    if (matched.length > 0) {
      pushNote(`⚡ Skills: ${matched.map((s) => s.name).join(', ')}`);
    }
    const skillText = formatSkillsForPrompt(matched);

    const messages = getMessagesForApi(sessionRef.current);
    const sysContent = buildSystemPrompt(config, options.system, skillText);
    if (sysContent) {
      const idx = messages.findIndex((m) => m.role === 'system');
      if (idx >= 0) messages[idx] = { role: 'system', content: sysContent };
      else messages.unshift({ role: 'system', content: sysContent });
    }

    const model = sessionRef.current.model;
    const startTime = Date.now();
    let streamText = '';

    // Throttled streaming: accumulate locally, flush to state every 120ms
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    const startFlusher = () => {
      flushTimer = setInterval(() => setStreaming(streamText), 120);
    };
    const stopFlusher = () => {
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    };

    setThinking(true);
    try {
      for await (const chunk of router.chat({
        model,
        messages,
        options: {
          model,
          temperature: options.temperature ?? config.settings.temperature,
          maxTokens: options.maxTokens ?? config.settings.maxTokens,
          stream: options.stream ?? config.settings.stream,
          disableFallback: options.fallback === false,
          quiet: true
        },
        fallbackModels: options.fallback ? config.fallbackModels : []
      })) {
        if (!flushTimer) {
          setThinking(false);
          startFlusher();
        }
        streamText += chunk;
      }

      stopFlusher();
      const full = streamText;
      setStreaming(null);

      addMessage(sessionRef.current, 'assistant', full);
      setDisplay((d) => [...d, { kind: 'assistant', text: full }]);

      // Update running totals
      const tIn = estimateTokens(messages.map((m) => m.content).join(' '));
      const tOut = estimateTokens(full);
      const usage = { input: Math.round(tIn), output: Math.round(tOut), total: Math.round(tIn + tOut) };
      const cost = calculateCost(router.lastProvider || 'unknown', router.lastModel || model, usage);
      lastProviderRef.current = router.lastProvider || '';
      setTotals((t) => ({ tokensIn: t.tokensIn + usage.input, tokensOut: t.tokensOut + usage.output, cost: t.cost + cost }));

      // Rolling digest update — fire and forget, keeps memory bulletproof
      void updateDigest(router, sessionRef.current, config);
    } catch (err) {
      stopFlusher();
      setStreaming(null);
      const msg = err instanceof Error ? err.message : String(err);
      setDisplay((d) => [...d, { kind: 'error', text: `✗ ${msg}` }]);
      pushNote('(Your message was saved. Try again or switch model via /model)');
    } finally {
      setStreaming(null);
      setThinking(false);
      setBusy(false);
    }
  };

  // ─── Slash commands ───────────────────────────────────────────────
  const handleSlash = (input: string): boolean => {
    const cmd = input.split(' ')[0].toLowerCase();
    const args = input.slice(cmd.length).trim();

    switch (cmd) {
      case '/quit':
      case '/exit':
      case '/q':
        exit();
        return true;

      case '/help': {
        const help = [
          '/quit, /exit, /q   Exit interactive mode',
          '/history           Show conversation history',
          '/providers         Check all providers (connection + status)',
          '/clear             Clear ALL history & start new session',
          '/new               Start new session (keep old in scrollback)',
          '/model [name]      Show or change model',
          '/models            Interactive model picker (search + arrows)',
          '/memory            Show long-term memory facts',
          '/remember <k> <v>  Store a fact permanently',
          '/forget <key>      Delete a memory fact',
          '/skills            List available skills (auto-activate on match)',
          '/learn <lesson>    Teach me a lesson — stored permanently',
          '/digest            Show the rolling conversation digest'
        ].join('\n');
        pushNote(help);
        return true;
      }

      case '/digest':
        pushNote(
          sessionRef.current.digest
            ? `Rolling digest (${sessionRef.current.digest.length} chars):\n${sessionRef.current.digest}`
            : 'No digest yet — it builds automatically when history exceeds the context window.'
        );
        return true;

      case '/history':
        pushNote(getHistoryText(sessionRef.current, 15));
        return true;

      case '/providers': {
        pushNote('Validating providers…');
        void (async () => {
          try {
            const results = await router.validateAllKeys();
            const status = router.getProviderStatus();
            const lines = Object.entries(status).map(([name, s]) => {
              if (!s.enabled) return `○ ${name.padEnd(12)} disabled`;
              const ok = results[name];
              return `${ok ? '●' : '✗'} ${name.padEnd(12)} ${ok ? 'connected' : 'FAILED'}  (prio ${s.priority}, ${s.models.length} models)`;
            });
            setDisplay((d) => [...d, { kind: 'note', text: `Providers:\n${lines.join('\n')}` }]);
          } catch (err) {
            setDisplay((d) => [...d, { kind: 'error', text: `Provider check failed: ${err instanceof Error ? err.message : String(err)}` }]);
          }
        })();
        return true;
      }

      case '/clear':
        clearAllHistory();
        sessionRef.current = createSession(sessionRef.current.model);
        setHeaderSessionId(sessionRef.current.id);
        pushNote('✓ All history cleared, new session started.');
        return true;

      case '/new':
        sessionRef.current = createSession(sessionRef.current.model);
        setHeaderSessionId(sessionRef.current.id);
        pushNote('✓ New session started.');
        return true;

      case '/models':
        setPickerOpen(true);
        return true;

      case '/model': {
        if (args) {
          sessionRef.current.model = args;
          saveSession(sessionRef.current);
          setHeaderModel(args);
          pushNote(`✓ Model changed to: ${args}`);
        } else {
          const status = router.getProviderStatus();
          const lines = Object.entries(status)
            .filter(([, s]) => s.enabled && s.models.length > 0)
            .map(([name, s]) => {
              const shown = s.models.slice(0, 4).join(', ');
              const more = s.models.length > 4 ? ` …(+${s.models.length - 4})` : '';
              return `${name}: ${shown}${more}`;
            });
          pushNote(
            `Current model: ${sessionRef.current.model}\n` +
            (lines.length ? `\nAvailable:\n${lines.join('\n')}\n` : '') +
            `\nUsage: /model <name> or /models for interactive picker`
          );
        }
        return true;
      }

      case '/memory': {
        const facts = getAllFacts();
        if (facts.length === 0) {
          pushNote('Long-term memory is empty. Say "remember that ..." to store facts.');
        } else {
          const lines = facts.map((f) => `${f.key}${f.source === 'auto' ? ' [auto]' : ' [manual]'}: ${f.value}`);
          pushNote(`Long-term memory (${facts.length} facts):\n${lines.join('\n')}`);
        }
        return true;
      }

      case '/skills': {
        const all = listSkills();
        if (all.length === 0) {
          pushNote('No skills found. Add SKILL.md files to ~/.config/octapus/skills/<name>/');
        } else {
          const lines = all.map((s) => `${s.name.padEnd(30)} ${s.source === 'user' ? '[custom]' : '[bundled]'} — ${s.description.slice(0, 70)}`);
          pushNote(`Skills (${all.length}) — auto-activated when relevant:\n${lines.join('\n')}`);
        }
        return true;
      }

      case '/learn': {
        // Explicit self-development: store a lesson for future sessions
        if (!args || args.length < 10) {
          pushNote('Usage: /learn <lesson>  e.g. /learn PowerShell 5.1 has no && operator, use ; or if ($?)');
        } else {
          rememberFact(`lesson.${args.split(/\s+/).slice(0, 4).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '')}`, args, 'manual');
          refreshMemoryCount();
          pushNote(`🧠 Lesson stored — I'll apply it from now on:\n${args}`);
        }
        return true;
      }

      case '/remember': {
        const spaceIdx = args.indexOf(' ');
        if (!args || spaceIdx === -1) {
          pushNote('Usage: /remember <key> <value>');
        } else {
          const key = args.slice(0, spaceIdx).trim();
          const value = args.slice(spaceIdx + 1).trim();
          rememberFact(key, value, 'manual');
          refreshMemoryCount();
          pushNote(`✓ Remembered ${key} = ${value}`);
        }
        return true;
      }

      case '/forget': {
        if (!args) {
          pushNote('Usage: /forget <key>');
        } else if (forgetFact(args.trim())) {
          refreshMemoryCount();
          pushNote(`✓ Forgot: ${args.trim()}`);
        } else {
          pushNote(`Key not found: ${args.trim()}`);
        }
        return true;
      }

      default:
        pushNote(`Unknown command: ${cmd} — type /help`);
        return true;
    }
  };

  const handleSubmit = (value: string) => {
    if (busy) return;
    if (value.startsWith('/')) {
      handleSlash(value);
      return;
    }
    void sendToAI(value);
  };

  // Ctrl+C handled by ink (exitOnCtrlC default)

  return (
    <Box flexDirection="column">
      {/* Completed messages — rendered once into terminal scrollback */}
      <Static items={display}>
        {(item: DisplayItem, i: number) => (
          <Box key={i} flexDirection="column" marginTop={1}>
            {item.kind === 'user' && (
              <Box>
                <Text color="green" bold>{'You › '}</Text>
                <Text color="white">{item.text}</Text>
              </Box>
            )}
            {item.kind === 'assistant' && (
              <Box flexDirection="column">
                <Text color="cyan" bold>{'Octapus ›'}</Text>
                <Text>{renderMarkdown(item.text)}</Text>
              </Box>
            )}
            {item.kind === 'note' && (
              <Box paddingLeft={2}>
                <Text dim italic>{item.text}</Text>
              </Box>
            )}
            {item.kind === 'error' && (
              <Box paddingLeft={2}>
                <Text color="red">{item.text}</Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1} marginTop={display.length === 0 ? 0 : 1}>
        <Text>
          <Text color="magenta" bold>🐙 Octapus</Text>
          <Text dim> multi-provider AI CLI</Text>
        </Text>
        <Text dim>
          model: <Text color="yellow">{headerModel}</Text>
          {'  │  '}session: <Text color="yellow">{headerSessionId}</Text>
          {'  │  '}memory: <Text color="yellow">{memoryCount}</Text> facts
          {'  │  '}providers: <Text color="yellow">{enabledCount}</Text> enabled
        </Text>
        <Text dim>/help for commands · /providers to check connections</Text>
      </Box>

      {/* Streaming area */}
      {(thinking || streaming !== null) && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {thinking && <Spinner label="Thinking..." />}
          {streaming !== null && (
            <Text>{renderMarkdown(streaming)}</Text>
          )}
        </Box>
      )}

      {/* Model picker overlay */}
      {pickerOpen && (
        <Box marginTop={1}>
          <ModelPicker
            router={router}
            currentModel={headerModel}
            onSelect={(id) => {
              sessionRef.current.model = id;
              saveSession(sessionRef.current);
              setHeaderModel(id);
              setPickerOpen(false);
              pushNote(`✓ Model changed to: ${id}`);
            }}
            onClose={() => setPickerOpen(false)}
          />
        </Box>
      )}

      {/* Input */}
      {!pickerOpen && (
        <Box marginTop={1}>
          <TextInput
            placeholder={busy ? '' : 'Type a message… (/help for commands)'}
            disabled={busy}
            history={inputHistory}
            onSubmit={handleSubmit}
          />
        </Box>
      )}

      {/* Status bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text dim>
          <Text color="green">● </Text>
          {lastProviderRef.current || 'ready'}
          {'  │  '}
          {headerModel}
        </Text>
        <Text dim>
          {totals.tokensIn.toLocaleString()}→{totals.tokensOut.toLocaleString()} tok
          {'  │  '}
          <Text color={totals.cost === 0 ? 'green' : 'yellow'}>{formatCost(totals.cost)}</Text>
        </Text>
      </Box>
    </Box>
  );
}
