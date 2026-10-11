import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  {
    ignores: [
      'dist/**',
      'release/**',
      'installer/**',
      'node_modules/**',
      '.claude/worktrees/**',
      'backend/**',
      'deploy/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,

      // The rule that matters most here: an undefined identifier in a component
      // (e.g. using `isDark` without calling useTheme()) throws at render time
      // and the error boundary blanks the whole screen. Keep this an error.
      'no-undef': 'error',

      ...reactHooks.configs.recommended.rules,

      // react-hooks v7 added several rules this codebase predates. They flag
      // real patterns but firing 150+ times drowns the crash-class signal
      // above, so they're warnings until someone works through them.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',

      // Noise reduction — these are stylistic and pre-date the linter.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // Split View mounts the same page in both panes, so a page's element ids
    // are not unique in the document. A document-wide lookup returns the first
    // match — the other pane's element — and one portfolio's chart was drawn
    // over the other's that way. Reach elements through a ref, or query inside
    // one. Only the React root is looked up by id.
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/main.jsx'],
    rules: {
      'no-restricted-properties': ['error', {
        object: 'document',
        property: 'getElementById',
        message: 'Split View mounts a page in both panes, so ids repeat. Use a ref, or query inside one.',
      }, {
        object: 'document',
        property: 'querySelector',
        message: 'Split View mounts a page in both panes, so this can match the other pane. Use a ref, or query inside one.',
      }],
    },
  },
  {
    // Electron main/preload run in Node, not the browser.
    files: ['electron/**/*.js', 'scripts/**/*.js', 'launch.js', '*.config.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]
