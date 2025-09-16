let teamPlayers = [];
let currentSortField = 'year';
let currentSortOrder = 'asc';

function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

async function loadTeamData() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('Failed to load data.json');
    const players = await response.json();

    const teamName = getQueryParam('team');
    document.getElementById('teamName').textContent = teamName || "Team Stats";

    teamPlayers = players.filter(p => p.team === teamName);
    renderTable();
  } catch (error) {
    console.error('Error loading team data:', error);
  }
}

function isSubstitute(p) {
  return p.Sub === "Yes";
}

function renderTable() {
  const tbody = document.querySelector("#teamStatsTable tbody");
  tbody.innerHTML = "";

  if (teamPlayers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;">No players found</td></tr>`;
    renderTeamSummary();
    return;
  }

  // Sort
  if (currentSortField) {
    teamPlayers.sort((a, b) => {
      let valA = a[currentSortField];
      let valB = b[currentSortField];

      if (currentSortField === "AcesWar") {
        valA = (valA === null || valA === "N/A" || valA === "") ? -Infinity : Number(valA);
        valB = (valB === null || valB === "N/A" || valB === "") ? -Infinity : Number(valB);
      } else if (currentSortField === "Sub") {
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

  teamPlayers.forEach(p => {
    const acesWarDisplay = (p.AcesWar === null || p.AcesWar === "N/A" || p.AcesWar === "") ? "N/A" : p.AcesWar;
    const row = `<tr>
      <td><a href="player.html?name=${encodeURIComponent(p.name)}">${p.name}</a></td>
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

  renderTeamSummary();

  document.querySelectorAll("th[data-field]").forEach(th => {
    const span = th.querySelector(".sort-arrow");
    span.textContent = (th.dataset.field === currentSortField) ? (currentSortOrder === 'asc' ? '▲' : '▼') : '';
  });
}

function sortTable(field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortField = field;
    currentSortOrder = 'asc';
  }
  renderTable();
}

function renderTeamSummary() {
  if (teamPlayers.length === 0) {
    document.getElementById("teamSummary").textContent = "No players found for this team.";
    return;
  }

  const totalGames = teamPlayers.reduce((sum, p) => sum + Number(p.games || 0), 0);
  const totalAtBats = teamPlayers.reduce((sum, p) => sum + Number(p.atBats || 0), 0);
  const totalHits = teamPlayers.reduce((sum, p) => sum + Number(p.hits || 0), 0);
  const totalRuns = teamPlayers.reduce((sum, p) => sum + Number(p.runs || 0), 0);
  const totalWalks = teamPlayers.reduce((sum, p) => sum + Number(p.walks || 0), 0);

  const acesValues = teamPlayers.map(p => Number(p.AcesWar)).filter(v => !isNaN(v));
  const avgAcesWar = acesValues.length ? (acesValues.reduce((a,b)=>a+b,0)/acesValues.length).toFixed(2) : "N/A";

  document.getElementById("teamSummary").textContent =
    `Totals → Games: ${totalGames}, At Bats: ${totalAtBats}, Hits: ${totalHits}, Runs: ${totalRuns}, Walks: ${totalWalks}, Avg AcesWar: ${avgAcesWar}`;
}

loadTeamData();

