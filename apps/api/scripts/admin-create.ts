import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { prisma } from '@curios/db';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/modules/auth/password.service.js';

/**
 * Creates a Curios admin, or resets an existing one's password and re-enables them.
 *
 *   pnpm --filter @curios/api admin:create <email> "<name>"
 *
 * The password is asked for twice at a prompt that does not echo; it is never an
 * argument, so it never reaches a shell history or a process list.
 */
/** One interface for both questions: a second one would miss lines the first already buffered. */
function hiddenPrompt() {
  // Output goes nowhere, so what is typed is not echoed; the questions are written by hand.
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: Boolean(process.stdin.isTTY) });
  const lines = rl[Symbol.asyncIterator]();

  return {
    async ask(question: string): Promise<string> {
      process.stdout.write(question);
      const next = await lines.next();
      process.stdout.write('\n');
      return next.done ? '' : next.value;
    },
    close: () => rl.close(),
  };
}

async function main() {
  const [rawEmail, name] = process.argv.slice(2);
  if (!rawEmail || !name) {
    console.error('Usage: pnpm --filter @curios/api admin:create <email> "<name>"');
    process.exit(1);
  }
  const email = rawEmail.trim().toLowerCase();

  const prompt = hiddenPrompt();
  const password = await prompt.ask('Password: ');
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  const again = await prompt.ask('Password again: ');
  prompt.close();
  if (again !== password) {
    console.error('The two passwords do not match.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await prisma.adminUser.update({
        where: { id: existing.id },
        data: { passwordHash, name, disabledAt: null },
      });
      console.log(`Reset the password for ${email} and enabled the account.`);
    } else {
      await prisma.adminUser.create({ data: { email, name, passwordHash } });
      console.log(`Created admin ${email}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
