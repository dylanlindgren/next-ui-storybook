/** @type {import('@storybook/web-components-vite').StorybookConfig} */
export default {
  framework: '@storybook/web-components-vite',
  stories: ['../stories/**/*.stories.@(js|jsx|mjs)'],
  addons: [
    {
      name: '@dylanlindgren/next-ui-storybook-addon',
      options: {
        componentSrcDir: 'src',
      },
    },
  ],
  core: { disableTelemetry: true },
}