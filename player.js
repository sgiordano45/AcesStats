let playerEntries = [];
let currentSortField = 'year';
let currentSortOrder = 'asc';

// Get URL parameter
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// Simplified substitute detection
function isSubstitute(p) {
  return p.sub === "Yes";
}

// Compute career summary
function computeSummary(entries) {
  const totalGames = entries.reduce((sum, p) => sum + (p.games || 0), 0);
  const totalAtBats = entries.reduce((sum, p) => sum + (p.atBats || 0), 0);
  const totalHits = entries.reduce((sum, p) => sum + (p.hits || 0), 0);
  const totalRuns = entries.reduce((sum, p) => sum + (p.runs || 0), 0);
  const totalWalks = entries.reduce((sum, p) => sum + (p.walks || 0), 0);

  const acesWarValues = entries
    .map(p => (p.AcesWar === null || p.AcesWar === "N/A" || p.AcesWar === "") ? null : Number(p.AcesWar))
    .filter(v => v !== null);

  const avgAcesWar = acesWarValues.length > 0
    ? (acesWarValues.reduce((sum, v) => sum + v, 0) / acesWarValues.length).toFixed(2)
    : "N/A";

  const totalSeasons = new Set(entries.map(p => p.year + "-" + p.season)).size;

  return {
    totalGames, totalAtBats, totalHits, totalRuns, totalWalks, avgAcesWar, totalSeasons
  };
}

// Load player data
async function loadPlayerData() {
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const players = await response.json();

    const playerName = getQueryParam("name");
    playerEntries = players.filter(p => p.name === playerName);

    if (playerEntries.length === 0) {
      document.getElementById("playerName").textContent = "Player not found";
      return;
    }

    document.getElementById("playerName").textContent = playerName;

    // Career summary
    const summary = computeSummary(playerEntries);
    const summaryDiv = document.getElementById("playerSummary");
    summaryDiv.innerHTML = `
      Career Summary: ${summary.totalSeasons} seasons |
      Games: ${summary.totalGames} |
      At Bats: ${summary.totalAtBats} |
      Hits: ${summary.totalHits} |
      Runs: ${summary.totalRuns} |
      Walks: ${summary.totalWalks} |
      Avg AcesWar: ${summary.avgAcesWar}
    `;

    // Highlight most recent year
    const mostRecentYear = Math.max(...playerEntries.map(p => p.year));

    renderTable(mostRecentYear);

  } catch (error) {
    console.error("Error loading player data:", error);
  }
}

// Render player table
function renderTable(highlightYear) {
  const tbody = document.querySelector("#playerStatsTable tbody");
  tbody.innerHTML = "";

  // Sort
  if (currentSortField) {
    playerEntries.sort((a, b) => {
      let valA = a[currentSortField];
      let valB = b[currentSortField];

      if (currentSortField === "AcesWar") {
        valA = (valA === null || valA === "N/A" || valA === "") ? -Infinity : Number(valA);
        valB = (valB === null || valB === "N/A" || valB === "") ? -Infinity : Number(valB);
      } else if (currentSortField === "sub") {
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

  playerEntries.forEach(p => {
    const acesWarDisplay = (p.AcesWar === null || p.AcesWar === "N/A" || p.AcesWar === "") ? "N/A" : p.AcesWar;
    const row = `<tr class="${p.year === highlightYear ? 'highlight' : ''}">
      <td>${p.year}</td>
      <td>${p.season}</td>
      <td>${p.team || "N/A"}</td>
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

  // Update sorting arrows
  document.querySelectorAll("th[data-field]").forEach(th => {
    const span = th.querySelector(".sort-arrow");
    span.textContent = (th.dataset.field === currentSortField) ? (currentSortOrder === 'asc' ? '▲' : '▼') : '';
  });
}

// Sort table
function sortTable(field) {
  if (currentSortField === field) {
    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortField = field;
    currentSortOrder = 'asc';
  }

  const mostRecentYear = Math.max(...playerEntries.map(p => p.year));
  renderTable(mostRecentYear);
}

// Initialize
loadPlayerData();
