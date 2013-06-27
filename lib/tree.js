module.exports = function makeTree(key, children) {

	return {
		fromArray: fromArray,
		foldr: foldr
	};

	function fromArray(array) {
		var map = array.reduce(function(map, m) {
			map[m[key]] = m;
			return map;
		}, {});

		return array.map(function(m) {
			m[children] = m[children].reduce(function(deps, id) {
				// Skip unknown keys
				if(id in map) {
					deps.push(map[id]);
				}
				return deps;
			}, []);

			return m;
		});
	}

	function foldr(f, initial, tree) {
		return tree.reduce(function(result, node) {
			return f(foldr(f, result, node[children]), node);
		}, initial);
	}
}
