const mysql = require('mysql2/promise');
const request = require('./request');
const ListenerManager = require('./ListenerManager');

module.exports = class RedditCircleDump {
	constructor(config) {
		this.mysqlPool = mysql.createPool(config.mysql);

		this.circles = {};
		this.topCount = 0;
		this.topNextID = null;
		this.topListCycle = 0;
		this.searchCount = 0;
		this.searchNextID = null;
		this.searchListCycle = 0;

		this.listenerManager = new ListenerManager({config, main: this});

		// Timeout to allow clients to reconnect and report circles they're connected to
		setTimeout(() => this.queryCircles(), 5000);

		this.cycle = 0;

		setInterval(() => {
			this.cycle++;

			if (this.cycle % 3 === 0) {
				this.fetchNew().catch(err => console.error(err));
			} else if (this.cycle % 3 === 1) {
				this.fetchTop().catch(err => console.error(err));
			} else {
				this.fetchSearch().catch(err => console.error(err));
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

		await this.processListing(json, now);
	}

	async fetchTop() {
		const now = Date.now();

		const listing = ['new', 'hot', 'rising', 'top', 'gilded'][this.topListCycle % 5];

		const json = await request.fetchRedditData({
			path: `/r/CircleofTrust/${listing}.json?limit=100${this.topNextID ? `&after=${this.topNextID}&count=${this.topCount}` : ''}`,
		});

		this.topNextID = json.data.after;
		this.topCount += json.data.dist;

		if (!this.topNextID) {
			console.log(`Going back to page 1. Finished listing: ${listing} (count=${this.topCount})`);
			this.topCount = 0;
			this.topListCycle++;
		}

		await this.processListing(json, now);
	}

	async fetchSearch() {
		const now = Date.now();

		const listing = ['new', 'relevance', 'comments'][this.searchListCycle % 3];

		const json = await request.fetchRedditData({
			path: `/r/CircleofTrust/search.json?q=self%3Ano&restrict_sr=on&include_over_18=on&sort=${listing}&t=all&limit=100${this.searchNextID ? `&after=${this.searchNextID}&count=${this.searchCount}` : ''}`,
		});

		this.searchNextID = json.data.after;
		this.searchCount += json.data.dist;

		if (!this.searchNextID) {
			console.log(`Going back to page 1. Finished search: ${listing} (count=${this.searchCount})`);
			this.searchCount = 0;
			this.searchListCycle++;
		}

		await this.processListing(json, now);
	}

	async processListing(json, now = Date.now()) {
		const {conn, callback} = await this.getMySQLConnection();

		try {
			const children = json.data.children.filter(c => typeof c.data.is_betrayed === 'boolean');

			if (children.length === 0) return;

			const [result] = await conn.query('SELECT `id` FROM `circle` WHERE `id` IN (?) AND `websocket` IS NOT NULL', [
				json.data.children.map(({data}) => data.id),
			]);

			await conn.query('INSERT INTO `circle` (`id`, `timestamp`, `created`, `title`, `score`, `betrayed`, `outside`, `websocket`, `author`, `authorBetrayer`) VALUES ? ON DUPLICATE KEY UPDATE `score` = VALUES(`score`), `betrayed` = VALUES(`betrayed`), `outside` = IF(VALUES(`outside`) = -1, `outside`, VALUES(`outside`)), `websocket` = VALUES(`websocket`), `authorBetrayer` = IF(VALUES(`authorBetrayer`) IS NULL, `authorBetrayer`, VALUES(`authorBetrayer`))', [children.map(({data}) => [
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

			await conn.query('INSERT INTO `circlestatus` (`circle`, `timestamp`, `score`, `betrayed`, `outside`, `authorBetrayer`) VALUES ? ON DUPLICATE KEY UPDATE `circle` = VALUES(`circle`)', [children.map(({data}) => [
				data.id,
				now,
				data.score,
				data.is_betrayed,
				(/, (\d+)/.exec((data.author_flair_text || '')) || [0, -1])[1],
				data.author_flair_text ? data.author_flair_text.includes('∅') : null,
			])]);

			if (result.length > 0) {
				const circles = {};
				children.map(({data}) => {
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
			console.log('children=', json.data.children.length);
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
