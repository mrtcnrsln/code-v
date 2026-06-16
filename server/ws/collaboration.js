const { v4: uuidv4 } = require('uuid');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const COLORS = ['#60a5fa','#34d399','#f87171','#fbbf24','#a78bfa',
                '#fb923c','#38bdf8','#4ade80','#f472b6','#94a3b8'];

// ── Operational Transform ─────────────────────
// Transform op2 against op1 so they can be applied in any order
function transformOp(op1, op2) {
  if (op1.type === 'insert' && op2.type === 'insert') {
    if (op1.offset <= op2.offset) {
      return { ...op2, offset: op2.offset + op1.text.length };
    }
    return op2;
  }
  if (op1.type === 'delete' && op2.type === 'insert') {
    if (op1.offset < op2.offset) {
      return { ...op2, offset: Math.max(op1.offset, op2.offset - op1.length) };
    }
    return op2;
  }
  if (op1.type === 'insert' && op2.type === 'delete') {
    if (op1.offset <= op2.offset) {
      return { ...op2, offset: op2.offset + op1.text.length };
    }
    if (op1.offset < op2.offset + op2.length) {
      return { ...op2, length: op2.length + op1.text.length };
    }
    return op2;
  }
  if (op1.type === 'delete' && op2.type === 'delete') {
    if (op1.offset + op1.length <= op2.offset) {
      return { ...op2, offset: op2.offset - op1.length };
    }
    if (op1.offset >= op2.offset + op2.length) {
      return op2;
    }
    // Overlapping deletes
    const start = Math.min(op1.offset, op2.offset);
    const end   = Math.max(op1.offset + op1.length, op2.offset + op2.length);
    return { type: 'delete', offset: start, length: end - start - op1.length };
  }
  return op2;
}

function applyOpToString(content, op) {
  if (op.type === 'replace') return op.content;
  const len = content.length;
  if (op.type === 'insert') {
    const off = Math.max(0, Math.min(op.offset, len));
    return content.slice(0, off) + op.text + content.slice(off);
  }
  if (op.type === 'delete') {
    const off = Math.max(0, Math.min(op.offset, len));
    const end = Math.max(0, Math.min(op.offset + op.length, len));
    return content.slice(0, off) + content.slice(end);
  }
  return content;
}

module.exports = function setupCollaboration(wss, WORKSPACE, wsConfig, MODE) {
  const clients  = new Map();
  const docs     = new Map();
  const versions = new Map();
  const chat     = [];
  const comments = new Map();
  let   colorIdx = 0;
  let   hostId   = null;

  // ── Persistence: load versions + comments from disk ──
  const DATA_DIR = require('path').join(__dirname, '../../data');
  const HIST_FILE = require('path').join(DATA_DIR, 'history.json');
  const COMM_FILE = require('path').join(DATA_DIR, 'comments.json');

  function loadPersisted() {
    try {
      require('fs').mkdirSync(DATA_DIR, { recursive: true });
      if (require('fs').existsSync(HIST_FILE)) {
        const data = JSON.parse(require('fs').readFileSync(HIST_FILE, 'utf-8'));
        Object.entries(data).forEach(([k, v]) => versions.set(k, v));
        console.log(`[collab] Loaded history for ${versions.size} files`);
      }
      if (require('fs').existsSync(COMM_FILE)) {
        const data = JSON.parse(require('fs').readFileSync(COMM_FILE, 'utf-8'));
        Object.entries(data).forEach(([k, v]) => comments.set(k, v));
      }
    } catch (e) { console.error('[collab] Load error:', e.message); }
  }

  function savePersisted() {
    try {
      require('fs').mkdirSync(DATA_DIR, { recursive: true });
      const histObj = {};
      versions.forEach((v, k) => { histObj[k] = v; });
      require('fs').writeFileSync(HIST_FILE, JSON.stringify(histObj), 'utf-8');
      const commObj = {};
      comments.forEach((v, k) => { commObj[k] = v; });
      require('fs').writeFileSync(COMM_FILE, JSON.stringify(commObj), 'utf-8');
    } catch (e) { console.error('[collab] Save error:', e.message); }
  }

  // Save every 30 seconds
  setInterval(savePersisted, 30000);
  // Load on startup
  loadPersisted();

  wsConfig.set('_activeSessions', []);
  wsConfig.set('_kickFn', (userId) => {
    const c = clients.get(userId);
    if (c) { try { c.ws.close(); } catch {} clients.delete(userId); }
  });

  function send(ws, data) {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  }
  function broadcastAll(data) {
    const msg = JSON.stringify(data);
    clients.forEach(c => { if (c.ws.readyState === 1) c.ws.send(msg); });
  }
  function broadcast(data, skipId) {
    const msg = JSON.stringify(data);
    clients.forEach((c, id) => { if (id !== skipId && c.ws.readyState === 1) c.ws.send(msg); });
  }
  function updateSessionList() {
    wsConfig.set('_activeSessions', [...clients.values()].map(c => ({
      id: c.id, name: c.name, color: c.color,
      activeFile: c.activeFile, isHost: c.isHost, connectedAt: c.connectedAt
    })));
  }

  function getDoc(filePath) {
    if (!docs.has(filePath)) {
      let content = '';
      const full = path.resolve(WORKSPACE, filePath);
      if (fs.existsSync(full)) {
        try { content = fs.readFileSync(full, 'utf-8'); } catch {}
      }
      docs.set(filePath, { content, version: 0, history: [], saveTimer: null });
    }
    return docs.get(filePath);
  }

  function writeFileSafe(filePath, content) {
    try {
      const full = path.resolve(WORKSPACE, filePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const tmp = full + '.codev_tmp_' + Date.now();
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, full);
    } catch (e) {
      console.error('[collab] write error:', filePath, e.message);
    }
  }

  function scheduleWrite(filePath, content) {
    const doc = docs.get(filePath);
    if (!doc) return;
    clearTimeout(doc.saveTimer);
    doc.saveTimer = setTimeout(() => {
      writeFileSafe(filePath, content);
      doc.saveTimer = null;
    }, 2000); // 2s debounce — longer to avoid mid-edit writes
  }

  function saveVersion(filePath, content, author) {
    if (!versions.has(filePath)) versions.set(filePath, []);
    const hist = versions.get(filePath);
    if (hist.length && hist[hist.length-1].content === content) return;
    hist.push({ version: hist.length + 1, content, ts: Date.now(), author });
    if (hist.length > 50) hist.shift();
  }

  // Apply op with OT: transform against any concurrent ops
  function applyClientOp(filePath, incomingOp, clientVersion, clientId) {
    const doc = getDoc(filePath);

    // Find ops server applied after client's version
    const concurrentOps = doc.history.filter(h => h.version > clientVersion);

    // Transform incoming op against concurrent ops
    let op = { ...incomingOp };
    for (const concurrent of concurrentOps) {
      if (concurrent.clientId !== clientId) {
        op = transformOp(concurrent.op, op);
      }
    }

    // Apply
    doc.content = applyOpToString(doc.content, op);
    doc.version++;

    // Store in history (keep last 100)
    doc.history.push({ op, version: doc.version, clientId, ts: Date.now() });
    if (doc.history.length > 100) doc.history.shift();

    scheduleWrite(filePath, doc.content);
    return { doc, transformedOp: op };
  }

  wss.on('connection', ws => {
    const id    = uuidv4().slice(0, 8);
    const color = COLORS[colorIdx++ % COLORS.length];
    const isHost = clients.size === 0;
    if (isHost) hostId = id;

    const client = { id, ws, name: null, color, activeFile: null, cursor: null, workspace: WORKSPACE, isHost, connectedAt: Date.now() };
    clients.set(id, client);

    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      const c = clients.get(id); if (!c) return;

      switch (msg.type) {

        case 'join':
          c.name = (msg.name || 'Guest').slice(0, 32);
          send(ws, {
            type: 'welcome', id, color,
            workspace: c.workspace, isHost: c.isHost,
            config: wsConfig.get(),
            users: [...clients.values()]
              .filter(u => u.id !== id && u.name)
              .map(u => ({ id: u.id, name: u.name, color: u.color, activeFile: u.activeFile, isHost: u.isHost })),
            chatHistory: chat.slice(-60)
          });
          broadcast({ type: 'user_joined', user: { id, name: c.name, color, isHost: c.isHost } }, id);
          updateSessionList();
          break;

        case 'set_workspace':
          c.workspace = msg.path || WORKSPACE;
          send(ws, { type: 'workspace_changed', workspace: c.workspace });
          break;

        case 'open_file': {
          c.activeFile = msg.path;
          const doc = getDoc(msg.path);
          send(ws, { type: 'file_content', path: msg.path, content: doc.content, version: doc.version, pane: msg.pane || 1 });
          broadcast({ type: 'user_focus', userId: id, file: msg.path }, id);
          // Send existing comments for this file
          const fileComments = comments.get(msg.path) || [];
          if (fileComments.length) {
            send(ws, { type: 'file_comments', path: msg.path, comments: fileComments });
          }
          updateSessionList();
          break;
        }

        case 'operation': {
          const { doc, transformedOp } = applyClientOp(msg.path, msg.op, msg.version || 0, id);
          // Send transformed op to ALL OTHER clients
          broadcast({
            type: 'operation',
            path: msg.path,
            op: transformedOp,
            userId: id, color: c.color, name: c.name,
            version: doc.version
          }, id);
          // Ack to sender with server version
          send(ws, { type: 'op_ack', opId: msg.opId, version: doc.version });
          break;
        }

        case 'save': {
          const doc = getDoc(msg.path);
          clearTimeout(doc.saveTimer);
          doc.saveTimer = null;
          saveVersion(msg.path, doc.content, c.name);
          writeFileSafe(msg.path, doc.content);
          broadcastAll({ type: 'saved', path: msg.path, by: c.name, ts: Date.now() });
          // Persist history immediately on save
          savePersisted();
          const hist = versions.get(msg.path) || [];
          const versionList = hist.map(v => ({ version: v.version, ts: v.ts, author: v.author }));
          // Send version list to ALL users who have this file open
          clients.forEach((cl) => {
            if (cl.activeFile === msg.path || cl.id === id) {
              send(cl.ws, { type: 'versions', path: msg.path, versions: versionList });
            }
          });
          break;
        }

        case 'cursor':
          c.cursor = msg.cursor;
          broadcast({ type: 'cursor', userId: id, color: c.color, name: c.name, cursor: msg.cursor, path: msg.path }, id);
          break;

        case 'selection':
          broadcast({ type: 'selection', userId: id, color: c.color, name: c.name, selection: msg.selection, path: msg.path }, id);
          break;

        case 'chat': {
          if (!msg.text?.trim()) break;
          const chatMsg = { type: 'chat', id: uuidv4().slice(0,8), userId: id, name: c.name, color: c.color, text: msg.text.slice(0, 2000), ts: Date.now() };
          chat.push(chatMsg);
          if (chat.length > 200) chat.shift();
          broadcastAll(chatMsg); // everyone including sender
          break;
        }

        case 'comment': {
          const comment = { id: uuidv4().slice(0,8), userId: id, name: c.name, color: c.color, path: msg.path, line: msg.line, text: msg.text, ts: Date.now() };
          if (!comments.has(msg.path)) comments.set(msg.path, []);
          comments.get(msg.path).push(comment);
          // Send to ALL users including sender
          broadcastAll({ type: 'comment', ...comment });
          break;
        }

        case 'get_versions': {
          const hist = versions.get(msg.path) || [];
          send(ws, { type: 'versions', path: msg.path, versions: hist.map(v => ({ version: v.version, ts: v.ts, author: v.author })) });
          break;
        }

        case 'get_version_content': {
          const hist = versions.get(msg.path) || [];
          const v = hist.find(h => h.version === msg.version);
          send(ws, { type: 'version_content', path: msg.path, version: msg.version, content: v?.content ?? '' });
          break;
        }

        case 'restore_version': {
          const hist = versions.get(msg.path) || [];
          const v = hist.find(h => h.version === msg.version);
          if (!v) break;
          const doc = getDoc(msg.path);
          doc.content = v.content;
          doc.version++;
          doc.history = []; // Reset OT history after restore
          writeFileSafe(msg.path, v.content);
          broadcastAll({
            type: 'operation', path: msg.path,
            op: { type: 'replace', content: v.content },
            userId: id, name: c.name, color: c.color, version: doc.version
          });

          break;
        }

        case 'update_config': {
          const PERSONAL_SETTINGS = ['theme','fontSize','fontFamily','tabSize','wordWrap','minimap','formatOnSave'];
          const SHARED_SETTINGS   = ['authEnabled','roomPassword','serverName','allowGuestAccess'];
          const hasShared = Object.keys(msg.config).some(k => SHARED_SETTINGS.includes(k));
          if (hasShared && c.isHost) {
            const sharedUpdate = {};
            SHARED_SETTINGS.forEach(k => { if (msg.config[k] !== undefined) sharedUpdate[k] = msg.config[k]; });
            wsConfig.set(sharedUpdate);
            // Notify all users of session-level changes (not visual settings)
            broadcastAll({ type: 'session_updated', roomPassword: !!sharedUpdate.roomPassword, serverName: sharedUpdate.serverName });
          }
          send(ws, { type: 'config_ack' });
          break;
        }

        case 'discard': {
          // Client discarded changes — reload doc from disk and broadcast
          const full = path.resolve(WORKSPACE, msg.path);
          let originalContent = '';
          try { originalContent = require('fs').readFileSync(full, 'utf-8'); } catch {}
          const doc = getDoc(msg.path);
          // Cancel pending write
          if (doc.saveTimer) { clearTimeout(doc.saveTimer); doc.saveTimer = null; }
          doc.content = originalContent;
          doc.version++;
          doc.history = [];
          // Broadcast original content to all
          broadcastAll({
            type: 'operation', path: msg.path,
            op: { type: 'replace', content: originalContent },
            userId: id, name: c.name, color: c.color, version: doc.version
          });
          break;
        }

        case 'terminal_run': {
          if (!msg.cmd) break;
          if (!c.isHost) {
            send(ws, { type: 'terminal_chunk', id: msg.id, chunk: '[Terminal is only available on the host machine]\n', isErr: true });
            send(ws, { type: 'terminal_done', id: msg.id, code: 1 });
            break;
          }
          const shell   = IS_WIN ? 'cmd' : 'sh';
          const shellArgs = IS_WIN ? ['/c', msg.cmd] : ['-c', msg.cmd];
          let proc;
          try {
            proc = spawn(shell, shellArgs, { cwd: c.workspace || WORKSPACE, env: process.env, windowsHide: true });
          } catch (e) {
            send(ws, { type: 'terminal_chunk', id: msg.id, chunk: `Error: ${e.message}\n`, isErr: true });
            send(ws, { type: 'terminal_done', id: msg.id, code: 1 });
            break;
          }
          proc.stdout.on('data', d => send(ws, { type: 'terminal_chunk', id: msg.id, chunk: d.toString() }));
          proc.stderr.on('data', d => send(ws, { type: 'terminal_chunk', id: msg.id, chunk: d.toString(), isErr: true }));
          proc.on('error', e => {
            send(ws, { type: 'terminal_chunk', id: msg.id, chunk: `Error: ${e.message}\n`, isErr: true });
            send(ws, { type: 'terminal_done', id: msg.id, code: 1 });
          });
          proc.on('close', code => send(ws, { type: 'terminal_done', id: msg.id, code }));
          setTimeout(() => { try { proc.kill(); } catch {} }, 30000);
          break;
        }
      }
    });

    ws.on('close', () => {
      clients.delete(id);
      if (id === hostId && clients.size > 0) {
        const next = clients.values().next().value;
        next.isHost = true; hostId = next.id;
        send(next.ws, { type: 'promoted_to_host' });
        broadcast({ type: 'host_changed', hostId: next.id });
      }
      broadcast({ type: 'user_left', userId: id });
      updateSessionList();
      // When last client leaves, flush any pending writes immediately
      if (clients.size === 0) {
        docs.forEach((doc, filePath) => {
          if (doc.saveTimer) {
            clearTimeout(doc.saveTimer);
            doc.saveTimer = null;
            // Only write if there's actual content (don't overwrite with empty)
            if (doc.content) {
              writeFileSafe(filePath, doc.content);
            }
          }
        });
      }
    });
  });

  return broadcastAll;
};
