const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

mongoose
  .connect(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/esports_hub')
  .then(() => console.log('MongoDB connected'))
  .catch((e) => console.error('MongoDB error:', e.message));

/* ---------- Collections ---------- */
const Team = mongoose.model('Team', new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  game: { type: String, required: true },
  captain: String,
  country: String,
  players: [String],
}));

const Tournament = mongoose.model('Tournament', new mongoose.Schema({
  name: { type: String, required: true },
  game: { type: String, required: true },
  startDate: Date,
  prizePool: { type: Number, default: 0 },
  status: { type: String, enum: ['Upcoming', 'Live', 'Finished'], default: 'Upcoming' },
}));

const matchSchema = new mongoose.Schema({
  tournament: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
  teamA: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  teamB: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  scoreA: { type: Number, default: 0, min: 0 },
  scoreB: { type: Number, default: 0, min: 0 },
  playedOn: Date,
});
matchSchema.index({ tournament: 1 });
matchSchema.index({ playedOn: -1 });
matchSchema.pre('validate', function (next) {
  if (this.teamA && this.teamB && String(this.teamA) === String(this.teamB))
    return next(new Error('A team cannot play against itself'));
  next();
});
const Match = mongoose.model('Match', matchSchema);

/* ---------- Generic CRUD routes ---------- */
function crud(name, Model, populate = '', sort = null, afterDelete) {
  const r = express.Router();
  const fail = (res, e) => res.status(400).json({ error: e.message });

  r.get('/', async (req, res) => {
    try {
      let q = Model.find(req.query).populate(populate);
      if (sort) q = q.sort(sort);
      res.json(await q);
    } catch (e) { fail(res, e); }
  });
  r.post('/', async (req, res) => {
    try { res.status(201).json(await Model.create(req.body)); } catch (e) { fail(res, e); }
  });
  r.put('/:id', async (req, res) => {
    try {
      res.json(await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }));
    } catch (e) { fail(res, e); }
  });
  r.delete('/:id', async (req, res) => {
    try {
      await Model.findByIdAndDelete(req.params.id);
      if (afterDelete) await afterDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  app.use('/api/' + name, r);
}

crud('teams', Team, '', { name: 1 }, (id) => Match.deleteMany({ $or: [{ teamA: id }, { teamB: id }] }));
crud('tournaments', Tournament, '', { startDate: -1 }, (id) => Match.deleteMany({ tournament: id }));
crud('matches', Match, 'tournament teamA teamB', { playedOn: -1 });

/* ---------- Shared aggregation stages ---------- */
// Each match becomes two rows (one per team): result, points and scores for that team.
const res3 = (a, b) => ({
  pts: { $cond: [{ $gt: [a, b] }, 3, { $cond: [{ $eq: [a, b] }, 1, 0] }] },
  w: { $cond: [{ $gt: [a, b] }, 1, 0] },
  d: { $cond: [{ $eq: [a, b] }, 1, 0] },
  l: { $cond: [{ $lt: [a, b] }, 1, 0] },
  f: a, a: b,
});
const twoRows = [
  { $project: { rows: [
    { team: '$teamA', ...res3('$scoreA', '$scoreB') },
    { team: '$teamB', ...res3('$scoreB', '$scoreA') },
  ] } },
  { $unwind: '$rows' },
  { $group: {
    _id: '$rows.team',
    played: { $sum: 1 }, wins: { $sum: '$rows.w' }, draws: { $sum: '$rows.d' }, losses: { $sum: '$rows.l' },
    points: { $sum: '$rows.pts' }, scored: { $sum: '$rows.f' }, conceded: { $sum: '$rows.a' },
  } },
];

/* ---------- Leaderboard of one tournament: Played, Won, Drawn, Lost, Diff, Points ---------- */
app.get('/api/leaderboard/:tid', async (req, res) => {
  try {
    const rows = await Match.aggregate([
      { $match: { tournament: new mongoose.Types.ObjectId(req.params.tid) } },
      ...twoRows,
      { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
      { $unwind: '$team' },
      { $project: { name: '$team.name', game: '$team.game', played: 1, wins: 1, draws: 1, losses: 1,
                    points: 1, diff: { $subtract: ['$scored', '$conceded'] } } },
      { $sort: { points: -1, diff: -1, name: 1 } },
    ]);
    res.json(rows);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- Overall win/draw/loss record of every team (Teams page + Dashboard) ---------- */
app.get('/api/records', async (req, res) => {
  try {
    const rows = await Match.aggregate([...twoRows,
      { $project: { played: 1, wins: 1, draws: 1, losses: 1 } }]);
    res.json(Object.fromEntries(rows.map((r) => [String(r._id), r])));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---------- Dashboard summary ---------- */
app.get('/api/stats', async (req, res) => {
  try {
    const [teams, tournaments, matches, live, prize, perTournament, topTeams] = await Promise.all([
      Team.countDocuments(), Tournament.countDocuments(), Match.countDocuments(),
      Tournament.countDocuments({ status: 'Live' }),
      Tournament.aggregate([{ $group: { _id: null, total: { $sum: '$prizePool' } } }]),
      Match.aggregate([
        { $group: { _id: '$tournament', matches: { $sum: 1 } } },
        { $lookup: { from: 'tournaments', localField: '_id', foreignField: '_id', as: 't' } },
        { $unwind: '$t' }, { $project: { name: '$t.name', matches: 1 } }, { $sort: { matches: -1 } },
      ]),
      Match.aggregate([...twoRows,
        { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 't' } },
        { $unwind: '$t' }, { $project: { name: '$t.name', wins: 1 } },
        { $sort: { wins: -1 } }, { $limit: 5 }]),
    ]);
    res.json({ teams, tournaments, matches, live, prizePool: prize[0]?.total || 0, perTournament, topTeams });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Open http://localhost:' + PORT));