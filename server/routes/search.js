const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { glob } = require('glob');

module.exports = function(WORKSPACE) {
  const router = express.Router();

  function safePath(rel) {
    const full = path.resolve(WORKSPACE, rel || '');
    if (!full.startsWith(path.resolve(WORKSPACE))) throw new Error('Path traversal');
    return full;
  }

  router.post('/find', async (req, res) => {
    try {
      const { query, caseSensitive, wholeWord, useRegex,
              includePattern = '**/*', excludePattern = '' } = req.body;
      if (!query) return res.json({ results: [] });

      const ignore = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
      if (excludePattern) ignore.push(excludePattern);

      const files = await glob(includePattern, { cwd: WORKSPACE, nodir: true, ignore, absolute: false });
      const results = [];
      const maxResults = 500;

      let pattern;
      if (useRegex) {
        pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
      } else {
        let escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) escaped = `\\b${escaped}\\b`;
        pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }

      for (const file of files) {
        if (results.length >= maxResults) break;
        const full = safePath(file);
        let content;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 2 * 1024 * 1024) continue;
          content = fs.readFileSync(full, 'utf-8');
        } catch { continue; }

        const lines = content.split('\n');
        const fileMatches = [];
        lines.forEach((line, idx) => {
          pattern.lastIndex = 0;
          for (const m of line.matchAll(new RegExp(pattern.source, pattern.flags))) {
            fileMatches.push({ line: idx + 1, col: m.index + 1, text: line.trim(), matchStart: m.index, matchLen: m[0].length });
          }
        });
        if (fileMatches.length) results.push({ file, matches: fileMatches });
      }
      res.json({ results, truncated: results.length >= maxResults });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/replace', async (req, res) => {
    try {
      const { query, replacement, caseSensitive, wholeWord, useRegex, files } = req.body;
      if (!query || !files?.length) return res.json({ replaced: 0 });
      let pattern;
      if (useRegex) {
        pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
      } else {
        let escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) escaped = `\\b${escaped}\\b`;
        pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }
      let totalReplaced = 0;
      for (const file of files) {
        const full = safePath(file);
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const newContent = content.replace(pattern, replacement);
          if (newContent !== content) { fs.writeFileSync(full, newContent, 'utf-8'); totalReplaced++; }
        } catch {}
      }
      res.json({ replaced: totalReplaced });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  return router;
};
