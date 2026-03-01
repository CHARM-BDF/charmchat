import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DOCKER_IMAGE = 'my-python-mcp';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export interface OutputFile {
  filename: string;
  mimeType: string;
  base64: string;
}

export interface ExecuteResult {
  output: string;
  error?: string;
  files: OutputFile[];
}

function transformCode(code: string): string {
  let transformed = code;

  // Auto-add os import if code uses file operations
  if (/savefig|to_csv|to_excel|to_json|open\(/.test(code) && !/import os/.test(code)) {
    transformed = 'import os\n' + transformed;
  }

  // Transform plt.savefig('file.png') → plt.savefig(os.path.join(os.environ['OUTPUT_DIR'], 'file.png'))
  transformed = transformed.replace(
    /plt\.savefig\(\s*(['"])([^'"]+)\1/g,
    (_match, quote, filename) =>
      `plt.savefig(os.path.join(os.environ['OUTPUT_DIR'], ${quote}${filename}${quote})`
  );

  // Transform df.to_csv('file.csv')
  transformed = transformed.replace(
    /\.to_csv\(\s*(['"])([^'"]+)\1/g,
    (_match, quote, filename) =>
      `.to_csv(os.path.join(os.environ['OUTPUT_DIR'], ${quote}${filename}${quote})`
  );

  // Transform df.to_excel('file.xlsx')
  transformed = transformed.replace(
    /\.to_excel\(\s*(['"])([^'"]+)\1/g,
    (_match, quote, filename) =>
      `.to_excel(os.path.join(os.environ['OUTPUT_DIR'], ${quote}${filename}${quote})`
  );

  return transformed;
}

async function ensureDockerImage(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['image', 'inspect', DOCKER_IMAGE], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Docker image '${DOCKER_IMAGE}' not found. Build it with:\n  cd mcp-servers/python-mcp && docker build -t ${DOCKER_IMAGE} .`
          )
        );
      }
    });
  });
}

function collectOutputFiles(outputDir: string): OutputFile[] {
  const files: OutputFile[] = [];
  if (!fs.existsSync(outputDir)) return files;

  for (const entry of fs.readdirSync(outputDir)) {
    const ext = path.extname(entry).toLowerCase();
    const filePath = path.join(outputDir, entry);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    if (IMAGE_EXTENSIONS.has(ext)) {
      const data = fs.readFileSync(filePath);
      files.push({
        filename: entry,
        mimeType: MIME_TYPES[ext] || 'application/octet-stream',
        base64: data.toString('base64'),
      });
    }
  }
  return files;
}

export async function execute(code: string, timeout: number): Promise<ExecuteResult> {
  await ensureDockerImage();

  const transformed = transformCode(code);

  // Separate dirs for script (read-only mount) and output (read-write mount)
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-mcp-script-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-mcp-output-'));
  const scriptPath = path.join(scriptDir, 'script.py');
  fs.writeFileSync(scriptPath, transformed, 'utf-8');

  try {
    const result = await runInDocker(scriptPath, outputDir, timeout);
    const files = collectOutputFiles(outputDir);
    return { ...result, files };
  } finally {
    try { fs.rmSync(scriptDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch {}
  }
}

function runInDocker(
  scriptPath: string,
  outputDir: string,
  timeout: number
): Promise<Omit<ExecuteResult, 'files'>> {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      '--rm',
      '--memory=256m',
      '--cpus=1.0',
      '--network=none',
      '-v', `${path.dirname(scriptPath)}:/app/script:ro`,
      '-v', `${outputDir}:/app/output`,
      '-e', 'OUTPUT_DIR=/app/output',
      '-e', 'PYTHONUNBUFFERED=1',
      '-e', 'MPLBACKEND=Agg',
      '-e', 'PYTHONIOENCODING=utf-8',
      DOCKER_IMAGE,
      'python', '/app/script/script.py',
    ];

    const proc = spawn('docker', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Execution timed out after ${timeout} seconds`));
    }, timeout * 1000);

    proc.on('close', (exitCode) => {
      clearTimeout(timer);

      if (exitCode === 0) {
        resolve({ output: stdout.trim() });
      } else {
        resolve({
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${exitCode}`,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
