import type { Dictionary } from './keys'

/** Japanese is the primary market: short, plain, です/ます. */
export const ja: Dictionary = {
  'error.invalid_request': '入力内容に誤りがあります。確認してもう一度お試しください。',
  'error.unauthenticated': 'サインインが切れました。もう一度サインインしてください。',
  'error.forbidden':
    'この操作の権限がありません。必要な場合はスペースのオーナーに依頼してください。',
  'error.not_found': '見つかりません。削除された可能性があります。更新してもう一度お試しください。',
  'error.space_not_found': 'スペースが見つかりません。別のスペースを選んでください。',
  'error.item_not_found':
    '共有アイテムが見つかりません。共有が解除された可能性があります。一覧を更新してください。',
  'error.thread_not_found':
    'スレッドが見つかりません。削除された可能性があります。一覧を更新してください。',
  'error.invite_not_found':
    '招待が見つかりません。リンクを確認するか、新しい招待を依頼してください。',
  'error.invite_expired': '招待の期限が切れています。オーナーに新しい招待を依頼してください。',
  'error.invite_revoked': 'この招待は取り消されました。オーナーに新しい招待を依頼してください。',
  'error.invite_used': 'この招待はすでに使われています。オーナーに新しい招待を依頼してください。',
  'error.invite_email_mismatch':
    'この招待は別のメールアドレス宛てです。そのアドレスでサインインするか、新しい招待を依頼してください。',
  'error.member_not_found': 'メンバーが見つかりません。メンバー一覧を更新してください。',
  'error.last_owner':
    'スペースにはオーナーが 1 人以上必要です。先に別のメンバーをオーナーにしてください。',
  'error.capture_blocked': 'このページは共有できません。別のページを共有してください。',
  'error.attachments_not_allowed':
    'スペースのスレッドにはページを添付できません。ページはスペースに共有してください。',
  'error.already_shared': 'すでに共有されています。スペースの一覧から開けます。',
  'error.thread_has_private_attachments':
    'ページを添付した質問ごとに、共有するかどうかを選んでください。その後に添付されたページがあるかもしれません。共有をもう一度開いてください。',
  'error.budget_exceeded':
    'このスペースは今月の AI 利用上限に達しました。上限の変更はオーナーに依頼してください。',
  'error.model_unavailable': 'このモデルは今使えません。別のモデルを選んでください。',
  'error.ai_unavailable': 'このサーバーでは今 AI を使えません。しばらくしてからお試しください。',
  'error.dev_login_disabled': '開発用ログインは無効です。Google でサインインしてください。',
  'error.google_auth_unavailable':
    'このサーバーでは Google サインインが設定されていません。管理者に問い合わせてください。',
  'error.google_token_invalid': 'Google サインインに失敗しました。もう一度お試しください。',
  'error.rate_limited': '操作が多すぎます。少し待ってからお試しください。',
  'error.payload_too_large':
    'データが大きすぎて送れません。文章を短くするか、ページを減らしてください。',
  'error.contract_violation': 'サーバーの応答が想定と異なります。アプリを更新してください。',
  'error.internal': 'サーバーでエラーが起きました。しばらくしてからお試しください。',
  'error.network': 'サーバーに接続できません。ネットワークを確認してください。',
  'error.aborted': '中止しました。',
  'error.send_failed': '送信できませんでした。もう一度送れます。',
  'error.attachment_unconfirmed':
    'AIの提供元が変わりました。添付したページを新しい提供元に送ってよいか、もう一度確認してください。',

  'capture.reason.incognito': 'プライベートウィンドウのページは共有できません。',
  'capture.reason.scheme': 'このページは共有できません。',
  'capture.reason.banking': '金融サービスのページは共有できません。',
  'capture.reason.email': 'メールのページは共有できません。',
  'capture.reason.password-manager': 'パスワード管理のページは共有できません。',
  'capture.reason.auth': 'ログインやアカウントのページは共有できません。',
  'capture.reason.government-id': '行政手続きのページは共有できません。',
  'capture.reason.local-network': '社内やローカルのアドレスは共有できません。',
  'capture.reason.user-rule': 'あなたが共有しない設定にしたサイトです。',

  'capture.error.blocked': 'このページは共有できません。',
  'capture.error.empty': '読み取れる本文がありません。',
  'capture.error.no-text-layer': '文字を読み取れない PDF です。',
  'capture.error.failed': 'ページを読み取れませんでした。',
  'capture.error.no-tab': 'タブが見つかりません。',

  'connection.offline': 'オフラインです。',
  'connection.connecting': '接続しています…',
  'connection.online': '接続しました。',
  'connection.reconnecting': '再接続しています…',
  'connection.unauthorized': 'もう一度サインインしてください。',

  'share.outcome.new': 'スペースに共有しました。',
  'share.outcome.version': '新しい版として共有しました。',
  'share.outcome.unchanged': '内容は前回の共有から変わっていません。',
  'share.stale.fresh': '共有済みの内容は最新です。',
  'share.stale.stale': 'ページが共有後に更新されています。',
  'share.stale.not-shared': 'このページはまだ共有されていません。',
  'share.noSpace': '共有先のスペースを選んでください。',
  'shareThread.notPrivate': 'スペースに共有できるのは、自分のプライベートスレッドだけです。',
  'shareThread.nothingToShare': 'すべて除外されているため、共有する内容がありません。',
  'shareThread.decide':
    'この質問にはページが添付されています。回答と一緒に共有するか、両方とも除外するかを選んでください。ページ自体は共有されません。',
  'shareThread.done':
    '新しいスレッドとしてスペースに共有しました。プライベートスレッドはそのままです。',

  'ai.ai_aborted': '回答を中止しました。続きが必要な場合はもう一度質問してください。',
  'ai.ai_failed': '回答を作れませんでした。もう一度質問してください。',
  'ai.ai_interrupted': 'サーバーの再起動で回答が途中で止まりました。もう一度質問してください。',
  'ai.ai_refused': 'AI がこの質問への回答を断りました。質問の言い方を変えてお試しください。',
  'ai.ai_unavailable': 'AI を今使えません。しばらくしてからお試しください。',
  'ai.ai_busy': 'AI が混み合っています。少し待ってからお試しください。',
  'ai.ai_context_too_long':
    '内容が長すぎて回答できません。新しいスレッドで質問するか、添付するページを減らしてください。',
  'ai.ai_timeout': '回答に時間がかかりすぎました。もう一度質問してください。',
  'ai.model_unavailable': 'このモデルは今使えません。別のモデルを選んで質問してください。',
  'ai.budget_exceeded':
    'このスペースは今月の AI 利用上限に達しました。上限の変更はオーナーに依頼してください。',

  'attach.notAllowed': 'スペースのスレッドにはページを添付できません。',
  'attach.limit': '添付できるのは 1 回に 3 ページまでです。',

  'export.google.not-configured': 'Google ドキュメントへの書き出しは設定されていません。',
  'export.google.not-connected': 'Google アカウントに接続してください。',
  'export.google.denied': 'Google へのアクセスが許可されませんでした。',
  'export.google.failed': 'Google ドキュメントを作れませんでした。',
  'google.flow.not-configured': 'このブラウザでは Google ログインが設定されていません。',
  'google.flow.denied': 'Google へのアクセスが許可されませんでした。',
  'google.flow.timeout': 'Google ログインがタイムアウトしました。もう一度お試しください。',
  'google.flow.cancelled': 'Google ログインをキャンセルしました。',
  'google.flow.failed': 'Google ログインに失敗しました。もう一度お試しください。',
  'invite.opened': 'スペースへの招待を開きました。参加するには「参加」を押してください。',
  'export.recordFailed': '書き出しましたが、記録を残せませんでした。',
  'export.sourcesHeading': '出典',

  'provider.sendsTo': '内容は {company} に送られます。',
  'provider.local': 'テスト用のモデルです。外部には送られません。',
}
