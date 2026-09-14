/**
 * Tiny i18n + theme store for the site chrome (nav, Terminal, token page, referrals). Strings not in the dictionary fall
 * back to English. Persisted in localStorage (`arctools_lang`, `arctools_theme`); `<html lang>` / `data-theme` follow.
 */
import { useEffect, useState } from "react";

export const LANGS = [
  ["en", "EN", "English"],
  ["zh", "中文", "简体中文"],
  ["es", "ES", "Español"],
  ["ru", "RU", "Русский"],
  ["pl", "PL", "Polski"],
] as const;
export type Lang = (typeof LANGS)[number][0];
export type Theme = "dark" | "light";

const D: Record<string, Partial<Record<Lang, string>>> = {
  // nav
  "Terminal": { zh: "终端", es: "Terminal", ru: "Терминал", pl: "Terminal" },
  "Profile": { zh: "个人", es: "Perfil", ru: "Профиль", pl: "Profil" },
  "Wallets": { zh: "钱包", es: "Carteras", ru: "Кошельки", pl: "Portfele" },
  "Referrals": { zh: "推荐", es: "Referidos", ru: "Рефералы", pl: "Polecenia" },
  "Scanner": { zh: "扫描", es: "Escáner", ru: "Сканер", pl: "Skaner" },
  "Portfolio": { zh: "资产", es: "Portafolio", ru: "Портфель", pl: "Portfel" },
  "Bridge": { zh: "跨链桥", es: "Puente", ru: "Мост", pl: "Most" },
  "Launchpad": { zh: "发射台", es: "Launchpad", ru: "Лаунчпад", pl: "Launchpad" },
  "Rewards": { zh: "奖励", es: "Recompensas", ru: "Награды", pl: "Nagrody" },
  "Insiders": { zh: "内幕钱包", es: "Insiders", ru: "Инсайдеры", pl: "Insiderzy" },
  "Intel": { zh: "情报", es: "Intel", ru: "Разведка", pl: "Intel" },
  "Connect wallet": { zh: "连接钱包", es: "Conectar cartera", ru: "Подключить кошелёк", pl: "Połącz portfel" },
  "← Terminal": { zh: "← 终端", es: "← Terminal", ru: "← Терминал", pl: "← Terminal" },
  // terminal
  "every Arc launchpad · one click · best price across venues · ": { zh: "所有 Arc 发射台 · 一键 · 全场最优价 · ", es: "todos los launchpads de Arc · un clic · mejor precio entre venues · ", ru: "все лаунчпады Arc · один клик · лучшая цена по всем площадкам · ", pl: "każdy launchpad Arc · jeden klik · najlepsza cena z wszystkich venue · " },
  "profile & history →": { zh: "个人与历史 →", es: "perfil e historial →", ru: "профиль и история →", pl: "profil i historia →" },
  "SIGN WITH": { zh: "签名方式", es: "FIRMAR CON", ru: "ПОДПИСЬ", pl: "PODPISUJ" },
  "QUICK BUY": { zh: "快速买入", es: "COMPRA RÁPIDA", ru: "БЫСТРАЯ ПОКУПКА", pl: "SZYBKI ZAKUP" },
  "SLIPPAGE": { zh: "滑点", es: "SLIPPAGE", ru: "ПРОСКАЛЬЗЫВАНИЕ", pl: "SLIPPAGE" },
  "search any Arc token · name / symbol / CA": { zh: "搜索任意 Arc 代币 · 名称 / 符号 / 合约", es: "busca cualquier token de Arc · nombre / símbolo / CA", ru: "поиск любого токена Arc · имя / тикер / адрес", pl: "szukaj tokena Arc · nazwa / symbol / CA" },
  "All sources": { zh: "全部来源", es: "Todas las fuentes", ru: "Все источники", pl: "Wszystkie źródła" },
  "All": { zh: "全部", es: "Todo", ru: "Все", pl: "Wszystko" },
  "New pair": { zh: "新交易对", es: "Nuevo par", ru: "Новые пары", pl: "Nowe pary" },
  "New <15m": { zh: "新 <15分", es: "Nuevo <15m", ru: "Новые <15м", pl: "Nowe <15m" },
  "Trending": { zh: "热门", es: "Tendencias", ru: "Тренды", pl: "Trending" },
  "Insider picks": { zh: "内幕精选", es: "Picks de insiders", ru: "Выбор инсайдеров", pl: "Typy insiderów" },
  "★ Watchlist": { zh: "★ 关注", es: "★ Seguimiento", ru: "★ Избранное", pl: "★ Obserwowane" },
  "Holdings": { zh: "持仓", es: "Posiciones", ru: "Позиции", pl: "Pozycje" },
  "TOKEN / AGE": { zh: "代币 / 年龄", es: "TOKEN / EDAD", ru: "ТОКЕН / ВОЗРАСТ", pl: "TOKEN / WIEK" },
  "MC": { zh: "市值", es: "MC", ru: "КАП", pl: "MC" },
  "ATH MC": { zh: "最高市值", es: "MC ATH", ru: "МАКС КАП", pl: "ATH MC" },
  "LIQ": { zh: "流动性", es: "LIQ", ru: "ЛИКВ", pl: "LIQ" },
  "VOL": { zh: "成交量", es: "VOL", ru: "ОБЪЁМ", pl: "WOL" },
  "TXS": { zh: "交易数", es: "TXS", ru: "СДЕЛКИ", pl: "TXS" },
  "SCORE": { zh: "评分", es: "SCORE", ru: "СКОР", pl: "SCORE" },
  "DEV / BUNDLE": { zh: "开发者 / 捆绑", es: "DEV / BUNDLE", ru: "ДЕВ / БАНДЛ", pl: "DEV / BUNDLE" },
  "Smart": { zh: "聪明钱", es: "Smart", ru: "Смарт", pl: "Smart" },
  "tokens · page": { zh: "代币 · 页", es: "tokens · página", ru: "токенов · стр.", pl: "tokenów · strona" },
  "← prev": { zh: "← 上一页", es: "← ant.", ru: "← назад", pl: "← poprz." },
  "next →": { zh: "下一页 →", es: "sig. →", ru: "далее →", pl: "nast. →" },
  "Sort: volume": { zh: "排序：成交量", es: "Orden: volumen", ru: "Сорт.: объём", pl: "Sortuj: wolumen" },
  "Sort: newest": { zh: "排序：最新", es: "Orden: más nuevo", ru: "Сорт.: новые", pl: "Sortuj: najnowsze" },
  "Sort: market cap": { zh: "排序：市值", es: "Orden: market cap", ru: "Сорт.: капитализация", pl: "Sortuj: kapitalizacja" },
  "Sort: trades": { zh: "排序：交易数", es: "Orden: trades", ru: "Сорт.: сделки", pl: "Sortuj: transakcje" },
  "Sort: % change": { zh: "排序：涨跌幅", es: "Orden: % cambio", ru: "Сорт.: % изм.", pl: "Sortuj: % zmiana" },
  "Sort: smart money": { zh: "排序：聪明钱", es: "Orden: smart money", ru: "Сорт.: смарт-деньги", pl: "Sortuj: smart money" },
  "min MC $": { zh: "最低市值 $", es: "MC mín $", ru: "мин. кап $", pl: "min MC $" },
  "max MC $": { zh: "最高市值 $", es: "MC máx $", ru: "макс. кап $", pl: "max MC $" },
  "min vol $": { zh: "最低成交量 $", es: "vol mín $", ru: "мин. объём $", pl: "min wol $" },
  "🔔 live": { zh: "🔔 实时", es: "🔔 en vivo", ru: "🔔 live", pl: "🔔 live" },
  // token page
  "Back to Terminal": { zh: "返回终端", es: "Volver al Terminal", ru: "Назад в терминал", pl: "Wróć do Terminalu" },
  "MCAP": { zh: "市值", es: "MCAP", ru: "КАП", pl: "MCAP" },
  "PRICE": { zh: "价格", es: "PRECIO", ru: "ЦЕНА", pl: "CENA" },
  "LIQUIDITY": { zh: "流动性", es: "LIQUIDEZ", ru: "ЛИКВИДНОСТЬ", pl: "PŁYNNOŚĆ" },
  "24H": { zh: "24小时", es: "24H", ru: "24Ч", pl: "24H" },
  "Price": { zh: "价格", es: "Precio", ru: "Цена", pl: "Cena" },
  "MCap": { zh: "市值", es: "MCap", ru: "Кап", pl: "MCap" },
  "BUY": { zh: "买入", es: "COMPRAR", ru: "КУПИТЬ", pl: "KUP" },
  "SELL": { zh: "卖出", es: "VENDER", ru: "ПРОДАТЬ", pl: "SPRZEDAJ" },
  "YOU PAY": { zh: "支付", es: "PAGAS", ru: "ВЫ ПЛАТИТЕ", pl: "PŁACISZ" },
  "TO (ESTIMATED)": { zh: "获得（预估）", es: "RECIBES (EST.)", ru: "ПОЛУЧИТЕ (ОЦЕНКА)", pl: "OTRZYMASZ (SZAC.)" },
  "slippage": { zh: "滑点", es: "slippage", ru: "проскальзывание", pl: "slippage" },
  "Connect & trade": { zh: "连接并交易", es: "Conectar y operar", ru: "Подключить и торговать", pl: "Połącz i handluj" },
  "TOKEN SCORE": { zh: "代币评分", es: "TOKEN SCORE", ru: "СКОР ТОКЕНА", pl: "TOKEN SCORE" },
  "HOLDERS": { zh: "持有人", es: "HOLDERS", ru: "ДЕРЖАТЕЛИ", pl: "HOLDERZY" },
  "VOL 24H": { zh: "24h 成交量", es: "VOL 24H", ru: "ОБЪЁМ 24Ч", pl: "WOL 24H" },
  "TXNS": { zh: "交易数", es: "TXNS", ru: "СДЕЛКИ", pl: "TXNS" },
  "TRADERS 24H": { zh: "24h 交易者", es: "TRADERS 24H", ru: "ТРЕЙДЕРЫ 24Ч", pl: "TRADERZY 24H" },
  // referrals
  "Earn 25% of the fees, forever": { zh: "永久赚取 25% 手续费", es: "Gana el 25% de las comisiones, para siempre", ru: "Зарабатывайте 25% комиссий, навсегда", pl: "Zarabiaj 25% opłat, na zawsze" },
  "Claim USDC": { zh: "领取 USDC", es: "Reclamar USDC", ru: "Забрать USDC", pl: "Odbierz USDC" },
  "Claimable now": { zh: "可领取", es: "Disponible ahora", ru: "Доступно сейчас", pl: "Do odebrania" },
  // prefs
  "Language": { zh: "语言", es: "Idioma", ru: "Язык", pl: "Język" },
  "Light theme": { zh: "浅色主题", es: "Tema claro", ru: "Светлая тема", pl: "Jasny motyw" },
  "Dark theme": { zh: "深色主题", es: "Tema oscuro", ru: "Тёмная тема", pl: "Ciemny motyw" },
};

let _lang: Lang = "en";
let _theme: Theme = "dark";
const listeners = new Set<() => void>();

function readPrefs() {
  try {
    const l = localStorage.getItem("arctools_lang") as Lang | null;
    if (l && LANGS.some(([k]) => k === l)) _lang = l;
    else { const nav = (navigator.language || "en").slice(0, 2).toLowerCase(); if (LANGS.some(([k]) => k === nav)) _lang = nav as Lang; }
    const t = localStorage.getItem("arctools_theme") as Theme | null;
    if (t === "light" || t === "dark") _theme = t;
  } catch { /* SSR / privacy mode */ }
}
let _init = false;
function ensureInit() {
  if (_init || typeof window === "undefined") return;
  _init = true;
  readPrefs();
  applyDom();
}
function applyDom() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = _lang;
  document.documentElement.dataset.theme = _theme;
  // whole-page dictionary pass (text nodes + title/placeholder), kept in sync by a MutationObserver
  void import("./i18n-dom").then((m) => m.applyLanguage(_lang)).catch(() => null);
}
function emit() { for (const l of listeners) l(); }

export function getLang(): Lang { ensureInit(); return _lang; }
export function getTheme(): Theme { ensureInit(); return _theme; }
export function setLang(l: Lang) { _lang = l; try { localStorage.setItem("arctools_lang", l); } catch { /* ignore */ } applyDom(); emit(); }
export function setTheme(t: Theme) { _theme = t; try { localStorage.setItem("arctools_theme", t); } catch { /* ignore */ } applyDom(); emit(); }

/** Translate a chrome string; unknown keys return the English text. */
export function t(s: string, lang: Lang = _lang): string {
  if (lang === "en") return s;
  return D[s]?.[lang] ?? s;
}

/** Hook: re-renders on language/theme change. SSR renders English/dark; the client swaps after mount (prefs are per browser). */
export function usePrefs(): { lang: Lang; theme: Theme; t: (s: string) => string } {
  const [, tick] = useState(0);
  useEffect(() => {
    ensureInit();
    tick((n) => n + 1);
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const lang = typeof window === "undefined" ? "en" : _lang;
  return { lang, theme: typeof window === "undefined" ? "dark" : _theme, t: (s: string) => t(s, lang) };
}
