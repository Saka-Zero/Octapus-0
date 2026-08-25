import { useState, useRef, useEffect } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import { Router } from '../router';
import { ConversationSession, saveSession, createSession, addMessage, getMessagesForApi, getHistoryText, clearAllHistory, getOverflowMessages, listSessions } from '../utils/history';
import { learnFromMessage, getAllFacts, rememberFact, forgetFact } from '../utils/memory';
import { estimateTokens, calculateCost, formatCost } from '../utils';
import { matchSkills, formatSkillsForPrompt, listSkills } from '../utils/skills';
import { loadConfig, saveConfig, DEFAULT_SYSTEM_PROMPT } from '../config';
import { renderMarkdown } from './markdown';
import { TextInput } from './TextInput';
import { ModelPicker } from './ModelPicker';
import { SessionPicker } from './SessionPicker';
import { runAgentTurn } from '../agent';
import { getTheme, listThemeNames } from './theme';
import { execSync } from 'child_process';

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
  | { kind: 'error'; text: string }
  | { kind: 'diff'; title: string; lines: string[] };

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function Spinner({ label, color }: { label: string; color: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box>
      <Text color={color}>{SPINNER_FRAMES[frame]} </Text>
      <Text dim>{label}</Text>
    </Box>
  );
}

function ApprovalPrompt({ tool, summary, onDecision }: { tool: string; summary: string; onDecision: (ok: boolean) => void }) {
  useInput((input, key) => {
    const lower = (input || '').toLowerCase();
    if (lower === 'y' || key.return) onDecision(true);
    else if (lower === 'n' || key.escape) onDecision(false);
  });
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1} marginTop={1}>
      <Text color="yellow" bold>⚠ Approval needed</Text>
      <Text>{tool}: </Text>
      <Text color="cyan">{summary}</Text>
      <Text dim>y = allow · n = deny</Text>
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
  if (activeSkillText) parts.push(activeSkillText);
  return parts.join('\n\n');
}

async function updateDigest(router: Router, session: ConversationSession, config: any): Promise<void> {
  try {
    const overflow = getOverflowMessages(session);
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
      if (chunk.type === 'text') summary += chunk.text;
    }
    const trimmed = summary.trim();
    if (trimmed.length > 50) {
      session.digest = trimmed;
      saveSession(session);
    }
  } catch {
    // best-effort
  }
}

export function ChatApp({ router, session: initialSession, config, options }: ChatAppProps) {
  const { exit } = useApp();
  const theme = getTheme(config.settings.theme);

  const [display, setDisplay] = useState<DisplayItem[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ tool: string; summary: string; resolve: (ok: boolean) => void } | null>(null);

  const sessionRef = useRef<ConversationSession>(initialSession);
  const [headerModel, setHeaderModel] = useState(initialSession.model);
  const [headerSessionId, setHeaderSessionId] = useState(initialSession.id);
  const [memoryCount, setMemoryCount] = useState(getAllFacts().length);

  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [totals, setTotals] = useState({ tokensIn: 0, tokensOut: 0, cost: 0 });
  const lastProviderRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<string[]>([]);
  const lastAssistantRef = useRef('');

  const enabledCount = Object.values(config.providers as Record<string, { enabled?: boolean }>)
    .filter((p) => p.enabled).length;

  const pushNote = (text: string) => setDisplay((d) => [...d, { kind: 'note', text }]);
  const refreshMemoryCount = () => setMemoryCount(getAllFacts().length);

  // Esc interrupts generation
  useInput((input, key) => {
    if (key.escape && busy && !pendingApproval) {
      abortRef.current?.abort();
    }
  });

  // ─── Core send flow ───────────────────────────────────────────────
  const sendToAI = async (prompt: string) => {
    setBusy(true);
    setDisplay((d) => [...d, { kind: 'user', text: prompt }]);
    setInputHistory((h) => [...h, prompt]);

    addMessage(sessionRef.current, 'user', prompt);

    const learned = learnFromMessage(prompt);
    if (learned.length > 0) {
      pushNote(`🧠 Remembered: ${learned.join(', ')}`);
      refreshMemoryCount();
    }

    const matched = matchSkills(prompt);
    if (matched.length > 0) pushNote(`⚡ Skills: ${matched.map((s) => s.name).join(', ')}`);
    const skillText = formatSkillsForPrompt(matched);

    const messages = getMessagesForApi(sessionRef.current);
    const sysContent = buildSystemPrompt(config, options.system, skillText);
    if (sysContent) {
      const idx = messages.findIndex((m) => m.role === 'system');
      if (idx >= 0) messages[idx] = { role: 'system', content: sysContent };
      else messages.unshift({ role: 'system', content: sysContent });
    }

    const model = sessionRef.current.model;
    let streamText = '';

    let flushTimer: ReturnType<typeof setInterval> | null = null;
    const startFlusher = () => flushTimer = setInterval(() => setStreaming(streamText), 120);
    const stopFlusher = () => { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } };

    const controller = new AbortController();
    abortRef.current = controller;

    setThinking(true);
    let interrupted = false;
    try {
      const makeOpts = () => ({
        model,
        temperature: options.temperature ?? config.settings.temperature,
        maxTokens: options.maxTokens ?? config.settings.maxTokens,
        stream: true,
        disableFallback: options.fallback === false,
        quiet: true,
        signal: controller.signal
      });

      if (agentMode) {
        const result = await runAgentTurn(router, messages, model, config, { ...options, signal: controller.signal }, {
          onText: (chunk) => {
            if (!flushTimer) { setThinking(false); startFlusher(); }
            streamText += chunk;
          },
          onToolStart: (name, args) => pushNote(`🔧 ${name} ${args}`),
          onToolResult: (name, ok, output, diff) => {
            if (ok && diff && diff.length > 0) {
              setDisplay((d) => [...d, { kind: 'diff', title: `${name}: ${output.split('(')[0].trim()}`, lines: diff }]);
            } else {
              const preview = output.length > 300 ? output.slice(0, 300) + '…' : output;
              setDisplay((d) => [...d, { kind: 'note', text: `${ok ? '✔' : '✗'} ${name} → ${preview}` }]);
            }
          },
          approval: (tool, summary) =>
            new Promise<boolean>((resolve) => {
              if (config.settings.agentAutoApprove) return resolve(true);
              setPendingApproval({ tool, summary, resolve });
            })
        });
        streamText = result.finalText || streamText;
      } else {
        for await (const ev of router.chat({
          model,
          messages,
          options: makeOpts(),
          fallbackModels: options.fallback ? config.fallbackModels : []
        })) {
          if (ev.type === 'text') {
            if (!flushTimer) { setThinking(false); startFlusher(); }
            streamText += ev.text;
          } else if (ev.type === 'tool_calls') {
            streamText += `\n\n_(Model attempted tool use: ${ev.calls.map((c: any) => c.function.name).join(', ')}. Enable /agent to allow execution.)_`;
          }
        }
      }

      stopFlusher();
      setStreaming(null);
      if (streamText.trim()) {
        addMessage(sessionRef.current, 'assistant', streamText);
        lastAssistantRef.current = streamText;
        setDisplay((d) => [...d, { kind: 'assistant', text: streamText }]);
      }

      const tIn = estimateTokens(messages.map((m) => m.content).join(' '));
      const tOut = estimateTokens(streamText);
      const usage = { input: Math.round(tIn), output: Math.round(tOut), total: Math.round(tIn + tOut) };
      const cost = calculateCost(router.lastProvider || 'unknown', router.lastModel || model, usage);
      lastProviderRef.current = router.lastProvider || '';
      setTotals((t) => ({ tokensIn: t.tokensIn + usage.input, tokensOut: t.tokensOut + usage.output, cost: t.cost + cost }));

      void updateDigest(router, sessionRef.current, config);
    } catch (err: any) {
      stopFlusher();
      setStreaming(null);
      interrupted = err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('abort');
      if (interrupted) {
        if (streamText.trim()) {
          addMessage(sessionRef.current, 'assistant', streamText + '\n\n_(interrupted)_');
          lastAssistantRef.current = streamText;
          setDisplay((d) => [...d, { kind: 'assistant', text: streamText }]);
        }
        pushNote('⏹ Interrupted.');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setDisplay((d) => [...d, { kind: 'error', text: `✗ ${msg}` }]);
        pushNote('(Your message was saved. Try again or switch model via /model)');
      }
    } finally {
      abortRef.current = null;
      setStreaming(null);
      setThinking(false);
      setBusy(false);
      // Drain queued messages
      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        setTimeout(() => void sendToAI(next), 30);
      }
    }
  };

  // ─── Slash commands ───────────────────────────────────────────────
  const handleSlash = (input: string): boolean => {
    const cmd = input.split(' ')[0].toLowerCase();
    const args = input.slice(cmd.length).trim();

    switch (cmd) {
      case '/quit': case '/exit': case '/q':
        exit();
        return true;

      case '/help': {
        pushNote([
          '/quit, /exit, /q   Exit',
          '/history           Show conversation history',
          '/sessions          Switch between saved sessions',
          '/providers         Check all providers',
          '/clear             Clear ALL history & start new session',
          '/new               Start new session',
          '/model [name]      Show or change model',
          '/models            Interactive model picker',
          '/agent [auto]      Toggle agent mode (tools)',
          '/memory            Show long-term memory facts',
          '/remember <k> <v>  Store a fact permanently',
          '/forget <key>      Delete a memory fact',
          '/skills            List available skills',
          '/learn <lesson>    Teach me a lesson permanently',
          '/digest            Show rolling conversation digest',
          '/theme [name]      Switch theme (' + listThemeNames().join(', ') + ')',
          '/copy              Copy last AI response to clipboard'
        ].join('\n'));
        return true;
      }

      case '/history':
        pushNote(getHistoryText(sessionRef.current, 15));
        return true;

      case '/sessions':
        setSessionPickerOpen(true);
        return true;

      case '/providers':
        pushNote('Validating providers…');
        void (async () => {
          try {
            const results = await router.validateAllKeys();
            const status = router.getProviderStatus();
            const lines = Object.entries(status).map(([name, s]) => {
              if (!s.enabled) return `○ ${name.padEnd(14)} disabled`;
              const ok = results[name];
              return `${ok ? '●' : '✗'} ${name.padEnd(14)} ${ok ? 'connected' : 'FAILED'}  (prio ${s.priority})`;
            });
            setDisplay((d) => [...d, { kind: 'note', text: `Providers:\n${lines.join('\n')}` }]);
          } catch (err) {
            setDisplay((d) => [...d, { kind: 'error', text: `Provider check failed: ${err instanceof Error ? err.message : String(err)}` }]);
          }
        })();
        return true;

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
          pushNote(`Current model: ${sessionRef.current.model}\nUsage: /model <name> or /models for interactive picker`);
        }
        return true;
      }

      case '/agent': {
        if (args === 'auto') {
          config.settings.agentAutoApprove = !config.settings.agentAutoApprove;
          saveConfig(config);
          pushNote(`Agent auto-approve: ${config.settings.agentAutoApprove ? 'ON' : 'OFF'}`);
          return true;
        }
        setAgentMode((v) => !v);
        pushNote(agentMode
          ? '🤖 Agent mode OFF.'
          : '🤖 Agent mode ON — I can read/write files, run commands, search code. Sensitive actions ask first (/agent auto to skip).');
        return true;
      }

      case '/memory': {
        const facts = getAllFacts();
        if (facts.length === 0) pushNote('Long-term memory is empty.');
        else {
          const lines = facts.map((f) => `${f.key}${f.source === 'auto' ? ' [auto]' : ' [manual]'}: ${f.value}`);
          pushNote(`Long-term memory (${facts.length} facts):\n${lines.join('\n')}`);
        }
        return true;
      }

      case '/skills': {
        const all = listSkills();
        if (all.length === 0) pushNote('No skills found.');
        else {
          const lines = all.map((s) => `${s.name.padEnd(30)} — ${s.description.slice(0, 60)}`);
          pushNote(`Skills (${all.length}) — auto-activated when relevant:\n${lines.join('\n')}`);
        }
        return true;
      }

      case '/remember': {
        const spaceIdx = args.indexOf(' ');
        if (!args || spaceIdx === -1) pushNote('Usage: /remember <key> <value>');
        else {
          rememberFact(args.slice(0, spaceIdx).trim(), args.slice(spaceIdx + 1).trim(), 'manual');
          refreshMemoryCount();
          pushNote(`✓ Remembered.`);
        }
        return true;
      }

      case '/forget': {
        if (!args) pushNote('Usage: /forget <key>');
        else if (forgetFact(args.trim())) { refreshMemoryCount(); pushNote(`✓ Forgot: ${args.trim()}`); }
        else pushNote(`Key not found: ${args.trim()}`);
        return true;
      }

      case '/learn': {
        if (!args || args.length < 10) pushNote('Usage: /learn <lesson>');
        else {
          rememberFact(`lesson.${args.split(/\s+/).slice(0, 4).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '')}`, args, 'manual');
          refreshMemoryCount();
          pushNote(`🧠 Lesson stored:\n${args}`);
        }
        return true;
      }

      case '/digest':
        pushNote(
          sessionRef.current.digest
            ? `Rolling digest:\n${sessionRef.current.digest}`
            : 'No digest yet — builds automatically when history exceeds the context window.'
        );
        return true;

      case '/theme': {
        if (!args) {
          pushNote(`Current theme: ${theme.name}. Available: ${listThemeNames().join(', ')}\nUsage: /theme <name>`);
        } else if (listThemeNames().includes(args)) {
          config.settings.theme = args;
          saveConfig(config);
          pushNote(`✓ Theme switched to: ${args} (fully applied on next launch)`);
        } else {
          pushNote(`Unknown theme: ${args}. Available: ${listThemeNames().join(', ')}`);
        }
        return true;
      }

      case '/copy': {
        const text = lastAssistantRef.current;
        if (!text) { pushNote('Nothing to copy yet.'); return true; }
        try {
          const isWin = process.platform === 'win32';
          execSync(isWin ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : 'xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] } as any);
          pushNote(`📋 Copied ${text.length} chars to clipboard.`);
        } catch {
          pushNote('Clipboard copy failed on this platform.');
        }
        return true;
      }

      default:
        pushNote(`Unknown command: ${cmd} — type /help`);
        return true;
    }
  };

  const handleSubmit = (value: string) => {
    if (busy) {
      queueRef.current.push(value);
      pushNote(`⏳ Queued (${queueRef.current.length} pending)`);
      return;
    }
    if (value.startsWith('/')) { handleSlash(value); return; }
    void sendToAI(value);
  };

  return (
    <Box flexDirection="column">
      <Static items={display}>
        {(item: DisplayItem, i: number) => (
          <Box key={i} flexDirection="column" marginTop={1}>
            {item.kind === 'user' && (
              <Box>
                <Text color={theme.userLabel} bold>{'You › '}</Text>
                <Text color={theme.userText}>{item.text}</Text>
              </Box>
            )}
            {item.kind === 'assistant' && (
              <Box flexDirection="column">
                <Text color={theme.aiLabel} bold>{'Octapus ›'}</Text>
                <Text>{renderMarkdown(item.text)}</Text>
              </Box>
            )}
            {item.kind === 'note' && (
              <Box paddingLeft={2}><Text dim italic>{item.text}</Text></Box>
            )}
            {item.kind === 'error' && (
              <Box paddingLeft={2}><Text color={theme.error}>{item.text}</Text></Box>
            )}
            {item.kind === 'diff' && (
              <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
                <Text color={theme.highlight} bold>{item.title}</Text>
                {item.lines.map((l, li) => (
                  <Text key={li} color={l.startsWith('+') ? theme.success : l.startsWith('-') ? theme.error : undefined}>
                    {l}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* Header */}
      <Box borderStyle="round" borderColor={theme.border} flexDirection="column" paddingX={1} marginTop={display.length === 0 ? 0 : 1}>
        <Text>
          <Text color={theme.accent} bold>🐙 Octapus</Text>
          <Text dim> multi-provider AI CLI{agentMode ? ' ' : ''}{agentMode && <Text color={theme.warn} bold>[AGENT]</Text>}</Text>
        </Text>
        <Text dim>
          model: <Text color={theme.highlight}>{headerModel}</Text>
          {'  │  '}session: <Text color={theme.highlight}>{headerSessionId}</Text>
          {'  │  '}memory: <Text color={theme.highlight}>{memoryCount}</Text>
          {'  │  '}providers: <Text color={theme.highlight}>{enabledCount}</Text>
        </Text>
        <Text dim>/help commands · /models picker · /agent tools · esc interrupts</Text>
      </Box>

      {/* Streaming */}
      {(thinking || streaming !== null) && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {thinking && <Spinner label="Thinking… (esc to interrupt)" color={theme.accent} />}
          {streaming !== null && <Text>{renderMarkdown(streaming)}</Text>}
        </Box>
      )}

      {/* Model picker */}
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

      {/* Session picker */}
      {sessionPickerOpen && (
        <Box marginTop={1}>
          <SessionPicker
            currentSessionId={headerSessionId}
            onSelect={(s) => {
              sessionRef.current = s;
              setHeaderSessionId(s.id);
              setHeaderModel(s.model);
              setSessionPickerOpen(false);
              pushNote(`✓ Loaded session ${s.id} — "${s.title}" (${s.messages.filter(m => m.role !== 'system').length} messages). New replies continue this session.`);
            }}
            onClose={() => setSessionPickerOpen(false)}
          />
        </Box>
      )}

      {/* Approval */}
      {pendingApproval && (
        <ApprovalPrompt
          tool={pendingApproval.tool}
          summary={pendingApproval.summary}
          onDecision={(ok) => { pendingApproval.resolve(ok); setPendingApproval(null); }}
        />
      )}

      {/* Input */}
      {!pickerOpen && !sessionPickerOpen && !pendingApproval && (
        <Box marginTop={1}>
          <TextInput
            placeholder={busy ? (queueRef.current.length ? `queued: ${queueRef.current.length}` : 'esc to interrupt…') : 'Type a message… (/help for commands)'}
            disabled={busy}
            history={inputHistory}
            onSubmit={handleSubmit}
          />
        </Box>
      )}

      {/* Status bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text dim>
          <Text color={theme.success}>● </Text>
          {lastProviderRef.current || 'ready'}
          {'  │  '}{headerModel}
          {agentMode ? `  │  ${agentMode ? '🤖 agent' : ''}` : ''}
        </Text>
        <Text dim>
          {totals.tokensIn.toLocaleString()}→{totals.tokensOut.toLocaleString()} tok
          {'  │  '}<Text color={totals.cost === 0 ? theme.success : theme.warn}>{formatCost(totals.cost)}</Text>
        </Text>
      </Box>
    </Box>
  );
}
