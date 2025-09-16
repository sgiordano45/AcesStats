let allData = [];
let currentSortField = null;
let currentSortAsc = true;

// Clean whitespace from name/team/season
function cleanData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : p.name,
    team: p.team ? p.team.trim() : p.team,
    season: p.season ? p.season.trim() : p.season
  }));
}

// Load JSON
fetch('data.json')
  .then(res => res.json())
  .then(data => {
    console.log("Sample row from data.json:", data[0]); // Debug
    allData = cleanData(data);
    populateFilters(allData);
    renderTable(allData);
  })
  .catch(err => console.error("Error loading player data:", err));

// Populate year/season dropdowns
function populateFilters(data) {
  const yearSet = new Set();
  const seasonSet = new Set();

  data.forEach(p => {
    if (p.year) yearSet.add(p.year);
    if (p.season) seasonSet.add(p.season);
  });

  const yearFilter = document.getElementById('yearFilter');
  const seasonFilter = document.getElementById('seasonFilter');

  [...yearSet].sort((a, b) => b - a).forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    yearFilter.appendChild(opt);
  });

  [...seasonSet].sort().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    seasonFilter.appendChild(opt);
  });

  yearFilter.addEventListener('change', applyFilters);
  seasonFilter.addEventListener('change', applyFilters);
}

// Apply dropdown filters
function applyFilters() {
  const selectedYear = document.getElementById('yearFilter').value;
  const selectedSeason = document.getElementById('seasonFilter').value;

  let filtered = allData;

  if (selectedYear !== 'All') {
    filtered = filtered.filter(p => p.year == selectedYear);
  }
  if (selectedSeason !== 'All') {
    filtered = filtered.filter(p => p.season === selectedSeason);
  }

  renderTable(filtered);
}

// Render table rows
function renderTable(data) {
  const tbody = document.querySelector('#statsTable tbody');
  tbody.innerHTML = "";

  data.forEach(p => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${p.year ?? ""}</td>
      <td>${p.season ?? ""}</td>
      <td><a href="player.html?name=${encodeURIComponent(p.name ?? "")}">${p.name ?? ""}</a></td>
      <td><a href="team.html?team=${encodeURIComponent(p.team ?? "")}">${p.team ?? ""}</a></td>
      <td>${p.games !== undefined ? Number(p.games).toLocaleString() : ""}</td>
      <td>${p.atBats !== undefined ? Number(p.atBats).toLocaleString() : ""}</td>
      <td>${p.hits !== undefined ? Number(p.hits).toLocaleString() : ""}</td>
      <td>${p.runs !== undefined ? Number(p.runs).toLocaleString() : ""}</td>
      <td>${p.walks !== undefined ? Number(p.walks).toLocaleString() : ""}</td>
      <td>${p.Sub ?? ""}</td>
      <td>${!isNaN(Number(p.AcesWar)) ? Number(p.AcesWar).toFixed(2) : "N/A"}</td>
    `;
    tbody.appendChild(row);
  });
}

// Table sorting
document.querySelectorAll('#statsTable th').forEach(th => {
  th.addEventListener('click', () => {
    const field = th.dataset.field;
    if (!field) return;

    if (currentSortField === field) {
      currentSortAsc = !currentSortAsc;
    } else {
      currentSortField = field;
      currentSortAsc = true;
    }

    const sorted = [...allData].sort((a, b) => {
      let valA = a[field];
      let valB = b[field];

      if (!isNaN(valA) && !isNaN(valB)) {
        valA = Number(valA);
        valB = Number(valB);
      } else {
        valA = (valA ?? "").toString().toLowerCase();
        valB = (valB ?? "").toString().toLowerCase();
      }

      if (valA < valB) return currentSortAsc ? -1 : 1;
      if (valA > valB) return currentSortAsc ? 1 : -1;
      return 0;
    });

    renderTable(sorted);
  });
});
