const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require('groq-sdk');
const express = require('express');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('WhatsApp bot is running!'));
app.listen(PORT, () => console.log('Health server on port ' + PORT));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = 'Ты — Нурик. Отвечай чётко и по делу, без лишней воды. Используй живой простой язык. Будь дружелюбным но конкретным. Никогда не говори что ты бот или ИИ. Отвечай на том же языке что собеседник. Не используй эмодзи без нужды.';

const conversationHistory = {};

// Find Chrome executable
function getChromePath() {
  const paths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    process.env.CHROME_PATH
  ].filter(Boolean);
  
  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log('Found Chrome at:', p);
      return p;
    }
  }
  
  // Check puppeteer cache
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || process.env.HOME + '/.cache/puppeteer';
  if (fs.existsSync(cacheDir)) {
    const items = fs.readdirSync(cacheDir);
    console.log('Puppeteer cache contents:', items);
  }
  
  console.log('No system Chrome found, using puppeteer default');
  return null;
}

console.log('Starting WhatsApp bot...');
console.log('Node version:', process.version);
console.log('PUPPETEER_CACHE_DIR:', process.env.PUPPETEER_CACHE_DIR);

const chromePath = getChromePath();
console.log('Chrome path:', chromePath);

const puppeteerArgs = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking'
  ]
};

if (chromePath) {
  puppeteerArgs.executablePath = chromePath;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/tmp/wwebjs_auth' }),
  puppeteer: puppeteerArgs
});

client.on('qr', (qr) => {
  console.log('\n=== QR CODE - SCAN WITH WHATSAPP BUSINESS ===');
  qrcode.generate(qr, { small: true });
  console.log('=== END QR CODE ===\n');
});

client.on('authenticated', () => {
  console.log('WhatsApp authenticated!');
});

client.on('ready', () => {
  console.log('WhatsApp client is ready! Bot is active.');
});

client.on('auth_failure', (msg) => {
  console.error('Auth failure:', msg);
});

client.on('disconnected', (reason) => {
  console.log('Client disconnected:', reason);
  setTimeout(() => {
    console.log('Reconnecting...');
    client.initialize();
  }, 5000);
});

client.on('message', async (msg) => {
  if (msg.from.includes('@g.us')) return;
  if (msg.fromMe) return;
  if (!msg.body || msg.body.trim() === '') return;
  
  const sender = msg.from;
  const text = msg.body;
  console.log('Message from', sender, ':', text);
  
  if (!conversationHistory[sender]) conversationHistory[sender] = [];
  conversationHistory[sender].push({ role: 'user', content: text });
  if (conversationHistory[sender].length > 20) {
    conversationHistory[sender] = conversationHistory[sender].slice(-20);
  }
  
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...conversationHistory[sender]],
      max_tokens: 500,
      temperature: 0.7
    });
    
    const reply = completion.choices[0].message.content;
    conversationHistory[sender].push({ role: 'assistant', content: reply });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    await msg.reply(reply);
    console.log('Replied:', reply.substring(0, 50));
  } catch (err) {
    console.error('Groq error:', err.message);
  }
});

client.initialize();
