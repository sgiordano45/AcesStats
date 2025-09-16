let playerName = new URLSearchParams(window.location.search).get('name');
document.getElementById("playerName").textContent = playerName;

async function loadPlayerData() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('Failed to load data.json');
    const allPlayers = await response.json();
    
    let playerData = allPlayers.filter(p => p.name === playerName);

    // Split into regular and sub, sorted by year descending
    const regularSeasons = playerData.filter(p => !isSubstitute(p))
                                     .sort((a,b) => b.year - a.year);
    const subSeasons = playerData.filter(p => isSubstitute(p))
                                 .sort((a,b) => b.year - a.year);

    renderTable('regularStatsTable', regularSeasons);
    renderTable('subStatsTable', subSeasons);
    renderCareerStats(playerData, regularSeasons, subSeasons);

  } catch (error) {
    console.error('Error loading player data:', error);
  }
}

function isSubstitute(p) {
  return p.Sub && p.Sub.toString().trim().toLowerCase() === "yes";
}

function renderTable(tableId, data) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = "";
  data.forEach(p => {
    const acesWarDisplay = (!p.AcesWar || p.AcesWar === "N/A") ? "N/A" : p.AcesWar;
    const row = `<tr>
      <td>${p.year}</td>
      <td>${p.season}</td>
      <td>${p.team}</td>
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
}

function renderCareerStats(all, regular, subs) {
  const tbody = document.querySelector('#careerStatsTable tbody');
  tbody.innerHTML = "";

  const calcTotals = (arr) => {
    const totalGames = arr.reduce((sum,p) => sum + Number(p.games || 0), 0);
    const totalAtBats = arr.reduce((sum,p) => sum + Number(p.atBats || 0), 0);
    const totalHits = arr.reduce((sum,p) => sum + Number(p.hits || 0), 0);
    const totalRuns = arr.reduce((sum,p) => sum + Number(p.runs || 0), 0);
    const totalWalks = arr.reduce((sum,p) => sum + Number(p.walks || 0), 0);
    const acesValues = arr.map(p => Number(p.AcesWar)).filter(v => !isNaN(v));
    const totalAcesWar = acesValues.length ? acesValues.reduce((a,b)=>a+b,0).toFixed(2) : "N/A";
    return { totalGames, totalAtBats, totalHits, totalRuns, totalWalks, totalAcesWar };
  }

  const totalsAll = calcTotals(all);
  const totalsRegular = calcTotals(regular);
  const totalsSub = calcTotals(subs);

  const rows = [
    {label:"Total", stats:totalsAll},
    {label:"Regular Only", stats:totalsRegular},
    {label:"Substitute Only", stats:totalsSub}
  ];

  rows.forEach(r => {
    const row = `<tr>
      <td>${r.label}</td>
      <td>${r.stats.totalGames}</td>
      <td>${r.stats.totalAtBats}</td>
      <td>${r.stats.totalHits}</td>
      <td>${r.stats.totalRuns}</td>
      <td>${r.stats.totalWalks}</td>
      <td>${r.stats.totalAcesWar}</td>
    </tr>`;
    tbody.innerHTML += row;
  });
}

function goBack() {
  window.history.back();
}

loadPlayerData();
