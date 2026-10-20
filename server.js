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
  name: { type: String, required: true, unique: true },   // unique index
  game: { type: String, required: true },
  captain: String,
  country: String,
  players: [String],                                      // embedded array
}));

const Tournament = mongoose.model('Tournament', new mongoose.Schema({
  name: { type: String, required: true },
  game: { type: String, required: true },
  startDate: Date,
  prizePool: { type: Number, default: 0 },
  status: { type: String, enum: ['Upcoming', 'Live', 'Finished'], default: 'Upcoming' },
}));

const matchSchema = new mongoose.Schema({
  tournament: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true }, // reference
  teamA: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  teamB: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  scoreA: { type: Number, default: 0 },
  scoreB: { type: Number, default: 0 },
  playedOn: Date,
});
matchSchema.index({ tournament: 1 }); // speeds up per-tournament queries
const Match = mongoose.model('Match', matchSchema);

/* ---------- Generic CRUD routes ---------- */
function crud(name, Model, populate = '', afterDelete) {
  const r = express.Router();
  const fail = (res, e) => res.status(400).json({ error: e.message });

  r.get('/', async (req, res) => {                                   // READ
    res.json(await Model.find(req.query).populate(populate));
  });
  r.post('/', async (req, res) => {                                  // CREATE
    try { res.status(201).json(await Model.create(req.body)); } catch (e) { fail(res, e); }
  });
  r.put('/:id', async (req, res) => {                                // UPDATE
    try {
      res.json(await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }));
    } catch (e) { fail(res, e); }
  });
  r.delete('/:id', async (req, res) => {                             // DELETE
    try {
      await Model.findByIdAndDelete(req.params.id);
      if (afterDelete) await afterDelete(req.params.id);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  app.use('/api/' + name, r);
}

crud('teams', Team, '', (id) => Match.deleteMany({ $or: [{ teamA: id }, { teamB: id }] }));
crud('tournaments', Tournament, '', (id) => Match.deleteMany({ tournament: id }));
crud('matches', Match, 'tournament teamA teamB');

/* ---------- Leaderboard: aggregation pipeline ---------- */
// Win = 3 points, draw = 1, loss = 0. Each match becomes two rows (one per team), then grouped by team.
app.get('/api/leaderboard/:tid', async (req, res) => {
  const pts = (a, b) => ({ $cond: [{ $gt: [a, b] }, 3, { $cond: [{ $eq: [a, b] }, 1, 0] }] });
  const won = (a, b) => ({ $cond: [{ $gt: [a, b] }, 1, 0] });

  const rows = await Match.aggregate([
    { $match: { tournament: new mongoose.Types.ObjectId(req.params.tid) } },
    { $project: { rows: [
      { team: '$teamA', pts: pts('$scoreA', '$scoreB'), won: won('$scoreA', '$scoreB'), f: '$scoreA', a: '$scoreB' },
      { team: '$teamB', pts: pts('$scoreB', '$scoreA'), won: won('$scoreB', '$scoreA'), f: '$scoreB', a: '$scoreA' },
    ] } },
    { $unwind: '$rows' },
    { $group: {
      _id: '$rows.team',
      played: { $sum: 1 },
      wins: { $sum: '$rows.won' },
      points: { $sum: '$rows.pts' },
      scored: { $sum: '$rows.f' },
      conceded: { $sum: '$rows.a' },
    } },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    { $project: { name: '$team.name', played: 1, wins: 1, points: 1, diff: { $subtract: ['$scored', '$conceded'] } } },
    { $sort: { points: -1, diff: -1 } },
  ]);
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Open http://localhost:' + PORT));
