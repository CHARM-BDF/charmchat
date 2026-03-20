#!/usr/bin/env npx tsx
/**
 * CUREBench runner — feeds questions from the JSONL dataset into charmgpt2
 * one at a time via the backend API, mimicking a user pasting each question.
 *
 * Usage:
 *   npx tsx scripts/run-curebench.ts                          # run testset (default)
 *   npx tsx scripts/run-curebench.ts --dataset val            # run valset (with grading)
 *   npx tsx scripts/run-curebench.ts --dataset val --count 10
 *   npx tsx scripts/run-curebench.ts --start 0 --count 5
 *   npx tsx scripts/run-curebench.ts --delay 5000
 *   npx tsx scripts/run-curebench.ts --dry-run
 *
 * Requires the charmgpt2 backend to be running on localhost:3001.
 * Conversations are saved to data/conversations/ with the CUREBench question ID
 * prefixed by "curebench-{dataset}-" for easy identification.
 *
 * For the valset, a results JSON is written to scripts/curebench-val-results.json
 * with per-question grading and aggregate accuracy.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';

const DATASETS: Record<string, string> = {
  test: join(__dirname, 'curebench_testset_phase1.jsonl'),
  val: join(__dirname, 'curebench_valset_pharse1.jsonl'),
};

interface Question {
  id: string;
  question_type: string;
  question: string;
  options?: Record<string, string>;
  correct_answer?: string; // present in valset
}

interface ToolCallDisplay {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

interface Artifact {
  id: string;
  type: string;
  title: string;
  content: string;
  language?: string;
}

interface ToolTraceEntry {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  durationMs: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  artifactIds?: string[];
  toolCalls?: ToolCallDisplay[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    start: 0,
    count: Infinity,
    delay: 2000,
    dryRun: false,
    dataset: 'test' as 'test' | 'val',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start') opts.start = parseInt(args[++i], 10);
    else if (args[i] === '--count') opts.count = parseInt(args[++i], 10);
    else if (args[i] === '--delay') opts.delay = parseInt(args[++i], 10);
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--dataset') opts.dataset = args[++i] as 'test' | 'val';
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatQuestion(q: Question): string {
  let text = q.question;
  if (q.options) {
    text += '\n\nOptions:';
    for (const [key, value] of Object.entries(q.options)) {
      text += `\n${key}: ${value}`;
    }
  }
  text += '\n\nAfter your reasoning, end your response with ANSWER: X (where X is the letter of your chosen option).';
  return text;
}

function conversationId(dataset: string, questionId: string): string {
  return `curebench-${dataset}-${questionId}`;
}

function extractAnswer(response: string): string | null {
  // Match the last occurrence of "ANSWER: X" in the response
  const matches = response.match(/ANSWER:\s*([A-Z])/g);
  if (!matches) return null;
  const last = matches[matches.length - 1];
  const m = last.match(/ANSWER:\s*([A-Z])/);
  return m ? m[1] : null;
}

async function conversationExists(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/conversations/${id}`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Load settings from backend to get provider/model/blocked config */
async function loadSettings(): Promise<{
  provider: string;
  model: string;
  blockedServers?: string[];
  blockedTools?: string[];
}> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// SSE stream → conversation data
// ---------------------------------------------------------------------------

async function runQuestion(
  message: string,
  provider: string,
  model: string,
  blockedServers?: string[],
  blockedTools?: string[],
): Promise<{
  content: string;
  toolCalls: ToolCallDisplay[];
  artifacts: Artifact[];
  traceEntries: ToolTraceEntry[];
}> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: [],
      provider,
      model,
      blockedServers,
      blockedTools,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat API error ${res.status}: ${text}`);
  }

  let accumulated = '';
  const toolCalls: ToolCallDisplay[] = [];
  const artifacts: Artifact[] = [];
  const traceEntries: ToolTraceEntry[] = [];

  // Parse SSE from the response body
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE messages
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // keep incomplete last line

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ') && currentEvent) {
        const dataStr = line.slice(6);
        try {
          const data = JSON.parse(dataStr);
          switch (currentEvent) {
            case 'delta':
              accumulated += data.content || '';
              break;
            case 'tool_call':
              toolCalls.push({ name: data.name, args: data.arguments || data.args || {} });
              break;
            case 'tool_result': {
              const existing = toolCalls.find((t) => t.name === data.name && !t.result);
              if (existing) existing.result = data.result;
              break;
            }
            case 'artifact':
              artifacts.push(data as Artifact);
              break;
            case 'trace_entry':
              traceEntries.push(data as ToolTraceEntry);
              break;
            case 'error':
              console.error('  Stream error:', data.error || data.message);
              break;
            case 'done':
              // final event
              break;
          }
        } catch {
          // skip malformed JSON
        }
        currentEvent = '';
      } else if (line === '') {
        currentEvent = '';
      }
    }
  }

  return { content: accumulated, toolCalls, artifacts, traceEntries };
}

async function saveConversation(
  id: string,
  name: string,
  messages: Message[],
  artifacts: Artifact[],
  toolTrace: ToolTraceEntry[],
  meta: { questionId: string; questionType: string; dataset: string; correctAnswer?: string; extractedAnswer?: string | null; correct?: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      name,
      created: now,
      updated: now,
      messages,
      artifacts,
      toolTrace: toolTrace.length > 0 ? toolTrace : undefined,
      // Store CUREBench metadata for later analysis
      curebenchMeta: meta,
    }),
  });
  if (!res.ok) {
    console.error(`  Failed to save conversation: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Results file (valset only)
// ---------------------------------------------------------------------------

interface GradingResult {
  questionId: string;
  questionType: string;
  correctAnswer: string;
  extractedAnswer: string | null;
  correct: boolean;
}

function resultsPath(): string {
  return join(__dirname, 'curebench-val-results.json');
}

function loadResults(): GradingResult[] {
  const p = resultsPath();
  if (existsSync(p)) {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    return data.results || [];
  }
  return [];
}

function saveResultsFile(results: GradingResult[]): void {
  const correct = results.filter((r) => r.correct).length;
  const graded = results.filter((r) => r.extractedAnswer !== null).length;
  writeFileSync(resultsPath(), JSON.stringify({
    total: results.length,
    graded,
    correct,
    accuracy: results.length > 0 ? Math.round(correct / results.length * 10000) / 100 : 0,
    results,
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const datasetPath = DATASETS[opts.dataset];
  const isVal = opts.dataset === 'val';

  if (!datasetPath || !existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath || opts.dataset}`);
    console.error(`Available: ${Object.keys(DATASETS).join(', ')}`);
    process.exit(1);
  }

  const lines = readFileSync(datasetPath, 'utf-8').split('\n').filter(Boolean);
  const questions: Question[] = lines.map((l) => JSON.parse(l));

  console.log(`Loaded ${questions.length} questions from CUREBench ${opts.dataset}set`);
  if (isVal) console.log('Grading enabled — answers will be compared to correct_answer');

  const settings = await loadSettings();
  console.log(`Using provider: ${settings.provider}, model: ${settings.model}`);

  const end = Math.min(opts.start + opts.count, questions.length);
  const subset = questions.slice(opts.start, end);
  console.log(`Running questions ${opts.start} to ${end - 1} (${subset.length} total)\n`);

  if (opts.dryRun) {
    for (const q of subset) {
      const exists = await conversationExists(conversationId(opts.dataset, q.id));
      console.log(`  [${exists ? 'SKIP' : 'RUN'}] ${q.id} — ${q.question.slice(0, 80)}...`);
    }
    return;
  }

  // Load existing grading results for resume support
  const existingResults = isVal ? loadResults() : [];
  const resultsMap = new Map(existingResults.map((r) => [r.questionId, r]));

  let completed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < subset.length; i++) {
    const q = subset[i];
    const convId = conversationId(opts.dataset, q.id);
    const idx = opts.start + i;

    if (await conversationExists(convId)) {
      console.log(`[${idx}/${questions.length}] SKIP ${q.id} (already exists)`);
      skipped++;
      continue;
    }

    console.log(`[${idx}/${questions.length}] Running ${q.id} (${q.question_type})`);
    console.log(`  Q: ${q.question.slice(0, 100)}...`);

    const message = formatQuestion(q);
    const startTime = Date.now();

    try {
      const result = await runQuestion(
        message,
        settings.provider,
        settings.model,
        settings.blockedServers,
        settings.blockedTools,
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Done in ${elapsed}s — ${result.toolCalls.length} tool calls, ${result.content.length} chars`);

      // Grade if valset
      let extracted: string | null = null;
      let correct = false;
      if (isVal && q.correct_answer) {
        extracted = extractAnswer(result.content);
        correct = extracted === q.correct_answer;
        console.log(`  Grade: ${correct ? 'CORRECT' : extracted ? 'WRONG' : 'NO_ANSWER'} (extracted=${extracted}, correct=${q.correct_answer})`);
        resultsMap.set(q.id, {
          questionId: q.id,
          questionType: q.question_type,
          correctAnswer: q.correct_answer,
          extractedAnswer: extracted,
          correct,
        });
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date(startTime).toISOString(),
      };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.content,
        artifactIds: result.artifacts.map((a) => a.id),
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        timestamp: new Date().toISOString(),
      };

      await saveConversation(
        convId,
        `[CUREBench-${opts.dataset}] ${q.question.slice(0, 50)}`,
        [userMsg, assistantMsg],
        result.artifacts,
        result.traceEntries,
        {
          questionId: q.id,
          questionType: q.question_type,
          dataset: opts.dataset,
          correctAnswer: q.correct_answer,
          extractedAnswer: extracted,
          correct,
        },
      );

      completed++;
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      errors++;
    }

    // Save results incrementally
    if (isVal) {
      saveResultsFile(Array.from(resultsMap.values()));
    }

    if (i < subset.length - 1 && opts.delay > 0) {
      await new Promise((r) => setTimeout(r, opts.delay));
    }
  }

  if (isVal) {
    const allResults = Array.from(resultsMap.values());
    saveResultsFile(allResults);
    const correctCount = allResults.filter((r) => r.correct).length;
    console.log(`\nAccuracy: ${correctCount}/${allResults.length} (${(correctCount / allResults.length * 100).toFixed(1)}%)`);
    console.log(`Results saved to ${resultsPath()}`);
  }

  console.log(`\nDone! completed=${completed} skipped=${skipped} errors=${errors}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
