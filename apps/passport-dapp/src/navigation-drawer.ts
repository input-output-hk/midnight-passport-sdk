/** One navigation DOM tree: persistent desktop rail, modal drawer on compact screens. */
export function createNavigationDrawer(
  main: HTMLElement,
  navigation: HTMLElement,
  media: MediaQueryList,
  focusContent: () => void,
) {
  const slot = document.createComment('desktop navigation');
  navigation.before(slot);
  const bar = document.createElement('div');
  bar.className = 'navigation-bar';
  const toggle = document.createElement('button');
  toggle.id = 'navigation-toggle';
  toggle.className = 'btn btn-secondary';
  toggle.type = 'button';
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-controls', 'navigation-sheet');
  toggle.setAttribute('aria-expanded', 'false');
  bar.append(toggle);
  main.prepend(bar);
  const sheet = document.createElement('dialog');
  sheet.id = 'navigation-sheet';
  sheet.setAttribute('aria-labelledby', 'navigation-title');
  const header = document.createElement('div');
  header.className = 'navigation-sheet-header';
  const title = document.createElement('h2');
  title.id = 'navigation-title';
  title.textContent = 'Navigation';
  const close = document.createElement('button');
  close.type = 'button';
  close.id = 'navigation-close';
  close.className = 'btn btn-secondary';
  close.textContent = 'Close menu';
  header.append(title, close);
  sheet.append(header);
  document.body.append(sheet);
  const restore = () => {
    toggle.setAttribute('aria-expanded', String(sheet.open));
    if (sheet.returnValue === 'navigate' || sheet.returnValue === 'resize') focusContent();
    else if (media.matches) toggle.focus({ preventScroll: true });
  };
  close.addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', restore);
  sheet.addEventListener('click', (event) => {
    const bounds = sheet.getBoundingClientRect();
    if (
      event.target === sheet &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
      sheet.close();
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [
      ...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'),
    ].filter((item) => item.getClientRects().length > 0);
    const first = controls[0] ?? close;
    const last = controls.at(-1) ?? close;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  toggle.addEventListener('click', () => {
    sheet.returnValue = '';
    sheet.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    close.focus();
  });
  navigation.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest('button, a');
    if (
      control &&
      sheet.open &&
      !(
        event instanceof MouseEvent &&
        (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      )
    )
      sheet.close('navigate');
  });
  const layout = () => {
    const navigationFocused = navigation.contains(document.activeElement);
    const toggleFocused = bar.contains(document.activeElement);
    const wasOpen = sheet.open;
    if (sheet.open) sheet.close('resize');
    bar.hidden = !media.matches;
    if (media.matches) sheet.append(navigation);
    else slot.after(navigation);
    if (!wasOpen && media.matches && navigationFocused) toggle.focus({ preventScroll: true });
    else if (!wasOpen && !media.matches && toggleFocused) focusContent();
  };
  media.addEventListener('change', layout);
  layout();
  return {
    label(value: string) {
      toggle.textContent = `Menu · ${value}`;
    },
    isOpen: () => sheet.open,
    closeForNavigation() {
      if (sheet.open) sheet.close('navigate');
    },
  };
}
