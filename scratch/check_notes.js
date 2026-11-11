const { MongoClient } = require('mongodb');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

async function checkDb() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  console.log('--- Checking Materials ---');
  const materials = await db.collection('materials').find({}).toArray();
  console.log(`Found ${materials.length} materials:`);
  materials.forEach(m => {
    console.log(`  _id: ${m._id}, fileType: ${m.fileType}, fileName: ${m.fileName}, youtubeUrl: ${m.youtubeUrl}, hasNotes: ${Boolean(m.notes)}`);
  });

  console.log('\n--- Checking Notes ---');
  const notes = await db.collection('notes').find({}).toArray();
  console.log(`Found ${notes.length} notes:`);
  notes.forEach(n => {
    console.log(`  _id: ${n._id}, materialId: ${n.materialId}, type: ${n.type}, title: ${n.title}, hasContent: ${Boolean(n.content)}`);
  });

  await client.close();
}

checkDb();
