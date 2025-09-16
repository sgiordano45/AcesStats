let players = [];
let hitsChart = null;

// Load player data from JSON
async function loadData() {
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    
    players = await response.json();
    console.log("Loaded players:", players);

    populateFilters();
    renderTable();
  } catch (error) {
    console.error("Error loading player data:", error);
    showError("⚠️ Could not load player data. Check that <b>data.json</b> is in the same folder as <b>index.html</b> or published on GitHub Pages.");
  }
}

// Show error message
function showError(message) {
  const container = document.getElementById("statsTable");
  container.innerHTML = `<tr><td colspan="11" style="color:red; text-align:center;">${message}</td></tr>`;
  const ctx = document.getElementById("hitsChart").getContext("2d");
  ctx.font = "16px Arial";
  ctx.fillStyle = "red";
  ctx.fillText("⚠️ No chart data (data.json missing or invalid)", 10, 50);
}

// Populate Year and Season dropdowns dynamically
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

// Render the stats table
function renderTable() {
  const filterYear = document.getElementById("filterYear").value;
  const filterSeason = document.getElementById("filterSeason").value;
  const filterSub = document.getElementById("filterSub").value;
  const tbody = document.querySelector("#statsTable tbody");
  tbody.innerHTML = "";

  let filteredPlayers = players;

  if (filterYear !== "all") filteredPlayers = filteredPlayers.filter(p => p.year.toString() === filterYear);
  if (filterSeason !== "all") filteredPlayers = filteredPlayers.filter(p => p.season === filterSeason);
if (filterSub === "regular") 
    filteredPlayers = filteredPlayers.filter(p => p.sub === false || p.sub === "false");
if (filterSub === "subs") 
    filteredPlayers = filteredPlayers.filter(p => p.sub === true || p.sub === "true");

  if (filteredPlayers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;">No results found</td></tr>`;
  }

  filteredPlayers.forEach(p => {
    const acesWarDisplay = (p.AcesWar === null || p.AcesWar === "N/A") ? "N/A" : p.AcesWar;
    const row = `<tr>
      <td>${p.name}</td>
      <td>${p.team}</td>
      <td>${p.year}</td>
      <td>${p.season}</td>
      <td>${p.games}</td>
      <td>${p.atBats}</td>
      <td>${p.hits}</td>
      <td>${p.runs}</td>
      <td>${p.walks}</td>
      <td>${acesWarDisplay}</td>
      <td>${p.sub ? "Yes" : "No"}</td>
    </tr>`;
    tbody.innerHTML += row;
  });

  renderChart(filteredPlayers);
  populateFilters();
}

// Render chart with Chart.js
function renderChart(filteredPlayers) {
  const ctx = document.getElementById("hitsChart").getContext("2d");
  if (hitsChart) hitsChart.destroy();
  if (filteredPlayers.length === 0) return;

  hitsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: filteredPlayers.map(p => `${p.name} (${p.season} ${p.year})`),
      datasets: [{
        label: "Hits",
        data: filteredPlayers.map(p => p.hits),
        backgroundColor: "rgba(75, 192, 192, 0.6)"
      }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
}

// Reset all filters
function resetFilters() {
  document.getElementById("filterYear").value = "all";
  document.getElementById("filterSeason").value = "all";
  document.getElementById("filterSub").value = "all";
  renderTable();
}

// Run on page load
loadData();

