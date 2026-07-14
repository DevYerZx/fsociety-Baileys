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
const FALLBACK_VERSION = [2, 3000, 1015901307];
const PAIRING_405_COOLDOWN_MS = 40 * 60 * 1000;
const PAIRING_RETRY_GUARD_MS = 15 * 1000;
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;

let activeSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let startInFlight = null;
let pairingCooldownUntil = 0;
let lastPairingAttemptAt = 0;

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

function logInfo(text) {
  console.log(`[fsociety-baileys] ${text}`);
}

function logWarn(text) {
  console.warn(`[fsociety-baileys] ${text}`);
}

function logError(text, error) {
  if (error) {
    console.error(`[fsociety-baileys] ${text}`, error);
    return;
  }
  console.error(`[fsociety-baileys] ${text}`);
}

function explainNodeVersion() {
  const major = Number(process.versions.node.split('.')[0] || 0);
  if (major === 20 || major === 22) {
    logInfo(`Node ${process.version} detectado.`);
    return;
  }
  logWarn(`Node ${process.version} detectado. Recomendado: Node 20 LTS o 22 LTS.`);
}

function getDisconnectCode(lastDisconnect) {
  const statusCode = Number(new Boom(lastDisconnect?.error)?.output?.statusCode || 0);
  if (statusCode) return statusCode;

  const text = String(lastDisconnect?.error?.message || lastDisconnect?.error || '').toLowerCase();
  if (text.includes('logged out')) return Number(DisconnectReason.loggedOut || 401) || 401;
  if (text.includes('connection replaced')) return Number(DisconnectReason.connectionReplaced || 440) || 440;
  const match = text.match(/\b(4\d{2}|5\d{2})\b/);
  return match?.[1] ? Number(match[1]) : 0;
}

function getDisconnectText(lastDisconnect) {
  return String(lastDisconnect?.error?.message || lastDisconnect?.error || 'sin detalle').trim();
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(reason, code = 0) {
  if (reconnectTimer) {
    logInfo(`Reconexión ya programada. Motivo actual: ${reason}.`);
    return;
  }

  reconnectAttempts += 1;
  const exponent = Math.max(0, reconnectAttempts - 1);
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** exponent), RECONNECT_MAX_DELAY_MS);

  logWarn(`Programando reconexión en ${Math.ceil(delay / 1000)}s. Motivo: ${reason}${code ? ` (${code})` : ''}.`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch((error) => logError('Fallo en reconexión.', error));
  }, delay);
}

async function resolveSocketVersion() {
  const waWeb =
    typeof fetchLatestWaWebVersion === 'function'
      ? await fetchLatestWaWebVersion().catch((error) => ({
          version: null,
          isLatest: false,
          error,
        }))
      : null;

  if (Array.isArray(waWeb?.version) && waWeb.version.length >= 3) {
    return {
      version: waWeb.version.slice(0, 3).map((item) => Number(item)),
      source: 'waweb',
      isLatest: Boolean(waWeb?.isLatest),
    };
  }

  const fallback = await fetchLatestBaileysVersion().catch((error) => ({
    version: null,
    isLatest: false,
    error,
  }));

  if (Array.isArray(fallback?.version) && fallback.version.length >= 3) {
    return {
      version: fallback.version.slice(0, 3).map((item) => Number(item)),
      source: 'baileys-fallback',
      isLatest: Boolean(fallback?.isLatest),
      error: waWeb?.error || null,
    };
  }

  return {
    version: [...FALLBACK_VERSION],
    source: 'hardcoded-fallback',
    isLatest: false,
    error: waWeb?.error || fallback?.error || null,
  };
}

async function maybeRequestPairingCode(sock) {
  if (sock.authState.creds.registered) {
    return;
  }

  const now = Date.now();
  if (pairingCooldownUntil > now) {
    const waitMinutes = Math.max(1, Math.ceil((pairingCooldownUntil - now) / 60000));
    logWarn(`Pairing pausado por cooldown 405. Espera aprox ${waitMinutes} min antes de reintentar.`);
    return;
  }

  if (now - lastPairingAttemptAt < PAIRING_RETRY_GUARD_MS) {
    logWarn('Ignoré una nueva solicitud de pairing para evitar reintentos demasiado rápidos.');
    return;
  }

  lastPairingAttemptAt = now;

  try {
    const number = await getPairingTargetNumber();
    const code = await sock.requestPairingCode(number);
    logInfo(`Código de vinculación generado para ${number}.`);
    console.log(`\nCodigo de vinculacion: ${code}`);
    console.log('En WhatsApp: Dispositivos vinculados > Vincular con numero.\n');
  } catch (err) {
    const message = String(err?.message || err || '');
    const code = Number(err?.output?.statusCode || err?.data?.statusCode || 0);
    if (code === 405 || /\b405\b|method not allowed|connection failure/i.test(message)) {
      pairingCooldownUntil = Date.now() + PAIRING_405_COOLDOWN_MS;
      logWarn('WhatsApp devolvió 405 al pedir pairing. Activo cooldown de 40 minutos para no forzar la cuenta.');
      return;
    }
    logError(`No pude generar el código de vinculación: ${message || 'sin detalle'}`);
  }
}

async function startBot() {
  if (startInFlight) {
    return startInFlight;
  }

  startInFlight = (async () => {
    reloadCommands();
    explainNodeVersion();
    clearReconnectTimer();

    if (activeSocket?.end) {
      try {
        activeSocket.end(new Error('socket_replaced'));
      } catch {}
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const versionInfo = await resolveSocketVersion();

    if (versionInfo.error) {
      logWarn(`Usando versión ${versionInfo.source} por fallback. Detalle: ${String(versionInfo.error?.message || versionInfo.error)}`);
    } else {
      logInfo(`Usando versión ${versionInfo.version.join('.')} desde ${versionInfo.source}.`);
    }

    const sock = makeWASocket({
      version: versionInfo.version,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      auth: state,
      browser: ['FSOCIETY BOT', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
    });

    activeSocket = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      if (activeSocket !== sock) return;

      if (connection === 'open') {
        reconnectAttempts = 0;
        pairingCooldownUntil = 0;
        logInfo('Bot conectado correctamente.');
        return;
      }

      if (connection === 'close') {
        const statusCode = getDisconnectCode(lastDisconnect);
        const reasonText = getDisconnectText(lastDisconnect);
        activeSocket = null;

        logWarn(`Conexión cerrada. Código: ${statusCode || 'sin_codigo'}. Motivo: ${reasonText || 'sin_detalle'}.`);

        if (statusCode === 405) {
          pairingCooldownUntil = Date.now() + PAIRING_405_COOLDOWN_MS;
          logWarn('Detecté 405. Pauso nuevos pairing codes por 40 minutos para proteger la sesión.');
        }

        if (
          statusCode === Number(DisconnectReason.loggedOut || 401) ||
          statusCode === 401
        ) {
          reconnectAttempts = 0;
          logWarn('La sesión quedó cerrada o inválida. No haré bucle agresivo; vuelve a vincular el bot.');
          return;
        }

        if (
          statusCode === Number(DisconnectReason.connectionReplaced || 440) ||
          statusCode === 440
        ) {
          reconnectAttempts = 0;
          logWarn('La sesión fue reemplazada por otro dispositivo. Detengo auto-reconexión para no pelear la sesión.');
          return;
        }

        scheduleReconnect('connection_close', statusCode);
        return;
      }

      if (connection === 'connecting') {
        logInfo('Conectando con WhatsApp...');
      }
    });

    await maybeRequestPairingCode(sock);

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
        logError(`Error ejecutando comando ${commandName}:`, error);
        await sock.sendMessage(from, { text: 'Error al ejecutar el comando.' }, { quoted: m });
      }
    });
  })();

  try {
    await startInFlight;
  } finally {
    startInFlight = null;
  }
}

startBot().catch((err) => {
  console.error('Error iniciando bot:', err);
});
