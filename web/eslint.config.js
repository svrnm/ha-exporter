import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

const reactRecommended = react.configs.flat.recommended

export default [
  { ignores: ['dist'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      ...reactRecommended.plugins,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      ...reactRecommended.languageOptions,
      globals: globals.browser,
      parserOptions: {
        ...reactRecommended.languageOptions.parserOptions,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...reactRecommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react/prop-types': 'off',
      // React Compiler rules (bundled in react-hooks 7+): too strict for this codebase without compiler adoption.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      // Context + helper exports alongside components are intentional here.
      'react-refresh/only-export-components': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
]
