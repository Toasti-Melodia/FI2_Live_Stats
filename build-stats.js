const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const NAMES = {'1354331': 'Melodia-Patty', '2829101': 'Maykelus'};
const NAME_FIELDS = [5003];
const WEAPON_KILLS_BASE = 7000;
const FIELD_OFFSET = 5000;
const FACTION_STEP = 10000;
const FACTION_AS_BASE = 100000;
const FACTION_VS_BASE = 2000000;
const FIELDS = {kills: 5001, deaths: 5002, score: 5020, points: 5018, waves: 5014, wins: 5015, bosses: 5016, finals: 5017, chests: 5022, recruits: 5023};
const WEAPONS = {w1h: 5004, w2h: 5005, pole: 5006, bow: 5007, xbow: 5008, throw: 5009, firearm: 5010, magic: 5011, other: 5012};
const FIELD_LABELS = {};
for (const [label, field] of Object.entries(FIELDS)) FIELD_LABELS[field] = label;
for (const [label, category] of Object.entries(WEAPONS)) FIELD_LABELS[WEAPON_KILLS_BASE + category] = label;
async function loadServer(prefix) {
  const host = process.env[prefix + '_HOST'];
  if (!host) {
    console.log(prefix + ' skipped: no host');
    return null;
  }
  const sftp = new SftpClient();
  try {
    await sftp.connect({host, port: Number(process.env[prefix + '_PORT'] || 22), username: process.env[prefix + '_USER'], password: process.env[prefix + '_PASS']});
    const buffer = await sftp.get(process.env[prefix + '_PATH']);
    const data = JSON.parse(buffer.toString());
    console.log(prefix + ' loaded: ' + buffer.length + ' bytes, ' + Object.keys(data).length + ' keys');
    return data;
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
  const factionStats = {};
  for (const [key, value] of Object.entries(numbers)) {
    const [id, fieldText] = key.split('_');
    const field = Number(fieldText);
    if (field < FACTION_AS_BASE) continue;
    const mode = field >= FACTION_VS_BASE ? 'vs' : 'as';
    const rest = field - (mode === 'vs' ? FACTION_VS_BASE : FACTION_AS_BASE);
    const factionId = Math.floor(rest / FACTION_STEP);
    const label = FIELD_LABELS[(rest % FACTION_STEP) + FIELD_OFFSET];
    if (!label) continue;
    if (!factionStats[id]) factionStats[id] = {as: {}, vs: {}};
    if (!factionStats[id][mode][factionId]) factionStats[id][mode][factionId] = {};
    factionStats[id][mode][factionId][label] = value;
  }
  const ids = new Set([...Object.keys(numbers).map(key => key.split('_')[0]), ...Object.keys(nicknames)]);
  const rows = [...ids].map(id => {
    const row = {id, name: NAMES[id] || nicknames[id] || id};
    for (const [label, field] of Object.entries(FIELDS)) row[label] = numbers[id + '_' + field] || 0;
    for (const [label, category] of Object.entries(WEAPONS)) row[label] = numbers[id + '_' + (WEAPON_KILLS_BASE + category)] || 0;
    row.fac = factionStats[id] || {as: {}, vs: {}};
    return row;
  }).filter(row => row.kills > 0 || row.deaths > 0);
  if (rows.length === 0) {
    console.error('no players parsed, keeping previous stats.json');
    process.exit(1);
  }
  let since = Date.now();
  try {
    const previous = JSON.parse(fs.readFileSync('docs/stats.json', 'utf8'));
    if (previous.since) since = previous.since;
  } catch (error) {}
  const updated = Date.now();
  fs.writeFileSync('docs/stats.json', JSON.stringify({updated, since, players: rows}));
  const today = new Date(updated);
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const starts = {
    week: dayStart - ((today.getUTCDay() + 6) % 7) * 86400000,
    month: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    year: Date.UTC(today.getUTCFullYear(), 0, 1)
  };
  for (const [name, start] of Object.entries(starts)) {
    const file = 'docs/' + name + '.json';
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {}
    if (existing && existing.start === start) continue;
    const players = !existing && since >= start ? [] : rows;
    fs.writeFileSync(file, JSON.stringify({start, updated, players}));
  }
})();
