async function loadTeamData() {
  try {
    const response = await fetch("data.json");
    const players = await response.json();

    const teamName = new URLSearchParams(window.location.search).get("team");
    document.getElementById("teamName").textContent = teamName;

    const teamPlayers = players.filter(p => p.team === teamName);

    const tbody = document.querySelector("#teamStatsTable tbody");
    teamPlayers.forEach(p => {
      const row = `<tr>
        <td><a href="player.html?name=${encodeURIComponent(p.name)}">${p.name}</a></td>
        <td>${p.year}</td>
        <td>${p.season}</td>
        <td>${p.games}</td>
        <td>${p.atBats}</td>
        <td>${p.hits}</td>
        <td>${p.runs}</td>
        <td>${p.walks}</td>
        <td>${p.AcesWar || "N/A"}</td>
        <td>${p.sub}</td>
      </tr>`;
      tbody.innerHTML += row;
    });

  } catch (error) {
    console.error("Error loading team data:", error);
  }
}

loadTeamData();
