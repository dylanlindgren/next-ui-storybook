import {createCustomElement, actionTypes} from '../runtime/ui-core';
import snabbdom, {createElement} from '../runtime/snabbdom';
import '@servicenow/now-accordion';
import '@servicenow/now-card';
import styles from './styles.scss';

const view = ({items}) => (
	<now-accordion className="random-accordion">
		{items.map(({start, end, numbers}) => (
			<now-accordion-item key={start} header={{label: `${start} to ${end}`}}>
				<div slot="content" className="random-accordion__cards">
					{numbers.map((number, index) => (
						<now-card key={index}>
							<div className="random-accordion__number">{number}</div>
						</now-card>
					))}
				</div>
			</now-accordion-item>
		))}
	</now-accordion>
);

createCustomElement('random-accordion', {
	renderer: {type: snabbdom},
	view,
	styles,
	initialState: {items: []},
	actionHandlers: {
		[actionTypes.COMPONENT_BOOTSTRAPPED]: ({state, updateState}) => {
			if (state.items.length) return;
			const items = Array.from({length: 10}, (unusedValue, index) => {
				const start = index * 10 + 1;
				const end = start + 9;
				const numbers = Array.from({length: 3}, () => start + Math.floor(Math.random() * 10));
				return {start, end, numbers};
			});
			updateState({items});
		}
	}
});