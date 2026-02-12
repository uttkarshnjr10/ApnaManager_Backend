const js = require('@eslint/js');
const globals = require('globals');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  // 1. Base JavaScript Recommended Rules
  js.configs.recommended,

  // 2. Your Custom Settings
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 12,
      sourceType: 'commonjs', // backend uses require()
      globals: {
        ...globals.node, // Adds process, __dirname, etc.
        ...globals.jest, // Adds describe, test, expect, etc.
      },
    },
    rules: {
      // Your custom rules from the old file
      'no-console': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // 3. Prettier Integration (Must be last to override other rules)
  eslintPluginPrettierRecommended,

  // 4. Global Ignores
  {
    ignores: ['node_modules/', 'coverage/', 'dist/'],
  },
];
