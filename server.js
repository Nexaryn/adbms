// ArenaHub backend: Express + MongoDB native driver
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const client = new MongoClient(URI);
let db;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const h = f => (q, s, n) => f(q, s, n).catch(e => s.status(500).json({ error: e.message }));
// which fields in each collection are references (ObjectId) / dates
const REFS = { players: ['teamId'], teams: [], tournaments: [], matches: ['tournamentId', 'teamA', 'teamB', 'winnerId'] };
const DATES = ['startDate', 'playedAt'];
const clean = (col, body) => {
  const d = { ...body }; delete d._id;
  REFS[col].forEach(f => { d[f] = d[f] ? new ObjectId(d[f]) : null; });
  DATES.forEach(f => { if (d[f]) d[f] = new Date(d[f]); });
  return d;
};

// ---------- Analytics (aggregation pipelines) ----------
app.get('/api/leaderboard/teams', h(async (q, s) => {
  s.json(await db.collection('matches').aggregate([
    { $match: { winnerId: { $ne: null } } },
    { $group: { _id: '$winnerId', wins: { $sum: 1 } } },
    { $sort: { wins: -1 } }, { $limit: 10 },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    { $project: { _id: 0, team: '$team.name', game: '$team.game', wins: 1 } }
  ]).toArray());
}));

app.get('/api/leaderboard/players', h(async (q, s) => {
  s.json(await db.collection('players').aggregate([
    { $sort: { rating: -1 } }, { $limit: 10 },
    { $lookup: { from: 'teams', localField: 'teamId', foreignField: '_id', as: 'team' } },
    { $unwind: { path: '$team', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 0, gamerTag: 1, game: 1, rating: 1, team: '$team.name' } }
  ]).toArray());
}));

// Star schema: fact = matches, dimension = tournaments(game) + time. Roll-up by day/week/month.
app.get('/api/olap', h(async (q, s) => {
  const fmt = { day: '%Y-%m-%d', week: '%G-W%V', month: '%Y-%m' }[q.query.level] || '%Y-%m-%d';
  const p = [
    { $lookup: { from: 'tournaments', localField: 'tournamentId', foreignField: '_id', as: 't' } },
    { $unwind: '$t' }
  ];
  if (q.query.game) p.push({ $match: { 't.game': q.query.game } });
  p.push({ $group: { _id: { $dateToString: { format: fmt, date: '$playedAt' } }, matches: { $sum: 1 } } }, { $sort: { _id: 1 } });
  s.json(await db.collection('matches').aggregate(p).toArray());
}));

app.get('/api/analytics/by-game', h(async (q, s) => {
  s.json(await db.collection('matches').aggregate([
    { $lookup: { from: 'tournaments', localField: 'tournamentId', foreignField: '_id', as: 't' } },
    { $unwind: '$t' },
    { $group: { _id: '$t.game', matches: { $sum: 1 } } }, { $sort: { matches: -1 } }
  ]).toArray());
}));

// Data mining (descriptive): group players into skill tiers by rating
app.get('/api/mining/tiers', h(async (q, s) => {
  const names = { 0: 'Bronze', 1000: 'Silver', 1500: 'Gold', 2000: 'Diamond' };
  const r = await db.collection('players').aggregate([
    { $bucket: { groupBy: '$rating', boundaries: [0, 1000, 1500, 2000, 100000], default: 'Unrated',
      output: { players: { $sum: 1 }, avgRating: { $avg: '$rating' } } } }
  ]).toArray();
  s.json(r.map(x => ({ tier: names[x._id] || 'Unrated', players: x.players, avgRating: Math.round(x.avgRating || 0) })));
}));

// explain(): same query with and without index
app.get('/api/explain', h(async (q, s) => {
  const run = async hint => {
    let c = db.collection('players').find({ game: 'Valorant' }).sort({ rating: -1 });
    if (hint) c = c.hint(hint);
    const e = await c.explain('executionStats');
    const m = JSON.stringify(e.queryPlanner.winningPlan).match(/"indexName":"([^"]+)"/);
    return { plan: m ? 'IXSCAN (' + m[1] + ')' : 'COLLSCAN', docsExamined: e.executionStats.totalDocsExamined, returned: e.executionStats.nReturned };
  };
  s.json({ withIndex: await run(), withoutIndex: await run({ $natural: 1 }) });
}));

// ---------- Generic CRUD ----------
app.get('/api/:col', h(async (q, s, n) => {
  const col = q.params.col; if (!REFS[col]) return n();
  const f = {};
  if (q.query.game) f.game = q.query.game;
  if (q.query.q && col === 'players') f.$text = { $search: q.query.q };
  s.json(await db.collection(col).find(f).sort({ _id: -1 }).toArray());
}));
app.post('/api/:col', h(async (q, s, n) => {
  const col = q.params.col; if (!REFS[col]) return n();
  s.json(await db.collection(col).insertOne(clean(col, q.body)));
}));
app.put('/api/:col/:id', h(async (q, s, n) => {
  const col = q.params.col; if (!REFS[col]) return n();
  s.json(await db.collection(col).updateOne({ _id: new ObjectId(q.params.id) }, { $set: clean(col, q.body) }));
}));
app.delete('/api/:col/:id', h(async (q, s, n) => {
  const col = q.params.col; if (!REFS[col]) return n();
  s.json(await db.collection(col).deleteOne({ _id: new ObjectId(q.params.id) }));
}));

(async () => {
  await client.connect();
  db = client.db('arenahub');
  await db.collection('players').createIndex({ game: 1, rating: -1 });
  await db.collection('players').createIndex({ name: 'text', gamerTag: 'text' });
  await db.collection('matches').createIndex({ tournamentId: 1, playedAt: -1 });
  await db.collection('matches').createIndex({ winnerId: 1 });
  app.listen(3000, () => console.log('ArenaHub running at http://localhost:3000'));
})();
