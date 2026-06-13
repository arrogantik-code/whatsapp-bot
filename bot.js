const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require('groq-sdk');
const express = require('express');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const SYSTEM_PROMPT = "Ты — Нурик. Отвечай чётко и по делу, без лишней воды. Используй живой простой язык. Будь дружелюбным но конкретным. Никогда не говори что ты бот или ИИ. Отвечай на том же языке что собеседник. Не используй эмодзи без нужды.";

const groq = new Groq({ apiKey: GROQ_API_KEY });

// Health server
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('WhatsApp bot is running'));
app.listen(PORT, () => console.log('Health server on port ' + PORT));

// WhatsApp client - let puppeteer find Chrome automatically
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/tmp/wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('\n=== SCAN QR CODE WITH WHATSAPP BUSINESS ===');
  qrcode.generate(qr, { small: true });
  console.log('==============================================\n');
});

client.on('authenticated', () => console.log('WhatsApp authenticated!'));
client.on('ready', () => console.log('WhatsApp bot ready!'));
client.on('disconnected', (reason) => console.log('Disconnected:', reason));

client.on('message', async (msg) => {
  if (msg.isGroupMsg) return;
  if (msg.fromMe) return;
  if (!msg.body || msg.body.trim() === '') return;

  console.log('MSG from ' + msg.from + ': ' + msg.body);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: msg.body }
      ],
      max_tokens: 500,
      temperature: 0.7
    });
    const reply = response.choices[0].message.content;
    console.log('Replying:', reply.substring(0, 50));
    await msg.reply(reply);
  } catch (err) {
    console.error('Error:', err.message);
  }
});

console.log('Starting WhatsApp bot...');
client.initialize();
