import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * One flat config for the whole workspace. Each package runs `eslint .` and
 * ESLint walks up to find this file, so there is a single place rules live.
 *
 * Type-aware rules are switched on deliberately, because the ones worth having
 * here need types to work at all: this codebase is asynchronous almost end to
 * end, and a dropped `await` on a session write, a token claim or a mail
 * enqueue is exactly the class of bug that survives review and every test.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-build/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/db/prisma/**',
    ],
  },

  js.configs.recommended,

  // Type-aware linting for source. projectService finds each package's tsconfig
  // on its own, which is what keeps this working across seven packages without
  // a per-package config file.
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The whole reason type-aware linting is on. A promise dropped on the
      // floor in an auth path fails silently and looks like it worked.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Deliberately unused arguments are written with a leading underscore in
      // this codebase already; honour that rather than fighting it.
      // OFF deliberately. Fastify's contract is that plugins and route
      // handlers are async whether or not they await anything, and test
      // doubles must match the async signatures they stand in for. Nearly
      // every report from this rule here is the framework, not a mistake,
      // and the safety it is sometimes credited with belongs to
      // no-floating-promises above, which is on.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // Tests reach for doubles and partial fixtures on purpose. Keeping the
  // strictest assertions off here stops the linter arguing with deliberately
  // shaped stubs, without weakening anything in src.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/vitest.setup.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // An async generator that only throws is a legitimate double for a
      // provider that fails before yielding anything.
      'require-yield': 'off',
    },
  },

  // Config files and standalone scripts sit outside every package's
  // tsconfig, so the type-aware parser cannot place them. Lint them without
  // type information rather than dropping them from the run entirely.
  {
    files: ['**/*.config.ts', '**/*.config.js', '**/vitest.setup.ts', 'scripts/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false, project: null } },
  },

  // Prettier owns formatting. Last, so it switches off anything stylistic.
  prettier,
);
