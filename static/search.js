// Store searches in memory (clears on page refresh)
let questionHistory = [];
let currentResults = [];  // Track current results for export

// Q11: Default system prompt (matches rag.py DEFAULT_SYSTEM_PROMPT)
const DEFAULT_SYSTEM_PROMPT = `You are a knowledgeable and helpful assistant that answers questions using only the context documents provided to you.

Guidelines:
1. Base your answer strictly on the provided context. Do not use outside knowledge.
2. When referencing information, cite the source document by name (e.g., 'According to [source]...' or 'As stated in [source]...').
3. If the context contains partial information, share what is available and clearly note what is missing or unclear.
4. If the context does not contain enough information to answer the question, say so honestly and directly — do not guess or fabricate an answer.
5. Keep your tone professional, clear, and concise.
6. If multiple sources agree or disagree, note that in your response.`;

// Q11: Load system prompt from localStorage on page load
function loadSystemPrompt() {
    const saved = localStorage.getItem('systemPrompt');
    const textarea = document.getElementById('systemPrompt');
    if (saved !== null) {
        textarea.value = saved;
    } else {
        textarea.value = DEFAULT_SYSTEM_PROMPT;
    }
}

// Q11: Save system prompt to localStorage
function saveSystemPrompt() {
    const prompt = document.getElementById('systemPrompt').value;
    localStorage.setItem('systemPrompt', prompt);
    alert('System prompt saved!');
}

// Q11: Reset system prompt to default
function resetSystemPrompt() {
    document.getElementById('systemPrompt').value = DEFAULT_SYSTEM_PROMPT;
    localStorage.setItem('systemPrompt', DEFAULT_SYSTEM_PROMPT);
}

// Q11: Get the current system prompt value
function getSystemPrompt() {
    return document.getElementById('systemPrompt').value.trim() || DEFAULT_SYSTEM_PROMPT;
}

// Initialize system prompt on page load
document.addEventListener('DOMContentLoaded', loadSystemPrompt);


function determineMethod(useHybrid, useReranking) {
    if (useHybrid && useReranking) return 'Hybrid + Reranking';
    if (useHybrid) return 'Hybrid';
    if (useReranking) return 'Semantic + Reranking';
    return 'Semantic Only';
}

function displayMetrics(method, count, duration) {
    document.getElementById('methodValue').textContent = method;
    document.getElementById('countValue').textContent = count;
    document.getElementById('timeValue').textContent = `${duration}s`;
}


async function performSearch() {
    const query = document.getElementById('queryInput').value;
    const useHybrid = document.getElementById('useHybrid').checked;
    const useReranking = document.getElementById('useReranking').checked;
    const nResults = parseInt(document.getElementById('numResults').value, 10) || 5;

    const startTime = performance.now();
    const resultsDiv = document.getElementById('results');
    const searchButton = document.getElementById('searchButton');

    if (!query.trim()) {
        resultsDiv.innerHTML = '<p class="error">Please enter a search query</p>';
        return;
    }

    resultsDiv.innerHTML = '<p class="loading">Searching...</p>';
    searchButton.disabled = true;

    try {
        const response = await fetch('/search', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                query,
                n_results: nResults,
                use_hybrid: useHybrid,
                use_reranking: useReranking
            })
        });

        const data = await response.json();

        if (!response.ok) {
            resultsDiv.innerHTML = `<p class="error">Error: ${data.detail}</p>`;
            searchButton.disabled = false;
            return;
        }

        if (data.results.length === 0) {
            resultsDiv.innerHTML = '<p class="no-results">No results found</p>';
            searchButton.disabled = false;
            return;
        }

        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        const method = determineMethod(useHybrid, useReranking);
        displayMetrics(method, data.results.length, elapsed);

        displayResults(data.results);

        // Store results and add to history
        currentResults = data.results;
        addToHistory(query, data.results);

        searchButton.disabled = false;

    } catch (error) {
        resultsDiv.innerHTML = `<p class="error">Failed to connect to server</p>`;
        searchButton.disabled = false;
    }
}

// Q11: RAG query function that passes the custom system prompt
async function performRAGQuery(question) {
    const systemPrompt = getSystemPrompt();
    const nResults = parseInt(document.getElementById('numResults').value, 10) || 3;

    const response = await fetch('/rag', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            question: question,
            n_context_docs: Math.min(nResults, 10),
            temperature: 0.7,
            system_prompt: systemPrompt  // Q11: send custom system prompt
        })
    });

    return await response.json();
}


// Get health status from the server and show it in the health-status div
async function displayHealth() {
    try {
        const result = document.getElementById('health-status');
        result.innerHTML = `<p>Hmm...let me see</p>`;
        const response = await fetch('/health');
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
document.getElementById('queryInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        performSearch();
    }
});


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
        const similarity = ((1 - result.distance / 2) * 100).toFixed(1);
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

    const html = questionHistory.map((entry, index) => {
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
    document.getElementById('queryInput').value = entry.question;
    currentResults = entry.results;
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

    const dataStr = JSON.stringify(currentResults, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `search-results-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

// ===== PROMPT PREVIEW =====

function formatContextDocs(results) {
    if (!results || results.length === 0) return "(no context retrieved)";
    return results.map((r, i) => {
        const source = r.metadata?.source || r.id || `Doc ${i+1}`;
        return `--- [${i+1}] ${source} ---\n${r.text}`;
    }).join("\n\n");
}

function addPromptSection(container, title, text) {
    const section = document.createElement("div");
    section.style.marginBottom = "12px";

    const h = document.createElement("h4");
    h.textContent = title;
    h.style.margin = "0 0 6px 0";

    const pre = document.createElement("pre");
    pre.textContent = text;
    pre.style.whiteSpace = "pre-wrap";
    pre.style.background = "#f6f8fa";
    pre.style.padding = "10px";
    pre.style.borderRadius = "8px";
    pre.style.border = "1px solid #ddd";

    section.appendChild(h);
    section.appendChild(pre);
    container.appendChild(section);
}

function showPromptPreview() {
    const modal = document.getElementById("promptPreviewModal");
    const body = document.getElementById("promptPreviewBody");

    const systemPrompt = getSystemPrompt();
    const question = document.getElementById("queryInput").value.trim();
    const context = formatContextDocs(currentResults);

    body.innerHTML = "";

    addPromptSection(body, "System Prompt", systemPrompt);
    addPromptSection(body, "Context Documents", context);
    addPromptSection(body, "User Question", question);

    const finalPrompt =
        "SYSTEM:\n" + systemPrompt +
        "\n\nCONTEXT DOCUMENTS:\n" + context +
        "\n\nUSER QUESTION:\n" + question;

    addPromptSection(body, "Final Prompt (sent to LLM)", finalPrompt);

    modal.showModal();
}

function closePromptPreview() {
    document.getElementById("promptPreviewModal").close();
}