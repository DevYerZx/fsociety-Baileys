'use strict';

function normalizeNumber(value = '') {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function isOwnerJid(jid = '', ownerNumber = '') {
  if (String(jid || '').endsWith('@lid')) return false;
  const sender = normalizeNumber(jid);
  const owner = normalizeNumber(ownerNumber);
  return Boolean(sender && owner && sender === owner);
}

async function isOwnerMessage(sock, message = {}, ownerNumber = '', onWarn = () => {}) {
  const key = message.key || {};
  const candidates = [key.senderPn, key.participant, key.remoteJid]
    .filter((jid) => jid && !String(jid).endsWith('@lid'));

  if (candidates.some((jid) => isOwnerJid(jid, ownerNumber))) return true;

  const lid = key.participantLid
    || (String(key.participant || '').endsWith('@lid') ? key.participant : '')
    || key.senderLid
    || (String(key.remoteJid || '').endsWith('@lid') ? key.remoteJid : '');

  if (!lid || !String(key.remoteJid || '').endsWith('@g.us')) return false;

  try {
    const metadata = await sock.groupMetadata(key.remoteJid);
    const participant = metadata?.participants?.find((entry) =>
      [entry.id, entry.lid].some((value) => value && normalizeNumber(value) === normalizeNumber(lid))
    );
    return isOwnerJid(participant?.jid, ownerNumber);
  } catch (error) {
    onWarn(`No se pudo resolver el LID ${lid}; se deniega permiso owner por seguridad.`);
    return false;
  }
}

module.exports = { normalizeNumber, isOwnerJid, isOwnerMessage };
