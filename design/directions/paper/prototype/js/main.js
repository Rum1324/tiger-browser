/* Screen assembly. Each screen is the base state plus a few overrides. */
;(() => {
  const V = window.VIEWS
  const W = window.WEB
  const T = window.DATA.tabs

  const base = () => ({
    active: 'pitch',
    shared: ['pitch', 'cap', 'market'],
    local: ['slack', 'news'],
    sharedInfo: { pitch: T.pitch.shared, cap: T.cap.shared, market: T.market.shared },
    items: 41, // items in the Space
    dirty: false, // the pitch has edits newer than its shared edition
    panel: false,
    attach: false,
    streaming: false, // the model is still writing
    overlay: null, // 'share' | 'palette' | 'blocked'
    drag: null, // id of the tab being dragged across the line
    inking: null, // 'draw' while the margin rule is being drawn, 'done' right after
    firstRun: false,
    theme: 'light',
  })

  const newsShared = (s) => ({
    ...s,
    active: 'news',
    shared: ['pitch', 'cap', 'market', 'news'],
    local: ['slack'],
    items: 42,
    sharedInfo: { ...s.sharedInfo, news: { by: 'hayase', ed: 1, when: 'たった今' } },
  })
  const home = (s) => ({
    ...s,
    active: 'home',
    sharedInfo: { ...s.sharedInfo, pitch: { by: 'hayase', ed: 3, when: '3分前' }, cap: { ...T.cap.shared, when: '57分前' } },
  })

  const SCREENS = {
    '01-browse': (s) => s,
    '02-sidepanel-chat': (s) => ({ ...s, panel: true }),
    '03-share-preview': (s) => ({ ...s, dirty: true, overlay: 'share' }),
    '04-space-home': home,
    '05-blocked-private': (s) => ({ ...s, active: 'bank', local: ['bank', 'mail', 'slack'], overlay: 'blocked' }),
    '06-first-run': (s) => ({ ...s, firstRun: true }),
    '07-dark': (s) => ({ ...home(s), theme: 'dark' }),
    '08-command': (s) => ({ ...s, active: 'news', overlay: 'palette' }),
    '09-signature-a': (s) => ({ ...s, active: 'news', drag: 'news' }),
    '09-signature-b': (s) => ({ ...newsShared(s), inking: 'draw' }),
    '09-signature-c': (s) => newsShared(s),
    '10-attach-on': (s) => ({ ...s, panel: true, attach: true }),
    '11-streaming': (s) => ({ ...s, panel: true, streaming: true }),
  }

  const q = new URLSearchParams(location.search)
  const name = q.get('screen') || '01-browse'
  const s = (SCREENS[name] || SCREENS['01-browse'])(base())
  if (q.get('theme')) s.theme = q.get('theme')
  document.documentElement.dataset.theme = s.theme

  let content = ''
  if (s.firstRun) content = V.firstRun()
  else if (s.active === 'home') content = V.spaceHome()
  else if (s.active === 'pitch') content = W.docs({ v3: s.dirty })
  else if (s.active === 'news') content = W.news()
  else if (s.active === 'bank') content = W.bank()

  let overlay = ''
  if (s.overlay === 'share') overlay = V.sheetShare()
  if (s.overlay === 'palette') overlay = V.palette()
  if (s.overlay === 'blocked') overlay = V.popBlocked() + V.privateWindow()

  document.getElementById('app').innerHTML = `
<div class="window" data-screen="${name}">
  ${V.side(s)}
  <div class="main">
    ${V.bar(s)}
    <div class="stage${s.panel ? ' has-panel' : ''}">
      ${V.gutter(s)}
      <div class="page">${content}</div>
      ${s.panel ? V.panelAsk(s) : ''}
    </div>
  </div>
  <div class="overlay">${overlay}</div>
  ${V.dragLayer(s)}
</div>`
  document.title = `Tiger — Paper — ${name}`
})()
