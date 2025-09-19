let teamData = [];
let teamPitchingData = [];
let allAwards = [];
let teamGames = [];
let currentSort = { column: null, dir: "asc" };
let currentTeam = null;
let currentView = 'batting';

// Initialize page
const params = new URLSearchParams(window.location.search);
currentTeam = params.get("team");

if (!currentTeam) {
  document.body.innerHTML = '<h1>Error: No team specified</h1><p><a href="index.html">Return to main page</a></p>';
} else {
  document.getElementById("team-name").textContent = currentTeam;
  // Set team logo
  const logoElement = document.getElementById("team-logo");
  if (logoElement) {
    logoElement.src = `logos/${currentTeam.toLowerCase()}.png`;
    logoElement.alt = `${currentTeam} Logo`;
    logoElement.style.display = "inline";
  }
  loadTeamData();
}

async function loadTeamData() {
  try {
    const [battingResponse, pitchingResponse, awardsResponse, gamesResponse] = await Promise.all([
      fetch("data.json"),
      fetch("pitching.json"),
      fetch("awards.json"),
      fetch("games.json")
    ]);
    
    if (!battingResponse.ok) throw new Error('Failed to load data.json');
    
    const battingData = await battingResponse.json();
    const pitchingData = pitchingResponse.ok ? await pitchingResponse.json() : [];
    allAwards = awardsResponse.ok ? await awardsResponse.json() : [];
    const gamesData = gamesResponse.ok ? await gamesResponse.json() : [];
    
    teamData = cleanBattingData(battingData).filter(p => p.team === currentTeam);
    teamPitchingData = cleanPitchingData(pitchingData).filter(p => p.team === currentTeam);
    
    teamGames = gamesData.filter(g => 
      g["home team"] === currentTeam || g["away team"] === currentTeam
    );
    
    if (teamData.length === 0 && teamPitchingData.length === 0) {
      document.body.innerHTML = `
        <h1>Team "${currentTeam}" not found</h1>
        <p><a href="index.html">Return to main page</a></p>
      `;
      return;
    }

    addGameResultsSection();
    addViewSwitcher();
    populateFilters();
    switchToView('batting');
  } catch (error) {
    console.error("Error loading team data:", error);
    document.body.innerHTML = `
      <h1>Error loading team data</h1>
      <p>Could not load statistics. Please check that data files are available.</p>
      <p><a href="index.html">Return to main page</a></p>
    `;
  }
}

function addViewSwitcher() {
  const filtersDiv = document.querySelector('div:has(#yearFilter)');
  if (!filtersDiv) return;
  
  const viewSwitcher = document.createElement('div');
  viewSwitcher.innerHTML = `
    <span style="margin-left: 30px;">
      <button id="battingViewBtn" onclick="switchToView('batting')" style="padding: 8px 15px; margin-right: 5px; background-color: #0066cc; color: white; border: 1px solid #0066cc; border-radius: 3px; cursor: pointer;">Batting Stats</button>
      <button id="pitchingViewBtn" onclick="switchToView('pitching')" style="padding: 8px 15px; background-color: #f0f0f0; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">Pitching Stats</button>
    </span>
  `;
  filtersDiv.appendChild(viewSwitcher);
}

function addGameResultsSection() {
  if (!teamGames || teamGames.length === 0) return;
  
  const summaryDiv = document.getElementById('summary');
  if (!summaryDiv) return;
  
  const gameResultsHTML = `
    <div class="team-game-results" style="margin-top: 30px; margin-bottom: 30px;">
      <h3>Game Results & Team Record</h3>
      <div id="teamGameResults">
        ${renderTeamGameResults()}
      </div>
    </div>
  `;
  
  summaryDiv.insertAdjacentHTML('afterend', gameResultsHTML);
}

function renderTeamGameResults() {
  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");
  
  if (!yearFilter || !seasonFilter) return '<p>Loading...</p>';
  
  const yearVal = yearFilter.value;
  const seasonVal = seasonFilter.value;
  
  let filteredGames = teamGames.filter(game => 
    (yearVal === "All" || game.year === yearVal) &&
    (seasonVal === "All" || game.season === seasonVal)
  );
  
  if (filteredGames.length === 0) {
    return '<p>No games found for the selected filters.</p>';
  }
  
  const record = calculateTeamRecord(filteredGames);
  const championships = getTeamChampionships();
  const regularGames = filteredGames.filter(g => g.game_type === 'Regular');
  const playoffGames = filteredGames.filter(g => g.game_type === 'Playoff');
  
  let championshipText = '';
  if (championships.length > 0) {
    const championshipYears = championships.map(c => `${c.year} ${c.season}`).join(', ');
    championshipText = ` | Championships: ${championshipYears}`;
  }
  
  let html = `
    <div class="team-record" style="background-color: #f0f0f0; padding: 15px; margin-bottom: 20px; border-radius: 5px; text-align: center;">
      <h4>Team Record: ${record.wins}-${record.losses}-${record.ties} (${record.winPct} Win%)</h4>
      <p>Regular Season: ${record.regular.wins}-${record.regular.losses}-${record.regular.ties} | 
         Playoffs: ${record.playoff.wins}-${record.playoff.losses}-${record.playoff.ties}${championshipText}</p>
    </div>
  `;
  
  if (regularGames.length > 0) {
    html += `
      <h4>Regular Season Games (${regularGames.length})</h4>
      <div style="max-height: 300px; overflow-y: auto; margin-bottom: 20px;">
        <table style="width: 100%; font-size: 0.9em; border-collapse: collapse;">
          <thead style="position: sticky; top: 0; background-color: #f0f0f0;">
            <tr>
              <th style="padding: 6px; border: 1px solid #ccc;">Date</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Year</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Season</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Opponent</th>
              <th style="padding: 6px; border: 1px solid #ccc;">H/A</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Score</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Result</th>
            </tr>
          </thead>
          <tbody>
            ${regularGames.map(game => renderTeamGameRow(game)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  if (playoffGames.length > 0) {
    html += `
      <h4>Playoff Games (${playoffGames.length})</h4>
      <div style="max-height: 300px; overflow-y: auto;">
        <table style="width: 100%; font-size: 0.9em; border-collapse: collapse;">
          <thead style="position: sticky; top: 0; background-color: #f0f0f0;">
            <tr>
              <th style="padding: 6px; border: 1px solid #ccc;">Date</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Year</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Season</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Opponent</th>
              <th style="padding: 6px; border: 1px solid #ccc;">H/A</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Score</th>
              <th style="padding: 6px; border: 1px solid #ccc;">Result</th>
            </tr>
          </thead>
          <tbody>
            ${playoffGames.map(game => renderTeamGameRow(game)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  return html;
}

function renderTeamGameRow(game) {
  const isHome = game["home team"] === currentTeam;
  const opponent = isHome ? game["away team"] : game["home team"];
  const homeAwayText = isHome ? "vs" : "@";
  
  const homeScore = game["home score"];
  const awayScore = game["away score"];
  const forfeit = game.forfeit === "Yes" ? " (Forfeit)" : "";
  
  let result = "T";
  let resultStyle = "color: #666;";
  
  if (game.winner === currentTeam) {
    result = "W";
    resultStyle = "color: green; font-weight: bold;";
  } else if (game.winner !== "Tie" && !game.winner.includes("Forfeit - Tie")) {
    result = "L";
    resultStyle = "color: red; font-weight: bold;";
  }
  
  let scoreDisplay;
  if (homeScore === "W" || homeScore === "L") {
    scoreDisplay = isHome ? 
      (homeScore === "W" ? "W" : "L") : 
      (awayScore === "W" ? "W" : "L");
  } else {
    const teamScore = isHome ? homeScore : awayScore;
    const oppScore = isHome ? awayScore : homeScore;
    scoreDisplay = `${teamScore}-${oppScore}`;
  }
  
  return `
    <tr>
      <td style="padding: 6px; border: 1px solid #ccc;">${game.date}</td>
      <td style="padding: 6px; border: 1px solid #ccc;">${game.year}</td>
      <td style="padding: 6px; border: 1px solid #ccc;">${game.season}</td>
      <td style="padding: 6px; border: 1px solid #ccc;">${opponent}</td>
      <td style="padding: 6px; border: 1px solid #ccc; text-align: center;">${homeAwayText}</td>
      <td style="padding: 6px; border: 1px solid #ccc; text-align: center;">${scoreDisplay}${forfeit}</td>
      <td style="padding: 6px; border: 1px solid #ccc; text-align: center; ${resultStyle}">${result}</td>
    </tr>
  `;
}

function calculateTeamRecord(games) {
  let wins = 0, losses = 0, ties = 0;
  let regularWins = 0, regularLosses = 0, regularTies = 0;
  let playoffWins = 0, playoffLosses = 0, playoffTies = 0;
  
  games.forEach(game => {
    const isRegular = game.game_type === 'Regular';
    
    if (game.winner === currentTeam) {
      wins++;
      if (isRegular) regularWins++;
      else playoffWins++;
    } else if (game.winner === "Tie" || game.winner.includes("Forfeit - Tie")) {
      ties++;
      if (isRegular) regularTies++;
      else playoffTies++;
    } else {
      losses++;
      if (isRegular) regularLosses++;
      else playoffLosses++;
    }
  });
  
  const totalDecided = wins + losses;
  const winPct = totalDecided > 0 ? (wins / totalDecided).toFixed(3) : '.000';
  
  return {
    wins,
    losses,
    ties,
    winPct,
    regular: { wins: regularWins, losses: regularLosses, ties: regularTies },
    playoff: { wins: playoffWins, losses: playoffLosses, ties: playoffTies }
  };
}

function getTeamChampionships() {
  const championships = [];
  
  // Get all unique season combinations from team's games
  const teamSeasons = [...new Set(teamGames.map(g => `${g.year}-${g.season}`))];
  
  teamSeasons.forEach(seasonKey => {
    const [year, season] = seasonKey.split('-');
    
    // Get all games for this season (not just team's games)
    const allSeasonGames = teamGames.filter(g => g.year === year && g.season === season);
    
    // Only check seasons that have playoff games
    const playoffGames = allSeasonGames.filter(g => g.game_type === 'Playoff');
    if (playoffGames.length === 0) return;
    
    // Calculate standings for this season's playoff games
    const playoffStandings = calculateSeasonStandings(year, season, 'Playoff');
    
    // Check if current team won the championship (is at top of playoff standings)
    if (playoffStandings.length > 0 && playoffStandings[0].name === currentTeam) {
      championships.push({ year, season });
    }
  });
  
  return championships;
}

function calculateSeasonStandings(year, season, gameType) {
  // We need to get ALL games for this season, not just the team's games
  // Since we only have teamGames, we'll work with what we have but this is a limitation
  const seasonGames = teamGames.filter(g => 
    g.year === year && 
    g.season === season && 
    g.game_type === gameType
  );
  
  if (seasonGames.length === 0) return [];
  
  const teamStats = {};
  
  seasonGames.forEach(game => {
    const homeTeam = game["home team"];
    const awayTeam = game["away team"];
    const winner = game.winner;
    
    // Initialize teams if not exists
    if (!teamStats[homeTeam]) {
      teamStats[homeTeam] = { name: homeTeam, wins: 0, losses: 0, ties: 0, games: 0 };
    }
    if (!teamStats[awayTeam]) {
      teamStats[awayTeam] = { name: awayTeam, wins: 0, losses: 0, ties: 0, games: 0 };
    }
    
    // Count games
    teamStats[homeTeam].games++;
    teamStats[awayTeam].games++;
    
    // Count results
    if (winner === "Tie") {
      teamStats[homeTeam].ties++;
      teamStats[awayTeam].ties++;
    } else if (winner === homeTeam) {
      teamStats[homeTeam].wins++;
      teamStats[awayTeam].losses++;
    } else if (winner === awayTeam) {
      teamStats[awayTeam].wins++;
      teamStats[homeTeam].losses++;
    } else if (winner.includes("Forfeit")) {
      const actualWinner = winner.replace("Forfeit - ", "").replace("Tie", "");
      if (actualWinner && actualWinner !== "Tie") {
        if (actualWinner === homeTeam) {
          teamStats[homeTeam].wins++;
          teamStats[awayTeam].losses++;
        } else if (actualWinner === awayTeam) {
          teamStats[awayTeam].wins++;
          teamStats[homeTeam].losses++;
        }
      } else {
        teamStats[homeTeam].ties++;
        teamStats[awayTeam].ties++;
      }
    }
  });
  
  // Calculate win percentage and sort
  const standings = Object.values(teamStats).map(team => {
    const totalDecidedGames = team.wins + team.losses;
    team.winPct = totalDecidedGames > 0 ? (team.wins / totalDecidedGames).toFixed(3) : '.000';
    return team;
  });
  
  // Sort by win percentage (descending), then by wins (descending)
  standings.sort((a, b) => {
    if (parseFloat(b.winPct) !== parseFloat(a.winPct)) {
      return parseFloat(b.winPct) - parseFloat(a.winPct);
    }
    return b.wins - a.wins;
  });
  
  return standings;
}

function switchToView(view) {
  currentView = view;
  
  const battingBtn = document.getElementById('battingViewBtn');
  const pitchingBtn = document.getElementById('pitchingViewBtn');
  
  if (battingBtn && pitchingBtn) {
    if (view === 'batting') {
      battingBtn.style.backgroundColor = '#0066cc';
      battingBtn.style.color = 'white';
      pitchingBtn.style.backgroundColor = '#f0f0f0';
      pitchingBtn.style.color = 'black';
    } else {
      pitchingBtn.style.backgroundColor = '#0066cc';
      pitchingBtn.style.color = 'white';
      battingBtn.style.backgroundColor = '#f0f0f0';
      battingBtn.style.color = 'black';
    }
  }
  
  updateTableHeaders(view);
  applyFilters();
}

function updateTableHeaders(view) {
  const thead = document.querySelector("#team-stats-table thead tr");
  if (!thead) return;
  
  if (view === 'batting') {
    thead.innerHTML = `
      <th>Year</th>
      <th>Season</th>
      <th>Name</th>
      <th>Games</th>
      <th>At Bats</th>
      <th>Hits</th>
      <th>Runs</th>
      <th>Walks</th>
      <th>AcesWar</th>
      <th>BA</th>
      <th>OBP</th>
      <th>Sub</th>
    `;
  } else {
    thead.innerHTML = `
      <th>Year</th>
      <th>Season</th>
      <th>Name</th>
      <th>Games</th>
      <th>Innings Pitched</th>
      <th>Runs Allowed</th>
      <th>ERA</th>
    `;
  }
}

function cleanBattingData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : "",
    year: p.year ? String(p.year).trim() : "",
    games: Number(p.games) || 0,
    atBats: Number(p.atBats) || 0,
    hits: Number(p.hits) || 0,
    runs: Number(p.runs) || 0,
    walks: Number(p.walks) || 0,
    AcesWar: p.AcesWar === "N/A" || !p.AcesWar ? "N/A" : Number(p.AcesWar),
    Sub: p.Sub || p.sub || ""
  }));
}

function cleanPitchingData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : "",
    year: p.year ? String(p.year).trim() : "",
    games: Number(p.games) || 0,
    IP: p.IP ? String(p.IP).trim() : "0",
    runsAllowed: Number(p["runs allowed"]) || 0,
    ERA: p.ERA === "N/A" || !p.ERA ? "N/A" : Number(p.ERA)
  }));
}

function populateFilters() {
  const primaryData = teamData.length > 0 ? teamData : teamPitchingData;
  if (primaryData.length === 0) return;
  
  const years = [...new Set(primaryData.map(p => p.year))].sort((a, b) => b - a);
  const seasons = [...new Set(primaryData.map(p => p.season))].sort();

  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");
  
  if (!yearFilter || !seasonFilter) return;

  yearFilter.innerHTML = '<option value="All">All</option>';
  seasonFilter.innerHTML = '<option value="All">All</option>';

  years.forEach(y => {
    let opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearFilter.appendChild(opt);
  });

  seasons.forEach(s => {
    let opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    seasonFilter.appendChild(opt);
  });

  yearFilter.addEventListener("change", applyFilters);
  seasonFilter.addEventListener("change", applyFilters);
}

function applyFilters() {
  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");
  
  if (!yearFilter || !seasonFilter) return;
  
  const yearVal = yearFilter.value;
  const seasonVal = seasonFilter.value;

  const sourceData = currentView === 'batting' ? teamData : teamPitchingData;
  let filtered = sourceData.filter(
    p =>
      (yearVal === "All" || p.year === yearVal) &&
      (seasonVal === "All" || p.season === seasonVal)
  );

  if (currentView === 'batting') {
    renderBattingTable(filtered);
  } else {
    renderPitchingTable(filtered);
  }
  
  const gameResultsDiv = document.getElementById('teamGameResults');
  if (gameResultsDiv && teamGames) {
    gameResultsDiv.innerHTML = renderTeamGameResults();
  }
}

function renderBattingTable(data) {
  const tbody = document.querySelector("#team-stats-table tbody");
  if (!tbody) return;
  
  tbody.innerHTML = "";

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12">No batting data matches the current filters.</td></tr>';
    const totalsText = document.getElementById("totalsText");
    const leadersText = document.getElementById("leadersText");
    if (totalsText) totalsText.textContent = "No data to display.";
    if (leadersText) leadersText.innerHTML = "";
    return;
  }

  let totals = {
    games: 0,
    atBats: 0,
    hits: 0,
    runs: 0,
    walks: 0,
  };

  data.forEach(p => {
    totals.games += p.games;
    totals.atBats += p.atBats;
    totals.hits += p.hits;
    totals.runs += p.runs;
    totals.walks += p.walks;
  });

  const totalsText = document.getElementById("totalsText");
  if (totalsText) {
    totalsText.textContent = `Team Batting Totals — Games: ${totals.games}, At Bats: ${totals.atBats}, Hits: ${totals.hits}, Runs: ${totals.runs}, Walks: ${totals.walks}`;
  }

  renderBattingLeadersTable(data);

  data.forEach(p => {
    const row = document.createElement("tr");
    const BA = p.atBats > 0 ? (p.hits / p.atBats).toFixed(3) : ".000";
    const OBP = (p.atBats + p.walks) > 0
      ? ((p.hits + p.walks) / (p.atBats + p.walks)).toFixed(3)
      : ".000";
    const AcesWar = p.AcesWar !== "N/A" && !isNaN(p.AcesWar)
      ? Number(p.AcesWar).toFixed(2)
      : "N/A";

    row.innerHTML = `
      <td>${p.year}</td>
      <td>${p.season}</td>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}">${p.name}</a></td>
      <td>${p.games}</td>
      <td>${p.atBats}</td>
      <td>${p.hits}</td>
      <td>${p.runs}</td>
      <td>${p.walks}</td>
      <td>${AcesWar}</td>
      <td>${BA}</td>
      <td>${OBP}</td>
      <td>${p.Sub || ""}</td>
    `;
    tbody.appendChild(row);
  });

  attachSorting();
}

function renderPitchingTable(data) {
  const tbody = document.querySelector("#team-stats-table tbody");
  if (!tbody) return;
  
  tbody.innerHTML = "";

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No pitching data matches the current filters.</td></tr>';
    const totalsText = document.getElementById("totalsText");
    const leadersText = document.getElementById("leadersText");
    if (totalsText) totalsText.textContent = "No data to display.";
    if (leadersText) leadersText.innerHTML = "";
    return;
  }

  let totals = {
    games: 0,
    totalIP: 0,
    runsAllowed: 0,
  };

  data.forEach(p => {
    totals.games += p.games;
    totals.totalIP += parseFloat(p.IP) || 0;
    totals.runsAllowed += p.runsAllowed;
  });

  const totalsText = document.getElementById("totalsText");
  if (totalsText) {
    totalsText.textContent = `Team Pitching Totals — Games: ${totals.games}, Innings Pitched: ${totals.totalIP.toFixed(1)}, Runs Allowed: ${totals.runsAllowed}`;
  }

  renderPitchingLeadersTable(data);

  data.forEach(p => {
    const row = document.createElement("tr");
    const ERA = p.ERA !== "N/A" && !isNaN(p.ERA)
      ? Number(p.ERA).toFixed(2)
      : "N/A";

    row.innerHTML = `
      <td>${p.year}</td>
      <td>${p.season}</td>
      <td><a href="pitcher.html?name=${encodeURIComponent(p.name)}">${p.name}</a></td>
      <td>${p.games}</td>
      <td>${p.IP}</td>
      <td>${p.runsAllowed}</td>
      <td>${ERA}</td>
    `;
    tbody.appendChild(row);
  });

  attachSorting();
}

function renderBattingLeadersTable(data) {
  const leadersText = document.getElementById("leadersText");
  if (!leadersText || data.length === 0) return;
  
  leadersText.innerHTML = '<h3>Team Batting Leaders</h3><p>Batting statistics and leaders for this team.</p>';
}

function renderPitchingLeadersTable(data) {
  const leadersText = document.getElementById("leadersText");
  if (!leadersText || data.length === 0) return;
  
  leadersText.innerHTML = '<h3>Team Pitching Leaders</h3><p>Pitching statistics and leaders for this team.</p>';
}

function attachSorting() {
  const headers = document.querySelectorAll("#team-stats-table th");
  headers.forEach((th, idx) => {
    th.onclick = () => sortTable(idx);
  });
}

function sortTable(columnIndex) {
  const table = document.getElementById("team-stats-table");
  if (!table) return;
  
  const rows = Array.from(table.rows).slice(1);

  let dir = currentSort.column === columnIndex && currentSort.dir === "asc" ? "desc" : "asc";
  currentSort = { column: columnIndex, dir };

  rows.sort((a, b) => {
    let x = a.cells[columnIndex].innerText.trim();
    let y = b.cells[columnIndex].innerText.trim();

    if (currentView === 'batting') {
      if (columnIndex === 8) {
        if (x === "N/A" && y !== "N/A") return 1;
        if (y === "N/A" && x !== "N/A") return -1;
        if (x === "N/A" && y === "N/A") return 0;
      }
    } else if (currentView === 'pitching') {
      if (columnIndex === 6) {
        if (x === "N/A" && y !== "N/A") return 1;
        if (y === "N/A" && x !== "N/A") return -1;
        if (x === "N/A" && y === "N/A") return 0;
      }
      
      if (columnIndex === 4) {
        let xNum = parseFloat(x);
        let yNum = parseFloat(y);
        if (!isNaN(xNum) && !isNaN(yNum)) {
          return dir === "asc" ? xNum - yNum : yNum - xNum;
        }
      }
    }

    let xNum = parseFloat(x.replace(/,/g, ""));
    let yNum = parseFloat(y.replace(/,/g, ""));

    if (!isNaN(xNum) && !isNaN(yNum)) {
      return dir === "asc" ? xNum - yNum : yNum - xNum;
    }

    return dir === "asc" ? x.localeCompare(y) : y.localeCompare(x);
  });

  rows.forEach(row => table.tBodies[0].appendChild(row));

  document.querySelectorAll("#team-stats-table th").forEach(th => th.classList.remove("asc", "desc"));
  table.rows[0].cells[columnIndex].classList.add(dir);
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.href = 'index.html';
  }
}