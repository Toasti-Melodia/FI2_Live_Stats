const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const NAMES = {'1354331': 'Melodia-Patty', '2829101': 'Maykelus'};
const NAME_FIELD = 5005;
const WEAPON_KILLS_BASE = 7000;
const FIELDS = {kills: 5001, deaths: 5002, score: 5022, points: 5020, waves: 5016, wins: 5017, bosses: 5018, finals: 5019, chests: 5026, recruits: 5027};
const WEAPONS = {w1h: 5006, w2h: 5007, pole: 5008, bow: 5009, xbow: 5010, throw: 5011, firearm: 5012, magic: 5013, other: 5014};
async function loadServer(prefix) {
  const host = process.env[prefix + '_HOST'];
  if (!host) return null;
  const sftp = new SftpClient();
  try {
    await sftp.connect({host, port: Number(process.env[prefix + '_PORT'] || 22), username: process.env[prefix + '_USER'], password: process.env[prefix + '_PASS']});
    const buffer = await sftp.get(process.env[prefix + '_PATH']);
    return JSON.parse(buffer.toString());
  } catch (error) {
    console.error(prefix + ' failed: ' + error.message);
    return null;
  } finally {
    await sftp.end().catch(() => {});
  }
}
(async () => {
  const dumps = [await loadServer('S1'), await loadServer('S2')].filter(Boolean);
  if (dumps.length === 0) process.exit(1);
  const merged = {};
  for (const dump of dumps) {
    for (const [key, value] of Object.entries(dump)) {
      if (typeof value === 'number') merged[key] = (merged[key] || 0) + value;
      else if (!(key in merged)) merged[key] = value;
    }
  }
  const players = {};
  for (const [key, value] of Object.entries(merged)) {
    const [id, field] = key.split('_');
    if (!id || !field) continue;
    if (!players[id]) players[id] = {id, name: id};
    if (Number(field) === NAME_FIELD) players[id].name = String(value);
  }
  const rows = Object.values(players).map(player => {
    const row = {id: player.id, name: NAMES[player.id] || player.name};
    for (const [label, field] of Object.entries(FIELDS)) row[label] = merged[player.id + '_' + field] || 0;
    for (const [label, category] of Object.entries(WEAPONS)) row[label] = merged[player.id + '_' + (WEAPON_KILLS_BASE + category)] || 0;
    return row;
  }).filter(row => row.kills > 0 || row.deaths > 0);
  fs.writeFileSync('docs/stats.json', JSON.stringify({updated: Date.now(), players: rows}));
})();
