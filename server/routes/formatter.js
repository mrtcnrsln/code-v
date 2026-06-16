const express = require('express');
const path = require('path');

module.exports = function(WORKSPACE) {
  const router = express.Router();

  // POST /api/format  { content, language, filePath }
  router.post('/', async (req, res) => {
    const { content, language, filePath } = req.body;
    if (!content) return res.json({ formatted: content });

    try {
      let formatted = content;

      // Prettier handles: js, ts, jsx, tsx, css, scss, html, json, md, yaml, graphql
      const prettierLangs = {
        javascript: 'babel', typescript: 'typescript',
        jsx: 'babel', tsx: 'typescript',
        css: 'css', scss: 'scss', less: 'less',
        html: 'html', json: 'json', markdown: 'markdown',
        yaml: 'yaml', graphql: 'graphql'
      };

      if (prettierLangs[language]) {
        try {
          const prettier = require('prettier');
          // Try to find local prettier config
          let configFile = null;
          try {
            configFile = await prettier.resolveConfigFile(
              filePath ? path.resolve(WORKSPACE, filePath) : WORKSPACE
            );
          } catch {}

          const config = configFile
            ? await prettier.resolveConfig(configFile)
            : {};

          formatted = await prettier.format(content, {
            ...config,
            parser: prettierLangs[language],
            printWidth: config.printWidth || 100,
            tabWidth: config.tabWidth || 2,
            useTabs: config.useTabs || false,
            semi: config.semi !== false,
            singleQuote: config.singleQuote || false,
            trailingComma: config.trailingComma || 'es5',
          });
        } catch (e) {
          // Prettier parse error — return original with error
          return res.json({ formatted: content, error: e.message });
        }
      }

      res.json({ formatted });
    } catch (e) {
      res.status(500).json({ error: e.message, formatted: content });
    }
  });

  // GET /api/format/config  — get prettier config for current workspace
  router.get('/config', async (req, res) => {
    try {
      const prettier = require('prettier');
      const configFile = await prettier.resolveConfigFile(WORKSPACE).catch(() => null);
      const config = configFile ? await prettier.resolveConfig(configFile) : null;
      res.json({ config, configFile });
    } catch {
      res.json({ config: null });
    }
  });

  return router;
};
