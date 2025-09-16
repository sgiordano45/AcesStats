let teamData = [];
let currentTeam = "";
let currentSortField = null;
let currentSortAsc = true;

// Trim whitespace in names/teams/seasons
function cleanData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : ""
  }));
}

// Load JSON and filter for current team
fetch('data.json')
  .then(res => res.json())
  .then(data => {
    const params = new URLSearchParams(window.location.search);
    currentTeam = params.get('team') || "";
    teamData = cleanData(data).filter(p => p.team === currentTeam);

    document.getElementById("team-name").textContent = currentTeam;
    populateFilters(teamData);
    renderTable(teamData);
  })
  .catch(err => console.error("Error loading team data:", err));

// Populate Year/Season dropdowns dynamically
function populateFilters(data) {
  const yearSet = new Set();
  const seasonSet = new Set();

  data.forEach(p => {
    if (p.year) yearSet.add(p.year);
    if (p.season) seasonSet.add(p.season);
  });

  const yearFilter = document.getElementById("yearFilter");
  const seasonFilter = document.getElementById("seasonFilter");

  [...yearSet].sort((a,b)=>b-a).forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearFilter.appendChild(opt);
  });

  [...seasonSet].sort().forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    seasonFilter.appendChild(opt);
  });

  yearFilter.addEventListener("change", applyFilters);
  seasonFilter.addEventListener("change", applyFilters);
}

// Apply filters and rerender table
function applyFilters() {
  const yearVal = document.getElementById("yearFilter").value;
  const seasonVal = document.getElementById("seasonFilter").value;

  let filtered = teamData.filter(p => 
    (yearVal === "" || p.year == yearVal) &&
    (seasonVal === "" || p.season === seasonVal)
  );

  renderTable(filtered);
}

// Render table
function renderTable(data) {
  const tbody = document.querySelector("#team-stats-table tbody");
  tbody.innerHTML = "";

  data.forEach(p => {
    const atBats = Number(p.atBats) || 0;
    const hits = Number(p.hits) || 0;
    const walks = Number(p.walks) || 0;
    const games = Number(p.games) || 0;
    const runs = Number(p.runs) || 0;
    const AcesWar = !isNaN(Number(p.AcesWar)) ? Number(p.AcesWar).toFixed(2) : "N/A";

    const BA = atBats > 0 ? (hits / atBats).toFixed(3) : "0.000";
    const OBP = (atBats + walks) > 0 ? ((hits + walks) / (atBats + walks)).toFixed(3) : "0.000";

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${p.year ?? ""}</td>
      <td>${p.season ?? ""}</td>
      <td><a href="player.html?name=${encodeURIComponent(p.name ?? "")}">${p.name ?? ""}</a></td>
      <td>${games.toLocaleString()}</td>
      <td>${atBats.toLocaleString()}</td>
      <td>${hits.toLocaleString()}</td>
      <td>${runs.toLocaleString()}</td>
      <td>${walks.toLocaleString()}</td>
      <td>${AcesWar}</td>
      <td>${BA}</td>
      <td>${OBP}</td>
      <td>${p.Sub ?? ""}</td>
    `;
    tbody.appendChild(row);
  });

  // Update sort arrows in header
  document.querySelectorAll('#team-stats-table th').forEach((th, index) => {
    th.classList.remove('asc', 'desc');
    th.textContent = th.textContent.replace(/ ▲| ▼/g, '');
    if (index === currentSortField) {
      th.textContent += currentSortAsc ? ' ▲' : ' ▼';
    }
  });
}

// Make all headers sortable
document.querySelectorAll('#team-stats-table th').forEach((th, index) => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    if (!th) return;

    if (currentSortField === index) currentSortAsc = !currentSortAsc;
    else {
      currentSortField = index;
      currentSortAsc = true;
    }

    const sorted = [...teamData].sort((a, b) => {
      let valA, valB;

      switch(index) {
        case 0: valA = a.year; valB = b.year; break;
        case 1: valA = a.season; valB = b.season; break;
        case 2: valA = a.name; valB = b.name; break;
        case 3: valA = Number(a.games) || 0; valB = Number(b.games) || 0; break;
        case 4: valA = Number(a.atBats) || 0; valB = Number(b.atBats) || 0; break;
        case 5: valA = Number(a.hits) || 0; valB = Number(b.hits) || 0; break;
        case 6: valA = Number(a.runs) || 0; valB = Number(b.runs) || 0; break;
        case 7: valA = Number(a.walks) || 0; valB = Number(b.walks) || 0; break;
        case 8: 
          valA = !isNaN(Number(a.AcesWar)) ? Number(a.AcesWar) : (currentSortAsc ? -Infinity : Infinity);
          valB = !isNaN(Number(b.AcesWar)) ? Number(b.AcesWar) : (currentSortAsc ? -Infinity : Infinity);
          break;
        case 9: valA = (Number(a.hits)/Number(a.atBats)) || 0; valB = (Number(b.hits)/Number(b.atBats)) || 0; break;
        case 10: valA = ((Number(a.hits)+Number(a.walks))/(Number(a.atBats)+Number(a.walks))) || 0;
                 valB = ((Number(b.hits)+Number(b.walks))/(Number(b.atBats)+Number(b.walks))) || 0; break;
        case 11: valA = a.Sub ?? ""; valB = b.Sub ?? ""; break;
        default: valA = ""; valB = "";
      }

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return currentSortAsc ? -1 : 1;
      if (valA > valB) return currentSortAsc ? 1 : -1;
      return 0;
    });

    renderTable(sorted);
  });
});
