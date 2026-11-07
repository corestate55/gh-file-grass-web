import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// GitHub Pages のプロジェクトサイト(https://<user>.github.io/<repo>/)用。
// 既定は https://<user>.github.io/gh-file-grass-web/。リポジトリ名が違う場合や独自ドメインでは、
// BASE_PATH(例: '/other-name/' や '/')で上書きできる。デプロイのワークフローは Pages の設定から渡す。
function normalizeBase(value: string | undefined): string {
  if (!value) return '/gh-file-grass-web/'
  const withLeading = value.startsWith('/') ? value : `/${value}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  plugins: [vue()],
})
