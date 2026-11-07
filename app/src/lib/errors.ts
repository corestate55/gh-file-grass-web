/** リポジトリにブランチが 1 つも無かった(app 側の判定。GitHub のエラーではない) */
export class NoBranchesError extends Error {
  constructor() {
    super('The repository has no branches')
    this.name = 'NoBranchesError'
  }
}
