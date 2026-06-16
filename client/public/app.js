'use strict';
// CodeV v2 — app.js

// ── Global State ──────────────────────────────
let ws, editor, editor2, diffEditor;
let myId, myName, myColor, myIsHost = false;
let authToken  = localStorage.getItem('codev_token') || '';
let myWorkspace = '';
const remoteUsers   = new Map();
const remoteDecors  = new Map();
const openTabs      = new Map();   // path → {modified, lang, version}
const openTabs2     = new Map();
let   activeTab     = null;
let   activeTab2    = null;
let   splitEnabled  = false;
let   showingDiff   = false;
let   ctxTarget     = null;
let   termHistory   = [], termHistIdx = -1;
let   formatOnSave  = true;
let   followingUser = null;
const comments      = [];          // local cache
const searchOpts    = { case: false, word: false, regex: false };
let   gitSearchQuery = '';
const registeredSnippetLangs = new Set();

// ── Pending ops tracking (for beforeunload) ───
const pendingModified = new Set(); // paths with unsaved changes

// ── Welcome ───────────────────────────────────
async function initWelcome() {
  let info = { authEnabled: false, hasRoomPassword: false, serverName: 'CodeV', mode: 'client' };
  try { const r = await fetch('/api/info'); info = await r.json(); } catch {}
  const sub = document.getElementById('welcome-subtitle');
  if (sub) sub.textContent = info.serverName || 'Collaborative Editor';
  const saved = localStorage.getItem('codev-name');
  if (saved && document.getElementById('w-name')) document.getElementById('w-name').value = saved;
  try {
    const r = await fetch('/api/files/workspaces', { headers: { 'X-Workspace': '' } });
    const d = await r.json();
    const el = document.getElementById('w-workspace');
    if (el && d.current) el.value = d.current;
  } catch {}

  // Try existing token
  if (authToken) {
    try {
      const r = await fetch('/api/auth/verify', { headers: { 'Authorization': 'Bearer ' + authToken } });
      const d = await r.json();
      if (d.ok) { myName = d.user.displayName || d.user.username; hideWelcome(); return; }
    } catch {}
    authToken = ''; localStorage.removeItem('codev_token');
  }

  if (info.authEnabled) { showStep('step-auth'); return; }
  if (info.hasRoomPassword) {
    const pf = document.getElementById('w-join-pw-field');
    if (pf) pf.style.display = '';
  }

  document.getElementById('btn-host')?.addEventListener('click', () => {
    const name = document.getElementById('w-name').value.trim();
    if (!name) { showWelcomeError('Enter your name'); return; }
    myName = name; localStorage.setItem('codev-name', name);
    showStep('step-host');
  });
  document.getElementById('btn-join-room')?.addEventListener('click', () => {
    const name = document.getElementById('w-name').value.trim();
    if (!name) { showWelcomeError('Enter your name'); return; }
    myName = name; localStorage.setItem('codev-name', name);
    const u = document.getElementById('w-join-url');
    if (u) u.value = location.href;
    if (info.hasRoomPassword) { const pf=document.getElementById('w-join-pw-field'); if(pf) pf.style.display=''; }
    showStep('step-join');
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const ws = document.getElementById('welcome-screen');
    if (!ws || ws.style.display === 'none') return;
    const step = document.querySelector('.welcome-step:not([style*="display:none"])');
    if (!step) return;
    if (step.id === 'step-name') document.getElementById('btn-host')?.click();
    else if (step.id === 'step-host') startHost();
    else if (step.id === 'step-join') joinSession();
    else if (step.id === 'step-auth') doAuth();
  });
}
function showStep(id) { document.querySelectorAll('.welcome-step').forEach(s=>s.style.display='none'); const el=document.getElementById(id); if(el) el.style.display=''; hideWelcomeError(); }
function backToName() { showStep('step-name'); }
async function startHost() {
  const pw = document.getElementById('w-host-password')?.value;
  const ws = document.getElementById('w-workspace')?.value.trim();
  if (pw) { try { await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+authToken},body:JSON.stringify({roomPassword:pw})}); } catch {} }
  if (ws) myWorkspace = ws;
  showWelcomeLoading();
  await issueToken();
  hideWelcome();
}
async function joinSession() {
  const url = document.getElementById('w-join-url')?.value.trim();
  const pw  = document.getElementById('w-join-password')?.value;
  if (url && url !== location.href && !url.includes(location.host)) { window.location.href = url; return; }
  showWelcomeLoading();

  // ALWAYS check server — never skip room password
  let serverInfo = { hasRoomPassword: false };
  try { const r = await fetch('/api/info'); serverInfo = await r.json(); } catch {}

  if (serverInfo.hasRoomPassword) {
    if (!pw) {
      hideWelcomeLoading();
      const pf = document.getElementById('w-join-pw-field');
      if (pf) pf.style.display = '';
      showWelcomeError('This session requires a room password');
      return;
    }
    try {
      const r = await fetch('/api/auth/join', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:pw, displayName:myName})});
      const d = await r.json();
      if (!d.ok) { hideWelcomeLoading(); showWelcomeError(d.error || 'Wrong room password'); return; }
      authToken = d.token;
      localStorage.setItem('codev_token', authToken);
    } catch { hideWelcomeLoading(); showWelcomeError('Connection failed'); return; }
  } else {
    await issueToken();
  }
  hideWelcome();
}
async function doAuth() {
  const u = document.getElementById('w-username')?.value.trim();
  const p = document.getElementById('w-password')?.value;
  if (!u||!p) { showWelcomeError('Enter username and password'); return; }
  showWelcomeLoading();
  try {
    const r = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const d = await r.json();
    if (!d.ok) { hideWelcomeLoading(); showWelcomeError(d.error||'Invalid credentials'); return; }
    authToken = d.token; myName = d.user.displayName||u;
    localStorage.setItem('codev_token',authToken); localStorage.setItem('codev-name',myName);
    hideWelcome();
  } catch { hideWelcomeLoading(); showWelcomeError('Connection failed'); }
}
async function issueToken() {
  try {
    const r = await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:myName})});
    const d = await r.json();
    if (d.token) { authToken=d.token; localStorage.setItem('codev_token',authToken); }
  } catch {}
}
function hideWelcome() {
  const ws=document.getElementById('welcome-screen'); if(ws) ws.style.display='none';
  const ma=document.getElementById('main-app'); if(ma) ma.style.display='flex';
  initEditor();
}
function showWelcomeError(msg)  { const el=document.getElementById('welcome-error'); if(el){el.textContent=msg;el.style.display='';} }
function hideWelcomeError()     { const el=document.getElementById('welcome-error'); if(el)el.style.display='none'; }
function showWelcomeLoading()   { const el=document.getElementById('welcome-loading'); if(el)el.style.display='flex'; }
function hideWelcomeLoading()   { const el=document.getElementById('welcome-loading'); if(el)el.style.display='none'; }

// ── Monaco ────────────────────────────────────
function initEditor() {
  require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
  require(['vs/editor/editor.main'], () => {
    defineThemes();
    const opts = {
      theme: 'codev-dark', fontSize: 13,
      fontFamily: "'JetBrains Mono', monospace",
      fontLigatures: true, lineHeight: 21,
      minimap: { enabled: true }, scrollBeyondLastLine: false,
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      smoothScrolling: true, cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 10, bottom: 10 }, tabSize: 2, insertSpaces: true,
      formatOnPaste: false,  // IMPORTANT: prevent auto-format corruption
      quickSuggestions: { other:true, comments:true, strings:true },
      parameterHints: { enabled: true },
      renderWhitespace: 'selection', stickyScroll: { enabled: true },
      wordWrap: 'off', multiCursorModifier: 'alt',
      showFoldingControls: 'always', occurrencesHighlight: true,
      suggest: { showSnippets:true, showClasses:true, showFunctions:true },
    };

    editor = monaco.editor.create(document.getElementById('editor-container'), opts);
    setupEditorEvents(editor, 1);

    // Shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, closeActiveTab);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, toggleSearch);
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, formatDocument);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, addCommentAtCursor);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, () => toggleSplitEditor(!splitEnabled));

    loadPrefs();
    connectWS();
    setupChat();
    setupTerminal();
    setupContextMenu();
    setupResizers();
  });
}

function setupEditorEvents(ed, pane) {
  ed.onDidChangeCursorPosition(e => {
    if (pane !== 1) return;
    const { lineNumber: ln, column: col } = e.position;
    document.getElementById('stat-cursor').textContent = `Ln ${ln}, Col ${col}`;
    updateBreadcrumb(ln);
    if (ws && activeTab) wsSend({ type:'cursor', path:activeTab, cursor:{ line:ln, col } });
    if (followingUser) wsSend({ type:'follow_scroll', line:ln });
  });

  ed.onDidChangeCursorSelection(e => {
    if (pane !== 1) return;
    const s = e.selection;
    const selEl = document.getElementById('stat-sel');
    if (!s.isEmpty()) {
      const chars = ed.getModel()?.getValueInRange(s).length || 0;
      const lines = s.endLineNumber - s.startLineNumber;
      selEl.textContent = `(${chars} sel${lines ? ', '+lines+' lines' : ''})`;
      selEl.style.display = '';
      if (ws && activeTab) wsSend({ type:'selection', path:activeTab, selection:{ sl:s.startLineNumber, sc:s.startColumn, el:s.endLineNumber, ec:s.endColumn } });
    } else { selEl.style.display = 'none'; }
  });

  ed.onDidChangeModelContent(e => {
    if (ed._skip || pane !== 1 || !activeTab) return;
    const tab = openTabs.get(activeTab);
    if (tab && !tab.modified) {
      tab.modified = true;
      pendingModified.add(activeTab);
      updateTabEl(activeTab);
    }
    for (const ch of e.changes) {
      const op = changeToOp(ch);
      if (!op || !ws) continue;
      const model = ed.getModel();
      const pos   = ed.getPosition();
      wsSend({
        type: 'operation', path: activeTab, op,
        opId: Math.random().toString(36).slice(2),
        version: model ? model.__serverVersion || 0 : 0
      });
    }
  });
}

function changeToOp(ch) {
  const { rangeOffset: off, rangeLength: len, text } = ch;
  if (!len && text)  return { type:'insert', offset:off, text };
  if (len && !text)  return { type:'delete', offset:off, length:len };
  if (len && text)   return { type:'insert', offset:off, text, _del:len };
  return null;
}

// ── Themes (personal — NOT broadcast) ─────────
function defineThemes() {
  const mk = (base, bg, fg, acc, kw, str, num, com) => ({
    base, inherit: true,
    rules: [
      {token:'keyword',foreground:kw},{token:'string',foreground:str},
      {token:'number',foreground:num},{token:'comment',foreground:com,fontStyle:'italic'},
      {token:'type',foreground:acc},{token:'function',foreground:acc},
    ],
    colors: {
      'editor.background':bg,'editor.foreground':fg,
      'editorLineNumber.foreground':'#3a4560','editorLineNumber.activeForeground':acc,
      'editor.lineHighlightBackground':bg==='#0d0f14'?'#12151c':bg+'18',
      'editorCursor.foreground':acc,'editor.selectionBackground':acc+'30',
      'editorBracketMatch.background':acc+'25','editorBracketMatch.border':acc,
    }
  });
  monaco.editor.defineTheme('codev-dark',     mk('vs-dark','#0d0f14','#e8eaf0','#5b8af5','#7c9fff','#98c379','#f5a55a','#5a6a8a'));
  monaco.editor.defineTheme('codev-light',    mk('vs',     '#ffffff','#1a1a1a','#2563eb','#0000cc','#067d17','#1a5eb8','#6a737d'));
  monaco.editor.defineTheme('codev-monokai',  mk('vs-dark','#272822','#f8f8f2','#a6e22e','#f92672','#e6db74','#ae81ff','#75715e'));
  monaco.editor.defineTheme('codev-dracula',  mk('vs-dark','#282a36','#f8f8f2','#bd93f9','#ff79c6','#f1fa8c','#bd93f9','#6272a4'));
  monaco.editor.defineTheme('codev-solarized',mk('vs-dark','#002b36','#fdf6e3','#268bd2','#859900','#2aa198','#d33682','#586e75'));
  monaco.editor.defineTheme('codev-github',   mk('vs',     '#ffffff','#1f2328','#0969da','#cf222e','#0a3069','#0550ae','#6e7781'));
  monaco.editor.defineTheme('codev-nord',     mk('vs-dark','#2e3440','#eceff4','#88c0d0','#81a1c1','#a3be8c','#b48ead','#616e88'));
}

// ── WebSocket ─────────────────────────────────
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type:'join', name:myName, token:authToken }));
    document.getElementById('dot').className = 'online';
    document.getElementById('session-label').textContent = 'Connected';
  };
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    document.getElementById('dot').className = '';
    document.getElementById('session-label').textContent = 'Disconnected';
    notify('Connection lost — reconnecting...','error');
    setTimeout(connectWS, 2500);
  };
  ws.onerror = () => ws.close();
}
function wsSend(d) { if (ws?.readyState===1) ws.send(JSON.stringify(d)); }

async function apiFetch(url, opts={}) {
  return fetch(url, { ...opts, headers: { 'Content-Type':'application/json', 'X-Workspace':myWorkspace, 'Authorization':'Bearer '+authToken, ...(opts.headers||{}) } });
}

// ── Message handler ───────────────────────────
function handle(msg) {
  switch (msg.type) {
    case 'welcome':
      myId=msg.id; myColor=msg.color; myIsHost=msg.isHost;
      myWorkspace = msg.workspace || myWorkspace;
      document.getElementById('session-label').textContent = (myWorkspace||'').split(/[/\\]/).pop()||'CodeV';
      const hb=document.getElementById('host-badge'); if(hb) hb.style.display=myIsHost?'':'none';
      msg.users.forEach(u=>remoteUsers.set(u.id,u));
      msg.chatHistory.forEach(m=>appendChat(m,false));
      updateUsersUI();
      // Apply config locally (NOT broadcast — personal settings)
      if (msg.config) applyLocalConfig(msg.config);
      refreshTree();
      refreshGit();
      // Restore last file
      const lf = localStorage.getItem('codev-last-file');
      if (lf) setTimeout(()=>openFile(lf), 600);
      break;

    case 'workspace_changed':
      myWorkspace = msg.workspace;
      document.getElementById('session-label').textContent = (myWorkspace||'').split(/[/\\]/).pop()||'CodeV';
      refreshTree(); break;

    case 'user_joined':
      remoteUsers.set(msg.user.id, msg.user); updateUsersUI();
      sysChat(`${msg.user.name} joined`); notify(`👤 ${msg.user.name} joined`,'info'); break;

    case 'user_left':
      const u = remoteUsers.get(msg.userId);
      if(u) sysChat(`${u.name} left`);
      remoteUsers.delete(msg.userId); clearUserDecors(msg.userId); updateUsersUI(); break;

    case 'promoted_to_host':
      myIsHost=true;
      const hb2=document.getElementById('host-badge'); if(hb2) hb2.style.display='';
      notify('You are now the host 👑','success'); break;

    case 'host_changed':
      remoteUsers.forEach(u=>u.isHost=u.id===msg.hostId); updateUsersUI(); break;

    case 'user_focus':
      const ru=remoteUsers.get(msg.userId); if(ru){ru.activeFile=msg.file;updateUsersUI();} break;

    case 'file_content': loadFileInEditor(msg.path, msg.content, msg.version, msg.pane||1); break;

    case 'operation':
      if (msg.path===activeTab) applyRemoteOp(msg); break;

    case 'op_ack':
      // Update local model's server version
      if (editor.getModel()) editor.getModel().__serverVersion = msg.version;
      break;

    case 'saved':
      // Only mark as unmodified if WE saved (by: myName)
      if (openTabs.has(msg.path)) {
        openTabs.get(msg.path).modified = false;
        pendingModified.delete(msg.path);
        updateTabEl(msg.path);
      }
      if (msg.by !== myName) notify(`💾 Saved by ${msg.by}`,'info');
      else notify('💾 Saved','success');
      break;

    case 'cursor':
      if (msg.path===activeTab) showRemoteCursor(msg.userId,msg.color,msg.name,msg.cursor);
      if (followingUser===msg.userId && msg.cursor) editor.revealLineInCenter(msg.cursor.line);
      break;

    case 'selection':
      if (msg.path===activeTab) showRemoteSelection(msg.userId,msg.color,msg.name,msg.selection); break;

    case 'chat':        appendChat(msg,true); break;

    // Comments: broadcast to all including sender — show for everyone
    case 'comment':     receiveComment(msg); break;

    // Bulk comments when opening a file
    case 'file_comments':
      msg.comments.forEach(c => receiveComment(c, false));
      break;

    case 'versions':    renderVersions(msg.path, msg.versions); break;

    case 'version_content': openDiffForVersion(msg.path, msg.version, msg.content); break;

    case 'config_ack':  break; // personal setting saved

    case 'config_updated':
      // Only apply SHARED settings (auth, room password etc.) — NOT visual settings
      applySharedConfig(msg.config); break;

    case 'fs_event':    refreshTree(); break;
    case 'fs_changed':  reloadIfOpen(msg.path); break;
    case 'terminal_chunk': appendTermChunk(msg.chunk, msg.isErr); break;
    case 'terminal_done':  appendTermDone(msg.code); break;
  }
}

// ── File tree ─────────────────────────────────
async function refreshTree(subPath) {
  try {
    const r = await apiFetch(`/api/files/tree?path=${encodeURIComponent(subPath||'')}`);
    const d = await r.json();
    if (!subPath) renderTree(d.items||[]);
    else return d.items||[];
  } catch {}
}

function renderTree(items) {
  const tree = document.getElementById('file-tree'); if(!tree) return;
  tree.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'tree-workspace-label';
  label.textContent = (myWorkspace||'Workspace').split(/[/\\]/).filter(Boolean).pop()||'WORKSPACE';
  label.title = myWorkspace;
  tree.appendChild(label);
  renderTreeItems(items, tree, 0);
}

function renderTreeItems(items, container, depth) {
  (items||[]).forEach(item => {
    const el = document.createElement('div');
    el.className = 'tree-item'+(item.type==='dir'?' dir':'');
    el.style.paddingLeft = `${10+depth*14}px`;
    el.dataset.path = item.path; el.dataset.type = item.type;
    el.innerHTML = `<span class="tree-icon">${item.type==='dir'?'📁':fileIcon(item.ext)}</span><span class="tree-name">${esc(item.name)}</span>`;
    if (item.path===activeTab) el.classList.add('active');
    const rUser = [...remoteUsers.values()].find(u=>u.activeFile===item.path);
    if (rUser) {
      const dot = document.createElement('div');
      dot.style.cssText=`width:5px;height:5px;border-radius:50%;background:${rUser.color};margin-left:auto;flex-shrink:0`;
      dot.title=rUser.name; el.appendChild(dot);
    }
    el.addEventListener('click', async () => {
      if (item.type==='dir') {
        if (el.dataset.expanded==='1') {
          el.dataset.expanded='0'; el.querySelector('.tree-icon').textContent='📁';
          let nx=el.nextSibling;
          while(nx&&nx._depth>depth){const t=nx.nextSibling;nx.remove();nx=t;}
        } else {
          el.dataset.expanded='1'; el.querySelector('.tree-icon').textContent='📂';
          const ch = await refreshTree(item.path);
          if (ch&&ch.length) {
            let ref=el.nextSibling;
            const tmp=document.createElement('div');
            renderTreeItems(ch,tmp,depth+1);
            Array.from(tmp.children).forEach(c=>{c._depth=depth+1;container.insertBefore(c,ref);});
          }
        }
      } else { openFile(item.path); }
    });
    el.addEventListener('contextmenu', e=>{e.preventDefault();showCtx(e,item);});
    container.appendChild(el);
  });
}

const EXT_ICONS={js:'🟨',ts:'🔷',jsx:'⚛',tsx:'⚛',py:'🐍',rb:'💎',go:'🐹',rs:'🦀',html:'🌐',css:'🎨',scss:'🎨',less:'🎨',json:'📋',yaml:'📋',yml:'📋',md:'📝',sh:'⚙',bash:'⚙',sql:'🗄',vue:'💚',svelte:'🔥',java:'☕',cpp:'⚙',c:'⚙',h:'⚙',cs:'🔵',php:'🐘',swift:'🍊',kt:'🎯',dart:'🎯',dockerfile:'🐳',env:'🔑',png:'🖼',jpg:'🖼',jpeg:'🖼',gif:'🖼',webp:'🖼',svg:'🎨',pdf:'📕',lock:'🔒',toml:'📋',xml:'📋',r:'📊',lua:'🌙',proto:'⚡',ipynb:'📓',mp4:'🎬',mp3:'🎵',zip:'📦'};
function fileIcon(ext){return EXT_ICONS[ext?.toLowerCase()]||'📄';}

// ── Open / Load ───────────────────────────────
const IMAGE_EXTS  = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg']);
const BINARY_EXTS = new Set(['pdf','mp4','mp3','wav','zip','tar','gz','wasm','exe','dmg','bin']);

function openFile(fp, pane=1) {
  if (!fp) return;
  const ext = fp.split('.').pop()?.toLowerCase();
  if (IMAGE_EXTS.has(ext))  { openImageViewer(fp); return; }
  if (BINARY_EXTS.has(ext)) { notify(`Binary: ${fp.split(/[/\\]/).pop()}`,'info'); return; }
  localStorage.setItem('codev-last-file', fp);
  if (pane===2) { if (openTabs2.has(fp)) { switchTab2(fp); return; } }
  else          { if (openTabs.has(fp))  { switchTab(fp);  return; } }
  wsSend({ type:'open_file', path:fp, pane });
}

function openImageViewer(fp) {
  document.getElementById('editor-container').style.display='none';
  document.getElementById('editor-welcome').style.display='none';
  document.getElementById('diff-container').style.display='none';
  const viewer=document.getElementById('image-viewer');
  if (viewer) {
    viewer.style.display='flex';
    viewer.innerHTML=`
      <img src="/api/files/raw?path=${encodeURIComponent(fp)}"
        style="max-width:100%;max-height:calc(100vh - 160px);border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,.5)"
        alt="${esc(fp)}" onerror="this.style.display='none';this.nextSibling.style.display=''">
      <div style="display:none;padding:20px;color:var(--red)">Cannot load image</div>
      <div style="font-size:11px;color:var(--text2);font-family:var(--font-mono);margin-top:8px">${esc(fp.split(/[/\\]/).pop())}</div>
      <button class="btn" onclick="window.open('/api/files/raw?path=${encodeURIComponent(fp)}','_blank')" style="margin-top:8px">Open full size ↗</button>`;
  }
  activeTab=fp;
  document.getElementById('stat-file').textContent=fp;
  document.getElementById('stat-lang').textContent='Image';
}

function loadFileInEditor(fp, content, version, pane=1) {
  const lang = detectLang(fp);
  if (pane===2 && splitEnabled) {
    openTabs2.set(fp, { modified:false, lang, version });
    addTabEl2(fp);
    const uri=monaco.Uri.parse('file:///'+fp.replace(/\\/g,'/'));
    let model=monaco.editor.getModel(uri);
    if (!model) model=monaco.editor.createModel(content, lang, uri);
    else { if(editor2) { editor2._skip=true; model.setValue(content); editor2._skip=false; } }
    model.__serverVersion = version;
    if (editor2) { editor2._skip=true; editor2.setModel(model); editor2._skip=false; }
    switchTab2(fp);
    return;
  }

  openTabs.set(fp, { modified:false, lang, version });
  addTabEl(fp);

  const uri=monaco.Uri.parse('file:///'+fp.replace(/\\/g,'/'));
  let model=monaco.editor.getModel(uri);
  if (!model) {
    model=monaco.editor.createModel(content, lang, uri);
  } else {
    editor._skip=true;
    model.setValue(content);
    editor._skip=false;
  }
  model.__serverVersion = version;

  editor._skip=true; editor.setModel(model); editor._skip=false;

  // Show editor, hide others
  document.getElementById('editor-container').style.display='block';
  document.getElementById('editor-welcome').style.display='none';
  document.getElementById('diff-container').style.display='none';
  const iv=document.getElementById('image-viewer'); if(iv) iv.style.display='none';

  switchTab(fp);
  document.getElementById('stat-file').textContent=fp;
  document.getElementById('stat-lang').textContent=lang||'Text';
  loadVersionHistory(fp);
  registerSnippetsForLang(lang);
  renderComments();
}

function switchTab(fp) {
  activeTab=fp;
  const uri=monaco.Uri.parse('file:///'+fp.replace(/\\/g,'/'));
  const model=monaco.editor.getModel(uri);
  if (model) { editor._skip=true; editor.setModel(model); editor._skip=false; }
  document.querySelectorAll('.tab[data-pane="1"]').forEach(t=>t.classList.toggle('active',t.dataset.path===fp));
  document.querySelectorAll('.tree-item').forEach(t=>t.classList.toggle('active',t.dataset.path===fp));
  const tab=openTabs.get(fp);
  document.getElementById('stat-file').textContent=fp;
  document.getElementById('stat-lang').textContent=tab?.lang||'Text';
  document.getElementById('editor-container').style.display='block';
  document.getElementById('editor-welcome').style.display='none';
  document.getElementById('diff-container').style.display='none';
  const iv=document.getElementById('image-viewer'); if(iv) iv.style.display='none';
  wsSend({ type:'user_focus', file:fp });
  loadVersionHistory(fp);
  if(showingDiff) closeDiff();
  renderComments();
  localStorage.setItem('codev-last-file', fp);
}

function switchTab2(fp) {
  activeTab2=fp;
  const uri=monaco.Uri.parse('file:///'+fp.replace(/\\/g,'/'));
  const model=monaco.editor.getModel(uri);
  if (model&&editor2) { editor2._skip=true; editor2.setModel(model); editor2._skip=false; }
  document.querySelectorAll('.tab[data-pane="2"]').forEach(t=>t.classList.toggle('active',t.dataset.path===fp));
}

function reloadIfOpen(fp) {
  if (!openTabs.has(fp)&&!openTabs2.has(fp)) return;
  const pos=editor.getPosition(); const scroll=editor.getScrollTop();
  apiFetch(`/api/files/read?path=${encodeURIComponent(fp)}`).then(r=>r.json()).then(d=>{
    if (!d.content) return;
    const uri=monaco.Uri.parse('file:///'+fp.replace(/\\/g,'/'));
    const model=monaco.editor.getModel(uri);
    if (model&&model.getValue()!==d.content) {
      editor._skip=true;
      model.pushEditOperations([],[{range:model.getFullModelRange(),text:d.content}],()=>null);
      editor._skip=false;
      if(pos) editor.setPosition(pos); editor.setScrollTop(scroll);
      notify(`↻ ${fp.split(/[/\\]/).pop()}`,'info');
    }
  }).catch(()=>{});
}

// ── Tabs ─────────────────────────────────────
function addTabEl(fp) {
  if (document.querySelector(`.tab[data-path="${CSS.escape(fp)}"][data-pane="1"]`)) return;
  const t=document.createElement('div'); t.className='tab'; t.dataset.path=fp; t.dataset.pane='1';
  const name=fp.split(/[/\\]/).pop();
  t.innerHTML=`<span>${fileIcon(name.split('.').pop())} ${esc(name)}</span><span class="tab-x">×</span>`;
  t.addEventListener('click',e=>{if(!e.target.classList.contains('tab-x'))switchTab(fp);});
  t.querySelector('.tab-x').addEventListener('click',e=>{e.stopPropagation();closeTab(fp);});
  document.getElementById('tabs-bar').appendChild(t);
}
function addTabEl2(fp) {
  const bar=document.getElementById('tabs-bar-2'); if(!bar) return;
  if (document.querySelector(`.tab[data-path="${CSS.escape(fp)}"][data-pane="2"]`)) return;
  const t=document.createElement('div'); t.className='tab'; t.dataset.path=fp; t.dataset.pane='2';
  const name=fp.split(/[/\\]/).pop();
  t.innerHTML=`<span>${fileIcon(name.split('.').pop())} ${esc(name)}</span><span class="tab-x">×</span>`;
  t.addEventListener('click',e=>{if(!e.target.classList.contains('tab-x'))switchTab2(fp);});
  t.querySelector('.tab-x').addEventListener('click',e=>{e.stopPropagation();closeTab2(fp);});
  bar.appendChild(t);
}
function updateTabEl(fp) {
  document.querySelectorAll(`.tab[data-path="${CSS.escape(fp)}"]`).forEach(t=>t.classList.toggle('modified',openTabs.get(fp)?.modified||false));
}
function closeTab(fp) {
  const tab = openTabs.get(fp);
  if (tab?.modified) {
    const fileName = fp.split(/[/\\]/).pop();
    const ans = confirm(`"${fileName}" has unsaved changes.\n\nClick OK to SAVE and close.\nClick Cancel to DISCARD changes and close.`);
    if (ans) {
      // OK → Save then close
      wsSend({ type:'save', path:fp });
      pendingModified.delete(fp);
    } else {
      // Cancel → Discard: tell server to reload from disk and broadcast to all
      wsSend({ type: 'discard', path: fp });
    }
    // Either way, close the tab
  }
  openTabs.delete(fp);
  pendingModified.delete(fp);
  document.querySelector(`.tab[data-path="${CSS.escape(fp)}"][data-pane="1"]`)?.remove();
  monaco.editor.getModel(monaco.Uri.parse('file:///'+fp.replace(/\\/g,'/')))?.dispose();
  if (activeTab===fp) {
    const rem=[...openTabs.keys()];
    if (rem.length) switchTab(rem[rem.length-1]);
    else { activeTab=null; document.getElementById('editor-welcome').style.display='flex'; document.getElementById('editor-container').style.display='none'; document.getElementById('stat-file').textContent='No file open'; localStorage.removeItem('codev-last-file'); }
  }
}
function closeTab2(fp) {
  openTabs2.delete(fp);
  document.querySelector(`.tab[data-path="${CSS.escape(fp)}"][data-pane="2"]`)?.remove();
  if (activeTab2===fp) {
    const rem=[...openTabs2.keys()];
    if (rem.length) switchTab2(rem[rem.length-1]);
    else { activeTab2=null; if(editor2) editor2.setModel(null); }
  }
}
function closeActiveTab() { if(activeTab) closeTab(activeTab); }

// ── Split editor ──────────────────────────────
function toggleSplitEditor(enable) {
  splitEnabled=enable;
  const chk=document.getElementById('split-chk'); if(chk) chk.checked=enable;
  const divider=document.getElementById('split-divider');
  const pane2=document.getElementById('pane-secondary');
  const bar2=document.getElementById('tabs-bar-2');
  if(divider) divider.style.display=enable?'':'none';
  if(pane2)   pane2.style.display=enable?'flex':'none';
  if(bar2)    bar2.style.display=enable?'flex':'none';

  if (enable && !editor2) {
    const container=document.getElementById('editor-container-2');
    if (container) {
      container.style.display='block';
      editor2 = monaco.editor.create(container, {
        theme: `codev-${document.documentElement.dataset.theme||'dark'}`,
        fontSize:13, fontFamily:"'JetBrains Mono',monospace",
        fontLigatures:true, lineHeight:21,
        automaticLayout:true, minimap:{enabled:false},
        scrollBeyondLastLine:false, tabSize:2, insertSpaces:true, formatOnPaste:false
      });
      setupEditorEvents(editor2, 2);
    }
  }
  if (!enable) {
    activeTab2=null; openTabs2.clear();
    if(editor2) editor2.setModel(null);
    if(bar2) bar2.innerHTML='';
  }
}

// ── Save ──────────────────────────────────────
async function saveFile() {
  if (!activeTab) return;
  if (formatOnSave) { try { await formatDocument(true); } catch {} }
  wsSend({ type:'save', path:activeTab });
  // Mark as clean immediately — server will confirm via 'saved' message
  const tab=openTabs.get(activeTab);
  if (tab) { tab.modified=false; pendingModified.delete(activeTab); updateTabEl(activeTab); }
}

// ── Format ────────────────────────────────────
async function formatDocument(silent=false) {
  if (!activeTab||!editor.getModel()) return;
  const tab=openTabs.get(activeTab);
  const content=editor.getModel().getValue();
  const sf=document.getElementById('stat-fmt'); if(sf) sf.textContent='⟳';
  try {
    const r=await apiFetch('/api/format',{method:'POST',body:JSON.stringify({content,language:tab?.lang,filePath:activeTab})});
    const d=await r.json();
    if(d.error&&!silent) notify('Format: '+d.error.split('\n')[0],'error');
    if(d.formatted&&d.formatted!==content) {
      const model=editor.getModel();
      const pos=editor.getPosition(); const scroll=editor.getScrollTop();
      editor._skip=true;
      model.pushEditOperations([],[{range:model.getFullModelRange(),text:d.formatted}],()=>null);
      editor._skip=false;
      if(pos) editor.setPosition(pos); editor.setScrollTop(scroll);
      if(sf){sf.textContent='✓';setTimeout(()=>sf.textContent='',1500);}
    } else { if(sf) sf.textContent=''; }
  } catch { if(sf) sf.textContent=''; if(!silent) notify('Formatter unavailable','error'); }
}

// ── Apply remote op — preserve cursor ─────────
function applyRemoteOp(msg) {
  const uri=monaco.Uri.parse('file:///'+msg.path.replace(/\\/g,'/'));
  const model=monaco.editor.getModel(uri); if(!model) return;

  // Save current cursor as offset (not line/col) so we can transform it
  const curPos    = editor.getPosition();
  const curOffset = curPos ? (model.getOffsetAt(curPos)||0) : 0;
  const savedScroll = editor.getScrollTop();

  editor._skip=true;
  const op=msg.op;
  let insertedLen=0, deletedAt=-1, deletedLen=0;

  if (op.type==='replace') {
    model.pushEditOperations([],[{range:model.getFullModelRange(),text:op.content}],()=>null);
  } else if (op.type==='insert') {
    const off=Math.min(op.offset||0,model.getValueLength());
    const pos=model.getPositionAt(off);
    model.applyEdits([{range:new monaco.Range(pos.lineNumber,pos.column,pos.lineNumber,pos.column),text:op.text}]);
    flashDecor(model,pos,op.text.length,msg.color,true);
    insertedLen=op.text.length;
    // Transform cursor: if remote insert is before our cursor, shift right
    if (off <= curOffset) {
      const newOffset = curOffset + insertedLen;
      const newPos = model.getPositionAt(newOffset);
      editor._skip=false;
      editor.setPosition(newPos);
      editor.setScrollTop(savedScroll);
      model.__serverVersion = msg.version;
      return;
    }
  } else if (op.type==='delete') {
    const off=Math.min(op.offset||0,model.getValueLength());
    const end=Math.min((op.offset||0)+(op.length||0),model.getValueLength());
    const sp=model.getPositionAt(off); const ep=model.getPositionAt(end);
    model.applyEdits([{range:new monaco.Range(sp.lineNumber,sp.column,ep.lineNumber,ep.column),text:''}]);
    flashDecor(model,sp,0,msg.color,false);
    deletedAt=off; deletedLen=end-off;
    // Transform cursor: if remote delete is before our cursor, shift left
    if (deletedAt < curOffset) {
      const newOffset = Math.max(deletedAt, curOffset - deletedLen);
      const newPos = model.getPositionAt(newOffset);
      editor._skip=false;
      editor.setPosition(newPos);
      editor.setScrollTop(savedScroll);
      model.__serverVersion = msg.version;
      return;
    }
  }
  editor._skip=false;
  model.__serverVersion = msg.version;
  // Cursor not affected — just restore
  if(curPos) editor.setPosition(curPos);
  editor.setScrollTop(savedScroll);
}

function flashDecor(model,pos,len,color,isAdd) {
  const ep=len>0?model.getPositionAt(model.getOffsetAt(pos)+len):{lineNumber:pos.lineNumber,column:pos.column+1};
  const ids=editor.deltaDecorations([],[{range:new monaco.Range(pos.lineNumber,pos.column,ep.lineNumber||pos.lineNumber,ep.column||pos.column),options:{className:isAdd?'diff-add-bg':'diff-del-bg',isWholeLine:false}}]);
  setTimeout(()=>editor.deltaDecorations(ids,[]),1200);
}

// ── Remote cursors ────────────────────────────
function injectStyle(id,css){if(!document.getElementById(id)){const s=document.createElement('style');s.id=id;s.textContent=css;document.head.appendChild(s);}}
function showRemoteCursor(userId,color,name,cursor) {
  injectStyle(`rc-${userId}`,`.rcl-${userId}{background:${color}0d!important;border-left:2px solid ${color}80!important}`);
  const prev=remoteDecors.get(userId+'_c')||[];
  const ids=editor.deltaDecorations(prev,[{range:new monaco.Range(cursor.line,1,cursor.line,1),options:{isWholeLine:true,className:`rcl-${userId}`,hoverMessage:{value:`**${name}**`}}}]);
  remoteDecors.set(userId+'_c',ids);
}
function showRemoteSelection(userId,color,name,sel) {
  injectStyle(`rs-${userId}`,`.rsel-${userId}{background:${color}22!important}`);
  const prev=remoteDecors.get(userId+'_s')||[];
  const ids=editor.deltaDecorations(prev,[{range:new monaco.Range(sel.sl,sel.sc,sel.el,sel.ec),options:{className:`rsel-${userId}`,hoverMessage:{value:name}}}]);
  remoteDecors.set(userId+'_s',ids);
}
function clearUserDecors(userId) {
  ['_c','_s'].forEach(suf=>{const ids=remoteDecors.get(userId+suf);if(ids){try{editor.deltaDecorations(ids,[]);}catch{}remoteDecors.delete(userId+suf);}});
}

// ── Snippets ──────────────────────────────────
async function registerSnippetsForLang(lang) {
  if(!lang||lang==='plaintext'||registeredSnippetLangs.has(lang))return;
  registeredSnippetLangs.add(lang);
  try {
    const r=await apiFetch(`/api/snippets/${lang}`); const snippets=await r.json();
    if(!snippets.length)return;
    monaco.languages.registerCompletionItemProvider(lang,{provideCompletionItems(){return{suggestions:snippets.map(s=>({label:s.prefix,kind:monaco.languages.CompletionItemKind.Snippet,documentation:s.desc,insertText:s.body.replace(/\$(\d+)/g,'${$1:}'),insertTextRules:monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,detail:s.desc||s.prefix}))}}});
  } catch {}
}

// ── Users ─────────────────────────────────────
function updateUsersUI() {
  const all=[{id:myId,name:myName,color:myColor,isMe:true,isHost:myIsHost},...remoteUsers.values()];
  const bar=document.getElementById('users-bar');
  if(bar){bar.innerHTML='';all.forEach(u=>{const av=document.createElement('div');av.className='u-avatar';av.style.background=u.color;av.title=u.name+(u.isMe?' (you)':'')+(u.isHost?' 👑':'');av.textContent=(u.name||'?')[0].toUpperCase();if(u.isHost)av.style.outline='2px solid gold';if(!u.isMe)av.addEventListener('click',()=>toggleFollow(u.id,u.name));bar.appendChild(av);});}
  const list=document.getElementById('users-list');
  if(list){list.innerHTML='';all.forEach(u=>{const el=document.createElement('div');el.className='online-u';el.innerHTML=`<div class="online-dot" style="background:${u.color};box-shadow:0 0 4px ${u.color}"></div><span>${esc(u.name)}${u.isMe?'<span style="font-size:9px;color:var(--text2);margin-left:3px">(you)</span>':''}${u.isHost?' 👑':''}</span>${!u.isMe?`<button class="icon-btn" onclick="toggleFollow('${u.id}','${esc(u.name)}')" style="margin-left:auto;font-size:10px">${followingUser===u.id?'★':'☆'}</button>`:''} ${u.activeFile?`<div class="online-file" title="${u.activeFile}">${u.activeFile.split(/[/\\]/).pop()}</div>`:''}`; list.appendChild(el);});}
  const su=document.getElementById('stat-users'); if(su) su.textContent=`${all.length} user${all.length!==1?'s':''}`;
}

function toggleFollow(userId,name) {
  if (followingUser===userId) { followingUser=null; notify(`Stopped following ${name}`,'info'); }
  else {
    followingUser=userId;
    const u=remoteUsers.get(userId);
    if (u?.activeFile&&u.activeFile!==activeTab) {
      openFile(u.activeFile);
      setTimeout(()=>{ if(u.cursor) editor.revealLineInCenter(u.cursor.line); }, 500);
    }
    notify(`Following ${name}`,'info');
  }
  updateUsersUI();
}

// ── Chat ──────────────────────────────────────
function setupChat() {
  const inp=document.getElementById('chat-input'); if(!inp) return;
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const text=inp.value.trim();if(text&&ws){wsSend({type:'chat',text});inp.value='';}}
  });
}
function appendChat(msg,scroll) {
  const box=document.getElementById('chat-msgs'); if(!box)return;
  const el=document.createElement('div'); el.className='chat-msg';
  const time=new Date(msg.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  el.innerHTML=`<div class="chat-msg-hdr"><span class="chat-msg-name" style="color:${msg.color}">${esc(msg.name)}</span><span class="chat-msg-time">${time}</span></div><div class="chat-msg-text">${esc(msg.text)}</div>`;
  box.appendChild(el); if(scroll) box.scrollTop=box.scrollHeight;
}
function sysChat(text){const box=document.getElementById('chat-msgs');if(!box)return;const el=document.createElement('div');el.className='chat-sys';el.textContent=text;box.appendChild(el);box.scrollTop=box.scrollHeight;}

// ── Comments ─ ALL users see, go to file+line ──
let commentTargetLine=null;
function addCommentAtCursor(){if(!activeTab)return;commentTargetLine=editor.getPosition()?.lineNumber;const li=document.getElementById('comment-line-info');if(li)li.textContent=`Line ${commentTargetLine} — ${activeTab.split(/[/\\]/).pop()}`;const ct=document.getElementById('comment-text');if(ct)ct.value='';showModal('comment-modal');setTimeout(()=>document.getElementById('comment-text')?.focus(),100);}
function submitComment(){const text=document.getElementById('comment-text')?.value.trim();if(!text||!commentTargetLine)return;wsSend({type:'comment',path:activeTab,line:commentTargetLine,text});closeModal('comment-modal');}

function receiveComment(msg, showNotif=true) {
  // Avoid duplicates
  if (comments.find(c=>c.id===msg.id)) return;
  comments.push(msg);
  renderComments();
  // Add glyph if file is open
  if (msg.path===activeTab) {
    editor.deltaDecorations([],[{range:new monaco.Range(msg.line,1,msg.line,1),options:{glyphMarginClassName:'comment-glyph',glyphMarginHoverMessage:{value:`**${msg.name}**: ${msg.text}`}}}]);
  }
  if (showNotif && msg.userId!==myId) notify(`💬 ${msg.name}: ${msg.text.slice(0,40)}`,'info');
}

function renderComments(){
  const list=document.getElementById('comments-list'); if(!list)return;
  const filtered=activeTab?comments.filter(c=>c.path===activeTab):comments;
  list.innerHTML=filtered.length?filtered.map(c=>`
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:8px;margin-bottom:4px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <span style="font-size:11px;font-weight:600;color:${c.color}">${esc(c.name)}</span>
        <span style="font-size:10px;color:var(--text2)">Ln ${c.line}</span>
      </div>
      <div style="font-size:12px;color:var(--text1)">${esc(c.text)}</div>
      <button class="btn" style="margin-top:4px;font-size:10px;padding:2px 6px" onclick="goToCommentLine('${esc(c.path)}',${c.line})">Go to line</button>
    </div>`).join(''):'<div style="font-size:12px;color:var(--text2);padding:4px">No comments. Ctrl+G to add.</div>';
}

function goToCommentLine(fp,line) {
  if (fp!==activeTab) {
    openFile(fp);
    setTimeout(()=>{editor.revealLineInCenter(line);editor.setPosition({lineNumber:line,column:1});},600);
  } else {
    editor.revealLineInCenter(line); editor.setPosition({lineNumber:line,column:1});
  }
}

// ── Breadcrumb ────────────────────────────────
function updateBreadcrumb(line){if(!activeTab)return;const bc=document.getElementById('breadcrumb');if(!bc)return;bc.style.display='flex';const parts=activeTab.split(/[/\\]/);bc.innerHTML=parts.map((p,i)=>`<span style="color:${i===parts.length-1?'var(--text0)':'var(--text2)'}">${esc(p)}</span>${i<parts.length-1?'<span style="opacity:.4;margin:0 2px">›</span>':''}`).join('')+`<span style="opacity:.35;margin-left:6px;font-size:10px">:${line}</span>`;}

// ── Git ───────────────────────────────────────
async function refreshGit(){
  const panel=document.getElementById('git-panel');if(!panel)return;
  try{const r=await apiFetch('/api/git/status');const d=await r.json();
    if(d.notInstalled){panel.innerHTML=`<div style="padding:10px;font-size:12px;color:var(--yellow)">⚠ Git not installed.<br><a href="https://git-scm.com/download" target="_blank" style="color:var(--accent)">Download Git</a> and restart.</div>`;return;}
    if(!d.ok){panel.innerHTML=`<div style="padding:10px;font-size:12px;color:var(--text2)">Not a git repo.<div style="display:flex;gap:4px;margin-top:6px"><button class="btn" onclick="gitInit()">git init</button><button class="btn" onclick="showModal('clone-modal')">Clone</button></div></div>`;return;}
    const sg=document.getElementById('stat-git');if(sg)sg.textContent=`⎇ ${d.branch}`;
    await renderGitPanel(d);
  }catch(e){panel.innerHTML=`<div style="padding:10px;font-size:12px;color:var(--red)">Git error: ${esc(e.message)}</div>`;}
}

async function renderGitPanel(s){
  let stats=null;try{const r=await apiFetch('/api/git/stats');stats=await r.json();}catch{}
  const changed=[...(s.modified||[]),...(s.created||[]),...(s.deleted||[]),...(s.not_added||[]),...(s.staged||[]),...(s.conflicted||[])];
  const panel=document.getElementById('git-panel');if(!panel)return;
  panel.innerHTML=`
    <div class="git-stats-bar">
      <div class="git-stat-item"><span class="git-stat-num">${stats?.commits??'—'}</span><span class="git-stat-lbl">Commits</span></div>
      <div class="git-stat-item"><span class="git-stat-num">${stats?.branches??'—'}</span><span class="git-stat-lbl">Branches</span></div>
      <div class="git-stat-item"><span class="git-stat-num">${stats?.tags??'—'}</span><span class="git-stat-lbl">Tags</span></div>
      <div class="git-stat-item"><span class="git-stat-num">${stats?.contributors?.length??'—'}</span><span class="git-stat-lbl">Authors</span></div>
    </div>
    <div class="git-branch-row">
      <span class="git-branch-icon">⎇</span>
      <select id="git-branch-sel" class="git-branch-sel" onchange="gitCheckout(this.value)">
        ${((s.branches&&s.branches.length)?s.branches:[s.branch]).filter(Boolean).map(b=>`<option value="${esc(b)}" ${b===s.branch?'selected':''}>${esc(b)}</option>`).join('')}
      </select>
      <span style="font-size:10px;color:var(--text2);margin-left:auto">${s.ahead?`↑${s.ahead}`:''}${s.behind?`↓${s.behind}`:''}</span>
    </div>
    <div class="git-actions-bar">
      <button class="btn" onclick="gitFetch()">⟳</button>
      <button class="btn" onclick="gitPull()">↓ Pull</button>
      <button class="btn" onclick="gitPush()">↑ Push</button>
      <button class="btn" onclick="gitStash()" title="Stash">📦</button>
      <button class="btn" onclick="gitStashPop()" title="Stash pop">↑📦</button>
      <button class="btn" onclick="showBranchInput()">+ Branch</button>
    </div>
    <div style="padding:4px 8px;display:flex;gap:4px">
      <input class="field-input" id="git-search" placeholder="Search commits..." value="${esc(gitSearchQuery)}" style="flex:1;padding:4px 7px;font-size:11px" oninput="gitSearchQuery=this.value;loadGitLog()">
    </div>
    ${changed.length?`
      <div class="git-section-title">Changes (${changed.length})<button class="btn" onclick="gitAddAll()" style="margin-left:auto;font-size:10px;padding:2px 7px">Stage All</button></div>
      <div style="max-height:160px;overflow-y:auto">
        ${(s.staged||[]).map(f=>gitFEl(f,'S','var(--green)')).join('')}
        ${(s.modified||[]).map(f=>gitFEl(f,'M','var(--yellow)')).join('')}
        ${(s.created||[]).map(f=>gitFEl(f,'A','var(--green)')).join('')}
        ${(s.not_added||[]).map(f=>gitFEl(f,'U','var(--text2)')).join('')}
        ${(s.deleted||[]).map(f=>gitFEl(f,'D','var(--red)')).join('')}
        ${(s.conflicted||[]).map(f=>gitFEl(f,'!','var(--red)')).join('')}
      </div>
      <div class="git-commit-area">
        <textarea class="commit-input" id="commit-msg" rows="2" placeholder="Commit message..."></textarea>
        <div style="display:flex;gap:4px">
          <button class="btn primary" onclick="gitCommit()" style="flex:1">Commit</button>
          <button class="btn" onclick="gitCommit(true)">+Push</button>
        </div>
      </div>`:`<div style="padding:8px;font-size:12px;color:var(--green)">✓ Working tree clean</div>`}
    <div class="git-section-title">Log</div>
    <div id="git-log" style="max-height:200px;overflow-y:auto"><div class="loading"><div class="spin"></div></div></div>`;
  loadGitLog();
}

function gitFEl(f,s,color){return `<div class="git-file" onclick="openFile('${esc(f)}')" title="${esc(f)}"><span style="color:${color};font-weight:700;font-size:10px;width:12px;flex-shrink:0">${s}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(f)}</span><div style="display:flex;gap:3px;flex-shrink:0"><button class="icon-btn" onclick="event.stopPropagation();gitFileDiff('${esc(f)}')" style="font-size:10px">±</button><button class="icon-btn" onclick="event.stopPropagation();gitDiscard('${esc(f)}')" style="font-size:10px;color:var(--red)">↩</button></div></div>`;}

async function loadGitLog(){const el=document.getElementById('git-log');if(!el)return;const q=gitSearchQuery?`&search=${encodeURIComponent(gitSearchQuery)}`:'';const r=await apiFetch(`/api/git/log?limit=20${q}`);const d=await r.json();if(!d.ok||!d.commits.length){el.innerHTML='<div style="font-size:11px;color:var(--text2);padding:8px">No commits yet</div>';return;}el.innerHTML=d.commits.map(c=>`<div class="git-log-item" onclick="showCommitDiff('${c.hash}')"><div style="display:flex;gap:6px;align-items:baseline"><span class="git-log-hash">${c.hash.slice(0,7)}</span><span style="font-size:9px;color:var(--text2)">${new Date(c.date).toLocaleDateString()}</span></div><div class="git-log-msg">${esc(c.message)}</div><div class="git-log-meta">${esc(c.author_name)}</div></div>`).join('');}
async function showCommitDiff(hash){const r=await apiFetch(`/api/git/diff?commit=${hash}`);const d=await r.json();if(!d.ok||!d.diff)return;openDiffRaw(d.diff);}
async function gitFileDiff(file){const r=await apiFetch(`/api/git/diff?file=${encodeURIComponent(file)}`);const d=await r.json();if(!d.ok||!d.diff){notify('No diff','info');return;}openDiffRaw(d.diff);}
function openDiffRaw(diff){if(!diffEditor)createDiffEditor();diffEditor.setModel({original:monaco.editor.createModel(diff,'diff'),modified:monaco.editor.createModel('','diff')});document.getElementById('editor-container').style.display='none';document.getElementById('diff-container').style.display='block';document.getElementById('editor-welcome').style.display='none';showingDiff=true;}

async function gitInit(){await apiFetch('/api/git/init',{method:'POST'});refreshGit();notify('Git initialized','success');}
async function gitFetch(){const r=await apiFetch('/api/git/fetch',{method:'POST'});const d=await r.json();notify(d.ok?'Fetched':d.error,d.ok?'success':'error');refreshGit();}
async function gitAddAll(){await apiFetch('/api/git/add',{method:'POST',body:JSON.stringify({files:'.'})});notify('Staged all','success');refreshGit();}
async function gitDiscard(f){if(!confirm(`Discard changes to ${f}?`))return;await apiFetch('/api/git/discard',{method:'POST',body:JSON.stringify({file:f})});refreshGit();}
async function gitPull(){const branch=document.getElementById('git-branch-sel')?.value||'';const r=await apiFetch('/api/git/pull',{method:'POST',body:JSON.stringify({remote:'origin',branch})});const d=await r.json();notify(d.ok?'Pulled':d.error,d.ok?'success':'error');refreshGit();}
async function gitPush(){const r=await apiFetch('/api/git/push',{method:'POST'});const d=await r.json();notify(d.ok?'Pushed':d.error,d.ok?'success':'error');}
async function gitStash(){const r=await apiFetch('/api/git/stash',{method:'POST'});const d=await r.json();notify(d.ok?'Stashed':d.error,d.ok?'success':'error');refreshGit();}
async function gitStashPop(){const r=await apiFetch('/api/git/stash/pop',{method:'POST'});const d=await r.json();notify(d.ok?'Stash popped':d.error,d.ok?'success':'error');refreshGit();}
async function gitCommit(andPush=false){const msg=document.getElementById('commit-msg')?.value?.trim();if(!msg){notify('Enter commit message','error');return;}const r=await apiFetch('/api/git/commit',{method:'POST',body:JSON.stringify({message:msg,author:myName||'CodeV User',email:myName?.toLowerCase().replace(/\s+/g,'.')+'@codev.local'})});const d=await r.json();if(!d.ok){notify(d.error,'error');return;}notify(`Committed ${d.hash?.slice(0,7)}`,'success');if(andPush)await gitPush();refreshGit();}
function gitCheckout(b){apiFetch('/api/git/checkout',{method:'POST',body:JSON.stringify({branch:b})}).then(r=>r.json()).then(d=>{notify(d.ok?`→ ${b}`:d.error,d.ok?'success':'error');refreshGit();});}
async function doClone(){const url=document.getElementById('clone-url')?.value.trim();const target=document.getElementById('clone-target')?.value.trim();const sslSkip=document.getElementById('clone-ssl-skip')?.checked||false;const username=document.getElementById('clone-user')?.value.trim()||'';const password=document.getElementById('clone-pass')?.value||'';if(!url){notify('Enter repo URL','error');return;}closeModal('clone-modal');notify('Cloning...','info');const r=await apiFetch('/api/git/clone',{method:'POST',body:JSON.stringify({url,targetPath:target,sslVerify:!sslSkip,username:username||undefined,password:password||undefined})});const d=await r.json();if(d.ok){notify('Clone started — tree refreshes in a few seconds','success');setTimeout(refreshTree,5000);}else notify(d.error,'error');}
function showBranchInput(){const n=prompt('New branch name:');if(!n)return;apiFetch('/api/git/checkout',{method:'POST',body:JSON.stringify({branch:n,create:true})}).then(r=>r.json()).then(d=>{notify(d.ok?`Created ${n}`:d.error,d.ok?'success':'error');refreshGit();});}

// ── Version History — Diff shows correctly ────
function loadVersionHistory(fp){wsSend({type:'get_versions',path:fp});}
function renderVersions(fp,vers){
  const panel=document.getElementById('ver-panel');if(!panel)return;
  if(!vers||!vers.length){panel.innerHTML=`<div style="padding:12px;font-size:12px;color:var(--text2)">No versions yet. Ctrl+S creates snapshots.</div>`;return;}
  panel.innerHTML=vers.slice().reverse().map(v=>`
    <div class="ver-item">
      <div class="ver-item-hdr"><span class="ver-num">v${v.version}</span><span class="ver-author">${esc(v.author||'?')}</span></div>
      <div class="ver-time">${new Date(v.ts).toLocaleString()}</div>
      <div class="ver-actions">
        <button class="btn" style="font-size:10px;padding:2px 6px" onclick="previewVersion('${esc(fp)}',${v.version})">👁 Diff</button>
        <button class="btn" style="font-size:10px;padding:2px 6px" onclick="restoreVersion('${esc(fp)}',${v.version})">↩ Restore</button>
      </div>
    </div>`).join('');
}
function previewVersion(fp,v){wsSend({type:'get_version_content',path:fp,version:v});}
function restoreVersion(fp,v){if(!confirm(`Restore v${v}?`))return;wsSend({type:'restore_version',path:fp,version:v});notify(`Restoring v${v}...`,'info');}

function createDiffEditor(){
  const el=document.getElementById('diff-container');if(!el)return;
  // Create a wrapper div for the editor itself
  let inner=document.getElementById('diff-editor-inner');
  if(!inner){
    inner=document.createElement('div');
    inner.id='diff-editor-inner';
    inner.style.cssText='flex:1;overflow:hidden;min-height:0;';
    el.appendChild(inner);
  }
  diffEditor=monaco.editor.createDiffEditor(inner,{
    theme:`codev-${document.documentElement.dataset.theme||'dark'}`,
    fontSize:13,fontFamily:"'JetBrains Mono',monospace",
    automaticLayout:true,renderSideBySide:true,originalEditable:false,
    scrollbar:{vertical:'visible',horizontal:'visible',useShadows:false},
  });
}

function openDiffForVersion(fp,v,oldContent) {
  // First switch to the file normally so editor is visible
  if (fp !== activeTab) {
    openFile(fp);
    setTimeout(()=>_showDiff(fp,v,oldContent), 400);
  } else { _showDiff(fp,v,oldContent); }
}

function _showDiff(fp,v,oldContent) {
  if(!diffEditor) createDiffEditor(); if(!diffEditor) return;
  const lang=detectLang(fp);
  const current=editor.getModel()?.getValue()||'';
  try { const m=diffEditor.getModel(); if(m){m.original?.dispose();m.modified?.dispose();} } catch {}
  diffEditor.setModel({ original:monaco.editor.createModel(oldContent,lang), modified:monaco.editor.createModel(current,lang) });
  const dc=document.getElementById('diff-container');
  if (dc) {
    dc.style.display='flex';
    // Add close bar if not exists
    if (!dc.querySelector('#diff-close-bar')) {
      const bar=document.createElement('div');
      bar.id='diff-close-bar';
      bar.innerHTML='<button class="btn" onclick="closeDiff()">× Close Diff</button><span style="font-size:11px;color:var(--text2);margin-left:8px">v'+v+' vs current — read only on left</span>';
      dc.prepend(bar);
      // Make diff editor fill remaining space
      const inner=document.getElementById('diff-editor-inner');
      if(!inner){
        const div=document.createElement('div');
        div.id='diff-editor-inner';
        div.style.cssText='flex:1;overflow:hidden;';
        // Move diffEditor into this div
        if(diffEditor._domElement) div.appendChild(diffEditor._domElement);
        dc.appendChild(div);
      }
    } else {
      dc.querySelector('#diff-close-bar span').textContent='v'+v+' vs current — read only on left';
    }
  }
  document.getElementById('editor-container').style.display='none';
  document.getElementById('editor-welcome').style.display='none';
  showingDiff=true;
  const db=document.getElementById('diff-btn');if(db)db.style.borderColor='var(--accent)';
  if(v>0) notify('v'+v+' vs current','info');
}

function toggleDiff(){
  if(!activeTab&&!showingDiff)return;
  if(showingDiff){closeDiff();}
  else{if(!diffEditor)createDiffEditor();openDiffForVersion(activeTab,0,'');}
}
function closeDiff(){
  showingDiff=false;
  document.getElementById('editor-container').style.display='block';
  document.getElementById('diff-container').style.display='none';
  document.getElementById('editor-welcome').style.display='none';
  const db=document.getElementById('diff-btn');if(db)db.style.borderColor='';
}

// ── Search ────────────────────────────────────
function toggleSearch(){const p=document.getElementById('search-panel');if(!p)return;const s=p.style.display==='flex';p.style.display=s?'none':'flex';if(!s)document.getElementById('search-q')?.focus();}
function closeSearch(){const p=document.getElementById('search-panel');if(p)p.style.display='none';}
function toggleSearchOpt(opt){searchOpts[opt]=!searchOpts[opt];const b=document.getElementById(`srch-${opt}`);if(b){b.style.background=searchOpts[opt]?'var(--accent)':'';b.style.color=searchOpts[opt]?'#fff':'';}}
async function doSearch(){const q=document.getElementById('search-q')?.value.trim();if(!q)return;const inc=document.getElementById('search-include')?.value.trim();const results=document.getElementById('search-results');if(results)results.innerHTML='<div class="loading"><div class="spin"></div>Searching...</div>';try{const r=await apiFetch('/api/search/find',{method:'POST',body:JSON.stringify({query:q,caseSensitive:searchOpts.case,wholeWord:searchOpts.word,useRegex:searchOpts.regex,include:inc||undefined})});const d=await r.json();if(!results)return;if(d.error){results.innerHTML=`<div style="padding:8px;color:var(--red);font-size:12px">${esc(d.error)}</div>`;return;}if(!d.results.length){results.innerHTML='<div style="padding:8px;font-size:12px;color:var(--text2)">No results</div>';return;}const total=d.results.reduce((s,f)=>s+f.matches.length,0);results.innerHTML=`<div style="padding:4px 10px;font-size:10px;color:var(--text2)">${total} matches in ${d.results.length} files</div>${d.results.map(f=>`<div><div style="padding:4px 10px;font-size:11.5px;font-weight:600;color:var(--text0);cursor:pointer;background:var(--bg2)" onclick="openFile('${esc(f.file)}')">${fileIcon(f.file.split('.').pop())} ${esc(f.file.split(/[/\\]/).pop())}</div>${f.matches.slice(0,8).map(m=>`<div style="padding:3px 10px 3px 24px;font-size:11px;font-family:var(--font-mono);cursor:pointer;color:var(--text1)" onclick="openFile('${esc(f.file)}');setTimeout(()=>{editor.revealLineInCenter(${m.line});editor.setPosition({lineNumber:${m.line},column:${m.col}})},300)"><span style="color:var(--text2);margin-right:6px">${m.line}</span>${esc(m.text.slice(0,80))}</div>`).join('')}${f.matches.length>8?`<div style="padding:2px 24px;font-size:10px;color:var(--text2)">+${f.matches.length-8} more</div>`:''}</div>`).join('')}`;}catch{if(results)results.innerHTML='<div style="padding:8px;color:var(--red);font-size:12px">Search failed</div>';}}
async function doReplaceAll(){const q=document.getElementById('search-q')?.value.trim();const rep=document.getElementById('search-replace')?.value;if(!q)return;const fr=await apiFetch('/api/search/find',{method:'POST',body:JSON.stringify({query:q,caseSensitive:searchOpts.case,wholeWord:searchOpts.word,useRegex:searchOpts.regex})});const fd=await fr.json();if(!fd.results?.length){notify('No matches','info');return;}if(!confirm(`Replace in ${fd.results.length} file(s)?`))return;const r=await apiFetch('/api/search/replace',{method:'POST',body:JSON.stringify({query:q,replacement:rep,files:fd.results.map(f=>f.file),caseSensitive:searchOpts.case,wholeWord:searchOpts.word,useRegex:searchOpts.regex})});const d=await r.json();notify(`Replaced in ${d.replaced} file(s)`,'success');doSearch();}

// ── Tasks ─────────────────────────────────────
function toggleTasksPanel(){const p=document.getElementById('tasks-panel');if(!p)return;p.style.display=p.style.display==='flex'?'none':'flex';if(p.style.display==='flex')loadTasks();}
function closeTasksPanel(){const p=document.getElementById('tasks-panel');if(p)p.style.display='none';}
async function loadTasks(){const list=document.getElementById('tasks-list');if(!list)return;list.innerHTML='<div class="loading"><div class="spin"></div></div>';const r=await apiFetch('/api/tasks');const d=await r.json();if(!d.tasks?.length){list.innerHTML='<div style="padding:8px;font-size:12px;color:var(--text2)">No tasks found.<br><small>Add npm scripts, Makefile targets, or .codevrc.json tasks</small></div>';return;}list.innerHTML=d.tasks.map(t=>`<div class="tree-item" onclick="runTask('${esc(t.command)}','${esc(t.name)}')" title="${esc(t.description||t.command)}"><span style="font-size:9px;color:var(--text2);margin-right:3px">${t.source}</span>${esc(t.name)}</div>`).join('');}
function runTask(cmd,name){switchRTab('terminal');appendTermLine(`\n▶ ${name}\n`,'#a78bfa');wsSend({type:'terminal_run',cmd,id:`task_${Date.now()}`});}

// ── Terminal ──────────────────────────────────
function setupTerminal(){
  const inp=document.getElementById('term-input');if(!inp)return;
  const out=document.getElementById('term-output');if(out) out.innerHTML='';
  appendTermLine(myIsHost?'CodeV Terminal (host)\n':'CodeV Terminal (view only — commands run on host)\n','#888');
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      const cmd=inp.value.trim();if(!cmd)return;
      termHistory.unshift(cmd);termHistIdx=-1;
      appendTermLine(`$ ${cmd}\n`,'#4ade80');
      inp.value='';
      wsSend({type:'terminal_run',cmd,id:`t${Date.now()}`});
    }
    else if(e.key==='ArrowUp'){e.preventDefault();if(termHistIdx<termHistory.length-1)inp.value=termHistory[++termHistIdx];}
    else if(e.key==='ArrowDown'){e.preventDefault();termHistIdx>0?inp.value=termHistory[--termHistIdx]:(termHistIdx=-1,inp.value='');}
    else if(e.key==='l'&&e.ctrlKey){e.preventDefault();const o=document.getElementById('term-output');if(o)o.innerHTML='';}
  });
}
function appendTermLine(text,color){const out=document.getElementById('term-output');if(!out)return;const s=document.createElement('span');s.style.cssText=`color:${color||'#e8eaf0'};font-family:'JetBrains Mono',monospace;font-size:12px;`;s.textContent=text;out.appendChild(s);out.scrollTop=out.scrollHeight;}
function appendTermChunk(chunk,isErr){const out=document.getElementById('term-output');if(!out)return;const s=document.createElement('span');s.style.cssText=`color:${isErr?'#f87171':'#e8eaf0'};font-family:'JetBrains Mono',monospace;font-size:12px;`;s.textContent=chunk;out.appendChild(s);out.scrollTop=out.scrollHeight;}
function appendTermDone(code){appendTermLine(code===0?'\n✓ Done\n':`\n✗ Exit: ${code}\n`,code===0?'#4ade80':'#f87171');}

// ── Workspace ─────────────────────────────────
async function loadWorkspaces(){
  const r=await apiFetch('/api/files/workspaces');const d=await r.json();
  const list=document.getElementById('workspace-list');if(!list)return;
  list.innerHTML='';
  try{const dr=await apiFetch('/api/files/drives');const dd=await dr.json();if(dd.drives?.length){const row=document.createElement('div');row.style.cssText='display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px';dd.drives.forEach(drive=>{const b=document.createElement('button');b.className='btn';b.textContent=drive;b.onclick=()=>{const fp=document.getElementById('folder-path');if(fp)fp.value=drive+'\\';};row.appendChild(b);});list.appendChild(row);}}catch{}
  (d.suggestions||[]).forEach(p=>{const el=document.createElement('div');el.className='ws-item';el.textContent=p;if(p===d.current)el.style.borderColor='var(--accent)';el.onclick=()=>{const fp=document.getElementById('folder-path');if(fp)fp.value=p;};list.appendChild(el);});
  const fp=document.getElementById('folder-path');if(fp&&d.current)fp.value=d.current;
}
async function openFolderConfirm(){
  const fpEl=document.getElementById('folder-path');if(!fpEl)return;
  const p=fpEl.value.trim();if(!p)return;
  const r=await apiFetch('/api/files/open-folder',{method:'POST',body:JSON.stringify({path:p})});
  const d=await r.json();
  if(d.ok){myWorkspace=d.path;wsSend({type:'set_workspace',path:d.path});closeModal('folder-modal');refreshTree();notify(`Opened: ${p.split(/[/\\]/).pop()}`,'success');}
  else notify(d.error||'Cannot open','error');
}

// ── File ops ──────────────────────────────────
function promptNewFile(){const n=prompt('New file name:');if(!n)return;apiFetch('/api/files/create',{method:'POST',body:JSON.stringify({path:n,type:'file'})}).then(r=>r.json()).then(d=>{if(d.ok){refreshTree();wsSend({type:'tree_changed'});notify(`Created: ${n}`,'success');}else notify(d.error,'error');});}
function promptNewDir(){const n=prompt('New folder name:');if(!n)return;apiFetch('/api/files/create',{method:'POST',body:JSON.stringify({path:n,type:'dir'})}).then(r=>r.json()).then(d=>{if(d.ok){refreshTree();wsSend({type:'tree_changed'});notify(`Created: ${n}`,'success');}else notify(d.error,'error');});}
let renameTarget=null;
function doRename(){const nw=document.getElementById('rename-input')?.value.trim();if(!nw||!renameTarget)return;const dir=renameTarget.path.split(/[/\\]/).slice(0,-1).join('/');const newPath=dir?`${dir}/${nw}`:nw;apiFetch('/api/files/rename',{method:'POST',body:JSON.stringify({oldPath:renameTarget.path,newPath})}).then(r=>r.json()).then(d=>{if(d.ok){closeModal('rename-modal');refreshTree();wsSend({type:'tree_changed'});notify('Renamed','success');}else notify(d.error,'error');});}
function doDelete(item){if(!confirm(`Delete "${item.name}"?`))return;apiFetch(`/api/files/delete?path=${encodeURIComponent(item.path)}`,{method:'DELETE'}).then(r=>r.json()).then(d=>{if(d.ok){refreshTree();wsSend({type:'tree_changed'});notify(`Deleted: ${item.name}`,'success');if(item.path===activeTab)closeTab(item.path);}else notify(d.error,'error');});}

// ── Context menu ──────────────────────────────
function setupContextMenu(){
  document.getElementById('ctx-open')?.addEventListener('click',()=>{if(ctxTarget?.type==='file')openFile(ctxTarget.path);hideCtx();});
  document.getElementById('ctx-open-split')?.addEventListener('click',()=>{if(ctxTarget?.type==='file'){if(!splitEnabled)toggleSplitEditor(true);openFile(ctxTarget.path,2);}hideCtx();});
  document.getElementById('ctx-rename')?.addEventListener('click',()=>{renameTarget=ctxTarget;const ri=document.getElementById('rename-input');if(ri)ri.value=ctxTarget?.name||'';hideCtx();showModal('rename-modal');});
  document.getElementById('ctx-newfile')?.addEventListener('click',()=>{hideCtx();promptNewFile();});
  document.getElementById('ctx-newdir')?.addEventListener('click',()=>{hideCtx();promptNewDir();});
  document.getElementById('ctx-delete')?.addEventListener('click',()=>{const t=ctxTarget;hideCtx();if(t)doDelete(t);});
  document.addEventListener('click',hideCtx);
}
function showCtx(e,item){ctxTarget=item;const ctx=document.getElementById('ctx');if(!ctx)return;ctx.style.cssText=`display:block;left:${Math.min(e.clientX,window.innerWidth-170)}px;top:${Math.min(e.clientY,window.innerHeight-240)}px`;const co=document.getElementById('ctx-open');if(co)co.style.display=item.type==='file'?'':'none';const cs=document.getElementById('ctx-open-split');if(cs)cs.style.display=item.type==='file'?'':'none';}
function hideCtx(){const ctx=document.getElementById('ctx');if(ctx)ctx.style.display='none';}

// ── Settings — PERSONAL (not broadcast) ──────
function applyLocalConfig(cfg) {
  // Apply saved personal prefs from localStorage first, then defaults
  const theme = localStorage.getItem('codev-theme') || cfg.theme || 'dark';
  const fs    = localStorage.getItem('codev-fontsize');
  setTheme(theme, false);
  if (fs) setFontSize(fs, false);
}
function applySharedConfig(cfg) {
  // Only server-level stuff: don't touch theme/font/visual
}

function setTheme(name, sync=true) {
  document.documentElement.dataset.theme=name;
  localStorage.setItem('codev-theme', name);
  if(editor) monaco.editor.setTheme(`codev-${name}`);
  if(editor2) editor2.updateOptions({theme:`codev-${name}`});
  if(diffEditor) diffEditor.updateOptions({theme:`codev-${name}`});
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('active',b.textContent.toLowerCase()===name));
  // Save to server but DON'T broadcast to others
  if(sync) { try { apiFetch('/api/config',{method:'POST',body:JSON.stringify({theme:name})}); } catch {} }
}
function setFontSize(val,sync=true){val=parseInt(val);if(editor)editor.updateOptions({fontSize:val});if(editor2)editor2.updateOptions({fontSize:val});const fl=document.getElementById('fs-label');if(fl)fl.textContent=val+'px';const fr=document.getElementById('fs-range');if(fr)fr.value=val;localStorage.setItem('codev-fontsize',val);if(sync){try{apiFetch('/api/config',{method:'POST',body:JSON.stringify({fontSize:val})});}catch{}}}
function setFontFamily(val,sync=true){if(editor)editor.updateOptions({fontFamily:val});const ffs=document.getElementById('ff-sel');if(ffs)ffs.value=val;if(sync){try{apiFetch('/api/config',{method:'POST',body:JSON.stringify({fontFamily:val})});}catch{}}}
function setTabSize(val,sync=true){val=parseInt(val);if(editor)editor.updateOptions({tabSize:val});const ts=document.getElementById('ts-sel');if(ts)ts.value=val;if(sync){try{apiFetch('/api/config',{method:'POST',body:JSON.stringify({tabSize:val})});}catch{}}}
function setWordWrap(val,sync=true){if(editor)editor.updateOptions({wordWrap:val});const ww=document.getElementById('ww-sel');if(ww)ww.value=val;if(sync){try{apiFetch('/api/config',{method:'POST',body:JSON.stringify({wordWrap:val})});}catch{}}}
function setFormatOnSave(val){formatOnSave=val;try{apiFetch('/api/config',{method:'POST',body:JSON.stringify({formatOnSave:val})});}catch{}}
function setMinimap(val,sync=true){if(editor)editor.updateOptions({minimap:{enabled:val}});const mm=document.getElementById('mm-chk');if(mm)mm.checked=val;if(sync){try{apiFetch('/api/config',{method:'POST',body:JSON.stringify({minimap:val})});}catch{}}}
function loadPrefs(){const theme=localStorage.getItem('codev-theme')||'dark';setTimeout(()=>setTheme(theme,false),200);const fs=localStorage.getItem('codev-fontsize');if(fs)setTimeout(()=>setFontSize(fs,false),200);}
function changeLang(){const langs=['javascript','typescript','python','html','css','scss','json','markdown','shell','sql','go','rust','java','cpp','php','yaml'];const cur=openTabs.get(activeTab)?.lang;const c=prompt('Language:\n'+langs.join(', '),cur);if(c&&langs.includes(c)){const model=editor.getModel();if(model)monaco.editor.setModelLanguage(model,c);if(openTabs.has(activeTab))openTabs.get(activeTab).lang=c;const sl=document.getElementById('stat-lang');if(sl)sl.textContent=c;registerSnippetsForLang(c);}}

// ── Resizers ──────────────────────────────────
function setupResizers(){
  // Sidebar width
  const sh=document.getElementById('sidebar-resize');const sb=document.getElementById('sidebar');
  if(sh&&sb){let drag=false;sh.addEventListener('mousedown',()=>{drag=true;document.body.style.cssText='cursor:col-resize;user-select:none';});document.addEventListener('mousemove',e=>{if(!drag)return;sb.style.width=Math.max(140,Math.min(500,e.clientX))+'px';});document.addEventListener('mouseup',()=>{drag=false;document.body.style.cssText='';});}

  // Right panel width
  const rh=document.getElementById('right-resize');const rp=document.getElementById('right-panel');
  if(rh&&rp){let drag=false;rh.addEventListener('mousedown',()=>{drag=true;document.body.style.cssText='cursor:col-resize;user-select:none';});document.addEventListener('mousemove',e=>{if(!drag)return;rp.style.width=Math.max(160,Math.min(600,window.innerWidth-e.clientX))+'px';});document.addEventListener('mouseup',()=>{drag=false;document.body.style.cssText='';});}

  // Split editor divider
  const sd=document.getElementById('split-divider');
  if(sd){let drag=false,sx=0,sw=0;sd.addEventListener('mousedown',e=>{drag=true;sx=e.clientX;const p=document.getElementById('pane-primary');sw=p?p.getBoundingClientRect().width:500;document.body.style.cssText='cursor:col-resize;user-select:none';});document.addEventListener('mousemove',e=>{if(!drag)return;const tot=document.getElementById('editors-container')?.getBoundingClientRect().width||800;const nw=Math.max(200,Math.min(tot-200,sw+(e.clientX-sx)));const p=document.getElementById('pane-primary');if(p){p.style.flex='none';p.style.width=nw+'px';}});document.addEventListener('mouseup',()=>{drag=false;document.body.style.cssText='';});}

  // Chat vertical resize (chat messages height)
  const cr=document.getElementById('chat-resize');const cm=document.getElementById('chat-msgs');
  if(cr&&cm){
    let drag=false,sy=0,sh2=0;
    cr.addEventListener('mousedown',e=>{drag=true;sy=e.clientY;sh2=cm.getBoundingClientRect().height;document.body.style.cssText='cursor:row-resize;user-select:none';});
    document.addEventListener('mousemove',e=>{if(!drag)return;const nh=Math.max(60,Math.min(500,sh2+(e.clientY-sy)));cm.style.flex='none';cm.style.height=nh+'px';});
    document.addEventListener('mouseup',()=>{drag=false;document.body.style.cssText='';});
  }

  // All drag ends
  document.addEventListener('mouseup',()=>{document.body.style.cssText='';});
}

// ── Sidebar / Panel tabs ──────────────────────
function switchSTab(name){const names=['explorer','git','versions','comments'];document.querySelectorAll('.stab').forEach((t,i)=>t.classList.toggle('active',names[i]===name));document.querySelectorAll('.sidebar-panel').forEach(p=>p.classList.remove('active'));document.getElementById(`sp-${name}`)?.classList.add('active');if(name==='git')refreshGit();if(name==='comments')renderComments();}
function switchRTab(name){const names=['chat','terminal'];document.querySelectorAll('.rtab').forEach((t,i)=>t.classList.toggle('active',names[i]===name));document.querySelectorAll('.right-panel-content').forEach(p=>p.classList.remove('active'));document.getElementById(`rp-${name}`)?.classList.add('active');if(name==='terminal')document.getElementById('term-input')?.focus();}

// ── Notifications ─────────────────────────────
function notify(text,type='info'){const box=document.getElementById('notifs');if(!box)return;const el=document.createElement('div');el.className=`notif ${type}`;el.textContent=text;box.appendChild(el);setTimeout(()=>el.remove(),3000);}

// ── Modals ────────────────────────────────────
function showModal(id){const el=document.getElementById(id);if(el)el.style.display='flex';}
function closeModal(id){const el=document.getElementById(id);if(el)el.style.display='none';}
function copyUrl(){navigator.clipboard.writeText(location.href).then(()=>notify('URL copied!','success'));}

// ── Utils ─────────────────────────────────────
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function detectLang(fp){const e=fp?.split('.').pop()?.toLowerCase();return{js:'javascript',ts:'typescript',jsx:'javascript',tsx:'typescript',py:'python',rb:'ruby',go:'go',rs:'rust',java:'java',cs:'csharp',cpp:'cpp',c:'c',h:'c',html:'html',css:'css',scss:'scss',less:'less',json:'json',yaml:'yaml',yml:'yaml',md:'markdown',sh:'shell',bash:'shell',sql:'sql',graphql:'graphql',php:'php',swift:'swift',kt:'kotlin',dart:'dart',vue:'html',svelte:'html',dockerfile:'dockerfile',toml:'ini',xml:'xml',r:'r',lua:'lua'}[e]||'plaintext';}

// ── Keyboard ──────────────────────────────────
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveFile();}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='F'){e.preventDefault();toggleSearch();}
  if(e.key==='Escape'){document.querySelectorAll('.modal-bg').forEach(m=>{if(m.id!=='join-modal')m.style.display='none';});hideCtx();closeSearch();}
});

// ── beforeunload — proper unsaved warning ──────
window.addEventListener('beforeunload', e => {
  if (pendingModified.size > 0) {
    e.preventDefault();
    e.returnValue = ''; // Browser shows "Leave site? Changes may not be saved."
    // Do NOT save here — that was causing the corruption bug
  }
});

// Modal bg click
document.querySelectorAll('.modal-bg').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m&&m.id!=='join-modal')closeModal(m.id);});});

// ── Settings tabs ────────────────────────────
function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('stab-' + tab)?.classList.add('active');
  document.getElementById('settings-editor').style.display = tab === 'editor' ? '' : 'none';
  document.getElementById('settings-session').style.display = tab === 'session' ? '' : 'none';
  if (tab === 'session') loadSessionSettings();
}

async function loadSessionSettings() {
  const nonHost = document.getElementById('non-host-notice');
  const hostSet = document.getElementById('host-settings');
  if (nonHost) nonHost.style.display = myIsHost ? 'none' : '';
  if (hostSet) hostSet.style.display = myIsHost ? '' : 'none';
  if (!myIsHost) return;

  // Load current config
  try {
    const r = await apiFetch('/api/info');
    const d = await r.json();
    const status = document.getElementById('session-pw-status');
    if (status) status.textContent = d.hasRoomPassword ? 'set ✓' : 'not set';
    const nameEl = document.getElementById('session-name');
    if (nameEl) nameEl.value = d.serverName || 'CodeV';
    const wsEl = document.getElementById('session-workspace');
    if (wsEl) wsEl.value = myWorkspace || '';
  } catch {}
}

async function updateRoomPassword() {
  if (!myIsHost) return;
  const pw = document.getElementById('session-pw')?.value || '';
  try {
    await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ roomPassword: pw }) });
    // Broadcast to all via WS
    wsSend({ type: 'update_config', config: { roomPassword: pw } });
    notify(pw ? 'Room password set ✓' : 'Room password removed', 'success');
    const status = document.getElementById('session-pw-status');
    if (status) status.textContent = pw ? 'set ✓' : 'not set';
    document.getElementById('session-pw').value = '';
  } catch { notify('Failed to update password', 'error'); }
}

async function updateServerName() {
  if (!myIsHost) return;
  const name = document.getElementById('session-name')?.value.trim();
  if (!name) return;
  try {
    await apiFetch('/api/config', { method: 'POST', body: JSON.stringify({ serverName: name }) });
    wsSend({ type: 'update_config', config: { serverName: name } });
    notify('Server name updated', 'success');
  } catch { notify('Failed', 'error'); }
}

async function updateWorkspace() {
  if (!myIsHost) return;
  const p = document.getElementById('session-workspace')?.value.trim();
  if (!p) return;
  const r = await apiFetch('/api/files/open-folder', { method: 'POST', body: JSON.stringify({ path: p }) });
  const d = await r.json();
  if (d.ok) {
    myWorkspace = d.path;
    wsSend({ type: 'set_workspace', path: d.path });
    refreshTree();
    notify('Workspace updated', 'success');
  } else notify(d.error || 'Invalid path', 'error');
}

// ── Open settings modal helper ────────────────
const _origShowModal = showModal;
window.showModal = function(id) {
  if (id === 'settings-modal') {
    // Reset to editor tab
    switchSettingsTab('editor');
  }
  _origShowModal(id);
};

// ── Split editor label ────────────────────────
function addSplitLabel(pane, text) {
  const el = document.getElementById(pane === 1 ? 'pane-primary' : 'pane-secondary');
  if (!el) return;
  let label = el.querySelector('.split-label');
  if (!label) { label = document.createElement('div'); label.className = 'split-label'; el.prepend(label); }
  label.textContent = text;
}

// Override toggleSplitEditor to add labels
const _origToggleSplit = toggleSplitEditor;
window.toggleSplitEditor = function(enable) {
  _origToggleSplit(enable);
  if (enable) {
    addSplitLabel(1, 'Primary Editor');
    addSplitLabel(2, 'Secondary Editor — right-click file → Open in Split');
  } else {
    document.querySelectorAll('.split-label').forEach(l => l.remove());
  }
};

// ── Restore closes diff ───────────────────────
const _origRestoreVersion = restoreVersion;
window.restoreVersion = function(fp, v) {
  _origRestoreVersion(fp, v);
  // Close diff view after restore
  setTimeout(() => { if (showingDiff) closeDiff(); }, 500);
};

// ── Theme change updates editor2 ──────────────
const _origSetTheme = setTheme;
window.setTheme = function(name, sync = true) {
  _origSetTheme(name, sync);
  if (editor2) editor2.updateOptions({ theme: 'codev-' + name });
  if (diffEditor) diffEditor.updateOptions({ theme: 'codev-' + name });
};

// ── Start ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', initWelcome);
