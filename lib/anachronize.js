var fs, path, glob, when, fn, nodefn, makeExcludes, template, depTree,
	jsFilesRx, extractModuleNameRx, mainTemplate, moduleTemplate,
	fakeRequire, defineTemplate;

// Export anachronize function
module.exports = anachronize;

when = require('when');
fn = require('when/function');
nodefn = require('when/node/function');

fs = require('fs');
path = require('path');
glob = nodefn.lift(require('glob'));

template = require('./template');
makeExcludes = require('./makeExcludes');
depTree = require('./tree')('id', 'deps');

jsFilesRx = /\.js$/;

fakeRequire = 'function __anachronizeRequire(id){ var m = __anachronizeRoot;id = id.split(\'.\');while(m && id.length>0) { m = m[id.shift()]; } return m; };';
defineTemplate = template.bind(null, 'function(factory){__anachronizeRoot.{{global}}=factory(__anachronizeRequire);}');
mainTemplate = template.bind(null, ';(function(__anachronizeRoot){\n{{content}}\n}(this));');
moduleTemplate = template.bind(null, '\n//----------------------------------------------\n// Module: {{id}}\n{{content}}');

// Given some options and an array of file glob patterns to match
// UMD-formatted modules, generate an anachronism file that creates
// window globals for each module.
function anachronize(options, globs) {
	var pkg, name, main, ns, excludes,
		transform, writeFile;

	extractModuleNameRx = new RegExp(path.dirname(path.resolve(options.package)).replace('/', '\\/') + '\\/(.+)(\\.js)?$');

	pkg = JSON.parse(fs.readFileSync(options.package));

	name = pkg.name;
	main = generateId(pkg.main || name);
	ns = name + (options.singleNamespace ? '.' : '_');

	excludes = makeExcludes(options.excludes, options.output);

	writeFile = options.output ? nodefn.lift(fs.writeFile, options.output) : console.log.bind(console);

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
		depTree.fromArray,
		mergeContents(moduleTemplate),
		generateOutput(mainTemplate, main),
		writeFile
	].reduce(when, globs);
}

//------------------------------------------------------------
// Main pipeline steps

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

function mergeContents(tmpl) {
	return function(tree) {
		var seen = {};

		return depTree.foldr(function(content, m) {
			if(!seen[m.id]) {
				seen[m.id] = 1;
				return content + tmpl(m);
			} else {
				return content;
			}
		}, '', tree);
	};
}

// Reduces a set of modules (strings) to a final output string
function generateOutput(tmpl, main) {
	return function(content) {
		// Form the final output blob
		return tmpl({
			main: main,
			content: fakeRequire + content
		});
	};
}

//------------------------------------------------------------
// Module tranforms

function createModuleRecord(file) {
	return { file: file };
}

// Get the text content of a file
function getTextContent(m) {
	return nodefn.call(fs.readFile, m.file).then(String).then(function(content) {
		m.content = content;
	}).yield(m);
}

// Generate a global var name for the module based on its
// file path.  content is left untouched, and simply threaded through
function generateCanonicalId(m) {
	m.id = generateIdFromFile(m.file);
	return m;
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
	};
}

// This *creates a function* that will add global namespace
// to global name if necessary
function generateGlobalName(ns, main) {
	return function(m) {
		m.global = generateGlobalNameFromId(ns, main, m.id);
		return m;
	};
}

// Adds a define shim for the supplied globalVarName
function insertDefine(template) {
	return function(m) {
		m.content = m.content.replace(/typeof\s+define[^}]+\}/, template(m));
		return m;
	};
}

//------------------------------------------------------------
// Id and global helpers

function generateIdFromFile(file) {
	return generateId(file.replace(/\.js$/, ''));
}

function generateId(relative) {
	var match, id;

	match = extractModuleNameRx.exec(path.resolve(relative));
	id = match && match[1];

	return id || relative;
}

function generateGlobalNameFromId(ns, main, id) {
	var base = id.split('/');
	base = base[base.length-1];

	return base == main ? base : (ns + id.replace(/\//g, '_'));
}

