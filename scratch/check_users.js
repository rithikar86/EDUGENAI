const { MongoClient } = require('mongodb');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

async function checkUsers() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();

  console.log('--- Checking Users ---');
  const users = await db.collection('users').find({}).toArray();
  console.log(`Found ${users.length} users:`);
  users.forEach(u => {
    console.log(`  _id: ${u._id}, email: ${u.email}, name: ${u.name}`);
  });

  await client.close();
}

checkUsers();
