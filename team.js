let teamData = [];
let teamPitchingData = [];
let allAwards = [];
let currentSort = { column: null, dir: "asc" };
let currentTeam = null;
let currentView = 'batting'; // 'batting' or 'pitching'

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
    // Load batting stats, pitching stats, and awards data
    const [battingResponse, pitchingResponse, awardsResponse] = await Promise.all([
      fetch("data.json"),
      fetch("pitching.json"),
      fetch("awards.json")
    ]);
    
    if (!battingResponse.ok) throw new Error('Failed to load data.json');
    if (!pitchingResponse.ok) {
      console.warn('Failed to load pitching.json - pitching stats will not be available');
    }
    if (!awardsResponse.ok) throw new Error('Failed to load awards.json');
    
    const battingData = await battingResponse.json();
    const pitchingData = pitchingResponse.ok ? await pitchingResponse.json() : [];
    allAwards = await awardsResponse.json();
    
    teamData = cleanBattingData(battingData).filter(p => p.team === currentTeam);
    teamPitchingData = cleanPitchingData(pitchingData).filter(p => p.team === currentTeam);
    
    if (teamData.length === 0 && teamPitchingData.length === 0) {
      document.body.innerHTML = `
        <h1>Team "${currentTeam}" not found</h1>
        <p><a href="index.html">Return to main page</a></p>
      `;
      return;
    }

    // Add view switching buttons
    addViewSwitcher();
    
    populateFilters();
    switchToView('batting');
  } catch (error) {
    console.error("Error loading team data:", error);
    document.body.innerHTML = `
      <h1>Error loading team data</h1>
      <p>Could not load statistics or awards. Please check that data files are available.</p>
      <p><a href="index.html">Return to main page</a></p>
    `;
  }
}

function addViewSwitcher() {
  const filtersDiv = document.querySelector('div:has(#yearFilter)');
  const viewSwitcher = document.createElement('div');
  viewSwitcher.innerHTML = `
    <span style="margin-left: 30px;">
      <button id="battingViewBtn" onclick="switchToView('batting')" style="padding: 8px 15px; margin-right: 5px; background-color: #0066cc; color: white; border: 1px solid #0066cc; border-radius: 3px; cursor: pointer;">Batting Stats</button>
      <button id="pitchingViewBtn" onclick="switchToView('pitching')" style="padding: 8px 15px; background-color: #f0f0f0; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">Pitching Stats</button>
    </span>
  `;
  filtersDiv.appendChild(viewSwitcher);
}

function switchToView(view) {
  currentView = view;
  
  // Update button styles
  const battingBtn = document.getElementById('battingViewBtn');
  const pitchingBtn = document.getElementById('pitchingViewBtn');
  
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
  
  // Update table headers
  updateTableHeaders(view);
  
  // Re-apply filters for the current view
  applyFilters();
}

function updateTableHeaders(view) {
  const thead = document.querySelector("#team-stats-table thead tr");
  
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
  const allData = currentView === 'batting' ? teamData : teamPitchingData;
  const years = [...new Set(allData.map(p => p.year))].sort((a, b) => b - a);
  const seasons = [...new Set(allData.map(p => p.season))].sort();

  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");

  // Clear existing options except "All"
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
  const yearVal = document.getElementById("yearFilter").value;
  const seasonVal = document.getElementById("seasonFilter").value;

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
}

function renderBattingTable(data) {
  const tbody = document.querySelector("#team-stats-table tbody");
  tbody.innerHTML = "";

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12">No batting data matches the current filters.</td></tr>';
    document.getElementById("totalsText").textContent = "No data to display.";
    document.getElementById("leadersText").innerHTML = "";
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
    `Team Batting Totals — Games: ${totals.games}, At Bats: ${totals.atBats}, Hits: ${totals.hits}, Runs: ${totals.runs}, Walks: ${totals.walks}`;

  // Render leaders table
  renderBattingLeadersTable(data);

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

function renderPitchingTable(data) {
  const tbody = document.querySelector("#team-stats-table tbody");
  tbody.innerHTML = "";

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No pitching data matches the current filters.</td></tr>';
    document.getElementById("totalsText").textContent = "No data to display.";
    document.getElementById("leadersText").innerHTML = "";
    return;
  }

  // Calculate totals
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

  // Update totals text
  document.getElementById("totalsText").textContent =
    `Team Pitching Totals — Games: ${totals.games}, Innings Pitched: ${totals.totalIP.toFixed(1)}, Runs Allowed: ${totals.runsAllowed}`;

  // Render leaders table
  renderPitchingLeadersTable(data);

  // Generate pitcher stats rows
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
  // Calculate season leaders (from filtered data)
  const seasonLeaders = calculateBattingLeaders(data, 'season');
  
  // Calculate career leaders (from all team batting data, not just filtered)
  const careerLeaders = calculateBattingLeaders(teamData, 'career');

  const leadersTableHTML = `
    <h3>Team Batting Leaders</h3>
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
  const awardsHTML = renderAwardsSection(data);
  
  document.getElementById("leadersText").innerHTML = leadersTableHTML + awardsHTML;
}

function renderPitchingLeadersTable(data) {
  // Calculate season leaders (from filtered data)
  const seasonLeaders = calculatePitchingLeaders(data, 'season');
  
  // Calculate career leaders (from all team pitching data, not just filtered)
  const careerLeaders = calculatePitchingLeaders(teamPitchingData, 'career');

  const leadersTableHTML = `
    <h3>Team Pitching Leaders</h3>
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
        <tr><td><strong>Innings Pitched</strong></td><td>${seasonLeaders.IP}</td><td>${careerLeaders.IP}</td></tr>
        <tr><td><strong>Runs Allowed</strong></td><td>${seasonLeaders.runsAllowed}</td><td>${careerLeaders.runsAllowed}</td></tr>
        <tr><td><strong>ERA</strong></td><td>${seasonLeaders.ERA}</td><td>${careerLeaders.ERA}</td></tr>
      </tbody>
    </table>
  `;
  
  // Add awards section
  const awardsHTML = renderAwardsSection(data);
  
  document.getElementById("leadersText").innerHTML = leadersTableHTML + awardsHTML;
}

function calculateBattingLeaders(data, type) {
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

function calculatePitchingLeaders(data, type) {
  if (data.length === 0) {
    return {
      games: "N/A", IP: "N/A", runsAllowed: "N/A", ERA: "N/A"
    };
  }

  let aggregatedData = [];
  
  if (type === 'career') {
    // Aggregate career stats by pitcher
    const pitcherStats = {};
    data.forEach(p => {
      if (!pitcherStats[p.name]) {
        pitcherStats[p.name] = {
          name: p.name,
          games: 0,
          totalIP: 0,
          runsAllowed: 0,
          eraValues: []
        };
      }
      pitcherStats[p.name].games += p.games;
      pitcherStats[p.name].totalIP += parseFloat(p.IP) || 0;
      pitcherStats[p.name].runsAllowed += p.runsAllowed;
      
      if (p.ERA !== "N/A" && !isNaN(p.ERA)) {
        const ip = parseFloat(p.IP) || 0;
        if (ip > 0) {
          pitcherStats[p.name].eraValues.push({
            era: Number(p.ERA),
            innings: ip
          });
        }
      }
    });
    
    // Calculate career ERA as weighted average
    aggregatedData = Object.values(pitcherStats).map(p => {
      let careerERA = "N/A";
      if (p.eraValues.length > 0) {
        let totalEarnedRuns = 0;
        let totalInnings = 0;
        
        p.eraValues.forEach(era => {
          const earnedRuns = (era.era * era.innings) / 7;
          totalEarnedRuns += earnedRuns;
          totalInnings += era.innings;
        });
        
        careerERA = totalInnings > 0 ? (totalEarnedRuns * 7) / totalInnings : "N/A";
      }
      
      return {
        ...p,
        IP: p.totalIP,
        ERA: careerERA
      };
    });
  } else {
    // For season leaders, use individual season records
    aggregatedData = data;
  }

  // Filter ERA candidates to those with meaningful innings
  const qualifyingPitchersForERA = aggregatedData.filter(p => parseFloat(p.IP) >= 10);
  
  let leaders = {};
  
  // Counting stats leaders
  ["games", "runsAllowed"].forEach(stat => {
    let maxPitcher = aggregatedData.reduce((prev, curr) =>
      curr[stat] > prev[stat] ? curr : prev,
      { [stat]: -1 }
    );
    
    if (type === 'season' && maxPitcher.name) {
      const pitcherRecord = data.find(p => p.name === maxPitcher.name && p[stat] === maxPitcher[stat]);
      leaders[stat] = `${maxPitcher.name} (${maxPitcher[stat]} - ${pitcherRecord?.year || ''} ${pitcherRecord?.season || ''})`;
    } else {
      leaders[stat] = maxPitcher.name ? `${maxPitcher.name} (${maxPitcher[stat]})` : "N/A";
    }
  });

  // Innings Pitched leader
  let mostIP = aggregatedData.reduce((prev, curr) => {
    let currIP = parseFloat(curr.IP) || 0;
    let prevIP = parseFloat(prev.IP) || 0;
    return currIP > prevIP ? curr : prev;
  }, { IP: "0" });
  
  if (mostIP.name) {
    if (type === 'season') {
      const pitcherRecord = data.find(p => p.name === mostIP.name && p.IP === mostIP.IP);
      leaders.IP = `${mostIP.name} (${mostIP.IP} - ${pitcherRecord?.year || ''} ${pitcherRecord?.season || ''})`;
    } else {
      leaders.IP = `${mostIP.name} (${parseFloat(mostIP.IP).toFixed(1)})`;
    }
  } else {
    leaders.IP = "N/A";
  }

  // ERA leader (minimum 10 innings)
  let bestERA = qualifyingPitchersForERA.reduce((prev, curr) => {
    let currERA = (curr.ERA !== "N/A" && !isNaN(curr.ERA)) ? Number(curr.ERA) : Infinity;
    let prevERA = (prev.ERA !== "N/A" && !isNaN(prev.ERA)) ? Number(prev.ERA) : Infinity;
    return currERA < prevERA ? curr : prev;
  }, { ERA: Infinity });
  
  if (bestERA.name && bestERA.ERA !== Infinity) {
    const era = Number(bestERA.ERA).toFixed(2);
    if (type === 'season') {
      const pitcherRecord = data.find(p => p.name === bestERA.name && Number(p.ERA) === Number(bestERA.ERA));
      leaders.ERA = `${bestERA.name} (${era} - ${pitcherRecord?.year || ''} ${pitcherRecord?.season || ''})`;
    } else {
      leaders.ERA = `${bestERA.name} (${era})`;
    }
  } else {
    leaders.ERA = "N/A";
  }

  return leaders;
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

    // Handle special cases for different views
    if (currentView === 'batting') {
      // Handle AcesWar column (index 8)
      if (columnIndex === 8) {
        if (x === "N/A" && y !== "N/A") return 1;
        if (y === "N/A" && x !== "N/A") return -1;
        if (x === "N/A" && y === "N/A") return 0;
      }
    } else if (currentView === 'pitching') {
      // Handle ERA column (index 6) 
      if (columnIndex === 6) {
        if (x === "N/A" && y !== "N/A") return 1;
        if (y === "N/A" && x !== "N/A") return -1;
        if (x === "N/A" && y === "N/A") return 0;
      }
      
      // Handle IP field (innings pitched can have decimals)
      if (columnIndex === 4) {
        let xNum = parseFloat(x);
        let yNum = parseFloat(y);
        if (!isNaN(xNum) && !isNaN(yNum)) {
          return dir === "asc" ? xNum - yNum : yNum - xNum;
        }
      }
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
