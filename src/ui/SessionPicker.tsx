import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { ConversationSession, listSessions } from '../utils/history';
import { usePulse } from './effects';

interface SessionPickerProps {
  currentSessionId: string;
  onSelect: (session: ConversationSession) => void;
  onClose: () => void;
}

const WINDOW_SIZE = 12;

/** OpenCode-style session switcher with smooth animations. */
export function SessionPicker({ currentSessionId, onSelect, onClose }: SessionPickerProps) {
  const sessions = useMemo(() => listSessions(), []);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const borderPulse = usePulse('blue', 'cyan', 800);

  const filtered = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.title.toLowerCase().includes(filter.toLowerCase()) ||
          s.id.includes(filter)
      ),
    [sessions, filter]
  );

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(filtered.length - 1, i + 1)); return; }
    if (key.return) {
      const picked = filtered[index];
      if (picked) onSelect(picked);
      else onClose();
      return;
    }
    if (key.backspace || key.delete) { setFilter((f) => f.slice(0, -1)); return; }
    if (key.ctrl || key.meta) return;
    if (input) setFilter((f) => f + input);
  });

  const start = Math.max(0, Math.min(index - Math.floor(WINDOW_SIZE / 2), filtered.length - WINDOW_SIZE));
  const visible = filtered.slice(start, start + WINDOW_SIZE);
  const atTop = start === 0;
  const atBottom = start + WINDOW_SIZE >= filtered.length;

  const formatAge = (d: Date): string => {
    const ms = Date.now() - d.getTime();
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
    return Math.floor(ms / 86400000) + 'd ago';
  };

  return (
    <Box
      borderStyle="round"
      borderColor={borderPulse}
      flexDirection="column"
      paddingX={1}
    >
      {/* Header */}
      <Box>
        <Text color="blue" bold>{'▎ '}Select session </Text>
        <Text dim>({filtered.length}/{sessions.length})</Text>
      </Box>

      {/* Scroll - top */}
      {!atTop && <Text dim color="blue">  ▲ …</Text>}

      {/* Search bar */}
      <Box>
        <Text color="cyan">filter: </Text>
        <Text>{filter}</Text>
        <Text inverse color="blue">{'▌'}</Text>
      </Box>

      {/* Session list */}
      {filtered.length === 0 ? (
        <Text dim> No sessions match.</Text>
      ) : (
        visible.map((s, vi) => {
          const absolute = start + vi;
          const selected = absolute === index;
          const isCurrent = s.id === currentSessionId;
          const msgs = s.messages.filter((m) => m.role !== 'system').length;
          return (
            <Box key={s.id}>
              <Text color={selected ? 'blue' : undefined}>
                {selected ? '› ' : '  '}
              </Text>
              <Text
                color={selected ? 'blue' : isCurrent ? 'yellow' : undefined}
                bold={selected}
              >
                {s.title.slice(0, 40)}
              </Text>
              <Text dim>
                {' '}{formatAge(s.lastActive)} · {msgs}msg
              </Text>
              {isCurrent && <Text color="yellow"> ★</Text>}
            </Box>
          );
        })
      )}

      {/* Scroll - bottom */}
      {!atBottom && <Text dim color="blue">  ▼ …</Text>}

      {/* Keybinds */}
      <Box>
        <Text dim>↑↓</Text>
        <Text dim> navigate </Text>
        <Text color="cyan">type</Text>
        <Text dim> filter </Text>
        <Text color="blue">⏎</Text>
        <Text dim> load </Text>
        <Text color="red">esc</Text>
        <Text dim> close</Text>
      </Box>
    </Box>
  );
}
