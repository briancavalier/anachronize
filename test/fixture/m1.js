(function(define) {
define(function(require) {

	var s = require('./single');
	return 'm1 ' + s.value;

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));
