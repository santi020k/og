import { defineConfig } from '@santi020k/eslint-config-basic'

import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import * as astroParser from 'astro-eslint-parser'

export default defineConfig({
  detection: false,
  ignores: ['coverage/**', 'dist/**'],
  preset: 'basic',
  runtime: 'node',
  typescript: {
    mode: 'type-aware',
    projectService: true
  },
  workspacePrefixes: ['@santi020k']
}, {
  files: ['astro/**/*.astro'],
  languageOptions: {
    parser: astroParser,
    parserOptions: {
      parser: tsParser
    }
  },
  rules: {
    ...tseslint.configs['flat/disable-type-checked'].rules
  }
}, {
  files: ['src/cli.ts'],
  rules: {
    'n/hashbang': ['error', { additionalExecutables: ['src/cli.ts'] }]
  }
})
