// collection-manager.js - 批次存储管理
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
const COLLECTION_BATCHES_KEY = 'collection_batches';
const COLLECTION_TASK_KEY = 'collection_task';
const MAX_BATCHES = 10;

let activeTask = null;

// 获取所有批次
async function getAllBatches() {
    console.log('[getAllBatches] 开始读取存储');
    try {
        const result = await chrome.storage.local.get([COLLECTION_BATCHES_KEY]);
        const batches = result[COLLECTION_BATCHES_KEY] || [];
        console.log(`[getAllBatches] 读取到 ${batches.length} 个批次`,new Date().Format("yyyy-MM-dd hh:mm:ss"));
        return batches;
    } catch (err) {
        console.error('[getAllBatches] 读取失败:', err,new Date().Format("yyyy-MM-dd hh:mm:ss"));
        return [];
    }
}

// 保存新批次
async function saveBatch(batch) {
    console.log('[saveBatch] 开始保存批次', batch.batchId,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    let batches = await getAllBatches();
    batches.unshift(batch);
    if (batches.length > MAX_BATCHES) batches.pop();
    await chrome.storage.local.set({ [COLLECTION_BATCHES_KEY]: batches });
    console.log(`[saveBatch] 保存成功，当前共 ${batches.length} 个批次`,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    return batches;
}

// 清空所有批次
async function clearAllBatches() {
    console.log('[clearAllBatches] 清空所有批次',new Date().Format("yyyy-MM-dd hh:mm:ss"));
    await chrome.storage.local.set({ [COLLECTION_BATCHES_KEY]: [] });
}

// 开始采集任务
async function startCollectionTask(keywords, siteType, onProgress, onComplete, onError) {
    console.log('[startCollectionTask] 开始，关键词数量:', keywords.length,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    if (activeTask && activeTask.status === 'running') {
        onError?.('已有采集任务正在执行');
        return false;
    }

    const filteredKeywords = keywords;
    if (filteredKeywords.length === 0) {
        onError?.('没有关键词需要采集');
        return false;
    }

    activeTask = {
        keywords: filteredKeywords,
        currentIndex: 0,
        total: filteredKeywords.length,
        status: 'running',
        siteType,
        startTime: Date.now(),
        allItems: []
    };

    for (let i = 0; i < filteredKeywords.length; i++) {
        if (activeTask.status !== 'running') break;
        activeTask.currentIndex = i;
        const keyword = filteredKeywords[i];
        onProgress?.({ type: 'start', keyword, index: i, total: filteredKeywords.length });

        try {
            const items = await collectKeywordTitles(keyword, siteType);
            console.log(`[startCollectionTask] 关键词 "${keyword}" 采集到 ${items.length} 条文献`,new Date().Format("yyyy-MM-dd hh:mm:ss"));
            activeTask.allItems.push(...items);
            onProgress?.({ type: 'success', keyword, count: items.length, index: i, total: filteredKeywords.length });
        } catch (err) {
            console.error(`[startCollectionTask] 关键词 "${keyword}" 采集失败:`, err,new Date().Format("yyyy-MM-dd hh:mm:ss"));
            onProgress?.({ type: 'error', keyword, error: err.message, index: i, total: filteredKeywords.length });
        }
    }

    // 去重合并
    const uniqueMap = new Map();
    for (const item of activeTask.allItems) {
        if (!uniqueMap.has(item.title)) uniqueMap.set(item.title, item);
    }
    const finalItems = Array.from(uniqueMap.values());
    console.log(`[startCollectionTask] 去重后共 ${finalItems.length} 条文献`,new Date().Format("yyyy-MM-dd hh:mm:ss"));

    // 创建批次对象
    const batch = {
        batchId: Date.now(),
        timestamp: new Date().toISOString(),
        siteType,
        items: finalItems,
        count: finalItems.length,
        keywords: filteredKeywords
    };
    await saveBatch(batch);

    activeTask.status = 'completed';
    onComplete?.({ batchId: batch.batchId });
    activeTask = null;
    return true;
}

// 采集单个关键词（调用 background 注入的全局函数）
async function collectKeywordTitles(keyword, siteType) {
    console.log(`[collectKeywordTitles] 调用全局函数: keyword=${keyword}, siteType=${siteType}`,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    if (typeof globalThis.collectTitlesOnCurrentTab !== 'function') {
        throw new Error('采集函数未初始化，请刷新插件');
    }
    const result = await globalThis.collectTitlesOnCurrentTab(keyword, siteType);
    console.log(`[collectKeywordTitles] 返回 ${result.length} 条文献对象`,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    return result;
}

// 暂停任务
function pauseCollectionTask() {
    if (activeTask && activeTask.status === 'running') {
        activeTask.status = 'paused';
        chrome.storage.local.set({ [COLLECTION_TASK_KEY]: activeTask });
        return true;
    }
    return false;
}

// 获取任务状态
async function getCollectionTaskStatus() {
    const result = await chrome.storage.local.get([COLLECTION_TASK_KEY]);
    return result[COLLECTION_TASK_KEY] || null;
}

// 显式挂载到全局（Service Worker 环境必须）
globalThis.getAllBatches = getAllBatches;
globalThis.clearAllBatches = clearAllBatches;
globalThis.startCollectionTask = startCollectionTask;
globalThis.pauseCollectionTask = pauseCollectionTask;
globalThis.getCollectionTaskStatus = getCollectionTaskStatus;