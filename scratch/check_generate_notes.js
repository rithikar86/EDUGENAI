const { MongoClient, ObjectId } = require('mongodb');
const Groq = require('groq-sdk');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

// Check how generateSmartNotes is implemented in server.js
const fs = require('fs');
const code = fs.readFileSync('D:/EduGenAI/server/server.js', 'utf8');

const startIdx = code.indexOf('async function generateSmartNotes');
const endIdx = code.indexOf('async function generateFlashcards', startIdx);
console.log(code.substring(startIdx, startIdx + 1200));
