const express = require('express');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

module.exports = function(wsConfig) {
  const router = express.Router();
  const DATA_DIR = path.join(__dirname, '../../data');
  const USERS_FILE = path.join(DATA_DIR, 'users.json');

  function loadUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch { return {}; }
  }
  function saveUsers(users) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }

  // Admin middleware — only admins
  router.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });

  // GET /api/admin/stats — server metrics
  router.get('/stats', (req, res) => {
    const uptime  = process.uptime();
    const mem     = process.memoryUsage();
    const cpus    = os.cpus();
    const users   = loadUsers();

    res.json({
      ok: true,
      uptime,
      uptimeHuman: formatUptime(uptime),
      memory: {
        used:  Math.round(mem.heapUsed  / 1024 / 1024),
        total: Math.round(mem.heapTotal / 1024 / 1024),
        rss:   Math.round(mem.rss       / 1024 / 1024),
      },
      cpu: {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
        load:  os.loadavg()
      },
      system: {
        platform: os.platform(),
        arch:     os.arch(),
        hostname: os.hostname(),
        freemem:  Math.round(os.freemem()  / 1024 / 1024),
        totalmem: Math.round(os.totalmem() / 1024 / 1024),
      },
      users: Object.keys(users).length,
      version: '2.0.0',
      mode: wsConfig.get('mode') || 'server',
      nodeVersion: process.version,
    });
  });

  // GET /api/admin/users — list all users
  router.get('/users', (req, res) => {
    const users = loadUsers();
    const list  = Object.values(users).map(u => ({
      username:    u.username,
      displayName: u.displayName,
      role:        u.role,
      createdAt:   u.createdAt,
      lastLogin:   u.lastLogin || null,
    }));
    res.json({ ok: true, users: list });
  });

  // POST /api/admin/users/:username/role  { role }
  router.post('/users/:username/role', (req, res) => {
    const users = loadUsers();
    const u = users[req.params.username];
    if (!u) return res.status(404).json({ error: 'User not found' });
    u.role = req.body.role === 'admin' ? 'admin' : 'member';
    saveUsers(users);
    res.json({ ok: true });
  });

  // DELETE /api/admin/users/:username
  router.delete('/users/:username', (req, res) => {
    if (req.params.username === req.user.username) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    const users = loadUsers();
    if (!users[req.params.username]) return res.status(404).json({ error: 'Not found' });
    delete users[req.params.username];
    saveUsers(users);
    res.json({ ok: true });
  });

  // POST /api/admin/users/:username/reset-password  { newPassword }
  router.post('/users/:username/reset-password', async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password too short' });
    const bcrypt = require('bcryptjs');
    const users  = loadUsers();
    const u = users[req.params.username];
    if (!u) return res.status(404).json({ error: 'User not found' });
    u.hash = await bcrypt.hash(newPassword, 10);
    saveUsers(users);
    res.json({ ok: true });
  });

  // GET /api/admin/sessions — active WS sessions (injected from collaboration)
  router.get('/sessions', (req, res) => {
    const sessions = wsConfig.get('_activeSessions') || [];
    res.json({ ok: true, sessions, count: sessions.length });
  });

  // GET /api/admin/config — get server config
  router.get('/config', (req, res) => {
    const cfg = wsConfig.get();
    // Don't leak sensitive values
    const safe = { ...cfg };
    delete safe.jwtSecret;
    delete safe.roomPassword;
    delete safe._activeSessions;
    res.json({ ok: true, config: safe });
  });

  // POST /api/admin/config — update server config
  router.post('/config', (req, res) => {
    const allowed = ['serverName','authEnabled','maxUsers','sessionTimeout','allowGuestAccess'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    wsConfig.set(update);
    res.json({ ok: true });
  });

  // POST /api/admin/config/room-password
  router.post('/config/room-password', (req, res) => {
    wsConfig.set('roomPassword', req.body.password || '');
    res.json({ ok: true });
  });

  // POST /api/admin/kick/:userId — disconnect a user
  router.post('/kick/:userId', (req, res) => {
    const sessions = wsConfig.get('_kickFn');
    if (typeof sessions === 'function') {
      sessions(req.params.userId);
      res.json({ ok: true });
    } else {
      res.json({ ok: false, error: 'Kick function not registered' });
    }
  });

  return router;
};

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}
