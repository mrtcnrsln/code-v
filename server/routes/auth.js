const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');

const DATA_DIR   = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function getSecret(wsConfig) {
  return wsConfig.get('jwtSecret') || process.env.JWT_SECRET || 'codev_default_secret_change_me';
}
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch { return {}; }
}
function saveUsers(u) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
}

module.exports = function(wsConfig) {
  const router = express.Router();

  function makeToken(payload) {
    return jwt.sign(payload, getSecret(wsConfig), { expiresIn: '30d' });
  }

  function requireAuth(req, res, next) {
    if (!wsConfig.get('authEnabled')) {
      req.user = { username: 'guest', displayName: 'Guest', role: 'member' };
      return next();
    }
    const header = req.headers['authorization'];
    const token  = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try { req.user = jwt.verify(token, getSecret(wsConfig)); next(); }
    catch { res.status(401).json({ error: 'Token invalid or expired' }); }
  }

  // GET /api/auth/config — public, no auth needed
  router.get('/config', (req, res) => {
    res.json({
      authEnabled:     !!wsConfig.get('authEnabled'),
      hasRoomPassword: !!(wsConfig.get('roomPassword')),
      serverName:      wsConfig.get('serverName') || 'CodeV',
      mode:            wsConfig.get('mode') || 'client',
    });
  });

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    if (!wsConfig.get('authEnabled')) {
      const displayName = (req.body.displayName || 'Guest').slice(0, 32);
      return res.json({ ok: true, token: makeToken({ username: displayName, displayName, role: 'member' }), user: { displayName, role: 'member' } });
    }
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    // Try LDAP
    const ldapCfg = wsConfig.get('ldap') || {};
    if (ldapCfg.enabled) {
      try {
        const { getProvider } = require('./ldap');
        const ldapUser = await getProvider(wsConfig).authenticate(username, password);
        if (ldapUser) {
          const token = makeToken({ username, displayName: ldapUser.displayName, role: ldapUser.isAdmin ? 'admin' : 'member', source: 'ldap' });
          return res.json({ ok: true, token, user: { username, displayName: ldapUser.displayName, role: ldapUser.isAdmin ? 'admin' : 'member' } });
        }
      } catch (e) { console.error('[auth] LDAP error:', e.message); }
    }

    // Local
    const users = loadUsers();
    const user  = users[username];
    if (!user?.hash) return res.status(401).json({ error: 'Invalid credentials' });
    if (!await bcrypt.compare(password, user.hash)) return res.status(401).json({ error: 'Invalid credentials' });
    users[username].lastLogin = Date.now();
    saveUsers(users);
    res.json({ ok: true, token: makeToken({ username, displayName: user.displayName, role: user.role }), user: { username, displayName: user.displayName, role: user.role } });
  });

  // POST /api/auth/register
  router.post('/register', async (req, res) => {
    if (!wsConfig.get('authEnabled')) return res.json({ ok: true });
    const { username, password, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const users = loadUsers();
    if (users[username]) return res.status(409).json({ error: 'Username already taken' });
    users[username] = { username, hash: await bcrypt.hash(password, 10), displayName: (displayName || username).slice(0, 32), role: Object.keys(users).length === 0 ? 'admin' : 'member', createdAt: Date.now() };
    saveUsers(users);
    res.json({ ok: true, token: makeToken({ username, displayName: users[username].displayName, role: users[username].role }), user: { username, displayName: users[username].displayName, role: users[username].role } });
  });

  // POST /api/auth/join — room password gate
  router.post('/join', async (req, res) => {
    const roomPw = wsConfig.get('roomPassword') || '';
    // If room password is set, it MUST match — even on same machine
    if (roomPw) {
      if (!req.body.password || req.body.password !== roomPw) {
        return res.status(403).json({ ok: false, error: 'Wrong room password' });
      }
    }
    const name = (req.body.displayName || 'Guest').slice(0, 32);
    res.json({ ok: true, token: makeToken({ username: name, displayName: name, role: 'member', source: 'guest' }), user: { displayName: name, role: 'member' } });
  });

  // GET /api/auth/verify
  router.get('/verify', (req, res) => {
    const token = req.headers['authorization']?.slice(7);
    if (!token) return res.json({ ok: false });
    try { res.json({ ok: true, user: jwt.verify(token, getSecret(wsConfig)) }); }
    catch { res.json({ ok: false }); }
  });

  return { router, requireAuth };
};
