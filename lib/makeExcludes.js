var path, minimatch;

path = require('path');
minimatch = require('minimatch');

module.exports = function makeExcludes(excludes, outfile) {
	var ex;

	if(!excludes) {
		return function() { return true; };
	} else {
		ex = Array.isArray(excludes) ? excludes : [excludes];
	}

	// Ensure we never include the output file in the input!
	outfile = path.resolve(outfile);
	ex = ex.map(minimatch.filter).concat(function(p) {
		return p === outfile;
	});

	return function(p) {
		return !ex.some(function(mm) {
			return mm(p);
		});
	};
}