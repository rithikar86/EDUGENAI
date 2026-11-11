const { MongoClient } = require('mongodb');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

async function checkYoutubeNotes() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  console.log('--- Checking YouTube Materials and their Notes ---');
  const ytMaterials = await db.collection('materials').find({ fileType: 'youtube' }).toArray();
  console.log(`Found ${ytMaterials.length} YouTube materials.`);

  for (const m of ytMaterials) {
    const notesForM = await db.collection('notes').find({ materialId: m._id }).toArray();
    console.log(`\nMaterial _id: ${m._id}`);
    console.log(`  fileName: ${m.fileName}`);
    console.log(`  userId: ${m.userId}`);
    console.log(`  youtubeUrl: ${m.youtubeUrl}`);
    console.log(`  hasNotesInMaterial: ${Boolean(m.notes)}, length: ${(m.notes || '').length}`);
    console.log(`  notes in 'notes' collection: ${notesForM.length}`);
    notesForM.forEach(n => {
      console.log(`    Note _id: ${n._id}, type: ${n.type}, userId: ${n.userId}, title: ${n.title}, content length: ${(n.content || '').length}`);
    });
  }

  // Also check if any notes have type 'youtube-notes' or title with YouTube
  console.log('\n--- Checking all notes with type "youtube-notes" or "youtube" ---');
  const ytNotes = await db.collection('notes').find({
    $or: [
      { type: 'youtube-notes' },
      { type: 'youtube' },
      { title: { $regex: /youtube/i } }
    ]
  }).toArray();
  console.log(`Found ${ytNotes.length} notes matching youtube:`);
  ytNotes.forEach(n => {
    console.log(`  _id: ${n._id}, userId: ${n.userId}, materialId: ${n.materialId}, type: ${n.type}, title: ${n.title}`);
  });

  await client.close();
}

checkYoutubeNotes();
