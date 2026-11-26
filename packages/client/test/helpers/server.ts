/**
 * The real server, in-process, through its supported test entry (`@tiger/server/testing`): its own
 * migrated schema in tiger_test, real routes, realtime hub, retrieval with the hash embedder, and
 * the chat layer on the mock LLM provider streaming small chunks.
 */
export {
  fakeGoogleIdToken as googleToken,
  startTestServer as startServer,
  TEST_DATABASE_URL,
  type TestServer,
} from '@tiger/server/testing'
