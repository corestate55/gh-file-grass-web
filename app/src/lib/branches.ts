/** 既定のブランチ: main → master → 先頭。ブランチが無ければ null */
export function pickDefaultBranch(branches: readonly { name: string }[]): string | null {
  for (const preferred of ['main', 'master']) {
    if (branches.some((b) => b.name === preferred)) return preferred
  }
  return branches[0]?.name ?? null
}
