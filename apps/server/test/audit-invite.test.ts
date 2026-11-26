import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spaceWithMembers } from './helpers/fixtures'
import { connectAs, type Harness, startHarness } from './helpers/harness'

let h: Harness
let port: number
beforeAll(async () => {
  h = await startHarness()
  port = await h.listen()
})
afterAll(() => h.close())

describe('audit rows carry nothing members may not see', () => {
  it('an invite by email does not reveal the address to members', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'InvAudit')
    const ws = await connectAs(port, member.token, [space.id])
    const email = 'candidate.secret@outside.example'
    await h.ok('createInvite', { params: { spaceId: space.id }, body: { email } }, owner.token)
    await ws.next('audit.appended', (e) => e.event.action === 'member.invited')
    await ws.sync()
    expect(JSON.stringify(ws.events)).not.toContain('candidate.secret')
    const audit = await h.ok(
      'listAudit',
      { params: { spaceId: space.id }, query: {} },
      member.token,
    )
    expect(JSON.stringify(audit)).not.toContain('candidate.secret')
    // The owner still sees it where it belongs.
    const detail = await h.ok('getSpace', { params: { spaceId: space.id } }, owner.token)
    expect(JSON.stringify(detail)).toContain(email)
    ws.close()
  })

  it('an export from a private thread announces neither its title nor its Doc URL', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'PrivExp')
    const priv = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    const { message } = await h.ok(
      'postMessage',
      { params: { threadId: priv.id }, body: { content: 'x', askAi: false } },
      owner.token,
    )
    const ws = await connectAs(port, member.token, [space.id])
    await h.ok(
      'recordExport',
      {
        params: { spaceId: space.id },
        body: {
          messageId: message.id,
          title: 'Layoff candidates draft',
          url: 'https://docs.google.com/document/d/secretdoc',
        },
      },
      owner.token,
    )
    await ws.next('audit.appended', (e) => e.event.action === 'export.google_doc')
    await ws.sync()
    const audit = await h.ok(
      'listAudit',
      { params: { spaceId: space.id }, query: {} },
      member.token,
    )
    for (const text of [JSON.stringify(ws.events), JSON.stringify(audit)]) {
      expect(text).not.toContain('Layoff')
      expect(text).not.toContain('secretdoc')
    }
    ws.close()
  })

  it('refuses an export record whose URL is not a Google Docs document', async () => {
    const { member, space } = await spaceWithMembers(h, 'BadUrl')
    for (const url of [
      'https://evil.example/login',
      'javascript:alert(1)',
      'http://docs.google.com/document/d/x',
      'https://docs.google.com.evil.example/document/d/x',
    ]) {
      await h.fails(
        'recordExport',
        { params: { spaceId: space.id }, body: { title: 'Plan', url } },
        member.token,
        400,
        'invalid_request',
      )
    }
  })
})

describe('invite races', () => {
  it('a double-clicked invite answers the second click with the Space, not invite_used', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Dbl')
    const joiner = await h.login('Joiner')
    const { token } = await h.ok(
      'createInvite',
      { params: { spaceId: space.id }, body: {} },
      owner.token,
    )
    const [a, b] = await Promise.all([
      h.call('acceptInvite', { body: { token } }, joiner.token),
      h.call('acceptInvite', { body: { token } }, joiner.token),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    const again = await h.ok('acceptInvite', { body: { token } }, joiner.token)
    expect(again.id).toBe(space.id)
  })

  it('two different invites to one Space accepted at once by the same user do not fail', async () => {
    const { owner, space } = await spaceWithMembers(h, 'TwoInv')
    for (let run = 0; run < 8; run++) {
      const joiner = await h.login(`Two${run}`)
      const one = await h.ok(
        'createInvite',
        { params: { spaceId: space.id }, body: {} },
        owner.token,
      )
      const two = await h.ok(
        'createInvite',
        { params: { spaceId: space.id }, body: {} },
        owner.token,
      )
      const results = await Promise.all([
        h.call('acceptInvite', { body: { token: one.token } }, joiner.token),
        h.call('acceptInvite', { body: { token: two.token } }, joiner.token),
      ])
      expect(results.map((r) => r.status)).toEqual([200, 200])
    }
  })

  it('a message posted while its thread is deleted gets 404, not 500', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Gone')
    const statuses = new Set<number>()
    for (let run = 0; run < 15; run++) {
      const t = await h.ok(
        'createThread',
        { params: { spaceId: space.id }, body: { visibility: 'space' } },
        owner.token,
      )
      const [post] = await Promise.all([
        h.call(
          'postMessage',
          { params: { threadId: t.id }, body: { content: 'hi', askAi: false } },
          owner.token,
        ),
        h.call('deleteThread', { params: { threadId: t.id } }, owner.token),
      ])
      statuses.add(post.status)
    }
    expect([...statuses].every((s) => s === 200 || s === 404)).toBe(true)
  })
})
