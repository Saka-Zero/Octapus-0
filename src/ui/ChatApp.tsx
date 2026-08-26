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
import { setPlanMode, isPlanMode } from '../tools';
import { listCheckpoints, restoreCheckpoint } from '../checkpoints';
import { mcpManager } from '../mcp';
import { getTheme, listThemeNames } from './theme';
import { execSync } from 'child_process';
import { classifyIntent, domainLabel, DOMAIN_PERSONAS, Domain } from '../utils/roles';
import { runCouncil } from '../council';
import * as fs from 'fs';
import * as path from 'path';
import { formatProjectContext } from '../utils/projectContext';
import { listCustomAgents, getCustomAgent, CustomAgent } from '../utils/customAgents';
import { loadCustomCommands, expandCommand } from '../utils/customCommands';
import { loadPlugins, pluginSystemPrompt, getPluginCount } from '../plugins';

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
  | { kind: 'diff'; title: string; lines: string[] }
  | { kind: 'tool'; glyph: string; verb: string; args: string; detail?: string };

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

function buildSystemPrompt(config: any, userSystem?: string, activeSkillText?: string, persona?: string, agentPrompt?: string): string {
  const parts: string[] = [];
  // Custom agent persona takes precedence over the default genius prompt
  parts.push(agentPrompt || userSystem || config.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);
  const projectCtx = formatProjectContext();
  if (projectCtx) parts.push(projectCtx);
  if (config.settings.useMemory !== false) {
    const facts = getAllFacts();
    if (facts.length > 0) {
      const lines = facts.slice(0, 30).map((f) => `- ${f.key}: ${f.value}`);
      parts.push(`[Long-term memory about the user — always apply this context]\n${lines.join('\n')}`);
    }
  }
  if (activeSkillText) parts.push(activeSkillText);
  if (persona) parts.push(persona);
  const pluginCtx = pluginSystemPrompt();
  if (pluginCtx) parts.push(pluginCtx);
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
  const [themeName, setThemeName] = useState<string>(config.settings.theme || 'octapus');
  const theme = getTheme(themeName);

  const [display, setDisplay] = useState<DisplayItem[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  // Council is the DEFAULT experience: every prompt = all specialists deliberate
  const [councilMode, setCouncilMode] = useState(config.settings.councilMode !== false);
  const [pendingApproval, setPendingApproval] = useState<{ tool: string; summary: string; resolve: (ok: boolean) => void } | null>(null);
  const [activeAgent, setActiveAgent] = useState<CustomAgent | null>(null);

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
  const lastToolArgsRef = useRef('{}');

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

  // Abort in-flight generation on unmount — prevents zombie token burn
  useEffect(() => () => { abortRef.current?.abort(); }, []);

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

    // Classify intent → route to the right specialist
    const domain: Domain = classifyIntent(prompt);
    pushNote(`🎯 ${domainLabel(domain)}`);

    const messages = getMessagesForApi(sessionRef.current);
    const sysContent = buildSystemPrompt(config, options.system, skillText, DOMAIN_PERSONAS[domain], activeAgent?.systemPrompt);
    if (sysContent) {
      const idx = messages.findIndex((m) => m.role === 'system');
      if (idx >= 0) messages[idx] = { role: 'system', content: sysContent };
      else messages.unshift({ role: 'system', content: sysContent });
    }

    // @file mentions — attach referenced files to the request
    const mentions = [...prompt.matchAll(/@([\w./\\-]+)/g)].map((m) => m[1]);
    let attachments = '';
    for (const rel of mentions.slice(0, 5)) {
      try {
        const fp = path.resolve(rel);
        const stat = fs.statSync(fp);
        if (!stat.isFile() || stat.size > 200 * 1024) {
          pushNote(`⚠ @${rel}: not a file or too large (>200KB)`);
          continue;
        }
        const content = fs.readFileSync(fp, 'utf8');
        attachments += `\n\n[Attached file: ${rel}]\n\`\`\`\n${content.slice(0, 40000)}${content.length > 40000 ? '\n… (truncated)' : ''}\n\`\`\``;
        pushNote(`📎 Attached ${rel} (${content.length} chars)`);
      } catch {
        pushNote(`⚠ @${rel}: not found`);
      }
    }
    if (attachments) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser) lastUser.content += `\n${attachments}`;
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
        const result = await runAgentTurn(router, messages, model, config, { ...options, signal: controller.signal, domain, sessionId: sessionRef.current.id }, {
          onText: (chunk) => {
            if (!flushTimer) { setThinking(false); startFlusher(); }
            streamText += chunk;
          },
          onToolStart: (name, argsStr) => { lastToolArgsRef.current = argsStr; pushNote(`⠙ ${name} ${argsStr}`); },
          onToolResult: (name, ok, output, diff) => {
            if (!ok) {
              setDisplay((d) => [...d, { kind: 'error', text: `✗ ${name} — ${output.slice(0, 200)}` }]);
              return;
            }
            // OpenCode-style single-line tool rows: glyph + verb + args (+ dim detail)
            let parsedArgs: any = {};
            try { parsedArgs = JSON.parse(lastToolArgsRef.current || '{}'); } catch {}
            const map: Record<string, { glyph: string; verb: string; args: string; detail?: string }> = {
              read_file: { glyph: '→', verb: 'Read', args: String(parsedArgs.path || '') },
              list_dir: { glyph: '→', verb: 'List', args: String(parsedArgs.path || '.') },
              search_files: { glyph: '✱', verb: 'Search', args: `"${parsedArgs.pattern || ''}" in ${parsedArgs.path || 'src'}`, detail: `${output.split('\n').length - 1} lines` },
              web_search: { glyph: '✱', verb: 'Web', args: `"${parsedArgs.query || ''}"` },
              web_fetch: { glyph: '→', verb: 'Fetch', args: String(parsedArgs.url || '') },
              write_file: { glyph: '→', verb: fs.existsSync(String(parsedArgs.path || '')) ? 'Write' : 'Create', args: String(parsedArgs.path || '') },
              replace_in_file: { glyph: '→', verb: 'Edit', args: String(parsedArgs.path || '') },
              run_command: { glyph: '$', verb: '', args: String(parsedArgs.command || '') },
              task_progress: { glyph: '↳', verb: 'Focus chain', args: `${output.match(/(\d+)\/\d+/)?.[0] || ''} steps` }
            };
            const row = map[name] || { glyph: '✓', verb: name, args: JSON.stringify(parsedArgs).slice(0, 80) };

            if (name === 'write_file' || name === 'replace_in_file') {
              if (diff && diff.length > 0) {
                setDisplay((d) => [...d, { kind: 'tool', ...row }, { kind: 'diff', title: '', lines: diff }]);
              } else {
                setDisplay((d) => [...d, { kind: 'tool', ...row, detail: output.slice(0, 60) }]);
              }
            } else {
              setDisplay((d) => [...d, { kind: 'tool', ...row }]);
            }
          },
          approval: (tool, summary) =>
            new Promise<boolean>((resolve) => {
              if (config.settings.agentAutoApprove) return resolve(true);
              setPendingApproval({ tool, summary, resolve });
            }),
          onPlanRequest: (planSummary) =>
            new Promise<boolean>((resolve) => {
              setPendingApproval({ tool: 'switch_to_act_mode', summary: planSummary || 'Begin executing the presented plan', resolve });
            })
        });
        streamText = result.finalText || streamText;
      } else if (councilMode) {
        // 🏛️ COUNCIL — multi-AI deliberation
        setThinking(false);
        const result = await runCouncil(router, prompt, messages, config, { ...options, signal: controller.signal }, {
          onPhase: (phase) => pushNote(phase),
          onParticipant: (provider, role, status, detail) => {
            const icon = status === 'start' ? '⏳' : status === 'done' ? '✔' : '✗';
            pushNote(`${icon} ${provider} [${role}]${detail ? ` — ${detail}` : ''}`);
          },
          onDebate: (provider, points) => pushNote(`⚔️ ${provider}: ${points}…`)
        });
        stopFlusher();
        streamText = result.finalText;
        lastProviderRef.current = `council(${result.participants.map((p) => p.provider).join('+')})`;
        setStreaming(null);
        addMessage(sessionRef.current, 'assistant', streamText);
        lastAssistantRef.current = streamText;
        setDisplay((d) => [...d, { kind: 'assistant', text: streamText }]);
        const tIn = estimateTokens(messages.map((m) => m.content).join(' '));
        const tOut = estimateTokens(streamText);
        setTotals((t) => ({ tokensIn: t.tokensIn + Math.round(tIn), tokensOut: t.tokensOut + Math.round(tOut), cost: t.cost }));
        void updateDigest(router, sessionRef.current, config);
        return; // council handles its own persistence — skip normal path
      } else {
        for await (const ev of router.chat({
          model,
          messages,
          options: makeOpts(),
          fallbackModels: options.fallback ? config.fallbackModels : [],
          domain
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
          '/plan              Plan mode: research only, approve before execute',
          '/council           Council mode: all AIs debate → 1 super answer',
          '/memory            Show long-term memory facts',
          '/remember <k> <v>  Store a fact permanently',
          '/forget <key>      Delete a memory fact',
          '/skills            List available skills',
          '/agents            List custom agents (markdown personas)',
          '/use <name>        Activate a custom agent (/use off to exit)',
          '/learn <lesson>    Teach me a lesson permanently',
          '/digest            Show rolling conversation digest',
          '/compact           Summarize session → free up context window',
          '/checkpoints       List auto-saved workspace snapshots',
          '/restore <n>       Restore files to checkpoint n',
          '/plugins           List loaded plugins',
          '/mcp               List MCP servers & their tools',
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
        const next = !agentMode;
        setAgentMode(next);
        if (next && councilMode) {
          // Mutually exclusive — agent wins, council disabled explicitly
          setCouncilMode(false);
          config.settings.councilMode = false;
          saveConfig(config);
          pushNote('🤖 Agent mode ON — council auto-disabled (mutually exclusive). /council to switch back.');
        } else {
          pushNote(next
            ? '🤖 Agent mode ON — I can read/write files, run commands, search code. Sensitive actions ask first (/agent auto to skip).'
            : '🤖 Agent mode OFF.');
        }
        return true;
      }

      case '/council': {
        const next = !councilMode;
        setCouncilMode(next);
        config.settings.councilMode = next;
        saveConfig(config);
        if (next && agentMode) {
          setAgentMode(false);
          pushNote('🏛️ Council mode ON — agent mode auto-disabled (mutually exclusive). /agent to switch back.');
        } else {
          pushNote(next
            ? '🏛️ Council mode ON — every prompt goes to a round of ALL active specialists: independent analysis → cross-debate → synthesis into one super answer.'
            : '💬 Council mode OFF — single specialist answers (faster).');
        }
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

      case '/agents': {
        const all = listCustomAgents();
        if (all.length === 0) {
          pushNote('No custom agents. Create ~/.config/octapus/agents/<name>.md with frontmatter (description/model/temperature/role) + body as system prompt.');
        } else {
          const lines = all.map((a) => `${a.name.padEnd(20)} ${a.model || '(default model)'} — ${a.description.slice(0, 55)}`);
          pushNote(`Custom agents (${all.length}):\n${lines.join('\n')}\n\nActivate: /use <name> · Deactivate: /use off`);
        }
        return true;
      }

      case '/use': {
        if (!args || args === 'off') {
          setActiveAgent(null);
          pushNote('Custom agent deactivated — back to default persona.');
          return true;
        }
        const agent = getCustomAgent(args);
        if (!agent) {
          pushNote(`Agent not found: ${args}. Available: ${listCustomAgents().map((a) => a.name).join(', ')}`);
          return true;
        }
        setActiveAgent(agent);
        if (agent.model) {
          sessionRef.current.model = agent.model;
          saveSession(sessionRef.current);
          setHeaderModel(agent.model);
        }
        pushNote(`🎭 Agent "${agent.name}" active${agent.model ? ` (model: ${agent.model})` : ''}\n${agent.description}`);
        return true;
      }

      case '/plugins': {
        const all = loadPlugins();
        if (all.length === 0) {
          pushNote('No plugins loaded. Drop .js files into ~/.config/octapus/plugins/\nHooks: onBeforeToolCall(name,args)→{block,reason,args} · onAfterToolCall · onSystemPrompt()→string · onBeforeRequest(opts)→opts');
        } else {
          pushNote(`Plugins (${all.length}):\n${all.map((p) => `- ${p.name}`).join('\n')}`);
        }
        return true;
      }

      case '/compact': {
        if (busy) { pushNote('⏳ Busy — /compact queued after current turn.'); queueRef.current.push('/compact'); return true; }
        setBusy(true);
        const snapshotMsgs = [...sessionRef.current.messages];
        pushNote('Compacting session…');
        void (async () => {
          try {
            const msgs = snapshotMsgs.filter((m) => m.role !== 'system');
            if (msgs.length < 6) { pushNote('Session too short to compact.'); return; }
            const transcript = msgs.map((m) => `${m.role}: ${m.content.slice(0, 800)}`).join('\n').slice(0, 30000);
            let summary = '';
            for await (const ev of router.chat({
              model: sessionRef.current.model,
              messages: [{ role: 'user', content: `Summarize this conversation into a dense digest preserving: user facts, decisions, technical details, open threads. Drop pleasantries.\n\n${transcript}` }],
              options: { model: sessionRef.current.model, maxTokens: 1500, temperature: 0.2, quiet: true },
              fallbackModels: config.fallbackModels || []
            })) {
              if (ev.type === 'text') summary += ev.text;
            }
            if (summary.trim().length > 50) {
              // Reconcile instead of replace: keep messages that arrived DURING compaction
              const cur = sessionRef.current;
              const snapshotSet = new Set(snapshotMsgs);
              const arrivedDuring = cur.messages.filter((m) => !snapshotSet.has(m));
              const recentOld = cur.messages.filter((m) => m.role !== 'system').slice(-4);
              const keptSet = new Set([...recentOld, ...arrivedDuring]);
              cur.digest = summary.trim();
              const sys = cur.messages.find((m) => m.role === 'system');
              cur.messages = [...(sys ? [sys] : []), ...cur.messages.filter((m) => keptSet.has(m))];
              saveSession(cur);
              pushNote(`✓ Compacted: ${msgs.length} messages → digest. Context fresh again.`);
            } else {
              pushNote('Compact failed — summary empty.');
            }
          } catch (e) {
            pushNote(`Compact failed: ${e instanceof Error ? e.message : e}`);
          } finally {
            setBusy(false);
            if (queueRef.current.length > 0) {
              const next = queueRef.current.shift()!;
              setTimeout(() => handleSubmit(next), 30);
            }
          }
        })();
        return true;
      }

      case '/plan': {
        if (!agentMode) {
          pushNote('Plan mode requires agent mode. Enable /agent first.');
          return true;
        }
        const next = !isPlanMode();
        setPlanMode(next);
        pushNote(next
          ? '📋 PLAN MODE ON — research only. I will investigate, then present a numbered plan for your approval before touching anything.'
          : '🔨 PLAN MODE OFF — act mode. Full toolset unlocked.');
        return true;
      }

      case '/checkpoints': {
        pushNote('Loading checkpoints…');
        void (async () => {
          const cps = await listCheckpoints(sessionRef.current.id, process.cwd());
          if (cps.length === 0) {
            pushNote('No checkpoints yet — they are created automatically after agent file writes/commands.');
          } else {
            const lines = cps.map((c, i) => `[${cps.length - i}] ${c.hash.slice(0, 8)} ${c.date.slice(0, 19)} — ${c.label.slice(0, 60)}`);
            pushNote(`Checkpoints (newest first):\n${lines.join('\n')}\n\nRestore: /restore <number>  e.g. /restore 1`);
          }
        })();
        return true;
      }

      case '/restore': {
        const num = parseInt(args, 10);
        if (!args || isNaN(num)) { pushNote('Usage: /restore <number> (see /checkpoints)'); return true; }
        pushNote('Restoring…');
        void (async () => {
          const cps = await listCheckpoints(sessionRef.current.id, process.cwd());
          // Displayed newest-first: [1] = newest
          const target = cps[cps.length - num];
          if (!target) { pushNote(`Checkpoint #${num} not found.`); return; }
          const r = await restoreCheckpoint(sessionRef.current.id, process.cwd(), target.hash);
          if (r.ok) pushNote(`⏪ ${r.output}`);
          else setDisplay((d) => [...d, { kind: 'error', text: `✗ ${r.output}` }]);
        })();
        return true;
      }

      case '/mcp': {
        pushNote('Connecting to MCP servers…');
        void (async () => {
          const cfg = mcpManager.getConfig();
          const names = Object.keys(cfg);
          if (names.length === 0) {
            pushNote('No MCP servers configured. Create ~/.config/octapus/mcp.json:\n{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/path"] }\n  }\n}\nTools appear automatically in agent mode.');
            return;
          }
          const tools = await mcpManager.getAllTools();
          const lines = names.map((n) => {
            const count = tools.filter((t) => t.server === n).length;
            return `● ${n} — ${count} tools`;
          });
          pushNote(`MCP servers:\n${lines.join('\n')}\n\nMCP tools are available in /agent mode as mcp_<server>_<tool>.`);
        })();
        return true;
      }

      case '/chain': {
        const { getFocusChain } = require('../utils/focusChain');
        const chain = getFocusChain(sessionRef.current.id);
        pushNote(chain ? `Focus chain:\n${chain}` : 'No focus chain — the agent creates one via task_progress during long tasks.');
        return true;
      }

      case '/theme': {
        if (!args) {
          pushNote(`Current theme: ${theme.name}. Available: ${listThemeNames().join(', ')}\nUsage: /theme <name>`);
        } else if (listThemeNames().includes(args)) {
          config.settings.theme = args;
          saveConfig(config);
          setThemeName(args);
          pushNote(`✓ Theme switched to: ${args}`);
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

      default: {
        // Custom commands from ~/.config/octapus/commands/*.md
        const cmdName = cmd.slice(1);
        const custom = loadCustomCommands().find((c) => c.name === cmdName);
        if (custom) {
          const expanded = expandCommand(custom, args);
          pushNote(`⚡ /${custom.name}${args ? ` ${args}` : ''}`);
          void sendToAI(expanded);
          return true;
        }
        pushNote(`Unknown command: ${cmd} — type /help`);
        return true;
      }
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
          <Box key={i} flexDirection="column" marginTop={1} paddingLeft={2}>
            {item.kind === 'user' && (
              <Box flexDirection="column">
                <Text color={theme.primary} bold>You</Text>
                <Text color={theme.text}>{item.text}</Text>
              </Box>
            )}
            {item.kind === 'assistant' && (
              <Text>{renderMarkdown(item.text, { accent: theme.primary, muted: theme.borderActive })}</Text>
            )}
            {item.kind === 'note' && (
              <Text color={theme.textMuted} italic>{item.text}</Text>
            )}
            {item.kind === 'error' && (
              <Box flexDirection="column">
                <Text color={theme.error}>{'│'}</Text>
                <Text color={theme.error}>{'│  '}{item.text}</Text>
                <Text color={theme.error}>{'│'}</Text>
              </Box>
            )}
            {item.kind === 'tool' && (
              <Box flexDirection="column">
                <Text>
                  <Text color={theme.accent}>{item.glyph + ' '}</Text>
                  <Text bold>{item.verb + ' '}</Text>
                  <Text color={theme.text}>{item.args}</Text>
                  {item.detail && <Text color={theme.textMuted}>{'  ' + item.detail}</Text>}
                </Text>
              </Box>
            )}
            {item.kind === 'diff' && (
              <Box flexDirection="column" paddingLeft={2}>
                {item.lines.map((l, li) => (
                  <Text key={li} color={l.startsWith('+') ? theme.diffAdded : l.startsWith('-') ? theme.diffRemoved : theme.textMuted}>
                    {'  ' + l}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* OpenCode-faithful: NO header. Metadata lives in the footer. */}

      {/* Streaming */}
      {(thinking || streaming !== null) && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {thinking && <Spinner label="thinking… (esc interrupts)" color={theme.accent} />}
          {streaming !== null && (
            <Text>{renderMarkdown(streaming, { accent: theme.primary, muted: theme.borderActive })}</Text>
          )}
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

      {/* Input — rounded bordered composer (OpenCode style) */}
      {!pickerOpen && !sessionPickerOpen && !pendingApproval && (
        <Box
          borderStyle="round"
          borderColor={busy ? theme.border : theme.borderActive}
          paddingX={1}
          marginTop={1}
        >
          <TextInput
            placeholder={busy ? (queueRef.current.length ? `queued: ${queueRef.current.length}` : 'esc interrupts…') : 'Plan any feature… (/help)'}
            disabled={busy}
            history={inputHistory}
            onSubmit={handleSubmit}
          />
        </Box>
      )}

      {/* Footer line 1: model · modes · memory | tokens · cost (dim) */}
      <Box justifyContent="space-between" marginTop={0}>
        <Text color={theme.textMuted}>
          {headerModel}
          {agentMode ? ' · agent' : ''}
          {isPlanMode() ? ' · plan' : ''}
          {councilMode ? ' · council' : ''}
          {'  ·  '}
          mem {memoryCount} · prov {enabledCount}
        </Text>
        <Text color={theme.textMuted}>
          {new Intl.NumberFormat('en-US').format(totals.tokensIn)}→{new Intl.NumberFormat('en-US').format(totals.tokensOut)} tok ·{' '}
          <Text color={totals.cost === 0 ? theme.success : theme.warning}>{formatCost(totals.cost)}</Text>
        </Text>
      </Box>

      {/* Footer line 2: keybind hints (dimmest) */}
      <Text dimColor>
        {'/help commands   /models picker   /agent tools   /council debate   esc interrupt'}
      </Text>
    </Box>
  );
}
