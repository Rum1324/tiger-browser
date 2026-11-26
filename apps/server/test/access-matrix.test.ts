import { type ApiRouteName, api } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spaceWithMembers } from './helpers/fixtures'
import { type Harness, page, startHarness } from './helpers/harness'

let h: Harness
let ids: {
  spaceId: string
  itemId: string
  spaceThreadId: string
  privateThreadId: string
  inviteId: string
  memberId: string
}
let tokens: { stranger: string; otherMember: string }

beforeAll(async () => {
  h = await startHarness()
  const { owner, member, space } = await spaceWithMembers(h, 'Matrix')
  const shared = await h.ok(
    'shareItem',
    { params: { spaceId: space.id }, body: { page: page('https://example.com/m', 'm') } },
    owner.token,
  )
  const spaceThread = await h.ok(
    'createThread',
    { params: { spaceId: space.id }, body: { visibility: 'space' } },
    owner.token,
  )
  const privateThread = await h.ok(
    'createThread',
    { params: { spaceId: space.id }, body: { visibility: 'private' } },
    owner.token,
  )
  await h.ok(
    'postMessage',
    { params: { threadId: privateThread.id }, body: { content: 'mine', askAi: false } },
    owner.token,
  )
  const invite = await h.ok(
    'createInvite',
    { params: { spaceId: space.id }, body: {} },
    owner.token,
  )
  const stranger = await h.login('Stranger')
  // The stranger owns a Space of their own, so they are a real, active user.
  await h.ok('createSpace', { body: { name: 'Elsewhere' } }, stranger.token)
  ids = {
    spaceId: space.id,
    itemId: shared.item.id,
    spaceThreadId: spaceThread.id,
    privateThreadId: privateThread.id,
    inviteId: invite.invite.id,
    memberId: member.user.id,
  }
  tokens = { stranger: stranger.token, otherMember: member.token }
})
afterAll(() => h.close())

type Input = Record<string, unknown>
/** One valid request per scoped route, aimed at the Space's resources. */
const requests = (threadId: string): Partial<Record<ApiRouteName, () => Input>> => ({
  getSpace: () => ({ params: { spaceId: ids.spaceId } }),
  updateSpace: () => ({ params: { spaceId: ids.spaceId }, body: { name: 'Hijack' } }),
  createInvite: () => ({ params: { spaceId: ids.spaceId }, body: {} }),
  revokeInvite: () => ({ params: { spaceId: ids.spaceId, inviteId: ids.inviteId } }),
  removeMember: () => ({ params: { spaceId: ids.spaceId, userId: ids.memberId } }),
  shareItem: () => ({
    params: { spaceId: ids.spaceId },
    body: { page: page('https://example.com/x', 'x') },
  }),
  listItems: () => ({ params: { spaceId: ids.spaceId } }),
  getItem: () => ({ params: { itemId: ids.itemId } }),
  listItemVersions: () => ({ params: { itemId: ids.itemId } }),
  unshareItem: () => ({ params: { itemId: ids.itemId } }),
  listAudit: () => ({ params: { spaceId: ids.spaceId }, query: {} }),
  search: () => ({ params: { spaceId: ids.spaceId }, body: { query: 'm' } }),
  getUsage: () => ({ params: { spaceId: ids.spaceId } }),
  listThreads: () => ({ params: { spaceId: ids.spaceId }, query: {} }),
  createThread: () => ({ params: { spaceId: ids.spaceId }, body: { visibility: 'space' } }),
  listMessages: () => ({ params: { threadId }, query: {} }),
  postMessage: () => ({ params: { threadId }, body: { content: 'hi', askAi: false } }),
  shareThread: () => ({ params: { threadId } }),
  deleteThread: () => ({ params: { threadId } }),
  recordExport: () => ({
    params: { spaceId: ids.spaceId },
    body: { title: 'T', url: 'https://docs.google.com/document/d/x' },
  }),
})

const scoped = (Object.keys(api) as ApiRouteName[]).filter((n) =>
  /:(spaceId|itemId|threadId)/.test(api[n].path),
)
const threadScoped = scoped.filter((n) => api[n].path.includes(':threadId'))

describe('non-members get 404 on every Space-scoped route', () => {
  it('covers every scoped route in the contract', () => {
    expect(Object.keys(requests('x')).sort()).toEqual([...scoped].sort())
  })

  it.each(scoped)('%s', async (name) => {
    const build = requests(ids.spaceThreadId)[name]
    if (!build) throw new Error(`no request for ${name}`)
    const r = await h.call(name, build() as never, tokens.stranger)
    expect(r.status).toBe(404)
    expect('error' in r.body && r.body.error.code).toMatch(/_not_found$/)
  })

  it('leaves the Space intact for its members', async () => {
    const detail = await h.call(
      'getSpace',
      { params: { spaceId: ids.spaceId } },
      tokens.otherMember,
    )
    expect(detail.status).toBe(200)
    expect(
      await h.call('getItem', { params: { itemId: ids.itemId } }, tokens.otherMember),
    ).toMatchObject({ status: 200 })
  })
})

describe('another member gets 404 on every route of a private thread', () => {
  it.each(threadScoped)('%s', async (name) => {
    const build = requests(ids.privateThreadId)[name]
    if (!build) throw new Error(`no request for ${name}`)
    const r = await h.call(name, build() as never, tokens.otherMember)
    expect({ status: r.status, code: 'error' in r.body ? r.body.error.code : null }).toEqual({
      status: 404,
      code: 'thread_not_found',
    })
  })

  it('does not list the private thread for them', async () => {
    const threads = await h.ok(
      'listThreads',
      { params: { spaceId: ids.spaceId }, query: {} },
      tokens.otherMember,
    )
    expect(threads.map((t) => t.id)).toEqual([ids.spaceThreadId])
  })
})
