// Fills the database with demo data: node seed.js
const { MongoClient } = require('mongodb');
const R = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
(async () => {
  const c = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');
  await c.connect(); const db = c.db('arenahub'); await db.dropDatabase();
  const games = ['Valorant', 'BGMI', 'FIFA', 'CS2'];
  const names = ['Phantom Five', 'Spike Rush', 'Neon Vipers', 'Erangel Wolves', 'Last Zone', 'Pochinki Kings',
    'Midfield Maestros', 'Top Bins FC', 'Pitch Perfect', 'Dust Devils', 'Smoke Signals', 'Long A Legends'];
  const teams = names.map((name, i) => ({ name, game: games[Math.floor(i / 3)], city: ['Pune', 'Mumbai', 'Delhi'][i % 3] }));
  const tr = await db.collection('teams').insertMany(teams);
  const ids = Object.values(tr.insertedIds);
  const stat = g => g === 'Valorant' ? { agent: ['Jett', 'Sage', 'Omen'][R(0, 2)], headshotPct: R(15, 40) }
    : g === 'BGMI' ? { loadout: ['M416', 'AKM', 'AWM'][R(0, 2)], survivalMin: R(10, 25) }
    : g === 'FIFA' ? { formation: ['4-3-3', '4-4-2'][R(0, 1)], possessionPct: R(40, 65) }
    : { weapon: ['AK-47', 'AWP'][R(0, 1)], adr: R(60, 95) };
  const tags = ['Shadow', 'Blitz', 'Nova', 'Raze', 'Ghost', 'Pixel', 'Viper', 'Storm'];
  const fn = ['Aarav', 'Riya', 'Kabir', 'Sana', 'Vihaan', 'Isha', 'Rohan', 'Meera'];
  const players = [];
  ids.forEach((tid, i) => [0, 1].forEach(j => {
    const k = i * 2 + j, g = teams[i].game;
    players.push({ name: fn[k % 8] + ' ' + String.fromCharCode(65 + k % 26) + '.', gamerTag: tags[k % 8] + (10 + k),
      game: g, teamId: tid, rating: R(800, 2400), stats: stat(g) });
  }));
  await db.collection('players').insertMany(players);
  const tn = games.map((g, i) => ({ name: g + ' Campus Cup', game: g, format: 'Round Robin', prizePool: R(5, 50) * 1000,
    startDate: new Date(Date.now() - 60 * 864e5) }));
  const tt = await db.collection('tournaments').insertMany(tn);
  const tids = Object.values(tt.insertedIds), matches = [];
  tids.forEach((tid, gi) => {
    const t = ids.slice(gi * 3, gi * 3 + 3);
    for (let m = 0; m < 14; m++) {
      const a = t[R(0, 2)]; let b = t[R(0, 2)]; while (b === a) b = t[R(0, 2)];
      let sa = R(0, 13), sb = R(0, 13); if (sa === sb) sa++;
      matches.push({ tournamentId: tid, teamA: a, teamB: b, scoreA: sa, scoreB: sb, winnerId: sa > sb ? a : b,
        playedAt: new Date(Date.now() - R(0, 56) * 864e5) });
    }
  });
  await db.collection('matches').insertMany(matches);
  console.log('Seeded:', teams.length, 'teams,', players.length, 'players,', tn.length, 'tournaments,', matches.length, 'matches');
  await c.close();
})();
