import { describe, expect, it } from 'vitest'
import { isWebUrl, resolveInput, searchUrl } from '../../src/main/resolve-input'

const g = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`

describe('resolveInput', () => {
  it('keeps typed http(s) URLs', () => {
    expect(resolveInput('https://example.com/a?b=1#c', 'google')).toBe('https://example.com/a?b=1#c')
    expect(resolveInput('http://example.com', 'google')).toBe('http://example.com/')
    expect(resolveInput('  HTTPS://Example.COM/Path  ', 'google')).toBe('https://example.com/Path')
  })

  it('adds https to a bare public host and http to local hosts', () => {
    expect(resolveInput('example.com', 'google')).toBe('https://example.com/')
    expect(resolveInput('news.ycombinator.com/item?id=1', 'google')).toBe(
      'https://news.ycombinator.com/item?id=1',
    )
    expect(resolveInput('localhost:3000', 'google')).toBe('http://localhost:3000/')
    expect(resolveInput('localhost', 'google')).toBe('http://localhost/')
    expect(resolveInput('127.0.0.1:8080/x', 'google')).toBe('http://127.0.0.1:8080/x')
    expect(resolveInput('myapp.test', 'google')).toBe('http://myapp.test/')
    expect(resolveInput('printer.local', 'google')).toBe('http://printer.local/')
    expect(resolveInput('example.com:8443/x', 'google')).toBe('https://example.com:8443/x')
  })

  it('handles internationalised hosts', () => {
    expect(resolveInput('xn--wgv71a119e.jp', 'google')).toBe('https://xn--wgv71a119e.jp/')
  })

  it('turns everything else into a search with the chosen engine', () => {
    expect(resolveInput('how to cook rice', 'google')).toBe(g('how to cook rice'))
    expect(resolveInput('東京 天気', 'google')).toBe(g('東京 天気'))
    expect(resolveInput('rice', 'google')).toBe(g('rice'))
    expect(resolveInput('rice', 'duckduckgo')).toBe('https://duckduckgo.com/?q=rice')
    expect(resolveInput('rice', 'bing')).toBe('https://www.bing.com/search?q=rice')
    expect(resolveInput('999.1.1.1', 'google')).toBe(g('999.1.1.1'))
    expect(resolveInput('foo.notatld1', 'google')).toBe(g('foo.notatld1'))
  })

  it('never resolves to a non-web scheme', () => {
    for (const input of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'tiger://ui/index.html',
      'data:text/html,<b>x</b>',
      'chrome://settings',
      'about:blank',
    ]) {
      const out = resolveInput(input, 'google')
      expect(out, input).toBe(g(input))
      expect(isWebUrl(out as string)).toBe(true)
    }
  })

  it('forces a search with a leading "?" and ignores blank input', () => {
    expect(resolveInput('?example.com', 'google')).toBe(g('example.com'))
    expect(resolveInput('?', 'google')).toBeNull()
    expect(resolveInput('   ', 'google')).toBeNull()
  })
})

describe('isWebUrl / searchUrl', () => {
  it('accepts only http and https', () => {
    expect(isWebUrl('https://a.b')).toBe(true)
    expect(isWebUrl('http://a.b')).toBe(true)
    expect(isWebUrl('ftp://a.b')).toBe(false)
    expect(isWebUrl('not a url')).toBe(false)
  })

  it('encodes the query', () => {
    expect(searchUrl('a&b=c', 'google')).toBe('https://www.google.com/search?q=a%26b%3Dc')
  })
})
