// i18n.js - 多语言支持，内部变量私有化
let _currentLang = 'zh';
let _messages = {};

// 获取当前语言（优先从storage读取，否则默认）
async function getCurrentLanguage() {
    const result = await chrome.storage.local.get(['language']);
    return result.language || 'zh';
}

// 加载语言包
async function loadLanguage(lang) {
    try {
        const url = chrome.runtime.getURL(`locales/${lang}.json`);
        const response = await fetch(url);
        _messages = await response.json();
        _currentLang = lang;
        await chrome.storage.local.set({ language: lang });
        return _messages;
    } catch (err) {
        console.error('Failed to load language pack:', lang, err);
        if (lang !== 'zh') return loadLanguage('zh');
        return {};
    }
}

// 翻译单个key，支持 {param} 替换
function t(key, params = {}) {
    let text = _messages[key] || key;
    Object.keys(params).forEach(k => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
    return text;
}

// 翻译整个页面（适用于popup.html）
function translatePage() {
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

// 初始化（在popup.js中调用）
async function initI18n() {
    const lang = await getCurrentLanguage();
    await loadLanguage(lang);
    translatePage();
    return {
        t,
        currentLang: _currentLang,
        loadLanguage,
        translatePage
    };
}

// 统一挂载到全局对象（window 或 globalThis），避免污染
const i18nAPI = {
    getCurrentLanguage,
    loadLanguage,
    t,
    translatePage,
    initI18n
};

if (typeof window !== 'undefined') {
    window.i18n = i18nAPI;
} else {
    globalThis.i18n = i18nAPI;
}