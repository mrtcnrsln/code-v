const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  theme: 'dark',
  fontSize: 13,
  fontFamily: "'JetBrains Mono', monospace",
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  formatOnSave: true,
  minimap: true,
  stickyScroll: true,
  rulers: [],
  snippets: {},        // { trigger: { prefix, body, description } }
  tasks: [],           // { name, command, description }
  lsp: {
    enabled: true,
    languages: []      // override per-language LSP settings
  }
};

class WorkspaceConfig {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.configPath = path.join(workspacePath, '.codevrc.json');
    this.config = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.config = { ...DEFAULTS, ...raw };
      }
    } catch (e) {
      console.warn('[config] Could not load .codevrc.json:', e.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      return true;
    } catch (e) {
      return false;
    }
  }

  get(key) {
    return key ? this.config[key] : this.config;
  }

  set(key, value) {
    if (typeof key === 'object') {
      this.config = { ...this.config, ...key };
    } else {
      this.config[key] = value;
    }
    this.save();
  }

  // Default snippets by language
  getSnippets(language) {
    const builtins = {
      javascript: [
        { prefix: 'cl',  body: 'console.log($1)',          desc: 'console.log' },
        { prefix: 'cle', body: 'console.error($1)',         desc: 'console.error' },
        { prefix: 'fn',  body: 'function $1($2) {\n\t$3\n}', desc: 'function' },
        { prefix: 'afn', body: 'async function $1($2) {\n\t$3\n}', desc: 'async function' },
        { prefix: 'arr', body: 'const $1 = ($2) => {\n\t$3\n}', desc: 'arrow function' },
        { prefix: 'imp', body: "import $1 from '$2'",      desc: 'import' },
        { prefix: 'imd', body: "import { $1 } from '$2'",  desc: 'import destructure' },
        { prefix: 'us',  body: 'const [$1, set$2] = useState($3)', desc: 'useState' },
        { prefix: 'ue',  body: 'useEffect(() => {\n\t$1\n}, [$2])', desc: 'useEffect' },
        { prefix: 'try', body: 'try {\n\t$1\n} catch (e) {\n\tconsole.error(e)\n}', desc: 'try/catch' },
      ],
      typescript: [
        { prefix: 'int', body: 'interface $1 {\n\t$2\n}', desc: 'interface' },
        { prefix: 'typ', body: 'type $1 = $2',             desc: 'type alias' },
        { prefix: 'en',  body: 'enum $1 {\n\t$2\n}',       desc: 'enum' },
      ],
      python: [
        { prefix: 'def', body: 'def $1($2):\n\t$3',        desc: 'function' },
        { prefix: 'cls', body: 'class $1:\n\tdef __init__(self):\n\t\t$2', desc: 'class' },
        { prefix: 'pr',  body: 'print($1)',                 desc: 'print' },
        { prefix: 'imp', body: 'import $1',                 desc: 'import' },
        { prefix: 'fr',  body: 'from $1 import $2',         desc: 'from import' },
        { prefix: 'try', body: 'try:\n\t$1\nexcept Exception as e:\n\t$2', desc: 'try/except' },
      ],
      html: [
        { prefix: '!',   body: '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>$1</title>\n</head>\n<body>\n\t$2\n</body>\n</html>', desc: 'HTML5 boilerplate' },
        { prefix: 'div', body: '<div class="$1">$2</div>', desc: 'div' },
        { prefix: 'inp', body: '<input type="$1" name="$2" placeholder="$3">', desc: 'input' },
      ],
      css: [
        { prefix: 'flex', body: 'display: flex;\nalign-items: $1;\njustify-content: $2;', desc: 'flexbox' },
        { prefix: 'grid', body: 'display: grid;\ngrid-template-columns: $1;', desc: 'grid' },
        { prefix: 'med',  body: '@media (max-width: $1px) {\n\t$2\n}', desc: 'media query' },
      ],
    };

    const langSnippets = builtins[language] || [];
    const customSnippets = Object.entries(this.config.snippets || {})
      .filter(([, v]) => !v.language || v.language === language)
      .map(([k, v]) => ({ prefix: k, body: v.body, desc: v.description }));

    return [...langSnippets, ...customSnippets];
  }
}

module.exports = WorkspaceConfig;
