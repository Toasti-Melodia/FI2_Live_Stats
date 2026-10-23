const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const NAMES = {'1354331': 'Melodia-Patty', '2829101': 'Maykelus'};
const NAME_FIELDS = [5003];
const JOINED_FIELD = 5013;
const WEAPON_KILLS_BASE = 7000;
const FIELD_OFFSET = 5000;
const FACTION_STEP = 10000;
const FACTION_AS_BASE = 100000;
const FACTION_VS_BASE = 2000000;
const HERO_SPAWN_BASE = 4000000;
const UNIT_SPAWN_BASE = 5000000;
const SPAWN_RANGE = 1000000;
const MAP_PLAYED_BASE = 3000000;
const MAP_NAME_BASE = 3500000;
const MAP_RANGE = 500000;
const FIELDS = {kills: 5001, deaths: 5002, score: 5020, points: 5018, waves: 5014, wins: 5015, bosses: 5016, finals: 5017, chests: 5022, recruits: 5023, crowd: 5024, headshots: 5025, shielding: 5026, silver: 5019, commands: 5029, anvils: 5030, refills: 5031, wardrobes: 5032};
const WEAPONS = {w1h: 5004, w2h: 5005, pole: 5006, bow: 5007, xbow: 5008, throw: 5009, firearm: 5010, magic: 5011, other: 5012, spear: 5028};
const AWARD_KEYS = ['score', 'kills', 'points', 'waves', 'wins', 'bosses', 'finals', 'chests', 'crowd', 'recruits', 'w1h', 'w2h', 'pole', 'spear', 'bow', 'xbow', 'throw', 'firearm', 'magic', 'other', 'headshots', 'shielding'];
const FIELD_LABELS = {};
for (const [label, field] of Object.entries(FIELDS)) FIELD_LABELS[field] = label;
for (const [label, category] of Object.entries(WEAPONS)) FIELD_LABELS[WEAPON_KILLS_BASE + category] = label;
let TROOPS = {};
try { TROOPS = JSON.parse(fs.readFileSync('troops.json', 'utf8')); } catch (error) { console.log('troops.json not found, unit names will be ids'); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return null; }
}
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
function awardWeek(finishedWeek, rows, top10) {
  const weekKey = String(finishedWeek.start);
  if (top10.weeks[weekKey]) return;
  const before = new Map((finishedWeek.players || []).map(player => [String(player.id), player]));
  const awarded = {};
  for (const column of AWARD_KEYS) {
    const ranking = rows
      .map(row => ({id: row.id, value: (Number(row[column]) || 0) - (Number((before.get(row.id) || {})[column]) || 0)}))
      .filter(entry => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    ranking.forEach((entry, index) => {
      if (!awarded[entry.id]) awarded[entry.id] = {points: 0, places: 0, firsts: 0};
      awarded[entry.id].points += 10 - index;
      awarded[entry.id].places += 1;
      if (index === 0) awarded[entry.id].firsts += 1;
    });
  }
  top10.weeks[weekKey] = awarded;
  console.log('top10 awarded for week ' + weekKey + ': ' + Object.keys(awarded).length + ' players');
}
function top10Totals(top10) {
  const totals = {};
  for (const awarded of Object.values(top10.weeks)) {
    for (const [id, entry] of Object.entries(awarded)) {
      if (!totals[id]) totals[id] = {points: 0, places: 0, firsts: 0};
      totals[id].points += entry.points;
      totals[id].places += entry.places;
      totals[id].firsts += entry.firsts;
    }
  }
  return totals;
}
(async () => {
  const dumps = [await loadServer('S1'), await loadServer('S2')].filter(Boolean);
  if (dumps.length === 0) process.exit(1);
  const numbers = {};
  const nicknames = {};
  const joined = {};
  const spawns = {};
  const maps = {};
  const mapNames = {};
  for (const dump of dumps) {
    for (const [rawKey, value] of Object.entries(dump)) {
      const [id, fieldText] = rawKey.trim().split(/[ _]/);
      const field = Number(fieldText);
      if (!id || Number.isNaN(field)) continue;
      if (field >= MAP_NAME_BASE && field < MAP_NAME_BASE + MAP_RANGE) {
        mapNames[field - MAP_NAME_BASE] = String(value);
        continue;
      }
      const isName = NAME_FIELDS.includes(field) || Number.isNaN(Number(value));
      if (isName) {
        if (!nicknames[id]) nicknames[id] = String(value);
        continue;
      }
      const amount = Number(value);
      if (field === JOINED_FIELD) {
        if (amount > 0 && (!joined[id] || amount < joined[id])) joined[id] = amount;
        continue;
      }
      if (field >= MAP_PLAYED_BASE && field < MAP_NAME_BASE) {
        const scene = field - MAP_PLAYED_BASE;
        if (!maps[id]) maps[id] = {};
        maps[id][scene] = (maps[id][scene] || 0) + amount;
        continue;
      }
      if (field >= HERO_SPAWN_BASE && field < UNIT_SPAWN_BASE + SPAWN_RANGE) {
        const hero = field < UNIT_SPAWN_BASE;
        const troop = field - (hero ? HERO_SPAWN_BASE : UNIT_SPAWN_BASE);
        if (!spawns[id]) spawns[id] = {h: {}, n: {}};
        const group = hero ? spawns[id].h : spawns[id].n;
        group[troop] = (group[troop] || 0) + amount;
        continue;
      }
      const key = id + '_' + field;
      numbers[key] = (numbers[key] || 0) + amount;
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
  const favorites = group => Object.entries(group || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([troop, count]) => ({id: Number(troop), name: TROOPS[troop] || 'Troop #' + troop, count}));
  const topMaps = group => Object.entries(group || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([scene, count]) => ({id: Number(scene), name: mapNames[scene] || 'Map #' + scene, count}));
  const ids = new Set([...Object.keys(numbers).map(key => key.split('_')[0]), ...Object.keys(nicknames)]);
  const rows = [...ids].map(id => {
    const row = {id, name: NAMES[id] || nicknames[id] || id};
    for (const [label, field] of Object.entries(FIELDS)) row[label] = numbers[id + '_' + field] || 0;
    for (const [label, category] of Object.entries(WEAPONS)) row[label] = numbers[id + '_' + (WEAPON_KILLS_BASE + category)] || 0;
    row.joined = joined[id] || 0;
    row.fav = {h: favorites((spawns[id] || {}).h), n: favorites((spawns[id] || {}).n)};
    row.maps = topMaps(maps[id]);
    row.fac = factionStats[id] || {as: {}, vs: {}};
    return row;
  }).filter(row => row.kills > 0 || row.deaths > 0);
  if (rows.length === 0) {
    console.error('no players parsed, keeping previous stats.json');
    process.exit(1);
  }
  let since = Date.now();
  const previous = readJson('docs/stats.json');
  if (previous && previous.since) since = previous.since;
  const updated = Date.now();
  const today = new Date(updated);
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const starts = {
    week: dayStart - ((today.getUTCDay() + 6) % 7) * 86400000,
    month: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    quarter: Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth() / 3) * 3, 1),
    half: Date.UTC(today.getUTCFullYear(), today.getUTCMonth() < 6 ? 0 : 6, 1),
    year: Date.UTC(today.getUTCFullYear(), 0, 1)
  };
  const top10 = readJson('docs/top10.json') || {weeks: {}};
  if (!top10.weeks) top10.weeks = {};
  const existingWeek = readJson('docs/week.json');
  if (existingWeek && existingWeek.start !== starts.week) awardWeek(existingWeek, rows, top10);
  const totals = top10Totals(top10);
  for (const row of rows) {
    const entry = totals[row.id] || {points: 0, places: 0, firsts: 0};
    row.t10 = entry.points;
    row.t10n = entry.places;
    row.t10first = entry.firsts;
  }
  fs.writeFileSync('docs/top10.json', JSON.stringify(top10));
  fs.writeFileSync('docs/stats.json', JSON.stringify({updated, since, players: rows}));
  for (const [name, start] of Object.entries(starts)) {
    const file = 'docs/' + name + '.json';
    const existing = readJson(file);
    if (existing && existing.start === start) continue;
    const players = !existing && since >= start ? [] : rows.map(({fav, maps: mostPlayed, joined: joinedAt, ...numeric}) => numeric);
    fs.writeFileSync(file, JSON.stringify({start, updated, players}));
  }
})();
