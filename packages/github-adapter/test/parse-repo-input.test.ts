import { describe, expect, test } from 'vitest'
import { InvalidInputError } from '../src/errors'
import { parseRepoInput } from '../src/parse-repo-input'

describe('parseRepoInput: accepted', () => {
  test.each([
    ['owner/repo', 'owner', 'repo'],
    ['  owner/repo  ', 'owner', 'repo'],
    ['owner/repo/', 'owner', 'repo'],
    ['owner/repo.git', 'owner', 'repo'],
    ['Owner/Repo', 'Owner', 'Repo'], // case is kept
    ['https://github.com/o/r', 'o', 'r'],
    ['https://github.com/o/r/', 'o', 'r'],
    ['https://github.com/o/r.git', 'o', 'r'],
    ['https://github.com/o/r.git/', 'o', 'r'],
    ['https://github.com/o/r/tree/feature/x', 'o', 'r'],
    ['https://github.com/o/r/blob/main/README.md', 'o', 'r'],
    ['https://github.com/o/r/commits/main', 'o', 'r'],
    ['https://github.com/o/r?tab=readme-ov-file', 'o', 'r'],
    ['https://github.com/o/r#readme', 'o', 'r'],
    ['HTTPS://GitHub.COM/O/R', 'O', 'R'],
    ['https://www.github.com/o/r', 'o', 'r'],
    ['github.com/o/r', 'o', 'r'],
    ['www.github.com/o/r.git', 'o', 'r'],
    ['GitHub.com/o/r/tree/main', 'o', 'r'],
    ['a-b/c.d_e-f', 'a-b', 'c.d_e-f'],
    ['corestate55/gh-file-grass', 'corestate55', 'gh-file-grass'],
    [`${'a'.repeat(39)}/r`, 'a'.repeat(39), 'r'],
    [`o/${'r'.repeat(100)}`, 'o', 'r'.repeat(100)],
    ['o/.github', 'o', '.github'],
    ['o/r.git.git', 'o', 'r.git'], // only one ".git" is removed
  ])('%s', (input, owner, repo) => {
    expect(parseRepoInput(input)).toEqual({ owner, repo })
  })
})

describe('parseRepoInput: rejected', () => {
  const reason = (input: string) => {
    try {
      parseRepoInput(input)
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidInputError)
      expect((e as InvalidInputError).input).toBe(input)
      return (e as InvalidInputError).reason
    }
    return 'accepted'
  }

  test.each([
    ['', 'empty'],
    ['   ', 'empty'],
    // only https is supported (no http, no ssh, no scp-like)
    ['http://github.com/o/r', 'unsupported_scheme'],
    ['ssh://git@github.com/o/r.git', 'unsupported_scheme'],
    ['git@github.com:o/r.git', 'unsupported_scheme'],
    ['git@github.com:o/r', 'unsupported_scheme'],
    ['ftp://github.com/o/r', 'unsupported_scheme'],
    ['git://github.com/o/r.git', 'unsupported_scheme'],
    // other hosts
    ['https://gitlab.com/o/r', 'unsupported_host'],
    ['gitlab.com/o/r', 'unsupported_host'],
    ['https://gist.github.com/o/r', 'unsupported_host'],
    ['https://api.github.com/repos/o/r', 'unsupported_host'],
    ['https://raw.githubusercontent.com/o/r/main/x', 'unsupported_host'],
    ['https://github.example.com/o/r', 'unsupported_host'],
    // URL details
    ['https://github.com:8443/o/r', 'invalid_format'],
    ['https://user@github.com/o/r', 'invalid_format'],
    ['https://user:pw@github.com/o/r', 'invalid_format'],
    // shape
    ['owner', 'invalid_format'],
    ['github.com', 'invalid_format'],
    ['https://github.com', 'invalid_format'],
    ['https://github.com/owner', 'invalid_format'],
    ['https://github.com/', 'invalid_format'],
    ['o/r/x', 'invalid_format'], // bare form is exactly 2 segments
    ['o/r/tree/main', 'invalid_format'],
    ['/o/r', 'invalid_format'],
    // owner
    ['_o/r', 'invalid_owner'],
    [`${'a'.repeat(40)}/r`, 'invalid_owner'],
    ['o%20x/r', 'invalid_owner'],
    ['o w/r', 'invalid_owner'],
    // repo
    ['o/..', 'invalid_repo'],
    ['o/.', 'invalid_repo'],
    ['o/.git', 'invalid_repo'],
    ['o/r%20x', 'invalid_repo'],
    ['o/r x', 'invalid_repo'],
    ['o/r?x', 'invalid_repo'],
    [`o/${'r'.repeat(101)}`, 'invalid_repo'],
  ])('%j -> %s', (input, expected) => {
    expect(reason(input)).toBe(expected)
  })

  test('path traversal in a URL never yields an owner/repo', () => {
    expect(['accepted', 'invalid_format', 'invalid_repo', 'invalid_owner']).toContain(
      reason('https://github.com/o/../r'),
    )
    expect(parseRepoInput('https://github.com/o/../r/x').repo).not.toBe('..')
  })
})
