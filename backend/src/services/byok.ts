import type { ProviderName } from '../types/index.js';

export function isByokMode(): boolean {
  const v = process.env.BYOK;
  if (!v) return false;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

export const BYOK_PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'gemini'];

export function isByokProvider(p: ProviderName): boolean {
  return BYOK_PROVIDERS.includes(p);
}

// Belt-and-suspenders scrubber for error messages that might quote a key.
// Real risk is low (the SDKs don't echo keys), but cheap to add.
const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,                 // Anthropic
  /sk-[A-Za-z0-9]{20,}/g,                       // OpenAI legacy
  /sk-proj-[A-Za-z0-9_-]{20,}/g,                // OpenAI project
  /AIza[A-Za-z0-9_-]{30,}/g,                    // Google
];

export function scrubKeys(s: string): string {
  let out = s;
  for (const pat of KEY_PATTERNS) {
    out = out.replace(pat, '[REDACTED_KEY]');
  }
  return out;
}
