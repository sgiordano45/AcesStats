/**
 * Team Charts Module for Men's Softball League Website
 * Vanilla JavaScript version - no external dependencies
 * @version 1.0.0
 * @author League Development Team
 */

class TeamCharts {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            width: options.width || 800,
            height: options.height || 400,
            margin: options.margin || { top: 40, right: 40, bottom: 80, left: 60 },
            colors: options.colors || ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#00f2fe', '#43e97b', '#38f9d7'],
            animation: options.animation !== false,
            responsive: options.responsive !== false
        };
        
        this.data = null;
        this.currentChart = null;
        this.tooltip = null;
        
        this.init();
    }

    init() {
        this.createTooltip();
        if (this.options.responsive) {
            this.setupResizeHandler();
        }
    }

    /**
     * Create a bar chart showing team wins
     * @param {Array} teams - Array of team objects
     * @param {Object} options - Chart configuration options
     */
    createWinsChart(teams, options = {}) {
        const config = { ...this.options, ...options };
        const sortedTeams = [...teams].sort((a, b) => (b.wins || 0) - (a.wins || 0));
        
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        const maxWins = Math.max(...sortedTeams.map(t => t.wins || 0), 1); // Avoid division by zero
        const barWidth = chartWidth / sortedTeams.length * 0.8;
        const spacing = chartWidth / sortedTeams.length * 0.2;
        
        // Create SVG using vanilla JavaScript
        this.container.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', config.width);
        svg.setAttribute('height', config.height);
        svg.style.background = 'white';
        svg.style.borderRadius = '8px';
        
        // Create chart group
        const chartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        chartGroup.setAttribute('transform', `translate(${margin.left}, ${margin.top})`);
        svg.appendChild(chartGroup);
        
        // Add axes
        this.addAxes(chartGroup, chartWidth, chartHeight);
        
        // Add Y-axis labels
        this.addYAxisLabels(chartGroup, chartHeight, maxWins, 'wins');
        
        // Create bars
        sortedTeams.forEach((team, index) => {
            const x = index * (barWidth + spacing) + spacing/2;
            const barHeight = ((team.wins || 0) / maxWins) * chartHeight;
            const y = chartHeight - barHeight;
            const color = config.colors[index % config.colors.length];
            
            const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bar.setAttribute('class', 'bar');
            bar.setAttribute('x', x);
            bar.setAttribute('width', barWidth);
            bar.setAttribute('fill', color);
            bar.style.cursor = 'pointer';
            bar.style.transition = 'opacity 0.3s ease';
            
            // Animation
            if (config.animation) {
                bar.setAttribute('y', chartHeight);
                bar.setAttribute('height', 0);
                setTimeout(() => {
                    bar.style.transition = 'all 0.8s ease';
                    bar.setAttribute('y', y);
                    bar.setAttribute('height', barHeight);
                }, index * 100);
            } else {
                bar.setAttribute('y', y);
                bar.setAttribute('height', barHeight);
            }
            
            // Add event listeners
            bar.addEventListener('mouseover', (event) => {
                this.showTooltip(event, team.name, `${team.wins || 0} wins`);
                bar.style.opacity = '0.8';
            });
            bar.addEventListener('mouseout', () => {
                this.hideTooltip();
                bar.style.opacity = '1';
            });
            
            chartGroup.appendChild(bar);
        });
        
        // Add team labels
        this.addTeamLabels(chartGroup, sortedTeams, barWidth, spacing, chartHeight);
        
        // Add axis labels
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Wins');
        
        this.container.appendChild(svg);
        this.currentChart = 'wins';
    }

    /**
     * Create a batting average chart
     * @param {Array} teams - Array of team objects
     * @param {Object} options - Chart configuration options
     */
    createBattingChart(teams, options = {}) {
        const config = { ...this.options, ...options };
        const sortedTeams = [...teams].sort((a, b) => (b.batting_avg || 0) - (a.batting_avg || 0));
        
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        const maxAvg = Math.max(...sortedTeams.map(t => t.batting_avg || 0), 0.1); // Avoid division by zero
        const barWidth = chartWidth / sortedTeams.length * 0.8;
        const spacing = chartWidth / sortedTeams.length * 0.2;
        
        // Create SVG
        this.container.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', config.width);
        svg.setAttribute('height', config.height);
        svg.style.background = 'white';
        svg.style.borderRadius = '8px';
        
        const chartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        chartGroup.setAttribute('transform', `translate(${margin.left}, ${margin.top})`);
        svg.appendChild(chartGroup);
        
        this.addAxes(chartGroup, chartWidth, chartHeight);
        this.addYAxisLabels(chartGroup, chartHeight, maxAvg, 'batting');
        
        sortedTeams.forEach((team, index) => {
            const x = index * (barWidth + spacing) + spacing/2;
            const barHeight = ((team.batting_avg || 0) / maxAvg) * chartHeight;
            const y = chartHeight - barHeight;
            const color = config.colors[index % config.colors.length];
            
            const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bar.setAttribute('class', 'bar');
            bar.setAttribute('x', x);
            bar.setAttribute('width', barWidth);
            bar.setAttribute('fill', color);
            bar.style.cursor = 'pointer';
            bar.style.transition = 'opacity 0.3s ease';
            
            if (config.animation) {
                bar.setAttribute('y', chartHeight);
                bar.setAttribute('height', 0);
                setTimeout(() => {
                    bar.style.transition = 'all 0.8s ease';
                    bar.setAttribute('y', y);
                    bar.setAttribute('height', barHeight);
                }, index * 100);
            } else {
                bar.setAttribute('y', y);
                bar.setAttribute('height', barHeight);
            }
            
            bar.addEventListener('mouseover', (event) => {
                this.showTooltip(event, team.name, `.${((team.batting_avg || 0) * 1000).toFixed(0)} avg`);
                bar.style.opacity = '0.8';
            });
            bar.addEventListener('mouseout', () => {
                this.hideTooltip();
                bar.style.opacity = '1';
            });
            
            chartGroup.appendChild(bar);
        });
        
        this.addTeamLabels(chartGroup, sortedTeams, barWidth, spacing, chartHeight);
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Batting Average');
        
        this.container.appendChild(svg);
        this.currentChart = 'batting';
    }

    /**
     * Create a runs scored chart
     * @param {Array} teams - Array of team objects
     * @param {Object} options - Chart configuration options
     */
    createRunsChart(teams, options = {}) {
        const config = { ...this.options, ...options };
        const sortedTeams = [...teams].sort((a, b) => (b.runs || 0) - (a.runs || 0));
        
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        const maxRuns = Math.max(...sortedTeams.map(t => t.runs || 0), 1);
        const barWidth = chartWidth / sortedTeams.length * 0.8;
        const spacing = chartWidth / sortedTeams.length * 0.2;
        
        this.container.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', config.width);
        svg.setAttribute('height', config.height);
        svg.style.background = 'white';
        svg.style.borderRadius = '8px';
        
        const chartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        chartGroup.setAttribute('transform', `translate(${margin.left}, ${margin.top})`);
        svg.appendChild(chartGroup);
        
        this.addAxes(chartGroup, chartWidth, chartHeight);
        this.addYAxisLabels(chartGroup, chartHeight, maxRuns, 'runs');
        
        sortedTeams.forEach((team, index) => {
            const x = index * (barWidth + spacing) + spacing/2;
            const barHeight = ((team.runs || 0) / maxRuns) * chartHeight;
            const y = chartHeight - barHeight;
            const color = config.colors[index % config.colors.length];
            
            const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bar.setAttribute('class', 'bar');
            bar.setAttribute('x', x);
            bar.setAttribute('width', barWidth);
            bar.setAttribute('fill', color);
            bar.style.cursor = 'pointer';
            bar.style.transition = 'opacity 0.3s ease';
            
            if (config.animation) {
                bar.setAttribute('y', chartHeight);
                bar.setAttribute('height', 0);
                setTimeout(() => {
                    bar.style.transition = 'all 0.8s ease';
                    bar.setAttribute('y', y);
                    bar.setAttribute('height', barHeight);
                }, index * 100);
            } else {
                bar.setAttribute('y', y);
                bar.setAttribute('height', barHeight);
            }
            
            bar.addEventListener('mouseover', (event) => {
                this.showTooltip(event, team.name, `${team.runs || 0} runs`);
                bar.style.opacity = '0.8';
            });
            bar.addEventListener('mouseout', () => {
                this.hideTooltip();
                bar.style.opacity = '1';
            });
            
            chartGroup.appendChild(bar);
        });
        
        this.addTeamLabels(chartGroup, sortedTeams, barWidth, spacing, chartHeight);
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Runs Scored');
        
        this.container.appendChild(svg);
        this.currentChart = 'runs';
    }

    /**
     * Create a win percentage chart
     * @param {Array} teams - Array of team objects
     * @param {Object} options - Chart configuration options
     */
    createStandingsChart(teams, options = {}) {
        const config = { ...this.options, ...options };
        const teamsWithPct = teams.map(team => ({
            ...team,
            winPct: (team.wins || 0) / ((team.wins || 0) + (team.losses || 0)) || 0
        })).sort((a, b) => b.winPct - a.winPct);
        
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        const barWidth = chartWidth / teamsWithPct.length * 0.8;
        const spacing = chartWidth / teamsWithPct.length * 0.2;
        
        this.container.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', config.width);
        svg.setAttribute('height', config.height);
        svg.style.background = 'white';
        svg.style.borderRadius = '8px';
        
        const chartGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        chartGroup.setAttribute('transform', `translate(${margin.left}, ${margin.top})`);
        svg.appendChild(chartGroup);
        
        this.addAxes(chartGroup, chartWidth, chartHeight);
        this.addYAxisLabels(chartGroup, chartHeight, 1, 'percentage');
        
        teamsWithPct.forEach((team, index) => {
            const x = index * (barWidth + spacing) + spacing/2;
            const barHeight = team.winPct * chartHeight;
            const y = chartHeight - barHeight;
            const color = config.colors[index % config.colors.length];
            
            const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bar.setAttribute('class', 'bar');
            bar.setAttribute('x', x);
            bar.setAttribute('width', barWidth);
            bar.setAttribute('fill', color);
            bar.style.cursor = 'pointer';
            bar.style.transition = 'opacity 0.3s ease';
            
            if (config.animation) {
                bar.setAttribute('y', chartHeight);
                bar.setAttribute('height', 0);
                setTimeout(() => {
                    bar.style.transition = 'all 0.8s ease';
                    bar.setAttribute('y', y);
                    bar.setAttribute('height', barHeight);
                }, index * 100);
            } else {
                bar.setAttribute('y', y);
                bar.setAttribute('height', barHeight);
            }
            
            bar.addEventListener('mouseover', (event) => {
                this.showTooltip(event, team.name, `${(team.winPct * 100).toFixed(1)}% win rate`);
                bar.style.opacity = '0.8';
            });
            bar.addEventListener('mouseout', () => {
                this.hideTooltip();
                bar.style.opacity = '1';
            });
            
            chartGroup.appendChild(bar);
        });
        
        this.addTeamLabels(chartGroup, teamsWithPct, barWidth, spacing, chartHeight);
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Win Percentage');
        
        this.container.appendChild(svg);
        this.currentChart = 'standings';
    }

    // Utility Methods
    calculateDimensions(config) {
        return {
            chartWidth: config.width - config.margin.left - config.margin.right,
            chartHeight: config.height - config.margin.top - config.margin.bottom,
            margin: config.margin
        };
    }

    addAxes(chartGroup, chartWidth, chartHeight) {
        // Y-axis
        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxis.setAttribute('x1', 0);
        yAxis.setAttribute('y1', 0);
        yAxis.setAttribute('x2', 0);
        yAxis.setAttribute('y2', chartHeight);
        yAxis.setAttribute('stroke', '#e1e5e9');
        yAxis.setAttribute('stroke-width', 2);
        chartGroup.appendChild(yAxis);
        
        // X-axis
        const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        xAxis.setAttribute('x1', 0);
        xAxis.setAttribute('y1', chartHeight);
        xAxis.setAttribute('x2', chartWidth);
        xAxis.setAttribute('y2', chartHeight);
        xAxis.setAttribute('stroke', '#e1e5e9');
        xAxis.setAttribute('stroke-width', 2);
        chartGroup.appendChild(xAxis);
    }

    addYAxisLabels(chartGroup, chartHeight, maxValue, type) {
        let labels = [];
        
        switch(type) {
            case 'wins':
            case 'runs':
                const increment = type === 'runs' ? Math.max(Math.ceil(maxValue / 10), 5) : Math.max(Math.ceil(maxValue / 5), 1);
                for (let i = 0; i <= maxValue; i += increment) {
                    labels.push({ value: i, text: i.toString() });
                }
                break;
            case 'batting':
                for (let i = 0; i <= 10; i++) {
                    const avg = i * 0.05;
                    if (avg <= maxValue + 0.05) {
                        labels.push({ value: avg, text: `.${Math.round(avg * 1000).toString().padStart(3, '0')}` });
                    }
                }
                break;
            case 'percentage':
                for (let i = 0; i <= 10; i++) {
                    const pct = i * 0.1;
                    labels.push({ value: pct, text: `${Math.round(pct * 100)}%` });
                }
                break;
        }
        
        labels.forEach(label => {
            const y = chartHeight - (label.value / maxValue) * chartHeight;
            
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', -10);
            text.setAttribute('y', y + 5);
            text.setAttribute('text-anchor', 'end');
            text.setAttribute('font-size', '12px');
            text.setAttribute('fill', '#666');
            text.textContent = label.text;
            chartGroup.appendChild(text);
            
            const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            tick.setAttribute('x1', -5);
            tick.setAttribute('y1', y);
            tick.setAttribute('x2', 5);
            tick.setAttribute('y2', y);
            tick.setAttribute('stroke', '#e1e5e9');
            chartGroup.appendChild(tick);
        });
    }

    addTeamLabels(chartGroup, teams, barWidth, spacing, chartHeight) {
        teams.forEach((team, index) => {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', index * (barWidth + spacing) + spacing/2 + barWidth/2);
            text.setAttribute('y', chartHeight + 20);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '12px');
            text.setAttribute('fill', '#666');
            text.textContent = (team.name || '').replace('Aces ', '');
            chartGroup.appendChild(text);
        });
    }

    addAxisLabels(chartGroup, chartWidth, chartHeight, xLabel, yLabel) {
        // X-axis label
        const xLabelElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        xLabelElement.setAttribute('x', chartWidth/2);
        xLabelElement.setAttribute('y', chartHeight + 60);
        xLabelElement.setAttribute('text-anchor', 'middle');
        xLabelElement.setAttribute('font-size', '14px');
        xLabelElement.setAttribute('font-weight', '600');
        xLabelElement.setAttribute('fill', '#333');
        xLabelElement.textContent = xLabel;
        chartGroup.appendChild(xLabelElement);
        
        // Y-axis label
        const yLabelElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        yLabelElement.setAttribute('x', -30);
        yLabelElement.setAttribute('y', chartHeight/2);
        yLabelElement.setAttribute('text-anchor', 'middle');
        yLabelElement.setAttribute('font-size', '14px');
        yLabelElement.setAttribute('font-weight', '600');
        yLabelElement.setAttribute('fill', '#333');
        yLabelElement.setAttribute('transform', `rotate(-90, -30, ${chartHeight/2})`);
        yLabelElement.textContent = yLabel;
        chartGroup.appendChild(yLabelElement);
    }

    createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'chart-tooltip';
        this.tooltip.style.position = 'absolute';
        this.tooltip.style.background = 'rgba(0,0,0,0.8)';
        this.tooltip.style.color = 'white';
        this.tooltip.style.padding = '8px 12px';
        this.tooltip.style.borderRadius = '6px';
        this.tooltip.style.fontSize = '12px';
        this.tooltip.style.pointerEvents = 'none';
        this.tooltip.style.zIndex = '1000';
        this.tooltip.style.opacity = '0';
        this.tooltip.style.transition = 'opacity 0.3s ease';
        document.body.appendChild(this.tooltip);
    }

    showTooltip(event, teamName, value) {
        this.tooltip.style.left = (event.pageX + 10) + 'px';
        this.tooltip.style.top = (event.pageY - 10) + 'px';
        this.tooltip.innerHTML = `<strong>${teamName}</strong><br/>${value}`;
        this.tooltip.style.opacity = '1';
    }

    hideTooltip() {
        this.tooltip.style.opacity = '0';
    }

    setupResizeHandler() {
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (this.currentChart) {
                    // Re-render current chart
                    const teams = this.data ? this.data.teams || [] : [];
                    if (teams.length > 0) {
                        this.updateChart(teams, this.currentChart);
                    }
                }
            }, 250);
        });
    }

    showError(message) {
        this.container.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #dc3545;">
                <h3>Error Loading Chart</h3>
                <p>${message}</p>
            </div>
        `;
    }

    updateChart(newData, chartType = 'wins') {
        this.data = { teams: newData };
        
        switch(chartType) {
            case 'wins':
                this.createWinsChart(newData);
                break;
            case 'batting':
                this.createBattingChart(newData);
                break;
            case 'runs':
                this.createRunsChart(newData);
                break;
            case 'standings':
                this.createStandingsChart(newData);
                break;
            default:
                console.warn('Unknown chart type:', chartType);
        }
    }

    destroy() {
        if (this.tooltip && this.tooltip.parentNode) {
            this.tooltip.parentNode.removeChild(this.tooltip);
        }
        this.container.innerHTML = '';
        this.data = null;
        this.currentChart = null;
    }
}

// Global exposure for script tag usage
if (typeof window !== 'undefined') {
    window.TeamCharts = TeamCharts;
}