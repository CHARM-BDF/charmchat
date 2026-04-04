import type { ProvenanceReport, ClaimEvidence } from '../types';

/**
 * Replace [ev-XXXXXX] taint keys in text with small superscript badges.
 * Uses the provenance report to find the matching claim index and
 * verification status.
 */
export function renderCitationLinks(content: string, report: ProvenanceReport): string {
  // Build a map from evidence key to claim indices
  const keyToClaims = new Map<string, number[]>();
  report.claims.forEach((c, i) => {
    const list = keyToClaims.get(c.evidenceKey) || [];
    list.push(i);
    keyToClaims.set(c.evidenceKey, list);
  });

  // Track which claim index to use next for each key (for multiple claims per key)
  const keyCounters = new Map<string, number>();

  return content.replace(/\[ev-([a-f0-9]{6})\]/g, (_match, hex) => {
    const key = `ev-${hex}`;
    const claimIndices = keyToClaims.get(key);
    if (!claimIndices || claimIndices.length === 0) {
      // Key exists but no matching claim -- show as neutral badge
      return `<sup class="text-[9px] font-mono text-zinc-400">[?]</sup>`;
    }

    // Cycle through claims for this key
    const counter = keyCounters.get(key) || 0;
    const claimIdx = claimIndices[Math.min(counter, claimIndices.length - 1)];
    keyCounters.set(key, counter + 1);

    const claim = report.claims[claimIdx];
    return citeSup(claimIdx, claim);
  });
}

function citeSup(index: number, claim: ClaimEvidence): string {
  const verified = claim.keyValid && claim.excerptVerified;
  const cls = verified
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-amber-600 dark:text-amber-400';
  const title = claim.claim.replace(/"/g, '&quot;');
  return `<sup class="text-[9px] font-semibold ${cls}" title="${title}">[${index + 1}]</sup>`;
}
