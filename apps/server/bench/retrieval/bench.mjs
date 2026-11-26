#!/usr/bin/env node
// Retrieval benchmark for mixed Japanese/English team content. See README.md.
// Subcommands:
//   embed <key> [--runs]   embed corpus+queries with one local model, write cache/<key>.json (own process => clean RSS)
//   kw                     keyword methods (ILIKE, pg_trgm, pg_bigm, PGroonga, simple FTS) recall@5 / MRR
//   vec                    vector-only per cached model, then hybrid (RRF) per cached model
//   chunk <key>            chunk-size experiment on the corpus re-assembled into Markdown docs
//   all <key...>           kw + vec for the given cached models
// Env: BENCH_DEPS (dir with node_modules containing pg + @huggingface/transformers; default cwd),
//      DATABASE_URL (default postgres://postgres@/r4?host=/var/run/postgresql), BENCH_CACHE (default ./.cache next to this file's cwd)
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const deps = path.resolve(process.env.BENCH_DEPS || process.cwd())
const req = createRequire(path.join(deps, 'noop.js'))
const CACHE = path.resolve(process.env.BENCH_CACHE || path.join(process.cwd(), '.bench-cache'))
fs.mkdirSync(CACHE, { recursive: true })
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'corpus.json'), 'utf8'))
const queries = JSON.parse(fs.readFileSync(path.join(here, 'queries.json'), 'utf8'))
const DB = process.env.DATABASE_URL || 'postgres://postgres@/r4?host=/var/run/postgresql'

// ---- model registry: id, dtype, prefixes, pooling (null => use model's own sentence_embedding output)
export const MODELS = {
  'e5-small': {
    id: 'Xenova/multilingual-e5-small',
    dtype: 'q8',
    q: 'query: ',
    d: 'passage: ',
    pool: 'mean',
    license: 'MIT',
  },
  'e5-small-fp32': {
    id: 'Xenova/multilingual-e5-small',
    dtype: 'fp32',
    q: 'query: ',
    d: 'passage: ',
    pool: 'mean',
    license: 'MIT',
  },
  'e5-base': {
    id: 'Xenova/multilingual-e5-base',
    dtype: 'q8',
    q: 'query: ',
    d: 'passage: ',
    pool: 'mean',
    license: 'MIT',
  },
  'bge-m3': {
    id: 'onnx-community/bge-m3-ONNX',
    dtype: 'q8',
    q: '',
    d: '',
    pool: 'cls',
    license: 'MIT',
  },
  'ruri-30m': {
    id: 'sirasagi62/ruri-v3-30m-ONNX',
    dtype: 'q8',
    q: '検索クエリ: ',
    d: '検索文書: ',
    pool: 'mean',
    license: 'Apache-2.0',
  },
  'ruri-30m-fp32': {
    id: 'sirasagi62/ruri-v3-30m-ONNX',
    dtype: 'fp32',
    q: '検索クエリ: ',
    d: '検索文書: ',
    pool: 'mean',
    license: 'Apache-2.0',
  },
  'ruri-70m': {
    id: 'mochiya98/ruri-v3-70m-onnx',
    dtype: 'q8',
    q: '検索クエリ: ',
    d: '検索文書: ',
    pool: 'mean',
    license: 'Apache-2.0',
  },
  'ruri-130m': {
    id: 'sirasagi62/ruri-v3-130m-ONNX',
    dtype: 'q8',
    q: '検索クエリ: ',
    d: '検索文書: ',
    pool: 'mean',
    license: 'Apache-2.0',
  },
  'minilm-l12': {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    dtype: 'q8',
    q: '',
    d: '',
    pool: 'mean',
    license: 'Apache-2.0',
  },
  'gemma-300m': {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    dtype: 'q8',
    q: 'task: search result | query: ',
    d: 'title: none | text: ',
    pool: null,
    license: 'Gemma terms',
  },
  'granite-97m': {
    id: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
    dtype: 'q8',
    q: '',
    d: '',
    pool: 'cls',
    license: 'Apache-2.0',
  },
}

const dirSize = (p) => {
  let n = 0
  if (!fs.existsSync(p)) return 0
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name)
    n += e.isDirectory() ? dirSize(f) : fs.statSync(f).size
  }
  return n
}

async function embedCmd(key) {
  const spec = MODELS[key]
  if (!spec) throw new Error('unknown model ' + key)
  const tf = await import(pathToFileURL(req.resolve('@huggingface/transformers')).href)
  const { AutoTokenizer, AutoModel, env } = tf
  env.cacheDir = path.join(CACHE, 'models')
  const t0 = performance.now()
  const tok = await AutoTokenizer.from_pretrained(spec.id)
  const model = await AutoModel.from_pretrained(spec.id, { dtype: spec.dtype, device: 'cpu' })
  const loadMs = performance.now() - t0
  const run = async (texts) => {
    const inputs = await tok(texts, { padding: true, truncation: true, max_length: 512 })
    const out = await model(inputs)
    let t = out.sentence_embedding
    if (!t) {
      const h = out.last_hidden_state || out.token_embeddings
      const [B, L, D] = h.dims
      const data = h.data
      const mask = inputs.attention_mask.data
      const res = new Float32Array(B * D)
      for (let b = 0; b < B; b++) {
        if (spec.pool === 'cls') {
          for (let d = 0; d < D; d++) res[b * D + d] = data[b * L * D + d]
        } else {
          let n = 0
          for (let l = 0; l < L; l++) {
            if (Number(mask[b * L + l]) === 0) continue
            n++
            for (let d = 0; d < D; d++) res[b * D + d] += data[(b * L + l) * D + d]
          }
          for (let d = 0; d < D; d++) res[b * D + d] /= n
        }
      }
      t = { data: res, dims: [B, D] }
    }
    const [B, D] = t.dims
    const rows = []
    for (let b = 0; b < B; b++) {
      const v = Array.from(t.data.slice(b * D, (b + 1) * D))
      const n = Math.hypot(...v)
      rows.push(v.map((x) => x / n))
    }
    return rows
  }
  const batched = async (texts, bs) => {
    const o = []
    for (let i = 0; i < texts.length; i += bs) o.push(...(await run(texts.slice(i, i + bs))))
    return o
  }
  const docTexts = corpus.map((c) => spec.d + c.text)
  const t1 = performance.now()
  const first = await run([docTexts[0]])
  const firstMs = performance.now() - t1
  const docs = await batched(docTexts, 8)
  const qs = await batched(
    queries.map((q) => spec.q + q.query),
    8,
  )
  // throughput: 160 windows of 300 characters cut from the concatenated corpus, batch 8, after warmup
  const all = [...corpus.map((c) => c.text).join('')]
  const big = Array.from(
    { length: 160 },
    (_, i) =>
      spec.d +
      all.slice((i * 211) % (all.length - 300), ((i * 211) % (all.length - 300)) + 300).join(''),
  )
  await batched(big.slice(0, 8), 8)
  const t2 = performance.now()
  await batched(big, 8)
  const sec = (performance.now() - t2) / 1000
  const avgChars = corpus.reduce((s, c) => s + c.text.length, 0) / corpus.length
  let tokSum = 0
  for (const t of docTexts) tokSum += (await tok(t, { truncation: false })).input_ids.dims[1]
  const stats = {
    key,
    id: spec.id,
    dtype: spec.dtype,
    dim: docs[0].length,
    license: spec.license,
    prefixQuery: spec.q,
    prefixDoc: spec.d,
    downloadedMB: +(dirSize(path.join(env.cacheDir, spec.id)) / 1e6).toFixed(0),
    loadSec: +(loadMs / 1000).toFixed(2),
    firstInferenceMs: +firstMs.toFixed(0),
    passagesPerSec: +(big.length / sec).toFixed(1),
    throughputChunkChars: 300,
    avgChars: Math.round(avgChars),
    avgTokens: Math.round(tokSum / docTexts.length),
    peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
  }
  fs.writeFileSync(path.join(CACHE, key + '.json'), JSON.stringify({ stats, docs, queries: qs }))
  console.log(JSON.stringify(stats))
}

// ---- metrics
const metrics = (ranked) => {
  // ranked: {qid: [docid...]}
  let r5 = 0,
    mrr = 0
  for (const q of queries) {
    const list = ranked[q.id] || []
    const rel = new Set(q.relevant)
    const top5 = list.slice(0, 5)
    r5 += top5.some((d) => rel.has(d)) ? 1 : 0 // hit@5 (== recall@5 when there is 1 relevant doc; "any relevant in top5" otherwise)
    const i = list.findIndex((d) => rel.has(d))
    mrr += i >= 0 ? 1 / (i + 1) : 0
  }
  return { 'recall@5': +(r5 / queries.length).toFixed(3), MRR: +(mrr / queries.length).toFixed(3) }
}
const byKind = (ranked) => {
  const out = {}
  for (const kind of [...new Set(queries.map((q) => q.kind))]) {
    const sub = queries.filter((q) => q.kind === kind)
    let h = 0
    for (const q of sub) {
      if ((ranked[q.id] || []).slice(0, 5).some((d) => q.relevant.includes(d))) h++
    }
    out[kind] = `${h}/${sub.length}`
  }
  return out
}

async function pgConnect() {
  const { Client } = req('pg')
  const c = new Client({ connectionString: DB })
  await c.connect()
  return c
}
const terms = (q) => q.trim().split(/\s+/).filter(Boolean)
const lit = (v) => '[' + v.join(',') + ']'

async function setupKeyword(c) {
  await c.query(
    'create extension if not exists pg_trgm; create extension if not exists pg_bigm; create extension if not exists pgroonga;',
  )
  await c.query(
    'drop table if exists kw_chunks; create table kw_chunks (id text primary key, space_id int not null, body text not null)',
  )
  for (const p of corpus)
    await c.query('insert into kw_chunks values ($1,$2,$3)', [p.id, 1, p.title + '\n' + p.text])
  await c.query(`create index kw_trgm on kw_chunks using gin (body gin_trgm_ops);
                 create index kw_bigm on kw_chunks using gin (body gin_bigm_ops);
                 create index kw_groonga on kw_chunks using pgroonga (body);
                 analyze kw_chunks;`)
}

// each method: (client, query) -> ordered ids. Queries are whitespace-split into terms where the operator needs it.
const KW = {
  'fts_simple (default FTS)': async (c, q) =>
    (
      await c.query(
        `select id from kw_chunks where to_tsvector('simple', body) @@ websearch_to_tsquery('simple', $1) order by ts_rank(to_tsvector('simple', body), websearch_to_tsquery('simple', $1)) desc limit 20`,
        [q],
      )
    ).rows.map((r) => r.id),
  'ilike (any term, count of terms)': async (c, q) => {
    const t = terms(q)
    const score = t.map((_, i) => `(body ilike $${i + 1})::int`).join('+')
    const where = t.map((_, i) => `body ilike $${i + 1}`).join(' or ')
    return (
      await c.query(
        `select id from kw_chunks where ${where} order by (${score}) desc, id limit 20`,
        t.map((x) => `%${x}%`),
      )
    ).rows.map((r) => r.id)
  },
  'pg_trgm word_similarity': async (c, q) =>
    (
      await c.query(
        `select id from kw_chunks where word_similarity($1, body) > 0 order by word_similarity($1, body) desc limit 20`,
        [q],
      )
    ).rows.map((r) => r.id),
  'pg_trgm similarity': async (c, q) =>
    (
      await c.query(
        `select id from kw_chunks where similarity(body, $1) > 0 order by similarity(body, $1) desc limit 20`,
        [q],
      )
    ).rows.map((r) => r.id),
  'pg_bigm LIKE (any term, count)': async (c, q) => {
    const t = terms(q)
    const lk = t.map((_, i) => `likequery($${i + 1})`)
    const score = lk.map((l) => `(body like ${l})::int`).join('+')
    const where = lk.map((l) => `body like ${l}`).join(' or ')
    return (
      await c.query(
        `select id from kw_chunks where ${where} order by (${score}) desc, id limit 20`,
        t,
      )
    ).rows.map((r) => r.id)
  },
  'pg_bigm bigm_similarity': async (c, q) =>
    (
      await c.query(
        `select id from kw_chunks where bigm_similarity($1, body) > 0 order by bigm_similarity($1, body) desc limit 20`,
        [q],
      )
    ).rows.map((r) => r.id),
  'pgroonga &@~ (OR terms)': async (c, q) =>
    (
      await c.query(
        `select id from kw_chunks where body &@~ $1 order by pgroonga_score(tableoid, ctid) desc limit 20`,
        [terms(q).join(' OR ')],
      )
    ).rows.map((r) => r.id),
  'pgroonga &@* (similar)': async (c, q) =>
    (
      await c.query(
        `select id from kw_chunks where body &@* $1 order by pgroonga_score(tableoid, ctid) desc limit 20`,
        [q],
      )
    ).rows.map((r) => r.id),
}

async function kwCmd() {
  const c = await pgConnect()
  await setupKeyword(c)
  await c.query('set enable_seqscan=off') // 40 rows: force the index path so we measure index semantics (bigm/groonga operators work either way)
  const rows = []
  for (const [name, fn] of Object.entries(KW)) {
    const ranked = {}
    let err = null
    for (const q of queries) {
      try {
        ranked[q.id] = await fn(c, q.query)
      } catch (e) {
        err = e.message
        ranked[q.id] = []
        await c.query('rollback').catch(() => {})
      }
    }
    rows.push({ method: name, ...metrics(ranked), ...byKind(ranked), err })
  }
  console.table(rows)
  await c.end()
  return rows
}

const loadCache = (key) => JSON.parse(fs.readFileSync(path.join(CACHE, key + '.json'), 'utf8'))

async function setupVec(c, key, dim) {
  const m = loadCache(key)
  await c.query(
    `create extension if not exists vector; drop table if exists vec_chunks; create table vec_chunks (id text primary key, space_id int not null, body text not null, embedding vector(${dim}) not null)`,
  )
  // space 1 holds the real corpus, spaces 2..9 hold shifted copies so that the space_id filter is selective (8 foreign spaces)
  corpus.forEach(async () => {})
  for (let i = 0; i < corpus.length; i++)
    await c.query('insert into vec_chunks values ($1,1,$2,$3)', [
      corpus[i].id,
      corpus[i].title + '\n' + corpus[i].text,
      lit(m.docs[i]),
    ])
  await c.query(
    'create index vec_hnsw on vec_chunks using hnsw (embedding vector_cosine_ops) with (m=16, ef_construction=64); create index vec_space on vec_chunks (space_id); analyze vec_chunks',
  )
  return m
}

async function vecCmd(keys) {
  const kwc = await pgConnect()
  await setupKeyword(kwc)
  const out = []
  for (const key of keys) {
    const m = loadCache(key)
    const dim = m.stats.dim
    const c = await pgConnect()
    await setupVec(c, key, dim)
    // join keyword body table to vec table through id; one statement per query
    const run = async (mode, qi) => {
      const q = queries[qi]
      const qv = lit(m.queries[qi])
      const t = terms(q.query)
      if (mode === 'vector')
        return (
          await c.query(
            `select id from vec_chunks where space_id=1 order by embedding <=> $1::vector limit 20`,
            [qv],
          )
        ).rows.map((r) => r.id)
      if (mode === 'bigm')
        return (
          await c.query(
            `select id from kw_chunks where space_id=1 and bigm_similarity($1, body) > 0 order by bigm_similarity($1, body) desc limit 20`,
            [q.query],
          )
        ).rows.map((r) => r.id)
      if (mode === 'hybrid_bigm' || mode === 'hybrid_groonga') {
        const kwExpr =
          mode === 'hybrid_bigm'
            ? `select id, row_number() over (order by bigm_similarity($2, body) desc) as r from kw_chunks where space_id=$3 and bigm_similarity($2, body) > 0 order by bigm_similarity($2, body) desc limit 20`
            : `select id, row_number() over (order by pgroonga_score(tableoid, ctid) desc) as r from kw_chunks where space_id=$3 and body &@* $2 order by pgroonga_score(tableoid, ctid) desc limit 20`
        return (
          await c.query(
            `with v as (select id, row_number() over (order by embedding <=> $1::vector) as r from vec_chunks where space_id=$3 order by embedding <=> $1::vector limit 20),
          k as (${kwExpr}),
          fused as (select coalesce(v.id,k.id) as id, coalesce(1.0/(60+v.r),0)+coalesce(1.0/(60+k.r),0) as score from v full outer join k on v.id=k.id)
          select id from fused order by score desc limit 20`,
            [qv, q.query, 1],
          )
        ).rows.map((r) => r.id)
      }
    }
    for (const mode of ['vector', 'hybrid_bigm', 'hybrid_groonga']) {
      const ranked = {}
      for (let i = 0; i < queries.length; i++) ranked[queries[i].id] = await run(mode, i)
      out.push({ model: key, dim, mode, ...metrics(ranked), ...byKind(ranked) })
    }
    await c.end()
  }
  console.table(out)
  await kwc.end()
}

// ---- chunk experiment: rebuild 4 Markdown docs (one per topic), chunk with different strategies, embed with a model, score at passage level
async function chunkCmd(key) {
  const spec = MODELS[key]
  const tf = await import(pathToFileURL(req.resolve('@huggingface/transformers')).href)
  const { AutoTokenizer, AutoModel, env } = tf
  env.cacheDir = path.join(CACHE, 'models')
  const tok = await AutoTokenizer.from_pretrained(spec.id)
  const model = await AutoModel.from_pretrained(spec.id, { dtype: spec.dtype, device: 'cpu' })
  const embed = async (texts) => {
    const o = []
    for (let i = 0; i < texts.length; i += 8) {
      const inp = await tok(texts.slice(i, i + 8), {
        padding: true,
        truncation: true,
        max_length: 512,
      })
      const out = await model(inp)
      const h = out.last_hidden_state
      const [B, L, D] = h.dims
      const mask = inp.attention_mask.data
      for (let b = 0; b < B; b++) {
        const v = new Float64Array(D)
        let n = 0
        for (let l = 0; l < L; l++) {
          if (Number(mask[b * L + l]) === 0) continue
          n++
          for (let d = 0; d < D; d++) v[d] += h.data[(b * L + l) * D + d]
        }
        const nn = Math.hypot(...v)
        o.push(Array.from(v, (x) => x / nn))
      }
    }
    return o
  }
  // docs: one per topic; sections = passages; a section is "## title\n\ntext". Sentences split on 。
  const topics = [...new Set(corpus.map((c) => c.topic))]
  const docs = topics.map((t) => ({ topic: t, sections: corpus.filter((c) => c.topic === t) }))
  const split = (text) => text.split(/(?<=[。！？\n])/).filter((s) => s.trim())
  const strategies = {
    'per-section, no heading prefix': (s) => [{ pid: s.id, text: s.text }],
    'per-section + heading path': (s, d) => [
      { pid: s.id, text: `${d.topic} > ${s.title}\n${s.text}` },
    ],
    'fixed 120ch + path': (s, d) => fixed(s, d, 120, 0),
    'fixed 120ch ovl20 + path': (s, d) => fixed(s, d, 120, 20),
    'fixed 200ch + path': (s, d) => fixed(s, d, 200, 0),
    'sentence-pack 200ch + path': (s, d) => pack(s, d, 200),
    'merge 2 sections (~600ch) + path': null,
  }
  function fixed(s, d, n, ov) {
    const out = []
    const t = [...s.text]
    for (let i = 0; i < t.length; i += n - ov) {
      out.push({ pid: s.id, text: `${d.topic} > ${s.title}\n${t.slice(i, i + n).join('')}` })
      if (i + n >= t.length) break
    }
    return out
  }
  function pack(s, d, n) {
    const out = []
    let cur = ''
    for (const se of split(s.text)) {
      if ([...cur].length + [...se].length > n && cur) {
        out.push(cur)
        cur = ''
      }
      cur += se
    }
    if (cur) out.push(cur)
    return out.map((x) => ({ pid: s.id, text: `${d.topic} > ${s.title}\n${x}` }))
  }
  const qv = await embed(queries.map((q) => spec.q + q.query))
  const res = []
  for (const [name, f] of Object.entries(strategies)) {
    const chunks = []
    if (f) for (const d of docs) for (const s of d.sections) chunks.push(...f(s, d))
    else
      for (const d of docs)
        for (let i = 0; i < d.sections.length; i += 2) {
          const ss = d.sections.slice(i, i + 2)
          chunks.push({
            pid: ss[0].id,
            pids: ss.map((x) => x.id),
            text:
              `${d.topic} > ${ss.map((x) => x.title).join(' / ')}\n` +
              ss.map((x) => x.text).join('\n'),
          })
        }
    const cv = await embed(chunks.map((c) => spec.d + c.text))
    const ranked = {}
    queries.forEach((q, qi) => {
      const sc = chunks
        .map((c, i) => ({ c, s: cv[i].reduce((a, x, k) => a + x * qv[qi][k], 0) }))
        .sort((a, b) => b.s - a.s)
      const seen = []
      for (const { c } of sc) for (const p of c.pids || [c.pid]) if (!seen.includes(p)) seen.push(p)
      ranked[q.id] = seen
    })
    res.push({
      strategy: name,
      chunks: chunks.length,
      avgChars: Math.round(chunks.reduce((s, c) => s + [...c.text].length, 0) / chunks.length),
      ...metrics(ranked),
    })
  }
  console.table(res)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'embed') await embedCmd(rest[0])
else if (cmd === 'kw') await kwCmd()
else if (cmd === 'vec') await vecCmd(rest)
else if (cmd === 'chunk') await chunkCmd(rest[0])
else if (cmd === 'all') {
  await kwCmd()
  await vecCmd(rest)
} else
  console.log(
    'usage: bench.mjs embed <key> | kw | vec <key...> | chunk <key> | all <key...>; keys: ' +
      Object.keys(MODELS).join(', '),
  )
