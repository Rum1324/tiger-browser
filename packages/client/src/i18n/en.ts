import type { Dictionary } from './keys'

export const en: Dictionary = {
  'error.invalid_request':
    'Something in the request is not valid. Check what you entered and try again.',
  'error.unauthenticated': 'You are signed out. Please sign in again.',
  'error.forbidden': 'You do not have permission to do that. Ask a Space owner if you need it.',
  'error.not_found': 'This could not be found. It may have been deleted; refresh and try again.',
  'error.space_not_found':
    'This Space could not be found. It may have been deleted; choose another Space.',
  'error.item_not_found':
    'This shared item could not be found. It may have been unshared; refresh the list.',
  'error.thread_not_found':
    'This thread could not be found. It may have been deleted; refresh the list.',
  'error.invite_not_found':
    'This invite could not be found. Check the link, or ask for a new invite.',
  'error.invite_expired': 'This invite has expired. Ask the Space owner for a new one.',
  'error.invite_revoked': 'This invite was revoked. Ask the Space owner for a new one.',
  'error.invite_used': 'This invite has already been used. Ask the Space owner for a new one.',
  'error.invite_email_mismatch':
    'This invite is for a different email address. Sign in with that address, or ask for a new invite.',
  'error.member_not_found': 'This member could not be found. Refresh the member list.',
  'error.last_owner': 'A Space needs at least one owner. Make another member an owner first.',
  'error.capture_blocked': 'This page cannot be shared. Share a different page instead.',
  'error.attachments_not_allowed':
    'Pages cannot be attached in a Space thread. Share the page to the Space instead.',
  'error.already_shared': 'This is already shared. You can find it in the Space.',
  'error.thread_has_private_attachments':
    'Decide for every question with an attached page whether it is shared. A page may have been attached since; open the share again.',
  'error.budget_exceeded':
    'This Space has reached its AI limit for the month. Ask a Space owner to raise it.',
  'error.model_unavailable': 'This model is not available right now. Choose another model.',
  'error.ai_unavailable': 'AI is not available on this server right now. Please try again later.',
  'error.dev_login_disabled': 'Developer sign-in is turned off. Sign in with Google instead.',
  'error.google_auth_unavailable':
    'Google sign-in is not set up on this server. Ask your administrator.',
  'error.google_token_invalid': 'Google sign-in failed. Please try again.',
  'error.rate_limited': 'Too many attempts. Please wait a moment and try again.',
  'error.payload_too_large': 'This is too large to send. Try a shorter text or fewer pages.',
  'error.contract_violation': 'The server answered in an unexpected way. Please update the app.',
  'error.internal': 'Something went wrong on the server. Please try again later.',
  'error.network': 'Cannot reach the server. Check your connection.',
  'error.aborted': 'Cancelled.',
  'error.send_failed': "Couldn't send the message. You can send it again.",
  'error.attachment_unconfirmed':
    'The AI provider changed. Confirm again that the attached pages may go to the new provider.',

  'capture.reason.incognito': 'Pages in a private window cannot be shared.',
  'capture.reason.scheme': 'This page cannot be shared.',
  'capture.reason.banking': 'Banking and finance pages cannot be shared.',
  'capture.reason.email': 'Email pages cannot be shared.',
  'capture.reason.password-manager': 'Password manager pages cannot be shared.',
  'capture.reason.auth': 'Sign-in and account pages cannot be shared.',
  'capture.reason.government-id': 'Government service pages cannot be shared.',
  'capture.reason.local-network': 'Local and internal addresses cannot be shared.',
  'capture.reason.user-rule': 'You chose never to share this site.',

  'capture.error.blocked': 'This page cannot be shared.',
  'capture.error.empty': 'There is no readable text on this page.',
  'capture.error.no-text-layer': 'This PDF has no readable text.',
  'capture.error.failed': 'The page could not be read.',
  'capture.error.no-tab': 'The tab could not be found.',

  'connection.offline': 'Offline.',
  'connection.connecting': 'Connecting…',
  'connection.online': 'Connected.',
  'connection.reconnecting': 'Reconnecting…',
  'connection.unauthorized': 'Please sign in again.',

  'share.outcome.new': 'Shared to the Space.',
  'share.outcome.version': 'Shared as a new version.',
  'share.outcome.unchanged': 'Nothing changed since the last share.',
  'share.stale.fresh': 'The shared copy is up to date.',
  'share.stale.stale': 'This page changed after it was shared.',
  'share.stale.not-shared': 'This page is not shared yet.',
  'share.noSpace': 'Choose a Space to share to.',
  'shareThread.notPrivate': 'Only your own private thread can be shared to the Space.',
  'shareThread.nothingToShare': 'Everything is left out, so there is nothing to share.',
  'shareThread.decide':
    'This question had a page attached. Share it with its answers, or leave both out. The page itself is never shared.',
  'shareThread.done': 'Shared to the Space as a new thread. Your private thread is unchanged.',

  'ai.ai_aborted': 'The answer was stopped. Ask again to get a full answer.',
  'ai.ai_failed': 'The answer could not be produced. Please ask again.',
  'ai.ai_interrupted': 'The answer was cut off when the server restarted. Please ask again.',
  'ai.ai_refused': 'The AI declined to answer this. Try rephrasing the question.',
  'ai.ai_unavailable': 'AI is not available right now. Please try again later.',
  'ai.ai_busy': 'The AI is busy. Please try again shortly.',
  'ai.ai_context_too_long':
    'There is too much content to answer. Start a new thread or attach fewer pages.',
  'ai.ai_timeout': 'The answer took too long. Please ask again.',
  'ai.model_unavailable':
    'This model is not available right now. Choose another model and ask again.',
  'ai.budget_exceeded':
    'This Space has reached its AI limit for the month. Ask a Space owner to raise it.',

  'attach.notAllowed': 'Pages cannot be attached in a Space thread.',
  'attach.limit': 'You can attach up to 3 pages per message.',

  'export.google.not-configured': 'Google Docs export is not set up.',
  'export.google.not-connected': 'Connect your Google account first.',
  'export.google.denied': 'Google access was not granted.',
  'export.google.failed': 'The Google Doc could not be created.',
  'google.flow.not-configured': 'Google sign-in is not set up in this browser.',
  'google.flow.denied': 'Google access was not granted.',
  'google.flow.timeout': 'Google sign-in timed out. Please try again.',
  'google.flow.cancelled': 'Google sign-in was cancelled.',
  'google.flow.failed': 'Google sign-in failed. Please try again.',
  'invite.opened': 'You opened an invite to a Space. Press Join to accept it.',
  'export.recordFailed': 'Exported, but the export could not be recorded.',
  'export.sourcesHeading': 'Sources',

  'provider.sendsTo': 'Content is sent to {company}.',
  'provider.local': 'Test model. Nothing is sent outside.',
}
