// ── CommandMenu v2 ── OpenCode-style command palette ───────────────────────────
//
// Design principles (from OpenCode DialogSelect + blink-tui + glyph):
//   - Flat list with category headers (NO expand/collapse sub-menus)
//   - Fuzzy search via fuzzysort (title weighted 2x over category)
//   - Suggested items at top when filter is empty
//   - Keybind hints right-aligned on each row
//   - Dynamic height: Math.min(totalItems, Math.floor(termHeight / 2) - 2)
//   - Clean single-line border (NO pulsing animation)
//   - SearchInput on top, list below
//   - Inline counter: 3/42

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fuzzysort from 'fuzzysort';
import { Router } from '../router';
import { Config } from '../config';
import { listSessions, ConversationSession } from '../utils/history';
import { listThemeNames } from './theme';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CommandMenuProps {
  router: Router;
  config: Config;
  currentModel: string;
  currentSessionId: string;
  onClose: () => void;
  onAction: (action: string, payload?: any) => void;
}

interface CommandItem {
  id: string;
  label: string;
  /** Action string to fire via onAction */
  action: string;
  payload?: any;
  /** Category header label — items with same category are grouped */
  category: string;
  /** Right-aligned keybind hint (e.g. "Ctrl+M") */
  keybind?: string;
  /** Whether this item is the currently active selection */
  current?: boolean;
  /** Small tag text on the right (e.g. provider name) */
  tag?: string;
  tagColor?: string;
}

interface FlatEntry {
  type: 'header' | 'item';
  /** For headers: category label. For items: the CommandItem */
  category?: string;
  item?: CommandItem;
  flatIndex: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'green', anthropic: 'cyan', google: 'yellow', gemini: 'yellow',
  openrouter: 'magenta', groq: 'blue', mistral: 'red', nvidia: 'magenta',
  ollama: 'gray', lmstudio: 'gray', cerebras: 'green',
  sambanova: 'cyan', cohere: 'yellow', huggingface: 'yellow',
  together: 'blue', 'github-models': 'gray', zhipu: 'cyan',
  novita: 'red', requesty: 'blue', siliconflow: 'green',
  modelscope: 'green', pollinations: 'magenta', 'opencode-zen': 'green',
  llm7: 'blue', blockrun: 'red', cloudflare: 'yellow', hunyuan: 'cyan',
  qianfan: 'blue', chutes: 'red', venice: 'magenta', scaleway: 'blue',
  ovh: 'blue',
};

function providerColor(name: string): string {
  return PROVIDER_COLORS[name.toLowerCase()] || 'white';
}

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── CommandMenu component ──────────────────────────────────────────────────────

export function CommandMenu({
  router,
  config,
  currentModel,
  currentSessionId,
  onClose,
  onAction,
}: CommandMenuProps) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const termHeight = process.stdout.rows || 24;

  // Load sessions on mount
  useEffect(() => {
    setSessions(listSessions());
  }, []);

  // ── Build all menu items ───────────────────────────────────────────────────

  const allItems = useMemo((): CommandItem[] => {
    const providerStatus = router.getProviderStatus();
    const currentTheme = (config as any).theme as string | undefined;
    const themes = listThemeNames();

    // Group models by provider
    const modelsByProvider = new Map<string, string[]>();
    for (const [name, status] of Object.entries(providerStatus)) {
      if (status.enabled) modelsByProvider.set(name, status.models);
    }

    const items: CommandItem[] = [];

    // ── Suggested (appear at top when filter empty) ──
    items.push({
      id: 'suggest:session',
      label: 'New Session',
      action: 'session:new',
      category: 'Suggested',
      keybind: 'Ctrl+N',
    });
    items.push({
      id: 'suggest:model',
      label: currentModel,
      action: 'model:current',
      category: 'Suggested',
      current: true,
      keybind: 'Ctrl+M',
    });
    // Most recent session
    const recent = sessions
      .filter((s) => s.id !== currentSessionId)
      .sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime())[0];
    if (recent) {
      items.push({
        id: `suggest:recent:${recent.id}`,
        label: recent.title || 'Untitled',
        action: 'session:switch',
        payload: { sessionId: recent.id },
        category: 'Suggested',
        tag: relativeTime(recent.lastActive),
        tagColor: 'gray',
      });
    }

    // ── Sessions ──
    items.push({
      id: 'session:new',
      label: 'New Session',
      action: 'session:new',
      category: 'Sessions',
    });
    for (const s of sessions) {
      items.push({
        id: `session:${s.id}`,
        label: s.title || 'Untitled',
        action: 'session:switch',
        payload: { sessionId: s.id },
        category: 'Sessions',
        current: s.id === currentSessionId,
        tag: `${s.messages.filter((m) => m.role !== 'system').length} msgs`,
        tagColor: s.id === currentSessionId ? 'green' : 'gray',
      });
    }

    // ── Models ──
    for (const [providerName, models] of modelsByProvider) {
      for (const m of models.slice(0, 50)) {
        items.push({
          id: `model:${providerName}:${m}`,
          label: m,
          action: 'model:switch',
          payload: { modelId: m },
          category: 'Models',
          current: m === currentModel,
          tag: providerName,
          tagColor: providerColor(providerName),
        });
      }
    }

    // ── Providers ──
    for (const [name, status] of Object.entries(providerStatus)) {
      items.push({
        id: `provider:${name}`,
        label: name,
        action: 'provider:switch',
        payload: { providerName: name, enabled: !status.enabled },
        category: 'Providers',
        tag: status.enabled ? `${status.models.length} models` : 'OFF',
        tagColor: status.enabled ? 'green' : 'red',
      });
    }

    // ── View ──
    items.push({
      id: 'view:clear',
      label: 'Clear Chat',
      action: 'view:clear',
      category: 'View',
    });
    items.push({
      id: 'view:theme-cycle',
      label: 'Cycle Theme',
      action: 'view:theme',
      category: 'View',
      tag: currentTheme || 'octapus',
      tagColor: 'magenta',
    });
    for (const t of themes.filter((t) => t !== currentTheme)) {
      items.push({
        id: `theme:${t}`,
        label: t,
        action: 'view:theme',
        payload: { themeName: t },
        category: 'Themes',
      });
    }
    items.push({
      id: 'view:reset',
      label: 'Reset Session',
      action: 'view:reset',
      category: 'View',
    });

    // ── Tools & Modes ──
    items.push({
      id: 'tools:toggle-agent',
      label: 'Toggle Agent Mode',
      action: 'tools:toggle-agent',
      category: 'Tools & Modes',
      keybind: 'Ctrl+A',
    });
    items.push({
      id: 'tools:toggle-plan',
      label: 'Toggle Plan Mode',
      action: 'tools:toggle-plan',
      category: 'Tools & Modes',
      keybind: 'Ctrl+P',
    });
    items.push({
      id: 'tools:list',
      label: 'Available Tools',
      action: 'tools:list',
      category: 'Tools & Modes',
    });

    // ── Export ──
    items.push({
      id: 'export:last',
      label: 'Copy Last Response',
      action: 'export:last',
      category: 'Export',
    });
    items.push({
      id: 'export:history',
      label: 'Export Chat History',
      action: 'export:history',
      category: 'Export',
    });
    items.push({
      id: 'export:digest',
      label: 'Save Session Digest',
      action: 'export:digest',
      category: 'Export',
    });

    return items;
  }, [router, config, currentModel, currentSessionId, sessions]);

  // ── Fuzzy filter ───────────────────────────────────────────────────────────

  const filtered = useMemo((): CommandItem[] => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      // No filter: show all items (Suggested stays at top since it's first)
      return allItems;
    }

    // Fuzzy search — title weighted 2x over category (same as OpenCode)
    const results = fuzzysort.go(q, allItems, {
      keys: ['label', 'category'],
      limit: 80,
      scoreFn: (r) => r[0].score * 2 + r[1].score,
    });

    return results.map((r) => r.obj);
  }, [allItems, filter]);

  // ── Flatten into display entries (headers + items) ──────────────────────────

  const flatEntries = useMemo((): FlatEntry[] => {
    const entries: FlatEntry[] = [];
    let fi = 0;
    let lastCategory = '';

    for (const item of filtered) {
      const cat = item.category || '';
      if (cat !== lastCategory) {
        entries.push({ type: 'header', category: cat, flatIndex: fi++ });
        lastCategory = cat;
      }
      entries.push({ type: 'item', item, flatIndex: fi++ });
    }

    return entries;
  }, [filtered]);

  // Only item entries (for navigation)
  const itemEntries = useMemo(
    () => flatEntries.filter((e) => e.type === 'item') as (FlatEntry & { item: CommandItem })[],
    [flatEntries]
  );

  // Keep selectedIndex in bounds
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, itemEntries.length - 1)));
  }, [itemEntries.length]);

  // Reset to top when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // ── Dynamic height ─────────────────────────────────────────────────────────

  const maxVisible = useMemo(() => {
    // Reserve: 1 header + 1 input + 1 footer = 3 lines, minus some padding
    return Math.min(flatEntries.length, Math.floor(termHeight / 2) - 2);
  }, [flatEntries.length, termHeight]);

  // Current flatIndex of selected item
  const selectedFlatIndex = itemEntries[selectedIndex]?.flatIndex ?? 0;

  // Compute scroll window
  const windowEntries = useMemo(() => {
    // Find the window of flat entries to show
    let start = 0;
    let count = 0;
    for (let i = 0; i < flatEntries.length; i++) {
      if (flatEntries[i].flatIndex === selectedFlatIndex) {
        // Center the selection
        start = Math.max(0, i - Math.floor(maxVisible / 2));
        break;
      }
    }
    return flatEntries.slice(start, start + maxVisible);
  }, [flatEntries, selectedFlatIndex, maxVisible]);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useInput((inputChar, key) => {
    // Esc: clear filter → close menu
    if (key.escape) {
      if (filter) {
        setFilter('');
        setSelectedIndex(0);
      } else {
        onClose();
      }
      return;
    }

    // Navigation
    if (key.upArrow || (key.ctrl && inputChar === 'p')) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && inputChar === 'n')) {
      setSelectedIndex((i) => Math.min(itemEntries.length - 1, i + 1));
      return;
    }
    // Page Up / Page Down / Home / End via escape sequences
    if (inputChar === '\x1b[5~') { // Page Up
      setSelectedIndex((i) => Math.max(0, i - 10));
      return;
    }
    if (inputChar === '\x1b[6~') { // Page Down
      setSelectedIndex((i) => Math.min(itemEntries.length - 1, i + 10));
      return;
    }
    if (inputChar === '\x1b[H' || inputChar === '\x1bOH') { // Home
      setSelectedIndex(0);
      return;
    }
    if (inputChar === '\x1b[F' || inputChar === '\x1bOF') { // End
      setSelectedIndex(itemEntries.length - 1);
      return;
    }

    // Select
    if (key.return) {
      const entry = itemEntries[selectedIndex];
      if (entry?.item) {
        onAction(entry.item.action, entry.item.payload);
        onClose();
      }
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      return;
    }

    // Ignore Ctrl/Meta combos (except the ones handled above)
    if (key.ctrl || key.meta) return;

    // Character input → append to filter
    if (inputChar && inputChar.length === 1) {
      setFilter((f) => f + inputChar);
    }
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasItems = itemEntries.length > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
    >
      {/* ── Header ── */}
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          Commands
        </Text>
        <Text color="gray">
          {filter ? `${selectedIndex + 1}/${itemEntries.length}` : `${itemEntries.length} items`}
        </Text>
      </Box>

      {/* ── Search input ── */}
      <Box>
        <Text color="cyan">{'>'} </Text>
        <Text>{filter}</Text>
        <Text inverse color="cyan">
          {' '}
        </Text>
      </Box>

      {/* ── Results ── */}
      {!hasItems ? (
        <Box paddingTop={1}>
          <Text color="gray">  No results for "{filter}"</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {windowEntries.map((entry) => {
            if (entry.type === 'header') {
              return (
                <Box key={`h:${entry.category}`} paddingTop={1}>
                  <Text color="gray" bold>
                    {'  '}{entry.category}
                  </Text>
                </Box>
              );
            }

            const item = entry.item!;
            const isSelected = entry.flatIndex === selectedFlatIndex;

            return (
              <Box key={item.id} justifyContent="space-between">
                <Box>
                  {/* Selection caret */}
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '> ' : '  '}
                  </Text>

                  {/* Current indicator (dot) */}
                  {item.current && (
                    <Text color="green" bold>
                      {'* '}
                    </Text>
                  )}

                  {/* Label */}
                  <Text
                    color={isSelected ? 'cyan' : undefined}
                    bold={isSelected}
                  >
                    {item.label}
                  </Text>

                  {/* Tag */}
                  {item.tag && (
                    <Text color={item.tagColor || 'gray'}>
                      {' '}{item.tag}
                    </Text>
                  )}
                </Box>

                {/* Keybind hint (right-aligned) */}
                {item.keybind && (
                  <Text color="gray">
                    {item.keybind}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* ── Footer keybinds ── */}
      <Box gap={2}>
        <Text color="gray">{'\u2191\u2193'} navigate</Text>
        <Text color="gray">{'\u23CE'} select</Text>
        <Text color="gray">type to filter</Text>
        <Text color="gray">esc close</Text>
      </Box>
    </Box>
  );
}
