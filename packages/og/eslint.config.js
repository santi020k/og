import { defineConfig } from '@santi020k/eslint-config-basic'

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
  files: ['src/cli.ts'],
  rules: {
    'n/hashbang': ['error', { additionalExecutables: ['src/cli.ts'] }]
  }
})
