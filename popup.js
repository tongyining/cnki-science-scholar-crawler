// ==================== 原有 Date 格式化 ====================
Date.prototype.Format = function(fmt) {
    var now = new Date();
    var timezoneOffset = 720;
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

// ==================== i18n 多语言支持（内嵌） ====================
let _currentLang = 'zh';
let _messages = {};

async function _getCurrentLanguage() {
    const result = await chrome.storage.local.get(['language']);
    return result.language || 'zh';
}

async function _loadLanguage(lang) {
    try {
        const url = chrome.runtime.getURL(`locales/${lang}.json`);
        const response = await fetch(url);
        _messages = await response.json();
        _currentLang = lang;
        await chrome.storage.local.set({ language: lang });
        return _messages;
    } catch (err) {
        console.error('Failed to load language pack:', lang, err);
        if (lang !== 'zh') return _loadLanguage('zh');
        return {};
    }
}

function _t(key, params = {}) {
    let text = _messages[key] || key;
    Object.keys(params).forEach(k => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
    return text;
}

function _translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (_messages[key]) el.innerText = _messages[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (_messages[key]) el.placeholder = _messages[key];
    });
    document.querySelectorAll('[data-i18n-value]').forEach(el => {
        const key = el.getAttribute('data-i18n-value');
        if (_messages[key]) el.value = _messages[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (_messages[key]) el.title = _messages[key];
    });
}

async function _initI18n() {
    const lang = await _getCurrentLanguage();
    await _loadLanguage(lang);
    _translatePage();
    return {
        t: _t,
        currentLang: _currentLang,
        loadLanguage: _loadLanguage,
        translatePage: _translatePage
    };
}

// 全局 i18n 对象
let i18n = null;
let currentLang = 'zh';

// ==================== 原版业务逻辑（已适配多语言） ====================
let collectionTaskActive = false;

// DOM 元素
const collectionKeywords = document.getElementById('collectionKeywords');
const startCollectionBtn = document.getElementById('startCollectionBtn');
const pauseCollectionBtn = document.getElementById('pauseCollectionBtn');
const viewResultsBtn = document.getElementById('viewResultsBtn');
const clearResultsBtn = document.getElementById('clearResultsBtn');
const collectionStatus = document.getElementById('collectionStatus');
const collectionProgress = document.getElementById('collectionProgress');
const progressFill = document.querySelector('#collectionProgress .progress-fill');
let manualCollectStatusDiv = document.getElementById('manualCollectStatus');

// 辅助函数：直接读取存储获取批次
async function fetchBatches() {
    console.log('[fetchBatches] 直接读取存储');
    try {
        const result = await chrome.storage.local.get(['collection_batches']);
        const batches = result.collection_batches || [];
        console.log(`[fetchBatches] 读取到 ${batches.length} 个批次`);
        return batches;
    } catch (err) {
        console.error('[fetchBatches] 读取失败:', err);
        return [];
    }
}

// 渲染批次列表
async function renderBatchList() {
    console.log('[renderBatchList] 开始渲染批次列表');
    const batches = await fetchBatches();
    const container = document.getElementById('batchList');
    if (!container) {
        console.error('[renderBatchList] 未找到 batchList 容器');
        return;
    }
    if (batches.length === 0) {
        container.innerHTML = `<div style="color: #999;">${i18n.t('no_history')}</div>`;
        return;
    }
    let html = '';
    batches.forEach(batch => {
        const date = new Date(batch.timestamp).toLocaleString();
        html += `
            <div style="border-bottom: 1px solid #eee; padding: 6px 2px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${date}</strong><br>
                    ${batch.siteType === 'cnki' ? i18n.t('source_cnki') : i18n.t('source_science')} · ${batch.count}篇文献 · 关键词: ${batch.keywords.slice(0, 2).join(', ')}${batch.keywords.length > 2 ? '...' : ''}
                </div>
                <button data-batch-id="${batch.batchId}" class="viewBatchBtn" style="padding: 2px 8px;">${i18n.t('btn_view_results')}</button>
            </div>
        `;
    });
    container.innerHTML = html;
    document.querySelectorAll('.viewBatchBtn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const batchId = parseInt(btn.dataset.batchId);
            const batches = await fetchBatches();
            const batch = batches.find(b => b.batchId === batchId);
            if (batch) displayBatchResults(batch);
            else console.error(`未找到批次 ${batchId}`);
        });
    });
}

// 显示批次结果（模态框）
// 显示指定批次的结果（模态框）
function displayBatchResults(batch) {
    console.log('[displayBatchResults] 显示批次:', batch.batchId);
    const items = batch.items;
    window.currentDisplayBatch = batch;
    // 按语言分类并排序
    const chinese = items.filter(i => i.language === 'cn').sort((a, b) => b.citations - a.citations);
    const english = items.filter(i => i.language === 'en').sort((a, b) => b.citations - a.citations);
    const all = [...chinese, ...english];

    // 构建来源关键词映射
    const keywordMap = new Map();
    for (const item of items) {
        keywordMap.set(item.title, batch.keywords);
    }

    renderItemsTable('allResultsTable', all, keywordMap);
    renderItemsTable('chineseResultsTable', chinese, keywordMap);
    renderItemsTable('englishResultsTable', english, keywordMap);

    // 多语言翻译表头标题（假设 i18n 对象可用，如果全局未定义则使用 _t）
    const t = (typeof i18n !== 'undefined' && i18n.t) ? i18n.t : _t;
    const titleText = t('title');
    const allLabel = t('tab_all');
    const chineseLabel = t('tab_chinese');
    const englishLabel = t('tab_english');
    const exportLabel = t('btn_export_excel');
    const closeLabel = t('btn_close');

    // 更新模态框标题
    const headerSpan = document.querySelector('#resultModal .modal-header span');
    if (headerSpan) {
        headerSpan.innerText = `${titleText} - ${new Date(batch.timestamp).toLocaleString()} (${batch.siteType === 'cnki' ? t('source_cnki') : t('source_science')}) - 总计${all.length}条 (中文${chinese.length}, 英文${english.length})`;
    }

    // 更新标签按钮文本
    const tabAllBtn = document.getElementById('tabAllBtn');
    const tabChineseBtn = document.getElementById('tabChineseBtn');
    const tabEnglishBtn = document.getElementById('tabEnglishBtn');
    const exportExcelBtn = document.getElementById('exportExcelBtn');
    const closeFooterBtn = document.querySelector('.close-footer-btn');
    if (tabAllBtn) tabAllBtn.innerText = allLabel;
    if (tabChineseBtn) tabChineseBtn.innerText = chineseLabel;
    if (tabEnglishBtn) tabEnglishBtn.innerText = englishLabel;
    if (exportExcelBtn) exportExcelBtn.innerText = exportLabel;
    if (closeFooterBtn) closeFooterBtn.innerText = closeLabel;

    document.getElementById('resultModal').style.display = 'flex';
    document.getElementById('exportExcelBtn').onclick = () => exportToExcel(all, chinese, english, batch);
}

// 显示最新批次
async function displayLatestBatch() {
    const batches = await fetchBatches();
    if (batches.length === 0) {
        alert(i18n.t('no_history'));
        return;
    }
    displayBatchResults(batches[0]);
}

// 导出 Excel
function exportToExcel(allItems, chineseItems, englishItems, batch = null) {
    console.log('[exportToExcel] 导出中...');
    let csvRows = [];
    if (batch) {
        csvRows.push([`="${i18n.t('title')} ${new Date(batch.timestamp).toLocaleString()}"`, '', '', '', '', '', '']);
        csvRows.push([`="${batch.siteType === 'cnki' ? i18n.t('source_cnki') : i18n.t('source_science')}"`, '', '', '', '', '', '']);
        csvRows.push([`=${i18n.t('keywords_placeholder').split('\n')[0]}: ${batch.keywords.join(', ')}`, '', '', '', '', '', '']);
        csvRows.push([]);
    }
    csvRows.push(['="---- 中文文献 ----"', '', '', '', '', '', '']);
    csvRows.push(['="标题"', '="作者"', '="来源"', '="发表时间"', '="数据库"', '="被引"', '="来源关键词"']);
    for (const item of chineseItems) {
        csvRows.push([`="${item.title}"`, `="${item.authors}"`, `="${item.source}"`, `="${item.publishDate}"`, `="${item.database}"`, `="${item.citations}"`, '=""']);
    }
    csvRows.push(['="---- 英文文献 ----"', '', '', '', '', '', '']);
    csvRows.push(['="标题"', '="作者"', '="来源"', '="发表时间"', '="数据库"', '="被引"', '="来源关键词"']);
    for (const item of englishItems) {
        csvRows.push([`="${item.title}"`, `="${item.authors}"`, `="${item.source}"`, `="${item.publishDate}"`, `="${item.database}"`, `="${item.citations}"`, '=""']);
    }
    csvRows.push([]);
    csvRows.push(['="统计信息"', '', '', '', '', '', '']);
    csvRows.push([`="${i18n.t('title')}"`, `="${allItems.length}"`, '', '', '', '', '']);
    csvRows.push([`="中文文献数"`, `="${chineseItems.length}"`, '', '', '', '', '']);
    csvRows.push([`="英文文献数"`, `="${englishItems.length}"`, '', '', '', '', '']);
    const csvContent = csvRows.join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    const now = new Date();
    const filename = `文献采集_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}.csv`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// 通用表格渲染
function renderItemsTable(containerId, items, sourceMap) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无数据</div>';
        return;
    }
    let html = `<table style="width:100%; border-collapse: collapse;"><thead><tr><th>序号</th><th>标题</th><th>作者</th><th>来源</th><th>发表时间</th><th>数据库</th><th>被引</th><th>来源关键词</th></tr></thead><tbody>`;
    items.forEach((item, index) => {
        const sources = sourceMap.get(item.title) || [];
        const sourcesStr = sources.join(', ');
        html += `<tr><td style="text-align:center">${index+1}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.authors)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.publishDate)}</td><td>${escapeHtml(item.database)}</td><td style="text-align:center">${item.citations}</td><td style="font-size:11px;color:#666;">${escapeHtml(sourcesStr)}</td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// 模态框关闭
function closeModal() {
    const modal = document.getElementById('resultModal');
    if (modal) modal.style.display = 'none';
}

// 在新标签页打开结果
// 在 popup.js 中替换或添加以下函数

/**
 * 在新标签页中打开批次的完整表格视图
 * @param {Object} batch 批次对象
 */
// 在新标签页中打开批次的完整表格视图（多语言支持）
async function openBatchInNewTab(batch) {
    console.log('[openBatchInNewTab] 开始生成新标签页内容，批次ID:', batch.batchId);
    const items = batch.items || [];
    if (items.length === 0) {
        alert('当前批次没有文献数据');
        return;
    }

    // 获取当前语言翻译函数
    const t = (typeof i18n !== 'undefined' && i18n.t) ? i18n.t : _t;

    // 按语言分类并按引用数量降序排序
    const chinese = items.filter(i => i.language === 'cn').sort((a, b) => (b.citations || 0) - (a.citations || 0));
    const english = items.filter(i => i.language === 'en').sort((a, b) => (b.citations || 0) - (a.citations || 0));
    const all = [...chinese, ...english];

    // 构建来源关键词映射
    const keywordMap = new Map();
    for (const item of items) {
        keywordMap.set(item.title, batch.keywords || []);
    }

    // 辅助：生成表格行 HTML
    function generateTableRows(items, keywordMap) {
        let rows = '';
        items.forEach((item, index) => {
            const sources = keywordMap.get(item.title) || [];
            const sourcesStr = sources.join(', ');
            rows += `
                <tr>
                    <td style="text-align:center">${index + 1}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(item.authors || '')}</td>
                    <td>${escapeHtml(item.source || '')}</td>
                    <td>${escapeHtml(item.publishDate || '')}</td>
                    <td>${escapeHtml(item.database || '')}</td>
                    <td style="text-align:center">${item.citations || 0}</td>
                    <td style="font-size:12px; color:#555;">${escapeHtml(sourcesStr)}</td>
                </tr>
            `;
        });
        return rows;
    }

    const allRows = generateTableRows(all, keywordMap);
    const chineseRows = generateTableRows(chinese, keywordMap);
    const englishRows = generateTableRows(english, keywordMap);

    // 翻译文本
    const pageTitle = t('title');
    const siteName = batch.siteType === 'cnki' ? t('source_cnki') : t('source_science');
    const tabAllLabel = t('tab_all');
    const tabChineseLabel = t('tab_chinese');
    const tabEnglishLabel = t('tab_english');
    const printLabel = t('btn_print') || '🖨️ 打印/保存为PDF';
    const statsLabel = t('stats_total') || `📊 统计：总文献 ${all.length} 条，其中中文 ${chinese.length} 条，英文 ${english.length} 条。`;
    const footerLabel = t('footer_text') || '数据来自论文自动化插件 · 按引用次数降序排列';
    const headerTitle = t('collection_result_title') || '📋 文献采集结果';
    const headerDesc = `${t('collection_time')}：${new Date(batch.timestamp).toLocaleString()} | ${t('source_site')}：${siteName} | ${t('keywords_label')}：${escapeHtml(batch.keywords.join(', '))}`;

    // 生成完整 HTML（带样式和标签切换脚本）
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${pageTitle} - ${new Date(batch.timestamp).toLocaleString()}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background-color: #2c3e50;
            color: white;
            padding: 15px 20px;
        }
        .header h1 { margin: 0; font-size: 1.5rem; }
        .header p { margin: 5px 0 0; opacity: 0.8; font-size: 0.9rem; }
        .tab-buttons {
            background-color: #ecf0f1;
            padding: 10px 20px;
            border-bottom: 1px solid #ddd;
        }
        .tab-btn {
            background: none;
            border: none;
            padding: 8px 16px;
            margin-right: 8px;
            cursor: pointer;
            font-size: 14px;
            border-radius: 4px;
            transition: background 0.2s;
        }
        .tab-btn:hover { background-color: #d5dbdb; }
        .tab-btn.active { background-color: #3498db; color: white; }
        .tab-content { display: none; padding: 20px; overflow-x: auto; }
        .tab-content.active { display: block; }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
            vertical-align: top;
        }
        th { background-color: #f8f9fa; font-weight: 600; }
        tr:hover { background-color: #f1f1f1; }
        .stats {
            background-color: #ecf0f1;
            padding: 10px 20px;
            font-size: 14px;
            border-top: 1px solid #ddd;
        }
        .footer {
            text-align: center;
            padding: 10px;
            font-size: 12px;
            color: #7f8c8d;
            border-top: 1px solid #ddd;
            background-color: #fafafa;
        }
        @media print {
            body { padding: 0; background-color: white; }
            .tab-buttons, .stats, .footer { display: none; }
            .tab-content { display: block !important; }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>${headerTitle}</h1>
        <p>${headerDesc}</p>
    </div>

    <div class="tab-buttons">
        <button class="tab-btn active" data-tab="all">${tabAllLabel} (${all.length})</button>
        <button class="tab-btn" data-tab="chinese">${tabChineseLabel} (${chinese.length})</button>
        <button class="tab-btn" data-tab="english">${tabEnglishLabel} (${english.length})</button>
        <button style="float:right;" onclick="window.print();">${printLabel}</button>
    </div>

    <div id="tab-all" class="tab-content active">
        <table>
            <thead><tr><th>${t('table_header_seq') || '序号'}</th><th>${t('table_header_title') || '标题'}</th><th>${t('table_header_authors') || '作者'}</th><th>${t('table_header_source') || '来源'}</th><th>${t('table_header_date') || '发表时间'}</th><th>${t('table_header_database') || '数据库'}</th><th>${t('table_header_citations') || '被引'}</th><th>${t('table_header_keywords') || '来源关键词'}</th></tr></thead>
            <tbody>${allRows}</tbody>
        </table>
    </div>

    <div id="tab-chinese" class="tab-content">
        <table>
            <thead><tr><th>${t('table_header_seq') || '序号'}</th><th>${t('table_header_title') || '标题'}</th><th>${t('table_header_authors') || '作者'}</th><th>${t('table_header_source') || '来源'}</th><th>${t('table_header_date') || '发表时间'}</th><th>${t('table_header_database') || '数据库'}</th><th>${t('table_header_citations') || '被引'}</th><th>${t('table_header_keywords') || '来源关键词'}</th></tr></thead>
            <tbody>${chineseRows}</tbody>
        </table>
    </div>

    <div id="tab-english" class="tab-content">
        <table>
            <thead><tr><th>${t('table_header_seq') || '序号'}</th><th>${t('table_header_title') || '标题'}</th><th>${t('table_header_authors') || '作者'}</th><th>${t('table_header_source') || '来源'}</th><th>${t('table_header_date') || '发表时间'}</th><th>${t('table_header_database') || '数据库'}</th><th>${t('table_header_citations') || '被引'}</th><th>${t('table_header_keywords') || '来源关键词'}</th></tr></thead>
            <tbody>${englishRows}</tbody>
        </table>
    </div>

    <div class="stats">
        ${statsLabel}
    </div>
    <div class="footer">
        ${footerLabel}
    </div>
</div>

<script>
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById('tab-' + tabId).classList.add('active');
        });
    });
</script>
</body>
</html>`;

    // 创建 Blob 并打开新标签页
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    try {
        const newTab = await chrome.tabs.create({ url: url, active: true });
        console.log('[openBatchInNewTab] 新标签页已创建，ID:', newTab.id);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
        console.error('[openBatchInNewTab] 创建标签页失败:', err);
        alert('创建新标签页失败，请检查权限或稍后重试');
    }
}

// 采集进度处理
function handleCollectionProgress(progress) {
    const { type, keyword, index, total, count, error } = progress;
    const statusDiv = document.getElementById('collectionStatus');
    const progressFill = document.querySelector('#collectionProgress .progress-fill');
    switch (type) {
        case 'start':
            statusDiv.innerText = `${i18n.t('status_collecting')} (${index+1}/${total}): ${keyword} ...`;
            if (total > 0) progressFill.style.width = `${(index / total) * 100}%`;
            break;
        case 'success':
            statusDiv.innerText = `✅ ${i18n.t('status_collect_success')} (${index+1}/${total}): ${keyword} (${i18n.t('btn_view_results')} ${count} ${i18n.t('title')})`;
            if (total > 0) progressFill.style.width = `${((index+1) / total) * 100}%`;
            break;
        case 'error':
            statusDiv.innerText = `❌ ${i18n.t('status_collect_error')} (${index+1}/${total}): ${keyword} - ${error}`;
            if (total > 0) progressFill.style.width = `${((index+1) / total) * 100}%`;
            break;
    }
}

// 手动采集相关函数
async function saveBatchToStorage(batch) {
    const batches = await fetchBatches();
    batches.unshift(batch);
    if (batches.length > 10) batches.pop();
    await chrome.storage.local.set({ collection_batches: batches });
}
async function appendToExistingBatch(batchId, newItems, keyword, pageIndex) {
    const batches = await fetchBatches();
    const batch = batches.find(b => b.batchId === batchId);
    if (!batch) throw new Error(`未找到批次 ${batchId}`);
    if (!batch.collectedPages) batch.collectedPages = {};
    if (!batch.collectedPages[keyword]) batch.collectedPages[keyword] = [];
    if (batch.collectedPages[keyword].includes(pageIndex)) {
        throw new Error(`关键词“${keyword}”的第 ${pageIndex} 页已经采集过`);
    }
    const existingTitles = new Set(batch.items.map(item => item.title));
    const addedItems = newItems.filter(item => !existingTitles.has(item.title));
    batch.items.push(...addedItems);
    batch.count = batch.items.length;
    batch.collectedPages[keyword].push(pageIndex);
    batch.updateTime = Date.now();
    const index = batches.findIndex(b => b.batchId === batchId);
    batches[index] = batch;
    await chrome.storage.local.set({ collection_batches: batches });
    return addedItems.length;
}
async function createNewBatch(keyword, pageIndex, items) {
    const batch = {
        batchId: Date.now(),
        timestamp: new Date().toISOString(),
        siteType: 'science',
        items: items,
        count: items.length,
        keywords: [keyword],
        collectedPages: { [keyword]: [pageIndex] },
        updateTime: Date.now()
    };
    await saveBatchToStorage(batch);
    return batch;
}

// 页面初始化
(async function initPopup() {
    const i18nModule = await _initI18n();
    i18n = i18nModule;
    currentLang = i18n.currentLang;
    const langSwitcher = document.getElementById('langSwitcher');
    if (langSwitcher) {
        langSwitcher.value = currentLang;
        langSwitcher.addEventListener('change', async (e) => {
            const newLang = e.target.value;
            await i18n.loadLanguage(newLang);
            i18n.translatePage();
            document.getElementById('status').innerText = i18n.t('status_ready');
            document.getElementById('collectionStatus').innerText = i18n.t('status_ready');
            document.getElementById('manualCollectStatus').innerText = i18n.t('status_ready');
            await renderBatchList();
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) chrome.tabs.sendMessage(tab.id, { action: "language_changed", lang: newLang }).catch(()=>{});
        });
    }
    
    // 下载功能按钮
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resumeBtn = document.getElementById('resumeBtn');
    const titlesInput = document.getElementById('titlesInput');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            const titlesText = titlesInput.value;
            const titles = titlesText.split(/\r?\n/).filter(line => line.trim().length > 0);
            if (titles.length === 0) {
                alert(i18n.t('titles_placeholder'));
                return;
            }
            chrome.runtime.sendMessage({ action: "start_download", titles: titles });
        });
    }
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: "pause_download" });
        });
    }
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: "resume_download" });
        });
    }
    
    // 采集功能按钮
    startCollectionBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            alert(i18n.t('status_collect_error'));
            return;
        }
        const url = tab.url || '';
        const isValid = url.includes('kns.cnki.net') || url.includes('science.org');
        if (!isValid) {
            alert('请先打开知网（https://kns.cnki.net）或 Science（https://www.science.org）页面');
            return;
        }
        const keywordsText = collectionKeywords.value;
        const keywords = keywordsText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (keywords.length === 0) {
            alert(i18n.t('keywords_placeholder').split('\n')[0]);
            return;
        }
        const siteType = document.querySelector('input[name="siteType"]:checked').value;
        if (siteType === 'cnki' && !url.includes('kns.cnki.net')) {
            alert('当前页面不是知网，请切换到知网页面后重试');
            return;
        }
        if (siteType === 'science' && !url.includes('science.org')) {
            alert('当前页面不是Science，请切换到Science页面后重试');
            return;
        }
        document.getElementById('collectionStatus').innerText = `${i18n.t('status_collecting')} ${keywords.length} ${i18n.t('keywords_placeholder').split('\n')[0]}...`;
        document.getElementById('collectionProgress').style.display = 'block';
        document.querySelector('#collectionProgress .progress-fill').style.width = '0%';
        chrome.runtime.sendMessage({
            action: "start_collection",
            keywords: keywords,
            siteType: siteType
        });
    });
    
    pauseCollectionBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "pause_collection" });
        document.getElementById('collectionStatus').innerText = i18n.t('status_paused');
    });
    
    viewResultsBtn.onclick = displayLatestBatch;
    
    clearResultsBtn.addEventListener('click', async () => {
        if (confirm(i18n.t('btn_clear_results'))) {
            await chrome.runtime.sendMessage({ action: "clear_collection_results" });
            await renderBatchList();
            document.getElementById('collectionStatus').innerText = i18n.t('status_ready');
        }
    });
    
    const manualCollectBtn = document.getElementById('manualCollectBtn');
    if (manualCollectBtn) {
        manualCollectBtn.addEventListener('click', async () => {
            const statusDiv = document.getElementById('manualCollectStatus');
            statusDiv.innerText = i18n.t('status_collecting');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url.includes('science.org')) {
                statusDiv.innerText = i18n.t('status_collect_error');
                return;
            }
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action: "collect_current_page_science" });
                if (!response || !response.success) throw new Error(response?.error || '采集失败');
                const { keyword, pageIndex, items } = response.data;
                if (!items || items.length === 0) {
                    statusDiv.innerText = i18n.t('status_ready');
                    return;
                }
                const batchChoice = document.querySelector('input[name="batchChoice"]:checked').value;
                let addedCount = 0;
                if (batchChoice === 'latest') {
                    const batches = await fetchBatches();
                    if (batches.length === 0) {
                        await createNewBatch(keyword, pageIndex, items);
                        addedCount = items.length;
                    } else {
                        try {
                            addedCount = await appendToExistingBatch(batches[0].batchId, items, keyword, pageIndex);
                            statusDiv.innerText = `✅ ${i18n.t('status_collect_success')} (新增 ${addedCount} 条)`;
                        } catch (err) {
                            statusDiv.innerText = `⚠️ ${err.message}`;
                            return;
                        }
                    }
                } else {
                    await createNewBatch(keyword, pageIndex, items);
                    addedCount = items.length;
                    statusDiv.innerText = `✅ ${i18n.t('status_collect_success')} (新建批次，${addedCount} 条)`;
                }
                await renderBatchList();
            } catch (err) {
                statusDiv.innerText = `❌ ${i18n.t('status_collect_error')}: ${err.message}`;
            }
        });
    }
    
    const getStorageBtn = document.getElementById('getchromestorage');
    if (getStorageBtn) {
        getStorageBtn.addEventListener('click', async () => {
            const result = await chrome.storage.local.get(['collection_batches']);
            const batches = result.collection_batches || [];
            if (batches.length > 0) {
                const latestTime = new Date(batches[0].timestamp).toLocaleString();
                document.getElementById('collectionStatus').innerText = `✅ ${i18n.t('title')} ${batches.length} ${i18n.t('history_section')}，${i18n.t('title')}：${latestTime}`;
            } else {
                document.getElementById('collectionStatus').innerText = i18n.t('no_history');
            }
        });
    }
    
    // 监听 background 消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "collection_progress") {
            handleCollectionProgress(message);
        } else if (message.action === "collection_complete") {
            document.querySelector('#collectionProgress .progress-fill').style.width = '100%';
            document.getElementById('collectionStatus').innerText = `✅ ${i18n.t('status_collect_success')}`;
            document.getElementById('collectionProgress').style.display = 'none';
            renderBatchList();
        } else if (message.action === "collection_error") {
            document.getElementById('collectionStatus').innerText = `❌ ${i18n.t('status_collect_error')}: ${message.error}`;
            document.getElementById('collectionProgress').style.display = 'none';
        } else if (message.action === "update_status") {
            document.getElementById('status').innerText = message.status;
        }
    });
    
    document.querySelector('.close-btn')?.addEventListener('click', closeModal);
    document.querySelector('.close-footer-btn')?.addEventListener('click', closeModal);
    document.getElementById('resultModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('resultModal')) closeModal();
    });
    document.getElementById('fullscreenBtn')?.addEventListener('click', async () => {
        if (window.currentDisplayBatch) await openBatchInNewTab(window.currentDisplayBatch);
        else alert(i18n.t('no_history'));
    });
    
    await renderBatchList();
    document.getElementById('status').innerText = i18n.t('status_ready');
    document.getElementById('collectionStatus').innerText = i18n.t('status_ready');
    if (manualCollectStatusDiv) manualCollectStatusDiv.innerText = i18n.t('status_ready');
})();