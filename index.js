require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');

// ─── Validación de variables de entorno ───────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Falta GEMINI_API_KEY en el archivo .env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Sesiones de usuario en memoria ───────────────────────────────────────────
const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { state: 'ai', history: [] });
  }
  return sessions.get(phone);
}

// ─── Prompt del sistema ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el asistente de Velum Detective, agencia de detectives privados en Ibiza. Atiendes consultas por WhatsApp.

SOBRE LA AGENCIA:
- Detective habilitado con número TIP oficial
- Más de 400 casos resueltos en Ibiza en 15 años
- Servicios: investigación de infidelidad, seguimiento y vigilancia, informes probatorios con validez jurídica
- Cobertura: toda Ibiza, Formentera y Baleares — clubs VIP, villas privadas, hoteles de lujo — 24h, 7 días
- Respuesta garantizada en menos de 2 horas
- Secreto profesional absoluto, LOPD, datos destruidos al cierre del caso
- Seguro de responsabilidad civil activo

TONO:
- Eres humano, cercano pero serio. No eres un robot ni uses listas con asteriscos constantemente.
- Habla como lo haría un profesional de confianza: calmado, directo, discreto.
- Frases cortas. Sin florituras. Sin emojis en exceso.
- El cliente probablemente está pasando por un momento difícil — trátalo con respeto y sin juzgar.
- Siempre en español.

REGLAS:
- Nunca des precios concretos. Si preguntan, di que el presupuesto se hace a medida tras conocer el caso.
- Nunca prometas resultados específicos.
- No uses markdown ni negritas salvo que sea muy necesario para claridad.
- Si el cliente quiere hablar directamente con el detective, dile que escriba "detective" y le atenderá en persona.
- Cuando el cliente haya explicado su situación, confirma que el detective le contactará en menos de 2 horas.

FLUJO NATURAL:
- Al primer mensaje, saluda brevemente y pregunta en qué puedes ayudar.
- Escucha. Haz preguntas una a una, no un interrogatorio.
- Si preguntan por servicios, explícalos de forma conversacional, no como una lista de catálogo.
- Cuando tengas suficiente contexto del caso, cierra con: confirmación de que el detective lo atenderá pronto.`;

// ─── Texto de handoff al detective ────────────────────────────────────────────
const DIRECT_TEXT = `De acuerdo. El detective leerá tu conversación y te responderá personalmente en menos de 2 horas.\n\nLo que me has contado queda en absoluta reserva.`;

// ─── Llamada a Gemini ─────────────────────────────────────────────────────────
async function askGemini(session, userMessage) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT
  });

  const recentHistory = session.history.slice(-12);
  const chat = model.startChat({ history: recentHistory });
  const result = await chat.sendMessage(userMessage);
  const reply = result.response.text();

  session.history.push({ role: 'user',  parts: [{ text: userMessage }] });
  session.history.push({ role: 'model', parts: [{ text: reply }] });

  return reply;
}

// ─── Cliente WhatsApp ──────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }
});

// ─── Servidor QR (para escanear en navegador) ─────────────────────────────────
let currentQR = null;
const PORT = process.env.PORT || 3000;

const qrServer = http.createServer(async (req, res) => {
  if (currentQR) {
    const imgData = await QRCode.toDataURL(currentQR, { width: 400 });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Velum Bot — Escanea el QR</title>
    <meta http-equiv="refresh" content="10">
    <style>
      body { background:#111; display:flex; flex-direction:column;
             align-items:center; justify-content:center; height:100vh;
             margin:0; font-family:sans-serif; color:white; }
      img  { border:8px solid white; border-radius:12px; }
      p    { margin-top:20px; font-size:14px; opacity:0.6; }
    </style>
  </head>
  <body>
    <h2>📱 Escanea con WhatsApp</h2>
    <img src="${imgData}" />
    <p>Menú de WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
    <p>Esta página se refresca sola cada 10 segundos</p>
  </body>
</html>`);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>Velum Bot</title></head>
  <body style="background:#111;color:white;font-family:sans-serif;
               display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <h2>✅ Bot conectado y operativo</h2>
  </body>
</html>`);
  }
});

qrServer.listen(PORT, () => {
  console.log(`🌐 Servidor QR disponible en el puerto ${PORT}`);
});

// ─── Eventos del cliente ───────────────────────────────────────────────────────
client.on('qr', qr => {
  currentQR = qr;
  console.log('📱 QR generado — abre el servidor en el navegador para escanearlo');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  currentQR = null;
  console.log('✅ Bot Velum Detective conectado y operativo');
});

client.on('auth_failure', () => {
  console.error('❌ Fallo de autenticación. Borra la carpeta ./session y reinicia.');
});

client.on('disconnected', reason => {
  console.warn('⚠️  Bot desconectado:', reason);
});

// ─── Lógica de mensajes ────────────────────────────────────────────────────────
async function handleMessage(msg) {
  if (msg.from.includes('@g.us')) return;
  if (msg.from === 'status@broadcast') return;
  if (msg.fromMe) return;

  const phone = msg.from;
  const text = msg.body.trim().toLowerCase();
  const session = getSession(phone);

  try {
    if (text === 'detective') {
      session.state = 'direct';
      await msg.reply(DIRECT_TEXT);
      return;
    }

    if (session.state === 'direct') return;

    const aiReply = await askGemini(session, msg.body.trim());
    await msg.reply(aiReply);

  } catch (err) {
    console.error(`Error [${phone}]:`, err.message);
    await msg.reply('Ha habido un problema técnico. Inténtalo de nuevo en un momento.');
  }
}

client.on('message', async msg => {
  await handleMessage(msg);
});

// ─── Arranque ─────────────────────────────────────────────────────────────────
console.log('🔄 Iniciando bot Velum Detective...');
client.initialize();
