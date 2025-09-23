// AcesWAR Calculator Module
// Handles both hitting and pitching WAR calculations

class WARCalculator {
  constructor(battingData, pitchingData, gamesData) {
    this.battingData = battingData || [];
    this.pitchingData = pitchingData || [];
    this.gamesData = gamesData || [];
    this.teamWinPercentages = this.calculateTeamWinPercentages();
  }

  // Calculate team win percentages by year/season
  calculateTeamWinPercentages() {
    const teamRecords = {};
    
    this.gamesData.forEach(game => {
      const key = `${game.year}-${game.season}`;
      
      // Initialize team records if they don't exist
      [game['home team'], game['away team']].forEach(team => {
        const teamKey = `${team}-${key}`;
        if (!teamRecords[teamKey]) {
          teamRecords[teamKey] = { wins: 0, losses: 0, ties: 0 };
        }
      });
      
      // Record the result
      const homeTeamKey = `${game['home team']}-${key}`;
      const awayTeamKey = `${game['away team']}-${key}`;
      
      if (game.winner === game['home team']) {
        teamRecords[homeTeamKey].wins++;
        teamRecords[awayTeamKey].losses++;
      } else if (game.winner === game['away team']) {
        teamRecords[awayTeamKey].wins++;
        teamRecords[homeTeamKey].losses++;
      } else if (game.winner === 'Tie' || !game.winner) {
        teamRecords[homeTeamKey].ties++;
        teamRecords[awayTeamKey].ties++;
      }
    });
    
    // Convert to win percentages
    const winPercentages = {};
    Object.keys(teamRecords).forEach(teamKey => {
      const record = teamRecords[teamKey];
      const totalGames = record.wins + record.losses + record.ties;
      const winPct = totalGames > 0 ? 
        (record.wins + (record.ties * 0.5)) / totalGames : 0.500;
      winPercentages[teamKey] = winPct;
    });
    
    return winPercentages;
  }

  // Get team win percentage for a specific player/season
  getTeamWinPercentage(team, year, season) {
    const key = `${team}-${year}-${season}`;
    return this.teamWinPercentages[key] || 0.500; // Default to .500 if no data
  }

  // Calculate hitting WAR
  calculateHittingWAR(acesBPI, games, team, year, season) {
    if (!acesBPI || acesBPI === "N/A" || games === 0) return 0;
    
    const teamWinPct = this.getTeamWinPercentage(team, year, season);
    const teamQuality = teamWinPct - 0.500;
    
    // Fixed scaling: much smaller multipliers for realistic WAR values
    const hittingWAR = ((acesBPI - 35) * 0.002 * games) + (teamQuality * games * 0.004);
    return Math.round(hittingWAR * 100) / 100; // Round to 2 decimal places
  }

  // Calculate pitching WAR
  calculatePitchingWAR(era, inningsPitched, team, year, season) {
    if (!era || era === "N/A" || !inningsPitched || inningsPitched === 0) return 0;
    
    const leagueERA = 7.0; // Based on your data analysis
    const teamWinPct = this.getTeamWinPercentage(team, year, season);
    const teamQuality = teamWinPct - 0.500;
    
    // ERA component (better ERA = positive WAR) - scaled down
    const eraComponent = ((leagueERA - era) / leagueERA) * inningsPitched * 0.006;
    
    // Availability factor (bonus for significant innings)
    let availabilityFactor = 1.0;
    if (inningsPitched >= 50) availabilityFactor = 1.2;
    else if (inningsPitched >= 20) availabilityFactor = 1.0;
    else availabilityFactor = 0.8;
    
    // Team context (smaller impact for pitching) - scaled down
    const teamComponent = teamQuality * inningsPitched * 0.002;
    
    const pitchingWAR = (eraComponent * availabilityFactor) + teamComponent;
    return Math.round(pitchingWAR * 100) / 100;
  }

  // Calculate total WAR for a player (hitting + pitching)
  calculatePlayerWAR(playerName, year, season) {
    let hittingWAR = 0;
    let pitchingWAR = 0;
    
    // Find hitting stats
    const hittingStats = this.battingData.find(p => 
      p.name === playerName && p.year == year && p.season === season
    );
    
    if (hittingStats) {
      hittingWAR = this.calculateHittingWAR(
        hittingStats.AcesWar, // This is actually AcesBPI
        hittingStats.games,
        hittingStats.team,
        year,
        season
      );
    }
    
    // Find pitching stats
    const pitchingStats = this.pitchingData.find(p => 
      p.name === playerName && p.year == year && p.season === season
    );
    
    if (pitchingStats) {
      pitchingWAR = this.calculatePitchingWAR(
        pitchingStats.ERA,
        parseFloat(pitchingStats.IP) || 0,
        pitchingStats.team,
        year,
        season
      );
    }
    
    return {
      hittingWAR: hittingWAR,
      pitchingWAR: pitchingWAR,
      totalWAR: Math.round((hittingWAR + pitchingWAR) * 100) / 100
    };
  }

  // Add WAR calculations to all batting data
  addWARToBattingData() {
    return this.battingData.map(player => {
      const warStats = this.calculatePlayerWAR(player.name, player.year, player.season);
      return {
        ...player,
        hittingWAR: warStats.hittingWAR,
        pitchingWAR: warStats.pitchingWAR,
        totalWAR: warStats.totalWAR
      };
    });
  }

  // Add WAR calculations to pitching data
  addWARToPitchingData() {
    return this.pitchingData.map(pitcher => {
      const warStats = this.calculatePlayerWAR(pitcher.name, pitcher.year, pitcher.season);
      return {
        ...pitcher,
        hittingWAR: warStats.hittingWAR,
        pitchingWAR: warStats.pitchingWAR,
        totalWAR: warStats.totalWAR
      };
    });
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WARCalculator;
}