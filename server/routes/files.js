const express = require('express');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const mime    = require('mime-types');

function matchesIgnore(name, patterns) {
  return patterns.some(p => {
    if (p.startsWith('**/')) return name.includes(p.slice(3));
    if (p.startsWith('*.'))  return name.endsWith(p.slice(1));
    return name === p || name.startsWith(p + '/');
  });
}

const DEFAULT_IGNORE = [
  'node_modules','.git','.DS_Store','Thumbs.db',
  '__pycache__','.pytest_cache','.mypy_cache',
  'dist','build','.next','.nuxt','out',
  'coverage','.nyc_output',
  '*.pyc','*.pyo','*.class','*.o','*.a','*.so',
  '*.log','*.tmp','*.temp',
  '.env.local','.env.production',
];

function loadGitIgnore(dir) {
  try {
    return fs.readFileSync(path.join(dir,'.gitignore'),'utf-8')
      .split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  } catch { return []; }
}

module.exports = function(DEFAULT_WORKSPACE) {

  function getWorkspace(req) {
    const ws = req.headers['x-workspace'];
    if (ws && fs.existsSync(ws)) return ws;
    return DEFAULT_WORKSPACE;
  }

  const router = express.Router();

  function safePath(workspace, rel) {
    if (!rel && rel !== '') return workspace;
    if (path.isAbsolute(rel)) {
      if (fs.existsSync(rel)) return rel;
      return null;
    }
    return path.resolve(workspace, rel);
  }

  // GET /api/files/tree?path=subdir
  router.get('/tree', (req, res) => {
    const workspace = getWorkspace(req);
    try {
      const dir = safePath(workspace, req.query.path || '');
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        return res.json({ items: [], error: 'Not a directory' });

      const ignorePatterns = [...DEFAULT_IGNORE, ...loadGitIgnore(dir)];
      const items = fs.readdirSync(dir, { withFileTypes: true })
        .filter(i => !matchesIgnore(i.name, ignorePatterns))
        .map(i => {
          let size = 0;
          try { if (i.isFile()) size = fs.statSync(path.join(dir,i.name)).size; } catch {}
          return {
            name: i.name,
            path: req.query.path ? path.join(req.query.path,i.name).replace(/\\/g,'/') : i.name,
            type: i.isDirectory() ? 'dir' : 'file',
            ext:  i.isFile() ? path.extname(i.name).slice(1).toLowerCase() : null,
            size
          };
        })
        .sort((a,b) => a.type!==b.type ? (a.type==='dir'?-1:1) : a.name.localeCompare(b.name));
      res.json({ items, workspace });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // GET /api/files/read?path=file.js
  router.get('/read', (req, res) => {
    const workspace = getWorkspace(req);
    try {
      const full = safePath(workspace, req.query.path);
      if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
      const stat = fs.statSync(full);
      if (stat.size > 10*1024*1024) return res.status(413).json({ error: 'File too large (>10MB)' });
      const content = fs.readFileSync(full, 'utf-8');
      res.json({ content, mtime: stat.mtimeMs });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/files/write  { path, content }
  router.post('/write', (req, res) => {
    const workspace = getWorkspace(req);
    try {
      const full = safePath(workspace, req.body.path);
      if (!full) return res.status(400).json({ error: 'Invalid path' });
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, req.body.content, 'utf-8');
      res.json({ ok: true, mtime: fs.statSync(full).mtimeMs });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/files/create  { path, type }
  router.post('/create', (req, res) => {
    const workspace = getWorkspace(req);
    try {
      const full = safePath(workspace, req.body.path);
      if (!full) return res.status(400).json({ error: 'Invalid path' });
      if (req.body.type === 'dir') {
        fs.mkdirSync(full, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        if (!fs.existsSync(full)) fs.writeFileSync(full, '', 'utf-8');
      }
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/files/rename  { oldPath, newPath }
  router.post('/rename', (req, res) => {
    const workspace = getWorkspace(req);
    try {
      const oldFull = safePath(workspace, req.body.oldPath);
      const newFull = safePath(workspace, req.body.newPath);
      if (!oldFull || !newFull) return res.status(400).json({ error: 'Invalid path' });
      if (!fs.existsSync(oldFull)) return res.status(404).json({ error: 'Source not found' });
      fs.mkdirSync(path.dirname(newFull), { recursive: true });
      fs.renameSync(oldFull, newFull);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // DELETE /api/files/delete?path=
  router.delete('/delete', (req, res) => {
    const workspace = getWorkspace(req);
    try {
      const full = safePath(workspace, req.query.path);
      if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
      fs.statSync(full).isDirectory()
        ? fs.rmSync(full, { recursive: true, force: true })
        : fs.unlinkSync(full);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // POST /api/files/open-folder  { path }
  router.post('/open-folder', (req, res) => {
    try {
      const p = req.body.path;
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory())
        return res.status(404).json({ error: 'Path not found or not a directory' });
      res.json({ ok: true, path: p });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // GET /api/files/workspaces
  router.get('/workspaces', (req, res) => {
    const workspace = getWorkspace(req);
    const home = os.homedir();
    const candidates = [
      workspace, home,
      path.join(home,'Documents'), path.join(home,'Projects'),
      path.join(home,'Desktop'),   path.join(home,'repos'),
      path.join(home,'dev'),       path.join(home,'code'),
      '/var/www', '/srv', '/opt', '/mnt',
    ];
    const suggestions = candidates.filter(p => {
      try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
    });
    res.json({ current: workspace, suggestions: [...new Set(suggestions)] });
  });

  // GET /api/files/drives  — Windows drive list
  router.get('/drives', (req, res) => {
    if (process.platform !== 'win32') return res.json({ drives: [] });
    try {
      const { execSync } = require('child_process');
      const out    = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
      const drives = out.split('\n').map(l=>l.trim()).filter(l=>/^[A-Z]:$/.test(l));
      res.json({ drives });
    } catch { res.json({ drives: ['C:'] }); }
  });

  // GET /api/files/raw?path=image.png
  router.get('/raw', (req, res) => {
    const workspace = getWorkspace(req);
    try {
      const full = safePath(workspace, req.query.path);
      if (!full || !fs.existsSync(full)) return res.status(404).send('Not found');
      const mimeType = mime.lookup(full) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=60');
      fs.createReadStream(full).pipe(res);
    } catch (e) { res.status(400).send(e.message); }
  });

  return router;
};
