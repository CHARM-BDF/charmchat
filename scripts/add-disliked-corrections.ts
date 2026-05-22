#!/usr/bin/env npx tsx
/**
 * For each curebench-val conversation containing a disliked assistant message,
 * append an addendum assistant message stating the correct answer.
 *
 * Idempotent: skips conversations that already have the addendum marker.
 *
 * Usage:
 *   npx tsx scripts/add-disliked-corrections.ts            # apply
 *   npx tsx scripts/add-disliked-corrections.ts --dry-run  # preview only
 *
 * Operates directly on data/conversations/ — backend does not need to be running.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MARKER = '<!-- curebench-correction -->';

interface Question {
  id: string;
  question_type: string;
  question: string;
  options?: Record<string, string>;
  correct_answer?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  rating?: 'like' | 'dislike';
  [key: string]: unknown;
}

interface Conversation {
  id: string;
  name: string;
  messages: Message[];
  [key: string]: unknown;
}

function parseArgs() {
  return { dryRun: process.argv.includes('--dry-run') };
}

function loadValset(): Map<string, Question> {
  const path = join(__dirname, 'curebench_valset_pharse1.jsonl');
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const map = new Map<string, Question>();
  for (const line of lines) {
    const q = JSON.parse(line) as Question;
    map.set(q.id, q);
  }
  return map;
}

function buildAddendum(q: Question): string {
  const letter = q.correct_answer;
  if (!letter) return '';
  const text = q.options?.[letter];
  const body = text
    ? `The correct answer was **${letter}**: ${text}`
    : `The correct answer was **${letter}**.`;
  return `${MARKER}\n\n**Correction (addendum):** ${body}`;
}

function questionIdFromConvId(convId: string): string | null {
  const m = convId.match(/^curebench-val-(.+)$/);
  return m ? m[1] : null;
}

function main() {
  const { dryRun } = parseArgs();
  const valset = loadValset();
  const convDir = join(__dirname, '..', 'data', 'conversations');
  const files = readdirSync(convDir).filter(
    (f) => f.startsWith('curebench-val-') && f.endsWith('.json'),
  );

  let scanned = 0;
  let disliked = 0;
  let updated = 0;
  let alreadyDone = 0;
  let noQuestion = 0;
  let noAnswer = 0;

  for (const file of files) {
    scanned++;
    const path = join(convDir, file);
    let conv: Conversation;
    try {
      conv = JSON.parse(readFileSync(path, 'utf-8')) as Conversation;
    } catch {
      continue;
    }

    const hasDislike = conv.messages.some((m) => m.rating === 'dislike');
    if (!hasDislike) continue;
    disliked++;

    if (conv.messages.some((m) => m.content.includes(MARKER))) {
      alreadyDone++;
      continue;
    }

    const qid = questionIdFromConvId(conv.id);
    const q = qid ? valset.get(qid) : undefined;
    if (!q) {
      noQuestion++;
      console.log(`  SKIP ${conv.id}: question not found in valset`);
      continue;
    }
    if (!q.correct_answer) {
      noAnswer++;
      console.log(`  SKIP ${conv.id}: no correct_answer in valset`);
      continue;
    }

    const addendum: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: buildAddendum(q),
      timestamp: new Date().toISOString(),
    };

    if (dryRun) {
      console.log(`  [DRY] ${conv.id}: would append correction (answer=${q.correct_answer})`);
    } else {
      conv.messages.push(addendum);
      conv.updated = new Date().toISOString();
      writeFileSync(path, JSON.stringify(conv, null, 2), 'utf-8');
      console.log(`  APPEND ${conv.id}: correct=${q.correct_answer}`);
    }
    updated++;
  }

  console.log(
    `\nScanned ${scanned} conversations — ${disliked} disliked, ${alreadyDone} already annotated, ` +
    `${updated} ${dryRun ? 'would be updated' : 'updated'}` +
    (noQuestion ? `, ${noQuestion} missing question` : '') +
    (noAnswer ? `, ${noAnswer} missing correct_answer` : ''),
  );
}

main();
