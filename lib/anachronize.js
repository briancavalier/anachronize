var fs, path, glob, when, fn, nodefn, minimatch, template,
	jsFilesRx, readFile, extractModuleNameRx;

// Export anachronize function
module.exports = anachronize;

when = require('when');
fn = require('when/function');
nodefn = require('when/node/function');

fs = require('fs');
path = require('path');
glob = nodefn.lift(require('glob'));
minimatch = require('minimatch');

template = require('./template');

jsFilesRx = /\.js$/;
extractModuleNameRx = new RegExp(process.cwd().replace('/', '\\/') + '\\/(.+)\\.js$');
readFile = nodefn.lift(fs.readFile);

// Given some options and an array of file glob patterns to match
// UMD-formatted modules, generate an anachronism file that creates
// window globals for each module.
function anachronize(options, globs) {
	var pkg, mainTemplate, defineTemplate, name, main, nsSep, excludes,
		transform, writeFile;

	pkg = JSON.parse(fs.readFileSync(options.package));
	mainTemplate = options.template;
	defineTemplate = options.defineTemplate;

	name = pkg.name;
	main = pkg.main || name;
	nsSep = options.singleNamespace ? '.' : '_';

	excludes = makeExcludes(options.excludes, options.output);

	writeFile = nodefn.lift(fs.writeFile, options.output);

	// Construct a pipeline that will transform a single module
	transform = fn.compose(
		getTextContent,
		apply(generateGlobalName),
		apply(prependNamespace(name, nsSep, main)),
		apply(insertDefine(defineTemplate))
	);

	// Collect all the module files and transform them
	return [
		collectFiles,
		filterModules(excludes),
		transformModules(transform),
		mergeOutput(mainTemplate, main, nsSep),
		writeFile
	].reduce(when, globs);
}

// Collects all files matching all glob patterns in globs array
function collectFiles(globs) {
	return when.map(globs, glob);
}

// Give an array of arrays, filters out excludes and reduces
// the remaining file names to a flattened array.
function filterModules(excludes) {
	return function(fileSets) {
		return fileSets.concat.apply([], fileSets)
			.map(function(p) { return path.resolve(p); })
			.filter(excludes).sort(reverseFilename);
	};
}

// Runs a transform function on all module files
function transformModules(transform) {
	return function(modules) {
		return when.map(modules, transform);
	};
}

// Reduces a set of modules (strings) to a final output string
function mergeOutput(tmpl, main, nsSep) {
	return function(processedModules) {
		var templateData = {
			main: main,
			namespacePrefix: main + nsSep,
			content: processedModules.join('\n')
		};
		// Form the final output blob
		return tmpl(templateData);
	};
}

// Get the text content of a file
// Returns the pair [file, content]
function getTextContent(file) {
	return when.join(file, readFile(file).then(String));
}

// Generate a global var name for the module based on its
// file path.  content is left untouched, and simply threaded through
// Returns the pair [globalName, content]
function generateGlobalName(file, content) {

	var match, global;

	match = extractModuleNameRx.exec(file);
	global = match && match[1];

	if(!global) {
		throw new Error('Cannot generate global name: ' + file);
	}

	return [global, content];
}

// This *creates a function* that will add global namespace
// to global name if necessary
// The returned function returns the pair [namespacedGlobalName, content]
function prependNamespace(ns, nsSep, main) {
	return function(global, content) {
		var base = path.basename(global);
		return [base == main ? base : (ns+nsSep+global.replace(/\//g, '_')), content];
	};
}

// Adds a define shim for the supplied globalVarName
// Returns the modified content
function insertDefine(template) {
	return function(name, content) {
		return content.replace(/typeof\s+define[^}]+\}/,template({ name: name }));
	};
}

//---------------------------------------------------------
// Other helpers

function makeExcludes(excludes, outfile) {
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

function reverseFilename(a, b) {
	a = path.basename(a);
	b = path.basename(b);

	return a < b ? 1
		: a > b ? -1
			: 0;
}

// Given a function, returns a new function that accepts an array
// and spreads it onto f's argument list.
function apply(f) {
	return function(args) {
		return f.apply(this, args);
	};
}
