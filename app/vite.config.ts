import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// GitHub Pages のプロジェクトサイト(https://<user>.github.io/gh-file-grass-web/)用
export default defineConfig({
  base: '/gh-file-grass-web/',
  plugins: [vue()],
})
