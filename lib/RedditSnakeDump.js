const RedditSocket = require('./RedditSocket');
const mysql = require('mysql2/promise');

module.exports = class RedditSnakeDump {
	constructor(config) {
		this.mysqlPool = mysql.createPool(config.mysql);

		this.socket = new RedditSocket({config, main: this});
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
