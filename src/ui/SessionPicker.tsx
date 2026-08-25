import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ConversationSession, listSessions } from '../utils/history';

interface SessionPickerProps {
  currentSessionId: string;
  onSelect: (session: ConversationSession) => void;
  onClose: () => void;
}

const WINDOW_SIZE = 10;

/** OpenCode-style session switcher: filter, arrows, enter to load. */
export function SessionPicker({ currentSessionId, onSelect, onClose }: SessionPickerProps) {
  const sessions = useState(listSessions())[0];
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);

  const filtered = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(filter.toLowerCase()) ||
      s.id.includes(filter)
  );

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) return setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) return setIndex((i) => Math.min(filtered.length - 1, i + 1));
    if (key.return) {
      const picked = filtered[index];
      if (picked) onSelect(picked);
      else onClose();
      return;
    }
    if (key.backspace || key.delete) return setFilter((f) => f.slice(0, -1));
    if (key.ctrl || key.meta) return;
    if (input) setFilter((f) => f + input);
  });

  const start = Math.max(0, Math.min(index - Math.floor(WINDOW_SIZE / 2), filtered.length - WINDOW_SIZE));
  const visible = filtered.slice(start, start + WINDOW_SIZE);

  return (
    <Box borderStyle="round" borderColor="blue" flexDirection="column" paddingX={1}>
      <Text color="blue" bold>Select session </Text>
      <Box>
        <Text color="cyan">search: </Text>
        <Text>{filter}</Text>
        <Text inverse>{' '}</Text>
      </Box>
      {filtered.length === 0 ? (
        <Text dim> No sessions match.</Text>
      ) : (
        visible.map((s, vi) => {
          const absolute = start + vi;
          const selected = absolute === index;
          const isCurrent = s.id === currentSessionId;
          const date = s.lastActive.toLocaleDateString();
          const msgs = s.messages.filter((m) => m.role !== 'system').length;
          return (
            <Box key={s.id}>
              <Text color={selected ? 'green' : undefined}>{selected ? '❯ ' : '  '}</Text>
              <Text color={selected ? 'green' : isCurrent ? 'yellow' : undefined} bold={selected}>
                {s.title.slice(0, 40)}
              </Text>
              <Text dim> · {date} · {msgs} msg{isCurrent ? ' ★current' : ''}</Text>
            </Box>
          );
        })
      )}
      <Text dim>↑↓ navigate · enter load · esc cancel</Text>
    </Box>
  );
}
