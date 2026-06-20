import crypto from 'crypto';
import type { ToolCall, EvidenceEntry, ClaimEvidence, ProvenanceReport } from '../types/index.js';

export function generateTaintKey(): string {
  return 'ev-' + crypto.randomBytes(3).toString('hex');
}

function isEmptyResult(result: string): boolean {
  if (!result) return true;
  const trimmed = result.trim();
  if (trimmed === '') return true;
  if (trimmed === '{}' || trimmed === '[]' || trimmed === 'null' || trimmed === 'undefined') return true;
  if (trimmed === '{"content":[]}' || trimmed === '{"results":[]}') return true;
  return false;
}

/**
 * Extract meaningful tokens from text for verification: CURIEs, PMIDs,
 * identifiers, and multi-word phrases. These are checked against the
 * evidence content to verify the excerpt isn't fabricated.
 */
function extractVerificationTokens(text: string): string[] {
  const tokens: string[] = [];

  // Extract identifiers: PMIDs, CURIEs, DOIs (e.g., PMID:12345, CHEBI:16330, NCBIGene:7113)
  const idPattern = /(?:PMID|CHEBI|UMLS|NCBIGene|PUBCHEM\.COMPOUND|DOI|MONDO|HP|DOID|DrugBank|UniProt)[:\s][\w./-]+/gi;
  let match;
  while ((match = idPattern.exec(text)) !== null) {
    // Normalize: lowercase, collapse the separator
    tokens.push(match[0].toLowerCase().replace(/\s+/g, ':'));
  }

  // Extract relationship labels (multi-word phrases between arrows or quotes)
  const labelPattern = /(?:['"]([^'"]+)['"]|→\s*([^→,\n]+?)\s*→)/g;
  while ((match = labelPattern.exec(text)) !== null) {
    const label = (match[1] || match[2] || '').trim().toLowerCase().replace(/['"]/g, '');
    if (label.length > 3) tokens.push(label);
  }

  return tokens;
}

const HTML_ENTITIES: Record<string, string> = {
  '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/**
 * Normalize text for forgiving verbatim matching: decode HTML entities, fold smart
 * quotes/dashes to ASCII, lowercase, collapse whitespace. Recovers formatting-only
 * differences without loosening what counts as "the same words".
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/&quot;|&amp;|&lt;|&gt;|&#39;|&apos;|&nbsp;/g, m => HTML_ENTITIES[m] ?? m)
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Longest common substring length / needle length — a *contiguous* overlap ratio.
 * needle is a short excerpt and hay is a bounded window, so the O(n·m) DP is cheap.
 * Contiguity is deliberate: a genuine paraphrase shares only short scattered runs
 * with the source, so it scores low and stays unverified.
 */
function longestCommonSubstringRatio(needle: string, hay: string): number {
  const m = needle.length;
  const n = hay.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array<number>(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (needle[i - 1] === hay[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best / m;
}

/**
 * Whether `excerpt` is a verbatim — or near-verbatim, formatting aside — quote of some
 * span of `content`. Recovers legitimate false-negatives (whitespace, case, HTML
 * entities, smart quotes, "…" elisions, boundary truncation) while still rejecting
 * real paraphrases: a reworded excerpt won't share a long contiguous run with any
 * window of the source, so it never clears the bar.
 */
export function excerptMatches(excerpt: string, content: string): boolean {
  const hay = normalizeForMatch(content);
  const needle = normalizeForMatch(excerpt).replace(/^["'.\s]+|["'.\s]+$/g, '').trim();
  if (needle.length < 10) return false;

  // 1. Exact (normalized) substring.
  if (hay.includes(needle)) return true;

  // 2. Ellipsis-elided quote ("A … B"): each kept segment must appear, in order.
  const segments = needle
    .split(/\s*(?:\.{2,}|…)\s*/)
    .map(s => s.trim())
    .filter(s => s.length >= 8);
  if (segments.length >= 2) {
    let from = 0;
    let allFound = true;
    for (const seg of segments) {
      const idx = hay.indexOf(seg, from);
      if (idx < 0) { allFound = false; break; }
      from = idx + seg.length;
    }
    if (allFound) return true;
  }

  // 3. Anchored fuzzy: near-verbatim with a minor boundary/punctuation edit. Anchor on
  //    the longest distinctive word and compare a same-length content window by
  //    contiguous overlap (≥85%). Conservative enough that paraphrases don't pass.
  const anchor = needle.split(' ').filter(w => w.length >= 6).sort((a, b) => b.length - a.length)[0];
  if (!anchor) return false;
  const span = needle.length;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(anchor, from);
    if (idx < 0) break;
    const window = hay.slice(Math.max(0, idx - span), idx + span);
    if (longestCommonSubstringRatio(needle, window) >= 0.85) return true;
    from = idx + anchor.length;
  }
  return false;
}

export class TaintKeyProvenanceTracker {
  private evidenceStore = new Map<string, EvidenceEntry>();

  addEvidence(
    tc: ToolCall,
    resultStr: string
  ): { key: string | null; annotatedResult: string } {
    const isEmpty = isEmptyResult(resultStr);

    if (isEmpty) {
      const toolLabel = tc.name.split('__').pop() || tc.name;
      const entry: EvidenceEntry = {
        key: '',
        toolCallId: tc.id,
        toolName: tc.name,
        args: tc.arguments,
        content: resultStr,
        isEmpty: true,
        timestamp: new Date().toISOString(),
      };
      this.evidenceStore.set(`empty-${tc.id}`, entry);

      return {
        key: null,
        annotatedResult:
          `[NO DATA] The tool "${toolLabel}" returned no results for the given query. ` +
          `Do not fabricate data. Tell the user no results were found.`,
      };
    }

    const key = generateTaintKey();
    const entry: EvidenceEntry = {
      key,
      toolCallId: tc.id,
      toolName: tc.name,
      args: tc.arguments,
      content: resultStr,
      isEmpty: false,
      timestamp: new Date().toISOString(),
    };
    this.evidenceStore.set(key, entry);

    return {
      key,
      annotatedResult: `[${key}] ${resultStr}`,
    };
  }

  /**
   * Parse a <provenance> JSON block from the LLM response, verify each claim's
   * evidence key and excerpt against the evidence store.
   */
  verifyStructuredClaims(fullText: string): ProvenanceReport {
    const rawClaims = parseProvenanceBlock(fullText);
    const citedKeys = new Set<string>();

    const claims: ClaimEvidence[] = rawClaims.map(raw => {
      const entry = this.evidenceStore.get(raw.evidenceKey);
      const keyValid = !!entry && !entry.isEmpty;

      // Verify the excerpt by checking that its key tokens (IDs, PMIDs,
      // relationship labels) actually appear in the evidence content.
      // This handles the LLM reformatting JSON into arrow notation.
      let excerptVerified = false;
      if (keyValid && entry && raw.excerpt) {
        const tokens = extractVerificationTokens(raw.excerpt);
        if (tokens.length > 0) {
          const contentLower = entry.content.toLowerCase();
          const matched = tokens.filter(t => contentLower.includes(t));
          // Verified if 80%+ of tokens found in evidence
          excerptVerified = matched.length >= Math.ceil(tokens.length * 0.8);
        }
        // Verbatim (formatting-forgiving) match for plain-text excerpts. Recovers
        // real quotes that differ only in whitespace/case/entities/elision, while
        // still rejecting genuine paraphrases.
        if (!excerptVerified) {
          excerptVerified = excerptMatches(raw.excerpt, entry.content);
        }
      }

      if (keyValid) citedKeys.add(raw.evidenceKey);

      return {
        claim: raw.claim,
        evidenceKey: raw.evidenceKey,
        excerpt: raw.excerpt,
        sourceIds: raw.sourceIds,
        keyValid,
        excerptVerified,
      };
    });

    const uncitedKeys: string[] = [];
    for (const [key, entry] of this.evidenceStore) {
      if (!entry.isEmpty && !citedKeys.has(key)) {
        uncitedKeys.push(key);
      }
    }

    const hasEvidence = Array.from(this.evidenceStore.values()).some(e => !e.isEmpty);

    return {
      evidenceStore: Object.fromEntries(this.evidenceStore),
      claims,
      uncitedKeys,
      hasEvidence,
    };
  }

  getEvidenceStore(): Record<string, EvidenceEntry> {
    return Object.fromEntries(this.evidenceStore);
  }
}

interface RawClaim {
  claim: string;
  evidenceKey: string;
  excerpt: string;
  sourceIds?: string[];
}

/**
 * Extract and parse the <provenance> JSON block from the LLM response.
 * Returns empty array if no block found or parsing fails.
 */
function parseProvenanceBlock(text: string): RawClaim[] {
  const match = /<provenance>([\s\S]*?)<\/provenance>/i.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: unknown): c is RawClaim =>
        typeof c === 'object' && c !== null &&
        typeof (c as RawClaim).claim === 'string' &&
        typeof (c as RawClaim).evidenceKey === 'string' &&
        typeof (c as RawClaim).excerpt === 'string'
    );
  } catch {
    return [];
  }
}

/**
 * Strip the <provenance> block from the response text so it doesn't render.
 */
export function stripProvenanceBlock(text: string): string {
  return text.replace(/<provenance>[\s\S]*?<\/provenance>/gi, '').trim();
}

export const TAINT_KEY_SYSTEM_PROMPT = `

PROVENANCE RULES (MANDATORY):
- Each tool result is prefixed with an evidence key like [ev-a7f3b2].
- If a tool returned [NO DATA], do NOT fabricate results. Tell the user no data was found.
- After your response, you MUST append a <provenance> block containing a JSON array of claims.
- Each claim should extract the SPECIFIC supporting evidence from the tool result, not just reference the whole result.
- Format:
<provenance>
[
  {
    "claim": "Androgens upregulate TMPRSS2 expression",
    "evidenceKey": "ev-a7f3b2",
    "excerpt": "UMLS:C0002844 (Androgens) → stimulates → TMPRSS2 gene",
    "sourceIds": ["PMID:12345678"]
  }
]
</provenance>

Rules for the provenance block:
- "claim": A specific factual claim you made in your response.
- "evidenceKey": The [ev-XXXXXX] key from the tool result that supports this claim.
- "excerpt": Copy a fragment of the tool result VERBATIM — character-for-character. Do NOT paraphrase, summarize, reformat, or insert your own words (no added brackets like "[clarification]", no editorial notes inside the quote). If you must shorten, drop whole clauses and mark the gap with "...", but never alter the words you keep. Excerpts are verified by exact matching against the tool result — any edit fails verification. Titles and abstracts are fine to quote — but copy ONLY text that literally appears in the result. Search results sometimes TRUNCATE long fields (a title or abstract cut off mid-sentence or at a "|" column boundary); when that happens, quote only up to where it stops — do NOT complete or extend the truncated text from your own knowledge or the report's bibliography. The added words aren't in the result and will fail verification.
- "sourceIds": Any PMIDs, DOIs, or other identifiers found near the excerpt (omit if none).
- Only include claims derived from tool data. Do not include your own reasoning or general knowledge.
- NEVER invent evidence keys or excerpts. Only use what appears in tool results.
- In your response text, place the evidence key [ev-XXXXXX] inline after each factual claim it supports. These will be rendered as citation superscripts.
- IMPORTANT: Place [ev-XXXXXX] keys inside <artifact> blocks too, not just in the surrounding text. Every factual claim needs a citation whether it appears in an artifact or outside one.

Example of a properly cited response:
Androgens are the primary drivers of TMPRSS2 upregulation [ev-a7f3b2].

<artifact type="markdown" title="Results">
## Agents that upregulate TMPRSS2
- **Androgens** — stimulate TMPRSS2 via androgen receptor binding [ev-a7f3b2]
- **Dexamethasone** — increases expression in lung cells [ev-c4d91e]
</artifact>`;
