const WebSocket = require('ws');

module.exports = class RedditSocket {
	constructor({main, config}) {
		this.main = main;
		this.config = config;

		this.sendQueue = [];

		this.connect();
	}

	connect() {
		console.log(`${Date.now()} reconnecting...`);

		this.socket = new WebSocket(this.config.websocketURL);

		this.socket.on('open', this.onOpen.bind(this));
		this.socket.on('close', this.onClose.bind(this));
		this.socket.on('message', this.onMessage.bind(this));
	}

	send(msg) {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			this.sendQueue.push(msg);
		} else {
			this.socket.send(msg);
		}
	}

	onOpen() {
		console.log(`${Date.now()} socket open`);

		this.send('hello');

		this.sendQueue.forEach((msg) => {
			this.socket.send(msg);
		});

		this.sendQueue.splice(0);
	}

	onClose() {
		console.log(`${Date.now()} socket closed, reconnecting in 1s`);

		this.socket = null;

		setTimeout(() => this.connect(), 1000);
	}

	async onMessage(data) {
		const {conn, callback} = await this.main.getMySQLConnection();

		await conn.query('INSERT INTO `dump` (`timestamp`, `data`) VALUES (?, ?)', [
			Date.now(),
			data,
		]);

		await callback();
	}
};
