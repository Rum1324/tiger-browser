import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

interface XTestExt {
  MotionNotify: number
  ButtonPress: number
  ButtonRelease: number
  FakeInput(type: number, detail: number, time: number, wid: number, x: number, y: number): void
}
interface XClient {
  require(name: 'xtest', cb: (err: Error | null, ext: XTestExt) => void): void
  GetInputFocus(cb: (err: Error | null) => void): void
  terminate(): void
}
interface XDisplay {
  client: XClient
  screen: { root: number }[]
}

/**
 * A real pointer click at screen coordinates through the X server (XTest), so it goes through the
 * OS hit-testing between native views. Playwright's page.mouse targets one webContents directly and
 * cannot show which view a click lands on.
 */
export function xClick(x: number, y: number): Promise<void> {
  const x11 = require('x11') as { createClient(cb: (err: Error | null, d: XDisplay) => void): void }
  return new Promise((resolve, reject) => {
    x11.createClient((err, display) => {
      if (err) return reject(err)
      const X = display.client
      const root = display.screen[0]?.root ?? 0
      X.require('xtest', (e, t) => {
        if (e) return reject(e)
        const px = Math.round(x)
        const py = Math.round(y)
        t.FakeInput(t.MotionNotify, 0, 0, root, px, py)
        t.FakeInput(t.ButtonPress, 1, 0, root, 0, 0)
        t.FakeInput(t.ButtonRelease, 1, 0, root, 0, 0)
        // A round trip guarantees the server processed the events before the connection closes.
        X.GetInputFocus(() => {
          X.terminate()
          resolve()
        })
      })
    })
  })
}
