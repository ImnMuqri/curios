import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { prisma } from '@curios/db';

/**
 * Brings a deployed database up to this release, before the new API takes traffic. Railway runs it
 * as the API service's pre-deploy command (devDocs/OPERATIONS.md, Deploying on Railway); a failure stops that deploy and the
 * running one stays up.
 *
 *   node --import tsx scripts/prepare-database.ts
 *
 * Three steps, each safe to repeat on every deploy:
 *
 * 1. `prisma migrate deploy`: applies migrations not yet applied, never resets anything.
 * 2. packages/db/prisma/sql/readonly-role.sql: the SELECT-only role the web app reads through, and
 *    its grants. Migrations make tables, not roles, so without this the web app cannot read.
 * 3. That role's password, set from DATABASE_URL_READONLY. The SQL file creates the role with the
 *    development password; production must not keep it. Reading it from the URL the web app uses
 *    means the two can never disagree.
 *
 * Reads DATABASE_URL (the owner of the schema) and DATABASE_URL_READONLY from the environment.
 */
const root = join(import.meta.dirname, '..');
const schema = join(root, 'packages/db/prisma/schema.prisma');
const prismaCli = join(root, 'packages/db/node_modules/prisma/build/index.js');
const ROLE = 'curios_readonly';

const readonlyUrl = process.env.DATABASE_URL_READONLY;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!readonlyUrl) throw new Error('DATABASE_URL_READONLY is not set');
const readonly = new URL(readonlyUrl);
if (decodeURIComponent(readonly.username) !== ROLE) {
  throw new Error(`DATABASE_URL_READONLY must sign in as ${ROLE} (readonly-role.sql creates that role), not ${readonly.username}`);
}
const password = decodeURIComponent(readonly.password);
if (password === '' || password === ROLE) {
  throw new Error(`Give ${ROLE} its own password in DATABASE_URL_READONLY; the development one is not for production`);
}

const run = (...args: string[]) => execFileSync(process.execPath, [prismaCli, ...args, '--schema', schema], { stdio: 'inherit', cwd: root });

console.log('Applying migrations');
run('migrate', 'deploy');

console.log(`Granting ${ROLE} its reads`);
run('db', 'execute', '--file', join(root, 'packages/db/prisma/sql/readonly-role.sql'));

console.log(`Setting ${ROLE}'s password from DATABASE_URL_READONLY`);
// A role statement takes no bound parameters, so the password is quoted as a SQL string literal.
await prisma.$executeRawUnsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password.replaceAll("'", "''")}'`);
await prisma.$disconnect();
console.log('Database ready');
