// nav-component.js - Reusable Navigation Component
import { NAV_STRUCTURE, ALL_PAGES, PAGE_CONFIGS, DEFAULT_CONFIG, loadPageVisibility, getFilteredNavStructure, isPageVisible } from './nav-config.js';

export class NavigationComponent {
  constructor(options = {}) {
    this.currentPage = options.currentPage || this.detectCurrentPage();
    this.config = PAGE_CONFIGS[this.currentPage] || DEFAULT_CONFIG;
    this.isAuthenticated = options.isAuthenticated || this.checkAuth();
    this.userDisplayName = options.userDisplayName || this.getUserDisplayName();
    this.navStructure = options.navStructure || NAV_STRUCTURE; // Use filtered structure if provided
  }

  // Auto-detect current page from URL
  detectCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'index.html';
    return filename;
  }
  
  // Get user display name from Firebase
  getUserDisplayName() {
    if (typeof window.auth !== 'undefined' && window.auth.currentUser) {
      const user = window.auth.currentUser;
      // Check for preferred display name in profile (this would need to be loaded separately)
      return user.displayName || user.email?.split('@')[0] || 'User';
    }
    return 'User';
  }
  
  async getProfilePageUrl() {
  try {
    // Import the helper function
    const { getProfilePageForUser, getUserProfile } = await import('./firebase-auth.js');
    
    // Get current user
    if (typeof window.auth !== 'undefined' && window.auth.currentUser) {
      const userId = window.auth.currentUser.uid;
      
      // Get user profile
      const result = await getUserProfile(userId);
      if (result.success && result.data) {
        const profileUrl = getProfilePageForUser(result.data);
        console.log('🔄 Profile URL for user role:', result.data.userRole, '→', profileUrl);
        return profileUrl;
      }
    }
  } catch (error) {
    console.warn('⚠️ Could not determine profile URL, using default:', error);
  }
  
  // Fallback to default
  return 'profile.html';
}
  
  // Check if user is authenticated (integrate with your auth system)
  checkAuth() {
    // Check Firebase Auth
    if (typeof window.auth !== 'undefined' && window.auth.currentUser) {
      console.log('✅ User authenticated via Firebase:', window.auth.currentUser.email);
      return true;
    }
    
    // Fallback: check localStorage for Firebase persistence
    const localStorageKeys = Object.keys(localStorage);
    const hasFirebaseAuth = localStorageKeys.some(key => 
      key.startsWith('firebase:authUser:') && localStorage.getItem(key) !== null
    );
    
    if (hasFirebaseAuth) {
      console.log('✅ Firebase auth token found in localStorage');
      return true;
    }
    
    // Additional fallback: check for userId
    const hasUserId = localStorage.getItem('userId') !== null || 
                      sessionStorage.getItem('userId') !== null;
    
    if (hasUserId) {
      console.log('✅ UserId found in storage');
    } else {
      console.log('ℹ️ No authentication found');
    }
    
    return hasUserId;
  }

  // Check if PWA is installed (standalone mode)
  isPWAInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || 
           window.navigator.standalone === true;
  }

  // Get all links for mobile (everything user has access to)
  getMobileLinks() {
    const allLinks = [];
    
    // Add public pages
    ['primary', 'secondary', 'tertiary'].forEach(tier => {
      this.navStructure[tier].forEach(page => {
        if (!page.hideFromNav) {
          allLinks.push({
            ...page,
            active: page.href === this.currentPage
          });
        }
      });
    });
    
    // Add auth pages if user is authenticated
    if (this.isAuthenticated) {
      this.navStructure.auth.forEach(page => {
        if (!page.hideFromNav) {
          allLinks.push({
            ...page,
            active: page.href === this.currentPage
          });
        }
      });
    }
    
    return allLinks;
  }

  // Get filtered links for desktop based on page config
  getDesktopLinks() {
    const desktopIds = this.config.desktop || DEFAULT_CONFIG.desktop;
    
    return desktopIds
      .map(id => ALL_PAGES[id])
      .filter(page => {
        if (!page) return false;
        // Filter by Firebase visibility config
        if (!isPageVisible(page.id)) return false;
        // Filter out pages that require auth if user is not authenticated
        if (page.requiresAuth && !this.isAuthenticated) return false;
        // Filter out pages marked as hideFromNav
        if (page.hideFromNav) return false;
        return true;
      })
      .map(page => ({
        ...page,
        active: page.href === this.currentPage
      }));
  }

  // Helper to generate link attributes (handles external links)
  getLinkAttributes(link) {
    if (link.external) {
      return `href="${link.href}" target="_blank" rel="noopener noreferrer"`;
    }
    return `href="${link.href}"`;
  }

  // Render desktop navigation
  renderDesktop() {
    const links = this.getDesktopLinks();
    
    return `
      <nav class="nav-container">
        ${links.map(link => `
          <a ${this.getLinkAttributes(link)} class="nav-link ${link.active ? 'active' : ''} ${link.class || ''}">
            ${link.icon} ${link.label}
          </a>
        `).join('')}
      </nav>
    `;
  }

  // Render mobile navigation with auth section
  renderMobile() {
    const links = this.getMobileLinks();
    const isPWAInstalled = this.isPWAInstalled();
    
    // Split links into public and auth pages
    const publicLinks = links.filter(link => !link.requiresAuth);
    const authLinks = links.filter(link => link.requiresAuth);
    
    // Install App link - only show if not already installed
    const installAppLink = !isPWAInstalled ? `
      <div class="mobile-nav-section-divider">App</div>
      <a href="#" class="mobile-nav-item install-app-link" id="mobileInstallAppBtn">
        📲 Install App
      </a>
    ` : '';
    
    return `
      <div class="mobile-nav-container">
        <div class="mobile-nav-header">
          <div class="mobile-nav-title">⚾ Mountainside Aces</div>
          <button class="hamburger-menu" id="mobileMenuBtn" aria-label="Toggle navigation">☰</button>
        </div>
        <nav class="mobile-nav-menu" id="mobileNavMenu">
          ${publicLinks.map(link => `
            <a ${this.getLinkAttributes(link)} class="mobile-nav-item ${link.active ? 'active' : ''}">
              ${link.icon} ${link.label}
            </a>
          `).join('')}
          ${installAppLink}
          ${this.isAuthenticated && authLinks.length > 0 ? `
            <div class="mobile-nav-section-divider">Account</div>
            ${authLinks.map(link => `
              <a ${this.getLinkAttributes(link)} class="mobile-nav-item ${link.active ? 'active' : ''}">
                ${link.icon} ${link.label}
              </a>
            `).join('')}
            <button class="mobile-nav-item mobile-signout-btn" id="mobileSignOutBtn">
              🚪 Sign Out
            </button>
          ` : `
            <div class="mobile-nav-section-divider">Account</div>
            <a href="signin.html" class="mobile-nav-item">🔓 Sign In</a>
            <a href="signup.html" class="mobile-nav-item">📝 Sign Up</a>
          `}
        </nav>
      </div>
    `;
  }

  // Render complete navigation (both mobile and desktop)
  render() {
    return {
      mobile: this.renderMobile(),
      desktop: this.renderDesktop()
    };
  }

  // Handle sign out
  async handleSignOut() {
    console.log('🚪 Mobile sign out clicked');
    try {
      // Check if Firebase auth is available
      if (typeof window.auth !== 'undefined' && window.auth.signOut) {
        await window.auth.signOut();
        console.log('✅ User signed out successfully');
        window.location.reload();
      } else {
        console.error('❌ Firebase auth not available');
        alert('Sign out failed. Please try again.');
      }
    } catch (error) {
      console.error('❌ Sign out error:', error);
      alert('Error signing out. Please try again.');
    }
  }

  // Initialize navigation on page load
  static async init(options = {}) {
    // Load visibility config from Firebase FIRST
    await loadPageVisibility();
    
    // Get filtered navigation structure based on Firebase visibility
    const filteredNavStructure = getFilteredNavStructure();
    
    // Create nav component with filtered structure
    const nav = new NavigationComponent({
      ...options,
      navStructure: filteredNavStructure
    });
    
    const { mobile, desktop } = nav.render();
    
    // Insert mobile nav BEFORE page-container (not inside it)
    const pageContainer = document.querySelector('.page-container');
    if (pageContainer) {
      // Insert before the page-container, not inside it
      pageContainer.insertAdjacentHTML('beforebegin', mobile);
    } else {
      // Fallback: insert at start of body if page-container not found
      document.body.insertAdjacentHTML('afterbegin', mobile);
    }
    
    // Insert desktop nav into filters-nav
    const filtersNav = document.querySelector('.filters-nav');
    if (filtersNav) {
      // Replace existing nav-container or prepend if not found
      const existingNav = filtersNav.querySelector('.nav-container');
      if (existingNav) {
        existingNav.outerHTML = desktop;
      } else {
        filtersNav.insertAdjacentHTML('afterbegin', desktop);
      }
    }
    
    // Add body class if PWA is installed (for CSS hiding)
    if (nav.isPWAInstalled()) {
      document.body.classList.add('pwa-installed');
    }
    
    // IMPORTANT: Set up event listeners AFTER the HTML is inserted
    // Use requestAnimationFrame to ensure DOM is fully painted
    requestAnimationFrame(() => {
      const mobileMenuBtn = document.getElementById('mobileMenuBtn');
      const mobileNavMenu = document.getElementById('mobileNavMenu');
      const mobileSignOutBtn = document.getElementById('mobileSignOutBtn');
      const mobileInstallAppBtn = document.getElementById('mobileInstallAppBtn');
      
      console.log('Setting up mobile menu...', { mobileMenuBtn, mobileNavMenu, mobileSignOutBtn });
      
      // Mobile menu toggle
      if (mobileMenuBtn && mobileNavMenu) {
        // Directly attach listener without cloning
        mobileMenuBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('Mobile menu button clicked!');
          const menu = document.getElementById('mobileNavMenu');
          if (menu) {
            menu.classList.toggle('open');
            console.log('Menu open state:', menu.classList.contains('open'));
          }
        }, { passive: false });
        console.log('✅ Mobile menu event listener attached');
      } else {
        console.error('❌ Mobile nav elements not found!', { 
          menuBtn: !!mobileMenuBtn, 
          navMenu: !!mobileNavMenu 
        });
      }
      
      // Mobile sign out button
      if (mobileSignOutBtn) {
        mobileSignOutBtn.addEventListener('click', async function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('🚪 Mobile sign out clicked');
          try {
            if (typeof window.auth !== 'undefined' && window.auth.signOut) {
              await window.auth.signOut();
              console.log('✅ User signed out successfully');
              window.location.reload();
            } else {
              console.error('❌ Firebase auth not available');
              alert('Sign out failed. Please try again.');
            }
          } catch (error) {
            console.error('❌ Sign out error:', error);
            alert('Error signing out. Please try again.');
          }
        });
        console.log('✅ Mobile sign-out button listener attached');
      }
      
      // Mobile Install App button
      if (mobileInstallAppBtn) {
        mobileInstallAppBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('📲 Install App clicked from nav menu');
          
          // Close the mobile menu first
          const menu = document.getElementById('mobileNavMenu');
          if (menu) {
            menu.classList.remove('open');
          }
          
          // Trigger PWA install (function defined in mobile-enhancements.js)
          if (typeof window.triggerPWAInstall === 'function') {
            window.triggerPWAInstall();
          } else {
            // Fallback if mobile-enhancements.js hasn't loaded yet
            console.warn('⚠️ triggerPWAInstall not available, showing manual instructions');
            alert('To install the app:\n\n1. Open browser menu (⋮ or ⋯)\n2. Tap "Add to Home Screen"\n3. Follow the prompts');
          }
        });
        console.log('✅ Mobile install app button listener attached');
      }
      
      // Close menu when clicking outside
      document.addEventListener('click', function(e) {
        const menu = document.getElementById('mobileNavMenu');
        const btn = document.getElementById('mobileMenuBtn');
        if (menu && btn && menu.classList.contains('open')) {
          if (!menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove('open');
            console.log('Menu closed by outside click');
          }
        }
      });
    });
    
    // Keep the global function for backwards compatibility
    window.toggleMobileMenu = function() {
      const menu = document.getElementById('mobileNavMenu');
      if (menu) {
        menu.classList.toggle('open');
        console.log('Toggle via global function');
      }
    };
    
    // Listen for auth state changes and refresh navigation if needed
    window.addEventListener('authStateChanged', () => {
      console.log('Auth state changed, refreshing navigation...');
      // Remove old navigation
      document.querySelector('.mobile-nav-container')?.remove();
      document.querySelector('.nav-container')?.remove();
      // Re-initialize with new auth state
      NavigationComponent.init(options);
    });
    
    return nav;
  }
}

// Auto-initialize when loaded as module
if (typeof window !== 'undefined') {
  // Flag to prevent double initialization during page load
  let isInitializing = false;
  let hasInitialized = false;
  
  // Store a reference to reinitialize nav when auth is ready
  window.reinitializeNav = async function() {
    // Prevent reinit if we're currently initializing or haven't completed first init
    if (isInitializing) {
      console.log('⏳ Already initializing, skipping reinit...');
      return;
    }
    
    // Don't reinit during the first 2 seconds after page load (initial auth check)
    if (!hasInitialized && performance.now() < 2000) {
      console.log('⏳ Initial page load, skipping early reinit...');
      return;
    }
    
    console.log('🔄 Reinitializing navigation with updated auth state...');
    document.querySelector('.mobile-nav-container')?.remove();
    document.querySelector('.nav-container')?.remove();
    isInitializing = true;
    await NavigationComponent.init();
    isInitializing = false;
  };
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      isInitializing = true;
      await NavigationComponent.init();
      isInitializing = false;
      hasInitialized = true;
    });
  } else {
    (async () => {
      isInitializing = true;
      await NavigationComponent.init();
      isInitializing = false;
      hasInitialized = true;
    })();
  }
  
  // CRITICAL: Set up Firebase auth state listener with longer wait time
  const setupAuthListener = () => {
    if (typeof window.auth !== 'undefined' && window.auth.onAuthStateChanged) {
      console.log('👂 Setting up auth state listener for navigation...');
      window.auth.onAuthStateChanged((user) => {
        console.log('🔐 Auth state changed, user:', user ? user.email : 'none');
        // Reinitialize navigation with new auth state
        setTimeout(async () => {
          await window.reinitializeNav();
        }, 100);
      });
      return true;
    }
    return false;
  };
  
  // Try immediately
  if (!setupAuthListener()) {
    console.log('⏳ Firebase auth not loaded, will check again...');
    let authCheckAttempts = 0;
    const authCheckInterval = setInterval(() => {
      if (setupAuthListener()) {
        console.log('✅ Firebase auth now available, listener attached');
        clearInterval(authCheckInterval);
      } else if (++authCheckAttempts > 40) {
        console.warn('⚠️ Firebase auth not found after 40 attempts (10 seconds)');
        clearInterval(authCheckInterval);
      }
    }, 250);
  }
}

export default NavigationComponent;
