import rootConfig from '../../tailwind.config.js'

export default {
  ...rootConfig,
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/*/src/**/*.{ts,tsx}',
  ],
}
