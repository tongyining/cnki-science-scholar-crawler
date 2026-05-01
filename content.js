// content.js - 负责在当前页面执行搜索和点击操作
// console.log(,"",new Date().Format("yyyy-MM-dd hh:mm:ss"))
Date.prototype.Format = function(fmt) {
    // 获取当前时间
    var now = new Date();
    // 获取当前时区偏移量（分钟数）
    var timezoneOffset = 720//now.getTimezoneOffset();
    // 创建新的 Date 对象，加上时区偏移量
    // var localTime = new Date(now.getTime() + timezoneOffset * 60 * 1000);
    var localTime = new Date(now.getTime());
    // var time=localTime.getMonth()+1+"月"+localTime.getDate()+"日"+localTime.getHours()+"点"+localTime.getMinutes()+"分";
    // console.log(time)
    var o = {
        "M+": localTime.getMonth() + 1, //月份 
        "d+": localTime.getDate(), //日 
        "h+": localTime.getHours(), //小时 
        "m+": localTime.getMinutes(), //分 
        "s+": localTime.getSeconds(), //秒 
        "q+": Math.floor((localTime.getMonth() + 3) / 3), //季度 
        "S": localTime.getMilliseconds() //毫秒 
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (localTime.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (var k in o)
        if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
    return fmt;
}
console.log(27,"[CNKI] 加载Content文件 ");

// 站点配置：根据 URL 匹配选择器
const SITE_CONFIGS = [{
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
    // 可以继续添加其他镜像站配置
];

let currentConfig = null;

function detectConfig() {
    const url = window.location.href;
    console.log(55,"匹配站点",url,new Date().Format("yyyy-MM-dd hh:mm:ss"))
    for (const config of SITE_CONFIGS) {
        if (config.match.test(url)) {
            console.log(`[CNKI] 匹配站点: ${config.name}`);
            currentConfig = config;
            return true;
        }
    }
    console.log("[CNKI] 当前页面不支持的站点:", url);
    return false;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForSelector(selector, timeout = 10000) {
    const start = Date.now();
    console.log(71,"等待元素出现",new Date().Format("yyyy-MM-dd hh:mm:ss"))
    while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el) return el;
        await sleep(500);
    }
    return null;
}

// 执行搜索并点击下载
async function performSearchAndDownload(title) {
    console.log(82,"执行搜索并点击下载",new Date().Format("yyyy-MM-dd hh:mm:ss"));
    if (!currentConfig) {
        throw new Error("未检测到站点配置");
    }
    const {
        searchInput,
        searchButton,
        resultTitle
    } = currentConfig.selectors;

    // 1. 输入标题
    const input = await waitForSelector(searchInput, 10000);
    if (!input) throw new Error(`未找到搜索框: ${searchInput}`);
    input.value = "";
    input.focus();
    input.value = title;
    input.dispatchEvent(new Event("input", {
        bubbles: true
    }));
    console.log(101,"[CNKI] 已输入关键词");
    await sleep(5000);

    // 2. 点击搜索
    const btn = await waitForSelector(searchButton, 5000);
    if (!btn) throw new Error(`未找到搜索按钮: ${searchButton}`);
    btn.click();
    console.log(108,"[CNKI] 已点击搜索按钮");
    await sleep(5000);

    // 3. 等待结果表格
    const resultTable = await waitForSelector(".result-table-list", 15000);
    if (!resultTable) throw new Error("未找到结果表格 .result-table-list");

    // 4. 获取第一个结果链接
    const firstResult = await waitForSelector(resultTitle, 5000);
    if (!firstResult) throw new Error(`未找到结果链接: ${resultTitle}`);
    const matchedTitle = firstResult.innerText.trim();
    console.log(119,`[CNKI] 匹配结果: ${matchedTitle}`);

    // 5. 点击下载
    firstResult.click();
    console.log(123,"[CNKI] 已点击标题链接，等待下载完成");
    await sleep(3000);
    console.log(125,"通知 background 下载已触发",new Date().Format("yyyy-MM-dd hh:mm:ss"));
    // 6. 通知 background 下载已触发
    chrome.runtime.sendMessage({
        action: "download_completed",
        title: title,
        matchedTitle: matchedTitle
    }).catch(console.error);
}

// 监听来自 background 的消息
// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//     console.log(136,"监听来自 background 的消息",new Date().Format("yyyy-MM-dd hh:mm:ss"));
//     if (message.action === "search_and_download") {
//         console.log(138,`[CNKI] 收到搜索指令: ${message.title}`);
//         if (!detectConfig()) {
//             sendResponse({
//                 status: "error",
//                 message: "当前页面不是支持的知网镜像站"
//             });
//             return true;
//         }
//         console.log(146,"检查下载",new Date().Format("yyyy-MM-dd hh:mm:ss"));
//         performSearchAndDownload(message.title)
//             .then(() => sendResponse({
//                 status: "success"
//             }))
//             .catch(err => sendResponse({
//                 status: "error",
//                 message: err.message
//             }));
//         return true; // 异步响应
//     }
//     else if (message.action === "collect_titles") {
//         console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 收到采集命令: ${message.keyword}, 站点: ${message.siteType}`);
//         performCollect(message.keyword, message.siteType)
//             .then(titles => {
//                 console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 采集成功，返回 ${titles.length} 条文献`);
//                 sendResponse({ success: true, titles: titles });
//             })
//             .catch(err => {
//                 console.error(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 采集失败:`, err);
//                 sendResponse({ success: false, error: err.message });
//             });
//         return true; // 异步响应
//     }
//     sendResponse({
//         status: "ok"
//     });
// });
// ==================== 新增：标题采集功能 ====================

// 采集配置
const COLLECT_CONFIG = {
    maxPages: 10,
    retryInterval: 10000,  // 10秒
    maxRetries: 10
};

function isChineseTitle(title) {
    return /[\u4e00-\u9fff]/.test(title);
}

// 知网：获取当前页标题列表
// 知网：获取当前页所有文献信息（标题、作者、来源、发表时间、数据库、被引）
// 知网：获取当前页所有文献信息（标题、作者、来源、发表时间、数据库、被引）
function getCNKICollectItems() {
    const rows = document.querySelectorAll('.result-table-list tbody tr');
    const items = [];
    for (const row of rows) {
        // 标题
        const titleLink = row.querySelector('td.name a.fz14');
        if (!titleLink) continue;
        const title = titleLink.innerText.trim();
        
        // 动态识别语言：如果标题不含中文字符，则认为是英文文献
        const language = isChineseTitle(title) ? 'cn' : 'en';
        console.log(`[知网采集] 标题: ${title.substring(0, 50)}... 语言判定: ${language}`);
        
        // 作者
        const authorCells = row.querySelectorAll('td.author a');
        const authors = Array.from(authorCells).map(a => a.innerText.trim()).join('; ');
        
        // 来源（期刊/会议）
        const sourceCell = row.querySelector('td.source p a');
        const source = sourceCell ? sourceCell.innerText.trim() : '';
        
        // 发表时间
        const dateCell = row.querySelector('td.date');
        const publishDate = dateCell ? dateCell.innerText.trim() : '';
        
        // 数据库
        const dbCell = row.querySelector('td.data span');
        const database = dbCell ? dbCell.innerText.trim() : '';
        
        // 被引次数
        const quoteCell = row.querySelector('td.quote');
        const citations = quoteCell && quoteCell.innerText.trim() ? quoteCell.innerText.trim() : '0';
        
        items.push({
            title,
            authors,
            source,
            publishDate,
            database,
            citations: parseInt(citations) || 0,
            language: language
        });
    }
    console.log(`[知网采集] 本页共采集 ${items.length} 条文献，其中中文 ${items.filter(i => i.language === 'cn').length} 条，英文 ${items.filter(i => i.language === 'en').length} 条`);
    return items;
}

// 知网：翻到下一页
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

// Science：获取当前页标题列表
// Science：获取当前页所有文献信息
// Science：获取当前页所有文献信息（增强版）
function getScienceCollectItems() {
    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 开始提取当前页文献`);
    // 尝试多种可能的卡片选择器
    const selectors = [
        '.card.pb-3.mb-4.border-bottom',
        '.search-result__body .card',
        '.card.border-bottom',
        'article[data-testid="search-result"]' // 备用
    ];
    let cards = [];
    for (const sel of selectors) {
        cards = document.querySelectorAll(sel);
        if (cards.length > 0) {
            console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 使用选择器 "${sel}" 找到 ${cards.length} 个卡片`);
            break;
        }
    }
    if (cards.length === 0) {
        console.warn(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 未找到任何文献卡片，页面可能未加载完成或结构变化`);
        return [];
    }

    const items = [];
    for (const card of cards) {
        // 标题
        const titleLink = card.querySelector('.article-title a');
        if (!titleLink) {
            console.warn(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 跳过无标题的卡片`);
            continue;
        }
        const title = titleLink.innerText.trim();
        
        // 动态识别语言
        const language = isChineseTitle(title) ? 'cn' : 'en';
        
        // 作者（支持多种结构）
        let authors = '';
        const authorElems = card.querySelectorAll('.hlFld-ContribAuthor, .card-contribs .list-inline-item span');
        if (authorElems.length) {
            authors = Array.from(authorElems).map(a => a.innerText.trim()).join('; ');
        }
        
        // 期刊/来源
        let source = '';
        const sourceElem = card.querySelector('.card-meta__item:first-child');
        if (sourceElem) source = sourceElem.innerText.trim();
        
        // 发表时间
        let publishDate = '';
        const timeElem = card.querySelector('time');
        if (timeElem) publishDate = timeElem.getAttribute('datetime') || timeElem.innerText.trim();
        
        // 数据库（Science 无此字段，填入来源）
        const database = source;
        
        // 被引次数（暂不支持）
        const citations = 0;
        
        items.push({
            title, authors, source, publishDate, database, citations, language
        });
    }
    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 本页共采集 ${items.length} 条文献`);
    return items;
}

// Science：翻到下一页
// Science：翻到下一页（增强版）
async function goToScienceNextPage() {
    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 尝试翻页`);
    // 多种下一页选择器
    const nextSelectors = [
        '.page-item__arrow--next a',
        '.pagination .next a',
        'a[rel="next"]',
        '.pagination__nav .page-item:last-child a'
    ];
    let nextBtn = null;
    for (const sel of nextSelectors) {
        nextBtn = document.querySelector(sel);
        if (nextBtn && !nextBtn.parentElement.classList.contains('disabled')) {
            console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 使用选择器 "${sel}" 找到下一页按钮`);
            break;
        }
        nextBtn = null;
    }
    if (nextBtn) {
        nextBtn.click();
        console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 已点击下一页`);
        return true;
    }
    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [Science采集] 未找到下一页按钮，可能已是最后一页`);
    return false;
}

// 等待页面内容加载完成（带重试）
// 修改 waitForContentLoad 以接受获取 items 的函数（原 getTitlesFunc 实际获取的是 items）
async function waitForContentLoad(getItemsFunc) {
    for (let i = 0; i < COLLECT_CONFIG.maxRetries; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const items = getItemsFunc();
        if (items && items.length > 0) {
            console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [采集] 第${i+1}次检查，找到${items.length}条文献`);
            return true;
        }
        // 检查是否有“无结果”提示（Science 常见）
        const noResultMsg = document.querySelector('.no-results, .zero-results, .search-result__zero-results');
        if (noResultMsg) {
            console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [采集] 检测到无结果提示，终止等待`);
            return false;
        }
        console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [采集] 第${i+1}次检查，未找到文献，剩余${COLLECT_CONFIG.maxRetries - i - 1}次`);
        if (i < COLLECT_CONFIG.maxRetries - 1) {
            await new Promise(r => setTimeout(r, COLLECT_CONFIG.retryInterval));
        }
    }
    return false;
}

// 执行采集（搜索关键词、翻页、收集标题）
async function performCollect(keyword, siteType) {
    console.log(`[采集] 开始采集关键词: ${keyword}, 站点: ${siteType}`);
    
    // 站点验证（略，保持原有）
    const currentUrl = window.location.href;
    if (siteType === 'cnki' && !currentUrl.includes('kns.cnki.net')) {
        throw new Error("采集知网文献请打开 https://kns.cnki.net 主站页面");
    }
    if (siteType === 'science' && !currentUrl.includes('science.org')) {
        throw new Error("采集 Science 文献请打开 https://www.science.org 页面");
    }
    
    let getItemsFunc, nextPageFunc;
    if (siteType === 'cnki') {
        getItemsFunc = getCNKICollectItems;
        nextPageFunc = goToCNKINextPage;
    } else {
        getItemsFunc = getScienceCollectItems;
        nextPageFunc = goToScienceNextPage;
    }
    
    // 1. 清空并输入关键词
    const searchInput = document.querySelector('#txt_search, .quick-search__input');
    if (!searchInput) throw new Error("未找到搜索框");
    searchInput.value = '';
    searchInput.focus();
    searchInput.value = keyword;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    console.log(`[采集] 已输入关键词: ${keyword}`);
    await new Promise(r => setTimeout(r, 1000));
    
    // 2. 点击搜索
    const searchBtn = document.querySelector('.search-btn, .quick-search__btn, button[type="submit"]');
    if (!searchBtn) throw new Error("未找到搜索按钮");
    searchBtn.click();
    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [采集] 已点击搜索按钮`);
    // 为 Science 增加额外等待，防止立即检查时结果还未开始加载
    if (siteType === 'science') {
        await new Promise(r => setTimeout(r, 3000));
    }
    
    // 3. 等待搜索结果加载
    const loaded = await waitForContentLoad(getItemsFunc);
    if (!loaded) throw new Error("搜索结果加载超时");
    
    // 4. 采集所有页的文献对象
    let allItems = [];   // 修正：声明变量
    let currentPage = 1;
    let hasNext = true;
    
    while (hasNext && currentPage <= COLLECT_CONFIG.maxPages) {
        console.log(`[采集] 采集第${currentPage}页...`);
        const items = getItemsFunc();
        console.log(`[采集] 第${currentPage}页获取到${items.length}条文献`);
        allItems.push(...items);
        
        if (currentPage >= COLLECT_CONFIG.maxPages) break;
        
        const clicked = await nextPageFunc();
        if (!clicked) {
            console.log(`[采集] 没有下一页`);
            break;
        }
        await new Promise(r => setTimeout(r, 2000));
        const nextLoaded = await waitForContentLoad(getItemsFunc);
        if (!nextLoaded) {
            console.log(`[采集] 下一页加载超时`);
            break;
        }
        currentPage++;
    }
    
    // 按标题去重
    const uniqueMap = new Map();
    for (const item of allItems) {
        if (!uniqueMap.has(item.title)) {
            uniqueMap.set(item.title, item);
        }
    }
    const uniqueItems = Array.from(uniqueMap.values());
    console.log(`[采集] 完成，共获取${allItems.length}条，去重后${uniqueItems.length}条`);
    return uniqueItems;
}


// ========== 新增：手动采集当前页（Science） ==========

/**
 * 获取当前 Science 结果页的信息：关键词、页码、本页所有文献
 * @returns {Promise<{keyword: string, pageIndex: number, items: Array}>}
 */
async function getCurrentSciencePageInfo() {
    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [手动采集] 开始获取当前页信息`);

    // 1. 获取关键词（优先从搜索框取值）
    let keyword = '';
    const searchInput = document.querySelector('.quick-search__input, #AllField');
    if (searchInput && searchInput.value) {
        keyword = searchInput.value.trim();
    }
    // 如果搜索框为空，尝试从 URL 参数解析
    if (!keyword) {
        const urlParams = new URLSearchParams(window.location.search);
        keyword = urlParams.get('AllField') || urlParams.get('keyword') || '';
        keyword = decodeURIComponent(keyword);
    }
    if (!keyword) {
        throw new Error('无法自动获取关键词，请确保搜索框内有内容或 URL 包含参数');
    }
    console.log(`[手动采集] 关键词：${keyword}`);

    // 2. 获取当前页码
    let pageIndex = 1; // 默认第1页
    // 尝试从分页高亮获取
    const activePageLink = document.querySelector('.pagination .page-item.active .page-link');
    if (activePageLink) {
        pageIndex = parseInt(activePageLink.innerText);
    } else {
        // 从 URL 参数 startPage 获取（science 的 startPage 从 0 开始）
        const urlParams = new URLSearchParams(window.location.search);
        const startPageParam = urlParams.get('startPage');
        if (startPageParam !== null) {
            pageIndex = parseInt(startPageParam) + 1;
        }
    }
    console.log(`[手动采集] 当前页码：${pageIndex}`);

    // 3. 获取本页所有文献（复用已有函数）
    const items = getScienceCollectItems(); // 该函数已经存在
    if (items.length === 0) {
        throw new Error('当前页面未检测到任何文献，请确认是否在 Science 搜索结果页');
    }
    console.log(`[手动采集] 本页共获取 ${items.length} 条文献`);

    return { keyword, pageIndex, items };
}

// 监听来自 popup 的“手动采集当前页”指令
// 合并后的消息监听器（取代原有的所有 onMessage 监听）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 收到消息:`, message.action);

    // 1. 处理知网下载搜索指令
    if (message.action === "search_and_download") {
        console.log(`[CNKI] 收到搜索指令: ${message.title}`);
        if (!detectConfig()) {
            sendResponse({ status: "error", message: "当前页面不是支持的知网镜像站" });
            return true;
        }
        performSearchAndDownload(message.title)
            .then(() => sendResponse({ status: "success" }))
            .catch(err => sendResponse({ status: "error", message: err.message }));
        return true;
    }

    // 2. 处理批量采集指令（原有 performCollect）
    if (message.action === "collect_titles") {
        console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 收到批量采集命令: ${message.keyword}, 站点: ${message.siteType}`);
        performCollect(message.keyword, message.siteType)
            .then(titles => {
                console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 批量采集成功，返回 ${titles.length} 条文献`);
                sendResponse({ success: true, titles: titles });
            })
            .catch(err => {
                console.error(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 批量采集失败:`, err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    // 3. 处理手动采集当前页指令（新增）
    if (message.action === "collect_current_page_science") {
        console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 收到手动采集当前页指令`);
        getCurrentSciencePageInfo()
            .then(pageInfo => {
                console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 手动采集成功，返回数据`);
                sendResponse({ success: true, data: pageInfo });
            })
            .catch(err => {
                console.error(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [content] 手动采集失败：`, err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    // 其他未知消息
    sendResponse({ status: "ok" });
});
// 页面加载时尝试通知 background（可选）
if (detectConfig()) {
    chrome.runtime.sendMessage({
        action: "cnki_page_ready",
        url: window.location.href
    }).catch(console.error);
}