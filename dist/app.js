(function () {
	'use strict';

	const PATH_SEPARATOR = '.';
	const TARGET = Symbol('target');
	const UNSUBSCRIBE = Symbol('unsubscribe');

	function isBuiltinWithMutableMethods(value) {
		return value instanceof Date
			|| value instanceof Set
			|| value instanceof Map
			|| value instanceof WeakSet
			|| value instanceof WeakMap
			|| ArrayBuffer.isView(value);
	}

	function isBuiltinWithoutMutableMethods(value) {
		return (typeof value === 'object' ? value === null : typeof value !== 'function') || value instanceof RegExp;
	}

	var isArray = Array.isArray;

	function isSymbol(value) {
		return typeof value === 'symbol';
	}

	const path = {
		after(path, subPath) {
			if (isArray(path)) {
				return path.slice(subPath.length);
			}

			if (subPath === '') {
				return path;
			}

			return path.slice(subPath.length + 1);
		},
		concat(path, key) {
			if (isArray(path)) {
				path = [...path];

				if (key) {
					path.push(key);
				}

				return path;
			}

			if (key && key.toString !== undefined) {
				if (path !== '') {
					path += PATH_SEPARATOR;
				}

				if (isSymbol(key)) {
					return path + key.toString();
				}

				return path + key;
			}

			return path;
		},
		initial(path) {
			if (isArray(path)) {
				return path.slice(0, -1);
			}

			if (path === '') {
				return path;
			}

			const index = path.lastIndexOf(PATH_SEPARATOR);

			if (index === -1) {
				return '';
			}

			return path.slice(0, index);
		},
		last(path) {
			if (isArray(path)) {
				return path.at(-1) ?? '';
			}

			if (path === '') {
				return path;
			}

			const index = path.lastIndexOf(PATH_SEPARATOR);

			if (index === -1) {
				return path;
			}

			return path.slice(index + 1);
		},
		walk(path, callback) {
			if (isArray(path)) {
				for (const key of path) {
					callback(key);
				}
			} else if (path !== '') {
				let position = 0;
				let index = path.indexOf(PATH_SEPARATOR);

				if (index === -1) {
					callback(path);
				} else {
					while (position < path.length) {
						if (index === -1) {
							index = path.length;
						}

						callback(path.slice(position, index));

						position = index + 1;
						index = path.indexOf(PATH_SEPARATOR, position);
					}
				}
			}
		},
		get(object, path) {
			this.walk(path, key => {
				if (object) {
					object = object[key];
				}
			});

			return object;
		},
		isSubPath(path, subPath) {
			if (isArray(path)) {
				if (path.length < subPath.length) {
					return false;
				}

				// eslint-disable-next-line unicorn/no-for-loop
				for (let i = 0; i < subPath.length; i++) {
					if (path[i] !== subPath[i]) {
						return false;
					}
				}

				return true;
			}

			if (path.length < subPath.length) {
				return false;
			}

			if (path === subPath) {
				return true;
			}

			if (path.startsWith(subPath)) {
				return path[subPath.length] === PATH_SEPARATOR;
			}

			return false;
		},
		isRootPath(path) {
			if (isArray(path)) {
				return path.length === 0;
			}

			return path === '';
		},
	};

	function isIterator(value) {
		return typeof value === 'object' && typeof value.next === 'function';
	}

	// eslint-disable-next-line max-params
	function wrapIterator(iterator, target, thisArgument, applyPath, prepareValue) {
		const originalNext = iterator.next;

		if (target.name === 'entries') {
			iterator.next = function () {
				const result = originalNext.call(this);

				if (result.done === false) {
					result.value[0] = prepareValue(
						result.value[0],
						target,
						result.value[0],
						applyPath,
					);
					result.value[1] = prepareValue(
						result.value[1],
						target,
						result.value[0],
						applyPath,
					);
				}

				return result;
			};
		} else if (target.name === 'values') {
			const keyIterator = thisArgument[TARGET].keys();

			iterator.next = function () {
				const result = originalNext.call(this);

				if (result.done === false) {
					result.value = prepareValue(
						result.value,
						target,
						keyIterator.next().value,
						applyPath,
					);
				}

				return result;
			};
		} else {
			iterator.next = function () {
				const result = originalNext.call(this);

				if (result.done === false) {
					result.value = prepareValue(
						result.value,
						target,
						result.value,
						applyPath,
					);
				}

				return result;
			};
		}

		return iterator;
	}

	function ignoreProperty(cache, options, property) {
		return cache.isUnsubscribed
			|| (options.ignoreSymbols && isSymbol(property))
			|| (options.ignoreUnderscores && property.charAt(0) === '_')
			|| ('ignoreKeys' in options && options.ignoreKeys.includes(property));
	}

	/**
	@class Cache
	@private
	*/
	class Cache {
		constructor(equals) {
			this._equals = equals;
			this._proxyCache = new WeakMap();
			this._pathCache = new WeakMap();
			this.isUnsubscribed = false;
		}

		_getDescriptorCache() {
			if (this._descriptorCache === undefined) {
				this._descriptorCache = new WeakMap();
			}

			return this._descriptorCache;
		}

		_getProperties(target) {
			const descriptorCache = this._getDescriptorCache();
			let properties = descriptorCache.get(target);

			if (properties === undefined) {
				properties = {};
				descriptorCache.set(target, properties);
			}

			return properties;
		}

		_getOwnPropertyDescriptor(target, property) {
			if (this.isUnsubscribed) {
				return Reflect.getOwnPropertyDescriptor(target, property);
			}

			const properties = this._getProperties(target);
			let descriptor = properties[property];

			if (descriptor === undefined) {
				descriptor = Reflect.getOwnPropertyDescriptor(target, property);
				properties[property] = descriptor;
			}

			return descriptor;
		}

		getProxy(target, path, handler, proxyTarget) {
			if (this.isUnsubscribed) {
				return target;
			}

			const reflectTarget = target[proxyTarget];
			const source = reflectTarget ?? target;

			this._pathCache.set(source, path);

			let proxy = this._proxyCache.get(source);

			if (proxy === undefined) {
				proxy = reflectTarget === undefined
					? new Proxy(target, handler)
					: target;

				this._proxyCache.set(source, proxy);
			}

			return proxy;
		}

		getPath(target) {
			return this.isUnsubscribed ? undefined : this._pathCache.get(target);
		}

		isDetached(target, object) {
			return !Object.is(target, path.get(object, this.getPath(target)));
		}

		defineProperty(target, property, descriptor) {
			if (!Reflect.defineProperty(target, property, descriptor)) {
				return false;
			}

			if (!this.isUnsubscribed) {
				this._getProperties(target)[property] = descriptor;
			}

			return true;
		}

		setProperty(target, property, value, receiver, previous) { // eslint-disable-line max-params
			if (!this._equals(previous, value) || !(property in target)) {
				const descriptor = this._getOwnPropertyDescriptor(target, property);

				if (descriptor !== undefined && 'set' in descriptor) {
					return Reflect.set(target, property, value, receiver);
				}

				return Reflect.set(target, property, value);
			}

			return true;
		}

		deleteProperty(target, property, previous) {
			if (Reflect.deleteProperty(target, property)) {
				if (!this.isUnsubscribed) {
					const properties = this._getDescriptorCache().get(target);

					if (properties) {
						delete properties[property];
						this._pathCache.delete(previous);
					}
				}

				return true;
			}

			return false;
		}

		isSameDescriptor(a, target, property) {
			const b = this._getOwnPropertyDescriptor(target, property);

			return a !== undefined
				&& b !== undefined
				&& Object.is(a.value, b.value)
				&& (a.writable || false) === (b.writable || false)
				&& (a.enumerable || false) === (b.enumerable || false)
				&& (a.configurable || false) === (b.configurable || false)
				&& a.get === b.get
				&& a.set === b.set;
		}

		isGetInvariant(target, property) {
			const descriptor = this._getOwnPropertyDescriptor(target, property);

			return descriptor !== undefined
				&& descriptor.configurable !== true
				&& descriptor.writable !== true;
		}

		unsubscribe() {
			this._descriptorCache = null;
			this._pathCache = null;
			this._proxyCache = null;
			this.isUnsubscribed = true;
		}
	}

	function isObject(value) {
		return toString.call(value) === '[object Object]';
	}

	function isDiffCertain() {
		return true;
	}

	function isDiffArrays(clone, value) {
		return clone.length !== value.length || clone.some((item, index) => value[index] !== item);
	}

	const IMMUTABLE_OBJECT_METHODS = new Set([
		'hasOwnProperty',
		'isPrototypeOf',
		'propertyIsEnumerable',
		'toLocaleString',
		'toString',
		'valueOf',
	]);

	const IMMUTABLE_ARRAY_METHODS = new Set([
		'concat',
		'includes',
		'indexOf',
		'join',
		'keys',
		'lastIndexOf',
	]);

	const MUTABLE_ARRAY_METHODS = {
		push: isDiffCertain,
		pop: isDiffCertain,
		shift: isDiffCertain,
		unshift: isDiffCertain,
		copyWithin: isDiffArrays,
		reverse: isDiffArrays,
		sort: isDiffArrays,
		splice: isDiffArrays,
		flat: isDiffArrays,
		fill: isDiffArrays,
	};

	const HANDLED_ARRAY_METHODS = new Set([
		...IMMUTABLE_OBJECT_METHODS,
		...IMMUTABLE_ARRAY_METHODS,
		...Object.keys(MUTABLE_ARRAY_METHODS),
	]);

	function isDiffSets(clone, value) {
		if (clone.size !== value.size) {
			return true;
		}

		for (const element of clone) {
			if (!value.has(element)) {
				return true;
			}
		}

		return false;
	}

	const COLLECTION_ITERATOR_METHODS = [
		'keys',
		'values',
		'entries',
	];

	const IMMUTABLE_SET_METHODS = new Set([
		'has',
		'toString',
	]);

	const MUTABLE_SET_METHODS = {
		add: isDiffSets,
		clear: isDiffSets,
		delete: isDiffSets,
		forEach: isDiffSets,
	};

	const HANDLED_SET_METHODS = new Set([
		...IMMUTABLE_SET_METHODS,
		...Object.keys(MUTABLE_SET_METHODS),
		...COLLECTION_ITERATOR_METHODS,
	]);

	function isDiffMaps(clone, value) {
		if (clone.size !== value.size) {
			return true;
		}

		let bValue;
		for (const [key, aValue] of clone) {
			bValue = value.get(key);

			if (bValue !== aValue || (bValue === undefined && !value.has(key))) {
				return true;
			}
		}

		return false;
	}

	const IMMUTABLE_MAP_METHODS = new Set([...IMMUTABLE_SET_METHODS, 'get']);

	const MUTABLE_MAP_METHODS = {
		set: isDiffMaps,
		clear: isDiffMaps,
		delete: isDiffMaps,
		forEach: isDiffMaps,
	};

	const HANDLED_MAP_METHODS = new Set([
		...IMMUTABLE_MAP_METHODS,
		...Object.keys(MUTABLE_MAP_METHODS),
		...COLLECTION_ITERATOR_METHODS,
	]);

	class CloneObject {
		constructor(value, path, argumentsList, hasOnValidate) {
			this._path = path;
			this._isChanged = false;
			this._clonedCache = new Set();
			this._hasOnValidate = hasOnValidate;
			this._changes = hasOnValidate ? [] : null;

			this.clone = path === undefined ? value : this._shallowClone(value);
		}

		static isHandledMethod(name) {
			return IMMUTABLE_OBJECT_METHODS.has(name);
		}

		_shallowClone(value) {
			let clone = value;

			if (isObject(value)) {
				clone = {...value};
			} else if (isArray(value) || ArrayBuffer.isView(value)) {
				clone = [...value];
			} else if (value instanceof Date) {
				clone = new Date(value);
			} else if (value instanceof Set) {
				clone = new Set([...value].map(item => this._shallowClone(item)));
			} else if (value instanceof Map) {
				clone = new Map();

				for (const [key, item] of value.entries()) {
					clone.set(key, this._shallowClone(item));
				}
			}

			this._clonedCache.add(clone);

			return clone;
		}

		preferredThisArg(isHandledMethod, name, thisArgument, thisProxyTarget) {
			if (isHandledMethod) {
				if (isArray(thisProxyTarget)) {
					this._onIsChanged = MUTABLE_ARRAY_METHODS[name];
				} else if (thisProxyTarget instanceof Set) {
					this._onIsChanged = MUTABLE_SET_METHODS[name];
				} else if (thisProxyTarget instanceof Map) {
					this._onIsChanged = MUTABLE_MAP_METHODS[name];
				}

				return thisProxyTarget;
			}

			return thisArgument;
		}

		update(fullPath, property, value) {
			const changePath = path.after(fullPath, this._path);

			if (property !== 'length') {
				let object = this.clone;

				path.walk(changePath, key => {
					if (object?.[key]) {
						if (!this._clonedCache.has(object[key])) {
							object[key] = this._shallowClone(object[key]);
						}

						object = object[key];
					}
				});

				if (this._hasOnValidate) {
					this._changes.push({
						path: changePath,
						property,
						previous: value,
					});
				}

				if (object?.[property]) {
					object[property] = value;
				}
			}

			this._isChanged = true;
		}

		undo(object) {
			let change;

			for (let index = this._changes.length - 1; index !== -1; index--) {
				change = this._changes[index];

				path.get(object, change.path)[change.property] = change.previous;
			}
		}

		isChanged(value) {
			return this._onIsChanged === undefined
				? this._isChanged
				: this._onIsChanged(this.clone, value);
		}

		isPathApplicable(changePath) {
			return path.isRootPath(this._path) || path.isSubPath(changePath, this._path);
		}
	}

	class CloneArray extends CloneObject {
		static isHandledMethod(name) {
			return HANDLED_ARRAY_METHODS.has(name);
		}
	}

	class CloneDate extends CloneObject {
		undo(object) {
			object.setTime(this.clone.getTime());
		}

		isChanged(value, equals) {
			return !equals(this.clone.valueOf(), value.valueOf());
		}
	}

	class CloneSet extends CloneObject {
		static isHandledMethod(name) {
			return HANDLED_SET_METHODS.has(name);
		}

		undo(object) {
			for (const value of this.clone) {
				object.add(value);
			}

			for (const value of object) {
				if (!this.clone.has(value)) {
					object.delete(value);
				}
			}
		}
	}

	class CloneMap extends CloneObject {
		static isHandledMethod(name) {
			return HANDLED_MAP_METHODS.has(name);
		}

		undo(object) {
			for (const [key, value] of this.clone.entries()) {
				object.set(key, value);
			}

			for (const key of object.keys()) {
				if (!this.clone.has(key)) {
					object.delete(key);
				}
			}
		}
	}

	class CloneWeakSet extends CloneObject {
		constructor(value, path, argumentsList, hasOnValidate) {
			super(undefined, path, argumentsList, hasOnValidate);

			this._argument1 = argumentsList[0];
			this._weakValue = value.has(this._argument1);
		}

		isChanged(value) {
			return this._weakValue !== value.has(this._argument1);
		}

		undo(object) {
			if (this._weakValue && !object.has(this._argument1)) {
				object.add(this._argument1);
			} else {
				object.delete(this._argument1);
			}
		}
	}

	class CloneWeakMap extends CloneObject {
		constructor(value, path, argumentsList, hasOnValidate) {
			super(undefined, path, argumentsList, hasOnValidate);

			this._weakKey = argumentsList[0];
			this._weakHas = value.has(this._weakKey);
			this._weakValue = value.get(this._weakKey);
		}

		isChanged(value) {
			return this._weakValue !== value.get(this._weakKey);
		}

		undo(object) {
			const weakHas = object.has(this._weakKey);

			if (this._weakHas && !weakHas) {
				object.set(this._weakKey, this._weakValue);
			} else if (!this._weakHas && weakHas) {
				object.delete(this._weakKey);
			} else if (this._weakValue !== object.get(this._weakKey)) {
				object.set(this._weakKey, this._weakValue);
			}
		}
	}

	class SmartClone {
		constructor(hasOnValidate) {
			this._stack = [];
			this._hasOnValidate = hasOnValidate;
		}

		static isHandledType(value) {
			return isObject(value)
				|| isArray(value)
				|| isBuiltinWithMutableMethods(value);
		}

		static isHandledMethod(target, name) {
			if (isObject(target)) {
				return CloneObject.isHandledMethod(name);
			}

			if (isArray(target)) {
				return CloneArray.isHandledMethod(name);
			}

			if (target instanceof Set) {
				return CloneSet.isHandledMethod(name);
			}

			if (target instanceof Map) {
				return CloneMap.isHandledMethod(name);
			}

			return isBuiltinWithMutableMethods(target);
		}

		get isCloning() {
			return this._stack.length > 0;
		}

		start(value, path, argumentsList) {
			let CloneClass = CloneObject;

			if (isArray(value)) {
				CloneClass = CloneArray;
			} else if (value instanceof Date) {
				CloneClass = CloneDate;
			} else if (value instanceof Set) {
				CloneClass = CloneSet;
			} else if (value instanceof Map) {
				CloneClass = CloneMap;
			} else if (value instanceof WeakSet) {
				CloneClass = CloneWeakSet;
			} else if (value instanceof WeakMap) {
				CloneClass = CloneWeakMap;
			}

			this._stack.push(new CloneClass(value, path, argumentsList, this._hasOnValidate));
		}

		update(fullPath, property, value) {
			this._stack.at(-1).update(fullPath, property, value);
		}

		preferredThisArg(target, thisArgument, thisProxyTarget) {
			const {name} = target;
			const isHandledMethod = SmartClone.isHandledMethod(thisProxyTarget, name);

			return this._stack.at(-1)
				.preferredThisArg(isHandledMethod, name, thisArgument, thisProxyTarget);
		}

		isChanged(isMutable, value, equals) {
			return this._stack.at(-1).isChanged(isMutable, value, equals);
		}

		isPartOfClone(changePath) {
			return this._stack.at(-1).isPathApplicable(changePath);
		}

		undo(object) {
			if (this._previousClone !== undefined) {
				this._previousClone.undo(object);
			}
		}

		stop() {
			this._previousClone = this._stack.pop();

			return this._previousClone.clone;
		}
	}

	/* eslint-disable unicorn/prefer-spread */

	const defaultOptions = {
		equals: Object.is,
		isShallow: false,
		pathAsArray: false,
		ignoreSymbols: false,
		ignoreUnderscores: false,
		ignoreDetached: false,
		details: false,
	};

	const onChange = (object, onChange, options = {}) => {
		options = {
			...defaultOptions,
			...options,
		};

		const proxyTarget = Symbol('ProxyTarget');
		const {equals, isShallow, ignoreDetached, details} = options;
		const cache = new Cache(equals);
		const hasOnValidate = typeof options.onValidate === 'function';
		const smartClone = new SmartClone(hasOnValidate);

		// eslint-disable-next-line max-params
		const validate = (target, property, value, previous, applyData) => !hasOnValidate
			|| smartClone.isCloning
			|| options.onValidate(path.concat(cache.getPath(target), property), value, previous, applyData) === true;

		const handleChangeOnTarget = (target, property, value, previous) => {
			if (
				!ignoreProperty(cache, options, property)
				&& !(ignoreDetached && cache.isDetached(target, object))
			) {
				handleChange(cache.getPath(target), property, value, previous);
			}
		};

		// eslint-disable-next-line max-params
		const handleChange = (changePath, property, value, previous, applyData) => {
			if (smartClone.isCloning && smartClone.isPartOfClone(changePath)) {
				smartClone.update(changePath, property, previous);
			} else {
				onChange(path.concat(changePath, property), value, previous, applyData);
			}
		};

		const getProxyTarget = value => value
			? (value[proxyTarget] ?? value)
			: value;

		const prepareValue = (value, target, property, basePath) => {
			if (
				isBuiltinWithoutMutableMethods(value)
				|| property === 'constructor'
				|| (isShallow && !SmartClone.isHandledMethod(target, property))
				|| ignoreProperty(cache, options, property)
				|| cache.isGetInvariant(target, property)
				|| (ignoreDetached && cache.isDetached(target, object))
			) {
				return value;
			}

			if (basePath === undefined) {
				basePath = cache.getPath(target);
			}

			/*
	  		Check for circular references.

	  		If the value already has a corresponding path/proxy,
			and if the path corresponds to one of the parents,
			then we are on a circular case, where the child is pointing to their parent.
			In this case we return the proxy object with the shortest path.
	  		*/
			const childPath = path.concat(basePath, property);
			const existingPath = cache.getPath(value);

			if (existingPath && isSameObjectTree(childPath, existingPath)) {
				// We are on the same object tree but deeper, so we use the parent path.
				return cache.getProxy(value, existingPath, handler, proxyTarget);
			}

			return cache.getProxy(value, childPath, handler, proxyTarget);
		};

		/*
		Returns true if `childPath` is a subpath of `existingPath`
		(if childPath starts with existingPath). Otherwise, it returns false.

	 	It also returns false if the 2 paths are identical.

	 	For example:
		- childPath    = group.layers.0.parent.layers.0.value
		- existingPath = group.layers.0.parent
		*/
		const isSameObjectTree = (childPath, existingPath) => {
			if (isSymbol(childPath) || childPath.length <= existingPath.length) {
				return false;
			}

			if (isArray(existingPath) && existingPath.length === 0) {
				return false;
			}

			const childParts = isArray(childPath) ? childPath : childPath.split(PATH_SEPARATOR);
			const existingParts = isArray(existingPath) ? existingPath : existingPath.split(PATH_SEPARATOR);

			if (childParts.length <= existingParts.length) {
				return false;
			}

			return !(existingParts.some((part, index) => part !== childParts[index]));
		};

		const handler = {
			get(target, property, receiver) {
				if (isSymbol(property)) {
					if (property === proxyTarget || property === TARGET) {
						return target;
					}

					if (
						property === UNSUBSCRIBE
						&& !cache.isUnsubscribed
						&& cache.getPath(target).length === 0
					) {
						cache.unsubscribe();
						return target;
					}
				}

				const value = isBuiltinWithMutableMethods(target)
					? Reflect.get(target, property)
					: Reflect.get(target, property, receiver);

				return prepareValue(value, target, property);
			},

			set(target, property, value, receiver) {
				value = getProxyTarget(value);

				const reflectTarget = target[proxyTarget] ?? target;
				const previous = reflectTarget[property];

				if (equals(previous, value) && property in target) {
					return true;
				}

				const isValid = validate(target, property, value, previous);

				if (
					isValid
					&& cache.setProperty(reflectTarget, property, value, receiver, previous)
				) {
					handleChangeOnTarget(target, property, target[property], previous);

					return true;
				}

				return !isValid;
			},

			defineProperty(target, property, descriptor) {
				if (!cache.isSameDescriptor(descriptor, target, property)) {
					const previous = target[property];

					if (
						validate(target, property, descriptor.value, previous)
						&& cache.defineProperty(target, property, descriptor, previous)
					) {
						handleChangeOnTarget(target, property, descriptor.value, previous);
					}
				}

				return true;
			},

			deleteProperty(target, property) {
				if (!Reflect.has(target, property)) {
					return true;
				}

				const previous = Reflect.get(target, property);
				const isValid = validate(target, property, undefined, previous);

				if (
					isValid
					&& cache.deleteProperty(target, property, previous)
				) {
					handleChangeOnTarget(target, property, undefined, previous);

					return true;
				}

				return !isValid;
			},

			apply(target, thisArg, argumentsList) {
				const thisProxyTarget = thisArg[proxyTarget] ?? thisArg;

				if (cache.isUnsubscribed) {
					return Reflect.apply(target, thisProxyTarget, argumentsList);
				}

				if (
					(details === false
						|| (details !== true && !details.includes(target.name)))
					&& SmartClone.isHandledType(thisProxyTarget)
				) {
					let applyPath = path.initial(cache.getPath(target));
					const isHandledMethod = SmartClone.isHandledMethod(thisProxyTarget, target.name);

					smartClone.start(thisProxyTarget, applyPath, argumentsList);

					let result = Reflect.apply(
						target,
						smartClone.preferredThisArg(target, thisArg, thisProxyTarget),
						isHandledMethod
							? argumentsList.map(argument => getProxyTarget(argument))
							: argumentsList,
					);

					const isChanged = smartClone.isChanged(thisProxyTarget, equals);
					const previous = smartClone.stop();

					if (SmartClone.isHandledType(result) && isHandledMethod) {
						if (thisArg instanceof Map && target.name === 'get') {
							applyPath = path.concat(applyPath, argumentsList[0]);
						}

						result = cache.getProxy(result, applyPath, handler);
					}

					if (isChanged) {
						const applyData = {
							name: target.name,
							args: argumentsList,
							result,
						};
						const changePath = smartClone.isCloning
							? path.initial(applyPath)
							: applyPath;
						const property = smartClone.isCloning
							? path.last(applyPath)
							: '';

						if (validate(path.get(object, changePath), property, thisProxyTarget, previous, applyData)) {
							handleChange(changePath, property, thisProxyTarget, previous, applyData);
						} else {
							smartClone.undo(thisProxyTarget);
						}
					}

					if (
						(thisArg instanceof Map || thisArg instanceof Set)
						&& isIterator(result)
					) {
						return wrapIterator(result, target, thisArg, applyPath, prepareValue);
					}

					return result;
				}

				return Reflect.apply(target, thisArg, argumentsList);
			},
		};

		const proxy = cache.getProxy(object, options.pathAsArray ? [] : '', handler);
		onChange = onChange.bind(proxy);

		if (hasOnValidate) {
			options.onValidate = options.onValidate.bind(proxy);
		}

		return proxy;
	};

	onChange.target = proxy => proxy?.[TARGET] ?? proxy;
	onChange.unsubscribe = proxy => proxy?.[UNSUBSCRIBE] ?? proxy;

	function clampProp(e, n, t, o, r) {
	  return clampEntity(n, getDefinedProp(e, n), t, o, r);
	}

	function clampEntity(e, n, t, o, r, i) {
	  const a = clampNumber(n, t, o);
	  if (r && n !== a) {
	    throw new RangeError(numberOutOfRange(e, n, t, o, i));
	  }
	  return a;
	}

	function getDefinedProp(e, n) {
	  const t = e[n];
	  if (void 0 === t) {
	    throw new TypeError(missingField(n));
	  }
	  return t;
	}

	function z(e) {
	  return null !== e && /object|function/.test(typeof e);
	}

	function Jn(e, n = Map) {
	  const t = new n;
	  return (n, ...o) => {
	    if (t.has(n)) {
	      return t.get(n);
	    }
	    const r = e(n, ...o);
	    return t.set(n, r), r;
	  };
	}

	function D(e) {
	  return p({
	    name: e
	  }, 1);
	}

	function p(e, n) {
	  return T((e => ({
	    value: e,
	    configurable: 1,
	    writable: !n
	  })), e);
	}

	function O(e) {
	  return T((e => ({
	    get: e,
	    configurable: 1
	  })), e);
	}

	function h(e) {
	  return {
	    [Symbol.toStringTag]: {
	      value: e,
	      configurable: 1
	    }
	  };
	}

	function zipProps(e, n) {
	  const t = {};
	  let o = e.length;
	  for (const r of n) {
	    t[e[--o]] = r;
	  }
	  return t;
	}

	function T(e, n, t) {
	  const o = {};
	  for (const r in n) {
	    o[r] = e(n[r], r, t);
	  }
	  return o;
	}

	function b(e, n, t) {
	  const o = {};
	  for (let r = 0; r < n.length; r++) {
	    const i = n[r];
	    o[i] = e(i, r, t);
	  }
	  return o;
	}

	function remapProps(e, n, t) {
	  const o = {};
	  for (let r = 0; r < e.length; r++) {
	    o[n[r]] = t[e[r]];
	  }
	  return o;
	}

	function Vn(e, n) {
	  const t = {};
	  for (const o of e) {
	    t[o] = n[o];
	  }
	  return t;
	}

	function V(e, n) {
	  const t = {};
	  for (const o in n) {
	    e.has(o) || (t[o] = n[o]);
	  }
	  return t;
	}

	function nn(e) {
	  e = {
	    ...e
	  };
	  const n = Object.keys(e);
	  for (const t of n) {
	    void 0 === e[t] && delete e[t];
	  }
	  return e;
	}

	function C(e, n) {
	  for (const t of n) {
	    if (!(t in e)) {
	      return 0;
	    }
	  }
	  return 1;
	}

	function allPropsEqual(e, n, t) {
	  for (const o of e) {
	    if (n[o] !== t[o]) {
	      return 0;
	    }
	  }
	  return 1;
	}

	function zeroOutProps(e, n, t) {
	  const o = {
	    ...t
	  };
	  for (let t = 0; t < n; t++) {
	    o[e[t]] = 0;
	  }
	  return o;
	}

	function E(e, ...n) {
	  return (...t) => e(...n, ...t);
	}

	function capitalize(e) {
	  return e[0].toUpperCase() + e.substring(1);
	}

	function sortStrings(e) {
	  return e.slice().sort();
	}

	function padNumber(e, n) {
	  return String(n).padStart(e, "0");
	}

	function compareNumbers(e, n) {
	  return Math.sign(e - n);
	}

	function clampNumber(e, n, t) {
	  return Math.min(Math.max(e, n), t);
	}

	function divModFloor(e, n) {
	  return [ Math.floor(e / n), modFloor(e, n) ];
	}

	function modFloor(e, n) {
	  return (e % n + n) % n;
	}

	function divModTrunc(e, n) {
	  return [ divTrunc(e, n), modTrunc(e, n) ];
	}

	function divTrunc(e, n) {
	  return Math.trunc(e / n) || 0;
	}

	function modTrunc(e, n) {
	  return e % n || 0;
	}

	function hasHalf(e) {
	  return .5 === Math.abs(e % 1);
	}

	function givenFieldsToBigNano(e, n, t) {
	  let o = 0, r = 0;
	  for (let i = 0; i <= n; i++) {
	    const n = e[t[i]], a = Xr[i], s = Qr / a, [c, u] = divModTrunc(n, s);
	    o += u * a, r += c;
	  }
	  const [i, a] = divModTrunc(o, Qr);
	  return [ r + i, a ];
	}

	function nanoToGivenFields(e, n, t) {
	  const o = {};
	  for (let r = n; r >= 0; r--) {
	    const n = Xr[r];
	    o[t[r]] = divTrunc(e, n), e = modTrunc(e, n);
	  }
	  return o;
	}

	function un(e) {
	  return e === X ? si : [];
	}

	function cn(e) {
	  return e === X ? li : [];
	}

	function ln(e) {
	  return e === X ? [ "year", "day" ] : [];
	}

	function l(e) {
	  if (void 0 !== e) {
	    return m(e);
	  }
	}

	function S(e) {
	  if (void 0 !== e) {
	    return d(e);
	  }
	}

	function c(e) {
	  if (void 0 !== e) {
	    return u(e);
	  }
	}

	function d(e) {
	  return requireNumberIsPositive(u(e));
	}

	function u(e) {
	  return requireNumberIsInteger(Mi(e));
	}

	function on(e) {
	  if (null == e) {
	    throw new TypeError("Cannot be null or undefined");
	  }
	  return e;
	}

	function requirePropDefined(e, n) {
	  if (null == n) {
	    throw new RangeError(missingField(e));
	  }
	  return n;
	}

	function de(e) {
	  if (!z(e)) {
	    throw new TypeError(hr);
	  }
	  return e;
	}

	function requireType(e, n, t = e) {
	  if (typeof n !== e) {
	    throw new TypeError(invalidEntity(t, n));
	  }
	  return n;
	}

	function requireNumberIsInteger(e, n = "number") {
	  if (!Number.isInteger(e)) {
	    throw new RangeError(expectedInteger(n, e));
	  }
	  return e || 0;
	}

	function requireNumberIsPositive(e, n = "number") {
	  if (e <= 0) {
	    throw new RangeError(expectedPositive(n, e));
	  }
	  return e;
	}

	function toString$1(e) {
	  if ("symbol" == typeof e) {
	    throw new TypeError(pr);
	  }
	  return String(e);
	}

	function toStringViaPrimitive(e, n) {
	  return z(e) ? String(e) : m(e, n);
	}

	function toBigInt(e) {
	  if ("string" == typeof e) {
	    return BigInt(e);
	  }
	  if ("bigint" != typeof e) {
	    throw new TypeError(invalidBigInt(e));
	  }
	  return e;
	}

	function toNumber(e, n = "number") {
	  if ("bigint" == typeof e) {
	    throw new TypeError(forbiddenBigIntToNumber(n));
	  }
	  if (e = Number(e), !Number.isFinite(e)) {
	    throw new RangeError(expectedFinite(n, e));
	  }
	  return e;
	}

	function toInteger(e, n) {
	  return Math.trunc(toNumber(e, n)) || 0;
	}

	function toStrictInteger(e, n) {
	  return requireNumberIsInteger(toNumber(e, n), n);
	}

	function toPositiveInteger(e, n) {
	  return requireNumberIsPositive(toInteger(e, n), n);
	}

	function createBigNano(e, n) {
	  let [t, o] = divModTrunc(n, Qr), r = e + t;
	  const i = Math.sign(r);
	  return i && i === -Math.sign(o) && (r -= i, o += i * Qr), [ r, o ];
	}

	function addBigNanos(e, n, t = 1) {
	  return createBigNano(e[0] + n[0] * t, e[1] + n[1] * t);
	}

	function moveBigNano(e, n) {
	  return createBigNano(e[0], e[1] + n);
	}

	function re(e, n) {
	  return addBigNanos(n, e, -1);
	}

	function te(e, n) {
	  return compareNumbers(e[0], n[0]) || compareNumbers(e[1], n[1]);
	}

	function bigNanoOutside(e, n, t) {
	  return -1 === te(e, n) || 1 === te(e, t);
	}

	function bigIntToBigNano(e, n = 1) {
	  const t = BigInt(Qr / n);
	  return [ Number(e / t), Number(e % t) * n ];
	}

	function he(e, n = 1) {
	  const t = Qr / n, [o, r] = divModTrunc(e, t);
	  return [ o, r * n ];
	}

	function bigNanoToBigInt(e, n = 1) {
	  const [t, o] = e, r = Math.floor(o / n), i = Qr / n;
	  return BigInt(t) * BigInt(i) + BigInt(r);
	}

	function oe(e, n = 1, t) {
	  const [o, r] = e, [i, a] = divModTrunc(r, n);
	  return o * (Qr / n) + (i + (t ? a / n : 0));
	}

	function divModBigNano(e, n, t = divModFloor) {
	  const [o, r] = e, [i, a] = t(r, n);
	  return [ o * (Qr / n) + i, a ];
	}

	function hashIntlFormatParts(e, n) {
	  const t = e.formatToParts(n), o = {};
	  for (const e of t) {
	    o[e.type] = e.value;
	  }
	  return o;
	}

	function checkIsoYearMonthInBounds(e) {
	  return clampProp(e, "isoYear", Li, Ai, 1), e.isoYear === Li ? clampProp(e, "isoMonth", 4, 12, 1) : e.isoYear === Ai && clampProp(e, "isoMonth", 1, 9, 1), 
	  e;
	}

	function checkIsoDateInBounds(e) {
	  return checkIsoDateTimeInBounds({
	    ...e,
	    ...Dt,
	    isoHour: 12
	  }), e;
	}

	function checkIsoDateTimeInBounds(e) {
	  const n = clampProp(e, "isoYear", Li, Ai, 1), t = n === Li ? 1 : n === Ai ? -1 : 0;
	  return t && checkEpochNanoInBounds(isoToEpochNano({
	    ...e,
	    isoDay: e.isoDay + t,
	    isoNanosecond: e.isoNanosecond - t
	  })), e;
	}

	function checkEpochNanoInBounds(e) {
	  if (!e || bigNanoOutside(e, Ui, qi)) {
	    throw new RangeError(Cr);
	  }
	  return e;
	}

	function isoTimeFieldsToNano(e) {
	  return givenFieldsToBigNano(e, 5, j)[1];
	}

	function nanoToIsoTimeAndDay(e) {
	  const [n, t] = divModFloor(e, Qr);
	  return [ nanoToGivenFields(t, 5, j), n ];
	}

	function epochNanoToSec(e) {
	  return epochNanoToSecMod(e)[0];
	}

	function epochNanoToSecMod(e) {
	  return divModBigNano(e, _r);
	}

	function isoToEpochMilli(e) {
	  return isoArgsToEpochMilli(e.isoYear, e.isoMonth, e.isoDay, e.isoHour, e.isoMinute, e.isoSecond, e.isoMillisecond);
	}

	function isoToEpochNano(e) {
	  const n = isoToEpochMilli(e);
	  if (void 0 !== n) {
	    const [t, o] = divModTrunc(n, Gr);
	    return [ t, o * be + (e.isoMicrosecond || 0) * Vr + (e.isoNanosecond || 0) ];
	  }
	}

	function isoToEpochNanoWithOffset(e, n) {
	  const [t, o] = nanoToIsoTimeAndDay(isoTimeFieldsToNano(e) - n);
	  return checkEpochNanoInBounds(isoToEpochNano({
	    ...e,
	    isoDay: e.isoDay + o,
	    ...t
	  }));
	}

	function isoArgsToEpochSec(...e) {
	  return isoArgsToEpochMilli(...e) / Hr;
	}

	function isoArgsToEpochMilli(...e) {
	  const [n, t] = isoToLegacyDate(...e), o = n.valueOf();
	  if (!isNaN(o)) {
	    return o - t * Gr;
	  }
	}

	function isoToLegacyDate(e, n = 1, t = 1, o = 0, r = 0, i = 0, a = 0) {
	  const s = e === Li ? 1 : e === Ai ? -1 : 0, c = new Date;
	  return c.setUTCHours(o, r, i, a), c.setUTCFullYear(e, n - 1, t + s), [ c, s ];
	}

	function Ie(e, n) {
	  let [t, o] = moveBigNano(e, n);
	  o < 0 && (o += Qr, t -= 1);
	  const [r, i] = divModFloor(o, be), [a, s] = divModFloor(i, Vr);
	  return epochMilliToIso(t * Gr + r, a, s);
	}

	function epochMilliToIso(e, n = 0, t = 0) {
	  const o = Math.ceil(Math.max(0, Math.abs(e) - zi) / Gr) * Math.sign(e), r = new Date(e - o * Gr);
	  return zipProps(wi, [ r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate() + o, r.getUTCHours(), r.getUTCMinutes(), r.getUTCSeconds(), r.getUTCMilliseconds(), n, t ]);
	}

	function computeIsoDateParts(e) {
	  return [ e.isoYear, e.isoMonth, e.isoDay ];
	}

	function computeIsoMonthsInYear() {
	  return xi;
	}

	function computeIsoDaysInMonth(e, n) {
	  switch (n) {
	   case 2:
	    return computeIsoInLeapYear(e) ? 29 : 28;

	   case 4:
	   case 6:
	   case 9:
	   case 11:
	    return 30;
	  }
	  return 31;
	}

	function computeIsoDaysInYear(e) {
	  return computeIsoInLeapYear(e) ? 366 : 365;
	}

	function computeIsoInLeapYear(e) {
	  return e % 4 == 0 && (e % 100 != 0 || e % 400 == 0);
	}

	function computeIsoDayOfWeek(e) {
	  const [n, t] = isoToLegacyDate(e.isoYear, e.isoMonth, e.isoDay);
	  return modFloor(n.getUTCDay() - t, 7) || 7;
	}

	function computeGregoryEraParts({isoYear: e}) {
	  return e < 1 ? [ "bce", 1 - e ] : [ "ce", e ];
	}

	function computeJapaneseEraParts(e) {
	  const n = isoToEpochMilli(e);
	  if (n < $i) {
	    return computeGregoryEraParts(e);
	  }
	  const t = hashIntlFormatParts(La(Ti), n), {era: o, eraYear: r} = parseIntlYear(t, Ti);
	  return [ o, r ];
	}

	function checkIsoDateTimeFields(e) {
	  return checkIsoDateFields(e), constrainIsoTimeFields(e, 1), e;
	}

	function checkIsoDateFields(e) {
	  return constrainIsoDateFields(e, 1), e;
	}

	function isIsoDateFieldsValid(e) {
	  return allPropsEqual(Oi, e, constrainIsoDateFields(e));
	}

	function constrainIsoDateFields(e, n) {
	  const {isoYear: t} = e, o = clampProp(e, "isoMonth", 1, computeIsoMonthsInYear(), n);
	  return {
	    isoYear: t,
	    isoMonth: o,
	    isoDay: clampProp(e, "isoDay", 1, computeIsoDaysInMonth(t, o), n)
	  };
	}

	function constrainIsoTimeFields(e, n) {
	  return zipProps(j, [ clampProp(e, "isoHour", 0, 23, n), clampProp(e, "isoMinute", 0, 59, n), clampProp(e, "isoSecond", 0, 59, n), clampProp(e, "isoMillisecond", 0, 999, n), clampProp(e, "isoMicrosecond", 0, 999, n), clampProp(e, "isoNanosecond", 0, 999, n) ]);
	}

	function H(e) {
	  return void 0 === e ? 0 : ua(de(e));
	}

	function wn(e, n = 0) {
	  e = normalizeOptions(e);
	  const t = la(e), o = fa(e, n);
	  return [ ua(e), o, t ];
	}

	function ve(e) {
	  return la(normalizeOptions(e));
	}

	function _t(e) {
	  return e = normalizeOptions(e), sa(e, 9, 6, 1);
	}

	function refineDiffOptions(e, n, t, o = 9, r = 0, i = 4) {
	  n = normalizeOptions(n);
	  let a = sa(n, o, r), s = parseRoundingIncInteger(n), c = ha(n, i);
	  const u = aa(n, o, r, 1);
	  return null == a ? a = Math.max(t, u) : checkLargestSmallestUnit(a, u), s = refineRoundingInc(s, u, 1), 
	  e && (c = (e => e < 4 ? (e + 2) % 4 : e)(c)), [ a, u, s, c ];
	}

	function refineRoundingOptions(e, n = 6, t) {
	  let o = parseRoundingIncInteger(e = normalizeOptionsOrString(e, Hi));
	  const r = ha(e, 7);
	  let i = aa(e, n);
	  return i = requirePropDefined(Hi, i), o = refineRoundingInc(o, i, void 0, t), [ i, o, r ];
	}

	function refineDateDisplayOptions(e) {
	  return da(normalizeOptions(e));
	}

	function refineTimeDisplayOptions(e, n) {
	  return refineTimeDisplayTuple(normalizeOptions(e), n);
	}

	function refineTimeDisplayTuple(e, n = 4) {
	  const t = refineSubsecDigits(e);
	  return [ ha(e, 4), ...refineSmallestUnitAndSubsecDigits(aa(e, n), t) ];
	}

	function refineSmallestUnitAndSubsecDigits(e, n) {
	  return null != e ? [ Xr[e], e < 4 ? 9 - 3 * e : -1 ] : [ void 0 === n ? 1 : 10 ** (9 - n), n ];
	}

	function parseRoundingIncInteger(e) {
	  const n = e[_i];
	  return void 0 === n ? 1 : toInteger(n, _i);
	}

	function refineRoundingInc(e, n, t, o) {
	  const r = o ? Qr : Xr[n + 1];
	  if (r) {
	    const t = Xr[n];
	    if (r % ((e = clampEntity(_i, e, 1, r / t - (o ? 0 : 1), 1)) * t)) {
	      throw new RangeError(invalidEntity(_i, e));
	    }
	  } else {
	    e = clampEntity(_i, e, 1, t ? 10 ** 9 : 1, 1);
	  }
	  return e;
	}

	function refineSubsecDigits(e) {
	  let n = e[Ji];
	  if (void 0 !== n) {
	    if ("number" != typeof n) {
	      if ("auto" === toString$1(n)) {
	        return;
	      }
	      throw new RangeError(invalidEntity(Ji, n));
	    }
	    n = clampEntity(Ji, Math.floor(n), 0, 9, 1);
	  }
	  return n;
	}

	function normalizeOptions(e) {
	  return void 0 === e ? {} : de(e);
	}

	function normalizeOptionsOrString(e, n) {
	  return "string" == typeof e ? {
	    [n]: e
	  } : de(e);
	}

	function U(e) {
	  if (void 0 !== e) {
	    if (z(e)) {
	      return Object.assign(Object.create(null), e);
	    }
	    throw new TypeError(hr);
	  }
	}

	function overrideOverflowOptions(e, n) {
	  return e && Object.assign(Object.create(null), e, {
	    overflow: Xi[n]
	  });
	}

	function refineUnitOption(e, n, t = 9, o = 0, r) {
	  let i = n[e];
	  if (void 0 === i) {
	    return r ? o : void 0;
	  }
	  if (i = toString$1(i), "auto" === i) {
	    return r ? o : null;
	  }
	  let a = $r[i];
	  if (void 0 === a && (a = Ei[i]), void 0 === a) {
	    throw new RangeError(invalidChoice(e, i, $r));
	  }
	  return clampEntity(e, a, o, t, 1, Et), a;
	}

	function refineChoiceOption(e, n, t, o = 0) {
	  const r = t[e];
	  if (void 0 === r) {
	    return o;
	  }
	  const i = toString$1(r), a = n[i];
	  if (void 0 === a) {
	    throw new RangeError(invalidChoice(e, i, n));
	  }
	  return a;
	}

	function checkLargestSmallestUnit(e, n) {
	  if (n > e) {
	    throw new RangeError(Ar);
	  }
	}

	function _(e) {
	  return {
	    branding: Oe,
	    epochNanoseconds: e
	  };
	}

	function Yn(e, n, t) {
	  return {
	    branding: Te,
	    calendar: t,
	    timeZone: n,
	    epochNanoseconds: e
	  };
	}

	function ee(e, n = e.calendar) {
	  return {
	    branding: We,
	    calendar: n,
	    ...Vn(Yi, e)
	  };
	}

	function v(e, n = e.calendar) {
	  return {
	    branding: J,
	    calendar: n,
	    ...Vn(Bi, e)
	  };
	}

	function createPlainYearMonthSlots(e, n = e.calendar) {
	  return {
	    branding: L,
	    calendar: n,
	    ...Vn(Bi, e)
	  };
	}

	function createPlainMonthDaySlots(e, n = e.calendar) {
	  return {
	    branding: q,
	    calendar: n,
	    ...Vn(Bi, e)
	  };
	}

	function Ge(e) {
	  return {
	    branding: xe,
	    ...Vn(ki, e)
	  };
	}

	function Vt(e) {
	  return {
	    branding: qt,
	    sign: computeDurationSign(e),
	    ...Vn(Ni, e)
	  };
	}

	function M(e) {
	  return epochNanoToSec(e.epochNanoseconds);
	}

	function y(e) {
	  return divModBigNano(e.epochNanoseconds, be)[0];
	}

	function N(e) {
	  return bigNanoToBigInt(e.epochNanoseconds, Vr);
	}

	function B(e) {
	  return bigNanoToBigInt(e.epochNanoseconds);
	}

	function extractEpochNano(e) {
	  return e.epochNanoseconds;
	}

	function I(e) {
	  return "string" == typeof e ? e : m(e.id);
	}

	function isIdLikeEqual(e, n) {
	  return e === n || I(e) === I(n);
	}

	function Ut(e, n, t, o, r) {
	  const i = getMaxDurationUnit(o), [a, s] = ((e, n) => {
	    const t = n((e = normalizeOptionsOrString(e, Vi))[Ki]);
	    let o = ca(e);
	    return o = requirePropDefined(Vi, o), [ o, t ];
	  })(r, e);
	  if (isUniformUnit(Math.max(a, i), s)) {
	    return totalDayTimeDuration(o, a);
	  }
	  if (!s) {
	    throw new RangeError(zr);
	  }
	  const [c, u, l] = createMarkerSystem(n, t, s), f = createMarkerToEpochNano(l), d = createMoveMarker(l), m = createDiffMarkers(l), p = d(u, c, o), h = m(u, c, p, a);
	  return isUniformUnit(a, s) ? totalDayTimeDuration(h, a) : ((e, n, t, o, r, i, a) => {
	    const s = computeDurationSign(e), [c, u] = clampRelativeDuration(o, bi(t, e), t, s, r, i, a), l = computeEpochNanoFrac(n, c, u);
	    return e[F[t]] + l * s;
	  })(h, f(p), a, u, c, f, d);
	}

	function totalDayTimeDuration(e, n) {
	  return oe(durationFieldsToBigNano(e), Xr[n], 1);
	}

	function clampRelativeDuration(e, n, t, o, r, i, a) {
	  const s = F[t], c = {
	    ...n,
	    [s]: n[s] + o
	  }, u = a(e, r, n), l = a(e, r, c);
	  return [ i(u), i(l) ];
	}

	function computeEpochNanoFrac(e, n, t) {
	  const o = oe(re(n, t));
	  if (!o) {
	    throw new RangeError(vr);
	  }
	  return oe(re(n, e)) / o;
	}

	function ce(e, n) {
	  const [t, o, r] = refineRoundingOptions(n, 5, 1);
	  return _(roundBigNano(e.epochNanoseconds, t, o, r, 1));
	}

	function Pn(e, n, t) {
	  let {epochNanoseconds: o, timeZone: r, calendar: i} = n;
	  const [a, s, c] = refineRoundingOptions(t);
	  if (0 === a && 1 === s) {
	    return n;
	  }
	  const u = e(r);
	  if (6 === a) {
	    o = ((e, n, t, o) => {
	      const r = fn(t, n), [i, a] = e(r), s = t.epochNanoseconds, c = we(n, i), u = we(n, a);
	      if (bigNanoOutside(s, c, u)) {
	        throw new RangeError(vr);
	      }
	      return roundWithMode(computeEpochNanoFrac(s, c, u), o) ? u : c;
	    })(computeDayInterval, u, n, c);
	  } else {
	    const e = u.getOffsetNanosecondsFor(o);
	    o = getMatchingInstantFor(u, roundDateTime(Ie(o, e), a, s, c), e, 2, 0, 1);
	  }
	  return Yn(o, r, i);
	}

	function dt(e, n) {
	  return ee(roundDateTime(e, ...refineRoundingOptions(n)), e.calendar);
	}

	function Ee(e, n) {
	  const [t, o, r] = refineRoundingOptions(n, 5);
	  var i;
	  return Ge((i = r, roundTimeToNano(e, computeNanoInc(t, o), i)[0]));
	}

	function dn(e, n) {
	  const t = e(n.timeZone), o = fn(n, t), [r, i] = computeDayInterval(o), a = oe(re(we(t, r), we(t, i)), Kr, 1);
	  if (a <= 0) {
	    throw new RangeError(vr);
	  }
	  return a;
	}

	function Cn(e, n) {
	  const {timeZone: t, calendar: o} = n, r = ((e, n, t) => we(n, e(fn(t, n))))(computeDayFloor, e(t), n);
	  return Yn(r, t, o);
	}

	function roundDateTime(e, n, t, o) {
	  return roundDateTimeToNano(e, computeNanoInc(n, t), o);
	}

	function roundDateTimeToNano(e, n, t) {
	  const [o, r] = roundTimeToNano(e, n, t);
	  return checkIsoDateTimeInBounds({
	    ...moveByDays(e, r),
	    ...o
	  });
	}

	function roundTimeToNano(e, n, t) {
	  return nanoToIsoTimeAndDay(roundByInc(isoTimeFieldsToNano(e), n, t));
	}

	function roundToMinute(e) {
	  return roundByInc(e, Jr, 7);
	}

	function computeNanoInc(e, n) {
	  return Xr[e] * n;
	}

	function computeDayInterval(e) {
	  const n = computeDayFloor(e);
	  return [ n, moveByDays(n, 1) ];
	}

	function computeDayFloor(e) {
	  return Ci(6, e);
	}

	function roundDayTimeDurationByInc(e, n, t) {
	  const o = Math.min(getMaxDurationUnit(e), 6);
	  return nanoToDurationDayTimeFields(roundBigNanoByInc(durationFieldsToBigNano(e, o), n, t), o);
	}

	function roundRelativeDuration(e, n, t, o, r, i, a, s, c, u) {
	  if (0 === o && 1 === r) {
	    return e;
	  }
	  const l = isUniformUnit(o, s) ? isZonedEpochSlots(s) && o < 6 && t >= 6 ? nudgeZonedTimeDuration : nudgeDayTimeDuration : nudgeRelativeDuration;
	  let [f, d, m] = l(e, n, t, o, r, i, a, s, c, u);
	  return m && 7 !== o && (f = ((e, n, t, o, r, i, a, s) => {
	    const c = computeDurationSign(e);
	    for (let u = o + 1; u <= t; u++) {
	      if (7 === u && 7 !== t) {
	        continue;
	      }
	      const o = bi(u, e);
	      o[F[u]] += c;
	      const l = oe(re(a(s(r, i, o)), n));
	      if (l && Math.sign(l) !== c) {
	        break;
	      }
	      e = o;
	    }
	    return e;
	  })(f, d, t, Math.max(6, o), a, s, c, u)), f;
	}

	function roundBigNano(e, n, t, o, r) {
	  if (6 === n) {
	    const n = (e => e[0] + e[1] / Qr)(e);
	    return [ roundByInc(n, t, o), 0 ];
	  }
	  return roundBigNanoByInc(e, computeNanoInc(n, t), o, r);
	}

	function roundBigNanoByInc(e, n, t, o) {
	  let [r, i] = e;
	  o && i < 0 && (i += Qr, r -= 1);
	  const [a, s] = divModFloor(roundByInc(i, n, t), Qr);
	  return createBigNano(r + a, s);
	}

	function roundByInc(e, n, t) {
	  return roundWithMode(e / n, t) * n;
	}

	function roundWithMode(e, n) {
	  return ga[n](e);
	}

	function nudgeDayTimeDuration(e, n, t, o, r, i) {
	  const a = computeDurationSign(e), s = durationFieldsToBigNano(e), c = roundBigNano(s, o, r, i), u = re(s, c), l = Math.sign(c[0] - s[0]) === a, f = nanoToDurationDayTimeFields(c, Math.min(t, 6));
	  return [ {
	    ...e,
	    ...f
	  }, addBigNanos(n, u), l ];
	}

	function nudgeZonedTimeDuration(e, n, t, o, r, i, a, s, c, u) {
	  const l = computeDurationSign(e), f = oe(durationFieldsToBigNano(e, 5)), d = computeNanoInc(o, r);
	  let m = roundByInc(f, d, i);
	  const [p, h] = clampRelativeDuration(a, {
	    ...e,
	    ...Fi
	  }, 6, l, s, c, u), g = m - oe(re(p, h));
	  let T = 0;
	  g && Math.sign(g) !== l ? n = moveBigNano(p, m) : (T += l, m = roundByInc(g, d, i), 
	  n = moveBigNano(h, m));
	  const D = nanoToDurationTimeFields(m);
	  return [ {
	    ...e,
	    ...D,
	    days: e.days + T
	  }, n, Boolean(T) ];
	}

	function nudgeRelativeDuration(e, n, t, o, r, i, a, s, c, u) {
	  const l = computeDurationSign(e), f = F[o], d = bi(o, e);
	  7 === o && (e = {
	    ...e,
	    weeks: e.weeks + Math.trunc(e.days / 7)
	  });
	  const m = divTrunc(e[f], r) * r;
	  d[f] = m;
	  const [p, h] = clampRelativeDuration(a, d, o, r * l, s, c, u), g = m + computeEpochNanoFrac(n, p, h) * l * r, T = roundByInc(g, r, i), D = Math.sign(T - g) === l;
	  return d[f] = T, [ d, D ? h : p, D ];
	}

	function me(e, n, t, o) {
	  const [r, i, a, s] = (e => {
	    const n = refineTimeDisplayTuple(e = normalizeOptions(e));
	    return [ e.timeZone, ...n ];
	  })(o), c = void 0 !== r;
	  return ((e, n, t, o, r, i) => {
	    t = roundBigNanoByInc(t, r, o, 1);
	    const a = n.getOffsetNanosecondsFor(t);
	    return formatIsoDateTimeFields(Ie(t, a), i) + (e ? Fe(roundToMinute(a)) : "Z");
	  })(c, n(c ? e(r) : Ta), t.epochNanoseconds, i, a, s);
	}

	function In(e, n, t) {
	  const [o, r, i, a, s, c] = (e => {
	    e = normalizeOptions(e);
	    const n = da(e), t = refineSubsecDigits(e), o = pa(e), r = ha(e, 4), i = aa(e, 4);
	    return [ n, ma(e), o, r, ...refineSmallestUnitAndSubsecDigits(i, t) ];
	  })(t);
	  return ((e, n, t, o, r, i, a, s, c, u) => {
	    o = roundBigNanoByInc(o, c, s, 1);
	    const l = e(t).getOffsetNanosecondsFor(o);
	    return formatIsoDateTimeFields(Ie(o, l), u) + Fe(roundToMinute(l), a) + ((e, n) => 1 !== n ? "[" + (2 === n ? "!" : "") + I(e) + "]" : "")(t, i) + formatCalendar(n, r);
	  })(e, n.calendar, n.timeZone, n.epochNanoseconds, o, r, i, a, s, c);
	}

	function Tt(e, n) {
	  const [t, o, r, i] = (e => (e = normalizeOptions(e), [ da(e), ...refineTimeDisplayTuple(e) ]))(n);
	  return a = e.calendar, s = t, c = i, formatIsoDateTimeFields(roundDateTimeToNano(e, r, o), c) + formatCalendar(a, s);
	  var a, s, c;
	}

	function yt(e, n) {
	  return t = e.calendar, o = e, r = refineDateDisplayOptions(n), formatIsoDateFields(o) + formatCalendar(t, r);
	  var t, o, r;
	}

	function et(e, n) {
	  return formatDateLikeIso(e.calendar, formatIsoYearMonthFields, e, refineDateDisplayOptions(n));
	}

	function W(e, n) {
	  return formatDateLikeIso(e.calendar, formatIsoMonthDayFields, e, refineDateDisplayOptions(n));
	}

	function qe(e, n) {
	  const [t, o, r] = refineTimeDisplayOptions(n);
	  return i = r, formatIsoTimeFields(roundTimeToNano(e, o, t)[0], i);
	  var i;
	}

	function zt(e, n) {
	  const [t, o, r] = refineTimeDisplayOptions(n, 3);
	  return o > 1 && (e = {
	    ...e,
	    ...roundDayTimeDurationByInc(e, o, t)
	  }), ((e, n) => {
	    const {sign: t} = e, o = -1 === t ? negateDurationFields(e) : e, {hours: r, minutes: i} = o, [a, s] = divModBigNano(durationFieldsToBigNano(o, 3), _r, divModTrunc);
	    checkDurationTimeUnit(a);
	    const c = formatSubsecNano(s, n), u = n >= 0 || !t || c;
	    return (t < 0 ? "-" : "") + "P" + formatDurationFragments({
	      Y: formatDurationNumber(o.years),
	      M: formatDurationNumber(o.months),
	      W: formatDurationNumber(o.weeks),
	      D: formatDurationNumber(o.days)
	    }) + (r || i || a || u ? "T" + formatDurationFragments({
	      H: formatDurationNumber(r),
	      M: formatDurationNumber(i),
	      S: formatDurationNumber(a, u) + c
	    }) : "");
	  })(e, r);
	}

	function formatDateLikeIso(e, n, t, o) {
	  const r = I(e), i = o > 1 || 0 === o && r !== X;
	  return 1 === o ? r === X ? n(t) : formatIsoDateFields(t) : i ? formatIsoDateFields(t) + formatCalendarId(r, 2 === o) : n(t);
	}

	function formatDurationFragments(e) {
	  const n = [];
	  for (const t in e) {
	    const o = e[t];
	    o && n.push(o, t);
	  }
	  return n.join("");
	}

	function formatIsoDateTimeFields(e, n) {
	  return formatIsoDateFields(e) + "T" + formatIsoTimeFields(e, n);
	}

	function formatIsoDateFields(e) {
	  return formatIsoYearMonthFields(e) + "-" + xr(e.isoDay);
	}

	function formatIsoYearMonthFields(e) {
	  const {isoYear: n} = e;
	  return (n < 0 || n > 9999 ? getSignStr(n) + padNumber(6, Math.abs(n)) : padNumber(4, n)) + "-" + xr(e.isoMonth);
	}

	function formatIsoMonthDayFields(e) {
	  return xr(e.isoMonth) + "-" + xr(e.isoDay);
	}

	function formatIsoTimeFields(e, n) {
	  const t = [ xr(e.isoHour), xr(e.isoMinute) ];
	  return -1 !== n && t.push(xr(e.isoSecond) + ((e, n, t, o) => formatSubsecNano(e * be + n * Vr + t, o))(e.isoMillisecond, e.isoMicrosecond, e.isoNanosecond, n)), 
	  t.join(":");
	}

	function Fe(e, n = 0) {
	  if (1 === n) {
	    return "";
	  }
	  const [t, o] = divModFloor(Math.abs(e), Kr), [r, i] = divModFloor(o, Jr), [a, s] = divModFloor(i, _r);
	  return getSignStr(e) + xr(t) + ":" + xr(r) + (a || s ? ":" + xr(a) + formatSubsecNano(s) : "");
	}

	function formatCalendar(e, n) {
	  if (1 !== n) {
	    const t = I(e);
	    if (n > 1 || 0 === n && t !== X) {
	      return formatCalendarId(t, 2 === n);
	    }
	  }
	  return "";
	}

	function formatCalendarId(e, n) {
	  return "[" + (n ? "!" : "") + "u-ca=" + e + "]";
	}

	function formatSubsecNano(e, n) {
	  let t = padNumber(9, e);
	  return t = void 0 === n ? t.replace(Na, "") : t.slice(0, n), t ? "." + t : "";
	}

	function getSignStr(e) {
	  return e < 0 ? "-" : "+";
	}

	function formatDurationNumber(e, n) {
	  return e || n ? e.toLocaleString("fullwide", {
	    useGrouping: 0
	  }) : "";
	}

	function _zonedEpochSlotsToIso(e, n) {
	  const {epochNanoseconds: t} = e, o = (n.getOffsetNanosecondsFor ? n : n(e.timeZone)).getOffsetNanosecondsFor(t), r = Ie(t, o);
	  return {
	    calendar: e.calendar,
	    ...r,
	    offsetNanoseconds: o
	  };
	}

	function mn(e, n) {
	  const t = fn(n, e);
	  return {
	    calendar: n.calendar,
	    ...Vn(Yi, t),
	    offset: Fe(t.offsetNanoseconds),
	    timeZone: n.timeZone
	  };
	}

	function getMatchingInstantFor(e, n, t, o = 0, r = 0, i, a) {
	  if (void 0 !== t && 1 === o && (1 === o || a)) {
	    return isoToEpochNanoWithOffset(n, t);
	  }
	  const s = e.getPossibleInstantsFor(n);
	  if (void 0 !== t && 3 !== o) {
	    const e = ((e, n, t, o) => {
	      const r = isoToEpochNano(n);
	      o && (t = roundToMinute(t));
	      for (const n of e) {
	        let e = oe(re(n, r));
	        if (o && (e = roundToMinute(e)), e === t) {
	          return n;
	        }
	      }
	    })(s, n, t, i);
	    if (void 0 !== e) {
	      return e;
	    }
	    if (0 === o) {
	      throw new RangeError(kr);
	    }
	  }
	  return a ? isoToEpochNano(n) : we(e, n, r, s);
	}

	function we(e, n, t = 0, o = e.getPossibleInstantsFor(n)) {
	  if (1 === o.length) {
	    return o[0];
	  }
	  if (1 === t) {
	    throw new RangeError(Yr);
	  }
	  if (o.length) {
	    return o[3 === t ? 1 : 0];
	  }
	  const r = isoToEpochNano(n), i = ((e, n) => {
	    const t = e.getOffsetNanosecondsFor(moveBigNano(n, -864e11));
	    return ne(e.getOffsetNanosecondsFor(moveBigNano(n, Qr)) - t);
	  })(e, r), a = i * (2 === t ? -1 : 1);
	  return (o = e.getPossibleInstantsFor(Ie(r, a)))[2 === t ? 0 : o.length - 1];
	}

	function ae(e) {
	  if (Math.abs(e) >= Qr) {
	    throw new RangeError(wr);
	  }
	  return e;
	}

	function ne(e) {
	  if (e > Qr) {
	    throw new RangeError(Br);
	  }
	  return e;
	}

	function se(e, n, t) {
	  return _(checkEpochNanoInBounds(addBigNanos(n.epochNanoseconds, (e => {
	    if (durationHasDateParts(e)) {
	      throw new RangeError(qr);
	    }
	    return durationFieldsToBigNano(e, 5);
	  })(e ? negateDurationFields(t) : t))));
	}

	function hn(e, n, t, o, r, i = Object.create(null)) {
	  const a = n(o.timeZone), s = e(o.calendar);
	  return {
	    ...o,
	    ...moveZonedEpochs(a, s, o, t ? negateDurationFields(r) : r, i)
	  };
	}

	function ct(e, n, t, o, r = Object.create(null)) {
	  const {calendar: i} = t;
	  return ee(moveDateTime(e(i), t, n ? negateDurationFields(o) : o, r), i);
	}

	function bt(e, n, t, o, r) {
	  const {calendar: i} = t;
	  return v(moveDate(e(i), t, n ? negateDurationFields(o) : o, r), i);
	}

	function Qe(e, n, t, o, r = Object.create(null)) {
	  const i = t.calendar, a = e(i);
	  let s = moveToDayOfMonthUnsafe(a, t);
	  n && (o = xt(o)), o.sign < 0 && (s = a.dateAdd(s, {
	    ...Si,
	    months: 1
	  }), s = moveByDays(s, -1));
	  const c = a.dateAdd(s, o, r);
	  return createPlainYearMonthSlots(moveToDayOfMonthUnsafe(a, c), i);
	}

	function Ye(e, n, t) {
	  return Ge(moveTime(n, e ? negateDurationFields(t) : t)[0]);
	}

	function moveZonedEpochs(e, n, t, o, r) {
	  const i = durationFieldsToBigNano(o, 5);
	  let a = t.epochNanoseconds;
	  if (durationHasDateParts(o)) {
	    const s = fn(t, e);
	    a = addBigNanos(we(e, {
	      ...moveDate(n, s, {
	        ...o,
	        ...Fi
	      }, r),
	      ...Vn(j, s)
	    }), i);
	  } else {
	    a = addBigNanos(a, i), H(r);
	  }
	  return {
	    epochNanoseconds: checkEpochNanoInBounds(a)
	  };
	}

	function moveDateTime(e, n, t, o) {
	  const [r, i] = moveTime(n, t);
	  return checkIsoDateTimeInBounds({
	    ...moveDate(e, n, {
	      ...t,
	      ...Fi,
	      days: t.days + i
	    }, o),
	    ...r
	  });
	}

	function moveDate(e, n, t, o) {
	  if (t.years || t.months || t.weeks) {
	    return e.dateAdd(n, t, o);
	  }
	  H(o);
	  const r = t.days + durationFieldsToBigNano(t, 5)[0];
	  return r ? checkIsoDateInBounds(moveByDays(n, r)) : n;
	}

	function moveToDayOfMonthUnsafe(e, n, t = 1) {
	  return moveByDays(n, t - e.day(n));
	}

	function moveTime(e, n) {
	  const [t, o] = durationFieldsToBigNano(n, 5), [r, i] = nanoToIsoTimeAndDay(isoTimeFieldsToNano(e) + o);
	  return [ r, t + i ];
	}

	function moveByDays(e, n) {
	  return n ? {
	    ...e,
	    ...epochMilliToIso(isoToEpochMilli(e) + n * Gr)
	  } : e;
	}

	function createMarkerSystem(e, n, t) {
	  const o = e(t.calendar);
	  return isZonedEpochSlots(t) ? [ t, o, n(t.timeZone) ] : [ {
	    ...t,
	    ...Dt
	  }, o ];
	}

	function createMarkerToEpochNano(e) {
	  return e ? extractEpochNano : isoToEpochNano;
	}

	function createMoveMarker(e) {
	  return e ? E(moveZonedEpochs, e) : moveDateTime;
	}

	function createDiffMarkers(e) {
	  return e ? E(diffZonedEpochsExact, e) : diffDateTimesExact;
	}

	function isZonedEpochSlots(e) {
	  return e && e.epochNanoseconds;
	}

	function isUniformUnit(e, n) {
	  return e <= 6 - (isZonedEpochSlots(n) ? 1 : 0);
	}

	function Wt(e, n, t, o, r, i, a) {
	  const s = e(normalizeOptions(a).relativeTo), c = Math.max(getMaxDurationUnit(r), getMaxDurationUnit(i));
	  if (isUniformUnit(c, s)) {
	    return Vt(checkDurationUnits(((e, n, t, o) => {
	      const r = addBigNanos(durationFieldsToBigNano(e), durationFieldsToBigNano(n), o ? -1 : 1);
	      if (!Number.isFinite(r[0])) {
	        throw new RangeError(Cr);
	      }
	      return {
	        ...Si,
	        ...nanoToDurationDayTimeFields(r, t)
	      };
	    })(r, i, c, o)));
	  }
	  if (!s) {
	    throw new RangeError(zr);
	  }
	  o && (i = negateDurationFields(i));
	  const [u, l, f] = createMarkerSystem(n, t, s), d = createMoveMarker(f), m = createDiffMarkers(f), p = d(l, u, r);
	  return Vt(m(l, u, d(l, p, i), c));
	}

	function Gt(e, n, t, o, r) {
	  const i = getMaxDurationUnit(o), [a, s, c, u, l] = ((e, n, t) => {
	    e = normalizeOptionsOrString(e, Hi);
	    let o = sa(e);
	    const r = t(e[Ki]);
	    let i = parseRoundingIncInteger(e);
	    const a = ha(e, 7);
	    let s = aa(e);
	    if (void 0 === o && void 0 === s) {
	      throw new RangeError(Ur);
	    }
	    return null == s && (s = 0), null == o && (o = Math.max(s, n)), checkLargestSmallestUnit(o, s), 
	    i = refineRoundingInc(i, s, 1), [ o, s, i, a, r ];
	  })(r, i, e), f = Math.max(i, a);
	  if (!isZonedEpochSlots(l) && f <= 6) {
	    return Vt(checkDurationUnits(((e, n, t, o, r) => {
	      const i = roundBigNano(durationFieldsToBigNano(e), t, o, r);
	      return {
	        ...Si,
	        ...nanoToDurationDayTimeFields(i, n)
	      };
	    })(o, a, s, c, u)));
	  }
	  if (!l) {
	    throw new RangeError(zr);
	  }
	  const [d, m, p] = createMarkerSystem(n, t, l), h = createMarkerToEpochNano(p), g = createMoveMarker(p), T = createDiffMarkers(p), D = g(m, d, o);
	  let I = T(m, d, D, a);
	  const M = o.sign, N = computeDurationSign(I);
	  if (M && N && M !== N) {
	    throw new RangeError(vr);
	  }
	  return N && (I = roundRelativeDuration(I, h(D), a, s, c, u, m, d, h, g)), Vt(I);
	}

	function Rt(e) {
	  return -1 === e.sign ? xt(e) : e;
	}

	function xt(e) {
	  return Vt(negateDurationFields(e));
	}

	function negateDurationFields(e) {
	  const n = {};
	  for (const t of F) {
	    n[t] = -1 * e[t] || 0;
	  }
	  return n;
	}

	function Jt(e) {
	  return !e.sign;
	}

	function computeDurationSign(e, n = F) {
	  let t = 0;
	  for (const o of n) {
	    const n = Math.sign(e[o]);
	    if (n) {
	      if (t && t !== n) {
	        throw new RangeError(Rr);
	      }
	      t = n;
	    }
	  }
	  return t;
	}

	function checkDurationUnits(e) {
	  for (const n of vi) {
	    clampEntity(n, e[n], -4294967295, ya, 1);
	  }
	  return checkDurationTimeUnit(oe(durationFieldsToBigNano(e), _r)), e;
	}

	function checkDurationTimeUnit(e) {
	  if (!Number.isSafeInteger(e)) {
	    throw new RangeError(Zr);
	  }
	}

	function durationFieldsToBigNano(e, n = 6) {
	  return givenFieldsToBigNano(e, n, F);
	}

	function nanoToDurationDayTimeFields(e, n = 6) {
	  const [t, o] = e, r = nanoToGivenFields(o, n, F);
	  if (r[F[n]] += t * (Qr / Xr[n]), !Number.isFinite(r[F[n]])) {
	    throw new RangeError(Cr);
	  }
	  return r;
	}

	function nanoToDurationTimeFields(e, n = 5) {
	  return nanoToGivenFields(e, n, F);
	}

	function durationHasDateParts(e) {
	  return Boolean(computeDurationSign(e, Pi));
	}

	function getMaxDurationUnit(e) {
	  let n = 9;
	  for (;n > 0 && !e[F[n]]; n--) {}
	  return n;
	}

	function createSplitTuple(e, n) {
	  return [ e, n ];
	}

	function computePeriod(e) {
	  const n = Math.floor(e / Da) * Da;
	  return [ n, n + Da ];
	}

	function pe(e) {
	  const n = parseDateTimeLike(e = toStringViaPrimitive(e));
	  if (!n) {
	    throw new RangeError(failedParse(e));
	  }
	  let t;
	  if (n.m) {
	    t = 0;
	  } else {
	    if (!n.offset) {
	      throw new RangeError(failedParse(e));
	    }
	    t = parseOffsetNano(n.offset);
	  }
	  return n.timeZone && parseOffsetNanoMaybe(n.timeZone, 1), _(isoToEpochNanoWithOffset(checkIsoDateTimeFields(n), t));
	}

	function Xt(e) {
	  const n = parseDateTimeLike(m(e));
	  if (!n) {
	    throw new RangeError(failedParse(e));
	  }
	  if (n.timeZone) {
	    return finalizeZonedDateTime(n, n.offset ? parseOffsetNano(n.offset) : void 0);
	  }
	  if (n.m) {
	    throw new RangeError(failedParse(e));
	  }
	  return finalizeDate(n);
	}

	function Mn(e, n) {
	  const t = parseDateTimeLike(m(e));
	  if (!t || !t.timeZone) {
	    throw new RangeError(failedParse(e));
	  }
	  const {offset: o} = t, r = o ? parseOffsetNano(o) : void 0, [, i, a] = wn(n);
	  return finalizeZonedDateTime(t, r, i, a);
	}

	function parseOffsetNano(e) {
	  const n = parseOffsetNanoMaybe(e);
	  if (void 0 === n) {
	    throw new RangeError(failedParse(e));
	  }
	  return n;
	}

	function Ct(e) {
	  const n = parseDateTimeLike(m(e));
	  if (!n || n.m) {
	    throw new RangeError(failedParse(e));
	  }
	  return ee(finalizeDateTime(n));
	}

	function At(e) {
	  const n = parseDateTimeLike(m(e));
	  if (!n || n.m) {
	    throw new RangeError(failedParse(e));
	  }
	  return v(n.p ? finalizeDateTime(n) : finalizeDate(n));
	}

	function ot(e, n) {
	  const t = parseYearMonthOnly(m(n));
	  if (t) {
	    return requireIsoCalendar(t), createPlainYearMonthSlots(checkIsoYearMonthInBounds(checkIsoDateFields(t)));
	  }
	  const o = At(n);
	  return createPlainYearMonthSlots(moveToDayOfMonthUnsafe(e(o.calendar), o));
	}

	function requireIsoCalendar(e) {
	  if (e.calendar !== X) {
	    throw new RangeError(invalidSubstring(e.calendar));
	  }
	}

	function Q(e, n) {
	  const t = parseMonthDayOnly(m(n));
	  if (t) {
	    return requireIsoCalendar(t), createPlainMonthDaySlots(checkIsoDateFields(t));
	  }
	  const o = At(n), {calendar: r} = o, i = e(r), [a, s, c] = i.h(o), [u, l] = i.I(a, s), [f, d] = i.N(u, l, c);
	  return createPlainMonthDaySlots(checkIsoDateInBounds(i.P(f, d, c)), r);
	}

	function ze(e) {
	  let n, t = (e => {
	    const n = Ca.exec(e);
	    return n ? (organizeAnnotationParts(n[10]), organizeTimeParts(n)) : void 0;
	  })(m(e));
	  if (!t) {
	    if (t = parseDateTimeLike(e), !t) {
	      throw new RangeError(failedParse(e));
	    }
	    if (!t.p) {
	      throw new RangeError(failedParse(e));
	    }
	    if (t.m) {
	      throw new RangeError(invalidSubstring("Z"));
	    }
	    requireIsoCalendar(t);
	  }
	  if ((n = parseYearMonthOnly(e)) && isIsoDateFieldsValid(n)) {
	    throw new RangeError(failedParse(e));
	  }
	  if ((n = parseMonthDayOnly(e)) && isIsoDateFieldsValid(n)) {
	    throw new RangeError(failedParse(e));
	  }
	  return Ge(constrainIsoTimeFields(t, 1));
	}

	function Kt(e) {
	  const n = (e => {
	    const n = za.exec(e);
	    return n ? (e => {
	      function parseUnit(e, r, i) {
	        let a = 0, s = 0;
	        if (i && ([a, o] = divModFloor(o, Xr[i])), void 0 !== e) {
	          if (t) {
	            throw new RangeError(invalidSubstring(e));
	          }
	          s = (e => {
	            const n = parseInt(e);
	            if (!Number.isFinite(n)) {
	              throw new RangeError(invalidSubstring(e));
	            }
	            return n;
	          })(e), n = 1, r && (o = parseSubsecNano(r) * (Xr[i] / _r), t = 1);
	        }
	        return a + s;
	      }
	      let n = 0, t = 0, o = 0, r = {
	        ...zipProps(F, [ parseUnit(e[2]), parseUnit(e[3]), parseUnit(e[4]), parseUnit(e[5]), parseUnit(e[6], e[7], 5), parseUnit(e[8], e[9], 4), parseUnit(e[10], e[11], 3) ]),
	        ...nanoToGivenFields(o, 2, F)
	      };
	      if (!n) {
	        throw new RangeError(noValidFields(F));
	      }
	      return parseSign(e[1]) < 0 && (r = negateDurationFields(r)), r;
	    })(n) : void 0;
	  })(m(e));
	  if (!n) {
	    throw new RangeError(failedParse(e));
	  }
	  return Vt(checkDurationUnits(n));
	}

	function sn(e) {
	  const n = parseDateTimeLike(e) || parseYearMonthOnly(e) || parseMonthDayOnly(e);
	  return n ? n.calendar : e;
	}

	function Ne(e) {
	  const n = parseDateTimeLike(e);
	  return n && (n.timeZone || n.m && Ta || n.offset) || e;
	}

	function finalizeZonedDateTime(e, n, t = 0, o = 0) {
	  const r = ye(e.timeZone), i = ie(r);
	  return Yn(getMatchingInstantFor(i, checkIsoDateTimeFields(e), n, t, o, !i.v, e.m), r, an(e.calendar));
	}

	function finalizeDateTime(e) {
	  return resolveSlotsCalendar(checkIsoDateTimeInBounds(checkIsoDateTimeFields(e)));
	}

	function finalizeDate(e) {
	  return resolveSlotsCalendar(checkIsoDateInBounds(checkIsoDateFields(e)));
	}

	function resolveSlotsCalendar(e) {
	  return {
	    ...e,
	    calendar: an(e.calendar)
	  };
	}

	function parseDateTimeLike(e) {
	  const n = Ya.exec(e);
	  return n ? (e => {
	    const n = e[10], t = "Z" === (n || "").toUpperCase();
	    return {
	      isoYear: organizeIsoYearParts(e),
	      isoMonth: parseInt(e[4]),
	      isoDay: parseInt(e[5]),
	      ...organizeTimeParts(e.slice(5)),
	      ...organizeAnnotationParts(e[16]),
	      p: Boolean(e[6]),
	      m: t,
	      offset: t ? void 0 : n
	    };
	  })(n) : void 0;
	}

	function parseYearMonthOnly(e) {
	  const n = Ba.exec(e);
	  return n ? (e => ({
	    isoYear: organizeIsoYearParts(e),
	    isoMonth: parseInt(e[4]),
	    isoDay: 1,
	    ...organizeAnnotationParts(e[5])
	  }))(n) : void 0;
	}

	function parseMonthDayOnly(e) {
	  const n = ka.exec(e);
	  return n ? (e => ({
	    isoYear: ji,
	    isoMonth: parseInt(e[1]),
	    isoDay: parseInt(e[2]),
	    ...organizeAnnotationParts(e[3])
	  }))(n) : void 0;
	}

	function parseOffsetNanoMaybe(e, n) {
	  const t = Za.exec(e);
	  return t ? ((e, n) => {
	    const t = e[4] || e[5];
	    if (n && t) {
	      throw new RangeError(invalidSubstring(t));
	    }
	    return ae((parseInt0(e[2]) * Kr + parseInt0(e[3]) * Jr + parseInt0(e[4]) * _r + parseSubsecNano(e[5] || "")) * parseSign(e[1]));
	  })(t, n) : void 0;
	}

	function organizeIsoYearParts(e) {
	  const n = parseSign(e[1]), t = parseInt(e[2] || e[3]);
	  if (n < 0 && !t) {
	    throw new RangeError(invalidSubstring(-0));
	  }
	  return n * t;
	}

	function organizeTimeParts(e) {
	  const n = parseInt0(e[3]);
	  return {
	    ...nanoToIsoTimeAndDay(parseSubsecNano(e[4] || ""))[0],
	    isoHour: parseInt0(e[1]),
	    isoMinute: parseInt0(e[2]),
	    isoSecond: 60 === n ? 59 : n
	  };
	}

	function organizeAnnotationParts(e) {
	  let n, t;
	  const o = [];
	  if (e.replace(Ra, ((e, r, i) => {
	    const a = Boolean(r), [s, c] = i.split("=").reverse();
	    if (c) {
	      if ("u-ca" === c) {
	        o.push(s), n || (n = a);
	      } else if (a || /[A-Z]/.test(c)) {
	        throw new RangeError(invalidSubstring(e));
	      }
	    } else {
	      if (t) {
	        throw new RangeError(invalidSubstring(e));
	      }
	      t = s;
	    }
	    return "";
	  })), o.length > 1 && n) {
	    throw new RangeError(invalidSubstring(e));
	  }
	  return {
	    timeZone: t,
	    calendar: o[0] || X
	  };
	}

	function parseSubsecNano(e) {
	  return parseInt(e.padEnd(9, "0"));
	}

	function createRegExp(e) {
	  return new RegExp(`^${e}$`, "i");
	}

	function parseSign(e) {
	  return e && "+" !== e ? -1 : 1;
	}

	function parseInt0(e) {
	  return void 0 === e ? 0 : parseInt(e);
	}

	function Me(e) {
	  return ye(m(e));
	}

	function ye(e) {
	  const n = getTimeZoneEssence(e);
	  return "number" == typeof n ? Fe(n) : n ? (e => {
	    if (Ua.test(e)) {
	      throw new RangeError(br);
	    }
	    return e.toLowerCase().split("/").map(((e, n) => (e.length <= 3 || /\d/.test(e)) && !/etc|yap/.test(e) ? e.toUpperCase() : e.replace(/baja|dumont|[a-z]+/g, ((e, t) => e.length <= 2 && !n || "in" === e || "chat" === e ? e.toUpperCase() : e.length > 2 || !t ? capitalize(e).replace(/island|noronha|murdo|rivadavia|urville/, capitalize) : e)))).join("/");
	  })(e) : Ta;
	}

	function getTimeZoneAtomic(e) {
	  const n = getTimeZoneEssence(e);
	  return "number" == typeof n ? n : n ? n.resolvedOptions().timeZone : Ta;
	}

	function getTimeZoneEssence(e) {
	  const n = parseOffsetNanoMaybe(e = e.toUpperCase(), 1);
	  return void 0 !== n ? n : e !== Ta ? qa(e) : void 0;
	}

	function Ze(e, n) {
	  return te(e.epochNanoseconds, n.epochNanoseconds);
	}

	function yn(e, n) {
	  return te(e.epochNanoseconds, n.epochNanoseconds);
	}

	function $t(e, n, t, o, r, i) {
	  const a = e(normalizeOptions(i).relativeTo), s = Math.max(getMaxDurationUnit(o), getMaxDurationUnit(r));
	  if (allPropsEqual(F, o, r)) {
	    return 0;
	  }
	  if (isUniformUnit(s, a)) {
	    return te(durationFieldsToBigNano(o), durationFieldsToBigNano(r));
	  }
	  if (!a) {
	    throw new RangeError(zr);
	  }
	  const [c, u, l] = createMarkerSystem(n, t, a), f = createMarkerToEpochNano(l), d = createMoveMarker(l);
	  return te(f(d(u, c, o)), f(d(u, c, r)));
	}

	function gt(e, n) {
	  return rt(e, n) || He(e, n);
	}

	function rt(e, n) {
	  return compareNumbers(isoToEpochMilli(e), isoToEpochMilli(n));
	}

	function He(e, n) {
	  return compareNumbers(isoTimeFieldsToNano(e), isoTimeFieldsToNano(n));
	}

	function ue(e, n) {
	  return !Ze(e, n);
	}

	function gn(e, n) {
	  return !yn(e, n) && !!je(e.timeZone, n.timeZone) && isIdLikeEqual(e.calendar, n.calendar);
	}

	function ft(e, n) {
	  return !gt(e, n) && isIdLikeEqual(e.calendar, n.calendar);
	}

	function It(e, n) {
	  return !rt(e, n) && isIdLikeEqual(e.calendar, n.calendar);
	}

	function $e(e, n) {
	  return !rt(e, n) && isIdLikeEqual(e.calendar, n.calendar);
	}

	function x(e, n) {
	  return !rt(e, n) && isIdLikeEqual(e.calendar, n.calendar);
	}

	function Ve(e, n) {
	  return !He(e, n);
	}

	function je(e, n) {
	  if (e === n) {
	    return 1;
	  }
	  const t = I(e), o = I(n);
	  if (t === o) {
	    return 1;
	  }
	  try {
	    return getTimeZoneAtomic(t) === getTimeZoneAtomic(o);
	  } catch (e) {}
	}

	function le(e, n, t, o) {
	  const r = refineDiffOptions(e, U(o), 3, 5), i = diffEpochNanos(n.epochNanoseconds, t.epochNanoseconds, ...r);
	  return Vt(e ? negateDurationFields(i) : i);
	}

	function Dn(e, n, t, o, r, i) {
	  const a = getCommonCalendarSlot(o.calendar, r.calendar), s = U(i), [c, u, l, f] = refineDiffOptions(t, s, 5), d = o.epochNanoseconds, m = r.epochNanoseconds, p = te(m, d);
	  let h;
	  if (p) {
	    if (c < 6) {
	      h = diffEpochNanos(d, m, c, u, l, f);
	    } else {
	      const t = n(((e, n) => {
	        if (!je(e, n)) {
	          throw new RangeError(Fr);
	        }
	        return e;
	      })(o.timeZone, r.timeZone)), i = e(a);
	      h = diffZonedEpochsBig(i, t, o, r, p, c, s), h = roundRelativeDuration(h, m, c, u, l, f, i, o, extractEpochNano, E(moveZonedEpochs, t));
	    }
	  } else {
	    h = Si;
	  }
	  return Vt(t ? negateDurationFields(h) : h);
	}

	function ut(e, n, t, o, r) {
	  const i = getCommonCalendarSlot(t.calendar, o.calendar), a = U(r), [s, c, u, l] = refineDiffOptions(n, a, 6), f = isoToEpochNano(t), d = isoToEpochNano(o), m = te(d, f);
	  let p;
	  if (m) {
	    if (s <= 6) {
	      p = diffEpochNanos(f, d, s, c, u, l);
	    } else {
	      const n = e(i);
	      p = diffDateTimesBig(n, t, o, m, s, a), p = roundRelativeDuration(p, d, s, c, u, l, n, t, isoToEpochNano, moveDateTime);
	    }
	  } else {
	    p = Si;
	  }
	  return Vt(n ? negateDurationFields(p) : p);
	}

	function Ft(e, n, t, o, r) {
	  const i = getCommonCalendarSlot(t.calendar, o.calendar), a = U(r);
	  return diffDateLike(n, (() => e(i)), t, o, ...refineDiffOptions(n, a, 6, 9, 6), a);
	}

	function Xe(e, n, t, o, r) {
	  const i = getCommonCalendarSlot(t.calendar, o.calendar), a = U(r), s = refineDiffOptions(n, a, 9, 9, 8), c = e(i);
	  return diffDateLike(n, (() => c), moveToDayOfMonthUnsafe(c, t), moveToDayOfMonthUnsafe(c, o), ...s, a);
	}

	function diffDateLike(e, n, t, o, r, i, a, s, c) {
	  const u = isoToEpochNano(t), l = isoToEpochNano(o);
	  let f;
	  if (te(l, u)) {
	    if (6 === r) {
	      f = diffEpochNanos(u, l, r, i, a, s);
	    } else {
	      const e = n();
	      f = e.dateUntil(t, o, r, c), 6 === i && 1 === a || (f = roundRelativeDuration(f, l, r, i, a, s, e, t, isoToEpochNano, moveDate));
	    }
	  } else {
	    f = Si;
	  }
	  return Vt(e ? negateDurationFields(f) : f);
	}

	function Ae(e, n, t, o) {
	  const r = U(o), [i, a, s, c] = refineDiffOptions(e, r, 5, 5), u = roundByInc(diffTimes(n, t), computeNanoInc(a, s), c), l = {
	    ...Si,
	    ...nanoToDurationTimeFields(u, i)
	  };
	  return Vt(e ? negateDurationFields(l) : l);
	}

	function diffZonedEpochsExact(e, n, t, o, r, i) {
	  const a = te(o.epochNanoseconds, t.epochNanoseconds);
	  return a ? r < 6 ? diffEpochNanosExact(t.epochNanoseconds, o.epochNanoseconds, r) : diffZonedEpochsBig(n, e, t, o, a, r, i) : Si;
	}

	function diffDateTimesExact(e, n, t, o, r) {
	  const i = isoToEpochNano(n), a = isoToEpochNano(t), s = te(a, i);
	  return s ? o <= 6 ? diffEpochNanosExact(i, a, o) : diffDateTimesBig(e, n, t, s, o, r) : Si;
	}

	function diffZonedEpochsBig(e, n, t, o, r, i, a) {
	  const [s, c, u] = ((e, n, t, o) => {
	    function updateMid() {
	      return l = {
	        ...moveByDays(a, c++ * -o),
	        ...i
	      }, f = we(e, l), te(s, f) === -o;
	    }
	    const r = fn(n, e), i = Vn(j, r), a = fn(t, e), s = t.epochNanoseconds;
	    let c = 0;
	    const u = diffTimes(r, a);
	    let l, f;
	    if (Math.sign(u) === -o && c++, updateMid() && (-1 === o || updateMid())) {
	      throw new RangeError(vr);
	    }
	    const d = oe(re(f, s));
	    return [ r, l, d ];
	  })(n, t, o, r);
	  var l, f;
	  return {
	    ...6 === i ? (l = s, f = c, {
	      ...Si,
	      days: diffDays(l, f)
	    }) : e.dateUntil(s, c, i, a),
	    ...nanoToDurationTimeFields(u)
	  };
	}

	function diffDateTimesBig(e, n, t, o, r, i) {
	  const [a, s, c] = ((e, n, t) => {
	    let o = n, r = diffTimes(e, n);
	    return Math.sign(r) === -t && (o = moveByDays(n, -t), r += Qr * t), [ e, o, r ];
	  })(n, t, o);
	  return {
	    ...e.dateUntil(a, s, r, i),
	    ...nanoToDurationTimeFields(c)
	  };
	}

	function diffEpochNanos(e, n, t, o, r, i) {
	  return {
	    ...Si,
	    ...nanoToDurationDayTimeFields(roundBigNano(re(e, n), o, r, i), t)
	  };
	}

	function diffEpochNanosExact(e, n, t) {
	  return {
	    ...Si,
	    ...nanoToDurationDayTimeFields(re(e, n), t)
	  };
	}

	function diffDays(e, n) {
	  return diffEpochMilliByDay(isoToEpochMilli(e), isoToEpochMilli(n));
	}

	function diffEpochMilliByDay(e, n) {
	  return Math.trunc((n - e) / Gr);
	}

	function diffTimes(e, n) {
	  return isoTimeFieldsToNano(n) - isoTimeFieldsToNano(e);
	}

	function getCommonCalendarSlot(e, n) {
	  if (!isIdLikeEqual(e, n)) {
	    throw new RangeError(Er);
	  }
	  return e;
	}

	function createIntlCalendar(e) {
	  function epochMilliToIntlFields(e) {
	    return ((e, n) => ({
	      ...parseIntlYear(e, n),
	      F: e.month,
	      day: parseInt(e.day)
	    }))(hashIntlFormatParts(n, e), t);
	  }
	  const n = La(e), t = computeCalendarIdBase(e);
	  return {
	    id: e,
	    O: createIntlFieldCache(epochMilliToIntlFields),
	    B: createIntlYearDataCache(epochMilliToIntlFields)
	  };
	}

	function createIntlFieldCache(e) {
	  return Jn((n => {
	    const t = isoToEpochMilli(n);
	    return e(t);
	  }), WeakMap);
	}

	function createIntlYearDataCache(e) {
	  const n = e(0).year - Wi;
	  return Jn((t => {
	    let o, r = isoArgsToEpochMilli(t - n);
	    const i = [], a = [];
	    do {
	      r += 400 * Gr;
	    } while ((o = e(r)).year <= t);
	    do {
	      r += (1 - o.day) * Gr, o.year === t && (i.push(r), a.push(o.F)), r -= Gr;
	    } while ((o = e(r)).year >= t);
	    return {
	      k: i.reverse(),
	      C: Wr(a.reverse())
	    };
	  }));
	}

	function parseIntlYear(e, n) {
	  let t, o, r = parseIntlPartsYear(e);
	  if (e.era) {
	    const i = Di[n];
	    void 0 !== i && (t = "islamic" === n ? "ah" : e.era.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, ""), 
	    "bc" === t || "b" === t ? t = "bce" : "ad" !== t && "a" !== t || (t = "ce"), o = r, 
	    r = eraYearToYear(o, i[t] || 0));
	  }
	  return {
	    era: t,
	    eraYear: o,
	    year: r
	  };
	}

	function parseIntlPartsYear(e) {
	  return parseInt(e.relatedYear || e.year);
	}

	function computeIntlDateParts(e) {
	  const {year: n, F: t, day: o} = this.O(e), {C: r} = this.B(n);
	  return [ n, r[t] + 1, o ];
	}

	function computeIntlEpochMilli(e, n = 1, t = 1) {
	  return this.B(e).k[n - 1] + (t - 1) * Gr;
	}

	function computeIntlLeapMonth(e) {
	  const n = queryMonthStrings(this, e), t = queryMonthStrings(this, e - 1), o = n.length;
	  if (o > t.length) {
	    const e = getCalendarLeapMonthMeta(this);
	    if (e < 0) {
	      return -e;
	    }
	    for (let e = 0; e < o; e++) {
	      if (n[e] !== t[e]) {
	        return e + 1;
	      }
	    }
	  }
	}

	function computeIntlDaysInYear(e) {
	  return diffEpochMilliByDay(computeIntlEpochMilli.call(this, e), computeIntlEpochMilli.call(this, e + 1));
	}

	function computeIntlDaysInMonth(e, n) {
	  const {k: t} = this.B(e);
	  let o = n + 1, r = t;
	  return o > t.length && (o = 1, r = this.B(e + 1).k), diffEpochMilliByDay(t[n - 1], r[o - 1]);
	}

	function computeIntlMonthsInYear(e) {
	  return this.B(e).k.length;
	}

	function queryMonthStrings(e, n) {
	  return Object.keys(e.B(n).C);
	}

	function rn(e) {
	  return an(m(e));
	}

	function an(e) {
	  if ((e = e.toLowerCase()) !== X && e !== gi && computeCalendarIdBase(e) !== computeCalendarIdBase(La(e).resolvedOptions().calendar)) {
	    throw new RangeError(invalidCalendar(e));
	  }
	  return e;
	}

	function computeCalendarIdBase(e) {
	  return "islamicc" === e && (e = "islamic"), e.split("-")[0];
	}

	function computeNativeWeekOfYear(e) {
	  return this.R(e)[0];
	}

	function computeNativeYearOfWeek(e) {
	  return this.R(e)[1];
	}

	function computeNativeDayOfYear(e) {
	  const [n] = this.h(e);
	  return diffEpochMilliByDay(this.q(n), isoToEpochMilli(e)) + 1;
	}

	function parseMonthCode(e) {
	  const n = Wa.exec(e);
	  if (!n) {
	    throw new RangeError(invalidMonthCode(e));
	  }
	  return [ parseInt(n[1]), Boolean(n[2]) ];
	}

	function monthCodeNumberToMonth(e, n, t) {
	  return e + (n || t && e >= t ? 1 : 0);
	}

	function monthToMonthCodeNumber(e, n) {
	  return e - (n && e >= n ? 1 : 0);
	}

	function eraYearToYear(e, n) {
	  return (n + e) * (Math.sign(n) || 1) || 0;
	}

	function getCalendarEraOrigins(e) {
	  return Di[getCalendarIdBase(e)];
	}

	function getCalendarLeapMonthMeta(e) {
	  return Ii[getCalendarIdBase(e)];
	}

	function getCalendarIdBase(e) {
	  return computeCalendarIdBase(e.id || X);
	}

	function Qt(e, n, t, o) {
	  const r = refineCalendarFields(t, o, en, [], ri);
	  if (void 0 !== r.timeZone) {
	    const o = t.dateFromFields(r), i = refineTimeBag(r), a = e(r.timeZone);
	    return {
	      epochNanoseconds: getMatchingInstantFor(n(a), {
	        ...o,
	        ...i
	      }, void 0 !== r.offset ? parseOffsetNano(r.offset) : void 0),
	      timeZone: a
	    };
	  }
	  return {
	    ...t.dateFromFields(r),
	    ...Dt
	  };
	}

	function jn(e, n, t, o, r, i) {
	  const a = refineCalendarFields(t, r, en, ti, ri), s = e(a.timeZone), [c, u, l] = wn(i), f = t.dateFromFields(a, overrideOverflowOptions(i, c)), d = refineTimeBag(a, c);
	  return Yn(getMatchingInstantFor(n(s), {
	    ...f,
	    ...d
	  }, void 0 !== a.offset ? parseOffsetNano(a.offset) : void 0, u, l), s, o);
	}

	function Pt(e, n, t) {
	  const o = refineCalendarFields(e, n, en, [], w), r = H(t);
	  return ee(checkIsoDateTimeInBounds({
	    ...e.dateFromFields(o, overrideOverflowOptions(t, r)),
	    ...refineTimeBag(o, r)
	  }));
	}

	function Yt(e, n, t, o = []) {
	  const r = refineCalendarFields(e, n, en, o);
	  return e.dateFromFields(r, t);
	}

	function nt(e, n, t, o) {
	  const r = refineCalendarFields(e, n, fi, o);
	  return e.yearMonthFromFields(r, t);
	}

	function K(e, n, t, o, r = []) {
	  const i = refineCalendarFields(e, t, en, r);
	  return n && void 0 !== i.month && void 0 === i.monthCode && void 0 === i.year && (i.year = ji), 
	  e.monthDayFromFields(i, o);
	}

	function Ue(e, n) {
	  const t = H(n);
	  return Ge(refineTimeBag(refineFields(e, ei, [], 1), t));
	}

	function Ht(e) {
	  const n = refineFields(e, Ni);
	  return Vt(checkDurationUnits({
	    ...Si,
	    ...n
	  }));
	}

	function refineCalendarFields(e, n, t, o = [], r = []) {
	  return refineFields(n, [ ...e.fields(t), ...r ].sort(), o);
	}

	function refineFields(e, n, t, o = !t) {
	  const r = {};
	  let i, a = 0;
	  for (const o of n) {
	    if (o === i) {
	      throw new RangeError(duplicateFields(o));
	    }
	    if ("constructor" === o || "__proto__" === o) {
	      throw new RangeError(tn(o));
	    }
	    let n = e[o];
	    if (void 0 !== n) {
	      a = 1, Ga[o] && (n = Ga[o](n, o)), r[o] = n;
	    } else if (t) {
	      if (t.includes(o)) {
	        throw new TypeError(missingField(o));
	      }
	      r[o] = hi[o];
	    }
	    i = o;
	  }
	  if (o && !a) {
	    throw new TypeError(noValidFields(n));
	  }
	  return r;
	}

	function refineTimeBag(e, n) {
	  return constrainIsoTimeFields(Ha({
	    ...hi,
	    ...e
	  }), n);
	}

	function Sn(e, n, t, o, r, i) {
	  const a = U(i), {calendar: s, timeZone: c} = t;
	  return Yn(((e, n, t, o, r) => {
	    const i = mergeCalendarFields(e, t, o, en, oi, ni), [a, s, c] = wn(r, 2);
	    return getMatchingInstantFor(n, {
	      ...e.dateFromFields(i, overrideOverflowOptions(r, a)),
	      ...refineTimeBag(i, a)
	    }, parseOffsetNano(i.offset), s, c);
	  })(e(s), n(c), o, r, a), c, s);
	}

	function at(e, n, t, o, r) {
	  const i = U(r);
	  return ee(((e, n, t, o) => {
	    const r = mergeCalendarFields(e, n, t, en, w), i = H(o);
	    return checkIsoDateTimeInBounds({
	      ...e.dateFromFields(r, overrideOverflowOptions(o, i)),
	      ...refineTimeBag(r, i)
	    });
	  })(e(n.calendar), t, o, i));
	}

	function Zt(e, n, t, o, r) {
	  const i = U(r);
	  return ((e, n, t, o) => {
	    const r = mergeCalendarFields(e, n, t, en);
	    return e.dateFromFields(r, o);
	  })(e(n.calendar), t, o, i);
	}

	function Ke(e, n, t, o, r) {
	  const i = U(r);
	  return createPlainYearMonthSlots(((e, n, t, o) => {
	    const r = mergeCalendarFields(e, n, t, fi);
	    return e.yearMonthFromFields(r, o);
	  })(e(n.calendar), t, o, i));
	}

	function k(e, n, t, o, r) {
	  const i = U(r);
	  return ((e, n, t, o) => {
	    const r = mergeCalendarFields(e, n, t, en);
	    return e.monthDayFromFields(r, o);
	  })(e(n.calendar), t, o, i);
	}

	function Be(e, n, t) {
	  return Ge(((e, n, t) => {
	    const o = H(t);
	    return refineTimeBag({
	      ...Vn(ei, e),
	      ...refineFields(n, ei)
	    }, o);
	  })(e, n, t));
	}

	function kt(e, n) {
	  return Vt((t = e, o = n, checkDurationUnits({
	    ...t,
	    ...refineFields(o, Ni)
	  })));
	  var t, o;
	}

	function mergeCalendarFields(e, n, t, o, r = [], i = []) {
	  const a = [ ...e.fields(o), ...r ].sort();
	  let s = refineFields(n, a, i);
	  const c = refineFields(t, a);
	  return s = e.mergeFields(s, c), refineFields(s, a, []);
	}

	function convertToPlainMonthDay(e, n) {
	  const t = refineCalendarFields(e, n, pi);
	  return e.monthDayFromFields(t);
	}

	function convertToPlainYearMonth(e, n, t) {
	  const o = refineCalendarFields(e, n, di);
	  return e.yearMonthFromFields(o, t);
	}

	function convertToIso(e, n, t, o, r) {
	  n = Vn(t = e.fields(t), n), o = refineFields(o, r = e.fields(r), []);
	  let i = e.mergeFields(n, o);
	  return i = refineFields(i, [ ...t, ...r ].sort(), []), e.dateFromFields(i);
	}

	function refineYear(e, n) {
	  let {era: t, eraYear: o, year: r} = n;
	  const i = getCalendarEraOrigins(e);
	  if (void 0 !== t || void 0 !== o) {
	    if (void 0 === t || void 0 === o) {
	      throw new TypeError(Dr);
	    }
	    if (!i) {
	      throw new RangeError(gr);
	    }
	    const e = i[t];
	    if (void 0 === e) {
	      throw new RangeError(invalidEra(t));
	    }
	    const n = eraYearToYear(o, e);
	    if (void 0 !== r && r !== n) {
	      throw new RangeError(Ir);
	    }
	    r = n;
	  } else if (void 0 === r) {
	    throw new TypeError(missingYear(i));
	  }
	  return r;
	}

	function refineMonth(e, n, t, o) {
	  let {month: r, monthCode: i} = n;
	  if (void 0 !== i) {
	    const n = ((e, n, t, o) => {
	      const r = e.U(t), [i, a] = parseMonthCode(n);
	      let s = monthCodeNumberToMonth(i, a, r);
	      if (a) {
	        const n = getCalendarLeapMonthMeta(e);
	        if (void 0 === n) {
	          throw new RangeError(Pr);
	        }
	        if (n > 0) {
	          if (s > n) {
	            throw new RangeError(Pr);
	          }
	          if (void 0 === r) {
	            if (1 === o) {
	              throw new RangeError(Pr);
	            }
	            s--;
	          }
	        } else {
	          if (s !== -n) {
	            throw new RangeError(Pr);
	          }
	          if (void 0 === r && 1 === o) {
	            throw new RangeError(Pr);
	          }
	        }
	      }
	      return s;
	    })(e, i, t, o);
	    if (void 0 !== r && r !== n) {
	      throw new RangeError(Mr);
	    }
	    r = n, o = 1;
	  } else if (void 0 === r) {
	    throw new TypeError(Nr);
	  }
	  return clampEntity("month", r, 1, e.L(t), o);
	}

	function refineDay(e, n, t, o, r) {
	  return clampProp(n, "day", 1, e.j(o, t), r);
	}

	function spliceFields(e, n, t, o) {
	  let r = 0;
	  const i = [];
	  for (const e of t) {
	    void 0 !== n[e] ? r = 1 : i.push(e);
	  }
	  if (Object.assign(e, n), r) {
	    for (const n of o || i) {
	      delete e[n];
	    }
	  }
	}

	function Se(e) {
	  return _(checkEpochNanoInBounds(bigIntToBigNano(toBigInt(e))));
	}

	function vn(e, n, t, o, r = X) {
	  return Yn(checkEpochNanoInBounds(bigIntToBigNano(toBigInt(t))), n(o), e(r));
	}

	function pt(e, n, t, o, r = 0, i = 0, a = 0, s = 0, c = 0, u = 0, l = X) {
	  return ee(checkIsoDateTimeInBounds(checkIsoDateTimeFields(T(toInteger, zipProps(wi, [ n, t, o, r, i, a, s, c, u ])))), e(l));
	}

	function Nt(e, n, t, o, r = X) {
	  return v(checkIsoDateInBounds(checkIsoDateFields(T(toInteger, {
	    isoYear: n,
	    isoMonth: t,
	    isoDay: o
	  }))), e(r));
	}

	function tt(e, n, t, o = X, r = 1) {
	  const i = toInteger(n), a = toInteger(t), s = e(o);
	  return createPlainYearMonthSlots(checkIsoYearMonthInBounds(checkIsoDateFields({
	    isoYear: i,
	    isoMonth: a,
	    isoDay: toInteger(r)
	  })), s);
	}

	function G(e, n, t, o = X, r = ji) {
	  const i = toInteger(n), a = toInteger(t), s = e(o);
	  return createPlainMonthDaySlots(checkIsoDateInBounds(checkIsoDateFields({
	    isoYear: toInteger(r),
	    isoMonth: i,
	    isoDay: a
	  })), s);
	}

	function ke(e = 0, n = 0, t = 0, o = 0, r = 0, i = 0) {
	  return Ge(constrainIsoTimeFields(T(toInteger, zipProps(j, [ e, n, t, o, r, i ])), 1));
	}

	function Lt(e = 0, n = 0, t = 0, o = 0, r = 0, i = 0, a = 0, s = 0, c = 0, u = 0) {
	  return Vt(checkDurationUnits(T(toStrictInteger, zipProps(F, [ e, n, t, o, r, i, a, s, c, u ]))));
	}

	function fe(e, n, t = X) {
	  return Yn(e.epochNanoseconds, n, t);
	}

	function Zn(e) {
	  return _(e.epochNanoseconds);
	}

	function ht(e, n) {
	  return ee(fn(n, e));
	}

	function Bt(e, n) {
	  return v(fn(n, e));
	}

	function bn(e, n, t) {
	  return convertToPlainYearMonth(e(n.calendar), t);
	}

	function Fn(e, n, t) {
	  return convertToPlainMonthDay(e(n.calendar), t);
	}

	function Re(e, n) {
	  return Ge(fn(n, e));
	}

	function mt(e, n, t, o) {
	  const r = ((e, n, t, o) => {
	    const r = ve(o);
	    return we(e(n), t, r);
	  })(e, t, n, o);
	  return Yn(checkEpochNanoInBounds(r), t, n.calendar);
	}

	function St(e, n, t) {
	  const o = e(n.calendar);
	  return createPlainYearMonthSlots({
	    ...n,
	    ...convertToPlainYearMonth(o, t)
	  });
	}

	function Ot(e, n, t) {
	  return convertToPlainMonthDay(e(n.calendar), t);
	}

	function vt(e, n, t, o, r) {
	  const i = e(r.timeZone), a = r.plainTime, s = void 0 !== a ? n(a) : Dt;
	  return Yn(we(t(i), {
	    ...o,
	    ...s
	  }), i, o.calendar);
	}

	function wt(e, n = Dt) {
	  return ee(checkIsoDateTimeInBounds({
	    ...e,
	    ...n
	  }));
	}

	function jt(e, n, t) {
	  return convertToPlainYearMonth(e(n.calendar), t);
	}

	function Mt(e, n, t) {
	  return convertToPlainMonthDay(e(n.calendar), t);
	}

	function _e(e, n, t, o) {
	  return ((e, n, t) => convertToIso(e, n, di, de(t), li))(e(n.calendar), t, o);
	}

	function R(e, n, t, o) {
	  return ((e, n, t) => convertToIso(e, n, pi, de(t), si))(e(n.calendar), t, o);
	}

	function Je(e, n, t, o, r) {
	  const i = de(r), a = n(i.plainDate), s = e(i.timeZone);
	  return Yn(we(t(s), {
	    ...a,
	    ...o
	  }), s, a.calendar);
	}

	function Le(e, n) {
	  return ee(checkIsoDateTimeInBounds({
	    ...e,
	    ...n
	  }));
	}

	function De(e) {
	  return _(checkEpochNanoInBounds(he(e, _r)));
	}

	function Pe(e) {
	  return _(checkEpochNanoInBounds(he(e, be)));
	}

	function Ce(e) {
	  return _(checkEpochNanoInBounds(bigIntToBigNano(toBigInt(e), Vr)));
	}

	function ge(e) {
	  return _(checkEpochNanoInBounds(bigIntToBigNano(toBigInt(e))));
	}

	function pn(e, n, t = Dt) {
	  const o = n.timeZone, r = e(o), i = {
	    ...fn(n, r),
	    ...t
	  };
	  return Yn(getMatchingInstantFor(r, i, i.offsetNanoseconds, 2), o, n.calendar);
	}

	function Tn(e, n, t) {
	  const o = n.timeZone, r = e(o), i = {
	    ...fn(n, r),
	    ...t
	  }, a = getPreferredCalendarSlot(n.calendar, t.calendar);
	  return Yn(getMatchingInstantFor(r, i, i.offsetNanoseconds, 2), o, a);
	}

	function lt(e, n = Dt) {
	  return ee({
	    ...e,
	    ...n
	  });
	}

	function st(e, n) {
	  return ee({
	    ...e,
	    ...n
	  }, getPreferredCalendarSlot(e.calendar, n.calendar));
	}

	function it(e, n) {
	  return {
	    ...e,
	    calendar: n
	  };
	}

	function On(e, n) {
	  return {
	    ...e,
	    timeZone: n
	  };
	}

	function getPreferredCalendarSlot(e, n) {
	  if (e === n) {
	    return e;
	  }
	  const t = I(e), o = I(n);
	  if (t === o || t === X) {
	    return n;
	  }
	  if (o === X) {
	    return e;
	  }
	  throw new RangeError(Er);
	}

	function createNativeOpsCreator(e, n) {
	  return t => t === X ? e : t === gi || t === Ti ? Object.assign(Object.create(e), {
	    id: t
	  }) : Object.assign(Object.create(n), Aa(t));
	}

	function createOptionsTransformer(e, n, t) {
	  const o = new Set(t);
	  return r => (((e, n) => {
	    for (const t of n) {
	      if (t in e) {
	        return 1;
	      }
	    }
	    return 0;
	  })(r = V(o, r), e) || Object.assign(r, n), t && (r.timeZone = Ta, [ "full", "long" ].includes(r.timeStyle) && (r.timeStyle = "medium")), 
	  r);
	}

	function e(e, n = qn) {
	  const [t, , , o] = e;
	  return (r, i = Ns, ...a) => {
	    const s = n(o && o(...a), r, i, t), c = s.resolvedOptions();
	    return [ s, ...toEpochMillis(e, c, a) ];
	  };
	}

	function qn(e, n, t, o) {
	  if (t = o(t), e) {
	    if (void 0 !== t.timeZone) {
	      throw new TypeError(Lr);
	    }
	    t.timeZone = e;
	  }
	  return new En(n, t);
	}

	function toEpochMillis(e, n, t) {
	  const [, o, r] = e;
	  return t.map((e => (e.calendar && ((e, n, t) => {
	    if ((t || e !== X) && e !== n) {
	      throw new RangeError(Er);
	    }
	  })(I(e.calendar), n.calendar, r), o(e, n))));
	}

	function An(e) {
	  const n = Bn();
	  return Ie(n, e.getOffsetNanosecondsFor(n));
	}

	function Bn() {
	  return he(Date.now(), be);
	}

	function Nn() {
	  return ys || (ys = (new En).resolvedOptions().timeZone);
	}

	const expectedInteger = (e, n) => `Non-integer ${e}: ${n}`, expectedPositive = (e, n) => `Non-positive ${e}: ${n}`, expectedFinite = (e, n) => `Non-finite ${e}: ${n}`, forbiddenBigIntToNumber = e => `Cannot convert bigint to ${e}`, invalidBigInt = e => `Invalid bigint: ${e}`, pr = "Cannot convert Symbol to string", hr = "Invalid object", numberOutOfRange = (e, n, t, o, r) => r ? numberOutOfRange(e, r[n], r[t], r[o]) : invalidEntity(e, n) + `; must be between ${t}-${o}`, invalidEntity = (e, n) => `Invalid ${e}: ${n}`, missingField = e => `Missing ${e}`, tn = e => `Invalid field ${e}`, duplicateFields = e => `Duplicate field ${e}`, noValidFields = e => "No valid fields: " + e.join(), Z = "Invalid bag", invalidChoice = (e, n, t) => invalidEntity(e, n) + "; must be " + Object.keys(t).join(), A = "Cannot use valueOf", P = "Invalid calling context", gr = "Forbidden era/eraYear", Dr = "Mismatching era/eraYear", Ir = "Mismatching year/eraYear", invalidEra = e => `Invalid era: ${e}`, missingYear = e => "Missing year" + (e ? "/era/eraYear" : ""), invalidMonthCode = e => `Invalid monthCode: ${e}`, Mr = "Mismatching month/monthCode", Nr = "Missing month/monthCode", yr = "Cannot guess year", Pr = "Invalid leap month", g = "Invalid protocol", vr = "Invalid protocol results", Er = "Mismatching Calendars", invalidCalendar = e => `Invalid Calendar: ${e}`, Fr = "Mismatching TimeZones", br = "Forbidden ICU TimeZone", wr = "Out-of-bounds offset", Br = "Out-of-bounds TimeZone gap", kr = "Invalid TimeZone offset", Yr = "Ambiguous offset", Cr = "Out-of-bounds date", Zr = "Out-of-bounds duration", Rr = "Cannot mix duration signs", zr = "Missing relativeTo", qr = "Cannot use large units", Ur = "Required smallestUnit or largestUnit", Ar = "smallestUnit > largestUnit", failedParse = e => `Cannot parse: ${e}`, invalidSubstring = e => `Invalid substring: ${e}`, Ln = e => `Cannot format ${e}`, kn = "Mismatching types for formatting", Lr = "Cannot specify TimeZone", Wr = /*@__PURE__*/ E(b, ((e, n) => n)), jr = /*@__PURE__*/ E(b, ((e, n, t) => t)), xr = /*@__PURE__*/ E(padNumber, 2), $r = {
	  nanosecond: 0,
	  microsecond: 1,
	  millisecond: 2,
	  second: 3,
	  minute: 4,
	  hour: 5,
	  day: 6,
	  week: 7,
	  month: 8,
	  year: 9
	}, Et = /*@__PURE__*/ Object.keys($r), Gr = 864e5, Hr = 1e3, Vr = 1e3, be = 1e6, _r = 1e9, Jr = 6e10, Kr = 36e11, Qr = 864e11, Xr = [ 1, Vr, be, _r, Jr, Kr, Qr ], w = /*@__PURE__*/ Et.slice(0, 6), ei = /*@__PURE__*/ sortStrings(w), ni = [ "offset" ], ti = [ "timeZone" ], oi = /*@__PURE__*/ w.concat(ni), ri = /*@__PURE__*/ oi.concat(ti), ii = [ "era", "eraYear" ], ai = /*@__PURE__*/ ii.concat([ "year" ]), si = [ "year" ], ci = [ "monthCode" ], ui = /*@__PURE__*/ [ "month" ].concat(ci), li = [ "day" ], fi = /*@__PURE__*/ ui.concat(si), di = /*@__PURE__*/ ci.concat(si), en = /*@__PURE__*/ li.concat(fi), mi = /*@__PURE__*/ li.concat(ui), pi = /*@__PURE__*/ li.concat(ci), hi = /*@__PURE__*/ jr(w, 0), X = "iso8601", gi = "gregory", Ti = "japanese", Di = {
	  [gi]: {
	    bce: -1,
	    ce: 0
	  },
	  [Ti]: {
	    bce: -1,
	    ce: 0,
	    meiji: 1867,
	    taisho: 1911,
	    showa: 1925,
	    heisei: 1988,
	    reiwa: 2018
	  },
	  ethioaa: {
	    era0: 0
	  },
	  ethiopic: {
	    era0: 0,
	    era1: 5500
	  },
	  coptic: {
	    era0: -1,
	    era1: 0
	  },
	  roc: {
	    beforeroc: -1,
	    minguo: 0
	  },
	  buddhist: {
	    be: 0
	  },
	  islamic: {
	    ah: 0
	  },
	  indian: {
	    saka: 0
	  },
	  persian: {
	    ap: 0
	  }
	}, Ii = {
	  chinese: 13,
	  dangi: 13,
	  hebrew: -6
	}, m = /*@__PURE__*/ E(requireType, "string"), f = /*@__PURE__*/ E(requireType, "boolean"), Mi = /*@__PURE__*/ E(requireType, "number"), $ = /*@__PURE__*/ E(requireType, "function"), F = /*@__PURE__*/ Et.map((e => e + "s")), Ni = /*@__PURE__*/ sortStrings(F), yi = /*@__PURE__*/ F.slice(0, 6), Pi = /*@__PURE__*/ F.slice(6), vi = /*@__PURE__*/ Pi.slice(1), Ei = /*@__PURE__*/ Wr(F), Si = /*@__PURE__*/ jr(F, 0), Fi = /*@__PURE__*/ jr(yi, 0), bi = /*@__PURE__*/ E(zeroOutProps, F), j = [ "isoNanosecond", "isoMicrosecond", "isoMillisecond", "isoSecond", "isoMinute", "isoHour" ], Oi = [ "isoDay", "isoMonth", "isoYear" ], wi = /*@__PURE__*/ j.concat(Oi), Bi = /*@__PURE__*/ sortStrings(Oi), ki = /*@__PURE__*/ sortStrings(j), Yi = /*@__PURE__*/ sortStrings(wi), Dt = /*@__PURE__*/ jr(ki, 0), Ci = /*@__PURE__*/ E(zeroOutProps, wi), En = Intl.DateTimeFormat, Zi = "en-GB", Ri = 1e8, zi = Ri * Gr, qi = [ Ri, 0 ], Ui = [ -1e8, 0 ], Ai = 275760, Li = -271821, Wi = 1970, ji = 1972, xi = 12, $i = /*@__PURE__*/ isoArgsToEpochMilli(1868, 9, 8), Gi = /*@__PURE__*/ Jn(computeJapaneseEraParts, WeakMap), Hi = "smallestUnit", Vi = "unit", _i = "roundingIncrement", Ji = "fractionalSecondDigits", Ki = "relativeTo", Qi = {
	  constrain: 0,
	  reject: 1
	}, Xi = /*@__PURE__*/ Object.keys(Qi), ea = {
	  compatible: 0,
	  reject: 1,
	  earlier: 2,
	  later: 3
	}, na = {
	  reject: 0,
	  use: 1,
	  prefer: 2,
	  ignore: 3
	}, ta = {
	  auto: 0,
	  never: 1,
	  critical: 2,
	  always: 3
	}, oa = {
	  auto: 0,
	  never: 1,
	  critical: 2
	}, ra = {
	  auto: 0,
	  never: 1
	}, ia = {
	  floor: 0,
	  halfFloor: 1,
	  ceil: 2,
	  halfCeil: 3,
	  trunc: 4,
	  halfTrunc: 5,
	  expand: 6,
	  halfExpand: 7,
	  halfEven: 8
	}, aa = /*@__PURE__*/ E(refineUnitOption, Hi), sa = /*@__PURE__*/ E(refineUnitOption, "largestUnit"), ca = /*@__PURE__*/ E(refineUnitOption, Vi), ua = /*@__PURE__*/ E(refineChoiceOption, "overflow", Qi), la = /*@__PURE__*/ E(refineChoiceOption, "disambiguation", ea), fa = /*@__PURE__*/ E(refineChoiceOption, "offset", na), da = /*@__PURE__*/ E(refineChoiceOption, "calendarName", ta), ma = /*@__PURE__*/ E(refineChoiceOption, "timeZoneName", oa), pa = /*@__PURE__*/ E(refineChoiceOption, "offset", ra), ha = /*@__PURE__*/ E(refineChoiceOption, "roundingMode", ia), L = "PlainYearMonth", q = "PlainMonthDay", J = "PlainDate", We = "PlainDateTime", xe = "PlainTime", Te = "ZonedDateTime", Oe = "Instant", qt = "Duration", ga = [ Math.floor, e => hasHalf(e) ? Math.floor(e) : Math.round(e), Math.ceil, e => hasHalf(e) ? Math.ceil(e) : Math.round(e), Math.trunc, e => hasHalf(e) ? Math.trunc(e) || 0 : Math.round(e), e => e < 0 ? Math.floor(e) : Math.ceil(e), e => Math.sign(e) * Math.round(Math.abs(e)) || 0, e => hasHalf(e) ? (e = Math.trunc(e) || 0) + e % 2 : Math.round(e) ], Ta = "UTC", Da = 5184e3, Ia = /*@__PURE__*/ isoArgsToEpochSec(1847), Ma = /*@__PURE__*/ isoArgsToEpochSec(/*@__PURE__*/ (/*@__PURE__*/ new Date).getUTCFullYear() + 10), Na = /0+$/, fn = /*@__PURE__*/ Jn(_zonedEpochSlotsToIso, WeakMap), ya = 2 ** 32 - 1, ie = /*@__PURE__*/ Jn((e => {
	  const n = getTimeZoneEssence(e);
	  return "object" == typeof n ? new IntlTimeZone(n) : new FixedTimeZone(n || 0);
	}));

	class FixedTimeZone {
	  constructor(e) {
	    this.v = e;
	  }
	  getOffsetNanosecondsFor() {
	    return this.v;
	  }
	  getPossibleInstantsFor(e) {
	    return [ isoToEpochNanoWithOffset(e, this.v) ];
	  }
	  l() {}
	}

	class IntlTimeZone {
	  constructor(e) {
	    this.$ = (e => {
	      function getOffsetSec(e) {
	        const i = clampNumber(e, o, r), [a, s] = computePeriod(i), c = n(a), u = n(s);
	        return c === u ? c : pinch(t(a, s), c, u, e);
	      }
	      function pinch(n, t, o, r) {
	        let i, a;
	        for (;(void 0 === r || void 0 === (i = r < n[0] ? t : r >= n[1] ? o : void 0)) && (a = n[1] - n[0]); ) {
	          const t = n[0] + Math.floor(a / 2);
	          e(t) === o ? n[1] = t : n[0] = t + 1;
	        }
	        return i;
	      }
	      const n = Jn(e), t = Jn(createSplitTuple);
	      let o = Ia, r = Ma;
	      return {
	        G(e) {
	          const n = getOffsetSec(e - 86400), t = getOffsetSec(e + 86400), o = e - n, r = e - t;
	          if (n === t) {
	            return [ o ];
	          }
	          const i = getOffsetSec(o);
	          return i === getOffsetSec(r) ? [ e - i ] : n > t ? [ o, r ] : [];
	        },
	        V: getOffsetSec,
	        l(e, i) {
	          const a = clampNumber(e, o, r);
	          let [s, c] = computePeriod(a);
	          const u = Da * i, l = i < 0 ? () => c > o || (o = a, 0) : () => s < r || (r = a, 
	          0);
	          for (;l(); ) {
	            const o = n(s), r = n(c);
	            if (o !== r) {
	              const n = t(s, c);
	              pinch(n, o, r);
	              const a = n[0];
	              if ((compareNumbers(a, e) || 1) === i) {
	                return a;
	              }
	            }
	            s += u, c += u;
	          }
	        }
	      };
	    })((e => n => {
	      const t = hashIntlFormatParts(e, n * Hr);
	      return isoArgsToEpochSec(parseIntlPartsYear(t), parseInt(t.month), parseInt(t.day), parseInt(t.hour), parseInt(t.minute), parseInt(t.second)) - n;
	    })(e));
	  }
	  getOffsetNanosecondsFor(e) {
	    return this.$.V(epochNanoToSec(e)) * _r;
	  }
	  getPossibleInstantsFor(e) {
	    const [n, t] = [ isoArgsToEpochSec((o = e).isoYear, o.isoMonth, o.isoDay, o.isoHour, o.isoMinute, o.isoSecond), o.isoMillisecond * be + o.isoMicrosecond * Vr + o.isoNanosecond ];
	    var o;
	    return this.$.G(n).map((e => checkEpochNanoInBounds(moveBigNano(he(e, _r), t))));
	  }
	  l(e, n) {
	    const [t, o] = epochNanoToSecMod(e), r = this.$.l(t + (n > 0 || o ? 1 : 0), n);
	    if (void 0 !== r) {
	      return he(r, _r);
	    }
	  }
	}

	const Pa = "([+−-])", va = "(?:[.,](\\d{1,9}))?", Ea = `(?:(?:${Pa}(\\d{6}))|(\\d{4}))-?(\\d{2})`, Sa = "(\\d{2})(?::?(\\d{2})(?::?(\\d{2})" + va + ")?)?", Fa = Pa + Sa, ba = Ea + "-?(\\d{2})(?:[T ]" + Sa + "(Z|" + Fa + ")?)?", Oa = "\\[(!?)([^\\]]*)\\]", wa = `((?:${Oa}){0,9})`, Ba = /*@__PURE__*/ createRegExp(Ea + wa), ka = /*@__PURE__*/ createRegExp("(?:--)?(\\d{2})-?(\\d{2})" + wa), Ya = /*@__PURE__*/ createRegExp(ba + wa), Ca = /*@__PURE__*/ createRegExp("T?" + Sa + "(?:" + Fa + ")?" + wa), Za = /*@__PURE__*/ createRegExp(Fa), Ra = /*@__PURE__*/ new RegExp(Oa, "g"), za = /*@__PURE__*/ createRegExp(`${Pa}?P(\\d+Y)?(\\d+M)?(\\d+W)?(\\d+D)?(?:T(?:(\\d+)${va}H)?(?:(\\d+)${va}M)?(?:(\\d+)${va}S)?)?`), qa = /*@__PURE__*/ Jn((e => new En(Zi, {
	  timeZone: e,
	  era: "short",
	  year: "numeric",
	  month: "numeric",
	  day: "numeric",
	  hour: "numeric",
	  minute: "numeric",
	  second: "numeric"
	}))), Ua = /^(AC|AE|AG|AR|AS|BE|BS|CA|CN|CS|CT|EA|EC|IE|IS|JS|MI|NE|NS|PL|PN|PR|PS|SS|VS)T$/, Aa = /*@__PURE__*/ Jn(createIntlCalendar), La = /*@__PURE__*/ Jn((e => new En(Zi, {
	  calendar: e,
	  timeZone: Ta,
	  era: "short",
	  year: "numeric",
	  month: "short",
	  day: "numeric"
	}))), Wa = /^M(\d{2})(L?)$/, ja = {
	  era: toStringViaPrimitive,
	  eraYear: toInteger,
	  year: toInteger,
	  month: toPositiveInteger,
	  monthCode: toStringViaPrimitive,
	  day: toPositiveInteger
	}, xa = /*@__PURE__*/ jr(w, toInteger), $a = /*@__PURE__*/ jr(F, toStrictInteger), Ga = /*@__PURE__*/ Object.assign({}, ja, xa, $a, {
	  offset: toStringViaPrimitive
	}), Ha = /*@__PURE__*/ E(remapProps, w, j), Va = {
	  dateAdd(e, n, t) {
	    const o = H(t);
	    let r, {years: i, months: a, weeks: s, days: c} = n;
	    if (c += durationFieldsToBigNano(n, 5)[0], i || a) {
	      r = ((e, n, t, o, r) => {
	        let [i, a, s] = e.h(n);
	        if (t) {
	          const [n, o] = e.I(i, a);
	          i += t, a = monthCodeNumberToMonth(n, o, e.U(i)), a = clampEntity("month", a, 1, e.L(i), r);
	        }
	        return o && ([i, a] = e._(i, a, o)), s = clampEntity("day", s, 1, e.j(i, a), r), 
	        e.q(i, a, s);
	      })(this, e, i, a, o);
	    } else {
	      if (!s && !c) {
	        return e;
	      }
	      r = isoToEpochMilli(e);
	    }
	    return r += (7 * s + c) * Gr, checkIsoDateInBounds(epochMilliToIso(r));
	  },
	  dateUntil(e, n, t) {
	    if (t <= 7) {
	      let o = 0, r = diffDays({
	        ...e,
	        ...Dt
	      }, {
	        ...n,
	        ...Dt
	      });
	      return 7 === t && ([o, r] = divModTrunc(r, 7)), {
	        ...Si,
	        weeks: o,
	        days: r
	      };
	    }
	    const o = this.h(e), r = this.h(n);
	    let [i, a, s] = ((e, n, t, o, r, i, a) => {
	      let s = r - n, c = i - t, u = a - o;
	      if (s || c) {
	        const l = Math.sign(s || c);
	        let f = e.j(r, i), d = 0;
	        if (Math.sign(u) === -l) {
	          const o = f;
	          [r, i] = e._(r, i, -l), s = r - n, c = i - t, f = e.j(r, i), d = l < 0 ? -o : f;
	        }
	        if (u = a - Math.min(o, f) + d, s) {
	          const [o, a] = e.I(n, t), [u, f] = e.I(r, i);
	          if (c = u - o || Number(f) - Number(a), Math.sign(c) === -l) {
	            const t = l < 0 && -e.L(r);
	            s = (r -= l) - n, c = i - monthCodeNumberToMonth(o, a, e.U(r)) + (t || e.L(r));
	          }
	        }
	      }
	      return [ s, c, u ];
	    })(this, ...o, ...r);
	    return 8 === t && (a += this.J(i, o[0]), i = 0), {
	      ...Si,
	      years: i,
	      months: a,
	      days: s
	    };
	  },
	  dateFromFields(e, n) {
	    const t = H(n), o = refineYear(this, e), r = refineMonth(this, e, o, t), i = refineDay(this, e, r, o, t);
	    return v(checkIsoDateInBounds(this.P(o, r, i)), this.id || X);
	  },
	  yearMonthFromFields(e, n) {
	    const t = H(n), o = refineYear(this, e), r = refineMonth(this, e, o, t);
	    return createPlainYearMonthSlots(checkIsoYearMonthInBounds(this.P(o, r, 1)), this.id || X);
	  },
	  monthDayFromFields(e, n) {
	    const t = H(n), o = !this.id, {monthCode: r, year: i, month: a} = e;
	    let s, c, u, l, f;
	    if (void 0 !== r) {
	      [s, c] = parseMonthCode(r), f = getDefinedProp(e, "day");
	      const n = this.N(s, c, f);
	      if (!n) {
	        throw new RangeError(yr);
	      }
	      if ([u, l] = n, void 0 !== a && a !== l) {
	        throw new RangeError(Mr);
	      }
	      o && (l = clampEntity("month", l, 1, xi, 1), f = clampEntity("day", f, 1, computeIsoDaysInMonth(void 0 !== i ? i : u, l), t));
	    } else {
	      u = void 0 === i && o ? ji : refineYear(this, e), l = refineMonth(this, e, u, t), 
	      f = refineDay(this, e, l, u, t);
	      const n = this.U(u);
	      c = l === n, s = monthToMonthCodeNumber(l, n);
	      const r = this.N(s, c, f);
	      if (!r) {
	        throw new RangeError(yr);
	      }
	      [u, l] = r;
	    }
	    return createPlainMonthDaySlots(checkIsoDateInBounds(this.P(u, l, f)), this.id || X);
	  },
	  fields(e) {
	    return getCalendarEraOrigins(this) && e.includes("year") ? [ ...e, ...ii ] : e;
	  },
	  mergeFields(e, n) {
	    const t = Object.assign(Object.create(null), e);
	    return spliceFields(t, n, ui), getCalendarEraOrigins(this) && (spliceFields(t, n, ai), 
	    this.id === Ti && spliceFields(t, n, mi, ii)), t;
	  },
	  inLeapYear(e) {
	    const [n] = this.h(e);
	    return this.K(n);
	  },
	  monthsInYear(e) {
	    const [n] = this.h(e);
	    return this.L(n);
	  },
	  daysInMonth(e) {
	    const [n, t] = this.h(e);
	    return this.j(n, t);
	  },
	  daysInYear(e) {
	    const [n] = this.h(e);
	    return this.X(n);
	  },
	  dayOfYear: computeNativeDayOfYear,
	  era(e) {
	    return this.ee(e)[0];
	  },
	  eraYear(e) {
	    return this.ee(e)[1];
	  },
	  monthCode(e) {
	    const [n, t] = this.h(e), [o, r] = this.I(n, t);
	    return ((e, n) => "M" + xr(e) + (n ? "L" : ""))(o, r);
	  },
	  dayOfWeek: computeIsoDayOfWeek,
	  daysInWeek() {
	    return 7;
	  }
	}, _a = {
	  dayOfYear: computeNativeDayOfYear,
	  h: computeIsoDateParts,
	  q: isoArgsToEpochMilli
	}, Ja = /*@__PURE__*/ Object.assign({}, _a, {
	  weekOfYear: computeNativeWeekOfYear,
	  yearOfWeek: computeNativeYearOfWeek,
	  R(e) {
	    function computeWeekShift(e) {
	      return (7 - e < n ? 7 : 0) - e;
	    }
	    function computeWeeksInYear(e) {
	      const n = computeIsoDaysInYear(l + e), t = e || 1, o = computeWeekShift(modFloor(a + n * t, 7));
	      return c = (n + (o - s) * t) / 7;
	    }
	    const n = this.id ? 1 : 4, t = computeIsoDayOfWeek(e), o = this.dayOfYear(e), r = modFloor(t - 1, 7), i = o - 1, a = modFloor(r - i, 7), s = computeWeekShift(a);
	    let c, u = Math.floor((i - s) / 7) + 1, l = e.isoYear;
	    return u ? u > computeWeeksInYear(0) && (u = 1, l++) : (u = computeWeeksInYear(-1), 
	    l--), [ u, l, c ];
	  }
	}), Ka = {
	  dayOfYear: computeNativeDayOfYear,
	  h: computeIntlDateParts,
	  q: computeIntlEpochMilli,
	  weekOfYear: computeNativeWeekOfYear,
	  yearOfWeek: computeNativeYearOfWeek,
	  R() {
	    return [];
	  }
	}, Y = /*@__PURE__*/ createNativeOpsCreator(/*@__PURE__*/ Object.assign({}, Va, Ja, {
	  h: computeIsoDateParts,
	  ee(e) {
	    return this.id === gi ? computeGregoryEraParts(e) : this.id === Ti ? Gi(e) : [];
	  },
	  I: (e, n) => [ n, 0 ],
	  N(e, n) {
	    if (!n) {
	      return [ ji, e ];
	    }
	  },
	  K: computeIsoInLeapYear,
	  U() {},
	  L: computeIsoMonthsInYear,
	  J: e => e * xi,
	  j: computeIsoDaysInMonth,
	  X: computeIsoDaysInYear,
	  P: (e, n, t) => ({
	    isoYear: e,
	    isoMonth: n,
	    isoDay: t
	  }),
	  q: isoArgsToEpochMilli,
	  _: (e, n, t) => (e += divTrunc(t, xi), (n += modTrunc(t, xi)) < 1 ? (e--, n += xi) : n > xi && (e++, 
	  n -= xi), [ e, n ]),
	  year(e) {
	    return e.isoYear;
	  },
	  month(e) {
	    return e.isoMonth;
	  },
	  day: e => e.isoDay
	}), /*@__PURE__*/ Object.assign({}, Va, Ka, {
	  h: computeIntlDateParts,
	  ee(e) {
	    const n = this.O(e);
	    return [ n.era, n.eraYear ];
	  },
	  I(e, n) {
	    const t = computeIntlLeapMonth.call(this, e);
	    return [ monthToMonthCodeNumber(n, t), t === n ];
	  },
	  N(e, n, t) {
	    let [o, r, i] = computeIntlDateParts.call(this, {
	      isoYear: ji,
	      isoMonth: xi,
	      isoDay: 31
	    });
	    const a = computeIntlLeapMonth.call(this, o), s = r === a;
	    1 === (compareNumbers(e, monthToMonthCodeNumber(r, a)) || compareNumbers(Number(n), Number(s)) || compareNumbers(t, i)) && o--;
	    for (let r = 0; r < 100; r++) {
	      const i = o - r, a = computeIntlLeapMonth.call(this, i), s = monthCodeNumberToMonth(e, n, a);
	      if (n === (s === a) && t <= computeIntlDaysInMonth.call(this, i, s)) {
	        return [ i, s ];
	      }
	    }
	  },
	  K(e) {
	    const n = computeIntlDaysInYear.call(this, e);
	    return n > computeIntlDaysInYear.call(this, e - 1) && n > computeIntlDaysInYear.call(this, e + 1);
	  },
	  U: computeIntlLeapMonth,
	  L: computeIntlMonthsInYear,
	  J(e, n) {
	    const t = n + e, o = Math.sign(e), r = o < 0 ? -1 : 0;
	    let i = 0;
	    for (let e = n; e !== t; e += o) {
	      i += computeIntlMonthsInYear.call(this, e + r);
	    }
	    return i;
	  },
	  j: computeIntlDaysInMonth,
	  X: computeIntlDaysInYear,
	  P(e, n, t) {
	    return epochMilliToIso(computeIntlEpochMilli.call(this, e, n, t));
	  },
	  q: computeIntlEpochMilli,
	  _(e, n, t) {
	    if (t) {
	      if (n += t, !Number.isSafeInteger(n)) {
	        throw new RangeError(Cr);
	      }
	      if (t < 0) {
	        for (;n < 1; ) {
	          n += computeIntlMonthsInYear.call(this, --e);
	        }
	      } else {
	        let t;
	        for (;n > (t = computeIntlMonthsInYear.call(this, e)); ) {
	          n -= t, e++;
	        }
	      }
	    }
	    return [ e, n ];
	  },
	  year(e) {
	    return this.O(e).year;
	  },
	  month(e) {
	    const {year: n, F: t} = this.O(e), {C: o} = this.B(n);
	    return o[t] + 1;
	  },
	  day(e) {
	    return this.O(e).day;
	  }
	})), Qa = "numeric", Xa = [ "timeZoneName" ], es = {
	  month: Qa,
	  day: Qa
	}, ns = {
	  year: Qa,
	  month: Qa
	}, ts = /*@__PURE__*/ Object.assign({}, ns, {
	  day: Qa
	}), os = {
	  hour: Qa,
	  minute: Qa,
	  second: Qa
	}, rs = /*@__PURE__*/ Object.assign({}, ts, os), is = /*@__PURE__*/ Object.assign({}, rs, {
	  timeZoneName: "short"
	}), as = /*@__PURE__*/ Object.keys(ns), ss = /*@__PURE__*/ Object.keys(es), cs = /*@__PURE__*/ Object.keys(ts), us = /*@__PURE__*/ Object.keys(os), ls = [ "dateStyle" ], fs = /*@__PURE__*/ as.concat(ls), ds = /*@__PURE__*/ ss.concat(ls), ms = /*@__PURE__*/ cs.concat(ls, [ "weekday" ]), ps = /*@__PURE__*/ us.concat([ "dayPeriod", "timeStyle" ]), hs = /*@__PURE__*/ ms.concat(ps), gs = /*@__PURE__*/ hs.concat(Xa), Ts = /*@__PURE__*/ Xa.concat(ps), Ds = /*@__PURE__*/ Xa.concat(ms), Is = /*@__PURE__*/ Xa.concat([ "day", "weekday" ], ps), Ms = /*@__PURE__*/ Xa.concat([ "year", "weekday" ], ps), Ns = {}, t = [ /*@__PURE__*/ createOptionsTransformer(hs, rs), y ], s = [ /*@__PURE__*/ createOptionsTransformer(gs, is), y, 0, (e, n) => {
	  const t = I(e.timeZone);
	  if (n && I(n.timeZone) !== t) {
	    throw new RangeError(Fr);
	  }
	  return t;
	} ], n = [ /*@__PURE__*/ createOptionsTransformer(hs, rs, Xa), isoToEpochMilli ], o = [ /*@__PURE__*/ createOptionsTransformer(ms, ts, Ts), isoToEpochMilli ], r = [ /*@__PURE__*/ createOptionsTransformer(ps, os, Ds), e => isoTimeFieldsToNano(e) / be ], a = [ /*@__PURE__*/ createOptionsTransformer(fs, ns, Is), isoToEpochMilli, 1 ], i = [ /*@__PURE__*/ createOptionsTransformer(ds, es, Ms), isoToEpochMilli, 1 ];

	let ys;

	function createSlotClass(e, t, n, o, r) {
	  function Class(...e) {
	    if (!(this instanceof Class)) {
	      throw new TypeError(P);
	    }
	    oo(this, t(...e));
	  }
	  function bindMethod(e, t) {
	    return Object.defineProperties((function(...t) {
	      return e.call(this, getSpecificSlots(this), ...t);
	    }), D(t));
	  }
	  function getSpecificSlots(t) {
	    const n = no(t);
	    if (!n || n.branding !== e) {
	      throw new TypeError(P);
	    }
	    return n;
	  }
	  return Object.defineProperties(Class.prototype, {
	    ...O(T(bindMethod, n)),
	    ...p(T(bindMethod, o)),
	    ...h("Temporal." + e)
	  }), Object.defineProperties(Class, {
	    ...p(r),
	    ...D(e)
	  }), [ Class, e => {
	    const t = Object.create(Class.prototype);
	    return oo(t, e), t;
	  }, getSpecificSlots ];
	}

	function createProtocolValidator(e) {
	  return e = e.concat("id").sort(), t => {
	    if (!C(t, e)) {
	      throw new TypeError(g);
	    }
	    return t;
	  };
	}

	function rejectInvalidBag(e) {
	  if (no(e) || void 0 !== e.calendar || void 0 !== e.timeZone) {
	    throw new TypeError(Z);
	  }
	  return e;
	}

	function createCalendarFieldMethods(e, t) {
	  const n = {};
	  for (const o in e) {
	    n[o] = ({o: e}, n) => {
	      const r = no(n) || {}, {branding: a} = r, i = a === J || t.includes(a) ? r : toPlainDateSlots(n);
	      return e[o](i);
	    };
	  }
	  return n;
	}

	function createCalendarGetters(e) {
	  const t = {};
	  for (const n in e) {
	    t[n] = e => {
	      const {calendar: t} = e;
	      return (o = t, "string" == typeof o ? Y(o) : (r = o, Object.assign(Object.create(co), {
	        i: r
	      })))[n](e);
	      var o, r;
	    };
	  }
	  return t;
	}

	function neverValueOf() {
	  throw new TypeError(A);
	}

	function createCalendarFromSlots({calendar: e}) {
	  return "string" == typeof e ? new lr(e) : e;
	}

	function toPlainMonthDaySlots(e, t) {
	  if (t = U(t), z(e)) {
	    const n = no(e);
	    if (n && n.branding === q) {
	      return H(t), n;
	    }
	    const o = extractCalendarSlotFromBag(e);
	    return K(Qo(o || X), !o, e, t);
	  }
	  const n = Q(Y, e);
	  return H(t), n;
	}

	function getOffsetNanosecondsForAdapter(e, t, n) {
	  return o = t.call(e, Co(_(n))), ae(u(o));
	  var o;
	}

	function createAdapterOps(e, t = ho) {
	  const n = Object.keys(t).sort(), o = {};
	  for (const r of n) {
	    o[r] = E(t[r], e, $(e[r]));
	  }
	  return o;
	}

	function createTimeZoneOps(e, t) {
	  return "string" == typeof e ? ie(e) : createAdapterOps(e, t);
	}

	function createTimeZoneOffsetOps(e) {
	  return createTimeZoneOps(e, Do);
	}

	function toInstantSlots(e) {
	  if (z(e)) {
	    const t = no(e);
	    if (t) {
	      switch (t.branding) {
	       case Oe:
	        return t;

	       case Te:
	        return _(t.epochNanoseconds);
	      }
	    }
	  }
	  return pe(e);
	}

	function getImplTransition(e, t, n) {
	  const o = t.l(toInstantSlots(n).epochNanoseconds, e);
	  return o ? Co(_(o)) : null;
	}

	function refineTimeZoneSlot(e) {
	  return z(e) ? (no(e) || {}).timeZone || Fo(e) : (e => ye(Ne(m(e))))(e);
	}

	function toPlainTimeSlots(e, t) {
	  if (z(e)) {
	    const n = no(e) || {};
	    switch (n.branding) {
	     case xe:
	      return H(t), n;

	     case We:
	      return H(t), Ge(n);

	     case Te:
	      return H(t), Re(createTimeZoneOffsetOps, n);
	    }
	    return Ue(e, t);
	  }
	  return H(t), ze(e);
	}

	function optionalToPlainTimeFields(e) {
	  return void 0 === e ? void 0 : toPlainTimeSlots(e);
	}

	function toPlainYearMonthSlots(e, t) {
	  if (t = U(t), z(e)) {
	    const n = no(e);
	    return n && n.branding === L ? (H(t), n) : nt(Ho(getCalendarSlotFromBag(e)), e, t);
	  }
	  const n = ot(Y, e);
	  return H(t), n;
	}

	function toPlainDateTimeSlots(e, t) {
	  if (t = U(t), z(e)) {
	    const n = no(e) || {};
	    switch (n.branding) {
	     case We:
	      return H(t), n;

	     case J:
	      return H(t), ee({
	        ...n,
	        ...Dt
	      });

	     case Te:
	      return H(t), ht(createTimeZoneOffsetOps, n);
	    }
	    return Pt(Ko(getCalendarSlotFromBag(e)), e, t);
	  }
	  const n = Ct(e);
	  return H(t), n;
	}

	function toPlainDateSlots(e, t) {
	  if (t = U(t), z(e)) {
	    const n = no(e) || {};
	    switch (n.branding) {
	     case J:
	      return H(t), n;

	     case We:
	      return H(t), v(n);

	     case Te:
	      return H(t), Bt(createTimeZoneOffsetOps, n);
	    }
	    return Yt(Ko(getCalendarSlotFromBag(e)), e, t);
	  }
	  const n = At(e);
	  return H(t), n;
	}

	function dayAdapter(e, t, n) {
	  return d(t.call(e, Yo(v(n, e))));
	}

	function createCompoundOpsCreator(e) {
	  return t => "string" == typeof t ? Y(t) : ((e, t) => {
	    const n = Object.keys(t).sort(), o = {};
	    for (const r of n) {
	      o[r] = E(t[r], e, e[r]);
	    }
	    return o;
	  })(t, e);
	}

	function toDurationSlots(e) {
	  if (z(e)) {
	    const t = no(e);
	    return t && t.branding === qt ? t : Ht(e);
	  }
	  return Kt(e);
	}

	function refinePublicRelativeTo(e) {
	  if (void 0 !== e) {
	    if (z(e)) {
	      const t = no(e) || {};
	      switch (t.branding) {
	       case Te:
	       case J:
	        return t;

	       case We:
	        return v(t);
	      }
	      const n = getCalendarSlotFromBag(e);
	      return {
	        ...Qt(refineTimeZoneSlot, createTimeZoneOps, Ko(n), e),
	        calendar: n
	      };
	    }
	    return Xt(e);
	  }
	}

	function getCalendarSlotFromBag(e) {
	  return extractCalendarSlotFromBag(e) || X;
	}

	function extractCalendarSlotFromBag(e) {
	  const {calendar: t} = e;
	  if (void 0 !== t) {
	    return refineCalendarSlot(t);
	  }
	}

	function refineCalendarSlot(e) {
	  return z(e) ? (no(e) || {}).calendar || cr(e) : (e => an(sn(m(e))))(e);
	}

	function toZonedDateTimeSlots(e, t) {
	  if (t = U(t), z(e)) {
	    const n = no(e);
	    if (n && n.branding === Te) {
	      return wn(t), n;
	    }
	    const o = getCalendarSlotFromBag(e);
	    return jn(refineTimeZoneSlot, createTimeZoneOps, Ko(o), o, e, t);
	  }
	  return Mn(e, t);
	}

	function adaptDateMethods(e) {
	  return T((e => t => e(slotsToIso(t))), e);
	}

	function slotsToIso(e) {
	  return fn(e, createTimeZoneOffsetOps);
	}

	function createDateTimeFormatClass() {
	  const e = En.prototype, t = Object.getOwnPropertyDescriptors(e), n = Object.getOwnPropertyDescriptors(En), DateTimeFormat = function(e, t = {}) {
	    if (!(this instanceof DateTimeFormat)) {
	      return new DateTimeFormat(e, t);
	    }
	    Or.set(this, ((e, t = {}) => {
	      const n = new En(e, t), o = n.resolvedOptions(), r = o.locale, a = Vn(Object.keys(t), o), i = Jn(createFormatPrepperForBranding), prepFormat = (...e) => {
	        let t;
	        const o = e.map(((e, n) => {
	          const o = no(e), r = (o || {}).branding;
	          if (n && t && t !== r) {
	            throw new TypeError(kn);
	          }
	          return t = r, o;
	        }));
	        return t ? i(t)(r, a, ...o) : [ n, ...e ];
	      };
	      return prepFormat.u = n, prepFormat;
	    })(e, t));
	  };
	  for (const e in t) {
	    const n = t[e], o = e.startsWith("format") && createFormatMethod(e);
	    "function" == typeof n.value ? n.value = "constructor" === e ? DateTimeFormat : o || createProxiedMethod(e) : o && (n.get = function() {
	      return o.bind(this);
	    });
	  }
	  return n.prototype.value = Object.create(e, t), Object.defineProperties(DateTimeFormat, n), 
	  DateTimeFormat;
	}

	function createFormatMethod(e) {
	  return function(...t) {
	    const n = Or.get(this), [o, ...r] = n(...t);
	    return o[e](...r);
	  };
	}

	function createProxiedMethod(e) {
	  return function(...t) {
	    return Or.get(this).u[e](...t);
	  };
	}

	function createFormatPrepperForBranding(t) {
	  const n = xn[t];
	  if (!n) {
	    throw new TypeError(Ln(t));
	  }
	  return e(n, Jn(qn));
	}

	const xn = {
	  Instant: t,
	  PlainDateTime: n,
	  PlainDate: o,
	  PlainTime: r,
	  PlainYearMonth: a,
	  PlainMonthDay: i
	}, Rn = /*@__PURE__*/ e(t), Wn = /*@__PURE__*/ e(s), Gn = /*@__PURE__*/ e(n), Un = /*@__PURE__*/ e(o), zn = /*@__PURE__*/ e(r), Hn = /*@__PURE__*/ e(a), Kn = /*@__PURE__*/ e(i), Qn = {
	  era: l,
	  eraYear: c,
	  year: u,
	  month: d,
	  daysInMonth: d,
	  daysInYear: d,
	  inLeapYear: f,
	  monthsInYear: d
	}, Xn = {
	  monthCode: m
	}, $n = {
	  day: d
	}, _n = {
	  dayOfWeek: d,
	  dayOfYear: d,
	  weekOfYear: S,
	  yearOfWeek: c,
	  daysInWeek: d
	}, eo = /*@__PURE__*/ Object.assign({}, Qn, Xn, $n, _n), to = /*@__PURE__*/ new WeakMap, no = /*@__PURE__*/ to.get.bind(to), oo = /*@__PURE__*/ to.set.bind(to), ro = {
	  ...createCalendarFieldMethods(Qn, [ L ]),
	  ...createCalendarFieldMethods(_n, []),
	  ...createCalendarFieldMethods(Xn, [ L, q ]),
	  ...createCalendarFieldMethods($n, [ q ])
	}, ao = /*@__PURE__*/ createCalendarGetters(eo), io = /*@__PURE__*/ createCalendarGetters({
	  ...Qn,
	  ...Xn
	}), so = /*@__PURE__*/ createCalendarGetters({
	  ...Xn,
	  ...$n
	}), lo = {
	  calendarId: e => I(e.calendar)
	}, co = /*@__PURE__*/ T(((e, t) => function(n) {
	  const {i: o} = this;
	  return e(o[t](Yo(v(n, o))));
	}), eo), uo = /*@__PURE__*/ b((e => t => t[e]), F.concat("sign")), fo = /*@__PURE__*/ b(((e, t) => e => e[j[t]]), w), mo = {
	  epochSeconds: M,
	  epochMilliseconds: y,
	  epochMicroseconds: N,
	  epochNanoseconds: B
	}, So = /*@__PURE__*/ E(V, new Set([ "branding" ])), [Oo, To, po] = createSlotClass(q, E(G, refineCalendarSlot), {
	  ...lo,
	  ...so
	}, {
	  getISOFields: So,
	  getCalendar: createCalendarFromSlots,
	  with(e, t, n) {
	    return To(k(_o, e, this, rejectInvalidBag(t), n));
	  },
	  equals: (e, t) => x(e, toPlainMonthDaySlots(t)),
	  toPlainDate(e, t) {
	    return Yo(R($o, e, this, t));
	  },
	  toLocaleString(e, t, n) {
	    const [o, r] = Kn(t, n, e);
	    return o.format(r);
	  },
	  toString: W,
	  toJSON: e => W(e),
	  valueOf: neverValueOf
	}, {
	  from: (e, t) => To(toPlainMonthDaySlots(e, t))
	}), ho = {
	  getOffsetNanosecondsFor: getOffsetNanosecondsForAdapter,
	  getPossibleInstantsFor(e, t, n) {
	    const o = [ ...t.call(e, No(ee(n, X))) ].map((e => go(e).epochNanoseconds)), r = o.length;
	    return r > 1 && (o.sort(te), ne(oe(re(o[0], o[r - 1])))), o;
	  }
	}, Do = {
	  getOffsetNanosecondsFor: getOffsetNanosecondsForAdapter
	}, [Po, Co, go] = createSlotClass(Oe, Se, mo, {
	  add: (e, t) => Co(se(0, e, toDurationSlots(t))),
	  subtract: (e, t) => Co(se(1, e, toDurationSlots(t))),
	  until: (e, t, n) => ar(le(0, e, toInstantSlots(t), n)),
	  since: (e, t, n) => ar(le(1, e, toInstantSlots(t), n)),
	  round: (e, t) => Co(ce(e, t)),
	  equals: (e, t) => ue(e, toInstantSlots(t)),
	  toZonedDateTime(e, t) {
	    const n = de(t);
	    return dr(fe(e, refineTimeZoneSlot(n.timeZone), refineCalendarSlot(n.calendar)));
	  },
	  toZonedDateTimeISO: (e, t) => dr(fe(e, refineTimeZoneSlot(t))),
	  toLocaleString(e, t, n) {
	    const [o, r] = Rn(t, n, e);
	    return o.format(r);
	  },
	  toString: (e, t) => me(refineTimeZoneSlot, createTimeZoneOffsetOps, e, t),
	  toJSON: e => me(refineTimeZoneSlot, createTimeZoneOffsetOps, e),
	  valueOf: neverValueOf
	}, {
	  from: e => Co(toInstantSlots(e)),
	  fromEpochSeconds: e => Co(De(e)),
	  fromEpochMilliseconds: e => Co(Pe(e)),
	  fromEpochMicroseconds: e => Co(Ce(e)),
	  fromEpochNanoseconds: e => Co(ge(e)),
	  compare: (e, t) => Ze(toInstantSlots(e), toInstantSlots(t))
	}), [Zo, bo] = createSlotClass("TimeZone", (e => {
	  const t = Me(e);
	  return {
	    branding: "TimeZone",
	    id: t,
	    o: ie(t)
	  };
	}), {
	  id: e => e.id
	}, {
	  getPossibleInstantsFor: ({o: e}, t) => e.getPossibleInstantsFor(toPlainDateTimeSlots(t)).map((e => Co(_(e)))),
	  getOffsetNanosecondsFor: ({o: e}, t) => e.getOffsetNanosecondsFor(toInstantSlots(t).epochNanoseconds),
	  getOffsetStringFor(e, t) {
	    const n = toInstantSlots(t).epochNanoseconds, o = createAdapterOps(this, Do).getOffsetNanosecondsFor(n);
	    return Fe(o);
	  },
	  getPlainDateTimeFor(e, t, n = X) {
	    const o = toInstantSlots(t).epochNanoseconds, r = createAdapterOps(this, Do).getOffsetNanosecondsFor(o);
	    return No(ee(Ie(o, r), refineCalendarSlot(n)));
	  },
	  getInstantFor(e, t, n) {
	    const o = toPlainDateTimeSlots(t), r = ve(n), a = createAdapterOps(this);
	    return Co(_(we(a, o, r)));
	  },
	  getNextTransition: ({o: e}, t) => getImplTransition(1, e, t),
	  getPreviousTransition: ({o: e}, t) => getImplTransition(-1, e, t),
	  equals(e, t) {
	    return !!je(this, refineTimeZoneSlot(t));
	  },
	  toString: e => e.id,
	  toJSON: e => e.id
	}, {
	  from(e) {
	    const t = refineTimeZoneSlot(e);
	    return "string" == typeof t ? new Zo(t) : t;
	  }
	}), Fo = /*@__PURE__*/ createProtocolValidator(Object.keys(ho)), [Io, vo] = createSlotClass(xe, ke, fo, {
	  getISOFields: So,
	  with(e, t, n) {
	    return vo(Be(this, rejectInvalidBag(t), n));
	  },
	  add: (e, t) => vo(Ye(0, e, toDurationSlots(t))),
	  subtract: (e, t) => vo(Ye(1, e, toDurationSlots(t))),
	  until: (e, t, n) => ar(Ae(0, e, toPlainTimeSlots(t), n)),
	  since: (e, t, n) => ar(Ae(1, e, toPlainTimeSlots(t), n)),
	  round: (e, t) => vo(Ee(e, t)),
	  equals: (e, t) => Ve(e, toPlainTimeSlots(t)),
	  toZonedDateTime: (e, t) => dr(Je(refineTimeZoneSlot, toPlainDateSlots, createTimeZoneOps, e, t)),
	  toPlainDateTime: (e, t) => No(Le(e, toPlainDateSlots(t))),
	  toLocaleString(e, t, n) {
	    const [o, r] = zn(t, n, e);
	    return o.format(r);
	  },
	  toString: qe,
	  toJSON: e => qe(e),
	  valueOf: neverValueOf
	}, {
	  from: (e, t) => vo(toPlainTimeSlots(e, t)),
	  compare: (e, t) => He(toPlainTimeSlots(e), toPlainTimeSlots(t))
	}), [wo, jo, Mo] = createSlotClass(L, E(tt, refineCalendarSlot), {
	  ...lo,
	  ...io
	}, {
	  getISOFields: So,
	  getCalendar: createCalendarFromSlots,
	  with(e, t, n) {
	    return jo(Ke(Xo, e, this, rejectInvalidBag(t), n));
	  },
	  add: (e, t, n) => jo(Qe(nr, 0, e, toDurationSlots(t), n)),
	  subtract: (e, t, n) => jo(Qe(nr, 1, e, toDurationSlots(t), n)),
	  until: (e, t, n) => ar(Xe(or, 0, e, toPlainYearMonthSlots(t), n)),
	  since: (e, t, n) => ar(Xe(or, 1, e, toPlainYearMonthSlots(t), n)),
	  equals: (e, t) => $e(e, toPlainYearMonthSlots(t)),
	  toPlainDate(e, t) {
	    return Yo(_e($o, e, this, t));
	  },
	  toLocaleString(e, t, n) {
	    const [o, r] = Hn(t, n, e);
	    return o.format(r);
	  },
	  toString: et,
	  toJSON: e => et(e),
	  valueOf: neverValueOf
	}, {
	  from: (e, t) => jo(toPlainYearMonthSlots(e, t)),
	  compare: (e, t) => rt(toPlainYearMonthSlots(e), toPlainYearMonthSlots(t))
	}), [yo, No] = createSlotClass(We, E(pt, refineCalendarSlot), {
	  ...lo,
	  ...ao,
	  ...fo
	}, {
	  getISOFields: So,
	  getCalendar: createCalendarFromSlots,
	  with(e, t, n) {
	    return No(at($o, e, this, rejectInvalidBag(t), n));
	  },
	  withCalendar: (e, t) => No(it(e, refineCalendarSlot(t))),
	  withPlainDate: (e, t) => No(st(e, toPlainDateSlots(t))),
	  withPlainTime: (e, t) => No(lt(e, optionalToPlainTimeFields(t))),
	  add: (e, t, n) => No(ct(er, 0, e, toDurationSlots(t), n)),
	  subtract: (e, t, n) => No(ct(er, 1, e, toDurationSlots(t), n)),
	  until: (e, t, n) => ar(ut(tr, 0, e, toPlainDateTimeSlots(t), n)),
	  since: (e, t, n) => ar(ut(tr, 1, e, toPlainDateTimeSlots(t), n)),
	  round: (e, t) => No(dt(e, t)),
	  equals: (e, t) => ft(e, toPlainDateTimeSlots(t)),
	  toZonedDateTime: (e, t, n) => dr(mt(createTimeZoneOps, e, refineTimeZoneSlot(t), n)),
	  toPlainDate: e => Yo(v(e)),
	  toPlainTime: e => vo(Ge(e)),
	  toPlainYearMonth(e) {
	    return jo(St(Ho, e, this));
	  },
	  toPlainMonthDay(e) {
	    return To(Ot(Qo, e, this));
	  },
	  toLocaleString(e, t, n) {
	    const [o, r] = Gn(t, n, e);
	    return o.format(r);
	  },
	  toString: Tt,
	  toJSON: e => Tt(e),
	  valueOf: neverValueOf
	}, {
	  from: (e, t) => No(toPlainDateTimeSlots(e, t)),
	  compare: (e, t) => gt(toPlainDateTimeSlots(e), toPlainDateTimeSlots(t))
	}), [Bo, Yo, Ao] = createSlotClass(J, E(Nt, refineCalendarSlot), {
	  ...lo,
	  ...ao
	}, {
	  getISOFields: So,
	  getCalendar: createCalendarFromSlots,
	  with(e, t, n) {
	    return Yo(Zt($o, e, this, rejectInvalidBag(t), n));
	  },
	  withCalendar: (e, t) => Yo(it(e, refineCalendarSlot(t))),
	  add: (e, t, n) => Yo(bt(er, 0, e, toDurationSlots(t), n)),
	  subtract: (e, t, n) => Yo(bt(er, 1, e, toDurationSlots(t), n)),
	  until: (e, t, n) => ar(Ft(tr, 0, e, toPlainDateSlots(t), n)),
	  since: (e, t, n) => ar(Ft(tr, 1, e, toPlainDateSlots(t), n)),
	  equals: (e, t) => It(e, toPlainDateSlots(t)),
	  toZonedDateTime(e, t) {
	    const n = !z(t) || t instanceof Zo ? {
	      timeZone: t
	    } : t;
	    return dr(vt(refineTimeZoneSlot, toPlainTimeSlots, createTimeZoneOps, e, n));
	  },
	  toPlainDateTime: (e, t) => No(wt(e, optionalToPlainTimeFields(t))),
	  toPlainYearMonth(e) {
	    return jo(jt(Ho, e, this));
	  },
	  toPlainMonthDay(e) {
	    return To(Mt(Qo, e, this));
	  },
	  toLocaleString(e, t, n) {
	    const [o, r] = Un(t, n, e);
	    return o.format(r);
	  },
	  toString: yt,
	  toJSON: e => yt(e),
	  valueOf: neverValueOf
	}, {
	  from: (e, t) => Yo(toPlainDateSlots(e, t)),
	  compare: (e, t) => rt(toPlainDateSlots(e), toPlainDateSlots(t))
	}), Eo = {
	  fields(e, t, n) {
	    return [ ...t.call(e, n) ];
	  }
	}, Vo = /*@__PURE__*/ Object.assign({
	  dateFromFields(e, t, n, o) {
	    return Ao(t.call(e, Object.assign(Object.create(null), n), o));
	  }
	}, Eo), Jo = /*@__PURE__*/ Object.assign({
	  yearMonthFromFields(e, t, n, o) {
	    return Mo(t.call(e, Object.assign(Object.create(null), n), o));
	  }
	}, Eo), Lo = /*@__PURE__*/ Object.assign({
	  monthDayFromFields(e, t, n, o) {
	    return po(t.call(e, Object.assign(Object.create(null), n), o));
	  }
	}, Eo), qo = {
	  mergeFields(e, t, n, o) {
	    return de(t.call(e, Object.assign(Object.create(null), n), Object.assign(Object.create(null), o)));
	  }
	}, ko = /*@__PURE__*/ Object.assign({}, Vo, qo), xo = /*@__PURE__*/ Object.assign({}, Jo, qo), Ro = /*@__PURE__*/ Object.assign({}, Lo, qo), Wo = {
	  dateAdd(e, t, n, o, r) {
	    return Ao(t.call(e, Yo(v(n, e)), ar(Vt(o)), r));
	  }
	}, Go = /*@__PURE__*/ Object.assign({}, Wo, {
	  dateUntil(e, t, n, o, r, a) {
	    return ir(t.call(e, Yo(v(n, e)), Yo(v(o, e)), Object.assign(Object.create(null), a, {
	      largestUnit: Et[r]
	    })));
	  }
	}), Uo = /*@__PURE__*/ Object.assign({}, Wo, {
	  day: dayAdapter
	}), zo = /*@__PURE__*/ Object.assign({}, Go, {
	  day: dayAdapter
	}), Ho = /*@__PURE__*/ createCompoundOpsCreator(Jo), Ko = /*@__PURE__*/ createCompoundOpsCreator(Vo), Qo = /*@__PURE__*/ createCompoundOpsCreator(Lo), Xo = /*@__PURE__*/ createCompoundOpsCreator(xo), $o = /*@__PURE__*/ createCompoundOpsCreator(ko), _o = /*@__PURE__*/ createCompoundOpsCreator(Ro), er = /*@__PURE__*/ createCompoundOpsCreator(Wo), tr = /*@__PURE__*/ createCompoundOpsCreator(Go), nr = /*@__PURE__*/ createCompoundOpsCreator(Uo), or = /*@__PURE__*/ createCompoundOpsCreator(zo), [rr, ar, ir] = createSlotClass(qt, Lt, {
	  ...uo,
	  blank: Jt
	}, {
	  with: (e, t) => ar(kt(e, t)),
	  negated: e => ar(xt(e)),
	  abs: e => ar(Rt(e)),
	  add: (e, t, n) => ar(Wt(refinePublicRelativeTo, tr, createTimeZoneOps, 0, e, toDurationSlots(t), n)),
	  subtract: (e, t, n) => ar(Wt(refinePublicRelativeTo, tr, createTimeZoneOps, 1, e, toDurationSlots(t), n)),
	  round: (e, t) => ar(Gt(refinePublicRelativeTo, tr, createTimeZoneOps, e, t)),
	  total: (e, t) => Ut(refinePublicRelativeTo, tr, createTimeZoneOps, e, t),
	  toLocaleString(e, t, n) {
	    return Intl.DurationFormat ? new Intl.DurationFormat(t, n).format(this) : zt(e);
	  },
	  toString: zt,
	  toJSON: e => zt(e),
	  valueOf: neverValueOf
	}, {
	  from: e => ar(toDurationSlots(e)),
	  compare: (e, t, n) => $t(refinePublicRelativeTo, er, createTimeZoneOps, toDurationSlots(e), toDurationSlots(t), n)
	}), sr = {
	  toString: e => e.id,
	  toJSON: e => e.id,
	  ...ro,
	  dateAdd: ({id: e, o: t}, n, o, r) => Yo(v(t.dateAdd(toPlainDateSlots(n), toDurationSlots(o), r), e)),
	  dateUntil: ({o: e}, t, n, o) => ar(Vt(e.dateUntil(toPlainDateSlots(t), toPlainDateSlots(n), _t(o)))),
	  dateFromFields: ({id: e, o: t}, n, o) => Yo(Yt(t, n, o, ln(e))),
	  yearMonthFromFields: ({id: e, o: t}, n, o) => jo(nt(t, n, o, un(e))),
	  monthDayFromFields: ({id: e, o: t}, n, o) => To(K(t, 0, n, o, cn(e))),
	  fields({o: e}, t) {
	    const n = new Set(en), o = [];
	    for (const e of t) {
	      if (m(e), !n.has(e)) {
	        throw new RangeError(tn(e));
	      }
	      n.delete(e), o.push(e);
	    }
	    return e.fields(o);
	  },
	  mergeFields: ({o: e}, t, n) => e.mergeFields(nn(on(t)), nn(on(n)))
	}, [lr] = createSlotClass("Calendar", (e => {
	  const t = rn(e);
	  return {
	    branding: "Calendar",
	    id: t,
	    o: Y(t)
	  };
	}), {
	  id: e => e.id
	}, sr, {
	  from(e) {
	    const t = refineCalendarSlot(e);
	    return "string" == typeof t ? new lr(t) : t;
	  }
	}), cr = /*@__PURE__*/ createProtocolValidator(Object.keys(sr).slice(4)), [ur, dr] = createSlotClass(Te, E(vn, refineCalendarSlot, refineTimeZoneSlot), {
	  ...mo,
	  ...lo,
	  ...adaptDateMethods(ao),
	  ...adaptDateMethods(fo),
	  offset: e => Fe(slotsToIso(e).offsetNanoseconds),
	  offsetNanoseconds: e => slotsToIso(e).offsetNanoseconds,
	  timeZoneId: e => I(e.timeZone),
	  hoursInDay: e => dn(createTimeZoneOps, e)
	}, {
	  getISOFields: e => mn(createTimeZoneOffsetOps, e),
	  getCalendar: createCalendarFromSlots,
	  getTimeZone: ({timeZone: e}) => "string" == typeof e ? new Zo(e) : e,
	  with(e, t, n) {
	    return dr(Sn($o, createTimeZoneOps, e, this, rejectInvalidBag(t), n));
	  },
	  withCalendar: (e, t) => dr(it(e, refineCalendarSlot(t))),
	  withTimeZone: (e, t) => dr(On(e, refineTimeZoneSlot(t))),
	  withPlainDate: (e, t) => dr(Tn(createTimeZoneOps, e, toPlainDateSlots(t))),
	  withPlainTime: (e, t) => dr(pn(createTimeZoneOps, e, optionalToPlainTimeFields(t))),
	  add: (e, t, n) => dr(hn(er, createTimeZoneOps, 0, e, toDurationSlots(t), n)),
	  subtract: (e, t, n) => dr(hn(er, createTimeZoneOps, 1, e, toDurationSlots(t), n)),
	  until: (e, t, n) => ar(Vt(Dn(tr, createTimeZoneOps, 0, e, toZonedDateTimeSlots(t), n))),
	  since: (e, t, n) => ar(Vt(Dn(tr, createTimeZoneOps, 1, e, toZonedDateTimeSlots(t), n))),
	  round: (e, t) => dr(Pn(createTimeZoneOps, e, t)),
	  startOfDay: e => dr(Cn(createTimeZoneOps, e)),
	  equals: (e, t) => gn(e, toZonedDateTimeSlots(t)),
	  toInstant: e => Co(Zn(e)),
	  toPlainDateTime: e => No(ht(createTimeZoneOffsetOps, e)),
	  toPlainDate: e => Yo(Bt(createTimeZoneOffsetOps, e)),
	  toPlainTime: e => vo(Re(createTimeZoneOffsetOps, e)),
	  toPlainYearMonth(e) {
	    return jo(bn(Ho, e, this));
	  },
	  toPlainMonthDay(e) {
	    return To(Fn(Qo, e, this));
	  },
	  toLocaleString(e, t, n = {}) {
	    const [o, r] = Wn(t, n, e);
	    return o.format(r);
	  },
	  toString: (e, t) => In(createTimeZoneOffsetOps, e, t),
	  toJSON: e => In(createTimeZoneOffsetOps, e),
	  valueOf: neverValueOf
	}, {
	  from: (e, t) => dr(toZonedDateTimeSlots(e, t)),
	  compare: (e, t) => yn(toZonedDateTimeSlots(e), toZonedDateTimeSlots(t))
	}), fr = /*@__PURE__*/ Object.defineProperties({}, {
	  ...h("Temporal.Now"),
	  ...p({
	    timeZoneId: () => Nn(),
	    instant: () => Co(_(Bn())),
	    zonedDateTime: (e, t = Nn()) => dr(Yn(Bn(), refineTimeZoneSlot(t), refineCalendarSlot(e))),
	    zonedDateTimeISO: (e = Nn()) => dr(Yn(Bn(), refineTimeZoneSlot(e), X)),
	    plainDateTime: (e, t = Nn()) => No(ee(An(createTimeZoneOffsetOps(refineTimeZoneSlot(t))), refineCalendarSlot(e))),
	    plainDateTimeISO: (e = Nn()) => No(ee(An(createTimeZoneOffsetOps(refineTimeZoneSlot(e))), X)),
	    plainDate: (e, t = Nn()) => Yo(v(An(createTimeZoneOffsetOps(refineTimeZoneSlot(t))), refineCalendarSlot(e))),
	    plainDateISO: (e = Nn()) => Yo(v(An(createTimeZoneOffsetOps(refineTimeZoneSlot(e))), X)),
	    plainTimeISO: (e = Nn()) => vo(Ge(An(createTimeZoneOffsetOps(refineTimeZoneSlot(e)))))
	  })
	}), mr = /*@__PURE__*/ Object.defineProperties({}, {
	  ...h("Temporal"),
	  ...p({
	    PlainYearMonth: wo,
	    PlainMonthDay: Oo,
	    PlainDate: Bo,
	    PlainTime: Io,
	    PlainDateTime: yo,
	    ZonedDateTime: ur,
	    Instant: Po,
	    Calendar: lr,
	    TimeZone: Zo,
	    Duration: rr,
	    Now: fr
	  })
	}), Sr = /*@__PURE__*/ createDateTimeFormatClass(), Or = /*@__PURE__*/ new WeakMap; /*@__PURE__*/ Object.defineProperties(Object.create(Intl), p({
	  DateTimeFormat: Sr
	}));

	class AbstractView {
	  constructor() {
	    this.app = document.getElementById("root");
	  }

	  setTitle(title) {
	    document.title = title;
	  }

	  render() {
	    return;
	  }

	  destroy() {
	    return;
	  }
	}

	class DivComponent {
	  constructor() {
	    this.element = document.createElement("div");
	  }

	  render() {
	    this.element;
	  }
	}

	class Header extends DivComponent {
	  constructor(appState) {
	    super();
	    this.appState = appState;
	  }

	  render() {
	    const currentPath = location.hash;
	    this.element.classList.add("header");
	    this.element.innerHTML = `
    <a class="logo" href="#">NEWSLY</a>
      <div class="menu">
        <a class="menu__item ${
          currentPath === "#search" ? "menu__item_active" : ""
        }" href="#search">
          <img src="./static/icons/search.svg" alt="Иконка поиска" />
          Поиск
        </a>
        <a class="menu__item ${
          currentPath === "#readLater" ? "menu__item_active" : ""
        }" href="#readLater">
          <img src="./static/icons/favorites.svg" alt="Иконка поиска" />
          Закладки
          <div>${this.appState.readLater.length}</div>
        </a>
    `;
	    return this.element;
	  }
	}

	class NewsCard extends DivComponent {
	  constructor(appState, cardState) {
	    super();
	    this.appState = appState;
	    this.cardState = cardState;
	  }

	  #addToReadLater() {
	    this.appState.readLater.push(this.cardState);
	  }

	  #deleteFromReadLater() {
	    this.appState.readLater = this.appState.readLater.filter((news) => {
	      news.url !== this.cardState.url;
	    });
	  }

	  render() {
	    const existInReadLater = this.appState.readLater.find((news) => {
	      news.url === this.cardState.url;
	    });
	    // console.log(existInReadLater);
	    this.element.classList.add("news-card");
	    this.element.innerHTML = `
    <button class="button_add ${existInReadLater ? "button_add_active" : ""}">
        <img
          src="./static/icons/${
            existInReadLater ? "favorites-white" : "favorites"
          }.svg"
          alt="Иконка добавить в закладки"
        />
      </button>
    <div class="news-card__image">
      <img src="${this.cardState.urlToImage}" alt="Фотография из новости" />
    </div>
    <div class="news-card__title">${this.cardState.title}</div>
    <div class="news-card__info">
      <div class="news-card__author">${
        this.cardState.author === null ? "———" : this.cardState.author
      }</div>
      <div class="news-card__source">${this.cardState.source.name}</div>
    </div>
    <div class="news-card__description">${
      this.cardState.description
    } <a href="${this.cardState.url}" target="_self">[Читать далее]</a></div>
    `;

	    if (existInReadLater) {
	      this.element
	        .querySelector("button")
	        .addEventListener("click", this.#deleteFromReadLater.bind(this));
	    } else {
	      this.element
	        .querySelector("button")
	        .addEventListener("click", this.#addToReadLater.bind(this));
	    }

	    return this.element;
	  }
	}

	class NewsList extends DivComponent {
	  constructor(appState, parentState) {
	    super();
	    this.appState = appState;
	    this.parentState = parentState;
	  }

	  render() {
	    if (this.parentState.loading) {
	      this.element.innerHTML = `
  <div class="loading__wrapper">
    <span class="letter letter1">L</span>
    <span class="letter letter2">o</span>
    <span class="letter letter3">a</span>
    <span class="letter letter4">d</span>
    <span class="letter letter5">i</span>
    <span class="letter letter6">n</span>
    <span class="letter letter7">g</span>
    <span class="letter letter8">.</span>
    <span class="letter letter9">.</span>
    <span class="letter letter10">.</span>
  </div>

      `;
	      return this.element;
	    }
	    this.element.classList.add("news-list");
	    this.element.innerHTML = `
       <div class="news-list__title">
      Лента новостей
      <div class="title__date">${this.parentState.date}</div>
    </div>
    `;
	    for (const cardState of this.parentState.list) {
	      const newsCard = new NewsCard(this.appState, cardState).render();
	      this.element.append(newsCard);
	      // console.log(this.parentState);
	      // console.log(this.appState);
	    }
	    return this.element;
	  }
	}

	class MainView extends AbstractView {
	  state = {
	    list: [],
	    totalResults: 0,
	    loading: false,
	    searchQuery: undefined,
	    offset: 0,
	    date: mr.Now.plainDateISO().subtract({ days: 1 }).toString(),
	  };

	  constructor(appState) {
	    super();
	    this.appState = appState;
	    this.setTitle("Newsly - лента новостей");
	    this.appState = onChange(this.appState, this.appStateHook.bind(this));
	    this.state = onChange(this.state, this.stateHook.bind(this));
	    this.loadList();
	  }

	  appStateHook(path) {
	    if (path === "readLater") {
	      console.log(this.appState.readLater);
	      this.render();
	    }
	  }

	  stateHook(path) {
	    if (path === "list" || path === "loading") {
	      this.render();
	    }
	  }

	  async getNews() {
	    const response = await fetch(
	      `https://newsapi.org/v2/everything?q=а&language=ru&from=${this.state.date}&apiKey=51e43ca151254a9987a83b9d0530ebd6`
	    );
	    return response.json();
	  }

	  async loadList() {
	    try {
	      this.state.loading = true;
	      const data = await this.getNews();
	      this.state.loading = false;
	      if (data.status !== "ok") {
	        throw new Error("Не удалось загрузить ленту");
	      }
	      // console.log(data.articles);
	      this.state.totalResults = data.totalResults;
	      this.state.list = data.articles;
	    } catch (error) {
	      console.warn(error);
	    }
	  }

	  render() {
	    const main = document.createElement("div");
	    main.append(new NewsList(this.appState, this.state).render());

	    this.app.innerHTML = "";
	    this.app.append(main);
	    this.renderHeader();
	  }

	  renderHeader() {
	    const header = new Header(this.appState).render();
	    this.app.prepend(header);
	  }
	}

	class App {
	  routes = [{ path: "", view: MainView }];
	  appState = {
	    readLater: [],
	  };

	  constructor() {
	    window.addEventListener("hashchange", this.render.bind(this));
	    this.render();
	  }

	  render() {
	    if (this.currentView) {
	      this.currentView.destroy();
	    }
	    const view = this.routes.find((route) => route.path === location.hash).view;
	    this.currentView = new view(this.appState);
	    this.currentView.render();
	  }
	}

	new App();

})();
