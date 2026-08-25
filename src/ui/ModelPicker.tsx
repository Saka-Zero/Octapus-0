import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Router } from '../router';

export interface PickerModel {
  id: string;
  provider: string;
}

interface ModelPickerProps {
  router: Router;
  currentModel: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}

const WINDOW_SIZE = 12;

/**
 * OpenCode-style interactive model picker:
 * type-to-filter, arrow navigation, enter to select, esc to cancel.
 * Starts from static model lists, enriches with live /models API results.
 */
export function ModelPicker({ router, currentModel, onSelect, onClose }: ModelPickerProps) {
  const [models, setModels] = useState<PickerModel[]>([]);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const [loadingLive, setLoadingLive] = useState(true);

  // Initial static lists from registered providers (priority order)
  useEffect(() => {
    const status = router.getProviderStatus();
    const initial: PickerModel[] = [];
    for (const [name, s] of Object.entries(status)) {
      if (!s.enabled) continue;
      for (const m of s.models) initial.push({ id: m, provider: name });
    }
    setModels(initial);

    // Enrich with live model lists in background
    let cancelled = false;
    (async () => {
      for (const [name, s] of Object.entries(status)) {
        if (!s.enabled) continue;
        const provider = router.getProvider(name);
        if (!provider) continue;
        try {
          const live = await provider.getModels();
          if (cancelled || live.length === 0) continue;
          setModels((prev) => {
            const without = prev.filter((m) => m.provider !== name);
            const fresh = live.slice(0, 200).map((id) => ({ id, provider: name }));
            return [...without, ...fresh];
          });
        } catch {
          // keep static list for this provider
        }
      }
      if (!cancelled) setLoadingLive(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    );
  }, [models, filter]);

  // Clamp cursor when filter shrinks the list
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const picked = filtered[index];
      if (picked) onSelect(picked.id);
      else onClose();
      return;
    }
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;
    if (input) setFilter((f) => f + input);
  });

  // Windowed slice so huge lists (300+ models) stay renderable
  const start = Math.max(0, Math.min(index - Math.floor(WINDOW_SIZE / 2), filtered.length - WINDOW_SIZE));
  const visible = filtered.slice(start, start + WINDOW_SIZE);

  return (
    <Box borderStyle="round" borderColor="magenta" flexDirection="column" paddingX={1}>
      <Box>
        <Text color="magenta" bold>Select model </Text>
        <Text dim>({filtered.length} models{loadingLive ? ' · loading live…' : ''})</Text>
      </Box>
      <Box marginTop={0}>
        <Text color="cyan">search: </Text>
        <Text>{filter}</Text>
        <Text inverse>{' '}</Text>
      </Box>

      {filtered.length === 0 ? (
        <Text dim> No models match "{filter}"</Text>
      ) : (
        <Box flexDirection="column">
          {visible.map((m, vi) => {
            const absolute = start + vi;
            const selected = absolute === index;
            const isCurrent = m.id === currentModel;
            return (
              <Box key={`${m.provider}:${m.id}`}>
                <Text color={selected ? 'green' : undefined}>{selected ? '❯ ' : '  '}</Text>
                <Text
                  color={selected ? 'green' : isCurrent ? 'yellow' : undefined}
                  bold={selected}
                  inverse={false}
                >
                  {m.id}
                </Text>
                {isCurrent && <Text color="yellow"> ★</Text>}
                <Text dim> [{m.provider}]</Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={0}>
        <Text dim>↑↓ navigate · type to filter · enter select · esc cancel</Text>
      </Box>
    </Box>
  );
}
