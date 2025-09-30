/**
 * Mobile Enhancements JavaScript
 * Shared functionality for mobile-responsive improvements
 * @version 1.0.0
 */

(function() {
  'use strict';

  // ========================================
  // MOBILE NAVIGATION
  // ========================================

  /**
   * Toggle mobile navigation menu
   */
  window.toggleMobileMenu = function() {
    const menu = document.getElementById('mobileNavMenu');
    const hamburger = document.querySelector('.hamburger-menu');
    
    if (menu) {
      const isOpen = menu.classList.toggle('open');
      
      // Update ARIA attributes for accessibility
      if (hamburger) {
        hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
      
      // Prevent body scroll when menu is open
      if (isOpen) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
  };

  /**
   * Close mobile menu when clicking outside
   */
  function setupMobileMenuClickOutside() {
    document.addEventListener('click', function(event) {
      const menu = document.getElementById('mobileNavMenu');
      const hamburger = document.querySelector('.hamburger-menu');
      
      if (!menu || !hamburger) return;
      
      // Check if click is outside menu and hamburger button
      if (!menu.contains(event.target) && !hamburger.contains(event.target)) {
        menu.classList.remove('open');
      }
    });
  }

  /**
   * Close mobile menu when navigation link is clicked
   */
  function setupMobileMenuAutoClose() {
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => {
      item.addEventListener('click', function() {
        const menu = document.getElementById('mobileNavMenu');
        if (menu) {
          // Small delay to allow navigation to start
          setTimeout(() => {
            menu.classList.remove('open');
          }, 200);
        }
      });
    });
  }

  // ========================================
  // TABLE ENHANCEMENTS
  // ========================================

  /**
   * Add touch scroll indicators to tables
   */
  function addTableScrollIndicators() {
    const tables = document.querySelectorAll('.standings-table, .schedule-table, .bracket-table, table');
    
    tables.forEach(table => {
      // Check if table is wider than its container
      const tableWidth = table.scrollWidth;
      const containerWidth = table.parentElement.clientWidth;
      
      if (tableWidth > containerWidth && window.innerWidth <= 768) {
        // Add visual indicator that table is scrollable
        table.style.cursor = 'grab';
        
        // Add scroll shadow effect
        const wrapper = table.parentElement;
        wrapper.addEventListener('scroll', function() {
          const scrollLeft = wrapper.scrollLeft;
          const scrollWidth = wrapper.scrollWidth;
          const clientWidth = wrapper.clientWidth;
          
          // Add/remove shadow classes based on scroll position
          if (scrollLeft > 0) {
            wrapper.classList.add('scroll-shadow-left');
          } else {
            wrapper.classList.remove('scroll-shadow-left');
          }
          
          if (scrollLeft + clientWidth < scrollWidth - 5) {
            wrapper.classList.add('scroll-shadow-right');
          } else {
            wrapper.classList.remove('scroll-shadow-right');
          }
        });
      }
    });
  }

  /**
   * Enable smooth touch scrolling for tables
   */
  function enableTouchScrolling() {
    const tables = document.querySelectorAll('.standings-table, .schedule-table, .bracket-table, table');
    
    tables.forEach(table => {
      let isDown = false;
      let startX;
      let scrollLeft;
      const wrapper = table.parentElement;

      table.addEventListener('mousedown', (e) => {
        if (window.innerWidth > 768) return; // Only on mobile
        isDown = true;
        table.style.cursor = 'grabbing';
        startX = e.pageX - wrapper.offsetLeft;
        scrollLeft = wrapper.scrollLeft;
      });

      table.addEventListener('mouseleave', () => {
        isDown = false;
        table.style.cursor = 'grab';
      });

      table.addEventListener('mouseup', () => {
        isDown = false;
        table.style.cursor = 'grab';
      });

      table.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - wrapper.offsetLeft;
        const walk = (x - startX) * 2;
        wrapper.scrollLeft = scrollLeft - walk;
      });
    });
  }

  // ========================================
  // SEARCH ENHANCEMENTS
  // ========================================

  /**
   * Setup mobile search with clear button
   */
  function setupMobileSearch() {
    const searchInput = document.getElementById('globalSearch');
    const clearButton = document.getElementById('clearSearch');
    
    if (searchInput && clearButton) {
      // Show/hide clear button based on input
      searchInput.addEventListener('input', function() {
        if (this.value.length > 0) {
          clearButton.style.display = 'block';
        } else {
          clearButton.style.display = 'none';
        }
      });
      
      // Clear search when button clicked
      clearButton.addEventListener('click', function() {
        searchInput.value = '';
        clearButton.style.display = 'none';
        searchInput.focus();
        
        // Trigger input event to update search results
        const event = new Event('input', { bubbles: true });
        searchInput.dispatchEvent(event);
      });
    }
  }

  // ========================================
  // VIEWPORT & ORIENTATION DETECTION
  // ========================================

  /**
   * Detect orientation changes and adjust layout
   */
  function handleOrientationChange() {
    const handleChange = () => {
      // Re-initialize table scrolling on orientation change
      setTimeout(() => {
        addTableScrollIndicators();
      }, 300);
    };

    window.addEventListener('orientationchange', handleChange);
    window.addEventListener('resize', handleChange);
  }

  /**
   * Check if device is in landscape mode
   */
  function isLandscape() {
    return window.innerWidth > window.innerHeight;
  }

  // ========================================
  // PERFORMANCE OPTIMIZATIONS
  // ========================================

  /**
   * Debounce function for performance
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Lazy load images on mobile
   */
  function setupLazyLoading() {
    if ('IntersectionObserver' in window && window.innerWidth <= 768) {
      const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              img.removeAttribute('data-src');
              imageObserver.unobserve(img);
            }
          }
        });
      });

      document.querySelectorAll('img[data-src]').forEach(img => {
        imageObserver.observe(img);
      });
    }
  }

  // ========================================
  // ACCESSIBILITY
  // ========================================

  /**
   * Add keyboard navigation support
   */
  function setupKeyboardNavigation() {
    // Close mobile menu with Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        const menu = document.getElementById('mobileNavMenu');
        if (menu && menu.classList.contains('open')) {
          menu.classList.remove('open');
          document.querySelector('.hamburger-menu')?.focus();
        }
      }
    });

    // Toggle menu with Enter/Space on hamburger button
    const hamburger = document.querySelector('.hamburger-menu');
    if (hamburger) {
      hamburger.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleMobileMenu();
        }
      });
    }
  }

  /**
   * Announce screen reader messages
   */
  function announceToScreenReader(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.classList.add('sr-only');
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  // ========================================
  // TOUCH GESTURES
  // ========================================

  /**
   * Add swipe gestures for navigation
   */
  function setupSwipeGestures() {
    if (window.innerWidth > 768) return; // Only on mobile

    let touchStartX = 0;
    let touchEndX = 0;
    
    document.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    document.addEventListener('touchend', e => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    }, { passive: true });
    
    function handleSwipe() {
      const swipeThreshold = 100;
      const menu = document.getElementById('mobileNavMenu');
      
      if (!menu) return;
      
      // Swipe right to open menu (if closed)
      if (touchEndX > touchStartX + swipeThreshold && !menu.classList.contains('open')) {
        if (touchStartX < 50) { // Only if swipe started from left edge
          toggleMobileMenu();
        }
      }
      
      // Swipe left to close menu (if open)
      if (touchStartX > touchEndX + swipeThreshold && menu.classList.contains('open')) {
        toggleMobileMenu();
      }
    }
  }

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Check if device is mobile
   */
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  /**
   * Get viewport width
   */
  function getViewportWidth() {
    return Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  }

  /**
   * Get viewport height
   */
  function getViewportHeight() {
    return Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  }

  /**
   * Detect if user prefers reduced motion
   */
  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize all mobile enhancements
   */
  function initializeMobileEnhancements() {
    // Navigation
    setupMobileMenuClickOutside();
    setupMobileMenuAutoClose();
    
    // Tables
    addTableScrollIndicators();
    enableTouchScrolling();
    
    // Search
    setupMobileSearch();
    
    // Orientation
    handleOrientationChange();
    
    // Performance
    setupLazyLoading();
    
    // Accessibility
    setupKeyboardNavigation();
    
    // Touch
    setupSwipeGestures();
    
    // Log initialization (can be removed in production)
    if (window.innerWidth <= 768) {
      console.log('Mobile enhancements initialized');
    }
  }

  /**
   * Re-initialize on dynamic content load
   */
  window.reinitializeMobileEnhancements = function() {
    addTableScrollIndicators();
    setupMobileMenuAutoClose();
  };

  // ========================================
  // AUTO-INITIALIZE
  // ========================================

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMobileEnhancements);
  } else {
    initializeMobileEnhancements();
  }

  // Re-initialize on window resize (debounced)
  window.addEventListener('resize', debounce(() => {
    if (window.innerWidth <= 768) {
      addTableScrollIndicators();
    }
  }, 250));

  // Export utilities for use in other scripts
  window.MobileUtils = {
    isMobileDevice,
    getViewportWidth,
    getViewportHeight,
    isLandscape,
    prefersReducedMotion,
    announceToScreenReader,
    debounce
  };

})();