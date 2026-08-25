import { Router } from './router';
import { Message } from './providers';
import { classifyIntent, DOMAIN_PERSONAS, domainLabel } from './utils/roles';
import { matchSkills, formatSkillsForPrompt } from './utils/skills';
import { DEFAULT_SYSTEM_PROMPT } from './config';

export interface CouncilCallbacks {
  /** Phase announcements: round transitions */
  onPhase: (phase: string) => void;
  /** Participant progress */
  onParticipant: (provider: string, role: string, status: 'start' | 'done' | 'fail', detail?: string) => void;
  /** Debate highlights from a participant */
  onDebate: (provider: string, points: string) => void;
}

export interface CouncilResult {
  finalText: string;
  participants: Array<{ provider: string; role: string }>;
  rounds: number;
}

interface Participant {
  provider: string;
  role: string;
  model: string;
}

const DEBOUNCE_MS = 400; // stay under anonymous rate limits (llm7 ~1rps)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * COUNCIL MODE — true multi-AI deliberation:
 *   Round 1: every specialist answers independently (persona + skills)
 *   Round 2: each specialist critiques the others (cross-examination)
 *   Round 3: chairman synthesizes everything into ONE super answer
 */
export async function runCouncil(
  router: Router,
  prompt: string,
  history: Message[],
  config: any,
  options: any,
  cb: CouncilCallbacks,
  signal?: AbortSignal
): Promise<CouncilResult> {
  const domain = classifyIntent(prompt);
  const matched = matchSkills(prompt);
  const skillText = formatSkillsForPrompt(matched);

  // Pick participants: top-N active providers by priority
  const size = Math.max(2, Math.min(5, config.settings.councilSize || 3));
  const status = router.getProviderStatus();
  const participants: Participant[] = Object.entries(status)
    .filter(([, s]) => s.enabled && s.models.length > 0)
    .sort((a, b) => b[1].priority - a[1].priority)
    .slice(0, size)
    .map(([name, s]) => ({ provider: name, role: config.providers[name]?.role || 'general', model: s.models[0] }));

  if (participants.length < 2) {
    throw new Error('Council needs at least 2 active providers.');
  }

  cb.onPhase(`🏛️ COUNCIL CONVENED — ${participants.length} specialists · ${domainLabel(domain)}`);

  // Shared context from conversation history (last few turns, compact)
  const histContext = history
    .filter((m) => m.role !== 'system')
    .slice(-6)
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const baseSystem = [
    options.system || config.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    skillText,
    DOMAIN_PERSONAS[domain]
  ].filter(Boolean).join('\n\n');

  const ask = async (participant: Participant, system: string, user: string, maxTokens: number): Promise<string> => {
    let out = '';
    for await (const ev of router.chat({
      model: participant.model,
      messages: [
        { role: 'system', content: system },
        ...(histContext ? [{ role: 'user' as const, content: `[Earlier conversation]\n${histContext}` }, { role: 'assistant' as const, content: 'Understood, continuing.' }] : []),
        { role: 'user', content: user }
      ],
      options: {
        model: participant.model,
        maxTokens,
        temperature: 0.6,
        stream: true,
        disableFallback: true, // THIS provider only — no silent substitution
        quiet: true,
        signal
      },
      fallbackModels: []
    })) {
      if (ev.type === 'text') out += ev.text;
    }
    return out.trim();
  };

  // ─── ROUND 1: Independent analysis ────────────────────────────────
  cb.onPhase('📋 ROUND 1 — Independent analysis');
  const analyses: Array<{ p: Participant; text: string }> = [];
  for (const p of participants) {
    cb.onParticipant(p.provider, p.role, 'start');
    try {
      const text = await ask(
        p,
        baseSystem,
        `${prompt}\n\nAnswer with your full expert analysis.`,
        900
      );
      analyses.push({ p, text });
      cb.onParticipant(p.provider, p.role, 'done', `${text.length} chars`);
    } catch (err) {
      cb.onParticipant(p.provider, p.role, 'fail', err instanceof Error ? err.message.slice(0, 80) : 'failed');
    }
    await sleep(DEBOUNCE_MS);
  }

  if (analyses.length === 0) {
    throw new Error('All council members failed in round 1.');
  }

  // ─── ROUND 2: Cross-examination ───────────────────────────────────
  cb.onPhase('⚔️ ROUND 2 — Cross-examination & debate');
  const peerDigest = analyses
    .map((a) => `=== ${a.p.provider} (${a.p.role}) ===\n${a.text.slice(0, 1800)}`)
    .join('\n\n');

  const critiques: Array<{ p: Participant; text: string }> = [];
  for (const a of analyses) {
    const peers = analyses.filter((x) => x.p !== a.p);
    if (peers.length === 0) break;
    try {
      const text = await ask(
        a.p,
        `You are a critical peer reviewer. Identify concrete errors, missing angles, and risks in OTHER specialists' answers about the same question. Max 150 words, bullet points only.`,
        `ORIGINAL QUESTION:\n${prompt}\n\nOTHER SPECIALISTS' ANSWERS:\n${peers.map((x) => `=== ${x.p.provider} ===\n${x.text.slice(0, 1400)}`).join('\n\n')}\n\nCritique their answers: factual errors, security flaws, missed edge cases, and one thing they did better than you.`,
        400
      );
      critiques.push({ p: a.p, text });
      cb.onDebate(a.p.provider, text.slice(0, 220));
    } catch {
      // debate is optional per participant
    }
    await sleep(DEBOUNCE_MS);
  }

  // ─── ROUND 3: Synthesis ───────────────────────────────────────────
  cb.onPhase('⚖️ ROUND 3 — Synthesis into final answer');
  const chairman = analyses[0].p; // highest-priority successful participant
  const synthesisInput = [
    `ORIGINAL QUESTION:\n${prompt}`,
    `\nSPECIALIST ANALYSES:\n${analyses.map((a) => `=== ${a.p.provider} (${a.p.role}) ===\n${a.text}`).join('\n\n')}`,
    critiques.length ? `\nPEER CRITIQUES:\n${critiques.map((c) => `=== ${c.p.provider} ===\n${c.text}`).join('\n\n')}` : '',
    `\n\nTASK: Merge everything into ONE definitive, super-detailed answer.
Rules:
- Resolve contradictions explicitly (state which position is correct and why).
- Keep every unique valuable insight; attribute non-obvious ones inline like (per ${participants[0]?.provider}).
- Remove repetition and fluff.
- Structure with clear markdown headings.
- End with a short '⚡ Council consensus' summary section.`
  ].join('\n');

  let finalText = '';
  for await (const ev of router.chat({
    model: chairman.model,
    messages: [
      { role: 'system', content: `You are the CHAIRMAN of an AI council. You receive multiple specialist analyses and peer critiques about one question, and must synthesize them into the single best possible answer. Be comprehensive but never redundant.` },
      { role: 'user', content: synthesisInput }
    ],
    options: {
      model: chairman.model,
      maxTokens: 2500,
      temperature: 0.5,
      stream: true,
      disableFallback: false, // synthesis may fall back if chairman fails
      quiet: true,
      signal
    },
    fallbackModels: config.fallbackModels || []
  })) {
    if (ev.type === 'text') finalText += ev.text;
  }

  return {
    finalText: finalText.trim() || analyses[0].text,
    participants: analyses.map((a) => ({ provider: a.p.provider, role: a.p.role })),
    rounds: 3
  };
}
