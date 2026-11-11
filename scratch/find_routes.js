const fs = require('fs');
const code = fs.readFileSync('D:/EduGenAI/server/server.js', 'utf8');

const terms = ['upload-youtube', 'fetchTranscript', 'generate-notes', 'app.get("/api/notes', 'app.post("/api/notes', 'collection("materials")', 'collection("notes")'];
terms.forEach(t => {
  let count = 0;
  let idx = 0;
  const lines = [];
  while ((idx = code.indexOf(t, idx)) !== -1) {
    count++;
    lines.push(code.substring(0, idx).split('\n').length);
    idx += t.length;
    if (count > 5) break;
  }
  console.log(t + ' -> count: ' + count + ', lines: ' + lines.join(', '));
});
