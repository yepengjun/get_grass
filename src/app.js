const WebSocket = require("ws")
const fs = require("fs")
const path = require("path")
const os = require("os")
const Table = require("cli-table3")
const consoleStamp = require("console-stamp")
const { v5: uuidv5, v4: uuidv4 } = require("uuid")
const { NAMESPACE, USER_IDS, WEBSOCKET_URLS, PING_INTERVAL, USER_AGENT } = require("./configs/app.config")
const { performHttpRequest, getIpAddresses } = require("./functions")

const appRoot = path.resolve(__dirname)

consoleStamp(console, { format: ":date(yyyy-mm-dd HH:MM:ss) (->).yellow" })

const getUnixTimestamp = () => Math.floor(Date.now() / 1000)

let table = new Table({
	head: ["总数", "成功数", "剩余数"],
	colWidths: [20, 40, 40]
})

let websockets = {}
let retries = 0
let lastLiveConnectionTimestamp = getUnixTimestamp()
let overview = {
	total: 0,
	successed: 0,
	successedArray: []
}


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const handleOverviewOffline = (userId) => {
	if (overview.successedArray.includes(userId)) {
		overview.successed -= 1
		overview.successedArray.splice(overview.successedArray.indexOf(userId), 1)
	}
}

const handleOverviewOnline = (userId) => {
	overview.successed += 1
	overview.successedArray.push(userId)
	table[0] = [overview.total, overview.successed, overview.total - overview.successed]
	console.log(table.toString())
}

const initialize = (ipAddress, userId) => {
	const websocketUrl = WEBSOCKET_URLS[retries % WEBSOCKET_URLS.length]

	const websocket = new WebSocket(websocketUrl, {
		localAddress: ipAddress,
		ca: fs.readFileSync(`${appRoot}/ssl/websocket.pem`, "ascii")
	})
	websockets[userId] = websocket

	const authenticate = (params) => {
		const browser_id = uuidv5(ipAddress, NAMESPACE)
		const deviceType = `vps, ${os.platform}, ${os.release()}`

		const authenticationResponse = {
			browser_id,
			user_id: userId,
			user_agent: USER_AGENT,
			timestamp: getUnixTimestamp(),
			device_type: deviceType
		}

		return authenticationResponse
	}

	const RPC_CALL_TABLE = {
		HTTP_REQUEST: performHttpRequest,
		AUTH: authenticate,
		PONG: () => {}
	}

	websocket.on("open", () => {
		console.log(ipAddress, `[${userId}]`, "Websocket打开")
	})

	websocket.on("close", (code, reason) => {
		console.log(ipAddress, `[${userId}]`, `连接关闭, code=${code}, reason=${reason}`)
		handleOverviewOffline(userId)
	})

	websocket.on("error", (error) => {
		retries++
		console.log(ipAddress, `[${userId}]`, "[连接错误]", error)
		handleOverviewOffline(userId)
	})

	websocket.on("message", async (data) => {
		// 更新上次实时连接时间戳
		lastLiveConnectionTimestamp = getUnixTimestamp()

		let parsed_message
		try {
			parsed_message = JSON.parse(data)
		} catch (e) {
			console.log(ipAddress, `[${userId}]`, "无法解析WebSocket消息!", data)
			return
		}

		// 更新概览
		if (parsed_message.action === "AUTH" && !overview.successedArray.includes(userId)) {
			handleOverviewOnline(userId)
		}

		console.log(ipAddress, `[${userId}]`, `📩 收到通信`, `Action:${parsed_message.action}`)
		if (parsed_message.action in RPC_CALL_TABLE) {
			try {
				const result = await RPC_CALL_TABLE[parsed_message.action](parsed_message.data)
				if (result) {
					websocket.send(
						JSON.stringify({
							// 使用相同的 ID，以便它可以与响应相关联
							id: parsed_message.id,
							origin_action: parsed_message.action,
							result
						})
					)
				}
			} catch (err) {
				console.log(ipAddress, `[${userId}]`, `RPC操作${parsed_message.action}遇到错误: `, err)
			}
		} else {
			console.log(ipAddress, `[${userId}]`, `没有RPC操作 ${parsed_message.action}!`)
		}
	})

	// 此函数 ping 代理服务器以保持连接处于活动状态
	const pingInterval = setInterval(async () => {
		const PENDING_STATES = [
			0, // 连接态
			2 // 关闭态
		]

		// 检查 WebSocket 状态并确保其合适
		if (PENDING_STATES.includes(websocket.readyState)) {
			console.log(ipAddress, `[${userId}]`, "WebSocket未处于适当的状态以进行活动检查...")
			return
		}

		// 检查时间戳是否早于 15 秒。 如果它
		// 连接可能已断开，我们应该重新启动它。
		const current_timestamp = getUnixTimestamp()
		const seconds_since_last_live_message = current_timestamp - lastLiveConnectionTimestamp

		if (seconds_since_last_live_message > 29 || websocket.readyState === 3) {
			console.log(ipAddress, `[${userId}]`, "WebSocket似乎还没有上线！正在重新启动 WebSocket 连接...")

			try {
				websocket.close()
				websockets[userId] = null
			} catch (e) {
				// Do nothing.
			}
			initialize(ipAddress, userId)
			clearInterval(pingInterval)
			return
		}

		// 向 websocket 发送 PING 消息，这将是从服务器回复 PONG 消息
		// 这将触发一个函数来更新lastLiveConnectionTimestamp 变量。
		// 如果这个时间戳太旧，WebSocket将被切断并重新开始。
		websocket.send(
			JSON.stringify({
				id: uuidv4(),
				version: "1.0.0",
				action: "PING",
				data: {}
			})
		)
	}, PING_INTERVAL)
}

const initializeIpAddresses = async () => {
	const ipAddresses = getIpAddresses()

	if (USER_IDS.length == 0) throw new Error("Grass ID未配置!")
	if (ipAddresses.length <= 0) throw new Error("IP地址为空!")

	const ipAddressPerUser = Math.floor(ipAddresses.length / USER_IDS.length)
	let excessIpAddress = ipAddresses.length % USER_IDS.length
	let userIpAddresses = {}

	overview.total = USER_IDS.length

	for (let i = 0; i < USER_IDS.length; i++) {
		const userId = USER_IDS[i]
		const slicedIpAddreses = ipAddresses.slice(i * ipAddressPerUser, (i + 1) * ipAddressPerUser)

		userIpAddresses[userId] = slicedIpAddreses

		if (excessIpAddress > 0) {
			const extraIpAddress = ipAddresses[ipAddresses.length - excessIpAddress]
			userIpAddresses[userId] = [...userIpAddresses[userId], extraIpAddress]
			excessIpAddress = excessIpAddress - 1
		}

		if (ipAddresses.length == 1) {
			// 单ip
			initialize(ipAddresses[0], userId)
			await sleep(3000)
		}
		if (ipAddresses.length > 1) {
			// vps多ip服务器分配ip
			for (let j = 0; j < userIpAddresses[userId].length; j++) {
				const ipAddress = userIpAddresses[userId][j]
				initialize(ipAddress, userId)
				await sleep(3000)
			}
		}
	}
}

initializeIpAddresses()
