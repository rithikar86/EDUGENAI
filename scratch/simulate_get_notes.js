const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

async function simulateGetNotes() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  const userId = new ObjectId('6a9a9885649a05ba1f692218');
  const notes = await db.collection("notes")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  const mapped = notes.map((note) => ({
    id: note._id.toString(),
    materialId: note.materialId ? note.materialId.toString() : null,
    title: note.title,
    content: note.content,
    type: note.type || "smart-notes",
    weakTopic: note.weakTopic || null,
    weakSubtopic: note.weakSubtopic || null,
    sourceFileName: note.sourceFileName || null,
    topics: note.topics || [],
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }));

  console.log(`GET /api/notes returns ${mapped.length} notes:`);
  mapped.forEach((n, idx) => {
    if (n.type === 'youtube-notes' || (n.title && n.title.includes('YouTube'))) {
      console.log(`  [${idx}] id: ${n.id}, type: ${n.type}, title: ${n.title}, sourceFileName: ${n.sourceFileName}`);
    }
  });

  await client.close();
}

simulateGetNotes();
