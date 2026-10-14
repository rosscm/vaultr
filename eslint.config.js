import tseslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['.agents/**', '.aws/**', '.codex/**']
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
];
