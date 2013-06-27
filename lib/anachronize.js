var fs, path, glob, when, fn, nodefn, minimatch, template,
	jsFilesRx, readFile, extractModuleNameRx, fakeRequire;

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
readFile = nodefn.lift(fs.readFile);

// Never call this. It gets toString()'d to generate a require()
// function for the output
fakeRequire = function require(id) {
	var m = root;
	id = id.split('.');
	while(m && id.length>0) {
		m = m[id.shift()];
	}

	return m;
}

//fakeRequire = 'function require(id){return root }';

// Given some options and an array of file glob patterns to match
// UMD-formatted modules, generate an anachronism file that creates
// window globals for each module.
function anachronize(options, globs) {
	var pkg, mainTemplate, defineTemplate, name, main, ns, excludes,
		transform, writeFile;

	extractModuleNameRx = new RegExp(path.dirname(path.resolve(options.package)).replace('/', '\\/') + '\\/(.+)(\\.js)?$');

	pkg = JSON.parse(fs.readFileSync(options.package));
	mainTemplate = options.template;
	defineTemplate = options.defineTemplate;

	name = pkg.name;
	main = generateId(pkg.main || name);
	ns = name + (options.singleNamespace ? '.' : '_');

	excludes = makeExcludes(options.excludes, options.output);

	writeFile = nodefn.lift(fs.writeFile, options.output);

	// Construct a pipeline that will transform a single module
	transform = fn.compose(
		createModuleRecord,
		getTextContent,
		generateCanonicalId,
		generateGlobalName(ns, main),
		parseDependencies(ns, main),
		insertDefine(defineTemplate)
	);

	// Collect all the module files and transform them
	return [
		collectFiles,
		filterModules(excludes),
		transformModules(transform),
		buildTree,
		mergeContents,
		generateOutput(mainTemplate, main),
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
			.filter(excludes);
	};
}

// Runs a transform function on all module files
function transformModules(transform) {
	return function(modules) {
		return when.map(modules, transform);
	};
}

// Reduces a set of modules (strings) to a final output string
function generateOutput(tmpl, main) {
	return function(content) {
		// Form the final output blob
		return tmpl({
			main: main,
			content: '\n\n' + fakeRequire.toString() + '\n\n' + content
		});
	};
}

function createModuleRecord(file) {
	return { file: file };
}

// Get the text content of a file
function getTextContent(m) {
	return readFile(m.file).then(String).then(function(content) {
		m.content = content;
	}).yield(m);
}

// Generate a global var name for the module based on its
// file path.  content is left untouched, and simply threaded through
function generateCanonicalId(m) {
	m.id = generateIdFromFile(m.file);
	return m;
}

function generateIdFromFile(file) {
	return generateId(file.replace(/\.js$/, ''));
}

function generateId(relative) {
	var match, id;

	match = extractModuleNameRx.exec(path.resolve(relative));
	id = match && match[1];

	return id || relative;
}

function parseDependencies(ns, main) {
	return function(m) {
		m.deps = [];
		m.content = m.content.replace(/require\s*\(\s*.([^'"]+).\s*\)/mg,
			function(r, id) {
				id = generateId(path.resolve(path.dirname(m.file), id));
				m.deps.push(id);
				return 'require(\'' + generateGlobalNameFromId(ns, main, id) + '\')';
			}
		);

		return m;
	}
}

// This *creates a function* that will add global namespace
// to global name if necessary
function generateGlobalName(ns, main) {
	return function(m) {
		m.global = generateGlobalNameFromId(ns, main, m.id);
		return m;
	};
}

function generateGlobalNameFromId(ns, main, id) {
	var base = id.split('/');
	base = base[base.length-1];

	return base == main ? base : (ns + id.replace(/\//g, '_'));
}

// Adds a define shim for the supplied globalVarName
function insertDefine(template) {
	return function(m) {
		m.content = m.content.replace(/typeof\s+define[^}]+\}/, template(m));
		return m;
	};
}

function mergeContents(tree) {
	var seen = {};

	return foldr(function(content, m) {
		if(!seen[m.id]) {
			seen[m.id] = 1;
			return content + '\n' + m.content;
		} else {
			return content;
		}
	}, '', tree);
}

//---------------------------------------------------------
// Other helpers

function buildTree(modules) {
	var map = modules.reduce(function(map, m) {
		map[m.id] = m;
		return map;
	}, {});

	return modules.map(function(m) {
		m.deps = m.deps.reduce(function(deps, id) {
			// Skip unknown depedencies
			if(id in map) {
				deps.push(map[id]);
			};
			return deps;
		}, []);

		return m;
	});
}

function foldr(f, initial, tree) {
	return tree.reduce(function(result, node) {
		return f(foldr(f, result, node.deps), node);
	}, initial);
}

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

