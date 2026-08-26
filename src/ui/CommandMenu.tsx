import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { usePulse } from './effects';
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

type MenuItemKind = 'category' | 'action';

interface MenuItem {
  id: string;
  label: string;
  kind: MenuItemKind;
  icon?: string;
  /** For category items: the child items to show when expanded */
  children?: MenuItem[];
  /** For action items: the action string to fire */
  action?: string;
  payload?: any;
  /** Visual tag (e.g. provider name, model id) */
  tag?: string;
  tagColor?: string;
  /** Whether this item is the "current" selection (star, active, etc.) */
  current?: boolean;
  /** Whether item is enabled / toggleable */
  enabled?: boolean;
}

interface FlatItem extends MenuItem {
  /** Absolute index in the flattened visible list */
  flatIndex: number;
  /** Whether this item is inside an expanded category */
  depth: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const WINDOW_SIZE = 14;

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

// ── CommandMenu component ──────────────────────────────────────────────────────

export function CommandMenu({
  router,
  config,
  currentModel,
  currentSessionId,
  onClose,
  onAction,
}: CommandMenuProps) {
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [themes] = useState<string[]>(listThemeNames);

  const borderPulse = usePulse('cyan', 'green', 800);

  // Load sessions once on mount
  useEffect(() => {
    setSessions(listSessions());
  }, []);

  // ── Build menu tree ─────────────────────────────────────────────────────────

  const buildMenuTree = useCallback((): MenuItem[] => {
    const providerStatus = router.getProviderStatus();
    const currentTheme = (config as any).theme as string | undefined;

    // Group models by provider
    const modelsByProvider = new Map<string, string[]>();
    for (const [name, status] of Object.entries(providerStatus)) {
      if (status.enabled) {
        modelsByProvider.set(name, status.models);
      }
    }

    const categories: MenuItem[] = [
      // ── Switch Session ──
      {
        id: 'sessions',
        label: 'Switch Session',
        icon: '📋',
        kind: 'category',
        children: [
          {
            id: 'session:new',
            label: 'New Session',
            kind: 'action',
            icon: '＋',
            action: 'session:new',
          },
          ...sessions.map((s) => ({
            id: `session:${s.id}`,
            label: s.title || 'Untitled',
            kind: 'action' as const,
            icon: s.id === currentSessionId ? '●' : '○',
            action: 'session:switch',
            payload: { sessionId: s.id },
            tag: `${s.messages.filter((m) => m.role !== 'system').length} msgs · ${relativeTime(s.lastActive)}`,
            tagColor: s.id === currentSessionId ? 'green' : 'gray',
            current: s.id === currentSessionId,
          })),
        ],
      },

      // ── Switch Model ──
      {
        id: 'models',
        label: 'Switch Model',
        icon: '🤖',
        kind: 'category',
        children: Array.from(modelsByProvider.entries()).flatMap(
          ([providerName, models]) =>
            models.slice(0, 50).map((m) => ({
              id: `model:${providerName}:${m}`,
              label: m,
              kind: 'action' as const,
              action: 'model:switch',
              payload: { modelId: m },
              tag: providerName,
              tagColor: providerColor(providerName),
              current: m === currentModel,
            }))
        ),
      },

      // ── Switch Provider ──
      {
        id: 'providers',
        label: 'Switch Provider',
        icon: '🔌',
        kind: 'category',
        children: Object.entries(providerStatus).map(([name, status]) => ({
          id: `provider:${name}`,
          label: name,
          kind: 'action' as const,
          action: 'provider:switch',
          payload: { providerName: name, enabled: !status.enabled },
          tag: status.enabled ? `ON · ${status.models.length} models` : 'OFF',
          tagColor: status.enabled ? 'green' : 'red',
          enabled: status.enabled,
        })),
      },

      // ── View ──
      {
        id: 'view',
        label: 'View',
        icon: '👁',
        kind: 'category',
        children: [
          {
            id: 'action:clear',
            label: 'Clear Chat',
            kind: 'action',
            icon: '🗑',
            action: 'view:clear',
          },
          {
            id: 'action:theme',
            label: 'Cycle Theme',
            kind: 'action',
            icon: '🎨',
            action: 'view:theme',
            tag: currentTheme || 'octapus',
            tagColor: 'magenta',
          },
          ...themes
            .filter((t) => t !== currentTheme)
            .map((t) => ({
              id: `theme:${t}`,
              label: t,
              kind: 'action' as const,
              icon: '🎨',
              action: 'view:theme',
              payload: { themeName: t },
              tag: t === currentTheme ? 'active' : undefined,
              tagColor: 'magenta',
            })),
          {
            id: 'action:reset',
            label: 'Reset Session',
            kind: 'action',
            icon: '↻',
            action: 'view:reset',
          },
        ],
      },

      // ── Tools & Modes ──
      {
        id: 'tools',
        label: 'Tools & Modes',
        icon: '🔧',
        kind: 'category',
        children: [
          {
            id: 'action:toggle-agent',
            label: 'Toggle Agent Mode',
            kind: 'action',
            icon: '🤖',
            action: 'tools:toggle-agent',
          },
          {
            id: 'action:toggle-plan',
            label: 'Toggle Plan Mode',
            kind: 'action',
            icon: '📝',
            action: 'tools:toggle-plan',
          },
          {
            id: 'tools:list',
            label: 'Available Tools',
            kind: 'action',
            icon: '📋',
            action: 'tools:list',
          },
        ],
      },

      // ── Export ──
      {
        id: 'export',
        label: 'Export',
        icon: '📤',
        kind: 'category',
        children: [
          {
            id: 'action:export-last',
            label: 'Copy Last Response',
            kind: 'action',
            icon: '📋',
            action: 'export:last',
          },
          {
            id: 'action:export-history',
            label: 'Export Chat History',
            kind: 'action',
            icon: '📄',
            action: 'export:history',
          },
          {
            id: 'action:export-digest',
            label: 'Save Session Digest',
            kind: 'action',
            icon: '💾',
            action: 'export:digest',
          },
        ],
      },
    ];

    return categories;
  }, [router, config, currentModel, currentSessionId, sessions, themes]);

  const menuTree = useMemo(() => buildMenuTree(), [buildMenuTree]);

  // ── Flatten visible items ────────────────────────────────────────────────────

  const flatItems = useMemo((): FlatItem[] => {
    const q = filter.toLowerCase();
    const result: FlatItem[] = [];
    let fi = 0;

    for (const cat of menuTree) {
      // Filter: check category label or any child matches
      const catMatch = !q || cat.label.toLowerCase().includes(q);
      const matchingChildren = cat.children?.filter(
        (ch) =>
          !q ||
          ch.label.toLowerCase().includes(q) ||
          ch.tag?.toLowerCase().includes(q)
      );

      // Always show the category header
      if (catMatch || (matchingChildren && matchingChildren.length > 0)) {
        result.push({ ...cat, flatIndex: fi++, depth: 0 });

        if (expanded.has(cat.id) && matchingChildren) {
          for (const child of matchingChildren) {
            result.push({ ...child, flatIndex: fi++, depth: 1 });
          }
        }
      }
    }

    return result;
  }, [menuTree, expanded, filter]);

  // Keep index in bounds
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  // ── Expand all when filtering ────────────────────────────────────────────────
  useEffect(() => {
    if (filter) {
      const allIds = new Set(menuTree.map((c) => c.id));
      setExpanded(allIds);
    }
  }, [filter, menuTree]);

  // ── Keyboard handling ────────────────────────────────────────────────────────

  useInput((input, key) => {
    // Always: Esc closes
    if (key.escape) {
      if (filter) {
        setFilter('');
      } else if (expanded.size > 0) {
        setExpanded(new Set());
        setIndex(0);
      } else {
        onClose();
      }
      return;
    }

    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(flatItems.length - 1, i + 1));
      return;
    }

    if (key.return) {
      const item = flatItems[index];
      if (!item) return;

      if (item.kind === 'category') {
        // Toggle expand
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) {
            next.delete(item.id);
          } else {
            next.add(item.id);
          }
          return next;
        });
      } else if (item.kind === 'action' && item.action) {
        onAction(item.action, item.payload);
        onClose();
      }
      return;
    }

    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      setIndex(0);
      return;
    }
    if (key.ctrl || key.meta) return;
    if (input) {
      setFilter((f) => f + input);
      setIndex(0);
    }
  });

  // ── Scroll window ───────────────────────────────────────────────────────────

  const start = Math.max(
    0,
    Math.min(
      index - Math.floor(WINDOW_SIZE / 2),
      flatItems.length - WINDOW_SIZE
    )
  );
  const visible = flatItems.slice(start, start + WINDOW_SIZE);
  const atTop = start === 0;
  const atBottom = start + WINDOW_SIZE >= flatItems.length;

  // ── Breadcrumb ──────────────────────────────────────────────────────────────

  const selectedItem = flatItems[index];
  const breadcrumb = useMemo(() => {
    if (!selectedItem) return '⌘ Command Menu';
    if (selectedItem.depth === 0) return `⌘ Command Menu › ${selectedItem.label}`;
    const parent = flatItems
      .slice(0, selectedItem.flatIndex)
      .reverse()
      .find((f) => f.depth === 0);
    if (parent) return `⌘ Command Menu › ${parent.label} › ${selectedItem.label}`;
    return `⌘ Command Menu › ${selectedItem.label}`;
  }, [selectedItem, flatItems]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box
      borderStyle="round"
      borderColor={borderPulse}
      flexDirection="column"
      paddingX={1}
    >
      {/* Breadcrumb header */}
      <Box>
        <Text color="cyan" bold>
          {breadcrumb}
        </Text>
      </Box>

      {/* Filter bar */}
      <Box>
        <Text color="cyan">filter: </Text>
        <Text>{filter}</Text>
        <Text inverse color="cyan">
          {'▌'}
        </Text>
      </Box>

      {/* Scroll indicator - top */}
      {!atTop && <Text dim color="cyan">  ▲ …</Text>}

      {/* Menu items */}
      {flatItems.length === 0 ? (
        <Text dim> No items match "{filter}"</Text>
      ) : (
        <Box flexDirection="column">
          {visible.map((item) => {
            const selected = item.flatIndex === index;
            const isCategory = item.kind === 'category';
            const isExpanded = expanded.has(item.id);
            const indent = item.depth > 0;

            return (
              <Box key={item.id} flexDirection="column">
                <Box>
                  {/* Selection indicator */}
                  <Text color={selected ? 'cyan' : undefined}>
                    {selected ? '› ' : '  '}
                  </Text>

                  {/* Category arrow or action prefix */}
                  {isCategory && (
                    <Text color={selected ? 'cyan' : 'gray'}>
                      {isExpanded ? '▾ ' : '▸ '}
                    </Text>
                  )}

                  {/* Icon */}
                  {item.icon && (
                    <Text color={selected ? 'cyan' : undefined}>
                      {item.icon}{' '}
                    </Text>
                  )}

                  {/* Label */}
                  <Text
                    color={
                      selected
                        ? 'cyan'
                        : item.current
                        ? 'yellow'
                        : undefined
                    }
                    bold={selected || isCategory}
                  >
                    {indent ? '  ' : ''}
                    {item.label}
                  </Text>

                  {/* Current indicator */}
                  {item.current && <Text color="yellow"> ★</Text>}

                  {/* Enabled indicator for providers */}
                  {!isCategory && item.enabled !== undefined && (
                    <Text color={item.enabled ? 'green' : 'red'}>
                      {item.enabled ? ' ●' : ' ○'}
                    </Text>
                  )}

                  {/* Tag */}
                  {item.tag && (
                    <Text color={item.tagColor || 'gray'} dim>
                      {' '}[{item.tag}]
                    </Text>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Scroll indicator - bottom */}
      {!atBottom && <Text dim color="cyan">  ▼ …</Text>}

      {/* Keybinds footer */}
      <Box>
        <Text dim>↑↓</Text>
        <Text dim> navigate </Text>
        <Text color="cyan">⏎</Text>
        <Text dim> expand/select </Text>
        <Text color="cyan">type</Text>
        <Text dim> filter </Text>
        <Text color="red">esc</Text>
        <Text dim> back/close</Text>
      </Box>
    </Box>
  );
}
