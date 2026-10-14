const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {transformSync} = require('@babel/core');

const createElement = (tag, props, ...children) => ({tag, props: props || {}, children: children.flat()});
let definition;
let registeredTag;
let random = Math.random;
const mockMath = Object.create(Math);
mockMath.random = () => random();
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
	Math: mockMath,
	require: moduleName => {
		if (moduleName === '../runtime/ui-core') {
			return {
				actionTypes: {COMPONENT_BOOTSTRAPPED: 'COMPONENT_BOOTSTRAPPED'},
				createCustomElement: (tag, config) => {
					registeredTag = tag;
					definition = config;
				}
			};
		}
		if (moduleName === '../runtime/snabbdom') return {createElement};
		if (['@servicenow/now-accordion', '@servicenow/now-card', './styles.scss'].includes(moduleName)) return {};
		throw new Error(`Unexpected import: ${moduleName}`);
	}
});

const initialize = state => definition.actionHandlers.COMPONENT_BOOTSTRAPPED({
	state,
	updateState: changes => Object.assign(state, changes)
});
const makeState = () => {
	const state = {...definition.initialState};
	initialize(state);
	return state;
};

test('renders ten inclusive ranges up to 100 with exactly three cards in every item', () => {
	random = Math.random;
	assert.equal(registeredTag, 'random-accordion');
	const state = makeState();
	const tree = definition.view(state);
	assert.equal(tree.tag, 'now-accordion');
	assert.equal(tree.children.length, 10);
	let totalCards = 0;
	tree.children.forEach((item, index) => {
		const start = index * 10 + 1;
		const end = start + 9;
		assert.equal(item.tag, 'now-accordion-item');
		assert.equal(item.props.header.label, `${start} to ${end}`);
		const content = item.children[0];
		assert.equal(content.props.slot, 'content');
		assert.equal(content.children.length, 3);
		content.children.forEach(card => {
			assert.equal(card.tag, 'now-card');
			const number = card.children[0].children[0];
			assert.ok(Number.isInteger(number) && number >= start && number <= end);
			totalCards += 1;
		});
	});
	assert.equal(totalCards, 30);
	assert.equal(tree.children[4].props.header.label, '41 to 50');
});

test('random generation can reach both inclusive boundaries of every range', () => {
	for (const sample of [0, 0.9999999999999999]) {
		random = () => sample;
		makeState().items.forEach(({start, end, numbers}) => {
			const expected = sample === 0 ? start : end;
			numbers.forEach(number => assert.equal(number, expected));
		});
	}
});

test('numbers remain stable across renders and repeated initialization', () => {
	let calls = 0;
	random = () => {
		calls += 1;
		return 0.5;
	};
	const state = makeState();
	assert.equal(calls, 30);
	const originalItems = state.items;
	const firstTree = definition.view(state);
	definition.view(state);
	initialize(state);
	assert.equal(state.items, originalItems);
	assert.deepEqual(definition.view(state), firstTree);
	assert.equal(calls, 30);
});

test('separate component instances generate their own numbers', () => {
	random = () => 0;
	const first = makeState();
	random = () => 0.99;
	const second = makeState();
	assert.notEqual(first.items, second.items);
	assert.equal(first.items[0].numbers[0], 1);
	assert.equal(second.items[0].numbers[0], 10);
	assert.equal(first.items[9].numbers[0], 91);
	assert.equal(second.items[9].numbers[0], 100);
});