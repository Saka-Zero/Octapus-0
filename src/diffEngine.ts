/**
 * Order-tolerant SEARCH/REPLACE diff engine (Cline-derived).
 *
 * Models emit edit instructions as fenced blocks:
 *   <<<<<<< SEARCH
 *   exact existing content
 *   =======
 *   replacement content
 *   >>>>>>> REPLACE
 *
 * Hardening ported from Cline's "+10% diff edits" work:
 * - Exact match first, then whitespace-trimmed line matching
 * - Empty REPLACE deletes the SEARCH region
 * - Failed blocks are reported precisely so the model can self-correct
 */

export interface DiffBlock {
  search: string;
  replace: string;
}

/** Parse all SEARCH/REPLACE blocks from model output (marker-length tolerant) */
export function parseDiffBlocks(text: string): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  const rx =
    /<{5,}[ \t]*SEARCH[ \t]*\r?\n([\s\S]*?)\r?\n={5,}[ \t]*\r?\n([\s\S]*?)\r?\n>{5,}[ \t]*REPLACE/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    blocks.push({ search: m[1], replace: m[2] });
  }
  return blocks;
}

interface MatchLocation {
  index: number;
  length: number;
}

/** Locate `search` inside `content`: exact first, then trim-per-line fuzzy */
function findMatch(content: string, search: string): MatchLocation | null {
  // Pass 1: exact substring
  const exact = content.indexOf(search);
  if (exact >= 0) return { index: exact, length: search.length };

  // Pass 2: line-by-line trimmed comparison
  const sLines = search.split('\n');
  const cLines = content.split('\n');
  if (sLines.length === 0 || cLines.length < sLines.length) return null;

  for (let i = 0; i <= cLines.length - sLines.length; i++) {
    let matched = true;
    for (let j = 0; j < sLines.length; j++) {
      if (cLines[i + j].trimEnd() !== sLines[j].trimEnd()) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const before = cLines.slice(0, i).join('\n');
      const index = before.length + (i > 0 ? 1 : 0);
      const length = cLines.slice(i, i + sLines.length).join('\n').length;
      return { index, length };
    }
  }
  return null;
}

export interface ApplyResult {
  ok: boolean;
  result: string;
  /** Human-readable failures per block for model self-correction */
  errors: string[];
  appliedCount: number;
}

/** Apply parsed blocks sequentially against content */
export function applyBlocks(content: string, blocks: DiffBlock[]): ApplyResult {
  let working = content;
  const errors: string[] = [];
  let appliedCount = 0;

  blocks.forEach((block, bi) => {
    const loc = findMatch(working, block.search);
    if (!loc) {
      errors.push(
        `Block ${bi + 1}: SEARCH not found in file. Ensure it matches EXACTLY (including indentation). First lines: ${JSON.stringify(block.search.split('\n').slice(0, 2))}`
      );
      return;
    }
    working =
      working.slice(0, loc.index) + block.replace + working.slice(loc.index + loc.length);
    appliedCount++;
  });

  return { ok: errors.length === 0 && blocks.length > 0, result: working, errors, appliedCount };
}
