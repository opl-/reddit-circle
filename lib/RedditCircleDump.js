const mysql = require('mysql2/promise');
const request = require('./request');
const ListenerManager = require('./ListenerManager');

module.exports = class RedditCircleDump {
	constructor(config) {
		this.mysqlPool = mysql.createPool(config.mysql);

		this.circles = {};

		this.listenerManager = new ListenerManager({config, main: this});

		// Timeout to allow clients to reconnect and report circles they're connected to
		setTimeout(() => this.queryCircles(), 5000);

		setInterval(() => this.fetchNew().catch(err => console.error(err)), 1500);
	}

	async queryCircles() {
		const {conn, callback} = await this.getMySQLConnection();

		try {
			const trackedCircles = Array.prototype.concat.apply([], this.listenerManager.listeners.map(l => l.circles));

			if (trackedCircles.length === 0) return callback();

			const [result] = await conn.query('SELECT `id`, `websocket` FROM `Circle` WHERE `betrayed` = 0 AND `id` IS NOT IN (?)', [
				trackedCircles,
			]);

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
		this.circles[circle.id] = circle;

		this.listenerManager.onNewCircle(circle);
	}

	async fetchNew() {
		const now = Date.now();

		const json = await request.fetchRedditData({
			path: '/r/CircleofTrust/new.json?limit=100',
		});

		const {conn, callback} = await this.getMySQLConnection();

		try {
			const [result] = await conn.query('SELECT `id` FROM `Circle` WHERE `id` IN (?) AND `websocket` IS NOT NULL', [
				json.data.children.map(({data}) => data.id),
			]);

			await conn.query('INSERT INTO `Circle` (`id`, `timestamp`, `created`, `title`, `score`, `betrayed`, `outside`, `websocket`, `author`) VALUES ? ON DUPLICATE KEY UPDATE `score` = VALUES(`score`), `betrayed` = VALUES(`betrayed`), `websocket` = VALUES(`websocket`)', [json.data.children.map(({data}) => [
				data.id,
				now,
				data.created_utc * 1000,
				data.title,
				data.score,
				data.is_betrayed,
				-1,
				data.circlepost_websocket_url,
				data.author,
			])]);

			await conn.query('INSERT INTO `CircleStatus` (`circleID`, `timestamp`, `score`, `betrayed`, `outside`) VALUES ? ON DUPLICATE KEY UPDATE `score` = VALUES(`score`), `betrayed` = VALUES(`betrayed`)', [json.data.children.map(({data}) => [
				data.id,
				now,
				data.score,
				data.is_betrayed,
				-1,
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

					this.addCircle('circle-new', {
						id: circle.id,
						websocket: circle.circlepost_websocket_url,
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
			await conn.query('INSERT INTO `CircleStatus` (`circleID`, `timestamp`, `score`, `betrayed`, `outside`) VALUES ? ON DUPLICATE KEY UPDATE `score` = VALUES(`score`), `betrayed` = VALUES(`betrayed`), `outside` = VALUES(`outside`)', [[
				data.id,
				data.timestamp,
				data.score,
				data.betrayed,
				data.outside,
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
