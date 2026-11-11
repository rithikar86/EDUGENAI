const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: 'D:/EduGenAI/server/.env' });

async function testYoutubeEndpoint() {
  const token = jwt.sign(
    { userId: '6a9a9885649a05ba1f692218', email: 'zara@gmail.com' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const testUrl = 'https://www.youtube.com/watch?v=kqtD5dpn9C8'; // Python in 100 seconds (fireship)

  console.log('Testing POST /api/youtube-transcript directly...');
  try {
    // We can test by invoking the logic directly or via server if running
    // Let's test the fetchTranscript directly first
    const { fetchTranscript } = require('youtube-transcript');
    console.log('Testing fetchTranscript...');
    const transcript = await fetchTranscript('kqtD5dpn9C8');
    console.log('Transcript length:', transcript ? transcript.length : 0);
    console.log('First 2 items:', transcript.slice(0, 2));
  } catch (err) {
    console.error('fetchTranscript error:', err.message);
  }
}

testYoutubeEndpoint();
