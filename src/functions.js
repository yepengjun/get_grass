const os = require("os")
const { default: got } = require("got")
const { createFetch } = require("got-fetch")
const { CookieJar } = require("tough-cookie")
const { NAMESPACE, USER_IDS, WEBSOCKET_URLS, PING_INTERVAL, USER_AGENT, COOKIE_JAR_LIFESPAN, IP_LIMIT } = require("./configs/app.config")
const { prettifyHeaderKey } = require("./utils")

let cookieJars = {}

const performHttpRequest = async (params) => {
	const sessionHasCookieJar = !!cookieJars[params.session_id]

	if (!sessionHasCookieJar) {
		cookieJars[params.session_id] = new CookieJar()

		// 24 小时后删除此会话的新 cookie jar 实例
		const cookieJarTimeout = setTimeout(() => {
			delete cookieJars[params.session_id]
			console.log(`[COOKIE] ${params.session_id} 的Cookie Jar已删除`)
			clearTimeout(cookieJarTimeout)
		}, COOKIE_JAR_LIFESPAN)
	}

	const extendedGot = got.extend({
		localAddress: params.device_ip,
		encoding: "base64",
		cookieJar: cookieJars[params.session_id],
		maxHeaderSize: 49152,
		hooks: {
			beforeRequest: [
				(options) => {
					let headers = {}
					for (const [key, value] of Object.entries(options.headers)) {
						const prettifiedHeader = prettifyHeaderKey(key)
						headers[prettifiedHeader] = value
					}
					options.headers = headers
				}
			]
		}
	})
	const gotFetch = createFetch(extendedGot)

	// 发送请求时是否包含cookies
	const credentials_mode = params.authenticated ? "include" : "omit"

	const requestOptions = {
		headers: params.headers,
		method: params.method,
		credentials: credentials_mode,
		mode: "cors",
		cache: "no-cache",
		redirect: "follow"
	}

	// 如果有请求正文，我们对其进行解码, 并为请求设置它。
	if (params.body) {
		const bufferBody = Buffer.from(params.body, "base64")
		requestOptions.body = bufferBody
	}

	let response = null
	try {
		response = await gotFetch(params.url, requestOptions)
	} catch (err) {
		console.error("[FETCH ERROR]", params.device_ip, params.method, params.url, err)
		return
	}

	// response.headers 是可迭代对象 headers （不是 json）,所以我们必须在返回之前手动复制
	const headers = {}
	for (const [key, value] of response.headers.entries()) {
		headers[key] = value
	}
	// 删除 :status 标头
	delete headers[":status"]

	return {
		url: response.url,
		status: response.status,
		status_text: response.statusText,
		headers,
		body: response.body
	}
}

const getIpAddresses = () => {
	const networkInterfaces = os.networkInterfaces()
	const interfaces = Object.values(networkInterfaces)
	const ipAddresses = interfaces
		.filter((interface) => {
			const ipv4Interface = interface.find((int) => int.family.toLocaleLowerCase() === "ipv4")

			// 忽略 127.0.0.1，因为它代表 localhost
			return !!ipv4Interface && ipv4Interface.address !== "127.0.0.1"
		})
		.map((interface) => {
			const ipv4Interface = interface.find((int) => int.family.toLocaleLowerCase() === "ipv4")

			return ipv4Interface.address
		})

	if (!Number.isNaN(IP_LIMIT) && IP_LIMIT > 0) {
		return ipAddresses.slice(0, IP_LIMIT)
	}

	return ipAddresses
}

module.exports = {
	performHttpRequest,
	getIpAddresses
}
