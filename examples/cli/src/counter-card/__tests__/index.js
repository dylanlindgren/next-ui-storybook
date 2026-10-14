const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {transformSync} = require('@babel/core');

const createElement = (tag, props, ...children) => ({tag, props: props || {}, children: children.flat()});
let definition;
let registeredTag;
const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const {code} = transformSync(source, {
	babelrc: false,
	configFile: false,
	plugins: [
		['@babel/plugin-transform-react-jsx', {pragma: 'createElement'}],
		'@babel/plugin-transform-modules-commonjs'
	]
});
vm.runInNewContext(code, {
	require: moduleName => {
		if (moduleName === '../runtime/ui-core') {
			return {createCustomElement: (tag, config) => {
				registeredTag = tag;
				definition = config;
			}};
		}
		if (moduleName === '../runtime/snabbdom') return {createElement};
		if (['@servicenow/now-card', '@servicenow/now-button', './styles.scss'].includes(moduleName)) return {};
		throw new Error(`Unexpected import: ${moduleName}`);
	}
});

const click = state => definition.actionHandlers['NOW_BUTTON#CLICKED'].effect({
	state,
	updateState: changes => Object.assign(state, changes)
});

test('registers an HDS card with one button and starts counting at 1', () => {
	assert.equal(registeredTag, 'counter-card');
	const tree = definition.view({...definition.initialState});
	assert.equal(tree.tag, 'now-card');
	const children = tree.children[0].children;
	assert.equal(children[1].tag, 'output');
	assert.equal(children[1].children[0], 1);
	assert.equal(children[1].props['aria-live'], 'polite');
	assert.equal(children[2].tag, 'now-button');
	assert.equal(children[2].props.label, 'Increment');
});

test('every button click increments the displayed count by exactly 1', () => {
	const state = {...definition.initialState};
	for (const expected of [2, 3, 4, 5]) {
		click(state);
		assert.equal(state.count, expected);
		assert.equal(definition.view(state).children[0].children[1].children[0], expected);
	}
	assert.equal(definition.actionHandlers['NOW_BUTTON#CLICKED'].stopPropagation, true);
});

test('separate card instances retain independent counts', () => {
	const first = {...definition.initialState};
	const second = {...definition.initialState};
	click(first);
	click(first);
	assert.equal(first.count, 3);
	assert.equal(second.count, 1);
	click(second);
	assert.equal(second.count, 2);
	assert.equal(first.count, 3);
});