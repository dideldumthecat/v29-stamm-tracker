import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginPlaywright from 'eslint-plugin-playwright'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import pluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'test-results/**', 'playwright-report/**']),

  // Vue style guide priorities A-C (essential + strongly recommended + recommended)
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,

  // Tailwind: report unknown classes (typos like `bg-inc`) as errors.
  // Only the correctness rules – class order and line wrapping are left to Prettier.
  {
    name: 'app/tailwind',
    files: ['src/**/*.vue'],
    ...pluginBetterTailwindcss.configs.correctness,
    settings: {
      // Tailwind 4 has no tailwind.config.js – the configuration lives in the CSS entry file
      'better-tailwindcss': { entryPoint: 'src/assets/main.css' },
    },
  },

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*'],
  },

  {
    ...pluginPlaywright.configs['flat/recommended'],
    files: ['e2e/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },

  // Formatting is Prettier's job: turn off all ESLint rules that would conflict with it
  skipFormatting,
)
