// Ensures the D1 database exists in the target Cloudflare account and that
// wrangler.toml points at its real database_id before migrate/deploy run.
// Safe to run every time: if the database already exists, it just reuses it.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tomlPath = path.join(__dirname, '..', 'wrangler.toml');
const DB_NAME = 'ruanimports-db';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function extractUuid(text) {
  let m = text.match(/"uuid"\s*:\s*"([0-9a-f-]{36})"/i);
  if (m) return m[1];
  m = text.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i);
  if (m) return m[1];
  m = text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return m ? m[1] : null;
}

function findExistingId() {
  const out = run('npx wrangler d1 list --json');
  try {
    const list = JSON.parse(out);
    const found = list.find((db) => db.name === DB_NAME);
    if (found) return found.uuid || found.id || extractUuid(JSON.stringify(found));
  } catch (e) {
    if (out.includes(DB_NAME)) {
      const idx = out.indexOf(DB_NAME);
      return extractUuid(out.slice(idx, idx + 400));
    }
  }
  return null;
}

function createDatabase() {
  const out = run(`npx wrangler d1 create ${DB_NAME} --json`);
  try {
    const info = JSON.parse(out);
    if (info.uuid) return info.uuid;
  } catch (e) {
    // fall through to regex extraction below
  }
  return extractUuid(out);
}

let id = findExistingId();
if (!id) {
  console.log(`Database "${DB_NAME}" not found, creating it...`);
  id = createDatabase();
} else {
  console.log(`Database "${DB_NAME}" already exists (${id}).`);
}

if (!id) {
  console.error('Could not determine D1 database_id.');
  process.exit(1);
}

let toml = readFileSync(tomlPath, 'utf8');
toml = toml.replace(/database_id\s*=\s*".*"/, `database_id = "${id}"`);
writeFileSync(tomlPath, toml);
console.log(`wrangler.toml updated with database_id = ${id}`);
