let allData = [];
let currentSort = { column: null, dir: "asc" };

fetch("data.json")
  .then(res => res.json())
  .then(data => {
    allData = cleanData(data);
    populateFilters(allData);
    renderTable(allData);
  });

// Trim whitespace
function cleanData(data) {
  return data.map(p => ({
    ...p,
    name: p.name ? p.name.trim() : "",
    team: p.team ? p.team.trim() : "",
    season: p.season ? p.season.trim() : "",
    year: p.year ? String(p.year).trim() : "",
  }));
}

// Dropdown filters
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

// Apply filters
function applyFilters() {
  const yearVal = document.getElementById("yearFilter").value;
  const seasonVal = document.getElementById("seasonFilter").value;

  let filtered = allData.filter(
    p =>
      (yearVal === "All" || p.year === yearVal) &&
      (seasonVal === "All" || p.season === seasonVal)
  );

  renderTable(filtered);
}

// Render table
function renderTable(data) {
  const tbody = document.querySelector("#statsTable tbody");
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

  // Update summary text
  document.getElementById("totalsText").textContent =
    `Totals – Games: ${totals.games}, At Bats: ${totals.atBats}, Hits: ${totals.hits}, Runs: ${totals.runs}, Walks: ${totals.walks}`;

  document.getElementById("leadersText").textContent =
    `Leaders – Games: ${leaders.games}, At Bats: ${leaders.atBats}, Hits: ${leaders.hits}, Runs: ${leaders.runs}, Walks: ${leaders.walks}`;

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
      <td><a href="player.html?name=${encodeURIComponent(p.name)}">${p.name}</a></td>
      <td><a href="team.html?team=${encodeURIComponent(p.team)}">${p.team}</a></td>
      <td>${p.year}</td>
      <td>${p.season}</td>
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
  const headers = document.querySelectorAll("#statsTable th");
  headers.forEach((th, idx) => {
    th.onclick = () => sortTable(idx, th.getAttribute("data-field"));
  });
}

function sortTable(n, field) {
  const table = document.getElementById("statsTable");
  const rows = Array.from(table.rows).slice(1);

  let dir = currentSort.column === field && currentSort.dir === "asc" ? "desc" : "asc";
  currentSort = { column: field, dir };

  rows.sort((a, b) => {
    let x = a.cells[n].innerText;
    let y = b.cells[n].innerText;

    let xVal = parseFloat(x.replace(/,/g, ""));
    let yVal = parseFloat(y.replace(/,/g, ""));

    if (field === "AcesWar") {
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

  document.querySelectorAll("#statsTable th").forEach(th => th.classList.remove("asc", "desc"));
  table.rows[0].cells[n].classList.add(dir);
}
