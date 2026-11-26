/**
 * What every extractor returns before `finalizePage` turns it into the `ExtractedPage` contract.
 * The URL, capture time and size accounting are added there, in one place.
 */
export interface Extraction {
  title: string
  markdown: string
  /** BCP 47 tag such as `ja` or `en-US`, or null when it cannot be told. */
  lang: string | null
  byline: string | null
  siteName: string | null
  /** Which extractor produced this, e.g. `readability@0.6`, `slack-dom@1`. */
  extractor: string
  /**
   * True when a work budget (time or size) stopped extraction before the end of the content.
   * `finalizePage` carries it into `ExtractedPage.truncated`.
   */
  truncated?: boolean
}

export interface DomExtractOptions {
  /** Wall-clock budget for the whole extraction, in milliseconds. */
  timeBudgetMs?: number
  /** Stop converting once this many characters of text have been collected. */
  maxChars?: number
}
