# Bracket Hub – Esports Tournament Hub (Node + Express + MongoDB)

## Run
1. Install Node.js and MongoDB (or use MongoDB Atlas and set MONGO_URL).
2. `npm install`
3. `npm start`
4. Open http://localhost:3000

## Collections
- teams        (name, game, captain, country, players[])
- tournaments  (name, game, startDate, prizePool, status)
- matches      (tournament -> ref, teamA -> ref, teamB -> ref, scoreA, scoreB, playedOn)

## Advanced DB concepts shown
- Embedded documents (players array inside team)
- Document references + populate (matches -> teams, tournaments)
- Unique index (team name) and single-field index (matches.tournament)
- Aggregation pipeline with $match, $project, $unwind, $group, $lookup, $sort (leaderboard)
- Cascade delete (deleting a team or tournament removes its matches)
- JSON over REST API

## Mongo shell demo queries (for viva / QA)
db.teams.find({ game: "Valorant" })
db.tournaments.find({ prizePool: { $gt: 50000 }, status: { $in: ["Upcoming","Live"] } })
db.matches.find({ scoreA: { $gte: 2 } }).sort({ playedOn: -1 })
db.teams.updateOne({ name: "Team X" }, { $push: { players: "NewPlayer" } })
db.matches.aggregate([{ $group: { _id: "$tournament", total: { $sum: 1 } } }])
