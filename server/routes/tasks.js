const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';

function spawnShell(cmd, cwd) {
  return spawn(
    IS_WIN ? 'cmd' : 'sh',
    IS_WIN ? ['/c', cmd] : ['-c', cmd],
    { cwd, env: process.env, windowsHide: true }
  );
}

module.exports = function(WORKSPACE) {
  const router = express.Router();
  const runningTasks = new Map();

  router.get('/', (req, res) => {
    const tasks = [];
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf-8'));
      if (pkg.scripts) {
        Object.entries(pkg.scripts).forEach(([name, cmd]) => {
          tasks.push({ id: `npm:${name}`, name, command: `npm run ${name}`, source: 'npm', description: cmd });
        });
      }
    } catch {}
    try {
      const makefile = fs.readFileSync(path.join(WORKSPACE, 'Makefile'), 'utf-8');
      const targets = [...makefile.matchAll(/^([a-zA-Z][a-zA-Z0-9_-]*):/gm)].map(m => m[1]);
      targets.filter(t => t !== 'PHONY').forEach(t => {
        tasks.push({ id: `make:${t}`, name: t, command: `make ${t}`, source: 'make' });
      });
    } catch {}
    try {
      const rcPath = path.join(WORKSPACE, '.codevrc.json');
      if (fs.existsSync(rcPath)) {
        const rc = JSON.parse(fs.readFileSync(rcPath, 'utf-8'));
        (rc.tasks || []).forEach((t, i) => {
          tasks.push({ id: `rc:${i}`, name: t.name, command: t.command, source: 'codevrc', description: t.description });
        });
      }
    } catch {}
    res.json({ tasks });
  });

  router.post('/run', (req, res) => {
    const { command, taskId } = req.body;
    if (!command) return res.status(400).json({ error: 'No command' });
    const id = taskId || `task_${Date.now()}`;
    try {
      const proc = spawnShell(command, WORKSPACE);
      runningTasks.set(id, proc);
      proc.on('close', () => runningTasks.delete(id));
      res.json({ ok: true, pid: proc.pid, id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/kill/:id', (req, res) => {
    const proc = runningTasks.get(req.params.id);
    if (proc) { proc.kill(); runningTasks.delete(req.params.id); res.json({ ok: true }); }
    else res.status(404).json({ error: 'Not found' });
  });

  return router;
};
