const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Git binary check
function isGitAvailable() {
  try { execSync('git --version', { stdio: 'pipe' }); return true; } catch { return false; }
}
const GIT_OK = isGitAvailable();

function git(cwd) {
  const sg = require('simple-git');
  return sg(cwd);
}

function noGit(res) {
  return res.json({
    ok: false, notInstalled: true,
    error: 'Git not found. Install from https://git-scm.com/download/win and restart.'
  });
}

module.exports = function(WORKSPACE) {
  const router = express.Router();

  // GET /api/git/status?path=...
  router.get('/status', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    const cwd = req.query.path || WORKSPACE;
    try {
      const g = git(cwd);
      const [status, branch] = await Promise.all([g.status(), g.branch()]);
      res.json({
        ok: true,
        branch: branch.current,
        branches: branch.all.filter(b => !b.startsWith('remotes/')),
        remoteBranches: branch.all.filter(b => b.startsWith('remotes/')),
        modified:  status.modified,
        created:   status.created,
        deleted:   status.deleted,
        staged:    status.staged,
        not_added: status.not_added,
        renamed:   status.renamed,
        conflicted: status.conflicted,
        ahead:     status.ahead,
        behind:    status.behind,
        isClean:   status.isClean()
      });
    } catch (e) {
      res.json({ ok: false, error: e.message, notRepo: e.message.includes('not a git') });
    }
  });

  // GET /api/git/stats - repo istatistikleri (commits, branches, tags, contributors)
  router.get('/stats', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const g = git(WORKSPACE);
      const [log, branch, tags] = await Promise.all([
        g.log({ maxCount: 1000 }),
        g.branch(['-a']),
        g.tags()
      ]);
      // Contributors
      const contributors = {};
      log.all.forEach(c => {
        contributors[c.author_name] = (contributors[c.author_name] || 0) + 1;
      });
      res.json({
        ok: true,
        commits: log.total,
        branches: branch.all.filter(b => !b.startsWith('remotes/')).length,
        tags: tags.all.length,
        contributors: Object.entries(contributors)
          .sort((a,b) => b[1]-a[1])
          .slice(0, 10)
          .map(([name, count]) => ({ name, count })),
        latest: log.latest
      });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  router.post('/init', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try { await git(WORKSPACE).init(); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/clone', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const { url, targetPath, branch, sslVerify, username, password } = req.body;
      const dest = path.resolve(WORKSPACE, targetPath || path.basename(url, '.git'));

      // Check dest not already exists
      if (fs.existsSync(dest)) {
        return res.json({ ok: false, error: `Destination already exists: ${dest}` });
      }

      res.json({ ok: true, dest });

      const sg = require('simple-git');
      const env = { ...process.env };
      if (sslVerify === false) env.GIT_SSL_NO_VERIFY = '1';

      // Embed credentials in URL if provided
      let cloneUrl = url;
      if (username && password) {
        try {
          const u = new URL(url);
          u.username = encodeURIComponent(username);
          u.password = encodeURIComponent(password);
          cloneUrl = u.toString();
        } catch {}
      }

      const g = sg().env(env);
      const args = ['--progress'];
      if (branch) args.push('--branch', branch);
      g.clone(cloneUrl, dest, args).catch(e => console.error('[git clone]', e.message));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // GET /api/git/log?limit=20&branch=main&author=x&search=fix
  router.get('/log', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const opts = { maxCount: parseInt(req.query.limit) || 30 };
      if (req.query.branch) opts['--first-parent'] = null;
      const log = await git(WORKSPACE).log(opts);
      let commits = log.all;
      if (req.query.author) commits = commits.filter(c => c.author_name.toLowerCase().includes(req.query.author.toLowerCase()));
      if (req.query.search)  commits = commits.filter(c => c.message.toLowerCase().includes(req.query.search.toLowerCase()));
      res.json({ ok: true, commits, total: log.total });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  router.get('/diff', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const g = git(WORKSPACE);
      let diff;
      if (req.query.staged === 'true') diff = await g.diff(['--staged', ...(req.query.file ? [req.query.file] : [])]);
      else if (req.query.commit)       diff = await g.diff([req.query.commit + '^', req.query.commit]);
      else                             diff = await g.diff([...(req.query.file ? [req.query.file] : [])]);
      res.json({ ok: true, diff });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  router.get('/file-log', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const log = await git(WORKSPACE).log({ file: req.query.file, maxCount: 20 });
      res.json({ ok: true, commits: log.all });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  router.post('/add',      async (req, res) => { if (!GIT_OK) return noGit(res); try { await git(WORKSPACE).add(req.body.files || '.'); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
  router.post('/unstage',  async (req, res) => { if (!GIT_OK) return noGit(res); try { await git(WORKSPACE).reset(['HEAD', req.body.file]); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
  router.post('/discard',  async (req, res) => { if (!GIT_OK) return noGit(res); try { await git(WORKSPACE).checkout([req.body.file]); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });

  router.post('/commit', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const opts = {};
      if (req.body.amend) opts['--amend'] = null;
      // Set author identity if not configured globally
      const author = req.body.author || 'CodeV User';
      const email  = req.body.email  || 'codev@localhost';
      const g = git(WORKSPACE);
      // Configure locally if git config is missing
      try {
        const cfg = await g.listConfig('local');
        const hasName  = cfg.all['user.name'];
        const hasEmail = cfg.all['user.email'];
        if (!hasName)  await g.addConfig('user.name',  author, false, 'local');
        if (!hasEmail) await g.addConfig('user.email', email,  false, 'local');
      } catch {}
      const result = await g.commit(req.body.message || 'Update', undefined, opts);
      res.json({ ok: true, hash: result.commit, summary: result.summary });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/push', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      await git(WORKSPACE).push(req.body.remote || 'origin', req.body.branch || 'HEAD');
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/pull', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const remote = req.body.remote || 'origin';
      const branch = req.body.branch || '';
      const g = git(WORKSPACE);
      let r;
      if (branch) {
        r = await g.pull(remote, branch);
      } else {
        r = await g.pull();
      }
      res.json({ ok: true, summary: r.summary });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/fetch', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try { await git(WORKSPACE).fetch(); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/checkout', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try {
      const g = git(WORKSPACE);
      req.body.create ? await g.checkoutLocalBranch(req.body.branch) : await g.checkout(req.body.branch);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.delete('/branch', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try { await git(WORKSPACE).deleteLocalBranch(req.query.name, req.query.force === 'true'); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.get('/remotes', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try { res.json({ ok: true, remotes: await git(WORKSPACE).getRemotes(true) }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  router.post('/remote/add', async (req, res) => {
    if (!GIT_OK) return noGit(res);
    try { await git(WORKSPACE).addRemote(req.body.name, req.body.url); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/stash',     async (req, res) => { if (!GIT_OK) return noGit(res); try { await git(WORKSPACE).stash(); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });
  router.post('/stash/pop', async (req, res) => { if (!GIT_OK) return noGit(res); try { await git(WORKSPACE).stash(['pop']); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });

  return router;
};
