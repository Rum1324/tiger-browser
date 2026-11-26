/**
 * Chromium's own UA shape: no app-name or Electron token, version reduced to <major>.0.0.0.
 * Google serves its normal sign-in flow to this shape and a reduced flow to the Electron default
 * (docs/research/google-signin-spike.md).
 */
export function chromeLikeUserAgent(electronUa: string): string {
  return electronUa
    .replace(/\(KHTML, like Gecko\)\s.*?Chrome\//, '(KHTML, like Gecko) Chrome/')
    .replace(/\sElectron\/\S+/, '')
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0')
}
