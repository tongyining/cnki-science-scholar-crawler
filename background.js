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
importScripts('socket.io.js');
importScripts('collection-manager.js');

let socket = null;
let isConnected = false;
let isPaused = false;
let currentTask = null; // { titles, currentIndex, total }
let processing = false; // 是否正在处理一个标题

// 存储已下载的标题（清理后的）
const STORAGE_KEY = 'downloaded_titles';

let currentCollectionTask = null;

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
        await chrome.storage.local.set({
            [STORAGE_KEY]: titles
        });
    }
}

// 清理文件名中的非法字符
function sanitizeFilename(name) {
    console.log(43,"清理文件名中的非法字符",name,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    return name.replace(/[\\/:*?"<>|]/g, '_');
}

// 连接 Socket.IO
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
        console.log(77,`[BG] 文件已重命名: ${data.newFileName} (标题: ${data.title})`);
        // 文件重命名后，标记当前标题为已下载
        saveDownloadedTitle(data.title).then(() => {
            // 继续处理下一个标题
            if (!isPaused && currentTask && currentTask.currentIndex + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else if (currentTask && currentTask.currentIndex + 1 >= currentTask.total) {
                console.log("[BG] 所有标题处理完成");
                updatePopupStatus("所有文献处理完成");
                currentTask = null;
                processing = false;
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
                } else if (currentTask && currentTask.currentIndex + 1 >= currentTask.total) {
                    finishAll();
                } else {
                    finishAll();
                }
            });
        } else {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon32.png",
                title: "下载失败",
                message: `文献“${data.title}”下载失败：${data.error}`
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

// 查询后端是否存在该标题的文件
async function checkFileExists(title) {
    console.log(97,"查询后端是否存在该标题的文件",title,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    return new Promise((resolve) => {
        if (!isConnected) {
            console.warn(99,"[BG] Socket 未连接，无法检查文件");
            resolve(false);
            return;
        }
        socket.emit("check_file", {
            title
        }, (response) => {
            resolve(response && response.exists);
        });
    });
}

// 处理下一个标题
async function processNextTitle() {
    console.log(114,"处理下一个标题",new Date().Format("yyyy-MM-dd hh:mm:ss"));
    if (!currentTask) return;
    if (isPaused) {
        console.log("[BG] 已暂停，等待恢复");
        updatePopupStatus("已暂停");
        return;
    }
    const idx = currentTask.currentIndex;
    const title = currentTask.titles[idx];
    console.log(123,`[BG] 处理第 ${idx+1}/${currentTask.total}: ${title}`);

    // 1. 检查本地存储是否已下载
    const downloaded = await loadDownloadedTitles();
    console.log(127,"第二步1：检查本地存储是否已下载",downloaded,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    const cleanTitle = sanitizeFilename(title);
    if (downloaded.includes(cleanTitle)) {
        console.log(129,`[BG] 本地记录已存在，询问是否重新下载`);
        const userConfirmed = await showConfirmDialog(`文献“${title}”已经下载过，是否重新下载？`);
        if (!userConfirmed) {
            console.log(132,`[BG] 用户跳过 ${title}`);
            // 跳过，继续下一个
            if (idx + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else {
                finishAll();
            }
            return;
        }
    }

    // 2. 向后端检查文件是否存在
    const existsInFolder = await checkFileExists(title);
    console.log(147,"第二步2：向后端检查文件是否存在",title,existsInFolder,new Date().Format("yyyy-MM-dd hh:mm:ss"));
    if (existsInFolder) {
        console.log(148,`[BG] 后端检测到文件已存在，询问是否重新下载`);
        const userConfirmed = await showConfirmDialog(`文献“${title}”的文件已存在于下载目录，是否重新下载？`);
        if (!userConfirmed) {
            // 
            console.log(147,"第二步2：标记为已下载并跳过",new Date().Format("yyyy-MM-dd hh:mm:ss"));
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

    // 3. 向当前活动标签页发送搜索指令
    const tab = await getActiveCNKITab();
    console.log(165,"向当前活动标签页发送搜索指令",new Date().Format("yyyy-MM-dd hh:mm:ss"));
    if (!tab) {
        console.error("[BG] 未找到可用的知网页标签页");
        updatePopupStatus("错误：未找到可用的知网页标签页，请打开知网镜像站并刷新");
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
        // 失败后尝试继续下一个
        if (idx + 1 < currentTask.total) {
            currentTask.currentIndex++;
            processNextTitle();
        } else {
            finishAll();
        }
    });
}

// 完成所有任务
function finishAll() {
    console.log("[BG] 所有任务完成");
    updatePopupStatus("所有文献处理完成");
    currentTask = null;
    processing = false;
}

// 获取当前活动标签页中支持知网的页面
async function getActiveCNKITab() {
    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });
    if (tabs.length === 0) return null;
    const tab = tabs[0];
    // 不再限制 URL，只要 content script 能工作就行（content script 会判断是否支持）
    return tab;
}

// 显示确认对话框（在 background 中无法直接使用 confirm，需要发送到 popup 或使用 notifications）
// 这里使用 chrome.windows.create 创建一个临时弹窗或者利用 chrome.notifications？
// 最简单的方式：通过 popup 来显示确认框。但 popup 可能未打开。
// 为了简化，我们使用 chrome.storage.local 设置一个待确认项，然后通过 popup 来询问，这比较复杂。
// 另一种：在 background 中使用 chrome.tabs.sendMessage 向 popup 发送消息，但 popup 不活跃时无法收到。
// 考虑到用户体验，我们可以在 background 中直接使用 chrome.notifications 创建按钮式通知，但通知只有简单按钮。
// 为了简化，我们改用 confirm 对话框，但在 service worker 中不可用。
// 因此，我们改为：如果文件已存在，自动跳过（不再询问），或者记录一个标志，由用户手动点击跳过按钮。
// 根据需求，要求“手动确认”，我们可以实现一个简单的方案：background 设置一个 pendingConfirm 变量，然后通过 chrome.runtime.sendMessage 向 popup 发送确认请求（如果 popup 打开）。如果 popup 未打开，则自动跳过。
// 为了简化开发，这里改为自动跳过（不询问），但保留需求中的“手动确认”的逻辑框架，实际实现可后续完善。
// 但为了满足需求，我将实现一个简易的基于 chrome.notifications 的确认（带两个按钮）。
async function showConfirmDialog(message) {
    return new Promise((resolve) => {
        const notificationId = `confirm_${Date.now()}`;
        chrome.notifications.create(notificationId, {
            type: "basic",
            iconUrl: "icon32.png",
            title: "确认操作",
            message: message,
            buttons: [{
                title: "是"
            }, {
                title: "否"
            }],
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
        // 超时自动选择否
        setTimeout(() => {
            chrome.notifications.clear(notificationId);
            chrome.notifications.onButtonClicked.removeListener(listener);
            resolve(false);
        }, 30000);
    });
}

// 更新 popup 状态
function updatePopupStatus(status) {
    chrome.runtime.sendMessage({
        action: "update_status",
        status
    }).catch(() => {});
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    console.log(262,"监听来自 popup 的消息",new Date().Format("yyyy-MM-dd hh:mm:ss"));
    if (message.action === "start_download") {
        console.log(264,"第一步2：启动下载任务",new Date().Format("yyyy-MM-dd hh:mm:ss"));
        if (currentTask) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon32.png",
                title: "提示",
                message: "已有任务正在执行，请先暂停或等待完成"
            });
            sendResponse({
                status: "busy"
            });
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
        console.log(280,"等待 socket 连接后再开始",new Date().Format("yyyy-MM-dd hh:mm:ss"));
        // 等待 socket 连接后再开始
        const waitForSocket = () => {
            if (isConnected) {
                console.log(284,"socket连接成功，开始下一个",new Date().Format("yyyy-MM-dd hh:mm:ss"));
                processNextTitle();
            } else {
                console.log(287,"socket连接超时",new Date().Format("yyyy-MM-dd hh:mm:ss"));
                setTimeout(waitForSocket, 500);
            }
        };
        waitForSocket();
        sendResponse({
            status: "started"
        });
        return true;
    } else if (message.action === "pause_download") {
        isPaused = true;
        updatePopupStatus("已暂停");
        sendResponse({
            status: "paused"
        });
        return true;
    } else if (message.action === "resume_download") {
        isPaused = false;
        updatePopupStatus("运行中");
        if (currentTask && !processing) {
            processNextTitle();
        }
        sendResponse({
            status: "resumed"
        });
        return true;
    } else if (message.action === "download_completed") {
        console.log(310,`[BG] 收到 content 下载完成通知: ${message.title}`);
        if (socket && socket.connected) {
            socket.emit("prepare_download", { title: message.title, index: message.index });
        } else {
            console.error("[BG] Socket 未连接，无法监控下载");
            if (currentTask && currentTask.currentIndex + 1 < currentTask.total) {
                currentTask.currentIndex++;
                processNextTitle();
            } else {
                finishAll();
            }
        }
        return true;
    }
    else if (message.action === "start_collection") {
        console.log('[BG] 收到开始采集请求:', message);
        const { keywords, siteType } = message;

        // 检查当前标签页是否为知网或Science
        async function isCurrentTabValidForCollection() {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return { valid: false, tab: null, url: '' };
            const url = tab.url || '';
            const isValid = url.includes('kns.cnki.net') || url.includes('science.org');
            console.log(`[BG] 检查当前标签页: ${url}, isValid=${isValid}`);
            return { valid: isValid, tab: tab, url: url };
        }

        // 定义采集单个关键词的函数（供 collection-manager 调用）
        async function collectTitlesOnCurrentTab(keyword, siteType) {
            console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [BG] collectTitlesOnCurrentTab 开始: keyword=${keyword}, siteType=${siteType}`);
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`采集超时（关键词：${keyword}），请检查网络或页面是否正常`));
                }, 60000); // 60秒超时（Science 可能较慢）

                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) {
                        clearTimeout(timeoutId);
                        reject(new Error("未找到活动标签页"));
                        return;
                    }
                    const tab = tabs[0];
                    console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [BG] 向标签页 ${tab.id} 发送 collect_titles 消息`);
                    chrome.tabs.sendMessage(tab.id, {
                        action: "collect_titles",
                        keyword: keyword,
                        siteType: siteType
                    }, (response) => {
                        clearTimeout(timeoutId);
                        console.log(`[${new Date().Format("yyyy-MM-dd hh:mm:ss")}] [BG] 收到 content script 响应:`, response);
                        if (response && response.success === true) {
                            resolve(response.titles);
                        } else {
                            const errorMsg = response?.error || "采集失败，未收到有效响应 (content script 可能未注入或执行出错)";
                            reject(new Error(errorMsg));
                        }
                    });
                });
            });
        }

        // 将函数挂载到全局，以便 collection-manager.js 调用
        globalThis.collectTitlesOnCurrentTab = collectTitlesOnCurrentTab;

        // 先验证当前标签页
        const { valid, tab, url } = await isCurrentTabValidForCollection();
        console.log(419,"先验证当前标签页",valid, tab, url)
        if (!valid) {
            chrome.runtime.sendMessage({ action: "collection_error", error: "当前页面不是知网或Science，请先打开目标网站" });
            sendResponse({ success: false, error: "当前页面不是知网或Science" });
            return true;
        }

        console.log(419,"验证站点类型是否匹配")// 验证站点类型是否匹配
        if (siteType === 'cnki' && !url.includes('kns.cnki.net')) {
            chrome.runtime.sendMessage({ action: "collection_error", error: "当前页面不是知网，请切换到知网页面" });
            sendResponse({ success: false, error: "当前页面不是知网" });
            return true;
        }
        if (siteType === 'science' && !url.includes('science.org')) {
            chrome.runtime.sendMessage({ action: "collection_error", error: "当前页面不是Science，请切换到Science页面" });
            sendResponse({ success: false, error: "当前页面不是Science" });
            return true;
        }
        console.log(419,"启动采集任务")
        // 启动采集任务
        startCollectionTask(keywords, siteType, 
            (progress) => {
                console.log(441,"collection_progress")
                chrome.runtime.sendMessage({ action: "collection_progress", ...progress });
            },
            (result) => {
                console.log(445,"采集完，批次ID:", result.batchId);
                chrome.runtime.sendMessage({ action: "collection_complete", batchId: result.batchId });
                updatePopupStatus("采集完成");
            },
            (error) => {
                chrome.runtime.sendMessage({ action: "collection_error", error });
                updatePopupStatus(`采集错误: ${error}`);
            }
        ).then(success => {
            sendResponse({ success: success });
        }).catch(err => {
            console.error("[BG] 启动采集任务失败:", err);
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }else if (message.action === "get_collection_results") {
        console.log('[BG] 收到获取采集结果请求');
        try {
            const results = await getAllCollectionResults();
            console.log(464,results)
            // 注意：这里返回的 results 可能也很大，但 popup 之后会直接读 storage，所以现在可以只返回统计信息或安全的数据
            // 但由于 popup 已经改为直接读 storage，我们可以返回一个轻量的确认消息，实际数据由 popup 自己从 storage 读取
            // 但为了兼容，我们返回简单的统计信息，popup 则直接读取 storage
            // sendResponse({ success: true, results: results });
            sendResponse({ success: true });
        } catch (err) {
            console.error('[BG] 获取采集结果失败:', err);
            sendResponse({ success: false, error: err.message });
        }
        return true;
    }else if (message.action === "get_batches") {
        console.log('[BG] 收到获取批次请求');
        try {
            // 直接使用 globalThis 中挂载的函数，确保存在
            if (typeof globalThis.getAllBatches !== 'function') {
                throw new Error('globalThis.getAllBatches 未定义，请检查 collection-manager.js 是否正确加载');
            }
            const batches = await globalThis.getAllBatches();
            console.log(`[BG] 成功获取 ${batches.length} 个批次，内容预览:`, batches.slice(0, 2));
            sendResponse({ success: true, batches });
        } catch (err) {
            console.error('[BG] 获取批次失败:', err);
            sendResponse({ success: false, error: err.message, batches: [] });
        }
        return true; // 必须返回 true 表示异步响应
    }
    else if (message.action === "clear_collection_results") {
        console.log('[BG] 清空所有批次');
        await clearAllBatches();
        sendResponse({ success: true });
        return true;
    }
})

// 初始化
connectSocket();