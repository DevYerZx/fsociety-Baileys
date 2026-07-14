require('dotenv').config();

const pino = require('pino');
const readline = require('readline');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  DisconnectReason,
} = require('./lib');
const { Boom } = require('@hapi/boom');
const { reloadCommands } = require('./utils/reloadCommands');

const PREFIX = process.env.BOT_PREFIX || '.';
const OWNER_NUMBER = String(process.env.OWNER_NUMBER || '').replace(/\D/g, '');
const BOT_NUMBER = String(process.env.BOT_NUMBER || '').replace(/\D/g, '');
const AUTH_FOLDER = process.env.AUTH_FOLDER || 'auth_info_baileys';

function normalizeNumber(value = '') {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function getMessageText(msg = {}) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

function askQuestion(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function getPairingTargetNumber() {
  if (BOT_NUMBER) return BOT_NUMBER;

  const input = await askQuestion('Numero para vincular (ej: 51912345678): ');
  const parsed = String(input || '').replace(/\D/g, '');
  if (!parsed) throw new Error('Numero invalido para vinculacion por codigo.');
  return parsed;
}

function isOwner(jid = '') {
  const sender = normalizeNumber(jid);
  if (!sender) return false;
  if (!OWNER_NUMBER) return false;
  return sender === OWNER_NUMBER;
}

async function startBot() {
  reloadCommands();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const versionInfo =
    typeof fetchLatestWaWebVersion === 'function'
      ? await fetchLatestWaWebVersion().catch(() => null)
      : null;
  const fallbackVersionInfo = await fetchLatestBaileysVersion().catch(() => null);
  const version =
    versionInfo?.version ||
    fallbackVersionInfo?.version ||
    [2, 3000, 1015901307];

  const sock = makeWASocket({
    version,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: ['FSOCIETY BOT', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('Bot conectado correctamente.');
      return;
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexion cerrada:', statusCode, '| reconectar:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => startBot().catch(console.error), 2000);
      }
      return;
    }

    if (connection === 'connecting') {
      console.log('Conectando...');
    }
  });

  if (!sock.authState.creds.registered) {
    try {
      const number = await getPairingTargetNumber();
      const code = await sock.requestPairingCode(number);
      console.log(`\nCodigo de vinculacion: ${code}`);
      console.log('En WhatsApp: Dispositivos vinculados > Vincular con numero.\n');
    } catch (err) {
      console.error('No pude generar el codigo de vinculacion:', err.message);
    }
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const m = messages?.[0];
    if (!m || m.key.fromMe) return;

    const from = m.key.remoteJid;
    const sender = m.key.participant || from;
    const body = getMessageText(m).trim();
    if (!body || !body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = String(args.shift() || '').toLowerCase();
    if (!commandName) return;

    const cmd = global.comandos?.get(commandName);
    if (!cmd) return;

    const creator = isOwner(sender);
    if (cmd.isOwner && !creator) {
      await sock.sendMessage(from, { text: 'Solo el owner puede usar este comando.' }, { quoted: m });
      return;
    }

    try {
      await cmd.run(sock, m, args, from, creator);
    } catch (error) {
      console.error(`Error ejecutando comando ${commandName}:`, error);
      await sock.sendMessage(from, { text: 'Error al ejecutar el comando.' }, { quoted: m });
    }
  });
}

startBot().catch((err) => {
  console.error('Error iniciando bot:', err);
});
