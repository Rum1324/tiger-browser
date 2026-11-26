# Research: retrieval-jp

Researched 2026-11-26 by a background agent. Status labels: verified (ran it), documented (URL), inferred, unknown.

## Summary

1) [verified] Docker daemon starts here (dockerd 29.9.3) but the first `docker pull` got a 429 and containers/builds need the proxy CA and --network host. Later the pull and a build worked, and a Dockerfile image with pgvector 0.8.7 + pg_trgm + pg_bigm + PGroonga 4.1.0 ran and loaded all four extensions.
2) [verified] On local PG16.15: pgvector 0.8.7 (built from source; apt only has 0.6.0), pg_bigm 1.2 (v1.2-20261118, source), PGroonga 4.1.0 (Groonga apt repo) and pg_trgm 1.6 all install and work. Keyword-only results on my 40-passage corpus: pg_bigm bigm_similarity is best (recall@5 0.85, MRR 0.70), pg_trgm 0.80 / 0.75, PGroonga &@* 0.70 / 0.70, ILIKE 0.65 / 0.54, default FTS (simple) 0.05 / 0.05. Only vector search handles English queries against JP passages.
3) [verified] Embeddings (q8, 4 CPUs): bge-m3, embeddinggemma-300m, ruri-130m, e5-small, e5-base and granite-97m reach recall@5 of 1.0 on this corpus, so it cannot separate them. MRR: bge-m3 1.00, gemma 1.00, granite-97m 0.975, e5-small 0.95, e5-base 0.938, ruri-130m 0.912, ruri-30m 0.899, MiniLM 0.554 (MiniLM is clearly worse).
4) [verified] Recommended default: multilingual-e5-small q8 (MIT, 384d, 135 MB, 65 passages/s at 300 characters, 656 MB RSS). Upgrade candidate: granite-embedding-97m-multilingual-r2 (Apache-2.0, 384d, no prefixes, MRR 0.975, but 28 passages/s). bge-m3 and embeddinggemma-300m are too heavy for a local client (12 and 6.5 passages/s, 1.4-1.7 GB RSS).
5) [verified] Hybrid RRF in one SQL statement with a space_id filter works, but it did NOT beat vector-only on this corpus. Hybrid with PGroonga matched vector recall@5 and lowered MRR by about 0.05 to 0.10. Hybrid with pg_bigm similarity hurt English queries because its keyword leg returns noise. Gate or down-weight the keyword leg; this is untested. The corpus is saturated, so treat this as a failure check, not a ranking.
6) [verified] pgvector HNSW with a selective WHERE filter returned 0 rows without `hnsw.iterative_scan` and 10 rows with `relaxed_order` (30k vectors, filter hit 1% of rows). Require pgvector >= 0.8.0 and set it. For a tiny Space the planner picked an exact scan on its own, which is correct.
7) [verified] Chunking on the corpus: prefixing each chunk with `topic > title` raised MRR from 0.95 to 1.0, sentence-packing at about 200 characters was as good (1.0), and merging two sections into about 420 characters dropped MRR to 0.657. The corpus has no long sections, so the best chunk size for long documents is not tested.
8) [documented] Managed Postgres: RDS lists pgvector 0.8.2, pg_bigm 1.2-20250903 and pg_trgm 1.6, with no PGroonga or pg_search. Cloud SQL has pgvector 0.8.5, pg_bigm (flag `cloudsql.enable_pg_bigm`) and pg_trgm. Neon has pgvector 0.8.7 and pg_trgm only; pg_search is "Unavailable". Supabase offers PGroonga (docs page exists); I could not confirm pg_bigm there. I did not check Tokyo-region availability per region. ParadeDB pg_search is AGPL-3.0 (commercial licence for Enterprise), with Lindera/IPADIC Japanese tokenisation, and is not on RDS, Cloud SQL or Neon.
9) [documented] Prompt caching on the Claude API: 5-minute cache write 1.25x, 1-hour write 2x, read 0.1x of base input (0.05x for Opus 5.5 and Sonnet 5.5, 0.025x for the Fable and Mythos models). Minimum cacheable prefix is 512 tokens on Sonnet 5.5. Whole-Space injection beats retrieval once the Space is smaller than K/r tokens, where K is the retrieval context size and r the read multiplier. Examples: K=4k tokens gives 80k tokens at r=0.05 and 40k at r=0.1. This holds only if the Space is requested at least every 5 minutes and its content is unchanged. The Claude tokens-per-Japanese-character ratio is not measured.

## Decisions

### Postgres extensions to ship

- **Recommendation** [verified]: Use pgvector >= 0.8 plus ONE Japanese keyword extension. Prefer pg_bigm if production is RDS or Cloud SQL, PGroonga if Supabase or self-hosted Docker. Keep pg_trgm as a fallback; it works for Japanese in a UTF-8 database with a non-ASCII-capable locale (verified with C.UTF-8). Do not use default FTS for Japanese.
- **Evidence**: Installed and queried locally: vector 0.8.7, pg_bigm 1.2, pgroonga 4.1.0, pg_trgm 1.6. Keyword recall@5 / MRR: bigm_similarity 0.85 / 0.70, pg_trgm similarity 0.80 / 0.75, PGroonga &@* 0.70 / 0.70, ILIKE 0.65 / 0.54, simple FTS 0.05 / 0.05. Availability: RDS lists pg_bigm, not PGroonga; Cloud SQL lists pg_bigm; Neon lists neither; Supabase offers PGroonga. A Docker image with all four extensions was built and run.
- **Cost**: Two keyword extensions cannot both be available on one managed service, so the SQL has to switch per target. pg_bigm needs a LIKE or similarity operator and 1-character queries are slow. PGroonga is not on RDS, Cloud SQL or Neon.

### ParadeDB pg_search

- **Recommendation** [documented]: Do not adopt it for now.
- **Evidence**: The paradedb repo LICENSE is AGPL-3.0, and the README says Enterprise is commercially licensed. Japanese uses a Lindera/IPADIC tokenizer. It is not listed on RDS PG16/17 and is marked Unavailable on Neon. I did not install it: GitHub release downloads were blocked here and it needs a Rust/pgrx build.
- **Cost**: Not benchmarked, so its Japanese quality is unknown.

### Default local embedding model

- **Recommendation** [verified]: Default to Xenova/multilingual-e5-small with dtype q8 and prefixes `query: ` and `passage: `. Offer granite-embedding-97m-multilingual-r2 as an opt-in upgrade.
- **Evidence**: See the model table in details. e5-small recall@5 1.0, MRR 0.95, 65 passages/s at 300 characters, 135 MB download, 656 MB peak RSS, load 2.7 s, MIT licence. Granite-97m has MRR 0.975, 28 passages/s, 123 MB, and needs no prefixes.
- **Cost**: A 40-passage corpus saturates; differences between top models are within noise, so re-check on real Space data. q8 quantisation was used for all models and only ruri-30m and e5-small were also prepared in fp32 (not run). 656 MB RSS in the Electron main process may be too much; consider running embeddings in the server or a utility process.

### Models to avoid as the default

- **Recommendation** [verified]: Do not use paraphrase-multilingual-MiniLM-L12-v2. Do not use bge-m3 or embeddinggemma-300m on client machines.
- **Evidence**: MiniLM recall@5 0.75, MRR 0.554 (it lacks query and passage training, e.g. 'kanji-2char' queries 2/4). bge-m3 q8: 586 MB download, 12.1 passages/s, 1438 MB RSS. gemma-300m q8: 331 MB, 6.5 passages/s, 1680 MB RSS, Gemma licence terms.
- **Cost**: bge-m3 and gemma gave MRR 1.0 on this corpus, so they are quality leaders if the work moves to a server GPU or a larger CPU box.

### ruri-v3 ONNX

- **Recommendation** [verified]: Use ruri-v3 only if Japanese-only quality is the priority; it does not beat e5-small here.
- **Evidence**: cl-nagoya/ruri-v3-* repos have no ONNX files. Community ONNX conversions load: sirasagi62/ruri-v3-30m-ONNX and sirasagi62/ruri-v3-130m-ONNX, mochiya98/ruri-v3-70m-onnx. onnx-community/ruri-v3-30m-ONNX lacks tokenizer files and fails to load. Prefixes `検索クエリ: ` and `検索文書: `. Results: 30m MRR 0.899 and 105 passages/s, 70m 0.896 and 62/s, 130m 0.912 and 31/s.
- **Cost**: The ONNX repos are third-party conversions, not the authors' official files. 30m has a 256-dim vector and one English-query miss in 4.

### Hybrid retrieval

- **Recommendation** [verified]: Ship vector-first. Add the keyword leg as an opt-in or gated leg (for example, only when the query has a quoted term, an exact alphanumeric token or a rare kanji term), with weighted RRF. Keep the single-statement SQL below as the skeleton.
- **Evidence**: Hybrid vs vector-only MRR: e5-small 0.90 (PGroonga) and 0.82 (bigm) vs 0.95 vector. granite-97m 0.912 / 0.882 vs 0.975. ruri-130m 0.842 / 0.85 vs 0.912. MiniLM is the exception: hybrid_groonga 0.743 vs 0.554 vector. So keyword help is real for a weak embedder, and negative for a strong one on this corpus.
- **Cost**: Weighted or gated fusion was not run. The 40-passage corpus is easy for vectors, so the real value of the keyword leg (exact IDs, product names, rare terms) is probably underestimated.

### HNSW with space_id filter

- **Recommendation** [verified]: Require pgvector >= 0.8 and run `SET LOCAL hnsw.iterative_scan = relaxed_order` (and consider a larger hnsw.ef_search) in every filtered vector query, with a btree index on space_id. Let the planner use exact scans for small Spaces.
- **Evidence**: 30k vectors of 384 dim, 100 spaces. HNSW-only plan with filter space_id=7 and LIMIT 10: 0 rows without iterative scan, 10 rows with relaxed_order.
- **Cost**: relaxed_order may return results slightly out of order, so re-sort the final list. Also check the managed version: RDS lists pgvector 0.8.2 and Cloud SQL 0.8.5, both at least 0.8.

### Chunking Markdown with Japanese

- **Recommendation** [verified]: Chunk by heading section; split long sections on sentence boundaries (。！？ and newlines) packed to about 200-300 characters, with no overlap, and prefix every chunk with its heading path (`H1 > H2 > H3`). Measure size in characters, but cap in tokens at the model limit (512 for e5). Do not merge sections.
- **Evidence**: e5-small on 7 strategies: heading path 1.0 MRR vs 0.95 without; sentence-pack 200 characters + path 1.0; fixed 120 characters 0.967; fixed 120 characters with 20 overlap 0.958 (recall@5 0.95); merge two sections about 420 characters 0.657. Tokens per character on this corpus: ruri 0.50, e5/MiniLM 0.63, granite 0.8 (including the model's tokenizer).
- **Cost**: Each passage is a short single-topic unit, so the result shows that a bigger chunk is harmful here but does not give the best size for long documents. 200-300 characters is inferred from this and from the model windows, not measured on long text.

### Small Space: inject everything with prompt caching

- **Recommendation** [documented]: Use whole-Space injection when tokens(Space) < K/r and the Space is queried at least every 5 minutes. K is the average retrieval payload in tokens and r the cache-read multiplier. Otherwise retrieve. Re-count tokens with the provider's count endpoint on real Japanese text before fixing a threshold.
- **Evidence**: https://platform.claude.com/docs/en/build-with-claude/prompt-caching: write 1.25x (5 min) or 2x (1 h), read 0.1x, 0.05x on Opus 5.5 and Sonnet 5.5, 0.025x on Fable/Mythos; 5 min TTL refreshed by each hit; minimum 512 tokens on Sonnet 5.5. Per-request cost: cached injection ~ r*N, retrieval ~ K. With K=4k: N<80k at r=0.05, N<40k at r=0.1, N<160k at r=0.025. Cold request costs 1.25*N (5 min) or 2*N (1 h); over m requests in one window the cache wins when m > (1.25-r)N / (K - rN), e.g. N=30k, r=0.05, K=4k gives about 14.
- **Cost**: Any edit to the Space invalidates the cached prefix and pays another write. Provenance and per-item unshare then require rebuilding the prompt. A long prompt costs more latency on a miss and gets weaker attention than a focused one. Quality of full-context vs retrieval was not tested. Retrieval cost K excludes the tool or round-trip overhead.

## Versions

| Name | Version | Source |
| --- | --- | --- |
| @huggingface/transformers | 4.3.2 | npm view / installed |
| pg (node) | 8.23.1 | npm view / installed |
| onnxruntime-node (transitive) | 1.30.0 | @huggingface/transformers dependencies |
| PostgreSQL | 16.15 (Ubuntu apt and Debian PGDG) | local run |
| pgvector | 0.8.7 (source tag v0.8.7; apt candidate 0.6.0) | local run |
| pg_bigm | 1.2 (tag v1.2-20261118) | local run |
| PGroonga | 4.1.0-1 | packages.groonga.org apt and groonga/pgroonga:4.1.0-debian-16 |
| pg_trgm | 1.6 | local run |
| ParadeDB pg_search | v0.27.1 (latest tag, AGPL-3.0) | git ls-remote and repo LICENSE |
| Docker Engine | 29.9.3 | docker info |

## Details

## Corpus and benchmark (in repo)
`/home/user/tiger-browser/apps/server/bench/retrieval/` has `corpus.json` (40 passages: 10 fundraising, 10 hiring, 10 product, 10 meeting notes; each has 150-400 Japanese characters), `queries.json` (20 queries, labelled), `bench.mjs`, `README.md` (7 lines). No node_modules in the repo; deps live in `BENCH_DEPS`. Query kinds: 4 mixed alphanumeric (シリーズA, KPI, OKR 1on1, OAuth), 1 keyword-jp (資金調達 リード投資家), 4 two-character kanji (稟議, 内定, 退職, 障害), 3 katakana (ストックオプション, オンボーディング, ランウェイ), 4 paraphrase, 4 English-to-Japanese. recall@5 = any relevant passage in top 5; MRR = first relevant rank. Caveat: random top 5 would score 12.5%, and an easy corpus saturates, so only gross differences are trustworthy.

## 1. Dev setup
### (a) This container (verified; Ubuntu 24.04, PG 16.15)
```bash
pg_ctlcluster 16 main start
apt-get update
apt-get install -y postgresql-16-pgvector postgresql-server-dev-16 build-essential libmecab-dev   # apt gives pgvector 0.6.0 only
# newer pgvector (0.8.7, needed for iterative scans) from source
git clone --depth 1 --branch v0.8.7 https://github.com/pgvector/pgvector && make -C pgvector && make -C pgvector install
# pg_bigm from source
git clone --depth 1 --branch v1.2-20261118 https://github.com/pgbigm/pg_bigm && make -C pg_bigm USE_PGXS=1 && make -C pg_bigm USE_PGXS=1 install
# PGroonga from the Groonga apt repo (noble)
curl -O https://packages.groonga.org/ubuntu/groonga-apt-source-latest-noble.deb && apt-get install -y ./groonga-apt-source-latest-noble.deb
apt-get update && apt-get install -y postgresql-16-pgroonga      # 4.1.0-1
su postgres -c "psql -c 'create database tiger'"
su postgres -c "psql -d tiger -c 'create extension vector; create extension pg_trgm; create extension pg_bigm; create extension pgroonga;'"
```
Note: the apt `postgresql-16-pgvector` and the source build both install into the PG16 dir, so `make install` over it is fine. The apt install of `postgresql-16-pgroonga` works only after adding the Groonga repo. For TCP password auth I created `create role r4bench login superuser password 'r4bench'` (local test only). Docker: `nohup dockerd &` starts it; the first pull hit a 429, a later pull worked.

### (b) Developer Mac via docker compose (image built and run here; verified)
Dockerfile (base is Debian 13 trixie, PG 16.15, from the official PGroonga image, which already has PGroonga 4.1.0):
```dockerfile
FROM groonga/pgroonga:4.1.0-debian-16
ARG PG_BIGM_REF=v1.2-20261118
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git build-essential libicu-dev postgresql-server-dev-16 postgresql-16-pgvector; \
    git clone --depth 1 --branch "$PG_BIGM_REF" https://github.com/pgbigm/pg_bigm /tmp/pg_bigm; \
    make -C /tmp/pg_bigm USE_PGXS=1 install; \
    apt-get purge -y --auto-remove git build-essential libicu-dev postgresql-server-dev-16; \
    rm -rf /var/lib/apt/lists/* /tmp/pg_bigm
COPY init.sql /docker-entrypoint-initdb.d/10-extensions.sql
```
init.sql:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_bigm;
CREATE EXTENSION IF NOT EXISTS pgroonga;
```
compose:
```yaml
services:
  db:
    build: ./docker/postgres
    environment: { POSTGRES_PASSWORD: tiger, POSTGRES_DB: tiger }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes: { pgdata: {} }
```
Verified inside the built container: `select extname||' '||extversion from pg_extension` printed pg_bigm 1.2, pg_trgm 1.6, pgroonga 4.1.0, vector 0.8.7. Gotchas: bm_bigm needs `libicu-dev` to compile on Debian (first build failed with `unicode/ucol.h` missing). The image is amd64 and arm64 if the base is multi-arch (not checked; Apple Silicon is unverified). Init scripts only run on an empty volume. In this sandbox the build also needed `--network host`, the proxy CA and https apt sources (sandbox-only workarounds, not needed on a Mac). The first attempt from `postgres:16-bookworm` failed because the Groonga bookworm repo has no PG16 package (PG17 only).

## 2. Keyword methods (index DDL, query syntax, licence)
| Method | Licence | Index DDL | Query used | Managed availability |
|---|---|---|---|---|
| default FTS 'simple' | PostgreSQL | `GIN (to_tsvector('simple', body))` | `@@ websearch_to_tsquery` | everywhere; does not segment Japanese |
| ILIKE | PostgreSQL | none (seq scan) or trgm/bigm GIN | `body ILIKE '%term%'` | everywhere |
| pg_trgm 1.6 | PostgreSQL | `CREATE INDEX ON t USING gin (body gin_trgm_ops)` | `similarity(body,q)`, `word_similarity(q,body)`, `body % q` | RDS, Cloud SQL, Neon |
| pg_bigm 1.2 | PostgreSQL licence | `CREATE INDEX ON t USING gin (body gin_bigm_ops)` | `body LIKE likequery(q)`, `bigm_similarity(q, body)` | RDS (1.2-20250903), Cloud SQL (flag), not Neon; Supabase unconfirmed |
| PGroonga 4.1.0 | PostgreSQL licence | `CREATE INDEX ON t USING pgroonga (body)` | `body &@~ 'a OR b'`, `body &@* q`, `pgroonga_score(tableoid, ctid)` | Supabase; not RDS, Cloud SQL, Neon |
| ParadeDB pg_search 0.27.x | AGPL-3.0 (Community) | BM25 index with lindera tokenizer | not run | not on RDS, Cloud SQL; Neon: Unavailable |
pg_trgm 1.6 hashed trigrams for Japanese correctly in a `C.UTF-8` database (`show_trgm('資金調達')` returned 5 trigrams); the default C locale was not tested. The pg_bigm LIKE form does not rank by relevance, and it only does a 2-character index; PGroonga's default tokenizer is TokenBigram.

### Results (40 passages, 20 queries; indexes forced with `enable_seqscan=off`)
| method | recall@5 | MRR | mixed-alnum /4 | kw-jp /1 | kanji-2 /4 | katakana /3 | paraphrase /4 | English /4 |
|---|---|---|---|---|---|---|---|---|
| fts simple | 0.05 | 0.050 | 1 | 0 | 0 | 0 | 0 | 0 |
| ILIKE (any term) | 0.65 | 0.542 | 4 | 1 | 4 | 3 | 0 | 1 |
| pg_trgm word_similarity | 0.80 | 0.675 | 4 | 1 | 4 | 3 | 3 | 1 |
| pg_trgm similarity | 0.80 | 0.750 | 4 | 1 | 4 | 3 | 3 | 1 |
| pg_bigm LIKE (any term) | 0.65 | 0.542 | 4 | 1 | 4 | 3 | 0 | 1 |
| pg_bigm bigm_similarity | 0.85 | 0.700 | 4 | 1 | 4 | 3 | 4 | 1 |
| PGroonga &@~ (OR terms) | 0.65 | 0.625 | 4 | 1 | 4 | 3 | 0 | 1 |
| PGroonga &@* (similar) | 0.70 | 0.700 | 4 | 1 | 4 | 3 | 1 | 1 |
All code-based methods get every mixed-alphanumeric, 2-character kanji and katakana query; they differ on paraphrase queries, which are long strings without whitespace, where bigram similarity helps and exact terms fail. The 1 English hit per method is the passage that contains the English token (for example `post-money`). Paraphrase and English-to-Japanese retrieval need embeddings.

## 3. Embedding models (Node 22, @huggingface/transformers 4.3.2, ONNX, q8, CPU, 4 cores, batch 8)
Throughput is 160 windows of exactly 300 characters; avg passage in the corpus is 190 characters. Load = from local disk, not including download.
| key | model | dim | licence | download MB | load s | first call ms | passages/s | peak RSS MB | prefixes | recall@5 | MRR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| e5-small | Xenova/multilingual-e5-small | 384 | MIT | 135 | 2.7 | 25 | 65.4 | 656 | `query: ` / `passage: ` | 1.00 | 0.950 |
| e5-base | Xenova/multilingual-e5-base | 768 | MIT | 296 | 4.3 | 32 | 38.2 | 821 | same | 1.00 | 0.938 |
| ruri-30m | sirasagi62/ruri-v3-30m-ONNX | 256 | Apache-2.0 | 44 | 0.4 | 16 | 104.8 | 339 | `検索クエリ: ` / `検索文書: ` | 0.95 | 0.899 |
| ruri-70m | mochiya98/ruri-v3-70m-onnx | 384 | Apache-2.0 | 77 | 2.5 | 24 | 62.0 | 433 | same | 0.95 | 0.896 |
| ruri-130m | sirasagi62/ruri-v3-130m-ONNX | 512 | Apache-2.0 | 140 | 3.8 | 40 | 30.9 | 577 | same | 1.00 | 0.912 |
| minilm-l12 | Xenova/paraphrase-multilingual-MiniLM-L12-v2 | 384 | Apache-2.0 | 135 | 3.0 | 24 | 72.6 | 575 | none | 0.75 | 0.554 |
| granite-97m | onnx-community/granite-embedding-97m-multilingual-r2-ONNX | 384 | Apache-2.0 | 123 | 3.4 | 58 | 28.0 | 625 | none | 1.00 | 0.975 |
| gemma-300m | onnx-community/embeddinggemma-300m-ONNX | 768 | Gemma terms | 331 | 4.9 | 680 | 6.5 | 1680 | `task: search result | query: ` / `title: none | text: ` | 1.00 | 1.000 |
| bge-m3 | onnx-community/bge-m3-ONNX | 1024 | MIT | 586 | 9.4 | 74 | 12.1 | 1438 | none (CLS pooling) | 1.00 | 1.000 |
Notes. Pooling: e5 mean, ruri/gemma use the model's own `sentence_embedding` output, bge-m3 and granite CLS (all L2-normalised). The cl-nagoya/ruri-v3-* repos have no ONNX files, and `onnx-community/ruri-v3-30m-ONNX` has no tokenizer so `AutoTokenizer` throws; use the sirasagi62 or mochiya98 conversions. embeddinggemma-2 (Oct 2026, Apache-2.0, multimodal, 740M) exists as ONNX but was not run. onnx-community/jina-embeddings-v5-omni-nano-ONNX is CC-BY-NC, so not usable. ruri-v3-310m ONNX (mochiya98, sirasagi62) and granite-311m-multilingual-r2 were not run. Throughput runs were sequential on an otherwise idle machine, but a small corpus means MRR differences of 0.03 are noise. fp32 variants are in the registry but were not measured.

## 4. Hybrid retrieval SQL (tested through bench.mjs; space filter inside both legs)
Schema and indexes:
```sql
create extension if not exists vector;
create table chunks (
  id text primary key, space_id int not null, body text not null, embedding vector(384) not null
);
create index chunks_hnsw on chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index chunks_space on chunks (space_id);
-- pick ONE keyword index depending on the platform:
create index chunks_bigm on chunks using gin (body gin_bigm_ops);      -- RDS, Cloud SQL, self-hosted
create index chunks_groonga on chunks using pgroonga (body);           -- Supabase, self-hosted
```
Query (PGroonga leg; for pg_bigm replace the `k` CTE as shown under it). $1 = query vector as text, $2 = query text, $3 = space_id. Run `set local hnsw.iterative_scan = relaxed_order;` first in the same transaction.
```sql
with v as (
  select id, row_number() over (order by embedding <=> $1::vector) as r
  from chunks where space_id = $3
  order by embedding <=> $1::vector limit 20),
k as (
  select id, row_number() over (order by pgroonga_score(tableoid, ctid) desc) as r
  from chunks where space_id = $3 and body &@* $2
  order by pgroonga_score(tableoid, ctid) desc limit 20),
fused as (
  select coalesce(v.id, k.id) as id,
         coalesce(1.0/(60 + v.r), 0) + coalesce(1.0/(60 + k.r), 0) as score
  from v full outer join k on v.id = k.id)
select id from fused order by score desc limit 20;
-- pg_bigm keyword leg:
--   select id, row_number() over (order by bigm_similarity($2, body) desc) as r
--   from chunks where space_id = $3 and bigm_similarity($2, body) > 0
--   order by bigm_similarity($2, body) desc limit 20
```
Note: `bigm_similarity($2, body) > 0` is a sequential filter and does not use the GIN index on its own; use `body LIKE likequery($2)` plus the threshold GUC `pg_bigm.similarity_limit` for index use at scale (index plans were not benchmarked at size). In the benchmark the keyword leg also lives in a separate table `kw_chunks` (same ids).

### Vector-only vs hybrid (recall@5 / MRR)
| model | vector-only | hybrid + pg_bigm | hybrid + PGroonga | keyword-only best (bigm_similarity) |
|---|---|---|---|---|
| e5-small | 1.00 / 0.950 | 0.85 / 0.821 | 1.00 / 0.900 | 0.85 / 0.700 |
| e5-base | 1.00 / 0.938 | 0.90 / 0.800 | 1.00 / 0.879 | same |
| ruri-30m | 0.95 / 0.899 | 0.90 / 0.847 | 0.95 / 0.845 | same |
| ruri-70m | 0.95 / 0.896 | 0.95 / 0.876 | 1.00 / 0.846 | same |
| ruri-130m | 1.00 / 0.912 | 0.95 / 0.850 | 1.00 / 0.842 | same |
| minilm-l12 | 0.75 / 0.554 | 0.85 / 0.665 | 1.00 / 0.743 | same |
| granite-97m | 1.00 / 0.975 | 1.00 / 0.882 | 1.00 / 0.912 | same |
| gemma-300m | 1.00 / 1.000 | 0.85 / 0.849 | 1.00 / 0.892 | same |
| bge-m3 | 1.00 / 1.000 | 0.95 / 0.880 | 1.00 / 0.917 | same |
Vector-only results by query kind: every strong model scores 4/4 on paraphrase and mixed-alnum; the only gaps are ruri-30m English 3/4, ruri-70m kanji-2char 3/4, MiniLM 2/4 kanji-2char and 1/3 katakana.

## 5. Chunk experiment (e5-small; 4 Markdown-like docs; recall counted at passage level)
| strategy | chunks | avg chars | recall@5 | MRR |
|---|---|---|---|---|
| per section, no heading prefix | 40 | 190 | 1.00 | 0.950 |
| per section + `topic > title` prefix | 40 | 214 | 1.00 | 1.000 |
| fixed 120 characters + path | 81 | 117 | 1.00 | 0.967 |
| fixed 120 characters, 20 overlap + path | 83 | 126 | 0.95 | 0.958 |
| fixed 200 characters + path | 48 | 182 | 1.00 | 0.950 |
| sentence-pack 200 characters + path | 48 | 182 | 1.00 | 1.000 |
| two sections merged + path | 20 | 419 | 0.95 | 0.657 |

## 6. Filtered HNSW test (30,000 random 384-d vectors, 100 spaces)
```sql
-- forced HNSW (no space_id index), filter hits ~1% of rows
select count(*) from (select id from f where space_id=7 order by embedding <=> $q limit 10) t;  -- 0 rows
set hnsw.iterative_scan = relaxed_order;
select count(*) from (select id from f where space_id=7 order by embedding <=> $q limit 10) t;  -- 10 rows
```
With a btree index on space_id the planner chose exact scans (bitmap or index scan on space_id then sort) for a 1% space.

## 7. Prompt cache arithmetic
Let N = Space tokens, K = retrieval payload tokens, r = read multiplier, w = write multiplier (1.25 for 5 min, 2 for 1 h). Warm cached injection costs r*N per request versus K for retrieval (both x base input price; the shared system prompt is cached either way). Per-request breakeven N* = K/r. At K=4k tokens: 160k at r=0.025, 80k at r=0.05 (Opus 5.5, Sonnet 5.5), 40k at r=0.1 (other models). A cold or edited Space costs w*N once; across m requests in a warm window the cache wins when m > (w - r)N / (K - rN) (needs K > rN). Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching (fetched 2026-11-26). Output tokens and latency are unchanged by this math. Not measured: Claude's tokens per Japanese character (embedding tokenizers gave 0.5-0.8 token/character; the Claude tokenizer is different). The API key in the task text was not used.

## Managed-service sources
RDS extension versions: https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-extensions.html (pgvector 0.8.2, pg_bigm 1.2-20250903, pg_trgm 1.6; PGroonga and pg_search not listed). Cloud SQL: https://docs.cloud.google.com/sql/docs/postgres/extensions (pgvector 0.8.5, pg_bigm via flag, pg_trgm 1.6). Neon: https://neon.com/docs/extensions/pg-extensions (pgvector 0.8.7, pg_trgm 1.6; pg_bigm, PGroonga no; pg_search Unavailable). Supabase PGroonga: https://supabase.com/docs/guides/database/extensions/pgroonga. RDS pgvector 0.8.0 iterative scan: https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-rds-for-postgresql-pgvector-080

## Risks

- The corpus is 40 passages that I wrote myself, so results are optimistic and saturate for strong models. Differences between the top six embedders and the hybrid-versus-vector gap are within noise. Re-run on real Space content before fixing a default.
- A hybrid RRF with an unweighted keyword leg lowered MRR for strong embedders. The shipped hybrid should be gated or weighted; those variants were not tested.
- bench.mjs hybrid code uses bigm_similarity > 0, which does not use the GIN index; index plans and latency at realistic sizes (100k+ chunks) were not benchmarked.
- pg_bigm and PGroonga cannot both be available on a managed target. The retrieval layer needs an adapter, and Tokyo-region availability for each managed service was not verified.
- ParadeDB was only assessed from its repository (licence, tokenizer). It was not installed or measured.
- The ONNX files for ruri-v3 are community conversions; ruri-v3-310m, granite-311m and embeddinggemma-2 were not run.
- The Docker build here needed sandbox-only workarounds (proxy CA, https apt sources, --network host). The Dockerfile in details is the clean version; the unmodified Dockerfile was not built on a Mac or arm64.
- Claude's tokenisation of Japanese was not measured, so the injection threshold in tokens is only given as a formula.
- I started dockerd, installed apt packages (pgvector, groonga repo, postgresql-16-pgroonga) and a local Postgres role and database (r4, role r4bench with password r4bench) in the container. These are local test artifacts and should not be reused as configuration.

## Open questions

- Where will embeddings run: the Electron main process, a utility process or the server? That sets the default (e5-small at 656 MB RSS versus a server-side bge-m3 or granite).
- Which managed Postgres will production use? That decides pg_bigm versus PGroonga.
- Does Tiger need Japanese keyword search at all if the vector leg is strong? A bigger corpus with exact identifiers, names and numbers would show whether the keyword leg earns its place.
- What do real Space documents look like (length, tables, Google Docs exports)? The chunk size has not been tested on long sections.
- What does the Claude tokenizer give per Japanese character on real content, and what K does the retrieval payload actually have?
