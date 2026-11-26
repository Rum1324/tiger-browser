import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
}

/** A jsdom document at `url`, so relative links and computed styles behave as in a browser tab. */
export function loadDocument(html: string, url: string): Document {
  return new JSDOM(html, { url, pretendToBeVisual: true }).window.document
}
