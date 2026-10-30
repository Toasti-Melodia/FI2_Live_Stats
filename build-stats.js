const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');
const NAMES = {'1354331': 'Melodia-Patty', '2829101': 'Maykelus', '2863951': 'Aboba', '5357808': 'saycre'};
const NAME_FIELDS = [5003];
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
const QUEST_BASE = 6000000;
const QUEST_COMPLETIONS_BASE = 9000000;
const QUEST_NAMES = ['Kill bots', 'Kill bots as Recruit/Soldier', 'Hit headshots', 'Kill bots with bows / crossbows / firearms', 'Kill bots with one-handed / spears / throwing', 'Kill bots with two-handed / polearms / magic', 'Kill bots with every weapon type', 'Kills without dying', 'Kills with max 1 death', 'Beat waves', 'Win games', 'Top5 points', 'Slay bosses', 'Slay end-game bosses', 'Open leg boxes', 'Use refills / wardrobes', 'Buff allies as a wizard', 'Win as different factions', 'Beat a custom invasion', 'Beat different invasions', 'Play on different maps', 'Spawn as different heroes'];
const HERO_NAME_SHIFT_FIRST = 1079;
const HERO_NAME_SHIFT_LAST = 1790;
const FIELDS = {kills: 5001, deaths: 5002, score: 5020, points: 5018, waves: 5014, wins: 5015, bosses: 5016, finals: 5017, chests: 5022, recruits: 5023, crowd: 5024, headshots: 5025, shielding: 5026, streak: 5036, quests: 5037, silver: 5019, joined: 5013, commands: 5029, anvils: 5030, refills: 5031, wardrobes: 5032, boxes: 5033, slain: 5034, animations: 5035, runs250: 5038, runs500: 5039, runs1000: 5040};
const WEAPONS = {w1h: 5004, w2h: 5005, pole: 5006, bow: 5007, xbow: 5008, throw: 5009, firearm: 5010, magic: 5011, other: 5012, spear: 5028};
const SCALES = {score: 10};
const MAX_FIELDS = new Set([FIELDS.streak]);
const EXCLUDED_SCENES = new Set([167, 186]);
const FAVORITES_LIMIT = 5;
const FIELD_LABELS = {};
for (const [label, field] of Object.entries(FIELDS)) FIELD_LABELS[field] = label;
for (const [label, category] of Object.entries(WEAPONS)) FIELD_LABELS[WEAPON_KILLS_BASE + category] = label;
let TROOPS = {};
const MAPS = (() => { try { return JSON.parse(fs.readFileSync('maps.json', 'utf8')); } catch (error) { return {}; } })();
try { TROOPS = JSON.parse(fs.readFileSync('troops.json', 'utf8')); } catch (error) { console.log('troops.json not found, unit names will be ids'); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return null; }
}
function troopName(troop, isHero) {
  const lookupId = isHero && troop >= HERO_NAME_SHIFT_FIRST && troop <= HERO_NAME_SHIFT_LAST ? troop - 1 : troop;
  return TROOPS[lookupId] || 'Troop #' + troop;
}
const BACKUP_KEEP = 7;
async function rotateBackup(sftp, remotePath, buffer) {
  const slash = remotePath.lastIndexOf('/');
  const directory = slash >= 0 ? remotePath.slice(0, slash) : '.';
  const baseName = remotePath.slice(slash + 1);
  const todayName = baseName + '.bak-' + new Date().toISOString().slice(0, 10);
  const listing = await sftp.list(directory);
  const backups = listing.map(item => item.name).filter(name => name.startsWith(baseName + '.bak-'));
  if (!backups.includes(todayName)) {
    await sftp.put(buffer, directory + '/' + todayName);
    backups.push(todayName);
  }
  backups.sort();
  for (const name of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) await sftp.delete(directory + '/' + name);
}
async function loadServer(prefix) {
  const host = process.env[prefix + '_HOST'];
  if (!host) {
    console.log(prefix + ' skipped: no host');
    return null;
  }
  const remotePath = process.env[prefix + '_PATH'];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const sftp = new SftpClient();
    try {
      await sftp.connect({host, port: Number(process.env[prefix + '_PORT'] || 22), username: process.env[prefix + '_USER'], password: process.env[prefix + '_PASS'], readyTimeout: 20000});
      let buffer;
      try {
        buffer = await sftp.get(remotePath);
      } catch (error) {
        if (/no such file/i.test(error.message)) {
          console.log(prefix + ' has no stats file yet, skipped');
          return null;
        }
        throw error;
      }
      const data = JSON.parse(buffer.toString());
      console.log(prefix + ' loaded: ' + buffer.length + ' bytes, ' + Object.keys(data).length + ' keys');
      if (Object.keys(data).length > 0) await rotateBackup(sftp, remotePath, buffer).catch(error => console.error(prefix + ' backup failed: ' + error.message));
      return data;
    } catch (error) {
      console.error(prefix + ' attempt ' + attempt + ' failed: ' + error.message);
    } finally {
      await sftp.end().catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  console.error(prefix + ' unreachable, aborting so incomplete data is not published');
  process.exit(1);
}
(async () => {
  const dumps = [await loadServer('S1'), await loadServer('S2')].filter(Boolean);
  if (dumps.length === 0) process.exit(1);
  const numbers = {};
  const nicknames = {};
  const spawns = {};
  const maps = {};
  const mapNames = {};
  const questCompletions = QUEST_NAMES.map(() => 0);
  for (const dump of dumps) {
    for (const [rawKey, value] of Object.entries(dump)) {
      const [id, fieldText] = rawKey.trim().split(/[ _]/);
      const field = Number(fieldText);
      if (!id || Number.isNaN(field)) continue;
      if (field >= MAP_NAME_BASE && field < MAP_NAME_BASE + MAP_RANGE) {
        mapNames[field - MAP_NAME_BASE] = String(value);
        continue;
      }
      if (id === '0' && field >= QUEST_COMPLETIONS_BASE && field < QUEST_COMPLETIONS_BASE + QUEST_NAMES.length) {
        questCompletions[field - QUEST_COMPLETIONS_BASE] += Number(value) || 0;
        continue;
      }
      if (field >= QUEST_BASE) continue;
      if (field >= 20000 && field < FACTION_AS_BASE) continue;
      const isName = NAME_FIELDS.includes(field) || Number.isNaN(Number(value));
      if (isName) {
        if (!nicknames[id]) nicknames[id] = String(value);
        continue;
      }
      const amount = Number(value);
      if (field >= MAP_PLAYED_BASE && field < MAP_NAME_BASE) {
        const scene = field - MAP_PLAYED_BASE;
        if (EXCLUDED_SCENES.has(scene)) continue;
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
      numbers[key] = MAX_FIELDS.has(field) ? Math.max(numbers[key] || 0, amount) : (numbers[key] || 0) + amount;
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
    factionStats[id][mode][factionId][label] = Math.floor(value / (SCALES[label] || 1));
  }
  const favorites = (group, isHero) => Object.entries(group || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, FAVORITES_LIMIT)
    .map(([troop, count]) => ({id: Number(troop), name: troopName(Number(troop), isHero), count}));
  const topMaps = group => Object.entries(group || {})
    .filter(([scene]) => !EXCLUDED_SCENES.has(Number(scene)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, FAVORITES_LIMIT)
    .map(([scene, count]) => ({id: Number(scene), name: MAPS[scene] || mapNames[scene] || 'Map #' + scene, count}));
  const ids = new Set([...Object.keys(numbers).map(key => key.split('_')[0]), ...Object.keys(nicknames)]);
  const rows = [...ids].map(id => {
    const row = {id, name: NAMES[id] || nicknames[id] || id};
    for (const [label, field] of Object.entries(FIELDS)) row[label] = Math.floor((numbers[id + '_' + field] || 0) / (SCALES[label] || 1));
    for (const [label, category] of Object.entries(WEAPONS)) row[label] = numbers[id + '_' + (WEAPON_KILLS_BASE + category)] || 0;
    const playerSpawns = spawns[id] || {h: {}, n: {}};
    const countTypes = group => Object.values(group).filter(amount => amount > 0).length;
    const sumValues = group => Object.values(group).reduce((total, amount) => total + (amount > 0 ? amount : 0), 0);
    row.heroTypes = countTypes(playerSpawns.h);
    row.unitTypes = countTypes(playerSpawns.n);
    row.mapTypes = countTypes(maps[id] || {});
    row.heroSpawns = sumValues(playerSpawns.h);
    row.unitSpawns = sumValues(playerSpawns.n);
    row.mapPlays = sumValues(maps[id] || {});
    row.fav = {h: favorites(playerSpawns.h, true), n: favorites(playerSpawns.n, false)};
    row.maps = topMaps(maps[id]);
    row.fac = factionStats[id] || {as: {}, vs: {}};
    return row;
  }).filter(row => row.kills > 0 || row.deaths > 0);
  if (rows.length === 0) {
    console.error('no players parsed, keeping previous stats.json');
    process.exit(1);
  }
  const boards = {h: {}, n: {}, m: {}};
  const shownEntities = {h: new Set(), n: new Set(), m: new Set()};
  const playerNames = new Map(rows.map(row => [row.id, row.name]));
  const addToBoard = (kind, entity, playerId, amount) => {
    if (amount <= 0) return;
    if (!boards[kind][entity]) boards[kind][entity] = [];
    boards[kind][entity].push([playerId, amount]);
  };
  for (const row of rows) {
    const playerSpawns = spawns[row.id] || {h: {}, n: {}};
    for (const [troop, amount] of Object.entries(playerSpawns.h)) addToBoard('h', troop, row.id, amount);
    for (const [troop, amount] of Object.entries(playerSpawns.n)) addToBoard('n', troop, row.id, amount);
    for (const [scene, amount] of Object.entries(maps[row.id] || {})) addToBoard('m', scene, row.id, amount);
    row.fav.h.forEach(item => shownEntities.h.add(String(item.id)));
    row.fav.n.forEach(item => shownEntities.n.add(String(item.id)));
    row.maps.forEach(item => shownEntities.m.add(String(item.id)));
  }
  const tops = {h: {}, n: {}, m: {}};
  for (const kind of Object.keys(boards)) {
    for (const entity of shownEntities[kind]) {
      const board = boards[kind][entity];
      if (!board) continue;
      board.sort((a, b) => b[1] - a[1] || String(playerNames.get(a[0])).localeCompare(String(playerNames.get(b[0])), undefined, {sensitivity: 'base'}) || a[0].localeCompare(b[0], undefined, {numeric: true}));
      tops[kind][entity] = board;
    }
  }
  const spawnPlayers = {};
  const spawnNames = {h: {}, n: {}, m: {}};
  const positiveOnly = group => Object.fromEntries(Object.entries(group).filter(([, amount]) => amount > 0));
  for (const row of rows) {
    const playerSpawns = spawns[row.id] || {h: {}, n: {}};
    const entry = {h: positiveOnly(playerSpawns.h), n: positiveOnly(playerSpawns.n), m: positiveOnly(maps[row.id] || {})};
    if (Object.keys(entry.h).length + Object.keys(entry.n).length + Object.keys(entry.m).length === 0) continue;
    spawnPlayers[row.id] = entry;
    for (const troop of Object.keys(entry.h)) spawnNames.h[troop] = troopName(Number(troop), true);
    for (const troop of Object.keys(entry.n)) spawnNames.n[troop] = troopName(Number(troop), false);
    for (const scene of Object.keys(entry.m)) spawnNames.m[scene] = MAPS[scene] || mapNames[scene] || 'Map #' + scene;
  }
  let since = Date.now();
  const previous = readJson('docs/stats.json');
  const previousSpawns = readJson('docs/spawns.json');
  if (previous && previous.since) since = previous.since;
  const updated = Date.now();
  const today = new Date(updated);
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const starts = {
    today: dayStart,
    week: dayStart - ((today.getUTCDay() + 6) % 7) * 86400000,
    month: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    quarter: Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth() / 3) * 3, 1),
    half: Date.UTC(today.getUTCFullYear(), today.getUTCMonth() < 6 ? 0 : 6, 1),
    year: Date.UTC(today.getUTCFullYear(), 0, 1)
  };
  fs.writeFileSync('docs/stats.json', JSON.stringify({updated, since, players: rows}));
  fs.writeFileSync('docs/tops.json', JSON.stringify(tops));
  const questRanking = QUEST_NAMES.map((name, index) => ({id: index + 1, name, completions: questCompletions[index]})).sort((a, b) => b.completions - a.completions || a.id - b.id);
  fs.writeFileSync('docs/quests.json', JSON.stringify({updated, quests: questRanking}, null, 1));
  fs.writeFileSync('docs/spawns.json', JSON.stringify({updated, names: spawnNames, players: spawnPlayers}));
  for (const [name, start] of Object.entries(starts)) {
    const file = 'docs/' + name + '.json';
    const spawnFile = 'docs/sp-' + name + '.json';
    const existing = readJson(file);
    const existingSpawns = readJson(spawnFile);
    if (existing && existing.start === start) {
      const missingSpawns = !existingSpawns || existingSpawns.start !== start;
      if (missingSpawns && Array.isArray(existing.players) && existing.players.length === 0) fs.writeFileSync(spawnFile, JSON.stringify({start, updated, players: {}}));
      continue;
    }
    const useStored = previous && Array.isArray(previous.players) && previous.updated < start;
    const baselineRows = useStored ? previous.players : rows;
    const emptyBaseline = !existing && since >= start;
    const players = emptyBaseline ? [] : baselineRows.map(({fav, maps: mostPlayed, ...numeric}) => numeric);
    const baselineSpawns = useStored && previousSpawns && previousSpawns.players ? previousSpawns.players : spawnPlayers;
    fs.writeFileSync(file, JSON.stringify({start, updated, players}));
    fs.writeFileSync(spawnFile, JSON.stringify({start, updated, players: emptyBaseline ? {} : baselineSpawns}));
  }
})();
