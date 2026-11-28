# Day-1 spike result: Google refuses sign-in from the Electron shell

Run by the founder on 2026-11-28 on macOS 26.6.2 (arm64) with `spike/` at Electron 45.5.0 / Chromium
156.0.8078.109. Account identifiers and session tokens are removed from the URLs below.

## What was measured

| Check | Result |
| --- | --- |
| Google sign-in, UA mode `chrome-like` | **Blocked.** Google answered with `accounts.google.com/v3/signin/rejected?flowName=GlifWebSignIn&rrk=46`, the page "This browser or app may not be secure". |
| Google Docs: new document | Blocked by the same page (redirected to sign-in, then rejected). |
| Every other check | Not run. |

- User-Agent sent (header and `navigator.userAgent`): `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`
- `Sec-CH-UA` brands: `"Not:A-Brand";v="8", "Chromium";v="156"` (no Google Chrome brand).
- The rejection arrived after the account identifier was entered and before any password step.
- No Google cookie existed at launch: this was a first sign-in on a clean profile.

## What it means

- Removing the `Electron/x` token from the User-Agent is not enough. Google identifies the shell by
  something else (the brand list, the shape of `window.chrome`, or other script-visible properties);
  which one is unknown.
- Not yet measured: the other two modes of the spike (`SPIKE_UA=firefox-google`, which sends a Firefox
  User-Agent to accounts.google.com only, as the Min browser does; and `SPIKE_UA=electron-default`).
- `docs/HANDOFF.md` section 6 states the consequence: "If blocked, that decides the engine question
  toward a Chromium fork early."

## Correction to the spike

The first version of the spike recorded full URLs, and Google's rejection URL carries the account's
email address in a query parameter. The README said no email address would be recorded; that was wrong.
The spike now keeps only the origin, the path and the parameters that describe the flow.
