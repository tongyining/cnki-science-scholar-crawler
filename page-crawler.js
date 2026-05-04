// page-crawler.js - 独立页面爬虫，用于在知网或Science页面采集文献标题
// 此脚本会被注入到目标页面中执行，通过消息通信返回结果

(async function() {
    // 接收参数
    const params = new URLSearchParams(location.search);
    const keyword = decodeURIComponent(params.get('keyword') || '');
    const siteType = params.get('site') || 'cnki';
    const maxPages = parseInt(params.get('maxPages') || '10');
    
    if (!keyword) {
        chrome.runtime.sendMessage({ action: "crawl_result", success: false, error: "未提供关键词" });
        return;
    }
    
    console.log(`[爬虫] 开始采集: ${keyword}, 站点: ${siteType}, 最大页数: ${maxPages}`);
    
    // 工具函数：等待元素出现
    function waitForSelector(selector, timeout = 10000, interval = 500) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const check = () => {
                const el = document.querySelector(selector);
                if (el) {
                    resolve(el);
                } else if (Date.now() - startTime >= timeout) {
                    resolve(null);
                } else {
                    setTimeout(check, interval);
                }
            };
            check();
        });
    }
    
    // 等待网络空闲（简化版）
    function waitForNetworkIdle(timeout = 3000) {
        return new Promise(resolve => setTimeout(resolve, timeout));
    }
    
    // 知网：获取当前页标题列表
    function getCNKITitles() {
        const items = document.querySelectorAll('.result-table-list tbody tr td.name a.fz14');
        return Array.from(items).map(item => item.innerText.trim()).filter(t => t);
    }
    
    // 知网：点击下一页
    async function clickCNKINextPage() {
        // 查找下一页按钮
        const nextBtn = document.querySelector('#PageNext');
        if (nextBtn && nextBtn.getAttribute('data-curpage')) {
            const curPage = parseInt(nextBtn.getAttribute('data-curpage'));
            const totalPages = document.querySelectorAll('.pagesnums a').length;
            if (curPage > totalPages) return false;
            nextBtn.click();
            return true;
        }
        // 备选：查找页码链接中当前页之后的第一个
        const curPageLink = document.querySelector('.pagesnums a.cur');
        if (curPageLink) {
            const nextLink = curPageLink.parentElement.nextElementSibling?.querySelector('a');
            if (nextLink) {
                nextLink.click();
                return true;
            }
        }
        return false;
    }
    
    // Science：获取当前页标题列表
    function getScienceTitles() {
        const items = document.querySelectorAll('.article-title a');
        return Array.from(items).map(item => item.innerText.trim()).filter(t => t);
    }
    
    // Science：点击下一页
    async function clickScienceNextPage() {
        const nextBtn = document.querySelector('.page-item__arrow--next a');
        if (nextBtn && !nextBtn.parentElement.classList.contains('disabled')) {
            nextBtn.click();
            return true;
        }
        return false;
    }
    
    // 带重试机制的等待内容加载
    async function waitForContentLoad(getTitlesFunc, maxRetries = 10, retryInterval = 10000) {
        for (let i = 0; i < maxRetries; i++) {
            await waitForNetworkIdle(2000);
            const titles = getTitlesFunc();
            if (titles.length > 0) {
                console.log(`[爬虫] 第${i+1}次检查，找到${titles.length}条标题`);
                return true;
            }
            console.log(`[爬虫] 第${i+1}次检查，未找到标题，${maxRetries - i - 1}次剩余`);
            if (i < maxRetries - 1) {
                await new Promise(r => setTimeout(r, retryInterval));
            }
        }
        return false;
    }
    
    // 主采集流程
    async function crawl() {
        const allTitles = [];
        let currentPage = 1;
        let hasNext = true;
        
        // 等待首页内容加载
        const getTitlesFunc = siteType === 'cnki' ? getCNKITitles : getScienceTitles;
        const clickNextFunc = siteType === 'cnki' ? clickCNKINextPage : clickScienceNextPage;
        
        console.log(`[爬虫] 等待首页内容加载...`);
        const loadSuccess = await waitForContentLoad(getTitlesFunc);
        if (!loadSuccess) {
            chrome.runtime.sendMessage({ 
                action: "crawl_result", 
                success: false, 
                error: `页面加载超时，请检查网络或站点是否可访问（关键词：${keyword}）` 
            });
            return;
        }
        
        // 循环采集各页
        while (hasNext && currentPage <= maxPages) {
            console.log(`[爬虫] 采集第${currentPage}页...`);
            
            // 获取当前页标题
            const titles = getTitlesFunc();
            console.log(`[爬虫] 第${currentPage}页获取到${titles.length}条标题`);
            allTitles.push(...titles);
            
            // 检查是否有下一页
            if (currentPage >= maxPages) {
                console.log(`[爬虫] 已达到最大页数限制 ${maxPages}`);
                break;
            }
            
            // 尝试点击下一页
            const clicked = await clickNextFunc();
            if (!clicked) {
                console.log(`[爬虫] 没有下一页或点击失败`);
                break;
            }
            
            // 等待下一页内容加载
            await waitForNetworkIdle(3000);
            const nextPageLoaded = await waitForContentLoad(getTitlesFunc, 10, 10000);
            if (!nextPageLoaded) {
                console.log(`[爬虫] 下一页加载超时`);
                break;
            }
            
            currentPage++;
        }
        
        // 去重
        const uniqueTitles = [...new Set(allTitles)];
        console.log(`[爬虫] 采集完成，共获取${allTitles.length}条，去重后${uniqueTitles.length}条`);
        
        // 发送结果
        chrome.runtime.sendMessage({ 
            action: "crawl_result", 
            success: true, 
            keyword: keyword,
            titles: uniqueTitles,
            totalRaw: allTitles.length
        });
    }
    
    // 执行爬取
    crawl().catch(err => {
        console.error('[爬虫] 错误:', err);
        chrome.runtime.sendMessage({ action: "crawl_result", success: false, error: err.message });
    });
})();