module.exports = function template(t, data) {
	return t.replace(/\{\{(\w+)\}\}/g, function(s, key) {
		return data[key] || '';
	});
};