// banner.js - Scrolling Banner for Mountainside Aces
// Usage: Add <div id="news-banner-container"></div> to your HTML and include this script

// Configuration - Edit these to customize the banner
const BANNER_CONFIG = {
  announcements: [
      { type: 'announcement', text: '🏆 2025 Fall Playoffs starts November 16th!', className: 'news-announcement' },
      { type: 'announcement', text: '⭐ Remember to clean up all trash after your games!', className: 'news-announcement' }
  ],
  currentSeason: "Fall",
  currentYear: "2025",
  recentGamesCount: 5,
  upcomingGamesCount: 5,
  updateInterval: 5 * 60 * 1000, // 5 minutes in milliseconds
  sticky: true  // Toggle this value!
};

let bannerRecentScores = [];
let bannerUpcomingSchedule = [];
let bannerAllGames = [];

// Initialize banner when DOM is ready
function initBanner() {
  const container = document.getElementById('news-banner-container');
  
  if (!container) {
    console.error('Banner container not found. Add <div id="news-banner-container"></div> to your HTML.');
    return;
  }
  
  // Inject banner HTML
  container.innerHTML = `
    <div class="news-banner">
      <div class="news-content" id="newsContent">
        <span class="news-item news-announcement">Loading league updates...</span>
      </div>
    </div>
  `;
  
  // Inject banner CSS
  injectBannerCSS();
  
  // Load data
  loadBannerData();
  
  // Set up auto-refresh
  setInterval(loadBannerData, BANNER_CONFIG.updateInterval);
}

// Inject CSS styles for the banner
// Replace your injectBannerCSS function in banner.js with this:

function injectBannerCSS() {
  // Check if styles already injected
  if (document.getElementById('banner-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'banner-styles';
  
  // Build the CSS with proper conditional values
  const stickyPosition = BANNER_CONFIG.sticky ? 'sticky' : 'relative';
  const stickyTop = BANNER_CONFIG.sticky ? '0' : 'auto';
  const stickyZIndex = BANNER_CONFIG.sticky ? '1000' : 'auto';
  
  style.textContent = `
    /* Scrolling Banner Styles */
    .news-banner {
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
      color: white;
      overflow: hidden;
      white-space: nowrap;
      position: ${stickyPosition};
      top: ${stickyTop};
      z-index: ${stickyZIndex};
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      border-bottom: 3px solid #c23616;
      width: 100%;
    }
    
    /* Override team-colors.js for banner elements */
    .news-banner *,
    .news-banner .news-item,
    .news-banner .news-announcement,
    .news-banner .news-score,
    .news-banner .news-upcoming {
      color: inherit !important;
      background: none !important;
      border: none !important;
      padding: 0 !important;
      text-shadow: none !important;
      font-weight: 600 !important;
    }
    
    .news-banner .news-item {
      padding: 0 20px !important;
    }
    
    .news-content {
      display: inline-block;
      padding: 12px 0;
      animation: scroll-left 60s linear infinite;
      font-weight: 600;
      font-size: 1.1rem;
    }
    
    .news-item {
      display: inline-block;
      margin-right: 50px;
      padding: 0 20px;
      position: relative;
    }
    
    .news-item::after {
      content: "•";
      position: absolute;
      right: -25px;
      top: 0;
      color: rgba(255,255,255,0.7);
      font-size: 1.2rem;
    }
    
    .news-item:last-child::after {
      display: none;
    }
    
    .news-announcement {
      color: #ffd700 !important;
      font-weight: bold !important;
    }
    
    .news-score {
      color: #ffffff !important;
    }
    
    .news-upcoming {
      color: #87ceeb !important;
      font-weight: 600 !important;
    }
    
    @keyframes scroll-left {
      0% { transform: translateX(25%); }
      100% { transform: translateX(-100%); }
    }
    
    /* Pause animation on hover */
    .news-banner:hover .news-content {
      animation-play-state: paused;
    }
    
    /* Responsive Design for Banner */
    @media (max-width: 768px) {
      .news-content {
        font-size: 1rem;
      }
      
      .news-item {
        margin-right: 30px;
        padding: 0 15px;
      }
    }
  `;
  
  document.head.appendChild(style);
}

// Load all banner data
async function loadBannerData() {
  try {
    const [gamesResponse, previewsResponse] = await Promise.all([
      fetch('games.json'),
      fetch('previews.json')
    ]);
    
    if (gamesResponse.ok) {
      bannerAllGames = await gamesResponse.json();
    }
    
    let previews = [];
    if (previewsResponse.ok) {
      previews = await previewsResponse.json();
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get completed games (past games with winners)
    const completedGames = bannerAllGames
      .filter(game => {
        const gameDate = new Date(game.date);
        return game.year === BANNER_CONFIG.currentYear && 
               game.season === BANNER_CONFIG.currentSeason && 
               game.winner && 
               game.winner.trim() !== "" &&
               gameDate < today;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, BANNER_CONFIG.recentGamesCount);

    bannerRecentScores = completedGames.map(game => ({
      type: 'score',
      text: formatGameResult(game),
      className: 'news-score'
    }));
    
    // Get upcoming games from previews.json
    const upcomingGames = previews
      .filter(game => {
        const gameDate = new Date(game.date);
        return gameDate >= today;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, BANNER_CONFIG.upcomingGamesCount);

    bannerUpcomingSchedule = upcomingGames.map(game => ({
      type: 'upcoming',
      text: formatUpcomingGame(game),
      className: 'news-upcoming'
    }));
    
  } catch (error) {
    console.log('Could not load banner data:', error);
    // Fallback data
    bannerRecentScores = [
      { type: 'score', text: '🏆 Blue defeats Orange 12-8 in thriller!', className: 'news-score' }
    ];
    bannerUpcomingSchedule = [
      { type: 'upcoming', text: '📅 Gold @ Silver - Oct 15 7:00 PM', className: 'news-upcoming' }
    ];
  }
  
  updateNewsBanner();
}

// Format completed game results (winning score always first)
function formatGameResult(game) {
  const homeTeam = game["home team"];
  const awayTeam = game["away team"];
  const homeScore = game["home score"];
  const awayScore = game["away score"];
  const winner = game.winner;
  
  let scoreText;
  if (homeScore === "W" && awayScore === "L") {
    scoreText = `${homeTeam} defeats ${awayTeam}`;
  } else if (homeScore === "L" && awayScore === "W") {
    scoreText = `${awayTeam} defeats ${homeTeam}`;
  } else if (winner === "Tie") {
    scoreText = `${homeTeam} ties ${awayTeam} ${homeScore}-${awayScore}`;
  } else {
    // Determine winner and format with winning score first
    const winnerTeam = winner;
    const loserTeam = winner === homeTeam ? awayTeam : homeTeam;
    
    // Get winning and losing scores
    let winnerScore, loserScore;
    if (winner === homeTeam) {
      winnerScore = homeScore;
      loserScore = awayScore;
    } else {
      winnerScore = awayScore;
      loserScore = homeScore;
    }
    
    scoreText = `${winnerTeam} defeats ${loserTeam} ${winnerScore}-${loserScore}`;
  }
  
  return `⚾ ${scoreText}`;
}

// Format upcoming game schedule
function formatUpcomingGame(game) {
  const homeTeam = game["home team"];
  const awayTeam = game["away team"];
  const gameDate = game.date;
  const gameTime = game.time || "";
  
  // Format the date nicely
  const dateObj = new Date(gameDate);
  const formattedDate = dateObj.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  });
  
  // Only show time if it exists and isn't empty
  const timeDisplay = gameTime && gameTime.trim() !== "" ? ` ${gameTime}` : "";
  
  return `📅 ${awayTeam} @ ${homeTeam} - ${formattedDate}${timeDisplay}`;
}

// Update the banner display
function updateNewsBanner() {
  const newsContent = document.getElementById('newsContent');
  
  if (!newsContent) return;
  
  const allNews = [...BANNER_CONFIG.announcements, ...bannerRecentScores, ...bannerUpcomingSchedule];
  
  if (allNews.length === 0) {
    newsContent.innerHTML = '<span class="news-item news-announcement">🏆 Welcome to Mountainside Aces Statistics Hub!</span>';
    return;
  }
  
  const newsHTML = allNews.map(item => 
    `<span class="news-item ${item.className}">${item.text}</span>`
  ).join('');
  
  newsContent.innerHTML = newsHTML;
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBanner);
} else {
  initBanner();
}
