import { createIcon, type DemoIcon } from './icons.js';
import passportCard from './assets/passport-card.svg';
import './landing.css';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
};

function action(id: string) {
  const control = document.getElementById(id);
  const item = control?.closest('li');
  if (!(control instanceof HTMLButtonElement) || !item)
    throw new Error(`Missing landing action ${id}`);
  return { control, item };
}

function relabel(control: HTMLButtonElement, label: string, icon?: DemoIcon) {
  control.replaceChildren();
  if (icon) control.append(createIcon(icon));
  control.append(element('span', label));
}

function hideActionExplanations(item: HTMLLIElement) {
  for (const description of item.querySelectorAll('.prompts, .action-desc'))
    description.classList.add('sr-only');
}

function introduction(intro: HTMLElement) {
  intro.className = 'landing-introduction';
  const art = element('img');
  art.src = passportCard;
  art.alt = '';
  art.width = 360;
  art.height = 234;
  art.className = 'landing-passport-card';
  const title = element('h1', 'Your Passport account for the Midnight network.');
  title.className = 'landing-title';
  const description = element(
    'p',
    'Create an account with a passkey. Connect a Midnight wallet when you’re ready.',
  );
  description.className = 'landing-description';
  intro.replaceChildren(art, title, description);
}

function demoTools(navigate: (section: 'audit' | 'settings') => void) {
  const footer = element('footer');
  footer.className = 'landing-footer';
  footer.append(element('p', 'Prototype · test funds only'));
  const tools = element('details');
  tools.id = 'landing-demo-tools';
  tools.className = 'landing-tools';
  tools.append(element('summary', 'Demo tools'));
  const links = element('div');
  links.className = 'landing-tools-links';
  for (const [section, label] of [
    ['audit', 'Audit'],
    ['settings', 'Settings'],
  ] as const) {
    const link = element('button', label);
    link.type = 'button';
    link.id = `landing-${section}`;
    link.className = 'btn btn-secondary';
    link.prepend(createIcon(section));
    link.addEventListener('click', () => navigate(section));
    links.append(link);
  }
  tools.append(links);
  footer.append(tools);
  return footer;
}

/** Presentation only: retain existing controls, listeners, consent and operation state. */
export function createLandingPage(
  view: HTMLElement,
  navigate: (section: 'audit' | 'settings') => void,
): void {
  const create = action('create');
  const open = action('open');
  const openAt = action('openAt');
  const intro = view.querySelector<HTMLElement>('.intro');
  if (!intro) throw new Error('Missing landing introduction');
  view.classList.add('passport-landing');
  introduction(intro);
  relabel(create.control, 'Sign up', 'signup');
  relabel(open.control, 'Log in', 'passkey');
  create.control.classList.replace('btn-secondary', 'btn-primary');
  open.control.classList.replace('btn-primary', 'btn-secondary');
  for (const item of [create.item, open.item, openAt.item]) hideActionExplanations(item);
  const welcome = element('section');
  welcome.className = 'overview-welcome';
  welcome.setAttribute('aria-labelledby', 'overview-welcome-title');
  const title = element('h3', 'Get started with Passport');
  title.id = 'overview-welcome-title';
  title.className = 'sr-only';
  const choices = element('ul');
  choices.className = 'actions overview-choices';
  choices.append(create.item, open.item);
  const reminder = element('p', 'Already have a Passport? Log in with your registered passkey.');
  reminder.className = 'landing-entry-note';
  const byAddress = element('details');
  byAddress.id = 'overview-open-address';
  byAddress.className = 'overview-advanced';
  byAddress.append(element('summary', 'Log in with an account address'));
  const addressActions = element('ul');
  addressActions.className = 'actions landing-address-actions';
  addressActions.append(openAt.item);
  const addressNote = element(
    'p',
    'You still need a passkey enrolled on this account. An address alone does not grant access.',
  );
  addressNote.className = 'overview-note';
  byAddress.append(addressActions, addressNote);
  welcome.append(title, choices, reminder, byAddress);
  view.append(welcome, demoTools(navigate));
}
