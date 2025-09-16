let players = [];
let currentSortField = null;
let currentSortOrder = 'asc'; // ascending by default

// Load player data
async function loadData() {
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    players = await response.json();

    populateFilters();
    renderTable();
  } catch (error) {
    console.error("Error loading player data:", error);
    showError("⚠️ Could not load player data. Check data.json.");
  }
}

// Show error message
function showError(message) {
  const container = document.querySelector("#statsTable tbody");
  container.innerHTML = `<tr><td colspan="11" style="color:red; text-align:center;">${message}</td></tr>`;
}

// Robust substitute detection
function isSubstitute(p) {
  if (p.sub === null || p.sub === undefined) return false;
  const val = String(p.sub).trim().toLowerCase();
  return val === "true" || val === "yes" || val === "1";
}

// Populate filter dropdowns
function populateFilters() {
  const yearSelect = document.getElementById("filterYear");
  const seasonSelect = document.getElementById("filterSeason");

  const selectedYear = yearSelect.value || "all";
  const selectedSeason = seasonSelect.value || "all";

  yearSelect.innerHTML = `<option value="all">All Years</option>`;
  seasonSelect.innerHTML = `<option value="all">All Seasons</option>`;

  let yearOptions = [...new Set(players.map(p => p.year))].sort();
  let seasonOptions = [...new Set(players.map(p => p.season))].sort();

  if (selectedSeason !== "all") {
    yearOptions = [...new Set(players.filter(p => p.season === selectedSeason).map(p => p.year))].sort();
  }

  if (selectedYear !== "all") {
    seasonOptions = [...new Set(players.filter(p => p.year.toString() === selectedYear).map(p => p.season))].sort();
  }

  yearOptions.forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y.toString() === selectedYear) opt.selected = true;
    yearSelect.appendChild(opt);
  });

  seasonOptions.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    if (s === selectedSeason) opt.selected = true;
    seasonSelect.appendChild(opt);
  });
}

// Render table
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

      // Numeric handling for AcesWar
      if (currentSortField === "AcesWar") {
        valA = (valA === null || valA === "N/A" || valA === "") ? -Infinity : Number(valA);
        valB = (valB === null || valB === "N/A" || valB === "") ? -Infinity : Number(valB);
      } else {
        if (valA === null || valA === "N/A") valA = -Infinity;
        if (valB === null || valB === "N/A") valB = -Infinity;
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
  }

  filteredPlayers.forEach(p => {
    const acesWarDisplay = (p.AcesWar === null || p.AcesWar === "N/A" || p.AcesWar === "") ? "N/A" : p.AcesWar;
    const row = `<tr>
      <td>${p.name}</td>
      <td>${p.team || "N/A"}</td>
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
  <td>
  <a href="player.html?name=${encodeURIComponent(p.name)}">${p.name}</a>
</td>

  populateFilters();
}

// Sorting helper with arrows
function sortTable(field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortField = field;
    currentSortOrder = 'asc';
  }

  document.querySelectorAll("th[data-field]").forEach(th => {
    const span = th.querySelector(".sort-arrow");
    span.textContent = (th.dataset.field === currentSortField) ? (currentSortOrder === 'asc' ? '▲' : '▼') : '';
  });

  renderTable();
}

// Reset filters
function resetFilters() {
  document.getElementById("filterYear").value = "all";
  document.getElementById("filterSeason").value = "all";
  document.getElementById("filterSub").value = "all";
  renderTable();
}

// Initialize
loadData();

