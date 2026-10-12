// js/admin/schedule-gen-core.js
// The schedule generator's scheduling logic, moved unchanged from the old
// admin/schedule-generator.html (only the page wiring was taken out).
// schedule-gen.js (Generate tab of admin/schedule.html) calls generate().
//
//   generate(config) -> { games, playoffDates }
//     config  { seasonType: 'summer'|'fall', seasonYear, selectedTeams: [{ id, name, isNew? }],
//               startDate 'YYYY-MM-DD' (summer; Opening Day is the first Sunday on or after),
//               openingDayMatchups [{ home, away }] x6 and openingDayDHTeam (summer, 11 teams),
//               skipTeacherConvention, fallExtraTeamId (fall) }
//     games   [{ home, away, date: Date, time, week, isOpeningDay?, isDoubleHeader?, dhGame?,
//               isFinalWeek?, isWeeknight?, ... }] sorted by date and slot
//     playoffDates (fall) [{ date, dow, isChampionship }]
//
// Fall dates are the fixed template for the 2026 fall calendar (Sep 13 - Dec 6).
// Fall takes 10 or 11 teams; summer takes 11 (the 10-team summer path was never
// finished: it needs an Opening Day DH team, so generate() refuses it).

let scheduleConfig = null;
// The old page logged every step; set DEBUG to see it (Generate runs it up to 40 times).
const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };

/** Every team's home/away gap as a 0-100 score (100 = all even). */
export function balanceScore(schedule, teams) {
  let totalDiff = 0;
  teams.forEach(team => {
    const homeGames = schedule.filter(g => g.home.id === team.id).length;
    const awayGames = schedule.filter(g => g.away.id === team.id).length;
    totalDiff += Math.abs(homeGames - awayGames);
  });
  const maxPossibleDiff = teams.length * (schedule.length / teams.length);
  return Math.round(Math.max(0, 100 - (totalDiff / maxPossibleDiff * 100)));
}

export function balanceLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Fair';
  return 'Needs work';
}

// Round-robin pass. For odd team counts, inserts a BYE so every real team
// plays exactly (numTeams - 1) games per pass (sits out once vs BYE).
function rrPass(arr, flip) {
  const withBye = arr.length % 2 !== 0 ? [...arr, { id: 'BYE' }] : [...arr];
  const n = withBye.length;
  const games = [];
  const a = [...withBye];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const h = a[i], aw = a[n - 1 - i];
      if (h.id !== 'BYE' && aw.id !== 'BYE') games.push(flip ? { home: aw, away: h } : { home: h, away: aw });
    }
    a.splice(1, 0, a.pop());
  }
  return games;
}

export function generate(config) {
  scheduleConfig = { ...config, _fallPlayoffDates: null };
  const teams = scheduleConfig.selectedTeams;
  const numTeams = teams.length;
  let finalSchedule = [];

  // The date templates only cover these leagues; anything else used to fail
  // silently with undated games.
  if (![10, 11].includes(numTeams)) throw new Error(`The generator handles 10 or 11 teams (${numTeams} picked).`);
  if (scheduleConfig.seasonType === 'summer') {
    if (numTeams !== 11) throw new Error('The summer layout (Opening Day, DH weeks, finals week) is built for 11 teams.');
    if (!scheduleConfig.openingDayDHTeam) throw new Error('Set the Opening Day match-ups first (one team plays twice).');
    scheduleConfig.summerNumTeams = 11;
  }

  if (scheduleConfig.seasonType === 'fall') {
    // assignFallSchedule builds its own pool from the fixed date template.
    assignFallSchedule(finalSchedule);
    return { games: finalSchedule, playoffDates: scheduleConfig._fallPlayoffDates || [] };
  }

  // 11 teams: 2 full round-robin passes = 110 games (20 per team) + 11 extra
  // games via a Hamiltonian cycle (each team +2 = 22). The extras are tagged
  // isSingle so they are never paired into DHs (they become finals-week singles).
  // Opening Day's 6 games are layered on in assignSummerSchedule.
  finalSchedule.push(...rrPass(teams, false));
  finalSchedule.push(...rrPass(teams, true));
  for (let i = 0; i < numTeams; i++) {
    finalSchedule.push({ home: teams[i], away: teams[(i + 1) % numTeams], isSingle: true });
  }
  assignSummerSchedule(finalSchedule);
  return { games: finalSchedule, playoffDates: [] };
}

function assignFallSchedule(schedule) {
  // Fixed-date schedule for 2026 fall season.
  // Dates and per-day game counts come directly from the approved schedule spreadsheet.
  // Four scenarios: TC/No-TC x 11/10 teams.
  //
  // 11 teams: 1 selected team plays 14 games (fallExtraTeamId); all others play 13.
  //   Total appearances: 14 + 10x13 = 144 -> 72 games.
  // 10 teams: all 10 teams play 13 games each.
  //   Total appearances: 10x13 = 130 -> 65 games.
  //
  // On Sundays with 11 teams (6 games), one team naturally plays twice -- whoever
  // the pool assigns. That team's second game is moved to the last (1pm) slot.
  // The fallExtraTeamId team is NOT forced into the double slot -- it simply
  // accumulates its extra game through pool composition.

  const teams = scheduleConfig.selectedTeams;
  const is11Team = teams.length === 11;
  const skipConvention = scheduleConfig.skipTeacherConvention || false;
  const extraTeamId = scheduleConfig.fallExtraTeamId || null;
  const year = parseInt(scheduleConfig.seasonYear) || 2026;

  function makeDate(month, day) { return new Date(year, month - 1, day, 12, 0, 0); }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // -- Fixed session arrays (date, game count, week, day type) --
  // Each scenario sourced from the approved fall schedule spreadsheet.
  let sessions;

  if (is11Team && !skipConvention) {
    // TC 11 Team -- 72 games
    sessions = [
      { date: makeDate(9,13),  games: 6, week: 1,  isSunday: true  },
      { date: makeDate(9,20),  games: 6, week: 2,  isSunday: true  },
      { date: makeDate(9,27),  games: 6, week: 3,  isSunday: true  },
      { date: makeDate(10,4),  games: 6, week: 4,  isSunday: true  },
      { date: makeDate(10,11), games: 6, week: 5,  isSunday: true  },
      { date: makeDate(10,18), games: 6, week: 6,  isSunday: true  },
      { date: makeDate(10,25), games: 6, week: 7,  isSunday: true  },
      { date: makeDate(10,28), games: 2, week: 7,  isSunday: false },
      { date: makeDate(10,29), games: 2, week: 7,  isSunday: false },
      { date: makeDate(10,30), games: 2, week: 7,  isSunday: false },
      { date: makeDate(11,1),  games: 6, week: 8,  isSunday: true  },
      { date: makeDate(11,4),  games: 2, week: 8,  isSunday: false },
      { date: makeDate(11,5),  games: 2, week: 8,  isSunday: false },
      { date: makeDate(11,6),  games: 2, week: 8,  isSunday: false },
      { date: makeDate(11,8),  games: 6, week: 9,  isSunday: true  },
      { date: makeDate(11,11), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,12), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,13), games: 2, week: 9,  isSunday: false },
    ];
  } else if (is11Team && skipConvention) {
    // No TC 11 Team -- 72 games
    sessions = [
      { date: makeDate(9,13),  games: 6, week: 1,  isSunday: true  },
      { date: makeDate(9,20),  games: 6, week: 2,  isSunday: true  },
      { date: makeDate(9,27),  games: 6, week: 3,  isSunday: true  },
      { date: makeDate(10,4),  games: 6, week: 4,  isSunday: true  },
      { date: makeDate(10,11), games: 6, week: 5,  isSunday: true  },
      { date: makeDate(10,18), games: 6, week: 6,  isSunday: true  },
      { date: makeDate(10,25), games: 6, week: 7,  isSunday: true  },
      { date: makeDate(11,1),  games: 6, week: 8,  isSunday: true  },
      { date: makeDate(11,8),  games: 6, week: 9,  isSunday: true  },
      { date: makeDate(11,11), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,12), games: 3, week: 9,  isSunday: false },
      { date: makeDate(11,13), games: 3, week: 9,  isSunday: false },
      { date: makeDate(11,15), games: 6, week: 10, isSunday: true  },
      { date: makeDate(11,18), games: 2, week: 10, isSunday: false },
      { date: makeDate(11,19), games: 2, week: 10, isSunday: false },
    ];
  } else if (!is11Team && !skipConvention) {
    // TC 10 Team -- 65 games
    sessions = [
      { date: makeDate(9,13),  games: 5, week: 1,  isSunday: true  },
      { date: makeDate(9,20),  games: 5, week: 2,  isSunday: true  },
      { date: makeDate(9,27),  games: 5, week: 3,  isSunday: true  },
      { date: makeDate(10,4),  games: 5, week: 4,  isSunday: true  },
      { date: makeDate(10,11), games: 5, week: 5,  isSunday: true  },
      { date: makeDate(10,18), games: 5, week: 6,  isSunday: true  },
      { date: makeDate(10,25), games: 5, week: 7,  isSunday: true  },
      { date: makeDate(10,28), games: 2, week: 7,  isSunday: false },
      { date: makeDate(10,29), games: 2, week: 7,  isSunday: false },
      { date: makeDate(10,30), games: 2, week: 7,  isSunday: false },
      { date: makeDate(11,1),  games: 5, week: 8,  isSunday: true  },
      { date: makeDate(11,4),  games: 2, week: 8,  isSunday: false },
      { date: makeDate(11,5),  games: 2, week: 8,  isSunday: false },
      { date: makeDate(11,6),  games: 2, week: 8,  isSunday: false },
      { date: makeDate(11,8),  games: 5, week: 9,  isSunday: true  },
      { date: makeDate(11,11), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,12), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,13), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,15), games: 2, week: 10, isSunday: true  },
    ];
  } else {
    // No TC 10 Team -- 65 games
    // Spreadsheet shows extra sessions after 11/15; using 11/18 (Wed, 2 games) + 11/19 (Thu, 1 game)
    // so playoffs can begin 11/20 (Fri) as shown in spreadsheet.
    sessions = [
      { date: makeDate(9,13),  games: 5, week: 1,  isSunday: true  },
      { date: makeDate(9,20),  games: 5, week: 2,  isSunday: true  },
      { date: makeDate(9,27),  games: 5, week: 3,  isSunday: true  },
      { date: makeDate(10,4),  games: 5, week: 4,  isSunday: true  },
      { date: makeDate(10,11), games: 5, week: 5,  isSunday: true  },
      { date: makeDate(10,18), games: 5, week: 6,  isSunday: true  },
      { date: makeDate(10,25), games: 5, week: 7,  isSunday: true  },
      { date: makeDate(10,28), games: 2, week: 7,  isSunday: false },
      { date: makeDate(10,29), games: 2, week: 7,  isSunday: false },
      { date: makeDate(10,30), games: 2, week: 7,  isSunday: false },
      { date: makeDate(11,1),  games: 5, week: 8,  isSunday: true  },
      { date: makeDate(11,8),  games: 5, week: 9,  isSunday: true  },
      { date: makeDate(11,11), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,12), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,13), games: 2, week: 9,  isSunday: false },
      { date: makeDate(11,15), games: 5, week: 10, isSunday: true  },
      { date: makeDate(11,18), games: 2, week: 10, isSunday: false },
      { date: makeDate(11,19), games: 1, week: 10, isSunday: false },
    ];
  }

  const targetGames = sessions.reduce((sum, s) => sum + s.games, 0);

  // -- Time slots --
  const sundaySlots5 = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM'];
  const sundaySlots6 = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM'];
  const sundaySlots2 = ['11:00 AM', '12:00 PM'];
  const wkSlots      = ['8:00 PM', '9:00 PM'];
  const wkSlots3     = ['7:00 PM', '8:00 PM', '9:00 PM'];

  // -- H2H-balanced matchup pool --
  // Phase 1: every pair plays once (full round-robin).
  // Phase 2: fewest-games-first rematches — always reaches targetGames (no stuck).
  // Phase 3: swap one game so extraTeamId ends up with exactly 14 (11-team only).
  //   No pair may meet more than twice total.

  const getPairKey = (a, b) => [a.id, b.id].sort().join('|');
  const allPairs = [];
  for (let i = 0; i < teams.length; i++)
    for (let j = i + 1; j < teams.length; j++)
      allPairs.push([teams[i], teams[j]]);

  const pairCount = Object.fromEntries(allPairs.map(([a,b]) => [getPairKey(a,b), 0]));
  const pool = [];

  // Phase 1
  for (const [t1, t2] of shuffle(allPairs)) {
    const [home, away] = Math.random() < 0.5 ? [t1, t2] : [t2, t1];
    pool.push({ home, away });
    pairCount[getPairKey(t1, t2)]++;
  }

  // Phase 2: fewest-games-first — always completes, no endgame-stuck risk
  const teamGames = Object.fromEntries(teams.map(t => [t.id, 0]));
  pool.forEach(g => { teamGames[g.home.id]++; teamGames[g.away.id]++; });

  let safety = 0;
  while (pool.length < targetGames && safety++ < 3000) {
    const sorted = [...teams].sort((a, b) => teamGames[a.id] - teamGames[b.id]);
    let added = false;
    for (const team of sorted) {
      const opps = [...teams]
        .filter(o => o.id !== team.id && pairCount[getPairKey(team, o)] < 2)
        .sort((a, b) => teamGames[a.id] - teamGames[b.id]);
      if (!opps.length) continue;
      const opp = opps[0];
      const prior = pool.find(m =>
        (m.home.id === team.id && m.away.id === opp.id) ||
        (m.home.id === opp.id  && m.away.id === team.id));
      const home = (prior && prior.home.id === team.id) ? opp : team;
      const away = (home.id === team.id) ? opp : team;
      pool.push({ home, away });
      teamGames[home.id]++; teamGames[away.id]++;
      pairCount[getPairKey(team, opp)]++;
      added = true; break;
    }
    if (!added) break;
  }

  // Phase 3: ensure extraTeamId has exactly 14 pool appearances (11-team only).
  // Phase 2 reliably reaches 72 games but may give a different team the 14th spot.
  // Fix: find who has 14, swap one of their games for an extraTeamId game.
  if (is11Team && extraTeamId) {
    Object.keys(teamGames).forEach(k => teamGames[k] = 0);
    pool.forEach(g => { teamGames[g.home.id]++; teamGames[g.away.id]++; });

    if (teamGames[extraTeamId] !== 14) {
      const over = teams.find(t => t.id !== extraTeamId && teamGames[t.id] === 14);
      const extraTeamObj = teams.find(t => t.id === extraTeamId);
      if (over && extraTeamObj) {
        for (let i = 0; i < pool.length; i++) {
          const g = pool[i];
          if (g.home.id !== over.id && g.away.id !== over.id) continue;
          const oppObj = g.home.id === over.id ? g.away : g.home;
          if (oppObj.id === extraTeamId) continue; // skip games already involving extraTeamId
          // Check pair limit: extraTeamId vs oppObj must not already be at 2
          const alreadyPlayed = pool.filter(pg =>
            (pg.home.id === extraTeamId && pg.away.id === oppObj.id) ||
            (pg.home.id === oppObj.id   && pg.away.id === extraTeamId)
          ).length;
          if (alreadyPlayed >= 2) continue;
          // Valid swap: replace 'over' with extraTeamId in this slot
          pool[i] = {
            home: g.home.id === over.id ? extraTeamObj : g.home,
            away: g.away.id === over.id ? extraTeamObj : g.away
          };
          break;
        }
      }
    }
  }

  const finalPool = shuffle(pool);
  const poolUsed  = new Array(finalPool.length).fill(false);

  // -- Assign games to sessions --
  // Sundays: each team plays at most once, EXCEPT on 11-team days (6 games)
  //   where exactly one team plays twice -- whoever falls that way in the pool.
  //   That team's second game is moved to the last slot (1:00 PM).
  // Weeknights: each team plays at most once per session.
  //   For 11-team: try to slot an extraTeamId game first so they accumulate
  //   their extra appearance.

  const out = [];
  let gameNumber = 1;

  sessions.forEach(session => {
    const cap = session.games;
    const is11Sunday = session.isSunday && cap === 6 && is11Team;
    const teamApps = {};
    const sessionGames = [];

    if (is11Sunday) {
      // Step 1: Reserve extraTeamId's game first (so X plays every Sunday)
      if (extraTeamId) {
        for (let pi = 0; pi < finalPool.length; pi++) {
          if (poolUsed[pi]) continue;
          const g = finalPool[pi];
          if (g.home.id !== extraTeamId && g.away.id !== extraTeamId) continue;
          poolUsed[pi] = true;
          teamApps[g.home.id] = (teamApps[g.home.id] || 0) + 1;
          teamApps[g.away.id] = (teamApps[g.away.id] || 0) + 1;
          sessionGames.push(g);
          break;
        }
      }

      // Step 2: Fill games 2 through cap-1 with strict "each team at most once" rule.
      // No dt-constraint here — that's what was blocking games 5 and 6.
      for (let pi = 0; pi < finalPool.length && sessionGames.length < cap - 1; pi++) {
        if (poolUsed[pi]) continue;
        const g = finalPool[pi];
        if ((teamApps[g.home.id] || 0) >= 1 || (teamApps[g.away.id] || 0) >= 1) continue;
        poolUsed[pi] = true;
        teamApps[g.home.id] = (teamApps[g.home.id] || 0) + 1;
        teamApps[g.away.id] = (teamApps[g.away.id] || 0) + 1;
        sessionGames.push(g);
      }

      // Step 3: Place the final game — pair the missing team (0 appearances) with
      // any 1-appearance non-X team. That team becomes the "double" (moves to 1pm).
      if (sessionGames.length === cap - 1) {
        const missingTeam = teams.find(t => !(teamApps[t.id]));
        if (missingTeam) {
          for (let pi = 0; pi < finalPool.length; pi++) {
            if (poolUsed[pi]) continue;
            const g = finalPool[pi];
            const involvesM = g.home.id === missingTeam.id || g.away.id === missingTeam.id;
            if (!involvesM) continue;
            const otherId = g.home.id === missingTeam.id ? g.away.id : g.home.id;
            if (otherId === extraTeamId) continue; // X must not be the double
            poolUsed[pi] = true;
            teamApps[g.home.id] = (teamApps[g.home.id] || 0) + 1;
            teamApps[g.away.id] = (teamApps[g.away.id] || 0) + 1;
            sessionGames.push(g);
            break;
          }
        }
      } else {
        // Fallback: couldn't fill cap-1 with strict rule, loosen to allow a double
        for (let pi = 0; pi < finalPool.length && sessionGames.length < cap; pi++) {
          if (poolUsed[pi]) continue;
          const g = finalPool[pi];
          const ha = teamApps[g.home.id] || 0;
          const aa = teamApps[g.away.id] || 0;
          if (ha >= 2 || aa >= 2) continue;
          if (extraTeamId && ((g.home.id === extraTeamId && ha >= 1) || (g.away.id === extraTeamId && aa >= 1))) continue;
          poolUsed[pi] = true;
          teamApps[g.home.id] = ha + 1;
          teamApps[g.away.id] = aa + 1;
          sessionGames.push(g);
        }
      }

      // Move the double team's 2nd game to the last slot (1:00 PM)
      const dtEntry = Object.entries(teamApps).find(([, c]) => c >= 2);
      if (dtEntry) {
        const dtId = dtEntry[0];
        const dhIdx = sessionGames.findIndex((g, idx) =>
          (g.home.id === dtId || g.away.id === dtId) &&
          sessionGames.slice(0, idx).some(p => p.home.id === dtId || p.away.id === dtId)
        );
        if (dhIdx > 0 && dhIdx < sessionGames.length - 1) {
          sessionGames.push(sessionGames.splice(dhIdx, 1)[0]);
        }
      }

    } else {
      // Standard fill: 10-team Sundays, partial Sundays (5 games), weeknights (2 games)
      // Each team plays at most once per session.
      for (let pi = 0; pi < finalPool.length && sessionGames.length < cap; pi++) {
        if (poolUsed[pi]) continue;
        const g = finalPool[pi];
        if ((teamApps[g.home.id] || 0) >= 1 || (teamApps[g.away.id] || 0) >= 1) continue;
        poolUsed[pi] = true;
        teamApps[g.home.id] = (teamApps[g.home.id] || 0) + 1;
        teamApps[g.away.id] = (teamApps[g.away.id] || 0) + 1;
        sessionGames.push(g);
      }
    }

    // Determine time slots for this session
    let slots;
    if (session.isSunday) {
      slots = cap === 6 ? sundaySlots6 : cap === 5 ? sundaySlots5 : sundaySlots2;
    } else {
      slots = cap === 3 ? wkSlots3 : wkSlots;
    }

    sessionGames.forEach((game, s) => {
      const g = Object.assign({}, game);
      g.date    = new Date(session.date);
      g.time    = slots[s] || slots[slots.length - 1];
      g.week    = session.week;
      g.gameNumber = gameNumber++;
      if (!session.isSunday) g.isWeeknight = true;
      out.push(g);
    });
  });

  // -- Log per-team counts --
  const teamCounts = Object.fromEntries(teams.map(t => [t.id, 0]));
  out.forEach(g => {
    if (teamCounts[g.home.id] !== undefined) teamCounts[g.home.id]++;
    if (teamCounts[g.away.id] !== undefined) teamCounts[g.away.id]++;
  });
  log(`Fall schedule (${is11Team?'11':'10'}-team, ${skipConvention?'No TC':'TC'}): ${out.length} games`);
  log('Per-team:', Object.fromEntries(teams.map(t => [t.name, teamCounts[t.id]])));

  // -- Write output --
  schedule.length = 0;
  out.forEach(g => schedule.push(g));
}


function assignSummerSchedule(schedule) {
  const dhTimeSlots = ['7:45 PM', '8:45 PM'];
  const openingDaySlots = ['3:45 PM', '4:45 PM', '5:45 PM', '6:45 PM', '7:45 PM'];
  const numTeams = scheduleConfig.summerNumTeams || 10;

  // Find Opening Day (first Sunday >= startDate)
  // Noon local, so a plain YYYY-MM-DD is not read as the day before (UTC midnight).
  let currentDate = new Date(`${scheduleConfig.startDate}T12:00:00`);
  while (currentDate.getDay() !== 0) currentDate.setDate(currentDate.getDate() + 1);
  const openingDay = new Date(currentDate);
  const odDHTeamId = numTeams === 11 ? (scheduleConfig.openingDayDHTeam || null) : null;
  const teams = scheduleConfig.selectedTeams;

  log(`📊 Summer 11-team: pool=${schedule.length} games, OD: ${openingDay.toDateString()}`);

  // ── Helpers ────────────────────────────────────────────────────────────
  function getWeekDate(weekBase, dayOfWeek) {
    const d = new Date(weekBase);
    const diff = dayOfWeek - d.getDay();
    d.setDate(d.getDate() + (diff < 0 ? diff + 7 : diff));
    return d;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── STEP 0: Separate pool into 55 DH pairs + 11 singles ──────────────
  // Games tagged isSingle (Hamiltonian cycle) go directly to singles pool.
  // The remaining 110 round-robin games are paired into 55 DH pairs.
  const singles = [];
  const dhPool = [];
  for (const g of schedule) {
    if (g.isSingle) {
      singles.push(g);
    } else {
      dhPool.push(g);
    }
  }
  log(`📋 Pre-tagged singles: ${singles.length} (expect 11), DH pool: ${dhPool.length} (expect 110)`);

  const matchupMap = new Map();
  for (const g of dhPool) {
    const key = [g.home.id, g.away.id].sort().join('|');
    if (!matchupMap.has(key)) matchupMap.set(key, []);
    matchupMap.get(key).push(g);
  }

  const dhByKey = new Map(); // key → array of { game1, game2, id1, id2 }

  matchupMap.forEach((games, key) => {
    const [id1, id2] = key.split('|');
    const asHome1 = games.filter(g => g.home.id === id1);
    const asHome2 = games.filter(g => g.home.id === id2);
    const pairCount = Math.min(asHome1.length, asHome2.length);
    const unpaired = [];

    const pairs = [];
    for (let i = 0; i < pairCount; i++) {
      pairs.push({ game1: asHome1[i], game2: asHome2[i], id1, id2 });
    }
    for (let i = pairCount; i < asHome1.length; i++) unpaired.push(asHome1[i]);
    for (let i = pairCount; i < asHome2.length; i++) unpaired.push(asHome2[i]);
    while (unpaired.length >= 2) {
      pairs.push({ game1: unpaired.shift(), game2: unpaired.shift(), id1, id2 });
    }
    // Any leftover unpaired round-robin games also become singles
    if (unpaired.length === 1) singles.push(unpaired[0]);
    if (pairs.length > 0) dhByKey.set(key, pairs);
  });

  log(`📋 DH pairs: ${[...dhByKey.values()].reduce((s, a) => s + a.length, 0)}, singles: ${singles.length}`);

  const out = [];
  const gamesPlayed = Object.fromEntries(teams.map(t => [t.id, 0]));
  const dhPlayed = Object.fromEntries(teams.map(t => [t.id, 0]));

  // ── STEP 1: Opening Day — 6 games ────────────────────────────────────────
  if (!odDHTeamId) {
    log('❌ No Opening Day DH team selected — cannot generate 11-team schedule.');
    return;
  }
  log(`🎉 Scheduling Opening Day...`);
  const purpleTeam = teams.find(t => t.id === odDHTeamId);
  const nonPurple = teams.filter(t => t.id !== odDHTeamId);
  const odGames = [];

  if (scheduleConfig.openingDayMatchups && scheduleConfig.openingDayMatchups.length === 6) {
    // Use user-defined matchups
    scheduleConfig.openingDayMatchups.forEach(m => odGames.push({ home: m.home, away: m.away }));
    log(`🎉 Opening Day: using user-defined matchups`);
  } else {
    // Fallback: random shuffle
    const shuffledNP = shuffle([...nonPurple]);
    const purpleOpp1 = shuffledNP[8];
    const purpleOpp2 = shuffledNP[9];
    const pairableTeams = shuffledNP.slice(0, 8);
    for (let i = 0; i < pairableTeams.length; i += 2) {
      odGames.push({ home: pairableTeams[i], away: pairableTeams[i + 1] });
    }
    odGames.push({ home: purpleTeam, away: purpleOpp1 });
    odGames.push({ home: purpleOpp2, away: purpleTeam });
    log(`🎉 Opening Day: using randomized matchups (no user selection)`);
  }

  for (let i = 0; i < odGames.length; i++) {
    const g = odGames[i];
    g.date = new Date(openingDay);
    g.time = i < 5 ? openingDaySlots[i] : '8:45 PM';
    g.week = 1;
    g.isDoubleHeader = false;
    g.isOpeningDay = true;
    out.push(g);
    gamesPlayed[g.home.id]++;
    gamesPlayed[g.away.id]++;
  }
  log(`🎉 Opening Day: ${odGames.length} games`);

  // ── STEP 2: Plan bye rotation (deterministic) ─────────────────────────
  // Wk1: 4 DHs, 8 teams play, 3 sit (Purple + 2 = "sit3")
  // Wks 2-11: 10 weeks, 10 byes:
  //   sit3 (3 teams): 0 byes → play all 10 → 10 DHs total ✓
  //   6 wk1-active: 1 bye each → 9 active + 1 wk1 = 10 DHs ✓
  //   2 wk1-active "double-bye": 2 byes each → 8 active + 1 wk1 = 9 DHs
  // Wk12 Sun: 1 DH for the 2 double-bye teams → both reach 10 ✓

  const wk1SitIds = new Set([odDHTeamId]);
  const shuffledNP = shuffle(nonPurple);
  wk1SitIds.add(shuffledNP[0].id);
  wk1SitIds.add(shuffledNP[1].id);

  const wk1Active = shuffle(teams.filter(t => !wk1SitIds.has(t.id)));
  const sit3 = teams.filter(t => wk1SitIds.has(t.id));
  const doubleBye = [wk1Active[0], wk1Active[1]];
  const singleBye = wk1Active.slice(2); // 6 teams

  log(`📅 Wk1 sit: ${sit3.map(t => t.name).join(', ')}`);
  log(`📅 Double-bye (wk12 DH): ${doubleBye.map(t => t.name).join(' vs ')}`);
  log(`📅 Single-bye: ${singleBye.map(t => t.name).join(', ')}`);

  // ── RESERVE the doubleBye mutual DH for Week 12 Sunday ────────────────
  // Pull it out of dhByKey NOW so weeks 1-11 greedy scheduler can't consume it.
  const dbKey = [doubleBye[0].id, doubleBye[1].id].sort().join('|');
  const dbPairs = dhByKey.get(dbKey);
  let reservedDoubleBye = null;
  if (dbPairs && dbPairs.length > 0) {
    reservedDoubleBye = dbPairs.shift(); // remove from pool
    log(`🔒 Reserved Wk12 DH: ${doubleBye[0].name} vs ${doubleBye[1].name}`);
  } else {
    log(`⚠️ No ${doubleBye[0].name} vs ${doubleBye[1].name} DH pair found to reserve!`);
  }
  // Helper to schedule a DH pair
  function scheduleDH(dh, date, weekNum) {
    dh.game1.date = new Date(date); dh.game1.time = dhTimeSlots[0];
    dh.game1.week = weekNum; dh.game1.isDoubleHeader = true; dh.game1.dhGame = 1;
    dh.game2.date = new Date(date); dh.game2.time = dhTimeSlots[1];
    dh.game2.week = weekNum; dh.game2.isDoubleHeader = true; dh.game2.dhGame = 2;
    out.push(dh.game1, dh.game2);
    gamesPlayed[dh.game1.home.id]++; gamesPlayed[dh.game1.away.id]++;
    gamesPlayed[dh.game2.home.id]++; gamesPlayed[dh.game2.away.id]++;
    dhPlayed[dh.id1]++; dhPlayed[dh.id2]++;
  }

  // ── STEP 3: Wk1 Mon–Thu — 4 DHs ───────────────────────────────────────
  const wk1Nights = [1, 2, 3, 4];
  const wk1Paired = new Set();
  let wk1Count = 0;

  for (let n = 0; n < 4; n++) {
    for (const t1 of shuffle(wk1Active)) {
      if (wk1Paired.has(t1.id)) continue;
      let found = false;
      for (const t2 of shuffle(wk1Active)) {
        if (t2.id === t1.id || wk1Paired.has(t2.id)) continue;
        const key = [t1.id, t2.id].sort().join('|');
        const pairs = dhByKey.get(key);
        if (pairs && pairs.length > 0) {
          const dh = pairs.shift();
          scheduleDH(dh, getWeekDate(openingDay, wk1Nights[n]), 1);
          wk1Paired.add(t1.id); wk1Paired.add(t2.id);
          wk1Count++;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  log(`📅 Wk1: ${wk1Count} DHs`);

  // ── STEP 4: Wks 2–11 — 5 DHs Sun–Thu, 1 bye ─────────────────────────
  const regularNights = [0, 1, 2, 3, 4];

  // Track bye counts to enforce: sit3 get 0 byes, singleBye get 1, doubleBye get 2
  const byesTaken = Object.fromEntries(teams.map(t => [t.id, 0]));
  const maxByes = {};
  sit3.forEach(t => { maxByes[t.id] = 0; });
  singleBye.forEach(t => { maxByes[t.id] = 1; });
  doubleBye.forEach(t => { maxByes[t.id] = 2; });

  for (let w = 0; w < 10; w++) {
    const weekNum = w + 2;
    const weekBase = new Date(openingDay);
    weekBase.setDate(weekBase.getDate() + (weekNum - 1) * 7);

    // Smart bye: try each eligible team, pick the one that yields 5 DHs
    // Eligible = hasn't used all their byes yet
    const byeEligible = teams.filter(t => byesTaken[t.id] < maxByes[t.id]);
    // Also consider teams that already maxed byes as fallback
    const allCandidates = [...shuffle(byeEligible), ...shuffle(teams.filter(t => byesTaken[t.id] >= maxByes[t.id]))];

    let bestBye = null, bestDHs = [], bestCount = -1;

    for (const byeCandidate of allCandidates) {
      const activeIds = new Set(teams.filter(t => t.id !== byeCandidate.id).map(t => t.id));
      const testCandidates = [];
      for (const [key, pairs] of dhByKey) {
        if (pairs.length === 0) continue;
        const [id1, id2] = key.split('|');
        if (activeIds.has(id1) && activeIds.has(id2)) {
          testCandidates.push({ key, id1, id2, remaining: pairs.length });
        }
      }
      const tO = {};
      teams.forEach(t => { tO[t.id] = 0; });
      for (const c of testCandidates) { tO[c.id1]++; tO[c.id2]++; }
      testCandidates.sort((a, b) => {
        if (a.remaining !== b.remaining) return a.remaining - b.remaining;
        return Math.min(tO[a.id1], tO[a.id2]) - Math.min(tO[b.id1], tO[b.id2]);
      });
      const testPaired = new Set();
      const testDHs = [];
      for (const c of testCandidates) {
        if (testPaired.has(c.id1) || testPaired.has(c.id2)) continue;
        testDHs.push(c);
        testPaired.add(c.id1); testPaired.add(c.id2);
        if (testDHs.length >= 5) break;
      }
      if (testDHs.length > bestCount) {
        bestCount = testDHs.length;
        bestDHs = testDHs;
        bestBye = byeCandidate;
      }
      if (testDHs.length === 5 && byesTaken[byeCandidate.id] < maxByes[byeCandidate.id]) break;
    }

    byesTaken[bestBye.id]++;

    for (let p = 0; p < bestDHs.length; p++) {
      const c = bestDHs[p];
      const dh = dhByKey.get(c.key).shift();
      scheduleDH(dh, getWeekDate(weekBase, regularNights[p]), weekNum);
    }

    if (bestDHs.length < 5) {
      log(`⚠️ Week ${weekNum}: only ${bestDHs.length} DHs`);
    }
    log(`📅 Week ${weekNum}: ${bestDHs.length} DHs, bye=${bestBye.name}`);
  }

  // ── STEP 5: Wk12 — Sun 1 DH + Mon–Thu 8 singles (2/night) ────────────
  const wk12Base = new Date(openingDay);
  wk12Base.setDate(wk12Base.getDate() + 11 * 7); // week 12

  // Sunday DH: use the reserved double-bye pair
  if (reservedDoubleBye) {
    scheduleDH(reservedDoubleBye, getWeekDate(wk12Base, 0), 12);
    log(`📅 Wk12 Sun: DH ${doubleBye[0].name} vs ${doubleBye[1].name}`);
  } else {
    log(`❌ No reserved DH for Wk12 Sunday — double-bye teams will be short a DH`);
  }

  // ── STEP 5: Wk12 + Wk13 — schedule all 11 singles ───────────────────────
  // Strategy: pre-select 3 non-conflicting singles for wk13 Sunday first,
  // then schedule the remaining 8 across wk12 Mon–Thu (4 nights × 2).
  // This guarantees all 11 are placed with no same-night team conflicts.
  const singlesPerTeam = Object.fromEntries(teams.map(t => [t.id, 0]));

  // Find 3 singles for wk13 that involve 6 distinct teams (no shared teams)
  let wk13Indices = null;
  outer: for (let i = 0; i < singles.length - 2; i++) {
    for (let j = i + 1; j < singles.length - 1; j++) {
      for (let k = j + 1; k < singles.length; k++) {
        const teams3 = [
          singles[i].home.id, singles[i].away.id,
          singles[j].home.id, singles[j].away.id,
          singles[k].home.id, singles[k].away.id
        ];
        if (new Set(teams3).size === 6) {
          wk13Indices = [i, j, k];
          break outer;
        }
      }
    }
  }
  if (!wk13Indices) {
    log('❌ Could not find 3 non-conflicting singles for wk13');
    wk13Indices = [0, 1, 2]; // fallback
  }

  const wk13Singles = wk13Indices.map(i => singles[i]);
  const wk12Singles = singles.filter((_, i) => !wk13Indices.includes(i));

  // Schedule wk12 singles: 4 nights × 2 games, no same-night team conflicts
  // Sort most-constrained first (teams appearing most in remaining singles)

  const teamFreq = {};
  teams.forEach(t => { teamFreq[t.id] = 0; });
  wk12Singles.forEach(g => { teamFreq[g.home.id]++; teamFreq[g.away.id]++; });
  wk12Singles.sort((a, b) =>
    (teamFreq[b.home.id] + teamFreq[b.away.id]) - (teamFreq[a.home.id] + teamFreq[a.away.id])
  );

  const wk12Nights = [1, 2, 3, 4];
  let singlesScheduled = 0;
  const wk12Remaining = [...wk12Singles];

  for (const nightDay of wk12Nights) {
    const d = getWeekDate(wk12Base, nightDay);
    const playingTonight = new Set();
    let nightGames = 0;
    for (let si = wk12Remaining.length - 1; si >= 0 && nightGames < 2; si--) {
      const g = wk12Remaining[si];
      if (playingTonight.has(g.home.id) || playingTonight.has(g.away.id)) continue;
      wk12Remaining.splice(si, 1);
      g.date = new Date(d);
      g.time = nightGames === 0 ? '7:45 PM' : '8:45 PM';
      g.week = 12;
      g.isDoubleHeader = false;
      g.isFinalWeek = true;
      out.push(g);
      gamesPlayed[g.home.id]++; gamesPlayed[g.away.id]++;
      singlesPerTeam[g.home.id]++; singlesPerTeam[g.away.id]++;
      playingTonight.add(g.home.id); playingTonight.add(g.away.id);
      singlesScheduled++;
      nightGames++;
    }
  }
  if (wk12Remaining.length > 0) {
    log(`⚠️ Wk12: ${wk12Remaining.length} singles could not be placed`);
  }
  log(`📅 Wk12: 1 DH + ${singlesScheduled} singles`);

  // ── STEP 6: Wk13 — 3 pre-selected singles on Sunday ──────────────────
  const wk13Base = new Date(openingDay);
  wk13Base.setDate(wk13Base.getDate() + 12 * 7);
  const wk13Sunday = getWeekDate(wk13Base, 0);

  wk13Singles.forEach((g, idx) => {
    g.date = new Date(wk13Sunday);
    g.time = openingDaySlots[idx];
    g.week = 13;
    g.isDoubleHeader = false;
    g.isFinalWeek = true;
    out.push(g);
    gamesPlayed[g.home.id]++; gamesPlayed[g.away.id]++;
    singlesPerTeam[g.home.id]++; singlesPerTeam[g.away.id]++;
  });
  log(`📅 Wk13: ${wk13Singles.length} singles`);

  // Warn if any team doesn't have exactly 2 singles
  const singlesCheck = teams.every(t => singlesPerTeam[t.id] === 2);
  if (!singlesCheck) {
    log('⚠️ Singles distribution off:', Object.fromEntries(teams.map(t => [t.name, singlesPerTeam[t.id]])));
  }

  // ── STEP 7: Validation ─────────────────────────────────────────────────
  log(`\n📊 === SCHEDULE VALIDATION ===`);
  log(`Total games: ${out.length} (expected 127)`);
  let allGood = true;
  for (const t of teams) {
    const total = gamesPlayed[t.id];
    const dhs = dhPlayed[t.id];
    const singles2 = singlesPerTeam[t.id];
    const odCount = t.id === odDHTeamId ? 2 : 1;
    // Regular season: 20 DH games (10 DHs) + 2 singles = 22. Plus OD games.
    const expectedTotal = 22 + odCount;
    const dhOk = dhs === 10;
    const singlesOk = singles2 === 2;
    const totalOk = total === expectedTotal;
    const status = (dhOk && singlesOk && totalOk) ? '✅' : '❌';
    if (!dhOk || !singlesOk || !totalOk) allGood = false;
    log(`  ${status} ${t.name}: ${total}/${expectedTotal} total, ${dhs}/10 DHs, ${singles2}/2 singles, ${odCount} OD`);
  }
  if (!allGood) log('❌ Validation failed!');
  if (singles.length > 0) log(`⚠️ ${singles.length} singles unused`);

  let leftoverDH = 0;
  dhByKey.forEach(p => { leftoverDH += p.length; });
  if (leftoverDH > 0) log(`⚠️ ${leftoverDH} DH pairs unused`);

  // ── STEP 8: Write back, sort, number ───────────────────────────────────
  schedule.length = 0;
  out.forEach(g => schedule.push(g));

  const slotOrder = ['3:45 PM', '4:45 PM', '5:45 PM', '6:45 PM', '7:45 PM', '8:45 PM'];
  schedule.sort((a, b) => {
    const dc = a.date - b.date;
    if (dc !== 0) return dc;
    return slotOrder.indexOf(a.time) - slotOrder.indexOf(b.time);
  });
  schedule.forEach((g, i) => { g.gameNumber = i + 1; });

  const maxWeek = Math.max(...out.map(g => g.week));
  log(`\n✅ Final: ${schedule.length} games over ${maxWeek} weeks`);
}
