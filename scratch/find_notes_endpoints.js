const fs = require('fs');
const code = fs.readFileSync('D:/EduGenAI/server/server.js', 'utf8');

const regex = /app\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g;
let m;
while ((m = regex.exec(code)) !== null) {
  if (m[2].includes('note') || m[2].includes('material') || m[2].includes('youtube')) {
    console.log(m[1].toUpperCase() + ' ' + m[2] + ' at line ' + code.substring(0, m.index).split('\n').length);
  }
}
