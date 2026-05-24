import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { LLMService } from './src/services/llm/index.js';
import { MCPService } from './src/services/mcp.js';
import { PicrophantService } from './src/services/picrophant.js';
import type { McpServersConfig } from './src/types/index.js';

const REPORT_PATH = '../samples/report.md'; // relative to backend/ cwd
const PROVIDER = 'bedrock' as const;
const MODEL = 'global.anthropic.claude-sonnet-4-6';
const OUT = 'picrophant-out.md';

// Focused evidence stack: the mediKanren-aligned core + drug/trial sources.
// Skips tooluniverse (uv, slow cold-load), workflow (needs a running backend),
// python/hpa/string-db (not needed to refute these claims).
const config: McpServersConfig = {
  mcpServers: {
    medik: { command: 'node', args: ['../mcp-servers/medik-mcp/dist/index.js'] },
    pubmed: { command: 'node', args: ['../mcp-servers/pubmed-mcp/dist/index.js'] },
    'id-finder': { command: 'node', args: ['../mcp-servers/id-finder-mcp/dist/index.js'] },
    chembl: { command: 'node', args: ['../mcp-servers/chembl-mcp/dist/index.js'] },
    dgidb: { command: 'node', args: ['../mcp-servers/dgidb-mcp/dist/index.js'] },
    'clinical-trials': { command: 'node', args: ['../mcp-servers/clinicalTrialGov-mcp/dist/index.js'] },
  },
};

async function main() {
  const report = readFileSync(REPORT_PATH, 'utf8');
  console.error(`Report loaded: ${report.length} chars`);

  const llm = new LLMService();
  const mcp = new MCPService();

  console.error('Initializing MCP servers...');
  await mcp.initialize(config);
  for (const s of mcp.getStatus()) {
    console.error(`  ${s.name}: ${s.status}${s.error ? ` (${s.error})` : ''} — ${s.tools.length} tools`);
  }
  console.error(`Total tools available to sub-agent: ${mcp.getTools().length}`);

  const pico = new PicrophantService(llm, mcp);
  console.error(`\nChallenging report via ${PROVIDER}/${MODEL} ...\n`);
  const t0 = Date.now();
  const result = await pico.challengeReport({ report }, { provider: PROVIDER, model: MODEL });
  console.error(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const md = result.content[0]?.text ?? '(no content)';
  writeFileSync(OUT, md);
  console.error(`Counter-report written to backend/${OUT}\n`);
  console.log(md);

  await mcp.cleanup();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
