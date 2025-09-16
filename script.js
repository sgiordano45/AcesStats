async function loadPlayerStats() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('Failed to load data.json');

    const data = await response.json();

    renderTable(data);

  } catch (err) {
    console.error('Error loading data:', err);
  }
}

function isSubstitute(player) {
  return player.Sub && player.Sub.toString().trim().toLowerCase() === 'yes';
}

function renderTable(data) {
  const tbody = document.querySelector('#statsTable tbody');
  tbody.innerHTML = '';

  data.forEach(player => {
    const acesWar = (!player.AcesWar || player.AcesWar === "N/A") ? "N/A" : Number(player.AcesWar).toFixed(2);
    const BA = player.atBats ? (player.hits / player.atBats).toFixed(3) : "N/A";
    const OBP = player.atBats ? ((player.hits + player.walks) / player.atBats).toFixed(3) : "N/A";

    const row = `<tr>
      <td><a href="player.html?name=${encodeURIComponent(player.name)}">${player.name}</a></td>
      <td><a href="team.html?team=${encodeURIComponent(player.team)}">${player.team}</a></td>
      <td>${player.year}</td>
      <td>${player.season}</td>
      <td>${Number(player.games).toLocaleString()}</td>
      <td>${Number(player.atBats).toLocaleString()}</td>
      <td>${Number(player.hits).toLocaleString()}</td>
      <td>${Number(player.runs).toLocaleString()}</td>
      <td>${Number(player.walks).toLocaleString()}</td>
      <td>${acesWar}</td>
      <td>${BA}</td>
      <td>${OBP}</td>
      <td>${isSubstitute(player) ? "Yes" : "No"}</td>
    </tr>`;

    tbody.innerHTML += row;
  });
}


// Load table on page load
loadPlayerStats();

