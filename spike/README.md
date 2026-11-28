# Tiger Electron 検証スパイク (約5分)
準備: Node.js 22.12 以上 (`node -v` で確認、無ければ https://nodejs.org の LTS を入れる)。
起動: ターミナルで `cd spike && npm install && npm start` (初回は Electron を自動ダウンロード、1〜2分)。
画面右のチェックリストを上から順に: 「開く」→ 実際に操作 → Pass / Fail / Skip、気づいたことをメモ欄へ。
最優先は「Google にログイン」「Google ドキュメント」「Markdown 書き出し」の3つ。時間が無ければ他は Skip で可。
「ログインできませんでした」等のブロック画面は自動検出され、Fail と URL が記録されます。
「ログインが残る」: Cmd+Q で終了 → もう一度 `npm start` → 「開く」。
既定は Electron 本来の User-Agent です (2026-11-28 に変更: Chrome 風の User-Agent は Google に拒否されることを実測)。
比較用: `SPIKE_UA=chrome-like npm start` で拒否を再現できます (別プロファイルなのでログインはやり直し)。
結果は自動保存: `spike/spike-report.md` (と同じ場所の spike-report.json)。
この spike-report.md の中身をそのまま貼り付けて送ってください (パネル下の「Markdown をコピー」でも可)。
パスワードやメールアドレスはレポートに記録されません (メモ欄に書かないでください)。
