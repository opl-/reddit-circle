/* eslint-disable */

const config = require('./config.default');

function merge(obj1, obj2) {
	Object.keys(obj2).forEach((k) => {
		if (Object.prototype.toString.call(obj2[k]) === '[object Object]') {
			if (Object.prototype.toString.call(obj1[k]) !== '[object Object]') obj1[k] = {};

			merge(obj1[k], obj2[k]);
		} else {
			obj1[k] = obj2[k];
		}
	});
}

if (process.env.NODE_ENV !== 'production') {
	try {
		const devConfig = require('./config.dev');

		merge(config, devConfig);
	} catch (ex) {
		if (ex.code !== 'MODULE_NOT_FOUND') throw ex;
		console.warn('No development backend config found!');
	}
} else {
	try {
		const prodConfig = require('./config.prod');

		merge(config, prodConfig);
	} catch (ex) {
		if (ex.code !== 'MODULE_NOT_FOUND') throw ex;
		console.warn('No production backend config found!');
	}
}

module.exports = config;
