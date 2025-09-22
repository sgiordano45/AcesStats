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

    // Calculate average AcesBPI (only from non-N/A values)
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
  
  // Calculate player's career stats for Top 10 checking
  const playerCareerStats = calculatePlayerCareerStats(playerName);
  
  // Calculate Top 10 rankings
  const top10Rankings = calculateTop10Rankings(playerCareerStats);
  
  if (playerAwards.length === 0 && top10Rankings.length === 0) {
    return; // Don't show awards section if no awards or top 10 stats
  }
  
  // Create the enhanced awards section with both Top 10 rankings AND preserved award icons
  let awardsHTML = `
    <div style="margin-top: 30px;">
      <h2>Awards & Recognition</h2>
  `;
  
  // Add Top 10 All-Time Rankings section if player has any
  if (top10Rankings.length > 0) {
    awardsHTML += `
      <div style="margin-bottom: 25px;">
        <h3 style="color: #0066cc; margin-bottom: 15px; border-bottom: 2px solid #0066cc; padding-bottom: 5px;">
          🏆 All-Time Top 10 Rankings
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-bottom: 20px;">
    `;
    
    top10Rankings.forEach(ranking => {
      const rankColor = ranking.rank <= 3 ? '#d4af37' : ranking.rank <= 5 ? '#c0c0c0' : ranking.rank <= 10 ? '#cd7f32' : '#666';
      const medalEmoji = ranking.rank === 1 ? '🥇' : ranking.rank === 2 ? '🥈' : ranking.rank === 3 ? '🥉' : '🏅';
      
      awardsHTML += `
        <div style="background-color: #f8f9fa; border: 2px solid ${rankColor}; border-radius: 8px; padding: 15px; text-align: center; position: relative;">
          <div style="font-size: 24px; margin-bottom: 8px;">${medalEmoji}</div>
          <div style="font-weight: bold; color: ${rankColor}; font-size: 18px;">#${ranking.rank}</div>
          <div style="font-size: 14px; color: #333; margin: 5px 0;">${ranking.category}</div>
          <div style="font-weight: bold; font-size: 16px; color: #0066cc;">${ranking.value}</div>
        </div>
      `;
    });
    
    awardsHTML += `
        </div>
      </div>
    `;
  }
  
  // Add Career Awards section with original icon-based display if player has any
  if (playerAwards.length > 0) {
    awardsHTML += `
      <div>
        <h3 style="color: #cc6600; margin-bottom: 15px; border-bottom: 2px solid #cc6600; padding-bottom: 5px;">
          🏅 Career Awards & Honors
        </h3>
    `;
    
    // Use the original populatePlayerAwards logic to preserve icons
    // Group awards by type and count them (from original code)
    const awardGroups = {};
    playerAwards.forEach(award => {
      const awardType = award.Award.trim();
      if (!awardGroups[awardType]) {
        awardGroups[awardType] = {
          name: awardType,
          count: 0,
          seasons: []
        };
      }
      awardGroups[awardType].count++;
      awardGroups[awardType].seasons.push(`${award.Year} ${award.Season}`);
    });
    
    // Define award icons mapping to PNG files (from original code)
    const awardIcons = {
      'Team MVP': 'team_mvp.png',
      'All Aces': 'all_aces.png',
      'Gold Glove': 'gold_glove.png',
      'Team of the Year': 'team_of_the_year.png',
      'Rookie of the Year': 'rookie_of_the_year.png',
      'Most Improved Ace': 'most_improved_ace.png',
      'Comeback Player of the Year': 'comeback_player.png',
      'Slugger of the Year': 'slugger_of_the_year.png',
      'Pitcher of the Year': 'pitcher_of_the_year.png',
      'Captain of the Year': 'captain_of_the_year.png',
      'Al Pineda Good Guy Award': 'al_pineda_good_guy_award.png',
      'Iron Man Award': 'iron_man_award.png',
      'Sub of the Year': 'sub_of_the_year.png',
      'Andrew Streaman Boner Award': 'andrew_streaman_boner_award.png',
      'Erik Lund Perservenance Award': 'erik_lund_perservenance_award.png',
      'Mr. Streaman Award for Excellence': 'mr_streaman_award_for_excellence.png'
    };
    
    // Fallback emoji for awards without PNG files (from original code)
    const fallbackEmojis = {
      'Team MVP': '👑',
      'All Aces': '⭐',
      'Gold Glove': '🥇',
      'Team of the Year': '🏆',
      'Rookie of the Year': '🌟',
      'Most Improved Ace': '📈',
      'Comeback Player of the Year': '🔄',
      'Slugger of the Year': '💪',
      'Pitcher of the Year': '🥎',
      'Captain of the Year': '🎖️',
      'Al Pineda Good Guy Award': '🤝',
      'Iron Man Award': '💯',
      'Sub of the Year': '🏅',
      'Andrew Streaman Boner Award': '🎪',
      'Erik Lund Perservenance Award': '⚡',
      'Mr. Streaman Award for Excellence': '🌟'
    };
    
    // Sort awards by importance/rarity (from original code)
    const awardOrder = [
      'Team MVP', 'All Aces', 'Gold Glove', 'Team of the Year',
      'Rookie of the Year', 'Most Improved Ace', 'Comeback Player of the Year',
      'Slugger of the Year', 'Pitcher of the Year', 'Captain of the Year',
      'Al Pineda Good Guy Award', 'Iron Man Award', 'Sub of the Year',
      'Andrew Streaman Boner Award', 'Erik Lund Perservenance Award',
      'Mr. Streaman Award for Excellence'
    ];
    
    // Sort award groups by order, then alphabetically (from original code)
    const sortedAwards = Object.values(awardGroups).sort((a, b) => {
      const aIndex = awardOrder.indexOf(a.name);
      const bIndex = awardOrder.indexOf(b.name);
      
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
    
    // Generate award items with original icon display (from original code)
    awardsHTML += '<div class="awards-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-bottom: 20px;">';
    
    sortedAwards.forEach(award => {
      const iconFileName = awardIcons[award.name];
      const fallbackEmoji = fallbackEmojis[award.name] || '🏅';
      const seasonsText = award.seasons.length <= 3 ? 
        award.seasons.join(', ') : 
        `${award.seasons.slice(0, 2).join(', ')}, +${award.seasons.length - 2} more`;
      
      awardsHTML += `
        <div class="award-item" style="background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 15px; text-align: center;">
          <div class="award-icon-container" style="margin-bottom: 10px;">
            ${iconFileName ? 
              `<img src="awards/${iconFileName}" alt="${award.name}" class="award-icon" style="width: 48px; height: 48px; display: block; margin: 0 auto;" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';">
               <span class="award-icon fallback" style="display: none; font-size: 48px;">${fallbackEmoji}</span>` :
              `<span class="award-icon fallback" style="font-size: 48px;">${fallbackEmoji}</span>`
            }
          </div>
          <div class="award-details">
            <div class="award-name" style="font-weight: bold; margin-bottom: 5px;">${award.name}</div>
            <div class="award-season" style="font-size: 0.9em; color: #666;">${seasonsText}</div>
          </div>
          ${award.count > 1 ? `<span class="award-count" style="position: absolute; top: 5px; right: 8px; background: #0066cc; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold;">${award.count}×</span>` : ''}
        </div>
      `;
    });
    
    awardsHTML += '</div>';
    awardsHTML += `</div>`;
  }
  
  awardsHTML += `</div>`;
  
  // Insert awards section after the career stats table
  const careerStatsTable = document.getElementById('careerStatsTable');
  if (careerStatsTable && careerStatsTable.parentNode) {
    const awardsDiv = document.createElement('div');
    awardsDiv.innerHTML = awardsHTML;
    careerStatsTable.parentNode.insertBefore(awardsDiv, careerStatsTable.nextSibling);
  }
}

function calculatePlayerCareerStats(playerName) {
  // Get all stats for this player
  const playerStats = allData.filter(p => p.name && p.name.trim() === playerName);
  
  if (playerStats.length === 0) return null;
  
  // Aggregate career totals
  let careerStats = {
    totalGames: 0,
    totalAtBats: 0,
    totalHits: 0,
    totalRuns: 0,
    totalWalks: 0,
    acesWarValues: []
  };
  
  playerStats.forEach(p => {
    careerStats.totalGames += Number(p.games) || 0;
    careerStats.totalAtBats += Number(p.atBats) || 0;
    careerStats.totalHits += Number(p.hits) || 0;
    careerStats.totalRuns += Number(p.runs) || 0;
    careerStats.totalWalks += Number(p.walks) || 0;
    
    if (p.AcesWar && p.AcesWar !== "N/A" && !isNaN(p.AcesWar)) {
      careerStats.acesWarValues.push(Number(p.AcesWar));
    }
  });
  
  // Calculate derived stats
  careerStats.battingAverage = careerStats.totalAtBats > 0 ? careerStats.totalHits / careerStats.totalAtBats : 0;
  careerStats.onBasePercentage = (careerStats.totalAtBats + careerStats.totalWalks) > 0 ? 
    (careerStats.totalHits + careerStats.totalWalks) / (careerStats.totalAtBats + careerStats.totalWalks) : 0;
  careerStats.avgAcesWar = careerStats.acesWarValues.length > 0 ? 
    careerStats.acesWarValues.reduce((a, b) => a + b, 0) / careerStats.acesWarValues.length : 0;
  careerStats.plateAppearances = careerStats.totalAtBats + careerStats.totalWalks;
  
  return careerStats;
}

function calculateTop10Rankings(playerCareerStats) {
  if (!playerCareerStats) return [];
  
  // Calculate all players' career stats for comparison
  const allPlayerStats = {};
  
  allData.forEach(p => {
    if (!p.name || !p.name.trim()) return;
    
    const name = p.name.trim();
    if (!allPlayerStats[name]) {
      allPlayerStats[name] = {
        name: name,
        totalGames: 0,
        totalAtBats: 0,
        totalHits: 0,
        totalRuns: 0,
        totalWalks: 0,
        plateAppearances: 0,
        acesWarValues: []
      };
    }
    
    allPlayerStats[name].totalGames += Number(p.games) || 0;
    allPlayerStats[name].totalAtBats += Number(p.atBats) || 0;
    allPlayerStats[name].totalHits += Number(p.hits) || 0;
    allPlayerStats[name].totalRuns += Number(p.runs) || 0;
    allPlayerStats[name].totalWalks += Number(p.walks) || 0;
    allPlayerStats[name].plateAppearances += (Number(p.atBats) || 0) + (Number(p.walks) || 0);
    
    if (p.AcesWar && p.AcesWar !== "N/A" && !isNaN(p.AcesWar)) {
      allPlayerStats[name].acesWarValues.push(Number(p.AcesWar));
    }
  });
  
  // Calculate derived stats for all players
  const allPlayersArray = Object.values(allPlayerStats).map(p => ({
    ...p,
    battingAverage: p.totalAtBats > 0 ? p.totalHits / p.totalAtBats : 0,
    onBasePercentage: p.plateAppearances > 0 ? (p.totalHits + p.totalWalks) / p.plateAppearances : 0,
    avgAcesWar: p.acesWarValues.length > 0 ? p.acesWarValues.reduce((a, b) => a + b, 0) / p.acesWarValues.length : 0
  }));
  
  const rankings = [];
  
  // Define categories to check for Top 10
  const categories = [
    {
      name: "Career Games",
      stat: "totalGames",
      format: (val) => val.toString(),
      minimum: 0
    },
    {
      name: "Career At-Bats", 
      stat: "totalAtBats",
      format: (val) => val.toString(),
      minimum: 0
    },
    {
      name: "Career Hits",
      stat: "totalHits",
      format: (val) => val.toString(),
      minimum: 0
    },
    {
      name: "Career Runs",
      stat: "totalRuns", 
      format: (val) => val.toString(),
      minimum: 0
    },
    {
      name: "Career Walks",
      stat: "totalWalks",
      format: (val) => val.toString(),
      minimum: 0
    },
    {
      name: "Career Batting Average",
      stat: "battingAverage",
      format: (val) => val.toFixed(3),
      minimum: 40,
      minimumField: "plateAppearances"
    },
    {
      name: "Career On-Base Percentage", 
      stat: "onBasePercentage",
      format: (val) => val.toFixed(3),
      minimum: 40,
      minimumField: "plateAppearances"
    },
    {
      name: "Career Average AcesBPI",
      stat: "avgAcesWar",
      format: (val) => val.toFixed(2),
      minimum: 0,
      filter: (p) => p.acesWarValues.length > 0
    }
  ];
  
  categories.forEach(category => {
    // Filter qualifying players
    let qualifyingPlayers = allPlayersArray.filter(p => {
      if (category.filter && !category.filter(p)) return false;
      if (category.minimumField) {
        return p[category.minimumField] >= category.minimum;
      }
      return p[category.stat] >= category.minimum;
    });
    
    // Sort by stat (descending for most stats, ascending for ERA if we had it)
    qualifyingPlayers.sort((a, b) => b[category.stat] - a[category.stat]);
    
    // Find player's rank
    const playerRank = qualifyingPlayers.findIndex(p => p.name === playerName) + 1;
    
    // Only include if in top 10
    if (playerRank > 0 && playerRank <= 10) {
      rankings.push({
        category: category.name,
        rank: playerRank,
        value: category.format(playerCareerStats[category.stat]),
        rawValue: playerCareerStats[category.stat]
      });
    }
  });
  
  // Sort rankings by rank (best ranks first)
  rankings.sort((a, b) => a.rank - b.rank);
  
  return rankings;
}


function goBack() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.href = 'index.html';
  }
}


