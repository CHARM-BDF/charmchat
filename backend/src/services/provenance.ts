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
        // Direct substring match for plain-text excerpts
        if (!excerptVerified) {
          const cleaned = raw.excerpt.replace(/\.{2,}$/, '').trim();
          if (cleaned.length > 10) {
            excerptVerified = entry.content.toLowerCase().includes(cleaned.toLowerCase());
          }
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
- "excerpt": Copy a fragment of the tool result VERBATIM — character-for-character. Do NOT paraphrase, summarize, reformat, or insert your own words (no added brackets like "[clarification]", no editorial notes inside the quote). If you must shorten, drop whole clauses and mark the gap with "...", but never alter the words you keep. Excerpts are verified by exact matching against the tool result — any edit fails verification.
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
