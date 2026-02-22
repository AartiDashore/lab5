
    async function performSearch() {
        const query = document.getElementById('queryInput').value;
        // addition from lab5_three_panel_insert
        const hybrid = document.getElementById('useHybrid').checked;
        const reranking = document.getElementById('useReranking').checked;
        const nResults = parseInt(document.getElementById('nResults').value);
        const startTime = performance.now();

        const resultsDiv = document.getElementById('results');

        if (!query.trim()) {
            resultsDiv.innerHTML = '<p class="error">Please enter a search query</p>';
            return;
        }

        resultsDiv.innerHTML = '<p class="loading">Searching...</p>';

        try {
            const response = await fetch('http://localhost:8000/search', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({query, n_results: nResults, hybrid, reranking})
            });

            const data = await response.json();

            if (!response.ok) {
                resultsDiv.innerHTML = `<p class="error">Error: ${data.detail}</p>`;
                return;
            }

            if (data.results.length === 0) {
                resultsDiv.innerHTML = '<p class="no-results">No results found</p>';
                return;
            }

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        const method = hybrid ? (reranking ? 'Hybrid + Reranking' : 'Hybrid') : 'Keyword';
        document.getElementById('metricMethod').textContent = method;
        document.getElementById('metricCount').textContent = data.results.length;
        document.getElementById('metricTime').textContent = elapsed + 's';
        document.getElementById('metricsSection').style.display = 'flex';

        addToHistory(query, data.results.length, elapsed);
        lastResults = data.results;

        console.log(data.results[0]);
        displayResults(data.results);

        } catch (error) {
            resultsDiv.innerHTML = `<p class="error">Failed to connect to server</p>`;
        }
    }

    // Get health status from the server and show it in the health-status div
    async function displayHealth() {
        try {
            const result = document.getElementById('health-status');
            result.innerHTML = `<p>Hmm...let me see</p>`;
            const response = await fetch('http://localhost:8000/health');
            const data = await response.json();
            result.innerHTML = `
                <p>${data.status} - ${data.documents_indexed} chunks indexed</p>
                <p>${data.message}</p>
            `;
        } catch (error) {
            document.getElementById('health-status').textContent = 'Error fetching health status';
        }
    }

    // Allow the Enter key to trigger search
    document.getElementById('queryInput').addEventListener('keypress', function (event) {
        if (event.key === 'Enter') {
            performSearch();
        }
    });
let searchHistory = [];
let lastResults = [];

function addToHistory(query, count, time) {
    searchHistory.unshift({query, count, time});
    document.getElementById('historyList').innerHTML = searchHistory.map(item => `
        <div class="history-item" onclick="reloadSearch('${item.query.replace(/'/g, "\\'")}')">
            <div class="history-query">${item.query}</div>
            <div class="history-meta">${item.count} results · ${item.time}s</div>
        </div>
    `).join('');
}

function clearHistory() {
    searchHistory = [];
    document.getElementById('historyList').innerHTML = '<div class="empty-state">No searches yet</div>';
}

function reloadSearch(query) {
    document.getElementById('queryInput').value = query;
    performSearch();
}

function exportResults() {
    if (lastResults.length === 0) {
        alert('No results to export');
        return;
    }
    const blob = new Blob([JSON.stringify(lastResults, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.json';
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Display search results as enhanced cards with metadata
 */
function displayResults(results) {
    const resultsDiv = document.getElementById('results');

    if (results.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state">No results found</div>';
        return;
    }

    let html = '';
    results.forEach((result, idx) => {
        // Calculate similarity percentage from distance
        // Distance 0 = 100%, Distance 2 = 0%
        const similarity = ((1 - result.distance / 2) * 100).toFixed(1);

        // Extract metadata (with fallbacks)
        const source = result.metadata?.source || result.id;
        const page = result.metadata?.page;
        const chunkIndex = result.metadata?.chunk_index;

        html += `
            <div class="result-card">
                <div class="result-header">
                    <span class="result-rank">#${idx + 1}</span>
                    <span class="result-score">${similarity}% match</span>
                </div>
                <div class="result-metadata">
                    <span class="metadata-item">📄 ${escapeHtml(source)}</span>
                    ${page !== undefined ? `<span class="metadata-item">Page ${page}</span>` : ''}
                    ${chunkIndex !== undefined ? `<span class="metadata-item">Chunk ${chunkIndex}</span>` : ''}
                </div>
                <div class="result-text">${escapeHtml(result.text)}</div>
            </div>
        `;
    });

    resultsDiv.innerHTML = html;
}