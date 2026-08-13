// Applies every migrations/*.sql file (in order) against the remote D1
// database. Safe to run repeatedly: migrations already applied fail with
// "duplicate column" / "already exists" from SQLite, which we treat as a
// no-op rather than an error.
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');
const DB_NAME = 'ruanimports-db';

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const filePath = path.join(migrationsDir, file);
  console.log(`Applying ${file}...`);
  try {
    const out = execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file="${filePath}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(out);
  } catch (err) {
    const output = `${err.stdout || ''}${err.stderr || ''}`;
    console.log(output);
    if (/duplicate column name/i.test(output) || /already exists/i.test(output)) {
      console.log(`  (already applied, skipping) ${file}`);
      continue;
    }
    console.error(`Migration failed: ${file}`);
    process.exit(1);
  }
}
console.log('Migrations complete.');
