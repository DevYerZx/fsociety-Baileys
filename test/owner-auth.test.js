'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isOwnerJid, isOwnerMessage } = require('../utils/ownerAuth');

const OWNER = '51900000000';

test('never treats the numeric part of a LID as a phone number', () => {
  assert.equal(isOwnerJid(`${OWNER}@lid`, OWNER), false);
});

test('unknown group LID is denied instead of becoming the bot/owner JID', async () => {
  const sock = { groupMetadata: async () => ({ participants: [] }) };
  const message = { key: { remoteJid: '123@g.us', participant: '777@lid' } };
  assert.equal(await isOwnerMessage(sock, message, OWNER), false);
});

test('owner LID is accepted only through a confirmed group mapping', async () => {
  const sock = {
    groupMetadata: async () => ({
      participants: [{ id: '777@lid', lid: '777@lid', jid: `${OWNER}@s.whatsapp.net` }]
    })
  };
  const message = { key: { remoteJid: '123@g.us', participant: '777@lid' } };
  assert.equal(await isOwnerMessage(sock, message, OWNER), true);
});

test('explicit sender phone number is accepted', async () => {
  const message = { key: { remoteJid: '123@g.us', participant: '777@lid', senderPn: `${OWNER}@s.whatsapp.net` } };
  assert.equal(await isOwnerMessage({}, message, OWNER), true);
});

test('owner is resolved from the persistent signal LID mapping', async () => {
  const sock = {
    signalRepository: { lidMapping: { getPNForLID: async () => `${OWNER}@s.whatsapp.net` } }
  };
  const message = { key: { remoteJid: '777@lid', senderLid: '777@lid' } };
  assert.equal(await isOwnerMessage(sock, message, OWNER), true);
});
