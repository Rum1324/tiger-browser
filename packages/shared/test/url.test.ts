import { describe, expect, it } from 'vitest'
import { canonicalUrl } from '../src/url'

describe('canonicalUrl', () => {
  it('maps every way of opening one Google Doc to one key', () => {
    const key = 'https://docs.google.com/document/d/1AbC_dEf-123'
    for (const url of [
      'https://docs.google.com/document/d/1AbC_dEf-123/edit',
      'https://docs.google.com/document/d/1AbC_dEf-123/edit?tab=t.0#heading=h.xyz',
      'https://docs.google.com/document/u/1/d/1AbC_dEf-123/view',
      'https://docs.google.com/document/d/1AbC_dEf-123/preview?usp=sharing',
    ]) {
      expect(canonicalUrl(url), url).toBe(key)
    }
    expect(canonicalUrl('https://docs.google.com/spreadsheets/d/9zZ/edit#gid=0')).toBe(
      'https://docs.google.com/spreadsheets/d/9zZ',
    )
  })

  it('drops fragments and tracking parameters, keeps meaningful ones in a stable order', () => {
    expect(
      canonicalUrl('https://Example.com/Report/?utm_source=x&b=2&fbclid=abc&a=1#section-3'),
    ).toBe('https://example.com/Report?a=1&b=2')
  })

  it('keeps different pages different', () => {
    expect(canonicalUrl('https://example.com/a?id=1')).not.toBe(
      canonicalUrl('https://example.com/a?id=2'),
    )
    expect(canonicalUrl('https://example.com/a')).not.toBe(canonicalUrl('https://example.com/A'))
    expect(canonicalUrl('http://example.com:8080/a')).toBe('http://example.com:8080/a')
  })

  it('returns non-web input unchanged instead of throwing', () => {
    expect(canonicalUrl('about:blank')).toBe('about:blank')
    expect(canonicalUrl('  not a url ')).toBe('not a url')
  })
})
