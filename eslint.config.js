import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'packages/github-adapter/test/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
  },
  {
    files: ['**/*.vue'],
    rules: {
      // typescript-eslint が no-undef を切るのは *.ts だけ。未定義の参照は vue-tsc が検出する
      'no-undef': 'off',
      // 外部由来の文字列を HTML として解釈しない(XSS 対策をルールで担保する)
      'vue/no-v-html': 'error',
    },
  },
  prettier,
  {
    files: ['scripts/**'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
)
