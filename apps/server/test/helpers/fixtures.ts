import type { Harness } from './harness'

/** An owner, a second member, and their Space. */
export async function spaceWithMembers(h: Harness, label = 'S') {
  const owner = await h.login(`${label}Owner`)
  const member = await h.login(`${label}Member`)
  const space = await h.ok('createSpace', { body: { name: `${label} space` } }, owner.token)
  const { token } = await h.ok(
    'createInvite',
    { params: { spaceId: space.id }, body: {} },
    owner.token,
  )
  await h.ok('acceptInvite', { body: { token } }, member.token)
  return { owner, member, space }
}

/** Insert a retrieval chunk directly, as the real Indexer would. */
export async function insertChunk(
  h: Harness,
  c: { id: string; spaceId: string; itemId: string; versionId: string; ord: number; text: string },
) {
  await h.sql`
    insert into chunks (id, space_id, item_id, item_version_id, ord, heading_path, text, char_count, embedding)
    values (${c.id}, ${c.spaceId}, ${c.itemId}, ${c.versionId}, ${c.ord}, 'Intro', ${c.text}, ${c.text.length},
            array_fill(0.01::real, array[384])::vector)
  `
}
