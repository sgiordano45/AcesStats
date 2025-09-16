let teamData = [];
let currentTeam = "";

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
}

// Basic column sorting
function sortTable(n) {
  const table = document.getElementById("team-stats-table");
  let switching = true;
  let dir = "asc";
  let switchcount = 0;

  while (switching) {
    switching = false;
    const rows = table.rows;
    for (let i = 1; i < rows.length - 1; i++) {
      let shouldSwitch = false;
      let x = rows[i].getElementsByTagName("td")[n];
      let y = rows[i + 1].getElementsByTagName("td")[n];

      let xContent = isNaN(x.innerText) ? x.innerText.toLowerCase() : parseFloat(x.innerText.replace(/,/g, ""));
      let yContent = isNaN(y.innerText) ? y.innerText.toLowerCase() : parseFloat(y.innerText.replace(/,/g, ""));

      if (dir === "asc" && xContent > yContent) shouldSwitch = true;
      if (dir === "desc" && xContent < yContent) shouldSwitch = true;

      if (shouldSwitch) {
        rows[i].parentNode.insertBefore(rows[i + 1], rows[i]);
        switching = true;
        switchcount++;
        break;
      }
    }
    if (switchcount === 0 && dir === "asc") {
      dir = "desc";
      switching = true;
    }
  }
}
