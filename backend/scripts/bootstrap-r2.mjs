// Ensures the R2 bucket used for product photos exists. Safe to run
// every time: if the bucket already exists, this is a no-op.
import { execSync } from 'node:child_process';

const BUCKET_NAME = 'ruanimports-images';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function bucketExists() {
  const out = run('npx wrangler r2 bucket list');
  return out.includes(BUCKET_NAME);
}

if (bucketExists()) {
  console.log(`R2 bucket "${BUCKET_NAME}" already exists.`);
} else {
  console.log(`R2 bucket "${BUCKET_NAME}" not found, creating it...`);
  run(`npx wrangler r2 bucket create ${BUCKET_NAME}`);
  console.log('Created.');
}
