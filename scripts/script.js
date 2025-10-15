// ===== Constants =====
const ITEMS_PER_PAGE = 6;
const MAX_CONCURRENT_REQUESTS = 3;
const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const BEST_NEWS_API = `${HN_API_BASE}/beststories.json`;
const LATEST_NEWS_API = `${HN_API_BASE}/topstories.json`;
const ITEM_API = (id) => `${HN_API_BASE}/item/${id}.json`;
const IMAGES = [
    '../assets/img-black.png',
    '../assets/img-green.png',
    '../assets/img-white.png'
];
const MIN_SCORE_LATEST = 0;

// ===== State =====
let bestNewsIds = [];
let latestNewsIds = [];
let bestNewsPage = 0;
let latestNewsPage = 0;
let bestNewsLoading = false;
let latestNewsLoading = false;

// ===== Utility Functions =====

/**
 * Get a deterministic image path based on item ID
 */
function getImageByID(id) {
    const hash = id % IMAGES.length;
    return IMAGES[hash];
}

/**
 * Format a Unix timestamp to relative time using Intl API or fallback
 */
function formatRelativeTime(unixTimestamp) {
    try {
        const rtf = new Intl.RelativeTimeFormat('en', {numeric: 'auto'});
        const now = Date.now();
        const postTime = unixTimestamp * 1000;
        const diffMs = now - postTime;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        const diffMonths = Math.floor(diffDays / 30);

        if (diffSecs < 60) return 'just now';
        if (diffMins < 60) return rtf.format(-diffMins, 'minute');
        if (diffHours < 24) return rtf.format(-diffHours, 'hour');
        if (diffDays < 30) return rtf.format(-diffDays, 'day');
        return rtf.format(-diffMonths, 'month');
    } catch {
        return formatRelativeTimeFallback(unixTimestamp);
    }
}

/**
 * Fallback relative time formatter for older browsers
 */
function formatRelativeTimeFallback(unixTimestamp) {
    const now = Date.now();
    const postTime = unixTimestamp * 1000;
    const diffMs = now - postTime;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) {
        return 'just now';
    } else if (diffMins < 60) {
        return diffMins === 1 ? '1 minute ago' : `${diffMins} minutes ago`;
    } else if (diffHours < 24) {
        return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    } else if (diffDays < 30) {
        return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
    } else {
        const diffMonths = Math.floor(diffDays / 30);
        return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
    }
}

/**
 * Extract domain from URL, removing www. if present
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;
        if (hostname.startsWith('www.')) {
            hostname = hostname.slice(4);
        }
        return hostname;
    } catch (error) {
        console.error('Error parsing URL:', url, error);
        return 'unknown';
    }
}

/**
 * Fetch data from API
 */
async function fetchFromAPI(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error('Error fetching from API:', error);
        return [];
    }
}

/**
 * Fetch individual item details from HackerNews API
 */
async function fetchItemDetails(id) {
    try {
        const res = await fetch(ITEM_API(id));
        if (!res.ok) throw new Error(`Failed to fetch item ${id}`);
        return await res.json();
    } catch (error) {
        console.error(`Error fetching item ${id}:`, error);
        return null;
    }
}

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHTML(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Fetch multiple items with controlled concurrency using batch processing.
 * Processes items in chunks of MAX_CONCURRENT_REQUESTS, rendering each valid item
 * immediately as it arrives, and updating the UI after all items in the batch are processed.
 */
async function fetchItemsWithConcurrency(ids, onItemFetched, onBatchComplete) {
    let validItemsCount = 0;

    // Process IDs in batches of MAX_CONCURRENT_REQUESTS
    for (let i = 0; i < ids.length; i += MAX_CONCURRENT_REQUESTS) {
        const batchIds = ids.slice(i, i + MAX_CONCURRENT_REQUESTS);

        // Fetch all items in this batch in parallel
        const batchPromises = batchIds.map(id => fetchItemDetails(id));
        const batchItems = await Promise.all(batchPromises);

        // Process each item from this batch
        batchItems.forEach(item => {
            if (item && onItemFetched(item)) {
                validItemsCount++;
            }
        });
    }

    // Call completion handler with count of valid items
    onBatchComplete(validItemsCount);
}

// ===== Data Loading (Batch-based with streaming) =====

/**
 * Load initial best news IDs and fetch first batch
 */
async function initializeBestNews() {
    const ids = await fetchFromAPI(BEST_NEWS_API);
    if (!ids || ids.length === 0) {
        console.error('Failed to load best news IDs');
        return;
    }
    bestNewsIds = ids;
    bestNewsPage = 0;
    await loadMoreBestNews();
}

/**
 * Load initial latest news IDs and fetch first batch
 */
async function initializeLatestNews() {
    const ids = await fetchFromAPI(LATEST_NEWS_API);
    if (!ids || ids.length === 0) {
        console.error('Failed to load latest news IDs');
        return;
    }
    latestNewsIds = ids;
    latestNewsPage = 0;
    await loadMoreLatestNews();
}

/**
 * Fetch and render next batch of best news with streaming and concurrency control.
 * Each item is rendered immediately as it arrives. The button is updated after all
 * items in the batch have been processed.
 */
async function loadMoreBestNews() {
    if (bestNewsLoading || bestNewsPage * ITEMS_PER_PAGE >= bestNewsIds.length) {
        return;
    }

    bestNewsLoading = true;

    const startIndex = bestNewsPage * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const batchIds = bestNewsIds.slice(startIndex, endIndex);

    // Define callback for when a valid item is fetched
    const onItemFetched = (item) => {
        if (item.type === 'story' && item.url) {
            renderBestNewsItem(item);
            return true; // Item was valid and rendered
        }
        return false; // Item was not valid
    };

    // Define callback for when batch is complete
    const onBatchComplete = () => {
        updateBestNewsLoadButton();
    };

    // Fetch items with concurrency control
    await fetchItemsWithConcurrency(batchIds, onItemFetched, onBatchComplete);

    bestNewsPage++;
    bestNewsLoading = false;
}

/**
 * Fetch and render next batch of latest news with streaming and concurrency control.
 * Each item is rendered immediately as it arrives. The button is updated after all
 * items in the batch have been processed.
 */
async function loadMoreLatestNews() {
    if (latestNewsLoading || latestNewsPage * ITEMS_PER_PAGE >= latestNewsIds.length) {
        return;
    }

    latestNewsLoading = true;

    const startIndex = latestNewsPage * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const batchIds = latestNewsIds.slice(startIndex, endIndex);

    // Define callback for when a valid item is fetched
    const onItemFetched = (item) => {
        if (item.type === 'story' && item.url && (item.score || 0) >= MIN_SCORE_LATEST) {
            renderLatestNewsItem(item);
            return true; // Item was valid and rendered
        }
        return false; // Item was not valid
    };

    // Define callback for when batch is complete
    const onBatchComplete = () => {
        updateLatestNewsLoadButton();
    };

    // Fetch items with concurrency control
    await fetchItemsWithConcurrency(batchIds, onItemFetched, onBatchComplete);

    latestNewsPage++;
    latestNewsLoading = false;
}

// ===== Rendering Functions =====

/**
 * Render a single best news item immediately to the gallery.
 * Item is added to the DOM as soon as it arrives.
 */
function renderBestNewsItem(item) {
    const gallery = document.querySelector('.gallery');

    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'item';

    const imageUrl = getImageByID(item.id);
    const dateStr = formatRelativeTime(item.time);

    link.innerHTML = `
    <img src="${imageUrl}" alt="Article: ${escapeHTML(item.title)}" loading="lazy">
    <div class="text-container">
      <div class="best-title">${escapeHTML(item.title)}</div>
      <div class="date">${dateStr}</div>
    </div>
  `;

    gallery.appendChild(link);
}

/**
 * Update best news load button visibility.
 * Button is hidden when all IDs have been fetched and processed.
 * Uses actual rendered items to account for filtered items.
 */
function updateBestNewsLoadButton() {
    const loadBtn = document.getElementById('loadMoreBest');
    const gallery = document.querySelector('.gallery');
    const renderedItems = gallery.querySelectorAll('.item').length;
    const totalProcessedIds = (bestNewsPage + 1) * ITEMS_PER_PAGE;

    // Show button if we haven't processed all IDs yet
    const hasMore = totalProcessedIds < bestNewsIds.length;

    loadBtn.style.display = hasMore ? 'block' : 'none';
}

/**
 * Render a single latest news item immediately to the list.
 * Item is added to the DOM as soon as it arrives.
 */
function renderLatestNewsItem(item) {
    const list = document.querySelector('.list');

    const li = document.createElement('li');
    const dateStr = formatRelativeTime(item.time);
    const domain = extractDomain(item.url);

    li.innerHTML = `
    <div class="latest-title">${escapeHTML(item.title)}</div>
    <div class="info">
      <div class="date">${dateStr}</div>
      <a href="${item.url}" target="_blank" rel="noopener noreferrer">(${domain})</a>
    </div>
  `;

    list.appendChild(li);
}

/**
 * Update latest news load button visibility.
 * Button is hidden when all IDs have been fetched and processed.
 * Uses actual rendered items to account for filtered items.
 */
function updateLatestNewsLoadButton() {
    const loadBtn = document.getElementById('loadMoreLatest');
    const list = document.querySelector('.list');
    const renderedItems = list.querySelectorAll('li').length;
    const totalProcessedIds = (latestNewsPage + 1) * ITEMS_PER_PAGE;

    // Show button if we haven't processed all IDs yet
    const hasMore = totalProcessedIds < latestNewsIds.length;

    loadBtn.style.display = hasMore ? 'block' : 'none';
}

// ===== Event Handlers =====

function handleLoadMoreBest() {
    loadMoreBestNews();
}

function handleLoadMoreLatest() {
    loadMoreLatestNews();
}

// ===== Initialization =====

async function init() {
    // Initialize both sections simultaneously
    await Promise.all([
        initializeBestNews(),
        initializeLatestNews()
    ]);

    // Attach event listeners
    document.getElementById('loadMoreBest').addEventListener('click', handleLoadMoreBest);
    document.getElementById('loadMoreLatest').addEventListener('click', handleLoadMoreLatest);
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}