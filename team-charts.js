/**
 * Team Charts Module for Men's Softball League Website
 * Provides interactive visualizations for team performance data
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
     * Load team data from JSON files
     * @param {Object} dataSources - Object containing paths to data files
     */
    async loadData(dataSources) {
        try {
            const loadPromises = Object.entries(dataSources).map(async ([key, url]) => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to load ${key}: ${response.statusText}`);
                return [key, await response.json()];
            });
            
            const dataEntries = await Promise.all(loadPromises);
            this.data = Object.fromEntries(dataEntries);
            
            console.log('Data loaded successfully:', Object.keys(this.data));
            return this.data;
        } catch (error) {
            console.error('Error loading data:', error);
            this.showError('Failed to load team data. Please check your data files.');
            throw error;
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
        
        const svg = this.createSVG(config);
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        
        const maxWins = Math.max(...sortedTeams.map(t => t.wins || 0));
        const barWidth = chartWidth / sortedTeams.length * 0.8;
        const spacing = chartWidth / sortedTeams.length * 0.2;
        
        // Create chart group
        const chartGroup = svg.append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);
        
        // Add axes
        this.addAxes(chartGroup, chartWidth, chartHeight);
        
        // Add Y-axis labels
        this.addYAxisLabels(chartGroup, chartHeight, maxWins, 'wins');
        
        // Create bars
        const bars = chartGroup.selectAll('.bar')
            .data(sortedTeams)
            .enter()
            .append('rect')
            .attr('class', 'bar')
            .attr('x', (d, i) => i * (barWidth + spacing) + spacing/2)
            .attr('width', barWidth)
            .attr('y', chartHeight)
            .attr('height', 0)
            .attr('fill', (d, i) => config.colors[i % config.colors.length])
            .on('mouseover', (event, d) => this.showTooltip(event, d.name, `${d.wins || 0} wins`))
            .on('mouseout', () => this.hideTooltip());
        
        // Animate bars
        if (config.animation) {
            bars.transition()
                .duration(800)
                .delay((d, i) => i * 100)
                .attr('y', d => chartHeight - ((d.wins || 0) / maxWins) * chartHeight)
                .attr('height', d => ((d.wins || 0) / maxWins) * chartHeight);
        } else {
            bars.attr('y', d => chartHeight - ((d.wins || 0) / maxWins) * chartHeight)
                .attr('height', d => ((d.wins || 0) / maxWins) * chartHeight);
        }
        
        // Add team labels
        this.addTeamLabels(chartGroup, sortedTeams, barWidth, spacing, chartHeight);
        
        // Add axis labels
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Wins');
        
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
        
        const svg = this.createSVG(config);
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        
        const maxAvg = Math.max(...sortedTeams.map(t => t.batting_avg || 0));
        const barWidth = chartWidth / sortedTeams.length * 0.8;
        const spacing = chartWidth / sortedTeams.length * 0.2;
        
        const chartGroup = svg.append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);
        
        this.addAxes(chartGroup, chartWidth, chartHeight);
        this.addYAxisLabels(chartGroup, chartHeight, maxAvg, 'batting');
        
        const bars = chartGroup.selectAll('.bar')
            .data(sortedTeams)
            .enter()
            .append('rect')
            .attr('class', 'bar')
            .attr('x', (d, i) => i * (barWidth + spacing) + spacing/2)
            .attr('width', barWidth)
            .attr('y', chartHeight)
            .attr('height', 0)
            .attr('fill', (d, i) => config.colors[i % config.colors.length])
            .on('mouseover', (event, d) => this.showTooltip(event, d.name, `.${((d.batting_avg || 0) * 1000).toFixed(0)} avg`))
            .on('mouseout', () => this.hideTooltip());
        
        if (config.animation) {
            bars.transition()
                .duration(800)
                .delay((d, i) => i * 100)
                .attr('y', d => chartHeight - ((d.batting_avg || 0) / maxAvg) * chartHeight)
                .attr('height', d => ((d.batting_avg || 0) / maxAvg) * chartHeight);
        } else {
            bars.attr('y', d => chartHeight - ((d.batting_avg || 0) / maxAvg) * chartHeight)
                .attr('height', d => ((d.batting_avg || 0) / maxAvg) * chartHeight);
        }
        
        this.addTeamLabels(chartGroup, sortedTeams, barWidth, spacing, chartHeight);
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Batting Average');
        
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
        
        const svg = this.createSVG(config);
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        
        const maxRuns = Math.max(...sortedTeams.map(t => t.runs || 0));
        const barWidth = chartWidth / sortedTeams.length * 0.8;
        const spacing = chartWidth / sortedTeams.length * 0.2;
        
        const chartGroup = svg.append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);
        
        this.addAxes(chartGroup, chartWidth, chartHeight);
        this.addYAxisLabels(chartGroup, chartHeight, maxRuns, 'runs');
        
        const bars = chartGroup.selectAll('.bar')
            .data(sortedTeams)
            .enter()
            .append('rect')
            .attr('class', 'bar')
            .attr('x', (d, i) => i * (barWidth + spacing) + spacing/2)
            .attr('width', barWidth)
            .attr('y', chartHeight)
            .attr('height', 0)
            .attr('fill', (d, i) => config.colors[i % config.colors.length])
            .on('mouseover', (event, d) => this.showTooltip(event, d.name, `${d.runs || 0} runs`))
            .on('mouseout', () => this.hideTooltip());
        
        if (config.animation) {
            bars.transition()
                .duration(800)
                .delay((d, i) => i * 100)
                .attr('y', d => chartHeight - ((d.runs || 0) / maxRuns) * chartHeight)
                .attr('height', d => ((d.runs || 0) / maxRuns) * chartHeight);
        } else {
            bars.attr('y', d => chartHeight - ((d.runs || 0) / maxRuns) * chartHeight)
                .attr('height', d => ((d.runs || 0) / maxRuns) * chartHeight);
        }
        
        this.addTeamLabels(chartGroup, sortedTeams, barWidth, spacing, chartHeight);
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Runs Scored');
        
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
        
        const svg = this.createSVG(config);
        const { chartWidth, chartHeight, margin } = this.calculateDimensions(config);
        
        const barWidth = chartWidth / teamsWithPct.length * 0.8;
        const spacing = chartWidth / teamsWithPct.length * 0.2;
        
        const chartGroup = svg.append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);
        
        this.addAxes(chartGroup, chartWidth, chartHeight);
        this.addYAxisLabels(chartGroup, chartHeight, 1, 'percentage');
        
        const bars = chartGroup.selectAll('.bar')
            .data(teamsWithPct)
            .enter()
            .append('rect')
            .attr('class', 'bar')
            .attr('x', (d, i) => i * (barWidth + spacing) + spacing/2)
            .attr('width', barWidth)
            .attr('y', chartHeight)
            .attr('height', 0)
            .attr('fill', (d, i) => config.colors[i % config.colors.length])
            .on('mouseover', (event, d) => this.showTooltip(event, d.name, `${(d.winPct * 100).toFixed(1)}% win rate`))
            .on('mouseout', () => this.hideTooltip());
        
        if (config.animation) {
            bars.transition()
                .duration(800)
                .delay((d, i) => i * 100)
                .attr('y', d => chartHeight - (d.winPct * chartHeight))
                .attr('height', d => d.winPct * chartHeight);
        } else {
            bars.attr('y', d => chartHeight - (d.winPct * chartHeight))
                .attr('height', d => d.winPct * chartHeight);
        }
        
        this.addTeamLabels(chartGroup, teamsWithPct, barWidth, spacing, chartHeight);
        this.addAxisLabels(chartGroup, chartWidth, chartHeight, 'Teams', 'Win Percentage');
        
        this.currentChart = 'standings';
    }

    // Utility Methods

    createSVG(config) {
        this.container.innerHTML = '';
        return d3.select(this.container)
            .append('svg')
            .attr('width', config.width)
            .attr('height', config.height)
            .style('background', 'white')
            .style('border-radius', '8px');
    }

    calculateDimensions(config) {
        return {
            chartWidth: config.width - config.margin.left - config.margin.right,
            chartHeight: config.height - config.margin.top - config.margin.bottom,
            margin: config.margin
        };
    }

    addAxes(chartGroup, chartWidth, chartHeight) {
        // Y-axis
        chartGroup.append('line')
            .attr('x1', 0)
            .attr('y1', 0)
            .attr('x2', 0)
            .attr('y2', chartHeight)
            .attr('stroke', '#e1e5e9')
            .attr('stroke-width', 2);
        
        // X-axis
        chartGroup.append('line')
            .attr('x1', 0)
            .attr('y1', chartHeight)
            .attr('x2', chartWidth)
            .attr('y2', chartHeight)
            .attr('stroke', '#e1e5e9')
            .attr('stroke-width', 2);
    }

    addYAxisLabels(chartGroup, chartHeight, maxValue, type) {
        let labels = [];
        
        switch(type) {
            case 'wins':
            case 'runs':
                const increment = type === 'runs' ? 20 : 2;
                for (let i = 0; i <= maxValue; i += increment) {
                    labels.push({ value: i, text: i.toString() });
                }
                break;
            case 'batting':
                for (let i = 0; i <= 10; i++) {
                    const avg = i * 0.05;
                    if (avg <= maxValue) {
                        labels.push({ value: avg, text: `.${(avg * 1000).toString().padStart(3, '0')}` });
                    }
                }
                break;
            case 'percentage':
                for (let i = 0; i <= 10; i++) {
                    const pct = i * 0.1;
                    labels.push({ value: pct, text: `${(pct * 100).toFixed(0)}%` });
                }
                break;
        }
        
        labels.forEach(label => {
            const y = chartHeight - (label.value / maxValue) * chartHeight;
            
            chartGroup.append('text')
                .attr('x', -10)
                .attr('y', y + 5)
                .attr('text-anchor', 'end')
                .attr('font-size', '12px')
                .attr('fill', '#666')
                .text(label.text);
            
            chartGroup.append('line')
                .attr('x1', -5)
                .attr('y1', y)
                .attr('x2', 5)
                .attr('y2', y)
                .attr('stroke', '#e1e5e9');
        });
    }

    addTeamLabels(chartGroup, teams, barWidth, spacing, chartHeight) {
        chartGroup.selectAll('.team-label')
            .data(teams)
            .enter()
            .append('text')
            .attr('class', 'team-label')
            .attr('x', (d, i) => i * (barWidth + spacing) + spacing/2 + barWidth/2)
            .attr('y', chartHeight + 20)
            .attr('text-anchor', 'middle')
            .attr('font-size', '12px')
            .attr('fill', '#666')
            .text(d => (d.name || '').replace('Aces ', ''));
    }

    addAxisLabels(chartGroup, chartWidth, chartHeight, xLabel, yLabel) {
        // X-axis label
        chartGroup.append('text')
            .attr('x', chartWidth/2)
            .attr('y', chartHeight + 60)
            .attr('text-anchor', 'middle')
            .attr('font-size', '14px')
            .attr('font-weight', '600')
            .attr('fill', '#333')
            .text(xLabel);
        
        // Y-axis label
        chartGroup.append('text')
            .attr('x', -30)
            .attr('y', chartHeight/2)
            .attr('text-anchor', 'middle')
            .attr('font-size', '14px')
            .attr('font-weight', '600')
            .attr('fill', '#333')
            .attr('transform', `rotate(-90, -30, ${chartHeight/2})`)
            .text(yLabel);
    }

    createTooltip() {
        this.tooltip = d3.select('body')
            .append('div')
            .attr('class', 'chart-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(0,0,0,0.8)')
            .style('color', 'white')
            .style('padding', '8px 12px')
            .style('border-radius', '6px')
            .style('font-size', '12px')
            .style('pointer-events', 'none')
            .style('z-index', '1000')
            .style('opacity', 0);
    }

    showTooltip(event, teamName, value) {
        this.tooltip
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px')
            .html(`<strong>${teamName}</strong><br/>${value}`)
            .transition()
            .duration(200)
            .style('opacity', 1);
    }

    hideTooltip() {
        this.tooltip
            .transition()
            .duration(200)
            .style('opacity', 0);
    }

    setupResizeHandler() {
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (this.currentChart && this.data) {
                    this.refresh();
                }
            }, 250);
        });
    }

    refresh() {
        if (this.currentChart && this.data) {
            // Re-render the current chart type
            const teams = this.getCurrentTeamsData();
            switch(this.currentChart) {
                case 'wins':
                    this.createWinsChart(teams);
                    break;
                case 'batting':
                    this.createBattingChart(teams);
                    break;
                case 'runs':
                    this.createRunsChart(teams);
                    break;
                case 'standings':
                    this.createStandingsChart(teams);
                    break;
            }
        }
    }

    getCurrentTeamsData() {
        // This should be implemented based on your data structure
        // Return the currently selected season's team data
        return this.data.teams || [];
    }

    showError(message) {
        this.container.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #dc3545;">
                <h3>Error Loading Chart</h3>
                <p>${message}</p>
            </div>
        `;
    }

    /**
     * Export chart data as CSV
     * @param {string} filename - Name of the exported file
     */
    exportData(filename = 'team-data.csv') {
        if (!this.data || !this.data.teams) {
            console.warn('No data available for export');
            return;
        }

        const teams = this.data.teams;
        const headers = ['Team', 'Wins', 'Losses', 'Batting Avg', 'Runs Scored'];
        const csvContent = [
            headers.join(','),
            ...teams.map(team => [
                team.name || '',
                team.wins || 0,
                team.losses || 0,
                (team.batting_avg || 0).toFixed(3),
                team.runs || 0
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    /**
     * Update chart with new data
     * @param {Array} newData - New team data
     * @param {string} chartType - Type of chart to display
     */
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

    /**
     * Destroy the chart and clean up resources
     */
    destroy() {
        if (this.tooltip) {
            this.tooltip.remove();
        }
        this.container.innerHTML = '';
        this.data = null;
        this.currentChart = null;
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TeamCharts;
}

// Global exposure for script tag usage
if (typeof window !== 'undefined') {
    window.TeamCharts = TeamCharts;
}
