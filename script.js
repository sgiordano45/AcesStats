let players = []; // populated from data.json
let currentSortField = 'year';
let currentSortOrder = 'asc';

// Load player data
async function loadData() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('Failed to load data.json');
    players = await response.json();
    renderTable();
    populateFilters();
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Simplified substitute detection
function isSubstitute(p) {
  return p.sub === "Yes";
}

// Render the main table
function renderTable() {
  const filterYear = document.getElementById("filterYear").value;
  const filterSeason = document.getElementById("filterSeason").value;
  const filterSub = document.getElementById("filterSub").value;

  const tbody = document.querySelector("#statsTable tbody");
  tbody.innerHTML = "";

  let filteredPlayers = players;

  if (filterYear !== "all") filteredPlayers = filteredPlayers.filter(p => p.year.toString() === filterYear);
  if (filterSeason !== "all") filteredPlayers = filteredPlayers.filter(p => p.season === filterSeason);
  if (filterSub === "regular") filteredPlayers = filteredPlayers.filter(p => !isSubstitute(p));
  if (filterSub === "subs") filteredPlayers = filteredPlayers.filter(p => isSubstitute(p));

  // Sort
  if (currentSortField) {
    filteredPlayers.sort((a, b) => {
      let valA = a[currentSortField];
      let valB = b[currentSortField];

      if (currentSortField === "AcesWar") {
        valA = (valA === null || valA === "N/A" || valA === "") ? -Infinity : Number(valA);
        valB = (valB === null || valB === "N/A" || valB === "") ? -Infinity : Number(valB);
      } else if (currentSortField === "sub") {
        valA = isSubstitute(a) ? 1 : 0;
        valB = isSubstitute(b) ? 1 : 0;
      } else {
        if (typeof valA === 'string') valA = valA.toUpperCase();
        if (typeof valB === 'string') valB = valB.toUpperCase();
      }

      if (valA < valB) return currentSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return currentSortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }

  if (filteredPlayers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;">No results found</td></tr>`;
    return;
  }

  filteredPlayers.forEach(p => {
    const acesWarDisplay = (p.AcesWar === null || p.AcesWar === "N/A" || p.AcesWar === "") ? "N/A" : p.AcesWar;

    const row = `<tr>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}">${p.name}</a></td>
      <td><a href="team.html?team=${encodeURIComponent(p.team)}">${p.team || "N/A"}</a></td>
      <td>${p.year}</td>
      <td>${p.season}</td>
      <td>${p.games}</td>
      <td>${p.atBats}</td>
      <td>${p.hits}</td>
      <td>${p.runs}</td>
      <td>${p.walks}</td>
      <td>${acesWarDisplay}</td>
      <td>${isSubstitute(p) ? "Yes" : "No"}</td>
    </tr>`;
    tbody.innerHTML += row;
  });

  populateFilters();
}

// Sort table
function sortTable(field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortField = field;
    currentSortOrder = 'asc';
  }
  renderTable();
}

// Populate Year and Season filters dynamically
function populateFilters() {
  const yearSelect = document.getElementById("filterYear");
  const seasonSelect = document.getElementById("filterSeason");

  // Populate Year
  const years = [...new Set(players.map(p => p.year))].sort((a, b) => b - a);
  yearSelect.innerHTML = `<option value="all">All</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");

  // Populate Season
  const seasons = [...new Set(players.map(p => p.season))];
  seasonSelect.innerHTML = `<option value="all">All</option>` + seasons.map(s => `<option value="${s}">${s}</option>`).join("");
}

// Initialize
loadData();
