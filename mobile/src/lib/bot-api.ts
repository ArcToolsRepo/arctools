/** API bases as seen from the APP. No same-origin proxy here: the WebView talks to the bot and the site directly
 *  (both answer with CORS *). The site's edge-cached /bot proxy is used for the hot public reads so a thousand
 *  phones cost the bot nothing extra — the same trick the web Terminal uses. */
export const BOT_ORIGIN = "https://bot-production-4200.up.railway.app";
export const SITE = "https://arctools.fun";
/** Public, identical-for-everyone reads go through the site's edge cache; everything else straight to the bot. */
export const BOT_API = `${SITE}/bot`;
export const BOT_DIRECT = BOT_ORIGIN;
