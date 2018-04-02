const {EventEmitter} = require('events');

module.exports = class Listener extends EventEmitter {
	constructor({main, config, socket}) {
		super();

		this.main = main;
		this.config = config;
		this.socket = socket;

		this.name = null;
		this.authenticated = false;

		this.circles = [];

		this.socket.on('message', this.onMessage.bind(this));
		this.socket.on('close', this.onClose.bind(this));
		this.socket.on('error', this.onError.bind(this));
	}

	onMessage(msg) {
		try {
			msg = JSON.parse(msg);
		} catch (ex) {
			this.socket.send(JSON.stringify({
				t: 'malformed',
				d: 0
			}));

			this.socket.close();

			return;
		}

		if (msg.t === 'auth' && msg.d.auth === this.config.ws.auth) {
			this.authenticated = true;
			this.name = msg.d.name;
			this.circles = msg.d.circles;

			this.emit('auth');

			this.intervalID = setInterval(() => this.emit('next-circle'), 200);
		} else if (!this.authenticated) {
			this.socket.send('{"t":"error","d":"unauthenticated"}');
			this.socket.close();
		} else if (msg.t === 'circle-status') {
			if (msg.d.betrayed) this.circles.splice(this.circles.indexOf(msg.d.id), 1);

			this.emit('circle-status', msg.d);
		} else if (msg.t === 'stats') {
			this.stats = msg.d;
		} else if (msg.t === 'unknown-type') {
			console.log(`unknown type from ${JSON.stringify(this.name)}`, msg.d);
		}
	}

	onClose() {
		console.log(`${Date.now()} Listener ${JSON.stringify(this.name)} disconnected - destroying`);

		clearInterval(this.intervalID);
		this.intervalID = null;

		this.emit('destroy');
	}

	onError(err) {
		console.error(this.name, err);
	}

	joinCircle(circle) {
		this.circles.push(circle.id);

		this.send('circle-join', circle);
	}

	send(t, d) {
		const msg = JSON.stringify({
			t,
			d,
		});

		this.socket.send(msg);
	}
};
