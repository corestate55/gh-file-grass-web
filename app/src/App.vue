<script setup lang="ts">
// 7-1 の暫定版: ビルド基盤(workspace の TS ソースの解決、型検査、lint、CI)の確認用。
import { draw } from '@gh-file-grass/core'
import { parseRepoInput } from '@gh-file-grass/github-adapter'

const repo = parseRepoInput('corestate55/gh-file-grass')
const canDraw = typeof draw === 'function'
</script>

<template>
  <main>
    <h1>gh-file-grass</h1>
    <p>{{ repo.owner }}/{{ repo.repo }} ({{ canDraw ? 'core ready' : 'core missing' }})</p>
  </main>
</template>
