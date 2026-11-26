# Retrieval benchmark (mixed JP/EN): 40 passages, 20 labelled queries
Needs: Postgres 16/17 with pgvector, pg_trgm, pg_bigm, pgroonga; node 22; packages `pg` and `@huggingface/transformers` installed OUTSIDE the repo.
Setup: `mkdir /tmp/deps && cd /tmp/deps && npm i pg @huggingface/transformers`, then `export BENCH_DEPS=/tmp/deps DATABASE_URL=postgres://user:pw@127.0.0.1:5432/dbname` (superuser: it runs CREATE EXTENSION).
Keyword methods: `node bench.mjs kw`. Embed one model (own process, prints size/cold start/passages-per-second/peak RSS): `node bench.mjs embed ruri-130m`.
Vector-only and hybrid (RRF) tables from cached embeddings: `node bench.mjs vec ruri-130m e5-small` (model keys are listed by running with no args).
Chunking experiment: `node bench.mjs chunk e5-small`. Embedding cache goes to `$BENCH_CACHE` (default `./.bench-cache`); delete it to re-embed.
Metrics: recall@5 = fraction of queries with any relevant passage in the top 5; MRR over the first relevant passage. 40 passages is small: use it to catch failures, not to rank close models.
