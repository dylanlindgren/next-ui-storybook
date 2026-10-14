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
		if (moduleName === '@servicenow/now-button' || moduleName === './styles.scss') return {};
		throw new Error(`Unexpected import: ${moduleName}`);
	}
});

const makeState = (properties = {}) => ({
	...definition.initialState,
	properties: {
		...Object.fromEntries(Object.entries(definition.properties).map(([name, config]) => [name, config.default])),
		...properties
	}
});
const render = state => {
	const tree = definition.view(state);
	return {buttons: tree.children[0].children, preview: tree.children[1]};
};
const click = (state, index) => {
	const events = [];
	definition.actionHandlers['NOW_BUTTON#CLICKED'].effect({
		action: {payload: {index}},
		state,
		updateState: changes => Object.assign(state, changes),
		dispatch: (name, payload) => events.push({name, color: payload.color})
	});
	return events;
};

test('registers color-toggle with red selected and three buttons', () => {
	assert.equal(registeredTag, 'color-toggle');
	const {buttons, preview} = render(makeState());
	assert.deepEqual(buttons.map(button => button.props.label), ['red', 'green', 'blue']);
	assert.deepEqual(buttons.map(button => button.props.disabled), [true, false, false]);
	assert.equal(preview.props.style.backgroundColor, 'red');
	buttons.forEach((button, index) => assert.equal(button.props['append-to-payload'].index, index));
});

test('each enabled button changes the preview, emits its color, and re-enables the previous button', () => {
	const state = makeState();
	for (const index of [1, 2, 0]) {
		const color = state.properties[`color${index + 1}`];
		assert.deepEqual(click(state, index), [{name: 'COLOR_TOGGLE#COLOR_SELECTED', color}]);
		const {buttons, preview} = render(state);
		assert.equal(preview.props.style.backgroundColor, color);
		assert.deepEqual(buttons.map(button => button.props.disabled), [0, 1, 2].map(buttonIndex => buttonIndex === index));
	}
});

test('uses configured CSS colors and follows property changes for the selected button', () => {
	const state = makeState({color1: '#ffcc00', color2: 'rebeccapurple', color3: 'rgb(0, 128, 128)'});
	assert.equal(render(state).preview.props.style.backgroundColor, '#ffcc00');
	assert.equal(click(state, 2)[0].color, 'rgb(0, 128, 128)');
	state.properties.color3 = 'pink';
	assert.equal(render(state).preview.props.style.backgroundColor, 'pink');
	assert.equal(render(state).buttons[2].props.label, 'pink');
	assert.equal(render(state).buttons[2].props.disabled, true);
});

test('disabled colors and unrelated button payloads do not dispatch or change selection', () => {
	const state = makeState({color2: 'red'});
	assert.deepEqual(render(state).buttons.map(button => button.props.disabled), [true, true, false]);
	for (const index of [0, 1, undefined, -1, 3, '2']) {
		assert.deepEqual(click(state, index), []);
		assert.equal(state.selectedIndex, 0);
	}
	assert.equal(definition.actionHandlers['NOW_BUTTON#CLICKED'].stopPropagation, true);
});

test('manifest matches the public properties and selection event', () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../now-ui.json'), 'utf8'));
	const component = manifest.components[registeredTag];
	assert.deepEqual(component.properties.map(property => property.name).sort(), Object.keys(definition.properties).sort());
	for (const property of component.properties) {
		assert.equal(property.defaultValue, definition.properties[property.name].default);
	}
	assert.equal(component.actions[0].name, 'COLOR_TOGGLE#COLOR_SELECTED');
	assert.equal(component.actions[0].payload[0].name, 'color');
});

test('Storybook controls assign component properties and keep selection event logging', () => {
	const storySource = fs.readFileSync(path.join(__dirname, '../../../stories/color-toggle.stories.js'), 'utf8');
	const storyCode = transformSync(storySource, {
		babelrc: false,
		configFile: false,
		plugins: ['@babel/plugin-transform-modules-commonjs']
	}).code;
	const exports = {};
	const events = [];
	vm.runInNewContext(storyCode, {
		exports,
		document: {
			createElement: tag => {
				assert.equal(tag, 'color-toggle');
				return {
					addEventListener(name, handler) {
						this.eventName = name;
						this.handler = handler;
					}
				};
			}
		},
		require: moduleName => {
			if (moduleName === '../src/color-toggle') return {};
			if (moduleName === 'storybook/actions') {
				return {action: name => payload => events.push({name, color: payload.color})};
			}
			throw new Error(`Unexpected import: ${moduleName}`);
		}
	});
	const story = exports.default;
	for (const color1 of ['red', 'yellow']) {
		const element = story.render({...story.args, color1});
		assert.equal(element.color1, color1);
		assert.equal(element.color2, 'green');
		assert.equal(element.color3, 'blue');
		assert.equal(element.eventName, 'COLOR_TOGGLE#COLOR_SELECTED');
		element.handler({detail: {payload: {color: color1}}});
	}
	assert.deepEqual(events, [
		{name: 'COLOR_TOGGLE#COLOR_SELECTED', color: 'red'},
		{name: 'COLOR_TOGGLE#COLOR_SELECTED', color: 'yellow'}
	]);
});