import {createCustomElement} from '../runtime/ui-core';
import snabbdom, {createElement} from '../runtime/snabbdom';
import '@servicenow/now-card';
import '@servicenow/now-button';
import styles from './styles.scss';

const view = ({count}) => (
	<now-card className="counter-card">
		<div className="counter-card__content">
			<h2 className="counter-card__heading">Counter</h2>
			<output className="counter-card__count" aria-live="polite" aria-label="Count">{count}</output>
			<now-button label="Increment" icon="plus-outline" />
		</div>
	</now-card>
);

createCustomElement('counter-card', {
	renderer: {type: snabbdom},
	view,
	styles,
	initialState: {count: 1},
	actionHandlers: {
		'NOW_BUTTON#CLICKED': {
			stopPropagation: true,
			effect: ({state, updateState}) => {
				updateState({count: state.count + 1});
			}
		}
	}
});