// Store searches in memory (clears on page refresh)
let questionHistory = [];
let currentResults = [];  // Track current results for export

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

        console.log(data.results[0]);
        displayResults(data.results);

        // Store results and add to history
        currentResults = data.results;
        addToHistory(query, data.results);

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


function reloadSearch(query) {
    document.getElementById('queryInput').value = query;
    performSearch();
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

/**
 * Add a search to the history
 */
function addToHistory(question, results) {
    questionHistory.push({
        question: question,
        results: results,
        count: results.length,
        timestamp: new Date()
    });
    renderHistory();
}

/**
 * Render the history list in the left panel
 */
function renderHistory() {
    const historyList = document.getElementById('historyList');

    if (questionHistory.length === 0) {
        historyList.innerHTML = '<div class="empty-state">No searches yet</div>';
        return;
    }

    // Display newest first (reverse order)
    const html = questionHistory.map((entry, index) => {
        // Truncate long questions
        const displayQuestion = entry.question.length > 100
            ? entry.question.substring(0, 100) + '...'
            : entry.question;

        return `
            <div class="history-item" onclick="loadHistoryItem(${index})">
                <div class="history-question">${escapeHtml(displayQuestion)}</div>
                <div class="history-meta">
                    <span>${entry.count} results</span>
                    <span>${entry.timestamp.toLocaleTimeString()}</span>
                </div>
            </div>
        `;
    }).reverse().join('');

    historyList.innerHTML = html;
}

/**
 * Load a previous search from history
 */
function loadHistoryItem(index) {
    const entry = questionHistory[index];

    // Restore the query to the input
    document.getElementById('queryInput').value = entry.question;

    // Update current results for export
    currentResults = entry.results;

    // Display the results
    displayResults(entry.results);
}

/**
 * Clear all search history
 */
function clearHistory() {
    if (confirm('Clear all search history?')) {
        questionHistory = [];
        currentResults = [];
        renderHistory();

        // Reset results display
        document.getElementById('results').innerHTML =
            '<div class="empty-state">Enter a query to search</div>';
    }
}


/**
 * Export current results as JSON file
 */
function exportResults() {
    if (currentResults.length === 0) {
        alert('No results to export. Perform a search first.');
        return;
    }

    // Create JSON string with nice formatting
    const dataStr = JSON.stringify(currentResults, null, 2);

    // Create blob and download link
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create temporary link and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-results-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up
    URL.revokeObjectURL(url);
}