import {
  aiFailureKey,
  attachFailureKey,
  createTigerClient,
  errorKey,
  googleFlowKey,
  shareFailureKey,
  shareThreadFailureKey,
  type TigerClient,
  type ViewMessage,
} from '@tiger/client'
import { useTigerStore } from '@tiger/client/react'
import type { ModelRef, Tab } from '@tiger/shared'
import { useEffect, useState } from 'react'
import type { Strings } from './i18n'

const tiger = window.tiger

/**
 * Developer controls for the team layer, driven through @tiger/client with window.tiger as the
 * bridge: sign-in, Spaces, share with preview, shared items, threads with streaming answers. Plain on
 * purpose; the designed UI replaces it.
 */
export function TeamPanel({
  t,
  serverUrl,
  activeTab,
}: {
  t: Strings
  serverUrl: string
  activeTab: Tab | null
}) {
  const [client, setClient] = useState<TigerClient | null>(null)

  useEffect(() => {
    if (!serverUrl) return
    const c = createTigerClient({ serverUrl, bridge: tiger })
    setClient(c)
    void c.start()
    return () => {
      c.dispose()
      setClient(null)
    }
  }, [serverUrl])

  if (!client) return null
  return <Team client={client} t={t} activeTab={activeTab} />
}

function Team({
  client,
  t,
  activeTab,
}: {
  client: TigerClient
  t: Strings
  activeTab: Tab | null
}) {
  const session = useTigerStore(client.session.store, (s) => s)
  const connection = useTigerStore(client.ui, (s) => s.connection)
  const tr = client.t()

  if (session.status !== 'signedIn') {
    return (
      <section className="team" data-testid="team">
        <SignIn client={client} t={t} />
        {session.error ? <div className="error">{tr(errorKey(session.error))}</div> : null}
        {session.googleError ? (
          <div className="error" data-testid="google-signin-error">
            {tr(googleFlowKey(session.googleError))}
          </div>
        ) : null}
      </section>
    )
  }
  return (
    <section className="team" data-testid="team">
      <div data-testid="signed-in">
        {t.signedInAs} {session.user?.name} ({session.user?.email}) ·{' '}
        <span data-testid="connection">{connection}</span>{' '}
        <button type="button" onClick={() => void client.session.logout()}>
          {t.signOut}
        </button>
      </div>
      <PendingInvite client={client} t={t} />
      <Spaces client={client} t={t} />
      <TabShare client={client} t={t} activeTab={activeTab} />
      <Items client={client} t={t} />
      <Threads client={client} t={t} activeTab={activeTab} />
    </section>
  )
}

function SignIn({ client, t }: { client: TigerClient; t: Strings }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void client.session.devLogin(email.trim(), name.trim())
      }}
    >
      <strong>{t.devSignIn}</strong>
      <input
        data-testid="dev-email"
        placeholder={t.email}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        data-testid="dev-name"
        placeholder={t.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" data-testid="dev-sign-in">
        {t.devSignIn}
      </button>
      <button type="button" onClick={() => void client.session.signInWithGoogle()}>
        {t.googleSignIn}
      </button>
    </form>
  )
}

function PendingInvite({ client, t }: { client: TigerClient; t: Strings }) {
  const pending = useTigerStore(client.spaces.store, (s) => s.pendingInvite)
  if (!pending) return null
  return (
    <div className="prompt" data-testid="pending-invite">
      {client.t()('invite.opened')}
      <button type="button" onClick={() => void client.spaces.acceptPendingInvite()}>
        {t.join}
      </button>
      <button type="button" onClick={() => client.spaces.dismissPendingInvite()}>
        {t.dismiss}
      </button>
    </div>
  )
}

function Spaces({ client, t }: { client: TigerClient; t: Strings }) {
  const spaces = useTigerStore(client.spaces.store, (s) => s)
  const [name, setName] = useState('')
  const tr = client.t()
  return (
    <div>
      <strong>{t.spaces}</strong>
      <select
        data-testid="space-select"
        value={spaces.currentSpaceId ?? ''}
        onChange={(e) => void client.spaces.select(e.target.value || null)}
      >
        <option value="">—</option>
        {spaces.list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const created = await client.spaces.create(name.trim())
          if (created) {
            setName('')
            await client.spaces.select(created.id)
          }
        }}
      >
        <input
          data-testid="space-name"
          placeholder={t.spaceName}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" data-testid="space-create">
          {t.createSpace}
        </button>
      </form>
      {spaces.mutation.error ? (
        <div className="error">{tr(errorKey(spaces.mutation.error))}</div>
      ) : null}
    </div>
  )
}

function TabShare({
  client,
  t,
  activeTab,
}: {
  client: TigerClient
  t: Strings
  activeTab: Tab | null
}) {
  // Subscribing to the store re-renders on any index or tab change; forTab reads the result.
  useTigerStore(client.urlShare.store, (s) => s)
  const flow = useTigerStore(client.share.store, (s) => s)
  const spaces = useTigerStore(client.spaces.store, (s) => s.list)
  const state = activeTab ? client.urlShare.forTab(activeTab.id) : null
  const tr = client.t()
  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? id

  let label = '—'
  if (state?.status === 'pending') label = t.checking
  else if (state?.status === 'error') label = t.unknownShareState
  else if (state && state.locations.length === 0) label = t.notShared
  else if (state)
    label = state.locations
      .map(
        (l) => `${t.sharedIn} ${spaceName(l.spaceId)} · ${l.sharedBy.name} · v${l.versionNumber}`,
      )
      .join(' / ')

  return (
    <div>
      <strong>{t.thisTab}</strong>
      <div
        data-testid="tab-share-state"
        data-shared={state && state.status === 'ready' ? String(state.locations.length > 0) : ''}
      >
        {label}
      </div>
      <button
        type="button"
        data-testid="share-begin"
        disabled={!activeTab || flow.phase === 'extracting' || flow.phase === 'sending'}
        onClick={() => activeTab && void client.share.begin(activeTab.id)}
      >
        {t.shareToSpace}
      </button>
      {flow.phase === 'extracting' ? <div>{t.extracting}</div> : null}
      {flow.phase === 'preview' ? (
        <div className="preview" data-testid="share-preview">
          <div>
            {t.previewOf} {flow.page.title} → {spaceName(flow.spaceId)}
            {flow.existing ? ` (${t.alreadyShared} v${flow.existing.versionNumber})` : ''}
          </div>
          <pre data-testid="share-preview-markdown">{flow.page.markdown}</pre>
          <button
            type="button"
            data-testid="share-confirm"
            onClick={() => void client.share.confirm()}
          >
            {t.confirmShare}
          </button>
          <button type="button" onClick={() => client.share.cancel()}>
            {t.cancel}
          </button>
        </div>
      ) : null}
      {flow.phase === 'sending' ? <div>{t.sending}</div> : null}
      {flow.phase === 'done' ? (
        <div data-testid="share-done">{tr(`share.outcome.${flow.outcome}`)}</div>
      ) : null}
      {flow.phase === 'error' ? (
        <div className="error" data-testid="share-error">
          {tr(shareFailureKey(flow.failure))}
        </div>
      ) : null}
    </div>
  )
}

function Items({ client, t }: { client: TigerClient; t: Strings }) {
  const items = useTigerStore(client.items.store, (s) => s.items)
  return (
    <div>
      <strong>{t.sharedItems}</strong>
      {items.length === 0 ? <div>{t.none}</div> : null}
      {items.map((i) => (
        <div key={i.id} data-testid="item" data-item-id={i.id} data-url={i.url}>
          {i.title} · {i.sharedBy.name} · v{i.currentVersion.number} · {i.status}{' '}
          <button
            type="button"
            data-testid="item-unshare"
            onClick={() => void client.items.unshare(i.id)}
          >
            {t.unshare}
          </button>
        </div>
      ))}
    </div>
  )
}

const PRIVATE = 'private'

function Threads({
  client,
  t,
  activeTab,
}: {
  client: TigerClient
  t: Strings
  activeTab: Tab | null
}) {
  const threads = useTigerStore(client.threads.store, (s) => s)
  const models = useTigerStore(client.models.store, (s) => s)
  const [choice, setChoice] = useState<string>(PRIVATE)
  const [question, setQuestion] = useState('')
  const tr = client.t()

  const spaceThreads = threads.threads.filter((x) => x.visibility === 'space')
  const threadId = choice === PRIVATE ? threads.privateThreadId : choice
  const thread = threadId ? (threads.threads.find((x) => x.id === threadId) ?? null) : null
  const messages = threadId ? threads.messages[threadId] : undefined
  const drafts = threadId ? (threads.drafts[threadId] ?? []) : []
  const attach = threads.attach

  useEffect(() => {
    if (threadId && !client.threads.store.getState().messages[threadId]) {
      void client.threads.loadMessages(threadId)
    }
  }, [client, threadId])

  const modelKey = (m: ModelRef | null) => (m ? `${m.provider}/${m.id}` : '')
  const ensureThread = async () =>
    choice === PRIVATE ? ((await client.threads.ensurePrivateThread())?.id ?? null) : threadId

  return (
    <div>
      <strong>{t.threads}</strong>
      <div>
        <select
          data-testid="thread-select"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value={PRIVATE}>{t.privateThread}</option>
          {spaceThreads.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title ?? t.untitled}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="thread-new"
          onClick={async () => {
            const created = await client.threads.createSpaceThread()
            if (created) setChoice(created.id)
          }}
        >
          {t.newSpaceThread}
        </button>
      </div>
      <div data-testid="thread-kind">
        {thread ? thread.visibility : choice === PRIVATE ? 'private' : ''}
      </div>

      <div className="messages" data-testid="messages">
        {(messages?.list ?? []).map((m) => (
          <Message key={m.id} m={m} client={client} t={t} />
        ))}
      </div>

      {choice === PRIVATE ? (
        <div>
          <button
            type="button"
            data-testid="attach-begin"
            disabled={!activeTab}
            onClick={async () => {
              const id = await ensureThread()
              if (id && activeTab) await client.threads.beginAttach(id, activeTab.id)
            }}
          >
            {t.attachPage}
          </button>
          {attach.phase === 'preview' ? (
            <div className="preview" data-testid="attach-preview">
              <div>
                {t.previewOf} {attach.page.title}
              </div>
              <pre data-testid="attach-preview-markdown">{attach.page.markdown}</pre>
              <button
                type="button"
                data-testid="attach-confirm"
                onClick={() => client.threads.confirmAttach()}
              >
                {t.confirmAttach}
              </button>
              <button type="button" onClick={() => client.threads.cancelAttach()}>
                {t.cancel}
              </button>
            </div>
          ) : null}
          {attach.phase === 'error' ? (
            <div className="error" data-testid="attach-error">
              {tr(attachFailureKey(attach.failure))}
            </div>
          ) : null}
          {drafts.map((p, i) => (
            <div key={`${p.url}|${p.capturedAt}`} data-testid="attachment-draft">
              {t.attached}: {p.title}{' '}
              <button
                type="button"
                onClick={() => threadId && client.threads.removeAttachment(threadId, i)}
              >
                {t.remove}
              </button>
            </div>
          ))}
          {threads.privateThreadId ? (
            <ShareThread client={client} t={t} threadId={threads.privateThreadId} />
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const text = question.trim()
          if (!text) return
          const id = await ensureThread()
          if (!id) return
          const r = await client.threads.post(id, text, { askAi: true })
          if (r) setQuestion('')
        }}
      >
        <select
          data-testid="model-select"
          value={modelKey(models.selected)}
          onChange={(e) => {
            const m = models.models.find((x) => modelKey(x) === e.target.value)
            if (m) client.models.select({ provider: m.provider, id: m.id })
          }}
        >
          {models.models.map((m) => (
            <option key={modelKey(m)} value={modelKey(m)} disabled={!m.available}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          data-testid="question"
          placeholder={t.askPlaceholder}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" data-testid="ask">
          {t.ask}
        </button>
      </form>
      {threads.mutation.error ? (
        <div className="error">{tr(errorKey(threads.mutation.error))}</div>
      ) : null}
    </div>
  )
}

/** Share the private thread with the Space: every question with an attached page is decided first. */
function ShareThread({
  client,
  t,
  threadId,
}: {
  client: TigerClient
  t: Strings
  threadId: string
}) {
  const flow = useTigerStore(client.shareThread.store, (s) => s)
  const tr = client.t()
  const busy = flow.phase === 'loading' || flow.phase === 'sending'
  return (
    <div>
      <button
        type="button"
        data-testid="share-thread-begin"
        disabled={busy}
        onClick={() => void client.shareThread.begin(threadId)}
      >
        {t.shareThread}
      </button>
      {flow.phase === 'deciding' ? (
        <div className="preview" data-testid="share-thread-dialog">
          {flow.questions.map((q) => (
            <div
              key={q.question.id}
              data-testid="share-thread-question"
              data-message-id={q.question.id}
              data-decision={q.decision ?? ''}
            >
              <div>{tr('shareThread.decide')}</div>
              <div>
                {q.question.content} ({t.answers}: {q.answers.length})
              </div>
              <button
                type="button"
                data-testid="share-thread-include"
                onClick={() => client.shareThread.decide(q.question.id, 'include')}
              >
                {t.includeInShare}
              </button>
              <button
                type="button"
                data-testid="share-thread-exclude"
                onClick={() => client.shareThread.decide(q.question.id, 'exclude')}
              >
                {t.excludeFromShare}
              </button>
            </div>
          ))}
          <div data-testid="share-thread-count">
            {t.messagesToShare}: {client.shareThread.preview().length}
          </div>
          <button
            type="button"
            data-testid="share-thread-confirm"
            disabled={!flow.ready}
            onClick={() => void client.shareThread.confirm()}
          >
            {t.confirmShare}
          </button>
          <button type="button" onClick={() => client.shareThread.cancel()}>
            {t.cancel}
          </button>
        </div>
      ) : null}
      {flow.phase === 'sending' ? <div>{t.sending}</div> : null}
      {flow.phase === 'done' ? (
        <div data-testid="share-thread-done" data-thread-id={flow.thread.id}>
          {tr('shareThread.done')}
        </div>
      ) : null}
      {flow.phase === 'error' ? (
        <div className="error" data-testid="share-thread-error">
          {tr(shareThreadFailureKey(flow.failure))}
        </div>
      ) : null}
    </div>
  )
}

function Message({ m, client, t }: { m: ViewMessage; client: TigerClient; t: Strings }) {
  return (
    <div
      className={`message ${m.message.role}`}
      data-testid="message"
      data-role={m.message.role}
      data-phase={m.phase}
      data-message-id={m.id}
    >
      <div data-testid="message-text">{m.text}</div>
      {m.message.attachments.length ? (
        <div>
          {t.attached}: {m.message.attachments.map((a) => a.title).join(', ')}
        </div>
      ) : null}
      {m.citations.map((c) => (
        <div
          key={`${c.n}-${c.itemId}`}
          data-testid="citation"
          data-item-id={c.itemId}
          data-available={String(c.available)}
        >
          [{c.n}] {c.title} {c.available ? '' : `(${t.unavailable})`}
        </div>
      ))}
      {m.phase === 'streaming' && m.message.role === 'assistant' ? (
        <button type="button" data-testid="stop" onClick={() => void client.threads.stop(m.id)}>
          {t.stopAnswer}
        </button>
      ) : null}
      {m.failure ? <div className="error">{client.t()(aiFailureKey(m.failure.code))}</div> : null}
    </div>
  )
}
