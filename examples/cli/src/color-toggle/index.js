import {createCustomElement} from '../runtime/ui-core';
import snabbdom, {createElement} from '../runtime/snabbdom';
import '@servicenow/now-button';
import styles from './styles.scss';

const view = ({properties, selectedIndex}) => {
	const colors = [properties.color1, properties.color2, properties.color3];
	const selectedColor = colors[selectedIndex];

	return (
		<div className="color-toggle">
			<div className="color-toggle__buttons" role="group" aria-label="Background color">
				{colors.map((color, index) => (
					<now-button
						key={index}
						label={color}
						disabled={color === selectedColor}
						append-to-payload={{index}}
					/>
				))}
			</div>
			<div
				className="color-toggle__preview"
				style={{backgroundColor: selectedColor}}
				role="img"
				aria-label={`Selected color: ${selectedColor}`}
			/>
		</div>
	);
};

createCustomElement('color-toggle', {
	renderer: {type: snabbdom},
	view,
	styles,
	initialState: {selectedIndex: 0},
	properties: {
		color1: {default: 'red'},
		color2: {default: 'green'},
		color3: {default: 'blue'}
	},
	actionHandlers: {
		'NOW_BUTTON#CLICKED': {
			stopPropagation: true,
			effect: ({action, state, updateState, dispatch}) => {
				const {index} = action.payload;
				if (!Number.isInteger(index) || index < 0 || index > 2) return;
				const colors = [state.properties.color1, state.properties.color2, state.properties.color3];
				const color = colors[index];
				if (color === colors[state.selectedIndex]) return;
				updateState({selectedIndex: index});
				dispatch('COLOR_TOGGLE#COLOR_SELECTED', {color});
			}
		}
	}
});