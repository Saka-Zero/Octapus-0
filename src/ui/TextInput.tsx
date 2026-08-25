import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  placeholder?: string;
  disabled?: boolean;
  history?: string[];
  onSubmit: (value: string) => void;
}

/**
 * Single-line input with block cursor, paste support, and
 * up/down command-history navigation.
 */
export function TextInput({ placeholder, disabled = false, history = [], onSubmit }: TextInputProps) {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = live input

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
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
        // Walk backwards through history
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
      if (key.ctrl || key.meta || key.escape) {
        return;
      }
      // Regular character(s) — also covers terminal paste of plain text
      if (input) {
        setValue((v) => v + input);
      }
    },
    { isActive: !disabled }
  );

  if (disabled) {
    return (
      <Box>
        <Text dim> </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color="green" bold>{'❯ '}</Text>
      {value.length === 0 && placeholder ? (
        <Text dim>{placeholder}</Text>
      ) : (
        <Text>
          {value}
          <Text inverse>{' '}</Text>
        </Text>
      )}
    </Box>
  );
}
