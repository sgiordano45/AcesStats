let teamData = [];
let allAwards = [];
let currentSort = { column: null, dir: "asc" };
let currentTeam = null;

// Initialize page
const params = new URLSearchParams(window.location.search);
currentTeam = params.get("team");

if (!currentTeam) {
  document.body.innerHTML = '<h1>Error: No team specified</h1><p><a href="index.html">Return to main page</a></p>';
} else {
  document.getElementById("team-name").textContent = currentTeam;
  // Set team logo
  const logoElement = document.getElementById("team-logo");
  logoElement.src = `logos/${currentTeam.toLowerCase()}.png`;
  logoElement.alt = `${currentTeam} Logo`;
  logoElement.style.display = "inline";
  loadTeamData();
}

async function loadTeamData() {
  // Check for Kings team first, before any data loading
  if (currentTeam.toLowerCase() === "kings") {
    document.body.innerHTML = `
      <h1>Team Not Available</h1>
      <p>The requested team page is not accessible.</p>
      <p><a href="teams.html">View all available teams</a> | <a href="index.html">Return to main page</a></p>
    `;
    return;
  }

  try {
    // Load both statistics and awards data
    const [statsResponse, awardsResponse] = await Promise.all([
      fetch("data.json"),
      fetch("awards.json")
    ]);
    
    if (!statsResponse.ok) throw new Error('Failed to load data.json');
    if (!awardsResponse.ok) throw new Error('Failed to load awards.json');
    
    const statsData = await statsResponse.json();
    allAwards = await awardsResponse.json();
    
    teamData = cleanData(statsData).filter(p => p.team === currentTeam);
    
    if (teamData.length === 0) {
      document.body.innerHTML = `
        <h1>Team "${currentTeam}" not found</h1>
        <p><a href="index.html">Return to main page</a></p>
      `;
      return;
    }

    populateFilters(teamData);
    renderTable(teamData);
  } catch (error) {
    console.error("Error loading team data:", error);
    document.body.innerHTML = `
      <h1>Error loading team data</h1>
      <p>Could not load statistics or awards. Please check that data files are available.</p>
      <p><a href="index.html">Return to main page</a></p>
    `;
  }
}

function cleanData(data) {
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

function populateFilters(data) {
  const years = [...new Set(data.map(p => p.year))].sort((a, b) => b - a);
  const seasons = [...new Set(data.map(p => p.season))].sort();

  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");

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
  const yearVal = document.getElementById("yearFilter").value;
  const seasonVal = document.getElementById("seasonFilter").value;

  let filtered = teamData.filter(
    p =>
      (yearVal === "All" || p.year === yearVal) &&
      (seasonVal === "All" || p.season === seasonVal)
  );

  renderTable(filtered);
}

function renderTable(data) {
  const tbody = document.querySelector("#team-stats-table tbody");
  tbody.innerHTML = "";

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12">No data matches the current filters.</td></tr>';
    document.getElementById("totalsText").textContent = "No data to display.";
    document.getElementById("leadersText").innerHTML = "";
    renderLeadersTable([]); // Clear leaders table
    return;
  }

  // Calculate totals
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

  // Update totals text
  document.getElementById("totalsText").textContent =
    `Team Totals — Games: ${totals.games}, At Bats: ${totals.atBats}, Hits: ${totals.hits}, Runs: ${totals.runs}, Walks: ${totals.walks}`;

  // Render leaders table
  renderLeadersTable(data);

  // Generate player stats rows
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

function renderLeadersTable(data) {
  let leadersTableHTML = '';
  
  if (data.length === 0) {
    document.getElementById("leadersText").innerHTML = '';
    return;
  }

  // Calculate season leaders (from filtered data)
  const seasonLeaders = calculateLeaders(data, 'season');
  
  // Calculate career leaders (from all team data, not just filtered)
  const careerLeaders = calculateLeaders(teamData, 'career');

  leadersTableHTML = `
    <h3>Team Leaders</h3>
    <table style="margin-bottom: 20px; width: 100%;">
      <thead>
        <tr>
          <th>Statistic</th>
          <th>Season Leader</th>
          <th>Career Leader</th>
        </tr>
      </thead>
      <tbody>
        <tr><td><strong>Games</strong></td><td>${seasonLeaders.games}</td><td>${careerLeaders.games}</td></tr>
        <tr><td><strong>At Bats</strong></td><td>${seasonLeaders.atBats}</td><td>${careerLeaders.atBats}</td></tr>
        <tr><td><strong>Hits</strong></td><td>${seasonLeaders.hits}</td><td>${careerLeaders.hits}</td></tr>
        <tr><td><strong>Runs</strong></td><td>${seasonLeaders.runs}</td><td>${careerLeaders.runs}</td></tr>
        <tr><td><strong>Walks</strong></td><td>${seasonLeaders.walks}</td><td>${careerLeaders.walks}</td></tr>
        <tr><td><strong>Batting Average</strong></td><td>${seasonLeaders.BA}</td><td>${careerLeaders.BA}</td></tr>
        <tr><td><strong>On-Base %</strong></td><td>${seasonLeaders.OBP}</td><td>${careerLeaders.OBP}</td></tr>
        <tr><td><strong>AcesWar</strong></td><td>${seasonLeaders.AcesWar}</td><td>${careerLeaders.AcesWar}</td></tr>
      </tbody>
    </table>
  `;
  
  // Add awards section
  leadersTableHTML += renderAwardsSection(data);
  
  document.getElementById("leadersText").innerHTML = leadersTableHTML;
}

function renderAwardsSection(data) {
  // Get current filter values
  const yearVal = document.getElementById("yearFilter").value;
  const seasonVal = document.getElementById("seasonFilter").value;
  
  // Filter awards based on current team and year/season filters
  let filteredAwards = allAwards.filter(award => {
    // Must match team (or be a league-wide award with a team member)
    const teamMatch = award.Team === currentTeam;
    
    // Must match year filter
    const yearMatch = yearVal === "All" || award.Year === yearVal;
    
    // Must match season filter
    const seasonMatch = seasonVal === "All" || award.Season === seasonVal;
    
    // Must have valid award name
    const validAward = award.Award && award.Award.trim() !== "";
    
    return teamMatch && yearMatch && seasonMatch && validAward;
  });
  
  if (filteredAwards.length === 0) {
    return '';
  }
  
  // Consolidate awards by player and award type
  const consolidatedAwards = {};
  
  filteredAwards.forEach(award => {
    const key = `${award.Player}|${award.Award}|${award.Position || ''}`;
    
    if (!consolidatedAwards[key]) {
      consolidatedAwards[key] = {
        player: award.Player,
        award: award.Award,
        position: award.Position || '',
        years: []
      };
    }
    
    consolidatedAwards[key].years.push(`${award.Year} ${award.Season}`);
  });
  
  // Convert to array and sort
  const consolidatedArray = Object.values(consolidatedAwards).map(item => ({
    ...item,
    years: item.years.sort((a, b) => b.localeCompare(a)) // Most recent first
  }));
  
  // Group by award category for display
  const awardCategories = {
    'Team MVP': [],
    'All Aces': [],
    'Gold Glove': [],
    'Other Awards': []
  };
  
  consolidatedArray.forEach(item => {
    if (item.award === 'Team MVP') {
      awardCategories['Team MVP'].push(item);
    } else if (item.award === 'All Aces') {
      awardCategories['All Aces'].push(item);
    } else if (item.award === 'Gold Glove') {
      awardCategories['Gold Glove'].push(item);
    } else {
      awardCategories['Other Awards'].push(item);
    }
  });
  
  let awardsHTML = `
    <h3>Team Awards</h3>
    <table style="margin-bottom: 20px; width: 100%;">
      <thead>
        <tr>
          <th>Award</th>
          <th>Player</th>
          <th>Position</th>
          <th>Years</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  // Render each category
  Object.entries(awardCategories).forEach(([category, awards]) => {
    if (awards.length > 0) {
      // Sort by award name first, then by earliest year, then by player name
      awards.sort((a, b) => {
        // First, sort by award name
        if (a.award !== b.award) {
          return a.award.localeCompare(b.award);
        }
        
        // Then by earliest year (most recent first)
        const aEarliest = Math.max(...a.years.map(y => parseInt(y.split(' ')[0])));
        const bEarliest = Math.max(...b.years.map(y => parseInt(y.split(' ')[0])));
        if (aEarliest !== bEarliest) {
          return bEarliest - aEarliest;
        }
        
        // Finally by player name
        return a.player.localeCompare(b.player);
      });
      
      awards.forEach(item => {
        const playerLink = item.player ? 
          `<a href="player.html?name=${encodeURIComponent(item.player)}">${item.player}</a>` : 
          '';
        
        const yearsDisplay = item.years.join(', ');
        const countDisplay = item.years.length > 1 ? ` (${item.years.length}×)` : '';
        
        awardsHTML += `
          <tr>
            <td><strong>${item.award}${countDisplay}</strong></td>
            <td>${playerLink}</td>
            <td>${item.position}</td>
            <td>${yearsDisplay}</td>
          </tr>
        `;
      });
    }
  });
  
  awardsHTML += `
      </tbody>
    </table>
  `;
  
  return awardsHTML;
}

function calculateLeaders(data, type) {
  if (data.length === 0) {
    return {
      games: "N/A", atBats: "N/A", hits: "N/A", runs: "N/A", walks: "N/A",
      BA: "N/A", OBP: "N/A", AcesWar: "N/A"
    };
  }

  let aggregatedData = [];
  
  if (type === 'career') {
    // Aggregate career stats by player (non-subs only for BA/OBP qualification)
    const playerStats = {};
    data.forEach(p => {
      if (!playerStats[p.name]) {
        playerStats[p.name] = {
          name: p.name,
          games: 0, atBats: 0, hits: 0, runs: 0, walks: 0,
          nonSubGames: 0, // Track non-sub games for BA/OBP qualification
          acesWarValues: []
        };
      }
      playerStats[p.name].games += p.games;
      playerStats[p.name].atBats += p.atBats;
      playerStats[p.name].hits += p.hits;
      playerStats[p.name].runs += p.runs;
      playerStats[p.name].walks += p.walks;
      
      // Only count games where player was not a substitute
      if (!p.Sub || p.Sub.toString().trim().toLowerCase() !== "yes") {
        playerStats[p.name].nonSubGames += p.games;
      }
      
      if (p.AcesWar !== "N/A" && !isNaN(p.AcesWar)) {
        playerStats[p.name].acesWarValues.push(Number(p.AcesWar));
      }
    });
    
    aggregatedData = Object.values(playerStats).map(p => ({
      ...p,
      AcesWar: p.acesWarValues.length > 0 ? 
        p.acesWarValues.reduce((a, b) => a + b, 0) / p.acesWarValues.length : "N/A"
    }));
  } else {
    // For season leaders, use individual season records
    aggregatedData = data;
  }

  // For season leaders, filter BA/OBP candidates to non-subs with 20+ at-bats
  const qualifyingPlayersForAverages = type === 'season' 
    ? aggregatedData.filter(p => p.atBats >= 20 && (!p.Sub || p.Sub.toString().trim().toLowerCase() !== "yes"))
    : aggregatedData.filter(p => p.nonSubGames >= 10); // Career: 10+ non-sub games

  // For counting stats, use all players (including subs)
  const qualifyingPlayersForCounting = aggregatedData;
  
  let leaders = {};
  
  // Counting stats leaders (games, at-bats, hits, runs, walks) - include all players
  ["games", "atBats", "hits", "runs", "walks"].forEach(stat => {
    let maxPlayer = qualifyingPlayersForCounting.reduce((prev, curr) =>
      curr[stat] > prev[stat] ? curr : prev,
      { [stat]: -1 }
    );
    
    if (type === 'season' && maxPlayer.name) {
      // For season, include year and season info
      const playerRecord = data.find(p => p.name === maxPlayer.name && p[stat] === maxPlayer[stat]);
      leaders[stat] = `${maxPlayer.name} (${maxPlayer[stat]} - ${playerRecord?.year || ''} ${playerRecord?.season || ''})`;
    } else {
      leaders[stat] = maxPlayer.name ? `${maxPlayer.name} (${maxPlayer[stat]})` : "N/A";
    }
  });

  // Batting Average leader (season: non-subs with 20+ AB, career: 10+ non-sub games)
  let bestBA = qualifyingPlayersForAverages.reduce((prev, curr) => {
    let currBA = curr.atBats > 0 ? curr.hits / curr.atBats : 0;
    let prevBA = prev.atBats > 0 ? prev.hits / prev.atBats : 0;
    return currBA > prevBA ? curr : prev;
  }, { atBats: 0, hits: 0 });
  
  if (bestBA.name && bestBA.atBats > 0) {
    const ba = (bestBA.hits / bestBA.atBats).toFixed(3);
    if (type === 'season') {
      const playerRecord = data.find(p => p.name === bestBA.name && p.atBats === bestBA.atBats);
      leaders.BA = `${bestBA.name} (${ba} - ${playerRecord?.year || ''} ${playerRecord?.season || ''})`;
    } else {
      leaders.BA = `${bestBA.name} (${ba})`;
    }
  } else {
    leaders.BA = "N/A";
  }

  // On-Base Percentage leader (season: non-subs with 20+ AB, career: 10+ non-sub games)
  let bestOBP = qualifyingPlayersForAverages.reduce((prev, curr) => {
    let currOBP = (curr.atBats + curr.walks) > 0 ? 
      (curr.hits + curr.walks) / (curr.atBats + curr.walks) : 0;
    let prevOBP = (prev.atBats + prev.walks) > 0 ? 
      (prev.hits + prev.walks) / (prev.atBats + prev.walks) : 0;
    return currOBP > prevOBP ? curr : prev;
  }, { atBats: 0, hits: 0, walks: 0 });
  
  if (bestOBP.name && (bestOBP.atBats + bestOBP.walks) > 0) {
    const obp = ((bestOBP.hits + bestOBP.walks) / (bestOBP.atBats + bestOBP.walks)).toFixed(3);
    if (type === 'season') {
      const playerRecord = data.find(p => p.name === bestOBP.name && 
        (p.atBats + p.walks) === (bestOBP.atBats + bestOBP.walks));
      leaders.OBP = `${bestOBP.name} (${obp} - ${playerRecord?.year || ''} ${playerRecord?.season || ''})`;
    } else {
      leaders.OBP = `${bestOBP.name} (${obp})`;
    }
  } else {
    leaders.OBP = "N/A";
  }

  // AcesWar leader (all players)
  let bestWAR = qualifyingPlayersForCounting.reduce((prev, curr) => {
    let currWAR = (curr.AcesWar !== "N/A" && !isNaN(curr.AcesWar)) ? Number(curr.AcesWar) : -Infinity;
    let prevWAR = (prev.AcesWar !== "N/A" && !isNaN(prev.AcesWar)) ? Number(prev.AcesWar) : -Infinity;
    return currWAR > prevWAR ? curr : prev;
  }, { AcesWar: -Infinity });
  
  if (bestWAR.name && bestWAR.AcesWar !== -Infinity) {
    const war = Number(bestWAR.AcesWar).toFixed(2);
    if (type === 'season') {
      const playerRecord = data.find(p => p.name === bestWAR.name && Number(p.AcesWar) === Number(bestWAR.AcesWar));
      leaders.AcesWar = `${bestWAR.name} (${war} - ${playerRecord?.year || ''} ${playerRecord?.season || ''})`;
    } else {
      leaders.AcesWar = `${bestWAR.name} (${war})`;
    }
  } else {
    leaders.AcesWar = "N/A";
  }

  return leaders;
}

// Sorting functionality
function attachSorting() {
  const headers = document.querySelectorAll("#team-stats-table th");
  headers.forEach((th, idx) => {
    th.onclick = () => sortTable(idx);
  });
}

function sortTable(columnIndex) {
  const table = document.getElementById("team-stats-table");
  const rows = Array.from(table.rows).slice(1);

  let dir = currentSort.column === columnIndex && currentSort.dir === "asc" ? "desc" : "asc";
  currentSort = { column: columnIndex, dir };

  rows.sort((a, b) => {
    let x = a.cells[columnIndex].innerText.trim();
    let y = b.cells[columnIndex].innerText.trim();

    // Handle AcesWar column (index 8)
    if (columnIndex === 8) {
      if (x === "N/A" && y !== "N/A") return 1;
      if (y === "N/A" && x !== "N/A") return -1;
      if (x === "N/A" && y === "N/A") return 0;
    }

    // Try parsing as numbers
    let xNum = parseFloat(x.replace(/,/g, ""));
    let yNum = parseFloat(y.replace(/,/g, ""));

    if (!isNaN(xNum) && !isNaN(yNum)) {
      return dir === "asc" ? xNum - yNum : yNum - xNum;
    }

    // Fall back to string comparison
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
