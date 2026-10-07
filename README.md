# ArenaHub - Esports Tournament Hub (MongoDB + Node/Express + HTML/JS)

## Run it
1. Install Node.js and MongoDB Community Server (or use Atlas: set MONGO_URI).
2. In this folder: `npm install`, then `npm run seed`, then `npm start`.
3. Open http://localhost:3000

## Collections (referenced design)
- teams {name, game, city}
- players {name, gamerTag, game, teamId, rating, stats:{...game specific...}}
- tournaments {name, game, format, prizePool, startDate}
- matches {tournamentId, teamA, teamB, scoreA, scoreB, winnerId, playedAt}

Why reference instead of embed: matches grow without limit, so one tournament document would
hit the 16 MB limit and cause write conflicts. Player `stats` is embedded because each game has
different fields (agent/headshotPct for Valorant, formation/possessionPct for FIFA): the schema
flexibility is the reason for choosing MongoDB.

## Viva map
- CRUD: Players, Teams, Tournaments, Matches tabs.
- Indexes: compound {game, rating}, text {name, gamerTag}, {tournamentId, playedAt}, {winnerId}. Viva Lab -> explain() shows IXSCAN vs COLLSCAN.
- Aggregation: leaderboard uses $match, $group, $sort, $lookup, $unwind, $project (server.js).
- Unit III: Replica set = copies of data on several nodes for fault tolerance (primary + secondaries, automatic election).
  Sharding = splitting data across servers; shard key for matches could be {tournamentId} or game (horizontal fragmentation). Explain only, no need to implement.
- Unit IV operators to demo in mongosh: $in, $gte, $elemMatch, $text. Examples:
  - db.players.find({game:{$in:["Valorant","CS2"]}, rating:{$gte:1500}})
  - db.players.find({$text:{$search:"Shadow"}})
  - db.players.find({"stats.headshotPct":{$gt:30}})
- Map Reduce (mongosh), wins per team (the same result as the $group above):
  db.matches.mapReduce(function(){emit(this.winnerId,1)}, function(k,v){return Array.sum(v)}, {out:"wins_per_team"})
  (mapReduce is deprecated in newer MongoDB, so say $group is the modern replacement.)
- Unit V: Star schema in Viva Lab. Fact = matches. Dimensions = game, time, team, tournament. Roll-up day -> week -> month. Slice = filter by game.
- Unit VI: Skill tiers via $bucket (descriptive mining / grouping, like a simple clustering). Predictive idea: predict the winner as the team with the higher historical win rate.
- JSON: documents are JSON (BSON); the REST API sends and receives JSON.
