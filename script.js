const histogramSvg = d3.select('#histogram');
const priceChartSvg = d3.select('#priceChart');
const tooltip = d3.select('#tooltip');
const detailsPanel = d3.select('#detailsPanel');
const selectionSummary = d3.select('#selectionSummary');
const annotationText = d3.select('#annotationText');

const marketCapSlider = document.getElementById('marketCapSlider');
const marketCapValue = document.getElementById('marketCapValue');
const rangeSelect = document.getElementById('rangeSelect');
const resetFilters = document.getElementById('resetFilters');
const selectAllYears = document.getElementById('selectAllYears');
const selectNoYears = document.getElementById('selectNoYears');
const priceChartTitle = document.getElementById('priceChartTitle');
const priceChartSubtitle = document.getElementById('priceChartSubtitle');

const RANGE_CONFIG = {
  '1d': { label: '1-day', shortLabel: '1D' },
  '7d': { label: '7-day', shortLabel: '7D' },
  '1m': { label: '1-month', shortLabel: '1M' },
  '1y': { label: '1-year', shortLabel: '1Y' }
};

const state = {
  data: [],
  launchSummary: [],
  yearDomain: [],
  highlightedCoin: null,
  pinnedCoin: null,
  highlightedBarYear: null,
  selectedYears: new Set(),
  marketCapMin: 0,
  selectedRange: '7d'
};

let renderFrame = null;

//Route the "Learn More" button to the info page
document.getElementById("learnMoreBtn").addEventListener("click", () => {
  window.location.href = "info.html";
});


function formatCurrency(value) {
  return d3.format('$,.2s')(value).replace('G', 'B');
}

function formatPrice(value) {
  if (value >= 1000) return d3.format('$,.2f')(value);
  if (value >= 1) return d3.format('$,.3f')(value);
  return d3.format('$,.4f')(value);
}

function formatInteger(value) {
  return d3.format(',')(Math.round(value));
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : 'N/A';
}

function getCurrentRangeConfig() {
  return RANGE_CONFIG[state.selectedRange];
}

function updateRangeCopy() {
  const config = getCurrentRangeConfig();
  priceChartTitle.textContent = `${config.label} change vs current market cap`;
  priceChartSubtitle.textContent = `Each point is a cryptocurrency positioned by current market cap and ${config.label} percentage change. Point size reflects summative ${config.label} volume.`;
  priceChartSvg.attr('aria-label', `${config.label} change versus current market cap chart`);
}

function getMarketCapFilteredCoins() {
  return state.data.filter(d => d.marketCap >= state.marketCapMin);
}

function getFilteredCoins() {
  return getMarketCapFilteredCoins().filter(d => state.selectedYears.has(d.launchYear));
}

function isYearSelected(year) {
  return state.selectedYears.has(year);
}

function getBarFill(d, hovered = false) {
  if (isYearSelected(d.year)) return hovered ? '#3b82f6' : '#60a5fa';
  return hovered ? 'rgba(100,116,139,0.62)' : 'rgba(148,163,184,0.28)';
}

function getVisibleYearSummary() {
  const filtered = getMarketCapFilteredCoins();
  const rollup = d3.rollup(filtered, v => ({
    count: v.length,
    marketCap: d3.sum(v, d => d.marketCap)
  }), d => d.launchYear);

  return state.launchSummary.map(d => ({
    year: d.year,
    count: rollup.get(d.year)?.count ?? 0,
    marketCap: rollup.get(d.year)?.marketCap ?? 0
  }));
}

function getCoinRangeMetric(coin) {
  const metric = coin.rangeMetrics?.[state.selectedRange];
  return {
    changePct: metric?.changePct,
    volumeSum: metric?.volumeSum ?? 0
  };
}

function getPricePoints() {
  return getFilteredCoins().map(d => {
    const metric = getCoinRangeMetric(d);
    return {
      name: d.name,
      symbol: d.symbol,
      rank: d.rank,
      launchDate: d.launchDate,
      launchYear: d.launchYear,
      currentMarketCap: d.marketCap,
      currentPriceUsd: d.priceUsd,
      currentVolume24h: d.volume24h,
      history: d.history,
      rangeMetrics: d.rangeMetrics,
      rangeChange: metric.changePct,
      rangeVolume: metric.volumeSum
    };
  }).filter(d => Number.isFinite(d.currentMarketCap) && Number.isFinite(d.rangeChange));
}

function updateSelectionSummary(filtered) {
  selectionSummary.text(`${filtered.length} coins shown - ${state.selectedYears.size}/${state.yearDomain.length} years selected`);
}

function updateAnnotation(points) {
  const config = getCurrentRangeConfig();
  if (!points.length) {
    annotationText.text('No coins match the current market-cap and launch-year filters.');
    return;
  }

  const biggestGainer = [...points].sort((a, b) => d3.descending(a.rangeChange, b.rangeChange))[0];
  const biggestLoser = [...points].sort((a, b) => d3.ascending(a.rangeChange, b.rangeChange))[0];
  const largestVolume = [...points].sort((a, b) => d3.descending(a.rangeVolume, b.rangeVolume))[0];

  annotationText.text(
    `${biggestGainer.name} is the biggest ${config.label} gainer at ${formatPercent(biggestGainer.rangeChange)}. ` +
    `${biggestLoser.name} is the biggest ${config.label} decliner at ${formatPercent(biggestLoser.rangeChange)}. ` +
    `${largestVolume.name} has the largest summed ${config.label} volume at ${formatCurrency(largestVolume.rangeVolume)}.`
  );
}

function showTooltip(event, html) {
  tooltip
    .classed('hidden', false)
    .html(html)
    .style('left', `${event.clientX + 14}px`)
    .style('top', `${event.clientY + 14}px`);
}

function hideTooltip() {
  tooltip.classed('hidden', true);
}

function renderHistogram() {
  const data = getVisibleYearSummary();
  const margin = { top: 18, right: 18, bottom: 42, left: 52 };
  const width = histogramSvg.node().clientWidth;
  const height = 320;
  histogramSvg.attr('viewBox', `0 0 ${width} ${height}`);
  const transition = histogramSvg.transition().duration(280).ease(d3.easeCubicOut);
  const root = histogramSvg.selectAll('.hist-root')
    .data([null])
    .join('g')
    .attr('class', 'hist-root');

  const x = d3.scaleBand()
    .domain(data.map(d => d.year))
    .range([margin.left, width - margin.right])
    .padding(0.18);

  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.count) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  root.selectAll('.grid-layer')
    .data([null])
    .join('g')
    .attr('class', 'grid grid-layer')
    .attr('transform', `translate(${margin.left},0)`)
    .transition(transition)
    .call(d3.axisLeft(y).tickSize(-(width - margin.left - margin.right)).tickFormat(''));

  root.selectAll('.x-axis')
    .data([null])
    .join('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .transition(transition)
    .call(d3.axisBottom(x).tickFormat(d3.format('d')));

  root.selectAll('.y-axis')
    .data([null])
    .join('g')
    .attr('class', 'axis y-axis')
    .attr('transform', `translate(${margin.left},0)`)
    .transition(transition)
    .call(d3.axisLeft(y).ticks(5));

  root.selectAll('.hist-label')
    .data([null])
    .join('text')
    .attr('class', 'hist-label')
    .attr('x', margin.left)
    .attr('y', margin.top - 4)
    .attr('fill', '#94a3b8')
    .attr('font-size', 12)
    .text('Count of coins');

  const bars = root.selectAll('.bar')
    .data(data, d => d.year)
    .join(
      enter => enter.append('rect')
        .attr('class', 'bar')
        .attr('x', d => x(d.year))
        .attr('y', y(0))
        .attr('width', x.bandwidth())
        .attr('height', 0)
        .attr('fill', d => getBarFill(d, state.highlightedBarYear === d.year)),
      update => update,
      exit => exit.transition(transition)
        .attr('y', y(0))
        .attr('height', 0)
        .remove()
    );

  bars
    .transition(transition)
    .attr('x', d => x(d.year))
    .attr('y', d => y(d.count))
    .attr('width', x.bandwidth())
    .attr('height', d => y(0) - y(d.count))
    .attr('fill', d => getBarFill(d, state.highlightedBarYear === d.year));

  bars
    .on('mouseover', function(event, d) {
      state.highlightedBarYear = d.year;
      d3.select(this)
        .raise()
        .interrupt()
        .transition()
        .duration(220)
        .attr('fill', getBarFill(d, true));
      showTooltip(event, `
        <strong>${d.year}</strong><br>
        Coins launched: ${formatInteger(d.count)}<br>
        Collective current market cap: ${formatCurrency(d.marketCap)}
      `);
      renderBarDetails(d);
    })
    .on('mousemove', function(event, d) {
      showTooltip(event, `
        <strong>${d.year}</strong><br>
        Coins launched: ${formatInteger(d.count)}<br>
        Collective current market cap: ${formatCurrency(d.marketCap)}
      `);
    })
    .on('mouseout', function() {
      state.highlightedBarYear = null;
      d3.select(this)
        .interrupt()
        .transition()
        .duration(260)
        .attr('fill', d => getBarFill(d, false));
      hideTooltip();
      restoreDetailsAfterHover();
    })
    .on('click', (_, d) => {
      if (isYearSelected(d.year)) state.selectedYears.delete(d.year);
      else state.selectedYears.add(d.year);
      state.highlightedBarYear = null;
      hideTooltip();
      restoreDetailsAfterHover();
      renderAll();
    });
}

function renderLegend(g, width, margin) {
  const items = [
    { label: 'Positive (> 0.5%)', color: '#22c55e' },
    { label: 'Neutral (+/- 0.5%)', color: '#94a3b8' },
    { label: 'Negative (< -0.5%)', color: '#ef4444' }
  ];

  const legend = g.selectAll('.legend')
    .data([null])
    .join('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${width - margin.right - 150},${margin.top + 8})`);

  legend.selectAll('.legend-panel')
    .data([null])
    .join('rect')
    .attr('class', 'legend-panel')
    .attr('x', -14)
    .attr('y', -12)
    .attr('rx', 14)
    .attr('ry', 14)
    .attr('width', 178)
    .attr('height', 76);

  const rows = legend.selectAll('.legend-row')
    .data(items, d => d.label)
    .join(enter => {
      const row = enter.append('g').attr('class', 'legend-row');
      row.append('circle').attr('r', 5).attr('cx', 0).attr('cy', 0);
      row.append('text').attr('class', 'legend-label').attr('x', 12).attr('y', 1);
      return row;
    });

  rows.attr('transform', (_, i) => `translate(0,${i * 22})`);
  rows.select('circle').attr('fill', d => d.color);
  rows.select('text').text(d => d.label);
}

function renderPriceChart(animate = true) {
  const pointsData = getPricePoints();
  const config = getCurrentRangeConfig();
  const margin = { top: 20, right: 20, bottom: 60, left: 74 };
  const width = priceChartSvg.node().clientWidth;
  const height = 560;
  priceChartSvg.attr('viewBox', `0 0 ${width} ${height}`);
  const transition = animate
    ? priceChartSvg.transition().duration(650).ease(d3.easeCubicInOut)
    : priceChartSvg.transition().duration(180).ease(d3.easeCubicOut);
  const pointTransition = priceChartSvg.transition().duration(650).ease(d3.easeCubicInOut);
  const root = priceChartSvg.selectAll('.chart-root')
    .data([null])
    .join('g')
    .attr('class', 'chart-root');

  if (!pointsData.length) {
    root.selectAll('*').remove();
    priceChartSvg.selectAll('.chart-empty')
      .data([null])
      .join('text')
      .attr('class', 'chart-empty')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('fill', '#94a3b8')
      .attr('text-anchor', 'middle')
      .text(`No ${config.label} change points are available for the active filters.`);
    return pointsData;
  }

  priceChartSvg.selectAll('.chart-empty').remove();

  const xMin = Math.max(1, d3.min(pointsData, d => d.currentMarketCap));
  const xMax = d3.max(pointsData, d => d.currentMarketCap);
  const x = d3.scaleLog()
    .domain(xMin === xMax ? [xMin, xMin * 10] : [xMin, xMax])
    .nice()
    .range([margin.left, width - margin.right]);

  const yExtent = d3.extent(pointsData, d => d.rangeChange);
  const yMax = Math.max(Math.abs(yExtent[0] ?? 0), Math.abs(yExtent[1] ?? 0), 1);
  const y = d3.scaleSymlog()
    .constant(1)
    .domain([-yMax, yMax])
    .range([height - margin.bottom, margin.top]);

  const [, maxVolume] = d3.extent(pointsData, d => d.rangeVolume);
  const size = d3.scaleSqrt()
    .domain([0, Math.max(maxVolume || 0, 1)])
    .range([5, 24]);
  const magnitudeColor = d3.scalePow()
    .exponent(0.65)
    .domain([0, yMax])
    .range([0.35, 1]);

  const pointColor = d => {
    const intensity = magnitudeColor(Math.abs(d.rangeChange));
    if (d.rangeChange > 0.5) return d3.interpolateRgb('#22c55e', '#14532d')(intensity);
    if (d.rangeChange < -0.5) return d3.interpolateRgb('#ef4444', '#7f1d1d')(intensity);
    return d3.interpolateRgb('#94a3b8', '#334155')(intensity);
  };

  root.selectAll('.grid-layer')
    .data([null])
    .join('g')
    .attr('class', 'grid grid-layer')
    .attr('transform', `translate(${margin.left},0)`)
    .call(selection => {
      const target = transition ? selection.transition(transition) : selection;
      target.call(d3.axisLeft(y).tickSize(-(width - margin.left - margin.right)).tickFormat(''));
    });

  root.selectAll('.x-axis')
    .data([null])
    .join('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(selection => {
      const target = transition ? selection.transition(transition) : selection;
      target.call(d3.axisBottom(x).ticks(6, '~s'));
    });

  root.selectAll('.y-axis')
    .data([null])
    .join('g')
    .attr('class', 'axis y-axis')
    .attr('transform', `translate(${margin.left},0)`)
    .call(selection => {
      const target = transition ? selection.transition(transition) : selection;
      target.call(d3.axisLeft(y).ticks(8).tickFormat(d => `${d}%`));
    });

  root.selectAll('.zero-line')
    .data([null])
    .join('line')
    .attr('class', 'zero-line')
    .attr('x1', margin.left)
    .attr('x2', width - margin.right)
    .attr('stroke', 'rgba(148,163,184,0.35)')
    .attr('stroke-dasharray', '4 4')
    .call(selection => {
      const target = transition ? selection.transition(transition) : selection;
      target
    .attr('y1', y(0))
    .attr('y2', y(0));
    });

  root.selectAll('.x-label')
    .data([null])
    .join('text')
    .attr('class', 'x-label')
    .attr('x', width / 2)
    .attr('y', height - 14)
    .attr('fill', '#94a3b8')
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .text('Current market cap (log scale)');

  root.selectAll('.y-label')
    .data([null])
    .join('text')
    .attr('class', 'y-label')
    .attr('transform', `translate(18, ${height / 2}) rotate(-90)`)
    .attr('fill', '#94a3b8')
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .text(`${config.label} change (%)`);

  renderLegend(root, width, margin);

  const points = root.selectAll('.point')
    .data(pointsData, d => d.name)
    .join(
      enter => enter.append('circle')
        .attr('class', 'point')
        .attr('cx', d => x(d.currentMarketCap))
        .attr('cy', d => y(d.rangeChange))
        .attr('r', 0)
        .attr('fill', d => pointColor(d))
        .call(enter => enter.transition(pointTransition).attr('r', d => size(d.rangeVolume))),
      update => update,
      exit => exit.transition(pointTransition).attr('r', 0).remove()
    );

  points
    .classed('pinned', d => state.pinnedCoin && state.pinnedCoin.name === d.name);

  points
    .filter(d => state.pinnedCoin && state.pinnedCoin.name === d.name)
    .raise();

  if (transition) {
    points
      .transition(transition)
      .attr('cx', d => x(d.currentMarketCap))
      .attr('cy', d => y(d.rangeChange))
      .attr('r', d => size(d.rangeVolume))
      .attr('fill', d => pointColor(d));
  } else {
    points
      .filter(function() { return !this.__transition; })
      .attr('fill', d => pointColor(d))
      .transition(pointTransition)
      .attr('cx', d => x(d.currentMarketCap))
      .attr('r', d => size(d.rangeVolume))
      .attr('cy', d => y(d.rangeChange));
  }

  points
    .on('mouseover', (event, d) => {
      state.highlightedCoin = d;
      renderCoinDetails(d);
      d3.select(event.currentTarget).raise().classed('highlighted', true);
      showTooltip(event, `
        <strong>${d.name} (${d.symbol})</strong><br>
        Current market cap: ${formatCurrency(d.currentMarketCap)}<br>
        ${config.shortLabel} change: ${formatPercent(d.rangeChange)}<br>
        ${config.shortLabel} summative volume: ${formatCurrency(d.rangeVolume)}
      `);
    })
    .on('mousemove', (event, d) => {
      showTooltip(event, `
        <strong>${d.name} (${d.symbol})</strong><br>
        Current market cap: ${formatCurrency(d.currentMarketCap)}<br>
        ${config.shortLabel} change: ${formatPercent(d.rangeChange)}<br>
        ${config.shortLabel} summative volume: ${formatCurrency(d.rangeVolume)}
      `);
    })
    .on('mouseout', event => {
      state.highlightedCoin = null;
      d3.select(event.currentTarget).classed('highlighted', false);
      hideTooltip();
      restoreDetailsAfterHover();
    })
    .on('click', (event, d) => {
      state.pinnedCoin = state.pinnedCoin && state.pinnedCoin.name === d.name ? null : d;
      const target = d3.select(event.currentTarget);
      points.classed('pinned', point => state.pinnedCoin && state.pinnedCoin.name === point.name);
      if (state.pinnedCoin) {
        target.raise();
        renderCoinDetails(state.pinnedCoin);
      } else {
        restoreDetailsAfterHover();
      }
    });

  return pointsData;
}

function renderBarDetails(bar) {
  const coins = getMarketCapFilteredCoins()
    .filter(d => d.launchYear === bar.year)
    .sort((a, b) => d3.descending(a.marketCap, b.marketCap));
  const topCoins = coins.slice(0, 5);
  const remainingCoins = coins.slice(5);

  detailsPanel.html(`
    <div class="detail-title">
      <h3>${bar.year} cohort</h3>
      <span>${bar.count} coins</span>
    </div>
    <div class="note">Combined current market cap: ${formatCurrency(bar.marketCap)}</div>
    <ul class="small-list">
      ${topCoins.length ? topCoins.map(d => `<li>${d.name} (${d.symbol}) · ${formatCurrency(d.marketCap)}</li>`).join('') : '<li>No coins remain after filtering.</li>'}
    </ul>
    ${remainingCoins.length ? `
      <div class="note">Other coins in this cohort</div>
      <ul class="muted-list">
        ${remainingCoins.map(d => `<li>${d.name} (${d.symbol})</li>`).join('')}
      </ul>
    ` : ''}
    <div class="note">Hover a point in the right chart to switch from cohort-level to coin-level details.</div>
  `);
}

function renderCoinDetails(d) {
  const config = getCurrentRangeConfig();
  const rangeSummary = Object.entries(RANGE_CONFIG).map(([key, range]) => {
    const metric = d.rangeMetrics?.[key];
    return `<li>${range.shortLabel}: ${formatPercent(metric?.changePct)} change, ${formatCurrency(metric?.volumeSum ?? 0)} volume</li>`;
  }).join('');

  detailsPanel.html(`
    <div class="detail-title">
      <h3>${d.name}</h3>
      <span>#${d.rank}</span>
    </div>
    <div class="note">${d.symbol} · launched ${d.launchDate}</div>
    <div class="detail-grid">
      <div class="detail-item"><span>Launch year</span><strong>${d.launchYear}</strong></div>
      <div class="detail-item"><span>Current market cap</span><strong>${formatCurrency(d.currentMarketCap)}</strong></div>
      <div class="detail-item"><span>Current price</span><strong>${formatPrice(d.currentPriceUsd)}</strong></div>
      <div class="detail-item"><span>24H volume</span><strong>${formatCurrency(d.currentVolume24h)}</strong></div>
      <div class="detail-item"><span>${config.shortLabel} change</span><strong>${formatPercent(d.rangeChange)}</strong></div>
      <div class="detail-item"><span>${config.shortLabel} volume</span><strong>${formatCurrency(d.rangeVolume)}</strong></div>
      <div class="detail-item"><span>Rank</span><strong>#${d.rank}</strong></div>
      <div class="detail-item"><span>Symbol</span><strong>${d.symbol}</strong></div>
    </div>
    <ul class="small-list">${rangeSummary}</ul>
    <div class="sparkline-wrap">
      <div class="sparkline-caption">Recent close-price history (${d.history.length} trailing points from the source file)</div>
      <svg class="sparkline" id="sparkline"></svg>
    </div>
    <div class="note">Click the point again to unpin it, or click another point to switch the pinned coin.</div>
  `);

  const svg = d3.select('#sparkline');
  const width = Math.max(220, detailsPanel.node().clientWidth - 36);
  const height = 120;
  const margin = { top: 8, right: 8, bottom: 18, left: 8 };
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const x = d3.scaleLinear().domain([0, Math.max(1, d.history.length - 1)]).range([margin.left, width - margin.right]);
  const yExtent = d3.extent(d.history, p => p.close);
  const y = d3.scaleLinear()
    .domain(yExtent[0] === yExtent[1] ? [yExtent[0] - 1, yExtent[1] + 1] : yExtent)
    .nice()
    .range([height - margin.bottom, margin.top]);
  const line = d3.line().x((p, i) => x(i)).y(p => y(p.close)).curve(d3.curveMonotoneX);

  svg.append('path')
    .datum(d.history)
    .attr('fill', 'none')
    .attr('stroke', '#60a5fa')
    .attr('stroke-width', 2)
    .attr('d', line);

  svg.append('line')
    .attr('x1', margin.left)
    .attr('x2', width - margin.right)
    .attr('y1', height - margin.bottom)
    .attr('y2', height - margin.bottom)
    .attr('stroke', 'rgba(148,163,184,0.25)');
}

function restoreDetailsAfterHover() {
  if (state.pinnedCoin) {
    renderCoinDetails(state.pinnedCoin);
  } else {
    detailsPanel.html('<div class="details-empty">Hover a histogram bar or a point to inspect the cohort or coin here.</div>');
  }
}

function renderAll(animate = true) {
  updateRangeCopy();
  const filtered = getFilteredCoins();
  updateSelectionSummary(filtered);
  renderHistogram();
  const points = renderPriceChart(animate);
  updateAnnotation(points);
}

function scheduleRender(animate = true) {
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderAll(animate);
  });
}

function initControls() {
  const maxCap = d3.max(state.data, d => d.marketCap);
  const capScale = d3.scalePow().exponent(3).domain([0, 100]).range([0, maxCap]);
  marketCapValue.textContent = formatCurrency(0);
  rangeSelect.value = state.selectedRange;

  marketCapSlider.addEventListener('input', e => {
    state.marketCapMin = capScale(+e.target.value);
    marketCapValue.textContent = formatCurrency(state.marketCapMin);
    state.highlightedCoin = null;
    state.highlightedBarYear = null;
    restoreDetailsAfterHover();
    scheduleRender(false);
  });

  rangeSelect.addEventListener('change', e => {
    state.selectedRange = e.target.value;
    state.highlightedCoin = null;
    hideTooltip();
    restoreDetailsAfterHover();
    renderAll();
  });

  selectAllYears.addEventListener('click', () => {
    state.selectedYears = new Set(state.yearDomain);
    state.highlightedBarYear = null;
    hideTooltip();
    restoreDetailsAfterHover();
    renderAll();
  });

  selectNoYears.addEventListener('click', () => {
    state.selectedYears = new Set();
    state.highlightedBarYear = null;
    hideTooltip();
    restoreDetailsAfterHover();
    renderAll();
  });

  resetFilters.addEventListener('click', () => {
    marketCapSlider.value = 0;
    rangeSelect.value = '7d';
    state.marketCapMin = 0;
    state.selectedRange = '7d';
    state.selectedYears = new Set(state.yearDomain);
    state.pinnedCoin = null;
    state.highlightedCoin = null;
    state.highlightedBarYear = null;
    marketCapValue.textContent = formatCurrency(0);
    restoreDetailsAfterHover();
    renderAll();
  });

  window.addEventListener('resize', () => scheduleRender());
}

Promise.all([
  d3.json('data/summary.json'),
  d3.json('data/launch_year_summary.json')
]).then(([data, launchSummary]) => {
  state.data = data;
  state.launchSummary = launchSummary;
  state.yearDomain = launchSummary.map(d => d.year);
  state.selectedYears = new Set(state.yearDomain);
  initControls();
  renderAll();
});

