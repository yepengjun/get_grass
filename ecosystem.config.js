// App's PM2 Config file
require("dotenv").config()

module.exports = {
	apps: [
		{
			name: "grass",
			script: "./src/app.js",
			instances: 4,
			merge_logs: true,
			node_args: ["--max-http-header-size=1073741824"],
			exec_mode: "cluster"
			// watch: ["./src"],
			// ignore_watch: ["node_modules", "scripts", "\\.git"]
		}
	]
}
