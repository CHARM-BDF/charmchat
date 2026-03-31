import crypto from 'crypto';
import type { ToolCall, EvidenceEntry, CitationVerification, ProvenanceReport } from '../types/index.js';

const TAINT_KEY_REGEX = /\[ev-([a-f0-9]{6})\]/g;

export function generateTaintKey(): string {
  return 'ev-' + crypto.randomBytes(3).toString('hex');
}

export function extractCitations(text: string): string[] {
  const keys: string[] = [];
  let match;
  while ((match = TAINT_KEY_REGEX.exec(text)) !== null) {
    keys.push('ev-' + match[1]);
  }
  return keys;
}

function isEmptyResult(result: string): boolean {
  if (!result) return true;
  const trimmed = result.trim();
  if (trimmed === '') return true;
  if (trimmed === '{}' || trimmed === '[]' || trimmed === 'null' || trimmed === 'undefined') return true;
  if (trimmed === '{"content":[]}' || trimmed === '{"results":[]}') return true;
  return false;
}

export class TaintKeyProvenanceTracker {
  private evidenceStore = new Map<string, EvidenceEntry>();

  /**
   * Tag a tool result with a taint key. If the result is empty, no key is
   * assigned and the result is replaced with a [NO DATA] annotation.
   */
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
      // Store empty entries without a key for the provenance report
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
   * Verify an LLM response against the evidence store. Extracts all cited
   * taint keys and checks each one exists. Returns a full provenance report.
   */
  verifyResponse(fullText: string): ProvenanceReport {
    const citedKeys = extractCitations(fullText);
    const validKeys = new Set<string>();

    const citations: CitationVerification[] = citedKeys.map(key => {
      const entry = this.evidenceStore.get(key);
      const valid = !!entry && !entry.isEmpty;
      if (valid) validKeys.add(key);

      // Extract ~80 chars of surrounding context for the claim
      const claimText = extractClaimContext(fullText, key);

      return { key, valid, evidenceEntry: entry || undefined, claimText };
    });

    // Find evidence keys that were never cited
    const uncitedKeys: string[] = [];
    for (const [key, entry] of this.evidenceStore) {
      if (!entry.isEmpty && !validKeys.has(key)) {
        uncitedKeys.push(key);
      }
    }

    // Count ungrounded segments: split on citations, segments between them
    // that contain substantive text are "ungrounded"
    const segments = fullText.split(TAINT_KEY_REGEX);
    let ungroundedSegments = 0;
    for (let i = 0; i < segments.length; i += 2) {
      // Even indices are text between citations; odd indices are key captures
      const seg = segments[i].trim();
      if (seg.length > 20) ungroundedSegments++;
    }

    const hasEvidence = Array.from(this.evidenceStore.values()).some(e => !e.isEmpty);

    return {
      evidenceStore: Object.fromEntries(this.evidenceStore),
      citations,
      uncitedKeys,
      ungroundedSegments,
      allCitationsValid: citations.length === 0 || citations.every(c => c.valid),
      hasEvidence,
    };
  }

  getEvidenceStore(): Record<string, EvidenceEntry> {
    return Object.fromEntries(this.evidenceStore);
  }
}

/**
 * Extract ~80 chars of text surrounding a citation key for display.
 */
function extractClaimContext(text: string, key: string): string {
  const tag = `[${key}]`;
  const idx = text.indexOf(tag);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + tag.length + 20);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet.replace(tag, '').trim();
}

export const TAINT_KEY_SYSTEM_PROMPT = `

CITATION RULES (MANDATORY):
- Each tool result is prefixed with an evidence key like [ev-a7f3b2].
- When you make ANY factual claim based on tool data, you MUST include the evidence key inline, like this: "The patient is 45 years old [ev-a7f3b2]."
- Place the key immediately after the specific claim it supports.
- You may cite the same key multiple times if multiple claims come from the same evidence.
- If a tool returned [NO DATA], do NOT fabricate results. Tell the user no data was found.
- For your own reasoning or general knowledge (not from tools), do NOT include any evidence key.
- NEVER invent or guess evidence keys. Only use keys that appear in tool results.`;
