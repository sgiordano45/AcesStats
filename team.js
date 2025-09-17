let teamData = [];
let currentSort = { column: null, dir: "asc" };
let currentTeam = null;

// Initialize page
const params = new URLSearchParams(window.location.search);
currentTeam = params.get("team");

if (!currentTeam) {
  document.body.innerHTML = '<h1>Error: No team specified</h1><p><a href="index.html">Return to main page</a></p>';
} else {
  document.getElementById("team-name").textContent = currentTeam;
  loadTeamData();
}

async function loadTeamData() {
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error('Failed to load data.json');
    const data = await response.json();
    
    teamData = cleanData(data).filter(p => p.team === currentTeam);
    
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
      <p>Could not load statistics. Please check that data.json is available.</p>
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
    document.getElementById("leadersText").textContent = "";
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

  // Find leaders - only consider players with meaningful at-bats for average stats
  const qualifyingPlayers = data.filter(p => p.atBats >= 10);
  let leaders = {};
  
  // Counting stats leaders
  ["games", "atBats", "hits", "runs", "walks"].forEach(stat => {
    let maxPlayer = data.reduce((prev, curr) =>
      curr[stat] > prev[stat] ? curr : prev,
      { [stat]: -1 }
    );
    leaders[stat] = maxPlayer.name ? `${maxPlayer.name} (${maxPlayer[stat]})` : "N/A";
  });

  // Batting Average leader (minimum 10 at-bats)
  let bestBA = qualifyingPlayers.reduce((prev, curr) => {
    let currBA = curr.atBats > 0 ? curr.hits / curr.atBats : 0;
    let prevBA = prev.atBats > 0 ? prev.hits / prev.atBats : 0;
    return currBA > prevBA ? curr : prev;
  }, { atBats: 0, hits: 0 });
  leaders.BA = bestBA.name ? 
    `${bestBA.name} (${(bestBA.hits / bestBA.atBats).toFixed(3)})` : "N/A";

  // On-Base Percentage leader
  let bestOBP = qualifyingPlayers.reduce((prev, curr) => {
    let currOBP = (curr.atBats + curr.walks) > 0 
      ? (curr.hits + curr.walks) / (curr.atBats + curr.walks) 
      : 0;
    let prevOBP = (prev.atBats + prev.walks) > 0 
      ? (prev.hits + prev.walks) / (prev.atBats + prev.walks) 
      : 0;
    return currOBP > prevOBP ? curr : prev;
  }, { atBats: 0, hits: 0, walks: 0 });
  leaders.OBP = bestOBP.name ? 
    `${bestOBP.name} (${((bestOBP.hits + bestOBP.walks) / (bestOBP.atBats + bestOBP.walks)).toFixed(3)})` : "N/A";

  // AcesWar leader
  let bestWAR = data.reduce((prev, curr) => {
    let currWAR = (curr.AcesWar !== "N/A" && !isNaN(curr.AcesWar)) ? Number(curr.AcesWar) : -Infinity;
    let prevWAR = (prev.AcesWar !== "N/A" && !isNaN(prev.AcesWar)) ? Number(prev.AcesWar) : -Infinity;
    return currWAR > prevWAR ? curr : prev;
  }, { AcesWar: -Infinity });
  leaders.AcesWar = bestWAR.name ? 
    `${bestWAR.name} (${Number(bestWAR.AcesWar).toFixed(2)})` : "N/A";

  // Update summary text with proper em-dashes
  document.getElementById("totalsText").textContent =
    `Totals — Games: ${totals.games}, At Bats: ${totals.atBats}, Hits: ${totals.hits}, Runs: ${totals.runs}, Walks: ${totals.walks}`;

  document.getElementById("leadersText").textContent =
    `Leaders — Games: ${leaders.games}, At Bats: ${leaders.atBats}, Hits: ${leaders.hits}, Runs: ${leaders.runs}, Walks: ${leaders.walks}, BA: ${leaders.BA}, OBP: ${leaders.OBP}, AcesWar: ${leaders.AcesWar}`;

  // Generate table rows
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
