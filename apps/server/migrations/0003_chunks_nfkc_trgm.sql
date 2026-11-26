-- The keyword leg compares NFKC-normalised text, so identifiers typed in full-width (ＥＲＲ－４０１２)
-- match half-width chunk text and the reverse. normalize() is immutable, so it can be indexed.
CREATE INDEX chunks_text_nfkc_trgm_idx ON chunks USING gin (normalize(text, NFKC) gin_trgm_ops);
