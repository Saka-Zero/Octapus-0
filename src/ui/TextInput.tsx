import { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  placeholder?: string;
  disabled?: boolean;
  history?: string[];
  onSubmit: (value: string) => void;
}

/**
 * Single-line input with animated block cursor, submit flash,
 * paste support, and command-history navigation.
 */
export function TextInput({ placeholder, disabled = false, history = [], onSubmit }: TextInputProps) {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [submitFlash, setSubmitFlash] = useState(false);

  // Blinking cursor state
  const [cursorOn, setCursorOn] = useState(true);

  useEffect(() => {
    if (disabled || value.length > 0) {
      setCursorOn(true);
      return;
    }
    // Blink only when idle and empty
    const id = setInterval(() => setCursorOn((v) => !v), 530);
    return () => { clearInterval(id); setCursorOn(true); };
  }, [disabled, value.length]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // Brief flash effect on submit
    setSubmitFlash(true);
    setTimeout(() => setSubmitFlash(false), 150);

    setValue('');
    setHistoryIndex(-1);
    onSubmit(trimmed);
  }, [value, onSubmit]);

  useInput(
    (input: string, key: any) => {
      if (key.return) {
        submit();
        return;
      }
      if (key.upArrow) {
        if (history.length === 0) return;
        const next = Math.min(history.length - 1, historyIndex + 1);
        if (next !== historyIndex) {
          setHistoryIndex(next);
          setValue(history[history.length - 1 - next]);
        }
        return;
      }
      if (key.downArrow) {
        if (historyIndex === -1) return;
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setValue(next === -1 ? '' : history[history.length - 1 - next]);
        return;
      }
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.escape) return;
      if (input) setValue((v) => v + input);
    },
    { isActive: !disabled }
  );

  // ── Disabled / thinking state ──────────────────────────────────────────────
  if (disabled) {
    return (
      <Box>
        <Text color="magenta" bold>{'❯ '}</Text>
        <Text dim italic>{'…'}</Text>
      </Box>
    );
  }

  // ── Submit flash effect ─────────────────────────────────────────────────────
  const promptColor = submitFlash ? 'white' : 'green';

  return (
    <Box>
      <Text color={promptColor} bold>{'❯ '}</Text>

      {value.length === 0 ? (
        // Placeholder with blinking cursor
        <Text>
          {cursorOn ? (
            <Text color="green">▌</Text>
          ) : (
            <Text>{' '}</Text>
          )}
          <Text dim>{placeholder || 'Type a message…'}</Text>
        </Text>
      ) : (
        // User input with live cursor
        <Text>
          {value}
          {cursorOn ? (
            <Text inverse>▌</Text>
          ) : (
            <Text inverse>{' '}</Text>
          )}
        </Text>
      )}
    </Box>
  );
}
