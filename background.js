// ==================== 原有工具函数 ====================
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

// 导入依赖
importScripts('socket.io.js');
importScripts('collection-manager.js');
importScripts('i18n.js');   // 多语言工具

let socket = null;
let isConnected = false;
let isPaused = false;
let currentTask = null;
let processing = false;
const STORAGE_KEY = 'downloaded_titles';
let currentCollectionTask = null;

// 多语言就绪标志
let i18nReady = false;
let i18n = null;

async function initBackgroundI18n() {
    while (typeof globalThis.i18n === 'undefined') {
        await new Promise(r => setTimeout(r, 50));
    }
    i18n = globalThis.i18n;
    const lang = await i18n.getCurrentLanguage();
    await i18n.loadLanguage(lang);
    i18nReady = true;
    console.log('[BG] i18n 已初始化，当前语言:', lang);
}
initBackgroundI18n();

// ==================== 原有业务函数（仅修改涉及文本的地方） ====================
async function loadDownloadedTitles() {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || [];
}

async function saveDownloadedTitle(title) {
    console.log(43,"保存下载标题",title,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    const titles = await loadDownloadedTitles();
    const cleanTitle = sanitizeFilename(title);
    if (!titles.includes(cleanTitle)) {
        titles.push(cleanTitle);
        await chrome.storage.local.set({ [STORAGE_KEY]: titles });
    }
}

function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_');
}

function connectSocket() {
    if (socket && socket.connected) return;
    console.log(63,'[BG] 连接 Socket.IO...');
    socket = io("http://127.0.0.1:9006", {
        transports: ["websocket"],
        reconnection: true,
    });
    socket.on("connect", () => {
        console.log(69,"[BG] Socket.IO 已连接");
        isConnected = true;
    });
    socket.on("disconnect", () => {
        console.log(73,"[BG] Socket.IO 断开");
        isConnected = false;
    });
    socket.on("file_renamed", (data) => {
        console.log(77,`[BG] 文件已重命名: ${data.newFileName}`);
        saveDownloadedTitle(data.title).then(() => {
            if (!isPaused && currentTask && currentTask.currentIndex + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else if (currentTask && currentTask.currentIndex + 1 >= currentTask.total) {
                finishAll();
            }
        });
    });
    socket.on("download_completed", (data) => {
        console.log(`[BG] 后端通知下载完成: ${data.title}, success=${data.success}`);
        if (data.success) {
            saveDownloadedTitle(data.title).then(() => {
                if (!isPaused && currentTask && currentTask.currentIndex + 1 < currentTask.total) {
                    currentTask.currentIndex++;
                    processNextTitle();
                } else {
                    finishAll();
                }
            });
        } else {
            // 使用 i18n 翻译通知
            const titleText = i18nReady ? i18n.t('notification_download_failed') : '下载失败';
            const msg = i18nReady ? i18n.t('notification_download_failed_msg', { title: data.title, error: data.error }) : `文献“${data.title}”下载失败：${data.error}`;
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon32.png",
                title: titleText,
                message: msg
            });
            if (currentTask && currentTask.currentIndex + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else {
                finishAll();
            }
        }
    });
    socket.on("error", (err) => console.error("[BG] Socket 错误:", err));
}

async function checkFileExists(title) {
    return new Promise((resolve) => {
        if (!isConnected) {
            resolve(false);
            return;
        }
        socket.emit("check_file", { title }, (response) => {
            resolve(response && response.exists);
        });
    });
}

// 确认对话框（带翻译）
async function showConfirmDialog(messageKey, params = {}) {
    while (!i18nReady) await new Promise(r => setTimeout(r, 100));
    const message = i18n.t(messageKey, params);
    return new Promise((resolve) => {
        const notificationId = `confirm_${Date.now()}`;
        chrome.notifications.create(notificationId, {
            type: "basic",
            iconUrl: "icon32.png",
            title: i18n.t('title'),
            message: message,
            buttons: [{ title: i18n.t('btn_start') }, { title: i18n.t('btn_pause') }],
            requireInteraction: true
        }, () => {});
        const listener = (notifId, buttonIndex) => {
            if (notifId === notificationId) {
                chrome.notifications.clear(notificationId);
                chrome.notifications.onButtonClicked.removeListener(listener);
                resolve(buttonIndex === 0);
            }
        };
        chrome.notifications.onButtonClicked.addListener(listener);
        setTimeout(() => {
            chrome.notifications.clear(notificationId);
            chrome.notifications.onButtonClicked.removeListener(listener);
            resolve(false);
        }, 30000);
    });
}

async function processNextTitle() {
    if (!currentTask) return;
    if (isPaused) {
        updatePopupStatus(i18nReady ? i18n.t('status_paused') : '已暂停');
        return;
    }
    const idx = currentTask.currentIndex;
    const title = currentTask.titles[idx];
    console.log(123,`[BG] 处理第 ${idx+1}/${currentTask.total}: ${title}`);

    const downloaded = await loadDownloadedTitles();
    const cleanTitle = sanitizeFilename(title);
    if (downloaded.includes(cleanTitle)) {
        const userConfirmed = await showConfirmDialog('dialog_file_exists', { title: title });
        if (!userConfirmed) {
            if (idx + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else {
                finishAll();
            }
            return;
        }
    }

    const existsInFolder = await checkFileExists(title);
    if (existsInFolder) {
        const userConfirmed = await showConfirmDialog('dialog_file_in_folder', { title: title });
        if (!userConfirmed) {
            await saveDownloadedTitle(title);
            if (idx + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else {
                finishAll();
            }
            return;
        }
    }

    const tab = await getActiveCNKITab();
    if (!tab) {
        updatePopupStatus(i18nReady ? i18n.t('status_collect_error') : '错误：未找到可用的知网页标签页');
        return;
    }
    processing = true;
    chrome.tabs.sendMessage(tab.id, {
        action: "search_and_download",
        title: title,
        index: idx
    }).catch(err => {
        console.error("[BG] 发送搜索指令失败:", err);
        processing = false;
        if (idx + 1 < currentTask.total) {
            currentTask.currentIndex++;
            processNextTitle();
        } else {
            finishAll();
        }
    });
}

function finishAll() {
    console.log("[BG] 所有任务完成");
    updatePopupStatus(i18nReady ? i18n.t('status_completed') : '所有文献处理完成');
    currentTask = null;
    processing = false;
}

async function getActiveCNKITab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return null;
    return tabs[0];
}

function updatePopupStatus(status) {
    chrome.runtime.sendMessage({ action: "update_status", status }).catch(() => {});
}

// ==================== 消息监听（原有逻辑，只修改提示文本） ====================
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === "start_download") {
        if (currentTask) {
            const titleText = i18nReady ? i18n.t('title') : '提示';
            const msg = i18nReady ? i18n.t('notification_task_busy') : '已有任务正在执行，请先暂停或等待完成';
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon32.png",
                title: titleText,
                message: msg
            });
            sendResponse({ status: "busy" });
            return;
        }
        currentTask = {
            titles: message.titles,
            currentIndex: 0,
            total: message.titles.length
        };
        isPaused = false;
        processing = false;
        connectSocket();
        const waitForSocket = () => {
            if (isConnected) {
                processNextTitle();
            } else {
                setTimeout(waitForSocket, 500);
            }
        };
        waitForSocket();
        sendResponse({ status: "started" });
        return true;
    } else if (message.action === "pause_download") {
        isPaused = true;
        updatePopupStatus(i18nReady ? i18n.t('status_paused') : '已暂停');
        sendResponse({ status: "paused" });
        return true;
    } else if (message.action === "resume_download") {
        isPaused = false;
        updatePopupStatus(i18nReady ? i18n.t('status_running') : '运行中');
        if (currentTask && !processing) processNextTitle();
        sendResponse({ status: "resumed" });
        return true;
    } else if (message.action === "download_completed") {
        if (socket && socket.connected) {
            socket.emit("prepare_download", { title: message.title, index: message.index });
        } else {
            if (currentTask && currentTask.currentIndex + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else {
                finishAll();
            }
        }
        return true;
    } else if (message.action === "start_collection") {
        const { keywords, siteType } = message;
        async function isCurrentTabValidForCollection() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return { valid: false, tab: null, url: '' };
            const url = tab.url || '';
            const isValid = url.includes('kns.cnki.net') || url.includes('science.org');
            return { valid: isValid, tab: tab, url: url };
        }
        async function collectTitlesOnCurrentTab(keyword, siteType) {
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`采集超时（关键词：${keyword}）`));
                }, 60000);
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) {
                        clearTimeout(timeoutId);
                        reject(new Error("未找到活动标签页"));
                        return;
                    }
                    const tab = tabs[0];
                    chrome.tabs.sendMessage(tab.id, {
                        action: "collect_titles",
                        keyword: keyword,
                        siteType: siteType
                    }, (response) => {
                        clearTimeout(timeoutId);
                        if (response && response.success === true) {
                            resolve(response.titles);
                        } else {
                            const errorMsg = response?.error || "采集失败";
                            reject(new Error(errorMsg));
                        }
                    });
                });
            });
        }
        globalThis.collectTitlesOnCurrentTab = collectTitlesOnCurrentTab;
        const { valid, tab, url } = await isCurrentTabValidForCollection();
        if (!valid) {
            chrome.runtime.sendMessage({ action: "collection_error", error: i18nReady ? i18n.t('status_collect_error') : "当前页面不是知网或Science" });
            sendResponse({ success: false, error: "当前页面不是知网或Science" });
            return true;
        }
        if (siteType === 'cnki' && !url.includes('kns.cnki.net')) {
            chrome.runtime.sendMessage({ action: "collection_error", error: "当前页面不是知网" });
            sendResponse({ success: false, error: "当前页面不是知网" });
            return true;
        }
        if (siteType === 'science' && !url.includes('science.org')) {
            chrome.runtime.sendMessage({ action: "collection_error", error: "当前页面不是Science" });
            sendResponse({ success: false, error: "当前页面不是Science" });
            return true;
        }
        startCollectionTask(keywords, siteType, 
            (progress) => chrome.runtime.sendMessage({ action: "collection_progress", ...progress }),
            (result) => {
                chrome.runtime.sendMessage({ action: "collection_complete", batchId: result.batchId });
                updatePopupStatus(i18nReady ? i18n.t('status_collect_success') : '采集完成');
            },
            (error) => {
                chrome.runtime.sendMessage({ action: "collection_error", error });
                updatePopupStatus(`${i18nReady ? i18n.t('status_collect_error') : '采集错误'}: ${error}`);
            }
        ).then(success => sendResponse({ success: success })).catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    } else if (message.action === "get_collection_results") {
        try {
            sendResponse({ success: true });
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
        return true;
    } else if (message.action === "get_batches") {
        try {
            if (typeof globalThis.getAllBatches !== 'function') throw new Error('globalThis.getAllBatches 未定义');
            const batches = await globalThis.getAllBatches();
            sendResponse({ success: true, batches });
        } catch (err) {
            sendResponse({ success: false, error: err.message, batches: [] });
        }
        return true;
    } else if (message.action === "clear_collection_results") {
        await clearAllBatches();
        sendResponse({ success: true });
        return true;
    }
});

connectSocket();