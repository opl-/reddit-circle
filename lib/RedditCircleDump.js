// const RedditSocket = require('./RedditSocket');
const Serve = require('./Serve');
const mysql = require('mysql2/promise');
const request = require('./request');

module.exports = class RedditCircleDump {
	constructor(config) {
		this.mysqlPool = mysql.createPool(config.mysql);

		// this.socket = new RedditSocket({config, main: this});

		this.serve = new Serve({config, main: this});

		setInterval(() => this.fetchNew().catch(err => console.error(err)), 1500);
	}

	async fetchNew() {
		const now = Date.now();

		const json = await request.fetchRedditData({
			path: '/r/CircleofTrust/new.json?limit=100',
		});

		const {conn, callback} = await this.getMySQLConnection();

		try {
			const circles = {};
			json.data.children.map(({data}) => {
				circles[data.id] = data;
			});

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
				const existingIDs = result.map(r => r.id);

				Object.keys(circles).filter(id => !existingIDs.includes(id)).forEach((id) => {
					const circle = circles[id];

					if (!circle.circlepost_websocket_url) return;

					this.serve.send('circle-new', {
						id: circle.id,
						created: circle.created_utc * 1000,
						title: circle.title,
						score: circle.score,
						betrayed: circle.is_betrayed,
						outside: null,
						websocket: circle.circlepost_websocket_url,
						author: circle.author,
					});
				});
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
