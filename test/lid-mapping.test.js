'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { LIDMappingStore } = require('../lib/Signal/lid-mapping');
const { processHistoryMessage } = require('../lib/Utils/history');
const { useMultiFileAuthState } = require('../lib/Utils/use-multi-file-auth-state');

function memoryKeys() {
  const data = {};
  return {
    data,
    async get(type, ids) {
      return Object.fromEntries(ids.filter(id => data[type]?.[id] !== undefined).map(id => [id, data[type][id]]));
    },
    async set(update) {
      for (const [type, values] of Object.entries(update)) {
        data[type] = { ...(data[type] || {}), ...values };
      }
    }
  };
}

test('stores and resolves PN-LID mappings in both directions', async () => {
  const keys = memoryKeys();
  const store = new LIDMappingStore(keys, {});
  await store.storeLIDPNMappings([{ lid: '777@lid', pn: '51900000000@s.whatsapp.net' }]);
  assert.equal(await store.getPNForLID('777@lid'), '51900000000@s.whatsapp.net');
  assert.equal(await store.getLIDForPN('51900000000@s.whatsapp.net'), '777@lid');
  assert.equal(keys.data['lid-mapping']['777_reverse'], '51900000000');
});

test('preserves device ids when resolving a mapping', async () => {
  const keys = memoryKeys();
  const store = new LIDMappingStore(keys, {});
  await store.storeLIDPNMappings([{ lid: '777@lid', pn: '51900000000@s.whatsapp.net' }]);
  assert.equal(await store.getPNForLID('777:4@lid'), '51900000000:4@s.whatsapp.net');
});

test('extracts PN-LID mappings from history sync', () => {
  const result = processHistoryMessage({
    syncType: 0,
    conversations: [],
    pushnames: [],
    phoneNumberToLidMappings: [{ lidJid: '777@lid', pnJid: '51900000000@s.whatsapp.net' }]
  });
  assert.deepEqual(result.lidPnMappings, [{ lid: '777@lid', pn: '51900000000@s.whatsapp.net' }]);
});

test('mapping survives a real multi-file auth store restart', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'fsociety-lid-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));

  const firstAuth = await useMultiFileAuthState(folder);
  const firstStore = new LIDMappingStore(firstAuth.state.keys, {});
  await firstStore.storeLIDPNMappings([{ lid: '888@lid', pn: '51911111111@s.whatsapp.net' }]);

  const restartedAuth = await useMultiFileAuthState(folder);
  const restartedStore = new LIDMappingStore(restartedAuth.state.keys, {});
  assert.equal(await restartedStore.getPNForLID('888@lid'), '51911111111@s.whatsapp.net');
  assert.equal(await restartedStore.getLIDForPN('51911111111@s.whatsapp.net'), '888@lid');
});
