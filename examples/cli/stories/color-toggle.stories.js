// Story for <color-toggle>.
import "../src/color-toggle";
import { action } from "storybook/actions";

const TAG = "color-toggle";
const EVENT = "COLOR_TOGGLE#COLOR_SELECTED";

export default {
	title: "Components/Color Toggle",
	tags: ["autodocs"],
	render: (args) => {
		const element = document.createElement(TAG);
		element.color1 = args.color1;
		element.color2 = args.color2;
		element.color3 = args.color3;

		const log = action(EVENT);
		element.addEventListener(EVENT, (event) => log(event.detail?.payload));

		return element;
	},
	argTypes: {
		color1: {
			name: "color1",
			description: "CSS color for the first button and initial preview.",
			control: { type: "text" },
		},
		color2: {
			name: "color2",
			description: "CSS color for the second button.",
			control: { type: "text" },
		},
		color3: {
			name: "color3",
			description: "CSS color for the third button.",
			control: { type: "text" },
		},
	},
	args: {
		color1: "red",
		color2: "green",
		color3: "blue",
	},
};

export const Default = {
	args: {
		color1: "red",
	},
};

export const CustomPalette = {
	args: {
		color1: "#ffcc00",
		color2: "purple",
		color3: "teal",
	},
};
