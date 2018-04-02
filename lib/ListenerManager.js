const WebSocketServer = require('ws').Server;
const Listener = require('./Listener');

module.exports = class ListenerManager {
	constructor({main, config}) {
		this.main = main;
		this.config = config;

		this.server = null;

		this.listeners = [];
		this.joinQueue = [];
		this.nextListener = 0;

		this.initServer();
	}

	initServer() {
		this.server = new WebSocketServer({
			port: 57086,
		});

		this.server.on('connection', (socket) => {
			console.log('[CTR] New connection.');

			const listener = new Listener({
				main: this.main,
				config: this.config,
				socket,
			});

			this.listeners.push(listener);

			listener.on('auth', () => {
				this.joinQueue = this.joinQueue.filter(circleID => !listener.circles[circleID]);
			});

			listener.on('next-circle', () => {
				const nextCircle = this.getNextCircle();

				if (nextCircle) listener.joinCircle(nextCircle);
			});

			listener.on('destroy', () => {
				Array.prototype.push.apply(this.joinQueue, Object.keys(listener.circles));
				this.listeners.splice(this.listeners.indexOf(listener), 1);
			});

			listener.on('circle-status', (circle) => {
				this.main.onCircleStatus(circle);
			});
		});
	}

	onNewCircle(circle) {
		this.joinQueue.push(circle.id);
	}

	getNextCircle() {
		if (this.joinQueue.length === 0) return null;

		return this.main.circles[this.joinQueue.shift()];
	}

	send(t, d) {
		const data = JSON.stringify({
			t,
			d,
		});

		this.wsConnections.forEach((ws) => {
			ws.send(data);
		});
	}
}
