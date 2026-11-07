/**
 * リネームの短縮表記。git の `pprint_rename`(diff.c)と同じ規則:
 * 共通の先頭(`/` まで含める)と共通の末尾(`/` から)を切り出し、`{旧 => 新}` にする。
 * 共通部が無ければ `旧 => 新`。
 *
 *   formatRenamePath('bin/a.rb', 'lib/a.rb')   // '{bin => lib}/a.rb'
 *   formatRenamePath('a.rb', 'bin/a.rb')       // 'a.rb => bin/a.rb'
 *
 * 再現しない git の挙動: 非 ASCII や特殊文字を含むパスの C クォート。
 */
export function formatRenamePath(oldPath: string, newPath: string): string {
  const a = oldPath
  const b = newPath
  // C の NUL 終端に相当: 範囲外は '\0'
  const ch = (s: string, i: number) => (i < s.length ? s[i] : '\0')

  // 共通の先頭。pfxLength は「最後に一致した '/' の次」まで。
  let pfxLength = 0
  for (let i = 0; i < a.length && i < b.length && a[i] === b[i]; i++) {
    if (a[i] === '/') pfxLength = i + 1
  }

  // 共通の末尾。先頭が共通なら、その末尾の '/' を 1 文字だけ再利用して見る。
  const adjust = pfxLength > 0 ? 1 : 0
  let sfxLength = 0
  let i = a.length
  let j = b.length
  while (pfxLength - adjust <= i && pfxLength - adjust <= j && ch(a, i) === ch(b, j)) {
    if (ch(a, i) === '/') sfxLength = a.length - i
    i--
    j--
  }

  const aMid = a.slice(pfxLength, Math.max(pfxLength, a.length - sfxLength))
  const bMid = b.slice(pfxLength, Math.max(pfxLength, b.length - sfxLength))
  if (pfxLength + sfxLength === 0) return `${aMid} => ${bMid}`
  return `${a.slice(0, pfxLength)}{${aMid} => ${bMid}}${a.slice(a.length - sfxLength)}`
}
