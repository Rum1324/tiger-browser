import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  chunkEmbedText,
  chunkMarkdown,
  E5Embedder,
  EMBEDDING_DIMENSIONS,
} from '../../src/retrieval'
import { spaceWithMembers } from '../helpers/fixtures'
import type { Harness } from '../helpers/harness'
import { MODEL_CACHE_DIR, share, startRetrievalHarness } from './helpers'

// These tests load multilingual-e5-small (about 135 MB, downloaded once into MODEL_CACHE_DIR).
const embedder = new E5Embedder({ cacheDir: MODEL_CACHE_DIR })
const signal = new AbortController().signal
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0)

describe('E5Embedder', () => {
  it('returns unit-length 384-dimension vectors, batched, with different query and passage vectors', async () => {
    const texts = Array.from(
      { length: 20 },
      (_, i) => `文書${i}: 資金調達について。 Document ${i}.`,
    )
    const passages = await embedder.embedPassages(texts)
    expect(passages).toHaveLength(20)
    for (const v of passages) {
      expect(v).toHaveLength(EMBEDDING_DIMENSIONS)
      expect(Math.sqrt(dot(v, v))).toBeCloseTo(1, 3)
    }
    const [asQuery] = await embedder.embedQueries([texts[0] as string])
    expect(dot(asQuery as Float32Array, passages[0] as Float32Array)).toBeLessThan(0.9999)
    // Same text twice gives the same vector (the model is loaded once and is deterministic).
    const again = await embedder.embedPassages([texts[0] as string])
    // Batch padding changes q8 results slightly, so "the same" means cosine above 0.98.
    expect(dot(again[0] as Float32Array, passages[0] as Float32Array)).toBeGreaterThan(0.98)
  })

  it('stops between batches when the signal aborts', async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(embedder.embedPassages(['a', 'b'], ctl.signal)).rejects.toThrow()
  })

  it('keeps every chunk of a long mixed document within the 512-token window', async () => {
    const { AutoTokenizer } = await import('@huggingface/transformers')
    const tok = await AutoTokenizer.from_pretrained('Xenova/multilingual-e5-small', {
      cache_dir: MODEL_CACHE_DIR,
    })
    const ja =
      '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。'
    const en =
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! How vexingly quick daft zebras jump?'
    const numbers = Array.from(
      { length: 80 },
      (_, i) => `| ${i} | ${i * 7919} | ${(i * 31337) % 1000} |`,
    )
    const code = Array.from({ length: 80 }, (_, i) => `const value_${i} = compute(${i}, 'x${i}');`)
    const md = [
      '# 長い文書',
      '## 日本語',
      ja.repeat(40),
      '## English',
      en.repeat(25),
      '## 表',
      `| a | b | c |\n| --- | --- | --- |\n${numbers.join('\n')}`,
      '## コード',
      `\`\`\`ts\n${code.join('\n')}\n\`\`\``,
      '## 一文',
      'あ'.repeat(2500),
    ].join('\n\n')
    const chunks = chunkMarkdown(md, { title: '長い文書のタイトル' })
    expect(chunks.length).toBeGreaterThan(20)
    for (const c of chunks) {
      const ids = tok.encode(`passage: ${chunkEmbedText('長い文書のタイトル', c)}`)
      expect(ids.length).toBeLessThanOrEqual(512)
    }
  })
})

describe('retrieval with the real model', () => {
  let h: Harness
  let retrieval: Awaited<ReturnType<typeof startRetrievalHarness>>['retrieval']
  let ids: Record<string, string>
  let spaceId: string

  beforeAll(async () => {
    ;({ h, retrieval } = await startRetrievalHarness(embedder))
    const { owner, space } = await spaceWithMembers(h, 'E5')
    spaceId = space.id
    const docs: Record<string, [string, string]> = {
      fundraising: [
        '資金調達メモ',
        '# 資金調達\n\n2026年9月にシリーズAの資金調達を完了した。リード投資家は国内VCで、調達額は総額8億円。調達した資金の約6割はエンジニア採用とプロダクト開発に充てる。',
      ],
      leave: [
        '休暇規程',
        '# 休暇規程\n\n年次有給休暇は入社6か月後に10日付与される。取得は前日までに上司へ申請する。夏季休暇は3日間。',
      ],
      security: [
        'Security checklist',
        '# Security checklist\n\nRotate API keys every 90 days. Enable two-factor authentication for every employee account. Report phishing emails to the security team.',
      ],
      pricing: [
        'Pricing page',
        '# Pricing\n\nThe Team plan costs 12 dollars per seat per month, billed annually. The Enterprise plan includes single sign-on and a dedicated support engineer.',
      ],
      recipe: [
        '料理メモ',
        '# カレーの作り方\n\n玉ねぎを飴色になるまで炒め、鶏肉とスパイスを加えて煮込む。最後にヨーグルトを少し入れるとまろやかになる。',
      ],
      travel: [
        'Tokyo trip',
        '# Tokyo trip\n\nTake the Narita Express from the airport to Shinjuku. Buy a Suica card at the station for trains and convenience stores.',
      ],
    }
    ids = {}
    for (const [key, [title, md]] of Object.entries(docs)) {
      const item = await share(h, owner.token, space.id, `https://example.com/${key}`, title, md)
      ids[key] = item.id
    }
  }, 120_000)
  afterAll(() => h.close())

  const top = async (query: string) =>
    (await retrieval.retriever.search({ spaceId, query, k: 3, signal }))[0]?.itemId

  it('finds the right item for Japanese queries against Japanese text', async () => {
    expect(await top('シリーズAで調達した金額はいくら？')).toBe(ids.fundraising)
    expect(await top('有給は何日もらえる')).toBe(ids.leave)
    expect(await top('鶏肉のカレーを煮込む方法')).toBe(ids.recipe)
  })

  it('finds the right item for English queries against English text', async () => {
    expect(await top('how often should API keys be rotated')).toBe(ids.security)
    expect(await top('how much does the team plan cost per seat')).toBe(ids.pricing)
    expect(await top('how do I get from the airport to Shinjuku')).toBe(ids.travel)
  })

  it('finds English text from a Japanese query as the top hit', async () => {
    expect(await top('二要素認証は必須ですか')).toBe(ids.security)
    expect(await top('チームプランの月額料金')).toBe(ids.pricing)
    expect(await top('チームプランは1席あたりいくらですか')).toBe(ids.pricing)
  })

  it('finds Japanese text from an English query within the top 3 (not always first)', async () => {
    // Measured: e5-small ranks same-language passages above a cross-language one for the same
    // topic, so an English query puts the right Japanese item second, not first. Top-3 is what holds.
    const inTop3 = async (query: string) =>
      (await retrieval.retriever.search({ spaceId, query, k: 3, signal })).map((x) => x.itemId)
    expect(await inTop3('how much money did we raise in the Series A round')).toContain(
      ids.fundraising,
    )
    expect(await inTop3('how many days of paid annual leave do employees get')).toContain(ids.leave)
    expect(await inTop3('how much did we raise in our Series A funding')).toContain(ids.fundraising)
  })
})
