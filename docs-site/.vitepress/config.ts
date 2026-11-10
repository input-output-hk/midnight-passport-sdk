import { defineConfig } from 'vitepress';

const base =
  process.env.DOCS_BASE ?? (process.env.GITHUB_ACTIONS ? '/midnight-passport-sdk/' : '/');

export default defineConfig({
  base,
  title: 'Midnight Passport SDK',
  description: 'Build passkey-controlled Account Custody Contract experiences on Midnight',
  cleanUrls: false,
  lastUpdated: true,
  appearance: true,
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence?.bind(md.renderer.rules);
      md.renderer.rules.fence = (tokens, index, options, env, self) => {
        const token = tokens[index];
        if (token.info.trim() === 'mermaid')
          return `<MermaidBlock encoded="${encodeURIComponent(token.content)}" />`;
        return fence
          ? fence(tokens, index, options, env, self)
          : self.renderToken(tokens, index, options);
      };
    },
  },
  themeConfig: {
    logo: '/passport-mark.svg',
    siteTitle: 'Passport SDK',
    search: { provider: 'local' },
    outline: [2, 3],
    docFooter: { prev: 'Previous', next: 'Next' },
    editLink: {
      pattern:
        'https://github.com/input-output-hk/midnight-passport-sdk/edit/passport-acc-prototype/docs-site/:path',
      text: 'Improve this page',
    },
    nav: [
      { text: 'Getting started', link: '/getting-started/' },
      { text: 'Guides', link: '/guides/' },
      { text: 'Packages & API', link: '/packages/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Reference demo', link: '/demo/' },
      { text: 'Operations', link: '/operations/' },
      { text: 'GitHub', link: 'https://github.com/input-output-hk/midnight-passport-sdk' },
    ],
    sidebar: {
      '/getting-started/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Overview and capabilities', link: '/getting-started/' },
            { text: 'First browser integration', link: '/getting-started/first-integration' },
            { text: 'Installation and compatibility', link: '/getting-started/installation' },
          ],
        },
      ],
      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Choose a task', link: '/guides/' },
            { text: 'Create, open and recover', link: '/guides/account-lifecycle' },
            { text: 'Authentication and consent', link: '/guides/authorization' },
            { text: 'Holdings and transfers', link: '/guides/assets' },
            { text: 'Devices and permissions', link: '/guides/devices-grants' },
            { text: 'Persistence and background work', link: '/guides/durability' },
            { text: 'Browser, Node and wallet hosts', link: '/guides/hosts' },
          ],
        },
      ],
      '/packages/': [
        {
          text: 'Packages and API',
          items: [
            { text: 'Choose packages', link: '/packages/' },
            { text: 'Public operations and errors', link: '/packages/api' },
            { text: 'Examples', link: '/packages/examples' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture and standards',
          items: [
            { text: 'System and package layers', link: '/architecture/' },
            { text: 'Keys, wallets and trust', link: '/architecture/keys-wallets' },
            { text: 'Standards and upstream design', link: '/architecture/standards' },
            { text: 'Architecture conformance', link: '/architecture/conformance' },
            { text: 'Upstream SDK comparison', link: '/architecture/upstream-sdk' },
            { text: 'Glossary', link: '/architecture/glossary' },
          ],
        },
      ],
      '/demo/': [
        {
          text: 'Reference demo',
          items: [
            { text: 'Run the demo', link: '/demo/' },
            { text: 'Guided scenarios', link: '/demo/scenarios' },
            { text: 'Signing and Activity', link: '/demo/signing-activity' },
          ],
        },
      ],
      '/operations/': [
        {
          text: 'Operations and development',
          items: [
            { text: 'Deploy services', link: '/operations/' },
            { text: 'Public proof artifacts', link: '/operations/artifacts' },
            { text: 'Proof, sponsorship and funding', link: '/operations/services' },
            { text: 'Testing and releases', link: '/operations/quality' },
            { text: 'Verify a release', link: '/operations/release-acceptance' },
            { text: 'RC9 release notes', link: '/operations/rc9-preview' },
            { text: 'Troubleshooting', link: '/operations/troubleshooting' },
            { text: 'History and migration', link: '/operations/archive' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/input-output-hk/midnight-passport-sdk' },
    ],
    footer: {
      message: 'Midnight Passport SDK preview · upstream Passport and Lace are separate projects',
      copyright: 'Apache-2.0',
    },
  },
});
