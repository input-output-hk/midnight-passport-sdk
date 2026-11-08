// Fixed canonical cases, maintained with their corresponding assertions.
export default [
  {
    id: 'presentation.signed-out-landing-hides-workspace-navigation-and',
    name: 'signed-out landing hides workspace navigation and starts no credential or account work',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.signed-out-home-returns-from-demo-tools',
    name: 'signed-out home returns from Demo tools to login without an Overview menu or credential call',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.optional-react-strictmode-hosts-use-public-snapshots',
    name: 'optional React StrictMode hosts use public snapshots without credential access, command replay or SDK effects',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.optional-lace-wallet-has-explicit-review-separate',
    name: 'optional Lace Wallet has explicit review, separate read-only balances, network/rejection/replacement refusals and late-result forget fencing',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.hiding-activity-between-approval-and-browser-access',
    name: 'hiding Activity between approval and browser access refuses the credential call',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.two-white-label-activity-hosts-render-shared',
    name: 'two white-label Activity hosts render shared public snapshots with independent cleanup and no replay',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.persistent-navigation-keeps-parent-positions-and-document',
    name: 'persistent navigation keeps parent positions and document scroll stable; wallet and Audit use consistent side-effect-free page links',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.compact-navigation-drawer-contains-focus-returns-focus',
    name: 'compact navigation drawer contains focus, returns focus on cancel or navigation, and resizes without duplicating controls or shifting content',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.wallet-and-audit-deep-links-select-presentation',
    name: 'wallet and Audit deep links select presentation only, with safe fallback for unknown subpages',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.landing-offers-balanced-sign-up-and-log',
    name: 'landing offers balanced Sign up and Log in actions; optional address login preserves drafts without credential or account work',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.settings-submenus-preserve-public-drafts-deep-link',
    name: 'Settings submenus preserve public drafts, deep-link safely and fit mobile without credential effects',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.four-workspaces-and-a-home-link-separate',
    name: 'four workspaces and a home link separate settings and Audit without credentials or connector effects',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.consistent-account-page-links-support-arrow-keyboard',
    name: 'consistent account page links support arrow keyboard navigation and mobile layout without an account, credentials or implicit actions',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.account-operation-deep-links-restore-presentation-only',
    name: 'account operation deep links restore presentation only; unknown subpages fall back to balances',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.activity-owns-progress-results-and-explanations-without',
    name: 'Activity owns progress, results and explanations without a floating header banner',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
  {
    id: 'presentation.mobile-activity-sheet-contains-focus-and-escape',
    name: 'mobile Activity sheet contains focus and Escape restores the trigger without starting work',
    arms: ['p256', 'jubjub'],
    group: 'presentation',
  },
];
