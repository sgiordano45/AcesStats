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
    addCareerStatsSection(); // New section for career stats
    addViewSwitcher();
    renderSummary();
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

function addCareerStatsSection() {
  const gameResultsDiv = document.querySelector('.team-game-results');
  if (!gameResultsDiv) return;
  
  const careerStatsHTML = `
    <div class="career-stats-section" style="margin-top: 30px; margin-bottom: 30px;">
      <h3>Career Stats for ${currentTeam} Players (Non-Sub Seasons Only)</h3>
      <p style="color: #666; margin-bottom: 15px;">Career statistics for players during their non-substitute seasons with ${currentTeam}</p>
      <div id="careerStatsContainer">
        ${renderCareerStats()}
      </div>
    </div>
  `;
  
  gameResultsDiv.insertAdjacentHTML('afterend', careerStatsHTML);
}

function renderCareerStats() {
  // Get all non-sub seasons for this team
  const nonSubSeasons = teamData.filter(p => {
    const subStatus = String(p.Sub || "").toLowerCase().trim();
    return subStatus !== "yes";
  });
  
  if (nonSubSeasons.length === 0) {
    return '<p>No non-substitute seasons found for this team.</p>';
  }
  
  // Group by player and calculate career totals
  const playerStats = {};
  
  nonSubSeasons.forEach(p => {
    if (!playerStats[p.name]) {
      playerStats[p.name] = {
        name: p.name,
        seasons: 0,
        games: 0,
        atBats: 0,
        hits: 0,
        runs: 0,
        walks: 0,
        acesBPI: [] // Store all AcesBPI values for average calculation
      };
    }
    
    const player = playerStats[p.name];
    player.seasons++;
    player.games += p.games;
    player.atBats += p.atBats;
    player.hits += p.hits;
    player.runs += p.runs;
    player.walks += p.walks;
    
    if (p.AcesWar !== "N/A" && !isNaN(p.AcesWar)) {
      player.acesBPI.push(Number(p.AcesWar));
    }
  });
  
  // Convert to array and sort by games (descending), then by name
  const sortedPlayers = Object.values(playerStats).sort((a, b) => {
    if (b.games !== a.games) return b.games - a.games;
    return a.name.localeCompare(b.name);
  });
  
  let html = `
    <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
      <thead style="background-color: #f0f0f0;">
        <tr>
          <th style="padding: 8px; border: 1px solid #ccc; text-align: left;">Player</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Seasons</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Games</th>
          <th style="padding: 8px; border: 1px solid #ccc;">At Bats</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Hits</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Runs</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Walks</th>
          <th style="padding: 8px; border: 1px solid #ccc;">BA</th>
          <th style="padding: 8px; border: 1px solid #ccc;">OBP</th>
          <th style="padding: 8px; border: 1px solid #ccc;">Avg AcesBPI</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  sortedPlayers.forEach(player => {
    const BA = player.atBats > 0 ? (player.hits / player.atBats).toFixed(3) : ".000";
    const OBP = (player.atBats + player.walks) > 0
      ? ((player.hits + player.walks) / (player.atBats + player.walks)).toFixed(3)
      : ".000";
    const avgAcesBPI = player.acesBPI.length > 0 
      ? (player.acesBPI.reduce((sum, val) => sum + val, 0) / player.acesBPI.length).toFixed(2)
      : "N/A";
    
    html += `
      <tr>
        <td style="padding: 8px; border: 1px solid #ccc;"><a href="player.html?name=${encodeURIComponent(player.name)}">${player.name}</a></td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${player.seasons}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${player.games}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${player.atBats}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${player.hits}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${player.runs}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${player.walks}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${BA}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${OBP}</td>
        <td style="padding: 8px; border: 1px solid #ccc; text-align: center;">${avgAcesBPI}</td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  return html;
}

function renderTeamGameResults() {
  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");
  
  if (!yearFilter || !seasonFilter) return '<p>Loading...</p>';
  
  const yearVal = yearFilter.value;
  const seasonVal = seasonFilter.value;
  
  let filteredGames = teamGames.filter(game => 
    (yearVal === "All" || String(game.year) === yearVal) &&
    (seasonVal === "All" || game.season === seasonVal)
  );
  
  if (filteredGames.length === 0) {
    return '<p>No games found for the selected filters.</p>';
  }
  
  const record = calculateTeamRecord(filteredGames);
  const regularGames = filteredGames.filter(g => g.game_type === 'Regular');
  const playoffGames = filteredGames.filter(g => g.game_type === 'Playoff');
  
  let html = `
    <div style="margin-bottom: 20px;">
      <strong>Overall Record:</strong> ${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ''} (${record.winPct})
  `;
  
  if (regularGames.length > 0 && playoffGames.length > 0) {
    html += `<br><strong>Regular Season:</strong> ${record.regular.wins}-${record.regular.losses}${record.regular.ties > 0 ? `-${record.regular.ties}` : ''} | <strong>Playoffs:</strong> ${record.playoff.wins}-${record.playoff.losses}${record.playoff.ties > 0 ? `-${record.playoff.ties}` : ''}`;
  }
  
  html += '</div>';
  
  if (regularGames.length > 0) {
    html += `
      <h4>Regular Season Games (${regularGames.length})</h4>
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

function renderSummary() {
  const uniquePlayers = new Set(teamData.map(p => p.name)).size;
  const uniqueSeasons = new Set(teamData.map(p => `${p.year} ${p.season}`)).size;
  
  // Calculate team games from games.json
  let totalTeamGames = 0;
  let gamesDisplay = "";
  let gamesLabel = "";
  
  if (allGames && allGames.length > 0) {
    const teamGames = allGames.filter(g => 
      g["home team"] === currentTeam || g["away team"] === currentTeam
    );
    
    totalTeamGames = teamGames.length;
    const regularSeasonGames = teamGames.filter(g => g.game_type === 'Regular').length;
    const playoffGames = teamGames.filter(g => g.game_type === 'Playoff').length;
    
    if (totalTeamGames > 0) {
      gamesDisplay = totalTeamGames.toString();
      if (regularSeasonGames > 0 && playoffGames > 0) {
        gamesDisplay += ` (${regularSeasonGames} Regular, ${playoffGames} Playoff)`;
      } else if (regularSeasonGames > 0) {
        gamesDisplay += ` Regular`;
      } else if (playoffGames > 0) {
        gamesDisplay += ` Playoff`;
      }
      gamesLabel = "Team Games";
    } else {
      totalTeamGames = teamData.reduce((sum, p) => sum + p.games, 0);
      gamesDisplay = totalTeamGames.toString();
      gamesLabel = "Player Games";
    }
  } else {
    totalTeamGames = teamData.reduce((sum, p) => sum + p.games, 0);
    gamesDisplay = totalTeamGames.toString();
    gamesLabel = "Player Games";
  }
  
  const totalAtBats = teamData.reduce((sum, p) => sum + p.atBats, 0);
  const totalHits = teamData.reduce((sum, p) => sum + p.hits, 0);
  const totalRuns = teamData.reduce((sum, p) => sum + p.runs, 0);
  const teamBA = totalAtBats > 0 ? (totalHits / totalAtBats).toFixed(3) : ".000";
  
  const years = [...new Set(teamData.map(p => p.year))].sort();
  const yearsActive = years.length > 1 ? `${years[0]} - ${years[years.length - 1]}` : years[0];
  
  const summaryHTML = `
    <div class="summary-item">
      <div class="summary-number">${uniquePlayers}</div>
      <div class="summary-label">Total Players</div>
    </div>
    <div class="summary-item">
      <div class="summary-number">${uniqueSeasons}</div>
      <div class="summary-label">Seasons Played</div>
    </div>
    <div class="summary-item">
      <div class="summary-number">${yearsActive}</div>
      <div class="summary-label">Years Active</div>
    </div>
    <div class="summary-item">
      <div class="summary-number" style="font-size: ${gamesDisplay.length > 8 ? '1.5rem' : '2rem'};">${gamesDisplay}</div>
      <div class="summary-label">${gamesLabel}</div>
    </div>
    <div class="summary-item">
      <div class="summary-number">${totalHits}</div>
      <div class="summary-label">Team Hits</div>
    </div>
    <div class="summary-item">
      <div class="summary-number">${teamBA}</div>
      <div class="summary-label">Team Average</div>
    </div>
  `;
  
  document.getElementById("summary-grid").innerHTML = summaryHTML;
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

// Custom sorting function for seasons: Fall -> Summer within each year
function sortByYearSeason(a, b) {
  const yearA = parseInt(a.year);
  const yearB = parseInt(b.year);
  
  // Sort by year descending first (most recent year first)
  if (yearB !== yearA) return yearB - yearA;
  
  // Within the same year, Fall comes before Summer
  const seasonOrder = { 'Fall': 1, 'Summer': 2 };
  const orderA = seasonOrder[a.season] || 999;
  const orderB = seasonOrder[b.season] || 999;
  
  return orderA - orderB;
}

// Function to count actual team games from the games data
function countTeamGames(data) {
  if (!teamGames || teamGames.length === 0) {
    // Fallback: if no games data, use the old method but with better logic
    const uniqueSeasons = new Set();
    data.forEach(p => {
      uniqueSeasons.add(`${p.year}-${p.season}`);
    });
    // Rough estimate: assume 12 games per season on average
    return uniqueSeasons.size * 12;
  }
  
  // Get current filter values
  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");
  
  const yearVal = yearFilter ? yearFilter.value : "All";
  const seasonVal = seasonFilter ? seasonFilter.value : "All";
  
  // Filter team games based on current filters
  let filteredGames = teamGames.filter(game => 
    (yearVal === "All" || String(game.year) === yearVal) &&
    (seasonVal === "All" || game.season === seasonVal)
  );
  
  return filteredGames.length;
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

  // Calculate totals - now using team games instead of player games
  let playerGameTotals = 0; // Sum of all individual player games
  let totals = {
    atBats: 0,
    hits: 0,
    runs: 0,
    walks: 0,
  };

  data.forEach(p => {
    playerGameTotals += p.games;
    totals.atBats += p.atBats;
    totals.hits += p.hits;
    totals.runs += p.runs;
    totals.walks += p.walks;
  });

  // Count unique team games
  const teamGamesCount = countTeamGames(data);

  const totalsText = document.getElementById("totalsText");
  if (totalsText) {
    totalsText.textContent = `Team Batting Totals — Team Games: ${teamGamesCount}, At Bats: ${totals.atBats}, Hits: ${totals.hits}, Runs: ${totals.runs}, Walks: ${totals.walks}`;
  }

  renderBattingLeadersTable(data);

  // Sort data by year/season before rendering
  const sortedData = [...data].sort(sortByYearSeason);

  sortedData.forEach(p => {
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

  // Calculate totals
  let playerGameTotals = 0;
  let totals = {
    totalIP: 0,
    runsAllowed: 0,
  };

  data.forEach(p => {
    playerGameTotals += p.games;
    totals.totalIP += parseFloat(p.IP) || 0;
    totals.runsAllowed += p.runsAllowed;
  });

  // Count unique team games
  const teamGamesCount = countTeamGames(data);

  const totalsText = document.getElementById("totalsText");
  if (totalsText) {
    totalsText.textContent = `Team Pitching Totals — Team Games: ${teamGamesCount}, Innings Pitched: ${totals.totalIP.toFixed(1)}, Runs Allowed: ${totals.runsAllowed}`;
  }

  renderPitchingLeadersTable(data);

  // Sort data by year/season before rendering
  const sortedData = [...data].sort(sortByYearSeason);

  sortedData.forEach(p => {
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

function switchToView(view) {
  currentView = view;
  
  // Update button styles
  const battingBtn = document.getElementById('battingViewBtn');
  const pitchingBtn = document.getElementById('pitchingViewBtn');
  
  if (battingBtn && pitchingBtn) {
    if (view === 'batting') {
      battingBtn.style.backgroundColor = '#0066cc';
      battingBtn.style.color = 'white';
      pitchingBtn.style.backgroundColor = '#f0f0f0';
      pitchingBtn.style.color = '#333';
    } else {
      pitchingBtn.style.backgroundColor = '#0066cc';
      pitchingBtn.style.color = 'white';
      battingBtn.style.backgroundColor = '#f0f0f0';
      battingBtn.style.color = '#333';
    }
  }
  
  // Update table headers based on view
  updateTableHeaders(view);
  
  // Apply current filters to show appropriate data
  applyFilters();
}

function updateTableHeaders(view) {
  const tableHeader = document.querySelector("#team-stats-table thead tr");
  if (!tableHeader) return;
  
  if (view === 'batting') {
    tableHeader.innerHTML = `
      <th>Year</th>
      <th>Season</th>
      <th>Name</th>
      <th>Games</th>
      <th>At Bats</th>
      <th>Hits</th>
      <th>Runs</th>
      <th>Walks</th>
      <th>AcesBPI</th>
      <th>BA</th>
      <th>OBP</th>
      <th>Sub</th>
    `;
  } else {
    tableHeader.innerHTML = `
      <th>Year</th>
      <th>Season</th>
      <th>Name</th>
      <th>Games</th>
      <th>IP</th>
      <th>Runs Allowed</th>
      <th>ERA</th>
    `;
  }
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
      if (columnIndex === 8) { // AcesBPI column
        if (x === "N/A" && y !== "N/A") return 1;
        if (y === "N/A" && x !== "N/A") return -1;
        if (x === "N/A" && y === "N/A") return 0;
      }
    } else if (currentView === 'pitching') {
      if (columnIndex === 6) { // ERA column
        if (x === "N/A" && y !== "N/A") return 1;
        if (y === "N/A" && x !== "N/A") return -1;
        if (x === "N/A" && y === "N/A") return 0;
      }
      
      if (columnIndex === 4) { // IP column
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
