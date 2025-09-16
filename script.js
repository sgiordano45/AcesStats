let players = [];
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
    console.error('Error loading player data:', error);
  }
}

// Robust substitute check using exact JSON field "Sub"
function isSubstitute(p) {
  if (!p.Sub) return false;
  return p.Sub.toString().trim().toLowerCase() === "yes";
}

// Render main table
function renderTable() {
  const filterYear = document.getElementById("filterYear").value;
  const filterSeason = document.getElementById("filterSeason").value;
  const filterSub = document.getElementById("filterSub").value;

  const tbody = document.querySelector("#statsTable tbody");
  tbody.innerHTML = "";

  let filteredPlayers = players;

  // Apply filters
  if (filterYear !== "all") filteredPlayers = filteredPlayers.filter(p => p.year.toString() === filterYear);
  if (filterSeason !== "all") filteredPlayers = filteredPlayers.filter(p => p.season === filterSeason);
  if (filterSub === "regular") filteredPlayers = filteredPlayers.filter(p => !isSubstitute(p));
  if (filterSub === "subs") filteredPlayers = filteredPlayers.filter(p => isSubstitute(p));

  // Debug log to verify substitutes
  console.log(filteredPlayers.map(p => ({name: p.name, Sub: p.Sub, isSub: isSubstitute(p)})));

  // Sort table
  if (currentSortField) {
    filteredPlayers.sort((a, b) => {
      let valA = a[currentSortField];
      let valB = b[currentSortField];

      if (currentSortField === "AcesWar") {
        valA = (valA === null || valA === "N/A" || valA === "") ? -Infinity : Number(valA);
        valB = (valB === null || valB === "N/A" || valB === "") ? -Infinity : Number(valB);
      } else if (currentSortField === "Sub") {
        valA = isSubstitute(a) ? 1 : 0;
        valB = isSubstitute(b) ? 1 : 0;
      } else if (currentSortField === "Team" || typeof valA === 'string') {
        valA = valA ? valA.toString().toUpperCase() : "";
        valB = valB ? valB.toString().toUpperCase() : "";
      }

      if (valA < valB) return currentSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return currentSortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }

  // Render table rows
  filteredPlayers.forEach(p => {
    const acesWarDisplay = (p.AcesWar === null || p.AcesWar === "N/A" || p.AcesWar === "") ? "N/A" : p.AcesWar;
    const row = `<tr>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}">${p.name}</a></td>
      <td><a href="team.html?team=${encodeURIComponent(p.Team)}">${p.Team || "N/A"}</a></td>
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

  renderLeagueSummary(filteredPlayers);
  populateFilters();

  // Update sort arrows
  document.querySelectorAll("th[data-field]").forEach(th => {
    const span = th.querySelector(".sort-arrow");
    span.textContent = (th.dataset.field === currentSortField) ? (currentSortOrder === 'asc' ? '▲' : '▼') : '';
  });
}

// Sorting function
function sortTable(field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortField = field;
    currentSortOrder = 'asc';
  }
  renderTable();
}

// Populate Year and Season filters
function populateFilters() {
  const yearSelect = document.getElementById("filterYear");
  const seasonSelect = document.getElementById("filterSeason");

  const years = [...new Set(players.map(p => p.year))].sort((a,b) => b-a);
  yearSelect.innerHTML = `<option value="all">All</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");

  const seasons = [...new Set(players.map(p => p.season))];
  seasonSelect.innerHTML = `<option value="all">All</option>` + seasons.map(s => `<option value="${s}">${s}</option>`).join("");
}

// Render league summary
function renderLeagueSummary(filteredPlayers) {
  if (!filteredPlayers.length) {
    document.getElementById("leagueSummary").textContent = "No players found for selected filters.";
    return;
  }

  const totalGames = filteredPlayers.reduce((sum, p) => sum + Number(p.games || 0), 0);
  const totalAtBats = filteredPlayers.reduce((sum, p) => sum + Number(p.atBats || 0), 0);
  const totalHits = filteredPlayers.reduce((sum, p) => sum + Number(p.hits || 0), 0);
  const totalRuns = filteredPlayers.reduce((sum, p) => sum + Number(p.runs || 0), 0);
  const totalWalks = filteredPlayers.reduce((sum, p) => sum + Number(p.walks || 0), 0);

  const acesValues = filteredPlayers.map(p => Number(p.AcesWar)).filter(v => !isNaN(v));
  const avgAcesWar = acesValues.length ? (acesValues.reduce((a,b)=>a+b,0)/acesValues.length).toFixed(2) : "N/A";

  document.getElementById("leagueSummary").textContent =
    `Totals → Games: ${totalGames}, At Bats: ${totalAtBats}, Hits: ${totalHits}, Runs: ${totalRuns}, Walks: ${totalWalks}, Avg AcesWar: ${avgAcesWar}`;
}

// Initial load
loadData();
