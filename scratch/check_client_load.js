const fs = require('fs');

const flashcardsCode = fs.readFileSync('D:/EduGenAI/client/src/pages/Flashcards.jsx', 'utf8');
console.log('--- Flashcards.jsx ---');
['selectedFlashcardNote', 'activeMaterialId', '/api/generate-flashcards', '/api/materials'].forEach(t => {
  console.log(t, flashcardsCode.includes(t));
});

const quizCode = fs.readFileSync('D:/EduGenAI/client/src/pages/Quiz.jsx', 'utf8');
console.log('--- Quiz.jsx ---');
['selectedQuizNote', 'activeMaterialId', '/api/generate-quiz', '/api/materials'].forEach(t => {
  console.log(t, quizCode.includes(t));
});
