import { describe, expect, test } from 'vitest'
import { formatRenamePath } from '../src/rename'
import { loadLogsJson } from './helpers/fixtures'

describe('formatRenamePath', () => {
  test('reproduces every renamed stat_path.path of the Ruby output (3 forms)', () => {
    const renamed = loadLogsJson().stats.filter((s) => s.stat_path.src !== s.stat_path.dst)
    expect(renamed.map((s) => s.stat_path.path)).toEqual([
      '{bin => lib}/git_show_parser.rb',
      'bin/{log_corrector.rb => log_collector.rb}',
      'log_corrector.rb => bin/log_corrector.rb',
    ])
    for (const s of renamed) {
      expect(formatRenamePath(s.stat_path.src, s.stat_path.dst)).toBe(s.stat_path.path)
    }
  })

  // 期待値は実際の git(`git diff --numstat -M`)の出力から採った。
  test.each([
    ['a/b/c.txt', 'a/c.txt', 'a/{b => }/c.txt'],
    ['a/c.txt', 'a/b/c.txt', 'a/{ => b}/c.txt'],
    ['a/b/c', 'a/b/c/d', 'a/b/{c => c/d}'],
    ['a/b/c/d', 'a/b/c', 'a/b/{c/d => c}'],
    ['x.rb', 'y.rb', 'x.rb => y.rb'],
    ['a/x.rb', 'b/x.rb', '{a => b}/x.rb'],
    ['a/b/x.rb', 'a/c/x.rb', 'a/{b => c}/x.rb'],
    ['a/b/x.rb', 'a/b/y.rb', 'a/b/{x.rb => y.rb}'],
    ['foo/bar.txt', 'foobar/bar.txt', '{foo => foobar}/bar.txt'],
    ['abc/def', 'abc/xyz/def', 'abc/{ => xyz}/def'],
    ['a/a', 'a/a/a', 'a/{ => a}/a'],
    ['a/a/a', 'a/a', 'a/{a => }/a'],
    ['x/y', 'x/y/y', 'x/{ => y}/y'],
    ['ab/c', 'abx/c', '{ab => abx}/c'],
  ])('%s -> %s', (from, to, expected) => {
    expect(formatRenamePath(from, to)).toBe(expected)
  })
})
