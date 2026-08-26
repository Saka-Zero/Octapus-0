import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import { renderMarkdown } from './markdown';
import { getTheme, listThemeNames, Theme } from './theme';
import { TextInput } from './TextInput';
import { ModelPicker } from './ModelPicker';
import { SessionPicker } from './SessionPicker';
import { CommandMenu } from './CommandMenu';
import {
  useSpinner,
  useBlinkCursor,
  useAnimatedDots,
  usePulse,
  useBatchedText,
} from './effects';
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

// ── Terminal size (ink 3 has no useStdinDimensions) ─────────────────────────────

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

// ── Status bar ─────────────────────────────────────────────────────────────────

const StatusBar: React.FC<{
  theme: Theme;
  model: string;
  tokenUsage?: { input: number; output: number };
  info?: string;
  agentBusy: boolean;
  width: number;
  messageCount: number;
}> = ({ theme, model, tokenUsage, info, agentBusy, width, messageCount }) => {
  const spin = useSpinner(agentBusy, 'braille');
  const thinkingLabel = useAnimatedDots('thinking', agentBusy, 400);
  const modelLabel = model.length > 28 ? model.slice(0, 25) + '…' : model;

  return (
    <Box width={width} flexDirection="row">
      {/* help */}
      <Text backgroundColor={theme.backgroundDarker} color={theme.textMuted}>
        {' ctrl+R menu '}
      </Text>

      {/* message count */}
      <Text backgroundColor={theme.backgroundSecondary} color={theme.textMuted}>
        {' ' + messageCount + ' msgs '}
      </Text>

      {/* token counter */}
      {tokenUsage && tokenUsage.input > 0 ? (
        <Text
          backgroundColor={
            tokenUsage.input > 100000 ? theme.warning : theme.backgroundSecondary
          }
          color={
            tokenUsage.input > 100000 ? theme.background : theme.text
          }
        >
          {' ' + tokenUsage.input.toLocaleString() + ' in · ' + tokenUsage.output.toLocaleString() + ' out '}
        </Text>
      ) : null}

      {/* error info */}
      {info && info.length > 0 ? (
        <Text backgroundColor={theme.error} color={theme.background}>
          {' ✖ ' + info.slice(0, Math.max(0, width - 100)) + ' '}
        </Text>
      ) : null}

      {/* thinking spinner */}
      {agentBusy ? (
        <Text backgroundColor={theme.accent} color={theme.background} bold>
          {' ' + spin + ' ' + thinkingLabel + ' '}
        </Text>
      ) : null}

      {/* spacer — pushes model to the right */}
      <Text> </Text>

      {/* model tag */}
      <Text backgroundColor={theme.secondary} color={theme.background} bold>
        {' ' + modelLabel + ' '}
      </Text>
    </Box>
  );
};

// ── Streaming message with smooth batched text ─────────────────────────────────

const StreamingMessage: React.FC<{
  content: string;
  model?: string;
  theme: Theme;
  width: number;
}> = ({ content, model, theme, width }) => {
  const cursor = useBlinkCursor(true);
  const rendered = renderMarkdown(content, { theme });

  return (
    <Box width={width} flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text color={theme.primary}>┃ </Text>
      </Box>
      <Box flexDirection="column" width={width - 2}>
        <Text color={theme.primary} bold>{model || 'Assistant'}</Text>
        <Text wrap="wrap">
          {rendered}
          <Text color={theme.accent}>{cursor}</Text>
        </Text>
      </Box>
    </Box>
  );
};

// ── Static (completed) message ─────────────────────────────────────────────────

const StaticMessage: React.FC<{
  message: Message;
  theme: Theme;
  width: number;
}> = ({ message, theme, width }) => {
  const borderColors: Record<string, string> = {
    user: theme.secondary,
    assistant: theme.primary,
    system: theme.accent,
    tool: theme.accent,
  };
  const color = borderColors[message.role] || theme.textMuted;
  const rendered = renderMarkdown(message.content, { theme });

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
        <Text wrap="wrap">{rendered}</Text>
      </Box>
    </Box>
  );
};

// ── Thinking indicator (shown while waiting for first chunk) ───────────────────

const ThinkingIndicator: React.FC<{ theme: Theme; width: number }> = ({
  theme,
  width,
}) => {
  const spin = useSpinner(true, 'braille');
  const dots = useAnimatedDots('awaiting response', true, 500);
  const pulse = usePulse(theme.accent, theme.textMuted, 600);

  return (
    <Box width={width} flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text color={pulse}>┃ </Text>
      </Box>
      <Box flexDirection="column" width={width - 2}>
        <Text color={theme.textMuted} dim>
          {' ' + spin + ' ' + dots}
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
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [streamingModel, setStreamingModel] = useState<string>('');
  const [model, setModel] = useState(
    options?.model || config.defaultModel || 'gpt-4'
  );
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { exit } = useApp();
  const { columns: termWidth, rows: termHeight } = useTerminalSize();

  const themeName = (config as any).theme as string | undefined;
  const theme = getTheme(themeName);

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  // Batched text accumulator for smooth streaming
  const batched = useBatchedText(30);

  useEffect(() => {
    busyRef.current = agentBusy;
  }, [agentBusy]);

  // Sync batched text → streaming state (React re-render)
  useEffect(() => {
    if (streamingContent !== null) {
      setStreamingContent(batched.text);
    }
  }, [batched.text]);

  // ── Send handler ─────────────────────────────────────────────────────────────

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
      setError(null);
      setStreamingContent(''); // empty = waiting for first chunk
      batched.reset();

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

        let firstChunk = true;

        for await (const event of chatGen) {
          if (controller.signal.aborted) break;

          if (event.type === 'text') {
            if (firstChunk) {
              setStreamingModel(model);
              firstChunk = false;
            }
            // Push to batched buffer — flushed at 30ms intervals for smooth rendering
            batched.push(event.text);
          }
        }

        // Finalize: move streamed text into messages array
        const finalContent = batched.text;
        if (finalContent.length > 0) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: finalContent,
              model,
              timestamp: Date.now(),
            },
          ]);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Unknown error');
          // If we got partial content, still save it
          if (batched.text.length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: batched.text + '\n\n⚠ Stream interrupted: ' + (err.message || 'error'),
                model,
                timestamp: Date.now(),
              },
            ]);
          }
        }
      } finally {
        setAgentBusy(false);
        setStreamingContent(null);
        setStreamingModel('');
        batched.reset();
        abortRef.current = null;
      }
    },
    [messages, model, router, config, batched]
  );

  const handleAbort = useCallback(() => {
    if (busyRef.current && abortRef.current) {
      abortRef.current.abort();
      setAgentBusy(false);
      setStreamingContent(null);
      setStreamingModel('');
      batched.reset();
    }
  }, [batched]);

  // ── Command menu action handler ─────────────────────────────────────────────

  const handleCommandAction = useCallback(
    (action: string, payload?: any) => {
      switch (action) {
        case 'session:new':
          setShowSessionPicker(true);
          break;
        case 'session:switch':
          // Session switching handled by parent; close menu
          setShowCommandMenu(false);
          break;
        case 'model:switch':
          if (payload?.modelId) {
            setModel(payload.modelId);
          }
          break;
        case 'provider:switch':
          // Provider toggle: update config in memory and notify
          if (payload?.providerName && config.providers[payload.providerName]) {
            config.providers[payload.providerName].enabled = payload.enabled;
          }
          break;
        case 'view:clear':
          setMessages([]);
          break;
        case 'view:theme':
          if (payload?.themeName) {
            (config as any).theme = payload.themeName;
          } else {
            // Cycle to next theme
            const names = listThemeNames();
            const current = (config as any).theme as string | undefined;
            const idx = names.indexOf(current || 'octapus');
            (config as any).theme = names[(idx + 1) % names.length];
          }
          break;
        case 'view:reset':
          setMessages([]);
          break;
        case 'tools:toggle-agent':
        case 'tools:toggle-plan':
        case 'tools:list':
          // Delegate to parent handler
          break;
        case 'export:last': {
          const lastAssistant = [...messages]
            .reverse()
            .find((m) => m.role === 'assistant');
          if (lastAssistant) {
            // Copy to clipboard via process
            try {
              require('child_process').execSync(
                `echo ${JSON.stringify(lastAssistant.content)} | clip`,
                { timeout: 500 }
              );
            } catch {
              // clip may not be available; silently ignore
            }
          }
          break;
        }
        case 'export:history': {
          // Export to JSON file
          try {
            const fs = require('fs');
            const path = require('path');
            const exportDir = path.join(
              process.env.HOME || process.env.USERPROFILE || '',
              '.config',
              'octapus',
              'exports'
            );
            if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
            const filename = `chat-export-${Date.now()}.json`;
            fs.writeFileSync(
              path.join(exportDir, filename),
              JSON.stringify({ session, messages }, null, 2)
            );
          } catch {
            // Export failed silently
          }
          break;
        }
        case 'export:digest':
          // Digest save — for now just log
          break;
        default:
          break;
      }
    },
    [messages, session, config, router]
  );

  // ── Key bindings ─────────────────────────────────────────────────────────────

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      handleAbort();
      exit();
    }
    if (key.ctrl && inputChar === 'r') setShowCommandMenu((p) => !p);
    if (key.ctrl && inputChar === 'm') setShowModelPicker((p) => !p);
    if (key.ctrl && inputChar === 's') setShowSessionPicker((p) => !p);
    if (key.ctrl && inputChar === 'l') setMessages([]);
  });

  // ── Layout ───────────────────────────────────────────────────────────────────

  const statusBarH = 1;
  const headerH = 1;
  const inputH = 3;
  // 2 extra lines of margin to strictly prevent any border/render overflow
  const chatH = termHeight - statusBarH - headerH - inputH - 2; // = termHeight - 7

  // Count tokens used (rough estimate from messages)
  const tokenUsage = messages.length > 0
    ? {
        input: messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0),
        output: messages
          .filter((m) => m.role === 'assistant')
          .reduce((s, m) => s + Math.ceil(m.content.length / 4), 0),
      }
    : undefined;

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
      <Box flexDirection="column" width={termWidth}>
        {/* ── Messages viewport ── */}
        <Box flexDirection="column" width={termWidth}>
          {messages.length === 0 && !agentBusy ? (
            <Box justifyContent="center" alignItems="center" height={chatH}>
              <Text color={theme.textMuted}>
                Start a conversation… (Ctrl+R menu · Ctrl+M model · Ctrl+S sessions)
              </Text>
            </Box>
          ) : (
            messages.map((msg, i) => (
              <StaticMessage
                key={`${msg.timestamp}-${i}`}
                message={msg}
                theme={theme}
                width={termWidth}
              />
            ))
          )}

          {/* Streaming indicator — waiting for first chunk */}
          {agentBusy && streamingContent === '' ? (
            <ThinkingIndicator theme={theme} width={termWidth} />
          ) : null}

          {/* Streaming message — receiving chunks */}
          {agentBusy && streamingContent !== null && streamingContent.length > 0 ? (
            <StreamingMessage
              content={streamingContent}
              model={streamingModel}
              theme={theme}
              width={termWidth}
            />
          ) : null}
        </Box>

        {/* Error line */}
        {error && error.length > 0 ? (
          <Box width={termWidth} paddingLeft={2}>
            <Text color={theme.error}>{'✖ ' + error}</Text>
          </Box>
        ) : null}

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
        tokenUsage={tokenUsage}
        info={error ? error : undefined}
        agentBusy={agentBusy}
        width={termWidth}
        messageCount={messages.length}
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

      {showCommandMenu && (
        <CommandMenu
          router={router}
          config={config}
          currentModel={model}
          currentSessionId={session.id}
          onClose={() => setShowCommandMenu(false)}
          onAction={handleCommandAction}
        />
      )}
    </Box>
  );
};
