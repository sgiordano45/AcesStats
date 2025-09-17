let teamData = [];
let currentSort = { column: null, dir: "asc" };

fetch("data.json")
  .then(res => res.json())
  .then(data => {
    const params = new URLSearchParams(window.location.search);
    const currentTeam = params.get("team");
    teamData = cleanData(data).filter(p => p.team === currentTeam);

    document.getElementById("team-name").textContent = currentTeam;
    populateFilters(teamData);
    renderTable(teamData);
  });

function cleanData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : "",
    year: p.year ? String(p.year).trim() : "",
  }));
}

function populateFilters(data) {
  const years = [...new Set(data.map(p => p.year))].sort();
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
      (yearVal === "" || p.year === yearVal) &&
      (seasonVal === "" || p.season === seasonVal)
  );

  renderTable(filtered);
}

function renderTable(data) {
  const tbody = document.querySelector("#team-stats-table tbody");
  tbody.innerHTML = "";

  // Totals
  let totals = {
    games: 0,
    atBats: 0,
    hits: 0,
    runs: 0,
    walks: 0,
  };

  data.forEach(p => {
    totals.games += Number(p.games) || 0;
    totals.atBats += Number(p.atBats) || 0;
    totals.hits += Number(p.hits) || 0;
    totals.runs += Number(p.runs) || 0;
    totals.walks += Number(p.walks) || 0;
  });

  // Leaders
  let leaders = {};
  ["games", "atBats", "hits", "runs", "walks"].forEach(stat => {
    let maxPlayer = data.reduce((prev, curr) =>
      (Number(curr[stat]) || 0) > (Number(prev[stat]) || 0) ? curr : prev,
      {}
    );
    leaders[stat] = maxPlayer.name || "N/A";
  });

  // BA, OBP, AcesWar Leaders
  let bestBA = data.reduce((prev, curr) => {
    let ba = curr.atBats > 0 ? curr.hits / curr.atBats : -1;
    let prevBa = prev.atBats > 0 ? prev.hits / prev.atBats : -1;
    return ba > prevBa ? curr : prev;
  }, {});
  leaders.BA = bestBA.name || "N/A";

  let bestOBP = data.reduce((prev, curr) => {
    let obp = (curr.atBats + curr.walks) > 0
      ? (curr.hits + curr.walks) / (curr.atBats + curr.walks)
      : -1;
    let prevObp = (prev.atBats + prev.walks) > 0
      ? (prev.hits + prev.walks) / (prev.atBats + prev.walks)
      : -1;
    return obp > prevObp ? curr : prev;
  }, {});
  leaders.OBP = bestOBP.name || "N/A";

  let bestWAR = data.reduce((prev, curr) => {
    let war = (!isNaN(curr.AcesWar) && curr.AcesWar !== null) ? Number(curr.AcesWar) : -Infinity;
    let prevWar = (!isNaN(prev.AcesWar) && prev.AcesWar !== null) ? Number(prev.AcesWar) : -Infinity;
    return war > prevWar ? curr : prev;
  }, {});
  leaders.AcesWar = bestWAR.name || "N/A";

  document.getElementById("totalsText").textContent =
    `Totals – Games: ${totals.games}, At Bats: ${totals.atBats}, Hits: ${totals.hits}, Runs: ${totals.runs}, Walks: ${totals.walks}`;

  document.getElementById("leadersText").textContent =
    `Leaders – Games: ${leaders.games}, At Bats: ${leaders.atBats}, Hits: ${leaders.hits}, Runs: ${leaders.runs}, Walks: ${leaders.walks}, 
    BA: ${leaders.BA}, OBP: ${leaders.OBP}, AcesWar: ${leaders.AcesWar}`;

  // Rows
  data.forEach(p => {
    const row = document.createElement("tr");
    const BA = p.atBats > 0 ? (p.hits / p.atBats).toFixed(3) : "N/A";
    const OBP =
      p.atBats + p.walks > 0
        ? ((Number(p.hits) + Number(p.walks)) / (Number(p.atBats) + Number(p.walks))).toFixed(3)
        : "N/A";
    const AcesWar = p.AcesWar && !isNaN(p.AcesWar)
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

// Sorting
function attachSorting() {
  const headers = document.querySelectorAll("#team-stats-table th");
  headers.forEach((th, idx) => {
    th.onclick = () => sortTable(idx);
  });
}

function sortTable(n) {
  const table = document.getElementById("team-stats-table");
  const rows = Array.from(table.rows).slice(1);

  let dir = currentSort.column === n && currentSort.dir === "asc" ? "desc" : "asc";
  currentSort = { column: n, dir };

  rows.sort((a, b) => {
    let x = a.cells[n].innerText;
    let y = b.cells[n].innerText;

    let xVal = parseFloat(x.replace(/,/g, ""));
    let yVal = parseFloat(y.replace(/,/g, ""));

    if (n === 8) { // AcesWar column index
      if (x === "N/A") return 1;
      if (y === "N/A") return -1;
    }

    if (!isNaN(xVal) && !isNaN(yVal)) {
      return dir === "asc" ? xVal - yVal : yVal - xVal;
    }
    return dir === "asc"
      ? x.localeCompare(y)
      : y.localeCompare(x);
  });

  rows.forEach(r => table.tBodies[0].appendChild(r));

  document.querySelectorAll("#team-stats-table th").forEach(th => th.classList.remove("asc", "desc"));
  table.rows[0].cells[n].classList.add(dir);
}
