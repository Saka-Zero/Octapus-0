import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import { renderMarkdown } from './markdown';
import { getTheme, Theme } from './theme';
import { TextInput } from './TextInput';
import { ModelPicker } from './ModelPicker';
import { SessionPicker } from './SessionPicker';
import { Router } from '../router';
import { ConversationSession } from '../utils/history';
import { Config } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  timestamp: number;
}

interface ChatAppProps {
  router: Router;
  session: ConversationSession;
  config: Config;
  options: any;
}

// ── Terminal size hook (ink 3 has no useStdinDimensions) ────────────────────────

function useTerminalSize() {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });
  useEffect(() => {
    const onResize = () =>
      setSize({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);
  return size;
}

// ── Animated spinner ───────────────────────────────────────────────────────────

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) { setFrame(0); return; }
    const id = setInterval(() => setFrame((f) => (f + 1) % SPIN_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return SPIN_FRAMES[frame];
}

// ── Blinking cursor for streaming ──────────────────────────────────────────────

function useBlinkCursor(active: boolean): string {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setOn((v) => !v), 530);
    return () => clearInterval(id);
  }, [active]);
  return active ? (on ? '▌' : ' ') : '';
}

// ── Status bar — single-line colored segments, no width math ───────────────────

const StatusBar: React.FC<{
  theme: Theme;
  model: string;
  tokenUsage?: { input: number; output: number };
  info?: string;
  agentBusy: boolean;
  width: number;
}> = ({ theme, model, tokenUsage, info, agentBusy, width }) => {
  const spin = useSpinner(agentBusy);

  // Shorten model name if too long
  const modelLabel = model.length > 28 ? model.slice(0, 25) + '…' : model;
  const tokenLabel = tokenUsage
    ? `${tokenUsage.input.toLocaleString()} in · ${tokenUsage.output.toLocaleString()} out`
    : null;

  return (
    <Box width={width} flexDirection="row">
      {/* help shortcut */}
      <Text backgroundColor={theme.backgroundDarker} color={theme.textMuted}>
        {' ctrl+? help '}
      </Text>

      {/* token counter — only when there's data */}
      {tokenLabel && (
        <Text
          backgroundColor={
            tokenUsage && tokenUsage.input > 100000
              ? theme.warning
              : theme.backgroundSecondary
          }
          color={tokenUsage && tokenUsage.input > 100000 ? theme.background : theme.text}
        >
          {' ' + tokenLabel + ' '}
        </Text>
      )}

      {/* info / error line */}
      {info && info.length > 0 && (
        <Text backgroundColor={theme.error} color={theme.background}>
          {' ' + info.slice(0, Math.max(0, width - 80)) + ' '}
        </Text>
      )}

      {/* thinking spinner */}
      {agentBusy && (
        <Text backgroundColor={theme.accent} color={theme.background}>
          {' ' + spin + ' thinking… '}
        </Text>
      )}

      {/* right-aligned model tag — pushed by remaining space via flex */}
      <Text> </Text>
      <Text backgroundColor={theme.secondary} color={theme.background} bold>
        {' ' + modelLabel + ' '}
      </Text>
    </Box>
  );
};

// ── Message component with left border ─────────────────────────────────────────

const MessageComponent: React.FC<{
  message: Message;
  theme: Theme;
  width: number;
  streaming: boolean;
}> = ({ message, theme, width, streaming }) => {
  const borderColors: Record<string, string> = {
    user: theme.secondary,
    assistant: theme.primary,
    system: theme.accent,
    tool: theme.accent,
  };
  const color = borderColors[message.role] || theme.textMuted;

  const rendered = renderMarkdown(message.content, { theme });

  // Hook must always be called — condition is inside
  const cursor = useBlinkCursor(streaming);

  return (
    <Box width={width} flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text color={color}>┃ </Text>
      </Box>
      <Box flexDirection="column" width={width - 2}>
        <Text color={color} bold>
          {message.role === 'user'
            ? 'You'
            : message.model
            ? message.model
            : message.role.charAt(0).toUpperCase() + message.role.slice(1)}
        </Text>
        <Text wrap="wrap">
          {rendered}
          {cursor ? <Text color={theme.accent}>{cursor}</Text> : null}
        </Text>
      </Box>
    </Box>
  );
};

// ── Main ChatApp ───────────────────────────────────────────────────────────────

export const ChatApp: React.FC<ChatAppProps> = ({
  router,
  session,
  config,
  options,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [streamingMsg, setStreamingMsg] = useState<number | null>(null);
  const [model, setModel] = useState(
    options?.model || config.defaultModel || 'gpt-4'
  );
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { exit } = useApp();
  const { columns: termWidth, rows: termHeight } = useTerminalSize();

  const themeName = (config as any).theme as string | undefined;
  const theme = getTheme(themeName);

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const scrollRef = useRef<number>(0);

  useEffect(() => {
    busyRef.current = agentBusy;
  }, [agentBusy]);

  // Auto-scroll: keep bottom visible
  useEffect(() => {
    scrollRef.current = messages.length;
  }, [messages.length]);

  // ── Send handler with streaming ──────────────────────────────────────────────

  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || busyRef.current) return;

      const userMsg: Message = {
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setAgentBusy(true);
      setStreamingMsg(null);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const msgsForProvider = [
          ...messages.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
          { role: 'user' as const, content: text.trim() },
        ];

        const chatGen = router.chat({
          model,
          messages: msgsForProvider,
          options: { model, stream: true, quiet: true },
          fallbackModels: config.fallbackModels,
        });

        let content = '';
        let firstChunk = true;

        for await (const event of chatGen) {
          if (controller.signal.aborted) break;

          if (event.type === 'text') {
            content += event.text;

            if (firstChunk) {
              // Insert assistant message placeholder
              const idx = messages.length + 1; // +1 for the user msg we just added
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content,
                  model,
                  timestamp: Date.now(),
                },
              ]);
              setStreamingMsg(idx);
              firstChunk = false;
            } else {
              // Update last message in place
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content };
                }
                return updated;
              });
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Unknown error');
        }
      } finally {
        setAgentBusy(false);
        setStreamingMsg(null);
        abortRef.current = null;
      }
    },
    [messages, model, router, config]
  );

  const handleAbort = useCallback(() => {
    if (busyRef.current && abortRef.current) {
      abortRef.current.abort();
      setAgentBusy(false);
      setStreamingMsg(null);
    }
  }, []);

  // ── Key bindings ─────────────────────────────────────────────────────────────

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      handleAbort();
      exit();
    }
    if (key.ctrl && inputChar === 'm') setShowModelPicker((p) => !p);
    if (key.ctrl && inputChar === 's') setShowSessionPicker((p) => !p);
    if (key.ctrl && inputChar === 'l') setMessages([]);
  });

  // ── Layout ───────────────────────────────────────────────────────────────────

  const statusBarH = 1;
  const headerH = 1;
  const inputH = 3;
  const chatH = termHeight - statusBarH - headerH - inputH;

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* ── Header ── */}
      <Box
        width={termWidth}
        height={headerH}
        justifyContent="center"
        borderStyle="single"
        borderBottom={true}
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.borderDim}
      >
        <Text color={theme.primary} bold>{'⚙ '}</Text>
        <Text color={theme.secondary}>{session.title || 'New Session'}</Text>
        <Text color={theme.textMuted}>{' │ '}</Text>
        <Text color={theme.textMuted}>{process.cwd()}</Text>
      </Box>

      {/* ── Chat area + Input ── */}
      <Box flexDirection="column" width={termWidth} height={chatH + inputH}>
        {/* ── Messages viewport ── */}
        <Box
          flexDirection="column"
          width={termWidth}
          height={chatH}
          overflow="hidden"
        >
          {messages.length === 0 ? (
            <Box justifyContent="center" alignItems="center" height={chatH}>
              <Text color={theme.textMuted}>
                Start a conversation… (Ctrl+M model · Ctrl+S sessions)
              </Text>
            </Box>
          ) : (
            messages.map((msg, i) => (
              <MessageComponent
                key={`${msg.timestamp}-${i}`}
                message={msg}
                theme={theme}
                width={termWidth}
                streaming={streamingMsg === i}
              />
            ))
          )}
        </Box>

        {error && error.length > 0 && (
          <Box width={termWidth} paddingLeft={2}>
            <Text color={theme.error}>{'✖ ' + error}</Text>
          </Box>
        )}

        {/* ── Input ── */}
        <Box
          width={termWidth}
          height={inputH}
          borderStyle="single"
          borderTop={true}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor={agentBusy ? theme.accent : theme.borderFocused}
        >
          <TextInput
            placeholder={agentBusy ? 'Agent is thinking…' : 'Type a message…'}
            disabled={agentBusy}
            onSubmit={handleSend}
          />
        </Box>
      </Box>

      {/* ── Status bar ── */}
      <StatusBar
        theme={theme}
        model={model}
        info={error ? error : undefined}
        agentBusy={agentBusy}
        width={termWidth}
      />

      {/* ── Overlays ── */}
      {showModelPicker && (
        <ModelPicker
          router={router}
          currentModel={model}
          onSelect={(m: string) => {
            setModel(m);
            setShowModelPicker(false);
          }}
          onClose={() => setShowModelPicker(false)}
        />
      )}

      {showSessionPicker && (
        <SessionPicker
          currentSessionId={session.id}
          onSelect={(_s: ConversationSession) => {
            setShowSessionPicker(false);
          }}
          onClose={() => setShowSessionPicker(false)}
        />
      )}
    </Box>
  );
};
