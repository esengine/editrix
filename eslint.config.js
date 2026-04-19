// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';

export default tseslint.config(
  // Global ignores
  { ignores: ['**/dist/', '**/dist-renderer/', '**/node_modules/', '**/*.js', '**/*.cjs', '!eslint.config.js'] },

  // Base JS rules
  eslint.configs.recommended,

  // TypeScript strict + stylistic
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // TypeScript parser options
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Tests and vitest configs live outside per-package build tsconfigs.
  // Running them through the default project trips tseslint's glob guard,
  // so skip them at the lint level — they're checked by `vitest` instead.
  {
    ignores: [
      '**/__tests__/**/*.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/vitest.config.ts',
    ],
  },

  // Project rules
  {
    plugins: {
      'import-x': importPlugin,
    },
    rules: {
      // ─── Import discipline ─────────────────────────────
      // Enforce import type for type-only imports (matches verbatimModuleSyntax)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',

      // Import ordering
      'import-x/order': [
        'error',
        {
          'groups': [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'never',
          'alphabetize': { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-mutable-exports': 'error',

      // ─── TypeScript strictness ─────────────────────────
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'off',

      // ─── Naming conventions ────────────────────────────
      '@typescript-eslint/naming-convention': [
        'error',
        // Interfaces: PascalCase. Service/behavior interfaces use I prefix (enforced by review, not lint).
        {
          selector: 'interface',
          format: ['PascalCase'],
        },
        // Type aliases: PascalCase
        {
          selector: 'typeAlias',
          format: ['PascalCase'],
        },
        // Enums: PascalCase
        {
          selector: 'enum',
          format: ['PascalCase'],
        },
        // Enum members: PascalCase
        {
          selector: 'enumMember',
          format: ['PascalCase'],
        },
        // Private members: camelCase with _ prefix
        {
          selector: 'memberLike',
          modifiers: ['private'],
          format: ['camelCase'],
          leadingUnderscore: 'require',
        },
        // Class methods: camelCase (private handled above)
        {
          selector: 'method',
          modifiers: ['public', 'protected'],
          format: ['camelCase'],
        },
        // Variables: camelCase or UPPER_CASE (constants) or PascalCase (service IDs)
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
        },
        // Parameters: camelCase
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
      ],

      // Type parameter used only once is OK for API design (e.g., emit<T>, on<T>)
      '@typescript-eslint/no-unnecessary-type-parameters': 'warn',

      // ─── General quality ───────────────────────────────
      'no-console': 'error',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],

      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Relax some overly strict rules for our use case
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },

  // Test file overrides
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-console': 'off',
    },
  },
);
