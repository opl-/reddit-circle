const mysql = require('mysql2/promise');
const request = require('./request');
const ListenerManager = require('./ListenerManager');

module.exports = class RedditCircleDump {
	constructor(config) {
		this.mysqlPool = mysql.createPool(config.mysql);

		this.circles = {};
		this.count = 0;
		this.nextID = null;

		this.listenerManager = new ListenerManager({config, main: this});

		// Timeout to allow clients to reconnect and report circles they're connected to
		setTimeout(() => this.queryCircles(), 5000);

		this.cycle = 0;

		setInterval(() => {
			this.cycle++;

			if (this.cycle % 4 === 0) {
				this.fetchNew().catch(err => console.error(err));
			} else {
				this.fetchOld().catch(err => console.error(err));
			}
		}, 1100);
	}

	async queryCircles() {
		const {conn, callback} = await this.getMySQLConnection();

		try {
			const [result] = await conn.query('SELECT `id`, `websocket` FROM `circle` WHERE `betrayed` = 0');

			console.log(`Loaded ${result.length} circles`);

			result.forEach((r) => {
				this.addCircle({
					id: r.id,
					websocket: r.websocket,
				});
			});

			callback();
		} catch (err) {
			console.log(err);
			callback(err);
		}
	}

	addCircle(circle) {
		if (!circle.new && this.circles[circle.id]) {
			return;
		}

		this.circles[circle.id] = circle;

		this.listenerManager.onNewCircle(circle);
	}

	async fetchNew() {
		const now = Date.now();

		const json = await request.fetchRedditData({
			path: '/r/CircleofTrust/new.json?limit=100',
		});

		if (!json.data) {
			return;
		}

		if (this.nextID === null) {
			this.nextID = json.data.after;
			this.count = 0;
		}

		await this.processListing(json, now);
	}

	async fetchOld() {
		if (this.nextID === null) return;

		const now = Date.now();

		const json = await request.fetchRedditData({
			path: `/r/CircleofTrust/new.json?limit=100${this.nextID ? `&after=${this.nextID}&count=${this.count}` : ''}`,
		});

		if (!json.data.after) {
			this.nextID = null;
			console.log('Going back to page 1');
		}

		this.count += json.data.dist;

		await this.processListing(json, now);
	}

	async processListing(json, now = Date.now()) {
		const {conn, callback} = await this.getMySQLConnection();

		try {
			const [result] = await conn.query('SELECT `id` FROM `circle` WHERE `id` IN (?) AND `websocket` IS NOT NULL', [
				json.data.children.map(({data}) => data.id),
			]);

			await conn.query('INSERT INTO `circle` (`id`, `timestamp`, `created`, `title`, `score`, `betrayed`, `outside`, `websocket`, `author`, `authorBetrayer`) VALUES ? ON DUPLICATE KEY UPDATE `score` = VALUES(`score`), `betrayed` = VALUES(`betrayed`), `outside` = IF(VALUES(`outside`) = -1, `outside`, VALUES(`outside`)), `websocket` = VALUES(`websocket`), `authorBetrayer` = IF(VALUES(`authorBetrayer`) IS NULL, `authorBetrayer`, VALUES(`authorBetrayer`))', [json.data.children.map(({data}) => [
				data.id,
				now,
				data.created_utc * 1000,
				data.title,
				data.score,
				data.is_betrayed,
				(/, (\d+)/.exec((data.author_flair_text || '')) || [0, -1])[1],
				data.circlepost_websocket_url,
				data.author,
				data.author_flair_text ? data.author_flair_text.includes('∅') : null,
			])]);

			await conn.query('INSERT INTO `circlestatus` (`circle`, `timestamp`, `score`, `betrayed`, `outside`, `authorBetrayer`) VALUES ? ON DUPLICATE KEY UPDATE `circle` = VALUES(`circle`)', [json.data.children.map(({data}) => [
				data.id,
				now,
				data.score,
				data.is_betrayed,
				(/, (\d+)/.exec((data.author_flair_text || '')) || [0, -1])[1],
				data.author_flair_text ? data.author_flair_text.includes('∅') : null,
			])]);

			if (result.length > 0) {
				const circles = {};
				json.data.children.map(({data}) => {
					circles[data.id] = data;
				});

				const existingIDs = result.map(r => r.id);

				Object.keys(circles).filter(id => !existingIDs.includes(id)).forEach((id) => {
					const circle = circles[id];

					if (!circle.circlepost_websocket_url) return;

					this.addCircle({
						id: circle.id,
						websocket: circle.circlepost_websocket_url,
						new: true,
					});
				});
			}

			callback();
		} catch (err) {
			callback(err);
		}
	}

	async onCircleStatus(data) {
		const {conn, callback} = await this.getMySQLConnection();

		try {
			await conn.query('INSERT INTO `circlestatus` (`circle`, `timestamp`, `score`, `betrayed`, `outside`, `authorBetrayer`) VALUES ? ON DUPLICATE KEY UPDATE `circle` = VALUES(`circle`)', [[
				data.id,
				data.timestamp,
				data.score,
				data.betrayed,
				data.outside,
				data.authorBetrayer || null,
			]]);

			if (data.betrayed) {
				this.circles[data.id] = undefined;
				delete this.circles[data.id];
			}

			callback();
		} catch (err) {
			callback(err);
		}
	}

	async getMySQLConnection() {
		const conn = await this.mysqlPool.getConnection();
		await conn.query('BEGIN');

		return {
			conn,
			async callback(err) {
				if (err && err !== 'request failed') console.error(err);

				await conn.query(err ? 'ROLLBACK' : 'COMMIT');
				conn.release();
			},
		};
	}
};
