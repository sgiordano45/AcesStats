// TEAM COLORS - External File Version
(function() {
  // Create CSS styles
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --team-black: #1a1a1a; --team-green: #2d7d32; --team-red: #d32f2f;
      --team-blue: #1976d2; --team-white: #343a40; --team-orange: #f57c00;
      --team-silver: #757575; --team-purple: #7b1fa2; --team-gold: #f57f17;
      --team-carolina: #4b9cd3; --team-army: #654321;
    }
    .team-text-black { color: var(--team-black) !important; font-weight: 600 !important; }
    .team-text-green { color: var(--team-green) !important; font-weight: 600 !important; }
    .team-text-red { color: var(--team-red) !important; font-weight: 600 !important; }
    .team-text-blue { color: var(--team-blue) !important; font-weight: 600 !important; }
    .team-text-white { color: var(--team-white) !important; font-weight: 600 !important; text-shadow: 1px 1px 2px rgba(255,255,255,0.8); }
    .team-text-orange { color: var(--team-orange) !important; font-weight: 600 !important; }
    .team-text-silver { color: var(--team-silver) !important; font-weight: 600 !important; }
    .team-text-purple { color: var(--team-purple) !important; font-weight: 600 !important; }
    .team-text-gold { color: var(--team-gold) !important; font-weight: 600 !important; }
    .team-text-carolina { color: var(--team-carolina) !important; font-weight: 600 !important; }
    .team-text-army { color: var(--team-army) !important; font-weight: 600 !important; }
    .team-badge-black { background: var(--team-black) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-green { background: var(--team-green) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-red { background: var(--team-red) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-blue { background: var(--team-blue) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-white { background: white !important; color: var(--team-white) !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; border: 2px solid var(--team-white); }
    .team-badge-orange { background: var(--team-orange) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-silver { background: var(--team-silver) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-purple { background: var(--team-purple) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-gold { background: var(--team-gold) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-carolina { background: var(--team-carolina) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
    .team-badge-army { background: var(--team-army) !important; color: white !important; padding: 2px 8px; border-radius: 12px; font-size: 0.85em; }
  `;
  
  // Add CSS to page
  document.head.appendChild(style);
  
  function applyTeamColors() {
    const teams = {
      'black': 'team-text-black', 
      'green': 'team-text-green', 
      'red': 'team-text-red',
      'blue': 'team-text-blue', 
      'white': 'team-text-white', 
      'orange': 'team-text-orange',
      'silver': 'team-text-silver', 
      'purple': 'team-text-purple', 
      'gold': 'team-text-gold',
      'carolina': 'team-text-carolina', 
      'army': 'team-text-army'
    };
    
    let styledCount = 0;
    
    // Search all text elements
    document.querySelectorAll('*').forEach(element => {
      const text = element.textContent || '';
      if (!text || text.length > 100 || element.children.length > 0) return;
      
      Object.keys(teams).forEach(team => {
        const teamName = team.charAt(0).toUpperCase() + team.slice(1);
        const patterns = [
          new RegExp('\\b' + teamName + '\\b', 'g'),
          new RegExp('\\bAces ' + teamName + '\\b', 'g'),
          new RegExp('\\b' + teamName + ' Aces\\b', 'g'),
        ];
        
        patterns.forEach(pattern => {
          if (pattern.test(text)) {
            element.classList.add(teams[team]);
            styledCount++;
          }
        });
      });
    });
    
    // Style table cells specifically
    document.querySelectorAll('td, th').forEach(cell => {
      const text = cell.textContent.trim().toLowerCase();
      Object.keys(teams).forEach(team => {
        if (text === team || text === 'aces ' + team || text === team + ' aces') {
          cell.classList.add(teams[team]);
          styledCount++;
        }
      });
    });
    
    if (styledCount > 0) {
      console.log('🎨 Applied team colors to ' + styledCount + ' elements');
    }
  }
  
  // Apply colors when page loads
  document.addEventListener('DOMContentLoaded', applyTeamColors);
  setTimeout(applyTeamColors, 1000);
  setTimeout(applyTeamColors, 3000);
  
  // Make function available globally for testing
  window.applyTeamColors = applyTeamColors;
})();
