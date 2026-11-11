const { MongoClient } = require('mongodb');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

async function checkIndexes() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  console.log('--- Notes Indexes ---');
  const noteIndexes = await db.collection('notes').indexes();
  console.log(noteIndexes);

  console.log('\n--- Materials Indexes ---');
  const matIndexes = await db.collection('materials').indexes();
  console.log(matIndexes);

  await client.close();
}

checkIndexes();
