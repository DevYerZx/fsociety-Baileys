module.exports = {
  command: ['menu', 'help', 'comandos'],
  description: 'Muestra el menu de comandos disponibles',
  categoria: 'general',
  run: async (client, m) => {
    const prefix = process.env.BOT_PREFIX || '.';
    const map = global.comandos || new Map();

    const byCommand = new Map();
    for (const [, cmd] of map.entries()) {
      if (!cmd || !Array.isArray(cmd.command) || !cmd.command.length) continue;
      const key = cmd.command[0];
      if (!byCommand.has(key)) byCommand.set(key, cmd);
    }

    const categories = {};
    for (const cmd of byCommand.values()) {
      const cat = String(cmd.categoria || 'otros').toLowerCase();
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(cmd);
    }

    const lines = ['*MENU DE COMANDOS*', ''];
    const orderedCats = Object.keys(categories).sort();

    for (const cat of orderedCats) {
      lines.push(`*${cat.toUpperCase()}*`);
      const cmds = categories[cat]
        .sort((a, b) => String(a.command[0]).localeCompare(String(b.command[0])));

      for (const cmd of cmds) {
        const aliases = cmd.command.slice(1).join(', ');
        const aliasLine = aliases ? ` | alias: ${aliases}` : '';
        const desc = cmd.description ? ` - ${cmd.description}` : '';
        lines.push(`- ${prefix}${cmd.command[0]}${desc}${aliasLine}`);
      }

      lines.push('');
    }

    await client.sendMessage(m.key.remoteJid, { text: lines.join('\n').trim() }, { quoted: m });
  },
};
