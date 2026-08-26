import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Router } from '../router';
import { usePulse, useAnimatedDots } from './effects';

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

const WINDOW_SIZE = 14;

/**
 * OpenCode-style model picker with:
 * - Pulsing border while loading live models
 * - Smooth type-to-filter
 * - Arrow-key navigation with scroll indicator
 * - Current model highlighted with ★
 */
export function ModelPicker({ router, currentModel, onSelect, onClose }: ModelPickerProps) {
  const [models, setModels] = useState<PickerModel[]>([]);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const [loadingLive, setLoadingLive] = useState(true);

  const borderPulse = usePulse('green', 'cyan', 800);
  const loadingDots = useAnimatedDots('loading live models', loadingLive, 300);

  // Initial static lists from registered providers
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
        if (cancelled || !s.enabled) continue;
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
    return () => { cancelled = true; };
  }, [router]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    );
  }, [models, filter]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIndex((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex((i) => Math.min(filtered.length - 1, i + 1)); return; }
    if (key.return) {
      const picked = filtered[index];
      if (picked) onSelect(picked.id);
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
  const providerColor = (p: string) => {
    const colors: Record<string, string> = {
      openai: 'green', anthropic: 'cyan', google: 'yellow', gemini: 'yellow',
      openrouter: 'magenta', groq: 'blue', mistral: 'red',
    };
    return colors[p.toLowerCase()] || 'white';
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
        <Text color="green" bold>{'▎ '}Select model </Text>
        <Text dim>
          ({filtered.length}/{models.length}
          {loadingLive ? ' · ' + loadingDots : ''}
          {')'}
        </Text>
      </Box>

      {/* Scroll indicator - top */}
      {!atTop && (
        <Text dim color="green">  ▲ …</Text>
      )}

      {/* Search bar */}
      <Box>
        <Text color="cyan">filter: </Text>
        <Text>{filter}</Text>
        <Text inverse color="green">{'▌'}</Text>
      </Box>

      {/* Model list */}
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
                <Text color={selected ? 'green' : undefined}>
                  {selected ? '› ' : '  '}
                </Text>
                <Text
                  color={selected ? 'green' : isCurrent ? 'yellow' : undefined}
                  bold={selected}
                >
                  {m.id}
                </Text>
                {isCurrent && <Text color="yellow"> ★</Text>}
                <Text color={providerColor(m.provider)} dim>
                  {' '}[{m.provider}]
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Scroll indicator - bottom */}
      {!atBottom && (
        <Text dim color="green">  ▼ …</Text>
      )}

      {/* Keybinds */}
      <Box>
        <Text dim>↑↓</Text>
        <Text dim> navigate </Text>
        <Text color="cyan">type</Text>
        <Text dim> filter </Text>
        <Text color="green">⏎</Text>
        <Text dim> select </Text>
        <Text color="red">esc</Text>
        <Text dim> close</Text>
      </Box>
    </Box>
  );
}
