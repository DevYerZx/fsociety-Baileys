const path = require('path');
const { exec } = require('child_process');
const { reloadCommands } = require('../../utils/reloadCommands');

module.exports = {
  command: ['update', 'actualizar'],
  description: 'Actualiza desde GitHub y recarga comandos',
  isOwner: true,
  categoria: 'owner',
  run: async (client, m) => {
    const baseDir = process.cwd();

    client.sendMessage(m.key.remoteJid, { text: 'Actualizando desde GitHub...' }, { quoted: m });

    exec('git pull --ff-only', { cwd: baseDir }, (error, stdout, stderr) => {
      reloadCommands(path.join(baseDir, 'commands'));

      let msg = '';
      if (error) {
        msg = `Error al actualizar:\n${stderr || error.message}`;
      } else if (String(stdout).includes('Already up to date.')) {
        msg = '*Estado:* Todo esta actualizado';
      } else {
        msg = `*Actualizacion completada*\n\n${stdout}`;
      }

      client.sendMessage(m.key.remoteJid, { text: msg }, { quoted: m });
    });
  },
};
