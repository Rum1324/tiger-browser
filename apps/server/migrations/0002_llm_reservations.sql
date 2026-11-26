-- Tokens an answer in flight is expected to spend, held against the Space's budget from the moment
-- the provider is called until the answer settles and its real usage lands in llm_usage. Without it,
-- questions asked together all pass the budget check, since llm_usage is written only at the end.
-- Rows older than the answer timeout are ignored, so a crash cannot hold budget forever; startup
-- also clears them (one server instance per database).
CREATE TABLE llm_reservations (
  message_id  uuid PRIMARY KEY,
  space_id    uuid NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  tokens      bigint NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_reservations_space_idx ON llm_reservations (space_id, at);
