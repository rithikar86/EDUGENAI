const fs = require('fs');
const path = require('path');

function searchClient(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      if (f !== 'node_modules' && f !== 'dist') searchClient(full);
    } else if (f.endsWith('.js') || f.endsWith('.jsx')) {
      const code = fs.readFileSync(full, 'utf8');
      const lines = code.split('\n');
      lines.forEach((l, idx) => {
        if (l.includes('fetch(') || l.includes('axios.')) {
          console.log(`${path.basename(full)}:${idx + 1}: ${l.trim()}`);
        }
      });
    }
  }
}

searchClient('D:/EduGenAI/client/src');
