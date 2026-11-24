#!/usr/bin/env node
/**
 * Static, read-only inventory of remaining Supabase runtime dependencies.
 *
 * This intentionally reports dependencies instead of failing the build: the
 * migration is incremental, and a hard failure would hide useful inventory.
 * It never reads process.env, prints credential values, or makes network calls.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'worker'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'staging-dist', '.git']);
const sourceFiles = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(path.join(directory, entry.name));
      continue;
    }
    const absolute = path.join(directory, entry.name);
    if (EXTENSIONS.has(path.extname(entry.name)) && !/\.test\.[^.]+$/.test(entry.name)) {
      sourceFiles.push(absolute);
    }
  }
}

for (const root of SCAN_ROOTS) walk(path.join(ROOT, root));
sourceFiles.sort();

const patterns = {
  supabaseImports: /from\s*['"]@supabase\/supabase-js['"]/g,
  tables: /\b(?:supabase|baseClient)\s*\.\s*from\s*\(\s*['"`]([^'"`]+)['"`]/g,
  rpc: /\b(?:supabase|baseClient)\s*\.\s*rpc\s*\(\s*['"`]([^'"`]+)['"`]/g,
  edgeFunctions: /\b(?:supabase|baseClient)\s*\.\s*functions\s*\.\s*invoke\s*\(\s*['"`]([^'"`]+)['"`]/g,
  edgeFunctionWrappers: /\binvokeEdgeFunction(?:\s*<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]/g,
  storageBuckets: /\b(?:supabase|baseClient)\s*\.\s*storage\s*\.\s*from\s*\(\s*['"`]([^'"`]+)['"`]/g,
  realtimeChannels: /\b(?:supabase|baseClient)\s*\.\s*channel\s*\(\s*['"`]([^'"`]+)['"`]/g,
  authMethods: /\b(?:supabase|baseClient)\s*\.\s*auth\s*\.\s*([A-Za-z_$][\w$]*)/g,
  supabaseHosts: /https?:\/\/[a-z0-9-]+\.supabase\.co/gi,
  supabaseEnvNames: /\b(?:VITE_)?SUPABASE_(?:URL|ANON_KEY|SECRET_KEY)\b/g,
};

const results = Object.fromEntries(Object.keys(patterns).map((key) => [key, new Set()]));
const callsites = [];
const perFile = [];

for (const absolute of sourceFiles) {
  const content = fs.readFileSync(absolute, 'utf8');
  const relative = path.relative(ROOT, absolute).split(path.sep).join('/');
  const found = {};

  for (const [category, pattern] of Object.entries(patterns)) {
    pattern.lastIndex = 0;
    const values = new Set();
    for (const match of content.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      values.add(value);
      results[category].add(value);
      const before = content.slice(0, match.index ?? 0);
      const line = before.split('\n').length;
      callsites.push({ file: relative, line, category, value });
    }
    if (values.size) found[category] = [...values].sort();
  }

  if (Object.keys(found).length) perFile.push({ file: relative, dependencies: found });
}

const summary = {
  generatedAt: new Date().toISOString(),
  mode: 'static-source-scan',
  networkAccess: false,
  environmentVariablesRead: false,
  credentialValuesPrinted: false,
  scannedRoots: SCAN_ROOTS,
  sourceFilesScanned: sourceFiles.length,
  categories: Object.fromEntries(
    Object.entries(results).map(([key, values]) => [key, [...values].sort()]),
  ),
  counts: Object.fromEntries(
    Object.entries(results).map(([key, values]) => [key, values.size]),
  ),
  callsiteCount: callsites.length,
  perFile,
  limitations: [
    'Only literal and syntactically recognizable call sites are found.',
    'Dynamically constructed table, RPC, bucket, channel, URL and alias names may not be detected.',
    'This report is not proof of deployed runtime traffic or data parity.',
    'No dependency is removed or modified by this scanner.',
  ],
};

process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
