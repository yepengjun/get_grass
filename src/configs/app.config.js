const { IDS } = require("./ids.config")

module.exports = {
	USER_IDS: IDS,
	WEBSOCKET_URLS: ["wss://proxy.wynd.network:4650", "wss://proxy.wynd.network:4444"],
	NAMESPACE: "bfeb71b6-06b8-5e07-87b2-c461c20d9ff6",
	PING_INTERVAL: 20 * 1000, // 20s in ms
	COOKIE_JAR_LIFESPAN: 60 * 60 * 24 * 1000, // 24hrs in ms
	// 限制使用VPS的ip数量, NaN为不限制
	IP_LIMIT: NaN,
	USER_AGENT: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
}
