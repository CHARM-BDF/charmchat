#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Constants for the NCBI E-utilities API
const NCBI_API_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TOOL_NAME = 'pubmed-search-mcp';

// Optional environment variables
const NCBI_API_KEY = process.env.NCBI_API_KEY;
const NCBI_TOOL_EMAIL = process.env.NCBI_TOOL_EMAIL || 'anonymous@example.com';

// ---------------------------------------------------------------------------
// Minimal XML helpers (avoids xmldom dependency)
// ---------------------------------------------------------------------------

/** Extract text content of the first matching tag. */
function getTagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

/** Extract all top-level occurrences of a tag (non-greedy). */
function getAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
  return xml.match(re) || [];
}

// ---------------------------------------------------------------------------
// NCBI request helper
// ---------------------------------------------------------------------------

async function makeNCBIRequest(url: string): Promise<string | null> {
  try {
    // Append auth params as raw query strings to avoid URLSearchParams
    // re-encoding commas in the id parameter (efetch needs literal commas)
    const extraParams: string[] = [];
    if (NCBI_API_KEY) {
      extraParams.push(`api_key=${encodeURIComponent(NCBI_API_KEY)}`);
    }
    extraParams.push(`email=${encodeURIComponent(NCBI_TOOL_EMAIL)}`);
    extraParams.push(`tool=${encodeURIComponent(TOOL_NAME)}`);

    const separator = url.includes('?') ? '&' : '?';
    const finalUrl = url + separator + extraParams.join('&');

    const response = await fetch(finalUrl);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[pubmed] HTTP ${response.status} for ${url.split('?')[0]}: ${body.slice(0, 200)}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error('[pubmed] Error making NCBI request:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Article parsing
// ---------------------------------------------------------------------------

interface ArticleData {
  title: string;
  year: string;
  pmid: string;
  abstract: string;
  authors: string[];
  journal: string;
}

function parseArticle(articleXml: string): ArticleData {
  const title = getTagText(articleXml, 'ArticleTitle') || 'No title';

  // Year lives inside <PubDate>
  const pubDate = getAllTags(articleXml, 'PubDate')[0] || '';
  const year = getTagText(pubDate, 'Year') || 'No year';

  const pmid = getTagText(articleXml, 'PMID') || 'No PMID';

  const abstractBlock = getAllTags(articleXml, 'Abstract')[0] || '';
  const abstract = abstractBlock
    ? abstractBlock.replace(/<[^>]+>/g, '').trim() || 'No abstract available'
    : 'No abstract available';

  // Authors
  const authorTags = getAllTags(articleXml, 'Author');
  const authors = authorTags.map(a => {
    const last = getTagText(a, 'LastName') || '';
    const initials = getTagText(a, 'Initials') || '';
    return `${last} ${initials}`.trim();
  }).filter(Boolean);

  // Journal title
  const journalBlock = getAllTags(articleXml, 'Journal')[0] || '';
  const journal = getTagText(journalBlock, 'Title') || 'No journal';

  return { title, year, pmid, abstract, authors, journal };
}

// ---------------------------------------------------------------------------
// Query formatting
// ---------------------------------------------------------------------------

function formatPubMedQuery(terms: Array<{ term: string; operator?: string }>): string {
  return terms.map((item, index) => {
    const { term, operator = 'AND' } = item;
    let formattedTerm;

    if (/^[A-Z0-9]+$/.test(term)) {
      formattedTerm = `${term}[gene]`;
    } else if (term.includes(' ')) {
      formattedTerm = `"${term}"[All Fields]`;
    } else {
      formattedTerm = `${term}[All Fields]`;
    }

    return index === 0 ? formattedTerm : `${operator} ${formattedTerm}`;
  }).join(' ');
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'pubmed-search', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search',
      description:
        'Search PubMed for articles. Extract search terms and boolean operators from the query. For example:\n' +
        '- "find papers about BRCA1 and breast cancer" → terms: [{"term": "BRCA1"}, {"term": "breast cancer", "operator": "AND"}]\n' +
        '- "papers with TP53 or apoptosis" → terms: [{"term": "TP53"}, {"term": "apoptosis", "operator": "OR"}]\n' +
        'Uppercase terms are treated as gene symbols. Multi-word terms are treated as phrases.\n' +
        'Use "sort_by": "pub_date" for latest publications first.',
      inputSchema: {
        type: 'object',
        properties: {
          terms: {
            type: 'array',
            description: 'Array of search terms with optional boolean operators.',
            items: {
              type: 'object',
              properties: {
                term: { type: 'string', description: 'The search term' },
                operator: {
                  type: 'string',
                  enum: ['AND', 'OR', 'NOT'],
                  description: 'Boolean operator to connect with previous term. Ignored for first term.',
                },
              },
              required: ['term'],
            },
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return (1-100)',
          },
          sort_by: {
            type: 'string',
            enum: ['relevance', 'pub_date', 'first_author', 'journal', 'title'],
            description: 'Sort order (default: relevance)',
          },
        },
        required: ['terms'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== 'search') {
    throw new Error(`Unknown tool: ${name}`);
  }

  const terms: Array<{ term: string; operator?: string }> = (args as any).terms;
  const maxResults = Math.min(Math.max((args as any).max_results ?? 10, 1), 100);
  const sortBy = (args as any).sort_by ?? 'relevance';

  const formattedQuery = formatPubMedQuery(terms);
  console.error(`[pubmed] Query: ${formattedQuery} | max=${maxResults} sort=${sortBy}`);

  // Step 1: search for PMIDs
  const searchUrl = `${NCBI_API_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(formattedQuery)}&retmax=${maxResults}&sort=${sortBy}`;
  const searchXml = await makeNCBIRequest(searchUrl);

  if (!searchXml) {
    return { content: [{ type: 'text', text: 'Failed to retrieve search results' }] };
  }

  const pmids = getAllTags(searchXml, 'Id').map(t => t.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  if (pmids.length === 0) {
    return { content: [{ type: 'text', text: 'No results found for the given query' }] };
  }

  // Respect NCBI rate limits: 10 req/s with API key, 3 req/s without
  await new Promise(r => setTimeout(r, NCBI_API_KEY ? 100 : 350));

  // Step 2: fetch article details
  const fetchUrl = `${NCBI_API_BASE}/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=xml`;
  let articlesXml = await makeNCBIRequest(fetchUrl);

  // Retry once after a longer delay if the first attempt fails
  if (!articlesXml) {
    console.error('[pubmed] efetch failed, retrying after 1s delay...');
    await new Promise(r => setTimeout(r, 1000));
    articlesXml = await makeNCBIRequest(fetchUrl);
  }

  if (!articlesXml) {
    return { content: [{ type: 'text', text: `Failed to retrieve article details for PMIDs: ${pmids.join(', ')}` }] };
  }

  const articleBlocks = getAllTags(articlesXml, 'PubmedArticle');
  const articles = articleBlocks.map(parseArticle);

  console.error(`[pubmed] Found ${articles.length} articles`);

  // Build markdown output
  const markdownArticles = articles.map(a => [
    `## ${a.title}`,
    `**Year:** ${a.year} | **PMID:** ${a.pmid}`,
    '',
    a.abstract,
    '',
    '---',
  ].join('\n'));

  const summarizationInstructions = [
    '# Summarization Instructions',
    '',
    'Summarize the information from the publications.',
    'Where possible include the following sections:',
    '',
    '1. **Clinical/Preclinical**: Preclinical studies, human disease relevance, animal models, case studies.',
    '2. **Molecular mechanisms**: Gene/protein interactions, structure, function, pathways.',
    '3. **Target gene regulation**: How the gene is regulated and what it regulates.',
    '4. **Disease related information**: Disease-phenotype info, natural history, prognosis, treatment.',
    '',
    '## IMPORTANT: Include PubMed ID References',
    '',
    'For every statement, include the corresponding PMID as a reference.',
    'Format: `(PMID: 12345678)` at end of sentences.',
    'If multiple papers support a finding: `(PMID: 12345678, 87654321)`.',
    '',
    '---',
    '',
  ].join('\n');

  const fullMarkdown = `${summarizationInstructions}# Search Results for: ${formattedQuery}\n\n${markdownArticles.join('\n\n')}`;

  const bibliographyData = articles.map(a => ({
    authors: a.authors,
    year: a.year,
    title: a.title,
    journal: a.journal,
    pmid: a.pmid,
  }));

  return {
    content: [{ type: 'text', text: fullMarkdown }],
    artifacts: [
      {
        type: 'application/vnd.bibliography',
        title: 'Bibliography',
        content: bibliographyData,
      },
    ],
  } as any;
});

// Start
async function main() {
  if (NCBI_API_KEY) {
    console.error('[pubmed] NCBI API Key found, using authenticated requests');
  } else {
    console.error('[pubmed] No NCBI API Key found, using unauthenticated requests (3 req/s limit)');
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[pubmed] PubMed Search MCP Server running on stdio');
}

main().catch((error) => {
  console.error('[pubmed] Fatal error:', error);
  process.exit(1);
});
