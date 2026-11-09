import DefaultTheme from 'vitepress/theme';
import type { App } from 'vue';
import MermaidBlock from './MermaidBlock.vue';
import './style.css';

export default {
  ...DefaultTheme,
  enhanceApp({ app }: { app: App }) {
    DefaultTheme.enhanceApp?.({ app });
    app.component('MermaidBlock', MermaidBlock);
  },
};
