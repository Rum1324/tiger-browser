import { basename, extname, join } from 'node:path'

/** A file name that cannot escape the downloads folder and is not empty. */
export function safeFileName(name: string): string {
  const cleaned = basename(name.replace(/\\/g, '/'))
    // Control characters and the characters Windows forbids in file names.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'download'
}

/** "file.txt" → "file (1).txt" until the name is free. */
export function uniquePath(dir: string, name: string, exists: (p: string) => boolean): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let candidate = join(dir, name)
  for (let i = 1; exists(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}
