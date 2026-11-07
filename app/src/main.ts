import { GitHubClient } from '@gh-file-grass/github-adapter'
import '@gh-file-grass/core/style.css'
import { createApp } from 'vue'
import App from './App.vue'
import { HISTORY_CLIENT } from './lib/client'

// GitHubClient は #private を持つので、ref / reactive に入れてはいけない(Proxy 越しだと TypeError)。
// 1 ページにつき 1 インスタンス。キャッシュはこの中にだけある。
const app = createApp(App)
app.provide(HISTORY_CLIENT, new GitHubClient())
app.mount('#app')
