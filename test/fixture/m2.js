(function(define) {
define(function(require) {

	return 'm2 ' + require('./nested/nested2');

});
}(typeof define === 'function' && define.amd ? define : function(factory) { module.exports = factory(require); }));
