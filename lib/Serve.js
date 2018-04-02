const WebSocketServer = require('ws').Server;

class Serve {
	constructor({main, config}) {
		this.server = null;
		this.wsConnections = [];

		this.messageHistory = {};

		this.initServer();
	}

	initServer() {
		this.server = new WebSocketServer({
			port: 57086,
		});

		this.server.on('connection', ws => {
			console.log('[CTR] New connection.');

			ws.sendEvents = false;

			const clientName = null;
			let authenticated = false;
			this.wsConnections.push(ws);

			ws.on('message', msg => {
				try {
					msg = JSON.parse(msg);
				} catch (ex) {
					ws.send(JSON.stringify({
						t: 'malformed',
						d: 0
					}));

					ws.close();

					return;
				}

				if (msg.t === 'auth' && msg.d === 'akdjhga2#4noiSAFGSgaFosdgadsfg') {
					authenticated = true;
				} else if (msg.t === 'listen') {
					if (ws.clientName) {
						ws.send(JSON.stringify({
							t: 'error',
							d: 'Client already has a name.',
						}));
					} else {
						ws.clientName = msg.d.name;
					}

					ws.sendEvents = true;

					if (this.messageHistory[ws.clientName] && ws.readyState === WebSocketServer.OPEN) {
						this.messageHistory[ws.clientName].forEach(d => ws.send(d));
						this.messageHistory[ws.clientName] = [];
					}
				} else if (msg.t === 'unlisten') {
					ws.sendEvents = false;

					this.messageHistory[ws.clientName] = undefined;
					delete this.messageHistory[ws.clientName];
				}
			});

			ws.on('close', (closeCode, closeMessage) => {
				console.log('[CTR] Connection closed.');

				this.wsConnections.splice(this.wsConnections.indexOf(ws), 1);

				if (ws.clientName) {
					setTimeout(() => {
						this.messageHistory[ws.clientName] = undefined;
						delete this.messageHistory[ws.clientName];
					}, 120000);
				}
			});
		});
	}

	send(t, d) {
		const data = JSON.stringify({
			t,
			d,
		});

		const skipNames = [];

		this.wsConnections.forEach((ws) => {
			if (ws.sendEvents) {
				ws.send(data);
				skipNames.push(ws.clientName);
			}
		});

		Object.entries(this.messageHistory).forEach(([clientName, history]) => {
			if (skipNames.includes(clientName)) return;

			history.push(data);
		});
	}
}

module.exports = Serve;
