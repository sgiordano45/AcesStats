let playerName = new URLSearchParams(window.location.search).get('name');
let allAwards = [];

if (!playerName) {
  document.body.innerHTML = '<h1>Error: No player specified</h1><p><a href="index.html">Return to main page</a></p>';
} else {
  document.getElementById("playerName").textContent = playerName;
  loadPlayerData();
}

function getAwardIcon(awardType) {
  // Create filename from award type - convert to lowercase and replace spaces/special chars with underscores
  const filename = awardType
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
  
  return `awards/${filename}.png`;
}

function updatePlayerNameWithAwards() {
  if (allAwards.length === 0) return;
  
  // Get unique award types for this player
  const playerAwards = allAwards.filter(award => 
    award.Player && award.Player.trim() === playerName && award.Award && award.Award.trim() !== ""
  );
  
  if (playerAwards.length === 0) return;
  
  // Get unique award types (don't show duplicates)
  const uniqueAwardTypes = [...new Set(playerAwards.map(award => award.Award))];
  
  // Create award icons display
  const awardIcons = uniqueAwardTypes
    .sort() // Sort alphabetically for consistency
    .map(awardType => {
      const iconSrc = getAwardIcon(awardType);
      const count = playerAwards.filter(a => a.Award === awardType).length;
      const countDisplay = count > 1 ? `<sup style="color: #666; font-size: 0.7em;">${count}</sup>` : '';
      return `<span title="${awardType}${count > 1 ? ` (${count}×)` : ''}" style="margin-right: 8px; cursor: help; display: inline-block;">
        <img src="${iconSrc}" alt="${awardType}" style="height: 24px; width: auto; vertical-align: middle;" onerror="this.style.display='none';">${countDisplay}
      </span>`;
    })
    .join('');
  
  // Update the player name display
  const playerNameElement = document.getElementById("playerName");
  playerNameElement.innerHTML = `
    ${playerName}
    <div style="margin-top: 10px;">
      ${awardIcons}
    </div>
  `;
}

async function loadPlayerData() {
  try {
    // Load both statistics and awards data
    const [statsResponse, awardsResponse] = await Promise.all([
      fetch('data.json'),
      fetch('awards.json')
    ]);
    
    if (!statsResponse.ok) throw new Error('Failed to load data.json');
    // Awards are optional - don't fail if missing
    if (awardsResponse.ok) {
      allAwards = await awardsResponse.json();
    }
    
    const allPlayers = await statsResponse.json();

    // Filter and clean data for this player
    const playerData = allPlayers
      .filter(p => p.name && p.name.trim() === playerName)
      .map(p => ({
        ...p,
        games: Number(p.games) || 0,
        atBats: Number(p.atBats) || 0,
        hits: Number(p.hits) || 0,
        runs: Number(p.runs) || 0,
        walks: Number(p.walks) || 0,
        AcesWar: p.AcesWar === "N/A" || !p.AcesWar ? "N/A" : Number(p.AcesWar),
        Sub: (p.Sub || p.sub || "").toString().trim()
      }));

    if (playerData.length === 0) {
      document.body.innerHTML = `
        <h1>Player "${playerName}" not found</h1>
        <p><a href="index.html">Return to main page</a></p>
      `;
      return;
    }

    // Separate Regular and Sub tables
    const regularSeasons = playerData.filter(p => !isSubstitute(p))
                                     .sort((a, b) => b.year - a.year || (b.season > a.season ? 1 : -1));
    const subSeasons = playerData.filter(p => isSubstitute(p))
                                 .sort((a, b) => b.year - a.year || (b.season > a.season ? 1 : -1));

    // Render tables
    renderTable('regularStatsTable', regularSeasons);
    renderTable('subStatsTable', subSeasons);
    renderCareerStats(playerData, regularSeasons, subSeasons);
    renderPlayerAwards(playerData);
    
    // Add award icons to player name
    updatePlayerNameWithAwards();

  } catch (err) {
    console.error("Error loading player data:", err);
    document.body.innerHTML = `
      <h1>Error loading player data</h1>
      <p>Could not load statistics. Please check that data.json is available.</p>
      <p><a href="index.html">Return to main page</a></p>
    `;
  }
}

function isSubstitute(p) {
  const subValue = p.Sub || "";
  return subValue.toString().trim().toLowerCase() === "yes";
}

function renderTable(tableId, data) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = "";
  
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12">No data available</td></tr>';
    return;
  }

  data.forEach(p => {
    const acesWarDisplay = (p.AcesWar === "N/A" || isNaN(p.AcesWar)) ? "N/A" : Number(p.AcesWar).toFixed(2);
    const BA = p.atBats > 0 ? (p.hits / p.atBats).toFixed(3) : ".000";
    const OBP = (p.atBats + p.walks) > 0 
      ? ((p.hits + p.walks) / (p.atBats + p.walks)).toFixed(3) 
      : ".000";

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
      <td>${BA}</td>
      <td>${OBP}</td>
      <td>${isSubstitute(p) ? "Yes" : "No"}</td>
    </tr>`;
    tbody.innerHTML += row;
  });
}

function renderCareerStats(all, regular, subs) {
  const tbody = document.querySelector('#careerStatsTable tbody');
  tbody.innerHTML = "";

  const calcStats = (arr) => {
    if (arr.length === 0) {
      return {
        totalGames: 0,
        totalAtBats: 0,
        totalHits: 0,
        totalRuns: 0,
        totalWalks: 0,
        avgAcesWar: "N/A",
        BA: ".000",
        OBP: ".000"
      };
    }

    const totalGames = arr.reduce((sum, p) => sum + p.games, 0);
    const totalAtBats = arr.reduce((sum, p) => sum + p.atBats, 0);
    const totalHits = arr.reduce((sum, p) => sum + p.hits, 0);
    const totalRuns = arr.reduce((sum, p) => sum + p.runs, 0);
    const totalWalks = arr.reduce((sum, p) => sum + p.walks, 0);

    // Calculate average AcesWar (only from non-N/A values)
    const acesValues = arr
      .map(p => p.AcesWar)
      .filter(v => v !== "N/A" && !isNaN(v))
      .map(v => Number(v));
    const avgAcesWar = acesValues.length > 0 
      ? (acesValues.reduce((a, b) => a + b, 0) / acesValues.length).toFixed(2) 
      : "N/A";

    const BA = totalAtBats > 0 ? (totalHits / totalAtBats).toFixed(3) : ".000";
    const OBP = (totalAtBats + totalWalks) > 0 
      ? ((totalHits + totalWalks) / (totalAtBats + totalWalks)).toFixed(3) 
      : ".000";

    return { totalGames, totalAtBats, totalHits, totalRuns, totalWalks, avgAcesWar, BA, OBP };
  };

  const rowsData = [
    { label: "Total", stats: calcStats(all) },
    { label: "Regular Only", stats: calcStats(regular) },
    { label: "Substitute Only", stats: calcStats(subs) }
  ];

  rowsData.forEach(r => {
    const row = `<tr>
      <td><strong>${r.label}</strong></td>
      <td>${r.stats.totalGames}</td>
      <td>${r.stats.totalAtBats}</td>
      <td>${r.stats.totalHits}</td>
      <td>${r.stats.totalRuns}</td>
      <td>${r.stats.totalWalks}</td>
      <td>${r.stats.avgAcesWar}</td>
      <td>${r.stats.BA}</td>
      <td>${r.stats.OBP}</td>
    </tr>`;
    tbody.innerHTML += row;
  });
}

function renderPlayerAwards(playerData) {
  // Filter awards for this specific player
  const playerAwards = allAwards.filter(award => 
    award.Player && award.Player.trim() === playerName && award.Award && award.Award.trim() !== ""
  );
  
  if (playerAwards.length === 0) {
    return; // Don't show awards section if no awards
  }
  
  // Sort awards by year (most recent first), then by award name
  playerAwards.sort((a, b) => {
    if (b.Year !== a.Year) return b.Year - a.Year;
    if (b.Season !== a.Season) return b.Season.localeCompare(a.Season);
    return a.Award.localeCompare(b.Award);
  });
  
  // Create awards section HTML
  let awardsHTML = `
    <h2>Career Awards & Honors</h2>
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
      <thead>
        <tr style="background-color: #f2f2f2;">
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Year</th>
          <th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Award</th>
          <th style="border: 1px solid #ccc; padding: 8px; text-align: center;">Team</th>
          <th style="border: 1px solid #ccc; padding: 8px; text-align: center;">Position</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  playerAwards.forEach(award => {
    const teamLink = award.Team ? 
      `<a href="team.html?team=${encodeURIComponent(award.Team)}">${award.Team}</a>` : 
      '';
    
    awardsHTML += `
      <tr>
        <td style="border: 1px solid #ccc; padding: 8px;">${award.Year} ${award.Season}</td>
        <td style="border: 1px solid #ccc; padding: 8px;"><strong>${award.Award}</strong></td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${teamLink}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${award.Position || ''}</td>
      </tr>
    `;
  });
  
  awardsHTML += `
      </tbody>
    </table>
  `;
  
  // Insert awards section after the career stats table
  const careerStatsTable = document.getElementById('careerStatsTable');
  if (careerStatsTable && careerStatsTable.parentNode) {
    const awardsDiv = document.createElement('div');
    awardsDiv.innerHTML = awardsHTML;
    careerStatsTable.parentNode.insertBefore(awardsDiv, careerStatsTable.nextSibling);
  }
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.href = 'index.html';
  }
}
