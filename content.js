// content.js - 负责在当前页面执行搜索和点击操作
Date.prototype.Format = function(fmt) {
    var now = new Date();
    var localTime = new Date(now.getTime());
    var o = {
        "M+": localTime.getMonth() + 1,
        "d+": localTime.getDate(),
        "h+": localTime.getHours(),
        "m+": localTime.getMinutes(),
        "s+": localTime.getSeconds(),
        "q+": Math.floor((localTime.getMonth() + 3) / 3),
        "S": localTime.getMilliseconds()
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (localTime.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (var k in o)
        if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
    return fmt;
}
console.log("[CNKI] 加载 Content 脚本");

// ==================== 差异化命名：避免全局冲突 ====================
const CNKI_SITE_CONFIGS = [{
        name: "cnki.ccki.top",
        match: /cnki\.ccki\.top/,
        selectors: {
            searchInput: "#txt_search",
            searchButton: ".search-btn",
            resultTitle: ".result-table-list tbody tr:first-child td.name a.fz14"
        }
    },
    {
        name: "kns-cnki-net-443.wvpn.sjlib.cn",
        match: /kns-cnki-net-443\.wvpn\.sjlib\.cn/,
        selectors: {
            searchInput: "#txt_search",
            searchButton: ".search-btn",
            resultTitle: ".result-table-list tbody tr:first-child td.name a.fz14"
        }
    }
];

let CNKI_currentConfig = null;

function detectConfig() {
    const url = window.location.href;
    for (const config of CNKI_SITE_CONFIGS) {
        if (config.match.test(url)) {
            console.log(`[CNKI] 匹配站点: ${config.name}`);
            CNKI_currentConfig = config;
            return true;
        }
    }
    console.log("[CNKI] 当前页面不支持的站点:", url);
    return false;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForSelector(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el) return el;
        await sleep(500);
    }
    return null;
}

// ==================== 下载单个文献（搜索并触发浏览器下载） ====================
async function performSearchAndDownload(title) {
    console.log("[CNKI] 执行搜索并下载:", title);
    if (!CNKI_currentConfig) throw new Error("未检测到站点配置");
    const { searchInput, searchButton, resultTitle } = CNKI_currentConfig.selectors;

    const input = await waitForSelector(searchInput, 10000);
    if (!input) throw new Error(`未找到搜索框: ${searchInput}`);
    input.value = "";
    input.focus();
    input.value = title;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(5000);

    const btn = await waitForSelector(searchButton, 5000);
    if (!btn) throw new Error(`未找到搜索按钮: ${searchButton}`);
    btn.click();
    await sleep(5000);

    const resultTable = await waitForSelector(".result-table-list", 15000);
    if (!resultTable) throw new Error("未找到结果表格 .result-table-list");

    const firstResult = await waitForSelector(resultTitle, 5000);
    if (!firstResult) throw new Error(`未找到结果链接: ${resultTitle}`);
    const matchedTitle = firstResult.innerText.trim();
    console.log(`[CNKI] 匹配结果: ${matchedTitle}`);

    firstResult.click();
    await sleep(3000);
    chrome.runtime.sendMessage({
        action: "download_completed",
        title: title,
        matchedTitle: matchedTitle
    }).catch(console.error);
}

// ==================== 文献采集功能（知网 / Science） ====================
const CNKI_COLLECT_CONFIG = {
    maxPages: 10,
    retryInterval: 10000,
    maxRetries: 10
};

function isChineseTitle(title) {
    return /[\u4e00-\u9fff]/.test(title);
}

// 知网：获取当前页所有文献信息（标题、作者、来源、发表时间、数据库、被引）
function getCNKICollectItems() {
    const rows = document.querySelectorAll('.result-table-list tbody tr');
    const items = [];
    for (const row of rows) {
        const titleLink = row.querySelector('td.name a.fz14');
        if (!titleLink) continue;
        const title = titleLink.innerText.trim();
        const language = isChineseTitle(title) ? 'cn' : 'en';

        const authorCells = row.querySelectorAll('td.author a');
        const authors = Array.from(authorCells).map(a => a.innerText.trim()).join('; ');
        const sourceCell = row.querySelector('td.source p a');
        const source = sourceCell ? sourceCell.innerText.trim() : '';
        const dateCell = row.querySelector('td.date');
        const publishDate = dateCell ? dateCell.innerText.trim() : '';
        const dbCell = row.querySelector('td.data span');
        const database = dbCell ? dbCell.innerText.trim() : '';
        const quoteCell = row.querySelector('td.quote');
        const citations = quoteCell && quoteCell.innerText.trim() ? quoteCell.innerText.trim() : '0';

        items.push({
            title, authors, source, publishDate, database,
            citations: parseInt(citations) || 0,
            language
        });
    }
    console.log(`[知网采集] 本页共采集 ${items.length} 条文献`);
    return items;
}

async function goToCNKINextPage() {
    const nextBtn = document.querySelector('#PageNext');
    if (nextBtn && nextBtn.getAttribute('data-curpage')) {
        const curPage = parseInt(nextBtn.getAttribute('data-curpage'));
        const allPages = document.querySelectorAll('.pagesnums a');
        const totalPages = allPages.length;
        if (curPage >= totalPages) return false;
        nextBtn.click();
        return true;
    }
    const curLink = document.querySelector('.pagesnums a.cur');
    if (curLink && curLink.parentElement.nextElementSibling) {
        const nextLink = curLink.parentElement.nextElementSibling.querySelector('a');
        if (nextLink) {
            nextLink.click();
            return true;
        }
    }
    return false;
}

// Science：获取当前页文献信息
function getScienceCollectItems() {
    const selectors = [
        '.card.pb-3.mb-4.border-bottom',
        '.search-result__body .card',
        '.card.border-bottom',
        'article[data-testid="search-result"]'
    ];
    let cards = [];
    for (const sel of selectors) {
        cards = document.querySelectorAll(sel);
        if (cards.length > 0) break;
    }
    if (cards.length === 0) return [];

    const items = [];
    for (const card of cards) {
        const titleLink = card.querySelector('.article-title a');
        if (!titleLink) continue;
        const title = titleLink.innerText.trim();
        const language = isChineseTitle(title) ? 'cn' : 'en';

        let authors = '';
        const authorElems = card.querySelectorAll('.hlFld-ContribAuthor, .card-contribs .list-inline-item span');
        if (authorElems.length) authors = Array.from(authorElems).map(a => a.innerText.trim()).join('; ');

        let source = '';
        const sourceElem = card.querySelector('.card-meta__item:first-child');
        if (sourceElem) source = sourceElem.innerText.trim();

        let publishDate = '';
        const timeElem = card.querySelector('time');
        if (timeElem) publishDate = timeElem.getAttribute('datetime') || timeElem.innerText.trim();

        const database = source;
        const citations = 0;

        items.push({ title, authors, source, publishDate, database, citations, language });
    }
    console.log(`[Science采集] 本页共采集 ${items.length} 条文献`);
    return items;
}

async function goToScienceNextPage() {
    const nextSelectors = [
        '.page-item__arrow--next a',
        '.pagination .next a',
        'a[rel="next"]',
        '.pagination__nav .page-item:last-child a'
    ];
    let nextBtn = null;
    for (const sel of nextSelectors) {
        nextBtn = document.querySelector(sel);
        if (nextBtn && !nextBtn.parentElement.classList.contains('disabled')) break;
        nextBtn = null;
    }
    if (nextBtn) {
        nextBtn.click();
        return true;
    }
    return false;
}

async function waitForContentLoad(getItemsFunc) {
    for (let i = 0; i < CNKI_COLLECT_CONFIG.maxRetries; i++) {
        await sleep(2000);
        const items = getItemsFunc();
        if (items && items.length > 0) {
            console.log(`[采集] 第${i+1}次检查，找到${items.length}条文献`);
            return true;
        }
        const noResultMsg = document.querySelector('.no-results, .zero-results, .search-result__zero-results');
        if (noResultMsg) {
            console.log(`[采集] 检测到无结果提示，终止等待`);
            return false;
        }
        if (i < CNKI_COLLECT_CONFIG.maxRetries - 1) await sleep(CNKI_COLLECT_CONFIG.retryInterval);
    }
    return false;
}

// 执行批量采集（一个关键词，翻多页）
async function performCollect(keyword, siteType) {
    console.log(`[采集] 开始: ${keyword}, 站点: ${siteType}`);
    const currentUrl = window.location.href;
    if (siteType === 'cnki' && !currentUrl.includes('kns.cnki.net')) throw new Error("请打开知网主站 https://kns.cnki.net");
    if (siteType === 'science' && !currentUrl.includes('science.org')) throw new Error("请打开 Science 页面");

    let getItemsFunc, nextPageFunc;
    if (siteType === 'cnki') {
        getItemsFunc = getCNKICollectItems;
        nextPageFunc = goToCNKINextPage;
    } else {
        getItemsFunc = getScienceCollectItems;
        nextPageFunc = goToScienceNextPage;
    }

    const searchInput = document.querySelector('#txt_search, .quick-search__input');
    if (!searchInput) throw new Error("未找到搜索框");
    searchInput.value = '';
    searchInput.focus();
    searchInput.value = keyword;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(1000);

    const searchBtn = document.querySelector('.search-btn, .quick-search__btn, button[type="submit"]');
    if (!searchBtn) throw new Error("未找到搜索按钮");
    searchBtn.click();
    if (siteType === 'science') await sleep(3000);

    const loaded = await waitForContentLoad(getItemsFunc);
    if (!loaded) throw new Error("搜索结果加载超时");

    let allItems = [];
    let currentPage = 1;
    let hasNext = true;
    while (hasNext && currentPage <= CNKI_COLLECT_CONFIG.maxPages) {
        const items = getItemsFunc();
        allItems.push(...items);
        if (currentPage >= CNKI_COLLECT_CONFIG.maxPages) break;
        const clicked = await nextPageFunc();
        if (!clicked) break;
        await sleep(2000);
        const nextLoaded = await waitForContentLoad(getItemsFunc);
        if (!nextLoaded) break;
        currentPage++;
    }

    const uniqueMap = new Map();
    for (const item of allItems) {
        if (!uniqueMap.has(item.title)) uniqueMap.set(item.title, item);
    }
    const uniqueItems = Array.from(uniqueMap.values());
    console.log(`[采集] 完成，原始 ${allItems.length} 条，去重后 ${uniqueItems.length} 条`);
    return uniqueItems;
}

// ==================== 手动采集当前页（Science专用） ====================
async function getCurrentSciencePageInfo() {
    let keyword = '';
    const searchInput = document.querySelector('.quick-search__input, #AllField');
    if (searchInput && searchInput.value) keyword = searchInput.value.trim();
    if (!keyword) {
        const urlParams = new URLSearchParams(window.location.search);
        keyword = urlParams.get('AllField') || urlParams.get('keyword') || '';
        keyword = decodeURIComponent(keyword);
    }
    if (!keyword) throw new Error('无法获取关键词');

    let pageIndex = 1;
    const activePageLink = document.querySelector('.pagination .page-item.active .page-link');
    if (activePageLink) pageIndex = parseInt(activePageLink.innerText);
    else {
        const urlParams = new URLSearchParams(window.location.search);
        const startPageParam = urlParams.get('startPage');
        if (startPageParam !== null) pageIndex = parseInt(startPageParam) + 1;
    }

    const items = getScienceCollectItems();
    if (items.length === 0) throw new Error('当前页未检测到文献');
    return { keyword, pageIndex, items };
}

// ==================== 多语言辅助面板（知网镜像站） ====================
async function loadI18nForPanel() {
    return new Promise((resolve) => {
        if (window.i18n && window.i18n.initI18n) {
            resolve(window.i18n);
            return;
        }
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('i18n.js');
        script.onload = async () => {
            while (!window.i18n) await sleep(50);
            await window.i18n.initI18n();
            resolve(window.i18n);
            script.remove();
        };
        document.head.appendChild(script);
    });
}

(async function createAssistPanel() {
    const SUPPORTED_SITES = [
        { domain: 'cnki.ccki.top', pathPattern: '/kns8s' },
        { domain: 'kns-cnki-net-443.wvpn.sjlib.cn', pathPattern: '/kns8s' },
    ];
    function isSupported() {
        const url = window.location.href;
        for (const site of SUPPORTED_SITES) {
            if (url.includes(site.domain) && url.includes(site.pathPattern)) return true;
        }
        if ((url.includes('cnki.ccki.top') || url.includes('kns-cnki-net-443.wvpn.sjlib.cn')) && document.querySelector('#txt_search')) return true;
        return false;
    }
    if (!isSupported()) return;

    const i18n = await loadI18nForPanel();
    let currentPanel = null;

    function createPanel() {
        if (currentPanel) currentPanel.remove();
        const panel = document.createElement('div');
        panel.id = 'cnki-assist-panel';
        panel.style.cssText = `
            position: fixed; left: 10px; top: 100px; width: 350px; max-height: 80vh;
            background: #fff; border: 1px solid #ccc; border-radius: 8px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.2); z-index: 9999;
            display: flex; flex-direction: column; overflow: hidden;
            font-family: 'Microsoft YaHei', sans-serif; font-size: 14px; resize: both;
        `;
        const header = document.createElement('div');
        header.style.cssText = `padding: 8px 12px; background: #f5f5f5; border-bottom: 1px solid #ddd; font-weight: bold; cursor: move; display: flex; justify-content: space-between; align-items: center;`;
        header.innerHTML = `<span>${i18n.t('panel_title')}</span><span id="close-panel" style="cursor:pointer;">✕</span>`;
        panel.appendChild(header);

        const content = document.createElement('div');
        content.style.cssText = `padding: 12px; flex: 1; overflow-y: auto;`;
        content.innerHTML = `
            <div style="margin-bottom: 10px;">
                <label>${i18n.t('panel_label')}</label>
                <textarea id="title-batch-input" rows="6" style="width:100%; margin-top:5px; padding:4px; border:1px solid #ccc; border-radius:4px;"></textarea>
            </div>
            <div style="margin-bottom: 10px;">
                <button id="format-btn" style="background:#0078d7; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer;">${i18n.t('btn_format')}</button>
                <button id="clear-btn" style="background:#ccc; border:none; padding:6px 12px; border-radius:4px; margin-left:8px; cursor:pointer;">${i18n.t('btn_clear_list')}</button>
            </div>
            <div id="title-list-area" style="max-height: 400px; overflow-y: auto; border-top:1px solid #eee; padding-top:8px;">
                <div style="color:#999; text-align:center;">${i18n.t('btn_format')}</div>
            </div>
        `;
        panel.appendChild(content);
        document.body.appendChild(panel);
        currentPanel = panel;

        document.getElementById('close-panel')?.addEventListener('click', () => panel.remove());

        let isDragging = false, offsetX, offsetY;
        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'close-panel') return;
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
            panel.style.position = 'fixed';
            panel.style.margin = '0';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
        function onMouseMove(e) {
            if (isDragging) {
                panel.style.left = (e.clientX - offsetX) + 'px';
                panel.style.top = (e.clientY - offsetY) + 'px';
            }
        }
        function onMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        const processedTitles = new Set();
        document.getElementById('clear-btn')?.addEventListener('click', () => {
            const area = document.getElementById('title-list-area');
            if (area) area.innerHTML = `<div style="color:#999; text-align:center;">${i18n.t('btn_clear_list')}</div>`;
            document.getElementById('title-batch-input').value = '';
            processedTitles.clear();
        });

        document.getElementById('format-btn')?.addEventListener('click', () => {
            const raw = document.getElementById('title-batch-input').value;
            const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
            if (lines.length === 0) {
                alert(i18n.t('panel_label'));
                return;
            }
            const area = document.getElementById('title-list-area');
            area.innerHTML = '';
            lines.forEach((title) => {
                const itemDiv = document.createElement('div');
                itemDiv.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 13px;`;
                const titleSpan = document.createElement('span');
                titleSpan.style.flex = '1';
                titleSpan.textContent = title.length > 40 ? title.substr(0, 38) + '...' : title;
                titleSpan.title = title;
                const searchBtn = document.createElement('button');
                searchBtn.textContent = i18n.t('btn_search');
                searchBtn.style.cssText = `background: #28a745; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-left: 8px;`;
                const statusSpan = document.createElement('span');
                statusSpan.style.cssText = `margin-left: 8px; color: red; font-weight: bold; display: none;`;
                statusSpan.textContent = i18n.t('status_downloaded');

                searchBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const searchInput = document.querySelector('#txt_search');
                    if (!searchInput) {
                        alert(i18n.t('status_collect_error'));
                        return;
                    }
                    searchInput.value = '';
                    searchInput.focus();
                    searchInput.value = title;
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                    if (!processedTitles.has(title)) {
                        processedTitles.add(title);
                        statusSpan.style.display = 'inline';
                    }
                });
                itemDiv.appendChild(titleSpan);
                itemDiv.appendChild(searchBtn);
                itemDiv.appendChild(statusSpan);
                area.appendChild(itemDiv);
            });
        });
    }

    createPanel();
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "language_changed") createPanel();
    });
})();

// ==================== 消息监听（下载 / 采集） ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(`[content] 收到消息: ${message.action}`);

    if (message.action === "search_and_download") {
        if (!detectConfig()) {
            sendResponse({ status: "error", message: "当前页面不是支持的知网镜像站" });
            return true;
        }
        performSearchAndDownload(message.title)
            .then(() => sendResponse({ status: "success" }))
            .catch(err => sendResponse({ status: "error", message: err.message }));
        return true;
    }

    if (message.action === "collect_titles") {
        performCollect(message.keyword, message.siteType)
            .then(items => sendResponse({ success: true, titles: items }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (message.action === "collect_current_page_science") {
        getCurrentSciencePageInfo()
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    sendResponse({ status: "ok" });
});

// 页面就绪通知
if (detectConfig()) {
    chrome.runtime.sendMessage({ action: "cnki_page_ready", url: window.location.href }).catch(console.error);
}