const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const os        = require('os');
const net       = require('net');

const MODE = process.env.MODE
  || (process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : null)
  || 'client';

const IS_SERVER_MODE = MODE === 'server';
const IS_ELECTRON    = process.env.ELECTRON === '1';

const fileRoutes   = require('./routes/files');
const gitRoutes    = require('./routes/git');
const searchRoutes = require('./routes/search');
const fmtRoutes    = require('./routes/formatter');
const taskRoutes   = require('./routes/tasks');
const authModule   = require('./routes/auth');
const adminRoutes  = require('./routes/admin');
const ldapRoutes   = require('./routes/ldap');
const setupCollab  = require('./ws/collaboration');
const setupWatcher = require('./store/watcher');
const WorkspaceConfig = require('./store/config');

const WORKSPACE = process.env.WORKSPACE || process.cwd();
const wsConfig  = new WorkspaceConfig(WORKSPACE);

if (IS_SERVER_MODE)                      wsConfig.set('mode', 'server');
if (process.env.AUTH_ENABLED === 'true') wsConfig.set('authEnabled', true);
if (process.env.ROOM_PASSWORD)           wsConfig.set('roomPassword', process.env.ROOM_PASSWORD);
if (process.env.SERVER_NAME)             wsConfig.set('serverName',   process.env.SERVER_NAME);
if (process.env.JWT_SECRET)              wsConfig.set('jwtSecret',    process.env.JWT_SECRET);
wsConfig.set('isElectron', IS_ELECTRON);

// ── Find a free port ──────────────────────────
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(findFreePort(startPort + 1)));
    server.listen(startPort, '0.0.0.0', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function start() {
  const preferredPort = parseInt(process.env.PORT || '3030');
  const PORT = await findFreePort(preferredPort);

  if (PORT !== preferredPort) {
    console.log(`[codev] Port ${preferredPort} in use, using ${PORT}`);
  }

  const app    = express();
  const server = http.createServer(app);
  const wss    = new WebSocket.Server({ server });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, '../client/public')));

  const { router: authRouter, requireAuth } = authModule(wsConfig);
  app.use('/api/auth',   authRouter);
  app.use('/api/files',  requireAuth, fileRoutes(WORKSPACE));
  app.use('/api/git',    requireAuth, gitRoutes(WORKSPACE));
  app.use('/api/search', requireAuth, searchRoutes(WORKSPACE));
  app.use('/api/format', requireAuth, fmtRoutes(WORKSPACE));
  app.use('/api/tasks',  requireAuth, taskRoutes(WORKSPACE));

  if (IS_SERVER_MODE) {
    app.use('/api/admin', requireAuth, adminRoutes(wsConfig));
    app.use('/api/ldap',  requireAuth, ldapRoutes(wsConfig));
  }

  app.get('/api/config',         requireAuth, (_, res) => res.json({ ...wsConfig.get(), mode: MODE }));
  app.post('/api/config',        requireAuth, (req, res) => { wsConfig.set(req.body); res.json({ ok: true }); });
  app.get('/api/snippets/:lang', requireAuth, (req, res) => res.json(wsConfig.getSnippets(req.params.lang)));

  // Public info endpoint
  app.get('/api/info', (_, res) => res.json({
    mode: MODE, version: '2.0.0',
    serverName:      wsConfig.get('serverName') || 'CodeV',
    authEnabled:     !!wsConfig.get('authEnabled'),
    hasRoomPassword: !!(wsConfig.get('roomPassword')),
    isElectron:      IS_ELECTRON
  }));

  app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, '../client/public/admin.html')));
  app.get('*',      (_, res) => res.sendFile(path.join(__dirname, '../client/public/index.html')));

  const broadcastAll = setupCollab(wss, WORKSPACE, wsConfig, MODE);
  setupWatcher(WORKSPACE, broadcastAll);

  server.listen(PORT, '0.0.0.0', () => {
    if (IS_ELECTRON) {
      process.send && process.send({ type: 'server-ready', port: PORT });
      console.log(`[codev] Server ready on port ${PORT}`);
      return;
    }
    const ips = [];
    Object.values(os.networkInterfaces()).forEach(iface =>
      iface?.forEach(a => { if (a.family === 'IPv4' && !a.internal) ips.push(a.address); })
    );
    const modeLabel = IS_SERVER_MODE ? 'ENTERPRISE SERVER' : 'P2P CLIENT HOST';
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║  CodeV v2 — ${modeLabel.padEnd(28)}║`);
    console.log(`╠══════════════════════════════════════════╣`);
    console.log(`║  Local:   http://localhost:${PORT}            ║`);
    ips.forEach(ip => console.log(`║  Network: http://${ip}:${PORT}`.padEnd(44) + '║'));
    if (IS_SERVER_MODE) console.log(`║  Admin:   http://localhost:${PORT}/admin      ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);

    // Write port to temp file so Electron can read it
    if (process.env.PORT_FILE) {
      require('fs').writeFileSync(process.env.PORT_FILE, String(PORT));
    }
  });

  return PORT;
}

start().catch(e => { console.error('[codev] Failed to start:', e.message); process.exit(1); });
