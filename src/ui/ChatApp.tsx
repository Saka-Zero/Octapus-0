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

// ── Custom hook: terminal dimensions (ink 3 has no useStdinDimensions) ──────────

function useTerminalSize() {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}

// ── Status Bar — OpenCode colored block layout ─────────────────────────────────

const StatusBar: React.FC<{
  theme: Theme;
  model: string;
  tokenUsage?: { input: number; output: number };
  info?: string;
  agentBusy: boolean;
  width: number;
}> = ({ theme, model, tokenUsage, info, agentBusy, width }) => {
  const helpText = 'ctrl+? help';
  const tokenText = tokenUsage
    ? `${tokenUsage.input} in / ${tokenUsage.output} out`
    : '';
  const modelText = model.length > 30 ? '...' + model.slice(-27) : model;
  const statusText = agentBusy ? '● thinking...' : '';

  // OpenCode-style colored blocks
  const helpW = helpText.length + 2;
  const tokenW = tokenText ? tokenText.length + 2 : 0;
  const modelW = modelText.length + 2;
  const statusW = statusText ? statusText.length + 2 : 0;
  const infoW = info
    ? Math.min(info.length + 2, width - helpW - tokenW - modelW - statusW)
    : 0;
  const fillW = Math.max(0, width - helpW - tokenW - modelW - statusW - infoW);

  return (
    <Box width={width}>
      <Box width={helpW} justifyContent="center">
        <Text backgroundColor={theme.backgroundDarker} color={theme.textMuted}>
          {helpText}
        </Text>
      </Box>

      {tokenText.length > 0 && (
        <Box width={tokenW} justifyContent="center">
          <Text
            backgroundColor={
              tokenUsage && tokenUsage.input > 100000
                ? theme.warning
                : theme.backgroundSecondary
            }
            color={theme.background}
          >
            {tokenText}
          </Text>
        </Box>
      )}

      {info && (
        <Box width={infoW} justifyContent="center">
          <Text backgroundColor={theme.primary} color={theme.background}>
            {info}
          </Text>
        </Box>
      )}

      {statusText.length > 0 && (
        <Box width={statusW} justifyContent="center">
          <Text backgroundColor={theme.accent} color={theme.background}>
            {statusText}
          </Text>
        </Box>
      )}

      <Box width={modelW} justifyContent="center">
        <Text backgroundColor={theme.secondary} color={theme.background}>
          {modelText}
        </Text>
      </Box>

      {fillW > 0 && (
        <Box width={fillW}>
          <Text> </Text>
        </Box>
      )}
    </Box>
  );
};

// ── Message Component ──────────────────────────────────────────────────────────

const MessageComponent: React.FC<{
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
  const borderChar = '┃';
  const color = borderColors[message.role] || theme.textMuted;

  const rendered = renderMarkdown(message.content, { theme });

  return (
    <Box width={width} flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text color={color}>{borderChar} </Text>
      </Box>

      <Box flexDirection="column" width={width - 2}>
        <Text color={color} bold>
          {message.role === 'user'
            ? 'You'
            : message.role === 'assistant'
            ? message.model || 'Assistant'
            : message.role}
        </Text>
        <Text wrap="wrap">{rendered}</Text>
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
  const [model, setModel] = useState(
    options?.model || config.defaultModel || 'gpt-4'
  );
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { exit } = useApp();
  const { columns: termWidth, rows: termHeight } = useTerminalSize();

  // Read theme name from config if available
  const themeName = (config as any).theme as string | undefined;
  const theme = getTheme(themeName);

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    busyRef.current = agentBusy;
  }, [agentBusy]);

  // Handle send — stream from router
  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || busyRef.current) return;

      const userMessage: Message = {
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setAgentBusy(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const messagesForProvider = [
          ...messages.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
          { role: 'user' as const, content: text.trim() },
        ];

        const chatGen = router.chat({
          model,
          messages: messagesForProvider,
          options: { model, stream: true, quiet: true },
          fallbackModels: config.fallbackModels,
        });

        let assistantContent = '';
        let firstChunk = true;

        for await (const event of chatGen) {
          if (controller.signal.aborted) break;

          if (event.type === 'text') {
            assistantContent += event.text;
            if (firstChunk) {
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: assistantContent,
                  model,
                  timestamp: Date.now(),
                },
              ]);
              firstChunk = false;
            } else {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: assistantContent,
                  };
                }
                return updated;
              });
            }
          }
          // tool_calls and usage events are ignored for now in TUI
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Unknown error');
        }
      } finally {
        setAgentBusy(false);
        abortRef.current = null;
      }
    },
    [messages, model, router, config]
  );

  const handleAbort = useCallback(() => {
    if (busyRef.current && abortRef.current) {
      abortRef.current.abort();
      setAgentBusy(false);
    }
  }, []);

  // Key bindings
  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      handleAbort();
      exit();
    }
    if (key.ctrl && inputChar === 'm') {
      setShowModelPicker((prev) => !prev);
    }
    if (key.ctrl && inputChar === 's') {
      setShowSessionPicker((prev) => !prev);
    }
    if (key.ctrl && inputChar === 'l') {
      setMessages([]);
    }
  });

  // Layout (OpenCode split pane style)
  const statusBarHeight = 1;
  const headerHeight = 1;
  const inputHeight = 3;
  const chatHeight = termHeight - statusBarHeight - headerHeight - inputHeight;

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* ── Header — Logo + session + cwd ── */}
      <Box
        width={termWidth}
        height={headerHeight}
        justifyContent="center"
        borderStyle="single"
        borderBottom={true}
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.borderDim}
      >
        <Text color={theme.primary} bold>
          {'⚙ '}
        </Text>
        <Text color={theme.secondary}>
          {session.title || 'New Session'}
        </Text>
        <Text color={theme.textMuted}> │ </Text>
        <Text color={theme.textMuted}>
          {process.cwd()}
        </Text>
      </Box>

      {/* ── Main content ── */}
      <Box
        flexDirection="column"
        width={termWidth}
        height={chatHeight + inputHeight}
      >
        {/* ── Messages viewport ── */}
        <Box
          flexDirection="column"
          width={termWidth}
          height={chatHeight}
          overflow="hidden"
        >
          {messages.length === 0 ? (
            <Box
              justifyContent="center"
              alignItems="center"
              height={chatHeight}
            >
              <Text color={theme.textMuted}>
                Start a conversation... (Ctrl+M to change model)
              </Text>
            </Box>
          ) : (
            messages.map((msg, i) => (
              <MessageComponent
                key={`${msg.timestamp}-${i}`}
                message={msg}
                theme={theme}
                width={termWidth}
              />
            ))
          )}

          {agentBusy && (
            <Box width={termWidth}>
              <Text color={theme.accent}>{'● '}</Text>
              <Text color={theme.textMuted}>thinking...</Text>
            </Box>
          )}
        </Box>

        {error && (
          <Box width={termWidth} paddingLeft={2}>
            <Text color={theme.error}>✖ {error}</Text>
          </Box>
        )}

        {/* ── Input area — bordered editor ── */}
        <Box
          width={termWidth}
          height={inputHeight}
          borderStyle="single"
          borderTop={true}
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor={agentBusy ? theme.accent : theme.borderFocused}
        >
          <TextInput
            placeholder={
              agentBusy ? 'Agent is thinking...' : 'Type a message...'
            }
            disabled={agentBusy}
            onSubmit={handleSend}
          />
        </Box>
      </Box>

      {/* ── Status bar — OpenCode colored block style ── */}
      <StatusBar
        theme={theme}
        model={model}
        info={error ? `Error: ${error}` : undefined}
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
