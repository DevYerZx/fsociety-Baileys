const fs = require('fs');
const path = require('path');

function listCommandFiles(baseDir = __dirname) {
  const files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.name.endsWith('.js')) continue;
      if (full === __filename) continue;
      files.push(full);
    }
  }

  walk(baseDir);
  return files;
}

module.exports = {
  listCommandFiles,
};
