const https = require('https');

module.exports = class DataFetcher {
	static fetchData(opts) {
		return new Promise((resolve, reject) => {
			const req = https.request({
				...(opts.url ? url.parse(opts.url) : {}),
				...opts,
				protocol: 'https:',
			}, (res) => {
				const body = [];

				res.on('data', (d) => {
					body.push(d);
				});

				res.on('end', () => {
					resolve(Buffer.concat(body).toString('utf-8'));
				});
			});

			req.on('error', reject);

			if (opts.payload) req.write(opts.payload);

			req.end();
		});
	}

	static async fetchJSON(opts) {
		const data = await DataFetcher.fetchData(opts);
		let json;

		try {
			json = JSON.parse(data);
		} catch (ex) {
			console.log('json parse error, data:', data);
			throw ex;
		}

		return json;
	}

	static async fetchRedditData(opts) {
		return DataFetcher.fetchJSON({
			hostname: 'www.reddit.com',
			headers: {
				'User-Agent': 'node:circle.bopl.cf:1.0.0 (by /u/opl_)',
				...opts.headers,
			},
			...opts,
		});
	}
};
