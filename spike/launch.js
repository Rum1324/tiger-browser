#!/usr/bin/env node
'use strict';
// `npm start`: launches the spike. On Linux we add --no-sandbox, because Chromium's sandbox
// needs either root-owned SUID chrome-sandbox or unprivileged user namespaces, which a plain
// `npm install` does not set up (and it refuses to run as root at all). macOS needs nothing.
const { spawn } = require('node:child_process');
const electronPath = require('electron');
const args = [__dirname, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...process.argv.slice(2)];
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('close', (code, signal) => process.exit(code === null ? 1 : code));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
