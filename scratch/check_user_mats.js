const { MongoClient } = require('mongodb');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

async function checkUserMaterials() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  const users = await db.collection('users').find({}).toArray();
  for (const u of users) {
    const mats = await db.collection('materials').find({ userId: u._id }).toArray();
    const notes = await db.collection('notes').find({ userId: u._id }).toArray();
    console.log(`\nUser ${u.email} (${u._id}):`);
    console.log(`  Materials (${mats.length}):`);
    mats.forEach(m => console.log(`    [${m.fileType}] ${m.fileName} (id: ${m._id})`));
    console.log(`  Notes (${notes.length}):`);
    notes.forEach(n => console.log(`    [${n.type}] ${n.title} (materialId: ${n.materialId})`));
  }

  await client.close();
}

checkUserMaterials();
