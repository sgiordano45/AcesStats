let allData = [];

async function loadPlayerStats() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('Failed to load data.json');

    allData = await response.json();

    // Precompute BA, OBP, formatted AcesWar, and formatted numbers
    allData.forEach(p => {
      p.BA = p.atBats ? (p.hits / p.atBats).toFixed(3) : "N/A";
      p.OBP = p.atBats ? ((p.hits + p.walks) / p.atBats).toFixed(3) : "N/A";
      p.formattedAcesWar = (!p.AcesWar || p.AcesWar === "N/A") ? "N/A" : Number(p.AcesWar).toFixed(2);
      p.formattedGames = Number(p.games).toLocaleString();
      p.formattedAtBats = Number(p.atBats).toLocaleString();
      p.formattedHits = Number(p.hits).toLocaleString();
      p.formattedRuns = Number(p.runs).toLocaleString();
      p.formattedWalks = Number(p.walks).toLocaleString();
    });

    populateFilters(allData);
    renderTable(allData);

  } catch (err) {
    console.error('Error loading data:', err);
  }
}

function isSubstitute(player) {
  return player.Sub && player.Sub.toString().trim().toLowerCase() === 'yes';
}

// Render table using DocumentFragment for faster DOM updates
function renderTable(data) {
  const tbody = document.querySelector('#statsTable tbody');
  tbody.innerHTML = '';

  const fragment = document.createDocumentFragment();

  data.forEach(player => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="player.html?name=${encodeURIComponent(player.name)}">${player.name}</a></td>
      <td><a href="team.html?team=${encodeURIComponent(player.team)}">${player.team}</a></td>
      <td>${player.year}</td>
      <td>${player.season}</td>
      <td>${player.formattedGames}</td>
      <td>${player.formattedAtBats}</td>
      <td>${player.formattedHits}</td>
      <td>${player.formattedRuns}</td>
      <td>${player.formattedWalks}</td>
      <td>${player.formattedAcesWar}</td>
      <td>${player.BA}</td>
      <td>${player.OBP}</td>
      <td>${isSubstitute(player) ? "Yes" : "No"}</td>
    `;
    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);
}

// Filter logic
document.getElementById('yearFilter').addEventListener('change', applyFilters);
document.getElementById('seasonFilter').addEventListener('change', applyFilters);

function populateFilters(data) {
  const yearSet = new Set();
  const seasonSet = new Set();

  data.forEach(p => {
    yearSet.add(p.year);
    seasonSet.add(p.season);
  });

  const yearFilter = document.getElementById('yearFilter');
  const seasonFilter = document.getElementById('seasonFilter');

  [...yearSet].sort((a,b)=>b-a).forEach(y => {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    yearFilter.appendChild(opt);
  });

  [...seasonSet].sort().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    seasonFilter.appendChild(opt);
  });
}

function applyFilters() {
  const selectedYear = document.getElementById('yearFilter').value;
  const selectedSeason = document.getElementById('seasonFilter').value;

  let filtered = allData;
  if(selectedYear !== 'All') filtered = filtered.filter(p => p.year == selectedYear);
  if(selectedSeason !== 'All') filtered = filtered.filter(p => p.season === selectedSeason);

  renderTable(filtered);
}

// Sorting logic (kept same as before)
const table = document.getElementById('statsTable');
const headers = table.querySelectorAll('th');
let sortDirection = {};

headers.forEach(header => {
  header.addEventListener('click', () => {
    const sortKey = header.dataset.sort;
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    const currentDir = sortDirection[sortKey] === 'asc' ? 'desc' : 'asc';
    sortDirection = {};
    sortDirection[sortKey] = currentDir;

    headers.forEach(h => h.classList.remove('sorted-asc','sorted-desc'));
    header.classList.add(currentDir==='asc' ? 'sorted-asc' : 'sorted-desc');

    rows.sort((a,b) => {
      let aText = a.querySelector(`td:nth-child(${header.cellIndex+1})`).textContent;
      let bText = b.querySelector(`td:nth-child(${header.cellIndex+1})`).textContent;

      const numA = parseFloat(aText.replace(/,/g,''));
      const numB = parseFloat(bText.replace(/,/g,''));

      if(!isNaN(numA) && !isNaN(numB)){
        return currentDir==='asc' ? numA-numB : numB-numA;
      } else {
        return currentDir==='asc' ? aText.localeCompare(bText) : bText.localeCompare(aText);
      }
    });

    tbody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    rows.forEach(r => fragment.appendChild(r));
    tbody.appendChild(fragment);
  });
});

// Load data on page load
loadPlayerStats();
