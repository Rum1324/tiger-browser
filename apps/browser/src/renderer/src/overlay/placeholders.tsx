import type { EngineBridge } from '@tiger/shared'
import { useEffect, useMemo } from 'react'
import type { CommandDescriptor } from '../app/commands'
import { createPaletteModel, type PaletteRow } from '../features/palette'
import type { Translate } from '../i18n'
import { useStore } from '../lib/store'
import { useOverlaySurface } from './OverlayRoot'
import type { OverlaySurfaceName } from './surfaces'

/**
 * Plain stand-ins for the overlay surfaces until the designed components register: just enough
 * markup to drive the protocol by hand and in tests. Not styled on purpose.
 */
export function Placeholder({
  name,
  t,
  bridge,
}: {
  name: OverlaySurfaceName
  t: Translate
  bridge: Pick<EngineBridge, 'invoke'>
}) {
  if (name === 'palette') return <PalettePlaceholder t={t} bridge={bridge} />
  if (name === 'confirm') return <ConfirmPlaceholder t={t} />
  if (name === 'menu') return <MenuPlaceholder />
  return <GenericPlaceholder name={name} t={t} />
}

function GenericPlaceholder({ name, t }: { name: OverlaySurfaceName; t: Translate }) {
  const api = useOverlaySurface()
  return (
    <div data-testid={`overlay-${name}`}>
      <p>{name}</p>
      <button type="button" onClick={() => api.dismiss('closed')}>
        {t('common.close')}
      </button>
    </div>
  )
}

function ConfirmPlaceholder({ t }: { t: Translate }) {
  const api = useOverlaySurface('confirm')
  const p = api.props
  return (
    <div data-testid="overlay-confirm">
      <p>{t(p.title.key, p.title.vars)}</p>
      {p.subject ? <p>{p.subject}</p> : null}
      <p>{t(p.body.key, p.body.vars)}</p>
      <button type="button" onClick={() => api.dismiss('closed')}>
        {t('common.cancel')}
      </button>
      <button type="button" data-testid="confirm-ok" onClick={() => api.resolve(true)}>
        {t(p.confirm.key, p.confirm.vars)}
      </button>
    </div>
  )
}

function MenuPlaceholder() {
  const api = useOverlaySurface('menu')
  return (
    <div role="menu" data-testid="overlay-menu">
      {api.props.items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => api.resolve(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function PalettePlaceholder({ t, bridge }: { t: Translate; bridge: Pick<EngineBridge, 'invoke'> }) {
  const api = useOverlaySurface('palette')
  const labelOf = (c: CommandDescriptor) => t(c.label.key, c.label.vars)
  // biome-ignore lint/correctness/useExhaustiveDependencies: one model per opened palette
  const model = useMemo(() => createPaletteModel({ bridge, props: api.props, labelOf }), [api.id])
  useEffect(() => () => model.dispose(), [model])
  const state = useStore(model.store, (s) => s)
  const label = (r: PaletteRow) => (r.kind === 'command' ? labelOf(r.command) : r.suggestion.title)
  return (
    <div data-testid="overlay-palette">
      <input
        data-autofocus=""
        data-testid="palette-input"
        aria-label={t('palette.label')}
        placeholder={t(api.props.mode === 'history' ? 'palette.historyPlaceholder' : 'palette.placeholder')}
        value={state.query}
        onChange={(e) => model.setQuery(e.target.value)}
        onKeyDown={(e) => {
          const r = model.handleKey(e.key)
          if (!r.handled) return
          e.preventDefault()
          if (r.choice) api.resolve(r.choice)
        }}
      />
      <ul role="listbox">
        {state.rows.map((row, i) => (
          <li
            key={row.kind === 'command' ? row.command.id : `${row.group}:${row.suggestion.url}`}
            role="option"
            aria-selected={i === state.selected}
            data-row-kind={row.kind}
            onPointerDown={(e) => {
              e.preventDefault()
              model.select(i)
              const c = model.choice()
              if (c) api.resolve(c)
            }}
          >
            {label(row)}
          </li>
        ))}
      </ul>
      {state.rows.length === 0 ? <p>{t('palette.empty')}</p> : null}
    </div>
  )
}
