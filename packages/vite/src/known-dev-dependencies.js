// Packages that are dev-only build tools and should never be aliased into a
// production bundle. The dependency deduplicator skips any package whose name
// appears here — even if multiple versions are installed — to avoid pointing
// a test or tooling package at an unexpected version.
export const KNOWN_DEV_DEPENDENCIES = new Set([
  // Fluent/Next UI build tooling
  '@servicenow/sdk',
  '@servicenow/glide',

  // Bundlers
  'webpack',
  'webpack-cli',
  'webpack-dev-server',
  'esbuild',
  'rollup',
  'vite',

  // Babel
  '@babel/core',
  '@babel/cli',
  '@babel/eslint-parser',
  '@babel/preset-env',
  '@babel/preset-react',
  '@babel/preset-typescript',
  '@babel/plugin-transform-runtime',
  '@babel/register',

  // TypeScript
  'typescript',
  'ts-node',
  'tsx',

  // Testing
  'jest',
  'jest-cli',
  'vitest',
  'mocha',
  'chai',
  'karma',
  'jasmine',
  'playwright',
  '@playwright/test',
  '@vitest/ui',
  '@jest/core',
  '@jest/transform',
  '@jest/types',
  '@testing-library/dom',
  '@testing-library/react',
  'jest-diff',
  'jest-get-type',
  'pretty-format',

  // Linting & formatting
  'eslint',
  'prettier',
  'stylelint',

  // Storybook
  'storybook',
  '@storybook/core',
  '@storybook/web-components-vite',

  // Type utilities
  'tsd',
  'type-fest',
])
