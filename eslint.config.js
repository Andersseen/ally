import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import astro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'audit/**',
    ],
  },

  js.configs.recommended,

  // Type-aware linting for TypeScript sources. `projectService` picks up the
  // nearest tsconfig, which is why every package owns one.
  {
    files: ['**/*.ts', '**/*.mts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Astro components, plus the accessibility rules Ally ought to hold itself to.
  ...astro.configs.recommended,
  ...astro.configs['jsx-a11y-recommended'],

  {
    files: ['**/*.astro'],
    rules: {
      // Tailwind's preflight sets `list-style: none`, which makes Safari and
      // VoiceOver drop list semantics. `role="list"` restores them, so here it
      // is a deliberate fix rather than a redundant role.
      'astro/jsx-a11y/no-redundant-roles': 'off',
    },
  },

  // Config files are plain ESM and are not part of any tsconfig. They still run
  // in Node, so Node's globals exist even though no tsconfig declares them.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: 'readonly' },
    },
  },

  // Must stay last so formatting rules never fight Prettier.
  prettier,
);
