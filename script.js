let players = [];
let hitsChart = null;

// Load player data from JSON
async function loadData() {
  try {
    const response = await fetch("data.json");
    players = await response.json();

    populateFilters();
    renderTable();
  } catch (error) {
    console.error("Error loading player data:", error);
  }
}

// Populate Year and Season dropdowns dynamically
function populateFilters() {
  const yearSelect = document.getElementById("filterYear");
  const seasonSelect = document.getElementById("filterSeason");

  // Reset dropdowns
  yearSelect.innerHTML = `<option value="all">All Years</option>`;
  seasonSelect.innerHTML = `<option value="all">All Seasons</option>`;

  const selectedYear = yearSelect.value;
  const selectedSeason = seasonSelect.value;

  let yearOptions = [...new Set(players.map(p => p.year))].sort();
  let seasonOptions = [...new Set(players.map(p => p.season))].sort();

  // If a season is chosen, only include years that have that season
  if (selectedSeason !== "all") {
    yearOptions = [...new Set(players.filter(p => p.season === selectedSeason).map(p => p.year))].sort();
  }

  // If a year is chosen, only include seasons for that year
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

  if (filterYear !== "all") {
    filteredPlayers = filteredPlayers.filter(p => p.year.toString() === filterYear);
  }
  if (filterSeason !== "all") {
    filteredPlayers = filteredPlayers.filter(p => p.season === filterSeason);
  }
  if (filterSub === "regular") {
    filteredPlayers = filteredPlayers.filter(p => !p.sub);
  } else if (filterSub === "subs") {
    filteredPlayers = filteredPlayers.filter(p => p.sub);
  }

  filteredPlayers.forEach(p => {
    const row = `<tr>
      <td>${p.name}</td>
      <td>${p.year}</td>
      <td>${p.season}</td>
      <td>${p.games}</td>
      <td>${p.atBats}</td>
      <td>${p.hits}</td>
      <td>${p.runs}</td>
      <td>${p.walks}</td>
      <td>${p.sub ? "Yes" : "No"}</td>
    </tr>`;
    tbody.innerHTML += row;
  });

  renderChart(filteredPlayers);
  populateFilters(); // re-populate filters dynamically after filtering
}

// Render chart with Chart.js
function renderChart(filteredPlayers) {
  const ctx = document.getElementById("hitsChart").getContext("2d");

  if (hitsChart) {
    hitsChart.destroy(); // clear previous chart
  }

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
      scales: {
        y: { beginAtZero: true }
      }
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


// Run when page loads
loadData();
