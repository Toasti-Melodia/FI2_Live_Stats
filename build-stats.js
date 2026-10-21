const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const NAMES = {'1354331': 'Melodia-Patty', '2829101': 'Maykelus'};
const NAME_FIELDS = [5003];
const WEAPON_KILLS_BASE = 7000;
const FIELDS = {kills: 5001, deaths: 5002, score: 5020, points: 5018, waves: 5014, wins: 5015, bosses: 5016, finals: 5017, chests: 5022, recruits: 5023};
const WEAPONS = {w1h: 5004, w2h: 5005, pole: 5006, bow: 5007, xbow: 5008, throw: 5009, firearm: 5010, magic: 5011, other: 5012};
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
  const numbers = {};
  const nicknames = {};
  for (const dump of dumps) {
    for (const [rawKey, value] of Object.entries(dump)) {
      const [id, fieldText] = rawKey.trim().split(/[ _]/);
      const field = Number(fieldText);
      if (!id || Number.isNaN(field)) continue;
      const isName = NAME_FIELDS.includes(field) || Number.isNaN(Number(value));
      if (isName) {
        if (!nicknames[id]) nicknames[id] = String(value);
      } else {
        const key = id + '_' + field;
        numbers[key] = (numbers[key] || 0) + Number(value);
      }
    }
  }
  const ids = new Set([...Object.keys(numbers).map(key => key.split('_')[0]), ...Object.keys(nicknames)]);
  const rows = [...ids].map(id => {
    const row = {id, name: NAMES[id] || nicknames[id] || id};
    for (const [label, field] of Object.entries(FIELDS)) row[label] = numbers[id + '_' + field] || 0;
    for (const [label, category] of Object.entries(WEAPONS)) row[label] = numbers[id + '_' + (WEAPON_KILLS_BASE + category)] || 0;
    return row;
  }).filter(row => row.kills > 0 || row.deaths > 0);
  fs.writeFileSync('docs/stats.json', JSON.stringify({updated: Date.now(), players: rows}));
})();
