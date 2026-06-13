const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const Groq = require('groq-sdk');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

let currentQR = null;
let botStatus = 'waiting_qr';

app.get('/', async (req, res) => {
  if (botStatus === 'connected') {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px"><h1>WhatsApp Bot Active</h1><p>Bot is connected and running!</p></body></html>');
  }
  if (!currentQR) {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px"><h1>WhatsApp Bot Starting...</h1><p>QR code not ready yet, refresh in a few seconds.</p></body></html>');
  }
  try {
    const qrDataUrl = await QRCode.toDataURL(currentQR, { width: 400, margin: 2 });
    res.send('<html><body style="font-family:sans-serif;text-align:center;padding:30px;background:#f0f0f0"><h1>WhatsApp Bot QR Code</h1><p>Scan this with WhatsApp Business app on +77087181350:</p><br><img src="' + qrDataUrl + '" style="border:5px solid #25D366;border-radius:10px"><br><p style="color:#666;margin-top:20px">QR code expires in ~60 seconds. Refresh page if expired.</p></body></html>');
  } catch(e) {
    res.send('QR Error: ' + e.message);
  }
});

app.listen(PORT, () => console.log('Health server on port ' + PORT));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = 'Ты — Нурик. Отвечай чётко и по делу, без лишней воды. Используй живой простой язык. Будь дружелюбным но конкретным. Никогда не говори что ты бот или ИИ. Отвечай на том же языке что собеседник. Не используй эмодзи без нужды.';

const conversationHistory = {};
const AUTH_DIR = '/tmp/baileys_auth';

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  
  console.log('Connecting with Baileys version:', version.join('.'));
  
  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      currentQR = qr;
      botStatus = 'waiting_qr';
      console.log('\n=== QR CODE - SCAN WITH WHATSAPP BUSINESS APP ===');
      qrcode.generate(qr, { small: true });
      console.log('=== END QR CODE ===');
      console.log('Also available at: https://whatsapp-bot-8mhw.onrender.com');
    }
    
    if (connection === 'close') {
      currentQR = null;
      const shouldReconnect = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;
      
      console.log('Connection closed. Reason:', lastDisconnect?.error?.message);
      
      if (shouldReconnect) {
        console.log('Reconnecting in 5 seconds...');
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log('Logged out. Clearing auth and reconnecting...');
        botStatus = 'waiting_qr';
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch(e) {}
        setTimeout(connectToWhatsApp, 5000);
      }
    }
    
    if (connection === 'open') {
      currentQR = null;
      botStatus = 'connected';
      console.log('WhatsApp connected! Bot is active.');
    }
  });
  
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;
      
      const jid = msg.key.remoteJid;
      if (!jid) continue;
      if (jid.includes('@g.us')) continue;
      
      const text = msg.message?.conversation 
        || msg.message?.extendedTextMessage?.text 
        || '';
      
      if (!text.trim()) continue;
      
      console.log('Message from', jid, ':', text);
      
      if (!conversationHistory[jid]) conversationHistory[jid] = [];
      conversationHistory[jid].push({ role: 'user', content: text });
      if (conversationHistory[jid].length > 20) {
        conversationHistory[jid] = conversationHistory[jid].slice(-20);
      }
      
      try {
        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...conversationHistory[jid]],
          max_tokens: 500,
          temperature: 0.7
        });
        
        const reply = completion.choices[0].message.content;
        conversationHistory[jid].push({ role: 'assistant', content: reply });
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        await sock.sendMessage(jid, { text: reply });
        console.log('Replied:', reply.substring(0, 60));
      } catch (err) {
        console.error('Error:', err.message);
      }
    }
  });
  
  return sock;
}

console.log('Starting WhatsApp bot with Baileys...');
connectToWhatsApp().catch(console.error);
