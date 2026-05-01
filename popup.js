// 保留原有 Date.prototype.Format 等代码不变...

// 采集功能相关变量
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
// 辅助函数：通过消息获取批次
// 辅助函数：直接读取存储获取批次（不再通过消息）
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
    console.log('[renderBatchList] 最终获取到的批次数组长度:', batches.length);
    const container = document.getElementById('batchList');
    if (!container) {
        console.error('[renderBatchList] 未找到 batchList 容器');
        return;
    }
    if (batches.length === 0) {
        container.innerHTML = '<div style="color: #999;">暂无历史采集记录</div>';
        return;
    }
    let html = '';
    batches.forEach(batch => {
        const date = new Date(batch.timestamp).toLocaleString();
        html += `
            <div style="border-bottom: 1px solid #eee; padding: 6px 2px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${date}</strong><br>
                    ${batch.siteType === 'cnki' ? '知网' : 'Science'} · ${batch.count}篇文献 · 关键词: ${batch.keywords.slice(0, 2).join(', ')}${batch.keywords.length > 2 ? '...' : ''}
                </div>
                <button data-batch-id="${batch.batchId}" class="viewBatchBtn" style="padding: 2px 8px;">查看</button>
            </div>
        `;
    });
    container.innerHTML = html;
    // 绑定查看按钮
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
// ========== 手动采集当前页（Science） ==========

/**
 * 获取所有批次（复用 fetchBatches）
 */
async function getAllBatchesForManual() {
    return await fetchBatches();
}

/**
 * 保存批次到 storage（复用 saveBatch 逻辑）
 */
async function saveBatchToStorage(batch) {
    console.log(`[手动采集] 保存批次: ${batch.batchId}, 条数: ${batch.items.length}`);
    const batches = await fetchBatches();
    batches.unshift(batch);
    if (batches.length > 10) batches.pop();
    await chrome.storage.local.set({ collection_batches: batches });
}

/**
 * 更新已有批次（添加新页面采集的内容）
 */
async function appendToExistingBatch(batchId, newItems, keyword, pageIndex) {
    const batches = await fetchBatches();
    const batch = batches.find(b => b.batchId === batchId);
    if (!batch) throw new Error(`未找到批次 ${batchId}`);
    
    // 初始化 collectedPages 结构（用于去重）
    if (!batch.collectedPages) batch.collectedPages = {};
    if (!batch.collectedPages[keyword]) batch.collectedPages[keyword] = [];
    
    // 检查当前 (keyword, page) 是否已经采集过
    if (batch.collectedPages[keyword].includes(pageIndex)) {
        throw new Error(`关键词“${keyword}”的第 ${pageIndex} 页已经采集过，不会重复添加`);
    }
    
    // 合并新文献（去重基于 title）
    const existingTitles = new Set(batch.items.map(item => item.title));
    const addedItems = newItems.filter(item => !existingTitles.has(item.title));
    batch.items.push(...addedItems);
    batch.count = batch.items.length;
    batch.collectedPages[keyword].push(pageIndex);
    batch.updateTime = Date.now();
    
    // 更新存储
    const index = batches.findIndex(b => b.batchId === batchId);
    batches[index] = batch;
    await chrome.storage.local.set({ collection_batches: batches });
    
    console.log(`[手动采集] 批次 ${batchId} 新增 ${addedItems.length} 条文献，总计 ${batch.items.length} 条`);
    return addedItems.length;
}

/**
 * 创建新批次
 */
async function createNewBatch(keyword, pageIndex, items) {
    const batch = {
        batchId: Date.now(),
        timestamp: new Date().toISOString(),
        siteType: 'science',
        items: items,
        count: items.length,
        keywords: [keyword],
        collectedPages: {
            [keyword]: [pageIndex]
        },
        updateTime: Date.now()
    };
    await saveBatchToStorage(batch);
    console.log(`[手动采集] 创建新批次 ${batch.batchId}，共 ${items.length} 条文献`);
    return batch;
}

// 监听手动采集按钮
// 监听手动采集按钮
document.getElementById('manualCollectBtn')?.addEventListener('click', async () => {
    console.log(`[${new Date().toLocaleString()}] 点击手动采集按钮`);
    if (!manualCollectStatusDiv) manualCollectStatusDiv = document.getElementById('manualCollectStatus');
    manualCollectStatusDiv.innerText = '⏳ 正在获取当前页数据...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('science.org')) {
        manualCollectStatusDiv.innerText = '❌ 请先打开 Science 网站并进入搜索结果页';
        return;
    }

    try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "collect_current_page_science" });
        console.log('[手动采集] 收到的原始响应:', response);
        console.log('[手动采集] response.success =', response?.success);

        if (!response) {
            throw new Error('未收到任何响应，请确认 content script 已注入');
        }
        if (!response.success) {
            throw new Error(response.error || '采集失败（响应中 success=false）');
        }

        const { keyword, pageIndex, items } = response.data;
        if (!items || items.length === 0) {
            manualCollectStatusDiv.innerText = '⚠️ 当前页没有文献数据';
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
                const latestBatch = batches[0];
                try {
                    addedCount = await appendToExistingBatch(latestBatch.batchId, items, keyword, pageIndex);
                    manualCollectStatusDiv.innerText = `✅ 已添加到最新批次（新增 ${addedCount} 条，跳过 ${items.length - addedCount} 条重复）`;
                } catch (err) {
                    manualCollectStatusDiv.innerText = `⚠️ ${err.message}`;
                    return;
                }
            }
        } else {
            await createNewBatch(keyword, pageIndex, items);
            addedCount = items.length;
            manualCollectStatusDiv.innerText = `✅ 已创建新批次，添加 ${addedCount} 条文献`;
        }

        await renderBatchList();
    } catch (err) {
        console.error('[手动采集] 错误详情:', err);
        manualCollectStatusDiv.innerText = `❌ 采集失败：${err.message}`;
    }
});
// 处理采集进度消息
function handleCollectionProgress(progress) {
    const { type, keyword, index, total, count, error } = progress;

    switch (type) {
        case 'start':
            collectionStatus.innerText = `🔄 正在采集 (${index+1}/${total}): ${keyword} ...`;
            if (total > 0) {
                const percent = (index / total) * 100;
                progressFill.style.width = `${percent}%`;
            }
            break;

        case 'success':
            collectionStatus.innerText = `✅ 完成 (${index+1}/${total}): ${keyword} (获得 ${count} 条)`;
            if (total > 0) {
                const percent = ((index+1) / total) * 100;
                progressFill.style.width = `${percent}%`;
            }
            break;

        case 'error':
            collectionStatus.innerText = `❌ 失败 (${index+1}/${total}): ${keyword} - ${error}`;
            if (total > 0) {
                const percent = ((index+1) / total) * 100;
                progressFill.style.width = `${percent}%`;
            }
            break;
    }
}
// 显示指定批次的结果
// 显示指定批次的结果
function displayBatchResults(batch) {
    console.log('[displayBatchResults] 显示批次:', batch.batchId);
    const items = batch.items;
    window.currentDisplayBatch = batch;
    // 按语言分类并按引用数量降序排序
    const chinese = items.filter(i => i.language === 'cn').sort((a, b) => b.citations - a.citations);
    const english = items.filter(i => i.language === 'en').sort((a, b) => b.citations - a.citations);
    const all = [...chinese, ...english];
    
    // 构建来源关键词映射（批次中所有关键词合并），直接存储数组
    const keywordMap = new Map();
    for (const item of items) {
        keywordMap.set(item.title, batch.keywords);
    }
    
    renderItemsTable('allResultsTable', all, keywordMap);
    renderItemsTable('chineseResultsTable', chinese, keywordMap);
    renderItemsTable('englishResultsTable', english, keywordMap);
    
    const header = document.querySelector('#resultModal .modal-header span');
    header.innerText = `📋 ${new Date(batch.timestamp).toLocaleString()} (${batch.siteType === 'cnki' ? '知网' : 'Science'}) - 总计${all.length}条 (中文${chinese.length}, 英文${english.length})`;
    
    document.getElementById('resultModal').style.display = 'flex';
    // 绑定导出按钮（导出当前批次）
    document.getElementById('exportExcelBtn').onclick = () => exportToExcel(all, chinese, english, batch);
}

// 显示最新批次
async function displayLatestBatch() {
    console.log('[displayLatestBatch] 获取最新批次');
    const batches = await fetchBatches();
    if (batches.length === 0) {
        alert('暂无采集结果，请先采集');
        return;
    }
    displayBatchResults(batches[0]);
}

// 导出 Excel（支持批次信息）
function exportToExcel(allItems, chineseItems, englishItems, batch = null) {
    console.log('[exportToExcel] 导出中...');
    let csvRows = [];
    if (batch) {
        csvRows.push([`="采集时间: ${new Date(batch.timestamp).toLocaleString()}"`, '', '', '', '', '', '']);
        csvRows.push([`="站点: ${batch.siteType === 'cnki' ? '知网' : 'Science'}"`, '', '', '', '', '', '']);
        csvRows.push([`="关键词: ${batch.keywords.join(', ')}"`, '', '', '', '', '', '']);
        csvRows.push([]);
    }
    // 中文
    csvRows.push(['="---- 中文文献 ----"', '', '', '', '', '', '']);
    csvRows.push(['="标题"', '="作者"', '="来源"', '="发表时间"', '="数据库"', '="被引"', '="来源关键词"']);
    for (const item of chineseItems) {
        csvRows.push([`="${item.title}"`, `="${item.authors}"`, `="${item.source}"`, `="${item.publishDate}"`, `="${item.database}"`, `="${item.citations}"`, '=""']);
    }
    // 英文
    csvRows.push(['="---- 英文文献 ----"', '', '', '', '', '', '']);
    csvRows.push(['="标题"', '="作者"', '="来源"', '="发表时间"', '="数据库"', '="被引"', '="来源关键词"']);
    for (const item of englishItems) {
        csvRows.push([`="${item.title}"`, `="${item.authors}"`, `="${item.source}"`, `="${item.publishDate}"`, `="${item.database}"`, `="${item.citations}"`, '=""']);
    }
    // 统计
    csvRows.push([]);
    csvRows.push(['="统计信息"', '', '', '', '', '', '']);
    csvRows.push([`="总文献数"`, `="${allItems.length}"`, '', '', '', '', '']);
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

// HTML转义
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// 模态框关闭函数
function closeModal() {
    const modal = document.getElementById('resultModal');
    if (modal) modal.style.display = 'none';
}

// 绑定关闭按钮和全屏按钮
document.querySelector('.close-btn')?.addEventListener('click', closeModal);
document.querySelector('.close-footer-btn')?.addEventListener('click', closeModal);
document.getElementById('resultModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('resultModal')) closeModal();
});
// 全屏按钮：在新标签页中打开当前批次的结果
document.getElementById('fullscreenBtn')?.addEventListener('click', async () => {
    console.log('[全屏] 用户点击全屏按钮，准备在新标签页中打开结果');
    // 获取当前正在显示的批次（从 displayBatchResults 中保存的变量获取，或通过模态框标题反查）
    // 方法：在 displayBatchResults 中设置一个全局变量 currentDisplayBatch
    if (typeof window.currentDisplayBatch === 'undefined') {
        console.error('[全屏] 未找到当前显示的批次，请重试');
        alert('无法获取当前批次数据，请重新打开模态框后再试');
        return;
    }
    const batch = window.currentDisplayBatch;
    console.log('[全屏] 当前批次:', batch);
    await openBatchInNewTab(batch);
});

// 页面加载时渲染批次列表
renderBatchList();
startCollectionBtn.addEventListener('click', async () => {
    console.log(78,"点击采集按钮");
    // 先检查当前标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        alert('无法获取当前标签页');
        return;
    }
    const url = tab.url || '';
    const isValid = url.includes('kns.cnki.net') || url.includes('science.org');
    if (!isValid) {
        alert('请先打开知网（https://kns.cnki.net）或 Science（https://www.science.org）页面，然后重新开始采集任务');
        return;
    }
    
    // 原有的关键词获取逻辑...
    const keywordsText = collectionKeywords.value;
    const keywords = keywordsText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (keywords.length === 0) {
        alert('请在输入框中填写关键词（每行一个）');
        return;
    }
    
    const siteType = document.querySelector('input[name="siteType"]:checked').value;
    
    // 可以额外验证站点类型与当前URL是否匹配（可选）
    if (siteType === 'cnki' && !url.includes('kns.cnki.net')) {
        alert('当前页面不是知网，请切换到知网页面后重试');
        return;
    }
    if (siteType === 'science' && !url.includes('science.org')) {
        alert('当前页面不是Science，请切换到Science页面后重试');
        return;
    }
    console.log(111,"启动采集");
    // 启动采集...
    collectionStatus.innerText = `🚀 开始采集任务，共 ${keywords.length} 个关键词...`;
    collectionProgress.style.display = 'block';
    progressFill.style.width = '0%';
    collectionTaskActive = true;
    console.log(117,"发送消息给content");
    chrome.runtime.sendMessage({
        action: "start_collection",
        keywords: keywords,
        siteType: siteType
    });
    // ...
});

pauseCollectionBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "pause_collection" });
    collectionStatus.innerText = '正在暂停...';
});
// 监听采集完成消息，刷新批次列表
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[popup] 收到消息:', message);
    if (message.action === "collection_progress") {
        handleCollectionProgress(message);
    } else if (message.action === "collection_complete") {
        console.log('采集完成，批次ID:', message.batchId);
        progressFill.style.width = '100%';
        collectionStatus.innerText = `✅ 采集完成！`;
        collectionProgress.style.display = 'none';
        collectionTaskActive = false;
        renderBatchList();
    } else if (message.action === "collection_error") {
        console.error('[popup] 采集错误:', message.error);
        collectionStatus.innerText = `❌ 采集错误: ${message.error}`;
        collectionProgress.style.display = 'none';
        collectionTaskActive = false;
    }
    // 其他消息...
});
document.querySelector('.close-btn')?.addEventListener('click', closeModal);
document.querySelector('.close-footer-btn')?.addEventListener('click', closeModal);
document.getElementById('resultModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('resultModal')) closeModal();
});
// 将 viewResultsBtn 绑定到显示最新批次
viewResultsBtn.onclick = displayLatestBatch;

// 查看存储里面的内容按钮功能
document.getElementById('getchromestorage').addEventListener('click', async () => {
    console.log('[查看存储] 点击按钮');
    try {
        // 直接读取存储中的批次数据
        const result = await chrome.storage.local.get(['collection_batches']);
        const batches = result.collection_batches || [];
        if (batches.length > 0) {
            const latestTime = new Date(batches[0].timestamp).toLocaleString();
            collectionStatus.innerText = `✅ 存储中有数据：共 ${batches.length} 个批次，最新批次时间：${latestTime}`;
            collectionStatus.style.color = 'green';
        } else {
            collectionStatus.innerText = `❌ 存储中没有数据`;
            collectionStatus.style.color = 'red';
        }
    } catch (err) {
        console.error('[查看存储] 错误:', err);
        collectionStatus.innerText = `⚠️ 读取存储失败：${err.message}`;
        collectionStatus.style.color = 'orange';
    }
});


/**
 * 在新标签页中打开批次的完整表格视图
 * @param {Object} batch 批次对象
 */
async function openBatchInNewTab(batch) {
    console.log('[openBatchInNewTab] 开始生成新标签页内容，批次ID:', batch.batchId);
    const items = batch.items;
    // 按语言分类并按引用数量降序排序
    const chinese = items.filter(i => i.language === 'cn').sort((a, b) => b.citations - a.citations);
    const english = items.filter(i => i.language === 'en').sort((a, b) => b.citations - a.citations);
    const all = [...chinese, ...english];

    // 构建来源关键词映射（批次中所有关键词合并）
    const keywordMap = new Map();
    for (const item of items) {
        keywordMap.set(item.title, batch.keywords);
    }

    // 生成表格行 HTML
    function generateTableRows(items, keywordMap) {
        let rows = '';
        items.forEach((item, index) => {
            const sources = keywordMap.get(item.title) || [];
            const sourcesStr = sources.join(', ');
            rows += `
                <tr>
                    <td style="text-align:center">${index + 1}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(item.authors)}</td>
                    <td>${escapeHtml(item.source)}</td>
                    <td>${escapeHtml(item.publishDate)}</td>
                    <td>${escapeHtml(item.database)}</td>
                    <td style="text-align:center">${item.citations}</td>
                    <td style="font-size:12px; color:#555;">${escapeHtml(sourcesStr)}</td>
                </tr>
            `;
        });
        return rows;
    }

    const allRows = generateTableRows(all, keywordMap);
    const chineseRows = generateTableRows(chinese, keywordMap);
    const englishRows = generateTableRows(english, keywordMap);

    // 生成完整 HTML
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>文献采集结果 - ${new Date(batch.timestamp).toLocaleString()}</title>
    <style>
        * {
            box-sizing: border-box;
        }
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
        .header h1 {
            margin: 0;
            font-size: 1.5rem;
        }
        .header p {
            margin: 5px 0 0;
            opacity: 0.8;
            font-size: 0.9rem;
        }
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
        .tab-btn:hover {
            background-color: #d5dbdb;
        }
        .tab-btn.active {
            background-color: #3498db;
            color: white;
        }
        .tab-content {
            display: none;
            padding: 20px;
            overflow-x: auto;
        }
        .tab-content.active {
            display: block;
        }
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
        th {
            background-color: #f8f9fa;
            font-weight: 600;
        }
        tr:hover {
            background-color: #f1f1f1;
        }
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
            body {
                padding: 0;
                background-color: white;
            }
            .tab-buttons, .stats, .footer {
                display: none;
            }
            .tab-content {
                display: block !important;
            }
        }
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>📋 文献采集结果</h1>
        <p>采集时间：${new Date(batch.timestamp).toLocaleString()} | 站点：${batch.siteType === 'cnki' ? '中国知网' : 'Science'} | 关键词：${escapeHtml(batch.keywords.join(', '))}</p>
    </div>

    <div class="tab-buttons">
        <button class="tab-btn active" data-tab="all">全部结果 (${all.length})</button>
        <button class="tab-btn" data-tab="chinese">中文文献 (${chinese.length})</button>
        <button class="tab-btn" data-tab="english">英文文献 (${english.length})</button>
        <button style="float:right;" onclick="window.print();">🖨️ 打印/保存为PDF</button>
    </div>

    <div id="tab-all" class="tab-content active">
        <table>
            <thead>
                <tr><th>序号</th><th>标题</th><th>作者</th><th>来源</th><th>发表时间</th><th>数据库</th><th>被引</th><th>来源关键词</th></tr>
            </thead>
            <tbody>${allRows}</tbody>
        </table>
    </div>

    <div id="tab-chinese" class="tab-content">
        <table>
            <thead><tr><th>序号</th><th>标题</th><th>作者</th><th>来源</th><th>发表时间</th><th>数据库</th><th>被引</th><th>来源关键词</th></tr></thead>
            <tbody>${chineseRows}</tbody>
        </table>
    </div>

    <div id="tab-english" class="tab-content">
        <table>
            <thead><tr><th>序号</th><th>标题</th><th>作者</th><th>来源</th><th>发表时间</th><th>数据库</th><th>被引</th><th>来源关键词</th></tr></thead>
            <tbody>${englishRows}</tbody>
        </table>
    </div>

    <div class="stats">
        📊 统计：总文献 ${all.length} 条，其中中文 ${chinese.length} 条，英文 ${english.length} 条。
    </div>
    <div class="footer">
        数据来自论文自动化插件 · 按引用次数降序排列
    </div>
</div>

<script>
    // 标签切换逻辑
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
    console.log('[openBatchInNewTab] HTML 内容长度:', htmlContent.length);
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    console.log('[openBatchInNewTab] 创建 blob URL:', url);
    try {
        const newTab = await chrome.tabs.create({ url: url, active: true });
        console.log('[openBatchInNewTab] 新标签页已创建，ID:', newTab.id);
        // 延迟释放 blob URL（避免立即释放导致页面空白）
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
        console.error('[openBatchInNewTab] 创建标签页失败:', err);
        alert('创建新标签页失败，请检查权限或稍后重试');
    }
}